import { expect, test } from '@playwright/test';

import { entrarComoAdmin } from './ayudas';

/**
 * E2E del ARTE del modelo (V1-E3d, §Post-F9.35) contra el stack real.
 *
 * Desde V1-E3d el arte NO es un catálogo: vive DENTRO del modelo. Este spec recorre el ciclo
 * completo por donde ahora se opera —crear un modelo → agregarle arte con su precio → editarlo →
 * marcar principal → quitarlo— y después la GALERÍA, que sobrevivió pero armada desde los modelos:
 * cada celda dice de qué modelo es el arte y al tocarla lleva a ese modelo.
 */

/** Crea un modelo por la pantalla de Modelos y lo deja abierto en su cajón de detalle. */
async function crearModeloYAbrir(page: import('@playwright/test').Page, codigo: string) {
  await page.goto('/modelos');
  await expect(page.getByRole('heading', { name: 'Modelos', exact: true })).toBeVisible();
  await page.getByTestId('nuevo-modelo').click();
  await page.getByRole('dialog').getByLabel('Código').fill(codigo);
  await page.getByTestId('guardar-modelo').click();
  await expect(page.getByText(`Modelo "${codigo}" creado.`)).toBeVisible();

  await page.getByTestId('buscar-modelo').fill(codigo);
  await page.getByTestId('fila-modelo').filter({ hasText: codigo }).click();
  return page.getByTestId('detalle-modelo');
}

test.describe('Arte del modelo', () => {
  test('agregar arte con precio, editarlo, marcar principal y quitarlo', async ({ page }) => {
    const sufijo = Date.now().toString().slice(-6);
    const codigo = `ARTE-${sufijo}`;
    const primerArte = `Logo ${sufijo}`;
    const segundoArte = `Estampa ${sufijo}`;

    await entrarComoAdmin(page);
    const detalle = await crearModeloYAbrir(page, codigo);

    await detalle.getByTestId('tab-bom-artes').click();
    await expect(detalle.getByText('El modelo no tiene arte.')).toBeVisible();

    // ── Agregar el primer arte, con su precio (el que viaja a la OP) ────────────
    await detalle.getByTestId('agregar-arte').click();
    const dialogo = page.getByTestId('dialogo-arte');
    await dialogo.getByTestId('arte-descripcion').fill(primerArte);
    // V1-E3f: el tipo sale del CATÁLOGO único (§Post-F9.58) y es obligatorio — «Bordado» lo
    // siembra el seed como tipo de proceso marcado `esArte`.
    await dialogo.getByTestId('arte-tipo').selectOption({ label: 'Bordado' });
    await dialogo.getByTestId('arte-posicion').fill('frente');
    await dialogo.getByTestId('arte-precio').fill('45');
    await page.getByTestId('guardar-arte').click();
    await expect(page.getByText('Arte agregado.')).toBeVisible();

    const renglon1 = detalle.getByTestId(/^renglon-arte-\d+$/).filter({ hasText: primerArte });
    await expect(renglon1).toContainText('$45.00');
    // El primero es, por definición, el PRINCIPAL.
    await expect(renglon1).toHaveAttribute('data-principal', 'si');

    // ── Editarlo (el precio se cambia sin tocar ningún catálogo) ────────────────
    await renglon1.getByRole('button', { name: `Editar ${primerArte}` }).click();
    await page.getByTestId('dialogo-arte').getByTestId('arte-precio').fill('60');
    await page.getByTestId('guardar-arte').click();
    await expect(page.getByText('Arte actualizado.')).toBeVisible();
    await expect(
      detalle.getByTestId(/^renglon-arte-\d+$/).filter({ hasText: primerArte }),
    ).toContainText('$60.00');

    // ── Un segundo arte entra AL FINAL y puede tomar el lugar de principal ──────
    await detalle.getByTestId('agregar-arte').click();
    const dialogo2 = page.getByTestId('dialogo-arte');
    await dialogo2.getByTestId('arte-descripcion').fill(segundoArte);
    await dialogo2.getByTestId('arte-tipo').selectOption({ label: 'Estampado' });
    await dialogo2.getByTestId('arte-precio').fill('12');
    await page.getByTestId('guardar-arte').click();
    await expect(page.getByText('Arte agregado.')).toBeVisible();

    const renglon2 = detalle.getByTestId(/^renglon-arte-\d+$/).filter({ hasText: segundoArte });
    await expect(renglon2).toHaveAttribute('data-principal', 'no');
    await renglon2
      .getByRole('button', { name: `Marcar ${segundoArte} como arte principal` })
      .click();
    await expect(page.getByText('Arte principal actualizado.')).toBeVisible();
    await expect(
      detalle.getByTestId(/^renglon-arte-\d+$/).filter({ hasText: segundoArte }),
    ).toHaveAttribute('data-principal', 'si');

    // ── Quitar un arte (es un renglón de la receta, no un catálogo) ─────────────
    await detalle
      .getByTestId(/^renglon-arte-\d+$/)
      .filter({ hasText: primerArte })
      .getByRole('button', { name: `Quitar ${primerArte} del modelo` })
      .click();
    await expect(page.getByText(`Arte "${primerArte}" quitado del modelo.`)).toBeVisible();
    await expect(detalle.getByTestId(/^renglon-arte-\d+$/)).toHaveCount(1);
  });
});

