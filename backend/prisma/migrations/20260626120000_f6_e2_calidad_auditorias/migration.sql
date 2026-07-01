-- F6-E2 · CALIDAD — núcleo transaccional de AUDITORÍAS de calidad (doc
-- `Documentacion_MJD/09-Control-de-Calidad.md` §1/§2/§4; DECISIONES.md §F6 (a)/(b)).
-- Migración ADITIVA: 2 enums + 2 tablas nuevas (`auditorias` + su detalle `auditoria_defecto`).
-- NO toca tablas existentes (solo agrega FKs a `empresas`/`ordenes`/`proveedores`/`defectos_catalogo`,
-- que ya existen). El folio `num_auditoria` es por secuencia atómica POR EMPRESA (A3) — reemplaza el
-- `Max()+1` del viejo (`AumentarNumAudit`); su unicidad la garantiza el índice (id_empresa, num_auditoria).
-- El RESULTADO se persiste MANUAL (decisión (a)); la severidad del defecto NO entra en ningún veredicto.

-- CreateEnum
CREATE TYPE "resultado_auditoria" AS ENUM ('aprobado', 'reprobado', 'no_calificado');

-- CreateEnum
CREATE TYPE "tipo_auditoria" AS ENUM ('en_piso', 'final', 'no_definida');

-- CreateTable
CREATE TABLE "auditorias" (
    "id" SERIAL NOT NULL,
    "num_auditoria" BIGINT NOT NULL,
    "id_empresa" INTEGER NOT NULL,
    "id_orden" INTEGER NOT NULL,
    "id_maquilero" INTEGER,
    "fecha_elaboracion" DATE NOT NULL,
    "fecha_auditoria" DATE NOT NULL,
    "elaboro_por_id" TEXT,
    "auditor_por_id" TEXT,
    "tamano_muestra" INTEGER NOT NULL,
    "muestra_manual" BOOLEAN NOT NULL DEFAULT false,
    "resultado" "resultado_auditoria" NOT NULL DEFAULT 'no_calificado',
    "resultado_manual" BOOLEAN NOT NULL DEFAULT true,
    "tipo_auditoria" "tipo_auditoria" NOT NULL DEFAULT 'no_definida',
    "observaciones" TEXT,
    "cancelada" BOOLEAN NOT NULL DEFAULT false,
    "cancelada_en" TIMESTAMP(3),
    "cancelada_por_id" TEXT,
    "motivo_cancelacion" TEXT,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "auditorias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auditoria_defecto" (
    "id" SERIAL NOT NULL,
    "id_auditoria" INTEGER NOT NULL,
    "id_defecto" INTEGER NOT NULL,
    "num_fallas" INTEGER NOT NULL DEFAULT 0,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "auditoria_defecto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "auditorias_id_empresa_num_auditoria_key" ON "auditorias"("id_empresa", "num_auditoria");

-- CreateIndex
CREATE INDEX "auditorias_id_empresa_idx" ON "auditorias"("id_empresa");

-- CreateIndex
CREATE INDEX "auditorias_id_orden_idx" ON "auditorias"("id_orden");

-- CreateIndex
CREATE INDEX "auditorias_id_maquilero_idx" ON "auditorias"("id_maquilero");

-- CreateIndex
CREATE UNIQUE INDEX "auditoria_defecto_id_auditoria_id_defecto_key" ON "auditoria_defecto"("id_auditoria", "id_defecto");

-- CreateIndex
CREATE INDEX "auditoria_defecto_id_defecto_idx" ON "auditoria_defecto"("id_defecto");

-- AddForeignKey
ALTER TABLE "auditorias" ADD CONSTRAINT "auditorias_id_empresa_fkey" FOREIGN KEY ("id_empresa") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auditorias" ADD CONSTRAINT "auditorias_id_orden_fkey" FOREIGN KEY ("id_orden") REFERENCES "ordenes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auditorias" ADD CONSTRAINT "auditorias_id_maquilero_fkey" FOREIGN KEY ("id_maquilero") REFERENCES "proveedores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auditoria_defecto" ADD CONSTRAINT "auditoria_defecto_id_auditoria_fkey" FOREIGN KEY ("id_auditoria") REFERENCES "auditorias"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auditoria_defecto" ADD CONSTRAINT "auditoria_defecto_id_defecto_fkey" FOREIGN KEY ("id_defecto") REFERENCES "defectos_catalogo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
