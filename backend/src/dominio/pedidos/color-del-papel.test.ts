/**
 * El desvío por FUSIÓN que la vista previa tiene que gritar, probado contra un catálogo de colores
 * FALSO en memoria (sin Postgres, en milisegundos — así se puede mutar el código y ver ponerse rojo
 * lo que debe).
 *
 * La invariante: **la previa dice el MISMO color en el que va a acabar la OP que el confirm**. El
 * caso que costaba dinero es el color ABSORBIDO por una fusión — la OP nace en otro color, con otro
 * nombre, y el precio se casa POR NOMBRE.
 *
 * ⚠️ **LAS DOS RAMAS SE PRUEBAN APARTE Y NO SE TAPAN.** "Inactivo" y "fusionado" NO son lo mismo: un
 * color puede estar apagado porque su dueño lo apagó, sin que ninguna fusión se lo haya llevado. Ese
 * caso NO es un desvío y NO debe avisar; si el fixture del caso grave naciera activo —o si el del
 * caso benigno no naciera apagado— las dos pruebas pasarían por la razón equivocada.
 *
 * El fake imita a Postgres en los dos detalles de los que depende el resultado: honra `select`
 * (devuelve SÓLO los campos pedidos, así que quitar un campo del `select` del código se nota) y
 * honra `mode: 'insensitive'` (sin él compara distinguiendo mayúsculas, como haría la base).
 */
import { describe, expect, it, vi } from 'vitest';

import type { Tx } from '../../comun/transaccion.js';

import {
  claveColor,
  marcarColorDelPapel,
  mensajeColorFusionado,
  resolverColoresDelPapel,
  type ResolucionColorPapel,
} from './color-del-papel.js';

/** Una fila del catálogo falso: las cuatro columnas de las que depende la resolución. */
interface ColorFake {
  id: number;
  nombre: string;
  activo: boolean;
  idFusionadoEn: number | null;
}

/** Argumentos que el código bajo prueba le pasa al cliente de Prisma. */
interface ArgsFindMany {
  where: { nombre: { in: string[]; mode?: 'insensitive' } };
  select?: Partial<Record<keyof ColorFake, boolean>>;
}
interface ArgsFindUnique {
  where: { id: number };
  select?: Partial<Record<keyof ColorFake, boolean>>;
}

/**
 * Catálogo en memoria expuesto como el `color` de un `tx` de Prisma, con SÓLO las dos operaciones
 * que el resolvedor usa. `orden` guarda las filas tal como "las devuelve la base": los tests que
 * dependen del desempate las siembran a propósito en el orden CONTRARIO al esperado.
 */
function catalogo(filas: ColorFake[]) {
  const datos = filas.map((f) => ({ ...f }));

  /** Devuelve sólo los campos pedidos en `select` (como Prisma). Sin `select`, la fila entera. */
  const proyectar = (
    fila: ColorFake,
    select?: Partial<Record<keyof ColorFake, boolean>>,
  ): Partial<ColorFake> => {
    if (select === undefined) return { ...fila };
    const salida: Partial<ColorFake> = {};
    for (const campo of Object.keys(select) as (keyof ColorFake)[]) {
      if (select[campo] === true) {
        Object.assign(salida, { [campo]: fila[campo] });
      }
    }
    return salida;
  };

  const findMany = vi.fn((args: ArgsFindMany) => {
    const insensible = args.where.nombre.mode === 'insensitive';
    const buscados = args.where.nombre.in.map((n) => (insensible ? n.toLowerCase() : n));
    return Promise.resolve(
      datos
        .filter((f) => buscados.includes(insensible ? f.nombre.toLowerCase() : f.nombre))
        .map((f) => proyectar(f, args.select)),
    );
  });

  const findUnique = vi.fn((args: ArgsFindUnique) => {
    const fila = datos.find((f) => f.id === args.where.id);
    return Promise.resolve(fila === undefined ? null : proyectar(fila, args.select));
  });

  const bd = { color: { findMany, findUnique } } as unknown as Pick<Tx, 'color'>;
  return { bd, findMany, findUnique };
}

/** Atajo: resuelve un solo nombre y devuelve su resolución (o `undefined` si no salió). */
async function resolverUno(
  filas: ColorFake[],
  nombre: string,
): Promise<ResolucionColorPapel | undefined> {
  const { bd } = catalogo(filas);
  const mapa = await resolverColoresDelPapel(bd, [nombre]);
  return mapa.get(claveColor(nombre));
}

/** El mundo de siempre: "Blanco" absorbido por "Blanco Optico" (que sigue vivo). */
const ABSORBIDO: ColorFake = { id: 7, nombre: 'Blanco', activo: false, idFusionadoEn: 9 };
const CANONICO: ColorFake = { id: 9, nombre: 'Blanco Optico', activo: true, idFusionadoEn: null };

