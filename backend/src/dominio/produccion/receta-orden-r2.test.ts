/**
 * ⭐⭐ FILA **0.091** — quitar un renglón de arte AGREGADO A MANO no puede dejar sus fotos en R2.
 *
 * `OrdenArteFoto` cae en `onDelete: Cascade` hacia `OrdenArte`. Borrar el renglón se lleva el
 * puente **por el lado del padre** y —hasta esta etapa— dejaba la fila `Archivo` viva y su objeto
 * en Cloudflare R2 pagándose para siempre. El embudo de la 0.081(a) no lo atrapaba: cuelga de
 * `archivo.delete`, no de la cascada.
 *
 * Aquí se prueban las dos mitades:
 *  1. que las fotos PROPIAS se liberan (fila + objeto), y que las heredadas no se tocan;
 *  2. 🔴 que el objeto se borra **DESPUÉS del commit** — con el guardián compartido de la 0.081(a)
 *     (`pruebas/commit-r2.ts`), porque las pruebas con `bd = { tx }` no tienen commit que observar
 *     y aprobarían igual la violación.
 */
import { describe, expect, it, vi } from 'vitest';

import type { ServicioArchivos } from '../../comun/archivos.js';
import type { ContextoBd, Tx } from '../../comun/transaccion.js';
import { exigirBorradoTrasElCommit } from '../../pruebas/commit-r2.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';

// Vecinos que este archivo NO prueba. Se neutralizan para que el stub de la transacción no tenga
// que fingir media docena de consultas ajenas al borrado; lo que SÍ corre de verdad es el camino
// `quitarRenglonReceta` → `liberarFotosPropiasDeArteOrden` → `eliminarObjetosBestEffort`.
vi.mock('./requisitos-orden.js', () => ({
  recalcularEstadoOrden: () => Promise.resolve(),
}));
vi.mock('../modelos/bom-modelo.js', () => ({
  leerTelasBom: () => Promise.resolve([]),
  leerAviosBom: () => Promise.resolve([]),
  leerMedidasAvioBom: () => Promise.resolve(new Map()),
}));
vi.mock('../modelos/arte-modelo.js', () => ({
  leerArtesModelo: () => Promise.resolve([]),
}));
vi.mock('../compras/aviso-ya-comprado.js', () => ({
  comprasComprometidasDeUnaOrden: () => Promise.resolve(new Map()),
  avisoCambioSobreLoComprado: () => null,
  avisoReabrirConCompraComprometida: () => null,
  ocsDeMaterial: () => [],
}));

const { liberarFotosPropiasDeArteOrden, quitarRenglonReceta } = await import('./receta-orden.js');

const sesionAdmin = (): ReturnType<typeof sesionDePrueba> =>
  sesionDePrueba({ permisos: ['desarrollo.ver', 'desarrollo.administrar', 'ordenes.ver'] });

/**
 * Doble de `ServicioArchivos` en el que SOLO `eliminarObjeto` es legal.
 *
 * ⚠️ El tipo sale de la INTERFAZ (`ServicioArchivos['eliminarObjeto']`), nunca de un
 * `() => Promise<void>` a mano: con una firma sin argumentos, `vi.fn` infiere `mock.calls` como
 * `[][]` y ninguna aserción podría comprobar QUÉ key se borró — y borrar la key equivocada es el
 * peor fallo posible de esta familia de pruebas.
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

const ID_ORDEN = 55;
const ID_ARTE = 900;

/** Un renglón de arte con la forma que devuelve `SELECT_ARTE`. */
function arteDeLaOrden(agregadoAMano: boolean) {
  return {
    id: ID_ARTE,
    idModeloArte: agregadoAMano ? null : 12,
    descripcion: 'Bordado pecho',
    posicion: 'FRENTE',
    puntadas: 5000,
    precio: null,
    idTipoArte: 1,
    idProveedor: null,
    estado: 'revisado',
    agregadoAMano,
    excluido: false,
    notas: null,
    liberadoEn: null,
    liberadoPorId: null,
    proveedor: null,
    tipoArte: { nombre: 'Bordado', codigo: 'BOR', usaPuntadas: true },
  };
}

