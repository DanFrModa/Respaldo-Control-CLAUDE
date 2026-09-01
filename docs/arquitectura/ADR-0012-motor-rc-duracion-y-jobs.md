# ADR-0012 — Motor de la Ruta Crítica (pt1): fórmula de duración + jobs pg-boss con serialización por orden (F5-E3)

- **Estado:** Aceptado
- **Fecha:** 2026-06-22
- **Decisores:** Gabriel (dueño de la ejecución; firma el diseño antes de codificar) + Daniel
  (negocio: cerró la fórmula de duración el 22-jun). Etapa F5-E3 (motor de la Ruta Crítica, parte 1)
  — `docs/hoja-de-ruta/F5-etapas.md`. Referencias: `Documentacion_MJD/08-Ruta-Critica.md` §2.3/§4,
  D10/D11, A2/A7.

## Contexto

La **Ruta Crítica** (módulo 8, el más importante del sistema, doc 08) es un CPM "hecho a mano" que
en el viejo vivía en `RC_ProgramacionSub` (Access/VBA). F5-E1 modeló el catálogo configurable
(procesos + DAG + checklists); F5-E2, las plantillas, las reglas de duración (factor por cantidad,
días por tela, días por aplicación) y el calendario laboral. **F5-E3 (esta etapa)** construye el
MOTOR pt1: instanciar la **ruta viva por orden** y estimar la **duración** de cada proceso. El
cálculo de FECHAS (CPM forward/backward sobre días hábiles) y el semáforo son **E4**.

Dos decisiones de fondo había que cerrar:

1. **La FÓRMULA de duración.** El viejo la tenía repartida en cuatro funciones VBA
   (`FactCant`, `FactCantAp`, `TelasDias`, `AplicDias`) con números a fuego y **un bug**: `FactCantAp`
   (días por aplicación) **ignoraba el factor de cantidad** (`TiempoSim = TiempoCc`, sin multiplicar).
   Daniel pidió poder ajustar los parámetros (factores, días por tela/aplicación, colchón) **desde la
   pantalla de Reglas de duración de E2 sin re-desplegar**.
2. **Cómo correr el RECÁLCULO sin bloquear la captura.** El CPM (E4) puede ser pesado y dispararse
   por eventos repetidos sobre la misma orden (cada recibo/ajuste). La programación debe **responder
   de inmediato** (§11) y el recálculo correr en segundo plano, **sin que dos recálculos de la misma
   orden se pisen**.

## Decisión

### A) Fórmula de duración (`calcularDuracion`, dominio puro)

Una función única, sin números a fuego (lee TODO de los catálogos en vivo de E2), con cuatro reglas
según `ProcesoDef.tipoDuracion`:

- **`fija`** → `tiempoEstandar` de la plantilla, tal cual.
- **`porCantidad`** → `max(1, round(tiempoEstandar × factorCantidad(cant) + colchonCostura))`. El
  `factorCantidad(cant)` es el `factor` del rango `[deCant, aCant]` de `FactorCantidad` donde cae la
  cantidad total de la orden; si no cae en ninguno, factor **1** + advertencia (igual que el viejo).
  El colchón es `ConfiguracionEmpresa.colchonCostura` (ex `TiempoColchonCostura`).
- **`porTipoTela`** → los **`dias`** del catálogo `DuracionPorTipoTela` del tipo elegido,
  **DIRECTOS**. **NO se multiplica por `factorTela`.**
- **`porAplicacion`** → `max(0, round(diasAplicacion × factorCantidad(cant)))`, con `diasAplicacion` =
  `dias` de `DuracionPorAplicacion` del tipo elegido. **PRENDE el factor de cantidad** que el viejo
  tenía muerto. La columna `DuracionPorAplicacion.factor` **NO se usa**. Si la aplicación es "Sin
  Aplicación" (dias 0) → **0 días** (el proceso se auto-completa al generar).

