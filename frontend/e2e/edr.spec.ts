import { expect, test } from '@playwright/test';

import { entrarComoAdmin } from './ayudas';

/**
 * E2E del módulo EDR (F7-E2) contra el stack real. Las fórmulas (generar idempotente, exclusión de
 * paraEdr/noCostear, costo actual, reconciliación) están cubiertas A FONDO por los tests de INTEGRACIÓN
 * (`backend/src/dominio/edr/edr.int.test.ts`, Postgres efímero en CI). Aquí se verifica, punta a punta,
 * que las pantallas cargan y que el flujo GENERAR → VER funciona: se genera un mes SIN ventas (un año
 * futuro improbable), que crea el encabezado vacío y lo muestra, y luego se consulta por mes. El admin
 * sembrado trae todos los permisos (incl. `edr.*`).
 */
test.describe('EDR (F7-E2)', () => {
  test('la portada de EDR muestra sus secciones', async ({ page }) => {
    await entrarComoAdmin(page);
    await page.goto('/edr');
    await expect(page.getByRole('heading', { name: 'Estado de Resultados' })).toBeVisible();
    await expect(page.getByTestId('edr-mes')).toBeVisible();
    await expect(page.getByTestId('edr-conciliacion')).toBeVisible();
    await expect(page.getByTestId('edr-por-mes')).toBeVisible();
    await expect(page.getByTestId('edr-por-anio')).toBeVisible();
  });

  test('genera un mes vacío, lo muestra y lo consulta por mes', async ({ page }) => {
    await entrarComoAdmin(page);

    // Gestión del mes: elegir un periodo futuro (sin ventas) y generar.
    await page.goto('/edr/mes');
    await expect(page.getByRole('heading', { name: 'Gestión del mes' })).toBeVisible();
    await page.getByTestId('edr-anio').fill('2099');
    await page.getByTestId('edr-mes').selectOption('1');
    await page.getByTestId('edr-generar').click();

    // El encabezado del mes queda creado y visible (ventas/costo/resultado en 0).
    await expect(page.getByTestId('edr-detalle')).toBeVisible();
    await expect(page.getByTestId('edr-detalle')).toContainText('Resultado');

    // Guardar el encabezado con un gasto.
    await page.getByTestId('edr-gastos').fill('1000');
    await page.getByTestId('edr-guardar-encabezado').click();
    await expect(page.getByText('Encabezado guardado.')).toBeVisible();

    // Consultar el EDR por mes del mismo periodo.
    await page.goto('/edr/por-mes?anio=2099&mes=1');
    await expect(page.getByRole('heading', { name: 'EDR por mes' })).toBeVisible();
    await expect(page.getByTestId('pm-resultado')).toBeVisible();
    await expect(page.getByTestId('pm-pdf')).toBeVisible();
  });

  test('Conciliación y EDR por año cargan con sus controles', async ({ page }) => {
    await entrarComoAdmin(page);

    await page.goto('/edr/conciliacion?anio=2099&mes=1');
    await expect(page.getByRole('heading', { name: 'Conciliación de ventas' })).toBeVisible();
    await expect(page.getByTestId('con-origen')).toBeVisible();

    await page.goto('/edr/por-anio?anio=2099');
    await expect(page.getByRole('heading', { name: 'EDR por año' })).toBeVisible();
    await expect(page.getByTestId('pa-pdf')).toBeVisible();
  });
});
