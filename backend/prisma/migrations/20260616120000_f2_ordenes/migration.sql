-- F2-E2 · Órdenes de producción (Módulo ÓRDENES): el documento con el que se manda a
-- producir un renglón de un pedido (doc `Documentacion_MJD/03-Produccion.md` y `02-Pedidos.md`).
-- Migración ADITIVA (solo CREATE): 5 tablas + 1 enum, con sus índices y FKs. No altera tablas
-- existentes (las relaciones inversas en Empresa/PedidoLinea/Modelo/Cliente/Proveedor/
-- EtiquetaMarca/Tela/Color/Talla/ClienteCampo no cambian columnas).
-- Folio por empresa (A3/A9): `ordenes` lleva un unique (id_empresa, folio); el valor sale de la
-- secuencia atómica "orden" (tabla `secuencias`, ya existente). Snapshots/datos de v1 SIN motor
-- ni FK (RC=F5, finanzas=F3/F6, upc histórico, tallas_v1 crudo). Ver la sección "Órdenes de
-- producción (Módulo ÓRDENES, F2-E2)" de schema.prisma y el TSDoc de src/dominio/produccion/ordenes.ts.

-- CreateEnum
CREATE TYPE "estado_orden" AS ENUM ('capturada', 'completa', 'cancelada');

