/**
 * Catálogo de defectos de calidad (F6-E1 — ex `CC_Catalogo`, doc 09 §2; MEJORAS 09; DECISIONES.md
 * §F6 (a)/(d)). CRUD patrón Almacenes con borrado SUAVE: un defecto con auditorías históricas NO
 * se borra físico (sus `AuditoriaDefecto` de F6-E2 lo referenciarán), solo se inactiva.
 *
 * Enriquecimientos de v2: `nivelAQL` numérico, `favorito` (pre-carga en auditorías), `categoria`,
 * `severidad` (METADATO informativo — NO entra en el veredicto, decisión (a)) y el etiquetado por
 * TIPO DE PRODUCTO (M:N por `DefectoTipoProducto`, decisión (d)): el defecto aplica a los tipos
 * ligados, o a TODOS si `aplicaGeneral`. Lógica SOLO aquí (A1); transacción + auditoría + bitácora
 * juntas (A2/A7); catálogo GLOBAL (sin idEmpresa). Unicidad de `clave` insensible a mayúsculas.
 */
import {
  esquemaDefectoCrear,
  esquemaDefectoEditar,
  SEVERIDADES_DEFECTO,
} from '../../contrato/index.js';
import type { Prisma } from '../../datos/index.js';
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

/** Defecto con sus tipos de producto ligados (lo que devuelven los servicios y proyecta la ruta). */
export type DefectoConTipos = Prisma.DefectoCatalogoGetPayload<{
  include: { tiposLigados: { include: { tipoProducto: { select: { id: true; nombre: true } } } } };
}>;

const INCLUIR_TIPOS = {
  tiposLigados: { include: { tipoProducto: { select: { id: true, nombre: true } } } },
} satisfies Prisma.DefectoCatalogoInclude;

/** Alta: campos del esquema compartido. */
export type EntradaCrearDefecto = z.input<typeof esquemaDefectoCrear>;
/** Edición: `id` + cambios parciales (incluye `activo` para des/reactivar). */
export type EntradaActualizarDefecto = z.input<typeof esquemaDefectoEditar>;

/**
 * Filtros del listado con tipos NATIVOS (boolean ya coaccionado): la ruta recibe el querystring
 * con `stringbool`/`coerce` (contrato) y aquí re-valida con tipos nativos (patrón Almacenes).
 */
export const esquemaListarDefectos = esquemaPaginacion.extend({
  busqueda: z.string().trim().max(100).optional(),
  nivelAQL: z.number().optional(),
  severidad: z.enum(SEVERIDADES_DEFECTO).optional(),
  soloFavoritos: z.boolean().default(false),
  incluirInactivos: z.boolean().default(false),
  ordenarPor: z.enum(['clave', 'descripcion', 'nivelAQL', 'creadoEn']).default('clave'),
  direccion: z.enum(['asc', 'desc']).default('asc'),
});

/** Parámetros del listado. */
export type ParametrosListarDefectos = z.input<typeof esquemaListarDefectos>;

/** Unicidad de negocio: no puede haber dos defectos con la misma clave (insensible a mayúsculas). */
async function exigirClaveLibre(tx: Tx, clave: string, idActual?: number): Promise<void> {
  const existente = await tx.defectoCatalogo.findFirst({
    where: {
      clave: { equals: clave, mode: 'insensitive' },
      ...(idActual === undefined ? {} : { id: { not: idActual } }),
    },
    select: { id: true, activo: true },
  });
  if (existente !== null) {
    throw new ErrorConflicto(
      existente.activo
        ? `Ya existe un defecto con la clave "${clave}".`
        : `Ya existe un defecto con la clave "${clave}" (está desactivado; puedes reactivarlo).`,
    );
  }
}

/**
 * Valida que TODOS los ids de tipo de producto existan y estén ACTIVOS (un defecto no se etiqueta
 * con un tipo apagado). Devuelve los ids únicos. Si `aplicaGeneral`, ignora las ligas (vacío).
 */
async function normalizarTipos(
  tx: Tx,
  aplicaGeneral: boolean,
  idsTipos: readonly number[],
): Promise<number[]> {
  if (aplicaGeneral || idsTipos.length === 0) {
    return [];
  }
  const unicos = [...new Set(idsTipos)];
  const activos = await tx.tipoProducto.findMany({
    where: { id: { in: unicos }, activo: true },
    select: { id: true },
  });
  if (activos.length !== unicos.length) {
    throw new ErrorValidacion(
      'Algún tipo de producto no existe o está desactivado; revisa la selección.',
    );
  }
  return unicos;
}

/** Busca un defecto (con sus tipos) por id o lanza `ErrorNoEncontrado`. */
async function exigirDefecto(tx: Tx, id: number): Promise<DefectoConTipos> {
  const defecto = await tx.defectoCatalogo.findUnique({ where: { id }, include: INCLUIR_TIPOS });
  if (defecto === null) {
    throw new ErrorNoEncontrado('DefectoCatalogo', id);
  }
  return defecto;
}

