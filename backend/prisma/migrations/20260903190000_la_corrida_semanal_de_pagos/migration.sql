-- ⭐ LA CORRIDA SEMANAL DE PAGOS (fila 0.113) + EL CATÁLOGO DE CONCEPTOS QUE NO SON PROVEEDORES
-- (fila 0.125). Decisiones de Daniel en `Documentacion_MJD/DECISIONES.md` §Post-F9.185 y §Post-F9.189.
--
-- Daniel: *«Es una de las pantallas más importantes dentro del sistema. Debe estar muy bien hecha.»*
--
-- Lo que se automatiza: cada semana producción le pasa un Excel de maquilas, él revisa recibo por
-- recibo, DECIDE A MANO cuánto se le paga a cada quien, arma OTRO Excel —una relación CON factura y
-- otra SIN— y se lo manda a finanzas. *«Quiero automatizar todo ese proceso y quitar por completo
-- todos los reportes de Excel.»*
--
-- 🔒 En esta migración NO hay un solo nombre real: los beneficiarios de Daniel son personas físicas
-- y el repositorio es PÚBLICO (fila 0.123). Donde hace falta un ejemplo se usa «TALLER NORTE».
--
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- LAS CUATRO DECISIONES QUE ESTE ESQUEMA SOSTIENE (§Post-F9.189)
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- (a) LA CORRIDA SE GUARDA y son DOS por semana (con factura / sin factura), con ciclo
--     `borrador → cerrada → ejecutada`. *«Debemos de guardar cada corrida … de manera semanal.»*
--     ⇒ `corrida_pago`, con `con_factura` NOT NULL: una corrida es de un segmento o del otro.
-- (b) EL MONTO LO TECLEA ÉL. *«Yo voy decidiendo los montos a pagar de cada uno. Manualmente.»*
--     ⇒ `renglon_corrida_pago.monto` es un campo capturado (CHECK `>= 0`), NO derivado del saldo ni
--     de los recibos. Un renglón en CERO es normal: así nacen los conceptos predeterminados.
-- (c) EFECTIVO O TRANSFERENCIA, default por beneficiario y cambiable en CADA renglón.
--     ⇒ enum `forma_de_pago`, `proveedores.forma_pago_preferida`, `concepto_pago.forma_pago_preferida`
--       y `renglon_corrida_pago.forma_pago` (el que manda).
-- (e) UNA SOLA RELACIÓN, separada por RUBRO. *«Misma relación pero separada por rubro. Así como mi
--     archivo de Excel.»* ⇒ enum `rubro_pago`, copiado a cada renglón.
--
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- 🔑 POR QUÉ EL RENGLÓN GUARDA LA FK **Y** UNA COPIA DE LA CUENTA
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- La promesa de (a) es que reimprimir el martes diga lo mismo que el lunes. Si el renglón sólo
-- apuntara a `proveedor_cuenta_pago`, editar o retirar una cuenta CAMBIARÍA una corrida ya cerrada.
-- Por eso el renglón congela `beneficiario`, `banco`, `tipo_cuenta`, `numero_cuenta`, `alias_cuenta`
-- y `cuenta_es_fiscal`, y conserva además la FK para el cotejo bancario (fila 0.126). Mismo patrón
-- que la receta CONGELADA de la orden.
--
-- ⭐ **EL CONCEPTO ES OBLIGATORIO PODER CAPTURARLO.** La columna `concepto` sale de LEER el archivo
-- real que finanzas arma cada semana: es la explicación del pago, de 30 a 170 caracteres, y sin ella
-- quien ejecuta la transferencia no sabe qué está pagando. `referencia` guarda los folios de las
-- remisiones o recibos que el pago ampara.
--
-- ⭐ **Partir un pago son DOS renglones** (§Post-F9.185(e)): no hay unique por (corrida, proveedor).
-- Los dos renglones se distinguen por su cuenta y su alias. Colapsarlos al imprimir rompería las
-- transferencias.
--
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- REGLA 0-B — LO VIEJO NO SE MIGRA NI SE REPARA
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- `proveedores.forma_pago` (texto libre con la clave del SAT, "03 — Transferencia") SE QUEDA donde
-- está, marcado como superado en el esquema, y **NO hay backfill** hacia `forma_pago_preferida`.
-- Un proveedor sin preferencia y sin cuentas es lo ESPERADO: el renglón lo resuelve solo (sin cuenta
-- ⇒ efectivo). El catálogo de conceptos arranca EN CERO — nunca vivió en Access, vivía en un Excel.
--
-- ⚠️ **REQUIERE `SEED_ON_START=true`** al desplegar: hay CUATRO permisos nuevos
-- (`conceptos-pago.ver`/`.administrar`, `pagos.corrida-ver`/`.corrida-armar`). Sin eso, la pantalla
-- no aparece en `prueba`.
--
-- Migración ADITIVA: cuatro enums y cuatro tablas nuevas, más UNA columna nullable en `proveedores`.
-- No borra nada, no reescribe ninguna fila existente.

