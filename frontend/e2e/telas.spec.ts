import { expect, test } from '@playwright/test';

import { entrarComoAdmin } from './ayudas';

/**
 * E2E del CRUD de Telas unificadas (F1-E3) contra el stack real, en la estructura LISTA +
 * DETALLE (rediseño "Teal fresco"). Cubre el ciclo completo de una tela CON su grid de
 * colores: crear (con categoría de alta rápida + un color con precio) -> aparece en la
 * lista -> seleccionar -> el detalle muestra el color con su precio -> editar -> desactivar
 * (con confirmación) -> queda oculta -> mostrar desactivados -> reactivar -> buscar. Se
 * SELECCIONA la fila (click) y las acciones son botones DIRECTOS del detalle. Usa un nombre
 * único por corrida.
 */
test.describe('CRUD de Telas (unificadas, con colores)', () => {
  test('crear con categoría y un color, editar, desactivar, reactivar y buscar', async ({
    page,
  }) => {
    const sufijo = Date.now().toString().slice(-6);
    const nombre = `Tela E2E ${sufijo}`;
    const nombreEditado = `${nombre} (ed)`;
    const categoria = `Cat E2E ${sufijo}`;

    await entrarComoAdmin(page);

    // Navega Catálogos -> Telas (descubrible por clic, no solo por URL).
    await page
      .getByRole('navigation', { name: 'Módulos' })
      .first()
      .getByRole('link', { name: 'Catálogos' })
      .click();
    await page.getByTestId('catalogo-telas').click();
    await expect(page.getByRole('heading', { name: 'Telas' })).toBeVisible();

    const detalle = page.getByTestId('detalle-tela');

    // ── Crear (con categoría de alta rápida y un color con precio) ──────────────
    await page.getByTestId('nuevo-tela').click();
    const dialogoAlta = page.getByRole('dialog');
    await expect(dialogoAlta.getByRole('heading', { name: 'Nueva tela' })).toBeVisible();
    await dialogoAlta.getByLabel('Nombre').fill(nombre);

    // Alta rápida de categoría: abre el sub-diálogo, la crea y queda seleccionada.
    await dialogoAlta.getByTestId('nueva-categoria-tela').click();
    const dialogoCategoria = page
      .getByRole('dialog')
      .filter({ hasText: 'Nueva categoría de tela' });
    await dialogoCategoria.getByLabel('Nombre').fill(categoria);
    await page.getByTestId('guardar-categoria-tela').click();
    await expect(page.getByText(`Categoría "${categoria}" creada.`)).toBeVisible();

    // Agrega el primer color disponible y captura su precio.
    await dialogoAlta.getByTestId('selector-agregar-color').selectOption({ index: 1 });
    await dialogoAlta.getByTestId('agregar-color').click();
    await dialogoAlta.getByTestId('grid-colores-tela').getByRole('spinbutton').first().fill('95');

    await page.getByTestId('guardar-tela').click();
    await expect(page.getByText(`Tela "${nombre}" creada.`)).toBeVisible();

    // La fila aparece; la búsqueda la aísla.
    await page.getByTestId('buscar-tela').fill(nombre);
    const filaNueva = page.getByTestId('fila-tela').filter({ hasText: nombre });
    await expect(filaNueva).toBeVisible();

    // ── Seleccionar → el detalle muestra la tela, su estado y el color con precio ─
    await filaNueva.click();
    await expect(detalle.getByRole('heading', { name: nombre })).toBeVisible();
    await expect(detalle.getByText('Activo', { exact: true })).toBeVisible();
    await expect(detalle.getByTestId('tela-colores-detalle')).toBeVisible();

    // ── Editar (botón directo del detalle) ─────────────────────────────────────
    await page.getByTestId('editar-tela').click();
    const dialogoEdicion = page.getByRole('dialog');
    await expect(dialogoEdicion.getByRole('heading', { name: 'Editar tela' })).toBeVisible();
    await expect(dialogoEdicion.getByLabel('Nombre')).toHaveValue(nombre);
    await dialogoEdicion.getByLabel('Nombre').fill(nombreEditado);
    await page.getByTestId('guardar-tela').click();

    await expect(page.getByText(`Tela "${nombreEditado}" actualizada.`)).toBeVisible();
    await page.getByTestId('buscar-tela').fill(nombreEditado);
    const filaEditada = page.getByTestId('fila-tela').filter({ hasText: nombreEditado });
    await expect(filaEditada).toBeVisible();

    // ── Desactivar (borrado suave) ─────────────────────────────────────────────
    await filaEditada.click();
    await expect(detalle.getByRole('heading', { name: nombreEditado })).toBeVisible();
    await page.getByTestId('desactivar-tela').click();
    const confirmacion = page.getByRole('dialog');
    await expect(confirmacion.getByRole('heading', { name: 'Desactivar tela' })).toBeVisible();
    await page.getByTestId('confirmar-accion').click();

    await expect(page.getByText(`Tela "${nombreEditado}" desactivada.`)).toBeVisible();
    await expect(page.getByTestId('fila-tela').filter({ hasText: nombreEditado })).toHaveCount(0);

    // ── Mostrar desactivados → seleccionar → el detalle la marca Inactivo ───────
    await page.getByTestId('mostrar-desactivados').click();
    const filaInactiva = page.getByTestId('fila-tela').filter({ hasText: nombreEditado });
    await expect(filaInactiva).toBeVisible();
    await filaInactiva.click();
    await expect(detalle.getByText('Inactivo', { exact: true })).toBeVisible();

    // ── Reactivar (botón directo del detalle) ──────────────────────────────────
    await page.getByTestId('activar-tela').click();
    await expect(page.getByText(`Tela "${nombreEditado}" activada.`)).toBeVisible();
    await expect(detalle.getByText('Activo', { exact: true })).toBeVisible();

    // ── Buscar ─────────────────────────────────────────────────────────────────
    await page.getByTestId('buscar-tela').fill('zzz-no-existe-zzz');
    await expect(page.getByText('No hay telas que coincidan con la búsqueda.')).toBeVisible();
  });

  test('rechaza una tela con nombre duplicado (unicidad global)', async ({ page }) => {
    const sufijo = Date.now().toString().slice(-6);
    const nombre = `Tela Dup ${sufijo}`;

    await entrarComoAdmin(page);
    await page.goto('/catalogos/telas');
    await expect(page.getByRole('heading', { name: 'Telas' })).toBeVisible();

    // Primera alta (sin colores ni categoría: ambos opcionales).
    await page.getByTestId('nuevo-tela').click();
    await page.getByRole('dialog').getByLabel('Nombre').fill(nombre);
    await page.getByTestId('guardar-tela').click();
    await expect(page.getByText(`Tela "${nombre}" creada.`)).toBeVisible();

    // Segunda alta con el mismo nombre: el backend la rechaza (toast de error) y el
    // diálogo NO se cierra.
    await page.getByTestId('nuevo-tela').click();
    const dialogo = page.getByRole('dialog');
    await dialogo.getByLabel('Nombre').fill(nombre);
    await page.getByTestId('guardar-tela').click();
    await expect(page.getByText(/Ya existe una tela llamada/)).toBeVisible();
    await expect(dialogo.getByRole('heading', { name: 'Nueva tela' })).toBeVisible();
  });
});
