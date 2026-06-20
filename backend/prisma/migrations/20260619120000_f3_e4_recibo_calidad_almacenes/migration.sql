-- F3-E4 · Recibo de maquila — CALIDAD (primeras/segundas) + ALMACENES destino del recibo.
-- Diseño en docs/arquitectura/ADR-0010 y en la sección "PRODUCCIÓN / WIP" de schema.prisma.
--
-- Migración 100% ADITIVA (NO altera ni borra ninguna fila ni columna existente; solo agrega 4
-- columnas NULLABLE, 2 índices y 2 FKs). El SQL es EXACTAMENTE el `prisma migrate diff` entre el
-- schema previo (F3-E3) y este (F3-E4) — validado sin BD con
-- `prisma migrate diff --from-schema <prev> --to-schema <actual> --script`.
--
-- Qué agrega y por qué (decisión Gabriel F3-E4):
--  • etapa_movimiento_det.cantidad_primeras / .cantidad_segundas (Int NULL): la CALIDAD del recibo
--    por color×talla (primeras = buenas, segundas = defectuosas). NULL en corte/envío. La calidad
--    es DATO del WIP, SEPARADA del almacén destino. `cantidad` sigue siendo el TOTAL recibido.
--  • etapa_movimiento.id_almacen_primeras / .id_almacen_segundas (FK→almacenes, NULL): el almacén
--    destino al que el recibo de COSTURA mete las primeras y las segundas (solo cuando el proceso
--    genera entrada a PT — `tipos_proceso.genera_entrada_pt`). NULL en corte/envío y en recibos de
--    procesos que no meten a PT (estampado/bordado/lavado). Reemplaza la vieja bandera
--    "Inventariado" + el botón manual de "meter a inventario": recibir = ya queda en inventario en
--    la MISMA transacción (mejora A1). FK Restrict (un almacén con recibos no se borra físico).

-- AlterTable
ALTER TABLE "etapa_movimiento" ADD COLUMN     "id_almacen_primeras" INTEGER,
ADD COLUMN     "id_almacen_segundas" INTEGER;

-- AlterTable
ALTER TABLE "etapa_movimiento_det" ADD COLUMN     "cantidad_primeras" INTEGER,
ADD COLUMN     "cantidad_segundas" INTEGER;

-- CreateIndex
CREATE INDEX "etapa_movimiento_id_almacen_primeras_idx" ON "etapa_movimiento"("id_almacen_primeras");

-- CreateIndex
CREATE INDEX "etapa_movimiento_id_almacen_segundas_idx" ON "etapa_movimiento"("id_almacen_segundas");

-- AddForeignKey
ALTER TABLE "etapa_movimiento" ADD CONSTRAINT "etapa_movimiento_id_almacen_primeras_fkey" FOREIGN KEY ("id_almacen_primeras") REFERENCES "almacenes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "etapa_movimiento" ADD CONSTRAINT "etapa_movimiento_id_almacen_segundas_fkey" FOREIGN KEY ("id_almacen_segundas") REFERENCES "almacenes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
