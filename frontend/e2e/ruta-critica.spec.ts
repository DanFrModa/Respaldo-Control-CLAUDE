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

  test('Procesos y responsables (R4): agrega un rango de dificultad y edita una dependencia', async ({
    page,
  }) => {
    const sufijo = Date.now().toString().slice(-6);
    const codigoA = `e2e-pyr-a-${sufijo}`;
    const nombreA = `PyR A ${sufijo}`;
    const codigoB = `e2e-pyr-b-${sufijo}`;
    const nombreB = `PyR B ${sufijo}`;

    await entrarComoAdmin(page);

    // Dos procesos frescos para editar su dependencia sin tocar el catálogo real.
    await page.goto('/ruta-critica/procesos');
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

    // ── La pantalla nueva (SISTEMA · Procesos y responsables) ───────────────────
    await page.goto('/ruta-critica/procesos-responsables');
    await expect(page.getByRole('heading', { name: 'Procesos y responsables' })).toBeVisible();

    // ── Tabla de dificultad (B7). La tabla es una PARTICIÓN: el rango ABIERTO del seed
    // ("33 – ∞") solapa por diseño con CUALQUIER alta nueva, así que primero se ACOTA ese rango
    // (EDITAR, condicional: un retry ya lo dejó acotado) y con el espacio libre se AGREGA el del
    // test; de pilón se verifica que el server RECHAZA un alta solapada con su mensaje claro.
    await expect(page.getByTestId('pyr-rango').first()).toBeVisible(); // la tabla ya cargó (seed)
    const filasAbiertas = page.getByTestId('pyr-rango').filter({ hasText: '∞' });
    if ((await filasAbiertas.count()) > 0) {
      await filasAbiertas.first().getByTestId('pyr-editar-rango').click();
      const dlgEditar = page.getByRole('dialog');
      await dlgEditar.getByTestId('rango-ops-hasta').fill('4999');
      await dlgEditar.getByTestId('rango-guardar').click();
      await expect(page.getByText('Tabla de dificultad actualizada.').first()).toBeVisible();
      await expect(page.getByTestId('pyr-rango').filter({ hasText: '∞' })).toHaveCount(0);
    }

    // Alta en el espacio liberado: bloques de 10 en [5000, 8990], únicos por corrida (sufijo).
    const desde = 5000 + (Number(sufijo) % 400) * 10;
    await page.getByTestId('pyr-agregar-rango').click();
    const dlgRango = page.getByRole('dialog');
    await dlgRango.getByTestId('rango-ops-desde').fill(String(desde));
    await dlgRango.getByTestId('rango-ops-hasta').fill(String(desde + 9));
    await dlgRango.getByTestId('rango-nombre').fill(`Rango E2E ${sufijo}`);
    await dlgRango.getByTestId('rango-dias').fill('9');
    await dlgRango.getByTestId('rango-guardar').click();
    await expect(page.getByText('Tabla de dificultad actualizada.').first()).toBeVisible();
    await expect(
      page.getByTestId('pyr-rango').filter({ hasText: `Rango E2E ${sufijo}` }),
    ).toBeVisible();

    // El server RECHAZA un alta que se encima (la validación de no-solape, end-to-end).
    await page.getByTestId('pyr-agregar-rango').click();
    const dlgSolape = page.getByRole('dialog');
    await dlgSolape.getByTestId('rango-ops-desde').fill(String(desde + 5));
    await dlgSolape.getByTestId('rango-ops-hasta').fill(String(desde + 20));
    await dlgSolape.getByTestId('rango-nombre').fill(`Choca E2E ${sufijo}`);
    await dlgSolape.getByTestId('rango-dias').fill('3');
    await dlgSolape.getByTestId('rango-guardar').click();
    await expect(page.getByText(/no pueden traslaparse/).first()).toBeVisible();
    await dlgSolape.getByRole('button', { name: 'Cancelar' }).click();

    // ── Editar una DEPENDENCIA desde el renglón expandible: B espera a A ────────
    const filaB = page.getByTestId('pyr-proceso').filter({ hasText: nombreB });
    await filaB.getByTestId('pyr-expandir').click();
    const deps = page.getByTestId('pyr-dependencias');
    await deps.getByTestId('pyr-antecesor-input').fill(nombreA);
    await deps.getByTestId('pyr-antecesor-opcion').first().click();
    await deps.getByTestId('pyr-agregar-antecesor').click();
    await expect(page.getByText(`Antecesor agregado: ${nombreA} → ${nombreB}.`)).toBeVisible();
    // El chip aparece en "Espera a" y el DETONA del otro lado se deriva solo; quitarlo lo regresa.
    await expect(deps.getByTestId('pyr-chip-antecesor').filter({ hasText: nombreA })).toBeVisible();
    await deps.getByTestId('pyr-quitar-antecesor').first().click();
    await expect(page.getByText(`Antecesor quitado de ${nombreB}.`)).toBeVisible();
  });
});
