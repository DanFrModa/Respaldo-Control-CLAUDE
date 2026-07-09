import { expect, test } from '@playwright/test';

import { abrirDesplegableMenu, entrarComoAdmin } from './ayudas';

/**
 * E2E del CRUD de Clientes (F1-E2, D7) contra el stack real, re-vestido R9 a TABLA-FIRST
 * + CAJÓN de detalle. Cubre el ciclo completo del cliente (crear -> lista -> seleccionar
 * (abre el cajón) -> editar -> desactivar con confirmación -> mostrar desactivados ->
 * reactivar -> buscar) y, sobre todo, los CAMPOS DE REFERENCIA (D7): agregar un campo,
 * verlo, y que una etiqueta DUPLICADA en el mismo cliente se rechace (caso de la ficha).
 * Usa un nombre único por corrida. El nombre y el estado (Activo/Inactivo) viven en el
 * TÍTULO del cajón; el contacto y los editores, en su cuerpo — por eso `detalle` apunta
 * al cajón completo.
 */
test.describe('CRUD de Clientes', () => {
  test('crear, editar, desactivar, reactivar y buscar un cliente', async ({ page }) => {
    const sufijo = Date.now().toString().slice(-6);
    const nombre = `Cliente E2E ${sufijo}`;
    const nombreEditado = `${nombre} (editado)`;

    await entrarComoAdmin(page);

    // Navega Comercial · Clientes -> Catálogo (descubrible por clic, no solo por URL).
    await abrirDesplegableMenu(page, 'Clientes');
    await page
      .getByRole('navigation', { name: 'Módulos' })
      .first()
      .getByRole('link', { name: 'Catálogo', exact: true })
      .click();
    await expect(page.getByRole('heading', { name: 'Clientes' })).toBeVisible();

    const detalle = page.locator('[data-slot="cajon-detalle"]');

    // ── Crear ─────────────────────────────────────────────────────────────────
    await page.getByTestId('nuevo-cliente').click();
    const dialogoAlta = page.getByRole('dialog');
    await expect(dialogoAlta.getByRole('heading', { name: 'Nuevo cliente' })).toBeVisible();
    await dialogoAlta.getByLabel('Nombre').fill(nombre);
    await dialogoAlta.getByLabel('Contacto').fill('Ana López');
    await page.getByTestId('guardar-cliente').click();

    await expect(page.getByText(`Cliente "${nombre}" creado.`)).toBeVisible();
    await page.getByTestId('buscar-cliente').fill(nombre);
    const filaNueva = page.getByTestId('fila-cliente').filter({ hasText: nombre });
    await expect(filaNueva).toBeVisible();

    // ── Seleccionar → el detalle muestra el cliente ────────────────────────────
    await filaNueva.click();
    await expect(detalle.getByRole('heading', { name: nombre })).toBeVisible();
    await expect(detalle.getByText('Activo', { exact: true })).toBeVisible();
    await expect(detalle.getByText('Ana López')).toBeVisible();

    // ── Editar ─────────────────────────────────────────────────────────────────
    await page.getByTestId('editar-cliente').click();
    const dialogoEdicion = page.getByRole('dialog');
    await expect(dialogoEdicion.getByRole('heading', { name: 'Editar cliente' })).toBeVisible();
    await expect(dialogoEdicion.getByLabel('Nombre')).toHaveValue(nombre);
    await dialogoEdicion.getByLabel('Nombre').fill(nombreEditado);
    await page.getByTestId('guardar-cliente').click();

    await expect(page.getByText(`Cliente "${nombreEditado}" actualizado.`)).toBeVisible();
    await page.getByTestId('buscar-cliente').fill(nombreEditado);
    const filaEditada = page.getByTestId('fila-cliente').filter({ hasText: nombreEditado });
    await expect(filaEditada).toBeVisible();

    // ── Desactivar (borrado suave) ─────────────────────────────────────────────
    await filaEditada.click();
    await expect(detalle.getByRole('heading', { name: nombreEditado })).toBeVisible();
    await page.getByTestId('desactivar-cliente').click();
    const confirmacion = page.getByRole('dialog');
    await expect(confirmacion.getByRole('heading', { name: 'Desactivar cliente' })).toBeVisible();
    await page.getByTestId('confirmar-accion').click();

    await expect(page.getByText(`Cliente "${nombreEditado}" desactivado.`)).toBeVisible();
    await expect(page.getByTestId('fila-cliente').filter({ hasText: nombreEditado })).toHaveCount(
      0,
    );

    // ── Mostrar desactivados → seleccionar → Inactivo ──────────────────────────
    await page.getByTestId('mostrar-desactivados').click();
    const filaInactiva = page.getByTestId('fila-cliente').filter({ hasText: nombreEditado });
    await expect(filaInactiva).toBeVisible();
    await filaInactiva.click();
    await expect(detalle.getByText('Inactivo', { exact: true })).toBeVisible();

    // ── Reactivar ──────────────────────────────────────────────────────────────
    await page.getByTestId('activar-cliente').click();
    await expect(page.getByText(`Cliente "${nombreEditado}" activado.`)).toBeVisible();
    await expect(detalle.getByText('Activo', { exact: true })).toBeVisible();
    await expect(detalle.getByText('Inactivo', { exact: true })).toHaveCount(0);

    // ── Buscar ─────────────────────────────────────────────────────────────────
    await page.getByTestId('buscar-cliente').fill(nombreEditado);
    await expect(page.getByTestId('fila-cliente').filter({ hasText: nombreEditado })).toBeVisible();
    await page.getByTestId('buscar-cliente').fill('zzz-no-existe-zzz');
    await expect(page.getByText('No hay clientes que coincidan con la búsqueda.')).toBeVisible();
  });
});

