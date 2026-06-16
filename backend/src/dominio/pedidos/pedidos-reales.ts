/**
 * Pedidos reales — Módulo PEDIDOS (F2-E1): cada LIBERACIÓN real del cliente contra un pedido
 * interno (doc `Documentacion_MJD/02-Pedidos.md` §1 y §4.4). Un pedido interno tiene varios
 * pedidos reales en el tiempo, cada uno con su CEDIS, apertura y fechas, y un detalle por
 * renglón con las cantidades pedida/enviada/entregada.
 *
 * Innegociables:
 *  • A1 — lógica aquí; las rutas validan permiso + Zod y delegan.
 *  • A2 — crear un pedido real = encabezado + réplica de TODOS los renglones del pedido interno
 *    en UNA transacción (doc 02 §4.4: "replica automáticamente un renglón en PedidosRealesDet
 *    por cada renglón del pedido interno"). Sustituye el viejo, que insertaba el encabezado, leía
 *    el Max(id) y luego insertaba el detalle sin transacción.
 *  • A7 — auditoría + bitácora en la misma transacción.
 *  • A9 — el pedido real cuelga de un pedido de la EMPRESA ACTIVA (se valida la pertenencia).
 *
 * Identidad: el pedido real NO lleva folio interno por secuencia (el viejo solo usaba el
 * autonumérico `IdPedidosReales`; la PK `id` cumple ese rol). De cara al cliente se identifica
 * por `numPedReal` (su número de pedido), texto libre.
 *
 * Permiso: `pedidos-reales.administrar` para crear/editar/seguimiento; `pedidos.ver` para leer.
 * El ocultamiento de importes (`precio`) reutiliza `pedidos.importes` (mismo criterio, doc 02 §3).
 *
 * NOTA DIFERIDA (F2-E1): la CANCELACIÓN del pedido real está pendiente de decisión de Daniel;
 * no se construye en esta etapa (sin servicio, sin campo). Ver el TODO más abajo.
 */
import {
  esquemaPedidoRealCrear,
  esquemaPedidoRealEditar,
  esquemaPedidoRealSeguimientoCuerpo,
} from '../../contrato/esquemas/pedido.js';
import type { PedidoRealSalida } from '../../contrato/esquemas/pedido.js';
import type { PedidoReal, PedidoRealLinea, Prisma } from '../../datos/index.js';
import type { z } from 'zod';

