-- F4-E5 · NOTAS DE SALIDA estructuradas (Módulo 5 — doc `Documentacion_MJD/03-Produccion.md`
-- §"Submódulo — Notas de Salida (Menú 3.4)"; 04-Inventarios.md §"Cómo conecta"; MEJORAS §03; R4/R9).
-- Migración ADITIVA (solo CREATE TYPE + CREATE TABLE + FKs hacia tablas existentes): un enum nuevo
-- (`estatus_nota_salida`), dos tablas nuevas (`notas_salida` + `nota_salida_linea`), sus índices y
-- FKs. NO altera columnas de tablas existentes (las relaciones inversas en empresas/proveedores/
-- ordenes/avios/telas/lotes/movimientos son virtuales en Prisma; la FK física vive en las tablas
-- nuevas). SIN backfill, SIN seed de datos, SIN re-crear permisos/tipos de movimiento (el permiso
-- `notas.*` y el tipo `salida-por-nota` ya viven en el catálogo de código + seed). Aplicable en limpio.
--
--   • notas_salida      — encabezado del documento de envío a un maquilero (Proveedor/tercero) contra
--                         una orden de producción. Folio `num_nota` por empresa (A3/A9). Confirmación
--                         (descuenta avíos) y cancelación suave (reverso auditado, D3).
--   • nota_salida_linea — renglón: AVÍO (descuenta kardex al confirmar → `salida-por-nota`) XOR TELA
--                         (REFERENCIA su movimiento `salida-tela-orden` de E1 — anti-doble-descuento,
--                         decisión (e): la nota NO descuenta tela otra vez).
-- Ver la sección "NOTAS DE SALIDA" de schema.prisma y el TSDoc de src/dominio/notas/notas-salida.ts.

-- CreateEnum
CREATE TYPE "estatus_nota_salida" AS ENUM ('borrador', 'confirmada', 'cancelada');

-- CreateTable
CREATE TABLE "notas_salida" (
    "id" SERIAL NOT NULL,
    "num_nota" BIGINT NOT NULL,
    "id_empresa" INTEGER NOT NULL,
    "id_maquilero" INTEGER NOT NULL,
    "id_almacen" INTEGER NOT NULL,
    "fecha_elaboracion" DATE NOT NULL,
    "fecha_envio" DATE,
    "estatus" "estatus_nota_salida" NOT NULL DEFAULT 'borrador',
    "observaciones" TEXT,
    "confirmada_en" TIMESTAMP(3),
    "confirmada_por_id" TEXT,
    "cancelada_en" TIMESTAMP(3),
    "cancelada_por_id" TEXT,
    "motivo_cancelacion" TEXT,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "notas_salida_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nota_salida_linea" (
    "id" SERIAL NOT NULL,
    "id_nota_salida" INTEGER NOT NULL,
    "id_orden" INTEGER NOT NULL,
    "id_avio" INTEGER,
    "id_tela" INTEGER,
    "id_lote" INTEGER,
    "id_movimiento_salida_tela" INTEGER,
    "id_movimiento_avio" INTEGER,
    "cantidad" DECIMAL(14,4) NOT NULL,
    "unidad" TEXT,
    "descripcion_legacy" TEXT,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "nota_salida_linea_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notas_salida_id_maquilero_idx" ON "notas_salida"("id_maquilero");

-- CreateIndex
CREATE INDEX "notas_salida_id_almacen_idx" ON "notas_salida"("id_almacen");

-- CreateIndex
CREATE INDEX "notas_salida_estatus_idx" ON "notas_salida"("estatus");

-- CreateIndex
CREATE INDEX "notas_salida_fecha_elaboracion_idx" ON "notas_salida"("fecha_elaboracion");

-- CreateIndex
CREATE UNIQUE INDEX "notas_salida_id_empresa_num_nota_key" ON "notas_salida"("id_empresa", "num_nota");

-- CreateIndex
CREATE INDEX "nota_salida_linea_id_nota_salida_idx" ON "nota_salida_linea"("id_nota_salida");

-- CreateIndex
CREATE INDEX "nota_salida_linea_id_orden_idx" ON "nota_salida_linea"("id_orden");

-- CreateIndex
CREATE INDEX "nota_salida_linea_id_avio_idx" ON "nota_salida_linea"("id_avio");

-- CreateIndex
CREATE INDEX "nota_salida_linea_id_tela_idx" ON "nota_salida_linea"("id_tela");

-- CreateIndex
CREATE INDEX "nota_salida_linea_id_lote_idx" ON "nota_salida_linea"("id_lote");

-- CreateIndex
CREATE INDEX "nota_salida_linea_id_movimiento_salida_tela_idx" ON "nota_salida_linea"("id_movimiento_salida_tela");

-- CreateIndex
CREATE INDEX "nota_salida_linea_id_movimiento_avio_idx" ON "nota_salida_linea"("id_movimiento_avio");

-- AddForeignKey
ALTER TABLE "notas_salida" ADD CONSTRAINT "notas_salida_id_empresa_fkey" FOREIGN KEY ("id_empresa") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notas_salida" ADD CONSTRAINT "notas_salida_id_maquilero_fkey" FOREIGN KEY ("id_maquilero") REFERENCES "proveedores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notas_salida" ADD CONSTRAINT "notas_salida_id_almacen_fkey" FOREIGN KEY ("id_almacen") REFERENCES "almacenes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nota_salida_linea" ADD CONSTRAINT "nota_salida_linea_id_nota_salida_fkey" FOREIGN KEY ("id_nota_salida") REFERENCES "notas_salida"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nota_salida_linea" ADD CONSTRAINT "nota_salida_linea_id_orden_fkey" FOREIGN KEY ("id_orden") REFERENCES "ordenes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nota_salida_linea" ADD CONSTRAINT "nota_salida_linea_id_avio_fkey" FOREIGN KEY ("id_avio") REFERENCES "avios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nota_salida_linea" ADD CONSTRAINT "nota_salida_linea_id_tela_fkey" FOREIGN KEY ("id_tela") REFERENCES "telas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nota_salida_linea" ADD CONSTRAINT "nota_salida_linea_id_lote_fkey" FOREIGN KEY ("id_lote") REFERENCES "lotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nota_salida_linea" ADD CONSTRAINT "nota_salida_linea_id_movimiento_salida_tela_fkey" FOREIGN KEY ("id_movimiento_salida_tela") REFERENCES "movimientos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nota_salida_linea" ADD CONSTRAINT "nota_salida_linea_id_movimiento_avio_fkey" FOREIGN KEY ("id_movimiento_avio") REFERENCES "movimientos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
