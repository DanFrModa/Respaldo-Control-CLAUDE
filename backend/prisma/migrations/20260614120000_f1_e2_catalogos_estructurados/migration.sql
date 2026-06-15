-- CreateEnum
CREATE TYPE "tipo_campo_cliente" AS ENUM ('TEXTO', 'NUMERO', 'FECHA');

-- CreateTable
CREATE TABLE "maquileros" (
    "id" SERIAL NOT NULL,
    "corto" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "apellidos" TEXT,
    "telefonos" TEXT,
    "direccion" TEXT,
    "observaciones" TEXT,
    "obs_pago" TEXT,
    "asegurado" BOOLEAN NOT NULL DEFAULT false,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "maquileros_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tipos_proceso" (
    "id" SERIAL NOT NULL,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "tipos_proceso_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maquilero_tipo_proceso" (
    "id_maquilero" INTEGER NOT NULL,
    "id_tipo_proceso" INTEGER NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,

    CONSTRAINT "maquilero_tipo_proceso_pkey" PRIMARY KEY ("id_maquilero","id_tipo_proceso")
);

-- CreateTable
CREATE TABLE "tallas" (
    "id" SERIAL NOT NULL,
    "etiqueta" TEXT NOT NULL,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "tallas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "curvas_talla" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "curvas_talla_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "curva_talla_item" (
    "id_curva" INTEGER NOT NULL,
    "id_talla" INTEGER NOT NULL,
    "posicion" INTEGER NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,

    CONSTRAINT "curva_talla_item_pkey" PRIMARY KEY ("id_curva","id_talla")
);

-- CreateTable
CREATE TABLE "clientes" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "contacto" TEXT,
    "telefono" TEXT,
    "email" TEXT,
    "direccion" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "clientes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cliente_campo" (
    "id" SERIAL NOT NULL,
    "id_cliente" INTEGER NOT NULL,
    "etiqueta" TEXT NOT NULL,
    "tipo" "tipo_campo_cliente" NOT NULL DEFAULT 'TEXTO',
    "orden" INTEGER NOT NULL DEFAULT 0,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "cliente_campo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "maquileros_corto_key" ON "maquileros"("corto");

-- CreateIndex
CREATE UNIQUE INDEX "tipos_proceso_codigo_key" ON "tipos_proceso"("codigo");

-- CreateIndex
CREATE INDEX "maquilero_tipo_proceso_id_tipo_proceso_idx" ON "maquilero_tipo_proceso"("id_tipo_proceso");

-- CreateIndex
CREATE UNIQUE INDEX "tallas_etiqueta_key" ON "tallas"("etiqueta");

-- CreateIndex
CREATE UNIQUE INDEX "curvas_talla_nombre_key" ON "curvas_talla"("nombre");

-- CreateIndex
CREATE INDEX "curva_talla_item_id_talla_idx" ON "curva_talla_item"("id_talla");

-- CreateIndex
CREATE UNIQUE INDEX "clientes_nombre_key" ON "clientes"("nombre");

-- CreateIndex
CREATE INDEX "cliente_campo_id_cliente_idx" ON "cliente_campo"("id_cliente");

-- CreateIndex
CREATE UNIQUE INDEX "cliente_campo_id_cliente_etiqueta_key" ON "cliente_campo"("id_cliente", "etiqueta");

-- AddForeignKey
ALTER TABLE "maquilero_tipo_proceso" ADD CONSTRAINT "maquilero_tipo_proceso_id_maquilero_fkey" FOREIGN KEY ("id_maquilero") REFERENCES "maquileros"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maquilero_tipo_proceso" ADD CONSTRAINT "maquilero_tipo_proceso_id_tipo_proceso_fkey" FOREIGN KEY ("id_tipo_proceso") REFERENCES "tipos_proceso"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "curva_talla_item" ADD CONSTRAINT "curva_talla_item_id_curva_fkey" FOREIGN KEY ("id_curva") REFERENCES "curvas_talla"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "curva_talla_item" ADD CONSTRAINT "curva_talla_item_id_talla_fkey" FOREIGN KEY ("id_talla") REFERENCES "tallas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cliente_campo" ADD CONSTRAINT "cliente_campo_id_cliente_fkey" FOREIGN KEY ("id_cliente") REFERENCES "clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
