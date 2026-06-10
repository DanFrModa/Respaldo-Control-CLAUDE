import { z } from 'zod';

import { CLAVES_PERMISO } from '../permisos.js';

/**
 * Respuesta de `GET /api/sesion` (el "yo"/me): identidad del usuario en sesión,
 * su empresa activa y sus permisos efectivos. Con esto el frontend (E4) arma el
 * menú y esconde lo que el usuario no puede hacer (la decisión real es del
 * servidor en cada ruta, §9.2). Es parte del contrato OpenAPI.
 */
export const esquemaSesionActual = z
  .object({
    id: z.string().describe('Id del usuario en sesión.'),
    username: z.string().describe('Nombre de inicio de sesión (minúsculas).'),
    nombre: z.string().describe('Nombre para mostrar del usuario.'),
    empresaActiva: z
      .object({
        id: z.number().int().describe('Id de la empresa activa de la sesión.'),
        nombre: z.string().describe('Nombre de la empresa activa.'),
      })
      .describe('Empresa activa de la sesión (multi-empresa explícito).'),
    permisos: z
      .array(z.enum(CLAVES_PERMISO))
      .describe('Claves de permiso efectivas del usuario (unión de sus roles).'),
  })
  .describe('Usuario actualmente autenticado, su empresa activa y sus permisos.');

/** Forma de la respuesta de la sesión actual. */
export type SesionActual = z.infer<typeof esquemaSesionActual>;
