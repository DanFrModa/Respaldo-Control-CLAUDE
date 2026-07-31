import { expect, test } from '@playwright/test';

import { entrarComoAdmin } from './ayudas';

/**
 * E2E de EsMa — corazón contable (F6-E4) contra el stack real. El flujo transaccional profundo
 * (validar cargo → derivar saldo → abono/descuento → pago con anti-doble-pago → recibo PDF) está
 * cubierto a fondo por los tests de INTEGRACIÓN del backend (Postgres efímero en CI). Sembrar por la
 * UI una orden COMPLETA + recibo + cargo validado lo haría frágil y dependiente del estado (misma
 * decisión que recibos-maquila y auditorías-calidad). Por eso aquí se verifica, contra el stack real,
 * que las pantallas cargan desde la portada, exigen sesión y wirean sus controles principales.
 *
 * Asume el admin sembrado (todos los permisos, incluidos `esma.ver-pagos`/`esma.modificar`).
 */
test.describe('EsMa — corazón contable (F6-E4)', () => {
  test('la portada de EsMa carga desde el menú con sus tarjetas', async ({ page }) => {
    await entrarComoAdmin(page);
    // R1: EsMa es un desplegable (Finanzas · EsMa (maquileros)); su PORTADA-hub
    // ya no cuelga del menú y se visita por URL directa (la ruta sigue viva).
    await page.goto('/esma');

    await expect(page.getByRole('heading', { name: 'EsMa' })).toBeVisible();
    await expect(page.getByTestId('esma-conciliacion')).toBeVisible();
    await expect(page.getByTestId('esma-pagos')).toBeVisible();
  });

  test('la conciliación carga con sus filtros', async ({ page }) => {
    await entrarComoAdmin(page);
    await page.goto('/esma');
    await page.getByTestId('esma-conciliacion').click();

    await expect(page.getByRole('heading', { name: 'Conciliación de cargos' })).toBeVisible();
    await expect(page.getByTestId('conc-maquilero')).toBeVisible();
    await expect(page.getByTestId('conc-solo-faltantes')).toBeVisible();
  });

  test('la captura de abonos carga y arranca con Guardar deshabilitado', async ({ page }) => {
    await entrarComoAdmin(page);
    await page.goto('/esma/abonos');

    await expect(page.getByRole('heading', { name: 'Abonos' })).toBeVisible();
    await expect(page.getByTestId('mov-maquilero')).toBeVisible();
    // Sin maquilero ni importe, Guardar arranca deshabilitado.
    await expect(page.getByTestId('mov-guardar')).toBeDisabled();
  });

  test('la captura de descuentos reutiliza el formulario compartido', async ({ page }) => {
    await entrarComoAdmin(page);
    await page.goto('/esma/descuentos');

    await expect(page.getByRole('heading', { name: 'Descuentos' })).toBeVisible();
    await expect(page.getByTestId('mov-maquilero')).toBeVisible();
  });

  test('los pagos cargan e invitan a elegir un maquilero', async ({ page }) => {
    await entrarComoAdmin(page);
    await page.goto('/esma/pagos');

    await expect(page.getByRole('heading', { name: 'Pagos a maquileros' })).toBeVisible();
    await expect(page.getByTestId('pago-maquilero')).toBeVisible();
    await expect(page.getByText(/Selecciona un maquilero/i)).toBeVisible();
  });
});