-- CreateEnum
CREATE TYPE "forma_de_pago" AS ENUM ('efectivo', 'transferencia');

-- CreateEnum
CREATE TYPE "rubro_pago" AS ENUM ('maquila', 'proveedores', 'nomina', 'servicios', 'caja_chica', 'otros');

-- CreateEnum
CREATE TYPE "estado_corrida_pago" AS ENUM ('borrador', 'cerrada', 'ejecutada');

-- CreateEnum
CREATE TYPE "origen_renglon_pago" AS ENUM ('maquila', 'proveedor', 'concepto');

-- AlterTable
-- Nullable a propósito (REGLA 0-B): los cientos de proveedores migrados no traen preferencia y no
-- hay que inventársela — sin cuenta el renglón sale en efectivo, que es la verdad.
ALTER TABLE "proveedores" ADD COLUMN "forma_pago_preferida" "forma_de_pago";

-- CreateTable
CREATE TABLE "concepto_pago" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "rubro" "rubro_pago" NOT NULL,
    "forma_pago_preferida" "forma_de_pago",
    "predeterminado" BOOLEAN NOT NULL DEFAULT false,
    "notas" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "concepto_pago_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "concepto_pago_nombre_key" ON "concepto_pago"("nombre");

-- CreateIndex
CREATE INDEX "concepto_pago_rubro_idx" ON "concepto_pago"("rubro");

-- ⭐ Los rubros `maquila` y `proveedores` se DERIVAN del proveedor (tiene rol de maquila o no) y no
-- se capturan aquí: un concepto del catálogo jamás cae en esas dos secciones. El dominio lo valida
-- con su mensaje en español; este CHECK es la red de abajo, para que ni un ETL futuro lo cuele.
ALTER TABLE "concepto_pago" ADD CONSTRAINT "concepto_pago_rubro_no_derivado_check"
    CHECK ("rubro" NOT IN ('maquila', 'proveedores'));

