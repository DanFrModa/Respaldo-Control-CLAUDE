# Impreso PDF de la orden de producción — Cómo quedó construido

> Referencia funcional: `Documentacion_MJD/03-Produccion.md` (R9, el impreso de piso). Construido en
> **F2-E4**, ampliado en **jul-2026** con las 4 mejoras que pidió Daniel (título, tela desde la OC,
> fotos del arte, vocabulario "Arte") y corregido en la **0.106**: el papel ya no tira imágenes en
> silencio ni miente en su conteo (ver *Imágenes*, más abajo). En la **0.140** se le puso freno a la
> MEMORIA con **cuatro piezas** (tope por imagen · presupuesto por PDF · corte del lote en varios
> archivos · piso de la hoja, la tabla de *La memoria de las imágenes*): eso es lo que impide que
> imprimir cien órdenes de un golpe tumbe el servidor, y **la que hace el trabajo de verdad es el
> corte**, porque es la que además evita que alguna hoja salga sin sus imágenes.
> Código: `backend/src/dominio/produccion/impresos/impreso-orden.ts` (+ su `.test.ts` y
> `impreso-orden-lote.test.ts`); lo que comparte con la **ficha de arte**, en
> `impresos/imagenes-impreso.ts`.

Es la **hoja de piso** que se le entrega al corte/maquilero para producir una orden: **UNA orden por
página**. La impresión por lote entrega **un PDF** cuando el lote cabe en un archivo y **un ZIP con
varios PDF** cuando no (0.140: se parte para que ninguna hoja salga sin sus imágenes; ver *La memoria
de las imágenes*, más abajo). Se genera en
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
| Fotos del modelo (hasta 3, la **principal** primero) | `leerFotosModelo` (R2, presignadas + descargadas). Las que ESTA OP ocultó no salen; la que no se pudo traer deja **hueco**, y si el tope dejó fuera alguna, la fila lo dice |
| Cliente / Etiqueta / Maquilero / Fechas / Estado / Modelo / Composición | `obtenerOrden` |
| **Pedido cliente** | 1ª referencia del cliente (D7) o, si no hay, el snapshot `Orden.ocCliente` |
| **Tela** | **La(s) tela(s) COMPRADAS** para la orden (ver regla abajo); si no hay compra, la tela capturada a mano en la orden |
| Observaciones / Observaciones de maquila | `obtenerOrden` |
| Matriz color × talla + totales | `armarTabla` sobre `orden.lineas` (D4); totales por fila, columna y general |
| Telas | BOM del modelo, solo las `paraProduccion` (con consumo por prenda) |
| **Arte** (antes "Bordados") | BOM del modelo: nombre + subtipo por renglón (`Bordado`/`Estampado`) |
| **Avíos** (antes "Habilitación") | Avíos del BOM `paraProduccion` (clave, descripción, consumo) |
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

### Imágenes (fotos, artes) — best-effort, pero **sin callarse nada** (0.106)

El orden de las operaciones es lo que hace honesto al papel, y es innegociable:

1. se arma la lista de lo que **ESTA orden pide imprimir** (keys del arte del modelo + URLs de las
   fotos del modelo y de los adjuntos) — todavía sin tocar R2;
2. se aplica el **TOPE** de cada bloque **sobre esa lista** (`recortarAlTope`, en
   `impresos/imagenes-impreso.ts`), y se guarda **cuántas quedaron fuera**;
3. sólo entonces se **presigna** (`ServicioArchivos.urlDescarga`) y se **bajan** los bytes a
   data-URL (`descargarImagenComoDataUrl`) de lo que de verdad se va a imprimir.

Cualquier fallo (presign, red, HTTP ≠ 2xx, cuerpo vacío **o pasada de peso**, 0.140) deja esa imagen
con `dataUrl: null` y el impreso sale igual —**jamás** se trunca el PDF por una foto—, pero **no
desaparece**: se pinta un **HUECO** del mismo tamaño y con su rótulo, diciendo **por qué** está vacío
(las cuatro frases viven juntas en `AVISO_HUECO`: «no se pudo traer» manda a buscar una imagen rota;
«no cupo en la impresión por lote» manda a imprimir esa orden sola, que es lo que sí sirve). El degradado es
**por imagen, no por lote**: el presign usa `Promise.allSettled` (`presignarKeys`), así que si R2
rechaza una key las demás siguen saliendo.

