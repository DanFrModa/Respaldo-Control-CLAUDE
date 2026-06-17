-- F3-E1 · Modelo de datos de TODA F3 + motor kardex genérico (Módulos PRODUCCIÓN/WIP +
-- INVENTARIO). Diseño en docs/arquitectura/ADR-0010-motor-kardex-produccion.md y en la sección
-- "PRODUCCIÓN / WIP + MOTOR KARDEX (F3-E1)" de schema.prisma.
--
-- Migración ADITIVA: 3 enums + 8 tablas + 1 columna (tipos_proceso.genera_entrada_pt) + 1 VISTA
-- (existencia_pt). NO altera ni borra ninguna fila existente (solo agrega genera_entrada_pt con
-- DEFAULT false a tipos_proceso). El SQL de estructura es EXACTAMENTE el `prisma migrate diff`
-- entre el schema F2 y el schema F3 (ver el reporte de la etapa); abajo se anexa a mano la VISTA
-- (Prisma no gestiona vistas en este setup).
--
-- Dos planos (ADR-0010):
--  • WIP: etapa_movimiento (+det color×talla, D4) — corte/envío/recibo/entrega; pendientes
--    DERIVADOS por suma (sin acumuladores). Folio por secuencia "etapa-mov" (A3) por empresa (A9).
--  • KARDEX genérico (D3): movimientos (encabezado) + un detalle POR TIPO de artículo
--    (movimiento_det_pt / _tela / _avio — ADR-0010 §2). En F3 solo se ejercita PT; tela/avío
--    nacen VACÍAS para F4 (sin migrar filas ni tocar el núcleo de kardex.ts). id_lote escalar
--    SIN FK en F3 (la FK → Lote la agrega F4). costo_unit NULLABLE y NULL en toda F3 (D1/D2, F7).
--  • esma_cargo: cuenta de maquila (propuesto→validado), SOLO esquema (flujo en F3-E4). FK al
--    recibo NULLABLE para el histórico migrado (F3-E6).
--  • existencia_pt: VISTA normal (CREATE VIEW) = Σ movimiento_det_pt por modelo×color×talla×
--    almacén con el signo de la dirección del tipo (D3). Solo CONSULTA — las validaciones
--    transaccionales suman el detalle DIRECTO, NUNCA esta vista (ADR-0010 §3). Se materializa en
--    F3-E6 si el volumen lo exige (la regla sigue igual).

-- CreateEnum
CREATE TYPE "tipo_etapa_movimiento" AS ENUM ('corte', 'envio_maquila', 'recibo_maquila', 'entrega_cliente');

-- CreateEnum
CREATE TYPE "direccion_movimiento" AS ENUM ('entrada', 'salida', 'traspaso');

-- CreateEnum
CREATE TYPE "estado_cargo_esma" AS ENUM ('propuesto', 'validado', 'cancelado');

-- AlterTable
ALTER TABLE "tipos_proceso" ADD COLUMN     "genera_entrada_pt" BOOLEAN NOT NULL DEFAULT false;

-- Backfill (decisión (e), DECISIONES.md / ADR-0010): `tipos_proceso` NO nace en esta migración
-- (se creó en F1-E2 y F1/F2 ya sembraron `costura` en `prueba`); el ADD COLUMN deja TODAS las
-- filas existentes —incl. `costura`— en el DEFAULT false. Como el seed usa `upsert` con
-- `update:{}` (no pisa ediciones de admin), `costura` jamás pasaría a true en el upgrade. Este
-- UPDATE corrige el dato histórico: SOLO costura deja prenda terminada → su recibo mete a PT.
-- Es aditivo e idempotente (re-correrlo no cambia nada); el seed sigue preservando ediciones de
-- admin a futuro (no se pisa la bandera ahí). El resto de procesos queda en false (el default).
UPDATE "tipos_proceso" SET "genera_entrada_pt" = true WHERE "codigo" = 'costura';

