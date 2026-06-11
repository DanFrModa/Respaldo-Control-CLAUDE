import createClient, { type Middleware } from 'openapi-fetch';

import type { paths } from './esquema.gen';

/**
 * Cliente HTTP TIPADO del API de CONTROL v2, generado del contrato OpenAPI del
 * backend (`openapi-fetch` sobre los tipos `paths` de `esquema.gen.ts`). Todas
 * las rutas, parametros y respuestas se infieren del contrato: un cambio en el
 * backend que rompa el contrato se vuelve error de compilacion aqui.
 *
 * No incluye `/api/auth/*`: ese flujo (login/logout/sesion de cookies) lo maneja
 * el cliente de better-auth (`@/lib/auth-client`), que define su propio contrato.
 *
 * `baseUrl` es vacio (mismo origen): en produccion nginx proxya `/api` al
 * backend; en desarrollo lo hace el proxy de Vite. `credentials: 'include'`
 * envia la cookie de sesion de better-auth en cada peticion.
 */

/** Cabecera con la que el cliente elige su empresa activa (multi-empresa, A9). */
export const HEADER_EMPRESA_ACTIVA = 'x-empresa-activa';

const middlewareEmpresa: Middleware = {
  onRequest({ request }) {
    const id = empresaActivaPreferida;
    if (id !== null) {
      request.headers.set(HEADER_EMPRESA_ACTIVA, String(id));
    }
    return request;
  },
};

/**
 * Empresa activa preferida en memoria (la fija {@link fijarEmpresaActiva}). Por
 * defecto `null`: el backend resuelve la favorita. Multi-empresa explicito (A9);
 * el selector de empresa de una fase posterior llamara aqui.
 */
let empresaActivaPreferida: number | null = null;

/** Fija (o limpia con `null`) la empresa activa que se envia en cada peticion. */
export function fijarEmpresaActiva(id: number | null): void {
  empresaActivaPreferida = id;
}

export const api = createClient<paths>({
  baseUrl: '',
  credentials: 'include',
});

api.use(middlewareEmpresa);