/**
 * Crea un defecto con sus tipos de producto ligados. Permiso `calidad.administrar-catalogo`; clave
 * única; nace activo; auditoría + bitácora en la misma transacción (A2/A7). Si `aplicaGeneral`, no
 * se guardan ligas (el defecto es universal).
 */
export async function crearDefecto(
  sesion: SesionUsuario,
  entrada: EntradaCrearDefecto,
  bd?: ContextoBd,
): Promise<DefectoConTipos> {
  verificarPermiso(sesion, 'calidad.administrar-catalogo');
  const datos = validarEntrada(esquemaDefectoCrear, entrada);

  try {
    return await enTransaccion(async (tx) => {
      await exigirClaveLibre(tx, datos.clave);
      const idsTipos = await normalizarTipos(tx, datos.aplicaGeneral, datos.tiposProducto);

      const defecto = await tx.defectoCatalogo.create({
        data: {
          clave: datos.clave,
          descripcion: datos.descripcion,
          pag: datos.pag ?? null,
          nivelAQL: datos.nivelAQL,
          favorito: datos.favorito,
          categoria: datos.categoria ?? null,
          severidad: datos.severidad,
          aplicaGeneral: datos.aplicaGeneral,
          tiposLigados: { create: idsTipos.map((idTipoProducto) => ({ idTipoProducto })) },
          ...datosCreacion(sesion),
        },
        include: INCLUIR_TIPOS,
      });

      await registrarBitacora(tx, sesion, {
        entidad: 'DefectoCatalogo',
        idEntidad: defecto.id,
        accion: 'CREAR',
        datos: {
          clave: defecto.clave,
          nivelAQL: datos.nivelAQL,
          severidad: defecto.severidad,
          aplicaGeneral: defecto.aplicaGeneral,
          tiposProducto: idsTipos,
        },
      });
      return defecto;
    }, bd);
  } catch (error) {
    if (codigoErrorPrisma(error) === CODIGO_PRISMA.unicidad) {
      throw new ErrorConflicto(`Ya existe un defecto con la clave "${datos.clave}".`, {
        causa: error,
      });
    }
    throw error;
  }
}

/**
 * Actualiza un defecto (edición parcial) + `activo` para des/reactivar. Si vienen `tiposProducto`
 * o cambia `aplicaGeneral`, se RE-ESCRIBE el set de ligas en la misma transacción (borra y recrea,
 * patrón "rewrite del BOM"). Bitácora según lo que pasó.
 */
export async function actualizarDefecto(
  sesion: SesionUsuario,
  entrada: EntradaActualizarDefecto,
  bd?: ContextoBd,
): Promise<DefectoConTipos> {
  verificarPermiso(sesion, 'calidad.administrar-catalogo');
  const datos = validarEntrada(esquemaDefectoEditar, entrada);

  try {
    return await enTransaccion(async (tx) => {
      const actual = await exigirDefecto(tx, datos.id);

      const cambiaClave = datos.clave !== undefined && datos.clave !== actual.clave;
      const reactiva = datos.activo === true && !actual.activo;
      const desactiva = datos.activo === false && actual.activo;
      const aplicaGeneral = datos.aplicaGeneral ?? actual.aplicaGeneral;
      // Reescribe ligas si vienen tipos nuevos, o si aplicaGeneral cambió (para limpiarlas/dejarlas).
      const reescribeTipos =
        datos.tiposProducto !== undefined ||
        (datos.aplicaGeneral !== undefined && datos.aplicaGeneral !== actual.aplicaGeneral);

      if (cambiaClave) {
        await exigirClaveLibre(tx, datos.clave ?? actual.clave, datos.id);
      } else if (reactiva) {
        await exigirClaveLibre(tx, actual.clave, datos.id);
      }

      const cambios: Prisma.DefectoCatalogoUpdateInput = { ...datosModificacion(sesion) };
      if (cambiaClave && datos.clave !== undefined) {
        cambios.clave = datos.clave;
      }
      if (datos.descripcion !== undefined) {
        cambios.descripcion = datos.descripcion;
      }
      if (datos.pag !== undefined) {
        cambios.pag = datos.pag;
      }
      if (datos.nivelAQL !== undefined) {
        cambios.nivelAQL = datos.nivelAQL;
      }
      if (datos.favorito !== undefined) {
        cambios.favorito = datos.favorito;
      }
      if (datos.categoria !== undefined) {
        cambios.categoria = datos.categoria;
      }
      if (datos.severidad !== undefined) {
        cambios.severidad = datos.severidad;
      }
      if (datos.aplicaGeneral !== undefined) {
        cambios.aplicaGeneral = datos.aplicaGeneral;
      }
      if ((reactiva || desactiva) && datos.activo !== undefined) {
        cambios.activo = datos.activo;
      }

      if (reescribeTipos) {
        const idsTipos = await normalizarTipos(
          tx,
          aplicaGeneral,
          datos.tiposProducto ?? actual.tiposLigados.map((l) => l.idTipoProducto),
        );
        await tx.defectoTipoProducto.deleteMany({ where: { idDefecto: datos.id } });
        cambios.tiposLigados = { create: idsTipos.map((idTipoProducto) => ({ idTipoProducto })) };
      }

      const defecto = await tx.defectoCatalogo.update({
        where: { id: datos.id },
        data: cambios,
        include: INCLUIR_TIPOS,
      });

      if (desactiva) {
        await registrarBitacora(tx, sesion, {
          entidad: 'DefectoCatalogo',
          idEntidad: defecto.id,
          accion: 'DESACTIVAR',
          datos: { clave: defecto.clave },
        });
      } else {
        await registrarBitacora(tx, sesion, {
          entidad: 'DefectoCatalogo',
          idEntidad: defecto.id,
          accion: 'MODIFICAR',
          datos: {
            ...(cambiaClave ? { clave: { de: actual.clave, a: defecto.clave } } : {}),
            ...(reactiva ? { operacion: 'reactivar' } : {}),
            ...(reescribeTipos ? { tiposReescritos: true } : {}),
          },
        });
      }
      return defecto;
    }, bd);
  } catch (error) {
    if (codigoErrorPrisma(error) === CODIGO_PRISMA.unicidad) {
      throw new ErrorConflicto('Ya existe un defecto con esa clave.', { causa: error });
    }
    throw error;
  }
}

