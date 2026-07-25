import { renderToBuffer, Document, Page } from '@react-pdf/renderer';
import { createElement as h } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  EncabezadoDocumento,
  estilosDoc,
  fijarLogoImpresos,
  restablecerLogoImpresos,
} from './impresos-estilos.js';
import { LOGO_EMPAQUETADO_DATA_URL } from './logo-empaquetado.js';

/**
 * Encabezado compartido de los 23 impresos (post-F9, branding de Daniel).
 *
 * `EncabezadoDocumento` es EL punto único donde se pinta el logo, así que lo que se prueba aquí es
 * que (a) por defecto sale con el logo empaquetado, (b) el logo inyectado lo sustituye, (c) sin
 * logo el encabezado sigue saliendo con el membrete de texto — un impreso no puede romperse por la
 * marca — y (d) el membrete de texto NUNCA se pierde.
 */

/** Renderiza un PDF de una página con solo el encabezado y devuelve su buffer. */
async function pdfConEncabezado(): Promise<Buffer> {
  return renderToBuffer(
    h(
      Document,
      {},
      h(
        Page,
        { size: 'LETTER', style: estilosDoc.pagina },
        EncabezadoDocumento({
          empresa: 'FR Moda SA de CV',
          titulo: 'Documento de prueba — CONTROL v2',
          derecha: { etiqueta: 'Folio', valor: '1234', grande: true },
        }),
      ),
    ),
  );
}

/** ¿El buffer es un PDF? (los impresos del repo se validan igual). */
function esPdf(buffer: Buffer): boolean {
  return buffer.subarray(0, 5).toString('latin1') === '%PDF-';
}

describe('EncabezadoDocumento (branding compartido)', () => {
  afterEach(() => {
    restablecerLogoImpresos();
  });

  it('arranca con el logo EMPAQUETADO: un impreso sale brandeado aunque nadie inyecte nada', () => {
    const elemento = EncabezadoDocumento({ empresa: 'FR Moda', titulo: 'Prueba' });
    expect(JSON.stringify(elemento)).toContain(LOGO_EMPAQUETADO_DATA_URL.slice(0, 40));
  });

  it('pinta el logo INYECTADO en lugar del empaquetado', () => {
    const otro = 'data:image/png;base64,LOGO-DE-LA-EMPRESA';
    fijarLogoImpresos(otro);

    const elemento = EncabezadoDocumento({ empresa: 'FR Moda', titulo: 'Prueba' });
    const serializado = JSON.stringify(elemento);
    expect(serializado).toContain(otro);
    expect(serializado).not.toContain(LOGO_EMPAQUETADO_DATA_URL.slice(0, 40));
  });

  it('sin logo (null) NO pinta imagen, pero conserva el membrete de texto', () => {
    fijarLogoImpresos(null);

    const serializado = JSON.stringify(
      EncabezadoDocumento({ empresa: 'FR Moda SA de CV', titulo: 'Orden de compra' }),
    );
    expect(serializado).not.toContain('data:image');
    expect(serializado).toContain('FR Moda SA de CV');
    expect(serializado).toContain('Orden de compra');
  });

  it('el membrete de texto sigue presente CON logo (es el respaldo si la imagen no carga)', () => {
    const serializado = JSON.stringify(
      EncabezadoDocumento({ empresa: 'FR Moda SA de CV', titulo: 'Nota de salida' }),
    );
    expect(serializado).toContain('FR Moda SA de CV');
    expect(serializado).toContain('Nota de salida');
  });

  it('renderiza un PDF real con el logo empaquetado incrustado', async () => {
    const buffer = await pdfConEncabezado();
    expect(esPdf(buffer)).toBe(true);
    // Con imagen incrustada el PDF pesa notoriamente más que uno de puro texto.
    expect(buffer.byteLength).toBeGreaterThan(10_000);
  });

  it('renderiza un PDF real SIN logo (degradación): el documento sale igual', async () => {
    fijarLogoImpresos(null);
    const buffer = await pdfConEncabezado();
    expect(esPdf(buffer)).toBe(true);
  });
});
