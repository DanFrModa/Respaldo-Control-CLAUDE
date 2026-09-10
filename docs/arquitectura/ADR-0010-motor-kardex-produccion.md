# ADR-0010 — Motor de kardex genérico y modelo de datos de Producción (F3-E1)

- **Estado:** Aceptado (enmendado por [ADR-0014](ADR-0014-pt-por-orden.md): la existencia de PT
  agrega la dimensión ORDEN, `MovimientoDetPt.idOrden` NULLABLE — F6-E2).
- **Fecha:** 2026-06-17
- **Decisores:** Gabriel (dueño de la ejecución; firma el diseño del esquema/ADR ANTES de codificar
  el motor — `docs/hoja-de-ruta/F3-etapas.md` §F3-E1, regla de los 2 reviewers de PLANMAESTRO §9.1).
  Decisiones de negocio (d) y (e) en `Documentacion_MJD/DECISIONES.md`.

## Contexto

F3 (Producción/WIP) construye el corte, los envíos/recibos de maquila unificada, el recibo
transaccional (WIP + inventario PT + cargo EsMa), el inventario PT y las entregas a cliente. Todo
eso se apoya en un **motor de kardex** que NO existe aún (verificado: no hay `kardex.ts` ni modelos
`Movimiento`/`MovimientoDet` en el repo). F3-E1 crea en **una sola migración** el modelo de datos de
TODA la fase y el motor en `comun/`.

Restricciones que fija el plan:

- **D3** — la existencia es SIEMPRE la suma de movimientos (kardex); nunca una existencia editable.
- **D4** — todo el WIP y el inventario PT van por color×talla (tallas ilimitadas, filas no columnas).
- **D5 / R4** — el kardex es ÚNICO para PT, **tela** (×lote, N acompañantes) y **avío** (×lote
  opcional, `esGenerico`), aunque F3 solo ejercite PT. F4 debe poder agregar tela/avío **sin migrar
  filas ni tocar el núcleo de `kardex.ts`** (PLANMAESTRO §4 — dimensiones por tipo de artículo).
- **D1/D2** — la valuación es a costo actual y llega en F7; en F3 `costoUnit` queda NULL.
- **A2/A3/A7/A9** — transacción, folio por secuencia atómica, auditoría/bitácora, multi-empresa.

Este ADR fija las 7 decisiones de diseño que el segundo reviewer valida antes de codificar.

## Decisión

### 1. Referencia polimórfica del movimiento al origen

`Movimiento` referencia el hecho que lo generó con un par **`origenTipo` (texto) + `origenId`
(texto)**, SIN FK física. `origenTipo` discrimina (`"recibo-maquila"`, `"entrega-cliente"`,
`"movimiento-manual"`, `"traspaso"`, `"ajuste"`…) y `origenId` guarda el id de esa fila como texto
(cubre PKs Int y String). **Por qué sin FK:** el origen vive en VARIAS tablas (recibos, entregas,
movimientos manuales, OC en F4…); una FK exigiría una columna nullable por cada tipo de origen y N
relaciones inversas que no aportan a la consulta. Es el **mismo criterio que la `Bitacora` y los
campos de auditoría** (ADR-0005): el único escritor es el dominio, que garantiza la consistencia, y
se indexa `(origenTipo, origenId)` para trazar. La cancelación NO es un origen: es un movimiento
**inverso** enlazado por `idMovimientoInverso` (autorreferencia), porque cancelar = generar el
opuesto auditado, nunca borrar/editar (D3/A7).

### 2. Mecanismo de extensibilidad por tipo de artículo — UN DETALLE POR TIPO ⭐

El kardex tiene **un encabezado único `Movimiento`** y **un detalle por tipo de artículo**:
`MovimientoDetPt` (modelo×color×talla, D4), `MovimientoDetTela` (tela×lote, D5) y
`MovimientoDetAvio` (avío×lote opcional + `esGenerico`, R4). NO se usa una tabla de detalle gorda
con columnas de dimensión nullable + CHECKs por tipo.

**Por qué tablas separadas y no columnas nullable+CHECK:**