/**
 * E2E de la GALERÍA de arte: la rejilla visual paginada de servidor, ahora armada DESDE los
 * modelos. Verifica que carga, que la búsqueda funciona, que cada celda dice de qué modelo es y
 * que tocarla lleva al modelo (§Post-F9.35 punto 4).
 */
test.describe('Galería de arte', () => {
  test('lista el arte de los modelos, dice de qué modelo es y al tocarlo abre el modelo', async ({
    page,
  }) => {
    const sufijo = Date.now().toString().slice(-6);
    const codigo = `GAL-${sufijo}`;
    const nombreArte = `Arte Galería ${sufijo}`;

    await entrarComoAdmin(page);

    // Un modelo con arte, para asegurar que la galería tiene al menos una celda.
    const detalle = await crearModeloYAbrir(page, codigo);
    await detalle.getByTestId('tab-bom-artes').click();
    await detalle.getByTestId('agregar-arte').click();
    const dialogoGal = page.getByTestId('dialogo-arte');
    await dialogoGal.getByTestId('arte-descripcion').fill(nombreArte);
    await dialogoGal.getByTestId('arte-tipo').selectOption({ label: 'Bordado' });
    await page.getByTestId('guardar-arte').click();
    await expect(page.getByText('Arte agregado.')).toBeVisible();

    // Navega a la galería desde el PORTAL de Catálogos.
    await page.goto('/catalogos');
    await expect(page.getByRole('heading', { name: 'Catálogos' })).toBeVisible();
    await page.getByTestId('catalogo-galeria-arte').click();
    await expect(page.getByRole('heading', { name: 'Galería de arte', exact: true })).toBeVisible();

    // Busca el arte creado; su celda aparece Y dice de qué modelo es.
    await page.getByTestId('buscar-galeria').fill(nombreArte);
    const celda = page.getByTestId('celda-galeria').filter({ hasText: nombreArte });
    await expect(celda).toBeVisible();
    await expect(celda).toContainText(codigo);

    // Al tocarla, lleva al MODELO dueño (ahí se edita el arte).
    //
    // ⚠️ NO se ancla en el <h1>Modelos</h1> del fondo: el deep-link abre el CAJÓN del modelo, que
    // es un modal (Radix `Dialog`) y llama a `hideOthers()` → todo lo que queda fuera del portal
    // recibe `aria-hidden="true"`. `getByRole()` consulta el ÁRBOL DE ACCESIBILIDAD, así que ese
    // encabezado deja de existir para el localizador mientras el cajón esté abierto (es el
    // comportamiento CORRECTO de un modal, no un defecto). Se ancla en lo que de verdad prueba el
    // requisito de Daniel: la URL de Modelos y el cajón abierto CON EL MODELO DUEÑO.
    await celda.click();
    await expect(page).toHaveURL(/\/modelos$/);
    await expect(page.getByTestId('detalle-modelo')).toBeVisible();
    // El código del modelo dueño va en el título del cajón (los e2e lo buscan ahí).
    await expect(page.getByRole('heading', { name: codigo })).toBeVisible();
  });
});
