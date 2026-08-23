/**
 * Direcciones de entrega — catálogo maestro GLOBAL (§Post-F9.18).
 *
 * POR QUÉ EXISTE (Daniel, 7-ago-2026): *"la dirección de entrega debe de ser un catálogo de los que
 * se llenan automáticamente, para que la dirección de entrega, que en el 95% es el mismo, tenga la
 * dirección correcta y escrita siempre de la misma manera"*. Antes la OC guardaba texto libre
 * (`entregaEn`) y la misma bodega salía escrita distinto en cada orden.
 *
 * Sigue el CRUD patrón de `catalogos/temporadas.ts`: catálogo global sin `idEmpresa` (ADR-0007,
 * A9), permiso primero, Zod compartido, transacción única con auditoría A7 + `Bitacora`, borrado
 * SUAVE reversible, unicidad respaldada por el unique de la base (P2002 → `ErrorConflicto`),
 * listado paginado/ordenado/buscado en servidor.
 *
 * SIN permiso propio (ADR-0009, igual que `TelaCategoria` con `telas.administrar`): se gobierna con
 * `compras.ver` / `compras.administrar`, porque es un catálogo de apoyo de la orden de compra. Así
 * estrenarlo NO requiere `SEED_ON_START`.
 *
 * LA FAVORITA ES ÚNICA: prender `favorita` en una apaga la de las demás en la MISMA transacción
 * (A2). La UI preselecciona esa al capturar una OC nueva.
 */
import {
  esquemaDireccionEntregaCrear,
  esquemaDireccionEntregaEditar,
} from '../../contrato/index.js';
import type { DireccionEntrega, Prisma } from '../../datos/index.js';
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
export type EntradaCrearDireccionEntrega = z.input<typeof esquemaDireccionEntregaCrear>;
/** Edición: `id` + cambios parciales (incluye `activo` para des/reactivar). */
export type EntradaActualizarDireccionEntrega = z.input<typeof esquemaDireccionEntregaEditar>;

/** Parámetros del listado (los reutiliza la ruta REST en su entrada). */
export const esquemaListarDireccionesEntrega = esquemaPaginacion.extend({
  /** Texto a buscar en nombre o dirección (insensible a mayúsculas). */
  busqueda: z.string().trim().max(200).optional(),
  /** Por omisión solo activas; `true` muestra también las desactivadas. */
  incluirInactivos: z.boolean().default(false),
  ordenarPor: z.enum(['nombre', 'creadoEn']).default('nombre'),
  direccion: z.enum(['asc', 'desc']).default('asc'),
});

export type ParametrosListarDireccionesEntrega = z.input<typeof esquemaListarDireccionesEntrega>;

/** Unicidad de negocio GLOBAL del nombre (ADR-0007), insensible a mayúsculas. */
async function exigirNombreLibre(tx: Tx, nombre: string, idActual?: number): Promise<void> {
  const existente = await tx.direccionEntrega.findFirst({
    where: {
      nombre: { equals: nombre, mode: 'insensitive' },
      ...(idActual === undefined ? {} : { id: { not: idActual } }),
    },
    select: { id: true, activo: true },
  });
  if (existente !== null) {
    throw new ErrorConflicto(
      existente.activo
        ? `Ya existe una dirección de entrega llamada "${nombre}".`
        : `Ya existe una dirección de entrega llamada "${nombre}" (está desactivada; puedes reactivarla).`,
    );
  }
}

/** Busca una dirección por id o lanza `ErrorNoEncontrado`. */
async function exigirDireccion(tx: Tx, id: number): Promise<DireccionEntrega> {
  const direccion = await tx.direccionEntrega.findUnique({ where: { id } });
  if (direccion === null) {
    throw new ErrorNoEncontrado('Dirección de entrega', id);
  }
  return direccion;
}

/**
 * Deja SOLO a `id` como favorita (las demás se apagan). En la misma transacción que el alta/edición
 * que la prendió: nunca quedan dos "la de todos los días".
 */
