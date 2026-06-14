# ADR-0009 — Catálogos de materiales (F1-E3): telas unificadas, avíos NULLABLE y fallback de precio

- **Estado:** Aceptado
- **Fecha:** 2026-06-14
- **Decisores:** Gabriel (dueño de la ejecución; firma las 3 decisiones de diseño de F1-E3 antes de congelar el esquema — `docs/hoja-de-ruta/F1-etapas.md` §F1-E3)

## Contexto

F1-E3 construye los tres catálogos complejos que alimentan el BOM (telas, avíos, bordados).
La ficha de la etapa exige cerrar con Gabriel **tres decisiones de diseño ANTES de congelar
el esquema**, porque condicionan tanto la forma de las tablas como el ETL de carga histórica
(F1-E6) y el costeo (F7): el criterio de unificación de telas, el tratamiento de los campos
nuevos de avíos que el sistema viejo no tiene, y qué hacer con el precio histórico de un avío
cuando su proveedor no es identificable. Decidirlas aquí evita descubrirlas en E6.

## Decisión

1. **Telas unificadas (D5):** una **sola entidad `Tela`** sirve a la vez al BOM (ex `TelasDis`)
   y al inventario (ex `Telas`) — corrige la dualidad del viejo. **Por qué:** la tela del BOM y
   la del inventario son el MISMO objeto físico; tenerlas separadas obligaba a sincronizar dos
   catálogos y ambiguaba el costeo. El mapeo `Telas`/`TelasDis` → `Tela` lo ejecuta el ETL de
   E6 (no este esquema). `Tela` queda diseñada para que `Lote`/`LoteComponente` de F4 cuelguen
   de ella sin retocarla.
2. **`Avio.unidad` y `Avio.presentacion` son NULLABLE en BD:** son campos NUEVOS (el viejo
   `Habilitacion` no los tiene). **Por qué:** son obligatorios solo en altas nuevas por la UI
   (lo valida el dominio/Zod del formulario), pero deben ser NULLABLE en la base para que el
   ETL de E6 pueda cargar los **629 avíos históricos** sin esos datos. La validación de captura
   es de UI, no de esquema — así no se rompe ninguna fila migrada.
3. **Fallback de precio de avíos = `Avio.precioReferencia Decimal?`:** un campo en el propio
   avío, NO un proveedor sintético "(por confirmar)". **Por qué:** `Habilitacion.csv` trae el
   precio actual por avío, pero ese precio solo puede migrar a `AvioProveedor` cuando el
   proveedor (texto libre) tiene match; para los no-mapeados el precio **no se puede perder**
   (es insumo del costeo, 01-Modelos §5). Un campo de referencia en el avío es más simple y
   limpio que ensuciar el catálogo de proveedores con un registro ficticio. El ETL de E6
   ejecuta este fallback.

## Consecuencias

- (+) BOM e inventario comparten catálogo de telas → sin doble captura ni ambigüedad de costeo
  (F4/F7 cuelgan de `Tela` directamente).
- (+) El ETL de E6 carga los 629 avíos históricos sin tropezar con `unidad`/`presentacion`
  faltantes, y ningún precio histórico se pierde (cae en `precioReferencia` si no hay match).
- (+) El catálogo de proveedores queda limpio (sin un "(por confirmar)" artificial que luego
  habría que depurar).
- (−) La obligatoriedad de `unidad`/`presentacion` vive en la UI/dominio, no en la BD: el
  reviewer debe verificar que el formulario las exige (condición para que el ETL no truene).
  **Asumido** y documentado en el TSDoc de `Avio`.

## Riesgo menor anotado para E6

`Bordado.nombre` es `@unique` (catálogo limpio en v2). Si la tabla vieja trae bordados con
nombres **duplicados**, la migración no podrá insertarlos tal cual: el **ETL de E6 los
desambigua** (sufijo/clave) **o los manda a reporte** para revisión manual (mismo patrón que
la dedup de maquileros homónimos de E2 y la fusión de colores, plan §7 / ADR-0007). Igual
criterio aplica a `Tela.nombre` y `Avio.clave` (`@unique`).

## Alternativas consideradas

- **Telas separadas (mantener `Telas` y `TelasDis`):** fiel al viejo, pero arrastra su defecto
  (doble catálogo a sincronizar). Descartada — D5 unifica.
- **`unidad`/`presentacion` NOT NULL con valor por defecto en el ETL:** mete datos inventados
  en filas históricas. Descartada — preferimos NULL honesto + validación de captura.
- **Proveedor sintético "(por confirmar)" para el precio sin match:** ensucia el catálogo de
  proveedores y exige depuración posterior. Descartada en favor de `precioReferencia`.

## Vuelta atrás

Las tres son reversibles con migraciones aditivas/seguras: si algún día se quisiera separar
telas, se agregaría una bandera/tabla sin perder datos; volver `unidad`/`presentacion` NOT
NULL exigiría primero rellenarlas (no se hará hasta que el negocio lo pida); y `precioReferencia`
puede vaciarse una vez que todos los avíos tengan proveedor con precio.

## Referencias cruzadas

- `docs/hoja-de-ruta/F1-etapas.md` §F1-E3 (alcance, las 3 decisiones y el criterio de cierre).
- `Documentacion_MJD/DECISIONES.md` D5; `REQUISITOS-NUEVOS.md` R1 (avíos por proveedor) y R4
  (genéricos / Make-to-Order); `Documentacion_MJD/01-Modelos.md` §2 y §5; `04-Inventarios.md`
  §B.1–B.2.
- ADR-0007 (catálogos globales) y ADR-0008 (schema único + protocolo de integración).
- `backend/prisma/schema.prisma`, sección "Catálogos de MATERIALES (F1-E3)".
