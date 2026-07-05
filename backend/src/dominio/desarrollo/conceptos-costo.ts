/**
 * Conceptos de costo — catálogo GLOBAL de Desarrollo (F8-E1a; CRUD patrón Tipos de proceso).
 *
 * `ConceptoCosto` es la lista abierta de rubros con los que se arma el precosto de un modelo
 * (tela, avíos, maquila, y conceptos "abiertos" que agregue el usuario). Es un catálogo GLOBAL
 * (sin idEmpresa — ADR-0007). Su consumidor real (el precosto) llega en F8-E3.
 *
 * Particularidad de negocio (A1): un concepto FIJO (`fijo=true`: tela/avíos/maquila) NO se puede
 * DESACTIVAR — el sistema depende de esos rubros base. La bandera `fijo` NO es editable por la API
 * (solo la pone el seed): el servicio la ignora en alta/edición.
 *
 * Piezas del patrón (igual que Tipos de proceso):
 *  1. Permiso primero (`concepto-costo.ver` para leer, `.administrar` para mutar; A4).
 *  2. Zod compartido de `src/contrato`. 3. Todo en UNA transacción (A2) con auditoría + Bitácora
 *     (A7). 4. Borrado SUAVE (`activo`), salvo la regla de "fijo". 5. Errores de dominio por
 *     código. 6. Listado paginado/ordenado/buscado en servidor.
 */
import {
  esquemaConceptoCostoCrear,
  esquemaConceptoCostoEditar,
} from '../../contrato/esquemas/concepto-costo.js';
import type { ConceptoCosto, Prisma } from '../../datos/index.js';
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
export type EntradaCrearConceptoCosto = z.input<typeof esquemaConceptoCostoCrear>;

/** Edición: `id` + cambios parciales (incluye `activo` para des/reactivar). */
export type EntradaActualizarConceptoCosto = z.input<typeof esquemaConceptoCostoEditar>;

/** Parámetros del listado (los reutiliza la ruta REST). */
export const esquemaListarConceptosCosto = esquemaPaginacion.extend({
  busqueda: z.string().trim().max(100).optional(),
  incluirInactivos: z.boolean().default(false),
  ordenarPor: z.enum(['orden', 'codigo', 'nombre', 'creadoEn']).default('orden'),
  direccion: z.enum(['asc', 'desc']).default('asc'),
});

export type ParametrosListarConceptosCosto = z.input<typeof esquemaListarConceptosCosto>;

/** Unicidad del código (insensible a mayúsculas). La carrera residual la cubre el unique de BD. */
async function exigirCodigoLibre(tx: Tx, codigo: string, idActual?: number): Promise<void> {
  const existente = await tx.conceptoCosto.findFirst({
    where: {
      codigo: { equals: codigo, mode: 'insensitive' },
      ...(idActual === undefined ? {} : { id: { not: idActual } }),
    },
    select: { id: true, activo: true },
  });
  if (existente !== null) {
    throw new ErrorConflicto(
      existente.activo
        ? `Ya existe un concepto de costo con el código "${codigo}".`
        : `Ya existe un concepto de costo con el código "${codigo}" (está desactivado; puedes reactivarlo).`,
    );
  }
}

/** Busca un concepto de costo por id o lanza `ErrorNoEncontrado`. */
async function exigirConceptoCosto(tx: Tx, id: number): Promise<ConceptoCosto> {
  const concepto = await tx.conceptoCosto.findUnique({ where: { id } });
  if (concepto === null) {
    throw new ErrorNoEncontrado('ConceptoCosto', id);
  }
  return concepto;
}

/**
 * Crea un concepto de costo. `fijo` NO se acepta por API (solo el seed): un alta siempre nace con
 * `fijo=false` (default de BD). Permiso `concepto-costo.administrar`.
 */
export async function crearConceptoCosto(
  sesion: SesionUsuario,
  entrada: EntradaCrearConceptoCosto,
  bd?: ContextoBd,
): Promise<ConceptoCosto> {
  verificarPermiso(sesion, 'concepto-costo.administrar');
  const datos = validarEntrada(esquemaConceptoCostoCrear, entrada);

  try {
    return await enTransaccion(async (tx) => {
      await exigirCodigoLibre(tx, datos.codigo);
      const concepto = await tx.conceptoCosto.create({
        data: {
          codigo: datos.codigo,
          nombre: datos.nombre,
          ...(datos.orden === undefined ? {} : { orden: datos.orden }),
          ...datosCreacion(sesion),
        },
      });
      await registrarBitacora(tx, sesion, {
        entidad: 'ConceptoCosto',
        idEntidad: concepto.id,
        accion: 'CREAR',
        datos: { codigo: concepto.codigo, nombre: concepto.nombre, orden: concepto.orden },
      });
      return concepto;
    }, bd);
  } catch (error) {
    if (codigoErrorPrisma(error) === CODIGO_PRISMA.unicidad) {
      throw new ErrorConflicto(`Ya existe un concepto de costo con el código "${datos.codigo}".`, {
        causa: error,
      });
    }
    throw error;
  }
}

/**
 * Actualiza un concepto de costo (código/nombre/orden/`activo`). `fijo` NO se toca por API.
 * REGLA (A1): un concepto FIJO no se puede DESACTIVAR → `ErrorConflicto` claro. Bitácora
 * `MODIFICAR`/`DESACTIVAR` según lo que pasó (A7).
 */
