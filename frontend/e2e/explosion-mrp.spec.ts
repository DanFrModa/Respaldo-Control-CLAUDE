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

  test('al elegir una orden, la explosión muestra sus controles o la PUERTA de la receta', async ({
    page,
  }) => {
    await entrarComoAdmin(page);
    await page.goto('/compras/explosion');

    // Si hay alguna orden sembrada/migrada, al elegirla aparecen los controles de la explosión.
    const opciones = page.getByTestId('exp-orden-opcion');
    if ((await opciones.count()) > 0) {
      const primera = opciones.first();
      const idOrden = await primera.getAttribute('data-orden');

      // ⭐ V1-E3d (§Post-F9.43(c)): explotar el MRP exige la receta LIBERADA por Desarrollo. Para no
      // perder la cobertura del botón —que es lo que este spec probaba antes de la puerta— abrimos
      // la puerta NOSOTROS por API (misma sesión del navegador, patrón de `ruta-critica-motor`):
      // revisar todo + liberar. Si la orden que le tocó a esta corrida tiene receta, liberar
      // responde 200 y volvemos a EXIGIR el botón; si su receta está vacía (2 de cada 3 órdenes
      // migradas), liberar responde 409 y entonces lo que se exige es la puerta dicha con todas sus
      // letras. Lo que NUNCA se acepta es que la pantalla se quede muda.
      await page.request.post(`/api/ordenes/${String(idOrden)}/receta/revisar`);
      // V1-E3h (§Post-F9.72): liberar admite ALCANCE; aquí se firma TODO explícitamente (el cuerpo
      // es opcional, pero mandarlo deja escrito qué se está probando).
      const liberada = (
        await page.request.post(`/api/ordenes/${String(idOrden)}/receta/liberar`, {
          data: { alcance: 'todo' },
        })
      ).ok();

      await primera.click();
      if (liberada) {
        await expect(page.getByTestId('exp-generar-oc')).toBeVisible();
        // La aserción histórica de este spec: el impreso de la explosión también está ahí, y
        // HABILITADO (con la puerta cerrada el servidor da 409, por eso el botón se apaga).
        await expect(page.getByTestId('exp-imprimir')).toBeVisible();
        await expect(page.getByTestId('exp-imprimir')).toBeEnabled();
      } else {
        await expect(page.getByText(/todavía no la libera Desarrollo/)).toBeVisible();
        await expect(page.getByTestId('exp-imprimir')).toBeDisabled();
      }
    }
  });
});
