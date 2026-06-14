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

/**
 * Reasignación del conjunto de roles del usuario (lo enviado REEMPLAZA al
 * actual — `asignarRoles` del dominio). El `id` del usuario va en la URL.
 */
export const esquemaUsuarioAsignarRoles = z.object({
  idsRoles: z
    .array(
      z
        .number({ error: 'Cada rol debe ser un número' })
        .int({ error: 'Cada rol debe ser un id entero' })
        .positive({ error: 'Cada rol debe ser un id positivo' }),
      { error: 'Los roles deben ser una lista de ids' },
    )
    .describe('Ids de los roles que quedarán asignados (reemplazan a los actuales).'),
});

/** Datos validados de reasignación de roles. */
export type DatosUsuarioAsignarRoles = z.infer<typeof esquemaUsuarioAsignarRoles>;

/**
 * Cambio de contraseña por un administrador (reset, NO el flujo self-service de
 * better-auth: aquí no se exige la contraseña actual). El `id` del usuario va en
 * la URL; la nueva contraseña cumple las mismas reglas que el alta.
 */
export const esquemaUsuarioCambiarContrasena = z.object({
  password: reglaPassword.describe('Nueva contraseña (mín. 8 caracteres).'),
});

/** Datos validados del cambio de contraseña. */
export type DatosUsuarioCambiarContrasena = z.infer<typeof esquemaUsuarioCambiarContrasena>;

/**
 * Salida de un usuario en la API (lo que ve el frontend): datos de dominio +
 * estado + roles aplanados. NUNCA expone el hash de contraseña ni datos de
 * autenticación (la selección del dominio ni los toca). Parte del contrato OpenAPI.
 */
export const esquemaUsuarioSalida = z
  .object({
    id: z.string().describe('Id del usuario (cuid).'),
    username: z.string().describe('Nombre de inicio de sesión (normalizado a minúsculas).'),
    nombre: z.string().describe('Nombre completo de la persona.'),
    email: z.string().describe('Correo (puede ser sintético `<username>@control.local`).'),
    activo: z.boolean().describe('Falso si está desactivado (borrado suave).'),
    bloqueado: z.boolean().describe('Verdadero si quedó bloqueado por intentos fallidos.'),
    intentosFallidos: z.number().int().describe('Intentos de login fallidos acumulados.'),
    esAuditor: z.boolean().describe('Bandera de auditor de calidad.'),
    creadoEn: z.iso.datetime().describe('Fecha de alta (ISO 8601).'),
    modificadoEn: z.iso.datetime().describe('Fecha de la última modificación (ISO 8601).'),
    roles: z
      .array(
        z.object({
          id: z.number().int().describe('Id del rol.'),
          nombre: z.string().describe('Nombre del rol.'),
        }),
      )
      .describe('Roles asignados al usuario (RBAC A4).'),
  })
  .describe('Usuario del sistema (sin datos de autenticación).');

/** Forma de un usuario tal como lo devuelve la API. */
export type UsuarioSalida = z.infer<typeof esquemaUsuarioSalida>;

/**
 * Parámetros del listado de usuarios EN LA URL (querystring): todo llega como
 * texto, así que se coaccionan números y banderas. Mapea 1:1 al servicio de
 * dominio `listarUsuarios`. `.describe()` documenta el contrato.
 */
export const esquemaUsuariosQuery = z
  .object({
    pagina: z.coerce.number().int().min(1).default(1).describe('Página (1-based).'),
    porPagina: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .default(20)
      .describe('Renglones por página (máx 100).'),
    busqueda: z
      .string()
      .trim()
      .max(100)
      .optional()
      .describe('Texto a buscar en usuario y nombre (insensible a mayúsculas).'),
    incluirInactivos: z
      .stringbool()
      .default(false)
      .describe('Incluye los desactivados ("true"/"false").'),
    soloBloqueados: z
      .stringbool()
      .default(false)
      .describe('Solo los bloqueados por intentos ("true"/"false").'),
    ordenarPor: z
      .enum(['username', 'nombre', 'creadoEn'])
      .default('username')
      .describe('Columna de ordenamiento.'),
    direccion: z.enum(['asc', 'desc']).default('asc').describe('Dirección del orden.'),
  })
  .describe('Filtros, orden y paginación del listado de usuarios.');

/** Parámetros de listado de usuarios ya coaccionados desde la URL. */
export type UsuariosQuery = z.infer<typeof esquemaUsuariosQuery>;

/** Respuesta paginada del listado de usuarios (forma estándar `Pagina<T>`). */
export const esquemaUsuariosPagina = z
  .object({
    datos: z.array(esquemaUsuarioSalida).describe('Usuarios de la página.'),
    total: z.number().int().describe('Total de usuarios que cumplen el filtro.'),
    pagina: z.number().int().describe('Página devuelta.'),
    porPagina: z.number().int().describe('Renglones por página.'),
    totalPaginas: z.number().int().describe('Total de páginas.'),
  })
  .describe('Página de usuarios.');

/** Forma de la respuesta paginada de usuarios. */
export type UsuariosPagina = z.infer<typeof esquemaUsuariosPagina>;
