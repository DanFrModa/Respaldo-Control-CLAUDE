-- ⭐⭐ V1-E7c (ronda de corrección, H1) — LA COTIZACIÓN SE VUELVE AUTOSUFICIENTE
--
-- Corrige el defecto que el reviewer tumbó: la versión anterior blindaba con `RESTRICT` las FK del
-- documento hacia la lista, hacia el renglón de lista y hacia el precosto. **Eso no protegía el papel:
-- protegía el PUNTERO.** El contenido del documento vive en sus propias columnas congeladas y nadie lo
-- toca; lo que el `RESTRICT` conseguía era ATRAPAR la lista y sus renglones.
--
-- 🔴 Y no era un atrapamiento cualquiera: `lista_precios_linea` sigue teniendo `@@unique
-- (id_desarrollo)`, o sea que **un desarrollo vive en A LO MÁS UNA lista**. Un renglón retenido por
-- una cotización no podía entrar NUNCA a otra lista — y sin escapatoria, porque una cotización no se
-- borra y cancelarla tampoco libera. Es exactamente el defecto que V1-E4 tuvo que ir a arreglar.
--
-- El nudo estaba en que el documento NO era autosuficiente: para imprimir «Cliente», «Departamento» y
-- «Lista de precios #» leía por la FK. Si hay que leer por la FK, hay que blindarla; si se blinda,
-- la lista queda atrapada. Esta migración corta el nudo por el otro lado:
--
--   1. CONGELA el encabezado: `nombre_cliente`, `nombre_departamento`, `folio_lista` (copiados, como
--      su vecina `lista_precios` ya hace con los factores del cliente), más `id_cliente` /
--      `id_cliente_departamento` como identidad del destinatario.
--   2. Con el papel ya autosuficiente, `id_lista`, `id_lista_linea` e `id_precosto` pasan a
--      NULLABLE + `SET NULL`: quedan como PROCEDENCIA. Si la lista o el renglón se borran, el puntero
--      se va a null y **el documento se sigue imprimiendo idéntico** — mismo cliente, mismo
--      departamento, mismos renglones, mismos precios.
--
-- La procedencia no se pierde al soltar la FK: la bitácora de la emisión guarda cada renglón (modelo
-- + versión de receta + precio) y la de `quitar-linea` guarda el renglón entero.
--
-- ⚠️ Las columnas nuevas entran **NOT NULL sin DEFAULT y sin backfill**, lo cual es seguro porque
-- `cotizacion` y `cotizacion_linea` **nacieron vacías en esta misma rama** (migración
-- `20260825120000_cotizacion_el_documento`) y no hay una sola fila en ningún ambiente. Es el momento
-- más barato en que este cambio puede hacerse, y por eso no se difiere.
--
-- Va como migración APARTE en vez de reescribir la anterior: si la primera ya se aplicó en algún
-- ambiente, reescribirla cambiaría su checksum y `prisma migrate deploy` abortaría el arranque. Así
-- funciona en los dos casos.
--
-- SIN permisos nuevos ⇒ este deploy NO requiere `SEED_ON_START`.

-- DropForeignKey
ALTER TABLE "cotizacion" DROP CONSTRAINT "cotizacion_id_lista_fkey";

-- DropForeignKey
ALTER TABLE "cotizacion_linea" DROP CONSTRAINT "cotizacion_linea_id_lista_linea_fkey";

-- DropForeignKey
ALTER TABLE "cotizacion_linea" DROP CONSTRAINT "cotizacion_linea_id_precosto_fkey";

-- AlterTable
ALTER TABLE "cotizacion" ADD COLUMN     "folio_lista" BIGINT NOT NULL,
ADD COLUMN     "id_cliente" INTEGER NOT NULL,
ADD COLUMN     "id_cliente_departamento" INTEGER NOT NULL,
ADD COLUMN     "nombre_cliente" TEXT NOT NULL,
ADD COLUMN     "nombre_departamento" TEXT NOT NULL,
ALTER COLUMN "id_lista" DROP NOT NULL;

-- AlterTable
ALTER TABLE "cotizacion_linea" ALTER COLUMN "id_lista_linea" DROP NOT NULL,
ALTER COLUMN "id_precosto" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "cotizacion_id_cliente_idx" ON "cotizacion"("id_cliente");

-- CreateIndex
CREATE INDEX "cotizacion_id_cliente_departamento_idx" ON "cotizacion"("id_cliente_departamento");

-- AddForeignKey
ALTER TABLE "cotizacion" ADD CONSTRAINT "cotizacion_id_lista_fkey" FOREIGN KEY ("id_lista") REFERENCES "lista_precios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cotizacion" ADD CONSTRAINT "cotizacion_id_cliente_fkey" FOREIGN KEY ("id_cliente") REFERENCES "clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cotizacion" ADD CONSTRAINT "cotizacion_id_cliente_departamento_fkey" FOREIGN KEY ("id_cliente_departamento") REFERENCES "cliente_departamento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cotizacion_linea" ADD CONSTRAINT "cotizacion_linea_id_lista_linea_fkey" FOREIGN KEY ("id_lista_linea") REFERENCES "lista_precios_linea"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cotizacion_linea" ADD CONSTRAINT "cotizacion_linea_id_precosto_fkey" FOREIGN KEY ("id_precosto") REFERENCES "precostos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

