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

## 0.058 · 29-ago-2026 · **en prueba** — **La mesa**: mueves un costo y el margen se mueve solo

### Qué se puede hacer ahora que antes no

- ⭐⭐ **Negociar en vivo, en un solo renglón.** Al abrir la negociación de un modelo dentro de una lista
  de precios, arriba de todo aparece **la mesa**: un campo por cada elemento del costo —tela, avíos,
  maquila, corte…— **ya cargado con lo que dice la receta**, y al lado el precio. **Mueves cualquier
  número y el margen se mueve solo**, sin guardar, sin recargar y sin salir de ahí.

- ⭐ **Las dos direcciones, como las pediste.** *«ponle una jareta más barata y bájame 3 pesos»* son dos
  cosas y el renglón contesta las dos: **escribes el precio y sale el margen**; **bajas un costo y se
  mueven el margen y el precio que ese costo pediría** (el «precio sugerido»). Al lado se ve **cuánto se
  movió la receta** contra lo que cuesta de verdad: *«−$5.00»*.

- ⭐ **Puedes teclear cosas que NO están en el catálogo.** *«no está dada de alta, y ni certeza tengo de
  cuánto cuesta»*: pones la etiqueta que quieras («jareta más barata») y su precio estimado, y entra a la
  cuenta. 🔴 **Y no se da de alta nada**: ni el avío, ni el proveedor, ni el precio. Es un tablero para
  jugar, no un formulario.

- **Los avíos, en su propio panel.** Es la única cosa que aceptaste sacar del renglón: un botón
  **«Avíos»** abre un panel **encima** —no te saca de la pantalla— donde quitas, pones y mueves avíos
  estimados; lo que hagas ahí entra al costo al instante.

- **«Restablecer»** devuelve todo a los costos de la receta, por si te perdiste jugando.

### Qué cambió y puede sorprender

- **Nada de lo que teclees en la mesa se guarda.** Es a propósito y es la regla central: la mesa **no
  cambia la receta, ni el pre-costeo, ni el catálogo**. Para que quede constancia de lo que se acordó
  siguen estando, en el mismo diálogo, **«Registrar acuerdo»** y **«Nueva ronda»**.

- **El margen y el precio sugerido sólo los ves tú** (quien aprueba precios). A los demás la mesa les
  deja jugar con los costos, pero **no les enseña el veredicto** — y se les dice por qué. Es la misma
  regla de siempre (*«nadie más que yo ve los factores»*), extendida al número nuevo: **el precio
  sugerido también delata los factores** si se compara con el costo, así que también se tapa.
  ⚠️ **Y queda dicho, con tus palabras, que esto no es sagrado:** *«no es tan importante… si quiere
  despejarlo tampoco me preocupa tanto; déjalo así por ahora»*. Se dejó porque **no costó nada y hoy no
  le estorba a nadie** (hoy sólo negocias tú). El día que **negocie alguien más**, esto le quitaría un
  número que sí necesita para trabajar — y ahí hay que volver a verlo.

- **La mesa aparece arriba del historial de la negociación**, porque es lo que se usa con el cliente
  enfrente; el historial cuenta lo que ya pasó.

### Qué sigue pendiente o roto

- ⬜ **Los estimados todavía NO se guardan.** Viven mientras la pantalla esté abierta: si la cierras, se
  van. Guardarlos —para que después, en la oficina, alguien pueda cuadrarlos uno por uno— es el paso que
  sigue y toca la base de datos, así que va en su propia entrega. Por eso también la bandeja **«Recetas
  por revisar»** todavía no puede decir *«éste se negoció con estimados»*.

- ⚠️ **Tres defectos que se encontraron PROBANDO la pantalla, no leyéndola. Los tres arreglados antes de
  entregar**, y se cuentan porque los tres te habrían mentido a ti, negociando:
  1. La primera versión, en ciertas condiciones, **borraba lo que acababas de teclear** al recargarse
     sola.
  2. Si agregabas un avío estimado, ponías su precio y **borrabas el nombre para reescribirlo**, el
     precio **seguía viéndose en su casilla pero dejaba de sumarse** — el costo bajaba solo, sin avisar.
     Ahora el importe cuenta siempre (si se queda sin nombre, se le pone «Estimado sin nombre»).
  3. **Antes de que el sistema alcanzara a contestar**, el letrero decía **«Debajo» en rojo** aunque
     todavía no supiera nada. Ahora, mientras no hay número, **no hay veredicto**: ni letrero ni rojo.

- Sigue pendiente lo de siempre: **no se pueden subir fotos** en `prueba` (configuración de Cloudflare
  R2, no del programa).

---

## 0.057 · 29-ago-2026 · **en prueba** — Cuando falta un dato, **el aviso te lleva a llenarlo**

### Qué se puede hacer ahora que antes no

- ⭐⭐ **Ir a capturar los factores del cliente DESDE el aviso que te los pide.** Al armar una lista de
  precios de un cliente al que nunca se le capturaron sus **factores** (margen · descuentos · regalías ·
  costo de ventas), el sistema decía *«los captura el DUEÑO desde la ficha del cliente»* — y ahí te
  dejaba, a buscar la pantalla a mano. Ahora, **si tú eres quien puede capturarlos**, el aviso trae un
  botón **«Capturar factores»** que te abre **la ficha de ESE cliente, en la sección de los factores**.
  Llenas, regresas y armas la lista.

- **Y te lo dice ANTES, no después.** El aviso aparece **en cuanto eliges el cliente y el
  departamento** — ya no después de escoger todos los modelos y apretar «Crear lista» para que el
  sistema te rebote el trabajo hecho.

- **El vacío de «Listas de precios» también lleva.** Cuando todavía no hay ninguna lista, el letrero
  decía *«congélalos en Desarrollo › Pre-costeos»*; ahora, además de decirlo, **te lleva**.

- ⭐ **Y al dar de alta un modelo, si un tipo de prenda sale en gris («sin dígito, no se puede
  numerar»), ahora hay un botón «Capturar el dígito»** que te abre el catálogo donde se pone. **Esto te
  toca a ti**: tu usuario es de los que pueden componerlo. Antes el sistema te decía el nombre de la
  pantalla y te dejaba buscarla a mano — que es, palabra por palabra, lo que pediste que dejara de pasar.

### Qué cambió y puede sorprender

- **Mientras falten los factores, el botón «Crear lista» está apagado.** No es un capricho: sin ellos no
  hay con qué calcular ningún precio, y antes el botón se dejaba apretar sólo para devolver un error.

- **A quien NO le toca capturarlos, no le sale el botón — le sale a quién pedírselos.** Los factores son
  del dueño (el que aprueba precios). Mandar a alguien a una pantalla donde no puede hacer nada es peor
  que no mandarlo.

- **El botón «Ir a Pre-costeos» ahora también se mide.** Si tu usuario no tiene entrada a Desarrollo, ese
  botón ya no aparece: el aviso te sigue diciendo **qué falta y dónde se arregla**, pero sin ofrecerte un
  clic que no lleva a ningún lado.

### Qué sigue pendiente o roto

- **Se revisó el camino completo** desarrollo → precosteo → lista de precios → cotización buscando
  avisos que dejen a la persona sin salida: **18 avisos**, uno por uno. La mayoría ya tenía su salida a
  la mano (el botón de generar el precosto está en la misma pantalla; los precios se aprueban en el
  mismo tablero donde el aviso los pide). Los que **sí** dejaban parado a alguien, se arreglaron.

- ⚠️ **Una advertencia honesta sobre esta misma revisión.** En la primera versión de este trabajo se
  dijo que el aviso del tipo de prenda *"no lleva a ningún lado a propósito, porque quien lo ve no
  administra ese catálogo"*. **Era falso, y falso justo para ti**: tu usuario sí lo administra. Se
  detectó al revisarlo, se midió, y **por eso existe la puerta nueva de arriba**. Queda escrito para
  que si algún día lees que algo "no se puede a propósito", sepas que esa frase también se verifica.

- **Queda un aviso hermano sin botón, y se dice cuál:** el del **género** sin su dígito. No se le puso
  puerta porque **hoy no se puede llegar a él** (los géneros no se dan de alta desde ninguna pantalla y
  el sistema les re-pone su dígito al arrancar); si algún día se les da alta, ese aviso necesita el
  mismo botón. Está anotado como pendiente con nombre.

- Sigue pendiente lo de siempre: **no se pueden subir fotos** en `prueba` (configuración de Cloudflare
  R2, no del programa).

---

## 0.056 · 29-ago-2026 · **en prueba** — Cuando juntas dos colores repetidos, **ya no se despegan solos**

### Qué se puede hacer ahora que antes no

- ⭐⭐ **Juntar dos colores repetidos y que la limpieza SE QUEDE.** Cuando marcas que «Blanco» en
  realidad es «Blanco Óptico», el repetido se guarda apagado y el bueno se queda. Hasta hoy, **la
  siguiente orden de compra de C&A que trajera esa palabra en el papel volvía a prender el repetido**, y
  el catálogo amanecía otra vez revuelto. Ya no: ahora el sistema **se acuerda de quién se llevó a
  quién** y manda la orden nueva al color bueno.

- 🔴 **Y esto era peor de lo que parecía.** El color revivido **se pegaba a la orden nueva**, y un color
  que ya está metido en órdenes **el sistema no lo deja volver a juntar** (con razón: quedarían órdenes,
  cortes e inventario colgando de un color apagado). O sea que la siguiente orden de compra no sólo
  deshacía tu limpieza: **la dejaba imposible de repetir**. Eso es lo que se cerró.

### Qué cambió y puede sorprender

- **La orden nueva queda con el color BUENO, no con el que juntaste.** Es lo que quisiste decir al
  juntarlos, pero conviene saberlo: si el papel del cliente dice «Blanco» y tú juntaste «Blanco» en
  «Blanco Óptico», la orden de producción va a decir **Blanco Óptico**.

- **Un color que apagaste tú (sin juntarlo con nadie) SÍ se vuelve a prender** si aparece en una orden
  de compra. Ahí no hay ninguna limpieza que deshacer, y la orden necesita el color vivo para poder
  armar el cuadro de tallas. La diferencia es a propósito.

- **Si te equivocaste de lado al juntarlos, prender el repetido a mano lo suelta.** Reactivar un color
  desde el catálogo deshace la liga, y a partir de ahí vuelve a vivir por su cuenta.

- **Queda anotado quién mandó la orden al otro color.** Cada vez que una importación manda una orden al
  color bueno en vez del que traía el papel, se guarda ese desvío en la bitácora, con la fecha y el
  usuario. Lo mismo al prender un color, una talla o un campo de referencia desde una importación: antes
  pasaba en silencio.

- **Las fusiones que ya habías hecho también quedan protegidas.** Al subir esta versión, el sistema lee
  su propia bitácora y recupera a quién se llevó a quién en las juntas anteriores — no hace falta que
  vuelvas a hacerlas.

### Qué sigue pendiente o roto

- 🟠 **Nada te avisa del desvío ANTES de confirmar.** La vista previa de la importación **no marca**
  que un color del papel se vaya a ir a otro: hoy te enteras después, y sólo si vas a la bitácora. Es lo
  que de verdad falta y ya está anotado como pendiente.

- **La pantalla de colores tampoco te dice «éste se fusionó en aquél».** El dato ya se guarda, pero la
  lista de colores muestra al repetido como un color apagado cualquiera. Es trabajo de pantalla, aparte.

- **Las tallas y los campos de referencia del cliente no tienen «juntar duplicados»** — sólo lo tienen
  los colores y los departamentos de cliente. Por eso ahí no hay nada que se despegue.

- Sigue pendiente lo de siempre: **no se pueden subir fotos** en `prueba` (es configuración de
  Cloudflare, no del programa).

---

## 0.055 · 29-ago-2026 · **en prueba** — Ya hay una **lista** de las recetas negociadas que esperan revisión

### Qué se puede hacer ahora que antes no

- ⭐⭐ **Ver, de un vistazo, qué modelos negociados están esperando que alguien revise su receta.** Es
  el *"filtro"* que pediste: *"después de una negociación tiene que haber una validación de la receta
  original… de alguna manera debería de pasar un filtro para ver lo que se negoció con el cliente y
  cómo se cerró"*.

  Está en el menú, en **Desarrollo → Recetas por revisar**. Cada renglón dice el modelo, **de qué
  receta original salió**, con qué cliente se negoció, si está sin revisar o rechazada (y por qué), y
  **cuál ya está frenando un pedido**, con la fecha de entrega comprometida y las piezas detenidas.

- **Por qué importa.** La revisión que impide mandar a producir una receta negociada sin firmar **ya
  existía** —está desde hace unos días— pero era un **muro al final del camino**: te topabas con ella
  cuando ya querías generar la orden de producción, y no había forma de *ver* la fila de lo que estaba
  esperando. Con esto se puede trabajar **antes**, en vez de descubrirlo cuando ya urge.

- 📋 **Está ordenada por lo que estorba primero**: arriba lo que ya tiene un pedido con fecha de entrega
  más próxima; después lo que tiene pedido sin fecha; al final lo que todavía nadie ha pedido, y de eso,
  lo que lleva más tiempo detenido.

### Qué cambió y puede sorprender

- 🔴 **La bandeja NO firma: LLEVA.** No hay ningún botón para aprobar desde la lista. Es la misma regla
  que fijaste para «Recetas por liberar»: *"siempre se debe liberar uno por uno… no tiene sentido
  liberar las cosas sin ver"*. El renglón te abre la **ficha del modelo**, que es donde se ve la receta
  completa y se firma.

- 📖 **La lista es CORTA a propósito, y va a seguir siéndolo.** Sólo caen ahí los modelos que nacieron
  de una **negociación** —los que llevan sufijo, `CYA-26-71-001-01`—. Tú mismo lo dijiste: *"hay muchos
  modelos que sí se aceptan tal cual como está la receta"*; ésos nunca generan una versión, así que
  **no aparecen**. Los casi 5,000 modelos que vinieron del sistema viejo **tampoco**.

- ⚠️ **Salen también las RECHAZADAS**, no sólo las que nadie ha visto. Una receta rechazada sigue sin
  poder producirse, así que sigue siendo trabajo pendiente de alguien; se distingue con su etiqueta y
  enseña el motivo del rechazo sin tener que abrirla. Desaparecer de la lista al rechazarla habría sido
  esconder el problema.

- ⚠️ **Una receta ya aprobada que después se toca vuelve a aparecer aquí.** Eso ya pasaba antes (la
  firma se cae sola cuando cambia la receta); lo nuevo es que ahora **se ve**, con la nota que explica
  qué cambió.

### Qué sigue pendiente

- 🔴 **Todavía no se puede negociar "en vivo" con precios estimados.** Lo que pediste —*"otros que habrá
  que cambiar en vivo (a estimado) y después buscar proveedor y cambiar la receta para producción"*— es
  la pieza que falta: mover un costo a mano en la mesa, sin ensuciar el catálogo, y que el sistema
  recalcule el margen. Está decidido cómo debe portarse, pero **no construido**, y por eso la bandeja
  **no** dice todavía *"tiene N estimados sin cuadrar"*: ese dato aún no existe.

- ⏳ Mientras tanto, la bandeja ya sirve para lo primero que pediste: **ver la cola** y trabajarla.

- ⚠️ **Un detalle fino, por si alguna vez lo notas:** hay una forma antigua de crear una orden de
  producción (sólo por programa, no por pantalla) que **se salta** la revisión. Viene de hace tiempo y
  no es de esta versión; **no te esconde nada**, porque el modelo sigue apareciendo en esta bandeja
  hasta que se firme. Está anotado como pendiente con nombre.

---

## 0.054 · 29-ago-2026 · **en prueba** — El hilo de la negociación ahora dice **quién** escribió cada cosa

### Qué se puede hacer ahora que antes no

- ⭐ **Ver de quién viene cada comentario de una negociación.** En **Listas de precios → (el renglón) →
  Negociación** ya existía el hilo donde queda escrito lo que pasó en la mesa —*"le bajaron dos
  colores"*, *"le quitaron una costura al costado"*, *"dimos un precio más bajo porque nos van a comprar
  20 mil unidades"*— con su fecha y, cuando el comentario acompaña un cambio de precio, con el precio
  de antes y el de después.

  Lo que **faltaba** era la firma: se leía **qué** se acordó y **cuándo**, pero **nunca de quién venía**.
  Ahora hay una columna **«Quién»** con el nombre de la persona que lo escribió.

- **Por qué importa:** el hilo es **el porqué de cada número**. Dentro de seis meses alguien va a ver
  *"estampado: 9.00"* y la pregunta no va a ser *cuánto* sino **por qué ése** — y a quién preguntarle.
  Un comentario sin firma no se puede repreguntar ni defender.

### Qué cambió y puede sorprender

- 📖 **El hilo ya existía; esto no es un módulo nuevo.** Está desde que se construyó la negociación por
  versiones. Si nunca lo habías notado, está en el botón **«Negociación»** de cada renglón de la lista
  de precios, junto con «Nueva ronda» y «Registrar acuerdo».

- ✍️ **Un comentario suelto, sin tocar ningún precio, siempre fue válido** y sigue siéndolo: es
  «Registrar acuerdo» dejando el precio en blanco. Sirve para dejar constancia de algo que se habló
  aunque no haya cambiado ningún número.

- 🔒 **Los comentarios no se editan ni se borran, y eso es a propósito.** En una negociación el valor
  está en poder mirar atrás y ver **cómo se llegó** al precio; si alguien pudiera reescribir el pasado,
  esa historia dejaría de servir. Si algo quedó mal escrito, se agrega otro comentario aclarándolo. Es
  la misma regla que ya rige en los comentarios de las órdenes.

- 👤 **Dar de baja a una persona NO borra su firma.** Si diste de baja a alguien, sus comentarios
  **siguen apareciendo con su nombre** — la baja no borra lo que escribió ni lo vuelve anónimo.
  Verás **«Sistema»** sólo en asientos que no escribió ninguna persona.

- 🔒 **Con la lista CERRADA ya no se pueden agregar comentarios** (ni rondas ni acuerdos). No es nuevo
  —siempre fue así— pero conviene saberlo: si necesitas dejar constancia de algo en una negociación ya
  cerrada, hay que **reabrirla** cambiándole el estado, y esa reapertura queda registrada.

### Qué sigue pendiente

