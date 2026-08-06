import { expect, test, type Page } from '@playwright/test';

import { entrarComoAdmin } from './ayudas';

/**
 * E2E del CRUD de Telas unificadas (F1-E3; reestructura A1 §Post-F9.11) contra el stack
 * real, re-vestido R9 a TABLA-FIRST con filas EXPANDIBLES. Cubre el ciclo completo de una
 * tela CON su grid de colores: crear (con PROVEEDOR dueño — ahora obligatorio en el alta —,
 * tipo de tela de alta rápida + un color con precio) -> aparece en la lista -> expandir el
 * renglón -> el detalle muestra el color con su precio -> editar -> desactivar (con
 * confirmación) -> queda oculta -> mostrar desactivados -> reactivar -> buscar. El estado
 * (Activo/Inactivo) vive en el propio renglón; las acciones son botones del detalle expandido.
 * Usa un nombre único por corrida.
 */

/**
 * Crea un proveedor por la UI (el seed no siembra proveedores) y vuelve: el alta de tela
 * ahora EXIGE el proveedor dueño (§Post-F9.11). Calca los pasos de `proveedores.spec.ts`.
 */
async function crearProveedor(page: Page, nombre: string): Promise<void> {
  await page.goto('/catalogos/proveedores');
  await expect(page.getByRole('heading', { name: 'Proveedores' })).toBeVisible();
  await page.getByTestId('nuevo-proveedor').click();
  const dialogo = page.getByRole('dialog');
  await dialogo.getByLabel('Nombre').fill(nombre);
  // Crear exige >=1 rol (R15): marca el primero del selector (abierto por defecto).
  await dialogo.getByTestId('selector-roles-proveedor').getByRole('checkbox').first().check();
  await page.getByTestId('guardar-proveedor').click();
  await expect(page.getByText(`Proveedor "${nombre}" creado.`)).toBeVisible();
}

/** Elige el proveedor dueño en el combobox del diálogo de tela. */
async function elegirProveedor(page: Page, nombre: string): Promise<void> {
  await page.getByTestId('tela-proveedor-busqueda').fill(nombre);
  await page.getByTestId('tela-proveedor-opcion').filter({ hasText: nombre }).first().click();
}

