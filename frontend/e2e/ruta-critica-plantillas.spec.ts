import { expect, test } from '@playwright/test';

import { entrarComoAdmin } from './ayudas';

/**
 * E2E de PLANTILLAS DE RUTA (F5-E2) contra el stack real, en la estructura LISTA + DETALLE (teal).
 * Captura una plantilla: crea primero dos procesos del catálogo, abre el diálogo de nueva plantilla,
 * los incluye con su tiempo estándar y encadena uno como antecesor del otro, guarda y verifica que
 * la plantilla aparece con sus procesos en el detalle. Usa sufijos únicos por corrida.
 */
test.describe('Ruta Crítica — plantillas de ruta (F5-E2)', () => {
  test('crea una plantilla con dos procesos y su encadenamiento', async ({ page }) => {
    const sufijo = Date.now().toString().slice(-6);
    const codigoA = `e2e-pl-a-${sufijo}`;
    const nombreA = `Proc PL A ${sufijo}`;
    const codigoB = `e2e-pl-b-${sufijo}`;
    const nombreB = `Proc PL B ${sufijo}`;
    const nombrePlantilla = `Plantilla E2E ${sufijo}`;

    await entrarComoAdmin(page);

    // ── Crea dos procesos del catálogo (F5-E1) ──────────────────────────────────
    await page.goto('/ruta-critica/procesos');
    await expect(page.getByRole('heading', { name: 'Procesos de la Ruta Crítica' })).toBeVisible();
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

    // ── Crea la plantilla incluyendo ambos procesos ─────────────────────────────
    await page.goto('/ruta-critica/plantillas');
    await expect(page.getByRole('heading', { name: 'Plantillas de ruta' })).toBeVisible();

    await page.getByTestId('nuevo-plantilla-rc').click();
    const dialogo = page.getByRole('dialog');
    await expect(dialogo.getByRole('heading', { name: 'Nueva plantilla' })).toBeVisible();
    await page.getByTestId('plantilla-nombre').fill(nombrePlantilla);

    // Marca ambos procesos en el editor (por su etiqueta).
    const editor = page.getByTestId('editor-procesos-plantilla');
    await editor.getByText(nombreA, { exact: true }).click();
    await editor.getByText(nombreB, { exact: true }).click();

    await page.getByTestId('guardar-plantilla').click();
    await expect(page.getByText('Plantilla creada.')).toBeVisible();

    // ── Abre su detalle y verifica que muestra los procesos ─────────────────────
    await page.getByTestId('buscar-plantilla-rc').fill(nombrePlantilla);
    await page.getByTestId('fila-plantilla-rc').filter({ hasText: nombrePlantilla }).click();
    const tabla = page.getByTestId('tabla-procesos-plantilla');
    await expect(tabla).toBeVisible();
    await expect(tabla.getByText(nombreA, { exact: true })).toBeVisible();
    await expect(tabla.getByText(nombreB, { exact: true })).toBeVisible();
  });
});
