/**
 * Administración de usuarios (doc funcional 00 §1.1 y 10 §4; MEJORAS A4).
 *
 * Decisiones que implementa:
 * - **Un solo sistema de seguridad** (A4): el usuario obtiene permisos por
 *   ROLES; no hay niveles ni banderas sueltas.
 * - **Contraseñas SIEMPRE hasheadas** (doc 10 §6.3: en el viejo
 *   `Usuarios.Clave` era texto plano): el hash scrypt de `better-auth/crypto`
 *   vive en la `Cuenta` con `providerId: "credential"` — el mismo formato que
 *   verifica el login de better-auth (E3, ADR-0003). Ningún servicio devuelve
 *   hashes. El RESET de contraseña por un administrador vive aquí
 *   (`cambiarContrasenaUsuario`), reusando ese mismo hash scrypt que el alta y el
 *   seed; NO es el self-service de better-auth (que exige la clave actual).
 * - **Bloqueo por intentos** (doc 00 §1.1: al 5º intento fallido el viejo
 *   bloqueaba con "Estás bloqueado, habla con Daniel Masri"): el contador lo
 *   lleva el login (E3); aquí vive el DESBLOQUEO manual del administrador, y el
 *   desbloqueo siempre reinicia `intentosFallidos`.
 * - **Borrado suave**: los usuarios se desactivan, jamás se borran (su id
 *   firma bitácoras y auditorías históricas).
 *
 * better-auth exige un email único por usuario; el negocio no usa email
 * (doc 10 §4: ~137 usuarios entran con username), así que si el alta no trae
 * uno se genera el sintético `<username>@control.local`.
 */
import {
  esquemaUsuarioCambiarContrasena,
  esquemaUsuarioCrear,
  esquemaUsuarioEditar,
  type DatosUsuarioEditar,
} from '../../contrato/index.js';
import type { Prisma } from '../../datos/index.js';
import { hashPassword } from 'better-auth/crypto';
import { z } from 'zod';

