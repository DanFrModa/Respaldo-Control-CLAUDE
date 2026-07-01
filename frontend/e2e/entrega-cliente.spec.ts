import { expect, test } from '@playwright/test';

import { entrarComoAdmin } from './ayudas';

/**
 * E2E de la ENTREGA a cliente (F3-E5) contra el stack real. El flujo transaccional completo
 * (salida de PT no-negativa bajo lock, seguimiento del pedido derivado, cancelación con inverso) está
 * cubierto a fondo por los tests de INTEGRACIÓN (`backend/src/dominio/produccion/
 * entregas-cliente.int.test.ts`, Postgres efímero en CI). Con la dimensión ORDEN en el inventario de PT
 * (`movimiento_det_pt.id_orden`), la entrega solo puede sacar stock LIGADO A LA ORDEN —el que produjo
 * su recibo de maquila—; sembrar ese estado punta-a-punta por la UI exige encadenar
 * orden→corte→envío→recibo, lo que haría el E2E frágil y dependiente del estado (misma decisión que los
 * E2E de recibos de maquila y auditorías de calidad de este branch). El caso "una orden sin stock propio
 * no puede entregar" YA está cubierto por la integración (caso (g)). Por eso aquí se verifica, contra el
 * stack real, que la pantalla carga, exige sesión y wirea su control principal:
 *  • Entrega a cliente: la pantalla carga y el selector de orden (con su búsqueda) está presente.
 *
 * Asume el admin sembrado (todos los permisos, incluidos `produccion.entrega`/`.wip-ver`).
 */
test.describe('Entrega a cliente y tablero WIP (F3-E5)', () => {
  test('la pantalla de entrega carga y wirea su selector de orden', async ({ page }) => {
    await entrarComoAdmin(page);

    await page.goto('/produccion/entregas');
    await expect(page.getByRole('heading', { name: 'Entrega a cliente' })).toBeVisible();
    // El selector de orden está presente (la captura arranca eligiendo una orden) y su búsqueda wirea.
    const selectorOrden = page.getByTestId('entrega-selector-orden');
    await expect(selectorOrden).toBeVisible();
    await expect(selectorOrden.getByTestId('entrega-selector-orden-busqueda')).toBeVisible();
  });
});
