import { describe, expect, it, vi } from 'vitest';

import {
  configR2DesdeEnv,
  crearClienteR2,
  crearServicioArchivos,
  type ServicioArchivos,
} from '../../comun/archivos.js';
import { ErrorNoEncontrado, ErrorPermiso, ErrorValidacion } from '../../comun/errores.js';
import type { ContextoBd, Tx } from '../../comun/transaccion.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import { crearModelo } from './modelos.js';
import { crearArte, marcarArtePrincipal } from './arte-modelo.js';
import { copiarBom, reemplazarTelasBom } from './bom-modelo.js';
import { marcarFotoPrincipal, solicitarSubidaFoto } from './fotos-modelo.js';

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

  it('marcar foto principal sin permiso administrar → ErrorPermiso', async () => {
    await expect(
      marcarFotoPrincipal(sesionSoloVer(), 1, 2, {}, archivosDePrueba()),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('marcar arte principal sin permiso administrar → ErrorPermiso', async () => {
    await expect(marcarArtePrincipal(sesionSoloVer(), 1, 2, {})).rejects.toBeInstanceOf(
      ErrorPermiso,
    );
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

  it('agregar un arte con precio negativo → ErrorValidacion', async () => {
    await expect(
      crearArte(sesionAdmin(), 1, { descripcion: 'Logo', idTipoArte: 1, precio: -5 }, {}),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('agregar un arte sin descripción → ErrorValidacion (V1-E3f: reemplazó al nombre)', async () => {
    await expect(
      crearArte(sesionAdmin(), 1, { descripcion: '  ', idTipoArte: 1 }, {}),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('agregar un arte sin tipo → ErrorValidacion (ya no hay default BORDADO)', async () => {
    await expect(
      // @ts-expect-error el tipo es obligatorio desde V1-E3f: se prueba que el servidor lo exija.
      crearArte(sesionAdmin(), 1, { descripcion: 'Logo' }, {}),
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

/**
 * "Marcar como PRINCIPAL" (jul-2026, petición de Daniel) contra un `tx` FALSO con estado en
 * memoria: se puede verificar el reordenamiento REAL (qué `orden` queda en cada renglón), que la
 * lectura devuelva la principal PRIMERO y que repetir la operación no escriba nada (idempotencia)
 * sin necesidad de Postgres. La integridad transaccional se cubre en los `.int.test.ts` de CI.
 */

/** Servicio de archivos mínimo para `leerFotosModelo` (presigna cualquier key). */
const archivosQuePresignan = {
  solicitarSubida: vi.fn(),
  urlDescarga: (key: string) => Promise.resolve(`https://r2/${key}`),
} as unknown as ServicioArchivos;

/** `tx` falso con las FOTOS de un modelo en memoria (el `orden` sí se muta con cada update). */
function bdConFotos(idModelo: number, fotos: { id: number; orden: number }[]) {
  const estado = fotos.map((f) => ({ ...f }));
  const ordenadas = () => [...estado].sort((a, b) => a.orden - b.orden || a.id - b.id);
  const update = vi.fn((args: { where: { id: number }; data: { orden: number } }) => {
    const foto = estado.find((f) => f.id === args.where.id);
    if (foto !== undefined) {
      foto.orden = args.data.orden;
    }
    return Promise.resolve(foto);
  });
  const bitacora = vi.fn(() => Promise.resolve({}));
  // `$executeRaw` = el `pg_advisory_xact_lock` que serializa el reordenamiento (se registra para
  // comprobar que se toma ANTES de leer; en el fake no bloquea nada).
  const lock = vi.fn(() => Promise.resolve(1));
  const tx = {
    $executeRaw: lock,
    modelo: {
      findUnique: vi.fn(() => Promise.resolve({ id: idModelo })),
      update: vi.fn(() => Promise.resolve({})),
    },
    modeloFoto: {
      findFirst: vi.fn((args: { where: { id: number } }) =>
        Promise.resolve(estado.find((f) => f.id === args.where.id) ?? null),
      ),
      findMany: vi.fn(() =>
        Promise.resolve(
          ordenadas().map((f) => ({
            ...f,
            tipo: 'OTRO',
            archivo: {
              id: `arch-${String(f.id)}`,
              key: `k${String(f.id)}`,
              nombreOriginal: 'f.jpg',
              tipoMime: 'image/jpeg',
              tamanoBytes: 10,
            },
          })),
        ),
      ),
      update,
    },
    bitacora: { create: bitacora },
  } as unknown as Tx;
  return { bd: { tx } as ContextoBd, update, bitacora, estado, lock };
}

/** `tx` falso con el ARTE de un modelo en memoria. */
function bdConArte(idModelo: number, artes: { id: number; orden: number; nombre: string }[]) {
  const estado = artes.map((a) => ({ ...a }));
  // V1-E3f: el orden del arte es `orden` y luego `id` (el desempate por nombre se fue con el
  // nombre, §Post-F9.52 punto 1).
  const ordenadas = () => [...estado].sort((a, b) => a.orden - b.orden || a.id - b.id);
  const update = vi.fn((args: { where: { id: number }; data: { orden: number } }) => {
    const arte = estado.find((a) => a.id === args.where.id);
    if (arte !== undefined) {
      arte.orden = args.data.orden;
    }
    return Promise.resolve(arte);
  });
  const bitacora = vi.fn(() => Promise.resolve({}));
  const lock = vi.fn(() => Promise.resolve(1));
  const tx = {
    $executeRaw: lock,
    modelo: {
      findUnique: vi.fn(() => Promise.resolve({ id: idModelo })),
      update: vi.fn(() => Promise.resolve({})),
    },
    modeloArte: {
      findMany: vi.fn(() =>
        Promise.resolve(
          ordenadas().map((a) => ({
            id: a.id,
            idModelo,
            descripcion: a.nombre,
            posicion: null,
            puntadas: null,
            precio: null,
            idTipoArte: 1,
            idProveedor: null,
            orden: a.orden,
            creadoEn: new Date('2026-01-01T00:00:00Z'),
            creadoPorId: null,
            modificadoEn: new Date('2026-01-01T00:00:00Z'),
            modificadoPorId: null,
            proveedor: null,
            tipoArte: { nombre: 'Bordado', codigo: 'bordado', usaPuntadas: true },
            fotos: [],
          })),
        ),
      ),
      update,
    },
    bitacora: { create: bitacora },
  } as unknown as Tx;
  return { bd: { tx } as ContextoBd, update, bitacora, estado, lock };
}

describe('dominio Modelos — foto PRINCIPAL del modelo (Daniel, jul-2026)', () => {
  it('mueve la foto elegida al primer lugar y devuelve la galería con ella al frente', async () => {
    const { bd, update, bitacora, estado, lock } = bdConFotos(7, [
      { id: 1, orden: 0 },
      { id: 2, orden: 1 },
      { id: 3, orden: 2 },
    ]);

    const fotos = await marcarFotoPrincipal(sesionAdmin(), 7, 3, bd, archivosQuePresignan);

    // La lectura devuelve la principal PRIMERO y el resto conserva su orden relativo.
    expect(fotos.map((f) => f.idFoto)).toEqual([3, 1, 2]);
    // El `orden` quedó compacto (0..N-1), sin huecos ni empates.
    expect(estado.map((f) => ({ id: f.id, orden: f.orden }))).toEqual([
      { id: 1, orden: 1 },
      { id: 2, orden: 2 },
      { id: 3, orden: 0 },
    ]);
    expect(update).toHaveBeenCalledTimes(3);
    expect(bitacora).toHaveBeenCalledTimes(1);
    // El lock de concurrencia se toma ANTES de escribir (y de leer): sin él, dos marcados
    // simultáneos del mismo modelo dejarían `orden` duplicado y la principal equivocada.
    expect(lock).toHaveBeenCalledTimes(1);
    expect(lock.mock.invocationCallOrder[0] ?? 0).toBeLessThan(
      update.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('es IDEMPOTENTE: volver a marcar la misma foto no escribe ni deja bitácora vacía', async () => {
    const { bd, update, bitacora } = bdConFotos(7, [
      { id: 1, orden: 0 },
      { id: 2, orden: 1 },
    ]);

    await marcarFotoPrincipal(sesionAdmin(), 7, 2, bd, archivosQuePresignan);
    const escriturasPrimera = update.mock.calls.length;
    const fotos = await marcarFotoPrincipal(sesionAdmin(), 7, 2, bd, archivosQuePresignan);

    expect(fotos.map((f) => f.idFoto)).toEqual([2, 1]);
    // La segunda pasada no agregó ni una escritura ni un renglón de bitácora.
    expect(update.mock.calls.length).toBe(escriturasPrimera);
    expect(bitacora).toHaveBeenCalledTimes(1);
  });

  it('una foto que no es del modelo → ErrorNoEncontrado (y no escribe nada)', async () => {
    const { bd, update } = bdConFotos(7, [{ id: 1, orden: 0 }]);
    await expect(
      marcarFotoPrincipal(sesionAdmin(), 7, 99, bd, archivosQuePresignan),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);
    expect(update).not.toHaveBeenCalled();
  });
});

describe('dominio Modelos — arte PRINCIPAL del modelo (Daniel, jul-2026)', () => {
  it('mueve el arte elegido al primer lugar y lo devuelve al frente', async () => {
    const { bd, update, estado, lock } = bdConArte(7, [
      { id: 10, orden: 0, nombre: 'Aplicación' },
      { id: 20, orden: 0, nombre: 'Bordado pecho' },
      { id: 30, orden: 0, nombre: 'Estampa espalda' },
    ]);

    const artes = await marcarArtePrincipal(sesionAdmin(), 7, 30, bd);

    expect(artes.map((a) => a.id)).toEqual([30, 10, 20]);
    expect(estado.map((a) => ({ id: a.id, orden: a.orden }))).toEqual([
      { id: 10, orden: 1 },
      { id: 20, orden: 2 },
      { id: 30, orden: 0 },
    ]);
    // El elegido ya valía 0: solo se reescriben los otros dos.
    expect(update).toHaveBeenCalledTimes(2);
    // Igual que las fotos: el lock va primero (serializa el reordenamiento de ESTE modelo).
    expect(lock).toHaveBeenCalledTimes(1);
    expect(lock.mock.invocationCallOrder[0] ?? 0).toBeLessThan(
      update.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('es IDEMPOTENTE: repetir la marca no vuelve a escribir', async () => {
    const { bd, update, bitacora } = bdConArte(7, [
      { id: 10, orden: 0, nombre: 'Aplicación' },
      { id: 20, orden: 0, nombre: 'Bordado pecho' },
    ]);

    await marcarArtePrincipal(sesionAdmin(), 7, 20, bd);
    const escriturasPrimera = update.mock.calls.length;
    const artes = await marcarArtePrincipal(sesionAdmin(), 7, 20, bd);

    expect(artes.map((a) => a.id)).toEqual([20, 10]);
    expect(update.mock.calls.length).toBe(escriturasPrimera);
    expect(bitacora).toHaveBeenCalledTimes(1);
  });

  it('un arte que no es de ese modelo → ErrorNoEncontrado', async () => {
    const { bd, update } = bdConArte(7, [{ id: 10, orden: 0, nombre: 'Aplicación' }]);
    await expect(marcarArtePrincipal(sesionAdmin(), 7, 99, bd)).rejects.toBeInstanceOf(
      ErrorNoEncontrado,
    );
    expect(update).not.toHaveBeenCalled();
  });
});
