-- ════════════════════════════════════════════════════════════════════════════════════════════
-- Fila 0.251 · LA LLAVE DE VENTAS: `ventas.ver`, partida de `edr.ver` (§Post-F9.260(b) de
-- Documentacion_MJD/DECISIONES.md)
-- ════════════════════════════════════════════════════════════════════════════════════════════
--
-- POR QUÉ EXISTE:
--   Daniel le negó `edr.ver` a «Administración y Finanzas» por su regla del dinero: esa llave abre
--   el estado de resultados entero (costo actual, utilidad bruta). Pero también era la ÚNICA puerta
--   de la pantalla Ventas (facturación por modelo), que sólo enseña lo facturado —cantidad, precio
--   de venta, importe—, sin costo ni margen. La 0.251 le da a Ventas su llave propia para poder
--   darla SIN el EDR. `edr.ver` la sigue abriendo (el código acepta cualquiera de las dos).
--
-- QUÉ HACE: a TODO rol que hoy lleva `edr.ver` le AGREGA `ventas.ver`. Así quitarle después el EDR
--   a un rol desde Administración › Roles ya no le quita la facturación. Nadie la gana ni la pierde:
--   la tienen exactamente los que tenían `edr.ver` (los de sistema, que el seed re-sincroniza y ya la
--   declaran, y cualquier rol que el dueño haya armado en pantalla con `edr.ver`, que el seed NO toca).
--   ⚠️ NO se la da a nadie más —en particular no a «Administración y Finanzas»—: darla es decisión
--   de Daniel. Esta migración sólo la hace posible.
--
-- POR QUÉ CREA LA FILA DEL PERMISO: en `prueba` las migraciones corren ANTES del seed, y el seed es
--   quien siembra el catálogo; sin esto `ventas.ver` no existiría todavía y no habría a quién darla.
--   Sólo se crea si `edr.ver` ya existe (base con catálogo sembrado); el seed después hace `upsert`
--   por clave y deja descripción y módulo iguales a `src/contrato/permisos.ts`.
--   • Base NUEVA (CI, producción): no hay `edr.ver` ⇒ no crea nada, cero filas, sin error. El seed
--     crea el catálogo y los roles ya con `ventas.ver`.
--
-- ES ADITIVA: sólo AGREGA, nunca quita ni modifica (ni la fila del rol, ni otras llaves).
-- Idempotente: `ON CONFLICT DO NOTHING` en las dos tablas.
--
-- UNA SOLA SENTENCIA, A PROPÓSITO: las CTE que modifican datos no ven lo que inserta otra CTE de la
--   misma sentencia, por eso el id de la llave sale del `RETURNING` (si es nueva) UNIDO a la fila
--   que ya existiera (si la migración se repite), y la bitácora escribe la clave literal en vez de
--   leerla de `permisos`.
--
-- RASTRO (A7): una entrada de bitácora por rol al que EFECTIVAMENTE se le agregó, `id_usuario` NULL
--   (la escribe el despliegue, no una persona), igual que `20261003120000_las_11_llaves_de_daniel`.
-- ════════════════════════════════════════════════════════════════════════════════════════════

WITH "llave_edr" AS (
  SELECT "id" FROM "permisos" WHERE "clave" = 'edr.ver'
),
"llave_nueva" AS (
  INSERT INTO "permisos" ("clave", "descripcion", "modulo", "modificado_en")
  SELECT 'ventas.ver',
         'Consultar las ventas facturadas por modelo y cliente (cantidad, precio e importe; sin costo ni utilidad)',
         'ventas',
         CURRENT_TIMESTAMP
   WHERE EXISTS (SELECT 1 FROM "llave_edr")
  ON CONFLICT ("clave") DO NOTHING
  RETURNING "id"
),
"llave_ventas" AS (
  SELECT "id" FROM "llave_nueva"
  UNION ALL
  SELECT "id" FROM "permisos" WHERE "clave" = 'ventas.ver'
),
"insertadas" AS (
  INSERT INTO "roles_permisos" ("id_rol", "id_permiso")
  SELECT rp."id_rol", v."id"
    FROM "roles_permisos" rp
    JOIN "llave_edr" e ON e."id" = rp."id_permiso"
   CROSS JOIN "llave_ventas" v
  ON CONFLICT ("id_rol", "id_permiso") DO NOTHING
  RETURNING "id_rol"
)
INSERT INTO "bitacora" ("entidad", "id_entidad", "accion", "datos", "id_usuario")
SELECT 'Rol',
       i."id_rol"::text,
       'MODIFICAR'::"accion_bitacora",
       jsonb_build_object(
         'operacion', 'agregarPermisos',
         'nombre', r."nombre",
         'clavesAgregadas', jsonb_build_array('ventas.ver'),
         'motivo', 'fila 0.251 · Ventas con llave propia, partida de edr.ver §Post-F9.260(b)',
         'migracion', '20261006120000_la_llave_de_ventas'
       ),
       NULL
  FROM "insertadas" i
  JOIN "roles" r ON r."id" = i."id_rol";
