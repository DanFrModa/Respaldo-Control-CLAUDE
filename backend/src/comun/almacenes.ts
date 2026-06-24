/**
 * Validación de ALMACÉN para los flujos que mueven inventario (F3/F4).
 *
 * Los almacenes pueden ser GLOBALES (`idEmpresa = null`) o PRIVADOS de una empresa (`idEmpresa`
 * con valor). Cualquier operación que reciba/saque/traspase material hacia/desde un almacén DEBE
 * validar, dentro de su transacción y ANTES de escribir, que el almacén exista, esté activo y sea
 * usable por la empresa de la sesión (A9): un almacén privado de OTRA empresa, para esta sesión,
 * no existe. Este helper centraliza esa regla (antes duplicada en `produccion/recibos.ts` y
 * `produccion/entregas-cliente.ts`).
 */
import { ErrorNoEncontrado, ErrorValidacion } from './errores.js';
import type { Tx } from './transaccion.js';

/**
 * Verifica que un almacén exista, esté ACTIVO y sea GLOBAL o de la empresa dada (A9). Lanza
 * `ErrorNoEncontrado` si no existe y `ErrorValidacion` si está desactivado o es de otra empresa.
 * Pensado para llamarse DENTRO de la transacción del flujo, antes de cualquier escritura.
 */
export async function exigirAlmacen(tx: Tx, idAlmacen: number, idEmpresa: number): Promise<void> {
  const almacen = await tx.almacen.findUnique({
    where: { id: idAlmacen },
    select: { activo: true, idEmpresa: true, nombre: true },
  });
  if (almacen === null) {
    throw new ErrorNoEncontrado('Almacen', idAlmacen);
  }
  if (!almacen.activo) {
    throw new ErrorValidacion(`El almacén "${almacen.nombre}" está desactivado.`);
  }
  if (almacen.idEmpresa !== null && almacen.idEmpresa !== idEmpresa) {
    throw new ErrorValidacion(`El almacén "${almacen.nombre}" no es de esta empresa.`);
  }
}
