-- F4-E3 · RECEPCIÓN de compras (Módulo 3): el hecho que conecta la OC con el kardex de
-- materiales (doc `Documentacion_MJD/03-Produccion.md` §OC; R7). Migración ADITIVA (solo
-- CREATE + un AddForeignKey hacia tablas existentes): 3 tablas nuevas, sus índices y FKs. NO
-- altera columnas de tablas existentes (las relaciones inversas en Empresa/Almacen/Lote/
-- Movimiento/OrdenCompra/OrdenCompraLinea son virtuales en Prisma; las FK físicas viven en
-- las tablas nuevas). Aplicable en limpio.
--
--  • recepciones_compra      — encabezado: OC (oblig.), almacén destino, factura, fecha,
--                              folio por empresa (A3/A9, secuencia "recepcion-compra"),
--                              reverso suave (D3).
--  • recepcion_compra_linea  — cuánto se recibió contra cada renglón de OC, en UNIDAD DE
--                              CONSUMO ya convertida (R1), con su lote (D5) y el movimiento de
--                              kardex que generó (traza).
--  • eventos_outbox          — OUTBOX transaccional de eventos de dominio (ADR-0011): la fila
--                              se inserta en la MISMA tx de la recepción; el relay pg-boss la
--                              publica y marca publicado_en.
-- Ver la sección "RECEPCIÓN de compras" / "OUTBOX de eventos" de schema.prisma y el TSDoc de
-- src/dominio/compras/recepciones.ts + docs/arquitectura/ADR-0011-eventos-outbox-pgboss.md.

-- CreateTable
CREATE TABLE "recepciones_compra" (
    "id" SERIAL NOT NULL,
    "folio" BIGINT NOT NULL,
    "id_empresa" INTEGER NOT NULL,
    "id_orden_compra" INTEGER NOT NULL,
    "id_almacen" INTEGER NOT NULL,
    "factura" TEXT,
    "fecha" DATE NOT NULL,
    "observaciones" TEXT,
    "reversada_en" TIMESTAMP(3),
    "reversada_por_id" TEXT,
    "motivo_reverso" TEXT,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "recepciones_compra_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recepcion_compra_linea" (
    "id" SERIAL NOT NULL,
    "id_recepcion_compra" INTEGER NOT NULL,
    "id_orden_compra_linea" INTEGER NOT NULL,
    "cantidad_recibida" DECIMAL(14,4) NOT NULL,
    "costo_unit" DECIMAL(12,4),
    "id_lote" INTEGER,
    "id_movimiento" INTEGER,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "recepcion_compra_linea_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eventos_outbox" (
    "id" SERIAL NOT NULL,
    "tipo" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "id_empresa" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "publicado_en" TIMESTAMP(3),
    "intentos" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "eventos_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "recepciones_compra_id_orden_compra_idx" ON "recepciones_compra"("id_orden_compra");

-- CreateIndex
CREATE INDEX "recepciones_compra_id_almacen_idx" ON "recepciones_compra"("id_almacen");

-- CreateIndex
CREATE INDEX "recepciones_compra_reversada_en_idx" ON "recepciones_compra"("reversada_en");

-- CreateIndex
CREATE UNIQUE INDEX "recepciones_compra_id_empresa_folio_key" ON "recepciones_compra"("id_empresa", "folio");

-- CreateIndex
CREATE INDEX "recepcion_compra_linea_id_recepcion_compra_idx" ON "recepcion_compra_linea"("id_recepcion_compra");

-- CreateIndex
CREATE INDEX "recepcion_compra_linea_id_orden_compra_linea_idx" ON "recepcion_compra_linea"("id_orden_compra_linea");

-- CreateIndex
CREATE INDEX "recepcion_compra_linea_id_lote_idx" ON "recepcion_compra_linea"("id_lote");

-- CreateIndex
CREATE INDEX "recepcion_compra_linea_id_movimiento_idx" ON "recepcion_compra_linea"("id_movimiento");

-- CreateIndex
CREATE INDEX "eventos_outbox_publicado_en_idx" ON "eventos_outbox"("publicado_en");

-- CreateIndex
CREATE INDEX "eventos_outbox_id_empresa_idx" ON "eventos_outbox"("id_empresa");

-- AddForeignKey
ALTER TABLE "recepciones_compra" ADD CONSTRAINT "recepciones_compra_id_empresa_fkey" FOREIGN KEY ("id_empresa") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recepciones_compra" ADD CONSTRAINT "recepciones_compra_id_orden_compra_fkey" FOREIGN KEY ("id_orden_compra") REFERENCES "ordenes_compra"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recepciones_compra" ADD CONSTRAINT "recepciones_compra_id_almacen_fkey" FOREIGN KEY ("id_almacen") REFERENCES "almacenes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recepcion_compra_linea" ADD CONSTRAINT "recepcion_compra_linea_id_recepcion_compra_fkey" FOREIGN KEY ("id_recepcion_compra") REFERENCES "recepciones_compra"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recepcion_compra_linea" ADD CONSTRAINT "recepcion_compra_linea_id_orden_compra_linea_fkey" FOREIGN KEY ("id_orden_compra_linea") REFERENCES "orden_compra_linea"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recepcion_compra_linea" ADD CONSTRAINT "recepcion_compra_linea_id_lote_fkey" FOREIGN KEY ("id_lote") REFERENCES "lotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recepcion_compra_linea" ADD CONSTRAINT "recepcion_compra_linea_id_movimiento_fkey" FOREIGN KEY ("id_movimiento") REFERENCES "movimientos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eventos_outbox" ADD CONSTRAINT "eventos_outbox_id_empresa_fkey" FOREIGN KEY ("id_empresa") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
