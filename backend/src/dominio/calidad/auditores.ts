/**
 * Catálogo de AUDITORES de calidad (rediseño R9 — proto `CAT_AUDITORES`). CRUD patrón catálogo
 * (Tipos de producto / Almacenes) con borrado SUAVE: un auditor con auditorías históricas NO se
 * borra físico, solo se inactiva. Catálogo GLOBAL (A9, sin idEmpresa). `rol` y `nivelAql` se
 * validan a listas cerradas en el contrato. Unicidad de `nombre` insensible a mayúsculas.
 *
 * `numeroAuditorias` (proto) NO se persiste: se DERIVA best-effort del histórico contando las
 * `Auditoria` cuyo `auditorPorId` (String sin FK, ADR-0005) coincide con el nombre del auditor; se
 * cuentan las NO canceladas. En el listado se resuelve con un solo `groupBy` para toda la página
 * (map en memoria, nunca un count por fila). Lógica SOLO aquí (A1); transacción + auditoría +
 * bitácora juntas (A2/A7).
 */
import { esquemaAuditorCrear, esquemaAuditorEditar } from '../../contrato/index.js';
import type { Auditor, Prisma } from '../../datos/index.js';
import { z } from 'zod';

import { datosCreacion, datosModificacion, registrarBitacora } from '../../comun/auditoria.js';
import { ErrorConflicto, ErrorNoEncontrado } from '../../comun/errores.js';
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

/** Auditor + su conteo DERIVADO de auditorías (lo que devuelven los servicios y proyecta la ruta). */
export type AuditorConConteo = Auditor & { numeroAuditorias: number };

/** Cliente de lectura (transacción o singleton), como lo entrega `clienteLectura`. */
type ClienteLectura = ReturnType<typeof clienteLectura>;

/** Alta: campos del esquema compartido. */
export type EntradaCrearAuditor = z.input<typeof esquemaAuditorCrear>;
/** Edición: `id` + cambios parciales (incluye `activo` para des/reactivar). */
export type EntradaActualizarAuditor = z.input<typeof esquemaAuditorEditar>;

/**
 * Filtros del listado con tipos NATIVOS (boolean ya coaccionado): la ruta recibe el querystring con
 * `stringbool` (contrato) y aquí re-valida con tipos nativos (patrón Almacenes / Tipos de producto).
 */
export const esquemaListarAuditores = esquemaPaginacion.extend({
  busqueda: z.string().trim().max(100).optional(),
  incluirInactivos: z.boolean().default(false),
  ordenarPor: z.enum(['nombre', 'creadoEn']).default('nombre'),
  direccion: z.enum(['asc', 'desc']).default('asc'),
});

/** Parámetros del listado. */
export type ParametrosListarAuditores = z.input<typeof esquemaListarAuditores>;

/**
 * Cuenta las auditorías NO canceladas por nombre de auditor (`auditorPorId`), en UN solo `groupBy`
 * para el conjunto de nombres dado. Devuelve un Map nombre→conteo (best-effort sobre el String
 * histórico). Los nombres sin auditorías simplemente no aparecen (el llamador aplica `?? 0`).
 */
async function contarAuditoriasPorNombre(
  cliente: ClienteLectura,
  nombres: readonly string[],
): Promise<Map<string, number>> {
  if (nombres.length === 0) {
    return new Map();
  }
  const grupos = await cliente.auditoria.groupBy({
    by: ['auditorPorId'],
    where: { auditorPorId: { in: [...nombres] }, cancelada: false },
    _count: { _all: true },
  });
  const mapa = new Map<string, number>();
  for (const grupo of grupos) {
    if (grupo.auditorPorId !== null) {
      mapa.set(grupo.auditorPorId, grupo._count._all);
    }
  }
  return mapa;
}

/** Adjunta a un auditor su conteo derivado de auditorías (una consulta para ese único nombre). */
async function adjuntarConteo(
  cliente: ClienteLectura,
  auditor: Auditor,
): Promise<AuditorConConteo> {
  const mapa = await contarAuditoriasPorNombre(cliente, [auditor.nombre]);
  return { ...auditor, numeroAuditorias: mapa.get(auditor.nombre) ?? 0 };
}

