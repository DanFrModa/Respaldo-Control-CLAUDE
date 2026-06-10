/**
 * Almacenes — CRUD PATRÓN de CONTROL v2.
 *
 * Este servicio fija el estándar que replica todo catálogo del sistema
 * (PLANMAESTRO §6 F0: "un CRUD patrón completo (p. ej. Almacenes) que fija el
 * estándar"; doc funcional 04-Inventarios: los almacenes separan PT y telas
 * por ubicación; aquí se unifican como base del kardex único D3). Las piezas
 * del patrón:
 *
 * 1. **Permiso primero** (`verificarPermiso`): el servidor decide, la
 *    pantalla solo esconde (PLANMAESTRO §9.2). `almacenes.ver` para leer,
 *    `almacenes.administrar` para mutar.
 * 2. **Zod en toda entrada** con el esquema COMPARTIDO de `src/contrato`
 *    (`esquemaAlmacenCrear`/`esquemaAlmacenEditar`): la misma validación en
 *    el formulario y en el servidor, mensajes en español.
 * 3. **Todo cambio en UNA transacción** (`enTransaccion`, A2): regla de
 *    unicidad + escritura + auditoría de la fila + `Bitacora` (A7), juntos o
 *    nada.
 * 4. **Borrado SUAVE** (`activo=false`, PLANMAESTRO §4): el historial de
 *    movimientos del almacén es intocable.
 * 5. **Multi-empresa explícito** (A9): por defecto se opera sobre la empresa
 *    activa de la sesión; los almacenes globales (heredados, `idEmpresa`
 *    null) se ven junto a los propios.
 * 6. **Errores de dominio**: la ruta REST mapea por `codigo`, jamás por
 *    mensaje.
 * 7. **Listado paginado estándar** (`Pagina<T>`): búsqueda + orden +
 *    paginación EN SERVIDOR.
 */
import { esquemaAlmacenCrear, esquemaAlmacenEditar, TIPOS_ALMACEN } from '../../contrato/index.js';
import type { Almacen, Prisma } from '../../datos/index.js';
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

/** Alta: campos del esquema compartido (`idEmpresa` ausente = empresa activa). */
export type EntradaCrearAlmacen = z.input<typeof esquemaAlmacenCrear>;

/** Edición: `id` + cambios parciales (incluye `activo` para des/reactivar). */
export type EntradaActualizarAlmacen = z.input<typeof esquemaAlmacenEditar>;

/** Parámetros del listado (los reutiliza la ruta REST en su entrada). */
export const esquemaListarAlmacenes = esquemaPaginacion.extend({
  /** Texto a buscar en el nombre (insensible a mayúsculas). */
  busqueda: z.string().trim().max(100).optional(),
  /** Filtrar por tipo de almacén. */
  tipo: z.enum(TIPOS_ALMACEN).optional(),
  /** Por omisión solo activos; `true` muestra también los desactivados. */
  incluirInactivos: z.boolean().default(false),
  /** `true` lista los almacenes de TODAS las empresas (vista de administración). */
  todasLasEmpresas: z.boolean().default(false),
  ordenarPor: z.enum(['nombre', 'tipo', 'creadoEn']).default('nombre'),
  direccion: z.enum(['asc', 'desc']).default('asc'),
});

export type ParametrosListarAlmacenes = z.input<typeof esquemaListarAlmacenes>;

/** Visibilidad estándar (A9): lo de la empresa activa + lo global heredado. */
function filtroEmpresaActiva(sesion: SesionUsuario): Prisma.AlmacenWhereInput {
  return { OR: [{ idEmpresa: sesion.idEmpresaActiva }, { idEmpresa: null }] };
}

/**
 * Unicidad de negocio: no puede haber dos almacenes con el mismo nombre
 * visibles a la vez (misma empresa o globales), sin importar mayúsculas
 * ("Bodega PT" ≡ "bodega pt"). Se valida DENTRO de la transacción; la carrera
 * residual la captura el unique de la base (P2002 → `ErrorConflicto`), que
 * cubre el caso exacto por empresa.
 */
async function exigirNombreLibre(
  tx: Tx,
  idEmpresa: number | null,
  nombre: string,
  idActual?: number,
): Promise<void> {
  const existente = await tx.almacen.findFirst({
    where: {
      OR: [{ idEmpresa }, { idEmpresa: null }],
      nombre: { equals: nombre, mode: 'insensitive' },
      ...(idActual === undefined ? {} : { id: { not: idActual } }),
    },
    select: { id: true, activo: true },
  });
  if (existente !== null) {
    throw new ErrorConflicto(
      existente.activo
        ? `Ya existe un almacén llamado "${nombre}" en esta empresa.`
        : `Ya existe un almacén llamado "${nombre}" en esta empresa (está desactivado; puedes reactivarlo).`,
    );
  }
}

