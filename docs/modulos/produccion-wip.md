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
  ⚠️ **En el frontend, el botón cuelga de UN solo gate** (`consultaSugerencia` en
  `AvanceProduccion.tsx`), no del `enabled` de la query: TanStack **sirve el `data` cacheado aunque la
  query esté deshabilitada**, y el corte y el «envío sin proceso elegido» llegaron a compartir clave
  (hoy la clave lleva la base: `idTipoProceso ?? 'corte'`). Sin ese gate único, el botón del envío se
  encendía con la cifra del corte.
  🔴 **La pantalla NO ofrece el atajo cuando el envío saca PRENDA YA TERMINADA** (`prendaTerminada`,
  V1-E4b): ahí el servidor exige además existencia en el almacén (`transito.ts` →
  `exigirExistenciaPt`), un tope que esta consulta **no** conoce. Que lo reciba y lo aplique es trabajo
  pendiente, no un olvido.
- `produccion/recibos.ts` (F3-E4) ⭐ — **recibo de maquila**, la etapa CENTRAL: de UNA captura, en UNA
  transacción, deriva: la etapa `recibo_maquila` + detalle con CALIDAD (primeras/segundas) **y, desde
  V1-E8k, las PRENDAS INCOMPLETAS** (ver abajo), la validación
  `recibido ≤ enviado` **POR MAQUILERO** (estricto, g; ver abajo), **la ENTRADA al kardex PT SOLO si `generaEntradaPt`** (primeras→
  almacén primeras, segundas→segundas), y un **`EsMaCargo(propuesto)` para TODO proceso** (cantidad
  recibida × precio del envío) — **salvo si el recibo trae SOLO incompletas**, que no genera cargo.
  Emite evento `recibo-registrado` post-commit (gancho RC F5).
- `produccion/entregas-cliente.ts` (F3-E5) — **entrega a cliente** (cierre del ciclo): el "gemelo de
  salida" del recibo de costura. Deriva la etapa `entrega_cliente`, la validación **no-negativo estricta**
  (no entregar lo que no existe, suma directa bajo lock), y la **SALIDA del kardex PT**. El seguimiento
  del pedido (entregado/faltante) es DERIVADO de las entregas vivas (D3). Evento `entrega-registrado`.
- `produccion/wip.ts` (F3-E5) — **tablero WIP** + existencias en poder del maquilero (`MaqExis`): CONSULTAS
  de solo lectura, todo derivado por suma de `EtapaMovimientoDet` (excluyendo canceladas).
- `esma/cargos.ts` (F3-E4) — **cola de validación EsMa**: el cargo nace `propuesto` del recibo **o de un
  SERVICIO SOBRE LA ORDEN** —corte o empaque, fila 0.114— con `idTipoProceso` NULL y `servicio` lleno; el
  CHECK `esma_cargo_proceso_o_servicio` exige exactamente uno de los dos. El admin
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
- Por recibir = enviado − recibido − **incompletas** − **saldados** (lo saldado sale de los cierres vivos de la orden con el maquilero, 0.109: tres sumandos, no dos; por `TipoProceso`, **y desglosado por
  MAQUILERO**). Las incompletas restan desde V1-E8v: ya volvieron del taller (§Post-F9.147)
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

### Prendas INCOMPLETAS (V1-E8k §Post-F9.136 · V1-E8v §Post-F9.147)

Una prenda a la que le faltó una pieza y **nunca se terminó de coser**. No es una segunda (ésa se
vende más barata): es una **no-prenda**. Daniel exige que el maquilero se la lleve de vuelta y que
quede constancia.

**⭐ La invariante que manda (§Post-F9.147):**

```
enviado = primeras + segundas + faltantes + incompletas
```

- Viven en **`EtapaMovimientoDet.cantidadIncompletas`**, **fuera de `cantidad`**. Todo lo que produce,
  inventaría, cobra o mide suma `cantidad`, así que las tres prohibiciones (no producidas, no
  inventariadas, no pagadas) se cumplen **por construcción**. La invariante `cantidadPrimeras +
  cantidadSegundas = cantidad` queda intacta.
