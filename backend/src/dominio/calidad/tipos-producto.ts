/**
 * Tipos de producto (F6-E1, decisión (d) — DECISIONES.md §F6; doc 09 §5.2). Catálogo CORTO y
 * editable que clasifica los modelos para FILTRAR los defectos aplicables a una auditoría (NO para
 * el plan AQL: hay un solo plan para todos, decisión (c)). CRUD patrón Almacenes con borrado SUAVE:
 * un tipo en uso por modelos/defectos NO se borra físico, solo se inactiva (las FK son Restrict).
 *
 * Lógica de negocio SOLO aquí (A1); transacción + auditoría + bitácora juntas (A2/A7); catálogo
 * GLOBAL como los de F1 (sin idEmpresa). Unicidad de `nombre` insensible a mayúsculas.
 */
import { esquemaTipoProductoCrear, esquemaTipoProductoEditar } from '../../contrato/index.js';
import type { Prisma, TipoProducto } from '../../datos/index.js';
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

/** Alta: campos del esquema compartido. */
export type EntradaCrearTipoProducto = z.input<typeof esquemaTipoProductoCrear>;
/** Edición: `id` + cambios parciales (incluye `activo` para des/reactivar). */
export type EntradaActualizarTipoProducto = z.input<typeof esquemaTipoProductoEditar>;

/**
 * Filtros del listado con tipos NATIVOS (boolean ya coaccionado): la ruta recibe el querystring con
 * `stringbool` (contrato) y la coacción de Zod entrega aquí un boolean. Mismo patrón que Almacenes
 * y Tipos de proceso (el dominio re-valida con su propio esquema, sin `stringbool`/`coerce`).
 */
export const esquemaListarTiposProducto = esquemaPaginacion.extend({
  busqueda: z.string().trim().max(100).optional(),
  incluirInactivos: z.boolean().default(false),
  ordenarPor: z.enum(['nombre', 'creadoEn']).default('nombre'),
  direccion: z.enum(['asc', 'desc']).default('asc'),
});

/** Parámetros del listado (los reutiliza la ruta REST en su entrada). */
export type ParametrosListarTiposProducto = z.input<typeof esquemaListarTiposProducto>;

/**
 * Unicidad de negocio: no puede haber dos tipos de producto con el mismo nombre, sin importar
 * mayúsculas. Se valida DENTRO de la transacción; la carrera residual la captura el unique de la
 * base (P2002 → `ErrorConflicto`).
 */
async function exigirNombreLibre(tx: Tx, nombre: string, idActual?: number): Promise<void> {
  const existente = await tx.tipoProducto.findFirst({
    where: {
      nombre: { equals: nombre, mode: 'insensitive' },
      ...(idActual === undefined ? {} : { id: { not: idActual } }),
    },
    select: { id: true, activo: true },
  });
  if (existente !== null) {
    throw new ErrorConflicto(
      existente.activo
        ? `Ya existe un tipo de producto llamado "${nombre}".`
        : `Ya existe un tipo de producto llamado "${nombre}" (está desactivado; puedes reactivarlo).`,
    );
  }
}

/** Busca un tipo de producto por id o lanza `ErrorNoEncontrado`. */
async function exigirTipoProducto(tx: Tx, id: number): Promise<TipoProducto> {
  const tipo = await tx.tipoProducto.findUnique({ where: { id } });
  if (tipo === null) {
    throw new ErrorNoEncontrado('TipoProducto', id);
  }
  return tipo;
}

/**
 * Crea un tipo de producto. Permiso `calidad.administrar-catalogo`; nombre único; nace activo;
 * auditoría y bitácora en la misma transacción (A2/A7).
 */
export async function crearTipoProducto(
  sesion: SesionUsuario,
  entrada: EntradaCrearTipoProducto,
  bd?: ContextoBd,
): Promise<TipoProducto> {
  verificarPermiso(sesion, 'calidad.administrar-catalogo');
  const datos = validarEntrada(esquemaTipoProductoCrear, entrada);

  try {
    return await enTransaccion(async (tx) => {
      await exigirNombreLibre(tx, datos.nombre);
      const tipo = await tx.tipoProducto.create({
        data: { nombre: datos.nombre, ...datosCreacion(sesion) },
      });
      await registrarBitacora(tx, sesion, {
        entidad: 'TipoProducto',
        idEntidad: tipo.id,
        accion: 'CREAR',
        datos: { nombre: tipo.nombre },
      });
      return tipo;
    }, bd);
  } catch (error) {
    if (codigoErrorPrisma(error) === CODIGO_PRISMA.unicidad) {
      throw new ErrorConflicto(`Ya existe un tipo de producto llamado "${datos.nombre}".`, {
        causa: error,
      });
    }
    throw error;
  }
}

/**
 * Actualiza un tipo de producto: nombre y/o `activo` (desactivar/reactivar). Bitácora según lo que
 * pasó (`MODIFICAR`/`DESACTIVAR`). Idempotente: si nada cambia, no escribe bitácora vacía.
 */
