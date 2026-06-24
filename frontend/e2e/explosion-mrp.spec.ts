import { expect, test } from '@playwright/test';

import { entrarComoAdmin } from './ayudas';

/**
 * E2E de la EXPLOSIÓN MRP (F4-E4, R3/R7) contra el stack real. El flujo transaccional completo
 * (explosión → generar OC → autorizar → recibir → tablero), con sus reglas (requerido = BOM ×
 * piezas, neteo de genéricos contra el kardex, una OC por proveedor, cruce requerido/en-oc/recibido,
 * línea libre → no-identificado), está cubierto a fondo por los tests de INTEGRACIÓN
 * (`backend/src/dominio/compras/mrp.int.test.ts`, Postgres efímero en CI). Encadenar ese flujo por la
 * UI exige sembrar modelo+BOM+orden+proveedores con precios, lo que lo haría frágil y dependiente del
 * estado; por eso aquí el E2E verifica, contra el stack real, que las DOS pantallas nuevas cargan,
 * exigen sesión y wirean sus controles principales (criterio de salida: el tablero "qué tengo / qué
 * falta" se lee bien).
 *
 * Asume el admin sembrado (todos los permisos, incluido `compras.ver`/`.administrar`).
 */
test.describe('Explosión MRP y estatus de materiales (F4-E4)', () => {
  test('la pantalla de explosión carga y wirea su selector de orden', async ({ page }) => {
    await entrarComoAdmin(page);

    await page.goto('/compras/explosion');
    await expect(page.getByRole('heading', { name: 'Explosión de materiales' })).toBeVisible();
    // La captura arranca eligiendo una orden de producción.
    await expect(page.getByTestId('exp-buscar-orden')).toBeVisible();
  });

  test('la pantalla "qué tengo / qué falta" carga y wirea su selector de orden', async ({
    page,
  }) => {
    await entrarComoAdmin(page);

    await page.goto('/compras/estatus-materiales');
    await expect(page.getByRole('heading', { name: 'Qué tengo / qué falta' })).toBeVisible();
    await expect(page.getByTestId('est-buscar-orden')).toBeVisible();
  });

  test('al elegir una orden, la explosión muestra el botón de generar OC', async ({ page }) => {
    await entrarComoAdmin(page);
    await page.goto('/compras/explosion');

    // Si hay alguna orden sembrada/migrada, al elegirla aparecen los controles de la explosión.
    const opciones = page.getByTestId('exp-orden-opcion');
    if ((await opciones.count()) > 0) {
      await opciones.first().click();
      await expect(page.getByTestId('exp-generar-oc')).toBeVisible();
      await expect(page.getByTestId('exp-imprimir')).toBeVisible();
    }
  });
});