**Por qué `factorTela` y `DuracionPorAplicacion.factor` NO se multiplican (decisión de Daniel,
22-jun):** ambos se **conservan en el catálogo como referencia**, pero aplicarlos doble-contaría. Los
`dias` por tela ya son el tiempo absoluto de espera de esa tela; multiplicarlos por su propio factor
no tiene sentido de negocio. Para la aplicación, el eje que escala con el volumen es el **factor de
cantidad** (más piezas = más tiempo de estampado/bordado), no un factor propio de la aplicación —
por eso se PRENDE el de cantidad (corrige el ex-bug `FactCantAp`) y se deja `factor` como referencia.

Los **tres ejes** (cantidad / tela / aplicación) NO se combinan en una sola fórmula: cada proceso
declara **un** `tipoDuracion` y se calcula por esa regla. Un proceso de costura escala por cantidad;
uno de "esperar la tela" toma los días de la tela; uno de estampado toma los días de la aplicación
escalados por cantidad. Así el modelo del viejo (un tiempo por proceso×artículo, modulado por un
eje) se respeta sin inventar una multiplicación de tres factores que el negocio no usaba.

### B) Jobs pg-boss con serialización por orden (`comun/jobs`)

Se adopta **pg-boss 12** como motor de jobs en segundo plano, sobre el **mismo Postgres**
(`DATABASE_URL`) — misma decisión de portabilidad que el outbox de eventos (ADR-0011): no se
introduce otro broker; `docker compose up` y Railway no necesitan infra extra. Es una instancia
**separada** de la del relay de eventos (cada una con su ciclo de vida), pero comparten Postgres.

Clave del diseño: **serialización por recurso vía `singletonKey` + la POLÍTICA de la cola**. Cada
job se encola con `singletonKey = "<cola>:<idRecurso>"` (p. ej. `rc-recalcular-ruta:42`), y la cola
declara `policy: 'stately'` en `POLITICA_POR_COLA`.

> ⚠️ **Corrección (0.080b).** Este ADR decía que *«pg-boss garantiza que, para una `singletonKey`
> dada, a lo sumo un job está pendiente/activo; un segundo `send` se descarta»*. **Eso era falso y,
> además, describe justo lo que se decidió NO hacer.** Falso porque `singletonKey` **sola no
> restringe nada**: en una cola con la política por defecto (`standard`) pg-boss guarda la clave y
> acepta todos los `send` —los índices únicos sobre `(name, singleton_key)` sólo existen para
> `short`/`singleton`/`stately`/`exclusive`/`key_strict_fifo`—, y las colas se creaban sin política.
> Y describe otra decisión porque «≤1 entre `created`/`retry`/`active`, el resto se descarta» es la
> política **`exclusive`**, que se rechazó a propósito: descartaría el disparo que llega **mientras**
> se recalcula esa orden, y ese cambio se perdería hasta el siguiente evento.

Lo que rige hoy, medido contra pg-boss 12.20: con **`stately`** (índice `job_i3`, único sobre
`(name, state, singleton_key)` para `state <= 'active'`) hay **≤1 job por estado y clave**, o sea
**≤1 corriendo + ≤1 esperando**. Varios disparos seguidos sobre la misma orden mientras nada corre
**colapsan en uno** (el 2.º `send` devuelve `null`); uno que llega **con un recálculo activo sí se
encola** y corre después, así que el cambio no se pierde (el handler relee la BD: gana el último).
Órdenes distintas nunca se estorban.

**La política no se puede cambiar en caliente:** `createQueue` sobre una cola existente hace
`ON CONFLICT DO NOTHING` (ignora la opción **en silencio**) y `updateQueue` lanza. La única vía es
borrar y recrear la cola —lo hace `conciliarPoliticasColas` al arrancar, sólo cuando lo guardado no
coincide con lo declarado, y dejando constancia en el log de que se perdieron los jobs encolados.

