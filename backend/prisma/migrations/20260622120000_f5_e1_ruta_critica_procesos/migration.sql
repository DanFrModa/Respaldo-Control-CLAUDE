-- F5-E1 · RUTA CRÍTICA — catálogo configurable de procesos (Módulo 8 — doc
-- `Documentacion_MJD/08-Ruta-Critica.md`; D10/D11). Migración ADITIVA (solo CREATE TYPE +
-- CREATE TABLE + FKs/índices hacia tablas existentes): tres enums nuevos, cuatro tablas nuevas
-- (`proceso_def`, `proceso_def_rol`, `proceso_dep`, `proceso_checklist`) con sus índices y FKs.
-- NO altera columnas de tablas existentes (la relación inversa `procesos` en `roles` es virtual en
-- Prisma; la FK física vive en `proceso_def_rol`). SIN backfill, SIN seed de datos, SIN re-crear
-- permisos (los `rc.catalogo-*` viven en el catálogo de código + seed). Aplicable en limpio.
--
--   • proceso_def       — definición de un proceso de la RC (catálogo configurable y GLOBAL):
--                         criticidad, condición de aplicabilidad, tipo de evento y de duración.
--                         Borrado suave (`activo`).
--   • proceso_def_rol   — puente N:M proceso × rol responsable (sobre el RBAC único, A4).
--   • proceso_dep       — arista del DAG de dependencias (antecesor → proceso). El rechazo de
--                         ciclos vive en el dominio (`definirDependencias`).
--   • proceso_checklist — ítem de checklist configurable por proceso (orden + borrado suave).
-- Ver la sección "RUTA CRÍTICA" de schema.prisma y el TSDoc de src/dominio/ruta-critica/catalogoProcesos.ts.

-- CreateEnum
CREATE TYPE "condicion_aplicabilidad" AS ENUM ('ninguna', 'soloSiLlevaAplicacion');

-- CreateEnum
CREATE TYPE "tipo_evento_proceso" AS ENUM ('recepcionTela', 'corte', 'envioCostura', 'reciboCostura', 'envioEstampado', 'reciboEstampado', 'auditoria', 'autorizacionArte', 'entregaCliente', 'manual');

-- CreateEnum
CREATE TYPE "tipo_duracion_proceso" AS ENUM ('fija', 'porCantidad', 'porTipoTela', 'porAplicacion');

-- CreateTable
CREATE TABLE "proceso_def" (
    "id" SERIAL NOT NULL,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "critico" BOOLEAN NOT NULL DEFAULT false,
    "ultimo_proceso" BOOLEAN NOT NULL DEFAULT false,
    "es_resurtido" BOOLEAN NOT NULL DEFAULT false,
    "condicion_aplicabilidad" "condicion_aplicabilidad" NOT NULL DEFAULT 'ninguna',
    "tipo_evento" "tipo_evento_proceso" NOT NULL DEFAULT 'manual',
    "tipo_duracion" "tipo_duracion_proceso" NOT NULL DEFAULT 'fija',
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "proceso_def_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proceso_def_rol" (
    "id_proceso_def" INTEGER NOT NULL,
    "id_rol" INTEGER NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,

    CONSTRAINT "proceso_def_rol_pkey" PRIMARY KEY ("id_proceso_def", "id_rol")
);

-- CreateTable
CREATE TABLE "proceso_dep" (
    "id_proceso" INTEGER NOT NULL,
    "id_antecesor" INTEGER NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,

    CONSTRAINT "proceso_dep_pkey" PRIMARY KEY ("id_proceso", "id_antecesor")
);

-- CreateTable
CREATE TABLE "proceso_checklist" (
    "id" SERIAL NOT NULL,
    "id_proceso_def" INTEGER NOT NULL,
    "descripcion" TEXT NOT NULL,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "proceso_checklist_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "proceso_def_codigo_key" ON "proceso_def"("codigo");

-- CreateIndex
CREATE INDEX "proceso_def_rol_id_rol_idx" ON "proceso_def_rol"("id_rol");

-- CreateIndex
CREATE INDEX "proceso_dep_id_antecesor_idx" ON "proceso_dep"("id_antecesor");

-- CreateIndex
CREATE INDEX "proceso_checklist_id_proceso_def_idx" ON "proceso_checklist"("id_proceso_def");

-- AddForeignKey
ALTER TABLE "proceso_def_rol" ADD CONSTRAINT "proceso_def_rol_id_proceso_def_fkey" FOREIGN KEY ("id_proceso_def") REFERENCES "proceso_def"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proceso_def_rol" ADD CONSTRAINT "proceso_def_rol_id_rol_fkey" FOREIGN KEY ("id_rol") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proceso_dep" ADD CONSTRAINT "proceso_dep_id_proceso_fkey" FOREIGN KEY ("id_proceso") REFERENCES "proceso_def"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proceso_dep" ADD CONSTRAINT "proceso_dep_id_antecesor_fkey" FOREIGN KEY ("id_antecesor") REFERENCES "proceso_def"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proceso_checklist" ADD CONSTRAINT "proceso_checklist_id_proceso_def_fkey" FOREIGN KEY ("id_proceso_def") REFERENCES "proceso_def"("id") ON DELETE CASCADE ON UPDATE CASCADE;
