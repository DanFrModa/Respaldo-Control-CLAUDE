-- ⭐ CERRAR LA ORDEN CON EL MAQUILERO — la CUARTA CUBETA por fin tiene columna (V1, fila 0.109;
-- DANIEL 3-sep-2026).
--
-- EL PROBLEMA QUE CIERRA. §Post-F9.147 dejó escrita la invariante de las cuatro cubetas
--
--     enviado = primeras + segundas + faltantes + incompletas
--
-- y la prosa de `dominio/produccion/incompletas.ts` decía que el faltante *«se le cobra»* al
-- maquilero. Pero el FALTANTE no era un dato: era el RESIDUO de la resta, o sea
-- `pendiente = enviado − buenas − incompletas`. Faltante ≡ pendiente, el MISMO número. De ahí que
-- cobrarlo no bajara nada y la lista de pendientes creciera para siempre. Y `esma/cargos.ts` no
-- mencionaba la palabra «faltante» ni una vez: la regla vivía en la prosa y no en el código.
--
-- LO QUE ESTA MIGRACIÓN AGREGA (todo ADITIVO — ninguna columna existente cambia de tipo ni se pierde):
--   1. `cierre_maquila_orden` — EL ACTO: cerrar una orden con UN maquilero de UN proceso, con su
--      desenlace (cobrado/perdonado), su precio congelado, su motivo y su DESHACER (D3: el acto
--      inverso auditado, nunca una edición ni un borrado).
--   2. `cierre_maquila_orden_det` — LA CUBETA: `cantidad_faltantes` por color×talla×pack. En tabla
--      APARTE de `etapa_movimiento_det` a propósito: todo lo que produce, inventaría o cobra suma
--      `etapa_movimiento_det.cantidad`, así que un faltante alojado ahí acabaría multiplicado por un
--      precio y empujado al almacén. Aquí queda fuera de los tres POR CONSTRUCCIÓN.
--   3. `descuento_maquilero` — cuatro columnas: la liga al cierre que lo propuso y la CANCELACIÓN
--      SUAVE que el deshacer necesita.
--
-- 🔑 POR QUÉ UN **DESCUENTO** Y NO UN CARGO, que es lo que uno esperaría de una cola de validación:
-- el signo. `esma/formula-saldo.ts` fija `saldo = Σcargos + Σabonos − Σpagos − Σdescuentos`, o sea
-- que el CARGO SUBE lo que se le debe al maquilero. Cobrarle el faltante lo BAJA. Y es la palabra
-- que usó Daniel (§Post-F9.147): *«ese faltante si se le queda y se le quita a mando (normalmente
-- **descontandole** esas prendas faltantes)»*. Un cargo habría pagado al maquilero por las prendas
-- que no devolvió, además de dejárselas.
--
-- 🔴 SE RECREA `kpi_wip` (DROP + CREATE) por la MISMA razón que en
-- `20260830120000_la_incompleta_sale_del_transito`: es la única estructura del repo que lleva la
-- fórmula del pendiente CONGELADA en SQL, Postgres no deja AGREGAR una columna a una vista
-- materializada, y `kpisWip` (`dominio/indicadores/kpis.ts`) deriva de ella `porRecibir` y el filtro
-- `soloPendientes`. Sin esto, el tablero de Indicadores seguiría contando como «por recibir» las
-- prendas que un cierre ya saldó, y contradiría al tablero WIP de Producción sobre la misma orden.
-- El DROP se lleva sus índices: se vuelven a crear IDÉNTICOS — el UNIQUE sobre `id_orden` NO es
-- cosmético, `REFRESH MATERIALIZED VIEW CONCURRENTLY` (el del job `refrescar-kpis.ts`) lo EXIGE.
-- Queda `WITH DATA`, igual que la original, para que el tablero no aparezca vacío entre el deploy y
-- el primer refresco del cron.
--
-- SIN permisos, roles ni catálogos nuevos (el cierre reusa `produccion.recibo`, el deshacer
-- `produccion.cancelar`) ⇒ **NO requiere `SEED_ON_START`**.

-- ── 1. El desenlace del cierre ───────────────────────────────────────────────────────────────────
CREATE TYPE "desenlace_cierre_maquila" AS ENUM ('cobrado', 'perdonado');

