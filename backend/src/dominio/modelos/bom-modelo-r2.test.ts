import { describe, expect, it, vi } from 'vitest';

import type { ServicioArchivos } from '../../comun/archivos.js';
import { ErrorPermiso } from '../../comun/errores.js';
import type { ContextoBd, Tx } from '../../comun/transaccion.js';
import { exigirBorradoTrasElCommit } from '../../pruebas/commit-r2.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';

// Lo que se prueba es el CABLEADO del borrado físico, no la copia de la receta: las piezas que no
// participan en él se neutralizan para que el stub de la transacción quepa en la cabeza.
vi.mock('./receta-compartida.js', () => ({
  exigirRecetaPropia: () => Promise.resolve(),
  resolverIdRecetaDeModelo: (_tx: unknown, id: number) => Promise.resolve(id),
}));
vi.mock('./revision-modelo.js', () => ({
  tocarModeloPorCambioDeReceta: () => Promise.resolve(),
}));
vi.mock('./modelos.js', () => ({
  exigirModelo: () => Promise.resolve({ id: 1 }),
  incluirRelacionesModelo: {},
  leerTallasCurvaModelo: () => Promise.resolve([]),
}));
vi.mock('./curva-desde-ordenes.js', () => ({
  avisosDeCurvaDelModelo: () => Promise.resolve([]),
}));

const { copiarBom } = await import('./bom-modelo.js');

/**
 * ⭐ 0.081(a) — **COPIAR UNA RECETA «CON REEMPLAZO» BORRA LOS ARTES DEL DESTINO**, y con ellos sus
 * fotos. Es la TERCERA puerta a `borrarArchivoSiQuedoHuerfano` (las otras dos son `eliminarArte` y
 * `quitarFotoArte`), y la más fácil de olvidar porque el borrado vive enterrado en una función que
 * de entrada trata de copiar, no de borrar. Sin esto, cada reemplazo dejaba en R2 tantos objetos
 * como fotos tuviera el arte que se fue.
 *
 * Se prueba lo mismo que en sus hermanas: se borra del bucket lo que la tx borró de la base, NO se
 * toca lo que otro arte comparte, y FUSIONAR (sin reemplazo) no borra nada.
 */

const sesionAdmin = () => sesionDePrueba({ permisos: ['modelos.ver', 'modelos.administrar'] });
const sesionSoloVer = () => sesionDePrueba({ permisos: ['modelos.ver'] });

/**
 * Doble de `ServicioArchivos` en el que SOLO `eliminarObjeto` es legal: lo demás no debe llamarse.
 *
 * ⚠️ El tipo sale de la INTERFAZ (`ServicioArchivos['eliminarObjeto']`), NUNCA de un
 * `() => Promise<void>` escrito a mano. Con una firma sin argumentos, `vi.fn` infiere `mock.calls`
 * como `[][]` y ninguna prueba puede comprobar QUÉ key se borró, sólo cuántas veces — y borrar el
 * objeto EQUIVOCADO (la foto de otro modelo) es el peor fallo posible de esta fila.
 */
function archivosFalsos(eliminarObjeto: ServicioArchivos['eliminarObjeto']): ServicioArchivos {
  const prohibido = (): never => {
    throw new Error('no debe llamarse');
  };
  return {
    solicitarSubida: prohibido,
    subirContenido: prohibido,
    urlDescarga: () => Promise.reject(new Error('no debe llamarse')),
    descargarContenido: () => Promise.reject(new Error('no debe llamarse')),
    eliminarObjeto,
  };
}

const ID_ORIGEN = 11;
const ID_DESTINO = 22;

/**
 * Stub de la transacción de `copiarBom`. El ORIGEN va vacío (no hay nada que crear: lo que importa
 * es lo que se BORRA del destino) y el DESTINO trae los artes que el reemplazo se lleva. `usos` dice
 * cuántas fotos de arte siguen referenciando cada archivo tras el borrado.
 */
