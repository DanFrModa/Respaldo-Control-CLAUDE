import { describe, expect, it, vi } from 'vitest';

import {
  configR2DesdeEnv,
  crearClienteR2,
  crearServicioArchivos,
  type ServicioArchivos,
} from '../../comun/archivos.js';
import {
  ErrorConflicto,
  ErrorNoEncontrado,
  ErrorPermiso,
  ErrorValidacion,
} from '../../comun/errores.js';
import type { ContextoBd, Tx } from '../../comun/transaccion.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import { confirmarLogo, quitarLogo, solicitarSubidaLogo } from './empresas.js';

/**
 * Unit del LOGO de la empresa (post-F9, branding pedido por Daniel) — SIN Postgres. Cubre lo que no
 * necesita base: el guard de permiso (`empresas.administrar`, deny-by-default A4), la validación
 * ESTRECHA del archivo (solo PNG/JPG porque react-pdf no sabe incrustar otra cosa, y tope de 5 MB
 * porque los bytes viajan dentro de cada impreso), que la key quede ordenada por id de empresa (A5)
 * y que reemplazar el logo BORRE el archivo anterior en la misma transacción (sin huérfanos).
 * La integridad transaccional real va contra Postgres en `empresas.int.test.ts` (CI).
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

const sesionAdmin = () => sesionDePrueba({ permisos: ['empresas.administrar'] });
const sesionSinNada = () => sesionDePrueba({ permisos: [] });

/** Datos válidos de subida (PNG chico) para reusar en los casos. */
const LOGO_OK = { nombreOriginal: 'FR Moda.png', tipoMime: 'image/png', tamanoBytes: 34_859 };

/**
 * Stub de la transacción: `empresa.findUnique` devuelve la empresa (con o sin logo previo), el
 * `archivo.create` lo hace el servicio real (fake creds) y se espían el update de la empresa y el
 * delete del archivo anterior.
 */
function bdParaLogo(
  idEmpresa: number,
  idArchivoLogo: string | null,
  opciones: { archivoNuevo?: { id: string; key: string } | null; borrados?: number } = {},
) {
  const empresaUpdate = vi.fn((args: { data: Record<string, unknown> }) =>
    Promise.resolve({ id: idEmpresa, ...args.data }),
  );
  const archivoDeleteMany = vi.fn((args: { where: { id: string } }) =>
    Promise.resolve({ count: opciones.borrados ?? 1, ...args }),
  );
  const nuevo =
    opciones.archivoNuevo === undefined
      ? { id: 'arch_nuevo', key: `empresas/logos/${String(idEmpresa)}/uuid/logo.png` }
      : opciones.archivoNuevo;
  const tx = {
    empresa: {
      findUnique: vi.fn(() => Promise.resolve({ id: idEmpresa, nombre: 'FR Moda', idArchivoLogo })),
      update: empresaUpdate,
    },
    archivo: {
      create: vi.fn((args: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 'arch_nuevo', ...args.data }),
      ),
      findUnique: vi.fn(() =>
        Promise.resolve(nuevo === null ? null : { ...nuevo, nombreOriginal: 'logo.png' }),
      ),
      deleteMany: archivoDeleteMany,
    },
    bitacora: { create: vi.fn((args: { data: Record<string, unknown> }) => Promise.resolve(args)) },
  } as unknown as Tx;
  return { bd: { tx } as ContextoBd, empresaUpdate, archivoDeleteMany };
}

