-- CreateEnum
CREATE TYPE "tipo_proveedor" AS ENUM ('TELAS', 'AVIOS', 'SERVICIOS', 'SIN_CLASIFICAR');

-- CreateTable
CREATE TABLE "proveedores" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "razon_social" TEXT,
    "tipo" "tipo_proveedor" NOT NULL DEFAULT 'SIN_CLASIFICAR',
    "telefono" TEXT,
    "contacto" TEXT,
    "condiciones" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "proveedores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cortadores" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "precio_referencia" DECIMAL(12,2),
    "telefonos" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "cortadores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "temporadas" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "temporadas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "etiquetas_marca" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "regalias" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "etiquetas_marca_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "colores" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "colores_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "proveedores_nombre_key" ON "proveedores"("nombre");

-- CreateIndex
CREATE UNIQUE INDEX "cortadores_nombre_key" ON "cortadores"("nombre");

-- CreateIndex
CREATE UNIQUE INDEX "temporadas_nombre_key" ON "temporadas"("nombre");

-- CreateIndex
CREATE UNIQUE INDEX "etiquetas_marca_nombre_key" ON "etiquetas_marca"("nombre");

-- CreateIndex
CREATE UNIQUE INDEX "colores_nombre_key" ON "colores"("nombre");