> **Por qué se cambió (0.106).** Antes se bajaba TODO y se recortaba al pintar, y eso rompía la hoja
> de piso por dos lados: (a) el conteo del título contaba sobre lo **descargado**, así que una orden
> con 6 imágenes de arte a la que se le caían 2 mostraba 4 y decía «Artes (imágenes)» a secas, como
> si estuvieran todas; y (b) la imagen caída **desaparecía** y su sitio lo ocupaba la siguiente
> —normalmente otra foto del mismo arte—, de modo que un arte entero podía quedar fuera del papel sin
> dejar rastro. Con un papel que dice tres artes para una prenda de cinco, **se produce mal**. La cura
> ya existía en la **ficha de arte** (0.094) y aquí se aplicó igual. De regalo, el trabajo quedó
> **acotado**: como mucho `MAX_FOTOS + MAX_ARTES` descargas por orden (antes, todas las fotos del
> modelo + todas las del arte + todos los adjuntos, y esos megas cruzaban además al worker del PDF).

### La memoria de las imágenes, y por qué el lote sale en varios archivos (0.140)

Este papel es el único que se imprime **por lote** (`POST /ordenes/impresos`, hasta 100 órdenes), y
hasta la 0.140 bajaba sus imágenes **sin tope de peso ninguno** mientras acumulaba las cien órdenes
en memoria para mandarlas enteras al worker del PDF. Eso es memoria del **servidor**: si revienta,
se cae la app para todos, no sólo para quien imprimió.

Hoy hay **cuatro** piezas, y cada una resuelve algo distinto:

| Pieza | Cuánto | Qué hace |
|---|---|---|
| **Tope por imagen** — `MAX_BYTES_IMAGEN_IMPRESO` | 12 MB | La imagen **no se descarga** (se ve en el `content-length`, antes de bufferear) y sale como **HUECO** con el aviso de siempre |
| **Presupuesto por PDF** — `PRESUPUESTO_IMAGENES_LOTE` | 128 MB | Cuántos bytes de imagen puede retener **un archivo** mientras se arma |
| **Corte del lote** — `impresoOrdenesPorPartes` | sale del presupuesto | Cuando el presupuesto se acaba, el lote **sigue en otro PDF**; se arma uno a la vez. **Es lo que hoy evita que una hoja salga sin imágenes** |
| **Piso de la hoja** — `PisoHoja` | 1 arte + 1 foto | Con el bolsón agotado sigue pasando una imagen de cada clase. **Cinturón**: con el corte no llega a usarse en producción (ver más abajo) |

* El tope **por imagen es el mismo número** que ya usaban la ficha de arte y el recibo: vive una
  sola vez, en `impresos/imagenes-impreso.ts`, junto a la descarga que lo aplica.
* **El lote se corta en varios archivos** (decisión de Daniel, 2ª ronda). Cuando no cabe, el usuario
  se baja un **ZIP con varios PDF** en vez de un PDF; cuando cabe —el caso de todos los días—, sigue
  bajando un PDF. Lo distingue por el `Content-Type`, del que el frontend saca **la extensión** del
  archivo (`ordenes-N.zip` / `ordenes-N.pdf`): ponerle `.pdf` a un ZIP da un archivo que no abre, así
  que esa línea tiene su prueba (`frontend/src/api/ordenes-consulta.lote.test.ts`) igual que la
  decisión del servidor (`backend/src/api/produccion/impresos.rutas.test.ts`).
* **Cuántos PDF hay vivos a la vez: DOS, contados** con `WeakRef` + `gc()` (`medicion/vivos-r4.mts`,
  10 partes de 32 MB). No es una propiedad que se pueda razonar: hasta la 4ª ronda la ruta guardaba
  sus dos primeras partes en un `const` **dentro del generador** —que el marco sujeta hasta el final
  del ZIP— y el mismo arnés medía **4**. Lo que importa es que ese 2 **no depende del número de
  órdenes** del lote.
  ⚠️ Y hacen falta **dos bancos distintos**, porque ninguno ve lo del otro: el del pico mide el
  DOMINIO (consume las partes él mismo) y por eso el defecto de la ruta le pasó por debajo sin mover
  una cifra; el de `WeakRef` mide la cadena de la RUTA y no dice nada del pico. Un número bueno en
  uno no cubre al otro.
