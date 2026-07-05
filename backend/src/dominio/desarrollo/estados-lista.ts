/**
 * Estados de lista de precios — catálogo GLOBAL de Desarrollo (F8-E1a; CRUD patrón Tipos de proceso).
 *
 * `EstadoLista` es la lista configurable de estados por los que pasa una lista de precios en la
 * negociación (abierta / en-negociación / cerrada / ya-pedida…). Es un catálogo GLOBAL (sin
 * idEmpresa — ADR-0007). Su consumidor real (la lista de precios) llega en F8-E4.
 *
 * La bandera `esCierre` marca un estado de CIERRE (bloquea nuevas rondas/ediciones de renglón, E5)
 * y SÍ es configurable por API (a diferencia del `fijo` de ConceptoCosto). No hay regla de "fijo":
 * cualquier estado se puede desactivar (borrado suave).
 *
 * Piezas del patrón (igual que Tipos de proceso):
 *  1. Permiso primero (`estado-lista.ver` para leer, `.administrar` para mutar; A4).
 *  2. Zod compartido de `src/contrato`. 3. Todo en UNA transacción (A2) con auditoría + Bitácora
 *     (A7). 4. Borrado SUAVE (`activo`). 5. Errores de dominio por código. 6. Listado paginado.
 */
import {
  esquemaEstadoListaCrear,
  esquemaEstadoListaEditar,
} from '../../contrato/esquemas/estado-lista.js';
import type { EstadoLista, Prisma } from '../../datos/index.js';
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
export type EntradaCrearEstadoLista = z.input<typeof esquemaEstadoListaCrear>;

/** Edición: `id` + cambios parciales (incluye `activo` para des/reactivar). */
export type EntradaActualizarEstadoLista = z.input<typeof esquemaEstadoListaEditar>;

/** Parámetros del listado (los reutiliza la ruta REST). */
export const esquemaListarEstadosLista = esquemaPaginacion.extend({
  busqueda: z.string().trim().max(100).optional(),
  incluirInactivos: z.boolean().default(false),
  ordenarPor: z.enum(['orden', 'codigo', 'nombre', 'creadoEn']).default('orden'),
  direccion: z.enum(['asc', 'desc']).default('asc'),
});

export type ParametrosListarEstadosLista = z.input<typeof esquemaListarEstadosLista>;

/** Unicidad del código (insensible a mayúsculas). La carrera residual la cubre el unique de BD. */
async function exigirCodigoLibre(tx: Tx, codigo: string, idActual?: number): Promise<void> {
  const existente = await tx.estadoLista.findFirst({
    where: {
      codigo: { equals: codigo, mode: 'insensitive' },
      ...(idActual === undefined ? {} : { id: { not: idActual } }),
    },
    select: { id: true, activo: true },
  });
  if (existente !== null) {
    throw new ErrorConflicto(
      existente.activo
        ? `Ya existe un estado de lista con el código "${codigo}".`
        : `Ya existe un estado de lista con el código "${codigo}" (está desactivado; puedes reactivarlo).`,
    );
  }
}

/** Busca un estado de lista por id o lanza `ErrorNoEncontrado`. */
async function exigirEstadoLista(tx: Tx, id: number): Promise<EstadoLista> {
  const estado = await tx.estadoLista.findUnique({ where: { id } });
  if (estado === null) {
    throw new ErrorNoEncontrado('EstadoLista', id);
  }
  return estado;
}

/** Crea un estado de lista. `orden`/`esCierre` opcionales (default de BD). Permiso `.administrar`. */
export async function crearEstadoLista(
  sesion: SesionUsuario,
  entrada: EntradaCrearEstadoLista,
  bd?: ContextoBd,
): Promise<EstadoLista> {
  verificarPermiso(sesion, 'estado-lista.administrar');
  const datos = validarEntrada(esquemaEstadoListaCrear, entrada);

  try {
    return await enTransaccion(async (tx) => {
      await exigirCodigoLibre(tx, datos.codigo);
      const estado = await tx.estadoLista.create({
        data: {
          codigo: datos.codigo,
          nombre: datos.nombre,
          ...(datos.orden === undefined ? {} : { orden: datos.orden }),
          ...(datos.esCierre === undefined ? {} : { esCierre: datos.esCierre }),
          ...datosCreacion(sesion),
        },
      });
      await registrarBitacora(tx, sesion, {
        entidad: 'EstadoLista',
        idEntidad: estado.id,
        accion: 'CREAR',
        datos: {
          codigo: estado.codigo,
          nombre: estado.nombre,
          orden: estado.orden,
          esCierre: estado.esCierre,
        },
      });
      return estado;
    }, bd);
  } catch (error) {
    if (codigoErrorPrisma(error) === CODIGO_PRISMA.unicidad) {
      throw new ErrorConflicto(`Ya existe un estado de lista con el código "${datos.codigo}".`, {
        causa: error,
      });
    }
    throw error;
  }
}

/**
 * Actualiza un estado de lista (código/nombre/orden/`esCierre`/`activo`). `esCierre` SÍ es
 * editable. Bitácora `MODIFICAR`/`DESACTIVAR` según lo que pasó (A7).
 */
