import { expect, test } from '@playwright/test';

import { entrarComoAdmin } from './ayudas';

/**
 * E2E del CRUD patron de Almacenes contra el stack real. Cubre el ciclo
 * completo: crear -> aparece en la lista -> editar -> se refleja -> desactivar
 * (con confirmacion) -> queda inactivo -> mostrar desactivados -> **reactivar**
 * -> vuelve a activo. Usa un nombre unico por corrida para no chocar con datos
 * previos.
 */
test.describe('CRUD de Almacenes', () => {
  test('crear, editar, desactivar y reactivar un almacén', async ({ page }) => {
    const sufijo = Date.now().toString().slice(-6);
    const nombre = `Bodega E2E ${sufijo}`;
    const nombreEditado = `${nombre} (editada)`;

    await entrarComoAdmin(page);

    // Navega Catalogos -> Almacenes (descubrible por clic, no solo por URL).
    await page
      .getByRole('navigation', { name: 'Módulos' })
      .first()
      .getByRole('link', {
        name: 'Catálogos',
      })
      .click();
    await page.getByRole('link', { name: /Almacenes/ }).click();
    await expect(page.getByRole('heading', { name: 'Almacenes' })).toBeVisible();

    // ── Crear ─────────────────────────────────────────────────────────────────
    await page.getByTestId('nuevo-almacen').click();
    const dialogoAlta = page.getByRole('dialog');
    await expect(dialogoAlta.getByRole('heading', { name: 'Nuevo almacén' })).toBeVisible();
    await dialogoAlta.getByLabel('Nombre').fill(nombre);
    await dialogoAlta.getByLabel('Tipo').selectOption('TELA');
    await page.getByTestId('guardar-almacen').click();

    // El toast confirma y la fila aparece en la lista.
    await expect(page.getByText(`Almacén "${nombre}" creado.`)).toBeVisible();
    const filaNueva = page.getByTestId('fila-almacen').filter({ hasText: nombre });
    await expect(filaNueva).toBeVisible();
    await expect(filaNueva.getByText('Telas')).toBeVisible();
    await expect(filaNueva.getByText('Activo', { exact: true })).toBeVisible();

    // ── Editar ────────────────────────────────────────────────────────────────
    await filaNueva.getByTestId('acciones-almacen').click();
    await page.getByTestId('editar-almacen').click();
    const dialogoEdicion = page.getByRole('dialog');
    await expect(dialogoEdicion.getByRole('heading', { name: 'Editar almacén' })).toBeVisible();
    await expect(dialogoEdicion.getByLabel('Nombre')).toHaveValue(nombre);
    await dialogoEdicion.getByLabel('Nombre').fill(nombreEditado);
    await page.getByTestId('guardar-almacen').click();

    await expect(page.getByText(`Almacén "${nombreEditado}" actualizado.`)).toBeVisible();
    const filaEditada = page.getByTestId('fila-almacen').filter({ hasText: nombreEditado });
    await expect(filaEditada).toBeVisible();

    // ── Desactivar (borrado suave) ─────────────────────────────────────────────
    await filaEditada.getByTestId('acciones-almacen').click();
    await page.getByTestId('desactivar-almacen').click();
    const confirmacion = page.getByRole('dialog');
    await expect(confirmacion.getByRole('heading', { name: 'Desactivar almacén' })).toBeVisible();
    await page.getByTestId('confirmar-accion').click();

    await expect(page.getByText(`Almacén "${nombreEditado}" desactivado.`)).toBeVisible();
    // Por defecto la lista oculta desactivados: la fila ya no esta.
    await expect(page.getByTestId('fila-almacen').filter({ hasText: nombreEditado })).toHaveCount(
      0,
    );

    // ── Mostrar desactivados → reaparece marcado como Inactivo ─────────────────
    await page.getByTestId('mostrar-desactivados').click();
    const filaInactiva = page.getByTestId('fila-almacen').filter({ hasText: nombreEditado });
    await expect(filaInactiva).toBeVisible();
    await expect(filaInactiva.getByText('Inactivo', { exact: true })).toBeVisible();

    // ── Reactivar (restaurar el borrado suave) ─────────────────────────────────
    await filaInactiva.getByTestId('acciones-almacen').click();
    await page.getByTestId('activar-almacen').click();

    await expect(page.getByText(`Almacén "${nombreEditado}" activado.`)).toBeVisible();
    // Sigue visible (mostrar desactivados sigue activo) pero ahora como Activo.
    // `exact` evita que "Activo" haga match con "Inactivo" (substring).
    const filaReactivada = page.getByTestId('fila-almacen').filter({ hasText: nombreEditado });
    await expect(filaReactivada.getByText('Activo', { exact: true })).toBeVisible();
    await expect(filaReactivada.getByText('Inactivo', { exact: true })).toHaveCount(0);
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
