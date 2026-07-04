import { z } from 'zod';

/**
 * Esquemas Zod de los TABLEROS DIRECTIVOS de indicadores (Módulo Indicadores, F7-E3; plan §11; doc
 * `08-Ruta-Critica.md` §4.4 / `09-Control-de-Calidad.md` §5.3 / MEJORAS 03-WIP; D11). UNA sola
 * definición de reglas para UI y servidor (alimenta el OpenAPI). Toda la lógica vive en
 * `dominio/indicadores/*` (A1); aquí solo las FORMAS.
 *
 * Los números se calculan sobre VISTAS MATERIALIZADAS que refresca un job (no en tiempo de captura):
 * cada respuesta trae `datosAl` (ISO de la última actualización de las vistas, o null si nunca se
 * refrescaron) para mostrar "datos al: <fecha/hora>". La agregación es SIEMPRE en el servidor.
 */

// ── Sello de frescura (compartido por los 3 tableros) ─────────────────────────────────────────────

/** ISO de la última actualización de las vistas (o null si aún no se refrescan). */
const esquemaDatosAl = z
  .string()
  .nullable()
  .describe('Fecha/hora ISO de la última actualización de las vistas (o null si nunca).');

// ── Tablero 1 · KPIs de Ruta Crítica (D11) ────────────────────────────────────────────────────────

/** Filtros del tablero de Ruta Crítica (querystring): periodo + cliente/maquilero/proceso. */
export const esquemaKpisRcQuery = z
  .object({
    anio: z.coerce
      .number()
      .int()
      .min(2000)
      .max(2100)
      .optional()
      .describe('Año (sobre fecha real).'),
    mes: z.coerce.number().int().min(1).max(12).optional().describe('Mes 1-12 (sobre fecha real).'),
    idCliente: z.coerce.number().int().positive().optional().describe('Filtra por cliente.'),
    idMaquilero: z.coerce.number().int().positive().optional().describe('Filtra por maquilero.'),
    idProcesoDef: z.coerce.number().int().positive().optional().describe('Filtra por proceso.'),
  })
  .describe('Filtros del tablero de KPIs de Ruta Crítica.');

/** Filtros de RC ya coaccionados. */
export type KpisRcQuery = z.infer<typeof esquemaKpisRcQuery>;

/** % de entregas a tiempo del último proceso de la RC (D2 #7). */
const esquemaEntregasATiempo = z.object({
  completadas: z.number().int().describe('Órdenes con su último proceso cumplido (real ≠ null).'),
  medibles: z
    .number()
    .int()
    .describe(
      'Completadas CON fecha planeada (real ≠ null Y planeada ≠ null) = denominador del %.',
    ),
  completadasSinPlan: z
    .number()
    .int()
    .describe('Completadas SIN plan (no medibles): fuera del denominador (informativo).'),
  aTiempo: z
    .number()
    .int()
    .describe('De las medibles, cuántas a tiempo (real ≤ planeada vigente).'),
  porcentaje: z
    .number()
    .nullable()
    .describe('% a tiempo = aTiempo ÷ medibles, o null si 0 medibles.'),
});

/** Lead time (días reales vs estimado) de un proceso. */
const esquemaLeadTimeProceso = z.object({
  idProcesoDef: z.number().int().describe('Id del proceso.'),
  codigoProceso: z.string().describe('Código del proceso.'),
  nombreProceso: z.string().describe('Nombre del proceso.'),
  numProcesos: z.number().int().describe('Nº de procesos cumplidos considerados.'),
  diasRealesProm: z.number().nullable().describe('Días reales promedio del proceso (o null).'),
  diasEstimadoProm: z.number().nullable().describe('Días estimados promedio (duración) o null.'),
});

/** Cuello de botella (atraso medio) de un proceso. */
const esquemaCuelloBotella = z.object({
  idProcesoDef: z.number().int().describe('Id del proceso.'),
  codigoProceso: z.string().describe('Código del proceso.'),
  nombreProceso: z.string().describe('Nombre del proceso.'),
  numProcesos: z.number().int().describe('Nº de procesos cumplidos considerados.'),
  atrasoMedioDias: z.number().nullable().describe('Atraso medio en días (real − planeada) o null.'),
});

/** Desempeño de quien capturó el cumplimiento de los procesos. */
const esquemaDesempenoResponsable = z.object({
  responsableId: z.string().describe('Id del usuario que capturó el cumplimiento.'),
  responsable: z.string().describe('Nombre del responsable (o el id si no se resuelve).'),
  numProcesos: z.number().int().describe('Nº de procesos cumplidos capturados.'),
  aTiempo: z.number().int().describe('De ésos, cuántos a tiempo.'),
  porcentaje: z.number().nullable().describe('% a tiempo (fracción) o null.'),
});