-- ── 2. El ACTO de cerrar ─────────────────────────────────────────────────────────────────────────
CREATE TABLE "cierre_maquila_orden" (
    "id" SERIAL NOT NULL,
    "id_empresa" INTEGER NOT NULL,
    "id_orden" INTEGER NOT NULL,
    "id_maquilero" INTEGER NOT NULL,
    "id_tipo_proceso" INTEGER NOT NULL,
    "fecha" DATE NOT NULL,
    "desenlace" "desenlace_cierre_maquila" NOT NULL,
    "precio_faltante" DECIMAL(12,2),
    "motivo" TEXT,
    "deshecho_en" TIMESTAMP(3),
    "deshecho_por_id" TEXT,
    "motivo_deshacer" TEXT,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "cierre_maquila_orden_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "cierre_maquila_orden_id_empresa_idx" ON "cierre_maquila_orden"("id_empresa");
CREATE INDEX "cierre_maquila_orden_id_orden_idx" ON "cierre_maquila_orden"("id_orden");
CREATE INDEX "cierre_maquila_orden_id_maquilero_idx" ON "cierre_maquila_orden"("id_maquilero");
CREATE INDEX "cierre_maquila_orden_id_tipo_proceso_idx" ON "cierre_maquila_orden"("id_tipo_proceso");
CREATE INDEX "cierre_maquila_orden_deshecho_en_idx" ON "cierre_maquila_orden"("deshecho_en");

ALTER TABLE "cierre_maquila_orden" ADD CONSTRAINT "cierre_maquila_orden_id_empresa_fkey" FOREIGN KEY ("id_empresa") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cierre_maquila_orden" ADD CONSTRAINT "cierre_maquila_orden_id_orden_fkey" FOREIGN KEY ("id_orden") REFERENCES "ordenes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cierre_maquila_orden" ADD CONSTRAINT "cierre_maquila_orden_id_maquilero_fkey" FOREIGN KEY ("id_maquilero") REFERENCES "proveedores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cierre_maquila_orden" ADD CONSTRAINT "cierre_maquila_orden_id_tipo_proceso_fkey" FOREIGN KEY ("id_tipo_proceso") REFERENCES "tipos_proceso"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── 3. La CUBETA: las piezas faltantes que ese cierre saldó ──────────────────────────────────────
CREATE TABLE "cierre_maquila_orden_det" (
    "id" SERIAL NOT NULL,
    "id_cierre" INTEGER NOT NULL,
    "id_color" INTEGER NOT NULL,
    "id_talla" INTEGER NOT NULL,
    "pack" TEXT NOT NULL DEFAULT '',
    "cantidad_faltantes" INTEGER NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,

    CONSTRAINT "cierre_maquila_orden_det_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "cierre_maquila_orden_det_id_cierre_id_color_id_talla_pack_key" ON "cierre_maquila_orden_det"("id_cierre", "id_color", "id_talla", "pack");
CREATE INDEX "cierre_maquila_orden_det_id_cierre_idx" ON "cierre_maquila_orden_det"("id_cierre");
CREATE INDEX "cierre_maquila_orden_det_id_color_idx" ON "cierre_maquila_orden_det"("id_color");
CREATE INDEX "cierre_maquila_orden_det_id_talla_idx" ON "cierre_maquila_orden_det"("id_talla");

ALTER TABLE "cierre_maquila_orden_det" ADD CONSTRAINT "cierre_maquila_orden_det_id_cierre_fkey" FOREIGN KEY ("id_cierre") REFERENCES "cierre_maquila_orden"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cierre_maquila_orden_det" ADD CONSTRAINT "cierre_maquila_orden_det_id_color_fkey" FOREIGN KEY ("id_color") REFERENCES "colores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cierre_maquila_orden_det" ADD CONSTRAINT "cierre_maquila_orden_det_id_talla_fkey" FOREIGN KEY ("id_talla") REFERENCES "tallas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── 4. El DESCUENTO propuesto: su origen y su cancelación suave ──────────────────────────────────
ALTER TABLE "descuento_maquilero" ADD COLUMN "id_cierre_maquila" INTEGER;
ALTER TABLE "descuento_maquilero" ADD COLUMN "cancelado_en" TIMESTAMP(3);
ALTER TABLE "descuento_maquilero" ADD COLUMN "cancelado_por_id" TEXT;
ALTER TABLE "descuento_maquilero" ADD COLUMN "motivo_cancelacion" TEXT;

CREATE UNIQUE INDEX "descuento_maquilero_id_cierre_maquila_key" ON "descuento_maquilero"("id_cierre_maquila");
CREATE INDEX "descuento_maquilero_cancelado_en_idx" ON "descuento_maquilero"("cancelado_en");

ALTER TABLE "descuento_maquilero" ADD CONSTRAINT "descuento_maquilero_id_cierre_maquila_fkey" FOREIGN KEY ("id_cierre_maquila") REFERENCES "cierre_maquila_orden"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── 5. `kpi_wip` aprende la tercera cubeta ───────────────────────────────────────────────────────
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
    -- ⭐⭐ V1 fila 0.109 · el FALTANTE SALDADO al cerrar la orden con el maquilero. Tercera columna
    -- de la trazabilidad, y por la misma razón que la anterior: no se produjo, no entró a inventario
    -- y NO se paga (al contrario: se le descuenta). Lo único que hace es cerrar el pendiente, que
    -- desde aquí es `enviado - recibido - incompletas - faltantes_saldados`. Solo cierres VIVOS
    -- (`deshecho_en IS NULL`): deshacer el cierre devuelve las piezas al pendiente.
    COALESCE((
        SELECT SUM(cd."cantidad_faltantes") FROM "cierre_maquila_orden_det" cd
        JOIN "cierre_maquila_orden" c ON c."id" = cd."id_cierre"
        WHERE c."id_orden" = o."id" AND c."deshecho_en" IS NULL
    ), 0)::int AS "faltantes_saldados",
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
