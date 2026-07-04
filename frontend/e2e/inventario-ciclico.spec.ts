import { expect, test } from '@playwright/test';

import { crearColorYTalla, entrarComoAdmin } from './ayudas';

/**
 * E2E del INVENTARIO CÍCLICO (F7-E5) contra el stack real. Cubre el flujo de la ficha:
 * ALTA (congela el teórico) → CONTEO ciego → GENERAR AJUSTE (movimiento de kardex). Prepara la
 * existencia al vuelo (modelo único por corrida + entrada manual de PT) para no depender del estado
 * previo; se apoya en el almacén PT sembrado (Primeras) y en un color/talla creados al vuelo.
 *
 * Asume el admin sembrado (todos los permisos, incluidos `indicadores.ciclicos-*`).
 */
test.describe('Inventario cíclico (F7-E5)', () => {
  test('alta congela el teórico → conteo ciego → genera el ajuste', async ({ page }) => {
    const sufijo = Date.now().toString().slice(-6);
    const codigoModelo = `IC-${sufijo}`;

    await entrarComoAdmin(page);
    await crearColorYTalla(page);

    // ── Modelo nuevo ────────────────────────────────────────────────────────────
    await page.goto('/modelos');
    await expect(page.getByRole('heading', { name: 'Modelos' })).toBeVisible();
    await page.getByTestId('nuevo-modelo').click();
    await page.getByRole('dialog').getByLabel('Código').fill(codigoModelo);
    await page.getByTestId('guardar-modelo').click();
    await expect(page.getByText(`Modelo "${codigoModelo}" creado.`)).toBeVisible();

    // ── Existencia: entrada manual de PT al almacén Primeras ─────────────────────
    await page.goto('/inventarios/movimientos');
    await expect(page.getByRole('heading', { name: 'Movimientos de inventario' })).toBeVisible();
    await page.getByTestId('selector-modelo-busqueda').fill(codigoModelo);
    await page.getByTestId('selector-modelo-opcion').first().click();
    await page.getByTestId('mov-tipo').selectOption({ index: 1 });
    await page.getByTestId('mov-almacen').selectOption({ label: 'Primeras' });
    await page.getByTestId('mov-matriz-agregar-color').selectOption({ index: 1 });
    const agregarTalla = page.getByTestId('mov-matriz-agregar-talla');
    if (await agregarTalla.isEnabled()) {
      await agregarTalla.selectOption({ index: 1 });
    }
    await page.getByTestId('mov-matriz-celda').first().fill('20');
    await page.getByTestId('mov-guardar').click();
    await expect(page.getByText(/Movimiento #\d+ guardado/)).toBeVisible();

    // ── ALTA del cíclico (acotado a ese modelo, almacén Primeras) ────────────────
    await page.goto('/indicadores/ciclicos');
    await expect(page.getByRole('heading', { name: 'Inventarios cíclicos' })).toBeVisible();
    await page.getByTestId('ic-nuevo').click();
    await page.getByTestId('ic-almacen').selectOption({ label: 'Primeras' });
    await page.getByTestId('ic-selector-modelo-busqueda').fill(codigoModelo);
    await page.getByTestId('ic-selector-modelo-opcion').first().click();
    await page.getByTestId('ic-guardar').click();
    await expect(page.getByText(/Inventario cíclico #\d+ creado/)).toBeVisible();

    // El recién creado tiene el folio más alto → es la PRIMERA fila (orden folio desc).
    await page.getByRole('link', { name: 'Conteo' }).first().click();

    // ── CONTEO ciego: captura la cantidad física ────────────────────────────────
    await expect(page.getByRole('heading', { name: /Conteo cíclico/ })).toBeVisible();
    const campo = page.locator('[data-testid^="cc-cant-"]').first();
    await expect(campo).toBeVisible();
    await campo.fill('18');
    await page.getByTestId('cc-guardar').click();
    await expect(page.getByText('Conteo guardado.')).toBeVisible();

    // ── EXACTITUD + genera el AJUSTE ────────────────────────────────────────────
    await page.goto('/indicadores/ciclicos');
    await page.getByRole('link', { name: 'Exactitud' }).first().click();
    await expect(page.getByRole('heading', { name: /Exactitud/ })).toBeVisible();
    await page.getByTestId('ex-generar-ajuste').click();
    await page.getByTestId('ex-confirmar-ajuste').click();
    await expect(page.getByText(/Ajuste generado/)).toBeVisible();
    await expect(page.getByText('Cerrado (ajustado)')).toBeVisible();
  });
});
