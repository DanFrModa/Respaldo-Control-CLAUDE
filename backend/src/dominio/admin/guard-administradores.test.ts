/**
 * Guard anti-lockout (V1-E6c) contra un `tx` FALSO con estado en memoria.
 *
 * La invariante que se prueba aquí es la del negocio —**el sistema nunca puede
 * quedarse sin ningún usuario ACTIVO con una capacidad de gobierno**— por las
 * TRES puertas de `actualizarUsuario`: quitarle el rol, desactivarlo y
 * bloquearlo. Da lo mismo si el cambio se lo hace uno a sí mismo o a otro: lo que
 * se protege es que quede un administrador vivo.
 *
 * Va como prueba UNITARIA (no `.int.test.ts`) a propósito: así corre sin Postgres
 * y en milisegundos, que es lo que permite mutar el guard y ver ponerse rojo lo
 * que debe. La integridad transaccional de verdad (el `pg_advisory_xact_lock`
 * contra Postgres, el rollback real) se cubre en `usuarios.int.test.ts` en CI;
 * aquí sí se verifica que el lock **se pide**, y que se pide ANTES de contar.
 */
import { describe, expect, it, vi } from 'vitest';

import { ErrorConflicto } from '../../comun/errores.js';
import type { ContextoBd, Tx } from '../../comun/transaccion.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';

import { MAX_INTENTOS, registrarIntentoFallido } from '../auth/login.js';

import { actualizarUsuario, asignarRoles } from './usuarios.js';

/** Un rol del mundo falso: su id y las claves de permiso que otorga. */
interface RolFake {
  id: number;
  nombre: string;
  claves: string[];
}

/** Un usuario del mundo falso. */
interface UsuarioFake {
  id: string;
  username: string;
  activo: boolean;
  bloqueado: boolean;
  idsRoles: number[];
  /** Intentos fallidos acumulados (solo lo usa la puerta del login). */
  intentosFallidos?: number;
}

/**
 * Mundo en memoria con roles y usuarios, expuesto como un `tx` de Prisma con
 * SOLO las operaciones que `actualizarUsuario` usa. Las escrituras sí mutan el
 * estado, así que se puede comprobar qué quedó (o que NO quedó nada, cuando el
 * guard rechaza antes de escribir).
 */
