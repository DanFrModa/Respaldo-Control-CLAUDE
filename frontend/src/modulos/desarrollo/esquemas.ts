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
 * se crea uno NUEVO; la validación cruzada la resuelve un `superRefine`.
 *
 * ⚠️ En el modo NUEVO ya **no se teclea el código** (§Post-F9.34, V1-E3n): el `CYA-26-71-001` lo
 * arma el sistema con el cliente del proyecto, el año de ENTREGA y los dos dígitos del tipo de
 * prenda + género. Por eso esos tres campos son los obligatorios del modo nuevo.
 */
export const esquemaDesarrolloFormulario = z
  .object({
    modo: z.enum(['existente', 'nuevo']),
    idModelo: z.string(),
    descripcionNuevo: z.string(),
    idTipoProductoNuevo: z.string(),
    idGeneroNuevo: z.string(),
    anioEntregaNuevo: z.string(),
    numeroCliente: z.string(),
    notas: z.string(),
  })
  .superRefine((datos, ctx) => {
    if (datos.modo === 'existente' && datos.idModelo.trim() === '') {
      ctx.addIssue({ code: 'custom', path: ['idModelo'], message: 'Elige un modelo' });
    }
    if (datos.modo === 'nuevo') {
      if (datos.idTipoProductoNuevo.trim() === '') {
        ctx.addIssue({
          code: 'custom',
          path: ['idTipoProductoNuevo'],
          message: 'Elige el tipo de prenda',
        });
      }
      if (datos.idGeneroNuevo.trim() === '') {
        ctx.addIssue({ code: 'custom', path: ['idGeneroNuevo'], message: 'Elige el género' });
      }
      if (!/^\d{4}$/.test(datos.anioEntregaNuevo.trim())) {
        ctx.addIssue({
          code: 'custom',
          path: ['anioEntregaNuevo'],
          message: 'Captura el año de entrega (4 dígitos)',
        });
      }
    }
  });

/** Datos de captura de un desarrollo. */
export type DatosDesarrolloFormulario = z.infer<typeof esquemaDesarrolloFormulario>;