* **El número de órdenes por archivo NO está escrito en el código**: el corte cae donde el
  presupuesto se acaba, así que depende de lo que pesen las fotos. Medido: con fotos de 2 MB salen
  **~7 órdenes por archivo** (100 órdenes → 15 archivos); con fotos al tope de 12 MB, **1 por
  archivo** (una hoja al peor caso retiene 112 MB y no caben dos en 128).

#### Por qué se cortó, en vez de repartir el presupuesto

La **1ª ronda de la 0.140** hizo lo otro: un solo PDF con un presupuesto compartido entre las cien
órdenes. Acotaba la memoria, pero **a costa del contenido**, y mucho más de lo que parecía: medido,
sólo las **~7 primeras órdenes** conservaban sus imágenes y a 100 órdenes salían **651 huecos en 93
hojas**. Eso no es acotar un pico: es repartir una pérdida. Cortar el lote cambia el precio por uno
que sí se puede pagar —**el usuario baja varios archivos**— y devuelve el contenido entero.

> ⚖️ **Y conviene decirlo sin adornos, porque es la lección de la fila:** el plan original proponía
> como alternativa un **tope de órdenes por PDF** (p. ej. 20). Se descartó con razón —un tope de
> órdenes no acota BYTES: 20 hojas al peor caso son del orden de 16 GB, medido— pero la alternativa
> que se eligió en su lugar **cambiaba un problema de memoria por uno de contenido**, y eso no se
> escribió. El corte por presupuesto es lo que devuelve esa cuenta a cero: acota los bytes *y* no
> pierde imágenes.

#### El PISO de cada hoja: «al menos una de arte y una del modelo» (Daniel)

Con el corte, que una hoja pierda imágenes pasa a ser el borde. Cuando aun así pasa, cada hoja tiene
un **piso**: un permiso de paso para **una imagen de arte y una foto del modelo**, que se bajan
aunque el bolsón esté agotado. Así ninguna hoja sale **ciega de un lado**.

> 🔴 **Qué es esto de verdad: un CINTURÓN, no la protección de todos los días.** Con el corte del
> lote, **en producción el piso no llega a usarse nunca** —y el hueco `'lote-lleno'` del papel,
> tampoco—: la orden que saldría coja se rehace estrenando presupuesto, y un presupuesto entero
> siempre cubre una hoja al peor caso. El piso sólo entraría en juego si alguien bajara el
> presupuesto por debajo del umbral o subiera los topes de imágenes por hoja. Se conserva porque ese
> día es justo cuando hace falta, pero **lo que hoy evita que una hoja salga sin imágenes es el
> corte**, no el piso.

> 🔴 **Qué lo hizo falta.** Sin piso, quién perdía sus imágenes lo decidía un **accidente de
> concurrencia**: los dos bloques de una hoja no preguntan a la vez —las fotos del modelo llegan ya
> presignadas y los artes tienen que pasar por `presignarKeys`—, así que las fotos preguntaban,
> bajaban y **cobraban** antes de que el arte llegara a preguntar. Medido en la 2ª hoja al peor
> caso: **3/3 fotos decorativas y 0/4 artes** — se perdía justo la imagen que el propio papel manda
> a conseguir antes de producir («Pídela antes de producir»). El piso se decide **antes** de bajar
> la primera imagen; uno que se decidiera después de esa carrera no serviría de nada.

* Si la orden **no tiene** arte (o no tiene fotos), su permiso simplemente no se usa.
* El piso se cobra **al precio real**, no apartando el peor caso: apartar 16 MB por adelantado se
  midió y dejaba a la hoja siguiente **peor que sin piso**.
