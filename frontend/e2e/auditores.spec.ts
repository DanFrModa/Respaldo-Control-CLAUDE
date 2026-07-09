import { expect, test } from '@playwright/test';

import { abrirDesplegableMenu, entrarComoAdmin } from './ayudas';

/**
 * E2E del CRUD del catálogo de Auditores (rediseño R9) contra el stack real, en la estructura
 * TABLA-FIRST (`TablaCatalogo`, acciones inline por renglón — sin cajón). Cubre el ciclo completo:
 * crear -> aparece en la lista -> editar -> se refleja -> desactivar (con confirmación) -> queda
 * inactivo -> mostrar desactivados -> reactivar -> vuelve a activo, más un smoke de búsqueda. Usa un
 * nombre único por corrida. Requiere `calidad.administrar-catalogo` (admin lo tiene).
 */
test.describe('CRUD de Auditores (Calidad, R9)', () => {
  test('crear, editar, desactivar y reactivar un auditor', async ({ page }) => {
    const sufijo = Date.now().toString().slice(-6);
    const nombre = `Insp E2E ${sufijo}`;
    const nombreEditado = `${nombre} (editado)`;

    await entrarComoAdmin(page);

    // Navega Operación · Calidad -> Auditores (descubrible por clic, no solo por URL).
    await abrirDesplegableMenu(page, 'Calidad');
    await page
      .getByRole('navigation', { name: 'Módulos' })
      .first()
      .getByRole('link', { name: 'Auditores', exact: true })
      .click();
    await expect(page.getByRole('heading', { name: 'Auditores' })).toBeVisible();

    // ── Crear ─────────────────────────────────────────────────────────────────
    await page.getByTestId('nuevo-auditor').click();
    const dialogoAlta = page.getByRole('dialog');
    await expect(dialogoAlta.getByRole('heading', { name: 'Nuevo auditor' })).toBeVisible();
    await dialogoAlta.getByLabel('Nombre').fill(nombre);
    await dialogoAlta.getByLabel('Rol').selectOption('Sr. Auditor');
    await dialogoAlta.getByLabel('Nivel AQL').selectOption('4.0');
    await page.getByTestId('guardar-auditor').click();

    // El toast confirma y la fila aparece en la lista; la búsqueda la aísla.
    await expect(page.getByText(`Auditor "${nombre}" creado.`)).toBeVisible();
    await page.getByTestId('buscar-auditor').fill(nombre);
    const filaNueva = page.getByTestId('fila-auditor').filter({ hasText: nombre });
    await expect(filaNueva).toBeVisible();

    // ── Tabla-first: el renglón muestra el rol (badge), el nivel AQL y el estado ─
    await expect(filaNueva.getByText('Sr. Auditor')).toBeVisible();
    await expect(filaNueva.getByText('4.0')).toBeVisible();
    await expect(filaNueva.getByText('Activo', { exact: true })).toBeVisible();

    // ── Editar (botón inline del renglón) ──────────────────────────────────────
    await filaNueva.getByTestId('editar-auditor').click();
    const dialogoEdicion = page.getByRole('dialog');
    await expect(dialogoEdicion.getByRole('heading', { name: 'Editar auditor' })).toBeVisible();
    await expect(dialogoEdicion.getByLabel('Nombre')).toHaveValue(nombre);
    await dialogoEdicion.getByLabel('Nombre').fill(nombreEditado);
    await page.getByTestId('guardar-auditor').click();

    await expect(page.getByText(`Auditor "${nombreEditado}" actualizado.`)).toBeVisible();
    await page.getByTestId('buscar-auditor').fill(nombreEditado);
    const filaEditada = page.getByTestId('fila-auditor').filter({ hasText: nombreEditado });
    await expect(filaEditada).toBeVisible();

    // ── Desactivar (borrado suave) ─────────────────────────────────────────────
    await filaEditada.getByTestId('desactivar-auditor').click();
    const confirmacion = page.getByRole('dialog');
    await expect(confirmacion.getByRole('heading', { name: 'Desactivar auditor' })).toBeVisible();
    await page.getByTestId('confirmar-accion').click();

    await expect(page.getByText(`Auditor "${nombreEditado}" desactivado.`)).toBeVisible();
    // Por defecto la lista oculta desactivados: la fila ya no está.
    await expect(page.getByTestId('fila-auditor').filter({ hasText: nombreEditado })).toHaveCount(
      0,
    );

    // ── Mostrar desactivados → el renglón lo marca Inactivo ────────────────────
    await page.getByTestId('mostrar-desactivados').click();
    const filaInactiva = page.getByTestId('fila-auditor').filter({ hasText: nombreEditado });
    await expect(filaInactiva).toBeVisible();
    await expect(filaInactiva.getByText('Inactivo', { exact: true })).toBeVisible();

    // ── Reactivar (botón inline del renglón) ───────────────────────────────────
    await filaInactiva.getByTestId('activar-auditor').click();

    await expect(page.getByText(`Auditor "${nombreEditado}" activado.`)).toBeVisible();
    await expect(
      page.getByTestId('fila-auditor').filter({ hasText: nombreEditado }).getByText('Activo', {
        exact: true,
      }),
    ).toBeVisible();
  });

  test('la búsqueda filtra la lista por nombre', async ({ page }) => {
    await entrarComoAdmin(page);
    await page.goto('/auditores');
    await expect(page.getByRole('heading', { name: 'Auditores' })).toBeVisible();

    // Una búsqueda que no coincide deja la lista vacía (estado vacío).
    await page.getByTestId('buscar-auditor').fill('zzz-no-existe-zzz');
    await expect(page.getByText('No hay auditores que coincidan con la búsqueda.')).toBeVisible();
  });
});
