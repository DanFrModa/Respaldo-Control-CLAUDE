-- V1-E8e · «CON ESTO QUEDA CUBIERTO» — el faltante chico que alguien decidió no perseguir
-- (§Post-F9.99, DANIEL: *"compré 480 en lugar de 481 que era el cálculo de la tela. Y me sigue
-- poniendo que me falta comprar 1 kilo… a veces pasa eso en la realidad. Y no voy a hacer otra OC
-- por 1 kilo"*).
--
-- Migración 100 % ADITIVA: un enum nuevo y una tabla nueva. No toca ni una fila existente, no borra
-- nada, no cambia ningún default y no restringe nada de lo que hoy se puede hacer. NO requiere
-- `SEED_ON_START` (no hay permisos ni catálogos nuevos: la operación reusa `compras.administrar`).
--
-- 🔴 POR QUÉ UNA TABLA Y NO UNA COLUMNA EN `requerimiento_orden`, que es donde uno la pondría. Ese
-- snapshot se **borra y se reescribe ENTERO en cada explosión** (`deleteMany` + recreación, en
-- `dominio/compras/mrp.ts`): una bandera ahí se borraría la próxima vez que alguien explotara la
-- orden y el faltante volvería sin que nadie entendiera por qué. La marca necesita una identidad
-- DURABLE, que es *(orden, material, color)* — y por eso vive en su propia tabla.
--
-- ⚠️ EL COLOR ESTÁ EN LA IDENTIDAD, y no es adorno: desde §Post-F9.89 (telas) y §Post-F9.126
-- (avíos) un renglón de explosión ES *(material, color)*. Una marca sin color cubriría un cierre y
-- dejaría pidiendo los otros tres. Se guardan las MISMAS dos columnas que el snapshot: `id_tela_color`
-- para telas y `id_color_prenda` para avíos (el avío no tiene catálogo de color propio).
--
-- ⚠️ ES UN LIBRO DE ACTOS, NO UN ESTADO QUE SE PISA (D3, el criterio del kardex): cada «dar por
-- cubierto» INSERTA un renglón y lo cubierto es la Σ de los renglones vivos. Deshacer («volver a
-- pedirlo») sella `cancelado_en` y deja de contar — nunca borra, así el rastro de A7 (quién, cuándo,
-- contra qué requerido, con qué cantidad comprada) sobrevive a la corrección.
--
-- ⚠️ SIN BACKFILL, a propósito: no hay dato del que deducir qué faltantes históricos alguien habría
-- dado por cubiertos. Todo lo anterior al despliegue arranca sin marcas —o sea, exactamente como
-- hoy—, y los faltantes que ya se escaparon se cierran a mano desde el renglón de la explosión, que
-- es la segunda puerta que esta etapa construye.
--
-- ⚠️ SIN índice único sobre *(orden, material, color)*: la tabla admite VARIAS marcas vivas del
-- mismo renglón a propósito (se compró 480 de 481 y se cerró 1; después creció el requerido, se
-- compró otro tanto y se cerró otro pedazo). Lo que suma es la Σ, no la última fila.

-- CreateEnum
CREATE TYPE "origen_dado_por_cubierto" AS ENUM ('previa', 'explosion');

-- CreateTable
CREATE TABLE "requerimiento_cubierto" (
    "id" SERIAL NOT NULL,
    "id_orden" INTEGER NOT NULL,
    "id_tela" INTEGER,
    "id_avio" INTEGER,
    "id_tela_color" INTEGER,
    "id_color_prenda" INTEGER,
    "cantidad" DECIMAL(14,4) NOT NULL,
    "cantidad_requerida" DECIMAL(14,4) NOT NULL,
    "cantidad_comprada" DECIMAL(14,4) NOT NULL,
    "origen" "origen_dado_por_cubierto" NOT NULL,
    "cancelado_en" TIMESTAMP(3),
    "cancelado_por_id" TEXT,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "requerimiento_cubierto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "requerimiento_cubierto_id_orden_idx" ON "requerimiento_cubierto"("id_orden");

-- CreateIndex
CREATE INDEX "requerimiento_cubierto_id_tela_idx" ON "requerimiento_cubierto"("id_tela");

-- CreateIndex
CREATE INDEX "requerimiento_cubierto_id_avio_idx" ON "requerimiento_cubierto"("id_avio");

-- CreateIndex
CREATE INDEX "requerimiento_cubierto_id_tela_color_idx" ON "requerimiento_cubierto"("id_tela_color");

-- CreateIndex
CREATE INDEX "requerimiento_cubierto_id_color_prenda_idx" ON "requerimiento_cubierto"("id_color_prenda");

-- AddForeignKey
ALTER TABLE "requerimiento_cubierto" ADD CONSTRAINT "requerimiento_cubierto_id_orden_fkey" FOREIGN KEY ("id_orden") REFERENCES "ordenes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requerimiento_cubierto" ADD CONSTRAINT "requerimiento_cubierto_id_tela_fkey" FOREIGN KEY ("id_tela") REFERENCES "telas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requerimiento_cubierto" ADD CONSTRAINT "requerimiento_cubierto_id_avio_fkey" FOREIGN KEY ("id_avio") REFERENCES "avios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requerimiento_cubierto" ADD CONSTRAINT "requerimiento_cubierto_id_tela_color_fkey" FOREIGN KEY ("id_tela_color") REFERENCES "telas_colores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requerimiento_cubierto" ADD CONSTRAINT "requerimiento_cubierto_id_color_prenda_fkey" FOREIGN KEY ("id_color_prenda") REFERENCES "colores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

