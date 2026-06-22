import { z } from 'zod';

/**
 * Esquemas Zod de PLANTILLAS DE RUTA, REGLAS DE DURACIÓN y CALENDARIO LABORAL de la Ruta Crítica
 * (Módulo 8, F5-E2; doc `08-Ruta-Critica.md` §2.1 y §4 capacidad 5; D10/D11). Una sola definición
 * de reglas de captura para UI y servidor (alimenta el OpenAPI).
 *
 *  • Familias y artículos RC (ex CP_Familia / CP_Articulos) — catálogos simples.
 *  • Plantillas de ruta (ex CP_Tiempos) — qué procesos lleva un artículo/familia, su tiempo
 *    estándar y su encadenamiento PROPIO (DAG; rechazo de ciclos en el dominio).
 *  • Reglas de duración: factor por cantidad (CP_Cant), días por tipo de tela (RC_TipoTelas) y
 *    días por aplicación (RC_Aplicaciones).
 *  • Calendario laboral por empresa: días hábiles de la semana + festivos (decisión (a)).
 */

// ── Campos base ──────────────────────────────────────────────────────────────

const nombre = z
  .string({ error: 'El nombre es obligatorio' })
  .trim()
  .min(1, { error: 'El nombre es obligatorio' })
  .max(200, { error: 'El nombre no puede tener más de 200 caracteres' });

const idPositivo = z
  .number({ error: 'El id debe ser un número' })
  .int({ error: 'El id debe ser entero' })
  .positive({ error: 'El id debe ser positivo' });

const idParamPositivo = z.coerce
  .number({ error: 'El id debe ser un número' })
  .int({ error: 'El id debe ser entero' })
  .positive({ error: 'El id debe ser positivo' });

const auditoriaSalida = {
  creadoEn: z.iso.datetime().describe('Fecha de alta (ISO 8601).'),
  creadoPorId: z.string().nullable().describe('Id del usuario que lo creó.'),
  modificadoEn: z.iso.datetime().describe('Fecha de la última modificación (ISO 8601).'),
  modificadoPorId: z.string().nullable().describe('Id del último usuario que lo modificó.'),
};

/** Parámetro de ruta `:id` (entero positivo, coaccionado). */
export const esquemaParamIdRc = z.object({ id: idParamPositivo.describe('Id del recurso.') });

/** Querystring común de los listados de catálogo de F5-E2 (incluir inactivos). */
export const esquemaListarRcQuery = z
  .object({
    incluirInactivos: z
      .stringbool()
      .default(false)
      .describe('Incluye los desactivados ("true"/"false").'),
  })
  .describe('Filtros del listado.');
/** Parámetros del listado ya coaccionados. */
export type ListarRcQuery = z.infer<typeof esquemaListarRcQuery>;

// ── Familias de artículos (ex CP_Familia) ────────────────────────────────────

/** Alta/edición de una familia de artículos. */
export const esquemaFamiliaCrear = z.object({ nombre });
/** Datos validados de alta de familia. */
export type DatosFamiliaCrear = z.infer<typeof esquemaFamiliaCrear>;

/** Edición parcial de familia + `activo` (borrado suave). */
export const esquemaFamiliaPatchCuerpo = z.object({
  nombre: nombre.optional(),
  activo: z.boolean({ error: 'Activo debe ser verdadero o falso' }).optional(),
});
/** Datos validados de edición de familia. */
export type DatosFamiliaPatchCuerpo = z.infer<typeof esquemaFamiliaPatchCuerpo>;

/** Salida de una familia de artículos. */
export const esquemaFamiliaSalida = z
  .object({
    id: z.number().int().describe('Id de la familia.'),
    nombre: z.string().describe('Nombre de la familia.'),
    activo: z.boolean().describe('Falso si está desactivada (borrado suave).'),
    ...auditoriaSalida,
  })
  .describe('Familia de artículos de la RC (catálogo global).');
/** Forma de una familia en la API. */
export type FamiliaSalida = z.infer<typeof esquemaFamiliaSalida>;

