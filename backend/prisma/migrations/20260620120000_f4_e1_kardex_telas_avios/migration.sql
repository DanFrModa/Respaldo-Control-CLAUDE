-- F4-E1 · Kardex de TELAS y AVÍOS (lotes D5) + motor de conversión (R1) + inventario operable.
-- Diseño en docs/hoja-de-ruta/F4-etapas.md §F4-E1, docs/arquitectura/ADR-0010 (motor kardex) y la
-- sección "Catálogos de materiales / PRODUCCIÓN" de schema.prisma. Doc funcional: 04-Inventarios §B.
--
-- Migración 100% ADITIVA (NO altera ni borra ninguna fila ni columna existente): agrega 2 tablas
-- (lotes, lote_componentes), 2 columnas NULLABLE de factor de conversión (avios, avio_proveedor),
-- las FKs id_lote → lotes en los detalles de kardex de tela/avío que nacieron SIN FK en F3-E1
-- (MovimientoDetTela/Avio), y 2 VISTAS de existencia (ExistenciaTela / ExistenciaAvio).
--
-- El bloque de ESTRUCTURA (todo lo de arriba de la sección VISTAS) es EXACTAMENTE el
-- `prisma migrate diff` entre el schema previo (F3-E4) y este (F4-E1), validado SIN base de datos
-- con:  prisma migrate diff --from-schema <prev> --to-schema <actual> --script   (CLAUDE.md §8).
--
-- Qué agrega y por qué (F4-E1, decisiones del lead):
--  • lotes / lote_componentes (D5): un LOTE define el COLOR del teñido y trae 1..N telas
--    acompañantes del MISMO lote y color (elimina el límite viejo ExTela1/ExTela2). El lote es la
--    dimensión de trazabilidad del kardex de telas (existencia por tela×lote×almacén). GLOBAL (sin
--    id_empresa: el inventario por empresa lo da movimientos.id_empresa). La existencia NO vive en
--    lote_componentes (sería un saldo editable, prohibido por D3): `cantidad` es lo que ENTRÓ; el
--    saldo real es Σ de movimiento_det_tela.
--  • avios.factor_conversion / avio_proveedor.factor_conversion (R1): factor presentación→unidad de
--    consumo (cuántas unidades del BOM trae una presentación de compra). El "fino" vive por
--    PROVEEDOR (un avío se compra a varios proveedores en presentaciones distintas); el de `avios`
--    es el fallback. Lo usa el motor de conversión (comun/conversion.ts) para convertir CANTIDADES y
--    PRECIOS (E3: costo por unidad = precio por presentación ÷ factor). NULL = 1:1.
--  • movimiento_det_tela.id_lote / movimiento_det_avio.id_lote: la FK → lotes que F3-E1 dejó
--    pendiente a propósito (nacieron como escalares sin FK para no atar el motor genérico). Aquí se
--    agrega con un ALTER aditivo seguro (Restrict; las columnas ya existen y están vacías). Tela:
--    id_lote efectivamente obligatorio en la operación (lo exige el dominio); Avío: opcional (R4).
--  • Vistas ExistenciaTela (Σ por tela×lote×almacén×empresa) y ExistenciaAvio (Σ por avío×almacén×
--    empresa) con el signo de la dirección del tipo de movimiento (D3). Son VISTAS NORMALES, SOLO
--    para consulta/tableros: las validaciones transaccionales (no dejar negativo) SIEMPRE suman los
--    detalles DIRECTO bajo bloqueo, NUNCA leen estas vistas (ADR-0010 §3). NUNCA son tablas
--    editables (D3). El `CASE … ELSE 0` defensivo: un detalle colgado de un encabezado 'traspaso'
--    no infla el saldo (los traspasos se materializan como dos patas salida/entrada).
--
-- Tipos de movimiento nuevos (entrada-recepcion, salida-a-orden, salida-por-nota, ajuste-entrada/
-- salida ya existen, transferencia-salida/entrada ya existen) son DATO del seed idempotente (mismo
-- criterio que F3): NO se crean aquí. Avio.es_generico (R4) ya quedó en F1.

-- AlterTable
ALTER TABLE "avios" ADD COLUMN     "factor_conversion" DECIMAL(14,6);