/** Busca un almacén VISIBLE para la sesión (A9) o lanza `ErrorNoEncontrado`. */
async function exigirAlmacen(tx: Tx, sesion: SesionUsuario, id: number): Promise<Almacen> {
  const almacen = await tx.almacen.findFirst({ where: { id, ...filtroEmpresaActiva(sesion) } });
  if (almacen === null) {
    throw new ErrorNoEncontrado('Almacen', id);
  }
  return almacen;
}

/**
 * Crea un almacén. Si la entrada no trae `idEmpresa`, nace en la empresa
 * activa de la sesión (A9); con `idEmpresa` explícito (vista de
 * administración) se valida que esa empresa exista y esté activa.
 *
 * Reglas: permiso `almacenes.administrar`; nombre único entre los almacenes
 * visibles de la empresa → `ErrorConflicto`; nace activo; auditoría y
 * bitácora en la misma transacción (A2/A7).
 *
 * @example
 * const almacen = await crearAlmacen(sesion, { nombre: "Bodega PT", tipo: "PT" });
 */
export async function crearAlmacen(
  sesion: SesionUsuario,
  entrada: EntradaCrearAlmacen,
  bd?: ContextoBd,
): Promise<Almacen> {
  verificarPermiso(sesion, 'almacenes.administrar');
  const datos = validarEntrada(esquemaAlmacenCrear, entrada);
  const idEmpresa = datos.idEmpresa ?? sesion.idEmpresaActiva;

  try {
    return await enTransaccion(async (tx) => {
      const empresa = await tx.empresa.findUnique({
        where: { id: idEmpresa },
        select: { activa: true },
      });
      if (empresa?.activa !== true) {
        throw new ErrorValidacion(`La empresa ${String(idEmpresa)} no existe o está desactivada.`);
      }
      await exigirNombreLibre(tx, idEmpresa, datos.nombre);

      const almacen = await tx.almacen.create({
        data: {
          nombre: datos.nombre,
          tipo: datos.tipo,
          idEmpresa,
          ...datosCreacion(sesion),
        },
      });

      await registrarBitacora(tx, sesion, {
        entidad: 'Almacen',
        idEntidad: almacen.id,
        accion: 'CREAR',
        datos: { nombre: almacen.nombre, tipo: almacen.tipo, idEmpresa },
      });

      return almacen;
    }, bd);
  } catch (error) {
    if (codigoErrorPrisma(error) === CODIGO_PRISMA.unicidad) {
      throw new ErrorConflicto(`Ya existe un almacén llamado "${datos.nombre}" en esta empresa.`, {
        causa: error,
      });
    }
    throw error;
  }
}

/**
 * Actualiza un almacén de la empresa activa: nombre y/o tipo, y `activo` para
 * desactivar (borrado suave) o reactivar — la forma exacta del esquema
 * compartido `esquemaAlmacenEditar`. Un almacén NO se mueve de empresa: si la
 * entrada trae `idEmpresa` distinto del actual es `ErrorValidacion` (sus
 * movimientos de kardex son de esa empresa, D3/A9).
 *
 * Bitácora según lo que pasó: `MODIFICAR` con el detalle de campos, y/o
 * `DESACTIVAR` si el cambio apagó el almacén.
 */
export async function actualizarAlmacen(
  sesion: SesionUsuario,
  entrada: EntradaActualizarAlmacen,
  bd?: ContextoBd,
): Promise<Almacen> {
  verificarPermiso(sesion, 'almacenes.administrar');
  const datos = validarEntrada(esquemaAlmacenEditar, entrada);

  try {
    return await enTransaccion(async (tx) => {
      const actual = await exigirAlmacen(tx, sesion, datos.id);

      if (datos.idEmpresa !== undefined && datos.idEmpresa !== actual.idEmpresa) {
        throw new ErrorValidacion(
          'Un almacén no se puede mover de empresa: su historial de movimientos pertenece a ella.',
        );
      }

      const cambiaNombre = datos.nombre !== undefined && datos.nombre !== actual.nombre;
      const cambiaTipo = datos.tipo !== undefined && datos.tipo !== actual.tipo;
      const reactiva = datos.activo === true && !actual.activo;
      const desactiva = datos.activo === false && actual.activo;

      if (!cambiaNombre && !cambiaTipo && !reactiva && !desactiva) {
        return actual; // nada que guardar: idempotente, sin bitácora vacía
      }

      // Al cambiar nombre o al reactivar puede chocar con un nombre vigente.
      if (cambiaNombre) {
        await exigirNombreLibre(tx, actual.idEmpresa, datos.nombre ?? actual.nombre, datos.id);
      } else if (reactiva) {
        await exigirNombreLibre(tx, actual.idEmpresa, actual.nombre, datos.id);
      }

      // Cada bandera ya garantizó que su campo está definido; se arma el update
      // solo con lo que cambió (exactOptionalPropertyTypes: nada de `undefined`).
      const cambios: Prisma.AlmacenUpdateInput = { ...datosModificacion(sesion) };
      if (cambiaNombre && datos.nombre !== undefined) {
        cambios.nombre = datos.nombre;
      }
      if (cambiaTipo && datos.tipo !== undefined) {
        cambios.tipo = datos.tipo;
      }
      if ((reactiva || desactiva) && datos.activo !== undefined) {
        cambios.activo = datos.activo;
      }

      const almacen = await tx.almacen.update({ where: { id: datos.id }, data: cambios });

      if (cambiaNombre || cambiaTipo || reactiva) {
        await registrarBitacora(tx, sesion, {
          entidad: 'Almacen',
          idEntidad: almacen.id,
          accion: 'MODIFICAR',
          datos: {
            ...(cambiaNombre ? { nombre: { de: actual.nombre, a: almacen.nombre } } : {}),
            ...(cambiaTipo ? { tipo: { de: actual.tipo, a: almacen.tipo } } : {}),
            ...(reactiva ? { operacion: 'reactivar' } : {}),
          },
        });
      }
      if (desactiva) {
        await registrarBitacora(tx, sesion, {
          entidad: 'Almacen',
          idEntidad: almacen.id,
          accion: 'DESACTIVAR',
          datos: { nombre: almacen.nombre },
        });
      }

      return almacen;
    }, bd);
  } catch (error) {
    if (codigoErrorPrisma(error) === CODIGO_PRISMA.unicidad) {
      throw new ErrorConflicto('Ya existe un almacén con ese nombre en esta empresa.', {
        causa: error,
      });
    }
    throw error;
  }
}

