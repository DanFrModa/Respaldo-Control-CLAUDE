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

**No hay nada que hacer a mano: se actualiza solo con desplegar.**

El seed es **idempotente por código** y usa `update: {}` — es decir, **NO pisa el `nombre` de un
registro que ya existe** (a propósito: el nombre pudo editarse en producción). Por eso, en `prueba` y
en producción los roles de proveedor y los reactivos de ficha se habrían quedado con su nombre viejo
aunque se re-desplegara con `SEED_ON_START=true`. Para que no hubiera pasos manuales (petición de
Daniel), se agregó la **migración de datos `20260725140000_roles_proveedor_prov_de_arte`**, que el
deploy aplica solo (`prisma migrate deploy`): renombra los dos **roles de proveedor**
(`estampado` → "Prov. de Arte (estampado)", `bordado` → "Prov. de Arte (bordado)") y los dos
**reactivos de ficha** (`InfHab` → "Información de avíos", `Medidas` → "Medidas de avíos").

Es **condicional a propósito**: cada `UPDATE` solo toca el renglón si todavía conserva el **nombre
por defecto exacto** del seed viejo; si alguien ya lo personalizó a otra cosa, se respeta su texto.
Es idempotente (re-correrla no cambia nada) y no toca las claves estables (`codigo`/`clave`). Las
bases **nuevas** siguen naciendo con el vocabulario unificado desde el seed. Todo el resto del
renombrado (que vive en código) se aplica solo con desplegar.

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
- **Backend (7):** `contrato/permisos.ts` · `dominio/catalogos/bordados.ts` ·
  `dominio/modelos/bom-modelo.ts` · `dominio/desarrollo/precostos.ts` ·
  `dominio/produccion/impresos/impreso-envio-maquila.ts` · `prisma/seed.ts` ·
  `prisma/migrations/20260725140000_roles_proveedor_prov_de_arte/migration.sql` (**nuevo**,
  migración de datos: renombra los renglones ya sembrados que conserven el nombre viejo).
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

**Defecto de auditoría (A7) que destapó el e2e — corregido:** `guardarReferenciasOrden` escribía los
renglones `OrdenReferencia` y su bitácora, pero **no sellaba `modificadoEn`/`modificadoPorId` de la
orden**, a diferencia de la matriz y el encabezado. Consecuencias: el bloque **"Historial"** del
detalle mentía tras guardar referencias, y la UI —que se re-sincroniza por `modificadoEn`— nunca se
enteraba del guardado, así que la sección quedaba "sucia para siempre" (el botón único seguía
habilitado y el aviso "Tienes cambios sin guardar" no se iba). Ahora la orden se sella en la **misma
transacción**, calcando lo que hace la matriz. Las referencias son **datos de la orden** (en el Access
viejo eran columnas del propio registro), así que marcarla como modificada es lo correcto.

> **Qué NO se cambió y por qué:** comentarios, adjuntos, hitos y la liga con Desarrollo **tampoco**
> tocan `Orden.modificadoEn` — y así se queda **a propósito**. No son datos de la orden sino registros
> propios con su propia auditoría y su propia entidad en bitácora (el comentario incluso se registra
> como `OTRO`, "es un evento de hilo, no un cambio de datos de la orden"). Además, hacerlos mover
> `modificadoEn` **agravaría** la deuda de abajo: hoy re-inicializarían las secciones y tirarían las
> capturas pendientes.

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
  `src/dominio/produccion/ordenes.ts` (`resolverComposicion` + guard anti-pérdida +
  `guardarReferenciasOrden` sella la auditoría de la orden) · `src/dominio/pedidos/importacion-pdf.ts` ·
  `backend/openapi.json` (regenerado).
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
  `frontend/src/modulos/ordenes/DialogoOrden.test.tsx` (incluye 3 pruebas nuevas que aterrizan el
  **refetch** de verdad —store externo + `useSyncExternalStore`— sobre el diálogo ya montado: sin
  ellas, el ciclo guardar→invalidar→reinicio solo lo cubría el e2e) ·
  `frontend/src/modulos/modelos/{DialogoModelo,ModelosPagina,GaleriaModelos,EditorBom}.test.tsx` ·
  `frontend/e2e/ordenes.spec.ts`.
- **CI, para poder DEPURAR esto (2):** `.github/workflows/ci.yml` · `frontend/playwright.config.ts`.
  Cuando el e2e de este lote se puso rojo, el fallo resultó **indepurable**: el paso de diagnóstico
  volcaba `docker compose logs` **sin tope** (miles de líneas de peticiones del backend) y empujaba
  la salida de Playwright fuera de la ventana de log que la API de GitHub deja leer; y el artefacto
  `playwright-report.zip` tampoco se puede descargar (vive en un blob de Azure que el proxy bloquea).
  Ahora: el volcado va con `--tail=200`; Playwright agrega en CI los reporters `github`
  (anotaciones con archivo:línea) y `json`; y un paso nuevo —**el último del job**— imprime el
  **resumen compacto de las pruebas fallidas** (archivo:línea + el error) en el log y en el
  *summary* del run. Así un e2e rojo se lee de un vistazo, sin artefactos ni ventanas de log.
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

---

## 2026-07-26 — La orden se pone **COMPLETA sola** (y dice qué le falta) + 3 remates

Daniel: *"El estado de la orden (completa, incompleta) no sé en base a qué existe. En CONTROL viejo
existía, pero está en desuso. Acá podríamos definirla como completa cuando ya tenga los avíos, los
artes. De manera automática se pone como completa."*

### La regla, en lenguaje de negocio

Una orden está **COMPLETA** cuando cumple **las tres cosas que aplican**:

| Requisito | Qué se revisa | Cuándo bloquea |
| --- | --- | --- |
| **Tallas** | La orden tiene su matriz color × talla capturada (al menos un renglón). | Siempre. |
| **Avíos** | El **modelo** de la orden tiene su receta de avíos de producción (al menos un avío marcado "se considera al producir"). | Siempre. |
| **Arte** | El modelo tiene su arte (bordado/estampado) capturado en la receta. | **Solo si el modelo lleva arte** — lo dice la casilla nueva "Lleva arte" de la ficha del modelo, que viene **marcada por default**. |

Todo es **AUTOMÁTICO**: nadie marca nada. En el momento en que la orden cumple, pasa a `completa`
sola. La **fecha en que quedó completa por primera vez** se guarda una sola vez y **nunca se borra**
(es el dato histórico, el viejo `FechaDet`). Una orden **CANCELADA** siempre gana: la regla no la
toca.

**¿Y si deja de cumplir?** Aquí se puso el freno a propósito, porque "decir la verdad" no puede
costarle a la operación una orden en curso. Una orden solo **regresa** de `completa` a `capturada`
cuando se dan las dos cosas: (1) se editó **la matriz de ESA orden** y (2) la orden **todavía no
tiene producción** (ningún corte ni envío vivo). En cualquier otro caso el estado se **conserva** y
lo que cambia es el aviso de la pantalla:

- **Editar la receta de un modelo NUNCA degrada sus órdenes.** Quitarle los avíos a un modelo es
  una operación de catálogo de todos los días; si degradara, de un clic se "des-completarían" cientos
  de órdenes viejas —incluidas las entregadas hace años— y las que están a medio producir. Al revés
  sí: **capturar** la receta completa sola a las órdenes de ese modelo a las que solo les faltaba eso.
- **Una orden ya cortada o enviada a maquila no se degrada** aunque le vacíen la matriz. Sigue
  `completa` y la pantalla avisa "Falta: tallas".

### La casilla "Lleva arte" (lo que decidió Daniel)

Daniel, textual: *"por default sí lleva. A menos que la marques como que no lleva. Y de esa manera
si no meten la información del arte, o no desmarcan la casilla, está como incompleto. Es decir,
siempre hay que atender ese tema."*

Así quedó, en la **ficha del modelo** (alta y edición), sección *Desarrollo*:

- **Casilla "Lleva arte (bordado o estampado)", MARCADA por default.** Debajo dice: *"Si la prenda
  no lleva bordado ni estampado, desmárcala; si no, la orden quedará incompleta hasta capturar el
  arte."*
- **Marcada + arte capturado en la receta** → requisito cumplido.
- **Marcada + receta sin arte** → las órdenes de ese modelo dicen **"Falta: arte"** y no se
  completan. Es el "siempre hay que atender ese tema".
- **Desmarcada** (prenda lisa) → el arte no aplica y no estorba.
- En el detalle del modelo se ve siempre: *Lleva arte* · *Lleva arte — falta capturarlo* · *No lleva
  arte*.

**Ojo con el efecto en lo que ya existe (es intencional):** la casilla nace marcada **también en los
miles de modelos que vinieron de Access**, así que **muchas órdenes vivas van a aparecer como
incompletas** hasta que se capture su arte o se desmarque la casilla. Eso es exactamente lo que
Daniel pidió. Por eso importa lo del siguiente apartado: **incompleta no impide trabajar la orden**.
Dos formas de atenderlo: capturar el arte en la receta del modelo, o desmarcar la casilla en los
modelos de prenda lisa (en ambos casos las órdenes se completan solas, sin tocarlas una por una).