// ── Artículos RC (ex CP_Articulos) ───────────────────────────────────────────

/** Alta de un artículo RC (tipo de artículo del CPM). */
export const esquemaArticuloCrear = z.object({
  nombre,
  idFamiliaArticulo: idPositivo.describe('Id de la familia a la que pertenece.'),
});
/** Datos validados de alta de artículo. */
export type DatosArticuloCrear = z.infer<typeof esquemaArticuloCrear>;

/** Edición parcial de artículo + `activo` (borrado suave). */
export const esquemaArticuloPatchCuerpo = z.object({
  nombre: nombre.optional(),
  idFamiliaArticulo: idPositivo.optional(),
  activo: z.boolean({ error: 'Activo debe ser verdadero o falso' }).optional(),
});
/** Datos validados de edición de artículo. */
export type DatosArticuloPatchCuerpo = z.infer<typeof esquemaArticuloPatchCuerpo>;

/** Salida de un artículo RC. */
export const esquemaArticuloSalida = z
  .object({
    id: z.number().int().describe('Id del artículo.'),
    nombre: z.string().describe('Nombre del artículo.'),
    idFamiliaArticulo: z.number().int().describe('Id de la familia.'),
    familia: z.string().describe('Nombre de la familia (para mostrar).'),
    activo: z.boolean().describe('Falso si está desactivado (borrado suave).'),
    ...auditoriaSalida,
  })
  .describe('Tipo de artículo de la RC (catálogo global).');
/** Forma de un artículo en la API. */
export type ArticuloSalida = z.infer<typeof esquemaArticuloSalida>;

// ── Plantillas de ruta (ex CP_Tiempos) ───────────────────────────────────────

/**
 * Un renglón de la plantilla en la CAPTURA: el proceso (por id de `ProcesoDef`), su tiempo estándar
 * en días y sus antecesores DENTRO de la plantilla (también por id de proceso). El encadenamiento
 * puede diferir del DAG genérico (decisión de diseño F5-E2). El dominio valida que sea acíclico.
 */
export const esquemaPlantillaProcesoEntrada = z.object({
  idProcesoDef: idPositivo.describe('Id del proceso del catálogo (ProcesoDef).'),
  tiempoEstandar: z
    .number({ error: 'El tiempo estándar es obligatorio' })
    .int({ error: 'El tiempo estándar debe ser entero (días)' })
    .min(0, { error: 'El tiempo estándar no puede ser negativo' })
    .max(3650, { error: 'El tiempo estándar no puede superar 3650 días' })
    .describe('Tiempo estándar del proceso en esta plantilla (días).'),
  idsAntecesores: z
    .array(idPositivo)
    .default([])
    .describe('Ids de los procesos (ProcesoDef) que anteceden a este renglón EN LA PLANTILLA.'),
});
/** Datos validados de un renglón de plantilla. */
export type DatosPlantillaProcesoEntrada = z.infer<typeof esquemaPlantillaProcesoEntrada>;

/**
 * Alta de una plantilla de ruta. Identifica a qué aplica por familia y/o artículo (ambos
 * opcionales). Los procesos y su encadenamiento van en `procesos` (set completo).
 */
export const esquemaPlantillaCrear = z.object({
  nombre,
  idFamiliaArticulo: idPositivo.nullish().describe('Familia a la que aplica (opcional).'),
  idArticuloRC: idPositivo.nullish().describe('Artículo concreto al que aplica (opcional).'),
  procesos: z
    .array(esquemaPlantillaProcesoEntrada)
    .max(200, { error: 'La plantilla no puede tener más de 200 procesos' })
    .default([])
    .describe('Procesos de la plantilla con su tiempo estándar y encadenamiento propio.'),
});
/** Datos validados de alta de plantilla. */
export type DatosPlantillaCrear = z.infer<typeof esquemaPlantillaCrear>;

