/**
 * EL IVA, EN UN SOLO SITIO (fila 0.118) — pieza PURA, sin base de datos.
 *
 * Nació con **el documento para facturar** (§Post-F9.186(k), Daniel: *«nadie me factura si no le
 * mando yo un documento con los datos con los que me tiene que facturar… no al revés»*), donde el
 * IVA tiene que ir **EXPLÍCITO** —no escondido dentro del total, como en el Excel de producción—
 * porque es exactamente lo que el proveedor va a capturar en su factura.
 *
 * ⚠️ **Antes de esto el IVA no existía en el sistema.** Ni en EsMa, ni en pagos, ni en terceros: los
 * importes que se manejan son totales, y el único lugar donde aparecía un impuesto era LEYENDO el
 * XML de un CFDI ajeno (`terceros/cfdi/parser-cfdi.ts`). Por eso la tasa vive aquí sola y no
 * enterrada en un impreso: el día que cambie —o que Daniel decida que algún proveedor va con otra—
 * se toca UN archivo.
 *
 * 🟡 **DECISIÓN CON DEFAULT, PENDIENTE DE CONFIRMAR POR DANIEL** (la propone el lead de la fila
 * 0.118): el `monto` que él teclea en la corrida es **lo que se transfiere**, o sea el **TOTAL con
 * IVA**, y el documento lo parte hacia atrás en subtotal + IVA. La otra lectura posible —que el
 * monto sea el subtotal y el IVA se sume encima— haría que el banco pagara 16 % más de lo tecleado,
 * que es justo lo contrario de lo que la relación ejecutable promete. Si Daniel dice lo contrario,
 * cambia {@link desglosarIva} y nada más.
 *
 * 🟡 **SIN RETENCIONES** en esta primera versión, también pendiente de Daniel. El proveedor sí tiene
 * capturado si se le retiene IVA o ISR (`Proveedor.retieneIva` / `retieneIsr`, F1-E1B), pero
 * retener cambia lo que se le DEPOSITA, no lo que factura, y el monto de la corrida ya es el
 * depósito. Meter retenciones sin que él lo diga movería dinero.
 */

/**
 * Tasa de IVA trasladado, como fracción. 16 % es la tasa general vigente en México (la franja
 * fronteriza del 8 % no aplica a esta empresa; si algún día aplicara, este archivo es el único
 * punto que hay que tocar).
 */
export const TASA_IVA = 0.16;

/** La tasa como se escribe en el documento («16 %»), para no derivarla a mano en cada impreso. */
export const TASA_IVA_TEXTO = `${String(Math.round(TASA_IVA * 100))} %`;

/** Redondeo monetario a 2 decimales (mismo criterio que `dominio/pagos/totales.ts`). */
function redondear2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Un importe partido en sus tres cifras, tal como salen impresas. */
export interface DesgloseIva {
  /** Base gravable, redondeada a 2 decimales. */
  subtotal: number;
  /** IVA trasladado. */
  iva: number;
  /** Lo que se transfiere. Es el dato de entrada, redondeado. */
  total: number;
}

/**
 * Parte un TOTAL (lo que se transfiere) en subtotal + IVA.
 *
 * ⭐ El IVA se calcula **por diferencia**, no como `subtotal × tasa`: así `subtotal + iva === total`
 * SIEMPRE, hasta el centavo. Calcular las dos cifras por separado y redondear cada una deja
 * descuadres de un centavo en los que el proveedor timbra un total distinto al que se le depositó —
 * y entonces la factura no cuadra con la transferencia, que es el problema que este documento vino
 * a resolver.
 *
 * @example desglosarIva(116) // { subtotal: 100, iva: 16, total: 116 }
 * @example desglosarIva(100) // { subtotal: 86.21, iva: 13.79, total: 100 }
 */
export function desglosarIva(total: number): DesgloseIva {
  const totalRedondeado = redondear2(total);
  const subtotal = redondear2(totalRedondeado / (1 + TASA_IVA));
  return { subtotal, iva: redondear2(totalRedondeado - subtotal), total: totalRedondeado };
}