-- CreateTable
CREATE TABLE "concepto_pago_cuenta" (
    "id" SERIAL NOT NULL,
    "id_concepto" INTEGER NOT NULL,
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

    CONSTRAINT "concepto_pago_cuenta_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- ⭐ UNA SOLA DEFAULT POR CONCEPTO, garantizada por LA BASE. `es_default` vale `true` en la cuenta
-- por omisión y **NULL** en las demás (nunca `false`): como en Postgres los NULL son distintos entre
-- sí, este unique admite N renglones con NULL y uno solo con `true`. Idéntico a
-- `proveedor_cuenta_pago` (0.112), y por el mismo motivo: Prisma 7 no sabe declarar un índice único
-- PARCIAL, y uno declarado fuera del esquema dejaría `migrate diff` en drift para siempre.
CREATE UNIQUE INDEX "concepto_pago_cuenta_id_concepto_es_default_key" ON "concepto_pago_cuenta"("id_concepto", "es_default");

-- CreateIndex
CREATE UNIQUE INDEX "concepto_pago_cuenta_id_concepto_cuenta_key" ON "concepto_pago_cuenta"("id_concepto", "cuenta");

-- AddForeignKey
ALTER TABLE "concepto_pago_cuenta" ADD CONSTRAINT "concepto_pago_cuenta_id_concepto_fkey" FOREIGN KEY ("id_concepto") REFERENCES "concepto_pago"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "corrida_pago" (
    "id" SERIAL NOT NULL,
    "id_empresa" INTEGER NOT NULL,
    "folio" BIGINT NOT NULL,
    "semana" DATE NOT NULL,
    "con_factura" BOOLEAN NOT NULL,
    "estado" "estado_corrida_pago" NOT NULL DEFAULT 'borrador',
    "notas" TEXT,
    "cerrada_en" TIMESTAMP(3),
    "cerrada_por_id" TEXT,
    "ejecutada_en" TIMESTAMP(3),
    "ejecutada_por_id" TEXT,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "corrida_pago_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "corrida_pago_id_empresa_folio_key" ON "corrida_pago"("id_empresa", "folio");

-- CreateIndex
CREATE INDEX "corrida_pago_id_empresa_semana_idx" ON "corrida_pago"("id_empresa", "semana");

-- CreateIndex
CREATE INDEX "corrida_pago_id_empresa_estado_idx" ON "corrida_pago"("id_empresa", "estado");

-- 🔴 NO hay unique de (empresa, semana, segmento) A PROPÓSITO: una corrida CERRADA no se edita (D3)
-- y se corrige haciendo OTRA. Prohibirlo por la base dejaría a Daniel sin marcha atrás el día que
-- se equivoque. Lo que sí se impide —en el dominio, bajo `pg_advisory_xact_lock`— es tener DOS
-- BORRADORES abiertos del mismo segmento y la misma semana: eso no es una corrección, es un
-- descuido que partiría la relación en dos.

-- AddForeignKey
ALTER TABLE "corrida_pago" ADD CONSTRAINT "corrida_pago_id_empresa_fkey" FOREIGN KEY ("id_empresa") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "renglon_corrida_pago" (
    "id" SERIAL NOT NULL,
    "id_corrida" INTEGER NOT NULL,
    "origen" "origen_renglon_pago" NOT NULL,
    "id_proveedor" INTEGER,
    "id_concepto" INTEGER,
    "rubro" "rubro_pago" NOT NULL,
    "nombre" TEXT NOT NULL,
    "monto" DECIMAL(14,2) NOT NULL,
    "forma_pago" "forma_de_pago" NOT NULL,
    "id_cuenta_proveedor" INTEGER,
    "id_cuenta_concepto" INTEGER,
    "beneficiario" TEXT NOT NULL,
    "banco" TEXT,
    "tipo_cuenta" "tipo_cuenta_pago",
    "numero_cuenta" TEXT,
    "alias_cuenta" TEXT,
    "cuenta_es_fiscal" BOOLEAN,
    "concepto" TEXT,
    "referencia" TEXT,
    "id_pago_maquilero" INTEGER,
    "id_movimiento_tercero" INTEGER,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "renglon_corrida_pago_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "renglon_corrida_pago_id_corrida_idx" ON "renglon_corrida_pago"("id_corrida");

-- CreateIndex
CREATE INDEX "renglon_corrida_pago_id_proveedor_idx" ON "renglon_corrida_pago"("id_proveedor");

-- CreateIndex
CREATE INDEX "renglon_corrida_pago_id_concepto_idx" ON "renglon_corrida_pago"("id_concepto");

-- ⭐ EXCLUSIVIDAD DEL BENEFICIARIO, atada al `origen` (mismo patrón que el CHECK de
-- `movimientos_tercero`, ADR-0017). Un renglón es de un proveedor o de un concepto, nunca de los dos
-- ni de ninguno, y el `origen` tiene que decir cuál — si no, la sección de la relación y el
-- movimiento que nace al ejecutar se pueden contradecir.
ALTER TABLE "renglon_corrida_pago" ADD CONSTRAINT "renglon_corrida_pago_beneficiario_check"
    CHECK (
        ("origen" IN ('maquila', 'proveedor') AND "id_proveedor" IS NOT NULL AND "id_concepto" IS NULL)
        OR ("origen" = 'concepto' AND "id_concepto" IS NOT NULL AND "id_proveedor" IS NULL)
    );

-- La cuenta destino es UNA sola (o ninguna, si es efectivo), y del mismo lado que el beneficiario.
ALTER TABLE "renglon_corrida_pago" ADD CONSTRAINT "renglon_corrida_pago_cuenta_check"
    CHECK (
        ("id_cuenta_proveedor" IS NULL OR "id_cuenta_concepto" IS NULL)
        AND ("id_cuenta_proveedor" IS NULL OR "id_proveedor" IS NOT NULL)
        AND ("id_cuenta_concepto" IS NULL OR "id_concepto" IS NOT NULL)
    );

-- El monto lo teclea Daniel y puede ser CERO (un renglón a la vista que esta semana no se paga),
-- pero nunca negativo: un pago negativo sería un cargo disfrazado, y ésos tienen su propio camino.
ALTER TABLE "renglon_corrida_pago" ADD CONSTRAINT "renglon_corrida_pago_monto_check"
    CHECK ("monto" >= 0);

-- EFECTIVO NO LLEVA CUENTA, y una transferencia sin número de cuenta no se puede hacer. El número
-- va con su tipo (CLABE o tarjeta): los dos o ninguno.
ALTER TABLE "renglon_corrida_pago" ADD CONSTRAINT "renglon_corrida_pago_forma_pago_check"
    CHECK (
        (
            "forma_pago" = 'efectivo'
            AND "id_cuenta_proveedor" IS NULL AND "id_cuenta_concepto" IS NULL
            AND "numero_cuenta" IS NULL AND "tipo_cuenta" IS NULL
        )
        OR (
            "forma_pago" = 'transferencia'
            AND "numero_cuenta" IS NOT NULL AND "tipo_cuenta" IS NOT NULL
        )
    );

-- El movimiento que nace al EJECUTAR es UNO solo y del lado que corresponde: un renglón de maquila
-- produce un `pago_maquilero`; uno de proveedor, un `movimientos_tercero`; uno de concepto, ninguno
-- (un concepto no tiene cuenta corriente). Es la red de abajo de la idempotencia: un renglón paga
-- UNA vez.
ALTER TABLE "renglon_corrida_pago" ADD CONSTRAINT "renglon_corrida_pago_movimiento_check"
    CHECK (
        ("id_pago_maquilero" IS NULL OR "origen" = 'maquila')
        AND ("id_movimiento_tercero" IS NULL OR "origen" = 'proveedor')
    );

-- CreateIndex
-- ⭐ ÍNDICES DE LAS FKs `RESTRICT` (R5 de la revisión). Sin ellos, cada intento de borrar o de
-- comprobar una cuenta de pago, un pago EsMa o un movimiento de CxP obliga a Postgres a un SEQ SCAN
-- de esta tabla, que crece una vez por semana y para siempre. Los de `id_corrida`/`id_proveedor`/
-- `id_concepto` ya los declara el esquema; éstos cierran los cuatro que faltaban.
CREATE INDEX "renglon_corrida_pago_id_cuenta_proveedor_idx" ON "renglon_corrida_pago"("id_cuenta_proveedor");
CREATE INDEX "renglon_corrida_pago_id_cuenta_concepto_idx" ON "renglon_corrida_pago"("id_cuenta_concepto");

-- CreateIndex
-- ⭐⭐ UNIQUE, no un índice cualquiera: es la DEFENSA DE LA IDEMPOTENCIA en la base. Un renglón paga
-- UNA vez, y su movimiento es suyo y de nadie más. El dominio ya lo impide (sólo una corrida
-- `cerrada` se ejecuta, y al terminar queda `ejecutada`), pero si algún día un reintento o una
-- carrera hiciera nacer dos renglones apuntando al MISMO pago, la base lo rechaza en vez de dejar
-- el dinero contado dos veces. En Postgres los NULL son distintos entre sí, así que los miles de
-- renglones sin ejecutar (NULL) conviven sin estorbarse.
CREATE UNIQUE INDEX "renglon_corrida_pago_id_pago_maquilero_key" ON "renglon_corrida_pago"("id_pago_maquilero");
CREATE UNIQUE INDEX "renglon_corrida_pago_id_movimiento_tercero_key" ON "renglon_corrida_pago"("id_movimiento_tercero");

-- AddForeignKey
ALTER TABLE "renglon_corrida_pago" ADD CONSTRAINT "renglon_corrida_pago_id_corrida_fkey" FOREIGN KEY ("id_corrida") REFERENCES "corrida_pago"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "renglon_corrida_pago" ADD CONSTRAINT "renglon_corrida_pago_id_proveedor_fkey" FOREIGN KEY ("id_proveedor") REFERENCES "proveedores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "renglon_corrida_pago" ADD CONSTRAINT "renglon_corrida_pago_id_concepto_fkey" FOREIGN KEY ("id_concepto") REFERENCES "concepto_pago"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "renglon_corrida_pago" ADD CONSTRAINT "renglon_corrida_pago_id_cuenta_proveedor_fkey" FOREIGN KEY ("id_cuenta_proveedor") REFERENCES "proveedor_cuenta_pago"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "renglon_corrida_pago" ADD CONSTRAINT "renglon_corrida_pago_id_cuenta_concepto_fkey" FOREIGN KEY ("id_cuenta_concepto") REFERENCES "concepto_pago_cuenta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "renglon_corrida_pago" ADD CONSTRAINT "renglon_corrida_pago_id_pago_maquilero_fkey" FOREIGN KEY ("id_pago_maquilero") REFERENCES "pago_maquilero"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "renglon_corrida_pago" ADD CONSTRAINT "renglon_corrida_pago_id_movimiento_tercero_fkey" FOREIGN KEY ("id_movimiento_tercero") REFERENCES "movimientos_tercero"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
