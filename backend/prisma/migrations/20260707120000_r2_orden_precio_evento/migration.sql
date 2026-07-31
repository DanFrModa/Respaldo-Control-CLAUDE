-- Rediseño R2 · Historial inmutable de precios de la orden (requisito de Daniel §4.4.3).
-- Tabla `orden_precio_evento` (estilo `negociacion_evento`): cada cambio del precio real de
-- maquila/aplicación de una orden INSERTA un evento (quién, cuándo, con qué proveedor se negoció,
-- anterior→nuevo); jamás se edita ni se borra (D3/A7). Cascade hacia `ordenes` (el historial es de
-- la orden); Restrict hacia `proveedores`. Migración ADITIVA pura (enum + tabla nueva, sin tocar
-- datos existentes).

-- CreateEnum
CREATE TYPE "campo_precio_orden" AS ENUM ('maquila', 'aplicacion');

-- CreateTable
CREATE TABLE "orden_precio_evento" (
    "id" SERIAL NOT NULL,
    "id_orden" INTEGER NOT NULL,
    "campo" "campo_precio_orden" NOT NULL,
    "precio_anterior" DECIMAL(12,2),
    "precio_nuevo" DECIMAL(12,2) NOT NULL,
    "id_proveedor" INTEGER,
    "nota" TEXT,
    "capturado_por_id" TEXT,
    "capturado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orden_precio_evento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "orden_precio_evento_id_orden_idx" ON "orden_precio_evento"("id_orden");

-- CreateIndex
CREATE INDEX "orden_precio_evento_id_proveedor_idx" ON "orden_precio_evento"("id_proveedor");

-- AddForeignKey
ALTER TABLE "orden_precio_evento" ADD CONSTRAINT "orden_precio_evento_id_orden_fkey" FOREIGN KEY ("id_orden") REFERENCES "ordenes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orden_precio_evento" ADD CONSTRAINT "orden_precio_evento_id_proveedor_fkey" FOREIGN KEY ("id_proveedor") REFERENCES "proveedores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
