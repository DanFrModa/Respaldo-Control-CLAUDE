import { expect, test } from '@playwright/test';

import { entrarComoAdmin } from './ayudas';

/**
 * E2E del CRUD de Proveedores contra el stack real (mismo patron que Almacenes).
 * Cubre el ciclo completo: crear (con tipo) -> aparece en la lista -> editar ->
 * se refleja -> desactivar (con confirmacion) -> queda oculto -> mostrar
 * desactivados -> **reactivar** -> vuelve a activo -> buscar. Usa un nombre unico
 * por corrida para no chocar con datos previos.
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

    // ── Crear ─────────────────────────────────────────────────────────────────
    await page.getByTestId('nuevo-proveedor').click();
    const dialogoAlta = page.getByRole('dialog');
    await expect(dialogoAlta.getByRole('heading', { name: 'Nuevo proveedor' })).toBeVisible();
    await dialogoAlta.getByLabel('Nombre').fill(nombre);
    await dialogoAlta.getByLabel('Tipo').selectOption('AVIOS');
    await page.getByTestId('guardar-proveedor').click();

    await expect(page.getByText(`Proveedor "${nombre}" creado.`)).toBeVisible();
    const filaNueva = page.getByTestId('fila-proveedor').filter({ hasText: nombre });
    await expect(filaNueva).toBeVisible();
    await expect(filaNueva.getByText('Avíos')).toBeVisible();
    await expect(filaNueva.getByText('Activo', { exact: true })).toBeVisible();

    // ── Editar ────────────────────────────────────────────────────────────────
    await filaNueva.getByTestId('acciones-proveedor').click();
    await page.getByTestId('editar-proveedor').click();
    const dialogoEdicion = page.getByRole('dialog');
    await expect(dialogoEdicion.getByRole('heading', { name: 'Editar proveedor' })).toBeVisible();
    await expect(dialogoEdicion.getByLabel('Nombre')).toHaveValue(nombre);
    await dialogoEdicion.getByLabel('Nombre').fill(nombreEditado);
    await page.getByTestId('guardar-proveedor').click();

    await expect(page.getByText(`Proveedor "${nombreEditado}" actualizado.`)).toBeVisible();
    const filaEditada = page.getByTestId('fila-proveedor').filter({ hasText: nombreEditado });
    await expect(filaEditada).toBeVisible();

    // ── Desactivar (borrado suave) ─────────────────────────────────────────────
    await filaEditada.getByTestId('acciones-proveedor').click();
    await page.getByTestId('desactivar-proveedor').click();
    const confirmacion = page.getByRole('dialog');
    await expect(confirmacion.getByRole('heading', { name: 'Desactivar proveedor' })).toBeVisible();
    await page.getByTestId('confirmar-accion').click();

    await expect(page.getByText(`Proveedor "${nombreEditado}" desactivado.`)).toBeVisible();
    // Por defecto la lista oculta desactivados: la fila ya no esta.
    await expect(page.getByTestId('fila-proveedor').filter({ hasText: nombreEditado })).toHaveCount(
      0,
    );

    // ── Mostrar desactivados → reaparece marcado como Inactivo ─────────────────
    await page.getByTestId('mostrar-desactivados').click();
    const filaInactiva = page.getByTestId('fila-proveedor').filter({ hasText: nombreEditado });
    await expect(filaInactiva).toBeVisible();
    await expect(filaInactiva.getByText('Inactivo', { exact: true })).toBeVisible();

    // ── Reactivar (restaurar el borrado suave) ─────────────────────────────────
    await filaInactiva.getByTestId('acciones-proveedor').click();
    await page.getByTestId('activar-proveedor').click();

    await expect(page.getByText(`Proveedor "${nombreEditado}" activado.`)).toBeVisible();
    const filaReactivada = page.getByTestId('fila-proveedor').filter({ hasText: nombreEditado });
    await expect(filaReactivada.getByText('Activo', { exact: true })).toBeVisible();
    await expect(filaReactivada.getByText('Inactivo', { exact: true })).toHaveCount(0);

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

    // Filtrar por un tipo concreto: todas las filas visibles son de ese tipo.
    await page.getByTestId('filtro-tipo-proveedor').selectOption('TELAS');
    const filas = page.getByTestId('fila-proveedor');
    const total = await filas.count();
    for (let i = 0; i < total; i++) {
      await expect(filas.nth(i).getByText('Telas')).toBeVisible();
    }
  });
});
