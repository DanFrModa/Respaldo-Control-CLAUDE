# ADR-0014 — Existencia de PT por ORDEN de producción (enmienda de ADR-0010)

- **Estado:** Aceptado
- **Fecha:** 2026-06-27
- **Decisores:** Gabriel (dueño de la ejecución). Decisión de negocio de **Daniel** (Q1 de F6-E2,
  registrada en `Documentacion_MJD/DECISIONES.md §F6`): _"el inventario de Producto Terminado debe
  quedar ligado a la orden de producción"_.
- **Enmienda de:** [ADR-0010](ADR-0010-motor-kardex-produccion.md) (motor de kardex genérico). Este
  ADR NO reemplaza al 0010: solo **agrega una dimensión** a la existencia de PT.

## Contexto

ADR-0010 fijó la existencia de PT como `Σ(movimientos)` por **modelo×color×talla×almacén** (vista
`existencia_pt`, validación por suma directa bajo lock). No incluía la orden.

Daniel cerró (F6-E2) que el PT debe quedar **ligado a la orden**: poder ver/operar la existencia por
la orden que produjo esas prendas. El informe de alcance del coder confirmó que **v1 ya lo hacía**:
`IPT_Modelos` llevaba `IdOrdenes` (doc `04-Inventarios.md`); se perdió al aplanar el ETL histórico
por `NumMod`. Esto **restaura comportamiento v1**, no inventa un requisito.

Detonante inmediato: la **reclasificación Primeras↔Segundas** de las auditorías (F6-E2) debe mover
las prendas **de la orden auditada**, no del modelo entero.

## Decisión

1. **La orden es una dimensión MÁS de la existencia de PT.** Se agrega `idOrden` **NULLABLE** al
   detalle `MovimientoDetPt` (no al encabezado genérico `Movimiento`, que es compartido por
   tela/avío). La existencia PT pasa a ser por **modelo×color×talla×ORDEN×almacén**. Va en el detalle
   porque es donde viven las otras dimensiones de existencia (modelo/color/talla) y así la vista, la
   suma directa y el advisory lock se extienden de forma uniforme; el encabezado queda limpio para
   tela/avío.

2. **`idOrden` NULLABLE = bucket "sin orden".** El histórico migrado (`origenTipo='migracion'`), los
   movimientos manuales y los traspasos NO traen orden → caen en un bucket NULL. La suma y el lock
   casan el NULL con `IS NOT DISTINCT FROM` (mismo patrón que `idLote` NULL en tela). Distinguir "PT
   con orden" de "PT sin orden" = `idOrden IS NULL`.

3. **Quién la puebla:**
   - **Recibo de maquila (F3-E4)** y **entrega a cliente (F3-E5)**: la pasan (ya conocen la orden).
     La entrega valida no-negativo **contra el bucket de SU orden**.
   - **Reclasificación de auditoría (F6-E2)**: etiqueta el traspaso con la orden auditada → mueve
     solo lo de esa orden entre Primeras/Segundas.
   - **Movimiento manual / traspaso (F3-E3)** y **ETL histórico (F3-E6)**: `idOrden` NULL.
   - **Cancelación (inverso)**: hereda el `idOrden` del renglón original, para neutralizar el MISMO
     bucket (la existencia por orden no se descuadra).

4. **Backfill en la migración.** Los movimientos de recibo/entrega (y sus cancelaciones) que YA
   estaban en `prueba` se re-etiquetan derivando la orden de su origen (recibo/entrega → la
   `EtapaMovimiento` por `origen_id`; la cancelación → del movimiento original). Manual/traspaso/
   migración quedan NULL. (Lección del repo: columna nueva en tabla ya sembrada ⇒ backfill en la
   migración, no asumir el default.)

5. **Enriquecer el histórico desde `IPT_Modelos.IdOrdenes` queda FUERA de este cambio** (decisión
   futura de Daniel): el histórico se queda en el bucket sin orden por ahora.

## Consecuencias

- La grain de existencia PT cambia: la vista `existencia_pt` agrega `id_orden` y las consultas de
  existencias/kardex (`dominio/inventarios/movimientos-pt.ts`) y sus 4 pantallas muestran la orden
  (bucket sin orden = "histórico/ajuste"). Quien sume PT debe incluir la dimensión orden o agregar
  explícitamente sobre ella.
- La validación "no entregar lo que no existe" es **por orden**: las prendas históricas/manuales
  viven en el bucket sin orden y no se descuentan desde una orden concreta (comportamiento buscado).
- El `cuadre-f3` del ETL (suma por modelo×almacén) NO cambia: agrega sobre todas las órdenes.
- El núcleo de ADR-0010 (D3, suma directa, inverso auditado, genérico PT/tela/avío) se mantiene; la
  dimensión orden aplica **solo a PT** (tela/avío siguen igual).
