-- CreateEnum
CREATE TYPE "tipo_archivo_proveedor" AS ENUM ('CONSTANCIA', 'CONTRATO', 'OTRO');

-- AlterTable
ALTER TABLE "proveedores" ADD COLUMN     "banco" TEXT,
ADD COLUMN     "clabe" TEXT,
ADD COLUMN     "codigo_postal_expedicion" TEXT,
ADD COLUMN     "dias_credito" INTEGER,
ADD COLUMN     "direccion" TEXT,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "factura" BOOLEAN,
ADD COLUMN     "forma_pago" TEXT,
ADD COLUMN     "lead_time_dias" INTEGER,
ADD COLUMN     "limite_credito" DECIMAL(14,2),
ADD COLUMN     "metodo_pago" TEXT,
ADD COLUMN     "moneda" TEXT,
ADD COLUMN     "notas" TEXT,
ADD COLUMN     "regimen_fiscal_sat" TEXT,
ADD COLUMN     "retiene_isr" BOOLEAN,
ADD COLUMN     "retiene_iva" BOOLEAN,
ADD COLUMN     "rfc" TEXT,
ADD COLUMN     "uso_cfdi_habitual" TEXT;

-- CreateTable
CREATE TABLE "roles_proveedor" (
    "id" SERIAL NOT NULL,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "roles_proveedor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proveedor_rol" (
    "id_proveedor" INTEGER NOT NULL,
    "id_rol_proveedor" INTEGER NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,

    CONSTRAINT "proveedor_rol_pkey" PRIMARY KEY ("id_proveedor","id_rol_proveedor")
);

-- CreateTable
CREATE TABLE "proveedor_archivo" (
    "id" SERIAL NOT NULL,
    "id_proveedor" INTEGER NOT NULL,
    "id_archivo" TEXT NOT NULL,
    "tipo" "tipo_archivo_proveedor" NOT NULL DEFAULT 'OTRO',
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,

    CONSTRAINT "proveedor_archivo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "roles_proveedor_codigo_key" ON "roles_proveedor"("codigo");

-- CreateIndex
CREATE INDEX "proveedor_rol_id_rol_proveedor_idx" ON "proveedor_rol"("id_rol_proveedor");

-- CreateIndex
CREATE INDEX "proveedor_archivo_id_proveedor_idx" ON "proveedor_archivo"("id_proveedor");

-- CreateIndex
CREATE UNIQUE INDEX "proveedor_archivo_id_archivo_key" ON "proveedor_archivo"("id_archivo");

-- AddForeignKey
ALTER TABLE "proveedor_rol" ADD CONSTRAINT "proveedor_rol_id_proveedor_fkey" FOREIGN KEY ("id_proveedor") REFERENCES "proveedores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proveedor_rol" ADD CONSTRAINT "proveedor_rol_id_rol_proveedor_fkey" FOREIGN KEY ("id_rol_proveedor") REFERENCES "roles_proveedor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proveedor_archivo" ADD CONSTRAINT "proveedor_archivo_id_proveedor_fkey" FOREIGN KEY ("id_proveedor") REFERENCES "proveedores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proveedor_archivo" ADD CONSTRAINT "proveedor_archivo_id_archivo_fkey" FOREIGN KEY ("id_archivo") REFERENCES "archivos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
