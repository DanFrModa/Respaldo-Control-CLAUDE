/**
 * Loader de CORTES históricos (F3-E6, Pieza A).
 *
 *   `Corte.csv` (~6,967)          → `EtapaMovimiento(tipo=corte)`
 *   `OrdenesDetCorte.csv` (~12,946) → `EtapaMovimientoDet` (color del renglón OrdenesDet + tallas
 *                                     por posición TC1..TC8 de la cadena `Ordenes.Tallas`)
 *
 * Carga vía el MODO MIGRACIÓN del dominio (`crearCorteMigrado`, A1): folio de la secuencia atómica,
 * SIN efectos de kardex. Reglas DURAS (nada se pierde en silencio §7):
 *  • idOrden: `Corte.IdOrdenes` → `Orden.id` (MapeoMigracion de F2). Sin mapeo → corte OMITIDO + listado.
 *  • idCortador: `Corte.IdCortadores` → Proveedor (MapeoMigracion de F1, rol corte). 0/vacío/sin
 *    mapeo → idTercero NULL (NO se valida rol; el histórico lo referencia tal cual).
 *  • color/talla: del despivote del detalle (`produccion-comun.ts`); lo que no resuelve → incidencia.
 *  • idEmpresa: derivado de la orden v2 (A9).
 *
 * Idempotencia: por el `MapeoMigracion` de `IdCorte`. En 2ª corrida no duplica.
 */
import { crearCorteMigrado } from '../../src/dominio/produccion/migracion.js';
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
import { intentarCrear } from '../comun/saneo.js';
import { parsearFechaSoloDia, parsearTexto } from '../comun/valores.js';
import type { Reporte } from '../comun/reporte.js';
import type { ResultadoLoader } from './clientes.js';
import {
  BucketOrdenNoMigrada,
  cargarMapaColorF1Norm,
  cargarMapaOrdenesDet,
  cargarMapaOrdenV2,
  cargarTallasCrudasPorOrden,
  despivotarDetalle,
  leerCantidadesTC,
  resolverContextoOrden,
  type CacheOrdenes,
  type CeldaDetalle,
  type MapaOrdenesDet,
} from './produccion-comun.js';

/** Resultado del loader de cortes. */
export interface ResultadoCortes {
  cortes: ResultadoLoader;
  /** # de renglones de detalle (EtapaMovimientoDet) creados. */
  celdas: number;
}

/** Resolución de FK opcional de tercero (0/vacío/sin mapeo → null). */
function resolverTercero(crudo: string | undefined, mapa: Map<string, number>): number | null {
  const t = (crudo ?? '').trim();
  if (t === '' || t === '0') return null;
  return mapa.get(t) ?? null;
}

export async function cargarCortes(
  sesion: SesionUsuario,
  cliente: ClienteMapeo,
  reporte: Reporte,
): Promise<ResultadoCortes> {
  const bd: ContextoBd = { cliente: cliente as PrismaClient };
  const cli = cliente as PrismaClient;

  const mapaOrdenV2 = await cargarMapaOrdenV2(cliente);
  const mapaCortador = await cargarMapaNumerico(cliente, ENTIDAD_MAPEO.proveedorPorIdCortadores);
  const mapaColorF1 = await cargarMapaColorF1Norm(cliente);
  const mapaOrdenesDet = cargarMapaOrdenesDet();
  const tallasCrudas = cargarTallasCrudasPorOrden();

  // Detalle agrupado por IdCorte.
  const detPorCorte = new Map<string, Record<string, string>[]>();
  for (const f of leerCsv('OrdenesDetCorte.csv')) {
    const idCorte = (f.IdCorte ?? '').trim();
    if (idCorte === '') continue;
    const lista = detPorCorte.get(idCorte) ?? [];
    lista.push(f);
    detPorCorte.set(idCorte, lista);
  }

  // Caché de contextos de orden v2 (compartida: el bucle es concurrente pero solo LEE/puebla la caché
  // de forma idempotente — un par de cargas duplicadas de la misma orden no afectan correctitud).
  const cacheOrdenes: CacheOrdenes = new Map();

  // Bucket AGREGADO de cortes con orden no migrada (con ventana activa serían miles: conteo + muestra).
  const bucketOrden = new BucketOrdenNoMigrada();

  const resultado: ResultadoCortes = {
    cortes: { creados: 0, existentes: 0, omitidos: 0, omitidosValidacion: 0 },
    celdas: 0,
  };

  const filas = leerCsv('Corte.csv');
  const contribs = await enLotes(
    filas,
    (f) =>
      conReintentoTransitorio(() =>
        procesarCorte(sesion, bd, cli, reporte, f, {
          mapaOrdenV2,
          mapaCortador,
          mapaColorF1,
          mapaOrdenesDet,
          tallasCrudas,
          detPorCorte,
          cacheOrdenes,
          bucketOrden,
        }),
      ),
    CONCURRENCIA_ETL,
  );

  for (const res of contribs) {
    if (!res.ok) {
      resultado.cortes.omitidosValidacion = (resultado.cortes.omitidosValidacion ?? 0) + 1;
      continue;
    }
    const c = res.valor;
    if (c.estado === 'creado') resultado.cortes.creados += 1;
    else if (c.estado === 'existente') resultado.cortes.existentes += 1;
    else if (c.estado === 'omitido') resultado.cortes.omitidos += 1;
    else resultado.cortes.omitidosValidacion = (resultado.cortes.omitidosValidacion ?? 0) + 1;
    resultado.celdas += c.celdas;
  }

  bucketOrden.volcar(reporte, 'Corte');

  return resultado;
}

