import { usernameClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

/**
 * Cliente de better-auth para el navegador. Maneja SOLO el flujo de
 * autenticacion por cookie (login por usuario, cierre de sesion): el resto del
 * API se consume con el cliente tipado del OpenAPI (`@/api/cliente`).
 *
 * - Sin `baseURL`: mismo origen. En produccion nginx proxya `/api/auth/*` al
 *   backend; en desarrollo lo hace el proxy de Vite.
 * - Plugin `username`: el login es por usuario+contraseña (no email), igual que
 *   el sistema viejo (form `USUARIOS`). Expone `authClient.signIn.username`.
 */
export const authClient = createAuthClient({
  plugins: [usernameClient()],
});

export { traducirErrorAuth } from './mensajes-auth';
