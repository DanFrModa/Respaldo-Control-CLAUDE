/**
 * CRUD de las REGLAS DE DURACIÓN de la Ruta Crítica (Módulo 8, F5-E2; doc 08-Ruta-Critica §4
 * capacidad 5; D10). Tres catálogos GLOBALES que el motor de E4 usará para estimar fechas:
 *  • FactorCantidad      — factor multiplicador por rango de piezas (ex `CP_Cant`).
 *  • DuracionPorTipoTela — días de espera por tipo de tela + factorTela (ex `RC_TipoTelas`).
 *  • DuracionPorAplicacion — días por aplicación/estampado (ex `RC_Aplicaciones`).
 *
 * Innegociables: A1 (lógica aquí), A2/A7 (transacción + bitácora), A4 (RBAC: `rc.catalogo-ver`
 * lee, `rc.catalogo-administrar` muta), borrado SUAVE.
 */
import {
  esquemaDuracionAplicacionCrear,
  esquemaDuracionAplicacionPatchCuerpo,
  esquemaDuracionTelaCrear,
  esquemaDuracionTelaPatchCuerpo,
  esquemaFactorCantidadCrear,
  esquemaFactorCantidadPatchCuerpo,
  type DatosDuracionAplicacionCrear,
  type DatosDuracionAplicacionPatchCuerpo,
  type DatosDuracionTelaCrear,
  type DatosDuracionTelaPatchCuerpo,
  type DatosFactorCantidadCrear,
  type DatosFactorCantidadPatchCuerpo,
} from '../../contrato/index.js';
import type { Prisma } from '../../datos/index.js';

