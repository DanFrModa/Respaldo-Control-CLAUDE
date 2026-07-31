import { expect, test } from '@playwright/test';

import { entrarComoAdmin } from './ayudas';

/**
 * E2E del PRECOSTO PERSISTIDO (F8-E3) contra el stack real. Cubre el ciclo del spec: preparar un
 * cliente+departamento+modelo → crear un proyecto y un desarrollo → GENERAR el precosto desde el BOM
 * → EDITAR la maquila → CONGELAR → la v1 aparece en el historial como "Congelado". Todo con nombres
 * únicos por corrida para no depender del estado previo. Asume el admin sembrado (todos los permisos).
 */
test.describe('Precosto (F8-E3)', () => {
  test('generar → editar maquila → congelar → v1 en historial', async ({ page }) => {
    const sufijo = Date.now().toString().slice(-6);
    const cliente = `Cliente Precosto ${sufijo}`;
    const departamento = `NIÑOS ${sufijo}`;
    const codigoModelo = `PRE-${sufijo}`;
    const nombreProyecto = `Básicos ${sufijo}`;

    await entrarComoAdmin(page);

    // ── Cliente + departamento ──────────────────────────────────────────────────
    await page.goto('/catalogos/clientes');
    await expect(page.getByRole('heading', { name: 'Clientes' })).toBeVisible();
    await page.getByTestId('nuevo-cliente').click();
    await page.getByRole('dialog').getByLabel('Nombre').fill(cliente);
    await page.getByTestId('guardar-cliente').click();
    await expect(page.getByText(`Cliente "${cliente}" creado.`)).toBeVisible();

    await page.getByTestId('buscar-cliente').fill(cliente);
    await page.getByTestId('fila-cliente').filter({ hasText: cliente }).first().click();
    await page.getByTestId('nuevo-departamento').click();
    await page.getByRole('dialog').getByLabel('Nombre').fill(departamento);
    await page.getByTestId('guardar-departamento').click();
    await expect(page.getByText(`Departamento "${departamento}" agregado.`)).toBeVisible();

    // ── Modelo ──────────────────────────────────────────────────────────────────
    await page.goto('/modelos');
    await expect(page.getByRole('heading', { name: 'Modelos' })).toBeVisible();
    await page.getByTestId('nuevo-modelo').click();
    await page.getByRole('dialog').getByLabel('Código').fill(codigoModelo);
    await page.getByTestId('guardar-modelo').click();
    await expect(page.getByText(`Modelo "${codigoModelo}" creado.`)).toBeVisible();

    // ── Proyecto + desarrollo ───────────────────────────────────────────────────
    await page.goto('/desarrollo');
    // R9 fidelidad: la lista de proyectos es tabla-first con el título del proto `vPrecosteosLista`.
    await expect(page.getByRole('heading', { name: 'Pre-costeos', exact: true })).toBeVisible();
    await page.getByTestId('nuevo-proyecto').click();
    const dialogoProyecto = page.getByRole('dialog');
    await dialogoProyecto.getByLabel('Cliente').selectOption({ label: cliente });
    await dialogoProyecto.getByLabel('Departamento').selectOption({ label: departamento });
    await dialogoProyecto.getByLabel('Nombre / tema').fill(nombreProyecto);
    await page.getByTestId('guardar-proyecto').click();
    await expect(page.getByText(/Proyecto \d+ creado\./)).toBeVisible();

    // Abre el proyecto nuevo (drill-in a página completa, R9).
    const detalle = page.getByTestId('detalle-proyecto');
    await page.getByTestId('fila-proyecto').filter({ hasText: nombreProyecto }).first().click();
    await expect(detalle.getByRole('heading', { name: nombreProyecto })).toBeVisible();

    await detalle.getByTestId('agregar-desarrollo').click();
    const dialogoDesarrollo = page.getByRole('dialog');
    await dialogoDesarrollo.getByLabel('Modelo del catálogo').selectOption({ label: codigoModelo });
    await page.getByTestId('guardar-desarrollo').click();
    await expect(page.getByText('Desarrollo agregado.')).toBeVisible();

    // ── Abre el precosto del desarrollo y GENERA la v1 ──────────────────────────
    const fila = detalle.getByTestId('fila-desarrollo').filter({ hasText: codigoModelo });
    await fila.getByTestId('precostear-desarrollo').click();
    const dialogo = page.getByRole('dialog').filter({ hasText: 'Precosto' });
    await expect(dialogo.getByRole('heading', { name: /Precosto/ })).toBeVisible();

    await dialogo.getByTestId('generar-precosto').click();
    await expect(page.getByText(/Precosto v1 generado\./)).toBeVisible();
    const editor = dialogo.getByTestId('editor-precosto');
    await expect(editor).toBeVisible();

    // R5/B8: el CORTE es un costo fijo por prenda, renglón propio SEPARADO de la maquila → su grupo
    // aparece siempre al generar (aunque el modelo no capture `corteBase`, entra en $0).
    await expect(editor.getByTestId('grupo-corte')).toBeVisible();
    await expect(editor.getByTestId('grupo-maquila')).toBeVisible();

    // ── Edita la MAQUILA (renglón manual) ───────────────────────────────────────
    const grupoMaquila = editor.getByTestId('grupo-maquila');
    await grupoMaquila.getByTestId('editar-linea').click();
    await grupoMaquila.getByTestId('editar-linea-precio').fill('15');
    await grupoMaquila.getByTestId('guardar-linea').click();
    await expect(page.getByText('Renglón actualizado.')).toBeVisible();

    // ── Congela la versión (con confirmación) ───────────────────────────────────
    await editor.getByTestId('congelar-precosto').click();
    await dialogo.getByTestId('confirmar-precosto').click();
    await expect(page.getByText(/Precosto v1 congelado\./)).toBeVisible();

    // ── La v1 aparece en el historial como "Congelado" ──────────────────────────
    const historial = dialogo.getByTestId('historial-precostos');
    const version1 = historial.getByTestId('version-precosto').filter({ hasText: 'v1' });
    await expect(version1).toBeVisible();
    await expect(version1.getByText('Congelado')).toBeVisible();
  });
});
