/**
 * MUESTRARIOS PENDIENTES (Módulo Indicadores, F7-E4; doc `05-Indicadores.md` §A.3; ← `IP_MuesPend`).
 * Seguimiento de boards y muestras: solicitud → seguimiento → entrega, con KPI de cumplimiento
 * (`fechaEntregado <= fechaRequerida`). Toda la lógica vive aquí (A1); las rutas validan y delegan.
 *
 * Innegociables: A2 (escrituras en transacción con bitácora A7), A4 (`indicadores.ip-muestrarios`
 * gobierna leer/capturar; la fecha libre exige `indicadores.fecha-libre`), A9 (por empresa activa).
 */
import type { z } from 'zod';

import {
  esquemaMuestrarioCancelar,
  esquemaMuestrarioCrear,
  esquemaMuestrarioEditar,
  esquemaMuestrarioEntregar,
  esquemaMuestrariosCumplimientoQuery,
  esquemaMuestrariosQuery,
  type DatosMuestrarioCancelar,
  type DatosMuestrarioCrear,
  type DatosMuestrarioEditar,
  type DatosMuestrarioEntregar,
  type EstadoMuestrarioValor,
  type MuestrarioSalida,
  type MuestrariosCumplimiento,
  type MuestrariosCumplimientoQuery,
  type MuestrariosPagina,
  type MuestrariosQuery,
} from '../../contrato/index.js';
import { Prisma } from '../../datos/index.js';