/**
 * E2E de los campos de referencia (D7): a un cliente se le agregan DOS campos (con
 * orden), se edita la etiqueta de uno, se desactiva el otro, y se verifica que una
 * etiqueta DUPLICADA en el MISMO cliente se rechaza (caso de la ficha F1-E2). El editor
 * de campos vive en el panel de detalle del cliente.
 */
test.describe('Campos de referencia del cliente (D7)', () => {
  test('agregar 2 campos, editar uno, desactivar otro y rechazar etiqueta duplicada', async ({
    page,
  }) => {
    const sufijo = Date.now().toString().slice(-6);
    const nombre = `Cliente D7 ${sufijo}`;
    const etiquetaPedido = 'No. de pedido del cliente';
    const etiquetaTemporada = 'Temporada del cliente';
    const etiquetaPedidoEditada = 'No. de pedido (cliente)';

    await entrarComoAdmin(page);
    await page.goto('/catalogos/clientes');
    await expect(page.getByRole('heading', { name: 'Clientes' })).toBeVisible();

    // Crea un cliente y selecciónalo.
    await page.getByTestId('nuevo-cliente').click();
    await page.getByRole('dialog').getByLabel('Nombre').fill(nombre);
    await page.getByTestId('guardar-cliente').click();
    await expect(page.getByText(`Cliente "${nombre}" creado.`)).toBeVisible();
    await page.getByTestId('buscar-cliente').fill(nombre);
    await page.getByTestId('fila-cliente').filter({ hasText: nombre }).click();

    const detalle = page.locator('[data-slot="cajon-detalle"]');
    await expect(detalle.getByText('Campos de referencia (D7)')).toBeVisible();

    /** Agrega un campo desde el editor del detalle. */
    async function agregarCampo(etiqueta: string, tipo: string, orden: string): Promise<void> {
      await detalle.getByTestId('nuevo-campo').click();
      const dialogo = page.getByRole('dialog');
      await expect(
        dialogo.getByRole('heading', { name: 'Nuevo campo de referencia' }),
      ).toBeVisible();
      await dialogo.getByLabel('Etiqueta').fill(etiqueta);
      await dialogo.getByLabel('Tipo de dato').selectOption(tipo);
      await dialogo.getByLabel('Orden').fill(orden);
      await page.getByTestId('guardar-campo').click();
      await expect(page.getByText(`Campo "${etiqueta}" agregado.`)).toBeVisible();
    }

    // ── Agregar dos campos (con orden) ──────────────────────────────────────────
    await agregarCampo(etiquetaPedido, 'TEXTO', '1');
    await agregarCampo(etiquetaTemporada, 'TEXTO', '2');
    await expect(detalle.getByTestId('fila-campo')).toHaveCount(2);

    // ── Editar la etiqueta de uno ───────────────────────────────────────────────
    await detalle
      .getByTestId('fila-campo')
      .filter({ hasText: etiquetaPedido })
      .getByTestId('editar-campo')
      .click();
    const dialogoEdicion = page.getByRole('dialog');
    await expect(dialogoEdicion.getByRole('heading', { name: 'Editar campo' })).toBeVisible();
    await dialogoEdicion.getByLabel('Etiqueta').fill(etiquetaPedidoEditada);
    await page.getByTestId('guardar-campo').click();
    await expect(page.getByText(`Campo "${etiquetaPedidoEditada}" actualizado.`)).toBeVisible();
    await expect(
      detalle.getByTestId('fila-campo').filter({ hasText: etiquetaPedidoEditada }),
    ).toBeVisible();

    // ── Desactivar el otro (con confirmación) ───────────────────────────────────
    await detalle
      .getByTestId('fila-campo')
      .filter({ hasText: etiquetaTemporada })
      .getByTestId('desactivar-campo')
      .click();
    const confirmacion = page.getByRole('dialog');
    await expect(confirmacion.getByRole('heading', { name: 'Desactivar campo' })).toBeVisible();
    await page.getByTestId('confirmar-accion').click();
    await expect(page.getByText(`Campo "${etiquetaTemporada}" desactivado.`)).toBeVisible();

    // ── Etiqueta duplicada en el mismo cliente → se rechaza (toast de error) ────
    await detalle.getByTestId('nuevo-campo').click();
    const dialogoDup = page.getByRole('dialog');
    await dialogoDup.getByLabel('Etiqueta').fill(etiquetaPedidoEditada);
    await page.getByTestId('guardar-campo').click();
    // El backend rechaza la etiqueta repetida; el diálogo sigue abierto y NO se duplica.
    await expect(dialogoDup).toBeVisible();
    await expect(
      detalle.getByTestId('fila-campo').filter({ hasText: etiquetaPedidoEditada }),
    ).toHaveCount(1);
  });
});
