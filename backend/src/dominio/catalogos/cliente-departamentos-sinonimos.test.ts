import { describe, expect, it, vi } from 'vitest';

import type { ContextoBd, Tx } from '../../comun/transaccion.js';

import { sinonimosDeDepartamentos } from './cliente-departamentos-sinonimos.js';

/**
 * ⭐⭐ Unit de LOS DOS NOMBRES (§Post-F9.172(a)) — SIN Postgres, contra una tabla FALSA en memoria
 * que sí ejecuta el recorrido de verdad (semilla por nombre + saltos por `idFusionadoEn`).
 *
 * 🔴 **Lo que estas pruebas existen para atrapar, y que pasaría en verde sin ellas:** cubrir UN
 * sentido de la fusión y no el otro. Buscar el DESTINO tiene que encontrar el ORIGEN («Caballeros» →
 * las órdenes que dicen «2-HOMBRE») **y buscar el ORIGEN tiene que encontrar el DESTINO**, porque
 * quien tiene el papel viejo en la mano busca por el nombre viejo. Por eso son pruebas SEPARADAS:
 * una sola que las mezclara no podría caer por separado y taparía justo la mitad que falta.
 *
 * ⚠️ **Y la trampa del fixture:** si el departamento sembrado no estuviera REALMENTE fusionado
 * (`idFusionadoEn` en null), estas pruebas pasarían sin tocar el defecto. Contra eso está la batería
 * «sin fusión»: mismos nombres, mismo texto buscado, `idFusionadoEn` nulo ⇒ resultado VACÍO. Si esa
 * prueba y las de arriba dieran lo mismo, el fixture estaría mintiendo.
 */

/** Fila del catálogo tal como la lee el resolver. */
interface FilaDepartamento {
  id: number;
  nombre: string;
  idFusionadoEn: number | null;
}

/** Los únicos `where` que el resolver puede emitir; cualquier otro revienta a propósito (ver abajo). */
interface WhereFalso {
  OR?: WhereFalso[];
  nombre?: { contains?: string; mode?: string };
  id?: { in?: number[] };
  idFusionadoEn?: { in?: number[] };
}

function casa(fila: FilaDepartamento, where: WhereFalso): boolean {
  if (where.OR !== undefined) {
    return where.OR.some((w) => casa(fila, w));
  }
  if (where.nombre?.contains !== undefined) {
    const texto = where.nombre.contains;
    return where.nombre.mode === 'insensitive'
      ? fila.nombre.toLocaleLowerCase().includes(texto.toLocaleLowerCase())
      : fila.nombre.includes(texto);
  }
  if (where.id?.in !== undefined) {
    return where.id.in.includes(fila.id);
  }
  if (where.idFusionadoEn?.in !== undefined) {
    return fila.idFusionadoEn !== null && where.idFusionadoEn.in.includes(fila.idFusionadoEn);
  }
  // 🔴 A PROPÓSITO: si el resolver cambia la forma de su consulta, esta prueba REVIENTA en vez de
  // devolver vacío en silencio y quedarse verde sin haber verificado nada.
  throw new Error(`where no soportado por la tabla falsa: ${JSON.stringify(where)}`);
}

/** Catálogo falso en memoria + el contador de viajes a la base (para el gate de rendimiento). */
function catalogo(filas: FilaDepartamento[]) {
  const findMany = vi.fn((args: { where: WhereFalso }) =>
    Promise.resolve(filas.filter((f) => casa(f, args.where)).map((f) => ({ ...f }))),
  );
  const bd: ContextoBd = { tx: { clienteDepartamento: { findMany } } as unknown as Tx };
  return { bd, findMany };
}

/**
 * El caso de Daniel, REALMENTE fusionado: «2-HOMBRE» absorbido por «Caballeros». El
 * `idFusionadoEn: 1` es lo único que distingue esto de un departamento apagado a mano.
 */
