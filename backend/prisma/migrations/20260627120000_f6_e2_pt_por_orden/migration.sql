-- F6-E2 (parte 2): PRODUCTO TERMINADO ligado a la ORDEN de producción (decisión de Daniel; ver
-- ADR-0014, enmienda de ADR-0010). RESTAURA el `IPT_Modelos.IdOrdenes` de v1 (doc 04-Inventarios)
-- que se perdió al aplanar el ETL por `NumMod`: la existencia de PT pasa de modelo×color×talla×
-- almacén a modelo×color×talla×ORDEN×almacén.
--
-- Cambios (todos ADITIVOS y seguros; no borra ni reescribe filas de detalle):
--  1. Columna `id_orden` NULLABLE en `movimiento_det_pt` + FK → `ordenes` (RESTRICT) + 2 índices
--     (el simple y el compuesto para la existencia por orden). El SQL de estructura es EXACTAMENTE
--     el de `prisma migrate diff --from-empty --to-schema` para esta tabla.
--  2. BACKFILL de los movimientos YA en `prueba` cuya orden es DERIVABLE: recibo de maquila y
--     entrega a cliente (su `origen_id` apunta a una `etapa_movimiento`, que sí tiene `id_orden`),
--     y las CANCELACIONES de esos (su `origen_id` apunta al movimiento original, de donde se copia
--     el `id_orden` por artículo). Manual / traspaso / migración quedan NULL (bucket "sin orden").
--  3. La VISTA `existencia_pt` se reconstruye agregando `id_orden` al SELECT y al GROUP BY (el
--     bucket `id_orden IS NULL` agrupa el histórico/manual). Prisma no gestiona vistas en este
--     setup: se hace a mano (igual que en F3-E1). DROP + CREATE para poder reordenar columnas.

-- ── 1. Estructura (idéntico a `prisma migrate diff`) ─────────────────────────────────────────────
ALTER TABLE "movimiento_det_pt" ADD COLUMN "id_orden" INTEGER;

CREATE INDEX "movimiento_det_pt_id_orden_idx" ON "movimiento_det_pt"("id_orden");

CREATE INDEX "movimiento_det_pt_id_orden_id_modelo_id_color_id_talla_idx" ON "movimiento_det_pt"("id_orden", "id_modelo", "id_color", "id_talla");

ALTER TABLE "movimiento_det_pt" ADD CONSTRAINT "movimiento_det_pt_id_orden_fkey" FOREIGN KEY ("id_orden") REFERENCES "ordenes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── 2. Backfill (datos ya sembrados en `prueba`) ─────────────────────────────────────────────────
-- (a) Recibo de maquila / entrega a cliente: `origen_id` = id de la `etapa_movimiento`, que tiene
--     la orden. Cubre toda la entrada/salida de PT con orden conocida.
UPDATE "movimiento_det_pt" AS d
SET "id_orden" = em."id_orden"
FROM "movimientos" AS m
JOIN "etapa_movimiento" AS em ON em."id"::text = m."origen_id"
WHERE d."id_movimiento" = m."id"
  AND m."origen_tipo" IN ('recibo-maquila', 'entrega-cliente')
  AND m."origen_id" IS NOT NULL
  AND d."id_orden" IS NULL;

-- (b) Cancelaciones de los anteriores: el inverso (`origen_tipo='cancelacion'`) apunta por
--     `origen_id` al movimiento ORIGINAL; se copia el `id_orden` del renglón homólogo (mismo
--     modelo×color×talla) ya backfilleado en (a). Debe correr DESPUÉS de (a). Así el inverso
--     neutraliza el MISMO bucket de orden que el original (no descuadra la existencia por orden).
-- NOTA (Postgres): en `UPDATE ... AS inv FROM ...`, la tabla objetivo `inv` NO puede
-- referenciarse en las condiciones `JOIN ON` del FROM (solo en el WHERE de nivel superior).
-- Por eso las correlaciones orig↔inv (mismo modelo×color×talla) van en el WHERE, no en el JOIN.
UPDATE "movimiento_det_pt" AS inv
SET "id_orden" = orig."id_orden"
FROM "movimientos" AS m_inv
JOIN "movimientos" AS m_orig ON m_orig."id"::text = m_inv."origen_id"
JOIN "movimiento_det_pt" AS orig ON orig."id_movimiento" = m_orig."id"
WHERE inv."id_movimiento" = m_inv."id"
  AND orig."id_modelo" = inv."id_modelo"
  AND orig."id_color" = inv."id_color"
  AND orig."id_talla" = inv."id_talla"
  AND m_inv."origen_tipo" = 'cancelacion'
  AND inv."id_orden" IS NULL
  AND orig."id_orden" IS NOT NULL;

-- ── 3. Vista de existencia con la dimensión ORDEN ────────────────────────────────────────────────
-- SOLO para CONSULTA/tableros (ADR-0010 §3): las validaciones transaccionales (no dejar negativo)
-- SIEMPRE suman `movimiento_det_pt` DIRECTO bajo bloqueo, NUNCA esta vista. El bucket `id_orden`
-- NULL agrupa el PT histórico/manual (sin orden).
DROP VIEW IF EXISTS "existencia_pt";
CREATE VIEW "existencia_pt" AS
SELECT
    d."id_modelo",
    d."id_color",
    d."id_talla",
    d."id_orden",
    m."id_almacen",
    m."id_empresa",
    SUM(
        d."cantidad" * CASE t."direccion"
            WHEN 'entrada' THEN 1
            WHEN 'salida'  THEN -1
            ELSE 0
        END
    )::bigint AS "existencia"
FROM "movimiento_det_pt" d
JOIN "movimientos" m ON m."id" = d."id_movimiento"
JOIN "tipos_movimiento_inventario" t ON t."id" = m."id_tipo_mov"
GROUP BY d."id_modelo", d."id_color", d."id_talla", d."id_orden", m."id_almacen", m."id_empresa";
