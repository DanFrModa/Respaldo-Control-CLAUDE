import { z } from 'zod';

/**
 * Esquemas Zod del NÚCLEO de AUDITORÍAS de calidad (F6-E2; doc `09-Control-de-Calidad.md` §1/§2/§4;
 * DECISIONES.md §F6 (a)/(b)). UNA sola definición de reglas para la UI y el servidor (alimenta el
 * OpenAPI). Una auditoría inspecciona una MUESTRA de prendas de una orden recibida de un maquilero,
 * cuenta las fallas por defecto y deja un RESULTADO que el auditor decide A MANO.
 *
 * Reglas de negocio (la AUTORIDAD es el dominio; estos esquemas solo cuidan la forma):
 *  • (a) RESULTADO MANUAL: el veredicto (`aprobado`/`reprobado`) lo elige el humano. El cálculo por
 *    nivel AQL (Σ fallas del nivel vs Ac/Re del plan) se devuelve SOLO como SUGERENCIA informativa,
 *    NO es vinculante. La severidad del defecto NO entra en el veredicto.
 *  • (b) MUESTRA: se propone automática del plan AQL default por la cantidad de la orden; cambiarla a
 *    mano exige permiso (gate server-side) y enciende `muestraManual`.
 *  • Folio `numAuditoria` por secuencia atómica por empresa (A3); pre-carga de TODOS los favoritos al
 *    alta (ex `InsertarFav`); maquilero propuesto de las entregas reales de la orden (ex `PrimerMaq`).
 */

// ─────────────────────────────────────────────────────────────────────────────
// Compartido (enums, etiquetas)
// ─────────────────────────────────────────────────────────────────────────────

/** Resultado de una auditoría (decisión (a) — lo decide el auditor a mano). */
export const RESULTADOS_AUDITORIA = ['aprobado', 'reprobado', 'no_calificado'] as const;

/** Clave de resultado de auditoría. */
export type ResultadoAuditoriaClave = (typeof RESULTADOS_AUDITORIA)[number];

/** Etiquetas para UI de cada resultado. */
export const ETIQUETAS_RESULTADO_AUDITORIA: Record<ResultadoAuditoriaClave, string> = {
  aprobado: 'Aprobada',
  reprobado: 'Reprobada',
  no_calificado: 'Sin calificar',
};

/** Tipo de auditoría (en piso durante la producción / final al recibir / sin definir). */
export const TIPOS_AUDITORIA = ['en_piso', 'final', 'no_definida'] as const;

/** Clave de tipo de auditoría. */
export type TipoAuditoriaClave = (typeof TIPOS_AUDITORIA)[number];

/** Etiquetas para UI de cada tipo. */
export const ETIQUETAS_TIPO_AUDITORIA: Record<TipoAuditoriaClave, string> = {
  en_piso: 'En piso',
  final: 'Final',
  no_definida: 'Sin definir',
};

/** Sugerencia informativa por defecto: aprobar (≤ Ac) o reprobar (≥ Re) según el plan. */
export const SUGERENCIAS_AQL = ['aprobar', 'reprobar'] as const;

/** Clave de sugerencia AQL. */
export type SugerenciaAqlClave = (typeof SUGERENCIAS_AQL)[number];

// ─────────────────────────────────────────────────────────────────────────────
// Alta de auditoría
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Alta de una auditoría (doc 09 §2 — ex `CC_AltaAuditorias`). La cantidad de la orden, el tamaño de
 * muestra (del plan AQL) y los defectos favoritos se RESUELVEN en el servidor; aquí solo viaja la
 * orden, el maquilero elegido (de los propuestos) y las fechas/tipo. Si `idMaquilero` se omite, el
 * dominio propone el primero de las entregas reales de la orden.
 */
