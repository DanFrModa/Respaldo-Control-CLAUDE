import { expect, test, type Page } from '@playwright/test';

import { entrarComoAdmin } from './ayudas';

/**
 * E2E del CRUD de Avíos (F1-E3, R1) contra el stack real, en la estructura LISTA + DETALLE
 * (rediseño "Teal fresco", mismo patrón que Maquileros). Cubre el ciclo completo: crear (con
 * 2 proveedores y marcando genérico) -> aparece en la lista -> seleccionar -> el detalle
 * muestra los proveedores y el badge Genérico -> editar -> se refleja -> desactivar (con
 * confirmación) -> queda oculto -> mostrar desactivados -> reactivar -> vuelve a activo ->
 * buscar. Como el avío referencia proveedores, primero se siembran 2 proveedores por la UI.
 * Usa una clave única por corrida.
 *
 * NOTA (integración): asume que la ruta `/catalogos/avios` y la tarjeta `catalogo-avios`
 * están cableadas (App.tsx + portada de Catálogos). Mientras integración no las wire, los
 * pasos de navegación fallan (deuda esperada, no se tapa).
 */

/** Crea un proveedor por la UI (mínimo: nombre + ≥1 rol) y vuelve a la portada de catálogos. */
async function crearProveedor(page: Page, nombre: string): Promise<void> {
  await page.goto('/catalogos/proveedores');
  await expect(page.getByRole('heading', { name: 'Proveedores' })).toBeVisible();
  await page.getByTestId('nuevo-proveedor').click();
  const dialogo = page.getByRole('dialog');
  // El label "Nombre" del proveedor lleva ahora la marca de obligatorio (asterisco + texto
  // solo-lectores), así que se ubica por coincidencia de prefijo, no exacta.
  await dialogo.getByLabel(/^Nombre/).fill(nombre);
  // El proveedor exige ≥1 rol/servicio: marca el primero disponible.
  await dialogo.getByTestId('selector-roles-proveedor').getByRole('checkbox').first().check();
  await page.getByTestId('guardar-proveedor').click();
  await expect(page.getByText(`Proveedor "${nombre}" creado.`)).toBeVisible();
}