import { datosCreacion, datosModificacion, registrarBitacora } from '../../comun/auditoria.js';
import { ErrorConflicto, ErrorNoEncontrado, ErrorValidacion } from '../../comun/errores.js';
import { verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import { CODIGO_PRISMA, codigoErrorPrisma } from '../../comun/prisma-errores.js';
import { clienteLectura, enTransaccion, type ContextoBd } from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';

// ── Factor por cantidad (ex CP_Cant) ──────────────────────────────────────────

/** Factor por cantidad tal como lo devuelve el dominio (Decimal → number). */
export interface FactorCantidadDto {
  id: number;
  deCant: number;
  aCant: number;
  factor: number;
  activo: boolean;
  creadoEn: Date;
  creadoPorId: string | null;
  modificadoEn: Date;
  modificadoPorId: string | null;
}

function aFactorDto(f: {
  id: number;
  deCant: number;
  aCant: number;
  factor: Prisma.Decimal;
  activo: boolean;
  creadoEn: Date;
  creadoPorId: string | null;
  modificadoEn: Date;
  modificadoPorId: string | null;
}): FactorCantidadDto {
  return {
    id: f.id,
    deCant: f.deCant,
    aCant: f.aCant,
    factor: Number(f.factor),
    activo: f.activo,
    creadoEn: f.creadoEn,
    creadoPorId: f.creadoPorId,
    modificadoEn: f.modificadoEn,
    modificadoPorId: f.modificadoPorId,
  };
}

/** Valida que el rango sea coherente (`deCant <= aCant`). */
function exigirRangoValido(deCant: number, aCant: number): void {
  if (deCant > aCant) {
    throw new ErrorValidacion('El límite inferior no puede ser mayor que el superior.');
  }
}

/** Lista TODOS los factores por cantidad, ordenados por el límite inferior. */
export async function listarFactoresCantidad(
  sesion: SesionUsuario,
  incluirInactivos = false,
  bd?: ContextoBd,
): Promise<FactorCantidadDto[]> {
  verificarPermiso(sesion, 'rc.catalogo-ver');
  const filas = await clienteLectura(bd).factorCantidad.findMany({
    where: incluirInactivos ? {} : { activo: true },
    orderBy: { deCant: 'asc' },
  });
  return filas.map(aFactorDto);
}

/** Crea un factor por rango de cantidad. */
export async function crearFactorCantidad(
  sesion: SesionUsuario,
  entrada: DatosFactorCantidadCrear,
  bd?: ContextoBd,
): Promise<FactorCantidadDto> {
  verificarPermiso(sesion, 'rc.catalogo-administrar');
  const datos = validarEntrada(esquemaFactorCantidadCrear, entrada);
  exigirRangoValido(datos.deCant, datos.aCant);
  return enTransaccion(async (tx) => {
    const fila = await tx.factorCantidad.create({
      data: {
        deCant: datos.deCant,
        aCant: datos.aCant,
        factor: datos.factor,
        ...datosCreacion(sesion),
      },
    });
    await registrarBitacora(tx, sesion, {
      entidad: 'FactorCantidad',
      idEntidad: fila.id,
      accion: 'CREAR',
      datos: { deCant: fila.deCant, aCant: fila.aCant, factor: Number(fila.factor) },
    });
    return aFactorDto(fila);
  }, bd);
}

/** Actualiza un factor por cantidad. */
export async function actualizarFactorCantidad(
  sesion: SesionUsuario,
  id: number,
  entrada: DatosFactorCantidadPatchCuerpo,
  bd?: ContextoBd,
): Promise<FactorCantidadDto> {
  verificarPermiso(sesion, 'rc.catalogo-administrar');
  const datos = validarEntrada(esquemaFactorCantidadPatchCuerpo, entrada);
  return enTransaccion(async (tx) => {
    const actual = await tx.factorCantidad.findUnique({ where: { id } });
    if (actual === null) {
      throw new ErrorNoEncontrado('FactorCantidad', id);
    }
    const deCant = datos.deCant ?? actual.deCant;
    const aCant = datos.aCant ?? actual.aCant;
    exigirRangoValido(deCant, aCant);
    const cambios: Prisma.FactorCantidadUpdateInput = {};
    if (datos.deCant !== undefined) cambios.deCant = datos.deCant;
    if (datos.aCant !== undefined) cambios.aCant = datos.aCant;
    if (datos.factor !== undefined) cambios.factor = datos.factor;
    if (datos.activo !== undefined) cambios.activo = datos.activo;
    if (Object.keys(cambios).length === 0) {
      return aFactorDto(actual);
    }
    Object.assign(cambios, datosModificacion(sesion));
    const fila = await tx.factorCantidad.update({ where: { id }, data: cambios });
    await registrarBitacora(tx, sesion, {
      entidad: 'FactorCantidad',
      idEntidad: id,
      accion: datos.activo === false ? 'DESACTIVAR' : 'MODIFICAR',
      datos: { deCant, aCant, factor: Number(fila.factor), activo: fila.activo },
    });
    return aFactorDto(fila);
  }, bd);
}

/** Desactiva (borrado suave) un factor por cantidad. */
export async function desactivarFactorCantidad(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<FactorCantidadDto> {
  verificarPermiso(sesion, 'rc.catalogo-administrar');
  return enTransaccion(async (tx) => {
    const actual = await tx.factorCantidad.findUnique({ where: { id } });
    if (actual === null) {
      throw new ErrorNoEncontrado('FactorCantidad', id);
    }
    if (!actual.activo) {
      throw new ErrorConflicto('El factor por cantidad ya está desactivado.');
    }
    return actualizarFactorCantidad(sesion, id, { activo: false }, { tx });
  }, bd);
}

// ── Duración por tipo de tela (ex RC_TipoTelas) ───────────────────────────────

/** Duración por tipo de tela tal como la devuelve el dominio. */
export interface DuracionTelaDto {
  id: number;
  nombre: string;
  dias: number;
  factorTela: number;
  activo: boolean;
  creadoEn: Date;
  creadoPorId: string | null;
  modificadoEn: Date;
  modificadoPorId: string | null;
}

function aTelaDto(t: {
  id: number;
  nombre: string;
  dias: number;
  factorTela: Prisma.Decimal;
  activo: boolean;
  creadoEn: Date;
  creadoPorId: string | null;
  modificadoEn: Date;
  modificadoPorId: string | null;
}): DuracionTelaDto {
  return {
    id: t.id,
    nombre: t.nombre,
    dias: t.dias,
    factorTela: Number(t.factorTela),
    activo: t.activo,
    creadoEn: t.creadoEn,
    creadoPorId: t.creadoPorId,
    modificadoEn: t.modificadoEn,
    modificadoPorId: t.modificadoPorId,
  };
}

/** Lista TODAS las duraciones por tipo de tela. */
export async function listarDuracionesTela(
  sesion: SesionUsuario,
  incluirInactivos = false,
  bd?: ContextoBd,
): Promise<DuracionTelaDto[]> {
  verificarPermiso(sesion, 'rc.catalogo-ver');
  const filas = await clienteLectura(bd).duracionPorTipoTela.findMany({
    where: incluirInactivos ? {} : { activo: true },
    orderBy: { dias: 'asc' },
  });
  return filas.map(aTelaDto);
}

/** Crea una duración por tipo de tela. */
export async function crearDuracionTela(
  sesion: SesionUsuario,
  entrada: DatosDuracionTelaCrear,
  bd?: ContextoBd,
): Promise<DuracionTelaDto> {
  verificarPermiso(sesion, 'rc.catalogo-administrar');
  const datos = validarEntrada(esquemaDuracionTelaCrear, entrada);
  try {
    return await enTransaccion(async (tx) => {
      const fila = await tx.duracionPorTipoTela.create({
        data: {
          nombre: datos.nombre,
          dias: datos.dias,
          factorTela: datos.factorTela,
          ...datosCreacion(sesion),
        },
      });
      await registrarBitacora(tx, sesion, {
        entidad: 'DuracionPorTipoTela',
        idEntidad: fila.id,
        accion: 'CREAR',
        datos: { nombre: fila.nombre, dias: fila.dias },
      });
      return aTelaDto(fila);
    }, bd);
  } catch (error) {
    if (codigoErrorPrisma(error) === CODIGO_PRISMA.unicidad) {
      throw new ErrorConflicto(`Ya existe un tipo de tela con el nombre "${datos.nombre}".`, {
        causa: error,
      });
    }
    throw error;
  }
}

/** Actualiza una duración por tipo de tela. */
export async function actualizarDuracionTela(
  sesion: SesionUsuario,
  id: number,
  entrada: DatosDuracionTelaPatchCuerpo,
  bd?: ContextoBd,
): Promise<DuracionTelaDto> {
  verificarPermiso(sesion, 'rc.catalogo-administrar');
  const datos = validarEntrada(esquemaDuracionTelaPatchCuerpo, entrada);
  try {
    return await enTransaccion(async (tx) => {
      const actual = await tx.duracionPorTipoTela.findUnique({ where: { id } });
      if (actual === null) {
        throw new ErrorNoEncontrado('DuracionPorTipoTela', id);
      }
      const cambios: Prisma.DuracionPorTipoTelaUpdateInput = {};
      if (datos.nombre !== undefined) cambios.nombre = datos.nombre;
      if (datos.dias !== undefined) cambios.dias = datos.dias;
      if (datos.factorTela !== undefined) cambios.factorTela = datos.factorTela;
      if (datos.activo !== undefined) cambios.activo = datos.activo;
      if (Object.keys(cambios).length === 0) {
        return aTelaDto(actual);
      }
      Object.assign(cambios, datosModificacion(sesion));
      const fila = await tx.duracionPorTipoTela.update({ where: { id }, data: cambios });
      await registrarBitacora(tx, sesion, {
        entidad: 'DuracionPorTipoTela',
        idEntidad: id,
        accion: datos.activo === false ? 'DESACTIVAR' : 'MODIFICAR',
        datos: { nombre: fila.nombre, dias: fila.dias, activo: fila.activo },
      });
      return aTelaDto(fila);
    }, bd);
  } catch (error) {
    if (codigoErrorPrisma(error) === CODIGO_PRISMA.unicidad) {
      throw new ErrorConflicto('Ya existe un tipo de tela con ese nombre.', { causa: error });
    }
    throw error;
  }
}

/** Desactiva (borrado suave) una duración por tipo de tela. */
export async function desactivarDuracionTela(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<DuracionTelaDto> {
  verificarPermiso(sesion, 'rc.catalogo-administrar');
  return enTransaccion(async (tx) => {
    const actual = await tx.duracionPorTipoTela.findUnique({ where: { id } });
    if (actual === null) {
      throw new ErrorNoEncontrado('DuracionPorTipoTela', id);
    }
    if (!actual.activo) {
      throw new ErrorConflicto(`El tipo de tela "${actual.nombre}" ya está desactivado.`);
    }
    return actualizarDuracionTela(sesion, id, { activo: false }, { tx });
  }, bd);
}

// ── Duración por aplicación (ex RC_Aplicaciones) ──────────────────────────────

/** Duración por aplicación tal como la devuelve el dominio. */
export interface DuracionAplicacionDto {
  id: number;
  nombre: string;
  clave: string | null;
  dias: number;
  factor: number | null;
  activo: boolean;
  creadoEn: Date;
  creadoPorId: string | null;
  modificadoEn: Date;
  modificadoPorId: string | null;
}

function aAplicacionDto(a: {
  id: number;
  nombre: string;
  clave: string | null;
  dias: number;
  factor: Prisma.Decimal | null;
  activo: boolean;
  creadoEn: Date;
  creadoPorId: string | null;
  modificadoEn: Date;
  modificadoPorId: string | null;
}): DuracionAplicacionDto {
  return {
    id: a.id,
    nombre: a.nombre,
    clave: a.clave,
    dias: a.dias,
    factor: a.factor === null ? null : Number(a.factor),
    activo: a.activo,
    creadoEn: a.creadoEn,
    creadoPorId: a.creadoPorId,
    modificadoEn: a.modificadoEn,
    modificadoPorId: a.modificadoPorId,
  };
}

/** Lista TODAS las duraciones por aplicación. */
export async function listarDuracionesAplicacion(
  sesion: SesionUsuario,
  incluirInactivos = false,
  bd?: ContextoBd,
): Promise<DuracionAplicacionDto[]> {
  verificarPermiso(sesion, 'rc.catalogo-ver');
  const filas = await clienteLectura(bd).duracionPorAplicacion.findMany({
    where: incluirInactivos ? {} : { activo: true },
    orderBy: { dias: 'asc' },
  });
  return filas.map(aAplicacionDto);
}

/** Crea una duración por aplicación. */
export async function crearDuracionAplicacion(
  sesion: SesionUsuario,
  entrada: DatosDuracionAplicacionCrear,
  bd?: ContextoBd,
): Promise<DuracionAplicacionDto> {
  verificarPermiso(sesion, 'rc.catalogo-administrar');
  const datos = validarEntrada(esquemaDuracionAplicacionCrear, entrada);
  try {
    return await enTransaccion(async (tx) => {
      const fila = await tx.duracionPorAplicacion.create({
        data: {
          nombre: datos.nombre,
          clave: datos.clave ?? null,
          dias: datos.dias,
          factor: datos.factor ?? null,
          ...datosCreacion(sesion),
        },
      });
      await registrarBitacora(tx, sesion, {
        entidad: 'DuracionPorAplicacion',
        idEntidad: fila.id,
        accion: 'CREAR',
        datos: { nombre: fila.nombre, dias: fila.dias },
      });
      return aAplicacionDto(fila);
    }, bd);
  } catch (error) {
    if (codigoErrorPrisma(error) === CODIGO_PRISMA.unicidad) {
      throw new ErrorConflicto(`Ya existe una aplicación con el nombre "${datos.nombre}".`, {
        causa: error,
      });
    }
    throw error;
  }
}

/** Actualiza una duración por aplicación. */
export async function actualizarDuracionAplicacion(
  sesion: SesionUsuario,
  id: number,
  entrada: DatosDuracionAplicacionPatchCuerpo,
  bd?: ContextoBd,
): Promise<DuracionAplicacionDto> {
  verificarPermiso(sesion, 'rc.catalogo-administrar');
  const datos = validarEntrada(esquemaDuracionAplicacionPatchCuerpo, entrada);
  try {
    return await enTransaccion(async (tx) => {
      const actual = await tx.duracionPorAplicacion.findUnique({ where: { id } });
      if (actual === null) {
        throw new ErrorNoEncontrado('DuracionPorAplicacion', id);
      }
      const cambios: Prisma.DuracionPorAplicacionUpdateInput = {};
      if (datos.nombre !== undefined) cambios.nombre = datos.nombre;
      if (datos.clave !== undefined) cambios.clave = datos.clave;
      if (datos.dias !== undefined) cambios.dias = datos.dias;
      if (datos.factor !== undefined) cambios.factor = datos.factor;
      if (datos.activo !== undefined) cambios.activo = datos.activo;
      if (Object.keys(cambios).length === 0) {
        return aAplicacionDto(actual);
      }
      Object.assign(cambios, datosModificacion(sesion));
      const fila = await tx.duracionPorAplicacion.update({ where: { id }, data: cambios });
      await registrarBitacora(tx, sesion, {
        entidad: 'DuracionPorAplicacion',
        idEntidad: id,
        accion: datos.activo === false ? 'DESACTIVAR' : 'MODIFICAR',
        datos: { nombre: fila.nombre, dias: fila.dias, activo: fila.activo },
      });
      return aAplicacionDto(fila);
    }, bd);
  } catch (error) {
    if (codigoErrorPrisma(error) === CODIGO_PRISMA.unicidad) {
      throw new ErrorConflicto('Ya existe una aplicación con ese nombre.', { causa: error });
    }
    throw error;
  }
}

/** Desactiva (borrado suave) una duración por aplicación. */
export async function desactivarDuracionAplicacion(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<DuracionAplicacionDto> {
  verificarPermiso(sesion, 'rc.catalogo-administrar');
  return enTransaccion(async (tx) => {
    const actual = await tx.duracionPorAplicacion.findUnique({ where: { id } });
    if (actual === null) {
      throw new ErrorNoEncontrado('DuracionPorAplicacion', id);
    }
    if (!actual.activo) {
      throw new ErrorConflicto(`La aplicación "${actual.nombre}" ya está desactivada.`);
    }
    return actualizarDuracionAplicacion(sesion, id, { activo: false }, { tx });
  }, bd);
}