/** Punto de la tendencia mensual del % a tiempo (ciclo). */
const esquemaTendenciaRc = z.object({
  anio: z.number().int().describe('Año.'),
  mes: z.number().int().describe('Mes 1-12.'),
  completadas: z.number().int().describe('Órdenes completadas ese mes.'),
  aTiempo: z.number().int().describe('De ésas, a tiempo.'),
  porcentaje: z.number().nullable().describe('% a tiempo del mes (fracción) o null.'),
});

/** Respuesta del tablero de KPIs de Ruta Crítica. */
export const esquemaKpisRc = z
  .object({
    datosAl: esquemaDatosAl,
    entregasATiempo: esquemaEntregasATiempo.describe('% de entregas a tiempo (último proceso).'),
    leadTime: z.array(esquemaLeadTimeProceso).describe('Lead time por proceso (real vs estimado).'),
    cuellosBotella: z
      .array(esquemaCuelloBotella)
      .describe('Cuellos de botella (atraso medio desc).'),
    desempeno: z
      .array(esquemaDesempenoResponsable)
      .describe('Desempeño por responsable (quien capturó).'),
    tendencia: z.array(esquemaTendenciaRc).describe('Tendencia mensual del % a tiempo (ciclo).'),
  })
  .describe('Tablero de KPIs de Ruta Crítica (D11).');

/** Forma del tablero de KPIs de Ruta Crítica. */
export type KpisRc = z.infer<typeof esquemaKpisRc>;

// ── Tablero 2 · Calidad por maquilero (F6) ────────────────────────────────────────────────────────

/** Filtros del tablero de calidad (querystring): periodo + maquilero. */
export const esquemaKpisCalidadQuery = z
  .object({
    anio: z.coerce.number().int().min(2000).max(2100).optional().describe('Año (fecha auditoría).'),
    mes: z.coerce.number().int().min(1).max(12).optional().describe('Mes 1-12 (fecha auditoría).'),
    idMaquilero: z.coerce.number().int().min(0).optional().describe('Maquilero (0 = sin asignar).'),
  })
  .describe('Filtros del tablero de calidad por maquilero.');

/** Filtros de calidad ya coaccionados. */
export type KpisCalidadQuery = z.infer<typeof esquemaKpisCalidadQuery>;

/** % de aprobación de un maquilero. */
const esquemaCalidadMaquilero = z.object({
  idMaquilero: z.number().int().describe('Id del maquilero (0 = sin asignar).'),
  maquilero: z.string().describe('Nombre del maquilero (o "Sin maquilero").'),
  numAuditorias: z.number().int().describe('Nº de auditorías (vivas) del maquilero.'),
  aprobadas: z.number().int().describe('Auditorías con resultado aprobado.'),
  calificadas: z.number().int().describe('Auditorías con veredicto (no "no calificado").'),
  porcentaje: z.number().nullable().describe('% de aprobación (fracción) o null si 0 calificadas.'),
});

/** Un defecto top (Σ fallas). */
const esquemaDefectoTop = z.object({
  idDefecto: z.number().int().describe('Id del defecto.'),
  clave: z.string().describe('Clave del defecto.'),
  descripcion: z.string().describe('Descripción del defecto.'),
  totalFallas: z.number().int().describe('Σ de fallas contadas.'),
  numAuditorias: z.number().int().describe('Nº de auditorías donde apareció.'),
});

/** Punto de la tendencia mensual de aprobación. */
const esquemaTendenciaCalidad = z.object({
  anio: z.number().int().describe('Año.'),
  mes: z.number().int().describe('Mes 1-12.'),
  numAuditorias: z.number().int().describe('Auditorías del mes.'),
  aprobadas: z.number().int().describe('Aprobadas del mes.'),
  calificadas: z.number().int().describe('Calificadas del mes.'),
  porcentaje: z.number().nullable().describe('% de aprobación del mes (fracción) o null.'),
});

/** Respuesta del tablero de calidad por maquilero. */
export const esquemaKpisCalidad = z
  .object({
    datosAl: esquemaDatosAl,
    maquileros: z.array(esquemaCalidadMaquilero).describe('% de aprobación por maquilero (desc).'),
    defectosTop: z.array(esquemaDefectoTop).describe('Defectos más frecuentes (Σ fallas desc).'),
    tendencia: z.array(esquemaTendenciaCalidad).describe('Tendencia mensual de aprobación.'),
  })
  .describe('Tablero de calidad por maquilero (F6).');

