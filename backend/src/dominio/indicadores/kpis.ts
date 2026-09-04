/**
 * TABLEROS DIRECTIVOS de indicadores (Módulo Indicadores, F7-E3; plan §11; doc `08-Ruta-Critica.md`
 * §4.4 / `09-Control-de-Calidad.md` §5.3 / MEJORAS 03-WIP; D11). Toda la lógica vive AQUÍ (A1); las
 * rutas REST solo validan permiso + Zod y delegan. Son CONSULTAS de solo lectura sobre las VISTAS
 * MATERIALIZADAS (`kpi_*`) que refresca el job `kpi-refrescar` (ver `comun/jobs/refrescar-kpis.ts`):
 * la CAPTURA nunca espera un recálculo. Cada respuesta trae `datosAl` (sello de `KpiRefresco`) para
 * mostrar "datos al: <fecha/hora>".
 *
 * Innegociables:
 *  • A1 — la lógica vive en este módulo; las rutas son delgadas.
 *  • A4 — toda consulta re-verifica `indicadores.ver` (deny-by-default).
 *  • A9 — todo se filtra por la empresa ACTIVA de la sesión (las vistas llevan `id_empresa` por fila).
 *  • Agregación SIEMPRE en el servidor (SQL), NUNCA pivoteando en el cliente (pecado del viejo).
 *
 * ⚠️ ALCANCE de los filtros (documentado por diseño de las vistas pre-agregadas del plan §11):
 *  • Ruta Crítica: la vista `kpi_entregas_a_tiempo` es POR ORDEN → el % a tiempo y la tendencia
 *    honran TODOS los filtros (periodo/cliente/maquilero/proceso). Las vistas `kpi_lead_time_proceso`
 *    / `kpi_cuellos_botella` ya vienen agregadas POR PROCESO (sin periodo/cliente/maquilero) → honran
 *    empresa (A9) + proceso; `kpi_desempeno_responsable` viene agregada POR RESPONSABLE → honra
 *    empresa (A9). Si a futuro se requiere cortar esos KPIs por periodo/cliente, se re-modela la vista.
 *  • Calidad: `kpi_calidad_maquilero` lleva (año, mes) → honra periodo + maquilero. `kpi_defecto_
 *    maquilero` NO lleva periodo → los defectos top honran empresa + maquilero (no periodo).
 */
import { z } from 'zod';

import type { KpisRc, KpisCalidad, KpisWip, RefrescoEncolado } from '../../contrato/index.js';
import { Prisma } from '../../datos/index.js';

