-- V1-E3n · Modelos de DESARROLLO vs. de PRODUCCIÓN (§Post-F9.34 + §Post-F9.46).
--
-- Migración ADITIVA salvo UNA redefinición explícita, documentada abajo (`numero_produccion`).
-- No borra filas ni columnas de negocio; no toca BOM, arte, fotos, precosteo ni órdenes.
--
--  1. `clientes.abreviatura`      — el `CYA` del código de desarrollo (única entre clientes).
--  2. `generos.digito_*`          — 2º dígito de la nomenclatura + su continuación (Caballero 1→5).
--  3. `tipos_producto.digito_*`   — 1er dígito (concepto).
--  4. `modelos.origen`            — desarrollo | produccion (los existentes: produccion).
--  5. `modelos.codigo_desarrollo` — el `CYA-26-71-001`, conservado tras pasar a producción (D3).
--  6. `modelos.numero_produccion` — REDEFINIDA (ver abajo) + backfill desde el código de 5 dígitos.
--  7. `secuencias_globales`       — contador atómico A3 sin empresa, para catálogos GLOBALES.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Abreviatura del cliente
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "clientes" ADD COLUMN "abreviatura" TEXT;
CREATE UNIQUE INDEX "clientes_abreviatura_key" ON "clientes"("abreviatura");

-- ─────────────────────────────────────────────────────────────────────────────
-- 2-3. Dígitos de la nomenclatura en los catálogos (§Post-F9.34, tabla de 2014)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "generos" ADD COLUMN "digito_nomenclatura" INTEGER;
ALTER TABLE "generos" ADD COLUMN "digito_alterno" INTEGER;
ALTER TABLE "tipos_producto" ADD COLUMN "digito_concepto" INTEGER;

-- Géneros sembrados por `prisma/seed.ts` (GENEROS_BASE). Se asignan por NOMBRE y sólo donde el
-- dígito está vacío: si alguien ya lo capturó a mano, no se pisa. El 8 no se usa; Caballero
-- lleva continuación al 5 porque su serie `x1` ya llegó a 999 en el Access.
UPDATE "generos" SET "digito_nomenclatura" = 1, "digito_alterno" = 5 WHERE "nombre" = 'Caballero'     AND "digito_nomenclatura" IS NULL;
UPDATE "generos" SET "digito_nomenclatura" = 2 WHERE "nombre" = 'Dama'          AND "digito_nomenclatura" IS NULL;
UPDATE "generos" SET "digito_nomenclatura" = 3 WHERE "nombre" = 'Niño Juvenil'  AND "digito_nomenclatura" IS NULL;
UPDATE "generos" SET "digito_nomenclatura" = 4 WHERE "nombre" = 'Niño Infantil' AND "digito_nomenclatura" IS NULL;
UPDATE "generos" SET "digito_nomenclatura" = 6 WHERE "nombre" = 'Niña Infantil' AND "digito_nomenclatura" IS NULL;
UPDATE "generos" SET "digito_nomenclatura" = 7 WHERE "nombre" = 'Niña Juvenil'  AND "digito_nomenclatura" IS NULL;
UPDATE "generos" SET "digito_nomenclatura" = 9 WHERE "nombre" = 'Beba'          AND "digito_nomenclatura" IS NULL;
UPDATE "generos" SET "digito_nomenclatura" = 0 WHERE "nombre" = 'Bebo'          AND "digito_nomenclatura" IS NULL;

-- Tipos de producto sembrados por `prisma/seed-calidad.ts` (TIPOS_PRODUCTO_BASE). "Ropa interior"
-- NO tiene dígito en la tabla de Daniel: se queda en NULL a propósito (el generador lo dirá).
UPDATE "tipos_producto" SET "digito_concepto" = 2 WHERE "nombre" = 'Conjunto'  AND "digito_concepto" IS NULL;
UPDATE "tipos_producto" SET "digito_concepto" = 3 WHERE "nombre" = 'Short'     AND "digito_concepto" IS NULL;
UPDATE "tipos_producto" SET "digito_concepto" = 4 WHERE "nombre" = 'Vestido'   AND "digito_concepto" IS NULL;
UPDATE "tipos_producto" SET "digito_concepto" = 5 WHERE "nombre" = 'Playera'   AND "digito_concepto" IS NULL;
UPDATE "tipos_producto" SET "digito_concepto" = 6 WHERE "nombre" = 'Sudadera'  AND "digito_concepto" IS NULL;
UPDATE "tipos_producto" SET "digito_concepto" = 7 WHERE "nombre" = 'Pantalón'  AND "digito_concepto" IS NULL;