- Cada tipo de artículo tiene dimensiones, tipos y unidades DISTINTAS: PT mide en piezas
  (`Int`), tela y avío en `Decimal` (kg/m). Una tabla única obligaría a `cantidad` genérico y a
  un enjambre de columnas nullable (`idModelo?`, `idColor?`, `idTalla?`, `idTela?`, `idLote?`,
  `idAvio?`, `esGenerico?`) gobernadas por CHECKs frágiles — exactamente el "todo nullable" que
  el modelo viejo arrastraba.
- Las FKs quedan **NOT NULL reales** por tabla (integridad fuerte), los índices son específicos
  por dimensión, y el tipado de Prisma es exacto (sin `| null` por todos lados).

**Criterio VERIFICABLE de extensibilidad (D5/R4):** las tres tablas de detalle **nacen en esta
migración** (F3-E1); tela y avío quedan **vacías**. F3 solo escribe `MovimientoDetPt`. Cuando F4
construya el inventario de telas/avíos:

- NO crea tablas nuevas de kardex (ya existen) → **no migra ni reescribe ninguna fila**.
- NO toca el encabezado `Movimiento` ni el núcleo de `kardex.ts` (que opera sobre el encabezado
  y delega el detalle por tipo a quien lo registra).
- La ÚNICA estructura que F4 agrega es la FK `id_lote → Lote` sobre `movimiento_det_tela` y
  `movimiento_det_avio` (el modelo `Lote` nace en F4, D5). En F3 `idLote` es un **escalar
  nullable SIN FK**; agregar la constraint es un `ALTER … ADD CONSTRAINT` **aditivo y seguro**
  (no toca filas, no cambia tipos).

Así, agregar tela/avío en F4 es puro código de dominio nuevo + una FK aditiva — el motor genérico
y el inventario PT existente quedan intactos. (El reviewer valida este punto contra D5 y R4.)

### 3. Las validaciones transaccionales suman el detalle DIRECTO, nunca la vista

La existencia para consultas/tableros sale de la vista `ExistenciaPt`. **Pero** las validaciones de
negocio dentro de una transacción —"no recibir más de lo enviado" (E4), "no entregar lo que no
existe" (E5)— **SIEMPRE** suman `MovimientoDet` directo con `SUM(...)` dentro de la transacción y
bajo bloqueo (advisory lock o `SELECT … FOR UPDATE` sobre la fila ancla), **NUNCA leen la vista**
(ni su versión materializada). Una vista materializada se refresca de forma asíncrona: leerla para
validar dejaría pasar dos entregas simultáneas y existencia negativa. La vista es **solo de lectura
para reportes**. Esta regla es de cumplimiento obligatorio en E4/E5 con test de concurrencia.

### 4. `costoUnit` NULL en toda F3 (D1/D2)

Las tres tablas de detalle llevan `costoUnit Decimal?` **nullable y SIEMPRE NULL en F3**: ni los
recibos (E4) ni los movimientos manuales (E3) lo escriben. La valuación a **costo actual** (D1) es
de F7; meterla antes obligaría a decidir la fórmula sin el módulo de costos. Se fija con un test en
la Fase 2 ("las entradas de F3 dejan `costoUnit` NULL"). Dejarlo nullable desde ahora evita una
migración cuando F7 empiece a poblarlo.

### 5. `ExistenciaPt` nace como vista normal; materializable en F3-E6

