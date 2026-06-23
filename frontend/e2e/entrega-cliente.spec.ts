import { expect, test } from '@playwright/test';

import { crearColorYTalla, entrarComoAdmin } from './ayudas';

/**
 * E2E del ciclo de ENTREGA a cliente + TABLERO WIP (F3-E5) contra el stack real. El flujo
 * transaccional (salida de PT no-negativa bajo lock, seguimiento del pedido derivado, cancelación con
 * inverso) está cubierto a fondo por la INTEGRACIÓN (`backend/src/dominio/produccion/
 * entregas-cliente.int.test.ts`, Postgres efímero en CI). Aquí se valida, punta a punta por la UI, el
 * camino real del operador:
 *  1. Se prepara stock de PT por la vía operable de E3 (movimiento manual de entrada) sobre un modelo
 *     creado al vuelo, ligado a una orden creada al vuelo (cliente → modelo → pedido → orden + matriz),
 *     de modo que la entrega tenga existencia y la orden contra la que capturar.
 *  2. Entrega a cliente (`/produccion/entregas`): se captura una entrega PARCIAL color×talla y se guarda.
 *  3. Existencias (`/inventarios/existencias`): la cantidad del modelo BAJÓ por la entrega.
 *  4. Tablero WIP (`/produccion/wip`): el drill-down de esa orden refleja lo "entregado".
 *
 * Todo se crea con nombres únicos por corrida (sufijo de tiempo) para no depender del estado previo.
 * Se apoya en colores/tallas de catálogos (sembrados en F1) y los almacenes PT sembrados.
 * Asume el admin sembrado (todos los permisos: `produccion.entrega`/`.wip-ver`, `inventario-pt.*`,
 * `ordenes.*`, `pedidos.*`, `modelos.*`).
 */
