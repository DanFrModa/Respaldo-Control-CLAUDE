/**
 * Resolución del TERCERO de un movimiento de cuenta corriente (F9-E1; D15a). El movimiento
 * referencia a un Cliente o a un Proveedor por **tipo + id** (sin tabla `Tercero` polimórfica): aquí
 * se valida que exista y esté activo, y se obtiene su nombre + días de crédito (para el aging, D15d).
 *
 * Días de crédito (D15d): lo traen LOS DOS —`Proveedor.diasCredito` (R15) y `Cliente.diasCredito`
 * (F9-E4)—, y aquí se leen IGUAL: `null` (nunca capturado) = **contado, 0 días**. Éste es el ÚNICO
 * lugar donde el alta de un movimiento resuelve el plazo (A1); de ahí sale la fecha de vencimiento
 * que se SELLA en el cargo (`calcularVencimiento`, `cuenta-terceros.ts`) y sobre la que agrupa el
 * aging. Cambiarle después los días al catálogo NO mueve los cargos ya emitidos (§Post-F9.98 (a)/(e)).
 */
import { ErrorConflicto, ErrorNoEncontrado } from '../../comun/errores.js';
import { type Tx } from '../../comun/transaccion.js';
import { type PrismaClient, type TipoTercero } from '../../datos/index.js';

import type { ModalidadFacturacion } from '../esma/facturacion.js';

/** Datos del tercero ya resueltos y validados. */
export interface TerceroResuelto {
  tipoTercero: TipoTercero;
  /** Id del Cliente o Proveedor. */
  idTercero: number;
  nombre: string;
  /** Días de crédito para el aging (D15d). 0 = contado (también cuando el catálogo lo trae en null). */
  diasCredito: number;
  /**
   * Modalidad de facturación del PROVEEDOR (`solo_con`/`solo_sin`/`ambos`), o `null` si todavía no
   * se ha definido. Siempre `null` para un CLIENTE: la modalidad es un atributo del proveedor
   * (decide de dónde sale SU pago, §Post-F9.184(f)), no del cliente.
   *
   * Se resuelve aquí —dentro de la misma transacción que escribe el movimiento— para que el motor
   * pueda derivar el segmento con/sin factura sin una segunda lectura, y para que un cambio
   * concurrente de la modalidad no deje el movimiento marcado con una regla que ya no está vigente.
   */
  modalidadFacturacion: ModalidadFacturacion | null;
}

/**
 * Exige que el tercero (tipo + id) EXISTA y esté ACTIVO en la empresa; devuelve nombre + días de
 * crédito. Los catálogos de Cliente/Proveedor son GLOBALES (ADR-0007): la validación NO acota por
 * empresa (el movimiento sí lleva `idEmpresa`, A9). Lanza `ErrorNoEncontrado`/`ErrorConflicto`.
 */
export async function exigirTercero(
  tx: Tx,
  tipoTercero: TipoTercero,
  idTercero: number,
): Promise<TerceroResuelto> {
  if (tipoTercero === 'cliente') {
    const cliente = await tx.cliente.findUnique({
      where: { id: idTercero },
      select: { nombre: true, activo: true, diasCredito: true },
    });
    if (cliente === null) {
      throw new ErrorNoEncontrado('Cliente', idTercero);
    }
    if (!cliente.activo) {
      throw new ErrorConflicto(`El cliente "${cliente.nombre}" está desactivado.`);
    }
    return {
      tipoTercero,
      idTercero,
      nombre: cliente.nombre,
      diasCredito: cliente.diasCredito ?? 0,
      modalidadFacturacion: null,
    };
  }

  const proveedor = await tx.proveedor.findUnique({
    where: { id: idTercero },
    select: { nombre: true, activo: true, diasCredito: true, modalidadFacturacion: true },
  });
  if (proveedor === null) {
    throw new ErrorNoEncontrado('Proveedor', idTercero);
  }
  if (!proveedor.activo) {
    throw new ErrorConflicto(`El proveedor "${proveedor.nombre}" está desactivado.`);
  }
  return {
    tipoTercero,
    idTercero,
    nombre: proveedor.nombre,
    diasCredito: proveedor.diasCredito ?? 0,
    modalidadFacturacion: proveedor.modalidadFacturacion,
  };
}

/**
 * Nombre de un tercero para LECTURA (saldo/estado de cuenta): NO exige que esté activo —un tercero
 * inactivo puede seguir teniendo saldo que consultar—, solo que exista. Lanza `ErrorNoEncontrado`.
 */
export async function obtenerNombreTercero(
  cliente: Tx | PrismaClient,
  tipoTercero: TipoTercero,
  idTercero: number,
): Promise<string> {
  if (tipoTercero === 'cliente') {
    const cliente_ = await cliente.cliente.findUnique({
      where: { id: idTercero },
      select: { nombre: true },
    });
    if (cliente_ === null) {
      throw new ErrorNoEncontrado('Cliente', idTercero);
    }
    return cliente_.nombre;
  }
  const proveedor = await cliente.proveedor.findUnique({
    where: { id: idTercero },
    select: { nombre: true },
  });
  if (proveedor === null) {
    throw new ErrorNoEncontrado('Proveedor', idTercero);
  }
  return proveedor.nombre;
}