`ExistenciaPt` se crea como **`CREATE VIEW`** normal en esta migración: `Σ(cantidad·signo)` por
modelo×color×talla×almacén×empresa, con el signo derivado de `TipoMovimientoInventario.direccion`:
**`entrada` → +1, `salida` → −1, y cualquier otra → 0 (`ELSE 0` defensivo)**. NO hay un signo plano
para `traspaso`: un traspaso entre almacenes **se materializa como DOS `Movimiento`** (salida del
almacén origen + entrada al almacén destino, cada uno con un `TipoMovimientoInventario` de dirección
EFECTIVA `salida`/`entrada` — ver §1 y `registrarTraspasoPt`), de modo que la existencia TOTAL no
cambia y la vista solo ve patas +1/−1, **nunca un neto `traspaso +1`**. Cuidado de no confundir dos
ejes: el `origenTipo='traspaso'` (§1) es CORRECTO —es el discriminador del hecho que originó el par—
mientras que la **dirección** del movimiento que lee la vista jamás es `traspaso`; el `ELSE 0` es una
red de seguridad por si un detalle colgara de un encabezado de dirección `traspaso` (no debería: ese
tipo no lleva detalle de existencia), que así NO inflaría el saldo. La vista, su enum TSDoc
(`DireccionMovimiento`) y `comun/kardex.ts` (`existenciaPtBloqueada`) usan EXACTAMENTE esta regla.
**Por qué vista y no materializada ahora:** sin
los 10 años migrados no hay problema de volumen; una vista normal siempre está al día y no necesita
refresco. F3-E6, ya con el histórico cargado, **mide** y decide materializarla (mini-ADR si lo hace)
— sin cambiar la regla del punto 3: las validaciones seguirán sumando el detalle directo. La vista
no la gestiona Prisma (no es un modelo); vive como SQL en la migración.

### 6. Despachador de eventos de dominio (`comun/eventos.ts`)

Se diseña un **despachador mínimo** de eventos de dominio en `backend/src/comun/eventos.ts`: una
función para EMITIR un evento (`corte-registrado`, `envio-registrado`, `recibo-registrado`) y un
registro de suscriptores. En F3-E1 (Fase 2) se entrega **solo el gancho**, sin consumidores: los
servicios de corte/envío/recibo (E2/E4) lo invocan al cerrar su transacción, pero nadie escucha
aún. El consumidor real es el **auto-avance de la Ruta Crítica (F5)** (PLANMAESTRO §4). El evento se
emite **después** del commit de la transacción de dominio (un fallo de un suscriptor no debe
revertir el hecho de negocio ya consumado); el contrato del evento lleva el id de la orden/etapa y
el tipo de proceso. Diseño liviano (sin pg-boss aquí): F5 decidirá si los consumidores corren en
proceso o en cola.

### 7. Liga recibo↔envío AGREGADA por orden+proceso, con liga opcional (decisión reversible)

El WIP cuadra por **agregado orden+proceso**: "enviado" = Σ envíos de esa orden+proceso, "recibido"
= Σ recibos BUENOS de esa orden+proceso, "por recibir" = enviado − recibido − **incompletas**
(V1-E8v / §Post-F9.147: la prenda incompleta ya volvió del taller, así que cierra el pendiente aunque
no se inventaríe ni se pague). NO se exige amarrar cada
recibo a un envío específico (decisión (d), DECISIONES.md). Para no cerrar la puerta, `EtapaMovimiento`
lleva `idEtapaEnvio Int?` (autorreferencia nullable): en un recibo PUEDE apuntar al envío que recibe,
pero hoy queda NULL y las consultas no dependen de él. **Por qué reversible sin migración destructiva:**
si Daniel pide más adelante amarre estricto por envío, se empieza a llenar `idEtapaEnvio` (es DATO) y
se endurece la validación en el dominio — sin alterar el esquema ni migrar filas. El default queda
documentado como decisión reversible.

## Consecuencias

- (+) Un solo motor de kardex sirve a PT/tela/avío; F4 extiende con código nuevo + una FK aditiva,
  sin tocar el núcleo ni migrar filas (criterio verificable cumplido contra D5/R4).
- (+) Integridad fuerte: cada detalle tiene FKs NOT NULL reales y tipos exactos por artículo; el
  modelo viejo de "todo nullable" no se reproduce.
- (+) Existencia consistente por diseño (D3): no hay columna editable; cancelar es inverso auditado.
- (+) El WIP y el inventario son DOS planos separados (`EtapaMovimiento` vs `Movimiento`): un recibo
  de estampado sube WIP y genera cargo EsMa **sin** tocar el kardex PT (`generaEntradaPt=false`),
  evitando doble conteo — el corazón de F3-E4.