* Cuesta, como mucho, dos imágenes de desborde por hoja (2 × 16 MB). Como sólo se arma una hoja a la
  vez, el techo sigue siendo «presupuesto + una hoja» y **no depende del número de órdenes**.

#### Lo MEDIDO — el pico del proceso

🔴 **Ésta es la única tabla de cifras de la fila.** Los comentarios del código citan de aquí y no
repiten números sueltos: un dato que vive en cuatro sitios acaba diciendo cuatro cosas distintas.

**Cómo se midió.** Banco fuera del repo (no forma parte del entregable): el lote se resuelve entero,
las partes se consumen **de una en una y se sueltan** (que es lo que hace la ruta al escribirlas en
el ZIP), con **una hoja al máximo** (3 fotos del modelo + 4 artes = 7 imágenes) y **cada imagen
distinta de las demás** —react-pdf cachea por `src`, así que repetir la misma imagen haría que el
documento la contara una sola vez y la medición mentiría a lo grande—. La cifra es
`process.resourceUsage().maxRSS` del proceso, que incluye el worker del PDF porque comparte proceso.
El «antes» se reproduce con el mismo código dándole un presupuesto que nunca muerde, que es
exactamente la conducta anterior a la 0.140.

🔴 **TODAS las cifras de abajo se remidieron en la 4ª ronda, y la tanda anterior había que tirarla.**
El guion restaba del pico una «base» de lo que ya estuviera corriendo en la máquina, y cuando se
midió había OTRO agente trabajando en el mismo equipo: esa resta se llevaba unos 100–200 MB que sí
eran del impreso, y las cifras publicadas salían **bajas**. Se repitió todo con la máquina en
silencio (`base-otros = 0`), tres corridas por celda, y ahora sí cuadran con las que sacó el revisor
por su cuenta (él midió 2 240 y 2 526 donde la tabla vieja decía 2 160 y 2 368).

**Fotos de 2 MB** (siete por hoja ⇒ ~18.7 MB de data-URL por orden). Mediana de 3 corridas:

| Órdenes | Antes | Ahora | Archivos que salen |
|---:|---:|---:|---:|
| 1 | 994 MB | 1 015 MB | 1 |
| 5 | 1 342 MB | 1 416 MB | 1 |
| 20 | **3 269 MB** | **2 291 MB** | 3 |
| 50 | *(no se midió: ~6.7 GB)* | 2 534 MB | 8 |
| 100 | *(no se midió: ~12.5 GB)* | **2 497 MB** | 15 |

⚠️ **La dispersión entre corridas es grande y hay que tenerla delante.** N=20 dio 2 230 / 2 291 /
2 477 MB y N=100 dio 2 453 / 2 497 / 3 005 MB. O sea **±10 %, que es MÁS que la diferencia entre
N=20 y N=100** (~200 MB): estas cifras se leen como «del orden de», nunca al megabyte, y ninguna
afirmación de la fila puede colgar de una sola corrida.

**Fotos al tope de 12 MB** (el peor caso que el sistema admite; 112 MB de data-URL por hoja).
Mediana de 3 corridas:

| Órdenes | Antes | Ahora | Archivos que salen |
|---:|---:|---:|---:|
| 1 | 1 505 MB | 1 449 MB | 1 |
| 3 | **2 873 MB** | — | — |
| 5 | *(no se midió: ~4.1 GB)* | 2 718 MB | 5 |
| 20 | *(no se midió: ~14.2 GB)* | **3 082 MB** | 20 |
| 100 | *(no se midió: ~67.6 GB)* | **3 293 MB** | 100 |

**Lo que dicen las tablas, que es una sola cosa:** lo que importa no es el número absoluto sino
**cuánto sube el pico cuando el lote crece**. Y se dice mejor como TOTAL que como pendiente, porque
el total aguanta el ruido y la pendiente no:

| Fotos | De 20 a 100 órdenes, ANTES | De 20 a 100 órdenes, AHORA |
|---|---:|---:|
| 2 MB | habría subido ≈ **9 600 MB** (a 120 MB/orden) | sube **~200 MB en total** (2 291 → 2 497) |
| 12 MB (el tope) | habría subido ≈ **55 000 MB** (a 685 MB/orden) | sube **~210 MB en total** (3 082 → 3 293) |