function mundo(roles: RolFake[], usuarios: UsuarioFake[]) {
  const estadoRoles = roles.map((rol) => ({ ...rol }));
  const estadoUsuarios = usuarios.map((usuario) => ({
    ...usuario,
    idsRoles: [...usuario.idsRoles],
  }));

  const orden: string[] = [];
  const rolPorId = (id: number) => estadoRoles.find((rol) => rol.id === id);
  const usuarioPorId = (id: string) => estadoUsuarios.find((usuario) => usuario.id === id);

  /** Proyecta al usuario con la forma de `seleccionUsuario` (roles anidados). */
  const proyectar = (usuario: UsuarioFake) => ({
    id: usuario.id,
    username: usuario.username,
    nombre: `Nombre de ${usuario.username}`,
    email: `${usuario.username}@control.local`,
    activo: usuario.activo,
    bloqueado: usuario.bloqueado,
    intentosFallidos: usuario.intentosFallidos ?? 0,
    esAuditor: false,
    creadoEn: new Date(0),
    modificadoEn: new Date(0),
    // Cada renglón lleva las DOS formas que se seleccionan en el dominio:
    // `{ rol: { id, nombre } }` (admin/usuarios.ts) y `{ idRol }` (auth/login.ts).
    roles: usuario.idsRoles.map((id) => ({
      idRol: id,
      rol: { id, nombre: rolPorId(id)?.nombre ?? `rol-${String(id)}` },
    })),
  });

  const lock = vi.fn(() => {
    orden.push('lock');
    return Promise.resolve(1);
  });
  const bitacora = vi.fn((_args: { data: { datos: Record<string, unknown> } }) =>
    Promise.resolve({}),
  );

  const tx = {
    $executeRaw: lock,
    rol: {
      // `algunRolOtorga`: ¿alguno de estos roles otorga la clave?
      count: vi.fn(
        (args: {
          where: { id: { in: number[] }; permisos: { some: { permiso: { clave: string } } } };
        }) => {
          const clave = args.where.permisos.some.permiso.clave;
          return Promise.resolve(
            args.where.id.in.filter((id) => rolPorId(id)?.claves.includes(clave) === true).length,
          );
        },
      ),
    },
    usuario: {
      findUnique: vi.fn((args: { where: { id?: string; username?: string } }) => {
        const usuario =
          args.where.id === undefined
            ? estadoUsuarios.find((u) => u.username === args.where.username)
            : usuarioPorId(args.where.id);
        return Promise.resolve(usuario === undefined ? null : proyectar(usuario));
      }),
      findFirst: vi.fn(() => Promise.resolve(null)), // no hay correos repetidos
      // `contarAdministradoresActivos`: cuántos quedan con la clave tras el cambio.
      count: vi.fn(
        (args: {
          where: {
            activo?: boolean;
            bloqueado?: boolean;
            id?: { not: string };
            roles: {
              some: {
                idRol?: { not: number };
                rol: { permisos: { some: { permiso: { clave: string } } } };
              };
            };
          };
        }) => {
          orden.push('count');
          const { where } = args;
          const clave = where.roles.some.rol.permisos.some.permiso.clave;
          const excluidoRol = where.roles.some.idRol?.not;
          // Una clave AUSENTE en el `where` significa "no filtrar por eso" (así se
          // comporta Prisma de verdad): si el fake la tratara como `=== undefined`
          // el filtro se volvería imposible y el guard parecería más estricto de lo
          // que es — justo el detalle que hace falta para que mutarlo se note.
          const total = estadoUsuarios.filter(
            (usuario) =>
              (where.activo === undefined || usuario.activo === where.activo) &&
              (where.bloqueado === undefined || usuario.bloqueado === where.bloqueado) &&
              usuario.id !== where.id?.not &&
              usuario.idsRoles.some(
                (id) => id !== excluidoRol && rolPorId(id)?.claves.includes(clave) === true,
              ),
          ).length;
          return Promise.resolve(total);
        },
      ),
      update: vi.fn(
        (args: {
          where: { id: string };
          data: { activo?: boolean; bloqueado?: boolean; intentosFallidos?: number };
        }) => {
          orden.push('update');
          const usuario = usuarioPorId(args.where.id);
          if (usuario !== undefined) {
            if (args.data.activo !== undefined) {
              usuario.activo = args.data.activo;
            }
            if (args.data.bloqueado !== undefined) {
              usuario.bloqueado = args.data.bloqueado;
            }
            if (args.data.intentosFallidos !== undefined) {
              usuario.intentosFallidos = args.data.intentosFallidos;
            }
          }
          return Promise.resolve({});
        },
      ),
    },
    usuarioRol: {
      deleteMany: vi.fn((args: { where: { idUsuario: string } }) => {
        orden.push('deleteMany');
        const usuario = usuarioPorId(args.where.idUsuario);
        if (usuario !== undefined) {
          usuario.idsRoles = [];
        }
        return Promise.resolve({ count: 0 });
      }),
      createMany: vi.fn((args: { data: { idUsuario: string; idRol: number }[] }) => {
        for (const fila of args.data) {
          usuarioPorId(fila.idUsuario)?.idsRoles.push(fila.idRol);
        }
        return Promise.resolve({ count: args.data.length });
      }),
    },
    // `exigirRolesExistentes` valida que los ids existan antes de reemplazar.
    // (findMany de roles; devuelve los que hay en el mundo falso)
    bitacora: { create: bitacora },
  } as unknown as Tx;

  // `exigirRolesExistentes` usa `rol.findMany`; se añade aparte para no pelear con el cast.
  (tx as unknown as { rol: { findMany: unknown } }).rol = {
    ...(tx as unknown as { rol: object }).rol,
    findMany: vi.fn((args: { where: { id: { in: number[] } } }) =>
      Promise.resolve(
        args.where.id.in.filter((id) => rolPorId(id) !== undefined).map((id) => ({ id })),
      ),
    ),
  };

  return { bd: { tx } as ContextoBd, estadoUsuarios, orden, lock, bitacora };
}

const ADMIN = {
  id: 1,
  nombre: 'Administrador',
  claves: ['usuarios.administrar', 'roles.administrar'],
};
const ADMIN_USUARIOS = { id: 3, nombre: 'AdminUsuarios', claves: ['usuarios.administrar'] };
const BASICO = { id: 2, nombre: 'Básico', claves: ['almacenes.ver'] };

const daniel = (sobre: Partial<UsuarioFake> = {}): UsuarioFake => ({
  id: 'u-daniel',
  username: 'daniel',
  activo: true,
  bloqueado: false,
  idsRoles: [ADMIN.id],
  ...sobre,
});

/** Sesión de OTRO administrador (no es Daniel): el guard no es "sobre uno mismo". */
const sesionOtro = () => sesionDePrueba({ permisos: ['usuarios.administrar'] });
/** Sesión que ES Daniel. */
const sesionDaniel = () => sesionDePrueba({ id: 'u-daniel', permisos: ['usuarios.administrar'] });

