import { z } from 'zod';

/**
 * Esquemas Zod del MOTOR de la RUTA VIVA por orden (Módulo 8, F5-E3; doc `08-Ruta-Critica.md`
 * §2.3/§4; D10/D11). Una sola definición de reglas de captura para UI y servidor (alimenta el
 * OpenAPI). Tres operaciones: PROGRAMAR (generar/re-generar), AJUSTAR la ruta de esa orden y
 * CONSULTAR la ruta viva.
 */

const idPositivo = z
  .number({ error: 'El id debe ser un número' })
  .int({ error: 'El id debe ser entero' })
  .positive({ error: 'El id debe ser positivo' });

const idParamPositivo = z.coerce
  .number({ error: 'El id debe ser un número' })
  .int({ error: 'El id debe ser entero' })
  .positive({ error: 'El id debe ser positivo' });

const diasNoNegativos = z
  .number({ error: 'Los días son obligatorios' })
  .int({ error: 'Los días deben ser un entero' })
  .min(0, { error: 'Los días no pueden ser negativos' })
  .max(3650, { error: 'Los días no pueden superar 3650' });

/** Parámetro de ruta `:id` (la ORDEN). */
export const esquemaParamOrdenRc = z.object({
  id: idParamPositivo.describe('Id de la orden de producción.'),
});

// ── Programar (generar / re-generar) ──────────────────────────────────────────

/**
 * Cuerpo para PROGRAMAR la RC de una orden. Exige artículo + fecha de entrega de la RC + tipo de
 * tela + aplicación (sin esos datos no se puede estimar la ruta). `esResurtido` deja en 0 los
 * procesos que aplican a resurtido (se auto-completan). RE-GENERAR está permitido (conserva las
 * fechas reales ya capturadas).
 */
export const esquemaProgramarRc = z
  .object({
    idArticuloRC: idPositivo.describe('Artículo RC elegido (resuelve la plantilla aplicable).'),
    fechaEntregaRC: z.iso
      .date({ error: 'La fecha de entrega de la RC debe ser YYYY-MM-DD' })
      .describe('Fecha de entrega de la RC (YYYY-MM-DD).'),
    idTipoTela: idPositivo.describe('Tipo de tela elegido (DuracionPorTipoTela).'),
    idAplicacion: idPositivo.describe('Aplicación elegida (DuracionPorAplicacion).'),
    esResurtido: z
      .boolean({ error: 'esResurtido debe ser verdadero o falso' })
      .default(false)
      .describe('¿La orden se programa como resurtido?'),
    fechaInicioRC: z.iso
      .date({ error: 'La fecha de inicio de la RC debe ser YYYY-MM-DD' })
      .optional()
      .describe('Fecha de inicio de la RC (YYYY-MM-DD); por defecto hoy.'),
  })
  .describe('Datos para programar (generar/re-generar) la Ruta Crítica de una orden.');
/** Datos validados de programación. */
export type DatosProgramarRc = z.infer<typeof esquemaProgramarRc>;

// ── Ajustar la ruta de la orden (sin tocar la plantilla, D10) ─────────────────

/** Proceso a AGREGAR a la ruta de la orden (con duración explícita y antecesores). */
export const esquemaAjusteAgregar = z.object({
  idProcesoDef: idPositivo.describe('Proceso del catálogo a agregar.'),
  duracionDias: diasNoNegativos.describe('Duración del proceso agregado (días).'),
  idsAntecesores: z
    .array(idPositivo)
    .default([])
    .describe('Procesos (de la ruta de la orden) que lo anteceden.'),
});

/** Redefinición del set completo de antecesores de un proceso de la ruta. */
export const esquemaAjusteDependencia = z.object({
  idProcesoDef: idPositivo.describe('Proceso de la ruta cuyos antecesores se redefinen.'),
  idsAntecesores: z
    .array(idPositivo)
    .describe('Set COMPLETO de antecesores (en términos de procesos de la ruta).'),
});

/** Cuerpo para AJUSTAR la ruta de una orden: agregar/quitar procesos y/o editar dependencias. */
export const esquemaAjustarRuta = z
  .object({
    agregar: z.array(esquemaAjusteAgregar).max(200).optional().describe('Procesos a agregar.'),
    quitar: z
      .array(idPositivo)
      .max(200)
      .optional()
      .describe('Procesos (idProcesoDef) a quitar de la ruta.'),
    dependencias: z
      .array(esquemaAjusteDependencia)
      .max(200)
      .optional()
      .describe('Re-definiciones de antecesores por proceso.'),
  })
  .describe('Ajustes a la ruta de una orden (sin tocar la plantilla, D10).');
