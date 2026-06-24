/**
 * Tipos de proceso de maquila — CRUD (F3-E1; CRUD patrón Almacenes, doc 03-Produccion).
 *
 * `TipoProceso` (costura/estampado/bordado/lavado/aplicación) existía desde F1-E2 (solo
 * sembrado). F3-E1 le da CRUD y le agrega la bandera **`generaEntradaPt`** (decisión (e),
 * DECISIONES.md / ADR-0010): qué proceso deja prenda terminada y por tanto si su recibo mete a
 * inventario PT (costura `true`; estampado/bordado/lavado `false`). Es un catálogo GLOBAL (sin
 * idEmpresa — ADR-0007). Su consumidor real (la Ruta Crítica) llega en F5.
 *
 * Piezas del patrón (igual que Almacenes):
 *  1. Permiso primero (`tipos-proceso.ver` para leer, `.administrar` para mutar; A4).
 *  2. **`generaEntradaPt` solo lo edita un ADMIN** (decisión (e)): el servicio descarta cualquier
 *     valor de esa bandera si la sesión no es admin (`roles.administrar`, marcador de los roles de
 *     administración total). La pantalla ya la deshabilita; el servidor es la autoridad (§9.2).
 *  3. Zod compartido de `src/contrato`. 4. Todo en UNA transacción (A2) con auditoría + Bitácora
 *     (A7). 5. Borrado SUAVE (`activo`). 6. Errores de dominio por código. 7. Listado paginado.
 */
import { esquemaTipoProcesoCrear, esquemaTipoProcesoEditar } from '../../contrato/index.js';
import type { Prisma, TipoProceso } from '../../datos/index.js';
import { z } from 'zod';

