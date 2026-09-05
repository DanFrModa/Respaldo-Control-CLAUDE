import { expect, test } from '@playwright/test';

import { crearColorYTalla, entrarComoAdmin } from './ayudas';

/**
 * E2E del INVENTARIO de PRODUCTO TERMINADO (F3-E3) contra el stack real. Cubre el flujo de la ficha:
 * ENTRADA manual → TRASPASO entre almacenes → KARDEX. Crea un modelo al vuelo (código único por
 * corrida) para no depender del estado previo; se apoya en los almacenes PT sembrados
 * (Primeras/Segundas) y en colores/tallas de los catálogos (sembrados en F1).
 *
 * Asume el admin sembrado (todos los permisos, incluidos `inventario-pt.ver`/`.mover`).
 */
test.describe('Inventario PT operable (F3-E3)', () => {
  test('entrada manual → traspaso entre almacenes → kardex con saldo corrido', async ({ page }) => {
    const sufijo = Date.now().toString().slice(-6);
    const codigoModelo = `IPT-${sufijo}`;

    await entrarComoAdmin(page);
    // La matriz color×talla necesita ≥1 color y ≥1 talla en catálogo (no sembrados): se crean al vuelo.
    await crearColorYTalla(page);

    // ── Prepara un modelo ───────────────────────────────────────────────────────
    await page.goto('/modelos');
    await expect(page.getByRole('heading', { name: 'Modelos' })).toBeVisible();
    await page.getByTestId('nuevo-modelo').click();
    await page.getByRole('dialog').getByLabel('Código').fill(codigoModelo);
    // ⭐ V1-E8j (§Post-F9.134): tipo de prenda y género son OBLIGATORIOS en el alta — son los
    // dos dígitos con los que el sistema arma el nº de producción del modelo.
    await page
      .getByRole('dialog')
      .getByLabel('Tipo de producto')
      .selectOption({ label: 'Pantalón' });
    await page.getByRole('dialog').getByLabel('Género').selectOption({ label: 'Caballero' });
    await page.getByTestId('guardar-modelo').click();
    await expect(page.getByText(`Modelo "${codigoModelo}" creado.`)).toBeVisible();

    // ── ENTRADA manual: inventario inicial al almacén Primeras ──────────────────
    await page.goto('/inventarios/movimientos');
    await expect(page.getByRole('heading', { name: 'Movimientos de inventario' })).toBeVisible();
    await page.getByTestId('selector-modelo-busqueda').fill(codigoModelo);
    await page.getByTestId('selector-modelo-opcion').first().click();

    // Tipo de entrada (Inventario Inicial), almacén Primeras, captura una celda. La opción incluye
    // el signo de dirección ("Inventario Inicial (+)"), así que se elige por su índice (la primera
    // de la lista, tras el placeholder).
    await page.getByTestId('mov-tipo').selectOption({ index: 1 });
    await page.getByTestId('mov-almacen').selectOption({ label: 'Primeras' });
    await page.getByTestId('mov-matriz-agregar-color').selectOption({ index: 1 });
    const agregarTalla = page.getByTestId('mov-matriz-agregar-talla');
    if (await agregarTalla.isEnabled()) {
      await agregarTalla.selectOption({ index: 1 });
    }
    await page.getByTestId('mov-matriz-celda').first().fill('30');
    // Fila 0.100 — el MOTIVO es obligatorio: sin él el botón de guardar sigue deshabilitado.
    await page.getByTestId('mov-motivo').fill('Inventario inicial de la prueba');
    await page.getByTestId('mov-guardar').click();
    await expect(page.getByText(/Movimiento #\d+ guardado/)).toBeVisible();

    // ── TRASPASO: mueve 10 de Primeras a Segundas ───────────────────────────────
    await page.goto('/inventarios/traspasos');
    await expect(page.getByRole('heading', { name: 'Traspaso entre almacenes' })).toBeVisible();
    await page.getByTestId('selector-modelo-busqueda').fill(codigoModelo);
    await page.getByTestId('selector-modelo-opcion').first().click();

    await page.getByTestId('traspaso-origen').selectOption({ label: 'Primeras' });
    await page.getByTestId('traspaso-destino').selectOption({ label: 'Segundas' });
    await page.getByTestId('traspaso-matriz-agregar-color').selectOption({ index: 1 });
    const agregarTallaT = page.getByTestId('traspaso-matriz-agregar-talla');
    if (await agregarTallaT.isEnabled()) {
      await agregarTallaT.selectOption({ index: 1 });
    }
    await page.getByTestId('traspaso-matriz-celda').first().fill('10');
    // Fila 0.100 — el MOTIVO es obligatorio también en el traspaso.
    await page.getByTestId('traspaso-motivo').fill('Reacomodo de la prueba');
    await page.getByTestId('traspaso-guardar').click();
    await expect(page.getByText(/Traspaso guardado/)).toBeVisible();

    // Fila 0.100 — al guardar, la pantalla ofrece la HOJA del traspaso (PDF server-side) con el
    // folio que el traspaso YA tiene. Aquí se comprueba que el papel EXISTE y se puede pedir; que
    // diga lo correcto lo miden los tests del impreso (unit + integración).
    await expect(page.getByTestId('traspaso-pt-guardado')).toBeVisible();
    await expect(page.getByTestId('traspaso-pt-imprimir')).toBeVisible();

    // ── EXISTENCIAS: verifica que el modelo aparezca con existencia ─────────────
    await page.goto('/inventarios/existencias');
    await expect(
      page.getByRole('heading', { name: 'Inventario · Producto terminado' }),
    ).toBeVisible();
    await page.getByTestId('selector-modelo-busqueda').fill(codigoModelo);
    await page.getByTestId('selector-modelo-opcion').first().click();
    // El modelo aparece (en la tabla y/o tarjetas); el total se muestra.
    await expect(page.getByText(/Total:/)).toBeVisible();
    await expect(page.getByText(codigoModelo).first()).toBeVisible();

    // ── KARDEX por modelo: los dos movimientos del traspaso + la entrada salen ──
    await page.goto('/inventarios/kardex');
    await expect(page.getByRole('heading', { name: 'Kardex de producto terminado' })).toBeVisible();
    await page.getByTestId('selector-modelo-busqueda').fill(codigoModelo);
    await page.getByTestId('selector-modelo-opcion').first().click();
    // La tabla del kardex aparece con renglones (entrada + las dos patas del traspaso).
    await expect(page.getByTestId('kardex-tabla')).toBeVisible();
    await expect(page.getByText(/Inventario Inicial/).first()).toBeVisible();
  });
});
