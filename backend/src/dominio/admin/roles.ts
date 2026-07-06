/**
 * Administración de roles y sus permisos (MEJORAS A4, PLANMAESTRO §4
 * "Seguridad": `Rol` + `RolPermiso` contra el catálogo `Permiso`).
 *
 * Los roles del sistema (`esSistema=true`, sembrados desde los 9 niveles del
 * sistema viejo — doc 00 §2: Administrador, Directivo, Gerencial, …) son la
 * red de seguridad de la migración: NO se renombran NI se borran, pero sus
 * permisos SÍ se ajustan (el mapeo nivel→permisos del seed es aproximado y
 * Daniel lo afinará en pantalla).
 *
 * El catálogo de permisos es CÓDIGO (`src/contrato`) materializado en la
 * tabla `Permiso` por el seed; aquí se valida contra esa tabla: una clave que
 * no existe en ella es un error de captura, no crea permisos nuevos.
 */
import { esClavePermiso } from '../../contrato/index.js';
import type { Prisma } from '../../datos/index.js';
import { z } from 'zod';

import { datosCreacion, datosModificacion, registrarBitacora } from '../../comun/auditoria.js';
import { ErrorConflicto, ErrorNoEncontrado, ErrorValidacion } from '../../comun/errores.js';
import { verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import { CODIGO_PRISMA, codigoErrorPrisma } from '../../comun/prisma-errores.js';
import {
  clienteLectura,
  enTransaccion,
  type ContextoBd,
  type Tx,
} from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';

/** Clave validada contra el catálogo TIPADO de `src/contrato` (la fuente de verdad, A4). */
const esquemaClavePermiso = z
  .string()
  .trim()
  .refine(esClavePermiso, { message: 'Permiso fuera del catálogo.' });

const esquemaCrearRol = z.object({
  nombre: z.string().trim().min(1, 'El nombre del rol es obligatorio.').max(60),
  descripcion: z.string().trim().max(200).default(''),
  /** Claves del catálogo (`modulo.accion`, ej. `"almacenes.ver"`). */
  clavesPermisos: z.array(esquemaClavePermiso).default([]),
});

export type EntradaCrearRol = z.input<typeof esquemaCrearRol>;

const esquemaActualizarRol = z
  .object({
    nombre: z.string().trim().min(1).max(60).optional(),
    descripcion: z.string().trim().max(200).optional(),
  })
  .refine((cambios) => Object.values(cambios).some((valor) => valor !== undefined), {
    message: 'No hay ningún cambio que guardar.',
  });

export type EntradaActualizarRol = z.input<typeof esquemaActualizarRol>;

/** Rol como lo exponen los servicios: con sus claves de permiso y cuántos usuarios lo tienen. */
export interface RolDto {
  id: number;
  nombre: string;
  descripcion: string;
  esSistema: boolean;
  clavesPermisos: string[];
  totalUsuarios: number;
}

const seleccionRol = {
  id: true,
  nombre: true,
  descripcion: true,
  esSistema: true,
  permisos: { select: { permiso: { select: { clave: true } } } },
  _count: { select: { usuarios: true } },
} satisfies Prisma.RolSelect;

type RolConPermisos = Prisma.RolGetPayload<{ select: typeof seleccionRol }>;

function aDto(rol: RolConPermisos): RolDto {
  return {
    id: rol.id,
    nombre: rol.nombre,
    descripcion: rol.descripcion,
    esSistema: rol.esSistema,
    clavesPermisos: rol.permisos.map((asignacion) => asignacion.permiso.clave).sort(),
    totalUsuarios: rol._count.usuarios,
  };
}

async function exigirRol(tx: Tx, id: number): Promise<RolConPermisos> {
  const rol = await tx.rol.findUnique({ where: { id }, select: seleccionRol });
  if (rol === null) {
    throw new ErrorNoEncontrado('Rol', id);
  }
  return rol;
}

/**
 * Resuelve claves de permiso → ids de la tabla `Permiso`. Una clave que no
 * existe en el catálogo sembrado es `ErrorValidacion` (los permisos NUNCA se
 * crean desde aquí: el catálogo es código, A4).
 */
async function resolverPermisos(tx: Tx, claves: string[]): Promise<number[]> {
  if (claves.length === 0) {
    return [];
  }
  const unicas = [...new Set(claves)];
  const permisos = await tx.permiso.findMany({
    where: { clave: { in: unicas } },
    select: { id: true, clave: true },
  });
  const faltantes = unicas.filter((clave) => !permisos.some((p) => p.clave === clave));
  if (faltantes.length > 0) {
    throw new ErrorValidacion(`Permisos que no existen en el catálogo: ${faltantes.join(', ')}.`);
  }
  return permisos.map((p) => p.id);
}

/**
 * Crea un rol con sus permisos en una transacción (rol + `RolPermiso` +
 * bitácora, A2/A7). Nombre único → `ErrorConflicto`.
 *
 * @example
 * const rol = await crearRol(sesion, {
 *   nombre: "Almacenista",
 *   clavesPermisos: ["almacenes.ver", "almacenes.administrar"],
 * });
 */
export async function crearRol(
  sesion: SesionUsuario,
  entrada: EntradaCrearRol,
  bd?: ContextoBd,
): Promise<RolDto> {
  verificarPermiso(sesion, 'roles.administrar');
  const datos = validarEntrada(esquemaCrearRol, entrada);

  try {
    return await enTransaccion(async (tx) => {
      const existente = await tx.rol.findFirst({
        where: { nombre: { equals: datos.nombre, mode: 'insensitive' } },
        select: { id: true },
      });
      if (existente !== null) {
        throw new ErrorConflicto(`Ya existe un rol llamado "${datos.nombre}".`);
      }

      const idsPermisos = await resolverPermisos(tx, datos.clavesPermisos);
      const rol = await tx.rol.create({
        data: {
          nombre: datos.nombre,
          descripcion: datos.descripcion,
          esSistema: false, // los roles de sistema solo nacen del seed
          ...datosCreacion(sesion),
        },
        select: { id: true },
      });

      if (idsPermisos.length > 0) {
        await tx.rolPermiso.createMany({
          data: idsPermisos.map((idPermiso) => ({
            idRol: rol.id,
            idPermiso,
            creadoPorId: sesion.id,
          })),
        });
      }

      await registrarBitacora(tx, sesion, {
        entidad: 'Rol',
        idEntidad: rol.id,
        accion: 'CREAR',
        datos: { nombre: datos.nombre, clavesPermisos: datos.clavesPermisos },
      });

      return aDto(await exigirRol(tx, rol.id));
    }, bd);
  } catch (error) {
    if (codigoErrorPrisma(error) === CODIGO_PRISMA.unicidad) {
      throw new ErrorConflicto(`Ya existe un rol llamado "${datos.nombre}".`, { causa: error });
    }
    throw error;
  }
}

/**
 * Actualiza nombre/descripción de un rol. Un rol de sistema NO se renombra
 * (`ErrorValidacion`); su descripción sí es editable.
 */
export async function actualizarRol(
  sesion: SesionUsuario,
  id: number,
  cambios: EntradaActualizarRol,
  bd?: ContextoBd,
): Promise<RolDto> {
  verificarPermiso(sesion, 'roles.administrar');
  const datos = validarEntrada(esquemaActualizarRol, cambios);

  try {
    return await enTransaccion(async (tx) => {
      const actual = await exigirRol(tx, id);
      if (datos.nombre !== undefined && actual.esSistema && datos.nombre !== actual.nombre) {
        throw new ErrorValidacion(
          `El rol "${actual.nombre}" es del sistema y no se puede renombrar.`,
        );
      }
      if (datos.nombre !== undefined && datos.nombre !== actual.nombre) {
        const repetido = await tx.rol.findFirst({
          where: { nombre: { equals: datos.nombre, mode: 'insensitive' }, id: { not: id } },
          select: { id: true },
        });
        if (repetido !== null) {
          throw new ErrorConflicto(`Ya existe un rol llamado "${datos.nombre}".`);
        }
      }

      await tx.rol.update({
        where: { id },
        data: {
          ...(datos.nombre === undefined ? {} : { nombre: datos.nombre }),
          ...(datos.descripcion === undefined ? {} : { descripcion: datos.descripcion }),
          ...datosModificacion(sesion),
        },
      });

      await registrarBitacora(tx, sesion, {
        entidad: 'Rol',
        idEntidad: id,
        accion: 'MODIFICAR',
        datos: {
          ...(datos.nombre === undefined ? {} : { nombre: { de: actual.nombre, a: datos.nombre } }),
          ...(datos.descripcion === undefined ? {} : { descripcion: datos.descripcion }),
        },
      });

      return aDto(await exigirRol(tx, id));
    }, bd);
  } catch (error) {
    if (codigoErrorPrisma(error) === CODIGO_PRISMA.unicidad) {
      throw new ErrorConflicto('Ya existe un rol con ese nombre.', { causa: error });
    }
    throw error;
  }
}

/**
 * Clave del permiso que gobierna la administración de roles y permisos. Es el
 * candado de seguridad del RBAC: si NINGÚN usuario activo la tiene, nadie puede
 * volver a tocar permisos (lockout permanente).
 */
const CLAVE_ADMIN_ROLES = 'roles.administrar';

/**
 * Clave CONSTANTE del advisory lock que serializa entre sí TODAS las mutaciones
 * de permisos (`asignarPermisos` + `eliminarRol`). NO se mezcla el id del rol a
 * propósito: el guard anti-lockout es una invariante GLOBAL ("¿queda algún
 * usuario activo que pueda administrar roles?"), así que dos operaciones sobre
 * roles DISTINTOS también deben serializarse — de lo contrario el conteo bajo
 * READ COMMITTED sufre write-skew (dos tx que quitan la clave a A y a B, cada una
 * sin ver el `delete` no-commiteado de la otra, ambas cuentan "aún queda 1" y
 * ambas commitean → 0 administradores). Forma de UN argumento
 * `pg_advisory_xact_lock(bigint)`: ocupa un espacio de locks distinto al de dos
 * enteros del kardex, imposible que colisione. El valor es un discriminador
 * arbitrario y único de este guard ("ROLES_A" en hex).
 */
const CLAVE_LOCK_GUARD_ROLES = 0x524f4c45535f41n;

/**
 * Serializa las mutaciones de permisos tomando el advisory lock transaccional de
 * clave constante. Se toma al ENTRAR a la operación, ANTES de contar/mutar; se
 * libera solo al terminar la transacción (no hay que soltarlo a mano).
 */
async function bloquearGuardRoles(tx: Tx): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${CLAVE_LOCK_GUARD_ROLES}::bigint)`;
}

/**
 * Guard anti-lockout a nivel USUARIO (no rol): tras retirar `roles.administrar`
 * del rol `idRolQuePierde`, exige que siga habiendo ≥1 usuario ACTIVO capaz de
 * administrar roles vía ALGÚN OTRO rol. Un rol admin "huérfano" (con la clave
 * pero 0 usuarios) NO cuenta: por eso se cuentan usuarios, no roles. Debe
 * llamarse BAJO el lock ({@link bloquearGuardRoles}) para que el conteo sea
 * consistente frente a mutaciones concurrentes.
 */
async function verificarNoLockout(tx: Tx, idRolQuePierde: number): Promise<void> {
  const administradoresRestantes = await tx.usuario.count({
    where: {
      activo: true,
      roles: {
        some: {
          idRol: { not: idRolQuePierde },
          rol: { permisos: { some: { permiso: { clave: CLAVE_ADMIN_ROLES } } } },
        },
      },
    },
  });
  if (administradoresRestantes === 0) {
    throw new ErrorConflicto(
      'No puedes dejar al sistema sin ningún usuario activo que pueda administrar roles y permisos.',
    );
  }
}

/**
 * REEMPLAZA el conjunto de permisos del rol (lo marcado en pantalla es lo que
 * queda). También aplica a roles de sistema: así Daniel afina el mapeo
 * aproximado de niveles→permisos del seed.
 *
 * ⚠️ Guard anti-lockout (seguridad RBAC): si el reemplazo RETIRA
 * `roles.administrar` de este rol y con ello el sistema quedaría sin NINGÚN
 * usuario activo que pueda administrar permisos, se rechaza (`ErrorConflicto`).
 * Se toma un advisory lock de clave constante ANTES del conteo para cerrar la
 * carrera write-skew (ver {@link bloquearGuardRoles}); el guard es a nivel
 * usuario, así que un rol admin sin usuarios no cuenta.
 */
export async function asignarPermisos(
  sesion: SesionUsuario,
  id: number,
  clavesPermisos: string[],
  bd?: ContextoBd,
): Promise<RolDto> {
  verificarPermiso(sesion, 'roles.administrar');
  const claves = validarEntrada(z.array(esquemaClavePermiso), clavesPermisos);

  return enTransaccion(async (tx) => {
    await bloquearGuardRoles(tx);
    const actual = await exigirRol(tx, id);
    const idsPermisos = await resolverPermisos(tx, claves);

    // El guard solo dispara si la operación efectivamente RETIRA la clave admin.
    const teniaAdmin = actual.permisos.some((a) => a.permiso.clave === CLAVE_ADMIN_ROLES);
    const tendraAdmin = claves.includes(CLAVE_ADMIN_ROLES);
    if (teniaAdmin && !tendraAdmin) {
      await verificarNoLockout(tx, id);
    }

    await tx.rolPermiso.deleteMany({ where: { idRol: id } });
    if (idsPermisos.length > 0) {
      await tx.rolPermiso.createMany({
        data: idsPermisos.map((idPermiso) => ({ idRol: id, idPermiso, creadoPorId: sesion.id })),
      });
    }
    await tx.rol.update({ where: { id }, data: datosModificacion(sesion) });

    await registrarBitacora(tx, sesion, {
      entidad: 'Rol',
      idEntidad: id,
      accion: 'MODIFICAR',
      datos: { operacion: 'asignarPermisos', nombre: actual.nombre, clavesPermisos: claves },
    });

    return aDto(await exigirRol(tx, id));
  }, bd);
}

/**
 * Elimina un rol que NO sea de sistema y que NO tenga usuarios asignados
 * (con usuarios es `ErrorConflicto`: primero reasigna a esas personas).
 * Los roles son configuración, no datos operativos: aquí el borrado es real.
 *
 * ⚠️ Guard anti-lockout SIMÉTRICO al de `asignarPermisos`: si el rol borrado
 * OTORGABA `roles.administrar` y con ello el sistema quedaría sin NINGÚN usuario
 * activo capaz de administrar permisos, se rechaza (`ErrorConflicto`). Toma el
 * MISMO advisory lock de clave constante que `asignarPermisos` para serializar
 * ambas rutas entre sí (un borrado y una reasignación concurrentes no pueden
 * sortear el guard). El guard es a nivel usuario (un rol admin huérfano no
 * cuenta).
 */
export async function eliminarRol(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<void> {
  verificarPermiso(sesion, 'roles.administrar');

  await enTransaccion(async (tx) => {
    await bloquearGuardRoles(tx);
    const actual = await exigirRol(tx, id);
    if (actual.esSistema) {
      throw new ErrorValidacion(`El rol "${actual.nombre}" es del sistema y no se puede borrar.`);
    }
    if (actual._count.usuarios > 0) {
      throw new ErrorConflicto(
        `El rol "${actual.nombre}" tiene ${String(actual._count.usuarios)} usuario(s) asignado(s); reasígnalos antes de borrarlo.`,
      );
    }
    // Si el rol otorgaba la clave admin, verificar que no sea el último camino.
    const otorgabaAdmin = actual.permisos.some((a) => a.permiso.clave === CLAVE_ADMIN_ROLES);
    if (otorgabaAdmin) {
      await verificarNoLockout(tx, id);
    }

    await tx.rolPermiso.deleteMany({ where: { idRol: id } });
    await tx.rol.delete({ where: { id } });

    await registrarBitacora(tx, sesion, {
      entidad: 'Rol',
      idEntidad: id,
      accion: 'OTRO',
      datos: { operacion: 'eliminar', nombre: actual.nombre },
    });
  }, bd);
}

/** Obtiene un rol con sus permisos o lanza `ErrorNoEncontrado`. */
export async function obtenerRol(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<RolDto> {
  verificarPermiso(sesion, 'roles.administrar');
  const rol = await clienteLectura(bd).rol.findUnique({ where: { id }, select: seleccionRol });
  if (rol === null) {
    throw new ErrorNoEncontrado('Rol', id);
  }
  return aDto(rol);
}

/**
 * Lista TODOS los roles (son pocos: 9 de sistema + los que se creen), con
 * sus claves de permiso y conteo de usuarios, ordenados por nombre.
 */
export async function listarRoles(sesion: SesionUsuario, bd?: ContextoBd): Promise<RolDto[]> {
  verificarPermiso(sesion, 'roles.administrar');
  const roles = await clienteLectura(bd).rol.findMany({
    select: seleccionRol,
    orderBy: { nombre: 'asc' },
  });
  return roles.map(aDto);
}
