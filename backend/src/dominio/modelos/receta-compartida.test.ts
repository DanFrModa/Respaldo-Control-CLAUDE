/**
 * Pruebas UNITARIAS del resolver de la RECETA COMPARTIDA (V1-E9b, §Post-F9.167).
 *
 * Todo lo de aquí es PURO (salvo dos casos que usan un lector de mentira): la regla, el reparto en
 * lote con su camino de vuelta, y el injerto de la receta traída por `include`. Las tres formas se
 * prueban por separado porque **confundirlas es como se cuelan los defectos silenciosos**: el
 * precosto vacío (forma 3) y el hijo sin tela principal en el listado (forma 2) no lanzan, no
 * truenan y se ven normales.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  conRecetaCompartida,
  conRecetaCompartidaDeUno,
  idModeloDeLaReceta,
  injertarRecetaCompartida,
  injertarRecetaDeUno,
  repartirFilasDeReceta,
  repartoDeRecetas,
  resolverIdRecetaDeModelo,
  resolverRepartoDeRecetas,
  type LinajeDeReceta,
} from './receta-compartida.js';

/** Lector de mentira: sólo tiene lo que el resolver usa (`modelo.findUnique` / `findMany`). */
function lectorDeMentira(filas: LinajeDeReceta[]) {
  const porId = new Map(filas.map((f) => [f.id, f]));
  const findUnique = vi.fn(({ where }: { where: { id: number } }) =>
    Promise.resolve(porId.get(where.id) ?? null),
  );
  const findMany = vi.fn(({ where }: { where: { id: { in: number[] } } }) =>
    Promise.resolve(where.id.in.map((id) => porId.get(id)).filter((f) => f !== undefined)),
  );
  const lector = { modelo: { findUnique, findMany } };
  return {
    findUnique,
    findMany,
    lector: lector as unknown as Parameters<typeof resolverIdRecetaDeModelo>[0],
  };
}

// ── LA REGLA ──────────────────────────────────────────────────────────────────────────────────

describe('idModeloDeLaReceta — la regla', () => {
  it('sin padre de desarrollo, la receta es LA SUYA', () => {
    expect(idModeloDeLaReceta({ id: 7, idModeloDesarrollo: null })).toBe(7);
  });

  it('con padre de desarrollo, la receta es LA DEL PADRE', () => {
    expect(idModeloDeLaReceta({ id: 7, idModeloDesarrollo: 3 })).toBe(3);
  });

  it('resolver dos veces da lo mismo que resolver una (no hay cadenas)', () => {
    // El padre es de DESARROLLO ⇒ nunca lleva la columna ⇒ `receta(receta(x)) = receta(x)`. De esta
    // propiedad depende que las lecturas canónicas puedan resolver por dentro sin importar si quien
    // llamó ya resolvió.
    const hijo = { id: 7, idModeloDesarrollo: 3 };
    const padre = { id: 3, idModeloDesarrollo: null };
    expect(idModeloDeLaReceta(padre)).toBe(idModeloDeLaReceta(hijo));
  });

  it('el id 0 no se confunde con «sin padre» (`??`, no `||`)', () => {
    // Defensa de tipo: con `||` un `idModeloDesarrollo` de 0 caería al propio id. Los ids son
    // positivos, así que esto nunca pasa por datos — pero sí por un cambio de operador.
    expect(idModeloDeLaReceta({ id: 7, idModeloDesarrollo: 0 })).toBe(0);
  });
});

// ── FORMA 1: por fila ─────────────────────────────────────────────────────────────────────────

describe('resolverIdRecetaDeModelo — forma POR FILA', () => {
  it('devuelve el padre cuando lo hay y el propio id cuando no', async () => {
    const { lector } = lectorDeMentira([
      { id: 1, idModeloDesarrollo: null },
      { id: 2, idModeloDesarrollo: 1 },
    ]);
    expect(await resolverIdRecetaDeModelo(lector, 2)).toBe(1);
    expect(await resolverIdRecetaDeModelo(lector, 1)).toBe(1);
  });

  it('un modelo que NO existe devuelve su propio id (no lanza: no es una guarda)', async () => {
    const { lector } = lectorDeMentira([]);
    expect(await resolverIdRecetaDeModelo(lector, 99)).toBe(99);
  });
});

// ── FORMA 2: en lote, con su camino de vuelta ─────────────────────────────────────────────────

