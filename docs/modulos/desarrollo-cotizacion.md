# Módulo 15 — Desarrollo, Cotización y Listas de Precios (F8)

> Cómo quedó construido el módulo de **Desarrollo, Cotización y Listas de Precios por Cliente** en
> CONTROL v2. No duplica el funcional (ADR-0002): para el QUÉ del negocio, ver
> `Documentacion_MJD/PROPUESTA-Desarrollo-Cotizacion-y-Listas-de-Precios.md`, `DECISIONES.md` §D13 y
> `REQUISITOS-NUEVOS.md` §R16–R20. Aquí va el CÓMO de v2. El detalle por etapa (E1→E6, decisiones y
> trampas) vive en `docs/hoja-de-ruta/F8-etapas.md`.

Construido en F8 (etapas E1 → E6). Es la capa **previa al pedido**: **Desarrollo → precosto persistido
→ lista de precios → negociación por versiones → enganche a la orden de producción** que alimenta el
MRP/OC. **La lista NO dispara pedidos** (el pedido sigue naciendo de la OC del cliente, F2). **Sin ETL
de Access** (la negociación vivía en Excel; arranca en cero).

## Alcance

- **Proyectos** por `Cliente + Departamento` (folio por empresa, A3/A9), con sus **desarrollos** (un
  modelo con **dos números**: el nuestro y el del cliente). Estado del desarrollo **DERIVADO**
  (`en-desarrollo` → `cotizado` → `en-lista` → `ligado-produccion`; `apagado` = borrado suave).
- **Precosto** PERSISTIDO por desarrollo (R17/R18/R19), **versionable** por congelado inmutable
  (base del re-costeo de negociación; espíritu D3: una versión congelada nunca se edita ni se borra).
- **Lista de precios** por `Cliente + Departamento` (R20a): parte de los precostos congelados y aplica
  los **factores del cliente**; el dueño **aprueba/teclea** el precio renglón por renglón; PDF/Excel.
- **Negociación por versiones** (R20b): re-costeo por rondas + acuerdos + estados de lista.
- **Enganche Desarrollo ↔ Producción** (R16, E6): ligar la orden a su desarrollo, sugerir el precio al
  pedido, vista 360 desde la orden y tablero de desarrollos por estado.
- **MRP enganchado** (E6): la explosión hereda los **amarres de precio** de Desarrollo (las telas dejan
  de capturarse a mano en la explosión).
- **Adjuntos R6** de la orden de producción (archivos de apoyo en R2).

## Capas (A1 — lógica solo en dominio)