-- CreateTable
CREATE TABLE "ordenes" (
    "id" SERIAL NOT NULL,
    "folio" BIGINT NOT NULL,
    "id_empresa" INTEGER NOT NULL,
    "id_pedido_linea" INTEGER,
    "id_modelo" INTEGER NOT NULL,
    "id_cliente" INTEGER NOT NULL,
    "id_maquilero" INTEGER,
    "id_etiqueta_marca" INTEGER,
    "id_tela" INTEGER,
    "fecha" DATE,
    "fecha_entrega" DATE,
    "observaciones" TEXT,
    "tallas_v1" TEXT,
    "maquila_ord" DECIMAL(12,2),
    "aplicacion_ord" DECIMAL(12,2),
    "no_costear" BOOLEAN NOT NULL DEFAULT false,
    "composicion" TEXT,
    "comp_forzada" BOOLEAN NOT NULL DEFAULT false,
    "obs_maquila" TEXT,
    "pagada" BOOLEAN,
    "estado" "estado_orden" NOT NULL DEFAULT 'capturada',
    "fecha_completada" TIMESTAMP(3),
    "motivo_cancelada" TEXT,
    "upc" TEXT,
    "id_tipo_articulo_rc" INTEGER,
    "id_rc_aplicaciones" INTEGER,
    "id_rc_tipo_telas" INTEGER,
    "fecha_inicio_rc" TIMESTAMP(3),
    "fecha_entrega_rc" TIMESTAMP(3),
    "fecha_prog" TIMESTAMP(3),
    "en_riesgo" BOOLEAN,
    "si_rc" BOOLEAN,
    "rc_viva" BOOLEAN,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "ordenes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orden_linea" (
    "id" SERIAL NOT NULL,
    "id_orden" INTEGER NOT NULL,
    "id_color" INTEGER NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "orden_linea_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orden_linea_talla" (
    "id" SERIAL NOT NULL,
    "id_orden_linea" INTEGER NOT NULL,
    "id_talla" INTEGER NOT NULL,
    "cantidad" INTEGER NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "orden_linea_talla_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orden_referencia" (
    "id" SERIAL NOT NULL,
    "id_orden" INTEGER NOT NULL,
    "id_cliente_campo" INTEGER NOT NULL,
    "valor" TEXT NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "orden_referencia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orden_comentario" (
    "id" SERIAL NOT NULL,
    "id_orden" INTEGER NOT NULL,
    "id_usuario" TEXT,
    "comentario" TEXT NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orden_comentario_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ordenes_id_pedido_linea_idx" ON "ordenes"("id_pedido_linea");

-- CreateIndex
CREATE INDEX "ordenes_id_modelo_idx" ON "ordenes"("id_modelo");

-- CreateIndex
CREATE INDEX "ordenes_id_cliente_idx" ON "ordenes"("id_cliente");

-- CreateIndex
CREATE INDEX "ordenes_id_maquilero_idx" ON "ordenes"("id_maquilero");

-- CreateIndex
CREATE INDEX "ordenes_estado_idx" ON "ordenes"("estado");

-- CreateIndex
CREATE UNIQUE INDEX "ordenes_id_empresa_folio_key" ON "ordenes"("id_empresa", "folio");

-- CreateIndex
CREATE INDEX "orden_linea_id_orden_idx" ON "orden_linea"("id_orden");

-- CreateIndex
CREATE INDEX "orden_linea_id_color_idx" ON "orden_linea"("id_color");

-- CreateIndex
CREATE UNIQUE INDEX "orden_linea_id_orden_id_color_key" ON "orden_linea"("id_orden", "id_color");

-- CreateIndex
CREATE INDEX "orden_linea_talla_id_orden_linea_idx" ON "orden_linea_talla"("id_orden_linea");

-- CreateIndex
CREATE INDEX "orden_linea_talla_id_talla_idx" ON "orden_linea_talla"("id_talla");

-- CreateIndex
CREATE UNIQUE INDEX "orden_linea_talla_id_orden_linea_id_talla_key" ON "orden_linea_talla"("id_orden_linea", "id_talla");

-- CreateIndex
CREATE INDEX "orden_referencia_id_orden_idx" ON "orden_referencia"("id_orden");

-- CreateIndex
CREATE INDEX "orden_referencia_valor_idx" ON "orden_referencia"("valor");

-- CreateIndex
CREATE INDEX "orden_referencia_id_cliente_campo_valor_idx" ON "orden_referencia"("id_cliente_campo", "valor");

-- CreateIndex
CREATE UNIQUE INDEX "orden_referencia_id_orden_id_cliente_campo_key" ON "orden_referencia"("id_orden", "id_cliente_campo");

-- CreateIndex
CREATE INDEX "orden_comentario_id_orden_idx" ON "orden_comentario"("id_orden");

-- AddForeignKey
ALTER TABLE "ordenes" ADD CONSTRAINT "ordenes_id_empresa_fkey" FOREIGN KEY ("id_empresa") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ordenes" ADD CONSTRAINT "ordenes_id_pedido_linea_fkey" FOREIGN KEY ("id_pedido_linea") REFERENCES "pedido_linea"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ordenes" ADD CONSTRAINT "ordenes_id_modelo_fkey" FOREIGN KEY ("id_modelo") REFERENCES "modelos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ordenes" ADD CONSTRAINT "ordenes_id_cliente_fkey" FOREIGN KEY ("id_cliente") REFERENCES "clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ordenes" ADD CONSTRAINT "ordenes_id_maquilero_fkey" FOREIGN KEY ("id_maquilero") REFERENCES "proveedores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ordenes" ADD CONSTRAINT "ordenes_id_etiqueta_marca_fkey" FOREIGN KEY ("id_etiqueta_marca") REFERENCES "etiquetas_marca"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ordenes" ADD CONSTRAINT "ordenes_id_tela_fkey" FOREIGN KEY ("id_tela") REFERENCES "telas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orden_linea" ADD CONSTRAINT "orden_linea_id_orden_fkey" FOREIGN KEY ("id_orden") REFERENCES "ordenes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orden_linea" ADD CONSTRAINT "orden_linea_id_color_fkey" FOREIGN KEY ("id_color") REFERENCES "colores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orden_linea_talla" ADD CONSTRAINT "orden_linea_talla_id_orden_linea_fkey" FOREIGN KEY ("id_orden_linea") REFERENCES "orden_linea"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orden_linea_talla" ADD CONSTRAINT "orden_linea_talla_id_talla_fkey" FOREIGN KEY ("id_talla") REFERENCES "tallas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orden_referencia" ADD CONSTRAINT "orden_referencia_id_orden_fkey" FOREIGN KEY ("id_orden") REFERENCES "ordenes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orden_referencia" ADD CONSTRAINT "orden_referencia_id_cliente_campo_fkey" FOREIGN KEY ("id_cliente_campo") REFERENCES "cliente_campo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orden_comentario" ADD CONSTRAINT "orden_comentario_id_orden_fkey" FOREIGN KEY ("id_orden") REFERENCES "ordenes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
