/**
 * Resolución del TERCERO de un movimiento de cuenta corriente (F9-E1; D15a). El movimiento
 * referencia a un Cliente o a un Proveedor por **tipo + id** (sin tabla `Tercero` polimórfica): aquí
 * se valida que exista y esté activo, y se obtiene su nombre + días de crédito (para el aging, D15d).
 *
 * Días de crédito (D15d): el Proveedor ya lo trae (`diasCredito`, R15). El Cliente AÚN NO tiene el
 * campo (llega en E4) → para clientes se asume CONTADO (0 días) en E1. NO se agrega el campo al
 * Cliente aquí (fuera del alcance de E1).
 */
import { ErrorConflicto, ErrorNoEncontrado } from '../../comun/errores.js';
import { type Tx } from '../../comun/transaccion.js';
import { type PrismaClient, type TipoTercero } from '../../datos/index.js';

/** Datos del tercero ya resueltos y validados. */
export interface TerceroResuelto {
  tipoTercero: TipoTercero;
  /** Id del Cliente o Proveedor. */
  idTercero: number;
  nombre: string;
  /** Días de crédito para el aging (D15d). 0 = contado. Cliente: 0 en E1 (campo llega en E4). */
  diasCredito: number;
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
      select: { nombre: true, activo: true },
    });
    if (cliente === null) {
      throw new ErrorNoEncontrado('Cliente', idTercero);
    }
    if (!cliente.activo) {
      throw new ErrorConflicto(`El cliente "${cliente.nombre}" está desactivado.`);
    }
    // El Cliente aún no tiene días de crédito (llega en E4): contado en E1.
    return { tipoTercero, idTercero, nombre: cliente.nombre, diasCredito: 0 };
  }

  const proveedor = await tx.proveedor.findUnique({
    where: { id: idTercero },
    select: { nombre: true, activo: true, diasCredito: true },
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
