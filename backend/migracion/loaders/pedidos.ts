/**
 * Loader de PEDIDOS internos (F2-E5). `Pedidos.csv` (1,529) + `PedidosDet.csv` (5,636) →
 * `Pedido` + `PedidoLinea`, vía el MODO MIGRACIÓN del dominio (`crearPedidoMigrado`, A1).
 *
 * Preserva el histórico: folio = `NumeroPed`, banderas pedCancelado/noProducir/entregadoTienda,
 * todas las fechas, `IdOrdCompra`→idOrdCompraV1 (snapshot sin FK), y por renglón
 * EntregadoParcial→entregadoParcialV1 y CantFalt→cantFaltanteV1 (snapshots de SOLO lectura).
 *
 * Mapeos: IdClientes→idCliente (vía MapeoMigracion de F1), IdEmpresas→idEmpresa (vía F1). Guarda
 * IdPedidos→Pedido.id y, CRÍTICO, IdPedidosDet→PedidoLinea.id (lo necesitan las órdenes y los
 * pedidos reales).
 *
 * Idempotencia: resuelve "ya existe" por el unique `(idEmpresa, folio)` ANTES de crear; en una
 * 2ª corrida no duplica y re-guarda los mapeos (por si el primer corrido se cortó). Las filas con
 * cliente/empresa/modelo sin mapeo, o con NumeroPed no numérico, se LISTAN al reporte (§7).
 */
import { crearPedidoMigrado, type LineaPedidoMigrada } from '../../src/dominio/pedidos/migracion.js';
import type { SesionUsuario } from '../../src/comun/permisos.js';
import type { ContextoBd } from '../../src/comun/transaccion.js';
import type { PrismaClient } from '../../src/datos/index.js';

import { leerCsv } from '../comun/csv.js';
import {
  cargarMapaNumerico,
  ENTIDAD_MAPEO,
  guardarMapeo,
  type ClienteMapeo,
} from '../comun/mapeo.js';
import type { Reporte } from '../comun/reporte.js';
import { intentarCrear } from '../comun/saneo.js';
import { parsearEntero, parsearFechaSoloDia, parsearBandera } from '../comun/valores.js';
import type { ResultadoLoader } from './clientes.js';

/** Resultado del loader de pedidos: pedidos + renglones (para el log/cuadre). */
export interface ResultadoPedidos {
  pedidos: ResultadoLoader;
  lineas: ResultadoLoader;
}

/** Renglón crudo de `PedidosDet` ya parseado (sin el idModelo resuelto). */
interface DetCrudo {
  idPedidosDet: string;
  idModelos: string;
  cantPed: number;
  precio: number;
  entregadoParcial: number | null;
  cantFalt: number | null;
}

