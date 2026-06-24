/**
 * Tests UNITARIOS (sin BD) del parsing POSICIONAL de la matriz de órdenes (F2-E5).
 *
 * Las pruebas de cadenas de talla corren contra el CATÁLOGO COMPLETO de cadenas reales extraídas
 * de `Ordenes.csv` (committeado en `__fixtures__/catalogo-tallas-real.json`, 183 cadenas, 101
 * tokens), NO una muestra. Así toda regresión en el parser se detecta sobre los datos reales sin
 * depender de la carpeta `Respaldo CLAUDE/` (gitignored, ausente en CI).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  despivotarRenglon,
  mapaColumnasTalla,
  normalizarClaveColor,
  parsearTallasOrden,
} from './tallas-orden.js';

/** Una cadena del catálogo committeado, con su parse esperado (snapshot del análisis). */
interface CadenaFixture {
  original: string;
  frecuencia: number;
  etiquetas: string[];
  separadores: number;
  ambigua: boolean;
}
interface CatalogoFixture {
  distintas: number;
  ambiguas: number;
  conDobleCurva: number;
  tokensUnicos: string[];
  cadenas: CadenaFixture[];
}

const catalogo = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../__fixtures__/catalogo-tallas-real.json', import.meta.url)),
    'utf-8',
  ),
) as CatalogoFixture;

describe('migración F2 · parser posicional de Ordenes.Tallas (catálogo COMPLETO real)', () => {
  it('reproduce el parse esperado para las 183 cadenas distintas reales', () => {
    expect(catalogo.cadenas.length).toBe(catalogo.distintas);
    for (const c of catalogo.cadenas) {
      const parsed = parsearTallasOrden(c.original);
      const etiquetas = parsed.posiciones
        .filter((p) => !p.separador && p.etiqueta !== '')
        .map((p) => p.etiqueta);
      const separadores = parsed.posiciones.filter((p) => p.separador).length;
      expect(etiquetas, `cadena "${c.original}"`).toEqual(c.etiquetas);
      expect(separadores, `separadores de "${c.original}"`).toBe(c.separadores);
      expect(parsed.ambigua, `ambigua de "${c.original}"`).toBe(c.ambigua);
    }
  });

  it('el conteo de ambiguas y de doble curva del catálogo es estable', () => {
    const ambiguas = catalogo.cadenas.filter((c) => c.ambigua).length;
    const dobleCurva = catalogo.cadenas.filter((c) => c.separadores > 0).length;
    expect(ambiguas).toBe(catalogo.ambiguas);
    expect(dobleCurva).toBe(catalogo.conDobleCurva);
  });

  it('parsea las cadenas canónicas (ancho fijo de 2, relleno con espacio)', () => {
    expect(mapaColumnasTalla('CHM G EX').porColumna).toEqual(
      new Map([
        [1, 'CH'],
        [2, 'M'],
        [3, 'G'],
        [4, 'EX'],
      ]),
    );
    expect(mapaColumnasTalla('12141618').porColumna).toEqual(
      new Map([
        [1, '12'],
        [2, '14'],
        [3, '16'],
        [4, '18'],
      ]),
    );
  });

  it('maneja DOBLE CURVA: el separador NO es talla y mantiene la alineación posicional', () => {
    // "6 1218--2 3 3X" = curva 6/12/18 (cols 1-3) + separador (col 4) + curva 2/3/3X (cols 5-7).
    const m = mapaColumnasTalla('6 1218--2 3 3X');
    expect(m.porColumna.get(1)).toBe('6');
    expect(m.porColumna.get(2)).toBe('12');
    expect(m.porColumna.get(3)).toBe('18');
    expect(m.porColumna.has(4)).toBe(false); // separador "--": NO hay talla en la col 4
    expect(m.porColumna.get(5)).toBe('2');
    expect(m.porColumna.get(6)).toBe('3');
    expect(m.porColumna.get(7)).toBe('3X');
  });

  it('reconoce los tres tipos de separador de curva ("-", "--", "- ")', () => {
    expect(parsearTallasOrden('XC--XG2X3X').posiciones.some((p) => p.separador)).toBe(true);
    expect(parsearTallasOrden('6 1218- 2 3 3X').posiciones.some((p) => p.separador)).toBe(true);
    expect(parsearTallasOrden('6 8 1012- CH').posiciones.some((p) => p.separador)).toBe(true);
  });

  it('marca AMBIGUA una cadena con padding perdido ("CHM GEX" → CH,M,GE,X)', () => {
    const p = parsearTallasOrden('CHM GEX');
    expect(p.ambigua).toBe(true);
    const etiquetas = p.posiciones.filter((x) => !x.separador).map((x) => x.etiqueta);
    expect(etiquetas).toEqual(['CH', 'M', 'GE', 'X']); // la cantidad no se pierde; la etiqueta queda a revisión
  });

  it('marca AMBIGUA una cadena de longitud impar ("G", "M G", "CHM G")', () => {
    expect(parsearTallasOrden('G').ambigua).toBe(true);
    expect(parsearTallasOrden('M G').ambigua).toBe(true);
    expect(parsearTallasOrden('CHM G').ambigua).toBe(true);
  });

  it('marca AMBIGUA cadenas con salto de línea y NO intenta alinear', () => {
    expect(parsearTallasOrden('CH\nM').ambigua).toBe(true);
    expect(parsearTallasOrden('CH\nM').posiciones).toEqual([]);
  });
});

