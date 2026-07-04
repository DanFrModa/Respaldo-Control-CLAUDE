-- F7-E4 · Productividad unificada IP/Almacén + fichas confiables + muestrarios (Módulo Indicadores;
-- doc `Documentacion_MJD/05-Indicadores.md` §A.1-A.3 / §B.1; MEJORAS 05 §1 "motor de productividad
-- configurable por área"; A6/D4 despivotado, A7 auditoría, A9 por empresa).
-- Migración ADITIVA (verificada con `prisma validate` y `prisma migrate diff --from-empty`):
--  • 1 columna nueva en `configuraciones_empresa` (`jornada_base_almacen`) — el `HorasBaseAlm = 9`
--    del viejo, ahora parámetro por empresa. NOT NULL DEFAULT 9 → Postgres rellena las filas ya
--    sembradas con 9 (el valor histórico) en el propio ALTER: no hace falta backfill aparte.
--  • 1 enum `area_productividad` (ip/almacen) y 6 tablas nuevas (personal, actividades y registros de
--    productividad; catálogo de reactivos + verificaciones de ficha; muestrarios). No toca datos.
-- El catálogo de reactivos de ficha (los 8 fijos del viejo) y NO nuevos permisos/roles (ya declarados
-- en el catálogo) los siembra `seed.ts` con SEED_ON_START (idempotente). NADA que correr a mano.

-- ── Nueva columna de configuración: jornada base del almacén (ex constante `HorasBaseAlm`) ──────────
ALTER TABLE "configuraciones_empresa" ADD COLUMN "jornada_base_almacen" INTEGER NOT NULL DEFAULT 9;

-- ── Enum de área (unifica los dos módulos gemelos del viejo: IP y Almacén) ──────────────────────────
CREATE TYPE "area_productividad" AS ENUM ('ip', 'almacen');

-- ═════════════════════════════════════════════════════════════════════════════
-- Productividad unificada (← IP_Personal + IP_Actividades + IP_Productiv y Alm_Prd_* )
-- ═════════════════════════════════════════════════════════════════════════════
CREATE TABLE "personal_area" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "area" "area_productividad" NOT NULL,
    "horas_base" DECIMAL(5,2),
    "puesto" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "personal_area_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "actividad_productividad" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "area" "area_productividad" NOT NULL,
    "porcentaje_d" DECIMAL(10,4),
    "pz_pers_dia" DECIMAL(10,4),
    "porcen_pzas" DECIMAL(10,4),
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "actividad_productividad_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "registro_productividad" (
    "id" SERIAL NOT NULL,
    "id_empresa" INTEGER NOT NULL,
    "fecha" DATE NOT NULL,
    "area" "area_productividad" NOT NULL,
    "id_actividad" INTEGER NOT NULL,
    "id_persona" INTEGER,
    "cantidad" DECIMAL(12,2) NOT NULL,
    "horas_trabajadas" DECIMAL(6,2) NOT NULL,
    "personas" INTEGER NOT NULL DEFAULT 1,
    "id_cliente" INTEGER,
    "cancelado" BOOLEAN NOT NULL DEFAULT false,
    "cancelado_en" TIMESTAMP(3),
    "cancelado_por_id" TEXT,
    "motivo_cancelacion" TEXT,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "registro_productividad_pkey" PRIMARY KEY ("id")
);

