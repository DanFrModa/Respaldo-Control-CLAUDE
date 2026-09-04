import { expect, test } from '@playwright/test';

import { entrarComoAdmin } from './ayudas';

/**
 * E2E de humo de LA CORRIDA SEMANAL DE PAGOS (fila 0.113) y del catálogo de conceptos que no son
 * proveedores (0.125), contra el stack real.
 *
 * Lo profundo —la guarda fiscal, el congelado del destino, en qué libro nace cada pago— lo cubren
 * los tests de INTEGRACIÓN del backend (`dominio/pagos/corrida.int.test.ts`, con Postgres). Aquí se
 * verifica lo que sólo el stack real puede decir: que las pantallas **existen, cargan desde su ruta
 * y están enganchadas al menú**, con sus controles principales wireados.
 *
 * ⚠️ Asume el admin sembrado (todos los permisos, incl. `pagos.corrida-armar`/`.corrida-ver` y
 * `conceptos-pago.*`), que es como corren los otros 43 specs. **Requiere `SEED_ON_START=true`** en
 * el despliegue: los cuatro permisos son nuevos y sin sembrarlos las rutas dan 403 y el menú no
 * pinta las entradas.
 */
test.describe('Corrida semanal de pagos (0.113)', () => {
  test('la pantalla carga y ofrece abrir la corrida de la semana', async ({ page }) => {
    await entrarComoAdmin(page);
    await page.goto('/pagos/corrida');

    await expect(page.getByRole('heading', { name: 'Corrida semanal de pagos' })).toBeVisible();
    // El armado de la semana: fecha, segmento (con/sin factura) y el botón de abrir.
    await expect(page.getByTestId('corrida-semana')).toBeVisible();
    await expect(page.getByTestId('corrida-segmento')).toBeVisible();
    await expect(page.getByTestId('corrida-abrir')).toBeVisible();
    // El selector de corridas existe aunque todavía no haya ninguna.
    await expect(page.getByTestId('corrida-selector')).toBeVisible();
  });

  test('⭐ al abrir una corrida aparecen las SECCIONES por rubro con la columna «a pagar»', async ({
    page,
  }) => {
    await entrarComoAdmin(page);
    await page.goto('/pagos/corrida');

    // Se abre la corrida SIN factura de la semana en curso (la fecha viene precargada al lunes).
    await page.getByTestId('corrida-segmento').selectOption('sin');
    await page.getByTestId('corrida-abrir').click();

    // La corrida nace en BORRADOR y con sus totales en cero (nada capturado todavía).
    await expect(page.getByTestId('corrida-totales')).toBeVisible();
    await expect(page.getByTestId('corrida-cerrar')).toBeVisible();

    // ⭐ Lo que Daniel pidió: UNA pantalla con el campo abierto al lado de cada beneficiario. Si el
    // ambiente trae maquileros con saldo, sale su sección; si no, al menos la de conceptos del
    // catálogo (los predeterminados se cargan en cero). Lo que NO puede faltar es la columna.
    const secciones = page.locator('[data-testid^="corrida-seccion-"]');
    await expect(secciones.first()).toBeVisible();
    await expect(
      page.getByRole('columnheader', { name: 'A pagar esta semana' }).first(),
    ).toBeVisible();
    // Y la columna del CONCEPTO, que es lo que finanzas lee para ejecutar el pago.
    await expect(page.getByRole('columnheader', { name: 'Concepto' }).first()).toBeVisible();
  });

  test('el catálogo de conceptos de pago carga con su alta', async ({ page }) => {
    await entrarComoAdmin(page);
    await page.goto('/catalogos/conceptos-pago');

    await expect(page.getByRole('heading', { name: 'Conceptos de pago' })).toBeVisible();
    // El alta (rubro + forma de pago + la marca de «cargarlo siempre en la corrida»).
    await expect(page.getByTestId('concepto-nombre')).toBeVisible();
    await expect(page.getByTestId('concepto-rubro')).toBeVisible();
    await expect(page.getByTestId('concepto-predeterminado')).toBeVisible();
    await expect(page.getByTestId('concepto-guardar')).toBeVisible();
  });

  test('la corrida está en el riel, dentro de Finanzas', async ({ page }) => {
    await entrarComoAdmin(page);
    const navegacion = page.getByRole('navigation', { name: 'Módulos' }).first();
    await expect(
      navegacion.getByRole('link', { name: 'Corrida de pagos', exact: true }),
    ).toBeVisible();
  });
});
