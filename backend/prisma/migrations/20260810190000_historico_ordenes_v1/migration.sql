-- ARCHIVO HISTÓRICO DE ÓRDENES DEL SISTEMA VIEJO (§Post-F9.26).
--
-- Daniel: *"me gustaría tenerlas también como archivo histórico de órdenes… para poder buscar por
-- cliente, número de modelo, tipo de prenda, fecha de producción, maquilero"* — y antes: *"sin
-- poder manipular las órdenes… sin jalar maquileros, estampadores dentro de un catálogo, sino como
-- un campo informativo"*.
--
-- La migración lleva solo 2025-2026 (§Post-F9.24): de 5,451 órdenes del viejo, 262 entran como
-- órdenes OPERATIVAS y las otras ~5,200 viven aquí, PLANAS y de SOLO LECTURA. Traerlas como `Orden`
-- habría obligado a arrastrar folios, kardex, costeo, ruta crítica y los catálogos de terceros que
-- justo se depuraron (§Post-F9.23).
--
-- Los terceros van como TEXTO (no FK a `Proveedor`): el nombre se resuelve UNA vez al migrar, para
-- que el catálogo depurado no se vuelva a llenar con los 897 terceros muertos. La única FK real es
-- al `Modelo` —los modelos SÍ migran completos— y es la que permite filtrar por tipo de prenda y
-- género sin duplicar esos datos.
--
-- Migración puramente ADITIVA: tres tablas nuevas y un enum. No toca nada de lo que ya existe.

-- CreateEnum
CREATE TYPE "proceso_historico_v1" AS ENUM ('corte', 'envio_maquila', 'recibo_maquila', 'envio_estampado', 'recibo_estampado');

-- CreateTable
CREATE TABLE "historico_orden_v1" (
    "id" SERIAL NOT NULL,
    "id_empresa" INTEGER NOT NULL,
    "id_orden_v1" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "fecha" DATE,
    "fechaEntrega" DATE,
    "id_modelo" INTEGER,
    "codigo_modelo_v1" TEXT,
    "cliente" TEXT,
    "maquilero" TEXT,
    "etiqueta_marca" TEXT,
    "tela" TEXT,
    "composicion" TEXT,
    "observaciones" TEXT,
    "cancelada" BOOLEAN NOT NULL DEFAULT false,
    "motivo_cancelada" TEXT,
    "total_piezas" INTEGER NOT NULL DEFAULT 0,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "historico_orden_v1_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "historico_orden_v1_linea" (
    "id" SERIAL NOT NULL,
    "id_orden" INTEGER NOT NULL,
    "color" TEXT NOT NULL,
    "talla" TEXT NOT NULL,
    "cantidad" INTEGER NOT NULL,

    CONSTRAINT "historico_orden_v1_linea_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "historico_orden_v1_proceso" (
    "id" SERIAL NOT NULL,
    "id_orden" INTEGER NOT NULL,
    "tipo" "proceso_historico_v1" NOT NULL,
    "fecha" DATE,
    "tercero" TEXT,
    "cantidad" INTEGER NOT NULL,
    "observaciones" TEXT,

    CONSTRAINT "historico_orden_v1_proceso_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "historico_orden_v1_id_empresa_numero_idx" ON "historico_orden_v1"("id_empresa", "numero");

-- CreateIndex
CREATE INDEX "historico_orden_v1_id_modelo_idx" ON "historico_orden_v1"("id_modelo");

-- CreateIndex
CREATE INDEX "historico_orden_v1_fecha_idx" ON "historico_orden_v1"("fecha");

-- CreateIndex
CREATE INDEX "historico_orden_v1_cliente_idx" ON "historico_orden_v1"("cliente");

-- CreateIndex
CREATE INDEX "historico_orden_v1_maquilero_idx" ON "historico_orden_v1"("maquilero");

-- CreateIndex
CREATE UNIQUE INDEX "historico_orden_v1_id_empresa_id_orden_v1_key" ON "historico_orden_v1"("id_empresa", "id_orden_v1");

-- CreateIndex
CREATE INDEX "historico_orden_v1_linea_id_orden_idx" ON "historico_orden_v1_linea"("id_orden");

-- CreateIndex
CREATE INDEX "historico_orden_v1_proceso_id_orden_idx" ON "historico_orden_v1_proceso"("id_orden");

-- CreateIndex
CREATE INDEX "historico_orden_v1_proceso_tercero_idx" ON "historico_orden_v1_proceso"("tercero");

-- AddForeignKey
ALTER TABLE "historico_orden_v1" ADD CONSTRAINT "historico_orden_v1_id_empresa_fkey" FOREIGN KEY ("id_empresa") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historico_orden_v1" ADD CONSTRAINT "historico_orden_v1_id_modelo_fkey" FOREIGN KEY ("id_modelo") REFERENCES "modelos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historico_orden_v1_linea" ADD CONSTRAINT "historico_orden_v1_linea_id_orden_fkey" FOREIGN KEY ("id_orden") REFERENCES "historico_orden_v1"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historico_orden_v1_proceso" ADD CONSTRAINT "historico_orden_v1_proceso_id_orden_fkey" FOREIGN KEY ("id_orden") REFERENCES "historico_orden_v1"("id") ON DELETE CASCADE ON UPDATE CASCADE;

