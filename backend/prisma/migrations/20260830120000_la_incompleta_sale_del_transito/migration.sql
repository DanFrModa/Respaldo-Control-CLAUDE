-- V1-E8v · LA INCOMPLETA SALE DEL TRÁNSITO (§Post-F9.147, DANIEL 29-ago-2026: *"Al registrarlas
-- como incompletas entregadas, dejan de estar en la maquila. El ya termino de entregar las 100…
-- Pro las incompletas, ya no quedan como pendientes de entregar"*).
--
-- La prenda incompleta ya volvió del taller, así que CIERRA el pendiente por recibir, aunque siga
-- sin producirse, sin inventariarse y sin pagarse. Eso corrige la decisión A de §Post-F9.136, que
-- dejaba el pendiente abierto "para cobrar el faltante" — razonamiento que confundía la INCOMPLETA
-- (volvió) con el FALTANTE (nunca volvió). La invariante que manda es:
--
--     enviado = primeras + segundas + faltantes + incompletas
--
-- QUÉ TOCA ESTA MIGRACIÓN, Y POR QUÉ NO PODÍA EVITARSE. Nada de tablas: la única estructura del
-- repo que lleva la fórmula del pendiente CONGELADA en SQL es la vista materializada `kpi_wip`
-- (F7-E3, `20260703140000_f7_e3_kpis`). El dominio y el Resumen operativo calculan en vivo y ya
-- restan las incompletas por código; la vista, no — y `kpisWip` (`dominio/indicadores/kpis.ts`)
-- deriva `porRecibir` y el filtro `soloPendientes` LEYENDO de ella. Sin este cambio, el tablero de
-- Indicadores seguiría diciendo que faltan por recibir prendas que ya volvieron, y contradiría al
-- tablero WIP de Producción sobre la misma orden.
--
-- 🔴 SE RECREA LA VISTA COMPLETA (DROP + CREATE) porque Postgres no permite AGREGAR una columna a
-- una vista materializada. El DROP se lleva sus índices, así que se vuelven a crear IDÉNTICOS: el
-- UNIQUE sobre `id_orden` NO es cosmético — `REFRESH MATERIALIZED VIEW CONCURRENTLY` (el que usa el
-- job `refrescar-kpis.ts`) lo EXIGE, y sin él el refresco caería siempre al fallback bloqueante.
--
-- ⚠️ La vista queda `WITH DATA`, igual que la original: se puebla en la propia migración, así que
-- el tablero de Indicadores no queda vacío entre el deploy y el primer refresco del cron (cada
-- 20 min por default).
--
-- ⚠️ `cantidad_incompletas` es NULLABLE (nunca hubo backfill: el Access no tenía el concepto). El
-- `COALESCE` INTERNO de la suma es DEFENSIVO, no necesario: **`SUM()` ignora los NULL, no los
-- propaga** —medido en Postgres 16 sobre `(8, NULL, NULL, 2)`: `SUM(c)` y `SUM(COALESCE(c,0))`
-- devuelven **10** los dos—. Se conserva porque hace la intención explícita a quien lee el SQL, y
-- porque el día que
-- alguien cambie la agregación (un `+` entre columnas, por ejemplo) el NULL sí propagaría. **Lo que
-- SÍ hace falta es el COALESCE EXTERNO**: sin filas, `SUM()` devuelve NULL y la columna quedaría
-- nula en vez de 0. (Redacción corregida en la ronda de revisión: la versión anterior afirmaba que
-- `SUM()` propagaba los NULL, que es falso — y una prosa así, congelada en una migración, no la
-- puede matar ninguna mutación.)
--
-- SIN permisos, roles ni catálogos nuevos ⇒ **NO requiere `SEED_ON_START`**.

DROP MATERIALIZED VIEW "kpi_wip";

CREATE MATERIALIZED VIEW "kpi_wip" AS
SELECT
    o."id"         AS id_orden,
    o."id_empresa" AS id_empresa,
    o."id_cliente" AS id_cliente,
    o."id_modelo"  AS id_modelo,
    o."folio"      AS folio,
    COALESCE((
        SELECT SUM(olt."cantidad")
        FROM "orden_linea_talla" olt
        JOIN "orden_linea" ol ON ol."id" = olt."id_orden_linea"
        WHERE ol."id_orden" = o."id"
    ), 0)::int AS "pedido",
    COALESCE((
        SELECT SUM(d."cantidad") FROM "etapa_movimiento_det" d
        JOIN "etapa_movimiento" e ON e."id" = d."id_etapa_mov"
        WHERE e."id_orden" = o."id" AND e."tipo" = 'corte' AND e."cancelado_en" IS NULL
    ), 0)::int AS "cortado",
    COALESCE((
        SELECT SUM(d."cantidad") FROM "etapa_movimiento_det" d
        JOIN "etapa_movimiento" e ON e."id" = d."id_etapa_mov"
        WHERE e."id_orden" = o."id" AND e."tipo" = 'envio_maquila' AND e."cancelado_en" IS NULL
    ), 0)::int AS "enviado",
    COALESCE((
        SELECT SUM(d."cantidad") FROM "etapa_movimiento_det" d
        JOIN "etapa_movimiento" e ON e."id" = d."id_etapa_mov"
        WHERE e."id_orden" = o."id" AND e."tipo" = 'recibo_maquila' AND e."cancelado_en" IS NULL
    ), 0)::int AS "recibido",
    -- ⭐ V1-E8v · la CUARTA CUBETA. Va en su propia columna, NUNCA sumada a `recibido`: las
    -- incompletas no se produjeron, no entraron a inventario y no se pagan (§Post-F9.136). Lo único
    -- que hacen es cerrar el pendiente (`enviado - recibido - incompletas`), que se deriva al leer.
    COALESCE((
        SELECT SUM(COALESCE(d."cantidad_incompletas", 0)) FROM "etapa_movimiento_det" d
        JOIN "etapa_movimiento" e ON e."id" = d."id_etapa_mov"
        WHERE e."id_orden" = o."id" AND e."tipo" = 'recibo_maquila' AND e."cancelado_en" IS NULL
    ), 0)::int AS "incompletas",
    COALESCE((
        SELECT SUM(d."cantidad") FROM "etapa_movimiento_det" d
        JOIN "etapa_movimiento" e ON e."id" = d."id_etapa_mov"
        JOIN "tipos_proceso" tp ON tp."id" = e."id_tipo_proceso"
        WHERE e."id_orden" = o."id" AND e."tipo" = 'recibo_maquila'
          AND e."cancelado_en" IS NULL AND tp."genera_entrada_pt" = TRUE
    ), 0)::int AS "recibido_costura",
    COALESCE((
        SELECT SUM(d."cantidad") FROM "etapa_movimiento_det" d
        JOIN "etapa_movimiento" e ON e."id" = d."id_etapa_mov"
        WHERE e."id_orden" = o."id" AND e."tipo" = 'entrega_cliente' AND e."cancelado_en" IS NULL
    ), 0)::int AS "entregado"
FROM "ordenes" o
WHERE o."estado" <> 'cancelada'
WITH DATA;

-- Mismos índices que traía la vista original (el UNIQUE lo exige REFRESH … CONCURRENTLY).
CREATE UNIQUE INDEX "kpi_wip_pk" ON "kpi_wip" ("id_orden");
CREATE INDEX "kpi_wip_empresa_idx" ON "kpi_wip" ("id_empresa");
