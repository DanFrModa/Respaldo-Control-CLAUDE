# Bitácora de cambios de UI pedidos por Daniel

> Registro de ajustes de interfaz solicitados directamente por Daniel (dueño del sistema). Cada
> entrada indica la fecha, qué se cambió, por qué y los archivos tocados. Todos los cambios se hacen
> sobre la base vigente del sistema (rama `prueba`).

---

## 2026-07-18 — Órdenes de producción: foto arriba + navegación con flechas

Ambas mejoras se hicieron sobre la base de **`prueba`**, en la pantalla
`Órdenes de producción` (`/produccion/ordenes`, `CentroOrdenesPagina`).

### A) La FOTO del modelo ahora se ve ARRIBA, "luego luego"

Antes, la foto del modelo estaba **enterrada** en la zona con scroll del panel de detalle (había que
bajar para verla). Daniel pidió que la foto sea de **lo primero que se ve** al seleccionar una orden,
sin hacer scroll.

- La foto se **movió a la zona FIJA de arriba** del panel de detalle, justo debajo del encabezado
  (OP + modelo + cliente) y encima de los mosaicos de acciones. Se **quitó** de la zona con scroll
  (no está duplicada).
- El componente de la foto muestra una **tira de miniaturas** (`size-16`); al hacer clic en una se
  abre **ampliada** en el visor `VisorImagen`. Reutiliza `useFotosModelo` y el visor que ya existían.
  (Nota: en la primera versión de este día la miniatura seleccionada se mostraba también como una
  foto principal grande; ese diseño se descartó ese mismo día — ver *"Ajustes posteriores"* abajo —
  y el estado final es **solo miniaturas + visor al clic**.)
- Si el modelo **no tiene fotos**, no se pinta ningún bloque (no queda hueco feo).
- Responsive PC + móvil, con el mismo tema del rediseño (bordes redondeados, realce de marca
  `ring-primary`).

### B) La LISTA de órdenes se navega con las FLECHAS del teclado (↑/↓)

- **ArrowDown / ArrowUp** mueven la selección al renglón siguiente / anterior, con **clamp** (no
  envuelve del último al primero ni al revés).
- La selección va por el **mismo camino que un clic** (la misma fuente de verdad, `idSeleccionada`;
  sin estado paralelo), así que el panel de detalle se actualiza igual.
- Se hace `preventDefault()` para que la página no haga scroll; pero se **ignora** la flecha si el
  foco está en un `INPUT` / `TEXTAREA` / `SELECT` (para no romper el buscador ni los combobox de
  filtro).
- Al moverse, el **foco pasa al renglón seleccionado** y se hace `scrollIntoView({ block: 'nearest' })`
  (protegido para no truncar en las pruebas de jsdom). Se usan **refs** a los renglones (escritorio) y
  a las tarjetas (móvil), no `document.querySelector`.

### Archivos tocados / creados

- `frontend/src/modulos/ordenes/FotosModeloOrden.tsx` — foto a la zona de arriba: tira de miniaturas
  + visor al clic.
- `frontend/src/modulos/ordenes/CentroOrdenesPagina.tsx` — foto movida a la zona fija de arriba;
  navegación con flechas (refs + manejador de teclado); `tabIndex`/foco en los renglones.
- `frontend/src/modulos/ordenes/FotosModeloOrden.test.tsx` — **nuevo**: pruebas de miniaturas y visor.
- `frontend/src/modulos/ordenes/CentroOrdenesPagina.test.tsx` — **nuevo**: pruebas de la foto arriba
  (zona fija) y de la navegación con flechas (incluye el caso "foco en el buscador").
- `docs/cambios-frontend-daniel.md` — esta bitácora.

### Ajustes posteriores del mismo día (revisión de Daniel)

Tras verlo, Daniel pidió tres ajustes de diseño (se mantienen las flechas y las guardas de diálogo):

1. **Foto: solo miniaturas.** Se quitó la foto principal grande. Ahora se ve solo la **tira de
   miniaturas** pequeñas; al hacer clic en una se abre **AMPLIADA** en el `VisorImagen`. Sigue
   devolviendo `null` si no hay fotos. (`FotosModeloOrden.tsx`.)
2. **Zona con scroll más amplia.** Al achicar la foto se libera el espacio de arriba; el área
   scrolleable del detalle usa toda la altura disponible (`flex-1 min-h-0`, sin altura fija chica),
   que ya era su estructura. (`CentroOrdenesPagina.tsx`.)
3. **Rebalanceo del split.** La columna central (tabla de órdenes) se angostó y el panel de detalle
   de la derecha se ensanchó: el grid pasó de `minmax(0,1fr)_360px` a `minmax(0,1fr)_420px`. Sigue
   responsive (móvil intacto). (`CentroOrdenesPagina.tsx`.)

### Fotos de la OP: modelo + subidas a la orden, miniaturas + visor navegable + subir/quitar

Nueva decisión de Daniel: en la OP quiere ver fotos chiquitas al abrir la orden, click para verlas
grandes y "ver más", y que SIEMPRE pueda haber al menos una — combinando **las fotos del modelo** y
**fotos que él sube directo a la orden**. Se hizo **sin backend nuevo**, reutilizando el mecanismo de
**adjuntos de orden** que ya existía.

- **Tira combinada de miniaturas** (`size-16`): primero las fotos del **modelo** (`useFotosModelo`),
  luego las **imágenes subidas a la orden** (`useAdjuntosOrden`, filtradas por `tipoMime` de imagen;
  un adjunto PDF/Excel NO aparece como foto).
- **Visor navegable:** al hacer clic en una miniatura se abre grande y se puede pasar entre TODAS
  (modelo + orden) con flechas **anterior/siguiente** y con el teclado **←/→**, más un contador
  "N / total". Se extendió `VisorImagen` con props opcionales de galería (`alAnterior`/`alSiguiente`/
  `hayAnterior`/`haySiguiente`/`posicion`), 100% retrocompatible con los usos de una sola imagen.
- **Subir foto a la orden:** tile "+" (`accept="image/*"`, ≤50 MB, toasts `sonner`) visible solo con
  `ordenes.administrar` (`useSubirAdjuntoOrden`, presigned a R2). Al subir, la foto aparece sola
  (el hook invalida la query). Si no hay ninguna foto pero se puede administrar, se muestra solo el
  tile (para que "al menos pueda haber una").
