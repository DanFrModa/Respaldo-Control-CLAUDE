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
 *
 * VENTANA temporal (recarga limitada, p. ej. `ETL_DESDE=2025-01-01`): el pedido real entra si
 * su fecha propia `FechaPedPR` cae dentro (fecha nula = dentro). CASCADA: si su pedido padre
 * quedó fuera de la ventana, el pedido real se excluye también aunque su fecha esté dentro
 * (`padreFueraVentana`, bucket propio — NUNCA migra un hijo cuyo padre quedó fuera). Todo lo
 * excluido se CUENTA (§7). Ventana inactiva (default) → migra todo, como siempre.
 */
import {
  crearPedidoRealMigrado,
  type LineaPedidoRealMigrada,
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
  leerMapeo,
  type ClienteMapeo,
} from '../comun/mapeo.js';
import { conReintentoTransitorio } from '../comun/reintentos.js';
import type { Reporte } from '../comun/reporte.js';
import { intentarCrear } from '../comun/saneo.js';
import { parsearEntero, parsearFechaSoloDia, parsearTexto } from '../comun/valores.js';
import { prescanVentanaF2, type PrescanVentanaF2 } from '../comun/ventana-f2.js';
import {
  dentroVentana,
  describirVentana,
  resolverVentana,
  type ConfigVentana,
} from '../comun/ventana.js';
import type { ResultadoLoader } from './clientes.js';

