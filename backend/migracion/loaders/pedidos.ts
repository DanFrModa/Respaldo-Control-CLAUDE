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
 *
 * VENTANA temporal (recarga limitada, p. ej. `ETL_DESDE=2025-01-01`): el pedido entra si su
 * `FechaPedido` cae dentro de la ventana (fecha nula = dentro, como F4). Los excluidos y sus
 * renglones se CUENTAN (`fueraVentana`/`lineasFueraVentana`, nada en silencio §7). Con la
 * ventana inactiva (default) migra TODO, como siempre.
 */
import {
  crearPedidoMigrado,
  type LineaPedidoMigrada,
} from '../../src/dominio/pedidos/migracion.js';
import type { SesionUsuario } from '../../src/comun/permisos.js';
import type { ContextoBd } from '../../src/comun/transaccion.js';
import type { PrismaClient } from '../../src/datos/index.js';

import { leerCsv } from '../comun/csv.js';
import { CONCURRENCIA_ETL, enLotes } from '../comun/lotes.js';
import {
  cargarMapaNumerico,
  ENTIDAD_MAPEO,
  guardarMapeo,
  type ClienteMapeo,
} from '../comun/mapeo.js';
import { conReintentoTransitorio } from '../comun/reintentos.js';
import type { Reporte } from '../comun/reporte.js';
import { intentarCrear } from '../comun/saneo.js';
import { parsearEntero, parsearFechaSoloDia, parsearBandera } from '../comun/valores.js';
import {
  dentroVentana,
  describirVentana,
  resolverVentana,
  type ConfigVentana,
} from '../comun/ventana.js';
import type { ResultadoLoader } from './clientes.js';

/** Resultado del loader de pedidos: pedidos + renglones (para el log/cuadre). */
export interface ResultadoPedidos {
  pedidos: ResultadoLoader;
  lineas: ResultadoLoader;
  /** # de pedidos FUERA de la ventana temporal (excluidos a propósito; 0 con ventana inactiva). */
  fueraVentana: number;
  /** # de renglones de esos pedidos excluidos (cascada pedido → renglón). */
  lineasFueraVentana: number;
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

/** Contribución de UN pedido a los conteos (se suma tras los lotes). */
interface ContribPedido {
  /** Desenlace del documento pedido. */
  pedido: 'creado' | 'existente' | 'omitido' | 'omitidoValidacion' | 'fueraVentana';
  /** Renglones creados / existentes / omitidos de ESTE pedido. */
  lineasCreadas: number;
  lineasExistentes: number;
  lineasOmitidas: number;
  /** Renglones excluidos por cascada (el pedido quedó fuera de la ventana). */
  lineasFueraVentana: number;
}

export async function cargarPedidos(
  sesion: SesionUsuario,
  cliente: ClienteMapeo,
  reporte: Reporte,
  ventana: ConfigVentana = resolverVentana(),
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
      precio: Number((f.Precio ?? '').replace(/[$\s,]/g, '').trim() || '0') || 0,
      entregadoParcial: parsearEntero(f.EntregadoParcial),
      cantFalt: parsearEntero(f.CantFalt),
    });
    detPorPedido.set(idPed, lista);
  }

  // Cada pedido + sus renglones es una unidad INDEPENDIENTE → carga concurrente acotada (con
  // reintento ante cortes transitorios; la unidad es idempotente por (idEmpresa, folio)).
  const filas = leerCsv('Pedidos.csv');
  const contribs = await enLotes(
    filas,
    (f): Promise<ContribPedido> =>
      conReintentoTransitorio(() =>
        procesarPedido(
          sesion,
          bd,
          cliente,
          reporte,
          { mapaCliente, mapaEmpresa, mapaModelo },
          detPorPedido,
          ventana,
          f,
        ),
      ),
    CONCURRENCIA_ETL,
  );

  const pedidos: ResultadoLoader = {
    creados: 0,
    existentes: 0,
    omitidos: 0,
    omitidosValidacion: 0,
  };
  const lineas: ResultadoLoader = { creados: 0, existentes: 0, omitidos: 0, omitidosValidacion: 0 };
  let fueraVentana = 0;
  let lineasFueraVentana = 0;
  for (const res of contribs) {
    // Un fallo de `enLotes` (tras agotar reintentos) cuenta como pedido omitido por validación.
    if (!res.ok) {
      pedidos.omitidosValidacion = (pedidos.omitidosValidacion ?? 0) + 1;
      continue;
    }
    const c = res.valor;
    if (c.pedido === 'creado') pedidos.creados += 1;
    else if (c.pedido === 'existente') pedidos.existentes += 1;
    else if (c.pedido === 'omitido') pedidos.omitidos += 1;
    else if (c.pedido === 'fueraVentana') fueraVentana += 1;
    else pedidos.omitidosValidacion = (pedidos.omitidosValidacion ?? 0) + 1;
    lineas.creados += c.lineasCreadas;
    lineas.existentes += c.lineasExistentes;
    lineas.omitidos += c.lineasOmitidas;
    lineasFueraVentana += c.lineasFueraVentana;
  }

  // Lo excluido por ventana se REPORTA agregado (miles de filas: conteo + configuración, no lista).
  if (fueraVentana > 0) {
    reporte.nota(
      `${describirVentana(ventana)} Pedidos fuera de ventana: ${String(fueraVentana)} ` +
        `(con ${String(lineasFueraVentana)} renglones) — NO migrados.`,
    );
  }

  return { pedidos, lineas, fueraVentana, lineasFueraVentana };
}

