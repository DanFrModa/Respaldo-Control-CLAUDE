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
/**
 * Un LUNES propio de este INTENTO, para que dos ejecuciones no se peleen por el mismo borrador (el
 * dominio sólo admite uno por semana y segmento, y la base del e2e se comparte entre specs y entre
 * reintentos). Arranca en el lunes 4-ene-2027 y se aleja tantas semanas como diga la cuenta: cae
 * siempre en lunes porque se avanza de siete en siete.
 *
 * 🔴 El reloj SOLO no basta, y por poco se cuela: con `Date.now() / 60_000` el número cambia una vez
 * por minuto, pero un reintento de Playwright ocurre **segundos** después del fallo, así que el
 * segundo intento caía en la MISMA semana y chocaba con el borrador que dejó el primero (409) —
 * exactamente lo que esta función venía a evitar, y encima disfrazado de fallo del código.
 *
 * Por eso el offset lleva `test.info().retry`: el minuto separa una corrida del CI de la siguiente,
 * y el número de intento separa los reintentos DENTRO de una corrida. Determinista, sin depender de
 * cuánto tarde el reintento.
 */
function semanaPropia(): string {
  const LUNES_BASE = Date.UTC(2027, 0, 4);
  const semanas = (Math.floor(Date.now() / 60_000) + test.info().retry) % 500;
  return new Date(LUNES_BASE + semanas * 7 * 86_400_000).toISOString().slice(0, 10);
}

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

    // ⭐ SIEMBRA PRIMERO, y no es opcional. La base del CI está recién sembrada: no hay movimientos
    // de EsMa ni de CxP, así que NADIE tiene saldo y la cartera viene vacía; y sin conceptos
    // `predeterminado` tampoco hay filas de catálogo. Con cero filas el servidor devuelve cero
    // secciones (`corrida.ts` filtra las vacías) y esta prueba esperaba una sección que en ese
    // ambiente no podía existir — así se cayó en la primera corrida del CI.
    //
    // Un concepto predeterminado es la semilla más barata que hace aparecer una sección: se carga
    // solo, en cero, en cada corrida nueva.
    const concepto = `Caja chica ${Date.now().toString().slice(-6)}`;
    await page.goto('/catalogos/conceptos-pago');
    await expect(page.getByRole('heading', { name: 'Conceptos de pago' })).toBeVisible();
    await page.getByTestId('concepto-nombre').fill(concepto);
    await page.getByTestId('concepto-rubro').selectOption('caja_chica');
    await page.getByTestId('concepto-predeterminado').check();
    await page.getByTestId('concepto-guardar').click();
    // Se busca por TEXTO dentro de la tabla, no con `getByRole('cell', { name })`: el nombre
    // accesible de esa celda incluye el `aria-label` de la estrella del predeterminado, así que un
    // match exacto por nombre no daría.
    await expect(page.getByTestId('conceptos-tabla')).toContainText(concepto);

    await page.goto('/pagos/corrida');
    // ⭐ Una SEMANA PROPIA de esta corrida del CI, no la actual. El dominio impide dos BORRADORES
    // del mismo segmento y semana, y la base del e2e se comparte entre specs y entre re-intentos:
    // usar «esta semana» haría que el segundo intento chocara con el borrador del primero y la
    // prueba se volviera intermitente. Con una semana derivada del reloj, cada corrida del CI
    // trabaja en la suya.
    await page.getByTestId('corrida-semana').fill(semanaPropia());
    await page.getByTestId('corrida-segmento').selectOption('sin');
    await page.getByTestId('corrida-abrir').click();

    // La corrida nace en BORRADOR y con sus totales en cero (nada capturado todavía).
    await expect(page.getByTestId('corrida-totales')).toBeVisible();
    await expect(page.getByTestId('corrida-cerrar')).toBeVisible();

    // ⭐ Lo que Daniel pidió: UNA pantalla con el campo abierto al lado de cada beneficiario. El
    // concepto sembrado garantiza su sección; si el ambiente además trae maquileros con saldo,
    // saldrán las suyas. Lo que NO puede faltar es la columna de captura.
    await expect(page.getByTestId('corrida-seccion-caja_chica')).toBeVisible();
    await expect(page.getByTestId('corrida-sin-filas')).toHaveCount(0);
    await expect(
      page.getByRole('columnheader', { name: 'A pagar esta semana' }).first(),
    ).toBeVisible();
    // Y la columna del CONCEPTO, que es lo que finanzas lee para ejecutar el pago.
    await expect(page.getByRole('columnheader', { name: 'Concepto' }).first()).toBeVisible();
    // El predeterminado se cargó SOLO y EN CERO, que es la razón de ser de la marca.
    await expect(page.getByLabel(`A pagar a ${concepto}`)).toHaveValue('0');
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
