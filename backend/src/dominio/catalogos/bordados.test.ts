import { describe, expect, it, vi } from 'vitest';

import { configR2DesdeEnv, crearClienteR2, crearServicioArchivos } from '../../comun/archivos.js';
import { ErrorConflicto, ErrorPermiso, ErrorValidacion } from '../../comun/errores.js';
import type { ContextoBd, Tx } from '../../comun/transaccion.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import { crearBordado, solicitarSubidaFoto } from './bordados.js';

/**
 * Unit del dominio de Bordados (F1-E3) — SIN Postgres y con el motor de archivos
 * REAL pero con credenciales R2 FALSAS (`getSignedUrl` firma localmente, no toca la
 * red). Cubre lo que no necesita la base: el guard de permisos, la validación de
 * captura (Zod) y, sobre todo, que la **key de la foto se ordene por id** del bordado
 * (`bordados/<id>/...`, A5) y NO por su nombre. La integridad transaccional real
 * (alta/edición/quitar-foto, reemplazo de foto, auditoría) se prueba contra Postgres
 * en `bordados.int.test.ts` (CI).
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

const sesionAdmin = () => sesionDePrueba({ permisos: ['bordados.ver', 'bordados.administrar'] });

/**
 * Stub mínimo de la transacción que usa `solicitarSubidaFoto`: `bordado.findUnique`
 * devuelve el bordado dado, `archivo.create` simula el insert (lo hace el servicio de
 * archivos real), `bordado.updateMany` (el compare-and-set que liga la foto nueva) y
 * `bitacora.create` se registran. `bd` envuelve el `tx` para que `enTransaccion` lo
 * reutilice (no abre una real). Devuelve los spies para verificar.
 *
 * `filasEnlazadas` simula el resultado del CAS: 1 = nadie tocó la foto entre la lectura y
 * la escritura; 0 = otra transacción la reemplazó primero (la carrera del reemplazo).
 */
function bdConBordado(
  bordado: { id: number; nombre: string; idArchivoFoto: string | null },
  filasEnlazadas = 1,
) {
  const archivoCreate = vi.fn(
    (args: { data: Record<string, unknown>; select: Record<string, true> }) =>
      Promise.resolve({ id: 'arch_nuevo', ...args.data }),
  );
  const bordadoUpdateMany = vi.fn(
    (_args: { where: Record<string, unknown>; data: Record<string, unknown> }) =>
      Promise.resolve({ count: filasEnlazadas }),
  );
  const archivoDelete = vi.fn((args: { where: { id: string } }) => Promise.resolve(args));
  const bitacoraCreate = vi.fn((args: { data: Record<string, unknown> }) => Promise.resolve(args));
  const tx = {
    bordado: {
      findUnique: vi.fn(() => Promise.resolve(bordado)),
      updateMany: bordadoUpdateMany,
    },
    archivo: { create: archivoCreate, delete: archivoDelete },
    bitacora: { create: bitacoraCreate },
  } as unknown as Tx;
  const bd: ContextoBd = { tx };
  return { bd, archivoCreate, bordadoUpdateMany, archivoDelete, bitacoraCreate };
}