export const esquemaAuditoriaCrear = z
  .object({
    idOrden: z
      .number({ error: 'La orden es obligatoria' })
      .int({ error: 'El id de la orden debe ser entero' })
      .positive({ error: 'El id de la orden debe ser positivo' }),
    idMaquilero: z
      .number()
      .int({ error: 'El id del maquilero debe ser entero' })
      .positive({ error: 'El id del maquilero debe ser positivo' })
      .nullable()
      .optional()
      .describe(
        'Maquilero auditado (de los propuestos de la orden). Si se omite, se propone el primero.',
      ),
    fechaElaboracion: z.iso
      .date({ error: 'La fecha de elaboración debe ser YYYY-MM-DD' })
      .optional()
      .describe('Fecha de elaboración (YYYY-MM-DD). Por defecto hoy.'),
    fechaAuditoria: z.iso
      .date({ error: 'La fecha de auditoría debe ser YYYY-MM-DD' })
      .optional()
      .describe('Fecha en que se auditó la prenda (YYYY-MM-DD). Por defecto hoy.'),
    tipoAuditoria: z
      .enum(TIPOS_AUDITORIA)
      .default('no_definida')
      .describe('Tipo de auditoría (en piso / final / sin definir).'),
  })
  .describe('Datos de alta de una auditoría de calidad.');

/** Datos validados de alta de auditoría. */
export type DatosAuditoriaCrear = z.infer<typeof esquemaAuditoriaCrear>;

// ─────────────────────────────────────────────────────────────────────────────
// Captura de resultados
// ─────────────────────────────────────────────────────────────────────────────

/** Un renglón de captura: cuántas fallas de un defecto vio el auditor en la muestra. */
export const esquemaAuditoriaDefectoEntrada = z.object({
  idDefecto: z
    .number({ error: 'El id del defecto es obligatorio' })
    .int({ error: 'El id del defecto debe ser entero' })
    .positive({ error: 'El id del defecto debe ser positivo' }),
  numFallas: z
    .number({ error: 'El número de fallas es obligatorio' })
    .int({ error: 'El número de fallas debe ser entero' })
    .min(0, { error: 'El número de fallas no puede ser negativo' }),
});

/**
 * Captura de resultados de una auditoría (doc 09 §2). El auditor captura las fallas por defecto
 * (REEMPLAZAN el set completo, patrón "rewrite") y decide a mano el `resultado` con observaciones. El
 * `tamanoMuestra` opcional sobre-escribe la muestra del plan (decisión (b) — gate por permiso en el
 * dominio). El cálculo por nivel AQL se devuelve como sugerencia, pero el `resultado` es el manual.
 */
export const esquemaAuditoriaResultadoCuerpo = z
  .object({
    resultado: z
      .enum(RESULTADOS_AUDITORIA)
      .describe('Veredicto MANUAL del auditor (la sugerencia AQL no es vinculante).'),
    observaciones: z
      .string()
      .trim()
      .max(1000, { error: 'Las observaciones no pueden tener más de 1000 caracteres' })
      .nullable()
      .optional()
      .describe('Observaciones que justifican el veredicto (texto libre), opcional.'),
    defectos: z
      .array(esquemaAuditoriaDefectoEntrada)
      .describe('Renglones defecto → nº de fallas (reemplazan el set completo).'),
    tamanoMuestra: z
      .number()
      .int({ error: 'El tamaño de muestra debe ser entero' })
      .min(1, { error: 'El tamaño de muestra debe ser al menos 1' })
      .optional()
      .describe(
        'Override del tamaño de muestra (exige permiso). Si se omite, conserva el del plan.',
      ),
  })
  .describe('Captura de resultados de una auditoría (resultado MANUAL + fallas por defecto).');

/** Datos validados de captura de resultados. */
export type DatosAuditoriaResultado = z.infer<typeof esquemaAuditoriaResultadoCuerpo>;

// ─────────────────────────────────────────────────────────────────────────────
// Reclasificación Primeras ↔ Segundas (traspaso de kardex)
// ─────────────────────────────────────────────────────────────────────────────

