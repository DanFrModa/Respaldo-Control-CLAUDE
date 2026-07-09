import { expect, test } from '@playwright/test';

import { abrirDesplegableMenu, entrarComoAdmin } from './ayudas';

/**
 * E2E del CRUD de Almacenes contra el stack real, en la estructura LISTA +
 * DETALLE (rediseño "Teal fresco"). Cubre el ciclo completo: crear -> aparece en
 * la lista -> seleccionar -> editar -> se refleja -> desactivar (con
 * confirmacion) -> queda inactivo -> mostrar desactivados -> **reactivar** ->
 * vuelve a activo. En esta UI se SELECCIONA la fila (click) y las acciones son
 * botones DIRECTOS del detalle (ya no hay menu `acciones-almacen`); el estado
 * Activo/Inactivo se lee en el detalle. Usa un nombre unico por corrida para no
 * chocar con datos previos.
 */
test.describe('CRUD de Almacenes', () => {
  test('crear, editar, desactivar y reactivar un almacén', async ({ page }) => {
    const sufijo = Date.now().toString().slice(-6);
    const nombre = `Bodega E2E ${sufijo}`;
    const nombreEditado = `${nombre} (editada)`;

    await entrarComoAdmin(page);

    // Navega Sistema · Catálogos base -> Almacenes (descubrible por clic, no solo por URL).
    await abrirDesplegableMenu(page, 'Catálogos base');
    await page
      .getByRole('navigation', { name: 'Módulos' })
      .first()
      .getByRole('link', { name: 'Almacenes', exact: true })
      .click();
    await expect(page.getByRole('heading', { name: 'Almacenes' })).toBeVisible();

    // ── Crear ─────────────────────────────────────────────────────────────────
    await page.getByTestId('nuevo-almacen').click();
    const dialogoAlta = page.getByRole('dialog');
    await expect(dialogoAlta.getByRole('heading', { name: 'Nuevo almacén' })).toBeVisible();
    await dialogoAlta.getByLabel('Nombre').fill(nombre);
    await dialogoAlta.getByLabel('Tipo').selectOption('TELA');
    await page.getByTestId('guardar-almacen').click();

    // El toast confirma y la fila aparece en la lista; la busqueda la aisla.
    await expect(page.getByText(`Almacén "${nombre}" creado.`)).toBeVisible();
    await page.getByTestId('buscar-almacen').fill(nombre);
    const filaNueva = page.getByTestId('fila-almacen').filter({ hasText: nombre });
    await expect(filaNueva).toBeVisible();

    // ── Tabla-first: el renglón muestra el tipo (badge) y el estado ────────────
    await expect(filaNueva.getByText('Telas')).toBeVisible();
    await expect(filaNueva.getByText('Activo', { exact: true })).toBeVisible();

    // ── Editar (botón inline del renglón) ──────────────────────────────────────
    await filaNueva.getByTestId('editar-almacen').click();
    const dialogoEdicion = page.getByRole('dialog');
    await expect(dialogoEdicion.getByRole('heading', { name: 'Editar almacén' })).toBeVisible();
    await expect(dialogoEdicion.getByLabel('Nombre')).toHaveValue(nombre);
    await dialogoEdicion.getByLabel('Nombre').fill(nombreEditado);
    await page.getByTestId('guardar-almacen').click();

    await expect(page.getByText(`Almacén "${nombreEditado}" actualizado.`)).toBeVisible();
    await page.getByTestId('buscar-almacen').fill(nombreEditado);
    const filaEditada = page.getByTestId('fila-almacen').filter({ hasText: nombreEditado });
    await expect(filaEditada).toBeVisible();

    // ── Desactivar (borrado suave) ─────────────────────────────────────────────
    await filaEditada.getByTestId('desactivar-almacen').click();
    const confirmacion = page.getByRole('dialog');
    await expect(confirmacion.getByRole('heading', { name: 'Desactivar almacén' })).toBeVisible();
    await page.getByTestId('confirmar-accion').click();

    await expect(page.getByText(`Almacén "${nombreEditado}" desactivado.`)).toBeVisible();
    // Por defecto la lista oculta desactivados: la fila ya no esta.
    await expect(page.getByTestId('fila-almacen').filter({ hasText: nombreEditado })).toHaveCount(
      0,
    );

    // ── Mostrar desactivados → el renglón lo marca Inactivo ────────────────────
    await page.getByTestId('mostrar-desactivados').click();
    const filaInactiva = page.getByTestId('fila-almacen').filter({ hasText: nombreEditado });
    await expect(filaInactiva).toBeVisible();
    await expect(filaInactiva.getByText('Inactivo', { exact: true })).toBeVisible();

    // ── Reactivar (botón inline del renglón) ───────────────────────────────────
    await filaInactiva.getByTestId('activar-almacen').click();

    await expect(page.getByText(`Almacén "${nombreEditado}" activado.`)).toBeVisible();
    await expect(
      page.getByTestId('fila-almacen').filter({ hasText: nombreEditado }).getByText('Activo', {
        exact: true,
      }),
    ).toBeVisible();
  });

  test('la búsqueda filtra la lista por nombre', async ({ page }) => {
    await entrarComoAdmin(page);
    await page.goto('/catalogos/almacenes');
    await expect(page.getByRole('heading', { name: 'Almacenes' })).toBeVisible();

    // Una busqueda que no coincide deja la lista vacia (estado vacio).
    await page.getByTestId('buscar-almacen').fill('zzz-no-existe-zzz');
    await expect(page.getByText('No hay almacenes que coincidan con la búsqueda.')).toBeVisible();
  });
});
