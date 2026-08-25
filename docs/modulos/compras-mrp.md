# Módulo — Compras / MRP (F4)

> Cómo quedó construido el módulo de **Compras y MRP** en CONTROL v2. No duplica el funcional
> (ADR-0002): para el QUÉ del negocio, ver `Documentacion_MJD/03-Produccion.md` §Órdenes de Compra,
> `REQUISITOS-NUEVOS.md` §R3/R7/R1 y `DECISIONES.md` §"Decisiones de diseño F4". Aquí va el CÓMO de v2.

Construido en F4 (etapas E2 → E6). El inventario de telas/avíos que lo sostiene está en
[`inventario-telas-avios.md`](inventario-telas-avios.md).

## Alcance

Órdenes de compra (OC) contra catálogo, recepción de material (R7) con entrada al kardex, explosión
MRP por orden (R3), tablero "qué tengo / qué falta" (R7) y notas de salida estructuradas (R4). Todo
**Make-to-Order**: se compra por orden de producción, no para stock (salvo el neteo de genéricos).

## Capas (A1 — lógica solo en dominio)

- **Dominio** `backend/src/dominio/compras/`:
  - `ordenes-compra.ts` — `crearOC` / `actualizarOC` / `autorizarOC` / `cancelarOC` / `duplicarOC` /
    `obtenerOC` / `listarOC`. Folio `NumCompra` por **secuencia atómica por empresa** (A3, nunca
    `Max()+1`). Estatus como **enum** (`borrador` / `pendiente_autorizacion` / `autorizada` /
    `recibida_parcial` / `recibida_total` / `cancelada`). Autorización exige el permiso
    `compras.autorizar` (ex-acceso #8) y registra usuario+fecha en `Bitacora` (A7). OC autorizada
    **bloqueada** salvo admin (decisión **(a)**) + "Duplicar a nueva OC". El `Totales` viejo NO se
    almacena: es derivado de las líneas.
  - `recepciones.ts` — `recibirCompra` / `reversarRecepcion`.
    - ⚠️ **Desde §Post-F9.14 (7-ago-2026) la TELA no se recibe por aquí:** `recibirCompra` rechaza
      los renglones de tela apuntando a la factura. La tela se recibe capturando la
      **factura/remisión** del proveedor (`dominio/inventarios/entradas-tela.ts`) con cada renglón
      ligado a su `OrdenCompraLinea`; al confirmarla llama a `registrarRecepcionesDesdeEntradaTela`
      (en este mismo archivo), que escribe **esta misma contabilidad** —una `RecepcionCompra` por OC
      surtida, recálculo de estatus R7 y evento `material-recibido`— **sin mover inventario otra
      vez** (reusa la partida y el movimiento de la entrada). Una sola puerta = la tela no se puede
      recibir dos veces. `reversarRecepcionesDeEntradaTela` hace el camino inverso al cancelar la
      factura. Los locks de OC se toman al PRINCIPIO de la tx y en orden ascendente en AMBAS puertas
      (`bloquearOrdenesDeRenglones`), para que no se traben entre sí. Consulta de apoyo:
      `lineasTelaPendientesDeProveedor` → `GET /api/compras/lineas-tela-pendientes`.
    - **Avíos y líneas libres** siguen recibiéndose desde la OC, sin cambio. `recibirCompra` es
      **UNA transacción (A2)**: valida OC `autorizada`/`recibida_parcial` (decisión **(b)**,
      deny-by-default A4) y el almacén destino (`comun/almacenes.ts`), folio A3, crea
      `RecepcionCompra`/`Linea`, registra la entrada al kardex (`entrada-recepcion`) **convirtiendo
      cantidad ×factor y costo ÷factor** (invariante de valuación
      `cantidad×costoUnit = cantidadOC×precioOC`, D1/D3), recalcula el estatus de la OC **bajo
      `pg_advisory_xact_lock` por OC** (namespace `bigint` `0x4f43`, anti-carrera R7) y **publica
      `material-recibido` vía OUTBOX transaccional** (el evento nunca se pierde; consumidor en F5).
      `reversarRecepcion` = movimiento(s) inverso(s) auditado(s) (D3) que destraba el candado de
      cancelación de OC. Contrato del evento + patrón outbox en **ADR-0011**.
    - *Histórico:* entre **B1** (6-ago) y **§Post-F9.14** (7-ago) esta misma función recibía TELA por
      color creando su `PartidaTela`; ese código se retiró al dejar una sola puerta. Las recepciones
      de tela creadas en ese lapso siguen vivas y son idénticas a las que escribe la factura.
    - **La TELA es DEL proveedor de la OC (§Post-F9.15):** `validarLineas` rechaza un renglón cuya
      tela tenga otro dueño (`Tela.idProveedor`), nombrando al dueño real; al EDITAR se valida
      contra el proveedor que va a quedar. **Excepción deliberada:** tela sin dueño (migrada) pasa
      —bloquearla dejaría OCs viejas inmodificables, y el catálogo se captura desde cero—. La
      pantalla acota el selector al proveedor y **no consulta telas hasta tener uno**; cambiar de
      proveedor limpia las telas capturadas. El servidor es la autoridad (A1); el filtro es ayuda.
  - `mrp.ts` — el **corazón MRP** (R3/R7):
    - `explosionarOrden` — requerido = `consumoPorPrenda` del BOM con bandera `paraProduccion` ×
      Σ piezas color×talla de la orden, para **telas Y avíos**; SIEMPRE por orden. Persiste el
      snapshot `RequerimientoOrden` (borra+reescribe en UNA tx → congela la explosión aunque el BOM
      cambie) y devuelve el **diff** vs el snapshot previo.
    - **Genéricos (decisión (d)):** un avío `esGenerico` se **netea contra existencia REAL** del
      kardex (`existenciaAvioTotalEmpresa` de `comun/kardex.ts`, Σ pura de lectura de PLANEACIÓN, sin
      lock ni guard); solo el faltante va a compra.
    - `explosionarOrdenes` (⭐ V1-E3q) — la explosión ya es de un **CONJUNTO de OP**;
      `explosionarOrden` es su atajo de una sola. Ver la sección *La compra desde la explosión*.
    - `planearCompra` / `previoCompraDesdeExplosion` / `generarOCDesdeExplosion` (⭐ V1-E3q) — **un
      solo cálculo** para la revisión previa y para la generación: agrupa el pendiente **por
      proveedor** → una OC por proveedor, **reusando `crearOC`** (A3/A7) y ligando **cada línea a su
      orden de producción** (R7 sin prorrateos); precio desde `AvioProveedor` (R1).
    - `estatusMaterialesOrden` — cruce **on-demand** Requerido(snapshot) vs En-OC vs Recibido →
      `pendiente`/`en-oc`/`recibido-parcial`/`completo`. Las líneas libres → `no-identificado` (no
      inflan); canceladas/reversadas no cuentan. Desde V1-E3q el "En-OC" sale de
      `comprometido-en-oc.ts`, **la misma función que netea la explosión**.
  - `comprometido-en-oc.ts` (⭐ V1-E3q) — **LA verdad de "cuánto de este material ya está en una OC"**,
    por orden de producción. Ver abajo.
  - `reparto-ordenes.ts` (⭐ V1-E3q) — función PURA que reparte un total entre OP en proporción a lo
    que cada una necesita (el **sobrante de compra**), con la última absorbiendo el residuo.
  - `migracion.ts` (F4-E6) — `crearOCMigrada`: modo migración (A1) con folio explícito `NumCompra`,
    estatus/autorización/cancelación legacy explícitos, líneas legacy SOLO texto libre, ligas N:N,
    **SIN kardex ni RecepcionCompra**.
- **Notas de salida** `backend/src/dominio/notas/notas-salida.ts` — `crearNotaSalida` /
  `actualizarNotaSalida` / `confirmarNotaSalida` / `cancelarNotaSalida` / `obtener` / `listar`.
  `confirmarNotaSalida` en UNA tx (A2) descuenta el kardex **solo de los AVÍOS** (`salida-por-nota`)
  bajo advisory lock por nota (`bigint` `0x4e53`). Los renglones de **TELA solo REFERENCIAN** una
  salida-a-orden ya registrada (`idMovimientoSalidaTela`) y **nunca generan segundo movimiento**
  (decisión **(e)**, anti-doble-descuento estructural + `validarRenglones`). Almacén origen en el
  **encabezado** (decisión **(g)**). Folio `NumNota` A3, soft-cancel, A7/A9.
  `notas/migracion.ts` (F4-E6) — `crearNotaMigrada`: folio explícito, estatus `confirmada` histórico
  **SIN descontar avíos ni tocar tela**, renglones SOLO `descripcionLegacy`.
- **API** `backend/src/api/compras/` y `.../notas-salida/` — rutas REST con permiso verificado
  server-side en cada una; OpenAPI regenerado + cliente del frontend sincronizado. Permisos:
  `compras.ver/.administrar/.cancelar/.autorizar/.recibir`, `notas.ver/.administrar/.cancelar`.
- **Frontend** `frontend/src/modulos/{compras,notas-salida}/` — listado/captura de OC, bandeja de
  autorización (móvil), compras por orden, recepción de **avíos** (la tela se recibe por su factura
  desde §Post-F9.14: el renglón de tela se muestra deshabilitado con la nota de a dónde ir),
  explosión (⭐ V1-E3q: conjunto de OP con chips + **«Revisar y generar OC»** → revisión previa →
  confirmar), tablero "qué tengo / qué falta" (semáforo, móvil),
  captura/consulta de notas. Impresos PDF (R9): OC, recepción/estatus, explosión y nota de salida.
  - **Proveedor de la OC acotado por sus renglones (§Post-F9.12, 7-ago-2026):** el selector del
    encabezado se filtra en vivo por el rol (R15) que piden los renglones capturados — solo telas →
    `vende-telas`, solo avíos → `vende-avios`, **mixta o solo líneas libres → sin acotar** (una OC
    mixta es legítima y el filtro no debe estorbar una compra real). El proveedor **ya capturado se
    conserva** como opción aunque no cumpla el rol vigente (OCs viejas o migradas), para no perder
    el dato en silencio.

## ⭐ La compra desde la explosión (V1-E3q — §Post-F9.85 y §Post-F9.86)

Nació de Daniel probando en vivo el 20-ago-2026: *"me vuelvo a meter en la pantalla y sigue apareciendo
ahí los elementos y **me deja volver a hacerla**"*, *"una **revisión previa** es indispensable"*, y
*"normalmente compramos **varias OP con una sola OC**"*. Tres piezas que se sostienen entre ellas.

### 1. Cuánto ya está comprado — `comprometido-en-oc.ts`

Es **el único lugar** del sistema que responde *"¿cuánto de este material ya está en una orden de
compra?"*. Lo leen **el tablero R7, la explosión, la revisión previa y la generación**, para que nunca
digan números distintos sobre lo mismo. Devuelve `idOrden → (material → { enOc, recibido })`.

**Qué estatus cuentan: TODOS menos `cancelada`** (`ESTATUS_OC_QUE_CUBREN`, escrita extensiva a propósito
para que un estatus nuevo obligue a decidir a mano).

- **`borrador` SÍ cuenta** — es el corazón del arreglo: la OC que genera el MRP **nace en borrador**, así
  que si no contara, la explosión volvería a proponer la misma compra y el defecto seguiría vivo. La
  pregunta que responde este módulo no es *"¿ya me comprometí a pagar?"* sino *"¿este material ya está
  cubierto por un documento vivo?"*.
- **`cancelada` no cuenta** — cancelar es la manera documentada de deshacer (D3); si contara, una OC
  cancelada por error dejaría a la orden sin poder recomprar nunca.

⚠️ **NO es el criterio del COSTO, y es deliberado.** `ultimo-precio-compra.ts` (D1/§Post-F9.48) sólo
cuenta `autorizada` y `recibida_*`, porque ahí la pregunta es *"¿qué precio pagó de verdad la empresa?"*.
**Dos preguntas distintas, dos criterios distintos**, cada uno escrito donde se usa.

En la salida de la explosión eso se traduce en dos campos por renglón: **`cantidadEnOc`** y
**`cantidadPendiente` = max(0, cantidadAComprar − cantidadEnOc)**. Sólo lo pendiente se compra. **Nada de
esto se persiste**: cambia cada vez que alguien crea o cancela una OC, sin que nadie vuelva a explotar.

### 1bis. 🔴 La ESCALA manda desde el DESTINO (`Decimal(14,2)`)

Estas cantidades nacen en columnas de **4** decimales (el snapshot `RequerimientoOrden`, el BOM) y
acaban en una de **2**: `OrdenCompraLinea.cantidad Decimal(14,2)`. La primera versión de la etapa
repartía y comparaba a 4, y **el defecto que la etapa venía a arreglar seguía vivo**: el renglón
reaparecía con una astilla de `0.002`, se encadenaban OC con líneas en `0.00` quemando folios (A3), y
`Σ(líneas) ≠ lo comprado`, con lo que **la revisión previa mentía**.

La regla, en `reparto-ordenes.ts`:

- **`ESCALA_CANTIDAD_COMPRA = 2`**, y `redondearCantidadCompra` **se deriva de ella** (una constante
  que no gobierna lo que dice gobernar es una mentira con otro disfraz).
- **Lo PENDIENTE** (`max(0, aComprar − enOc)`) se calcula y se compara en esa escala, en la explosión
  y en el plan — los dos tienen que decir el mismo número.
- **El reparto cierra la Σ en esa escala**, con la última OP absorbiendo el residuo: la suma de lo
  GUARDADO es exactamente lo comprado.
- **El corte de "¿queda algo por comprar?"** es `MINIMO_CANTIDAD_COMPRA` = media unidad del último
  dígito guardable (`0.005`), **no** la `TOLERANCIA` de `1e-6` de `mrp.ts` (que sigue siendo la buena
  para las columnas de 4 decimales: el snapshot y el semáforo R7).
- **Una línea que se guardaría como `0.00` no se escribe**, y un ajuste por debajo del mínimo **se
  rechaza diciendo por qué** en vez de crear un documento vacío.

**El mismo hueco vivía en el PRECIO** (`OrdenCompraLinea.precio Decimal(12,2)`): el precio sugerido
sale de `precio ÷ factorConversion` (R1) y trae colas larguísimas, así que la previa prometía
**5,999.99** donde la OC guardaba **5,999.40**. El precio se redondea a la escala de su columna
(`redondearPrecioCompra`) y el **importe** se calcula con `redondear2(cantidad × precio)` — **la misma
función** con la que `aCompraSalida` deriva el subtotal de la línea, para que los dos totales no
puedan separarse.

> 🔴 **La lección:** *un número no está bien calculado hasta que está bien **guardado**.* Y la
> segunda: el comentario que decía *"la BD guarda 4 decimales"* es lo que hizo que nadie mirara la
> columna — **un comentario puede mentir tan caro como el código**.

### 2. La revisión previa — `planearCompra`

`planearCompra` es la **única** función que decide qué se compra. `previoCompraDesdeExplosion` la pinta
(`POST /api/explosion/previo`, **no escribe nada**) y `generarOCDesdeExplosion` la ejecuta. Una revisión
previa que calculara por su cuenta sería una promesa que el sistema no cumple.

Devuelve, por proveedor, la **OC completa que saldría** (renglones, cantidades, **reparto por OP**,
fecha, importes) más:

- **`omitidos`** — lo que NO entra, con su razón: `sin-proveedor` · `ya-en-oc` · `menor-al-minimo` ·
  `cubierto-por-stock` · `no-seleccionado` · `sin-cantidad`, cada uno con una frase lista para pintar.
  Antes se descartaba en **silencio**. Los omitidos viajan también en el **resultado de generar**.
  ⚠️ **`ya-en-oc` exige que de verdad haya algo en una OC** (`seGuardaComoAlgo(cantidadEnOc)`): lo que
  falta pero no llega al mínimo pedible y **no** tiene OC detrás es `menor-al-minimo`. Sin esa
  distinción la previa afirmaba *"ya está en una orden de compra viva (0 pza)"* sobre un documento
  inexistente. **La lista de motivos sólo vale si cada motivo es verdad.**
- **`bloqueos`** — lo que impediría generar (falta la dirección favorita, falta la fecha de un
  proveedor). Se **devuelven** en la previa y se **lanzan** al generar, con las mismas frases: mismo
  cálculo, dos maneras de reaccionar.

**Permiso: `compras.administrar`** (no `compras.ver`). La previa es la primera mitad de la acción de
comprar, no una consulta — §Post-F9.68, esconder Y bloquear.

### 3. Una compra para varias OP — "se ve junto, se guarda repartido"

El modelo ya lo aguantaba (`OrdenCompraLinea.idOrden` + la liga N:N `OrdenCompraOrden`); faltaba el
camino. El conjunto de OP se llena de **dos maneras con el mismo control**: **precargado** con las OP del
pedido interno (`GET /api/ordenes/:id/del-mismo-pedido`; las canceladas se listan pero no se precargan) o
**a mano**, agregando OP sueltas con el buscador.

- **La pantalla AGRUPA** por material+proveedor; **la OC guarda una línea por (material, OP)**. Sin ese
  desglose el *"qué tengo / qué falta"* de cada OP deja de cuadrar y el costo no cae donde debe
  (innegociable de Daniel).
- **El SOBRANTE de compra se reparte** (`ajustes` en el cuerpo → `repartirEntreOrdenes`): el comprador
  teclea el TOTAL —el rollo completo, el mínimo del proveedor— y **el servidor** lo reparte en proporción
  a lo que cada OP necesita, con la última absorbiendo el residuo del redondeo (la suma cuadra exacta).
  La pantalla no reparte nada (A1).
- **El FALTANTE de la recepción NO se reparte** (Daniel tumbó esa propuesta): *"los consumos son
  estimados… a la hora de ir descargando las telas es cuando se va a poder saber a cuál aplica"*. Entran
  al almacén los kilos que llegaron y cada OP se lleva lo que de verdad se lleva. No es contradicción con
  lo anterior: el sobrante es un hecho **al comprar**; el faltante es un dato que **todavía no existe**
  cuando llega el material.
- **La fecha de la OC** = la propia del proveedor (§Post-F9.71) → la del formulario → **la entrega MÁS
  PRÓXIMA de las OP que esa OC surte** (la más lejana llegaría tarde a la otra).
- **El stock de avíos genéricos se REPARTE entre las OP del lote** (`existenciaCompartida`): explotarlas
  por separado le daría a cada una la existencia completa y el sistema compraría de menos. El orden es
  determinista (por folio ascendente: la OP más vieja, que se produce antes, se queda con el stock).

### Endpoints

| Endpoint | Permiso | Qué hace |
|---|---|---|
| `POST /api/explosion` | `compras.ver` | Explosiona el CONJUNTO de OP del cuerpo y persiste su snapshot |
| `POST /api/ordenes/:id/explosion` | `compras.ver` | Atajo de una sola OP (mismo cálculo) |
| `GET /api/ordenes/:id/del-mismo-pedido` | `compras.ver` | Las OP del mismo pedido interno (precarga) |
| `POST /api/explosion/previo` | `compras.administrar` | ⭐ La revisión previa. **No escribe nada** |
| `POST /api/explosion/generar-oc` | `compras.administrar` | Crea las OC del plan |

⚠️ Los endpoints viejos `POST /api/ordenes/:id/explosion/generar-oc` **se retiraron**: la compra viaja
con `idsOrden` en el cuerpo.

## ⭐⭐ La tela se compra POR COLOR (V1-E3u — §Post-F9.89)

Daniel: *"cuando se hace la receta no lleva el color, solo lleva la tela. Pero al pedir la tela… tengo
que pedir el color en cada modelo. **Debo de tener la posibilidad de ir comprando esa tela en diferentes
colores (y pantones)**"*.

### El hueco que tapa

**El sistema obligaba a RECIBIR por color y no dejaba PEDIR por color.** El kardex de telas exige
`MovimientoDetTela.idTelaColor` desde F1; la receta de la OP (`OrdenTela`) y el renglón de OC
(`OrdenCompraLinea`) sólo llevaban `idTela`. Consecuencia diaria: **quien recibe inventaba la
correspondencia**, y la misma tela en tres tonos era un renglón que no decía cuánto de cada uno. Y como
`TelaColor` guarda **precio** y **precio de complemento por color**, un renglón sin color **no tenía el
dato con el que decidir cuál era el precio**.

### Las dos nociones de color, y el puente

| Concepto | Tabla | Qué es |
|---|---|---|
| Color de **PRENDA** | `Color` + `OrdenLinea.idColor`/`.pantone` | el de la matriz color×talla de la OP |
| Color de **TELA** | `TelaColor` (nombre libre, pantone, precio, precio de complemento) | lo que el proveedor manda y el almacén recibe |
| **El puente** ⭐ | **`OrdenTelaColor`** (`idOrdenTela` + `idColor` → `idTelaColor`) | *"para ESTA OP, el marino de la matriz es este color de esta tela"* |

El puente vive **en la orden**, no en el catálogo ni en el BOM: el modelo define la TELA (y eso está
bien), el COLOR es de cada pedido. Mismo criterio que `OrdenTela.idProveedorCompra` (§Post-F9.82).

### El sistema PROPONE, la persona CAPTURA

`dominio/compras/casar-color-de-tela.ts` (puro) propone, en orden de evidencia: **liga del catálogo**
(`TelaColor.idColor`, la liga legada) → **mismo pantone** → **mismo nombre** → **único color sin
ambigüedad posible** (una orden de un color contra una tela de un color) → **sin propuesta, y lo dice**.
La propuesta **no se guarda sola**: mientras nadie confirme, no hay renglón en `OrdenTelaColor`.

⚠️ Estas reglas **no se metieron a la cascada de PRECIOS** (`resolverPrecioColorReferencia` sigue casando
sólo por liga y nombre): una regla nueva para *proponer* es barata —la persona la ve y confirma— y una
regla nueva para *valuar* movería números del precosteo que nadie pidió mover.

### Qué cambia en la explosión

- **Un renglón por tela×COLOR**, con `piezas de ESE color × consumo por prenda` — el color sale de la
  matriz que ya existía. La Σ no cambia: partir no compra ni un gramo de más.
- **El precio del color**: se llena por fin el escalón `color-referencia` de la cascada única con
  `TelaColor.precio` (el MRP nunca lo llenaba porque el renglón no sabía de qué color era). Sigue por
  debajo del precio negociado con ESE proveedor, que es más específico.
- **Lo que falta por decir sale en `pendientesColor`** (D3) — y **su cantidad se sigue comprando** en un
  renglón sin color, para que la OP no se quede corta por un dato pendiente de capturar.
- **La agrupación es `material|color|proveedor`**: dos OP que piden el mismo color caen en un renglón
  (decisión (c) de Daniel) y **siguen guardándose una línea de OC por OP** (§Post-F9.86 intacta).

### El desvío AVISA a quien autoriza — y NO bloquea

La línea de OC guarda **`cantidadSugerida`** (lo que el sistema calculó) junto a `cantidad` (lo que
Compras tecleó). El aviso **se arma al leer**, con el umbral vigente de la empresa
(`ConfiguracionEmpresa.pctDesvioCompra`, **default 10 %**), y viaja en `avisoDesvio` de cada renglón.

🔴 **Nada de esto impide autorizar.** El control vive en la autorización que ya existe (§Post-F9.64: *guía,
no jaula*); una tranca en la captura sólo enseñaría a rodearla y el sistema perdería el dato real sin
ganar el control. Se avisa **de más y de menos** (comprar de menos es más peligroso: la OP se queda corta
y nadie se entera hasta que falta la tela). El umbral es 10 % porque el negocio ya reconoce el **5 %**
como variación normal (§Post-F9.19), redondear al rollo cae casi siempre por debajo del 10 % —y ése es un
ajuste legítimo (§Post-F9.86)— mientras que **un rollo entero de más sí lo pasa**.

⭐ **Dónde lo VE la persona** (y no sólo el JSON — fue lo que faltaba al cerrar la etapa):

| Pantalla | Qué enseña |
|---|---|
| *Compras › **Autorización*** | La **tarjeta** avisa *"N renglones se apartan de lo que el sistema calculó"* **sin abrir nada**, y el detalle **nace abierto** cuando hay desvío. Un aviso que hay que ir a buscar no avisa. |
| Detalle de la OC (bandeja y listado) | El renglón enseña `calculado: N` al lado de lo pedido y, en **su propia fila** a todo lo ancho, la frase completa que armó el servidor. |
| Botón **«Autorizar»** | 🔴 **No mira nada de esto.** Es el punto entero de la decisión. |

⚠️ El aviso **se arma al leer, nunca se guarda como texto**: congelarlo lo dejaría envejecer (se cambia
el umbral de la empresa y el papel seguiría diciendo el viejo), y además no se podría re-ordenar ni
filtrar. Lo que se guarda es el **dato** (`cantidadSugerida`).

⭐⭐ **Y dónde se avisa de lo que el sistema ELIGIÓ** (§Post-F9.89, `cantidadEnOcSinColor`). Las OC
anteriores a la etapa piden la tela sin color; al netear hay que atribuir esos kilos a **algún** tono, y
cuando no alcanzan para todos **el orden de las filas decide**. Es irreducible —adivinar el color
escribiría como HECHO una suposición (§Post-F9.86)— pero **no se calla**:

| Dónde | Qué dice |
|---|---|
| Renglón de la **explosión** | *"de ese «ya en OC», N kg vienen de una orden que no dice de qué color era"* |
| Renglón de la **revisión previa** | *"se le restaron N que vienen de una orden que no dice de qué color era… esto se está comprando de menos"* — es la última pantalla antes de comprometer el dinero |
| Renglón **OMITIDO** por `ya-en-oc` 🔴 | el detalle deja de afirmar a secas y añade *"⚠ Ojo: N… esto se está quedando sin comprar"*, y la fila se pinta como aviso |

🔴 **La tercera es la que muerde:** ese renglón **desaparece de la compra**, y la frase *"no hace falta
volver a comprarlo"* afirma un hecho que el sistema no puede sostener si la atribución fue una elección.
Es el mismo fallo que §Post-F9.85 cerró: *no basta con no callarse; hay que no mentir*.
⚠️ La Σ por renglón la hace el **dominio** (`elegidoDe`), no la pantalla (A1).

⚠️ Y `cantidadSugerida` en `null` significa **"no hay contra qué medir"** (la línea se capturó a mano),
que NO es lo mismo que *"no hubo desvío"*: la pantalla no enseña leyenda ninguna, en vez de inventar un
`calculado: 0`.

### Corregir el precio del color ACTUALIZA EL CATÁLOGO

Decisión (b) de Daniel. Permiso **`compras.administrar`** (no uno nuevo: nacería sin asignar a nadie y
cerraría el camino que la decisión vino a abrir). Exige, y cumple:
- **auditoría A7**: quién, cuándo, **de cuánto a cuánto** y **desde qué OP u OC**;
- **que se vea**: la respuesta trae el ANTES y el DESPUÉS, y la pantalla avisa que *"aplica a todas las
  compras futuras de ese color"*.

### La recepción CRUZA el color

`registrarRecepcionesDesdeEntradaTela` rechaza un renglón de factura cuyo color no sea el que pidió la
OC… **sólo cuando el renglón de OC trae color**. Un renglón sin color se recibe exactamente como antes:
convertir ese `null` en un rechazo dejaría sin poder recibir a las ~7,978 OC migradas.

### Lo viejo no se rompe (y nada se backfilea)

La migración es aditiva y todo nace NULL. El neteo contra lo ya comprado sigue cuadrando gracias a
`repartirComprometidoPorColor`: cada renglón se queda con lo de SU color y el **acervo sin color** va al
renglón sin color si lo hay —y si no, se reparte por necesidad con el último absorbiendo el remanente—.
Con un solo renglón sin color (el caso de todo lo migrado) devuelve el acervo COMPLETO: el número de
siempre. **No se adivina el color de nada**: adivinarlo escribiría como HECHO una suposición.

### El tablero R7 sigue siendo POR MATERIAL

Y es a propósito: ahí la pregunta es *"¿tengo la tela para producir?"*, no *"¿tengo cada tono?"* —es la
decisión (c) vista desde el almacén—. Además `comprometidoEnOc` está indexado por material: una fila por
color leería el `enOc` del material completo en cada una. **Se suma primero y se cruza después.**

### 🔴 Los AVÍOS: se midió, y el hueco no es el mismo

No hay `AvioColor`, `MovimientoDetAvio` no tiene color y la recepción no lo pide. En la tela el color
existía en los dos extremos y faltaba el eslabón de en medio; **en el avío no existe en ninguna parte**.
Es otra etapa (catálogo + kardex + recepción + migración) y queda **propuesta sin construir**
(`HOJA-DE-RUTA.md` §4).

### Endpoints

| Método | Ruta | Permiso |
|---|---|---|
| `GET` | `/api/ordenes/:id/colores-tela` | `compras.ver` |
| `PUT` | `/api/ordenes/:id/colores-tela` | `compras.administrar` |
| `PUT` | `/api/telas-colores/:idTelaColor/precio` | `compras.administrar` |

## Enganche con Desarrollo (F8-E6)

El MRP dejó de tratar la explosión como un cálculo "a ciegas": ahora **hereda los amarres de precio
de Desarrollo** (módulo 15, ver [`desarrollo-cotizacion.md`](desarrollo-cotizacion.md)). Los cambios en
`mrp.ts` (`explosionarOrden`):

- **Telas del amarre.** Si el BOM tiene la tela amarrada (`ModeloTela.idTelaProveedor` con su
  `TelaProveedor`), el MRP **hereda el proveedor** y resuelve el precio con la cascada compartida
  `resolverPrecioTela` (**amarre-color → amarre → color-referencia → sugerido**, `dominio/costos/
  resolucion-precios.ts`). **Sin amarre → NULL** (comportamiento previo a F8: proveedor/lote se deciden
  al comprar, D5; captura manual). Así las telas **dejan de capturarse a mano** en la explosión cuando
  vienen del amarre.
- **Prioriza el amarre de avío.** Los avíos anteponen el amarre `ModeloAvio.idAvioProveedor`
  (`resolverPrecioAvio`, precio ÷ `factorConversion`); **sin amarre usable, caen al "más barato" de F4**
  (fallback intacto → NO-REGRESIÓN; ese fallback sí filtra `activo`).
- **Avíos por medida × talla (R18).** El consumo de avío por talla se compra por la **medida × la curva**
  de la orden (piezas agrupadas por talla), no por un consumo plano por prenda.
- **`avisos: string[]` en la salida.** Los casos ambiguos **no truenan en silencio**: **proveedor
  amarrado INACTIVO** (se mantiene la sugerencia —Desarrollo lo eligió a propósito y la OC no valida
  `activo`— pero se avisa), **tela amarrada multi-color con precios de tela distintos** (se usa el precio
  BASE del amarre y se avisa) y **talla sin medida capturada** (se usa el consumo por prenda y se avisa).
  El frontend de la explosión pinta estos avisos en un callout.

Sin migración, sin permisos nuevos (reusa `compras.*`). La liga orden↔desarrollo que habilita todo esto
la administra el módulo 15 (`DesarrolloOrden`); el MRP solo la consume por el `idModelo`/BOM de la orden.

## ⭐ A QUIÉN SE LE COMPRA (V1-E3m, §Post-F9.82) — corrige una desviación de F8

Daniel, con la receta liberada y la explosión enfrente: *"no me deja hacer nada… ahí veo todo, pero no
puedo avanzar"*. Ningún renglón traía proveedor sugerido, y sin proveedor el botón de generar OC no
enciende. **No faltaba una función: el motor ignoraba una regla que ya estaba en los datos** —
`Tela.idProveedor`, el proveedor **DUEÑO** del artículo (§Post-F9.11) — porque desde F8 resolvía solo por
el amarre de `TelaProveedor`, pensado para material que se compra a varios.

La política de proveedor vive ahora en un módulo **PURO** y probado sin Postgres,
`dominio/compras/proveedor-material.ts` (`mrp.ts` arma los candidatos y él decide):

| Material | Cascada de PROVEEDOR |
|---|---|
| **Tela** | amarre de Desarrollo → **DUEÑO de la tela** (`Tela.idProveedor`) → asignación de Compras |
| **Avío** | amarre de Desarrollo → **HABITUAL** (`AvioProveedor.habitual`) → más barato (F4) → asignación de Compras |

- **El "más barato" de F4 NO se retira**: es el fallback del avío que nadie marcó como habitual, así que
  ningún avío con **varios** proveedores cambia de comportamiento (ahí el habitual solo nace de una
  decisión humana).
- ⭐ **El BACKFILL de la migración, y su alcance exacto.** `20260820120000_proveedor_del_material` marca
  habitual al avío que tiene **un solo `AvioProveedor`, y solo si ese proveedor está ACTIVO**. Es el único
  caso sin decisión que tomar, y es lo mismo que hace la pantalla al agregar el primer proveedor. Efecto
  real: con precio, el "más barato" ya elegía a ese mismo (misma respuesta); **sin** precio, el renglón
  deja de salir *"sin proveedor"* y nace con el precio de REFERENCIA, avisado.
  ⚠️ **El filtro de `activo` no es cosmético:** sin él, un avío cuyo único proveedor está de baja quedaría
  marcado y el renglón saldría **comprable con un proveedor muerto** — `candidatoHabitualAvio` conserva al
  inactivo a propósito y `crearOC` no valida `activo` —, en una migración que nadie va a deshacer. Lo cubre
  `dominio/catalogos/backfill-habitual.int.test.ts`, que **ejecuta el SQL leído del archivo de migración**
  (no una copia), así que aflojar el `WHERE` pone la prueba en rojo.
- **Precio del dueño/habitual**: su precio negociado si lo tiene; si no, el de **REFERENCIA**
  (`Tela.precioSugerido` / `Avio.precioReferencia`) **con aviso** — son cosas distintas y confundirlas fue
  parte del atorón. Encima de todo sigue mandando **la última compra REAL a ese mismo proveedor** (D1).
- **Proveedor propuesto DE BAJA:** la sugerencia se conserva (alguien la eligió y la OC es editable) y la
  explosión lo avisa, pero además el renglón viaja con `proveedorSugeridoInactivo` y la pantalla **ofrece
  reasignarlo ahí mismo**. Sin eso el aviso no tenía salida: `crearOC` no valida `activo` y el catálogo
  tampoco deja guardar con un proveedor desactivado.
- **La asignación de Compras va HASTA ABAJO, a propósito** (`OrdenTela/OrdenAvio.idProveedorCompra` +
  `precioCompra`): vive **en la orden**, jamás en el catálogo, y por estar en el último escalón **no puede
  pisar a Desarrollo**. Si queda sin usarse porque el catálogo aprendió el proveedor, la explosión lo
  **dice** en un aviso (D3). Se administra con `PUT /api/ordenes/:id/materiales/proveedor`
  (`compras.administrar`, `dominio/compras/proveedor-de-orden.ts`), que rechaza el renglón que no está en
  la receta, el **excluido** y el proveedor **desactivado**.
- **El botón «Generar OC» apagado explica por qué**, nombrando los materiales sin proveedor.
- El renglón de la explosión viaja con `origenProveedor` (`amarre-desarrollo` / `dueno-tela` / `habitual` /
  `mas-barato` / `asignado-compras` / `sin-proveedor`): es lo que le deja a la pantalla distinguir lo que
  puede quitar de lo que no le toca.

⚠️ **Lo que NO cambió:** la cascada de PRECIOS compartida (`costos/resolucion-precios.ts`). El precosteo
sigue valuando el avío sin amarre con «el más barato»; ver la pregunta abierta en `HOJA-DE-RUTA.md` §4.

## Migración del histórico (F4-E6)

ETL idempotente, por lotes, CP850, vía dominio modo-migración (`backend/migracion/`):

- `loaders/ordenes-compra.ts` (`OrdCompra`+`OrdCompraDet`+`OrdCom-Ord` → `OrdenCompra`/`Linea`/N:N) y
  `loaders/notas-salida.ts` (`Notas`+`NotasDet` → `NotaSalida`/`Linea`). Orquestador
  `etl-compras-notas.ts` (imprime cuadre + escribe `reporte-etl-f4e6-compras-*.txt`).
- **Decisiones de migración** (registradas en `DECISIONES.md` §"ETL F4-E6"):
  1. Las **OC y notas legacy NO mueven kardex** ni crean `RecepcionCompra` (el viejo no liga
     entrada↔OC; las entradas de tela las migra el ETL de inventario, ver el otro doc). Las notas
     legacy son documento histórico `confirmada` sin descontar avíos (anti-doble-conteo).
  2. **Líneas legacy = texto libre** (`OrdCompraDet.Descripcion`→`descripcionLibre`,
     `NotasDet.Descripcion`→`descripcionLegacy`); NO se mapean a catálogo (R7 no cruza el histórico).
     `Totales` NO se migra (derivado).
  3. **Estatus OC derivado** del legacy (cancelada > autorizada > borrador); los `recibida_*` exigen
     recepciones que el histórico no crea.
  4. **Usuarios viejos** sin mapeo → `IdUsuAutorizado`/`IdUsuCancelado` preservados como texto
     `legacy:<id>` (columnas sin FK, ADR-0005). *(A ratificar: NULL vs `legacy:` — ver reporte.)*
  5. **Almacén sentinela** para notas (el viejo no tenía almacén origen y `idAlmacen` es NOT NULL):
     almacén `(histórico — sin almacén)` global + inactivo, creado por el propio ETL.
  6. **idEmpresa de la nota** derivado de la primera orden mapeable de sus renglones (folio por
     empresa, A9); sin orden mapeable → nota omitida + listada.
  7. **Ventana temporal CONFIGURABLE** (`ETL_VENTANA_ANIOS`, default **0 = sin recorte**; el recorte
     real lo hace el mapeo de empresas — solo migran las activas 7=Marilyn Fitness y 8=FR Moda; las 6
     empresas viejas inactivas se omiten y listan, consistente con la decisión de no migrar su
     historia). El reporte siempre imprime la config de ventana y lo excluido.
- **Nada se pierde en silencio (§7):** toda FK no resuelta, cantidad negativa saneada, registro fuera
  de ventana y colisión de unique se OMITE *y se LISTA* en el reporte de cuadre. El cuadre de Gabriel
  es **reporte-vs-reporte** entre corridas, no contra cifras a mano.

## Reglas de captura de la OC (§Post-F9.18, dictadas por Daniel)

Seis reglas que el **dominio** impone (la UI solo ayuda; el servidor es la autoridad, A1):

| Regla | Dónde vive | Nota |
|---|---|---|
| La **fecha de emisión** la pone el servidor (hoy) | `crearOC`/`duplicarOC` (`hoyColumna()`) | No viaja en ningún cuerpo de entrada. El histórico entra por `crearOCMigrada` y conserva la suya. |
| La **fecha de entrega** es obligatoria y no se vacía | `esquemaCompraCrear` (requerida) / `esquemaCompraEditarCuerpo` (opcional **no** nullable) | Las migradas sin fecha siguen editables. |
| La **dirección de entrega** sale del catálogo | `DireccionEntrega` + `exigirDireccionEntregaValida` | Global (ADR-0007), favorita única, gobernada por `compras.*` (sin permisos propios). El texto se **copia** a `entregaEn` para impresos/consultas viejas. |
| La **unidad** de un renglón de tela la manda la tela | `validarLineas` (normaliza con `ETIQUETA_UNIDAD_TELA`) | Ignora lo que venga en el cuerpo. En **avíos** sigue libre (presentación ≠ unidad de consumo, R1). |
| Una OC liga **varias OP** | `OrdenCompraLinea.idOrden` → N:N derivado | Ya existía; se hizo visible en la UI y quedó probado. |
| La tela se compra **con su complemento** | `validarLineas` + `exigirComplementosCapturados` | `cantidadComplemento`/`precioComplemento` por renglón; el importe suma al subtotal. |

**El complemento y la explosión MRP** (la única excepción, cerrada sin inventar datos): el BOM guarda
un solo `consumoPorPrenda` por tela, así que la explosión **no sabe** cuánto complemento comprar. Sus
OC nacen con `cantidadComplemento` en NULL —vía la bandera interna `automatica` de `crearOC`, que NO
viaja por el API— y **`autorizarOC` las detiene** hasta que alguien capture la cantidad. La
**dirección** de esas OC sale de la **favorita** del catálogo; la **fecha de entrega** hay que
capturarla a mano al generar las compras (la de arriba para todas, o una por proveedor) — 🔴 desde
**V1-E7f (§Post-F9.120) NO se hereda de la orden de producción**: la fecha de la OP es cuándo se le
entrega al CLIENTE y la de la OC es cuándo tiene que llegar la TELA, así que copiarla dejaba el campo
lleno con un número imposible que se ve legítimo. Si falta, el error nombra a los proveedores que se
quedarían sin fecha y no se genera nada.

**El catálogo de direcciones nace vacío** a propósito (una dirección es dato del negocio): se captura
en *Catálogos › Direcciones de entrega* antes de la primera OC.

## ¿Cuándo queda RECIBIDA una OC? (§Post-F9.19)

Un solo lugar decide: la función pura **`dominio/compras/tolerancia-recepcion.ts`** (`renglonSurtido`
/ `faltantePorRecibir`). La usan los TRES sitios que antes comparaban a mano —
`recalcularEstatusOC` (estatus R7), `resumenOC` (`porRecibir` del tablero) y
`lineasTelaPendientesDeProveedor` (lo que ofrece la captura de la factura)— para que no puedan
divergir. Desde V1-E3s también la usan `lineasPendientesDeOC` y **`ocsRecibibles`** (el *"qué trae
pendiente"* de cada OC en el buscador de la recepción): **un solo criterio, cinco lectores.**

| Caso | Cierra el renglón cuando… |
|---|---|
| Tela, sin complemento | cuerpo recibido ≥ pedido × **0.95** (*"nunca se recibe la cantidad exacta"*) |
| Tela, con complemento en la OC | **ambos** alcanzan su mínimo con la misma banda (*"si en la OC lleva cardigan, se debe de recibir el cardigan"*) |
| Avío / línea libre | recibido ≥ pedido × **0.95** — *"en avíos también puede haber una diferencia"* |

La banda vive en **`TOLERANCIA_POR_TIPO`** (`tela` / `avio`), hoy 5% las dos: separadas para poder
afinar una sin tocar la otra. **La cantidad recibida siempre se captura** (la recepción de avíos y la
factura de telas la piden y la dejan diferir): el dominio nunca la asume igual a la pedida.

Dentro de la banda, lo que falte **deja de contar** como faltante en el tablero. El complemento que
la OC pidió **sí cuenta** hasta que llega, valuado a `precioComplemento` o, si no trae, al precio del
cuerpo.

El tablero *"qué tengo / qué falta"* (`calcularEstatusMaterial`) usa la **misma banda**: sin ella
diría "recibido parcial" para siempre, contradiciendo a la OC que ya se dio por recibida.

**Segunda etapa (pendiente, decidido así por Daniel):** **autorizar** una recepción cuya diferencia
pase del 5%. Hoy esa diferencia simplemente no cierra el renglón — no se bloquea nada. Usará el mismo
`TOLERANCIA_TELA`.

## ⭐ Recibir empieza por el PROVEEDOR (V1-E3s — §Post-F9.87)

Daniel: *"No tiene caso empezar por el número de orden. **En la realidad cuando vas a recibir algo,
buscas al proveedor que llegó a entregar.**"*

**El punto de partida de la recepción es el proveedor**, no la OC. El servicio que lo sostiene es
**`ocsRecibibles`** (`dominio/compras/recepciones.ts`), expuesto en
**`GET /api/compras/ordenes-recibibles?idProveedor&numCompra&limite`** (`compras.ver`, acotado a la
empresa activa):

- Devuelve las OC **abiertas** (`autorizada` + `recibida_parcial`) del proveedor pedido, con **número,
  fecha, estatus y qué trae pendiente**: cuántos renglones faltan de cuántos, y los materiales que
  faltan **por nombre** (hasta 3 + *"+N más"*). Eso es lo que permite reconocer la OC en el andén sin
  abrirlas una por una.
- El **pendiente lo calcula el dominio** (A1) con el **MISMO** criterio del estatus y del resto de la
  recepción (`faltantePorRecibir`, ver la banda de tolerancia arriba) — no una derivación paralela. La
  pantalla no resta cantidades.
- **`numCompra` es el ATAJO** (el número que trae la remisión), coincidencia exacta. Proveedor y número
  **acotan juntos**: los dos filtros están a la vista, así que el resultado siempre se explica mirando
  la pantalla — ningún filtro se cae solo.
- 🔴 **El tope se DECLARA.** La respuesta trae `total` (cuántas cumplen el filtro de verdad) y
  `truncado`; la pantalla lo dice y ofrece el atajo (*"Se muestran 50 de 300 OC abiertas"*). Esto nació
  de un defecto vivo: el `<select>` anterior se llenaba con **dos consultas de 100** y las OC de más
  abajo eran **INALCANZABLES** — y empeoraba sola con cada OC nueva.
- ⚠️ **Lo que el tope SÍ sigue limitando, dicho sin adornos:** *navegando* no se pasa de `limite` (no
  hay "siguiente página"); a cualquier OC se llega **por su número**, que es lo que el aviso ofrece.
  Aceptable **sólo mientras el orden ponga adelante lo que importa** (ver abajo). Si algún día hace
  falta pasear por las viejas de un proveedor, lo que toca es **paginar**, no subir el tope.
- ⭐ **El orden es por CREACIÓN (`id desc`), NO por folio.** Hoy el folio **no es monótono con la
  creación**: los ETL dejaron las secuencias en cero (las OC nuevas toman folios 1, 2, 3…, §Post-F9.85,
  arreglo manual pendiente) y el ETL migra toda OC histórica autorizada como `autorizada` **sin crear
  recepciones**, así que las ~7,978 migradas quedan **abiertas para siempre** con folios altos. Con
  `numCompra desc`, un proveedor con más de `limite` OC históricas abiertas habría devuelto una página
  de pura historia dejando fuera la OC recién creada. `id` crece con la creación y no depende de que
  alguien corra nada.
- La **raíz** del defecto está cerrada aparte del tope: la **OC elegida se pide POR ID**
  (`GET /api/ordenes-compra/{id}`), no se busca dentro de la página que se trajo.

⭐⭐ **V1-E3u — el color se DICE en pantalla, no sólo en el impreso.** `descripcionMaterial`
(`modulos/ordenes-compra/piezas.tsx`) devuelve *"Tela · Color"*, así que lo dicen los tres lados que la
usan: **detalle de la OC**, **recepción** y **compras por orden** — más el chip de color en la explosión
y en la **revisión previa**. Antes el color viajaba en la línea y sólo se imprimía: quien recibe
comparaba la factura contra una OC que **en pantalla** no decía de qué color era, que es justo la
fricción que §Post-F9.89 vino a quitar.

⚠️ **`recibirCompra` no cambió**: esto es cómo se **ELIGE** la OC, no cómo se recibe. Y en la pantalla
el proveedor se busca con **`SelectorProveedor`** —*EL* selector de proveedor de la app, sobre el
`ComboboxBuscable` del kit en modo `busquedaServidor`—, no con un desplegable propio.


## Reglas que el módulo respeta

A1 (lógica en dominio) · A2 (recepción/confirmación/reverso en transacción) · A3 (folios por
secuencia) · A4 (permisos server-side, deny-by-default) · A7 (Bitácora) · A9 (idEmpresa) ·
D1 (costo en el movimiento) · D3 (existencia = Σ movimientos, nunca editable) · D5 (lote N
componentes) · R1 (proveedor/precio/factor) · R3 (explosión) · R7 (estatus por orden) · R9 (impresos).
