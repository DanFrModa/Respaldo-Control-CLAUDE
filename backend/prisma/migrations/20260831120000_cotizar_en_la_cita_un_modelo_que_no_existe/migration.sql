-- ⭐ V1-E8y (versión 0.064) — COTIZAR EN LA CITA UN MODELO QUE NO EXISTE (§Post-F9.152).
--
-- Migración ADITIVA. Daniel: *«a veces estando en la cita, me piden cotizar algún modelo que no
-- tengamos en muestrario… Me puedes dejar espacio para meter nuevos modelos y hacerlos ahí con datos
-- estimados»*. Tres piezas de datos nuevas, ninguna destructiva:
--
--  1. `cliente_contacto` — **LA COMPRADORA**. El cliente no guardaba a NADIE: sólo tres campos
--     sueltos en su ficha (`contacto`/`telefono`/`email`), uno por cliente. Es el espejo de
--     `proveedor_contacto`, con la diferencia que decidió Daniel: **el departamento es OPCIONAL**
--     («Laura, compradora de NIÑOS» se distingue; «Carlos, crédito» no necesita departamento
--     inventado). FK a cliente CASCADE (son datos suyos) y a departamento SET NULL (perder el
--     departamento no puede llevarse a la persona).
--     🔴 **NACE VACÍA y así se queda hasta que alguien capture** (REGLA 0-B, §Post-F9.163): los tres
--     campos viejos del cliente NO se migran aquí. No hay backfill, y no hace falta.
--
--  2. `lista_precios.lugar` — dónde fue la cita. Texto libre, NULL, sin default: una lista vieja no
--     tiene lugar y eso no es un hueco por llenar.
--
--  3. `lista_precios_linea_pendiente` — los PENDIENTES **por modelo** («falta muestra de color»,
--     «pedir precio de jareta»). Daniel los quiso por modelo y no por cita. Es la LIBRETA, no la
--     bitácora: el texto se edita y el renglón se borra (con su foto en `bitacora`), a diferencia de
--     `negociacion_evento`, que es inmutable. CASCADE: mueren con su renglón.
--
-- SIN permisos nuevos (`clientes.*` y `listas.*` ya existen) y SIN seed: este deploy NO necesita
-- `SEED_ON_START`.

-- ── 1. Contactos del cliente ────────────────────────────────────────────────────────
CREATE TABLE "cliente_contacto" (
    "id" SERIAL NOT NULL,
    "id_cliente" INTEGER NOT NULL,
    "id_cliente_departamento" INTEGER,
    "nombre" TEXT NOT NULL,
    "puesto" TEXT,
    "telefono" TEXT,
    "email" TEXT,
    "notas" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "cliente_contacto_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "cliente_contacto_id_cliente_idx" ON "cliente_contacto"("id_cliente");
CREATE INDEX "cliente_contacto_id_cliente_departamento_idx" ON "cliente_contacto"("id_cliente_departamento");

ALTER TABLE "cliente_contacto"
  ADD CONSTRAINT "cliente_contacto_id_cliente_fkey"
  FOREIGN KEY ("id_cliente") REFERENCES "clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "cliente_contacto"
  ADD CONSTRAINT "cliente_contacto_id_cliente_departamento_fkey"
  FOREIGN KEY ("id_cliente_departamento") REFERENCES "cliente_departamento"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── 2. El LUGAR de la cita ──────────────────────────────────────────────────────────
ALTER TABLE "lista_precios" ADD COLUMN "lugar" TEXT;

-- ── 3. Pendientes por modelo ────────────────────────────────────────────────────────
CREATE TABLE "lista_precios_linea_pendiente" (
    "id" SERIAL NOT NULL,
    "id_lista_linea" INTEGER NOT NULL,
    "texto" TEXT NOT NULL,
    "resuelto" BOOLEAN NOT NULL DEFAULT false,
    "resuelto_en" TIMESTAMP(3),
    "resuelto_por_id" TEXT,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,
    "modificado_en" TIMESTAMP(3) NOT NULL,
    "modificado_por_id" TEXT,

    CONSTRAINT "lista_precios_linea_pendiente_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "lista_precios_linea_pendiente_id_lista_linea_idx" ON "lista_precios_linea_pendiente"("id_lista_linea");

ALTER TABLE "lista_precios_linea_pendiente"
  ADD CONSTRAINT "lista_precios_linea_pendiente_id_lista_linea_fkey"
  FOREIGN KEY ("id_lista_linea") REFERENCES "lista_precios_linea"("id") ON DELETE CASCADE ON UPDATE CASCADE;
