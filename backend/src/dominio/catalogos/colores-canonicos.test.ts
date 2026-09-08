/**
 * Tests UNIT del resolvedor de colores CANÓNICOS (fila 0.159, §Post-F9.222) — sin Postgres: contra
 * un catálogo FALSO en memoria que imita el único método que la función toca
 * (`color.findMany({ where: { id: { in } } })`).
 *
 * Lo que se fija aquí es lo que hace segura toda la fila:
 *  • sin rastro, el color se devuelve TAL CUAL (el 100 % del catálogo que nunca se fusionó);
 *  • con rastro, se llega hasta el que de verdad sobrevivió, encadenando A→B→C;
 *  • **por LOTES**: N colores se resuelven en un puñado de consultas, no en N — la explosión de
 *    materiales lo llama con la matriz entera de una orden;
 *  • y un anillo no cuelga: se corta con un error que dice cómo romperlo.
 */
import { describe, expect, it } from 'vitest';

import { ErrorConflicto, ErrorNoEncontrado } from '../../comun/errores.js';
import type { Tx } from '../../comun/transaccion.js';
import {
  canonizarLineasDeColor,
  colorCanonico,
  idCanonico,
  resolverColoresCanonicos,
} from './colores-canonicos.js';

interface FilaColor {
  id: number;
  nombre: string;
  activo: boolean;
  idFusionadoEn: number | null;
}

/** Catálogo falso + el CONTADOR de consultas, que es media prueba (el lote no puede ser N viajes). */
function catalogoFalso(filas: FilaColor[]): {
  tx: Pick<Tx, 'color'>;
  viajes: () => number;
} {
  let viajes = 0;
  const tx = {
    color: {
      findMany: (args: { where: { id: { in: number[] } } }) => {
        viajes++;
        const pedidos = new Set(args.where.id.in);
        return Promise.resolve(filas.filter((f) => pedidos.has(f.id)));
      },
    },
  } as unknown as Pick<Tx, 'color'>;
  return { tx, viajes: () => viajes };
}

const activo = (id: number, nombre: string): FilaColor => ({
  id,
  nombre,
  activo: true,
  idFusionadoEn: null,
});
const absorbido = (id: number, nombre: string, haciaId: number): FilaColor => ({
  id,
  nombre,
  activo: false,
  idFusionadoEn: haciaId,
});