describe('repartoDeRecetas — forma EN LOTE', () => {
  const pagina: LinajeDeReceta[] = [
    { id: 1, idModeloDesarrollo: null },
    { id: 2, idModeloDesarrollo: 1 },
    { id: 3, idModeloDesarrollo: 1 },
    { id: 4, idModeloDesarrollo: 9 },
  ];

  it('los ids a consultar son los de las RECETAS, sin repetir y sin los hijos', () => {
    const reparto = repartoDeRecetas(pagina);
    expect(reparto.idsDeReceta).toEqual([1, 9]);
    // 🔴 Si los hijos se colaran en el `in`, la consulta traería filas que no existen y el defecto
    // pasaría inadvertido: el hijo saldría vacío igual.
    expect(reparto.idsDeReceta).not.toContain(2);
    expect(reparto.idsDeReceta).not.toContain(3);
    expect(reparto.idsDeReceta).not.toContain(4);
  });

  it('traduce cada modelo a su receta, y lo desconocido a sí mismo', () => {
    const reparto = repartoDeRecetas(pagina);
    expect(reparto.recetaDe(1)).toBe(1);
    expect(reparto.recetaDe(2)).toBe(1);
    expect(reparto.recetaDe(3)).toBe(1);
    expect(reparto.recetaDe(4)).toBe(9);
    expect(reparto.recetaDe(77)).toBe(77);
  });

  it('sin modelos no hay nada que consultar', () => {
    expect(repartoDeRecetas([]).idsDeReceta).toEqual([]);
  });

  it('resolverRepartoDeRecetas lee los linajes y NO consulta si la lista viene vacía', async () => {
    const { lector, findMany } = lectorDeMentira(pagina);
    const reparto = await resolverRepartoDeRecetas(lector, [2, 3]);
    expect(reparto.idsDeReceta).toEqual([1]);
    expect(reparto.recetaDe(3)).toBe(1);

    findMany.mockClear();
    expect((await resolverRepartoDeRecetas(lector, [])).idsDeReceta).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('un id pedido que no existe entra al reparto como identidad', async () => {
    const { lector } = lectorDeMentira(pagina);
    const reparto = await resolverRepartoDeRecetas(lector, [2, 404]);
    expect(reparto.recetaDe(404)).toBe(404);
    expect(reparto.idsDeReceta).toEqual([1, 404]);
  });
});

describe('repartirFilasDeReceta — 🔴 EL CAMINO DE VUELTA (el que se olvida)', () => {
  interface Fila {
    idModelo: number;
    tela: string;
  }
  const pagina: LinajeDeReceta[] = [
    { id: 1, idModeloDesarrollo: null },
    { id: 2, idModeloDesarrollo: 1 },
    { id: 3, idModeloDesarrollo: 1 },
    { id: 4, idModeloDesarrollo: null },
  ];
  const filas: Fila[] = [
    { idModelo: 1, tela: 'Algodón' },
    { idModelo: 1, tela: 'Rib' },
  ];

  it('los TRES modelos que comparten la receta reciben las MISMAS filas', () => {
    const reparto = repartoDeRecetas(pagina);
    const porModelo = repartirFilasDeReceta(reparto, [1, 2, 3, 4], filas, (f) => f.idModelo);

    // 🔴 Ésta es la aserción de la etapa: un mapa armado por `fila.idModelo` sólo tendría al 1, y
    // los hijos 2 y 3 saldrían SIN TELA PRINCIPAL en el listado, en silencio.
    expect(porModelo.get(1)?.map((f) => f.tela)).toEqual(['Algodón', 'Rib']);
    expect(porModelo.get(2)?.map((f) => f.tela)).toEqual(['Algodón', 'Rib']);
    expect(porModelo.get(3)?.map((f) => f.tela)).toEqual(['Algodón', 'Rib']);
  });

  it('un modelo sin filas queda con lista VACÍA, no ausente', () => {
    const reparto = repartoDeRecetas(pagina);
    const porModelo = repartirFilasDeReceta(reparto, [1, 2, 3, 4], filas, (f) => f.idModelo);
    expect(porModelo.has(4)).toBe(true);
    expect(porModelo.get(4)).toEqual([]);
  });

  it('conserva el ORDEN de las filas dentro de cada grupo (la primera sigue siendo la primera)', () => {
    const reparto = repartoDeRecetas(pagina);
    const alReves = [...filas].reverse();
    const porModelo = repartirFilasDeReceta(reparto, [2], alReves, (f) => f.idModelo);
    expect(porModelo.get(2)?.[0]?.tela).toBe('Rib');
  });
});

// ── FORMA 3: por `include` anidado ────────────────────────────────────────────────────────────

/** La forma mínima que el injerto necesita, con un campo propio que NO debe viajar. */
interface ModeloFalso {
  id: number;
  idModeloDesarrollo: number | null;
  codigo: string;
  telas: string[];
  avios: string[];
  artes: string[];
}

const padre: ModeloFalso = {
  id: 1,
  idModeloDesarrollo: null,
  codigo: 'CYA-26-71-001',
  telas: ['Algodón'],
  avios: ['Etiqueta'],
  artes: ['Bordado pecho'],
};

const hijoVacio = (id: number, codigo: string): ModeloFalso => ({
  id,
  idModeloDesarrollo: 1,
  codigo,
  telas: [],
  avios: [],
  artes: [],
});

describe('injertarRecetaDeUno — 🔴 la forma que el plan no vio (el precosto)', () => {
  it('el hijo recibe las TRES relaciones del padre (telas, avíos —con sus tallas— y artes)', () => {
    const injertado = injertarRecetaDeUno(hijoVacio(2, '71001'), padre);
    // 🔴 Sin esto el precosto de un hijo sale con la receta VACÍA —sólo maquila, corte y empaque—
    // sin lanzar y sin verse raro, y de ese número sale el precio que se cotiza al cliente.
    expect(injertado.telas).toEqual(['Algodón']);
    expect(injertado.avios).toEqual(['Etiqueta']);
    expect(injertado.artes).toEqual(['Bordado pecho']);
  });

  it('la FICHA del hijo NO se toca: sólo viaja la receta', () => {
    const injertado = injertarRecetaDeUno(hijoVacio(2, '71001'), padre);
    expect(injertado.id).toBe(2);
    expect(injertado.codigo).toBe('71001');
    expect(injertado.idModeloDesarrollo).toBe(1);
  });

  it('un modelo SIN padre se devuelve intacto (y sin copiarlo)', () => {
    const propio: ModeloFalso = { ...padre, id: 5, telas: ['Felpa'] };
    expect(injertarRecetaDeUno(propio, padre)).toBe(propio);
  });

  it('si el padre no viene, se deja la receta PROPIA — nunca se fabrica una vacía', () => {
    // La FK es RESTRICT, así que esto no puede pasar por datos; si pasara por un filtro mal
    // escrito, enseñar la receta propia es infinitamente menos dañino que un precosto vacío.
    const hijoConAlgo = { ...hijoVacio(2, '71001'), telas: ['Felpa'] };
    expect(injertarRecetaDeUno(hijoConAlgo, null).telas).toEqual(['Felpa']);
    expect(injertarRecetaDeUno(hijoConAlgo, undefined).telas).toEqual(['Felpa']);
  });
});

describe('injertarRecetaCompartida — el injerto en LOTE', () => {
  it('varios hijos del mismo padre reciben todos su receta, y los que no tienen padre no se tocan', () => {
    const suelto: ModeloFalso = { ...padre, id: 9, codigo: '71999', telas: ['Felpa'] };
    const resultado = injertarRecetaCompartida(
      [hijoVacio(2, '71001'), hijoVacio(3, '71002'), suelto],
      [padre],
    );
    expect(resultado.map((m) => m.telas)).toEqual([['Algodón'], ['Algodón'], ['Felpa']]);
    expect(resultado.map((m) => m.codigo)).toEqual(['71001', '71002', '71999']);
  });

  it('sin padres a la vista, la lista sale igual (mismo largo y mismo orden)', () => {
    const entrada = [hijoVacio(2, '71001'), { ...padre, id: 9 }];
    const resultado = injertarRecetaCompartida(entrada, []);
    expect(resultado).toHaveLength(2);
    expect(resultado.map((m) => m.id)).toEqual([2, 9]);
  });
});

describe('conRecetaCompartida — el injerto que sí consulta', () => {
  it('lee los padres UNA vez, sin repetir ids (nada de N+1)', async () => {
    const leerPadres = vi.fn(() => Promise.resolve([padre]));
    const resultado = await conRecetaCompartida(
      [hijoVacio(2, '71001'), hijoVacio(3, '71002'), hijoVacio(4, '71003')],
      leerPadres,
    );
    expect(leerPadres).toHaveBeenCalledTimes(1);
    expect(leerPadres).toHaveBeenCalledWith([1]);
    expect(resultado.every((m) => m.telas.length === 1)).toBe(true);
  });

  it('sin ningún hijo NO toca la base', async () => {
    const leerPadres = vi.fn(() => Promise.resolve([]));
    const resultado = await conRecetaCompartida([{ ...padre, id: 9 }], leerPadres);
    expect(leerPadres).not.toHaveBeenCalled();
    expect(resultado[0]?.telas).toEqual(['Algodón']);
  });

  it('la variante de UNO tampoco consulta cuando el modelo no tiene padre', async () => {
    const leerPadre = vi.fn(() => Promise.resolve(padre));
    expect(await conRecetaCompartidaDeUno({ ...padre, id: 9 }, leerPadre)).toEqual({
      ...padre,
      id: 9,
    });
    expect(leerPadre).not.toHaveBeenCalled();

    const injertado = await conRecetaCompartidaDeUno(hijoVacio(2, '71001'), leerPadre);
    expect(leerPadre).toHaveBeenCalledWith(1);
    expect(injertado.telas).toEqual(['Algodón']);
  });
});
