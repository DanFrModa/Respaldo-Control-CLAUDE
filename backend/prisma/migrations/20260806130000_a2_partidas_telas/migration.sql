-- A2 · Inventario de telas NUEVO: PARTIDAS + existencia por COLOR + kardex (Daniel §Post-F9.9
-- opción B y §Post-F9.11 puntos 2/4/5; deuda "Lote.idColor vs TelaColor" de HOJA-DE-RUTA §4).
--
-- Migración 100% ADITIVA (NO altera ni borra ninguna fila ni columna existente):
--  • Tabla `partidas_tela`: la UNIDAD DE ENTRADA del inventario nuevo. Folio propio consecutivo
--    POR EMPRESA (A3 — secuencia `partida-tela`, jamás Max()+1) + número de lote del PROVEEDOR
--    (texto opcional, buscable). La partida cuelga de `telas_colores` (el color-hijo de la tela),
--    NO del catálogo de color de prenda: eso resuelve la dualidad vieja `lotes.id_color`.
--  • 3 columnas NULLABLE en `movimiento_det_tela`: `id_tela_color` (dimensión nueva de
--    existencia: tela×color×almacén), `id_partida` (traza de la ENTRADA; en salidas va NULL — el
--    consumo empareja por TELA+COLOR, no por partida) y `cantidad_complemento` (el complemento/
--    cardigan viaja JUNTO en el mismo renglón; `cantidad` = cuerpo y admite 0 para entradas de
--    solo complemento). Las filas viejas (flujo por Lote) quedan con las 3 en NULL y su vista
--    `existencia_tela` se REDEFINE con el filtro de cuarentena (legado consultable, sin mezclar).
--  • Vista `existencia_tela_color`: Σ por tela × color × almacén × empresa de AMBOS componentes
--    (cuerpo y complemento) con el signo de la dirección — SOLO filas con `id_tela_color`.
--
-- El bloque de ESTRUCTURA (arriba de la sección VISTA) es EXACTAMENTE el `prisma migrate diff`
-- entre el schema previo y este, validado SIN base de datos con:
--   prisma migrate diff --from-schema <prev> --to-schema prisma/schema.prisma --script
--
-- La vista es SOLO CONSULTA (D3 / ADR-0010 §3): toda validación de no-negativo se hace por suma
-- directa de `movimiento_det_tela` bajo advisory lock, NUNCA leyendo la vista. Los movimientos
-- CANCELADOS no se excluyen: la cancelación es un movimiento INVERSO que ya neutraliza al
-- original en la suma. SIN permisos nuevos ni seed (reusa `inventario-telas.ver`/`.mover`).

-- AlterTable
ALTER TABLE "movimiento_det_tela" ADD COLUMN     "cantidad_complemento" DECIMAL(14,4),
ADD COLUMN     "id_partida" INTEGER,
ADD COLUMN     "id_tela_color" INTEGER;

