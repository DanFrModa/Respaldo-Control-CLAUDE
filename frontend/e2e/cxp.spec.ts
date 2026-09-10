import { expect, test } from '@playwright/test';

import { entrarComoAdmin } from './ayudas';

/**
 * E2E de CxP — cuentas por pagar (F9-E2) contra el stack real. El flujo contable profundo
 * (cargo→saldo→pago→aging→PDF) lo cubren a fondo los tests de INTEGRACIÓN del backend; aquí se
 * verifica, contra el stack real, que las pantallas cargan desde su ruta y wirean sus controles
 * principales. Asume el admin sembrado (todos los permisos, incl. `cxp.ver`/`cxp.administrar`).
 */
test.describe('CxP — cuentas por pagar (F9-E2)', () => {
  test('la bandeja "por pagar" carga con sus KPIs y filtros', async ({ page }) => {
    await entrarComoAdmin(page);
    await page.goto('/cxp');

    await expect(page.getByRole('heading', { name: 'Cuentas por pagar' })).toBeVisible();
    // KPIs de vistazo (resumen server-side) + chips del filtro.
    await expect(page.getByTestId('kpi-cartera')).toBeVisible();
    await expect(page.getByTestId('kpi-vencido')).toBeVisible();
    await expect(page.getByTestId('chip-con-saldo')).toBeVisible();
    // Fila 0.132: los dos listados de Daniel (Con factura / Sin factura) están en la barra.
    await expect(page.getByTestId('cxp-segmento-con')).toBeVisible();
    await expect(page.getByTestId('cxp-segmento-sin')).toBeVisible();
  });

  test('la relación de pago se abre DIRECTO por la URL (?segmento=)', async ({ page }) => {
    await entrarComoAdmin(page);
    await page.goto('/cxp?segmento=sin');

    // El chip llega ya elegido: el enlace del viernes abre el listado que toca, sin clics.
    await expect(page.getByTestId('cxp-segmento-sin')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('cxp-titulo-tabla')).toContainText('Sin factura');
  });

  test('el estado de cuenta del proveedor abre con su selector', async ({ page }) => {
    await entrarComoAdmin(page);
    await page.goto('/cxp/estado-cuenta');

    await expect(
      page.getByRole('heading', { name: 'Estado de cuenta del proveedor' }),
    ).toBeVisible();
    await expect(page.getByTestId('cxp-edc-proveedor')).toBeVisible();
    // Sin proveedor elegido, invita a seleccionarlo.
    await expect(page.getByText(/Elige un proveedor para ver su estado de cuenta/i)).toBeVisible();
  });
});
