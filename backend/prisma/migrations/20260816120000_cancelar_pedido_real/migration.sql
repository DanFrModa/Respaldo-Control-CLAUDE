-- V1-E4 (punto 6) — EL PEDIDO REAL SE PUEDE CANCELAR
-- Decisión `Documentacion_MJD/DECISIONES.md` §Post-F9.37 punto 9 (Daniel, 13-ago-2026): *"Sí."*
-- Cierra el TODO que estaba abierto desde F2-E1 (`dominio/pedidos/pedidos-reales.ts`), donde se
-- dejó escrito que la cancelación quedaba pendiente de decisión: "no se construye en esta etapa
-- (sin servicio, sin campo)".
--
-- Cancelación SUAVE con motivo, como TODO lo demás del sistema (D3: nada se borra):
--   • `cancelado`        — bandera, default false. Aditiva: los pedidos reales que ya existen
--                          nacen NO cancelados, que es exactamente lo que son hoy.
--   • `motivo_cancelada` — el porqué, obligatorio en el dominio al cancelar (mismo criterio que
--                          `ordenes.motivo_cancelada`). Nullable en BD porque los registros
--                          vivos no tienen motivo que guardar.
--
-- Sin índice nuevo: el listado de pedidos reales ya filtra por `id_pedido` (que sí lo tiene) y
-- devuelve la decena de liberaciones de UN pedido; un índice por `cancelado` no compraría nada.
ALTER TABLE "pedido_real"
  ADD COLUMN "cancelado" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "motivo_cancelada" TEXT;
