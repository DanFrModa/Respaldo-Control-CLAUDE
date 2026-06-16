-- F2-E1 · Pedidos (Módulo PEDIDOS): los dos niveles de pedido del sistema viejo
-- (doc `Documentacion_MJD/02-Pedidos.md`): el pedido INTERNO (`pedidos` + `pedido_linea`,
-- ex `Pedidos`/`PedidosDet`) y el pedido REAL (`pedido_real` + `pedido_real_linea`,
-- ex `PedidosReales`/`PedidosRealesDet`). Migración ADITIVA (solo CREATE): 4 tablas con
-- sus índices y FKs. No altera tablas existentes (las relaciones inversas en
-- Empresa/Cliente/Modelo no cambian columnas).
-- Folio por empresa (A3/A9): `pedidos` lleva un unique (id_empresa, folio); el valor sale
-- de la secuencia atómica "pedido" (tabla `secuencias`, ya existente). Snapshots migrados
-- de SOLO LECTURA con sufijo `v1` (id_ord_compra_v1, entregado_parcial_v1, cant_faltante_v1).
-- Ver la sección "Pedidos (Módulo PEDIDOS, F2-E1)" de schema.prisma.

-- CreateTable
CREATE TABLE "pedidos" (
    "id" SERIAL NOT NULL,
    "folio" BIGINT NOT NULL,
    "id_empresa" INTEGER NOT NULL,
    "id_cliente" INTEGER NOT NULL,
    "fecha_pedido" DATE,
    "fecha_de" DATE,
    "fecha_hasta" DATE,
    "fecha_tela" DATE,
    "fecha_elaboracion" DATE,
    "entregado_tienda" BOOLEAN NOT NULL DEFAULT false,
    "no_producir" BOOLEAN NOT NULL DEFAULT false,
    "ped_cancelado" BOOLEAN NOT NULL DEFAULT false,
    "id_ord_compra_v1" INTEGER,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "pedidos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pedido_linea" (
    "id" SERIAL NOT NULL,
    "id_pedido" INTEGER NOT NULL,
    "id_modelo" INTEGER NOT NULL,
    "cantidad_pedida" INTEGER NOT NULL,
    "precio" DECIMAL(12,2) NOT NULL,
    "entregado_parcial_v1" INTEGER,
    "cant_faltante_v1" INTEGER,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "pedido_linea_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pedido_real" (
    "id" SERIAL NOT NULL,
    "id_pedido" INTEGER NOT NULL,
    "num_ped_real" TEXT,
    "cedis" TEXT,
    "apertura" TEXT,
    "fecha_ped_pr" DATE,
    "fecha_inicio" DATE,
    "fecha_fin" DATE,
    "fecha_entregada_real" DATE,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "pedido_real_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pedido_real_linea" (
    "id" SERIAL NOT NULL,
    "id_pedido_real" INTEGER NOT NULL,
    "id_pedido_linea" INTEGER NOT NULL,
    "cantidad_pr" INTEGER NOT NULL DEFAULT 0,
    "cantidad_enviada" INTEGER NOT NULL DEFAULT 0,
    "cantidad_entregada_real" INTEGER NOT NULL DEFAULT 0,
    "empaques" INTEGER NOT NULL DEFAULT 0,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "pedido_real_linea_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pedidos_id_cliente_idx" ON "pedidos"("id_cliente");

-- CreateIndex
CREATE UNIQUE INDEX "pedidos_id_empresa_folio_key" ON "pedidos"("id_empresa", "folio");

-- CreateIndex
CREATE INDEX "pedido_linea_id_pedido_idx" ON "pedido_linea"("id_pedido");

-- CreateIndex
CREATE INDEX "pedido_linea_id_modelo_idx" ON "pedido_linea"("id_modelo");

-- CreateIndex
CREATE INDEX "pedido_real_id_pedido_idx" ON "pedido_real"("id_pedido");

-- CreateIndex
CREATE INDEX "pedido_real_linea_id_pedido_real_idx" ON "pedido_real_linea"("id_pedido_real");

-- CreateIndex
CREATE INDEX "pedido_real_linea_id_pedido_linea_idx" ON "pedido_real_linea"("id_pedido_linea");

-- AddForeignKey
ALTER TABLE "pedidos" ADD CONSTRAINT "pedidos_id_empresa_fkey" FOREIGN KEY ("id_empresa") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedidos" ADD CONSTRAINT "pedidos_id_cliente_fkey" FOREIGN KEY ("id_cliente") REFERENCES "clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedido_linea" ADD CONSTRAINT "pedido_linea_id_pedido_fkey" FOREIGN KEY ("id_pedido") REFERENCES "pedidos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedido_linea" ADD CONSTRAINT "pedido_linea_id_modelo_fkey" FOREIGN KEY ("id_modelo") REFERENCES "modelos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedido_real" ADD CONSTRAINT "pedido_real_id_pedido_fkey" FOREIGN KEY ("id_pedido") REFERENCES "pedidos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedido_real_linea" ADD CONSTRAINT "pedido_real_linea_id_pedido_real_fkey" FOREIGN KEY ("id_pedido_real") REFERENCES "pedido_real"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedido_real_linea" ADD CONSTRAINT "pedido_real_linea_id_pedido_linea_fkey" FOREIGN KEY ("id_pedido_linea") REFERENCES "pedido_linea"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
