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
- **Una orden de compra en BORRADOR ya cuenta como "comprado"** para efectos de esta pantalla. Es lo que
  impide la compra duplicada (la OC que genera la explosión nace en borrador). Para el **costo** el
  criterio sigue siendo otro: ahí sólo cuentan las autorizadas y recibidas.
- **El impreso de la explosión sigue siendo de UNA orden.** Con varias OP en pantalla imprime la primera,
  y el botón lo avisa al pasar el ratón. Su columna **«A comprar» ahora trae lo que falta de verdad**
  (antes traía lo requerido a secas, así que un impreso hecho después de comprar pedía de más).

### Qué sigue pendiente o roto

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
