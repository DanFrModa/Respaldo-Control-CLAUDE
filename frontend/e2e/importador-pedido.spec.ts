import ExcelJS from 'exceljs';
import { expect, test } from '@playwright/test';

import { crearColorYTalla, entrarComoAdmin } from './ayudas';

/**
 * E2E del IMPORTADOR del pedido del cliente (rediseño R8, B15 — proto §4.1 "Etapa 3") contra el
 * stack real:
 *
 *  1. Se siembran cliente + departamento + proyecto + 3 modelos/DESARROLLOS (F8, vía UI) — dos con
 *     su "Nº del cliente" (CLI-1/CLI-2, se auto-reconocen) y uno SIN número (para ligarlo a mano) —
 *     y color + talla (`crearColorYTalla`, lección F5-E4: la matriz los necesita ANTES).
 *  2. Se genera EN MEMORIA un .xlsx tipo C&A (Estilo · Color · Talla · Piezas · Precio) con los 2
 *     modelos reconocidos + 1 sin reconocer, usando el color/talla recién creados (para que la
 *     matriz resuelva).
 *  3. ASISTENTE de 3 pasos: Origen (cliente + archivo) → Formato (mapeo de columnas, se guarda como
 *     plantilla del cliente) → Vista previa (reconocidos ✓ + el sin-reconocer ligado a mano) →
 *     Confirmar → nacen el pedido interno y sus OPs.
 *  4. Se verifica el toast y que el pedido aparece en la consulta por mes con su chip de OC.
 */

/** Genera un .xlsx en memoria con encabezados fijos y las filas dadas. */
async function xlsxDemo(filas: (string | number)[][]): Promise<Buffer> {
  const libro = new ExcelJS.Workbook();
  const hoja = libro.addWorksheet('OC');
  hoja.addRow(['Estilo', 'Color', 'Talla', 'Piezas', 'Precio']);
  for (const fila of filas) hoja.addRow(fila);
  const datos = await libro.xlsx.writeBuffer();
  return Buffer.from(datos);
}