### Dónde se ve

- **Órdenes de producción** (`/produccion/ordenes`): junto al chip de avance de cada renglón —y en
  el encabezado del panel de detalle— aparece un **"Falta: avíos"** / **"Falta: tallas"** cuando algo
  impide que la orden esté completa. Es la respuesta a *"no sé en base a qué existe el estado"*: la
  pantalla lo dice. Si la orden ya cumple, no se pinta nada (no estorba). El layout aprobado no
  cambió: no hay columna nueva, el texto va debajo del chip que ya estaba.
- La consulta **"Órdenes incompletas"** sigue funcionando igual, pero ahora una incompleta **puede
  tener matriz** (le puede faltar la receta de avíos), así que ya muestra sus piezas en vez de 0.

### Qué pasa con el HISTÓRICO (el día del deploy)

Aquí está el cambio que más se va a notar, y es **a propósito**: si el histórico se quedara como
estaba, el backlog que Daniel pidió atender —*"si no meten la información del arte… está como
incompleto; siempre hay que atender ese tema"*— sería **invisible**, porque la pantalla "Órdenes
incompletas" se guía por el estado guardado de cada orden. El semáforo **es** el entregable, así que
el histórico se pone al día **una sola vez** al desplegar:

- Corre sola una **puesta al día** (migración de datos, sin que nadie ejecute nada) que baja a
  **incompleta** las órdenes que hoy dicen "completa" pero **no cumplen** la regla: sin matriz, o su
  modelo sin receta de avíos, o el modelo lleva arte y no lo tiene capturado.
- **No toca** las órdenes que ya están **en producción** (con corte o envío a maquila vivos): esas
  conservan su "completa" pase lo que pase. Tampoco toca las **canceladas**.
- **No borra** la fecha en que la orden quedó completa por primera vez (el dato histórico se
  conserva; por eso puede haber órdenes "incompletas" que sí traen esa fecha).
- Cada orden que cambia **deja su renglón en la bitácora**, así que se puede ver qué se movió y por
  qué.

**Qué va a ver Daniel:** muchas OP viejas aparecerán como **incompleta**, casi todas con
**"Falta: arte"** (porque la casilla "Lleva arte" nace marcada en todos los modelos migrados) y
algunas con "Falta: avíos". Se resuelven **por modelo, no orden por orden**: capturar el arte en la
receta, o desmarcar la casilla si la prenda es lisa — en ambos casos las órdenes de ese modelo se
completan solas. Y mientras tanto **se puede seguir trabajando con ellas con toda normalidad**: el
estado no impide cortar, enviar, recibir ni entregar (ver el apartado siguiente).

De aquí en adelante no hay más recálculos masivos: cada orden se re-evalúa cuando nace, cuando se
toca su matriz o cuando se cambia el catálogo de su modelo (y en ese último caso, solo para
completarla).

### Ojo: el estado NO es una llave para operar (crítico con lo anterior)

Aparejado con lo anterior se quitó un filtro que sí habría parado la producción: el buscador de
órdenes que usan **siete** pantallas (captura de corte, envío a maquila, recibo de maquila, entrega
a cliente, salida de tela, nota de salida de tela y alta de auditoría) pedía **solo órdenes
completas**. Con el estado automático, una orden de un modelo sin receta de avíos —muy común en lo
que vino de Access— habría **desaparecido de esos siete buscadores** sin más explicación que un "no
hay órdenes que coincidan", y no se habría podido cortar ni entregar. Ahora esos buscadores muestran
**todas las órdenes menos las canceladas**, que es lo único que el sistema rechaza de verdad. El
`completa` es un **semáforo de captura**, no un permiso para trabajar.

### Los 3 remates que salieron del día

1. **El impreso de la orden ya dice "Avíos"** donde decía *"Habilitación"* (el renombrado de
   vocabulario del 24-jul no había podido tocar ese archivo). La sección de arte ya decía "Arte";
   el subtipo por renglón (Bordado / Estampado) se conserva.
2. **Los impresos ya no se quedan cacheados en el navegador.** Pasó de verdad: tras un despliegue,
   Daniel siguió viendo el PDF **viejo** media hora (solo en incógnito salía el nuevo). Ahora
   **todos** los PDF y todos los Excel del sistema salen con `Cache-Control: no-store` — está puesto
   en un punto **común** (no ruta por ruta), así que también aplica a los impresos que se agreguen
   después. El **logo** sigue cacheándose como antes (es un asset, no un documento).
3. **Al subir el logo se revisa el PNG.** Dos variantes de PNG que el generador de PDF pinta mal —los
   de **16 bits** y los de **color indexado con transparencia**— ahora se **rechazan al subirlos**,
   con un mensaje que dice qué hacer (*"guárdalo como PNG de 8 bits o JPG"*), en vez de dejar que el
   problema aparezca semanas después en un documento ya enviado. Si R2 no responde en ese momento,
   **no** se bloquea la subida (perder la marca sería peor que un color corrido).

### Nota de despliegue (para Gabriel)

1. **Hay DOS migraciones**, las dos automáticas (se aplican solas al desplegar, sin pasos manuales):
   - `20260726120000_modelo_lleva_arte` — agrega la columna `modelos.lleva_arte` con default `true`.
   - `20260726130000_recalculo_estado_ordenes` — **puesta al día del histórico** (solo datos, no
     cambia la estructura): baja a "incompleta" las órdenes que ya no cumplen la regla, **saltándose
     las que están en producción** y **sin borrar** la fecha de completado. Deja bitácora por orden.
2. **NO hay permisos nuevos** → **no** hace falta `SEED_ON_START`.
3. **NO hay que correr ningún script a mano**, pero **sí hay que avisarle a Daniel** que va a ver
   muchas OP históricas como **incompleta** con "Falta: arte": es el backlog que él pidió que se
   atienda, no un error. Las que ya están cortadas o en maquila no cambian. Se resuelven por modelo
   (capturar el arte o desmarcar "Lleva arte"), no orden por orden.
4. Al desplegar, conviene refrescar una vez con **Ctrl+Shift+R**: el arreglo de la caché de PDF
   aplica a los impresos **nuevos**; el PDF viejo que ya esté guardado en un navegador se suelta con
   esa recarga (después ya no vuelve a pasar).