-- AlterTable
ALTER TABLE "avio_proveedor" ADD COLUMN     "factor_conversion" DECIMAL(14,6);

-- CreateTable
CREATE TABLE "lotes" (
    "id" SERIAL NOT NULL,
    "clave" TEXT NOT NULL,
    "id_color" INTEGER NOT NULL,
    "id_proveedor" INTEGER,
    "factura" TEXT,
    "fecha" DATE,
    "observaciones" TEXT,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "lotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lote_componentes" (
    "id_lote" INTEGER NOT NULL,
    "id_tela" INTEGER NOT NULL,
    "cantidad" DECIMAL(14,4) NOT NULL,
    "peso" DECIMAL(14,4),
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "lote_componentes_pkey" PRIMARY KEY ("id_lote","id_tela")
);

-- CreateIndex
CREATE UNIQUE INDEX "lotes_clave_key" ON "lotes"("clave");

-- CreateIndex
CREATE INDEX "lotes_id_color_idx" ON "lotes"("id_color");

-- CreateIndex
CREATE INDEX "lotes_id_proveedor_idx" ON "lotes"("id_proveedor");

-- CreateIndex
CREATE INDEX "lote_componentes_id_tela_idx" ON "lote_componentes"("id_tela");

-- AddForeignKey
ALTER TABLE "lotes" ADD CONSTRAINT "lotes_id_color_fkey" FOREIGN KEY ("id_color") REFERENCES "colores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lotes" ADD CONSTRAINT "lotes_id_proveedor_fkey" FOREIGN KEY ("id_proveedor") REFERENCES "proveedores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lote_componentes" ADD CONSTRAINT "lote_componentes_id_lote_fkey" FOREIGN KEY ("id_lote") REFERENCES "lotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lote_componentes" ADD CONSTRAINT "lote_componentes_id_tela_fkey" FOREIGN KEY ("id_tela") REFERENCES "telas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimiento_det_tela" ADD CONSTRAINT "movimiento_det_tela_id_lote_fkey" FOREIGN KEY ("id_lote") REFERENCES "lotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimiento_det_avio" ADD CONSTRAINT "movimiento_det_avio_id_lote_fkey" FOREIGN KEY ("id_lote") REFERENCES "lotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- VISTAS DE EXISTENCIA (D3 — Prisma no gestiona vistas en este setup; se anexan a mano, igual que
-- existencia_pt en F3-E1). SOLO para CONSULTA/tableros: las validaciones transaccionales (no dejar
-- negativo) SIEMPRE suman los detalles DIRECTO bajo bloqueo, NUNCA leen estas vistas (ADR-0010 §3).
-- ─────────────────────────────────────────────────────────────────────────────────────────────────

-- Existencia de TELA por tela × lote × almacén × empresa (Σ de movimiento_det_tela con el signo de
-- la dirección del tipo). El id_lote puede ser NULL (ajuste sin lote): se agrupa como tal. Los
-- movimientos CANCELADOS no se excluyen: la cancelación es un movimiento INVERSO que ya neutraliza
-- al original en la suma (entrada+salida del par se anulan), por eso el saldo cuadra sin lógica extra.
CREATE VIEW "existencia_tela" AS
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
GROUP BY d."id_tela", d."id_lote", m."id_almacen", m."id_empresa";

-- Existencia de AVÍO por avío × almacén × empresa (Σ de movimiento_det_avio con el signo de la
-- dirección del tipo). El inventario de avíos es multi-almacén (R4); el lote del avío es opcional y
-- NO se agrupa por él (la existencia operativa de avíos es por avío×almacén). Igual que telas: los
-- cancelados NO se excluyen (el inverso ya neutraliza al original en la suma, por eso el saldo cuadra).
CREATE VIEW "existencia_avio" AS
SELECT
    d."id_avio",
    m."id_almacen",
    m."id_empresa",
    SUM(
        d."cantidad" * CASE t."direccion"
            WHEN 'entrada' THEN 1
            WHEN 'salida'  THEN -1
            ELSE 0
        END
    ) AS "existencia"
FROM "movimiento_det_avio" d
JOIN "movimientos" m ON m."id" = d."id_movimiento"
JOIN "tipos_movimiento_inventario" t ON t."id" = m."id_tipo_mov"
GROUP BY d."id_avio", m."id_almacen", m."id_empresa";
