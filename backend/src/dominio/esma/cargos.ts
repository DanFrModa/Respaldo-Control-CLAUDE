/**
 * CARGOS EsMa — cola de validación derivada de los recibos (F3-E4; doc 07-EsMa §2). Toda la lógica
 * de negocio vive AQUÍ (A1); las rutas REST solo validan permiso + Zod y delegan.
 *
 * Un recibo de maquila crea un `EsMaCargo` en estado `propuesto` (F3-E4 `registrarReciboMaquila`):
 * la CANTIDAD propuesta se DERIVA del recibo (piezas recibidas) y el PRECIO propuesto del envío (que
 * puede ser NULL). El admin VALIDA el cargo fijando la cantidad y el precio REALES (punto de control
 * humano conservado de v1). El estado de cuenta completo (abonos, saldos) es de F6: aquí solo la
 * cola de validación.
 *
 * Innegociables: A1 (lógica aquí), A2 (la validación es una transacción), A4 (`esma.cargo-validar`),
 * A7 (bitácora), A9 (empresa activa). NO toca kardex (D3 no aplica: el cargo es CxP de maquila).
 */
import {
  esquemaCargoEsMaValidarCuerpo,
  esquemaCargosEsMaQuery,
  type CargoEsMaSalida,
  type CargosEsMaLista,
} from '../../contrato/index.js';
import { type Prisma } from '../../datos/index.js';
import type { z } from 'zod';