/** Datos validados de ajuste. */
export type DatosAjustarRuta = z.infer<typeof esquemaAjustarRuta>;

// ── Captura del cumplimiento (F5-E4) ──────────────────────────────────────────

/** Parámetro de ruta `:idRuta` (un renglón de RutaOrden = proceso×orden). */
export const esquemaParamRutaProceso = z.object({
  idRuta: idParamPositivo.describe('Id del renglón de ruta (proceso de la ruta viva).'),
});

/** Parámetro de ruta `:idItem` (un ítem de RutaOrdenChecklist). */
export const esquemaParamChecklistItem = z.object({
  idItem: idParamPositivo.describe('Id del ítem de checklist de la ruta viva.'),
});

/**
 * Cuerpo para capturar/revertir el CUMPLIMIENTO de un proceso (F5-E4). `cumplido = true` marca la
 * `fechaReal` (default hoy si no se manda fecha) y activa los sucesores listos; `false` la revierte.
 */
export const esquemaCapturarProceso = z
  .object({
    cumplido: z
      .boolean({ error: 'cumplido debe ser verdadero o falso' })
      .describe('Marcar (true) o revertir (false) el cumplimiento.'),
    fechaReal: z.iso
      .date({ error: 'La fecha real debe ser YYYY-MM-DD' })
      .optional()
      .describe('Fecha real de cumplimiento (YYYY-MM-DD); por defecto hoy. Ignorada al revertir.'),
  })
  .describe('Captura o reversión del cumplimiento de un proceso de la ruta viva.');
/** Datos validados de captura de cumplimiento. */
export type DatosCapturarProceso = z.infer<typeof esquemaCapturarProceso>;

/** Cuerpo para marcar/desmarcar un ítem de checklist (F5-E4). */
export const esquemaMarcarChecklist = z
  .object({
    hecho: z
      .boolean({ error: 'hecho debe ser verdadero o falso' })
      .describe('Nuevo valor del ítem.'),
  })
  .describe('Marcar o desmarcar un ítem de checklist de la ruta viva.');
/** Datos validados de marcado de checklist. */
export type DatosMarcarChecklist = z.infer<typeof esquemaMarcarChecklist>;

/** Estados del semáforo de cumplimiento (F5-E4). */
export const esquemaEstadoSemaforo = z.enum(['aTiempo', 'enRiesgo', 'atrasado']);

// ── Secuencia de estampado por orden (R4, B10) ────────────────────────────────

/**
 * Cuerpo para ELEGIR la secuencia de estampado de una orden FLEXIBLE (R4, B10): reprograma la
 * ruta viva en el momento (agrega/quita la dependencia "recibo de estampado → envío a costura"
 * y re-encola el CPM). Solo `antes` | `despues` (la flexibilidad es del MODELO, no una elección).
 */
export const esquemaSecuenciaEstampadoCuerpo = z
  .object({
    secuencia: z
      .enum(['antes', 'despues'], { error: 'La secuencia debe ser "antes" o "despues"' })
      .describe('¿El estampado va ANTES o DESPUÉS de coser?'),
  })
  .describe('Elección de secuencia de estampado de una orden flexible (reprograma en vivo).');
/** Datos validados de la elección de secuencia. */
export type DatosSecuenciaEstampado = z.infer<typeof esquemaSecuenciaEstampadoCuerpo>;

// ── Salida: la ruta viva de una orden ─────────────────────────────────────────

/** Un ítem de checklist de un proceso de la ruta viva. */
export const esquemaRutaChecklistSalida = z.object({
  id: z.number().int(),
  descripcion: z.string(),
  orden: z.number().int(),
  hecho: z.boolean(),
});

