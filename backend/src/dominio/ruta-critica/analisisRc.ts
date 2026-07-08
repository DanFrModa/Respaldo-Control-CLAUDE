/**
 * Tablero de gestión "ANÁLISIS RC" — de CAPTURAR a ANALIZAR (rediseño R7; doc `REDISENO-FRONTEND.md`
 * §4.10; brecha B14; D11). Reúne, TODO agregado EN EL SERVIDOR (A1; SQL/dominio, jamás pivoteando en
 * el cliente — pecado del viejo, lección F5-E7):
 *
 *  • SALUD de las órdenes — KPIs (activas / a tiempo / en riesgo / atrasadas / % cumplimiento) + el
 *    triage "órdenes que requieren atención" (atrasadas + en riesgo, ordenadas por urgencia, con la
 *    etapa atorada y su responsable). Reusa el SEMÁFORO puro de `semaforoYRiesgo` (ADR-0013).
 *  • ENTREGA al cliente + TIEMPO DE CICLO — % a tiempo (últimas 4 semanas) con tendencia semanal +
 *    ciclo OP→entrega promedio con tendencia. Reusa la VISTA MATERIALIZADA `kpi_entregas_a_tiempo`
 *    de F7-E3 (mismo criterio de "a tiempo": último proceso, `fecha_real <= fecha_planeada_vigente`).
 *  • ALERTAS PREDICTIVAS — órdenes que HOY se ven a tiempo pero cuyo COLCHÓN PROYECTADO (CPM forward
 *    pass, `cpm.proyectarColchonForward`) es negativo → van a atrasarse (ADR-0016).
 *  • RIESGO POR CLIENTE — activas / en riesgo / atrasadas por cliente con semáforo.
 *  • CUELLOS DE BOTELLA — vencidos + para hoy por `ProcesoDef` (problema sistémico, no de personas).
 *  • DESEMPEÑO del equipo (scoring + bono) — endpoint aparte (`desempenoRc`), gate `rc.programar`:
 *    por persona, sobre `RutaOrden.capturadoPorId/capturadoEn` (D11) + fechas planeadas.
 *
 * Gates: el tablero exige `rc.ruta-ver`; el desempeño exige `rc.programar` (management, el MISMO
 * permiso que ver pendientes ajenos en la bandeja). CERO permisos nuevos → deploy sin `SEED_ON_START`.
 */
import type {
  AnalisisRc,
  BadgeDesempeno,
  CuelloProceso,
  DesempenoRc,
  OrdenAlerta,
  OrdenAtencion,
  PersonaDesempeno,
  RiesgoCliente,
} from '../../contrato/index.js';
import { Prisma } from '../../datos/index.js';

import { verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import { clienteLectura, type ContextoBd } from '../../comun/transaccion.js';

import { cargarCalendarioLaboralSinSesion } from './calendarioLaboral.js';
import { proyectarColchonForward, type ProcesoForward } from './cpm.js';
import {
  estadoSemaforoProceso,
  UMBRAL_RIESGO_DIAS,
  type EstadoSemaforo,
} from './semaforoYRiesgo.js';

/** Cliente de LECTURA (sin transacción). */
type ClienteLectura = ReturnType<typeof clienteLectura>;

// ── Umbrales del scoring (CONFIGURABLES a futuro; hoy constantes con nombre claro) ─────────────────

/** Calificación mínima (0-100) para ganar el bono semanal (además de 0 vencidos). */
export const UMBRAL_BONO = 90;
/** Puntos que resta cada proceso vencido a la calificación (penalización). */
export const PENALIZACION_POR_VENCIDO = 5;
/** A partir de cuántos procesos activos a cargo se marca "sobrecarga" (para leer el score con contexto). */
export const SOBRECARGA_ACTIVOS = 15;
/** Colchón proyectado (días hábiles) por debajo del cual una orden a tiempo se marca como alerta. */
export const UMBRAL_COLCHON_ALERTA = 3;

const MS_DIA = 24 * 60 * 60 * 1000;

/** Trunca una fecha a medianoche UTC (solo el día calendario importa). */
function aMedianocheUtc(fecha: Date): Date {
  return new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate()));
}

/** Suma `n` días naturales a una fecha (UTC). */
function sumarDias(fecha: Date, n: number): Date {
  const d = aMedianocheUtc(fecha);
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}

/** Días naturales con signo de `hoy` a `fecha` (positivo = futuro/holgura, negativo = vencida). */
function diasNaturalesConSigno(hoy: Date, fecha: Date | null): number {
  if (fecha === null) return 0;
  return Math.round((aMedianocheUtc(fecha).getTime() - aMedianocheUtc(hoy).getTime()) / MS_DIA);
}

