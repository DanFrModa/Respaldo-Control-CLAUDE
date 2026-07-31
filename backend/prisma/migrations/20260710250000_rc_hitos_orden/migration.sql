-- Cierre del hueco de EMISORES de la RC (post-F9), parte 2: la tabla `hito_orden` + el backfill del
-- catálogo `proceso_def`. Depende de los enums de la migración `20260710240000_rc_eventos_enums`
-- (SEPARADA y anterior: el UPDATE de abajo USA los valores nuevos de `tipo_evento_proceso`, que no
-- pueden agregarse y usarse en la misma transacción). Migración ADITIVA: crea 1 enum + 1 tabla + sus
-- índices/FKs y ACTUALIZA solo las filas del catálogo que sigan en 'manual' (no pisa ediciones a mano).
-- El SQL equivale al `prisma migrate diff` del schema (redactado a mano — sin Docker local, §7 CLAUDE.md).

-- CreateEnum
CREATE TYPE "tipo_hito_orden" AS ENUM ('revisionOp', 'fit', 'tonoTela', 'avios', 'empaque', 'arte');

-- CreateTable
CREATE TABLE "hito_orden" (
    "id" SERIAL NOT NULL,
    "id_empresa" INTEGER NOT NULL,
    "id_orden" INTEGER NOT NULL,
    "tipo" "tipo_hito_orden" NOT NULL,
    "registrado_por_id" TEXT,
    "fecha" DATE NOT NULL,
    "cancelado_en" TIMESTAMP(3),
    "cancelado_por_id" TEXT,
    "motivo_cancelacion" TEXT,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "hito_orden_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "hito_orden_id_empresa_idx" ON "hito_orden"("id_empresa");

-- CreateIndex
CREATE INDEX "hito_orden_id_orden_idx" ON "hito_orden"("id_orden");

-- CreateIndex
CREATE INDEX "hito_orden_tipo_idx" ON "hito_orden"("tipo");

-- CreateIndex
-- UNIQUE PARCIAL "un hito VIVO por orden+tipo": Prisma no expresa el WHERE parcial en el schema (igual
-- que las vistas `existencia_pt`/KPIs), así que el índice se crea a mano aquí. Los cancelados quedan
-- fuera (cancelado_en IS NOT NULL) → una orden puede tener un hito cancelado + uno vivo del mismo tipo,
-- y dos registros vivos concurrentes chocan (defensa en profundidad del ErrorConflicto del dominio).
CREATE UNIQUE INDEX "hito_orden_vivo_unico" ON "hito_orden"("id_orden", "tipo") WHERE "cancelado_en" IS NULL;

-- AddForeignKey
ALTER TABLE "hito_orden" ADD CONSTRAINT "hito_orden_id_empresa_fkey" FOREIGN KEY ("id_empresa") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hito_orden" ADD CONSTRAINT "hito_orden_id_orden_fkey" FOREIGN KEY ("id_orden") REFERENCES "ordenes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Data-only: los 8 procesos que Daniel dictó AUTOMÁTICOS y cuyo evento v2 YA emite (tras esta tarea)
-- pasan de 'manual' a su nuevo `tipo_evento`. SOLO donde siguen en 'manual', para NO pisar un valor
-- editado a mano en "Procesos y responsables" (mismo patrón que 20260710150000). El seed
-- (`seed-ruta-critica.ts`) ya trae estos valores para BDs NUEVAS, pero su upsert usa `update: {}`
-- (a propósito) → una BD ya sembrada (prueba) solo los recibe por este backfill.
UPDATE "proceso_def" SET "tipo_evento" = 'revisionOp'        WHERE "codigo" = 'revision-orden'         AND "tipo_evento" = 'manual';
UPDATE "proceso_def" SET "tipo_evento" = 'autorizacionFit'   WHERE "codigo" = 'autorizacion-fit'        AND "tipo_evento" = 'manual';
UPDATE "proceso_def" SET "tipo_evento" = 'compraTela'        WHERE "codigo" = 'orden-compra-tela'       AND "tipo_evento" = 'manual';
UPDATE "proceso_def" SET "tipo_evento" = 'autorizacionTono'  WHERE "codigo" = 'autorizacion-tono-tela'  AND "tipo_evento" = 'manual';
UPDATE "proceso_def" SET "tipo_evento" = 'autorizacionAvios' WHERE "codigo" = 'autorizacion-avios'      AND "tipo_evento" = 'manual';
UPDATE "proceso_def" SET "tipo_evento" = 'surtidoAvios'      WHERE "codigo" = 'surtido-avios'           AND "tipo_evento" = 'manual';
UPDATE "proceso_def" SET "tipo_evento" = 'auditoriaCorte'    WHERE "codigo" = 'auditoria-corte'         AND "tipo_evento" = 'manual';
UPDATE "proceso_def" SET "tipo_evento" = 'empaque'           WHERE "codigo" = 'empaque'                 AND "tipo_evento" = 'manual';
