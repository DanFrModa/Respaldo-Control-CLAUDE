-- Almacén de telas ligado a su CORTADOR (§Post-F9.13, petición de Daniel 7-ago-2026):
-- "estaría bien que podamos ligar cada almacén de telas (opcional) a un cortador… cuando
-- seleccionemos a un cortador, automáticamente por default abre la ventana de descarga de tela
-- con el almacén relacionado a ese cortador".
--
-- Aditiva y NULLABLE: los almacenes existentes quedan sin cortador (la liga es opcional y solo
-- tiene sentido en almacenes de TELA — el tipo lo valida el dominio, no la base).
--
-- El índice es UNIQUE a propósito: un cortador tiene a lo más UN almacén. Con dos, la pregunta
-- "¿cuál es el almacén de este cortador?" no tendría respuesta y el default de la descarga sería
-- una moneda al aire. Postgres trata los NULL como distintos, así que los almacenes SIN cortador
-- (la mayoría) conviven sin estorbarse.
--
-- ON DELETE RESTRICT: un proveedor con almacén ligado no se borra físico (igual que el resto de
-- sus ligas; el catálogo usa borrado suave).

ALTER TABLE "almacenes" ADD COLUMN "id_cortador" INTEGER;

CREATE UNIQUE INDEX "almacenes_id_cortador_key" ON "almacenes"("id_cortador");

ALTER TABLE "almacenes"
    ADD CONSTRAINT "almacenes_id_cortador_fkey"
    FOREIGN KEY ("id_cortador") REFERENCES "proveedores"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