5. **Cuando se borre la base y se vuelva a cargar** (es lo que Daniel dijo que va a pasar: *"todo lo
   que hay se va a borrar y meter nueva información"*), la puesta al día del punto 1 **no se repite
   sola** — corre una sola vez. Al terminar esa carga hay que ejecutar, una vez:
   `npx tsx --env-file=.env migracion/realinear-estado-ordenes.ts` (desde `backend/`). Aplica la
   misma regla y además hace las dos direcciones (marca las incompletas **y** completa las que ya
   cumplían); es re-ejecutable y deja un resumen de cuántas órdenes movió — con `--dry-run` primero
   se puede ver el impacto sin escribir nada. Está en el runbook (`backend/migracion/README.md`) y
   en la nota de F10 de `HOJA-DE-RUTA.md`.

### Archivos tocados

- **Backend (nuevos):** `prisma/migrations/20260726120000_modelo_lleva_arte/migration.sql` ·
  `prisma/migrations/20260726130000_recalculo_estado_ordenes/migration.sql` (puesta al día) ·
  `migracion/realinear-estado-ordenes.ts` (**el mismo realineado, re-ejecutable**, para después de
  cada carga de datos) ·
  `src/dominio/produccion/requisitos-orden.ts` (la regla, ÚNICA fuente) ·
  `src/comun/png.ts` (lectura del IHDR) · `src/api/cache-documentos.ts` (hook `no-store`).
- **Backend (modificados):** `src/dominio/produccion/ordenes.ts` (los 3 puntos usan la regla) ·
  `src/dominio/modelos/bom-modelo.ts` (capturar avíos/arte COMPLETA las órdenes del modelo, en la
  misma transacción; nunca las degrada) · `src/dominio/produccion/centro-comando.ts` (`faltantes`) ·
  `src/comun/auditoria.ts` (`registrarBitacoraLote`, para dejar bitácora por orden) ·
  `src/dominio/produccion/consultas.ts` (las incompletas ya suman piezas) ·
  `src/dominio/admin/empresas.ts` (inspección del PNG al confirmar el logo) · `src/app.ts` ·
  `prisma/schema.prisma` + `src/dominio/modelos/modelos.ts` + `src/api/modelos/modelos.rutas.ts`
  (la bandera `llevaArte`, y desmarcarla recalcula las órdenes del modelo) ·
  `src/contrato/esquemas/{orden,orden-centro}.ts` + `src/contrato/index.ts` · `openapi.json`.
- **Impreso:** `src/dominio/produccion/impresos/impreso-orden.ts` ("Avíos").
- **Frontend:** `src/modulos/ordenes/CentroOrdenesPagina.tsx` y `DialogoOrden.tsx` (el
  "Falta: …") · `src/modulos/ordenes/requisitos.ts` (**nuevo**, la frase compartida) ·
  `src/modulos/modelos/DialogoModelo.tsx` + `esquemas.ts` + `ModelosPagina.tsx` (la casilla
  "Lleva arte" y su aviso en la ficha) ·
  `src/modulos/produccion/SelectorOrden.tsx` (fuera el filtro por `completa`) ·
  `openapi.json` + `src/api/esquema.gen.ts` regenerados.
- **Pruebas:** `requisitos-orden.test.ts` (la regla completa, incluido *no aplica*, las
  transiciones y **cuándo se permite degradar**) · `ordenes.int.test.ts` (el BOM solo completa; una
  orden con corte vivo no se degrada; cancelada gana; la fecha no se borra — CI) ·
  `SelectorOrden.test.tsx` (**nuevo**: la regresión de las 7 pantallas no vuelve) ·
  `png.test.ts` + `empresas-logo.test.ts` (los PNG malos) · `cache-documentos.test.ts` +
  `auditorias.int.test.ts` + `logo.rutas.test.ts` (no-store sí, logo no) ·
  `CentroOrdenesPagina.test.tsx` / `DialogoOrden.test.tsx` (el "Falta: …").

---

## 2026-07-26 — El costo de MATERIALES ahora sale de lo que **realmente se compró**

Daniel: el costo de la orden se estaba sacando de la **receta del modelo × los precios del catálogo**,
y eso **no es lo que costó**. Cuando se compra, con frecuencia **cambian el proveedor y el precio** de
un avío o de la tela para esa orden en concreto — y todo eso ya está capturado en las **órdenes de
compra ligadas a la orden de producción**. Sus tres reglas, textuales:

1. **«Manda lo comprado: la OC autorizada»** (no lo recibido, no lo surtido).
2. **«Los avíos genéricos se valúan al último precio de compra»** (los de stock, que no se compran
   por orden).
3. **«Cuando una compra surte a más de una orden, el costo se prorratea.»**

### Cómo se calcula ahora, en lenguaje de negocio

Por cada material de la orden, el sistema suma dos cosas:

| | De dónde sale | Regla |
| --- | --- | --- |
| **Comprado para esta orden** | Las órdenes de compra **ligadas a la orden** que ya están **autorizadas** (o recibidas). Cantidad × precio de cada renglón, tal cual se compró. Las que están en **borrador**, **pendientes de autorizar** o **canceladas** NO cuentan. | 1 |
| **Valuado por consumo** | Lo que la orden consume y **no** tiene compra propia — los **avíos de stock** y las compras grandes que surten a varias órdenes — se valúa al **último precio al que se compró** ese material. | 2 y 3 |

**El prorrateo sale solo:** si compraste 10,000 botones en una sola OC sin ligarla a ninguna orden,
ese precio se vuelve "el último precio de compra"; cada orden se valúa por **lo que ella consume**, así
que el gasto se reparte en proporción al consumo, sin que nadie tenga que repartirlo a mano.

**Si se compró de MÁS, se costea de más.** Daniel: *"si se cortaron 1,000 prendas pero la orden de
etiquetas se hizo por 1,100, se debe costear —para efectos reales— el costo de la orden COMPLETA
entre lo cortado. En este caso debería costar 1.1 etiquetas por prenda"*. Así quedó: **lo comprado
entra completo**, nunca recortado a lo que "debía" consumir la orden, y como el costo unitario se
divide entre las **piezas cortadas**, el 1.1 por prenda sale solo. Comprar de más es normal: **no**
sale ningún aviso por eso.

**¿Cuánto consume la orden?** Lo que dice su **explosión de materiales (MRP)**, pero **ajustado a las
piezas que de verdad se cortaron** — la explosión se calcula sobre lo *pedido*, y el costo se
reparte sobre lo *cortado*, así que si pediste 1,000 y cortaste 900, el consumo se ajusta a esa
proporción (antes se costeaba sobre 1,000 y el costo salía ~11 % inflado sin que nada lo dijera). Si
la orden no tiene explosión, se usa la receta del modelo por las piezas cortadas. Y si la orden
**todavía no se corta**, el consumo es cero: solo cuenta lo que ya se compró (la pantalla lo dice).

**La receta de COSTO manda.** Se compara la explosión contra la receta de costo del modelo y se avisa
en los dos sentidos: si un material está en la **receta de costo** pero **no** en la explosión, se
costea con la receta (antes salía en **$0 sin decir nada**); si está en la explosión pero **no** está
marcado *"se considera al costear"*, no se valúa su consumo — aunque si se le compró para la orden,
esa compra sí cuenta. En ambos casos aparece un aviso en la pantalla.

La pantalla dice, junto a las etiquetas de arriba, **sobre qué se calculó**: *"Consumo de la explosión
de materiales, ajustado sobre 900 pzas cortadas"*, por ejemplo.

Esto aplica a **tela** y a **avíos**. La **maquila y el arte** no se compran con órdenes de compra:
esos siguen saliendo de la receta y de lo que traiga la orden, como siempre.

### Qué se ve en la pantalla *Costos › Costeo de orden*

Ahora la tabla trae **tres columnas** en vez de dos:

- **Real de compras** — lo de arriba: lo que de verdad se compró, más lo valuado a último precio.
- **Teórico** — la receta × precios de catálogo (lo de antes, se conserva para comparar).
- **Capturado** — lo que tú confirmas o ajustas. **Con esto se sigue armando el costo total y el
  costo unitario**; nada de eso cambió.

Debajo hay una etiqueta que dice si la orden **tiene compras registradas** o **no las tiene**, y dos
botones de conveniencia: **"Usar el real de compras"** y **"Usar el teórico"**, que copian el número
elegido a los campos capturables (tela y avíos) por si quieres partir de uno u otro.

**Lo que el sistema te propone al abrir una orden SIN COSTEAR cambió:** si la orden **tiene compras**,
te propone el **real**; si **no tiene ninguna**, te propone el **teórico**, igual que antes. **Siempre
puedes escribir tu propio número encima** — eso no se tocó.

**Y lo ya costeado NO se mueve.** Si una orden ya tenía su costo capturado y se vuelve a guardar sin
tocar un componente, ese componente **se conserva tal cual** (antes, en ese caso, se sobreescribía con
el valor propuesto). Para dejar un componente en blanco hay que borrarlo a propósito. Las órdenes ya
costeadas se quedan exactamente como estaban: nada se recalcula solo.

### El botón "Ver de dónde sale el real"

Abre un panel lateral con el **desglose material por material**, para que el número no sea una caja
negra. Arriba, tres cifras: *comprado para la orden*, *valuado por consumo* y *total de materiales*.
Abajo, un renglón por material con lo requerido, lo comprado, el importe, lo que quedó por valuar, el
precio usado y el total — y, debajo de cada material, **la lista de sus compras**: número de orden de
compra, **proveedor**, fecha, cantidad, precio y el importe de ese renglón. Cuando un material se
valuó a último precio, se ve **de qué OC y de qué proveedor** salió ese precio.

### Cuando algo no cuadra, lo dice (no lo esconde)

Bajo la tabla aparecen avisos en lenguaje llano cuando:

- un material **nunca se ha comprado** con orden de compra → se valuó al precio de catálogo;
- un material **no tiene precio por ningún lado** → se contó en $0 y hay que revisarlo;
- hay renglones de **compra libre** (fletes, servicios, cosas sin material de catálogo) ligados a la
  orden → se muestran aparte y **NO se meten** al costo de tela ni de avíos, porque el sistema no
  puede adivinar qué son; si corresponden a la orden, van en **"Otros"**;
- se compró para la orden un material que **no aparece en su explosión** → esa compra **sí** entra al
  costo, pero se avisa;
- una compra ligada a la orden viene con **precio en cero** → el costo de ese material se queda corto
  y hay que capturar el precio en la orden de compra;
- un material que la orden **sí requiere** acaba costando **cero** → hay un dato faltante;
- el real de un componente queda **por debajo de la mitad** del teórico → casi nunca es "compramos
  barato": suele ser que faltan compras, que no están autorizadas, o que van sin precio. Antes de
  guardar, revísalo;
- la explosión y la receta de costo **no coinciden** (los dos casos explicados arriba).

**Ningún aviso menciona cantidades de dinero.** Quien no tiene permiso para ver importes ve los avisos
igual, pero sin que se le escape ninguna cifra.

### Detalles finos que ya quedaron resueltos

- **Presentaciones de compra:** si un avío se compra por caja/rollo, la cantidad y el precio se
  convierten a la unidad de uso con **el mismo factor que usa la recepción de material**, para que el
  costo cuadre con lo que entra al almacén. El importe total nunca cambia al convertir. Se detectó un
  **defecto viejo del módulo de compras** que afecta a las órdenes de compra **generadas
  automáticamente desde la explosión** cuando el material se compra por caja/rollo: en esos casos el
  sistema **avisa** que ese renglón puede venir sesgado. El arreglo de fondo es un trabajo aparte (ya
  está anotado como pendiente) porque tocaría órdenes de compra ya emitidas.
- **Los centavos cuadran:** el desglose suma exactamente lo que dice el encabezado (se redondea una
  sola vez, de abajo hacia arriba).
- **Empresa:** solo se ven las compras de la empresa con la que estás trabajando.
- **Permisos:** ninguno nuevo. Se ve con el permiso de costos de siempre, y quien no tiene permiso de
  ver importes sigue viendo "—" en el dinero (las **cantidades** sí las ve).
- **El Estado de Resultados no cambió**: sigue tomando el costo capturado de cada orden.

### Archivos tocados / creados

- `backend/src/dominio/costos/costo-real-compras.ts` — **nuevo**: el motor del costo real.
- `backend/src/dominio/costos/costo-orden.ts` — el real se suma a la respuesta y manda el valor
  propuesto en el primer costeo; congela `telaReal`/`aviosReal`; omitir un componente ya guardado
  ahora lo conserva.
- `backend/migracion/loaders/costos.ts` — la carga del histórico NO calcula el real (no tiene sentido
  sellar un número de hoy en una orden vieja, y así el ETL no se hace más lento).
- `backend/src/contrato/esquemas/costos.ts` + `index.ts` — las formas nuevas del contrato.
- `backend/src/api/costos/costos.rutas.ts` — `GET /costos/ordenes/:idOrden/real` (desglose).
- `backend/prisma/schema.prisma` + `prisma/migrations/20260726140000_costo_orden_real_compras/` —
  columnas `tela_real` / `avios_real` (aditivas, nullable).
- `frontend/src/modulos/costos/CosteoOrdenPagina.tsx` — tres columnas, botones, avisos y el cajón
  del desglose.
- `frontend/src/api/costos.ts` + `src/api/tipos.ts` — el hook y los tipos del desglose.
- `Documentacion_MJD/DECISIONES.md` (§Post-F9.5) · `docs/modulos/costos-edr.md` · `HOJA-DE-RUTA.md` ·
  esta bitácora.
- **Pruebas:** `costo-real-compras.test.ts` (**nuevo**, 28 casos del cálculo puro: directo, valuado,
  mezcla, **el caso de las 1,100 etiquetas de Daniel**, prorrateo, sin precio, precio en cero, costo
  cero, el comparativo contra el teórico, compras libres, unidades, cuadre de centavos, y que
  **ningún aviso lleve dinero**) · `costo-real-compras.int.test.ts` (**nuevo**, camino completo contra
  Postgres en CI: estatus de la OC, empresa, factor de conversión, ajuste a las piezas cortadas,
  reconciliación con la receta de costo, la sobre-compra, el valor propuesto al guardar, que lo ya
  capturado se conserve y que la carga del histórico no calcule el real) ·
  `CosteoOrdenPagina.test.tsx` (**nuevo**, las tres columnas, la propuesta, la base del cálculo y el
  desglose bajo demanda).

---

## 2026-07-28 — En el CELULAR: "regresar" vuelve al listado + el botón de avance ya sirve

Daniel: *"Si estoy en OC, y me meto al detalle de una en el celular, le doy regresar y me manda a
la página de almacenes. Debería de regresar al listado de órdenes. Y ahí mismo el botón de avances
de producción no sirve."*

Dos cosas distintas, las dos **solo en el teléfono** y las dos en `Órdenes de producción`
(`/produccion/ordenes`, `CentroOrdenesPagina`). No se tocó nada del backend.

### A) El "regresar" del teléfono te sacaba de la pantalla

En el celular el detalle de la orden **no es una página aparte**: es un **cajón** que se desliza
encima del listado. El navegador no sabe nada de ese cajón, así que el botón "atrás" del teléfono
hacía lo único que sabe hacer —retroceder a la pantalla anterior— y te sacaba de Órdenes (a Almacenes,
o a donde hubieras estado antes). Lo natural es lo contrario: **el "atrás" cierra el cajón y te deja
en el listado**, que es justo lo que hay debajo.

- Mientras el cajón está abierto, el sistema **le reserva un lugar en el historial** del navegador
  (misma pantalla, misma dirección: no hay navegación ni parpadeo). El "atrás" gasta ese lugar y lo
  único que pasa es que **el cajón se cierra**. Si cierras con la ✕, con Esc o tocando afuera, el
  lugar se devuelve solo.
- Aplica a **todas las pantallas** que usan el cajón de detalle (Órdenes, Pedidos, Modelos,
  Clientes, Proveedores, Compras, Notas de salida, Calidad, Usuarios, Roles, Bitácora, CxC, CxP…),
  no solo a Órdenes: era el mismo problema en todas.
- También aplica al **panel de "Avance de producción"** a pantalla completa, que tenía el mismo
  defecto.
- Con **dos cajones encimados** (el detalle de la orden y, sobre él, "Avíos" o "Ruta crítica"), el
  "atrás" cierra **solo el de encima** y te deja en el de abajo.
- **En la computadora** el comportamiento también cambia, y para bien: el botón "Atrás" del
  navegador ahora **cierra el cajón** en vez de salirse de la pantalla.
- Lo que **no** cambia (y es a propósito): si con el cajón abierto te vas a otro módulo desde un
  mosaico del propio detalle (Modelo, Avíos, Notas, O.C., Ruta crítica…), eso **sí** es una
  navegación de verdad y el "atrás" te regresa a Órdenes, como debe ser. Nunca se deshace una
  navegación que el usuario pidió.

### B) El botón "Registrar avance de producción" no hacía nada

No estaba muerto: **se abría por debajo del cajón**. El cajón se dibuja "por encima de todo", y el
panel de avance se dibuja dentro de la página, así que el panel quedaba tapado y los toques caían en
el cajón. Ese cuidado ya existía para el botón **Modificar** (cierra el cajón antes de abrir el
diálogo), pero al avance se le había pasado.

- Ahora **abrir el avance cierra el cajón**, así que el panel queda al frente y usable.
- Se puso en la función que abre el avance —no en el botón— para que cubra **todas las formas de
  entrar**: el botón del detalle y el **doble clic** sobre un renglón de la lista (o sobre una
  tarjeta, en móvil).

### Nota de despliegue (para Gabriel)

**Nada que hacer.** Es un cambio de puro frontend: **sin migración**, **sin permisos nuevos** (→ no
hace falta `SEED_ON_START`) y **sin scripts que correr**. Conviene refrescar una vez con
**Ctrl+Shift+R** para soltar el JavaScript viejo que el navegador tenga guardado.

### Archivos tocados

- **Frontend (nuevos):** `src/lib/useCerrarConAtras.ts` (el motor: le reserva su lugar en el
  historial a cada capa abierta y lo empareja solo) + `src/lib/useCerrarConAtras.test.tsx`.
- **Frontend (modificados):** `src/components/dominio/CajonDetalle.tsx` (el cajón que usan las 17
  pantallas) · `src/modulos/produccion/AvanceProduccion.tsx` (el panel a pantalla completa) ·
  `src/modulos/ordenes/CentroOrdenesPagina.tsx` (abrir el avance cierra el cajón).
- **Pruebas:** `useCerrarConAtras.test.tsx` (10 casos: el "atrás" cierra en vez de salirse, cajones
  encimados, cerrar por la UI devuelve el lugar, cerrar dos a la vez, cerrar uno y abrir otro en el
  mismo instante —el caso del botón de avance—, modo estricto de desarrollo, el deep-link que limpia
  su estado, no deshacer una navegación legítima y el lugar huérfano que se salta solo) ·
  `CentroOrdenesPagina.test.tsx` (en móvil, abrir el avance cierra el cajón).

---

## 2026-07-28 — Los campos de cantidad ya no se "mueven solos"

Daniel: *"En general en todos los campos para meter datos de corte, maquilas, incluso en la OP…
pones una casilla con flechitas arriba y abajo para ir aumentando con el mouse… no funciona. Siempre
se van a meter escribiendo o copiando los datos. Nunca se usarán esas flechitas. Quítalas por
favor."*

### Qué se quitó

Las **flechitas** desaparecieron de **todos** los campos de cantidad del sistema — son 123, y están
por todos lados: captura de corte, entrega y recibo de maquila, entrega a cliente, matriz color ×
talla, precios, cantidades de compra, configuración. No se fue campo por campo: es **una sola regla
de estilo** aplicada a todo el sistema, así que ninguna pantalla nueva vuelve a traerlas.

Los campos **siguen siendo numéricos**. Eso importa por dos cosas que no se quieren perder: en el
**celular sigue saliendo el teclado de números** (no el de letras), y el navegador sigue impidiendo
que se escriban letras donde va una cantidad.

### Y de paso, dos formas de "moverse solo" que nadie había visto

La casilla numérica tiene **tres** maneras de subir o bajar el valor con un gesto, no una. Las otras
dos no se ven, y son peores porque **cambian la cantidad sin que nadie se dé cuenta**:

1. **La rueda del mouse.** Con el cursor dentro de la casilla, girar la rueda —creyendo que uno está
   haciendo scroll para ver el resto de la pantalla— **cambiaba el número**. Ya no: al girar la
   rueda, el campo simplemente suelta el cursor y la página hace scroll normal.
2. **Las flechas ↑ ↓ del teclado.** En la matriz color × talla las flechas sirven para **bajar al
   siguiente renglón**, y así se usan. Pero en el **último renglón** no hay a dónde bajar… y ahí la
   flecha le restaba 1 a la cantidad recién tecleada: quien escribía **120** y bajaba por costumbre
   se quedaba con **119**, sin ningún aviso. (Lo mismo hacia arriba en el primer renglón, sumando
   1.) Ya no: las flechas siguen moviendo el cursor entre celdas, pero **nunca tocan la cantidad**.

Este segundo caso **no era nuevo**: llevaba tiempo ahí, y es de los que no se descubren revisando
pantallas, sino cuadrando un corte que no da. Salió al revisar el cambio de las flechitas.

### Un efecto secundario, a propósito

Cuando se gira la rueda sobre una casilla, esta **suelta el cursor**. Si en ese momento se usara la
tecla **Tab**, el sistema salta al principio de la pantalla en vez de a la casilla siguiente. Se
eligió así porque la alternativa era peor: cancelar la rueda **congelaría el scroll** de la página
mientras el puntero esté sobre la casilla, que es justo lo contrario de lo que uno quiere al girar
la rueda. En las matrices se avanza con las flechas y con el clic, no con Tab, y se recupera con un
clic. Si en el uso real estorba, se cambia.

### Nota de despliegue (para Gabriel)

**Nada que hacer.** Frontend puro: **sin migración**, **sin permisos nuevos** (→ no hace falta
`SEED_ON_START`), sin scripts. Un **Ctrl+Shift+R** la primera vez para soltar el estilo viejo que el
navegador tenga guardado.

### Archivos tocados

- **Frontend (nuevos):** `src/lib/sin-incrementos-numericos.ts` (la guarda global de la rueda y las
  flechas) + `src/lib/sin-incrementos-numericos.test.ts` · `e2e/campos-numericos.spec.ts`.
- **Frontend (modificados):** `src/index.css` (la regla que apaga las flechitas, en la base) ·
  `src/main.tsx` (instala la guarda).
- **Pruebas:** 9 unitarias (la rueda solo actúa sobre el campo numérico **enfocado**, no estorba en
  texto ni en el scroll horizontal; ↑/↓ cancelan el incremento **sin** romper la navegación de la
  matriz; ←/→ y Enter intactos; instalación idempotente) y **1 e2e en navegador real**, que es la
  única que puede comprobar que el valor **no se mueve** — el entorno de pruebas unitarias no
  implementa ni la rueda ni el incremento por flechas.

---

## 2026-07-28 — Avance de producción: maquileros y descarga de tela

Tres peticiones de Daniel sobre la captura del avance (WIP) dentro de la OP, en la misma sesión que
las flechitas.

### A) La entrega a maquila ya llega con el maquilero puesto

Daniel: *"Si ya tengo un maquilero programado en la OP… que cuando le dé en entrega a maquila, me
ponga por default el maquilero que ya estaba definido."*

Al abrir **Entrega a maquila**, el campo del maquilero arranca con el que la OP ya tiene asignado en
su encabezado. Es un **default, no un candado**: si esta vez se manda a otro taller, se cambia y ya.

Aplica a **costura**. Para **Arte** no hay default que poner: la OP no programa un Prov. de Arte (el
que se ve en el Centro de Órdenes sale del primer envío que se le hizo, no de una asignación previa).

### B) Solo se le puede recibir a quien se le entregó

Daniel: *"En recibo de maquila me debe de filtrar solo a los maquileros que se le haya entregado el
corte. **No puedo recibir un corte de un maquilero diferente al que se lo entregué.** Misma lógica
para los maquileros de arte."*

Esto resultó ser **más que un filtro de pantalla**, y vale la pena decirlo claro: hasta hoy el
sistema cuidaba que no se recibiera más de lo enviado **en total del proceso**, pero **no llevaba la
cuenta por maquilero**. Con dos talleres trabajando la misma orden, se le podía cargar a uno lo que
devolvió el otro — y la cuenta de cada quien (su estado de cuenta EsMa, sus existencias en poder de
maquila) quedaba mal **sin que nada lo impidiera**.

Ahora:

- La lista del recibo ofrece **únicamente** a los maquileros con entrega viva en esa orden, y al lado
  de cada uno dice **cuántas piezas le faltan devolver**. Al que ya devolvió todo no se le ofrece:
  no hay nada que recibirle.
- Las cantidades que se teclean se comparan contra **lo que ese maquilero tiene**, no contra el
  total del proceso.
- **El servidor lo vuelve a revisar al guardar.** Una lista filtrada en pantalla se brinca; la regla
  de Daniel no. Si se intenta, el mensaje dice a quién **sí** se le puede recibir.

Lo mismo aplica al **Recibo de Arte**.

Aplica en **las dos pantallas** donde se recibe: el panel de avance dentro de la OP y la pantalla
`Recibo de maquila` del menú (a la que manda la Ruta Crítica). Las dos leen el mismo dato del
servidor, así que no pueden decir cosas distintas.

> **Notas para Gabriel, con los ojos abiertos:**
>
> 1. Si en los datos migrados hubiera recibos viejos que no cuadran contra su entrega, una orden
>    antigua podría rechazar un recibo nuevo. Se eligió el **bloqueo duro** —que es lo que dijo
>    Daniel— en vez de un aviso que se puede ignorar. El mensaje de error dice quién sí tiene entrega
>    viva, así que el caso se diagnostica solo.
> 2. Hay entregas del histórico que **no traen maquilero** (el Access no siempre lo guardaba). A esas
>    piezas no se les puede recibir: la pantalla lo **avisa** ("hay N pza(s) entregadas SIN maquilero:
>    hay que corregir esa entrega antes de poder recibirlas") en vez de decir que no hay nada
>    pendiente. **Resuelto por Gabriel (30-jul-2026):** los datos de hoy son de prueba y se van a
>    recargar, así que **la inconsistencia vieja se deja quieta** y **no se construye** una pantalla
>    para asignarle maquilero a esas entregas; lo que se captura en v2 no puede nacer inconsistente,
>    que es de lo que se trataba el candado.

### C) "Aplicación" ahora se llama Arte

Las etapas pasaron a llamarse **Entrega de Arte** y **Recibo de Arte**, y su proveedor, **Prov. de
Arte** — tanto en el avance por etapas de arriba como en el encabezado de cada etapa. Completa el
barrido de vocabulario del 24 de julio.

### D) Al cortar, un enlace para descargar la tela

Daniel: *"A la hora de cortar, es necesario descargar la tela de los inventarios… estaría bueno que
en el mismo avance de producción podamos poner un enlace para descargar las telas cortadas."*

Buena noticia: **las dos vías que describe ya existen** desde F4 y no había que construirlas —
la **salida de tela a una orden** (la única que descuenta tela ligándola a una OP y deja la traza) y
la **nota de salida abierta** (que no cuelga de ninguna orden, y por eso sigue en su módulo). Lo que
faltaba era el **puente**.

En la etapa de **Corte** aparece ahora el botón **"Descargar tela del inventario"**, que abre esa
pantalla **con la orden ya seleccionada**, sin volver a buscarla. Solo lo ve quien tiene permiso
para mover inventario de telas.

**Lo que NO se hizo, a propósito:** descontar la tela **automáticamente** al registrar el corte. El
corte se captura en **piezas por color y talla**; la salida de tela se descuenta en **metros o kilos,
por tela y por lote**, y eso no se deduce del corte — depende del tendido real, de la tela dispuesta
y del lote del que se jaló. Inventar ese número descuadraría el inventario con algo que nadie
capturó. El enlace deja la captura en manos de quien sabe, que es lo que Daniel pidió.

### Nota de despliegue (para Gabriel)

**Nada que hacer.** **Sin migración**, **sin permisos nuevos** (→ no hace falta `SEED_ON_START`),
sin scripts. Hay cambio de contrato (el API del avance ahora desglosa el pendiente por maquilero),
pero se despliega con el mismo deploy: backend y frontend van juntos.

### Archivos tocados

- **Backend:** `src/contrato/esquemas/wip.ts` (desglose `porMaquilero` en "por recibir") ·
  `src/dominio/produccion/wip.ts` (lo deriva el servidor, nunca se pivotea en el cliente) ·
  `src/dominio/produccion/recibos.ts` (el saldo del recibo se lleva por maquilero + el mensaje que
  dice a quién sí) · `openapi.json`.
- **Frontend:** `src/modulos/produccion/AvanceProduccion.tsx` (el default, la lista filtrada con su
  pendiente, el vocabulario Arte y el enlace de tela) ·
  `src/modulos/produccion/ReciboMaquilaPagina.tsx` (la misma regla en la pantalla del menú) ·
  `src/modulos/inventarios/SalidaTelaOrdenPagina.tsx` (recibe la orden por deep-link) ·
  `openapi.json` + `src/api/esquema.gen.ts` regenerados.
- **Pruebas:** `recibos.int.test.ts` (**contra Postgres en CI**: rechaza recibirle a quien no se le
  entregó —y nombra a quien sí—, y con dos maquileros a cada uno solo se le recibe lo suyo, con el
  desglose del WIP cuadrando) · `AvanceCaptura.test.tsx` (**nuevo**: el default de la OP, que sin
  maquilero asignado el campo queda vacío, la lista filtrada con su pendiente, que el que ya devolvió
  todo no se ofrece, y el enlace de tela con su permiso) · `SalidaTelaOrdenPagina.test.tsx` (el
  deep-link llega con la orden puesta y sin deep-link no se pide nada al servidor).

---

## 2026-07-30 — Telas: unidad en kilos o metros, búsqueda por color y el cardigan al tono

Primera tanda del trabajo de **consumos de tela e inventarios** que pidió Daniel. Antes de
construir nada se revisó qué existía ya, y resultó que **lo más difícil ya estaba resuelto**.

### Lo que ya existía (y Daniel no sabía que sí)

> *"No sé si tienes definido poder hacerlo por lotes… la felpa lleva su cardigan y es importante que
> esté junto el registro, porque puede haber dos partidas de negro y cada una lleva su cardigan al
> tono."*

Eso ya está desde el arranque: un **lote** es una partida de **un color**, con su proveedor, su
factura y su fecha, y **adentro trae varias telas**. Dos partidas de negro son **dos lotes**, cada
uno con su cardigan del mismo teñido, y el inventario se lleva por **tela × lote × almacén** — nunca
se revuelven. También estaban el **precio por color** y el **precio por proveedor y por color** (el
cardigan es otra tela, así que lleva su propio precio).

### A) La unidad: kilos o metros, y ya

Daniel: *"todo lo que se compra en kilos se consume en kilos y lo que se compra en metros se consume
en metros… solo kilos y metros, no hay otras medidas"*.

La unidad **era un texto libre** con una lista de sugerencias (KILOGRAMO, YARDA, ROLLO, CONO…) y
—peor— **estaba vacía en todas las telas**. Sin unidad, el stock no se puede leer, el consumo no se
puede comparar y el costo por prenda no significa nada.

- Ahora es **una elección de dos: Kilos o Metros**, y es **obligatoria al dar de alta la tela**, sin
  valor por default. Es a propósito: una tela de metros que naciera marcada en kilos ensuciaría el
  inventario **sin que nadie lo note**. Quien la da de alta lo sabe; el sistema no lo adivina.
- En la edición se puede **cambiar** de una a otra, pero **no dejarla en blanco**.
- **El dato viejo no se inventó.** El Access sí lo guardaba: la columna `Medida` de la tabla de
  telas, y el propio formulario viejo declara qué significa (**-1 = Kilos, 0 = Metros**). Son **735
  telas en kilos y 142 en metros**, y así las va a cargar el ETL. Las telas que ya están cargadas
  en `prueba` pasan a kilos con la migración, y **el ETL las corrige al re-correrse**: compara la
  unidad de cada tela ya migrada contra el dato del Access y la ajusta si difiere, reportando cada
  corrección. No hace falta borrar la base.

### B) Buscar el catálogo por color

En el almacén se busca *"negro"* mucho más seguido que el nombre exacto de la tela. El buscador del
catálogo ahora mira **el nombre de la tela y el de sus colores**.

### C) Al descargar, el cardigan al tono se ofrece junto

Daniel: *"normalmente se descargan las telas al mismo tiempo cuando están relacionadas"*.

Al elegir un lote en la salida de tela, aparece un aviso con **las otras telas de esa misma
partida** (con lo que hay disponible de cada una) y un atajo para capturarlas seguidas, sin volver a
buscar el lote. Y respetando su otra regla —*"nada se estima, ni es un porcentaje… todo lleva una
cantidad tecleada"*—: **se ofrecen, no se descuentan solas**. Cada una lleva su cantidad. La que ya
se capturó deja de ofrecerse.

### D) El botón "Consumo tela" de la OP

Abría la pantalla en blanco y había que volver a buscar la orden. Ahora **llega con esa orden
puesta**, como el enlace del avance de producción.

### Nota de despliegue (para Gabriel)

1. **Una migración**, automática: `20260730120000_unidad_tela`. Convierte la unidad a kilos/metros
   respetando lo que estuviera capturado a mano y dejando el resto en **kilos**.
2. **NO hay permisos nuevos** → **no** hace falta `SEED_ON_START`.
3. Al desplegar, **todas** las telas van a aparecer en **kilos**. Para corregir las que van en
   metros hay que **re-correr el ETL de catálogos** (no hace falta borrar la base): desde `backend/`,
   `npx tsx --env-file=.env migracion/etl-catalogos.ts`. El reporte lista cada tela corregida bajo
   *"Telas con la unidad corregida (kilos/metros del Access)"*. Mientras no se corra, Daniel verá
   142 telas de metros marcadas en kilos — y conviene avisarle, porque **todas** dirán kg y el error
   no se nota solo.

### Lo que sigue (y no entró aquí)

**Entrada de tela por factura o remisión** sin orden de compra (con el PDF adjunto), la **pantalla
de stocks** por proveedor / tipo / color —el API ya acepta un filtro por color (`idColor`) que esa
pantalla va a usar; está puesto de antemano a propósito, para que quien la construya no lo
reinvente—, y el **packing list de rollos** —que queda al final y como
dato informativo del lote, porque *"los rollos solo podrían ser informativos"*—. El **consumo por
prenda** se mostrará junto al estimado, pero **no se empuja solo al costeo**: eso toca el módulo de
Costos y se hace aparte.

### Archivos tocados

- **Backend:** `prisma/schema.prisma` + migración `20260730120000_unidad_tela` (enum `UnidadTela`) ·
  `src/contrato/esquemas/tela.ts` (obligatoria en el alta, no vaciable en la edición, filtro
  `idColor`) · `src/dominio/catalogos/telas.ts` (la búsqueda mira los colores) ·
  `migracion/comun/mapeos-enum.ts` + `migracion/loaders/telas.ts` (la unidad real del Access) ·
  `openapi.json`.
- **Frontend:** `src/modulos/telas/DialogoTela.tsx` (la unidad como elección obligatoria) ·
  `src/modulos/inventarios/CapturaRenglonesTela.tsx` (telas al tono del lote) ·
  `src/modulos/ordenes/CentroOrdenesPagina.tsx` (el mosaico lleva la orden) · `src/api/telas.ts` ·
  `openapi.json` + `esquema.gen.ts` regenerados.
- **Pruebas:** `mapeos-enum.test.ts` (el mapeo -1/0 del Access) · `tela.test.ts` (alta sin unidad
  rechazada; no se puede vaciar) · `telas.int.test.ts` (**CI**: búsqueda por color, filtro por color,
  y la unidad como se eligió) · `CapturaRenglonesTela.test.tsx` (**nuevo**: el aviso de telas al
  tono, el atajo que conserva el lote, y que la ya capturada deja de ofrecerse).

---

## 2026-08-06 — El catálogo de telas, reestructurado (etapa A1 de la conversación de telas)

Primera etapa construida de la conversación del 6 de agosto (las reglas completas, en
`DECISIONES.md §Post-F9.11`). Esto es SOLO el catálogo; el inventario con partidas (A2), la entrada
por factura y la pantalla de stocks vienen después, sobre esta base.

### A) La identidad de una tela ahora son cuatro datos

Daniel: *"Me gustaría tener más información: nombre de la tela genérica, composición (de un catálogo
para mantener congruencia), nombre del proveedor, y nombre de la tela como le llama el proveedor."*

- **Tipo de tela** ("Felpa"): es la categoría que ya existía, re-etiquetada.
- **Composición** ("50% Algodón, 50% Poliéster"): catálogo NUEVO, administrable desde el propio
  diálogo de la tela (alta rápida, igual que las categorías).
- **Proveedor** (Alsatex): el dueño del artículo. **Obligatorio en telas nuevas**; las 877 migradas
  quedan sin él y se van llenando al depurar (decisión explícita).
- **Nombre del proveedor** ("Felpa Suiza"): como le llama él.

El renglón del catálogo se lee de corrido: **Felpa · Alsatex · Felpa Suiza**, y el buscador
encuentra por cualquiera de los cuatro (y por color y pantone).

### B) El complemento (cardigan) es parte de la misma tela

Daniel: *"Es como parte de la misma tela para el manejo de todo… mismo color, mismo pantone, parte
de la misma tela padre."* Desde el alta se declara si la tela lleva complemento y cómo se llama
("Felpa" / "Cardigan"). Cada color lleva **dos precios** — el del cuerpo y el del complemento — y
la columna del complemento solo aparece si la tela lo lleva. Si se desmarca el complemento, sus
precios se limpian en todos los colores (regla del servidor, no de la pantalla).

### C) Los colores de la tela ya NO salen del catálogo de colores de prenda

Daniel: *"No debería de haber un catálogo de colores. Debería ser un campo abierto. Chance estaría
bien tener un nombre genérico del color, y un campo adicional con el pantone."* (registrado en
`DECISIONES.md §Post-F9.11` punto 3). Ahora cada tela tiene SUS colores: se teclean libres, con su pantone,
y "Negro" puede existir en veinte telas sin estorbarse. El catálogo global de colores queda SOLO
para el color de la prenda (la matriz de la OP y todo el WIP), que es donde debe ser una lista
controlada. Las telas migradas conservan una liga al color viejo para que el histórico siga
cuadrando (MRP incluido).

