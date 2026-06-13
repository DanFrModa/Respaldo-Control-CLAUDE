/**
 * Etiquetas de marca — catálogo maestro GLOBAL (F1-E1).
 *
 * Replica el CRUD patrón de Almacenes (`dominio/admin/almacenes.ts`) SIN lógica de
 * empresa: catálogo global, sin `idEmpresa` (ADR-0007, decisión A9). Unicidad de
 * `nombre` global (`@unique`).
 *
 * Doc funcional: `Documentacion_MJD/01-Modelos.md` §2 (tabla `EtiquetasM`) y §6
 * punto 4 (las `regalias` son un % que alimenta el costeo). REGLA propia: `regalias`
 * es un porcentaje VALIDADO 0–100 — en Zod (esquema compartido) Y en el dominio
 * ({@link verificarRegalias}, defensa en profundidad A1). La entrada acepta `number`
 * (Prisma lo guarda como Decimal); la salida lo serializa a `number` en la ruta REST.
 *
 * Piezas del patrón conservadas: permiso primero (`etiquetas-marca.ver`/`.administrar`,
 * PLANMAESTRO §9.2); Zod compartido; transacción única (A2) con auditoría (A7) +
 * `Bitacora`; borrado SUAVE reversible; unicidad respaldada por el unique de la base
 * (P2002 → `ErrorConflicto`); listado paginado/ordenado/buscado en servidor.
 */
import { esquemaEtiquetaMarcaCrear, esquemaEtiquetaMarcaEditar } from '../../contrato/index.js';
import type { EtiquetaMarca, Prisma } from '../../datos/index.js';
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

/** Alta: campos del esquema compartido (catálogo global, sin `idEmpresa`). */
export type EntradaCrearEtiquetaMarca = z.input<typeof esquemaEtiquetaMarcaCrear>;

/** Edición: `id` + cambios parciales (incluye `activo` para des/reactivar). */
export type EntradaActualizarEtiquetaMarca = z.input<typeof esquemaEtiquetaMarcaEditar>;

/** Parámetros del listado (los reutiliza la ruta REST en su entrada). */
export const esquemaListarEtiquetasMarca = esquemaPaginacion.extend({
  /** Texto a buscar en el nombre (insensible a mayúsculas). */
  busqueda: z.string().trim().max(100).optional(),
  /** Por omisión solo activas; `true` muestra también las desactivadas. */
  incluirInactivos: z.boolean().default(false),
  ordenarPor: z.enum(['nombre', 'regalias', 'creadoEn']).default('nombre'),
  direccion: z.enum(['asc', 'desc']).default('asc'),
});

export type ParametrosListarEtiquetasMarca = z.input<typeof esquemaListarEtiquetasMarca>;

/**
 * Regla de negocio (01-Modelos §6 punto 4): las regalías son un porcentaje 0–100.
 * Defensa en profundidad (A1): aunque el Zod compartido ya lo valida, el dominio lo
 * re-exige para que la regla no dependa de la forma del esquema. `undefined` (no se
 * tocó en una edición) no se valida.
 */
function verificarRegalias(regalias: number | undefined): void {
  if (regalias === undefined) {
    return;
  }
  if (!Number.isFinite(regalias) || regalias < 0 || regalias > 100) {
    throw new ErrorValidacion('Las regalías deben ser un porcentaje entre 0 y 100.');
  }
}

/**
 * Compara las `regalias` capturadas (number | undefined) con las guardadas (Decimal).
 * Devuelve `true` si el valor cambia. `undefined` significa "no se tocó".
 */
function cambiaRegalias(entrada: number | undefined, actual: Prisma.Decimal): boolean {
  if (entrada === undefined) {
    return false;
  }
  return actual.toNumber() !== entrada;
}

/**
 * Unicidad de negocio GLOBAL (ADR-0007): no puede haber dos etiquetas con el mismo
 * nombre, sin importar mayúsculas. Se valida en la transacción; la carrera residual
 * la captura el unique de la base (P2002 → `ErrorConflicto`).
 */
