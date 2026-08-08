-- La entrada de tela por factura, ligada a su ORDEN DE COMPRA (§Post-F9.14, petición de Daniel
-- 7-ago-2026): "al dar entrada de tela de una factura, la relacionemos con la OC de esa tela. De
-- esa manera amarramos que sea visible el recibo de la OC de la tela y se marca con estatus de
-- recibido".
--
-- Dos columnas, las dos NULLABLE y aditivas (cero impacto en las filas existentes):
--
--  (1) `entrada_tela_linea.id_orden_compra_linea` — qué renglón de OC surte este renglón de la
--      factura. Es POR RENGLÓN a propósito: una factura del proveedor puede amparar tela de dos
--      OCs distintas y hasta tela suelta (sin OC) en el mismo documento. NULL = compra suelta.
--
--  (2) `recepciones_compra.id_entrada_tela` — de qué documento de entrada nació la recepción.
--      NULL en las recepciones capturadas directo contra la OC (avíos y todo el histórico). Con
--      valor, la recepción ES el recibo de esa factura contra la OC: es lo que la hace visible
--      desde la orden y lo que el CANCELAR de la factura busca para reversarla.
--
-- Ambas FK con ON DELETE RESTRICT: ni un renglón de OC ya surtido ni un documento de entrada con
-- recepción se borran físico (el sistema usa cancelación suave — D3, nada se borra).

ALTER TABLE "entrada_tela_linea" ADD COLUMN "id_orden_compra_linea" INTEGER;

ALTER TABLE "recepciones_compra" ADD COLUMN "id_entrada_tela" INTEGER;

CREATE INDEX "entrada_tela_linea_id_orden_compra_linea_idx" ON "entrada_tela_linea"("id_orden_compra_linea");

CREATE INDEX "recepciones_compra_id_entrada_tela_idx" ON "recepciones_compra"("id_entrada_tela");

ALTER TABLE "entrada_tela_linea"
    ADD CONSTRAINT "entrada_tela_linea_id_orden_compra_linea_fkey"
    FOREIGN KEY ("id_orden_compra_linea") REFERENCES "orden_compra_linea"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "recepciones_compra"
    ADD CONSTRAINT "recepciones_compra_id_entrada_tela_fkey"
    FOREIGN KEY ("id_entrada_tela") REFERENCES "entradas_tela"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
