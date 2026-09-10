/**
 * SEGMENTACIÓN CON/SIN FACTURA de las cuentas por pagar (V1-E3f pieza B — §Post-F9.57).
 *
 * Daniel, levantando el punto que él mismo había diferido: *"En el punto 6 dijiste que lo dejamos
 * para después, pero si quieres de una vez… hay proveedores de avíos o de telas que puede pasar que
 * algunas cosas sean con factura y otras sin factura."*
 *
 * Eso CAMBIA el alcance: la partición deja de ser un asunto de talleres (EsMa) y pasa a ser general
 * del proveedor. Lo que ya existía **se reusa, no se reinventa**:
 *  • `Proveedor.modalidadFacturacion` (`solo_con`/`solo_sin`/`ambos`) — F6-E4 decisión (h).
 *  • `resolverConFactura` (`dominio/esma/facturacion.ts`) — la regla de cómo la modalidad manda
 *    sobre lo que se pidió. **Es la misma regla**, así que se importa; escribir una segunda copia
 *    para CxP es exactamente el defecto que este proyecto ya pagó tres veces.
 *
 * Lo único que CxP agrega es la pieza que EsMa no necesitaba: **un origen puede ser intrínsecamente
 * sin factura**. Ver {@link resolverSegmentoCxp}.
 *
 * DÓNDE VIVE EL SEGMENTO EN CxP: en `MovimientoTercero.esFiscal`, que ya existe y significa
 * exactamente "este movimiento tiene CFDI". No se agrega una columna paralela: el propio motor ya
 * equipara los dos conceptos al proyectar EsMa sobre el libro unificado
 * (`convivencia-esma.ts`: `esFiscal: conFactura === true`). Cero migración.
 */
import type {
  OrigenMovimientoCxpClave,
  SegmentoFacturacionClave,
} from '../../../contrato/index.js';
import type { ModalidadFacturacion } from '../../../datos/index.js';

import { ErrorValidacion } from '../../../comun/errores.js';
import { resolverConFactura } from '../../esma/facturacion.js';
import type { SegmentoFactura } from '../../esma/formula-saldo.js';

/**
 * Orígenes de CxP que son SIN FACTURA por definición, dijera lo que dijera la modalidad del
 * proveedor. `entrada_sin_factura` es la mercancía recibida cuya factura formal todavía no llega
 * (se concilia después, al leer el CFDI): marcarla como fiscal porque el proveedor "siempre
 * factura" metería al reporte del contador un cargo SIN comprobante que lo respalde.
 */
const ORIGENES_SIN_FACTURA: readonly OrigenMovimientoCxpClave[] = ['entrada_sin_factura'];

/**
 * Resuelve si un movimiento de CxP es CON factura. Devuelve siempre un `boolean` porque
 * `MovimientoTercero.esFiscal` no es nullable — y desde la fila 0.110 tampoco hay ya un "sin
 * definir" que convertir: `resolverConFactura` LANZA en vez de devolverlo.
 *
 * Reglas, en orden:
 *  1. **El origen manda sobre la modalidad.** Si el origen es sin-factura por definición, el
 *     movimiento es sin factura. Y si además se pidió lo contrario, NO se corrige en silencio: se
 *     rechaza con un mensaje que dice por qué (D3).
 *  2. **La modalidad manda sobre lo pedido** (regla de EsMa, reusada tal cual):
 *     `solo_con` → con factura · `solo_sin` → sin factura · `ambos` → EXIGE que se indique.
 *  3. **Sin modalidad definida NO se captura** (fila 0.110, §Post-F9.186(a)): lanza
 *     `ErrorValidacion` pidiendo que se defina primero en el catálogo. Antes se respetaba lo que
 *     se hubiera mandado y, si no venía nada, el movimiento nacía SIN factura en silencio — que es
 *     exactamente el caso que Daniel quiere partir en dos, porque decide de dónde sale el pago.
 */
export function resolverSegmentoCxp(
  origen: OrigenMovimientoCxpClave,
  modalidad: ModalidadFacturacion | null,
  solicitado: boolean | undefined,
): boolean {
  if (ORIGENES_SIN_FACTURA.includes(origen)) {
    if (solicitado === true) {
      throw new ErrorValidacion(
        'Una entrada SIN factura no puede marcarse como con factura: su comprobante se concilia ' +
          'después, al capturar el CFDI del proveedor.',
      );
    }
    return false;
  }
  return resolverConFactura(modalidad, solicitado);
}

/**
 * Cláusula `where` del segmento sobre `MovimientoTercero.esFiscal`. `todos` no filtra nada.
 * Espejo exacto del `conFacturaWhere` del estado de cuenta de EsMa.
 */
export function segmentoWhere(segmento: SegmentoFacturacionClave): { esFiscal?: boolean } {
  return segmento === 'todos' ? {} : { esFiscal: segmento === 'con' };
}

/**
 * Traduce el segmento del CONTRATO (`todos` | `con` | `sin`) al del motor de CARTERA
 * (`SegmentoFactura | undefined`, donde `undefined` = no segmentar). Existe para que la partición
 * de Daniel viaje como UN PARÁMETRO y nadie vuelva a escribir el criterio «con/sin» por su cuenta:
 * la bandeja de CxP (fila 0.132) y la corrida semanal de pagos (fila 0.113) piden la MISMA cartera
 * a `carteraCombinadaPorProveedor`, que a su vez aplica en cada fuente su definición única
 * (`es_fiscal` en el motor; `con_factura` de EsMa vía `formula-saldo.ts`, donde el «sin» incluye lo
 * migrado sin definir). Es la misma traducción que `convivencia-esma.ts` ya hacía para EsMa.
 */
export function segmentoCartera(segmento: SegmentoFacturacionClave): SegmentoFactura | undefined {
  return segmento === 'todos' ? undefined : segmento;
}