const caballerosConSuSinonimo: FilaDepartamento[] = [
  { id: 1, nombre: 'Caballeros', idFusionadoEn: null },
  { id: 2, nombre: '2-HOMBRE', idFusionadoEn: 1 },
  { id: 9, nombre: 'NIÑOS', idFusionadoEn: null },
];

describe('sinónimos de departamento — DESTINO → ORIGEN (el caso que originó la decisión)', () => {
  it('buscar «Caballeros» devuelve «2-HOMBRE», el nombre que dice el papel del cliente', async () => {
    const { bd } = catalogo(caballerosConSuSinonimo);
    expect(await sinonimosDeDepartamentos('Caballeros', bd)).toEqual(['2-HOMBRE']);
  });

  it('no arrastra departamentos ajenos a la fusión', async () => {
    const { bd } = catalogo(caballerosConSuSinonimo);
    expect(await sinonimosDeDepartamentos('Caballeros', bd)).not.toContain('NIÑOS');
  });
});

describe('sinónimos de departamento — ORIGEN → DESTINO (la rama gemela, la que se olvida)', () => {
  it('buscar «2-HOMBRE» devuelve «Caballeros» (quien tiene el papel viejo busca por el nombre viejo)', async () => {
    const { bd } = catalogo(caballerosConSuSinonimo);
    expect(await sinonimosDeDepartamentos('2-HOMBRE', bd)).toEqual(['Caballeros']);
  });
});

describe('sinónimos de departamento — la CADENA de dos saltos (A→B→C)', () => {
  /**
   * «2-HOMBRE» se fue a «VARONIL» y después «VARONIL» se fue a «Caballeros»: los tres son el mismo.
   * ⚠️ Los tres nombres son AJENOS entre sí a propósito (ninguno es subcadena de otro): si se
   * parecieran —«DAMA» dentro de «Damas»—, el `contains` de siempre ya alcanzaría a uno y la prueba
   * mediría el filtro de redundancia en vez de los saltos de la cadena.
   */
  const cadena: FilaDepartamento[] = [
    { id: 1, nombre: '2-HOMBRE', idFusionadoEn: 2 },
    { id: 2, nombre: 'VARONIL', idFusionadoEn: 3 },
    { id: 3, nombre: 'Caballeros', idFusionadoEn: null },
  ];

  it('desde la punta CANÓNICA baja los dos eslabones', async () => {
    const { bd } = catalogo(cadena);
    expect((await sinonimosDeDepartamentos('Caballeros', bd)).sort()).toEqual([
      '2-HOMBRE',
      'VARONIL',
    ]);
  });

  it('desde la punta ABSORBIDA sube los dos eslabones', async () => {
    const { bd } = catalogo(cadena);
    expect((await sinonimosDeDepartamentos('2-HOMBRE', bd)).sort()).toEqual([
      'Caballeros',
      'VARONIL',
    ]);
  });

  it('desde EN MEDIO alcanza para arriba y para abajo a la vez', async () => {
    const { bd } = catalogo(cadena);
    expect((await sinonimosDeDepartamentos('VARONIL', bd)).sort()).toEqual([
      '2-HOMBRE',
      'Caballeros',
    ]);
  });

  it('los HERMANOS también son sinónimos (dos absorbidos por el mismo canónico)', async () => {
    const { bd } = catalogo([
      { id: 1, nombre: 'Caballeros', idFusionadoEn: null },
      { id: 2, nombre: '2-HOMBRE', idFusionadoEn: 1 },
      { id: 3, nombre: 'VARONIL', idFusionadoEn: 1 },
    ]);
    expect((await sinonimosDeDepartamentos('2-HOMBRE', bd)).sort()).toEqual([
      'Caballeros',
      'VARONIL',
    ]);
  });
});