test.describe('Entrega a cliente y tablero WIP (F3-E5)', () => {
  test('orden con stock → entrega parcial → existencia baja → WIP refleja lo entregado', async ({
    page,
  }) => {
    const sufijo = Date.now().toString().slice(-6);
    const cliente = `Cliente Entrega ${sufijo}`;
    const codigoModelo = `ENT-${sufijo}`;
    const ALMACEN = 'Primeras';
    // Se siembran 20 pzas y se entregan 5 → quedan 15 (matemática limpia para aserciones exactas).
    const STOCK = 20;
    const ENTREGA = 5;
    const RESTANTE = STOCK - ENTREGA;

    await entrarComoAdmin(page);
    // La matriz color×talla necesita ≥1 color y ≥1 talla en catálogo (no sembrados): se crean al vuelo.
    await crearColorYTalla(page);

    // ── Prepara un cliente ──────────────────────────────────────────────────────
    await page.goto('/catalogos/clientes');
    await expect(page.getByRole('heading', { name: 'Clientes' })).toBeVisible();
    await page.getByTestId('nuevo-cliente').click();
    await page.getByRole('dialog').getByLabel('Nombre').fill(cliente);
    await page.getByTestId('guardar-cliente').click();
    await expect(page.getByText(`Cliente "${cliente}" creado.`)).toBeVisible();

    // ── Prepara un modelo (sin curva: las tallas se eligen explícitamente) ──────
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

    // ── Crea la orden desde el renglón y captura su matriz (1 color × 1 talla) ──
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
    const matriz = detalle.getByTestId('matriz-orden');
    // Primer color del catálogo (índice 1, tras el placeholder).
    await matriz.getByTestId('matriz-orden-agregar-color').selectOption({ index: 1 });
    const agregarTalla = matriz.getByTestId('matriz-orden-agregar-talla');
    if (await agregarTalla.isEnabled()) {
      // Primera talla del catálogo (la misma que se elegirá por índice en el movimiento de stock).
      await agregarTalla.selectOption({ index: 1 });
    }
    await matriz.getByTestId('matriz-orden-celda').first().fill(String(STOCK));
    await detalle.getByTestId('guardar-matriz').click();
    await expect(page.getByText('Matriz guardada.')).toBeVisible();
    await expect(detalle.getByTestId('estado-orden').first()).toHaveText('Completa');

    // ── Siembra STOCK de PT por la vía operable (E3): entrada manual al almacén ──
    // El color/talla se eligen por el MISMO índice (1) que en la matriz de la orden, así el artículo
    // sembrado coincide con el de la orden (y con el que la entrega podrá sacar).
    await page.goto('/inventarios/movimientos');
    await expect(page.getByRole('heading', { name: 'Movimientos de inventario' })).toBeVisible();
    await page.getByTestId('selector-modelo-busqueda').fill(codigoModelo);
    await page.getByTestId('selector-modelo-opcion').first().click();
    // Tipo de entrada (Inventario Inicial, primera opción tras el placeholder) y almacén Primeras.
    await page.getByTestId('mov-tipo').selectOption({ index: 1 });
    await page.getByTestId('mov-almacen').selectOption({ label: ALMACEN });
    await page.getByTestId('mov-matriz-agregar-color').selectOption({ index: 1 });
    const agregarTallaMov = page.getByTestId('mov-matriz-agregar-talla');
    if (await agregarTallaMov.isEnabled()) {
      await agregarTallaMov.selectOption({ index: 1 });
    }
    await page.getByTestId('mov-matriz-celda').first().fill(String(STOCK));
    await page.getByTestId('mov-guardar').click();
    await expect(page.getByText(/Movimiento #\d+ guardado/)).toBeVisible();

    // ── ENTREGA a cliente: parcial (ENTREGA pzas) desde el almacén Primeras ─────
    await page.goto('/produccion/entregas');
    await expect(page.getByRole('heading', { name: 'Entrega a cliente' })).toBeVisible();
    // Elige la orden buscándola por el código de modelo (único por corrida).
    const selectorOrden = page.getByTestId('entrega-selector-orden');
    await selectorOrden.getByTestId('entrega-selector-orden-busqueda').fill(codigoModelo);
    await selectorOrden.getByTestId('entrega-selector-orden-opcion').first().click();

    // El almacén de salida debe elegirse para que la matriz se habilite (acotada a la existencia).
    await page.getByTestId('entrega-almacen').selectOption({ label: ALMACEN });
    // La matriz llega con el color/talla de la orden ya presentes (celdas vacías): se llena la 1ª.
    await page.getByTestId('entrega-matriz-celda').first().fill(String(ENTREGA));
    await expect(page.getByText(`Total a entregar: ${ENTREGA}`)).toBeVisible();
    await page.getByTestId('entrega-guardar').click();
    await expect(page.getByText(/Entrega #\d+ a .* guardada/)).toBeVisible();
    // El comprobante PDF queda disponible (botón presente tras guardar).
    await expect(page.getByTestId('entrega-pdf')).toBeVisible();
    // La entrega aparece en el historial de la orden.
    await expect(
      page
        .getByTestId('historial-entrega')
        .filter({ hasText: `${ENTREGA} pzas` })
        .first(),
    ).toBeVisible();

    // ── EXISTENCIAS (E3): la existencia del modelo BAJÓ a RESTANTE ──────────────
    await page.goto('/inventarios/existencias');
    await expect(
      page.getByRole('heading', { name: 'Existencias de producto terminado' }),
    ).toBeVisible();
    await page.getByTestId('selector-modelo-busqueda').fill(codigoModelo);
    await page.getByTestId('selector-modelo-opcion').first().click();
    // Total del modelo = STOCK − ENTREGA (la entrega descontó del inventario).
    await expect(page.getByText('Total:')).toBeVisible();
    await expect(page.getByText(`${RESTANTE} pzas en`)).toBeVisible();

    // ── TABLERO WIP: el drill-down de la orden refleja lo "entregado" ───────────
    await page.goto('/produccion/wip');
    await expect(page.getByRole('heading', { name: 'Tablero WIP' })).toBeVisible();
    await page.getByTestId('wip-busqueda').fill(codigoModelo);
    // La fila de la orden aparece; se abre su detalle (drill-down).
    const filaWip = page.getByTestId('wip-fila').filter({ hasText: codigoModelo }).first();
    await expect(filaWip).toBeVisible();
    await filaWip.getByTestId('wip-detalle').click();
    const drill = page.getByTestId('wip-drill');
    await expect(drill).toBeVisible();
    // El resumen del avance muestra "Entregado" con lo entregado y "Por entregar" con el resto del
    // pedido (50 pedidas − ENTREGA entregadas).
    await expect(drill.getByText('Entregado', { exact: true })).toBeVisible();
    await expect(drill.getByText('Entregado a cliente')).toBeVisible();
  });
});
