/**
 * Cortadores — catálogo maestro GLOBAL (F1-E1).
 *
 * Replica el CRUD patrón de Almacenes (`dominio/admin/almacenes.ts`) SIN lógica de
 * empresa: catálogo global, sin `idEmpresa` (ADR-0007, decisión A9). Unicidad de
 * `nombre` global (`@unique`).
 *
 * Doc funcional: `Documentacion_MJD/03-Produccion.md` §Paso 3 Corte (tabla
 * `Cortadores`: quien corta la tela antes de la maquila). `precioReferencia` es un
 * decimal informativo (el costo real va en la orden): la entrada lo acepta como
 * `number` (Prisma lo guarda como Decimal); la salida lo serializa a `number` en la
 * ruta REST.
 *
 * Piezas del patrón conservadas: permiso primero (`cortadores.ver`/`.administrar`,
 * PLANMAESTRO §9.2); Zod compartido; transacción única (A2) con auditoría (A7) +
 * `Bitacora`; borrado SUAVE reversible; unicidad respaldada por el unique de la base
 * (P2002 → `ErrorConflicto`); listado paginado/ordenado/buscado en servidor.
 */
import { esquemaCortadorCrear, esquemaCortadorEditar } from '../../contrato/index.js';
import type { Cortador, Prisma } from '../../datos/index.js';
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
export type EntradaCrearCortador = z.input<typeof esquemaCortadorCrear>;

/** Edición: `id` + cambios parciales (incluye `activo` para des/reactivar). */
export type EntradaActualizarCortador = z.input<typeof esquemaCortadorEditar>;

/** Parámetros del listado (los reutiliza la ruta REST en su entrada). */
export const esquemaListarCortadores = esquemaPaginacion.extend({
  /** Texto a buscar en el nombre (insensible a mayúsculas). */
  busqueda: z.string().trim().max(150).optional(),
  /** Por omisión solo activos; `true` muestra también los desactivados. */
  incluirInactivos: z.boolean().default(false),
  ordenarPor: z.enum(['nombre', 'creadoEn']).default('nombre'),
  direccion: z.enum(['asc', 'desc']).default('asc'),
});

export type ParametrosListarCortadores = z.input<typeof esquemaListarCortadores>;

/**
 * Compara el `precioReferencia` capturado (number | undefined) con el guardado
 * (Decimal | null). Devuelve `true` si el valor cambia. `undefined` en la entrada
 * significa "no se tocó" (no cambia).
 */
function cambiaPrecio(entrada: number | undefined, actual: Prisma.Decimal | null): boolean {
  if (entrada === undefined) {
    return false;
  }
  if (actual === null) {
    return true;
  }
  return actual.toNumber() !== entrada;
}

/**
 * Unicidad de negocio GLOBAL (ADR-0007): no puede haber dos cortadores con el mismo
 * nombre, sin importar mayúsculas. Se valida en la transacción; la carrera residual
 * la captura el unique de la base (P2002 → `ErrorConflicto`).
 */
async function exigirNombreLibre(tx: Tx, nombre: string, idActual?: number): Promise<void> {
  const existente = await tx.cortador.findFirst({
    where: {
      nombre: { equals: nombre, mode: 'insensitive' },
      ...(idActual === undefined ? {} : { id: { not: idActual } }),
    },
    select: { id: true, activo: true },
  });
  if (existente !== null) {
    throw new ErrorConflicto(
      existente.activo
        ? `Ya existe un cortador llamado "${nombre}".`
        : `Ya existe un cortador llamado "${nombre}" (está desactivado; puedes reactivarlo).`,
    );
  }
}

/** Busca un cortador por id o lanza `ErrorNoEncontrado`. */
async function exigirCortador(tx: Tx, id: number): Promise<Cortador> {
  const cortador = await tx.cortador.findUnique({ where: { id } });
  if (cortador === null) {
    throw new ErrorNoEncontrado('Cortador', id);
  }
  return cortador;
}

