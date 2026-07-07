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

/**
 * Abre (si hace falta) un DESPLEGABLE del riel (rediseño R1) para poder clickear a sus hijos.
 * IDEMPOTENTE a propósito: el botón de un padre TOGGLEA, y el riel auto-abre al padre cuya ruta
 * está activa (p. ej. tras un `goto` a un hijo suyo, como `/catalogos/bordados` bajo Desarrollo);
 * un click ciego en ese estado lo CERRARÍA y el hijo desaparecería (causa del timeout de
 * `modelos.spec` en CI, R1). Por eso solo clickea cuando `aria-expanded` no es `true`, y siempre
 * termina verificando que quedó abierto.
 */
export async function abrirDesplegableMenu(page: Page, nombre: string): Promise<void> {
  const boton = page
    .getByRole('navigation', { name: 'Módulos' })
    .first()
    .getByRole('button', { name: nombre, exact: true });
  if ((await boton.getAttribute('aria-expanded')) !== 'true') {
    await boton.click();
  }
  await expect(boton).toHaveAttribute('aria-expanded', 'true');
}

/**
 * Crea al vuelo un COLOR y una TALLA activos en los catálogos y devuelve sus etiquetas. Lo usan las
 * pruebas que arman una matriz color×talla (órdenes, movimientos/traspasos PT, entrega a cliente):
 * necesitan ≥1 color y ≥1 talla en el catálogo y NO deben depender del orden de la suite (antes
 * asumían, mal, que estaban "sembrados en F1"; el seed no siembra colores/tallas y `tallas.spec`
 * corre al final). Requiere una sesión de admin ya iniciada (`entrarComoAdmin`).
 */
export async function crearColorYTalla(
  page: Page,
  sufijo: string = Date.now().toString().slice(-6),
): Promise<{ color: string; talla: string }> {
  const color = `Color Matriz ${sufijo}`;
  const talla = `TM${sufijo}`;

  // ── Color (el diálogo de alta encadena varios: se cierra con "Listo") ────────
  await page.goto('/catalogos/colores');
  await expect(page.getByRole('heading', { name: 'Colores' })).toBeVisible();
  await page.getByTestId('nuevo-color').click();
  await page.getByRole('dialog').getByLabel('Nombre').fill(color);
  await page.getByTestId('guardar-color').click();
  await expect(page.getByText(`Color "${color}" creado.`)).toBeVisible();
  await page.getByTestId('listo-color').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // ── Talla (el diálogo de alta se cierra solo al guardar) ─────────────────────
  await page.goto('/catalogos/tallas');
  await expect(page.getByRole('heading', { name: 'Tallas' })).toBeVisible();
  await page.getByTestId('nuevo-talla').click();
  const dialogoTalla = page.getByRole('dialog');
  await expect(dialogoTalla.getByRole('heading', { name: 'Nueva talla' })).toBeVisible();
  await dialogoTalla.getByLabel('Etiqueta').fill(talla);
  await dialogoTalla.getByLabel('Orden de despliegue').fill('5');
  await page.getByTestId('guardar-talla').click();
  await expect(page.getByText(`Talla "${talla}" creada.`)).toBeVisible();

  return { color, talla };
}
