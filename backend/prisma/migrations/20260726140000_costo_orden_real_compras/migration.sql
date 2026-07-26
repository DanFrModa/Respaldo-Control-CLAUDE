-- COSTO REAL DE MATERIALES DESDE LAS ÓRDENES DE COMPRA — petición de DANIEL (26-jul-2026).
--
-- Hasta hoy el costo de materiales de una orden de producción salía de la RECETA del modelo por los
-- precios de CATÁLOGO (`Tela.precioSugerido` / `Avio.precioReferencia`). Daniel: eso no refleja la
-- realidad, porque al comprar cambian el proveedor y el precio, y en v2 eso ya queda registrado en
-- las órdenes de compra ligadas a la orden de producción (`orden_compra_linea.id_orden`, R7/F4).
--
-- El motor nuevo (`backend/src/dominio/costos/costo-real-compras.ts`) calcula el REAL como
--   compra DIRECTA (Σ líneas de OC autorizada/recibida ligadas a la orden, cantidad × precio)
--   + consumo SIN compra propia valuado a ÚLTIMO PRECIO DE COMPRA (genéricos y compras libres).
--
-- Estas dos columnas CONGELAN ese real al momento de guardar el costo, igual que `*_calc` congela el
-- teórico: son trazabilidad ("¿con qué se costeó esta orden?"), NO entran en `costo_total` (que
-- sigue siendo Σ de los GUARDADOS `*_cost`). NULL para todo lo costeado antes de hoy: el histórico
-- NO se reescribe.
--
-- Aditiva y nullable: se aplica sola al desplegar. Sin backfill, sin permisos nuevos, sin re-seed.

-- AlterTable
ALTER TABLE "costo_orden" ADD COLUMN     "avios_real" DECIMAL(14,2),
ADD COLUMN     "tela_real" DECIMAL(14,2);
