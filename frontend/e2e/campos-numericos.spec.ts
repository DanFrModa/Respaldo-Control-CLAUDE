import { expect, test } from '@playwright/test';

import { crearColorYTalla, entrarComoAdmin } from './ayudas';

/**
 * E2E de los CAMPOS NUMÉRICOS sin incremento automático (petición de Daniel, 28-jul-2026:
 * *"nunca se usarán esas flechitas"*) contra un navegador REAL — que es lo único que prueba de
 * verdad este cambio: jsdom no implementa ni el paso por rueda ni el de las flechas, así que las
 * pruebas unitarias solo pueden afirmar "se soltó el foco" / "se canceló el default", nunca "el
 * valor no se movió".
 *
 * Se ejerce sobre la MATRIZ color×talla (`MatrizColorTalla`), que es el campo numérico más
 * peligroso del sistema: es donde se capturan las piezas de corte, maquilas, recibos y entregas, y
 * un dígito cambiado en silencio se convierte en inventario y en dinero. Se usa la pantalla de
 * Movimientos de PT porque llega a la matriz en pocos pasos; el guarda es GLOBAL (un listener en
 * `main.tsx`), así que vale igual para todas las demás.
 */
test.describe('Campos numéricos sin incremento automático', () => {
  test('ni la rueda ni las flechas ↑/↓ cambian una cantidad capturada', async ({ page }) => {
    const sufijo = Date.now().toString().slice(-6);
    const codigoModelo = `NUM-${sufijo}`;

    await entrarComoAdmin(page);
    // La matriz necesita ≥1 color y ≥1 talla en catálogo (no vienen sembrados).
    await crearColorYTalla(page);

    await page.goto('/modelos');
    await expect(page.getByRole('heading', { name: 'Modelos' })).toBeVisible();
    await page.getByTestId('nuevo-modelo').click();
    await page.getByRole('dialog').getByLabel('Código').fill(codigoModelo);
    await page.getByTestId('guardar-modelo').click();
    await expect(page.getByText(`Modelo "${codigoModelo}" creado.`)).toBeVisible();

    await page.goto('/inventarios/movimientos');
    await expect(page.getByRole('heading', { name: 'Movimientos de inventario' })).toBeVisible();
    await page.getByTestId('selector-modelo-busqueda').fill(codigoModelo);
    await page.getByTestId('selector-modelo-opcion').first().click();
    await page.getByTestId('mov-matriz-agregar-color').selectOption({ index: 1 });
    const agregarTalla = page.getByTestId('mov-matriz-agregar-talla');
    if (await agregarTalla.isEnabled()) {
      await agregarTalla.selectOption({ index: 1 });
    }

    const celda = page.getByTestId('mov-matriz-celda').first();
    await celda.fill('30');
    await expect(celda).toHaveValue('30');

    // ── La RUEDA con el campo enfocado (el caso "creía que estaba haciendo scroll") ──
    await celda.hover();
    await page.mouse.wheel(0, 120);
    await expect(celda).toHaveValue('30');
    // La primera rueda ya soltó el foco: hay que volver a enfocar para que la segunda ejerza el
    // guarda de verdad (si no, sería una aserción gratuita — apunte del reviewer).
    await celda.focus();
    await page.mouse.wheel(0, -120);
    await expect(celda).toHaveValue('30');

    // ── Las FLECHAS del teclado, con UNA sola celda: no hay renglón al que bajar, que es
    //    justamente cuando la matriz no cancelaba el default y el valor se movía solo ──
    await celda.press('ArrowDown');
    await expect(celda).toHaveValue('30');
    await celda.press('ArrowUp');
    await expect(celda).toHaveValue('30');

    // Y el campo sigue siendo numérico y capturable a mano (no se rompió lo que sí se usa).
    await celda.fill('45');
    await expect(celda).toHaveValue('45');
  });
});