export async function actualizarTipoProducto(
  sesion: SesionUsuario,
  entrada: EntradaActualizarTipoProducto,
  bd?: ContextoBd,
): Promise<TipoProducto> {
  verificarPermiso(sesion, 'calidad.administrar-catalogo');
  const datos = validarEntrada(esquemaTipoProductoEditar, entrada);

  try {
    return await enTransaccion(async (tx) => {
      const actual = await exigirTipoProducto(tx, datos.id);
      const cambiaNombre = datos.nombre !== undefined && datos.nombre !== actual.nombre;
      const reactiva = datos.activo === true && !actual.activo;
      const desactiva = datos.activo === false && actual.activo;

      if (!cambiaNombre && !reactiva && !desactiva) {
        return actual;
      }
      if (cambiaNombre) {
        await exigirNombreLibre(tx, datos.nombre ?? actual.nombre, datos.id);
      } else if (reactiva) {
        await exigirNombreLibre(tx, actual.nombre, datos.id);
      }

      const cambios: Prisma.TipoProductoUpdateInput = { ...datosModificacion(sesion) };
      if (cambiaNombre && datos.nombre !== undefined) {
        cambios.nombre = datos.nombre;
      }
      if ((reactiva || desactiva) && datos.activo !== undefined) {
        cambios.activo = datos.activo;
      }
      const tipo = await tx.tipoProducto.update({ where: { id: datos.id }, data: cambios });

      if (cambiaNombre || reactiva) {
        await registrarBitacora(tx, sesion, {
          entidad: 'TipoProducto',
          idEntidad: tipo.id,
          accion: 'MODIFICAR',
          datos: {
            ...(cambiaNombre ? { nombre: { de: actual.nombre, a: tipo.nombre } } : {}),
            ...(reactiva ? { operacion: 'reactivar' } : {}),
          },
        });
      }
      if (desactiva) {
        await registrarBitacora(tx, sesion, {
          entidad: 'TipoProducto',
          idEntidad: tipo.id,
          accion: 'DESACTIVAR',
          datos: { nombre: tipo.nombre },
        });
      }
      return tipo;
    }, bd);
  } catch (error) {
    if (codigoErrorPrisma(error) === CODIGO_PRISMA.unicidad) {
      throw new ErrorConflicto('Ya existe un tipo de producto con ese nombre.', { causa: error });
    }
    throw error;
  }
}

/** Desactiva (borrado SUAVE) un tipo de producto. Desactivarlo dos veces es `ErrorConflicto`. */
export async function desactivarTipoProducto(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<TipoProducto> {
  verificarPermiso(sesion, 'calidad.administrar-catalogo');
  return enTransaccion(async (tx) => {
    const actual = await exigirTipoProducto(tx, id);
    if (!actual.activo) {
      throw new ErrorConflicto(`El tipo de producto "${actual.nombre}" ya está desactivado.`);
    }
    return actualizarTipoProducto(sesion, { id, activo: false }, { tx });
  }, bd);
}

/** Reactiva un tipo de producto desactivado (operación inversa del borrado suave). */
export async function reactivarTipoProducto(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<TipoProducto> {
  verificarPermiso(sesion, 'calidad.administrar-catalogo');
  return enTransaccion(async (tx) => {
    const actual = await exigirTipoProducto(tx, id);
    if (actual.activo) {
      throw new ErrorConflicto(`El tipo de producto "${actual.nombre}" ya está activo.`);
    }
    return actualizarTipoProducto(sesion, { id, activo: true }, { tx });
  }, bd);
}

/** Obtiene un tipo de producto por id o lanza `ErrorNoEncontrado`. */
export async function obtenerTipoProducto(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<TipoProducto> {
  verificarPermiso(sesion, 'calidad.ver');
  const tipo = await clienteLectura(bd).tipoProducto.findUnique({ where: { id } });
  if (tipo === null) {
    throw new ErrorNoEncontrado('TipoProducto', id);
  }
  return tipo;
}

/** Lista tipos de producto con búsqueda, orden y paginación EN SERVIDOR. */
export async function listarTiposProducto(
  sesion: SesionUsuario,
  parametros: ParametrosListarTiposProducto = {},
  bd?: ContextoBd,
): Promise<Pagina<TipoProducto>> {
  verificarPermiso(sesion, 'calidad.ver');
  const filtros = validarEntrada(esquemaListarTiposProducto, parametros);

  const where: Prisma.TipoProductoWhereInput = {
    ...(filtros.incluirInactivos ? {} : { activo: true }),
    ...(filtros.busqueda === undefined || filtros.busqueda === ''
      ? {}
      : { nombre: { contains: filtros.busqueda, mode: 'insensitive' } }),
  };

  const cliente = clienteLectura(bd);
  const [total, datos] = await Promise.all([
    cliente.tipoProducto.count({ where }),
    cliente.tipoProducto.findMany({
      where,
      orderBy: { [filtros.ordenarPor]: filtros.direccion },
      ...rangoPrisma(filtros),
    }),
  ]);
  return armarPagina(datos, total, filtros);
}
