import { describe, expect, it, vi } from 'vitest';

import { ErrorPermiso, ErrorValidacion } from '../../comun/errores.js';
import type { ContextoBd, Tx } from '../../comun/transaccion.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import {
  actualizarPreciosOrden,
  listarEventosPrecioOrden,
  obtenerPreciosOrden,
} from './precios-orden.js';

/**
 * Unit del dominio de PRECIOS de la orden (rediseño R2, §4.4.3) — SIN Postgres. Cubre los guards
 * de permisos (deny-by-default, A4: capturar exige `ordenes.precio-maquila`; el historial exige
 * `ordenes.ver-precio-real-maquila`), la validación Zod (campo/precio), y el GATEO de lectura del
 * resumen (los montos reales van null sin permiso; `precioVenta` null sin `pedidos.importes`).
 * La integridad transaccional real (evento insertado con anterior→nuevo, bitácora, orden de otra
 * empresa = 404, cancelada = 409) vive en `precios-orden.int.test.ts` (CI).
 */

const D = (n: number) => ({ toNumber: () => n });

/** Stub de lectura: una orden con precios reales, referencia del modelo y un evento por campo. */
function bdLectura(): ContextoBd {
  const evento = (id: number, campo: 'maquila' | 'aplicacion') => ({
    id,
    campo,
    precioAnterior: null,
    precioNuevo: D(campo === 'maquila' ? 25 : 6),
    idProveedor: 7,
    proveedor: { nombre: 'Óscar Jiménez' },
    nota: null,
    capturadoPorId: 'u-daniel',
    capturadoEn: new Date('2026-07-01T12:00:00Z'),
  });
  const tx = {
    orden: {
      findFirst: vi.fn(() =>
        Promise.resolve({
          id: 5,
          folio: 5424n,
          maquilaOrd: D(25),
          aplicacionOrd: D(6),
          modelo: { maquilaBase: D(23.5) },
          pedidoLinea: { precio: D(148) },
        }),
      ),
    },
    // El resumen pide SOLO el último evento por campo (distinct + desc, acotado).
    ordenPrecioEvento: {
      findMany: vi.fn(() => Promise.resolve([evento(2, 'aplicacion'), evento(1, 'maquila')])),
    },
    usuario: {
      findMany: vi.fn(() => Promise.resolve([{ id: 'u-daniel', nombre: 'Daniel Masri' }])),
    },
  } as unknown as Tx;
  return { tx };
}

