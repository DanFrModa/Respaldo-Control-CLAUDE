import { expect, test } from '@playwright/test';

import { entrarComoAdmin } from './ayudas';

/**
 * E2E del CRUD de Maquileros (maquila unificada, F1-E2) contra el stack real, en la
 * estructura LISTA + DETALLE (rediseño "Teal fresco", mismo patron que Proveedores).
 * Cubre el ciclo completo: crear (con ≥1 tipo de proceso) -> aparece en la lista ->
 * seleccionar -> editar -> se refleja -> desactivar (con confirmacion) -> queda oculto ->
 * mostrar desactivados -> reactivar -> vuelve a activo -> buscar. Se SELECCIONA la fila
 * (click) y las acciones (editar/desactivar/activar) son botones DIRECTOS del detalle; el
 * estado Activo/Inactivo y las capacidades (tipos) se leen en el detalle. Usa un código
 * corto unico por corrida.
 */
test.describe('CRUD de Maquileros', () => {
  test('crear, editar, desactivar, reactivar y buscar un maquilero', async ({ page }) => {
    const sufijo = Date.now().toString().slice(-6);
    const corto = `Maq E2E ${sufijo}`;
    const cortoEditado = `${corto} (ed)`;

    await entrarComoAdmin(page);

    // Navega Catalogos -> Maquileros (descubrible por clic, no solo por URL).
    await page
      .getByRole('navigation', { name: 'Módulos' })
      .first()
      .getByRole('link', { name: 'Catálogos' })
      .click();
    await page.getByTestId('catalogo-maquileros').click();
    await expect(page.getByRole('heading', { name: 'Maquileros' })).toBeVisible();

    const detalle = page.getByTestId('detalle-maquilero');

    // ── Crear ─────────────────────────────────────────────────────────────────
    await page.getByTestId('nuevo-maquilero').click();
    const dialogoAlta = page.getByRole('dialog');
    await expect(dialogoAlta.getByRole('heading', { name: 'Nuevo maquilero' })).toBeVisible();
    await dialogoAlta.getByLabel('Código corto').fill(corto);
    await dialogoAlta.getByLabel('Nombre').fill(corto);
    // Crear exige >=1 tipo de proceso: marca el primero del selector.
    await dialogoAlta.getByTestId('selector-tipos-proceso').getByRole('checkbox').first().check();
    await page.getByTestId('guardar-maquilero').click();

    // El toast confirma y la fila aparece en la lista; la busqueda la aisla.
    await expect(page.getByText(`Maquilero "${corto}" creado.`)).toBeVisible();
    await page.getByTestId('buscar-maquilero').fill(corto);
    const filaNueva = page.getByTestId('fila-maquilero').filter({ hasText: corto });
    await expect(filaNueva).toBeVisible();

    // ── Seleccionar → el detalle muestra el maquilero (estado) ─────────────────
    await filaNueva.click();
    await expect(detalle.getByRole('heading', { name: corto })).toBeVisible();
    await expect(detalle.getByText('Activo', { exact: true })).toBeVisible();

    // ── Editar (boton directo del detalle) ─────────────────────────────────────
    await page.getByTestId('editar-maquilero').click();
    const dialogoEdicion = page.getByRole('dialog');
    await expect(dialogoEdicion.getByRole('heading', { name: 'Editar maquilero' })).toBeVisible();
    await expect(dialogoEdicion.getByLabel('Código corto')).toHaveValue(corto);
    await dialogoEdicion.getByLabel('Código corto').fill(cortoEditado);
    await page.getByTestId('guardar-maquilero').click();

    await expect(page.getByText(`Maquilero "${cortoEditado}" actualizado.`)).toBeVisible();
    await page.getByTestId('buscar-maquilero').fill(cortoEditado);
    const filaEditada = page.getByTestId('fila-maquilero').filter({ hasText: cortoEditado });
    await expect(filaEditada).toBeVisible();

    // ── Desactivar (borrado suave) ─────────────────────────────────────────────
    await filaEditada.click();
    await expect(detalle.getByRole('heading', { name: cortoEditado })).toBeVisible();
    await page.getByTestId('desactivar-maquilero').click();
    const confirmacion = page.getByRole('dialog');
    await expect(confirmacion.getByRole('heading', { name: 'Desactivar maquilero' })).toBeVisible();
    await page.getByTestId('confirmar-accion').click();

    await expect(page.getByText(`Maquilero "${cortoEditado}" desactivado.`)).toBeVisible();
    // Por defecto la lista oculta desactivados: la fila ya no esta.
    await expect(page.getByTestId('fila-maquilero').filter({ hasText: cortoEditado })).toHaveCount(
      0,
    );

    // ── Mostrar desactivados → seleccionar → el detalle lo marca Inactivo ──────
    await page.getByTestId('mostrar-desactivados').click();
    const filaInactiva = page.getByTestId('fila-maquilero').filter({ hasText: cortoEditado });
    await expect(filaInactiva).toBeVisible();
    await filaInactiva.click();
    await expect(detalle.getByText('Inactivo', { exact: true })).toBeVisible();

    // ── Reactivar (boton directo del detalle) ──────────────────────────────────
    await page.getByTestId('activar-maquilero').click();

    await expect(page.getByText(`Maquilero "${cortoEditado}" activado.`)).toBeVisible();
    // El detalle ahora lo marca Activo. `exact` evita que "Activo" haga match con
    // "Inactivo" (substring).
    await expect(detalle.getByText('Activo', { exact: true })).toBeVisible();
    await expect(detalle.getByText('Inactivo', { exact: true })).toHaveCount(0);

    // ── Buscar ─────────────────────────────────────────────────────────────────
    await page.getByTestId('buscar-maquilero').fill(cortoEditado);
    await expect(
      page.getByTestId('fila-maquilero').filter({ hasText: cortoEditado }),
    ).toBeVisible();
    // Una busqueda que no coincide deja la lista vacia (estado vacio).
    await page.getByTestId('buscar-maquilero').fill('zzz-no-existe-zzz');
    await expect(page.getByText('No hay maquileros que coincidan con la búsqueda.')).toBeVisible();
  });

  test('crear sin tipo de proceso es rechazado (regla ≥1 tipo)', async ({ page }) => {
    const sufijo = Date.now().toString().slice(-6);
    const corto = `Maq SinTipo ${sufijo}`;

    await entrarComoAdmin(page);
    await page.goto('/catalogos/maquileros');
    await expect(page.getByRole('heading', { name: 'Maquileros' })).toBeVisible();

    await page.getByTestId('nuevo-maquilero').click();
    const dialogo = page.getByRole('dialog');
    await dialogo.getByLabel('Código corto').fill(corto);
    await dialogo.getByLabel('Nombre').fill(corto);
    // No se marca ningún tipo: al guardar, el formulario muestra el error y NO cierra.
    await page.getByTestId('guardar-maquilero').click();

    await expect(dialogo.getByText('Elige al menos un tipo de proceso.')).toBeVisible();
    await expect(dialogo.getByRole('heading', { name: 'Nuevo maquilero' })).toBeVisible();
  });

  test('el filtro por tipo de proceso acota la lista', async ({ page }) => {
    await entrarComoAdmin(page);
    await page.goto('/catalogos/maquileros');
    await expect(page.getByRole('heading', { name: 'Maquileros' })).toBeVisible();

    // Filtra por "Costura" (sembrado). El filtro recarga la lista en el servidor y el
    // motor auto-selecciona el primero. Verificamos por el DETALLE (chip del tipo) o, si
    // el catálogo no tiene maquileros de costura, el estado vacío: ambos son válidos.
    await page.getByTestId('filtro-tipo-proceso').selectOption({ label: 'Costura' });
    const detalle = page.getByTestId('detalle-maquilero');
    await expect(
      detalle
        .getByText('Costura')
        .first()
        .or(page.getByText('No hay maquileros que coincidan con la búsqueda.')),
    ).toBeVisible();
  });
});
