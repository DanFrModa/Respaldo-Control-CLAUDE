import { describe, expect, it, vi } from 'vitest';

import { configR2DesdeEnv, crearClienteR2, crearServicioArchivos } from '../../comun/archivos.js';
import { ErrorPermiso, ErrorValidacion } from '../../comun/errores.js';
import type { ContextoBd, Tx } from '../../comun/transaccion.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import { crearModelo } from './modelos.js';
import { copiarBom, reemplazarBordadosBom, reemplazarTelasBom } from './bom-modelo.js';
import { solicitarSubidaFoto } from './fotos-modelo.js';

/**
 * Unit del dominio de Modelos (F1-E4) — SIN Postgres. Cubre lo que no necesita la base: el
 * guard de permisos (deny-by-default, A4), la validación de captura (Zod) y, para las fotos,
 * que la key se ordene por id del modelo (`modelos/<id>/...`, A5) y NO por nombre. La
 * integridad transaccional real (alta, BOM sin duplicados, copiar BOM, banderas persistidas)
 * se prueba contra Postgres en `modelos.int.test.ts` (CI).
 */

const ENV_R2_FALSA = {
  R2_ACCOUNT_ID: 'cuenta123',
  R2_ACCESS_KEY_ID: 'llave-falsa',
  R2_SECRET_ACCESS_KEY: 'secreto-falso',
  R2_BUCKET: 'control-v2-prueba',
};

/** Servicio de archivos real con credenciales falsas (firma local, sin red). */
function archivosDePrueba() {
  const config = configR2DesdeEnv(ENV_R2_FALSA);
  return crearServicioArchivos({ cliente: crearClienteR2(config), bucket: config.bucket });
}

const sesionAdmin = () => sesionDePrueba({ permisos: ['modelos.ver', 'modelos.administrar'] });
const sesionSoloVer = () => sesionDePrueba({ permisos: ['modelos.ver'] });

describe('dominio Modelos (F1-E4) — permisos (deny-by-default, A4)', () => {
  it('crear sin permiso administrar → ErrorPermiso (no toca la base)', async () => {
    await expect(crearModelo(sesionSoloVer(), { codigo: '501' }, {})).rejects.toBeInstanceOf(
      ErrorPermiso,
    );
  });

  it('reemplazar telas del BOM sin permiso administrar → ErrorPermiso', async () => {
    await expect(
      reemplazarTelasBom(sesionSoloVer(), 1, [{ idTela: 1, consumoPorPrenda: 2 }], {}),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('copiar BOM sin permiso administrar → ErrorPermiso', async () => {
    await expect(copiarBom(sesionSoloVer(), 1, { idOrigen: 2 }, {})).rejects.toBeInstanceOf(
      ErrorPermiso,
    );
  });

  it('subir foto sin permiso administrar → ErrorPermiso', async () => {
    await expect(
      solicitarSubidaFoto(
        sesionSoloVer(),
        1,
        { nombreOriginal: 'f.jpg', tipoMime: 'image/jpeg', tamanoBytes: 10 },
        {},
        archivosDePrueba(),
      ),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });
});

describe('dominio Modelos (F1-E4) — validación de captura (A1)', () => {
  it('crear con código vacío → ErrorValidacion', async () => {
    await expect(crearModelo(sesionAdmin(), { codigo: '   ' }, {})).rejects.toBeInstanceOf(
      ErrorValidacion,
    );
  });

  it('reemplazar telas con consumo <= 0 → ErrorValidacion', async () => {
    await expect(
      reemplazarTelasBom(sesionAdmin(), 1, [{ idTela: 1, consumoPorPrenda: 0 }], {}),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('reemplazar bordados con precio negativo → ErrorValidacion', async () => {
    await expect(
      reemplazarBordadosBom(sesionAdmin(), 1, [{ idBordado: 1, precio: -5 }], {}),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('copiar BOM con origen == destino → ErrorValidacion', async () => {
    await expect(copiarBom(sesionAdmin(), 7, { idOrigen: 7 }, {})).rejects.toBeInstanceOf(
      ErrorValidacion,
    );
  });

  it('subir foto con un MIME que no es imagen → ErrorValidacion', async () => {
    await expect(
      solicitarSubidaFoto(
        sesionAdmin(),
        1,
        { nombreOriginal: 'doc.pdf', tipoMime: 'application/pdf', tamanoBytes: 10 },
        {},
        archivosDePrueba(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });
});

/**
 * Stub mínimo de la transacción que usa `solicitarSubidaFoto`: `modelo.findUnique` devuelve el
 * modelo dado, `modeloFoto.findFirst` (para el orden) devuelve null (sin fotos previas),
 * `archivo.create` lo hace el servicio de archivos real, `modeloFoto.create`/`modelo.update`/
 * `bitacora.create` se registran. `bd` envuelve el `tx` para que `enTransaccion` lo reutilice.
 */
function bdConModelo(modelo: { id: number; codigo: string }) {
  const archivoCreate = vi.fn(
    (args: { data: Record<string, unknown>; select: Record<string, true> }) =>
      Promise.resolve({ id: 'arch_nuevo', ...args.data }),
  );
  const fotoCreate = vi.fn((args: { data: Record<string, unknown> }) =>
    Promise.resolve({ id: 99, ...args.data }),
  );
  const tx = {
    modelo: {
      findUnique: vi.fn(() => Promise.resolve(modelo)),
      update: vi.fn((args: { data: Record<string, unknown> }) => Promise.resolve(args)),
    },
    modeloFoto: {
      findFirst: vi.fn(() => Promise.resolve(null)),
      create: fotoCreate,
    },
    archivo: { create: archivoCreate },
    bitacora: { create: vi.fn((args: { data: Record<string, unknown> }) => Promise.resolve(args)) },
  } as unknown as Tx;
  const bd: ContextoBd = { tx };
  return { bd, archivoCreate, fotoCreate };
}

describe('dominio Modelos (F1-E4) — la key de la foto se ordena por id (A5)', () => {
  it('crea el Archivo con key modelos/<id>/... (por id, NO por código) y crea el ModeloFoto', async () => {
    // El modelo se llama distinto de su id a propósito: la key usa el id (7), nunca el código.
    const { bd, archivoCreate, fotoCreate } = bdConModelo({ id: 7, codigo: 'SUDADERA-PREMIUM' });

    const subida = await solicitarSubidaFoto(
      sesionAdmin(),
      7,
      {
        nombreOriginal: 'Frente Final.JPG',
        tipoMime: 'image/jpeg',
        tamanoBytes: 2048,
        tipo: 'FRENTE',
      },
      bd,
      archivosDePrueba(),
    );

    expect(archivoCreate).toHaveBeenCalledTimes(1);
    const keyCreada = archivoCreate.mock.calls[0]?.[0]?.data?.key as string;
    expect(keyCreada).toMatch(/^modelos\/7\/[0-9a-f-]{36}\/frente-final\.jpg$/);
    // NO usa el código del modelo en la key (A5).
    expect(keyCreada).not.toContain('sudadera');
    expect(keyCreada).not.toContain('premium');

    // Crea el renglón ModeloFoto ligado al Archivo, y devuelve los ids + la URL prefirmada.
    expect(fotoCreate).toHaveBeenCalledTimes(1);
    expect(fotoCreate.mock.calls[0]?.[0]?.data).toMatchObject({
      idArchivo: 'arch_nuevo',
      tipo: 'FRENTE',
    });
    expect(subida.idArchivo).toBe('arch_nuevo');
    expect(subida.idFoto).toBe(99);
    expect(new URL(subida.urlSubida).pathname.endsWith(keyCreada)).toBe(true);
  });
});
