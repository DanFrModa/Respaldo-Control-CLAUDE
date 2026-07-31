import { describe, expect, it } from 'vitest';

import { esPng, leerCabeceraPng, problemaPngParaPdf } from './png.js';

const FIRMA = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Arma un chunk PNG bien formado: largo(4) + tipo(4) + datos + crc(4, en ceros: nadie lo valida). */
function chunk(tipo: string, datos: Buffer): Buffer {
  const largo = Buffer.alloc(4);
  largo.writeUInt32BE(datos.length);
  return Buffer.concat([largo, Buffer.from(tipo, 'latin1'), datos, Buffer.alloc(4)]);
}

/** PNG sintético con la cabecera pedida (+ chunks extra opcionales). */
function png(
  opciones: { profundidad?: number; tipoColor?: number; extras?: Buffer[] } = {},
): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(100, 0); // ancho
  ihdr.writeUInt32BE(40, 4); // alto
  ihdr.writeUInt8(opciones.profundidad ?? 8, 8);
  ihdr.writeUInt8(opciones.tipoColor ?? 6, 9);
  return Buffer.concat([
    FIRMA,
    chunk('IHDR', ihdr),
    ...(opciones.extras ?? []),
    chunk('IDAT', Buffer.from('datos-comprimidos')),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

describe('esPng / leerCabeceraPng', () => {
  it('reconoce un PNG y lee su IHDR', () => {
    const cabecera = leerCabeceraPng(png({ profundidad: 8, tipoColor: 2 }));
    expect(cabecera).toEqual({
      ancho: 100,
      alto: 40,
      profundidadBits: 8,
      tipoColor: 2,
      tieneTrns: false,
    });
  });

  it('un JPG no es PNG y no tiene cabecera legible', () => {
    const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
    expect(esPng(jpg)).toBe(false);
    expect(leerCabeceraPng(jpg)).toBeNull();
  });

  it('un PNG truncado antes del IHDR devuelve null', () => {
    expect(leerCabeceraPng(FIRMA)).toBeNull();
  });

  it('detecta el chunk tRNS solo cuando el color es indexado', () => {
    const trns = chunk('tRNS', Buffer.from([0x00, 0xff]));
    expect(leerCabeceraPng(png({ tipoColor: 3, extras: [trns] }))?.tieneTrns).toBe(true);
    // Mismo chunk pero en un RGBA: no cambia el veredicto, así que ni se busca.
    expect(leerCabeceraPng(png({ tipoColor: 6, extras: [trns] }))?.tieneTrns).toBe(false);
  });

  it('no confunde los bytes "tRNS" que aparezcan DENTRO de los datos de un chunk', () => {
    // Un chunk anterior cuyos DATOS contienen el texto tRNS: el recorrido salta por largos.
    const señuelo = chunk('iTXt', Buffer.from('xxtRNSxx', 'latin1'));
    expect(leerCabeceraPng(png({ tipoColor: 3, extras: [señuelo] }))?.tieneTrns).toBe(false);
  });
});

describe('problemaPngParaPdf (logos que el generador de PDF pinta mal)', () => {
  it('acepta un PNG de 8 bits RGBA', () => {
    expect(problemaPngParaPdf(png({ profundidad: 8, tipoColor: 6 }))).toBeNull();
  });

  it('acepta un PNG indexado SIN transparencia', () => {
    expect(problemaPngParaPdf(png({ profundidad: 8, tipoColor: 3 }))).toBeNull();
  });

  it('RECHAZA los PNG de 16 bits, y lo dice con la salida sugerida', () => {
    const mensaje = problemaPngParaPdf(png({ profundidad: 16, tipoColor: 6 }));
    expect(mensaje).toContain('16 bits');
    expect(mensaje).toContain('8 bits o JPG');
  });

  it('RECHAZA los PNG indexados CON transparencia (paleta + tRNS)', () => {
    const trns = chunk('tRNS', Buffer.from([0x00]));
    const mensaje = problemaPngParaPdf(png({ profundidad: 8, tipoColor: 3, extras: [trns] }));
    expect(mensaje).toContain('paleta');
    expect(mensaje).toContain('8 bits o JPG');
  });

  it('acepta un PNG en ESCALA DE GRISES de 8 bits (tipo de color 0)', () => {
    expect(problemaPngParaPdf(png({ profundidad: 8, tipoColor: 0 }))).toBeNull();
  });

  it('acepta un RGB de 8 bits CON tRNS: el problema es la PALETA transparente, no el tRNS', () => {
    const trns = chunk('tRNS', Buffer.from([0x00, 0xff, 0x00, 0xff, 0x00, 0xff]));
    expect(problemaPngParaPdf(png({ profundidad: 8, tipoColor: 2, extras: [trns] }))).toBeNull();
  });

  it('RECHAZA un indexado de 4 bits CON tRNS (el bloqueo no depende de la profundidad)', () => {
    const trns = chunk('tRNS', Buffer.from([0x00]));
    expect(problemaPngParaPdf(png({ profundidad: 4, tipoColor: 3, extras: [trns] }))).toContain(
      'paleta',
    );
  });

  it('RECHAZA un archivo que dice ser PNG pero tiene la cabecera rota', () => {
    expect(problemaPngParaPdf(Buffer.from('esto no es una imagen'))).toContain(
      'no es un PNG válido',
    );
  });
});
