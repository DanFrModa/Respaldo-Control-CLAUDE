import { expect, test } from '@playwright/test';

import { entrarComoAdmin } from './ayudas';

/**
 * E2E del CRUD de Defectos (F6-E1) contra el stack real. Cubre el ciclo completo:
 * crear -> aparece en la lista -> seleccionar detalle -> editar -> se refleja ->
 * desactivar (con confirmación) -> reactivar. Usa un sufijo único por corrida.
 * Requiere el permiso `calidad.administrar-catalogo` (admin lo tiene).
 */
test.describe('CRUD de Defectos (Calidad, F6-E1)', () => {
  test('crear, editar, desactivar y reactivar un defecto', async ({ page }) => {
    const sufijo = Date.now().toString().slice(-6);
    const clave = `D-E2E-${sufijo}`;
    const claveEditada = `${clave}-v2`;

    await entrarComoAdmin(page);

    // El catálogo de defectos salió del riel (Calidad ahora solo lista Auditorías y Auditores):
    // la pantalla sigue viva por URL directa (y por ⌘K).
    await page.goto('/calidad/defectos');
    await expect(page.getByRole('heading', { name: 'Catálogo de defectos' })).toBeVisible();

    const detalle = page.getByTestId('detalle-defecto');

    // ── Crear ───────────────────────────────────────────────────────────────────
    await page.getByTestId('nuevo-defecto').click();
    const dialogoAlta = page.getByRole('dialog');
    await expect(dialogoAlta.getByRole('heading', { name: 'Nuevo defecto' })).toBeVisible();
    await dialogoAlta.getByLabel('Clave').fill(clave);
    await dialogoAlta.getByLabel('Descripción').fill('Defecto de E2E');
    await page.getByTestId('guardar-defecto').click();

    await expect(page.getByText(`Defecto "${clave}" creado.`)).toBeVisible();

    // Busca el defecto recién creado.
    await page.getByTestId('buscar-defecto').fill(clave);
    const filaNueva = page.getByTestId('fila-defecto').filter({ hasText: clave });
    await expect(filaNueva).toBeVisible();

    // ── Seleccionar → detalle muestra la clave ─────────────────────────────────
    await filaNueva.click();
    await expect(detalle.getByRole('heading', { name: clave })).toBeVisible();
    await expect(detalle.getByText('Activo', { exact: true })).toBeVisible();

    // ── Editar ──────────────────────────────────────────────────────────────────
    await page.getByTestId('editar-defecto').click();
    const dialogoEdicion = page.getByRole('dialog');
    await expect(dialogoEdicion.getByRole('heading', { name: 'Editar defecto' })).toBeVisible();
    await expect(dialogoEdicion.getByLabel('Clave')).toHaveValue(clave);
    await dialogoEdicion.getByLabel('Clave').fill(claveEditada);
    await page.getByTestId('guardar-defecto').click();

    await expect(page.getByText(`Defecto "${claveEditada}" actualizado.`)).toBeVisible();
    await page.getByTestId('buscar-defecto').fill(claveEditada);
    const filaEditada = page.getByTestId('fila-defecto').filter({ hasText: claveEditada });
    await expect(filaEditada).toBeVisible();

    // ── Desactivar ──────────────────────────────────────────────────────────────
    await filaEditada.click();
    await expect(detalle.getByRole('heading', { name: claveEditada })).toBeVisible();
    await page.getByTestId('desactivar-defecto').click();
    const confirmacion = page.getByRole('dialog');
    await expect(confirmacion.getByRole('heading', { name: 'Desactivar defecto' })).toBeVisible();
    await page.getByTestId('confirmar-accion').click();

    await expect(page.getByText(`Defecto "${claveEditada}" desactivado.`)).toBeVisible();
    // Sin inactivos, la fila desaparece.
    await expect(page.getByTestId('fila-defecto').filter({ hasText: claveEditada })).toHaveCount(0);

    // ── Mostrar desactivados → reactivar ────────────────────────────────────────
    await page.getByTestId('mostrar-desactivados').click();
    const filaInactiva = page.getByTestId('fila-defecto').filter({ hasText: claveEditada });
    await expect(filaInactiva).toBeVisible();
    await filaInactiva.click();
    await expect(detalle.getByText('Inactivo', { exact: true })).toBeVisible();

    await page.getByTestId('activar-defecto').click();
    await expect(page.getByText(`Defecto "${claveEditada}" activado.`)).toBeVisible();
    await expect(detalle.getByText('Activo', { exact: true })).toBeVisible();
  });

  test('la búsqueda filtra la lista', async ({ page }) => {
    await entrarComoAdmin(page);
    await page.goto('/calidad/defectos');
    await expect(page.getByRole('heading', { name: 'Catálogo de defectos' })).toBeVisible();

    await page.getByTestId('buscar-defecto').fill('zzz-no-existe-zzz');
    await expect(page.getByText('No hay defectos que coincidan con la búsqueda.')).toBeVisible();
  });

  test('el filtro de favoritos activa su botón', async ({ page }) => {
    await entrarComoAdmin(page);
    await page.goto('/calidad/defectos');

    const btnFavoritos = page.getByTestId('filtro-favoritos');
    await expect(btnFavoritos).toBeVisible();
    await expect(btnFavoritos).toHaveAttribute('aria-pressed', 'false');
    await btnFavoritos.click();
    await expect(btnFavoritos).toHaveAttribute('aria-pressed', 'true');
  });
});
