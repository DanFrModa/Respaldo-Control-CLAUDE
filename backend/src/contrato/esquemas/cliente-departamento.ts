import { z } from 'zod';

/**
 * Contrato Zod de ClienteDepartamento (F8-E1a, D13/R16 — Desarrollo y Cotización).
 *
 * Un cliente puede dividir su operación en DEPARTAMENTOS (p. ej. C&A → "NIÑOS",
 * "DAMAS"). Es el ESPEJO, más simple, de los campos de referencia del cliente
 * (`ClienteCampo`, D7): un sub-recurso del Cliente cuya clave de negocio es el
 * `nombre`, único DENTRO del cliente (insensible a mayúsculas). NO tiene `tipo`
 * ni `orden` (a diferencia de los campos): solo `nombre` + `activo`.
 *
 * Reglas de captura (las repite el dominio, A1): `nombre` obligatorio, único por
 * cliente; el cliente debe existir y estar ACTIVO para operar sus departamentos;
 * borrado SUAVE (`activo`) reversible. Semántica del PATCH parcial (M1): omitir un
 * campo (`undefined`) = no tocar. `nombre` NO es nullable (clave de negocio): si se
 * omite, no se toca; `activo` permite des/reactivar el departamento.
 */

// ── Departamento del cliente (D13/R16) ────────────────────────────────────────────

/**
 * Alta de un departamento de un cliente (D13/R16). `nombre` único DENTRO del
 * cliente (lo valida el dominio; insensible a mayúsculas).
 */
export const esquemaClienteDepartamentoCrear = z.object({
  nombre: z
    .string({ error: 'El nombre es obligatorio' })
    .trim()
    .min(1, { error: 'El nombre es obligatorio' })
    .max(100, { error: 'El nombre no puede tener más de 100 caracteres' }),
});

/** Datos validados de alta de departamento de cliente. */
export type DatosClienteDepartamentoCrear = z.infer<typeof esquemaClienteDepartamentoCrear>;

/**
 * Edición de un departamento: campos del alta opcionales + `id` y `activo`. `nombre`
 * NO es nullable (clave de negocio obligatoria): si se omite, no se toca; `activo`
 * permite des/reactivar el departamento.
 */
export const esquemaClienteDepartamentoEditar = esquemaClienteDepartamentoCrear.partial().extend({
  id: z
    .number({ error: 'El id del departamento es obligatorio' })
    .int({ error: 'El id del departamento debe ser entero' })
    .positive({ error: 'El id del departamento debe ser positivo' }),
  activo: z.boolean({ error: 'Activo debe ser verdadero o falso' }).optional(),
});

/** Datos validados de edición de departamento de cliente. */
export type DatosClienteDepartamentoEditar = z.infer<typeof esquemaClienteDepartamentoEditar>;

/** Salida de un departamento de cliente en la API. */
export const esquemaClienteDepartamentoSalida = z
  .object({
    id: z.number().int().describe('Id del departamento.'),
    idCliente: z.number().int().describe('Id del cliente dueño del departamento.'),
    nombre: z.string().describe('Nombre del departamento (único por cliente).'),
    activo: z.boolean().describe('Falso si está desactivado (borrado suave).'),
    creadoEn: z.iso.datetime().describe('Fecha de alta (ISO 8601).'),
    creadoPorId: z.string().nullable().describe('Id del usuario que lo creó.'),
    modificadoEn: z.iso.datetime().describe('Fecha de la última modificación (ISO 8601).'),
    modificadoPorId: z.string().nullable().describe('Id del último usuario que lo modificó.'),
  })
  .describe('Departamento de un cliente (D13/R16).');

/** Forma de un departamento de cliente tal como lo devuelve la API. */
export type ClienteDepartamentoSalida = z.infer<typeof esquemaClienteDepartamentoSalida>;

/** Lista de departamentos de un cliente (respuesta de `GET /clientes/:idCliente/departamentos`). */
export const esquemaClienteDepartamentosLista = z
  .object({
    datos: z.array(esquemaClienteDepartamentoSalida).describe('Departamentos del cliente.'),
  })
  .describe('Departamentos de un cliente (D13/R16).');

/** Forma de la lista de departamentos de un cliente. */
export type ClienteDepartamentosLista = z.infer<typeof esquemaClienteDepartamentosLista>;