El worker consume **uno a la vez en su proceso** (`localConcurrency: 1`, `batchSize: 1`); lo que vale
**entre instancias** es la política, que la impone la base. La función `claveSerializacion(cola,
idRecurso)` es **pura** y testeable sin BD; sin BD se fija además la política declarada y que pg-boss
la respalde con su índice (leyéndolo de `getConstructionPlans()`). El transporte real —que dos `send`
devuelvan id y `null`— se prueba en integración/Railway.

**Guarda por entorno:** el motor arranca solo si `JOBS_ACTIVOS !== 'false'` y solo desde el entry
point (`servidor.ts`), no en `app.ts` — así los tests con `app.inject()` no requieren pg-boss vivo.
Con el motor inactivo, `encolarJob` es un **NO-OP que devuelve `null`** (nadie se rompe; el recálculo
se re-dispara luego).

### C) Generación de la ruta viva (`generarRutaOrden` / `ajustarRutaOrden`)

- **Omisión de condicionales con reconexión TRANSITIVA.** Un proceso con
  `condicionAplicabilidad = soloSiLlevaAplicacion` se OMITE si la orden no lleva aplicación (la
  aplicación elegida tiene `dias = 0`). Al omitir B, sus sucesores se RECONECTAN a los antecesores
  **vivos** de B, transitivamente (reusa la lógica de grafos de `grafo.ts`). Esto reemplaza el frágil
  decremento `VerifAntecesor` del viejo (que restaba 1 al número de proceso hasta encontrar uno
  existente — rompía con saltos > 1).
- **Duración 0 = auto-completado (ex `TiemposEnCero`).** Todo proceso que quede con `duracionDias = 0`
  (resurtido, "Sin Aplicación", o tiempo 0) se marca `completado` con `fechaReal = fechaInicioRC` y
  `origenCaptura = 'evento'` (lo completó el sistema). En **resurtido**, además, los procesos con
  bandera `esResurtido` se fuerzan a duración 0 (ex `EsResurtidoBoton`).
- **Re-generar permitido, conservando las fechas reales ya capturadas** (mejora vs el bloqueo "Ya
  está programada" del viejo): si un proceso persiste y ya tenía `fechaReal`, se conserva su captura.
- **La RC nunca pisa `Orden.fechaEntrega`** (decisión (c)): trabaja con `fechaEntregaRC` /
  `fechaInicioRC` aparte.
- **Snapshot por orden:** `RutaOrden` congela las banderas del proceso al generar; `RutaOrdenDep` y
  `RutaOrdenChecklist` son copias editables por orden, **sin tocar la plantilla** (D10).

Todo en **una transacción** (A2) con **bitácora** (A7). El recálculo del CPM se ENCOLA **tras el
commit** (fire-and-forget): la captura no espera al job (§11).

## Consecuencias

- **A favor:** un solo lugar para la fórmula de duración, configurable en vivo (Daniel ajusta los
  catálogos sin re-desplegar); se corrige el ex-bug `FactCantAp`; la infra de jobs queda lista y
  reutilizable (E4 monta el worker del CPM, E6 el auto-avance) con serialización por orden de fábrica;
  la ruta viva es snapshot por orden (D11, explotación analítica) y editable sin tocar plantillas
  (D10); re-programar ya no destruye el avance real capturado.
- **En contra / límites:** en E3 las **fechas planeadas quedan en `null`** (estado
  "pendiente-de-calculo"); el CPM real es E4. El motor de jobs comparte Postgres con el relay de
  eventos (dos instancias pg-boss): aceptable (mismo patrón probado en ADR-0011), pero hay que
  recordar cerrarlas ambas en el apagado ordenado. El redondeo usa `Math.round` (no el `CInt`/banker's
  de VBA): para una estimación de planeación es indistinguible y predecible (los ejemplos de la spec
  cuadran).
- **Despliegue:** la etapa agrega los permisos `rc.programar` y `rc.ruta-ver` → el deploy a `prueba`
  necesita `SEED_ON_START=true` para sembrarlos. Migración ADITIVA
  (`20260622140000_f5_e3_ruta_viva_motor`), sin backfill destructivo.
