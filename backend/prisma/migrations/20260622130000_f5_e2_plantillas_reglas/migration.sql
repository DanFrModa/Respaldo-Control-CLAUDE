-- F5-E2 · RUTA CRÍTICA — Plantillas de ruta, reglas de duración y calendario laboral (Módulo 8 —
-- doc `Documentacion_MJD/08-Ruta-Critica.md` §2.1 y §4; D10/D11). Migración ADITIVA (solo CREATE
-- TABLE + índices + FKs hacia tablas existentes): siete tablas nuevas, sin ALTER de columnas
-- existentes. Aplicable en limpio y sobre la BD de `prueba`.
--
--   • familia_articulo        — familias de artículos de la RC (ex `CP_Familia`).
--   • articulo_rc             — tipos de artículo de la RC (ex `CP_Articulos`, viejo IdCP_Articulos).
--                               NO se conecta por FK desde `orden` (escalar nullable en la orden).
--   • plantilla_ruta          — plantilla de ruta por familia/artículo.
--   • plantilla_ruta_proceso  — renglón de la plantilla: proceso + tiempo estándar + orden (ex
--                               `CP_Tiempos`).
--   • plantilla_ruta_dep      — arista del DAG de encadenamiento PROPIO de la plantilla (puede
--                               diferir del DAG genérico `proceso_dep`). Rechazo de ciclos en el
--                               dominio.
--   • factor_cantidad         — factor de duración por rango de cantidad (ex `CP_Cant`).
--   • duracion_tipo_tela      — días por tipo de tela + factorTela (ex `RC_TipoTelas`).
--   • duracion_aplicacion     — días por aplicación (ex `RC_Aplicaciones`).
--   • calendario_empresa      — días hábiles de la semana por empresa (decisión (a)).
--   • dia_festivo             — días festivos por empresa (decisión (a)).
--
-- NOTA (colchón de costura): la columna `colchon_costura` de `configuraciones_empresa` ya EXISTE
-- (creada en F0/F1); por eso esta migración NO la agrega ni hace backfill. Su edición por empresa
-- ya está expuesta en `/api/empresas/:id/configuracion`; F5-E2 solo la usa en la UI de Config RC.
-- SIN seed de datos, SIN permisos nuevos (reusa `rc.catalogo-ver`/`rc.catalogo-administrar`).

