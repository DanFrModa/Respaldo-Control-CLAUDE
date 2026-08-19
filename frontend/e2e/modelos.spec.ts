import { expect, test, type Page } from '@playwright/test';

import { abrirDesplegableMenu, cerrarCajon, entrarComoAdmin } from './ayudas';

/**
 * E2E del Módulo 2 — Modelos (F1-E4) contra el stack real, re-vestido R9 a TABLA-FIRST + CAJÓN.
 * Recorre el ciclo completo: dar de alta los componentes (1 tela, 1 avío) → crear un
 * modelo → subir una foto (red de R2 mockeada) → armar su receta (1 tela con banderas + 1 avío + 1
 * arte con precio) → crear un 2º modelo y COPIAR la receta del primero → descontinuar → reactivar
 * → buscar por código y por descripción. Nombres únicos por corrida. El código y el estado
 * (Activo/Inactivo) viven en el TÍTULO del cajón; fotos, BOM y campos, en su cuerpo — por eso
 * `detalle` apunta al cajón completo.
 *
 * NOTA: requiere que la integración haya cableado el plugin de rutas, el menú (Modelos) y la
 * ruta `/modelos` en App.tsx; de lo contrario estas pruebas se omiten en CI hasta el cierre.
 */

/**
 * Crea un PROVEEDOR por la UI (el seed no siembra ninguno): el alta de tela ahora exige el
 * proveedor DUEÑO del artículo (§Post-F9.11). Calca los pasos de `proveedores.spec.ts`.
 */
async function crearProveedor(page: Page, nombre: string): Promise<void> {
  await page.goto('/catalogos/proveedores');
  await expect(page.getByRole('heading', { name: 'Proveedores' })).toBeVisible();
  await page.getByTestId('nuevo-proveedor').click();
  const dialogo = page.getByRole('dialog');
  // Por id: el label "Nombre" ya no es único en el diálogo (se agregó "Nombre corto", A1.1).
  await dialogo.locator('#proveedor-nombre').fill(nombre);
  // Crear exige >=1 rol (R15). Marca "Telas" EN CONCRETO (el rol se llamaba "Vende telas" hasta el 18-ago): desde el 7-ago-2026 el selector
  // de proveedor del alta de tela se acota a ese rol (decisión P.2), así que un proveedor con
  // cualquier otro rol no aparecería en el combobox.
  await dialogo.getByRole('checkbox', { name: 'Telas' }).check();
  await page.getByTestId('guardar-proveedor').click();
  await expect(page.getByText(`Proveedor "${nombre}" creado.`)).toBeVisible();
}

/** Crea un componente simple desde su catálogo (tela/avío) y vuelve a Inicio. */
async function crearTela(page: Page, nombre: string, proveedor: string): Promise<void> {
  await page.goto('/catalogos/telas');
  await expect(page.getByRole('heading', { name: 'Telas' })).toBeVisible();
  await page.getByTestId('nuevo-tela').click();
  const dialogo = page.getByRole('dialog');
  // El label "Nombre" ya no es único en el diálogo de tela (§Post-F9.11): por id.
  await dialogo.locator('#tela-nombre').fill(nombre);
  // El proveedor dueño es obligatorio en el alta (§Post-F9.11).
  await page.getByTestId('tela-proveedor-busqueda').fill(proveedor);
  await page.getByTestId('tela-proveedor-opcion').filter({ hasText: proveedor }).first().click();
  // La unidad es obligatoria y arranca sin elegir (30-jul-2026).
  await dialogo.getByTestId('tela-unidad').selectOption('KG');
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
    const arte = `Arte Mod ${sufijo}`;
    const proveedor = `Prov Mod ${sufijo}`;

    await entrarComoAdmin(page);

    // ── Componentes del BOM (catálogos existentes) ──────────────────────────────
    await crearProveedor(page, proveedor);
    await crearTela(page, tela, proveedor);
    await crearAvio(page, avio);

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
    // El componente se busca TECLEANDO (combobox server-side, V1-E3c): con 877 telas el `<select>`
    // con tope de 100 dejaba fuera a la mayoría.
    await detalle.getByTestId('agregar-tela-bom-busqueda').fill(tela);
    await page.getByTestId('agregar-tela-bom-opcion').first().click();
    // El renglón aparece; captura el consumo y apaga "producción" (banderas mixtas) — las tres
    // banderas viven ahora en el panel expandible del renglón.
    const renglonTela = detalle.getByTestId('seccion-bom-telas').getByTestId(/^renglon-bom-\d+$/);
    await renglonTela.getByRole('spinbutton').fill('1.5');
    await renglonTela.getByRole('button', { name: /^Ver detalle de/ }).click();
    await detalle
      .getByTestId(/^detalle-bom-\d+$/)
      .getByLabel('Producción')
      .uncheck();
    await detalle.getByTestId('guardar-bom-telas').click();
    await expect(page.getByText('Telas de la receta guardadas.')).toBeVisible();

    // ── 1 avío ───────────────────────────────────────────────────────────────────
    await detalle.getByTestId('tab-bom-avios').click();
    await detalle.getByTestId('agregar-avio-bom-busqueda').fill(avio);
    await page.getByTestId('agregar-avio-bom-opcion').first().click();
    const renglonAvio = detalle.getByTestId('seccion-bom-avios').getByTestId(/^renglon-bom-\d+$/);
    await renglonAvio.getByRole('spinbutton').fill('4');
    await detalle.getByTestId('guardar-bom-avios').click();
    await expect(page.getByText('Avíos de la receta guardados.')).toBeVisible();

    // ── 1 arte con precio (V1-E3d: el arte es del MODELO, se captura aquí mismo) ──
    await detalle.getByTestId('tab-bom-artes').click();
    await detalle.getByTestId('agregar-arte').click();
    const dialogoArte = page.getByTestId('dialogo-arte');
    await dialogoArte.getByTestId('arte-descripcion').fill(arte);
    // V1-E3f: el tipo del arte es obligatorio y sale del catálogo único (§Post-F9.58).
    await dialogoArte.getByTestId('arte-tipo').selectOption({ label: 'Bordado' });
    await dialogoArte.getByTestId('arte-precio').fill('45');
    await page.getByTestId('guardar-arte').click();
    await expect(page.getByText('Arte agregado.')).toBeVisible();
    await expect(detalle.getByTestId(/^renglon-arte-\d+$/).filter({ hasText: arte })).toContainText(
      '$45.00',
    );

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