/** Una talla con su cantidad a reclasificar dentro de un color (D4). Cantidad entera ≥ 0. */
const esquemaReclasifTalla = z.object({
  idTalla: z.number().int().positive(),
  cantidad: z.number().int().min(0, { error: 'La cantidad no puede ser negativa' }),
});

/** Un renglón de la matriz de reclasificación: un color con sus cantidades por talla. */
const esquemaReclasifLinea = z.object({
  idColor: z.number().int().positive(),
  tallas: z.array(esquemaReclasifTalla).min(1, { error: 'Cada color necesita al menos una talla' }),
});

/**
 * Reclasificación de prendas Primeras ↔ Segundas tras la auditoría (doc 03 paso 5; D3). Genera un
 * TRASPASO de kardex entre los almacenes "Primeras" y "Segundas" — NUNCA edita existencias. El modelo
 * lo deriva el dominio de la orden de la auditoría. `sentido = a-segundas` mueve de Primeras a
 * Segundas (se detectaron defectos); `a-primeras` reclasifica de vuelta (corrección).
 */
export const esquemaReclasificacionCuerpo = z
  .object({
    sentido: z
      .enum(['a-segundas', 'a-primeras'])
      .describe('Dirección: a-segundas (Primeras→Segundas) o a-primeras (Segundas→Primeras).'),
    fecha: z.iso
      .date({ error: 'La fecha debe ser YYYY-MM-DD' })
      .optional()
      .describe('Fecha del traspaso (YYYY-MM-DD). Por defecto hoy.'),
    lineas: z
      .array(esquemaReclasifLinea)
      .min(1, { error: 'Captura al menos un color con sus tallas' })
      .describe('Matriz color×talla de las prendas a reclasificar.'),
    observaciones: z.string().trim().max(500).optional(),
  })
  .describe('Reclasificación Primeras↔Segundas tras una auditoría (traspaso de kardex).');

/** Datos validados de reclasificación. */
export type DatosReclasificacion = z.infer<typeof esquemaReclasificacionCuerpo>;

// ─────────────────────────────────────────────────────────────────────────────
// Sugerencia AQL (informativa — NO vinculante)
// ─────────────────────────────────────────────────────────────────────────────

/** Sugerencia por NIVEL AQL: Σ fallas de los defectos de ese nivel vs su límite Ac/Re del plan. */
export const esquemaSugerenciaNivel = z
  .object({
    nivelAQL: z.number().describe('Nivel AQL (1 / 2.5 / 10).'),
    totalFallas: z.number().int().describe('Σ de fallas de los defectos de este nivel.'),
    aceptar: z.number().int().describe('Número de aceptación (Ac) del plan para este nivel.'),
    rechazar: z.number().int().describe('Número de rechazo (Re) del plan para este nivel.'),
    sugerencia: z
      .enum(SUGERENCIAS_AQL)
      .describe('aprobar si total ≤ Ac; reprobar si total ≥ Re (informativo).'),
  })
  .describe('Sugerencia informativa por nivel AQL.');

/**
 * Sugerencia AQL completa (informativa, NO vinculante — decisión (a)). `resoluble=false` cuando no hay
 * plan default activo o la cantidad de la orden cae fuera de la tabla configurada: en ese caso la
 * captura sigue siendo posible (el veredicto es manual), solo no hay sugerencia.
 */
export const esquemaSugerenciaAql = z
  .object({
    resoluble: z.boolean().describe('Falso si no hay plan/renglón para resolver la sugerencia.'),
    idPlan: z.number().int().nullable().describe('Plan AQL default usado, o null.'),
    nombrePlan: z.string().nullable().describe('Nombre del plan, o null.'),
    tamanoLote: z.number().int().describe('Cantidad de la orden usada como tamaño de lote.'),
    tamanoMuestra: z.number().int().nullable().describe('Tamaño de muestra del plan, o null.'),
    niveles: z.array(esquemaSugerenciaNivel).describe('Sugerencia por nivel AQL.'),
    sugerenciaGlobal: z
      .enum(SUGERENCIAS_AQL)
      .nullable()
      .describe(
        'reprobar si algún nivel sugiere reprobar; aprobar si todos aprueban; null si no resoluble.',
      ),
    mensaje: z.string().nullable().describe('Explica por qué no es resoluble, o null.'),
  })
  .describe('Sugerencia AQL informativa (no determina el resultado, decisión (a)).');

