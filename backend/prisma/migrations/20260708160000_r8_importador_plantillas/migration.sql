-- Rediseño R8 · Importador del pedido del cliente (B15) — plantilla de mapeo POR CLIENTE del Excel
-- de su Orden de Compra. Migración ADITIVA pura (1 tabla nueva + FK Restrict hacia Cliente; NO toca
-- datos ni columnas existentes). SIN permisos nuevos (reusa `pedidos.*`/`ordenes.*`) y SIN seed.
-- SQL generado por `prisma migrate diff` (schema anterior → schema R8) y validado contra el schema.

-- Plantilla de importación versionada (una vigente por cliente, garantizada por el dominio en tx).
CREATE TABLE "plantilla_importacion" (
    "id" SERIAL NOT NULL,
    "id_cliente" INTEGER NOT NULL,
    "nombre" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "vigente" BOOLEAN NOT NULL DEFAULT true,
    "mapeo" JSONB NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "plantilla_importacion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "plantilla_importacion_id_cliente_idx" ON "plantilla_importacion"("id_cliente");

-- CreateIndex
CREATE UNIQUE INDEX "plantilla_importacion_id_cliente_version_key" ON "plantilla_importacion"("id_cliente", "version");

-- AddForeignKey
ALTER TABLE "plantilla_importacion" ADD CONSTRAINT "plantilla_importacion_id_cliente_fkey" FOREIGN KEY ("id_cliente") REFERENCES "clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