-- CreateTable
CREATE TABLE "partidas_tela" (
    "id" SERIAL NOT NULL,
    "folio" BIGINT NOT NULL,
    "id_empresa" INTEGER NOT NULL,
    "id_tela_color" INTEGER NOT NULL,
    "lote_proveedor" TEXT,
    "factura" TEXT,
    "fecha" DATE,
    "observaciones" TEXT,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "partidas_tela_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "partidas_tela_id_tela_color_idx" ON "partidas_tela"("id_tela_color");

-- CreateIndex
CREATE INDEX "partidas_tela_lote_proveedor_idx" ON "partidas_tela"("lote_proveedor");

-- CreateIndex
CREATE UNIQUE INDEX "partidas_tela_id_empresa_folio_key" ON "partidas_tela"("id_empresa", "folio");

-- CreateIndex
CREATE INDEX "movimiento_det_tela_id_tela_color_idx" ON "movimiento_det_tela"("id_tela_color");

-- CreateIndex
CREATE INDEX "movimiento_det_tela_id_partida_idx" ON "movimiento_det_tela"("id_partida");

-- AddForeignKey
ALTER TABLE "partidas_tela" ADD CONSTRAINT "partidas_tela_id_empresa_fkey" FOREIGN KEY ("id_empresa") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partidas_tela" ADD CONSTRAINT "partidas_tela_id_tela_color_fkey" FOREIGN KEY ("id_tela_color") REFERENCES "telas_colores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimiento_det_tela" ADD CONSTRAINT "movimiento_det_tela_id_tela_color_fkey" FOREIGN KEY ("id_tela_color") REFERENCES "telas_colores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimiento_det_tela" ADD CONSTRAINT "movimiento_det_tela_id_partida_fkey" FOREIGN KEY ("id_partida") REFERENCES "partidas_tela"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- VISTA DE EXISTENCIA POR COLOR (D3 — se anexa a mano, igual que existencia_tela en F4-E1).
-- SOLO para CONSULTA/tableros: las validaciones transaccionales (no dejar negativo, de AMBOS
-- componentes) SIEMPRE suman `movimiento_det_tela` DIRECTO bajo bloqueo, NUNCA leen esta vista
-- (ADR-0010 §3). NUNCA es una tabla editable (D3). La vista vieja `existencia_tela` se redefine abajo.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────

-- La vista LEGADA `existencia_tela` se REDEFINE (CREATE OR REPLACE, misma lista de columnas —
-- reemplazo válido) para EXCLUIR las filas del flujo nuevo (`id_tela_color IS NOT NULL`): sin este
-- filtro, un movimiento por color (id_lote NULL) aparecía en la vista vieja como fila fantasma
-- "(sin lote)" con solo el cuerpo — contaminaba la consulta legada (hallazgo del reviewer A2 #1).
-- La definición es la de `20260620120000_f4_e1_kardex_telas_avios/migration.sql` + el WHERE.
CREATE OR REPLACE VIEW "existencia_tela" AS
SELECT
    d."id_tela",
    d."id_lote",
    m."id_almacen",
    m."id_empresa",
    SUM(
        d."cantidad" * CASE t."direccion"
            WHEN 'entrada' THEN 1
            WHEN 'salida'  THEN -1
            ELSE 0
        END
    ) AS "existencia"
FROM "movimiento_det_tela" d
JOIN "movimientos" m ON m."id" = d."id_movimiento"
JOIN "tipos_movimiento_inventario" t ON t."id" = m."id_tipo_mov"
WHERE d."id_tela_color" IS NULL
GROUP BY d."id_tela", d."id_lote", m."id_almacen", m."id_empresa";

-- Existencia de TELA por tela × COLOR × almacén × empresa (Σ de movimiento_det_tela con el signo
-- de la dirección del tipo), de AMBOS componentes: cuerpo (`cantidad`) y complemento
-- (`cantidad_complemento`, NULL→0). SOLO filas del flujo NUEVO (`id_tela_color IS NOT NULL`); el
-- flujo viejo por Lote sigue en `existencia_tela` (ya filtrada arriba). El `CASE … ELSE 0`
-- defensivo: un detalle colgado de un encabezado 'traspaso' no infla el saldo (los traspasos son
-- dos patas).
CREATE VIEW "existencia_tela_color" AS
SELECT
    d."id_tela",
    d."id_tela_color",
    m."id_almacen",
    m."id_empresa",
    SUM(
        d."cantidad" * CASE t."direccion"
            WHEN 'entrada' THEN 1
            WHEN 'salida'  THEN -1
            ELSE 0
        END
    ) AS "existencia_cuerpo",
    SUM(
        COALESCE(d."cantidad_complemento", 0) * CASE t."direccion"
            WHEN 'entrada' THEN 1
            WHEN 'salida'  THEN -1
            ELSE 0
        END
    ) AS "existencia_complemento"
FROM "movimiento_det_tela" d
JOIN "movimientos" m ON m."id" = d."id_movimiento"
JOIN "tipos_movimiento_inventario" t ON t."id" = m."id_tipo_mov"
WHERE d."id_tela_color" IS NOT NULL
GROUP BY d."id_tela", d."id_tela_color", m."id_almacen", m."id_empresa";
