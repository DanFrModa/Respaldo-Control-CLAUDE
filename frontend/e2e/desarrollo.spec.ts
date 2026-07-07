import { expect, test } from '@playwright/test';

import { entrarComoAdmin } from './ayudas';

/**
 * E2E del módulo DESARROLLO (F8-E2) contra el stack real, en la estructura LISTA + DETALLE. Cubre el
 * ciclo del spec: crear un proyecto (Cliente+Departamento) → agregar un desarrollo con un modelo
 * existente ("En desarrollo") → apagarlo con motivo (visible en apagados con quién/cuándo/por qué)
 * → reactivarlo. Se apoya en un cliente + departamento + modelo creados al vuelo (nombres únicos por
 * corrida) para no depender del estado previo de la base. Asume el admin sembrado (todos los permisos).
 */
test.describe('Desarrollo (F8-E2)', () => {
  test('crear proyecto → agregar desarrollo → apagar con motivo → reactivar', async ({ page }) => {
    const sufijo = Date.now().toString().slice(-6);
    const cliente = `Cliente Desarrollo ${sufijo}`;
    const departamento = `NIÑOS ${sufijo}`;
    const codigoModelo = `DES-${sufijo}`;
    const nombreProyecto = `Joggers ${sufijo}`;

    await entrarComoAdmin(page);

    // ── Prepara un cliente + su departamento ────────────────────────────────────
    await page.goto('/catalogos/clientes');
    await expect(page.getByRole('heading', { name: 'Clientes' })).toBeVisible();
    await page.getByTestId('nuevo-cliente').click();
    await page.getByRole('dialog').getByLabel('Nombre').fill(cliente);
    await page.getByTestId('guardar-cliente').click();
    await expect(page.getByText(`Cliente "${cliente}" creado.`)).toBeVisible();

    // Selecciona el cliente para editar sus departamentos.
    await page.getByTestId('buscar-cliente').fill(cliente);
    await page.getByTestId('fila-cliente').filter({ hasText: cliente }).first().click();
    await page.getByTestId('nuevo-departamento').click();
    await page.getByRole('dialog').getByLabel('Nombre').fill(departamento);
    await page.getByTestId('guardar-departamento').click();
    await expect(page.getByText(`Departamento "${departamento}" agregado.`)).toBeVisible();

    // ── Prepara un modelo ───────────────────────────────────────────────────────
    await page.goto('/modelos');
    await expect(page.getByRole('heading', { name: 'Modelos' })).toBeVisible();
    await page.getByTestId('nuevo-modelo').click();
    await page.getByRole('dialog').getByLabel('Código').fill(codigoModelo);
    await page.getByTestId('guardar-modelo').click();
    await expect(page.getByText(`Modelo "${codigoModelo}" creado.`)).toBeVisible();

    // ── Crea un proyecto ────────────────────────────────────────────────────────
    await page.goto('/desarrollo');
    // `exact`: la lista+detalle auto-selecciona el primer proyecto (si la BD trae alguno) y su
    // panel trae un <h3>"Desarrollos"</h3> → "Desarrollo" (substring) haría doble match sin exact.
    await expect(page.getByRole('heading', { name: 'Desarrollo', exact: true })).toBeVisible();
    await page.getByTestId('nuevo-proyecto').click();
    const dialogoProyecto = page.getByRole('dialog');
    await expect(dialogoProyecto.getByRole('heading', { name: 'Nuevo proyecto' })).toBeVisible();
    await dialogoProyecto.getByLabel('Cliente').selectOption({ label: cliente });
    await dialogoProyecto.getByLabel('Departamento').selectOption({ label: departamento });
    await dialogoProyecto.getByLabel('Nombre / tema').fill(nombreProyecto);
    await page.getByTestId('guardar-proyecto').click();
    await expect(page.getByText(/Proyecto \d+ creado\./)).toBeVisible();

    // Selecciona el proyecto nuevo en la lista.
    const detalle = page.getByTestId('detalle-proyecto');
    await page.getByTestId('fila-proyecto').filter({ hasText: nombreProyecto }).first().click();
    await expect(detalle.getByText('Datos del proyecto')).toBeVisible();

    // ── Agrega un desarrollo con un modelo existente ────────────────────────────
    await detalle.getByTestId('agregar-desarrollo').click();
    const dialogoDesarrollo = page.getByRole('dialog');
    await expect(
      dialogoDesarrollo.getByRole('heading', { name: 'Agregar desarrollo' }),
    ).toBeVisible();
    await dialogoDesarrollo.getByLabel('Modelo del catálogo').selectOption({ label: codigoModelo });
    await page.getByTestId('guardar-desarrollo').click();
    await expect(page.getByText('Desarrollo agregado.')).toBeVisible();

    // El desarrollo aparece "En desarrollo".
    const fila = detalle.getByTestId('fila-desarrollo').filter({ hasText: codigoModelo });
    await expect(fila).toBeVisible();
    await expect(fila.getByText('En desarrollo')).toBeVisible();

    // ── Apaga el desarrollo con motivo ──────────────────────────────────────────
    await fila.getByTestId('apagar-desarrollo').click();
    const dialogoApagar = page.getByRole('dialog');
    await expect(dialogoApagar.getByRole('heading', { name: /Apagar desarrollo/ })).toBeVisible();
    await dialogoApagar.getByTestId('desarrollo-motivo-apagar').fill('Cliente lo canceló');
    await page.getByTestId('confirmar-apagar-desarrollo').click();
    await expect(page.getByText(`Desarrollo "${codigoModelo}" apagado.`)).toBeVisible();

    // ── Visible en apagados (motivo/cuándo/por qué) y reactivar ─────────────────
    await detalle.getByTestId('mostrar-apagados-desarrollos').click();
    const apagados = detalle.getByTestId('desarrollos-apagados');
    await expect(apagados.getByText('Cliente lo canceló')).toBeVisible();
    await expect(
      apagados.getByTestId('fila-desarrollo-apagado').filter({ hasText: codigoModelo }),
    ).toBeVisible();

    await apagados.getByTestId('reactivar-desarrollo').click();
    await expect(page.getByText(`Desarrollo "${codigoModelo}" reactivado.`)).toBeVisible();
    // Vuelve a estar activo (aparece en la tabla de activos).
    await expect(
      detalle
        .getByTestId('fila-desarrollo')
        .filter({ hasText: codigoModelo })
        .getByText('En desarrollo'),
    ).toBeVisible();
  });
});
