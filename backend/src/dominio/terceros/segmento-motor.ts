/**
 * SEGMENTO con/sin factura de un movimiento del MOTOR de terceros (fila 0.110, §Post-F9.186(a)).
 *
 * ## La rama gemela que esto cierra
 *
 * `resolverConFactura` (EsMa) tenía una puerta trasera: su `default` devolvía `null` cuando el
 * proveedor no tenía modalidad. Se cerró. Pero el motor de terceros tenía **la misma puerta, en
 * otra pared**: `esquemaMovimientoTerceroCrear.esFiscal` traía `.default(false)`, así que un
 * movimiento de PROVEEDOR capturado sin decir nada nacía marcado SIN factura **en silencio** — y
 * esa marca decide de dónde sale el pago (CON factura → estado de cuenta del banco; SIN factura →
 * la relación que Daniel define, §Post-F9.184(f)). Cerrar sólo EsMa habría pasado en verde.
 *
 * Que la puerta era conocida lo dice el propio proyecto: el esquema de CxP (`esquemas/cxp.ts`) ya
 * había dejado su `esFiscal` en `.optional()` con el comentario *"Un `.default(false)` habría
 * elegido «sin factura» en silencio justo en el caso que Daniel quiere partir en dos"*. El motor se
 * había quedado atrás.
 *
 * ## Por qué NO se re-resuelve lo que el llamador SÍ dijo
 *
 * Regla deliberada: **si el movimiento trae `esFiscal` explícito, se respeta tal cual** (es el
 * comportamiento de hoy, byte por byte). Sólo se deriva cuando falta. Y es a propósito, no pereza:
 * los llamadores internos del motor mandan el valor porque ya lo saben de una fuente MÁS fuerte que
 * la modalidad del catálogo, y re-resolverlo los rompería:
 *
 *  • `cfdi/cfdi-proveedor.ts` y `inventarios/entradas-tela.ts` mandan `esFiscal: true` junto con el
 *    UUID de un CFDI REAL. Un proveedor mal capturado como `solo_sin` degradaría una factura
 *    timbrada a "sin factura" —y el UUID ya quedó consumido para siempre—.
 *  • `cxp/cxp.ts` ya resolvió con {@link resolverSegmentoCxp}, que además aplica la regla de que el
 *    ORIGEN manda sobre la modalidad (`entrada_sin_factura` nunca es fiscal). Re-resolver aquí
 *    desharía esa regla y volvería fiscal una entrada sin comprobante.
 *
 * O sea: **la evidencia manda sobre el catálogo**, igual que en `resolverSegmentoCxp` el origen
 * manda sobre la modalidad. Lo que esta función arregla es el hueco contrario — que NADIE haya
 * dicho nada y el sistema lo diera por "sin factura".
 *
 * ⚠️ REGLA 0-B: no se auditan ni reparan los movimientos ya guardados. Un proveedor migrado sin
 * modalidad se lee, se consulta y aparece en su estado de cuenta con toda normalidad; lo único que
 * no se puede es capturarle un movimiento NUEVO sin clasificar.
 */
import type { TipoTercero } from '../../datos/index.js';

import { resolverConFactura, type ModalidadFacturacion } from '../esma/facturacion.js';

/**
 * Decide el `esFiscal` de un movimiento del motor.
 *
 *  • `solicitado` presente → se respeta (la evidencia del llamador manda; ver el TSDoc del módulo).
 *  • Ausente + CLIENTE → `false`: un cliente no tiene modalidad de facturación que consultar.
 *  • Ausente + PROVEEDOR → lo deriva `resolverConFactura`, que LANZA si el proveedor no tiene
 *    modalidad definida o si factura de las dos formas (ahí nadie más puede decidirlo).
 */
export function resolverEsFiscalMotor(
  tipoTercero: TipoTercero,
  modalidad: ModalidadFacturacion | null,
  solicitado: boolean | undefined,
): boolean {
  if (solicitado !== undefined) {
    return solicitado;
  }
  if (tipoTercero === 'cliente') {
    return false;
  }
  return resolverConFactura(modalidad, undefined);
}
