import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { ModeloCodigosBarra } from '@/api/modelos';

// Las primitivas de @react-pdf/renderer se simulan como elementos del DOM para poder renderizar
// el documento a markup en pruebas (no se genera un PDF real aquí).
vi.mock('@react-pdf/renderer', () => ({
  Document: ({ children }: { children?: React.ReactNode }) => (
    <div data-pdf="document">{children}</div>
  ),
  Page: ({ children }: { children?: React.ReactNode }) => <div data-pdf="page">{children}</div>,
  View: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Text: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
  Image: ({ src }: { src: string }) => <img src={src} alt="" data-pdf="image" />,
  StyleSheet: { create: (estilos: unknown) => estilos },
}));

// bwip-js: se simula la generación de PNG (jsdom no dibuja canvas real).
vi.mock('./bwip', () => ({
  aPngDataUrl: (simbologia: string, valor: string) =>
    `data:image/png;base64,${simbologia}-${valor}`,
}));

import { EtiquetaPdf } from './EtiquetaPdf';
import { nombreArchivoEtiqueta } from './etiqueta';

const DATOS: ModeloCodigosBarra = {
  idModelo: 1,
  codigoModelo: '00501',
  idEmpresa: 8,
  nombreEmpresa: 'FR Moda',
  prefijo: '7500092',
  base12: '750009200501',
  ean13: '7500092005011',
  dun14: '17500092005018',
};

describe('EtiquetaPdf', () => {
  it('incrusta el nombre de empresa, el modelo y ambos códigos como imágenes', () => {
    const markup = renderToStaticMarkup(<EtiquetaPdf datos={DATOS} />);
    expect(markup).toContain('FR Moda');
    expect(markup).toContain('00501');
    expect(markup).toContain('7500092005011'); // EAN-13 en el pie
    expect(markup).toContain('17500092005018'); // DUN-14 en el pie
    // Dos imágenes: el PNG del EAN-13 y el del DUN-14.
    expect(markup).toContain('data:image/png;base64,ean13-7500092005011');
    expect(markup).toContain('data:image/png;base64,itf14-17500092005018');
  });

  it('propone un nombre de archivo con el código del modelo y el EAN-13', () => {
    expect(nombreArchivoEtiqueta(DATOS)).toBe('etiqueta-modelo-00501-7500092005011.pdf');
  });
});
