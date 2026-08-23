-- V1-E3d (pieza B) — EL BOM VIVE EN LA OP: la receta se CONGELA en la orden de producción
-- Decisión `Documentacion_MJD/DECISIONES.md` §Post-F9.43 (Daniel, 14-ago-2026):
--   "Un modelo se desarrolla a partir de cierta información. Y en ocasiones se negocia con el
--    cliente que ya no lleve alguna cosa (por ejemplo, quitarle una jareta para abaratar el
--    costo)… El BOM debe de vivir en la OP. De hecho así funciona en Control viejo."
--
-- Qué hace, en orden:
--   1. Enum `estado_renglon_receta` (sin_revisar / revisado / ajustado).
--   2. Crea las CUATRO tablas de la receta congelada: `orden_tela`, `orden_avio`,
--      `orden_avio_talla` y `orden_arte`.
--   3. `ordenes` += `receta_liberada_en` / `receta_liberada_por_id` (§Post-F9.43(c): la puerta
--      antes de COMPRAR; cortar y producir NO se bloquean).
--   4. Crea `historico_orden_v1_hab` — los 28,432 renglones de `OrdenesHab` del viejo, que hasta
--      hoy se tiraban completos, entran al ARCHIVO histórico con el avío como TEXTO (§Post-F9.28).
--      La tabla nace vacía: la llena el ETL (`migracion/etl-historico-ordenes.ts`).
--   5. BACKFILL: cada orden que ya existe recibe SU receta, copiada del BOM de su modelo.
--   6. Las órdenes NO canceladas quedan LIBERADAS por la migración (ver la nota de abajo).
--
-- ⭐ POR QUÉ EL BACKFILL LIBERA — Y POR QUÉ **NO** LIBERA LAS RECETAS VACÍAS:
--    La puerta de Desarrollo es para lo que se compra **de aquí en adelante**. Cerrarla hacia atrás
--    dejaría el backlog vivo entero —miles de órdenes— sin poder explotar MRP ni generar OC el día
--    del deploy, hasta que alguien revisara una por una: la etapa vino a dar control, no a parar la
--    operación. Los renglones backfilleados SÍ nacen `sin_revisar`, así que la pantalla sigue
--    diciendo la verdad ("nadie ha revisado esto") y el botón de "marcar todo revisado" está ahí.
--    `receta_liberada_por_id` queda NULL = "la liberó la migración", distinguible de una persona.
--
--    ⚠️ **PERO una orden cuya receta quedó VACÍA no se libera**, con la MISMA razón que ya rechaza
--    `liberarReceta` en el dominio: *liberar "nada" dejaría al MRP explotando cero y a alguien
--    creyendo que ya lo revisaron*. El argumento de "no parar el backlog" vale para las órdenes CON
--    receta y no compra nada para las vacías: explotar cero no le sirve a nadie, y cerrarles la
--    puerta es la señal correcta ("captura la receta de esta orden"). No es un caso raro: en el
--    volcado del viejo, **2,577 órdenes (2 de cada 3) tienen un modelo sin BOM**.
--
-- ⚠️ EFECTO COLATERAL DEL BACKFILL, DICHO EN VOZ ALTA: el segundo requisito de "orden completa"
--    pasó de *"¿el modelo tiene avíos?"* a *"¿la receta está liberada?"*. Una orden histórica cuyo
--    modelo tenía arte y telas pero NINGÚN avío `para_produccion` estaba `capturada` ("Falta:
--    avíos"); al quedar liberada aquí, **se completará sola** en el siguiente recálculo. Es
--    coherente con la regla nueva (esa orden sí tiene su receta lista), pero es un cambio de estado
--    del histórico y por eso queda escrito aquí y en la nota de cierre de la etapa.
--
-- ⭐ POR QUÉ EL BACKFILL **NO** CONGELA PRECIOS:
--    El precio que congela el dominio al crear una orden sale de la cascada única de §Post-F9.48
--    (última compra real → amarre → catálogo), que vive en TypeScript y no se puede reproducir
--    fielmente en SQL. Inventar aquí una cascada parecida haría que las órdenes viejas quedaran
--    congeladas con un número que NADIE calculó nunca. Así que `precio` queda NULL y el dominio lo
--    interpreta como "esta orden no congeló precio": cae al catálogo, exactamente como hasta hoy
--    (cero regresión en el costeo de las ~4,000 órdenes existentes) y la pantalla lo dice. En
--    cuanto alguien edite o restaure el renglón, el precio se congela como en cualquier orden nueva.

-- ── 1. Enum ───────────────────────────────────────────────────────────────────
CREATE TYPE "estado_renglon_receta" AS ENUM ('sin_revisar', 'revisado', 'ajustado');

-- ── 2. Las cuatro tablas de la receta congelada ───────────────────────────────
CREATE TABLE "orden_tela" (
    "id" SERIAL NOT NULL,
    "id_orden" INTEGER NOT NULL,
    "id_tela" INTEGER NOT NULL,
    "consumo_por_prenda" DECIMAL(12,4) NOT NULL,
    "precio" DECIMAL(12,2),
    "para_pre_costo" BOOLEAN NOT NULL DEFAULT true,
    "para_produccion" BOOLEAN NOT NULL DEFAULT true,
    "para_costo" BOOLEAN NOT NULL DEFAULT true,
    "id_tela_proveedor" INTEGER,
    "estado" "estado_renglon_receta" NOT NULL DEFAULT 'sin_revisar',
    "agregado_a_mano" BOOLEAN NOT NULL DEFAULT false,
    "excluido" BOOLEAN NOT NULL DEFAULT false,
    "notas" TEXT,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "orden_tela_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "orden_tela_id_orden_id_tela_key" ON "orden_tela"("id_orden", "id_tela");
CREATE INDEX "orden_tela_id_orden_idx" ON "orden_tela"("id_orden");
CREATE INDEX "orden_tela_id_tela_idx" ON "orden_tela"("id_tela");
CREATE INDEX "orden_tela_id_tela_proveedor_idx" ON "orden_tela"("id_tela_proveedor");

ALTER TABLE "orden_tela" ADD CONSTRAINT "orden_tela_id_orden_fkey"
    FOREIGN KEY ("id_orden") REFERENCES "ordenes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "orden_tela" ADD CONSTRAINT "orden_tela_id_tela_fkey"
    FOREIGN KEY ("id_tela") REFERENCES "telas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "orden_tela" ADD CONSTRAINT "orden_tela_id_tela_proveedor_fkey"
    FOREIGN KEY ("id_tela_proveedor") REFERENCES "tela_proveedor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "orden_avio" (
    "id" SERIAL NOT NULL,
    "id_orden" INTEGER NOT NULL,
    "id_avio" INTEGER NOT NULL,
    "consumo_por_prenda" DECIMAL(12,4) NOT NULL,
    "precio" DECIMAL(12,2),
    "para_pre_costo" BOOLEAN NOT NULL DEFAULT true,
    "para_produccion" BOOLEAN NOT NULL DEFAULT true,
    "para_costo" BOOLEAN NOT NULL DEFAULT true,
    "consumo_por_talla" BOOLEAN NOT NULL DEFAULT false,
    "id_avio_proveedor" INTEGER,
    "estado" "estado_renglon_receta" NOT NULL DEFAULT 'sin_revisar',
    "agregado_a_mano" BOOLEAN NOT NULL DEFAULT false,
    "excluido" BOOLEAN NOT NULL DEFAULT false,
    "notas" TEXT,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "orden_avio_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "orden_avio_id_orden_id_avio_key" ON "orden_avio"("id_orden", "id_avio");
CREATE INDEX "orden_avio_id_orden_idx" ON "orden_avio"("id_orden");
CREATE INDEX "orden_avio_id_avio_idx" ON "orden_avio"("id_avio");
CREATE INDEX "orden_avio_id_avio_proveedor_idx" ON "orden_avio"("id_avio_proveedor");

ALTER TABLE "orden_avio" ADD CONSTRAINT "orden_avio_id_orden_fkey"
    FOREIGN KEY ("id_orden") REFERENCES "ordenes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "orden_avio" ADD CONSTRAINT "orden_avio_id_avio_fkey"
    FOREIGN KEY ("id_avio") REFERENCES "avios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "orden_avio_talla" (
    "id_orden_avio" INTEGER NOT NULL,
    "id_talla" INTEGER NOT NULL,
    "consumo" DECIMAL(12,4) NOT NULL,
    "id_avio_medida" INTEGER,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "orden_avio_talla_pkey" PRIMARY KEY ("id_orden_avio", "id_talla")
);

CREATE INDEX "orden_avio_talla_id_orden_avio_idx" ON "orden_avio_talla"("id_orden_avio");
CREATE INDEX "orden_avio_talla_id_talla_idx" ON "orden_avio_talla"("id_talla");
CREATE INDEX "orden_avio_talla_id_avio_medida_idx" ON "orden_avio_talla"("id_avio_medida");

ALTER TABLE "orden_avio_talla" ADD CONSTRAINT "orden_avio_talla_id_orden_avio_fkey"
    FOREIGN KEY ("id_orden_avio") REFERENCES "orden_avio"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "orden_avio_talla" ADD CONSTRAINT "orden_avio_talla_id_talla_fkey"
    FOREIGN KEY ("id_talla") REFERENCES "tallas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "orden_avio_talla" ADD CONSTRAINT "orden_avio_talla_id_avio_medida_fkey"
    FOREIGN KEY ("id_avio_medida") REFERENCES "avio_medida"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "orden_arte" (
    "id" SERIAL NOT NULL,
    "id_orden" INTEGER NOT NULL,
    "id_modelo_arte" INTEGER,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "puntadas" INTEGER,
    "precio" DECIMAL(12,2),
    "tipo" "tipo_arte" NOT NULL DEFAULT 'BORDADO',
    "id_proveedor" INTEGER,
    "estado" "estado_renglon_receta" NOT NULL DEFAULT 'sin_revisar',
    "agregado_a_mano" BOOLEAN NOT NULL DEFAULT false,
    "excluido" BOOLEAN NOT NULL DEFAULT false,
    "notas" TEXT,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "orden_arte_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "orden_arte_id_orden_nombre_key" ON "orden_arte"("id_orden", "nombre");
CREATE INDEX "orden_arte_id_orden_idx" ON "orden_arte"("id_orden");
CREATE INDEX "orden_arte_id_modelo_arte_idx" ON "orden_arte"("id_modelo_arte");
CREATE INDEX "orden_arte_id_proveedor_idx" ON "orden_arte"("id_proveedor");

ALTER TABLE "orden_arte" ADD CONSTRAINT "orden_arte_id_orden_fkey"
    FOREIGN KEY ("id_orden") REFERENCES "ordenes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "orden_arte" ADD CONSTRAINT "orden_arte_id_modelo_arte_fkey"
    FOREIGN KEY ("id_modelo_arte") REFERENCES "modelo_arte"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "orden_arte" ADD CONSTRAINT "orden_arte_id_proveedor_fkey"
    FOREIGN KEY ("id_proveedor") REFERENCES "proveedores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── 3. La liberación, en el encabezado de la orden ────────────────────────────
ALTER TABLE "ordenes" ADD COLUMN "receta_liberada_en" TIMESTAMP(3);
ALTER TABLE "ordenes" ADD COLUMN "receta_liberada_por_id" TEXT;

-- ── 4. El archivo histórico de `OrdenesHab` (§Post-F9.43(e) + §Post-F9.28) ────
CREATE TABLE "historico_orden_v1_hab" (
    "id" SERIAL NOT NULL,
    "id_orden" INTEGER NOT NULL,
    "avio" TEXT NOT NULL,
    "clave_v1" TEXT,
    "cantidad" DECIMAL(12,4),
    "precio" DECIMAL(12,2),
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "historico_orden_v1_hab_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "historico_orden_v1_hab_id_orden_idx" ON "historico_orden_v1_hab"("id_orden");
CREATE INDEX "historico_orden_v1_hab_avio_idx" ON "historico_orden_v1_hab"("avio");

ALTER TABLE "historico_orden_v1_hab" ADD CONSTRAINT "historico_orden_v1_hab_id_orden_fkey"
    FOREIGN KEY ("id_orden") REFERENCES "historico_orden_v1"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── 5. BACKFILL: cada orden existente recibe SU receta, copiada del BOM del modelo ──
--    Se copia para TODAS las órdenes (también las canceladas): el costeo lee la receta de la
--    orden, y dejar sin receta a una orden cancelada le pondría el costo teórico en cero.
--    `precio` queda NULL a propósito (ver la nota ⭐ del encabezado).
--    `creado_por_id`/`modificado_por_id` quedan NULL = lo hizo el sistema, no una persona (mismo
--    criterio que el ETL y que `20260726130000_recalculo_estado_ordenes`).

INSERT INTO "orden_tela" (
    "id_orden", "id_tela", "consumo_por_prenda", "precio",
    "para_pre_costo", "para_produccion", "para_costo", "id_tela_proveedor",
    "estado", "agregado_a_mano", "excluido", "modificado_en"
)
SELECT o."id", mt."id_tela", mt."consumo_por_prenda", NULL,
       mt."para_pre_costo", mt."para_produccion", mt."para_costo", mt."id_tela_proveedor",
       'sin_revisar', false, false, CURRENT_TIMESTAMP
FROM "ordenes" o
JOIN "modelo_tela" mt ON mt."id_modelo" = o."id_modelo";

INSERT INTO "orden_avio" (
    "id_orden", "id_avio", "consumo_por_prenda", "precio",
    "para_pre_costo", "para_produccion", "para_costo", "consumo_por_talla", "id_avio_proveedor",
    "estado", "agregado_a_mano", "excluido", "modificado_en"
)
SELECT o."id", ma."id_avio", ma."consumo_por_prenda", NULL,
       ma."para_pre_costo", ma."para_produccion", ma."para_costo", ma."consumo_por_talla",
       ma."id_avio_proveedor",
       'sin_revisar', false, false, CURRENT_TIMESTAMP
FROM "ordenes" o
JOIN "modelo_avio" ma ON ma."id_modelo" = o."id_modelo";

-- Las medidas por talla se cuelgan del renglón de avío recién creado, cruzando por (orden, avío).
INSERT INTO "orden_avio_talla" ("id_orden_avio", "id_talla", "consumo", "id_avio_medida", "modificado_en")
SELECT oa."id", mat."id_talla", mat."consumo", mat."id_avio_medida", CURRENT_TIMESTAMP
FROM "orden_avio" oa
JOIN "ordenes" o ON o."id" = oa."id_orden"
JOIN "modelo_avio_talla" mat
  ON mat."id_modelo" = o."id_modelo" AND mat."id_avio" = oa."id_avio";

INSERT INTO "orden_arte" (
    "id_orden", "id_modelo_arte", "nombre", "descripcion", "puntadas", "precio", "tipo",
    "id_proveedor", "estado", "agregado_a_mano", "excluido", "modificado_en"
)
SELECT o."id", ma."id", ma."nombre", ma."descripcion", ma."puntadas", ma."precio", ma."tipo",
       ma."id_proveedor", 'sin_revisar', false, false, CURRENT_TIMESTAMP
FROM "ordenes" o
JOIN "modelo_arte" ma ON ma."id_modelo" = o."id_modelo";

-- ── 6. Las órdenes vivas CON RECETA quedan LIBERADAS por la migración (ver la nota ⭐) ────
--    El `EXISTS` es lo que impide liberar una receta VACÍA: misma regla que `liberarReceta`.
UPDATE "ordenes" o
SET "receta_liberada_en" = CURRENT_TIMESTAMP
WHERE o."estado" <> 'cancelada'
  AND (
        EXISTS (SELECT 1 FROM "orden_tela" t WHERE t."id_orden" = o."id" AND NOT t."excluido")
     OR EXISTS (SELECT 1 FROM "orden_avio" a WHERE a."id_orden" = o."id" AND NOT a."excluido")
     OR EXISTS (SELECT 1 FROM "orden_arte" r WHERE r."id_orden" = o."id" AND NOT r."excluido")
  );

-- A7: el cambio no lo hizo una persona (`id_usuario` NULL), pero queda rastreado por orden.
-- En lotes lógicos no hace falta: es un solo INSERT … SELECT, sin lista sin cota en memoria.
--
-- Se registran TODAS las órdenes a las que se les copió receta — **incluidas las canceladas**, que
-- también la reciben (su costeo la lee) aunque no se les abra la puerta de compra. Antes quedaban
-- fuera del rastro pese a haber cambiado, que es justo lo que A7 no permite. Y `liberada` dice la
-- VERDAD orden por orden, en vez de afirmar que a todas se les abrió la puerta.
INSERT INTO "bitacora" ("entidad", "id_entidad", "accion", "datos", "id_usuario")
SELECT 'Orden', o."id"::text, 'MODIFICAR',
       jsonb_build_object(
         'motivo', 'receta-congelada-en-la-op',
         'migracion', '20260815140000_receta_en_la_orden',
         'liberada', o."receta_liberada_en" IS NOT NULL,
         'recetaLiberadaPor', CASE WHEN o."receta_liberada_en" IS NOT NULL THEN 'migracion' END,
         'renglonesTela', (SELECT count(*) FROM "orden_tela" ot WHERE ot."id_orden" = o."id"),
         'renglonesAvio', (SELECT count(*) FROM "orden_avio" oa WHERE oa."id_orden" = o."id"),
         'renglonesArte', (SELECT count(*) FROM "orden_arte" oar WHERE oar."id_orden" = o."id")
       ),
       NULL
FROM "ordenes" o;
