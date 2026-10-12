/**
 * ⭐ Fila 0.231 — el filtro por MOTIVO de la compra: `''` = todas, `normal` = sin motivo, `extra` =
 * con cualquier motivo, o el id de un motivo. Se traduce a los dos parámetros del servidor
 * (`conMotivo` / `idMotivoCompra`): el filtro lo aplica el servidor, nunca la pantalla.
 */
export type FiltroMotivo = '' | 'normal' | 'extra' | `${number}`;

/** Los parámetros del servidor que corresponden al filtro por motivo. */
export function paramsFiltroMotivo(filtro: FiltroMotivo): {
  conMotivo?: 'true' | 'false';
  idMotivoCompra?: number;
} {
  if (filtro === '') return {};
  if (filtro === 'normal') return { conMotivo: 'false' };
  if (filtro === 'extra') return { conMotivo: 'true' };
  return { idMotivoCompra: Number(filtro) };
}
