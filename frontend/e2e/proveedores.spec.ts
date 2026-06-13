import { expect, test } from '@playwright/test';

import { entrarComoAdmin } from './ayudas';

/**
 * E2E del CRUD de Proveedores contra el stack real, en la estructura LISTA +
 * DETALLE (rediseño "Teal fresco", mismo patron que Almacenes). Cubre el ciclo
 * completo: crear (con tipo) -> aparece en la lista -> seleccionar -> editar ->
 * se refleja -> desactivar (con confirmacion) -> queda oculto -> mostrar
 * desactivados -> **reactivar** -> vuelve a activo -> buscar. En esta UI se
 * SELECCIONA la fila (click) y las acciones (editar/desactivar/activar) son
 * botones DIRECTOS del detalle (ya no hay menu `acciones-proveedor`); el estado
 * Activo/Inactivo y el tipo se leen en el detalle. Usa un nombre unico por corrida.
 */
test.describe('CRUD de Proveedores', () => {
  test('crear, editar, desactivar, reactivar y buscar un proveedor', async ({ page }) => {
    const sufijo = Date.now().toString().slice(-6);
    const nombre = `Proveedor E2E ${sufijo}`;
    const nombreEditado = `${nombre} (editado)`;

    await entrarComoAdmin(page);

    // Navega Catalogos -> Proveedores (descubrible por clic, no solo por URL).
    await page
      .getByRole('navigation', { name: 'Módulos' })
      .first()
      .getByRole('link', { name: 'Catálogos' })
      .click();
    await page.getByTestId('catalogo-proveedores').click();
    await expect(page.getByRole('heading', { name: 'Proveedores' })).toBeVisible();

    const detalle = page.getByTestId('detalle-proveedor');

    // ── Crear ─────────────────────────────────────────────────────────────────
    await page.getByTestId('nuevo-proveedor').click();
    const dialogoAlta = page.getByRole('dialog');
    await expect(dialogoAlta.getByRole('heading', { name: 'Nuevo proveedor' })).toBeVisible();
    await dialogoAlta.getByLabel('Nombre').fill(nombre);
    await dialogoAlta.getByLabel('Tipo').selectOption('AVIOS');
    await page.getByTestId('guardar-proveedor').click();

    // El toast confirma y la fila aparece en la lista; la busqueda la aisla.
    await expect(page.getByText(`Proveedor "${nombre}" creado.`)).toBeVisible();
    await page.getByTestId('buscar-proveedor').fill(nombre);
    const filaNueva = page.getByTestId('fila-proveedor').filter({ hasText: nombre });
    await expect(filaNueva).toBeVisible();

    // ── Seleccionar → el detalle muestra el proveedor (tipo y estado) ──────────
    await filaNueva.click();
    await expect(detalle.getByRole('heading', { name: nombre })).toBeVisible();
    await expect(detalle.getByText('Avíos').first()).toBeVisible();
    await expect(detalle.getByText('Activo', { exact: true })).toBeVisible();

    // ── Editar (boton directo del detalle) ─────────────────────────────────────
    await page.getByTestId('editar-proveedor').click();
    const dialogoEdicion = page.getByRole('dialog');
    await expect(dialogoEdicion.getByRole('heading', { name: 'Editar proveedor' })).toBeVisible();
    await expect(dialogoEdicion.getByLabel('Nombre')).toHaveValue(nombre);
    await dialogoEdicion.getByLabel('Nombre').fill(nombreEditado);
    await page.getByTestId('guardar-proveedor').click();

    await expect(page.getByText(`Proveedor "${nombreEditado}" actualizado.`)).toBeVisible();
    await page.getByTestId('buscar-proveedor').fill(nombreEditado);
    const filaEditada = page.getByTestId('fila-proveedor').filter({ hasText: nombreEditado });
    await expect(filaEditada).toBeVisible();

    // ── Desactivar (borrado suave) ─────────────────────────────────────────────
    await filaEditada.click();
    await expect(detalle.getByRole('heading', { name: nombreEditado })).toBeVisible();
    await page.getByTestId('desactivar-proveedor').click();
    const confirmacion = page.getByRole('dialog');
    await expect(confirmacion.getByRole('heading', { name: 'Desactivar proveedor' })).toBeVisible();
    await page.getByTestId('confirmar-accion').click();

    await expect(page.getByText(`Proveedor "${nombreEditado}" desactivado.`)).toBeVisible();
    // Por defecto la lista oculta desactivados: la fila ya no esta.
    await expect(page.getByTestId('fila-proveedor').filter({ hasText: nombreEditado })).toHaveCount(
      0,
    );

    // ── Mostrar desactivados → seleccionar → el detalle lo marca Inactivo ──────
    await page.getByTestId('mostrar-desactivados').click();
    const filaInactiva = page.getByTestId('fila-proveedor').filter({ hasText: nombreEditado });
    await expect(filaInactiva).toBeVisible();
    await filaInactiva.click();
    await expect(detalle.getByText('Inactivo', { exact: true })).toBeVisible();

    // ── Reactivar (boton directo del detalle) ──────────────────────────────────
    await page.getByTestId('activar-proveedor').click();

    await expect(page.getByText(`Proveedor "${nombreEditado}" activado.`)).toBeVisible();
    // El detalle ahora lo marca Activo. `exact` evita que "Activo" haga match con
    // "Inactivo" (substring).
    await expect(detalle.getByText('Activo', { exact: true })).toBeVisible();
    await expect(detalle.getByText('Inactivo', { exact: true })).toHaveCount(0);

    // ── Buscar ─────────────────────────────────────────────────────────────────
    await page.getByTestId('buscar-proveedor').fill(nombreEditado);
    await expect(
      page.getByTestId('fila-proveedor').filter({ hasText: nombreEditado }),
    ).toBeVisible();
    // Una busqueda que no coincide deja la lista vacia (estado vacio).
    await page.getByTestId('buscar-proveedor').fill('zzz-no-existe-zzz');
    await expect(page.getByText('No hay proveedores que coincidan con la búsqueda.')).toBeVisible();
  });

  test('el filtro por tipo acota la lista', async ({ page }) => {
    await entrarComoAdmin(page);
    await page.goto('/catalogos/proveedores');
    await expect(page.getByRole('heading', { name: 'Proveedores' })).toBeVisible();

    const detalle = page.getByTestId('detalle-proveedor');

    await page.getByTestId('filtro-tipo-proveedor').selectOption('TELAS');
    // El filtro recarga la lista en el servidor y el motor auto-selecciona el
    // primero de la lista filtrada. Lo verificamos por el DETALLE (la fila muestra
    // el contacto, no el tipo). Si el catálogo no tiene proveedores TELAS, la lista
    // queda vacía: ambos resultados son válidos. (Sin click: la fila se remonta al
    // recargar y un click temprano sería inestable.)
    await expect(
      detalle
        .getByText('Telas')
        .first()
        .or(page.getByText('No hay proveedores que coincidan con la búsqueda.')),
    ).toBeVisible();
  });
});