test.describe('CRUD de Telas (unificadas, con colores)', () => {
  test('crear con proveedor, tipo y un color, editar, desactivar, reactivar y buscar', async ({
    page,
  }) => {
    const sufijo = Date.now().toString().slice(-6);
    const nombre = `Tela E2E ${sufijo}`;
    const nombreEditado = `${nombre} (ed)`;
    const categoria = `Cat E2E ${sufijo}`;
    const proveedor = `Prov Telas ${sufijo}`;

    await entrarComoAdmin(page);
    await crearProveedor(page, proveedor);

    // En el riel "Telas" va a Existencias; el CATÁLOGO de telas salió del riel (R2–R4) y se
    // alcanza por URL directa (sigue vivo) o por ⌘K.
    await page.goto('/catalogos/telas');
    await expect(page.getByRole('heading', { name: 'Telas' })).toBeVisible();

    const detalle = page.getByTestId('detalle-tela');

    // ── Crear (con categoría de alta rápida y un color con precio) ──────────────
    await page.getByTestId('nuevo-tela').click();
    const dialogoAlta = page.getByRole('dialog');
    await expect(dialogoAlta.getByRole('heading', { name: 'Nueva tela' })).toBeVisible();
    // El label "Nombre" ya no es único (Nombre del proveedor/cuerpo/complemento): por id.
    await dialogoAlta.locator('#tela-nombre').fill(nombre);

    // El PROVEEDOR dueño es OBLIGATORIO en el alta (§Post-F9.11): se elige del combobox.
    await elegirProveedor(page, proveedor);

    // La UNIDAD es obligatoria y arranca SIN elegir (30-jul-2026): sin esto el alta no guarda.
    // Se elige METROS a propósito — es la unidad "no default", así que si algún día volviera a
    // colarse un valor preseleccionado, esta prueba lo cazaría al verificar el detalle.
    await expect(dialogoAlta.getByTestId('tela-unidad')).toHaveValue('');
    await dialogoAlta.getByTestId('tela-unidad').selectOption('M');

    // Alta rápida de tipo de tela: abre el sub-diálogo, lo crea y queda seleccionado.
    await dialogoAlta.getByTestId('nueva-categoria-tela').click();
    const dialogoCategoria = page.getByRole('dialog').filter({ hasText: 'Nuevo tipo de tela' });
    await dialogoCategoria.getByLabel('Nombre').fill(categoria);
    await page.getByTestId('guardar-categoria-tela').click();
    await expect(page.getByText(`Tipo de tela "${categoria}" creado.`)).toBeVisible();

    // Agrega un color PROPIO de la tela (nombre libre, §Post-F9.11) y captura su precio.
    await dialogoAlta.getByTestId('nombre-agregar-color').fill('Marino Alsa 3040');
    await dialogoAlta.getByTestId('agregar-color').click();
    await dialogoAlta.getByTestId('grid-colores-tela').getByRole('spinbutton').first().fill('95');

    await page.getByTestId('guardar-tela').click();
    await expect(page.getByText(`Tela "${nombre}" creada.`)).toBeVisible();

    // La fila aparece; la búsqueda la aísla.
    await page.getByTestId('buscar-tela').fill(nombre);
    const filaNueva = page.getByTestId('fila-tela').filter({ hasText: nombre });
    await expect(filaNueva).toBeVisible();

    // ── Expandir el renglón → el detalle muestra el color con precio (R9: filas expandibles) ─
    // El estado (Activo) vive en el propio renglón; el detalle, al expandir.
    await expect(filaNueva.getByText('Activo', { exact: true })).toBeVisible();
    // La identidad se lee de corrido: "nombre · proveedor" (§Post-F9.11).
    await expect(filaNueva.getByTestId('identidad-tela')).toHaveText(`${nombre} · ${proveedor}`);
    await filaNueva.click();
    await expect(detalle.getByTestId('tela-colores-detalle')).toBeVisible();
    // La unidad ELEGIDA se guardó y se lee (si se hubiera colado un default, aquí diría "kg").
    await expect(detalle.getByTestId('tela-detalle-unidad')).toHaveText('m');
    // El proveedor dueño se guardó y se lee en el detalle.
    await expect(detalle.getByTestId('tela-detalle-proveedor')).toHaveText(proveedor);

    // ── Editar (botón del detalle expandido) ───────────────────────────────────
    await page.getByTestId('editar-tela').click();
    const dialogoEdicion = page.getByRole('dialog');
    await expect(dialogoEdicion.getByRole('heading', { name: 'Editar tela' })).toBeVisible();
    await expect(dialogoEdicion.locator('#tela-nombre')).toHaveValue(nombre);
    // La edición pre-carga la unidad guardada (metros), no un default.
    await expect(dialogoEdicion.getByTestId('tela-unidad')).toHaveValue('M');
    await dialogoEdicion.locator('#tela-nombre').fill(nombreEditado);
    await page.getByTestId('guardar-tela').click();

    await expect(page.getByText(`Tela "${nombreEditado}" actualizada.`)).toBeVisible();
    await page.getByTestId('buscar-tela').fill(nombreEditado);
    const filaEditada = page.getByTestId('fila-tela').filter({ hasText: nombreEditado });
    await expect(filaEditada).toBeVisible();

    // ── Desactivar (borrado suave) ─────────────────────────────────────────────
    await filaEditada.click();
    await expect(page.getByTestId('desactivar-tela')).toBeVisible();
    await page.getByTestId('desactivar-tela').click();
    const confirmacion = page.getByRole('dialog');
    await expect(confirmacion.getByRole('heading', { name: 'Desactivar tela' })).toBeVisible();
    await page.getByTestId('confirmar-accion').click();

    await expect(page.getByText(`Tela "${nombreEditado}" desactivada.`)).toBeVisible();
    await expect(page.getByTestId('fila-tela').filter({ hasText: nombreEditado })).toHaveCount(0);

    // ── Mostrar desactivados → el renglón la marca Inactivo; al expandir ofrece Activar ─
    await page.getByTestId('mostrar-desactivados').click();
    const filaInactiva = page.getByTestId('fila-tela').filter({ hasText: nombreEditado });
    await expect(filaInactiva).toBeVisible();
    await expect(filaInactiva.getByText('Inactivo', { exact: true })).toBeVisible();
    await filaInactiva.click();

    // ── Reactivar (botón del detalle expandido) ────────────────────────────────
    await page.getByTestId('activar-tela').click();
    await expect(page.getByText(`Tela "${nombreEditado}" activada.`)).toBeVisible();
    await expect(filaInactiva.getByText('Activo', { exact: true })).toBeVisible();

    // ── Buscar ─────────────────────────────────────────────────────────────────
    await page.getByTestId('buscar-tela').fill('zzz-no-existe-zzz');
    await expect(page.getByText('No hay telas que coincidan con la búsqueda.')).toBeVisible();
  });

  test('rechaza una tela con nombre duplicado (unicidad global) y exige el proveedor', async ({
    page,
  }) => {
    const sufijo = Date.now().toString().slice(-6);
    const nombre = `Tela Dup ${sufijo}`;
    const proveedor = `Prov Dup ${sufijo}`;

    await entrarComoAdmin(page);
    await crearProveedor(page, proveedor);
    await page.goto('/catalogos/telas');
    await expect(page.getByRole('heading', { name: 'Telas' })).toBeVisible();

    // Primera alta (sin colores ni tipo: opcionales; la UNIDAD y el PROVEEDOR no lo son).
    await page.getByTestId('nuevo-tela').click();
    const primerDialogo = page.getByRole('dialog');
    await primerDialogo.locator('#tela-nombre').fill(nombre);
    await primerDialogo.getByTestId('tela-unidad').selectOption('KG');
    // SIN proveedor el formulario bloquea y explica (obligatorio en alta, §Post-F9.11).
    await page.getByTestId('guardar-tela').click();
    await expect(page.getByTestId('error-proveedor-tela')).toBeVisible();
    await elegirProveedor(page, proveedor);
    await page.getByTestId('guardar-tela').click();
    await expect(page.getByText(`Tela "${nombre}" creada.`)).toBeVisible();

    // Segunda alta con el mismo nombre: el backend la rechaza (toast de error) y el
    // diálogo NO se cierra.
    await page.getByTestId('nuevo-tela').click();
    const dialogo = page.getByRole('dialog');
    await dialogo.locator('#tela-nombre').fill(nombre);
    await elegirProveedor(page, proveedor);
    // La unidad también aquí, y no es un detalle: sin ella el FORMULARIO bloquearía antes de
    // mandar nada, y esta prueba —que existe para verificar que el BACKEND rechaza el nombre
    // duplicado (unicidad global, ADR-0007)— dejaría de probar eso en silencio.
    await dialogo.getByTestId('tela-unidad').selectOption('KG');
    await page.getByTestId('guardar-tela').click();
    await expect(page.getByText(/Ya existe una tela llamada/)).toBeVisible();
    await expect(dialogo.getByRole('heading', { name: 'Nueva tela' })).toBeVisible();
  });
});
