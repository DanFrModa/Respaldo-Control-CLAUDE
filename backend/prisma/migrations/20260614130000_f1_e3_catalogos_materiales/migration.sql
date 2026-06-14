-- F1-E3 · Catálogos de materiales: telas unificadas (D5), avíos (R1) y bordados con foto (R2).
-- Migración ADITIVA (solo CREATE): 2 enums + 6 tablas con sus índices y FKs. No altera
-- tablas existentes (las relaciones inversas en Color/Proveedor/Archivo no cambian columnas).
-- Ver docs/arquitectura/ADR-0009-materiales-f1e3.md y la sección "Catálogos de MATERIALES
-- (F1-E3)" de schema.prisma.

-- CreateEnum
CREATE TYPE "tipo_componente_tela" AS ENUM ('CUERPO', 'CARDIGAN', 'OTRO');

-- CreateEnum
CREATE TYPE "tipo_bordado" AS ENUM ('BORDADO', 'ESTAMPADO');

-- CreateTable
CREATE TABLE "telas_categorias" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "telas_categorias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telas" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "id_categoria" INTEGER,
    "unidad_medida" TEXT,
    "tipo_componente" "tipo_componente_tela" NOT NULL DEFAULT 'OTRO',
    "favorito" BOOLEAN NOT NULL DEFAULT false,
    "precio_sugerido" DECIMAL(12,2),
    "para_produccion" BOOLEAN NOT NULL DEFAULT true,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "telas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telas_colores" (
    "id_tela" INTEGER NOT NULL,
    "id_color" INTEGER NOT NULL,
    "precio" DECIMAL(12,2),
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "telas_colores_pkey" PRIMARY KEY ("id_tela","id_color")
);

-- CreateTable
CREATE TABLE "avios" (
    "id" SERIAL NOT NULL,
    "clave" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL,
    "unidad" TEXT,
    "presentacion" TEXT,
    "favorito" BOOLEAN NOT NULL DEFAULT false,
    "cant_fav" DECIMAL(12,2),
    "es_generico" BOOLEAN NOT NULL DEFAULT false,
    "precio_referencia" DECIMAL(12,2),
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "avios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "avio_proveedor" (
    "id_avio" INTEGER NOT NULL,
    "id_proveedor" INTEGER NOT NULL,
    "precio" DECIMAL(12,2),
    "condiciones" TEXT,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "avio_proveedor_pkey" PRIMARY KEY ("id_avio","id_proveedor")
);

-- CreateTable
CREATE TABLE "bordados" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "puntadas" INTEGER,
    "precio" DECIMAL(12,2),
    "tipo" "tipo_bordado" NOT NULL DEFAULT 'BORDADO',
    "id_archivo_foto" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "bordados_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "telas_categorias_nombre_key" ON "telas_categorias"("nombre");

-- CreateIndex
CREATE UNIQUE INDEX "telas_nombre_key" ON "telas"("nombre");

-- CreateIndex
CREATE INDEX "telas_colores_id_color_idx" ON "telas_colores"("id_color");

-- CreateIndex
CREATE UNIQUE INDEX "avios_clave_key" ON "avios"("clave");

-- CreateIndex
CREATE INDEX "avio_proveedor_id_proveedor_idx" ON "avio_proveedor"("id_proveedor");

-- CreateIndex
CREATE UNIQUE INDEX "bordados_nombre_key" ON "bordados"("nombre");

-- CreateIndex
CREATE UNIQUE INDEX "bordados_id_archivo_foto_key" ON "bordados"("id_archivo_foto");

-- AddForeignKey
ALTER TABLE "telas" ADD CONSTRAINT "telas_id_categoria_fkey" FOREIGN KEY ("id_categoria") REFERENCES "telas_categorias"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telas_colores" ADD CONSTRAINT "telas_colores_id_tela_fkey" FOREIGN KEY ("id_tela") REFERENCES "telas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telas_colores" ADD CONSTRAINT "telas_colores_id_color_fkey" FOREIGN KEY ("id_color") REFERENCES "colores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "avio_proveedor" ADD CONSTRAINT "avio_proveedor_id_avio_fkey" FOREIGN KEY ("id_avio") REFERENCES "avios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "avio_proveedor" ADD CONSTRAINT "avio_proveedor_id_proveedor_fkey" FOREIGN KEY ("id_proveedor") REFERENCES "proveedores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bordados" ADD CONSTRAINT "bordados_id_archivo_foto_fkey" FOREIGN KEY ("id_archivo_foto") REFERENCES "archivos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