Dicho como pendiente son **≈2.6 MB/orden** en los dos casos (medianas), pero esa cifra es
**engañosamente precisa**: emparejando corridas sueltas en vez de medianas, el mismo dato de 2 MB va
de **−0.3 a +9.7 MB/orden** (la peor pareja, 2 230 → 3 005; la mejor, 2 477 → 2 453), porque la
diferencia real (200 MB) cabe dentro del ruido (±250 MB). Lo que NO cabe dentro del ruido, y es lo
único que la fila necesita afirmar, es la comparación con el antes: **200 MB frente a 9 600**.

> 🔴 **Tres rondas y tres formas de equivocarse con este número, todas por lo mismo: publicarlo con
> más precisión de la que tiene.** La 1ª ronda dijo «≈0 (2 329 → 2 328 MB)» —una corrida afortunada
> tomada por la pendiente—; la 2ª publicó «≈2.6», la mediana de tres corridas mías, y el revisor
> midió 3.6 por su cuenta; la 3ª publicó una banda «2 a 4» que seguía sin cubrir lo que se puede
> medir cambiando qué corridas se comparan. **La 4ª deja de publicar una pendiente como si fuera un
> dato del sistema**: dice el TOTAL entre dos tamaños de lote —200 MB de 20 a 100 órdenes— y dice
> abiertamente que la dispersión entre corridas (±250 MB) es mayor que ese total. La afirmación que
> aguanta es la comparación, no la cifra: **antes eso mismo habría costado 9 600 MB.**

⚠️ **Y ojo con el tramo, porque no hay UNA pendiente.** De 1 a 20 órdenes el pico todavía está
subiendo hasta su meseta —con fotos de 2 MB, unos **+67 MB por orden** en ese tramo (1 015 → 2 291)—
y es **de 20 en adelante** donde se ve si crece o no, que es lo que la fila promete. Del residuo que
queda, el revisor midió aparte que **no son las imágenes** —ésas ya están acotadas— sino la hoja en
sí y su página dentro del documento: con imágenes tan chicas que el presupuesto nunca muerde le
salió ≈4.6 MB/orden (810 → 941 → 1 268 MB en su máquina). Con el tope de 100 órdenes eso suma menos
de medio giga, contra los ~12 GB que costaba antes.

#### El techo real, sin promesas redondas

🔴 **No hay un «pase lo que pase, por debajo de X».** La 1ª ronda escribió «se aplana por debajo de
2 GB pase lo que pase» y era **falso**: medido, 100 órdenes con fotos al tope dan **3 293 MB**. Lo
que sí se puede afirmar es lo medido:

* con fotos normales el pico se estabiliza en **~2.5 GB** (las nueve corridas de N=20/50/100 caen
  entre 2 230 y 3 005) desde unas 20 órdenes;
* con fotos al tope de 12 MB, en **~3.1–3.4 GB**;
* y **deja de crecer con el número de órdenes**, que es la propiedad que la fila persigue.

⚠️ **Y ese techo no está atado a nada todavía:** `backend/railway.json` no fija memoria y ningún
documento del repo dice cuánta RAM tiene el contenedor de `prueba`. Mientras eso no se sepa, «3.4 GB
de pico» es un dato, no una garantía de que quepa. Anotarlo es parte del entregable.

⚠️ **Límite del ZIP, dicho:** el empaquetador no implementa ZIP64, así que el total no puede pasar
de 4 GiB (ni de 65 535 archivos). Con fotos normales, 100 órdenes son ~1.4 GB y no se acerca; en el
peor caso absoluto (100
órdenes con siete fotos de 12 MB) el total sería ~8.4 GB y **la descarga falla con un error claro**
que dice partir el lote en menos órdenes — nunca un archivo corrupto.

