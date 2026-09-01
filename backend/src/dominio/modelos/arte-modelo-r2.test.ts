import { describe, expect, it, vi } from 'vitest';

import type { ServicioArchivos } from '../../comun/archivos.js';
import { ErrorNoEncontrado, ErrorPermiso } from '../../comun/errores.js';
import type { ContextoBd, Tx } from '../../comun/transaccion.js';
import { exigirBorradoTrasElCommit } from '../../pruebas/commit-r2.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';

// Ni la guarda de receta compartida ni la marca de agua de la revisión son lo que se prueba aquí:
// se neutralizan para que el stub de la transacción no tenga que fingir media docena de consultas
// ajenas al borrado. Lo que SÍ corre de verdad es `borrarArchivoSiQuedoHuerfano`.
vi.mock('./receta-compartida.js', () => ({
  exigirRecetaPropia: () => Promise.resolve(),
  resolverIdRecetaDeModelo: (_tx: unknown, id: number) => Promise.resolve(id),
}));
vi.mock('./revision-modelo.js', () => ({
  tocarModeloPorCambioDeReceta: () => Promise.resolve(),
}));

const { eliminarArte, quitarFotoArte } = await import('./arte-modelo.js');

/**
 * ⭐ 0.081(a) — **LAS FOTOS DE ARTE, QUE SE COMPARTEN.** Es el sitio más delicado de la fila: aquí
 * el `Archivo` sólo se borra cuando NINGÚN otro arte lo referencia, así que el borrado físico de R2
 * hereda esa condición. Las dos mitades importan por igual:
 *
 *  • si la fila se borró → el objeto tiene que irse del bucket (si no, se paga para siempre);
 *  • 🔴 si la fila NO se borró porque otro arte comparte la foto → **el objeto NO se puede tocar**.
 *    Borrarlo dejaría a ese otro arte con una fila viva apuntando a un archivo inexistente: el
 *    huérfano al revés, que es peor que el que la fila vino a arreglar.
 *
 * Además se prueba que el borrado físico corre DESPUÉS del commit y en modo best-effort (un R2
 * caído no puede tumbar una operación que la base ya cerró), y que deja rastro al fallar.
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

/** Un renglón de arte con la forma que devuelve `SELECT_ARTE`, con las fotos que se le pidan. */
function arteConFotos(idArte: number, idsArchivo: string[]) {
  return {
    id: idArte,
    idModelo: 7,
    descripcion: 'Bordado pecho',
    posicion: 'FRENTE',
    puntadas: 5000,
    precio: null,
    idTipoArte: 1,
    idProveedor: null,
    orden: 0,
    creadoEn: new Date(),
    creadoPorId: 'u1',
    modificadoEn: new Date(),
    modificadoPorId: 'u1',
    proveedor: null,
    tipoArte: { nombre: 'Bordado', codigo: 'BOR', usaPuntadas: true },
    fotos: idsArchivo.map((idArchivo, i) => ({
      id: i + 1,
      idArchivo,
      orden: i,
      archivo: { key: `modelo-arte/${idArchivo}.jpg` },
    })),
  };
}

/**
 * Stub de la transacción compartido por los dos casos. `usos` dice, por cada `idArchivo`, cuántas
 * fotos de arte lo siguen referenciando DESPUÉS del borrado del renglón: 0 = quedó huérfano (se
 * borra), >0 = otro arte lo comparte (no se toca).
 */
function bdParaArte(opciones: {
  arte?: ReturnType<typeof arteConFotos> | null;
  foto?: { id: number; idArchivo: string } | null;
  usos: Record<string, number>;
  filaBloqueada?: (idArchivo: string) => boolean;
}) {
  const archivoDelete = vi.fn(() => Promise.resolve({}));
  const bloqueada = opciones.filaBloqueada ?? ((): boolean => true);
  const tx = {
    modelo: {
      findUnique: vi.fn(() => Promise.resolve({ codigo: 'M-1', idModeloDesarrollo: null })),
      update: vi.fn((args: { data: Record<string, unknown> }) => Promise.resolve(args)),
    },
    modeloArte: {
      findFirst: vi.fn(() => Promise.resolve(opciones.arte ?? null)),
      delete: vi.fn(() => Promise.resolve({})),
    },
    modeloArteFoto: {
      findFirst: vi.fn(() => Promise.resolve(opciones.foto ?? null)),
      delete: vi.fn(() => Promise.resolve({})),
      count: vi.fn((args: { where: { idArchivo: string } }) =>
        Promise.resolve(opciones.usos[args.where.idArchivo] ?? 0),
      ),
    },
    archivo: { delete: archivoDelete },
    bitacora: { create: vi.fn((args: { data: Record<string, unknown> }) => Promise.resolve(args)) },
    // `borrarArchivoSiQuedoHuerfano` bloquea la fila con un SELECT … FOR UPDATE y de ahí saca la key.
    $queryRaw: vi.fn((_plantilla: TemplateStringsArray, idArchivo: string) =>
      Promise.resolve(
        bloqueada(idArchivo) ? [{ id: idArchivo, key: `modelo-arte/${idArchivo}.jpg` }] : [],
      ),
    ),
  } as unknown as Tx;
  return { bd: { tx } as ContextoBd, tx, archivoDelete };
}