/** Forma de la sugerencia AQL. */
export type SugerenciaAqlSalida = z.infer<typeof esquemaSugerenciaAql>;

// ─────────────────────────────────────────────────────────────────────────────
// Salida de una auditoría
// ─────────────────────────────────────────────────────────────────────────────

/** Un renglón defecto → fallas en la salida de la auditoría (con datos del defecto para la UI). */
export const esquemaAuditoriaDefectoSalida = z
  .object({
    idDefecto: z.number().int().describe('Id del defecto.'),
    clave: z.string().describe('Clave de negocio del defecto.'),
    descripcion: z.string().describe('Descripción del defecto.'),
    nivelAQL: z.number().describe('Nivel AQL del defecto (1 / 2.5 / 10).'),
    favorito: z.boolean().describe('Si el defecto es favorito (se pre-cargó al alta).'),
    activo: z.boolean().describe('Si el defecto sigue activo en el catálogo.'),
    numFallas: z.number().int().describe('Número de prendas con este defecto en la muestra.'),
  })
  .describe('Renglón defecto → nº de fallas de una auditoría.');

/** Salida de una auditoría con su detalle, sugerencia y datos legibles. */
export const esquemaAuditoriaSalida = z
  .object({
    id: z.number().int().describe('Id de la auditoría.'),
    numAuditoria: z.number().int().describe('Folio consecutivo por empresa.'),
    idEmpresa: z.number().int(),
    idOrden: z.number().int().describe('Orden auditada.'),
    folioOrden: z.number().int().nullable().describe('Folio de la orden (legible).'),
    codigoModelo: z.string().nullable().describe('Código del modelo de la orden (legible).'),
    idMaquilero: z.number().int().nullable().describe('Maquilero auditado, o null.'),
    maquilero: z.string().nullable().describe('Nombre del maquilero, o null.'),
    fechaElaboracion: z.iso.date().describe('Fecha de elaboración (YYYY-MM-DD).'),
    fechaAuditoria: z.iso.date().describe('Fecha en que se auditó (YYYY-MM-DD).'),
    elaboroPorId: z.string().nullable().describe('Usuario que dio de alta la auditoría.'),
    auditorPorId: z.string().nullable().describe('Usuario que auditó.'),
    tamanoMuestra: z.number().int().describe('Tamaño de muestra inspeccionado.'),
    muestraManual: z.boolean().describe('Si la muestra se sobre-escribió a mano.'),
    resultado: z.enum(RESULTADOS_AUDITORIA).describe('Veredicto manual del auditor.'),
    resultadoManual: z.boolean().describe('Siempre true en v2 (el resultado lo decide el humano).'),
    tipoAuditoria: z.enum(TIPOS_AUDITORIA).describe('Tipo de auditoría.'),
    observaciones: z.string().nullable().describe('Observaciones del auditor.'),
    cancelada: z.boolean().describe('Si la auditoría está cancelada (borrado suave).'),
    totalFallas: z.number().int().describe('Σ de fallas de todos los defectos (derivado).'),
    defectos: z.array(esquemaAuditoriaDefectoSalida).describe('Renglones defecto → fallas.'),
    sugerencia: esquemaSugerenciaAql.describe('Sugerencia AQL informativa (no vinculante).'),
    creadoEn: z.iso.datetime().describe('Fecha de alta (ISO 8601).'),
    creadoPorId: z.string().nullable(),
    modificadoEn: z.iso.datetime().describe('Última modificación (ISO 8601).'),
    modificadoPorId: z.string().nullable(),
  })
  .describe('Auditoría de calidad con su detalle y sugerencia AQL.');

