import { expect, test, type Page } from '@playwright/test';

import { crearColorYTalla, entrarComoAdmin } from './ayudas';

/**
 * E2E del módulo ÓRDENES (rediseño R2) contra el stack real:
 *
 *  1. La CAPTURA/edición completa (F2-E3, lista + detalle) sigue viva en
 *     `/produccion/ordenes/captura`: crear pedido → orden → matriz → copiar → referencia D7 →
 *     cancelar (el flujo original, con la ruta nueva).
 *  2. El CENTRO DE COMANDO (`/produccion/ordenes`, §4.2) + AVANCE de producción (§4.3): la tabla
 *     de 13 columnas con filtros de servidor, el panel persistente con la matriz siempre visible,
 *     doble clic → avance, y el registro REAL de un corte (combobox de cortador + matriz con
 *     candado + "capturado por"). También la paleta ⌘K encontrando la orden por folio (B4).
 *
 * Lecciones F5-E4 aplicadas: color+talla se siembran PRIMERO (`crearColorYTalla`); las lecturas
 * de "el primero" usan filtros por texto único de la corrida (nada depende del orden de la suite).
 */

/** Crea cliente + modelo + pedido (50 pzas) y una orden con matriz de 20 pzas. Devuelve el folio. */
async function crearOrdenConMatriz(
  page: Page,
  nombres: { cliente: string; codigoModelo: string; color: string; talla: string },
): Promise<string> {
  // Cliente.
  await page.goto('/catalogos/clientes');
  await expect(page.getByRole('heading', { name: 'Clientes' })).toBeVisible();
  await page.getByTestId('nuevo-cliente').click();
  await page.getByRole('dialog').getByLabel('Nombre').fill(nombres.cliente);
  await page.getByTestId('guardar-cliente').click();
  await expect(page.getByText(`Cliente "${nombres.cliente}" creado.`)).toBeVisible();

  // Modelo.
  await page.goto('/modelos');
  await expect(page.getByRole('heading', { name: 'Modelos' })).toBeVisible();
  await page.getByTestId('nuevo-modelo').click();
  await page.getByRole('dialog').getByLabel('Código').fill(nombres.codigoModelo);
  await page.getByTestId('guardar-modelo').click();
  await expect(page.getByText(`Modelo "${nombres.codigoModelo}" creado.`)).toBeVisible();

  // Pedido con un renglón (origen de la orden).
  await page.goto('/pedidos');
  await page.getByTestId('nuevo-pedido').click();
  const dialogoPedido = page.getByRole('dialog');
  await dialogoPedido.getByLabel('Cliente').selectOption({ label: nombres.cliente });
  await dialogoPedido.getByTestId('agregar-renglon').click();
  const filaRenglon = dialogoPedido.getByTestId('fila-renglon').first();
  await filaRenglon.getByLabel('Modelo del renglón').selectOption({ label: nombres.codigoModelo });
  await filaRenglon.getByLabel('Cantidad del renglón').fill('50');
  await page.getByTestId('guardar-pedido').click();
  await expect(page.getByText(/Pedido \d+ creado\./)).toBeVisible();

  // Orden desde el renglón, en la pantalla de CAPTURA (la de siempre, ruta nueva).
  await page.goto('/produccion/ordenes/captura');
  await expect(page.getByRole('heading', { name: 'Órdenes' })).toBeVisible();
  await page.getByTestId('nuevo-orden').click();
  const dialogoAlta = page.getByRole('dialog');
  await dialogoAlta.getByTestId('orden-buscar-pedido').fill(nombres.cliente);
  await dialogoAlta.getByTestId('orden-pedido-opcion').first().click();
  await dialogoAlta.getByTestId('orden-renglon-opcion').first().click();
  await page.getByTestId('confirmar-nueva-orden').click();
  const toastCreada = page.getByText(/Orden \d+ creada\./);
  await expect(toastCreada).toBeVisible();
  const folio = /Orden (\d+) creada\./.exec((await toastCreada.textContent()) ?? '')?.[1] ?? '';
  expect(folio).not.toBe('');

  // Matriz: el color y la talla creados para ESTA corrida (determinista, lección F5-E4).
  const detalle = page.getByTestId('detalle-orden');
  const matriz = detalle.getByTestId('matriz-orden');
  await matriz.getByTestId('matriz-orden-agregar-color').selectOption({ label: nombres.color });
  const agregarTalla = matriz.getByTestId('matriz-orden-agregar-talla');
  if (await agregarTalla.isEnabled()) {
    await agregarTalla.selectOption({ label: nombres.talla });
  }
  await matriz.getByTestId('matriz-orden-celda').first().fill('20');
  await detalle.getByTestId('guardar-matriz').click();
  await expect(page.getByText('Matriz guardada.')).toBeVisible();
  return folio;
}

