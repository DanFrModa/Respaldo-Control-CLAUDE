-- V1-E7d · LA REVISIÓN ANTES DE MANDAR A PRODUCIR (§Post-F9.110, decisión de Daniel).
--
-- Migración 100 % ADITIVA: un tipo nuevo, cuatro columnas en `modelos` y una llave foránea.
-- No toca ni una fila existente, no borra nada, no cambia ningún default y no crea ningún CHECK
-- que restrinja lo que hoy se puede hacer.
--
-- El QUÉ. V1-E7b dio el mecanismo de VERSIONAR un modelo cuando la negociación mueve la receta
-- (`CYA-26-71-001` → `CYA-26-71-001-01`). Falta la bisagra: el momento en que esa decisión de mesa
-- se vuelve un compromiso de producción. Daniel: *"después de la negociación con el cliente debe
-- de haber una revisión antes de mandar a producir, porque enfrente del cliente puede ser que se
-- cometa una imprudencia o un error"*. Estas columnas guardan esa firma con quién y cuándo (A7).
--
--  1. tipo `estado_revision_modelo`  — pendiente | aprobada | rechazada.
--  2. `modelos.revision_estado`      — en qué quedó el último acto de revisión. NULL = no aplica.
--  3. `modelos.id_revisado_por`      — QUIÉN lo firmó (FK a `usuarios`).
--  4. `modelos.revisado_en`          — CUÁNDO.
--  5. `modelos.revision_nota`        — el motivo del rechazo, o la nota de la aprobación.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. El tipo
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TYPE "estado_revision_modelo" AS ENUM ('pendiente', 'aprobada', 'rechazada');

-- ─────────────────────────────────────────────────────────────────────────────
-- 2-5. Las columnas de la firma
-- ─────────────────────────────────────────────────────────────────────────────
-- ⚠️ SIN backfill y SIN default, a propósito y por partida doble:
--
--   • Los ~4,987 modelos migrados del Access y todo desarrollo normal quedan en NULL, que aquí
--     significa **no aplica**: esta etapa NO le pone una compuerta nueva al catálogo entero, sólo
--     a lo que nació de una negociación. Un default 'pendiente' habría dejado todo el catálogo
--     marcado "sin revisar" —ruido en pantalla y una invitación a ensanchar la regla sin decirlo—.
--
--   • Las VERSIONES que ya existan cuando esto se despliegue (las que estrenó V1-E7b en `prueba`)
--     también quedan en NULL, y para ellas NULL se lee como `pendiente`: nadie las revisó, así que
--     no pueden pasar a producción hasta que alguien las firme. Es la lectura CONSERVADORA — la
--     contraria (backfill a 'aprobada') firmaría en nombre de una persona que nunca las vio.
--
-- Las cuatro se escriben siempre juntas: describen UN acto de revisión. La SECUENCIA de actos no
-- se guarda aquí sino en la bitácora, que se agrega y jamás se edita (D3/A7) — mismo reparto que
-- `lista_precios_linea.aprobado_por_id/aprobado_en` con `negociacion_evento`.
ALTER TABLE "modelos" ADD COLUMN "revision_estado" "estado_revision_modelo";
ALTER TABLE "modelos" ADD COLUMN "id_revisado_por" TEXT;
ALTER TABLE "modelos" ADD COLUMN "revisado_en" TIMESTAMP(3);
ALTER TABLE "modelos" ADD COLUMN "revision_nota" TEXT;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Llave foránea del firmante — RESTRICT
-- ─────────────────────────────────────────────────────────────────────────────
-- El firmante es una RELACIÓN de verdad (y no un `TEXT` suelto como `creado_por_id`) porque la
-- ficha del modelo tiene que decir *"aprobada por Aurora"* con el NOMBRE, no con un cuid, y
-- resolverlo por `include` evita el N+1 del listado. RESTRICT es inofensivo: los usuarios se dan
-- de baja SUAVE (`usuarios.activo`), nunca se borran — y si alguna vez se intentara, borrar a
-- quien firmó una revisión es exactamente lo que no debe poder pasar.
ALTER TABLE "modelos" ADD CONSTRAINT "modelos_id_revisado_por_fkey"
  FOREIGN KEY ("id_revisado_por") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
