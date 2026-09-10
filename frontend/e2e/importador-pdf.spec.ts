import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';

import { entrarComoAdmin } from './ayudas';

/**
 * E2E del IMPORTADOR de OC del cliente por PDF (petición Daniel — plantilla C&A) contra el stack real:
 *
 *  1. Se siembran cliente + un modelo del catálogo (para ligar el "Modelo ID" de C&A a NUESTRO modelo).
 *  2. Se sube el PDF REAL de una OC de C&A (`e2e/fixtures/cya-620884.pdf`): el backend lo parsea con
 *     unpdf (extractor por anclas de etiqueta).
 *  3. Asistente de 2 pasos: Origen (cliente + referencia + PDF) → Vista previa (un renglón por PDF; se
 *     liga a mano el modelo la primera vez) → Confirmar → nacen el pedido interno y su OP (matriz +
 *     RC + el PDF adjunto a la orden; la subida a R2 es no-op en el stack de e2e, `R2_SUBIDA_LOCAL`).
 *  4. Se verifica el toast y que el pedido aparece en la consulta por mes con su chip de referencia.
 */

const PDF_CYA = readFileSync(fileURLToPath(new URL('./fixtures/cya-620884.pdf', import.meta.url)));

test.describe('Importador de OC por PDF (C&A)', () => {
  test('sube el PDF de C&A → liga el modelo → crea el pedido interno + su OP', async ({ page }) => {
    test.setTimeout(120_000);
    const sufijo = Date.now().toString().slice(-6);
    const cliente = `C&A Import ${sufijo}`;
    const modelo = `CYA-${sufijo}`;
    const referencia = `REM-${sufijo}`;

    await entrarComoAdmin(page);

    // ── Cliente ──────────────────────────────────────────────────────────────
    await page.goto('/catalogos/clientes');
    await expect(page.getByRole('heading', { name: 'Clientes' })).toBeVisible();
    await page.getByTestId('nuevo-cliente').click();
    await page.getByRole('dialog').getByLabel('Nombre').fill(cliente);
    await page.getByTestId('guardar-cliente').click();
    await expect(page.getByText(`Cliente "${cliente}" creado.`)).toBeVisible();

    // ── Modelo del catálogo (destino de la liga del Modelo ID de C&A) ─────────
    await page.goto('/modelos');
    await expect(page.getByRole('heading', { name: 'Modelos' })).toBeVisible();
    await page.getByTestId('nuevo-modelo').click();
    await page.getByRole('dialog').getByLabel('Código').fill(modelo);
    // ⭐ V1-E8j (§Post-F9.134): tipo de prenda y género son OBLIGATORIOS en el alta — son los
    // dos dígitos con los que el sistema arma el nº de producción del modelo.
    await page
      .getByRole('dialog')
      .getByLabel('Tipo de producto')
      .selectOption({ label: 'Pantalón' });
    await page.getByRole('dialog').getByLabel('Género').selectOption({ label: 'Caballero' });
    await page.getByTestId('guardar-modelo').click();
    await expect(page.getByText(`Modelo "${modelo}" creado.`)).toBeVisible();

    // ── Asistente: Paso 1 · Origen ────────────────────────────────────────────
    await page.goto('/pedidos');
    await expect(page.getByRole('heading', { name: 'Pedidos' })).toBeVisible();
    await page.getByTestId('importar-pdf-cya').click();
    const wiz = page.getByTestId('importador-pdf');
    await expect(wiz.getByRole('heading', { name: 'Importar OC del cliente (PDF)' })).toBeVisible();

    await wiz.getByTestId('importador-pdf-cliente-input').fill(cliente);
    await page.getByTestId('importador-pdf-cliente-opcion').first().click();
    await wiz.getByTestId('importador-pdf-referencia').fill(referencia);
    await wiz.getByTestId('importador-pdf-archivos').setInputFiles({
      name: 'cya-620884.pdf',
      mimeType: 'application/pdf',
      buffer: PDF_CYA,
    });
    await wiz.getByTestId('importador-pdf-continuar-origen').click();

    // ── Paso 2 · Vista previa: un renglón con el Modelo ID de C&A, sin ligar ──
    const fila = wiz.getByTestId('importador-pdf-fila');
    await expect(fila).toHaveCount(1);
    await expect(fila).toContainText('620884'); // nº de orden de C&A
    await expect(fila).toContainText('3138277'); // Modelo ID de C&A
    await expect(fila.getByText('sin ligar')).toBeVisible();

    // Ligar el Modelo ID a NUESTRO modelo (primera vez → a mano; el sistema lo aprende).
    await fila.getByTestId('importador-pdf-ligar-input').fill(modelo);
    await page.getByTestId('importador-pdf-ligar-opcion').first().click();

    await wiz.getByTestId('importador-pdf-confirmar').click();

    // ── Toast + el pedido aparece en la consulta con su chip de referencia ─────
    await expect(page.getByText(/Pedido \d+-F importado · 1 OP\(s\)/)).toBeVisible();
    const grupo = page.getByTestId('pedidos-grupo').filter({ hasText: cliente }).first();
    await expect(grupo).toBeVisible();
    await expect(grupo.getByTestId('pedidos-chip-oc')).toContainText(referencia);
  });
});

