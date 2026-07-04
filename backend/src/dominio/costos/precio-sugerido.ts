/**
 * PRECIO DE VENTA SUGERIDO a partir del costo estimado (F7-E1; doc 06-Costos-y-EDR §ListaPreciosEd;
 * DECISIONES.md D2 #3–#5). Función PURA (la ejercitan los tests unitarios), SIN dependencias de BD.
 *
 * El sistema viejo (`ListaPreciosEd.txt`) calculaba: `PrecioVenta = CInt( (costo × 2) / 0.9 )` — TRES
 * factores HARDCODEADOS: utilidad (×2), regalías sobre la VENTA (/0.9 ≡ 10%) y redondeo al más cercano
 * (CInt). v2 los PARAMETRIZA y cambia el redondeo:
 *
 *   precioBase        = costo / (1 − utilidad/100)      // ×2 cuando utilidad = 50 (margen sobre venta)
 *   precioConRegalias = precioBase / (1 − regalias/100) // /0.9 cuando regalías = 10 (sobre la venta, D2 #3)
 *   precioSugerido    = ceil(precioConRegalias)         // AL ALZA (D2 #4), NO el CInt del viejo
 *
 * Con `utilidadSugerida = 50` y `regaliasBase = 10` (ya seedeados desde F0, Propiedades.csv) reproduce
 * EXACTO el `(costo × 2) / 0.9` del viejo salvo el redondeo. Cambiar cualquiera de los dos parámetros
 * (en Administración) cambia el precio: ya no hay ×2 ni /0.9 fijos.
 *
 * Tanto la utilidad como las regalías van SOBRE LA VENTA (estilo margen: se DIVIDE por `1 − %/100`),
 * que es como el precio absorbe ambas — evidenciado por el `/0.9` del viejo (regalías sobre el precio).
 * La correspondencia ×2 ↔ utilidad=50 se valida contra el cálculo manual de Daniel (criterio de cierre).
 */

/** Parámetros parametrizables del precio sugerido (config. por empresa; % en 0–100, < 100). */
export interface ParametrosPrecioSugerido {
  /** % de utilidad SOBRE LA VENTA (viejo ×2 ≡ 50). `ConfiguracionEmpresa.utilidadSugerida`. */
  utilidadSugerida: number;
  /** % de regalías SOBRE LA VENTA (viejo /0.9 ≡ 10). `ConfiguracionEmpresa.regaliasBase`. */
  regaliasBase: number;
}

/** Desglose del precio sugerido (para mostrar utilidad/regalías por separado, como el viejo). */
export interface PrecioSugeridoDesglose {
  /** Precio de venta sugerido, redondeado AL ALZA (D2 #4). */
  precioSugerido: number;
  /** Precio antes de regalías = costo / (1 − utilidad/100). */
  precioBase: number;
  /** Monto de la utilidad = precioBase − costo. */
  utilidad: number;
  /** Monto de las regalías absorbidas = precioConRegalias − precioBase (antes de redondear). */
  regalias: number;
}

/** Un porcentaje válido para el estilo "sobre la venta": 0 ≤ % < 100 (evita dividir por ≤ 0). */
function porcentajeSobreVentaValido(p: number): boolean {
  return Number.isFinite(p) && p >= 0 && p < 100;
}

/**
 * Calcula el precio de venta sugerido y su desglose a partir del `costo` estimado y los parámetros
 * de utilidad/regalías (ambos sobre la venta). Redondeo AL ALZA (D2 #4).
 *
 * - `costo ≤ 0` ⇒ todo 0 (no hay costo que marginar).
 * - Un `%` fuera de `[0, 100)` ⇒ `RangeError` (el dominio valida antes; los tests cubren el borde).
 */
export function calcularPrecioSugerido(
  costo: number,
  params: ParametrosPrecioSugerido,
): PrecioSugeridoDesglose {
  if (!porcentajeSobreVentaValido(params.utilidadSugerida)) {
    throw new RangeError(`utilidadSugerida fuera de rango [0,100): ${params.utilidadSugerida}`);
  }
  if (!porcentajeSobreVentaValido(params.regaliasBase)) {
    throw new RangeError(`regaliasBase fuera de rango [0,100): ${params.regaliasBase}`);
  }
  if (!(costo > 0)) {
    return { precioSugerido: 0, precioBase: 0, utilidad: 0, regalias: 0 };
  }

  const precioBase = costo / (1 - params.utilidadSugerida / 100);
  const precioConRegalias = precioBase / (1 - params.regaliasBase / 100);
  const precioSugerido = Math.ceil(precioConRegalias);

  return {
    precioSugerido,
    precioBase,
    utilidad: precioBase - costo,
    regalias: precioConRegalias - precioBase,
  };
}
