import { z } from 'zod';

/**
 * Esquemas Zod de ENTRADA del frontend (validacion de captura para una UX clara).
 *
 * Reflejan las reglas de captura del backend (`backend/src/contrato/esquemas`),
 * pero son SOLO para la experiencia de usuario: el servidor SIEMPRE re-valida y
 * es la autoridad (A1). Se definen aqui (no se importan del backend) para que el
 * build del frontend sea autonomo —la imagen de Docker no alcanza `../backend`—;
 * el unico contrato compartido son los TIPOS generados del OpenAPI
 * (`esquema.gen.ts`). Si el backend cambia una regla, se ajusta aqui en la misma
 * tarea (igual que se regenera el cliente).
 */

// ── Login (espejo de `esquemaLogin` del backend) ────────────────────────────
export const esquemaLogin = z.object({
  username: z
    .string({ error: 'El usuario es obligatorio' })
    .trim()
    .min(1, { error: 'El usuario es obligatorio' })
    .max(30, { error: 'El usuario no puede tener más de 30 caracteres' }),
  password: z
    .string({ error: 'La contraseña es obligatoria' })
    .min(1, { error: 'La contraseña es obligatoria' })
    .max(128, { error: 'La contraseña no puede tener más de 128 caracteres' }),
});

/** Datos del formulario de login. */
export type DatosLogin = z.infer<typeof esquemaLogin>;

// ── Almacenes (espejo de `esquemaAlmacenCrear`/`Editar` del backend) ─────────

/** Tipos de almacen del kardex unico (PT, telas, avios). */
export const TIPOS_ALMACEN = ['PT', 'TELA', 'AVIO'] as const;

/** Clave de tipo de almacen. */
export type TipoAlmacenClave = (typeof TIPOS_ALMACEN)[number];

/** Etiquetas para UI de cada tipo de almacen. */
export const ETIQUETAS_TIPO_ALMACEN: Record<TipoAlmacenClave, string> = {
  PT: 'Producto terminado',
  TELA: 'Telas',
  AVIO: 'Avíos',
};

/**
 * Captura del formulario de almacen (alta y edicion comparten forma). El backend
 * distingue alta (POST) de edicion (PATCH); en el formulario el `tipo` siempre se
 * elige y el `nombre` siempre se captura, asi que ambos son obligatorios aqui.
 */
export const esquemaAlmacenFormulario = z.object({
  nombre: z
    .string({ error: 'El nombre es obligatorio' })
    .trim()
    .min(1, { error: 'El nombre es obligatorio' })
    .max(100, { error: 'El nombre no puede tener más de 100 caracteres' }),
  tipo: z.enum(TIPOS_ALMACEN, {
    error: 'El tipo debe ser PT (producto terminado), TELA o AVIO',
  }),
});

/** Datos del formulario de almacen. */
export type DatosAlmacenFormulario = z.infer<typeof esquemaAlmacenFormulario>;