/** Mapeos de F1 que necesita cada pedido (clave vieja → id nuevo). */
interface MapeosPedido {
  mapaCliente: Map<string, number>;
  mapaEmpresa: Map<string, number>;
  mapaModelo: Map<string, number>;
}

/** Procesa UN pedido + sus renglones (idempotente, tolerante). Devuelve su contribución. */
async function procesarPedido(
  sesion: SesionUsuario,
  bd: ContextoBd,
  cliente: ClienteMapeo,
  reporte: Reporte,
  mapeos: MapeosPedido,
  detPorPedido: Map<string, DetCrudo[]>,
  ventana: ConfigVentana,
  f: Record<string, string>,
): Promise<ContribPedido> {
  const { mapaCliente, mapaEmpresa, mapaModelo } = mapeos;
  const idViejo = (f.IdPedidos ?? '').trim();
  const folio = parsearEntero(f.NumeroPed);
  const idClienteV1 = (f.IdClientes ?? '').trim();
  const idEmpresaV1 = (f.IdEmpresas ?? '').trim();
  const sinLineas = {
    lineasCreadas: 0,
    lineasExistentes: 0,
    lineasOmitidas: 0,
    lineasFueraVentana: 0,
  };

  // Ventana temporal ANTES de los mapeos: un pedido viejo con cliente fuera de ventana NO debe
  // caer en el bucket "cliente sin mapeo" — es exclusión a propósito, con su propio conteo.
  const fechaPedido = parsearFechaSoloDia(f.FechaPedido);
  if (!dentroVentana(fechaPedido, ventana)) {
    return {
      pedido: 'fueraVentana',
      ...sinLineas,
      lineasFueraVentana: (detPorPedido.get(idViejo) ?? []).length,
    };
  }

  if (folio === null) {
    reporte.agregar('Pedido sin NumeroPed numérico (omitido)', `IdPedidos=${idViejo}`);
    return { pedido: 'omitido', ...sinLineas };
  }
  const idCliente = mapaCliente.get(idClienteV1);
  if (idCliente === undefined) {
    reporte.agregar(
      'Pedido con cliente sin mapeo (omitido)',
      `IdPedidos=${idViejo} IdClientes=${idClienteV1}`,
    );
    return { pedido: 'omitido', ...sinLineas };
  }
  const idEmpresa = mapaEmpresa.get(idEmpresaV1);
  if (idEmpresa === undefined) {
    reporte.agregar(
      'Pedido con empresa sin mapeo (omitido)',
      `IdPedidos=${idViejo} IdEmpresas=${idEmpresaV1}`,
    );
    return { pedido: 'omitido', ...sinLineas };
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

  // Idempotencia: ¿ya existe el pedido por (idEmpresa, folio)?
  const existente = await cliente.pedido.findUnique({
    where: { idEmpresa_folio: { idEmpresa, folio: BigInt(folio) } },
    select: { id: true, lineas: { select: { id: true, idModelo: true }, orderBy: { id: 'asc' } } },
  });
  if (existente !== null) {
    // Re-guardar mapeos (por si la 1ª corrida se cortó tras crear pero antes de mapear).
    await guardarMapeo(cliente, ENTIDAD_MAPEO.pedido, idViejo, existente.id);
    // Mapear cada renglón existente a su IdPedidosDet por orden (mismo orden de creación).
    const lineasExist = existente.lineas;
    let lineasExistentes = 0;
    for (let i = 0; i < lineasMigradas.length && i < lineasExist.length; i += 1) {
      const clave = lineasMigradas[i]?.claveVieja;
      const existeLinea = lineasExist[i];
      if (clave !== undefined && existeLinea !== undefined) {
        await guardarMapeo(cliente, ENTIDAD_MAPEO.pedidoLinea, clave, existeLinea.id);
        lineasExistentes += 1;
      }
    }
    return {
      pedido: 'existente',
      lineasCreadas: 0,
      lineasExistentes,
      lineasOmitidas,
      lineasFueraVentana: 0,
    };
  }

  const resultado = await intentarCrear(reporte, 'Pedido', idViejo, () =>
    crearPedidoMigrado(
      sesion,
      {
        folio,
        idEmpresa,
        idCliente,
        fechaPedido,
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
    return {
      pedido: 'omitidoValidacion',
      lineasCreadas: 0,
      lineasExistentes: 0,
      lineasOmitidas,
      lineasFueraVentana: 0,
    };
  }
  await guardarMapeo(cliente, ENTIDAD_MAPEO.pedido, idViejo, resultado.idPedido);
  let lineasCreadas = 0;
  for (const l of resultado.lineas) {
    if (l.claveVieja !== undefined) {
      await guardarMapeo(cliente, ENTIDAD_MAPEO.pedidoLinea, l.claveVieja, l.id);
      lineasCreadas += 1;
    }
  }
  return {
    pedido: 'creado',
    lineasCreadas,
    lineasExistentes: 0,
    lineasOmitidas,
    lineasFueraVentana: 0,
  };
}
