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
import {
  eliminarAdjuntoEntradaTela,
  listarAdjuntosEntradaTela,
  solicitarSubidaAdjuntoEntradaTela,
} from './adjuntos-entrada-tela.js';

/**
 * Unit del dominio de ADJUNTOS de la ENTRADA DE TELA (B1 — el PDF de la factura del proveedor) —
 * SIN Postgres. Espejo de `produccion/adjuntos-orden.test.ts`: cubre lo que no necesita la base —
 * los guards de permiso (deny-by-default, A4: `inventario-telas.mover` para mutar,
 * `inventario-telas.ver` para leer), la validación de captura (Zod), que la key del adjunto se
 * ordene por id del DOCUMENTO (`entradas-tela/<id>/...`, A5) y el borrado físico de R2 en modo
 * BEST-EFFORT (si R2 falla no revierte el borrado del registro). La integridad transaccional real y
 * el scope de empresa (A9) se prueban contra Postgres en `adjuntos-entrada-tela.int.test.ts` (CI).
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

const sesionMover = () =>
  sesionDePrueba({ permisos: ['inventario-telas.ver', 'inventario-telas.mover'] });
const sesionSoloVer = () => sesionDePrueba({ permisos: ['inventario-telas.ver'] });
const sesionSinNada = () => sesionDePrueba({ permisos: [] });

describe('dominio Adjuntos de entrada de tela (B1) — permisos (deny-by-default, A4)', () => {
  it('subir adjunto sin inventario-telas.mover → ErrorPermiso', async () => {
    await expect(
      solicitarSubidaAdjuntoEntradaTela(
        sesionSoloVer(),
        1,
        { nombreOriginal: 'f.pdf', tipoMime: 'application/pdf', tamanoBytes: 10 },
        {},
        archivosDePrueba(),
      ),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('listar adjuntos sin inventario-telas.ver → ErrorPermiso', async () => {
    await expect(
      listarAdjuntosEntradaTela(sesionSinNada(), 1, {}, archivosDePrueba()),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('eliminar adjunto sin inventario-telas.mover → ErrorPermiso', async () => {
    await expect(
      eliminarAdjuntoEntradaTela(sesionSoloVer(), 1, 'arch1', {}, archivosDePrueba()),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });
});

describe('dominio Adjuntos de entrada de tela (B1) — validación de captura (A1)', () => {
  it('subir con nombre vacío → ErrorValidacion', async () => {
    await expect(
      solicitarSubidaAdjuntoEntradaTela(
        sesionMover(),
        1,
        { nombreOriginal: '   ', tipoMime: 'application/pdf', tamanoBytes: 10 },
        {},
        archivosDePrueba(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('subir con MIME inválido → ErrorValidacion', async () => {
    await expect(
      solicitarSubidaAdjuntoEntradaTela(
        sesionMover(),
        1,
        { nombreOriginal: 'f.pdf', tipoMime: 'no-es-mime', tamanoBytes: 10 },
        {},
        archivosDePrueba(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });
});

/**
 * Stub mínimo de la transacción de `solicitarSubidaAdjuntoEntradaTela`: `entradaTela.findFirst`
 * devuelve el documento, `archivo.create` lo hace el servicio de archivos real (fake creds),
 * `entradaTelaArchivo.create` y `bitacora.create` se registran.
 */
function bdParaSubida(idEntrada: number) {
  const archivoCreate = vi.fn(
    (args: { data: Record<string, unknown>; select: Record<string, true> }) =>
      Promise.resolve({ id: 'arch_nuevo', ...args.data }),
  );
  const entradaArchivoCreate = vi.fn((args: { data: Record<string, unknown> }) =>
    Promise.resolve({ id: 1, ...args.data }),
  );
  const tx = {
    entradaTela: { findFirst: vi.fn(() => Promise.resolve({ id: idEntrada })) },
    entradaTelaArchivo: { create: entradaArchivoCreate },
    archivo: { create: archivoCreate },
    bitacora: { create: vi.fn((args: { data: Record<string, unknown> }) => Promise.resolve(args)) },
  } as unknown as Tx;
  const bd: ContextoBd = { tx };
  return { bd, archivoCreate, entradaArchivoCreate };
}

describe('dominio Adjuntos de entrada de tela (B1) — la key se ordena por id del documento (A5)', () => {
  it('crea el Archivo con key entradas-tela/<id>/... y liga el EntradaTelaArchivo', async () => {
    const { bd, archivoCreate, entradaArchivoCreate } = bdParaSubida(42);
    const salida = await solicitarSubidaAdjuntoEntradaTela(
      sesionMover(),
      42,
      { nombreOriginal: 'factura.pdf', tipoMime: 'application/pdf', tamanoBytes: 2048 },
      bd,
      archivosDePrueba(),
    );

    const keyCreada = archivoCreate.mock.calls[0]?.[0].data.key as string;
    expect(keyCreada.startsWith('entradas-tela/42/')).toBe(true);
    expect(entradaArchivoCreate).toHaveBeenCalledTimes(1);
    expect(entradaArchivoCreate.mock.calls[0]?.[0].data.idEntradaTela).toBe(42);
    expect(salida.idArchivo).toBe('arch_nuevo');
    expect(salida.urlSubida).toContain('https://');
  });
});

/** Stub de la transacción de `eliminarAdjuntoEntradaTela`: el documento y el adjunto existen. */
function bdParaBorrado(idEntrada: number, key: string) {
  const archivoDelete = vi.fn(() => Promise.resolve({}));
  const tx = {
    entradaTela: { findFirst: vi.fn(() => Promise.resolve({ id: idEntrada })) },
    entradaTelaArchivo: {
      findFirst: vi.fn(() =>
        Promise.resolve({ idArchivo: 'arch1', archivo: { key, nombreOriginal: 'factura.pdf' } }),
      ),
    },
    archivo: { delete: archivoDelete },
    bitacora: { create: vi.fn((args: { data: Record<string, unknown> }) => Promise.resolve(args)) },
  } as unknown as Tx;
  const bd: ContextoBd = { tx };
  return { bd, archivoDelete };
}

/** Servicio de archivos falso donde SOLO `eliminarObjeto` es válido (lo demás truena si se usa). */
function archivosSoloBorrado(eliminarObjeto: () => Promise<void>): ServicioArchivos {
  return {
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
}

describe('dominio Adjuntos de entrada de tela (B1) — borrado físico R2 best-effort', () => {
  it('borra el registro y llama eliminarObjeto con la key del objeto', async () => {
    const { bd, archivoDelete } = bdParaBorrado(7, 'entradas-tela/7/uuid/factura.pdf');
    const eliminarObjeto = vi.fn(() => Promise.resolve());

    await eliminarAdjuntoEntradaTela(
      sesionMover(),
      7,
      'arch1',
      bd,
      archivosSoloBorrado(eliminarObjeto),
    );

    expect(archivoDelete).toHaveBeenCalledTimes(1);
    expect(eliminarObjeto).toHaveBeenCalledWith('entradas-tela/7/uuid/factura.pdf');
  });

  it('si R2 falla, NO revierte el borrado del registro (best-effort): resuelve sin lanzar', async () => {
    const { bd, archivoDelete } = bdParaBorrado(7, 'entradas-tela/7/uuid/factura.pdf');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(
      eliminarAdjuntoEntradaTela(
        sesionMover(),
        7,
        'arch1',
        bd,
        archivosSoloBorrado(() => Promise.reject(new Error('R2 caído'))),
      ),
    ).resolves.toBeUndefined();

    // El registro SÍ se borró (la transacción de BD ya había hecho commit).
    expect(archivoDelete).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
