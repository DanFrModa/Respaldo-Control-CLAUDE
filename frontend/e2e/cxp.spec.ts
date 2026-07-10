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