### D) Alta de color de PRENDA al vuelo en la orden

La contraparte del punto C: al capturar la matriz de la OP, un color que no existe ("Indigo con
Amarillo") **se crea ahí mismo**, sin salirse a Catálogos → Colores. Busca en el servidor (no solo
en los primeros 100), sugiere los existentes y solo ofrece "crear" cuando de verdad no está. Solo
lo ve quien tiene permiso de administrar colores.

### Nota de despliegue (para Gabriel)

1. **Una migración**, automática (`20260806120000_tela_identidad_complemento`): catálogo de
   composiciones + los campos nuevos + la reestructura de `telas_colores` (los nombres se copian de
   la liga vieja; nada se pierde).
2. **Cero permisos nuevos** (composiciones reúsa `telas.ver`/`telas.administrar`) → **no** hace
   falta `SEED_ON_START`.
3. **Nada que correr a mano.** Y si el ETL de catálogos se re-corre, **respeta la depuración
   manual**: conserva los pantones, los precios de cardigán, los colores agregados a mano y las
   correcciones de nombre — solo actualiza el precio del cuerpo si el CSV trae otro.

### Archivos principales

- **Backend:** `prisma/schema.prisma` + la migración · `dominio/catalogos/telas.ts` (composiciones
  CRUD, identidad, complemento con su invariante, colores por nombre) · `dominio/catalogos/colores.ts`
  (la fusión conserva pantone/precios) · `dominio/costos/resolucion-precios.ts` (helper del orden de
  resolución, listo para A2) · `api/telas/telas.rutas.ts` · contrato + `openapi.json`.
