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
 * ⭐ V1-E3q (§Post-F9.85/.86): la pantalla ya arma un CONJUNTO de OP (chips que se pueden quitar) y
 * el botón manda a una REVISIÓN PREVIA en vez de generar de un clic. Ese flujo completo vive en los
 * tests de integración y de pantalla; aquí sólo se comprueba, contra el stack real, que los
 * controles nuevos existen y wirean.
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
      // ⭐ V1-E3k (§Post-F9.80): liberar YA NO acepta comodines — hay que NOMBRAR cada renglón. Así
      // que se lee la receta y se enumeran sus renglones VIVOS, que es la misma vuelta que da la
      // pantalla. Si la receta viene vacía (2 de cada 3 órdenes migradas) no hay nada que firmar y
      // `liberada` queda en false, que es justo la rama de abajo.
      const receta = await page.request.get(`/api/ordenes/${String(idOrden)}/receta`);
      const contenido = receta.ok()
        ? ((await receta.json()) as {
            telas: { id: number; excluido: boolean }[];
            avios: { id: number; excluido: boolean }[];
            artes: { id: number; excluido: boolean }[];
          })
        : { telas: [], avios: [], artes: [] };
      const renglones = [
        ...contenido.telas.filter((t) => !t.excluido).map((t) => ({ tipo: 'tela', id: t.id })),
        ...contenido.avios.filter((a) => !a.excluido).map((a) => ({ tipo: 'avio', id: a.id })),
        ...contenido.artes.filter((a) => !a.excluido).map((a) => ({ tipo: 'arte', id: a.id })),
      ];
      const liberada =
        renglones.length > 0 &&
        (
          await page.request.post(`/api/ordenes/${String(idOrden)}/receta/liberar`, {
            data: { renglones },
          })
        ).ok();

      await primera.click();
      // ⭐ V1-E3q: elegir una OP la mete al conjunto de la compra, con su chip para quitarla.
      await expect(page.getByTestId('exp-ops-elegidas')).toBeVisible();
      if (liberada) {
        // El botón ya no dice "Generar OC" a secas: manda a la revisión previa (§Post-F9.85).
        await expect(page.getByTestId('exp-generar-oc')).toBeVisible();
        await expect(page.getByTestId('exp-generar-oc')).toHaveText(/Revisar y generar OC/);
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
