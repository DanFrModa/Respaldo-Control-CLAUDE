import { expect, test } from '@playwright/test';

import { entrarComoAdmin } from './ayudas';

/**
 * E2E del catálogo configurable de la Ruta Crítica (F5-E1) contra el stack real, en la estructura
 * LISTA + DETALLE. Cubre:
 *  1. Crear un proceso y asignarle DOS roles responsables desde el detalle.
 *  2. El RECHAZO DE CICLOS: con dos procesos A→B, intentar B→A y ver el error claro en español.
 * Usa códigos únicos por corrida para no chocar con el seed ni con datos previos.
 */
test.describe('Ruta Crítica — catálogo configurable (F5-E1)', () => {
  test('crea un proceso y le asigna dos roles responsables', async ({ page }) => {
    const sufijo = Date.now().toString().slice(-6);
    const codigo = `e2e-proc-${sufijo}`;
    const nombre = `Proceso E2E ${sufijo}`;

    await entrarComoAdmin(page);
    await page.goto('/ruta-critica/procesos');
    await expect(page.getByRole('heading', { name: 'Procesos de la Ruta Crítica' })).toBeVisible();

    // ── Crear el proceso ────────────────────────────────────────────────────────
    await page.getByTestId('nuevo-proceso-rc').click();
    const dialogo = page.getByRole('dialog');
    await expect(dialogo.getByRole('heading', { name: 'Nuevo proceso' })).toBeVisible();
    await dialogo.getByLabel('Código').fill(codigo);
    await dialogo.getByLabel('Nombre').fill(nombre);
    await page.getByTestId('guardar-proceso-rc').click();
    await expect(page.getByText(`Proceso "${nombre}" creado.`)).toBeVisible();

    // ── Abrir su detalle y asignar 2 roles ──────────────────────────────────────
    await page.getByTestId('buscar-proceso-rc').fill(codigo);
    await page.getByTestId('fila-proceso-rc').filter({ hasText: nombre }).click();

    const editorRoles = page.getByTestId('editor-roles-proceso');
    await expect(editorRoles).toBeVisible();
    // Marca las dos primeras opciones de rol disponibles (el seed siembra varios roles).
    const checkboxes = editorRoles.locator('input[type="checkbox"]');
    await checkboxes.nth(0).check();
    await checkboxes.nth(1).check();
    await page.getByTestId('guardar-roles-proceso').click();
    await expect(page.getByText('Roles responsables actualizados.')).toBeVisible();
  });

  test('rechaza un ciclo en las dependencias y muestra el error', async ({ page }) => {
    const sufijo = Date.now().toString().slice(-6);
    const codigoA = `e2e-a-${sufijo}`;
    const nombreA = `Proceso A ${sufijo}`;
    const codigoB = `e2e-b-${sufijo}`;
    const nombreB = `Proceso B ${sufijo}`;

    await entrarComoAdmin(page);
    await page.goto('/ruta-critica/procesos');
    await expect(page.getByRole('heading', { name: 'Procesos de la Ruta Crítica' })).toBeVisible();

    // Crea dos procesos A y B.
    for (const [codigo, nombre] of [
      [codigoA, nombreA],
      [codigoB, nombreB],
    ] as const) {
      await page.getByTestId('nuevo-proceso-rc').click();
      const dlg = page.getByRole('dialog');
      await dlg.getByLabel('Código').fill(codigo);
      await dlg.getByLabel('Nombre').fill(nombre);
      await page.getByTestId('guardar-proceso-rc').click();
      await expect(page.getByText(`Proceso "${nombre}" creado.`)).toBeVisible();
    }

    // ── Dependencias: A → B (A es antecesor de B) ───────────────────────────────
    await page.goto('/ruta-critica/dependencias');
    await expect(
      page.getByRole('heading', { name: 'Dependencias de la Ruta Crítica' }),
    ).toBeVisible();

    // Selecciona B en la lista y marca a A como su antecesor.
    await page.getByRole('button', { name: nombreB }).click();
    const editorAntecesoresB = page.getByTestId('editor-antecesores');
    await editorAntecesoresB.getByText(nombreA, { exact: true }).click();
    await page.getByTestId('guardar-dependencias').click();
    await expect(page.getByText('Dependencias actualizadas.')).toBeVisible();

    // ── Intentar el ciclo: B → A (A no puede tener a B como antecesor) ──────────
    await page.getByRole('button', { name: nombreA }).click();
    const editorAntecesoresA = page.getByTestId('editor-antecesores');
    await editorAntecesoresA.getByText(nombreB, { exact: true }).click();
    await page.getByTestId('guardar-dependencias').click();

    // El backend rechaza el ciclo con un mensaje claro en español (toast).
    await expect(page.getByText(/ciclo/i)).toBeVisible();
  });
});
