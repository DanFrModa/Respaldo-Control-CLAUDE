/**
 * ⭐ **EL DESVÍO AVISA; NO BLOQUEA** (V1-E3u, §Post-F9.89(a)) — funciones PURAS, sin BD.
 *
 * Daniel: *"el sistema debería de validar que las cantidades no excedan un porcentaje. De cualquier
 * manera falta una autorización para liberar la OC. Entonces **si el sistema encuentra algún desvío
 * grande que le notifique a la persona que va a autorizar la OC**"*.
 *
 * 🔴 **Lo importante es lo que este módulo NO hace: no lanza, no rechaza, no tapa un botón.**
 * Devuelve un número y una frase. Quien decide sigue siendo quien autoriza la OC — el control que
 * ya existía. Es el espíritu de §Post-F9.64 (*la curva es guía, no jaula*): una tranca en la
 * captura sólo enseña a la gente a rodearla (se teclea la cantidad "buena" y se corrige después),
 * y entonces el sistema pierde el dato REAL sin ganar el control.
 *
 * ## El umbral, y por qué 10 %
 *
 * El default es **10 %** (`ConfiguracionEmpresa.pctDesvioCompra`, por empresa y editable sin
 * deploy). Las razones, para que se pueda discutir el número sin re-discutir el diseño:
 *  • **El negocio ya reconoce el 5 % como variación normal** (§Post-F9.19: *"si se piden 400 kilos,
 *    el proveedor puede entregar +/− 5%"*). Avisar por debajo de eso sería avisar de lo normal.
 *  • **Redondear al rollo o al mínimo del proveedor cae casi siempre por debajo del 10 %**, y ése
 *    es un ajuste que Daniel YA declaró legítimo (§Post-F9.86, el sobrante de compra). Un aviso que
 *    salta en cada compra deja de leerse: la alarma que suena siempre no es una alarma.
 *  • **Un rollo entero de más SÍ pasa del 10 %** en las cantidades de una OP típica — y ése es
 *    justo el caso que Daniel quiere que llegue a quien autoriza.
 *  • Es un número redondo que una persona puede razonar en voz alta (*"me pasé más de un diez por
 *    ciento"*), lo cual importa porque **lo va a ajustar Daniel con el uso**, no un programador.
 *
 * ## Se avisa de MÁS y de MENOS
 *
 * Comprar de menos es tan desvío como comprar de más —y más peligroso: la OP se queda corta y nadie
 * se entera hasta que falta la tela—. El umbral es sobre el valor ABSOLUTO, y la frase dice de qué
 * lado se fue.
 */

/** Umbral por omisión, en porcentaje entero. Ver el encabezado para el porqué del 10. */
export const PCT_DESVIO_COMPRA_DEFECTO = 10;

/** Debajo de esto, una propuesta no sirve de base para medir un porcentaje (evita dividir entre ~0). */
const MINIMO_BASE = 1e-6;

/**
 * Desvío de lo capturado respecto de lo propuesto, en porcentaje CON SIGNO (+ = se compró de más).
 *
 * `null` cuando no hay contra qué medir: sin propuesta (línea capturada a mano) o con una propuesta
 * de cero. Devolver 0 en ese caso diría *"no hubo desvío"*, que es una afirmación distinta de *"no
 * se puede saber"* — y afirmar lo que no se sabe es el pecado que §Post-F9.85 vino a corregir.
 */
export function porcentajeDeDesvio(
  propuesta: number | null | undefined,
  capturada: number,
): number | null {
  if (propuesta == null || !Number.isFinite(propuesta) || Math.abs(propuesta) < MINIMO_BASE) {
    return null;
  }
  return ((capturada - propuesta) / propuesta) * 100;
}

/** ¿El desvío pasa del umbral? `false` cuando no hay con qué medirlo (ver {@link porcentajeDeDesvio}). */
export function desvioPasaUmbral(
  propuesta: number | null | undefined,
  capturada: number,
  pctUmbral: number,
): boolean {
  const pct = porcentajeDeDesvio(propuesta, capturada);
  if (pct === null) return false;
  return Math.abs(pct) > Math.abs(pctUmbral);
}

/** Cantidad legible para las frases (hasta 4 decimales, formato es-MX). */
function cantidad(valor: number): string {
  return valor.toLocaleString('es-MX', { maximumFractionDigits: 4 });
}

/**
 * La frase que ve **quien autoriza**, en el idioma del negocio: qué material, cuánto se propuso,
 * cuánto se pidió y de cuánto fue la diferencia. `null` = no hay nada que avisar de este renglón.
 *
 * ⚠️ El aviso se ARMA al leer, no se guarda como texto: lo que se guarda es
 * `OrdenCompraLinea.cantidadSugerida` (el dato). Una frase congelada envejecería —cambia el umbral
 * y el aviso seguiría diciendo el viejo— y además no se podría re-ordenar ni filtrar.
 */
export function avisoDeDesvio(entrada: {
  material: string;
  unidad: string | null;
  propuesta: number | null | undefined;
  capturada: number;
  pctUmbral: number;
}): string | null {
  const pct = porcentajeDeDesvio(entrada.propuesta, entrada.capturada);
  if (pct === null || Math.abs(pct) <= Math.abs(entrada.pctUmbral)) {
    return null;
  }
  const u = entrada.unidad === null ? '' : ` ${entrada.unidad}`;
  const direccion = pct > 0 ? 'MÁS' : 'MENOS';
  const magnitud = Math.abs(pct).toLocaleString('es-MX', { maximumFractionDigits: 1 });
  return (
    `"${entrada.material}": se está pidiendo ${cantidad(entrada.capturada)}${u} y el sistema ` +
    `calculó ${cantidad(entrada.propuesta as number)}${u} — un ${magnitud}% de ${direccion} ` +
    `(el aviso salta arriba del ${String(entrada.pctUmbral)}%). No impide autorizar: decide tú.`
  );
}