export async function actualizarEstadoLista(
  sesion: SesionUsuario,
  entrada: EntradaActualizarEstadoLista,
  bd?: ContextoBd,
): Promise<EstadoLista> {
  verificarPermiso(sesion, 'estado-lista.administrar');
  const datos = validarEntrada(esquemaEstadoListaEditar, entrada);

  try {
    return await enTransaccion(async (tx) => {
      const actual = await exigirEstadoLista(tx, datos.id);

      const cambiaCodigo = datos.codigo !== undefined && datos.codigo !== actual.codigo;
      const cambiaNombre = datos.nombre !== undefined && datos.nombre !== actual.nombre;
      const cambiaOrden = datos.orden !== undefined && datos.orden !== actual.orden;
      const cambiaEsCierre = datos.esCierre !== undefined && datos.esCierre !== actual.esCierre;
      const reactiva = datos.activo === true && !actual.activo;
      const desactiva = datos.activo === false && actual.activo;

      if (
        !cambiaCodigo &&
        !cambiaNombre &&
        !cambiaOrden &&
        !cambiaEsCierre &&
        !reactiva &&
        !desactiva
      ) {
        return actual; // idempotente: nada que guardar, sin bitácora vacía
      }

      if (cambiaCodigo) {
        await exigirCodigoLibre(tx, datos.codigo ?? actual.codigo, datos.id);
      } else if (reactiva) {
        await exigirCodigoLibre(tx, actual.codigo, datos.id);
      }

      const cambios: Prisma.EstadoListaUpdateInput = { ...datosModificacion(sesion) };
      if (cambiaCodigo && datos.codigo !== undefined) {
        cambios.codigo = datos.codigo;
      }
      if (cambiaNombre && datos.nombre !== undefined) {
        cambios.nombre = datos.nombre;
      }
      if (cambiaOrden && datos.orden !== undefined) {
        cambios.orden = datos.orden;
      }
      if (cambiaEsCierre && datos.esCierre !== undefined) {
        cambios.esCierre = datos.esCierre;
      }
      if ((reactiva || desactiva) && datos.activo !== undefined) {
        cambios.activo = datos.activo;
      }

      const estado = await tx.estadoLista.update({ where: { id: datos.id }, data: cambios });

      if (cambiaCodigo || cambiaNombre || cambiaOrden || cambiaEsCierre || reactiva) {
        await registrarBitacora(tx, sesion, {
          entidad: 'EstadoLista',
          idEntidad: estado.id,
          accion: 'MODIFICAR',
          datos: {
            ...(cambiaCodigo ? { codigo: { de: actual.codigo, a: estado.codigo } } : {}),
            ...(cambiaNombre ? { nombre: { de: actual.nombre, a: estado.nombre } } : {}),
            ...(cambiaOrden ? { orden: { de: actual.orden, a: estado.orden } } : {}),
            ...(cambiaEsCierre ? { esCierre: { de: actual.esCierre, a: estado.esCierre } } : {}),
            ...(reactiva ? { operacion: 'reactivar' } : {}),
          },
        });
      }
      if (desactiva) {
        await registrarBitacora(tx, sesion, {
          entidad: 'EstadoLista',
          idEntidad: estado.id,
          accion: 'DESACTIVAR',
          datos: { codigo: estado.codigo },
        });
      }

      return estado;
    }, bd);
  } catch (error) {
    if (codigoErrorPrisma(error) === CODIGO_PRISMA.unicidad) {
      throw new ErrorConflicto('Ya existe un estado de lista con ese código.', { causa: error });
    }
    throw error;
  }
}

/** Desactiva (borrado SUAVE) un estado de lista. Desactivar dos veces es `ErrorConflicto`. */
export async function desactivarEstadoLista(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<EstadoLista> {
  verificarPermiso(sesion, 'estado-lista.administrar');
  return enTransaccion(async (tx) => {
    const actual = await exigirEstadoLista(tx, id);
    if (!actual.activo) {
      throw new ErrorConflicto(`El estado de lista "${actual.nombre}" ya está desactivado.`);
    }
    return actualizarEstadoLista(sesion, { id, activo: false }, { tx });
  }, bd);
}

/** Reactiva un estado de lista desactivado. */
export async function reactivarEstadoLista(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<EstadoLista> {
  verificarPermiso(sesion, 'estado-lista.administrar');
  return enTransaccion(async (tx) => {
    const actual = await exigirEstadoLista(tx, id);
    if (actual.activo) {
      throw new ErrorConflicto(`El estado de lista "${actual.nombre}" ya está activo.`);
    }
    return actualizarEstadoLista(sesion, { id, activo: true }, { tx });
  }, bd);
}

/** Obtiene un estado de lista por id o lanza `ErrorNoEncontrado`. */
export async function obtenerEstadoLista(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<EstadoLista> {
  verificarPermiso(sesion, 'estado-lista.ver');
  const estado = await clienteLectura(bd).estadoLista.findUnique({ where: { id } });
  if (estado === null) {
    throw new ErrorNoEncontrado('EstadoLista', id);
  }
  return estado;
}

/** Lista estados de lista con búsqueda, orden y paginación EN SERVIDOR. */
export async function listarEstadosLista(
  sesion: SesionUsuario,
  parametros: ParametrosListarEstadosLista = {},
  bd?: ContextoBd,
): Promise<Pagina<EstadoLista>> {
  verificarPermiso(sesion, 'estado-lista.ver');
  const filtros = validarEntrada(esquemaListarEstadosLista, parametros);

  const where: Prisma.EstadoListaWhereInput = {
    ...(filtros.incluirInactivos ? {} : { activo: true }),
    ...(filtros.busqueda === undefined || filtros.busqueda === ''
      ? {}
      : {
          OR: [
            { codigo: { contains: filtros.busqueda, mode: 'insensitive' } },
            { nombre: { contains: filtros.busqueda, mode: 'insensitive' } },
          ],
        }),
  };

  const cliente = clienteLectura(bd);
  const [total, datos] = await Promise.all([
    cliente.estadoLista.count({ where }),
    cliente.estadoLista.findMany({
      where,
      orderBy: { [filtros.ordenarPor]: filtros.direccion },
      ...rangoPrisma(filtros),
    }),
  ]);

  return armarPagina(datos, total, filtros);
}
