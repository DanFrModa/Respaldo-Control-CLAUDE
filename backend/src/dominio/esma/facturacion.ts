/**
 * Resolución de la modalidad de FACTURACIÓN de un movimiento EsMa (F6-E4, decisión (h); doc
 * 07-EsMa §6). Cada movimiento (cargo/abono/descuento/pago) lleva un flag `conFactura`; la
 * modalidad del PROVEEDOR (`ModalidadFacturacion`) decide cómo se fija:
 *  • `solo_con`  → siempre CON factura (true), sin importar lo que envíe el usuario;
 *  • `solo_sin`  → siempre SIN factura (false);
 *  • `ambos`     → el usuario DEBE elegir (con/sin) — un proveedor que factura de las dos formas
 *                  lleva dos estados de cuenta (E5), así que el movimiento no puede quedar ambiguo;
 *  • `null`      → **NO SE PUEDE CAPTURAR**: primero hay que definir la modalidad en el catálogo.
 *
 * ⭐ POR QUÉ EL `null` LANZA (fila 0.110, Daniel 3-sep-2026 — §Post-F9.186(a) / §Post-F9.184(f)).
 * Daniel: *"es un campo **obligatorio** de llenar. **A fuerzas hay que definir si es con, sin o
 * ambas**"*. No es una preferencia de vista: la marca con/sin factura decide **DE DÓNDE SALE EL
 * PAGO** —CON factura, el pago nace del estado de cuenta del BANCO; SIN factura, nace de la
 * RELACIÓN que Daniel define y que se ejecuta tal cual—. Un movimiento sin clasificar deja al
 * sistema sin saber por cuál de los dos caminos meter ese pago: **se pierde o se duplica**.
 *
 * Hasta esta fila el `default` hacía `return solicitado ?? null`: un guardián que existía, avisaba,
 * obligaba… **y tenía la salida de emergencia abierta**. Y el `null` no era neutral, porque el
 * segmento "sin factura" de `terceros/convivencia-esma.ts` ya cuenta `conFactura = null` como SIN
 * factura — o sea, el movimiento sin clasificar YA se estaba archivando en silencio de un lado.
 *
 * ⚠️ REGLA 0-B (`CLAUDE.md` §7): esto NO audita ni repara los `null` que ya existen. Los movimientos
 * y proveedores MIGRADOS con la modalidad vacía se **leen** con toda normalidad (estado de cuenta,
 * saldos, impresos, reportes: nada de eso pasa por aquí). Lo único que se prohíbe es **crear un
 * `null` NUEVO**. Daniel: *"yo me encargo de ponerlo bien cuando hagamos la migración de datos
 * reales"*.
 *
 * Lógica de negocio (A1): la usan `cargos`, `movimientos`, `pagos` y —vía `resolverSegmentoCxp`—
 * CxP, para no duplicar la regla.
 */
import { ErrorValidacion } from '../../comun/errores.js';

/** Valores de la modalidad de facturación del proveedor (espejo del enum Prisma). */
export type ModalidadFacturacion = 'solo_con' | 'solo_sin' | 'ambos';

/**
 * Mensaje del proveedor SIN modalidad definida. Se exporta para que los demás puntos de captura
 * (el motor de terceros) digan exactamente lo mismo: una sola frase, no tres parecidas.
 */
export const MENSAJE_SIN_MODALIDAD =
  'Define primero la modalidad de facturación de este proveedor (con factura, sin factura o ' +
  'ambas) en el catálogo de proveedores: sin ella no se sabe si su pago sale del estado de cuenta ' +
  'del banco o de la relación de pagos.';

/** Mensaje del proveedor que factura de las dos formas y no se indicó cuál es este movimiento. */
export const MENSAJE_AMBOS_SIN_ELEGIR =
  'El proveedor factura de las dos formas: indica si este movimiento es con o sin factura.';

/**
 * Fija el `conFactura` de un movimiento según la modalidad del proveedor y el valor solicitado.
 * SIEMPRE devuelve un booleano: no existe el "sin definir". Lanza `ErrorValidacion` si el proveedor
 * es `ambos` y no se indicó con/sin factura, o si el proveedor todavía no tiene modalidad.
 */
export function resolverConFactura(
  modalidad: ModalidadFacturacion | null,
  solicitado: boolean | undefined,
): boolean {
  switch (modalidad) {
    case 'solo_con':
      return true;
    case 'solo_sin':
      return false;
    case 'ambos':
      if (solicitado === undefined) {
        throw new ErrorValidacion(MENSAJE_AMBOS_SIN_ELEGIR);
      }
      return solicitado;
    default:
      // Sin modalidad definida: NO se captura. Ver el TSDoc del módulo (fila 0.110).
      throw new ErrorValidacion(MENSAJE_SIN_MODALIDAD);
  }
}