/** Forma de una auditoría tal como la devuelve la API. */
export type AuditoriaSalida = z.infer<typeof esquemaAuditoriaSalida>;

// ─────────────────────────────────────────────────────────────────────────────
// Contexto de la orden (para el alta): cantidad + maquileros propuestos + muestra
// ─────────────────────────────────────────────────────────────────────────────

/** Un maquilero propuesto para una auditoría (de las entregas reales de la orden). */
export const esquemaMaquileroPropuesto = z
  .object({
    id: z.number().int().describe('Id del proveedor (maquilero).'),
    nombre: z.string().describe('Nombre del maquilero.'),
    sugerido: z.boolean().describe('Si es el maquilero sugerido por defecto (ex PrimerMaq).'),
  })
  .describe('Maquilero propuesto de las entregas reales de la orden.');

/** Muestra propuesta del plan AQL para una cantidad (con los límites por nivel, sin fallas aún). */
export const esquemaMuestraNivel = z
  .object({
    nivelAQL: z.number().describe('Nivel AQL (1 / 2.5 / 10).'),
    aceptar: z.number().int().describe('Número de aceptación (Ac).'),
    rechazar: z.number().int().describe('Número de rechazo (Re).'),
  })
  .describe('Límite Ac/Re de un nivel AQL para la muestra propuesta.');

/** Muestra propuesta del plan AQL (para el alta y la sugerencia en vivo). */
export const esquemaMuestraPropuesta = z
  .object({
    resoluble: z.boolean().describe('Falso si no hay plan/renglón para la cantidad.'),
    idPlan: z.number().int().nullable(),
    nombrePlan: z.string().nullable(),
    tamanoLote: z.number().int().describe('Cantidad de la orden.'),
    tamanoMuestra: z.number().int().nullable().describe('Tamaño de muestra propuesto, o null.'),
    niveles: z.array(esquemaMuestraNivel).describe('Límites por nivel AQL.'),
    mensaje: z.string().nullable().describe('Explica por qué no es resoluble, o null.'),
  })
  .describe('Muestra propuesta del plan AQL para una cantidad.');

/** Contexto de una orden para dar de alta su auditoría (cantidad + maquileros + muestra). */
export const esquemaAuditoriaContexto = z
  .object({
    idOrden: z.number().int(),
    folioOrden: z.number().int().nullable(),
    idModelo: z.number().int(),
    codigoModelo: z.string(),
    cantidad: z.number().int().describe('Cantidad total de la orden (Σ color×talla).'),
    maquileros: z.array(esquemaMaquileroPropuesto).describe('Maquileros propuestos.'),
    muestra: esquemaMuestraPropuesta.describe('Muestra propuesta del plan AQL.'),
  })
  .describe('Contexto de una orden para dar de alta su auditoría.');

/** Forma del contexto de orden. */
export type AuditoriaContextoSalida = z.infer<typeof esquemaAuditoriaContexto>;

// ─────────────────────────────────────────────────────────────────────────────
// Consulta de auditorías (F6-E3): listado LIGERO paginado + filtros en servidor
// ─────────────────────────────────────────────────────────────────────────────

/**
 * RESUMEN de una auditoría para el LISTADO (F6-E3). Proyección LIGERA: NO trae los renglones de
 * defecto ni la sugerencia AQL (eso vive en el detalle `esquemaAuditoriaSalida`); solo lo que pinta
 * una fila de la consulta y su historial. `totalFallas` es Σ de las fallas de sus defectos (derivado).
 */