/** Un renglón (proceso) de la ruta viva en la salida. */
export const esquemaRutaProcesoSalida = z
  .object({
    id: z.number().int().describe('Id del renglón de ruta.'),
    idProcesoDef: z.number().int().describe('Id del proceso (ProcesoDef).'),
    codigoProceso: z.string(),
    nombreProceso: z.string(),
    secuencia: z.number().int(),
    critico: z.boolean(),
    ultimoProceso: z.boolean(),
    esResurtido: z.boolean(),
    condicionAplicabilidad: z.enum(['ninguna', 'soloSiLlevaAplicacion']),
    tipoEvento: z
      .enum([
        'recepcionTela',
        'corte',
        'envioCostura',
        'reciboCostura',
        'envioEstampado',
        'reciboEstampado',
        'auditoria',
        'autorizacionArte',
        'entregaCliente',
        'manual',
        // Bloque nuevo (cierre del hueco de emisores, post-F9): eventos que v2 ya emite.
        'revisionOp',
        'autorizacionFit',
        'autorizacionTono',
        'autorizacionAvios',
        'compraTela',
        'surtidoAvios',
        'auditoriaCorte',
        'empaque',
      ])
      .describe('Cómo se completa (R4): manual = a mano; el resto, auto por su evento de sistema.'),
    rolesResponsables: z
      .array(z.string())
      .describe('Nombres de los roles responsables del proceso (N:M, R4).'),
    esResponsableActual: z
      .boolean()
      .describe('¿Quien consulta es responsable de este proceso (o admin)? — badge "tú" (R4).'),
    duracionDias: z.number().int().describe('Duración estimada del proceso (días).'),
    acumuladoDias: z.number().int().nullable().describe('Días acumulados (lo llena el CPM, E4).'),
    fechaPlaneadaOriginal: z.iso.datetime().nullable().describe('Planeada original (CPM, E4).'),
    fechaPlaneadaVigente: z.iso.datetime().nullable().describe('Planeada vigente (CPM, E4).'),
    fechaReal: z.iso.datetime().nullable().describe('Fecha real de cumplimiento, o null.'),
    diasRestantes: z
      .number()
      .int()
      .nullable()
      .describe('Días naturales a la planeada vigente (negativo = vencido; null sin fecha) (R4).'),
    estado: z.enum(['pendiente', 'activo', 'completado']),
    capturadoPorId: z.string().nullable(),
    capturadoPorNombre: z
      .string()
      .nullable()
      .describe('Nombre de quién capturó el cumplimiento (resuelto del Usuario), o null (F5-E5).'),
    capturadoEn: z.iso.datetime().nullable(),
    origenCaptura: z.enum(['manual', 'evento']).nullable(),
    parcialEnCurso: z
      .boolean()
      .describe(
        '¿Hay una entrada PARCIAL en curso (auto-avance, F5-E6)? El proceso aún no se completa.',
      ),
    semaforo: esquemaEstadoSemaforo.describe(
      'Semáforo de cumplimiento del proceso (HOY vs planeada vigente) (F5-E4).',
    ),
    idsAntecesores: z.array(z.number().int()).describe('Antecesores en la ruta (idProcesoDef).'),
    checklist: z.array(esquemaRutaChecklistSalida),
  })
  .describe('Proceso de la ruta viva de una orden.');

/** La ruta viva COMPLETA de una orden. */
export const esquemaRutaOrdenSalida = z
  .object({
    idOrden: z.number().int(),
    rcActiva: z.boolean().describe('¿La RC está generada y vigente?'),
    fechaInicioRC: z.iso.datetime().nullable(),
    fechaEntregaRC: z.iso.datetime().nullable(),
    fechaProgramada: z.iso.datetime().nullable(),
    esResurtido: z.boolean(),
    idArticuloRC: z.number().int().nullable(),
    idTipoTela: z.number().int().nullable(),
    idAplicacion: z.number().int().nullable(),
    secuenciaEstampadoModelo: z
      .enum(['antes', 'despues', 'flexible'])
      .describe('Secuencia de estampado del MODELO (R4, B10).'),
    secEstampadoElegido: z
      .enum(['antes', 'despues'])
      .nullable()
      .describe('Elección de la orden (solo flexibles), o null si no se ha decidido.'),
    secuenciaEstampadoEfectiva: z
      .enum(['antes', 'despues'])
      .describe('Secuencia EFECTIVA planeada (elección > modelo; flexible sin elección = antes).'),
    motivoSinRuta: z
      .string()
      .nullable()
      .describe(
        'Si la orden no tiene ruta y la RC automática la omitió/falló (R3), el motivo en ' +
          'bitácora — para el CTA "Programar ahora" (R4). Null si hay ruta o no hay rastro.',
      ),
    estadoRecalculo: z
      .enum(['calculado', 'recalculando', 'sin-ruta'])
      .describe(
        'Estado del cálculo de fechas: "calculado" (fechas vigentes listas), "recalculando" (hay procesos sin fecha vigente; el CPM aún no terminó) o "sin-ruta" (F5-E4).',
      ),
    semaforo: esquemaEstadoSemaforo.describe(
      'Semáforo de cumplimiento de la orden (el peor de sus procesos) (F5-E4).',
    ),
    procesos: z.array(esquemaRutaProcesoSalida),
    advertencias: z.array(z.string()).describe('Avisos no fatales del cálculo de duraciones.'),
  })
  .describe('Ruta Crítica viva de una orden (F5-E3/E4).');
/** Forma de la ruta viva en la API. */
export type RutaOrdenSalida = z.infer<typeof esquemaRutaOrdenSalida>;