- **Frontend:** `modulos/telas/{TelasPagina,DialogoTela,EditorColoresTela}.tsx` ·
  `modulos/ordenes/{AgregarColorMatriz,PanelMatriz}.tsx` · `componentes/matriz-color-talla` (prop
  `slotAgregarColor`) · `api/telas.ts` + cliente regenerado.

## 2026-08-06 — El inventario de telas nuevo: partidas y stocks por color (etapa A2)

La vista que Daniel pidió: **telas padre desplegables → colores con sus stocks, con la tela base y
su complemento (cardigan) JUNTOS**. Sustituye en operación al inventario por lote de F4 (que queda
como "legado", consultable pero en cuarentena — los movimientos nuevos no lo ensucian ni al revés).

### A) Existencias por tela y color

`Inventarios → Telas → Existencias de telas`: cada tela padre se despliega y muestra sus colores
con DOS columnas de existencia — el cuerpo y el complemento, con los nombres reales ("Felpa" /
"Cardigan") como encabezados; pantone y unidad (kg/m) a la vista; filtros por tipo, proveedor,
almacén y búsqueda. **Doble clic (o el botón) en un color** abre su kardex: todos sus movimientos
con saldo corrido de ambos componentes, filtrable por partida, y con cancelación (que registra el
movimiento inverso — nunca borra, D3).

