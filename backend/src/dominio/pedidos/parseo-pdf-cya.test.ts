/**
 * Tests UNIT del extractor de OC de C&A (`parseo-pdf-cya.ts`). Cubren:
 *  • el fixture REAL (`__fixtures__/cya-620884.pdf`) de punta a punta (extracción unpdf + parseo): todos
 *    los campos + la matriz de tallas + que cuadra (sin advertencias),
 *  • el parseo PURO (`parsearTextoCya`) con texto armado a mano: Sub División vacía, cuadre y descuadres
 *    (Σ tallas ≠ Piezas Totales, Σ×precio ≠ Monto Total, sin tabla de tallas) → ADVERTENCIAS (no lanzan),
 *  • PDF ajeno (sin "Numero de Orden") y archivo corrupto/no-PDF → error CLARO.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ErrorValidacion } from '../../comun/errores.js';
import { parsearPdfCya, parsearTextoCya } from './parseo-pdf-cya.js';

const RUTA_FIXTURE = fileURLToPath(new URL('./__fixtures__/cya-620884.pdf', import.meta.url));

/** Arma el texto de la página 1 (encabezado) a la manera de C&A, con overrides. */
function pagina1(
  campos: Partial<{
    numeroOrden: string;
    modeloId: string;
    costo: string;
    piezas: string;
    division: string;
    subDivision: string;
    descripcion: string;
    color: string;
    pantone: string;
    monto: string;
    semana: string;
    codigo: string;
  }> = {},
): string {
  const c = {
    numeroOrden: '999001',
    modeloId: '7777777',
    costo: '50.0000',
    piezas: '100',
    division: '3- KIDS',
    subDivision: '34- NIÑO',
    descripcion: 'PLAYERA TEST',
    color: 'NEGRO',
    pantone: '', // como la OC real de C&A: PANTONE viene VACÍO por defecto
    monto: '5000.0000',
    semana: '202601',
    codigo: '26/4/AA/200',
    ...campos,
  };
  return [
    `Numero de Orden: ${c.numeroOrden}`,
    `Modelo ID: ${c.modeloId}`,
    `Costo Unitario (FOB): ${c.costo}`,
    `Piezas Totales: ${c.piezas}`,
    // Bloque "Descripcion del Articulo" TAL COMO lo aplana unpdf en la OC real: la División va
    // label→valor, pero Familia/Sub Familia/Grupo de Producto/Sub División van VALOR→etiqueta (el
    // valor PRECEDE a su etiqueta). Por eso `${c.subDivision}` va PEGADO antes de "Sub Division:".
    `Division: ${c.division} 570- PLAYERASFamilia: 75- PLAYERA MLSub Familia: 341- MODAGrupo de Producto:${c.subDivision}Sub Division: Codigo Unico: ${c.codigo} Vigencia: INVIERNO 2026`,
    // Color + PANTONE + Composición como en la OC real: el pantone va ENTRE "PANTONE:" y "Composición:"
    // (que siempre le sigue). Vacío por defecto (C&A no lo trae en esta OC).
    `Descripcion del Articulo: ${c.descripcion} ID Color: 200 Color Generico: ${c.color} ${c.color}PANTONE: ${c.pantone}`,
    `Composición: 100.0000% ALGODÓN`,
    `Monto Total Orden de Compra: ${c.monto}`,
    `Fecha de Entrega: 09/11/2026`,
    `Semana C&A: ${c.semana}`,
    `09/11/2026 - 15/11/2026Entrega en DC:`,
  ].join('\n');
}

/** Arma el texto de la página 2 (tabla SKU/Talla/Piezas) desde `[talla, piezas]`. */
function pagina2(tallas: [string, number][]): string {
  const total = tallas.reduce((s, [, n]) => s + n, 0);
  const filas = tallas.map(([t, n], i) => `${1000000 + i} ${t} ${n}`);
  return ['SKU Talla Piezas', ...filas, `Total ${total}`].join('\n');
}

