/**
 * CONCENTRADO "planeado vs real" de la RUTA CRÍTICA — F5-E7 (doc `08-Ruta-Critica.md` §2.4; D10/D11;
 * A1/A4/A9). Reemplaza la vista gerencial `RC_ConcentradoDif` (la pantalla MÁS PESADA del sistema
 * viejo, 2,061 líneas): todas las órdenes con la RC viva × sus procesos, con SEMÁFORO y DÍAS DE
 * ATRASO por proceso y por orden.
 *
 * El pecado del viejo era PIVOTEAR en el cliente; aquí la agregación se hace EN EL SERVIDOR con SQL
 * CRUDO (`$queryRaw`, sin vista de BD → SIN migración), en dos consultas acotadas a la página:
 *
 *  1. {@link agregadosPorOrden} — UN renglón por orden (RC viva de la empresa, A9), con su MÁXIMO
 *     atraso y su PEOR semáforo derivados EN SQL (CASE/MAX), aplicando los filtros opcionales
 *     (cliente / proceso / responsable, estos dos por EXISTS para "la orden que TIENE ese proceso/
 *     rol", sin perder los demás procesos de la fila). De aquí salen el conteo total, el `resumen`
 *     por semáforo y el ORDEN + paginación (todo en SQL: por retraso, cliente o fecha).
 *  2. {@link procesosDeOrdenes} — los procesos (celdas) SOLO de las órdenes de la página, en una
 *     consulta; se agrupan en memoria a su fila. El semáforo/atraso por proceso se RE-DERIVA con las
 *     MISMAS funciones puras de la bandeja/E4 (`estadoSemaforoProceso`, `diasAtrasoProceso`) para que
 *     el detalle cuadre exactamente con el agregado.
 *
 * "HOY" se calcula a medianoche UTC (como el resto de la RC, ADR-0013) y se inyecta en el SQL como
 * parámetro, así el agregado y el detalle comparan contra la MISMA fecha. El `UMBRAL_RIESGO_DIAS` (3)
 * gobierna el "en riesgo" tanto en SQL como en memoria.
 *
 * Esta misma agregación alimenta el export a Excel (mismo resultado que el tablero) — ver
 * `impresos/excel-concentrado.ts`.
 */
import { z } from 'zod';

import type {
  ConcentradoFila,
  ConcentradoPagina,
  ConcentradoProceso,
} from '../../contrato/index.js';
import { Prisma } from '../../datos/index.js';

import { armarPagina, rangoPrisma, type Paginacion } from '../../comun/paginacion.js';
import { verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import { clienteLectura, type ContextoBd } from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';

import { diasAtrasoProceso } from './bandeja.js';
import {
  estadoSemaforoProceso,
  UMBRAL_RIESGO_DIAS,
  type EstadoSemaforo,
} from './semaforoYRiesgo.js';

/** Trunca un `Date` a medianoche UTC (solo el día calendario importa para el semáforo/atraso). */
function aMedianocheUtc(fecha: Date): Date {
  return new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate()));
}

/**
 * Esquema de los filtros del concentrado EN DOMINIO (tipos ya nativos: `boolean`/`number`), distinto
 * del de la URL (`esquemaConcentradoQuery`, con `z.coerce`/`z.stringbool`). La ruta coacciona la
 * querystring y pasa AQUÍ el valor nativo; los tests llaman con valores nativos. Re-validar
 * `stringbool` sobre un booleano ya coaccionado lanzaría (Zod 4.4.x) → 400 espurio; por eso el
 * dominio tiene su propio esquema con `z.boolean()` (mismo patrón que la bandeja / WIP).
 */
const esquemaConcentradoDominio = z.object({
  pagina: z.number().int().min(1).default(1),
  porPagina: z.number().int().min(1).max(100).default(20),
  busquedaCliente: z.string().trim().max(200).optional(),
  idProcesoDef: z.number().int().positive().optional(),
  idRolResponsable: z.number().int().positive().optional(),
  orden: z.enum(['retraso', 'cliente', 'fecha']).default('retraso'),
  descendente: z.boolean().default(false),
});