### B) Partidas con folio propio

Cada ENTRADA crea una **partida** con folio consecutivo propio (ya no la clave ilegible
`LOTE-...-...`): un renglón = una partida, con su número de lote del proveedor (opcional, buscable),
factura y fecha. Una factura con dos lotes del mismo color = dos renglones = dos partidas. Las
SALIDAS no piden partida: el consumo empareja por **tela + color** (como pidió Daniel), y la
pantalla avisa el **riesgo de tono** sin bloquear.

### C) Capturas nuevas

Ajuste/conteo físico por color (la puerta del **arranque desde cero**), traspaso entre almacenes por
color, y **salida de tela a orden por color** — esta última hereda el enlace "Descargar tela" desde
el avance de producción. Todas capturan las dos cantidades juntas (cuerpo puede ir en 0 si solo
entra cardigan).

### D) El menú de Telas, destapado

El grupo `Inventarios → Telas` ahora SÍ se despliega en el riel (antes iba directo a existencias y
escondía todo): Existencias, **Catálogo de telas** (el que Daniel no encontraba), Salida a orden y
Ajuste. Lo demás (kardex, traspaso, pantallas de lote legado) sigue por ⌘K.

### Nota de despliegue (para Gabriel)

1. **Una migración automática** (`20260806130000_a2_partidas_telas`): tabla `partidas_tela`, 3
   columnas nuevas en el detalle del kardex, la vista nueva `existencia_tela_color` y el reemplazo
   de la vista vieja con su filtro de cuarentena. Aditiva; nada se pierde.