/**
 * Desactiva (borrado SUAVE) un almacén: deja de aparecer en capturas pero su
 * historial queda intacto. Desactivar dos veces es `ErrorConflicto` (la
 * pantalla estaba desactualizada). Es el atajo explícito del botón
 * "Desactivar" sobre `actualizarAlmacen`.
 */
export async function desactivarAlmacen(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<Almacen> {
  verificarPermiso(sesion, 'almacenes.administrar');
  return enTransaccion(async (tx) => {
    const actual = await exigirAlmacen(tx, sesion, id);
    if (!actual.activo) {
      throw new ErrorConflicto(`El almacén "${actual.nombre}" ya está desactivado.`);
    }
    return actualizarAlmacen(sesion, { id, activo: false }, { tx });
  }, bd);
}

/** Reactiva un almacén desactivado (operación inversa del borrado suave). */
export async function reactivarAlmacen(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<Almacen> {
  verificarPermiso(sesion, 'almacenes.administrar');
  return enTransaccion(async (tx) => {
    const actual = await exigirAlmacen(tx, sesion, id);
    if (actual.activo) {
      throw new ErrorConflicto(`El almacén "${actual.nombre}" ya está activo.`);
    }
    return actualizarAlmacen(sesion, { id, activo: true }, { tx });
  }, bd);
}

/** Obtiene un almacén visible para la sesión o lanza `ErrorNoEncontrado`. */
export async function obtenerAlmacen(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<Almacen> {
  verificarPermiso(sesion, 'almacenes.ver');
  const almacen = await clienteLectura(bd).almacen.findFirst({
    where: { id, ...filtroEmpresaActiva(sesion) },
  });
  if (almacen === null) {
    throw new ErrorNoEncontrado('Almacen', id);
  }
  return almacen;
}

/**
 * Lista almacenes con búsqueda, orden y paginación EN SERVIDOR (la tabla de
 * la UI nunca trae todo para filtrar en memoria). Por defecto: los de la
 * empresa activa + globales, solo activos.
 *
 * @example
 * const pagina = await listarAlmacenes(sesion, { busqueda: "bodega", pagina: 1 });
 */
export async function listarAlmacenes(
  sesion: SesionUsuario,
  parametros: ParametrosListarAlmacenes = {},
  bd?: ContextoBd,
): Promise<Pagina<Almacen>> {
  verificarPermiso(sesion, 'almacenes.ver');
  const filtros = validarEntrada(esquemaListarAlmacenes, parametros);

  const where: Prisma.AlmacenWhereInput = {
    ...(filtros.todasLasEmpresas ? {} : filtroEmpresaActiva(sesion)),
    ...(filtros.incluirInactivos ? {} : { activo: true }),
    ...(filtros.tipo === undefined ? {} : { tipo: filtros.tipo }),
    ...(filtros.busqueda === undefined || filtros.busqueda === ''
      ? {}
      : { nombre: { contains: filtros.busqueda, mode: 'insensitive' } }),
  };

  const cliente = clienteLectura(bd);
  const [total, datos] = await Promise.all([
    cliente.almacen.count({ where }),
    cliente.almacen.findMany({
      where,
      orderBy: { [filtros.ordenarPor]: filtros.direccion },
      ...rangoPrisma(filtros),
    }),
  ]);

  return armarPagina(datos, total, filtros);
}
