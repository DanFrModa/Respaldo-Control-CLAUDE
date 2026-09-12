-- ⭐⭐ FILA 0.103 — DÓNDE ESTÁ GUARDADO EL MATERIAL DENTRO DEL ALMACÉN.
--
-- Daniel (2-sep-2026): *«sí quiero que haya un lugar donde está ubicado. Principalmente para telas
-- y avíos»*. Cerrada el 3-sep: *«de texto libre está bien. Por ahora NO un catálogo de posiciones
-- — si en algún momento se requiere lo hacemos»*. El sistema ya sabía CUÁNTO hay y EN QUÉ ALMACÉN;
-- lo que le faltaba era DÓNDE dentro de la bodega, que es lo único que el almacenista necesita para
-- ir por el material sin buscarlo de memoria.
--
-- 🔑 POR QUÉ SON TABLAS NUEVAS Y NO COLUMNAS. La ubicación es por ARTÍCULO × ALMACÉN (la misma
-- felpa marino puede estar en el rack 4 de Naucalpan y en el pasillo B del taller), y esa pareja NO
-- tiene fila propia en ninguna parte: la existencia es Σ de movimientos (D3 — las vistas
-- `existencia_tela_color` / `existencia_avio` son AGREGACIONES, no filas donde colgar un dato).
-- Colgarla de `almacenes` daría una ubicación por bodega (no por material); colgarla de
-- `telas_colores` / `avios` daría UNA sola para todas las bodegas. Ninguna de las dos contesta la
-- pregunta.
--
-- ⚠️ CON `id_empresa` (A9), y la unicidad es artículo × almacén × EMPRESA. La primera versión de
-- esta migración no lo llevaba, con el argumento de que «el almacén ya pertenece a una empresa» —
-- FALSO para el almacén GLOBAL (`id_empresa IS NULL`), que es justo el que siembra
-- `sembrarAlmacenUnicoGlobal` para TELA y AVÍO, o sea el caso normal hoy. Medido contra Postgres:
-- la empresa A leía la ubicación que escribió la B, y la nota de B pisaba la de A — una sola fila,
-- última escritura gana, sin aviso. Y era incoherente dentro de la MISMA pantalla, porque la
-- existencia de ese mismo almacén global YA se separa por empresa (`existencia_tela_color` /
-- `existencia_avio` llevan `id_empresa`): la ubicación habría sido el único dato compartido.
-- La empresa sale de la sesión (`sesion.idEmpresaActiva`), la misma que ya filtra la existencia.
-- FK a `empresas` con RESTRICT: una empresa no se borra físico, se desactiva.
--
-- `ubicacion` es TEXT NOT NULL: borrar la ubicación se hace BORRANDO LA FILA (lo hace el dominio
-- cuando el texto llega vacío), no guardando una cadena vacía que después habría que distinguir de
-- NULL. La AUSENCIA de fila ES "no anotada".
--
-- ADITIVA Y SIN BACKFILL (REGLA 0-B): no toca ninguna tabla existente, no hay `ALTER TABLE`, y los
-- materiales que ya viven en `prueba` nacen sin ubicación. Se van llenando conforme el almacén los
-- acomoda. SIN permisos nuevos y SIN semillas: la lectura va con `inventario-telas.ver` /
-- `inventario-avios.ver` y la escritura con `inventario-telas.mover` / `inventario-avios.mover`,
-- que ya existen y ya los tienen los perfiles de almacén.
--
-- FK: `ON DELETE CASCADE` hacia el artículo (la ubicación es un ATRIBUTO suyo: si el color o el
-- avío desaparecieran, su repisa no significa nada) y `ON DELETE RESTRICT` hacia el almacén (un
-- almacén no se borra físico — se desactiva, patrón de la casa).

-- CreateTable
CREATE TABLE "ubicaciones_tela_color" (
    "id" SERIAL NOT NULL,
    "id_tela_color" INTEGER NOT NULL,
    "id_almacen" INTEGER NOT NULL,
    "id_empresa" INTEGER NOT NULL,
    "ubicacion" TEXT NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "ubicaciones_tela_color_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ubicaciones_avio" (
    "id" SERIAL NOT NULL,
    "id_avio" INTEGER NOT NULL,
    "id_almacen" INTEGER NOT NULL,
    "id_empresa" INTEGER NOT NULL,
    "ubicacion" TEXT NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "ubicaciones_avio_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ubicaciones_tela_color_id_almacen_idx" ON "ubicaciones_tela_color"("id_almacen");

-- CreateIndex
CREATE INDEX "ubicaciones_tela_color_id_empresa_idx" ON "ubicaciones_tela_color"("id_empresa");

-- CreateIndex
CREATE UNIQUE INDEX "ubicaciones_tela_color_id_tela_color_id_almacen_id_empresa_key" ON "ubicaciones_tela_color"("id_tela_color", "id_almacen", "id_empresa");

-- CreateIndex
CREATE INDEX "ubicaciones_avio_id_almacen_idx" ON "ubicaciones_avio"("id_almacen");

-- CreateIndex
CREATE INDEX "ubicaciones_avio_id_empresa_idx" ON "ubicaciones_avio"("id_empresa");

-- CreateIndex
CREATE UNIQUE INDEX "ubicaciones_avio_id_avio_id_almacen_id_empresa_key" ON "ubicaciones_avio"("id_avio", "id_almacen", "id_empresa");

-- AddForeignKey
ALTER TABLE "ubicaciones_tela_color" ADD CONSTRAINT "ubicaciones_tela_color_id_tela_color_fkey" FOREIGN KEY ("id_tela_color") REFERENCES "telas_colores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ubicaciones_tela_color" ADD CONSTRAINT "ubicaciones_tela_color_id_almacen_fkey" FOREIGN KEY ("id_almacen") REFERENCES "almacenes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ubicaciones_avio" ADD CONSTRAINT "ubicaciones_avio_id_avio_fkey" FOREIGN KEY ("id_avio") REFERENCES "avios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ubicaciones_avio" ADD CONSTRAINT "ubicaciones_avio_id_almacen_fkey" FOREIGN KEY ("id_almacen") REFERENCES "almacenes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ubicaciones_tela_color" ADD CONSTRAINT "ubicaciones_tela_color_id_empresa_fkey" FOREIGN KEY ("id_empresa") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ubicaciones_avio" ADD CONSTRAINT "ubicaciones_avio_id_empresa_fkey" FOREIGN KEY ("id_empresa") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
