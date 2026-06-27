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
