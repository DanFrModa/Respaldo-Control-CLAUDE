-- V1-E4b — EL TRÁNSITO DE PRENDAS A PROCESO (§Post-F9.59 / §Post-F9.60 / §Post-F9.61)
--
-- El problema, en la frase de Daniel: *"¿de qué manera manejamos los faltantes o segundas?"* Hoy se
-- mandan 100 prendas YA TERMINADAS al estampador, vuelven 95 primeras + 3 segundas y faltan 2 — y el
-- almacén sigue diciendo 100 primeras. No es que esté mal registrado: NO HAY MOVIMIENTO donde
-- registrarlo (el envío no toca el kardex de PT y el recibo solo mete a PT si `genera_entrada_pt`).
--
-- La solución (opción (b) de §Post-F9.60, elegida por Daniel en §Post-F9.61) NO inventa una entidad
-- nueva: el saldo «en proceso» es UN ALMACÉN MÁS, y el traspaso entre almacenes ya existe desde
-- F3-E3 (dos patas salida/entrada, ADR-0010 §1). El almacén ya estaba en el catálogo desde F3-E1
-- ("Tránsito", heredado de `IPT_Almacenes` del viejo): esta migración solo lo marca y le da al
-- ENVÍO los dos datos que le faltaban.
--
-- Todo es ADITIVO y con default: lo que ya existe (envíos históricos migrados de Access y los
-- capturados hasta hoy) nace con `prenda_terminada = false`, que es EXACTAMENTE lo que era — envíos
-- de bultos cortados que no tocan inventario. No hay historia que reconstruir; por eso esta etapa se
-- hace ANTES de que Daniel capture inventario real (§Post-F9.61).
--
--   1. `almacenes.es_transito_proceso` — bandera del almacén de tránsito a proceso externo. El
--      dominio lo resuelve por esta bandera, NUNCA por el nombre. El seed la enciende en "Tránsito"
--      (idempotente) ⇒ el deploy a `prueba` requiere `SEED_ON_START=true`.
--   2. `etapa_movimiento.prenda_terminada` — el envío manda producto TERMINADO (proceso después de
--      costura). Es la propiedad de POSICIÓN que §Post-F9.59 pedía sacar de `TipoProceso`.
--   3. `etapa_movimiento.id_almacen_origen` — de qué almacén de PT salen esas prendas (obligatorio
--      en el dominio cuando `prenda_terminada`, NULL en todo lo demás).
--
-- Índice: solo el de `id_almacen_origen` (FK que se consulta al listar/validar). `prenda_terminada`
-- NO lleva índice: siempre se lee junto a `id_orden`/`id_tipo_proceso`, que ya tienen el suyo.

ALTER TABLE "almacenes"
  ADD COLUMN "es_transito_proceso" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "etapa_movimiento"
  ADD COLUMN "prenda_terminada" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "id_almacen_origen" INTEGER;

ALTER TABLE "etapa_movimiento"
  ADD CONSTRAINT "etapa_movimiento_id_almacen_origen_fkey"
  FOREIGN KEY ("id_almacen_origen") REFERENCES "almacenes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "etapa_movimiento_id_almacen_origen_idx" ON "etapa_movimiento"("id_almacen_origen");
