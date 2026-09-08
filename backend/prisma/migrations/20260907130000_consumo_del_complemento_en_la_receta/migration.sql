-- 0.156 · EL CONSUMO DEL COMPLEMENTO, EN LA RECETA.
--
-- DANIEL (7-sep-2026), §Post-F9.214: «sí es importante meterlo como complemento porque hay
-- proveedores que así lo manejan y para el control de la tela siempre es mejor ponerla como un
-- complemento de su tela». Y antes, §Post-F9.210·6: «Número propio, pero hoy no se ve el campo de
-- la segunda tela para meter la info. Sólo se ve el campo de la tela principal».
--
-- EL HUECO QUE CIERRA: la TELA ya declaraba su complemento (`telas.nombre_complemento`) y la COMPRA
-- ya lo exigía (`orden_compra_linea.cantidad_complemento`; `exigirComplementosCapturados` no deja
-- autorizar sin él), pero la RECETA tenía UN SOLO consumo por tela. Por eso cada OC que generaba la
-- explosión del MRP nacía con el complemento PENDIENTE y alguien lo tecleaba a mano, orden por
-- orden. Y por eso el cárdigan se acababa dando de alta como una tela suelta, rompiendo en silencio
-- el vínculo de LOTE con su felpa (`CLAUDE.md` §5: «doble componente ExTela1/ExTela2 — mismo lote»)
-- justo cuando la 0.142 hizo que el lote viaje.
--
-- SON DOS COLUMNAS PORQUE SON DOS MOMENTOS, y ésa es la única razón:
--   • `modelo_tela`  = la RECETA del modelo (lo que se teclea).
--   • `orden_tela`   = la receta CONGELADA de la orden (V1-E3d). La explosión del MRP lee ésta y
--                      NUNCA el BOM del modelo, así que sin esta segunda columna el número no
--                      llegaría nunca a la orden de compra.
--
-- El consumo del complemento es un NÚMERO PROPIO, no una proporción del cuerpo (§Post-F9.210·6):
-- se teclea, no se deriva. Lo que sí se deriva es la CANTIDAD de la orden de compra, que sale de la
-- razón entre los dos consumos aplicada a lo que esa línea compra de cuerpo (§Post-F9.219).
--
-- ADITIVA y NULLABLE: ninguna fila existente se reescribe, no hay backfill y no hay semillas
-- (REGLA 0-B — mientras la versión empiece por `0.`, los datos son desechables; lo viejo se limpia,
-- no se arregla). NULL = nadie lo capturó ⇒ el sistema se comporta EXACTAMENTE como antes de esta
-- migración: la OC automática nace con el complemento pendiente y `autorizarOC` lo sigue exigiendo.
-- SIN permisos nuevos ⇒ no depende de `SEED_ON_START`.

-- AlterTable
ALTER TABLE "modelo_tela" ADD COLUMN     "consumo_complemento_por_prenda" DECIMAL(12,4);

-- AlterTable
ALTER TABLE "orden_tela" ADD COLUMN     "consumo_complemento_por_prenda" DECIMAL(12,4);
