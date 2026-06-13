/**
 * Colores — catálogo maestro GLOBAL (F1-E1).
 *
 * Replica el CRUD patrón de Almacenes (`dominio/admin/almacenes.ts`) SIN lógica de
 * empresa: catálogo global, sin `idEmpresa` (ADR-0007, decisión A9). Unicidad de
 * `nombre` global (`@unique`).
 *
 * Doc funcional: `Documentacion_MJD/04-Inventarios.md` §B.2 (`TelasColores.Color` era
 * texto libre en el viejo): este catálogo lo normaliza a una entidad única.
 *
 * REGLA propia — normalización LIGERA en el dominio ({@link normalizarNombreColor}):
 * `trim` + colapsar espacios internos a uno solo, antes de validar unicidad y guardar.
 * Así "NEGRO  AZUL" y "NEGRO AZUL" son el mismo color. La normalización/fusión PESADA
 * de duplicados (alias: "NEGRO A"/"NEGRO B" → un solo color preservando referencias)
 * llega en F1-E6, NO aquí: aquí solo se garantiza unicidad por nombre normalizado.
 *
 * Piezas del patrón conservadas: permiso primero (`colores.ver`/`.administrar`,
 * PLANMAESTRO §9.2); Zod compartido; transacción única (A2) con auditoría (A7) +
 * `Bitacora`; borrado SUAVE reversible; unicidad respaldada por el unique de la base
 * (P2002 → `ErrorConflicto`); listado paginado/ordenado/buscado en servidor.
 */
import { esquemaColorCrear, esquemaColorEditar } from '../../contrato/index.js';
import type { Color, Prisma } from '../../datos/index.js';
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
export type EntradaCrearColor = z.input<typeof esquemaColorCrear>;

/** Edición: `id` + cambios parciales (incluye `activo` para des/reactivar). */
export type EntradaActualizarColor = z.input<typeof esquemaColorEditar>;

/** Parámetros del listado (los reutiliza la ruta REST en su entrada). */
export const esquemaListarColores = esquemaPaginacion.extend({
  /** Texto a buscar en el nombre (insensible a mayúsculas). */
  busqueda: z.string().trim().max(80).optional(),
  /** Por omisión solo activos; `true` muestra también los desactivados. */
  incluirInactivos: z.boolean().default(false),
  ordenarPor: z.enum(['nombre', 'creadoEn']).default('nombre'),
  direccion: z.enum(['asc', 'desc']).default('asc'),
});

export type ParametrosListarColores = z.input<typeof esquemaListarColores>;

/**
 * Normalización LIGERA del nombre de color (F1-E1): recorta extremos y colapsa
 * cualquier secuencia de espacios internos a uno solo. NO toca mayúsculas/acentos ni
 * fusiona variantes (eso es F1-E6). El Zod compartido ya recortó; esto añade el
 * colapso de espacios internos, que es regla de dominio.
 *
 * @example normalizarNombreColor("  NEGRO   AZUL ") === "NEGRO AZUL"
 */
export function normalizarNombreColor(nombre: string): string {
  return nombre.trim().replace(/\s+/g, ' ');
}

/**
 * Unicidad de negocio GLOBAL (ADR-0007): no puede haber dos colores con el mismo
 * nombre normalizado, sin importar mayúsculas. Se valida en la transacción; la carrera
 * residual la captura el unique de la base (P2002 → `ErrorConflicto`). Recibe el nombre
 * YA normalizado.
 */
async function exigirNombreLibre(tx: Tx, nombre: string, idActual?: number): Promise<void> {
  const existente = await tx.color.findFirst({
    where: {
      nombre: { equals: nombre, mode: 'insensitive' },
      ...(idActual === undefined ? {} : { id: { not: idActual } }),
    },
    select: { id: true, activo: true },
  });
  if (existente !== null) {
    throw new ErrorConflicto(
      existente.activo
        ? `Ya existe un color llamado "${nombre}".`
        : `Ya existe un color llamado "${nombre}" (está desactivado; puedes reactivarlo).`,
    );
  }
}

/** Busca un color por id o lanza `ErrorNoEncontrado`. */
async function exigirColor(tx: Tx, id: number): Promise<Color> {
  const color = await tx.color.findUnique({ where: { id } });
  if (color === null) {
    throw new ErrorNoEncontrado('Color', id);
  }
  return color;
}

/**
 * Crea un color (catálogo global). Reglas: permiso `colores.administrar`; nombre
 * normalizado y único global → `ErrorConflicto`; nace activo; auditoría y bitácora en
 * la misma transacción (A2/A7).
 */
export async function crearColor(
  sesion: SesionUsuario,
  entrada: EntradaCrearColor,
  bd?: ContextoBd,
): Promise<Color> {
  verificarPermiso(sesion, 'colores.administrar');
  const datos = validarEntrada(esquemaColorCrear, entrada);
  const nombre = normalizarNombreColor(datos.nombre);

  try {
    return await enTransaccion(async (tx) => {
      await exigirNombreLibre(tx, nombre);

      const color = await tx.color.create({ data: { nombre, ...datosCreacion(sesion) } });

      await registrarBitacora(tx, sesion, {
        entidad: 'Color',
        idEntidad: color.id,
        accion: 'CREAR',
        datos: { nombre: color.nombre },
      });

      return color;
    }, bd);
  } catch (error) {
    if (codigoErrorPrisma(error) === CODIGO_PRISMA.unicidad) {
      throw new ErrorConflicto(`Ya existe un color llamado "${nombre}".`, { causa: error });
    }
    throw error;
  }
}

