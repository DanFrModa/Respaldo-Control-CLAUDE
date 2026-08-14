-- V1-E3d (pieza A) — EL ARTE DEJA DE SER CATÁLOGO Y SE VA DENTRO DEL MODELO
-- Decisión `Documentacion_MJD/DECISIONES.md` §Post-F9.35 (Daniel, 12-ago-2026):
--   "cada arte va pegado siempre a un solo modelo… sería más fácil manejar el arte
--    (o varios) dentro del modelo. Ahí mismo establecer su precio, el proveedor."
--
-- Qué hace, en orden:
--   1. `tipo_bordado` → `tipo_arte`, `bom_bordado` → `bom_arte` (vocabulario: ya no hay bordados).
--   2. Crea `modelo_arte` (hijo del modelo, con proveedor NUEVO y foto).
--   3. MIGRA los datos: cada renglón de `modelo_bordado` se lleva su copia del catálogo
--      (nombre/descripción/puntadas/tipo/foto) y su precio (el del renglón, o el del catálogo si
--      el renglón venía vacío — la MISMA cascada que aplicaba `costo-orden.ts`, para que el
--      costeo no se mueva ni un centavo). Los artes usados por VARIOS modelos se DUPLICAN.
--   4. Duplica el registro `archivos` de la foto por cada copia: `archivos.key` es único, así
--      que dos artes no pueden compartir fila, pero SÍ el mismo objeto de R2 (la key se copia
--      tal cual). Nadie borra objetos de R2 hoy (deuda ya documentada), así que es seguro.
--      [Nota: al final `modelo_arte.id_archivo_foto` NO es único justo para permitir esto.]
--   5. Re-apunta la traza de `precosto_linea` (`id_bordado` → `id_modelo_arte`) por
--      modelo + nombre del arte.
--   6. REPORTA en el log los artes que NO se migran (los que ningún modelo usa: la depuración
--      que Daniel pedía) — no se tiran en silencio.
--   7. Tira `modelo_bordado`, `bordados`, los `archivos` que quedaron huérfanos del catálogo,
--      el mapeo de migración del catálogo y los permisos `bordados.*` (ya no hay catálogo que
--      administrar; el arte se gobierna con `modelos.*`).

-- ── 1. Vocabulario de los enums ───────────────────────────────────────────────
ALTER TYPE "tipo_bordado" RENAME TO "tipo_arte";
ALTER TYPE "origen_precosto_linea" RENAME VALUE 'bom_bordado' TO 'bom_arte';