- **Dominio** `backend/src/dominio/desarrollo/`:
  - `proyectos.ts` / `desarrollos.ts` (E2) — CRUD de proyectos (folio A3/A9, archivo suave) y sus
    desarrollos; el **estado es DERIVADO** (`calcularEstadoDesarrollo` cuenta precostos congelados,
    renglones de lista y órdenes ligadas) y **nunca se persiste** — se calcula. `conteosDesarrollos`
    agrega por estado (lo reusa el tablero de E6).
  - `precostos.ts` (E3) — precosto persistido por desarrollo: a lo más **UN borrador** por desarrollo
    (bajo transacción), congelar = snapshot inmutable con `costoTotal` derivado persistido. Renglones
    de tela/avío/concepto; importes ocultos sin `consultas.ver-importes`.
  - `estados-lista.ts` / `conceptos-costo.ts` (E1) — catálogos de configuración (patrón `tipos-proceso`,
    admin-only server-side): estados de la lista (R20) y conceptos de costo abiertos (R19).
  - `cliente-factores.ts` (E4) — factores del cliente para la fórmula de la lista (sub-recurso del
    cliente, R20a).
  - `listas-precios.ts` (E4) — lista por `Cliente + Departamento`: genera renglones desde los precostos
    congelados aplicando los factores, aprobación del dueño, folio A3/A9, PDF/Excel. Invariante blindada
    en BD (E5): un desarrollo vive en **A LO MÁS UNA lista** (`ListaPreciosLinea.idDesarrollo @unique`).
  - ⭐ **V1-E8f (§Post-F9.128) — QUIÉN CALIFICA es una función pura, no un `where`** (el **alcance** —empresa · cliente · departamento— sigue en el `where`: define el universo, no un descarte). Quién puede
    entrar a una lista lo decide `motivoNoCandidato` (en `listas-precios.ts`): `null` = sí entra; si no,
    devuelve **por qué**, con precedencia declarada `ya-en-lista` > `apagado` > `precosto-borrador` >
    `sin-precosto` — **`ya-en-lista` gana a `apagado` a propósito**: reactivar un desarrollo que ya está
    colocado NO lo vuelve cotizable, así que ese remedio prometería lo que no puede entregar. `diagnosticoCandidatosLista` trae de UNA consulta **todos** los desarrollos del
    cliente+departamento (los apagados y los ya colocados incluidos, que el `where` viejo ni veía) y los
    parte en `candidatos` + `descartados`; `candidatosParaLista` es su proyección a los que sí. ⭐ **V1-E8t
    (§Post-F9.145)** le suma `faltanFactores`: el OTRO requisito de la lista —los factores del cliente—,
    contestado **con la misma función que después bloquea** (`buscarFactoresResueltos`, en
    `cliente-factores.ts`), para que el aviso de la pantalla y el candado del servidor no puedan decir
    cosas distintas. Con él, el diálogo pinta la puerta «Capturar factores» a quien puede cruzarla.
    `crearLista`
    **reusa la misma función** para redactar su rechazo — la regla se escribe una sola vez. El motivo es un
    **código**: la redacción vive en la UI (`frontend/src/modulos/listas-precios/motivos-candidatura.ts`),
    mismo reparto que el estado derivado del desarrollo y sus etiquetas.
    ⚖️ Nace de §Post-F9.96: *un aviso que dice "no hay X" sin decir por qué ni qué hacer ES el defecto*.
  - `negociacion.ts` (E5) — eventos de negociación (rondas con re-costeo + acuerdos) sobre el renglón de
    lista; cambio de estado de lista. `aEventoSalida`/`incluirEvento` son los proyectores que reusa el
    expediente de E6.
  - `liga-orden.ts` (E6) — el **ENGANCHE** (ver abajo).
  - Los amarres de precio los resuelve `backend/src/dominio/costos/resolucion-precios.ts`
    (`resolverPrecioTela` / `resolverPrecioAvio`), compartido con el precosto y con el MRP.
- **Sub-recursos habilitadores (E1):** precios de tela por proveedor/color (R17, `tela-proveedores`,
  bajo `telas.*`), departamentos del cliente (bajo `clientes.*`) y medidas por talla del BOM (R18,
  `medidas-avio-talla`, bajo `modelos.*`).
- **API** `backend/src/api/desarrollo/*.rutas.ts` + `adjuntos-orden.rutas.ts` — handlers delgados.
- **Contrato** `backend/src/contrato/esquemas/{proyecto,desarrollo,precosto,lista-precios,negociacion,
  liga-orden,adjunto-orden,concepto-costo,estado-lista,cliente-factores,tela-proveedor,
  modelo-avio-talla}.ts`.
- **Frontend** `frontend/src/modulos/desarrollo/` (proyectos + tablero), `.../listas-precios/`
  (lista + negociación) y la sección **Desarrollo** / **Adjuntos** en el detalle de la orden.

## Esquema de datos (Prisma)

`Proyecto` (folio A3/A9, Cliente+Departamento+Temporada) → `Desarrollo` (idModelo + `numeroCliente`;
`apagado` soft-delete con motivo) → `Precosto` (versionable, `EstadoPrecosto` borrador/congelado,
`costoTotal` snapshot al congelar) + sus renglones. `ListaPrecios` (folio A3/A9, `EstadoLista`
configurable) → `ListaPreciosLinea` (**`idDesarrollo @unique`**, `precioCalculado` + `precioAprobado`)
→ `NegociacionEvento` (rondas/acuerdos, cronológico). Enganche: `DesarrolloOrden` (`idOrden @unique` —
una orden liga a lo más UN desarrollo; un desarrollo tiene N órdenes por resurtidos). Adjuntos R6:
`OrdenArchivo` (puente `Orden`↔`Archivo`, `idArchivo @unique`, espejo de `ProveedorArchivo` sin `tipo`).

## Resolución de precios en cascada (compartida precosto ↔ MRP)

- **Tela** (`resolverPrecioTela`, 4 pasos): **amarre-color** (`TelaProveedorColor.precio` del proveedor
  amarrado si maneja precio por color) → **amarre** (`TelaProveedor.precio`) → **color-referencia**
  (precio del color por referencia) → **sugerido** (`Tela.precioSugerido`, el de F7). Sin nada ⇒ `null`.
