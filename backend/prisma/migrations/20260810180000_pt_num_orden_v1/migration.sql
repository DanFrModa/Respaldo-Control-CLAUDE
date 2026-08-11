-- El inventario de PT recuerda QUÉ ORDEN VIEJA fabricó lo que hay en el anaquel (§Post-F9.25;
-- Daniel: *"será bueno incluir un campo de orden de producción para poder saber qué orden anterior
-- es la que se fabricó, para poder consultar información en Control viejo"*).
--
-- POR QUÉ TEXTO Y NO UNA LLAVE: la migración lleva solo 2025-2026 (§Post-F9.24) y el almacén de PT
-- arranca de un CONTEO FÍSICO desde cero, pero las prendas contadas las fabricaron órdenes VIEJAS
-- que no existen en v2. Una FK no puede apuntar a una orden que no se migró. `id_orden` (la FK) se
-- queda para las órdenes que SÍ viven en v2; esta columna guarda el número tal como lo imprime
-- Control viejo, para poder ir a consultarlo allá.
--
-- Es INFORMATIVA: NO entra en la llave de existencia (modelo×color×talla×orden×almacén), así que
-- las vistas, los locks y las sumas del kardex no cambian. El índice es para buscar "¿qué me queda
-- de la orden 12345?".
--
-- Migración ADITIVA y nullable: nada de lo que ya existe se toca.

-- AlterTable
ALTER TABLE "movimiento_det_pt" ADD COLUMN     "num_orden_v1" TEXT;

-- CreateIndex
CREATE INDEX "movimiento_det_pt_num_orden_v1_idx" ON "movimiento_det_pt"("num_orden_v1");