export const esquemaAuditoriaResumen = z
  .object({
    id: z.number().int().describe('Id de la auditoría.'),
    numAuditoria: z.number().int().describe('Folio consecutivo por empresa.'),
    folioOrden: z.number().int().nullable().describe('Folio de la orden auditada (legible).'),
    codigoModelo: z.string().nullable().describe('Código del modelo de la orden (legible).'),
    idMaquilero: z.number().int().nullable().describe('Maquilero auditado, o null.'),
    maquilero: z.string().nullable().describe('Nombre del maquilero, o null.'),
    fechaAuditoria: z.iso.date().describe('Fecha en que se auditó (YYYY-MM-DD).'),
    tipoAuditoria: z.enum(TIPOS_AUDITORIA).describe('Tipo de auditoría.'),
    resultado: z.enum(RESULTADOS_AUDITORIA).describe('Veredicto manual del auditor.'),
    tamanoMuestra: z.number().int().describe('Tamaño de muestra inspeccionado.'),
    totalFallas: z.number().int().describe('Σ de fallas de todos los defectos (derivado).'),
    nivelAqlPrincipal: z
      .number()
      .nullable()
      .describe(
        'AQL de la auditoría (derivado): nivel del defecto con más fallas registradas ' +
          '(empate → el más estricto); null si la auditoría no registró fallas.',
      ),
    cancelada: z.boolean().describe('Si la auditoría está cancelada (borrado suave).'),
  })
  .describe('Resumen de una auditoría para el listado.');

/** Forma del resumen de una auditoría en la API. */
export type AuditoriaResumenSalida = z.infer<typeof esquemaAuditoriaResumen>;

/** Filtros, orden y paginación del listado de auditorías (querystring). */
export const esquemaAuditoriasQuery = z
  .object({
    pagina: z.coerce.number().int().min(1).default(1).describe('Página (1-based).'),
    porPagina: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .default(20)
      .describe('Renglones por página.'),
    folioOrden: z.coerce
      .number()
      .int()
      .positive()
      .optional()
      .describe('Filtra por folio de la orden auditada.'),
    idMaquilero: z.coerce
      .number()
      .int()
      .positive()
      .optional()
      .describe('Filtra por maquilero auditado.'),
    resultado: z.enum(RESULTADOS_AUDITORIA).optional().describe('Filtra por resultado.'),
    tipoAuditoria: z.enum(TIPOS_AUDITORIA).optional().describe('Filtra por tipo de auditoría.'),
    desde: z.iso
      .date({ error: 'La fecha "desde" debe ser YYYY-MM-DD' })
      .optional()
      .describe('Fecha de auditoría mínima (YYYY-MM-DD, inclusive).'),
    hasta: z.iso
      .date({ error: 'La fecha "hasta" debe ser YYYY-MM-DD' })
      .optional()
      .describe('Fecha de auditoría máxima (YYYY-MM-DD, inclusive).'),
    incluirCanceladas: z
      .stringbool()
      .default(false)
      .describe('Incluye las canceladas ("true"/"false").'),
    ordenarPor: z
      .enum(['numAuditoria', 'fechaAuditoria'])
      .default('numAuditoria')
      .describe('Columna de ordenamiento.'),
    direccion: z.enum(['asc', 'desc']).default('desc').describe('Dirección del orden.'),
  })
  .describe('Filtros, orden y paginación del listado de auditorías.');

/** Parámetros de listado de auditorías ya coaccionados desde la URL. */
export type AuditoriasQuery = z.infer<typeof esquemaAuditoriasQuery>;

/** Respuesta paginada del listado de auditorías. */
export const esquemaAuditoriasPagina = z
  .object({
    datos: z.array(esquemaAuditoriaResumen).describe('Auditorías de la página.'),
    total: z.number().int().describe('Total que cumplen el filtro.'),
    pagina: z.number().int().describe('Página devuelta.'),
    porPagina: z.number().int().describe('Renglones por página.'),
    totalPaginas: z.number().int().describe('Total de páginas.'),
  })
  .describe('Página de auditorías.');

/** Forma de la respuesta paginada de auditorías. */
export type AuditoriasPagina = z.infer<typeof esquemaAuditoriasPagina>;

// ── Resumen de cabecera (KPIs `vCalidad`, rediseño R9) ─────────────────────────────────

/**
 * Filtros del resumen de auditorías (querystring). MISMO conjunto de filtros del listado que ACOTAN
 * el universo (maquilero/resultado/tipo/folio/rango de fecha/canceladas), SIN paginación ni orden:
 * el resumen agrega sobre TODO lo que cumple el filtro, no una página.
 */
