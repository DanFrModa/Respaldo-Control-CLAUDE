/**
 * Resolución de la modalidad de FACTURACIÓN de un movimiento EsMa (F6-E4, decisión (h); doc
 * 07-EsMa §6). Cada movimiento (cargo/abono/descuento/pago) lleva un flag `conFactura`; la
 * modalidad del PROVEEDOR (`ModalidadFacturacion`) decide cómo se fija:
 *  • `solo_con`  → siempre CON factura (true), sin importar lo que envíe el usuario;
 *  • `solo_sin`  → siempre SIN factura (false);
 *  • `ambos`     → el usuario DEBE elegir (con/sin) — un proveedor que factura de las dos formas
 *                  lleva dos estados de cuenta (E5), así que el movimiento no puede quedar ambiguo;
 *  • `null`      → sin definir: se usa lo que envíe el usuario (o `null` si no envió nada).
 *
 * Lógica de negocio (A1): la usan `cargos`, `movimientos` y `pagos` para no duplicar la regla.
 */
import { ErrorValidacion } from '../../comun/errores.js';

/** Valores de la modalidad de facturación del proveedor (espejo del enum Prisma). */
export type ModalidadFacturacion = 'solo_con' | 'solo_sin' | 'ambos';

/**
 * Fija el `conFactura` de un movimiento según la modalidad del proveedor y el valor solicitado.
 * Lanza `ErrorValidacion` si el proveedor es `ambos` y no se indicó con/sin factura.
 */
export function resolverConFactura(
  modalidad: ModalidadFacturacion | null,
  solicitado: boolean | undefined,
): boolean | null {
  switch (modalidad) {
    case 'solo_con':
      return true;
    case 'solo_sin':
      return false;
    case 'ambos':
      if (solicitado === undefined) {
        throw new ErrorValidacion(
          'El proveedor factura de las dos formas: indica si este movimiento es con o sin factura.',
        );
      }
      return solicitado;
    default:
      // Sin modalidad definida: se respeta lo enviado (o queda sin definir).
      return solicitado ?? null;
  }
}
