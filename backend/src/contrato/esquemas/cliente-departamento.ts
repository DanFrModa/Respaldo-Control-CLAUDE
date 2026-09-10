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

// ── FUSIÓN de departamentos duplicados (§Post-F9.122(a)) ──────────────────────────

/**
 * Fusión de departamentos SINÓNIMOS de un mismo cliente (§Post-F9.122(a)): se elige el que SE QUEDA
 * (`idDestino`, el canónico) y se marcan los que se ABSORBEN (`origenes`). Todo lo que colgaba de los
 * absorbidos —proyectos, listas de precios, cotizaciones y factores— pasa a apuntar al canónico, y
 * los absorbidos quedan DESACTIVADOS (borrado suave; nada se borra, D3).
 *
 * Nace porque el importador de OC crea un departamento por cada texto nuevo que trae la OC
 * (`"2-HOMBRE"` vs `"Caballeros"`) y el catálogo se llena de sinónimos; como la LISTA DE PRECIOS
 * cuelga de cliente + departamento, eso parte el trabajo en dos mundos que no se ven entre sí.
 *
 * `origenes` es ≥1 (varios sinónimos de golpe), sin el destino dentro y sin repetir. Es el ESPEJO de
 * `esquemaColorFusionar` (F1-E6), del que sale el patrón.
 */
export const esquemaClienteDepartamentoFusionar = z
  .object({
    idDestino: z
      .number({ error: 'El departamento que se conserva es obligatorio' })
      .int({ error: 'El id del departamento que se conserva debe ser entero' })
      .positive({ error: 'El id del departamento que se conserva debe ser positivo' })
      .describe('Id del departamento CANÓNICO que se conserva (destino de la fusión).'),
    origenes: z
      .array(
        z
          .number({ error: 'Cada departamento a fusionar debe ser un número' })
          .int({ error: 'El id de un departamento a fusionar debe ser entero' })
          .positive({ error: 'El id de un departamento a fusionar debe ser positivo' }),
      )
      .min(1, { error: 'Elige al menos un departamento duplicado para fusionar' })
      .max(50, { error: 'No se pueden fusionar más de 50 departamentos de una vez' })
      .describe('Ids de los departamentos DUPLICADOS que se absorben en el destino.'),
  })
  .refine((datos) => !datos.origenes.includes(datos.idDestino), {
    error: 'El departamento que se conserva no puede estar también en la lista de duplicados',
    path: ['origenes'],
  })
  .refine((datos) => new Set(datos.origenes).size === datos.origenes.length, {
    error: 'No repitas un departamento en la lista de duplicados',
    path: ['origenes'],
  })
  .describe('Fusión de departamentos duplicados: absorbidos → departamento canónico.');

/** Datos validados de una fusión de departamentos. */
export type DatosClienteDepartamentoFusionar = z.infer<typeof esquemaClienteDepartamentoFusionar>;

/** Un uso que cuelga de un departamento: qué relación es, cómo se le dice y cuántos renglones son. */
export const esquemaUsoDeDepartamento = z
  .object({
    relacion: z.string().describe('Nombre técnico de la relación en el modelo de datos.'),
    etiqueta: z.string().describe('Cómo se le dice al usuario (p. ej. "listas de precios").'),
    cuenta: z.number().int().describe('Cuántos renglones cuelgan hoy de ese departamento.'),
  })
  .describe('Lo que cuelga de un departamento y se va a repuntar al canónico.');

/**
 * VISTA PREVIA de la fusión: qué va a pasar ANTES de hacerlo. Por cada departamento a absorber, el
 * inventario de lo que se va a mover y si sus factores van a descartarse.
 *
 * ⚠️ **No trae los VALORES de los factores**, sólo si se descartan: los cuatro porcentajes son del
 * DUEÑO (`listas.aprobar`, §Post-F9.125) y esta pantalla la abre quien administra clientes. Los
 * valores descartados quedan en la bitácora.
 */
export const esquemaFusionDepartamentosPrevia = z
  .object({
    destino: z
      .object({
        id: z.number().int().describe('Id del departamento que se conserva.'),
        nombre: z.string().describe('Nombre del departamento que se conserva.'),
      })
      .describe('El departamento CANÓNICO que sobrevive.'),
    origenes: z
      .array(
        z.object({
          id: z.number().int().describe('Id del departamento que se absorbe.'),
          nombre: z.string().describe('Nombre del departamento que se absorbe.'),
          usos: z.array(esquemaUsoDeDepartamento).describe('Lo que cuelga de él (incluye ceros).'),
          factoresSeDescartan: z
            .boolean()
            .describe(
              'Verdadero si él y el canónico tienen factores propios: ganan los del canónico y los suyos se registran en la bitácora antes de retirarse.',
            ),
        }),
      )
      .describe('Los departamentos que se absorben, con su inventario.'),
    totales: z
      .array(esquemaUsoDeDepartamento)
      .describe('Suma por relación de todo lo que se va a mover al canónico.'),
  })
  .describe('Vista previa de una fusión de departamentos (§Post-F9.122a).');

/** Forma de la vista previa de una fusión de departamentos. */
export type FusionDepartamentosPrevia = z.infer<typeof esquemaFusionDepartamentosPrevia>;
