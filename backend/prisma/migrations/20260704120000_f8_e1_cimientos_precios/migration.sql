-- F8-E1 · Cimientos de datos de Desarrollo, Cotización y Listas de Precios (Módulo 15, D13,
-- R16–R20). Migración ADITIVA ÚNICA de TODA la fase (patrón F3-E1): las tablas de E2–E6 nacen
-- aquí aunque su dominio/UI llegue en etapas posteriores. Diseño en la sección "DESARROLLO,
-- COTIZACIÓN y LISTAS DE PRECIOS (Módulo 15, F8)" de schema.prisma.
--
-- Resumen: 2 enums + 2 columnas nuevas en `modelo_tela`/`modelo_avio` (amarres + consumoPorTalla) +
-- 15 tablas nuevas. NO altera ni borra ninguna fila existente (los ADD COLUMN llevan DEFAULT o son
-- nullable). El amarre al proveedor del AVÍO es ESCALAR sin FK (precedente F4
-- `OrdenCompraLinea.idAvioProveedor`): NO se toca `avio_proveedor`. El amarre de TELA sí es FK real
-- (`tela_proveedor` tiene surrogate `id`). El SQL de estructura equivale al `prisma migrate diff`
-- entre el schema F7 y el schema F8 (redactado a mano — sin Docker local, regla §7 de CLAUDE.md).

-- CreateEnum
CREATE TYPE "estado_precosto" AS ENUM ('borrador', 'congelado');

-- CreateEnum
CREATE TYPE "origen_precosto_linea" AS ENUM ('bom_tela', 'bom_avio', 'bom_bordado', 'manual');

-- AlterTable (amarre de tela + consumo por talla + amarre de avío en el BOM). Aditivo: los ADD
-- COLUMN nuevos son nullable o llevan DEFAULT, así que las filas existentes del BOM no se tocan.
ALTER TABLE "modelo_tela" ADD COLUMN     "id_tela_proveedor" INTEGER;

-- AlterTable
ALTER TABLE "modelo_avio" ADD COLUMN     "consumo_por_talla" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "id_avio_proveedor" INTEGER;