/** Unicidad de negocio: no puede haber dos auditores con el mismo nombre (insensible a mayúsculas). */
async function exigirNombreLibre(tx: Tx, nombre: string, idActual?: number): Promise<void> {
  const existente = await tx.auditor.findFirst({
    where: {
      nombre: { equals: nombre, mode: 'insensitive' },
      ...(idActual === undefined ? {} : { id: { not: idActual } }),
    },
    select: { id: true, activo: true },
  });
  if (existente !== null) {
    throw new ErrorConflicto(
      existente.activo
        ? `Ya existe un auditor llamado "${nombre}".`
        : `Ya existe un auditor llamado "${nombre}" (está desactivado; puedes reactivarlo).`,
    );
  }
}

/** Busca un auditor por id o lanza `ErrorNoEncontrado`. */
async function exigirAuditor(tx: Tx, id: number): Promise<Auditor> {
  const auditor = await tx.auditor.findUnique({ where: { id } });
  if (auditor === null) {
    throw new ErrorNoEncontrado('Auditor', id);
  }
  return auditor;
}

/**
 * Crea un auditor. Permiso `calidad.administrar-catalogo`; nombre único; nace activo; auditoría y
 * bitácora en la misma transacción (A2/A7).
 */
export async function crearAuditor(
  sesion: SesionUsuario,
  entrada: EntradaCrearAuditor,
  bd?: ContextoBd,
): Promise<AuditorConConteo> {
  verificarPermiso(sesion, 'calidad.administrar-catalogo');
  const datos = validarEntrada(esquemaAuditorCrear, entrada);

  try {
    const auditor = await enTransaccion(async (tx) => {
      await exigirNombreLibre(tx, datos.nombre);
      const creado = await tx.auditor.create({
        data: {
          nombre: datos.nombre,
          rol: datos.rol,
          nivelAql: datos.nivelAql,
          ...datosCreacion(sesion),
        },
      });
      await registrarBitacora(tx, sesion, {
        entidad: 'Auditor',
        idEntidad: creado.id,
        accion: 'CREAR',
        datos: { nombre: creado.nombre, rol: creado.rol, nivelAql: creado.nivelAql },
      });
      return creado;
    }, bd);
    return adjuntarConteo(clienteLectura(bd), auditor);
  } catch (error) {
    if (codigoErrorPrisma(error) === CODIGO_PRISMA.unicidad) {
      throw new ErrorConflicto(`Ya existe un auditor llamado "${datos.nombre}".`, { causa: error });
    }
    throw error;
  }
}

/**
 * Actualiza un auditor (edición parcial) + `activo` para des/reactivar. Bitácora según lo que pasó
 * (`MODIFICAR`/`DESACTIVAR`). Idempotente: si nada cambia, no escribe bitácora vacía.
 */
export async function actualizarAuditor(
  sesion: SesionUsuario,
  entrada: EntradaActualizarAuditor,
  bd?: ContextoBd,
): Promise<AuditorConConteo> {
  verificarPermiso(sesion, 'calidad.administrar-catalogo');
  const datos = validarEntrada(esquemaAuditorEditar, entrada);

  try {
    const auditor = await enTransaccion(async (tx) => {
      const actual = await exigirAuditor(tx, datos.id);

      const cambiaNombre = datos.nombre !== undefined && datos.nombre !== actual.nombre;
      const cambiaRol = datos.rol !== undefined && datos.rol !== actual.rol;
      const cambiaNivel = datos.nivelAql !== undefined && datos.nivelAql !== actual.nivelAql;
      const reactiva = datos.activo === true && !actual.activo;
      const desactiva = datos.activo === false && actual.activo;

      if (!cambiaNombre && !cambiaRol && !cambiaNivel && !reactiva && !desactiva) {
        return actual;
      }
      if (cambiaNombre) {
        await exigirNombreLibre(tx, datos.nombre ?? actual.nombre, datos.id);
      } else if (reactiva) {
        await exigirNombreLibre(tx, actual.nombre, datos.id);
      }

      const cambios: Prisma.AuditorUpdateInput = { ...datosModificacion(sesion) };
      if (cambiaNombre && datos.nombre !== undefined) {
        cambios.nombre = datos.nombre;
      }
      if (cambiaRol && datos.rol !== undefined) {
        cambios.rol = datos.rol;
      }
      if (cambiaNivel && datos.nivelAql !== undefined) {
        cambios.nivelAql = datos.nivelAql;
      }
      if ((reactiva || desactiva) && datos.activo !== undefined) {
        cambios.activo = datos.activo;
      }
      const actualizado = await tx.auditor.update({ where: { id: datos.id }, data: cambios });

      if (cambiaNombre || cambiaRol || cambiaNivel || reactiva) {
        await registrarBitacora(tx, sesion, {
          entidad: 'Auditor',
          idEntidad: actualizado.id,
          accion: 'MODIFICAR',
          datos: {
            ...(cambiaNombre ? { nombre: { de: actual.nombre, a: actualizado.nombre } } : {}),
            ...(cambiaRol ? { rol: { de: actual.rol, a: actualizado.rol } } : {}),
            ...(cambiaNivel ? { nivelAql: { de: actual.nivelAql, a: actualizado.nivelAql } } : {}),
            ...(reactiva ? { operacion: 'reactivar' } : {}),
          },
        });
      }
      if (desactiva) {
        await registrarBitacora(tx, sesion, {
          entidad: 'Auditor',
          idEntidad: actualizado.id,
          accion: 'DESACTIVAR',
          datos: { nombre: actualizado.nombre },
        });
      }
      return actualizado;
    }, bd);
    return adjuntarConteo(clienteLectura(bd), auditor);
  } catch (error) {
    if (codigoErrorPrisma(error) === CODIGO_PRISMA.unicidad) {
      throw new ErrorConflicto('Ya existe un auditor con ese nombre.', { causa: error });
    }
    throw error;
  }
}

