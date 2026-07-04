-- F6-E1 · CALIDAD — base configurable del Control de calidad (doc
-- `Documentacion_MJD/09-Control-de-Calidad.md` §2/§5; MEJORAS 09; DECISIONES.md §F6 (a)–(d)).
-- Migración ADITIVA: 6 tablas nuevas (catálogo de defectos enriquecido, tipos de producto, su
-- puente M:N, y el motor de planes de muestreo AQL como DATOS) + 1 columna NULLABLE en la tabla
-- existente `modelos` (`id_tipo_producto`, sin default → no rompe los modelos ya sembrados;
-- regla de la etapa: las columnas nuevas en tablas existentes van NULLABLE). El núcleo
-- transaccional de auditorías llega en F6-E2. Ver la sección "CALIDAD (F6-E1)" de schema.prisma.

-- CreateEnum
CREATE TYPE "severidad_defecto" AS ENUM ('critico', 'mayor', 'menor');

-- AlterTable (NULLABLE, sin default: no rompe los modelos existentes — se asigna desde la UI)
ALTER TABLE "modelos" ADD COLUMN     "id_tipo_producto" INTEGER;

-- CreateTable
CREATE TABLE "tipos_producto" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "tipos_producto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "defectos_catalogo" (
    "id" SERIAL NOT NULL,
    "clave" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL,
    "pag" TEXT,
    "nivel_aql" DECIMAL(4,2) NOT NULL,
    "favorito" BOOLEAN NOT NULL DEFAULT false,
    "categoria" TEXT,
    "severidad" "severidad_defecto" NOT NULL DEFAULT 'menor',
    "aplica_general" BOOLEAN NOT NULL DEFAULT false,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "defectos_catalogo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "defecto_tipo_producto" (
    "id_defecto" INTEGER NOT NULL,
    "id_tipo_producto" INTEGER NOT NULL,

    CONSTRAINT "defecto_tipo_producto_pkey" PRIMARY KEY ("id_defecto","id_tipo_producto")
);

-- CreateTable
CREATE TABLE "planes_muestreo_aql" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "planes_muestreo_aql_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_muestreo_renglon" (
    "id" SERIAL NOT NULL,
    "id_plan" INTEGER NOT NULL,
    "lote_min" INTEGER NOT NULL,
    "lote_max" INTEGER,
    "tamano_muestra" INTEGER NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "plan_muestreo_renglon_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_muestreo_limite" (
    "id" SERIAL NOT NULL,
    "id_renglon" INTEGER NOT NULL,
    "nivel_aql" DECIMAL(4,2) NOT NULL,
    "aceptar" INTEGER NOT NULL,
    "rechazar" INTEGER NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "plan_muestreo_limite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tipos_producto_nombre_key" ON "tipos_producto"("nombre");

-- CreateIndex
CREATE UNIQUE INDEX "defectos_catalogo_clave_key" ON "defectos_catalogo"("clave");

-- CreateIndex
CREATE INDEX "defecto_tipo_producto_id_tipo_producto_idx" ON "defecto_tipo_producto"("id_tipo_producto");

-- CreateIndex
CREATE UNIQUE INDEX "planes_muestreo_aql_nombre_key" ON "planes_muestreo_aql"("nombre");

-- CreateIndex
CREATE INDEX "plan_muestreo_renglon_id_plan_idx" ON "plan_muestreo_renglon"("id_plan");

-- CreateIndex
CREATE UNIQUE INDEX "plan_muestreo_limite_id_renglon_nivel_aql_key" ON "plan_muestreo_limite"("id_renglon", "nivel_aql");

-- AddForeignKey
ALTER TABLE "modelos" ADD CONSTRAINT "modelos_id_tipo_producto_fkey" FOREIGN KEY ("id_tipo_producto") REFERENCES "tipos_producto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "defecto_tipo_producto" ADD CONSTRAINT "defecto_tipo_producto_id_defecto_fkey" FOREIGN KEY ("id_defecto") REFERENCES "defectos_catalogo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "defecto_tipo_producto" ADD CONSTRAINT "defecto_tipo_producto_id_tipo_producto_fkey" FOREIGN KEY ("id_tipo_producto") REFERENCES "tipos_producto"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_muestreo_renglon" ADD CONSTRAINT "plan_muestreo_renglon_id_plan_fkey" FOREIGN KEY ("id_plan") REFERENCES "planes_muestreo_aql"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_muestreo_limite" ADD CONSTRAINT "plan_muestreo_limite_id_renglon_fkey" FOREIGN KEY ("id_renglon") REFERENCES "plan_muestreo_renglon"("id") ON DELETE CASCADE ON UPDATE CASCADE;