describe('claveColor', () => {
  it('iguala el mismo color escrito distinto (espacios de más, mayúsculas)', () => {
    expect(claveColor('  NEGRO   AZUL ')).toBe('negro azul');
    expect(claveColor('Negro Azul')).toBe(claveColor('NEGRO AZUL'));
  });
});

describe('resolverColoresDelPapel', () => {
  it('un color que el catálogo no tiene sale como NUEVO (se creará al confirmar)', async () => {
    expect(await resolverUno([CANONICO], 'Verde Bandera')).toEqual({ estado: 'nuevo' });
  });

  it('un color ACTIVO del catálogo sale como EXISTE: la OP se queda en él, sin desvío', async () => {
    const resolucion = await resolverUno([CANONICO], 'Blanco Optico');
    expect(resolucion).toEqual({ estado: 'existe', id: 9 });
  });

  it('🔴 un color ABSORBIDO por una fusión sale como FUSIONADO, con el NOMBRE del canónico', async () => {
    // Este es el caso que se importaba en silencio: el papel dice "Blanco", la OP nace "Blanco
    // Optico", y el precio —que casa por NOMBRE— puede salir de otro renglón.
    const resolucion = await resolverUno([ABSORBIDO, CANONICO], 'Blanco');
    expect(resolucion).toEqual({
      estado: 'fusionado',
      id: 7,
      canonico: { id: 9, nombre: 'Blanco Optico' },
    });
  });

  it('⚠️ la RAMA GEMELA: un color apagado A MANO (sin fusión) NO es un desvío', async () => {
    // Mismo color apagado, pero SIN rastro: nadie se lo llevó. Al confirmar se reactiva y la OP se
    // queda en ÉL — mismo id, mismo nombre, mismo precio. Avisar aquí sería ruido.
    const apagado: ColorFake = { id: 7, nombre: 'Blanco', activo: false, idFusionadoEn: null };
    const resolucion = await resolverUno([apagado, CANONICO], 'Blanco');
    expect(resolucion).toEqual({ estado: 'existe', id: 7 });
    // Y en NEGATIVO, que es donde se cae una prueba que confunde "inactivo" con "fusionado":
    expect(resolucion?.estado).not.toBe('fusionado');
  });

  it('el desvío se decide por el RASTRO, no por estar apagado: un fusionado y un apagado a mano juntos salen distinto', async () => {
    // Las dos ramas EN LA MISMA corrida: si el código mirara `activo` en vez de `idFusionadoEn`,
    // los dos saldrían iguales y esta prueba lo cacha.
    const apagadoAMano: ColorFake = { id: 3, nombre: 'Rojo', activo: false, idFusionadoEn: null };
    const { bd } = catalogo([ABSORBIDO, CANONICO, apagadoAMano]);
    const mapa = await resolverColoresDelPapel(bd, ['Blanco', 'Rojo']);
    expect(mapa.get('blanco')?.estado).toBe('fusionado');
    expect(mapa.get('rojo')?.estado).toBe('existe');
  });

  it('sigue la CADENA completa de fusiones hasta el color que de verdad quedó vivo', async () => {
    // "Blanco A" → "Blanco" → "Blanco Optico". La OP tiene que acabar en el último.
    const eslabon: ColorFake = { id: 4, nombre: 'Blanco A', activo: false, idFusionadoEn: 7 };
    const resolucion = await resolverUno([eslabon, ABSORBIDO, CANONICO], 'Blanco A');
    expect(resolucion).toEqual({
      estado: 'fusionado',
      id: 4,
      canonico: { id: 9, nombre: 'Blanco Optico' },
    });
  });

  it('reconoce el color aunque el papel lo traiga en otras mayúsculas o con espacios de más', async () => {
    // El papel de C&A no viene normalizado; el confirm compara insensible a mayúsculas y esta
    // previa tiene que decir lo mismo (si no, marcaría "nuevo" un color que sí existe).
    const resolucion = await resolverUno([ABSORBIDO, CANONICO], '  blanco  ');
    expect(resolucion).toMatchObject({
      estado: 'fusionado',
      canonico: { nombre: 'Blanco Optico' },
    });
  });

  it('con dos variantes de mayúsculas del mismo nombre gana la de id MENOR, igual que el confirm', async () => {
    // El confirm resuelve con `orderBy: { id: 'asc' }`, y desde V1-E8s esa elección decide entre
    // REDIRIGIR y REUSAR. Las filas se siembran al revés a propósito: si el resolvedor se quedara
    // con "la primera que devuelva la base", diría 'existe' y la previa mentiría.
    const mayusculas: ColorFake = { id: 2, nombre: 'BLANCO', activo: false, idFusionadoEn: 9 };
    const capitalizado: ColorFake = { id: 5, nombre: 'Blanco', activo: true, idFusionadoEn: null };
    const resolucion = await resolverUno([capitalizado, mayusculas, CANONICO], 'Blanco');
    expect(resolucion).toEqual({
      estado: 'fusionado',
      id: 2,
      canonico: { id: 9, nombre: 'Blanco Optico' },
    });
  });

  it('resuelve TODOS los nombres de la tanda, no sólo el primero', async () => {
    const rojo: ColorFake = { id: 3, nombre: 'Rojo', activo: true, idFusionadoEn: null };
    const { bd } = catalogo([ABSORBIDO, CANONICO, rojo]);
    const mapa = await resolverColoresDelPapel(bd, ['Blanco', 'Rojo', 'Verde']);
    expect([...mapa.keys()].sort()).toEqual(['blanco', 'rojo', 'verde']);
    expect(mapa.get('verde')).toEqual({ estado: 'nuevo' });
  });

  it('sin nombres (o sólo vacíos) no toca la base', async () => {
    const { bd, findMany } = catalogo([CANONICO]);
    expect(await resolverColoresDelPapel(bd, [])).toEqual(new Map());
    expect(await resolverColoresDelPapel(bd, ['', '   '])).toEqual(new Map());
    expect(findMany).not.toHaveBeenCalled();
  });

  it('pregunta por el LOTE de nombres en UNA consulta, no uno por uno', async () => {
    const rojo: ColorFake = { id: 3, nombre: 'Rojo', activo: true, idFusionadoEn: null };
    const { bd, findMany } = catalogo([CANONICO, rojo]);
    await resolverColoresDelPapel(bd, ['Blanco Optico', 'Rojo', 'blanco optico']);
    expect(findMany).toHaveBeenCalledTimes(1);
    // Y el nombre repetido (misma clave, distintas mayúsculas) no se pregunta dos veces.
    const args = findMany.mock.calls[0]?.[0];
    expect(args?.where.nombre.in).toEqual(['Blanco Optico', 'Rojo', 'blanco optico']);
  });
});

