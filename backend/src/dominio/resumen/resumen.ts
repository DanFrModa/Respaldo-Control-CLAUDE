/**
 * RESUMEN OPERATIVO de la portada `/` (rediseño R9, proto `vResumen`; D11 "tableros del negocio").
 * Es una CONSULTA de solo lectura que REÚNE los números de vistazo del negocio en una respuesta:
 * KPIs (órdenes abiertas, WIP en maquila, cortado esta semana, entregas a tiempo, existencia PT),
 * la tabla "órdenes por vencer" (semáforo RC, próximos 7 días) y la serie "cortes por semana".
 * Toda la lógica vive AQUÍ (A1); la ruta REST solo autoriza y delega.
 *
 * RBAC por BLOQUE (A4, patrón `contarAlertas`): cada bloque respeta el permiso de su dominio DUEÑO
 * — sin el permiso, el bloque sale `null` (el frontend oculta la tarjeta). El Resumen jamás enseña
 * un número que la sesión no podría ver en la pantalla dueña:
 *  • `produccion.wip-ver`  → órdenes abiertas, WIP en maquila, cortado esta semana, cortes/semana.
 *  • `indicadores.ver`     → % entregas a tiempo (vista `kpi_entregas_a_tiempo` de F7).
 *  • `inventario-pt.ver`   → existencia PT (vista `existencia_pt`, D3).
 *  • `rc.ruta-ver`         → órdenes por vencer (ruta viva + semáforo ADR-0013).
 *
 * Derivación SIEMPRE por suma de movimientos (D3/D4) y agregación EN SERVIDOR (nunca pivote en
 * cliente). REUSA los ladrillos existentes en vez de duplicar: `agregadoWip`/`pedidoPorOrden`
 * (dominio WIP), `semanaIso` (corte semanal), `estadoSemaforoOrden`/`estadoSemaforoProceso`
 * (ADR-0013) y las vistas `kpi_entregas_a_tiempo` (F7) y `existencia_pt` (F3). El conteo de
 * "órdenes abiertas" replica en UNA consulta SQL el criterio `tienePendiente` del tablero WIP
 * (misma fórmula que la vista `kpi_wip`, pero EN VIVO — la portada no espera el refresco del job).
 */
import type { OrdenPorVencer, ResumenOperativo } from '../../contrato/index.js';
import { Prisma } from '../../datos/index.js';

import { ErrorPermiso } from '../../comun/errores.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { clienteLectura, type ContextoBd } from '../../comun/transaccion.js';

import { semanaIso } from '../produccion/etapas.js';
import { agregadoWip, pedidoPorOrden } from '../produccion/wip.js';
import { estadoSemaforoOrden, estadoSemaforoProceso } from '../ruta-critica/semaforoYRiesgo.js';

/** Cliente de LECTURA (sin transacción) — el tipo del resultado de `clienteLectura`. */
type ClienteLectura = ReturnType<typeof clienteLectura>;

/** Ventana de la tabla "órdenes por vencer": compromisos dentro de los próximos 7 días. */
const DIAS_POR_VENCER = 7;

/** Tope de filas de "órdenes por vencer" (la portada es un vistazo, no un listado). */
const MAX_ORDENES_POR_VENCER = 8;

/** Semanas de la serie "cortes por semana" (7 barras: la actual y las 6 previas, como el proto). */
const SEMANAS_SERIE = 7;

/** Días de la ventana del % de entregas a tiempo ("RC · últimos 30 d"). */
const DIAS_ENTREGAS = 30;

/** Milisegundos de un día natural. */
const MS_DIA = 24 * 60 * 60 * 1000;

// ── Helpers PUROS (probados con fechas/datos a mano en resumen.test.ts) ───────────────────────────

/** Trunca una fecha a medianoche UTC (solo el día calendario importa, mismo criterio que bandeja). */
function aMedianocheUtc(fecha: Date): Date {
  return new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate()));
}

/** Días naturales (UTC) de `hoy` a `fecha` (negativo si ya pasó). */
function diasNaturalesDesde(hoy: Date, fecha: Date): number {
  return Math.round((aMedianocheUtc(fecha).getTime() - aMedianocheUtc(hoy).getTime()) / MS_DIA);
}

/** Etiqueta corta de una barra a partir de "2026-W05" → "S5" (sin cero a la izquierda, proto). */
export function etiquetaSemana(anioSemana: string): string {
  const num = Number(anioSemana.split('-W')[1] ?? '0');
  return `S${String(num)}`;
}

