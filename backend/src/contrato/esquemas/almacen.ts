import { z } from 'zod';

/**
 * Tipos de almacén del kardex único (plan maestro §4 "Motor de inventario único", D3):
 * PT = producto terminado, TELA = telas, AVIO = avíos.
 * Debe mantenerse alineado con el enum `TipoAlmacen` de `src/datos`.
 */
export const TIPOS_ALMACEN = ['PT', 'TELA', 'AVIO'] as const;

/** Clave de tipo de almacén. */
export type TipoAlmacenClave = (typeof TIPOS_ALMACEN)[number];

/** Etiquetas para UI de cada tipo de almacén. */
export const ETIQUETAS_TIPO_ALMACEN: Record<TipoAlmacenClave, string> = {
  PT: 'Producto terminado',
  TELA: 'Telas',
  AVIO: 'Avíos',
};

/**
 * Alta de almacén (CRUD patrón de F0, plan maestro §6 criterio de salida).
 * `idEmpresa` es opcional: un almacén puede ser global o de una empresa (A9).
 */
export const esquemaAlmacenCrear = z.object({
  nombre: z
    .string({ error: 'El nombre es obligatorio' })
    .trim()
    .min(1, { error: 'El nombre es obligatorio' })
    .max(100, { error: 'El nombre no puede tener más de 100 caracteres' }),
  tipo: z.enum(TIPOS_ALMACEN, {
    error: 'El tipo debe ser PT (producto terminado), TELA o AVIO',
  }),
  idEmpresa: z
    .number({ error: 'La empresa debe ser un número' })
    .int({ error: 'La empresa debe ser un id entero' })
    .positive({ error: 'La empresa debe ser un id positivo' })
    .optional(),
});

/** Datos validados de alta de almacén. */
export type DatosAlmacenCrear = z.infer<typeof esquemaAlmacenCrear>;

/**
 * Edición de almacén: todos los campos del alta son opcionales (edición parcial)
 * más `activo` para el borrado suave (plan §4, patrón conservado: nada se borra físicamente).
 */
export const esquemaAlmacenEditar = esquemaAlmacenCrear.partial().extend({
  id: z
    .number({ error: 'El id del almacén es obligatorio' })
    .int({ error: 'El id del almacén debe ser entero' })
    .positive({ error: 'El id del almacén debe ser positivo' }),
  activo: z.boolean({ error: 'Activo debe ser verdadero o falso' }).optional(),
});

/** Datos validados de edición de almacén. */
export type DatosAlmacenEditar = z.infer<typeof esquemaAlmacenEditar>;