/** Edición de una plantilla: reemplaza encabezado y/o el set completo de procesos; `activo`. */
export const esquemaPlantillaPatchCuerpo = z.object({
  nombre: nombre.optional(),
  idFamiliaArticulo: idPositivo.nullish(),
  idArticuloRC: idPositivo.nullish(),
  procesos: z
    .array(esquemaPlantillaProcesoEntrada)
    .max(200, { error: 'La plantilla no puede tener más de 200 procesos' })
    .optional()
    .describe('Si viene, REEMPLAZA el set completo de procesos y su encadenamiento.'),
  activo: z.boolean({ error: 'Activo debe ser verdadero o falso' }).optional(),
});
/** Datos validados de edición de plantilla. */
export type DatosPlantillaPatchCuerpo = z.infer<typeof esquemaPlantillaPatchCuerpo>;

/** Un renglón de plantilla en la salida (con datos del proceso y sus antecesores). */
export const esquemaPlantillaProcesoSalida = z
  .object({
    id: z.number().int().describe('Id del renglón de la plantilla.'),
    idProcesoDef: z.number().int().describe('Id del proceso (ProcesoDef).'),
    codigoProceso: z.string().describe('Código del proceso.'),
    nombreProceso: z.string().describe('Nombre del proceso.'),
    tiempoEstandar: z.number().int().describe('Tiempo estándar en días.'),
    orden: z.number().int().describe('Posición del renglón en la plantilla.'),
    idsAntecesores: z
      .array(z.number().int())
      .describe('Ids de los procesos (ProcesoDef) que lo anteceden en la plantilla.'),
  })
  .describe('Renglón (proceso) de una plantilla de ruta.');
/** Forma de un renglón de plantilla en la API. */
export type PlantillaProcesoSalida = z.infer<typeof esquemaPlantillaProcesoSalida>;

/** Salida de una plantilla de ruta completa (con sus procesos). */
export const esquemaPlantillaSalida = z
  .object({
    id: z.number().int().describe('Id de la plantilla.'),
    nombre: z.string().describe('Nombre de la plantilla.'),
    idFamiliaArticulo: z.number().int().nullable().describe('Familia a la que aplica, o null.'),
    familia: z.string().nullable().describe('Nombre de la familia, o null.'),
    idArticuloRC: z.number().int().nullable().describe('Artículo al que aplica, o null.'),
    articulo: z.string().nullable().describe('Nombre del artículo, o null.'),
    activo: z.boolean().describe('Falso si está desactivada (borrado suave).'),
    procesos: z.array(esquemaPlantillaProcesoSalida).describe('Procesos de la plantilla en orden.'),
    ...auditoriaSalida,
  })
  .describe('Plantilla de ruta de la RC (catálogo global).');
/** Forma de una plantilla en la API. */
export type PlantillaSalida = z.infer<typeof esquemaPlantillaSalida>;

// ── Reglas de duración: factor por cantidad (ex CP_Cant) ──────────────────────

const factorDecimal = z
  .number({ error: 'El factor es obligatorio' })
  .min(0, { error: 'El factor no puede ser negativo' })
  .max(1000, { error: 'El factor es demasiado grande' });

/** Alta de un factor por rango de cantidad. */
export const esquemaFactorCantidadCrear = z.object({
  deCant: z
    .number({ error: 'El límite inferior es obligatorio' })
    .int()
    .min(0, { error: 'El límite inferior no puede ser negativo' })
    .describe('Límite inferior del rango (inclusive).'),
  aCant: z
    .number({ error: 'El límite superior es obligatorio' })
    .int()
    .min(0, { error: 'El límite superior no puede ser negativo' })
    .describe('Límite superior del rango (inclusive).'),
  factor: factorDecimal.describe('Factor multiplicador del rango.'),
});
/** Datos validados de alta de factor por cantidad. */
export type DatosFactorCantidadCrear = z.infer<typeof esquemaFactorCantidadCrear>;

/** Edición parcial de un factor por cantidad + `activo`. */
export const esquemaFactorCantidadPatchCuerpo = z.object({
  deCant: z.number().int().min(0).optional(),
  aCant: z.number().int().min(0).optional(),
  factor: factorDecimal.optional(),
  activo: z.boolean().optional(),
});
/** Datos validados de edición de factor por cantidad. */
export type DatosFactorCantidadPatchCuerpo = z.infer<typeof esquemaFactorCantidadPatchCuerpo>;

