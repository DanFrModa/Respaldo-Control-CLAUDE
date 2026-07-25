import { describe, expect, it, vi } from 'vitest';

import {
  configR2DesdeEnv,
  crearClienteR2,
  crearServicioArchivos,
  type ServicioArchivos,
} from '../../comun/archivos.js';
import { ErrorPermiso, ErrorValidacion } from '../../comun/errores.js';
import type { ContextoBd, Tx } from '../../comun/transaccion.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import { eliminarAdjunto, listarAdjuntos, solicitarSubidaAdjunto } from './adjuntos-orden.js';

/**
 * Unit del dominio de ADJUNTOS de la orden (F8-E6, R6) — SIN Postgres. Cubre lo que no necesita la
 * base: los guards de permiso (deny-by-default, A4), la validación de captura (Zod), que la key del
 * adjunto se ordene por id de la ORDEN (`ordenes/<id>/...`, A5) y el borrado físico de R2 en modo
 * BEST-EFFORT (si R2 falla no revierte el borrado del registro). La integridad transaccional real y
 * el scope de empresa (A9) se prueban contra Postgres en `adjuntos-orden.int.test.ts` (CI).
 */

const ENV_R2_FALSA = {
  R2_ACCOUNT_ID: 'cuenta123',
  R2_ACCESS_KEY_ID: 'llave-falsa',
  R2_SECRET_ACCESS_KEY: 'secreto-falso',
  R2_BUCKET: 'control-v2-prueba',
};

/** Servicio de archivos real con credenciales falsas (firma local, sin red). */
function archivosDePrueba(): ServicioArchivos {
  const config = configR2DesdeEnv(ENV_R2_FALSA);
  return crearServicioArchivos({ cliente: crearClienteR2(config), bucket: config.bucket });
}

const sesionAdmin = () => sesionDePrueba({ permisos: ['ordenes.ver', 'ordenes.administrar'] });
const sesionSoloVer = () => sesionDePrueba({ permisos: ['ordenes.ver'] });
const sesionSinNada = () => sesionDePrueba({ permisos: [] });

