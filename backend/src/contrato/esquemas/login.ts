import { z } from 'zod';

/**
 * Esquema de entrada del login (usuario + contraseña).
 *
 * Reproduce la pantalla de entrada del sistema viejo (doc `00-Arranque-Login-y-Menu.md`
 * §1.1, form `USUARIOS`) con validación compartida front/back (plan maestro §1, Zod).
 * El bloqueo por intentos fallidos NO se valida aquí: es regla de negocio del servicio
 * de autenticación (campos `bloqueado`/`intentosFallidos` de `Usuario`).
 */
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

/** Datos validados del login. */
export type DatosLogin = z.infer<typeof esquemaLogin>;
