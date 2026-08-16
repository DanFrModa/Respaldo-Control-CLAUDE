import { expect, type Locator, type Page } from '@playwright/test';

/** Credenciales del admin sembrado (backend `prisma/seed.ts`) y su empresa. */
export const CREDENCIALES_ADMIN = {
  usuario: 'admin',
  password: 'Control.2026!',
  empresa: 'FR Moda',
} as const;

/**
 * Inicia sesion como admin desde la pantalla de login y espera a estar dentro de
 * la app (el Resumen operativo del rediseño R9, con la sesion del admin en el
 * menu de usuario). Lo usan las pruebas que parten de una sesion valida.
 */
export async function entrarComoAdmin(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Usuario').fill(CREDENCIALES_ADMIN.usuario);
  await page.getByLabel('Contraseña').fill(CREDENCIALES_ADMIN.password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: 'Resumen operativo' })).toBeVisible();
  await expect(page.getByTestId('menu-usuario')).toContainText('Administrador');
}

/**
 * Abre (si hace falta) un DESPLEGABLE del riel (rediseño R1) para poder clickear a sus hijos.
 * IDEMPOTENTE a propósito: el botón de un padre TOGGLEA, y el riel auto-abre al padre cuya ruta
 * está activa (p. ej. tras un `goto` a un hijo suyo, como `/catalogos/telas` bajo Catálogos);
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
 * Cierra el CAJÓN de detalle (rediseño R9, `[data-slot="cajon-detalle"]`) si está abierto, y espera
 * a que se desmonte. Es un Radix Dialog MODAL: mientras está abierto, su overlay + scroll-lock cubren
 * la lista y el encabezado, así que un `.click()` sobre un renglón o un botón del fondo NO se
 * estabiliza (el scroll-into-view de Playwright pelea con el scroll-lock → timeout "not stable"). Por
 * eso, en los CRUD de cajón (clientes/modelos/proveedores) se cierra el cajón ANTES de cada
 * interacción de fondo por CLIC (mismo patrón que `ordenes`/`pedidos`, que hacen `Escape`).
 * Idempotente: si no hay cajón abierto, no hace nada (Escape solo se manda si está montado).
 */
export async function cerrarCajon(page: Page): Promise<void> {
  const cajon = page.locator('[data-slot="cajon-detalle"]');
  if ((await cajon.count()) > 0) {
    await page.keyboard.press('Escape');
    await expect(cajon).toHaveCount(0);
  }
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

/**
 * Elige un CLIENTE en el combobox con búsqueda server-side (V1-E4 punto 7).
 *
 * Antes era un `<select>` alimentado de la primera página del catálogo (`porPagina: 100`, que
 * además es el tope del contrato de paginación): con ~117 clientes activos, los del final del
 * alfabeto NO APARECÍAN y quedaban inalcanzables — sin error, sin aviso. Ahora se teclea y el
 * servidor busca, así que la interacción del e2e cambió de `selectOption` a "teclear + elegir".
 *
 * `contenedor` acota la búsqueda del input (típicamente el diálogo); la LISTA de opciones se
 * renderiza en el mismo contenedor del combobox, pero se busca desde `page` porque puede escapar
 * del `<dialog>` en algunos layouts.
 */
export async function elegirCliente(
  page: Page,
  contenedor: Locator,
  nombre: string,
  testid = 'selector-cliente',
): Promise<void> {
  await contenedor.getByTestId(`${testid}-busqueda`).fill(nombre);
  await page.getByTestId(`${testid}-opcion`).first().click();
}
