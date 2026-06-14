-- Fusión de terceros (D12/R15 — Documentacion_MJD/PROPUESTA-Finanzas-y-Proveedores.md §4):
-- se eliminan los catálogos `Maquilero` y `Cortador`; un tercero se da de alta UNA vez como
-- `Proveedor` y marca sus servicios con casillas de `RolProveedor`. `TipoProceso` SE CONSERVA
-- (lo usará la Ruta Crítica en F5); solo pierde su relación inversa hacia maquileros.
--
-- Seguridad del DROP: en `prueba` las tablas `cortadores`, `maquileros` y
-- `maquilero_tipo_proceso` solo contienen datos de SEED (no hay datos reales aún; el ETL es
-- F1-E6), así que el DROP no pierde información del negocio. Los atributos propios del
-- maquilero (corto/asegurado/obs_pago) se portan a `proveedores`. El `precio_referencia` del
-- cortador NO se porta (el costo del corte se definirá en la orden de producción, F2/F3).

-- DropForeignKey
ALTER TABLE "maquilero_tipo_proceso" DROP CONSTRAINT "maquilero_tipo_proceso_id_maquilero_fkey";

-- DropForeignKey
ALTER TABLE "maquilero_tipo_proceso" DROP CONSTRAINT "maquilero_tipo_proceso_id_tipo_proceso_fkey";

-- AlterTable
ALTER TABLE "proveedores" ADD COLUMN     "asegurado" BOOLEAN,
ADD COLUMN     "corto" TEXT,
ADD COLUMN     "obs_pago" TEXT;

-- DropTable
DROP TABLE "cortadores";

-- DropTable
DROP TABLE "maquileros";

-- DropTable
DROP TABLE "maquilero_tipo_proceso";

-- CreateIndex
CREATE UNIQUE INDEX "proveedores_corto_key" ON "proveedores"("corto");
