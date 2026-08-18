-- V1-E3f (pieza B) — PROVEEDORES, COMO DANIEL LOS USA
--
-- Decisiones: `Documentacion_MJD/DECISIONES.md` §Post-F9.54 punto 1 (renombres de rol),
-- §Post-F9.56 puntos 1/2/3 (contactos, campo corto duplicado, el tipo sale sobrando),
-- §Post-F9.57 puntos 1/2/3 (puesto abierto, fusión del campo corto, traducción del tipo) y
-- §Post-F9.58 punto 1 (el campo corto fusionado es ÚNICO).
--
-- Qué hace, en orden:
--   1. RENOMBRA cuatro roles de proveedor por CÓDIGO (estampado→Estampador, bordado→Bordador,
--      vende-telas→Telas, vende-avios→Avíos). Va aquí y NO en el seed a propósito: el seed
--      (`sembrarRolesProveedor`) hace `upsert` con `update: {}`, que NO toca el nombre de un rol
--      que ya existe — con `SEED_ON_START=true` los renombres NO ocurrirían y el deploy pasaría
--      en verde con los nombres viejos. La nota vieja de §Post-F9.54 decía lo contrario y ya está
--      corregida en el documento. `ROLES_PROVEEDOR_BASE` también se actualizó, para las bases
--      recién creadas; los dos caminos coinciden a propósito.
--   2. Nace `proveedor_contacto` (N contactos por proveedor, puesto en TEXTO LIBRE) y el
--      `proveedores.contacto` viejo se convierte en el PRIMER contacto de su proveedor antes de
--      tirar la columna: el dato no se pierde (D3).
--   3. FUSIONA los dos campos cortos en `nombre_corto` y lo hace ÚNICO. Siembra con el `corto`
--      del taller (Daniel: *"en la migración hay que meter el que ya está ahorita como campo
--      corto de los maquileros"*) y **REPORTA las colisiones en la bitácora** en vez de
--      resolverlas en silencio (D3). Luego tira `corto`.
--   4. TRADUCE `proveedores.tipo` a rol de forma ADITIVA (no pisa los roles ya marcados) y tira
--      la columna y su enum.
--
-- SIN permisos nuevos: los contactos se gobiernan con `proveedores.ver`/`.administrar`, que ya
-- existen. El seed NO siembra nada nuevo → este deploy NO exige `SEED_ON_START`.

-- ── 1. Los cuatro renombres de rol (por CÓDIGO, la clave estable) ────────────
-- `modificado_en` no tiene DEFAULT en la base (Prisma lo escribe con @updatedAt): se fija a mano.
UPDATE "roles_proveedor" SET "nombre" = 'Estampador', "modificado_en" = CURRENT_TIMESTAMP
 WHERE "codigo" = 'estampado' AND "nombre" <> 'Estampador';
UPDATE "roles_proveedor" SET "nombre" = 'Bordador', "modificado_en" = CURRENT_TIMESTAMP
 WHERE "codigo" = 'bordado' AND "nombre" <> 'Bordador';
UPDATE "roles_proveedor" SET "nombre" = 'Telas', "modificado_en" = CURRENT_TIMESTAMP
 WHERE "codigo" = 'vende-telas' AND "nombre" <> 'Telas';
UPDATE "roles_proveedor" SET "nombre" = 'Avíos', "modificado_en" = CURRENT_TIMESTAMP
 WHERE "codigo" = 'vende-avios' AND "nombre" <> 'Avíos';

-- ── 2. Contactos: una TABLA, no un campo ─────────────────────────────────────
CREATE TABLE "proveedor_contacto" (
    "id" SERIAL NOT NULL,
    "id_proveedor" INTEGER NOT NULL,
    "nombre" TEXT NOT NULL,
    "puesto" TEXT,
    "telefono" TEXT,
    "email" TEXT,
    "notas" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "proveedor_contacto_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "proveedor_contacto_id_proveedor_idx" ON "proveedor_contacto"("id_proveedor");

ALTER TABLE "proveedor_contacto"
    ADD CONSTRAINT "proveedor_contacto_id_proveedor_fkey"
    FOREIGN KEY ("id_proveedor") REFERENCES "proveedores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- El contacto viejo (un nombre suelto) pasa a ser el primer contacto de su proveedor. El puesto
-- queda VACÍO porque el sistema viejo nunca lo preguntó: inventarlo sería peor que dejarlo abierto.
INSERT INTO "proveedor_contacto" ("id_proveedor", "nombre", "telefono", "email", "creado_en", "modificado_en")
SELECT p."id", btrim(p."contacto"), p."telefono", p."email", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM "proveedores" p
 WHERE p."contacto" IS NOT NULL AND btrim(p."contacto") <> '';

ALTER TABLE "proveedores" DROP COLUMN "contacto";

-- ── 3. Fusión de los dos campos cortos en `nombre_corto`, ÚNICO ──────────────
-- El orden importa: primero se REPORTA leyendo las dos columnas vivas, y sólo después se pisa
-- una con la otra. Al revés, el valor desplazado ya no existiría para poder reportarlo.
--
-- Unicidad: el índice de la base es exacto, pero aquí se DEDUPLICA sin distinguir mayúsculas —
-- igual que el dominio, que valida el campo corto libre con `mode: 'insensitive'` (mismo criterio
-- que el `nombre`). Es a propósito más estricto que el índice: "TCD" y "tcd" son la misma clave
-- para quien la teclea, y dejarlas convivir reabriría justo la confusión que se está cerrando.

-- 3.a REPORTE de lo que se va a desplazar: proveedores que traían nombre corto Y clave corta de
--     taller DISTINTOS. Gana la clave del taller (es la de uso diario, la que la gente teclea) y
--     el nombre corto desplazado queda en la bitácora. Nada se pierde en silencio (D3).
INSERT INTO "bitacora" ("entidad", "id_entidad", "accion", "datos", "fecha")
SELECT 'Proveedor', p."id"::text, 'OTRO',
       jsonb_build_object(
         'operacion', 'fusion-campo-corto',
         'migracion', '20260818140000_proveedores_como_daniel_los_usa',
         'motivo', 'El proveedor traia nombre corto Y clave corta de taller distintos: gano la clave del taller.',
         'nombreCortoDesplazado', btrim(p."nombre_corto"),
         'nombreCortoFinal', btrim(p."corto")
       ), CURRENT_TIMESTAMP
  FROM "proveedores" p
 WHERE btrim(COALESCE(p."nombre_corto", '')) <> ''
   AND btrim(COALESCE(p."corto", '')) <> ''
   AND lower(btrim(p."nombre_corto")) <> lower(btrim(p."corto"));

-- 3.b El `corto` del taller entra al campo fusionado (Daniel: *"en la migración hay que meter el
--     que ya está ahorita como campo corto de los maquileros"*).
UPDATE "proveedores"
   SET "nombre_corto" = btrim("corto")
 WHERE btrim(COALESCE("corto", '')) <> '';

-- Normaliza: '' no es una clave corta (y varios '' chocarían contra el UNIQUE); se recortan
-- los espacios de los que venían del campo viejo sin normalizar.
UPDATE "proveedores" SET "nombre_corto" = NULL WHERE btrim(COALESCE("nombre_corto", '')) = '';
UPDATE "proveedores" SET "nombre_corto" = btrim("nombre_corto")
 WHERE "nombre_corto" IS NOT NULL AND "nombre_corto" <> btrim("nombre_corto");

-- 3.c COLISIONES de unicidad: dos o más proveedores compartiendo el mismo campo corto. Se conserva
--     el del id MENOR (el más antiguo) y a los demás se les VACÍA el campo, dejando constancia de
--     qué valor tenían y con quién chocaron, para que una persona lo reasigne. No se inventa un
--     sufijo: un "TCD-2" que nadie pidió es peor que un campo vacío que se ve.
INSERT INTO "bitacora" ("entidad", "id_entidad", "accion", "datos", "fecha")
SELECT 'Proveedor', d."id"::text, 'OTRO',
       jsonb_build_object(
         'operacion', 'colision-campo-corto',
         'migracion', '20260818140000_proveedores_como_daniel_los_usa',
         'motivo', 'El campo corto es ahora UNICO y este valor ya lo usaba otro proveedor: se vacio para que se reasigne a mano.',
         'valorEnConflicto', d."nombre_corto",
         'seQuedoConEl', d."id_ganador"
       ), CURRENT_TIMESTAMP
  FROM (
      SELECT p."id", p."nombre_corto",
             MIN(p."id") OVER (PARTITION BY lower(p."nombre_corto")) AS "id_ganador"
        FROM "proveedores" p
       WHERE p."nombre_corto" IS NOT NULL
  ) d
 WHERE d."id" <> d."id_ganador";

UPDATE "proveedores" p
   SET "nombre_corto" = NULL
  FROM (
      SELECT q."id", MIN(q."id") OVER (PARTITION BY lower(q."nombre_corto")) AS "id_ganador"
        FROM "proveedores" q
       WHERE q."nombre_corto" IS NOT NULL
  ) d
 WHERE p."id" = d."id" AND d."id" <> d."id_ganador";

-- Al tirar la columna se va con ella su índice único propio.
ALTER TABLE "proveedores" DROP COLUMN "corto";

CREATE UNIQUE INDEX "proveedores_nombre_corto_key" ON "proveedores"("nombre_corto");

-- ── 4. El TIPO se traduce a rol y se retira ──────────────────────────────────
-- ADITIVO: `ON CONFLICT DO NOTHING` respeta los roles que el proveedor ya tenía marcados.
-- `SIN_CLASIFICAR` no produce rol (no hay nada que traducir).
INSERT INTO "proveedor_rol" ("id_proveedor", "id_rol_proveedor", "creado_en")
SELECT p."id", r."id", CURRENT_TIMESTAMP
  FROM "proveedores" p
  JOIN "roles_proveedor" r
    ON r."codigo" = CASE p."tipo"
                      WHEN 'TELAS'     THEN 'vende-telas'
                      WHEN 'AVIOS'     THEN 'vende-avios'
                      WHEN 'SERVICIOS' THEN 'otros-servicios'
                    END
 WHERE p."tipo" <> 'SIN_CLASIFICAR'
ON CONFLICT ("id_proveedor", "id_rol_proveedor") DO NOTHING;

ALTER TABLE "proveedores" DROP COLUMN "tipo";

DROP TYPE "tipo_proveedor";
