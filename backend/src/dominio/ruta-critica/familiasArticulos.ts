/**
 * CRUD de FAMILIAS y ARTÍCULOS de la Ruta Crítica (Módulo 8, F5-E2; doc 08-Ruta-Critica §2.1).
 * Catálogos GLOBALES (sin idEmpresa, como el resto de la RC). El `ArticuloRC` es el "tipo de
 * artículo" del CPM viejo (ex `CP_Articulos`, `IdCP_Articulos`); la `FamiliaArticulo` los agrupa
 * (ex `CP_Familia`). NO se conectan por FK desde `Orden` en esta etapa.
 *
 * Innegociables: A1 (toda la lógica aquí), A2/A7 (transacción + bitácora en cada cambio crítico),
 * A4 (RBAC server-side: `rc.catalogo-ver` lee, `rc.catalogo-administrar` muta), borrado SUAVE.
 */
import {
  esquemaArticuloCrear,
  esquemaArticuloPatchCuerpo,
  esquemaFamiliaCrear,
  esquemaFamiliaPatchCuerpo,
  type DatosArticuloCrear,
  type DatosArticuloPatchCuerpo,
  type DatosFamiliaCrear,
  type DatosFamiliaPatchCuerpo,
} from '../../contrato/index.js';
import type { Prisma, PrismaClient } from '../../datos/index.js';

