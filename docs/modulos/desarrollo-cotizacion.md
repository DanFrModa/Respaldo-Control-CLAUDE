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
renglón por renglón (aprobación modelo por modelo). El precio efectivo es `precioAprobado ?? precioCalculado`.

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