describe('parseo-pdf-cya (fixture real)', () => {
  it('parsea todos los campos de la OC real de C&A y cuadra sin advertencias', async () => {
    const buffer = readFileSync(RUTA_FIXTURE);
    const r = await parsearPdfCya(buffer);

    expect(r.numeroOrden).toBe('620884');
    expect(r.modeloCliente).toBe('3138277');
    expect(r.costoUnitario).toBe(97);
    expect(r.piezasTotales).toBe(1903);
    expect(r.division).toBe('3- KIDS');
    // Sub División: en el layout real el VALOR PRECEDE a la etiqueta (fila `Sub Division: 34- NIÑO`).
    expect(r.subDivision).toBe('34- NIÑO');
    expect(r.descripcionArticulo).toBe('W26 - PLAYERA ML SINGLE JERSEY');
    expect(r.idColorCliente).toBe('200');
    expect(r.colorGenerico).toBe('BLANCO');
    // En la OC real de C&A el PANTONE viene VACÍO (`BLANCO BLANCOPANTONE: Composición:`).
    expect(r.pantone).toBe('');
    expect(r.codigoUnico).toBe('26/4/001435/200');
    expect(r.semanaCliente).toBe('202646');
    expect(r.montoTotal).toBe(184591);
    expect(r.fechaEntrega).toBe('2026-11-09'); // INICIO de la ventana "Entrega en DC"

    // Matriz de tallas (niño): 6 tallas que suman las 1,903 piezas totales.
    expect(r.tallas).toEqual([
      { sku: '5965724', talla: '5-6', piezas: 305 },
      { sku: '5965725', talla: '6-7', piezas: 126 },
      { sku: '5965726', talla: '7-8', piezas: 129 },
      { sku: '5965727', talla: '9-10', piezas: 488 },
      { sku: '5965728', talla: '11-12', piezas: 490 },
      { sku: '5965729', talla: '13-14', piezas: 365 },
    ]);
    expect(r.tallas.reduce((s, t) => s + t.piezas, 0)).toBe(1903);
    // Packs A/B/C con su DESGLOSE por talla (base del sobre-pedido por packs + módulo de empaque).
    expect(r.packs.map((p) => p.pack)).toEqual(['A', 'B', 'C']);
    const packA = r.packs[0];
    expect(packA).toMatchObject({ pack: 'A', tipo: 'PACK', unidadesPack: 12, totalPacks: 119 });
    expect(packA?.desglose).toEqual([
      { talla: '5-6', cantidad: 238 },
      { talla: '6-7', cantidad: 119 },
      { talla: '7-8', cantidad: 119 },
      { talla: '9-10', cantidad: 357 },
      { talla: '11-12', cantidad: 357 },
      { talla: '13-14', cantidad: 238 },
    ]);
    // Pack B: proporción con tallas AUSENTES (6-7, 7-8 no aparecen).
    expect(r.packs[1]).toMatchObject({ pack: 'B', tipo: 'PACK', totalPacks: 57 });
    expect(r.packs[1]?.desglose).toEqual([
      { talla: '5-6', cantidad: 57 },
      { talla: '9-10', cantidad: 114 },
      { talla: '11-12', cantidad: 114 },
      { talla: '13-14', cantidad: 114 },
    ]);
    // Pack C: piezas SUELTAS (tipo SKU).
    expect(r.packs[2]).toMatchObject({ pack: 'C', tipo: 'SKU', totalPacks: 1 });
    expect(r.packs[2]?.desglose.reduce((s, d) => s + d.cantidad, 0)).toBe(76);
    // Todo cuadra → sin advertencias.
    expect(r.advertencias).toEqual([]);
  });
});

