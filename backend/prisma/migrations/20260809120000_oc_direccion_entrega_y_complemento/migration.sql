-- Reglas de captura de la OC que pidió Daniel (§Post-F9.18). Migración ADITIVA: todo lo nuevo es
-- nullable o tabla nueva, así que el histórico migrado (7,978 OC) no se toca ni se invalida.
--
--  1. `direcciones_entrega` — CATÁLOGO de direcciones de entrega ("la dirección de entrega debe de
--     ser un catálogo… para que, siendo la misma en el 95%, salga correcta y escrita siempre igual").
--     Global (ADR-0007), borrado suave, SIN permiso propio: se gobierna con `compras.ver`/
--     `compras.administrar` → esta migración NO requiere `SEED_ON_START`.
--  2. `ordenes_compra.id_direccion_entrega` — la OC apunta al catálogo. `entrega_en` (texto libre) se
--     CONSERVA: es lo único que traen las OC migradas, y en las nuevas se copia el texto elegido para
--     que impresos y consultas viejas sigan leyendo un solo campo.
--  3. `orden_compra_linea.cantidad_complemento` / `precio_complemento` — la tela se compra CON su
--     complemento (Cardigan) en el MISMO renglón, igual que `entrada_tela_linea` ya lo recibía.

-- CreateTable
CREATE TABLE "direcciones_entrega" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "direccion" TEXT NOT NULL,
    "contacto" TEXT,
    "telefono" TEXT,
    "favorita" BOOLEAN NOT NULL DEFAULT false,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "direcciones_entrega_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "direcciones_entrega_nombre_key" ON "direcciones_entrega"("nombre");

-- AlterTable
ALTER TABLE "ordenes_compra" ADD COLUMN     "id_direccion_entrega" INTEGER;

-- CreateIndex
CREATE INDEX "ordenes_compra_id_direccion_entrega_idx" ON "ordenes_compra"("id_direccion_entrega");

-- AddForeignKey
ALTER TABLE "ordenes_compra" ADD CONSTRAINT "ordenes_compra_id_direccion_entrega_fkey" FOREIGN KEY ("id_direccion_entrega") REFERENCES "direcciones_entrega"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "orden_compra_linea" ADD COLUMN     "cantidad_complemento" DECIMAL(14,2),
ADD COLUMN     "precio_complemento" DECIMAL(12,2);
