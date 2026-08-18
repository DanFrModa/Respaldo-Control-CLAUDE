import { expect, test } from '@playwright/test';

import { entrarComoAdmin } from './ayudas';

/**
 * E2E smoke de la IMPORTACIÓN de CFDI de proveedores (F9-E3; R11) contra el stack real. El parseo, la
 * conciliación y la atomicidad los cubren a fondo los tests de INTEGRACIÓN del backend; aquí se verifica
 * el flujo de la pantalla de punta a punta: crear un proveedor → subir el XML → previsualizar los datos
 * extraídos → elegir el proveedor → importar → el cargo FISCAL aparece en su estado de cuenta. El XML lo
 * sube el SERVIDOR (server-side); en el stack de e2e R2 es dummy y la subida corre en modo LOCAL
 * (`R2_SUBIDA_LOCAL=true`, no-op), así que el navegador no mockea ningún PUT.
 */

/** Arma un CFDI 4.0 de ejemplo (factura I, IVA 16%, sin retención → total 1160). */
function cfdiXml(uuid: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" ` +
    `xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" ` +
    `Version="4.0" Fecha="2026-07-01T12:00:00" SubTotal="1000.00" Total="1160.00" ` +
    `Moneda="MXN" TipoDeComprobante="I" LugarExpedicion="64000">` +
    `<cfdi:Emisor Rfc="AAA010101AA1" Nombre="Telas del Norte SA" RegimenFiscal="601"/>` +
    `<cfdi:Receptor Rfc="XAXX010101000" Nombre="FR Moda SA de CV" ` +
    `DomicilioFiscalReceptor="64000" RegimenFiscalReceptor="601" UsoCFDI="G03"/>` +
    `<cfdi:Conceptos>` +
    `<cfdi:Concepto ClaveProdServ="53102500" Cantidad="10" ClaveUnidad="H87" ` +
    `Descripcion="Tela algodon" ValorUnitario="100.00" Importe="1000.00"/>` +
    `</cfdi:Conceptos>` +
    `<cfdi:Impuestos TotalImpuestosTrasladados="160.00"><cfdi:Traslados>` +
    `<cfdi:Traslado Base="1000.00" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="160.00"/>` +
    `</cfdi:Traslados></cfdi:Impuestos>` +
    `<cfdi:Complemento>` +
    `<tfd:TimbreFiscalDigital Version="1.1" UUID="${uuid}" FechaTimbrado="2026-07-01T12:01:00"/>` +
    `</cfdi:Complemento>` +
    `</cfdi:Comprobante>`
  );
}

test.describe('Importar CFDI de proveedor (F9-E3)', () => {
  test('sube un XML → previsualiza → importa → aparece el cargo fiscal en el estado de cuenta', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const sufijo = Date.now().toString().slice(-6);
    const proveedor = `Proveedor CFDI ${sufijo}`;
    const uuid = `AAAAAAAA-0000-0000-0000-${sufijo.padStart(12, '0')}`;

    await entrarComoAdmin(page);

    // ── Crear un proveedor (nombre + rol, R15) ─────────────────────────────────
    await page.goto('/catalogos/proveedores');
    await expect(page.getByRole('heading', { name: 'Proveedores' })).toBeVisible();
    await page.getByTestId('nuevo-proveedor').click();
    const dialogo = page.getByRole('dialog');
    // Por id: el label "Nombre" ya no es único en el diálogo (se agregó "Nombre corto", A1.1).
    await dialogo.locator('#proveedor-nombre').fill(proveedor);
    // El campo TIPO se retiró en V1-E3f pieza B (§Post-F9.56 punto 3).
    await dialogo.getByTestId('selector-roles-proveedor').getByRole('checkbox').first().check();
    await page.getByTestId('guardar-proveedor').click();
    await expect(page.getByText(`Proveedor "${proveedor}" creado.`)).toBeVisible();

    // ── Ir a Importar CFDI ─────────────────────────────────────────────────────
    await page.goto('/cxp');
    await page.getByTestId('cxp-ir-importar-cfdi').click();
    await expect(page.getByRole('heading', { name: 'Importar CFDI de proveedor' })).toBeVisible();

    // ── Subir el XML + previsualizar ───────────────────────────────────────────
    await page.getByTestId('cfdi-archivo').setInputFiles({
      name: 'factura.xml',
      mimeType: 'application/xml',
      buffer: Buffer.from(cfdiXml(uuid), 'utf8'),
    });
    await page.getByTestId('cfdi-previsualizar').click();

    const datos = page.getByTestId('cfdi-datos');
    await expect(datos).toBeVisible();
    await expect(datos).toContainText('$1,160.00');
    await expect(datos).toContainText(uuid);
    await expect(page.getByTestId('cfdi-conceptos')).toContainText('Tela algodon');

    // ── Elegir el proveedor (no hay match por RFC → se elige a mano) ────────────
    await page.getByTestId('cfdi-proveedor-busqueda').fill(proveedor);
    await page.getByTestId('cfdi-proveedor-opcion').first().click();

    // ── Importar (el servidor sube el XML en modo local; no hay PUT del navegador) ──
    await page.getByTestId('cfdi-importar-confirmar').click();
    await expect(page.getByText(/CFDI importado/i)).toBeVisible();

    // ── El cargo FISCAL aparece en el estado de cuenta del proveedor ────────────
    await expect(
      page.getByRole('heading', { name: 'Estado de cuenta del proveedor' }),
    ).toBeVisible();
    const tabla = page.getByTestId('cxp-edc-tabla');
    await expect(tabla).toBeVisible();
    await expect(tabla).toContainText('$1,160.00');
    await expect(tabla).toContainText('Fiscal');
  });
});
