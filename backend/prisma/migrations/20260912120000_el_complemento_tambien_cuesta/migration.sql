-- 0.163 · EL COMPLEMENTO TAMBIÉN CUESTA.
--
-- DANIEL: «El complemento de la tela debe de llevar un costo estimado».
--
-- EL DEFECTO DE DINERO QUE CIERRA: una tela puede llevar COMPLEMENTO (el cárdigan que acompaña a la
-- felpa). El catálogo ya lo declaraba (`telas.nombre_complemento`), la receta ya decía CUÁNTO lleva
-- (`modelo_tela.consumo_complemento_por_prenda`, 0.156) y el MRP ya lo COMPRABA y lo COBRABA
-- (`orden_compra_linea.cantidad_complemento × (precio_complemento ?? precio)`)… pero el COSTEO lo
-- ignoraba por completo: ni el pre-costo, ni el precosto persistido que alimenta la lista de
-- precios, ni el costo teórico de la orden, ni el costo real de compras lo valuaban. Se compraba y
-- no se cobraba, y el precio cotizado al cliente salía BAJO.
--
-- DOS TABLAS, DOS PAPELES:
--   • `telas.precio_sugerido_complemento` — el ESTIMADO del catálogo, gemelo de `precio_sugerido`
--     pero del cárdigan. Es el ÚLTIMO escalón de la cascada del complemento:
--        1. la última compra REAL del complemento (`orden_compra_linea`, mismo criterio de estatus
--           de OC que el cuerpo: autorizada / recibida_parcial / recibida_total),
--        2. el precio por color (`tela_color.precio_complemento`) cuando el llamador tenga color,
--        3. ESTE estimado. Sin ninguno ⇒ «sin precio» explícito; NUNCA un cero mudo.
--     INVARIANTE (la misma que ya protege a `tela_color.precio_complemento`): sólo tiene sentido si
--     la tela declara complemento. El dominio RECHAZA capturarlo cuando no, y lo LIMPIA en la misma
--     transacción cuando se le quita el complemento a la tela.
--   • `precosto_linea.*_complemento` — el DESGLOSE del renglón de tela del precosto persistido. El
--     complemento viaja DENTRO del renglón de su tela, nunca como renglón aparte (la llave de
--     deduplicación del recálculo es `origen:id_tela:id_avio:id_modelo_arte`: un segundo renglón
--     `bom_tela` de la misma tela la rompería). `importe_complemento` ya está SUMADO dentro de
--     `importe`, que es lo que hace que el dinero llegue a la lista de precios sin tocar a ningún
--     consumidor del total (Σ `importe`).
--
-- ADITIVA y NULLABLE: ninguna fila existente se reescribe, no hay backfill y no hay semillas
-- (REGLA 0-B — mientras la versión empiece por `0.`, los datos son desechables; lo viejo se limpia,
-- no se arregla). NULL = no se estimó ⇒ esa tela cae al escalón que siga o queda «sin precio», que
-- es exactamente lo que el sistema hacía antes de esta migración. SIN permisos nuevos ⇒ no depende
-- de `SEED_ON_START`.

-- AlterTable
ALTER TABLE "telas" ADD COLUMN     "precio_sugerido_complemento" DECIMAL(12,2);

-- AlterTable
ALTER TABLE "precosto_linea" ADD COLUMN     "consumo_complemento" DECIMAL(12,4),
ADD COLUMN     "importe_complemento" DECIMAL(12,2),
ADD COLUMN     "precio_unit_complemento" DECIMAL(12,2);