/**
 * Parámetros que acepta `consultarConcentrado` (forma NATIVA del dominio, no la de la URL: la ruta
 * coacciona la querystring y pasa el valor nativo). Es el `input` del esquema de dominio, así
 * `descendente` es `boolean` (lo que produce `z.stringbool()` de la URL).
 */
export type ParametrosConcentrado = z.input<typeof esquemaConcentradoDominio>;

/** Filtros ya validados (forma de dominio). */
type FiltrosConcentrado = z.output<typeof esquemaConcentradoDominio>;

/** Cliente de LECTURA (sin transacción) — el tipo del resultado de `clienteLectura`. */
type ClienteLectura = ReturnType<typeof clienteLectura>;

/** Un renglón del agregado por orden (lo que devuelve la query 1). */
interface AgregadoOrden {
  idOrden: number;
  folioOrden: number;
  cliente: string;
  idModelo: number;
  codigoModelo: string;
  descripcionModelo: string | null;
  fechaEntregaRC: Date | null;
  fechaInicioRC: Date | null;
  esResurtido: boolean;
  /** Peor semáforo de la orden (derivado en SQL). */
  semaforo: EstadoSemaforo;
  maxDiasAtraso: number;
  procesosPendientes: number;
}

/**
 * Arma las condiciones `WHERE` (sobre `Orden o`) comunes a todas las consultas del concentrado:
 * empresa activa (A9) + RC viva (`rcActiva`) + filtros opcionales. Los filtros por proceso/rol son
 * EXISTS sobre la ruta viva de la orden (la orden que TIENE ese proceso, o algún proceso del rol),
 * para no perder el resto de procesos de la fila al detallarla. `hoy` se usa solo en el SELECT, no
 * aquí.
 */
function condicionesOrden(idEmpresa: number, filtros: FiltrosConcentrado): Prisma.Sql {
  const cond: Prisma.Sql[] = [
    Prisma.sql`o."id_empresa" = ${idEmpresa}`,
    Prisma.sql`o."rc_activa" = TRUE`,
  ];
  if (filtros.busquedaCliente !== undefined && filtros.busquedaCliente !== '') {
    cond.push(Prisma.sql`c."nombre" ILIKE ${'%' + filtros.busquedaCliente + '%'}`);
  }
  if (filtros.idProcesoDef !== undefined) {
    cond.push(
      Prisma.sql`EXISTS (
        SELECT 1 FROM "ruta_orden" rp
        WHERE rp."id_orden" = o."id" AND rp."id_proceso_def" = ${filtros.idProcesoDef}
      )`,
    );
  }
  if (filtros.idRolResponsable !== undefined) {
    cond.push(
      Prisma.sql`EXISTS (
        SELECT 1 FROM "ruta_orden" rp
        JOIN "proceso_def_rol" pdr ON pdr."id_proceso_def" = rp."id_proceso_def"
        WHERE rp."id_orden" = o."id" AND pdr."id_rol" = ${filtros.idRolResponsable}
      )`,
    );
  }
  return Prisma.join(cond, ' AND ');
}

/**
 * Expresión SQL (booleana por proceso) "el proceso está SIN cumplir y vencido" → atrasado, y
 * "sin cumplir y planeada dentro del umbral" → en riesgo. Reusa la MISMA regla que
 * `estadoSemaforoProceso` (ADR-0013), comparando contra `hoy` a medianoche UTC. Un proceso con
 * `fecha_real` o sin planeada NO cuenta como atrasado/en-riesgo (queda "a tiempo").
 */