import { datosCreacion, datosModificacion, registrarBitacora } from '../../comun/auditoria.js';
import { ErrorConflicto, ErrorNoEncontrado } from '../../comun/errores.js';
import {
  armarPagina,
  esquemaPaginacion,
  rangoPrisma,
  type Pagina,
} from '../../comun/paginacion.js';
import { tienePermiso, verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import { CODIGO_PRISMA, codigoErrorPrisma } from '../../comun/prisma-errores.js';
import {
  clienteLectura,
  enTransaccion,
  type ContextoBd,
  type Tx,
} from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';

/** Alta: campos del esquema compartido. */
export type EntradaCrearTipoProceso = z.input<typeof esquemaTipoProcesoCrear>;

/** Edición: `id` + cambios parciales (incluye `activo` para des/reactivar). */
export type EntradaActualizarTipoProceso = z.input<typeof esquemaTipoProcesoEditar>;

/** Parámetros del listado (los reutiliza la ruta REST). */
export const esquemaListarTiposProceso = esquemaPaginacion.extend({
  busqueda: z.string().trim().max(100).optional(),
  incluirInactivos: z.boolean().default(false),
  ordenarPor: z.enum(['codigo', 'nombre', 'creadoEn']).default('nombre'),
  direccion: z.enum(['asc', 'desc']).default('asc'),
});

export type ParametrosListarTiposProceso = z.input<typeof esquemaListarTiposProceso>;

/**
 * ¿La sesión puede editar la bandera `generaEntradaPt`? (decisión (e)). Solo los roles de
 * administración total la tocan; se usa `roles.administrar` como marcador de "admin" (es el
 * permiso que solo tienen Administrador/AdministracionDireccion en el seed). Aísla la regla en un
 * solo lugar para que el reviewer la encuentre.
 */
function puedeEditarGeneraEntradaPt(sesion: SesionUsuario): boolean {
  return tienePermiso(sesion, 'roles.administrar');
}

/** Unicidad del código (insensible a mayúsculas). La carrera residual la cubre el unique de BD. */
async function exigirCodigoLibre(tx: Tx, codigo: string, idActual?: number): Promise<void> {
  const existente = await tx.tipoProceso.findFirst({
    where: {
      codigo: { equals: codigo, mode: 'insensitive' },
      ...(idActual === undefined ? {} : { id: { not: idActual } }),
    },
    select: { id: true, activo: true },
  });
  if (existente !== null) {
    throw new ErrorConflicto(
      existente.activo
        ? `Ya existe un tipo de proceso con el código "${codigo}".`
        : `Ya existe un tipo de proceso con el código "${codigo}" (está desactivado; puedes reactivarlo).`,
    );
  }
}

/** Busca un tipo de proceso por id o lanza `ErrorNoEncontrado`. */
async function exigirTipoProceso(tx: Tx, id: number): Promise<TipoProceso> {
  const tipo = await tx.tipoProceso.findUnique({ where: { id } });
  if (tipo === null) {
    throw new ErrorNoEncontrado('TipoProceso', id);
  }
  return tipo;
}

/**
 * Crea un tipo de proceso. `generaEntradaPt` solo se respeta si la sesión es admin (decisión (e));
 * para no-admins se ignora y queda en `false` (default seguro). Permiso `tipos-proceso.administrar`.
 */
export async function crearTipoProceso(
  sesion: SesionUsuario,
  entrada: EntradaCrearTipoProceso,
  bd?: ContextoBd,
): Promise<TipoProceso> {
  verificarPermiso(sesion, 'tipos-proceso.administrar');
  const datos = validarEntrada(esquemaTipoProcesoCrear, entrada);
  // Solo un admin puede fijar la bandera; si no, se queda en el default seguro (false).
  const generaEntradaPt =
    datos.generaEntradaPt !== undefined && puedeEditarGeneraEntradaPt(sesion)
      ? datos.generaEntradaPt
      : false;

  try {
    return await enTransaccion(async (tx) => {
      await exigirCodigoLibre(tx, datos.codigo);
      const tipo = await tx.tipoProceso.create({
        data: {
          codigo: datos.codigo,
          nombre: datos.nombre,
          generaEntradaPt,
          ...datosCreacion(sesion),
        },
      });
      await registrarBitacora(tx, sesion, {
        entidad: 'TipoProceso',
        idEntidad: tipo.id,
        accion: 'CREAR',
        datos: { codigo: tipo.codigo, nombre: tipo.nombre, generaEntradaPt: tipo.generaEntradaPt },
      });
      return tipo;
    }, bd);
  } catch (error) {
    if (codigoErrorPrisma(error) === CODIGO_PRISMA.unicidad) {
      throw new ErrorConflicto(`Ya existe un tipo de proceso con el código "${datos.codigo}".`, {
        causa: error,
      });
    }
    throw error;
  }
}

/**
 * Actualiza un tipo de proceso (código/nombre/`generaEntradaPt`/`activo`). `generaEntradaPt` solo
 * cambia si la sesión es admin (decisión (e)); para no-admins se ignora silenciosamente (la
 * pantalla ya lo deshabilita). Bitácora `MODIFICAR`/`DESACTIVAR` según lo que pasó (A7).
 */
export async function actualizarTipoProceso(
  sesion: SesionUsuario,
  entrada: EntradaActualizarTipoProceso,
  bd?: ContextoBd,
): Promise<TipoProceso> {
  verificarPermiso(sesion, 'tipos-proceso.administrar');
  const datos = validarEntrada(esquemaTipoProcesoEditar, entrada);
  const esAdmin = puedeEditarGeneraEntradaPt(sesion);

  try {
    return await enTransaccion(async (tx) => {
      const actual = await exigirTipoProceso(tx, datos.id);

      const cambiaCodigo = datos.codigo !== undefined && datos.codigo !== actual.codigo;
      const cambiaNombre = datos.nombre !== undefined && datos.nombre !== actual.nombre;
      // La bandera solo cambia si vino, es admin y difiere de la actual.
      const cambiaBandera =
        datos.generaEntradaPt !== undefined &&
        esAdmin &&
        datos.generaEntradaPt !== actual.generaEntradaPt;
      const reactiva = datos.activo === true && !actual.activo;
      const desactiva = datos.activo === false && actual.activo;

      if (!cambiaCodigo && !cambiaNombre && !cambiaBandera && !reactiva && !desactiva) {
        return actual; // idempotente: nada que guardar, sin bitácora vacía
      }

      if (cambiaCodigo) {
        await exigirCodigoLibre(tx, datos.codigo ?? actual.codigo, datos.id);
      } else if (reactiva) {
        await exigirCodigoLibre(tx, actual.codigo, datos.id);
      }

      const cambios: Prisma.TipoProcesoUpdateInput = { ...datosModificacion(sesion) };
      if (cambiaCodigo && datos.codigo !== undefined) {
        cambios.codigo = datos.codigo;
      }
      if (cambiaNombre && datos.nombre !== undefined) {
        cambios.nombre = datos.nombre;
      }
      if (cambiaBandera && datos.generaEntradaPt !== undefined) {
        cambios.generaEntradaPt = datos.generaEntradaPt;
      }
      if ((reactiva || desactiva) && datos.activo !== undefined) {
        cambios.activo = datos.activo;
      }

      const tipo = await tx.tipoProceso.update({ where: { id: datos.id }, data: cambios });

      if (cambiaCodigo || cambiaNombre || cambiaBandera || reactiva) {
        await registrarBitacora(tx, sesion, {
          entidad: 'TipoProceso',
          idEntidad: tipo.id,
          accion: 'MODIFICAR',
          datos: {
            ...(cambiaCodigo ? { codigo: { de: actual.codigo, a: tipo.codigo } } : {}),
            ...(cambiaNombre ? { nombre: { de: actual.nombre, a: tipo.nombre } } : {}),
            ...(cambiaBandera
              ? { generaEntradaPt: { de: actual.generaEntradaPt, a: tipo.generaEntradaPt } }
              : {}),
            ...(reactiva ? { operacion: 'reactivar' } : {}),
          },
        });
      }
      if (desactiva) {
        await registrarBitacora(tx, sesion, {
          entidad: 'TipoProceso',
          idEntidad: tipo.id,
          accion: 'DESACTIVAR',
          datos: { codigo: tipo.codigo },
        });
      }

      return tipo;
    }, bd);
  } catch (error) {
    if (codigoErrorPrisma(error) === CODIGO_PRISMA.unicidad) {
      throw new ErrorConflicto('Ya existe un tipo de proceso con ese código.', { causa: error });
    }
    throw error;
  }
}

/** Desactiva (borrado SUAVE) un tipo de proceso. Desactivar dos veces es `ErrorConflicto`. */
export async function desactivarTipoProceso(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<TipoProceso> {
  verificarPermiso(sesion, 'tipos-proceso.administrar');
  return enTransaccion(async (tx) => {
    const actual = await exigirTipoProceso(tx, id);
    if (!actual.activo) {
      throw new ErrorConflicto(`El tipo de proceso "${actual.nombre}" ya está desactivado.`);
    }
    return actualizarTipoProceso(sesion, { id, activo: false }, { tx });
  }, bd);
}

/** Reactiva un tipo de proceso desactivado. */
export async function reactivarTipoProceso(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<TipoProceso> {
  verificarPermiso(sesion, 'tipos-proceso.administrar');
  return enTransaccion(async (tx) => {
    const actual = await exigirTipoProceso(tx, id);
    if (actual.activo) {
      throw new ErrorConflicto(`El tipo de proceso "${actual.nombre}" ya está activo.`);
    }
    return actualizarTipoProceso(sesion, { id, activo: true }, { tx });
  }, bd);
}

/** Obtiene un tipo de proceso por id o lanza `ErrorNoEncontrado`. */
export async function obtenerTipoProceso(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<TipoProceso> {
  verificarPermiso(sesion, 'tipos-proceso.ver');
  const tipo = await clienteLectura(bd).tipoProceso.findUnique({ where: { id } });
  if (tipo === null) {
    throw new ErrorNoEncontrado('TipoProceso', id);
  }
  return tipo;
}

/** Lista tipos de proceso con búsqueda, orden y paginación EN SERVIDOR. */
export async function listarTiposProceso(
  sesion: SesionUsuario,
  parametros: ParametrosListarTiposProceso = {},
  bd?: ContextoBd,
): Promise<Pagina<TipoProceso>> {
  verificarPermiso(sesion, 'tipos-proceso.ver');
  const filtros = validarEntrada(esquemaListarTiposProceso, parametros);

  const where: Prisma.TipoProcesoWhereInput = {
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
    cliente.tipoProceso.count({ where }),
    cliente.tipoProceso.findMany({
      where,
      orderBy: { [filtros.ordenarPor]: filtros.direccion },
      ...rangoPrisma(filtros),
    }),
  ]);

  return armarPagina(datos, total, filtros);
}