- La aritmética vive en **`produccion/incompletas.ts`**: `piezasDevueltas` / **`pendientePorCelda`**
  (el pendiente **y** el tope: son el mismo número) e `incompletasDeMaquilero` (el bloque del estado
  de cuenta). Todas las puertas llaman a la misma función.
- ⭐ **La incompleta SALE DEL TRÁNSITO** (V1-E8v). DANIEL: *«Al registrarlas como incompletas
  entregadas, dejan de estar en la maquila»*. Ya volvió del taller ⇒ **cierra el pendiente**, aunque
  siga sin producirse, inventariarse ni pagarse. Lo que queda pendiente es el **FALTANTE** —lo que
  nunca volvió—, y ése sí se le cobra.
  🔴 Esto **corrige** la coletilla de la opción A de §Post-F9.136 (*"el pendiente queda abierto para
  cobrar el faltante"*), que confundía incompleta con faltante. Como consecuencia, el campo
  `recibible` del contrato **se retiró**: pendiente y recibible pasaron a ser idénticos, y publicar
  los dos era verdad duplicada. `pendientePorMaquilero` publica ahora **dos** números por celda:
  `cantidad` (el pendiente, que es también el tope de captura) e `incompletas` (informativo, para la
  trazabilidad).
- **Las DIEZ puertas** que llevan esta fórmula, todas por la misma función (o con el comentario que
  apunta a ella cuando es SQL) — y desde la fila 0.109 la fórmula lleva **tres** sumandos
  (`enviado − devuelto − saldado`), no dos: `pendientePorMaquilero` · `wipDeOrden` (por proceso) ·
  `pendientesPorRecibir` · **`consultarExistenciaMaquilero`** · `pendientesDerivados`/`agregadoWip`
  (por orden) · `contarOrdenesAbiertas` y `contarMaquilerosConSaldo` del Resumen operativo · la vista
  materializada **`kpi_wip`** (única fórmula congelada en SQL; migración
  `20260830120000_la_incompleta_sale_del_transito`) · y las **dos del panel de avance** que no
  calculaban un pendiente sino que lo **invertían**: `pasosDesdeWip` (despejaba lo enviado) y
  `ResumenAvance` (restaba dos hechos publicados). Estas dos se arreglaron publicando
  **`enviadoCostura`** desde el servidor y **consumiendo** `totalPendiente` en vez de restar.
  ⭐ **Regla que dejan:** *restar dos hechos publicados es re-derivar la regla*. Si el servidor ya
  publica el pendiente, se consume.
- Un recibo que trae **solo** incompletas se guarda, **no pide almacén** (`meteAPt` incluye
  `totalRecibido > 0`) y **no genera `EsMaCargo`**.
- Dónde se ven: el **drill-down del tablero WIP** (métricas «Incompletas» y «Por recibir» junto a
  «Enviado» y «Recibido» — las cuatro cubetas cuadran a la vista), **«Existencias en poder del
  maquilero»** (columna propia), el estado de cuenta del maquilero (las dos vistas → PDF y Excel),
  la cola de validación de cargos, los recibos semanales y el PDF del recibo. Detalle en
  `docs/modulos/esma.md`.

- ⭐ **La incompleta SALE del tránsito como MERMA (0.061 — §Post-F9.154(a); antes era deuda).** Con
  proceso DESPUÉS de la costura (envío de prenda ya terminada, V1-E4b) las incompletas **se quedaban
  en el almacén Tránsito para siempre**: no volvían a primeras ni a segundas porque no se inventarían,
  y darles salida pedía un tipo de movimiento nuevo que era decisión de negocio sin tomar. **Daniel la
  tomó**: al registrar el recibo salen solas, con el tipo de movimiento `merma-incompletas`
  (dirección `salida`), en la MISMA transacción y selladas con el origen del recibo — así que
  **cancelar el recibo las devuelve al tránsito** con su inverso auditado (D3), sin código propio.
  Con eso el WIP y el kardex vuelven a cuadrar: lo que queda vivo en tránsito es exactamente el
  FALTANTE, que es lo que el WIP reclama.
  - Sólo aplica cuando el envío sacó **prenda terminada**. En el recibo de costura las piezas nunca
    entraron al kardex de PT, así que no hay de dónde sacarlas (y no hay merma que registrar).
  - **No es retroactiva (REGLA 0-B):** lo capturado antes de 0.061 dejó sus piezas en tránsito y ahí
    se quedan; si estorban se limpian con un movimiento manual de PT con su motivo.
  - Estrenar esta versión pide **`SEED_ON_START=true`** (el tipo de movimiento es nuevo).

## ⭐⭐ Cerrar la orden con un maquilero: el FALTANTE por fin se puede cobrar (V1, fila 0.109)

**El problema.** §Post-F9.147 dejó escrita la invariante de las cuatro cubetas, pero el **faltante no
era un dato**: era el RESIDUO de `pendiente = enviado − buenas − incompletas`. **Faltante ≡ pendiente,
el mismo número** ⇒ cobrarlo no bajaba nada y la lista de pendientes crecía para siempre. Y
`esma/cargos.ts` no mencionaba la palabra «faltante» ni una vez: la regla vivía en la prosa y no en el
código.

**Lo que pidió Daniel (3-sep-2026).** Un botón de **«cerrar la orden»** (*«se cierra por orden»*), que
**lo aprieta quien recibe**, que **salda siempre el pendiente** y que **PROPONE** el cobro esperando su
visto bueno — *«nunca cobra solo»*. Dos desenlaces, y los dos limpian la lista: **cerrado y cobrado** o
**cerrado y perdonado**. Reversible. Y una orden puede tener **varios maquileros vivos** ⇒ un cierre y
un cobro por cada uno.

**Cómo quedó.**

- **El acto**: `CierreMaquilaOrden` (+ `CierreMaquilaOrdenDet`), por **orden × maquilero × proceso** —
  que es la granularidad a la que se lleva el pendiente, a la que vive el `precioPactado` (en el
  ENVÍO) y a la que se cobra. **No** es un estado de la orden: `EstadoOrden.completa` significa
  completitud de CAPTURA (§Post-F9.181(a)) y una bandera por orden no cabría con varios maquileros.
- **La cubeta**: `CierreMaquilaOrdenDet.cantidadFaltantes`, color×talla×pack. En **tabla aparte** de
  `EtapaMovimientoDet` a propósito: todo lo que produce, inventaría o cobra suma
  `EtapaMovimientoDet.cantidad`, así que un faltante alojado ahí acabaría multiplicado por un precio y
  empujado al almacén. Aquí queda fuera de los tres **por construcción** (misma razón que
  `cantidadIncompletas`).
- **La fórmula, con su tercer sumando**: `pendiente = enviado − devuelto − saldado`
  (`pendientePorCelda`, tercer parámetro **obligatorio** a propósito: con un default de 0, cualquier
  puerta que se olvidara de leer los cierres seguiría compilando y seguiría contando como pendiente lo
  ya saldado). Las mismas puertas de la lista de arriba, más `kpi_wip` (columna `faltantes_saldados`,
  migración `20260903180000_cerrar_la_orden_con_el_maquilero`).
- **El cobro es un DESCUENTO, no un cargo** — es la parte que hay que leer despacio. El saldo es
  `Σcargos + Σabonos − Σpagos − Σdescuentos` (`esma/formula-saldo.ts`): un CARGO **sube** lo que se le
  debe al maquilero, o sea que le pagaría las prendas que no devolvió, además de dejárselas. Cobrarle
  **baja** lo que se le debe. Y es la palabra de Daniel: *«ese faltante si se le queda y se le quita a
  mando (normalmente **descontandole** esas prendas faltantes)»* (§Post-F9.147).
- **«Propone, no cobra»**: el `DescuentoMaquilero` nace `capturado`, que **no cuenta al saldo** y se ve
  en el estado de cuenta marcado como pendiente de revisión (fila 0.115). Ahí está el visto bueno, con
  el flujo de revisión que ya existía (`esma.modificar`) — **sin pantalla nueva**. Su `observaciones`
  dice de qué OP y de qué es: *«Faltante de la orden #77 · Costura: 5 pza(s) que no se devolvieron»*.
- **Deshacer** = acto inverso auditado (D3), con **update CONDICIONAL** (`updateMany` sobre
  `estadoRevision: 'capturado'` + `canceladoEn: null`, y falla si `count === 0`): `revisarMovimiento`
  NO toma el lock de la orden —no sabe nada de órdenes—, así que puede commitear entre la lectura y la
  escritura; sin la condición, deshacer cancelaba un descuento **ya revisado** y ese dinero
  desaparecía del saldo sin que nada lo dijera (precedente F8-E3). La otra mitad del candado está en
  `revisarMovimiento`: filtra `canceladoEn: null` y también actualiza condicionalmente, para que un
  descuento cancelado no se pueda marcar `revisado` (fantasma «cancelado + revisado»). El cierre queda
  `deshechoEn` (las piezas vuelven al pendiente porque el pendiente se DERIVA) y el descuento
  propuesto queda **cancelado**
  (`DescuentoMaquilero.canceladoEn`, columna nueva; la condición «vivo» entró en la definición única
  de `formula-saldo.ts`, así que viaja sola a las cinco sumas del saldo). 🔴 Se **rechaza** si el
  descuento **ya se revisó**: ese importe ya está en el saldo y puede estar pagado — sacarlo de ahí no
  es deshacer un acto, es capturar el movimiento contrario.
- **Consume saldo como lo devuelto**: tras cerrar, esas piezas **ya no se pueden recibir** (el tope de
  `registrarReciboMaquila` resta lo saldado, en sus DOS condiciones: agregada y por pack). Si el
  maquilero las trae después, primero se deshace el cierre.
- ⭐ **Y el ENVÍO que las sostiene no se puede cancelar** (`etapas.ts::cancelarEtapaMovimiento`). El
  guard viejo sólo miraba recibos vivos, y el camino malo no tiene ninguno: se envían 100, no devuelve
  nada, se cierra cobrándole las 100 y se cancela el envío ⇒ `enviado = 0` con `saldado = 100`, o sea
  pendiente **−100** en las cinco puertas, la orden de vuelta en ABIERTA, `kpi_wip` negativo y un
  descuento cobrando prendas de un envío que ya no existe. Es la «lección de la décima puerta»
  aplicada a quien ESCRIBE: **quien borra el minuendo tiene que mirar todos los sustraendos**.
- ⭐⭐ **`faltantesSaldables` — el número que se enseña ES el que se escribe.** Lo saldable es
  `Σ máx(0, pendiente por color×talla)`, **no** `totalPendiente` (la suma plana). Con una celda
  negativa —un recibo del histórico capturado en la talla equivocada, o lo devuelto sin decir de qué
  pack era— las dos cifras se separan y las dos formas de separarse son un defecto: con `+5` y `−5`
  la suma plana da 0 y **el botón no aparecería nunca** (justo en las órdenes migradas, que son el
  grueso de la lista que no se vacía); con `+5` y `−3` da 2 y el descuento saldría por 5. Por eso hay
  **una sola función** (`faltantes-saldados.ts::celdasSaldables`/`totalSaldable`) que usan las dos
  caras: la que OFRECE (`pendientePorMaquilero`, que la publica en el contrato junto al precio y al
  importe ya multiplicado) y la que ESCRIBE (`cierre-maquila.ts::derivarFaltantes`). La pantalla no
  multiplica ni suma nada.
- **Sin precio pactado en el envío** (1,309 envíos migrados no lo traen): el cierre **salda igual** y
  **no propone** el cobro; lo dice con nombre (`idDescuento: null` con `desenlace: 'cobrado'`) para que
  el descuento se capture a mano. **No se inventa un precio** (REGLA 0-B: lo viejo se tolera, no se
  compensa).
- **Dónde está el botón**: en la captura del **RECIBO** del panel de avance (`AvanceProduccion`), que es
  donde trabaja *«quien recibe»*. Su confirmación enseña **cuántas piezas se saldan, a qué precio y
  cuánto se propondría cobrar** —los tres números los manda el servidor ya derivados—, y debajo va la
  lista de lo ya cerrado con su **Deshacer**. **Cero pantallas nuevas.**
- ⚠️ **La fórmula está escrita TRES veces sólo en `indicadores/kpis.ts`** —el `WHERE` de
  `condicionesWip` y las dos expresiones `porRecibir` de sus dos `SELECT`— más su gemela en
  `resumen/resumen.ts::contarOrdenesAbiertas`. La fila 0.109 actualizó las dos del SELECT y **olvidó
  el WHERE**, 60 líneas más arriba: la orden con el faltante ya saldado seguía saliendo en el
  listado de `soloPendientes` y en su conteo, enseñando «Por recibir» = 0 **en su propia fila**. Al
  tocar una, se tocan las cuatro.
- **Los impresos también llevan la cubeta**: el Excel y el PDF del tablero WIP analítico tienen
  columna **«Saldados»** junto a «Incompletas» (`indicadores/impresos/{excel,pdf}.ts`), porque los
  dos declaran la identidad `enviado = recibido + incompletas + saldados + por recibir` como razón de
  ser de esas columnas. Sin ella, la hoja no cuadra para cualquier orden con cierre vivo. ⚠️ La
  prueba del PDF asevera sobre la TABLA (`COLUMNAS_ORDENES_WIP` / `filaOrdenWip`, exportadas para
  eso), no sobre los bytes: medido por mutación, `@react-pdf/renderer` **no truena** por una fila
  corta —la dibuja corta—, así que «el PDF se generó» no prueba nada sobre su alineación.
- **Permisos**: `produccion.recibo` (cerrar) · `produccion.cancelar` (deshacer) · `produccion.wip-ver`
  (ver). **Ninguno nuevo** ⇒ no requiere `SEED_ON_START`.
- **Gancho para el futuro**: el acto emite el evento de outbox **`cierre-maquila-resuelto`**. Hoy nadie
  lo consume (el despachador del auto-avance ignora en silencio los tipos que no conoce), y está puesto
  para que el **congelado del costo** (fila 0.061) se cuelgue de ahí sin rediseñar el acto.

## ⭐⭐ CERRAR LA ORDEN ENTERA y congelar su costo (0.061 — §Post-F9.154(c))

**No es lo mismo que cerrar con un maquilero** (§ de arriba, fila 0.109): aquél es por **orden ×
maquilero × proceso** y salda un pendiente; éste es de la **ORDEN ENTERA** y no habla de nadie en
particular. Se puede cerrar la orden sin haber cerrado con ningún maquilero, y al revés — aunque lo
natural es saldar a los maquileros primero, porque la orden cerrada ya no lo deja hacer.

**La pregunta que lo originó** (DANIEL): *«¿en qué momento se define que ya se cerró el costo? ¿O va
cambiando?»* La respuesta medida era: **iba cambiando**. El DINERO se persistía
(`CostoOrden.costoTotal`), pero la CANTIDAD del divisor se **re-sumaba en cada lectura**. Con el
divisor en `cortado` casi no se notaba; al pasarlo a `recibido` (la otra mitad de 0.061) el costo
unitario habría quedado **vivo hasta el último recibo, para siempre**.

- **Es un ACTO EXPLÍCITO, nunca automático.** Un cierre por «ya se entregó el 100 %» no sirve, y lo
  desmiente la decisión hermana: como los FALTANTES se cobran y las INCOMPLETAS se merman, esas
  piezas **no vuelven** ⇒ una orden que perdió piezas nunca llega al 100 % y su costo no se
  congelaría jamás. Lo cierra una persona, con permiso propio y bitácora.
- **Dónde vive:** `backend/src/dominio/produccion/cierre-orden.ts` — `cerrarOrden` / `reabrirOrden` /
  `exigirOrdenAbierta`. Rutas `POST /api/ordenes/{id}/cerrar` y `/reabrir`. En la UI, botón
  **Cerrar/Reabrir** en la ficha de la orden (sin entrada de menú nueva).
- **Qué guarda:** `Orden.cerradaEn` (⭐ **la verdad autoritativa**) + `cerradaPorId` + `motivoCierre`,
  y `estado = cerrada`, que es su **espejo visible** (badge y filtros).
- **`cerrada` NO redefine a `completa`.** `completa` habla de la completitud de la **CAPTURA**
  (tallas + receta liberada + arte); `cerrada`, de que la orden **terminó**. Se puede cerrar una
  `capturada`, y al reabrir el estado derivado **se vuelve a computar**. `cerrada`, igual que
  `cancelada`, es **intocable** para los recálculos por requisitos.
- **Congela el costo:** persiste `CostoOrden.cantidadBaseCongelada` + `costoUnitarioCongelado` +
  `congeladoEn`. Desde ahí, la ficha de costeo y la lista de costos devuelven **eso**; las órdenes
  abiertas siguen en vivo. Un cierre **no** recalcula, **no** costea lo que no estaba costeado, y
  **no** toca kardex, WIP, EsMa ni RC.
- **Cierra la puerta a la captura**, con **una sola guarda** aplicada en cada punto de escritura:
  etapas (corte, envío, empaque) y su cancelación · recibos y su cancelación · entregas y su
  cancelación · cierre con maquilero y su deshacer · guardar el costo · encabezado, matriz,
  copiar-matriz, referencias y **cancelar la orden** · precio real de maquila · las mutaciones de la
  receta congelada · y la **cancelación en cascada al cancelar su PEDIDO**, que escribe el estado de
  las OPs directo y por eso lleva su propia comprobación (las nombra por folio y manda a reabrirlas).
- **Siguen libres, y cada uno por su razón:** consultar e imprimir · los **comentarios** (una nota no
  mueve ningún número) · los **adjuntos y las fotos** (son documentales) · `Orden.pagada`
  (`esma/orden-pagada.ts`: dice si al maquilero ya se le pagó, un hecho de la cuenta del tercero que
  no toca el costo de la orden ni su divisor) · y ⭐ **cerrar la receta** (`cerrarReceta`), que es la
  ÚNICA operación de receta que una orden cerrada admite: si la orden se cierra con la receta
  ABIERTA, ésa es la única forma de soltar el candado de la compra, y un candado que sólo se abre es
  una trampa (ver `permitirOrdenNoViva` en `receta-orden.ts`). No toca ni un renglón ni un peso.
- **Reversible sólo por reapertura auditada (D3):** `reabrirOrden`, **mismo permiso**, **motivo
  obligatorio** (el del cierre es opcional: cerrar es el final normal de una orden). Lo congelado
  **no se borra: se MARCA** (`descongeladoEn`), para que quede constancia de con qué números se
  cerró. Cerrar dos veces se rechaza; una orden **cancelada** no se cierra.
- **Estrenar esta versión pide `SEED_ON_START=true`** (permiso nuevo) **y las dos migraciones**
  `20260904130000_estado_orden_cerrada` (sólo el valor del enum, en su propia transacción) y
  `20260904130100_cerrar_la_orden_y_congelar_el_costo`.

## Permisos (RBAC, A4)

`produccion.corte` · `produccion.envio` · `produccion.recibo` · `produccion.entrega` ·
`produccion.cancelar` · `produccion.wip-ver` · `esma.cargo-validar` · ⭐ **`ordenes.cerrar`** (0.061 —
cerrar y reabrir la orden entera; el mismo permiso para las dos direcciones).

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
