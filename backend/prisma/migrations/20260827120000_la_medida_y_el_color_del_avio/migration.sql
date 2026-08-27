-- V1-E8c · LA MEDIDA Y EL COLOR DEL AVÍO EN LA ORDEN DE COMPRA (§Post-F9.126, decisión de Daniel).
--
-- Migración 100 % ADITIVA: tres columnas nuevas y dos tablas nuevas. No toca ni una fila existente,
-- no borra nada, no cambia ningún default y no crea ningún CHECK que restrinja lo que hoy se puede
-- hacer (D3: en este proyecto nada se destruye).
--
-- EL QUÉ. Daniel, probando en vivo: *"Le había puesto que el cierre lo tengo que comprar por
-- medidas. Y al hacer la OC no me aparece cantidad por medida… sólo veo un solo renglón"*. Y el
-- caso completo: *"Ese modelo nos lo piden en 4 variantes de color. Se generan 4 órdenes de
-- producción… los cierres se compran todos al mismo proveedor, pero cada color es diferente y cada
-- color tiene cantidades por medida… En la receta no viene definido el color. Eso viene hasta que
-- nos hacen el pedido"*.
--
-- 🔴 LA REGLA DE DISEÑO, que es la que decide qué columna y qué tabla existen:
--    **lo que parte el RENGLÓN es lo que se recibe por separado; lo que sólo hay que decirle al
--    proveedor va en la TABLITA.**
--      • El COLOR parte el renglón → `id_color_prenda` (identidad) + `color_avio` (lo que lee el
--        proveedor). Se recibe por color, el kardex entra por color y la explosión netea por color.
--      • La MEDIDA no se recibe (llegan "3,200 cierres") → va en la tablita del renglón.
--
--  1. `requerimiento_orden.id_color_prenda`   — el color de PRENDA que parte el renglón de avío en
--     la explosión. Lo mismo que `id_tela_color` hace en las telas desde V1-E3u.
--  2. `orden_compra_linea.id_color_prenda`    — el mismo color, ya en la línea de OC (identidad:
--     por él netea `comprometido-en-oc.ts` para no volver a comprar lo ya comprado).
--  3. `orden_compra_linea.color_avio`         — el color como TEXTO, que es lo que el proveedor lee.
--     Precargado con el nombre del color de la prenda y EDITABLE (el avío puede ir en contraste).
--     Es texto y no un catálogo a propósito (§Post-F9.91, decisión de Daniel: *"los avíos no llevan
--     catálogo de color: el color va en su descripción"*).
--  4. `requerimiento_orden_medida`            — el desglose por medida CONGELADO en el snapshot.
--  5. `orden_compra_linea_medida`             — el desglose por medida de la línea de OC. Σ de sus
--     cantidades = `orden_compra_linea.cantidad` (lo garantiza el dominio al repartir).
--
-- ⚠️ SIN backfill y SIN default, a propósito: los tres campos quedan en NULL / las dos tablas
-- vacías para TODO lo que ya existe. NULL se lee como *"esta compra no dijo color"* y
-- *"este renglón no se pidió por medida"*, que es exactamente lo que esas OC dicen hoy: el sistema
-- no dejaba decirlo. Inventarles un color o un desglose escribiría como HECHO una suposición.
--
-- ⚠️ Y lo que esta migración NO puede resolver, dicho aquí para que no se lea como olvido: una
-- ENTREGA PARCIAL sabrá el COLOR (se recibe contra la línea, que lo lleva) pero NO la MEDIDA — no
-- hay dimensión de medida en la recepción ni en el kardex de avíos, porque la medida es
-- informativa. Es un LÍMITE DECLARADO y aceptado por Daniel, no un callejón sin salida: el día que
-- importe, la medida se parte en renglón con este mismo mecanismo.

-- AlterTable
ALTER TABLE "orden_compra_linea" ADD COLUMN     "color_avio" TEXT,
ADD COLUMN     "id_color_prenda" INTEGER;

-- AlterTable
ALTER TABLE "requerimiento_orden" ADD COLUMN     "id_color_prenda" INTEGER;

-- CreateTable
CREATE TABLE "orden_compra_linea_medida" (
    "id" SERIAL NOT NULL,
    "id_orden_compra_linea" INTEGER NOT NULL,
    "id_avio_medida" INTEGER,
    "etiqueta" TEXT NOT NULL,
    "cantidad" DECIMAL(14,2) NOT NULL,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "orden_compra_linea_medida_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "requerimiento_orden_medida" (
    "id" SERIAL NOT NULL,
    "id_requerimiento" INTEGER NOT NULL,
    "id_avio_medida" INTEGER,
    "etiqueta" TEXT NOT NULL,
    "cantidad" DECIMAL(14,4) NOT NULL,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "requerimiento_orden_medida_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "orden_compra_linea_medida_id_orden_compra_linea_idx" ON "orden_compra_linea_medida"("id_orden_compra_linea");

-- CreateIndex
CREATE INDEX "orden_compra_linea_medida_id_avio_medida_idx" ON "orden_compra_linea_medida"("id_avio_medida");

-- CreateIndex
CREATE UNIQUE INDEX "orden_compra_linea_medida_id_orden_compra_linea_etiqueta_key" ON "orden_compra_linea_medida"("id_orden_compra_linea", "etiqueta");

-- CreateIndex
CREATE INDEX "requerimiento_orden_medida_id_requerimiento_idx" ON "requerimiento_orden_medida"("id_requerimiento");

-- CreateIndex
CREATE INDEX "requerimiento_orden_medida_id_avio_medida_idx" ON "requerimiento_orden_medida"("id_avio_medida");

-- CreateIndex
CREATE UNIQUE INDEX "requerimiento_orden_medida_id_requerimiento_etiqueta_key" ON "requerimiento_orden_medida"("id_requerimiento", "etiqueta");

-- CreateIndex
CREATE INDEX "orden_compra_linea_id_color_prenda_idx" ON "orden_compra_linea"("id_color_prenda");

-- CreateIndex
CREATE INDEX "requerimiento_orden_id_color_prenda_idx" ON "requerimiento_orden"("id_color_prenda");

-- AddForeignKey
ALTER TABLE "orden_compra_linea" ADD CONSTRAINT "orden_compra_linea_id_color_prenda_fkey" FOREIGN KEY ("id_color_prenda") REFERENCES "colores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orden_compra_linea_medida" ADD CONSTRAINT "orden_compra_linea_medida_id_orden_compra_linea_fkey" FOREIGN KEY ("id_orden_compra_linea") REFERENCES "orden_compra_linea"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orden_compra_linea_medida" ADD CONSTRAINT "orden_compra_linea_medida_id_avio_medida_fkey" FOREIGN KEY ("id_avio_medida") REFERENCES "avio_medida"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requerimiento_orden" ADD CONSTRAINT "requerimiento_orden_id_color_prenda_fkey" FOREIGN KEY ("id_color_prenda") REFERENCES "colores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requerimiento_orden_medida" ADD CONSTRAINT "requerimiento_orden_medida_id_requerimiento_fkey" FOREIGN KEY ("id_requerimiento") REFERENCES "requerimiento_orden"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requerimiento_orden_medida" ADD CONSTRAINT "requerimiento_orden_medida_id_avio_medida_fkey" FOREIGN KEY ("id_avio_medida") REFERENCES "avio_medida"("id") ON DELETE SET NULL ON UPDATE CASCADE;

