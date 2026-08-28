# Módulo Producción / WIP — Cómo quedó construido (F3)

> Referencia funcional: `Documentacion_MJD/03-Produccion.md` (corte→maquila→recibo→entrega, WIP, form
> `Proceso`) y `07-EsMa-…` (cuenta de maquileros) — no se duplica (ADR-0002).
> Motor y reglas del kardex: `docs/arquitectura/ADR-0010-motor-kardex-produccion.md`.
> El inventario PT (kardex) tiene su propia ficha: `docs/modulos/inventario-pt.md`.

La **producción** es el ciclo de vida de una orden: **corte → envío a maquila → recibo de maquila →
entrega a cliente**, con el **WIP** (work-in-progress) DERIVADO por suma de las etapas (D3/D4, sin
acumuladores). El **estampado/bordado/lavado** NO es un flujo aparte: es el mismo modelo de etapa
parametrizado por `TipoProceso` (D8 — unifica costura `Entregas`/`Recibos` y estampado
`EntregasEst`/`RecibosEst` del viejo).

## Entidades y tablas de BD

| Entidad v2 | Tablas v2 | Fuente (CSV viejo) |
|---|---|---|
| TipoProceso (costura/estampado/bordado/lavado) | `tipos_proceso` (+ `generaEntradaPt`) | catálogo (F3-E1) |
| EtapaMovimiento (encabezado WIP) | `etapa_movimiento` (enum `tipo_etapa_movimiento`) | `Corte`, `Entregas`, `EntregasEst`, `Recibos`, `RecibosEst` |
| EtapaMovimientoDet (color×talla, D4) | `etapa_movimiento_det` | `OrdenesDetCorte.TC1..TC8` (corte) |
| EsMaCargo (cargo a maquilero) | `esma_cargo` (enum `estado_cargo_esma`) | `EsMa_Recibos` |
| Movimiento / MovimientoDetPt (kardex PT) | `movimientos` / `movimiento_det_pt` | derivado (recibo costura + entrega) |

`EtapaMovimiento` es el encabezado de cada captura (corte/envío/recibo/entrega); su detalle color×talla
cuelga en `EtapaMovimientoDet`. **NO es el kardex:** el kardex PT (entrada/salida real de existencia) lo
generan el **recibo de costura** (`TipoProceso.generaEntradaPt`), la **entrega**, y —desde V1-E4b— el
**envío y el recibo de prenda ya terminada**, que la mueven contra el almacén de **Tránsito** (ver abajo).
Todos vía un `Movimiento` aparte. Folio por secuencia atómica `"etapa-mov"` POR EMPRESA (A3).

## Servicios de dominio

- `produccion/tipos-proceso.ts` (F3-E1) — CRUD del catálogo de tipos de proceso (admin-only;
  `generaEntradaPt` marca los que meten a PT — solo costura).
- `produccion/etapas.ts` (F3-E2) — **corte** + **envío a maquila** unificado (M+A por `TipoProceso`).
  Decisiones (DECISIONES.md): **(f) sobre-corte LIBRE** (`registrarCorte` no topa por pedido; tolerancia
  configurable), **(g) sobre-envío ESTRICTO** (`registrarEnvioMaquila` bloquea si `enviado > cortado`
  disponible para ese proceso, suma directa bajo lock). Cancelación SUAVE + motivo + bitácora.
- `produccion/etapas.ts` · `sugerirCaptura` + `resolverSugerencia` (V1-E8i, §Post-F9.131) — **qué
  precargar en la captura de una etapa**, para los botones «Llenar con lo que falta por cortar» y
  «Llenar con lo que se cortó» (`GET /produccion/ordenes/:id/sugerencia-captura`, `produccion.wip-ver`).
  **Solo lectura, no guarda nada.** Base **corte** = `Σ orden − Σ corte` sin negativos; base **envío** =
  `Σ corte − Σ enviado(proceso)` sin negativos — que es el MISMO tope que valida `registrarEnvioMaquila`
  bajo lock, para que el segundo envío parcial no proponga un sobre-envío que el servidor rechazaría.
  ⚠️ La rama del envío sólo cuenta celdas que **siguen en la matriz de la orden**: `guardarMatrizOrden`
  no bloquea quitar un color/talla ya cortado, y proponer una celda que la captura no dibuja sería
  invisible en pantalla, contada en el rótulo del botón y descartada por `lineasApi()` al guardar.
  Cuando no hay nada, devuelve el **motivo** (`orden-sin-matriz` · `todo-cortado` · `nada-cortado` ·
  `todo-enviado`): la razón la decide el dominio, la pantalla solo la traduce. `resolverSugerencia` es el
  núcleo PURO (probado sin BD en `etapas-sugerencia.test.ts`, que además fija **la forma de las
  consultas** con un cliente Prisma falso — es lo único que caza que la lectura del envío pierda su
  `idTipoProceso`, la mutación que violaría D8).
  🔴 **La pantalla NO ofrece el atajo cuando el envío saca PRENDA YA TERMINADA** (`prendaTerminada`,
  V1-E4b): ahí el servidor exige además existencia en el almacén (`transito.ts` →
  `exigirExistenciaPt`), un tope que esta consulta **no** conoce. Que lo reciba y lo aplique es trabajo
  pendiente, no un olvido.
