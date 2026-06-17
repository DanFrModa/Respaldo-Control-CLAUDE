/**
 * Loader de PEDIDOS REALES (F2-E5). `PedidosReales.csv` (161) + `PedidosRealesDet.csv` (644) →
 * `PedidoReal` + `PedidoRealLinea`, vía el MODO MIGRACIÓN del dominio (`crearPedidoRealMigrado`, A1).
 *
 * Preserva el histórico: NumPedReal, Cedis, Apertura (texto libre), todas las fechas y la
 * AUDITORÍA ORIGINAL del viejo (IdUsuarios→creadoPorId/modificadoPorId, FechaUsuario disponible).
 * El detalle liga IdPedidosDet→idPedidoLinea (vía el mapeo que dejó el loader de pedidos).
 *
 * Mapeo: IdPedidos→idPedido (vía MapeoMigracion). Guarda IdPedidosReales→PedidoReal.id y
 * IdPedidosRealesDet→PedidoRealLinea.id.
 *
 * Idempotencia: resuelve "ya existe" por el mapeo de IdPedidosReales; en una 2ª corrida no
 * duplica. Cabeceras sin pedido mapeable, o renglones sin IdPedidosDet mapeable, se LISTAN (§7).
 */
import {
  crearPedidoRealMigrado,
  type LineaPedidoRealMigrada,
} from '../../src/dominio/pedidos/migracion.js';
import type { SesionUsuario } from '../../src/comun/permisos.js';
import type { ContextoBd } from '../../src/comun/transaccion.js';
import type { PrismaClient } from '../../src/datos/index.js';

import { leerCsv } from '../comun/csv.js';
import {
  cargarMapaNumerico,
  ENTIDAD_MAPEO,
  guardarMapeo,
  leerMapeo,
  type ClienteMapeo,
} from '../comun/mapeo.js';
import type { Reporte } from '../comun/reporte.js';
import { intentarCrear } from '../comun/saneo.js';
import { parsearEntero, parsearFechaSoloDia, parsearTexto } from '../comun/valores.js';
import type { ResultadoLoader } from './clientes.js';

/** Resultado del loader de pedidos reales: cabeceras + renglones. */
export interface ResultadoPedidosReales {
  reales: ResultadoLoader;
  lineas: ResultadoLoader;
}

/** Renglón crudo de `PedidosRealesDet`. */
interface DetRealCrudo {
  idPedidosRealesDet: string;
  idPedidosDet: string;
  cantidadPR: number;
  cantidadEnviada: number;
  cantidadEntregadaReal: number;
  empaques: number;
}

export async function cargarPedidosReales(
  sesion: SesionUsuario,
  cliente: ClienteMapeo,
  reporte: Reporte,
): Promise<ResultadoPedidosReales> {
  const bd: ContextoBd = { cliente: cliente as PrismaClient };

  const mapaPedido = await cargarMapaNumerico(cliente, ENTIDAD_MAPEO.pedido);
  const mapaPedidoLinea = await cargarMapaNumerico(cliente, ENTIDAD_MAPEO.pedidoLinea);

  // Detalle agrupado por IdPedidosReales.
  const detPorReal = new Map<string, DetRealCrudo[]>();
  for (const f of leerCsv('PedidosRealesDet.csv')) {
    const idReal = (f.IdPedidosReales ?? '').trim();
    if (idReal === '') continue;
    const lista = detPorReal.get(idReal) ?? [];
    lista.push({
      idPedidosRealesDet: (f.IdPedidosRealesDet ?? '').trim(),
      idPedidosDet: (f.IdPedidosDet ?? '').trim(),
      cantidadPR: parsearEntero(f.CantidadPR) ?? 0,
      cantidadEnviada: parsearEntero(f.CantidadEnviada) ?? 0,
      cantidadEntregadaReal: parsearEntero(f.CantidadEntregadaReal) ?? 0,
      empaques: parsearEntero(f.Empaques) ?? 0,
    });
    detPorReal.set(idReal, lista);
  }

  const reales: ResultadoLoader = { creados: 0, existentes: 0, omitidos: 0, omitidosValidacion: 0 };
  const lineas: ResultadoLoader = { creados: 0, existentes: 0, omitidos: 0, omitidosValidacion: 0 };

  for (const f of leerCsv('PedidosReales.csv')) {
    const idViejo = (f.IdPedidosReales ?? '').trim();
    const idPedidoV1 = (f.IdPedidos ?? '').trim();
    const idPedido = mapaPedido.get(idPedidoV1);
    if (idPedido === undefined) {
      reales.omitidos += 1;
      reporte.agregar(
        'PedidoReal con pedido sin mapeo (omitido)',
        `IdPedidosReales=${idViejo} IdPedidos=${idPedidoV1}`,
      );
      continue;
    }

    // Idempotencia por el mapeo de IdPedidosReales.
    const yaMapeado = await leerMapeo(cliente, ENTIDAD_MAPEO.pedidoReal, idViejo);
    if (yaMapeado !== null) {
      reales.existentes += 1;
      continue;
    }

    // Renglones: liga cada IdPedidosDet a su PedidoLinea migrada.
    const detCrudo = detPorReal.get(idViejo) ?? [];
    const lineasMigradas: LineaPedidoRealMigrada[] = [];
    let lineasOmitidas = 0;
    for (const d of detCrudo) {
      const idPedidoLinea = mapaPedidoLinea.get(d.idPedidosDet);
      if (idPedidoLinea === undefined) {
        lineasOmitidas += 1;
        reporte.agregar(
          'PedidoRealLinea con IdPedidosDet sin mapeo (omitida)',
          `IdPedidosRealesDet=${d.idPedidosRealesDet} IdPedidosDet=${d.idPedidosDet}`,
        );
        continue;
      }
      lineasMigradas.push({
        idPedidoLinea,
        cantidadPR: d.cantidadPR,
        cantidadEnviada: d.cantidadEnviada,
        cantidadEntregadaReal: d.cantidadEntregadaReal,
        empaques: d.empaques,
        claveVieja: d.idPedidosRealesDet,
      });
    }
    lineas.omitidos += lineasOmitidas;

    const resultado = await intentarCrear(reporte, 'PedidoReal', idViejo, () =>
      crearPedidoRealMigrado(
        sesion,
        {
          idPedido,
          numPedReal: parsearTexto(f.NumPedReal),
          cedis: parsearTexto(f.Cedis),
          apertura: parsearTexto(f.Apertura),
          fechaPedPR: parsearFechaSoloDia(f.FechaPedPR),
          fechaInicio: parsearFechaSoloDia(f.FechaInicioPR),
          fechaFin: parsearFechaSoloDia(f.FechaFinPR),
          fechaEntregadaReal: parsearFechaSoloDia(f.FechaEntregadaReal),
          creadoPorIdV1: parsearTexto(f.IdUsuarios),
          lineas: lineasMigradas,
        },
        bd,
      ),
    );
    if (resultado === null) {
      reales.omitidosValidacion = (reales.omitidosValidacion ?? 0) + 1;
      continue;
    }
    reales.creados += 1;
    await guardarMapeo(cliente, ENTIDAD_MAPEO.pedidoReal, idViejo, resultado.idPedidoReal);
    for (const l of resultado.lineas) {
      if (l.claveVieja !== undefined) {
        await guardarMapeo(cliente, ENTIDAD_MAPEO.pedidoRealLinea, l.claveVieja, l.id);
        lineas.creados += 1;
      }
    }
  }

  return { reales, lineas };
}
