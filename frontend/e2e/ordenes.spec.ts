import { expect, test } from '@playwright/test';

import { entrarComoAdmin } from './ayudas';

/**
 * E2E del módulo ÓRDENES de producción (F2-E3) contra el stack real, en la estructura LISTA +
 * DETALLE. Cubre el ciclo del spec: crear un pedido (con renglón) → crear una orden desde ese
 * renglón → capturar la matriz (la orden pasa a 'completa' sola) → copiar la matriz a otra orden →
 * capturar una referencia D7 → cancelar una orden con motivo. Se apoya en un cliente y un modelo
 * creados al vuelo (nombres únicos por corrida) para no depender del estado previo de la base.
 *
 * Asume el admin sembrado (todos los permisos, incluido `ordenes.administrar`/`ordenes.cancelar`)
 * y que existen colores y tallas en los catálogos (sembrados en F1).
 */
test.describe('Órdenes de producción (F2-E3)', () => {
  test('crear orden → capturar matriz (pasa a completa) → copiar matriz → referencia D7 → cancelar', async ({
    page,
  }) => {
    const sufijo = Date.now().toString().slice(-6);
    const cliente = `Cliente Ordenes ${sufijo}`;
    const codigoModelo = `ORD-${sufijo}`;
    // Etiqueta del campo de referencia (D7) que se da de alta al cliente y se captura en la orden.
    const campoReferencia = `No. de pedido ${sufijo}`;
    const valorReferencia = `OC-${sufijo}`;

    await entrarComoAdmin(page);

    // ── Prepara un cliente CON un campo de referencia activo (D7) ───────────────
    await page.goto('/catalogos/clientes');
    await expect(page.getByRole('heading', { name: 'Clientes' })).toBeVisible();
    await page.getByTestId('nuevo-cliente').click();
    await page.getByRole('dialog').getByLabel('Nombre').fill(cliente);
    await page.getByTestId('guardar-cliente').click();
    await expect(page.getByText(`Cliente "${cliente}" creado.`)).toBeVisible();

    // Selecciona el cliente y agrega un ClienteCampo activo desde el editor del detalle (D7), igual
    // que `clientes.spec.ts`. Sin esto, la orden no tendría campos de referencia que capturar.
    await page.getByTestId('buscar-cliente').fill(cliente);
    const detalleCliente = page.getByTestId('detalle-cliente');
    await page.getByTestId('fila-cliente').filter({ hasText: cliente }).first().click();
    await detalleCliente.getByTestId('nuevo-campo').click();
    const dialogoCampo = page.getByRole('dialog');
    await expect(
      dialogoCampo.getByRole('heading', { name: 'Nuevo campo de referencia' }),
    ).toBeVisible();
    await dialogoCampo.getByLabel('Etiqueta').fill(campoReferencia);
    await dialogoCampo.getByLabel('Tipo de dato').selectOption('TEXTO');
    await dialogoCampo.getByLabel('Orden').fill('1');
    await page.getByTestId('guardar-campo').click();
    await expect(page.getByText(`Campo "${campoReferencia}" agregado.`)).toBeVisible();

    // ── Prepara un modelo ───────────────────────────────────────────────────────
    await page.goto('/modelos');
    await expect(page.getByRole('heading', { name: 'Modelos' })).toBeVisible();
    await page.getByTestId('nuevo-modelo').click();
    await page.getByRole('dialog').getByLabel('Código').fill(codigoModelo);
    await page.getByTestId('guardar-modelo').click();
    await expect(page.getByText(`Modelo "${codigoModelo}" creado.`)).toBeVisible();

    // ── Crea un pedido con un renglón (origen de la orden) ──────────────────────
    await page.goto('/pedidos');
    await page.getByTestId('nuevo-pedido').click();
    const dialogoPedido = page.getByRole('dialog');
    await dialogoPedido.getByLabel('Cliente').selectOption({ label: cliente });
    await dialogoPedido.getByTestId('agregar-renglon').click();
    const filaRenglon = dialogoPedido.getByTestId('fila-renglon').first();
    await filaRenglon.getByLabel('Modelo del renglón').selectOption({ label: codigoModelo });
    await filaRenglon.getByLabel('Cantidad del renglón').fill('50');
    await page.getByTestId('guardar-pedido').click();
    await expect(page.getByText(/Pedido \d+ creado\./)).toBeVisible();

    // ── Crea una orden desde el renglón del pedido ──────────────────────────────
    await page.goto('/produccion/ordenes');
    await expect(page.getByRole('heading', { name: 'Órdenes' })).toBeVisible();

    await page.getByTestId('nuevo-orden').click();
    const dialogoAlta = page.getByRole('dialog');
    await expect(dialogoAlta.getByRole('heading', { name: 'Nueva orden' })).toBeVisible();
    await dialogoAlta.getByTestId('orden-buscar-pedido').fill(cliente);
    await dialogoAlta.getByTestId('orden-pedido-opcion').first().click();
    await dialogoAlta.getByTestId('orden-renglon-opcion').first().click();
    await page.getByTestId('confirmar-nueva-orden').click();
    await expect(page.getByText(/Orden \d+ creada\./)).toBeVisible();

    const detalle = page.getByTestId('detalle-orden');
    // El estado arranca en "Capturada".
    await expect(detalle.getByTestId('estado-orden').first()).toHaveText('Capturada');

    // ── Captura la matriz: agrega un color, una talla y una cantidad ────────────
    const matriz = detalle.getByTestId('matriz-orden');
    await matriz.getByTestId('matriz-orden-agregar-color').selectOption({ index: 1 });
    // Si el modelo no trae curva, agrega una talla.
    const agregarTalla = matriz.getByTestId('matriz-orden-agregar-talla');
    if (await agregarTalla.isEnabled()) {
      await agregarTalla.selectOption({ index: 1 });
    }
    await matriz.getByTestId('matriz-orden-celda').first().fill('20');
    await detalle.getByTestId('guardar-matriz').click();
    await expect(page.getByText('Matriz guardada.')).toBeVisible();
    // Al primer guardado con líneas, el estado DERIVA a "Completa".
    await expect(detalle.getByTestId('estado-orden').first()).toHaveText('Completa');

    // ── Crea una segunda orden y copia la matriz de la primera ──────────────────
    await page.getByTestId('nuevo-orden').click();
    const dialogoAlta2 = page.getByRole('dialog');
    await dialogoAlta2.getByTestId('orden-buscar-pedido').fill(cliente);
    await dialogoAlta2.getByTestId('orden-pedido-opcion').first().click();
    await dialogoAlta2.getByTestId('orden-renglon-opcion').first().click();
    await page.getByTestId('confirmar-nueva-orden').click();
    await expect(page.getByText(/Orden \d+ creada\./)).toBeVisible();

    await detalle.getByTestId('abrir-copiar-matriz').click();
    const dialogoCopiar = page.getByRole('dialog');
    await expect(dialogoCopiar.getByRole('heading', { name: /Copiar matriz/ })).toBeVisible();
    await dialogoCopiar.getByTestId('copiar-matriz-opcion').first().click();
    await page.getByTestId('confirmar-copiar-matriz').click();
    await expect(page.getByText('Matriz copiada.')).toBeVisible();

    // ── Captura la referencia D7 del cliente (paso obligatorio, no opcional) ────
    // El panel muestra UN input por cada ClienteCampo activo: aquí el que se dio de alta arriba.
    const campoRef = detalle.getByLabel(campoReferencia);
    await expect(campoRef).toBeVisible();
    await campoRef.fill(valorReferencia);
    await detalle.getByTestId('guardar-referencias').click();
    await expect(page.getByText('Referencias guardadas.')).toBeVisible();
    // El valor capturado persiste en el campo (se conserva tras guardar).
    await expect(campoRef).toHaveValue(valorReferencia);

    // ── Cancela la orden con un motivo ──────────────────────────────────────────
    await page.getByTestId('cancelar-orden').click();
    const dialogoCancelar = page.getByRole('dialog');
    await expect(dialogoCancelar.getByRole('heading', { name: /Cancelar orden/ })).toBeVisible();
    // Sin motivo no se puede confirmar.
    await expect(page.getByTestId('confirmar-cancelar-orden')).toBeDisabled();
    await page.getByTestId('orden-motivo-cancelar').fill('Cancelada en la prueba E2E');
    await page.getByTestId('confirmar-cancelar-orden').click();
    await expect(page.getByText(/Orden \d+ cancelada\./)).toBeVisible();
  });
});