function bdParaCopiar(opciones: {
  artesDestino: ReturnType<typeof arteDestino>[];
  usos: Record<string, number>;
}) {
  const archivoDelete = vi.fn(() => Promise.resolve({}));
  const vacio = vi.fn(() => Promise.resolve([]));
  // El stub SIMULA el borrado: tras el `deleteMany` del reemplazo, el destino ya no tiene artes.
  // Sin esto la relectura final de `leerBom` devolvería los artes que la tx acaba de borrar.
  let destinoVaciado = false;
  const tx = {
    modeloTela: { findMany: vacio, deleteMany: vi.fn(() => Promise.resolve({ count: 0 })) },
    modeloAvio: { findMany: vacio, deleteMany: vi.fn(() => Promise.resolve({ count: 0 })) },
    modeloAvioTalla: { findMany: vacio },
    modeloArte: {
      // El origen no tiene arte; el destino sí (es lo que el reemplazo borra).
      findMany: vi.fn((args: { where: { idModelo: number } }) =>
        Promise.resolve(
          args.where.idModelo === ID_DESTINO && !destinoVaciado ? opciones.artesDestino : [],
        ),
      ),
      aggregate: vi.fn(() => Promise.resolve({ _max: { orden: null } })),
      deleteMany: vi.fn(() => {
        destinoVaciado = true;
        return Promise.resolve({ count: opciones.artesDestino.length });
      }),
    },
    modeloArteFoto: {
      count: vi.fn((args: { where: { idArchivo: string } }) =>
        Promise.resolve(opciones.usos[args.where.idArchivo] ?? 0),
      ),
    },
    archivo: { delete: archivoDelete },
    bitacora: { create: vi.fn((args: { data: Record<string, unknown> }) => Promise.resolve(args)) },
    $queryRaw: vi.fn((_plantilla: TemplateStringsArray, idArchivo: string) =>
      Promise.resolve([{ id: idArchivo, key: `modelo-arte/${idArchivo}.jpg` }]),
    ),
  } as unknown as Tx;
  return { bd: { tx } as ContextoBd, tx, archivoDelete };
}

/** Un arte del destino con la forma de `SELECT_ARTE` (la relectura final de `leerBom` la exige). */
function arteDestino(id: number, idsArchivo: string[]) {
  return {
    id,
    idModelo: ID_DESTINO,
    descripcion: 'Estampado',
    posicion: null,
    puntadas: null,
    precio: null,
    idTipoArte: 1,
    idProveedor: null,
    orden: 0,
    creadoEn: new Date(),
    creadoPorId: 'u1',
    modificadoEn: new Date(),
    modificadoPorId: 'u1',
    proveedor: null,
    tipoArte: { nombre: 'Estampado', codigo: 'EST', usaPuntadas: false },
    fotos: idsArchivo.map((idArchivo, i) => ({
      id: i + 1,
      idArchivo,
      orden: i,
      archivo: { key: `modelo-arte/${idArchivo}.jpg` },
    })),
  };
}