- **Avío** (`resolverPrecioAvio`): **amarre** (`AvioProveedor.precio` del proveedor amarrado, **tal
  cual**: desde V1-E8a el precio ya está en unidad de consumo y no se divide por nada, §Post-F9.97) →
  fallback F4 "más barato" (que sí filtra `activo`). Sin amarre usable ⇒ fallback.

## Fórmula de la lista de precios (R20a)

El renglón parte del **precosto congelado** del desarrollo (`costoTotal`) y aplica los **factores del
cliente** (`cliente-factores`) → `precioCalculado`. El **dueño** revisa y teclea el `precioAprobado`
renglón por renglón (aprobación modelo por modelo). En pantalla y en los defaults internos (p. ej. el
precio sugerido al ligar la orden) el precio efectivo es `precioAprobado ?? precioCalculado`; **en los
documentos que salen al cliente, NO** — ahí sólo vale el aprobado (ver abajo).

### ⭐ Los cuatro factores son SÓLO DEL DUEÑO (V1-E8b, §Post-F9.125)

Daniel, 26-ago-2026: *"los factores sólo yo los puedo mover y no son visibles para nadie más"*. Margen,
descuentos, regalías y costo de ventas — en el **snapshot de la lista** y en el **catálogo del cliente**:

- **Moverlos** exige `listas.aprobar` (antes: `listas.administrar`, que llega hasta Ventas).
- **Verlos** exige `listas.aprobar` (antes: `consultas.ver-importes`, que Desarrollo tiene y necesita).
  El criterio es UNO —`puedeVerFactoresDePrecio` en `dominio/desarrollo/cliente-factores.ts`— y lo usan
  **CUATRO** proyecciones. ⚠️ **Esta lista es el único CENSO de quién porta el candado: quien agregue la
  quinta tiene que agregarse aquí, o la siguiente persona no sabrá que existe.**
  1. el **snapshot de la lista** (`listas-precios.ts`),
  2. el **catálogo del cliente** (`cliente-factores.ts`),
  3. la **calculadora de la mesa** §4.8 (`simularNegociacion`, cuyo `margenObjetivoPct` **es** el factor
     y cuyo `precioNeto` delata la suma de los otros tres),
  4. ⭐ el **negociador en vivo** (`simularMesa`, V1-E8u/§Post-F9.138) — y ésta aporta un campo que las
     otras no tenían: **`precioSugerido`**, que dividido entre un `costoSimulado` **que teclea quien
     pregunta** entrega el multiplicador combinado de los cuatro factores. Por eso va con el mismo
     candado.
  Las 3 y la 4 comparten además la proyección (`proyectarMargen`, `negociacion.ts`), así que el candado
  se aplica en un solo sitio para las dos. Sin el permiso, todos esos campos salen `null`.
  ⚠️ **V1-E8w revisó el censo y NO agregó una quinta**: el **target price** del cliente
  (`precioTarget`/`cumpleTarget`, §Post-F9.150) **no lleva el candado**, y la razón está medida, no
  supuesta — el target lo puso el CLIENTE y el objetivo lo teclea quien pregunta, así que ninguna
  división entre ellos despeja los factores. Lo que sí los habría delatado —compararlo contra el
  `precioSugerido`— sigue tapado, porque el sugerido ya sale `null` sin `listas.aprobar`. Hay una
  prueba dedicada a eso (`negociacion.int.test.ts`, *"el target NO abre la quinta puerta"*).
- **Moverlos TUMBA las aprobaciones** de la lista, con nota de qué las invalidó y cuándo. La firma vieja
  no se borra (D3): va al `NegociacionEvento` inmutable y a la bitácora. Es el MISMO criterio que la
  ronda de negociación ya aplicaba al cambiar el costo — antes eran dos reglas para el mismo hecho.
- ⚠️ **Límite declarado y ACEPTADO por Daniel:** quien ve el costo y el precio saca el margen con una
  división. Se oculta el número, no la aritmética; cerrarlo exigiría quitarle el costo o el precio a
  Desarrollo y eso rompería su trabajo.

### ⭐⭐ La MESA de negociación (V1-E8u + V1-E8w, §Post-F9.138/.139/.144/.149/.150/.153)

La mesa es el renglón *"casi como si fuera un excel"* con el que Daniel negocia **con el cliente
enfrente**, dentro del panel de negociación del renglón. Va en las **dos direcciones**: se escribe el
**precio** y sale el **margen**; se mueve un **costo** y se mueven el margen **y** el precio sugerido.