/** Resultado del loader de pedidos reales: cabeceras + renglones. */
export interface ResultadoPedidosReales {
  reales: ResultadoLoader;
  lineas: ResultadoLoader;
  /** # de pedidos reales FUERA por su fecha propia (FechaPedPR); 0 con ventana inactiva. */
  fueraVentana: number;
  /** # excluidos por CASCADA (su pedido padre quedó fuera de la ventana). */
  padreFueraVentana: number;
  /** # de renglones de los pedidos reales excluidos (ambos buckets). */
  lineasFueraVentana: number;
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

/** Contribución de UN pedido real a los conteos (se suma tras los lotes). */
interface ContribReal {
  real:
    | 'creado'
    | 'existente'
    | 'omitido'
    | 'omitidoValidacion'
    | 'fueraVentana'
    | 'padreFueraVentana';
  lineasCreadas: number;
  lineasOmitidas: number;
  /** Renglones excluidos porque su cabecera quedó fuera de la ventana (propio o cascada). */
  lineasFueraVentana: number;
}

export async function cargarPedidosReales(
  sesion: SesionUsuario,
  cliente: ClienteMapeo,
  reporte: Reporte,
  ventana: ConfigVentana = resolverVentana(),
  prescan?: PrescanVentanaF2 | null,
): Promise<ResultadoPedidosReales> {
  const bd: ContextoBd = { cliente: cliente as PrismaClient };
  // Prescan de la ventana (cascada): lo pasa el orquestador; si se llama suelto, se calcula aquí.
  // Con ventana inactiva es `null` (cero costo, comportamiento de siempre).
  const pre = prescan === undefined ? prescanVentanaF2(ventana) : prescan;

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

  // Cada pedido real + sus renglones es una unidad INDEPENDIENTE → carga concurrente acotada
  // (con reintento ante cortes transitorios; idempotente por el mapeo de IdPedidosReales).
  const filas = leerCsv('PedidosReales.csv');
  const contribs = await enLotes(
    filas,
    (f): Promise<ContribReal> =>
      conReintentoTransitorio(() =>
        procesarReal(
          sesion,
          bd,
          cliente,
          reporte,
          { mapaPedido, mapaPedidoLinea },
          detPorReal,
          { ventana, prescan: pre },
          f,
        ),
      ),
    CONCURRENCIA_ETL,
  );

  const reales: ResultadoLoader = { creados: 0, existentes: 0, omitidos: 0, omitidosValidacion: 0 };
  const lineas: ResultadoLoader = { creados: 0, existentes: 0, omitidos: 0, omitidosValidacion: 0 };
  let fueraVentana = 0;
  let padreFueraVentana = 0;
  let lineasFueraVentana = 0;
  for (const res of contribs) {
    if (!res.ok) {
      reales.omitidosValidacion = (reales.omitidosValidacion ?? 0) + 1;
      continue;
    }
    const c = res.valor;
    if (c.real === 'creado') reales.creados += 1;
    else if (c.real === 'existente') reales.existentes += 1;
    else if (c.real === 'omitido') reales.omitidos += 1;
    else if (c.real === 'fueraVentana') fueraVentana += 1;
    else if (c.real === 'padreFueraVentana') padreFueraVentana += 1;
    else reales.omitidosValidacion = (reales.omitidosValidacion ?? 0) + 1;
    lineas.creados += c.lineasCreadas;
    lineas.omitidos += c.lineasOmitidas;
    lineasFueraVentana += c.lineasFueraVentana;
  }

  // Lo excluido por ventana se REPORTA agregado (conteo, no lista — §7 sin silencio).
  if (fueraVentana > 0 || padreFueraVentana > 0) {
    reporte.nota(
      `${describirVentana(ventana)} PedidosReales fuera de ventana: ${String(fueraVentana)} por fecha propia + ` +
        `${String(padreFueraVentana)} por cascada (pedido padre fuera), con ${String(lineasFueraVentana)} renglones — NO migrados.`,
    );
  }

  return { reales, lineas, fueraVentana, padreFueraVentana, lineasFueraVentana };
}

/** Mapeos que necesita cada pedido real (clave vieja → id nuevo). */
interface MapeosReal {
  mapaPedido: Map<string, number>;
  mapaPedidoLinea: Map<string, number>;
}

/** Ventana + prescan de cascada que aplica cada pedido real. */
interface VentanaReal {
  ventana: ConfigVentana;
  prescan: PrescanVentanaF2 | null;
}

/** Procesa UN pedido real + sus renglones (idempotente, tolerante). Devuelve su contribución. */
async function procesarReal(
  sesion: SesionUsuario,
  bd: ContextoBd,
  cliente: ClienteMapeo,
  reporte: Reporte,
  mapeos: MapeosReal,
  detPorReal: Map<string, DetRealCrudo[]>,
  ventanaReal: VentanaReal,
  f: Record<string, string>,
): Promise<ContribReal> {
  const { mapaPedido, mapaPedidoLinea } = mapeos;
  const idViejo = (f.IdPedidosReales ?? '').trim();
  const idPedidoV1 = (f.IdPedidos ?? '').trim();

  // Ventana ANTES del mapeo: la exclusión a propósito no debe caer en "pedido sin mapeo".
  // Fecha propia primero; si está dentro pero el pedido padre quedó fuera → cascada.
  const fechaPedPR = parsearFechaSoloDia(f.FechaPedPR);
  const detFuera = (detPorReal.get(idViejo) ?? []).length;
  if (!dentroVentana(fechaPedPR, ventanaReal.ventana)) {
    return {
      real: 'fueraVentana',
      lineasCreadas: 0,
      lineasOmitidas: 0,
      lineasFueraVentana: detFuera,
    };
  }
  if (ventanaReal.prescan !== null && ventanaReal.prescan.pedidosFuera.has(idPedidoV1)) {
    return {
      real: 'padreFueraVentana',
      lineasCreadas: 0,
      lineasOmitidas: 0,
      lineasFueraVentana: detFuera,
    };
  }

  const idPedido = mapaPedido.get(idPedidoV1);
  if (idPedido === undefined) {
    reporte.agregar(
      'PedidoReal con pedido sin mapeo (omitido)',
      `IdPedidosReales=${idViejo} IdPedidos=${idPedidoV1}`,
    );
    return { real: 'omitido', lineasCreadas: 0, lineasOmitidas: 0, lineasFueraVentana: 0 };
  }

  // Idempotencia por el mapeo de IdPedidosReales.
  const yaMapeado = await leerMapeo(cliente, ENTIDAD_MAPEO.pedidoReal, idViejo);
  if (yaMapeado !== null) {
    return { real: 'existente', lineasCreadas: 0, lineasOmitidas: 0, lineasFueraVentana: 0 };
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

  const resultado = await intentarCrear(reporte, 'PedidoReal', idViejo, () =>
    crearPedidoRealMigrado(
      sesion,
      {
        idPedido,
        numPedReal: parsearTexto(f.NumPedReal),
        cedis: parsearTexto(f.Cedis),
        apertura: parsearTexto(f.Apertura),
        fechaPedPR,
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
    return { real: 'omitidoValidacion', lineasCreadas: 0, lineasOmitidas, lineasFueraVentana: 0 };
  }
  await guardarMapeo(cliente, ENTIDAD_MAPEO.pedidoReal, idViejo, resultado.idPedidoReal);
  let lineasCreadas = 0;
  for (const l of resultado.lineas) {
    if (l.claveVieja !== undefined) {
      await guardarMapeo(cliente, ENTIDAD_MAPEO.pedidoRealLinea, l.claveVieja, l.id);
      lineasCreadas += 1;
    }
  }
  return { real: 'creado', lineasCreadas, lineasOmitidas, lineasFueraVentana: 0 };
}