- `produccion/recibos.ts` (F3-E4) ⭐ — **recibo de maquila**, la etapa CENTRAL: de UNA captura, en UNA
  transacción, deriva: la etapa `recibo_maquila` + detalle con CALIDAD (primeras/segundas), la validación
  `recibido ≤ enviado` **POR MAQUILERO** (estricto, g; ver abajo), **la ENTRADA al kardex PT SOLO si `generaEntradaPt`** (primeras→
  almacén primeras, segundas→segundas), y un **`EsMaCargo(propuesto)` para TODO proceso** (cantidad
  recibida × precio del envío). Emite evento `recibo-registrado` post-commit (gancho RC F5).
- `produccion/entregas-cliente.ts` (F3-E5) — **entrega a cliente** (cierre del ciclo): el "gemelo de
  salida" del recibo de costura. Deriva la etapa `entrega_cliente`, la validación **no-negativo estricta**
  (no entregar lo que no existe, suma directa bajo lock), y la **SALIDA del kardex PT**. El seguimiento
  del pedido (entregado/faltante) es DERIVADO de las entregas vivas (D3). Evento `entrega-registrado`.
- `produccion/wip.ts` (F3-E5) — **tablero WIP** + existencias en poder del maquilero (`MaqExis`): CONSULTAS
  de solo lectura, todo derivado por suma de `EtapaMovimientoDet` (excluyendo canceladas).
- `esma/cargos.ts` (F3-E4) — **cola de validación EsMa**: el cargo nace `propuesto` del recibo; el admin
  lo `validado` fijando cantidad/precio reales (punto de control humano de v1). El estado de cuenta
  completo (abonos/saldos) es F6.
- `produccion/migracion.ts` y `esma/migracion.ts` (F3-E6, **Pieza A**) — modo migración del histórico de
  corte/envío/recibo/EsMa (NO lo cubre esta ficha de cierre de Pieza B; ver su loader).

### Fórmulas del WIP (form `Proceso` del viejo, derivadas por suma)

- Por cortar = pedido(orden) − cortado
- Cortado por enviar = cortado − enviado (por `TipoProceso`)
  - ⚠️ `wipDeOrden.cortadoPorEnviar` **solo enumera los procesos YA USADOS** (los que tienen envíos
    vivos). Para el **primer** envío de un proceso el disponible es lo cortado, y el servidor lo manda
    aparte en **`cortadoCeldas`** (Σ corte por celda, con los ceros incluidos — cero cortado es un tope
    real, no una ausencia de dato). La pantalla lo lee tal cual: antes lo re-derivaba restando
    *pedido − porCortar*, y la misma regla escrita en dos lados deriva (V1-E8i).
- Por recibir = enviado − recibido (por `TipoProceso`, **y desglosado por MAQUILERO**)
- Entregado a cliente = Σ entregas (etapa `entrega_cliente`)
- Por entregar = recibido(procesos `generaEntradaPt`) − entregado a cliente

### El saldo del recibo se lleva POR MAQUILERO (regla de Daniel, 28-jul-2026)

*"No puedo recibir un corte de un maquilero diferente al que se lo entregué."* (`DECISIONES.md
§(Post-F9.7)`.) La invariante del recibo **cambió**: antes era `recibido ≤ enviado` del **proceso
entero**; ahora es del **tercero**. Con dos maquileros trabajando la misma orden, lo anterior dejaba
cargarle a uno lo que devolvió el otro y falseaba EsMa y las existencias en poder del maquilero.

- `wip.ts` exporta **`pendientePorMaquilero(cliente, idOrden, idTipoProceso, meta)`**: `enviado −
  recibido` por tercero y por color×talla, más los totales del proceso PLEGADOS de la misma lectura.
  Lo consumen el drill-down (`wipDeOrden`) **y** `pendientesPorRecibir` (recibos.ts), para que las
  DOS pantallas de recibo —el panel de avance y `/produccion/recibos`— ofrezcan y topen lo mismo.