import { datosCreacion, datosModificacion, registrarBitacora } from '../../comun/auditoria.js';
import { ErrorConflicto, ErrorNoEncontrado, ErrorValidacion } from '../../comun/errores.js';
import { tienePermiso, verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import {
  clienteLectura,
  enTransaccion,
  type ContextoBd,
  type Tx,
} from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';

/** Alta de pedido real: el encabezado (los renglones los replica el dominio). */
export type EntradaCrearPedidoReal = z.input<typeof esquemaPedidoRealCrear>;
/** Edición del encabezado del pedido real. */
export type EntradaActualizarPedidoReal = z.input<typeof esquemaPedidoRealEditar>;
/** Cuerpo del seguimiento por renglón. */
export type EntradaSeguimientoPedidoReal = z.input<typeof esquemaPedidoRealSeguimientoCuerpo>;

/** Pedido real con sus renglones (cada uno con el renglón del pedido interno y su modelo). */
type PedidoRealConDetalle = PedidoReal & {
  lineas: (PedidoRealLinea & {
    pedidoLinea: {
      idModelo: number;
      cantidadPedida: number;
      precio: Prisma.Decimal;
      modelo: { codigo: string; descripcion: string | null };
    };
  })[];
};

/** `include` estándar: los renglones (ordenados por id) con su renglón interno y modelo. */
const incluirDetalle = {
  lineas: {
    orderBy: { id: 'asc' },
    include: {
      pedidoLinea: {
        select: {
          idModelo: true,
          cantidadPedida: true,
          precio: true,
          modelo: { select: { codigo: true, descripcion: true } },
        },
      },
    },
  },
} satisfies Prisma.PedidoRealInclude;

/** Exige que el pedido interno exista y pertenezca a la empresa activa (A9). */
async function exigirPedidoDeEmpresa(tx: Tx, idPedido: number, idEmpresa: number): Promise<void> {
  const pedido = await tx.pedido.findFirst({
    where: { id: idPedido, idEmpresa },
    select: { id: true, pedCancelado: true, folio: true },
  });
  if (pedido === null) {
    throw new ErrorNoEncontrado('Pedido', idPedido);
  }
  if (pedido.pedCancelado) {
    throw new ErrorConflicto(
      `El pedido ${Number(pedido.folio)} está cancelado; no se le pueden crear pedidos reales.`,
    );
  }
}

/**
 * Exige que el pedido real exista y cuelgue de un pedido de la EMPRESA ACTIVA (A9). Devuelve el
 * id del pedido interno (para la bitácora). Un pedido real de otra empresa no existe para esta sesión.
 */
async function exigirPedidoReal(tx: Tx, id: number, idEmpresa: number): Promise<PedidoReal> {
  const real = await tx.pedidoReal.findFirst({
    where: { id, pedido: { idEmpresa } },
  });
  if (real === null) {
    throw new ErrorNoEncontrado('Pedido real', id);
  }
  return real;
}

/** Proyecta un pedido real (con detalle) a la salida JSON; oculta `precio` sin `pedidos.importes`. */
function aPedidoRealSalida(
  real: PedidoRealConDetalle,
  puedeVerImportes: boolean,
): PedidoRealSalida {
  return {
    id: real.id,
    idPedido: real.idPedido,
    numPedReal: real.numPedReal,
    cedis: real.cedis,
    apertura: real.apertura,
    fechaPedPR: aFechaIso(real.fechaPedPR),
    fechaInicio: aFechaIso(real.fechaInicio),
    fechaFin: aFechaIso(real.fechaFin),
    fechaEntregadaReal: aFechaIso(real.fechaEntregadaReal),
    lineas: real.lineas.map((l) => ({
      id: l.id,
      idPedidoLinea: l.idPedidoLinea,
      idModelo: l.pedidoLinea.idModelo,
      codigoModelo: l.pedidoLinea.modelo.codigo,
      descripcionModelo: l.pedidoLinea.modelo.descripcion,
      cantidadPedida: l.pedidoLinea.cantidadPedida,
      precio: puedeVerImportes ? l.pedidoLinea.precio.toNumber() : null,
      cantidadPR: l.cantidadPR,
      cantidadEnviada: l.cantidadEnviada,
      cantidadEntregadaReal: l.cantidadEntregadaReal,
      empaques: l.empaques,
    })),
    creadoEn: real.creadoEn.toISOString(),
    creadoPorId: real.creadoPorId,
    modificadoEn: real.modificadoEn.toISOString(),
    modificadoPorId: real.modificadoPorId,
  };
}

/** Convierte un `DateTime @db.Date` a `YYYY-MM-DD`, o `null`. */
function aFechaIso(fecha: Date | null): string | null {
  return fecha === null ? null : fecha.toISOString().slice(0, 10);
}

/** Convierte un `YYYY-MM-DD` (o null/undefined) al `Date` de la columna `@db.Date`. */
function aDateColumna(valor: string | null | undefined): Date | null | undefined {
  if (valor === undefined) return undefined;
  if (valor === null) return null;
  return new Date(`${valor}T00:00:00.000Z`);
}

/** Normaliza un texto opcional del alta (trim ya aplicado por Zod; vacío → null). */
function aTexto(valor: string | null | undefined): string | null | undefined {
  if (valor === undefined) return undefined;
  if (valor === null || valor === '') return null;
  return valor;
}

/**
 * Crea un pedido real a partir de un pedido interno (doc 02 §4.4): inserta el encabezado y
 * REPLICA automáticamente un `PedidoRealLinea` por cada `PedidoLinea` del pedido interno, todo
 * en UNA transacción (A2). Requiere `pedidos-reales.administrar`. Las cantidades del detalle
 * nacen en 0 (se capturan en el seguimiento).
 */
export async function crearPedidoReal(
  sesion: SesionUsuario,
  idPedido: number,
  entrada: EntradaCrearPedidoReal,
  bd?: ContextoBd,
): Promise<PedidoRealSalida> {
  verificarPermiso(sesion, 'pedidos-reales.administrar');
  const datos = validarEntrada(esquemaPedidoRealCrear, entrada);

  const idReal = await enTransaccion(async (tx) => {
    await exigirPedidoDeEmpresa(tx, idPedido, sesion.idEmpresaActiva);

    const lineasInternas = await tx.pedidoLinea.findMany({
      where: { idPedido },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    if (lineasInternas.length === 0) {
      throw new ErrorConflicto(
        'El pedido no tiene renglones; agrégale modelos antes de crear un pedido real.',
      );
    }

    const real = await tx.pedidoReal.create({
      data: {
        idPedido,
        numPedReal: aTexto(datos.numPedReal) ?? null,
        cedis: aTexto(datos.cedis) ?? null,
        apertura: aTexto(datos.apertura) ?? null,
        fechaPedPR: aDateColumna(datos.fechaPedPR) ?? null,
        fechaInicio: aDateColumna(datos.fechaInicio) ?? null,
        fechaFin: aDateColumna(datos.fechaFin) ?? null,
        ...datosCreacion(sesion),
      },
    });

    // Réplica automática: un renglón por cada renglón del pedido interno (cantidades en 0).
    await tx.pedidoRealLinea.createMany({
      data: lineasInternas.map((l) => ({
        idPedidoReal: real.id,
        idPedidoLinea: l.id,
        creadoPorId: sesion.id,
        modificadoPorId: sesion.id,
      })),
    });

    await registrarBitacora(tx, sesion, {
      entidad: 'PedidoReal',
      idEntidad: real.id,
      accion: 'CREAR',
      datos: { idPedido, renglones: lineasInternas.length, numPedReal: datos.numPedReal ?? null },
    });

    return real.id;
  }, bd);

  return obtenerPedidoReal(sesion, idReal, bd);
}

/**
 * Actualiza el ENCABEZADO de un pedido real (número/CEDIS/apertura/fechas + fechaEntregadaReal)
 * en UNA transacción. Requiere `pedidos-reales.administrar`. Los renglones se capturan con
 * `actualizarSeguimientoPedidoReal`.
 */
export async function actualizarPedidoReal(
  sesion: SesionUsuario,
  id: number,
  entrada: EntradaActualizarPedidoReal,
  bd?: ContextoBd,
): Promise<PedidoRealSalida> {
  verificarPermiso(sesion, 'pedidos-reales.administrar');
  const datos = validarEntrada(esquemaPedidoRealEditar, entrada);

  await enTransaccion(async (tx) => {
    await exigirPedidoReal(tx, id, sesion.idEmpresaActiva);

    const cambios: Prisma.PedidoRealUpdateInput = { ...datosModificacion(sesion) };
    if (datos.numPedReal !== undefined) cambios.numPedReal = aTexto(datos.numPedReal) ?? null;
    if (datos.cedis !== undefined) cambios.cedis = aTexto(datos.cedis) ?? null;
    if (datos.apertura !== undefined) cambios.apertura = aTexto(datos.apertura) ?? null;
    if (datos.fechaPedPR !== undefined) cambios.fechaPedPR = aDateColumna(datos.fechaPedPR) ?? null;
    if (datos.fechaInicio !== undefined)
      cambios.fechaInicio = aDateColumna(datos.fechaInicio) ?? null;
    if (datos.fechaFin !== undefined) cambios.fechaFin = aDateColumna(datos.fechaFin) ?? null;
    if (datos.fechaEntregadaReal !== undefined)
      cambios.fechaEntregadaReal = aDateColumna(datos.fechaEntregadaReal) ?? null;

    await tx.pedidoReal.update({ where: { id }, data: cambios });
    await registrarBitacora(tx, sesion, {
      entidad: 'PedidoReal',
      idEntidad: id,
      accion: 'MODIFICAR',
      datos: { encabezado: true },
    });
  }, bd);

  return obtenerPedidoReal(sesion, id, bd);
}

/**
 * Captura el SEGUIMIENTO por renglón de un pedido real (cantidadPR/cantidadEnviada/
 * cantidadEntregadaReal/empaques), en UNA transacción (A2). Solo se tocan los renglones que
 * vengan en el cuerpo (por su `id`); cada uno debe pertenecer a ESTE pedido real. Requiere
 * `pedidos-reales.administrar`. NO altera el modelo/precio (esos vienen del renglón interno).
 */
export async function actualizarSeguimientoPedidoReal(
  sesion: SesionUsuario,
  id: number,
  entrada: EntradaSeguimientoPedidoReal,
  bd?: ContextoBd,
): Promise<PedidoRealSalida> {
  verificarPermiso(sesion, 'pedidos-reales.administrar');
  const datos = validarEntrada(esquemaPedidoRealSeguimientoCuerpo, entrada);

  await enTransaccion(async (tx) => {
    await exigirPedidoReal(tx, id, sesion.idEmpresaActiva);

    const propias = await tx.pedidoRealLinea.findMany({
      where: { idPedidoReal: id },
      select: { id: true },
    });
    const idsPropias = new Set(propias.map((l) => l.id));

    for (const linea of datos.lineas) {
      if (!idsPropias.has(linea.id)) {
        throw new ErrorValidacion(
          `El renglón ${String(linea.id)} no pertenece a este pedido real.`,
        );
      }
      const cambios: Prisma.PedidoRealLineaUpdateInput = { ...datosModificacion(sesion) };
      if (linea.cantidadPR !== undefined) cambios.cantidadPR = linea.cantidadPR;
      if (linea.cantidadEnviada !== undefined) cambios.cantidadEnviada = linea.cantidadEnviada;
      if (linea.cantidadEntregadaReal !== undefined)
        cambios.cantidadEntregadaReal = linea.cantidadEntregadaReal;
      if (linea.empaques !== undefined) cambios.empaques = linea.empaques;
      await tx.pedidoRealLinea.update({ where: { id: linea.id }, data: cambios });
    }

    await registrarBitacora(tx, sesion, {
      entidad: 'PedidoReal',
      idEntidad: id,
      accion: 'MODIFICAR',
      datos: { seguimiento: datos.lineas.length },
    });
  }, bd);

  return obtenerPedidoReal(sesion, id, bd);
}

// TODO(F2-E1 diferido): cancelación de PedidoReal pendiente de decisión de Daniel.
// No se construye el servicio `cancelarPedidoReal` (ni su ruta, ni botón en UI, ni el campo
// `cancelado` en `PedidoReal`) hasta que se confirme la política de cancelación del pedido real.

/** Obtiene un pedido real (con su detalle) de la empresa activa, o lanza `ErrorNoEncontrado`. */
export async function obtenerPedidoReal(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<PedidoRealSalida> {
  verificarPermiso(sesion, 'pedidos.ver');
  const real = await clienteLectura(bd).pedidoReal.findFirst({
    where: { id, pedido: { idEmpresa: sesion.idEmpresaActiva } },
    include: incluirDetalle,
  });
  if (real === null) {
    throw new ErrorNoEncontrado('Pedido real', id);
  }
  return aPedidoRealSalida(real, tienePermiso(sesion, 'pedidos.importes'));
}

/**
 * Lista los pedidos reales de un pedido interno (de la empresa activa), ordenados por id.
 * Requiere `pedidos.ver`. Exige que el pedido exista y sea de la empresa activa (A9).
 */
export async function listarPedidosReales(
  sesion: SesionUsuario,
  idPedido: number,
  bd?: ContextoBd,
): Promise<PedidoRealSalida[]> {
  verificarPermiso(sesion, 'pedidos.ver');
  const cliente = clienteLectura(bd);
  const pedido = await cliente.pedido.findFirst({
    where: { id: idPedido, idEmpresa: sesion.idEmpresaActiva },
    select: { id: true },
  });
  if (pedido === null) {
    throw new ErrorNoEncontrado('Pedido', idPedido);
  }
  const reales = await cliente.pedidoReal.findMany({
    where: { idPedido },
    include: incluirDetalle,
    orderBy: { id: 'asc' },
  });
  const puedeVerImportes = tienePermiso(sesion, 'pedidos.importes');
  return reales.map((r) => aPedidoRealSalida(r, puedeVerImportes));
}
