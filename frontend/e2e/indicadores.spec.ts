import { expect, test } from '@playwright/test';

import { entrarComoAdmin, RC_APAGADA } from './ayudas';

/**
 * E2E del módulo INDICADORES (F7-E3) contra el stack real. Las fórmulas (% a tiempo, lead time,
 * calidad por maquilero, WIP) están cubiertas A FONDO por los tests de INTEGRACIÓN
 * (`backend/src/dominio/indicadores/indicadores.int.test.ts`, Postgres efímero en CI). Aquí se
 * verifica, punta a punta, que las pantallas cargan y sus controles están presentes. El motor de jobs
 * está INACTIVO en e2e, así que las vistas materializadas pueden estar vacías (el sello "datos al:"
 * viene de la fila sembrada en la migración): las pantallas deben cargar igual. El admin sembrado trae
 * todos los permisos (incl. `indicadores.ver`).
 */
test.describe('Indicadores (F7-E3)', () => {
  test('la portada muestra los tableros vigentes', async ({ page }) => {
    await entrarComoAdmin(page);
    await page.goto('/indicadores');
    await expect(page.getByRole('heading', { name: 'Indicadores' })).toBeVisible();
    await expect(page.getByTestId('indicadores-calidad')).toBeVisible();
    await expect(page.getByTestId('indicadores-wip')).toBeVisible();
    // ⭐ V1-E3t: los KPIs de Ruta Crítica piden LAS DOS llaves (`indicadores.ver` + `rc.ruta-ver`);
    // con la RC apagada (§Post-F9.36 punto 1) la segunda no existe y la tarjeta se va con ella.
    await expect(page.getByTestId('indicadores-ruta-critica')).toHaveCount(RC_APAGADA ? 0 : 1);
  });

  // ⭐ V1-E3t — §Post-F9.68 pide TRES capas: esconder, cerrar la ruta y bloquear el servidor. La
  // tarjeta escondida es sólo la primera; esto prueba la segunda, tecleando la URL a pelo.
  test('con la RC apagada, teclear la URL del tablero de RC no abre la pantalla', async ({
    page,
  }) => {
    test.skip(!RC_APAGADA, 'Sólo aplica con la Ruta Crítica apagada.');
    await entrarComoAdmin(page);
    await page.goto('/indicadores/ruta-critica');
    await expect(page.getByTestId('pantalla-no-disponible')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'KPIs de Ruta Crítica' })).toHaveCount(0);
  });

  test('el tablero de Ruta Crítica carga con filtros y acciones', async ({ page }) => {
    test.skip(RC_APAGADA, 'La Ruta Crítica está apagada en la v1 (V1-E3t, §Post-F9.36 punto 1).');
    await entrarComoAdmin(page);
    await page.goto('/indicadores/ruta-critica');
    await expect(page.getByRole('heading', { name: 'KPIs de Ruta Crítica' })).toBeVisible();
    await expect(page.getByTestId('rc-datos-al')).toBeVisible();
    await expect(page.getByTestId('rc-pct')).toBeVisible();
    await expect(page.getByTestId('rc-pdf')).toBeVisible();

    // Filtrar por un periodo (no rompe aunque no haya datos) y refrescar (encola y regresa).
    await page.getByTestId('rc-anio').fill('2026');
    await page.getByTestId('rc-mes').selectOption('6');
    await page.getByTestId('rc-refrescar').click();
    await expect(page.getByTestId('rc-pct')).toBeVisible();
  });

  test('el tablero de calidad carga con sus controles', async ({ page }) => {
    await entrarComoAdmin(page);
    await page.goto('/indicadores/calidad');
    await expect(page.getByRole('heading', { name: 'Calidad por maquilero' })).toBeVisible();
    await expect(page.getByTestId('cal-datos-al')).toBeVisible();
    await expect(page.getByTestId('cal-excel')).toBeVisible();
  });

  test('el tablero WIP carga con sus totales por etapa', async ({ page }) => {
    await entrarComoAdmin(page);
    await page.goto('/indicadores/wip');
    await expect(page.getByRole('heading', { name: 'WIP analítico' })).toBeVisible();
    await expect(page.getByTestId('wip-por-cortar')).toBeVisible();
    await expect(page.getByTestId('wip-por-entregar')).toBeVisible();
  });
});