/** Semáforo de una orden a partir de sus banderas SQL. */
function semaforoOrden(hayAtrasado: boolean, hayEnRiesgo: boolean): EstadoSemaforo {
  if (hayAtrasado) return 'atrasado';
  if (hayEnRiesgo) return 'enRiesgo';
  return 'aTiempo';
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// AGREGADO POR ORDEN (Q1) — base de SALUD, RIESGO POR CLIENTE, TRIAGE y ALERTAS
// ══════════════════════════════════════════════════════════════════════════════════════════════

/** Un renglón del agregado por orden (una orden con la RC viva). */
interface AgregadoOrden {
  idOrden: number;
  folioOrden: number;
  idCliente: number;
  cliente: string;
  codigoModelo: string;
  descripcionModelo: string | null;
  fechaEntregaRC: Date | null;
  semaforo: EstadoSemaforo;
}

/** Expresiones SQL del semáforo por proceso (mismas reglas que `estadoSemaforoProceso`, ADR-0013). */
function expresionesSemaforo(hoy: Date): { atraso: Prisma.Sql; enRiesgo: Prisma.Sql } {
  const sinCumplir = Prisma.sql`r."fecha_real" IS NULL AND r."fecha_planeada_vigente" IS NOT NULL`;
  return {
    atraso: Prisma.sql`(${sinCumplir} AND r."fecha_planeada_vigente"::date < ${hoy}::date)`,
    enRiesgo: Prisma.sql`(${sinCumplir} AND r."fecha_planeada_vigente"::date >= ${hoy}::date AND (r."fecha_planeada_vigente"::date - ${hoy}::date) <= ${UMBRAL_RIESGO_DIAS})`,
  };
}

/** Carga el agregado por orden (todas las órdenes con RC viva de la empresa), semáforo derivado en SQL. */
async function cargarAgregadoOrdenes(
  cliente: ClienteLectura,
  idEmpresa: number,
  hoy: Date,
): Promise<AgregadoOrden[]> {
  const sem = expresionesSemaforo(hoy);
  const filas = await cliente.$queryRaw<
    {
      idOrden: number;
      folio: bigint;
      idCliente: number;
      cliente: string;
      codigoModelo: string;
      descripcionModelo: string | null;
      fechaEntregaRC: Date | null;
      hayAtrasado: boolean | null;
      hayEnRiesgo: boolean | null;
    }[]
  >(Prisma.sql`
    SELECT
      o."id"                                    AS "idOrden",
      o."folio"                                 AS "folio",
      o."id_cliente"                            AS "idCliente",
      c."nombre"                                AS "cliente",
      mo."codigo"                               AS "codigoModelo",
      mo."descripcion"                          AS "descripcionModelo",
      o."fecha_entrega_rc"                      AS "fechaEntregaRC",
      BOOL_OR(${sem.atraso})                    AS "hayAtrasado",
      BOOL_OR(${sem.enRiesgo})                  AS "hayEnRiesgo"
    FROM "ordenes" o
    JOIN "clientes" c  ON c."id"  = o."id_cliente"
    JOIN "modelos"  mo ON mo."id" = o."id_modelo"
    LEFT JOIN "ruta_orden" r ON r."id_orden" = o."id"
    WHERE o."id_empresa" = ${idEmpresa} AND o."rc_activa" = TRUE
    GROUP BY o."id", c."nombre", mo."codigo", mo."descripcion"
    ORDER BY o."folio" ASC
  `);
  return filas.map((f) => ({
    idOrden: f.idOrden,
    folioOrden: Number(f.folio),
    idCliente: f.idCliente,
    cliente: f.cliente,
    codigoModelo: f.codigoModelo,
    descripcionModelo: f.descripcionModelo,
    fechaEntregaRC: f.fechaEntregaRC,
    semaforo: semaforoOrden(f.hayAtrasado === true, f.hayEnRiesgo === true),
  }));
}

// ── Triage: etapa atorada + responsable por orden ──────────────────────────────────────────────────

/** Para las órdenes del triage, arma su fila con la etapa atorada (proceso más urgente) y responsable. */
async function armarTriage(
  cliente: ClienteLectura,
  agregados: AgregadoOrden[],
  hoy: Date,
): Promise<OrdenAtencion[]> {
  const enTriage = agregados.filter((o) => o.semaforo === 'atrasado' || o.semaforo === 'enRiesgo');
  if (enTriage.length === 0) return [];
  const porId = new Map(enTriage.map((o) => [o.idOrden, o]));

  // Procesos SIN cumplir de esas órdenes, con su proceso y sus roles responsables. El más urgente
  // (menor fecha planeada) es la "etapa atorada".
  const renglones = await cliente.rutaOrden.findMany({
    where: { idOrden: { in: [...porId.keys()] }, fechaReal: null },
    select: {
      idOrden: true,
      fechaPlaneadaVigente: true,
      procesoDef: {
        select: { nombre: true, roles: { select: { rol: { select: { nombre: true } } } } },
      },
    },
    // Orden DETERMINISTA: ante empate de fecha planeada, la etapa atorada mostrada no depende del
    // orden de retorno de la BD (menor secuencia, luego menor id). El `nulls: 'last'` deja los
    // procesos aún sin fechar al final (nunca "ganan" la etapa atorada frente a uno ya fechado).
    orderBy: [
      { fechaPlaneadaVigente: { sort: 'asc', nulls: 'last' } },
      { secuencia: 'asc' },
      { id: 'asc' },
    ],
  });

  // Por orden, el proceso sin cumplir con la fecha planeada MÁS TEMPRANA (nulls al final).
  const atoradaPorOrden = new Map<
    number,
    { planeada: Date | null; etapa: string; responsables: string[] }
  >();
  for (const r of renglones) {
    const actual = atoradaPorOrden.get(r.idOrden);
    const candidata = {
      planeada: r.fechaPlaneadaVigente,
      etapa: r.procesoDef.nombre,
      responsables: r.procesoDef.roles.map((x) => x.rol.nombre),
    };
    if (actual === undefined) {
      atoradaPorOrden.set(r.idOrden, candidata);
      continue;
    }
    // Preferir la fecha más temprana; una fecha real (no null) gana a un null.
    const mejor = compararPlaneada(candidata.planeada, actual.planeada) < 0;
    if (mejor) atoradaPorOrden.set(r.idOrden, candidata);
  }

  const filas: OrdenAtencion[] = enTriage.map((o) => {
    const atorada = atoradaPorOrden.get(o.idOrden);
    const responsables = atorada ? [...new Set(atorada.responsables)] : [];
    return {
      idOrden: o.idOrden,
      folioOrden: o.folioOrden,
      cliente: o.cliente,
      codigoModelo: o.codigoModelo,
      descripcionModelo: o.descripcionModelo,
      etapaAtorada: atorada?.etapa ?? null,
      responsable: responsables.length > 0 ? responsables.join(', ') : null,
      semaforo: o.semaforo,
      holguraDias: diasNaturalesConSigno(hoy, atorada?.planeada ?? o.fechaEntregaRC),
      fechaEntregaRC: o.fechaEntregaRC === null ? null : o.fechaEntregaRC.toISOString(),
    };
  });

  // Orden por urgencia: menor holgura primero (más vencida), luego folio.
  filas.sort((a, b) => a.holguraDias - b.holguraDias || a.folioOrden - b.folioOrden);
  return filas;
}

/** Compara dos fechas planeadas (null = la más tardía). <0 si `a` es más temprana que `b`. */
function compararPlaneada(a: Date | null, b: Date | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a.getTime() - b.getTime();
}

// ── Riesgo por cliente ─────────────────────────────────────────────────────────────────────────────

/** Agrega el riesgo por cliente a partir del agregado por orden. */
function agruparRiesgoCliente(agregados: AgregadoOrden[]): RiesgoCliente[] {
  const porCliente = new Map<
    number,
    { cliente: string; activas: number; enRiesgo: number; atrasadas: number }
  >();
  for (const o of agregados) {
    const g = porCliente.get(o.idCliente) ?? {
      cliente: o.cliente,
      activas: 0,
      enRiesgo: 0,
      atrasadas: 0,
    };
    g.activas += 1;
    if (o.semaforo === 'atrasado') g.atrasadas += 1;
    else if (o.semaforo === 'enRiesgo') g.enRiesgo += 1;
    porCliente.set(o.idCliente, g);
  }
  const filas: RiesgoCliente[] = [...porCliente.entries()].map(([idCliente, g]) => ({
    idCliente,
    cliente: g.cliente,
    activas: g.activas,
    enRiesgo: g.enRiesgo,
    atrasadas: g.atrasadas,
    semaforo: g.atrasadas > 0 ? 'crit' : g.enRiesgo > 0 ? 'warn' : 'ok',
  }));
  filas.sort(
    (a, b) =>
      b.atrasadas - a.atrasadas ||
      b.enRiesgo - a.enRiesgo ||
      b.activas - a.activas ||
      a.cliente.localeCompare(b.cliente),
  );
  return filas;
}

// ── Alertas predictivas (CPM forward pass) ─────────────────────────────────────────────────────────

/** Corre el forward pass sobre las órdenes a tiempo y devuelve las de colchón proyectado bajo el umbral. */
async function calcularAlertas(
  cliente: ClienteLectura,
  idEmpresa: number,
  agregados: AgregadoOrden[],
  hoy: Date,
  bd?: ContextoBd,
): Promise<OrdenAlerta[]> {
  // Solo las que HOY se ven a tiempo y tienen fecha de entrega (sin fecha no hay contra qué proyectar).
  const candidatas = agregados.filter((o) => o.semaforo === 'aTiempo' && o.fechaEntregaRC !== null);
  if (candidatas.length === 0) return [];
  const idsOrden = candidatas.map((o) => o.idOrden);
  const porId = new Map(candidatas.map((o) => [o.idOrden, o]));

  const [renglones, dependencias, calendario] = await Promise.all([
    cliente.rutaOrden.findMany({
      where: { idOrden: { in: idsOrden } },
      select: { id: true, idOrden: true, duracionDias: true, fechaReal: true },
    }),
    cliente.rutaOrdenDep.findMany({
      where: { rutaOrden: { idOrden: { in: idsOrden } } },
      select: { idRutaOrden: true, idAntecesor: true },
    }),
    cargarCalendarioLaboralSinSesion(idEmpresa, bd),
  ]);

  // Antecesores por renglón de ruta.
  const antecesoresPorRuta = new Map<number, number[]>();
  for (const d of dependencias) {
    const lista = antecesoresPorRuta.get(d.idRutaOrden) ?? [];
    lista.push(d.idAntecesor);
    antecesoresPorRuta.set(d.idRutaOrden, lista);
  }

  // Procesos (forward) por orden.
  const procesosPorOrden = new Map<number, ProcesoForward[]>();
  for (const r of renglones) {
    const lista = procesosPorOrden.get(r.idOrden) ?? [];
    lista.push({
      id: r.id,
      duracionDias: r.duracionDias,
      idsAntecesores: antecesoresPorRuta.get(r.id) ?? [],
      completado: r.fechaReal !== null,
    });
    procesosPorOrden.set(r.idOrden, lista);
  }

  const alertas: OrdenAlerta[] = [];
  for (const o of candidatas) {
    const procesos = procesosPorOrden.get(o.idOrden) ?? [];
    if (procesos.length === 0 || o.fechaEntregaRC === null) continue;
    const proyeccion = proyectarColchonForward(procesos, hoy, o.fechaEntregaRC, calendario);
    if (proyeccion.colchonDias >= UMBRAL_COLCHON_ALERTA) continue; // hay holgura: no es alerta.
    const orden = porId.get(o.idOrden);
    if (orden === undefined) continue;
    alertas.push({
      idOrden: orden.idOrden,
      folioOrden: orden.folioOrden,
      cliente: orden.cliente,
      codigoModelo: orden.codigoModelo,
      descripcionModelo: orden.descripcionModelo,
      procesosRestantes: proyeccion.procesosRestantes,
      colchonDias: proyeccion.colchonDias,
      fechaEntregaRC: orden.fechaEntregaRC === null ? null : orden.fechaEntregaRC.toISOString(),
    });
  }
  // Menor colchón primero (el más urgente), luego folio.
  alertas.sort((a, b) => a.colchonDias - b.colchonDias || a.folioOrden - b.folioOrden);
  return alertas;
}

// ── Cuellos de botella por proceso ─────────────────────────────────────────────────────────────────

/** Agrega los procesos ACTIVOS (la frontera de la ruta) por `ProcesoDef`: vencidos / hoy / total. */
async function calcularCuellos(
  cliente: ClienteLectura,
  idEmpresa: number,
  hoy: Date,
): Promise<CuelloProceso[]> {
  const filas = await cliente.$queryRaw<
    {
      idProcesoDef: number;
      codigoProceso: string;
      nombreProceso: string;
      vencidos: bigint;
      hoy: bigint;
      total: bigint;
    }[]
  >(Prisma.sql`
    SELECT
      r."id_proceso_def"  AS "idProcesoDef",
      pd."codigo"         AS "codigoProceso",
      pd."nombre"         AS "nombreProceso",
      COUNT(*) FILTER (
        WHERE r."fecha_planeada_vigente" IS NOT NULL AND r."fecha_planeada_vigente"::date < ${hoy}::date
      ) AS "vencidos",
      COUNT(*) FILTER (
        WHERE r."fecha_planeada_vigente" IS NOT NULL AND r."fecha_planeada_vigente"::date = ${hoy}::date
      ) AS "hoy",
      COUNT(*) AS "total"
    FROM "ruta_orden" r
    JOIN "ordenes" o     ON o."id"  = r."id_orden"
    JOIN "proceso_def" pd ON pd."id" = r."id_proceso_def"
    WHERE o."id_empresa" = ${idEmpresa}
      AND o."rc_activa" = TRUE
      AND r."estado"::text = 'activo'
    GROUP BY r."id_proceso_def", pd."codigo", pd."nombre"
    HAVING COUNT(*) > 0
    ORDER BY "vencidos" DESC, "hoy" DESC, "total" DESC, r."id_proceso_def" ASC
  `);
  return filas.map((f) => ({
    idProcesoDef: f.idProcesoDef,
    codigoProceso: f.codigoProceso,
    nombreProceso: f.nombreProceso,
    vencidos: Number(f.vencidos),
    hoy: Number(f.hoy),
    total: Number(f.total),
  }));
}

// ── Entrega al cliente + tiempo de ciclo (vista materializada F7-E3) ────────────────────────────────

/** Lunes (UTC) de la semana de `fecha` (semana ISO: lunes = inicio, como `date_trunc('week')`). */
function lunesDeSemana(fecha: Date): Date {
  const d = aMedianocheUtc(fecha);
  const dow = d.getUTCDay(); // 0 = domingo … 6 = sábado
  const desplazar = dow === 0 ? -6 : 1 - dow; // al lunes de esta semana
  return sumarDias(d, desplazar);
}

/** Calcula on-time delivery (4 semanas) + tiempo de ciclo OP→entrega + tendencias. */
async function calcularEntregaCiclo(
  cliente: ClienteLectura,
  idEmpresa: number,
  hoy: Date,
): Promise<AnalisisRc['entregaCiclo']> {
  const lunesEsta = lunesDeSemana(hoy);
  const inicioVentana = sumarDias(lunesEsta, -21); // lunes de hace 3 semanas (4 semanas en total)

  // On-time por semana (últimas 4 semanas), desde la vista materializada de F7-E3.
  const porSemana = await cliente.$queryRaw<
    { semana: Date; medibles: bigint; aTiempo: bigint }[]
  >(Prisma.sql`
    SELECT
      date_trunc('week', e."fecha_real")::date AS "semana",
      COUNT(*) FILTER (
        WHERE e."fecha_real" IS NOT NULL AND e."fecha_planeada_vigente" IS NOT NULL
      ) AS "medibles",
      COUNT(*) FILTER (WHERE e."a_tiempo") AS "aTiempo"
    FROM "kpi_entregas_a_tiempo" e
    WHERE e."id_empresa" = ${idEmpresa}
      AND e."fecha_real" >= ${inicioVentana}::date
      AND e."fecha_real" <= ${hoy}::date
    GROUP BY 1
    ORDER BY 1 ASC
  `);

  // Mapea a 4 huecos semanales (lunes → {medibles, aTiempo}); las semanas sin datos quedan en 0.
  const claveSemana = (d: Date): string => aMedianocheUtc(d).toISOString().slice(0, 10);
  const porClave = new Map(
    porSemana.map((s) => [
      claveSemana(s.semana),
      { medibles: Number(s.medibles), aTiempo: Number(s.aTiempo) },
    ]),
  );
  const tendenciaSemanas: number[] = [];
  let totalMedibles = 0;
  let totalATiempo = 0;
  for (let i = 3; i >= 0; i -= 1) {
    const lunes = sumarDias(lunesEsta, -7 * i);
    const datos = porClave.get(claveSemana(lunes)) ?? { medibles: 0, aTiempo: 0 };
    tendenciaSemanas.push(
      datos.medibles > 0 ? Math.round((datos.aTiempo / datos.medibles) * 100) : 0,
    );
    totalMedibles += datos.medibles;
    totalATiempo += datos.aTiempo;
  }
  const onTimePct = totalMedibles > 0 ? Math.round((totalATiempo / totalMedibles) * 100) : null;

  // Tiempo de ciclo OP→entrega (días naturales) en la ventana actual (4 sem) vs la previa (4 sem).
  const inicioPrevia = sumarDias(inicioVentana, -28);
  const [ciclo] = await cliente.$queryRaw<
    { cicloActual: number | null; cicloPrevio: number | null }[]
  >(Prisma.sql`
    SELECT
      (AVG(e."fecha_real"::date - o."fecha") FILTER (
        WHERE e."fecha_real" >= ${inicioVentana}::date
      ))::float8 AS "cicloActual",
      (AVG(e."fecha_real"::date - o."fecha") FILTER (
        WHERE e."fecha_real" >= ${inicioPrevia}::date AND e."fecha_real" < ${inicioVentana}::date
      ))::float8 AS "cicloPrevio"
    FROM "kpi_entregas_a_tiempo" e
    JOIN "ordenes" o ON o."id" = e."id_orden"
    WHERE e."id_empresa" = ${idEmpresa}
      AND e."completado" = TRUE
      AND o."fecha" IS NOT NULL
      AND e."fecha_real" >= ${inicioPrevia}::date
      AND e."fecha_real" <= ${hoy}::date
  `);
  const cicloActual = ciclo?.cicloActual ?? null;
  const cicloPrevio = ciclo?.cicloPrevio ?? null;
  const cicloPromedioDias = cicloActual === null ? null : Math.round(cicloActual);
  const cicloTendenciaDias =
    cicloActual === null || cicloPrevio === null ? null : Math.round(cicloActual - cicloPrevio);

  const refresco = await cliente.kpiRefresco.findFirst({
    where: { clave: 'global' },
    select: { refrescadoEn: true },
  });

  return {
    onTimePct,
    onTimeATiempo: totalATiempo,
    onTimeMedibles: totalMedibles,
    tendenciaSemanas,
    cicloPromedioDias,
    cicloTendenciaDias,
    datosAl: refresco === null ? null : refresco.refrescadoEn.toISOString(),
  };
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// TABLERO (gate rc.ruta-ver)
// ══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Tablero de gestión "Análisis RC" (empresa activa, A9): salud + entrega/ciclo + alertas predictivas
 * + riesgo por cliente + cuellos. Lectura; exige `rc.ruta-ver`. Todo agregado en el servidor (A1).
 */
export async function analisisRc(
  sesion: SesionUsuario,
  bd?: ContextoBd,
  ahora: Date = new Date(),
): Promise<AnalisisRc> {
  verificarPermiso(sesion, 'rc.ruta-ver');
  const cliente = clienteLectura(bd);
  const idEmpresa = sesion.idEmpresaActiva;
  const hoy = aMedianocheUtc(ahora);

  const agregados = await cargarAgregadoOrdenes(cliente, idEmpresa, hoy);

  const aTiempo = agregados.filter((o) => o.semaforo === 'aTiempo').length;
  const enRiesgo = agregados.filter((o) => o.semaforo === 'enRiesgo').length;
  const atrasadas = agregados.filter((o) => o.semaforo === 'atrasado').length;
  const ordenesActivas = agregados.length;

  const [atencion, alertas, cuellos, entregaCiclo] = await Promise.all([
    armarTriage(cliente, agregados, hoy),
    calcularAlertas(cliente, idEmpresa, agregados, hoy, bd),
    calcularCuellos(cliente, idEmpresa, hoy),
    calcularEntregaCiclo(cliente, idEmpresa, hoy),
  ]);

  return {
    salud: {
      ordenesActivas,
      aTiempo,
      enRiesgo,
      atrasadas,
      cumplimiento: ordenesActivas > 0 ? Math.round((aTiempo / ordenesActivas) * 100) : null,
      atencion,
    },
    entregaCiclo,
    alertas,
    riesgoCliente: agruparRiesgoCliente(agregados),
    cuellos,
  };
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// DESEMPEÑO DEL EQUIPO — scoring + bono (gate rc.programar)
// ══════════════════════════════════════════════════════════════════════════════════════════════

/** Badge cualitativo a partir de la calificación 0-100. PURO. */
export function badgeDeCalificacion(calificacion: number): BadgeDesempeno {
  if (calificacion >= 90) return 'excelente';
  if (calificacion >= 75) return 'bien';
  if (calificacion >= 60) return 'regular';
  return 'bajo';
}

/**
 * CALIFICACIÓN 0-100 de una persona = % en tiempo − penalización por vencidos (acotada a [0,100]).
 * `null` si no hay base (sin capturas medibles → no se puede calificar). PURO y testeable.
 *
 * @param fraccionOnTime fracción [0,1] de procesos entregados en tiempo, o null si no hay capturas.
 * @param vencidos       procesos a su cargo vencidos AHORA.
 */
export function calcularCalificacion(
  fraccionOnTime: number | null,
  vencidos: number,
): number | null {
  if (fraccionOnTime === null) return null;
  return Math.max(
    0,
    Math.min(100, Math.round(fraccionOnTime * 100 - PENALIZACION_POR_VENCIDO * vencidos)),
  );
}

/** ¿Gana el BONO semanal? Calificación ≥ umbral Y 0 vencidos. PURO. */
export function ganaBono(calificacion: number | null, vencidos: number): boolean {
  return calificacion !== null && calificacion >= UMBRAL_BONO && vencidos === 0;
}

/** Acumulador por persona mientras se agregan las capturas históricas. */
interface AcumCapturas {
  medibles: number;
  aTiempo: number;
  reaccionSuma: number;
  reaccionN: number;
  medThisWeek: number;
  aTiempoThisWeek: number;
  medLastWeek: number;
  aTiempoLastWeek: number;
}

function acumVacio(): AcumCapturas {
  return {
    medibles: 0,
    aTiempo: 0,
    reaccionSuma: 0,
    reaccionN: 0,
    medThisWeek: 0,
    aTiempoThisWeek: 0,
    medLastWeek: 0,
    aTiempoLastWeek: 0,
  };
}

/**
 * Desempeño del equipo de la RC (empresa activa, A9). Por persona: procesos a cargo (activos),
 * vencidos ahora, % en tiempo histórico, reacción (h promedio desde que el proceso cae en su cancha),
 * tendencia vs la semana pasada, calificación 0-100, bono y sobrecarga. Lectura; exige `rc.programar`
 * (management — el MISMO gate que ver pendientes ajenos en la bandeja). Fuente: `RutaOrden.
 * capturadoPorId/capturadoEn` (D11) + fechas planeadas.
 */
export async function desempenoRc(
  sesion: SesionUsuario,
  bd?: ContextoBd,
  ahora: Date = new Date(),
): Promise<DesempenoRc> {
  verificarPermiso(sesion, 'rc.programar');
  const cliente = clienteLectura(bd);
  const idEmpresa = sesion.idEmpresaActiva;
  const hoy = aMedianocheUtc(ahora);

  // ── Población: usuarios activos con algún rol responsable de procesos activos (el equipo de la RC).
  const usuarios = await cliente.usuario.findMany({
    where: {
      activo: true,
      roles: { some: { rol: { procesos: { some: { procesoDef: { activo: true } } } } } },
    },
    select: {
      id: true,
      nombre: true,
      roles: { select: { rol: { select: { id: true, nombre: true } } } },
    },
    orderBy: [{ nombre: 'asc' }, { id: 'asc' }],
  });

  const rolesPorUsuario = new Map<string, number[]>();
  const areaPorUsuario = new Map<string, string>();
  const nombrePorUsuario = new Map<string, string>();
  const usuariosPorRol = new Map<number, string[]>();
  for (const u of usuarios) {
    const rolIds = u.roles.map((r) => r.rol.id);
    rolesPorUsuario.set(u.id, rolIds);
    nombrePorUsuario.set(u.id, u.nombre);
    areaPorUsuario.set(u.id, [...new Set(u.roles.map((r) => r.rol.nombre))].join(', ') || '—');
    for (const idRol of rolIds) {
      const lista = usuariosPorRol.get(idRol) ?? [];
      lista.push(u.id);
      usuariosPorRol.set(idRol, lista);
    }
  }

  // ── A cargo + vencidos: procesos ACTIVOS de la empresa mapeados a los usuarios responsables.
  const activas = await cliente.rutaOrden.findMany({
    where: { estado: 'activo', orden: { idEmpresa, rcActiva: true } },
    select: { idProcesoDef: true, fechaPlaneadaVigente: true, fechaReal: true },
  });
  const idsProcDef = [...new Set(activas.map((a) => a.idProcesoDef))];
  const rolesPorProceso = new Map<number, number[]>();
  if (idsProcDef.length > 0) {
    const puentes = await cliente.procesoDefRol.findMany({
      where: { idProcesoDef: { in: idsProcDef } },
      select: { idProcesoDef: true, idRol: true },
    });
    for (const p of puentes) {
      const lista = rolesPorProceso.get(p.idProcesoDef) ?? [];
      lista.push(p.idRol);
      rolesPorProceso.set(p.idProcesoDef, lista);
    }
  }

  const activosPorUsuario = new Map<string, number>();
  const vencidosPorUsuario = new Map<string, number>();
  for (const tarea of activas) {
    const semaforo = estadoSemaforoProceso(
      { fechaPlaneadaVigente: tarea.fechaPlaneadaVigente, fechaReal: tarea.fechaReal },
      hoy,
    );
    // Usuarios responsables de esta tarea (unión de los roles del proceso; deduplicado por tarea).
    const responsables = new Set<string>();
    for (const idRol of rolesPorProceso.get(tarea.idProcesoDef) ?? []) {
      for (const idUsuario of usuariosPorRol.get(idRol) ?? []) responsables.add(idUsuario);
    }
    for (const idUsuario of responsables) {
      activosPorUsuario.set(idUsuario, (activosPorUsuario.get(idUsuario) ?? 0) + 1);
      if (semaforo === 'atrasado') {
        vencidosPorUsuario.set(idUsuario, (vencidosPorUsuario.get(idUsuario) ?? 0) + 1);
      }
    }
  }

  // ── Capturas históricas: % en tiempo, reacción y tendencia (por capturadoPorId).
  const capturasPorUsuario = new Map<string, AcumCapturas>();
  const idsUsuario = usuarios.map((u) => u.id);
  if (idsUsuario.length > 0) {
    const inicioEstaSemana = sumarDias(hoy, -7);
    const inicioSemanaPasada = sumarDias(hoy, -14);
    const capturas = await cliente.$queryRaw<
      {
        usuarioId: string;
        fechaReal: Date;
        planeada: Date | null;
        capturadoEn: Date | null;
        maxAntecesorCapturadoEn: Date | null;
      }[]
    >(Prisma.sql`
      SELECT
        r."capturado_por_id" AS "usuarioId",
        r."fecha_real"       AS "fechaReal",
        r."fecha_planeada_vigente" AS "planeada",
        r."capturado_en"     AS "capturadoEn",
        (
          SELECT MAX(a."capturado_en")
          FROM "ruta_orden_dep" d
          JOIN "ruta_orden" a ON a."id" = d."id_antecesor"
          WHERE d."id_ruta_orden" = r."id"
        ) AS "maxAntecesorCapturadoEn"
      FROM "ruta_orden" r
      JOIN "ordenes" o ON o."id" = r."id_orden"
      WHERE o."id_empresa" = ${idEmpresa}
        AND r."capturado_por_id" IS NOT NULL
        AND r."fecha_real" IS NOT NULL
        AND r."capturado_por_id" IN (${Prisma.join(idsUsuario)})
    `);
    for (const c of capturas) {
      const acum = capturasPorUsuario.get(c.usuarioId) ?? acumVacio();
      if (c.planeada !== null) {
        acum.medibles += 1;
        const aTiempo =
          aMedianocheUtc(c.fechaReal).getTime() <= aMedianocheUtc(c.planeada).getTime();
        if (aTiempo) acum.aTiempo += 1;
        // Ventanas de tendencia (por cuándo se capturó).
        if (c.capturadoEn !== null) {
          const cap = c.capturadoEn.getTime();
          if (cap >= inicioEstaSemana.getTime()) {
            acum.medThisWeek += 1;
            if (aTiempo) acum.aTiempoThisWeek += 1;
          } else if (cap >= inicioSemanaPasada.getTime()) {
            acum.medLastWeek += 1;
            if (aTiempo) acum.aTiempoLastWeek += 1;
          }
        }
      }
      // Reacción: horas desde que el proceso quedó listo (fin del antecesor más tardío) a su captura.
      if (c.capturadoEn !== null && c.maxAntecesorCapturadoEn !== null) {
        const horas =
          (c.capturadoEn.getTime() - c.maxAntecesorCapturadoEn.getTime()) / (1000 * 60 * 60);
        acum.reaccionSuma += Math.max(0, horas);
        acum.reaccionN += 1;
      }
      capturasPorUsuario.set(c.usuarioId, acum);
    }
  }

  // ── Ensamble por persona.
  const personas: PersonaDesempeno[] = usuarios.map((u) => {
    const activos = activosPorUsuario.get(u.id) ?? 0;
    const vencidos = vencidosPorUsuario.get(u.id) ?? 0;
    const cap = capturasPorUsuario.get(u.id);

    const fraccionOnTime = cap && cap.medibles > 0 ? cap.aTiempo / cap.medibles : null;
    const onTimePct = fraccionOnTime === null ? null : Math.round(fraccionOnTime * 100);
    const reaccionHoras =
      cap && cap.reaccionN > 0 ? Math.round((cap.reaccionSuma / cap.reaccionN) * 10) / 10 : null;

    let tendencia: number | null = null;
    if (cap && cap.medThisWeek > 0 && cap.medLastWeek > 0) {
      const pctThis = cap.aTiempoThisWeek / cap.medThisWeek;
      const pctLast = cap.aTiempoLastWeek / cap.medLastWeek;
      tendencia = Math.round((pctThis - pctLast) * 100);
    }

    const calificacion = calcularCalificacion(fraccionOnTime, vencidos);
    const badge = calificacion === null ? null : badgeDeCalificacion(calificacion);
    const bono = ganaBono(calificacion, vencidos);

    return {
      idUsuario: u.id,
      nombre: nombrePorUsuario.get(u.id) ?? u.nombre,
      area: areaPorUsuario.get(u.id) ?? '—',
      activos,
      vencidos,
      onTimePct,
      reaccionHoras,
      tendencia,
      calificacion,
      badge,
      bono,
      sobrecarga: activos >= SOBRECARGA_ACTIVOS,
    };
  });

  // Orden: mejor calificación primero (null al final), luego % en tiempo, luego nombre.
  personas.sort((a, b) => {
    const ca = a.calificacion ?? -1;
    const cb = b.calificacion ?? -1;
    if (ca !== cb) return cb - ca;
    const pa = a.onTimePct ?? -1;
    const pb = b.onTimePct ?? -1;
    if (pa !== pb) return pb - pa;
    return a.nombre.localeCompare(b.nombre);
  });

  return {
    personas,
    conBono: personas.filter((p) => p.bono).length,
    parametros: {
      umbralBono: UMBRAL_BONO,
      penalizacionPorVencido: PENALIZACION_POR_VENCIDO,
      sobrecargaActivos: SOBRECARGA_ACTIVOS,
    },
  };
}