**Cómo está armada** (tras V1-E8w):

- **Un campo por RENGLÓN del precosto, no por concepto.** `desgloseCostoLinea` devuelve los grupos **con
  sus `lineas`** (id, descripción, `consumo`, `precioUnit`, `importe`) además del subtotal. Antes sólo
  devolvía el subtotal y la mesa **no podía ver el detalle**: era eso lo que impedía mover el consumo de
  la tela o un avío suelto.
- **La tela lleva DOS perillas** (`consumo` y `precioUnit`) porque son **dos movimientos distintos del
  negocio**; el **producto lo hace el servidor** (`resolverRenglonesMesa`, `negociacion.ts`) — A1: un
  multiplicador que decide un precio no vive en la pantalla.
- **Los avíos se abren desglosados** en un panel encima (la única salida de pantalla que Daniel
  concedió), con los de la **receta** y los **estimados** que se agreguen ahí.
- **Foto principal del modelo**, prefirmada en el desglose de ESE renglón (no en la lista: sería una
  firma R2 por modelo en cada carga).
- **Target price del cliente**, si lo dio: pegado al precio, con badge «llega / no llega». **Informa, no
  bloquea.**
- 🔴 **El simulador NO escribe nada** (`simularMesa`: un solo `findFirst`; probado con la huella md5 de
  todas las tablas antes/después). **Los importes son LIBRES**: no hay `idAvio`/`idTela` en el contrato,
  porque en la mesa no se da de alta nada — es el mismo cuidado que evitó que el catálogo de medidas se
  volviera a fragmentar (§Post-F9.106).
- ⭐⭐ **Lo ÚNICO que escribe es `guardarMesa`** (§Post-F9.149): un botón explícito **al terminar**, que
  deja un `NegociacionEvento` con sus `NegociacionEventoCosto` — el **desglose completo**, inmutable,
  con el comentario, el autor y la fecha. **No hay autosave**, no hay historial de tanteos, y guardar
  **no aprueba el precio ni cambia la receta**: es la constancia de con qué se vendió, y la materia prima
  con la que Desarrollo arma la receta revisada.
- **Cero aritmética en el cliente.** Importes por renglón, subtotales por concepto, costo total, margen,
  precio sugerido y veredicto del target vienen todos del servidor. *(Hasta la 0.059 había una suma local
  declarada; desapareció al dejar de gatear la consulta con `listas.aprobar` — el servidor ya oculta sólo
  los cinco campos derivados de los factores.)*

### ⭐ El costo de EMPAQUE, tercera ancla fija (V1-E8w, §Post-F9.153)

Todo precosto nace con **tres renglones `manual` auto-creados, únicos y no eliminables**: `maquila`,
`corte` y —desde V1-E8w— **`empaque`** (`CONCEPTOS_ANCLA`, `precostos.ts`). El importe del empaque sale de
**`ConfiguracionEmpresa.costoEmpaqueBase`** (default 2.20, editable en Administración › Empresas): Daniel
lo pidió movible *sin deploy* porque va a subir.

🔴 **Cambiarlo NO reescribe nada de lo ya hecho.** Cada precosto guarda su **copia** del importe; el
default alimenta sólo los renglones que **nacen** después, y un precosto **congelado** no se toca jamás
(D3). Consecuencia que hay que decir: **el empaque sube $2.20 el costo de toda receta nueva**, y las
listas ya congeladas conviven un tiempo con precios sin él.

⚠️ La regla del ancla es **"renglón ÚNICO por precosto"**, no *"concepto prohibido"*: escrita como veto al
concepto dejaba sin salida a todo borrador anterior a la versión que estrena un ancla nueva (recalcular no
toca los `manual`). Si mañana se agrega una cuarta ancla, esto ya no vuelve a ser un problema.

⚠️ **Estrenar un ancla exige `SEED_ON_START=true`** en el deploy: sin el concepto sembrado,
`generarPrecosto` truena con *"falta el concepto de costo base …"*.

### ⭐ Sin aprobación no sale documento, ni borrador (V1-E8b, §Post-F9.125(c))

Daniel: *"si no está aprobado no debería de poder bajar ni un borrador porque puede confundir al
cliente"*. La **cotización**, el **impreso PDF de la lista** y el **Excel de la lista** comparten el
guard `exigirRenglonesAprobados` (`dominio/desarrollo/cotizaciones.ts`): rechazan (409) **nombrando los
modelos** que faltan, y también la lista vacía. Antes el PDF y el Excel bajaban
`precioAprobado ?? precioCalculado` — un papel con precios que nadie autorizó, idéntico al bueno.