/**
 * Crea un cortador (catálogo global). Reglas: permiso `cortadores.administrar`;
 * nombre único global → `ErrorConflicto`; nace activo; auditoría y bitácora en la
 * misma transacción (A2/A7).
 */
export async function crearCortador(
  sesion: SesionUsuario,
  entrada: EntradaCrearCortador,
  bd?: ContextoBd,
): Promise<Cortador> {
  verificarPermiso(sesion, 'cortadores.administrar');
  const datos = validarEntrada(esquemaCortadorCrear, entrada);

  try {
    return await enTransaccion(async (tx) => {
      await exigirNombreLibre(tx, datos.nombre);

      const cortador = await tx.cortador.create({
        data: {
          nombre: datos.nombre,
          ...(datos.precioReferencia === undefined
            ? {}
            : { precioReferencia: datos.precioReferencia }),
          ...(datos.telefonos === undefined ? {} : { telefonos: datos.telefonos }),
          ...datosCreacion(sesion),
        },
      });

      await registrarBitacora(tx, sesion, {
        entidad: 'Cortador',
        idEntidad: cortador.id,
        accion: 'CREAR',
        datos: { nombre: cortador.nombre },
      });

      return cortador;
    }, bd);
  } catch (error) {
    if (codigoErrorPrisma(error) === CODIGO_PRISMA.unicidad) {
      throw new ErrorConflicto(`Ya existe un cortador llamado "${datos.nombre}".`, {
        causa: error,
      });
    }
    throw error;
  }
}

/**
 * Actualiza un cortador: datos generales y/o `activo` para desactivar (borrado suave)
 * o reactivar. Bitácora según lo que pasó: `MODIFICAR` con el detalle, y/o
 * `DESACTIVAR` si el cambio lo apagó.
 */
export async function actualizarCortador(
  sesion: SesionUsuario,
  entrada: EntradaActualizarCortador,
  bd?: ContextoBd,
): Promise<Cortador> {
  verificarPermiso(sesion, 'cortadores.administrar');
  const datos = validarEntrada(esquemaCortadorEditar, entrada);

  try {
    return await enTransaccion(async (tx) => {
      const actual = await exigirCortador(tx, datos.id);

      const cambiaNombre = datos.nombre !== undefined && datos.nombre !== actual.nombre;
      const cambiaPrecioRef = cambiaPrecio(datos.precioReferencia, actual.precioReferencia);
      const cambiaTelefonos = datos.telefonos !== undefined && datos.telefonos !== actual.telefonos;
      const reactiva = datos.activo === true && !actual.activo;
      const desactiva = datos.activo === false && actual.activo;

      if (!cambiaNombre && !cambiaPrecioRef && !cambiaTelefonos && !reactiva && !desactiva) {
        return actual; // nada que guardar: idempotente, sin bitácora vacía
      }

      if (cambiaNombre) {
        await exigirNombreLibre(tx, datos.nombre ?? actual.nombre, datos.id);
      } else if (reactiva) {
        await exigirNombreLibre(tx, actual.nombre, datos.id);
      }

      const cambios: Prisma.CortadorUpdateInput = { ...datosModificacion(sesion) };
      if (cambiaNombre && datos.nombre !== undefined) {
        cambios.nombre = datos.nombre;
      }
      if (cambiaPrecioRef && datos.precioReferencia !== undefined) {
        cambios.precioReferencia = datos.precioReferencia;
      }
      if (cambiaTelefonos && datos.telefonos !== undefined) {
        cambios.telefonos = datos.telefonos;
      }
      if ((reactiva || desactiva) && datos.activo !== undefined) {
        cambios.activo = datos.activo;
      }

      const cortador = await tx.cortador.update({ where: { id: datos.id }, data: cambios });

      if (cambiaNombre || cambiaPrecioRef || cambiaTelefonos || reactiva) {
        await registrarBitacora(tx, sesion, {
          entidad: 'Cortador',
          idEntidad: cortador.id,
          accion: 'MODIFICAR',
          datos: {
            ...(cambiaNombre ? { nombre: { de: actual.nombre, a: cortador.nombre } } : {}),
            ...(cambiaPrecioRef
              ? {
                  precioReferencia: {
                    de: actual.precioReferencia?.toNumber() ?? null,
                    a: cortador.precioReferencia?.toNumber() ?? null,
                  },
                }
              : {}),
            ...(cambiaTelefonos
              ? { telefonos: { de: actual.telefonos, a: cortador.telefonos } }
              : {}),
            ...(reactiva ? { operacion: 'reactivar' } : {}),
          },
        });
      }
      if (desactiva) {
        await registrarBitacora(tx, sesion, {
          entidad: 'Cortador',
          idEntidad: cortador.id,
          accion: 'DESACTIVAR',
          datos: { nombre: cortador.nombre },
        });
      }

      return cortador;
    }, bd);
  } catch (error) {
    if (codigoErrorPrisma(error) === CODIGO_PRISMA.unicidad) {
      throw new ErrorConflicto('Ya existe un cortador con ese nombre.', { causa: error });
    }
    throw error;
  }
}