describe('precios de la orden — permisos (deny-by-default, A4)', () => {
  it('capturar sin ordenes.precio-maquila → ErrorPermiso', async () => {
    const s = sesionDePrueba({ permisos: ['ordenes.ver', 'ordenes.administrar'] });
    await expect(
      actualizarPreciosOrden(s, 1, { campo: 'maquila', precio: 25 }),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('resumen sin ordenes.ver → ErrorPermiso', async () => {
    const s = sesionDePrueba({ permisos: [] });
    await expect(obtenerPreciosOrden(s, 1)).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('historial sin ordenes.ver-precio-real-maquila → ErrorPermiso (aunque tenga ordenes.ver)', async () => {
    const s = sesionDePrueba({ permisos: ['ordenes.ver'] });
    await expect(listarEventosPrecioOrden(s, 1)).rejects.toBeInstanceOf(ErrorPermiso);
  });
});

describe('precios de la orden — validación de captura (A1)', () => {
  const sesionConPermiso = () =>
    sesionDePrueba({ permisos: ['ordenes.ver', 'ordenes.precio-maquila'] });

  it('campo desconocido → ErrorValidacion', async () => {
    await expect(
      actualizarPreciosOrden(sesionConPermiso(), 1, { campo: 'bordado', precio: 5 } as never),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('precio negativo → ErrorValidacion', async () => {
    await expect(
      actualizarPreciosOrden(sesionConPermiso(), 1, { campo: 'maquila', precio: -1 }),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });
});

describe('precios de la orden — gateo de lectura del resumen (§4.4.3)', () => {
  it('CON ver-precio-real-maquila y pedidos.importes: montos completos + rastro con nombre', async () => {
    const s = sesionDePrueba({
      permisos: ['ordenes.ver', 'ordenes.ver-precio-real-maquila', 'pedidos.importes'],
    });
    const resumen = await obtenerPreciosOrden(s, 5, bdLectura());
    expect(resumen.puedeVerReales).toBe(true);
    expect(resumen.precioVenta).toBe(148);
    expect(resumen.maquilaReferencia).toBe(23.5);
    expect(resumen.maquilaReal).toBe(25);
    expect(resumen.aplicacionReal).toBe(6);
    expect(resumen.ultimoEventoMaquila?.capturadoPor).toBe('Daniel Masri');
    expect(resumen.ultimoEventoMaquila?.proveedor).toBe('Óscar Jiménez');
    expect(resumen.ultimoEventoAplicacion?.capturadoPor).toBe('Daniel Masri');
  });

  it('SIN ver-precio-real-maquila: los montos reales van null (la referencia del modelo sí sale)', async () => {
    const s = sesionDePrueba({ permisos: ['ordenes.ver', 'pedidos.importes'] });
    const resumen = await obtenerPreciosOrden(s, 5, bdLectura());
    expect(resumen.puedeVerReales).toBe(false);
    expect(resumen.maquilaReal).toBeNull();
    expect(resumen.aplicacionReal).toBeNull();
    expect(resumen.maquilaReferencia).toBe(23.5);
  });

  it('SIN pedidos.importes: precioVenta va null (regla de importes del doc 02 §3)', async () => {
    const s = sesionDePrueba({ permisos: ['ordenes.ver', 'ordenes.ver-precio-real-maquila'] });
    const resumen = await obtenerPreciosOrden(s, 5, bdLectura());
    expect(resumen.precioVenta).toBeNull();
    expect(resumen.maquilaReal).toBe(25);
  });
});

describe('precios de la orden — captura con rastro (A2/A7, D3)', () => {
  /** Stub transaccional: orden viva sin precio previo; captura de maquila. */
  function bdCaptura() {
    const creado: unknown[] = [];
    const tx = {
      // El lock de concurrencia (pg_advisory_xact_lock) va PRIMERO en la tx.
      $executeRaw: vi.fn(() => Promise.resolve(0)),
      orden: {
        findFirst: vi.fn(() =>
          Promise.resolve({
            id: 5,
            folio: 5424n,
            estado: 'completa',
            // 0.061: ABIERTA. La guarda del cierre mira esta columna y trata «no viene» como
            // CERRADA (falla del lado seguro): un doble que la calle mentiría sobre el dato.
            cerradaEn: null,
            maquilaOrd: null,
            aplicacionOrd: null,
            // Para el re-read del resumen tras el PATCH:
            modelo: { maquilaBase: null },
            pedidoLinea: null,
          }),
        ),
        update: vi.fn(() => Promise.resolve({})),
      },
      proveedor: {
        findUnique: vi.fn(() => Promise.resolve({ activo: true, nombre: 'Óscar Jiménez' })),
      },
      ordenPrecioEvento: {
        create: vi.fn((args: unknown) => {
          creado.push(args);
          return Promise.resolve({ id: 1 });
        }),
        findMany: vi.fn(() => Promise.resolve([])),
      },
      bitacora: { create: vi.fn(() => Promise.resolve({})) },
      usuario: { findMany: vi.fn(() => Promise.resolve([])) },
    } as unknown as Tx;
    return { bd: { tx } as ContextoBd, tx, creado };
  }

  it('inserta el evento (anterior null → nuevo) y actualiza maquilaOrd en la misma transacción', async () => {
    const s = sesionDePrueba({ permisos: ['ordenes.ver', 'ordenes.precio-maquila'] });
    const { bd, tx, creado } = bdCaptura();
    await actualizarPreciosOrden(s, 5, { campo: 'maquila', precio: 27.5, idProveedor: 7 }, bd);

    const txMock = tx as unknown as {
      $executeRaw: ReturnType<typeof vi.fn>;
      orden: { update: ReturnType<typeof vi.fn>; findFirst: ReturnType<typeof vi.fn> };
      bitacora: { create: ReturnType<typeof vi.fn> };
    };
    // El LOCK (pg_advisory_xact_lock) corre ANTES de leer el precio anterior: es lo que
    // serializa dos capturas concurrentes y hace real el encadenado anterior→nuevo.
    expect(txMock.$executeRaw).toHaveBeenCalledTimes(1);
    expect(txMock.$executeRaw.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER).toBeLessThan(
      txMock.orden.findFirst.mock.invocationCallOrder[0] ?? 0,
    );
    const llamadasUpdate = txMock.orden.update.mock.calls as [
      { where: { id: number }; data: Record<string, unknown> },
    ][];
    expect(llamadasUpdate).toHaveLength(1);
    expect(llamadasUpdate[0]?.[0]?.data['maquilaOrd']).toBe(27.5);
    expect(creado).toHaveLength(1);
    expect(creado[0]).toMatchObject({
      data: {
        campo: 'maquila',
        precioAnterior: null,
        precioNuevo: 27.5,
        idProveedor: 7,
      },
    });
    expect(txMock.bitacora.create).toHaveBeenCalled();
  });

  it('el PATCH devuelve el monto que el usuario ACABA de capturar aunque no pueda ver reales', async () => {
    const s = sesionDePrueba({ permisos: ['ordenes.ver', 'ordenes.precio-maquila'] });
    const { bd } = bdCaptura();
    const resumen = await actualizarPreciosOrden(s, 5, { campo: 'maquila', precio: 27.5 }, bd);
    expect(resumen.puedeVerReales).toBe(false);
    expect(resumen.maquilaReal).toBe(27.5); // lo que tecleó; lo demás sigue oculto
    expect(resumen.aplicacionReal).toBeNull();
  });
});
