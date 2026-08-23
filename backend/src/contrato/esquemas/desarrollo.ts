import { z } from 'zod';

/**
 * Contrato Zod de los DESARROLLOS (F8-E2, D13/R16 — Desarrollo y Cotización).
 *
 * Un `Desarrollo` es un modelo DENTRO de un proyecto de desarrollo, con DOS números: el nuestro
 * (`Modelo.codigo`) y el del cliente (`numeroCliente`, que se captura). Es la unidad que después
 * se precostea (E3), entra a una lista de precios (E4) y se liga a la orden de producción (E6).
 *
 * El ESTADO del desarrollo es DERIVADO (como `EstadoOrden`): no se captura ni se edita — lo calcula
 * el dominio leyendo las relaciones (precostos congelados, renglones de lista, órdenes ligadas) y
 * el borrado suave (`apagado`). En E2 esas relaciones aún están vacías (llegan en E3/E4/E6): un
 * desarrollo nuevo nace `en-desarrollo` y sólo puede pasar a `apagado`.
 *
 * Reglas de captura (las repite el dominio, A1): `idModelo` obligatorio (un modelo del catálogo);
 * `numeroCliente`/`notas` opcionales. Semántica del PATCH parcial (M1): omitir (`undefined`) = no
 * tocar; mandar `null` en un opcional = vaciarlo.
 */

// ── Estado DERIVADO del desarrollo ─────────────────────────────────────────────────

/**
 * Estados DERIVADOS de un desarrollo, del menos al más avanzado (`apagado` corta el flujo). El
 * dominio los calcula por precedencia: `apagado` > `ligado-produccion` (≥1 orden) > `en-lista`
 * (≥1 renglón de lista) > `cotizado` (≥1 precosto congelado) > `en-desarrollo` (default).
 */
export const ESTADOS_DESARROLLO = [
  'en-desarrollo',
  'cotizado',
  'en-lista',
  'ligado-produccion',
  'apagado',
] as const;

/** Estado derivado de un desarrollo (string kebab estable). */
export const esquemaEstadoDesarrollo = z
  .enum(ESTADOS_DESARROLLO)
  .describe('Estado DERIVADO del desarrollo (calculado por el dominio, no editable).');

/** Clave del estado derivado de un desarrollo. */
export type EstadoDesarrolloClave = z.infer<typeof esquemaEstadoDesarrollo>;

// ── Alta / edición ─────────────────────────────────────────────────────────────────

/** Número del cliente para el modelo (el "otro número"; texto libre). */
const numeroClienteCampo = z
  .string()
  .trim()
  .max(100, { error: 'El número del cliente no puede tener más de 100 caracteres' });

/** Notas libres del desarrollo. */
const notasDesarrollo = z
  .string()
  .trim()
  .max(2000, { error: 'Las notas no pueden tener más de 2000 caracteres' });

/**
 * Alta de un desarrollo dentro de un proyecto (D13/R16). El `idProyecto` va en la URL (no en el
 * cuerpo). `idModelo` referencia un modelo EXISTENTE del catálogo; el flujo "modelo nuevo" lo
 * orquesta el frontend (crea primero el modelo y luego el desarrollo con su id). Un modelo no se
 * repite dentro de un proyecto (unique proyecto+modelo, lo respalda la BD).
 */
export const esquemaDesarrolloCrear = z.object({
  idModelo: z
    .number({ error: 'El modelo es obligatorio' })
    .int({ error: 'El id del modelo debe ser entero' })
    .positive({ error: 'El id del modelo debe ser positivo' })
    .describe('Modelo del catálogo que se desarrolla (Modelo.id).'),
  numeroCliente: numeroClienteCampo
    .optional()
    .describe('Número del cliente para este modelo (el "otro número"; opcional).'),
  notas: notasDesarrollo.optional().describe('Notas del desarrollo (opcional).'),
});

/** Datos validados de alta de desarrollo. */
export type DatosDesarrolloCrear = z.infer<typeof esquemaDesarrolloCrear>;

/**
 * Alta de un desarrollo CON UN MODELO NUEVO (§Post-F9.34, V1-E3n). El código del modelo **NO se
 * captura**: lo arma el sistema entero (`CYA-26-71-001` = abreviatura del cliente del proyecto +
 * año de ENTREGA + concepto/género + consecutivo), porque es mecánico y no tiene criterio de
 * negocio. Por eso el tipo de producto y el género son OBLIGATORIOS aquí: de ellos salen los dos
 * dígitos que después heredará el número de producción.
 */
