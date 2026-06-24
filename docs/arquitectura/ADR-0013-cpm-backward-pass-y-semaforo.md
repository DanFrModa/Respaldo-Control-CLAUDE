# ADR-0013 — CPM por backward pass en días hábiles + semáforo de riesgo de la RC (F5-E4)

Estado: aceptado · Fecha: 2026-06-22 · Fase: F5-E4 (motor de la Ruta Crítica, parte 2)

## Contexto

F5-E3 dejó la **ruta viva** de una orden (`RutaOrden` + `RutaOrdenDep` + `RutaOrdenChecklist`) con
las duraciones de cada proceso ya calculadas (`calcularDuracion`), pero **sin fechas**: encolaba un
job pg-boss (`rc-recalcular-ruta`, serializado por orden vía `singletonKey`, ADR-0012) cuyo handler
no existía. F5-E4 monta ese handler (el **CPM**), la **captura del cumplimiento** y el **semáforo**.

El CPM del sistema viejo (`RC_ProgramacionSub.EstablecerLasFechas`, módulo `Funciones RC`) estimaba
un inicio con `FechaHabiles` (entrega − días, con un `÷5` aproximado), hacía un **forward pass**
sumando tiempos y empujando los fines de semana a mano (`CuantosSabYDom`), y si el último proceso se
pasaba de la fecha de entrega de la RC, **nudgeaba el inicio un día hacia atrás y re-calculaba** (la
etiqueta `OtraVez`). Ese lazo iterativo compensaba que su conteo de días hábiles no era exacto.

## Decisiones

### 1. CPM por BACKWARD PASS exacto en días hábiles (no forward + nudge)

El cálculo es una sola pasada hacia atrás desde la fecha de entrega de la RC, usando las funciones
PURAS de `comun/diasHabiles` (festivos + días laborables por empresa):

- El/los proceso(s) **terminal(es)** (sin sucesores) anclan su **fin** en `Orden.fechaEntregaRC`.
- `fin(p) = MIN(inicio(sucesores))`: un proceso debe terminar a más tardar cuando inicia el más
  temprano de sus sucesores.
- `inicio(p) = sumarDiasHabiles(fin(p), -duracionDias)` (retrocede días hábiles; duración 0 ⇒
  `inicio = fin`).
- El **inicio de la ruta** = el inicio más temprano de todos los procesos. Con N antecesores
  convergiendo en un proceso, el que manda el arranque es el más largo (equivale al `MAX` del
  forward pass).
- `acumuladoDias` por proceso = días hábiles `[inicioRuta, fin(p)]` (`contarDiasHabiles`); en el
  terminal = lead time total.

Es **exacto** (no necesita el nudge `OtraVez`) e **idempotente** (re-ejecutar con los mismos datos da
las mismas fechas — requisito para los reintentos del job). El recorrido es en orden topológico
inverso (Kahn); un ciclo imprevisto lanza (defensa en profundidad: el grafo ya se valida acíclico en
`generarRutaOrden`/`ajustarRutaOrden`). La lógica vive en `dominio/ruta-critica/cpm.ts` (PURA,
testeada con tablas a mano) y el wrapper de BD en `cpm-job.ts`.

**Persistencia (idempotencia):** `fechaPlaneadaOriginal` se escribe **solo la primera vez** (snapshot
del primer cálculo); `fechaPlaneadaVigente` y `acumuladoDias` se reescriben **siempre**. El CPM NUNCA
toca `fechaReal`/captura/estado (eso lo maneja la captura). Re-programar conserva la original.

### 2. La RC NO escribe `Orden.fechaEntrega`

Se mantiene la decisión (c) de E3: la RC trabaja con `fechaEntregaRC`/`fechaInicioRC` aparte y NUNCA
pisa la fecha comprometida con el cliente (`Orden.fechaEntrega`). Al completar el último proceso, la
RC se **cierra** (`Orden.rcActiva = false`, equivale a `MatarRC` del viejo) pero **no** sella la
entrega real de la orden: expone la fecha, la orden decide. Revertir el último proceso reabre la RC.

### 3. Captura del cumplimiento y roles N:M

`completarProceso` captura `fechaReal` + quién/cuándo (`origenCaptura='manual'`, base del KPI D11) y
**activa los sucesores** cuyos antecesores quedaron TODOS completados (generaliza `QueActiva` a N
antecesores — "la pelota pasa de mano en mano"). `revertirProceso` desmarca y recalcula el estado.
El checklist auto-completa el proceso al marcar todos sus ítems y lo revierte al desmarcar uno.

**Autorización (A4):** además de `rc.capturar`, quien captura debe tener **alguno de sus roles** entre
los roles RESPONSABLES del proceso (`ProcesoDefRol`, N:M). El admin (`roles.administrar`) captura
cualquier proceso (mismo "marcador admin" que `generaEntradaPt` o la edición de OC autorizada). El
recálculo NO se re-encola al capturar: el cumplimiento no cambia las duraciones.

### 4. Semáforo de riesgo y barrido recurrente

El semáforo (`aTiempo | enRiesgo | atrasado`) es PURO (`semaforoYRiesgo.ts`): compara HOY vs
`fechaPlaneadaVigente`. **Umbral: 3 días naturales** (afina el `+7` "URGENTE" del viejo a la ventana
de aviso del semáforo). Sin `fechaReal` y planeada vencida = atrasado; planeada dentro del umbral =
en riesgo. El semáforo de la **orden** es el peor de sus procesos. Se expone en el GET de la ruta
(por proceso y por orden) y NO se persiste por proceso (es derivado).

Como el semáforo depende de HOY, se recalcula con un **job RECURRENTE** de pg-boss (`rc-barrido-riesgo`,
cron horario por defecto, `RC_RIESGO_CRON`) que barre las órdenes de la RC y actualiza la bandera
`Orden.enRiesgo` (campo conservado de v1). El barrido cubre la regla **"EnRiesgo nace antes de
programar"**: una orden con `fechaEntregaRC` cuya RC aún no se generó entra al barrido evaluada por su
fecha de entrega. El barrido NO toca el servicio de órdenes de F2.

## Consecuencias

- El cliente OpenAPI gana `PUT /ruta-critica/procesos/:idRuta/cumplimiento`, `PUT
  /ruta-critica/checklist/:idItem` y los campos `semaforo` + `estadoRecalculo` (`calculado` |
  `recalculando` | `sin-ruta`, para el indicador "recalculando…" de E5) en el GET de la ruta.
- Permiso nuevo `rc.capturar` (operativo, cascadea como `rc.programar`). El deploy a `prueba`
  requiere `SEED_ON_START=true` para sembrarlo.
- El CPM y el barrido son NO-OP en tests/CI (`JOBS_ACTIVOS=false`): se testea lo PURO (CPM, semáforo)
  sin BD y los wrappers en integración (testcontainers); el transporte pg-boss se valida en Railway.
- La UI (bandeja, timeline, badge, indicador "recalculando…") llega en F5-E5; E4 es solo backend.