describe('quitarFotoArte — el objeto de R2 sigue la suerte de la fila (0.081a)', () => {
  it('⭐ foto que NO comparte nadie: se borra la fila Y el objeto del bucket', async () => {
    const { bd, archivoDelete } = bdParaArte({
      foto: { id: 3, idArchivo: 'arch1' },
      usos: { arch1: 0 },
    });
    const eliminarObjeto = vi.fn<ServicioArchivos['eliminarObjeto']>(() => Promise.resolve());

    await quitarFotoArte(sesionAdmin(), 7, 2, 3, bd, archivosFalsos(eliminarObjeto));

    expect(archivoDelete).toHaveBeenCalledTimes(1);
    expect(eliminarObjeto).toHaveBeenCalledWith('modelo-arte/arch1.jpg');
  });

  it('🔴🔴 GUARDIÁN: el objeto se borra DESPUÉS del commit, jamás dentro de la transacción', async () => {
    // Las demás pruebas de este archivo corren con `bd = { tx }`, y ahí `enTransaccion` toma el
    // atajo `fn(bd.tx)`: NO HAY COMMIT que observar, así que no pueden ver esta invariante. Ésta
    // pasa por `cliente.$transaction` de verdad y mira el bucket justo en el punto de commit.
    const { tx } = bdParaArte({ foto: { id: 3, idArchivo: 'arch1' }, usos: { arch1: 0 } });

    await exigirBorradoTrasElCommit(tx, ['modelo-arte/arch1.jpg'], (bd, eliminarObjeto) =>
      quitarFotoArte(sesionAdmin(), 7, 2, 3, bd, archivosFalsos(eliminarObjeto)),
    );
  });

  it('🔴🔴 foto COMPARTIDA por otro arte: NO se borra la fila y NO se toca el objeto', async () => {
    // Si esto fallara, el otro arte quedaría enseñando una imagen que ya no existe en R2.
    const { bd, archivoDelete } = bdParaArte({
      foto: { id: 3, idArchivo: 'arch1' },
      usos: { arch1: 1 },
    });
    const eliminarObjeto = vi.fn<ServicioArchivos['eliminarObjeto']>(() => Promise.resolve());

    await quitarFotoArte(sesionAdmin(), 7, 2, 3, bd, archivosFalsos(eliminarObjeto));

    expect(archivoDelete).not.toHaveBeenCalled();
    expect(eliminarObjeto).not.toHaveBeenCalled();
  });

  it('🔴 fila que otro camino ya borró (el candado no la encuentra): tampoco se toca el bucket', async () => {
    const { bd, archivoDelete } = bdParaArte({
      foto: { id: 3, idArchivo: 'arch1' },
      usos: { arch1: 0 },
      filaBloqueada: () => false,
    });
    const eliminarObjeto = vi.fn<ServicioArchivos['eliminarObjeto']>(() => Promise.resolve());

    await quitarFotoArte(sesionAdmin(), 7, 2, 3, bd, archivosFalsos(eliminarObjeto));

    expect(archivoDelete).not.toHaveBeenCalled();
    expect(eliminarObjeto).not.toHaveBeenCalled();
  });

  it('🔴 en NEGATIVO: si la foto no existe, la tx aborta y NO se toca el bucket', async () => {
    const { bd } = bdParaArte({ foto: null, usos: {} });
    const eliminarObjeto = vi.fn<ServicioArchivos['eliminarObjeto']>(() => Promise.resolve());

    await expect(
      quitarFotoArte(sesionAdmin(), 7, 2, 3, bd, archivosFalsos(eliminarObjeto)),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);

    expect(eliminarObjeto).not.toHaveBeenCalled();
  });

  it('🔴 en NEGATIVO: sin permiso no se borra nada, ni en la base ni en R2', async () => {
    const { bd, archivoDelete } = bdParaArte({
      foto: { id: 3, idArchivo: 'arch1' },
      usos: { arch1: 0 },
    });
    const eliminarObjeto = vi.fn<ServicioArchivos['eliminarObjeto']>(() => Promise.resolve());

    await expect(
      quitarFotoArte(sesionSoloVer(), 7, 2, 3, bd, archivosFalsos(eliminarObjeto)),
    ).rejects.toBeInstanceOf(ErrorPermiso);

    expect(archivoDelete).not.toHaveBeenCalled();
    expect(eliminarObjeto).not.toHaveBeenCalled();
  });

  it('best-effort: si R2 falla NO revienta, pero AVISA (nunca en silencio)', async () => {
    const { bd, archivoDelete } = bdParaArte({
      foto: { id: 3, idArchivo: 'arch1' },
      usos: { arch1: 0 },
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(
      quitarFotoArte(
        sesionAdmin(),
        7,
        2,
        3,
        bd,
        archivosFalsos(() => Promise.reject(new Error('R2 caído'))),
      ),
    ).resolves.toBeUndefined();

    expect(archivoDelete).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('eliminarArte — se lleva las fotos que quedan sin dueño, también de R2 (0.081a)', () => {
  it('⭐ borra del bucket SOLO las fotos huérfanas, no las compartidas', async () => {
    // El arte tiene dos fotos: `arch1` no la usa nadie más, `arch2` la comparte otro arte.
    const { bd, archivoDelete } = bdParaArte({
      arte: arteConFotos(2, ['arch1', 'arch2']),
      usos: { arch1: 0, arch2: 1 },
    });
    const eliminarObjeto = vi.fn<ServicioArchivos['eliminarObjeto']>(() => Promise.resolve());

    await eliminarArte(sesionAdmin(), 7, 2, bd, archivosFalsos(eliminarObjeto));

    expect(archivoDelete).toHaveBeenCalledTimes(1);
    expect(eliminarObjeto).toHaveBeenCalledTimes(1);
    expect(eliminarObjeto).toHaveBeenCalledWith('modelo-arte/arch1.jpg');
  });

  it('🔴🔴 GUARDIÁN: el objeto se borra DESPUÉS del commit, jamás dentro de la transacción', async () => {
    // Las demás pruebas de este archivo corren con `bd = { tx }`, y ahí `enTransaccion` toma el
    // atajo `fn(bd.tx)`: NO HAY COMMIT que observar, así que no pueden ver esta invariante. Ésta
    // pasa por `cliente.$transaction` de verdad y mira el bucket justo en el punto de commit.
    const { tx } = bdParaArte({
      arte: arteConFotos(2, ['arch1', 'arch2']),
      usos: { arch1: 0, arch2: 1 },
    });

    await exigirBorradoTrasElCommit(tx, ['modelo-arte/arch1.jpg'], (bd, eliminarObjeto) =>
      eliminarArte(sesionAdmin(), 7, 2, bd, archivosFalsos(eliminarObjeto)),
    );
  });

  it('🔴 en NEGATIVO: si el arte no existe, la tx aborta y NO se toca el bucket', async () => {
    const { bd } = bdParaArte({ arte: null, usos: {} });
    const eliminarObjeto = vi.fn<ServicioArchivos['eliminarObjeto']>(() => Promise.resolve());

    await expect(
      eliminarArte(sesionAdmin(), 7, 2, bd, archivosFalsos(eliminarObjeto)),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);

    expect(eliminarObjeto).not.toHaveBeenCalled();
  });

  it('🔴 en NEGATIVO: un arte cuyas fotos comparten TODAS otros artes no borra nada de R2', async () => {
    const { bd, archivoDelete } = bdParaArte({
      arte: arteConFotos(2, ['arch1', 'arch2']),
      usos: { arch1: 2, arch2: 1 },
    });
    const eliminarObjeto = vi.fn<ServicioArchivos['eliminarObjeto']>(() => Promise.resolve());

    await eliminarArte(sesionAdmin(), 7, 2, bd, archivosFalsos(eliminarObjeto));

    expect(archivoDelete).not.toHaveBeenCalled();
    expect(eliminarObjeto).not.toHaveBeenCalled();
  });
});