describe('colorCanonico', () => {
  it('devuelve el MISMO color cuando nadie lo absorbió', async () => {
    const { tx } = catalogoFalso([activo(1, 'Blanco Hueso')]);
    expect(await colorCanonico(tx, 1)).toEqual({ id: 1, nombre: 'Blanco Hueso', activo: true });
  });

  it('sigue el rastro hasta el que sobrevivió, encadenando A→B→C', async () => {
    const { tx } = catalogoFalso([
      absorbido(1, 'Blanco Hueso Pantone 14-0002 Tcx Pumice Stone', 2),
      absorbido(2, 'Blanco Hueso Pantone', 3),
      activo(3, 'Blanco Hueso'),
    ]);
    expect(await colorCanonico(tx, 1)).toEqual({ id: 3, nombre: 'Blanco Hueso', activo: true });
  });

  it('un color APAGADO SIN rastro se devuelve tal cual (lo apagó su dueño, no una fusión)', async () => {
    const { tx } = catalogoFalso([{ id: 1, nombre: 'Verde', activo: false, idFusionadoEn: null }]);
    expect(await colorCanonico(tx, 1)).toEqual({ id: 1, nombre: 'Verde', activo: false });
  });

  it('un color ACTIVO con rastro colgando gana él (lo que se ve manda sobre la historia)', async () => {
    const { tx } = catalogoFalso([
      { id: 1, nombre: 'Reactivado', activo: true, idFusionadoEn: 2 },
      activo(2, 'Canónico'),
    ]);
    expect((await colorCanonico(tx, 1)).id).toBe(1);
  });

  it('🔴 y gana él AUNQUE su canónico ya esté cargado: la regla es la caminata, no el filtro', async () => {
    // ⚠️ Nació de una MUTACIÓN QUE SOBREVIVIÓ. La regla «un color ACTIVO para la caminata» vive en
    // DOS sitios —el filtro de la carga por niveles, que sólo sigue el rastro de los apagados, y la
    // condición del bucle— y quitarla de UNO lo tapaba el otro: el destino nunca llegaba a la
    // caché, así que la caminata se cortaba «por accidente» y la prueba de arriba seguía verde.
    // Pidiendo los DOS ids a la vez el destino SÍ está cargado, y entonces la única cosa que impide
    // que el activo se desvíe es la condición del bucle — que es lo que esta prueba fija.
    const { tx } = catalogoFalso([
      { id: 1, nombre: 'Reactivado', activo: true, idFusionadoEn: 2 },
      activo(2, 'Canónico'),
    ]);
    const mapa = await resolverColoresCanonicos(tx, [1, 2]);
    expect(idCanonico(mapa, 1)).toBe(1);
    expect(idCanonico(mapa, 2)).toBe(2);
  });

  it('un id que no existe se dice con nombre, no se calla', async () => {
    const { tx } = catalogoFalso([activo(1, 'Blanco')]);
    await expect(colorCanonico(tx, 99)).rejects.toBeInstanceOf(ErrorNoEncontrado);
  });

  it('🔴 una cadena MÁS LARGA que el tope se dice, no devuelve un color a medio camino', async () => {
    // ⚠️ Nació de un sondeo del reviewer (ronda 2): con 25 eslabones esto devolvía `id=21,
    // activo=false` —ni canónico ni activo— **sin lanzar**, porque la carga paraba en el nivel 20 y
    // la caminata caía en el `break` de «el canónico ya no existe». Como la FK es `Restrict` ese
    // caso NO puede pasar: un eslabón que falta en la caché sólo significa que la carga se truncó.
    // Devolver un color absorbido en silencio es peor que un 409: con él se captura una orden.
    const largos: FilaColor[] = [
      ...Array.from({ length: 24 }, (_, i) => absorbido(i + 1, `Eslabón ${String(i + 1)}`, i + 2)),
      activo(25, 'El que sobrevive'),
    ];
    const { tx } = catalogoFalso(largos);

    await expect(colorCanonico(tx, 1)).rejects.toBeInstanceOf(ErrorConflicto);
    await expect(colorCanonico(tx, 1)).rejects.toThrow(/no termina/);
    await expect(resolverColoresCanonicos(tx, [1])).rejects.toBeInstanceOf(ErrorConflicto);
  });

  it('una cadena que CABE en el tope sí se resuelve entera (el tope no muerde de más)', async () => {
    const cabe: FilaColor[] = [
      ...Array.from({ length: 20 }, (_, i) => absorbido(i + 1, `Eslabón ${String(i + 1)}`, i + 2)),
      activo(21, 'El que sobrevive'),
    ];
    const { tx } = catalogoFalso(cabe);
    expect((await colorCanonico(tx, 1)).id).toBe(21);
  });

  it('un ANILLO no cuelga: se corta con un error que dice cómo romperlo', async () => {
    const { tx } = catalogoFalso([absorbido(1, 'A', 2), absorbido(2, 'B', 1)]);
    await expect(colorCanonico(tx, 1)).rejects.toBeInstanceOf(ErrorConflicto);
    await expect(colorCanonico(tx, 1)).rejects.toThrow(/en círculo/);
  });
});