/** Contexto que necesita cada corte (mapeos + cachés). */
interface ContextoCortes {
  mapaOrdenV2: Map<string, number>;
  mapaCortador: Map<string, number>;
  mapaColorF1: Map<string, number>;
  mapaOrdenesDet: MapaOrdenesDet;
  tallasCrudas: Map<string, string>;
  detPorCorte: Map<string, Record<string, string>[]>;
  cacheOrdenes: CacheOrdenes;
  /** Agregado de cortes con orden no migrada (conteo + muestra, no una incidencia por fila). */
  bucketOrden: BucketOrdenNoMigrada;
}

/** Contribución de UN corte a los conteos. */
interface ContribCorte {
  estado: 'creado' | 'existente' | 'omitido' | 'omitidoValidacion';
  celdas: number;
}

async function procesarCorte(
  sesion: SesionUsuario,
  bd: ContextoBd,
  cliente: PrismaClient,
  reporte: Reporte,
  f: Record<string, string>,
  ctx: ContextoCortes,
): Promise<ContribCorte> {
  const idCorte = (f.IdCorte ?? '').trim();
  const idOrdenViejo = (f.IdOrdenes ?? '').trim();

  // Idempotencia.
  const ya = await leerMapeo(cliente, ENTIDAD_MAPEO.etapaCorte, idCorte);
  if (ya !== null) {
    return { estado: 'existente', celdas: 0 };
  }

  const orden = await resolverContextoOrden(
    cliente,
    ctx.cacheOrdenes,
    ctx.mapaOrdenV2,
    ctx.tallasCrudas,
    idOrdenViejo,
  );
  if (orden === null) {
    // Orden no migrada (fuera de ventana u origen inválido): al bucket agregado, no una incidencia
    // por fila (con ventana activa serían miles).
    ctx.bucketOrden.registrar(`IdCorte=${idCorte} IdOrdenes=${idOrdenViejo}`);
    return { estado: 'omitido', celdas: 0 };
  }

  // Despivote del detalle.
  const dets = ctx.detPorCorte.get(idCorte) ?? [];
  const celdas: CeldaDetalle[] = [];
  for (const d of dets) {
    const idDet = (d.IdOrdenesDet ?? '').trim();
    const renglon = ctx.mapaOrdenesDet.get(idDet);
    if (renglon === undefined) {
      reporte.agregar(
        'Detalle de corte sin renglón OrdenesDet (omitido el renglón)',
        `IdCorte=${idCorte} IdOrdenesDet=${idDet}`,
      );
      continue;
    }
    celdas.push(
      ...despivotarDetalle(
        reporte,
        'Corte',
        idDet,
        orden,
        renglon,
        leerCantidadesTC(d),
        ctx.mapaColorF1,
      ),
    );
  }

  if (celdas.length === 0) {
    // Sin celdas resolubles (todo 0 o todo sin match): igual se crea la cabecera vacía sería inválida;
    // mejor OMITIR y listar (un corte sin piezas no aporta). Se reporta solo si tenía detalle.
    if (dets.length > 0) {
      reporte.agregar(
        'Corte sin celdas resolubles (OMITIDO)',
        `IdCorte=${idCorte} IdOrdenes=${idOrdenViejo} dets=${String(dets.length)}`,
      );
    } else {
      reporte.agregar('Corte sin detalle (OMITIDO)', `IdCorte=${idCorte}`);
    }
    return { estado: 'omitido', celdas: 0 };
  }

  const fecha = parsearFechaSoloDia(f.Fecha);
  if (fecha === null) {
    reporte.agregar(
      'Corte sin fecha parseable (OMITIDO)',
      `IdCorte=${idCorte} Fecha="${f.Fecha ?? ''}"`,
    );
    return { estado: 'omitido', celdas: 0 };
  }

  const creado = await intentarCrear(reporte, 'Corte', idCorte, () =>
    crearCorteMigrado(
      sesion,
      {
        idEmpresa: orden.idEmpresa,
        idOrden: orden.idOrden,
        claveVieja: `IdCorte=${idCorte}`,
        idTercero: resolverTercero(f.IdCortadores, ctx.mapaCortador),
        fecha,
        observaciones: parsearTexto(f.Observaciones),
        celdas,
      },
      bd,
    ),
  );
  if (creado === null) {
    return { estado: 'omitidoValidacion', celdas: 0 };
  }
  await guardarMapeo(cliente, ENTIDAD_MAPEO.etapaCorte, idCorte, creado.idEtapa);
  return { estado: 'creado', celdas: creado.celdas };
}
