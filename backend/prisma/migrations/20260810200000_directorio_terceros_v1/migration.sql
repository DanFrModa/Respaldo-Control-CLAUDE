-- DIRECTORIO HISTÓRICO DE TERCEROS DEL SISTEMA VIEJO (§Post-F9.28).
--
-- Daniel: *"Al no pasar la información de los maquileros, ¿qué hacemos con la información de ellos
-- si quisiera encontrar algún teléfono o nombre?… ¿Podríamos guardarlo en algún otro repositorio
-- que no sea el catálogo de proveedores?"*
--
-- La depuración (§Post-F9.23) deja fuera del catálogo ~897 de los 1,052 terceros del Access. Eso es
-- lo que se quería —que no estorben al capturar—, pero su teléfono y su dirección siguen sirviendo.
-- Esta tabla es una LIBRETA DE DIRECCIONES aparte: plana, de solo lectura, sin roles, sin `activo`,
-- sin FK a nada, y que NO sale en ningún selector de captura. Si un taller vuelve, se da de alta
-- LIMPIO en el catálogo copiando de aquí lo que sirva — que sea de solo lectura es justo lo que
-- impide que la basura depurada se cuele de vuelta por la puerta de atrás.
--
-- Entran los 1,052 (también los 155 que sobrevivieron, marcados con `en_catalogo`), para que sea la
-- foto completa del Access y nadie tenga que preguntarse en cuál de los dos lados buscar.
--
-- Migración puramente ADITIVA: una tabla nueva.

-- CreateTable
CREATE TABLE "directorio_tercero_v1" (
    "id" SERIAL NOT NULL,
    "fuente" TEXT NOT NULL,
    "id_viejo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "corto" TEXT,
    "razon_social" TEXT,
    "telefono" TEXT,
    "contacto" TEXT,
    "direccion" TEXT,
    "notas" TEXT,
    "servicios" TEXT,
    "ultima_actividad" DATE,
    "documentos" INTEGER NOT NULL DEFAULT 0,
    "en_catalogo" BOOLEAN NOT NULL DEFAULT false,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "directorio_tercero_v1_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "directorio_tercero_v1_nombre_idx" ON "directorio_tercero_v1"("nombre");

-- CreateIndex
CREATE INDEX "directorio_tercero_v1_ultima_actividad_idx" ON "directorio_tercero_v1"("ultima_actividad");

-- CreateIndex
CREATE UNIQUE INDEX "directorio_tercero_v1_fuente_id_viejo_key" ON "directorio_tercero_v1"("fuente", "id_viejo");

