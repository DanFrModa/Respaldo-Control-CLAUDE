-- F8-E6 · Adjuntos de apoyo de la orden de producción (R6).
-- Tabla puente `orden_archivo` (espejo de `proveedor_archivo`, sin `tipo`): liga un `Archivo` del motor
-- de R2 (F0) a una ORDEN como documento de apoyo (Excel/PDF/imágenes). `@@unique(id_archivo)` = un
-- archivo se adjunta a una sola orden; Cascade en ambas FK (los adjuntos son de la orden; borrar el
-- adjunto borra su `Archivo`). Migración ADITIVA pura (tabla nueva, sin tocar datos existentes).

-- CreateTable
CREATE TABLE "orden_archivo" (
    "id" SERIAL NOT NULL,
    "id_orden" INTEGER NOT NULL,
    "id_archivo" TEXT NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,

    CONSTRAINT "orden_archivo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "orden_archivo_id_orden_idx" ON "orden_archivo"("id_orden");

-- CreateIndex
CREATE UNIQUE INDEX "orden_archivo_id_archivo_key" ON "orden_archivo"("id_archivo");

-- AddForeignKey
ALTER TABLE "orden_archivo" ADD CONSTRAINT "orden_archivo_id_orden_fkey" FOREIGN KEY ("id_orden") REFERENCES "ordenes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orden_archivo" ADD CONSTRAINT "orden_archivo_id_archivo_fkey" FOREIGN KEY ("id_archivo") REFERENCES "archivos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
