import { expect, test, type Page } from '@playwright/test';

import { abrirDesplegableMenu, cerrarCajon, entrarComoAdmin } from './ayudas';

/**
 * E2E del Módulo 2 — Modelos (F1-E4) contra el stack real, re-vestido R9 a TABLA-FIRST + CAJÓN.
 * Recorre el ciclo completo: dar de alta los componentes (1 tela, 1 avío, 1 bordado) → crear un
 * modelo → subir una foto (red de R2 mockeada) → armar su receta (1 tela con banderas + 1 avío + 1
 * bordado con precio) → crear un 2º modelo y COPIAR la receta del primero → descontinuar → reactivar
 * → buscar por código y por descripción. Nombres únicos por corrida. El código y el estado
 * (Activo/Inactivo) viven en el TÍTULO del cajón; fotos, BOM y campos, en su cuerpo — por eso
 * `detalle` apunta al cajón completo.
 *
 * NOTA: requiere que la integración haya cableado el plugin de rutas, el menú (Modelos) y la
 * ruta `/modelos` en App.tsx; de lo contrario estas pruebas se omiten en CI hasta el cierre.
 */

/** Crea un componente simple desde su catálogo (tela/avío/bordado) y vuelve a Inicio. */
async function crearTela(page: Page, nombre: string): Promise<void> {
  await page.goto('/catalogos/telas');
  await expect(page.getByRole('heading', { name: 'Telas' })).toBeVisible();
  await page.getByTestId('nuevo-tela').click();
  const dialogo = page.getByRole('dialog');
  await dialogo.getByLabel('Nombre').fill(nombre);
  await page.getByTestId('guardar-tela').click();
  await expect(page.getByText(`Tela "${nombre}" creada.`)).toBeVisible();
}

async function crearAvio(page: Page, clave: string): Promise<void> {
  await page.goto('/catalogos/avios');
  await expect(page.getByRole('heading', { name: 'Avíos' })).toBeVisible();
  await page.getByTestId('nuevo-avio').click();
  const dialogo = page.getByRole('dialog');
  await dialogo.getByLabel('Clave').fill(clave);
  await dialogo.getByLabel('Descripción').fill(`Avío ${clave}`);
  await dialogo.getByLabel('Unidad').fill('pza');
  await dialogo.getByLabel('Presentación').fill('CAJA');
  await page.getByTestId('guardar-avio').click();
  await expect(page.getByText(`Avío "${clave}" creado.`)).toBeVisible();
}

async function crearBordado(page: Page, nombre: string): Promise<void> {
  await page.goto('/catalogos/bordados');
  await expect(page.getByRole('heading', { name: 'Arte', exact: true })).toBeVisible();
  await page.getByTestId('nuevo-bordado').click();
  const dialogo = page.getByRole('dialog');
  await dialogo.getByLabel('Nombre').fill(nombre);
  await page.getByTestId('guardar-bordado').click();
  await expect(page.getByText(`Arte "${nombre}" creado.`)).toBeVisible();
}