async function exigirNombreLibre(tx: Tx, nombre: string, idActual?: number): Promise<void> {
  const existente = await tx.etiquetaMarca.findFirst({
    where: {
      nombre: { equals: nombre, mode: 'insensitive' },
      ...(idActual === undefined ? {} : { id: { not: idActual } }),
    },
    select: { id: true, activo: true },
  });
  if (existente !== null) {
    throw new ErrorConflicto(
      existente.activo
        ? `Ya existe una etiqueta de marca llamada "${nombre}".`
        : `Ya existe una etiqueta de marca llamada "${nombre}" (está desactivada; puedes reactivarla).`,
    );
  }
}

/** Busca una etiqueta de marca por id o lanza `ErrorNoEncontrado`. */
async function exigirEtiquetaMarca(tx: Tx, id: number): Promise<EtiquetaMarca> {
  const etiqueta = await tx.etiquetaMarca.findUnique({ where: { id } });
  if (etiqueta === null) {
    throw new ErrorNoEncontrado('EtiquetaMarca', id);
  }
  return etiqueta;
}

/**
 * Crea una etiqueta de marca (catálogo global). Reglas: permiso
 * `etiquetas-marca.administrar`; nombre único global → `ErrorConflicto`; `regalias`
 * 0–100 (A1); nace activa; auditoría y bitácora en la misma transacción (A2/A7).
 */
export async function crearEtiquetaMarca(
  sesion: SesionUsuario,
  entrada: EntradaCrearEtiquetaMarca,
  bd?: ContextoBd,
): Promise<EtiquetaMarca> {
  verificarPermiso(sesion, 'etiquetas-marca.administrar');
  const datos = validarEntrada(esquemaEtiquetaMarcaCrear, entrada);
  verificarRegalias(datos.regalias);

  try {
    return await enTransaccion(async (tx) => {
      await exigirNombreLibre(tx, datos.nombre);

      const etiqueta = await tx.etiquetaMarca.create({
        data: { nombre: datos.nombre, regalias: datos.regalias, ...datosCreacion(sesion) },
      });

      await registrarBitacora(tx, sesion, {
        entidad: 'EtiquetaMarca',
        idEntidad: etiqueta.id,
        accion: 'CREAR',
        datos: { nombre: etiqueta.nombre, regalias: etiqueta.regalias.toNumber() },
      });

      return etiqueta;
    }, bd);
  } catch (error) {
    if (codigoErrorPrisma(error) === CODIGO_PRISMA.unicidad) {
      throw new ErrorConflicto(`Ya existe una etiqueta de marca llamada "${datos.nombre}".`, {
        causa: error,
      });
    }
    throw error;
  }
}

/**
 * Actualiza una etiqueta de marca: nombre, regalías (0–100) y/o `activo` para
 * desactivar (borrado suave) o reactivar. Bitácora según lo que pasó: `MODIFICAR` con
 * el detalle, y/o `DESACTIVAR` si el cambio la apagó.
 */
export async function actualizarEtiquetaMarca(
  sesion: SesionUsuario,
  entrada: EntradaActualizarEtiquetaMarca,
  bd?: ContextoBd,
): Promise<EtiquetaMarca> {
  verificarPermiso(sesion, 'etiquetas-marca.administrar');
  const datos = validarEntrada(esquemaEtiquetaMarcaEditar, entrada);
  verificarRegalias(datos.regalias);

  try {
    return await enTransaccion(async (tx) => {
      const actual = await exigirEtiquetaMarca(tx, datos.id);

      const cambiaNombre = datos.nombre !== undefined && datos.nombre !== actual.nombre;
      const cambiaReg = cambiaRegalias(datos.regalias, actual.regalias);
      const reactiva = datos.activo === true && !actual.activo;
      const desactiva = datos.activo === false && actual.activo;

      if (!cambiaNombre && !cambiaReg && !reactiva && !desactiva) {
        return actual; // nada que guardar: idempotente, sin bitácora vacía
      }

      if (cambiaNombre) {
        await exigirNombreLibre(tx, datos.nombre ?? actual.nombre, datos.id);
      } else if (reactiva) {
        await exigirNombreLibre(tx, actual.nombre, datos.id);
      }

      const cambios: Prisma.EtiquetaMarcaUpdateInput = { ...datosModificacion(sesion) };
      if (cambiaNombre && datos.nombre !== undefined) {
        cambios.nombre = datos.nombre;
      }
      if (cambiaReg && datos.regalias !== undefined) {
        cambios.regalias = datos.regalias;
      }
      if ((reactiva || desactiva) && datos.activo !== undefined) {
        cambios.activo = datos.activo;
      }

      const etiqueta = await tx.etiquetaMarca.update({ where: { id: datos.id }, data: cambios });

      if (cambiaNombre || cambiaReg || reactiva) {
        await registrarBitacora(tx, sesion, {
          entidad: 'EtiquetaMarca',
          idEntidad: etiqueta.id,
          accion: 'MODIFICAR',
          datos: {
            ...(cambiaNombre ? { nombre: { de: actual.nombre, a: etiqueta.nombre } } : {}),
            ...(cambiaReg
              ? { regalias: { de: actual.regalias.toNumber(), a: etiqueta.regalias.toNumber() } }
              : {}),
            ...(reactiva ? { operacion: 'reactivar' } : {}),
          },
        });
      }
      if (desactiva) {
        await registrarBitacora(tx, sesion, {
          entidad: 'EtiquetaMarca',
          idEntidad: etiqueta.id,
          accion: 'DESACTIVAR',
          datos: { nombre: etiqueta.nombre },
        });
      }

      return etiqueta;
    }, bd);
  } catch (error) {
    if (codigoErrorPrisma(error) === CODIGO_PRISMA.unicidad) {
      throw new ErrorConflicto('Ya existe una etiqueta de marca con ese nombre.', { causa: error });
    }
    throw error;
  }
}