describe('sinónimos de departamento — cuando NO hay rastro (REGLA 0-B: funciona sin el dato)', () => {
  it('⭐ los MISMOS nombres SIN fusionar no son sinónimos de nada', async () => {
    const { bd } = catalogo([
      { id: 1, nombre: 'Caballeros', idFusionadoEn: null },
      { id: 2, nombre: '2-HOMBRE', idFusionadoEn: null },
    ]);
    expect(await sinonimosDeDepartamentos('Caballeros', bd)).toEqual([]);
  });

  it('un texto que no casa con ningún departamento se resuelve en UN solo viaje', async () => {
    const { bd, findMany } = catalogo(caballerosConSuSinonimo);
    expect(await sinonimosDeDepartamentos('MONARCH-778', bd)).toEqual([]);
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it('búsqueda vacía o en blanco no toca la base', async () => {
    const { bd, findMany } = catalogo(caballerosConSuSinonimo);
    expect(await sinonimosDeDepartamentos('', bd)).toEqual([]);
    expect(await sinonimosDeDepartamentos('   ', bd)).toEqual([]);
    expect(await sinonimosDeDepartamentos(undefined, bd)).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });
});

describe('sinónimos de departamento — lo que NO devuelve', () => {
  it('omite los nombres que el `contains` de siempre ya encuentra (no engorda el OR)', async () => {
    // «HOMBRE» casa por texto con los dos, y además están fusionados: no hay nada que sumar.
    const { bd } = catalogo([
      { id: 1, nombre: 'HOMBRE', idFusionadoEn: null },
      { id: 2, nombre: '2-HOMBRE', idFusionadoEn: 1 },
    ]);
    expect(await sinonimosDeDepartamentos('hombre', bd)).toEqual([]);
  });

  it('la semilla es insensible a mayúsculas (el usuario no teclea el catálogo al pie de la letra)', async () => {
    const { bd } = catalogo(caballerosConSuSinonimo);
    expect(await sinonimosDeDepartamentos('caBALLeros', bd)).toEqual(['2-HOMBRE']);
  });

  it('recorta el nombre y no devuelve repetidos', async () => {
    const { bd } = catalogo([
      { id: 1, nombre: 'Caballeros', idFusionadoEn: null },
      { id: 2, nombre: '  2-HOMBRE  ', idFusionadoEn: 1 },
      { id: 3, nombre: '2-HOMBRE', idFusionadoEn: 1 },
    ]);
    expect(await sinonimosDeDepartamentos('Caballeros', bd)).toEqual(['2-HOMBRE']);
  });
});

describe('sinónimos de departamento — rendimiento y paracaídas', () => {
  it('⭐ resuelve el conjunto UNA vez: los viajes salen por NIVEL de la cadena, no por fila', async () => {
    // 40 absorbidos por el mismo canónico: si el recorrido fuera por fila serían decenas de viajes.
    const filas: FilaDepartamento[] = [{ id: 1, nombre: 'Caballeros', idFusionadoEn: null }];
    for (let i = 2; i <= 41; i++) {
      filas.push({ id: i, nombre: `SINONIMO-${String(i)}`, idFusionadoEn: 1 });
    }
    const { bd, findMany } = catalogo(filas);
    expect(await sinonimosDeDepartamentos('Caballeros', bd)).toHaveLength(40);
    // 1 semilla + 1 nivel que baja a los 40 + 1 nivel que no encuentra nada nuevo.
    expect(findMany.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it('⭐ un ANILLO sembrado a mano no cuelga ni repite (el tope de niveles es el paracaídas)', async () => {
    // El dominio no puede crear esto (la fusión limpia el rastro del canónico y reactivar lo borra),
    // pero si un dato viejo lo dejara, el recorrido tiene que terminar.
    const { bd } = catalogo([
      { id: 1, nombre: 'A', idFusionadoEn: 2 },
      { id: 2, nombre: 'B', idFusionadoEn: 3 },
      { id: 3, nombre: 'C', idFusionadoEn: 1 },
    ]);
    expect((await sinonimosDeDepartamentos('A', bd)).sort()).toEqual(['B', 'C']);
  });
});
