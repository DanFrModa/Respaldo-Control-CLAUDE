-- F5-E3 · RUTA CRÍTICA — Ruta viva por orden + motor de generación pt1 (Módulo 8 — doc
-- `Documentacion_MJD/08-Ruta-Critica.md` §2.3 y §4; D10/D11; A2/A7). Migración ADITIVA: solo
-- CREATE TYPE / CREATE TABLE / ADD COLUMN (todas nullable) / índices / FKs hacia tablas
-- existentes. NO altera ni hace backfill de columnas existentes; aplicable en limpio y sobre la
-- BD de `prueba` (que ya tiene órdenes ETL: por eso los campos nuevos de `ordenes` son nullable).
--
--   • estado_proceso_ruta / origen_captura — enums del avance simple de un proceso de la ruta viva
--     (el SEMÁFORO de cumplimiento es E4 y NO entra aquí).
--   • ordenes (ALTER) — campos de PROGRAMACIÓN de la RC de v2 (rc_activa, fecha_programada,
--     es_resurtido_rc) + FKs a los catálogos de E2 (artículo RC, tipo de tela, aplicación). Los
--     escalares legados de v1 (id_tipo_articulo_rc / id_rc_aplicaciones / id_rc_tipo_telas / …) se
--     CONSERVAN sin tocar (datos ETL); la programación de v2 usa estos campos nuevos.
--   • ruta_orden — un renglón por proceso de la ruta de UNA orden (explotación analítica D11), con
--     snapshot de banderas al generar, duración estimada, fechas (planeadas las llena el CPM de E4)
--     y estado. Unique (id_orden, id_proceso_def).
--   • ruta_orden_dep — snapshot del DAG de dependencias de la ruta de ESA orden (editable sin tocar
--     la plantilla, D10). PK compuesta; rechazo de ciclos en el dominio (reusa `grafo.ts`).
--   • ruta_orden_checklist — snapshot del checklist del proceso, marcable por orden.
--
-- SIN seed de datos. Permisos NUEVOS (`rc.programar`, `rc.ruta-ver`) viven en el catálogo tipado
-- (`src/contrato`) y se siembran al arrancar con SEED_ON_START=true (idempotente); esta migración
-- NO inserta permisos. El job de CPM (E4) consumirá `ruta_orden`; en E3 la ruta queda en estado
-- "fechas pendientes de cálculo".

-- CreateEnum
CREATE TYPE "estado_proceso_ruta" AS ENUM ('pendiente', 'activo', 'completado');

-- CreateEnum
CREATE TYPE "origen_captura" AS ENUM ('manual', 'evento');

-- AlterTable
ALTER TABLE "ordenes" ADD COLUMN     "es_resurtido_rc" BOOLEAN,
ADD COLUMN     "fecha_programada" TIMESTAMP(3),
ADD COLUMN     "id_articulo_rc_prog" INTEGER,
ADD COLUMN     "id_duracion_aplicacion" INTEGER,
ADD COLUMN     "id_duracion_tela" INTEGER,
ADD COLUMN     "rc_activa" BOOLEAN;

-- CreateTable
CREATE TABLE "ruta_orden" (
    "id" SERIAL NOT NULL,
    "id_orden" INTEGER NOT NULL,
    "id_proceso_def" INTEGER NOT NULL,
    "secuencia" INTEGER NOT NULL DEFAULT 0,
    "critico" BOOLEAN NOT NULL DEFAULT false,
    "ultimo_proceso" BOOLEAN NOT NULL DEFAULT false,
    "es_resurtido" BOOLEAN NOT NULL DEFAULT false,
    "condicion_aplicabilidad" "condicion_aplicabilidad" NOT NULL DEFAULT 'ninguna',
    "duracion_dias" INTEGER NOT NULL,
    "acumulado_dias" INTEGER,
    "fecha_planeada_original" TIMESTAMP(3),
    "fecha_planeada_vigente" TIMESTAMP(3),
    "fecha_real" TIMESTAMP(3),
    "estado" "estado_proceso_ruta" NOT NULL DEFAULT 'pendiente',
    "capturado_por_id" TEXT,
    "capturado_en" TIMESTAMP(3),
    "origen_captura" "origen_captura",
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "ruta_orden_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ruta_orden_dep" (
    "id_ruta_orden" INTEGER NOT NULL,
    "id_antecesor" INTEGER NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,

    CONSTRAINT "ruta_orden_dep_pkey" PRIMARY KEY ("id_ruta_orden","id_antecesor")
);

-- CreateTable
CREATE TABLE "ruta_orden_checklist" (
    "id" SERIAL NOT NULL,
    "id_ruta_orden" INTEGER NOT NULL,
    "descripcion" TEXT NOT NULL,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "hecho" BOOLEAN NOT NULL DEFAULT false,
    "fecha_hecho" TIMESTAMP(3),
    "hecho_por_id" TEXT,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "ruta_orden_checklist_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ruta_orden_id_orden_idx" ON "ruta_orden"("id_orden");

-- CreateIndex
CREATE INDEX "ruta_orden_id_proceso_def_idx" ON "ruta_orden"("id_proceso_def");

-- CreateIndex
CREATE UNIQUE INDEX "ruta_orden_id_orden_id_proceso_def_key" ON "ruta_orden"("id_orden", "id_proceso_def");

-- CreateIndex
CREATE INDEX "ruta_orden_dep_id_antecesor_idx" ON "ruta_orden_dep"("id_antecesor");

-- CreateIndex
CREATE INDEX "ruta_orden_checklist_id_ruta_orden_idx" ON "ruta_orden_checklist"("id_ruta_orden");

-- AddForeignKey
ALTER TABLE "ordenes" ADD CONSTRAINT "ordenes_id_articulo_rc_prog_fkey" FOREIGN KEY ("id_articulo_rc_prog") REFERENCES "articulo_rc"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ordenes" ADD CONSTRAINT "ordenes_id_duracion_tela_fkey" FOREIGN KEY ("id_duracion_tela") REFERENCES "duracion_tipo_tela"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ordenes" ADD CONSTRAINT "ordenes_id_duracion_aplicacion_fkey" FOREIGN KEY ("id_duracion_aplicacion") REFERENCES "duracion_aplicacion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ruta_orden" ADD CONSTRAINT "ruta_orden_id_orden_fkey" FOREIGN KEY ("id_orden") REFERENCES "ordenes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ruta_orden" ADD CONSTRAINT "ruta_orden_id_proceso_def_fkey" FOREIGN KEY ("id_proceso_def") REFERENCES "proceso_def"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ruta_orden_dep" ADD CONSTRAINT "ruta_orden_dep_id_ruta_orden_fkey" FOREIGN KEY ("id_ruta_orden") REFERENCES "ruta_orden"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ruta_orden_dep" ADD CONSTRAINT "ruta_orden_dep_id_antecesor_fkey" FOREIGN KEY ("id_antecesor") REFERENCES "ruta_orden"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ruta_orden_checklist" ADD CONSTRAINT "ruta_orden_checklist_id_ruta_orden_fkey" FOREIGN KEY ("id_ruta_orden") REFERENCES "ruta_orden"("id") ON DELETE CASCADE ON UPDATE CASCADE;
