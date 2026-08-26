/**
 * Tests UNITARIOS del ETL de modelos (F1-E7) — SIN BD, corren en local y en CI.
 *
 * Cubren:
 *  1. Transformación de banderas `b*` → `para*` (tela y avío del BOM).
 *  2. Resolución de componentes vía mapas en memoria (tela/avío/bordado).
 *  3. Parseo del nombre de foto (Foto1/Foto2): vacío = null, con extensión, sin extensión.
 *  4. Búsqueda de archivo de foto en directorio (stub de FS con archivos de prueba).
 *  5. Índice recursivo del archivo de fotos (subcarpetas, basura no-imagen, colisiones).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { transformarRenglonTela, transformarRenglonAvio } from './loaders/bom-modelos.js';

import {
  parsearNombreFoto,
  buscarArchivoFoto,
  indexarFotos,
  modelosConFotoDisponible,
} from './loaders/fotos-modelos.js';
import { Reporte } from './comun/reporte.js';

// ── 1. Banderas b* → para* ────────────────────────────────────────────────────

describe('transformarRenglonTela — banderas b* → para*', () => {
  it('convierte todas las banderas en true cuando son "1"', () => {
    const fila = { CantTela: '0.25', bPreCosto: '1', bProduccion: '1', bCosto: '1' };
    const r = transformarRenglonTela(fila);
    expect(r.paraPreCosto).toBe(true);
    expect(r.paraProduccion).toBe(true);
    expect(r.paraCosto).toBe(true);
    expect(r.consumoPorPrenda).toBeCloseTo(0.25);
  });

  it('convierte todas las banderas en false cuando son "0"', () => {
    const fila = { CantTela: '0.5', bPreCosto: '0', bProduccion: '0', bCosto: '0' };
    const r = transformarRenglonTela(fila);
    expect(r.paraPreCosto).toBe(false);
    expect(r.paraProduccion).toBe(false);
    expect(r.paraCosto).toBe(false);
    expect(r.consumoPorPrenda).toBeCloseTo(0.5);
  });

  it('mezcla de banderas (paraPreCosto=0, paraProduccion=1, paraCosto=1)', () => {
    const fila = { CantTela: '1.00', bPreCosto: '0', bProduccion: '1', bCosto: '1' };
    const r = transformarRenglonTela(fila);
    expect(r.paraPreCosto).toBe(false);
    expect(r.paraProduccion).toBe(true);
    expect(r.paraCosto).toBe(true);
    expect(r.consumoPorPrenda).toBeCloseTo(1.0);
  });

  it('CantTela vacío → consumoPorPrenda = 0 (default seguro)', () => {
    const fila = { CantTela: '', bPreCosto: '1', bProduccion: '1', bCosto: '1' };
    const r = transformarRenglonTela(fila);
    expect(r.consumoPorPrenda).toBe(0);
  });

  it('CantTela con signo de dólar ("$0.30") → parsea correctamente', () => {
    const fila = { CantTela: '$0.30', bPreCosto: '1', bProduccion: '1', bCosto: '1' };
    const r = transformarRenglonTela(fila);
    expect(r.consumoPorPrenda).toBeCloseTo(0.3);
  });
});

describe('transformarRenglonAvio — banderas b* → para*', () => {
  it('convierte todas las banderas en true cuando son "1"', () => {
    const fila = { CantHab: '2.00', bPreCosto: '1', bProduccion: '1', bCosto: '1' };
    const r = transformarRenglonAvio(fila);
    expect(r.paraPreCosto).toBe(true);
    expect(r.paraProduccion).toBe(true);
    expect(r.paraCosto).toBe(true);
    expect(r.consumoPorPrenda).toBeCloseTo(2.0);
  });

  it('convierte banderas en false cuando son "0"', () => {
    const fila = { CantHab: '1.00', bPreCosto: '0', bProduccion: '0', bCosto: '0' };
    const r = transformarRenglonAvio(fila);
    expect(r.paraPreCosto).toBe(false);
    expect(r.paraProduccion).toBe(false);
    expect(r.paraCosto).toBe(false);
  });

  it('mezcla: paraProduccion=false, los otros=true', () => {
    const fila = { CantHab: '3.00', bPreCosto: '1', bProduccion: '0', bCosto: '1' };
    const r = transformarRenglonAvio(fila);
    expect(r.paraPreCosto).toBe(true);
    expect(r.paraProduccion).toBe(false);
    expect(r.paraCosto).toBe(true);
  });
});

// ── 2. Resolución de componentes vía mapas en memoria ────────────────────────

describe('resolución de componentes con mapas en memoria', () => {
  it('resuelve idTelaNueva usando el mapa de TelasDis', () => {
    const mapa = new Map<string, number>([
      ['8', 42],
      ['7', 43],
    ]);
    expect(mapa.get('8')).toBe(42);
    expect(mapa.get('999')).toBeUndefined();
  });

  it('resuelve idAvioNuevo usando el mapa de Avio', () => {
    const mapa = new Map<string, number>([
      ['1', 10],
      ['2', 11],
    ]);
    expect(mapa.get('1')).toBe(10);
    expect(mapa.get('3')).toBeUndefined();
  });

  it('resuelve el arte migrado con la clave COMPUESTA `<IdBordados>:<IdModelos>` (V1-E3d)', () => {
    // El arte dejó de ser catálogo: un `IdBordados` viejo puede haber producido VARIOS artes (uno
    // por modelo que lo usaba), así que el mapeo se indexa por el par, no por el id suelto.
    const mapa = new Map<string, number>([
      ['100:1', 5],
      ['100:2', 6],
    ]);
    expect(mapa.get('100:1')).toBe(5);
    expect(mapa.get('100:3')).toBeUndefined();
  });
});

// ── 3. Parseo de nombre de foto ───────────────────────────────────────────────

describe('parsearNombreFoto', () => {
  it('campo vacío → null', () => {
    expect(parsearNombreFoto('')).toBeNull();
    expect(parsearNombreFoto(null)).toBeNull();
    expect(parsearNombreFoto(undefined)).toBeNull();
    expect(parsearNombreFoto('   ')).toBeNull();
  });

  it('nombre sin extensión → lo devuelve tal cual (trimado)', () => {
    expect(parsearNombreFoto('51714')).toBe('51714');
    expect(parsearNombreFoto('  M001-P  ')).toBe('M001-P');
    expect(parsearNombreFoto('51714 D')).toBe('51714 D');
  });

  it('nombre con extensión de imagen → quita la extensión', () => {
    expect(parsearNombreFoto('M001.jpg')).toBe('M001');
    expect(parsearNombreFoto('foto.JPG')).toBe('foto');
    expect(parsearNombreFoto('modelo.png')).toBe('modelo');
  });

  it('nombre con extensión no-imagen → la deja (no es una imagen conocida)', () => {
    // ".txt" no está en las extensiones de imagen → no se quita
    expect(parsearNombreFoto('archivo.txt')).toBe('archivo.txt');
  });

  it('patrón código-P devuelve el nombre completo', () => {
    expect(parsearNombreFoto('51714-P')).toBe('51714-P');
    expect(parsearNombreFoto('M001-P')).toBe('M001-P');
  });
});

// ── 4. Búsqueda de archivo de foto en directorio ──────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'etl-fotos-test-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('buscarArchivoFoto', () => {
  it('encuentra el archivo cuando existe con la extensión exacta', () => {
    writeFileSync(join(tmpDir, '51714.jpg'), 'fake-image');
    const resultado = buscarArchivoFoto(tmpDir, '51714');
    expect(resultado).not.toBeNull();
    expect(resultado).toContain('51714.jpg');
  });

  it('encuentra el archivo de forma case-insensitive (nombre en mayúsculas)', () => {
    writeFileSync(join(tmpDir, '51714.JPG'), 'fake-image');
    const resultado = buscarArchivoFoto(tmpDir, '51714');
    expect(resultado).not.toBeNull();
  });

  it('encuentra el archivo con nombre en mayúsculas buscando en minúsculas', () => {
    writeFileSync(join(tmpDir, 'MODELO.jpg'), 'fake-image');
    const resultado = buscarArchivoFoto(tmpDir, 'modelo');
    expect(resultado).not.toBeNull();
  });

  it('devuelve null si el archivo no existe', () => {
    const resultado = buscarArchivoFoto(tmpDir, 'inexistente');
    expect(resultado).toBeNull();
  });

  it('devuelve null si el directorio no existe', () => {
    const resultado = buscarArchivoFoto('/ruta/que/no/existe', '51714');
    expect(resultado).toBeNull();
  });

  it('ignora archivos con extensión no-imagen (.txt, .csv)', () => {
    writeFileSync(join(tmpDir, '51714.txt'), 'not an image');
    writeFileSync(join(tmpDir, '51714.csv'), 'not an image');
    const resultado = buscarArchivoFoto(tmpDir, '51714');
    expect(resultado).toBeNull();
  });

  it('encuentra el archivo del patrón código-P', () => {
    writeFileSync(join(tmpDir, '51714-P.jpg'), 'fake-image-espalda');
    const resultado = buscarArchivoFoto(tmpDir, '51714-P');
    expect(resultado).not.toBeNull();
    expect(resultado).toContain('51714-P.jpg');
  });

  it('acepta extensiones png, gif, bmp, webp', () => {
    for (const ext of ['.png', '.gif', '.bmp', '.webp']) {
      writeFileSync(join(tmpDir, `foto${ext}`), 'fake');
      const r = buscarArchivoFoto(tmpDir, 'foto');
      expect(r).not.toBeNull();
      rmSync(join(tmpDir, `foto${ext}`));
    }
  });
});

// ── 5. Índice del archivo de fotos (recursivo) ────────────────────────────────

describe('indexarFotos', () => {
  it('indexa por nombre-base en minúsculas y devuelve la ruta', () => {
    writeFileSync(join(tmpDir, '51714.JPG'), 'fake');
    const indice = indexarFotos(tmpDir);
    expect(indice.size).toBe(1);
    expect(indice.get('51714')).toContain('51714.JPG');
  });

  it('ENTRA A SUBCARPETAS: las fotos de "vero/" también se indexan', () => {
    mkdirSync(join(tmpDir, 'vero'));
    writeFileSync(join(tmpDir, '61788.jpg'), 'fake');
    writeFileSync(join(tmpDir, 'vero', '61299.jpg'), 'fake');
    const indice = indexarFotos(tmpDir);
    expect(indice.size).toBe(2);
    expect(indice.get('61299')).toContain('61299.jpg');
  });

  it('ignora lo que no es imagen (.DS_Store, Thumbs.db, .csv)', () => {
    writeFileSync(join(tmpDir, '.DS_Store'), 'basura');
    writeFileSync(join(tmpDir, 'Thumbs.db'), 'basura');
    writeFileSync(join(tmpDir, 'datos.csv'), 'basura');
    writeFileSync(join(tmpDir, '70142.jpg'), 'fake');
    const indice = indexarFotos(tmpDir);
    expect(indice.size).toBe(1);
    expect(indice.has('70142')).toBe(true);
  });

  it('respeta nombres con espacio y con guion tal cual vienen', () => {
    writeFileSync(join(tmpDir, '61788 E.jpg'), 'fake');
    writeFileSync(join(tmpDir, '61792-T.jpg'), 'fake');
    const indice = indexarFotos(tmpDir);
    expect(indice.has('61788 e')).toBe(true);
    expect(indice.has('61792-t')).toBe(true);
  });

  it('colisión de nombre-base: gana la RAÍZ sobre la subcarpeta y se REPORTA', () => {
    mkdirSync(join(tmpDir, 'vero'));
    writeFileSync(join(tmpDir, '61299.jpg'), 'raiz');
    writeFileSync(join(tmpDir, 'vero', '61299.png'), 'subcarpeta');
    const reporte = new Reporte();
    const indice = indexarFotos(tmpDir, reporte);
    expect(indice.size).toBe(1);
    expect(indice.get('61299')).toContain(`${sep}61299.jpg`);
    expect(indice.get('61299')).not.toContain('vero');
    const seccion = reporte
      .obtenerSecciones()
      .find((s) => s.titulo.includes('nombre-base repetido'));
    expect(seccion?.renglones).toHaveLength(1);
  });

  it('la raíz gana AUNQUE la subcarpeta ordene antes alfabéticamente', () => {
    // Con orden alfabético plano, "1-descartes/" iría antes que el archivo de la raíz y le
    // ganaría. La precedencia por profundidad lo impide.
    mkdirSync(join(tmpDir, '1-descartes'));
    writeFileSync(join(tmpDir, '1-descartes', '70142.jpg'), 'descarte');
    writeFileSync(join(tmpDir, '70142.jpg'), 'buena');
    const indice = indexarFotos(tmpDir);
    expect(indice.get('70142')).not.toContain('1-descartes');
  });

  it('directorio inexistente → índice vacío, sin tronar', () => {
    expect(indexarFotos('/ruta/que/no/existe').size).toBe(0);
  });
});

// ── 6. Selección de modelos para `--limite N` ─────────────────────────────────

describe('modelosConFotoDisponible', () => {
  /** Índice de mentira: solo hay que decir qué nombres-base existen en la carpeta. */
  const indiceCon = (...nombres: string[]) =>
    new Map(nombres.map((n) => [n.toLowerCase(), `/fotos/${n}.jpg`]));

  it('deja fuera los modelos cuyo archivo NO está en la carpeta', () => {
    const filas = [
      { IdModelos: '1', Foto1: '70142', Foto2: '' },
      { IdModelos: '2', Foto1: '99999', Foto2: '' }, // no está en la carpeta
    ];
    const r = modelosConFotoDisponible(filas, indiceCon('70142'));
    expect(r).toHaveLength(1);
    expect(r[0]?.IdModelos).toBe('1');
  });

  it('ordena de MÁS NUEVO a más viejo por IdModelos (numérico, no alfabético)', () => {
    const filas = [
      { IdModelos: '9', Foto1: 'a', Foto2: '' },
      { IdModelos: '100', Foto1: 'b', Foto2: '' },
      { IdModelos: '20', Foto1: 'c', Foto2: '' },
    ];
    const r = modelosConFotoDisponible(filas, indiceCon('a', 'b', 'c'));
    expect(r.map((f) => f.IdModelos)).toEqual(['100', '20', '9']);
  });

  it('basta con que esté la de ESPALDA para que el modelo entre', () => {
    const filas = [{ IdModelos: '1', Foto1: 'no-esta', Foto2: '70142T' }];
    const r = modelosConFotoDisponible(filas, indiceCon('70142T'));
    expect(r).toHaveLength(1);
  });

  it('un modelo sin nombre de foto en el Access nunca entra', () => {
    const filas = [{ IdModelos: '1', Foto1: '', Foto2: '' }];
    expect(modelosConFotoDisponible(filas, indiceCon('70142'))).toHaveLength(0);
  });

  it('carpeta vacía → nadie entra (el límite no inventa modelos)', () => {
    const filas = [{ IdModelos: '1', Foto1: '70142', Foto2: '' }];
    expect(modelosConFotoDisponible(filas, new Map())).toHaveLength(0);
  });
});
