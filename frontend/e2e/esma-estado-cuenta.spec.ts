import { expect, test } from '@playwright/test';

import { entrarComoAdmin } from './ayudas';

/**
 * E2E de la experiencia de usuario de EsMa — estado de cuenta (F6-E5) contra el stack real. El flujo
 * contable profundo (cargo→saldo→abono→pago→PDF) lo cubren a fondo los tests de INTEGRACIÓN del
 * backend; sembrar por la UI una cuenta completa lo haría frágil (misma decisión que la spec de E4).
 * Aquí se verifica, contra el stack real, que las 5 pantallas cargan desde la portada y wirean sus
 * controles principales. Asume el admin sembrado (todos los permisos, incluido `esma.ver-pagos`).
 */
test.describe('EsMa — estado de cuenta (F6-E5)', () => {
  test('la portada muestra las tarjetas de la experiencia de usuario', async ({ page }) => {
    await entrarComoAdmin(page);
    // R1: EsMa es un desplegable (Finanzas · EsMa (maquileros)); su PORTADA-hub
    // ya no cuelga del menú y se visita por URL directa (la ruta sigue viva).
    await page.goto('/esma');

    await expect(page.getByRole('heading', { name: 'EsMa' })).toBeVisible();
    await expect(page.getByTestId('esma-estado-cuenta')).toBeVisible();
    await expect(page.getByTestId('esma-saldos')).toBeVisible();
    await expect(page.getByTestId('esma-desglosado')).toBeVisible();
  });

  test('el estado de cuenta carga con su selector de maquilero', async ({ page }) => {
    await entrarComoAdmin(page);
    await page.goto('/esma/estado-cuenta');

    await expect(page.getByRole('heading', { name: 'Estado de cuenta' })).toBeVisible();
    await expect(page.getByTestId('edc-tipo')).toBeVisible();
    await expect(page.getByTestId('edc-maquilero')).toBeVisible();
    // Sin maquilero elegido, invita a seleccionarlo.
    await expect(page.getByText(/Elige un maquilero para ver su estado de cuenta/i)).toBeVisible();
  });

  test('los saldos de maquileros cargan', async ({ page }) => {
    await entrarComoAdmin(page);
    await page.goto('/esma/saldos');

    await expect(page.getByRole('heading', { name: 'Saldos de maquileros' })).toBeVisible();
    await expect(page.getByTestId('saldos-segmento')).toBeVisible();
  });

  test('los pagos semanales navegan por semana', async ({ page }) => {
    await entrarComoAdmin(page);
    await page.goto('/esma/pagos-semanales');

    await expect(page.getByRole('heading', { name: 'Pagos semanales' })).toBeVisible();
    const rango = await page.getByTestId('pagsem-rango').textContent();
    await page.getByTestId('pagsem-anterior').click();
    // El rango de la semana debe cambiar al retroceder.
    await expect(page.getByTestId('pagsem-rango')).not.toHaveText(rango ?? '');
  });

  test('los recibos semanales cargan con sus filtros', async ({ page }) => {
    await entrarComoAdmin(page);
    await page.goto('/esma/recibos-semanales');

    await expect(page.getByRole('heading', { name: 'Recibos semanales de maquila' })).toBeVisible();
    await expect(page.getByTestId('recsem-desde')).toBeVisible();
  });

  test('el desglosado carga con su selector', async ({ page }) => {
    await entrarComoAdmin(page);
    await page.goto('/esma/desglosado');

    await expect(page.getByRole('heading', { name: 'Estado de cuenta desglosado' })).toBeVisible();
    await expect(page.getByTestId('desg-maquilero')).toBeVisible();
  });
});
