-- ⭐ LAS CUENTAS DEL PROVEEDOR: EL BENEFICIARIO Y SUS VARIAS CUENTAS (0.112).
--
-- 🔴 Esto NO salió de una entrevista: salió de LEER el Excel con el que Daniel paga cada semana
-- (~150 beneficiarios). Dos cosas saltaron del archivo y ninguna cabía en el modelo viejo:
--
-- 🔒 **Los nombres de este comentario («TALLER NORTE 1/2/3», «TALLER PONIENTE», «TALLER SUR») son
-- INVENTADOS.** Los reales son proveedores PERSONA FÍSICA y este repositorio es PÚBLICO: un alias
-- pegado a información de pago es dato personal (fila 0.123). El caso se cuenta igual de bien sin
-- ellos — **no los "restaures" nunca.**
--
--   1. **El BENEFICIARIO casi nunca es el proveedor.** El renglón «TALLER NORTE 1» se deposita a
--      OTRA persona; «TALLER PONIENTE» y «TALLER SUR», igual. `Proveedor` no tenía dónde guardarlo.
--   2. **«TALLER NORTE 1 / 2 / 3» no son tres proveedores: es UNO con TRES cuentas**, partido en
--      tres renglones porque Excel no sabe modelar otra cosa. Daniel, textual: *«Estaría bien poder
--      tener más de una cuenta, definir una como default, pero tener las demás como historial de
--      cuentas, para poder reutilizarlas.»*
--
-- Y la marca fiscal, también textual: *«Tendría una cuenta Fiscal, y podría tener más de una cuenta
-- no fiscal.»* `es_fiscal` habilita la guarda de que un pago CON factura sólo salga a una cuenta
-- fiscal (si sale a la cuenta personal de alguien, el pago y el comprobante dejan de corresponder).
-- Esa guarda la construye la fila que pague; aquí sólo nace la marca.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 🔑 POR QUÉ `es_default` ES NULLABLE Y NO UN ÍNDICE ÚNICO PARCIAL — es la decisión de modelado
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- «Una sola default por proveedor» la tiene que sostener LA BASE, no sólo la aplicación. La forma
-- obvia sería `CREATE UNIQUE INDEX ... WHERE es_default`, pero **Prisma 7 no sabe expresar un
-- índice parcial**: quedaría fuera de `schema.prisma` y el `migrate diff` marcaría drift para
-- siempre (exactamente el motivo por el que se descartó `UNIQUE NULLS NOT DISTINCT` en la migración
-- del pack, 20260902190000).
--
-- La salida que SÍ cabe en el esquema: `es_default` vale `true` en la cuenta por omisión y **NULL**
-- en todas las demás (nunca `false`). Como en Postgres **los NULL son distintos entre sí**, el
-- `UNIQUE (id_proveedor, es_default)` admite N renglones con NULL y **uno solo** con `true` por
-- proveedor. La garantía es REAL, y el esquema declara la verdad.
--
-- ⚠️ Al leerlo, siempre `es_default = true` / `esDefault === true`: aquí el "no" se escribe NULL.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- REGLA 0-B — LO VIEJO NO SE MIGRA
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- `proveedores.banco` y `proveedores.clabe` SE QUEDAN donde están, marcados como superados en el
-- esquema. **NO hay backfill**: nadie convierte esos datos en cuentas. Un proveedor sin cuentas es
-- lo ESPERADO y no rompe nada (la ficha simplemente no muestra sección de cuentas). Daniel captura
-- las cuentas reales el día de la migración a producción — *«lo viejo se tira, no se arregla»*.
--
-- Migración ADITIVA: una tabla y un enum nuevos. No toca ninguna tabla existente, no borra nada y
-- no necesita `SEED_ON_START` (no hay permisos nuevos: se gobierna con `proveedores.ver` /
-- `proveedores.administrar`, que ya existen).

-- CreateEnum
CREATE TYPE "tipo_cuenta_pago" AS ENUM ('clabe', 'tarjeta');

-- CreateTable
CREATE TABLE "proveedor_cuenta_pago" (
    "id" SERIAL NOT NULL,
    "id_proveedor" INTEGER NOT NULL,
    "beneficiario" TEXT NOT NULL,
    "banco" TEXT,
    "tipo_cuenta" "tipo_cuenta_pago" NOT NULL,
    "cuenta" TEXT NOT NULL,
    "alias" TEXT,
    "es_fiscal" BOOLEAN NOT NULL DEFAULT false,
    "es_default" BOOLEAN,
    "notas" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "proveedor_cuenta_pago_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- ⭐ UNA SOLA DEFAULT POR PROVEEDOR (ver el bloque de arriba: los NULL son distintos entre sí).
CREATE UNIQUE INDEX "proveedor_cuenta_pago_id_proveedor_es_default_key" ON "proveedor_cuenta_pago"("id_proveedor", "es_default");

-- CreateIndex
-- La misma cuenta no se captura dos veces en el mismo proveedor (entre proveedores sí puede
-- repetirse: dos talleres que cobran a la misma persona).
CREATE UNIQUE INDEX "proveedor_cuenta_pago_id_proveedor_cuenta_key" ON "proveedor_cuenta_pago"("id_proveedor", "cuenta");

-- AddForeignKey
ALTER TABLE "proveedor_cuenta_pago" ADD CONSTRAINT "proveedor_cuenta_pago_id_proveedor_fkey" FOREIGN KEY ("id_proveedor") REFERENCES "proveedores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
