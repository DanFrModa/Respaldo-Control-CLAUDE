/**
 * CRUD del CALENDARIO LABORAL por empresa de la Ruta Crítica (Módulo 8, F5-E2; doc 08-Ruta-Critica
 * §4 capacidad 5; D10; decisión (a) "calendario configurable POR EMPRESA"). Dos piezas:
 *  • CalendarioEmpresa — qué días de la semana son hábiles (1:1 con la empresa; default L–V).
 *  • DiaFestivo        — días festivos no laborables de la empresa.
 *
 * El motor de E4 los consulta para fechar la RC con `comun/diasHabiles` (puro). Aquí solo el ABM.
 *
 * Innegociables: A1 (lógica aquí), A2/A7 (transacción + bitácora), A4 (RBAC: `rc.catalogo-ver`
 * lee, `rc.catalogo-administrar` muta), borrado SUAVE en festivos.
 */
import {
  esquemaCalendarioActualizar,
  esquemaFestivoCrear,
  esquemaFestivoPatchCuerpo,
  type DatosCalendarioActualizar,
  type DatosFestivoCrear,
  type DatosFestivoPatchCuerpo,
} from '../../contrato/index.js';
import type { Prisma } from '../../datos/index.js';

import { datosCreacion, datosModificacion, registrarBitacora } from '../../comun/auditoria.js';
import { ErrorConflicto, ErrorNoEncontrado, ErrorValidacion } from '../../comun/errores.js';
import {
  type CalendarioLaboral,
  type DiasSemanaHabiles,
  claveDiaUtc,
} from '../../comun/diasHabiles.js';
import { verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import { CODIGO_PRISMA, codigoErrorPrisma } from '../../comun/prisma-errores.js';
import {
  clienteLectura,
  enTransaccion,
  type ContextoBd,
  type Tx,
} from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';

// ── Calendario (días hábiles de la semana) ────────────────────────────────────

/** Calendario de una empresa tal como lo devuelve el dominio. */
export interface CalendarioDto extends DiasSemanaHabiles {
  idEmpresa: number;
  creadoEn: Date;
  creadoPorId: string | null;
  modificadoEn: Date;
  modificadoPorId: string | null;
}

type CalendarioFila = {
  idEmpresa: number;
  lunes: boolean;
  martes: boolean;
  miercoles: boolean;
  jueves: boolean;
  viernes: boolean;
  sabado: boolean;
  domingo: boolean;
  creadoEn: Date;
  creadoPorId: string | null;
  modificadoEn: Date;
  modificadoPorId: string | null;
};

function aCalendarioDto(c: CalendarioFila): CalendarioDto {
  return {
    idEmpresa: c.idEmpresa,
    lunes: c.lunes,
    martes: c.martes,
    miercoles: c.miercoles,
    jueves: c.jueves,
    viernes: c.viernes,
    sabado: c.sabado,
    domingo: c.domingo,
    creadoEn: c.creadoEn,
    creadoPorId: c.creadoPorId,
    modificadoEn: c.modificadoEn,
    modificadoPorId: c.modificadoPorId,
  };
}

/** Verifica que la empresa exista (las empresas no se borran físico; basta con que exista). */
async function exigirEmpresa(tx: Tx, idEmpresa: number): Promise<void> {
  const empresa = await tx.empresa.findUnique({ where: { id: idEmpresa }, select: { id: true } });
  if (empresa === null) {
    throw new ErrorValidacion('La empresa indicada no existe.');
  }
}

/**
 * Obtiene el calendario de una empresa; si aún no existe, devuelve el DEFAULT (L–V hábiles) sin
 * persistirlo (se crea al primer guardado). Así la UI siempre tiene algo que mostrar.
 */
export async function obtenerCalendario(
  sesion: SesionUsuario,
  idEmpresa: number,
  bd?: ContextoBd,
): Promise<CalendarioDto> {
  verificarPermiso(sesion, 'rc.catalogo-ver');
  const fila = await clienteLectura(bd).calendarioEmpresa.findUnique({ where: { idEmpresa } });
  if (fila !== null) {
    return aCalendarioDto(fila);
  }
  const ahora = new Date();
  return {
    idEmpresa,
    lunes: true,
    martes: true,
    miercoles: true,
    jueves: true,
    viernes: true,
    sabado: false,
    domingo: false,
    creadoEn: ahora,
    creadoPorId: null,
    modificadoEn: ahora,
    modificadoPorId: null,
  };
}

/** Fija (upsert) el calendario de días hábiles de una empresa (set completo). */
export async function actualizarCalendario(
  sesion: SesionUsuario,
  idEmpresa: number,
  entrada: DatosCalendarioActualizar,
  bd?: ContextoBd,
): Promise<CalendarioDto> {
  verificarPermiso(sesion, 'rc.catalogo-administrar');
  const datos = validarEntrada(esquemaCalendarioActualizar, entrada);
  return enTransaccion(async (tx) => {
    await exigirEmpresa(tx, idEmpresa);
    const fila = await tx.calendarioEmpresa.upsert({
      where: { idEmpresa },
      update: { ...datos, ...datosModificacion(sesion) },
      create: { idEmpresa, ...datos, ...datosCreacion(sesion) },
    });
    await registrarBitacora(tx, sesion, {
      entidad: 'CalendarioEmpresa',
      idEntidad: fila.id,
      accion: 'MODIFICAR',
      datos: { idEmpresa, ...datos },
    });
    return aCalendarioDto(fila);
  }, bd);
}

// ── Días festivos ──────────────────────────────────────────────────────────────

/** Día festivo tal como lo devuelve el dominio (la fecha como `YYYY-MM-DD` en UTC). */
export interface FestivoDto {
  id: number;
  idEmpresa: number;
  fecha: string;
  descripcion: string;
  activo: boolean;
  creadoEn: Date;
  creadoPorId: string | null;
  modificadoEn: Date;
  modificadoPorId: string | null;
}

function aFestivoDto(f: {
  id: number;
  idEmpresa: number;
  fecha: Date;
  descripcion: string;
  activo: boolean;
  creadoEn: Date;
  creadoPorId: string | null;
  modificadoEn: Date;
  modificadoPorId: string | null;
}): FestivoDto {
  return {
    id: f.id,
    idEmpresa: f.idEmpresa,
    fecha: claveDiaUtc(f.fecha),
    descripcion: f.descripcion,
    activo: f.activo,
    creadoEn: f.creadoEn,
    creadoPorId: f.creadoPorId,
    modificadoEn: f.modificadoEn,
    modificadoPorId: f.modificadoPorId,
  };
}

/** Convierte `YYYY-MM-DD` a un `Date` a medianoche UTC (sin corrimientos de zona). */
function fechaUtc(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

/** Lista los festivos de una empresa (ordenados por fecha). */
export async function listarFestivos(
  sesion: SesionUsuario,
  idEmpresa: number,
  incluirInactivos = false,
  bd?: ContextoBd,
): Promise<FestivoDto[]> {
  verificarPermiso(sesion, 'rc.catalogo-ver');
  const filas = await clienteLectura(bd).diaFestivo.findMany({
    where: { idEmpresa, ...(incluirInactivos ? {} : { activo: true }) },
    orderBy: { fecha: 'asc' },
  });
  return filas.map(aFestivoDto);
}

/** Crea un día festivo para una empresa. */
export async function crearFestivo(
  sesion: SesionUsuario,
  entrada: DatosFestivoCrear,
  bd?: ContextoBd,
): Promise<FestivoDto> {
  verificarPermiso(sesion, 'rc.catalogo-administrar');
  const datos = validarEntrada(esquemaFestivoCrear, entrada);
  try {
    return await enTransaccion(async (tx) => {
      await exigirEmpresa(tx, datos.idEmpresa);
      const fila = await tx.diaFestivo.create({
        data: {
          idEmpresa: datos.idEmpresa,
          fecha: fechaUtc(datos.fecha),
          descripcion: datos.descripcion,
          ...datosCreacion(sesion),
        },
      });
      await registrarBitacora(tx, sesion, {
        entidad: 'DiaFestivo',
        idEntidad: fila.id,
        accion: 'CREAR',
        datos: { idEmpresa: datos.idEmpresa, fecha: datos.fecha, descripcion: datos.descripcion },
      });
      return aFestivoDto(fila);
    }, bd);
  } catch (error) {
    if (codigoErrorPrisma(error) === CODIGO_PRISMA.unicidad) {
      throw new ErrorConflicto(`Ya hay un festivo registrado el ${datos.fecha}.`, { causa: error });
    }
    throw error;
  }
}

/** Actualiza un día festivo (fecha, descripción y/o `activo`). */
export async function actualizarFestivo(
  sesion: SesionUsuario,
  id: number,
  entrada: DatosFestivoPatchCuerpo,
  bd?: ContextoBd,
): Promise<FestivoDto> {
  verificarPermiso(sesion, 'rc.catalogo-administrar');
  const datos = validarEntrada(esquemaFestivoPatchCuerpo, entrada);
  try {
    return await enTransaccion(async (tx) => {
      const actual = await tx.diaFestivo.findUnique({ where: { id } });
      if (actual === null) {
        throw new ErrorNoEncontrado('DiaFestivo', id);
      }
      const cambios: Prisma.DiaFestivoUpdateInput = {};
      if (datos.fecha !== undefined) cambios.fecha = fechaUtc(datos.fecha);
      if (datos.descripcion !== undefined) cambios.descripcion = datos.descripcion;
      if (datos.activo !== undefined) cambios.activo = datos.activo;
      if (Object.keys(cambios).length === 0) {
        return aFestivoDto(actual);
      }
      Object.assign(cambios, datosModificacion(sesion));
      const fila = await tx.diaFestivo.update({ where: { id }, data: cambios });
      await registrarBitacora(tx, sesion, {
        entidad: 'DiaFestivo',
        idEntidad: id,
        accion: datos.activo === false ? 'DESACTIVAR' : 'MODIFICAR',
        datos: {
          fecha: claveDiaUtc(fila.fecha),
          descripcion: fila.descripcion,
          activo: fila.activo,
        },
      });
      return aFestivoDto(fila);
    }, bd);
  } catch (error) {
    if (codigoErrorPrisma(error) === CODIGO_PRISMA.unicidad) {
      throw new ErrorConflicto('Ya hay un festivo registrado en esa fecha.', { causa: error });
    }
    throw error;
  }
}

/** Desactiva (borrado suave) un día festivo. */
export async function desactivarFestivo(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<FestivoDto> {
  verificarPermiso(sesion, 'rc.catalogo-administrar');
  return enTransaccion(async (tx) => {
    const actual = await tx.diaFestivo.findUnique({ where: { id } });
    if (actual === null) {
      throw new ErrorNoEncontrado('DiaFestivo', id);
    }
    if (!actual.activo) {
      throw new ErrorConflicto('El festivo ya está desactivado.');
    }
    return actualizarFestivo(sesion, id, { activo: false }, { tx });
  }, bd);
}

// ── Carga del calendario PURO (para el motor de E4) ───────────────────────────

/**
 * Carga el {@link CalendarioLaboral} PURO de una empresa (días hábiles + set de festivos activos)
 * listo para `comun/diasHabiles`. Lo usará el CPM de E4. Si no hay calendario guardado, asume el
 * default L–V. Lectura (no muta), exige `rc.catalogo-ver`.
 */
export async function cargarCalendarioLaboral(
  sesion: SesionUsuario,
  idEmpresa: number,
  bd?: ContextoBd,
): Promise<CalendarioLaboral> {
  verificarPermiso(sesion, 'rc.catalogo-ver');
  return cargarCalendarioLaboralSinSesion(idEmpresa, bd);
}

/**
 * Igual que {@link cargarCalendarioLaboral} pero SIN sesión ni verificación de permiso: para los
 * PROCESOS DE SISTEMA (el handler del CPM en segundo plano, F5-E4) que no tienen una `SesionUsuario`.
 * NUNCA se expone por una ruta REST; solo lo invoca el motor de jobs (el RBAC ya se aplicó cuando un
 * usuario disparó la programación). Lectura pura (no muta).
 */
export async function cargarCalendarioLaboralSinSesion(
  idEmpresa: number,
  bd?: ContextoBd,
): Promise<CalendarioLaboral> {
  const cliente = clienteLectura(bd);
  const [cal, festivos] = await Promise.all([
    cliente.calendarioEmpresa.findUnique({ where: { idEmpresa } }),
    cliente.diaFestivo.findMany({ where: { idEmpresa, activo: true }, select: { fecha: true } }),
  ]);
  const diasSemana: DiasSemanaHabiles =
    cal === null
      ? {
          domingo: false,
          lunes: true,
          martes: true,
          miercoles: true,
          jueves: true,
          viernes: true,
          sabado: false,
        }
      : {
          domingo: cal.domingo,
          lunes: cal.lunes,
          martes: cal.martes,
          miercoles: cal.miercoles,
          jueves: cal.jueves,
          viernes: cal.viernes,
          sabado: cal.sabado,
        };
  return {
    diasSemana,
    festivos: new Set(festivos.map((f) => claveDiaUtc(f.fecha))),
  };
}