test.describe('Órdenes — captura completa (F2-E3, en /captura)', () => {
  test('crear orden → matriz (pasa a completa) → copiar matriz → referencia D7 → cancelar', async ({
    page,
  }) => {
    const sufijo = Date.now().toString().slice(-6);
    const cliente = `Cliente Ordenes ${sufijo}`;
    const codigoModelo = `ORD-${sufijo}`;
    const campoReferencia = `No. de pedido ${sufijo}`;
    const valorReferencia = `OC-${sufijo}`;

    await entrarComoAdmin(page);
    const { color, talla } = await crearColorYTalla(page, sufijo);

    // ── Cliente CON un campo de referencia activo (D7) ──────────────────────────
    await page.goto('/catalogos/clientes');
    await expect(page.getByRole('heading', { name: 'Clientes' })).toBeVisible();
    await page.getByTestId('nuevo-cliente').click();
    await page.getByRole('dialog').getByLabel('Nombre').fill(cliente);
    await page.getByTestId('guardar-cliente').click();
    await expect(page.getByText(`Cliente "${cliente}" creado.`)).toBeVisible();

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

    // ── Modelo ──────────────────────────────────────────────────────────────────
    await page.goto('/modelos');
    await expect(page.getByRole('heading', { name: 'Modelos' })).toBeVisible();
    await page.getByTestId('nuevo-modelo').click();
    await page.getByRole('dialog').getByLabel('Código').fill(codigoModelo);
    await page.getByTestId('guardar-modelo').click();
    await expect(page.getByText(`Modelo "${codigoModelo}" creado.`)).toBeVisible();

    // ── Pedido con un renglón ───────────────────────────────────────────────────
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

    // ── Orden desde el renglón (pantalla de CAPTURA, ruta nueva /captura) ───────
    await page.goto('/produccion/ordenes/captura');
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
    await expect(detalle.getByTestId('estado-orden').first()).toHaveText('Capturada');

    // ── Matriz: color + talla de ESTA corrida y una cantidad ────────────────────
    const matriz = detalle.getByTestId('matriz-orden');
    await matriz.getByTestId('matriz-orden-agregar-color').selectOption({ label: color });
    const agregarTalla = matriz.getByTestId('matriz-orden-agregar-talla');
    if (await agregarTalla.isEnabled()) {
      await agregarTalla.selectOption({ label: talla });
    }
    await matriz.getByTestId('matriz-orden-celda').first().fill('20');
    await detalle.getByTestId('guardar-matriz').click();
    await expect(page.getByText('Matriz guardada.')).toBeVisible();
    await expect(detalle.getByTestId('estado-orden').first()).toHaveText('Completa');

    // ── Segunda orden + copiar matriz ───────────────────────────────────────────
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

    // ── Referencia D7 ───────────────────────────────────────────────────────────
    const campoRef = detalle.getByLabel(campoReferencia);
    await expect(campoRef).toBeVisible();
    await campoRef.fill(valorReferencia);
    await detalle.getByTestId('guardar-referencias').click();
    await expect(page.getByText('Referencias guardadas.')).toBeVisible();
    await expect(campoRef).toHaveValue(valorReferencia);

    // ── Cancelar con motivo ─────────────────────────────────────────────────────
    await page.getByTestId('cancelar-orden').click();
    const dialogoCancelar = page.getByRole('dialog');
    await expect(dialogoCancelar.getByRole('heading', { name: /Cancelar orden/ })).toBeVisible();
    await expect(page.getByTestId('confirmar-cancelar-orden')).toBeDisabled();
    await page.getByTestId('orden-motivo-cancelar').fill('Cancelada en la prueba E2E');
    await page.getByTestId('confirmar-cancelar-orden').click();
    await expect(page.getByText(/Orden \d+ cancelada\./)).toBeVisible();
  });
});