/**
 * ⭐ §Post-F9.70 (V1-E3i) — EL CAMINO NATURAL: subir la OC DESDE EL PEDIDO.
 *
 * Daniel buscó el importador desde «Nuevo pedido interno», no lo encontró, y le subió su PDF al
 * campo *"Archivo de la OC"*, que sólo lo adjuntaba: por eso el diálogo le seguía pidiendo cantidad
 * y precio a mano. Este e2e recorre el camino tal como él lo intentó — y de paso comprueba el otro
 * hallazgo de esa sesión: que el botón «Generar pedido interno + OPs», cuando está apagado, DICE
 * qué falta (§Post-F9.70 punto 3).
 */
test.describe('OC del cliente subida desde el pedido (§Post-F9.70)', () => {
  test('el campo "Archivo de la OC" LEE el PDF y propone cargarlo con el importador', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const sufijo = Date.now().toString().slice(-6);
    const cliente = `C&A Pedido ${sufijo}`;
    const modelo = `CYAP-${sufijo}`;

    await entrarComoAdmin(page);

    await page.goto('/catalogos/clientes');
    await expect(page.getByRole('heading', { name: 'Clientes' })).toBeVisible();
    await page.getByTestId('nuevo-cliente').click();
    await page.getByRole('dialog').getByLabel('Nombre').fill(cliente);
    await page.getByTestId('guardar-cliente').click();
    await expect(page.getByText(`Cliente "${cliente}" creado.`)).toBeVisible();

    await page.goto('/modelos');
    await expect(page.getByRole('heading', { name: 'Modelos' })).toBeVisible();
    await page.getByTestId('nuevo-modelo').click();
    await page.getByRole('dialog').getByLabel('Código').fill(modelo);
    // ⭐ V1-E8j (§Post-F9.134): tipo de prenda y género son OBLIGATORIOS en el alta — son los
    // dos dígitos con los que el sistema arma el nº de producción del modelo.
    await page
      .getByRole('dialog')
      .getByLabel('Tipo de producto')
      .selectOption({ label: 'Pantalón' });
    await page.getByRole('dialog').getByLabel('Género').selectOption({ label: 'Caballero' });
    await page.getByTestId('guardar-modelo').click();
    await expect(page.getByText(`Modelo "${modelo}" creado.`)).toBeVisible();

    // ── El camino de Daniel: Nuevo pedido → cliente → subir la OC en el campo del archivo ──
    await page.goto('/pedidos');
    await expect(page.getByRole('heading', { name: 'Pedidos' })).toBeVisible();
    await page.getByTestId('nuevo-pedido').click();
    const constructor = page.getByTestId('constructor-pedido');
    await expect(constructor).toBeVisible();
    await constructor.getByTestId('constructor-cliente-input').fill(cliente);
    await page.getByTestId('constructor-cliente-opcion').first().click();
    await constructor.getByTestId('constructor-archivo-oc').setInputFiles({
      name: 'cya-620884.pdf',
      mimeType: 'application/pdf',
      buffer: PDF_CYA,
    });

    // El campo LEE el PDF y cuenta lo que encontró (antes: lo guardaba callado).
    const propuesta = constructor.getByTestId('constructor-oc-reconocida');
    await expect(propuesta).toBeVisible({ timeout: 30_000 });
    await expect(propuesta).toContainText('620884');
    await constructor.getByTestId('constructor-oc-cargar').click();

    // ── Se abre el importador YA cargado: analiza solo, sin volver a pedir cliente ni archivo ──
    const wiz = page.getByTestId('importador-pdf');
    await expect(wiz).toBeVisible();
    const fila = wiz.getByTestId('importador-pdf-fila');
    await expect(fila).toHaveCount(1, { timeout: 30_000 });
    await expect(fila).toContainText('620884');

    // §Post-F9.70 punto 3: la primera vez de este modelo NO hay liga… y el botón lo DICE.
    await expect(wiz.getByTestId('importador-pdf-confirmar')).toBeDisabled();
    await expect(wiz.getByTestId('importador-pdf-motivo-bloqueo')).toContainText(/Falta ligar/i);

    await fila.getByTestId('importador-pdf-ligar-input').fill(modelo);
    await page.getByTestId('importador-pdf-ligar-opcion').first().click();
    await expect(wiz.getByTestId('importador-pdf-motivo-bloqueo')).toHaveCount(0);

    await wiz.getByTestId('importador-pdf-confirmar').click();
    await expect(page.getByText(/Pedido \d+-F importado · 1 OP\(s\)/)).toBeVisible({
      timeout: 60_000,
    });
  });
});
