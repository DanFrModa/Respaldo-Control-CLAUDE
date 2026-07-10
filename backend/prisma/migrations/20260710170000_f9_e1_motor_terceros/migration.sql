-- F9-E1 · Motor de cuenta corriente ÚNICA de terceros (Módulo 14; D12/D15/R10; doc
-- `Documentacion_MJD/PROPUESTA-Finanzas-y-Proveedores.md` §3). Generaliza el motor EsMa (F6):
-- UN SOLO libro de movimientos por tercero del que cuelgan CxC (clientes), CxP (proveedores) y
-- —por lectura/convivencia— el propio EsMa. `saldo(tercero) = Σ monto` (nunca editable — D3).
--
-- Migración ADITIVA: crea 2 enums + 1 tabla + sus índices/FKs. NO altera ni borra ninguna fila
-- existente. Modelo del tercero (D15a, ADR-0017): el movimiento REFERENCIA a Cliente o Proveedor
-- existentes por tipo+id (dos FKs reales nullable + CHECK de exclusividad), SIN tabla `Tercero`
-- polimórfica. El SQL equivale al `prisma migrate diff` entre el schema F8 y el F9-E1 (redactado a
-- mano — sin Docker local, regla §7 de CLAUDE.md); validado con `prisma validate` + `prisma generate`.

-- CreateEnum
CREATE TYPE "tipo_tercero" AS ENUM ('cliente', 'proveedor');

-- CreateEnum
CREATE TYPE "origen_movimiento_tercero" AS ENUM ('recibo_maquila', 'factura_proveedor', 'entrada_sin_factura', 'nota_credito', 'pago', 'abono', 'descuento');

-- CreateTable
CREATE TABLE "movimientos_tercero" (
    "id" SERIAL NOT NULL,
    "id_empresa" INTEGER NOT NULL,
    "folio" BIGINT NOT NULL,
    "tipo_tercero" "tipo_tercero" NOT NULL,
    "id_cliente" INTEGER,
    "id_proveedor" INTEGER,
    "fecha" DATE NOT NULL,
    "origen" "origen_movimiento_tercero" NOT NULL,
    "monto" DECIMAL(14,2) NOT NULL,
    "fecha_vencimiento" DATE,
    "es_fiscal" BOOLEAN NOT NULL DEFAULT false,
    "uuid_cfdi" TEXT,
    "rfc_tercero" TEXT,
    "id_archivo_cfdi" TEXT,
    "ref_tipo" TEXT,
    "ref_id" INTEGER,
    "observaciones" TEXT,
    "cancelado" BOOLEAN NOT NULL DEFAULT false,
    "id_movimiento_inverso" INTEGER,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "movimientos_tercero_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "movimientos_tercero_uuid_cfdi_key" ON "movimientos_tercero"("uuid_cfdi");

-- CreateIndex
CREATE UNIQUE INDEX "movimientos_tercero_id_empresa_folio_key" ON "movimientos_tercero"("id_empresa", "folio");

-- CreateIndex
CREATE INDEX "movimientos_tercero_id_empresa_idx" ON "movimientos_tercero"("id_empresa");

-- CreateIndex
CREATE INDEX "movimientos_tercero_tipo_tercero_idx" ON "movimientos_tercero"("tipo_tercero");

-- CreateIndex
CREATE INDEX "movimientos_tercero_id_cliente_idx" ON "movimientos_tercero"("id_cliente");

-- CreateIndex
CREATE INDEX "movimientos_tercero_id_proveedor_idx" ON "movimientos_tercero"("id_proveedor");

-- CreateIndex
CREATE INDEX "movimientos_tercero_origen_idx" ON "movimientos_tercero"("origen");

-- CreateIndex
CREATE INDEX "movimientos_tercero_es_fiscal_idx" ON "movimientos_tercero"("es_fiscal");

-- CreateIndex
CREATE INDEX "movimientos_tercero_id_archivo_cfdi_idx" ON "movimientos_tercero"("id_archivo_cfdi");

-- CreateIndex
-- UNIQUE sobre id_movimiento_inverso: en PostgreSQL los NULL son DISTINTOS, así que las N filas
-- normales (id_movimiento_inverso NULL) pasan sin restricción, pero solo puede existir UN inverso por
-- original (defensa en profundidad contra doble cancelación concurrente, D3).
CREATE UNIQUE INDEX "movimientos_tercero_id_movimiento_inverso_key" ON "movimientos_tercero"("id_movimiento_inverso");

-- CreateIndex
CREATE INDEX "movimientos_tercero_id_empresa_tipo_tercero_id_proveedor_idx" ON "movimientos_tercero"("id_empresa", "tipo_tercero", "id_proveedor");

-- CreateIndex
CREATE INDEX "movimientos_tercero_id_empresa_tipo_tercero_id_cliente_idx" ON "movimientos_tercero"("id_empresa", "tipo_tercero", "id_cliente");

-- Invariantes de negocio (CHECK, defensa en profundidad — el dominio también las valida):
--  1) EXCLUSIVIDAD del tercero (D15a): tipo_tercero decide cuál FK está poblada, y solo una.
--  2) monto <> 0: un movimiento en cero no representa ningún hecho contable (el signo lo pone el
--     dominio según el origen — `signoDeOrigen`; el CHECK de signo-por-origen se deja al dominio
--     para que E4/E5 puedan extender el enum de orígenes sin migrar este CHECK).
ALTER TABLE "movimientos_tercero"
  ADD CONSTRAINT "movimientos_tercero_tercero_exclusivo_check" CHECK (
    ("tipo_tercero" = 'cliente'   AND "id_cliente" IS NOT NULL AND "id_proveedor" IS NULL)
    OR
    ("tipo_tercero" = 'proveedor' AND "id_proveedor" IS NOT NULL AND "id_cliente" IS NULL)
  );

ALTER TABLE "movimientos_tercero"
  ADD CONSTRAINT "movimientos_tercero_monto_no_cero_check" CHECK ("monto" <> 0);

-- AddForeignKey
ALTER TABLE "movimientos_tercero" ADD CONSTRAINT "movimientos_tercero_id_empresa_fkey" FOREIGN KEY ("id_empresa") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos_tercero" ADD CONSTRAINT "movimientos_tercero_id_cliente_fkey" FOREIGN KEY ("id_cliente") REFERENCES "clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos_tercero" ADD CONSTRAINT "movimientos_tercero_id_proveedor_fkey" FOREIGN KEY ("id_proveedor") REFERENCES "proveedores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos_tercero" ADD CONSTRAINT "movimientos_tercero_id_archivo_cfdi_fkey" FOREIGN KEY ("id_archivo_cfdi") REFERENCES "archivos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos_tercero" ADD CONSTRAINT "movimientos_tercero_id_movimiento_inverso_fkey" FOREIGN KEY ("id_movimiento_inverso") REFERENCES "movimientos_tercero"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