-- CreateTable
CREATE TABLE "etapa_movimiento" (
    "id" SERIAL NOT NULL,
    "folio" BIGINT NOT NULL,
    "id_empresa" INTEGER NOT NULL,
    "id_orden" INTEGER NOT NULL,
    "tipo" "tipo_etapa_movimiento" NOT NULL,
    "id_tipo_proceso" INTEGER,
    "id_tercero" INTEGER,
    "fecha" DATE NOT NULL,
    "fecha_compromiso" DATE,
    "precio_pactado" DECIMAL(12,2),
    "observaciones" TEXT,
    "id_etapa_envio" INTEGER,
    "cancelado_en" TIMESTAMP(3),
    "cancelado_por_id" TEXT,
    "motivo_cancelacion" TEXT,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "etapa_movimiento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "etapa_movimiento_det" (
    "id" SERIAL NOT NULL,
    "id_etapa_mov" INTEGER NOT NULL,
    "id_color" INTEGER NOT NULL,
    "id_talla" INTEGER NOT NULL,
    "cantidad" INTEGER NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "etapa_movimiento_det_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tipos_movimiento_inventario" (
    "id" SERIAL NOT NULL,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "direccion" "direccion_movimiento" NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "tipos_movimiento_inventario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "movimientos" (
    "id" SERIAL NOT NULL,
    "folio" BIGINT NOT NULL,
    "id_empresa" INTEGER NOT NULL,
    "id_tipo_mov" INTEGER NOT NULL,
    "id_almacen" INTEGER NOT NULL,
    "fecha" DATE NOT NULL,
    "origen_tipo" TEXT,
    "origen_id" TEXT,
    "id_usuario" TEXT,
    "id_movimiento_inverso" INTEGER,
    "observaciones" TEXT,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "movimientos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "movimiento_det_pt" (
    "id" SERIAL NOT NULL,
    "id_movimiento" INTEGER NOT NULL,
    "id_modelo" INTEGER NOT NULL,
    "id_color" INTEGER NOT NULL,
    "id_talla" INTEGER NOT NULL,
    "cantidad" INTEGER NOT NULL,
    "costo_unit" DECIMAL(12,4),
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "movimiento_det_pt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "movimiento_det_tela" (
    "id" SERIAL NOT NULL,
    "id_movimiento" INTEGER NOT NULL,
    "id_tela" INTEGER NOT NULL,
    "id_lote" INTEGER,
    "cantidad" DECIMAL(14,4) NOT NULL,
    "costo_unit" DECIMAL(12,4),
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "movimiento_det_tela_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "movimiento_det_avio" (
    "id" SERIAL NOT NULL,
    "id_movimiento" INTEGER NOT NULL,
    "id_avio" INTEGER NOT NULL,
    "id_lote" INTEGER,
    "es_generico" BOOLEAN NOT NULL DEFAULT false,
    "cantidad" DECIMAL(14,4) NOT NULL,
    "costo_unit" DECIMAL(12,4),
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "movimiento_det_avio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "esma_cargo" (
    "id" SERIAL NOT NULL,
    "id_empresa" INTEGER NOT NULL,
    "id_etapa_recibo" INTEGER,
    "id_maquilero" INTEGER NOT NULL,
    "id_orden" INTEGER NOT NULL,
    "id_tipo_proceso" INTEGER NOT NULL,
    "cantidad_real" DECIMAL(14,2),
    "precio_real" DECIMAL(12,2),
    "estado" "estado_cargo_esma" NOT NULL DEFAULT 'propuesto',
    "observaciones" TEXT,
    "validado_en" TIMESTAMP(3),
    "validado_por_id" TEXT,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "esma_cargo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "etapa_movimiento_id_orden_idx" ON "etapa_movimiento"("id_orden");

-- CreateIndex
CREATE INDEX "etapa_movimiento_id_orden_tipo_id_tipo_proceso_idx" ON "etapa_movimiento"("id_orden", "tipo", "id_tipo_proceso");

-- CreateIndex
CREATE INDEX "etapa_movimiento_id_tipo_proceso_idx" ON "etapa_movimiento"("id_tipo_proceso");

-- CreateIndex
CREATE INDEX "etapa_movimiento_id_tercero_idx" ON "etapa_movimiento"("id_tercero");

-- CreateIndex
CREATE INDEX "etapa_movimiento_id_etapa_envio_idx" ON "etapa_movimiento"("id_etapa_envio");

-- CreateIndex
CREATE UNIQUE INDEX "etapa_movimiento_id_empresa_folio_key" ON "etapa_movimiento"("id_empresa", "folio");

-- CreateIndex
CREATE INDEX "etapa_movimiento_det_id_etapa_mov_idx" ON "etapa_movimiento_det"("id_etapa_mov");

-- CreateIndex
CREATE INDEX "etapa_movimiento_det_id_color_idx" ON "etapa_movimiento_det"("id_color");

-- CreateIndex
CREATE INDEX "etapa_movimiento_det_id_talla_idx" ON "etapa_movimiento_det"("id_talla");

-- CreateIndex
CREATE UNIQUE INDEX "etapa_movimiento_det_id_etapa_mov_id_color_id_talla_key" ON "etapa_movimiento_det"("id_etapa_mov", "id_color", "id_talla");

-- CreateIndex
CREATE UNIQUE INDEX "tipos_movimiento_inventario_codigo_key" ON "tipos_movimiento_inventario"("codigo");

-- CreateIndex
CREATE INDEX "movimientos_id_tipo_mov_idx" ON "movimientos"("id_tipo_mov");

-- CreateIndex
CREATE INDEX "movimientos_id_almacen_idx" ON "movimientos"("id_almacen");

-- CreateIndex
CREATE INDEX "movimientos_origen_tipo_origen_id_idx" ON "movimientos"("origen_tipo", "origen_id");

-- CreateIndex
CREATE INDEX "movimientos_id_movimiento_inverso_idx" ON "movimientos"("id_movimiento_inverso");

-- CreateIndex
CREATE UNIQUE INDEX "movimientos_id_empresa_folio_key" ON "movimientos"("id_empresa", "folio");

-- CreateIndex
CREATE INDEX "movimiento_det_pt_id_movimiento_idx" ON "movimiento_det_pt"("id_movimiento");

-- CreateIndex
CREATE INDEX "movimiento_det_pt_id_modelo_id_color_id_talla_idx" ON "movimiento_det_pt"("id_modelo", "id_color", "id_talla");

-- CreateIndex
CREATE INDEX "movimiento_det_tela_id_movimiento_idx" ON "movimiento_det_tela"("id_movimiento");

-- CreateIndex
CREATE INDEX "movimiento_det_tela_id_tela_id_lote_idx" ON "movimiento_det_tela"("id_tela", "id_lote");

-- CreateIndex
CREATE INDEX "movimiento_det_avio_id_movimiento_idx" ON "movimiento_det_avio"("id_movimiento");

-- CreateIndex
CREATE INDEX "movimiento_det_avio_id_avio_id_lote_idx" ON "movimiento_det_avio"("id_avio", "id_lote");

-- CreateIndex
CREATE INDEX "esma_cargo_id_empresa_idx" ON "esma_cargo"("id_empresa");

-- CreateIndex
CREATE INDEX "esma_cargo_id_etapa_recibo_idx" ON "esma_cargo"("id_etapa_recibo");

-- CreateIndex
CREATE INDEX "esma_cargo_id_maquilero_idx" ON "esma_cargo"("id_maquilero");

-- CreateIndex
CREATE INDEX "esma_cargo_id_orden_idx" ON "esma_cargo"("id_orden");

-- CreateIndex
CREATE INDEX "esma_cargo_id_tipo_proceso_idx" ON "esma_cargo"("id_tipo_proceso");

-- CreateIndex
CREATE INDEX "esma_cargo_estado_idx" ON "esma_cargo"("estado");

-- AddForeignKey
ALTER TABLE "etapa_movimiento" ADD CONSTRAINT "etapa_movimiento_id_empresa_fkey" FOREIGN KEY ("id_empresa") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "etapa_movimiento" ADD CONSTRAINT "etapa_movimiento_id_orden_fkey" FOREIGN KEY ("id_orden") REFERENCES "ordenes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "etapa_movimiento" ADD CONSTRAINT "etapa_movimiento_id_tipo_proceso_fkey" FOREIGN KEY ("id_tipo_proceso") REFERENCES "tipos_proceso"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "etapa_movimiento" ADD CONSTRAINT "etapa_movimiento_id_tercero_fkey" FOREIGN KEY ("id_tercero") REFERENCES "proveedores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "etapa_movimiento" ADD CONSTRAINT "etapa_movimiento_id_etapa_envio_fkey" FOREIGN KEY ("id_etapa_envio") REFERENCES "etapa_movimiento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "etapa_movimiento_det" ADD CONSTRAINT "etapa_movimiento_det_id_etapa_mov_fkey" FOREIGN KEY ("id_etapa_mov") REFERENCES "etapa_movimiento"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "etapa_movimiento_det" ADD CONSTRAINT "etapa_movimiento_det_id_color_fkey" FOREIGN KEY ("id_color") REFERENCES "colores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "etapa_movimiento_det" ADD CONSTRAINT "etapa_movimiento_det_id_talla_fkey" FOREIGN KEY ("id_talla") REFERENCES "tallas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos" ADD CONSTRAINT "movimientos_id_empresa_fkey" FOREIGN KEY ("id_empresa") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos" ADD CONSTRAINT "movimientos_id_tipo_mov_fkey" FOREIGN KEY ("id_tipo_mov") REFERENCES "tipos_movimiento_inventario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos" ADD CONSTRAINT "movimientos_id_almacen_fkey" FOREIGN KEY ("id_almacen") REFERENCES "almacenes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos" ADD CONSTRAINT "movimientos_id_movimiento_inverso_fkey" FOREIGN KEY ("id_movimiento_inverso") REFERENCES "movimientos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimiento_det_pt" ADD CONSTRAINT "movimiento_det_pt_id_movimiento_fkey" FOREIGN KEY ("id_movimiento") REFERENCES "movimientos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimiento_det_pt" ADD CONSTRAINT "movimiento_det_pt_id_modelo_fkey" FOREIGN KEY ("id_modelo") REFERENCES "modelos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimiento_det_pt" ADD CONSTRAINT "movimiento_det_pt_id_color_fkey" FOREIGN KEY ("id_color") REFERENCES "colores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimiento_det_pt" ADD CONSTRAINT "movimiento_det_pt_id_talla_fkey" FOREIGN KEY ("id_talla") REFERENCES "tallas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimiento_det_tela" ADD CONSTRAINT "movimiento_det_tela_id_movimiento_fkey" FOREIGN KEY ("id_movimiento") REFERENCES "movimientos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimiento_det_tela" ADD CONSTRAINT "movimiento_det_tela_id_tela_fkey" FOREIGN KEY ("id_tela") REFERENCES "telas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimiento_det_avio" ADD CONSTRAINT "movimiento_det_avio_id_movimiento_fkey" FOREIGN KEY ("id_movimiento") REFERENCES "movimientos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimiento_det_avio" ADD CONSTRAINT "movimiento_det_avio_id_avio_fkey" FOREIGN KEY ("id_avio") REFERENCES "avios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "esma_cargo" ADD CONSTRAINT "esma_cargo_id_empresa_fkey" FOREIGN KEY ("id_empresa") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "esma_cargo" ADD CONSTRAINT "esma_cargo_id_etapa_recibo_fkey" FOREIGN KEY ("id_etapa_recibo") REFERENCES "etapa_movimiento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "esma_cargo" ADD CONSTRAINT "esma_cargo_id_maquilero_fkey" FOREIGN KEY ("id_maquilero") REFERENCES "proveedores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "esma_cargo" ADD CONSTRAINT "esma_cargo_id_orden_fkey" FOREIGN KEY ("id_orden") REFERENCES "ordenes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "esma_cargo" ADD CONSTRAINT "esma_cargo_id_tipo_proceso_fkey" FOREIGN KEY ("id_tipo_proceso") REFERENCES "tipos_proceso"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- VISTA ExistenciaPt (D3) — ANEXO MANUAL (Prisma no gestiona vistas en este setup).
-- Existencia PT = Σ(cantidad · signo) por modelo×color×talla×almacén, donde el signo lo da la
-- dirección EFECTIVA del tipo de movimiento: entrada = +1, salida = −1.
--
-- NIT #1 (reviewer) — TRASPASO: un traspaso entre almacenes NO se registra como un solo
-- movimiento de dirección 'traspaso', sino como DOS `Movimiento` (salida del origen + entrada del
-- destino), cada uno con un tipo de dirección EFECTIVA 'salida'/'entrada' (ADR-0010 §1/§5). Así la
-- existencia TOTAL no cambia (la cantidad pasa de origen a destino) y la vista solo ve patas
-- +1/−1. El CASE usa `ELSE 0` defensivo: si alguna vez un detalle colgara de un encabezado con
-- dirección 'traspaso' (no debería: ese tipo no lleva detalle de existencia), NO inflaría el saldo.
--
-- Los movimientos CANCELADOS no se excluyen aquí: la cancelación es un movimiento INVERSO que ya
-- neutraliza al original en la suma (D3/A7) — la vista refleja el neto sin lógica extra. Es VISTA
-- NORMAL (no materializada): F3-E6 decide materializarla con los 10 años migrados. REGLA (ADR-0010
-- §3): esta vista es SOLO para consulta/tableros; las validaciones transaccionales (no entregar lo
-- que no existe) SIEMPRE suman movimiento_det_pt DIRECTO bajo bloqueo, NUNCA leen esta vista (ni su
-- versión materializada).
CREATE VIEW "existencia_pt" AS
SELECT
    d."id_modelo",
    d."id_color",
    d."id_talla",
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
GROUP BY d."id_modelo", d."id_color", d."id_talla", m."id_almacen", m."id_empresa";