describe('guard anti-lockout: siempre queda un administrador vivo', () => {
  it('(a) el ÚNICO administrador no puede quitarse a sí mismo su rol de admin', async () => {
    const { bd, estadoUsuarios } = mundo([ADMIN, BASICO], [daniel()]);

    await expect(
      actualizarUsuario(sesionDaniel(), { id: 'u-daniel', idsRoles: [BASICO.id] }, bd),
    ).rejects.toBeInstanceOf(ErrorConflicto);

    // Rechazó ANTES de escribir: conserva su rol.
    expect(estadoUsuarios[0]?.idsRoles).toEqual([ADMIN.id]);
  });

  it('(b) tampoco OTRO puede quitarle el rol al ÚLTIMO administrador', async () => {
    const { bd, estadoUsuarios } = mundo([ADMIN, BASICO], [daniel()]);

    await expect(
      actualizarUsuario(sesionOtro(), { id: 'u-daniel', idsRoles: [] }, bd),
    ).rejects.toBeInstanceOf(ErrorConflicto);
    expect(estadoUsuarios[0]?.idsRoles).toEqual([ADMIN.id]);
  });

  it('(c) no se puede DESACTIVAR al último administrador', async () => {
    const { bd, estadoUsuarios } = mundo([ADMIN], [daniel()]);

    await expect(
      actualizarUsuario(sesionOtro(), { id: 'u-daniel', activo: false }, bd),
    ).rejects.toBeInstanceOf(ErrorConflicto);
    expect(estadoUsuarios[0]?.activo).toBe(true);
  });

  it('tampoco se puede BLOQUEAR al último administrador (bloqueado = sin permisos)', async () => {
    const { bd, estadoUsuarios } = mundo([ADMIN], [daniel()]);

    await expect(
      actualizarUsuario(sesionOtro(), { id: 'u-daniel', bloqueado: true }, bd),
    ).rejects.toBeInstanceOf(ErrorConflicto);
    expect(estadoUsuarios[0]?.bloqueado).toBe(false);
  });

  it('(d) con DOS administradores, quitarle el rol a uno SÍ se permite', async () => {
    const { bd, estadoUsuarios } = mundo(
      [ADMIN, BASICO],
      [
        daniel(),
        {
          id: 'u-aurora',
          username: 'aurora',
          activo: true,
          bloqueado: false,
          idsRoles: [ADMIN.id],
        },
      ],
    );

    const sinAdmin = await actualizarUsuario(
      sesionOtro(),
      { id: 'u-daniel', idsRoles: [BASICO.id] },
      bd,
    );
    expect(sinAdmin.roles.map((rol) => rol.id)).toEqual([BASICO.id]);

    // Y ahora que Aurora es la última, a ELLA ya no se le puede quitar.
    await expect(
      actualizarUsuario(sesionOtro(), { id: 'u-aurora', idsRoles: [] }, bd),
    ).rejects.toBeInstanceOf(ErrorConflicto);
    expect(estadoUsuarios[1]?.idsRoles).toEqual([ADMIN.id]);
  });

  it('(e) el atajo asignarRoles NO sortea el guard', async () => {
    const { bd } = mundo([ADMIN, BASICO], [daniel()]);

    await expect(asignarRoles(sesionOtro(), 'u-daniel', [], bd)).rejects.toBeInstanceOf(
      ErrorConflicto,
    );
    await expect(asignarRoles(sesionOtro(), 'u-daniel', [BASICO.id], bd)).rejects.toBeInstanceOf(
      ErrorConflicto,
    );
  });

  it('protege CADA capacidad por separado, no solo usuarios.administrar', async () => {
    // Daniel es el único con `roles.administrar`; Aurora conserva `usuarios.administrar`,
    // así que ESA clave no es la que salta — salta la otra.
    const { bd } = mundo(
      [ADMIN, ADMIN_USUARIOS],
      [
        daniel(),
        {
          id: 'u-aurora',
          username: 'aurora',
          activo: true,
          bloqueado: false,
          idsRoles: [ADMIN_USUARIOS.id],
        },
      ],
    );

    await expect(
      actualizarUsuario(sesionOtro(), { id: 'u-daniel', idsRoles: [ADMIN_USUARIOS.id] }, bd),
    ).rejects.toThrow(/administrar roles y permisos/);
  });

  it('un administrador INACTIVO o BLOQUEADO no rescata al último activo', async () => {
    const { bd } = mundo(
      [ADMIN],
      [
        daniel(),
        {
          id: 'u-dormida',
          username: 'dormida',
          activo: false,
          bloqueado: false,
          idsRoles: [ADMIN.id],
        },
        {
          id: 'u-trabado',
          username: 'trabado',
          activo: true,
          bloqueado: true,
          idsRoles: [ADMIN.id],
        },
      ],
    );

    await expect(
      actualizarUsuario(sesionOtro(), { id: 'u-daniel', idsRoles: [] }, bd),
    ).rejects.toBeInstanceOf(ErrorConflicto);
  });

  it('el mensaje dice la SALIDA: nombrar antes a otro administrador', async () => {
    const { bd } = mundo([ADMIN], [daniel()]);

    await expect(
      actualizarUsuario(sesionOtro(), { id: 'u-daniel', idsRoles: [] }, bd),
    ).rejects.toThrow(/Primero nombra a otro administrador/);
  });

  it('el conteo va BAJO el lock: se pide el advisory lock antes de contar', async () => {
    const { bd, orden, lock } = mundo([ADMIN], [daniel()]);

    await expect(
      actualizarUsuario(sesionOtro(), { id: 'u-daniel', activo: false }, bd),
    ).rejects.toBeInstanceOf(ErrorConflicto);

    expect(lock).toHaveBeenCalledTimes(1);
    expect(orden.indexOf('lock')).toBeGreaterThanOrEqual(0);
    expect(orden.indexOf('lock')).toBeLessThan(orden.indexOf('count'));
  });

  it('el guard NO estorba a quien nunca fue administrador', async () => {
    const { bd } = mundo(
      [ADMIN, BASICO],
      [
        daniel(),
        { id: 'u-caro', username: 'caro', activo: true, bloqueado: false, idsRoles: [BASICO.id] },
      ],
    );

    expect((await asignarRoles(sesionOtro(), 'u-caro', [], bd)).roles).toEqual([]);
    const apagada = await actualizarUsuario(sesionOtro(), { id: 'u-caro', activo: false }, bd);
    expect(apagada.activo).toBe(false);
  });

  it('en un sistema que YA no tiene administradores, el guard no bloquea a nadie más', async () => {
    // El guard solo dispara cuando la operación RETIRA la capacidad a quien la
    // tenía: nunca puede empeorar un sistema que ya estaba sin administradores, y
    // sobre todo no debe volverse un candado que impida editar a cualquiera.
    const { bd } = mundo(
      [BASICO],
      [{ id: 'u-caro', username: 'caro', activo: true, bloqueado: false, idsRoles: [BASICO.id] }],
    );

    expect((await asignarRoles(sesionOtro(), 'u-caro', [], bd)).roles).toEqual([]);
    const apagada = await actualizarUsuario(sesionOtro(), { id: 'u-caro', activo: false }, bd);
    expect(apagada.activo).toBe(false);
  });

  it('a un ex-administrador YA INACTIVO se le puede editar aunque no queden admins', async () => {
    // Ejercita la mitad de ESTADO de `eraAdmin` (`activo && !bloqueado`), no la de
    // los roles: este usuario SÍ tiene el rol de gobierno, pero ya está apagado, así
    // que no es un administrador vivo y quitarle el rol no le quita nada al sistema.
    // Sin esa mitad, el guard lo trataría como el último admin y lo dejaría intocable.
    const { bd } = mundo([ADMIN], [daniel({ activo: false })]);

    expect((await asignarRoles(sesionOtro(), 'u-daniel', [], bd)).roles).toEqual([]);
  });

  it('a un ex-administrador YA BLOQUEADO también se le puede editar', async () => {
    const { bd } = mundo([ADMIN], [daniel({ bloqueado: true })]);

    expect((await asignarRoles(sesionOtro(), 'u-daniel', [], bd)).roles).toEqual([]);
  });

  it('el guard no estorba cuando el cambio CONSERVA la capacidad', async () => {
    const otroCamino = { id: 4, nombre: 'Administrador 2', claves: [...ADMIN.claves] };
    const { bd } = mundo([ADMIN, otroCamino], [daniel()]);

    const cambiado = await actualizarUsuario(
      sesionOtro(),
      { id: 'u-daniel', idsRoles: [otroCamino.id] },
      bd,
    );
    expect(cambiado.roles.map((rol) => rol.id)).toEqual([otroCamino.id]);
  });

  it('una edición que no toca roles ni estado ni pide el lock', async () => {
    const { bd, lock } = mundo([ADMIN], [daniel()]);

    await actualizarUsuario(sesionOtro(), { id: 'u-daniel', nombre: 'Daniel Masri' }, bd);
    expect(lock).not.toHaveBeenCalled();
  });

  it('REACTIVAR al administrador no dispara el guard (no puede quitar nada)', async () => {
    const { bd } = mundo([ADMIN], [daniel({ activo: false })]);

    const activo = await actualizarUsuario(sesionOtro(), { id: 'u-daniel', activo: true }, bd);
    expect(activo.activo).toBe(true);
  });
});

