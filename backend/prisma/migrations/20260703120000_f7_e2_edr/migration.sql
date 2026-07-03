-- F7-E2 · Estado de Resultados (EDR) — P&L mensual generado (doc `Documentacion_MJD/06-Costos-y-EDR.md`
-- §4; DECISIONES.md D1/D2). Migración ADITIVA (SQL canónico de Prisma, verificado con
-- `prisma migrate diff`):
--  • 1 enum nuevo `edr_origen_linea` (automatica|ajustada|manual) — gobierna la reconciliación del
--    generador (automáticas se re-proponen; ajustadas/manuales no se tocan).
--  • 1 tabla nueva `edr` — encabezado GLOBAL por mes (@@unique anio,mes). SIN id_empresa: el EDR es
--    CONSOLIDADO (D2 #6); gastos/intereses/bonificaciones/otros son GLOBALES del mes. Ventas y Costo
--    se DERIVAN de las líneas al leer (no se persisten).
--  • 1 tabla nueva `edr_linea` — una venta por orden/modelo (← `EdoResultDet`). El PRECIO es lo
--    FACTURADO (editable, D2 #5); el COSTO NO se guarda (D1: costo ACTUAL desde `costo_orden`).
--    `costo_historico` es NULLABLE y solo-informativa (la llena el ETL de E6). Unique (id_edr,
--    id_orden) ancla la idempotencia; los NULL de las manuales conviven (Postgres permite N NULL).
-- NO toca tablas existentes. Sin re-seed de datos (los permisos nuevos `edr.*` los siembra `seed.ts`
-- con SEED_ON_START).

-- CreateEnum
CREATE TYPE "edr_origen_linea" AS ENUM ('automatica', 'ajustada', 'manual');

-- CreateTable
CREATE TABLE "edr" (
    "id" SERIAL NOT NULL,
    "anio" INTEGER NOT NULL,
    "mes" INTEGER NOT NULL,
    "gastos" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "intereses" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "bonificaciones" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "otros" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "desc_otros" TEXT,
    "observaciones" TEXT,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "edr_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "edr_linea" (
    "id" SERIAL NOT NULL,
    "id_edr" INTEGER NOT NULL,
    "id_orden" INTEGER,
    "id_empresa" INTEGER NOT NULL,
    "id_cliente" INTEGER,
    "id_modelo" INTEGER,
    "descripcion" TEXT,
    "cant_vendida" INTEGER NOT NULL,
    "precio_venta" DECIMAL(14,2) NOT NULL,
    "costo_historico" DECIMAL(14,2),
    "origen" "edr_origen_linea" NOT NULL DEFAULT 'automatica',
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "edr_linea_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "edr_anio_mes_key" ON "edr"("anio", "mes");

-- CreateIndex
CREATE INDEX "edr_linea_id_edr_idx" ON "edr_linea"("id_edr");

-- CreateIndex
CREATE INDEX "edr_linea_id_empresa_idx" ON "edr_linea"("id_empresa");

-- CreateIndex
CREATE INDEX "edr_linea_id_cliente_idx" ON "edr_linea"("id_cliente");

-- CreateIndex
CREATE INDEX "edr_linea_id_modelo_idx" ON "edr_linea"("id_modelo");

-- CreateIndex
CREATE INDEX "edr_linea_id_orden_idx" ON "edr_linea"("id_orden");

-- CreateIndex
CREATE UNIQUE INDEX "edr_linea_id_edr_id_orden_key" ON "edr_linea"("id_edr", "id_orden");

-- AddForeignKey
ALTER TABLE "edr_linea" ADD CONSTRAINT "edr_linea_id_edr_fkey" FOREIGN KEY ("id_edr") REFERENCES "edr"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "edr_linea" ADD CONSTRAINT "edr_linea_id_orden_fkey" FOREIGN KEY ("id_orden") REFERENCES "ordenes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "edr_linea" ADD CONSTRAINT "edr_linea_id_empresa_fkey" FOREIGN KEY ("id_empresa") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "edr_linea" ADD CONSTRAINT "edr_linea_id_cliente_fkey" FOREIGN KEY ("id_cliente") REFERENCES "clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "edr_linea" ADD CONSTRAINT "edr_linea_id_modelo_fkey" FOREIGN KEY ("id_modelo") REFERENCES "modelos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
