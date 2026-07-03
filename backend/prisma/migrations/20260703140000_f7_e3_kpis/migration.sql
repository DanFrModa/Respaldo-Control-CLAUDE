-- F7-E3 · Motor de KPIs en segundo plano + tableros directivos (plan §11; doc
-- `Documentacion_MJD/08-Ruta-Critica.md` §4.4, `09-Control-de-Calidad.md` §5.3, MEJORAS 03-WIP; D11).
-- Migración ADITIVA (verificada con `prisma migrate diff` / `prisma validate`):
--  • 1 tabla nueva `kpi_refresco` (ÚNICO modelo Prisma del módulo) — fila singleton con el sello de
--    la última actualización de las vistas. El API lo devuelve como "datos al: <fecha/hora>".
--  • 7 VISTAS MATERIALIZADAS (NO son modelos Prisma: se consultan por `$queryRaw` desde el dominio).
--    Cada una lleva su `id_empresa` por fila (para el filtro A9) y un CREATE UNIQUE INDEX (REQUISITO
--    de `REFRESH MATERIALIZED VIEW CONCURRENTLY`, que usa el job para no bloquear las lecturas). Se
--    crean `WITH DATA` (populadas de una vez, aunque con 0 filas en BD nueva) para que el primer
--    REFRESH CONCURRENTLY funcione. El pecado del viejo (pivotear en el cliente) se evita: TODO el
--    cálculo pesado vive aquí y se AGREGA en el servidor.
-- NO toca tablas existentes. Sin re-seed de datos; el permiso nuevo `indicadores.ver` lo siembra
-- `seed.ts` con SEED_ON_START. Las vistas las refresca el job `kpi-refrescar` (cron) y el endpoint
-- `POST /api/indicadores/refrescar` (on-demand). La CAPTURA nunca espera un recálculo (plan §11).