-- ── 2. La tabla nueva ─────────────────────────────────────────────────────────
CREATE TABLE "modelo_arte" (
    "id" SERIAL NOT NULL,
    "id_modelo" INTEGER NOT NULL,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "puntadas" INTEGER,
    "precio" DECIMAL(12,2),
    "tipo" "tipo_arte" NOT NULL DEFAULT 'BORDADO',
    "id_proveedor" INTEGER,
    "id_archivo_foto" TEXT,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "modelo_arte_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "modelo_arte_id_modelo_nombre_key" ON "modelo_arte"("id_modelo", "nombre");
CREATE INDEX "modelo_arte_id_modelo_idx" ON "modelo_arte"("id_modelo");
CREATE INDEX "modelo_arte_id_proveedor_idx" ON "modelo_arte"("id_proveedor");
CREATE INDEX "modelo_arte_id_archivo_foto_idx" ON "modelo_arte"("id_archivo_foto");

ALTER TABLE "modelo_arte" ADD CONSTRAINT "modelo_arte_id_modelo_fkey"
    FOREIGN KEY ("id_modelo") REFERENCES "modelos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "modelo_arte" ADD CONSTRAINT "modelo_arte_id_proveedor_fkey"
    FOREIGN KEY ("id_proveedor") REFERENCES "proveedores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "modelo_arte" ADD CONSTRAINT "modelo_arte_id_archivo_foto_fkey"
    FOREIGN KEY ("id_archivo_foto") REFERENCES "archivos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── 3. Los datos: un arte por renglón de BOM, con su copia del catálogo ───────
-- El precio resuelto es `modelo_bordado.precio ?? bordados.precio` — la misma cascada que
-- leían `costo-orden.ts`, `pre-costo.ts` y `precostos.ts`. Al quedar un solo precio, el
-- resultado del costeo es idéntico para TODOS los datos existentes.
INSERT INTO "modelo_arte" (
    "id_modelo", "nombre", "descripcion", "puntadas", "precio", "tipo",
    "id_archivo_foto", "orden", "creado_en", "creado_por_id", "modificado_en", "modificado_por_id"
)
SELECT
    mb."id_modelo",
    b."nombre",
    b."descripcion",
    b."puntadas",
    COALESCE(mb."precio", b."precio"),
    b."tipo",
    b."id_archivo_foto",
    mb."orden",
    mb."creado_en",
    mb."creado_por_id",
    mb."modificado_en",
    mb."modificado_por_id"
FROM "modelo_bordado" mb
JOIN "bordados" b ON b."id" = mb."id_bordado";

-- ── 4. La foto de los artes duplicados ───────────────────────────────────────
-- Un arte compartido por 3 modelos deja 3 copias, y las 3 deben conservar su foto. NO se puede
-- clonar la fila de `archivos` (su `key` es única) ni copiar el objeto en R2 desde SQL, así que
-- las copias COMPARTEN el mismo `id_archivo_foto`. Por eso `modelo_arte.id_archivo_foto` NO
-- lleva índice único (a diferencia del viejo `bordados.id_archivo_foto`), y por eso
-- `dominio/modelos/arte-modelo.ts` solo borra el `Archivo` al quitar la foto cuando ningún otro
-- arte lo referencia. Nada de lo migrado pierde su foto.

-- ── 5. Traza del precosto: id_bordado → id_modelo_arte ───────────────────────
-- El precosto cuelga de un desarrollo, que es de UN modelo: el arte equivalente es el del
-- mismo modelo con el mismo nombre. Si el renglón apuntaba a un arte que el modelo ya no
-- lleva, queda en NULL (el precio usado ya vive en `precio_unit`: nada se pierde).
ALTER TABLE "precosto_linea" DROP CONSTRAINT "precosto_linea_id_bordado_fkey";
DROP INDEX "precosto_linea_id_bordado_idx";
ALTER TABLE "precosto_linea" ADD COLUMN "id_modelo_arte" INTEGER;

UPDATE "precosto_linea" pl
SET "id_modelo_arte" = ma."id"
FROM "precostos" p, "desarrollos" d, "bordados" b, "modelo_arte" ma
WHERE pl."id_precosto" = p."id"
  AND d."id" = p."id_desarrollo"
  AND b."id" = pl."id_bordado"
  AND ma."id_modelo" = d."id_modelo"
  AND ma."nombre" = b."nombre";

ALTER TABLE "precosto_linea" DROP COLUMN "id_bordado";
CREATE INDEX "precosto_linea_id_modelo_arte_idx" ON "precosto_linea"("id_modelo_arte");
ALTER TABLE "precosto_linea" ADD CONSTRAINT "precosto_linea_id_modelo_arte_fkey"
    FOREIGN KEY ("id_modelo_arte") REFERENCES "modelo_arte"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── 6. Reporte: qué se migró y qué NO (los artes que ningún modelo usa) ───────
DO $$
DECLARE
    v_migrados INTEGER;
    v_modelos INTEGER;
    v_origen INTEGER;
    v_duplicados INTEGER;
    v_sin_uso INTEGER;
    v_fila RECORD;
BEGIN
    SELECT COUNT(*), COUNT(DISTINCT "id_modelo") INTO v_migrados, v_modelos FROM "modelo_arte";
    SELECT COUNT(DISTINCT "id_bordado") INTO v_origen FROM "modelo_bordado";
    v_duplicados := v_migrados - v_origen;
    SELECT COUNT(*) INTO v_sin_uso
      FROM "bordados" b
     WHERE NOT EXISTS (SELECT 1 FROM "modelo_bordado" mb WHERE mb."id_bordado" = b."id");

    RAISE NOTICE '[arte-en-el-modelo] % artes creados en % modelos, a partir de % del catálogo (% son copias de artes compartidos).',
        v_migrados, v_modelos, v_origen, v_duplicados;
    RAISE NOTICE '[arte-en-el-modelo] % artes del catálogo NO se migran porque ningún modelo los usa (depuración §Post-F9.35). Se listan abajo:', v_sin_uso;

    FOR v_fila IN
        SELECT b."id", b."nombre", b."tipo", b."precio", (b."id_archivo_foto" IS NOT NULL) AS con_foto
          FROM "bordados" b
         WHERE NOT EXISTS (SELECT 1 FROM "modelo_bordado" mb WHERE mb."id_bordado" = b."id")
         ORDER BY b."nombre"
    LOOP
        RAISE NOTICE '[arte-en-el-modelo] descartado: id=% nombre=% tipo=% precio=% foto=%',
            v_fila."id", v_fila."nombre", v_fila."tipo", v_fila."precio", v_fila.con_foto;
    END LOOP;
END $$;

-- ── 7. Se va el catálogo ─────────────────────────────────────────────────────
DROP TABLE "modelo_bordado";

-- Los `archivos` de los bordados NO migrados quedan huérfanos: se borran. Los de los migrados
-- siguen referenciados por `modelo_arte` (la FK del paso 2), así que este DELETE no los toca.
DELETE FROM "archivos" a
 WHERE EXISTS (SELECT 1 FROM "bordados" b WHERE b."id_archivo_foto" = a."id")
   AND NOT EXISTS (SELECT 1 FROM "modelo_arte" ma WHERE ma."id_archivo_foto" = a."id");

DROP TABLE "bordados";

-- El mapeo de migración del catálogo viejo ya no aplica (el ETL vuelve a sembrarlo con clave
-- compuesta `<idBordadoViejo>:<idModeloViejo>`, porque ahora es 1:N).
DELETE FROM "mapeo_migracion" WHERE "entidad" = 'Bordado';

-- Los permisos del catálogo desaparecen con él: el arte se gobierna con `modelos.ver` /
-- `modelos.administrar` (no se crean permisos nuevos).
DELETE FROM "roles_permisos"
 WHERE "id_permiso" IN (SELECT "id" FROM "permisos" WHERE "clave" IN ('bordados.ver', 'bordados.administrar'));
DELETE FROM "permisos" WHERE "clave" IN ('bordados.ver', 'bordados.administrar');