import { datosCreacion, datosModificacion, registrarBitacora } from '../../comun/auditoria.js';
import { ErrorConflicto, ErrorNoEncontrado, ErrorValidacion } from '../../comun/errores.js';
import { verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import { CODIGO_PRISMA, codigoErrorPrisma } from '../../comun/prisma-errores.js';
import {
  clienteLectura,
  enTransaccion,
  type ContextoBd,
  type Tx,
} from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';

// ── Familias ───────────────────────────────────────────────────────────────────

/** Familia tal como la devuelve el dominio. */
export interface FamiliaDto {
  id: number;
  nombre: string;
  activo: boolean;
  creadoEn: Date;
  creadoPorId: string | null;
  modificadoEn: Date;
  modificadoPorId: string | null;
}

function aFamiliaDto(f: {
  id: number;
  nombre: string;
  activo: boolean;
  creadoEn: Date;
  creadoPorId: string | null;
  modificadoEn: Date;
  modificadoPorId: string | null;
}): FamiliaDto {
  return {
    id: f.id,
    nombre: f.nombre,
    activo: f.activo,
    creadoEn: f.creadoEn,
    creadoPorId: f.creadoPorId,
    modificadoEn: f.modificadoEn,
    modificadoPorId: f.modificadoPorId,
  };
}

/** Lista TODAS las familias (catálogo corto), opcionalmente con inactivas. */
export async function listarFamilias(
  sesion: SesionUsuario,
  incluirInactivos = false,
  bd?: ContextoBd,
): Promise<FamiliaDto[]> {
  verificarPermiso(sesion, 'rc.catalogo-ver');
  const filas = await clienteLectura(bd).familiaArticulo.findMany({
    where: incluirInactivos ? {} : { activo: true },
    orderBy: { nombre: 'asc' },
  });
  return filas.map(aFamiliaDto);
}

async function exigirFamilia(cliente: Tx | PrismaClient, id: number): Promise<FamiliaDto> {
  const f = await cliente.familiaArticulo.findUnique({ where: { id } });
  if (f === null) {
    throw new ErrorNoEncontrado('FamiliaArticulo', id);
  }
  return aFamiliaDto(f);
}

/** Crea una familia de artículos. */
export async function crearFamilia(
  sesion: SesionUsuario,
  entrada: DatosFamiliaCrear,
  bd?: ContextoBd,
): Promise<FamiliaDto> {
  verificarPermiso(sesion, 'rc.catalogo-administrar');
  const datos = validarEntrada(esquemaFamiliaCrear, entrada);
  try {
    return await enTransaccion(async (tx) => {
      const familia = await tx.familiaArticulo.create({
        data: { nombre: datos.nombre, ...datosCreacion(sesion) },
      });
      await registrarBitacora(tx, sesion, {
        entidad: 'FamiliaArticulo',
        idEntidad: familia.id,
        accion: 'CREAR',
        datos: { nombre: familia.nombre },
      });
      return aFamiliaDto(familia);
    }, bd);
  } catch (error) {
    if (codigoErrorPrisma(error) === CODIGO_PRISMA.unicidad) {
      throw new ErrorConflicto(`Ya existe una familia con el nombre "${datos.nombre}".`, {
        causa: error,
      });
    }
    throw error;
  }
}

/** Actualiza una familia (nombre y/o `activo`). */
export async function actualizarFamilia(
  sesion: SesionUsuario,
  id: number,
  entrada: DatosFamiliaPatchCuerpo,
  bd?: ContextoBd,
): Promise<FamiliaDto> {
  verificarPermiso(sesion, 'rc.catalogo-administrar');
  const datos = validarEntrada(esquemaFamiliaPatchCuerpo, entrada);
  try {
    return await enTransaccion(async (tx) => {
      const actual = await tx.familiaArticulo.findUnique({ where: { id } });
      if (actual === null) {
        throw new ErrorNoEncontrado('FamiliaArticulo', id);
      }
      const cambios: Prisma.FamiliaArticuloUpdateInput = {};
      const detalle: Record<string, Prisma.InputJsonValue> = {};
      if (datos.nombre !== undefined && datos.nombre !== actual.nombre) {
        cambios.nombre = datos.nombre;
        detalle.nombre = { de: actual.nombre, a: datos.nombre };
      }
      if (datos.activo !== undefined && datos.activo !== actual.activo) {
        cambios.activo = datos.activo;
        detalle.activo = datos.activo;
      }
      if (Object.keys(cambios).length === 0) {
        return aFamiliaDto(actual);
      }
      Object.assign(cambios, datosModificacion(sesion));
      const familia = await tx.familiaArticulo.update({ where: { id }, data: cambios });
      await registrarBitacora(tx, sesion, {
        entidad: 'FamiliaArticulo',
        idEntidad: id,
        accion: datos.activo === false ? 'DESACTIVAR' : 'MODIFICAR',
        datos: { ...detalle },
      });
      return aFamiliaDto(familia);
    }, bd);
  } catch (error) {
    if (codigoErrorPrisma(error) === CODIGO_PRISMA.unicidad) {
      throw new ErrorConflicto('Ya existe una familia con ese nombre.', { causa: error });
    }
    throw error;
  }
}

/** Desactiva (borrado suave) una familia. */
export async function desactivarFamilia(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<FamiliaDto> {
  verificarPermiso(sesion, 'rc.catalogo-administrar');
  return enTransaccion(async (tx) => {
    const actual = await exigirFamilia(tx, id);
    if (!actual.activo) {
      throw new ErrorConflicto(`La familia "${actual.nombre}" ya está desactivada.`);
    }
    return actualizarFamilia(sesion, id, { activo: false }, { tx });
  }, bd);
}

// ── Artículos ────────────────────────────────────────────────────────────────

/** Artículo RC tal como lo devuelve el dominio (incluye el nombre de su familia). */
export interface ArticuloDto {
  id: number;
  nombre: string;
  idFamiliaArticulo: number;
  familia: string;
  activo: boolean;
  creadoEn: Date;
  creadoPorId: string | null;
  modificadoEn: Date;
  modificadoPorId: string | null;
}

const INCLUDE_ARTICULO = {
  familia: { select: { nombre: true } },
} as const satisfies Prisma.ArticuloRCInclude;

type ArticuloConFamilia = Prisma.ArticuloRCGetPayload<{ include: typeof INCLUDE_ARTICULO }>;

function aArticuloDto(a: ArticuloConFamilia): ArticuloDto {
  return {
    id: a.id,
    nombre: a.nombre,
    idFamiliaArticulo: a.idFamiliaArticulo,
    familia: a.familia.nombre,
    activo: a.activo,
    creadoEn: a.creadoEn,
    creadoPorId: a.creadoPorId,
    modificadoEn: a.modificadoEn,
    modificadoPorId: a.modificadoPorId,
  };
}

/** Lista TODOS los artículos (catálogo corto), opcionalmente con inactivos. */
export async function listarArticulos(
  sesion: SesionUsuario,
  incluirInactivos = false,
  bd?: ContextoBd,
): Promise<ArticuloDto[]> {
  verificarPermiso(sesion, 'rc.catalogo-ver');
  const filas = await clienteLectura(bd).articuloRC.findMany({
    where: incluirInactivos ? {} : { activo: true },
    include: INCLUDE_ARTICULO,
    orderBy: { nombre: 'asc' },
  });
  return filas.map(aArticuloDto);
}

async function cargarArticulo(cliente: Tx | PrismaClient, id: number): Promise<ArticuloDto> {
  const a = await cliente.articuloRC.findUnique({ where: { id }, include: INCLUDE_ARTICULO });
  if (a === null) {
    throw new ErrorNoEncontrado('ArticuloRC', id);
  }
  return aArticuloDto(a);
}

/** Verifica que la familia exista y esté activa (no se cuelgan artículos de familias muertas). */
async function exigirFamiliaActiva(tx: Tx, idFamilia: number): Promise<void> {
  const familia = await tx.familiaArticulo.findUnique({
    where: { id: idFamilia },
    select: { id: true, activo: true },
  });
  if (familia === null) {
    throw new ErrorValidacion('La familia indicada no existe.');
  }
  if (!familia.activo) {
    throw new ErrorValidacion('La familia indicada está desactivada.');
  }
}

/** Crea un artículo RC dentro de una familia. */
export async function crearArticulo(
  sesion: SesionUsuario,
  entrada: DatosArticuloCrear,
  bd?: ContextoBd,
): Promise<ArticuloDto> {
  verificarPermiso(sesion, 'rc.catalogo-administrar');
  const datos = validarEntrada(esquemaArticuloCrear, entrada);
  return enTransaccion(async (tx) => {
    await exigirFamiliaActiva(tx, datos.idFamiliaArticulo);
    const articulo = await tx.articuloRC.create({
      data: {
        nombre: datos.nombre,
        idFamiliaArticulo: datos.idFamiliaArticulo,
        ...datosCreacion(sesion),
      },
    });
    await registrarBitacora(tx, sesion, {
      entidad: 'ArticuloRC',
      idEntidad: articulo.id,
      accion: 'CREAR',
      datos: { nombre: articulo.nombre, idFamiliaArticulo: articulo.idFamiliaArticulo },
    });
    return cargarArticulo(tx, articulo.id);
  }, bd);
}

/** Actualiza un artículo (nombre, familia y/o `activo`). */
export async function actualizarArticulo(
  sesion: SesionUsuario,
  id: number,
  entrada: DatosArticuloPatchCuerpo,
  bd?: ContextoBd,
): Promise<ArticuloDto> {
  verificarPermiso(sesion, 'rc.catalogo-administrar');
  const datos = validarEntrada(esquemaArticuloPatchCuerpo, entrada);
  return enTransaccion(async (tx) => {
    const actual = await tx.articuloRC.findUnique({ where: { id } });
    if (actual === null) {
      throw new ErrorNoEncontrado('ArticuloRC', id);
    }
    const cambios: Prisma.ArticuloRCUpdateInput = {};
    const detalle: Record<string, Prisma.InputJsonValue> = {};
    if (datos.nombre !== undefined && datos.nombre !== actual.nombre) {
      cambios.nombre = datos.nombre;
      detalle.nombre = { de: actual.nombre, a: datos.nombre };
    }
    if (
      datos.idFamiliaArticulo !== undefined &&
      datos.idFamiliaArticulo !== actual.idFamiliaArticulo
    ) {
      await exigirFamiliaActiva(tx, datos.idFamiliaArticulo);
      cambios.familia = { connect: { id: datos.idFamiliaArticulo } };
      detalle.idFamiliaArticulo = { de: actual.idFamiliaArticulo, a: datos.idFamiliaArticulo };
    }
    if (datos.activo !== undefined && datos.activo !== actual.activo) {
      cambios.activo = datos.activo;
      detalle.activo = datos.activo;
    }
    if (Object.keys(cambios).length === 0) {
      return cargarArticulo(tx, id);
    }
    Object.assign(cambios, datosModificacion(sesion));
    await tx.articuloRC.update({ where: { id }, data: cambios });
    await registrarBitacora(tx, sesion, {
      entidad: 'ArticuloRC',
      idEntidad: id,
      accion: datos.activo === false ? 'DESACTIVAR' : 'MODIFICAR',
      datos: { ...detalle },
    });
    return cargarArticulo(tx, id);
  }, bd);
}

/** Desactiva (borrado suave) un artículo. */
export async function desactivarArticulo(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<ArticuloDto> {
  verificarPermiso(sesion, 'rc.catalogo-administrar');
  return enTransaccion(async (tx) => {
    const actual = await cargarArticulo(tx, id);
    if (!actual.activo) {
      throw new ErrorConflicto(`El artículo "${actual.nombre}" ya está desactivado.`);
    }
    return actualizarArticulo(sesion, id, { activo: false }, { tx });
  }, bd);
}