describe('logo de la empresa — permisos (deny-by-default, A4)', () => {
  it('subir el logo sin empresas.administrar → ErrorPermiso', async () => {
    await expect(
      solicitarSubidaLogo(sesionSinNada(), 1, LOGO_OK, {}, archivosDePrueba()),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('quitar el logo sin empresas.administrar → ErrorPermiso', async () => {
    await expect(quitarLogo(sesionSinNada(), 1, {})).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('confirmar el logo sin empresas.administrar → ErrorPermiso', async () => {
    await expect(confirmarLogo(sesionSinNada(), 1, 'arch_nuevo', {})).rejects.toBeInstanceOf(
      ErrorPermiso,
    );
  });
});

describe('logo de la empresa — validación del archivo (A1)', () => {
  it('rechaza un SVG: react-pdf no sabe incrustarlo en el impreso', async () => {
    await expect(
      solicitarSubidaLogo(
        sesionAdmin(),
        1,
        { ...LOGO_OK, nombreOriginal: 'logo.svg', tipoMime: 'image/svg+xml' },
        {},
        archivosDePrueba(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('rechaza un WEBP (aunque sea imagen válida en el navegador)', async () => {
    await expect(
      solicitarSubidaLogo(
        sesionAdmin(),
        1,
        { ...LOGO_OK, tipoMime: 'image/webp' },
        {},
        archivosDePrueba(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('rechaza un archivo de más de 5 MB', async () => {
    await expect(
      solicitarSubidaLogo(
        sesionAdmin(),
        1,
        { ...LOGO_OK, tamanoBytes: 6 * 1024 * 1024 },
        {},
        archivosDePrueba(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('rechaza un archivo vacío', async () => {
    await expect(
      solicitarSubidaLogo(sesionAdmin(), 1, { ...LOGO_OK, tamanoBytes: 0 }, {}, archivosDePrueba()),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('acepta JPG (el otro formato que sí se puede imprimir)', async () => {
    const { bd } = bdParaLogo(1, null);
    await expect(
      solicitarSubidaLogo(
        sesionAdmin(),
        1,
        { nombreOriginal: 'marca.jpg', tipoMime: 'image/jpeg', tamanoBytes: 1024 },
        bd,
        archivosDePrueba(),
      ),
    ).resolves.toMatchObject({ nombreOriginal: 'marca.jpg' });
  });
});

describe('logo de la empresa — paso 1: preparar la subida (A2/A5)', () => {
  it('crea el Archivo bajo empresas/logos/<id>/… y devuelve la URL prefirmada', async () => {
    const { bd } = bdParaLogo(3, null);

    const salida = await solicitarSubidaLogo(sesionAdmin(), 3, LOGO_OK, bd, archivosDePrueba());

    expect(salida.idArchivo).toBe('arch_nuevo');
    expect(salida.urlSubida).toContain('X-Amz-Signature');
    expect(salida.urlSubida).toContain('empresas/logos/3/');
  });

  it('NO toca el logo vigente: una subida a medias no puede dejar al sistema sin marca', async () => {
    const { bd, empresaUpdate, archivoDeleteMany } = bdParaLogo(3, 'arch_viejo');

    await solicitarSubidaLogo(sesionAdmin(), 3, LOGO_OK, bd, archivosDePrueba());

    // Ni se reapunta la empresa ni se borra el archivo anterior: eso es del paso de confirmación.
    expect(empresaUpdate).not.toHaveBeenCalled();
    expect(archivoDeleteMany).not.toHaveBeenCalled();
  });
});

describe('logo de la empresa — paso 2: confirmar', () => {
  it('liga el archivo nuevo a la empresa', async () => {
    const { bd, empresaUpdate } = bdParaLogo(3, null);

    await confirmarLogo(sesionAdmin(), 3, 'arch_nuevo', bd);

    expect(empresaUpdate).toHaveBeenCalledTimes(1);
    expect(empresaUpdate.mock.calls[0]?.[0].data).toMatchObject({ idArchivoLogo: 'arch_nuevo' });
  });

  it('al REEMPLAZAR, borra el archivo anterior en la misma transacción (sin huérfanos en BD)', async () => {
    const { bd, archivoDeleteMany } = bdParaLogo(3, 'arch_viejo');

    await confirmarLogo(sesionAdmin(), 3, 'arch_nuevo', bd);

    expect(archivoDeleteMany).toHaveBeenCalledTimes(1);
    expect(archivoDeleteMany.mock.calls[0]?.[0].where.id).toBe('arch_viejo');
  });

  it('es idempotente: confirmar el logo que ya está vigente no hace nada', async () => {
    const { bd, empresaUpdate, archivoDeleteMany } = bdParaLogo(3, 'arch_nuevo');

    await confirmarLogo(sesionAdmin(), 3, 'arch_nuevo', bd);

    expect(empresaUpdate).not.toHaveBeenCalled();
    expect(archivoDeleteMany).not.toHaveBeenCalled();
  });

  it('rechaza un archivo que no nació como logo de ESTA empresa', async () => {
    // Un adjunto de otra entidad (o de otra empresa): no se puede apropiar como logo.
    const { bd } = bdParaLogo(3, null, {
      archivoNuevo: { id: 'arch_ajeno', key: 'bordados/9/uuid/foto.png' },
    });

    await expect(confirmarLogo(sesionAdmin(), 3, 'arch_ajeno', bd)).rejects.toBeInstanceOf(
      ErrorValidacion,
    );
  });

  it('si el archivo no existe → ErrorNoEncontrado', async () => {
    const { bd } = bdParaLogo(3, null, { archivoNuevo: null });

    await expect(confirmarLogo(sesionAdmin(), 3, 'arch_fantasma', bd)).rejects.toBeInstanceOf(
      ErrorNoEncontrado,
    );
  });
});

describe('logo de la empresa — quitar', () => {
  it('borra el Archivo (la FK SetNull deja la empresa sin logo)', async () => {
    const { bd, archivoDeleteMany } = bdParaLogo(3, 'arch_viejo');

    await quitarLogo(sesionAdmin(), 3, bd);

    expect(archivoDeleteMany).toHaveBeenCalledTimes(1);
    expect(archivoDeleteMany.mock.calls[0]?.[0].where.id).toBe('arch_viejo');
  });

  it('si la empresa no tiene logo → ErrorConflicto (la pantalla estaba desactualizada)', async () => {
    const { bd } = bdParaLogo(3, null);

    await expect(quitarLogo(sesionAdmin(), 3, bd)).rejects.toBeInstanceOf(ErrorConflicto);
  });

  it('dos "quitar" en paralelo: el segundo da ErrorConflicto (409), no un P2025 (500)', async () => {
    // La carrera: ambos leen `idArchivoLogo` no nulo, pero solo uno borra la fila. Con `delete`
    // el segundo reventaría con P2025 → 500; con `deleteMany` devuelve 0 y aquí se traduce a 409.
    const { bd } = bdParaLogo(3, 'arch_viejo', { borrados: 0 });

    await expect(quitarLogo(sesionAdmin(), 3, bd)).rejects.toBeInstanceOf(ErrorConflicto);
  });
});