test.describe('CRUD de Avíos', () => {
  test('crear con 2 proveedores y genérico, editar, desactivar, reactivar y buscar', async ({
    page,
  }) => {
    const sufijo = Date.now().toString().slice(-6);
    const clave = `AVIO-E2E-${sufijo}`;
    const claveEditada = `${clave}-ED`;
    const prov1 = `Prov E2E A ${sufijo}`;
    const prov2 = `Prov E2E B ${sufijo}`;

    await entrarComoAdmin(page);

    // Siembra 2 proveedores que el avío usará.
    await crearProveedor(page, prov1);
    await crearProveedor(page, prov2);

    // En el riel "Avíos" va a Existencias; el CATÁLOGO de avíos salió del riel (R2–R4) y se
    // alcanza por URL directa (sigue vivo) o por ⌘K.
    await page.goto('/catalogos/avios');
    await expect(page.getByRole('heading', { name: 'Avíos' })).toBeVisible();

    const detalle = page.getByTestId('detalle-avio');

    // ── Crear (2 proveedores + genérico) ────────────────────────────────────────
    await page.getByTestId('nuevo-avio').click();
    const dialogoAlta = page.getByRole('dialog');
    await expect(dialogoAlta.getByRole('heading', { name: 'Nuevo avío' })).toBeVisible();
    await dialogoAlta.getByLabel('Clave').fill(clave);
    await dialogoAlta.getByLabel('Descripción').fill('Botón de prueba E2E');
    await dialogoAlta.getByLabel('Unidad').fill('pza');
    await dialogoAlta.getByLabel('Presentación').fill('CAJA');
    // Marca genérico.
    await dialogoAlta.getByTestId('avio-generico').check();
    // Agrega los 2 proveedores (el select se vacía tras cada selección: siempre el primero).
    await dialogoAlta.getByTestId('agregar-proveedor-avio').selectOption({ label: prov1 });
    await dialogoAlta.getByTestId('agregar-proveedor-avio').selectOption({ label: prov2 });
    await expect(
      dialogoAlta.getByTestId('proveedores-avio-elegidos').getByRole('listitem'),
    ).toHaveCount(2);
    await page.getByTestId('guardar-avio').click();

    // El toast confirma y la fila aparece; la búsqueda la aísla.
    await expect(page.getByText(`Avío "${clave}" creado.`)).toBeVisible();
    await page.getByTestId('buscar-avio').fill(clave);
    const filaNueva = page.getByTestId('fila-avio').filter({ hasText: clave });
    await expect(filaNueva).toBeVisible();

    // ── Expandir el renglón → el detalle muestra los proveedores (R9: filas expandibles) ──
    // El estado (Activo) y el chip Genérico viven en el propio renglón; los proveedores, al expandir.
    await expect(filaNueva.getByText('Activo', { exact: true })).toBeVisible();
    await expect(filaNueva.getByText('Genérico').first()).toBeVisible();
    await filaNueva.click();
    await expect(detalle.getByTestId('avio-proveedores-detalle').getByText(prov1)).toBeVisible();
    await expect(detalle.getByTestId('avio-proveedores-detalle').getByText(prov2)).toBeVisible();

    // ── Editar (cambia la clave) ────────────────────────────────────────────────
    await page.getByTestId('editar-avio').click();
    const dialogoEdicion = page.getByRole('dialog');
    await expect(dialogoEdicion.getByRole('heading', { name: 'Editar avío' })).toBeVisible();
    await expect(dialogoEdicion.getByLabel('Clave')).toHaveValue(clave);
    await dialogoEdicion.getByLabel('Clave').fill(claveEditada);
    await page.getByTestId('guardar-avio').click();

    await expect(page.getByText(`Avío "${claveEditada}" actualizado.`)).toBeVisible();
    await page.getByTestId('buscar-avio').fill(claveEditada);
    const filaEditada = page.getByTestId('fila-avio').filter({ hasText: claveEditada });
    await expect(filaEditada).toBeVisible();

    // ── Desactivar (borrado suave) ──────────────────────────────────────────────
    await filaEditada.click();
    await expect(page.getByTestId('desactivar-avio')).toBeVisible();
    await page.getByTestId('desactivar-avio').click();
    const confirmacion = page.getByRole('dialog');
    await expect(confirmacion.getByRole('heading', { name: 'Desactivar avío' })).toBeVisible();
    await page.getByTestId('confirmar-accion').click();

    await expect(page.getByText(`Avío "${claveEditada}" desactivado.`)).toBeVisible();
    await expect(page.getByTestId('fila-avio').filter({ hasText: claveEditada })).toHaveCount(0);

    // ── Mostrar desactivados → el renglón lo marca Inactivo; al expandir ofrece Activar ─
    await page.getByTestId('mostrar-desactivados').click();
    const filaInactiva = page.getByTestId('fila-avio').filter({ hasText: claveEditada });
    await expect(filaInactiva).toBeVisible();
    await expect(filaInactiva.getByText('Inactivo', { exact: true })).toBeVisible();
    await filaInactiva.click();

    // ── Reactivar (botón directo del detalle expandido) ─────────────────────────
    await page.getByTestId('activar-avio').click();
    await expect(page.getByText(`Avío "${claveEditada}" activado.`)).toBeVisible();
    await expect(filaInactiva.getByText('Activo', { exact: true })).toBeVisible();
    await expect(filaInactiva.getByText('Inactivo', { exact: true })).toHaveCount(0);

    // ── Buscar ──────────────────────────────────────────────────────────────────
    await page.getByTestId('buscar-avio').fill(claveEditada);
    await expect(page.getByTestId('fila-avio').filter({ hasText: claveEditada })).toBeVisible();
    await page.getByTestId('buscar-avio').fill('zzz-no-existe-zzz');
    await expect(page.getByText('No hay avíos que coincidan con la búsqueda.')).toBeVisible();
  });

  test('favorito sin cantidad preestablecida es rechazado (regla favorito ⇒ cantFav)', async ({
    page,
  }) => {
    const sufijo = Date.now().toString().slice(-6);
    const clave = `AVIO-FAV-${sufijo}`;

    await entrarComoAdmin(page);
    await page.goto('/catalogos/avios');
    await expect(page.getByRole('heading', { name: 'Avíos' })).toBeVisible();

    await page.getByTestId('nuevo-avio').click();
    const dialogo = page.getByRole('dialog');
    await dialogo.getByLabel('Clave').fill(clave);
    await dialogo.getByLabel('Descripción').fill('Favorito sin cantidad');
    await dialogo.getByLabel('Unidad').fill('pza');
    await dialogo.getByLabel('Presentación').fill('CAJA');
    // Marca favorito pero NO captura la cantidad: al guardar, el form muestra el error y NO cierra.
    await dialogo.getByTestId('avio-favorito').check();
    await page.getByTestId('guardar-avio').click();

    await expect(
      dialogo.getByText('Si el avío es favorito, captura la cantidad preestablecida (mayor a 0)'),
    ).toBeVisible();
    await expect(dialogo.getByRole('heading', { name: 'Nuevo avío' })).toBeVisible();
  });
});
