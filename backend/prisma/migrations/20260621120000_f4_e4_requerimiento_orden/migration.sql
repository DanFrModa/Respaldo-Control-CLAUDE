-- F4-E4 · EXPLOSIÓN MRP / requerimiento de materiales por orden (REQUISITOS-NUEVOS.md §R3/R7 +
-- Make-to-Order; doc `Documentacion_MJD/01-Modelos.md §2`). Migración ADITIVA (solo CREATE + FKs
-- hacia tablas existentes): UNA tabla nueva (`requerimiento_orden`), sus índices y FKs. NO altera
-- columnas de tablas existentes (las relaciones inversas en ordenes/telas/avios/proveedores son
-- virtuales en Prisma; la FK física vive en la tabla nueva). SIN backfill, SIN seed, SIN permisos.
-- Aplicable en limpio.
--
--   • requerimiento_orden — SNAPSHOT regenerable de la explosión de una orden: un material
--                           (tela XOR avío) con la cantidad requerida ya en unidad de consumo del
--                           BOM, el neteo contra stock de avíos genéricos (decisión (d)) y el
--                           proveedor/precio sugerido (R1, avíos). Se reemplaza al regenerar.
-- Ver la sección "EXPLOSIÓN MRP" de schema.prisma y el TSDoc de src/dominio/compras/mrp.ts.

-- CreateTable
CREATE TABLE "requerimiento_orden" (
    "id" SERIAL NOT NULL,
    "id_orden" INTEGER NOT NULL,
    "id_tela" INTEGER,
    "id_avio" INTEGER,
    "cantidad_requerida" DECIMAL(14,4) NOT NULL,
    "unidad" TEXT,
    "es_generico" BOOLEAN NOT NULL DEFAULT false,
    "existencia_stock" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "cantidad_a_comprar" DECIMAL(14,4) NOT NULL,
    "id_proveedor_sugerido" INTEGER,
    "precio_sugerido" DECIMAL(12,4),
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "requerimiento_orden_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "requerimiento_orden_id_orden_idx" ON "requerimiento_orden"("id_orden");

-- CreateIndex
CREATE INDEX "requerimiento_orden_id_tela_idx" ON "requerimiento_orden"("id_tela");

-- CreateIndex
CREATE INDEX "requerimiento_orden_id_avio_idx" ON "requerimiento_orden"("id_avio");

-- CreateIndex
CREATE INDEX "requerimiento_orden_id_proveedor_sugerido_idx" ON "requerimiento_orden"("id_proveedor_sugerido");

-- AddForeignKey
ALTER TABLE "requerimiento_orden" ADD CONSTRAINT "requerimiento_orden_id_orden_fkey" FOREIGN KEY ("id_orden") REFERENCES "ordenes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requerimiento_orden" ADD CONSTRAINT "requerimiento_orden_id_tela_fkey" FOREIGN KEY ("id_tela") REFERENCES "telas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requerimiento_orden" ADD CONSTRAINT "requerimiento_orden_id_avio_fkey" FOREIGN KEY ("id_avio") REFERENCES "avios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requerimiento_orden" ADD CONSTRAINT "requerimiento_orden_id_proveedor_sugerido_fkey" FOREIGN KEY ("id_proveedor_sugerido") REFERENCES "proveedores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