describe('marcarColorDelPapel', () => {
  const fusionado = {
    estado: 'fusionado',
    id: 7,
    canonico: { id: 9, nombre: 'Blanco Optico' },
  } as const;

  it('🔴 el color FUSIONADO se marca CON destino y CON aviso', () => {
    const marca = marcarColorDelPapel('BLANCO', fusionado);
    expect(marca.colorFusionadoEn).toBe('Blanco Optico');
    expect(marca.advertencia?.tipo).toBe('color-fusionado');
    expect(marca.advertencia?.mensaje).toContain('Blanco Optico');
    // …y NO es "nuevo": el color existe, sólo que se lo llevaron. Decir "nuevo" avisaría de un
    // alta que no va a ocurrir y taparía el desvío, que es lo grave.
    expect(marca.colorNuevo).toBe(false);
  });

  it('el color que NO existe se marca NUEVO, sin destino ni aviso', () => {
    expect(marcarColorDelPapel('BLANCO', { estado: 'nuevo' })).toEqual({
      colorNuevo: true,
      colorFusionadoEn: null,
      advertencia: null,
    });
  });

  it('⚠️ el color que EXISTE (incluido el apagado a mano) no se marca de ninguna manera', () => {
    // La rama gemela otra vez, ahora en la traducción: 'existe' cubre tanto el color vivo como el
    // que su dueño apagó, y ninguno de los dos desvía nada.
    expect(marcarColorDelPapel('BLANCO', { estado: 'existe', id: 7 })).toEqual({
      colorNuevo: false,
      colorFusionadoEn: null,
      advertencia: null,
    });
  });

  it('un renglón SIN color (papel sin color, o PDF ilegible) no dice nada', () => {
    expect(marcarColorDelPapel('', fusionado)).toEqual({
      colorNuevo: false,
      colorFusionadoEn: null,
      advertencia: null,
    });
    expect(marcarColorDelPapel('BLANCO', undefined)).toEqual({
      colorNuevo: false,
      colorFusionadoEn: null,
      advertencia: null,
    });
  });

  it('el aviso nombra el color como lo trae el PAPEL (normalizado), no como está en el catálogo', () => {
    // El papel puede traer "  blanco  "; el aviso tiene que ser reconocible contra el papel.
    const marca = marcarColorDelPapel('  blanco  ', fusionado);
    expect(marca.advertencia?.mensaje).toContain('"blanco"');
  });
});

describe('mensajeColorFusionado', () => {
  it('nombra los DOS colores y avisa de lo que está en juego: el precio casa por nombre', () => {
    const mensaje = mensajeColorFusionado('Blanco', 'Blanco Optico');
    expect(mensaje).toContain('"Blanco"');
    expect(mensaje).toContain('"Blanco Optico"');
    expect(mensaje).toContain('POR NOMBRE');
    expect(mensaje.toLowerCase()).toContain('precosto');
  });
});