export const esquemaResumenAuditoriasQuery = z
  .object({
    folioOrden: z.coerce
      .number()
      .int()
      .positive()
      .optional()
      .describe('Filtra por folio de orden.'),
    idMaquilero: z.coerce.number().int().positive().optional().describe('Filtra por maquilero.'),
    resultado: z.enum(RESULTADOS_AUDITORIA).optional().describe('Filtra por resultado.'),
    tipoAuditoria: z.enum(TIPOS_AUDITORIA).optional().describe('Filtra por tipo de auditoría.'),
    desde: z.iso.date().optional().describe('Fecha de auditoría mínima (YYYY-MM-DD, inclusive).'),
    hasta: z.iso.date().optional().describe('Fecha de auditoría máxima (YYYY-MM-DD, inclusive).'),
    incluirCanceladas: z
      .stringbool()
      .default(false)
      .describe('Incluye las canceladas ("true"/"false").'),
  })
  .describe('Filtros del resumen de auditorías (KPIs de cabecera).');

/** Parámetros del resumen de auditorías ya coaccionados desde la URL. */
export type ResumenAuditoriasQuery = z.infer<typeof esquemaResumenAuditoriasQuery>;

/**
 * Defecto PRINCIPAL del conjunto filtrado (KPI `vCalidad`): el defecto con MÁS fallas sumadas en las
 * auditorías que cumplen el filtro. `null` si no hay fallas registradas.
 */
export const esquemaDefectoPrincipal = z
  .object({
    idDefecto: z.number().int().describe('Id del defecto.'),
    clave: z.string().describe('Clave del defecto.'),
    descripcion: z.string().describe('Descripción del defecto.'),
    totalFallas: z.number().int().describe('Σ de fallas del defecto en el conjunto filtrado.'),
  })
  .describe('Defecto más frecuente del conjunto filtrado de auditorías.');

/** Forma del defecto principal. */
export type DefectoPrincipal = z.infer<typeof esquemaDefectoPrincipal>;

/** Resumen de cabecera de auditorías (KPIs): por ahora, el defecto principal del filtro. */
export const esquemaResumenAuditorias = z
  .object({
    defectoPrincipal: esquemaDefectoPrincipal
      .nullable()
      .describe('Defecto con más fallas del conjunto filtrado, o null si no hay fallas.'),
  })
  .describe('Resumen de cabecera de auditorías (KPIs).');

/** Forma del resumen de auditorías. */
export type ResumenAuditorias = z.infer<typeof esquemaResumenAuditorias>;

// ─────────────────────────────────────────────────────────────────────────────
// Modificar encabezado / cancelar (F6-E3)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Modificación de los datos de ENCABEZADO de una auditoría (F6-E3 — ex `CC_ModificarDatos`). NO edita
 * las fallas (eso es la captura). Todos los campos son opcionales (edición parcial); el maquilero, si
 * se cambia, debe seguir siendo uno de los propuestos de la orden (lo valida el dominio).
 */
export const esquemaAuditoriaModificarCuerpo = z
  .object({
    idMaquilero: z
      .number()
      .int({ error: 'El id del maquilero debe ser entero' })
      .positive({ error: 'El id del maquilero debe ser positivo' })
      .nullable()
      .optional()
      .describe('Maquilero auditado (de los propuestos de la orden), o null para quitarlo.'),
    fechaElaboracion: z.iso
      .date({ error: 'La fecha de elaboración debe ser YYYY-MM-DD' })
      .optional()
      .describe('Fecha de elaboración (YYYY-MM-DD).'),
    fechaAuditoria: z.iso
      .date({ error: 'La fecha de auditoría debe ser YYYY-MM-DD' })
      .optional()
      .describe('Fecha en que se auditó (YYYY-MM-DD).'),
    tipoAuditoria: z
      .enum(TIPOS_AUDITORIA)
      .optional()
      .describe('Tipo de auditoría (en piso / final / sin definir).'),
    observaciones: z
      .string()
      .trim()
      .max(1000, { error: 'Las observaciones no pueden tener más de 1000 caracteres' })
      .nullable()
      .optional()
      .describe('Observaciones (texto libre), o null.'),
  })
  .describe('Modificación del encabezado de una auditoría (no toca las fallas).');