function expresionesSemaforoSql(hoy: Date): {
  atraso: Prisma.Sql;
  enRiesgo: Prisma.Sql;
  pendiente: Prisma.Sql;
  diasAtraso: Prisma.Sql;
} {
  // `r` = alias de `ruta_orden` en la subconsulta agregada.
  const sinCumplir = Prisma.sql`r."fecha_real" IS NULL`;
  const conPlaneada = Prisma.sql`r."fecha_planeada_vigente" IS NOT NULL`;
  // Días vencidos = HOY - planeada (truncadas a día), acotado a >= 0.
  const diasAtraso = Prisma.sql`GREATEST(0, (${hoy}::date - r."fecha_planeada_vigente"::date))`;
  return {
    atraso: Prisma.sql`(${sinCumplir} AND ${conPlaneada} AND r."fecha_planeada_vigente"::date < ${hoy}::date)`,
    enRiesgo: Prisma.sql`(${sinCumplir} AND ${conPlaneada} AND r."fecha_planeada_vigente"::date >= ${hoy}::date AND (r."fecha_planeada_vigente"::date - ${hoy}::date) <= ${UMBRAL_RIESGO_DIAS})`,
    pendiente: sinCumplir,
    diasAtraso,
  };
}

/**
 * QUERY 1 — agregado POR ORDEN (peor semáforo + máximo atraso + procesos pendientes), con el filtro,
 * el orden y la paginación aplicados EN SQL. Devuelve también el total y el resumen por semáforo
 * (sobre TODO el filtro), en consultas separadas y acotadas (no trae procesos a memoria).
 */
