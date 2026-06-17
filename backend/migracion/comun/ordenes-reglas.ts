/**
 * Reglas PURAS del ETL de órdenes (F2-E5) — sin BD, testeables en aislamiento.
 *
 * Centraliza dos decisiones del enunciado que NO deben perderse en el loader:
 *  • `IdPedidosDet ∈ {0, vacío}` → la orden es huérfana del viejo: su `idPedidoLinea` es NULL
 *    (jamás se intenta una FK con 0; son las ~26 órdenes sin pedido).
 *  • `Monarch == código del modelo` → era el DEFAULT automático del viejo (no un valor real del
 *    cliente): NO se migra como referencia D7. Solo los Monarch distintos del código son reales.
 */

/** Estado histórico derivado de una orden migrada. */
export type EstadoMigrado = 'capturada' | 'completa' | 'cancelada';

/**
 * Deriva el estado histórico de una orden del viejo (sin re-sellar con now()):
 *  • `OrdCancelada` verdadero → 'cancelada' (prioridad: una orden cancelada lo está aunque tuviera
 *    FechaDet).
 *  • si NO cancelada y tiene `FechaDet` (fechaCompletada) → 'completa'.
 *  • si nada → 'capturada'.
 */
export function estadoOrdenMigrada(
  cancelada: boolean,
  tieneFechaCompletada: boolean,
): EstadoMigrado {
  if (cancelada) return 'cancelada';
  if (tieneFechaCompletada) return 'completa';
  return 'capturada';
}

/** ¿El `IdPedidosDet` del viejo es "sin pedido" (0 o vacío)? → idPedidoLinea NULL. */
export function esIdPedidosDetVacio(crudo: string | null | undefined): boolean {
  const t = (crudo ?? '').trim();
  return t === '' || t === '0';
}

/**
 * ¿El valor de `Monarch` es el DEFAULT automático (igual al código del modelo) y por tanto NO se
 * migra como referencia? Compara recortando y en mayúsculas (el viejo a veces difiere en caja).
 * `monarch` vacío/null → no es referencia (devuelve `true` = descartar). `codigoModelo` ausente →
 * no se puede comparar, se trata como referencia real (devuelve `false` = migrar).
 */
export function monarchEsDefaultDeModelo(
  monarch: string | null | undefined,
  codigoModelo: string | null | undefined,
): boolean {
  const m = (monarch ?? '').trim();
  if (m === '') return true; // sin valor: nada que migrar
  const cod = (codigoModelo ?? '').trim();
  if (cod === '') return false; // sin código de modelo: no se puede descartar, es real
  return m.toUpperCase() === cod.toUpperCase();
}
