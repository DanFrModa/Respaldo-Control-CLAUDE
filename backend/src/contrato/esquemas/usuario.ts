import { z } from 'zod';

/**
 * Reglas del nombre de usuario (login): minúsculas, sin acentos ni espacios.
 * El sistema viejo usaba nombres cortos en `Usuarios.Usuario`; en v2 se normaliza
 * a minúsculas (el plugin `username` de better-auth guarda la forma original en
 * `displayUsername`).
 */
const reglaUsername = z
  .string({ error: 'El usuario es obligatorio' })
  .trim()
  .toLowerCase()
  .min(3, { error: 'El usuario debe tener al menos 3 caracteres' })
  .max(30, { error: 'El usuario no puede tener más de 30 caracteres' })
  .regex(/^[a-z0-9._-]+$/, {
    error: 'El usuario solo puede llevar letras sin acento, números, punto, guion y guion bajo',
  });

/** Reglas de contraseña (A4: reemplaza las claves en texto plano del sistema viejo). */
const reglaPassword = z
  .string({ error: 'La contraseña es obligatoria' })
  .min(8, { error: 'La contraseña debe tener al menos 8 caracteres' })
  .max(128, { error: 'La contraseña no puede tener más de 128 caracteres' });

/**
 * Alta de usuario (módulo Administración, plan maestro §5 #13).
 * El email es opcional: si no se da, el backend genera el sintético
 * `<username>@control.local` (better-auth requiere email, pero el negocio no lo usa).
 * Los roles se asignan por id de rol (RBAC A4).
 */
export const esquemaUsuarioCrear = z.object({
  username: reglaUsername,
  nombre: z
    .string({ error: 'El nombre es obligatorio' })
    .trim()
    .min(1, { error: 'El nombre es obligatorio' })
    .max(100, { error: 'El nombre no puede tener más de 100 caracteres' }),
  email: z
    .email({ error: 'El correo no tiene un formato válido' })
    .max(254, { error: 'El correo no puede tener más de 254 caracteres' })
    .optional(),
  password: reglaPassword,
  esAuditor: z.boolean({ error: 'Es auditor debe ser verdadero o falso' }).default(false),
  idsRoles: z
    .array(
      z
        .number({ error: 'Cada rol debe ser un número' })
        .int({ error: 'Cada rol debe ser un id entero' })
        .positive({ error: 'Cada rol debe ser un id positivo' }),
      { error: 'Los roles deben ser una lista de ids' },
    )
    .default([]),
});

/** Datos validados de alta de usuario. */
export type DatosUsuarioCrear = z.infer<typeof esquemaUsuarioCrear>;

/**
 * Edición de usuario: datos generales y estado. El username NO se edita (es la
 * identidad histórica del usuario en bitácoras); la contraseña se cambia por un
 * flujo aparte (better-auth). `bloqueado: false` desbloquea y reinicia los intentos
 * fallidos (regla del servicio, doc 00 §1.1).
 */
export const esquemaUsuarioEditar = z.object({
  id: z
    .string({ error: 'El id del usuario es obligatorio' })
    .min(1, { error: 'El id del usuario es obligatorio' }),
  nombre: z
    .string({ error: 'El nombre debe ser texto' })
    .trim()
    .min(1, { error: 'El nombre no puede quedar vacío' })
    .max(100, { error: 'El nombre no puede tener más de 100 caracteres' })
    .optional(),
  email: z
    .email({ error: 'El correo no tiene un formato válido' })
    .max(254, { error: 'El correo no puede tener más de 254 caracteres' })
    .optional(),
  activo: z.boolean({ error: 'Activo debe ser verdadero o falso' }).optional(),
  bloqueado: z.boolean({ error: 'Bloqueado debe ser verdadero o falso' }).optional(),
  esAuditor: z.boolean({ error: 'Es auditor debe ser verdadero o falso' }).optional(),
  idsRoles: z
    .array(
      z
        .number({ error: 'Cada rol debe ser un número' })
        .int({ error: 'Cada rol debe ser un id entero' })
        .positive({ error: 'Cada rol debe ser un id positivo' }),
      { error: 'Los roles deben ser una lista de ids' },
    )
    .optional(),
});

/** Datos validados de edición de usuario. */
export type DatosUsuarioEditar = z.infer<typeof esquemaUsuarioEditar>;