/**
 * QUINTA PUERTA: el bloqueo por intentos fallidos del login escribe la MISMA
 * columna `bloqueado` que protege el guard, y no lo dispara ningún administrador
 * sino el propio dueño tecleando mal su contraseña. Es la vía más probable en la
 * vida real a un sistema cerrado por dentro.
 */
describe('quinta puerta: el login no puede bloquear al último administrador', () => {
  /** Falla la contraseña `veces` seguidas. */
  async function fallar(bd: ContextoBd, veces: number) {
    let ultimo = null as Awaited<ReturnType<typeof registrarIntentoFallido>>;
    for (let i = 0; i < veces; i += 1) {
      ultimo = await registrarIntentoFallido('daniel', bd);
    }
    return ultimo;
  }

  it('al ÚNICO administrador se le cuentan los intentos pero NO se le bloquea', async () => {
    const { bd, estadoUsuarios } = mundo([ADMIN], [daniel()]);

    const ultimo = await fallar(bd, MAX_INTENTOS);

    expect(ultimo?.intentosFallidos).toBe(MAX_INTENTOS);
    expect(ultimo?.bloqueado).toBe(false);
    expect(ultimo?.bloqueoOmitidoPorUltimoAdministrador).toBe(true);
    expect(estadoUsuarios[0]?.bloqueado).toBe(false);
  });

  it('sigue sin bloquearse por más que se insista', async () => {
    const { bd, estadoUsuarios } = mundo([ADMIN], [daniel()]);

    await fallar(bd, MAX_INTENTOS * 3);
    expect(estadoUsuarios[0]?.bloqueado).toBe(false);
  });

  it('con DOS administradores, al quinto intento SÍ se bloquea (no protege de más)', async () => {
    const { bd, estadoUsuarios } = mundo(
      [ADMIN],
      [
        daniel(),
        {
          id: 'u-aurora',
          username: 'aurora',
          activo: true,
          bloqueado: false,
          idsRoles: [ADMIN.id],
        },
      ],
    );

    const ultimo = await fallar(bd, MAX_INTENTOS);

    expect(ultimo?.bloqueado).toBe(true);
    expect(ultimo?.bloqueoOmitidoPorUltimoAdministrador).toBeUndefined();
    expect(estadoUsuarios[0]?.bloqueado).toBe(true);
  });

  it('a quien NO administra nada se le bloquea normalmente', async () => {
    const { bd, estadoUsuarios } = mundo(
      [ADMIN, BASICO],
      [
        {
          id: 'u-daniel',
          username: 'daniel',
          activo: true,
          bloqueado: false,
          idsRoles: [BASICO.id],
        },
      ],
    );

    expect((await fallar(bd, MAX_INTENTOS))?.bloqueado).toBe(true);
    expect(estadoUsuarios[0]?.bloqueado).toBe(true);
  });

  it('un administrador ya INACTIVO no se salva del bloqueo (no es admin vivo)', async () => {
    const { bd } = mundo([ADMIN], [daniel({ activo: false })]);

    expect((await fallar(bd, MAX_INTENTOS))?.bloqueado).toBe(true);
  });

  it('el conteo va BAJO el lock, y los intentos que NO transicionan no lo piden', async () => {
    const { bd, orden, lock } = mundo([ADMIN], [daniel()]);

    // Los primeros cuatro intentos no pueden bloquear: no serializan nada.
    await fallar(bd, MAX_INTENTOS - 1);
    expect(lock).not.toHaveBeenCalled();

    // El quinto sí: pide el lock ANTES de contar administradores.
    await fallar(bd, 1);
    expect(lock).toHaveBeenCalledTimes(1);
    expect(orden.indexOf('lock')).toBeLessThan(orden.indexOf('count'));
  });

  it('deja constancia en bitácora de que NO se bloqueó y por qué', async () => {
    const { bd, bitacora } = mundo([ADMIN], [daniel()]);

    await fallar(bd, MAX_INTENTOS);

    const eventos = bitacora.mock.calls.map((llamada) => llamada[0].data.datos.evento);
    expect(eventos).toContain('bloqueo-omitido-ultimo-administrador');
    expect(eventos).not.toContain('bloqueo-por-intentos');
  });
});
