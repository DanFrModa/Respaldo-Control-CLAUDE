-- CreateEnum
CREATE TYPE "tipo_almacen" AS ENUM ('PT', 'TELA', 'AVIO');

-- CreateEnum
CREATE TYPE "accion_bitacora" AS ENUM ('CREAR', 'MODIFICAR', 'DESACTIVAR', 'CANCELAR', 'OTRO');

-- CreateTable
CREATE TABLE "empresas" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "razon_social" TEXT,
    "identificador" TEXT,
    "upc" TEXT,
    "favorita" BOOLEAN NOT NULL DEFAULT false,
    "para_ipt" BOOLEAN NOT NULL,
    "para_edr" BOOLEAN NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "empresas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "configuraciones_empresa" (
    "id" SERIAL NOT NULL,
    "id_empresa" INTEGER NOT NULL,
    "utilidad_sugerida" DECIMAL(10,4),
    "regalias_base" DECIMAL(10,4),
    "colchon_costura" INTEGER,
    "fecha_inventario_telas" DATE,
    "fecha_inventario_pt" DATE,
    "id_almacen_pt_default" INTEGER,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "configuraciones_empresa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usuarios" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "display_username" TEXT,
    "nombre" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "email_verificado" BOOLEAN NOT NULL DEFAULT false,
    "imagen" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "bloqueado" BOOLEAN NOT NULL DEFAULT false,
    "intentos_fallidos" INTEGER NOT NULL DEFAULT 0,
    "es_auditor" BOOLEAN NOT NULL DEFAULT false,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sesiones" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expira_en" TIMESTAMP(3) NOT NULL,
    "direccion_ip" TEXT,
    "agente_usuario" TEXT,
    "id_usuario" TEXT NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modificado_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sesiones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cuentas" (
    "id" TEXT NOT NULL,
    "id_cuenta" TEXT NOT NULL,
    "id_proveedor" TEXT NOT NULL,
    "id_usuario" TEXT NOT NULL,
    "password" TEXT,
    "token_acceso" TEXT,
    "token_refresco" TEXT,
    "token_id" TEXT,
    "token_acceso_expira_en" TIMESTAMP(3),
    "token_refresco_expira_en" TIMESTAMP(3),
    "scope" TEXT,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modificado_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cuentas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verificaciones" (
    "id" TEXT NOT NULL,
    "identificador" TEXT NOT NULL,
    "valor" TEXT NOT NULL,
    "expira_en" TIMESTAMP(3) NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modificado_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "verificaciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL,
    "es_sistema" BOOLEAN NOT NULL DEFAULT false,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permisos" (
    "id" SERIAL NOT NULL,
    "clave" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL,
    "modulo" TEXT NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "permisos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles_permisos" (
    "id_rol" INTEGER NOT NULL,
    "id_permiso" INTEGER NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,

    CONSTRAINT "roles_permisos_pkey" PRIMARY KEY ("id_rol","id_permiso")
);

-- CreateTable
CREATE TABLE "usuarios_roles" (
    "id_usuario" TEXT NOT NULL,
    "id_rol" INTEGER NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,

    CONSTRAINT "usuarios_roles_pkey" PRIMARY KEY ("id_usuario","id_rol")
);

-- CreateTable
CREATE TABLE "almacenes" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "tipo" "tipo_almacen" NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "id_empresa" INTEGER,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "almacenes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "secuencias" (
    "id" SERIAL NOT NULL,
    "id_empresa" INTEGER NOT NULL,
    "clave" TEXT NOT NULL,
    "valor" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "secuencias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bitacora" (
    "id" BIGSERIAL NOT NULL,
    "entidad" TEXT NOT NULL,
    "id_entidad" TEXT NOT NULL,
    "accion" "accion_bitacora" NOT NULL,
    "datos" JSONB,
    "id_usuario" TEXT,
    "fecha" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bitacora_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "archivos" (
    "id" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "nombre_original" TEXT NOT NULL,
    "tipo_mime" TEXT NOT NULL,
    "tamano_bytes" INTEGER NOT NULL,
    "subido_por_id" TEXT,
    "subido_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "archivos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "empresas_nombre_key" ON "empresas"("nombre");

-- CreateIndex
CREATE UNIQUE INDEX "configuraciones_empresa_id_empresa_key" ON "configuraciones_empresa"("id_empresa");

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_username_key" ON "usuarios"("username");

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_email_key" ON "usuarios"("email");

-- CreateIndex
CREATE UNIQUE INDEX "sesiones_token_key" ON "sesiones"("token");

-- CreateIndex
CREATE INDEX "sesiones_id_usuario_idx" ON "sesiones"("id_usuario");

-- CreateIndex
CREATE INDEX "cuentas_id_usuario_idx" ON "cuentas"("id_usuario");

-- CreateIndex
CREATE UNIQUE INDEX "cuentas_id_proveedor_id_cuenta_key" ON "cuentas"("id_proveedor", "id_cuenta");

-- CreateIndex
CREATE INDEX "verificaciones_identificador_idx" ON "verificaciones"("identificador");

-- CreateIndex
CREATE UNIQUE INDEX "roles_nombre_key" ON "roles"("nombre");

-- CreateIndex
CREATE UNIQUE INDEX "permisos_clave_key" ON "permisos"("clave");

-- CreateIndex
CREATE INDEX "roles_permisos_id_permiso_idx" ON "roles_permisos"("id_permiso");

-- CreateIndex
CREATE INDEX "usuarios_roles_id_rol_idx" ON "usuarios_roles"("id_rol");

-- CreateIndex
CREATE UNIQUE INDEX "almacenes_id_empresa_nombre_key" ON "almacenes"("id_empresa", "nombre");

-- CreateIndex
CREATE UNIQUE INDEX "secuencias_id_empresa_clave_key" ON "secuencias"("id_empresa", "clave");

-- CreateIndex
CREATE INDEX "bitacora_entidad_id_entidad_idx" ON "bitacora"("entidad", "id_entidad");

-- CreateIndex
CREATE UNIQUE INDEX "archivos_key_key" ON "archivos"("key");

-- AddForeignKey
ALTER TABLE "configuraciones_empresa" ADD CONSTRAINT "configuraciones_empresa_id_empresa_fkey" FOREIGN KEY ("id_empresa") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "configuraciones_empresa" ADD CONSTRAINT "configuraciones_empresa_id_almacen_pt_default_fkey" FOREIGN KEY ("id_almacen_pt_default") REFERENCES "almacenes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sesiones" ADD CONSTRAINT "sesiones_id_usuario_fkey" FOREIGN KEY ("id_usuario") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cuentas" ADD CONSTRAINT "cuentas_id_usuario_fkey" FOREIGN KEY ("id_usuario") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles_permisos" ADD CONSTRAINT "roles_permisos_id_rol_fkey" FOREIGN KEY ("id_rol") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles_permisos" ADD CONSTRAINT "roles_permisos_id_permiso_fkey" FOREIGN KEY ("id_permiso") REFERENCES "permisos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usuarios_roles" ADD CONSTRAINT "usuarios_roles_id_usuario_fkey" FOREIGN KEY ("id_usuario") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usuarios_roles" ADD CONSTRAINT "usuarios_roles_id_rol_fkey" FOREIGN KEY ("id_rol") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "almacenes" ADD CONSTRAINT "almacenes_id_empresa_fkey" FOREIGN KEY ("id_empresa") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "secuencias" ADD CONSTRAINT "secuencias_id_empresa_fkey" FOREIGN KEY ("id_empresa") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
