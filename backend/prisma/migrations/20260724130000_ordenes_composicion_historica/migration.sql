-- Migración de DATOS (no de esquema): protege la composición YA CAPTURADA de las órdenes.
--
-- Contexto: desde `20260724120000_modelo_composicion` la composición de una orden se DERIVA de
-- `modelos.composicion` mientras `ordenes.comp_forzada = false`. Pero:
--   • la columna `modelos.composicion` nació VACÍA (migración aditiva sin backfill), y
--   • todo lo que hay hoy en `ordenes.composicion` viene del ETL de Access (`migracion/loaders/
--     ordenes.ts`, con `comp_forzada = false`) o del importador de OC por PDF de C&A.
-- Con `comp_forzada = false` y un modelo sin composición, el primer guardado del encabezado de esa
-- orden la habría re-derivado a NULL — perdiendo el dato en silencio.
--
-- Decisión: lo que ya está capturado en una orden ES, por definición, un override — nunca derivó
-- de la ficha del modelo (que no existía). Se marca como tal para que la herencia no lo toque.
-- Quien quiera reconectar una orden a la composición de su modelo solo tiene que VACIAR el campo
-- en la pantalla de la orden (eso la vuelve a heredar).
--
-- Idempotente: re-correrla no cambia nada (el WHERE ya no encuentra filas).

UPDATE ordenes
   SET comp_forzada = true
 WHERE composicion IS NOT NULL
   AND comp_forzada = false;
