import { expect, type Page } from '@playwright/test';

/** Credenciales del admin sembrado (backend `prisma/seed.ts`) y su empresa. */
export const CREDENCIALES_ADMIN = {
  usuario: 'admin',
  password: 'Control.2026!',
  empresa: 'FR Moda',
} as const;

/**
 * Inicia sesion como admin desde la pantalla de login y espera a estar dentro de
 * la app (inicio con el saludo). Lo usan las pruebas que parten de una sesion
 * valida.
 */
export async function entrarComoAdmin(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Usuario').fill(CREDENCIALES_ADMIN.usuario);
  await page.getByLabel('Contraseña').fill(CREDENCIALES_ADMIN.password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: /Hola, Administrador/ })).toBeVisible();
}