describe('migración F2 · despivote T1..T8 (solo cantidades >0, cuadre de sumas)', () => {
  const porColumna = mapaColumnasTalla('CHM G EX').porColumna; // 1=CH 2=M 3=G 4=EX

  it('emite SOLO las columnas con cantidad >0, con su etiqueta de posición', () => {
    const celdas = despivotarRenglon([10, 0, 5, 0, 0, 0, 0, 0], porColumna);
    expect(celdas).toEqual([
      { columna: 1, cantidad: 10, etiqueta: 'CH' },
      { columna: 3, cantidad: 5, etiqueta: 'G' },
    ]);
  });

  it('la suma de las celdas despivotadas == suma de las cantidades de entrada', () => {
    const cantidades = [3, 7, 0, 12, 0, 0, 0, 0];
    const celdas = despivotarRenglon(cantidades, porColumna);
    const sumaEntrada = cantidades.reduce((a, c) => a + c, 0);
    const sumaCeldas = celdas.reduce((a, c) => a + c.cantidad, 0);
    expect(sumaCeldas).toBe(sumaEntrada);
  });

  it('una cantidad en una columna SIN etiqueta (separador) sale con etiqueta null (a reportar)', () => {
    const m = mapaColumnasTalla('6 1218--2 3 3X').porColumna; // col 4 = separador (sin etiqueta)
    const celdas = despivotarRenglon([0, 0, 0, 9, 0, 0, 0, 0], m);
    expect(celdas).toEqual([{ columna: 4, cantidad: 9, etiqueta: null }]);
  });

  it('cantidades faltantes/0/negativas no emiten fila', () => {
    expect(despivotarRenglon([], porColumna)).toEqual([]);
    expect(despivotarRenglon([0, 0, 0, 0, 0, 0, 0, 0], porColumna)).toEqual([]);
    expect(despivotarRenglon([-1, 0, 0, 0, 0, 0, 0, 0], porColumna)).toEqual([]);
  });
});

describe('migración F2 · normalización de color (CP850, acentos)', () => {
  it('quita acentos, baja a minúsculas y colapsa espacios', () => {
    expect(normalizarClaveColor('  Algodón  Café ')).toBe('algodon cafe');
    expect(normalizarClaveColor('NEGRO')).toBe('negro');
    expect(normalizarClaveColor('Marrón')).toBe('marron');
    // Mismo color escrito distinto debe normalizar igual (la ñ de CP850 ya llega como Unicode).
    expect(normalizarClaveColor('Niño')).toBe(normalizarClaveColor('NIÑO'));
  });

  it('vacío/null/undefined → cadena vacía', () => {
    expect(normalizarClaveColor('')).toBe('');
    expect(normalizarClaveColor(null)).toBe('');
    expect(normalizarClaveColor(undefined)).toBe('');
    expect(normalizarClaveColor('   ')).toBe('');
  });
});
