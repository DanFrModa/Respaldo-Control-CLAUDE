import { expect, test } from '@playwright/test';

import { entrarComoAdmin } from './ayudas';

/**
 * E2E de Reportes fiscales (F9-E5) contra el stack real. La lógica (vista fiscal, totales, salud,
 * exports) la cubren a fondo los tests de INTEGRACIÓN del backend; aquí se verifica, contra el stack
 * real, que la pantalla carga desde su ruta y wirea sus controles principales (KPIs de salud, filtros
 * y botones de export). Asume el admin sembrado (todos los permisos, incl. `terceros.fiscal`).
 */
test.describe('Reportes fiscales (F9-E5)', () => {
  test('la pantalla carga con sus KPIs de salud, filtros y exports', async ({ page }) => {
    await entrarComoAdmin(page);
    await page.goto('/reportes-fiscales');

    await expect(page.getByRole('heading', { name: 'Reportes fiscales' })).toBeVisible();
    // KPIs del tablero de salud fiscal.
    await expect(page.getByTestId('kpi-fiscales')).toBeVisible();
    await expect(page.getByTestId('kpi-conciliado')).toBeVisible();
    // Filtros server-side.
    await expect(page.getByTestId('rf-tercero')).toBeVisible();
    await expect(page.getByTestId('rf-cfdi')).toBeVisible();
    // Botones de export.
    await expect(page.getByTestId('reporte-fiscal-excel')).toBeVisible();
    await expect(page.getByTestId('reporte-fiscal-pdf')).toBeVisible();
  });
});