2. **Cero permisos y cero tipos de movimiento nuevos** (reúsa `inventario-telas.ver/.mover`) →
   **no** hace falta `SEED_ON_START`.
3. **Nada que correr a mano.** La secuencia del folio de partida se crea sola en el primer uso.

### Archivos principales

- **Backend:** `prisma/schema.prisma` + la migración · `comun/kardex.ts` (línea de tela con
  color/partida/complemento, lock por color, inverso completo, cuarentena del legado) ·
  `dominio/inventarios/partidas-telas.ts` (dominio nuevo completo) · `dominio/inventarios/telas.ts`
  (kardex legado filtrado) · contrato + `api/inventarios/telas.rutas.ts` (7 endpoints
  `/inventarios/telas/color/*` + partidas).
- **Frontend:** `modulos/inventarios/{ExistenciasTelasColorPagina,CapturaRenglonesTelaColor,`
  `AjusteTelaColorPagina,TraspasoTelaColorPagina,SalidaTelaColorOrdenPagina,DialogoCancelarMaterial}.tsx`
  · `modulos/catalogo.ts` (Telas como nodo padre) · `api/inventario-materiales.ts` + cliente
  regenerado.

## 2026-08-06 — Remates del catálogo de telas (etapa A1.1, feedback de Daniel)

Daniel probó el catálogo nuevo en `prueba` y pidió 8 ajustes; todos entraron:

### A) Dos datos nuevos: peso y ancho

La tela ahora lleva **peso (gr/m²)** y **ancho (m)**, opcionales, capturables en el diálogo y
visibles en el detalle cuando tienen valor.

### B) Menos fricción y menos ruido al capturar

- **"Favorita" viene marcada por default** al dar de alta (se puede desmarcar).
- El ejemplo del alta de color ahora dice **"Negro"**.
- Se **ocultaron** las dos casillas que confundían: "¿Es tela de producción?" (queda por dentro con
  su default) y "Tipo de componente" (redundante con los nombres de cuerpo/complemento — quedó
  superada y se retiró de la pantalla; el dato viejo no se pierde).

### C) Nombres consistentes sin teclear de más

- Marcar "lleva complemento" **pre-llena "Cardigan"** (editable, para que siempre se escriba igual).
- Elegir el tipo de tela **propone el nombre del cuerpo** ("Felpa 50/50" → "Felpa") — aplica cuando
  la tela lleva complemento, que es donde ese campo existe.
- El proveedor ganó un **"Nombre corto"** (BLOOM TEXTIL → "Bloom") y el **nombre de la tela se arma
  solo**: nombre corto + nombre del proveedor de la tela → **"Bloom Felpa España"**. Si lo tecleas a
  mano, lo tuyo manda; si lo vacías, se vuelve a armar.

### Nota de despliegue (para Gabriel)

1. **Una migración automática** (`20260806140000_tela_peso_ancho_proveedor_nombre_corto`): 3
   columnas nuevas opcionales (peso/ancho en telas, nombre corto en proveedores). Aditiva.
2. **Cero permisos nuevos** → **no** hace falta `SEED_ON_START`.
3. **Nada que correr a mano.**

### Archivos principales

- **Backend:** `prisma/schema.prisma` + la migración · `contrato/esquemas/tela.ts` y `proveedor` ·
  `dominio/catalogos/telas.ts` · dominio de proveedores · OpenAPI regenerado.
- **Frontend:** `modulos/telas/{DialogoTela,EditorColoresTela,TelasPagina}.tsx` ·
  `modulos/proveedores/DialogoProveedor.tsx` (+ detalle) · cliente regenerado.

## 2026-08-06 — Entrada de tela por factura o remisión (etapa B1)

La otra mitad del inventario nuevo: ya se puede **meter tela al almacén** por las dos vías que pidió
Daniel — con orden de compra y sin ella.

### A) Entrada por factura o remisión (sin orden de compra)

`Inventarios → Telas → Entradas de tela`: se captura **una cabecera por documento** (factura o
remisión, número del proveedor, proveedor, fecha y almacén) y **N partidas** debajo. Cada renglón es
una partida: su tela y color, la cantidad de cuerpo y la de cardigan, el número de lote del
proveedor y el precio. Dos lotes del mismo color en la misma factura = dos renglones = dos partidas.

Se puede **adjuntar el PDF de la factura**. El documento nace como **borrador** (no toca el
inventario), y hasta que se **confirma** se crean las partidas y entra la tela. Cancelar una entrada
confirmada no borra nada: registra el movimiento contrario, con su motivo.

Si capturas un número de factura que ya existe de ese mismo proveedor, la pantalla **te avisa** —
pero te deja seguir, por si el proveedor de verdad repitió el número.

### B) La compra con orden de compra ya entra al inventario nuevo

Al recibir una OC de tela ahora se elige el **color** (el sistema no lo adivina: si falta, no deja
recibir) y la tela entra por color con su partida y su costo, igual que la entrada por factura.
Antes seguía cayendo en el inventario viejo por lote, que con el arranque desde cero habría quedado
muerto. Los avíos no cambian en nada.

