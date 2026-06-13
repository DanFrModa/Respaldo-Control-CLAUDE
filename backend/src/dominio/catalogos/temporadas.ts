/**
 * Temporadas — catálogo maestro GLOBAL (F1-E1).
 *
 * Replica el CRUD patrón de Almacenes (`dominio/admin/almacenes.ts`) SIN lógica de
 * empresa: catálogo global, sin `idEmpresa` (ADR-0007, decisión A9). Unicidad de
 * `nombre` global (`@unique`). Es el catálogo más simple: el nombre es el único dato.
 *
 * Doc funcional: `Documentacion_MJD/01-Modelos.md` §2 (tabla `Temporadas`: clasifica
 * los modelos por temporada comercial). El modelo de F1-E4 la referenciará
 * (`idTemporada`); aquí solo el catálogo.
 *
 * Piezas del patrón conservadas: permiso primero (`temporadas.ver`/`.administrar`,
 * PLANMAESTRO §9.2); Zod compartido; transacción única (A2) con auditoría (A7) +
 * `Bitacora`; borrado SUAVE reversible; unicidad respaldada por el unique de la base
 * (P2002 → `ErrorConflicto`); listado paginado/ordenado/buscado en servidor.
 */
import { esquemaTemporadaCrear, esquemaTemporadaEditar } from '../../contrato/index.js';
import type { Prisma, Temporada } from '../../datos/index.js';
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

/** Alta: campos del esquema compartido (catálogo global, sin `idEmpresa`). */
export type EntradaCrearTemporada = z.input<typeof esquemaTemporadaCrear>;

/** Edición: `id` + cambios parciales (incluye `activo` para des/reactivar). */
export type EntradaActualizarTemporada = z.input<typeof esquemaTemporadaEditar>;

/** Parámetros del listado (los reutiliza la ruta REST en su entrada). */
export const esquemaListarTemporadas = esquemaPaginacion.extend({
  /** Texto a buscar en el nombre (insensible a mayúsculas). */
  busqueda: z.string().trim().max(100).optional(),
  /** Por omisión solo activas; `true` muestra también las desactivadas. */
  incluirInactivos: z.boolean().default(false),
  ordenarPor: z.enum(['nombre', 'creadoEn']).default('nombre'),
  direccion: z.enum(['asc', 'desc']).default('asc'),
});

export type ParametrosListarTemporadas = z.input<typeof esquemaListarTemporadas>;

/**
 * Unicidad de negocio GLOBAL (ADR-0007): no puede haber dos temporadas con el mismo
 * nombre, sin importar mayúsculas. Se valida en la transacción; la carrera residual
 * la captura el unique de la base (P2002 → `ErrorConflicto`).
 */
async function exigirNombreLibre(tx: Tx, nombre: string, idActual?: number): Promise<void> {
  const existente = await tx.temporada.findFirst({
    where: {
      nombre: { equals: nombre, mode: 'insensitive' },
      ...(idActual === undefined ? {} : { id: { not: idActual } }),
    },
    select: { id: true, activo: true },
  });
  if (existente !== null) {
    throw new ErrorConflicto(
      existente.activo
        ? `Ya existe una temporada llamada "${nombre}".`
        : `Ya existe una temporada llamada "${nombre}" (está desactivada; puedes reactivarla).`,
    );
  }
}

/** Busca una temporada por id o lanza `ErrorNoEncontrado`. */
async function exigirTemporada(tx: Tx, id: number): Promise<Temporada> {
  const temporada = await tx.temporada.findUnique({ where: { id } });
  if (temporada === null) {
    throw new ErrorNoEncontrado('Temporada', id);
  }
  return temporada;
}

/**
 * Crea una temporada (catálogo global). Reglas: permiso `temporadas.administrar`;
 * nombre único global → `ErrorConflicto`; nace activa; auditoría y bitácora en la
 * misma transacción (A2/A7).
 */
export async function crearTemporada(
  sesion: SesionUsuario,
  entrada: EntradaCrearTemporada,
  bd?: ContextoBd,
): Promise<Temporada> {
  verificarPermiso(sesion, 'temporadas.administrar');
  const datos = validarEntrada(esquemaTemporadaCrear, entrada);

  try {
    return await enTransaccion(async (tx) => {
      await exigirNombreLibre(tx, datos.nombre);

      const temporada = await tx.temporada.create({
        data: { nombre: datos.nombre, ...datosCreacion(sesion) },
      });

      await registrarBitacora(tx, sesion, {
        entidad: 'Temporada',
        idEntidad: temporada.id,
        accion: 'CREAR',
        datos: { nombre: temporada.nombre },
      });

      return temporada;
    }, bd);
  } catch (error) {
    if (codigoErrorPrisma(error) === CODIGO_PRISMA.unicidad) {
      throw new ErrorConflicto(`Ya existe una temporada llamada "${datos.nombre}".`, {
        causa: error,
      });
    }
    throw error;
  }
}

/**
 * Actualiza una temporada: nombre y/o `activo` para desactivar (borrado suave) o
 * reactivar. Bitácora según lo que pasó: `MODIFICAR` con el detalle, y/o `DESACTIVAR`
 * si el cambio la apagó.
 */
