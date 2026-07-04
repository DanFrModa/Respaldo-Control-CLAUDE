-- F7-E5 · Inventario cíclico (Módulo Indicadores / Almacén; doc `Documentacion_MJD/05-Indicadores.md`;
-- ← forms `Alm_IC_Alta`/`Alm_IC_Cont`/`Alm_IC_Consulta`). Cuenta el físico contra el KARDEX de v2
-- (D3/D6): el ALTA congela el teórico por artículo, el conteo es CIEGO y el ajuste se aplica SOLO como
-- MOVIMIENTO de kardex (D3). A7 auditoría + cancelación suave, A9 por empresa.
-- Migración ADITIVA (SQL copiado 1:1 del canónico de `prisma migrate diff --from-empty --to-schema`;
-- `prisma validate` OK):
--  • 1 enum `estado_inventario_ciclico` (abierto/contado/cerrado/cancelado).
--  • 2 tablas nuevas: `inventarios_ciclicos` (encabezado) + `inventario_ciclico_det` (renglones a la
--    granularidad REAL del kardex, con `id_orden` nullable — F6-E2 "PT por orden"). No toca datos.
-- Los tipos de movimiento del ajuste (`ajuste-ciclico-entrada`/`-salida`) NO van aquí: los siembra
-- `seed.ts` con SEED_ON_START (idempotente) → el deploy a `prueba` REQUIERE SEED_ON_START=true.

-- CreateEnum
CREATE TYPE "estado_inventario_ciclico" AS ENUM ('abierto', 'contado', 'cerrado', 'cancelado');

-- CreateTable
CREATE TABLE "inventarios_ciclicos" (
    "id" SERIAL NOT NULL,
    "folio" BIGINT NOT NULL,
    "id_empresa" INTEGER NOT NULL,
    "id_almacen" INTEGER NOT NULL,
    "fecha" DATE NOT NULL,
    "estado" "estado_inventario_ciclico" NOT NULL DEFAULT 'abierto',
    "observaciones" TEXT,
    "cancelado_en" TIMESTAMP(3),
    "cancelado_por_id" TEXT,
    "motivo_cancelacion" TEXT,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "inventarios_ciclicos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventario_ciclico_det" (
    "id" SERIAL NOT NULL,
    "id_inventario_ciclico" INTEGER NOT NULL,
    "id_modelo" INTEGER NOT NULL,
    "id_color" INTEGER NOT NULL,
    "id_talla" INTEGER NOT NULL,
    "id_orden" INTEGER,
    "cant_teorica" INTEGER NOT NULL,
    "cant_real" INTEGER,
    "contado_en" TIMESTAMP(3),
    "contado_por_id" TEXT,
    "id_movimiento_ajuste" INTEGER,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "inventario_ciclico_det_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "inventarios_ciclicos_id_empresa_estado_idx" ON "inventarios_ciclicos"("id_empresa", "estado");

-- CreateIndex
CREATE INDEX "inventarios_ciclicos_id_almacen_idx" ON "inventarios_ciclicos"("id_almacen");

-- CreateIndex
CREATE UNIQUE INDEX "inventarios_ciclicos_id_empresa_folio_key" ON "inventarios_ciclicos"("id_empresa", "folio");

-- CreateIndex
CREATE INDEX "inventario_ciclico_det_id_inventario_ciclico_idx" ON "inventario_ciclico_det"("id_inventario_ciclico");

-- CreateIndex
CREATE INDEX "inventario_ciclico_det_id_movimiento_ajuste_idx" ON "inventario_ciclico_det"("id_movimiento_ajuste");

-- CreateIndex
CREATE UNIQUE INDEX "inventario_ciclico_det_id_inventario_ciclico_id_modelo_id_c_key" ON "inventario_ciclico_det"("id_inventario_ciclico", "id_modelo", "id_color", "id_talla", "id_orden");

-- AddForeignKey
ALTER TABLE "inventarios_ciclicos" ADD CONSTRAINT "inventarios_ciclicos_id_empresa_fkey" FOREIGN KEY ("id_empresa") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventarios_ciclicos" ADD CONSTRAINT "inventarios_ciclicos_id_almacen_fkey" FOREIGN KEY ("id_almacen") REFERENCES "almacenes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventario_ciclico_det" ADD CONSTRAINT "inventario_ciclico_det_id_inventario_ciclico_fkey" FOREIGN KEY ("id_inventario_ciclico") REFERENCES "inventarios_ciclicos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventario_ciclico_det" ADD CONSTRAINT "inventario_ciclico_det_id_modelo_fkey" FOREIGN KEY ("id_modelo") REFERENCES "modelos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventario_ciclico_det" ADD CONSTRAINT "inventario_ciclico_det_id_color_fkey" FOREIGN KEY ("id_color") REFERENCES "colores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventario_ciclico_det" ADD CONSTRAINT "inventario_ciclico_det_id_talla_fkey" FOREIGN KEY ("id_talla") REFERENCES "tallas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventario_ciclico_det" ADD CONSTRAINT "inventario_ciclico_det_id_orden_fkey" FOREIGN KEY ("id_orden") REFERENCES "ordenes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventario_ciclico_det" ADD CONSTRAINT "inventario_ciclico_det_id_movimiento_ajuste_fkey" FOREIGN KEY ("id_movimiento_ajuste") REFERENCES "movimientos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
