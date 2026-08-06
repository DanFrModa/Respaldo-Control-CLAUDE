-- Reestructura del CATÁLOGO de telas, etapa A1 (Daniel, 6-ago-2026 — DECISIONES.md §Post-F9.11).
--
-- (1) La identidad de una tela se parte en 4 datos (tipo = la categoría existente · composición ·
--     proveedor dueño · nombre del proveedor) y el COMPLEMENTO (cardigan) pasa a ser PARTE de la
--     misma tela: nombre del cuerpo y del complemento en la tela (NULL en `nombre_complemento` =
--     no lleva).
-- (2) Los COLORES de la tela dejan de colgar del catálogo global de color de PRENDA (`colores`):
--     `telas_colores` pasa a ENTIDAD PROPIA con `id` autoincrement, `nombre` LIBRE (único por
--     tela), `pantone` y DOS precios (cuerpo y complemento). `id_color` se conserva NULLABLE como
--     liga LEGACY de las filas migradas (el MRP/precosto la siguen resolviendo; las filas nuevas
--     nacen con NULL).
--
-- Lo de las TELAS es aditivo y nullable: las 877 migradas quedan como están (sin composición, sin
-- proveedor dueño, sin complemento declarado) y se van depurando a mano — decisión explícita de
-- Daniel: el catálogo se conserva "sucio y depurable", las existencias arrancan en cero con su
-- conteo físico.

-- Catálogo nuevo de composiciones ("50% Algodón, 50% Poliéster").
CREATE TABLE "composiciones_tela" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "composiciones_tela_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "composiciones_tela_nombre_key" ON "composiciones_tela"("nombre");

-- La identidad y el complemento en la tela.
ALTER TABLE "telas"
    ADD COLUMN "id_composicion" INTEGER,
    ADD COLUMN "id_proveedor" INTEGER,
    ADD COLUMN "nombre_proveedor" TEXT,
    ADD COLUMN "nombre_cuerpo" TEXT,
    ADD COLUMN "nombre_complemento" TEXT;

ALTER TABLE "telas" ADD CONSTRAINT "telas_id_composicion_fkey"
    FOREIGN KEY ("id_composicion") REFERENCES "composiciones_tela"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "telas" ADD CONSTRAINT "telas_id_proveedor_fkey"
    FOREIGN KEY ("id_proveedor") REFERENCES "proveedores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ────────────────────────────────────────────────────────────────────────────────────────────
-- `telas_colores`: de N:N contra el catálogo de PRENDA a HIJO de la tela con nombre propio.
-- El diff canónico de Prisma agregaría `nombre` NOT NULL de golpe (tronaría con las ~4,566
-- filas migradas de `prueba`): aquí se agrega NULLABLE, se COPIA el dato (sección data-only de
-- abajo) y recién entonces se aprieta a NOT NULL. El estado FINAL es idéntico al del diff
-- canónico (mismas columnas, PK `telas_colores_pkey` sobre `id`, unique
-- `telas_colores_id_tela_nombre_key`); el índice y la FK de `id_color` ya existían y se quedan.
-- ────────────────────────────────────────────────────────────────────────────────────────────

ALTER TABLE "telas_colores"
    ADD COLUMN "id" SERIAL NOT NULL,
    ADD COLUMN "nombre" TEXT,
    ADD COLUMN "pantone" TEXT,
    ADD COLUMN "precio_complemento" DECIMAL(12,2);

-- DATA-ONLY: las filas migradas (F1-E6) heredan como nombre PROPIO el del color de prenda al que
-- colgaban; su `id_color` queda como liga legacy. `Color.nombre` es único global y la PK vieja era
-- (id_tela, id_color) ⇒ no puede haber dos filas de la misma tela con el mismo nombre copiado.
UPDATE "telas_colores" tc SET "nombre" = c."nombre" FROM "colores" c WHERE tc."id_color" = c."id";

ALTER TABLE "telas_colores" ALTER COLUMN "nombre" SET NOT NULL;

-- Nueva identidad: PK propia; el color de prenda pasa a liga legacy OPCIONAL.
ALTER TABLE "telas_colores" DROP CONSTRAINT "telas_colores_pkey";
ALTER TABLE "telas_colores" ADD CONSTRAINT "telas_colores_pkey" PRIMARY KEY ("id");
ALTER TABLE "telas_colores" ALTER COLUMN "id_color" DROP NOT NULL;

-- Unicidad del nombre POR tela (el dominio valida insensible a mayúsculas; esto respalda la carrera).
CREATE UNIQUE INDEX "telas_colores_id_tela_nombre_key" ON "telas_colores"("id_tela", "nombre");