/** Forma del tablero de calidad. */
export type KpisCalidad = z.infer<typeof esquemaKpisCalidad>;

// ── Tablero 3 · WIP analítico (F3) ────────────────────────────────────────────────────────────────

/** Filtros del tablero WIP (querystring): cliente/modelo + solo pendientes + paginación. */
export const esquemaKpisWipQuery = z
  .object({
    idCliente: z.coerce.number().int().positive().optional().describe('Filtra por cliente.'),
    idModelo: z.coerce.number().int().positive().optional().describe('Filtra por modelo.'),
    soloPendientes: z
      .stringbool()
      .default(false)
      .describe('Si true, solo órdenes con algo pendiente en cualquier etapa.'),
    pagina: z.coerce.number().int().min(1).default(1).describe('Página (1-based).'),
    porPagina: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .default(20)
      .describe('Renglones por página.'),
  })
  .describe('Filtros y paginación del tablero WIP analítico.');

/** Filtros de WIP ya coaccionados. */
export type KpisWipQuery = z.infer<typeof esquemaKpisWipQuery>;

/** Totales/pendientes derivados por etapa (agregados). */
const esquemaWipTotales = z.object({
  pedido: z.number().int().describe('Σ pedido.'),
  cortado: z.number().int().describe('Σ cortado.'),
  enviado: z.number().int().describe('Σ enviado a maquila.'),
  recibido: z.number().int().describe('Σ recibido de maquila.'),
  recibidoCostura: z.number().int().describe('Σ recibido de procesos que meten a PT.'),
  entregado: z.number().int().describe('Σ entregado a cliente.'),
  porCortar: z.number().int().describe('Σ (pedido − cortado).'),
  cortadoPorEnviar: z.number().int().describe('Σ (cortado − enviado).'),
  porRecibir: z.number().int().describe('Σ (enviado − recibido).'),
  porEntregar: z.number().int().describe('Σ (recibido costura − entregado).'),
});

/** Una orden del tablero WIP con su avance + pendientes derivados. */
const esquemaWipFila = z.object({
  idOrden: z.number().int().describe('Id de la orden.'),
  folio: z.number().int().describe('Folio de la orden.'),
  idCliente: z.number().int().describe('Cliente.'),
  cliente: z.string().describe('Nombre del cliente.'),
  idModelo: z.number().int().describe('Modelo.'),
  codigoModelo: z.string().describe('Código del modelo.'),
  pedido: z.number().int().describe('Pedido.'),
  cortado: z.number().int().describe('Cortado.'),
  enviado: z.number().int().describe('Enviado.'),
  recibido: z.number().int().describe('Recibido.'),
  recibidoCostura: z.number().int().describe('Recibido de costura (mete a PT).'),
  entregado: z.number().int().describe('Entregado a cliente.'),
  porCortar: z.number().int().describe('pedido − cortado.'),
  cortadoPorEnviar: z.number().int().describe('cortado − enviado.'),
  porRecibir: z.number().int().describe('enviado − recibido.'),
  porEntregar: z.number().int().describe('recibido costura − entregado.'),
});

/** Respuesta del tablero WIP analítico: totales + página de órdenes. */
export const esquemaKpisWip = z
  .object({
    datosAl: esquemaDatosAl,
    totales: esquemaWipTotales.describe('Totales/pendientes agregados por etapa.'),
    datos: z.array(esquemaWipFila).describe('Órdenes de la página con su avance.'),
    total: z.number().int().describe('Total de órdenes que cumplen el filtro.'),
    pagina: z.number().int().describe('Página devuelta.'),
    porPagina: z.number().int().describe('Renglones por página.'),
    totalPaginas: z.number().int().describe('Total de páginas.'),
  })
  .describe('Tablero WIP analítico (F3).');

/** Forma del tablero WIP. */
export type KpisWip = z.infer<typeof esquemaKpisWip>;

// ── Refresco on-demand ────────────────────────────────────────────────────────────────────────────

/** Respuesta del disparo de refresco (encola y regresa de inmediato; NO espera el recálculo). */
export const esquemaRefrescoEncolado = z
  .object({
    encolado: z
      .boolean()
      .describe('true si se encoló el refresco (false si el motor está inactivo).'),
  })
  .describe('Resultado de encolar el refresco de KPIs.');

/** Forma de la respuesta del refresco. */
export type RefrescoEncolado = z.infer<typeof esquemaRefrescoEncolado>;
