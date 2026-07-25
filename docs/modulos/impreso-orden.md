# Impreso PDF de la orden de producción — Cómo quedó construido

> Referencia funcional: `Documentacion_MJD/03-Produccion.md` (R9, el impreso de piso). Construido en
> **F2-E4** y ampliado en **jul-2026** con las 4 mejoras que pidió Daniel (título, tela desde la OC,
> fotos del arte, vocabulario "Arte").
> Código: `backend/src/dominio/produccion/impresos/impreso-orden.ts` (+ su `.test.ts`).

Es la **hoja de piso** que se le entrega al corte/maquilero para producir una orden: **UNA orden por
página** (la impresión por lote genera un solo PDF consolidado con salto entre órdenes). Se genera en
el **servidor** con `@react-pdf/renderer` (dentro del worker de PDF, `comun/pdf-worker.ts`) y su
identidad visual sale de `comun/impresos-estilos.ts` (paleta verde del rediseño).

Decisiones del dueño que siguen vigentes: **sin precios ni costos** (es una orden para PRODUCIR, no
un costeo) y **sin código de barra/UPC** (retirado en F2-E5).

## Qué muestra, y de dónde sale cada dato

| Bloque del PDF | Origen |
|---|---|
| Membrete + subtítulo | Empresa activa de la sesión (A9) |
| **Título "ORDEN DE PRODUCCIÓN"** | Fijo, 16 pt bold, bajo el membrete (mejora jul-2026) |
| "Orden NNNN" (arriba a la derecha) | `Orden.folio` |
| Banda roja "ORDEN CANCELADA" + motivo | Solo si `estado = cancelada` |
| Fotos del modelo (hasta 3, la **principal** primero) | `leerFotosModelo` (R2, presignadas + descargadas) |
| Cliente / Etiqueta / Maquilero / Fechas / Estado / Modelo / Composición | `obtenerOrden` |
| **Pedido cliente** | 1ª referencia del cliente (D7) o, si no hay, el snapshot `Orden.ocCliente` |
| **Tela** | **La(s) tela(s) COMPRADAS** para la orden (ver regla abajo); si no hay compra, la tela capturada a mano en la orden |
| Observaciones / Observaciones de maquila | `obtenerOrden` |
| Matriz color × talla + totales | `armarTabla` sobre `orden.lineas` (D4); totales por fila, columna y general |
| Telas | BOM del modelo, solo las `paraProduccion` (con consumo por prenda) |
| **Arte** (antes "Bordados") | BOM del modelo: nombre + subtipo por renglón (`Bordado`/`Estampado`) |
| Habilitación | Avíos del BOM `paraProduccion` (clave, descripción, consumo) |
| **Artes (imágenes)** | Fotos de los bordados/estampados del BOM (con su nombre debajo) **+** los adjuntos de la orden (F8-E6) con `tipoMime` `image/*`. Máximo 4 (ver presupuesto de altura) |
| Pie | Contexto + "Página N de M" + fecha de generación |

### Regla de la TELA (mejora jul-2026)

El campo ya no depende de lo que alguien haya capturado a mano en el encabezado de la orden:

1. Se leen las **líneas de OC de tela ligadas a la orden** (`OrdenCompraLinea.idOrden`, R7) con el
   MISMO criterio que el `ocTelaFolio` del centro de comando: `idTela` no nulo y OC en un estatus
   distinto de `borrador`/`cancelada`.
2. Se **deduplica por `idTela`** (no por nombre: dos telas distintas del catálogo pueden llamarse
   igual y no deben fundirse), conservando el orden de aparición (OC más vieja primero), y se junta
   con su folio de OC: `Chifón (OC 334)`; si la misma tela se compró en varias OC se listan sus
   folios (`Chifón (OC 334, 340)`), y varias telas se separan con `·`.
3. **Fallback:** sin ninguna OC de tela → la tela capturada a mano en la orden (`Orden.idTela`).
4. **Best-effort:** si la lectura truena, se loguea y se degrada al valor manual. El PDF nunca se
   trunca por esto.

### Imágenes (fotos, artes) — siempre best-effort