export async function actualizarTemporada(
  sesion: SesionUsuario,
  entrada: EntradaActualizarTemporada,
  bd?: ContextoBd,
): Promise<Temporada> {
  verificarPermiso(sesion, 'temporadas.administrar');
  const datos = validarEntrada(esquemaTemporadaEditar, entrada);

  try {
    return await enTransaccion(async (tx) => {
      const actual = await exigirTemporada(tx, datos.id);

      const cambiaNombre = datos.nombre !== undefined && datos.nombre !== actual.nombre;
      const reactiva = datos.activo === true && !actual.activo;
      const desactiva = datos.activo === false && actual.activo;

      if (!cambiaNombre && !reactiva && !desactiva) {
        return actual; // nada que guardar: idempotente, sin bitácora vacía
      }

      if (cambiaNombre) {
        await exigirNombreLibre(tx, datos.nombre ?? actual.nombre, datos.id);
      } else if (reactiva) {
        await exigirNombreLibre(tx, actual.nombre, datos.id);
      }

      const cambios: Prisma.TemporadaUpdateInput = { ...datosModificacion(sesion) };
      if (cambiaNombre && datos.nombre !== undefined) {
        cambios.nombre = datos.nombre;
      }
      if ((reactiva || desactiva) && datos.activo !== undefined) {
        cambios.activo = datos.activo;
      }

      const temporada = await tx.temporada.update({ where: { id: datos.id }, data: cambios });

      if (cambiaNombre || reactiva) {
        await registrarBitacora(tx, sesion, {
          entidad: 'Temporada',
          idEntidad: temporada.id,
          accion: 'MODIFICAR',
          datos: {
            ...(cambiaNombre ? { nombre: { de: actual.nombre, a: temporada.nombre } } : {}),
            ...(reactiva ? { operacion: 'reactivar' } : {}),
          },
        });
      }
      if (desactiva) {
        await registrarBitacora(tx, sesion, {
          entidad: 'Temporada',
          idEntidad: temporada.id,
          accion: 'DESACTIVAR',
          datos: { nombre: temporada.nombre },
        });
      }

      return temporada;
    }, bd);
  } catch (error) {
    if (codigoErrorPrisma(error) === CODIGO_PRISMA.unicidad) {
      throw new ErrorConflicto('Ya existe una temporada con ese nombre.', { causa: error });
    }
    throw error;
  }
}

/**
 * Desactiva (borrado SUAVE) una temporada. Desactivar dos veces es `ErrorConflicto`
 * (pantalla desactualizada). Atajo explícito del botón "Desactivar".
 */
export async function desactivarTemporada(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<Temporada> {
  verificarPermiso(sesion, 'temporadas.administrar');
  return enTransaccion(async (tx) => {
    const actual = await exigirTemporada(tx, id);
    if (!actual.activo) {
      throw new ErrorConflicto(`La temporada "${actual.nombre}" ya está desactivada.`);
    }
    return actualizarTemporada(sesion, { id, activo: false }, { tx });
  }, bd);
}

/** Reactiva una temporada desactivada (operación inversa del borrado suave). */
export async function reactivarTemporada(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<Temporada> {
  verificarPermiso(sesion, 'temporadas.administrar');
  return enTransaccion(async (tx) => {
    const actual = await exigirTemporada(tx, id);
    if (actual.activo) {
      throw new ErrorConflicto(`La temporada "${actual.nombre}" ya está activa.`);
    }
    return actualizarTemporada(sesion, { id, activo: true }, { tx });
  }, bd);
}

/** Obtiene una temporada por id o lanza `ErrorNoEncontrado`. */
export async function obtenerTemporada(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<Temporada> {
  verificarPermiso(sesion, 'temporadas.ver');
  const temporada = await clienteLectura(bd).temporada.findUnique({ where: { id } });
  if (temporada === null) {
    throw new ErrorNoEncontrado('Temporada', id);
  }
  return temporada;
}

/**
 * Lista temporadas con búsqueda, orden y paginación EN SERVIDOR. Por defecto: solo
 * activas.
 */
export async function listarTemporadas(
  sesion: SesionUsuario,
  parametros: ParametrosListarTemporadas = {},
  bd?: ContextoBd,
): Promise<Pagina<Temporada>> {
  verificarPermiso(sesion, 'temporadas.ver');
  const filtros = validarEntrada(esquemaListarTemporadas, parametros);

  const where: Prisma.TemporadaWhereInput = {
    ...(filtros.incluirInactivos ? {} : { activo: true }),
    ...(filtros.busqueda === undefined || filtros.busqueda === ''
      ? {}
      : { nombre: { contains: filtros.busqueda, mode: 'insensitive' } }),
  };

  const cliente = clienteLectura(bd);
  const [total, datos] = await Promise.all([
    cliente.temporada.count({ where }),
    cliente.temporada.findMany({
      where,
      orderBy: { [filtros.ordenarPor]: filtros.direccion },
      ...rangoPrisma(filtros),
    }),
  ]);

  return armarPagina(datos, total, filtros);
}