/**
 * Las últimas {@link SEMANAS_SERIE} semanas ISO (vieja→actual) respecto a `hoy`: clave, etiqueta y
 * lunes de arranque. Base de la serie de barras y del corte de la ventana de lectura. PURA.
 */
export function ventanaSemanas(
  hoy: Date,
): { anioSemana: string; etiqueta: string; inicioSemana: string }[] {
  const semanas: { anioSemana: string; etiqueta: string; inicioSemana: string }[] = [];
  for (let i = SEMANAS_SERIE - 1; i >= 0; i -= 1) {
    const fecha = new Date(aMedianocheUtc(hoy).getTime() - i * 7 * MS_DIA);
    const { anioSemana, inicioSemana } = semanaIso(fecha);
    semanas.push({ anioSemana, etiqueta: etiquetaSemana(anioSemana), inicioSemana });
  }
  return semanas;
}

/** Variación porcentual de `actual` vs `anterior` (1 decimal; null si `anterior` ≤ 0). PURA. */
export function deltaPorcentual(actual: number, anterior: number): number | null {
  if (anterior <= 0) return null;
  return Math.round(((actual - anterior) / anterior) * 1000) / 10;
}

/** Fila cruda de la ruta viva con lo mínimo para armar "órdenes por vencer". */
export interface FilaRutaPorVencer {
  idOrden: number;
  fechaPlaneadaVigente: Date | null;
  fechaReal: Date | null;
  orden: {
    folio: bigint;
    modelo: { codigo: string; descripcion: string | null };
    cliente: { nombre: string };
  };
}

/**
 * Agrupa las filas de la ruta viva POR ORDEN y arma las "órdenes por vencer": órdenes con procesos
 * pendientes cuyo PRÓXIMO compromiso (mín. `fechaPlaneadaVigente` pendiente) cae dentro de los
 * próximos {@link DIAS_POR_VENCER} días o YA venció. El semáforo es el de la ORDEN (el peor de sus
 * procesos, ADR-0013) y el avance es % de procesos cumplidos. Ordenadas por compromiso ascendente
 * (lo vencido primero), empate estable por folio. Sin `piezas` (las llena el llamador con
 * `pedidoPorOrden`). Las órdenes cuyos pendientes aún no tienen fecha (CPM sin correr) NO aparecen
 * (sin compromiso no hay contra qué apremiar). PURA: se prueba con datos a mano.
 */
export function armarOrdenesPorVencer(
  filas: readonly FilaRutaPorVencer[],
  hoy: Date,
): Omit<OrdenPorVencer, 'piezas'>[] {
  interface Grupo {
    filas: FilaRutaPorVencer[];
  }
  const porOrden = new Map<number, Grupo>();
  for (const fila of filas) {
    const grupo = porOrden.get(fila.idOrden) ?? { filas: [] };
    grupo.filas.push(fila);
    porOrden.set(fila.idOrden, grupo);
  }

  const resultado: Omit<OrdenPorVencer, 'piezas'>[] = [];
  for (const [idOrden, grupo] of porOrden) {
    const pendientes = grupo.filas.filter((f) => f.fechaReal === null);
    if (pendientes.length === 0) continue; // todo cumplido: nada por vencer.
    const fechadas = pendientes
      .map((f) => f.fechaPlaneadaVigente)
      .filter((f): f is Date => f !== null);
    if (fechadas.length === 0) continue; // pendientes sin fecha (CPM sin correr): sin compromiso.
    const compromiso = new Date(Math.min(...fechadas.map((f) => f.getTime())));
    if (diasNaturalesDesde(hoy, compromiso) > DIAS_POR_VENCER) continue;

    const primera = grupo.filas[0];
    if (primera === undefined) continue;
    const completados = grupo.filas.length - pendientes.length;
    resultado.push({
      idOrden,
      folio: Number(primera.orden.folio),
      codigoModelo: primera.orden.modelo.codigo,
      descripcionModelo: primera.orden.modelo.descripcion,
      cliente: primera.orden.cliente.nombre,
      avancePct: Math.round((completados / grupo.filas.length) * 100),
      compromiso: compromiso.toISOString(),
      semaforo: estadoSemaforoOrden(grupo.filas, hoy),
      etapasAtrasadas: pendientes.filter((f) => estadoSemaforoProceso(f, hoy) === 'atrasado')
        .length,
    });
  }

  return resultado
    .sort((a, b) => a.compromiso.localeCompare(b.compromiso) || a.folio - b.folio)
    .slice(0, MAX_ORDENES_POR_VENCER);
}

// ── Bloques con lectura (cada uno acotado a la empresa activa, A9) ────────────────────────────────

