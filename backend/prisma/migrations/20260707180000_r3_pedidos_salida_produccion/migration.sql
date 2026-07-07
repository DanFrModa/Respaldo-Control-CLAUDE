-- Rediseño R3 · Pedidos por mes + constructor + salida a producción (B3/B4).
-- Migración ADITIVA pura (columnas nullable + tabla nueva + secuencia; sin tocar datos existentes):
--  • B3 — `pedidos.oc_cliente` (captura VIVA de la orden de compra original del cliente, editable)
--    + `ordenes.oc_cliente` (SNAPSHOT copiado AL CREAR la OP: queda amarrado a la orden aunque el
--    pedido interno se reorganice — petición Daniel 7-jul, §4.1) + tabla puente `pedido_archivo`
--    (el documento/archivo original de la OC como adjunto del pedido, espejo de `orden_archivo`).
--  • B4 — `pedido_linea.id_desarrollo` (traza directa renglón→desarrollo: el constructor elige el
--    modelo DE DESARROLLO) + `modelos.numero_produccion` (el nº INTERNO de producción, distinto del
--    folio de OP y del nº de desarrollo `modelos.codigo`; se mintea la PRIMERA vez que el modelo
--    sale a producción y se REUSA entre sus OPs) + la secuencia atómica `numero_produccion_seq`
--    (A3: jamás Max()+1; global porque el catálogo de modelos es global, ADR-0007).

-- B3: OC del cliente — captura viva en el pedido, snapshot en la orden.
ALTER TABLE "pedidos" ADD COLUMN "oc_cliente" TEXT;
ALTER TABLE "ordenes" ADD COLUMN "oc_cliente" TEXT;

-- B4: traza renglón de pedido → desarrollo (Restrict: un desarrollo referenciado no se borra;
-- de todas formas el desarrollo nunca se borra físico — apagado suave, F8-E2).
ALTER TABLE "pedido_linea" ADD COLUMN "id_desarrollo" INTEGER;
ALTER TABLE "pedido_linea" ADD CONSTRAINT "pedido_linea_id_desarrollo_fkey"
  FOREIGN KEY ("id_desarrollo") REFERENCES "desarrollos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "pedido_linea_id_desarrollo_idx" ON "pedido_linea"("id_desarrollo");

-- B4: nº interno de producción del modelo (nullable: solo los modelos que YA salieron a
-- producción por el flujo nuevo lo tienen) + su secuencia atómica (A3).
ALTER TABLE "modelos" ADD COLUMN "numero_produccion" INTEGER;
CREATE UNIQUE INDEX "modelos_numero_produccion_key" ON "modelos"("numero_produccion");
CREATE SEQUENCE "numero_produccion_seq" START WITH 1;

-- B3: adjuntos del pedido (espejo de `orden_archivo`): liga un `Archivo` del motor R2 (F0) a un
-- PEDIDO como documento de apoyo (la OC original del cliente, Excel/PDF/imágenes).
-- `@@unique(id_archivo)` = un archivo se adjunta a un solo pedido; Cascade en ambas FK.
CREATE TABLE "pedido_archivo" (
    "id" SERIAL NOT NULL,
    "id_pedido" INTEGER NOT NULL,
    "id_archivo" TEXT NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,

    CONSTRAINT "pedido_archivo_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "pedido_archivo_id_pedido_idx" ON "pedido_archivo"("id_pedido");

CREATE UNIQUE INDEX "pedido_archivo_id_archivo_key" ON "pedido_archivo"("id_archivo");

ALTER TABLE "pedido_archivo" ADD CONSTRAINT "pedido_archivo_id_pedido_fkey"
  FOREIGN KEY ("id_pedido") REFERENCES "pedidos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "pedido_archivo" ADD CONSTRAINT "pedido_archivo_id_archivo_fkey"
  FOREIGN KEY ("id_archivo") REFERENCES "archivos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