import { datosCreacion, datosModificacion, registrarBitacora } from '../../comun/auditoria.js';
import { ErrorConflicto, ErrorNoEncontrado, ErrorValidacion } from '../../comun/errores.js';
import {
  armarPagina,
  esquemaPaginacion,
  rangoPrisma,
  type Pagina,
} from '../../comun/paginacion.js';
import { verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import { CODIGO_PRISMA, codigoErrorPrisma } from '../../comun/prisma-errores.js';
import {
  clienteLectura,
  enTransaccion,
  type ContextoBd,
  type Tx,
} from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';

/** Dominio del email sintético que se genera cuando el alta no trae correo. */
export const DOMINIO_EMAIL_SINTETICO = 'control.local';

/** Alta (esquema compartido con el formulario del frontend). */
export type EntradaCrearUsuario = z.input<typeof esquemaUsuarioCrear>;

/** Edición (esquema compartido): datos generales, estado y roles — sin contraseña. */
export type EntradaActualizarUsuario = z.input<typeof esquemaUsuarioEditar>;

/** Parámetros del listado de usuarios. */
export const esquemaListarUsuarios = esquemaPaginacion.extend({
  /** Busca en username y nombre (insensible a mayúsculas). */
  busqueda: z.string().trim().max(100).optional(),
  incluirInactivos: z.boolean().default(false),
  /** Solo los bloqueados por intentos (bandeja de "desbloquéame", doc 00 §1.1). */
  soloBloqueados: z.boolean().default(false),
  ordenarPor: z.enum(['username', 'nombre', 'creadoEn']).default('username'),
  direccion: z.enum(['asc', 'desc']).default('asc'),
});

export type ParametrosListarUsuarios = z.input<typeof esquemaListarUsuarios>;

/**
 * Selección SEGURA de usuario: campos de dominio + roles. Sin relaciones de
 * autenticación: los hashes viven en `Cuenta` y aquí ni se seleccionan.
 */
const seleccionUsuario = {
  id: true,
  username: true,
  nombre: true,
  email: true,
  activo: true,
  bloqueado: true,
  intentosFallidos: true,
  esAuditor: true,
  creadoEn: true,
  modificadoEn: true,
  roles: {
    select: { rol: { select: { id: true, nombre: true } } },
    orderBy: { rol: { nombre: 'asc' } },
  },
} satisfies Prisma.UsuarioSelect;

type UsuarioConRoles = Prisma.UsuarioGetPayload<{ select: typeof seleccionUsuario }>;

/** Usuario como lo exponen TODOS los servicios (roles aplanados, sin hashes). */
export interface UsuarioDto {
  id: string;
  username: string;
  nombre: string;
  email: string;
  activo: boolean;
  bloqueado: boolean;
  intentosFallidos: number;
  esAuditor: boolean;
  creadoEn: Date;
  modificadoEn: Date;
  roles: { id: number; nombre: string }[];
}

function aDto(usuario: UsuarioConRoles): UsuarioDto {
  const { roles, ...resto } = usuario;
  return { ...resto, roles: roles.map((asignacion) => asignacion.rol) };
}

/** Valida que TODOS los ids de rol existan; si no, `ErrorValidacion` con los faltantes. */
async function exigirRolesExistentes(tx: Tx, idsRoles: number[]): Promise<void> {
  if (idsRoles.length === 0) {
    return;
  }
  const existentes = await tx.rol.findMany({
    where: { id: { in: idsRoles } },
    select: { id: true },
  });
  const faltantes = idsRoles.filter((id) => !existentes.some((rol) => rol.id === id));
  if (faltantes.length > 0) {
    throw new ErrorValidacion(`Roles inexistentes: ${faltantes.join(', ')}.`);
  }
}

/** Busca el usuario o lanza `ErrorNoEncontrado`. */
async function exigirUsuario(tx: Tx, id: string): Promise<UsuarioConRoles> {
  const usuario = await tx.usuario.findUnique({ where: { id }, select: seleccionUsuario });
  if (usuario === null) {
    throw new ErrorNoEncontrado('Usuario', id);
  }
  return usuario;
}

/** Reemplaza el conjunto de roles del usuario (lo marcado es lo que queda). */
async function reemplazarRoles(
  tx: Tx,
  sesion: SesionUsuario,
  idUsuario: string,
  idsRoles: number[],
): Promise<void> {
  await exigirRolesExistentes(tx, idsRoles);
  await tx.usuarioRol.deleteMany({ where: { idUsuario } });
  if (idsRoles.length > 0) {
    await tx.usuarioRol.createMany({
      data: idsRoles.map((idRol) => ({
        idUsuario,
        idRol,
        creadoPorId: sesion.id,
      })),
    });
  }
}

/**
 * Crea un usuario con su credencial y sus roles, TODO en una transacción
 * (usuario + `Cuenta` credential + `UsuarioRol` + bitácora: o queda completo
 * o no queda nada, A2).
 *
 * Reglas: permiso `usuarios.administrar`; username único, normalizado a
 * minúsculas por el esquema compartido (la forma original queda en
 * `displayUsername`, como espera el plugin username de better-auth);
 * username o email repetidos → `ErrorConflicto`; la contraseña inicial se
 * hashea con scrypt (ADR-0003) y JAMÁS aparece en bitácora ni en respuestas.
 *
 * @example
 * const usuario = await crearUsuario(sesion, {
 *   username: "Caro",            // entra como "caro"; displayUsername "Caro"
 *   nombre: "Carolina",
 *   password: "secreta-larga",
 *   idsRoles: [idRolAsistente],
 * });
 */
export async function crearUsuario(
  sesion: SesionUsuario,
  entrada: EntradaCrearUsuario,
  bd?: ContextoBd,
): Promise<UsuarioDto> {
  verificarPermiso(sesion, 'usuarios.administrar');
  // La forma original del username (antes del toLowerCase del esquema) se
  // conserva como displayUsername — requisito del plugin username.
  const usernameOriginal = typeof entrada.username === 'string' ? entrada.username.trim() : '';
  const datos = validarEntrada(esquemaUsuarioCrear, entrada);
  const email = datos.email ?? `${datos.username}@${DOMINIO_EMAIL_SINTETICO}`;
  const hash = await hashPassword(datos.password);

  try {
    return await enTransaccion(async (tx) => {
      const existente = await tx.usuario.findFirst({
        where: { OR: [{ username: datos.username }, { email }] },
        select: { username: true },
      });
      if (existente !== null) {
        throw new ErrorConflicto(
          existente.username === datos.username
            ? `Ya existe un usuario "${datos.username}".`
            : `Ya existe un usuario con el correo "${email}".`,
        );
      }

      const usuario = await tx.usuario.create({
        data: {
          username: datos.username,
          displayUsername: usernameOriginal === '' ? datos.username : usernameOriginal,
          nombre: datos.nombre,
          email,
          emailVerified: datos.email === undefined, // el sintético no se verifica por correo
          esAuditor: datos.esAuditor,
          ...datosCreacion(sesion),
        },
        select: { id: true },
      });

      await tx.cuenta.create({
        data: {
          accountId: usuario.id,
          providerId: 'credential', // convención de better-auth para email/password
          userId: usuario.id,
          password: hash,
        },
      });

      await reemplazarRoles(tx, sesion, usuario.id, datos.idsRoles);

      await registrarBitacora(tx, sesion, {
        entidad: 'Usuario',
        idEntidad: usuario.id,
        accion: 'CREAR',
        datos: { username: datos.username, idsRoles: datos.idsRoles }, // sin password
      });

      return aDto(await exigirUsuario(tx, usuario.id));
    }, bd);
  } catch (error) {
    if (codigoErrorPrisma(error) === CODIGO_PRISMA.unicidad) {
      throw new ErrorConflicto(`Ya existe un usuario "${datos.username}".`, { causa: error });
    }
    throw error;
  }
}

/**
 * Actualiza un usuario con la forma del esquema compartido
 * `esquemaUsuarioEditar`: datos generales (`nombre`, `email`, `esAuditor`),
 * estado (`activo` = des/reactivar suave; `bloqueado: false` = desbloquear,
 * que SIEMPRE reinicia `intentosFallidos` — doc 00 §1.1) y `idsRoles`
 * (reemplaza el conjunto). Todo en una transacción con bitácora por cada
 * tipo de cambio.
 *
 * Nadie puede desactivarse a sí mismo (te quedarías fuera con la puerta
 * cerrada). Campos sin cambio real se ignoran (idempotente).
 */
export async function actualizarUsuario(
  sesion: SesionUsuario,
  entrada: EntradaActualizarUsuario,
  bd?: ContextoBd,
): Promise<UsuarioDto> {
  verificarPermiso(sesion, 'usuarios.administrar');
  const datos: DatosUsuarioEditar = validarEntrada(esquemaUsuarioEditar, entrada);

  try {
    return await enTransaccion(async (tx) => {
      const actual = await exigirUsuario(tx, datos.id);

      const cambiaNombre = datos.nombre !== undefined && datos.nombre !== actual.nombre;
      const cambiaEmail = datos.email !== undefined && datos.email !== actual.email;
      const cambiaAuditor = datos.esAuditor !== undefined && datos.esAuditor !== actual.esAuditor;
      const desactiva = datos.activo === false && actual.activo;
      const reactiva = datos.activo === true && !actual.activo;
      const desbloquea =
        datos.bloqueado === false && (actual.bloqueado || actual.intentosFallidos > 0);
      const bloquea = datos.bloqueado === true && !actual.bloqueado;
      const idsRolesActuales = actual.roles.map((asignacion) => asignacion.rol.id).sort();
      const cambiaRoles =
        datos.idsRoles !== undefined &&
        JSON.stringify([...datos.idsRoles].sort()) !== JSON.stringify(idsRolesActuales);

      if (desactiva && datos.id === sesion.id) {
        throw new ErrorValidacion('No puedes desactivar tu propio usuario.');
      }

      if (cambiaEmail) {
        const repetido = await tx.usuario.findFirst({
          where: { email: datos.email ?? '', id: { not: datos.id } },
          select: { id: true },
        });
        if (repetido !== null) {
          throw new ErrorConflicto(`Ya existe un usuario con el correo "${datos.email ?? ''}".`);
        }
      }

      const hayCambio =
        cambiaNombre ||
        cambiaEmail ||
        cambiaAuditor ||
        desactiva ||
        reactiva ||
        desbloquea ||
        bloquea;

      if (hayCambio) {
        // Cada bandera ya garantizó que su campo está definido; se arma el update
        // solo con lo que cambió (exactOptionalPropertyTypes: nada de `undefined`).
        const cambios: Prisma.UsuarioUpdateInput = { ...datosModificacion(sesion) };
        if (cambiaNombre && datos.nombre !== undefined) {
          cambios.nombre = datos.nombre;
        }
        if (cambiaEmail && datos.email !== undefined) {
          cambios.email = datos.email;
        }
        if (cambiaAuditor && datos.esAuditor !== undefined) {
          cambios.esAuditor = datos.esAuditor;
        }
        if (desactiva) {
          cambios.activo = false;
        }
        if (reactiva) {
          cambios.activo = true;
        }
        if (desbloquea) {
          cambios.bloqueado = false;
          cambios.intentosFallidos = 0;
        }
        if (bloquea) {
          cambios.bloqueado = true;
        }

        await tx.usuario.update({ where: { id: datos.id }, data: cambios });
      }

      if (cambiaRoles) {
        await reemplazarRoles(tx, sesion, datos.id, datos.idsRoles ?? []);
      }

      if (hayCambio || cambiaRoles) {
        await registrarBitacora(tx, sesion, {
          entidad: 'Usuario',
          idEntidad: datos.id,
          accion: desactiva ? 'DESACTIVAR' : 'MODIFICAR',
          datos: {
            username: actual.username,
            ...(cambiaNombre ? { nombre: { de: actual.nombre, a: datos.nombre ?? '' } } : {}),
            ...(cambiaEmail ? { email: { de: actual.email, a: datos.email ?? '' } } : {}),
            ...(cambiaAuditor ? { esAuditor: datos.esAuditor ?? false } : {}),
            ...(reactiva ? { operacion: 'reactivar' } : {}),
            ...(desbloquea ? { operacion: 'desbloquear' } : {}),
            ...(bloquea ? { operacion: 'bloquear' } : {}),
            ...(cambiaRoles ? { idsRoles: datos.idsRoles ?? [] } : {}),
          },
        });
      }

      return aDto(await exigirUsuario(tx, datos.id));
    }, bd);
  } catch (error) {
    if (codigoErrorPrisma(error) === CODIGO_PRISMA.unicidad) {
      throw new ErrorConflicto('Ya existe un usuario con esos datos únicos.', { causa: error });
    }
    throw error;
  }
}

/**
 * Desactiva un usuario (borrado suave): no puede iniciar sesión pero su
 * historial queda. Desactivar dos veces es `ErrorConflicto`. Atajo explícito
 * del botón "Desactivar" sobre `actualizarUsuario`.
 */
export async function desactivarUsuario(
  sesion: SesionUsuario,
  id: string,
  bd?: ContextoBd,
): Promise<UsuarioDto> {
  verificarPermiso(sesion, 'usuarios.administrar');
  return enTransaccion(async (tx) => {
    const actual = await exigirUsuario(tx, id);
    if (!actual.activo) {
      throw new ErrorConflicto(`El usuario "${actual.username}" ya está desactivado.`);
    }
    return actualizarUsuario(sesion, { id, activo: false }, { tx });
  }, bd);
}

/** Reactiva un usuario desactivado. */
export async function reactivarUsuario(
  sesion: SesionUsuario,
  id: string,
  bd?: ContextoBd,
): Promise<UsuarioDto> {
  verificarPermiso(sesion, 'usuarios.administrar');
  return enTransaccion(async (tx) => {
    const actual = await exigirUsuario(tx, id);
    if (actual.activo) {
      throw new ErrorConflicto(`El usuario "${actual.username}" ya está activo.`);
    }
    return actualizarUsuario(sesion, { id, activo: true }, { tx });
  }, bd);
}

/**
 * Desbloqueo MANUAL por administrador (doc 00 §1.1: en el viejo, al 5º
 * intento fallido el usuario quedaba bloqueado — "Estás bloqueado, habla con
 * Daniel Masri" — y el desbloqueo era manual): `bloqueado=false` e
 * `intentosFallidos=0`, con bitácora. Si no está bloqueado ni tiene intentos
 * acumulados es `ErrorConflicto`.
 */
export async function desbloquearUsuario(
  sesion: SesionUsuario,
  id: string,
  bd?: ContextoBd,
): Promise<UsuarioDto> {
  verificarPermiso(sesion, 'usuarios.administrar');
  return enTransaccion(async (tx) => {
    const actual = await exigirUsuario(tx, id);
    if (!actual.bloqueado && actual.intentosFallidos === 0) {
      throw new ErrorConflicto(`El usuario "${actual.username}" no está bloqueado.`);
    }
    return actualizarUsuario(sesion, { id, bloqueado: false }, { tx });
  }, bd);
}

/**
 * CAMBIO de contraseña por un administrador (reset, doc 10 §6.3). NO es el flujo
 * self-service de better-auth (ese exige la contraseña actual y opera sobre la
 * propia sesión): aquí un administrador fija una nueva contraseña a CUALQUIER
 * usuario. Reusa EXACTAMENTE el mecanismo del alta y del seed —el hash scrypt de
 * `better-auth/crypto` en la `Cuenta` con `providerId: "credential"`, el mismo
 * formato que verifica el login (ADR-0003)— sin introducir lógica de auth nueva.
 *
 * Se hace `upsert` de la credencial (si por algún motivo el usuario no tuviera
 * fila `credential`, se crea) en una transacción con bitácora. La contraseña
 * JAMÁS aparece en la bitácora ni en la respuesta.
 *
 * Reglas: permiso `usuarios.administrar`; el usuario debe existir; la nueva
 * contraseña cumple las reglas del esquema compartido.
 */
export async function cambiarContrasenaUsuario(
  sesion: SesionUsuario,
  id: string,
  password: string,
  bd?: ContextoBd,
): Promise<UsuarioDto> {
  verificarPermiso(sesion, 'usuarios.administrar');
  const datos = validarEntrada(esquemaUsuarioCambiarContrasena, { password });
  const hash = await hashPassword(datos.password);

  return enTransaccion(async (tx) => {
    const actual = await exigirUsuario(tx, id);

    await tx.cuenta.upsert({
      where: { providerId_accountId: { providerId: 'credential', accountId: id } },
      update: { password: hash },
      create: { providerId: 'credential', accountId: id, userId: id, password: hash },
    });

    // Tocar al usuario deja constancia de auditoría (quién/cuándo) de la operación.
    await tx.usuario.update({ where: { id }, data: datosModificacion(sesion) });

    await registrarBitacora(tx, sesion, {
      entidad: 'Usuario',
      idEntidad: id,
      accion: 'MODIFICAR',
      datos: { username: actual.username, operacion: 'cambiarContrasena' }, // sin password
    });

    return aDto(await exigirUsuario(tx, id));
  }, bd);
}

/**
 * REEMPLAZA el conjunto de roles del usuario (lo que se marca en pantalla es
 * lo que queda). Atajo explícito sobre `actualizarUsuario`.
 */
export async function asignarRoles(
  sesion: SesionUsuario,
  id: string,
  idsRoles: number[],
  bd?: ContextoBd,
): Promise<UsuarioDto> {
  return actualizarUsuario(sesion, { id, idsRoles }, bd);
}

/** Obtiene un usuario (sin hashes) o lanza `ErrorNoEncontrado`. */
export async function obtenerUsuario(
  sesion: SesionUsuario,
  id: string,
  bd?: ContextoBd,
): Promise<UsuarioDto> {
  verificarPermiso(sesion, 'usuarios.administrar');
  const usuario = await clienteLectura(bd).usuario.findUnique({
    where: { id },
    select: seleccionUsuario,
  });
  if (usuario === null) {
    throw new ErrorNoEncontrado('Usuario', id);
  }
  return aDto(usuario);
}

/**
 * Lista usuarios con búsqueda (username/nombre), filtros y paginación en
 * servidor. NUNCA incluye hashes ni datos de sesión (selección explícita).
 */
export async function listarUsuarios(
  sesion: SesionUsuario,
  parametros: ParametrosListarUsuarios = {},
  bd?: ContextoBd,
): Promise<Pagina<UsuarioDto>> {
  verificarPermiso(sesion, 'usuarios.administrar');
  const filtros = validarEntrada(esquemaListarUsuarios, parametros);

  const where: Prisma.UsuarioWhereInput = {
    ...(filtros.incluirInactivos ? {} : { activo: true }),
    ...(filtros.soloBloqueados ? { bloqueado: true } : {}),
    ...(filtros.busqueda === undefined || filtros.busqueda === ''
      ? {}
      : {
          OR: [
            { username: { contains: filtros.busqueda, mode: 'insensitive' } },
            { nombre: { contains: filtros.busqueda, mode: 'insensitive' } },
          ],
        }),
  };

  const cliente = clienteLectura(bd);
  const [total, usuarios] = await Promise.all([
    cliente.usuario.count({ where }),
    cliente.usuario.findMany({
      where,
      select: seleccionUsuario,
      orderBy: { [filtros.ordenarPor]: filtros.direccion },
      ...rangoPrisma(filtros),
    }),
  ]);

  return armarPagina(usuarios.map(aDto), total, filtros);
}
