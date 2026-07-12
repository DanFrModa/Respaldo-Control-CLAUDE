-- Importador de OC del cliente por PDF (petición Daniel — plantilla C&A). Migración ADITIVA pura:
--  • `plantilla_importacion.formato`: `excel` (histórico R8) | `pdf-cya` (OC en PDF de C&A parseada por
--    un extractor en código). Default 'excel' → las plantillas R8 existentes quedan como Excel (backfill
--    por el DEFAULT, no hace falta UPDATE).
--  • `plantilla_importacion.campos_variables`: JSON `[{ campo, etiqueta }]` de los campos variables por
--    cliente que se capturan como referencia (D7) en cada OP. NULL en Excel.
--  • `cliente_modelo_liga`: aprendizaje de la liga modelo-del-cliente → nuestro modelo (Cascade hacia
--    Cliente, Restrict hacia Modelo). Único por (cliente, modeloCliente).
-- NO toca datos ni columnas existentes. SIN permisos nuevos (reusa `pedidos.*`/`ordenes.*`) y SIN seed.

-- AlterTable
ALTER TABLE "plantilla_importacion" ADD COLUMN     "formato" TEXT NOT NULL DEFAULT 'excel',
ADD COLUMN     "campos_variables" JSONB;

-- CreateTable
CREATE TABLE "cliente_modelo_liga" (
    "id" SERIAL NOT NULL,
    "id_cliente" INTEGER NOT NULL,
    "modelo_cliente" TEXT NOT NULL,
    "id_modelo" INTEGER NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "cliente_modelo_liga_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cliente_modelo_liga_id_modelo_idx" ON "cliente_modelo_liga"("id_modelo");

-- CreateIndex
CREATE UNIQUE INDEX "cliente_modelo_liga_id_cliente_modelo_cliente_key" ON "cliente_modelo_liga"("id_cliente", "modelo_cliente");

-- AddForeignKey
ALTER TABLE "cliente_modelo_liga" ADD CONSTRAINT "cliente_modelo_liga_id_cliente_fkey" FOREIGN KEY ("id_cliente") REFERENCES "clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cliente_modelo_liga" ADD CONSTRAINT "cliente_modelo_liga_id_modelo_fkey" FOREIGN KEY ("id_modelo") REFERENCES "modelos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
