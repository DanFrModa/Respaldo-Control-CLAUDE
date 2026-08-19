# CONTROL v2 — Historial de versiones

> **Para qué es este archivo.** Saber **qué cambió y cuándo**, en lenguaje del negocio.
> Una entrada por **despliegue** —que es lo que se experimenta— y no por cada cambio de código.
>
> Lo demás vive en otro lado y con otro propósito: **`Documentacion_MJD/DECISIONES.md`** guarda *por qué*
> se decidió cada cosa, **`HOJA-DE-RUTA.md`** dice *qué sigue* y *qué quedó pendiente*, y las fichas de
> `docs/hoja-de-ruta/` tienen el detalle técnico de cada etapa.
>
> **Cada entrada trae tres cosas:** qué se puede hacer ahora que antes no · qué cambió y **puede
> sorprender** · qué sigue **pendiente o roto**. Lo más reciente arriba.

## Cómo se numeran

**`0.xxx`** mientras **nada esté en producción** (decisión de Daniel: *"empezamos mejor en 0.001, porque
es antes de producción"*). El **cero se ve a simple vista** y dice lo que hay que saber: esto todavía no
opera el negocio. `0.001`, `0.002`, `0.003`…

⚠️ **Se sube la versión CADA VEZ que se actualiza `prueba`** (regla de Daniel, 19-ago-2026), no cuando se
junta un lote. Cada merge a `prueba` = una entrada nueva aquí, aunque traiga una sola cosa. Así siempre se
puede decir qué versión se está mirando.

**El número es UNO SOLO y VIAJA.** Se asigna al entrar a **`prueba`** y **esa misma versión** es la que
después sube a producción — **no se re-numera**. Así se puede decir *"producción corre la 0.014, que es
exactamente la que probé el 18 de agosto"*, en vez de tener dos numeraciones paralelas que en tres meses
nadie sabe emparejar.

**El día del arranque:** la versión que salga a producción se **rebautiza `1.000`**, dejando escrito de
cuál `0.xxx` viene (*"1.000 — antes 0.014"*). De ahí en adelante, `1.001`, `1.002`… con la misma regla.

Cada entrada dice **dónde está**: `en prueba` mientras se verifica, `en producción` cuando sube.

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
  contestara *"la receta está vacía"* — y ese cartel era justo el que tapaba la salida. **La regla no
  cambió**: el sistema sigue sin dejar liberar una receta vacía. Lo que se quitó fue el botón que solo
  servía para chocar contra ella.
- **La columna «Acciones» ya no aparece vacía** para quien no puede firmar: se va con su encabezado.
- El bloque de la receta en el detalle de la orden ahora es **un resumen** con su botón a la pantalla.

### Notas

- ⚠️ **De dónde salió esta versión:** probando la anterior, Daniel no encontró cómo meter a una OP unos
  avíos agregados al modelo después. **El mecanismo estaba completo y funcionando** — el botón que lo
  resolvía estaba en pantalla, debajo de un mensaje más llamativo, y no se veía. *Una función que el
  usuario no encuentra no existe.*
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
  lee y **propone**: *"Reconocí una OC de C&A: 4 tallas, 1,744 piezas, 2 packs. ¿La cargo?"*. La persona
  confirma. Si no lo reconoce, **lo dice** y lo deja como adjunto; nunca se traga el archivo en silencio.
- **El 7% de sobre-pedido vuelve a operar.** La plantilla de C&A no existía, así que el sistema aplicaba
  **0%** y las OPs nacían con las cantidades exactas del cliente en vez de las que se fabrican. Ahora se
  siembra de fábrica, y sigue siendo editable.
- **El botón apagado dice qué le falta**, con el conteo: *"Falta ligar 3 de 4 renglones…"*. Antes se
  quedaba mudo, que es ofrecer una puerta sin explicar por qué no abre.
- 🔴 **Un parpadeo de red ya no te saca del sistema.** Antes, cualquier tropiezo de conexión —no una sesión
  cerrada: un corte, un servidor lento— te mandaba a la pantalla de login **perdiendo lo que estabas
  capturando**, porque el sistema no distinguía *"no hay sesión"* de *"no pude preguntar"*. Ahora te dice
  «no pudimos confirmar tu sesión — **no cerramos tu sesión**» y te deja reintentar.

### Qué cambió y puede sorprender

- En la explosión, **vaciar la fecha de un proveedor no la deja en blanco**: vuelve a seguir a la de
  arriba. Es a propósito —vacío significa *"la que pusiste arriba"*, no *"ninguna"*—, pero sorprende.
- El **porcentaje adicional** distingue ahora entre *"cero por ciento"* y *"usa el del cliente"*. El campo
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
  —que es *la puerta que abre la compra*— vivía dentro de la pantalla de modificar la OP. O sea: o
  Daniel firmaba todas las recetas del taller, o había que darle a Desarrollo permiso para cambiar
  cantidades, fechas y tallas nada más para aprobar una lista de materiales.
- ⭐ **Liberar POR PARTES.** *"Podría haber algún cierre que aún no autoriza el cliente, pero ya
  podríamos ir comprando lo demás."* Ahora se firma renglón por renglón, o por bloques («todas las
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

- **Firmar desde la bandeja se hace sin los renglones a la vista** (se ve *"3 avíos, 1 tela"*, no la
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
  estaba **inventado** — *un archivo inventado no prueba el lector: prueba a quien lo escribió*.

---

## 0.002 · 19-ago-2026 · **en prueba** — La versión, a la vista

### Qué se puede hacer ahora que antes no

- **Saber qué versión se está usando, sin preguntar.** Arriba a la izquierda, junto a «Control v2», aparece
  el número en chiquito: **`Control v2  0.002  › Modelos`**. Sirve para reportar: *"estoy viendo la 0.002 y
  me pasó esto"*, y que la respuesta sea sobre el sistema correcto.

### Qué cambió y puede sorprender

- Nada más. Es un cambio de una línea en pantalla; **ningún dato, ningún cálculo, ninguna pantalla se
  tocó**.

### Notas

- El número **no se puede quedar viejo**: si alguien sube la versión aquí y olvida cambiarla en pantalla
  —o al revés—, **el CI se pone rojo** y dice los dos números. *Una versión que miente en pantalla es peor
  que no tenerla.*
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
sus *medidas* por talla (un cierre de 53 cm, uno de 55), el sistema las leía como **cantidades**: entendía
*"54 cierres por prenda"* en vez de *"un cierre de 54 cm"*. Medido sobre un modelo real, el costo pasaba de
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
- **La medida y la cantidad dejaron de ser el mismo campo.** El elástico se captura por *cuánto gastas*
  (0.75 m, con decimales); el cierre por *qué pides* (53 cm, entero). La unidad de cada avío manda y se ve
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
