import { devices, expect, test, type Page } from '@playwright/test';

import { entrarComoAdmin } from './ayudas';

/**
 * E2E de la GALERÍA de fotos de modelos (F1-E5) contra el stack real, en VIEWPORT MÓVIL (la
 * vista prioritaria: enseñar producto fuera de la oficina). Verifica que la galería carga, que
 * un modelo CON foto muestra su miniatura y uno SIN foto el placeholder NoFoto, que la búsqueda
 * filtra, y que tocar una tarjeta abre la ficha del modelo (pantalla de Modelos).
 *
 * NOTA: requiere que la integración haya cableado el menú (Galería de modelos) y la ruta
 * `/modelos/galeria` en App.tsx; de lo contrario estas pruebas se omiten en CI hasta el cierre.
 */

// PNG 1x1 mínimo en memoria (sin archivo en disco), para subir una foto de modelo.
const PNG_MINIMO = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

/** Crea un modelo mínimo desde su pantalla y deja seleccionada su ficha. */
async function crearModelo(page: Page, codigo: string): Promise<void> {
  await page.goto('/modelos');
  await expect(page.getByRole('heading', { name: 'Modelos' })).toBeVisible();
  await page.getByTestId('nuevo-modelo').click();
  const dialogo = page.getByRole('dialog');
  await dialogo.getByLabel('Código').fill(codigo);
  await page.getByTestId('guardar-modelo').click();
  await expect(page.getByText(`Modelo "${codigo}" creado.`)).toBeVisible();
}

test.describe('Galería de modelos (móvil)', () => {
  // Viewport de teléfono: la vista prioritaria de esta pantalla.
  test.use({ viewport: devices['Pixel 7'].viewport });

  test('lista modelos con foto y NoFoto, busca y al tocar abre la ficha', async ({ page }) => {
    const sufijo = Date.now().toString().slice(-6);
    const conFoto = `GAL-${sufijo}`;
    const sinFoto = `NOF-${sufijo}`;

    await entrarComoAdmin(page);

    // Modelo SIN foto.
    await crearModelo(page, sinFoto);

    // Modelo CON foto: se sube mockeando SOLO el PUT a R2 (la URL prefirmada externa).
    await crearModelo(page, conFoto);
    await page.getByTestId('buscar-modelo').fill(conFoto);
    await page.getByTestId('fila-modelo').filter({ hasText: conFoto }).click();
    const detalle = page.getByTestId('detalle-modelo');
    await page.route('**/*', (route) => {
      const peticion = route.request();
      const esPutAR2 = peticion.method() === 'PUT' && !peticion.url().includes('/api/');
      return esPutAR2 ? route.fulfill({ status: 200 }) : route.fallback();
    });
    await detalle.getByTestId('archivo-foto-modelo').setInputFiles({
      name: 'frente.png',
      mimeType: 'image/png',
      buffer: PNG_MINIMO,
    });
    await expect(page.getByText('Foto agregada.')).toBeVisible();

    // ── Navega a la galería por el menú lateral (Sheet en móvil) ────────────────
    await page.getByRole('button', { name: 'Abrir menú' }).click();
    await page.getByRole('link', { name: 'Galería de modelos' }).click();
    await expect(page.getByRole('heading', { name: 'Galería de modelos' })).toBeVisible();

    // ── El modelo CON foto: su celda muestra la miniatura (no el placeholder) ────
    await page.getByTestId('buscar-galeria-modelo').fill(conFoto);
    const celdaConFoto = page.getByTestId('celda-galeria-modelo').filter({ hasText: conFoto });
    await expect(celdaConFoto).toBeVisible();
    await expect(celdaConFoto.getByTestId('miniatura-modelo-foto')).toBeVisible();

    // ── El modelo SIN foto: su celda muestra el placeholder NoFoto ───────────────
    await page.getByTestId('buscar-galeria-modelo').fill(sinFoto);
    const celdaSinFoto = page.getByTestId('celda-galeria-modelo').filter({ hasText: sinFoto });
    await expect(celdaSinFoto).toBeVisible();
    await expect(celdaSinFoto.getByTestId('miniatura-modelo-sin-foto')).toBeVisible();

    // ── Búsqueda sin resultados ──────────────────────────────────────────────────
    await page.getByTestId('buscar-galeria-modelo').fill('zzz-no-existe-zzz');
    await expect(page.getByText('No hay modelos que coincidan con la búsqueda.')).toBeVisible();

    // ── Al tocar una tarjeta, abre la ficha (pantalla de Modelos) ───────────────
    await page.getByTestId('buscar-galeria-modelo').fill(conFoto);
    await page.getByTestId('celda-galeria-modelo').filter({ hasText: conFoto }).click();
    await expect(page.getByRole('heading', { name: 'Modelos' })).toBeVisible();
  });
});
