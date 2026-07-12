-- Importador de OC por PDF (petición Daniel): % ADICIONAL de producción por cliente. C&A acepta hasta
-- 5% de más y Daniel fabrica ese 5% + 2% de merma → ~7% arriba. Al importar, la MATRIZ de la OP se
-- genera con `ceil(cantidad × (1 + pct/100))` por talla; el renglón del pedido conserva la cantidad
-- ORIGINAL y el precio no cambia. Migración ADITIVA: columna con DEFAULT 0 (las plantillas existentes
-- quedan sin adicional por el default; no hace falta backfill). SIN permisos nuevos, SIN seed.

-- AlterTable
ALTER TABLE "plantilla_importacion" ADD COLUMN     "porcentaje_adicional" DECIMAL(5,2) NOT NULL DEFAULT 0;