### ⭐ Si la receta cambia bajo un precio ya aprobado, el sistema AVISA (V1-E8d, §Post-F9.127)

Daniel: *"Si. Ok. **Que me avise.**"* El renglón guarda un **precosto CONGELADO** (inmutable, D3) y una
copia de su costo, así que cambiar la **receta del modelo** no mueve ninguno de los dos: hay que congelar
una versión nueva **y** registrar una ronda, las dos a mano.

- **La señal:** `Modelo.recetaTocadaEn` + `Modelo.recetaTocadaCambio`, escritas **sólo** por
  `tocarModeloPorCambioDeReceta` (`dominio/modelos/revision-modelo.ts`), el embudo obligatorio de las 6
  puertas de la receta. **No** se usa `Modelo.modificadoEn`: es `@updatedAt` y lo mueven 11 escrituras que
  no son receta, así que el aviso habría nacido gritando en falso.
- **El criterio, UNO:** `avisoDeCostoViejo` (`dominio/desarrollo/costo-viejo.ts`) — función pura que
  devuelve **la frase completa** (qué parte de la receta cambió, cuándo, contra qué versión) o `null`.
  La proyección del renglón la entrega en `avisoCostoViejo`; **no** va tras `consultas.ver-importes`
  (no lleva ni un número de dinero).
- **Dónde se ve:** pegado a su renglón en la lista de precios, en el resumen del encabezado de esa tabla,
  y en el diálogo de **emitir cotización**. Avisa **también sin aprobar** (*"…antes de aprobar"*), y **se
  apaga solo** al recostear: no hay estado muerto.
- 🔴 **Es un AVISO, no una firma que se cae**, a diferencia de §Post-F9.116 y §Post-F9.125(d). Ahí cambia
  **exactamente aquello sobre lo que se firmó**; aquí el precosto congelado **no cambió ni puede
  cambiar**, y un cambio de receta puede no mover el costo ni un peso. **Consecuencias declaradas:** el
  aviso se puede ignorar —la cotización, el PDF y el Excel siguen saliendo— y un desfase **anterior al
  despliegue** no se detecta (la columna nace en NULL = *no se sabe*).

## Negociación por versiones (R20b)

Sobre el renglón de lista se registran **eventos**: **rondas** (re-costeo → nueva versión de precosto,
guardando `precioAnterior`/`precioNuevo` y las versiones) y **acuerdos** (texto, sin re-costeo). El
historial es cronológico y de solo lectura en el expediente. Los **estados de lista** modelan el avance
de la negociación (catálogo configurable).

## Enganche Desarrollo ↔ Producción (E6 — `liga-orden.ts`)

Cinco operaciones, toda la lógica en el dominio (A1), importes ocultos sin `consultas.ver-importes`:

- `ligarOrden` (`desarrollo.administrar`) — crea la `DesarrolloOrden` en transacción (A2) validando
  **mismo modelo Y mismo cliente** que la orden, misma empresa (A9), desarrollo no apagado, orden no
  cancelada ni ya ligada (el `@unique` blinda la carrera → `ErrorConflicto`). El estado del desarrollo
  pasa a `ligado-produccion` **solo por el derivado** (no se toca a mano).
- `quitarLiga` (`desarrollo.administrar`) — borra la fila (la liga es una relación viva, no un snapshot
  D3) + bitácora.
- `sugerenciaLigaOrden` (`desarrollo.ver`) — desde una orden NO ligada: el desarrollo **candidato**
  (mismo modelo+cliente+empresa, no apagado, aún no ligado; se prefiere el que ya tiene renglón de
  lista) + `precioSugeridoPedido` = precio del renglón de lista más reciente (`precioAprobado ??
  precioCalculado`). **Es un default editable; NO escribe el pedido.**
- `expedienteOrden` (`desarrollo.ver`) — **vista 360** desde la orden ligada: proyecto, desarrollo
  (estado derivado), precosto vigente (última versión CONGELADA + costo), renglón de lista/precio y
  acuerdos de negociación (solo lectura). Reusa los proyectores de negociación.
- `tableroDesarrollos` (`desarrollo.ver`) — conteos de desarrollos por estado **agregados en el
  servidor** (reusa `conteosDesarrollos`; nunca se pivota en el cliente, lección F5-E7), filtrable por
  cliente/departamento/temporada.