async function apagarOtrasFavoritas(tx: Tx, sesion: SesionUsuario, id: number): Promise<void> {
  await tx.direccionEntrega.updateMany({
    where: { favorita: true, id: { not: id } },
    data: { favorita: false, ...datosModificacion(sesion) },
  });
}

/** Crea una dirección de entrega. Nace activa; si viene `favorita`, apaga las otras. */
export async function crearDireccionEntrega(
  sesion: SesionUsuario,
  entrada: EntradaCrearDireccionEntrega,
  bd?: ContextoBd,
): Promise<DireccionEntrega> {
  verificarPermiso(sesion, 'compras.administrar');
  const datos = validarEntrada(esquemaDireccionEntregaCrear, entrada);

  try {
    return await enTransaccion(async (tx) => {
      await exigirNombreLibre(tx, datos.nombre);

      const direccion = await tx.direccionEntrega.create({
        data: {
          nombre: datos.nombre,
          direccion: datos.direccion,
          contacto: datos.contacto ?? null,
          telefono: datos.telefono ?? null,
          favorita: datos.favorita ?? false,
          ...datosCreacion(sesion),
        },
      });

      if (direccion.favorita) {
        await apagarOtrasFavoritas(tx, sesion, direccion.id);
      }

      await registrarBitacora(tx, sesion, {
        entidad: 'DireccionEntrega',
        idEntidad: direccion.id,
        accion: 'CREAR',
        datos: { nombre: direccion.nombre, favorita: direccion.favorita },
      });

      return direccion;
    }, bd);
  } catch (error) {
    if (codigoErrorPrisma(error) === CODIGO_PRISMA.unicidad) {
      throw new ErrorConflicto(`Ya existe una dirección de entrega llamada "${datos.nombre}".`, {
        causa: error,
      });
    }
    throw error;
  }
}

/** Actualiza una dirección: datos y/o `activo` (borrado suave) y/o `favorita`. */
export async function actualizarDireccionEntrega(
  sesion: SesionUsuario,
  entrada: EntradaActualizarDireccionEntrega,
  bd?: ContextoBd,
): Promise<DireccionEntrega> {
  verificarPermiso(sesion, 'compras.administrar');
  const datos = validarEntrada(esquemaDireccionEntregaEditar, entrada);

  try {
    return await enTransaccion(async (tx) => {
      const actual = await exigirDireccion(tx, datos.id);

      const cambiaNombre = datos.nombre !== undefined && datos.nombre !== actual.nombre;
      if (cambiaNombre && datos.nombre !== undefined) {
        await exigirNombreLibre(tx, datos.nombre, datos.id);
      }

      // Una dirección desactivada NO puede seguir siendo la favorita: la UI la preseleccionaría
      // apagada. Se valida ANTES de escribir (el atajo `desactivarDireccionEntrega` manda
      // `favorita: false` en el mismo cambio, así que la baja normal nunca cae aquí).
      const quedaFavorita = datos.favorita ?? actual.favorita;
      const quedaActiva = datos.activo ?? actual.activo;
      if (quedaFavorita && !quedaActiva) {
        throw new ErrorConflicto(
          'No se puede desactivar la dirección favorita: primero marca otra como favorita.',
        );
      }

      const cambios: Prisma.DireccionEntregaUpdateInput = { ...datosModificacion(sesion) };
      if (cambiaNombre && datos.nombre !== undefined) {
        cambios.nombre = datos.nombre;
      }
      if (datos.direccion !== undefined) {
        cambios.direccion = datos.direccion;
      }
      if (datos.contacto !== undefined) {
        cambios.contacto = datos.contacto;
      }
      if (datos.telefono !== undefined) {
        cambios.telefono = datos.telefono;
      }
      if (datos.favorita !== undefined) {
        cambios.favorita = datos.favorita;
      }
      if (datos.activo !== undefined) {
        cambios.activo = datos.activo;
      }

      const direccion = await tx.direccionEntrega.update({
        where: { id: datos.id },
        data: cambios,
      });

      if (datos.favorita === true) {
        await apagarOtrasFavoritas(tx, sesion, direccion.id);
      }

      const desactiva = datos.activo === false && actual.activo;
      await registrarBitacora(tx, sesion, {
        entidad: 'DireccionEntrega',
        idEntidad: direccion.id,
        accion: desactiva ? 'DESACTIVAR' : 'MODIFICAR',
        datos: {
          nombre: direccion.nombre,
          ...(cambiaNombre ? { nombreAnterior: actual.nombre } : {}),
          ...(datos.favorita === undefined ? {} : { favorita: direccion.favorita }),
        },
      });

      return direccion;
    }, bd);
  } catch (error) {
    if (codigoErrorPrisma(error) === CODIGO_PRISMA.unicidad) {
      throw new ErrorConflicto('Ya existe una dirección de entrega con ese nombre.', {
        causa: error,
      });
    }
    throw error;
  }
}

