/**
 * Tests UNIT de la DEFENSA contra la doble importación de la misma OC del cliente (V1-E4 punto 1).
 *
 * Por qué existe esta prueba: importar dos veces el mismo papel creaba EN SILENCIO un segundo
 * pedido, una segunda OP, su nº de producción, su ruta crítica y su MRP — y el error se descubría
 * semanas después, cortando doble. Es el defecto que por definición nadie nota probando a mano, así
 * que el núcleo de la decisión (`detectarDuplicadosOc`) se cementa aquí, en dominio PURO.
 *
 * La parte que toca la base (qué OC ya tienen OP viva, el candado por cliente y el aborto de la
 * transacción) se prueba en `importacion-pdf.int.test.ts` contra Postgres real.
 */
import { describe, expect, it } from 'vitest';

import { claveOcCliente, detectarDuplicadosOc, mensajeDuplicado } from './importacion-pdf.js';

/** Atajo: el mapa "esta OC ya tiene OP" tal como lo devuelve la lectura de la base. */
function yaImportadas(
  filas: { numeroOrden: string; idOrden: number; folioOrden: number }[],
): Map<string, { idOrden: number; folioOrden: number }> {
  return new Map(
    filas.map((f) => [
      claveOcCliente(f.numeroOrden),
      { idOrden: f.idOrden, folioOrden: f.folioOrden },
    ]),
  );
}

describe('claveOcCliente', () => {
  it('normaliza espacios y mayúsculas (el mismo papel escrito distinto sigue siendo el mismo)', () => {
    expect(claveOcCliente(' 620884 ')).toBe('620884');
    expect(claveOcCliente('oc-a12')).toBe('OC-A12');
    expect(claveOcCliente(null)).toBe('');
    expect(claveOcCliente(undefined)).toBe('');
    expect(claveOcCliente('   ')).toBe('');
  });
});

describe('detectarDuplicadosOc', () => {
  it('marca el PDF cuya OC YA parió una OP (el caso que costaba tela y maquila)', () => {
    const resultado = detectarDuplicadosOc(
      [{ nombreArchivo: 'OC-620884.pdf', numeroOrden: '620884' }],
      yaImportadas([{ numeroOrden: '620884', idOrden: 41, folioOrden: 1207 }]),
    );

    expect(resultado).toEqual([{ origen: 'importado', idOrden: 41, folioOrden: 1207 }]);
  });

  it('reconoce el duplicado aunque el papel venga con espacios o en minúsculas', () => {
    const resultado = detectarDuplicadosOc(
      [{ nombreArchivo: 'oc.pdf', numeroOrden: ' oc-a12 ' }],
      yaImportadas([{ numeroOrden: 'OC-A12', idOrden: 9, folioOrden: 300 }]),
    );

    expect(resultado[0]).toEqual({ origen: 'importado', idOrden: 9, folioOrden: 300 });
  });

  it('deja pasar la OC que nunca se ha importado', () => {
    const resultado = detectarDuplicadosOc(
      [{ nombreArchivo: 'nueva.pdf', numeroOrden: '999001' }],
      yaImportadas([{ numeroOrden: '620884', idOrden: 41, folioOrden: 1207 }]),
    );

    expect(resultado).toEqual([null]);
  });

  it('cacha el mismo papel subido DOS VECES en la misma tanda (la base todavía no lo tiene)', () => {
    const resultado = detectarDuplicadosOc(
      [
        { nombreArchivo: 'primero.pdf', numeroOrden: '620884' },
        { nombreArchivo: 'copia.pdf', numeroOrden: '620884' },
      ],
      new Map(),
    );

    // El PRIMERO sí se importa; el segundo se omite señalando de quién es copia.
    expect(resultado[0]).toBeNull();
    expect(resultado[1]).toEqual({ origen: 'lote', nombreArchivoPrimero: 'primero.pdf' });
  });

  it('cuando la OC está en la base Y repetida en la tanda, gana el duplicado de la BASE', () => {
    const resultado = detectarDuplicadosOc(
      [
        { nombreArchivo: 'a.pdf', numeroOrden: '620884' },
        { nombreArchivo: 'b.pdf', numeroOrden: '620884' },
      ],
      yaImportadas([{ numeroOrden: '620884', idOrden: 41, folioOrden: 1207 }]),
    );

    // Los dos apuntan a la OP que ya existe: es lo que el usuario necesita ver.
    expect(resultado[0]).toEqual({ origen: 'importado', idOrden: 41, folioOrden: 1207 });
    expect(resultado[1]).toEqual({ origen: 'importado', idOrden: 41, folioOrden: 1207 });
  });

  it('un PDF SIN nº de orden nunca es duplicado (sin identidad no hay con qué comparar)', () => {
    const resultado = detectarDuplicadosOc(
      [
        { nombreArchivo: 'ilegible-1.pdf', numeroOrden: '' },
        { nombreArchivo: 'ilegible-2.pdf', numeroOrden: '   ' },
      ],
      new Map(),
    );

    expect(resultado).toEqual([null, null]);
  });

  it('respeta el orden de los PDFs (el índice i del resultado es el PDF i)', () => {
    const resultado = detectarDuplicadosOc(
      [
        { nombreArchivo: 'nueva.pdf', numeroOrden: '111' },
        { nombreArchivo: 'vieja.pdf', numeroOrden: '222' },
        { nombreArchivo: 'otra-nueva.pdf', numeroOrden: '333' },
      ],
      yaImportadas([{ numeroOrden: '222', idOrden: 7, folioOrden: 88 }]),
    );

    expect(resultado[0]).toBeNull();
    expect(resultado[1]).toEqual({ origen: 'importado', idOrden: 7, folioOrden: 88 });
    expect(resultado[2]).toBeNull();
  });
});

describe('mensajeDuplicado', () => {
  it('dice QUÉ OP ya existe (el usuario tiene que poder ir a verla)', () => {
    const mensaje = mensajeDuplicado(
      { origen: 'importado', idOrden: 41, folioOrden: 1207 },
      '620884',
    );

    expect(mensaje).toContain('620884');
    expect(mensaje).toContain('1207');
  });

  it('para el repetido en la tanda, nombra el archivo que sí se va a importar', () => {
    const mensaje = mensajeDuplicado(
      { origen: 'lote', nombreArchivoPrimero: 'primero.pdf' },
      '620884',
    );

    expect(mensaje).toContain('primero.pdf');
    expect(mensaje).toContain('620884');
  });
});
