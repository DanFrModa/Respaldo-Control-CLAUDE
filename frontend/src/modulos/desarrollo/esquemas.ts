import { z } from 'zod';

/**
 * Esquemas Zod de CAPTURA del módulo Desarrollo (F8-E2) — SÓLO para la UX de los formularios
 * (mensajes en español, requeridos). Reflejan las reglas del backend pero NO las reemplazan: el
 * servidor re-valida y es la autoridad (A1). Los ids se capturan como texto en los `<select>` y se
 * convierten a número al enviar.
 */

/** Formulario de alta/edición de un proyecto (cliente + departamento + nombre + temporada + notas). */
export const esquemaProyectoFormulario = z.object({
  idCliente: z.string().min(1, { error: 'Elige un cliente' }),
  idClienteDepartamento: z.string().min(1, { error: 'Elige un departamento' }),
  nombre: z.string().trim().min(1, { error: 'El nombre es obligatorio' }),
  idTemporada: z.string(),
  notas: z.string(),
});

/** Datos de captura de un proyecto. */
export type DatosProyectoFormulario = z.infer<typeof esquemaProyectoFormulario>;

/**
 * Formulario de alta de un desarrollo. `modo` decide si se liga un modelo EXISTENTE (`idModelo`) o
 * se crea uno NUEVO (`codigoNuevo` + `descripcionNuevo`); la validación cruzada la resuelve un
 * `superRefine` (según el modo, exige el campo correspondiente).
 */
export const esquemaDesarrolloFormulario = z
  .object({
    modo: z.enum(['existente', 'nuevo']),
    idModelo: z.string(),
    codigoNuevo: z.string(),
    descripcionNuevo: z.string(),
    numeroCliente: z.string(),
    notas: z.string(),
  })
  .superRefine((datos, ctx) => {
    if (datos.modo === 'existente' && datos.idModelo.trim() === '') {
      ctx.addIssue({ code: 'custom', path: ['idModelo'], message: 'Elige un modelo' });
    }
    if (datos.modo === 'nuevo' && datos.codigoNuevo.trim() === '') {
      ctx.addIssue({ code: 'custom', path: ['codigoNuevo'], message: 'El código es obligatorio' });
    }
  });

/** Datos de captura de un desarrollo. */
export type DatosDesarrolloFormulario = z.infer<typeof esquemaDesarrolloFormulario>;