-- ⚠️ FALTABAN DOS CONCEPTOS DE LA TABLA DE DANIEL, y no son marginales: en el Access el concepto 8
-- (Chamarra/Chaleco) tiene 356 modelos y el 9 (Gorra/Polo/Bata) 73 — el 9% del catálogo. Sin ellos,
-- desarrollar una chamarra o una gorra era imposible (no había tipo que elegir). Se crean aquí y no
-- sólo en el seed para que `prueba` los tenga aunque no se re-siembre. `ON CONFLICT` los hace
-- idempotentes y respeta un nombre ya capturado a mano.
INSERT INTO "tipos_producto" ("nombre", "digito_concepto", "activo", "creado_en", "modificado_en")
VALUES ('Chamarra', 8, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
       ('Gorra',    9, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("nombre") DO NOTHING;

-- Un concepto es una serie INDEPENDIENTE de 999: dos tipos ACTIVOS con el mismo dígito se estarían
-- repartiendo la misma serie sin saberlo. El dominio lo valida, y este índice PARCIAL lo respalda
-- en la base (sólo entre activos y sólo cuando el dígito está capturado).
CREATE UNIQUE INDEX "tipos_producto_digito_concepto_activo_key"
  ON "tipos_producto"("digito_concepto") WHERE "activo" AND "digito_concepto" IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4-5. Origen y código de desarrollo del modelo
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TYPE "origen_modelo" AS ENUM ('desarrollo', 'produccion');

-- DEFAULT 'produccion' a propósito: todo lo que existe hoy —los 4,987 migrados del Access y los
-- capturados a mano— tiene un código que YA es de producción. Nace vacío el catálogo de desarrollo.
ALTER TABLE "modelos" ADD COLUMN "origen" "origen_modelo" NOT NULL DEFAULT 'produccion';

ALTER TABLE "modelos" ADD COLUMN "codigo_desarrollo" TEXT;
CREATE UNIQUE INDEX "modelos_codigo_desarrollo_key" ON "modelos"("codigo_desarrollo");

-- Índice del filtro por default del catálogo/galería (origen + activo, ordenado por código).
CREATE INDEX "modelos_origen_activo_idx" ON "modelos"("origen", "activo");

-- Invariante: un modelo de DESARROLLO no tiene número de producción (lo estrena al promoverse).
-- Al revés NO se exige: hay 285 modelos migrados de producción cuyo código no es numérico de 5
-- dígitos (`51783a`, `M-18`) y por eso se quedan sin número.
ALTER TABLE "modelos" ADD CONSTRAINT "modelos_desarrollo_sin_numero_produccion_check"
  CHECK ("origen" <> 'desarrollo' OR "numero_produccion" IS NULL);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. `modelos.numero_produccion` — REDEFINICIÓN (el único cambio no aditivo)
-- ─────────────────────────────────────────────────────────────────────────────
-- Hasta hoy esta columna guardaba un consecutivo GLOBAL sin significado, minteado por
-- `numero_produccion_seq` en la primera salida a producción (rediseño R3/B4): 1, 2, 3… Ese número
-- NUNCA fue el nº de producción del negocio, que es el de 5 dígitos concepto+género+consecutivo
-- (§Post-F9.34). Se limpia y se rellena con el número REAL derivado del código.
--
-- Los valores viejos NO se pierden en silencio (D3): cada minteo quedó registrado en la `bitacora`
-- (`Orden` / accion OTRO / datos.numeroProduccion, ver `salida-produccion.ts`), y sólo existían en
-- el ambiente de `prueba` — en producción el módulo nunca corrió.
UPDATE "modelos" SET "numero_produccion" = NULL WHERE "numero_produccion" IS NOT NULL;
UPDATE "modelos" SET "numero_produccion" = "codigo"::INTEGER WHERE "codigo" ~ '^[0-9]{5}$';

-- La secuencia global deja de tener uso: el consecutivo de producción se calcula por (concepto,
-- género) sobre la ocupación real del catálogo, bajo advisory lock (ver `dominio/modelos/nomenclatura.ts`).
DROP SEQUENCE IF EXISTS "numero_produccion_seq";

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Secuencias GLOBALES (A3 sin empresa) — para el consecutivo de DESARROLLO
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE "secuencias_globales" (
    "id"    SERIAL NOT NULL,
    "clave" TEXT NOT NULL,
    "valor" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "secuencias_globales_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "secuencias_globales_clave_key" ON "secuencias_globales"("clave");