- **Quitar foto:** botón basura al hover, solo con `ordenes.administrar` y **solo** sobre las fotos
  subidas a la orden (`useQuitarAdjuntoOrden`); las fotos del **modelo** no se pueden borrar desde
  aquí. Sin fotos y sin permiso, no se pinta bloque.
- Se mantuvo COMPACTO (solo miniaturas + visor) para no tapar la trazabilidad de abajo, y se
  conservan intactas las flechas ↑/↓ de la lista, las guardas de diálogo y el rebalanceo del layout.

Archivos: `frontend/src/componentes/VisorImagen.tsx` (galería opcional),
`frontend/src/modulos/ordenes/FotosModeloOrden.tsx` (tira combinada + subir/quitar + visor),
`frontend/src/modulos/ordenes/CentroOrdenesPagina.tsx` (pasa `idOrden` + `puedeAdministrar` de
`ordenes.administrar` al detalle), y sus pruebas.

### Verificación

`npm run typecheck`, `npm run lint` y `npm run test` en `frontend/` quedaron en verde
(719 pruebas, 0 errores de lint/tipos).

---

## 2026-07-20 — Órdenes: deep-link a la lista, más aire al detalle, ✕ en filtros, altura, e impreso "Orden" + artes

Tanda de 6 mejoras pedidas por Daniel: 4 en la pantalla `Órdenes de producción`
(`CentroOrdenesPagina`) y 2 en el **impreso PDF** de la orden. Como referencia visual del impreso,
Daniel entregó el PDF del impreso viejo de FR Moda (**OP_5341**: "ORDEN DE PRODUCCION", "Numero de
Orden", Distribución del Corte, fotos del modelo en cuadros…).

### A1) Deep-link (buscador ⌘K): la orden queda seleccionada EN LA LISTA

Antes, al llegar por deep-link (`state.idOrden`), el panel derecho cargaba la orden directo, pero si
la fila no estaba en la página visible, la lista no la mostraba. Ahora, si la fila del deep-link
**no está** en la página, el **buscador se pone al folio** de la orden (que el panel ya conoce vía
`useOrden`, misma clave de cache: cero peticiones extra) y se resetean los demás filtros/página,
con lo que el listado la trae y se pinta **seleccionada con su resaltado normal**, como si se
hubiera clickeado. Se aplica **una sola vez** por deep-link (no pisa lo que el usuario teclee
después ni entra en bucle). De pasada se arregló una carrera real: en el primer render, el default
"selecciona la primera fila" podía pisar la selección del deep-link (la cazó la prueba nueva).

Remates de la revisión: si la orden del deep-link **falla** (404/sin permiso/otra empresa) el
pendiente se apaga sin tocar el buscador (antes la query quedaba refetcheando por siempre), y si el
usuario **teclea** en el buscador mientras el folio viene en vuelo, su escritura manda (el deep-link
pendiente se cancela y no le pisa el texto). **Limitación conocida y aceptada:** con un deep-link a
una orden **CANCELADA**, el buscador queda con el folio pero la lista sale vacía (la lista pide
`incluirCanceladas: 'false'`); el panel derecho sí muestra la orden, que es lo que importa del
deep-link.

### A2) La TRAZABILIDAD ya no sale aplastada: la matriz pasó a la zona con scroll

La zona FIJA de arriba del panel de detalle (héroe + fotos + mosaicos + matriz) se comía casi toda
la altura y dejaba a la zona con scroll (trazabilidad, precios, encabezado, tela, desarrollo) un
huequito inservible ("no hay manera de ver nada"). Se dejó **fija solo la parte esencial** (héroe +
miniaturas de fotos + mosaicos + botón de avance) y la **matriz "Cantidades por color y talla" se
movió al INICIO de la zona con scroll**: al abrir una orden se sigue viendo de primera, pero ahora
el área scrolleable dispone de mucha más altura (flex-1 + min-h-0, sin alturas fijas).

### A3) ✕ para limpiar en TODOS los filtros de la barra

Los combobox (Cliente/Maquilero/Estampador) **ya** mostraban su ✕ — solo aparece cuando hay un
valor elegido (por eso "Estampador no la mostraba": no tenía valor). Lo que faltaba eran los
selects nativos: **Empresa, OC tela y Mes de entrega** ahora muestran una ✕ (en lugar del chevron)
cuando tienen un valor, que regresa el filtro a "Todos". Se hizo **aditivo y retrocompatible** en
el `SelectNativo` genérico (prop opcional `alLimpiar`; sin ella, cero cambios en otras pantallas),
con el mismo look compacto de la ✕ del `ComboboxBuscable`.

### A4) Más filas visibles: se compactó la zona alta de la página

Sin quitar el título (a Daniel le gusta): **título y subtítulo comparten una línea base**, y se
redujeron los paddings/gaps verticales de la página y de la barra de filtros (`py`/`gap`) **solo en
esta pantalla** (el header global de la app no se tocó). Netea ~2–4 filas más de tabla en una
laptop común.

### B1) Impreso de la orden: "Folio" → "Orden"

El encabezado del PDF ahora dice **"Orden 5341"** (antes "Folio 5341"), como el impreso viejo. El
nombre del archivo ya decía `orden-<folio>.pdf` y no se tocó; los identificadores internos
(`folio`) tampoco.

### B2) Impreso de la orden: FOTOS del modelo + ARTES de la orden

El impreso ya incrustaba las fotos del **modelo** (data-URLs, best-effort). Ahora incluye además
los **ARTES**: las imágenes **subidas a la orden** (adjuntos F8-E6 con `tipoMime` `image/*`), en
una sección nueva **"Artes / fotos de la orden"** al final de la hoja, con el **mismo patrón de
descarga best-effort** (una imagen caída JAMÁS trunca el PDF; sin artes, la sección ni se pinta; y
si la lectura de adjuntos falla por completo — p. ej. R2 caído — el impreso sale igual, sin artes).
Se lee con `listarAdjuntos` del dominio, que exige exactamente el mismo permiso (`ordenes.ver`) que
ya autoriza la impresión — sin 403 nuevos. **Nota:** las fotos de los BORDADOS del BOM **no** se
incluyeron: `leerBom` no expone la foto del bordado y traerla exigiría una lectura adicional de BD
fuera de los seams existentes del impreso (no era "barato"; queda como mejora futura si Daniel la
pide).

### Archivos tocados

- `frontend/src/modulos/ordenes/CentroOrdenesPagina.tsx` — A1 (deep-link → lista), A2 (matriz al
  scroll), A3 (✕ en los 3 selects), A4 (compactado vertical).
- `frontend/src/components/ui/native-select.tsx` — prop opcional `alLimpiar` (✕ en lugar del
  chevron con valor elegido; retrocompatible).
- `frontend/src/modulos/ordenes/CentroOrdenesPagina.test.tsx` — pruebas nuevas del deep-link (fila
  fuera de página → buscador = folio + fila seleccionada) y de la ✕ del filtro de mes.
- `backend/src/dominio/produccion/impresos/impreso-orden.ts` — "Orden" en el encabezado del PDF +
  sección de artes (adjuntos imagen de la orden, seam de DI `listarAdjuntos`).
- `backend/src/dominio/produccion/impresos/impreso-orden.test.ts` — pruebas de artes (filtro por
  `tipoMime`, best-effort, render con imágenes).
- `docs/cambios-frontend-daniel.md` — esta bitácora.

---

## 2026-07-24 — Vocabulario unificado: **Arte**, **Prov. de Arte** y **Avíos**

Daniel pidió **unificar el vocabulario** del sistema: hoy convivían términos heredados del Access
viejo que nombran la misma cosa de tres maneras distintas. El criterio que dictó:

| Antes (Access / v2 hasta hoy)                                                        | Ahora (vocabulario único) |
| ------------------------------------------------------------------------------------ | ------------------------- |
| "Bordados", "Bordado/Estampado", "Bor", "Estampado" (como módulo o concepto general) | **Arte**                  |
| "Estampador", "Estampadores" (el proveedor que estampa **o** borda)                  | **Prov. de Arte**         |
| "Habilitación"                                                                       | **Avíos**                 |

**Excepción deliberada — los SUBTIPOS se conservan.** Un registro concreto del catálogo sigue siendo
de tipo **Bordado** o **Estampado** (son cosas distintas en la operación: hilo vs. tinta). "Arte" es
el paraguas que los agrupa; el tipo de cada registro se sigue mostrando tal cual. Por eso el selector
"Tipo" del catálogo sigue diciendo _Bordado_ / _Estampado / aplicación_, y en las descripciones del
menú se dejó el aclarador _"arte (bordado y estampado)"_ para que nadie se pierda en la transición.

### Qué se cambió: SOLO texto visible al usuario

Se tocaron **únicamente** cadenas que el usuario lee en pantalla o en un impreso: títulos, subtítulos,
encabezados de tabla, etiquetas de campo, placeholders, tooltips, `aria-label`, textos de menú y de
los hubs, mensajes de éxito/error (toasts) y rótulos de PDF.

**Zonas barridas (frontend):**

- **Menú / riel y hubs** (`modulos/catalogo.ts`, `CatalogosPagina.tsx`): "Bordados" → **Arte**;
  "Galería de bordados" → **Galería de arte**; el mosaico de Avíos ya no dice "Habilitación:…".
- **Catálogo de Arte** (`modulos/bordados/*`): título de la pantalla, descripción, filtro por tipo,
  vacío, botón "Nuevo arte", diálogo de alta/edición, confirmación de baja, detalle y toasts.
- **Galería de Arte** (`GaleriaBordados.tsx`): encabezado, búsqueda, filtro y estado vacío.
- **Centro de Órdenes** (`CentroOrdenesPagina.tsx`): el filtro "Estampador" → **Prov. de Arte**, la
  columna de la tabla y su versión móvil, el campo del panel de detalle ("Estampador / bordador" →
  **Prov. de Arte**) y el **mosaico "Habilitación" → "Avíos"** con su tooltip de permiso.
- **Panel de surtido** (`PanelHabilitacionOrden.tsx`) y notas de salida: el cajón se llama ahora
  **"Avíos — Orden N"**, el botón del banner dice **"Ver avíos"** y el cargando, "Cargando avíos…".
- **Producción** (`EnvioMaquilaPagina`, `ReciboMaquilaPagina`, `AvanceProduccion`): la etiqueta del
  proveedor cuando el proceso es de aplicación pasó a **Prov. de Arte**; el botón **"Ficha de arte"**;
  los subtítulos ("Costura, arte o lavado…") y el bloque **"Resumen · arte (aplicación)"**.
- **Modelos / BOM** (`EditorBom`, `CopiarBomDialogo`, `DialogoModelo`): la pestaña del BOM pasó de
  "Bordados" a **Arte** (con su vacío, el "Agregar arte…", el toast de guardado y la ayuda del
  precio), y el campo del modelo ahora es **"Secuencia del arte"**.
- **Costos y desarrollo** (`PreCostoPagina`, `CosteoOrdenPagina`, `DialogoPrecosto`): la sección
  "Bordados / estampados" → **Arte**, su columna, el total y los avisos de recálculo.
- **Ruta Crítica** (`PanelRutaOrden`, `ProcesosResponsablesPagina`, `piezas.tsx`, `api/esquemas.ts`):
  "Estampado / bordado en esta orden" → **Arte en esta orden**, y los eventos que se muestran al
  configurar procesos ("Envío a arte" / "Recibo de arte").
- **EsMa** (`SelectorMaquilero`): la opción de tipo de maquilero "Estampado" → **Prov. de Arte**.

**Zonas barridas (backend, solo cara al usuario):**

- **Mensajes de error/validación** que llegan como toast (`dominio/catalogos/bordados.ts`,
  `dominio/modelos/bom-modelo.ts`, `dominio/desarrollo/precostos.ts`): "el bordado …" → "el arte …".
- **Pantalla de Administración → roles y permisos** (`contrato/permisos.ts`): el módulo pasó a
  **"Arte (bordado y estampado)"** y se reescribieron las descripciones de `bordados.ver`,
  `bordados.administrar`, `modelos.administrar` y `ordenes.habilitacion` (esta última: "Capturar o
  modificar **los avíos** de la orden").
- **Impreso PDF de la ficha de aplicación** (`impresos/impreso-envio-maquila.ts`): el documento se
  titula **"Ficha de arte"**, el campo del tercero dice **"Prov. de Arte"** y la sección de notas,
  "Instrucciones del arte".
- **Seed** (`prisma/seed.ts`): los **roles de proveedor** `estampado`/`bordado` se muestran ahora como
  **"Prov. de Arte (estampado)"** / **"Prov. de Arte (bordado)"** (se conservan como dos roles para
  poder seguir distinguiendo qué servicio presta cada taller), y los reactivos del checklist de ficha
  pasaron a **"Información de avíos"** / **"Medidas de avíos"**.
- **Pruebas** (unitarias y `e2e`) que afirmaban los textos viejos se actualizaron al texto nuevo; si
  no, el CI truena.

### Qué NO se tocó (a propósito)

Renombrar identificadores rompería el sistema sin ningún beneficio visible, así que quedaron
**intactos**:

- **Base de datos:** nombres de tablas y columnas de Prisma (`Bordado`, `ModeloBordado`,
  `secuenciaEstampado`, `Avio`…) y los **enums** (`TipoBordado`, `BORDADO`, `ESTAMPADO`).
- **Claves de permiso** (`bordados.ver`, `bordados.administrar`, `ordenes.habilitacion`): son la
  llave del RBAC; cambiarlas dejaría a todos sin acceso hasta re-sembrar y re-asignar roles.
- **Rutas del API** (`/api/bordados`, `/api/ordenes/:id/habilitacion`, `/api/produccion/envios/:id/
ficha-estampado`) y **rutas del frontend** (`/catalogos/bordados`, `/catalogos/galeria-bordados`):
  romperían los enlaces guardados y el contrato OpenAPI.
- **Códigos de catálogo** (`estampado`, `bordado`, `maquila-costura`…): son claves naturales estables;
  el dominio busca por ellas. Solo cambió el **nombre visible**, nunca el código.
- **`data-testid`, claves de cache, nombres de archivos, funciones, variables y tipos.**
- **`entidad: 'Bordado'` de la bitácora de auditoría:** es un discriminador **almacenado**; cambiarlo
  partiría el historial en dos (lo viejo quedaría inencontrable).
- **Nombres de los `TipoProceso`** (Costura, **Estampado**, **Bordado**, Lavado, Aplicación) y de los
  **conceptos de costo** homónimos: son registros concretos del catálogo —el subtipo real— y son
  **editables desde la UI**; ahí manda el dato, no el código.
- Las descripciones `origen.descripcion` de `contrato/permisos.ts`: son la transcripción **histórica**
  de la tabla `Accesos` del Access viejo (procedencia documental), no texto de pantalla.

### ⚠️ Nota de despliegue (importante)

El seed es **idempotente por código** y usa `update: {}` — es decir, **NO pisa el `nombre` de un
registro que ya existe** (a propósito: el nombre pudo editarse en producción). Por eso, en `prueba` y
en producción los roles de proveedor y los reactivos de ficha **seguirán mostrando su nombre viejo**
aunque se re-despliegue con `SEED_ON_START=true`. Para que tomen el nombre nuevo hay que **editarlos
a mano una vez** desde la UI de Administración (o correr un `UPDATE` puntual). Las bases **nuevas**
sí nacen con el vocabulario unificado. Todo el resto del renombrado (que vive en código) se aplica
solo con desplegar.

### Archivos tocados

- **Frontend (18):** `modulos/catalogo.ts` · `modulos/catalogos/CatalogosPagina.tsx` ·
  `modulos/bordados/{BordadosPagina,GaleriaBordados,DialogoBordado}.tsx` ·
  `modulos/ordenes/CentroOrdenesPagina.tsx` ·
  `modulos/notas-salida/{PanelHabilitacionOrden,NotasPorOrdenPagina}.tsx` ·
  `modulos/produccion/{EnvioMaquilaPagina,ReciboMaquilaPagina,AvanceProduccion}.tsx` ·
  `modulos/modelos/{EditorBom,CopiarBomDialogo,DialogoModelo}.tsx` ·
  `modulos/costos/{PreCostoPagina,CosteoOrdenPagina}.tsx` · `modulos/desarrollo/DialogoPrecosto.tsx` ·
  `modulos/ruta-critica/{PanelRutaOrden,ProcesosResponsablesPagina,piezas}.tsx` ·
  `modulos/esma/SelectorMaquilero.tsx` · `api/esquemas.ts`.
- **Backend (6):** `contrato/permisos.ts` · `dominio/catalogos/bordados.ts` ·
  `dominio/modelos/bom-modelo.ts` · `dominio/desarrollo/precostos.ts` ·
  `dominio/produccion/impresos/impreso-envio-maquila.ts` · `prisma/seed.ts`.
- **Pruebas (5):** `frontend/e2e/{bordados,modelos}.spec.ts` ·
  `frontend/src/modulos/bordados/{BordadosPagina,GaleriaBordados}.test.tsx` ·
  `frontend/src/modulos/modelos/EditorBom.test.tsx`.
- `docs/cambios-frontend-daniel.md` — esta bitácora.

---

## 2026-07-24 — Composición desde la ficha del MODELO + **un solo botón "Guardar"** en la orden

Dos peticiones de Daniel el mismo día, ambas sobre el diálogo "Modificar" de una orden
(`/produccion/ordenes` → mosaico **Modificar**).

### A) La COMPOSICIÓN se captura en el MODELO y la orden la jala sola

Palabras de Daniel: **«La composición no sale de la OC del cliente. Sale de la información del
desarrollo del modelo. De ahí la jala.»** Y eligió el esquema: se captura en la **ficha del modelo**,
toda orden de ese modelo la **hereda automáticamente**, y se puede **corregir a mano** en una orden
puntual.

**Cómo quedó:**

- **Campo nuevo `Composición` en la ficha del MODELO** (Modelos → alta/edición, sección _Identidad_,
  debajo de Descripción; también se muestra en el detalle del modelo cuando está capturada). Es la
  **fuente única**.
- **La orden la HEREDA al nacer.** Al crear una OP (captura directa, salida a producción del
  constructor de pedido, importador de OC) la orden copia `Modelo.composicion` y queda marcada como
  **heredada** (`compForzada = false`).
- **Override por orden.** Si en el encabezado de la orden se escribe una composición **distinta**, esa
  orden queda con **override** (`compForzada = true`) y ya **no se pisa** con la del modelo. Teclear
  _exactamente_ lo que ya dice el modelo **no** cuenta como override (sería desconectarla del modelo
  sin que el usuario lo pidiera): se sigue tratando como heredada.
- **Volver a la del modelo.** Con override, el campo muestra un botón discreto **«Volver a la del
  modelo»** (y también sirve simplemente **vaciar el campo**): la orden vuelve a heredar.
- **Se retiró la casilla «Composición capturada a mano»** del encabezado de la orden. Era un dato que
  el usuario tenía que mantener a mano y nadie usaba; ahora la **deriva el backend** (A1): escribir
  algo distinto = override, vaciar = heredar. Debajo del campo hay un texto que dice de dónde viene
  ("Se hereda de la ficha del modelo…" / "Editada en esta orden…").

**Regla de re-derivación (decidida y documentada):**

- Se re-deriva **solo** cuando la orden **no** tiene override, y **solo en los puntos donde la orden
  ya se está tocando**: el alta y el guardado del encabezado. Así, corregir la composición en la ficha
  del modelo baja a sus órdenes vivas la próxima vez que alguien las guarda.
- **NO** hay recálculo masivo de órdenes históricas al editar un modelo (sería una escritura silenciosa
  sobre miles de OPs cerradas).
- No existe el caso "le cambiaron el modelo a la orden": el modelo de una OP se autorrellena del
  renglón de pedido al nacer y **no** es editable (no está en el PATCH del encabezado).
- Re-guardar el encabezado **reenviando el mismo texto** (lo que hace la UI al mandar el formulario
  completo) **no** convierte una composición heredada en override: solo un texto **distinto** lo hace.

**Importador de OC por PDF (plantilla C&A):** antes escribía en la orden la composición que venía en
el papel del cliente — justo la fuente que Daniel descarta. Ahora **la del modelo manda y el PDF no la
pisa**. La del papel se usa **solo de respaldo** cuando el modelo **no** tiene composición capturada
(para no perder el dato); en ese caso entra marcada como override, y basta capturar la del modelo y
vaciar el campo en la orden para que vuelva a heredarla.

### B) UN SOLO botón "Guardar" en el diálogo de la orden + aviso al salir

Palabras de Daniel: **«Al modificar una orden debería haber un solo botón para guardar cuando haya
alguna modificación, no un botón de guardar por sección. Y si la cierras sin haber guardado antes, que
te pregunte si quieres guardarla antes de salir.»**

- **Se retiraron los tres botones por sección**: "Guardar encabezado", "Guardar matriz" y
  "Guardar referencias".
- **Un solo botón «Guardar» en el pie del diálogo**, habilitado **solo si hay cambios sin guardar**. A
  su izquierda, un aviso permanente: _"Tienes cambios sin guardar."_ / _"Sin cambios pendientes."_ El
  pie solo aparece con `ordenes.administrar` y si la orden no está cancelada.
- **Guarda TODO lo pendiente en el orden correcto** (encabezado → matriz → referencias; la matriz va
  después porque deriva el estado 'completa' de la orden). Un solo toast: _"Cambios guardados."_
- **Manejo de errores honesto:** si una parte falla, se corta ahí y el mensaje dice **cuál falló** y
  **qué sí quedó guardado**; el diálogo **no** se cierra ni finge éxito.
- **Detalle técnico que importa:** el guardado va en **dos fases** — primero se **capturan** los datos
  de todas las secciones sucias, y solo después se mandan. Cada mutación invalida el detalle de la
  orden y las secciones se re-inicializan con lo que llega del servidor; si se guardara sección por
  sección, la primera respuesta se comería la captura pendiente de las demás. Por lo mismo, mientras
  dura la tanda —y si queda **a medias**— se **bloquea la re-inicialización** de las secciones: tras
  un fallo la pantalla conserva **exactamente** lo capturado y "Guardar" lo reintenta sin que el
  usuario recapture nada. (Registro de secciones: `modulos/ordenes/guardado-orden.tsx`.)
- **A prueba de doble clic:** el candado se pone al **entrar** a guardar (no al empezar a mandar), así
  que dos clics seguidos no disparan dos rondas.
- **Guardia al cerrar:** con cambios sin guardar, cerrar por el botón **✕**, el botón **Cerrar**,
  **Esc** o **clic fuera** abre una confirmación con tres salidas: **Guardar y salir** /
  **Salir sin guardar** / **Cancelar**. Reusa `DialogoConfirmacion`, al que se le agregó una
  `accionSecundaria` opcional (tercer botón), sin tocar sus usos existentes.

**Qué NO se unificó (a propósito):** comentarios, adjuntos, hitos de la orden, la liga con Desarrollo
y "Copiar matriz de otra orden". **No son capturas en espera de guardarse**: cada una es una operación
inmediata con su propio endpoint y su propio efecto (subir un archivo, registrar un hito, copiar una
matriz con su diálogo de confirmación). Meterlas en el botón único las volvería más confusas, no menos.
"Cancelar orden" sigue igual (exige `ordenes.cancelar` y su motivo).

> ⚠️ **Deuda conocida, anotada y NO resuelta en este lote** (`HOJA-DE-RUTA.md` §4): esas acciones
> inmediatas **sí** modifican la orden, y al hacerlo re-inicializan las 3 secciones — **tirando las
> capturas pendientes** de encabezado/matriz/referencias. El riesgo ya existía (cada sección se
> reiniciaba igual), pero el botón único **lo agrava**, porque ahora invita a acumular cambios antes
> de guardar. Ahí no hay pérdida silenciosa de datos guardados, pero sí de trabajo en pantalla.

### ⚠️ Nota de despliegue

Son **DOS migraciones nuevas**; **el deploy las aplica solas** (el entrypoint corre
`prisma migrate deploy`). **No** hay permisos ni seed nuevos → **no** hace falta `SEED_ON_START=true`.

1. `20260724120000_modelo_composicion` — de **esquema**: agrega `modelos.composicion` (`TEXT`
   nullable, **puramente aditiva**, sin backfill). Los modelos existentes quedan **sin** composición
   hasta que se capture.
2. `20260724130000_ordenes_composicion_historica` — de **datos**, y es **obligatoria** (protege
   información existente):
   ```sql
   UPDATE ordenes
      SET comp_forzada = true
    WHERE composicion IS NOT NULL
      AND comp_forzada = false;
   ```

**Por qué la segunda (lo detectó el reviewer, era pérdida de datos):** toda la composición que hay
hoy en `ordenes` viene del ETL de Access o del importador de OC por PDF, y quedó con
`comp_forzada = false`. Como `modelos.composicion` nace **vacía**, la primera vez que alguien abriera
una OP histórica y guardara _cualquier_ campo del encabezado, la orden se habría re-derivado a NULL
— **borrando el dato en silencio y sin vuelta atrás**. Lo ya capturado en una orden **ES** un
override (nunca derivó de una ficha de modelo que no existía), así que se marca como tal. Quien
quiera reconectar una orden a la composición de su modelo solo tiene que **vaciar el campo** en la
pantalla de la orden.

Además, como cinturón y tirantes, `resolverComposicion` lleva un **guard anti-pérdida**: al heredar,
si el modelo NO tiene composición y la orden SÍ, se conserva la de la orden (salvo que el usuario
haya vaciado el campo a propósito). Así el dato está a salvo aunque la migración de datos no se haya
corrido todavía. Ambos caminos tienen prueba.

### Archivos tocados

- **Backend (9):** `prisma/schema.prisma` · `prisma/migrations/20260724120000_modelo_composicion/migration.sql`
  (**nuevo**) · `prisma/migrations/20260724130000_ordenes_composicion_historica/migration.sql`
  (**nuevo**, migración de datos) · `src/contrato/esquemas/modelo.ts` ·
  `src/dominio/modelos/modelos.ts` · `src/api/modelos/modelos.rutas.ts` ·
  `src/dominio/produccion/ordenes.ts` (`resolverComposicion` + guard anti-pérdida) ·
  `src/dominio/pedidos/importacion-pdf.ts` · `backend/openapi.json` (regenerado).
- **Frontend (10):** `modulos/ordenes/guardado-orden.tsx` (**nuevo**) · `modulos/ordenes/DialogoOrden.tsx` ·
  `modulos/ordenes/EditorEncabezadoOrden.tsx` · `modulos/ordenes/PanelMatriz.tsx` ·
  `modulos/ordenes/PanelReferencias.tsx` · `modulos/ordenes/esquemas.ts` ·
  `modulos/modelos/DialogoModelo.tsx` · `modulos/modelos/esquemas.ts` ·
  `modulos/modelos/ModelosPagina.tsx` · `components/DialogoConfirmacion.tsx` ·
  (`openapi.json` + `src/api/esquema.gen.ts` regenerados).
- **Trampa de React documentada en el código** (`guardado-orden.tsx`): el proveedor del contexto se
  exporta como el `Provider` TAL CUAL, no envuelto en un `useCallback`. Un wrapper memoizado cambia de
  identidad cuando cambia el valor del contexto → React lo trata como **otro tipo de componente** y
  **remonta todo el detalle**, tirando lo capturado. Pasó durante este trabajo; el comentario está ahí
  para que no se repita.
- **Pruebas (8):** `backend/src/contrato/esquemas/modelo.test.ts` ·
  `backend/src/dominio/produccion/ordenes.test.ts` ·
  `backend/src/dominio/pedidos/importacion-pdf.int.test.ts` ·
  `frontend/src/modulos/ordenes/DialogoOrden.test.tsx` ·
  `frontend/src/modulos/modelos/{DialogoModelo,ModelosPagina,GaleriaModelos,EditorBom}.test.tsx` ·
  `frontend/e2e/ordenes.spec.ts`.
- `docs/cambios-frontend-daniel.md` — esta bitácora.

---

## 2026-07-25 — El LOGO de FR Moda, en un solo lugar (impresos + sistema)

> **Lo que pidió Daniel (textual):** _"Te voy a subir el logo de FR MODA… hay que brandear todos los
> formatos de impresión con el logo de la empresa así como el sistema. ¿Podrías ponerlo en algún lado
> donde podamos actualizar el logo, y que se actualice de manera automática todos los formatos y el
> mismo sistema? O sea, no vas a pegar el logo en todos lados, sino que vas a llamar el mismo archivo
> para poder cambiarlo en cualquier momento sin tener que cambiar todo."_

### Dónde se sube el logo

**Administración › Empresas → selecciona la empresa → sección "Logo de la empresa"** (en el cajón de
detalle, a la derecha). Ahí se **sube**, se **reemplaza** y se **quita**, con vista previa. Solo lo
puede tocar quien tenga `empresas.administrar`; los demás lo ven, pero no lo cambian.

Formatos aceptados: **PNG o JPG, hasta 5 MB**. No se aceptan SVG ni WEBP a propósito: el motor de
PDF no sabe incrustarlos, y un logo que no se puede imprimir no sirve para lo que se pidió.

### Qué se actualiza solo (sin desplegar nada)

Al cambiar ese archivo se actualiza, de inmediato y sin tocar código:

- **Los 23 formatos de impresión (PDF)** — orden de producción, orden de compra, envío a maquila,
  ficha de estampado, recibo, entrega a cliente, nota de salida, explosión de materiales, estatus de
  materiales, inventario de telas, plan de Ruta Crítica, auditoría de calidad, listas de precios
  (costos y desarrollo), EDR mensual y anual, estados de cuenta de maquilero y su recibo de pago,
  tableros de KPIs (RC, calidad, WIP), hoja de conteo, estados de cuenta CxC y CxP, y el reporte
  fiscal del contador. **Todos** llevan el logo en el membrete.
- **El sistema**: el riel del menú (abierto y colapsado) y el menú de móvil.

El truco es que el logo **no está pegado en ningún lado**: hay **un solo punto** en los impresos
(`EncabezadoDocumento`, el encabezado que comparten los 23) y **un solo punto** en la app (el
componente `Marca`), y los dos leen el mismo archivo de la empresa.

### El respaldo (para que nunca falte la marca)

El repo trae **empaquetado** el logo de FR Moda. Se usa cuando:

- la empresa todavía no tiene logo subido (por ejemplo, recién desplegado);
- el almacenamiento (R2) está caído, el archivo se borró a mano o pesa más de la cuenta;
- la imagen del servidor no carga por lo que sea.

La pantalla de **inicio de sesión** también muestra el logo REAL: la imagen se sirve sin pedir
sesión (un logo es marca pública — va impreso en los documentos que se mandan a clientes y
proveedores), justo para que el login no fuera el único rincón que se quedara con el logo viejo.

El logo subido **siempre gana** sobre el empaquetado. Y si por lo que sea no hubiera ninguna imagen,
el impreso **igual sale** con el membrete de texto de siempre y la app vuelve al cuadro verde con el
icono: **nada se rompe por el logo**.

### Cómo se sube (y por qué en tres pasos)

Subir el logo hace tres cosas, en este orden: (1) el sistema aparta un espacio, (2) el navegador
manda la imagen y (3) recién entonces el logo nuevo pasa a ser el vigente y se borra el anterior.

Suena rebuscado, pero evita un problema real: si se cambiara el logo _antes_ de que la imagen
termine de subir y la subida fallara (se cae la red, se cierra la pestaña), el sistema quedaría
apuntando a una imagen que no existe — o sea, **sin marca en todos lados**, y encima buscándola
inútilmente en cada impreso. Con este orden, una subida a medias no cambia nada: el logo anterior
sigue en su lugar y basta reintentar.

### Nota de despliegue (para Gabriel)

1. **Hay una migración nueva** (`20260725120000_empresa_logo`): agrega la columna
   `empresas.id_archivo_logo`. Es aditiva y nullable — se aplica sola al desplegar.
2. **No hay permisos nuevos** (reusa `empresas.administrar`), así que **no** hace falta
   `SEED_ON_START` por este cambio.
3. **Hay que subir el logo real UNA vez** en `prueba`: Administración › Empresas › FR Moda ›
   _Logo de la empresa_ › **Subir imagen**. Mientras no se haga, todo sale con el logo empaquetado
   (que ya es el de FR Moda, así que se ve bien desde el arranque).

### Archivos tocados

- **Backend (12):** `prisma/schema.prisma` (`Empresa.idArchivoLogo`, patrón de `Bordado.archivoFoto`) ·
  `prisma/migrations/20260725120000_empresa_logo/migration.sql` (**nueva**) ·
  `src/comun/logo-empaquetado.ts` (**nuevo**, el PNG en base64) ·
  `src/comun/logo-empresa.ts` (**nuevo**, resolutor con caché y respaldo) ·
  `src/comun/impresos-estilos.ts` (`EncabezadoDocumento` pinta el logo — **el único punto de los 23
  impresos**) · `src/comun/pdf-worker.ts` y `src/comun/pdf-worker-thread.ts` (inyectan el logo antes
  de renderizar) · `src/comun/archivos.ts` (`descargarContenido`) ·
  `src/dominio/admin/empresas.ts` (subir / consultar / quitar) ·
  `src/api/empresas/empresas.rutas.ts` · `src/api/sesion/sesion.rutas.ts` ·
  `src/contrato/esquemas/{empresa,sesion}.ts` · `src/openapi.ts` + `scripts/generar-openapi.ts`
  (para documentar las respuestas binarias) · `openapi.json` (regenerado).
  **Impresos editados: 25, de UNA línea cada uno** — solo para pasarles la empresa activa
  (`{ idEmpresa: sesion.idEmpresaActiva }`) al generar el PDF; el logo lo pone el encabezado
  compartido, sin tocar el contenido de ningún impreso. Quedan pendientes los 2 de
  `impreso-orden.ts`, que estaba en manos de otro agente.
- **Frontend (8):** `src/assets/logo-frmoda.png` (**nuevo**, el respaldo empaquetado) ·
  `src/components/ImagenLogo.tsx` (**nuevo**: el único punto que decide de dónde sale la marca) ·
  `src/components/Marca.tsx` (riel y menú) · `src/paginas/Login.tsx` ·
  `src/componentes/SubidaImagen.tsx` (dos props nuevas: `ajuste` y `claseVistaPrevia`, para que un
  logo no se recorte y se vea sobre blanco) · `src/api/empresas.ts` + `src/api/tipos.ts` ·
  `src/modulos/empresas/LogoEmpresa.tsx` (**nuevo**) · `src/modulos/empresas/EmpresasPagina.tsx` ·
  (`openapi.json` + `src/api/esquema.gen.ts` regenerados).
- **Pruebas (7 nuevas + fixtures):** `backend/src/comun/logo-empresa.test.ts` ·
  `backend/src/comun/impresos-estilos.test.ts` · `backend/src/dominio/admin/empresas-logo.test.ts` ·
  `backend/src/api/empresas/logo.rutas.test.ts` (contrato HTTP: público, ETag/304, caché) ·
  `backend/src/comun/archivos.test.ts` (tope de descarga) ·
  `frontend/src/components/Marca.test.tsx` · `frontend/src/api/empresas.logo.test.ts` ·
  `frontend/src/modulos/empresas/LogoEmpresa.test.tsx`.

### Decisiones técnicas que conviene recordar

- **El logo del membrete mide 52×26 pt y no más.** Está calculado para NO ser más alto que el bloque
  de texto del membrete: así el encabezado ocupa exactamente lo mismo que antes y ningún impreso al
  límite (la orden de producción densa, sin ir más lejos) se derrama a una segunda página.
- **El PNG de respaldo va como base64 dentro de un módulo TypeScript**, no como archivo suelto: el
  build del backend compila solo TypeScript a `dist/`, así que un `.png` junto al código no llegaría
  a la imagen. Como módulo viaja siempre, también dentro del hilo que genera los PDF.
- **La imagen del logo se sirve por el API** (`GET /api/empresas/logo`) y no con una URL prefirmada
  de R2: la prefirmada caduca a los 15 minutos y dejaría la marca rota en sesiones largas. Ese
  endpoint **no pide sesión** (lo necesita el login) y no expone nada más que los bytes de la imagen.
- **Cada impreso lleva el logo de SU empresa** (`sesion.idEmpresaActiva`), el mismo criterio con el
  que ya se elegía el membrete de texto: en multi-empresa no puede salir el nombre de una empresa
  con el logo de otra.
- **Se cachea en memoria del servidor** (5 min, y se tira al subir/quitar) y la resolución tiene tope
  de tiempo y de TAMAÑO: si la base o R2 tardan, o el archivo resulta pesar más de 5 MB (lo que el
  navegador declara al subir no obliga a nada), sale el logo empaquetado y el PDF no espera.
- **La caché del navegador es honesta**: la app pide la imagen con `?v=<id del archivo>` (que cambia
  al cambiar el logo) y sólo si el servidor sirvió **esa misma versión** se guarda un año; si en ese
  momento hubo que responder el logo de respaldo, se guarda un minuto y nada más — así un bache
  pasajero no puede dejar clavado el logo equivocado. La del login, sin versión, dura también un
  minuto y se revalida con `ETag` → 304, sin reenviar la imagen.
- **Un bache de la base o de R2 no se paga en cada impreso**: el fallo se recuerda 10 segundos (lo
  justo para no repetir el viaje fallido una y otra vez) y pasado ese rato se reintenta solo, así
  que el logo real vuelve casi de inmediato cuando el servicio se recupera.
- **Deuda anotada (no es un problema hoy):** el paso de confirmación no comprueba contra el
  almacenamiento que la imagen haya llegado de verdad; un cliente que "mintiera" dejaría a la
  empresa apuntando a un archivo inexistente y el sistema se vería con el logo de respaldo. Se
  arregla volviendo a subir el logo, y queda anotado en `HOJA-DE-RUTA.md` §4 con su razón.

---

## 2026-07-25 — La foto **principal** del modelo y el **arte principal**

> **Lo que pidió Daniel:** _"Está bien con 4 fotos. Pero debe de haber una foto principal del
> modelo. Es la más importante. ¿Chance que se pueda marcar como la importante? (Por default que sea
> la primera) y la primera del arte también."_

### Qué cambió

- **La foto principal del modelo se puede MARCAR.** En la ficha del modelo (pestaña de fotos), cada
  foto que no sea la principal tiene el botón **"Marcar como principal"**; la principal se distingue
  con una **estrella + el rótulo "Principal"** sobre la miniatura y siempre aparece **primero**.
  Con una sola foto no se ofrece la acción: ya es la principal por definición.
- **El arte principal también.** En la receta del modelo › pestaña **Arte**, el **primer** renglón
  lleva el mismo distintivo y los demás el mismo botón. Marcarlo es una acción aparte: **no** hace
  falta pulsar "Guardar receta".
- **Por default es la primera**, tal como pidió Daniel: no hay ninguna casilla que marcar para que
  el sistema funcione como hoy. "Principal" **no es una bandera** — es literalmente _ser el primero_
  del orden. Así nunca puede pasar que una foto diga "principal" y salga en otro lugar.
- **En el impreso de la orden están GARANTIZADAS.** La foto principal del modelo y el arte principal
  encabezan su bloque y **nunca los recorta el tope** (3 fotos / 4 imágenes de arte), aunque el
  modelo tenga muchas más. El aviso del título (`Artes (imágenes) — se muestran 4 de 9`) y la lista
  de texto "Arte" siguen igual: no se esconde nada.
- **En la tira de fotos de la OP** (la de arriba en la orden) la principal del modelo va al frente y
  lleva su estrella. Ahí solo se muestra: marcarla se hace en la ficha del modelo.
- El **catálogo de modelos** ya usaba "la primera foto" como miniatura, así que ahora esa miniatura
  es exactamente la que Daniel elija.

### Nota de despliegue (para Gabriel)

1. **Hay una migración nueva** (`20260725130000_modelo_bordado_orden`): agrega la columna
   `modelo_bordado.orden`. Es aditiva, con default 0 — se aplica sola al desplegar y **no** cambia
   nada de lo existente (los modelos que nadie toque siguen listando su arte por nombre).
2. **No hay permisos nuevos** (reusa `modelos.administrar`): **no** hace falta `SEED_ON_START`.
3. No hay que capturar nada a mano: cada modelo ya tiene principal (la primera).

### Archivos tocados

- **Backend (7):** `prisma/schema.prisma` (`ModeloBordado.orden`) ·
  `prisma/migrations/20260725130000_modelo_bordado_orden/migration.sql` (**nueva**) ·
  `src/dominio/modelos/orden-principal.ts` (**nuevo**, el cálculo puro del reordenamiento) ·
  `src/dominio/modelos/fotos-modelo.ts` (`marcarFotoPrincipal`) ·
  `src/dominio/modelos/bom-modelo.ts` (`marcarBordadoPrincipal`, lectura ordenada, artes nuevos al
  final, copiar BOM conserva el orden) · `src/api/modelos/modelos.rutas.ts` (2 endpoints nuevos) ·
  `src/dominio/produccion/impresos/impreso-orden.ts` (marca la principal y la blinda del tope) ·
  `openapi.json` (regenerado).
- **Frontend (4):** `src/api/modelos.ts` (`useMarcarFotoPrincipal`, `useMarcarArtePrincipal`) ·
  `src/modulos/modelos/FotosModelo.tsx` · `src/modulos/modelos/EditorBom.tsx` ·
  `src/modulos/ordenes/FotosModeloOrden.tsx` · (`openapi.json` + `src/api/esquema.gen.ts`
  regenerados).
- **Pruebas:** `backend/src/dominio/modelos/orden-principal.test.ts` (**nueva**) ·
  `backend/src/api/modelos/modelos.int.test.ts` (integración de los 2 endpoints + la columna nueva,
  corre en CI) ·
  `backend/src/dominio/modelos/modelos.test.ts` (reordena, idempotente, 404) ·
  `backend/src/dominio/produccion/impresos/impreso-orden.test.ts` (la principal nunca se recorta y
  no cuesta una hoja) · `frontend/src/modulos/modelos/{FotosModelo,EditorBom}.test.tsx` ·
  `frontend/src/modulos/ordenes/FotosModeloOrden.test.tsx`.

### Decisiones técnicas que conviene recordar

- **Sin columna "esPrincipal".** El orden es la única fuente de verdad (`ModeloFoto.orden` ya
  existía; `ModeloBordado.orden` es la columna nueva). Marcar principal = mover al lugar 0 y
  reindexar el resto, en una transacción, con bitácora; es **idempotente** (repetirlo no escribe).
- **El presupuesto de altura del impreso NO empeoró.** Anteponer la principal no agrega elementos:
  la orden densa con 3 fotos + 9 artes sigue cabiendo en **una** página (medido contando páginas del
  PDF renderizado en `impreso-orden.test.ts`).
- **Guardar la receta no desbanca al principal:** los artes nuevos entran con el `orden` siguiente al
  máximo, nunca en 0 (y entre ellos conservan el orden de la pantalla).
- **No se pierde captura a medias:** en la receta, "Marcar como principal" recarga la ficha (y con
  ella las tres pestañas), así que la acción queda **deshabilitada con un aviso** mientras haya
  cambios sin guardar en cualquiera de las tres. Antes se hubiera borrado lo tecleado con un toast
  verde de éxito.
- **Dos marcados a la vez no se pisan:** el reordenamiento toma un `pg_advisory_xact_lock` por
  modelo (el mismo idioma que ya usa el motor de terceros), así el segundo espera y recalcula sobre
  el orden ya actualizado en vez de dejar dos "primeros".
