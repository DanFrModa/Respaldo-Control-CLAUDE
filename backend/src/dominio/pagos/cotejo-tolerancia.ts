/**
 * ⭐ LA TOLERANCIA DEL COTEJO — **DEFINICIÓN ÚNICA** (fila 0.117, §Post-F9.232 (b)).
 *
 * Daniel, textual: *«está bien con 1 peso de diferencia»*.
 *
 * ## UN PESO FIJO. Sin porcentaje. Y no es un detalle de redondeo
 * El default que se le propuso era «0.5 % con piso de un peso» y **lo dejó más estricto a
 * propósito**. Tiene sentido y conviene entenderlo antes de tocar este archivo: la factura del
 * proveedor **sale del documento que nosotros le emitimos** (§Post-F9.186(k): *«nadie me factura si
 * no le mando yo un documento con los datos con los que me tiene que facturar»*), así que separarse
 * más de un peso no significa que alguien redondeó — significa que **algo no cuadra de verdad**.
 *
 * 🔴 **PROHIBIDO deducir un porcentaje aquí.** La decisión lo prohíbe con todas sus letras: *«si
 * alguna vez aparece el matiz del porcentaje, se pregunta otra vez antes de programarlo: no se
 * deduce»*. Si algún día hace falta, se pregunta y se cambia AQUÍ, en un solo sitio.
 *
 * ## Por qué vive solo, en su propio archivo
 * Este repo ya se quemó con la misma decisión escrita en varios lugares: la fórmula del saldo
 * llegó a estar copiada **tres veces** hasta que nació `esma/formula-saldo.ts`, y la corrida tenía
 * su propio `Math.abs(saldo) >= 0.005` a mano (ver el comentario de `pagos/corrida.ts` sobre
 * `tieneSaldo`). Una tolerancia repartida es una tolerancia que un día dice cosas distintas en dos
 * pantallas del mismo número. Quien compare una factura con un documento **pide la respuesta aquí**.
 *
 * ## Los dos lados son el TOTAL CON IVA
 * Lo que imprime el documento (`documento-facturacion.ts`: el `monto` del renglón *«es el TOTAL con
 * IVA»*) y lo que trae el CFDI (`parser-cfdi.ts`: el `total` del comprobante). Misma unidad en los
 * dos lados, así que la comparación es directa y no hay que desglosar nada para hacerla.
 */

/**
 * La tolerancia del cotejo, EN PESOS. Un peso exacto, y lo que empata **cuadra** (`<=`): el caso
 * que Daniel nombró —«1 peso de diferencia»— es de los que aceptan, no de los que frenan un pago.
 */
export const TOLERANCIA_COTEJO_PESOS = 1;

/** Redondeo monetario a 2 decimales (mismo criterio que el resto del sistema). */
function redondear2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * La diferencia ABSOLUTA entre lo que la factura dice y lo que amparan los documentos aplicados,
 * ya redondeada a centavos. Se redondea ANTES de comparar para que un residuo de coma flotante
 * (0.30000000000000004) no convierta un cotejo exacto en un descuadre de una diezmillonésima.
 */
export function diferenciaDeCotejo(totalFactura: number, totalAplicado: number): number {
  return Math.abs(redondear2(redondear2(totalFactura) - redondear2(totalAplicado)));
}

/**
 * ⭐ ¿Cuadra? La única pregunta que este módulo contesta, y la única forma válida de contestarla.
 *
 * @param totalFactura  total CON IVA del CFDI (siempre positivo: el signo del movimiento no entra).
 * @param totalAplicado suma de lo aplicado a documentos emitidos.
 */
export function cotejoCuadra(totalFactura: number, totalAplicado: number): boolean {
  return diferenciaDeCotejo(totalFactura, totalAplicado) <= TOLERANCIA_COTEJO_PESOS;
}