Todas las imágenes se **presignan** contra R2 (`ServicioArchivos.urlDescarga`) y se **bajan** a
data-URL (`descargarImagenComoDataUrl`) para incrustarlas. Cualquier fallo (presign, red, HTTP ≠ 2xx,
cuerpo vacío) descarta ESA imagen y el impreso sale igual — **jamás** se trunca el PDF por una foto.
El degradado es **por imagen, no por lote**: el presign del arte del BOM usa `Promise.allSettled`, así
que si R2 rechaza una key las demás imágenes siguen saliendo.

La foto del arte llega desde el BOM: `leerBordadosBom` (`dominio/modelos/bom-modelo.ts`) trae, además
de nombre/tipo/precio, la **`keyFoto`** del `Archivo` ligado a `Bordado.archivoFoto`. Es un campo
aditivo e interno del servidor: las rutas del BOM proyectan campo por campo, así que **no cambia el
contrato JSON** de `/api/modelos/:id`.

## Presupuesto de altura (la hoja única)

El impreso es de **una página por orden**, así que cada cosa que se agrega tiene que pagarse con
espacio. Hoja A4 = 841.9 pt; menos `paddingTop` 34 y `paddingBottom` 52 → **≈ 756 pt útiles**
(ancho útil = 595 − 80 ≈ 515 pt).

| Concepto | Alto |
|---|---|
| Título "ORDEN DE PRODUCCIÓN" (16 pt × 1.2 de `lineHeight` + 6 de `marginBottom`) | **+25 pt** |
| Bloque de fotos compactado (alto 130 → 120, `marginBottom` 12 → 8) — solo si hay fotos | **−14 pt** |
| Tarjeta de arte 80 × 88 + rótulo (antes 110 × 120) → por fila de artes | **−42 pt** |
| Rejilla de artes capada a `MAX_ARTES = 4` (una fila; sin tope eran 2-3 filas) | **−98 pt por fila evitada** |
| Aviso de truncado en el TÍTULO de la sección (no en una leyenda aparte) | **0 pt** |

Neto del título: **+11 pt** en órdenes con fotos y **+25 pt** en las que no las tienen; las palancas
de artes devuelven mucho más de lo que el título cuesta, **pero solo cuando hay artes**.

**Qué se midió** (contando páginas del PDF renderizado, regex `/Type /Page`, contra un worktree de la
versión anterior):

- **Órdenes CON arte:** la nueva versión pagina **igual o mejor** — 13 escenarios que se iban a 2
  hojas ahora caben en 1, y **ninguno** empeora.
- **Órdenes SIN arte:** el título cuesta **~1 renglón de capacidad** (medido en renglones de lista
  que caben en la hoja): 3 colores con fotos pasa de 6 → 5, 3 colores sin fotos de 10 → 9, 5 colores
  con fotos de 5 → 4, 5 colores sin fotos de 9 → 8. Ahí **no hay compensación posible** (el bloque de
  fotos aporta −14 pt solo si hay fotos, y las palancas de artes no aplican): es el precio del título
  que pidió Daniel, asumido a conciencia.

Las órdenes de 6+ colores con imágenes de arte siguen ocupando 2 hojas — ya lo hacían antes; es
volumen de contenido, no el título. La prueba *"una orden densa con fotos y 4 artes cabe en UNA sola
página"* (`impreso-orden.test.ts`) vigila ese presupuesto en CI.

Cuando se recortan imágenes, el conteo **no se esconde**: el título dice `Artes (imágenes) — se
muestran 4 de 9` y la lista de texto "Arte" sigue enumerando todos los bordados/estampados.

### La imagen PRINCIPAL nunca se recorta (jul-2026, petición de Daniel)

El modelo tiene una **foto principal** (la primera de su galería) y un **arte principal** (el primero
de su BOM) — ver `docs/modulos/modelos.md`. En el impreso las dos van marcadas (`FotoImpreso.principal`)
y los recortes las **anteponen antes de cortar**:

| Función pura | Tope | Garantía |
|---|---|---|
| `recortarFotos` | `MAX_FOTOS = 3` | la foto principal va en la posición 0 y siempre se imprime |
| `recortarArtes` | `MAX_ARTES = 4` | el arte principal va en la posición 0 y siempre se imprime |

