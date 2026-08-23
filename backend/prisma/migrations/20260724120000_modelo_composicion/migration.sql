-- COMPOSICIÓN en la ficha del MODELO (decisión de Daniel, 24-jul-2026).
--  • `composicion`: la composición textil NO sale de la OC del cliente, sale del DESARROLLO del
--    modelo. Se captura AQUÍ y toda orden de ese modelo la HEREDA sola (`ordenes.composicion`);
--    en una orden puntual se puede corregir a mano y esa orden queda con `comp_forzada = true`
--    (override que ya NO se re-deriva).
-- Migración ADITIVA: columna nullable, SIN backfill (los modelos existentes quedan sin
-- composición hasta que se capture; las órdenes históricas conservan la suya tal cual).

-- AlterTable
ALTER TABLE "modelos" ADD COLUMN     "composicion" TEXT;
