-- ════════════════════════════════════════════════════════════════════════════════════════════
-- Fila 0.231 · LA OC DICE POR QUÉ EXISTE: reposición · merma · sobre-corte (§Post-F9.245(b))
-- ════════════════════════════════════════════════════════════════════════════════════════════
--
-- POR QUÉ EXISTE:
--   Daniel: una compra de más (material perdido, echado a perder, prendas cortadas de más) va en
--   una OC NUEVA «justo para saber que fue un sobre precio». Para SUMAR ese sobrecosto hace falta un
--   dato estructurado: `corresponde_a` es texto libre y contesta otra pregunta (para qué / para
--   quién), así que el motivo lo COMPLEMENTA, no lo sustituye.
--
-- QUÉ HACE:
--   • crea el catálogo GLOBAL `motivo_compra` (mismo patrón que `concepto_costo`); los tres motivos
--     base los siembra el seed idempotente (SEED_ON_START), no esta migración.
--   • agrega `ordenes_compra.id_motivo_compra` (NULL = compra normal), FK RESTRICT + índice.
--
-- ES ADITIVA y sin backfill (REGLA 0-B): las OC existentes quedan en NULL = compra normal.
-- ════════════════════════════════════════════════════════════════════════════════════════════

-- AlterTable
ALTER TABLE "ordenes_compra" ADD COLUMN     "id_motivo_compra" INTEGER;

-- CreateTable
CREATE TABLE "motivo_compra" (
    "id" SERIAL NOT NULL,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "fijo" BOOLEAN NOT NULL DEFAULT false,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "motivo_compra_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ordenes_compra_id_motivo_compra_idx" ON "ordenes_compra"("id_motivo_compra");

-- CreateIndex
CREATE UNIQUE INDEX "motivo_compra_codigo_key" ON "motivo_compra"("codigo");

-- AddForeignKey
ALTER TABLE "ordenes_compra" ADD CONSTRAINT "ordenes_compra_id_motivo_compra_fkey" FOREIGN KEY ("id_motivo_compra") REFERENCES "motivo_compra"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
