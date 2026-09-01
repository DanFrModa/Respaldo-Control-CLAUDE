import { describe, expect, it, vi } from 'vitest';

import { nombreDeUsuario, nombresDeUsuarios, type ClienteUsuarios } from './nombres-usuario.js';

/**
 * Unit del resolvedor canónico de nombres de usuario (V1 · «los nombres, en vez de los ids»).
 *
 * Lo que estas pruebas defienden, y por qué cada una puede caer sola:
 *  • UNA consulta por lote (nunca N+1) y con los ids DEDUPLICADOS.
 *  • Lote vacío ⇒ NI UNA consulta (no se toca la base para nada).
 *  • El `where` es SOLO por id: sin filtro `activo`. `Usuario` es de borrado suave, y la historia
 *    de un usuario dado de baja se sigue leyendo CON SU NOMBRE (D3).
 *  • El id que no resuelve devuelve `null`, no `undefined` (el contrato es `string | null`).
 */

/** Cliente Prisma de mentira: registra las llamadas y devuelve los usuarios que se le den. */
function clienteFalso(usuarios: { id: string; nombre: string }[]) {
  const findMany = vi.fn().mockResolvedValue(usuarios);
  return { cliente: { usuario: { findMany } } as unknown as ClienteUsuarios, findMany };
}

describe('nombresDeUsuarios', () => {
  it('resuelve el lote entero en UNA sola consulta', async () => {
    const { cliente, findMany } = clienteFalso([
      { id: 'u1', nombre: 'Daniel Masri' },
      { id: 'u2', nombre: 'Gabriel' },
    ]);

    const mapa = await nombresDeUsuarios(cliente, ['u1', 'u2']);

    expect(findMany).toHaveBeenCalledOnce();
    expect(mapa.get('u1')).toBe('Daniel Masri');
    expect(mapa.get('u2')).toBe('Gabriel');
  });

  it('deduplica los ids repetidos y descarta null/undefined', async () => {
    const { cliente, findMany } = clienteFalso([{ id: 'u1', nombre: 'Daniel Masri' }]);

    await nombresDeUsuarios(cliente, ['u1', 'u1', null, 'u1', undefined]);

    expect(findMany).toHaveBeenCalledOnce();
    const [args] = findMany.mock.calls[0] as [{ where: { id: { in: string[] } } }];
    expect(args.where.id.in).toEqual(['u1']);
  });

  it('NO consulta la base cuando no hay ningún id que buscar', async () => {
    const { cliente, findMany } = clienteFalso([]);

    expect((await nombresDeUsuarios(cliente, [])).size).toBe(0);
    expect((await nombresDeUsuarios(cliente, [null, undefined, null])).size).toBe(0);

    expect(findMany).not.toHaveBeenCalled();
  });

  it('NO filtra por `activo`: un usuario dado de baja conserva su nombre en la historia (D3)', async () => {
    const { cliente, findMany } = clienteFalso([{ id: 'baja', nombre: 'Quien Se Fue' }]);

    const mapa = await nombresDeUsuarios(cliente, ['baja']);

    const [args] = findMany.mock.calls[0] as [{ where: Record<string, unknown> }];
    // El `where` es EXACTAMENTE por id — si alguien agrega `activo: true`, esta prueba cae.
    expect(args.where).toEqual({ id: { in: ['baja'] } });
    expect(Object.keys(args.where)).toEqual(['id']);
    expect(mapa.get('baja')).toBe('Quien Se Fue');
  });

  it('omite del mapa el id que no existe (no inventa nombre)', async () => {
    const { cliente } = clienteFalso([{ id: 'u1', nombre: 'Daniel Masri' }]);

    const mapa = await nombresDeUsuarios(cliente, ['u1', 'fantasma']);

    expect(mapa.has('fantasma')).toBe(false);
    expect(mapa.size).toBe(1);
  });
});

describe('nombreDeUsuario', () => {
  const mapa: ReadonlyMap<string, string> = new Map([['u1', 'Daniel Masri']]);

  it('devuelve el nombre cuando el id resuelve', () => {
    expect(nombreDeUsuario(mapa, 'u1')).toBe('Daniel Masri');
  });

  it('devuelve null —no undefined— cuando el id no resuelve', () => {
    // `toBeNull()` ya distingue null de undefined; el `not.toBeUndefined()` que había aquí no
    // comprobaba nada. Lo que sí hace falta fijar es el TIPO de salida: el contrato es
    // `string | null`, y un `undefined` colado rompe la serialización de Zod sin avisar.
    expect(nombreDeUsuario(mapa, 'fantasma')).toBeNull();
    expect(Object.is(nombreDeUsuario(mapa, 'fantasma'), undefined)).toBe(false);
  });

  it('devuelve null cuando el id es null o undefined', () => {
    expect(nombreDeUsuario(mapa, null)).toBeNull();
    expect(nombreDeUsuario(mapa, undefined)).toBeNull();
  });
});
