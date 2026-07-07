-- Rediseño R4 · Ruta Crítica operativa (B7/B10).
-- Migración ADITIVA pura (un valor de enum + un enum nuevo + una tabla + columnas nullable/default;
-- sin tocar datos existentes):
--  • B7 — dificultad DERIVADA del # de operaciones: valor `porDificultad` en el enum
--    `tipo_duracion_proceso`, tabla configurable `rango_dificultad` (rango de operaciones →
--    nombre + días de costura; `ops_hasta` NULL = abierto "33+") y `modelos.num_operaciones`
--    (la CAPTURA en el editor de desarrollo llega en R5; el motor ya la consume).
--  • B10 — secuencia del estampado respecto a la costura: enum `secuencia_estampado`
--    (antes|despues|flexible), `modelos.secuencia_estampado` (default 'antes': hoy el taller
--    estampa los paneles cortados antes de coser) y `ordenes.sec_estampado_elegido` (la elección
--    por orden de las FLEXIBLES; null = hereda/sin decidir).

-- B7: nuevo tipo de duración (ADD VALUE no se usa en esta misma migración → seguro en transacción).
ALTER TYPE "tipo_duracion_proceso" ADD VALUE 'porDificultad';

-- B7: tabla configurable de rangos de dificultad por # de operaciones (los rangos ACTIVOS no se
-- solapan — validación server-side en el dominio, no constraint de BD).
CREATE TABLE "rango_dificultad" (
    "id" SERIAL NOT NULL,
    "ops_desde" INTEGER NOT NULL,
    "ops_hasta" INTEGER,
    "nombre" TEXT NOT NULL,
    "dias_costura" INTEGER NOT NULL,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "rango_dificultad_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "rango_dificultad_ops_desde_idx" ON "rango_dificultad"("ops_desde");

-- B7: # de operaciones del modelo (nullable: sin capturar → el motor cae al tiempo estándar).
ALTER TABLE "modelos" ADD COLUMN "num_operaciones" INTEGER;

-- B10: secuencia de estampado (enum nuevo + columna por modelo + elección por orden).
CREATE TYPE "secuencia_estampado" AS ENUM ('antes', 'despues', 'flexible');
ALTER TABLE "modelos" ADD COLUMN "secuencia_estampado" "secuencia_estampado" NOT NULL DEFAULT 'antes';
ALTER TABLE "ordenes" ADD COLUMN "sec_estampado_elegido" "secuencia_estampado";
