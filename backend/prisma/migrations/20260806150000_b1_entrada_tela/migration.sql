-- Etapa B1 — ENTRADA DE TELA por FACTURA/REMISIÓN (sin orden de compra), traza por PARTIDA en
-- la recepción de compra y COSTO DEL COMPLEMENTO en el kardex. Migración ADITIVA (no toca ni
-- borra datos existentes):
--  • enums `tipo_documento_entrada_tela` / `estatus_entrada_tela`;
--  • tablas `entradas_tela` (cabecera por documento), `entrada_tela_linea` (N partidas) y
--    `entrada_tela_archivo` (el PDF de la factura en R2);
--  • `recepcion_compra_linea`: +`cantidad_complemento` y +`id_partida` (el flujo NUEVO por color
--    crea PARTIDA, ya no lote; `id_lote` queda para las filas históricas);
--  • `movimiento_det_tela`: +`costo_unit_complemento` — el cardigan tiene su propio precio, así
--    que el renglón valúa cada componente por separado (D1) y el complemento deja de entrar sin
--    costo por CUALQUIERA de las dos puertas (documento por factura y recepción de compra).

-- CreateEnum
CREATE TYPE "tipo_documento_entrada_tela" AS ENUM ('factura', 'remision');

-- CreateEnum
CREATE TYPE "estatus_entrada_tela" AS ENUM ('borrador', 'confirmada', 'cancelada');

-- AlterTable
ALTER TABLE "movimiento_det_tela" ADD COLUMN     "costo_unit_complemento" DECIMAL(12,4);

-- AlterTable
ALTER TABLE "recepcion_compra_linea" ADD COLUMN     "cantidad_complemento" DECIMAL(14,4),
ADD COLUMN     "id_partida" INTEGER;

-- CreateTable
CREATE TABLE "entradas_tela" (
    "id" SERIAL NOT NULL,
    "folio" BIGINT NOT NULL,
    "id_empresa" INTEGER NOT NULL,
    "tipo_documento" "tipo_documento_entrada_tela" NOT NULL,
    "numero_documento" TEXT NOT NULL,
    "id_proveedor" INTEGER NOT NULL,
    "fecha" DATE NOT NULL,
    "id_almacen" INTEGER NOT NULL,
    "observaciones" TEXT,
    "estatus" "estatus_entrada_tela" NOT NULL DEFAULT 'borrador',
    "id_movimiento" INTEGER,
    "confirmada_en" TIMESTAMP(3),
    "confirmada_por_id" TEXT,
    "cancelada_en" TIMESTAMP(3),
    "cancelada_por_id" TEXT,
    "motivo_cancelacion" TEXT,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "entradas_tela_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entrada_tela_linea" (
    "id" SERIAL NOT NULL,
    "id_entrada_tela" INTEGER NOT NULL,
    "id_tela_color" INTEGER NOT NULL,
    "cantidad" DECIMAL(14,4) NOT NULL,
    "cantidad_complemento" DECIMAL(14,4),
    "precio_unit" DECIMAL(12,4),
    "precio_unit_complemento" DECIMAL(12,4),
    "lote_proveedor" TEXT,
    "id_partida" INTEGER,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "entrada_tela_linea_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entrada_tela_archivo" (
    "id" SERIAL NOT NULL,
    "id_entrada_tela" INTEGER NOT NULL,
    "id_archivo" TEXT NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,

    CONSTRAINT "entrada_tela_archivo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "entradas_tela_id_movimiento_key" ON "entradas_tela"("id_movimiento");

-- CreateIndex
CREATE INDEX "entradas_tela_id_proveedor_idx" ON "entradas_tela"("id_proveedor");

-- CreateIndex
CREATE INDEX "entradas_tela_id_almacen_idx" ON "entradas_tela"("id_almacen");

-- CreateIndex
CREATE INDEX "entradas_tela_estatus_idx" ON "entradas_tela"("estatus");

-- CreateIndex
CREATE INDEX "entradas_tela_numero_documento_idx" ON "entradas_tela"("numero_documento");

-- CreateIndex
CREATE UNIQUE INDEX "entradas_tela_id_empresa_folio_key" ON "entradas_tela"("id_empresa", "folio");

-- CreateIndex
CREATE INDEX "entrada_tela_linea_id_entrada_tela_idx" ON "entrada_tela_linea"("id_entrada_tela");

-- CreateIndex
CREATE INDEX "entrada_tela_linea_id_tela_color_idx" ON "entrada_tela_linea"("id_tela_color");

-- CreateIndex
CREATE INDEX "entrada_tela_linea_id_partida_idx" ON "entrada_tela_linea"("id_partida");

-- CreateIndex
CREATE INDEX "entrada_tela_archivo_id_entrada_tela_idx" ON "entrada_tela_archivo"("id_entrada_tela");

-- CreateIndex
CREATE UNIQUE INDEX "entrada_tela_archivo_id_archivo_key" ON "entrada_tela_archivo"("id_archivo");

-- CreateIndex
CREATE INDEX "recepcion_compra_linea_id_partida_idx" ON "recepcion_compra_linea"("id_partida");

-- AddForeignKey
ALTER TABLE "entradas_tela" ADD CONSTRAINT "entradas_tela_id_empresa_fkey" FOREIGN KEY ("id_empresa") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entradas_tela" ADD CONSTRAINT "entradas_tela_id_proveedor_fkey" FOREIGN KEY ("id_proveedor") REFERENCES "proveedores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entradas_tela" ADD CONSTRAINT "entradas_tela_id_almacen_fkey" FOREIGN KEY ("id_almacen") REFERENCES "almacenes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entradas_tela" ADD CONSTRAINT "entradas_tela_id_movimiento_fkey" FOREIGN KEY ("id_movimiento") REFERENCES "movimientos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entrada_tela_linea" ADD CONSTRAINT "entrada_tela_linea_id_entrada_tela_fkey" FOREIGN KEY ("id_entrada_tela") REFERENCES "entradas_tela"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entrada_tela_linea" ADD CONSTRAINT "entrada_tela_linea_id_tela_color_fkey" FOREIGN KEY ("id_tela_color") REFERENCES "telas_colores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entrada_tela_linea" ADD CONSTRAINT "entrada_tela_linea_id_partida_fkey" FOREIGN KEY ("id_partida") REFERENCES "partidas_tela"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entrada_tela_archivo" ADD CONSTRAINT "entrada_tela_archivo_id_entrada_tela_fkey" FOREIGN KEY ("id_entrada_tela") REFERENCES "entradas_tela"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entrada_tela_archivo" ADD CONSTRAINT "entrada_tela_archivo_id_archivo_fkey" FOREIGN KEY ("id_archivo") REFERENCES "archivos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recepcion_compra_linea" ADD CONSTRAINT "recepcion_compra_linea_id_partida_fkey" FOREIGN KEY ("id_partida") REFERENCES "partidas_tela"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