-- CreateTable
CREATE TABLE "concepto_costo" (
    "id" SERIAL NOT NULL,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "fijo" BOOLEAN NOT NULL DEFAULT false,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "concepto_costo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "estado_lista" (
    "id" SERIAL NOT NULL,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "es_cierre" BOOLEAN NOT NULL DEFAULT false,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "estado_lista_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cliente_departamento" (
    "id" SERIAL NOT NULL,
    "id_cliente" INTEGER NOT NULL,
    "nombre" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "cliente_departamento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tela_proveedor" (
    "id" SERIAL NOT NULL,
    "id_tela" INTEGER NOT NULL,
    "id_proveedor" INTEGER NOT NULL,
    "precio" DECIMAL(12,2),
    "maneja_precio_por_color" BOOLEAN NOT NULL DEFAULT false,
    "condiciones" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "tela_proveedor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tela_proveedor_color" (
    "id_tela_proveedor" INTEGER NOT NULL,
    "id_color" INTEGER NOT NULL,
    "precio" DECIMAL(12,2),
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "tela_proveedor_color_pkey" PRIMARY KEY ("id_tela_proveedor","id_color")
);

-- CreateTable
CREATE TABLE "modelo_avio_talla" (
    "id_modelo" INTEGER NOT NULL,
    "id_avio" INTEGER NOT NULL,
    "id_talla" INTEGER NOT NULL,
    "consumo" DECIMAL(12,4) NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "modelo_avio_talla_pkey" PRIMARY KEY ("id_modelo","id_avio","id_talla")
);

-- CreateTable
CREATE TABLE "proyectos" (
    "id" SERIAL NOT NULL,
    "folio" BIGINT NOT NULL,
    "id_empresa" INTEGER NOT NULL,
    "id_cliente" INTEGER NOT NULL,
    "id_cliente_departamento" INTEGER NOT NULL,
    "nombre" TEXT NOT NULL,
    "id_temporada" INTEGER,
    "notas" TEXT,
    "archivado" BOOLEAN NOT NULL DEFAULT false,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "proyectos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "desarrollos" (
    "id" SERIAL NOT NULL,
    "id_proyecto" INTEGER NOT NULL,
    "id_modelo" INTEGER NOT NULL,
    "numero_cliente" TEXT,
    "apagado" BOOLEAN NOT NULL DEFAULT false,
    "apagado_en" TIMESTAMP(3),
    "apagado_por_id" TEXT,
    "motivo_apagado" TEXT,
    "notas" TEXT,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "desarrollos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "desarrollo_orden" (
    "id" SERIAL NOT NULL,
    "id_desarrollo" INTEGER NOT NULL,
    "id_orden" INTEGER NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "desarrollo_orden_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "precostos" (
    "id" SERIAL NOT NULL,
    "id_desarrollo" INTEGER NOT NULL,
    "version" INTEGER NOT NULL,
    "estado" "estado_precosto" NOT NULL DEFAULT 'borrador',
    "congelado_en" TIMESTAMP(3),
    "congelado_por_id" TEXT,
    "costo_total" DECIMAL(12,2),
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "precostos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "precosto_linea" (
    "id" SERIAL NOT NULL,
    "id_precosto" INTEGER NOT NULL,
    "id_concepto_costo" INTEGER NOT NULL,
    "origen" "origen_precosto_linea" NOT NULL,
    "id_tela" INTEGER,
    "id_tela_proveedor" INTEGER,
    "id_avio" INTEGER,
    "id_avio_proveedor" INTEGER,
    "id_bordado" INTEGER,
    "descripcion" TEXT NOT NULL,
    "consumo" DECIMAL(12,4),
    "precio_unit" DECIMAL(12,2) NOT NULL,
    "importe" DECIMAL(12,2) NOT NULL,
    "notas" TEXT,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "precosto_linea_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cliente_factores" (
    "id" SERIAL NOT NULL,
    "id_cliente" INTEGER NOT NULL,
    "id_cliente_departamento" INTEGER,
    "margen_pct" DECIMAL(5,2) NOT NULL,
    "descuentos_pct" DECIMAL(5,2) NOT NULL,
    "regalias_pct" DECIMAL(5,2) NOT NULL,
    "costo_ventas_pct" DECIMAL(5,2) NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "cliente_factores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lista_precios" (
    "id" SERIAL NOT NULL,
    "folio" BIGINT NOT NULL,
    "id_empresa" INTEGER NOT NULL,
    "id_cliente" INTEGER NOT NULL,
    "id_cliente_departamento" INTEGER NOT NULL,
    "fecha" DATE NOT NULL,
    "id_estado_lista" INTEGER NOT NULL,
    "margen_pct" DECIMAL(5,2) NOT NULL,
    "descuentos_pct" DECIMAL(5,2) NOT NULL,
    "regalias_pct" DECIMAL(5,2) NOT NULL,
    "costo_ventas_pct" DECIMAL(5,2) NOT NULL,
    "notas" TEXT,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "lista_precios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lista_precios_linea" (
    "id" SERIAL NOT NULL,
    "id_lista" INTEGER NOT NULL,
    "id_desarrollo" INTEGER NOT NULL,
    "id_precosto" INTEGER NOT NULL,
    "costo_unit" DECIMAL(12,2) NOT NULL,
    "precio_calculado" DECIMAL(12,2) NOT NULL,
    "precio_aprobado" DECIMAL(12,2),
    "aprobado_por_id" TEXT,
    "aprobado_en" TIMESTAMP(3),
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "lista_precios_linea_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "negociacion_evento" (
    "id" SERIAL NOT NULL,
    "id_lista_linea" INTEGER NOT NULL,
    "id_precosto_anterior" INTEGER,
    "id_precosto_nuevo" INTEGER,
    "precio_anterior" DECIMAL(12,2),
    "precio_nuevo" DECIMAL(12,2),
    "acuerdo" TEXT NOT NULL,
    "registrado_por_id" TEXT,
    "registrado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "negociacion_evento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "concepto_costo_codigo_key" ON "concepto_costo"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "estado_lista_codigo_key" ON "estado_lista"("codigo");

-- CreateIndex
CREATE INDEX "cliente_departamento_id_cliente_idx" ON "cliente_departamento"("id_cliente");

-- CreateIndex
CREATE UNIQUE INDEX "cliente_departamento_id_cliente_nombre_key" ON "cliente_departamento"("id_cliente", "nombre");

-- CreateIndex
CREATE INDEX "tela_proveedor_id_proveedor_idx" ON "tela_proveedor"("id_proveedor");

-- CreateIndex
CREATE UNIQUE INDEX "tela_proveedor_id_tela_id_proveedor_key" ON "tela_proveedor"("id_tela", "id_proveedor");

-- CreateIndex
CREATE INDEX "tela_proveedor_color_id_color_idx" ON "tela_proveedor_color"("id_color");

-- CreateIndex
CREATE INDEX "modelo_avio_talla_id_talla_idx" ON "modelo_avio_talla"("id_talla");

-- CreateIndex
CREATE INDEX "modelo_avio_talla_id_modelo_id_avio_idx" ON "modelo_avio_talla"("id_modelo", "id_avio");

-- CreateIndex
CREATE INDEX "proyectos_id_cliente_idx" ON "proyectos"("id_cliente");

-- CreateIndex
CREATE INDEX "proyectos_id_cliente_departamento_idx" ON "proyectos"("id_cliente_departamento");

-- CreateIndex
CREATE INDEX "proyectos_id_temporada_idx" ON "proyectos"("id_temporada");

-- CreateIndex
CREATE UNIQUE INDEX "proyectos_id_empresa_folio_key" ON "proyectos"("id_empresa", "folio");

-- CreateIndex
CREATE INDEX "desarrollos_id_modelo_idx" ON "desarrollos"("id_modelo");

-- CreateIndex
CREATE UNIQUE INDEX "desarrollos_id_proyecto_id_modelo_key" ON "desarrollos"("id_proyecto", "id_modelo");

-- CreateIndex
CREATE UNIQUE INDEX "desarrollo_orden_id_orden_key" ON "desarrollo_orden"("id_orden");

-- CreateIndex
CREATE INDEX "desarrollo_orden_id_desarrollo_idx" ON "desarrollo_orden"("id_desarrollo");

-- CreateIndex
CREATE UNIQUE INDEX "precostos_id_desarrollo_version_key" ON "precostos"("id_desarrollo", "version");

-- CreateIndex
CREATE INDEX "precosto_linea_id_precosto_idx" ON "precosto_linea"("id_precosto");

-- CreateIndex
CREATE INDEX "precosto_linea_id_concepto_costo_idx" ON "precosto_linea"("id_concepto_costo");

-- CreateIndex
CREATE INDEX "precosto_linea_id_tela_idx" ON "precosto_linea"("id_tela");

-- CreateIndex
CREATE INDEX "precosto_linea_id_tela_proveedor_idx" ON "precosto_linea"("id_tela_proveedor");

-- CreateIndex
CREATE INDEX "precosto_linea_id_avio_idx" ON "precosto_linea"("id_avio");

-- CreateIndex
CREATE INDEX "precosto_linea_id_bordado_idx" ON "precosto_linea"("id_bordado");

-- CreateIndex
CREATE INDEX "cliente_factores_id_cliente_idx" ON "cliente_factores"("id_cliente");

-- CreateIndex
CREATE INDEX "cliente_factores_id_cliente_departamento_idx" ON "cliente_factores"("id_cliente_departamento");

-- CreateIndex
CREATE UNIQUE INDEX "cliente_factores_id_cliente_id_cliente_departamento_key" ON "cliente_factores"("id_cliente", "id_cliente_departamento");

-- CreateIndex
CREATE INDEX "lista_precios_id_cliente_idx" ON "lista_precios"("id_cliente");

-- CreateIndex
CREATE INDEX "lista_precios_id_cliente_departamento_idx" ON "lista_precios"("id_cliente_departamento");

-- CreateIndex
CREATE INDEX "lista_precios_id_estado_lista_idx" ON "lista_precios"("id_estado_lista");

-- CreateIndex
CREATE UNIQUE INDEX "lista_precios_id_empresa_folio_key" ON "lista_precios"("id_empresa", "folio");

-- CreateIndex
CREATE INDEX "lista_precios_linea_id_desarrollo_idx" ON "lista_precios_linea"("id_desarrollo");

-- CreateIndex
CREATE INDEX "lista_precios_linea_id_precosto_idx" ON "lista_precios_linea"("id_precosto");

-- CreateIndex
CREATE UNIQUE INDEX "lista_precios_linea_id_lista_id_desarrollo_key" ON "lista_precios_linea"("id_lista", "id_desarrollo");

-- CreateIndex
CREATE INDEX "negociacion_evento_id_lista_linea_idx" ON "negociacion_evento"("id_lista_linea");

-- CreateIndex
CREATE INDEX "negociacion_evento_id_precosto_anterior_idx" ON "negociacion_evento"("id_precosto_anterior");

-- CreateIndex
CREATE INDEX "negociacion_evento_id_precosto_nuevo_idx" ON "negociacion_evento"("id_precosto_nuevo");

-- CreateIndex
CREATE INDEX "modelo_tela_id_tela_proveedor_idx" ON "modelo_tela"("id_tela_proveedor");

-- CreateIndex
CREATE INDEX "modelo_avio_id_avio_proveedor_idx" ON "modelo_avio"("id_avio_proveedor");

-- AddForeignKey (amarre de tela en el BOM → renglón proveedor–tela–precio; SetNull al retirarlo)
ALTER TABLE "modelo_tela" ADD CONSTRAINT "modelo_tela_id_tela_proveedor_fkey" FOREIGN KEY ("id_tela_proveedor") REFERENCES "tela_proveedor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cliente_departamento" ADD CONSTRAINT "cliente_departamento_id_cliente_fkey" FOREIGN KEY ("id_cliente") REFERENCES "clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tela_proveedor" ADD CONSTRAINT "tela_proveedor_id_tela_fkey" FOREIGN KEY ("id_tela") REFERENCES "telas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tela_proveedor" ADD CONSTRAINT "tela_proveedor_id_proveedor_fkey" FOREIGN KEY ("id_proveedor") REFERENCES "proveedores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tela_proveedor_color" ADD CONSTRAINT "tela_proveedor_color_id_tela_proveedor_fkey" FOREIGN KEY ("id_tela_proveedor") REFERENCES "tela_proveedor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tela_proveedor_color" ADD CONSTRAINT "tela_proveedor_color_id_color_fkey" FOREIGN KEY ("id_color") REFERENCES "colores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey (FK COMPUESTA al renglón del BOM ModeloAvio, cuya PK es [id_modelo, id_avio])
ALTER TABLE "modelo_avio_talla" ADD CONSTRAINT "modelo_avio_talla_id_modelo_id_avio_fkey" FOREIGN KEY ("id_modelo", "id_avio") REFERENCES "modelo_avio"("id_modelo", "id_avio") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "modelo_avio_talla" ADD CONSTRAINT "modelo_avio_talla_id_talla_fkey" FOREIGN KEY ("id_talla") REFERENCES "tallas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proyectos" ADD CONSTRAINT "proyectos_id_empresa_fkey" FOREIGN KEY ("id_empresa") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proyectos" ADD CONSTRAINT "proyectos_id_cliente_fkey" FOREIGN KEY ("id_cliente") REFERENCES "clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proyectos" ADD CONSTRAINT "proyectos_id_cliente_departamento_fkey" FOREIGN KEY ("id_cliente_departamento") REFERENCES "cliente_departamento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proyectos" ADD CONSTRAINT "proyectos_id_temporada_fkey" FOREIGN KEY ("id_temporada") REFERENCES "temporadas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "desarrollos" ADD CONSTRAINT "desarrollos_id_proyecto_fkey" FOREIGN KEY ("id_proyecto") REFERENCES "proyectos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "desarrollos" ADD CONSTRAINT "desarrollos_id_modelo_fkey" FOREIGN KEY ("id_modelo") REFERENCES "modelos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "desarrollo_orden" ADD CONSTRAINT "desarrollo_orden_id_desarrollo_fkey" FOREIGN KEY ("id_desarrollo") REFERENCES "desarrollos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "desarrollo_orden" ADD CONSTRAINT "desarrollo_orden_id_orden_fkey" FOREIGN KEY ("id_orden") REFERENCES "ordenes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "precostos" ADD CONSTRAINT "precostos_id_desarrollo_fkey" FOREIGN KEY ("id_desarrollo") REFERENCES "desarrollos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "precosto_linea" ADD CONSTRAINT "precosto_linea_id_precosto_fkey" FOREIGN KEY ("id_precosto") REFERENCES "precostos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "precosto_linea" ADD CONSTRAINT "precosto_linea_id_concepto_costo_fkey" FOREIGN KEY ("id_concepto_costo") REFERENCES "concepto_costo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "precosto_linea" ADD CONSTRAINT "precosto_linea_id_tela_fkey" FOREIGN KEY ("id_tela") REFERENCES "telas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "precosto_linea" ADD CONSTRAINT "precosto_linea_id_tela_proveedor_fkey" FOREIGN KEY ("id_tela_proveedor") REFERENCES "tela_proveedor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "precosto_linea" ADD CONSTRAINT "precosto_linea_id_avio_fkey" FOREIGN KEY ("id_avio") REFERENCES "avios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "precosto_linea" ADD CONSTRAINT "precosto_linea_id_bordado_fkey" FOREIGN KEY ("id_bordado") REFERENCES "bordados"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cliente_factores" ADD CONSTRAINT "cliente_factores_id_cliente_fkey" FOREIGN KEY ("id_cliente") REFERENCES "clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cliente_factores" ADD CONSTRAINT "cliente_factores_id_cliente_departamento_fkey" FOREIGN KEY ("id_cliente_departamento") REFERENCES "cliente_departamento"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lista_precios" ADD CONSTRAINT "lista_precios_id_empresa_fkey" FOREIGN KEY ("id_empresa") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lista_precios" ADD CONSTRAINT "lista_precios_id_cliente_fkey" FOREIGN KEY ("id_cliente") REFERENCES "clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lista_precios" ADD CONSTRAINT "lista_precios_id_cliente_departamento_fkey" FOREIGN KEY ("id_cliente_departamento") REFERENCES "cliente_departamento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lista_precios" ADD CONSTRAINT "lista_precios_id_estado_lista_fkey" FOREIGN KEY ("id_estado_lista") REFERENCES "estado_lista"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lista_precios_linea" ADD CONSTRAINT "lista_precios_linea_id_lista_fkey" FOREIGN KEY ("id_lista") REFERENCES "lista_precios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lista_precios_linea" ADD CONSTRAINT "lista_precios_linea_id_desarrollo_fkey" FOREIGN KEY ("id_desarrollo") REFERENCES "desarrollos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lista_precios_linea" ADD CONSTRAINT "lista_precios_linea_id_precosto_fkey" FOREIGN KEY ("id_precosto") REFERENCES "precostos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "negociacion_evento" ADD CONSTRAINT "negociacion_evento_id_lista_linea_fkey" FOREIGN KEY ("id_lista_linea") REFERENCES "lista_precios_linea"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "negociacion_evento" ADD CONSTRAINT "negociacion_evento_id_precosto_anterior_fkey" FOREIGN KEY ("id_precosto_anterior") REFERENCES "precostos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "negociacion_evento" ADD CONSTRAINT "negociacion_evento_id_precosto_nuevo_fkey" FOREIGN KEY ("id_precosto_nuevo") REFERENCES "precostos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
