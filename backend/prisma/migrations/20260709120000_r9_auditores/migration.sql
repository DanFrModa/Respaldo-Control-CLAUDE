-- R9 · AUDITORES — catálogo de auditores de calidad (proto `CAT_AUDITORES`). Migración ADITIVA:
-- 1 tabla nueva GLOBAL (A9, sin id_empresa), CRUD patrón catálogo con borrado suave. `rol` y
-- `nivel_aql` se guardan como texto y se validan a listas cerradas en el dominio (A1); el conteo
-- de auditorías NO se persiste (se deriva del histórico por `auditorias.auditor_por_id`). SIN
-- permiso nuevo (reúsa `calidad.ver` / `calidad.administrar-catalogo`). Ver el modelo `Auditor`
-- en schema.prisma.

-- CreateTable
CREATE TABLE "auditores" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "rol" TEXT NOT NULL,
    "nivel_aql" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "auditores_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "auditores_nombre_key" ON "auditores"("nombre");
