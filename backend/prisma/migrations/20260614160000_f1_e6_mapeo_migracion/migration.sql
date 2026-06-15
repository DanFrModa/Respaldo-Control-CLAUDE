-- F1-E6 · ETL de catálogos: tabla de MAPEO clave-vieja → id-nuevo (`mapeo_migracion`).
-- Migración ADITIVA (solo CREATE): 1 tabla + sus índices. No altera tablas existentes.
-- Es el entregable persistido que reutilizan los ETLs de fases futuras (E7/F2/F4/F9) para
-- traducir las FKs del sistema viejo (Access) a los ids nuevos.
-- Ver la sección "Migración del sistema viejo (F1-E6, ETL)" de schema.prisma.

-- CreateTable
CREATE TABLE "mapeo_migracion" (
    "id" SERIAL NOT NULL,
    "entidad" TEXT NOT NULL,
    "clave_vieja" TEXT NOT NULL,
    "id_nuevo" TEXT NOT NULL,
    "datos" JSONB,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modificado_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mapeo_migracion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "mapeo_migracion_entidad_id_nuevo_idx" ON "mapeo_migracion"("entidad", "id_nuevo");

-- CreateIndex
CREATE UNIQUE INDEX "mapeo_migracion_entidad_clave_vieja_key" ON "mapeo_migracion"("entidad", "clave_vieja");
