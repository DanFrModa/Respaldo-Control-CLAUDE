import { expect, test } from '@playwright/test';

import { entrarComoAdmin } from './ayudas';

/**
 * E2E de CxC — cuentas por cobrar (F9-E4) contra el stack real. El flujo contable profundo
 * (cargo→saldo→cobro→aging→PDF→importar CFDI) lo cubren a fondo los tests de INTEGRACIÓN del backend;
 * aquí se verifica, contra el stack real, que las pantallas cargan desde su ruta y wirean sus controles
 * principales. Asume el admin sembrado (todos los permisos, incl. `cxc.ver`/`cxc.administrar`).
 */
test.describe('CxC — cuentas por cobrar (F9-E4)', () => {
  test('la bandeja "por cobrar" carga con sus KPIs y filtros', async ({ page }) => {
    await entrarComoAdmin(page);
    await page.goto('/cxc');

    await expect(page.getByRole('heading', { name: 'Cuentas por cobrar' })).toBeVisible();
    // KPIs de vistazo (resumen server-side) + chips del filtro.
    await expect(page.getByTestId('kpi-cartera')).toBeVisible();
    await expect(page.getByTestId('kpi-vencido')).toBeVisible();
    await expect(page.getByTestId('chip-con-saldo')).toBeVisible();
  });

  test('el estado de cuenta del cliente abre con su selector', async ({ page }) => {
    await entrarComoAdmin(page);
    await page.goto('/cxc/estado-cuenta');

    await expect(page.getByRole('heading', { name: 'Estado de cuenta del cliente' })).toBeVisible();
    await expect(page.getByTestId('cxc-edc-cliente')).toBeVisible();
    // Sin cliente elegido, invita a seleccionarlo.
    await expect(page.getByText(/Elige un cliente para ver su estado de cuenta/i)).toBeVisible();
  });

  test('la pantalla de importar CFDI de venta abre con su dropzone', async ({ page }) => {
    await entrarComoAdmin(page);
    await page.goto('/cxc/importar-cfdi');

    await expect(page.getByRole('heading', { name: 'Importar CFDI de venta' })).toBeVisible();
    await expect(page.getByTestId('cfdi-venta-dropzone')).toBeVisible();
  });
});