/**
 * Conteo EN VIVO de órdenes ABIERTAS: vivas (no canceladas) con ALGO pendiente en el pipeline —
 * el MISMO criterio `tienePendiente` del tablero WIP y de la vista `kpi_wip` (suma directa de
 * `etapa_movimiento_det`, D3/D4), en UNA consulta (LATERAL agrega por orden; nada viaja a memoria).
 */
async function contarOrdenesAbiertas(cliente: ClienteLectura, idEmpresa: number): Promise<number> {
  const [fila] = await cliente.$queryRaw<{ total: number }[]>(Prisma.sql`
    SELECT COUNT(*)::int AS "total"
    FROM "ordenes" o
    CROSS JOIN LATERAL (
      SELECT
        COALESCE((
          SELECT SUM(olt."cantidad")
          FROM "orden_linea_talla" olt
          JOIN "orden_linea" ol ON ol."id" = olt."id_orden_linea"
          WHERE ol."id_orden" = o."id"
        ), 0)::int AS "pedido",
        COALESCE(SUM(d."cantidad") FILTER (WHERE e."tipo" = 'corte'), 0)::int          AS "cortado",
        COALESCE(SUM(d."cantidad") FILTER (WHERE e."tipo" = 'envio_maquila'), 0)::int  AS "enviado",
        COALESCE(SUM(d."cantidad") FILTER (WHERE e."tipo" = 'recibo_maquila'), 0)::int AS "recibido",
        COALESCE(SUM(d."cantidad_incompletas") FILTER (
          WHERE e."tipo" = 'recibo_maquila'
        ), 0)::int AS "incompletas",
        COALESCE(SUM(d."cantidad") FILTER (
          WHERE e."tipo" = 'recibo_maquila' AND tp."genera_entrada_pt"
        ), 0)::int AS "recibido_costura",
        COALESCE(SUM(d."cantidad") FILTER (WHERE e."tipo" = 'entrega_cliente'), 0)::int AS "entregado"
      FROM "etapa_movimiento" e
      JOIN "etapa_movimiento_det" d ON d."id_etapa_mov" = e."id"
      LEFT JOIN "tipos_proceso" tp ON tp."id" = e."id_tipo_proceso"
      WHERE e."id_orden" = o."id" AND e."cancelado_en" IS NULL
    ) s
    WHERE o."id_empresa" = ${idEmpresa}
      AND o."estado" <> 'cancelada'
      AND (
        (s."pedido" - s."cortado") <> 0
        OR (s."cortado" - s."enviado") <> 0
        OR (s."enviado" - s."recibido" - s."incompletas") <> 0
        OR (s."recibido_costura" - s."entregado") <> 0
      )
  `);
  return fila?.total ?? 0;
}

/**
 * Maquileros con saldo ≠ 0 en su poder (Σ `enviado − buenas − incompletas` POR TERCERO, etapas vivas
 * de órdenes vivas — mismo universo que `agregadoWip`). El "en N maquileros" del pie de la tarjeta
 * WIP.
 *
 * ⭐ Las INCOMPLETAS restan (V1-E8v, §Post-F9.147): ya volvieron del taller, así que el maquilero
 * que entregó 95 buenas + 5 incompletas de 100 NO tiene saldo en su poder y no debe contarse aquí.
 * Es la misma regla de `pendientePorCelda` (`produccion/incompletas.ts`), en SQL porque esta cuenta
 * se hace entera en la base.
 */
async function contarMaquilerosConSaldo(
  cliente: ClienteLectura,
  idEmpresa: number,
): Promise<number> {
  const [fila] = await cliente.$queryRaw<{ total: number }[]>(Prisma.sql`
    SELECT COUNT(*)::int AS "total"
    FROM (
      SELECT e."id_tercero"
      FROM "etapa_movimiento" e
      JOIN "etapa_movimiento_det" d ON d."id_etapa_mov" = e."id"
      JOIN "ordenes" o ON o."id" = e."id_orden"
      WHERE e."id_empresa" = ${idEmpresa}
        AND e."cancelado_en" IS NULL
        AND e."id_tercero" IS NOT NULL
        AND e."tipo" IN ('envio_maquila', 'recibo_maquila')
        AND o."estado" <> 'cancelada'
      GROUP BY e."id_tercero"
      HAVING SUM(
        CASE
          WHEN e."tipo" = 'envio_maquila' THEN d."cantidad"
          ELSE -(d."cantidad" + COALESCE(d."cantidad_incompletas", 0))
        END
      ) <> 0
    ) saldos
  `);
  return fila?.total ?? 0;
}

