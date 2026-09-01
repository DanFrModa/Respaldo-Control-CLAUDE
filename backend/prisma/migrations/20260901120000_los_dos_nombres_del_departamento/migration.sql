-- LOS DOS NOMBRES DEL DEPARTAMENTO: la fusión deja RASTRO de quién se llevó a cada absorbido, para
-- que la BÚSQUEDA entienda el sinónimo sin reescribir el papel del cliente (§Post-F9.172(a)).
--
-- EL PROBLEMA QUE CIERRA. El importador de OC escribe la División DOS VECES: al catálogo CON FK
-- (`resolverOCrearDepartamento`) y como TEXTO CRUDO en `orden_referencia.valor` (D7), que es un
-- `varchar` sin llave. Fusionar «2-HOMBRE» en «Caballeros» (§Post-F9.122(a)) repunta las cinco
-- llaves entrantes del catálogo… y la ORDEN sigue diciendo «2-HOMBRE». Buscar «Caballeros» no la
-- encuentra.
--
-- DANIEL ELIGIÓ NO REESCRIBIR EL TEXTO (§Post-F9.172(a), textual: «Está bien la 3»): el valor
-- capturado del documento del cliente es la única prueba de qué pidió, y reescribirlo es justo lo
-- que `cotizacion.nombre_departamento` se congela a propósito para NO hacer. La búsqueda tiene que
-- entender los dos nombres **porque el sistema sabe que uno se fusionó en el otro**.
--
-- Y ese saber no existía: `Color` tiene `id_fusionado_en` desde V1-E8s, pero
-- `cliente_departamento` sólo tenía `activo` — su fusión repunta bien y deja bitácora, y ahí se
-- acababa el rastro. Esta columna es la que faltaba; la sigue
-- `dominio/catalogos/cliente-departamentos-sinonimos.ts`.
--
-- Migración ADITIVA: una columna nullable + su índice + la FK reflexiva. No borra nada, no cambia
-- ningún default y no restringe nada de lo que hoy se puede hacer. NO requiere `SEED_ON_START`
-- (sin permisos, roles ni catálogos nuevos: la fusión sigue con `clientes.administrar`).
--
-- 🔴 A DIFERENCIA DE LA DE COLORES, **NO TRAE BACKFILL**, y es a propósito (REGLA 0-B de CLAUDE.md,
-- Daniel 30-ago-2026): las fusiones de departamento hechas ANTES de este deploy se quedan sin
-- rastro y **está bien** — el sistema mira hacia adelante y los datos de `prueba` se limpian, no se
-- reparan. La única pregunta válida era «¿funciona bien cuando el dato NO está?», y sí: sin rastro
-- la búsqueda se comporta EXACTAMENTE como hoy (encuentra por el texto literal, nada se rompe).
--
-- 🔑 Consecuencia que vale la pena decir en voz alta: **sin backfill no hay anillos**. El único
-- camino conocido a un ciclo en la columna de colores era su backfill leyendo la bitácora completa;
-- el DOMINIO no puede cerrarlo (la fusión limpia el rastro del canónico, y reactivar a mano lo
-- borra), así que aquí no hace falta el paso ROMPE-CICLOS que aquélla sí necesitó. El recorrido del
-- dominio lleva tope de saltos de todas formas, por si un día otro dato viejo dejara uno.

-- AlterTable
ALTER TABLE "cliente_departamento" ADD COLUMN     "id_fusionado_en" INTEGER;

-- CreateIndex
CREATE INDEX "cliente_departamento_id_fusionado_en_idx" ON "cliente_departamento"("id_fusionado_en");

-- AddForeignKey
ALTER TABLE "cliente_departamento" ADD CONSTRAINT "cliente_departamento_id_fusionado_en_fkey" FOREIGN KEY ("id_fusionado_en") REFERENCES "cliente_departamento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
