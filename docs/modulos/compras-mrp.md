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

- **`omitidos`** — lo que NO entra, con su razón: `sin-proveedor` · `ya-en-oc` · `cubierto-por-stock` ·
  `no-seleccionado` · `sin-cantidad`, cada uno con una frase lista para pintar. Antes se descartaba en
  **silencio**. Los omitidos viajan también en el **resultado de generar**.
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
viaja por el API— y **`autorizarOC` las detiene** hasta que alguien capture la cantidad. La fecha de
entrega y la dirección de esas OC salen de la **orden de producción** y de la **favorita** del
catálogo; si falta alguna, el error dice exactamente qué falta.

**El catálogo de direcciones nace vacío** a propósito (una dirección es dato del negocio): se captura
en *Catálogos › Direcciones de entrega* antes de la primera OC.

## ¿Cuándo queda RECIBIDA una OC? (§Post-F9.19)

Un solo lugar decide: la función pura **`dominio/compras/tolerancia-recepcion.ts`** (`renglonSurtido`
/ `faltantePorRecibir`). La usan los TRES sitios que antes comparaban a mano —
`recalcularEstatusOC` (estatus R7), `resumenOC` (`porRecibir` del tablero) y
`lineasTelaPendientesDeProveedor` (lo que ofrece la captura de la factura)— para que no puedan
divergir.

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

## Reglas que el módulo respeta

A1 (lógica en dominio) · A2 (recepción/confirmación/reverso en transacción) · A3 (folios por
secuencia) · A4 (permisos server-side, deny-by-default) · A7 (Bitácora) · A9 (idEmpresa) ·
D1 (costo en el movimiento) · D3 (existencia = Σ movimientos, nunca editable) · D5 (lote N
componentes) · R1 (proveedor/precio/factor) · R3 (explosión) · R7 (estatus por orden) · R9 (impresos).