/** Desactiva (borrado SUAVE) un defecto. Desactivarlo dos veces es `ErrorConflicto`. */
export async function desactivarDefecto(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<DefectoConTipos> {
  verificarPermiso(sesion, 'calidad.administrar-catalogo');
  return enTransaccion(async (tx) => {
    const actual = await exigirDefecto(tx, id);
    if (!actual.activo) {
      throw new ErrorConflicto(`El defecto "${actual.clave}" ya está desactivado.`);
    }
    return actualizarDefecto(sesion, { id, activo: false }, { tx });
  }, bd);
}

/** Reactiva un defecto desactivado (operación inversa del borrado suave). */
export async function reactivarDefecto(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<DefectoConTipos> {
  verificarPermiso(sesion, 'calidad.administrar-catalogo');
  return enTransaccion(async (tx) => {
    const actual = await exigirDefecto(tx, id);
    if (actual.activo) {
      throw new ErrorConflicto(`El defecto "${actual.clave}" ya está activo.`);
    }
    return actualizarDefecto(sesion, { id, activo: true }, { tx });
  }, bd);
}

/** Obtiene un defecto (con sus tipos) por id o lanza `ErrorNoEncontrado`. */
export async function obtenerDefecto(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<DefectoConTipos> {
  verificarPermiso(sesion, 'calidad.ver');
  const defecto = await clienteLectura(bd).defectoCatalogo.findUnique({
    where: { id },
    include: INCLUIR_TIPOS,
  });
  if (defecto === null) {
    throw new ErrorNoEncontrado('DefectoCatalogo', id);
  }
  return defecto;
}

/** Lista defectos con búsqueda, filtros, orden y paginación EN SERVIDOR. */
export async function listarDefectos(
  sesion: SesionUsuario,
  parametros: ParametrosListarDefectos = {},
  bd?: ContextoBd,
): Promise<Pagina<DefectoConTipos>> {
  verificarPermiso(sesion, 'calidad.ver');
  const filtros = validarEntrada(esquemaListarDefectos, parametros);

  const where: Prisma.DefectoCatalogoWhereInput = {
    ...(filtros.incluirInactivos ? {} : { activo: true }),
    ...(filtros.severidad === undefined ? {} : { severidad: filtros.severidad }),
    ...(filtros.soloFavoritos ? { favorito: true } : {}),
    ...(filtros.nivelAQL === undefined ? {} : { nivelAQL: filtros.nivelAQL }),
    ...(filtros.busqueda === undefined || filtros.busqueda === ''
      ? {}
      : {
          OR: [
            { clave: { contains: filtros.busqueda, mode: 'insensitive' } },
            { descripcion: { contains: filtros.busqueda, mode: 'insensitive' } },
          ],
        }),
  };

  const cliente = clienteLectura(bd);
  const [total, datos] = await Promise.all([
    cliente.defectoCatalogo.count({ where }),
    cliente.defectoCatalogo.findMany({
      where,
      orderBy: { [filtros.ordenarPor]: filtros.direccion },
      include: INCLUIR_TIPOS,
      ...rangoPrisma(filtros),
    }),
  ]);
  return armarPagina(datos, total, filtros);
}
