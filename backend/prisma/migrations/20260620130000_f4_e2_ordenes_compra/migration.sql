-- F4-E2 · Órdenes de COMPRA (Módulo 3): el documento con el que se COMPRA material
-- (telas/avíos) a un proveedor (doc `Documentacion_MJD/03-Produccion.md` §OC).
-- Migración ADITIVA (solo CREATE): 4 tablas + 1 enum, con sus índices y FKs. No altera
-- tablas existentes (las relaciones inversas en Empresa/Proveedor/Tela/Avio/Orden/Color/
-- Talla no cambian columnas). Folio por empresa (A3/A9): `ordenes_compra` lleva un unique
-- (id_empresa, num_compra); el valor sale de la secuencia atómica "orden-compra" (tabla
-- `secuencias`, ya existente). Decisión (c): matriz talla×color NATIVA por renglón
-- (`orden_compra_linea_talla`). Totales NO se persisten (se derivan por suma, D3). Aquí NO
-- se mueve kardex (eso es E3). Ver la sección "Órdenes de COMPRA (Módulo 3, F4-E2)" de
-- schema.prisma y el TSDoc de src/dominio/compras/ordenes-compra.ts.

-- CreateEnum
CREATE TYPE "estatus_orden_compra" AS ENUM ('borrador', 'pendiente_autorizacion', 'autorizada', 'recibida_parcial', 'recibida_total', 'cancelada');

-- CreateTable
CREATE TABLE "ordenes_compra" (
    "id" SERIAL NOT NULL,
    "num_compra" BIGINT NOT NULL,
    "id_empresa" INTEGER NOT NULL,
    "id_proveedor" INTEGER NOT NULL,
    "fecha" DATE,
    "fecha_entrega" DATE,
    "entrega_en" TEXT,
    "estatus" "estatus_orden_compra" NOT NULL DEFAULT 'borrador',
    "id_usu_autorizado" TEXT,
    "fecha_autorizado" TIMESTAMP(3),
    "cancelada_en" TIMESTAMP(3),
    "cancelada_por_id" TEXT,
    "motivo_cancelacion" TEXT,
    "observaciones" TEXT,
    "corresponde_a" TEXT,
    "facturas_amparadas_legacy" TEXT,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "ordenes_compra_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orden_compra_linea" (
    "id" SERIAL NOT NULL,
    "id_orden_compra" INTEGER NOT NULL,
    "id_tela" INTEGER,
    "id_avio" INTEGER,
    "id_avio_proveedor" INTEGER,
    "cantidad" DECIMAL(14,2) NOT NULL,
    "unidad" TEXT,
    "precio" DECIMAL(12,2) NOT NULL,
    "id_orden" INTEGER,
    "descripcion_libre" TEXT,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "orden_compra_linea_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orden_compra_linea_talla" (
    "id" SERIAL NOT NULL,
    "id_orden_compra_linea" INTEGER NOT NULL,
    "id_color" INTEGER NOT NULL,
    "id_talla" INTEGER NOT NULL,
    "cantidad" INTEGER NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "orden_compra_linea_talla_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orden_compra_orden" (
    "id" SERIAL NOT NULL,
    "id_orden_compra" INTEGER NOT NULL,
    "id_orden" INTEGER NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "orden_compra_orden_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ordenes_compra_id_proveedor_idx" ON "ordenes_compra"("id_proveedor");

-- CreateIndex
CREATE INDEX "ordenes_compra_estatus_idx" ON "ordenes_compra"("estatus");

-- CreateIndex
CREATE INDEX "ordenes_compra_fecha_idx" ON "ordenes_compra"("fecha");

-- CreateIndex
CREATE UNIQUE INDEX "ordenes_compra_id_empresa_num_compra_key" ON "ordenes_compra"("id_empresa", "num_compra");

-- CreateIndex
CREATE INDEX "orden_compra_linea_id_orden_compra_idx" ON "orden_compra_linea"("id_orden_compra");

-- CreateIndex
CREATE INDEX "orden_compra_linea_id_tela_idx" ON "orden_compra_linea"("id_tela");

-- CreateIndex
CREATE INDEX "orden_compra_linea_id_avio_idx" ON "orden_compra_linea"("id_avio");

-- CreateIndex
CREATE INDEX "orden_compra_linea_id_orden_idx" ON "orden_compra_linea"("id_orden");

-- CreateIndex
CREATE INDEX "orden_compra_linea_talla_id_orden_compra_linea_idx" ON "orden_compra_linea_talla"("id_orden_compra_linea");

-- CreateIndex
CREATE INDEX "orden_compra_linea_talla_id_color_idx" ON "orden_compra_linea_talla"("id_color");

-- CreateIndex
CREATE INDEX "orden_compra_linea_talla_id_talla_idx" ON "orden_compra_linea_talla"("id_talla");

-- CreateIndex
CREATE UNIQUE INDEX "orden_compra_linea_talla_id_orden_compra_linea_id_color_id__key" ON "orden_compra_linea_talla"("id_orden_compra_linea", "id_color", "id_talla");

-- CreateIndex
CREATE INDEX "orden_compra_orden_id_orden_compra_idx" ON "orden_compra_orden"("id_orden_compra");

-- CreateIndex
CREATE INDEX "orden_compra_orden_id_orden_idx" ON "orden_compra_orden"("id_orden");

-- CreateIndex
CREATE UNIQUE INDEX "orden_compra_orden_id_orden_compra_id_orden_key" ON "orden_compra_orden"("id_orden_compra", "id_orden");

-- AddForeignKey
ALTER TABLE "ordenes_compra" ADD CONSTRAINT "ordenes_compra_id_empresa_fkey" FOREIGN KEY ("id_empresa") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ordenes_compra" ADD CONSTRAINT "ordenes_compra_id_proveedor_fkey" FOREIGN KEY ("id_proveedor") REFERENCES "proveedores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orden_compra_linea" ADD CONSTRAINT "orden_compra_linea_id_orden_compra_fkey" FOREIGN KEY ("id_orden_compra") REFERENCES "ordenes_compra"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orden_compra_linea" ADD CONSTRAINT "orden_compra_linea_id_tela_fkey" FOREIGN KEY ("id_tela") REFERENCES "telas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orden_compra_linea" ADD CONSTRAINT "orden_compra_linea_id_avio_fkey" FOREIGN KEY ("id_avio") REFERENCES "avios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orden_compra_linea" ADD CONSTRAINT "orden_compra_linea_id_orden_fkey" FOREIGN KEY ("id_orden") REFERENCES "ordenes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orden_compra_linea_talla" ADD CONSTRAINT "orden_compra_linea_talla_id_orden_compra_linea_fkey" FOREIGN KEY ("id_orden_compra_linea") REFERENCES "orden_compra_linea"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orden_compra_linea_talla" ADD CONSTRAINT "orden_compra_linea_talla_id_color_fkey" FOREIGN KEY ("id_color") REFERENCES "colores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orden_compra_linea_talla" ADD CONSTRAINT "orden_compra_linea_talla_id_talla_fkey" FOREIGN KEY ("id_talla") REFERENCES "tallas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orden_compra_orden" ADD CONSTRAINT "orden_compra_orden_id_orden_compra_fkey" FOREIGN KEY ("id_orden_compra") REFERENCES "ordenes_compra"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orden_compra_orden" ADD CONSTRAINT "orden_compra_orden_id_orden_fkey" FOREIGN KEY ("id_orden") REFERENCES "ordenes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
