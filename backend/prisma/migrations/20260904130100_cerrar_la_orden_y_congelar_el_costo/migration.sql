-- 0.061 · PASO 2 DE 2 — las columnas del cierre, el costo congelado y el divisor por defecto.
--
-- (a) `ordenes.cerrada_en` / `cerrada_por_id` / `motivo_cierre` — el ACTO de cerrar la orden
--     (§Post-F9.154(c)). `cerrada_en` es la verdad autoritativa de "está cerrada"; el estado
--     `cerrada` del enum es su espejo visible. `cerrada_por_id` va SIN FK física, igual que
--     `creado_por_id`/`modificado_por_id` (ADR-0005). El motivo es OPCIONAL: cerrar es el final
--     normal de una orden, no una excepción que haya que justificar.
--
-- (b) `costo_orden.cantidad_base_congelada` / `costo_unitario_congelado` / `congelado_en` /
--     `descongelado_en` — el COSTO CONGELADO al cerrar. Hasta hoy el costo "iba cambiando": el
--     dinero se persistía pero la CANTIDAD del divisor se re-sumaba en cada lectura. Reabrir NO
--     borra el congelado: lo MARCA con `descongelado_en` (D3 — nada se edita ni se borra).
--
-- (c) `costo_orden.base_prorrateo` pasa de DEFAULT 'cortado' a DEFAULT 'recibido'
--     (§Post-F9.154(b), DANIEL: las faltantes se cobran al maquilero y las incompletas son merma;
--     primeras y segundas sí se venden). ⚠️ Es SÓLO HACIA ADELANTE: cambiar el DEFAULT **no toca ni
--     una fila existente** (REGLA 0-B — lo viejo no se repara). Las órdenes ya costeadas conservan
--     su base guardada, y omitir el campo en un PUT ahora la CONSERVA en vez de pisarla.
--
-- Todo aditivo y nullable: ninguna fila existente se reescribe.

-- AlterTable
ALTER TABLE "ordenes" ADD COLUMN     "cerrada_en" TIMESTAMP(3),
ADD COLUMN     "cerrada_por_id" TEXT,
ADD COLUMN     "motivo_cierre" TEXT;

-- AlterTable
ALTER TABLE "costo_orden" ADD COLUMN     "cantidad_base_congelada" INTEGER,
ADD COLUMN     "congelado_en" TIMESTAMP(3),
ADD COLUMN     "costo_unitario_congelado" DECIMAL(14,4),
ADD COLUMN     "descongelado_en" TIMESTAMP(3),
ALTER COLUMN "base_prorrateo" SET DEFAULT 'recibido';
