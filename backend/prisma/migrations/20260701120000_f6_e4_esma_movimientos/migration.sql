-- F6-E4 · EsMa — corazón contable: movimientos, prendas por pagar, saldo derivado y conciliación
-- (doc `Documentacion_MJD/07-EsMa-Estados-de-Cuenta-Maquileros.md`; DECISIONES.md §F6 (e)–(h)).
-- Migración ADITIVA (SQL canónico de Prisma, verificado con `prisma migrate diff`):
--  • 2 enums nuevos (modalidad de facturación del proveedor/movimiento; estado de revisión).
--  • Columnas NULLABLE / con DEFAULT en tablas ya sembradas → NO rompen filas existentes:
--    - `proveedores.modalidad_facturacion` (nullable, decisión h);
--    - `ordenes.pagada_forzada` (nullable, override de "pagada" derivada, decisión f);
--    - `esma_cargo`: `cantidad_pagada` DEFAULT 0 (prendas por pagar, decisión g), `sin_costo`
--      DEFAULT false (segundas sin costo, decisión f), `con_factura` nullable (decisión h).
--      Los DEFAULT backfillean las filas viejas (0 / false) — sin UPDATE manual.
--  • 3 movimientos PLANOS (abono/descuento/pago) + el puente pago↔cargo `pago_aplicacion`.
-- El SALDO no se persiste: es la suma derivada (D3). Ver la sección "EsMa — MOVIMIENTOS" de
-- schema.prisma. Sin permisos ni seed nuevos (reusa esma.ver-pagos/esma.modificar/esma.cargo-validar).

-- CreateEnum
CREATE TYPE "modalidad_facturacion" AS ENUM ('solo_con', 'solo_sin', 'ambos');

-- CreateEnum
CREATE TYPE "estado_revision_esma" AS ENUM ('capturado', 'revisado');

-- AlterTable
ALTER TABLE "proveedores" ADD COLUMN     "modalidad_facturacion" "modalidad_facturacion";

-- AlterTable
ALTER TABLE "ordenes" ADD COLUMN     "pagada_forzada" BOOLEAN;

-- AlterTable
ALTER TABLE "esma_cargo" ADD COLUMN     "cantidad_pagada" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "con_factura" BOOLEAN,
ADD COLUMN     "sin_costo" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "abono_maquilero" (
    "id" SERIAL NOT NULL,
    "id_empresa" INTEGER NOT NULL,
    "id_maquilero" INTEGER NOT NULL,
    "monto" DECIMAL(14,2) NOT NULL,
    "fecha" DATE NOT NULL,
    "con_factura" BOOLEAN,
    "observaciones" TEXT,
    "estado_revision" "estado_revision_esma" NOT NULL DEFAULT 'capturado',
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "abono_maquilero_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "descuento_maquilero" (
    "id" SERIAL NOT NULL,
    "id_empresa" INTEGER NOT NULL,
    "id_maquilero" INTEGER NOT NULL,
    "monto" DECIMAL(14,2) NOT NULL,
    "fecha" DATE NOT NULL,
    "con_factura" BOOLEAN,
    "observaciones" TEXT,
    "estado_revision" "estado_revision_esma" NOT NULL DEFAULT 'capturado',
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "descuento_maquilero_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pago_maquilero" (
    "id" SERIAL NOT NULL,
    "id_empresa" INTEGER NOT NULL,
    "id_maquilero" INTEGER NOT NULL,
    "monto" DECIMAL(14,2) NOT NULL,
    "fecha" DATE NOT NULL,
    "con_factura" BOOLEAN,
    "observaciones" TEXT,
    "estado_revision" "estado_revision_esma" NOT NULL DEFAULT 'capturado',
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "pago_maquilero_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pago_aplicacion" (
    "id_pago" INTEGER NOT NULL,
    "id_cargo" INTEGER NOT NULL,
    "cantidad" DECIMAL(14,2) NOT NULL,
    "importe" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "pago_aplicacion_pkey" PRIMARY KEY ("id_pago","id_cargo")
);

-- CreateIndex
CREATE INDEX "abono_maquilero_id_empresa_idx" ON "abono_maquilero"("id_empresa");

-- CreateIndex
CREATE INDEX "abono_maquilero_id_maquilero_idx" ON "abono_maquilero"("id_maquilero");

-- CreateIndex
CREATE INDEX "descuento_maquilero_id_empresa_idx" ON "descuento_maquilero"("id_empresa");

-- CreateIndex
CREATE INDEX "descuento_maquilero_id_maquilero_idx" ON "descuento_maquilero"("id_maquilero");

-- CreateIndex
CREATE INDEX "pago_maquilero_id_empresa_idx" ON "pago_maquilero"("id_empresa");

-- CreateIndex
CREATE INDEX "pago_maquilero_id_maquilero_idx" ON "pago_maquilero"("id_maquilero");

-- CreateIndex
CREATE INDEX "pago_aplicacion_id_cargo_idx" ON "pago_aplicacion"("id_cargo");

-- AddForeignKey
ALTER TABLE "abono_maquilero" ADD CONSTRAINT "abono_maquilero_id_empresa_fkey" FOREIGN KEY ("id_empresa") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "abono_maquilero" ADD CONSTRAINT "abono_maquilero_id_maquilero_fkey" FOREIGN KEY ("id_maquilero") REFERENCES "proveedores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "descuento_maquilero" ADD CONSTRAINT "descuento_maquilero_id_empresa_fkey" FOREIGN KEY ("id_empresa") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "descuento_maquilero" ADD CONSTRAINT "descuento_maquilero_id_maquilero_fkey" FOREIGN KEY ("id_maquilero") REFERENCES "proveedores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pago_maquilero" ADD CONSTRAINT "pago_maquilero_id_empresa_fkey" FOREIGN KEY ("id_empresa") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pago_maquilero" ADD CONSTRAINT "pago_maquilero_id_maquilero_fkey" FOREIGN KEY ("id_maquilero") REFERENCES "proveedores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pago_aplicacion" ADD CONSTRAINT "pago_aplicacion_id_pago_fkey" FOREIGN KEY ("id_pago") REFERENCES "pago_maquilero"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pago_aplicacion" ADD CONSTRAINT "pago_aplicacion_id_cargo_fkey" FOREIGN KEY ("id_cargo") REFERENCES "esma_cargo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
