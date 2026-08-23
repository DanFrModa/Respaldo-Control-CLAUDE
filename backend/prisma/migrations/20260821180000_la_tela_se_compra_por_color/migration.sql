-- ⭐⭐ V1-E3u (§Post-F9.89) — LA TELA SE COMPRA POR COLOR
--
-- Daniel: *"se selecciona una tela con la que se desarrolla el producto, de ahí nos piden esas telas
-- para distintas órdenes en diferentes colores… Debo de tener la posibilidad de ir comprando esa tela
-- en diferentes colores (y pantones)"*.
--
-- El sistema obligaba a RECIBIR por color (`MovimientoDetTela.idTelaColor` es obligatorio) y no
-- dejaba PEDIR por color: ni la receta de la orden (`orden_tela`) ni el renglón de OC
-- (`orden_compra_linea`) llevaban color. Esta migración abre ese eslabón.
--
-- ⚠️ **100% ADITIVA.** Todas las columnas nuevas son NULLABLE (o traen DEFAULT), así que:
--   • las OC y recetas que YA existen siguen exactamente igual, con `id_tela_color` en NULL —
--     significan lo que siempre significaron: *"esta tela, sin decir de qué color"*;
--   • nada se backfilea a la fuerza. Adivinar el color de 7,978 OC migradas escribiría como HECHO
--     lo que sólo es una suposición (la lección de §Post-F9.86: el BOM es estimación, el kardex es
--     hecho). El color se dice cuando alguien lo dice.
--   • la recepción sólo CRUZA el color cuando el renglón de OC lo trae; contra un renglón sin color
--     se comporta como antes (§Post-F9.14 sigue mandando).

-- AlterTable
ALTER TABLE "configuraciones_empresa" ADD COLUMN     "pct_desvio_compra" INTEGER NOT NULL DEFAULT 10;

-- AlterTable
ALTER TABLE "orden_compra_linea" ADD COLUMN     "cantidad_sugerida" DECIMAL(14,2),
ADD COLUMN     "id_tela_color" INTEGER;

-- AlterTable
ALTER TABLE "requerimiento_orden" ADD COLUMN     "id_tela_color" INTEGER;

-- CreateTable
CREATE TABLE "orden_tela_color" (
    "id" SERIAL NOT NULL,
    "id_orden_tela" INTEGER NOT NULL,
    "id_color" INTEGER NOT NULL,
    "id_tela_color" INTEGER NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "orden_tela_color_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "orden_tela_color_id_orden_tela_idx" ON "orden_tela_color"("id_orden_tela");

-- CreateIndex
CREATE INDEX "orden_tela_color_id_color_idx" ON "orden_tela_color"("id_color");

-- CreateIndex
CREATE INDEX "orden_tela_color_id_tela_color_idx" ON "orden_tela_color"("id_tela_color");

-- CreateIndex
CREATE UNIQUE INDEX "orden_tela_color_id_orden_tela_id_color_key" ON "orden_tela_color"("id_orden_tela", "id_color");

-- CreateIndex
CREATE INDEX "orden_compra_linea_id_tela_color_idx" ON "orden_compra_linea"("id_tela_color");

-- CreateIndex
CREATE INDEX "requerimiento_orden_id_tela_color_idx" ON "requerimiento_orden"("id_tela_color");

-- AddForeignKey
ALTER TABLE "orden_tela_color" ADD CONSTRAINT "orden_tela_color_id_orden_tela_fkey" FOREIGN KEY ("id_orden_tela") REFERENCES "orden_tela"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orden_tela_color" ADD CONSTRAINT "orden_tela_color_id_color_fkey" FOREIGN KEY ("id_color") REFERENCES "colores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orden_tela_color" ADD CONSTRAINT "orden_tela_color_id_tela_color_fkey" FOREIGN KEY ("id_tela_color") REFERENCES "telas_colores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orden_compra_linea" ADD CONSTRAINT "orden_compra_linea_id_tela_color_fkey" FOREIGN KEY ("id_tela_color") REFERENCES "telas_colores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requerimiento_orden" ADD CONSTRAINT "requerimiento_orden_id_tela_color_fkey" FOREIGN KEY ("id_tela_color") REFERENCES "telas_colores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
