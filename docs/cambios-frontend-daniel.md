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
