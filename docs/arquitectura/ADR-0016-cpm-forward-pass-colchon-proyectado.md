# ADR-0016 — CPM forward pass: colchón proyectado para las alertas predictivas (rediseño R7)

Estado: aceptado · Fecha: 2026-07-08 · Fase: rediseño R7 (tablero "Análisis RC", brecha B14)

## Contexto

El motor de la Ruta Crítica ya calcula, por un **backward pass** exacto en días hábiles
(ADR-0013, `dominio/ruta-critica/cpm.ts:calcularCpm`), la **fecha planeada** de cada proceso a
partir de la fecha de entrega de la RC. Sobre esas fechas planeadas viven el **semáforo** (a tiempo /
en riesgo / atrasado) y el concentrado planeado-vs-real (F5-E7).

El tablero de gestión **Análisis RC** (R7, §4.10 del rediseño) pide una analítica NUEVA que el
backward pass no responde: **alertas predictivas**. Son órdenes que HOY se ven **a tiempo** (ningún
proceso vencido ni por vencer dentro del umbral) pero cuyo **trabajo restante no cabe** antes de la
fecha de entrega — se van a atrasar aunque el semáforo todavía no lo diga. El semáforo mira el pasado
(¿me pasé de la fecha planeada?); esta alerta mira el futuro (¿alcanzo a terminar si arranco hoy?).

## Decisión

### Añadir un FORWARD PASS puro a `cpm.ts` (`proyectarColchonForward`)

Junto al backward pass, se agrega una segunda función PURA (sin Prisma ni sesión, testeable con
tablas a mano) que proyecta el fin de la ruta arrancando el **trabajo restante HOY**:

- Orden topológico (se generalizó `ordenTopologico` para reusarse con la forma de entrada del forward).
- Un proceso **ya completado** ancla su fin proyectado en **HOY**: ya ocurrió, no empuja a sus
  sucesores al futuro (no añade trabajo restante).
- Un proceso **pendiente**: `inicio = MAX(HOY, MAX(fin de sus antecesores))`,
  `fin = sumarDiasHabiles(inicio, +duracionDias)` (forward, con las MISMAS funciones de días hábiles
  del backward pass; duración 0 ⇒ `inicio = fin`).
- `finProyectado` de la ruta = el fin proyectado más tardío (el camino restante más largo).
- **Colchón proyectado** = días hábiles CON SIGNO de `finProyectado` a `fechaEntregaRC`:
  `> 0` sobra holgura · `0` justo · `< 0` no alcanza (va a atrasarse). El tablero marca alerta cuando
  el colchón queda por debajo de un umbral (`UMBRAL_COLCHON_ALERTA`, 3 días hábiles).

### Es una proyección de SOLO LECTURA — NO se persiste

El forward pass **no** escribe `fechaPlaneadaVigente` ni ninguna fecha: la planeación oficial sigue
siendo el backward pass. El colchón se calcula **al vuelo** en el dominio del tablero
(`dominio/ruta-critica/analisisRc.ts`), sobre las órdenes que hoy salen "a tiempo" y tienen fecha de
entrega, cargando los procesos + dependencias + el calendario laboral en consultas acotadas (sin
N+1). Así conviven dos lecturas del mismo grafo sin acoplarse: **backward** = "para llegar a la
entrega, ¿cuándo debía empezar cada proceso?"; **forward** = "si arranco lo que falta hoy, ¿llego?".

## Consecuencias

- **A favor:** una alerta temprana barata (reusa el grafo y el calendario ya existentes), pura y
  unit-testeada (`cpm.test.ts`), sin migración, sin persistencia y sin permisos nuevos.
- **Límite conocido:** el forward pass asume que el trabajo restante arranca HOY en serie según el
  DAG; no modela capacidad/paralelismo de recursos (igual que el backward pass). Es una señal de
  riesgo, no un compromiso de fecha. El umbral del colchón es una constante con nombre claro,
  documentada como configurable a futuro.
- **Reversible:** al no persistir nada, quitar o recalibrar la alerta es cambiar el umbral o dejar de
  llamar a la función; no toca datos.