-- CreateTable
CREATE TABLE "familia_articulo" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "familia_articulo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "articulo_rc" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "id_familia_articulo" INTEGER NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "articulo_rc_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plantilla_ruta" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "id_familia_articulo" INTEGER,
    "id_articulo_rc" INTEGER,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "plantilla_ruta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plantilla_ruta_proceso" (
    "id" SERIAL NOT NULL,
    "id_plantilla_ruta" INTEGER NOT NULL,
    "id_proceso_def" INTEGER NOT NULL,
    "tiempo_estandar" INTEGER NOT NULL,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "plantilla_ruta_proceso_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plantilla_ruta_dep" (
    "id_plantilla_ruta_proceso" INTEGER NOT NULL,
    "id_antecesor" INTEGER NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,

    CONSTRAINT "plantilla_ruta_dep_pkey" PRIMARY KEY ("id_plantilla_ruta_proceso","id_antecesor")
);

-- CreateTable
CREATE TABLE "factor_cantidad" (
    "id" SERIAL NOT NULL,
    "de_cant" INTEGER NOT NULL,
    "a_cant" INTEGER NOT NULL,
    "factor" DECIMAL(10,4) NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "factor_cantidad_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "duracion_tipo_tela" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "dias" INTEGER NOT NULL,
    "factor_tela" DECIMAL(10,4) NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "duracion_tipo_tela_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "duracion_aplicacion" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "clave" TEXT,
    "dias" INTEGER NOT NULL,
    "factor" DECIMAL(10,4),
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "duracion_aplicacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendario_empresa" (
    "id" SERIAL NOT NULL,
    "id_empresa" INTEGER NOT NULL,
    "lunes" BOOLEAN NOT NULL DEFAULT true,
    "martes" BOOLEAN NOT NULL DEFAULT true,
    "miercoles" BOOLEAN NOT NULL DEFAULT true,
    "jueves" BOOLEAN NOT NULL DEFAULT true,
    "viernes" BOOLEAN NOT NULL DEFAULT true,
    "sabado" BOOLEAN NOT NULL DEFAULT false,
    "domingo" BOOLEAN NOT NULL DEFAULT false,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "calendario_empresa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dia_festivo" (
    "id" SERIAL NOT NULL,
    "id_empresa" INTEGER NOT NULL,
    "fecha" DATE NOT NULL,
    "descripcion" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "dia_festivo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "familia_articulo_nombre_key" ON "familia_articulo"("nombre");

-- CreateIndex
CREATE INDEX "articulo_rc_id_familia_articulo_idx" ON "articulo_rc"("id_familia_articulo");

-- CreateIndex
CREATE INDEX "plantilla_ruta_id_familia_articulo_idx" ON "plantilla_ruta"("id_familia_articulo");

-- CreateIndex
CREATE INDEX "plantilla_ruta_id_articulo_rc_idx" ON "plantilla_ruta"("id_articulo_rc");

-- CreateIndex
CREATE INDEX "plantilla_ruta_proceso_id_proceso_def_idx" ON "plantilla_ruta_proceso"("id_proceso_def");

-- CreateIndex
CREATE UNIQUE INDEX "plantilla_ruta_proceso_id_plantilla_ruta_id_proceso_def_key" ON "plantilla_ruta_proceso"("id_plantilla_ruta", "id_proceso_def");

-- CreateIndex
CREATE INDEX "plantilla_ruta_dep_id_antecesor_idx" ON "plantilla_ruta_dep"("id_antecesor");

-- CreateIndex
CREATE INDEX "factor_cantidad_de_cant_a_cant_idx" ON "factor_cantidad"("de_cant", "a_cant");

-- CreateIndex
CREATE UNIQUE INDEX "duracion_tipo_tela_nombre_key" ON "duracion_tipo_tela"("nombre");

-- CreateIndex
CREATE UNIQUE INDEX "duracion_aplicacion_nombre_key" ON "duracion_aplicacion"("nombre");

-- CreateIndex
CREATE UNIQUE INDEX "calendario_empresa_id_empresa_key" ON "calendario_empresa"("id_empresa");

-- CreateIndex
CREATE INDEX "dia_festivo_id_empresa_idx" ON "dia_festivo"("id_empresa");

-- CreateIndex
CREATE UNIQUE INDEX "dia_festivo_id_empresa_fecha_key" ON "dia_festivo"("id_empresa", "fecha");

-- AddForeignKey
ALTER TABLE "articulo_rc" ADD CONSTRAINT "articulo_rc_id_familia_articulo_fkey" FOREIGN KEY ("id_familia_articulo") REFERENCES "familia_articulo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plantilla_ruta" ADD CONSTRAINT "plantilla_ruta_id_familia_articulo_fkey" FOREIGN KEY ("id_familia_articulo") REFERENCES "familia_articulo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plantilla_ruta" ADD CONSTRAINT "plantilla_ruta_id_articulo_rc_fkey" FOREIGN KEY ("id_articulo_rc") REFERENCES "articulo_rc"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plantilla_ruta_proceso" ADD CONSTRAINT "plantilla_ruta_proceso_id_plantilla_ruta_fkey" FOREIGN KEY ("id_plantilla_ruta") REFERENCES "plantilla_ruta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plantilla_ruta_proceso" ADD CONSTRAINT "plantilla_ruta_proceso_id_proceso_def_fkey" FOREIGN KEY ("id_proceso_def") REFERENCES "proceso_def"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plantilla_ruta_dep" ADD CONSTRAINT "plantilla_ruta_dep_id_plantilla_ruta_proceso_fkey" FOREIGN KEY ("id_plantilla_ruta_proceso") REFERENCES "plantilla_ruta_proceso"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plantilla_ruta_dep" ADD CONSTRAINT "plantilla_ruta_dep_id_antecesor_fkey" FOREIGN KEY ("id_antecesor") REFERENCES "plantilla_ruta_proceso"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendario_empresa" ADD CONSTRAINT "calendario_empresa_id_empresa_fkey" FOREIGN KEY ("id_empresa") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dia_festivo" ADD CONSTRAINT "dia_festivo_id_empresa_fkey" FOREIGN KEY ("id_empresa") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