export const esquemaDesarrolloModeloNuevoCuerpo = z.object({
  anioEntrega: z
    .number({ error: 'El año de entrega es obligatorio' })
    .int({ error: 'El año de entrega debe ser entero' })
    .min(2020, { error: 'El año de entrega no puede ser anterior a 2020' })
    .max(2100, { error: 'El año de entrega no puede ser posterior a 2100' })
    .describe('Año de ENTREGA del modelo (el que se congela en el código, no el de creación).'),
  idTipoProducto: z
    .number({ error: 'El tipo de producto es obligatorio' })
    .int({ error: 'El id del tipo de producto debe ser entero' })
    .positive({ error: 'El id del tipo de producto debe ser positivo' })
    .describe('Tipo de prenda: de él sale el 1er dígito (concepto) de la nomenclatura.'),
  idGenero: z
    .number({ error: 'El género es obligatorio' })
    .int({ error: 'El id del género debe ser entero' })
    .positive({ error: 'El id del género debe ser positivo' })
    .describe('Género: de él sale el 2º dígito de la nomenclatura.'),
  descripcion: z
    .string()
    .trim()
    .max(500, { error: 'La descripción no puede tener más de 500 caracteres' })
    .optional()
    .describe('Descripción del modelo (opcional).'),
  idCurvaTalla: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Curva de tallas del modelo (opcional).'),
  numeroCliente: numeroClienteCampo
    .optional()
    .describe('Número del cliente para este modelo (el "otro número"; opcional).'),
  notas: notasDesarrollo.optional().describe('Notas del desarrollo (opcional).'),
});

/** Datos validados de alta de desarrollo con modelo nuevo. */
export type DatosDesarrolloModeloNuevo = z.infer<typeof esquemaDesarrolloModeloNuevoCuerpo>;

/**
 * Edición de un desarrollo: sólo `numeroCliente` y `notas` (el modelo y el proyecto NO se cambian;
 * el estado es derivado). PATCH parcial (M1): omitir = no tocar; `null` = vaciar. El `id` va en la
 * URL.
 */
export const esquemaDesarrolloEditar = z.object({
  numeroCliente: numeroClienteCampo
    .nullable()
    .optional()
    .describe('Número del cliente (null para vaciarlo; omitir para no tocar).'),
  notas: notasDesarrollo
    .nullable()
    .optional()
    .describe('Notas del desarrollo (null para vaciarlas; omitir para no tocar).'),
});

/** Datos validados de edición de desarrollo. */
export type DatosDesarrolloEditar = z.infer<typeof esquemaDesarrolloEditar>;

/**
 * Cuerpo de APAGAR un desarrollo (borrado suave con motivo, reversible; NUNCA se borra). El motivo
 * es OBLIGATORIO (queda auditado con quién/cuándo). Reactivar no lleva cuerpo.
 */
export const esquemaDesarrolloApagarCuerpo = z.object({
  motivo: z
    .string({ error: 'El motivo es obligatorio' })
    .trim()
    .min(1, { error: 'El motivo es obligatorio' })
    .max(500, { error: 'El motivo no puede tener más de 500 caracteres' })
    .describe('Motivo por el que se apaga el desarrollo (queda auditado).'),
});

/** Datos validados del cuerpo de apagar un desarrollo. */
export type DatosDesarrolloApagar = z.infer<typeof esquemaDesarrolloApagarCuerpo>;

// ── Salida ───────────────────────────────────────────────────────────────────────

/** Salida de un desarrollo en la API (proyección del modelo Prisma a JSON, con el estado derivado). */
export const esquemaDesarrolloSalida = z
  .object({
    id: z.number().int().describe('Id del desarrollo.'),
    idProyecto: z.number().int().describe('Proyecto al que pertenece.'),
    // El CLIENTE del desarrollo NO se captura ni se guarda aquí: se LEE del proyecto (su dueño
    // natural, Cliente + Departamento). Viaja en la salida porque el precosteo va DIRIGIDO a un
    // cliente y la ficha/pantalla del precosto tienen que decir a cuál (petición de Daniel).
    idCliente: z.number().int().describe('Cliente del proyecto (heredado, no se captura aquí).'),
    cliente: z.string().describe('Nombre del cliente del proyecto (para la UI).'),
    idClienteDepartamento: z.number().int().describe('Departamento del cliente (del proyecto).'),
    departamento: z.string().describe('Nombre del departamento del cliente (para la UI).'),
    idModelo: z.number().int().describe('Modelo del catálogo (nuestro número).'),
    codigoModelo: z.string().describe('Código del modelo (nuestro número, para la UI).'),
    descripcionModelo: z.string().nullable().describe('Descripción del modelo, o null.'),
    numeroCliente: z.string().nullable().describe('Número del cliente para el modelo, o null.'),
    notas: z.string().nullable().describe('Notas del desarrollo, o null.'),
    estado: esquemaEstadoDesarrollo,
    apagado: z.boolean().describe('Borrado suave: el desarrollo se conserva pero no cuenta.'),
    apagadoEn: z.iso.datetime().nullable().describe('Cuándo se apagó (ISO 8601), o null.'),
    apagadoPorId: z.string().nullable().describe('Quién lo apagó, o null.'),
    motivoApagado: z.string().nullable().describe('Motivo por el que se apagó, o null.'),
    creadoEn: z.iso.datetime().describe('Fecha de alta (ISO 8601).'),
    creadoPorId: z.string().nullable().describe('Id del usuario que lo creó.'),
    modificadoEn: z.iso.datetime().describe('Fecha de la última modificación (ISO 8601).'),
    modificadoPorId: z.string().nullable().describe('Id del último usuario que lo modificó.'),
  })
  .describe('Desarrollo (un modelo dentro de un proyecto de desarrollo).');

/** Forma de un desarrollo en la API. */
export type DesarrolloSalida = z.infer<typeof esquemaDesarrolloSalida>;
