-- F1-E4 · Modelos (Módulo 2): el catálogo de productos + su receta/BOM completa (telas,
-- avíos y bordados) + sus fotos en R2. Migración ADITIVA (solo CREATE): 1 enum + 6 tablas
-- con sus índices y FKs (el enum `tipo_bordado` ya existía de F1-E3). No altera tablas
-- existentes (las relaciones inversas en Temporada/CurvaTalla/Genero/Tela/Avio/Bordado/
-- Archivo no cambian columnas).
-- Ver doc `Documentacion_MJD/01-Modelos.md` y la sección "Modelos (Módulo 2, F1-E4)" de
-- schema.prisma.

-- CreateEnum
CREATE TYPE "tipo_foto_modelo" AS ENUM ('FRENTE', 'ESPALDA', 'OTRO');

-- CreateTable
CREATE TABLE "generos" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "generos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "modelos" (
    "id" SERIAL NOT NULL,
    "codigo" TEXT NOT NULL,
    "descripcion" TEXT,
    "maquila_base" DECIMAL(12,2),
    "id_temporada" INTEGER,
    "id_curva_talla" INTEGER,
    "id_genero" INTEGER,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "modelos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "modelo_foto" (
    "id" SERIAL NOT NULL,
    "id_modelo" INTEGER NOT NULL,
    "id_archivo" TEXT NOT NULL,
    "tipo" "tipo_foto_modelo" NOT NULL DEFAULT 'OTRO',
    "orden" INTEGER NOT NULL DEFAULT 0,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,

    CONSTRAINT "modelo_foto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "modelo_tela" (
    "id_modelo" INTEGER NOT NULL,
    "id_tela" INTEGER NOT NULL,
    "consumo_por_prenda" DECIMAL(12,4) NOT NULL,
    "para_pre_costo" BOOLEAN NOT NULL DEFAULT true,
    "para_produccion" BOOLEAN NOT NULL DEFAULT true,
    "para_costo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "modelo_tela_pkey" PRIMARY KEY ("id_modelo","id_tela")
);

-- CreateTable
CREATE TABLE "modelo_avio" (
    "id_modelo" INTEGER NOT NULL,
    "id_avio" INTEGER NOT NULL,
    "consumo_por_prenda" DECIMAL(12,4) NOT NULL,
    "para_pre_costo" BOOLEAN NOT NULL DEFAULT true,
    "para_produccion" BOOLEAN NOT NULL DEFAULT true,
    "para_costo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "modelo_avio_pkey" PRIMARY KEY ("id_modelo","id_avio")
);

-- CreateTable
CREATE TABLE "modelo_bordado" (
    "id_modelo" INTEGER NOT NULL,
    "id_bordado" INTEGER NOT NULL,
    "precio" DECIMAL(12,2),
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "modelo_bordado_pkey" PRIMARY KEY ("id_modelo","id_bordado")
);

-- CreateIndex
CREATE UNIQUE INDEX "generos_nombre_key" ON "generos"("nombre");

-- CreateIndex
CREATE UNIQUE INDEX "modelos_codigo_key" ON "modelos"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "modelo_foto_id_archivo_key" ON "modelo_foto"("id_archivo");

-- CreateIndex
CREATE INDEX "modelo_foto_id_modelo_idx" ON "modelo_foto"("id_modelo");

-- CreateIndex
CREATE INDEX "modelo_tela_id_tela_idx" ON "modelo_tela"("id_tela");

-- CreateIndex
CREATE INDEX "modelo_avio_id_avio_idx" ON "modelo_avio"("id_avio");

-- CreateIndex
CREATE INDEX "modelo_bordado_id_bordado_idx" ON "modelo_bordado"("id_bordado");

-- AddForeignKey
ALTER TABLE "modelos" ADD CONSTRAINT "modelos_id_temporada_fkey" FOREIGN KEY ("id_temporada") REFERENCES "temporadas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "modelos" ADD CONSTRAINT "modelos_id_curva_talla_fkey" FOREIGN KEY ("id_curva_talla") REFERENCES "curvas_talla"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "modelos" ADD CONSTRAINT "modelos_id_genero_fkey" FOREIGN KEY ("id_genero") REFERENCES "generos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "modelo_foto" ADD CONSTRAINT "modelo_foto_id_modelo_fkey" FOREIGN KEY ("id_modelo") REFERENCES "modelos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "modelo_foto" ADD CONSTRAINT "modelo_foto_id_archivo_fkey" FOREIGN KEY ("id_archivo") REFERENCES "archivos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "modelo_tela" ADD CONSTRAINT "modelo_tela_id_modelo_fkey" FOREIGN KEY ("id_modelo") REFERENCES "modelos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "modelo_tela" ADD CONSTRAINT "modelo_tela_id_tela_fkey" FOREIGN KEY ("id_tela") REFERENCES "telas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "modelo_avio" ADD CONSTRAINT "modelo_avio_id_modelo_fkey" FOREIGN KEY ("id_modelo") REFERENCES "modelos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "modelo_avio" ADD CONSTRAINT "modelo_avio_id_avio_fkey" FOREIGN KEY ("id_avio") REFERENCES "avios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "modelo_bordado" ADD CONSTRAINT "modelo_bordado_id_modelo_fkey" FOREIGN KEY ("id_modelo") REFERENCES "modelos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "modelo_bordado" ADD CONSTRAINT "modelo_bordado_id_bordado_fkey" FOREIGN KEY ("id_bordado") REFERENCES "bordados"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