import { COLAS_JOBS, encolarJob } from '../../comun/jobs/index.js';
import { verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import { clienteLectura, type ContextoBd } from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';

/** Cliente de LECTURA (sin transacción) — el tipo del resultado de `clienteLectura`. */
type ClienteLectura = ReturnType<typeof clienteLectura>;

/** Redondeo de fracciones (porcentajes) a 4 decimales. */
function frac(numerador: number, denominador: number): number | null {
  if (denominador <= 0) return null;
  return Math.round((numerador / denominador) * 10000) / 10000;
}

/** Lee el sello "datos al:" (última actualización de las vistas) o null si nunca se refrescaron. */
async function leerDatosAl(cliente: ClienteLectura): Promise<string | null> {
  const fila = await cliente.kpiRefresco.findFirst({
    where: { clave: 'global' },
    select: { refrescadoEn: true },
  });
  return fila === null ? null : fila.refrescadoEn.toISOString();
}

// ── Tablero 1 · KPIs de Ruta Crítica (D11) ────────────────────────────────────────────────────────

/** Filtros del tablero de RC en DOMINIO (tipos nativos; la ruta coacciona la URL y pasa el valor). */
const esquemaRcDominio = z.object({
  anio: z.number().int().min(2000).max(2100).optional(),
  mes: z.number().int().min(1).max(12).optional(),
  idCliente: z.number().int().positive().optional(),
  idMaquilero: z.number().int().positive().optional(),
  idProcesoDef: z.number().int().positive().optional(),
});

/** Parámetros que acepta {@link kpisRutaCritica} (forma nativa, no la de la URL). */
export type ParametrosKpisRc = z.input<typeof esquemaRcDominio>;

/** Condiciones sobre `kpi_entregas_a_tiempo` (alias `e`): empresa + periodo/cliente/maquilero/proceso. */
function condicionesEntregas(
  idEmpresa: number,
  filtros: z.infer<typeof esquemaRcDominio>,
): Prisma.Sql {
  const cond: Prisma.Sql[] = [Prisma.sql`e."id_empresa" = ${idEmpresa}`];
  if (filtros.anio !== undefined) {
    cond.push(Prisma.sql`EXTRACT(YEAR FROM e."fecha_real") = ${filtros.anio}`);
  }
  if (filtros.mes !== undefined) {
    cond.push(Prisma.sql`EXTRACT(MONTH FROM e."fecha_real") = ${filtros.mes}`);
  }
  if (filtros.idCliente !== undefined) {
    cond.push(Prisma.sql`e."id_cliente" = ${filtros.idCliente}`);
  }
  if (filtros.idMaquilero !== undefined) {
    cond.push(Prisma.sql`e."id_maquilero" = ${filtros.idMaquilero}`);
  }
  if (filtros.idProcesoDef !== undefined) {
    cond.push(Prisma.sql`e."id_proceso_def" = ${filtros.idProcesoDef}`);
  }
  return Prisma.join(cond, ' AND ');
}

/**
 * Tablero de KPIs de la Ruta Crítica (empresa activa, A9): % de entregas a tiempo (último proceso,
 * D2 #7), lead time por proceso (real vs estimado), cuellos de botella (atraso medio), desempeño por
 * responsable (quien capturó) y tendencia mensual del % a tiempo. Todo agregado en SQL. `indicadores.ver`.
 *
 * Denominador del % a tiempo: SOLO las órdenes MEDIBLES = último proceso cumplido (`fecha_real` ≠ null)
 * Y con `fecha_planeada_vigente` ≠ null. Las completadas SIN plan (`completadasSinPlan`) NO son medibles
 * (no hay contra qué compararlas) → se EXCLUYEN del denominador para no sesgar el % hacia abajo; se
 * exponen aparte como dato informativo. Así `% = aTiempo ÷ medibles` (no ÷ completadas).
 */
export async function kpisRutaCritica(
  sesion: SesionUsuario,
  parametros: ParametrosKpisRc = {},
  bd?: ContextoBd,
): Promise<KpisRc> {
  verificarPermiso(sesion, 'indicadores.ver');
  const filtros = validarEntrada(esquemaRcDominio, parametros);
  const cliente = clienteLectura(bd);
  const idEmpresa = sesion.idEmpresaActiva;
  const whereEntregas = condicionesEntregas(idEmpresa, filtros);
  const fProceso =
    filtros.idProcesoDef === undefined
      ? Prisma.empty
      : Prisma.sql`AND v."id_proceso_def" = ${filtros.idProcesoDef}`;

  // `medibles` = completadas CON plan (real ≠ null Y planeada ≠ null): es el denominador del %. Las
  // completadas sin plan (no medibles) quedan fuera del %; se derivan como `completadas − medibles`.
  const [entregas] = await cliente.$queryRaw<
    { completadas: number; medibles: number; aTiempo: number }[]
  >(Prisma.sql`
    SELECT
      (COUNT(*) FILTER (WHERE e."completado"))::int AS "completadas",
      (COUNT(*) FILTER (
        WHERE e."fecha_real" IS NOT NULL AND e."fecha_planeada_vigente" IS NOT NULL
      ))::int                                       AS "medibles",
      (COUNT(*) FILTER (WHERE e."a_tiempo"))::int   AS "aTiempo"
    FROM "kpi_entregas_a_tiempo" e
    WHERE ${whereEntregas}
  `);

  const leadTime = await cliente.$queryRaw<
    {
      idProcesoDef: number;
      codigoProceso: string;
      nombreProceso: string;
      numProcesos: number;
      diasRealesProm: number | null;
      diasEstimadoProm: number | null;
    }[]
  >(Prisma.sql`
    SELECT
      v."id_proceso_def"     AS "idProcesoDef",
      pd."codigo"            AS "codigoProceso",
      pd."nombre"            AS "nombreProceso",
      v."num_procesos"       AS "numProcesos",
      v."dias_reales_prom"   AS "diasRealesProm",
      v."dias_estimado_prom" AS "diasEstimadoProm"
    FROM "kpi_lead_time_proceso" v
    JOIN "proceso_def" pd ON pd."id" = v."id_proceso_def"
    WHERE v."id_empresa" = ${idEmpresa} ${fProceso}
    ORDER BY pd."nombre" ASC
  `);

  const cuellosBotella = await cliente.$queryRaw<
    {
      idProcesoDef: number;
      codigoProceso: string;
      nombreProceso: string;
      numProcesos: number;
      atrasoMedioDias: number | null;
    }[]
  >(Prisma.sql`
    SELECT
      v."id_proceso_def"    AS "idProcesoDef",
      pd."codigo"           AS "codigoProceso",
      pd."nombre"           AS "nombreProceso",
      v."num_procesos"      AS "numProcesos",
      v."atraso_medio_dias" AS "atrasoMedioDias"
    FROM "kpi_cuellos_botella" v
    JOIN "proceso_def" pd ON pd."id" = v."id_proceso_def"
    WHERE v."id_empresa" = ${idEmpresa} ${fProceso}
    ORDER BY v."atraso_medio_dias" DESC NULLS LAST
  `);

  const desempenoCrudo = await cliente.$queryRaw<
    { responsableId: string; responsable: string; numProcesos: number; aTiempo: number }[]
  >(Prisma.sql`
    SELECT
      v."capturado_por_id"                    AS "responsableId",
      COALESCE(u."nombre", v."capturado_por_id") AS "responsable",
      v."num_procesos"                        AS "numProcesos",
      v."a_tiempo"                            AS "aTiempo"
    FROM "kpi_desempeno_responsable" v
    LEFT JOIN "usuarios" u ON u."id" = v."capturado_por_id"
    WHERE v."id_empresa" = ${idEmpresa}
    ORDER BY v."num_procesos" DESC
  `);

  const tendenciaCruda = await cliente.$queryRaw<
    { anio: number; mes: number; completadas: number; aTiempo: number }[]
  >(Prisma.sql`
    SELECT
      EXTRACT(YEAR FROM e."fecha_real")::int  AS "anio",
      EXTRACT(MONTH FROM e."fecha_real")::int AS "mes",
      (COUNT(*) FILTER (WHERE e."completado"))::int AS "completadas",
      (COUNT(*) FILTER (WHERE e."a_tiempo"))::int   AS "aTiempo"
    FROM "kpi_entregas_a_tiempo" e
    WHERE ${whereEntregas} AND e."fecha_real" IS NOT NULL
    GROUP BY 1, 2
    ORDER BY 1 ASC, 2 ASC
  `);

  const completadas = entregas?.completadas ?? 0;
  const medibles = entregas?.medibles ?? 0;
  const aTiempo = entregas?.aTiempo ?? 0;
  const completadasSinPlan = completadas - medibles;

  return {
    datosAl: await leerDatosAl(cliente),
    entregasATiempo: {
      completadas,
      medibles,
      completadasSinPlan,
      aTiempo,
      porcentaje: frac(aTiempo, medibles),
    },
    leadTime,
    cuellosBotella,
    desempeno: desempenoCrudo.map((d) => ({
      responsableId: d.responsableId,
      responsable: d.responsable,
      numProcesos: d.numProcesos,
      aTiempo: d.aTiempo,
      porcentaje: frac(d.aTiempo, d.numProcesos),
    })),
    tendencia: tendenciaCruda.map((t) => ({
      anio: t.anio,
      mes: t.mes,
      completadas: t.completadas,
      aTiempo: t.aTiempo,
      porcentaje: frac(t.aTiempo, t.completadas),
    })),
  };
}

// ── Tablero 2 · Calidad por maquilero (F6) ────────────────────────────────────────────────────────

/** Filtros del tablero de calidad en DOMINIO (tipos nativos). `idMaquilero` 0 = "sin maquilero". */
const esquemaCalidadDominio = z.object({
  anio: z.number().int().min(2000).max(2100).optional(),
  mes: z.number().int().min(1).max(12).optional(),
  idMaquilero: z.number().int().min(0).optional(),
});

/** Parámetros que acepta {@link kpisCalidadMaquilero} (forma nativa). */
export type ParametrosKpisCalidad = z.input<typeof esquemaCalidadDominio>;

/** Condiciones sobre `kpi_calidad_maquilero` (alias `cm`): empresa + periodo/maquilero. */
function condicionesCalidad(
  idEmpresa: number,
  filtros: z.infer<typeof esquemaCalidadDominio>,
): Prisma.Sql {
  const cond: Prisma.Sql[] = [Prisma.sql`cm."id_empresa" = ${idEmpresa}`];
  if (filtros.anio !== undefined) cond.push(Prisma.sql`cm."anio" = ${filtros.anio}`);
  if (filtros.mes !== undefined) cond.push(Prisma.sql`cm."mes" = ${filtros.mes}`);
  if (filtros.idMaquilero !== undefined)
    cond.push(Prisma.sql`cm."id_maquilero" = ${filtros.idMaquilero}`);
  return Prisma.join(cond, ' AND ');
}

/**
 * Tablero de CALIDAD por maquilero (empresa activa, A9): % de aprobación por maquilero, defectos más
 * frecuentes y tendencia mensual de aprobación. Desde las auditorías VIVAS (cancelada=false). Todo
 * agregado en SQL. `indicadores.ver`.
 */
export async function kpisCalidadMaquilero(
  sesion: SesionUsuario,
  parametros: ParametrosKpisCalidad = {},
  bd?: ContextoBd,
): Promise<KpisCalidad> {
  verificarPermiso(sesion, 'indicadores.ver');
  const filtros = validarEntrada(esquemaCalidadDominio, parametros);
  const cliente = clienteLectura(bd);
  const idEmpresa = sesion.idEmpresaActiva;
  const whereCalidad = condicionesCalidad(idEmpresa, filtros);

  const maquilerosCrudo = await cliente.$queryRaw<
    {
      idMaquilero: number;
      maquilero: string;
      numAuditorias: number;
      aprobadas: number;
      calificadas: number;
    }[]
  >(Prisma.sql`
    SELECT
      cm."id_maquilero"                          AS "idMaquilero",
      COALESCE(p."nombre", 'Sin maquilero')      AS "maquilero",
      SUM(cm."num_auditorias")::int              AS "numAuditorias",
      SUM(cm."aprobadas")::int                   AS "aprobadas",
      SUM(cm."calificadas")::int                 AS "calificadas"
    FROM "kpi_calidad_maquilero" cm
    LEFT JOIN "proveedores" p ON p."id" = cm."id_maquilero"
    WHERE ${whereCalidad}
    GROUP BY cm."id_maquilero", p."nombre"
    ORDER BY SUM(cm."num_auditorias") DESC
  `);

  // Defectos top: la vista de defectos NO lleva periodo → honra empresa + maquilero (no periodo).
  const fMaquileroDef =
    filtros.idMaquilero === undefined
      ? Prisma.empty
      : Prisma.sql`AND dm."id_maquilero" = ${filtros.idMaquilero}`;
  const defectosTop = await cliente.$queryRaw<
    {
      idDefecto: number;
      clave: string;
      descripcion: string;
      totalFallas: number;
      numAuditorias: number;
    }[]
  >(Prisma.sql`
    SELECT
      dm."id_defecto"             AS "idDefecto",
      dc."clave"                  AS "clave",
      dc."descripcion"           AS "descripcion",
      SUM(dm."total_fallas")::int   AS "totalFallas",
      SUM(dm."num_auditorias")::int AS "numAuditorias"
    FROM "kpi_defecto_maquilero" dm
    JOIN "defectos_catalogo" dc ON dc."id" = dm."id_defecto"
    WHERE dm."id_empresa" = ${idEmpresa} ${fMaquileroDef}
    GROUP BY dm."id_defecto", dc."clave", dc."descripcion"
    HAVING SUM(dm."total_fallas") > 0
    ORDER BY SUM(dm."total_fallas") DESC
    LIMIT 10
  `);

  const tendenciaCruda = await cliente.$queryRaw<
    { anio: number; mes: number; numAuditorias: number; aprobadas: number; calificadas: number }[]
  >(Prisma.sql`
    SELECT
      cm."anio"                     AS "anio",
      cm."mes"                      AS "mes",
      SUM(cm."num_auditorias")::int AS "numAuditorias",
      SUM(cm."aprobadas")::int      AS "aprobadas",
      SUM(cm."calificadas")::int    AS "calificadas"
    FROM "kpi_calidad_maquilero" cm
    WHERE ${whereCalidad}
    GROUP BY cm."anio", cm."mes"
    ORDER BY cm."anio" ASC, cm."mes" ASC
  `);

  return {
    datosAl: await leerDatosAl(cliente),
    maquileros: maquilerosCrudo.map((m) => ({
      idMaquilero: m.idMaquilero,
      maquilero: m.maquilero,
      numAuditorias: m.numAuditorias,
      aprobadas: m.aprobadas,
      calificadas: m.calificadas,
      porcentaje: frac(m.aprobadas, m.calificadas),
    })),
    defectosTop,
    tendencia: tendenciaCruda.map((t) => ({
      anio: t.anio,
      mes: t.mes,
      numAuditorias: t.numAuditorias,
      aprobadas: t.aprobadas,
      calificadas: t.calificadas,
      porcentaje: frac(t.aprobadas, t.calificadas),
    })),
  };
}

// ── Tablero 3 · WIP analítico (F3) ────────────────────────────────────────────────────────────────

/** Filtros del tablero WIP en DOMINIO (tipos nativos; `soloPendientes` como boolean). */
const esquemaWipDominio = z.object({
  idCliente: z.number().int().positive().optional(),
  idModelo: z.number().int().positive().optional(),
  soloPendientes: z.boolean().default(false),
  pagina: z.number().int().min(1).default(1),
  porPagina: z.number().int().min(1).max(100).default(20),
});

/** Parámetros que acepta {@link kpisWip} (forma nativa, no la de la URL). */
export type ParametrosKpisWip = z.input<typeof esquemaWipDominio>;

/** Condiciones sobre `kpi_wip` (alias `w`): empresa + cliente/modelo + solo pendientes. */
function condicionesWip(idEmpresa: number, filtros: z.infer<typeof esquemaWipDominio>): Prisma.Sql {
  const cond: Prisma.Sql[] = [Prisma.sql`w."id_empresa" = ${idEmpresa}`];
  if (filtros.idCliente !== undefined) cond.push(Prisma.sql`w."id_cliente" = ${filtros.idCliente}`);
  if (filtros.idModelo !== undefined) cond.push(Prisma.sql`w."id_modelo" = ${filtros.idModelo}`);
  if (filtros.soloPendientes) {
    // "Con algo pendiente" = alguna diferencia por etapa ≠ 0 (mismo criterio que `tienePendiente`).
    // El "por recibir" RESTA las incompletas (V1-E8v, §Post-F9.147: la prenda incompleta ya volvió
    // del taller) **y los faltantes SALDADOS** (V1, fila 0.109: nunca volvieron y ya se decidió que
    // no vuelven). Sin las dos restas, esas órdenes se quedaban abiertas para siempre.
    //
    // 🔴 ESTE `WHERE` Y LAS DOS EXPRESIONES `porRecibir` DEL `SELECT` SON LA MISMA REGLA ESCRITA
    // TRES VECES, y la fila 0.109 lo demostró: se actualizaron las dos del SELECT y se olvidó ésta,
    // 60 líneas más arriba. El síntoma era una fila que se contradecía a sí misma — la orden salía
    // en el listado de `soloPendientes` con «Por recibir» = 0 en su propia columna. Al tocar una,
    // se tocan las tres (y su gemela de `resumen/resumen.ts::contarOrdenesAbiertas`).
    cond.push(Prisma.sql`(
      (w."pedido" - w."cortado") <> 0
      OR (w."cortado" - w."enviado") <> 0
      OR (w."enviado" - w."recibido" - w."incompletas" - w."faltantes_saldados") <> 0
      OR (w."recibido_costura" - w."entregado") <> 0
    )`);
  }
  return Prisma.join(cond, ' AND ');
}

/**
 * Tablero WIP analítico (empresa activa, A9): totales/pendientes AGREGADOS por etapa + la página de
 * órdenes con su avance. Mismo criterio de derivación que el tablero WIP de F3-E5 (suma directa de
 * `etapa_movimiento_det`, D3/D4), pre-calculado en la vista `kpi_wip`. `indicadores.ver`.
 *
 * ⭐ El "por recibir" resta las PRENDAS INCOMPLETAS (V1-E8v, §Post-F9.147, ya volvieron del taller)
 * y los FALTANTES SALDADOS al cerrar la orden con el maquilero (V1, fila 0.109: nunca volvieron y ya
 * se decidió que no vuelven). La vista trae las dos columnas —`incompletas` desde
 * `20260830120000_la_incompleta_sale_del_transito`, `faltantes_saldados` desde
 * `20260903180000_cerrar_la_orden_con_el_maquilero`— y el pendiente se deriva AL LEER, nunca se
 * materializa, para que la fórmula viva en un solo lugar.
 */
export async function kpisWip(
  sesion: SesionUsuario,
  parametros: ParametrosKpisWip = {},
  bd?: ContextoBd,
): Promise<KpisWip> {
  verificarPermiso(sesion, 'indicadores.ver');
  const filtros = validarEntrada(esquemaWipDominio, parametros);
  const cliente = clienteLectura(bd);
  const idEmpresa = sesion.idEmpresaActiva;
  const where = condicionesWip(idEmpresa, filtros);

  const [totales] = await cliente.$queryRaw<
    {
      pedido: number;
      cortado: number;
      enviado: number;
      recibido: number;
      incompletas: number;
      faltantesSaldados: number;
      recibidoCostura: number;
      entregado: number;
      porCortar: number;
      cortadoPorEnviar: number;
      porRecibir: number;
      porEntregar: number;
    }[]
  >(Prisma.sql`
    SELECT
      COALESCE(SUM(w."pedido"), 0)::int           AS "pedido",
      COALESCE(SUM(w."cortado"), 0)::int          AS "cortado",
      COALESCE(SUM(w."enviado"), 0)::int          AS "enviado",
      COALESCE(SUM(w."recibido"), 0)::int         AS "recibido",
      COALESCE(SUM(w."incompletas"), 0)::int      AS "incompletas",
      COALESCE(SUM(w."faltantes_saldados"), 0)::int AS "faltantesSaldados",
      COALESCE(SUM(w."recibido_costura"), 0)::int AS "recibidoCostura",
      COALESCE(SUM(w."entregado"), 0)::int        AS "entregado",
      COALESCE(SUM(w."pedido" - w."cortado"), 0)::int            AS "porCortar",
      COALESCE(SUM(w."cortado" - w."enviado"), 0)::int           AS "cortadoPorEnviar",
      -- V1-E8v: las incompletas ya volvieron del taller (§Post-F9.147). V1 fila 0.109: los
      -- faltantes saldados nunca volvieron y ya se resolvieron. MISMA regla que
      -- \`pendientePorCelda\` (\`produccion/incompletas.ts\`), aquí en SQL sobre la vista.
      COALESCE(SUM(w."enviado" - w."recibido" - w."incompletas" - w."faltantes_saldados"), 0)::int AS "porRecibir",
      COALESCE(SUM(w."recibido_costura" - w."entregado"), 0)::int AS "porEntregar"
    FROM "kpi_wip" w
    WHERE ${where}
  `);

  const [conteo] = await cliente.$queryRaw<{ total: number }[]>(Prisma.sql`
    SELECT COUNT(*)::int AS "total" FROM "kpi_wip" w WHERE ${where}
  `);
  const total = conteo?.total ?? 0;

  const offset = (filtros.pagina - 1) * filtros.porPagina;
  const filasCrudas = await cliente.$queryRaw<
    {
      idOrden: number;
      folio: bigint;
      idCliente: number;
      cliente: string;
      idModelo: number;
      codigoModelo: string;
      pedido: number;
      cortado: number;
      enviado: number;
      recibido: number;
      incompletas: number;
      faltantesSaldados: number;
      recibidoCostura: number;
      entregado: number;
      porCortar: number;
      cortadoPorEnviar: number;
      porRecibir: number;
      porEntregar: number;
    }[]
  >(Prisma.sql`
    SELECT
      w."id_orden"          AS "idOrden",
      w."folio"             AS "folio",
      w."id_cliente"        AS "idCliente",
      c."nombre"            AS "cliente",
      w."id_modelo"         AS "idModelo",
      m."codigo"            AS "codigoModelo",
      w."pedido"            AS "pedido",
      w."cortado"           AS "cortado",
      w."enviado"           AS "enviado",
      w."recibido"          AS "recibido",
      w."incompletas"       AS "incompletas",
      w."faltantes_saldados" AS "faltantesSaldados",
      w."recibido_costura"  AS "recibidoCostura",
      w."entregado"         AS "entregado",
      (w."pedido" - w."cortado")             AS "porCortar",
      (w."cortado" - w."enviado")            AS "cortadoPorEnviar",
      (w."enviado" - w."recibido" - w."incompletas" - w."faltantes_saldados") AS "porRecibir",
      (w."recibido_costura" - w."entregado") AS "porEntregar"
    FROM "kpi_wip" w
    JOIN "clientes" c ON c."id" = w."id_cliente"
    JOIN "modelos"  m ON m."id" = w."id_modelo"
    WHERE ${where}
    ORDER BY w."folio" DESC
    LIMIT ${filtros.porPagina} OFFSET ${offset}
  `);

  const vacios = {
    pedido: 0,
    cortado: 0,
    enviado: 0,
    recibido: 0,
    incompletas: 0,
    faltantesSaldados: 0,
    recibidoCostura: 0,
    entregado: 0,
    porCortar: 0,
    cortadoPorEnviar: 0,
    porRecibir: 0,
    porEntregar: 0,
  };

  return {
    datosAl: await leerDatosAl(cliente),
    totales: totales ?? vacios,
    datos: filasCrudas.map((f) => ({
      idOrden: f.idOrden,
      folio: Number(f.folio),
      idCliente: f.idCliente,
      cliente: f.cliente,
      idModelo: f.idModelo,
      codigoModelo: f.codigoModelo,
      pedido: f.pedido,
      cortado: f.cortado,
      enviado: f.enviado,
      recibido: f.recibido,
      incompletas: f.incompletas,
      faltantesSaldados: f.faltantesSaldados,
      recibidoCostura: f.recibidoCostura,
      entregado: f.entregado,
      porCortar: f.porCortar,
      cortadoPorEnviar: f.cortadoPorEnviar,
      porRecibir: f.porRecibir,
      porEntregar: f.porEntregar,
    })),
    total,
    pagina: filtros.pagina,
    porPagina: filtros.porPagina,
    totalPaginas: Math.max(1, Math.ceil(total / filtros.porPagina)),
  };
}

// ── Refresco on-demand ────────────────────────────────────────────────────────────────────────────

/**
 * ENCOLA el refresco de las vistas de KPIs (on-demand) y REGRESA de inmediato: la consulta/captura
 * NUNCA espera el recálculo (plan §11). Serializado por `singletonKey` (idRecurso fijo 0 = global)
 * SOBRE una cola con política `stately` —la clave sola no restringiría nada—: varios disparos
 * seguidos colapsan en uno.
 *
 * ⚠️ POR ESO `encolado:false` TIENE DOS CAUSAS, no una: (1) el motor de jobs está inactivo, y
 * (2) —la habitual— ya había un refresco ESPERANDO y este disparo se dedupó. Hasta que la cola
 * declaró política, (2) no podía ocurrir y `false` significaba sólo (1); quien lea `false` como
 * "no se va a refrescar" se equivoca en el caso (2), donde el refresco sí llega. Dos clics
 * seguidos en «Refrescar» caen justo ahí. `indicadores.ver`.
 */
export async function encolarRefrescoKpis(sesion: SesionUsuario): Promise<RefrescoEncolado> {
  verificarPermiso(sesion, 'indicadores.ver');
  const id = await encolarJob(COLAS_JOBS.refrescarKpis, 0, { solicitadoPor: sesion.id });
  return { encolado: id !== null };
}