/**
 * Desactiva (borrado SUAVE) una etiqueta de marca. Desactivar dos veces es
 * `ErrorConflicto` (pantalla desactualizada). Atajo explícito del botón "Desactivar".
 */
export async function desactivarEtiquetaMarca(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<EtiquetaMarca> {
  verificarPermiso(sesion, 'etiquetas-marca.administrar');
  return enTransaccion(async (tx) => {
    const actual = await exigirEtiquetaMarca(tx, id);
    if (!actual.activo) {
      throw new ErrorConflicto(`La etiqueta de marca "${actual.nombre}" ya está desactivada.`);
    }
    return actualizarEtiquetaMarca(sesion, { id, activo: false }, { tx });
  }, bd);
}

/** Reactiva una etiqueta de marca desactivada (operación inversa del borrado suave). */
export async function reactivarEtiquetaMarca(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<EtiquetaMarca> {
  verificarPermiso(sesion, 'etiquetas-marca.administrar');
  return enTransaccion(async (tx) => {
    const actual = await exigirEtiquetaMarca(tx, id);
    if (actual.activo) {
      throw new ErrorConflicto(`La etiqueta de marca "${actual.nombre}" ya está activa.`);
    }
    return actualizarEtiquetaMarca(sesion, { id, activo: true }, { tx });
  }, bd);
}

/** Obtiene una etiqueta de marca por id o lanza `ErrorNoEncontrado`. */
export async function obtenerEtiquetaMarca(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<EtiquetaMarca> {
  verificarPermiso(sesion, 'etiquetas-marca.ver');
  const etiqueta = await clienteLectura(bd).etiquetaMarca.findUnique({ where: { id } });
  if (etiqueta === null) {
    throw new ErrorNoEncontrado('EtiquetaMarca', id);
  }
  return etiqueta;
}

/**
 * Lista etiquetas de marca con búsqueda, orden y paginación EN SERVIDOR. Por defecto:
 * solo activas.
 */
export async function listarEtiquetasMarca(
  sesion: SesionUsuario,
  parametros: ParametrosListarEtiquetasMarca = {},
  bd?: ContextoBd,
): Promise<Pagina<EtiquetaMarca>> {
  verificarPermiso(sesion, 'etiquetas-marca.ver');
  const filtros = validarEntrada(esquemaListarEtiquetasMarca, parametros);

  const where: Prisma.EtiquetaMarcaWhereInput = {
    ...(filtros.incluirInactivos ? {} : { activo: true }),
    ...(filtros.busqueda === undefined || filtros.busqueda === ''
      ? {}
      : { nombre: { contains: filtros.busqueda, mode: 'insensitive' } }),
  };

  const cliente = clienteLectura(bd);
  const [total, datos] = await Promise.all([
    cliente.etiquetaMarca.count({ where }),
    cliente.etiquetaMarca.findMany({
      where,
      orderBy: { [filtros.ordenarPor]: filtros.direccion },
      ...rangoPrisma(filtros),
    }),
  ]);

  return armarPagina(datos, total, filtros);
}