- ✅ **Antes que el pendiente, una buena noticia que quizá no sabías:** *"¿por qué cambió el precio,
  concepto por concepto?"* **ya se puede ver hoy**. En cada **ronda** del hilo hay un botón
  **«Comparar»** que pone lado a lado las dos versiones del costo y te dice **qué cambió, qué se
  agregó y qué se quitó** —tela, maquila, estampado, cada avío— con su importe de antes y de después.

- 🔴 **Lo que falta es que ese detalle se escriba SOLO en el encabezado del comentario.** Hoy, cuando un
  comentario acompaña un cambio, arriba se escribe el **precio total** de antes y después; lo que pediste
  es más fino —*«Estampado: $12.00 → $9.00»*—. La comparación ya existe (el botón «Comparar»), pero
  **vive en la pantalla y el encabezado se graba por dentro**, así que hay que llevarla para allá; y en
  un **comentario suelto sin cambio de costo** no hay dos versiones que comparar, así que ahí siempre
  será texto. Mientras tanto, **el texto del comentario ya lo cubre** (*"le bajaron dos colores"*).

---

## 0.053 · 29-ago-2026 · **en prueba** — Ya puedes juntar los departamentos que están repetidos

### Qué se puede hacer ahora que antes no

- ⭐⭐ **Juntar en uno solo los departamentos duplicados de un cliente.** Es lo que estaba frenando la
  lista de precios: el catálogo de C&A tenía «2-HOMBRE», «Caballeros» y compañía —el mismo departamento
  escrito de tres formas—, y **el trabajo quedaba repartido entre ellos**. Un modelo capturado en
  «2-HOMBRE» **no aparecía** al armar la lista de «Caballeros».

  Ahora, en **Clientes → (el cliente) → Departamentos**, hay un botón **«Juntar duplicados»**:
  1. eliges **el departamento que se queda** (el nombre bueno);
  2. marcas **los que son el mismo** escrito de otra forma;
  3. **el sistema te dice, antes de hacer nada, qué se va a mover**: cuántos proyectos de desarrollo,
     cuántas listas de precios y cuántas cotizaciones van a pasar al bueno;
  4. confirmas, y listo.

- **Todo lo que colgaba de los duplicados se va al bueno**, no se pierde nada. Los duplicados quedan
  **desactivados**, no borrados: siguen ahí por si algún día hay que mirar atrás.

### Qué cambió y puede sorprender

- ⚖️ **Si los dos departamentos tienen sus propios porcentajes de precio (margen, descuentos, regalías,
  costo de ventas), se quedan los del que conservas** y los del otro se descartan. Es a propósito: el
  departamento que sobrevive tiene que salir de la limpieza **con el mismo precio con el que entró** —
  sería malo que juntar dos nombres te cambiara los precios sin avisar. **El sistema te lo dice antes de
  apretar el botón**, y los porcentajes descartados **quedan anotados en la bitácora** por si hay que
  recuperarlos.

- **El sistema ya no revive un departamento apagado cuando llega otra OC con ese nombre.** Antes, si
  juntabas «2-HOMBRE» dentro de «Caballeros» y luego subías otra orden de compra de C&A que traía otra vez
  «2-HOMBRE», **el departamento volvía solo** y la limpieza se deshacía. Ya no. *Una limpieza no puede
  durar menos que la siguiente importación.* ⚠️ **Esto también aplica a un departamento que hayas
  apagado tú a mano**: ya no va a reaparecer solo porque una OC lo mencione. Es a propósito —si lo
  apagaste, fue por algo—; si lo quieres de vuelta, lo reactivas desde la ficha del cliente.

- **Si juntas VARIOS de golpe y más de uno tiene sus propios porcentajes, se queda el del primero que
  marcaste.** El sistema te lo dice departamento por departamento antes de confirmar.

- **Sólo se ofrece el botón cuando hay al menos dos departamentos activos** — si el cliente tiene uno
  solo, no hay nada que juntar.

- **Lo que se juntó no se deshace solo.** No hay un botón de «separarlos otra vez»: si te equivocas de
  departamento bueno, hay que rehacerlo a mano (queda todo anotado en la bitácora para saber qué se movió).

### Qué sigue pendiente o roto

- 🔴 **El importador de órdenes de compra sigue dando de alta departamentos nuevos a ciegas.** Si una OC
  trae un nombre que el sistema no conoce, lo crea sin preguntar — o sea, **el catálogo se puede volver a
  ensuciar**. Lo que quedó pendiente es lo que pediste: *que te pregunte y tú le confirmes*, y que
  **aprenda** que «2-HOMBRE» de C&A es tu «Caballeros». Es una etapa aparte, todavía sin construir. Por
  ahora, junta los duplicados cuando aparezcan.

- 🟠 **Buscar órdenes por la referencia de la OC sigue partido.** Cuando se importa una orden de compra, el
  texto de la División se guarda además **tal como venía en el papel** («2-HOMBRE») como dato de esa orden.
  Juntar departamentos arregla los proyectos, las listas y las cotizaciones, **pero no reescribe ese
  texto**: si buscas órdenes por esa referencia, vas a seguir viendo los dos nombres. **Es una decisión
  tuya y por eso no se tocó**: reescribir lo que decía el documento del cliente no es lo mismo que limpiar
  un catálogo. Cuando decidas, se hace.

- **Las cotizaciones ya impresas conservan el nombre del departamento que tenían el día que salieron.**
  Eso **no es un error**: una cotización de marzo no se reescribe porque en agosto hayas unificado dos
  nombres.

---

## 0.052 · 29-ago-2026 · **en prueba** — El alta de color también está en la pantalla de colores y precios

### Qué se puede hacer ahora que antes no

- ⭐⭐ **Dar de alta un color de tela desde «Ver todos los colores y precios de la orden N»**, sin
  cerrar ese cuadro. Es la misma opción que ya estaba en el renglón de la explosión desde la 0.025:
  la **última** del desplegable de color, **«＋ Nuevo color…»**, separada de los colores reales para
  que no se elija por error. Viene **precargada** con el color de la prenda de la orden y con el
  pantone que llegó de la OC del cliente; sólo confirmas o corriges, pones precio si lo sabes, y
  sigues.
- ⭐ **Y el color que acabas de dar de alta queda ELEGIDO en ese renglón**, sin buscarlo otra vez.
  Ésa era la mitad que importaba: sin eso, el alta sólo habría movido el trabajo de sitio.
- **Con la tela sin ningún color, ese cuadro ya te deja trabajar.** Antes, si la tela no tenía
  colores capturados, el cuadro no pintaba ni el renglón: sólo un aviso. Ahora pinta el renglón con
  su desplegable, y dentro del desplegable está la salida.

### Qué cambió y puede sorprender

- **El aviso amarillo de «esta tela todavía no tiene colores» ya no te manda a ningún lado.** En la
  0.025 se cambió el *"ve a Catálogos › Telas"* por un *"cierra este cuadro y usa el renglón"* —
  seguía obligando a salir, sólo que menos lejos. Ahora nombra la opción que está **ahí mismo,
  debajo**, y el aviso pasó de amarillo a gris: ya no es una advertencia, es una instrucción.
- **El permiso para dar de alta el color es el de administrar compras**, el mismo del renglón: quien
  compra da de alta el color que va a comprar aunque no administre el catálogo de telas. *(Y quien
  sólo puede VER compras no llega a este cuadro siquiera: se abre desde un botón que ya pide ese
  permiso.)*
- **Si la orden todavía no tiene capturada su matriz de color×talla, el cuadro te lo dice y NO ofrece
  el alta.** No es un castigo: sin colores de prenda no hay a qué amarrar el color de la tela, y dar
  de alta uno que nadie puede elegir sería llenar el catálogo por gusto. El mensaje dice dónde
  capturar la matriz (Producción › Órdenes).
- **En el ALMACÉN cambió un texto** (captura de entrada, traspaso, ajuste y salida de tela por
  color): si la tela no tiene colores capturados, ahora te dice **a dónde ir** en vez de dejarte
  parado. No se puede dar de alta ahí todavía — ver el pendiente de abajo.
- **Nada más cambió.** Los precios, el bloqueo por orden de compra autorizada y el atajo «Usar la
  propuesta» siguen exactamente igual.

### Qué sigue pendiente o roto

- ⬜ **En el ALMACÉN todavía no se puede dar de alta el color, pero ya te dice a dónde ir.** Al
  capturar una **entrada, traspaso, ajuste o salida de tela por color**, si la tela no tiene el color
  capturado, antes el desplegable decía *«Esta tela no tiene colores»* y **ahí se acababa**: sin alta
  y **sin decir a dónde**. Ahora te manda a *Catálogos › Telas* (o al renglón de la compra, si tú
  compras). **Falta el alta ahí mismo**, y ésa sí necesita tu palabra, Daniel: **¿quién puede dar de
  alta un color de tela desde el almacén?** Hoy el sistema sólo se lo permite a quien administra
  compras, y un almacenista que pulsara el botón recibiría un error. Dilo y se construye.
- ⚠️ Sigue pendiente lo de siempre: el tope de subida de archivos en Railway.

---

## 0.051 · 28-ago-2026 · **en prueba** — Queda escrito el plan de «un modelo, varios colores»

> **Aviso por delante: esta versión NO cambia nada del sistema.** Ninguna pantalla, ningún botón,
> ningún dato ni cálculo. Lo único que trae es **un documento**: el plan de cómo se va a construir lo
> que pediste el 28 de agosto —que de un modelo de desarrollo nazcan **varios** modelos de producción,
> uno por color/OC, **todos con la misma receta**—. Se escribió porque estaba sólo en la conversación,
> y lo que no queda escrito se pierde.

### Qué se puede hacer ahora que antes no

- **Nada nuevo en el sistema.** Y es a propósito: esta entrega es diseño, no construcción.
- Lo que sí hay es **una respuesta escrita, medida contra el programa**, a tu pregunta *«todos los
  modelos deben llevar lo mismo, ¿cómo lo controlas?»*: **no serán cuatro recetas iguales, será UNA
  sola receta que los cuatro comparten.** Con cuatro copias habría que *vigilar* que sigan iguales;
  con una sola, **no pueden dejar de serlo**.
- Y queda escrito, también, **cómo va a funcionar el botón que pediste** para corregir de un golpe las
  órdenes que dependen de un modelo cuando el modelo cambia: **corrige donde puede y te dice, orden por
  orden, dónde no pudo y por qué** —porque ya se compró ese material, o porque alguien la ajustó a
  mano—. Nunca se detiene todo por una sola orden, y **nunca se salta nada en silencio**.

### Qué cambió y puede sorprender

- 🔴 **Nada. Si notas cualquier diferencia en pantalla, es un defecto y hay que reportarlo**, porque
  esta entrega no tocó ni una línea del programa.
- El **número de versión** de la esquina pasa de 0.050 a 0.051. Ése es, literalmente, el único cambio
  visible.
- **No hace falta nada especial al desplegar**: no se movieron permisos ni datos.
- ⚠️ **Una cosa que sí conviene que sepas desde hoy**, porque saldrá al construirlo: cada orden se
  lleva **su propia copia** de la receta el día que nace. Así que dos órdenes creadas en fechas
  distintas pueden traer recetas distintas **aunque los cuatro modelos lleven exactamente lo mismo**.
  No es un defecto —es lo que protege lo que ya se compró—, y el botón de corregir en bloque es
  justamente el remedio.

### Qué sigue pendiente o roto

- ⏳ **Nos faltan 10 respuestas tuyas** para poder empezar a construirlo. Están todas en un solo lugar,
  cada una **con una propuesta ya redactada** para que sólo confirmes o corrijas. Dos de ellas mueven
  el tamaño del trabajo:
  - Cuando el botón corrija todas las órdenes de un golpe y una **ya se cortó**, la va a **dejar y
    te la va a listar**. Aparte te preguntamos otra cosa: hoy esa orden **sí se puede cambiar a
    mano**, de a una — **¿quieres que además se prohíba?** Si dices que sí, es trabajo aparte.
  - **Se van a acabar los números de 5 dígitos.** Cada modelo se lleva uno, así que se gastarán
    **tantas veces más rápido como colores tenga el modelo — en tu caso, 4**. El aviso y el brinco a
    la serie de continuación **ya están hechos** (con Caballero ya pasó y se abrió el 5). Lo que
    falta decidir es **qué segundo dígito le abrimos a Dama, Niño, Niña, Bebo y Beba**, que hoy no
    tienen ninguno.
- Mientras no contestes, **esto no avanza**: nada se construye a medias por adelantado.
- Lo demás que estaba pendiente **sigue igual**: esta entrega no adelanta ni retrasa nada de la lista.

---

## 0.050 · 28-ago-2026 · **en prueba** — Amarre interno: nada que se vea cambia

> **Aviso por delante: esta versión NO cambia nada de lo que tú usas.** Ninguna pantalla, ningún
> botón, ningún dato ni cálculo. Sube porque `prueba` se actualizó y la regla es que cada actualización lleve
> su número — no porque haya algo nuevo que probar.

### Qué se puede hacer ahora que antes no

- **Nada nuevo.** Y es a propósito.
- Lo único que cambió es **de puertas para adentro**: se le puso una red de seguridad a un aviso de la
  pantalla de compras que hoy funciona bien, para que **no se pueda descomponer sin que nos enteremos**.
  Concretamente el que explica **por qué un material se quedó fuera de una compra**: cuando algo ya está
  comprado y además se le quitó el proveedor, el sistema tiene que decir *«ya está en una orden de
  compra»* y **no** *«no hay a quién comprarle»* —que mandaría a buscar proveedor para algo ya
  comprado—. Eso ya se comportaba bien; lo que no había era quien lo vigilara.

### Qué cambió y puede sorprender

- 🔴 **Nada. Si notas cualquier diferencia en pantalla, es un defecto y hay que reportarlo**, porque
  esta entrega no tocó ni una línea del programa que decide qué se ve.
- El **número de versión** de la esquina pasa de 0.049 a 0.050. Ése es, literalmente, el único cambio
  visible.
- **No hace falta nada especial al desplegar**: no se movieron permisos ni datos.

### Qué sigue pendiente o roto

- **Nada nuevo queda abierto por esta entrega**, y se cerraron los dos pendientes que la revisión de la
  pantalla de compras había dejado anotados.
- Lo que estaba pendiente antes **sigue igual**: esto no adelanta ni retrasa nada de la lista.

---

## 0.049 · 28-ago-2026 · **en prueba** — El costo real de un modelo deja de verse sin autorización

> **Lo que pediste, en corto.** Te contamos que en la lista de Modelos hay una columna **«Costo»** que
> enseña **cuánto costó de verdad producir ese modelo la última vez** —no lo que se planeó, sino cómo
> terminamos— y que **Aurora la estaba viendo**. Preguntamos si dejarla o esconderla, y contestaste una
> palabra: *«Escóndesela.»*

### Qué se puede hacer ahora que antes no

- ⭐⭐ **La columna «Costo» de la lista de Modelos ya sólo la ve quien tiene acceso a Costos** — o sea
  tú y Dirección. Para los demás **la columna desaparece entera**: no queda ni el encabezado ni una
  rayita en su lugar. Antes la veía también quien lleva Desarrollo.
- ⭐ **Y no es que se esconda: el sistema ya ni siquiera manda el número.** Es la diferencia entre tapar
  algo con la mano y no ponerlo sobre la mesa. Quien no tiene el permiso no puede llegar a **ese número**
  por ningún otro camino, ni sabiendo dónde buscar.

### Qué cambió y puede sorprender

- 🔴 **Aurora deja de ver esa columna, y era lo que pediste.** Si alguna vez la estaba usando para
  algo, se va a quejar. **Cuando pase, se destapa lo que haga falta y se decide contigo** — con nombre
  y porque tú lo pidas. No se le va a devolver calladito.
- ✅ **Lo demás de su trabajo NO se tocó, y eso se midió antes de mover nada.** La salida "obvia" era
  quitarle el permiso de ver importes, y **eso le habría apagado el precosteo entero** —los costos
  estimados y los precios sugeridos con los que arma la cotización que tú apruebas— que es justo lo que
  dijiste que **sí** debe ver. Así que no se le quitó ningún permiso: la columna se colgó del permiso
  de **Costos**, que ella nunca tuvo. **Sigue viendo su precosteo, sus listas y sus recetas igual que
  ayer.**
- **La lista de Modelos se ve una pizca más ancha para quien no tiene el permiso**, porque esa columna
  ya no ocupa lugar. Todo lo demás —tela principal, tallas, stock, etapa, estado— sigue igual.

### Qué sigue pendiente o roto

- **Esto sólo tapa la columna de la lista de Modelos.** El módulo de **Costos**, los **márgenes** y el
  **estado de resultados** ya estaban cerrados para quien no debe verlos desde antes; no había nada que
  arreglar ahí y no se tocaron.
- ⚠️ **Este cambio NO requiere resembrar permisos al desplegar.** No se movió el reparto de roles: el
  candado se cambió en el programa, no en quién es quién. Es de las pocas veces que un cambio de este
  tipo no pide nada especial en el despliegue.
- ⚠️ **Ojo con lo que esto NO hace: sigue pudiendo ESTIMARLO a mano.** Lo que se escondió es **el número
  que el sistema calcula y guarda**. Aurora conserva otras pantallas de dinero que tú le diste a
  propósito —**precios de compra**, el **precio real de maquila** de la orden, pagos y cargos de
  maquileros, notas de salida y cuentas por pagar—, y con eso alguien aplicado **puede armarse una
  cuenta parecida en Excel**. No es un defecto: es justo lo que dijiste (*«puede hacer sus cálculos»*).
  Lo que ya no tiene es **el dato masticado**, que era lo que pediste esconder.
- **Nada de esas otras pantallas se revisó en esta entrega.** Sigue viendo saldos de proveedores, cuentas
  por pagar, compras y el precio real de maquila, como antes. Si alguna de ésas también te incomoda, es
  una decisión aparte y hay que platicarla.

---

## 0.048 · 28-ago-2026 · **en prueba** — Las prendas incompletas: se reciben, se ven, y no se pagan

> **Lo que pediste, en corto.** *"Tendríamos que tener una entrada adicional para prendas incompletas.
> A veces alguna pieza de la prenda no salió bien y no la cosen. Pero sí les pido que me traigan todo,
> porque los faltantes se los cobro… aunque son prendas inservibles, necesito que me las entreguen (eso
> no se va a ningún inventario… tampoco se pagan)."* Y el remate que define dónde tenían que verse:
> *"sólo quisiera ver reflejado en algún lado que sí las entrego, para revisar los temas de pago."*

