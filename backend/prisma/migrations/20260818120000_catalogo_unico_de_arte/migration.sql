-- V1-E3f (pieza A) — UN SOLO CATÁLOGO PARA EL PROCESO Y EL ARTE, Y EL ARTE COMO DANIEL LO USA
--
-- Decisiones: `Documentacion_MJD/DECISIONES.md` §Post-F9.52 (los siete puntos del arte),
-- §Post-F9.54 (principio del "proceso raro"), §Post-F9.58 y §Post-F9.59 punto 2
-- (Daniel, 16-ago-2026: *"De acuerdo. Y un solo catálogo."*).
--
-- Qué hace, en orden:
--   1. `tipos_proceso` gana DOS banderas: `es_arte` (¿este proceso se ofrece como tipo de arte?)
--      y `usa_puntadas` (¿su arte lleva puntadas? — §Post-F9.52 punto 6). Se marcan por CÓDIGO:
--      arte = bordado, estampado, aplicación y lavado (*"Aplicación también es arte"*, Daniel);
--      puntadas = solo bordado. La costura queda fuera del arte: es la única diferencia real
--      entre las dos listas que se fusionan.
--   2. Garantiza que existan las filas `bordado` y `estampado` ANTES de traducir el enum: si la
--      base tiene artes pero le falta el catálogo (una BD que nunca corrió el seed), la
--      traducción no puede quedarse sin destino.
--   3. `modelo_arte` y `orden_arte`: el enum `tipo_arte` pasa a FK `id_tipo_arte` →
--      `tipos_proceso` (BORDADO→'bordado', ESTAMPADO→'estampado').
--   4. La `descripcion` pasa a REQUERIDA y se rellena con el `nombre` donde venía vacía; el
--      `nombre` se RETIRA (§Post-F9.52 punto 1 — Daniel: *"Es completamente irrelevante el
--      nombre del estampado"*). Nada se pierde en silencio (D3).
--   5. Campo NUEVO `posicion` (texto libre — frente / espalda / manga…, punto 2).
--   6. Las fotos del arte pasan a PLURAL: nace `modelo_arte_foto` y se migra la foto única de
--      cada arte como su primera foto (punto 5).
--   7. La identidad del renglón congelado de la orden pasa de `(id_orden, nombre)` a
--      `(id_orden, id_modelo_arte)`. Los renglones agregados a mano (id_modelo_arte NULL) no
--      chocan entre sí: Postgres trata los NULL como distintos.
--   8. Se tira el enum `tipo_arte`.
--
-- SIN permisos nuevos (el arte se gobierna con `modelos.*` y el catálogo con `tipos-proceso.*`).

-- ── 1. Las dos banderas del catálogo único ───────────────────────────────────
ALTER TABLE "tipos_proceso"
    ADD COLUMN "es_arte" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "usa_puntadas" BOOLEAN NOT NULL DEFAULT false;

-- Marcado por CÓDIGO (la clave estable del catálogo; el nombre visible es editable). Si alguno
-- de esos códigos no existe todavía, el seed idempotente los siembra ya marcados.
UPDATE "tipos_proceso" SET "es_arte" = true
 WHERE "codigo" IN ('bordado', 'estampado', 'aplicacion', 'lavado');
UPDATE "tipos_proceso" SET "usa_puntadas" = true WHERE "codigo" = 'bordado';

-- ── 2. Destinos de la traducción del enum ────────────────────────────────────
-- `modificado_en` no tiene DEFAULT en la base (Prisma lo escribe con @updatedAt), así que se
-- fija explícitamente.
INSERT INTO "tipos_proceso" ("codigo", "nombre", "genera_entrada_pt", "es_arte", "usa_puntadas", "activo", "creado_en", "modificado_en")
SELECT 'bordado', 'Bordado', false, true, true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
 WHERE NOT EXISTS (SELECT 1 FROM "tipos_proceso" WHERE "codigo" = 'bordado');
INSERT INTO "tipos_proceso" ("codigo", "nombre", "genera_entrada_pt", "es_arte", "usa_puntadas", "activo", "creado_en", "modificado_en")
SELECT 'estampado', 'Estampado', false, true, false, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
 WHERE NOT EXISTS (SELECT 1 FROM "tipos_proceso" WHERE "codigo" = 'estampado');

-- ── 3+4+5. `modelo_arte`: tipo por catálogo, descripción requerida, posición, sin nombre ──
ALTER TABLE "modelo_arte"
    ADD COLUMN "posicion" TEXT,
    ADD COLUMN "id_tipo_arte" INTEGER;

UPDATE "modelo_arte" ma
   SET "id_tipo_arte" = tp."id"
  FROM "tipos_proceso" tp
 WHERE tp."codigo" = CASE ma."tipo" WHEN 'BORDADO' THEN 'bordado' ELSE 'estampado' END;

-- La descripción es lo único que quedará para distinguir un arte de otro: donde venía vacía se
-- rellena con el nombre que está a punto de desaparecer (D3: el dato no se tira).
UPDATE "modelo_arte"
   SET "descripcion" = "nombre"
 WHERE "descripcion" IS NULL OR btrim("descripcion") = '';
-- Red de seguridad: un nombre en blanco (imposible por la validación de la app, pero la BD no lo
-- garantiza) dejaría una descripción vacía y la columna NOT NULL fallaría el deploy.
UPDATE "modelo_arte"
   SET "descripcion" = 'Arte ' || "id"::text
 WHERE "descripcion" IS NULL OR btrim("descripcion") = '';

ALTER TABLE "modelo_arte" ALTER COLUMN "descripcion" SET NOT NULL;
ALTER TABLE "modelo_arte" ALTER COLUMN "id_tipo_arte" SET NOT NULL;

DROP INDEX "modelo_arte_id_modelo_nombre_key";
ALTER TABLE "modelo_arte" DROP COLUMN "nombre";
ALTER TABLE "modelo_arte" DROP COLUMN "tipo";

CREATE INDEX "modelo_arte_id_tipo_arte_idx" ON "modelo_arte"("id_tipo_arte");
ALTER TABLE "modelo_arte" ADD CONSTRAINT "modelo_arte_id_tipo_arte_fkey"
    FOREIGN KEY ("id_tipo_arte") REFERENCES "tipos_proceso"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── 6. Las fotos del arte, en plural ─────────────────────────────────────────
CREATE TABLE "modelo_arte_foto" (
    "id" SERIAL NOT NULL,
    "id_modelo_arte" INTEGER NOT NULL,
    "id_archivo" TEXT NOT NULL,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,

    CONSTRAINT "modelo_arte_foto_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "modelo_arte_foto_id_modelo_arte_idx" ON "modelo_arte_foto"("id_modelo_arte");
CREATE INDEX "modelo_arte_foto_id_archivo_idx" ON "modelo_arte_foto"("id_archivo");

ALTER TABLE "modelo_arte_foto" ADD CONSTRAINT "modelo_arte_foto_id_modelo_arte_fkey"
    FOREIGN KEY ("id_modelo_arte") REFERENCES "modelo_arte"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "modelo_arte_foto" ADD CONSTRAINT "modelo_arte_foto_id_archivo_fkey"
    FOREIGN KEY ("id_archivo") REFERENCES "archivos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ⚠️ SIN índice único sobre `id_archivo`: varios artes COMPARTEN el mismo `Archivo` a propósito
-- (la migración `20260814120000_arte_en_el_modelo` duplicó los artes compartidos apuntando al
-- mismo objeto de R2, y «copiar arte de otro modelo» hace lo mismo). Por eso el `Archivo` solo se
-- borra cuando ninguna otra foto de arte lo referencia (`arte-modelo.ts`).
INSERT INTO "modelo_arte_foto" ("id_modelo_arte", "id_archivo", "orden", "creado_en", "creado_por_id")
SELECT ma."id", ma."id_archivo_foto", 0, ma."creado_en", ma."creado_por_id"
  FROM "modelo_arte" ma
 WHERE ma."id_archivo_foto" IS NOT NULL;

DROP INDEX "modelo_arte_id_archivo_foto_idx";
ALTER TABLE "modelo_arte" DROP COLUMN "id_archivo_foto";

-- ── 3+4+5+7. `orden_arte`: la receta congelada de la orden ───────────────────
ALTER TABLE "orden_arte"
    ADD COLUMN "posicion" TEXT,
    ADD COLUMN "id_tipo_arte" INTEGER;

UPDATE "orden_arte" oa
   SET "id_tipo_arte" = tp."id"
  FROM "tipos_proceso" tp
 WHERE tp."codigo" = CASE oa."tipo" WHEN 'BORDADO' THEN 'bordado' ELSE 'estampado' END;

UPDATE "orden_arte"
   SET "descripcion" = "nombre"
 WHERE "descripcion" IS NULL OR btrim("descripcion") = '';
UPDATE "orden_arte"
   SET "descripcion" = 'Arte ' || "id"::text
 WHERE "descripcion" IS NULL OR btrim("descripcion") = '';

ALTER TABLE "orden_arte" ALTER COLUMN "descripcion" SET NOT NULL;
ALTER TABLE "orden_arte" ALTER COLUMN "id_tipo_arte" SET NOT NULL;

-- La identidad del renglón pasa a ser su traza al arte del modelo. Con los datos que produjo
-- V1-E3d pieza B esto NO puede chocar (la copia crea UN renglón por arte del modelo y el
-- "agregar" casaba por nombre, que era único dentro del modelo), pero si alguna base trajera
-- duplicados el deploy debe PARARSE con un mensaje entendible en vez de reventar con un error de
-- índice sin contexto — o, peor, arreglarlos en silencio (D3).
DO $$
DECLARE
    v_dup INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_dup FROM (
        SELECT "id_orden", "id_modelo_arte"
          FROM "orden_arte"
         WHERE "id_modelo_arte" IS NOT NULL
         GROUP BY "id_orden", "id_modelo_arte"
        HAVING COUNT(*) > 1
    ) d;
    IF v_dup > 0 THEN
        RAISE EXCEPTION 'V1-E3f: % combinaciones (orden, arte del modelo) están repetidas en orden_arte. Al retirarse el nombre, la traza al arte del modelo pasa a ser la identidad del renglón y no puede repetirse. Revísalas a mano ANTES de aplicar esta migración: SELECT id_orden, id_modelo_arte, count(*) FROM orden_arte WHERE id_modelo_arte IS NOT NULL GROUP BY 1,2 HAVING count(*) > 1;', v_dup;
    END IF;
END $$;

DROP INDEX "orden_arte_id_orden_nombre_key";
ALTER TABLE "orden_arte" DROP COLUMN "nombre";
ALTER TABLE "orden_arte" DROP COLUMN "tipo";

CREATE UNIQUE INDEX "orden_arte_id_orden_id_modelo_arte_key" ON "orden_arte"("id_orden", "id_modelo_arte");
CREATE INDEX "orden_arte_id_tipo_arte_idx" ON "orden_arte"("id_tipo_arte");
ALTER TABLE "orden_arte" ADD CONSTRAINT "orden_arte_id_tipo_arte_fkey"
    FOREIGN KEY ("id_tipo_arte") REFERENCES "tipos_proceso"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── 8. Se va el enum ─────────────────────────────────────────────────────────
DROP TYPE "tipo_arte";