/**
 * Stub de la transacción con lo mínimo que recorre `quitarRenglonReceta` sobre un ARTE: la orden,
 * el renglón, sus fotos propias, el borrado y la bitácora. Todo lo demás contesta vacío.
 *
 * ---
 * ⚠️⚠️ **Y las CINCO consultas del aviso de hermanas (0.090), que este doble tiene que servir
 * enteras.** `armarReceta` llama a `frenteAlGrupoDeOrdenes`, y ese cargador pide:
 *
 *  1. `orden.findMany` — el LINAJE de las órdenes pedidas (`select: {id, modelo}`);
 *  2. `orden.findMany` — toda la FAMILIA de esos linajes (`select: {id, folio, modelo}`);
 *  3. `ordenTela.findMany` · 4. `ordenAvio.findMany` · 5. `ordenArte.findMany` — su receta congelada.
 *
 * 🔴 **Este archivo se puso ROJO al juntar las dos etapas** (`lector.orden.findMany is not a
 * function`): el doble se escribió a la medida del camino que `quitarRenglonReceta` recorría
 * ENTONCES, y por debajo le creció una llamada nueva. Las tres pruebas cayeron a la vez.
 *
 * ⭐ **Por qué `orden.findMany` devuelve LA ORDEN y no `[]`, que es lo que arreglaría el `TypeError`
 * igual de rápido.** Con `[]`, el cargador corta en la consulta 1 (`if (pedidas.length === 0)
 * return new Map()`) y **las otras cuatro no se ejecutan nunca**: el guardián volvería a verde con
 * el aviso de hermanas apagado, y el próximo defecto en ese camino —o una sexta consulta— pasaría
 * inadvertido otra vez. Devolviendo la orden, las cinco corren de verdad contra este doble, que es
 * la única protección que un stub puede dar. Además `[]` sería **incoherente con el resto del
 * doble**: `orden.findFirst` sí devuelve la orden 55; un `findMany` vacío modelaría una base en la
 * que esa orden no existe.
 *
 * ⚠️ **Las tres tablas de receta SÍ contestan vacío, y eso es correcto AQUÍ:** este stub describe
 * una familia de UNA sola orden cuya receta congelada está vacía, así que el resultado honesto es
 * *«no hay hermanas con quién compararse»* — no es la función silenciada, es la función corriendo
 * entera y concluyendo lo que toca. Poblarlas obligaría a inventar una hermana y a fingir sus
 * renglones, y este archivo vigila el borrado en R2, no la comparación.
 */