export async function actualizarConceptoCosto(
  sesion: SesionUsuario,
  entrada: EntradaActualizarConceptoCosto,
  bd?: ContextoBd,
): Promise<ConceptoCosto> {
  verificarPermiso(sesion, 'concepto-costo.administrar');
  const datos = validarEntrada(esquemaConceptoCostoEditar, entrada);

  try {
    return await enTransaccion(async (tx) => {
      const actual = await exigirConceptoCosto(tx, datos.id);

      const cambiaCodigo = datos.codigo !== undefined && datos.codigo !== actual.codigo;
      const cambiaNombre = datos.nombre !== undefined && datos.nombre !== actual.nombre;
      const cambiaOrden = datos.orden !== undefined && datos.orden !== actual.orden;
      const reactiva = datos.activo === true && !actual.activo;
      const desactiva = datos.activo === false && actual.activo;

      // REGLA: un concepto fijo (tela/avíos/maquila) no se puede desactivar.
      if (desactiva && actual.fijo) {
        throw new ErrorConflicto(
          `El concepto de costo "${actual.nombre}" es fijo y no se puede desactivar.`,
        );
      }

      if (!cambiaCodigo && !cambiaNombre && !cambiaOrden && !reactiva && !desactiva) {
        return actual; // idempotente: nada que guardar, sin bitácora vacía
      }

      if (cambiaCodigo) {
        await exigirCodigoLibre(tx, datos.codigo ?? actual.codigo, datos.id);
      } else if (reactiva) {
        await exigirCodigoLibre(tx, actual.codigo, datos.id);
      }

      const cambios: Prisma.ConceptoCostoUpdateInput = { ...datosModificacion(sesion) };
      if (cambiaCodigo && datos.codigo !== undefined) {
        cambios.codigo = datos.codigo;
      }
      if (cambiaNombre && datos.nombre !== undefined) {
        cambios.nombre = datos.nombre;
      }
      if (cambiaOrden && datos.orden !== undefined) {
        cambios.orden = datos.orden;
      }
      if ((reactiva || desactiva) && datos.activo !== undefined) {
        cambios.activo = datos.activo;
      }

      const concepto = await tx.conceptoCosto.update({ where: { id: datos.id }, data: cambios });

      if (cambiaCodigo || cambiaNombre || cambiaOrden || reactiva) {
        await registrarBitacora(tx, sesion, {
          entidad: 'ConceptoCosto',
          idEntidad: concepto.id,
          accion: 'MODIFICAR',
          datos: {
            ...(cambiaCodigo ? { codigo: { de: actual.codigo, a: concepto.codigo } } : {}),
            ...(cambiaNombre ? { nombre: { de: actual.nombre, a: concepto.nombre } } : {}),
            ...(cambiaOrden ? { orden: { de: actual.orden, a: concepto.orden } } : {}),
            ...(reactiva ? { operacion: 'reactivar' } : {}),
          },
        });
      }
      if (desactiva) {
        await registrarBitacora(tx, sesion, {
          entidad: 'ConceptoCosto',
          idEntidad: concepto.id,
          accion: 'DESACTIVAR',
          datos: { codigo: concepto.codigo },
        });
      }

      return concepto;
    }, bd);
  } catch (error) {
    if (codigoErrorPrisma(error) === CODIGO_PRISMA.unicidad) {
      throw new ErrorConflicto('Ya existe un concepto de costo con ese código.', { causa: error });
    }
    throw error;
  }
}

/**
 * Desactiva (borrado SUAVE) un concepto de costo. Desactivar dos veces es `ErrorConflicto`; un
 * concepto FIJO no se puede desactivar (lo rechaza `actualizarConceptoCosto`).
 */
export async function desactivarConceptoCosto(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<ConceptoCosto> {
  verificarPermiso(sesion, 'concepto-costo.administrar');
  return enTransaccion(async (tx) => {
    const actual = await exigirConceptoCosto(tx, id);
    if (!actual.activo) {
      throw new ErrorConflicto(`El concepto de costo "${actual.nombre}" ya está desactivado.`);
    }
    return actualizarConceptoCosto(sesion, { id, activo: false }, { tx });
  }, bd);
}

/** Reactiva un concepto de costo desactivado. */
export async function reactivarConceptoCosto(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<ConceptoCosto> {
  verificarPermiso(sesion, 'concepto-costo.administrar');
  return enTransaccion(async (tx) => {
    const actual = await exigirConceptoCosto(tx, id);
    if (actual.activo) {
      throw new ErrorConflicto(`El concepto de costo "${actual.nombre}" ya está activo.`);
    }
    return actualizarConceptoCosto(sesion, { id, activo: true }, { tx });
  }, bd);
}

/** Obtiene un concepto de costo por id o lanza `ErrorNoEncontrado`. */
export async function obtenerConceptoCosto(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<ConceptoCosto> {
  verificarPermiso(sesion, 'concepto-costo.ver');
  const concepto = await clienteLectura(bd).conceptoCosto.findUnique({ where: { id } });
  if (concepto === null) {
    throw new ErrorNoEncontrado('ConceptoCosto', id);
  }
  return concepto;
}

/** Lista conceptos de costo con búsqueda, orden y paginación EN SERVIDOR. */
export async function listarConceptosCosto(
  sesion: SesionUsuario,
  parametros: ParametrosListarConceptosCosto = {},
  bd?: ContextoBd,
): Promise<Pagina<ConceptoCosto>> {
  verificarPermiso(sesion, 'concepto-costo.ver');
  const filtros = validarEntrada(esquemaListarConceptosCosto, parametros);

  const where: Prisma.ConceptoCostoWhereInput = {
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
    cliente.conceptoCosto.count({ where }),
    cliente.conceptoCosto.findMany({
      where,
      orderBy: { [filtros.ordenarPor]: filtros.direccion },
      ...rangoPrisma(filtros),
    }),
  ]);

  return armarPagina(datos, total, filtros);
}