describe('copiarBom con REEMPLAZO — las fotos que se van, se van también de R2 (0.081a)', () => {
  it('⭐ borra del bucket las fotos de los artes reemplazados', async () => {
    const { bd, archivoDelete } = bdParaCopiar({
      artesDestino: [arteDestino(1, ['archA']), arteDestino(2, ['archB'])],
      usos: { archA: 0, archB: 0 },
    });
    const eliminarObjeto = vi.fn<ServicioArchivos['eliminarObjeto']>(() => Promise.resolve());

    await copiarBom(
      sesionAdmin(),
      ID_DESTINO,
      { idOrigen: ID_ORIGEN, reemplazar: true },
      bd,
      archivosFalsos(eliminarObjeto),
    );

    expect(archivoDelete).toHaveBeenCalledTimes(2);
    expect(eliminarObjeto).toHaveBeenCalledTimes(2);
    expect(eliminarObjeto.mock.calls.map((c) => c[0])).toEqual([
      'modelo-arte/archA.jpg',
      'modelo-arte/archB.jpg',
    ]);
  });

  it('🔴🔴 GUARDIÁN: el objeto se borra DESPUÉS del commit, jamás dentro de la transacción', async () => {
    // Las demás pruebas de este archivo corren con `bd = { tx }`, y ahí `enTransaccion` toma el
    // atajo `fn(bd.tx)`: NO HAY COMMIT que observar, así que no pueden ver esta invariante. Ésta
    // pasa por `cliente.$transaction` de verdad y mira el bucket justo en el punto de commit.
    const { tx } = bdParaCopiar({
      artesDestino: [arteDestino(1, ['archA']), arteDestino(2, ['archB'])],
      usos: { archA: 0, archB: 0 },
    });

    await exigirBorradoTrasElCommit(
      tx,
      ['modelo-arte/archA.jpg', 'modelo-arte/archB.jpg'],
      (bd, eliminarObjeto) =>
        copiarBom(
          sesionAdmin(),
          ID_DESTINO,
          { idOrigen: ID_ORIGEN, reemplazar: true },
          bd,
          archivosFalsos(eliminarObjeto),
        ),
    );
  });

  it('🔴🔴 en NEGATIVO: una foto COMPARTIDA por otro arte no se borra del bucket', async () => {
    const { bd, archivoDelete } = bdParaCopiar({
      artesDestino: [arteDestino(1, ['archA']), arteDestino(2, ['archB'])],
      usos: { archA: 0, archB: 3 },
    });
    const eliminarObjeto = vi.fn<ServicioArchivos['eliminarObjeto']>(() => Promise.resolve());

    await copiarBom(
      sesionAdmin(),
      ID_DESTINO,
      { idOrigen: ID_ORIGEN, reemplazar: true },
      bd,
      archivosFalsos(eliminarObjeto),
    );

    expect(archivoDelete).toHaveBeenCalledTimes(1);
    expect(eliminarObjeto).toHaveBeenCalledTimes(1);
    expect(eliminarObjeto).toHaveBeenCalledWith('modelo-arte/archA.jpg');
  });

  it('🔴 en NEGATIVO: FUSIONAR (sin reemplazo) no borra artes, así que no toca el bucket', async () => {
    const { bd, archivoDelete } = bdParaCopiar({
      artesDestino: [arteDestino(1, ['archA'])],
      usos: { archA: 0 },
    });
    const eliminarObjeto = vi.fn<ServicioArchivos['eliminarObjeto']>(() => Promise.resolve());

    await copiarBom(
      sesionAdmin(),
      ID_DESTINO,
      { idOrigen: ID_ORIGEN, reemplazar: false },
      bd,
      archivosFalsos(eliminarObjeto),
    );

    expect(archivoDelete).not.toHaveBeenCalled();
    expect(eliminarObjeto).not.toHaveBeenCalled();
  });

  it('🔴 en NEGATIVO: sin permiso no se borra nada, ni en la base ni en R2', async () => {
    const { bd, archivoDelete } = bdParaCopiar({
      artesDestino: [arteDestino(1, ['archA'])],
      usos: { archA: 0 },
    });
    const eliminarObjeto = vi.fn<ServicioArchivos['eliminarObjeto']>(() => Promise.resolve());

    await expect(
      copiarBom(
        sesionSoloVer(),
        ID_DESTINO,
        { idOrigen: ID_ORIGEN, reemplazar: true },
        bd,
        archivosFalsos(eliminarObjeto),
      ),
    ).rejects.toBeInstanceOf(ErrorPermiso);

    expect(archivoDelete).not.toHaveBeenCalled();
    expect(eliminarObjeto).not.toHaveBeenCalled();
  });

  it('best-effort: si R2 falla, la copia de receta QUEDA hecha y el fallo AVISA', async () => {
    const { bd, archivoDelete } = bdParaCopiar({
      artesDestino: [arteDestino(1, ['archA'])],
      usos: { archA: 0 },
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(
      copiarBom(
        sesionAdmin(),
        ID_DESTINO,
        { idOrigen: ID_ORIGEN, reemplazar: true },
        bd,
        archivosFalsos(() => Promise.reject(new Error('R2 caído'))),
      ),
    ).resolves.toBeDefined();

    expect(archivoDelete).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
