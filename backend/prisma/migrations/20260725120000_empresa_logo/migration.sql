-- LOGO de la empresa (post-F9, petición de Daniel 25-jul-2026).
--
-- Un solo archivo en R2 por empresa que brandea TODO: los 23 impresos PDF (vía
-- `EncabezadoDocumento`, un único punto) y la app (riel + login). Se sube desde
-- Administración › Empresas y se actualiza en caliente, sin desplegar.
--
-- Mismo patrón que `Bordado.archivoFoto`: columna @unique (un archivo es el logo de UNA
-- empresa) con FK a `archivos` y ON DELETE SET NULL — quitar el logo = borrar su `Archivo`,
-- y la FK deja la columna en NULL sin dejar registros huérfanos. Aditiva y nullable: las
-- empresas existentes quedan en NULL y caen al logo empaquetado en el repo.

-- AlterTable
ALTER TABLE "empresas" ADD COLUMN     "id_archivo_logo" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "empresas_id_archivo_logo_key" ON "empresas"("id_archivo_logo");

-- AddForeignKey
ALTER TABLE "empresas" ADD CONSTRAINT "empresas_id_archivo_logo_fkey" FOREIGN KEY ("id_archivo_logo") REFERENCES "archivos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
