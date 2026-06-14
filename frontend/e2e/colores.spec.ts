import { expect, test } from '@playwright/test';

import { entrarComoAdmin } from './ayudas';

/**
 * E2E del CRUD de Colores contra el stack real, en la estructura LISTA + DETALLE
 * (rediseño "Teal fresco") + ALTA RAPIDA ENCADENADA. Cubre crear VARIOS colores
 * seguidos sin cerrar el dialogo, luego el ciclo completo sobre uno de ellos:
 * seleccionar -> editar -> desactivar (con confirmacion) -> mostrar desactivados ->
 * reactivar -> buscar. En esta UI se SELECCIONA la fila (click) y las acciones son
 * botones DIRECTOS del detalle (ya no hay menu `acciones-color`); el estado
 * Activo/Inactivo se lee en el detalle. Usa un sufijo unico por corrida.
 */
test.describe('CRUD de Colores', () => {
  test('alta rápida encadenada: crear varios colores seguidos sin cerrar', async ({ page }) => {
    const sufijo = Date.now().toString().slice(-6);
    const colores = [`Rojo ${sufijo}`, `Azul ${sufijo}`, `Verde ${sufijo}`];

    await entrarComoAdmin(page);
    await page.goto('/catalogos/colores');
    await expect(page.getByRole('heading', { name: 'Colores' })).toBeVisible();

    await page.getByTestId('nuevo-color').click();
    const dialogo = page.getByRole('dialog');
    await expect(dialogo.getByRole('heading', { name: 'Nuevo color' })).toBeVisible();

    // Captura los tres de corrido: el dialogo NO se cierra y el campo se limpia.
    for (const nombre of colores) {
      await dialogo.getByLabel('Nombre').fill(nombre);
      await page.getByTestId('guardar-color').click();
      await expect(page.getByText(`Color "${nombre}" creado.`)).toBeVisible();
      // Sigue abierto y listo para el siguiente (campo vacio).
      await expect(page.getByRole('dialog')).toBeVisible();
      await expect(dialogo.getByLabel('Nombre')).toHaveValue('');
    }

    // "Listo" cierra el dialogo.
    await page.getByTestId('listo-color').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // Los tres aparecen en la lista (se busca cada uno para aislarlo).
    for (const nombre of colores) {
      await page.getByTestId('buscar-color').fill(nombre);
      await expect(page.getByTestId('fila-color').filter({ hasText: nombre })).toBeVisible();
    }
  });

  test('crear, editar, desactivar, reactivar y buscar un color', async ({ page }) => {
    const sufijo = Date.now().toString().slice(-6);
    const nombre = `Color E2E ${sufijo}`;
    const nombreEditado = `${nombre} (editado)`;

    await entrarComoAdmin(page);
    await page.goto('/catalogos/colores');
    await expect(page.getByRole('heading', { name: 'Colores' })).toBeVisible();

    const detalle = page.getByTestId('detalle-color');

    // ── Crear (uno) y cerrar con "Listo" ───────────────────────────────────────
    await page.getByTestId('nuevo-color').click();
    const dialogoAlta = page.getByRole('dialog');
    await dialogoAlta.getByLabel('Nombre').fill(nombre);
    await page.getByTestId('guardar-color').click();
    await expect(page.getByText(`Color "${nombre}" creado.`)).toBeVisible();
    await page.getByTestId('listo-color').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // La busqueda aisla la fila; al seleccionarla, el detalle la marca Activo.
    await page.getByTestId('buscar-color').fill(nombre);
    const filaNueva = page.getByTestId('fila-color').filter({ hasText: nombre });
    await expect(filaNueva).toBeVisible();
    await filaNueva.click();
    await expect(detalle.getByRole('heading', { name: nombre })).toBeVisible();
    await expect(detalle.getByText('Activo', { exact: true })).toBeVisible();

    // ── Editar (boton directo del detalle; en edicion el dialogo SI se cierra) ──
    await page.getByTestId('editar-color').click();
    const dialogoEdicion = page.getByRole('dialog');
    await expect(dialogoEdicion.getByRole('heading', { name: 'Editar color' })).toBeVisible();
    await expect(dialogoEdicion.getByLabel('Nombre')).toHaveValue(nombre);
    await dialogoEdicion.getByLabel('Nombre').fill(nombreEditado);
    await page.getByTestId('guardar-color').click();

    await expect(page.getByText(`Color "${nombreEditado}" actualizado.`)).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByTestId('buscar-color').fill(nombreEditado);
    const filaEditada = page.getByTestId('fila-color').filter({ hasText: nombreEditado });
    await expect(filaEditada).toBeVisible();

    // ── Desactivar (borrado suave) ─────────────────────────────────────────────
    await filaEditada.click();
    await expect(detalle.getByRole('heading', { name: nombreEditado })).toBeVisible();
    await page.getByTestId('desactivar-color').click();
    const confirmacion = page.getByRole('dialog');
    await expect(confirmacion.getByRole('heading', { name: 'Desactivar color' })).toBeVisible();
    await page.getByTestId('confirmar-accion').click();

    await expect(page.getByText(`Color "${nombreEditado}" desactivado.`)).toBeVisible();
    await expect(page.getByTestId('fila-color').filter({ hasText: nombreEditado })).toHaveCount(0);

    // ── Mostrar desactivados → seleccionar → el detalle lo marca Inactivo ──────
    await page.getByTestId('mostrar-desactivados').click();
    const filaInactiva = page.getByTestId('fila-color').filter({ hasText: nombreEditado });
    await expect(filaInactiva).toBeVisible();
    await filaInactiva.click();
    await expect(detalle.getByText('Inactivo', { exact: true })).toBeVisible();

    // ── Reactivar (boton directo del detalle) ──────────────────────────────────
    await page.getByTestId('activar-color').click();
    await expect(page.getByText(`Color "${nombreEditado}" activado.`)).toBeVisible();
    await expect(detalle.getByText('Activo', { exact: true })).toBeVisible();
    await expect(detalle.getByText('Inactivo', { exact: true })).toHaveCount(0);

    // ── Buscar ─────────────────────────────────────────────────────────────────
    await page.getByTestId('buscar-color').fill('zzz-no-existe-zzz');
    await expect(page.getByText('No hay colores que coincidan con la búsqueda.')).toBeVisible();
  });
});