test.describe('Órdenes — centro de comando + avance de producción (R2)', () => {
  test('la tabla de 13 columnas filtra en servidor, el panel muestra la matriz y el avance registra un corte', async ({
    page,
  }) => {
    const sufijo = (Date.now() + 1).toString().slice(-6);
    const cliente = `Cliente Centro ${sufijo}`;
    const codigoModelo = `CEN-${sufijo}`;
    const cortador = `Cortador E2E ${sufijo}`;

    await entrarComoAdmin(page);
    const { color, talla } = await crearColorYTalla(page, sufijo);

    // ── Un proveedor con el rol CORTE (el avance exige el rol, D12/R15) ─────────
    await page.goto('/catalogos/proveedores');
    await expect(page.getByRole('heading', { name: 'Proveedores' })).toBeVisible();
    await page.getByTestId('nuevo-proveedor').click();
    const dialogoProveedor = page.getByRole('dialog');
    await dialogoProveedor.getByLabel('Nombre').fill(cortador);
    await dialogoProveedor
      .getByTestId('selector-roles-proveedor')
      .getByRole('checkbox', { name: 'Corte', exact: true })
      .check();
    await page.getByTestId('guardar-proveedor').click();
    await expect(page.getByText(`Proveedor "${cortador}" creado.`)).toBeVisible();

    // ── Orden con matriz (20 pzas) ──────────────────────────────────────────────
    const folio = await crearOrdenConMatriz(page, { cliente, codigoModelo, color, talla });

    // ── Centro de comando: buscar por folio (filtro de servidor) ────────────────
    await page.goto('/produccion/ordenes');
    await expect(page.getByRole('heading', { name: 'Órdenes de producción' })).toBeVisible();
    // Las tabs de mes y los filtros están presentes.
    await expect(page.getByTestId('centro-meses')).toBeVisible();
    await expect(page.getByTestId('centro-filtro-oc')).toBeVisible();

    await page.getByTestId('centro-busqueda').fill(folio);
    const fila = page.getByTestId('centro-fila').filter({ hasText: codigoModelo }).first();
    await expect(fila).toBeVisible();
    // Columnas clave de la fila: ordenada 20, sin cortar, OC de tela "falta".
    await expect(fila).toContainText('20');
    await expect(fila).toContainText('falta');
    await expect(fila).toContainText(cliente);

    // ── Panel persistente: matriz SIEMPRE visible + precios + mosaicos ─────────
    await fila.click();
    const panel = page.getByTestId('centro-panel');
    await expect(panel.getByText(`OP ${folio}`)).toBeVisible();
    await expect(panel.getByTestId('centro-matriz')).toBeVisible();
    await expect(panel.getByTestId('centro-matriz-total')).toHaveText('20');
    await expect(panel.getByTestId('centro-mosaicos')).toBeVisible();
    await expect(panel.getByTestId('mosaico-habilitacion')).toBeDisabled();
    await expect(panel.getByTestId('panel-precios')).toBeVisible();

    // ── Doble clic → AVANCE DE PRODUCCIÓN (stepper de 5 etapas) ────────────────
    await fila.dblclick();
    const avance = page.getByTestId('avance-produccion');
    await expect(avance).toBeVisible();
    await expect(avance.getByText(`Avance de producción · OP ${folio}`)).toBeVisible();
    await expect(avance.getByTestId('avance-stepper-corte')).toContainText('0/20');
    await expect(avance.getByTestId('avance-stepper-recibo-aplicacion')).toBeVisible();

    // ── Registrar un CORTE real: combobox con búsqueda (homónimos) + candado ────
    await avance.getByTestId('avance-abrir-captura').click();
    const captura = avance.getByTestId('avance-captura');
    await expect(captura.getByText(/Candado: solo colores y tallas de la orden/)).toBeVisible();
    // El combobox filtra sin acentos/mayúsculas: "cortador e2e" encuentra al proveedor.
    await captura.getByTestId('avance-proveedor-input').fill(`cortador e2e ${sufijo}`);
    await page.getByTestId('avance-proveedor-opcion').first().click();
    // La matriz con candado SOLO trae la celda del color/talla de la orden.
    await expect(captura.getByTestId('avance-matriz-celda')).toHaveCount(1);
    await captura.getByTestId('avance-matriz-celda').fill('20');
    await expect(captura.getByTestId('avance-matriz-estado')).toContainText('Cuadra');
    await captura.getByTestId('avance-guardar').click();
    // Toast con la nota del auto-avance de la Ruta Crítica (F3→F5).
    await expect(page.getByText(/la Ruta Crítica se marca sola/)).toBeVisible();

    // El movimiento aparece en la lista con su "capturado por" (A7/§4.4.4)…
    const movimiento = avance.getByTestId('avance-movimiento').first();
    await expect(movimiento).toContainText(cortador);
    await expect(movimiento).toContainText('Administrador');
    await expect(movimiento).toContainText('20');
    // …y el stepper marca el corte COMPLETO (20/20).
    await expect(avance.getByTestId('avance-stepper-corte')).toContainText('20/20');
    await expect(avance.getByTestId('avance-stepper-corte')).toHaveAttribute('data-estado', 'done');
    // Resumen en dos bloques (costura + aplicación).
    await expect(avance.getByTestId('avance-resumen')).toContainText('Resumen · costura');

    // Cerrar el avance regresa al centro, con la cortada actualizada (servidor).
    await avance.getByTestId('avance-cerrar').click();
    await expect(page.getByTestId('avance-produccion')).toHaveCount(0);

    // ── La paleta ⌘K encuentra la ORDEN por folio (B4: absorbió el buscador) ────
    await page.getByTestId('abrir-paleta').click();
    await page.getByTestId('paleta-input').fill(folio);
    const hit = page.getByTestId('paleta-orden').first();
    await expect(hit).toContainText(`Orden ${folio}`);
    await hit.click();
    await expect(page).toHaveURL(/\/produccion\/ordenes$/);
    await expect(page.getByTestId('centro-panel').getByText(`OP ${folio}`)).toBeVisible();
  });
});
