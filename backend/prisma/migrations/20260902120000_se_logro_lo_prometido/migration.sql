-- ⭐⭐ «¿SE LOGRÓ LO PROMETIDO?» — el SEGUNDO FINAL de una promesa de mesa (§Post-F9.144(b)).
--
-- 🔴 DANIEL, textual: *«me quitan un cierre y yo le pongo que estimo que la maquila costará 5 pesos
-- menos. Esa es mi estimación en ese momento, pero ya en la oficina se tiene que **buscar** una
-- maquila de ese costo con las nuevas características de la prenda… **Todo eso se intentará hacer
-- así, pero no es seguro que se consiga**.»*
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 🔴 EL RE-ENCUADRE, Y ES CONTRAINTUITIVO: un estimado NO es un dato pendiente de CAPTURA
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- Es una **PROMESA pendiente de CUMPLIMIENTO**: un compromiso hacia afuera (ya se le dijo el precio
-- al cliente) y una orden de trabajo hacia adentro. Y por eso tiene **DOS** finales posibles, no
-- uno. La bandeja «Recetas por revisar» (V1-E8r) preguntaba *«¿ya capturaste?»* — binaria, de
-- trámite, con un solo final bueno.
--
-- 🔴 **El estado prohibido que esto mata, con las palabras de la decisión:** *«Desarrollo cuadra la
-- receta con la maquila que sí consiguió, el renglón se va de la bandeja como "resuelto", y **nadie
-- se entera de que el margen que Daniel vendió ya no existe**»*. Un cuadre que sólo puede terminar
-- en «listo» **convierte un incumplimiento en un silencio**.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ⚠️ POR QUÉ NO SE REUSÓ `estado_revision_modelo = 'rechazada'`, que era lo barato
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- Porque `rechazada` YA SIGNIFICA OTRA COSA: *«devuelta con observaciones, corrige la receta»* — la
-- receta está MAL y el renglón VUELVE a la cola. «No se consiguió» es lo contrario: la receta está
-- BIEN, cuadrada y firmada; lo que falló es el COSTO. Reusarla habría (1) mandado a corregir una
-- receta que no tiene nada malo, (2) dejado el renglón dando vueltas en una cola de la que ya no
-- tiene por qué salir, y (3) **tapado el hecho económico con una etiqueta de trámite** — que es
-- exactamente el silencio que esta etapa vino a romper.
--
-- Son DOS EJES, y por eso son columnas aparte: `revision_estado` contesta *«¿alguien miró?»*;
-- `meta_resultado`, *«¿se logró el costo que se vendió?»*. Una versión puede estar `aprobada` **y**
-- `no_lograda` a la vez, y ése es justamente el caso que había que hacer visible.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ⚠️ LA META NO SE INVENTA: YA ESTABA GUARDADA — y se CONGELA, no se lee en vivo
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- `negociacion_evento.costo_estimado` (V1-E8w, §Post-F9.149) es *«la SUMA de los costos estimados
-- con los que se cerró la mesa»*, guardada *«para que el hilo pueda decir: vendí con un costo de
-- $43.00»*. Esta migración **no captura ningún dato nuevo del pasado**: el término de comparación
-- ya existe y el dominio lo resuelve al firmar.
--
-- Se COPIA a `meta_costo_prometido` en vez de leerse por join en cada consulta porque el desenlace
-- es la CONSTANCIA de un acto (D3): una mesa posterior movería hacia atrás una brecha ya declarada.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- Lo que esta migración NO hace
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- • **SIN BACKFILL** (REGLA 0-B, §Post-F9.163): las cuatro columnas nacen en NULL para las 100 % de
--   las filas existentes, y NULL significa **«nadie declaró el desenlace»**. Una versión así se
--   comporta EXACTAMENTE como hoy: sale de la bandeja al firmarse y no aparece en la lista del
--   dueño. Nada que reparar, nada que rellenar.
-- • **SIN permisos nuevos** ⇒ este deploy **NO requiere** `SEED_ON_START`. Declarar el desenlace va
--   pegado a la firma que ya existe (`modelos.aprobar-receta`); la lista del dueño reusa
--   `modelos.ver` + `consultas.ver-importes` (el permiso transversal que ya oculta los importes).
-- • **NO bloquea nada.** Contestar la pregunta es OPCIONAL en el contrato: firmar sin declarar el
--   desenlace sigue funcionando igual que antes. «Avisar no es bloquear» (§Post-F9.64), y la bandeja
--   sigue SIN FIRMAR: LLEVA (§Post-F9.140 punto 4).
-- • 100 % ADITIVA: un enum, cuatro columnas nullable, dos CHECK que ninguna fila existente puede
--   violar (todas nacen en NULL) y un índice parcial.

-- CreateEnum
CREATE TYPE "resultado_meta_negociada" AS ENUM ('lograda', 'no_lograda');

-- AlterTable
ALTER TABLE "modelos" ADD COLUMN     "meta_resultado" "resultado_meta_negociada",
ADD COLUMN     "meta_costo_prometido" DECIMAL(12,2),
ADD COLUMN     "meta_costo_conseguido" DECIMAL(12,2),
ADD COLUMN     "meta_nota" TEXT;

-- 🔒 EL ACTO ES COMPLETO O NO ES: sin resultado declarado no puede quedar colgando ni la meta, ni lo
-- conseguido, ni la nota. Media tupla sería una brecha que NADIE declaró — el mismo criterio con el
-- que las cuatro columnas de la revisión se escriben siempre juntas (V1-E7d).
ALTER TABLE "modelos" ADD CONSTRAINT "modelos_meta_acto_completo_check" CHECK (
  "meta_resultado" IS NOT NULL
  OR ("meta_costo_prometido" IS NULL AND "meta_costo_conseguido" IS NULL AND "meta_nota" IS NULL)
);

-- 🔒 UN «NO SE CONSIGUIÓ» SIN EXPLICACIÓN NO LE SIRVE A NADIE. Es la misma regla que el motivo
-- obligatorio del rechazo: quien lee la brecha tiene que poder saber por qué se abrió.
-- `IS DISTINCT FROM` y no `<>`: con NULL, un `<>` da NULL y el CHECK pasaría por accidente.
ALTER TABLE "modelos" ADD CONSTRAINT "modelos_meta_no_lograda_con_nota_check" CHECK (
  "meta_resultado" IS DISTINCT FROM 'no_lograda' OR "meta_nota" IS NOT NULL
);

-- CreateIndex
-- PARCIAL a propósito: lo que la lista del dueño busca son las poquísimas filas con desenlace
-- declarado, no las ~5,000 del catálogo con la columna en NULL.
CREATE INDEX "modelos_meta_resultado_idx" ON "modelos"("meta_resultado") WHERE "meta_resultado" IS NOT NULL;