-- CreateTable
CREATE TABLE "kpi_refresco" (
    "id" SERIAL NOT NULL,
    "clave" TEXT NOT NULL DEFAULT 'global',
    "refrescado_en" TIMESTAMP(3) NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modificado_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kpi_refresco_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "kpi_refresco_clave_key" ON "kpi_refresco"("clave");

-- Semilla del singleton (idempotente por `clave`): el job hará upsert de `refrescado_en`.
INSERT INTO "kpi_refresco" ("clave", "refrescado_en", "modificado_en")
VALUES ('global', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("clave") DO NOTHING;

-- ═════════════════════════════════════════════════════════════════════════════
-- KPI 1 · Entregas a tiempo (D2 / F7 respuesta #7) — POR ORDEN, sobre el ÚLTIMO
-- proceso de la ruta (`ruta_orden.ultimo_proceso = TRUE`). "A tiempo" =
-- `fecha_real IS NOT NULL AND fecha_real <= fecha_planeada_vigente`. El % lo agrega
-- el dominio (aTiempo ÷ completadas). Se exponen las columnas para cortar por
-- periodo (fecha_real) / cliente / maquilero / proceso. Clave única: id_ruta_orden.
-- ═════════════════════════════════════════════════════════════════════════════
CREATE MATERIALIZED VIEW "kpi_entregas_a_tiempo" AS
SELECT
    ro."id"                                        AS "id_ruta_orden",
    o."id"                                         AS "id_orden",
    o."id_empresa"                                 AS "id_empresa",
    o."id_cliente"                                 AS "id_cliente",
    o."id_maquilero"                               AS "id_maquilero",
    ro."id_proceso_def"                            AS "id_proceso_def",
    ro."fecha_real"                                AS "fecha_real",
    ro."fecha_planeada_vigente"                    AS "fecha_planeada_vigente",
    (ro."fecha_real" IS NOT NULL)                  AS "completado",
    (
        ro."fecha_real" IS NOT NULL
        AND ro."fecha_planeada_vigente" IS NOT NULL
        AND ro."fecha_real" <= ro."fecha_planeada_vigente"
    )                                              AS "a_tiempo"
FROM "ruta_orden" ro
JOIN "ordenes" o ON o."id" = ro."id_orden"
WHERE ro."ultimo_proceso" = TRUE
WITH DATA;

CREATE UNIQUE INDEX "kpi_entregas_a_tiempo_pk" ON "kpi_entregas_a_tiempo" ("id_ruta_orden");
CREATE INDEX "kpi_entregas_a_tiempo_empresa_idx" ON "kpi_entregas_a_tiempo" ("id_empresa");

-- ═════════════════════════════════════════════════════════════════════════════
-- KPI 2 · Lead time por proceso — POR (empresa, proceso). Días REALES del proceso
-- vs su duración ESTIMADA (`duracion_dias`). Tiempo real = fecha_real − inicio_real,
-- donde inicio_real = MÁX(fecha_real de sus antecesores en la ruta viva) o, si no
-- tiene antecesor cumplido, el arranque de la RC de la orden (`fecha_inicio_rc`).
-- Acotado a >= 0 (GREATEST). Solo procesos ya cumplidos (fecha_real NOT NULL).
-- ═════════════════════════════════════════════════════════════════════════════
CREATE MATERIALIZED VIEW "kpi_lead_time_proceso" AS
WITH proc AS (
    SELECT
        o."id_empresa"      AS id_empresa,
        ro."id_proceso_def" AS id_proceso_def,
        ro."duracion_dias"  AS duracion_dias,
        ro."fecha_real"     AS fecha_real,
        COALESCE(
            (
                SELECT MAX(ant."fecha_real")
                FROM "ruta_orden_dep" dep
                JOIN "ruta_orden" ant ON ant."id" = dep."id_antecesor"
                WHERE dep."id_ruta_orden" = ro."id"
            ),
            o."fecha_inicio_rc"
        ) AS inicio_real
    FROM "ruta_orden" ro
    JOIN "ordenes" o ON o."id" = ro."id_orden"
    WHERE ro."fecha_real" IS NOT NULL
)
SELECT
    id_empresa,
    id_proceso_def,
    COUNT(*)::int AS "num_procesos",
    (AVG(GREATEST(0, (fecha_real::date - inicio_real::date)))
        FILTER (WHERE inicio_real IS NOT NULL))::float8 AS "dias_reales_prom",
    AVG(duracion_dias)::float8 AS "dias_estimado_prom"
FROM proc
GROUP BY id_empresa, id_proceso_def
WITH DATA;

CREATE UNIQUE INDEX "kpi_lead_time_proceso_pk"
    ON "kpi_lead_time_proceso" ("id_empresa", "id_proceso_def");

-- ═════════════════════════════════════════════════════════════════════════════
-- KPI 3 · Cuellos de botella — POR (empresa, proceso). Atraso medio (días) =
-- AVG(fecha_real − fecha_planeada_vigente) sobre procesos CUMPLIDOS con planeada.
-- El dominio ordena DESC (el que más atrasa primero). Puede ser negativo (adelanto).
-- ═════════════════════════════════════════════════════════════════════════════
CREATE MATERIALIZED VIEW "kpi_cuellos_botella" AS
SELECT
    o."id_empresa"      AS id_empresa,
    ro."id_proceso_def" AS id_proceso_def,
    COUNT(*)::int       AS "num_procesos",
    AVG(ro."fecha_real"::date - ro."fecha_planeada_vigente"::date)::float8 AS "atraso_medio_dias"
FROM "ruta_orden" ro
JOIN "ordenes" o ON o."id" = ro."id_orden"
WHERE ro."fecha_real" IS NOT NULL
  AND ro."fecha_planeada_vigente" IS NOT NULL
GROUP BY o."id_empresa", ro."id_proceso_def"
WITH DATA;

CREATE UNIQUE INDEX "kpi_cuellos_botella_pk"
    ON "kpi_cuellos_botella" ("id_empresa", "id_proceso_def");

-- ═════════════════════════════════════════════════════════════════════════════
-- KPI 4 · Desempeño por responsable — POR (empresa, quien CAPTURÓ el cumplimiento,
-- `ruta_orden.capturado_por_id`). nº de procesos cumplidos + cuántos a tiempo. El
-- responsable "por ROL" (ProcesoDefRol/UsuarioRol) depende de F9 (usuarios reales
-- aún NO migrados), por eso se usa `capturado_por_id`, que SÍ está poblado. El % a
-- tiempo lo agrega el dominio (a_tiempo ÷ num_procesos).
-- ═════════════════════════════════════════════════════════════════════════════
CREATE MATERIALIZED VIEW "kpi_desempeno_responsable" AS
SELECT
    o."id_empresa"        AS id_empresa,
    ro."capturado_por_id" AS capturado_por_id,
    COUNT(*)::int         AS "num_procesos",
    (COUNT(*) FILTER (
        WHERE ro."fecha_planeada_vigente" IS NOT NULL
          AND ro."fecha_real" <= ro."fecha_planeada_vigente"
    ))::int               AS "a_tiempo"
FROM "ruta_orden" ro
JOIN "ordenes" o ON o."id" = ro."id_orden"
WHERE ro."fecha_real" IS NOT NULL
  AND ro."capturado_por_id" IS NOT NULL
GROUP BY o."id_empresa", ro."capturado_por_id"
WITH DATA;

CREATE UNIQUE INDEX "kpi_desempeno_responsable_pk"
    ON "kpi_desempeno_responsable" ("id_empresa", "capturado_por_id");

-- ═════════════════════════════════════════════════════════════════════════════
-- KPI 5 · Calidad por maquilero — POR (empresa, maquilero, año, mes) desde las
-- AUDITORÍAS vivas (`cancelada = FALSE`). % aprobación = aprobadas ÷ calificadas
-- (calificadas = resultado <> 'no_calificado'). El grano mes×maquilero sirve para
-- el TOTAL por maquilero (Σ meses) Y la TENDENCIA mensual, ambos agregados en el
-- dominio. `id_maquilero` se COALESCE a 0 ("Sin maquilero") para no dejar NULL en
-- la clave única (el dominio traduce 0 → "Sin maquilero").
-- ═════════════════════════════════════════════════════════════════════════════
CREATE MATERIALIZED VIEW "kpi_calidad_maquilero" AS
SELECT
    a."id_empresa"                                AS id_empresa,
    COALESCE(a."id_maquilero", 0)                 AS id_maquilero,
    EXTRACT(YEAR FROM a."fecha_auditoria")::int   AS anio,
    EXTRACT(MONTH FROM a."fecha_auditoria")::int  AS mes,
    COUNT(*)::int                                 AS "num_auditorias",
    (COUNT(*) FILTER (WHERE a."resultado" = 'aprobado'))::int       AS "aprobadas",
    (COUNT(*) FILTER (WHERE a."resultado" <> 'no_calificado'))::int AS "calificadas"
FROM "auditorias" a
WHERE a."cancelada" = FALSE
GROUP BY
    a."id_empresa",
    COALESCE(a."id_maquilero", 0),
    EXTRACT(YEAR FROM a."fecha_auditoria"),
    EXTRACT(MONTH FROM a."fecha_auditoria")
WITH DATA;

CREATE UNIQUE INDEX "kpi_calidad_maquilero_pk"
    ON "kpi_calidad_maquilero" ("id_empresa", "id_maquilero", "anio", "mes");

-- ═════════════════════════════════════════════════════════════════════════════
-- KPI 6 · Defectos más frecuentes por maquilero — POR (empresa, maquilero, defecto)
-- desde los renglones de auditorías vivas: Σ num_fallas. El dominio ordena DESC y
-- toma el top-N, uniendo a `defectos_catalogo` para el nombre.
-- ═════════════════════════════════════════════════════════════════════════════
CREATE MATERIALIZED VIEW "kpi_defecto_maquilero" AS
SELECT
    a."id_empresa"                AS id_empresa,
    COALESCE(a."id_maquilero", 0) AS id_maquilero,
    ad."id_defecto"               AS id_defecto,
    SUM(ad."num_fallas")::int     AS "total_fallas",
    COUNT(DISTINCT a."id")::int   AS "num_auditorias"
FROM "auditoria_defecto" ad
JOIN "auditorias" a ON a."id" = ad."id_auditoria"
WHERE a."cancelada" = FALSE
GROUP BY a."id_empresa", COALESCE(a."id_maquilero", 0), ad."id_defecto"
WITH DATA;

CREATE UNIQUE INDEX "kpi_defecto_maquilero_pk"
    ON "kpi_defecto_maquilero" ("id_empresa", "id_maquilero", "id_defecto");

-- ═════════════════════════════════════════════════════════════════════════════
-- KPI 7 · WIP analítico — POR ORDEN (no cancelada). Reproduce la MISMA lógica de
-- agregación del tablero WIP de F3-E5 (`dominio/produccion/wip.ts`): suma directa
-- de `etapa_movimiento_det` de las etapas VIVAS (cancelado_en IS NULL), por tipo,
-- para que las cifras cuadren (D3/D4). `recibido_costura` = recibos de procesos
-- que meten a PT (`tipos_proceso.genera_entrada_pt`). El dominio deriva los
-- pendientes (por cortar / cortado por enviar / por recibir / por entregar) igual
-- que `pendientesDerivados`.
-- ═════════════════════════════════════════════════════════════════════════════
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

CREATE UNIQUE INDEX "kpi_wip_pk" ON "kpi_wip" ("id_orden");
CREATE INDEX "kpi_wip_empresa_idx" ON "kpi_wip" ("id_empresa");