**Precio al pedido (punto de diseño):** el enganche **surfacea** el precio sugerido/acordado en la UI
(prominente, default editable) pero **NO pre-llena `PedidoLinea.precio`** — el precio del renglón del
pedido lo aplica el editor de Pedidos de F2 (no se metió mano en el dominio de pedidos). La liga no
dispara ni modifica el pedido.

## MRP enganchado (E6 — `backend/src/dominio/compras/mrp.ts`)

Ver `compras-mrp.md` §"Enganche con Desarrollo (F8-E6)". En resumen: la explosión hereda el amarre de
tela (`ModeloTela.idTelaProveedor`) y resuelve su precio con la cascada compartida; los avíos anteponen
el amarre (`ModeloAvio.idAvioProveedor`) y, sin amarre, caen al fallback "más barato" de F4 (no
regresión); el consumo de avío por talla (R18) se compra por medida×curva; y los casos ambiguos (tela
multi-color con precios distintos, proveedor amarrado inactivo, talla sin medida) **no truenan en
silencio**: van al arreglo `avisos` de la salida (visible en la UI de la explosión).

## Adjuntos R6 de la orden (E6)

Archivos de apoyo (Excel/PDF/imágenes) ligados a la **orden de producción** en R2, vía el flujo
presigned de F0 (`backend/src/dominio/produccion/adjuntos-orden.ts`). Espejo de los adjuntos de
proveedor (F1-E1B) **sin clasificación documental** (`tipo`). Permisos `ordenes.ver` (listar/descargar)
y `ordenes.administrar` (subir/eliminar) — **reusa el RBAC de órdenes, sin permisos nuevos**. El DELETE
borra el registro `Archivo` (Cascade arrastra `OrdenArchivo`) **y el objeto físico de R2 en modo
best-effort** (nuevo `ServicioArchivos.eliminarObjeto`, salda la deuda técnica §8: los adjuntos de
orden ya no dejan huérfanos en R2; extender a modelos/bordados/proveedores queda de backlog).

## RBAC

`desarrollo.ver` / `desarrollo.administrar` (proyectos, desarrollos, enganche), `desarrollo.precostear`
(precostos), `listas.ver` / `listas.administrar` (listas + negociación) — todos **sembrados en E1**;
E6 **no agrega permisos** (el enganche reusa `desarrollo.*`; los adjuntos reusan `ordenes.*`). Importes
ocultos server-side sin `consultas.ver-importes`; la UI deriva la visibilidad del permiso real, no de
inferir `null`.

⭐ **V1-E8b (§Post-F9.125) NO agrega permisos tampoco** —así que **no requiere `SEED_ON_START`**—: mueve
tres cosas al `listas.aprobar` que ya existía y ya estaba repartido (Administrador ·
AdministracionDireccion · Directivo; **Gerencial NO**, se le resta en el seed):

| Qué | Antes | Hoy |
|---|---|---|
| Editar factores de la lista (`PATCH /listas-precios/:id/factores`) | `listas.administrar` | **`listas.aprobar`** |
| Guardar factores del cliente (`PUT /clientes/:id/factores`) | `listas.administrar` | **`listas.aprobar`** |
| VER los cuatro factores (lista · cliente · simulación) | `consultas.ver-importes` | **`listas.aprobar`** |

## Decisiones y desviaciones

- **D13 / R16–R20** — todas las sub-decisiones las cerró Daniel (ver `DECISIONES.md`).
- **Estado del desarrollo DERIVADO** (nunca persistido) — igual criterio que el estado de la orden (F2).
- **La lista NO dispara pedidos** — el pedido nace de la OC del cliente (F2); la liga solo amarra el
  expediente a la orden.
- **Precio al pedido: surface, no pre-fill** — el enganche muestra el precio sugerido/acordado como
  default editable pero no escribe `PedidoLinea.precio` (eso es del editor de Pedidos F2).
- **Borrado físico R2 best-effort** — se agregó `eliminarObjeto` al motor de archivos; se aplica a los
  adjuntos de orden. Extenderlo a modelos/bordados/proveedores es backlog.
- **Sin ETL** — la negociación arranca en cero (vivía en Excel).
- **Tablero por estado como PESTAÑA** del módulo Desarrollo (no entrada de menú nueva): el `/desarrollo`
  tiene dos pestañas (Proyectos / Tablero por estado).