import { datosCreacion, datosModificacion, registrarBitacora } from '../../comun/auditoria.js';
import { ErrorConflicto, ErrorNoEncontrado } from '../../comun/errores.js';
import { armarPagina, rangoPrisma, type Pagina } from '../../comun/paginacion.js';
import { verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import {
  clienteLectura,
  enTransaccion,
  type ContextoBd,
  type Tx,
} from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';

import { fechaAUtc, hoyUtc, verificarFechaCapturable } from './fechas.js';

/** Muestrario con cliente/temporada incluidos (para proyectar sus nombres). */
type MuestrarioConRelaciones = Prisma.MuestrarioGetPayload<{
  include: { cliente: { select: { nombre: true } }; temporada: { select: { nombre: true } } };
}>;

const INCLUDE = {
  cliente: { select: { nombre: true } },
  temporada: { select: { nombre: true } },
} as const;

const A_DIA = (fecha: Date): string => fecha.toISOString().slice(0, 10);

/** Estado derivado del muestrario. */
function estadoDe(m: { cancelado: boolean; fechaEntregado: Date | null }): EstadoMuestrarioValor {
  if (m.cancelado) return 'cancelado';
  return m.fechaEntregado === null ? 'pendiente' : 'entregado';
}

/** ¿Entregado a tiempo? (fechaEntregado ≤ fechaRequerida); null si no entregado. */
function aTiempoDe(m: { fechaEntregado: Date | null; fechaRequerida: Date }): boolean | null {
  if (m.fechaEntregado === null) return null;
  return m.fechaEntregado.getTime() <= m.fechaRequerida.getTime();
}

/** Proyecta un muestrario a la salida del contrato. */
function aSalida(m: MuestrarioConRelaciones): MuestrarioSalida {
  return {
    id: m.id,
    idEmpresa: m.idEmpresa,
    idCliente: m.idCliente,
    cliente: m.cliente.nombre,
    categoria: m.categoria,
    idTemporada: m.idTemporada,
    temporada: m.temporada?.nombre ?? null,
    cantBoards: m.cantBoards,
    cantMuestras: m.cantMuestras,
    fechaSolicitado: A_DIA(m.fechaSolicitado),
    fechaRequerida: A_DIA(m.fechaRequerida),
    fechaEntregado: m.fechaEntregado ? A_DIA(m.fechaEntregado) : null,
    boardsOK: m.boardsOK,
    muestrasOK: m.muestrasOK,
    solicitanteId: m.solicitanteId,
    estado: estadoDe(m),
    aTiempo: aTiempoDe(m),
    cancelado: m.cancelado,
    motivoCancelacion: m.motivoCancelacion,
    creadoEn: m.creadoEn.toISOString(),
    creadoPorId: m.creadoPorId,
  };
}

/** Carga un muestrario de la empresa activa (A9) o lanza. */
async function exigirMuestrario(
  tx: Tx,
  id: number,
  idEmpresa: number,
): Promise<MuestrarioConRelaciones> {
  const m = await tx.muestrario.findUnique({ where: { id }, include: INCLUDE });
  if (m === null || m.idEmpresa !== idEmpresa) throw new ErrorNoEncontrado('Muestrario', id);
  return m;
}

/** Valida que el cliente exista. */
async function exigirCliente(tx: Tx, idCliente: number): Promise<void> {
  const c = await tx.cliente.findUnique({ where: { id: idCliente }, select: { id: true } });
  if (c === null) throw new ErrorNoEncontrado('Cliente', idCliente);
}

/** Valida que la temporada exista (si viene). */
async function exigirTemporada(tx: Tx, idTemporada: number): Promise<void> {
  const t = await tx.temporada.findUnique({ where: { id: idTemporada }, select: { id: true } });
  if (t === null) throw new ErrorNoEncontrado('Temporada', idTemporada);
}

/** Solicita (crea) un muestrario. `indicadores.ip-muestrarios`. A9. */
export async function crearMuestrario(
  sesion: SesionUsuario,
  entrada: DatosMuestrarioCrear,
  bd?: ContextoBd,
): Promise<MuestrarioSalida> {
  verificarPermiso(sesion, 'indicadores.ip-muestrarios');
  const datos = validarEntrada(esquemaMuestrarioCrear, entrada);
  const idEmpresa = sesion.idEmpresaActiva;
  const fechaSolicitado =
    datos.fechaSolicitado === undefined ? hoyUtc() : fechaAUtc(datos.fechaSolicitado);
  verificarFechaCapturable(sesion, fechaSolicitado);
  const fechaRequerida = fechaAUtc(datos.fechaRequerida);

  return enTransaccion(async (tx) => {
    await exigirCliente(tx, datos.idCliente);
    if (datos.idTemporada !== undefined) await exigirTemporada(tx, datos.idTemporada);
    const creado = await tx.muestrario.create({
      data: {
        idEmpresa,
        idCliente: datos.idCliente,
        categoria: datos.categoria ?? null,
        idTemporada: datos.idTemporada ?? null,
        cantBoards: datos.cantBoards,
        cantMuestras: datos.cantMuestras,
        fechaSolicitado,
        fechaRequerida,
        solicitanteId: sesion.id,
        ...datosCreacion(sesion),
      },
      include: INCLUDE,
    });
    await registrarBitacora(tx, sesion, {
      entidad: 'Muestrario',
      idEntidad: creado.id,
      accion: 'CREAR',
      datos: { idCliente: creado.idCliente, fechaRequerida: datos.fechaRequerida },
    });
    return aSalida(creado);
  }, bd);
}

/** Actualiza el seguimiento de un muestrario (no toca entrega/cancelación). `indicadores.ip-muestrarios`. */
export async function actualizarMuestrario(
  sesion: SesionUsuario,
  id: number,
  entrada: DatosMuestrarioEditar,
  bd?: ContextoBd,
): Promise<MuestrarioSalida> {
  verificarPermiso(sesion, 'indicadores.ip-muestrarios');
  const datos = validarEntrada(esquemaMuestrarioEditar, entrada);
  const idEmpresa = sesion.idEmpresaActiva;
  return enTransaccion(async (tx) => {
    const actual = await exigirMuestrario(tx, id, idEmpresa);
    if (actual.cancelado)
      throw new ErrorConflicto('El muestrario está cancelado; no se puede editar.');

    const cambios: Prisma.MuestrarioUpdateInput = { ...datosModificacion(sesion) };
    if (datos.idCliente !== undefined && datos.idCliente !== actual.idCliente) {
      await exigirCliente(tx, datos.idCliente);
      cambios.cliente = { connect: { id: datos.idCliente } };
    }
    if (datos.idTemporada !== undefined) {
      if (datos.idTemporada === null) {
        cambios.temporada = { disconnect: true };
      } else {
        await exigirTemporada(tx, datos.idTemporada);
        cambios.temporada = { connect: { id: datos.idTemporada } };
      }
    }
    if (datos.categoria !== undefined) cambios.categoria = datos.categoria;
    if (datos.cantBoards !== undefined) cambios.cantBoards = datos.cantBoards;
    if (datos.cantMuestras !== undefined) cambios.cantMuestras = datos.cantMuestras;
    if (datos.fechaRequerida !== undefined)
      cambios.fechaRequerida = fechaAUtc(datos.fechaRequerida);
    if (datos.boardsOK !== undefined) cambios.boardsOK = datos.boardsOK;
    if (datos.muestrasOK !== undefined) cambios.muestrasOK = datos.muestrasOK;

    const actualizado = await tx.muestrario.update({
      where: { id },
      data: cambios,
      include: INCLUDE,
    });
    await registrarBitacora(tx, sesion, {
      entidad: 'Muestrario',
      idEntidad: id,
      accion: 'MODIFICAR',
    });
    return aSalida(actualizado);
  }, bd);
}

/** Registra la entrega de un muestrario (cierra el seguimiento). `indicadores.ip-muestrarios`. */
export async function entregarMuestrario(
  sesion: SesionUsuario,
  id: number,
  entrada: DatosMuestrarioEntregar,
  bd?: ContextoBd,
): Promise<MuestrarioSalida> {
  verificarPermiso(sesion, 'indicadores.ip-muestrarios');
  const datos = validarEntrada(esquemaMuestrarioEntregar, entrada);
  const idEmpresa = sesion.idEmpresaActiva;
  const fechaEntregado =
    datos.fechaEntregado === undefined ? hoyUtc() : fechaAUtc(datos.fechaEntregado);
  verificarFechaCapturable(sesion, fechaEntregado);

  return enTransaccion(async (tx) => {
    const actual = await exigirMuestrario(tx, id, idEmpresa);
    if (actual.cancelado)
      throw new ErrorConflicto('El muestrario está cancelado; no se puede entregar.');
    if (actual.fechaEntregado !== null) throw new ErrorConflicto('El muestrario ya fue entregado.');

    const cambios: Prisma.MuestrarioUpdateInput = {
      fechaEntregado,
      ...datosModificacion(sesion),
    };
    if (datos.boardsOK !== undefined) cambios.boardsOK = datos.boardsOK;
    if (datos.muestrasOK !== undefined) cambios.muestrasOK = datos.muestrasOK;

    const actualizado = await tx.muestrario.update({
      where: { id },
      data: cambios,
      include: INCLUDE,
    });
    await registrarBitacora(tx, sesion, {
      entidad: 'Muestrario',
      idEntidad: id,
      accion: 'MODIFICAR',
      datos: { operacion: 'entregar', fechaEntregado: A_DIA(fechaEntregado) },
    });
    return aSalida(actualizado);
  }, bd);
}

/** Cancela (suave, con motivo) un muestrario. `indicadores.ip-muestrarios`. */
export async function cancelarMuestrario(
  sesion: SesionUsuario,
  id: number,
  entrada: DatosMuestrarioCancelar,
  bd?: ContextoBd,
): Promise<MuestrarioSalida> {
  verificarPermiso(sesion, 'indicadores.ip-muestrarios');
  const datos = validarEntrada(esquemaMuestrarioCancelar, entrada);
  const idEmpresa = sesion.idEmpresaActiva;
  return enTransaccion(async (tx) => {
    const actual = await exigirMuestrario(tx, id, idEmpresa);
    if (actual.cancelado) throw new ErrorConflicto('El muestrario ya está cancelado.');
    const actualizado = await tx.muestrario.update({
      where: { id },
      data: {
        cancelado: true,
        canceladoEn: new Date(),
        canceladoPorId: sesion.id,
        motivoCancelacion: datos.motivo,
        ...datosModificacion(sesion),
      },
      include: INCLUDE,
    });
    await registrarBitacora(tx, sesion, {
      entidad: 'Muestrario',
      idEntidad: id,
      accion: 'CANCELAR',
      datos: { motivo: datos.motivo },
    });
    return aSalida(actualizado);
  }, bd);
}

/** Obtiene un muestrario. `indicadores.ip-muestrarios`. A9. */
export async function obtenerMuestrario(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<MuestrarioSalida> {
  verificarPermiso(sesion, 'indicadores.ip-muestrarios');
  const m = await clienteLectura(bd).muestrario.findUnique({ where: { id }, include: INCLUDE });
  if (m === null || m.idEmpresa !== sesion.idEmpresaActiva)
    throw new ErrorNoEncontrado('Muestrario', id);
  return aSalida(m);
}

/** Filtro `estado` → condición Prisma sobre cancelado/fechaEntregado. */
function whereEstado(estado: EstadoMuestrarioValor): Prisma.MuestrarioWhereInput {
  if (estado === 'cancelado') return { cancelado: true };
  if (estado === 'entregado') return { cancelado: false, fechaEntregado: { not: null } };
  return { cancelado: false, fechaEntregado: null };
}

/** Lista muestrarios (con estado/aTiempo derivados) de la empresa activa. `indicadores.ip-muestrarios`. A9. */
export async function listarMuestrarios(
  sesion: SesionUsuario,
  parametros: z.input<typeof esquemaMuestrariosQuery> = {},
  bd?: ContextoBd,
): Promise<MuestrariosPagina> {
  verificarPermiso(sesion, 'indicadores.ip-muestrarios');
  const filtros: MuestrariosQuery = validarEntrada(esquemaMuestrariosQuery, parametros);
  const where: Prisma.MuestrarioWhereInput = {
    idEmpresa: sesion.idEmpresaActiva,
    ...(filtros.estado === undefined ? {} : whereEstado(filtros.estado)),
    ...(filtros.idCliente === undefined ? {} : { idCliente: filtros.idCliente }),
    ...(filtros.desde === undefined && filtros.hasta === undefined
      ? {}
      : {
          fechaRequerida: {
            ...(filtros.desde === undefined ? {} : { gte: fechaAUtc(filtros.desde) }),
            ...(filtros.hasta === undefined ? {} : { lte: fechaAUtc(filtros.hasta) }),
          },
        }),
  };
  const cliente = clienteLectura(bd);
  const [total, datos] = await Promise.all([
    cliente.muestrario.count({ where }),
    cliente.muestrario.findMany({
      where,
      orderBy: [{ fechaRequerida: 'asc' }, { id: 'asc' }],
      include: INCLUDE,
      ...rangoPrisma(filtros),
    }),
  ]);
  const pagina: Pagina<MuestrarioConRelaciones> = armarPagina(datos, total, filtros);
  return { ...pagina, datos: pagina.datos.map(aSalida) };
}

/** KPI de cumplimiento de muestrarios (agregado en SQL, sobre vivos). `indicadores.ip-muestrarios`. A9. */
export async function cumplimientoMuestrarios(
  sesion: SesionUsuario,
  parametros: z.input<typeof esquemaMuestrariosCumplimientoQuery> = {},
  bd?: ContextoBd,
): Promise<MuestrariosCumplimiento> {
  verificarPermiso(sesion, 'indicadores.ip-muestrarios');
  const filtros: MuestrariosCumplimientoQuery = validarEntrada(
    esquemaMuestrariosCumplimientoQuery,
    parametros,
  );
  const idEmpresa = sesion.idEmpresaActiva;
  const cliente = clienteLectura(bd);

  const cond: Prisma.Sql[] = [
    Prisma.sql`m."id_empresa" = ${idEmpresa}`,
    Prisma.sql`m."cancelado" = FALSE`,
  ];
  if (filtros.idCliente !== undefined) cond.push(Prisma.sql`m."id_cliente" = ${filtros.idCliente}`);
  if (filtros.desde !== undefined)
    cond.push(Prisma.sql`m."fecha_requerida" >= ${fechaAUtc(filtros.desde)}`);
  if (filtros.hasta !== undefined)
    cond.push(Prisma.sql`m."fecha_requerida" <= ${fechaAUtc(filtros.hasta)}`);
  const where = Prisma.join(cond, ' AND ');

  const [fila] = await cliente.$queryRaw<
    { total: number; pendientes: number; entregados: number; aTiempo: number }[]
  >(Prisma.sql`
    SELECT
      COUNT(*)::int AS "total",
      COUNT(*) FILTER (WHERE m."fecha_entregado" IS NULL)::int AS "pendientes",
      COUNT(*) FILTER (WHERE m."fecha_entregado" IS NOT NULL)::int AS "entregados",
      COUNT(*) FILTER (
        WHERE m."fecha_entregado" IS NOT NULL AND m."fecha_entregado" <= m."fecha_requerida"
      )::int AS "aTiempo"
    FROM "muestrarios" m
    WHERE ${where}
  `);

  const entregados = fila?.entregados ?? 0;
  const aTiempo = fila?.aTiempo ?? 0;
  return {
    total: fila?.total ?? 0,
    pendientes: fila?.pendientes ?? 0,
    entregados,
    aTiempo,
    tarde: entregados - aTiempo,
    porcentaje: entregados > 0 ? Math.round((aTiempo / entregados) * 10000) / 10000 : null,
  };
}