/**
 * Piezas de cortes VIVOS por semana ISO (últimas {@link SEMANAS_SERIE}), leyendo las etapas de
 * corte desde el lunes de la semana más vieja y agrupando con `semanaIso` (misma definición que el
 * corte semanal por cortador). Alimenta la tarjeta "cortado esta semana" Y la serie de barras.
 */
async function cortesPorSemana(
  cliente: ClienteLectura,
  idEmpresa: number,
  hoy: Date,
): Promise<NonNullable<ResumenOperativo['cortesPorSemana']>> {
  const semanas = ventanaSemanas(hoy);
  const inicioVentana = semanas[0]?.inicioSemana;
  const cortes = await cliente.etapaMovimiento.findMany({
    where: {
      idEmpresa,
      tipo: 'corte',
      canceladoEn: null,
      ...(inicioVentana === undefined
        ? {}
        : { fecha: { gte: new Date(`${inicioVentana}T00:00:00.000Z`) } }),
    },
    select: { fecha: true, detalles: { select: { cantidad: true } } },
  });

  const porSemana = new Map<string, number>();
  for (const corte of cortes) {
    const { anioSemana } = semanaIso(corte.fecha);
    const total = corte.detalles.reduce((s, d) => s + d.cantidad, 0);
    porSemana.set(anioSemana, (porSemana.get(anioSemana) ?? 0) + total);
  }

  // Los 7 buckets SIEMPRE presentes (una semana sin cortes es una barra en 0, como el proto).
  return semanas.map((s) => ({
    anioSemana: s.anioSemana,
    etiqueta: s.etiqueta,
    piezas: porSemana.get(s.anioSemana) ?? 0,
  }));
}

/**
 * % de entregas a tiempo de los últimos {@link DIAS_ENTREGAS} días + delta en PUNTOS vs la ventana
 * previa, sobre la vista `kpi_entregas_a_tiempo` (F7: último proceso de la RC, mismo criterio
 * "medibles" que el tablero de Indicadores — la refresca el job `kpi-refrescar`).
 */
async function entregasATiempo30d(
  cliente: ClienteLectura,
  idEmpresa: number,
  hoy: Date,
): Promise<NonNullable<ResumenOperativo['entregasATiempo']>> {
  const desde = new Date(aMedianocheUtc(hoy).getTime() - DIAS_ENTREGAS * MS_DIA);
  const desdePrevio = new Date(desde.getTime() - DIAS_ENTREGAS * MS_DIA);
  const [fila] = await cliente.$queryRaw<
    { medibles: number; aTiempo: number; mediblesPrev: number; aTiempoPrev: number }[]
  >(Prisma.sql`
    SELECT
      (COUNT(*) FILTER (
        WHERE e."fecha_real" >= ${desde} AND e."fecha_planeada_vigente" IS NOT NULL
      ))::int AS "medibles",
      (COUNT(*) FILTER (WHERE e."fecha_real" >= ${desde} AND e."a_tiempo"))::int AS "aTiempo",
      (COUNT(*) FILTER (
        WHERE e."fecha_real" >= ${desdePrevio} AND e."fecha_real" < ${desde}
          AND e."fecha_planeada_vigente" IS NOT NULL
      ))::int AS "mediblesPrev",
      (COUNT(*) FILTER (
        WHERE e."fecha_real" >= ${desdePrevio} AND e."fecha_real" < ${desde} AND e."a_tiempo"
      ))::int AS "aTiempoPrev"
    FROM "kpi_entregas_a_tiempo" e
    WHERE e."id_empresa" = ${idEmpresa} AND e."fecha_real" IS NOT NULL
  `);

  const medibles = fila?.medibles ?? 0;
  const aTiempo = fila?.aTiempo ?? 0;
  const mediblesPrev = fila?.mediblesPrev ?? 0;
  const aTiempoPrev = fila?.aTiempoPrev ?? 0;
  const pct = medibles > 0 ? aTiempo / medibles : null;
  const pctPrev = mediblesPrev > 0 ? aTiempoPrev / mediblesPrev : null;
  return {
    porcentaje: pct === null ? null : Math.round(pct * 10000) / 10000,
    medibles,
    deltaPuntos: pct === null || pctPrev === null ? null : Math.round((pct - pctPrev) * 1000) / 10,
  };
}