async function agregadosPorOrden(
  cliente: ClienteLectura,
  idEmpresa: number,
  filtros: FiltrosConcentrado,
  hoy: Date,
): Promise<{
  filas: AgregadoOrden[];
  total: number;
  resumen: { atrasadas: number; enRiesgo: number; aTiempo: number };
}> {
  const where = condicionesOrden(idEmpresa, filtros);
  const sem = expresionesSemaforoSql(hoy);

  // Sub-select por orden con sus métricas derivadas (LEFT JOIN: una orden sin procesos sale en 0/a
  // tiempo). El semáforo de la orden es el PEOR de sus procesos: atrasado > en riesgo > a tiempo.
  const baseOrden = Prisma.sql`
    SELECT
      o."id"                                   AS "idOrden",
      o."folio"                                AS "folio",
      c."nombre"                               AS "cliente",
      o."id_modelo"                            AS "idModelo",
      mo."codigo"                              AS "codigoModelo",
      mo."descripcion"                         AS "descripcionModelo",
      o."fecha_entrega_rc"                     AS "fechaEntregaRC",
      o."fecha_inicio_rc"                      AS "fechaInicioRC",
      COALESCE(o."es_resurtido_rc", FALSE)     AS "esResurtido",
      COALESCE(MAX(${sem.diasAtraso}) FILTER (WHERE ${sem.atraso}), 0)         AS "maxDiasAtraso",
      COUNT(*) FILTER (WHERE ${sem.pendiente})                                 AS "procesosPendientes",
      BOOL_OR(${sem.atraso})                                                   AS "hayAtrasado",
      BOOL_OR(${sem.enRiesgo})                                                 AS "hayEnRiesgo"
    FROM "ordenes" o
    JOIN "clientes" c  ON c."id"  = o."id_cliente"
    JOIN "modelos"  mo ON mo."id" = o."id_modelo"
    LEFT JOIN "ruta_orden" r ON r."id_orden" = o."id"
    WHERE ${where}
    GROUP BY o."id", c."nombre", mo."codigo", mo."descripcion"
  `;

  // Orden EN SQL. "retraso" prioriza atrasadas y, dentro, el mayor atraso; el resto desempata por
  // fecha de entrega (más próxima primero) y folio. "cliente"/"fecha" ordenan por ese campo.
  const dir = filtros.descendente ? Prisma.sql`DESC` : Prisma.sql`ASC`;
  let orderBy: Prisma.Sql;
  if (filtros.orden === 'cliente') {
    orderBy = Prisma.sql`ORDER BY "cliente" ${dir}, "folio" ASC`;
  } else if (filtros.orden === 'fecha') {
    orderBy = Prisma.sql`ORDER BY "fechaEntregaRC" ${dir} NULLS LAST, "folio" ASC`;
  } else {
    // "retraso": peor semáforo primero (atrasado > en riesgo > a tiempo), luego mayor atraso. El
    // sentido lo invierte `descendente` (true → menos urgente primero).
    const sentidoRetraso = filtros.descendente ? Prisma.sql`ASC` : Prisma.sql`DESC`;
    orderBy = Prisma.sql`
      ORDER BY
        (CASE WHEN "hayAtrasado" THEN 2 WHEN "hayEnRiesgo" THEN 1 ELSE 0 END) ${sentidoRetraso},
        "maxDiasAtraso" ${sentidoRetraso},
        "fechaEntregaRC" ASC NULLS LAST,
        "folio" ASC
    `;
  }

  const paginacion: Paginacion = { pagina: filtros.pagina, porPagina: filtros.porPagina };
  const { skip, take } = rangoPrisma(paginacion);

  const filasCrudas = await cliente.$queryRaw<
    {
      idOrden: number;
      folio: bigint;
      cliente: string;
      idModelo: number;
      codigoModelo: string;
      descripcionModelo: string | null;
      fechaEntregaRC: Date | null;
      fechaInicioRC: Date | null;
      esResurtido: boolean;
      maxDiasAtraso: bigint | number;
      procesosPendientes: bigint | number;
      hayAtrasado: boolean | null;
      hayEnRiesgo: boolean | null;
    }[]
  >(Prisma.sql`
    WITH agregado AS (${baseOrden})
    SELECT * FROM agregado
    ${orderBy}
    LIMIT ${take} OFFSET ${skip}
  `);

  // Total y resumen por semáforo SOBRE TODO el filtro (no solo la página): una consulta agregada.
  const [conteo] = await cliente.$queryRaw<
    { total: bigint; atrasadas: bigint; enRiesgo: bigint; aTiempo: bigint }[]
  >(Prisma.sql`
    WITH agregado AS (${baseOrden})
    SELECT
      COUNT(*)                                                         AS "total",
      COUNT(*) FILTER (WHERE "hayAtrasado")                            AS "atrasadas",
      COUNT(*) FILTER (WHERE NOT "hayAtrasado" AND "hayEnRiesgo")      AS "enRiesgo",
      COUNT(*) FILTER (WHERE NOT "hayAtrasado" AND NOT "hayEnRiesgo")  AS "aTiempo"
    FROM agregado
  `);

  const filas: AgregadoOrden[] = filasCrudas.map((f) => ({
    idOrden: f.idOrden,
    folioOrden: Number(f.folio),
    cliente: f.cliente,
    idModelo: f.idModelo,
    codigoModelo: f.codigoModelo,
    descripcionModelo: f.descripcionModelo,
    fechaEntregaRC: f.fechaEntregaRC,
    fechaInicioRC: f.fechaInicioRC,
    esResurtido: f.esResurtido,
    semaforo: f.hayAtrasado === true ? 'atrasado' : f.hayEnRiesgo === true ? 'enRiesgo' : 'aTiempo',
    maxDiasAtraso: Number(f.maxDiasAtraso),
    procesosPendientes: Number(f.procesosPendientes),
  }));

  return {
    filas,
    total: Number(conteo?.total ?? 0),
    resumen: {
      atrasadas: Number(conteo?.atrasadas ?? 0),
      enRiesgo: Number(conteo?.enRiesgo ?? 0),
      aTiempo: Number(conteo?.aTiempo ?? 0),
    },
  };
}

/**
 * QUERY 2 — los procesos (celdas) de las órdenes de la PÁGINA, en una sola consulta. El
 * semáforo/atraso por proceso se DERIVA en memoria con las funciones puras de la bandeja/E4, contra
 * `hoy`, para que el detalle cuadre con el agregado. Devuelve `idOrden → procesos` (ordenados por
 * secuencia).
 */
