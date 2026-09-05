-- ⭐ FILA 0.099 — EL CONTEO CÍCLICO, EXTENDIDO A TELAS Y AVÍOS (§Post-F9.193 puntos 4·5·6).
--
-- Hasta hoy el inventario cíclico COMPLETO —hoja con folio, teórico congelado al abrirla, captura,
-- estados, cancelación suave, hoja impresa y exactitud— existía SÓLO para producto terminado. Las
-- telas y los avíos se ajustaban a mano. Esta migración es ADITIVA y abre las otras dos dimensiones:
--
--  1. `dimension_inventario_ciclico` (PT/TELA/AVIO) + `inventarios_ciclicos.dimension` con
--     `DEFAULT 'PT'`: las hojas que ya existen se quedan EXACTAMENTE donde estaban. SIN backfill
--     (REGLA 0-B: lo viejo no se repara). La dimensión NO la elige el usuario — se DERIVA del
--     `almacenes.tipo` al dar de alta y se persiste aquí para que el resto del ciclo no tenga que
--     volver a preguntar.
--  2. `inventario_ciclico_det_tela`: un renglón por TELA×COLOR (la dimensión real de
--     `existencia_tela_color`), con DOS pares teórico/real —cuerpo y complemento (D5)— y DOS ligas
--     de ajuste, porque un mismo renglón puede necesitar a la vez una entrada (lo que faltó) y una
--     salida (lo que sobró).
--  3. `inventario_ciclico_det_avio`: un renglón por AVÍO (la dimensión real de `existencia_avio`;
--     el lote NO entra, R4).
--
-- Las cantidades de tela y avío son `DECIMAL(14,4)` — la MISMA escala que `movimiento_det_tela` /
-- `movimiento_det_avio`—, no enteros: se cuentan metros y kilos. El detalle de PT
-- (`inventario_ciclico_det`, `INTEGER`) NO se toca.
--
-- SIN permisos nuevos y SIN semillas nuevas: el conteo sigue bajo `indicadores.ciclicos-*` y el
-- ajuste reusa los tipos de movimiento `ajuste-ciclico-entrada` / `ajuste-ciclico-salida`, que ya
-- son genéricos (el encabezado del kardex es el mismo para PT/tela/avío — ADR-0010 §2).

-- CreateEnum
CREATE TYPE "dimension_inventario_ciclico" AS ENUM ('PT', 'TELA', 'AVIO');

-- AlterTable
ALTER TABLE "inventarios_ciclicos" ADD COLUMN     "dimension" "dimension_inventario_ciclico" NOT NULL DEFAULT 'PT';

-- CreateTable
CREATE TABLE "inventario_ciclico_det_tela" (
    "id" SERIAL NOT NULL,
    "id_inventario_ciclico" INTEGER NOT NULL,
    "id_tela_color" INTEGER NOT NULL,
    "cant_teorica" DECIMAL(14,4) NOT NULL,
    "cant_real" DECIMAL(14,4),
    "cant_teorica_complemento" DECIMAL(14,4),
    "cant_real_complemento" DECIMAL(14,4),
    "contado_en" TIMESTAMP(3),
    "contado_por_id" TEXT,
    "id_movimiento_ajuste_entrada" INTEGER,
    "id_movimiento_ajuste_salida" INTEGER,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "inventario_ciclico_det_tela_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventario_ciclico_det_avio" (
    "id" SERIAL NOT NULL,
    "id_inventario_ciclico" INTEGER NOT NULL,
    "id_avio" INTEGER NOT NULL,
    "cant_teorica" DECIMAL(14,4) NOT NULL,
    "cant_real" DECIMAL(14,4),
    "contado_en" TIMESTAMP(3),
    "contado_por_id" TEXT,
    "id_movimiento_ajuste" INTEGER,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "inventario_ciclico_det_avio_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "inventario_ciclico_det_tela_id_inventario_ciclico_idx" ON "inventario_ciclico_det_tela"("id_inventario_ciclico");

-- CreateIndex
CREATE INDEX "inventario_ciclico_det_tela_id_movimiento_ajuste_entrada_idx" ON "inventario_ciclico_det_tela"("id_movimiento_ajuste_entrada");

-- CreateIndex
CREATE INDEX "inventario_ciclico_det_tela_id_movimiento_ajuste_salida_idx" ON "inventario_ciclico_det_tela"("id_movimiento_ajuste_salida");

-- CreateIndex
CREATE UNIQUE INDEX "inventario_ciclico_det_tela_id_inventario_ciclico_id_tela_c_key" ON "inventario_ciclico_det_tela"("id_inventario_ciclico", "id_tela_color");

-- CreateIndex
CREATE INDEX "inventario_ciclico_det_avio_id_inventario_ciclico_idx" ON "inventario_ciclico_det_avio"("id_inventario_ciclico");

-- CreateIndex
CREATE INDEX "inventario_ciclico_det_avio_id_movimiento_ajuste_idx" ON "inventario_ciclico_det_avio"("id_movimiento_ajuste");

-- CreateIndex
CREATE UNIQUE INDEX "inventario_ciclico_det_avio_id_inventario_ciclico_id_avio_key" ON "inventario_ciclico_det_avio"("id_inventario_ciclico", "id_avio");

-- AddForeignKey
ALTER TABLE "inventario_ciclico_det_tela" ADD CONSTRAINT "inventario_ciclico_det_tela_id_inventario_ciclico_fkey" FOREIGN KEY ("id_inventario_ciclico") REFERENCES "inventarios_ciclicos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventario_ciclico_det_tela" ADD CONSTRAINT "inventario_ciclico_det_tela_id_tela_color_fkey" FOREIGN KEY ("id_tela_color") REFERENCES "telas_colores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventario_ciclico_det_tela" ADD CONSTRAINT "inventario_ciclico_det_tela_id_movimiento_ajuste_entrada_fkey" FOREIGN KEY ("id_movimiento_ajuste_entrada") REFERENCES "movimientos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventario_ciclico_det_tela" ADD CONSTRAINT "inventario_ciclico_det_tela_id_movimiento_ajuste_salida_fkey" FOREIGN KEY ("id_movimiento_ajuste_salida") REFERENCES "movimientos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventario_ciclico_det_avio" ADD CONSTRAINT "inventario_ciclico_det_avio_id_inventario_ciclico_fkey" FOREIGN KEY ("id_inventario_ciclico") REFERENCES "inventarios_ciclicos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventario_ciclico_det_avio" ADD CONSTRAINT "inventario_ciclico_det_avio_id_avio_fkey" FOREIGN KEY ("id_avio") REFERENCES "avios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventario_ciclico_det_avio" ADD CONSTRAINT "inventario_ciclico_det_avio_id_movimiento_ajuste_fkey" FOREIGN KEY ("id_movimiento_ajuste") REFERENCES "movimientos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