Ambas usan el mismo helper `anteponerPrincipal` (estable: el resto conserva su orden relativo). El
**presupuesto de altura no cambia**: anteponer no agrega elementos, solo los reordena — la orden
densa (4 colores × 5 tallas, dos observaciones, 3 fotos) con **9 artes y el principal hasta el final**
sigue cabiendo en **una** página, medido con `paginasPdf` en `impreso-orden.test.ts`.

**Quién ordena de verdad:** el orden lo fija la BASE DE DATOS — `leerFotosModelo` y `leerBordadosBom`
devuelven la principal en la posición 0, y `armarDatosImpresoOrden` solo la MARCA. Con el pipeline
real, entonces, `anteponerPrincipal` no mueve nada: es **cinturón de seguridad** (defensa en
profundidad) por si algún día se reordena la entrada — p. ej. si los adjuntos de la orden pasaran a ir
antes del arte del BOM, o si alguien construye los datos a mano. No es la fuente del orden.

**Dos casos en los que NO queda ninguna imagen blindada** (ambos aceptados, y el impreso sale igual):

1. **La principal no se pudo bajar de R2** (presign o descarga fallidos): el best-effort la descarta,
   nadie hereda la marca y el bloque se comporta como antes del cambio.
2. **El arte principal del BOM no tiene foto** (`Bordado.archivoFoto` vacío): no hay imagen que
   marcar y el **segundo arte NO hereda** el papel de principal — la rejilla queda sin blindaje y se
   llena con las primeras imágenes disponibles. Es a propósito: "principal" es una decisión del
   usuario sobre un arte concreto, no un puesto que se transfiera solo. El arte principal sin foto
   sigue apareciendo, como todos, en la lista de texto "Arte".

### Pendiente de decidir con Daniel — el tope recorta también los adjuntos

`MAX_ARTES = 4` se aplica al arreglo **completo** de artes, y el arte del BOM va **primero**; los
adjuntos de la orden van al final. Consecuencia: un **adjunto recortado no aparece en ningún lado**
salvo en el conteo del título — a diferencia de los bordados del BOM, que siempre quedan enumerados
en la sección de texto "Arte". Con 5 o más bordados con foto, **los adjuntos de la orden no se ven
nunca** en el impreso. Detectado en la revisión de jul-2026; **sin decisión de Daniel todavía**.
Alternativas cuando se decida: reservar cupo para al menos un adjunto, priorizar los adjuntos sobre
el arte del BOM, o listar por nombre los adjuntos recortados.

## Permisos (A4)

Solo **`ordenes.ver`**. Las fotos del modelo se leen a bajo nivel (`leerFotosModelo`, sin exigir
`modelos.ver`) para que un rol de piso no reciba 403; los adjuntos se leen por `listarAdjuntos`, que
exige exactamente el mismo `ordenes.ver`.

## Seams de DI (para test sin BD ni R2)

`armarDatosImpresoOrden(sesion, id, bd, deps)` recibe un `DepsImpreso` cuyos defaults son las
funciones reales de dominio:

| Seam | Default | Para qué |
|---|---|---|
| `obtenerOrden` | `dominio/produccion/ordenes.ts` | encabezado + matriz + total (A9) |
| `leerBom` | `dominio/modelos/bom-modelo.ts` | telas/avíos/arte del modelo (+ `keyFoto`) |
| `leerFotosModelo` | `dominio/modelos/fotos-modelo.ts` | fotos del modelo |
| `listarAdjuntos` | `dominio/produccion/adjuntos-orden.ts` | imágenes subidas a la orden |
| `leerTelasCompradas` | `leerTelasCompradasOrden` (mismo archivo) | telas de las OC ligadas |
| `archivos` | `servicioArchivos()` | presign de R2 |
| `descargarImagen` | `descargarImagenComoDataUrl` | bytes de la imagen |

Las funciones de armado y render son **puras**: `armarTabla` (matriz → tabla con totales),
`textoTelaComprada` (telas compradas → texto del campo) y `generarPdfOrden`/`generarPdfOrdenes`
(datos ya resueltos → Buffer). Las pruebas viven en `impreso-orden.test.ts` y **no tocan BD ni R2**.