import { datosModificacion, registrarBitacora } from '../../comun/auditoria.js';
import { ErrorConflicto, ErrorNoEncontrado } from '../../comun/errores.js';
import { verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import { clienteLectura, enTransaccion, type ContextoBd } from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';

/** `include` para proyectar un cargo con sus nombres legibles y la cantidad recibida (propuesta). */
const incluirCargo = {
  maquilero: { select: { nombre: true } },
  orden: { select: { folio: true } },
  tipoProceso: { select: { nombre: true } },
  etapaRecibo: {
    select: {
      folio: true,
      precioPactado: true,
      detalles: { select: { cantidad: true } },
    },
  },
} satisfies Prisma.EsMaCargoInclude;

type CargoConDetalle = Prisma.EsMaCargoGetPayload<{ include: typeof incluirCargo }>;

/**
 * Proyecta un cargo a la forma JSON del contrato. La cantidad/precio PROPUESTOS se DERIVAN del
 * recibo (cantidad = Σ del detalle del recibo; precio = precioPactado del recibo) — el cargo solo
 * persiste lo REAL que el admin validó (NULL mientras esté propuesto). El importe propuesto es null
 * si el recibo no traía precio.
 */
function aCargoSalida(c: CargoConDetalle): CargoEsMaSalida {
  const cantidadPropuesta = (c.etapaRecibo?.detalles ?? []).reduce((s, d) => s + d.cantidad, 0);
  const precioPropuesto =
    c.etapaRecibo?.precioPactado == null ? null : c.etapaRecibo.precioPactado.toNumber();
  const importePropuesto = precioPropuesto === null ? null : cantidadPropuesta * precioPropuesto;
  const cantidadReal = c.cantidadReal === null ? null : c.cantidadReal.toNumber();
  const precioReal = c.precioReal === null ? null : c.precioReal.toNumber();
  const importeReal =
    cantidadReal === null || precioReal === null ? null : cantidadReal * precioReal;

  return {
    id: c.id,
    idEmpresa: c.idEmpresa,
    idEtapaRecibo: c.idEtapaRecibo,
    folioRecibo: c.etapaRecibo === null ? null : Number(c.etapaRecibo.folio),
    idMaquilero: c.idMaquilero,
    maquilero: c.maquilero.nombre,
    idOrden: c.idOrden,
    folioOrden: Number(c.orden.folio),
    idTipoProceso: c.idTipoProceso,
    tipoProceso: c.tipoProceso.nombre,
    cantidadPropuesta,
    precioPropuesto,
    importePropuesto,
    cantidadReal,
    precioReal,
    importeReal,
    estado: c.estado,
    observaciones: c.observaciones,
    validadoEn: c.validadoEn === null ? null : c.validadoEn.toISOString(),
    validadoPorId: c.validadoPorId,
    creadoEn: c.creadoEn.toISOString(),
  };
}

/**
 * Lista la COLA de cargos EsMa de la empresa activa (A9), por estado (default `propuesto`) y opcional
 * por maquilero. Permiso `esma.cargo-validar` (A4): la cola es la herramienta de quien valida.
 * Devuelve las filas + la suma de los importes propuestos (los que tienen precio).
 */
export async function listarCargosEsMa(
  sesion: SesionUsuario,
  parametros: z.input<typeof esquemaCargosEsMaQuery> = {},
  bd?: ContextoBd,
): Promise<CargosEsMaLista> {
  verificarPermiso(sesion, 'esma.cargo-validar');
  const filtros = validarEntrada(esquemaCargosEsMaQuery, parametros);
  const cliente = clienteLectura(bd);

  const cargos = await cliente.esMaCargo.findMany({
    where: {
      idEmpresa: sesion.idEmpresaActiva,
      estado: filtros.estado,
      ...(filtros.idMaquilero === undefined ? {} : { idMaquilero: filtros.idMaquilero }),
    },
    orderBy: [{ creadoEn: 'desc' }, { id: 'desc' }],
    include: incluirCargo,
  });

  const filas = cargos.map(aCargoSalida);
  const totalImportePropuesto = filas.reduce((s, f) => s + (f.importePropuesto ?? 0), 0);
  return { filas, totalImportePropuesto };
}

/** Obtiene un cargo de la empresa activa (A9), o lanza `ErrorNoEncontrado`. */
export async function obtenerCargoEsMa(
  sesion: SesionUsuario,
  idCargo: number,
  bd?: ContextoBd,
): Promise<CargoEsMaSalida> {
  verificarPermiso(sesion, 'esma.cargo-validar');
  const cargo = await clienteLectura(bd).esMaCargo.findFirst({
    where: { id: idCargo, idEmpresa: sesion.idEmpresaActiva },
    include: incluirCargo,
  });
  if (cargo === null) {
    throw new ErrorNoEncontrado('EsMaCargo', idCargo);
  }
  return aCargoSalida(cargo);
}

/**
 * VALIDA un cargo `propuesto` → `validado`, fijando la cantidad y el precio REALES (el admin
 * confirma o ajusta los propuestos). En UNA transacción (A2): actualiza el cargo + bitácora (A7).
 * Solo cargos `propuesto` de la empresa activa (A9). Permiso `esma.cargo-validar` (A4). El estado de
 * cuenta (abonos/saldos) es de F6 — aquí solo se cierra el punto de control humano.
 */
export async function validarCargoEsMa(
  sesion: SesionUsuario,
  idCargo: number,
  cuerpo: z.input<typeof esquemaCargoEsMaValidarCuerpo>,
  bd?: ContextoBd,
): Promise<CargoEsMaSalida> {
  verificarPermiso(sesion, 'esma.cargo-validar');
  const datos = validarEntrada(esquemaCargoEsMaValidarCuerpo, cuerpo);

  await enTransaccion(async (tx) => {
    const cargo = await tx.esMaCargo.findFirst({
      where: { id: idCargo, idEmpresa: sesion.idEmpresaActiva },
      select: { id: true, estado: true },
    });
    if (cargo === null) {
      throw new ErrorNoEncontrado('EsMaCargo', idCargo);
    }
    if (cargo.estado === 'cancelado') {
      throw new ErrorConflicto('Ese cargo está cancelado: no se puede validar.');
    }
    if (cargo.estado === 'validado') {
      throw new ErrorConflicto('Ese cargo ya fue validado.');
    }

    await tx.esMaCargo.update({
      where: { id: idCargo },
      data: {
        cantidadReal: datos.cantidadReal,
        precioReal: datos.precioReal,
        estado: 'validado',
        validadoEn: new Date(),
        validadoPorId: sesion.id,
        ...(datos.observaciones === undefined ? {} : { observaciones: datos.observaciones }),
        ...datosModificacion(sesion),
      },
    });

    await registrarBitacora(tx, sesion, {
      entidad: 'EsMaCargo',
      idEntidad: idCargo,
      accion: 'MODIFICAR',
      datos: {
        accion: 'validar',
        cantidadReal: datos.cantidadReal,
        precioReal: datos.precioReal,
      },
    });
  }, bd);

  return obtenerCargoEsMa(sesion, idCargo, bd);
}