/**
 * Actualiza un color: nombre (normalizado) y/o `activo` para desactivar (borrado suave)
 * o reactivar. Bitácora según lo que pasó: `MODIFICAR` con el detalle, y/o `DESACTIVAR`
 * si el cambio lo apagó.
 */
export async function actualizarColor(
  sesion: SesionUsuario,
  entrada: EntradaActualizarColor,
  bd?: ContextoBd,
): Promise<Color> {
  verificarPermiso(sesion, 'colores.administrar');
  const datos = validarEntrada(esquemaColorEditar, entrada);
  const nombreNuevo = datos.nombre === undefined ? undefined : normalizarNombreColor(datos.nombre);

  try {
    return await enTransaccion(async (tx) => {
      const actual = await exigirColor(tx, datos.id);

      const cambiaNombre = nombreNuevo !== undefined && nombreNuevo !== actual.nombre;
      const reactiva = datos.activo === true && !actual.activo;
      const desactiva = datos.activo === false && actual.activo;

      if (!cambiaNombre && !reactiva && !desactiva) {
        return actual; // nada que guardar: idempotente, sin bitácora vacía
      }

      if (cambiaNombre && nombreNuevo !== undefined) {
        await exigirNombreLibre(tx, nombreNuevo, datos.id);
      } else if (reactiva) {
        await exigirNombreLibre(tx, actual.nombre, datos.id);
      }

      const cambios: Prisma.ColorUpdateInput = { ...datosModificacion(sesion) };
      if (cambiaNombre && nombreNuevo !== undefined) {
        cambios.nombre = nombreNuevo;
      }
      if ((reactiva || desactiva) && datos.activo !== undefined) {
        cambios.activo = datos.activo;
      }

      const color = await tx.color.update({ where: { id: datos.id }, data: cambios });

      if (cambiaNombre || reactiva) {
        await registrarBitacora(tx, sesion, {
          entidad: 'Color',
          idEntidad: color.id,
          accion: 'MODIFICAR',
          datos: {
            ...(cambiaNombre ? { nombre: { de: actual.nombre, a: color.nombre } } : {}),
            ...(reactiva ? { operacion: 'reactivar' } : {}),
          },
        });
      }
      if (desactiva) {
        await registrarBitacora(tx, sesion, {
          entidad: 'Color',
          idEntidad: color.id,
          accion: 'DESACTIVAR',
          datos: { nombre: color.nombre },
        });
      }

      return color;
    }, bd);
  } catch (error) {
    if (codigoErrorPrisma(error) === CODIGO_PRISMA.unicidad) {
      throw new ErrorConflicto('Ya existe un color con ese nombre.', { causa: error });
    }
    throw error;
  }
}

/**
 * Desactiva (borrado SUAVE) un color. Desactivar dos veces es `ErrorConflicto`
 * (pantalla desactualizada). Atajo explícito del botón "Desactivar".
 */
export async function desactivarColor(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<Color> {
  verificarPermiso(sesion, 'colores.administrar');
  return enTransaccion(async (tx) => {
    const actual = await exigirColor(tx, id);
    if (!actual.activo) {
      throw new ErrorConflicto(`El color "${actual.nombre}" ya está desactivado.`);
    }
    return actualizarColor(sesion, { id, activo: false }, { tx });
  }, bd);
}

/** Reactiva un color desactivado (operación inversa del borrado suave). */
export async function reactivarColor(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<Color> {
  verificarPermiso(sesion, 'colores.administrar');
  return enTransaccion(async (tx) => {
    const actual = await exigirColor(tx, id);
    if (actual.activo) {
      throw new ErrorConflicto(`El color "${actual.nombre}" ya está activo.`);
    }
    return actualizarColor(sesion, { id, activo: true }, { tx });
  }, bd);
}

/** Obtiene un color por id o lanza `ErrorNoEncontrado`. */
export async function obtenerColor(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<Color> {
  verificarPermiso(sesion, 'colores.ver');
  const color = await clienteLectura(bd).color.findUnique({ where: { id } });
  if (color === null) {
    throw new ErrorNoEncontrado('Color', id);
  }
  return color;
}

/**
 * Lista colores con búsqueda, orden y paginación EN SERVIDOR. Por defecto: solo
 * activos.
 */
export async function listarColores(
  sesion: SesionUsuario,
  parametros: ParametrosListarColores = {},
  bd?: ContextoBd,
): Promise<Pagina<Color>> {
  verificarPermiso(sesion, 'colores.ver');
  const filtros = validarEntrada(esquemaListarColores, parametros);

  const where: Prisma.ColorWhereInput = {
    ...(filtros.incluirInactivos ? {} : { activo: true }),
    ...(filtros.busqueda === undefined || filtros.busqueda === ''
      ? {}
      : { nombre: { contains: filtros.busqueda, mode: 'insensitive' } }),
  };

  const cliente = clienteLectura(bd);
  const [total, datos] = await Promise.all([
    cliente.color.count({ where }),
    cliente.color.findMany({
      where,
      orderBy: { [filtros.ordenarPor]: filtros.direccion },
      ...rangoPrisma(filtros),
    }),
  ]);

  return armarPagina(datos, total, filtros);
}