describe('dominio Adjuntos de orden (F8-E6) — permisos (deny-by-default, A4)', () => {
  it('subir adjunto sin ordenes.administrar → ErrorPermiso', async () => {
    await expect(
      solicitarSubidaAdjunto(
        sesionSoloVer(),
        1,
        { nombreOriginal: 'f.pdf', tipoMime: 'application/pdf', tamanoBytes: 10 },
        {},
        archivosDePrueba(),
      ),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('listar adjuntos sin ordenes.ver → ErrorPermiso', async () => {
    await expect(listarAdjuntos(sesionSinNada(), 1, {}, archivosDePrueba())).rejects.toBeInstanceOf(
      ErrorPermiso,
    );
  });

  it('eliminar adjunto sin ordenes.administrar → ErrorPermiso', async () => {
    await expect(
      eliminarAdjunto(sesionSoloVer(), 1, 'arch1', {}, archivosDePrueba()),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });
});

describe('dominio Adjuntos de orden (F8-E6) — validación de captura (A1)', () => {
  it('subir con nombre vacío → ErrorValidacion', async () => {
    await expect(
      solicitarSubidaAdjunto(
        sesionAdmin(),
        1,
        { nombreOriginal: '   ', tipoMime: 'application/pdf', tamanoBytes: 10 },
        {},
        archivosDePrueba(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('subir con MIME inválido → ErrorValidacion', async () => {
    await expect(
      solicitarSubidaAdjunto(
        sesionAdmin(),
        1,
        { nombreOriginal: 'f.pdf', tipoMime: 'no-es-mime', tamanoBytes: 10 },
        {},
        archivosDePrueba(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });
});

/**
 * Stub mínimo de la transacción de `solicitarSubidaAdjunto`: `orden.findFirst` devuelve la orden,
 * `archivo.create` lo hace el servicio de archivos real (fake creds), `ordenArchivo.create` y
 * `bitacora.create` se registran. `bd` envuelve el `tx` para que `enTransaccion` lo reutilice.
 */
function bdParaSubida(idOrden: number) {
  const archivoCreate = vi.fn(
    (args: { data: Record<string, unknown>; select: Record<string, true> }) =>
      Promise.resolve({ id: 'arch_nuevo', ...args.data }),
  );
  const ordenArchivoCreate = vi.fn((args: { data: Record<string, unknown> }) =>
    Promise.resolve({ id: 1, ...args.data }),
  );
  const tx = {
    orden: { findFirst: vi.fn(() => Promise.resolve({ id: idOrden })) },
    ordenArchivo: { create: ordenArchivoCreate },
    archivo: { create: archivoCreate },
    bitacora: { create: vi.fn((args: { data: Record<string, unknown> }) => Promise.resolve(args)) },
  } as unknown as Tx;
  const bd: ContextoBd = { tx };
  return { bd, archivoCreate, ordenArchivoCreate };
}

describe('dominio Adjuntos de orden (F8-E6) — la key se ordena por id de la orden (A5)', () => {
  it('crea el Archivo con key ordenes/<id>/... (por id) y liga el OrdenArchivo', async () => {
    const { bd, archivoCreate, ordenArchivoCreate } = bdParaSubida(42);
    const salida = await solicitarSubidaAdjunto(
      sesionAdmin(),
      42,
      { nombreOriginal: 'costos.xlsx', tipoMime: 'application/vnd.ms-excel', tamanoBytes: 2048 },
      bd,
      archivosDePrueba(),
    );

    const keyCreada = archivoCreate.mock.calls[0]?.[0].data.key as string;
    expect(keyCreada.startsWith('ordenes/42/')).toBe(true);
    // Se ligó el OrdenArchivo al Archivo recién creado.
    expect(ordenArchivoCreate).toHaveBeenCalledTimes(1);
    expect(ordenArchivoCreate.mock.calls[0]?.[0].data.idOrden).toBe(42);
    expect(salida.idArchivo).toBe('arch_nuevo');
    expect(salida.urlSubida).toContain('https://');
  });
});

/**
 * Stub de la transacción de `eliminarAdjunto`: la orden y el adjunto existen; `archivo.delete` y
 * `bitacora.create` se registran. Devuelve las mocks para verificar el borrado.
 */
function bdParaBorrado(idOrden: number, key: string) {
  const archivoDelete = vi.fn(() => Promise.resolve({}));
  const tx = {
    orden: { findFirst: vi.fn(() => Promise.resolve({ id: idOrden })) },
    ordenArchivo: {
      findFirst: vi.fn(() =>
        Promise.resolve({ idArchivo: 'arch1', archivo: { key, nombreOriginal: 'f.pdf' } }),
      ),
    },
    archivo: { delete: archivoDelete },
    bitacora: { create: vi.fn((args: { data: Record<string, unknown> }) => Promise.resolve(args)) },
  } as unknown as Tx;
  const bd: ContextoBd = { tx };
  return { bd, archivoDelete };
}

describe('dominio Adjuntos de orden (F8-E6) — borrado físico R2 best-effort', () => {
  it('borra el registro y llama eliminarObjeto con la key del objeto', async () => {
    const { bd, archivoDelete } = bdParaBorrado(7, 'ordenes/7/uuid/f.pdf');
    const eliminarObjeto = vi.fn(() => Promise.resolve());
    const archivos: ServicioArchivos = {
      solicitarSubida: () => {
        throw new Error('no debe llamarse');
      },
      subirContenido: () => {
        throw new Error('no debe llamarse');
      },
      urlDescarga: () => Promise.reject(new Error('no debe llamarse')),
      descargarContenido: () => Promise.reject(new Error('no debe llamarse')),
      eliminarObjeto,
    };

    await eliminarAdjunto(sesionAdmin(), 7, 'arch1', bd, archivos);

    expect(archivoDelete).toHaveBeenCalledTimes(1);
    expect(eliminarObjeto).toHaveBeenCalledWith('ordenes/7/uuid/f.pdf');
  });

  it('si R2 falla, NO revierte el borrado del registro (best-effort): resuelve sin lanzar', async () => {
    const { bd, archivoDelete } = bdParaBorrado(7, 'ordenes/7/uuid/f.pdf');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const archivos: ServicioArchivos = {
      solicitarSubida: () => {
        throw new Error('no debe llamarse');
      },
      subirContenido: () => {
        throw new Error('no debe llamarse');
      },
      urlDescarga: () => Promise.reject(new Error('no debe llamarse')),
      descargarContenido: () => Promise.reject(new Error('no debe llamarse')),
      eliminarObjeto: () => Promise.reject(new Error('R2 caído')),
    };

    // NO debe lanzar aunque R2 falle.
    await expect(eliminarAdjunto(sesionAdmin(), 7, 'arch1', bd, archivos)).resolves.toBeUndefined();
    // El registro SÍ se borró (la transacción de BD ya había hecho commit).
    expect(archivoDelete).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