async function procesosDeOrdenes(
  cliente: ClienteLectura,
  idsOrden: number[],
  hoy: Date,
): Promise<Map<number, ConcentradoProceso[]>> {
  const porOrden = new Map<number, ConcentradoProceso[]>();
  if (idsOrden.length === 0) return porOrden;

  const renglones = await cliente.rutaOrden.findMany({
    where: { idOrden: { in: idsOrden } },
    select: {
      idOrden: true,
      idProcesoDef: true,
      secuencia: true,
      critico: true,
      estado: true,
      fechaPlaneadaVigente: true,
      fechaReal: true,
      procesoDef: { select: { codigo: true, nombre: true } },
    },
    orderBy: [{ idOrden: 'asc' }, { secuencia: 'asc' }],
  });

  for (const r of renglones) {
    const semaforo = estadoSemaforoProceso(
      { fechaPlaneadaVigente: r.fechaPlaneadaVigente, fechaReal: r.fechaReal },
      hoy,
    );
    const proceso: ConcentradoProceso = {
      idProcesoDef: r.idProcesoDef,
      codigoProceso: r.procesoDef.codigo,
      nombreProceso: r.procesoDef.nombre,
      secuencia: r.secuencia,
      critico: r.critico,
      fechaPlaneadaVigente:
        r.fechaPlaneadaVigente === null ? null : r.fechaPlaneadaVigente.toISOString(),
      fechaReal: r.fechaReal === null ? null : r.fechaReal.toISOString(),
      estado: r.estado,
      diasAtraso: diasAtrasoProceso(r.fechaPlaneadaVigente, hoy),
      semaforo,
    };
    const lista = porOrden.get(r.idOrden) ?? [];
    lista.push(proceso);
    porOrden.set(r.idOrden, lista);
  }
  return porOrden;
}

/** Proyecta un agregado de orden + sus procesos a la fila de salida del contrato. */
function aFilaSalida(agregado: AgregadoOrden, procesos: ConcentradoProceso[]): ConcentradoFila {
  return {
    idOrden: agregado.idOrden,
    folioOrden: agregado.folioOrden,
    cliente: agregado.cliente,
    idModelo: agregado.idModelo,
    codigoModelo: agregado.codigoModelo,
    descripcionModelo: agregado.descripcionModelo,
    fechaEntregaRC: agregado.fechaEntregaRC === null ? null : agregado.fechaEntregaRC.toISOString(),
    fechaInicioRC: agregado.fechaInicioRC === null ? null : agregado.fechaInicioRC.toISOString(),
    esResurtido: agregado.esResurtido,
    semaforo: agregado.semaforo,
    maxDiasAtraso: agregado.maxDiasAtraso,
    procesosPendientes: agregado.procesosPendientes,
    procesos,
  };
}

/**
 * CONCENTRADO "planeado vs real" de la Ruta Crítica (empresa activa, A9). Todas las órdenes con la RC
 * viva × sus procesos, con semáforo y días de atraso por orden y por proceso; paginado, filtrable
 * (cliente / proceso / responsable) y ordenable (retraso / cliente / fecha). Lectura; exige
 * `rc.ruta-ver`. La agregación es EN EL SERVIDOR (SQL crudo) — nunca pivoteando en el cliente.
 */
export async function consultarConcentrado(
  sesion: SesionUsuario,
  parametros: ParametrosConcentrado = {},
  bd?: ContextoBd,
  ahora: Date = new Date(),
): Promise<ConcentradoPagina> {
  verificarPermiso(sesion, 'rc.ruta-ver');
  const filtros = validarEntrada(esquemaConcentradoDominio, parametros);
  const cliente = clienteLectura(bd);
  const hoy = aMedianocheUtc(ahora);

  const { filas, total, resumen } = await agregadosPorOrden(
    cliente,
    sesion.idEmpresaActiva,
    filtros,
    hoy,
  );

  const procesosPorOrden = await procesosDeOrdenes(
    cliente,
    filas.map((f) => f.idOrden),
    hoy,
  );

  const datos = filas.map((f) => aFilaSalida(f, procesosPorOrden.get(f.idOrden) ?? []));
  const paginacion: Paginacion = { pagina: filtros.pagina, porPagina: filtros.porPagina };
  return { ...armarPagina(datos, total, paginacion), resumen };
}