function bdParaQuitarArte(opciones: {
  agregadoAMano: boolean;
  fotos: { idArchivo: string; key: string; nombreOriginal: string }[];
}) {
  const archivoDeleteMany = vi.fn(() => Promise.resolve({ count: 0 }));
  const ordenArteDelete = vi.fn(() => Promise.resolve({}));
  const ordenArteUpdate = vi.fn(() => Promise.resolve({}));
  const bitacoraCreate = vi.fn((args: { data: Record<string, unknown> }) => Promise.resolve(args));
  const vacio = vi.fn(() => Promise.resolve([]));

  const orden = {
    id: ID_ORDEN,
    folio: 1234n,
    idEmpresa: 1,
    idModelo: 7,
    estado: 'capturada',
    // 0.061: ABIERTA. La guarda del cierre mira esta columna y trata «no viene» como CERRADA
    // (falla del lado seguro): un doble que la calle mentiría sobre el dato.
    cerradaEn: null,
    fechaCompletada: null,
    recetaLiberadaEn: null,
    recetaLiberadaPorId: null,
    recetaAbiertaEn: null,
    recetaAbiertaPorId: null,
    recetaAbiertaMotivo: null,
    modelo: { codigo: 'M-1', curvaTalla: null },
    fechaEntrega: null,
    cliente: { nombre: 'C&A' },
  };

  // Las DOS consultas de `frenteAlGrupoDeOrdenes` sobre `orden` (linaje pedido y familia) se
  // sirven con un mismo objeto: lleva `id`, `folio` y `modelo` con la forma de
  // `SELECT_LINAJE_RECETA`, así que vale para los dos `select`. `idModeloDesarrollo: null` = «la
  // receta es la mía» ⇒ el linaje es el propio modelo, que es el caso de esta orden.
  const ordenDelLinaje = {
    id: ID_ORDEN,
    folio: orden.folio,
    modelo: { id: 7, idModeloDesarrollo: null },
  };

  const tx = {
    orden: {
      findFirst: vi.fn(() => Promise.resolve(orden)),
      findMany: vi.fn(() => Promise.resolve([ordenDelLinaje])),
      findUniqueOrThrow: vi.fn(() =>
        Promise.resolve({ recetaLiberadaEn: null, recetaLiberadaPorId: null }),
      ),
      update: vi.fn(() => Promise.resolve({})),
    },
    ordenTela: { findMany: vacio },
    ordenAvio: { findMany: vacio },
    ordenArte: {
      findFirst: vi.fn(() => Promise.resolve(arteDeLaOrden(opciones.agregadoAMano))),
      findMany: vacio,
      delete: ordenArteDelete,
      update: ordenArteUpdate,
    },
    ordenArteFoto: {
      findMany: vi.fn(() =>
        Promise.resolve(
          opciones.fotos.map((f) => ({
            idArchivo: f.idArchivo,
            archivo: { key: f.key, nombreOriginal: f.nombreOriginal },
          })),
        ),
      ),
    },
    archivo: { deleteMany: archivoDeleteMany },
    ordenCompraLinea: { count: vi.fn(() => Promise.resolve(0)) },
    ordenLineaTalla: {
      findMany: vacio,
      groupBy: vacio,
      aggregate: vi.fn(() => Promise.resolve({ _sum: { cantidad: null } })),
    },
    proveedor: { findMany: vacio },
    bitacora: { create: bitacoraCreate },
  } as unknown as Tx;

  return {
    bd: { tx } as ContextoBd,
    tx,
    archivoDeleteMany,
    ordenArteDelete,
    ordenArteUpdate,
    bitacoraCreate,
  };
}

describe('liberarFotosPropiasDeArteOrden — la pieza que tapa la cascada', () => {
  it('borra los `Archivo` de las fotos propias y devuelve sus keys y nombres', async () => {
    const { tx, archivoDeleteMany } = bdParaQuitarArte({
      agregadoAMano: true,
      fotos: [
        { idArchivo: 'a1', key: 'orden-arte/a1.jpg', nombreOriginal: 'frente.jpg' },
        { idArchivo: 'a2', key: 'orden-arte/a2.jpg', nombreOriginal: 'espalda.jpg' },
      ],
    });

    const liberadas = await liberarFotosPropiasDeArteOrden(tx, ID_ARTE);

    expect(liberadas).toEqual([
      { key: 'orden-arte/a1.jpg', nombreOriginal: 'frente.jpg' },
      { key: 'orden-arte/a2.jpg', nombreOriginal: 'espalda.jpg' },
    ]);
    // Se borra el ARCHIVO (la Cascade se lleva el `OrdenArteFoto`): un solo paso, sin huérfano
    // posible entre dos borrados.
    expect(archivoDeleteMany).toHaveBeenCalledWith({ where: { id: { in: ['a1', 'a2'] } } });
  });

  it('sin fotos propias no toca la base ni devuelve keys', async () => {
    const { tx, archivoDeleteMany } = bdParaQuitarArte({ agregadoAMano: true, fotos: [] });

    expect(await liberarFotosPropiasDeArteOrden(tx, ID_ARTE)).toEqual([]);
    expect(archivoDeleteMany).not.toHaveBeenCalled();
  });
});

