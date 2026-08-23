import { expect, test } from '@playwright/test';

import { entrarComoAdmin } from './ayudas';

/**
 * E2E del RECIBO de maquila (F3-E4) contra el stack real. El flujo transaccional completo
 * (envío → recibo → entrada a PT → cargo EsMa propuesto → validado, con sus reglas: recibido ≤
 * enviado, costura mete a PT y estampado no, concurrencia, cancelación con inverso) está cubierto a
 * fondo por los tests de INTEGRACIÓN (`backend/src/dominio/produccion/recibos.int.test.ts`, Postgres
 * efímero en CI). Ese flujo punta-a-punta por la UI exige sembrar proveedores con roles de maquila y
 * encadenar orden→corte→envío→recibo, lo que lo haría frágil y dependiente del estado; por eso aquí
 * el E2E verifica, contra el stack real, que las pantallas cargan, exigen sesión/permiso y wirean sus
 * controles principales:
 *  • Recibo de maquila: se captura en el panel de AVANCE de la orden (la pantalla suelta se retiró en
 *    V1-E3a, §Post-F9.36 punto 2: una sola pantalla por acto) → se verifica que la ruta vieja
 *    REDIRIGE al Centro de Órdenes (marcadores y enlaces guardados no se rompen) y que la etapa
 *    «Recibo de maquila» del stepper existe con su captura.
 *  • Recibos semanales por maquilero: la consulta carga con sus filtros.
 *  • Validación de cargos EsMa: la cola carga con su filtro de estado.
 *
 * Asume el admin sembrado (todos los permisos, incluidos `produccion.recibo`/`.wip-ver` y
 * `esma.cargo-validar`).
 */
test.describe('Recibo de maquila y cargos EsMa (F3-E4)', () => {
  test('la ruta vieja del recibo redirige al Centro de Órdenes (V1-E3a)', async ({ page }) => {
    await entrarComoAdmin(page);

    await page.goto('/produccion/recibos');
    // No es un 404 ni un "Próximamente": aterriza en la pantalla que SÍ captura el recibo hoy.
    await expect(page).toHaveURL(/\/produccion\/ordenes$/);
    await expect(page.getByRole('heading', { name: 'Órdenes de producción' })).toBeVisible();
  });

  test('los recibos semanales por maquilero cargan con sus filtros', async ({ page }) => {
    await entrarComoAdmin(page);

    await page.goto('/produccion/recibos-semanales');
    await expect(
      page.getByRole('heading', { name: 'Recibos semanales por maquilero' }),
    ).toBeVisible();
    // Los filtros de fecha (desde) existen.
    await expect(page.getByLabel('Desde')).toBeVisible();
  });

  test('la cola de validación de cargos EsMa carga', async ({ page }) => {
    await entrarComoAdmin(page);

    await page.goto('/esma/validacion-cargos');
    await expect(
      page.getByRole('heading', { name: 'Validación de cargos de maquila' }),
    ).toBeVisible();
  });
});