test.describe('Módulo Modelos (ficha + fotos + BOM)', () => {
  test('crear modelo, subir foto, armar receta, copiar receta, descontinuar y reactivar', async ({
    page,
  }) => {
    const sufijo = Date.now().toString().slice(-6);
    const codigo = `MOD-${sufijo}`;
    const codigoEditado = `${codigo}-ED`;
    const codigoDestino = `DEST-${sufijo}`;
    const tela = `Tela Mod ${sufijo}`;
    const avio = `BTN-${sufijo}`;
    const bordado = `Bordado Mod ${sufijo}`;

    await entrarComoAdmin(page);

    // ── Componentes del BOM (catálogos existentes) ──────────────────────────────
    await crearTela(page, tela);
    await crearAvio(page, avio);
    await crearBordado(page, bordado);

    // ── Navega a Modelos (Operación · Desarrollo, desplegable del rediseño) ────
    await abrirDesplegableMenu(page, 'Desarrollo');
    await page
      .getByRole('navigation', { name: 'Módulos' })
      .first()
      .getByRole('link', {
        // exact: el desplegable también tiene "Galería de modelos" (sub-vista F1-E5), que
        // haría match parcial con "Modelos" y violaría el strict mode de Playwright.
        name: 'Modelos',
        exact: true,
      })
      .click();
    await expect(page.getByRole('heading', { name: 'Modelos' })).toBeVisible();

    const detalle = page.locator('[data-slot="cajon-detalle"]');

    // ── Crear el modelo ──────────────────────────────────────────────────────────
    await page.getByTestId('nuevo-modelo').click();
    const dialogoAlta = page.getByRole('dialog');
    await expect(dialogoAlta.getByRole('heading', { name: 'Nuevo modelo' })).toBeVisible();
    await dialogoAlta.getByLabel('Código').fill(codigo);
    await dialogoAlta.getByLabel('Descripción').fill('Sudadera E2E');
    await dialogoAlta.getByLabel('Maquila base').fill('35');
    await page.getByTestId('guardar-modelo').click();
    await expect(page.getByText(`Modelo "${codigo}" creado.`)).toBeVisible();

    await page.getByTestId('buscar-modelo').fill(codigo);
    const filaNueva = page.getByTestId('fila-modelo').filter({ hasText: codigo });
    await expect(filaNueva).toBeVisible();
    await filaNueva.click();
    await expect(detalle.getByRole('heading', { name: codigo })).toBeVisible();
    await expect(detalle.getByText('$35.00')).toBeVisible();

    // ── Subir una foto (mockea SOLO el PUT a R2) ────────────────────────────────
    await page.route('**/*', (route) => {
      const peticion = route.request();
      const esPutAR2 = peticion.method() === 'PUT' && !peticion.url().includes('/api/');
      return esPutAR2 ? route.fulfill({ status: 200 }) : route.fallback();
    });
    // Sin fotos aún: placeholder NoFoto.
    await expect(detalle.getByTestId('modelo-sin-fotos')).toBeVisible();
    const pngMinimo = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      'base64',
    );
    await detalle.getByTestId('archivo-foto-modelo').setInputFiles({
      name: 'frente.png',
      mimeType: 'image/png',
      buffer: pngMinimo,
    });
    await expect(page.getByText('Foto agregada.')).toBeVisible();
    await expect(detalle.getByTestId('galeria-fotos-modelo')).toBeVisible();

    // ── Armar la receta: 1 tela (con banderas) ──────────────────────────────────
    await detalle.getByTestId('tab-bom-telas').click();
    await detalle.getByTestId('agregar-tela-bom').selectOption({ label: tela });
    // El renglón aparece; captura el consumo y apaga "producción" (banderas mixtas).
    const renglonTela = detalle.getByTestId('seccion-bom-telas').getByTestId(/^renglon-bom-\d+$/);
    await renglonTela.getByRole('spinbutton').fill('1.5');
    await renglonTela.getByLabel('Producción').uncheck();
    await detalle.getByTestId('guardar-bom-telas').click();
    await expect(page.getByText('Telas de la receta guardadas.')).toBeVisible();

    // ── 1 avío ───────────────────────────────────────────────────────────────────
    await detalle.getByTestId('tab-bom-avios').click();
    await detalle.getByTestId('agregar-avio-bom').selectOption({ label: `${avio} — Avío ${avio}` });
    const renglonAvio = detalle.getByTestId('seccion-bom-avios').getByTestId(/^renglon-bom-\d+$/);
    await renglonAvio.getByRole('spinbutton').fill('4');
    await detalle.getByTestId('guardar-bom-avios').click();
    await expect(page.getByText('Avíos de la receta guardados.')).toBeVisible();

    // ── 1 bordado con precio ─────────────────────────────────────────────────────
    await detalle.getByTestId('tab-bom-bordados').click();
    await detalle.getByTestId('agregar-bordado-bom').selectOption({ label: bordado });
    const renglonBordado = detalle
      .getByTestId('seccion-bom-bordados')
      .getByTestId(/^renglon-bom-bordado-\d+$/);
    await renglonBordado.getByRole('spinbutton').fill('45');
    await detalle.getByTestId('guardar-bom-bordados').click();
    await expect(page.getByText('Arte de la receta guardado.')).toBeVisible();

    // ── Crear un 2º modelo y COPIAR la receta del primero ───────────────────────
    // El cajón del 1er modelo sigue abierto; ciérralo antes de tocar el botón del fondo
    // (el overlay modal impide estabilizar el clic sobre "Nuevo modelo").
    await cerrarCajon(page);
    await page.getByTestId('nuevo-modelo').click();
    const dialogoDestino = page.getByRole('dialog');
    await dialogoDestino.getByLabel('Código').fill(codigoDestino);
    await page.getByTestId('guardar-modelo').click();
    await expect(page.getByText(`Modelo "${codigoDestino}" creado.`)).toBeVisible();

    await page.getByTestId('buscar-modelo').fill(codigoDestino);
    await page.getByTestId('fila-modelo').filter({ hasText: codigoDestino }).click();
    await expect(detalle.getByRole('heading', { name: codigoDestino })).toBeVisible();

    await detalle.getByTestId('abrir-copiar-bom').click();
    const dialogoCopiar = page.getByRole('dialog').filter({ hasText: 'Copiar receta' });
    await dialogoCopiar.getByTestId('copiar-bom-buscar').fill(codigo);
    await dialogoCopiar
      .getByTestId('copiar-bom-origen')
      .selectOption({ label: `${codigo} — Sudadera E2E` });
    await page.getByTestId('confirmar-copiar-bom').click();
    await expect(page.getByText('Receta copiada.')).toBeVisible();
    // La receta copiada aparece en el destino (la pestaña de telas muestra un renglón).
    await detalle.getByTestId('tab-bom-telas').click();
    await expect(
      detalle.getByTestId('seccion-bom-telas').getByTestId(/^renglon-bom-\d+$/),
    ).toBeVisible();

    // ── Editar el código del 2º modelo ───────────────────────────────────────────
    await page.getByTestId('editar-modelo').click();
    const dialogoEdicion = page.getByRole('dialog');
    await expect(dialogoEdicion.getByLabel('Código')).toHaveValue(codigoDestino);
    await dialogoEdicion.getByLabel('Código').fill(codigoEditado);
    await page.getByTestId('guardar-modelo').click();
    await expect(page.getByText(`Modelo "${codigoEditado}" actualizado.`)).toBeVisible();

    // ── Descontinuar (borrado suave) y reactivar ────────────────────────────────
    // El cajón del 2º modelo sigue abierto tras editar; ciérralo antes de clickear su fila.
    await cerrarCajon(page);
    await page.getByTestId('buscar-modelo').fill(codigoEditado);
    await page.getByTestId('fila-modelo').filter({ hasText: codigoEditado }).click();
    await page.getByTestId('desactivar-modelo').click();
    const confirmacion = page.getByRole('dialog');
    await expect(confirmacion.getByRole('heading', { name: 'Descontinuar modelo' })).toBeVisible();
    await page.getByTestId('confirmar-accion').click();
    await expect(page.getByText(`Modelo "${codigoEditado}" descontinuado.`)).toBeVisible();
    await expect(page.getByTestId('fila-modelo').filter({ hasText: codigoEditado })).toHaveCount(0);

    // Tras descontinuar, el cajón del modelo sigue abierto (la selección se retiene);
    // ciérralo antes del toggle del fondo para que su overlay no bloquee el clic.
    await cerrarCajon(page);
    await page.getByTestId('mostrar-desactivados').click();
    const filaInactiva = page.getByTestId('fila-modelo').filter({ hasText: codigoEditado });
    await expect(filaInactiva).toBeVisible();
    await filaInactiva.click();
    await expect(detalle.getByText('Inactivo', { exact: true })).toBeVisible();
    await page.getByTestId('activar-modelo').click();
    await expect(page.getByText(`Modelo "${codigoEditado}" reactivado.`)).toBeVisible();

    // ── Buscar por descripción (el primer modelo) ───────────────────────────────
    // Tras reactivar, el cajón del modelo quedó abierto; ciérralo antes del toggle del fondo.
    await cerrarCajon(page);
    await page.getByTestId('mostrar-desactivados').click();
    await page.getByTestId('buscar-modelo').fill('Sudadera E2E');
    await expect(page.getByTestId('fila-modelo').filter({ hasText: codigo })).toBeVisible();

    // Búsqueda sin resultados.
    await page.getByTestId('buscar-modelo').fill('zzz-no-existe-zzz');
    await expect(page.getByText('No hay modelos que coincidan con la búsqueda.')).toBeVisible();
  });
});