- Enumera a todo tercero con envío **o** recibo vivo: un maquilero con recibos y sin envío (posible
  en lo migrado) sale con pendiente NEGATIVO. Si se enumeraran solo los envíos, `Σ porMaquilero ≠
  totalPendiente` y el drill-down contradiría a "Existencias en poder del maquilero".
- `registrarReciboMaquila` **re-valida** (una lista filtrada en pantalla se brinca por API): rechaza
  recibirle a quien no tiene envío vivo —nombrando a quienes sí— y topa contra el saldo de ESE
  tercero. La liga opcional `idEtapaEnvio` también exige el mismo maquilero.
- **Histórico migrado sin tercero** (`idTercero` NULL): no hay a quién recibirle, y las dos capas lo
  DICEN tal cual ("entrega viva SIN maquilero: hay que corregirla antes de recibir") en vez de
  responder "esta orden no tiene entregas", que era falso.
- **Guard de cancelación de envío** (`etapas.ts`): sigue bloqueando cancelar un envío con recibos
  vivos del mismo proceso. Con la regla nueva es MÁS conservador de lo necesario (bloquea el envío
  de B si A tiene recibos vivos); se conserva a propósito — relajarlo pide su propio análisis.

## Permisos (RBAC, A4)

`produccion.corte` · `produccion.envio` · `produccion.recibo` · `produccion.entrega` ·
`produccion.cancelar` · `produccion.wip-ver` · `esma.cargo-validar`.

## El `generaEntradaPt` — qué decide, y qué NO decide

`TipoProceso.generaEntradaPt` decide si un proceso **CREA** producto terminado. Solo **costura** la tiene:
su recibo es lo que convierte WIP en prenda terminada. Esto reemplaza el `MeterInventario` / bandera
`Inventariado` del viejo: recibir costura = ya queda en inventario en la misma transacción (mejora A1/D3).

**Lo que esta bandera NO decide (corregido en V1-E4b):** si un recibo toca o no el kardex. Eso lo decide la
**posición del proceso en el flujo**, y la posición **no es propiedad del tipo** — un mismo estampado va
antes de costura en una orden y después en otra. Por eso la lleva el **envío** (`prendaTerminada`), no el
catálogo. Ver §Post-F9.59 de `DECISIONES.md`.

| Cuándo | Qué hace el recibo |
|---|---|
| Proceso con `generaEntradaPt` (costura) | **Crea** PT: entrada al almacén de primeras/segundas |
| Proceso **antes** de costura (envío sin `prendaTerminada`) | Solo sube el WIP "recibido"; **NO** toca el kardex |
| Proceso **después** de costura (envío con `prendaTerminada`) | **Devuelve** del Tránsito al almacén; no crea nada nuevo |

El kardex de PT lo generan entonces **cuatro** momentos, no dos: recibo de costura (entrada nueva),
entrega a cliente (salida), y el **envío/recibo de prenda ya terminada** (traspaso contra el Tránsito). El
envío de **bultos cortados** —el flujo de siempre— sigue sin tocar el kardex.

## El Tránsito — dónde está la prenda que salió a proceso (V1-E4b)

Una prenda ya terminada que se manda a estampar/lavar/aplicar **no está en el piso**, y el inventario no
puede decir que sí. Se mueve al almacén **«Tránsito»** (`Almacen.esTransitoProceso`), que ya existía
sembrado desde F3-E1 —heredado de `IPT_Almacenes` del Access, nunca usado— y que el envío resuelve por esa
bandera, **jamás por nombre**. El traspaso reusa `registrarTraspasoPt`: dos patas en una transacción.

```
envío  (prendaTerminada)   almacén → Tránsito
recibo, primeras           Tránsito → almacén de primeras
recibo, segundas           Tránsito → almacén de segundas     ← la reclasificación, como movimiento real
la diferencia              SE QUEDA VIVA en Tránsito
```

Ese saldo vivo **es** el faltante, y existe porque Daniel lo pidió así: *"¿de qué manera manejamos los
faltantes o segundas?"* (§Post-F9.61). Su baja es un movimiento manual de PT con motivo y auditoría.

**Dos cuentas, dos preguntas distintas — y no se duplican:** el kardex responde *"¿cuántas piezas no están
en el piso?"*; el **WIP** responde *"¿de quién son?"* (`wip.ts` `pendientePorMaquilero`, saldo por tercero).
Por eso el Tránsito es **uno solo** y no uno por maquilero.

### Qué se puede cancelar a mano, y qué no