describe('dominio Bordados (F1-E3) — permisos y validación de captura', () => {
  it('crear sin permiso administrar → ErrorPermiso (no toca la base)', async () => {
    const soloVer = sesionDePrueba({ permisos: ['bordados.ver'] });
    await expect(crearBordado(soloVer, { nombre: 'Logo' }, {})).rejects.toBeInstanceOf(
      ErrorPermiso,
    );
  });

  it('crear con nombre vacío → ErrorValidacion', async () => {
    await expect(crearBordado(sesionAdmin(), { nombre: '   ' }, {})).rejects.toBeInstanceOf(
      ErrorValidacion,
    );
  });

  it('crear con puntadas negativas → ErrorValidacion', async () => {
    await expect(
      crearBordado(sesionAdmin(), { nombre: 'X', puntadas: -5 }, {}),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('solicitar subida de foto sin permiso administrar → ErrorPermiso', async () => {
    const soloVer = sesionDePrueba({ permisos: ['bordados.ver'] });
    await expect(
      solicitarSubidaFoto(
        soloVer,
        1,
        { nombreOriginal: 'foto.jpg', tipoMime: 'image/jpeg', tamanoBytes: 10 },
        {},
        archivosDePrueba(),
      ),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('solicitar subida con un MIME que no es imagen → ErrorValidacion', async () => {
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

describe('dominio Bordados (F1-E3) — la key de la foto se ordena por id (A5)', () => {
  it('crea el Archivo con key bordados/<id>/... (por id, NO por nombre) y liga la foto', async () => {
    // El bordado se llama distinto de su id a propósito: la key debe usar el id (7),
    // jamás el nombre ("Logo Importante Marilyn").
    const { bd, archivoCreate, bordadoUpdateMany, archivoDelete } = bdConBordado({
      id: 7,
      nombre: 'Logo Importante Marilyn',
      idArchivoFoto: null,
    });

    const subida = await solicitarSubidaFoto(
      sesionAdmin(),
      7,
      { nombreOriginal: 'Diseño Final.JPG', tipoMime: 'image/jpeg', tamanoBytes: 2048 },
      bd,
      archivosDePrueba(),
    );

    // El registro Archivo se creó con la key ordenada por id del bordado.
    expect(archivoCreate).toHaveBeenCalledTimes(1);
    const keyCreada = archivoCreate.mock.calls[0]?.[0]?.data?.key as string;
    expect(keyCreada).toMatch(/^bordados\/7\/[0-9a-f-]{36}\/diseno-final\.jpg$/);
    // NO usa el nombre del bordado en la key (A5: por id, nunca por convención de nombre).
    expect(keyCreada).not.toContain('logo');
    expect(keyCreada).not.toContain('marilyn');

    // La foto se liga al bordado (idArchivoFoto) y la URL prefirmada apunta a la key.
    expect(bordadoUpdateMany).toHaveBeenCalledTimes(1);
    expect(bordadoUpdateMany.mock.calls[0]?.[0]?.data).toMatchObject({
      idArchivoFoto: 'arch_nuevo',
    });
    // El enlace es un compare-and-set: el `where` incluye la foto que se leyó (aquí, ninguna).
    expect(bordadoUpdateMany.mock.calls[0]?.[0]?.where).toMatchObject({
      id: 7,
      idArchivoFoto: null,
    });
    expect(subida.idArchivo).toBe('arch_nuevo');
    expect(new URL(subida.urlSubida).pathname.endsWith(keyCreada)).toBe(true);

    // Sin foto previa: no se borra ningún Archivo anterior.
    expect(archivoDelete).not.toHaveBeenCalled();
  });

  it('si ya había foto, la reemplaza: borra el Archivo anterior en la misma transacción', async () => {
    const { bd, archivoCreate, bordadoUpdateMany, archivoDelete } = bdConBordado({
      id: 3,
      nombre: 'Con foto',
      idArchivoFoto: 'arch_viejo',
    });

    await solicitarSubidaFoto(
      sesionAdmin(),
      3,
      { nombreOriginal: 'nueva.png', tipoMime: 'image/png', tamanoBytes: 512 },
      bd,
      archivosDePrueba(),
    );

    // El enlace exige que la foto vigente SIGA siendo la que se leyó (compare-and-set).
    expect(bordadoUpdateMany.mock.calls[0]?.[0]?.where).toMatchObject({
      id: 3,
      idArchivoFoto: 'arch_viejo',
    });
    // Crea la nueva y borra la vieja (reemplazo atómico).
    expect(archivoCreate).toHaveBeenCalledTimes(1);
    expect(archivoDelete).toHaveBeenCalledTimes(1);
    expect(archivoDelete.mock.calls[0]?.[0]).toMatchObject({ where: { id: 'arch_viejo' } });
  });

  it('si otro reemplazó la foto primero: ErrorConflicto y NO borra el Archivo ajeno', async () => {
    // El CAS no enlaza ninguna fila (count = 0): entre la lectura y la escritura, otra
    // transacción cambió la foto del mismo arte y ya se llevó `arch_viejo`. Antes se intentaba
    // borrar ese id igual → P2025 → 500; ahora sale un conflicto claro y no se borra nada.
    const { bd, archivoDelete } = bdConBordado(
      { id: 3, nombre: 'Con foto', idArchivoFoto: 'arch_viejo' },
      0,
    );

    await expect(
      solicitarSubidaFoto(
        sesionAdmin(),
        3,
        { nombreOriginal: 'nueva.png', tipoMime: 'image/png', tamanoBytes: 512 },
        bd,
        archivosDePrueba(),
      ),
    ).rejects.toBeInstanceOf(ErrorConflicto);

    expect(archivoDelete).not.toHaveBeenCalled();
  });
});