⚠️ **Y las cifras no son un espejismo del recolector de basura.** Se repitió la medición **con el
código de hoy** estrechando el montón de V8 a 512 MB y a 1 GB: N=20 con fotos de 2 MB dio **2 250 /
2 314 MB** (montón de 512 MB) y **2 354 / 2 352 MB** (montón de 1 GB), o sea **lo mismo** que con
8 GB de montón (2 230 / 2 291 / 2 477). Apretar el montón **no bajó** el pico. La memoria de este
trabajo vive casi toda **fuera** del montón —`Buffer`s, el WASM de la maquetación y el hilo del PDF,
que tiene el suyo—, así que apretar el montón no la baja: por eso el tope tiene que estar en
**cuántos bytes se piden**.

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
| HUECO de una imagen que no llegó (0.106): mismo tamaño y marco que la imagen que sustituye | **0 pt** |
| Aviso de recorte de las FOTOS, dentro de la fila y pegado abajo (0.106) | **0 pt** |

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
muestran 4 de 9` y la lista de texto "Arte" sigue enumerando todos los bordados/estampados. Desde la
**0.106** ese total es **lo que la orden PIDE** (`DatosImpresoOrden.artesOcultas`, contado antes de
bajar nada), no lo que R2 alcanzó a dar. El bloque de **fotos del modelo** no tiene título donde
avisarlo, así que su conteo va **dentro de la fila** (`Fotos del modelo: se muestran 3 de 8`), pegado
abajo: como la fila ya mide 120 pt por la tarjeta, cuesta **0 pt** de altura.

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

**Cuándo NO queda ninguna imagen blindada** (aceptado, y el impreso sale igual):

1. **El arte principal del BOM no tiene foto** (ningún archivo ligado): no hay imagen que marcar y el
   **segundo arte NO hereda** el papel de principal — la rejilla queda sin blindaje y se llena con
   las primeras imágenes disponibles. Es a propósito: "principal" es una decisión del usuario sobre
   un arte concreto, no un puesto que se transfiera solo. El arte principal sin foto sigue
   apareciendo, como todos, en la lista de texto "Arte".
2. Lo mismo si **esta OP ocultó la foto principal del modelo** (§Post-F9.169(b)): la siguiente no
   hereda la estrella y el papel sale sin principal.

⚠️ **Lo que ya NO desmarca la principal (0.106):** que sus bytes no lleguen. Antes el best-effort la
descartaba y nadie heredaba la marca; hoy sigue marcada, en su sitio, **como hueco** — que es
justamente cuando más importa avisar.

### Pendiente de decidir con Daniel — el tope recorta también los adjuntos

`MAX_ARTES = 4` se aplica al arreglo **completo** de artes, y el arte del BOM va **primero**; los
adjuntos de la orden van al final. Consecuencia: un **adjunto recortado no aparece en ningún lado**
salvo en el conteo del título — a diferencia de los bordados del BOM, que siempre quedan enumerados
en la sección de texto "Arte". Con 5 o más bordados con foto, **los adjuntos de la orden no se ven
nunca** en el impreso. Detectado en la revisión de jul-2026; **sin decisión de Daniel todavía**.
Alternativas cuando se decida: reservar cupo para al menos un adjunto, priorizar los adjuntos sobre
el arte del BOM, o listar por nombre los adjuntos recortados.

Lo que sí cambió con la **0.106**: el adjunto recortado **entra en el total del título** —el conteo
se hace sobre lo que la orden pide, adjuntos incluidos—, así que el papel al menos dice que hay más
imágenes de las que enseña. Sigue sin decir CUÁLES: eso es lo que espera la decisión de Daniel.

## Caché del navegador (26-jul-2026)

Los impresos se abren con `window.open('/api/…/impreso')`. Sin cabecera de caché el navegador
guardaba el PDF por heurística y, tras un despliegue, seguía sirviendo **el viejo** (pasó de verdad:
media hora de confusión; solo en incógnito salía el nuevo). Ahora un hook `onSend` de la raíz de la
app (`src/api/cache-documentos.ts`) marca `Cache-Control: no-store` en **toda** respuesta cuyo
`Content-Type` sea de documento generado (PDF o XLSX) — punto **común**, así que también cubre los
impresos que se agreguen después. Respeta el `Cache-Control` que una ruta ya haya fijado, por lo que
`GET /api/empresas/logo` conserva su caché larga con ETag (es un asset, no un documento).

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