/** Desactiva (borrado SUAVE) una dirección. Desactivar dos veces es `ErrorConflicto`. */
export async function desactivarDireccionEntrega(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<DireccionEntrega> {
  verificarPermiso(sesion, 'compras.administrar');
  return enTransaccion(async (tx) => {
    const actual = await exigirDireccion(tx, id);
    if (!actual.activo) {
      throw new ErrorConflicto(`La dirección "${actual.nombre}" ya está desactivada.`);
    }
    // Se apaga la bandera de favorita junto con la baja: una dirección desactivada no puede seguir
    // siendo la que se preselecciona (y así el `activo: false` no choca con la regla de arriba).
    return actualizarDireccionEntrega(sesion, { id, activo: false, favorita: false }, { tx });
  }, bd);
}

/** Reactiva una dirección desactivada (operación inversa del borrado suave). */
export async function reactivarDireccionEntrega(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<DireccionEntrega> {
  verificarPermiso(sesion, 'compras.administrar');
  return enTransaccion(async (tx) => {
    const actual = await exigirDireccion(tx, id);
    if (actual.activo) {
      throw new ErrorConflicto(`La dirección "${actual.nombre}" ya está activa.`);
    }
    return actualizarDireccionEntrega(sesion, { id, activo: true }, { tx });
  }, bd);
}

/** Obtiene una dirección por id o lanza `ErrorNoEncontrado`. */
export async function obtenerDireccionEntrega(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<DireccionEntrega> {
  verificarPermiso(sesion, 'compras.ver');
  const direccion = await clienteLectura(bd).direccionEntrega.findUnique({ where: { id } });
  if (direccion === null) {
    throw new ErrorNoEncontrado('Dirección de entrega', id);
  }
  return direccion;
}

/**
 * Lista direcciones con búsqueda, orden y paginación EN SERVIDOR. Por defecto solo activas, y la
 * FAVORITA sale primero (la UI la preselecciona sin tener que buscarla).
 */
export async function listarDireccionesEntrega(
  sesion: SesionUsuario,
  parametros: ParametrosListarDireccionesEntrega = {},
  bd?: ContextoBd,
): Promise<Pagina<DireccionEntrega>> {
  verificarPermiso(sesion, 'compras.ver');
  const filtros = validarEntrada(esquemaListarDireccionesEntrega, parametros);

  const where: Prisma.DireccionEntregaWhereInput = {
    ...(filtros.incluirInactivos ? {} : { activo: true }),
    ...(filtros.busqueda === undefined || filtros.busqueda === ''
      ? {}
      : {
          OR: [
            { nombre: { contains: filtros.busqueda, mode: 'insensitive' } },
            { direccion: { contains: filtros.busqueda, mode: 'insensitive' } },
          ],
        }),
  };

  const cliente = clienteLectura(bd);
  const [total, datos] = await Promise.all([
    cliente.direccionEntrega.count({ where }),
    cliente.direccionEntrega.findMany({
      where,
      orderBy: [{ favorita: 'desc' }, { [filtros.ordenarPor]: filtros.direccion }],
      ...rangoPrisma(filtros),
    }),
  ]);

  return armarPagina(datos, total, filtros);
}
