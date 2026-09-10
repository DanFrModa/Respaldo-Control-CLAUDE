-- ⭐⭐ V1-E7c (§Post-F9.109) — LA COTIZACIÓN: EL DOCUMENTO QUE SE LE MANDA AL CLIENTE
--
-- Daniel (25-ago-2026): *"nos falta desarrollar toda la parte de las cotizaciones"*. Había MOTOR de
-- cálculo (precosto → lista de precios con los factores del cliente → aprobación → negociación) y no
-- había PAPEL. Esta migración crea el artefacto que sale de la mesa.
--
-- Forma dictada por Daniel: *"es un documento con las 5 cotizaciones… o sea una cotización con los 5
-- modelos"* ⇒ UNA cotización con N renglones, colgada de la LISTA (cliente + departamento), no de un
-- desarrollo suelto. Y su regla: si en la segunda vuelta sólo cambian 3 de los 5, **la cotización
-- nueva lleva LOS CINCO** (el cliente la lee sola; mandarle el delta lo obligaría a reconstruir el
-- paquete de memoria).
--
-- 🔴 Por qué `cotizacion_linea` COPIA los valores (código, descripción, nº del cliente, versión de la
-- receta y precio) en vez de sólo apuntar a `lista_precios_linea`: la LISTA sigue moviéndose después
-- de emitir. Con punteros, reimprimir la cotización de marzo enseñaría los precios de mayo — mentiría
-- sobre lo que se le mandó al cliente. Las FK quedan como PROCEDENCIA ("de qué renglón salió, con qué
-- versión de la receta"), no como fuente de lectura. Mismo patrón de copia congelada que la receta
-- modelo→OP (§Post-F9.34).
--
-- ⚠️ **100% ADITIVA.** Dos tablas nuevas y ninguna columna tocada: nada de lo que ya existe cambia de
-- significado ni se backfilea. Las cotizaciones arrancan en cero (el documento no existía).
--
-- FK con RESTRICT a propósito (D3 — el papel que ya salió no se borra por la espalda):
--   • `cotizacion → lista_precios`: no se puede borrar una lista que ya produjo cotizaciones.
--   • `cotizacion_linea → lista_precios_linea`: no se puede quitar de la lista un renglón ya cotizado.
--   • `cotizacion_linea → precostos`: nunca se borra la versión de la receta con la que se cotizó.
-- El dominio (`dominio/desarrollo/listas-precios.ts`) traduce las dos primeras a un mensaje claro con
-- el folio de la cotización culpable, en vez de dejar reventar la FK con un 500 opaco.
--
-- SIN permisos nuevos: emitir/cancelar usa `listas.negociar` (dueño + gerente comercial, quien está
-- en la mesa) y ver usa `listas.ver`. ⇒ este deploy NO requiere re-seed.

-- CreateTable
CREATE TABLE "cotizacion" (
    "id" SERIAL NOT NULL,
    "folio" BIGINT NOT NULL,
    "id_empresa" INTEGER NOT NULL,
    "id_lista" INTEGER NOT NULL,
    "fecha" DATE NOT NULL,
    "estado" VARCHAR(20) NOT NULL DEFAULT 'emitida',
    "notas" TEXT,
    "motivo_cancelacion" TEXT,
    "cancelada_por_id" TEXT,
    "cancelada_en" TIMESTAMP(3),
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "cotizacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cotizacion_linea" (
    "id" SERIAL NOT NULL,
    "id_cotizacion" INTEGER NOT NULL,
    "id_lista_linea" INTEGER NOT NULL,
    "id_precosto" INTEGER NOT NULL,
    "codigo_modelo" TEXT NOT NULL,
    "descripcion_modelo" TEXT,
    "numero_cliente" TEXT,
    "version_precosto" INTEGER NOT NULL,
    "precio_unit" DECIMAL(12,2) NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "cotizacion_linea_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cotizacion_id_lista_idx" ON "cotizacion"("id_lista");

-- CreateIndex
CREATE INDEX "cotizacion_estado_idx" ON "cotizacion"("estado");

-- CreateIndex
CREATE UNIQUE INDEX "cotizacion_id_empresa_folio_key" ON "cotizacion"("id_empresa", "folio");

-- CreateIndex
CREATE INDEX "cotizacion_linea_id_lista_linea_idx" ON "cotizacion_linea"("id_lista_linea");

-- CreateIndex
CREATE INDEX "cotizacion_linea_id_precosto_idx" ON "cotizacion_linea"("id_precosto");

-- CreateIndex
CREATE UNIQUE INDEX "cotizacion_linea_id_cotizacion_id_lista_linea_key" ON "cotizacion_linea"("id_cotizacion", "id_lista_linea");

-- AddForeignKey
ALTER TABLE "cotizacion" ADD CONSTRAINT "cotizacion_id_empresa_fkey" FOREIGN KEY ("id_empresa") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cotizacion" ADD CONSTRAINT "cotizacion_id_lista_fkey" FOREIGN KEY ("id_lista") REFERENCES "lista_precios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cotizacion_linea" ADD CONSTRAINT "cotizacion_linea_id_cotizacion_fkey" FOREIGN KEY ("id_cotizacion") REFERENCES "cotizacion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cotizacion_linea" ADD CONSTRAINT "cotizacion_linea_id_lista_linea_fkey" FOREIGN KEY ("id_lista_linea") REFERENCES "lista_precios_linea"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cotizacion_linea" ADD CONSTRAINT "cotizacion_linea_id_precosto_fkey" FOREIGN KEY ("id_precosto") REFERENCES "precostos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