### Qué se puede hacer ahora que antes no

- ⭐⭐ **Capturar las prendas incompletas al recibir la maquila.** En la captura del recibo hay un
  interruptor nuevo, **«Capturar prendas incompletas entregadas»**, que abre su propia tabla de colores
  y tallas. Ahí se anotan **aparte** de lo recibido bueno: si mandaste 10 y te traen 8 buenas y 2
  incompletas, tecleas 8 arriba y 2 abajo.
- ⭐⭐ **Verlas donde revisas el pago.** En el **estado de cuenta del maquilero** aparece una tarjeta
  nueva, *«Prendas incompletas entregadas»*, con la fecha, el recibo, la orden, el modelo y las piezas,
  y su total. Está **fuera de los cargos** y dice en su encabezado que no se pagan ni afectan el saldo.
  Sale igual en el **estado de cuenta desglosado**, en el **PDF** que le imprimes y en el **Excel**
  (una hoja propia, «Prendas incompletas»).
- ⭐ **Verlas también cuando validas el cargo.** En la cola de *Validación de cargos*, si el recibo trajo
  incompletas, sale un aviso en ámbar: *«En ese recibo entregó además 3 prenda(s) incompleta(s).
  Quedan registradas, pero no se pagan: no las sumes a la cantidad real.»* La cantidad propuesta y el
  importe **nunca** las incluyen.
- **Verlas en el reporte semanal de recibos por maquilero**, en una columna nueva, y en el **PDF del
  recibo**, en un renglón que aclara que no cuentan como producidas ni entran a inventario.
- **Registrar una entrega que sea SÓLO de incompletas.** Si el maquilero llega únicamente con las 3 que
  no pudo coser, se captura igual: no pide almacén (no entra nada a inventario) y **no genera cargo**.

### Qué cambió y puede sorprender

- 🔴 **Una prenda incompleta NO cuenta como producida.** Es lo que elegiste: de 100 mandadas con 95
  buenas y 5 incompletas, **la orden produjo 95**. No es una "tercera calidad": una segunda tiene
  defecto pero se vende más barata; una incompleta **no es una prenda**.
- 🔴 **El pendiente contra el maquilero NO se cierra con las incompletas — y eso es a propósito.** En el
  ejemplo de arriba, el avance sigue diciendo *"faltan 5"*, porque **ésas son las que le cobras**. Era
  justo el motivo por el que descartaste la otra opción que te propusimos.
- ⚠️ **Pero esas 5 ya no se pueden recibir como buenas después.** Ya salieron de su taller. El tope de la
  tabla de captura las descuenta y, cuando pasa, la pantalla lo explica: *«Este maquilero ya te entregó
  5 prenda(s) incompleta(s) de este proceso. Siguen contando como faltante suyo (por eso el pendiente
  no bajó), pero ya no se pueden recibir como buenas.»* Si fue un error de captura, **cancela el recibo
  y vuelve a capturarlo**: al cancelarlo las incompletas dejan de contar.
- **Las incompletas no se meten en el desglose de calidad.** Si intentas cuadrarlas como primeras o
  segundas, el sistema lo rechaza diciendo que tienen su propio campo. Primeras + segundas siguen
  sumando exactamente el total recibido.
- **La lista de maquileros ya no te ofrece a quien no te puede traer nada.** Si un maquilero te
  entregó todo lo suyo en incompletas, deja de aparecer en el desplegable de *«a quién le recibes»* —
  antes salía anunciando *«2 pza(s) por recibirle»*, lo elegías, y la tabla no te dejaba capturar
  nada. **Sigue debiéndote esas 2** (te las cobras), pero ya no hay nada que recibirle.
- **En la captura del recibo, la tabla ya no dice «pendiente».** Dice **«que se le puede recibir»**, y
  el mensajito de abajo, *«Cuadra con lo que todavía se le puede recibir»*. Son dos números distintos
  desde esta versión: arriba puede decir *«faltan 2»* (lo que le cobras) y la tabla estar cuadrada
  (ya no hay nada que te pueda traer). Llamar «pendiente» a los dos confundía.

### Qué sigue pendiente o roto

- 🔴 **El sistema NO le cobra solo el faltante al maquilero.** Explicaste *por qué* pides que te las
  entreguen (*"los faltantes se los cobro"*), pero no pediste que el programa haga ese cargo, y no se
  hizo. El sistema **registra y enseña**; el cobro lo sigues decidiendo tú. Si quieres que lo proponga
  automáticamente, es una pieza aparte.
- **No hay dato histórico.** El sistema viejo nunca tuvo el concepto, así que **todos los recibos
  anteriores salen con cero incompletas** — no porque no las hubiera, sino porque nadie las anotó. La
  cuenta empieza el día que uses esta versión.
- **El estado de cuenta segmentado por «con factura» / «sin factura» enseña las incompletas completas en
  los dos lados**, a propósito: no son dinero, no llevan factura y no pertenecen a ninguno de los dos.

---

## 0.047 · 28-ago-2026 · **en prueba** — Los modelos que creas SÍ aparecen, y todo modelo nace en desarrollo

> **Lo que reportaste, en corto.** *"Generé dos modelos en precosteo… y **no los veo en modelos**.
> ¿Dónde lo edito?"* Estaban guardados. La pantalla de Modelos **arrancaba enseñando sólo los de
> producción**, y todo lo que se crea desde Desarrollo es… de desarrollo. Un filtro que esconde lo que
> acabas de hacer no se lee como un filtro: se lee como que no se guardó.

### Qué se puede hacer ahora que antes no

- ⭐⭐ **Entrar a Modelos y ver TODO desde el primer momento.** La pantalla ya no arranca filtrada:
  aparecen los de producción y los de desarrollo juntos, y **cada renglón dice cuál es** en una columna
  nueva, **Etapa** (*Desarrollo* o *Producción*). El filtro de arriba sigue ahí para cuando quieras ver
  una sola cara.
- ⭐ **Lo mismo en la Galería de fotos**, que tenía exactamente el mismo problema: el modelo recién
  creado tampoco salía ahí. Ahora sale, y las tarjetas de los de desarrollo lo dicen.
- **Encontrar por el número viejo.** Un modelo que das de alta en el catálogo guarda el código que
  tecleaste como su **número de desarrollo**. Cuando después pase a producción y cambie a sus 5 dígitos,
  el número viejo **se conserva y se sigue pudiendo buscar**.

### Qué cambió y puede sorprender

- 🔴 **«Nuevo modelo» ya NO crea un modelo de producción: lo crea en DESARROLLO.** Es lo que pediste:
  *"siempre se va a empezar creando un modelo de desarrollo… el modelo de producción a la hora de dar de
  alta las órdenes"*. El número de producción (los 5 dígitos) **se le asigna al pasarlo a producción**,
  con el sistema proponiéndote el siguiente libre — no se teclea a mano en el alta. El diálogo lo dice
  arriba, y ahí mismo el campo de código aclara que es el número de desarrollo.
- 🔴 **El tipo de prenda y el género ahora son OBLIGATORIOS al dar de alta un modelo.** De esos dos
  datos salen los **dos primeros dígitos** de su número corto, así que sin ellos el sistema no le puede
  poner número — y, lo que de verdad importa: **no se le puede generar la orden de producción**. Antes
  eran opcionales y el problema aparecía tarde y mal: llegaba a reventar la importación de una OC
  completa. Ahora se piden de entrada, con su explicación al lado (*"primer dígito del número del
  modelo"* / *"segundo dígito"*). **Al EDITAR un modelo siguen siendo opcionales**, a propósito: los
  miles de modelos que vinieron del sistema viejo no traen género, y exigirlo te impediría corregirles
  cualquier otra cosa.
  > Esto se hizo sobre el **default que te propusimos** la noche del 28 de agosto y que no objetaste.
  > Si prefieres que sigan siendo opcionales, **dilo y se deshace** — son unos cuantos cambios en el
  > programa (están escritos uno por uno en `DECISIONES.md` §Post-F9.134), no algo que quede a medias.
- 🔴 **Al generar la OP, el modelo se pasa a producción Y CAMBIA DE CÓDIGO.** Es lo que pediste —*"el
  modelo de producción a la hora de dar de alta las órdenes"*—, pero conviene saberlo: el modelo que
  diste de alta como `ORD-1234` aparecerá a partir de esa OP como `71001` (o el número que le toque).
  **El código viejo no se pierde**: queda guardado como su número de desarrollo y **se sigue pudiendo
  buscar por él**. El aviso que sale al generar la OP te lo dice: *"modelo de producción 71001 (antes
  ORD-1234, que se conserva)"*.
- **Renombrar un modelo de desarrollo ahora arrastra también su número de desarrollo.** Antes se quedaba
  el viejo por dentro y el modelo terminaba con dos números buscables, uno de los cuales no se veía en
  ninguna pantalla.
- **La lista se hace más larga.** Es el precio, y se aceptó a propósito: **ver de más es mejor que no
  encontrar lo que acabas de hacer**.

### Qué sigue pendiente o roto

- 🔴 **De un modelo de desarrollo todavía NO pueden nacer varios de producción.** Lo que dijiste —*"de un
  modelo de desarrollo pueden nacer 4 modelos de producción y los 4 tendrían la misma receta"*— **no
  entra aquí**: hoy la relación sigue siendo uno a uno. Es una pieza aparte, con estructura por diseñar.
- **Los modelos históricos del Access siguen entrando como de producción**, con su código de 5 dígitos de
  siempre. Eso no cambió (ni debía): ésos ya son de producción y nunca pasaron por desarrollo.
- **A los modelos VIEJOS les puede faltar el género.** Los miles que vinieron del sistema anterior no
  lo traen, y ahí el sistema no te lo exige (si lo hiciera, no podrías ni corregirles el nombre). Lo
  que sí pasa es que **el día que quieras pasar uno de ésos a producción te lo va a pedir**, porque
  sin él no puede armarle el número.

---

## 0.046 · 28-ago-2026 · **en prueba** — Capturar el corte y el envío a maquila de un clic

> **Lo que pediste, en corto.** *"Sería muy bueno que tenga la opción de marcar el corte como completo
> (un botón que llene los campos de cada talla con las cantidades que se ordenaron) y otro de entrega a
> maquila con la información exacta de lo que se cortó."* Capturar un avance obligaba a teclear talla
> por talla lo que **casi siempre es exactamente lo esperado** — y el sistema ya sabía el número.

### Qué se puede hacer ahora que antes no

- ⭐⭐ **Llenar toda la tabla de tallas con UN CLIC, en el corte.** Arriba de la matriz, en la captura
  del corte, aparece **«Llenar con lo que falta por cortar»**, con el total que va a poner entre
  paréntesis: *«Llenar con lo que falta por cortar (1,726 pza)»*. Le das, y cada color y cada talla
  quedan llenos con **lo que falta por cortar de esa orden** — que en una orden que aún no se empieza
  a cortar es exactamente lo que pediste, y si ya capturaste un corte parcial es el resto (nunca
  vuelve a proponerte lo que ya cortaste).
- ⭐⭐ **Lo mismo en la entrega a maquila, con lo que de verdad se cortó:** **«Llenar con lo que se
  cortó»**. Va con lo **cortado**, no con lo ordenado — que no siempre es igual, porque cortar de más
  se permite.
- **El botón te dice el total ANTES de picarlo.** No hay que llenarlo para saber cuánto va a poner.

### Qué cambió y puede sorprender

- 🔴 **Los dos botones LLENAN, NO GUARDAN.** Ponen las cantidades en los campos y ahí se detienen: tú
  revisas, ajustas lo que haga falta y **después** das «Guardar movimiento», como siempre. Es un atajo
  para no teclear, **no** un botón que registre el corte por su cuenta. Debajo lo dice: *"No guarda
  nada: revisa y ajusta antes de Guardar."*
- ⚠️ **Reemplazan lo que ya hayas capturado; no lo suman.** Si ya habías tecleado cantidades, el botón
  las pisa. Es a propósito: si sumara, un segundo clic te **duplicaría** las piezas sin que te dieras
  cuenta y sin manera de deshacerlo. Así, picarlo dos veces deja lo mismo que picarlo una.
- ⚠️ **En el corte propone lo que FALTA, no lo ordenado a secas.** En una orden que no se ha empezado a
  cortar es exactamente lo mismo (lo que pediste). La diferencia sale cuando **ya capturaste un corte
  parcial**: ahí te propone **el resto**, no otra vez la orden completa — si no, estarías cortando
  doble.
- ⚠️ **En el envío te propone lo cortado MENOS lo que ya le mandaste a ese proceso.** Si de 100
  cortadas ya salieron 60, el botón pone **40**. Es la única cifra que el sistema aceptaría: mandar a
  maquila más de lo cortado está prohibido desde siempre, así que un botón que pusiera 100 te haría
  cosechar un error con la tabla ya llena.
- **En el corte nunca te propone números negativos.** Si en una talla ya se cortó de más, esa talla
  simplemente no se llena. Cortar de más se sigue pudiendo: se teclea a mano, como hasta ahora.
- **Cuando no hay nada que llenar, el botón se ve apagado y con el motivo al lado** — y la tabla sigue
  ahí para capturar a mano. Te va a decir alguna de estas cuatro: que la orden no trae desglose por
  color y talla, que ya está cortado todo lo que pide, que todavía no hay ningún corte capturado (y
  por eso no hay qué enviar), o que todo lo cortado ya se le envió a ese proceso.
- ⚠️ **Cuando mandas PRENDAS YA TERMINADAS a un proceso de arte, el botón sale apagado** y te dice
  por qué: *"Estas prendas salen del almacén de producto terminado y hay que respetar lo que hay en
  existencia."* Ahí el sistema pide dos cosas —que no mandes más de lo cortado **y** que el almacén de
  verdad las tenga— y el botón sólo sabe la primera: con 1,000 cortadas y 400 recibidas te ofrecería
  1,000 y al guardar te rebotaría. En ese caso, captura a mano.
- **Si a la orden le quitaste un color o una talla DESPUÉS de haberlos cortado, el botón no los
  propone.** Esa casilla ya no aparece en la pantalla y el sistema la descartaría al guardar: si la
  contara, el botón prometería 240 piezas y se guardarían 200.
- **En el recibo de maquila NO hay botón**, y es a propósito: ahí lo pendiente no es de la orden sino
  **de cada maquilero** —a quién le entregaste y cuánto te debe—, y eso ya te lo muestra la pantalla al
  elegirlo.
- **El botón no repite el número de la pantalla anterior.** Al revisar se encontró que, si venías del
  corte y abrías «Entrega a arte», el botón salía encendido con la cifra de *lo que falta por cortar*
  mientras el aviso de al lado te pedía elegir el proceso. Ya no: hasta que elijas el proceso, el botón
  está apagado y sólo se lee el aviso.
- **Nada nuevo en la base de datos** y ningún permiso nuevo: quien ya podía capturar avances, puede
  usar los botones.

### Qué sigue pendiente o roto

- **Marcar prendas incompletas** sigue sin existir: es otra pieza y está esperando tu decisión.
- **El botón no mira la existencia del almacén**, y por eso se apaga al mandar prendas ya terminadas
  (arriba). Que también sepa cuántas hay en el almacén queda pendiente.
- 🔴 **La pantalla de habilitación/surtido sigue enseñando el número inflado** de un renglón de avío que
  no hayas corregido (viene de la 0.045; se arregla con «Corregir» en la receta de la orden).
- **Cambiar las medidas por talla en un MODELO no avisa a las órdenes** que ya lo usan. Pendiente de
  antes, sigue abierto.
- ~~**La reparación en bloque de las órdenes con cierres inflados**, cuando la autorices (viene de la
  0.045). Hay un reporte que dice cuáles son y por cuánto se pasan.~~
  ✅ **Ya no aplica** — lo cancelaste tú el 28-ago-2026: *"lo viejo ahorita es irrelevante… vamos a
  importar de nuevo la información cuando vayamos a producción"*. **No hay que reparar nada de lo que
  ya está capturado**; la limpieza se hace **en la importación del arranque**, y ahí sí es obligatoria.
- **El desglose por pack está guardado pero NO se ve** en ninguna pantalla ni impreso (viene de la
  0.044); sale con el módulo de **empaque**. ~~Junto con la unificación de las órdenes viejas que
  nacieron con `Negro A`/`Negro B`.~~ ✅ **Esa unificación ya no se hace aquí**: se mudó a la
  importación del arranque (28-ago-2026).
- 🔴 **Sigue pendiente el paso manual del arranque:** saltar la serie de órdenes de compra a **10001** y
  correr la reparación de secuencias.
- **La lista de precios nueva no se arranca eligiendo un proyecto** (viene de la 0.043): se arma por
  cliente + departamento.
- Si le **cambias el color a una tela** después de haber cerrado su faltante en la explosión, el
  faltante vuelve a aparecer (viene de la 0.042; para el sistema es otro renglón).

---

## 0.045 · 27-ago-2026 · **en prueba** — El botón «Corregir»: los cierres inflados se arreglan de un clic

> **Lo que estaba pasando, en corto.** *"Me sigue poniendo 53 mil cierres por comprar (orden 5562)…
> siento que estamos atorados en lo mismo desde hace varias versiones."* No estaban atorados los
> cálculos: **se arreglaba la máquina y el papel viejo seguía diciendo lo mismo.** Cada orden guarda su
> propia receta —una **foto** del día que nació, y eso es a propósito: es lo que permite que dos
> clientes del mismo modelo lleven cosas distintas—. Arreglar cómo nacen las órdenes **nuevas** (que ya
> estaba arreglado desde el 18 de agosto) **no cambia las viejas**, y no debía cambiarlas solo: son
> datos de órdenes en curso. Faltaba **la manera de arreglar la orden vieja**… y la única que había era
> un mensaje que pedía *"guarda el renglón para normalizarlo"*. Eso no es una instrucción: es una
> adivinanza.

### Qué se puede hacer ahora que antes no

- ⭐⭐⭐ **Arreglar el cierre inflado con UN CLIC, ahí donde lo ves.** En la **receta de la orden**, el
  renglón del avío que pide de más ahora trae un botón **«Corregir»** pegado al aviso amarillo. Le das,
  y esa orden pasa a pedir lo que de verdad lleva. Antes el sistema **sabía** que estaba mal, **sabía**
  cuánto debería ser… y te pedía adivinar cómo arreglarlo.
