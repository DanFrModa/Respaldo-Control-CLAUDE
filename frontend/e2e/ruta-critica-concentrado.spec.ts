import { expect, test } from '@playwright/test';

import { entrarComoAdmin } from './ayudas';

/**
 * E2E del CONCENTRADO "planeado vs real" de la Ruta Crítica (F5-E7) contra el stack real, en el
 * estándar teal. Es una consulta gerencial de SOLO LECTURA (reemplaza `RC_ConcentradoDif`): se
 * verifica que se llega desde la portada-hub, que el tablero carga (vacío o con datos, sin que la
 * BD de e2e tenga que tener órdenes con RC viva), que el filtro de cliente responde y que el botón
 * de export a Excel ofrece el binario. El segundo test lo verifica en viewport MÓVIL.
 *
 * NO arma el ciclo de RC de extremo a extremo (eso lo cubre `ruta-critica-motor.spec.ts`): aquí
 * basta con que la pantalla viva y sea operable; el contenido lo cubren los tests de integración del
 * backend (`concentrado.int.test.ts`).
 */
test.describe('Ruta Crítica — concentrado planeado vs real (F5-E7)', () => {
  test('se llega desde la portada-hub y el tablero carga con sus filtros + export Excel', async ({
    page,
  }) => {
    await entrarComoAdmin(page);

    // Desde la portada-hub de la Ruta Crítica hay una tarjeta del concentrado.
    await page.goto('/ruta-critica');
    await expect(page.getByRole('heading', { name: 'Ruta Crítica' })).toBeVisible();
    await page.getByTestId('ruta-critica-rc-concentrado').click();

    await expect(page.getByRole('heading', { name: 'Concentrado planeado vs real' })).toBeVisible();

    // El tablero termina de cargar (deja de mostrar "Cargando…"): o lista filas o el estado vacío.
    await expect(page.getByTestId('concentrado-cargando')).toHaveCount(0);
    const filas = page.getByTestId('concentrado-filas');
    const vacio = page.getByTestId('concentrado-vacio');
    await expect(filas.or(vacio)).toBeVisible();

    // El resumen por semáforo y el orden están presentes; el buscador de cliente responde.
    await expect(page.getByTestId('concentrado-resumen')).toBeVisible();
    await expect(page.getByTestId('concentrado-orden')).toBeVisible();
    await page.getByTestId('concentrado-buscar-cliente').fill('zzz-no-existe');
    await expect(page.getByTestId('concentrado-vacio')).toBeVisible();

    // El export a Excel descarga un .xlsx (binario server-side; mismo filtro que el tablero).
    const descargaPromesa = page.waitForEvent('download');
    await page.getByTestId('concentrado-excel').click();
    const descarga = await descargaPromesa;
    expect(descarga.suggestedFilename()).toMatch(/\.xlsx$/);
  });

  test('el concentrado funciona en viewport móvil', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await entrarComoAdmin(page);

    await page.goto('/ruta-critica/concentrado');
    await expect(page.getByRole('heading', { name: 'Concentrado planeado vs real' })).toBeVisible();
    // En móvil se ve el buscador y el tablero sin que se desborde.
    await expect(page.getByTestId('concentrado-buscar-cliente')).toBeVisible();
  });
});
