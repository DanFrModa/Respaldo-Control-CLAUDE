# CONTROL v2 — Historial de versiones

> **Para qué es este archivo.** Saber **qué cambió y cuándo**, en lenguaje del negocio.
> Una entrada por **despliegue** —que es lo que se experimenta— y no por cada cambio de código.
>
> Lo demás vive en otro lado y con otro propósito: **`Documentacion_MJD/DECISIONES.md`** guarda _por qué_
> se decidió cada cosa, **`HOJA-DE-RUTA.md`** dice _qué sigue_ y _qué quedó pendiente_, y las fichas de
> `docs/hoja-de-ruta/` tienen el detalle técnico de cada etapa.
>
> **Cada entrada trae tres cosas:** qué se puede hacer ahora que antes no · qué cambió y **puede
> sorprender** · qué sigue **pendiente o roto**. Lo más reciente arriba.

## Cómo se numeran

**`0.xxx`** mientras **nada esté en producción** (decisión de Daniel: _"empezamos mejor en 0.001, porque
es antes de producción"_). El **cero se ve a simple vista** y dice lo que hay que saber: esto todavía no
opera el negocio. `0.001`, `0.002`, `0.003`…

⚠️ **Se sube la versión CADA VEZ que se actualiza `prueba`** (regla de Daniel, 19-ago-2026), no cuando se
junta un lote. Cada merge a `prueba` = una entrada nueva aquí, aunque traiga una sola cosa. Así siempre se
puede decir qué versión se está mirando.

**El número es UNO SOLO y VIAJA.** Se asigna al entrar a **`prueba`** y **esa misma versión** es la que
después sube a producción — **no se re-numera**. Así se puede decir _"producción corre la 0.014, que es
exactamente la que probé el 18 de agosto"_, en vez de tener dos numeraciones paralelas que en tres meses
nadie sabe emparejar.

**El día del arranque:** la versión que salga a producción se **rebautiza `1.000`**, dejando escrito de
cuál `0.xxx` viene (_"1.000 — antes 0.014"_). De ahí en adelante, `1.001`, `1.002`… con la misma regla.

Cada entrada dice **dónde está**: `en prueba` mientras se verifica, `en producción` cuando sube.

---

## 0.018 · 23-ago-2026 · **en prueba** — La revisión previa de la orden de compra ya se puede corregir

### Qué se puede hacer ahora que antes no

- ⭐⭐ **En la pantalla previa —la última antes de generar la orden de compra— ya se pueden cambiar la
  CANTIDAD y el PRECIO de cada renglón.** Era lo que Daniel reportó el 23 de agosto: *"ya hay una
  pantalla previa, pero no me deja poner el precio correcto ni la cantidad… no me deja modificar
  nada"*. Ahora cada renglón trae sus dos campos, **«Comprar»** y **«Precio»**, ahí mismo.
- ⭐ **El precio se puede capturar aunque el sistema no tenga ninguno.** Antes, el único lugar donde se
  tecleaba un precio era el formulario de «asignar proveedor», y ese formulario **sólo aparece en
  ciertos renglones**. Ahora se puede poner en cualquiera, en la pantalla donde se ve el total.
- ⭐ **Al cambiar un número, el total se vuelve a calcular solo** — y lo calcula el sistema, no la
  pantalla (ver abajo).
- ⭐⭐ **Y en TODO el sistema, no sólo aquí: los avisos de error ya dicen QUÉ estuvo mal.** Hasta ahora,
  cuando el sistema rechazaba algo que se capturó, el aviso decía *"Los datos enviados no son
  válidos"* (o *"Los datos capturados no son válidos"*) y nada más — aunque por dentro **sí sabía** el
  motivo exacto (*"El precio no puede ser negativo"*, *"La cantidad a comprar debe ser mayor que
  cero"*, *"Si el avío es favorito, captura la cantidad preestablecida"*). Esa explicación se perdía
  por el camino y **nunca llegaba a la pantalla, en ninguna pantalla del sistema**. Ahora se ve,
  pegada al aviso — **en los dos caminos por los que el sistema rechaza algo**, que era la mitad que
  faltaba. Si varios renglones tienen el mismo problema se dice una sola vez, y si son muchos se
  dicen los primeros y se cuenta el resto.

### Qué cambió y puede sorprender

- **El total se actualiza al SALIR del campo, no mientras escribes.** Es a propósito: si se actualizara
  tecla por tecla, al escribir «1500» el sistema iría calculando compras de 1, de 15 y de 150 — totales
  de compras que nadie quiso hacer. Se teclea el número, se sale del campo (o se aprieta Enter) y ahí
  se recalcula. También funciona con el tabulador.
- **El número que queda en el campo es el del SISTEMA, no el que tecleaste.** Si el sistema lo redondea
  —la orden de compra guarda dos decimales— el campo enseña el número redondeado. Es la regla de
  siempre de esta pantalla: **lo que se ve es lo que se va a guardar**. ⚠️ *Esta promesa no era cierta hasta la
  tercera vuelta de revisión:* si el redondeo caía **en el mismo número que ya estaba en pantalla**,
  el campo se quedaba con lo que tecleaste (veías «$2.00» en el total y `2.004` en el campo). Ya
  quedó, y con una prueba que mira el campo **después** de que contesta el servidor.
- **Mientras estás escribiendo dentro de un campo, el sistema no te lo cambia.** Se acomoda al salir.
  Sin esto, pasar de «Comprar» a «Precio» con el tabulador te borraba el precio a medio teclear.
- **Una cantidad demasiado grande ahora te lo dice con palabras** (*«La cantidad no cabe en la orden de
  compra»*) en vez de tronar con un error genérico. Antes ese número llegaba hasta la base de datos.
- **Mientras recalcula, el botón de «Confirmar y generar» se apaga** y dice *«Recalculando…»*. Confirmar
  contra un total que ya cambió sería emitir un documento que nadie revisó.
- **Dejar el campo EN BLANCO no es poner cero**: en blanco significa *"no lo toqué"* y el renglón vuelve
  a lo que el sistema propuso. Sirve para deshacer un cambio sin tener que salir de la pantalla.
- **Un precio de 0 SÍ se acepta, y significa "esta línea va sin precio"** (se captura después en la
  orden de compra). No es nuevo: es lo que ya pasaba cuando el sistema no encontraba ningún precio.
- **Lo que NO se acepta:** un precio **negativo**, una cantidad en **cero**, y un número tan chico que
  la orden de compra lo guardaría como 0.00 (por ejemplo 0.004). Los tres los rechaza **el servidor**,
  no la pantalla — **el número que escribiste se queda en el campo** y arriba sale, en rojo, la razón
  con sus palabras (*"El precio no puede ser negativo"*), avisando además de que **los totales de
  abajo son los de ANTES de tu cambio**. Mientras eso esté sin corregir, **«Confirmar y generar» está
  apagado**: no se puede emitir una orden de compra con un número que el sistema no aceptó.
- **Bajar la cantidad se puede, y avisa.** El renglón queda marcado con *«Total ajustado (propuesto
  X)»*, y quien autoriza la orden de compra sigue viendo contra qué se cambió. Si al bajarla alguna
  orden de producción se queda sin nada, su renglón lo dice con letras: *"no alcanza el mínimo: esta
  orden no lleva línea"* — antes esa línea se prometía en pantalla y luego no se escribía.
- **El precio ajustado también avisa**: *«Precio ajustado (propuesto $X)»*.
- 🔴 **Corregir el precio aquí NO cambia el catálogo.** Es la misma regla de siempre: la vía rápida no
  es una puerta trasera para editar el catálogo. **Y aun así no se pierde:** en cuanto la orden de
  compra se AUTORIZA, ese precio pasa a ser *"el último precio de compra"* de ese material a ese
  proveedor, que es de donde el sistema saca los costos. O sea que corregirlo aquí **sí se recuerda para
  la próxima**, por el camino bueno.

### Qué sigue pendiente o roto

- ✅ **Las fotos YA SUBEN.** El bloqueo que arrastraba desde el 15 de agosto quedó resuelto — era
  configuración de Cloudflare, no del programa. Daniel lo confirmó el 23 de agosto.
- ⚠️ **Los avisos de error que ahora sí se ven pueden salir en INGLÉS.** Sólo en un caso: cuando lo
  que se captura llega mal armado de una forma que la pantalla no debería producir (ahí el mensaje lo
  escribe la librería, no el sistema). No es un paso atrás —antes se veía un aviso igual de inútil,
  sólo que en español— y está anotado para arreglarse aparte, porque toca los textos de toda la
  aplicación de un golpe.
- ⚠️ **Falta comprobar el tope de subida del servicio donde vive el sistema (Railway)** — sigue igual
  que en la 0.015.

---

## 0.017 · 22-ago-2026 · **en prueba** — Lo que ya se compró no se puede quitar de la receta (y el botón para desautorizar)

### Qué se puede hacer ahora que antes no

- ⭐ **DESAUTORIZAR una orden de compra.** Hasta hoy, firmar una OC era **para siempre**: si te
  equivocabas de tela, de cantidad o de proveedor, el único camino era **cancelarla** y capturarla otra
  vez desde cero. Ahora hay un botón **«Des-autorizar»** que le quita la firma, la regresa a
  **borrador** —tal como estaba antes de firmarla—, la deja **corregir** y volver a autorizar. Pide
  **motivo** y queda anotado quién la había firmado y cuándo.
- ⭐ **El botón es SOLO del perfil de dirección.** Es una llave propia y distinta de la de autorizar:
  quien firma no necesariamente desfirma. A los demás perfiles el botón **ni les aparece** (y si
  alguien lo intentara por otro lado, el servidor lo rechaza igual).

### Qué cambió y puede sorprender

- ⭐ **Ya NO se puede quitar de la receta de una OP un material que ya se compró.** Antes se podía, y
  dejaba al sistema diciendo dos cosas contrarias a la vez: la orden de compra decía *"compramos esta
  jareta para la orden 1516"* y la receta de la 1516 decía *"esta jareta no va"* — con lo que el
  *"qué tengo / qué falta"* dejaba de cuadrar con lo comprado. Peor todavía si el renglón se había
  agregado a mano: al quitarlo **se borraba**.
- **El bloqueo es por MATERIAL, no por orden entera.** Comprar la jareta no congela el botón, ni la
  tela, ni la receta de otra orden de producción: se bloquea exactamente el material comprado.
- **Y solo cuando ya hay compromiso con el proveedor.** Con la OC en **borrador** (o cancelada) la
  receta se sigue moviendo libre, como siempre. El candado entra cuando la OC está **autorizada**.
- **La salida existe y el mensaje te la dice.** Si intentas quitar algo comprado, el aviso nombra el
  material, **el folio de la orden de compra** que lo tiene y qué hacer: des-autorizarla y volver.
- ⚠️ **Si la compra YA SE RECIBIÓ, no hay marcha atrás — y es a propósito.** Una OC con material
  recibido **no se des-autoriza** (decisión de Daniel): la tela ya entró al almacén, y el camino honesto
  es una **devolución** o un **ajuste de inventario**, no borrar la firma como si nunca hubiera pasado.
  El mensaje lo dice con esas palabras en vez de dejarte dando vueltas.
- **También se cerraron dos puertas de atrás que lograban lo mismo sin "quitar" nada**: dejar el
  consumo del material en **0** y apagarle la casilla de **«para producción»**. Las dos lo borraban de
  la explosión igual que quitarlo. Lo demás se sigue pudiendo editar sin problema sobre material ya
  comprado: precio, proveedor amarrado, notas y subir o bajar el consumo.
- **La Ruta Crítica se entera sola.** Si des-autorizas la única compra de tela de una orden, el proceso
  *"compra de tela"* **se des-marca** en su ruta — igual que ya pasaba al cancelar la OC.

### Qué sigue pendiente o roto

- ⚠️ **Al subir esta versión hay que sembrar el permiso nuevo** (el de des-autorizar): el despliegue
  a `prueba` tiene que correr con **`SEED_ON_START=true`**. Si no, el botón no le aparece a nadie,
  ni a dirección.
- 🔴 **Las fotos siguen sin subir.** Es configuración de Cloudflare, no código.
- ⚠️ **Falta comprobar el tope de subida del servicio donde vive el sistema (Railway)** — sigue igual
  que en la 0.015.

---

## 0.016 · 22-ago-2026 · **en prueba** — Ponerle proveedor a varios avíos de un golpe

### Qué se puede hacer ahora que antes no

- ⭐ **En la explosión de materiales, marcar los que van con el mismo proveedor y asignárselo a todos
  de una vez.** Antes había que abrir el formulario **material por material**: seis avíos del mismo
  proveedor eran seis veces el mismo tecleo. Ahora arriba de la lista sale un panel con **todos los
  materiales que se quedaron sin proveedor**, con su casilla y un **«Seleccionar todos»**; se elige el
  proveedor una sola vez y listo.
- ⭐ **Se ve qué va a pasar ANTES de que pase**: el panel dice *"se escribirán 6 renglones de receta en
  2 órdenes"*, y al terminar **salta un aviso** diciendo a quién se le asignó y cuántos renglones fueron.
  ⚠️ El aviso sale **aunque el panel desaparezca** — y desaparece casi siempre, porque al llenar todos
  los huecos ya no hay nada que asignar. Si el mensaje viviera dentro del panel, **no lo verías nunca
  justo en el caso que esto vino a resolver**.
- ⭐ **Con una compra de varias órdenes, tú decides en cuáles se guarda**: *"todas las órdenes de esta
  compra"* (lo normal) o *"sólo la orden 1516"*.

### Qué cambió y puede sorprender

- **Sigue siendo SÓLO PARA ESAS ÓRDENES: el catálogo NO se toca.** Es la misma regla de siempre —
  *"para esa OP en particular, no para siempre ni para todo"*—. La vía rápida no es una puerta trasera
  para editar el catálogo, y el panel lo dice en pantalla.
- **Es TODO O NADA.** Si alguno de los materiales marcados no se puede (por ejemplo, porque esa orden
  lo tiene EXCLUIDO de su receta), **no se asigna ninguno** y el mensaje dice cuál fue y por qué. Es a
  propósito: quedarse con la mitad asignada obligaría a revisar renglón por renglón, que es justo el
  trabajo que esto vino a quitar.
- **El sistema NO te propone el proveedor: lo eliges tú.** Y hay una razón: el proveedor **habitual**
  del avío y el **dueño** de la tela ya los busca el sistema solo, ANTES de esta pantalla. Si un
  material aparece aquí es porque ninguno de esos existe — o sea, el sistema no se está callando una
  sugerencia, no la tiene. Inventarla adivinando de compras viejas sería escribir una suposición como
  si fuera un hecho.
- **Dónde se arregla para siempre:** si a un avío siempre se le compra al mismo proveedor, márcalo como
  **habitual** en el catálogo (o ponle **dueño** a la tela) y **deja de aparecer en esta lista**. Esto
  de aquí es para desatorar hoy, no para sustituir el catálogo.
- **Poner proveedor no compra nada.** La orden de compra sigue pasando por su **revisión previa** y por
  su **autorización**, igual que antes. Por eso esto sí se puede hacer en bloque y **liberar la receta
  sigue siendo uno por uno**.
- **Quitar un proveedor sigue siendo de a uno.** En bloque sólo se PONE: quitar es deshacer una
  decisión puntual, y se lleva el precio con ella.
- **El panel sólo aparece cuando sirve**: con **dos o más** materiales sin proveedor. Con uno solo, el
  botón de siempre en su renglón alcanza.
- **El precio no se captura en bloque.** El precio es de cada material; un mismo número para seis avíos
  distintos sería falso. Se sigue capturando renglón por renglón (o lo resuelve el catálogo).

### Qué sigue pendiente o roto

- 🔴 **Las fotos siguen sin subir.** Es configuración de Cloudflare, no código.
- ⚠️ **Falta comprobar el tope de subida del servicio donde vive el sistema (Railway)** — sigue igual
  que en la 0.015.

---

## 0.015 · 22-ago-2026 · **en prueba** — Importar varios PDFs de golpe ya no truena

### Qué se puede hacer ahora que antes no

- ⭐ **Cargar de una vez todos los PDFs de OC del cliente, no de dos en dos.** Antes, con tres o cuatro
  archivos la pantalla se moría con un *«Failed to fetch»* seco. Ahora entra el lote completo: **hasta
  40 OC de las que llegan normalmente** (~200 KB cada una).
  ⚠️ **Dicho con precisión, porque el número solo engaña:** lo que topa no es la cantidad de archivos,
  es el **peso junto**. Con OCs normales caben las 40 de sobra; si algún día llegan **PDFs escaneados
  pesados** (de varios megas cada uno), con siete u ocho ya se pasa y vuelve a fallar — eso sí, ahora
  te lo dice con un mensaje en vez de morirse en seco.
- ⭐ **De pasada se destrabaron otras dos cosas que fallaban por lo mismo, y que nadie había
  reportado**: importar un pedido desde **Excel** y subir la **constancia fiscal de un proveedor**.
  Las dos viajan por el mismo camino que los PDFs, así que las dos se estrellaban contra el mismo
  tope invisible en cuanto el archivo pasaba de ~750 KB.

### Qué cambió y puede sorprender

- **El tope de verdad NO era el que decía el sistema.** El servidor aceptaba hasta 64 MB, pero el
  programa que está en medio —el que sirve las pantallas— cortaba en **1 MB** sin que nadie lo hubiera
  decidido: venía así de fábrica. Como los PDFs viajan convertidos a texto (que abulta un tercio más),
  con tres o cuatro OC ya se pasaba. Ahora los dos números son el mismo, y hay una prueba automática que
  **se pone roja si alguien vuelve a separarlos**, para que no se repita en silencio.
- **Si un envío falla, ahora te dice algo que puedes hacer.** En vez del texto del navegador, sale
  *"prueba con menos archivos a la vez; si el problema sigue con uno solo, revisa tu conexión"*. **No te
  asegura la causa a la ligera**: puede ser el peso o puede ser el internet, y decir una por la otra te
  mandaría a buscar un problema que no existe.
- **Los errores que el sistema SÍ sabe explicar siguen saliendo igual.** Si un PDF no es una OC del
  cliente, te lo dice con esas palabras. Eso no se tapó con el mensaje nuevo.

### Qué sigue pendiente o roto

- 🔴 **Las fotos siguen sin subir.** Es configuración de Cloudflare, no código.
- ⚠️ **Falta comprobar un tercer tope: el del servicio donde vive el sistema (Railway).** Puede tener su
  propio límite y **no se puede saber desde el programa**. Si con lotes muy grandes vuelve a fallar, ahí
  es donde hay que mirar — no es que el arreglo no haya servido.
- **Lo demás pendiente de la 0.014 sigue igual** (la tela favorita en inventarios, los nueve catálogos
  visibles para cualquiera, los perfiles por puesto sin construir).

---

## 0.014 · 22-ago-2026 · **en prueba** — Los avíos de siempre se ponen solos en la receta

### Qué se puede hacer ahora que antes no

- ⭐ **Marcar un avío como «favorito» y que el sistema te lo recuerde al armar la receta.** Hay avíos
  que van en todo —la etiqueta de lavado, quizá la de marca— y hasta hoy había que acordarse de
  ponerlos modelo por modelo. Ahora, al abrir la pestaña **Avíos** de la receta de un modelo, aparece
  arriba un recuadro que dice cuáles favoritos **le faltan** a esa receta y **con cuánta cantidad**
  (*"ETQ-LAV — Etiqueta de lavado · 1 pza"*).
- ⭐ **Se aceptan de un solo clic, todos juntos.** Un botón *«Aceptar los 2»* y quedan puestos. No hay
  que palomear uno por uno, y tampoco se meten solos a tus espaldas: **primero se ven, luego entran**.
  Después se ajusta la cantidad o se quitan como cualquier otro renglón.
- ⭐ **Tú decides cuáles son favoritos, desde el catálogo.** En *Catálogos › Avíos* se marca la casilla
  **«¿Avío de uso frecuente (favorito)?»** y se pone su **cantidad preestablecida**. No hay ninguna
  lista fija metida en el programa: **lo que marques es lo que se sugiere**, y lo puedes cambiar cuando
  quieras.

### Qué cambió y puede sorprender

- **La casilla de «favorito» ya existía… y no hacía nada.** Estaba en el catálogo de avíos desde hace
  meses, con su cantidad, y nadie la leía: se podía marcar y al armar la receta no pasaba nada. Desde
  esta versión **sirve**. Si alguien la marcó en su momento, esos avíos van a empezar a aparecer
  sugeridos — es lo esperado, no un error.
- **Mientras no marques ninguno, el recuadro no sale.** No es que falle: es que no hay nada que
  sugerir. Marca uno en el catálogo y aparece al instante.
- **Los favoritos que YA están en la receta también se mencionan, aunque no se vuelvan a ofrecer.**
  El recuadro sólo ofrece los que faltan, pero abajo te dice *"otro avío favorito ya está en esta
  receta"* — para que no te quedes con la duda de si el sistema lo ignoró o ni lo vio.
- **Si tenías cambios sin guardar en la receta, el botón de aceptar se pone gris** y te dice por qué
  (*"Guarda primero la receta…"*). Es a propósito: aceptar vuelve a leer la receta del servidor, y si
  no lo bloqueáramos perderías lo que acabas de teclear sin que nadie te avisara.
- **Un avío marcado favorito pero SIN cantidad no se sugiere** —el sistema no se inventa cuántas piezas
  llevas— pero **sí te dice cuál es**, para que le pongas la cantidad en el catálogo.
- **Esto es para la receta del MODELO, no para la de una orden ya creada.** Cada orden de producción
  lleva su propia receta congelada desde que nace; ahí se agregan a mano, como siempre.

### Qué sigue pendiente o roto

- 🔴 **Las fotos siguen sin subir.** Es configuración de Cloudflare, no código.
- **Ningún avío viene marcado como favorito de fábrica.** El primer paso es de Daniel: entrar al
  catálogo y marcar los que van en todo (empezando por la etiqueta de lavado, con 1 pieza).
- **Esto es sólo para avíos. La «tela favorita» es OTRA COSA, y sigue pendiente.** Daniel lo aclaró
  el 22-ago: la marca de la tela **nunca fue para que el sistema te la ofrezca sola** en la receta.
  Era para **inventarios**: ver de un vistazo el grupo corto de telas que más se usan, en vez de
  recorrer el catálogo entero. **Son dos funciones distintas con el mismo nombre**, no una versión
  incompleta de la otra.
  🔴 **Y hoy la marca de la tela no hace nada más que verse.** En *Catálogos › Telas* la marcas y la
  ves con su etiqueta *«Favorita»*, pero **las pantallas de existencias ni la miran**: no filtran por
  ella, no adelantan esas telas ni las agrupan. **Marcar telas hoy no te ahorra trabajo todavía** —
  lo que falta es lo de inventarios, que está anotado como pendiente. El **arte** no tiene favoritos
  de ninguna clase.
- Lo demás pendiente de la 0.013 sigue igual (los nueve catálogos visibles para cualquiera, los
  perfiles por puesto sin construir, la medida del avío que todavía no viaja a la orden de compra).

---

## 0.013 · 22-ago-2026 · **en prueba** — La tela por fin se pide por COLOR

### Qué se puede hacer ahora que antes no

- ⭐⭐ **Pedir la tela por color.** Hasta hoy la receta y la orden de compra decían *"felpa"* y ya: el
  color no cabía en ningún lado. Pero el almacén **sí exige el color** al recibir, así que quien recibía
  tenía que **adivinar la correspondencia** — y la misma tela en tres tonos era **un solo renglón** que no
  decía cuánto de cada uno. Ahora, en *Compras › Explosión*, se dice **de qué color se compra cada tela**
  para cada color de la orden; el sistema **propone** (por pantone, por nombre o por el amarre que ya
  existía en el catálogo) y **la persona confirma**. La explosión se parte en **un renglón por color**, con
  la cantidad que sale de la matriz de la orden.
- ⭐ **El precio sale del color, y corregirlo ahí actualiza el catálogo.** Cada tono puede costar distinto;
  antes no había con qué elegir cuál era el precio. Ahora el renglón trae el precio de SU color, se puede
  corregir sin salir de la compra, y **queda para las próximas compras de ese color**. Se avisa en pantalla
  de cuánto a cuánto quedó y queda en bitácora **quién, cuándo y desde qué orden**.
- ⭐ **Quien recibe ya no adivina.** La lista de *"pendiente de la orden de compra"* dice el color con su
  pantone, y al capturar viene **preseleccionado**. Sigue siendo editable: manda lo que de verdad llegó.
- ⭐ **A quien autoriza una OC se le AVISA si algo se salió de la cuenta.** El sistema calcula cuánto se
  necesita, Compras teclea la cantidad, y si la diferencia pasa del **10 %** la bandeja de autorización lo
  dice **en la tarjeta**, sin abrir nada. 🔴 **Es un aviso, no una tranca:** la orden se autoriza igual.
  El porcentaje se ajusta en *Administración › Empresas › Configuración*.
- **El papel de la OC dice el color y su pantone**, que es lo que el proveedor necesita leer.

### Qué cambió y puede sorprender

- ⚠️ **Una orden de compra vieja se recibe exactamente igual que antes.** Las que ya existen (unas 7,978)
  piden la tela sin color, y **así se quedan**: no se les inventó ninguno. El sistema sólo cruza el color
  cuando el renglón lo trae.
- ⚠️ **Corregir el precio de un color lo cambia para TODOS.** Es a propósito —el precio es del color, no de
  esa compra— pero conviene saberlo: la pantalla lo advierte antes de guardar.
- ⚠️ **Puede aparecer un aviso nuevo al comprar:** *"de ese «ya en OC», N kg vienen de una orden que no
  dice de qué color era"*. Pasa cuando lo ya comprado viene de una OC vieja sin color y hay varios tonos:
  el sistema tuvo que **atribuirlo a alguno** para no ofrecer comprar de más, y prefiere decirlo a callarlo.
- Si a una tela todavía no se le dijo el color, **se compra igual** (para que la orden no se quede corta) y
  sale listada aparte, con un atajo para arreglarlo en la orden que corresponde.

### Qué sigue pendiente o roto

- ⬜ **Los avíos NO se compran por color todavía.** Se midió: en la tela el color ya existía en el catálogo
  y en el almacén, y sólo faltaba el eslabón de en medio; en el avío **no existe el catálogo de colores**,
  ni el inventario por color, ni la recepción por color. Es una etapa aparte, del tamaño de ésta.
  ⬜ Falta que Daniel diga si los avíos que importan por color (cintas, elásticos, cierres) justifican
  montar ese catálogo, o si basta con que la descripción del avío lo diga.
- Sigue el **bloqueo de las fotos** en `prueba` (configuración de Cloudflare R2, no código).

---

## 0.012 · 21-ago-2026 · **en prueba** — Las tallas, en orden y sin contradicciones calladas

### Qué se puede hacer ahora que antes no

- ⭐ **Las tallas por fin salen en su orden.** Antes la matriz decía **CH, G, M, XG** —alfabético— porque
  ninguna talla traía puesto su orden: la migración las cargó todas en cero. Ahora salen **CH, M, G, XG**,
  y también **4-6-8-10-12** en vez de **10-12-4-6-8**, y **3M-6M-9M-12-18-2A-3A** en la curva de bebé. Vale
  para toda pantalla que enseñe tallas: la matriz de la orden, el corte, el recibo, las existencias, las
  órdenes de compra y el inventario cíclico.
  ⚠️ **El orden no se inventó: se midió** sobre las 5,451 órdenes del sistema viejo. De ahí salieron las
  tres reglas: los **números van antes que las letras** (2, 3, 3X), los **meses y los años son la misma
  escala** (3M, 6M, 9M, 12, 18, 2A, 3A), y **3X es letra**, que es lo que la hace caer bien tanto entre
  números como entre letras. Con eso, el **98.7 %** de las órdenes con curva legible (5,311 de 5,383)
  quedan bien ordenadas; lo que queda es data sucia del viejo (etiquetas como `UT`, `MC`, `M.`), que se queda al principio de la lista y
  se puede acomodar a mano desde Catálogos › Tallas.

- ⭐ **Si la curva del modelo no es la de la orden, el sistema lo DICE** — con los nombres de las dos y qué
  tallas sobran y cuáles faltan. Es lo que le pasó a Daniel: dio de alta un modelo desde una orden de C&A
  de bebés y le capturó tallas de caballero; el sistema tomaba las tallas de donde debe —de la orden— pero
  **no decía nada**, y desde afuera parecía un error de cálculo. El aviso sale en los **tres** lugares
  donde se ven las dos: la **captura de medidas por talla del avío** (que es donde lo encontró), la
  **receta de la orden** y la **ficha del modelo**.
  🔴 **Avisa, NO bloquea.** Que una orden pida una talla fuera de la curva del modelo es legítimo y pasa
  seguido; bloquearlo pararía trabajo de verdad.

- ⭐ **Si el modelo no tiene curva y sus órdenes sí, el sistema la propone.** Aparece arriba de la receta
  del modelo, con las tallas y **cuántas órdenes la usan** (y sus folios). Se asigna con un botón.
  ⚠️ **Se propone; la confirmas tú.** La curva queda escrita en el catálogo del modelo y de ahí la heredan
  la receta, el precosteo y las órdenes siguientes, así que no se pone sola. Y si **distintas órdenes usan
  curvas distintas**, se enseñan **todas** para que elijas: el sistema no adivina cuál es la buena.

### Qué cambió y puede sorprender

- **El «Orden de despliegue» de una talla ahora arranca en 1**, y si lo dejas vacío el sistema lo deduce de
  la etiqueta. El **0** dejó de ser un valor capturable: pasó a significar «nadie le puso orden». Por eso,
  al editar una talla vieja, ese campo abre **vacío** en vez de con un «0».
- **El orden se sembró solo, y respeta lo que alguien haya acomodado a mano.** Si una talla ya traía su
  orden puesto, se queda tal cual.
  ⚠️ **Con una salvedad, y es mejor decirla:** «tener orden puesto» significa **1 o más**. Si alguien
  escribió un **0** a propósito antes de esta versión, ese 0 **sí se pisa** — el sistema no puede
  distinguirlo del 0 que dejó la migración, que es justo lo que vino a reparar. De aquí en adelante deja de
  poder pasar: el campo ya no acepta 0.
- **Las etiquetas raras del viejo se quedan al principio de las listas.** Son **26 combinaciones de las
  161** (58 órdenes de 5,383), casi todas errores de captura de hace años. Se dejan a la vista a propósito,
  en vez de darles una posición inventada.
- **Si le cambias la ETIQUETA a una talla, su orden se recalcula solo.** Renombrar `CH` a `3M` la manda al
  lugar que le toca entre las tallas de bebé, en vez de dejarla al final con las letras. ⚠️ **Salvo que tú
  le hubieras puesto el orden a mano:** en ese caso se respeta y no se mueve.
- **Ya no nacen curvas duplicadas con «(2)».** Si intentas asignarle a un modelo una curva que **existe
  pero está desactivada**, el sistema te lo dice y te manda a reactivarla, en vez de crear una segunda con
  el mismo contenido y otro nombre.

### Qué sigue pendiente o roto

- 🔴 **Las fotos siguen sin subir.** Es configuración de Cloudflare, no código.
- **Cambiar la curva de un modelo que YA tiene una** se sigue haciendo desde su ficha, a mano. La propuesta
  automática sólo llena huecos: no cambia lo que ya está puesto, a propósito.
- **El sistema todavía no le dice al proveedor qué medida pedir** en la orden de compra (sigue de la 0.010).

---

## 0.011 · 21-ago-2026 · **en prueba** — Recibir empieza por el proveedor que llegó

### Qué se puede hacer ahora que antes no

- ⭐ **Al recibir mercancía, ahora se empieza por el PROVEEDOR.** Se teclea su nombre y salen **sus órdenes
  de compra abiertas**, con su número, su fecha y **qué trae pendiente cada una**. Antes había que empezar
  por el número de la orden — que es justo lo que uno no sabe cuando el camión ya está en la puerta.
  *Como lo dijo Daniel: "en la realidad, cuando vas a recibir algo, buscas al proveedor que llegó a
  entregar".*
- **Si el proveedor trae una sola orden abierta, queda elegida sola.** Un paso menos en el caso más común.
- **El número de orden sigue sirviendo, como atajo.** Quien trae la remisión en la mano puede teclear el
  número directo, con o sin proveedor. Los dos filtros conviven: nunca se cae uno en silencio.

### Qué cambió y puede sorprender

- **La lista de órdenes de compra ya no es un menú desplegable.** Ahora es una lista que sale del
  proveedor. Quien estuviera acostumbrado a bajar por el desplegable tiene que teclear el proveedor
  primero.
- 🔴 **Se arregló algo que nadie había reportado y que ya estaba mordiendo: había órdenes de compra
  IMPOSIBLES de alcanzar desde esa pantalla.** El desplegable traía nada más las primeras 100 y las demás
  simplemente no existían para el que recibía — y empeoraba solo, porque cada orden nueva empujaba a las
  viejas fuera. Ahora la pantalla **dice cuántas está mostrando de cuántas hay** (*"Se muestran 50 de
  300"*) y a cualquier orden se llega por su número.

### Qué sigue pendiente o roto

- **Navegando no se pasa del tope**: no hay "siguiente página". Si un proveedor tiene más órdenes abiertas
  que el tope, a las de más abajo se llega **por su número**, no bajando. Es aceptable porque la lista pone
  adelante lo más nuevo; el día que haga falta pasear por las viejas, lo que toca es paginar.
- El **almacén destino** sigue siendo un desplegable de una sola página. Hoy no muerde —el catálogo de
  almacenes es diminuto y no crece— pero es el mismo patrón, y queda anotado.

---

## 0.010 · 20-ago-2026 · **en prueba** — La compra desde la explosión: revisión previa, no recomprar, y una compra para varias OP

### Qué se puede hacer ahora que antes no

- ⭐ **Antes de generar las órdenes de compra, hay una PANTALLA DE REVISIÓN.** Al darle «Revisar y generar
  OC» ya no se crea nada: primero se ve **exactamente lo que va a salir** — a qué proveedor, con qué
  materiales y cantidades, con qué fecha de entrega, por cuánto, y **de qué orden de producción es cada
  cantidad**. De ahí se confirma… o se regresa a corregir. Nada se compromete hasta el «Confirmar».
- ⭐ **Y ahí se ve también lo que NO va a entrar, con su razón.** *"A la Felpa no hay a quién comprársela"*,
  *"el hilo lo cubre el inventario"*, *"esto ya está en una orden de compra"*. Antes esos renglones se
  quedaban fuera **en silencio** y no había manera de enterarse.
- 🔴 **El sistema ya NO propone comprar lo que ya compraste.** Éste era el problema de fondo: se generaba
  una orden de compra, se volvía a la explosión y ahí seguían los mismos materiales, invitando a comprar
  otra vez lo mismo. Ahora cada material dice **cuánto ya está pedido** y **cuánto falta de verdad**, y
  sólo se compra lo que falta. Si ya está todo pedido, lo dice con letras y apaga el botón.
- ⭐ **Una sola compra puede cubrir VARIAS órdenes de producción** — que es como se compra en la práctica.
  Al elegir una OP, el sistema **precarga todas las OP de su pedido interno** (los avíos del 1515, por
  ejemplo) y se quitan las que no vayan; y se pueden **agregar OP sueltas** con el buscador, para el caso
  de las cajas, que cruzan pedidos.
- **Las cantidades se ven juntas y se guardan repartidas.** En pantalla se ve *"350 botones"*; en la orden
  de compra quedan **dos renglones**, uno por cada OP con lo que le toca. Así el "qué tengo / qué falta"
  de cada orden sigue cuadrando y el costo cae donde debe.
- **Si compras de más —el rollo completo, la caja entera—, el sistema reparte el sobrante** entre las OP
  de esa compra, en proporción a lo que cada una necesita. Basta con escribir el total que se va a pedir.
- **Cuando una compra cubre varias OP, la fecha de entrega que se propone es la de la orden que entrega
  ANTES.** El material tiene que llegar a tiempo para la más urgente.
- **El material genérico de almacén (hilo, etiquetas) ya no se cuenta dos veces.** Si dos OP piden el
  mismo hilo, el sistema reparte la existencia entre las dos en vez de decirle a cada una que hay de
  sobra — antes, comprando así, se habría comprado de menos sin que nadie se enterara.

### Qué cambió y puede sorprender

- **El botón cambió de nombre y de comportamiento.** Ya no dice «Generar OC desde la explosión» ni genera
  de un clic: dice **«Revisar y generar OC»** y lleva a la revisión previa. Son dos clics ahora, a
  propósito.
- **Cancelar una orden de compra devuelve sus materiales a "pendiente".** Es lo correcto —si se canceló,
  hay que volver a comprarlos— pero si alguien cancela una OC por error, esos materiales van a reaparecer
  en la explosión como si nunca se hubieran pedido.
- **Las cantidades a comprar se manejan con DOS decimales**, que es lo que la orden de compra guarda.
  Si un consumo pide 3.7020, la orden dice 3.70 — y el sistema ya no se queda esperando esas
  milésimas. Lo que falte de verdad se ve al descargar el material, como Daniel pidió.
- **Una orden de compra en BORRADOR ya cuenta como "comprado"** para efectos de esta pantalla. Es lo que
  impide la compra duplicada (la OC que genera la explosión nace en borrador). Para el **costo** el
  criterio sigue siendo otro: ahí sólo cuentan las autorizadas y recibidas.
- **El impreso de la explosión sigue siendo de UNA orden.** Con varias OP en pantalla imprime la primera,
  y el botón lo avisa al pasar el ratón. Su columna **«A comprar» ahora trae lo que falta de verdad**
  (antes traía lo requerido a secas, así que un impreso hecho después de comprar pedía de más).

### Qué sigue pendiente o roto

- ✅ **Corregido antes de salir: el sistema pedía de más por centésimas.** En la primera versión de
  esta entrega, un material cuyo consumo lleva decimales finos (por ejemplo 0.1234 por prenda) se
  compraba, y al volver a entrar **volvía a aparecer como pendiente** por una diferencia de milésimas
  que la orden de compra no puede guardar. Peor: al darle otra vez se creaban **órdenes de compra
  vacías**, cada una gastando un folio. Y cuando se repartía una compra entre varias OP, la suma de
  los renglones no daba el total que la revisión previa había prometido (100 se guardaba como 99.99).
  Ya no: la cantidad se calcula **con los mismos dos decimales con los que se guarda**, así que lo
  que la previa promete es exactamente lo que queda escrito. **Lo mismo pasaba con el dinero**: en un
  material cuyo precio se calcula dividiendo (por ejemplo $100 el rollo entre 3 metros), la revisión
  previa decía $5,999.99 y la orden de compra guardaba $5,999.40. Ahora los dos números son el mismo.
- ✅ **Corregido antes de salir: la revisión previa decía que algo "ya estaba comprado" cuando no lo
  estaba.** Cuando de un material faltaba una cantidad diminuta (menos de 0.01), la pantalla lo
  reportaba como *"ya está en una orden de compra viva… si esa OC se cancela, vuelve a aparecer"* —
  aunque no existiera ninguna orden de compra. Ahora dice la verdad: *"falta tanto, pero una orden de
  compra no puede pedir menos de 0.01"*. Y cuando **sí** hay una orden detrás, lo sigue diciendo.
- 🔴 **Las órdenes de compra que Daniel generó siguen escondidas hasta que se corra un script.** No es
  falta de esta versión: los folios de OC arrancaron en 1, 2, 3… y el listado, que ordena del folio más
  alto al más bajo, las mandó hasta la última página, detrás de las casi 8,000 migradas. **Gabriel tiene
  que correr `reparar-secuencias.ts` en `prueba`**; después de eso, la serie salta a **10001**, como
  Daniel pidió (*"el sistema anterior va en la 8082; tenemos mucho colchón"*).
- **El faltante de la recepción no se reparte, y así se queda.** Si se piden 300 kilos y llegan 280,
  entran 280 al almacén y cada OP se lleva lo que de verdad se lleva al descargarlo. Decisión de Daniel:
  *"los consumos son estimados… a la hora de ir descargando las telas es cuando se va a poder saber a
  cuál aplica"*.
- **Asignar proveedor a un material sigue siendo por UNA orden.** Con varias OP en pantalla, el
  formulario pregunta a cuál — no se asigna a todas de golpe, porque esa asignación es "sólo para esa OP".

---

## 0.009 · 20-ago-2026 · **en prueba** — Modelos de desarrollo y modelos de producción

### Qué se puede hacer ahora que antes no

- **Los modelos de desarrollo y los de producción ya son cosas distintas.** El catálogo y la galería
  enseñan **los de producción** por default; los de desarrollo están a un clic, detrás de un filtro. Se
  acabó el catálogo lleno de muestras que nunca salieron.
- **Los modelos de desarrollo se numeran solos**, con la forma `CYA-26-71-001`: la abreviatura del
  cliente, el año en que se piensa **entregar**, el tipo de prenda y el género, y un consecutivo. Ya no
  hay que inventar un código al dar de alta un modelo nuevo en un proyecto — el sistema lo arma.
- **Esa numeración NO gasta números de producción.** Un modelo que nunca sale a fabricarse ya no quema uno
  de los 999 que tiene cada combinación.
- **Ya existen «Chamarra» y «Gorra» como tipo de prenda**, con su dígito (8 y 9). Faltaban, y sin ellos
  no se podía desarrollar ni una chamarra ni una gorra — son el 9 % del catálogo histórico.
- **El dígito del tipo de prenda se captura en su catálogo** (Calidad › Tipos de producto): es el primer
  dígito del código de producción de sus modelos. No se puede repetir entre tipos activos.
- ⭐ **Al generar la OP, el sistema PROPONE el número de producción y tú lo confirmas.** Llega ya escrito
  con el siguiente libre; si quieres otro, lo borras y tecleas el tuyo. También se puede hacer desde el
  catálogo, con el botón **«Pasar a producción»**.
- **El sistema avisa cuando una serie se está acabando** ("a la serie 71 le quedan 39 números de 999") y
  cuando los dos primeros dígitos no cuadran con el tipo de prenda y el género. **Avisa, no bloquea**: la
  excepción sigue siendo tuya. Lo único que sí impide es repetir un número que ya es de otro modelo.
- **El cliente tiene su abreviatura** (el `CYA`). Sin ella no se le pueden dar de alta modelos nuevos de
  desarrollo, porque el código no se puede armar — y el sistema lo dice así.

### Qué cambió y puede sorprender

- **Un modelo que pasa a producción CAMBIA de código**: deja de llamarse `CYA-26-71-001` y pasa a llamarse
  `71001`. **Su número de desarrollo NO se pierde**: se guarda, se enseña debajo y se puede buscar por
  cualquiera de los dos. La receta, el arte, las fotos, el precosteo y sus órdenes no se tocan.
- Como la orden **no guarda copia** del código, una OP creada antes de pasar el modelo a producción
  empezará a enseñar el número nuevo. Es el mismo modelo; el cambio es sólo de nombre.
- **El número interno que salía al generar la OP (1, 2, 3…) desaparece.** Nunca fue el número del negocio:
  no cambiaba el código del modelo ni lo sacaba del catálogo de desarrollo — era justo el motivo de que
  *"la OP 5558 heredara el modelo de desarrollo"*. Ahora el número es el de cinco dígitos de siempre.
- El alta de un desarrollo con modelo nuevo **ya no pide el código**; pide el **tipo de prenda**, el
  **género** y el **año de entrega**, que son de donde sale.

### Lo que queda pendiente

- Un **género** nuevo nace sin su dígito de nomenclatura (los ocho de siempre ya lo traen) y todavía no
  hay pantalla para capturarlo — el catálogo de géneros nunca tuvo alta ni edición. Mientras no se
  capture, el sistema **lo dice con el nombre del género** en vez de inventar un número. *(El dígito del
  **tipo de prenda** sí se captura, en Calidad › Tipos de producto.)*
- Los modelos de desarrollo **que ya existan en `prueba`** quedan marcados como de producción, porque su
  código venía de la serie vieja. Los de desarrollo de verdad empiezan a partir de aquí.

---

## 0.008 · 20-ago-2026 · **en prueba** — A quién le compramos

### Qué se puede hacer ahora que antes no

- **La explosión de materiales ya propone a quién comprarle.** Antes se quedaba en blanco y el botón de
  generar órdenes de compra no encendía: se veía todo y no se podía avanzar.
- **La tela usa SU proveedor**, el que ya trae definido. No hay telas de varios proveedores, y el sistema
  dejó de pedir que se capturara un dato que la tela ya tenía.
- **Cada avío puede tener su proveedor habitual**, y ése es el que se propone. Antes la regla era "el más
  barato", que sigue funcionando para los avíos sin habitual.
- ⭐ **El comprador desatora sin esperar a nadie.** Si un material se quedó sin proveedor, se le asigna
  **desde la explosión**, con su precio. **Solo para esa orden**: no toca el catálogo ni le quita la
  decisión a Desarrollo. Si mañana Desarrollo define el proveedor, Desarrollo manda.
- **El proveedor propuesto se puede cambiar al comprar**, para tela y avío por igual. Es una sugerencia,
  no una atadura.
- **El botón apagado ahora dice qué le falta**, con los nombres de los materiales, en vez de quedarse mudo.

### Qué cambió y puede sorprender

- **Los avíos que tienen un solo proveedor quedan con ése marcado como habitual** al actualizar. Si ese
  único proveedor **está dado de baja**, NO se marca — se sigue viendo como "sin proveedor", que es lo
  correcto: hay que elegir a alguien vivo.
- El proveedor que aparece **de baja** ahora se marca y ofrece cambiarlo. Antes avisaba sin dar salida.
- Los avíos con **varios** proveedores no cambian: siguen con "el más barato" mientras nadie marque uno.

### Lo que queda pendiente

- ⚠️ **La cotización y la compra pueden separarse.** Si alguien marca como habitual a un proveedor que no
  es el más barato, el material se **comprará** a ese precio pero el **precosteo** sigue calculando con el
  más barato. No es silencioso —el precio va en la orden de compra— pero **es una decisión de negocio
  pendiente**: ¿la cotización debe seguir a la compra? El día del cambio no hay diferencia; solo aparece
  cuando alguien lo decide a propósito.

---

## 0.007 · 20-ago-2026 · **en prueba** — Las recetas se firman de una en una

### Qué cambió y puede sorprender

- **Se retiró «Liberar todo lo que falta»** y los botones que firmaban una sección entera. **La receta se
  libera renglón por renglón.** Daniel, probando el flujo: _"no tiene sentido liberar las cosas sin ver"_.
- **La bandeja «Recetas por liberar» ya no firma desde la lista.** Antes tenía un «Revisar y liberar» que
  aprobaba todo viendo solo _"3 avíos, 1 tela"_ — sin la lista de materiales enfrente. Ahora la bandeja
  **lleva a la receta**, y ahí se firma viendo.
- **«Marcar todo revisado» se queda.** No libera nada ni compromete dinero: solo anota que ya se miraron los
  renglones. La fricción se cobra donde hay consecuencia.

### Por qué

La firma **no es un trámite: es la puerta que abre la compra.** Un botón que aprueba diez cosas de un clic
entrena justo lo que la firma existe para evitar.

⚠️ **Y vale decir de dónde venían esos botones:** no los pidió Daniel. Su decisión fue _"debería poder
liberarse por partes"_; **el bloque lo agregó el equipo**, razonando que lo rutinario no costara veinte
clics. Optimizar para la prisa, en el punto donde se compromete el dinero, fue el error.

---

## 0.006 · 19-ago-2026 · **en prueba** — La receta, en una pantalla donde sí se ve

### Qué se puede hacer ahora que antes no

- **La receta de la orden tiene pantalla propia**, ancha, con las telas, los avíos y el arte en tablas
  donde caben el consumo, el precio, el proveedor y el estado de cada renglón. Antes vivía apretada en el
  cajón lateral de la orden.
- **Se llega desde los dos lados y es la misma pantalla**: desde la orden, y desde «Recetas por liberar».
  Antes la bandeja solo ofrecía firmar todo junto, sin manera de entrar a ver el detalle.
- **Firmar renglón por renglón es un botón que dice «Liberar»**, no un ícono mudo.
- **Lo que falta traer del modelo va arriba y bien visible**, en tono de acción y no de alarma.

### Qué cambió y puede sorprender

- **Con la receta vacía ya no se ofrece el botón de liberar.** Ese clic solo servía para que el sistema
  contestara _"la receta está vacía"_ — y ese cartel era justo el que tapaba la salida. **La regla no
  cambió**: el sistema sigue sin dejar liberar una receta vacía. Lo que se quitó fue el botón que solo
  servía para chocar contra ella.
- **La columna «Acciones» ya no aparece vacía** para quien no puede firmar: se va con su encabezado.
- El bloque de la receta en el detalle de la orden ahora es **un resumen** con su botón a la pantalla.

### Notas

- ⚠️ **De dónde salió esta versión:** probando la anterior, Daniel no encontró cómo meter a una OP unos
  avíos agregados al modelo después. **El mecanismo estaba completo y funcionando** — el botón que lo
  resolvía estaba en pantalla, debajo de un mensaje más llamativo, y no se veía. _Una función que el
  usuario no encuentra no existe._
- Se corrigió de paso algo que no se notaba: alguien de Desarrollo podía **firmar** una receta que no tenía
  permiso de **leer**. No mordía porque hoy los perfiles traen los dos permisos juntos, pero habría mordido
  el día que exista un perfil de Desarrollo puro.
- Esta versión **no necesita nada especial al desplegar**: sin cambios de base de datos y sin permisos
  nuevos.

---

## 0.005 · 19-ago-2026 · **en prueba** — Importar la OC del cliente, y comprar con fechas de verdad

### Qué se puede hacer ahora que antes no

- **Cada orden de compra lleva SU fecha de entrega.** Antes la explosión pedía **una sola fecha para
  todas**, y la tela se necesita semanas antes que los avíos: ponerles la misma **convertía el dato en
  decorativo**, y un dato que nadie cree no sirve para reclamar. Ahora cada proveedor tiene la suya, con la
  de arriba como punto de partida.
- ⭐ **El campo «Archivo de la OC» del pedido SÍ lee el PDF.** Antes solo lo guardaba pegado al pedido sin
  abrirlo nunca —por eso seguía pidiendo cantidad y precio a mano, teniéndolos el propio pedido—. Ahora lo
  lee y **propone**: _"Reconocí una OC de C&A: 4 tallas, 1,744 piezas, 2 packs. ¿La cargo?"_. La persona
  confirma. Si no lo reconoce, **lo dice** y lo deja como adjunto; nunca se traga el archivo en silencio.
- **El 7% de sobre-pedido vuelve a operar.** La plantilla de C&A no existía, así que el sistema aplicaba
  **0%** y las OPs nacían con las cantidades exactas del cliente en vez de las que se fabrican. Ahora se
  siembra de fábrica, y sigue siendo editable.
- **El botón apagado dice qué le falta**, con el conteo: _"Falta ligar 3 de 4 renglones…"_. Antes se
  quedaba mudo, que es ofrecer una puerta sin explicar por qué no abre.
- 🔴 **Un parpadeo de red ya no te saca del sistema.** Antes, cualquier tropiezo de conexión —no una sesión
  cerrada: un corte, un servidor lento— te mandaba a la pantalla de login **perdiendo lo que estabas
  capturando**, porque el sistema no distinguía _"no hay sesión"_ de _"no pude preguntar"_. Ahora te dice
  «no pudimos confirmar tu sesión — **no cerramos tu sesión**» y te deja reintentar.

### Qué cambió y puede sorprender

- En la explosión, **vaciar la fecha de un proveedor no la deja en blanco**: vuelve a seguir a la de
  arriba. Es a propósito —vacío significa _"la que pusiste arriba"_, no _"ninguna"_—, pero sorprende.
- El **porcentaje adicional** distingue ahora entre _"cero por ciento"_ y _"usa el del cliente"_. El campo
  vacío significa lo segundo.

### Qué sigue pendiente o roto

- ⚠️ **Esta versión exige que se encienda el sembrado al desplegar**, o la plantilla de C&A no se crea.
  Conviene confirmar después que C&A quedó con su plantilla al 7%.
- 🔴 **Si alguien guarda un formato de Excel para C&A, el 7% se apaga en silencio** y hay que reponerlo a
  mano. El sistema solo admite **un formato vigente por cliente** desde hace tiempo, y arreglarlo de raíz
  es trabajo mayor; queda anotado, no escondido.

---

## 0.004 · 19-ago-2026 · **en prueba** — La receta se firma en la OP, y por partes

### Qué se puede hacer ahora que antes no

- **Ver y liberar la receta desde la orden misma**, no desde «Modificar». Antes el botón de liberar
  —que es _la puerta que abre la compra_— vivía dentro de la pantalla de modificar la OP. O sea: o
  Daniel firmaba todas las recetas del taller, o había que darle a Desarrollo permiso para cambiar
  cantidades, fechas y tallas nada más para aprobar una lista de materiales.
- ⭐ **Liberar POR PARTES.** _"Podría haber algún cierre que aún no autoriza el cliente, pero ya
  podríamos ir comprando lo demás."_ Ahora se firma renglón por renglón, o por bloques («todas las
  telas», «todos los avíos»), y **se compra lo que está firmado** en vez de esperar a que esté todo.
- **El comprador ve qué falta liberar**, en la explosión de materiales, con nombre y cantidad — y con
  el camino a donde se firma. Antes solo decía que no se podía, sin decir a qué pantalla ir.
- **Traer del modelo lo que le falte a la receta.** El sistema ya sabía qué faltaba y hasta lo
  nombraba, pero obligaba a teclearlo a mano mirando otra pantalla — y quien lo tecleaba era compras,
  que no es quien sabe si ese material va o no va. Ahora lo trae Desarrollo de un clic. **Nunca pisa
  lo que se ajustó a mano para esa orden**: si hay choque, lo dice.
- **Bandeja «Recetas por liberar»** para Desarrollo: una pantalla con lo que está deteniendo, ordenada
  por fecha de entrega, marcando las órdenes que **ya tienen compras hechas** de otra parte de la
  receta. Antes, para saber qué faltaba firmar, había que abrir orden por orden — así que solo se
  liberaba lo que alguien venía a reclamar, y lo que nadie reclamaba se detenía solo.

### Qué cambió y puede sorprender

- **Una orden con la receta a medio firmar ya no cuenta como «completa».** Es coherente —falta una
  firma— y la pantalla lo dice, pero órdenes que antes se completaban al liberar ahora esperan la
  última.
- **La receta ya no aparece dentro de «Modificar»**: se movió a la OP. Dejarla en los dos lados habría
  dejado el botón de liberar detrás del permiso equivocado, que era justo el problema.
- **El mosaico «Modificar» ahora solo se le pinta a quien puede usarlo.**
- **Las órdenes que ya estaban liberadas siguen liberadas**: la actualización firmó sus renglones con
  la misma fecha y el mismo autor. Nadie amanece con la puerta cerrada.

### Lo que sigue pendiente

- **Firmar desde la bandeja se hace sin los renglones a la vista** (se ve _"3 avíos, 1 tela"_, no la
  lista). Queda anotado como decisión, no como descuido: desde la orden sí se firma con todo enfrente.
- **No hay «des-liberar»**: revocar una firma puesta por error obliga a tocar el contenido del renglón.
- En una orden recién creada, los botones de firmar del panel **piden antes «marcar todo revisado»** —
  la bandeja sí lo resuelve de un acto.

---

## 0.003 · 19-ago-2026 · **en prueba** — Proveedores, como se usan de verdad

### Qué se puede hacer ahora que antes no

- **Varios contactos por proveedor**, cada uno con su puesto escrito libremente: vendedor, crédito y
  cobranza, encargado del taller, supervisora… Antes había **un solo campo** para todo.
- **Dar de alta un proveedor leyendo su Constancia de Situación Fiscal.** Se sube el PDF y el sistema
  **propone** RFC, razón social, régimen, código postal y domicilio; **la persona confirma**. Reconoce
  persona física y moral, y si el SAT cambia el formato **avisa en vez de guardar datos equivocados**.
- **Separar lo facturado de lo no facturado en cuentas por pagar**, no solo en talleres: un proveedor de
  telas puede surtir unas cosas con factura y otras sin.
- Los roles se llaman como se habla: **Estampador, Bordador, Telas, Avíos**.

### Qué cambió y puede sorprender

- **El campo corto ahora es UNO solo y único.** Antes había dos —uno para mostrar y otro para talleres—.
  La migración lo sembró con el de los maquileros y **dejó registradas las colisiones** en vez de
  resolverlas sola: hay que revisarlas y decidir cuál se queda.
- **El «tipo» de proveedor desapareció.** Se tradujo a rol automáticamente (Telas, Avíos, Otros
  servicios); los roles múltiples ya cubrían lo que hacía.
- **«Está asegurado» solo aparece en talleres**, que es donde aplica.

### Notas

- 🔴 **Se corrigió un error que afectaba dinero:** los movimientos de maquileros migrados —los que no
  traen marcada la factura— **se caían de los dos lados** al separar con y sin factura, mientras el total
  del encabezado sí los contaba. Encabezado y renglones se contradecían.
- El lector de la constancia **falló contra los PDF reales** y por eso se arregló: metía el nombre de una
  etiqueta dentro del domicilio, **sin avisar**. Había pasado las pruebas porque el archivo de prueba
  estaba **inventado** — _un archivo inventado no prueba el lector: prueba a quien lo escribió_.

---

## 0.002 · 19-ago-2026 · **en prueba** — La versión, a la vista

### Qué se puede hacer ahora que antes no

- **Saber qué versión se está usando, sin preguntar.** Arriba a la izquierda, junto a «Control v2», aparece
  el número en chiquito: **`Control v2  0.002  › Modelos`**. Sirve para reportar: _"estoy viendo la 0.002 y
  me pasó esto"_, y que la respuesta sea sobre el sistema correcto.

### Qué cambió y puede sorprender

- Nada más. Es un cambio de una línea en pantalla; **ningún dato, ningún cálculo, ninguna pantalla se
  tocó**.

### Notas

- El número **no se puede quedar viejo**: si alguien sube la versión aquí y olvida cambiarla en pantalla
  —o al revés—, **el CI se pone rojo** y dice los dos números. _Una versión que miente en pantalla es peor
  que no tenerla._
- El candado se endureció tras la revisión, que encontró **tres formas de evadirlo en verde**: agregar la
  entrada **al final** en vez de arriba (la costumbre más normal del mundo en un archivo así), o escribirla
  con un formato distinto (`## v0.002`, `## 0.0025`) — el candado **no la veía** y dejaba pasar el olvido.
  Ahora exige **orden descendente** y que **todo** encabezado parsee como versión.

---

## 0.001 · 18-ago-2026 · **en prueba** — Diez etapas de golpe

La tanda más grande hasta ahora. Nace de dos sesiones seguidas de **Daniel capturando modelos reales**:
de ahí salieron los dos hallazgos más caros, y **ninguno lo habría encontrado una revisión técnica**,
porque el código estaba bien — lo que estaba mal era **el modelo del negocio**.

### 🔴 Lo primero que hay que hacer, antes de fiarse de cualquier costo

**El sistema estaba costeando hasta 54 veces de más en algunos modelos.** Cuando un avío tenía capturadas
sus _medidas_ por talla (un cierre de 53 cm, uno de 55), el sistema las leía como **cantidades**: entendía
_"54 cierres por prenda"_ en vez de _"un cierre de 54 cm"_. Medido sobre un modelo real, el costo pasaba de
**432 a 8**.

El arreglo **no cambia precios: corrige precios que estaban mal**. Pero antes de sacar conclusiones de
cualquier costo, hay que correr el conteo que dice **qué modelos y qué órdenes vivas traen precios
inflados** (`scratchpad/v1-e3g-conteo-antes-del-deploy.sql`, cuatro consultas de solo lectura).

### Qué se puede hacer ahora que antes no

**En el modelo y su receta**

- El **arte ya no pide nombre**: basta la descripción. Acepta **varias fotos** por arte, la **posición** es
  texto libre ("frente", "espalda", o lo específico que haga falta) y las **puntadas** solo aparecen en
  bordado.
- **Un solo catálogo de procesos**: se da de alta «embosado» una vez y sirve para producción y para el
  arte. **Aplicación y lavado ya cuentan como arte.**
- La **curva de tallas se ve sin buscarla** — la sección Clasificación abre sola.
- **La medida y la cantidad dejaron de ser el mismo campo.** El elástico se captura por _cuánto gastas_
  (0.75 m, con decimales); el cierre por _qué pides_ (53 cm, entero). La unidad de cada avío manda y se ve
  junto al campo.
- **La receta se congela en la orden**: cambiar el modelo mañana ya no altera lo que se produjo ayer.
- **Un solo costo** en la receta, el del **precio real de compra más reciente**. Se acabaron los dos
  números distintos para lo mismo.

**En producción**

- **Se puede mandar prenda ya terminada a estampar, lavar o aplicar** sin que el inventario mienta. Salen
  del almacén y quedan **en tránsito**; al volver, lo bueno entra a primeras y **lo malo a segundas** —esa
  reclasificación no tenía salida—. **Y lo que no regresa se queda visible**, en vez de desaparecer.

**En proveedores**

- **Varios contactos** por proveedor, con el puesto en texto libre.
- **Alta leyendo la Constancia de Situación Fiscal**: se sube el PDF y el sistema **propone** RFC, razón
  social, régimen, código postal y domicilio; **la persona confirma**. Reconoce persona física y moral.
- Los roles se llaman como se habla: **Estampador, Bordador, Telas, Avíos**.
- **Con factura y sin factura** se pueden separar en cuentas por pagar, no solo en talleres.

**En todo el sistema**

- **El buscador de proveedores funciona con más de 100.** Antes era una lista fija: si tenías más, los de
  abajo **simplemente no aparecían**. Arreglado en ocho pantallas.
- **Lo que no te toca, ya no se ve.** Nada de "no tienes permiso": la opción no aparece. Y tecleando la
  dirección de una pantalla ajena **ya no se entra** — antes se veía el esqueleto y fallaba al cargar.

### Qué cambió y puede sorprender

- **Algunos costos van a bajar** al guardar un modelo con la combinación defectuosa. Es la corrección del
  54×, no un error nuevo.
- **Los artes viejos pierden el orden alfabético**: ahora se listan por antigüedad de captura. Se acomoda
  marcando uno como principal.
- **El campo corto de proveedores y talleres ahora es UNO solo y único.** La migración lo sembró con el de
  los maquileros y **dejó registradas las colisiones** en vez de resolverlas sola — hay que revisarlas.
- **Algunas medidas de avíos quedaron marcadas para revisar** (rangos tipo "15-18 cm", tallas, o el mismo
  número escrito de varias formas). **Siguen funcionando**; solo esperan decisión.

### Qué sigue pendiente o roto

- 🔴 **Las fotos no suben.** Es configuración de Cloudflare, no código. Bloquea probar la galería y las
  fotos del arte.
- **El sistema todavía no le dice al proveedor qué medida pedir.** Capturar que el cierre de la M va de
  53 cm ya funciona, pero **la orden de compra sale con una línea agregada por avío**. Es el siguiente
  paso natural.
- **Nueve catálogos siguen visibles para cualquiera** que entre al sistema — entre ellos **clientes y
  proveedores**, con sus nombres y condiciones. Es decisión de Daniel si se cierran.
- **Los perfiles de usuario por puesto están sin construir**: esperan la matriz de permisos que Daniel
  tiene que revisar.
- **Dar de baja el faltante no cierra el pendiente contra el maquilero** (ya era así antes).