describe('resolverColoresCanonicos', () => {
  it('resuelve MUCHOS colores en unos pocos viajes, no en uno por color', async () => {
    const filas = [
      ...Array.from({ length: 30 }, (_, i) => activo(i + 1, `Color ${String(i + 1)}`)),
      absorbido(100, 'Duplicado', 1),
    ];
    const { tx, viajes } = catalogoFalso(filas);

    const mapa = await resolverColoresCanonicos(
      tx,
      filas.map((f) => f.id),
    );

    expect(mapa.size).toBe(31);
    expect(idCanonico(mapa, 100)).toBe(1);
    expect(idCanonico(mapa, 7)).toBe(7);
    // 🔴 EL CORAZÓN DE LA PRUEBA: 31 colores con una cadena de un eslabón = 2 viajes (el lote y el
    // nivel siguiente), NUNCA 31. Es la diferencia entre resolver la matriz de una orden y hacer
    // una consulta por renglón dentro del bucle de la explosión.
    expect(viajes()).toBeLessThanOrEqual(2);
  });

  it('sin ids no consulta nada', async () => {
    const { tx, viajes } = catalogoFalso([activo(1, 'Blanco')]);
    expect((await resolverColoresCanonicos(tx, [])).size).toBe(0);
    expect((await resolverColoresCanonicos(tx, [null, undefined])).size).toBe(0);
    expect(viajes()).toBe(0);
  });

  it('lleva el NOMBRE del canónico, no sólo su id', async () => {
    const { tx } = catalogoFalso([
      absorbido(1, 'Blanco Hueso Pantone', 2),
      activo(2, 'Blanco Hueso'),
    ]);
    expect((await resolverColoresCanonicos(tx, [1])).get(1)?.nombre).toBe('Blanco Hueso');
  });

  it('un id fantasma se omite y `idCanonico` lo devuelve tal cual', async () => {
    const { tx } = catalogoFalso([activo(1, 'Blanco')]);
    const mapa = await resolverColoresCanonicos(tx, [1, 99]);
    expect(mapa.has(99)).toBe(false);
    expect(idCanonico(mapa, 99)).toBe(99);
    expect(idCanonico(mapa, null)).toBeNull();
  });

  it('una cadena larga se resuelve en tantos viajes como eslabones, no más', async () => {
    const { tx, viajes } = catalogoFalso([
      absorbido(1, 'A', 2),
      absorbido(2, 'B', 3),
      absorbido(3, 'C', 4),
      activo(4, 'D'),
    ]);
    expect(idCanonico(await resolverColoresCanonicos(tx, [1]), 1)).toBe(4);
    expect(viajes()).toBeLessThanOrEqual(4);
  });
});

describe('canonizarLineasDeColor', () => {
  it('cambia id Y nombre del renglón absorbido, y deja intacto todo lo demás', async () => {
    const { tx } = catalogoFalso([
      absorbido(1, 'Blanco Hueso Pantone', 2),
      activo(2, 'Blanco Hueso'),
    ]);
    const lineas = [
      { idColor: 1, color: { nombre: 'Blanco Hueso Pantone' }, tallas: [{ cantidad: 10 }] },
      { idColor: 2, color: { nombre: 'Blanco Hueso' }, tallas: [{ cantidad: 5 }] },
    ];
    const mapa = await resolverColoresCanonicos(
      tx,
      lineas.map((l) => l.idColor),
    );

    const canonizadas = canonizarLineasDeColor(lineas, mapa);

    expect(canonizadas.map((l) => l.idColor)).toEqual([2, 2]);
    expect(canonizadas[0]?.color.nombre).toBe('Blanco Hueso');
    expect(canonizadas[0]?.tallas).toEqual([{ cantidad: 10 }]);
    // Sin cambio no se copia el objeto: el camino normal (sin fusiones) ni se entera.
    expect(canonizadas[1]).toBe(lineas[1]);
  });

  it('sin fusiones devuelve exactamente los mismos objetos', async () => {
    const { tx } = catalogoFalso([activo(1, 'Blanco'), activo(2, 'Negro')]);
    const lineas = [
      { idColor: 1, color: { nombre: 'Blanco' } },
      { idColor: 2, color: { nombre: 'Negro' } },
    ];
    const mapa = await resolverColoresCanonicos(
      tx,
      lineas.map((l) => l.idColor),
    );
    expect(canonizarLineasDeColor(lineas, mapa)).toEqual(lineas);
  });
});