-- ═════════════════════════════════════════════════════════════════════════════
-- Fichas confiables (← IP_InfConf + Ind_IP_InfConfiable) — checklist por FILAS (A6)
-- ═════════════════════════════════════════════════════════════════════════════
CREATE TABLE "checklist_ficha_def" (
    "id" SERIAL NOT NULL,
    "clave" TEXT NOT NULL,
    "etiqueta" TEXT NOT NULL,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "checklist_ficha_def_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ficha_verificacion" (
    "id" SERIAL NOT NULL,
    "id_empresa" INTEGER NOT NULL,
    "id_orden" INTEGER NOT NULL,
    "id_reactivo" INTEGER NOT NULL,
    "hecho" BOOLEAN NOT NULL DEFAULT false,
    "revisor_id" TEXT,
    "fecha" DATE,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "ficha_verificacion_pkey" PRIMARY KEY ("id")
);

-- ═════════════════════════════════════════════════════════════════════════════
-- Muestrarios pendientes (← IP_MuesPend)
-- ═════════════════════════════════════════════════════════════════════════════
CREATE TABLE "muestrarios" (
    "id" SERIAL NOT NULL,
    "id_empresa" INTEGER NOT NULL,
    "id_cliente" INTEGER NOT NULL,
    "categoria" TEXT,
    "id_temporada" INTEGER,
    "cant_boards" INTEGER NOT NULL DEFAULT 0,
    "cant_muestras" INTEGER NOT NULL DEFAULT 0,
    "fecha_solicitado" DATE NOT NULL,
    "fecha_requerida" DATE NOT NULL,
    "fecha_entregado" DATE,
    "boards_ok" INTEGER NOT NULL DEFAULT 0,
    "muestras_ok" INTEGER NOT NULL DEFAULT 0,
    "solicitante_id" TEXT,
    "cancelado" BOOLEAN NOT NULL DEFAULT false,
    "cancelado_en" TIMESTAMP(3),
    "cancelado_por_id" TEXT,
    "motivo_cancelacion" TEXT,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "muestrarios_pkey" PRIMARY KEY ("id")
);

-- ── Índices y unicidad ──────────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX "personal_area_area_nombre_key" ON "personal_area"("area", "nombre");
CREATE UNIQUE INDEX "actividad_productividad_area_nombre_key" ON "actividad_productividad"("area", "nombre");
CREATE INDEX "registro_productividad_id_empresa_area_fecha_idx" ON "registro_productividad"("id_empresa", "area", "fecha");
CREATE INDEX "registro_productividad_id_actividad_idx" ON "registro_productividad"("id_actividad");
CREATE INDEX "registro_productividad_id_persona_idx" ON "registro_productividad"("id_persona");
CREATE INDEX "registro_productividad_id_cliente_idx" ON "registro_productividad"("id_cliente");
CREATE UNIQUE INDEX "checklist_ficha_def_clave_key" ON "checklist_ficha_def"("clave");
CREATE INDEX "ficha_verificacion_id_empresa_idx" ON "ficha_verificacion"("id_empresa");
CREATE INDEX "ficha_verificacion_id_reactivo_idx" ON "ficha_verificacion"("id_reactivo");
CREATE UNIQUE INDEX "ficha_verificacion_id_orden_id_reactivo_key" ON "ficha_verificacion"("id_orden", "id_reactivo");
CREATE INDEX "muestrarios_id_empresa_fecha_requerida_idx" ON "muestrarios"("id_empresa", "fecha_requerida");
CREATE INDEX "muestrarios_id_cliente_idx" ON "muestrarios"("id_cliente");
CREATE INDEX "muestrarios_id_temporada_idx" ON "muestrarios"("id_temporada");

-- ── Llaves foráneas ───────────────────────────────────────────────────────────────────────────────
ALTER TABLE "registro_productividad" ADD CONSTRAINT "registro_productividad_id_empresa_fkey" FOREIGN KEY ("id_empresa") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "registro_productividad" ADD CONSTRAINT "registro_productividad_id_actividad_fkey" FOREIGN KEY ("id_actividad") REFERENCES "actividad_productividad"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "registro_productividad" ADD CONSTRAINT "registro_productividad_id_persona_fkey" FOREIGN KEY ("id_persona") REFERENCES "personal_area"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "registro_productividad" ADD CONSTRAINT "registro_productividad_id_cliente_fkey" FOREIGN KEY ("id_cliente") REFERENCES "clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ficha_verificacion" ADD CONSTRAINT "ficha_verificacion_id_empresa_fkey" FOREIGN KEY ("id_empresa") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ficha_verificacion" ADD CONSTRAINT "ficha_verificacion_id_orden_fkey" FOREIGN KEY ("id_orden") REFERENCES "ordenes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ficha_verificacion" ADD CONSTRAINT "ficha_verificacion_id_reactivo_fkey" FOREIGN KEY ("id_reactivo") REFERENCES "checklist_ficha_def"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "muestrarios" ADD CONSTRAINT "muestrarios_id_empresa_fkey" FOREIGN KEY ("id_empresa") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "muestrarios" ADD CONSTRAINT "muestrarios_id_cliente_fkey" FOREIGN KEY ("id_cliente") REFERENCES "clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "muestrarios" ADD CONSTRAINT "muestrarios_id_temporada_fkey" FOREIGN KEY ("id_temporada") REFERENCES "temporadas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
