-- ════════════════════════════════════════════════════════════════════════════════════════════
-- Fila 0.242 · EL TOPE DEL PRECIO DE MAQUILA (§Post-F9.250(d) → §Post-F9.255 de DECISIONES.md)
-- ════════════════════════════════════════════════════════════════════════════════════════════
--
-- Daniel: el precio de maquila lo captura producción, pero NO puede pasarse de lo cotizado sin que
-- él lo autorice. Se rechaza `precio > referencia × 1.05` (sin freno hacia abajo) salvo con el
-- permiso reservado `ordenes.autorizar-sobreprecio`, y sin referencia no sale el envío del proceso.
--
-- QUÉ CREA (aditivo, sin backfill — REGLA 0-B):
--   • `orden_referencia_proceso`: la referencia por orden × proceso para los procesos que NO son
--     arte (hoy, costura). Los de arte ya la tienen: la suma de sus `OrdenArte.precio` (§Post-F9.254).
--   • `orden_referencia_evento`: el rastro inmutable de cada cambio de referencia y de cada
--     sobreprecio autorizado (lo lee la consulta «Referencias cambiadas»).
--
-- Las órdenes que ya existen quedan sin referencia de costura: se captura cuando haga falta.

-- CreateEnum
CREATE TYPE "origen_referencia_proceso" AS ENUM ('precosto', 'manual');

-- CreateEnum
CREATE TYPE "accion_referencia_evento" AS ENUM ('prellenado', 'captura', 'arte', 'sobreprecio');

-- CreateEnum
CREATE TYPE "punto_precio_maquila" AS ENUM ('orden_maquila', 'orden_aplicacion', 'envio', 'recibo', 'cargo_esma');

-- CreateTable
CREATE TABLE "orden_referencia_proceso" (
    "id" SERIAL NOT NULL,
    "id_orden" INTEGER NOT NULL,
    "id_tipo_proceso" INTEGER NOT NULL,
    "precio" DECIMAL(12,2) NOT NULL,
    "origen" "origen_referencia_proceso" NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "orden_referencia_proceso_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orden_referencia_evento" (
    "id" SERIAL NOT NULL,
    "id_orden" INTEGER NOT NULL,
    "id_tipo_proceso" INTEGER,
    "accion" "accion_referencia_evento" NOT NULL,
    "referencia_anterior" DECIMAL(12,2),
    "referencia_nueva" DECIMAL(12,2),
    "precio_autorizado" DECIMAL(12,2),
    "punto" "punto_precio_maquila",
    "nota" TEXT,
    "capturado_por_id" TEXT,
    "capturado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orden_referencia_evento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "orden_referencia_proceso_id_tipo_proceso_idx" ON "orden_referencia_proceso"("id_tipo_proceso");

-- CreateIndex
CREATE UNIQUE INDEX "orden_referencia_proceso_id_orden_id_tipo_proceso_key" ON "orden_referencia_proceso"("id_orden", "id_tipo_proceso");

-- CreateIndex
CREATE INDEX "orden_referencia_evento_id_orden_idx" ON "orden_referencia_evento"("id_orden");

-- CreateIndex
CREATE INDEX "orden_referencia_evento_id_tipo_proceso_idx" ON "orden_referencia_evento"("id_tipo_proceso");

-- CreateIndex
CREATE INDEX "orden_referencia_evento_capturado_en_idx" ON "orden_referencia_evento"("capturado_en");

-- AddForeignKey
ALTER TABLE "orden_referencia_proceso" ADD CONSTRAINT "orden_referencia_proceso_id_orden_fkey" FOREIGN KEY ("id_orden") REFERENCES "ordenes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orden_referencia_proceso" ADD CONSTRAINT "orden_referencia_proceso_id_tipo_proceso_fkey" FOREIGN KEY ("id_tipo_proceso") REFERENCES "tipos_proceso"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orden_referencia_evento" ADD CONSTRAINT "orden_referencia_evento_id_orden_fkey" FOREIGN KEY ("id_orden") REFERENCES "ordenes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orden_referencia_evento" ADD CONSTRAINT "orden_referencia_evento_id_tipo_proceso_fkey" FOREIGN KEY ("id_tipo_proceso") REFERENCES "tipos_proceso"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