- (−) La referencia polimórfica (`origenTipo/origenId`) y los `*PorId` de auditoría no tienen FK
  física: la consistencia la garantiza el dominio (asumido, mismo criterio que ADR-0005). El
  reviewer vigila que solo el dominio escriba estos campos.
- (−) Tres tablas de detalle en vez de una: más objetos en el esquema, a cambio de integridad y
  claridad. Asumido.
- (−) `idLote` sin FK en F3 permitiría, en teoría, un lote inexistente; en F3 NUNCA se escribe
  (tela/avío vacías) y F4 cierra el hueco con la FK. Asumido y acotado.

## Alternativas consideradas

- **Tabla de detalle única con columnas nullable + CHECKs por tipo:** menos tablas, pero "todo
  nullable", CHECKs frágiles, `cantidad` de tipo único para piezas y kilos, y tipado Prisma con
  `| null` por todas las dimensiones. Descartada — reproduce el defecto del modelo viejo y complica
  la verificación de extensibilidad.
- **Una tabla de movimiento por tipo de artículo (MovimientoPt/MovimientoTela/MovimientoAvio):**
  duplica el encabezado (folio, almacén, origen, inverso, auditoría) tres veces y rompe la idea de
  "un kardex"; un traspaso mixto sería imposible de modelar uniforme. Descartada.
- **`costoUnit` calculado ya en F3:** exigiría fijar la fórmula de valuación sin el módulo de costos
  (F7) y arriesga reescribirla. Descartada — NULL hasta F7 (D1/D2).
- **`ExistenciaPt` materializada desde F3-E1:** complejidad de refresco sin necesidad de volumen
  todavía. Descartada — vista normal ahora, materializar en E6 si la medición lo pide.
- **Liga estricta recibo→envío desde ya:** la doc no fija que un recibo corresponda a un envío
  puntual (1,309 envíos viejos sin precio, agregados por orden+proceso). Descartada como obligatoria;
  se deja el campo opcional para volverla estricta por dato (decisión (d)).

## Vuelta atrás

- **Extensibilidad:** ya es la vuelta atrás — agregar tela/avío en F4 es aditivo. Si algún día se
  quisiera unificar detalles, sería una migración de consolidación (no se contempla).
- **Liga recibo↔envío:** endurecer = empezar a poblar `idEtapaEnvio` + validación de dominio, sin
  migración (decisión (d)).
- **`generaEntradaPt`:** cambiar qué proceso mete a PT es DATO (UI de admin), no migración
  (decisión (e)).
- **`costoUnit`:** F7 lo empieza a poblar sobre la columna ya existente (sin migración).
- **Vista materializada:** F3-E6 puede reemplazar `CREATE VIEW` por `CREATE MATERIALIZED VIEW` +
  refresco, conservando la regla del punto 3 (mini-ADR).

## Referencias cruzadas

- `docs/hoja-de-ruta/F3-etapas.md` §F3-E1 (alcance, los 7 puntos del ADR y el criterio de cierre).
- `Documentacion_MJD/DECISIONES.md` D1, D3, D4, D5, D12 y las decisiones (d) liga recibo↔envío y
  (e) `generaEntradaPt`; `REQUISITOS-NUEVOS.md` R4 (kardex de avíos); `MEJORAS.md` A2, A3, A6, A7, A9.
- `Documentacion_MJD/03-Produccion.md` (Paso 5: `MeterInventario` e `Inventariado` SOLO en costura),
  `04-Inventarios.md` §A.1–A.2 y Observación 1, `07-EsMa…` §3 (`EsEstampado`).
- `PLANMAESTRO.md` §4 (motor de inventario único — dimensiones por tipo) y §5 (recibo = punto de
  integración central).
- ADR-0005 (auditoría sin FK — mismo criterio para la referencia polimórfica), ADR-0007 (catálogos
  globales), ADR-0008 (schema único).
- `backend/prisma/schema.prisma` (sección "PRODUCCIÓN / WIP + MOTOR KARDEX (F3-E1)") y
  `backend/prisma/migrations/20260617120000_f3_e1_produccion_kardex/migration.sql` (incluye la
  vista `existencia_pt`).
