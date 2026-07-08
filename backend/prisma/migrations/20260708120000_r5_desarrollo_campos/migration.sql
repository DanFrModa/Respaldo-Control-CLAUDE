-- Rediseño R5 · Desarrollo: campos del precosteo que Daniel dictó tras cerrar F8 (B8/B9/B11/B12/B16).
-- Migración ADITIVA pura (columnas nullable / con default + 2 tablas nuevas + FKs; NO toca datos):
--  • B8 — corte como costo SEPARADO de la maquila: `modelos.corte_base` (sin proveedor; alimenta el
--    renglón `corte` del precosto, concepto fijo sembrado por seed).
--  • B9 — maquilero (costura) cotizado en el desarrollo: `modelos.id_maquilero_cotizado` (FK Proveedor,
--    Restrict). Sólo dato: siembra el default del maquilero de producción (F3/F5).
--  • B11 — avío "por medida": tabla `avio_medida` (medidas agrupadas dentro del avío padre, con precio
--    real por medida) + amarre medida×talla `modelo_avio_talla.id_avio_medida` (nullable → el MRP
--    existente NO cambia; el precosto usa el PROMEDIO de los precios de las medidas activas).
--  • B12 — calculadora de negociación en vivo: `precosto_linea.ajustado` (un renglón de origen BOM
--    editado/quitado en la mesa; `recalcularDesdeBom` no lo pisa; `restaurarLineaBom` lo revierte).
--  • B16 — tech pack / adjuntos del desarrollo: tabla `desarrollo_archivo` (espejo de `orden_archivo`;
--    PDFs de referencia + fotos en R2 vía presigned).
-- SQL generado por `prisma migrate diff` (schema anterior → schema R5) y validado contra el schema.

-- B8/B9: corte y maquilero cotizado del modelo.
ALTER TABLE "modelos" ADD COLUMN     "corte_base" DECIMAL(12,2),
ADD COLUMN     "id_maquilero_cotizado" INTEGER;

-- B11: amarre medida×talla del BOM (nullable → MRP intacto).
ALTER TABLE "modelo_avio_talla" ADD COLUMN     "id_avio_medida" INTEGER;

-- B12: renglón de precosto ajustado a mano en la negociación (recalcular no lo pisa).
ALTER TABLE "precosto_linea" ADD COLUMN     "ajustado" BOOLEAN NOT NULL DEFAULT false;

-- B11: catálogo de medidas de un avío "por medida".
CREATE TABLE "avio_medida" (
    "id" SERIAL NOT NULL,
    "id_avio" INTEGER NOT NULL,
    "medida" TEXT NOT NULL,
    "precio" DECIMAL(12,2) NOT NULL,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "avio_medida_pkey" PRIMARY KEY ("id")
);

-- B16: tech pack / adjuntos del desarrollo (espejo de orden_archivo).
CREATE TABLE "desarrollo_archivo" (
    "id" SERIAL NOT NULL,
    "id_desarrollo" INTEGER NOT NULL,
    "id_archivo" TEXT NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,

    CONSTRAINT "desarrollo_archivo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "avio_medida_id_avio_idx" ON "avio_medida"("id_avio");

-- CreateIndex
CREATE UNIQUE INDEX "avio_medida_id_avio_medida_key" ON "avio_medida"("id_avio", "medida");

-- CreateIndex
CREATE INDEX "desarrollo_archivo_id_desarrollo_idx" ON "desarrollo_archivo"("id_desarrollo");

-- CreateIndex
CREATE UNIQUE INDEX "desarrollo_archivo_id_archivo_key" ON "desarrollo_archivo"("id_archivo");

-- CreateIndex
CREATE INDEX "modelo_avio_talla_id_avio_medida_idx" ON "modelo_avio_talla"("id_avio_medida");

-- AddForeignKey
ALTER TABLE "avio_medida" ADD CONSTRAINT "avio_medida_id_avio_fkey" FOREIGN KEY ("id_avio") REFERENCES "avios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "modelos" ADD CONSTRAINT "modelos_id_maquilero_cotizado_fkey" FOREIGN KEY ("id_maquilero_cotizado") REFERENCES "proveedores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "modelo_avio_talla" ADD CONSTRAINT "modelo_avio_talla_id_avio_medida_fkey" FOREIGN KEY ("id_avio_medida") REFERENCES "avio_medida"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "desarrollo_archivo" ADD CONSTRAINT "desarrollo_archivo_id_desarrollo_fkey" FOREIGN KEY ("id_desarrollo") REFERENCES "desarrollos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "desarrollo_archivo" ADD CONSTRAINT "desarrollo_archivo_id_archivo_fkey" FOREIGN KEY ("id_archivo") REFERENCES "archivos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