`cancelarMovimientoPt` **solo acepta movimientos capturados a mano** (`origenTipo = movimiento-manual`).
Todo lo demás —recibo, entrega, envío a proceso, traspaso, cíclico, migración— es el **efecto** de un
hecho que tiene su propio estado: anular el movimiento suelto arreglaba el inventario **dejando el hecho
en pie**, y el maquilero seguía debiendo prendas que el kardex ya no tenía. El mensaje manda al hecho
correcto según el origen. *(Consecuencia: el **traspaso manual de PT ya no se cancela** — se corrige con
el traspaso inverso. Alinea PT con tela, donde la regla existe desde F4-E1.)*

### El bucket de orden — de qué stock salen las piezas

La existencia de PT no se lleva sólo por artículo y almacén: se lleva **por orden**, y hay un bucket
**«sin orden asignada»** (`idOrden = null`) donde vive *"lo capturado a mano en el arranque y lo migrado"*
(`contrato/esquemas/movimiento-pt.ts`). **Ahí cae todo el histórico del Access y todo el conteo físico de
arranque**, así que no es un caso de borde: es el bucket con más piezas el día uno.

Por eso el envío **elige de qué bucket salen** (`EtapaMovimiento.stockSinOrden`), y el recibo las devuelve
al **MISMO** bucket del que salieron — reetiquetarlas al regresar movería saldo entre buckets sin que
nadie lo pidiera. Cuando el bucket elegido no alcanza, el error **dice dónde están las demás** en vez de
afirmar que no hay existencia. *(Esto nació de un hallazgo de revisión en V1-E4b: la primera versión
clavaba el bucket de la orden y el mensaje decía "0 en existencia" con 100 piezas a la vista.)*

⚠️ **Lo que NO cierra:** dar de baja el faltante en el kardex **no** cierra el pendiente del WIP contra el
maquilero — eso exigiría un `TipoEtapaMovimiento` nuevo y rehacer la aritmética de pendientes. Es una
limitación **preexistente** (hoy tampoco se puede cerrar un pendiente sin recibir), anotada como deuda.

## Eventos que entrega a F5 (Ruta Crítica)

El recibo y la entrega emiten eventos de dominio post-commit (`recibo-registrado`, `entrega-registrado`)
como **gancho** para el motor de Ruta Crítica de F5 (D10/D11). Hoy NO tienen consumidores; fijan el
contrato del evento para que F5 enganche el avance del WIP al CPM sin tocar estos servicios.

## Qué entrega a otras fases

- **F4 (Compras/órdenes de compra):** la producción consume materiales; las OC se ligan a la orden.
- **F6 (Costos/EDR):** los `EsMaCargo` validados son la base de la CxP de maquila; `costoUnit` (hoy NULL,
  D1/D2) se llenará en F7.
- **F7 (Valuación):** la valuación del kardex (`costoUnit`) llega aquí; el motor ya tiene el campo nullable.

## Migración del histórico de producción (F3-E6)

> **Esta ficha cierra la Pieza B (kardex IPT, ver `inventario-pt.md`).** La Pieza A migra
> corte/envío/recibo/EsMa con su propio modo migración (`produccion/migracion.ts`, `esma/migracion.ts`).
> La regla de CONTRATO entre piezas (para que NO haya doble conteo del inventario):

- Los **recibos de costura** del histórico se cargan **SIN** la entrada a PT derivada (`generaEntradaPt`):
  esa entrada YA está en `IPT_Movs` (el viejo la registró como movimiento de inventario), así que el
  kardex de v2 viene **solo** de la migración de IPT (Pieza B), nunca de un recibo. Re-generarla duplicaría.
- Los **cargos EsMa** se migran solo de `EsMa_Recibos`, NUNCA del kardex.
- El **cuadre F3** (`migracion/cuadre-f3.ts`) verifica esto explícitamente: todo `Movimiento` de kardex
  tiene `origenTipo = 'migracion'`; CERO de `recibo-maquila` o de un cargo.

Orden de corrida (ver `backend/migracion/README.md`): `etl-produccion` → `etl-ipt` → `cuadre-f3`.

## Decisiones de diseño

- **D8 maquila unificada:** un solo modelo de etapa para costura y estampado/bordado/lavado, por `TipoProceso`.
- **D3/D4 WIP derivado:** todo el avance es suma directa de `EtapaMovimientoDet` por color×talla; sin
  columnas/acumuladores. Las cancelaciones son suaves (se excluyen de la suma, no se borran).
- **(f) sobre-corte libre / (g) sobre-envío y sobre-recibo estrictos** (DECISIONES.md F3-E2/E4).