/** Salida de un factor por cantidad. */
export const esquemaFactorCantidadSalida = z
  .object({
    id: z.number().int(),
    deCant: z.number().int().describe('Límite inferior (inclusive).'),
    aCant: z.number().int().describe('Límite superior (inclusive).'),
    factor: z.number().describe('Factor multiplicador.'),
    activo: z.boolean(),
    ...auditoriaSalida,
  })
  .describe('Factor de duración por rango de cantidad (ex CP_Cant).');
/** Forma de un factor por cantidad en la API. */
export type FactorCantidadSalida = z.infer<typeof esquemaFactorCantidadSalida>;

// ── Reglas de duración: días por tipo de tela (ex RC_TipoTelas) ───────────────

const dias = z
  .number({ error: 'Los días son obligatorios' })
  .int({ error: 'Los días deben ser un entero' })
  .min(0, { error: 'Los días no pueden ser negativos' })
  .max(3650, { error: 'Los días no pueden superar 3650' });

/** Alta de duración por tipo de tela. */
export const esquemaDuracionTelaCrear = z.object({
  nombre,
  dias: dias.describe('Días de espera que suma este tipo de tela.'),
  factorTela: factorDecimal.describe('Factor de la tela (se conserva aunque el viejo no lo use).'),
});
/** Datos validados de alta de duración por tela. */
export type DatosDuracionTelaCrear = z.infer<typeof esquemaDuracionTelaCrear>;

/** Edición parcial de duración por tela + `activo`. */
export const esquemaDuracionTelaPatchCuerpo = z.object({
  nombre: nombre.optional(),
  dias: dias.optional(),
  factorTela: factorDecimal.optional(),
  activo: z.boolean().optional(),
});
/** Datos validados de edición de duración por tela. */
export type DatosDuracionTelaPatchCuerpo = z.infer<typeof esquemaDuracionTelaPatchCuerpo>;

/** Salida de una duración por tipo de tela. */
export const esquemaDuracionTelaSalida = z
  .object({
    id: z.number().int(),
    nombre: z.string(),
    dias: z.number().int(),
    factorTela: z.number(),
    activo: z.boolean(),
    ...auditoriaSalida,
  })
  .describe('Días de espera por tipo de tela (ex RC_TipoTelas).');
/** Forma de una duración por tela en la API. */
export type DuracionTelaSalida = z.infer<typeof esquemaDuracionTelaSalida>;

// ── Reglas de duración: días por aplicación (ex RC_Aplicaciones) ──────────────

const claveAplicacion = z
  .string()
  .trim()
  .max(20, { error: 'La clave no puede tener más de 20 caracteres' });

/** Alta de duración por aplicación. */
export const esquemaDuracionAplicacionCrear = z.object({
  nombre,
  clave: claveAplicacion.nullish().describe('Clave corta (ej. "A1"), opcional.'),
  dias: dias.describe('Días de espera que suma esta aplicación.'),
  factor: factorDecimal.nullish().describe('Factor (no existe en el origen; opcional).'),
});
/** Datos validados de alta de duración por aplicación. */
export type DatosDuracionAplicacionCrear = z.infer<typeof esquemaDuracionAplicacionCrear>;

/** Edición parcial de duración por aplicación + `activo`. */
export const esquemaDuracionAplicacionPatchCuerpo = z.object({
  nombre: nombre.optional(),
  clave: claveAplicacion.nullish(),
  dias: dias.optional(),
  factor: factorDecimal.nullish(),
  activo: z.boolean().optional(),
});
/** Datos validados de edición de duración por aplicación. */
export type DatosDuracionAplicacionPatchCuerpo = z.infer<
  typeof esquemaDuracionAplicacionPatchCuerpo
>;