/** Desactiva (borrado SUAVE) un auditor. Desactivarlo dos veces es `ErrorConflicto`. */
export async function desactivarAuditor(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<AuditorConConteo> {
  verificarPermiso(sesion, 'calidad.administrar-catalogo');
  return enTransaccion(async (tx) => {
    const actual = await exigirAuditor(tx, id);
    if (!actual.activo) {
      throw new ErrorConflicto(`El auditor "${actual.nombre}" ya está desactivado.`);
    }
    return actualizarAuditor(sesion, { id, activo: false }, { tx });
  }, bd);
}

/** Reactiva un auditor desactivado (operación inversa del borrado suave). */
export async function reactivarAuditor(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<AuditorConConteo> {
  verificarPermiso(sesion, 'calidad.administrar-catalogo');
  return enTransaccion(async (tx) => {
    const actual = await exigirAuditor(tx, id);
    if (actual.activo) {
      throw new ErrorConflicto(`El auditor "${actual.nombre}" ya está activo.`);
    }
    return actualizarAuditor(sesion, { id, activo: true }, { tx });
  }, bd);
}

/** Obtiene un auditor por id (con su conteo) o lanza `ErrorNoEncontrado`. */
export async function obtenerAuditor(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<AuditorConConteo> {
  verificarPermiso(sesion, 'calidad.ver');
  const cliente = clienteLectura(bd);
  const auditor = await cliente.auditor.findUnique({ where: { id } });
  if (auditor === null) {
    throw new ErrorNoEncontrado('Auditor', id);
  }
  return adjuntarConteo(cliente, auditor);
}

/** Lista auditores con búsqueda, orden y paginación EN SERVIDOR + su conteo derivado de auditorías. */
export async function listarAuditores(
  sesion: SesionUsuario,
  parametros: ParametrosListarAuditores = {},
  bd?: ContextoBd,
): Promise<Pagina<AuditorConConteo>> {
  verificarPermiso(sesion, 'calidad.ver');
  const filtros = validarEntrada(esquemaListarAuditores, parametros);

  const where: Prisma.AuditorWhereInput = {
    ...(filtros.incluirInactivos ? {} : { activo: true }),
    ...(filtros.busqueda === undefined || filtros.busqueda === ''
      ? {}
      : { nombre: { contains: filtros.busqueda, mode: 'insensitive' } }),
  };

  const cliente = clienteLectura(bd);
  const [total, datos] = await Promise.all([
    cliente.auditor.count({ where }),
    cliente.auditor.findMany({
      where,
      orderBy: { [filtros.ordenarPor]: filtros.direccion },
      ...rangoPrisma(filtros),
    }),
  ]);

  const conteos = await contarAuditoriasPorNombre(
    cliente,
    datos.map((a) => a.nombre),
  );
  const conConteo = datos.map((a) => ({ ...a, numeroAuditorias: conteos.get(a.nombre) ?? 0 }));
  return armarPagina(conConteo, total, filtros);
}