### Nota de despliegue (para Gabriel)

1. **Una migración automática** (`20260806150000_b1_entrada_tela`): las tablas del documento, sus
   adjuntos y la columna del costo del cardigan en el kardex. Aditiva, sin borrados.
2. **Cero permisos nuevos** (reúsa `inventario-telas.ver`/`.mover`) → **no** hace falta
   `SEED_ON_START`.
3. **Nada que correr a mano.**

### Dos cosas que conviene saber

- **Cancelar una entrada vieja puede dejar el color en negativo** si esa tela ya se consumió. Es a
  propósito (anular es una corrección contable, no se editan movimientos), pero a partir de ahí ese
  color no deja dar salidas hasta que se ajuste por conteo. Si la tela ya se usó, lo correcto es
  ajustar, no cancelar.
- La entrada **por factura no mueve la Ruta Crítica** (el hito de compra de tela): esa entrada nace
  de una factura y no está ligada a una orden de producción. La tela que debe empujar la RC entra
  por la vía con orden de compra.

---

## 2026-08-07 — "Que solo salgan los proveedores de telas"

Daniel: *"Necesitamos definir en los atributos de proveedores los diferentes tipo (creo que ya
estaba contemplado)… y en los inventarios de telas, solo debe de mostrar los proveedores de telas
para poder dar de alta una nueva tela"*, y luego: *"En control estaba definido así… los proveedores
de tela son importantes para futuras consultas"*.

### Lo primero ya estaba: el proveedor trae DOS clasificaciones

En su ficha, cada proveedor tiene:

- **Tipo** (una sola opción): *Telas · Avíos · Servicios · Sin clasificar*. Es el heredero directo
  del campo `TipoProv` (H/T/S) de CONTROL viejo.
- **Roles / servicios** (casillas, varias a la vez): *Vende telas · Vende avíos · Maquila (costura) ·
  Corte · Estampado · Bordado · Lavado · Aplicación · Otros servicios*.

Las dos se pueden **consultar**: la lista de proveedores tiene un filtro por tipo y otro por rol, y
ambas se ven en la ficha del proveedor. La migración llenó las dos de forma pareja (los proveedores
que en el viejo eran "T" quedaron con tipo *Telas* **y** con el rol *Vende telas*), así que las
consultas históricas de "proveedores de tela" funcionan por cualquiera de los dos caminos.

**Lo que faltaba** no era el dato, sino usarlo: las pantallas de telas seguían listando a **todos**
los proveedores, maquileros incluidos.

### Ahora las pantallas de tela solo ofrecen proveedores de tela

Se acotan al rol **«Vende telas»**:

- **Alta y edición de una tela del catálogo** — el "proveedor dueño" de la tela. Es el *dar de alta
  una nueva tela* de la petición: la tela es DE quien la vende, nunca de un maquilero.
- **Entrada de tela por factura o remisión** — quien surte la partida.
- **Ajuste / inventario físico del flujo viejo por lote**, mientras siga vivo.

Se eligió el **rol** y no el *tipo* porque el rol admite varias casillas: un proveedor que vende
telas **y** avíos aparece en las dos pantallas, cosa que el tipo (de un solo valor) no permite. Es
además el mismo criterio que Producción ya usaba: *Corte* solo lista cortadores y *Envío a maquila*
solo maquileros.

### En las órdenes de compra la lista sigue a los renglones

Una OC se le hace a **un** proveedor, pero el proveedor se captura **antes** que los renglones y una
misma OC puede llevar telas y avíos. Por eso ahí el filtro es en vivo:

| Renglones de la OC | Proveedores que se listan |
|---|---|
| solo telas | los de rol *Vende telas* |
| solo avíos | los de rol *Vende avíos* |
| telas **y** avíos, o solo líneas libres | **todos** (no se acota) |

Una compra mixta es legítima y el filtro no debe estorbarla.

### El proveedor ya capturado nunca se pierde

Si un documento viejo (o uno migrado) tiene un proveedor que **no** trae el rol, ese proveedor
**sigue apareciendo** en el selector en vez de desaparecer y borrarse en silencio. El filtro es una
ayuda para capturar, no un candado hacia atrás.

### Dos cosas que conviene saber

- **Si un proveedor de telas "desapareció" de la lista**, es que le falta la casilla *Vende telas* en
  su ficha: se le marca en *Catálogos › Proveedores* y vuelve a salir.
- **Cuentas por pagar NO se acotó**: ahí se sigue viendo a todos los terceros, porque una CxP puede
  ser de cualquiera (un maquilero, la papelería), no solo de quien vende material.

### Nota de despliegue (para Gabriel)

1. **Sin migración** — no se agregó ni una columna: el dato ya existía.
2. **Cero permisos nuevos** → **no** hace falta `SEED_ON_START`.
3. **Nada que correr a mano.** Es un cambio de pantallas (el API ya sabía filtrar por rol desde F1).

---

## 2026-08-07 — El almacén del cortador: descargar y traspasar sin buscarlo

Dos peticiones de Daniel: *"ligar cada almacén de telas (opcional) a un cortador… y cuando
seleccionemos a un cortador, que por default abra la ventana de descarga de tela con el almacén
relacionado"*, y *"es muy importante hacer una pantalla de traspaso de telas entre almacenes:
recibo la tela en Naucalpan (el principal) y de ahí le mando la tela a un cortador; en ese momento
debo hacer el movimiento al almacén del cortador para poder descargarlo de ese almacén"*.

### La pantalla de traspaso ya existía (y ya estaba en el menú)

Está en **Inventarios › Telas › Traspaso de telas por color**. Hace exactamente el movimiento del
ejemplo: saca del almacén origen y mete al destino en una sola operación (si algo falla, no se hace
ninguna de las dos), y el servidor verifica que el origen tenga suficiente de la tela **y** de su
cardigan.

No se construyó otra —tener el mismo movimiento en dos pantallas es la mejor forma de que un día
las dos digan cosas distintas—, pero sí se arregló lo que la hacía incómoda para este flujo:

- Antes listaba **todos** los almacenes, incluidos los de producto terminado y los de avíos. Ahora
  solo los de **telas**.
- Cada almacén dice **de qué cortador es**: "Bodega Montaño · Taller Montaño".

### Ligar un almacén a su cortador

En **Administración › Almacenes**, al dar de alta o editar un almacén de tipo *Telas*, aparece el
campo **Cortador (opcional)**. Solo ofrece terceros marcados con el rol *Corte*. La lista de
almacenes muestra una columna nueva con el cortador de cada bodega.

Tres reglas, y las tres avisan qué hacer si algo no cuadra:

- Solo los almacenes de **Telas** pueden tener cortador. Si intentas cambiar a *PT* un almacén que
  ya lo tiene, primero hay que quitarle la liga.
- El tercero tiene que estar marcado con el rol **Corte**. Si no, el mensaje te dice que se lo
  marques en su ficha de proveedor.
- **Un cortador solo puede tener un almacén.** Si intentas ligarlo a un segundo, el sistema te dice
  a cuál está ligado hoy. Es a propósito: con dos bodegas por cortador, "el almacén de este
  cortador" no tendría respuesta y el default de abajo sería una adivinanza.

### Al capturar el corte, los dos atajos

En el avance de producción, en la etapa **Corte**, en cuanto eliges el cortador aparecen:

- **Descargar tela del inventario** → abre la salida de tela con la **orden y el almacén de ese
  cortador** ya puestos.
- **Mandar tela al cortador** (nuevo) → abre el traspaso con el **destino** ya puesto. El origen lo
  eliges tú: de qué bodega sale la tela es decisión de quien captura, no algo que deba adivinarse.

El mismo botón de descarga se agregó a **Producción › Captura de corte** (la pantalla del menú),
para que no dependa de por dónde entraste.

Una aclaración sobre el *"que abra automáticamente"*: lo que se hizo es que **el enlace que ya
existía se lleve el almacén**, no que la pantalla se abra sola al elegir cortador. Con la matriz del
corte a medio capturar, sacarte de la pantalla sin que lo pidas te haría perder lo tecleado — por eso
ese enlace ya te preguntaba antes de salir. El ahorro real (no buscar el almacén entre todos) queda
igual.

### Dos cosas que conviene saber

- **El almacén se propone, no se impone.** Solo se pone si el campo está vacío, y una sola vez: si
  lo cambias o lo borras a propósito, no te lo volvemos a poner. Y si el cortador todavía no tiene
  almacén ligado, simplemente no se propone nada (no es un error).
- **Si una bodega de tela dejó de aparecer** en la salida o el traspaso, es que está capturada con
  otro tipo (PT o Avíos): se le corrige el tipo en *Administración › Almacenes*.

### Nota de despliegue (para Gabriel)

1. **Una migración automática** (`20260807120000_almacen_cortador`): una columna opcional en
   almacenes, su índice único y la llave foránea. Aditiva, sin borrados.
2. **Cero permisos nuevos** → **no** hace falta `SEED_ON_START`.
3. **Nada que correr a mano.**
