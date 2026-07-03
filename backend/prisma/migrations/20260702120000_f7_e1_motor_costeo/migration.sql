-- F7-E1 · Motor de costeo — costo REAL por orden (doc `Documentacion_MJD/06-Costos-y-EDR.md` §3;
-- DECISIONES.md D1/D2). Migración ADITIVA (SQL canónico de Prisma, verificado con
-- `prisma migrate diff`):
--  • 1 enum nuevo `base_prorrateo` (cortado|recibido|vendido) — base del costo unitario (D2).
--  • 1 tabla nueva `costo_orden` 1:1 con `ordenes` (idOrden @unique). Componentes en doble juego
--    teórico/guardado (`*_calc`/`*_cost`), `costo_total` = Σ guardados, `base_prorrateo` DEFAULT
--    'cortado'. La REGALÍA NO es componente (D2): va sobre la venta (lista de precios) — sin
--    columnas de regalías. Todo NULLABLE (componente sin capturar = 0 en el total, ceronulo).
-- NO toca tablas existentes. Sin re-seed de datos (los permisos nuevos los siembra `seed.ts` con
-- SEED_ON_START; `utilidadSugerida`/`regaliasBase` ya existen desde F0 — se consumen, no se recrean).

-- CreateEnum
CREATE TYPE "base_prorrateo" AS ENUM ('cortado', 'recibido', 'vendido');

-- CreateTable
CREATE TABLE "costo_orden" (
    "id" SERIAL NOT NULL,
    "id_orden" INTEGER NOT NULL,
    "id_empresa" INTEGER NOT NULL,
    "tela_calc" DECIMAL(14,2),
    "tela_cost" DECIMAL(14,2),
    "procesos_calc" DECIMAL(14,2),
    "procesos_cost" DECIMAL(14,2),
    "avios_calc" DECIMAL(14,2),
    "avios_cost" DECIMAL(14,2),
    "otros" DECIMAL(14,2),
    "desc_otros" TEXT,
    "costo_total" DECIMAL(14,2),
    "base_prorrateo" "base_prorrateo" NOT NULL DEFAULT 'cortado',
    "observaciones" TEXT,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "costo_orden_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "costo_orden_id_orden_key" ON "costo_orden"("id_orden");

-- CreateIndex
CREATE INDEX "costo_orden_id_empresa_idx" ON "costo_orden"("id_empresa");

-- AddForeignKey
ALTER TABLE "costo_orden" ADD CONSTRAINT "costo_orden_id_orden_fkey" FOREIGN KEY ("id_orden") REFERENCES "ordenes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "costo_orden" ADD CONSTRAINT "costo_orden_id_empresa_fkey" FOREIGN KEY ("id_empresa") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
