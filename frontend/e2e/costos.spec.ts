import { expect, test } from '@playwright/test';

import { entrarComoAdmin } from './ayudas';

/**
 * E2E del módulo COSTOS (F7-E1) contra el stack real. El flujo transaccional del costeo (teórico =
 * receta × precios × cortado, guardar arma el total, base de prorrateo cambia el unitario, rechazo de
 * `noCostear`, márgenes = 1 − costo/precio, ocultamiento de importes) está cubierto A FONDO por los
 * tests de INTEGRACIÓN (`backend/src/dominio/costos/costos.int.test.ts`, Postgres efímero en CI).
 * Costear una orden punta-a-punta por la UI exige sembrar modelo+receta+pedido+orden+corte, lo que lo
 * haría frágil y dependiente del estado (mismo criterio que `recibos-maquila.spec.ts`). Por eso aquí
 * el E2E verifica, contra el stack real, que las pantallas cargan, exigen sesión/permiso y wirean sus
 * controles principales (el admin sembrado trae todos los permisos, incl. `costos.*`/`precostos.*`).
 */
test.describe('Costos (F7-E1)', () => {
  test('la portada de Costos muestra sus secciones', async ({ page }) => {
    await entrarComoAdmin(page);
    await page.goto('/costos');
    await expect(page.getByRole('heading', { name: 'Costos', exact: true })).toBeVisible();
    await expect(page.getByTestId('costos-pre-costo')).toBeVisible();
    await expect(page.getByTestId('costos-costeo-orden')).toBeVisible();
    await expect(page.getByTestId('costos-margenes')).toBeVisible();
  });

  test('Pre-costo por modelo carga y wirea el buscador', async ({ page }) => {
    await entrarComoAdmin(page);
    await page.goto('/costos/pre-costo');
    await expect(page.getByRole('heading', { name: 'Pre-costo por modelo' })).toBeVisible();
    await expect(page.getByTestId('pre-costo-buscar')).toBeVisible();
  });

  test('Lista de precios carga con su filtro de género y botón de PDF', async ({ page }) => {
    await entrarComoAdmin(page);
    await page.goto('/costos/lista-precios');
    await expect(page.getByRole('heading', { name: 'Lista de precios' })).toBeVisible();
    await expect(page.getByTestId('lp-genero')).toBeVisible();
    await expect(page.getByTestId('lp-imprimir')).toBeVisible();
  });

  test('Costeo de orden carga y wirea el buscador de orden', async ({ page }) => {
    await entrarComoAdmin(page);
    await page.goto('/costos/costeo');
    await expect(page.getByRole('heading', { name: 'Costeo de orden' })).toBeVisible();
    // El costeo arranca eligiendo una orden (el detalle + costo unitario aparecen al elegirla; el
    // cálculo del unitario está cubierto por el test de integración del dominio).
    await expect(page.getByTestId('costeo-buscar')).toBeVisible();
  });

  test('Lista de costos y Márgenes por pedido cargan con sus controles', async ({ page }) => {
    await entrarComoAdmin(page);
    await page.goto('/costos/lista');
    await expect(page.getByRole('heading', { name: 'Lista de costos' })).toBeVisible();
    await expect(page.getByTestId('lc-buscar')).toBeVisible();

    await page.goto('/costos/margenes');
    await expect(page.getByRole('heading', { name: 'Costos y márgenes por pedido' })).toBeVisible();
    await expect(page.getByTestId('mg-pdf')).toBeVisible();
    await expect(page.getByTestId('mg-excel')).toBeVisible();
  });
});