export async function cargarPedidos(
  sesion: SesionUsuario,
  cliente: ClienteMapeo,
  reporte: Reporte,
): Promise<ResultadoPedidos> {
  const bd: ContextoBd = { cliente: cliente as PrismaClient };

  // Mapeos de F1 (clave vieja → id nuevo).
  const mapaCliente = await cargarMapaNumerico(cliente, ENTIDAD_MAPEO.cliente);
  const mapaEmpresa = await cargarMapaNumerico(cliente, ENTIDAD_MAPEO.empresa);
  const mapaModelo = await cargarMapaNumerico(cliente, ENTIDAD_MAPEO.modelo);

  // Detalle agrupado por IdPedidos (lo necesitamos completo al crear cada pedido en una tx).
  const detPorPedido = new Map<string, DetCrudo[]>();
  const filasDet = leerCsv('PedidosDet.csv');
  for (const f of filasDet) {
    const idPed = (f.IdPedidos ?? '').trim();
    if (idPed === '') continue;
    const lista = detPorPedido.get(idPed) ?? [];
    lista.push({
      idPedidosDet: (f.IdPedidosDet ?? '').trim(),
      idModelos: (f.IdModelos ?? '').trim(),
      cantPed: parsearEntero(f.CantPed) ?? 0,
      precio: Number(((f.Precio ?? '').replace(/[$\s,]/g, '').trim()) || '0') || 0,
      entregadoParcial: parsearEntero(f.EntregadoParcial),
      cantFalt: parsearEntero(f.CantFalt),
    });
    detPorPedido.set(idPed, lista);
  }

  const pedidos: ResultadoLoader = { creados: 0, existentes: 0, omitidos: 0, omitidosValidacion: 0 };
  const lineas: ResultadoLoader = { creados: 0, existentes: 0, omitidos: 0, omitidosValidacion: 0 };

  const filas = leerCsv('Pedidos.csv');
  for (const f of filas) {
    const idViejo = (f.IdPedidos ?? '').trim();
    const folio = parsearEntero(f.NumeroPed);
    const idClienteV1 = (f.IdClientes ?? '').trim();
    const idEmpresaV1 = (f.IdEmpresas ?? '').trim();

    if (folio === null) {
      pedidos.omitidos += 1;
      reporte.agregar('Pedido sin NumeroPed numérico (omitido)', `IdPedidos=${idViejo}`);
      continue;
    }
    const idCliente = mapaCliente.get(idClienteV1);
    if (idCliente === undefined) {
      pedidos.omitidos += 1;
      reporte.agregar(
        'Pedido con cliente sin mapeo (omitido)',
        `IdPedidos=${idViejo} IdClientes=${idClienteV1}`,
      );
      continue;
    }
    const idEmpresa = mapaEmpresa.get(idEmpresaV1);
    if (idEmpresa === undefined) {
      pedidos.omitidos += 1;
      reporte.agregar(
        'Pedido con empresa sin mapeo (omitido)',
        `IdPedidos=${idViejo} IdEmpresas=${idEmpresaV1}`,
      );
      continue;
    }

    // Renglones: resolver idModelo; los sin mapeo se LISTAN y se descartan (el pedido sí entra).
    const detCrudo = detPorPedido.get(idViejo) ?? [];
    const lineasMigradas: LineaPedidoMigrada[] = [];
    let lineasOmitidas = 0;
    for (const d of detCrudo) {
      const idModelo = mapaModelo.get(d.idModelos);
      if (idModelo === undefined) {
        lineasOmitidas += 1;
        reporte.agregar(
          'PedidoLinea con modelo sin mapeo (omitida)',
          `IdPedidos=${idViejo} IdPedidosDet=${d.idPedidosDet} IdModelos=${d.idModelos}`,
        );
        continue;
      }
      lineasMigradas.push({
        idModelo,
        cantidadPedida: d.cantPed,
        precio: d.precio,
        entregadoParcialV1: d.entregadoParcial,
        cantFaltanteV1: d.cantFalt,
        claveVieja: d.idPedidosDet,
      });
    }
    lineas.omitidos += lineasOmitidas;

    // Idempotencia: ¿ya existe el pedido por (idEmpresa, folio)?
    const existente = await cliente.pedido.findUnique({
      where: { idEmpresa_folio: { idEmpresa, folio: BigInt(folio) } },
      select: { id: true, lineas: { select: { id: true, idModelo: true }, orderBy: { id: 'asc' } } },
    });
    if (existente !== null) {
      pedidos.existentes += 1;
      // Re-guardar mapeos (por si la 1ª corrida se cortó tras crear pero antes de mapear).
      await guardarMapeo(cliente, ENTIDAD_MAPEO.pedido, idViejo, existente.id);
      // Mapear cada renglón existente a su IdPedidosDet por orden (mismo orden de creación).
      const lineasExist = existente.lineas;
      for (let i = 0; i < lineasMigradas.length && i < lineasExist.length; i += 1) {
        const clave = lineasMigradas[i]?.claveVieja;
        const existeLinea = lineasExist[i];
        if (clave !== undefined && existeLinea !== undefined) {
          await guardarMapeo(cliente, ENTIDAD_MAPEO.pedidoLinea, clave, existeLinea.id);
          lineas.existentes += 1;
        }
      }
      continue;
    }

    const resultado = await intentarCrear(reporte, 'Pedido', idViejo, () =>
      crearPedidoMigrado(
        sesion,
        {
          folio,
          idEmpresa,
          idCliente,
          fechaPedido: parsearFechaSoloDia(f.FechaPedido),
          fechaDe: parsearFechaSoloDia(f.FechaDe),
          fechaHasta: parsearFechaSoloDia(f.FechaHasta),
          fechaTela: parsearFechaSoloDia(f.FechaTela),
          fechaElaboracion: parsearFechaSoloDia(f.FechaElaboracion),
          entregadoTienda: parsearBandera(f.EntregadoTienda),
          noProducir: parsearBandera(f.NoProducir),
          pedCancelado: parsearBandera(f.PedCancelado),
          idOrdCompraV1: parsearEntero(f.IdOrdCompra),
          lineas: lineasMigradas,
        },
        bd,
      ),
    );
    if (resultado === null) {
      pedidos.omitidosValidacion = (pedidos.omitidosValidacion ?? 0) + 1;
      continue;
    }
    pedidos.creados += 1;
    await guardarMapeo(cliente, ENTIDAD_MAPEO.pedido, idViejo, resultado.idPedido);
    for (const l of resultado.lineas) {
      if (l.claveVieja !== undefined) {
        await guardarMapeo(cliente, ENTIDAD_MAPEO.pedidoLinea, l.claveVieja, l.id);
        lineas.creados += 1;
      }
    }
  }

  return { pedidos, lineas };
}
