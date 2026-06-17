import { expect, test } from '@playwright/test';

import { entrarComoAdmin } from './ayudas';

/**
 * E2E del módulo PEDIDOS (F2-E1) contra el stack real, en la estructura LISTA + DETALLE. Cubre
 * el ciclo del spec: crear un pedido (con renglón) → copiarlo con selección múltiple → crear un
 * pedido real (réplica automática de renglones). Se apoya en un cliente y un modelo creados al
 * vuelo (nombres únicos por corrida) para no depender del estado previo de la base.
 *
 * Las acciones de escritura asumen el admin sembrado (todos los permisos, incluida la captura de
 * pedidos reales y la visibilidad de importes).
 */
test.describe('Pedidos (F2-E1)', () => {
  test('crear pedido → copiar con selección múltiple → crear pedido real', async ({ page }) => {
    const sufijo = Date.now().toString().slice(-6);
    const cliente = `Cliente Pedidos ${sufijo}`;
    const codigoModelo = `PED-${sufijo}`;

    await entrarComoAdmin(page);

    // ── Prepara un cliente ──────────────────────────────────────────────────────
    await page.goto('/catalogos/clientes');
    await expect(page.getByRole('heading', { name: 'Clientes' })).toBeVisible();
    await page.getByTestId('nuevo-cliente').click();
    await page.getByRole('dialog').getByLabel('Nombre').fill(cliente);
    await page.getByTestId('guardar-cliente').click();
    await expect(page.getByText(`Cliente "${cliente}" creado.`)).toBeVisible();

    // ── Prepara un modelo ───────────────────────────────────────────────────────
    await page.goto('/modelos');
    await expect(page.getByRole('heading', { name: 'Modelos' })).toBeVisible();
    await page.getByTestId('nuevo-modelo').click();
    await page.getByRole('dialog').getByLabel('Código').fill(codigoModelo);
    await page.getByTestId('guardar-modelo').click();
    await expect(page.getByText(`Modelo "${codigoModelo}" creado.`)).toBeVisible();

    // ── Crea un pedido con un renglón ───────────────────────────────────────────
    await page.goto('/pedidos');
    await expect(page.getByRole('heading', { name: 'Pedidos' })).toBeVisible();

    await page.getByTestId('nuevo-pedido').click();
    const dialogoAlta = page.getByRole('dialog');
    await expect(dialogoAlta.getByRole('heading', { name: 'Nuevo pedido' })).toBeVisible();
    await dialogoAlta.getByLabel('Cliente').selectOption({ label: cliente });
    await dialogoAlta.getByTestId('agregar-renglon').click();
    const fila = dialogoAlta.getByTestId('fila-renglon').first();
    // El modelo recién creado no tiene descripción: la opción es solo su código.
    await fila.getByLabel('Modelo del renglón').selectOption({ label: codigoModelo });
    await fila.getByLabel('Cantidad del renglón').fill('25');
    await fila.getByLabel('Precio del renglón').fill('80');
    await page.getByTestId('guardar-pedido').click();
    await expect(page.getByText(/Pedido \d+ creado\./)).toBeVisible();

    // El pedido nuevo aparece en la lista; selecciónalo y verifica su renglón.
    const detalle = page.getByTestId('detalle-pedido');
    const filaLista = page.getByTestId('fila-pedido').filter({ hasText: cliente }).first();
    await filaLista.click();
    await expect(
      detalle.getByTestId('renglon-pedido').filter({ hasText: codigoModelo }),
    ).toBeVisible();

    // ── Copiar con selección múltiple ───────────────────────────────────────────
    await page.getByTestId('copiar-pedido').click();
    const dialogoCopiar = page.getByRole('dialog');
    await expect(dialogoCopiar.getByRole('heading', { name: /Copiar pedido/ })).toBeVisible();
    // El renglón viene marcado por defecto (copiar todos).
    await expect(dialogoCopiar.getByTestId('copiar-renglon-check')).toBeChecked();
    await page.getByTestId('confirmar-copiar').click();
    await expect(page.getByText(/copiado en el \d+\./)).toBeVisible();

    // ── Crear un pedido real (réplica automática de renglones) ──────────────────
    // Vuelve a seleccionar un pedido del cliente (el primero de la lista).
    await page.getByTestId('buscar-pedido').fill(cliente);
    await page.getByTestId('fila-pedido').filter({ hasText: cliente }).first().click();

    await detalle.getByTestId('nuevo-pedido-real').click();
    const dialogoReal = page.getByRole('dialog');
    await expect(dialogoReal.getByRole('heading', { name: 'Nuevo pedido real' })).toBeVisible();
    await dialogoReal.getByLabel('CEDIS').fill('CEDIS Norte');
    await page.getByTestId('confirmar-pedido-real').click();
    await expect(page.getByText('Pedido real creado.')).toBeVisible();

    // El pedido real aparece con su renglón replicado y la columna de seguimiento.
    await expect(
      detalle.getByTestId('pedido-real').filter({ hasText: 'CEDIS Norte' }),
    ).toBeVisible();
    await expect(
      detalle.getByTestId('pedido-real').getByText(codigoModelo, { exact: false }),
    ).toBeVisible();
  });
});