/** Existencia TOTAL de PT + almacenes con existencia ≠ 0 (Σ de la vista `existencia_pt`, D3). */
async function existenciaPtTotal(
  cliente: ClienteLectura,
  idEmpresa: number,
): Promise<NonNullable<ResumenOperativo['existenciaPt']>> {
  const [fila] = await cliente.$queryRaw<{ piezas: number; almacenes: number }[]>(Prisma.sql`
    SELECT
      COALESCE(SUM(e."existencia"), 0)::int AS "piezas",
      (COUNT(DISTINCT e."id_almacen") FILTER (WHERE e."existencia" <> 0))::int AS "almacenes"
    FROM "existencia_pt" e
    WHERE e."id_empresa" = ${idEmpresa}
  `);
  return { piezas: fila?.piezas ?? 0, almacenes: fila?.almacenes ?? 0 };
}

/** Órdenes por vencer: lee la ruta viva de la empresa y delega en el armado puro + piezas. */
async function ordenesPorVencer(
  cliente: ClienteLectura,
  idEmpresa: number,
  hoy: Date,
): Promise<OrdenPorVencer[]> {
  const filas = await cliente.rutaOrden.findMany({
    where: { orden: { idEmpresa, rcActiva: true, estado: { not: 'cancelada' } } },
    select: {
      idOrden: true,
      fechaPlaneadaVigente: true,
      fechaReal: true,
      orden: {
        select: {
          folio: true,
          modelo: { select: { codigo: true, descripcion: true } },
          cliente: { select: { nombre: true } },
        },
      },
    },
  });
  const sinPiezas = armarOrdenesPorVencer(filas, hoy);
  const piezas = await pedidoPorOrden(
    cliente,
    sinPiezas.map((o) => o.idOrden),
  );
  return sinPiezas.map((o) => ({ ...o, piezas: piezas.get(o.idOrden) ?? 0 }));
}

// ── Consulta principal ────────────────────────────────────────────────────────────────────────────

/**
 * RESUMEN OPERATIVO de la empresa activa (A9). Exige tener AL MENOS UN permiso de los bloques
 * (deny-by-default, A4); cada bloque se calcula SOLO si la sesión tiene el permiso de su dominio
 * dueño (si no, sale `null` y el frontend oculta la tarjeta). `ahora` es inyectable en pruebas.
 */
export async function resumenOperativo(
  sesion: SesionUsuario,
  bd?: ContextoBd,
  ahora: Date = new Date(),
): Promise<ResumenOperativo> {
  const puedeWip = sesion.permisos.has('produccion.wip-ver');
  const puedeIndicadores = sesion.permisos.has('indicadores.ver');
  const puedePt = sesion.permisos.has('inventario-pt.ver');
  const puedeRc = sesion.permisos.has('rc.ruta-ver');
  if (!puedeWip && !puedeIndicadores && !puedePt && !puedeRc) {
    throw new ErrorPermiso();
  }

  const cliente = clienteLectura(bd);
  const idEmpresa = sesion.idEmpresaActiva;
  // Universo del WIP: órdenes vivas de la empresa (mismo default que el tablero de F3-E5).
  const whereOrdenesVivas = { idEmpresa, estado: { not: 'cancelada' as const } };

  const [abiertas, wip, maquileros, serieCortes, entregas, existencia, porVencer] =
    await Promise.all([
      puedeWip ? contarOrdenesAbiertas(cliente, idEmpresa) : null,
      puedeWip ? agregadoWip(cliente, whereOrdenesVivas) : null,
      puedeWip ? contarMaquilerosConSaldo(cliente, idEmpresa) : null,
      puedeWip ? cortesPorSemana(cliente, idEmpresa, ahora) : null,
      puedeIndicadores ? entregasATiempo30d(cliente, idEmpresa, ahora) : null,
      puedePt ? existenciaPtTotal(cliente, idEmpresa) : null,
      puedeRc ? ordenesPorVencer(cliente, idEmpresa, ahora) : null,
    ]);

  // "Cortado esta semana": el último bucket de la serie es la semana ACTUAL; el penúltimo, la
  // anterior (misma agregación → la tendencia es derivable sin otra consulta).
  const actual = serieCortes?.[serieCortes.length - 1]?.piezas ?? 0;
  const anterior = serieCortes?.[serieCortes.length - 2]?.piezas ?? 0;

  return {
    ordenesAbiertas: abiertas === null ? null : { total: abiertas },
    wipMaquila: wip === null ? null : { piezas: wip.porRecibir, maquileros: maquileros ?? 0 },
    cortadoSemana:
      serieCortes === null
        ? null
        : {
            piezas: actual,
            piezasSemanaAnterior: anterior,
            deltaPct: deltaPorcentual(actual, anterior),
          },
    entregasATiempo: entregas,
    existenciaPt: existencia,
    ordenesPorVencer: porVencer,
    cortesPorSemana: serieCortes,
  };
}