/** Salida de una duración por aplicación. */
export const esquemaDuracionAplicacionSalida = z
  .object({
    id: z.number().int(),
    nombre: z.string(),
    clave: z.string().nullable(),
    dias: z.number().int(),
    factor: z.number().nullable(),
    activo: z.boolean(),
    ...auditoriaSalida,
  })
  .describe('Días de espera por aplicación (ex RC_Aplicaciones).');
/** Forma de una duración por aplicación en la API. */
export type DuracionAplicacionSalida = z.infer<typeof esquemaDuracionAplicacionSalida>;

// ── Calendario laboral por empresa (decisión (a)) ─────────────────────────────

/** Días hábiles de la semana de una empresa (set completo; reemplaza el actual). */
export const esquemaCalendarioActualizar = z
  .object({
    lunes: z.boolean(),
    martes: z.boolean(),
    miercoles: z.boolean(),
    jueves: z.boolean(),
    viernes: z.boolean(),
    sabado: z.boolean(),
    domingo: z.boolean(),
  })
  .describe('Qué días de la semana son hábiles para la empresa.');
/** Datos validados del calendario. */
export type DatosCalendarioActualizar = z.infer<typeof esquemaCalendarioActualizar>;

/** Salida del calendario laboral de una empresa. */
export const esquemaCalendarioSalida = z
  .object({
    idEmpresa: z.number().int(),
    lunes: z.boolean(),
    martes: z.boolean(),
    miercoles: z.boolean(),
    jueves: z.boolean(),
    viernes: z.boolean(),
    sabado: z.boolean(),
    domingo: z.boolean(),
    ...auditoriaSalida,
  })
  .describe('Calendario laboral de una empresa (días hábiles de la semana).');
/** Forma del calendario en la API. */
export type CalendarioSalida = z.infer<typeof esquemaCalendarioSalida>;

/** Querystring para listar festivos de una empresa. */
export const esquemaFestivosQuery = z
  .object({
    idEmpresa: idParamPositivo.describe('Empresa de la que se listan los festivos.'),
    incluirInactivos: z.stringbool().default(false).describe('Incluye los desactivados.'),
  })
  .describe('Filtros del listado de festivos.');
/** Parámetros del listado de festivos ya coaccionados. */
export type FestivosQuery = z.infer<typeof esquemaFestivosQuery>;

/** Alta de un día festivo de una empresa. */
export const esquemaFestivoCrear = z.object({
  idEmpresa: idPositivo.describe('Empresa a la que pertenece el festivo.'),
  fecha: z.iso
    .date({ error: 'La fecha debe ser YYYY-MM-DD' })
    .describe('Fecha del festivo (YYYY-MM-DD).'),
  descripcion: z
    .string({ error: 'La descripción es obligatoria' })
    .trim()
    .min(1, { error: 'La descripción es obligatoria' })
    .max(200, { error: 'La descripción no puede tener más de 200 caracteres' }),
});
/** Datos validados de alta de festivo. */
export type DatosFestivoCrear = z.infer<typeof esquemaFestivoCrear>;

/** Edición parcial de un festivo + `activo`. */
export const esquemaFestivoPatchCuerpo = z.object({
  fecha: z.iso.date({ error: 'La fecha debe ser YYYY-MM-DD' }).optional(),
  descripcion: z.string().trim().min(1).max(200).optional(),
  activo: z.boolean().optional(),
});
/** Datos validados de edición de festivo. */
export type DatosFestivoPatchCuerpo = z.infer<typeof esquemaFestivoPatchCuerpo>;

/** Salida de un día festivo. */
export const esquemaFestivoSalida = z
  .object({
    id: z.number().int(),
    idEmpresa: z.number().int(),
    fecha: z.iso.date().describe('Fecha del festivo (YYYY-MM-DD).'),
    descripcion: z.string(),
    activo: z.boolean(),
    ...auditoriaSalida,
  })
  .describe('Día festivo de una empresa (no laborable).');
/** Forma de un festivo en la API. */
export type FestivoSalida = z.infer<typeof esquemaFestivoSalida>;