/**
 * Desactiva (borrado SUAVE) un cortador. Desactivar dos veces es `ErrorConflicto`
 * (pantalla desactualizada). Atajo explícito del botón "Desactivar".
 */
export async function desactivarCortador(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<Cortador> {
  verificarPermiso(sesion, 'cortadores.administrar');
  return enTransaccion(async (tx) => {
    const actual = await exigirCortador(tx, id);
    if (!actual.activo) {
      throw new ErrorConflicto(`El cortador "${actual.nombre}" ya está desactivado.`);
    }
    return actualizarCortador(sesion, { id, activo: false }, { tx });
  }, bd);
}

/** Reactiva un cortador desactivado (operación inversa del borrado suave). */
export async function reactivarCortador(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<Cortador> {
  verificarPermiso(sesion, 'cortadores.administrar');
  return enTransaccion(async (tx) => {
    const actual = await exigirCortador(tx, id);
    if (actual.activo) {
      throw new ErrorConflicto(`El cortador "${actual.nombre}" ya está activo.`);
    }
    return actualizarCortador(sesion, { id, activo: true }, { tx });
  }, bd);
}

/** Obtiene un cortador por id o lanza `ErrorNoEncontrado`. */
export async function obtenerCortador(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<Cortador> {
  verificarPermiso(sesion, 'cortadores.ver');
  const cortador = await clienteLectura(bd).cortador.findUnique({ where: { id } });
  if (cortador === null) {
    throw new ErrorNoEncontrado('Cortador', id);
  }
  return cortador;
}

/**
 * Lista cortadores con búsqueda, orden y paginación EN SERVIDOR. Por defecto: solo
 * activos.
 */
export async function listarCortadores(
  sesion: SesionUsuario,
  parametros: ParametrosListarCortadores = {},
  bd?: ContextoBd,
): Promise<Pagina<Cortador>> {
  verificarPermiso(sesion, 'cortadores.ver');
  const filtros = validarEntrada(esquemaListarCortadores, parametros);

  const where: Prisma.CortadorWhereInput = {
    ...(filtros.incluirInactivos ? {} : { activo: true }),
    ...(filtros.busqueda === undefined || filtros.busqueda === ''
      ? {}
      : { nombre: { contains: filtros.busqueda, mode: 'insensitive' } }),
  };

  const cliente = clienteLectura(bd);
  const [total, datos] = await Promise.all([
    cliente.cortador.count({ where }),
    cliente.cortador.findMany({
      where,
      orderBy: { [filtros.ordenarPor]: filtros.direccion },
      ...rangoPrisma(filtros),
    }),
  ]);

  return armarPagina(datos, total, filtros);
}