/** Datos validados de modificación de encabezado. */
export type DatosAuditoriaModificar = z.infer<typeof esquemaAuditoriaModificarCuerpo>;

/**
 * Cancelación de una auditoría (F6-E3): borrado SUAVE con motivo obligatorio. El motivo queda en la
 * bitácora (A7) y anexado a las observaciones (sin migración). Cancelar publica el evento de calidad
 * para que la Ruta Crítica des-complete el proceso `auditoria` (una auditoría cancelada ya no es viva).
 */
export const esquemaAuditoriaCancelarCuerpo = z
  .object({
    motivo: z
      .string({ error: 'El motivo de cancelación es obligatorio' })
      .trim()
      .min(1, { error: 'El motivo de cancelación es obligatorio' })
      .max(500, { error: 'El motivo no puede tener más de 500 caracteres' })
      .describe('Motivo de la cancelación (obligatorio).'),
  })
  .describe('Cancelación (borrado suave) de una auditoría con motivo.');

/** Datos validados de cancelación. */
export type DatosAuditoriaCancelar = z.infer<typeof esquemaAuditoriaCancelarCuerpo>;

// ─────────────────────────────────────────────────────────────────────────────
// Historial por maquilero (F6-E3): % de aprobación operativo
// ─────────────────────────────────────────────────────────────────────────────

/** Filtros (rango de fechas de auditoría) del historial por maquilero (querystring). */
export const esquemaHistorialMaquileroQuery = z
  .object({
    desde: z.iso
      .date({ error: 'La fecha "desde" debe ser YYYY-MM-DD' })
      .optional()
      .describe('Fecha de auditoría mínima (YYYY-MM-DD, inclusive).'),
    hasta: z.iso
      .date({ error: 'La fecha "hasta" debe ser YYYY-MM-DD' })
      .optional()
      .describe('Fecha de auditoría máxima (YYYY-MM-DD, inclusive).'),
  })
  .describe('Filtros del historial por maquilero.');

/** Parámetros del historial ya coaccionados desde la URL. */
export type HistorialMaquileroQuery = z.infer<typeof esquemaHistorialMaquileroQuery>;

/**
 * Historial de auditorías (no canceladas) de un maquilero con sus agregados (F6-E3). El
 * `porcentajeAprobacion` es operativo: aprobadas / (aprobadas + reprobadas), SOLO sobre las
 * CALIFICADAS (las `no_calificado` no cuentan); `null` si no hay ninguna calificada.
 */
export const esquemaHistorialMaquileroSalida = z
  .object({
    idMaquilero: z.number().int().describe('Maquilero consultado.'),
    maquilero: z.string().describe('Nombre del maquilero.'),
    total: z.number().int().describe('Total de auditorías vivas del maquilero en el rango.'),
    aprobadas: z.number().int().describe('Auditorías con resultado aprobado.'),
    reprobadas: z.number().int().describe('Auditorías con resultado reprobado.'),
    noCalificadas: z.number().int().describe('Auditorías sin calificar (no_calificado).'),
    porcentajeAprobacion: z
      .number()
      .nullable()
      .describe('Aprobadas / (aprobadas + reprobadas), 0–100; null si no hay calificadas.'),
    auditorias: z
      .array(esquemaAuditoriaResumen)
      .describe('Auditorías vivas del maquilero (resumen).'),
  })
  .describe('Historial de auditorías de un maquilero con % de aprobación operativo.');

/** Forma del historial por maquilero. */
export type HistorialMaquileroSalida = z.infer<typeof esquemaHistorialMaquileroSalida>;