describe('⭐ quitarRenglonReceta (arte) — el renglón se va y sus fotos propias con él', () => {
  it('AGREGADO A MANO: borra el renglón, sus `Archivo` y el objeto del bucket', async () => {
    const { bd, archivoDeleteMany, ordenArteDelete, bitacoraCreate } = bdParaQuitarArte({
      agregadoAMano: true,
      fotos: [{ idArchivo: 'a1', key: 'orden-arte/a1.jpg', nombreOriginal: 'frente.jpg' }],
    });
    const eliminarObjeto = vi.fn<ServicioArchivos['eliminarObjeto']>(() => Promise.resolve());

    await quitarRenglonReceta(
      sesionAdmin(),
      ID_ORDEN,
      'arte',
      ID_ARTE,
      {},
      bd,
      archivosFalsos(eliminarObjeto),
    );

    expect(archivoDeleteMany).toHaveBeenCalledWith({ where: { id: { in: ['a1'] } } });
    expect(ordenArteDelete).toHaveBeenCalledTimes(1);
    expect(eliminarObjeto).toHaveBeenCalledWith('orden-arte/a1.jpg');

    // D3: el rastro dice QUÉ fotos se fueron, no cuántas.
    const rastro = bitacoraCreate.mock.calls
      .map((llamada) => llamada[0].data)
      .find((datos) => JSON.stringify(datos).includes('fotosPropiasBorradas'));
    expect(rastro, 'la bitácora no dejó constancia de las fotos que se fueron').toBeDefined();
    expect(JSON.stringify(rastro)).toContain('frente.jpg');
  });

  it('🔴 renglón que vino del MODELO: se EXCLUYE, y ni la base ni el bucket pierden nada', async () => {
    // La rama gemela. Un renglón heredado no se borra (lápida `excluido`), así que sus fotos —que
    // ni siquiera son suyas: son del arte del modelo— no se pueden tocar. Si esto fallara, quitar
    // un arte de UNA orden borraría la foto que el modelo enseña en TODAS las demás.
    const { bd, archivoDeleteMany, ordenArteDelete, ordenArteUpdate } = bdParaQuitarArte({
      agregadoAMano: false,
      fotos: [{ idArchivo: 'a1', key: 'orden-arte/a1.jpg', nombreOriginal: 'frente.jpg' }],
    });
    const eliminarObjeto = vi.fn<ServicioArchivos['eliminarObjeto']>(() => Promise.resolve());

    await quitarRenglonReceta(
      sesionAdmin(),
      ID_ORDEN,
      'arte',
      ID_ARTE,
      {},
      bd,
      archivosFalsos(eliminarObjeto),
    );

    expect(ordenArteUpdate).toHaveBeenCalledTimes(1);
    expect(ordenArteDelete).not.toHaveBeenCalled();
    expect(archivoDeleteMany).not.toHaveBeenCalled();
    expect(eliminarObjeto).not.toHaveBeenCalled();
  });

  it('🔴🔴 GUARDIÁN: el objeto se borra DESPUÉS del commit, jamás dentro de la transacción', async () => {
    // Las otras pruebas de este archivo corren con `bd = { tx }`, y ahí `enTransaccion` toma el
    // atajo `fn(bd.tx)`: NO HAY COMMIT que observar, así que no pueden ver esta invariante. Ésta
    // pasa por `cliente.$transaction` de verdad y mira el bucket justo en el punto de commit.
    const { tx } = bdParaQuitarArte({
      agregadoAMano: true,
      fotos: [{ idArchivo: 'a1', key: 'orden-arte/a1.jpg', nombreOriginal: 'frente.jpg' }],
    });

    await exigirBorradoTrasElCommit(tx, ['orden-arte/a1.jpg'], (bd, eliminarObjeto) =>
      quitarRenglonReceta(
        sesionAdmin(),
        ID_ORDEN,
        'arte',
        ID_ARTE,
        {},
        bd,
        archivosFalsos(eliminarObjeto),
      ),
    );
  });
});