- ⭐ **El aviso empieza por el número, no por la explicación.** Ahora lo primero que se lee es:
  > **«Esta orden pide 53,095 pza y deberían ser 3,200 pza: el requerido sale MULTIPLICADO por 16.6, son
  > 49,895 pza de MÁS.»**

  Y después viene el porqué y el remedio. Antes la cifra estaba enterrada en medio de dos renglones de
  explicación técnica.
- **La Explosión de materiales te dice a dónde ir, con el nombre del botón.** Si el aviso te sale ahí,
  el texto ya no dice «guárdalo»: dice que abras ese renglón en la receta de la orden y uses
  **«Corregir»**, y que vuelvas a explotar.

### Qué cambió y puede sorprender

- ⚠️ **Se corrige UNA ORDEN A LA VEZ. Las órdenes viejas NO se arreglan solas.** No hay —todavía— un
  botón que las repare todas de golpe, **y eso es a propósito**: sería tocar de un tirón los datos de
  muchas órdenes en curso, cambiando lo que compran, y **esa decisión es tuya**. Cuando la des, se
  construye. Mientras tanto: el que te estorbe, lo corriges desde su receta.
- ⚠️ **Corregir un renglón le tumba la firma de Desarrollo** (sólo a ese renglón, no a los demás). Es
  a propósito: cambia —y mucho— lo que se va a comprar, así que alguien tiene que volver a mirarlo.
  **Hay que volver a darle «Liberar»**, o ese avío no aparece en la explosión.
- 🔴 **Corregir arregla lo que la orden PIDE, no lo que ya se COMPRÓ.** Si de ese avío **ya hay una
  orden de compra autorizada** por la cantidad inflada —el caso de los 53 mil cierres—, el botón deja
  la receta bien y **la OC se queda exactamente como estaba**: nadie la toca ni te avisa. **Hay que ir
  a revisarla aparte** (Compras › Órdenes de compra) y decidir si se corrige o se cancela. El sistema
  sólo te frena en un caso extremo: si al corregir la orden pasara a pedir **cero** de un material que
  ya está comprado, ahí sí se niega y te dice qué capturar.
- **Sobre un renglón que ya quitaste de la orden, el aviso no te da cifras.** Tiene sentido: esa orden
  ya no pide nada de ese material. El botón sigue estando (por si lo devuelves algún día), pero no vas
  a leer un *"pide 53,095"* de algo que la orden no pide.
- **El botón NO aparece en todos los avisos.** Sólo en el de este problema concreto. Hay otro aviso
  parecido (*"ese número queda fuera de lo normal para esa unidad"*) que se arregla capturando bien, no
  con un botón, y ahí no sale.
- **No se borra nada.** Las cantidades por talla que estaban capturadas **se quedan guardadas**, sólo
  dejan de contar; el consumo por prenda, el precio y el proveedor del renglón no se tocan. Y queda
  anotado quién corrigió, cuándo, qué pedía antes y qué pide ahora.
- **El sistema sigue sin corregir nada por su cuenta.** Abrir la pantalla no cambia ningún dato: hace
  falta que una persona apriete el botón. Es la misma regla de siempre — nada se mueve en silencio.
- **Nada nuevo en la base de datos** y ningún permiso nuevo: quien ya podía editar la receta de una
  orden, puede corregirla.

### Qué sigue pendiente o roto

- 🔴 **La pantalla de habilitación/surtido sigue enseñando el número inflado** mientras no corrijas el
  renglón. Es el mismo dato visto desde otro lado; se arregla igual, corrigiendo en la receta.