test.describe('Importador de pedido del cliente (rediseño R8, §4.1)', () => {
  test('asistente 3 pasos: reconoce 2 + liga 1 a mano → crea el pedido interno + OPs', async ({
    page,
  }) => {
    test.setTimeout(180_000); // flujo largo: siembra (cliente/depto/proyecto/3 desarrollos) + import.
    const sufijo = Date.now().toString().slice(-6);
    const cliente = `Cliente Import ${sufijo}`;
    const departamento = `NIÑOS ${sufijo}`;
    const nombreProyecto = `PV Import ${sufijo}`;
    const oc = `OC-IMP-${sufijo}`;
    // Modelos: dos con nº de cliente (auto-reconocidos) y uno sin (se liga a mano).
    const modelos = [
      { codigo: `IMP1-${sufijo}`, numCliente: `CLI-1-${sufijo}` },
      { codigo: `IMP2-${sufijo}`, numCliente: `CLI-2-${sufijo}` },
      { codigo: `IMP3-${sufijo}`, numCliente: '' }, // sin nº → no se reconoce solo
    ];
    const clienteMisterio = `CLI-999-${sufijo}`; // en el archivo, se liga a IMP3 a mano

    await entrarComoAdmin(page);
    const { color, talla } = await crearColorYTalla(page, sufijo);

    // ── Cliente + departamento ──────────────────────────────────────────────────
    await page.goto('/catalogos/clientes');
    await expect(page.getByRole('heading', { name: 'Clientes' })).toBeVisible();
    await page.getByTestId('nuevo-cliente').click();
    await page.getByRole('dialog').getByLabel('Nombre').fill(cliente);
    await page.getByTestId('guardar-cliente').click();
    await expect(page.getByText(`Cliente "${cliente}" creado.`)).toBeVisible();
    await page.getByTestId('buscar-cliente').fill(cliente);
    await page.getByTestId('fila-cliente').filter({ hasText: cliente }).first().click();
    await page.getByTestId('nuevo-departamento').click();
    await page.getByRole('dialog').getByLabel('Nombre').fill(departamento);
    await page.getByTestId('guardar-departamento').click();
    await expect(page.getByText(`Departamento "${departamento}" agregado.`)).toBeVisible();

    // ── 3 modelos ───────────────────────────────────────────────────────────────
    for (const modelo of modelos) {
      await page.goto('/modelos');
      await expect(page.getByRole('heading', { name: 'Modelos' })).toBeVisible();
      await page.getByTestId('nuevo-modelo').click();
      await page.getByRole('dialog').getByLabel('Código').fill(modelo.codigo);
      await page.getByTestId('guardar-modelo').click();
      await expect(page.getByText(`Modelo "${modelo.codigo}" creado.`)).toBeVisible();
    }

    // ── Proyecto + 3 desarrollos (con su nº de cliente los dos primeros) ─────────
    await page.goto('/desarrollo');
    await expect(page.getByRole('heading', { name: 'Desarrollo', exact: true })).toBeVisible();
    await page.getByTestId('nuevo-proyecto').click();
    const dialogoProyecto = page.getByRole('dialog');
    await dialogoProyecto.getByLabel('Cliente').selectOption({ label: cliente });
    await dialogoProyecto.getByLabel('Departamento').selectOption({ label: departamento });
    await dialogoProyecto.getByLabel('Nombre / tema').fill(nombreProyecto);
    await page.getByTestId('guardar-proyecto').click();
    await expect(page.getByText(/Proyecto \d+ creado\./)).toBeVisible();
    await page.getByTestId('fila-proyecto').filter({ hasText: nombreProyecto }).first().click();
    const detalleProyecto = page.getByTestId('detalle-proyecto');
    for (const modelo of modelos) {
      await detalleProyecto.getByTestId('agregar-desarrollo').click();
      const dialogoDes = page.getByRole('dialog');
      await dialogoDes.getByLabel('Modelo del catálogo').selectOption({ label: modelo.codigo });
      if (modelo.numCliente !== '') {
        await dialogoDes.getByLabel('Número del cliente (opcional)').fill(modelo.numCliente);
      }
      await page.getByTestId('guardar-desarrollo').click();
      // Señal DETERMINISTA del alta (NO el toast genérico "Desarrollo agregado.", que se ACUMULA
      // entre iteraciones — el diálogo reabre sin recargar la página — y rompe strict mode con 2
      // toasts iguales): el diálogo se cierra y la fila del desarrollo aparece en el detalle con SU
      // código de modelo (único por iteración). Esto además serializa el loop antes de reabrir.
      await expect(dialogoDes).toBeHidden();
      await expect(
        detalleProyecto.getByTestId('fila-desarrollo').filter({ hasText: modelo.codigo }),
      ).toBeVisible();
    }

    // ── Archivo del cliente (.xlsx) con los 2 reconocidos + 1 sin reconocer ──────
    const archivo = await xlsxDemo([
      [modelos[0]!.numCliente, color, talla, 400, 168],
      [modelos[1]!.numCliente, color, talla, 300, 154],
      [clienteMisterio, color, talla, 200, 140],
    ]);

    // ── Asistente: Paso 1 · Origen ──────────────────────────────────────────────
    await page.goto('/pedidos');
    await expect(page.getByRole('heading', { name: 'Pedidos' })).toBeVisible();
    await page.getByTestId('importar-de-cliente').click();
    const wiz = page.getByTestId('importador-pedido');
    await expect(wiz.getByRole('heading', { name: 'Importar pedido del cliente' })).toBeVisible();

    await wiz.getByTestId('importador-cliente-input').fill(cliente);
    await page.getByTestId('importador-cliente-opcion').first().click();
    await wiz.getByTestId('importador-oc').fill(oc);
    await wiz.getByTestId('importador-archivo').setInputFiles({
      name: 'OC-cliente.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: archivo,
    });
    await wiz.getByTestId('importador-continuar-origen').click();

    // ── Paso 2 · Formato: mapea las 5 columnas (pre-adivinado; se confirma explícito) ──
    await expect(wiz.getByTestId('importador-tabla-formato')).toBeVisible();
    const roles = ['modeloCliente', 'color', 'talla', 'cantidad', 'precio'];
    for (let i = 0; i < roles.length; i++) {
      await wiz.getByTestId('importador-rol').nth(i).selectOption(roles[i]!);
    }
    await wiz.getByTestId('importador-guardar-formato').click();

    // ── Paso 3 · Vista previa: 2 reconocidos + 1 sin reconocer ligado a mano ─────
    await expect(wiz.getByTestId('importador-tabla-preview')).toBeVisible();
    await expect(wiz.getByTestId('importador-grupo')).toHaveCount(3);
    // El modelo misterioso: ligarlo a mano al desarrollo IMP3.
    const filaMisterio = wiz.getByTestId('importador-grupo').filter({ hasText: clienteMisterio });
    await filaMisterio.getByTestId('importador-ligar-input').fill(modelos[2]!.codigo);
    await page.getByTestId('importador-ligar-opcion').first().click();

    await wiz.getByTestId('importador-confirmar').click();

    // ── Toast + el pedido aparece en la consulta por mes ────────────────────────
    await expect(page.getByText(/Pedido \d+-F importado · 3 OP\(s\)/)).toBeVisible();
    const grupo = page.getByTestId('pedidos-grupo').filter({ hasText: cliente }).first();
    await expect(grupo).toBeVisible();
    await expect(grupo.getByTestId('pedidos-chip-oc')).toContainText(oc);
  });
});
