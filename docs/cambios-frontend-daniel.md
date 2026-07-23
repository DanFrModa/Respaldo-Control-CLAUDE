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