- **Cambiar las medidas por talla en un MODELO no avisa a las órdenes** que ya lo usan (el aviso de *"el
  modelo cambió"* sólo mira el consumo y el precio). Pendiente de antes, sigue abierto.
- ~~**La reparación en bloque de todas las órdenes afectadas**, cuando la autorices. Hay un reporte que
  dice **cuáles** son y **por cuánto** se pasan, para poder decidirlo con números.~~
  ✅ **Ya no aplica** — lo cancelaste tú el 28-ago-2026 (*"no importan ahorita las órdenes que ya
  hay"*). **Lo capturado no se repara**; la limpieza se hace **en la importación del arranque**.
- **El desglose por pack está guardado pero NO se ve** en ninguna pantalla ni impreso (viene de la
  0.044); sale con el módulo de **empaque**, junto con el pack como campo propio que viaje al corte y a
  la maquila. ~~Y la unificación de las órdenes viejas que nacieron con `Negro A`/`Negro B`.~~
  ✅ **Esa unificación ya no se hace aquí**: se mudó a la importación del arranque (28-ago-2026).
- 🔴 **Sigue pendiente el paso manual del arranque:** saltar la serie de órdenes de compra a **10001** y
  correr la reparación de secuencias.
- **La lista de precios nueva no se arranca eligiendo un proyecto** (viene de la 0.043): se arma por
  cliente + departamento.
- Si le **cambias el color a una tela** después de haber cerrado su faltante en la explosión, el
  faltante vuelve a aparecer (viene de la 0.042; para el sistema es otro renglón).

---

## 0.044 · 27-ago-2026 · **en prueba** — «Negro A y Negro B es lo mismo»: los packs dejan de partirte las compras

### Qué se puede hacer ahora que antes no

- ⭐ **Ver UNA sola línea por color en la Explosión de materiales, no una por pack.** Era la queja:
  *"Ahora estás poniendo dos renglones por cada orden (Negro A y Negro B)… no tiene sentido separar las
  compras para cada renglón: veo demasiados registros."* Cuando C&A pide dos tendidos del mismo negro,
  el sistema ya **no** los trata como dos colores distintos: los **suma talla por talla** y la orden
  nace con **un solo renglón, «Negro»**. Las compras, el inventario y la recepción dejan de venir
  partidas.
  ⚠️ **Ojo, aplica a lo que importes DESDE ESTA VERSIÓN:** las órdenes que ya tenías siguen partidas
  en `Negro A`/`Negro B`, así que si entras hoy a la Explosión vas a seguir viendo así **las
  viejas**. Para comprobarlo, importa una OC nueva. (El porqué, abajo.)
- **Tu catálogo de colores deja de llenarse solo.** Cada orden de compra de C&A fabricaba colores
  nuevos —`NEGRO A`, `NEGRO B`, `NEGRO C`…— que no eran colores, eran empaques. Ya no nacen.
- **El desglose de packs sigue GUARDADO, en el campo que acordamos.** Cada pack, con su tipo, su
  número de packs y su corrida por talla, se guarda con la orden desde que se construyó el importador.
  Es el dato con el que se va a armar el **módulo de empaque**.
  ⚠️ **Pero hoy no se VE en ninguna pantalla ni papel.** Hasta ayer el desglose por pack se veía —eran
  renglones de la matriz, y salían en el impreso de la orden y en el de envío a maquila—; desde esta
  versión está guardado pero **nadie lo muestra todavía** (la pantalla que lo lea es parte del módulo de
  empaque). Si el taller tiende por pack, **hoy tiene que sacar esa información de la OC del cliente**,
  no del sistema. Y lo guardado son **las cantidades que pidió el cliente**, no las que se van a
  fabricar: el reparto del 7 % entre packs y los ajustes que hagas en la revisión previa **no quedan
  registrados pack por pack** en ningún lado.
- **La revisión previa del importador sigue mostrándote los packs por separado**, para que la puedas
  cotejar contra el papel de la OC — pero ahora dice lo que son: **«Pack A»**, **«Pack B»**. Y el
  renglón de abajo, el de los totales, te dice lo que de verdad va a quedar en la orden:
  **«A fabricar · Negro»**.

### Qué cambió y puede sorprender

- ⚠️ **Las órdenes que YA importaste conservan sus colores partidos** (`Negro A`, `Negro B`). El arreglo
  es **sólo de aquí en adelante**: las OC que importes desde esta versión salen con un solo color; las
  viejas se quedan como están. Juntarlas es un cambio que **no se puede deshacer** —toca matrices de
  órdenes vivas y cortes ya capturados— y no se hace sin que Daniel lo diga. Si eso estorba, se pide y
  se hace como pieza aparte.
- 🔴 **«Fusionar colores» ahora se NIEGA si el color ya se usa** (Catálogos › Colores). Era la
  tentación obvia —juntar `Negro A` y `Negro B` en `Negro`— y **habría hecho daño**: esa herramienta
  sólo reacomoda las **telas**, no las órdenes, los cortes, el inventario ni las compras. Habría
  apagado `Negro A` dejando todo eso apuntando a un color apagado, y las órdenes que lo usan ya no se
  podrían editar. Ahora el sistema lo **rechaza** y te dice **en qué está metido ese color** («está en
  uso en 3 órdenes de producción, 12 movimientos de inventario…»). Fusionar colores que **todavía no
  se usan** sigue funcionando igual que siempre. El diálogo ya lo advierte antes de que lo intentes.
- **El pack todavía no acompaña al corte ni al envío a maquila.** Antes, como el pack venía disfrazado
  de color, la matriz de la orden *de hecho* dejaba cortar pack por pack; ahora ya no. Es la mitad que
  falta del acuerdo del 6 de agosto (el pack como **campo propio**, obligatorio en corte y entrega,
  opcional al recibir) y está pendiente. El dato del pack sigue guardado con la orden esperándolo.
- **La importación de pedidos por EXCEL no cambió** en nada: nunca usó letras de pack.
- **Nada nuevo en la base de datos** y ningún permiso nuevo: es cómo se guarda lo que ya se importaba.

### Qué sigue pendiente o roto

- **El desglose por pack está guardado pero NO se ve.** Ninguna pantalla ni impreso lo muestra
  todavía; sale con el módulo de **empaque**. Mientras tanto, el taller que tienda por pack saca esa
  información de la OC del cliente.
- **El pack como campo propio** que viaje al corte y a la maquila (y sea opcional al recibir), más la
  **unificación de las órdenes viejas** que ya nacieron con `Negro A`/`Negro B`. Las dos cosas van
  juntas y van aparte. Mientras no exista, **fusionar esos colores está bloqueado a propósito**.
- 🔴 **Sigue pendiente el paso manual del arranque:** saltar la serie de órdenes de compra a **10001** y
  correr la reparación de secuencias.
- **La lista de precios nueva no se arranca eligiendo un proyecto** (viene de la 0.043): se arma por
  cliente + departamento. El camino al revés —«Generar lista de precios» desde dentro del proyecto— sí
  existe.
- Si le **cambias el color a una tela** después de haber cerrado su faltante en la explosión, el
  faltante vuelve a aparecer (viene de la 0.042; para el sistema es otro renglón).

---

## 0.043 · 27-ago-2026 · **en prueba** — Las cotizaciones, por fin, se encuentran (y te dicen qué les falta)

### Qué se puede hacer ahora que antes no

- ⭐ **Saber POR QUÉ no puedes armar una lista de precios.** Antes, al darle a «Nueva lista», el sistema
  te contestaba *"No hay desarrollos cotizados disponibles para este departamento"* y ahí te dejaba, sin
  decirte qué le faltaba a tus modelos ni a dónde ir. Ahora te los enseña **uno por uno, agrupados por lo
  que les falta**:
  > **Su precosto sigue en BORRADOR (1)**
  > · A-100 — v3 en borrador · proyecto #101
  > *Ábrelo en «Precosto» y usa «Congelar versión»: sólo una versión congelada se cotiza.*

  Y trae un botón **«Ir a Pre-costeos»** que te lleva a arreglarlo.
- **El que ya está en otra lista te dice EN CUÁL.** Sale con el número de la lista, para que la busques
  en vez de adivinar.
- **Encuentras «Listas de precios» donde la buscaste.** En el menú, bajo **Desarrollo**, esa opción se
  llamaba «Cotizaciones» — y bajo **Clientes**, la misma pantalla se llamaba «Listas de precios». Ahora
  **se llama igual en los dos lados: «Listas de precios»**.
- **Al congelar un precosto, el sistema te dice para qué sirvió:** *"Precosto v3 congelado: ya puede
  incluirse en una lista de precios (Desarrollo › Listas de precios)"*. Congelar era el paso que nadie
  te pedía y que sin él no podías seguir.
- **Si el sistema te rechaza un modelo al crear la lista, también te dice el remedio**: en vez de *"no
  tiene un precosto congelado"*, ahora dice *"su precosto v1 sigue en BORRADOR: congélalo («Precosto» →
  «Congelar versión»)"*.

### Qué cambió y puede sorprender

- **«Cotizaciones» ya no aparece como nombre en el menú lateral.** La pantalla es **la misma de siempre**
  y la palabra no se perdió: el título de la pantalla sigue diciendo *«Cotizaciones / Listas de precios»*,
  el buscador (⌘K) la encuentra escribiendo «cotizaciones», y **el documento que le mandas al cliente
  sigue llamándose cotización**. Lo que cambió es el rótulo del menú, para que la misma pantalla no
  tuviera dos nombres distintos según de dónde entraras.
- **«Pre-costeos» y «Listas de precios» son cosas distintas y ahora se distinguen.** En Pre-costeos armas
  el costo de cada modelo y lo **congelas**; en Listas de precios juntas esos modelos ya congelados, les
  aplicas los factores del cliente y apruebas precio por precio.
- **El motivo que sale bajo «Generar lista de precios» ya no adivina.** Antes decía cosas como *"los que
  ya están en una lista no se vuelven a incluir, y a los demás les falta congelar su precosto"* — una
  frase con «o» porque el sistema **no sabía cuál de las dos era**. Ahora dice los dos hechos por
  separado y con su cuenta: *"1 con el precosto en borrador · 1 ya en una lista"*.
- **La pantalla de Listas vacía distingue dos cosas**: *"todavía no hay ninguna lista"* (y te dice cómo
  nace una) de *"ninguna coincide con el filtro"*.
- **No se agregó nada al motor de cotización.** Todo lo de esta versión es **hacer visible y explicable
  lo que ya existía**: ni una capacidad nueva, ni un dato nuevo en la base.

### Qué sigue pendiente o roto

- ~~**Sigue sin poderse subir fotos** en `prueba` (configuración de Cloudflare, no del programa).~~
  ✅ **Ya no aplica** — quedó desbloqueado el 25-ago-2026 (confirmado por Daniel; era configuración de
  Cloudflare R2). Se arrastró aquí por copiar la lista de pendientes de la versión anterior; corregido
  al escribir la 0.044.
- 🔴 **Sigue pendiente el paso manual del arranque:** saltar la serie de órdenes de compra a **10001** y
  correr la reparación de secuencias.
- **La lista nueva NO se arranca eligiendo un proyecto.** Preguntaste si desde Cotizaciones *"jalabas un
  proyecto de precosteo"*: la lista se arma por **cliente + departamento** (a propósito: puede juntar
  modelos de varios proyectos). Si quieres además poder arrancarla desde un proyecto de la lista de
  proyectos, hoy ya existe el camino **al revés** —el botón «Generar lista de precios» dentro del
  proyecto—, y arrancar desde un selector de proyecto **no está hecho**: dilo y se hace.
- Si le **cambias el color a una tela** después de haber cerrado su faltante en la explosión, el faltante
  vuelve a aparecer (viene de la 0.042; para el sistema es otro renglón).

---

## 0.042 · 27-ago-2026 · **en prueba** — «Con esto queda cubierto»: dejar de perseguir el kilo que falta

### Qué se puede hacer ahora que antes no

- ⭐ **Decirle al sistema que un faltante chico YA NO TE LO PIDA.** Compraste 480 kilos de los 481 que
  pedía el cálculo, y no vas a hacer otra orden de compra por 1 kilo. Hasta hoy el sistema te lo seguía
  poniendo como pendiente **para siempre**. Ahora, **en el momento en que bajas la cantidad** en la
  pantalla de revisión previa, te pregunta qué significa:
  > Pediste **480** de los **481** que se necesitaban.
  > ○ El resto **sigue pendiente** (lo compro después)
  > ○ **Con esto queda cubierto** — no me lo vuelvas a pedir
- **Y también puedes cerrarlo después**, para los casos que ya se te escaparon — como el que originó
  esto, que ya estaba comprado. En la explosión, cada renglón trae un enlace
  **«Con esto queda cubierto»** que cierra lo que falte de ese material.
- **Y puedes deshacerlo.** Si resulta que sí lo necesitabas, el mismo renglón dice **«Volver a pedirlo»**
  y el faltante regresa tal cual.
- **El renglón cerrado se ve como lo que es.** Sale marcado *«Dado por cubierto: 1»*, y en la lista de lo
  que no entra en la compra dice quién lo cerró, cuánto, y cómo deshacerlo — en vez de mezclarse con
  *«ya está en una orden de compra»*, que te mandaría a cancelar una compra que está bien.

### Qué cambió y puede sorprender

- 🔴 **Nunca se cierra solo.** La opción que viene marcada es **«el resto sigue pendiente»**: si no
  contestas, el faltante se queda vivo, exactamente como hasta hoy. Cerrar un faltante es siempre una
  decisión tuya.
- **Te pregunta SIEMPRE que compras de menos, aunque sea por poquito.** No hay un porcentaje automático
  que decida por ti, y es a propósito: **1 kilo de 481 no es nada, pero 1 kilo de 5 es el 20 %**. Un solo
  porcentaje o te tapa faltantes de verdad o no te sirve para nada. Es un clic, y lo dices tú.
- **Se decide POR COLOR, no por material.** Si cierras el faltante del cierre rojo, los otros tres
  colores te los sigue pidiendo — que es lo correcto: son cuatro compras distintas.
- **Queda registrado**: quién lo dio por cubierto, cuándo, con qué cantidad compró y contra cuánto se
  necesitaba. Y deshacerlo **no borra ese registro**, le pone la fecha en que se deshizo.
- ⚠️ **Si CANCELAS la orden de compra, lo que diste por cubierto sigue cubierto.** El material vuelve a
  pedirse (la compra cancelada deja de contar) pero el pedacito que cerraste no regresa solo: si lo
  quieres de vuelta, usa **«volver a pedirlo»**.
- ⚠️ **El tablero «qué tengo / qué falta» NO cambia.** Ese tablero dice qué llegó **físicamente** al
  almacén, y dar por cubierto no hace que llegue material. Si compraste 4 de 5, ahí sigue diciendo que
  recibiste parcial — porque es la verdad.

### Qué sigue pendiente o roto

- ~~**Sigue sin poderse subir fotos** en `prueba` (configuración de Cloudflare, no del programa).~~
  ✅ **Ya no aplica** — quedó desbloqueado el 25-ago-2026 (confirmado por Daniel; era configuración de
  Cloudflare R2). Se arrastró aquí por copiar la lista de pendientes de la versión anterior; corregido
  al escribir la 0.044.
- 🔴 **Sigue pendiente el paso manual del arranque:** saltar la serie de órdenes de compra a **10001**
  y correr la reparación de secuencias. Lo traía la **0.041** y esta entrada lo había perdido — se
  repone, porque *quien lea la versión más nueva lo daría por hecho*.
- **El color del avío no tiene catálogo propio, y es a propósito** (lo decidiste tú): va como texto en
  la descripción, con el color de la prenda ya puesto y editable. **No es un pendiente.**
- Si le **cambias el color a una tela** después de haber cerrado su faltante, el faltante **vuelve a
  aparecer**. No es un error: para el sistema es otro renglón (otra tela-color), y es la misma regla con
  la que se compra por color desde agosto.

---

## 0.041 · 27-ago-2026 · **en prueba** — Te avisa cuando el costo de un precio quedó viejo

### Qué se puede hacer ahora que antes no

- ⭐ **Enterarte de que a un modelo le cambiaron la receta DESPUÉS de que le pusiste precio.** Hasta hoy
  el sistema se quedaba callado: tú aprobabas un precio calculado con un costo, alguien le cambiaba la
  tela, el avío o el arte al modelo, y **el precio seguía ahí como si nada** — sobre un costo que ya no
  era el de la prenda que se va a fabricar. Ahora, en la lista de precios, el renglón te lo dice con
  todas sus letras: **qué parte de la receta cambió, en qué fecha, y contra qué versión del costo**
  estaba calculado tu precio.
- **También te avisa antes de aprobar.** Si el costo ya quedó viejo y todavía no le pones precio, el
  renglón te lo advierte para que no firmes sobre un número que ya no vale.
- **Y te lo recuerda al mandar la cotización**, que es por donde ese precio saldría hacia el cliente.
- **El aviso se quita solo** en cuanto haces lo que pide: congelas una versión nueva del costo y la
  registras como ronda. No hay que apagarlo a mano.

### Qué cambió y puede sorprender

- 🔴 **Es un AVISO, no un candado.** El precio aprobado **no se cae**, y la cotización, el PDF y el
  Excel **siguen saliendo** igual. Fue lo que pediste — *"que me avise"* — y bloquear el papel mientras
  el costo esté viejo sería más de lo que decidiste. Si algún día quieres que además **impida** mandar
  el papel, se dice y se hace.
- **Sólo se enciende con cambios de RECETA**, no con cualquier cosa que se le toque al modelo. Si le
  corriges el nombre, le cambias una foto o le firmas la revisión, **no pasa nada** — a propósito: un
  aviso que salta por todo se vuelve ruido y se deja de mirar.
- ⚠️ **Empieza a contar desde hoy.** Si a un modelo le cambiaron la receta **antes** de esta versión, el
  sistema no lo puede saber (no había con qué registrarlo) y ese renglón **no avisará**. Avisará en
  cuanto vuelvan a tocarle la receta. No se inventó una fecha hacia atrás porque sería un dato falso.

### Qué sigue pendiente o roto

- **Sigue sin poderse subir fotos** en `prueba` (es configuración de Cloudflare R2, no código).
- Sigue pendiente el **paso manual** de saltar la serie de órdenes de compra a **10001**, y correr
  `reparar-secuencias.ts`.

---

## 0.040 · 27-ago-2026 · **en prueba** — Los cierres, por color y por medida

### Qué se puede hacer ahora que antes no

- ⭐ **Comprar el mismo avío en varios colores, y que cada color sea su propio renglón.** Es tu caso de
  las 4 variantes: el modelo se pide en 4 colores, salen 4 órdenes de producción, y ahora al comprar
  sale **una sola orden de compra con 4 renglones del cierre** —uno por color— en vez de un renglón
  fundido con la cantidad de todos. Vale igual para jaretas, cintas palmita y cualquier avío.
- ⭐ **El desglose de cantidad por medida, por fin.** Cada renglón dice, debajo, *"53 cm: 1,200 ·
  60 cm: 800"*. Sale de las tallas que pide el cliente en cada orden. Aparece en **tres sitios**: la
  explosión de materiales, la **revisión previa** antes de generar la OC, y el **impreso PDF que se le
  manda al proveedor**.
- **El color del avío se escribe en su descripción, y lo puedes corregir antes de generar.** El sistema
  propone el color de la prenda; si el avío va **en contraste** (cierre negro en prenda roja), lo
  cambias ahí mismo, en la misma pantalla donde ya corriges cantidad y precio.
- **Duplicar una orden de compra ya no pierde el color de la tela.** Era un hueco viejo: la copia salía
  "de la misma tela" pero sin decir el tono. Ahora arrastra el color (y también el del avío y su
  desglose).
- **Al recibir, cada renglón dice de qué color es.** Sin esto, una orden con los cuatro cierres se
  vería como cuatro renglones que dicen exactamente lo mismo, y quien recibe tendría que adivinar
  cuál es cuál.

### Qué cambió y puede sorprender

- **Una orden de compra que antes tenía un renglón de cierre ahora puede tener cuatro.** Es a propósito
  y es lo que pediste. **No se compra ni una pieza de más ni de menos**: la suma es exactamente la
  misma; lo que cambia es que ahora se puede pedir por color y quien recibe puede distinguirlos.
- 🔴 **Si el sistema no puede aplicar una cantidad o un precio que capturaste, ahora te lo dice y NO
  genera la orden de compra.** Antes se lo tragaba en silencio y compraba **lo que él había
  calculado**. Salió a la luz construyendo esto: al partir los renglones por color, las cantidades
  que el comprador había tecleado dejaron de encontrar su renglón, y el sistema **no decía nada** —
  tecleabas *"compra 0.1"* y se compraban **180**. Ahora se detiene y dice de qué material se trata.
  *No era un número mal calculado: era dinero saliendo con una cantidad que nadie aprobó.*
- ⚠️ **Y no pasa sólo con los cierres: pasa con TODOS los avíos.** Si el pedido lleva cuatro colores,
  también verás **cuatro renglones de hilo**, cuatro de botón y cuatro de etiqueta — aunque a ti el
  hilo te dé igual de qué color sea el pedido. Se hace así porque **el sistema no puede saber cuáles
  te importan**: adivinarlo sería volver a decidir por ti, que es justo lo que causó el problema del
  cierre. Las cantidades siguen cuadrando y el papel del proveedor **junta los que quedan iguales**,
  así que en la práctica lo verás sobre todo en la pantalla de la explosión.
- **El papel del proveedor agrupa por lo que él lee.** Si dos renglones internos acaban con el **mismo
  texto de color**, en el impreso salen como **uno solo** con la cantidad sumada — dos filas idénticas
  en un papel sólo confunden. Internamente el reparto por orden de producción sigue guardado igual.
- **Las órdenes de compra que ya existían no cambian**: siguen sin color y sin desglose, porque el
  sistema no dejaba decirlo cuando se hicieron. No se les inventa nada.
- **Si editas a mano la cantidad de un renglón en la orden de compra, se pierde su tablita de medidas.**
  Es deliberado: un desglose que sumara 30 en un renglón de 50 estaría mintiendo. Se recupera volviendo
  a generar la compra desde la explosión.

### Qué sigue pendiente o roto

- ⚠️ **Al recibir, el sistema sabe el color pero NO la medida.** Si el proveedor entrega la mitad, se
  recibe *"1,000 cierres rojos"*, no *"600 de 53 cm y 400 de 60"*. Es una decisión tomada, no un olvido:
  la medida es información **para el proveedor** y no se recibe por separado. El día que haga falta, se
  parte también por medida con el mismo mecanismo.
- **Los avíos siguen sin catálogo de colores** (como lo pediste): el color va como texto en la
  descripción del renglón, no como una lista que haya que mantener.
- **Sigue en pie el bloqueo de siempre:** no se pueden subir fotos en `prueba` (es configuración de
  Cloudflare, no del sistema).

---

## 0.039 · 26-ago-2026 · **en prueba** — El precio de venta es sólo tuyo

### Qué se puede hacer ahora que antes no

- ⭐ **Los cuatro porcentajes con los que se calcula el precio —margen, descuentos, regalías y costo de
  ventas— ya sólo los mueves tú.** Antes los podía cambiar cualquiera que administrara listas de
  precios, y eso incluye a Desarrollo y a Ventas.
- ⭐ **Y ya no los ve nadie más.** No aparecen en la lista de precios, ni en la ficha del cliente, ni en
  la calculadora de la mesa de negociación. Donde antes salía *"Cumple · obj. 44.4%"* ahora dice que el
  margen es facultad del dueño.
- ⭐ **De una lista sin aprobar ya no sale ningún papel.** Ni el PDF ni el Excel. Si intentas bajarlos,
  el sistema te dice **exactamente qué modelos** faltan por aprobar, y los dos botones aparecen
  apagados con el motivo escrito. La cotización ya lo hacía; ahora las tres salidas se comportan igual.

### Qué cambió y puede sorprender

- 🔴 **Lo más importante: si mueves un factor, las aprobaciones de esa lista se caen.** Todos los
  renglones que habías firmado vuelven a quedar pendientes. **No es un error, es el punto:** un precio
  aprobado con un margen del 50 % deja de ser cierto en cuanto el margen pasa a 60, y hasta ahora el
  sistema lo seguía enseñando como aprobado. **Se vuelven a aprobar con un clic**, como siempre.
- ✅ **Nada se pierde.** En el historial de negociación de cada renglón queda escrito qué precio tenía,
  **qué lo invalidó y de cuándo era la aprobación** que se cayó. Y en la bitácora queda quién la había
  firmado. Puedes reconstruir la historia completa.
- **Si guardas los mismos porcentajes sin cambiar nada, no pasa nada**: ninguna firma se cae.
- ⚠️ **Quien lleva Desarrollo va a notar dos cosas.** Ya no le aparece el panel de factores (ni en la
  lista ni en la ficha del cliente) y la calculadora de la mesa ya no le enseña el margen. **Sigue
  viendo el costo y el precio, y sigue capturando el precio que se acuerde** — que es lo que necesita
  para armar y mandar la cotización. Lo que se retiró es que el sistema le entregue el margen ya
  calculado.
- ⚠️ **Los factores de un cliente nuevo los tienes que capturar tú.** Sin ellos no se puede armar su
  lista de precios, y el mensaje ahora lo dice con esas palabras.
- **Esto no cambia ningún precio ya aprobado, ninguna cotización ya emitida ni ningún costo.** Sólo
  cambia **quién puede ver y mover** los porcentajes, y qué pasa cuando se mueven.

### Qué sigue pendiente o roto

- 🔴 **Falta el hermano de esto, y es la pregunta que hay que decidir: si cambias la RECETA de un modelo
  después de haber aprobado su precio, el precio aprobado se queda como está — y el sistema no avisa.**
  Hoy hay que congelar un costo nuevo y registrar una ronda **a mano**; si se olvida cualquiera de los
  dos pasos, el precio queda parado sobre un costo que ya no existe. **Está medido y no construido**
  porque es trabajo nuevo: hay dos formas de cerrarlo (una barata con falsas alarmas, otra exacta con un
  cambio chico en la base) y están escritas en la ficha de la etapa para que las elijas.
- ⚠️ **Una parte de las comprobaciones la hace el servidor de integración, no se pudo hacer aquí.**
  Lo que revisa la base de datos de verdad —que la firma se cae, que el PDF se niega— **está escrito y
  apunta justo a eso**, pero hasta que el servidor lo corra en verde no está confirmado.
- **Donde el precio es sólo una sugerencia interna, sigue apareciendo el calculado aunque no esté
  aprobado**: el precio que se propone al ligar una orden de producción y al armar un pedido. Es un
  número editable para uso interno, no un papel que salga al cliente — se dejó a propósito.

---

## 0.038 · 26-ago-2026 · **en prueba** — Los avíos se compran y se costean por metro, y se acabaron los factores

> 📌 **Por qué salta de la 0.036 a la 0.038.** La **0.037** está tomada por otra rama que iba delante
> (la aprobación que se cae si cambia la receta). El número se asigna **al entrar a `prueba`**, y dos
> ramas en paralelo lo toman en el orden en que llegan, no en el que se escriben. Se anota para que el
> hueco se lea como lo que es —dos cosas en vuelo a la vez— y no como una versión perdida.

### Qué se puede hacer ahora que antes no

- ⭐ **Comprar avíos con una sola unidad, la de siempre: el metro, la pieza, el kilo.** Es la misma
  unidad en la que Desarrollo costea y en la que la receta consume. Ya no hay que pensar en "esto lo
  compro por rollo pero lo gasto por metro" ni en cuántos metros trae el rollo: **se pide por metro**.
- ⭐ **Si necesitas decir cuántos rollos son, escríbelo en las observaciones de la orden de compra** o
  en la descripción del renglón. Es información para el proveedor y para quien recibe — el sistema no
  hace cuentas con ella, que es justo lo que se quería.

### Qué cambió y puede sorprender

- 🔴 **Lo importante: había una cuenta mal hecha escondida, y esto la quita de raíz.** El sistema
  guardaba un "factor de conversión" por avío (cuántos metros trae un rollo) y con él **multiplicaba
  la cantidad y dividía el precio** al recibir la mercancía. El problema es que la orden de compra ya
  venía en metros, así que **volvía a multiplicar**: un renglón de 2,160 piezas podía entrar al
  almacén como 311,040. 🔴 **Y el total en pesos salía correcto igual** —$4,320 en los dos casos—,
  que es exactamente por qué nadie lo notó nunca: el dinero cuadraba y el inventario mentía.
- ✅ **Nadie llegó a sufrirlo, y eso está comprobado, no supuesto.** Ese factor **nunca se pudo
  capturar** desde ninguna pantalla ni entró por ninguna carga de datos: siempre estuvo vacío, y con
  el campo vacío las dos formas de leer el número daban lo mismo. **No hay nada que corregir en los
  datos ya cargados, ni compras que revisar, ni inventario que recontar.**
- **En pantalla no vas a ver ninguna diferencia al elegir proveedor de un avío**, y está bien así: el
  sistema mandaba **dos veces el mismo número** (el precio del proveedor y "el precio por unidad de
  consumo", que eran idénticos porque el factor siempre estuvo vacío). Se quitó el duplicado **por
  dentro**. La pantalla siempre enseñó uno solo, y sigue enseñando ése.
- **La etiqueta de unidad del renglón sigue siendo libre** (puedes escribir "rollo" si quieres), pero
  ahora es **sólo una etiqueta**: no dispara ninguna conversión. Si escribes "rollo" y pones 50, el
  sistema entiende 50 de lo que la receta consume, no 50 rollos.
- **Nada de esto cambia precios, recetas, costos ni existencias.** Los números que ves hoy son los
  mismos que verás mañana.

### Qué sigue pendiente o roto

- ⚠️ **La comprobación final de la recepción la hace el servidor de integración, no se pudo hacer
  aquí.** La pieza que se arregló —recibir mercancía— sólo se puede probar contra una base de datos
  real, y esas pruebas corren en el servidor. **Están escritas y apuntan justo al defecto** (vigilan
  que la existencia quede en 2,160 y no en 311,040), pero **hasta que el servidor las corra en verde,
  esto no está confirmado.**
- **Los dos campos viejos siguen en la base de datos, vacíos y marcados como muertos.** No se borran
  porque en este sistema nada se destruye. Están documentados para que a nadie se le ocurra
  revivirlos: **si algún día hace falta comprar por presentación, no se resuelve con un factor.**
- **Los avíos "por medida" (el cierre por largo, el elástico por ancho) no cambian.** Ésos tienen
  varios precios, uno por medida, y se siguen costeando con el promedio de siempre. Es otra cosa.

---

## 0.037 · 26-ago-2026 · **en prueba** — Si cambias la receta después de firmarla, la firma se cae

### Qué se puede hacer ahora que antes no

**La aprobación ya está amarrada a lo que se aprobó.** Había un hueco que no viste porque nadie lo había
probado: Aurora revisaba una versión y la aprobaba; después alguien le cambiaba el consumo de una tela o
le movía el arte; y **la orden de producción salía con la firma vieja**, sobre una receta que ya no era la
que ella miró.

Era el mismo problema que la revisión viene a evitar, **entrando por otra puerta**. Tú lo dijiste así:
*"frente al cliente puede ser que se cometa una imprudencia"*. Esto era la imprudencia cometida **después**
de la firma — y peor, porque el sistema la presentaba como revisada.

**Ahora cualquier cambio a la receta de una versión aprobada la devuelve a pendiente**, y la nota dice
**qué la invalidó y cuándo**, más de cuándo era la firma que tumbó. Se vuelve a firmar normalmente.

### Qué cambió y puede sorprender

**Son SEIS puertas —seis maneras de tocar la receta—, no cuatro.** Al barrer aparecieron dos que no estaban en la lista: **los avíos
favoritos** —un botón que mete avíos directo a la receta sin pasar por la pantalla normal— y **las fotos
del arte**. Esta última importa: *la imagen ES lo que el bordador va a hacer*. Cambiarla cambia el
producto, así que cuenta como cambio de receta.

⭐ **Y no se parchearon las seis.** Había **tres copias** de la misma función repartidas por el código, y
cada mutación llamaba a la suya. Se unificaron en **una sola** que exige declarar qué parte de la receta se
toca. Resultado: **una puerta nueva no compila si no lo declara**. Ya no depende de que alguien se acuerde.

**La firma vieja no se borra.** Queda en la bitácora con quién la aprobó y cuándo, así que se puede
contestar *"Aurora la aprobó el 12, se le cambió la tela el 14, y volvió a firmarse el 15"*.

**Y un modelo descontinuado ya no se versiona**: hay que reactivarlo primero, como decidiste. Reactivar
cuesta un clic; lo que se evita es que revivir un modelo sea un efecto lateral de otra operación.

### Qué sigue pendiente o roto

⚠️ Sigue en pie **la tercera puerta a producción** que no pasa por la revisión, anotada desde la versión
anterior.

⚠️ Y siguen abiertas las dos preguntas de siempre: la versión **nace suelta**, sin entrar al proyecto del
original, y la lista de precios sigue apuntando al modelo padre.
## 0.036 · 26-ago-2026 · **en prueba** — El respaldo de la base no podía correr, y nadie se habría enterado

### Qué se puede hacer ahora que antes no

- ⭐ **Correr el respaldo de la base CUANDO QUIERAS**, sin esperar al día 1: un comando lo dispara y
  te dice en pantalla si funcionó, cuánto pesó y dónde quedó. Sirve para comprobar que el respaldo
  sirve, y también para respaldar a propósito **antes de algo delicado** — una carga masiva, una
  migración grande. Un respaldo de hace 29 días no consuela.
- ⭐ **Y un modo de sólo revisar**, que en dos segundos dice si el respaldo está bien configurado, sin
  respaldar nada.

### Qué cambió y puede sorprender

- 🔴 **Lo importante: hasta hoy el respaldo NO PODÍA correr, en ningún ambiente.** Railway actualizó
  su PostgreSQL a la versión 18 y la herramienta que hace la copia se había quedado en la 17. Esa
  herramienta **se niega a copiar una base más nueva que ella**, así que la corrida del 1 de
  septiembre habría fallado sin escribir un solo archivo. Ya está subida a la 18.
- ⚠️ **Nadie se habría enterado.** El respaldo avisa de sus fallas **en silencio**: las anota en una
  bitácora que hay que ir a mirar. De hecho había **otra falla anterior** —del 17 de agosto, por una
  llave que faltaba— que llevaba **una semana** anotada sin que nadie la viera. Esa ya estaba
  arreglada; ésta apareció al correr el respaldo a mano por primera vez.
- **Esto no toca los respaldos que hace Railway solo.** Ésos son diarios y siguen igual. El que
  estaba roto es el **segundo** respaldo, el que se guarda cifrado fuera de Railway — el que existe
  justo para el caso en que el problema *sea* Railway.
- **Nada de esto cambia pantallas, datos ni cálculos.** Es la maquinaria de abajo.

### Qué sigue pendiente o roto

- 🔴 **El aviso sigue siendo pasivo: no hay correo ni notificación.** Con corridas mensuales, una
  falla en enero se descubre en junio. **Mientras no exista aviso activo, revisar esa bitácora tiene
  que ser parte de la rutina mensual** — es exactamente lo que dejó pasar los dos fallos de arriba.
- ⬜ **Falta la prueba de fuego: restaurar un respaldo de verdad** a una base nueva. Que la copia se
  cree no prueba que se pueda recuperar; eso sólo se sabe restaurándola.
- **La base local y la de las pruebas automáticas siguen en la versión 17**, a propósito: la
  herramienta nueva las copia sin problema y subirlas no compraba nada.

---

## 0.035 · 26-ago-2026 · **en prueba** — Las fotos viejas de los modelos ya se pueden cargar en bloque

### Qué se puede hacer ahora que antes no

- ⭐ **Se pueden subir de golpe las miles de fotos de modelos que vienen del sistema viejo**, en vez
  de una por una desde la pantalla. La herramienta ya existía, pero era tan lenta contra una carpeta
  real que no servía; ahora lee la carpeta una sola vez y termina en minutos.
- ⭐ **Se puede ensayar antes de subir nada.** Un modo de prueba dice exactamente qué fotos se
  pondrían, cuáles no encontró y cuáles sobran — sin tocar el sistema. Si el resultado no convence,
  no pasó nada.
- **Se puede subir solo un puñado para probar**, en vez de las cinco mil de un jalón.
- **Ahora avisa qué fotos SOBRAN**: archivos que están en la carpeta y que ningún modelo pide. Antes
  solo decía qué le faltaba, nunca qué le sobraba — y ahí es donde se ve qué modelos son más nuevos
  que el respaldo del sistema viejo.

### Qué cambió y puede sorprender

- ⚠️ **Las fotos entran tal como las nombró el sistema viejo, sin corregir.** Hay modelos cuyo
  Access apunta a la foto de OTRO modelo — el 20274 apunta a la del 20247, el 20275 a la del 20248
  (dígitos volteados al capturar, hace años). Esas fotos van a aparecer "equivocadas" en el sistema
  nuevo: **no es la carga, es el dato viejo**. Se corrige subiendo la foto correcta a mano.
- **Si un mismo nombre de foto aparece dos veces** (el clásico `.jpg` y `.png` de la misma prenda),
  se queda con la que está en la carpeta principal y no con la de una subcarpeta, y lo deja anotado
  en el reporte. Antes el criterio era el alfabeto, que no quiere decir nada.
- **Las carpetas sueltas dentro del archivo de fotos ahora sí se leen.** Antes sus fotos se perdían
  en silencio.

### Qué sigue pendiente o roto

- **Todavía no se cargan todas.** De 4,987 modelos, 4,486 tienen su foto lista para subir (el 90%).
  Falta correr la carga completa; hasta ahora se corrió con 20 modelos — **y funcionó: las fotos ya
  se ven en la pantalla de los modelos** (verificado por Gabriel el 26-ago).
- **Hay 363 archivos que ningún modelo reclama.** Buena parte son modelos que Daniel fotografió
  DESPUÉS del último respaldo del sistema viejo, así que no hay a quién pegárselos hasta que se
  saque un respaldo nuevo. El resto es basura de años (copias "(2)", archivos de Mac, nombres con
  espacios de más).
- **Las fotos del arte todavía no se cargan** — es otra carpeta y otra corrida.
- **Decidido, no pendiente:** cuando la misma foto está guardada dos veces (`.bmp` y `.jpg`, o
  `.jpeg` y `.jpg`), gana la primera por orden alfabético. Se propuso ordenar por preferencia de
  formato y **Gabriel decidió dejarlo así**: son copias de la misma prenda, cuál gane no cambia lo
  que se ve, y cada caso queda listado en el reporte por si alguno sale mal.
## 0.034 · 26-ago-2026 · **en prueba** — Nadie manda a producir una versión que nadie revisó (y Aurora ya puede dar de alta modelos)

### Qué se puede hacer ahora que antes no

**Aurora ya puede dar de alta un modelo.** No podía, y era lo que la trababa: todo lo demás de Desarrollo
—proyectos, precosteo, listas, negociar, mandar cotizaciones— ya lo tenía, pero **crear el modelo es por
donde arranca todo eso**.

La causa era una clasificación equivocada: administrar modelos estaba en el mismo saco que el catálogo de
colores o de telas, bajo la regla de que los catálogos son de Dirección. Pero **un modelo no es un
catálogo**: una tela se da de alta una vez, un modelo es el **trabajo diario**.

**Y tu línea quedó intacta**, la que dijiste así: *"tiene que ver todo en la parte de desarrollo pero no
cómo terminamos"*. Ve los precios de telas, avíos y maquila en la receta, y el precosteo. **No** ve los
costos reales de la orden ya producida, ni los márgenes, ni el estado de resultados. Y **el precio sigue
siendo tuyo**: ella arma y manda la cotización, tú apruebas el precio de venta.

**Revisar y firmar una versión antes de que salga a producción.** Es la otra mitad de lo que pediste para
la negociación: *"después de la negociación con el cliente debe de haber una revisión antes de mandar a
producir, porque enfrente del cliente puede ser que se cometa una imprudencia o un error"*.

Una versión de modelo nace **pendiente**. Quien tenga el permiso de aprobar recetas —tú y Aurora— la
aprueba o la rechaza. **El rechazo pide motivo**, y ese motivo se ve después: es lo único que le sirve a
quien tiene que corregir. Queda firmado con quién y cuándo.

🔴 **Y el candado no está en el botón, está en el motor.** Hay **dos caminos** por los que un modelo pasa
a producción: el botón de «pasar a producción» y **generar una orden de producción, que lo promueve
solo**. Si el candado se hubiera puesto en el botón, una versión sin revisar entraba por la puerta
lateral. Está abajo, donde los dos caminos se juntan.

### Qué cambió y puede sorprender

⚠️ **Este despliegue cambia permisos.** Si no corre con la siembra activada, ni el botón de revisión ni el
alta de modelos de Aurora aparecen. **Es un interruptor, no código roto.**

**La revisión sólo aplica a las VERSIONES.** Un modelo de desarrollo normal y los ~5.000 que vinieron del
sistema anterior **no cambian en nada**: nunca tuvieron revisión que hacer.

**El botón de «pasar a producción» y el de generar la OP siguen visibles** aunque la versión no esté
firmada. Al pulsarlos te dicen que falta la revisión, en vez de esconderse. Un botón que desaparece no
enseña nada; uno que te explica sí.

**Del rechazo se sale firmando.** No es un estado muerto.

### Qué sigue pendiente o roto

⚠️ **Una cosa que ya veía y conviene que sepas, porque roza tu línea.** El listado de modelos tiene una
columna **«costo actual»**: el costo unitario del último costeo real de una orden de ese modelo. Eso es
*cómo terminamos*, no *lo que va a costar*, y **Aurora ya lo veía antes de este cambio** —no se lo abre
esta versión, viene de atrás—. **No se tocó**, porque quitarlo es decisión tuya y afecta también a Costos
y a Márgenes. Queda anotado para que lo decidas, no para que te enteres después.

⚠️ **Hay un TERCER camino que crea una orden de producción sin promover el modelo**, y ése no pasa por la
revisión. Hoy no tiene botón en ninguna pantalla y los importadores de pedidos no lo usan, así que no te
alcanza — pero está anotado con nombre, porque la frase cómoda «las dos puertas» es de las que engañan a
quien la lee después.

⚠️ **Falta que cambiar la receta después de firmarla invalide la firma.** Hoy alguien puede aprobar una
versión y luego moverle una tela, y la orden saldría con la firma vieja. **Todavía NO está en esta
versión ni en ninguna que se haya subido**: se está trabajando aparte y aún no se ha integrado, así que no
tiene fecha comprometida. Mientras tanto, si le mueves la receta a una versión ya firmada, **vuelve a
pedir la revisión a mano**.

⚠️ Y siguen abiertas las dos de siempre: la versión **nace suelta**, sin entrar al proyecto del original, y
la lista de precios sigue apuntando al modelo padre.

## 0.033 · 25-ago-2026 · **en prueba** — Los números de modelo de desarrollo ahora sí corren de corrido

### Qué se puede hacer ahora que antes no

Nada nuevo. Esta versión **termina** lo que la 0.028 dejó a medias.

### Qué cambió y puede sorprender

🔴 **El contador de modelos de desarrollo arranca donde de verdad va.** Lo reportaste tú: metiste dos
sudaderas y un jogger, y salieron **001, 002 y 008** en vez de tres números seguidos.

**El contador sí era por cliente y año** —eso la 0.028 lo hizo bien—. Lo que estaba mal es **de dónde
arrancaba**: para un cliente que ya tenía modelos, empezaba en **1**. Entonces contaba 1, 2, 3; el código
de sudadera estaba libre en números bajos y se los quedó, y el de jogger estaba ocupado hasta el 007, así
que fue saltando hasta el 008. El resultado se veía **idéntico al criterio viejo**.

**Ahora el contador arranca después del número más alto que ya exista para ese cliente y año.** Con tu
caso: **008, 009 y 010**.

⭐ **Y tu cliente se arregla solo.** No hace falta correr nada ni tocar la base: la regla es que **el
contador nunca retrocede, pero sí adelanta**, así que en tu próxima alta ya sale bien.

⚠️ **Los tres códigos que ya salieron (001, 002 y el 008) NO se renumeran.** Un código ya emitido es un
dato con el que la gente trabaja; corregirlo hacia atrás causaría más daño que el que arregla.

### Qué sigue pendiente o roto

**Esto salió de una decisión equivocada mía, y conviene que quede dicho.** Cuando se construyó la 0.028,
el revisor propuso exactamente este arreglo —arrancar del máximo— y yo elegí el otro camino, dejar que el
sistema fuera saltando los números ocupados. Lo descarté por parecer más simple, y **te dejé el síntoma
que acabas de reportar**. La nota que escribí entonces decía "vas a ver un salto la primera vez", como si
fuera cosmético. No lo era: rompía la regla que pediste.
## 0.032 · 25-ago-2026 · **en prueba** — Buscar un proveedor por cualquier palabra de su nombre

### Qué se puede hacer ahora que antes no

**Teclear cualquier palabra del nombre del proveedor y encontrarlo.** Lo reportaste tú: al dar de alta
una orden de compra, el proveedor sólo aparecía **si tecleabas el principio del nombre**. Escribir
*"norte"* no encontraba *"Telas del Norte"*.

**El servidor siempre buscó bien.** El problema era la pantalla: usaba el desplegable normal del
navegador, y ése sólo pega **por el principio de la palabra**. Ahora usa el buscador de verdad, el mismo
que ya usabas en otros lados.

### Qué cambió y puede sorprender

**No es una pantalla, son ONCE.** Ya habías pedido esto tres veces —se arregló en la receta del modelo,
en las pantallas de cliente y en el arte— y **las tres veces no viajó al resto**. Esta vez se barrió el
sistema entero: la orden de compra, la entrada de tela, las notas de salida, la consulta de auditorías,
el cortador del almacén, el corte semanal, los recibos y las existencias de maquilero.

**Los filtros también.** Donde filtras un listado por proveedor, la ✕ del buscador hace de «Todos».

**Dos sitios NO cambiaron, a propósito**: cuando la lista es de los proveedores **de ese avío** (una a
tres opciones que ya vienen con su precio) o los maquileros **de esa orden**. Ahí no hay catálogo que
buscar y un buscador sólo estorbaría.

⚠️ **Se cerró de paso un defecto que el propio cambio abría:** en la entrada de tela, el nombre del
proveedor no viajaba junto con su identificador cuando llegabas desde una orden de compra o desde un
CFDI. Como el buscador trae diez por página, **el campo se habría visto vacío y bloqueado** — que se lee
como "la pantalla perdió el dato".

**Y una mejora que salió sola:** en la entrada de tela, saber si el proveedor factura o da remisión se
resolvía buscándolo dentro de una lista de cien. Con un proveedor del final del alfabeto **ya fallaba**.
Ahora se sabe siempre.

### Qué sigue pendiente o roto

⚠️ **Dos pantallas cambiadas no tienen prueba propia** —la consulta de notas y las existencias de
maquilero— porque nunca la tuvieron. El cambio ahí está cubierto por el verificador de tipos y por el
barrido, no por una prueba de comportamiento. **Conviene mirarlas en vivo.**

**Contra la cuarta vez hay ahora un candado**: una prueba recorre el código y **falla sola** si alguien
vuelve a poner el desplegable viejo para elegir proveedor. Su límite, dicho claro: reconoce la lista por
el nombre de la variable, así que una llamada distinta se le escaparía. **Es una red, no una garantía** —
pero es lo que faltaba las tres veces anteriores, cuando la única defensa era una nota en un documento.
## 0.031 · 25-ago-2026 · **en prueba** — La fecha de entrega de la compra ya no se la inventa nadie

### Qué se puede hacer ahora que antes no

Nada nuevo. Esta versión **quita** algo que estaba mal.

### Qué cambió y puede sorprender

🔴 **La orden de compra ya NO toma la fecha de entrega de la orden de producción.** Lo reportaste tú:
generaste una compra de tela sin capturar fecha y el sistema le puso la de la orden del cliente.

Estaba mal de raíz, y no por un centímetro: **la fecha de la orden es cuándo le entregas al CLIENTE; la
de la compra es cuándo tiene que llegarte la TELA.** Igualarlas le pide al proveedor la materia prima el
mismo día en que tú tienes que entregar la prenda terminada — imposible por definición.

**Y lo grave no era que quedara vacía: era que quedaba LLENA con un número equivocado que se ve
legítimo.** Un campo vacío que te frena es honesto; uno lleno con la fecha incorrecta nadie lo revisa —
y ése es el dato con el que se le reclama al proveedor.

**Ahora se marca error y se pide la fecha.** Como pediste: *"no toma nada en automático de ningún lado"*.
Se captura arriba (vale para todas) o **una por proveedor** en su grupo de materiales, porque la tela no
llega el mismo día que los avíos.

**El mensaje también cambió, y era necesario.** El anterior te decía *"captúrala en la orden"* — y con la
regla nueva **eso ya no sirve de nada**. Un mensaje que te manda a hacer algo que no funciona es peor que
no tener mensaje. Ahora dice dónde se captura de verdad y por qué no se hereda.

⚠️ **Y se cerró un defecto que nadie había reportado**, del mismo tema: **la pantalla replicaba el mismo
respaldo que el servidor**, así que **se callaba** cuando las órdenes traían fecha. Con el servidor ya
rechazando, habrías visto una compra que parecía lista y reventaba al generarla — lo peor de los dos
mundos.

### Qué sigue pendiente o roto

⚠️ **Que el sistema PROPONGA la fecha calculándola hacia atrás sigue pendiente, y ahora se sabe de qué
depende.** Tú lo dijiste: *"para eso tenemos que tener muy avanzado todo… desde la Ruta Crítica"*. Y es
exacto: calcular hacia atrás desde la entrega **es literalmente lo que hace la Ruta Crítica**. Poner una
calculadora aparte en Compras sería una segunda planeación compitiendo con la buena.

⇒ Mientras la Ruta Crítica no opere, **capturar la fecha a mano es lo correcto**, no un parche. Un
cálculo automático apoyado en una planeación que nadie usa produciría el mismo tipo de dato falso que
esta versión viene a quitar.

---

## 0.030 · 25-ago-2026 · **en prueba** — Ya se le puede mandar una cotización al cliente

> ⚠️ Sale **junto con la 0.029** (el versionado de modelos), que entró justo antes. Si en pantalla ves
> **0.030**, traes las dos.

### Qué se puede hacer ahora que antes no

**Emitir la cotización y mandársela al cliente.** Hasta hoy el sistema sabía calcular el costo, aplicarle
tus factores y sacar el precio — pero ahí se acababa: **no había papel**. La negociación seguía viviendo
en la lista de precios y el documento que ve el cliente había que armarlo por fuera.

Ahora, desde la lista de precios, un botón emite la cotización. Sale **un documento con todos los
modelos de esa lista**, como pediste, con su folio, el cliente, el departamento, la fecha y un renglón
por modelo con su descripción y su precio. Se ve, se imprime y se descarga.

**Y lleva siempre todos los modelos, aunque sólo hayan cambiado algunos.** Si en la segunda vuelta se
movieron tres de cinco, la cotización nueva lleva los cinco. El cliente la lee sola, sin tener la
anterior al lado; mandarle nada más lo que cambió lo obligaría a reconstruir el paquete de memoria.

### Qué cambió y puede sorprender

**Una cotización no se edita. Nunca.** Si algo cambia, se emite otra. La vieja se puede **cancelar
poniéndole un motivo** —y entonces se imprime con una banda que lo dice— pero no desaparece ni se
modifica. Es un papel que ya salió: lo que se corrige se corrige con otro papel, no borrando el
anterior.

**Lo que dice el papel queda congelado el día que se emite.** El precio, el código y la descripción de
cada modelo se copian dentro de la cotización. Si mañana mueves el precio en la lista, la cotización de
hoy **sigue diciendo lo de hoy**. Es justo lo que hace que puedas contestar *"esto fue lo que le mandé
en marzo"* sin dudar.

🔴 **No te va a dejar emitir si algún modelo no tiene el precio aprobado.** Te dice cuáles faltan. Lo
decidí yo, no tú: mandarle al cliente un precio que no aprobaste es un compromiso que nadie firmó, y
fuiste claro en que el precio lo apruebas sólo tú. **Si te estorba —por ejemplo para mandar una
preliminar— se quita rápido.**

**Un modelo que ya se cotizó SÍ se puede quitar de la lista.** La primera versión de esto lo bloqueaba,
para no dejar la cotización "colgando". El reviewer demostró que el bloqueo sobraba: **el documento se
guarda entero por dentro** —nombre del cliente incluido—, así que se imprime igual aunque la lista
cambie o desaparezca. Quitarlo habría dejado modelos atrapados sin poder entrar nunca a otra lista, que
es justo un problema que ya habíamos arreglado antes.

**Y el nombre del cliente en la cotización también queda congelado.** Si algún día renombras a un
cliente, las cotizaciones viejas **siguen diciendo el nombre que tenían el día que salieron**.

### Qué sigue pendiente o roto

⚠️ **El envío por correo todavía no.** Quedamos en dos tiempos: primero el papel —verlo, imprimirlo,
descargarlo—, después el envío con su historial. Si se hacen juntos y el correo falla, no se sabe si
falló el documento o el envío.

⚠️ Y sigue faltando **la revisión antes de mandar a producir** — la otra mitad de lo que pediste para
la negociación.

---
## 0.029 · 25-ago-2026 · **en prueba** — Un modelo puede tener versiones sin dejar de ser él mismo

### Qué se puede hacer ahora que antes no

**Sacarle una VERSIÓN a un modelo sin tocar el original.** Es lo que pediste para la negociación: el
cliente quiere la sudadera más barata, en la mesa se acuerda quitarle el cierre, y en vez de editar el
modelo —que ya tiene historia de producción— **nace uno nuevo con un número pegado al final**:
`CYA-26-71-001` da `CYA-26-71-001-01`. El original **queda intacto**, con su receta y todo lo que se
fabricó con ella.

La versión nueva **hereda la receta completa** del original: telas, avíos con sus medidas por talla, y
arte. Nace lista para editarse, no en blanco. *(Las fotos no se duplican: viven aparte y no tiene
sentido tener dos copias del mismo archivo.)*

Si esa versión se vuelve a negociar y cambia otra vez, la siguiente es **`-02`**, nunca `-01-01`. Sin
anidar: en tres temporadas nadie sabría leer un `-01-02-01`.

**Quién puede hacerlo.** Se creó un permiso aparte, *aprobar receta*, que tienen Dirección y Gerencia
—o sea también Aurora—. 🔴 **Es distinto de aprobar precios, que sigue siendo sólo tuyo.** Se separaron
a propósito: si fueran el mismo permiso, Aurora acabaría aprobando precios sin que nadie lo hubiera
decidido.

**Y la abreviatura del cliente ya son 3 letras, siempre.** Es el `CYA` de `CYA-26-71-001`. Antes el
sistema aceptaba de 2 a 6 caracteres e incluso números, así que podían convivir `CY`, `MARILY` y `CY2` —
y con longitudes distintas los códigos dejan de alinearse, que era medio chiste de tener nomenclatura.

### Qué cambió y puede sorprender

🔴 **Un cliente viejo con abreviatura de 2 o de 6 letras ya no se deja guardar hasta corregirla.** Ni
siquiera para cambiarle el teléfono: al guardar, el sistema pide primero las 3 letras. El mensaje dice
exactamente qué falta. Deberían ser muy poquitos —el campo es reciente— pero si te topas con uno, ya
sabes qué es y se arregla en el momento.

**El botón «Crear versión» no aparece en los modelos viejos.** Los ~5,000 modelos que vinieron del
sistema anterior nacieron en producción y **nunca tuvieron número de desarrollo**, así que no hay de
dónde colgar el sufijo. En vez de enseñar un botón que iba a fallar, no se enseña. Versionar un modelo
de producción es otra conversación y no está resuelta todavía.

**El original no se entera de que tiene versiones**, y es a propósito: nada se jala solo. Si quieres
producir la versión nueva, la produces; el original sigue disponible igual que siempre.

### Qué sigue pendiente o roto

⚠️ **La versión nueva nace suelta.** No entra sola al proyecto del que salió el original, ni la lista de
precios se entera de que existe. Eso quedó **explícitamente por decidir** cuando cerramos el diseño, y
sigue abierto: hay que definir si el `-01` hereda el proyecto del padre y qué hace la lista de precios,
que hoy sigue apuntando al original.

⚠️ **Falta la otra mitad de lo que pediste: la REVISIÓN antes de mandar a producir.** Esta versión trae
el mecanismo de crear la versión; falta el paso de que alguien la revise y la apruebe formalmente —el
que evita que una imprudencia dicha frente al cliente llegue a producción sin que nadie la mire—. Es lo
siguiente.

⚠️ Y falta el **documento de cotización** en sí: hoy hay motor de cálculo y lista de precios, pero no el
papel que se le manda al cliente.

## 0.028 · 25-ago-2026 · **en prueba** — Los números de modelo de desarrollo corren de corrido

### Qué se puede hacer ahora que antes no

- ⭐ **El consecutivo del código de desarrollo ya corre por cliente y año**, sin importar la prenda. Como
  pediste: si el primero es `CYA-26-71-001`, el siguiente es `CYA-26-72-002` — no otro `001`.

### Qué cambió y puede sorprender

- ⚠️ **Los códigos que ya existen NO se renumeran.** Se quedan como están: renumerarlos rompería lo que
  ya anda en correos, cotizaciones y listas de precios de tus clientes. Vas a convivir un tiempo con
  códigos de los dos criterios, y **eso es correcto**.
- **Si un número le tocaba a un código que ya existe, el sistema se lo salta solo** y sigue por el
  siguiente libre. No hace falta hacer nada. Se lo salta **tantas veces como haga falta dentro del año
  de ese cliente**, así que en la práctica no lo vas a ver nunca. Y en el caso extremo de que se
  quedara sin números, **no se queda callado**: te dice que captures el código a mano y que avises —
  eso sí habría que arreglarlo por dentro.
- Los dos dígitos de tipo de prenda y género **siguen ahí** — describen la prenda, sólo que ya no mandan
  sobre el consecutivo.

### Qué sigue pendiente o roto

- **El sufijo `-01`** para las versiones que salen de una negociación, y **el documento de cotización**,
  siguen pendientes: son las dos piezas grandes de Desarrollo y van en camino.
- Sin cambios en lo demás.

---

## 0.027 · 25-ago-2026 · **en prueba** — El sistema le pone reglas al navegador

### Qué se puede hacer ahora que antes no

- ⭐ **El sistema ahora le exige al navegador que hable siempre por conexión cifrada.** Antes, un primer
  acceso podía irse sin cifrar y alguien en la misma red podía meterse en medio.
- ⭐ **Y le prohíbe a otras páginas mostrar CONTROL dentro de la suya.** Es el truco donde crees que le
  das clic a un botón y en realidad se lo estás dando a otro, dentro de tu sistema y con tu sesión
  abierta.
- **Estrena un vigilante** que avisa —**sin bloquear todavía**— si alguna pantalla intenta cargar algo de
  un lugar no previsto.

### Qué cambió y puede sorprender

- ⚠️ **Nada debería verse distinto.** Si algo se ve raro —una foto que no aparece, una pantalla en
  blanco— **avísame: es esto y se quita en un minuto.** Es lo único de esta tanda que no se pudo probar
  aquí: la configuración del servidor sólo se demuestra corriendo.
- **El vigilante NO bloquea nada** en esta versión. Está a propósito: primero mira y avisa, y cuando
  sepamos qué habría estorbado, se activa de verdad. Así no hay riesgo de una pantalla muerta el día del
  arranque.
- ⚠️ **Sus avisos hoy sólo se ven abriendo las herramientas del navegador (tecla F12).** Nadie los ve
  desde el servidor. Para dos personas alcanza, pero conviene saberlo: *"avisa"* hoy significa *"avisa a
  quien esté mirando ahí"*.
- **El servidor deja de anunciar su versión.** Detalle chico: era información gratis para quien quisiera
  buscarle un agujero conocido.

### Qué sigue pendiente o roto

- **Recoger los avisos del vigilante desde el servidor** (para no depender de que alguien tenga la
  consola abierta) queda para después del arranque.
- **Los impresos en PDF conviene mirarlos** el primer día en Chrome, Edge y Firefox: es donde este tipo
  de reglas suele estorbar, y por eso el vigilante todavía no bloquea.
- Sin cambios en lo demás.

---

## 0.026 · 25-ago-2026 · **en prueba** — Ya no te puedes cerrar la puerta solo

### Qué se puede hacer ahora que antes no

- 🔴 **El sistema ya no se puede quedar sin ningún administrador.** Antes, con quitarte tu propio rol de
  administrador te quedabas fuera **y sin manera de devolvértelo**. No estabas desactivado —eso ya
  estaba protegido—, simplemente perdías el permiso de administrar y ya no podías recuperarlo. Con un
  solo administrador, eso deja el sistema sin nadie que lo administre.
- ⭐ Y ahora protege **las cinco puertas**, no sólo ésa: quitarle el rol a otro que sea el último,
  desactivarlo, **bloquearlo**, vaciarle el permiso al rol desde la pantalla de Roles… y **teclear mal tu
  propia contraseña cinco veces**.
- 🔴 **Si eres el único administrador y te equivocas cinco veces de contraseña, ya NO te bloqueas.**
  Antes te bloqueabas solo, y ahí se acababa todo: un usuario bloqueado se queda sin permisos, la otra
  persona (Aurora, que es Gerencial) no puede desbloquearte porque eso lo hace un administrador, y
  volver a instalar el sistema tampoco te desbloquea. Se quedaba **cerrado por dentro** y sólo se abría
  metiendo mano a la base de datos. Ahora los intentos se siguen contando y se ven, pero la cuenta no se
  traba.
- ⭐ **Te avisa antes**, en el momento de desmarcar: te dice qué capacidad se pierde y qué hacer.

### Qué cambió y puede sorprender

- **El aviso no te bloquea el botón.** Te explica y te deja intentarlo; quien impide de verdad el cambio
  es el servidor. Es a propósito: un botón que desaparece sin decir por qué es peor que un mensaje
  claro.
- **Los mensajes ahora dicen la salida.** *«Primero nombra a otro administrador… y luego repite este
  cambio»*, en vez de sólo *«no se puede»*.
- ⚠️ **Sí puedes quitarte el rol si hay otro administrador vivo.** La protección no es sobre tu persona:
  es sobre que **quede al menos uno**. Con dos administradores, quitarle el rol a uno se permite.
- ⚠️ **El bloqueo por contraseña equivocada sigue funcionando para todos los demás**, y también para ti
  en cuanto haya otro administrador. La única excepción es *"eres el último que puede administrar"*.
  Que quede claro por qué se hizo así: la contraseña sigue haciendo falta —nadie entra sin ella— y el
  sistema sigue frenando los intentos seguidos desde afuera; lo que se quitó es la única pieza que podía
  dejar el ERP inservible con cinco tecleos mal dados. Además, **cualquiera que sepa tu usuario podía
  trabarte la cuenta a propósito** sin saber tu clave: eso ya no funciona contra el último
  administrador.
- **Si le das el permiso de administrar a otro rol (por ejemplo a Gerencial), ya no se te borra solo.**
  Antes, la próxima vez que se actualizara el sistema, ese permiso extra se le quitaba al rol —y si
  mientras tanto tú te habías quitado el tuyo, el sistema quedaba sin ningún administrador—. Ahora los
  permisos de administración que tú otorgues **se respetan**, y si aun así el sistema detecta que nadie
  puede administrar, lo **avisa a gritos** en el arranque.

### Qué sigue pendiente o roto

- ⚠️ **Quitarle el acceso a alguien NO lo saca en el acto.** Si esa persona ya está dentro, sus permisos
  le siguen valiendo **hasta que cierre sesión y vuelva a entrar**. Viene de antes y no lo cambia esta
  versión — pero si algún día hay que sacar a alguien de inmediato, hoy no basta con quitarle el rol.
- Sin cambios en lo demás.

---

## 0.025 · 25-ago-2026 · **en prueba** — Dar de alta el color de la tela sin salirte de la compra

### Qué se puede hacer ahora que antes no

- ⭐⭐ **Si el color que vas a comprar no está dado de alta, lo das de alta ahí mismo.** Hasta hoy, si la
  tela no tenía ese color en el catálogo, la pantalla te mandaba a Catálogos › Telas — y al volver
  habías perdido la explosión y las órdenes que llevabas elegidas. Ahora es **la última opción del
  desplegable «＋ Nuevo color…»**, igual que el alta de dirección.
- ⭐ **Y viene precargado con el pantone que trajiste de la orden del cliente**, más el nombre del color
  de la prenda. Confirmas o corriges, y sigues comprando. No hay que volver a teclear el pantone.
- ⭐ **La opción está ahí también cuando la tela no tiene NINGÚN color** — que es justo cuando más falta
  hace.
- **El color recién creado queda elegido**, sin tener que buscarlo otra vez.

### Qué cambió y puede sorprender

- **El precio del color se pide pero no se obliga.** Si lo sabes, captúralo; si no, sigues adelante. Ese
  precio es **informativo**: el costo real de la tela sale del lote que recibes, así que dejarlo vacío
  no descuadra nada.
- ⚠️ **Si tecleas un nombre de color que esa tela ya tiene, te lo dice y no lo crea.** No te devuelve el
  viejo en silencio: si lo hiciera, se perdería el precio y el pantone que acabas de escribir **y
  comprarías con otro precio** creyendo que se guardó. Elígelo de la lista, que ahí está.
- **Lo puede hacer quien compra**, no sólo quien administra el catálogo de telas. Es a propósito: si no,
  la función sólo habría servido para el dueño, y quien está comprando se habría quedado igual de
  parado. *(Si prefieres que sólo tú puedas crear colores, se cambia.)*
- **El campo del precio del cardigan sólo aparece si esa tela lleva complemento.** Antes no había manera
  de saberlo desde ahí.

### Qué sigue pendiente o roto

- Sin cambios en lo demás: la nomenclatura automática de modelos y las cotizaciones siguen pendientes
  (se planean el miércoles), y el detector de las órdenes con el cierre inflado está listo para correrse
  cuando digas.

---

## 0.024 · 24-ago-2026 · **en prueba** — El cierre ya no te pide 53 veces de más sin decírtelo

### Qué se puede hacer ahora que antes no

- ⭐⭐ **La explosión te avisa cuando un avío está pidiendo de más — y te dice CUÁNTO.** Tal cual:
  *"el requerido sale MULTIPLICADO por 53: 1,590 pza en vez de 30 pza: 1,560 pza de MÁS"*. Antes veías el
  número inflado y nada más: no había forma de saber que estaba mal, ni por qué.
- ⭐ **Y te lo dice también en la revisión previa**, la pantalla donde confirmas la compra. Era la que
  más falta hacía: es el último sitio antes de que el dinero se comprometa.
- ⭐ **Ya hay una lista de en qué órdenes está pasando.** No sirve de nada arreglar las dos que
  encontraste si hay más: ahora se puede sacar el listado completo, ordenado por cuánto se está
  pidiendo de más, diciendo además si ese avío **ya tiene orden de compra** (o sea, dónde ya salió el
  dinero).

### Qué cambió y puede sorprender

- **El aviso de la receta de la orden ya no está escondido.** Vivía dentro del cuadro desplegable: se
  podía tener el problema delante y no verlo nunca. Ahora sale en la fila, en amarillo, con cifras.
- ⭐ **Guardar el renglón ahora sí lo arregla, aunque sólo cambies el precio.** El aviso llevaba meses
  diciendo *"guarda para normalizarlo"* — y guardar el precio **no lo normalizaba**. Ahora sí.
- ⚠️ **Un caso raro pero posible:** si ese renglón tenía el consumo por prenda en cero y **ya hay una
  orden de compra** de ese avío, al guardar te va a frenar. **No es un error nuevo**: es la protección
  de siempre para que no saques de la compra algo ya pedido. Lo que cambia es que **ahora te dice la
  causa real y cómo salir** (capturar el consumo por prenda en el mismo guardado), en vez de mandarte a
  des-autorizar una orden de compra que está perfectamente bien.

### Qué sigue pendiente o roto

- 🔴 **Esto AVISA, no arregla solo.** Las órdenes que ya traen el problema siguen igual hasta que
  alguien entre a su receta y guarde el renglón. Se hizo así a propósito: reescribir en masa lo que
  compran órdenes que ya están corriendo es más peligroso que el problema. **La lista es el plan de
  trabajo.**
- 🔴 **La pantalla de habilitación/surtido enseña el mismo número inflado y ahí todavía no avisa.** Es
  el mismo arreglo en otro módulo; queda pendiente.
- 🔴 **Cambiar el modelo sigue sin marcar «desalineada» a una orden si lo que cambiaste son las medidas
  por talla.** El detector de desalineación sólo compara consumo por prenda y precio. Es hermano de
  este defecto y sigue abierto.
- El impreso de la explosión no lleva el aviso (hoy no imprime ninguno).

---

## 0.023 · 24-ago-2026 · **en prueba** — Los días de crédito de tus clientes por fin cuentan

### Qué se puede hacer ahora que antes no

- ⭐⭐ **La antigüedad de saldos de Cuentas por Cobrar por fin dice la verdad.** Hasta hoy el sistema
  trataba a **todos tus clientes como si te pagaran de contado**, aunque les tuvieras capturados sus
  días de crédito. Una factura a 30 días que llevaba 20 te aparecía como **vencida** cuando todavía
  estaba corriente. Ahora cada factura vence cuando le toca.
- ⭐ Y lo mismo vale para todo lo que nace de ahí: los reportes de cartera, las cubetas de vencimiento
  y lo que se ve en pantalla.

### Qué cambió y puede sorprender

- ⚠️ **Cambiarle los días de crédito a un cliente NO mueve sus facturas ya emitidas.** Cada factura se
  queda con el vencimiento que tenía el día que se capturó. Es a propósito, y es lo que pediste: si
  mañana le das 45 días a un cliente que tenía 30, eso vale **de ahí en adelante**, no hacia atrás.
- ⚠️ **Las facturas que YA estaban capturadas siguen con el vencimiento equivocado.** Se sellaron con
  el defecto encima y el sistema no las reescribe. Si alguna importa, hay que recapturarla.

### Qué sigue pendiente o roto

- 🔴🔴 **ESTO NO ARREGLA TUS DATOS POR SÍ SOLO, DANIEL.** La migración de clientes **nunca cargó los
  días de crédito**, así que **todos tus clientes migrados están en blanco = contado**. Con el catálogo
  vacío, el sistema arreglado te va a dar **exactamente la misma cartera falsa** que antes.
  **Hay que capturarle los días de crédito a cada cliente** (Catálogos › Clientes), y hacerlo **ANTES**
  de que carguemos los saldos de apertura de Finanzas. Si se cargan antes, la cartera de arranque nace
  mal y hay que rehacerla.
- **No se puede cambiar el plazo de UNA factura suelta.** Lo habíamos hablado, y no está construido: no
  hay dónde tocarle el vencimiento a una factura ya capturada. Queda **para después del arranque**,
  porque Finanzas no entra en la primera versión que sale a producción.
- **Ni Cuentas por Cobrar ni Cuentas por Pagar muestran el plazo en su pantalla de antigüedad.**
  Las dos lo usan para calcular —cada factura vence cuando le toca—, pero ninguna de las dos te
  enseña la columna de días de crédito. No es que calculen mal: es que el plazo no se ve.
- ⚠️ **Y para capturar, el catálogo de Clientes te lo deja a ciegas.** En **Proveedores**, los días de
  crédito se ven en la ficha del detalle, así que de un vistazo sabes a quién ya se los pusiste. En
  **Clientes** sólo aparecen **adentro del cuadro de edición**: hay que abrir cliente por cliente para
  saber cuáles te faltan. Justo ahora que hay que capturárselos a todos, eso estorba — queda anotado.

---

## 0.022 · 24-ago-2026 · **en prueba** — La fecha de entrega, a fuerzas; y el alta de dirección se metió al desplegable

### Qué se puede hacer ahora que antes no

- ⭐⭐ **Ya no se puede generar una orden de compra sin fecha de entrega.** Tal como lo pediste: *"tiene
  que tener fecha de entrega a fuerzas"*. Si intentas generar y alguna de las órdenes que iban a salir
  no tiene fecha, **se frena y te dice de cuál proveedor es** — y te deja el cursor en el campo donde
  se llena.
- ⭐ **Y te avisa de TODO lo que falta de una vez.** Si te faltan la fecha *y* la dirección, salen las
  dos juntas. Antes habrías arreglado una, dado otro clic, y encontrado el otro aviso esperándote.

### Qué cambió y puede sorprender

- 🔴 **Duplicar una orden de compra vieja que no tenga fecha ya no se deja.** Esto es lo que en realidad
  estaba roto: el alta manual y la explosión **ya exigían** la fecha, pero **duplicar la copiaba tal
  cual** — así que duplicar una de las **7,978 órdenes migradas** del sistema viejo que llegara sin
  fecha **paría una orden NUEVA sin fecha**. Ahora te manda a capturársela al original (Editar ›
  «Fecha de entrega») y volver a duplicarla.
  ⚠️ **Las órdenes viejas NO se tocaron**: se quedan como están. Lo que se cierra es que el hueco se
  propague a una nueva.
  ⚠️ **Y si esa orden vieja ya está autorizada, el mensaje te avisa que la corrección la tiene que
  hacer un administrador** — antes te mandaba a «Editar» sin decirte que ahí te iban a rebotar.
  Sigue siendo un rebote, pero ahora sabes a quién acudir.
  ⚠️ **Y si la orden vieja está CANCELADA, el mensaje ya no te manda a corregirla**: una orden
  cancelada no la modifica nadie —tampoco un administrador—, así que ahí te dice lo único que de
  verdad funciona: **levanta la compra a mano en Compras › Nueva orden de compra**, con su fecha.
- ⭐ **Ya no hay botón «＋ Dirección» suelto en la barra.** El alta se metió **dentro del desplegable
  «Entregar en»**, como última opción y separada del resto, tal como pediste (*"casi no se va a usar,
  no tiene caso tener un botón para eso"*). **Sigue estando ahí aunque no tengas ninguna dirección
  dada de alta** — que es justo cuando más se necesita.
- ⚠️ **Dejar «Entrega (inicial)» en blanco NO es un error por sí solo.** Si el proveedor ya lleva su
  propia fecha en su grupo de materiales, o si las órdenes de producción traen la suya, la orden de
  compra **ya tiene de dónde sacarla** y no se te reclama nada. Lo obligatorio es **que cada orden de
  compra salga con fecha**, no que llenes el campo de arriba.
- ⚠️ **El aviso de la pantalla puede pedirte una fecha que no hacía falta.** No puede adivinar el plan
  completo del servidor, así que se le pidió que se equivoque siempre del mismo lado: **preguntar de
  más antes que frenarte de menos**. Lo que **nunca** pasa es que se genere una orden de compra sin
  fecha: eso lo impide **el servidor**, con o sin aviso de por medio — si la pantalla se quedara
  callada, el bloqueo te sale igual en la revisión previa.

### Qué sigue pendiente o roto

- 🔴 **Los días de crédito siguen sin llegar a la cartera de clientes** — hoy la antigüedad de saldos
  (*aging*) de Cuentas por Cobrar **está mal calculada**. Es lo siguiente que se arregla, y **no puede
  salir a producción así**.
- **La medida del avío todavía no viaja a la orden de compra** (§Post-F9.100) y **«¿con esto queda
  cubierto?»** (§Post-F9.99) siguen pendientes: los dos quedaron **diferidos a después del arranque**.
- Sin cambios en lo demás que ya estaba pendiente: subir fotos en `prueba` (configuración de
  Cloudflare, no código) y los seis bloqueantes del arranque.

---

## 0.021 · 24-ago-2026 · **en prueba** — La orden de compra que ve el proveedor: una sola cantidad, sin tus números internos

### Qué se puede hacer ahora que antes no

- ⭐⭐ **El mismo material sale UNA sola vez, con todo junto.** Si estabas pidiendo el rojo para dos
  órdenes de producción, el proveedor veía **dos renglones** del mismo rojo. Ahora ve **uno solo con la
  suma**. Por dentro el sistema sigue repartiéndolo por orden —lo necesita para los costos—, pero eso
  es cosa tuya, no suya.
- ⭐ **Y ya no ve tus números de orden de producción.** Se quitó esa columna del papel.
- ⭐⭐ **El cardigan por fin aparece.** 🔴 **Esto era un defecto que nadie había reportado:** en una tela
  con complemento, el papel **nunca lo mencionaba** — pero **su importe sí estaba sumado** en el
  renglón. O sea que la cuenta no cuadraba a la vista (160 × $185 no daba el importe) **y el proveedor
  ni se enteraba de que también tenía que mandarte el cardigan.** Ahora sale colgado de su tela, con su
  cantidad y su precio, y con la suma escrita.
  ⚠️ **Dos precisiones, para no prometer de más:** el desglose **puede diferir del importe por un
  centavo** cuando se juntan dos renglones — es inevitable, porque **el total de la orden se respeta** y
  el centavo tiene que caer en algún lado *(tú mismo lo dijiste: "no importan los centavos así")*. Y en
  **las órdenes de compra que genera la explosión**, el cardigan **sigue sin aparecer**: nacen sin su
  cantidad capturada, así que **tampoco está cobrado** — el papel no se calla nada. En cuanto alguien
  capture esa cantidad, aparece solo.

### Qué cambió y puede sorprender

- 🔴 **Una orden de compra que no esté AUTORIZADA ya no se imprime.** Ni en borrador. Tal como pediste:
  *"para no generar confusiones con el proveedor"*. El botón desaparece y en su lugar te dice **por qué**
  (*"se imprime cuando la orden esté autorizada"*), y está bloqueado **también del lado del servidor** —
  esconder un botón no protege si alguien tiene la dirección a mano.
- ⚠️ **Efecto de lo anterior, dicho para que no te agarre en curva:** si acostumbrabas **imprimir el
  borrador para revisarlo en papel** antes de autorizar, eso ya no se puede. Para revisar están la
  pantalla de la orden y la **revisión previa**. *Si de verdad lo necesitas en papel, se resuelve de otra
  forma — pero no mandando a la calle un documento que todavía puede cambiar.*
- **La cancelada tampoco se imprime.** Una OC cancelada en manos del proveedor es la misma confusión al
  revés. *(Si prefieres conservarla para archivo, se revierte en una línea: la franja roja de "ORDEN DE
  COMPRA CANCELADA" se dejó viva a propósito.)*
- **Dos renglones del mismo material NO se juntan si tienen precios distintos.** Se dejan separados.
  Promediarlos sería inventar un precio que nadie autorizó.
- **El color sí se conserva como separador**: el rojo y el marino de la misma tela siguen siendo dos
  renglones, porque el proveedor necesita saber cuánto de cada tono.
- **El total de la orden no cambió.** Es la misma suma, acomodada distinto. Hay una prueba que lo vigila.

### Qué sigue pendiente o roto

- ⚠️ **Falta comprobar el tope de subida del servicio donde vive el sistema (Railway)** — sigue igual
  que en la 0.015.

---

## 0.020 · 23-ago-2026 · **en prueba** — La pantalla de compras ya no te recibe con un montón de avisos amarillos

### Qué se puede hacer ahora que antes no

- ⭐⭐ **Dar de alta una dirección de entrega sin salir de la pantalla.** Antes, si la orden no tenía a
  dónde entregarse, el sistema te frenaba y te mandaba al catálogo — o sea, te sacaba de lo que
  estabas haciendo. Ahora hay un **＋ Dirección** junto al campo, y la que capturas **queda elegida**.
- **El botón «Revisar y generar OC» ya no se apaga en silencio.** Si algo falta, te dice qué.
- ⭐⭐ **Con una sola dirección de entrega dada de alta, el sistema la usa sola.** Lo pediste hoy:
  *"el lugar de entrega en el 99% de las órdenes es el mismo… siempre dejarla fija"*. Ya existía el
  mecanismo —la dirección marcada como **favorita** se pone sola—, pero **si no hay ninguna marcada
  y sólo existe una**, pedirte que elijas "la favorita" entre una única opción no tenía sentido: ahora
  se usa directo. Con **dos o más y ninguna marcada**, el sistema **sigue preguntando** (ahí sí hay
  algo que decidir, y no lo inventa). *La forma de dejarla fija de verdad sigue siendo marcarla como
  favorita en el catálogo — con un clic —, y entonces manda ella.*

### Qué cambió y puede sorprender

- ⭐⭐ **Al abrir la pantalla ya no te recibe ningún aviso amarillo.** Es la regla que pediste,
  aplicada a los ocho avisos que quedaban: *"primero que dé la opción de meterlo, y si no se hace,
  entonces que mande los mensajes en amarillo"*. Lo que había arriba del primer renglón se repartió
  así:
  - **Tres no eran avisos, eran información**: *"N por comprar, selecciónalos"*, *"N ya están
    cubiertos por órdenes vivas"* y *"el BOM cambió, los renglones están marcados"*. Ahora son **una
    sola línea gris de resumen**.
  - **Dos hablaban de los materiales sin proveedor**, uno para cuando no se puede comprar nada y otro
    para cuando la compra sale **a medias**. Los dos salieron de la entrada —no son un error tuyo—,
    pero **el hecho no se perdió**: la línea gris dice *"N sin proveedor: NO entran en esta compra"*,
    también cuando es uno solo.
  - **Lo que tiene detalle** —lo que Desarrollo no ha liberado, la desalineación del modelo, las notas
    de precios— **bajó DEBAJO de la lista**, completo y sin color de alarma.
  - ⚠️ **Lo único con fondo cálido arriba de la lista** es el panel donde se **capturan** los
    proveedores de varios materiales de un jalón. No es un aviso: es un lugar donde se llena, que es
    justo lo que pediste que fuera primero.
- **Los avisos de verdad aparecen al pulsar «Revisar y generar OC»**, en la pantalla previa, y **sólo
  por lo que de verdad se queda fuera**. Si un material se libera después de explotar, se compra igual
  y el sistema **no te dice que no entra**, porque sí entra.
- ⚠️ **La dirección de entrega SIGUE BLOQUEANDO** (lo confirmaste hoy): no se genera una OC sin decir a
  dónde se entrega. Lo que cambió es **cuándo te lo dice**: al abrir es una nota gris junto a su campo,
  y sólo se pone amarilla **si intentas generar sin llenarla** — y ahí te lleva el cursor al campo.
  Y ahora son **dos mensajes distintos**, porque son dos problemas distintos: *"no hay ninguna
  dirección activa"* (→ dala de alta aquí) y *"hay N y ninguna marcada como favorita"* (→ elige a
  cuál va esta compra).
- **En la pantalla previa ya no se te acusa de algo que no podías hacer.** Un material sin proveedor
  tiene su casilla deshabilitada —no se puede marcar—, y sin embargo el sistema lo reportaba como
  *"No lo marcaste para esta compra"*. Ahora dice **la razón real** (*"no hay a quién comprarle"*).
  Ese *"no lo marcaste"* se le sigue diciendo, pero **sólo a lo que sí se podía marcar**.
- 🔴 **Una cosa que NO se fusionó, y es importante que se vean distintas:** *"el BOM cambió desde la
  última explosión"* y *"el modelo cambió DESPUÉS de esta orden"* parecen lo mismo y **no lo son**. El
  primero se arregla **volviendo a explotar**; el segundo **no** — hay que traer el cambio a mano desde
  la receta, y cuando la orden ya tiene compras **se pinta en rojo**, porque ahí hay dinero corriendo.

### Qué sigue pendiente o roto

- ⬜ **Desde aquí no se puede editar ni desactivar una dirección**, ni marcarla como favorita: para eso
  sigue el enlace al catálogo. Sólo se da de alta y se elige.
- ⚠️ **Falta comprobar el tope de subida del servicio donde vive el sistema (Railway)** — sigue igual
  que en la 0.015.

---

## 0.019 · 23-ago-2026 · **en prueba** — El color de la tela se dice en su renglón, no dentro de un regaño

### Qué se puede hacer ahora que antes no

- ⭐⭐ **Decir de qué color se compra una tela, ahí mismo en su renglón** de la explosión de
  materiales — igual que ya se hacía con el proveedor, a dos líneas de distancia en ese mismo
  renglón. Antes el ÚNICO camino era un enlace subrayado **dentro de un aviso amarillo**, que es
  donde nadie lo busca. La función existía desde la 0.013 y estaba escondida.
- ⭐ **Corregir un color ya dicho.** Antes era imposible de encontrar: en cuanto decías el color, el
  aviso amarillo desaparecía **y con él el botón**. Ahora la opción está siempre en el renglón.
- **Cuando una tela sirve a varias órdenes o va en varios colores de prenda, se listan todos**, cada
  uno con su orden y su color, para decir el suyo. El sistema **no adivina ni pone el mismo a todos
  por su cuenta**: eso sería escribir una suposición como si fuera un hecho.
- 🔴 **Y se destapa un hueco que nadie había reportado:** si una orden **no tiene capturada su matriz
  de colores y tallas**, hasta hoy la tela **se compraba sin color y el sistema no decía nada** — se
  lo tragaba callado. Ahora el renglón te dice que a esa orden le falta la matriz. *(No se ofrece un
  campo ahí porque el color de la tela cuelga del color de la prenda: sin matriz, el dato es
  imposible de guardar, no difícil. Un campo que no puede guardar nada sería peor que no tenerlo.)*

### Qué cambió y puede sorprender

- ⭐ **Los avisos amarillos ya no te reciben al abrir la pantalla.** Es la regla que pidió Daniel:
  *"el proceso normal es llenar ahí la información… primero que dé la opción de meterlo, y si no se
  hace, entonces que mande los mensajes en amarillo"*. El del color **se quitó de la entrada** —lo
  que falta lo dice el propio renglón con su etiqueta «Sin color»— y **reaparece en la revisión
  previa**, justo antes de generar la orden de compra, y sólo por lo que de verdad quedó sin llenar.
  ⚠️ **Avisa, no bloquea:** una tela sin color se sigue pudiendo comprar.
- ⚠️ **Por ahora sólo se movió el aviso del color.** Los otros ocho de esa pantalla siguen igual; su
  limpieza es la etapa que sigue, con esta misma regla.
- 🔴 **Si la orden de compra ya está AUTORIZADA, el color de esa tela ya no se cambia** — y el mensaje
  dice que el camino es **des-autorizarla** primero. Es la misma regla del 22 de agosto para no quitar
  de la receta lo ya comprado. Mientras la OC sea **borrador**, se cambia libre.
- **El bloqueo es por tela Y color, no por tela.** Si tienes una OC autorizada de «Felpa · Grana», el
  Grana queda cerrado pero **el Azul de esa misma tela se sigue capturando**. Bloquear la tela entera
  habría cerrado justo el camino que esta versión viene a abrir.
- **Las órdenes de compra viejas no bloquean nada.** Las casi 8,000 migradas no dicen de qué color
  eran; si bloquearan, ninguna orden histórica podría capturar sus colores nunca.
- **La pantalla completa de colores y precios de la orden sigue estando** (con la corrección de precio
  por color), ahora a un enlace desde el renglón.

### Qué sigue pendiente o roto

- ⬜ **No hay «aplicar el mismo color a todas».** Con ocho órdenes del mismo color, son ocho capturas.
  Se dejó fuera a propósito —que el sistema lo decida por su cuenta está prohibido—, pero **un botón
  que TÚ eliges** sí se vale: si lo pides, se agrega sin tocar nada de lo hecho.
- ⚠️ **Falta comprobar el tope de subida del servicio donde vive el sistema (Railway)** — sigue igual
  que en la 0.015.

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