describe('parseo-pdf-cya (texto puro)', () => {
  it('parsea una OC bien formada y no emite advertencias cuando cuadra', () => {
    const r = parsearTextoCya([
      pagina1({ numeroOrden: '999001', modeloId: '7777777', piezas: '100', monto: '5000.0000' }),
      pagina2([
        ['CH', 40],
        ['M', 60],
      ]),
    ]);
    expect(r.numeroOrden).toBe('999001');
    expect(r.modeloCliente).toBe('7777777');
    expect(r.division).toBe('3- KIDS');
    expect(r.subDivision).toBe('34- NIÑO'); // valor-antes-de-etiqueta, como en la OC real
    expect(r.colorGenerico).toBe('NEGRO');
    expect(r.tallas).toEqual([
      { sku: '1000000', talla: 'CH', piezas: 40 },
      { sku: '1000001', talla: 'M', piezas: 60 },
    ]);
    expect(r.advertencias).toEqual([]);
  });

  it('captura la Sub División (valor-antes-de-etiqueta) con su código', () => {
    const r = parsearTextoCya([pagina1({ subDivision: '12- DAMAS' }), pagina2([['CH', 100]])]);
    expect(r.subDivision).toBe('12- DAMAS');
  });

  it('resuelve un color de DOS palabras sin recortar (desduplica el espejo de PANTONE)', () => {
    const r = parsearTextoCya([pagina1({ color: 'AZUL MARINO' }), pagina2([['CH', 100]])]);
    expect(r.colorGenerico).toBe('AZUL MARINO');
  });

  it('deja el PANTONE vacío cuando la OC no lo trae (caso C&A por defecto)', () => {
    const r = parsearTextoCya([pagina1({ color: 'BLANCO' }), pagina2([['CH', 100]])]);
    expect(r.colorGenerico).toBe('BLANCO');
    expect(r.pantone).toBe('');
  });

  it('captura el código PANTONE sin comerse el color (una y dos palabras)', () => {
    const uno = parsearTextoCya([
      pagina1({ color: 'BLANCO', pantone: '11-0601 TCX' }),
      pagina2([['CH', 100]]),
    ]);
    expect(uno.colorGenerico).toBe('BLANCO');
    expect(uno.pantone).toBe('11-0601 TCX');

    const dos = parsearTextoCya([
      pagina1({ color: 'AZUL MARINO', pantone: '19-3920 TCX' }),
      pagina2([['CH', 100]]),
    ]);
    expect(dos.colorGenerico).toBe('AZUL MARINO');
    expect(dos.pantone).toBe('19-3920 TCX');
  });

  it('advierte (sin bloquear) cuando las tallas no suman las piezas totales', () => {
    const r = parsearTextoCya([
      pagina1({ piezas: '100' }),
      pagina2([['CH', 90]]), // suma 90 ≠ 100
    ]);
    expect(r.advertencias.map((a) => a.tipo)).toContain('suma-tallas');
  });

  it('advierte cuando Σ×precio no cuadra con el Monto Total', () => {
    const r = parsearTextoCya([
      pagina1({ costo: '50.0000', piezas: '100', monto: '9999.0000' }), // 100×50=5000 ≠ 9999
      pagina2([['CH', 100]]),
    ]);
    expect(r.advertencias.map((a) => a.tipo)).toContain('suma-monto');
  });

  it('advierte cuando no hay tabla de tallas', () => {
    const r = parsearTextoCya([pagina1(), 'Sin tabla de tallas aquí']);
    expect(r.tallas).toEqual([]);
    expect(r.advertencias.map((a) => a.tipo)).toEqual(['sin-tallas']);
  });

  it('rechaza un texto que no es una OC de C&A (sin Numero de Orden / Modelo ID)', () => {
    expect(() => parsearTextoCya(['Documento cualquiera sin anclas', ''])).toThrow(ErrorValidacion);
  });
});

describe('parseo-pdf-cya (archivo inválido)', () => {
  it('lanza un error claro si el archivo no es un PDF legible', async () => {
    await expect(parsearPdfCya(Buffer.from('esto no es un pdf', 'utf8'))).rejects.toThrow(
      ErrorValidacion,
    );
  });

  it('lanza un error claro si el archivo está vacío', async () => {
    await expect(parsearPdfCya(Buffer.alloc(0))).rejects.toThrow(ErrorValidacion);
  });
});
