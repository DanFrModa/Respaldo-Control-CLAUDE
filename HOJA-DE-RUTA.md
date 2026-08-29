# CONTROL v2 — Hoja de ruta (plan por etapas + estado vivo)

> **Documento vivo.** Aquí está TODO el camino: las 11 fases divididas en **etapas** con su estado. La ley técnica es `PLANMAESTRO.md`; esto es el mapa y el tracker.
> **Para cualquier chat/sesión nueva:** lee `CLAUDE.md` → `PLANMAESTRO.md` → este archivo (la sección *¿Dónde vamos?*) → la **ficha completa de la fase activa** en `docs/hoja-de-ruta/` — y con eso sabes exactamente qué sigue y cómo ejecutarlo. No leas todas las fichas: solo la de la fase en curso.
> — *Actualizado: 28-ago-2026.*

---

## 1. ¿Dónde vamos? (estado vivo — actualizar al cerrar cada etapa)

> **AHORA (25-ago-2026): corre el track `V1 · Primera versión a producción`, en su tramo de DESARROLLO**
> (la nomenclatura de modelos, el versionado y las cotizaciones — §Post-F9.108/.109/.110/.112).
> ⚠️ **Las entradas de abajo van de MÁS NUEVA a más vieja: la primera es el estado real.** Lo que sigue
> de este párrafo es el relato de cómo nació el track y **no** dice qué está en curso.
>
> **El track V1 original** — la ficha es
> [`docs/hoja-de-ruta/V1-etapas.md`](hoja-de-ruta/V1-etapas.md) y **NO es una fase nueva** (F0–F10 no
> cambia): es el empujón de cierre que nació del repaso del flujo completo del 13-ago
> (`docs/DIAGNOSTICO-FLUJO-COMPLETO.md`) y las nueve decisiones de Daniel (`DECISIONES.md`
> §Post-F9.36/.37). Daniel: *"Ya quiero sacar la primera versión. Ya se fue mucho tiempo con esto."*
> **Estado:** `V1-E1` ✅ (los cuatro arreglos del precosteo, 13-ago) · `V1-E2` ✅ (destapar la cadena
> de compras ⭐, 13-ago) · `V1-E3d pieza A` ✅ (el arte deja el catálogo y se va al modelo, 14-ago,
> PR #179) · **`V1-E3c` ✅ (el editor de la receta del modelo, 15-ago)** — los seis comentarios que
> Daniel dejó usando el BOM en `prueba`; el amarre de precio de D13/R17, leído desde F7 y **nunca
> escrito**, por fin se captura; decisión **§Post-F9.47** (*la receta nunca enseña una cifra distinta
> de la que costea*) · **`V1-E3e` ✅ (⭐ un solo costo: manda el precio REAL de compra, 15-ago)** —
> nació de la revisión de E3c: convivían **tres cifras** para el mismo renglón y Daniel ordenó
> unificarlas (*"no hay ningún motivo para tener dos costos diferentes"*, §Post-F9.48/.49). **Cambió
> el motor de costeo**, con los precosteos congelados verificados intactos por construcción, guarda y
> prueba.
>
> · **`V1-E3d pieza B` ✅ (⭐ el BOM vive en la OP, 16-ago, PR #182)** — la receta se copia del modelo
> al crear la orden y ahí se congela: apagarle la jareta a un cliente ya no la apaga en las órdenes de
> los demás ni en las ya producidas. Tres rondas, 18 hallazgos · **`V1-E4` ✅ (las defensas contra el
> daño callado, 16-ago, PR #183)** — importar dos veces la misma OC ya no duplica todo en silencio; el
> renglón de lista de precios deja de quedar atrapado **para siempre**; «cancelar pedido» dejó de
> mentir. Con un **riesgo declarado abierto** (§4) · **`V1-E6a` ✅ (el respaldo mensual cifrado a R2,
> 17-ago)** — adelantado del resto de E6 por ser lo único que protege de algo sin vuelta atrás.
>
> ✅ **`V1-E4b` mergeada** (#185) y ✅ **`V1-E3f` mergeada** (#186, el catálogo único de procesos + el arte
> como Daniel lo usa). ✅ **`V1-E3g`** (cerrada el 16-ago; lo dejó dicho aquí como «en curso» y así se quedó hasta el 25-ago) · medida vs. consumo por talla — **salió de Daniel
> capturando un cierre**, no de un plan: dos ideas distintas vivían en el mismo campo (el elástico captura
> *cuánto gastas*, el cierre *qué pides*). Dos vueltas de revisión, las dos con hallazgos reales (la
> primera dejaba abierto **`copiarRecetaDelModelo`, por donde pasan todas las órdenes**).
>
> ✅ **`V1-E3g` mergeada** (#187) · ✅ **`V1-E6b` mergeada** (#188) · ✅ **`V1-E3f pieza B` mergeada** (#189)
> · ✅ **el historial de versiones mergeado** (#190: `HISTORIAL-DE-VERSIONES.md` en lenguaje de negocio, la
> versión junto a «Control v2» y el candado que impide que mienta — versiones **0.001–0.003**) · ✅
> **`V1-E3h` · la receta en la OP** (19-ago, **0.004**): verla y liberarla desde la OP y no desde
> «Modificar», **liberación por renglón** con la puerta pasando a *«se compra lo liberado»*, el comprador
> viendo qué falta, `traerDelModelo` y la **bandeja «Recetas por liberar»**. Dos bloqueantes en la primera
> vuelta —un **fixture que iba a dejar el CI en rojo** en 46 llamadas a la explosión, y **la bandeja sin
> poder liberar en su caso dominante**—, y otra vez el patrón de la tanda: *«8 mutaciones, 8 cazadas»* eran
> en realidad **4 de 8 sobreviviendo**, entre ellas la **mitad avío de la puerta de compra** — justo el caso
> que originó la decisión.
>
> ✅ **`V1-E3h` mergeada** (#191, **0.004**) · 🔨 **`V1-E3i` · la cadena de importar y comprar** (**0.005**):
> fecha de entrega **por OC** en la explosión · «Archivo de la OC» que **sí lee** el PDF y propone cargarlo ·
> la **plantilla de C&A sembrada con su 7%** (llevaba meses sin operar) · el botón mudo que ahora dice qué
> le falta · **el parpadeo de red que sacaba al usuario al login** · y un límite de tiempo en el paso de CI
> que se colgó dos veces esa noche. 🔴 Su hallazgo: **dos piezas de la misma etapa se cancelaban** — el
> arranque automático mandaba `0` de porcentaje desde una clausura vieja, y el cero explícito **le ganaba a
> la plantilla recién sembrada**, así que la OC de Daniel proponía 1,744 en vez de 1,866. ⚠️ **Sobrevivió
> porque el mock volvía el fallo imposible**: la plantilla devolvía `undefined` en todas las pruebas.
> **Exige `SEED_ON_START=true`** para que la plantilla se siembre.
>
> ✅ **`V1-E3m` · EL PROVEEDOR DEL MATERIAL** (20-ago): Daniel liberó toda la receta, fue a la explosión y
> *"no me deja hacer nada… ahí veo todo, pero no puedo avanzar"* — ningún renglón traía proveedor. 🔴 **No
> faltaba una función: había una DESVIACIÓN.** `Tela.idProveedor` (el proveedor DUEÑO) existía desde
> §Post-F9.11 con la regla escrita en su comentario, y el motor de compras la ignoraba porque F8 lo mandó a
> resolver por el amarre de `TelaProveedor`. Entrega: la tela resuelve por su **dueño**; el avío por su
> **proveedor HABITUAL** (bandera nueva, uno por avío, índice único parcial — el "más barato" de F4 queda de
> fallback); el comprador puede **asignar proveedor desde la explosión, solo para esa OP** (vive en la
> receta de la orden, **nunca en el catálogo**, y va en el ÚLTIMO escalón para que **jamás pise a
> Desarrollo**); y **el botón apagado dice qué le falta, con los nombres** —el mismo defecto que V1-E3i
> arregló en el importador—. Decisión **§Post-F9.82**. Migración **sin permisos nuevos y sin seed**; su único
> backfill marca habitual al avío que tiene **un solo** proveedor (ahí no hay nada que decidir).
>
> ✅ **`V1-E3i` mergeada** (#192, **0.005**) · ✅ **`V1-E3j` · la receta merece pantalla propia** (**0.006**) · ✅ **`V1-E3k` · la receta se firma UNO POR UNO** (**0.007**, 20-ago): se retiró la liberación en bloque —**y también del contrato**— porque *"no tiene sentido liberar las cosas sin ver"*; los botones **no los había pedido Daniel, los agregó el equipo**: salió de
> Daniel probando 0.005 en vivo y **el defecto no fue de lógica sino de VISIBILIDAD** — el mecanismo de
> §Post-F9.73 estaba cableado y verificado, pero el cartel *"la receta está vacía"* tapaba el botón que
> resolvía su problema, **justo debajo**. Entrega una pantalla completa (`desarrollo.ver`), el bloque de la
> OP como resumen, y la bandeja llevando al detalle. Cierra además un hueco de V1-E3h: **se podía FIRMAR una
> receta que no se podía LEER** (§Post-F9.78). **Tres vueltas** (dos rechazos): de los cinco hallazgos de la
> primera, **cuatro fueron pruebas que no probaban lo que decían** y el quinto un defecto de comportamiento
> contra §Post-F9.68 — ninguno en los dos cambios de backend, que resistieron las dos revisiones.
> ✅ **`V1-E3r` · CURVAS DE TALLA ⭐** (21-ago, **0.012**): Daniel, capturando el consumo por talla de un
> avío, *"me da la curva diferente a como la di de alta… me pone tallas de bebés"* — y él mismo corrigió el
> diagnóstico: *"creo que el error es mío… **mi información de pruebas es incongruente**. Pero entonces,
> ¿de dónde toma las tallas realmente?"*. 🔴 **El sistema no tenía un defecto de cálculo** —tomaba las
> tallas de la matriz de la ORDEN, que es de donde debe— sino uno peor: **dejó capturar dos curvas que se
> contradicen sin decir ni media palabra**, y desde afuera eso es indistinguible de un error. Tres piezas
> (§Post-F9.81, con §Post-F9.64 detrás): **(a)** el **AVISO de curva distinta**, con los **nombres de las
> dos curvas** y **qué tallas sobran o faltan en las dos direcciones**, en los tres lugares donde se ven
> juntas —la captura de medidas por talla del avío (donde lo encontró), la receta de la OP y la ficha del
> modelo—; 🔴 **avisa, JAMÁS bloquea** (*"que sí avise"*, no *"que no me deje"*) y **lo redacta el
> SERVIDOR**, para que las tres pantallas no acaben diciendo cosas distintas del mismo desajuste;
> **(b)** **jalar la curva de la OP** cuando el modelo no tiene — se **propone y la persona confirma**
> (asignarla escribe el catálogo y lo hereda todo lo posterior, D3), y **si varias OP usan curvas distintas
> se enseñan TODAS** con cuántas OP usa cada una: una regla de desempate inventada fallaría en silencio
> justo en el caso que originó la decisión; **(c)** ⭐ **el ORDEN de las tallas**, que valía **0 en las 94
> tallas migradas** porque el ETL llama a `crearTalla` sin `orden` — la matriz salía *CH, G, M, XG*. La
> escala **se MIDIÓ** sobre las **5,451** órdenes del volcado (161 combinaciones): **los números van antes
> que las letras** (15 combinaciones número→letra contra **1** al revés), **meses y años caen en la misma
> recta** convertidos a meses, y **`3X` es LETRA** —lo que la hace acertar en sus dos familias, 252 órdenes
> entre números y 17 entre letras—. Resultado: **98.7 %** de las órdenes reales quedan ordenadas.
> ⚠️ Es una **RECONSTRUCCIÓN**: la etapa se construyó una vez y se perdió entera con un reinicio del
> contenedor, pero **sobrevivió el veredicto del reviewer**, así que se rehízo **ya corregida** en sus
> siete defectos — y después pasó una **ronda de corrección** con cuatro hallazgos más: las cifras del
> volcado no se reproducían (ahora la medición **es un script**, `migracion/analisis/`
> `medicion-orden-de-tallas.ts`, y se re-corre en vez de re-citarse), **renombrar una talla no re-deducía
> su orden**, la prueba de *"el aviso no bloquea"* pasaba por la razón equivocada, y una curva
> **desactivada** hacía nacer una gemela «(2)». ⚠️ **Su deploy exige `SEED_ON_START=true`** (el seed repara
> el orden de las tallas ya cargadas; idempotente y sólo sobre el sentinela `orden = 0`).
>
> ✅ **`V1-E3q` · LA COMPRA DESDE LA EXPLOSIÓN ⭐** (20-ago): Daniel, probando en vivo, *"acabo de hacer
> unas OC desde la explosión… **me vuelvo a meter en la pantalla y sigue apareciendo ahí los elementos y me
> deja volver a hacerla**"*, y su petición, *"una **revisión previa** es indispensable"*. Tres piezas que
> van juntas (§Post-F9.85 y §Post-F9.86): **(a)** una **REVISIÓN PREVIA** antes de generar, que enseña las
> OC completas —proveedor, renglones, cantidades, **de qué OP es cada cantidad**, fecha e importe— y **lo
> que se va a omitir con su razón** (antes se descartaba en silencio); **(b)** 🔴 el defecto de fondo: la
> explosión **ya no propone comprar lo que ya está en una OC**. El cruce existía enterrado en el tablero
> R7 y se sacó a `comprometido-en-oc.ts`, **la única verdad** del sistema sobre *"cuánto ya compré"*, que
> ahora leen el tablero, la explosión, la previa y la generación. ⚖️ **Cuentan todas las OC menos la
> cancelada, y el `borrador` SÍ cuenta** —es el corazón del arreglo: la OC del MRP nace en borrador—; **NO
> es el criterio del costo** (§Post-F9.48, donde sólo cuentan autorizada/recibida), porque son preguntas
> distintas; **(c)** **una compra para VARIAS OP**: el conjunto se llena precargando las OP del pedido
> interno (*los avíos del 1515*) o agregando OP sueltas a mano (*las cajas*), **se ve junto y se guarda
> repartido** (una línea de OC por material×OP, innegociable de Daniel), con el **sobrante** repartido en
> proporción por el servidor y el stock de genéricos repartido entre las OP del lote. ⚠️ **Pasos manuales
> pendientes de Gabriel** (no son código): correr `reparar-secuencias.ts` para destapar las OC de folio
> bajo que Daniel ya generó, y después el salto de la serie de OC a **10001**. 🔴 **Rechazada por el
> reviewer en su primera versión y corregida (21-ago):** el reparto redondeaba a 4 decimales y la
> línea de OC guarda 2, así que **el defecto seguía vivo** (el renglón reaparecía con `0.002`, se
> encadenaban OC con líneas en `0.00` quemando folios, y la Σ no cerraba: la previa mentía). *La
> escala manda desde el destino.*
>
> ✅ **`V1-E8r` · LA COLA DE LA REVISIÓN: la compuerta deja de ser un muro ⭐⭐** (29-ago, **0.055**):
> §Post-F9.140. Daniel: *"despues de una negociacion, tiene que haber una validadcion de la receta
> original… de alguna manera deberia de pasar un filtro para ver lo que se negocio con el cliente. y
> como se cerro"*. 🔴 **Se midió antes de codear, y la premisa del encargo se SOSTUVO a medias:** la
> **compuerta ya existía** (`exigirRevisionAprobadaParaProducir`, V1-E7d — no se reconstruyó), pero
> **nadie podía listar la cola**, así que la revisión era un **muro al final del camino**: te topabas con
> ella al querer producir. ⇒ Se construyó **la cola**, con la forma que Daniel ya aprobó (la bandeja
> hermana «Recetas por liberar», de la que dijo *"está buenísima"*): `consultarRecetasPorRevisar` →
> `GET /api/recetas-por-revisar` (`modelos.ver`) → pantalla **«Recetas por revisar»** en el riel de
> Desarrollo. 🔴 **LA BANDEJA NO FIRMA: LLEVA** — cero botones que aprueben desde la lista (§Post-F9.80,
> *"no tiene sentido liberar las cosas sin ver"*); el renglón abre la **ficha del modelo**, que es donde
> vive la firma. ⭐ **El defecto que la medición evitó:** listar `revisionEstado = 'pendiente'` —lo
> obvio— habría dejado **bloqueadas e invisibles** dos poblaciones que el muro SÍ frena: las versiones
> con la columna en **NULL** (las anteriores a V1-E7d; su migración dice *"para ellas NULL se lee como
> `pendiente`"*) y las **rechazadas**. Se resolvió con **guardas gemelas**: `revisionBloqueaProduccion`
> (TS, lo que la compuerta pregunta antes de lanzar) + `SQL_REVISION_BLOQUEA_PRODUCCION` (SQL), vecinas
> en el mismo archivo y con una prueba que las corre sobre las **16 combinaciones** comparándolas fila
> por fila. 📋 **Orden y marca, medidos, no copiados:** una versión frenada **no puede tener OP** —
> generarla exige promover—, así que se ordena por la **fecha comprometida del PEDIDO** que está
> detenido detrás, y la marca de «ya frena dinero» es `conPedido` + las **piezas** detenidas (todo
> agregado en **UNA** consulta del servidor, jamás sumando en el cliente). ⚠️ **Lo que NO se pudo
> aplicar y no se fingió:** el criterio *"sólo las que se negociaron CON ESTIMADOS"* de la decisión
> depende de §Post-F9.139, que **no está construida** — ese dato **no existe**, así que la bandeja no
> lo inventa; lo que la mantiene CORTA es que sólo caen **VERSIONES** (los *"muchos modelos que sí se
> aceptan tal cual"* nunca generan una, y los ~4,987 del Access tampoco). ⇒ **SIN migración · SIN
> permiso nuevo · SIN seed · sin `SEED_ON_START`**. Detalle en `docs/hoja-de-ruta/V1-etapas.md` §V1-E8r.
>
> ✅ **`V1-E8q` · EL HILO DE LA NEGOCIACIÓN YA EXISTÍA — LE FALTABA EL AUTOR ⭐** (29-ago, **0.054**):
> §Post-F9.141. Daniel pidió *"meter comentarios para cada modelo… es en esta negociacion"*, para dejar
> escrito **el porqué de cada número** (*"cambio el precio de estampado por que le bajaron dos
> colores"*). 🔴 **Se midió antes de codear y la premisa era falsa:** el hilo **ya estaba construido**
> —`NegociacionEvento`, F8-E1/F8-E5— colgando del renglón de la lista (**cliente + modelo**), inmutable
> (barrido: **3 `create`, 0 destructivas, 0 SQL crudo**), con texto, fecha, autor y el cambio de precio
> cuando lo hay; y el comentario **sin** cambio de número también se podía. ⇒ **La decisión mandaba una
> migración aditiva para una tabla QUE YA EXISTÍA** — se corrigió esa prosa falsa en `DECISIONES.md` y
> aquí mismo. **Lo único que faltaba, y era real: el hilo no pintaba el AUTOR** (se leía el qué y el
> cuándo, nunca el quién) — y no bastaba con enseñar el campo, porque `registradoPorId` es un **id
> crudo** y la tabla **no tiene FK al usuario** (log inmutable, como `OrdenComentario`): el nombre se
> **resuelve en el servidor**, en bloque, patrón de `admin/bitacora.ts`. ⭐ **La puerta gemela que cazó
> el reviewer:** el hilo se pinta en **DOS** pantallas y la del **expediente de la orden** seguía
> escupiendo el cuid (`cm3x9k2q…`); peor, su prueba **no lo cazaba porque el fixture usaba `'daniel'`
> —con forma de nombre—**, así que el defecto pasaba verde. Ahora las dos pantallas comparten **UNA**
> función (`autorDeEvento`, `lib/formato`) y el fixture tiene **forma de cuid real**. *Un fixture que no
> se parece al mundo es una prueba que caduca sin avisar.* ⚖️ **«Sistema» sólo si NADIE lo escribió**:
> con id sin nombre resoluble dice **«Usuario dado de baja»**, porque llamarle Sistema **le atribuiría a
> la máquina lo que dijo una persona en una mesa**. ✅ **Y una buena noticia que estaba escondida:** la
> comparación **concepto por concepto** (*"¿por qué cambió el precio?"*) **ya se ve hoy** en el botón
> «Comparar» de cada ronda; lo que falta es sólo llevarla al **encabezado**, que se graba en el servidor.
> ⇒ **SIN migración · SIN permiso nuevo · SIN seed · sin `SEED_ON_START`**. Detalle en
> `docs/hoja-de-ruta/V1-etapas.md` §V1-E8q.
>
> ✅ **`V1-E8o` · LA PUERTA GEMELA DEL ALTA DE COLOR ⭐** (29-ago, **0.052**): V1-E6b abrió el alta de
> color de tela **desde el renglón** de la explosión, pero dejó **sin puerta** el otro camino por el que
> se llega al mismo hueco — la gemela quedó abierta hasta esta etapa. Detalle en
> `docs/hoja-de-ruta/V1-etapas.md` §V1-E8o.
>
> ✅ **`V1-E8p` · JUNTAR DEPARTAMENTOS DUPLICADOS ⭐⭐** (29-ago, **0.053**): §Post-F9.122(a). Daniel
> estaba **bloqueado**: *"los departamentos están revueltos… hay mujer, dama, caballero, hombre"* — y con
> el catálogo así **no podía armar una lista de precios**. La decisión estaba tomada desde el 25-ago y
> **nunca se había construido**. Ahora, desde la ficha del cliente, **«Juntar duplicados»**: se elige el
> que se queda, se marcan los que son el mismo escrito de otra forma, **se lee cuántos proyectos, listas
> y cotizaciones se van a mover**, y se confirma. ⚠️ **REPUNTA, no bloquea — al revés que la fusión de
> COLORES** (§Post-F9.129): allá `Color` tiene doce llaves entrantes y varias son movimientos ya
> asentados que no se pueden mover sin volverlos incoherentes; aquí las **cuatro** llaves del
> departamento son documentos vivos y editables, y arreglar a dónde apuntan **es** el trabajo — bloquear
> habría dejado a Daniel igual de atorado. ⚖️ **La decisión que había que tomar**: si el que se queda y el
> absorbido tienen **factores propios**, chocan contra `@@unique([idCliente, idClienteDepartamento])` y
> hay que elegir (la receta de los colores —rellenar huecos— **no traduce**: los cuatro porcentajes son
> obligatorios). **Ganan los del que SE QUEDA**, porque sus factores son parte de su identidad y que los
> pisaran significaría salir de la fusión con el mismo nombre y **otro precio**; los del absorbido quedan
> **escritos en la bitácora** antes de retirarse. 🔴 **Y una guarda que la fusión necesitaba:** el
> importador de OC **reactivaba** un departamento apagado que reapareciera en un PDF — o sea, la
> siguiente OC de C&A **deshacía la limpieza en silencio**; ahora lo reusa sin resucitarlo. ⭐ **La red
> contra la podredumbre**: una prueba **lee `prisma/schema.prisma`** y exige que la lista de tablas a
> repuntar cubra **todas** las llaves entrantes del departamento — una quinta tabla olvidada es un **rojo
> de CI**, no un dato huérfano descubierto meses después. **Lo que NO alcanza y queda con nombre en §4:**
> el texto crudo de la División guardado como referencia de la orden (`"2-HOMBRE"`, **indexado para
> búsqueda**) sigue partido — es la **quinta pieza**, y espera la palabra de Daniel. La **pieza (b)** de
> §Post-F9.122 (que el importador **pregunte y aprenda**) sigue pendiente, con etapa propia. ⇒ **SIN
> migración · SIN permiso nuevo · SIN seed · sin `SEED_ON_START`**. Detalle en
> `docs/hoja-de-ruta/V1-etapas.md` §V1-E8p.
>
> ✅ **`V1-E8n` · QUEDA ESCRITO EL PLAN DE «UN MODELO, VARIOS COLORES» (1:N)** (28-ago, **0.051**):
> etapa de **SÓLO DOCUMENTACIÓN** — **no tocó ni una línea de código** (ni backend, ni frontend, ni
> migración, ni contrato). El plan de **§Post-F9.135** se había diseñado en sesión y vivía **sólo en el
> chat**; se escribió porque *lo que no está en el repo no existe*. Vive **entero** en
> `Documentacion_MJD/DECISIONES.md` §Post-F9.135, sección **«⭐ EL PLAN»**, y aquí **no se copia a
> propósito** (una copia deriva). Lo que sí conviene saber sin abrirlo: **(1)** hoy la promoción es
> *«una fila que se transforma»*, no *«dos filas emparejadas»* —`promoverAProduccionNucleo` hace **un
> solo `update` sobre el mismo id**—, así que el trabajo es **hacer nacer filas donde hoy no nace
> ninguna**; **(2)** la receta será **UNA sola compartida por referencia** (columna nueva
> `Modelo.idModeloDesarrollo` + resolver dentro de las **tres** funciones de lectura), porque con
> cuatro copias no se *controla*, se *vigila*; **(3)** `idModeloPadre` **NO se puede reusar** —
> `esVersionDeModelo` haría que la compuerta de revisión **bloqueara la propia promoción** de los
> hijos—; **(4)** la acción en bloque va con **transacción POR ORDEN** (una global abortaría el lote
> entero, que es justo lo prohibido) y **no puede firmar**, porque Daniel ya quitó el liberar masivo;
> **(5)** riesgo nuevo con nombre: los consecutivos de 5 dígitos (**999 por par concepto+género**) se
> gastarán **tantas veces más rápido como colores tenga el modelo —en el caso de Daniel, 4—**, y
> `Genero.digitoAlterno` prueba que agotar una serie **ya pasó en el Access** (Caballero, `1 → 5`).
> ⚠️ El aviso (`LIBRES_PARA_AVISAR = 50`) y el salto a la serie de continuación **ya están
> construidos**: lo que falta decidir es **qué dígito se le abre a los otros seis géneros**, que hoy no
> tienen ninguno. ⏳ **BLOQUEADO hasta que Daniel conteste las 10 preguntas** (§6, todas con default
> propuesto). ⇒ **SIN migración · SIN permisos · SIN seed · SIN contrato · sin `SEED_ON_START`**.
> Detalle en `docs/hoja-de-ruta/V1-etapas.md` §V1-E8n.
>
> ✅ **`V1-E8m` · LOS DOS CABOS DEL #209** (28-ago, **0.050**): etapa **chica de cierre**, sin cambio de
> comportamiento — ni una línea del código de producción. Cierra los dos cabos que el reviewer de
> `V1-E4d` declaró *«no bloqueantes, pero NO menores»*, porque **un defecto conocido no es «menor»**.
> **(A)** El **orden** de la escalera de `motivoDeOmision` no lo fijaba ninguna prueba: las siete que la
> cubrían directamente dejaban el proveedor puesto, así que subir `sin-proveedor` por encima del peldaño de
> lo-que-ya-no-se-pide **pasaba en verde** — y el estado que los distingue **es alcanzable en producción**:
> un material ya cubierto por una OC viva **y con el proveedor sugerido en `null`**. ⚠️ **No por donde
> parece:** con el pendiente en 0 la explosión **ya no ofrece** quitar el proveedor (`ofreceAsignar` exige
> `cantidadPendiente > 0`). Se llega **(b)** porque `idProveedorSugerido` es **DERIVADO** —cascada amarre →
> dueño/habitual → más barato → asignación (`proveedor-material.ts`)—, así que basta con que el **catálogo**
> pierda el amarre o el dueño **después** de la compra, sin tocar la pantalla; y **(a)** quitando la
> asignación mientras aún hay pendiente y cerrándolo luego con «dar por cubierto». Con la escalera al revés,
> la previa diría *«no hay a quién comprarle»* sobre algo **YA COMPRADO**. Es §Post-F9.85 otra vez. La
> prueba nueva fija las **tres ramas** del peldaño con proveedor en `null`, y **la mutación que invierte el
> orden muere sólo por ella** (1 falla / 79 pasan — medición que confirma que el hueco era real).
> **(B)** La ficha de `V1-E4d` decía que la superviviente *«es la única sólo-CI»*: contado contra lo que
> hay, **costuras sólo-CI son dos** — la extracción de la 3ª vuelta dejó fuera de unit el **cableado del
> llamador** (`haySeleccion`/`marcado`). Corregido ahí mismo distinguiendo *superviviente* (nadie la mata)
> de *sólo-CI* (no la mata unit). ⭐ **Y el conteo nuevo va MEDIDO** contra PostgreSQL local: cada mitad
> del cableado mata **5** pruebas de integración, las cinco en `mrp.int.test.ts` (`:1108`, `:1631`,
> `:2220`, `:3972`, `:4019`) — y **la de «lo YA COMPRADO» (`:2261`) NO cae**, aunque el nombre invite a
> contarla. ⇒ **SIN migración · SIN permisos · SIN seed · SIN contrato · sin `SEED_ON_START`**. Detalle en
> `docs/hoja-de-ruta/V1-etapas.md` §V1-E8m.
>
> ✅ **`V1-E8l` · «ESCÓNDESELA»: el costo REAL de un modelo deja de verse sin permiso ⭐** (28-ago,
> **0.049**): §Post-F9.137. Cierra la nota que §Post-F9.123 dejó **levantada a propósito**: la columna
> «costo actual» del listado de modelos enseña el costo unitario del **último costeo REAL (F7)** —«cómo
> terminamos», no el plan— y **Gerencial (Aurora) la veía**. Daniel, en una palabra: *«Escóndesela.»*
> Defecto **PRE-EXISTENTE**. Se **esconde Y se bloquea** (§Post-F9.68): la columna no se pinta **y** el
> servidor ni siquiera consulta el dato. 🔴 **Lo que cambió el plan, medido antes de construir:** la
> salida presupuesta —sacar a Aurora de `consultas.ver-importes`— le habría **apagado el PRE-COSTEO
> entero** (`calcularPreCosto`/`listaPrecios` devuelven todos sus importes en `null` sin ese permiso),
> que es justo lo que Daniel dijo que ella **sí** debe ver. ⭐ Así que **no se le quitó ningún permiso**:
> el candado se colgó de **`costos.ver` + `consultas.ver-importes`** (`puedeVerCostoRealDeModelo`,
> con su **guarda gemela** en el frontend gobernando los dos pintados, móvil y escritorio).
> `costos.ver` es el permiso que la propia tabla de §Post-F9.123 nombra como *«el RESULTADO»*, y
> Gerencial **ya estaba fuera de él por diseño**. ⇒ **SIN migración · SIN permiso nuevo · SIN
> `SEED_ON_START`** (el seed no se tocó), y Aurora conserva precosteo, listas, negociación y recetas.
> ⚠️ **La prueba que ya existía pasaba en verde con el hueco abierto**: quitaba `consultas.ver-importes`
> —el permiso que Aurora **sí** tiene—, así que nunca ejercitó el caso real; se conserva y se le suma la
> que sí muerde, en las **dos direcciones** (sin permiso NO se ve; con él SÍ). 🔴 **Riesgo aceptado de
> frente:** si ella usaba esa columna, se va a quejar — **se destapa y se decide con nombre, no se
> revierte en silencio.** Detalle en `docs/hoja-de-ruta/V1-etapas.md` §V1-E8l.
>
> ✅ **`V1-E8k` · PRENDAS INCOMPLETAS ⭐⭐** (28-ago, **0.048**): §Post-F9.136. Daniel:
> *"tendríamos que tener una entrada adicional para prendas incompletas… **los faltantes se los cobro**
> … eso no se va a ningún inventario… **tampoco se pagan**"*, y el remate que fija dónde: *"sólo
> quisiera ver reflejado en algún lado que sí las entrego, **para revisar los temas de pago**"*. Una
> prenda a la que le faltó una pieza y **nunca se terminó de coser**: no es una segunda (ésa se vende
> más barata), es una **no-prenda**. Se capturan · **no** entran a inventario · **no** cuentan como
> producidas (opción A: de 100 con 95 buenas + 5 incompletas, **la orden produjo 95**) · **no** se
> pagan · pero **sí se ven donde se revisa el pago**. 🔴 **La trampa central, medida antes de tocar
> nada:** `EtapaMovimientoDet.cantidad` es "total recibido", y de ahí cuelgan **el cargo al maquilero**
> (`aCargoSalida` multiplica esa suma por el precio) **y el kardex de PT** ⇒ toda pieza que entrara ahí
> se cobraría y se inventariaría. Por eso van en **columna propia** (`cantidadIncompletas`, migración
> **aditiva**, sin backfill), y la invariante `primeras + segundas = cantidad` **queda intacta**: las
> tres reglas se cumplen **por construcción**, no por un filtro que alguien pueda olvidar mañana.
> ⚙️ **Las dos decisiones que la opción A obligó y no eran obvias:** (1) **el pendiente se queda
> ABIERTO** —el WIP sigue diciendo "faltan 5", que es lo que Daniel le cobra; era la razón por la que
> descartó la opción B—; y (2) **esas 5 ya no se pueden recibir como buenas** (salieron del taller), así
> que el tope de `recibido ≤ enviado` pasó a contar `cantidad + incompletas`. Son **dos números
> distintos**, y el contrato publica **los dos más un tercero, `recibible`, que calcula el SERVIDOR
> con la misma función del tope (`recibiblePorCelda`)**: la pantalla lo consume tal cual y **no
> re-deriva la regla** — si sólo viajara el pendiente y el cliente restara, sería la misma regla
> escrita en dos lados. 🔑 **El defecto lo
> encontró la PRUEBA, no el razonamiento:** un recibo de costura con **sólo** incompletas seguía
> exigiendo almacén destino para meter CERO piezas (`meteAPt` ahora lleva `&& totalRecibido > 0`; no
> afloja nada viejo — antes un recibo sin piezas era imposible), y por lo mismo **no genera cargo EsMa**
> (si no, la cola de validación se llenaría de cargos de $0). **Entrega:** módulo
> `dominio/produccion/incompletas.ts` con la aritmética compartida por las dos puertas; interruptor +
> matriz en la captura del avance; bloque en las **dos** vistas del estado de cuenta → **PDF** (sección
> sin importe) y **Excel** (hoja propia); aviso en la **validación del cargo**; columna en **recibos
> semanales**; renglón en el **PDF del recibo**. ❌ **NO se construyó el cobro automático del
> faltante**: Daniel explicó *por qué* pide que se las entreguen, pero no pidió que el sistema haga ese
> cargo. **SIN permisos ni seed ⇒ no requiere `SEED_ON_START`.** Ficha:
> `docs/hoja-de-ruta/V1-etapas.md` §V1-E8k. ⚙️ **Y un hallazgo de método que vale para toda etapa: la
> mutación que EXCEDE encontró lo que la que QUITA no podía.** Contar las incompletas **dos veces** en
> el tope (cerrarlo de más) **pasó las 33 pruebas** — porque todas medían el PRIMER recibo, donde el
> acumulado está vacío y el doble conteo no se nota. El defecto sólo asoma en el SEGUNDO recibo,
> bloqueando piezas que el maquilero sí puede devolver. Se cerró con una prueba nueva (envío 10 → 5
> buenas + 2 incompletas → el segundo recibo de 3 **debe pasar**) y ahí sí muere. *Una regla nueva
> necesita su prueba en el estado ACUMULADO, no sólo en el primer acto.*
>
> ✅ **`V1-E8j` · EL MODELO SIEMPRE NACE EN DESARROLLO ⭐⭐** (28-ago, **0.047**): 🔴 **El remate que
> destapó el CI: los DOS DÍGITOS pasan a ser OBLIGATORIOS en el alta.** Cerrar el alta directa dejó un
> hueco —un modelo del catálogo sin tipo de prenda ni género **no se puede numerar**— que **rompía la
> importación de la OC del cliente**: generar la OP promueve el modelo, `digitosDelModelo` lanzaba y,
> al ser `confirmarImportacion` UNA transacción (A2), **se caía el pedido y TODAS las OP del archivo**.
> Medido contra Postgres (0 órdenes creadas), no supuesto. Se cerró **exigiendo los dos datos en el
> alta**, que es lo que el alta de **Desarrollo ya exigía** — alinea la segunda puerta con la primera,
> no inventa una regla. La otra salida (*no bloquear la OP y avisar*) se descartó: degradaba
> §Post-F9.34 punto 4 de *«siempre promueve»* a *«promueve si puede»* y dejaba modelos con OP viviendo
> en desarrollo. ⚠️ **Ejecutado sobre el default propuesto a Daniel** (28-ago, sin objeción); **si
> dice que los quiere opcionales, la reversa toca OCHO sitios y está escrita, punto por punto, en
> `DECISIONES.md` §Post-F9.134** — no es un renglón, e incluye **regenerar el contrato**. La lista
> **se ejecutó entera antes de escribirse** (con los ocho, `typecheck` = 0 en los dos lados). 🔑 **Y el ETL sigue cargando sin ellos:**
> `crearModeloMigrado` ya **no llama** a `crearModelo` — los dos comparten **`crearModeloNucleo`**, que
> recibe la nomenclatura como DATO (`MarcaNomenclaturaModelo`), y la exigencia vive **por encima** del
> núcleo, en el alta normal: *la migración entra por debajo, sin banderas*. ✅ **La compuerta de
> revisión de V1-E7d no se rozó** (verificado: `nomenclatura.ts`, `revision-modelo.ts` y
> `salida-produccion.ts` sin un solo cambio). Los **13 specs** que dan de alta modelos por UI capturan
> ahora los dos dígitos **como lo haría Daniel**, sin aflojar aserciones. ⚙️ **HALLAZGO DE MÉTODO que
> sirve para todas las etapas:** se pudo correr integración **en local sin Docker ni testcontainers**
> —arrancando el PostgreSQL que ya está instalado y corriendo Vitest con una config de scratchpad que
> sustituye el `globalSetup`—, con `vitest.config.ts` **intacto** y sin comitear nada de eso. Gracias a
> ello **murieron las cuatro mutaciones** que la primera entrega declaró «no se vio morir». Pasos
> exactos en la ficha.
>
> ✅ Lo demás de la etapa, ya construido y verificado: §Post-F9.134. Daniel,
> probando: *"Generé dos modelos en precosteo… y **no los veo en modelos**. ¿Dónde lo edito?"* — y
> razonando el orden: *"**siempre se va a empezar creando un modelo de desarrollo**… el modelo de
> producción a la hora de dar de alta las órdenes"* + *"nunca va a pasar que dé de alta un modelo de
> producción si no tiene ya una orden asignada. No tendría sentido poner ahí una puerta."* **La causa
> son DOS cosas que por separado no se ven mal:** los modelos de Desarrollo nacen marcados
> `desarrollo`, y el listado arrancaba filtrado a `produccion` (§Post-F9.34 punto 2, *"no llenar de
> basura el catálogo"*) ⇒ **la pantalla escondía por defecto justo lo recién creado**. *Un filtro que
> oculta lo que acabas de hacer no se lee como filtro: se lee como que no se guardó.* 🔴 **La trampa,
> medida antes de tocar nada: el default vivía en CUATRO puertas, no en una** —el Zod del dominio
> (`esquemaListarModelosDominio`), el del contrato (`esquemaModelosQuery`) y los `useState` de
> `ModelosPagina` **y de `GaleriaModelos`**—, y **el frontend manda `origen` EXPLÍCITO en la query**:
> cambiar sólo el esquema del dominio habría dejado a Daniel viendo exactamente lo mismo, con una
> versión gastada en un arreglo que no arregla (*«todas las puertas o ninguna»*, §Post-F9.116(d)). Se
> cerraron **las cuatro**, cada una con su prueba, y **la prueba que sostiene la etapa no es «el default
> del esquema es todos»** —ésa pasa verde con el defecto vivo en la pantalla, que era el defecto real—
> sino que **con la pantalla recién abierta y sin tocar un filtro el modelo de desarrollo ESTÁ**. Las
> dos del servidor las miden las de integración, y además un unitario nuevo
> (`dominio/modelos/filtro-origen.test.ts`) las duplica **sin Postgres** con un Prisma falso que captura
> el `where` que arma el dominio, para que ninguna quede sin quien la mate en una máquina sin BD. La
> **galería** no venía en el REPORTE de Daniel —sólo habló de Modelos— pero sí en la decisión
> (§Post-F9.134 punto 4, *"va incluida, no es un caso aparte"*): mismo `useState`, mismo defecto, y
> §Post-F9.34 punto 2 ya hablaba del *«catálogo y la galería»*. **Entrega:** default
> `todos` en las cuatro puertas + **columna «Etapa»** (chip *Desarrollo* / *Producción*) en la tabla,
> en la tarjeta de móvil y en la galería; **`crearModelo` ya no fabrica modelos de producción** (nace
> `origen: 'desarrollo'`, `numeroProduccion: null`, `codigoDesarrollo = codigo` — así el código
> tecleado se conserva y sigue buscable cuando la promoción lo sustituya, D3); el `update` que
> `desarrollos.ts` hacía aparte se **borró** (ahora lo hace `crearModelo`; la misma regla escrita en
> dos lados deriva); y el alta lo dice de frente (*"Nace en DESARROLLO: su número de producción se le
> asigna al pasarlo a producción"*). 🔴 **Lo que se verificó ANTES de cerrar la puerta: el ETL del
> histórico SÍ dependía de ella** —`migracion/loaders/modelos.ts` carga los ~4,987 modelos del Access
> con `crearModelo` (A1) y ésos **son de producción y no tienen orden**; habrían quedado marcados como
> desarrollo, con nº de desarrollo inventado y sin poblar `numeroProduccion`, dejando al generador del
> consecutivo sin ver ocupadas las series reales—. Resuelto con **`crearModeloMigrado`**
> (`dominio/modelos/migracion.ts`), el mismo patrón de modo migración de órdenes/compras/RC, que **no
> se expone en ninguna ruta REST** (y que en el remate del principio dejó de llamar a `crearModelo`:
> comparten núcleo). El **seed** no siembra modelos, y el
> **`@default(produccion)` de la columna NO se cambió** (sólo lo alcanzan las fixtures crudas, que
> siembran modelos de producción; cambiarlo pedía migración y volteaba su significado en silencio) —
> documentado en el propio `schema.prisma`. ⭐ **Cabo suelto cerrado solo:** `proponerNumeroProduccion`
> ya precargaba el único punto donde se captura el número (el diálogo «Pasar a producción»,
> §Post-F9.46); cerrada el alta directa, **no queda ningún lugar donde se teclee un nº sin propuesta**.
> ⚠️ **Costo, dicho de frente:** Daniel tiene que elegir tipo de prenda y género al dar de alta un
> modelo (~~antes se declaró como costo que un modelo sin ellos no se pudiera promover y se dejaron
> opcionales~~ → **eso se cerró en esta misma etapa**, ver el remate del principio de esta entrada).
> 🔴 **Y una onda expansiva que sólo apareció barriendo los e2e:**
> `ordenes.spec.ts` y `ruta-critica-motor.spec.ts` daban de alta su modelo **sin esos dos dígitos** y
> enseguida le generaban la OP; antes no pasaba nada (ya era de producción) y ahora la OP **lo
> promueve**, así que habrían salido **rojos en CI**. Se arreglaron *como lo haría el usuario* —capturan
> tipo de prenda + género— y siguen al modelo por su **código VIGENTE** tras la OP, porque la primera OP
> **le cambia el código** al nº de 5 dígitos (el de desarrollo se conserva y sigue buscable, D3).
> ⚠️ **Los e2e siguen sin poder correrse aquí** (piden el stack completo; regla del proyecto: nada de
> Docker local): **los juzga el CI**.
> 🔴 **RONDA DE CORRECCIÓN — la pieza cuyo fallo es irreversible era la ÚNICA sin candado.** El reviewer
> **revirtió el loader del ETL** a su versión anterior y corrió todo: **typecheck, lint y 221 pruebas en
> VERDE**. El único test que lo ejercita afirmaba **conteos**, y los conteos **no se mueven** con la
> reversión (los 5 modelos se crean igual, sólo que marcados como desarrollo, con nº de desarrollo
> inventado y sin nº de producción). *No valía «lo juzga el CI»: el CI tampoco lo juzgaba.* Se cerró con
> una prueba que afirma el **ESTADO de las tres columnas** más una fila de fixture con **código de 5
> dígitos** (las cinco que había eran no numéricas ⇒ la mitad que **deriva** el número no la ejercitaba
> nadie), y **se vio morir**: con el loader revertido cae sólo ella (*expected 5 to be +0*) y las otras
> 9 siguen verdes —la denuncia del reviewer, medida—; restaurado, 10/10. **Un conteo que no se mueve no
> es un candado.** ⚙️ Se pudo correr **sin Docker y sin testcontainers**: esta máquina trae un
> PostgreSQL 16 apagado; se arrancó, se le aplicaron las migraciones reales y Vitest corrió con una
> config de **scratchpad** que publica esa URL — el `vitest.config.ts` del repo queda intacto.
> 🟠 Y un **flake** del mismo barrido: el botón «Generar OP» **no** se deshabilita por falta de número
> (sólo por `isPending`/`total === 0`), así que confirmar antes de que aterrice la propuesta rebota con
> `toast.error`; los dos specs esperan ahora el campo con 5 dígitos. ⚠️ Y de paso: **renombrar un modelo de desarrollo
> ahora arrastra su nº de desarrollo** (defecto latente que esta decisión vuelve el caso normal;
> arreglado en la misma ronda, no archivado como «menor»). **NO entra:** la relación **1:N** (un
> desarrollo → varios de producción con una sola receta, §Post-F9.135) — el límite 1:1 vive en
> `Modelo.codigoDesarrollo @unique` y `Modelo.numeroProduccion @unique` y **no se tocaron**. SIN
> migración, SIN permisos ⇒ **no requiere `SEED_ON_START`**. Ficha:
> `docs/hoja-de-ruta/V1-etapas.md` §V1-E8j.
>
> ✅ **`V1-E8i` · CAPTURAR EL AVANCE DE UN CLIC ⭐⭐** (28-ago, **0.046**): §Post-F9.131. Daniel,
> capturando avances: *"Sería muy bueno que tenga la opción de **marcar el corte como completo** (un
> botón que llene los campos de cada talla con las cantidades que se ordenaron) y **otro de entrega a
> maquila con la información exacta de lo que se cortó**."* Hoy teclea **talla por talla** lo que casi
> siempre es exactamente lo esperado (4 colores × 6 tallas = 24 campos copiados a mano) y **el sistema
> ya sabe el número**. **Entrega:** dos botones pegados a la matriz que llenan, con el total en el
> rótulo — **«Llenar con lo que falta por cortar (N pza)»** en el corte y **«Llenar con lo que se cortó
> (N pza)»** en el envío (costura y arte) —, alimentados por una consulta nueva de solo lectura
> `GET /api/produccion/ordenes/:id/sugerencia-captura` (permiso **reusado** `produccion.wip-ver`).
> 🔴 **PRECARGAN, NO GUARDAN**: llenan los campos y ahí se detienen; el usuario revisa, ajusta y da
> «Guardar movimiento». Y **PISAN** lo capturado, no lo suman — sumar haría que un segundo clic
> duplicara en silencio y sin vuelta atrás. 🔴 **La trampa que había que esquivar: el SEGUNDO envío
> parcial.** El envío está topado desde F3-E2 (decisión (g), sobre-envío ESTRICTO bajo
> `pg_advisory_xact_lock`), así que precargar el **bruto cortado** con una parte ya enviada —100
> cortadas, 60 enviadas → 100— se llevaría un rechazo con la matriz ya llena. *Un botón que produce un
> error no es un atajo, es una trampa*: propone **40**, que es el tope exacto que valida
> `registrarEnvioMaquila`. ⚠️ Y **lo cortado no es lo ordenado** (sobre-corte LIBRE, decisión (f)): el
> botón del envío lee lo **realmente cortado**; el del corte propone lo que **falta** (con un corte
> parcial ya capturado, proponer otra vez lo ordenado duplicaría piezas) y **nunca** propone negativos.
> ⚠️ **Y se APAGA con prendas YA TERMINADAS** (bloqueante H3 del reviewer): ahí el envío saca PT del
> almacén y el servidor exige **dos** topes —lo cortado **y** la existencia física
> (`traspasarPrendasATransito` → `exigirExistenciaPt`)—; con 1,000 cortadas y 400 recibidas el botón
> anunciaba 1,000 y el Guardar reventaba por existencia, *la misma trampa en el flujo de al lado*. Se
> apaga con su razón; que también tope por existencia es OTRA etapa, declarada.
> **Sin nada que precargar el botón se ve APAGADO y con la razón al lado** —orden sin matriz · ya se
> cortó todo · todavía no hay corte · todo lo cortado ya se envió—, **decidida por el servidor** y con
> la matriz intacta para capturar a mano. El **recibo NO lleva botón**: su pendiente es de cada
> maquilero, no del proceso. ⭐ **Remate:** se borró una regla que ya estaba escrita dos veces — la
> pantalla re-derivaba lo cortado (*pedido − porCortar*) para topar el **primer** envío de un proceso;
> ahora `wipDeOrden` manda **`cortadoCeldas`** y la pantalla lo lee tal cual. **NO entra:** prendas
> incompletas (espera decisión de Daniel) ni primeras/segundas (ya existían). 🔴 **Ronda de corrección
> con tres bloqueantes:** `sugerirCaptura` nacía **sin una sola prueba** y la mutación que le quita el
> filtro por proceso sobrevivía (D8: el botón de arte habría contestado con los envíos de costura) →
> `etapas.rutas.test.ts` nuevo + un bloque que prueba **la FORMA de las consultas con un Prisma falso**
> (mata la mutación **sin Docker**) + 7 de integración; el mock del frontend **descartaba los
> argumentos**, así que mutar el proceso a uno inexistente pasaba 75/75; y el apagado de H3. Más: el
> envío ya no propone celdas que se quitaron de la matriz después de cortarse (dirían 240 y se
> guardarían 200) y el encabezado de un test que **afirmaba una cobertura inexistente**. 🔴 **Y una
> última ronda por un bloqueante más (H9):** el corte y «envío sin proceso elegido» compartían clave de
> caché (`idTipoProceso ?? null`) y **una query deshabilitada sigue sirviendo el `data` guardado**, así
> que al abrir Entrega a arte —donde el proceso arranca vacío— el botón salía encendido con la cifra
> del CORTE mientras la nota decía *«Elige primero el proceso»*. Se cerró con **una sola verdad**
> (`consultaSugerencia` alimenta el `enabled`, el `disabled` y el Reintentar) más la base en la clave de
> caché; y la prueba que lo cubría pasaba **por la razón equivocada** —su mock devolvía un payload que
> la caché real nunca serviría ahí—. SIN migración, SIN
> permisos ⇒ **no requiere `SEED_ON_START`**. Ficha: `docs/hoja-de-ruta/V1-etapas.md` §V1-E8i.
>
> ✅ **`V1-E8h` · EL AVISO YA SABÍA TODO Y NO DABA LA PUERTA ⭐⭐⭐** (27-ago, **0.045**): §Post-F9.130.
> Daniel, por cuarta vez sobre lo mismo: *"Sigue estando mal lo de los cierres… me sigue multiplicando
> por las medidas… Y me sigue poniendo 53 mil cierres por comprar (orden 5562). **Siento que estamos
> atorados en lo mismo desde hace varias versiones. No podemos desatorarlo.**"* 🔴 **La causa de los
> cuatro intentos, medida:** se arreglaba el **MOTOR** y el **DATO seguía congelado**. El motor está
> sano desde el 18-ago (`sembrarRecetaDeOrden` apaga la contradicción al nacer la orden ⇒ **una OP nueva
> sale bien**), pero la receta de cada orden es una **foto** del día que nació —a propósito, D3— y
> **ninguna corrección del motor vuelve hacia atrás a tocar órdenes vivas**. Daniel arreglaba el cálculo,
> reabría la **misma 5562** y veía el **mismo número**. ⭐⭐ **Y el defecto que quedaba no era el cálculo:
> era el REMEDIO.** El sistema ya **detectaba** el renglón contradictorio, ya **sabía la magnitud**
> (`requeridoContradictorioPorMedida` calculaba los 53,095 y cuánto debía ser)… y cerraba el aviso con
> **«Guarda el renglón para normalizarlo»** — *un conjuro que un no-programador no puede adivinar*. Un
> sistema que detecta el error, sabe la solución y deja al usuario sin salida está **peor** que uno que
> no lo detecta. **Entrega:** un **botón «Corregir» pegado al aviso**, en el renglón (endpoint propio
> `POST …/receta/renglones/avio/{id}/corregir`, permiso **reusado** `desarrollo.administrar`), y el aviso
> reescrito **abriendo por la cifra**: *«Esta orden pide 53,095 pza y deberían ser 3,200 pza…»*.
> ⚖️ **Sigue siendo un acto EXPLÍCITO (D3)**: la bandera **no** se apaga sola al leer la pantalla —eso
> sería el cambio callado que D3 prohíbe—; lo que cambia es que el acto ahora **se entiende**. Corregir
> **no borra** las cantidades por talla (dejan de mandar), **no** toca consumo/precio/amarre, **no** marca
> el renglón «ajustado» (lo dejaría sordo a los avisos de *"el modelo cambió"*) y **sí** tumba la firma de
> **ese** renglón: hay que **volver a Liberar**. ⚠️ **Es UNA ORDEN A LA VEZ y las viejas no se arreglan
> solas**: **no hay reparación en bloque** —tocaría datos de muchas órdenes vivas y ~~**eso necesita la
> palabra de Daniel, que todavía no está dada**~~ → 🔁 **LA PALABRA LLEGÓ Y FUE *NO* (28-ago-2026,
> §Post-F9.132):** *"lo viejo ahorita es irrelevante… vamos a importar de nuevo la información cuando
> vayamos a producción"* ⇒ **la reparación en bloque se CANCELA; no se le vuelve a preguntar.** El
> detector (`migracion/analisis/avios-por-medida-contradictorios.ts`) deja de ser la lista de trabajo de
> una campaña de limpieza y pasa a ser **insumo del ETL del arranque** (§Post-F9.133). 🔴 **Sigue abierto** (ya estaba nombrado en V1-E6a): la
> **habilitación/surtido** enseña el mismo número inflado mientras el renglón no se corrija, y
> `calcularDesalineacion` no mira las medidas por talla. SIN migración, SIN permisos ⇒ **no requiere
> `SEED_ON_START`**. Ficha: `docs/hoja-de-ruta/V1-etapas.md` §V1-E8h.
>
> ✅ **`V1-E8g` · EL PACK DEJA DE SER UN COLOR ⭐⭐** (27-ago, **0.044**): §Post-F9.129. Daniel, mirando
> la Explosión de materiales: *"Ahora estás poniendo dos renglones por cada orden (Negro A y Negro B)…
> Negro A y Negro B es lo mismo. Solo cambia la distribución del empaque. Pero no tiene sentido separar
> las compras para cada renglón: veo demasiados registros."* **Causa raíz medida:** el importador de OC
> por PDF metía la letra del pack DENTRO del nombre del color (`componerColor` → `Negro A`) y creaba **un
> color de catálogo por pack**; como todo aguas abajo agrupa por color, una misma orden llegaba a las
> compras partida en dos o tres. Ahora el color es el **genérico** (`Negro`) y los packs se **suman talla
> por talla** en un solo renglón, fundidos en la **única puerta** por la que la matriz de un PDF llega a
> la orden (cubre la propuesta automática **y** la matriz editada a mano). **El desglose no se pierde:**
> vive íntegro en `Orden.packsCliente` — "el otro campo" que Daniel recordaba, base del futuro módulo de
> EMPAQUE. La vista previa sigue mostrando los packs (fidelidad al papel) pero rotulados «Pack A»/«Pack
> B», con el total diciendo «A fabricar · Negro». ⚠️ **Sólo hacia adelante:** las órdenes YA importadas
> conservan sus colores partidos; unificarlas es migración irreversible y va aparte. 🔴 **Y NO se arregla
> con «Fusionar colores»**: esa herramienta sólo sabe mover **1 de las 12** referencias del color (las de
> tela) y dejaría las órdenes, el corte, el kardex de PT y las compras colgando de un color apagado —una
> orden con color inactivo ya no se puede editar—, así que en esta misma etapa **se le construyó la
> negativa**: cuenta las otras once y **rechaza** nombrando los usos y el camino de salida, con la lista
> derivada de `schema.prisma` por una prueba para que no vuelva a quedarse corta (§4). ⚠️ El desglose por
> pack **está guardado pero todavía no lo muestra ninguna pantalla ni impreso** (sale con el módulo de
> empaque), y lo guardado son las cantidades **del cliente**, no las fabricadas. Cierra **la primera
> mitad de §Post-F9.10**; la
> segunda (el pack como campo propio que viaja al corte y a la maquila) **sigue abierta**. SIN migración,
> SIN permisos ⇒ **no requiere `SEED_ON_START`**. Ficha: `docs/hoja-de-ruta/V1-etapas.md` §V1-E8g.
>
> ✅ **`V1-E8f` · LAS COTIZACIONES NO SE ENCUENTRAN ⭐⭐** (27-ago, **0.043**): §Post-F9.128. El motor de
> cotización está construido desde F8 y `V1-E7c` le puso el documento — **nada de eso falló**. Lo que
> falló fue **llegar a él**: Daniel se topó con **cuatro muros seguidos**. *"En cotizaciones **no puedo
> hacer nada**"* → *"**Aaaaaa, yo estaba viendo los precosteos** (en lugar de lista de precios)"* →
> *"**no está la opción de listas de precios** en desarrollo"* → *"supuse que de ahí **jalo un proyecto
> de precosteo**… **no me deja hacer una lista de precios nueva**"* → *"si tengo el permiso. Sí veo el
> botón. Justo me sale la leyenda de que **no hay desarrollos disponibles**"*. **El dueño del sistema se
> perdió cuatro veces en un módulo que funciona.** 🔴 **Se midió antes de construir:** son
> **SEIS condiciones** que vivían disueltas en un `where` de Prisma (no apagado · empresa activa ·
> cliente · departamento · **≥1 precosto CONGELADO** · sin renglón en otra lista) —**decía "cinco" con
> seis viñetas al lado**, corregido en la ronda de revisión—, y la que fallaba era
> la del **precosto congelado** —el de Daniel existía, pero en **borrador**—; escrito como `where`, ese
> filtro **sólo sabe contestar "hay / no hay"**. Y en el menú, **la MISMA pantalla se llamaba distinto en
> dos lugares**: «Cotizaciones» bajo Desarrollo y «Listas de precios» bajo Clientes, así que el nombre
> que él buscó sólo existía donde no la fue a buscar (y a un centímetro estaban los «Pre-costeos», que es
> donde entró por equivocación). ⭐ **Ahora el servidor CLASIFICA, ya no sólo filtra:** la regla de
> **quién califica** salió a una función pura —el **alcance** (empresa · cliente · departamento) sigue
> en el `where`, porque define el universo y no un descarte— y la consulta devuelve **los descartados
> con su motivo** (`ya-en-lista` > `apagado` > `precosto-borrador` > `sin-precosto`), así que donde se
> leía *"no hay desarrollos
> cotizados disponibles"* ahora se lee, **modelo por modelo**, *«Su precosto sigue en BORRADOR (1) ·
> A-100 — v3 en borrador · Ábrelo en «Precosto» y usa «Congelar versión»»*, con **puerta a Pre-costeos**;
> el que ya está colocado **dice en qué lista**. También **se acabó la adivinanza en el cliente** (el
> motivo bajo «Generar lista de precios» se deducía del estado derivado y su propio comentario admitía
> que *"no se puede separar sin mentir"*), **la pantalla se llama IGUAL en los dos lados** («Listas de
> precios» — *Cotizaciones* sigue en la descripción, en el H1 y como nombre del documento), **congelar
> dice para qué sirvió**, y el rechazo del API **reusa la misma función** en vez de repetir la regla.
> ⚖️ La regla que gobierna: **§Post-F9.96** — *un aviso que dice "no hay X" sin decir por qué ni qué
> hacer ES el defecto*. **SIN migración y SIN permisos nuevos ⇒ no requiere `SEED_ON_START`.**
> 🔴 **Declarado, no construido:** el diálogo **no** gana un selector de proyecto (la lista es de un
> cliente+departamento, no de un proyecto; desde el proyecto ya existe su propia puerta). ⚠️ Integración
> y e2e **escritas y no corridas** (nada de Docker local): manda el CI.
>
> ✅ **`V1-E8e` · «CON ESTO QUEDA CUBIERTO»: EL FALTANTE CHICO QUE NO SE PERSIGUE ⭐⭐** (27-ago,
> **0.042**): §Post-F9.99. Daniel, usando la explosión en `prueba`: *"compré **480 en lugar de 481** que
> era el cálculo de la tela. Y me sigue poniendo que me falta comprar 1 kilo… **a veces pasa eso en la
> realidad**. Y **no voy a hacer otra OC por 1 kilo**"*. Hasta hoy el snapshot sólo guardaba **cuánto se
> necesita**, así que el faltante lo perseguía **para siempre**. Ahora, cuando el comprador **baja la
> cantidad** en la revisión previa, el sistema **pregunta qué significa** —*"el resto sigue pendiente"* /
> *"con esto queda cubierto"*— ⭐ **en el momento de decidir**, que es cuando la persona sabe la
> respuesta; y hay un **«dar por cubierto» / «volver a pedirlo»** en el renglón de la explosión para los
> faltantes **que ya se escaparon**. 🔴 **El default es «sigue pendiente»: nunca se cierra solo**, y se
> pregunta **siempre que se baja, sin umbral** — *1 kg de 481 es nada, pero 1 kg de 5 es el 20 %*, así
> que una tolerancia automática **o tapa faltantes de verdad o no sirve**. 🔴 **La trampa técnica, que era
> el corazón de la etapa:** la marca **NO** puede vivir en `RequerimientoOrden`, que se **borra y se
> reescribe entero en cada explosión** —una bandera ahí se habría borrado sola y el faltante habría
> vuelto sin que nadie entendiera por qué—; vive en **tabla propia** (`RequerimientoCubierto`) con la
> identidad **durable** *(orden, material, **color**)*, la misma con la que netea el color desde
> §Post-F9.89/.126 (una marca por material a secas habría cubierto el cierre rojo y seguido pidiendo los
> otros tres). Y **un solo criterio, no dos**: *comprometido + dado-por-cubierto ≥ requerido*, en una
> función única (`pendienteDeComprar`) que **recoge la resta que vivía repetida** en la explosión y en el
> plan de compra. Con **rastro completo (A7)** —quién, cuándo, contra qué requerido y con qué cantidad
> comprada— y **deshacer suave (D3)**: «volver a pedirlo» sella la fecha, nunca borra. El renglón cerrado
> **dice SU razón** (motivo `dado-por-cubierto`) y no la de otro: `ya-en-oc` mandaría a cancelar una
> compra correcta. 🔴 **Cuatro límites DECLARADOS, no callados:** el tablero R7 **no** cuenta la marca (mide
> lo físico, y dar por cubierto no mueve un gramo), **cancelar la OC no deshace la marca** (se corrige con
> «volver a pedirlo»), **cambiar el color de una tela reabre su faltante** (es otro renglón) y **dos
> actos simultáneos pueden cubrir de más** (sin lock a propósito: la marca sólo resta y no rompe ninguna
> invariante; se deshace). **CON migración aditiva** (un enum y una tabla nuevos, sin backfill) y
> **SIN permisos nuevos ⇒ no requiere
> `SEED_ON_START`**. ⚠️ Integración y e2e **escritas y no corridas** (nada de Docker local): manda el CI.
>
> ✅ **`V1-E8d` · AVISAR CUANDO LA RECETA CAMBIA BAJO UN PRECIO YA APROBADO ⭐** (27-ago, **0.041**):
> §Post-F9.127. Cierra el **eslabón que `V1-E8b` dejó medido y declarado**. Daniel, tras que se le
> explicara que *"tu precio aprobado se queda parado sobre un costo que ya no existe y el sistema no
> avisa"*: **"Si. Ok. Que me avise."** Un renglón de lista guarda un **precosto CONGELADO** (inmutable,
> D3) y una copia de su costo: cambiar la receta del modelo **no mueve ninguno**, hay que congelar una
> versión nueva **y** registrar una ronda, las dos a mano. Ahora el sistema **lo dice**, y dice **qué
> parte de la receta cambió y cuándo**: pegado a su renglón en la lista de precios, en el resumen del
> encabezado de la tabla, y en el diálogo de **emitir cotización** (la puerta por la que un precio sobre
> un costo viejo sale hacia el cliente). **Avisa también sin aprobar** —para que no se firme sobre el
> costo viejo— y **se apaga solo** al recostear: no hay estado muerto. 🔴 **La señal es una columna
> nueva** (`Modelo.recetaTocadaEn` + `recetaTocadaCambio`) escrita **sólo** por el embudo de la receta de
> `V1-E7e`, y **no** `modificadoEn`: ésa es `@updatedAt` y la mueven **11** escrituras que no son receta
> —renombrar el modelo, subirle una foto, la propia firma de revisión—, así que el aviso habría nacido
> gritando en falso. *Un aviso que grita en falso se aprende a ignorar, y el día que sea de verdad nadie
> lo mira.* **La prueba que justifica la etapa es la gemela**: renombrar el modelo **NO** dispara nada.
> ⚠️ **Se cerró como AVISO, no como firma que se cae**, y la diferencia está medida: los hermanos
> (§Post-F9.116, §Post-F9.125(d)) tumban porque cambió **exactamente aquello sobre lo que se firmó**;
> aquí el precosto congelado **no cambió ni puede cambiar**, y un cambio de receta puede no mover el
> costo ni un peso. 🔴 **Dos huecos DECLARADOS, no callados:** un aviso **se puede ignorar** (la
> cotización, el PDF y el Excel siguen saliendo — bloquearlos sería más de lo que Daniel pidió y lo tiene
> que decidir él), y un desfase **anterior al despliegue no se detecta** (la columna nace en NULL, que
> significa *no se sabe*; rellenarla con `modificadoEn` sería la mentira que la etapa descartó). **CON
> migración aditiva** (2 columnas nullable, sin backfill) y **SIN permisos nuevos ⇒ no requiere
> `SEED_ON_START`**. ⚠️ Integración y e2e **escritas y no corridas** (nada de Docker local): manda el CI.
>
> ✅ **`V1-E8c` · LA MEDIDA Y EL COLOR DEL AVÍO EN LA ORDEN DE COMPRA ⭐⭐** (27-ago, **0.040**):
> §Post-F9.126. Daniel lo reportó dos veces usando el sistema: *"le había puesto que **el cierre lo tengo
> que comprar por medidas**… al hacer la OC **no me aparece cantidad por medida, sólo veo un solo
> renglón**"*, y el caso completo — *"ese modelo nos lo piden en **4 variantes de color**… se juntan las
> 4 OP en **una sola OC**… **cada color es diferente y cada color tiene cantidades por medida**… **en la
> receta no viene definido el color, eso viene hasta que nos hacen el pedido**"* (y lo mismo con jaretas
> y cintas palmita). 🔴 **La regla que ordena todo: lo que parte el RENGLÓN es lo que se recibe por
> separado; lo que sólo hay que decirle al proveedor va en la TABLITA.** El **COLOR parte el renglón**
> —**se recibe contra la LÍNEA, que lleva el color**, y la explosión netea por renglón— con el **MISMO**
> mecanismo que las telas desde V1-E3u: `claveAgrupada` con un concepto de color más ancho
> (`colorDelRenglon`: de tela en telas, **de prenda en avíos**), no una segunda clave. La **MEDIDA no se
> recibe** (llegan *"3,200 cierres"*): va en una tablita bajo el renglón, y **nunca multiplica** — la
> cantidad sale de cuántas prendas la llevan, que es de donde salieron los 133,095 cierres de
> §Post-F9.105. **Σ del desglose = cantidad de la línea, exactamente** (se reparte con la misma función
> que reparte una compra entre las OP). Llega a **las tres salidas**: explosión, revisión previa y el
> **impreso PDF del proveedor** (que **consolida**, §Post-F9.102 — él ve una cantidad por color+medida,
> no el reparto interno por OP). El **color es editable antes de generar** (el avío puede ir en
> contraste) y va como **texto**, sin catálogo (§Post-F9.91, decisión de Daniel). **CON migración
> aditiva** (3 columnas + 2 tablas, sin backfill) y **SIN permisos nuevos ⇒ no requiere `SEED_ON_START`**.
> 🔴 Arregla de paso **dos defectos conocidos**: `duplicarOC` no copiaba el color de la tela (hueco de
> V1-E3u) y el impreso de la explosión no decía ningún color. 🔴 Y cierra el otro extremo, que no venía
> en el encargo: **la RECEPCIÓN nombra el renglón con su color** —sin eso, quien recibe leería *"CIE-53
> — Cierre"* cuatro veces sin nada con qué elegir—. ⚠️ **Límite declarado y ACEPTADO por
> Daniel:** una **entrega parcial sabrá el color pero NO la medida** — sale de que la medida es
> informativa; el día que importe se parte también por medida con este mismo mecanismo. 🔴 Una mutación
> **sobrevivió y destapó un defecto de diseño**: el impreso agrupaba por `idColorPrenda`, así que dos
> líneas corregidas al mismo texto salían como dos filas idénticas en el papel — se quitó el campo de la
> clave. ⚠️ Integración y e2e **escritas y no corridas** (nada de Docker local): manda el CI.
> 🔴🔴 **Y el CI mandó: tumbó OCHO pruebas de integración, y detrás había un defecto de DINERO.** Al
> partir el renglón por color cambió **la identidad** del renglón, y con ella la clave del ajuste del
> comprador (§Post-F9.94): un ajuste que no nombra el color **dejó de casar — y el sistema no hacía
> nada**. El comprador tecleaba *"compra 0.1"* y **se compraban 180**, sin aviso y sin traza. Ahora
> **bloquea y no genera la OC**, nombrando el material (sólo si ese material sí se le va a comprar a
> ese proveedor: fuera del plan, bloquear sería ruido). ⭐ **De las 18 pruebas que capturaban un
> ajuste, unas DIEZ estaban en verde con su ajuste convertido en no-op** — pasaban por lo que
> afirmaban después, no por lo que creían ejercer. 📌 **La regla que queda:** el cambio no rompió a
> quien LEE el color, sino a quien **CONSTRUYE la identidad** — *cuando una etapa cambia la identidad
> de una entidad, hay que barrer los sitios que la construyen, no sólo los que la leen*. Y el doble de
> transacción que ya existía (`mrp.test.ts`, §Post-F9.120) ahora cubre `planearCompra` entero **sin
> Postgres**: estas ocho se habrían visto en 300 ms.
>
> ✅ **`V1-E8b` · EL PRECIO DE VENTA ES SÓLO DEL DUEÑO ⭐⭐** (26-ago, **0.039**): §Post-F9.125. Cuatro
> decisiones de Daniel que son **una sola pieza**, y un principio que resuelve lo que no se previó:
> *"puede hacer sus cálculos, pero **el sistema no le muestra información digerida**"*. **(a)** Mover los
> cuatro factores (margen · descuentos · regalías · costo de ventas) exige **`listas.aprobar`**, no
> `listas.administrar` — *"los factores sólo yo los puedo mover"*. **(b)** Nadie más los ve: salen en
> `null` desde el servidor, con **UN** criterio para las tres proyecciones. **(c)** *"Si no está aprobado
> no debería de poder bajar ni un borrador"*: el **PDF y el Excel** de la lista pasan por el MISMO guard
> que la cotización y rechazan **nombrando los renglones** que faltan. **(d)** Mover un factor **tumba las
> aprobaciones**, con nota de qué las invalidó y cuándo; la firma vieja vive en el evento inmutable y en
> la bitácora (D3), y se vuelve a firmar normalmente. 🔴 **El barrido encontró TRES puertas a los factores,
> no una**: el snapshot de la lista, el **catálogo del cliente** (del que la lista copia su snapshot al
> nacer — blindar sólo la lista habría dejado abierta la de al lado) y **la calculadora de la mesa**, que
> era la más ancha: `margenObjetivoPct` **ES** el factor servido tal cual, y la pantalla lo pintaba
> literal (`obj. 44.4%`). Una cuarta —el editor del frontend, con su propio criterio paralelo— **la levantó
> una prueba, no el barrido**. ⭐ **(d) no se parcheó: se unificó** — la ronda de negociación ya reseteaba
> la firma al cambiar el COSTO, así que había **dos criterios para el mismo hecho**; hoy comparten el
> `NegociacionEvento` inmutable (sin migración). ⚠️ **Límite declarado y ACEPTADO por Daniel:** quien ve el
> costo y el precio saca el margen **con una división** — se oculta el número, no la aritmética; cerrarlo
> rompería el trabajo de Desarrollo. **SIN permisos nuevos ⇒ no requiere `SEED_ON_START`. SIN migración.**
> 🔴 **Deja medido y NO construido** el eslabón hermano: cambiar la **receta** no mueve el precosto
> congelado ni el renglón de lista, así que el precio aprobado puede quedar sobre un costo que ya no
> existe **sin que nada avise**; la ficha trae las dos opciones para cerrarlo (recomendada: una columna
> `recetaTocadaEn` escrita por el embudo de V1-E7e). ✅ **Lo cerró `V1-E8d` (27-ago, §Post-F9.127) con
> esa columna — pero como AVISO: la firma no se cae y el papel sigue saliendo.** ⚠️ Integración y e2e
> **escritas y no corridas** (nada de Docker local): manda el CI.
>
> ✅ **`V1-E8a` · SE RETIRA EL FACTOR DE CONVERSIÓN DE AVÍOS ⭐⭐** (26-ago, **0.038**): §Post-F9.97.
> Al presentarle la deuda del factor —tres trampas y una columna nueva por delante—, Daniel **canceló el
> trabajo en vez de encargarlo**: *"vamos a meter los avíos por **medidas unitarias** y así dejamos de
> batallar con factores… **la información viene desde el desarrollo, y ahí se costea por metro, no por
> rollo**"*. ⭐ **La regla que queda: la línea de OC va SIEMPRE en unidad de consumo**; el rollo o la caja
> se dicen como **texto informativo** en las observaciones. ⚖️ **Por qué es correcta y no sólo cómoda:** el
> factor traducía **en medio de la cadena del dinero** —multiplica la cantidad, divide el precio—, así que
> el importe total cuadraba **sobre números equivocados**; por eso el defecto vivió meses sin que nadie lo
> viera. 🔴 **El arreglo fue alinear al LECTOR con el ESCRITOR** (el MRP ya escribía en unidad de consumo y
> la recepción volvía a multiplicar), y **con él se cerraron DOS deudas de §4 que en realidad eran una**.
> ⭐ **Etapa de RETIRAR:** el encargo traía 3 sitios y el barrido encontró **6 lectores más** —toda la
> cascada de precios y el costo real—; se retiraron todos, porque dejar la mitad reintroduce exactamente
> la traducción asimétrica que la decisión mata. Se borró `comun/conversion.ts` y el campo
> `precioUnidadConsumo` del contrato de avíos. **Las dos columnas se conservan muertas y vacías** (D3),
> documentadas como tales. **Riesgo de datos CERO y medido:** el factor **nunca tuvo escritor**, así que
> siempre fue NULL y las dos convenciones coincidían — **sin migración, sin permisos, sin seed**.
> ⚠️ **Declarado:** la recepción —el corazón del arreglo— sólo tiene cobertura de **integración**, que
> **no se corrió** (nunca Docker local). La prueba está escrita como guardián exacto y **la palabra final
> es el CI**.
>
> ✅ **`V1-E7e` · LA APROBACIÓN SE INVALIDA SI LA RECETA CAMBIA ⭐** (26-ago, **0.037**): §Post-F9.116.
> El hueco que declaró el coder de V1-E7d y que Daniel mandó cerrar (*"Sí, ciérralo"*): se aprobaba una
> versión, alguien le movía una tela o el arte, y **la OP salía con la firma vieja**. *Una firma que no
> está amarrada a lo que se firmó no es una firma: es un adorno.* ⇒ Cualquier cambio a la receta de una
> versión **aprobada** la devuelve a **pendiente**, con nota de **qué la invalidó y cuándo** y de cuándo
> era la firma que tumbó; la vieja **no se borra** (D3, vive en la bitácora).
> 🔴 **El barrido encontró SEIS puertas (en cinco archivos), no las cuatro que el lead listó**: se le habían escapado los
> **avíos favoritos** (un botón que mete avíos directo al BOM) y **las fotos del arte** —*la imagen ES lo
> que el bordador va a hacer*—. ⭐ **Y no se parchearon las seis:** había **tres copias** de `tocarModelo`
> y cada mutación llamaba a la suya; se unificaron en **`tocarModeloPorCambioDeReceta`** con el tipo de
> cambio como **parámetro obligatorio**, así que **una puerta nueva no compila hasta que declara qué
> toca**. *El embudo ya existía: sólo estaba triplicado.* Trae también **§Post-F9.119** (no se versiona un
> modelo descontinuado: hay que reactivarlo primero).
>
> ✅ **`V1-E7d` · LA REVISIÓN ANTES DE MANDAR A PRODUCIR ⭐ + AURORA ADMINISTRA MODELOS** (26-ago,
> **0.034**): §Post-F9.110 pieza 2 y §Post-F9.123. La revisión es la otra mitad de lo que Daniel pidió
> para la negociación: *"enfrente del cliente puede ser que se cometa una imprudencia o un error"*. Una
> versión nace **pendiente**; quien tiene `modelos.aprobar-receta` la **aprueba o la rechaza con motivo**,
> firmado con quién y cuándo (A7), y la secuencia de actos vive en la **bitácora** (D3).
> 🔴 **El candado va en el NÚCLEO, no en el endpoint**, y ésa fue la medición que decidió el diseño:
> `promoverAProduccionNucleo` tiene **DOS llamadores** —el botón y **generar una OP, que promueve sola**—.
> Probado donde de verdad se puede romper: borrar la compuerta mata **4 pruebas de
> `salida-produccion.test.ts`**. *Esconder un botón es cortesía; negar la operación es la regla.*
> **RECHAZADA por el reviewer** por un **callejón sin salida**: una versión con la firma en NULL el
> backend la bloqueaba y **la pantalla no ofrecía cómo aprobarla**. Causa de raíz: **el dominio preguntaba
> «¿es versión?» por el LINAJE y la pantalla por un proxy** — el mismo patrón de dos-puertas-dos-reglas.
> ⭐ **Y trae §Post-F9.123**: Aurora no podía dar de alta un modelo porque `modelos.administrar` vivía en
> el saco de los catálogos maestros. **Un modelo NO es un catálogo**: una tela se da de alta una vez, un
> modelo es el **trabajo diario** de Desarrollo. La línea de Daniel —*"todo el desarrollo pero no cómo
> terminamos"*— **ya estaba construida**: conserva precosteo e importes, sigue sin costos reales ni EDR, y
> `listas.aprobar` **no** se le devuelve. **Faltaba un permiso, no un rediseño.** La prueba que afirmaba
> lo contrario se **invirtió con su rastro escrito**, y se añadió una gemela que fija la línea nueva.
> ⚠️ **Deuda anotada:** hay una **TERCERA puerta** (`crearOrden` hace la OP **sin promover**).
> 🔴 **Requiere `SEED_ON_START=true`**.
>
> ✅ **`V1-E7h` · EL CONSECUTIVO DE DESARROLLO ARRANCA DONDE DE VERDAD VA ⭐** (25-ago, **0.033**):
> defecto **vivo en `prueba`** que reportó Daniel — metió 2 sudaderas y un jogger y salieron **001, 002 y
> 008**. El contador **sí** era por cliente+año (V1-E7a lo hizo bien); lo que estaba mal es **de dónde
> arranca**: empezaba en 1 para un cliente que ya tenía modelos, así que el bucle de reintentos iba
> saltando los ocupados y **el resultado se veía idéntico al criterio viejo**. 🔴 **Salió de una decisión
> equivocada del lead**: el reviewer de V1-E7a había propuesto **exactamente** este arreglo y se eligió el
> otro por parecer más simple, anotándolo como *"vas a ver un salto la primera vez"*, **como si fuera
> cosmético**. *Una alternativa ofrecida por un reviewer y descartada por comodidad es deuda, no
> simplicidad.* ⇒ El piso va **DENTRO de la sentencia atómica** (`GREATEST(valor, piso) + 1`), no en JS:
> **A3 intacto**, y la regla queda en una sola — **la secuencia nunca retrocede, pero sí adelanta**—, con
> lo que **el cliente de Daniel se corrige solo en su siguiente alta, sin script**. Los tres códigos ya
> emitidos **no se renumeran** (D3). **10 mutaciones**; la prueba del caso de Daniel existe por duplicado
> (unitaria + integración con concurrencia). **Sin migración, sin permisos.**
> ✅ **`V1-E7g` · EL BUSCADOR DE PROVEEDOR, EN TODAS LAS PANTALLAS ⭐** (25-ago, **0.032**): reportado por
> Daniel — el proveedor sólo se encontraba tecleando **el principio** del nombre. 🔴 **CUARTA aparición**:
> el servidor siempre buscó bien (`LIKE %texto%` sin acentos); el defecto es de pantalla (`SelectNativo`
> ⇒ typeahead del navegador, sólo prefijo). Se arregló en el BOM, en las 12 de cliente y en el arte, **y
> las tres veces no viajó**. ⇒ **11 pantallas** barridas, captura con `SelectorProveedor` y filtros con
> **`FiltroProveedor`** (gemelo de `FiltroCliente` de V1-E4). **Backend intacto.** 🔴 **La medición del
> lead era mala y el coder hizo bien en no creérsela: de 23, sólo 6 eran reales; 17 eran el desplegable
> VECINO y se le habían escapado 4** en Producción/Almacenes. *Una medición por proximidad es una pista,
> no una medición.* **Contra la quinta vez**: un barrido automático que se pone rojo si vuelve el
> desplegable viejo — con su límite dicho (reconoce por nombre de variable): **es una red, no una
> demostración**. Cerró además **dos defectos que el propio cambio abría**: el nombre del proveedor no
> viajaba con el id (el campo se vería **vacío y deshabilitado**) y **dos falsos verdes del `tsc -b` por
> CACHÉ** — la cicatriz del 14-ago con otra cara.
> ✅ **`V1-E7f` · LA FECHA DE ENTREGA DE LA OC NO SE HEREDA DE NINGÚN LADO ⭐** (25-ago, **0.031**):
> §Post-F9.120, reportado por Daniel usando `prueba`. La OC tomaba la fecha de entrega de la **orden de
> producción** como respaldo — y eso es **cuándo se le entrega al CLIENTE**, no cuándo tiene que llegar la
> **TELA**: le pedía al proveedor la materia prima el mismo día de la entrega final. 🔴 **Lo grave no era
> que quedara vacío: quedaba LLENO con un número equivocado que se ve legítimo**, y ése es el dato con el
> que se le reclama al proveedor. Daniel, sin matices: *"que marque error y pida poner una fecha de
> entrega. **No toma nada en automático de ningún lado**"*. Fuera el respaldo, **`resolverFechasDeOc`
> perdió el parámetro** (devolver la herencia ya no compila) y el mensaje se reescribió, porque el viejo
> decía *"captúrala en la orden"* — **un consejo falso** bajo la regla nueva. 🔴 **Hallazgo fuera del
> encargo: la PANTALLA replicaba el respaldo** y se callaba cuando las OP traían fecha; con el servidor
> ya rechazando, era **el peor de los dos mundos**. ⚠️ **Y Daniel precisó de qué depende el cálculo
> automático**, que es más de lo que el lead suponía: no es capturar un dato por proveedor, **es la Ruta
> Crítica** — calcular hacia atrás desde la entrega es literalmente lo que hace ese módulo, y está
> pospuesto a propósito (§Post-F9.118(b)). ⇒ **capturar a mano no es un parche: es lo correcto mientras
> tanto.**
>
> ✅ **`V1-E7c` · EL DOCUMENTO DE COTIZACIÓN ⭐** (25-ago, **0.030**): §Post-F9.109. Había **motor de
> cálculo y no había documento** — el flujo llegaba a la lista de precios y ahí se cortaba, justo antes
> del papel que se le manda al cliente. Daniel: *"es un documento con las 5 cotizaciones"*, *"o sea una
> cotización con los 5 modelos"*. Ahora la cotización **cuelga de la LISTA** (cliente + departamento) y
> lleva **N renglones**; 🔴 **si en la segunda vuelta sólo cambian 3 de los 5, la nueva lleva LOS CINCO**
> —el cliente la lee sola, sin la anterior al lado—. **Inmutable**: nace emitida, no hay PUT ni PATCH,
> otra vuelta es otra cotización, y se **cancela con motivo** pero nunca se borra (D3). **Cada renglón
> CONGELA VALORES**, no punteros: reimprimir la de marzo enseña los precios de marzo. **Folio atómico**
> (A3). 🔴 **No se emite con un precio SIN APROBAR** (decisión del lead, marcada para que Daniel la
> objete: *"el precio lo apruebo solo yo"*). **El correo va DESPUÉS**, etapa aparte — si van juntos y el
> correo falla, no se sabe si falló el papel o el envío. **Sin permiso nuevo** ⇒ no requiere
> `SEED_ON_START`. **13 mutaciones**, y una **destapó un defecto en la propia prueba**: el doble de
> `findMany` ignoraba los argumentos, así que la prueba *"van los cinco modelos"* —la que sostiene la
> regla estrella de Daniel— **probaba la suposición del coder, no el sistema**; un `take: 3` colado
> habría pasado en verde. ⚠️ **Queda a juicio y dicho:** las FK con `RESTRICT` dejan **amarrado** lo ya
> cotizado (un renglón cotizado no se quita de la lista ni con la cotización cancelada), lo que
> **reintroduce en parte el «desarrollo atrapado» que V1-E4 arregló** — con `SetNull` en la FK de
> procedencia el papel quedaría intacto **y** la lista libre; y **el encabezado no se congela** (un
> renombre de cliente se ve al reimprimir).
> ✅ **`V1-E7b` · LA VERSIÓN DE UN MODELO NACE CON SUFIJO ⭐** (25-ago, **0.029**): §Post-F9.110
> apartado (a). Daniel: *"¿Por qué no dejamos el mismo modelo, pero le adjuntamos un nuevo número? […]
> **el modelo original queda igual**"*. La negociación mueve la receta en vivo, y editar el modelo en
> sitio sería el error —vive en otros proyectos, se perdería el testimonio, y *"frente al cliente se
> pueden cometer imprudencias"*—. Ahora `CYA-26-71-001` da **`CYA-26-71-001-01`**, con la **receta
> heredada completa** (telas, avíos con medidas por talla, arte; las fotos NO se duplican) y el padre
> **intacto**. **PLANO, nunca anidado** (`-02`, jamás `-01-01`). Permiso NUEVO **`modelos.aprobar-receta`**
> 🔴 **SEPARADO de `listas.aprobar`**: aprobar la RECETA es de Daniel **y Aurora**, aprobar el PRECIO
> sigue siendo **sólo del dueño** —si se juntaran por descuido, Aurora aprobaría precios sin que nadie lo
> hubiera decidido—. Se le suma **§Post-F9.112**: la abreviatura del cliente ya son **3 letras exactas**.
> **Dos hallazgos propios:** el botón «Crear versión» prometía en su comentario esconderse sin número de
> desarrollo y **nunca implementó la condición** (los ~5,000 migrados enseñaban una puerta pintada sobre
> un muro); y la regla prospectiva de las 3 letras **no la vigilaba nadie** — apretar la SALIDA dejaba las
> 26 pruebas en verde, y habría tumbado **el catálogo entero** con el primer cliente viejo de 2 letras.
> 18 mutaciones, todas murieron donde debían. 🔴 **Requiere `SEED_ON_START=true`** (permiso nuevo).
> ⚠️ **Queda abierto y dicho:** la versión **nace suelta** (sin `Desarrollo`, y la lista de precios sigue
> apuntando al padre) — las dos preguntas que §Post-F9.110 dejó *"por confirmar al construir"* — y falta
> **la pieza 2: la REVISIÓN** antes de mandar a producir.
>
> ✅ **`V1-E7a` · EL CONSECUTIVO DE DESARROLLO CORRE POR CLIENTE + AÑO ⭐** (25-ago, **0.028**):
> Daniel, cerrando el choque que §Post-F9.108 dejó abierto: *"Me gusta solo por cliente por año. O sea
> **71-001 y el siguiente 72-002**"*. El contador del código de desarrollo (`CYA-26-71-001`) colgaba del
> prefijo COMPLETO —cliente + año + concepto + género—, así que cada prenda arrancaba en `001`; ahora
> cuelga de **cliente + año** y los dos dígitos **siguen describiendo la prenda pero ya no gobiernan la
> serie**. 🔴 **SUSTITUYE lo decidido en §Post-F9.34 y §Post-F9.46**, y se declara como **cambio de
> criterio, no como corrección** —aquéllas se tomaron con el documento «Estructura de modelos FR Moda»
> (2014) enfrente y siguen legibles—; queda dicho en el encabezado del módulo para que nadie lo
> "arregle" de vuelta dentro de tres meses. **PROSPECTIVO: no se renumera nada** (rompería lo que ya
> anda en correos, cotizaciones y listas de precios del cliente), así que **conviven los dos criterios y
> eso es correcto**. El cambio de fondo es **una línea** —fuera el par de la clave de la secuencia— y lo
> que lo hace seguro **ya existía**: el bucle del minteo pide otro número si el código armado está
> ocupado, ⇒ **sin migración y sin renumerar**… **hasta el tope de reintentos**, que es donde estaban los
> dos defectos. 🔴 **Rechazada por el reviewer y corregida (25-ago):** **(a)** la rama `codigoDesarrollo`
> del centinela **no la sostenía ninguna prueba** —el reviewer la borró y la suite siguió verde—, y es
> justo el caso más probable de los códigos viejos: un modelo **ya promovido**, cuyo `codigo` es el de 5
> dígitos y cuyo `CYA-26-71-001` vive **sólo** en `codigoDesarrollo`; sin ella el minteo entregaba un
> duplicado que revienta contra el `@unique` y **aborta la transacción entera del alta**. **(b)** el tope
> de reintentos era **50**, y como el bucle avanza de uno en uno y el código lleva el par, sólo choca
> contra los del MISMO par: dos pares poblados lo agotaban — **y agotarlo es irrecuperable**, porque el
> minteo corre dentro de la transacción del llamador y **la secuencia se revierte con ella** (reintentar
> falla igual; sólo se destraba con SQL a mano). Subido a **1000**, el techo natural del diseño de 3
> dígitos: la pared queda **inalcanzable por construcción, no por suerte**. **SIN migración, SIN permisos
> y SIN seed** (lo de `schema.prisma` es sólo documentación) ⇒ el deploy no pide `SEED_ON_START`.
>
> ✅ **`V1-E6d` · CABECERAS DE SEGURIDAD EN NGINX 🔴** (25-ago, **0.027**): el **último bloqueante del
> arranque que dependía del equipo**. Cinco cabeceras + `server_tokens off`; las cuatro fijas completas y
> **el CSP en modo REPORTE**, como decidió Daniel (*"vigila y avisa, pero no bloquea"*). ⭐ **El TLS NO
> termina en nginx** —lo termina el edge de Railway y entrega en claro—, así que **`$scheme` vale siempre
> `http`** y ponerlo a ciegas habría sido lo natural y lo equivocado: el HSTS sale de un **`map` sobre
> `X-Forwarded-Proto`**, y el **healthcheck interno** (que pega por HTTP) no lo dispara. Sin `preload`, que
> es casi irreversible. 🔴 **La trampa de la herencia no era teórica y era grave:** `add_header` **no se
> hereda** a una `location` que declara el suyo, y `location = /index.html` **ya tenía** su
> `Cache-Control` — y no es un bloque cualquiera: **el `try_files` de la SPA hace una redirección interna
> que vuelve a elegir location**, así que **casi todo documento HTML que ve el usuario sale por ahí**.
> Limitarse al bloque `server` **habría dejado la página principal SIN NINGUNA cabecera y el resto sería
> adorno**. `/api/` sí hereda, así que JSON, PDFs y Excel salen protegidos; y **todas con `always`**, o un
> 401/404/500 saldría desnudo justo cuando el navegador ve contenido inesperado. ⭐⭐ **El CSP se escribió
> CONTRA EL BUNDLE COMPILADO, no de memoria** (`npm run build` + auditoría del `dist`): el hash del único
> script en línea · `'unsafe-inline'` en estilos **obligado** porque radix y sonner **inyectan `<style>` en
> caliente** (sin él se rompe el scroll de **todos** los diálogos) · **R2 en `img-src` Y `connect-src`
> porque el navegador sube y baja los archivos por `fetch` directo al bucket** —sin eso, el día que
> bloquee **se caen todas las subidas y descargas de foto**— · y **cero `'unsafe-eval'`**, medido. ⭐ **La
> verificación, sin poder levantar nginx** —y el encargo pedía explícitamente *cómo* se iba a demostrar—:
> se instaló **`crossplane`, el parser oficial de NGINX Inc.**, y se parseó la plantilla **renderizada como
> lo hace el entrypoint** en los **dos escenarios**, **con control negativo** (un `add_headers` mal escrito
> que el arnés **sí cazó**); más un **candado de 10 pruebas** que **recalcula el SHA-256** del script en
> línea y lo compara con el del CSP, y exige que **todo bloque con `add_header` traiga el juego completo**.
> Mutilado seis veces por el coder y **re-mutado por el lead** — con un tropiezo instructivo, ver abajo. ⚖️ **Una regresión que el coder causó y arregló:** su comentario nuevo
> menciona el literal `location /api/` y una prueba existente lo buscaba **sin filtrar comentarios** → 3
> rojas apuntando al lugar equivocado; **endureció la prueba** en vez de reescribir su comentario, *para
> que la mina no le explote al siguiente*. 🔴 **Lo que NO queda verificado y se dice:** que nginx arranque
> con esta config y que las cabeceras lleguen al navegador **sólo lo demuestra el servicio corriendo**; que
> el edge mande `X-Forwarded-Proto: https`; y **los impresos** (el visor de PDF de Chrome se apoya en un
> documento de plugin y hay antecedentes de `object-src 'none'` estorbándole) — **razón nº 1 para no
> activar el bloqueo sin probarlo**. 🟡 **Hallazgo colateral declarado y NO tocado:**
> `proxy_set_header X-Forwarded-Proto $scheme` le manda **`http`** al backend, no el protocolo original;
> hoy no rompe nada porque better-auth se guía por `BETTER_AUTH_URL`. ⚠️ **Y una limitación del modo
> reporte que hay que decir:** sus avisos salen **sólo en la consola del navegador** — no hay `report-uri`,
> así que *"vigila y avisa"* hoy avisa **sólo a quien tenga las DevTools abiertas**.
>
> ✅ **`V1-E6c` · QUE EL SISTEMA NO SE PUEDA QUEDAR SIN ADMINISTRADOR 🔴** (25-ago, **0.026**):
> **bloqueante del arranque** — con dos usuarios (Daniel + Aurora) y Daniel como **único admin**,
> cerrarse la puerta era **un clic**. Ya existía media defensa (*no puedes desactivarte a ti mismo*),
> pero 🔴 `actualizarUsuario` **calculaba `cambiaRoles` y no lo usaba para ninguna guarda**, `asignarRoles`
> heredaba el hueco, y **desactivar a OTRO que fuera el último admin sí se podía** (la guarda era sólo
> *sobre uno mismo*). ⭐⭐ **El coder encontró DOS PUERTAS MÁS al mismo precipicio:** (1) **BLOQUEAR** al
> último admin —`cargarPermisosDeUsuario` devuelve set **vacío** para un bloqueado, así que apaga igual
> que desactivar—; y (2) 🔴🔴 **`roles.ts` YA tenía guard anti-lockout… pero sólo para `roles.administrar`**,
> así que un rol que otorgara **únicamente** `usuarios.administrar` se podía vaciar o borrar desde la
> pantalla de Roles y **el guard nuevo se sorteaba en dos clics** —y además contaba sólo `activo`, sin
> `bloqueado`: un admin trabado "rescataba"—. *Un guard que existe pero cubre una sola de las llaves da
> una falsa sensación de puerta cerrada.* ⭐ **El write-skew CRUZA los dos módulos** —una transacción quita
> el rol a Daniel viendo que Aurora tiene el permiso, mientras otra quita el permiso al rol de Aurora
> viendo que Daniel lo tiene; ninguna ve el cambio no comiteado de la otra y las dos commitean → **cero
> administradores**—, así que lock y conteo se extrajeron a `guard-administradores.ts` con **UNA sola
> clave** compartida por las **cinco** puertas, tomada **condicionalmente** para no serializar las ediciones
> de nombre. **Verificación con mutación, y dos que se le cayeron al coder y REPORTÓ:** 🔴 **M8 sobrevivió
> la primera vuelta** —un guard que dispara **de más** sólo se nota cuando no queda ningún admin, y no
> había ese caso; **y no era cosmético: habría roto el CI**, porque las pruebas de integración corren en
> un sistema sin administradores—; y 🔴 **su propio mock mentía**: el `tx` falso trataba una clave
> **ausente** del `where` como `undefined` en vez de *"no filtrar"*, **haciendo parecer el guard más
> estricto de lo que era**, y por eso dos mutantes morían **por la prueba equivocada**. *Es la deuda
> declarada de la casa —"una prueba que mockea tu suposición prueba tu suposición"— cazándose a sí misma.*
> El lead **re-mutó por su cuenta** la protección de `roles.administrar`: 1 roja de 15. La pantalla
> **avisa sin esconder ni deshabilitar** (§Post-F9.68: el servidor decide) y **los mensajes dicen la
> salida**, no sólo el «no». 🔴🔴 **Y el reviewer RECHAZÓ por una QUINTA PUERTA — la única que no la abre
> un administrador:** `registrarIntentoFallido` del login escribe la **MISMA columna `bloqueado`** que el
> guard protege, **sin guard, sin lock y sin conteo**. El escenario del arranque, exacto: Daniel es el
> único admin, **teclea mal su contraseña cinco veces**, se bloquea solo, Aurora (Gerencial) **no puede
> desbloquearlo**, y **re-correr el seed tampoco rescata** (`sembrarAdmin` hace `upsert` con `update: {}`
> y no toca esa columna) → **sistema cerrado por dentro**, recuperable sólo entrando a la base a mano.
> Ahora, si bloquear esa cuenta dejaría al sistema sin nadie: **los intentos suben pero NO se bloquea**, y
> queda constancia en bitácora. El lock se toma **sólo cuando el intento va a transicionar**, y se
> **re-lee bajo él**. ⚠️ **Contrapartida dicha en voz alta (falta que Daniel la ratifique):** al último
> admin vivo ya no se le bloquea la cuenta por intentos — el **rate-limit de login** sigue siendo la
> defensa real contra fuerza bruta, y el bloqueo por intentos nunca lo fue (*cualquiera que sepa un
> username puede dispararlo contra su dueño*). 🔴 **Esa quinta puerta rompía una prueba de integración y
> se cazó al verificar:** `auth.int.test.ts` bloqueaba al **`admin` sembrado**, que es el único
> administrador de esa base → habría puesto el CI en rojo (misma familia que el mutante M8). Se corrigió
> con un usuario de **Ventas** y **ganó dos pruebas de punta a punta** (al único admin no se le bloquea y
> entra con su clave; con dos admins sí se bloquea). ⭐ **El SEED también podía desarmar el guard:**
> `sembrarRoles` sincroniza borrando lo que sobra, así que si Daniel le da `usuarios.administrar` a
> Gerencial y luego se quita el suyo (**el guard lo permite, y hace bien**), el siguiente deploy con
> `SEED_ON_START=true` se la arrancaba → cero administradores, **y sin transacción de aplicación el
> advisory lock ni se entera**. Ahora el seed **otorga pero NUNCA revoca una clave de gobierno**, y al
> terminar **grita en los logs de Railway** si no queda nadie con cada clave. 🔴 **Declarado y NO hecho:**
> **no se revocan las sesiones vivas** — quitarle el rol a alguien **no lo saca en el acto**; sus permisos
> le valen hasta que vuelva a entrar (preexistente, ajeno a este defecto). ⚠️ **Sin cobertura medible
> aquí:** el seed sólo se ejercita en pruebas de integración (CI), su mutación no se pudo correr.
>
> ✅ **`V1-E6b` · EL ALTA DE COLOR SE ABRE DONDE SE COMPRA ⭐** (25-ago, **0.025**): §Post-F9.106, de
> Daniel probando las OP 5562/5563/5564 — *"ya jaló los pantones desde la OC del cliente, ahora quiero
> comprar con esos pantones **pero no me deja**"*—, confirmada por él para el jueves. El renglón ya
> dejaba **DECIR** de qué color se compra pero **sólo ELEGIR entre los existentes**; sin colores mandaba
> al catálogo, **fuera de la compra** — el defecto que V1-E4d ya había corregido para las direcciones.
> ⭐ **La mitad difícil ya estaba:** el pantone de la OP **ya viajaba** hasta ahí y el sistema ya sabía
> proponer por *mismo-pantone*; **faltaba la puerta, no el dato**. 🔴🔴 **Y había una mina, esquivada por
> medirla ANTES de escribir:** no existía forma de agregar UN color a una tela — la gestión es
> **SET-COMPLETO** (`deleteMany` de lo que no venga), así que reusar ese camino desde la compra **habría
> borrado todos los demás colores de la tela**. Se construyó `agregarColorATela` **aditiva**, reusando lo
> que el set-completo ya cuida. *Buscar cómo se hace hoy antes de decidir cómo se hará mañana convirtió
> un desastre silencioso en una función de veinte líneas.* ⭐⭐ **El permiso se abre donde se compra, no
> donde se administra:** el natural parecía `telas.administrar`, y **habría dejado la función inútil para
> quien la pidió** —se resta desde Directivo hacia abajo, y Daniel acababa de dar de alta a **AURORA con
> rol Gerencial** para probar compras: **no lo tiene**—. Girado a **`compras.administrar`**, con el
> precedente que ya estaba en el sistema (**`fijarPrecioDeColor` escribe un PRECIO del catálogo con ese
> mismo permiso**) y un *«no revertir por simetría»* escrito en tres sitios. Verificado con la mutación
> que importa: revertir a `telas.administrar` pone **9 de 23** en rojo. ⚖️ **El coder se desvió del
> encargo con evidencia:** se le pidió *girar* el `puedeAltaColorTela` del frontend y lo **eliminó** —
> apuntarlo al mismo permiso que ya gatea el bloque dejaba **dos nombres para un solo booleano**, una
> rama inalcanzable y **un guard que ninguna prueba puede ejercer**; archivarlo como menor es lo que §7.3
> prohíbe. **Un permiso, un gate.** Decisiones que se conservan: **duplicado = 409** (devolver la fila
> vieja en silencio descarta lo recién capturado y **se compraría con otro precio**), **`nombreComplemento`
> viaja** (o la pantalla ofrecería un campo que el servidor rechaza), el diálogo **vive en el módulo del
> catálogo al que escribe**, y el precio **se pide sin obligar** (es informativo; el real va por lote).
> 🔴🔴 **LA NOCHE DE LOS TRES REINICIOS:** el contenedor se reinició tres veces y **el disco se revierte**;
> el primero se llevó **una entrega completa, terminada y validada, sin comitear**. Se recuperó porque
> **el transcript del agente sobrevive**: se le pidió al MISMO coder que **reaplicara** desde su contexto
> —mucho más barato que rehacerlo—, y él verificó que la base había cambiado (`prueba` pasó de 0.023 a
> 0.024 mientras trabajaba) releyendo antes de editar, **y de propina corrigió un dato que el lead le dio
> mal**. La regla que sale, ya en el recordatorio horario: **comitea EN CUANTO algo funcione** —comitear
> no es publicar, nada llega a `prueba` sin reviewer y CI—, porque **sólo git es durable**. El tercer
> reinicio lo demostró: la regla ya estaba aplicada y **los tres commits sobrevivieron intactos**.
>
> ✅ **`V1-E6a` · EL CIERRE PEDÍA 53 VECES DE MÁS, Y LA EXPLOSIÓN SE LO CALLABA ⭐⭐** (24-ago, **0.024**):
> §Post-F9.105, y **salió de Daniel usando el sistema** —*"la compra de los cierres me está dando una
> cantidad muchísimo mayor de la que necesito… no sé dónde está el error de cálculo"*—. **No era un error
> de cálculo:** era un **dato contradictorio** que la explosión usaba **sin decir nada**. Un avío lleva por
> talla **cuánto GASTAS** (0.75 m de elástico) **o qué MEDIDA pides** (el cierre de 53 cm, 1 pza) —§Post-F9.66
> existió para separarlas— y la regla que decide es **una sola en todo el sistema**
> (`medidas-avio-talla.ts:166`): *¿el avío tiene ≥1 medida ACTIVA en su catálogo?* ⭐ El interruptor está en
> el **catálogo de Avíos, no en el modelo**. Si en una captura vieja la **longitud** quedó en el campo de
> cantidad, `requeridoAvioReceta` la multiplica por las piezas → **53× inflado**. 🔴 **Seguía vivo porque la
> corrección fue PROSPECTIVA:** `copiarRecetaDelModelo` apaga la bandera desde el **18-ago-2026**
> (`a92c044`); antes copiaba `consumoPorTalla` a secas. Y **ninguna puerta re-normaliza una OP existente**
> —se abstiene si ya hay renglones (`:265-270`), `traerDelModelo` **nunca escribe sobre un renglón que ya
> existe** (`:2769-2777`), y `calcularDesalineacion` (`:674-820`) **sólo compara `consumoPorPrenda` y
> `precio`**, así que corregir el modelo **no levanta ni una alerta**—. ⇒ **toda OP anterior al 18-ago** con
> un avío de medidas activas puede traerlo: **no eran dos**. **Entrega:** el `select` de `mrp.ts` ahora trae
> el conteo de medidas activas —**el único hecho del que sale "es por medida"**, y que no tenía— y el aviso
> viaja **pegado al renglón** con **la MAGNITUD** (*"el requerido sale MULTIPLICADO por 53: 1,590 pza en vez
> de 30 pza: 1,560 pza de MÁS"* — el multiplicador va pegado al TOTAL, que es a lo que multiplica).
> ⭐⭐ **Dónde se pinta fue una DECISIÓN:** ya existía una caja `exp-avisos`, pero se titula *«Notas de la
> explosión (precios y proveedores)»*, va en gris y vive **después** de todos los renglones — soltar ahí un
> *"pides 53× de más"* habría sido **mostrarlo y esconderlo a la vez**, el patrón exacto que la etapa vino a
> arreglar. **Una sola redacción** (`unidades-avio.ts`) para las tres pantallas, con la **cuenta** aparte en
> `receta-avios.ts`; y el «normalizado» se pide a **la misma función** con la bandera apagada —nunca
> reimplementando el requerido, que es el hoyo del que salió todo—. Además: el aviso de la receta **sale del
> desplegable colapsado** a la fila; **cualquier guardado normaliza** (`:1929` perdió el
> `&& datos.tallas !== undefined` — *lo que el aviso llevaba meses prometiendo*); un **DETECTOR**
> (`migracion/analisis/avios-por-medida-contradictorios.ts`) que lista las OP vivas afectadas con su exceso,
> si están liberadas y si ya tienen OC; y **la revisión previa deja de ser muda** (el hueco que el coder
> declaró y el lead mandó cerrar: es **la pantalla donde se confirma la compra**). ⚖️ **El choque con
> `exigirNoSacarLoComprado` se MIDIÓ en vez de suponerse:** normalizar puede mandar el requerido a 0 y
> disparar la guarda en un PATCH donde alguien sólo cambió el precio — **la guarda NO se quitó** (hay dinero
> comprometido); se corre `sacaDeLaCompra` **otra vez con la bandera vieja** para saber de quién es la culpa,
> y si fue la normalización el error **nombra la causa y la salida** en vez de mandar a des-autorizar una OC
> sana. *La diferencia entre un mensaje que acusa y uno que informa.* Se cerró de paso un **hueco de
> auditoría** no pedido (la bandera se apaga por decisión del sistema → ahora va explícita en la bitácora:
> *un cambio que nadie pidió y que no se registra es indistinguible de uno que se calló*). 🔴 **La mutación
> que SOBREVIVIÓ vale más que las 12 que murieron:** pisar en vez de acumular las piezas por talla pasó en
> verde **porque el fixture tenía UNA sola línea de matriz** — pero una OP real trae **una por color**, así
> que en cualquier OP multicolor el aviso habría dicho una magnitud **falsa**, y justo en el caso más común.
> Añadido el caso y re-mutado: **ROJO**. *Fixture pobre, no código malo — pero el código no estaba protegido,
> que para el caso es lo mismo.* 🔴 **Declarado y NO cerrado:** la **habilitación/surtido** enseña el mismo
> número inflado sin explicación (mismo arreglo, otro módulo) · el impreso PDF no lleva el aviso · **sin
> backfill masivo** (~~§Post-F9.105 decidió que se arregla guardando, auditado~~ → 🔁 **desde `V1-E8h`
> (§Post-F9.130) se arregla con el botón «Corregir»**; lo que **sigue vigente** es que **no hay backfill
> masivo** — ~~y espera la palabra de Daniel; **el detector es la lista de trabajo**~~ → 🔁 **cerrada NO
> el 28-ago (§Post-F9.132): no se hace backfill, la limpieza se muda al ETL del arranque
> (§Post-F9.133)**) · el detector no mira el
> BOM de los modelos · y 🔴 **`calcularDesalineacion` sigue comparando
> sólo consumo y precio**, así que cambiar las medidas por talla de un modelo **no marca desalineada** ninguna
> OP — el hermano del defecto que esta etapa arregla, **sigue abierto**. Contrato: **+1 campo aditivo**
> (`avisos` en el renglón). SIN migración, SIN permisos.
>
> ✅ **`V1-E5` · LOS DÍAS DE CRÉDITO DEL CLIENTE: LA CARTERA DEJA DE MENTIR ⭐⭐** (24-ago, **0.023**):
> §Post-F9.98, y **no salió de una pantalla ni de una revisión** sino de leer el código preguntando
> *"¿qué de lo que va a producción está mal HOY?"*. 🔴 **Estaba mal el aging de CxC entero:**
> `Cliente.diasCredito` ya existía (`schema.prisma:1179`) y ya se podía capturar, pero
> `exigirTercero` (`dominio/terceros/terceros.ts`) **no lo leía** —su `select` pedía sólo `{nombre,
> activo}` y devolvía **`diasCredito: 0` a fuego**, con un comentario fósil que decía *"llega en
> E4"* cuando **E4 había llegado hacía mucho**—. Como de ahí sale el vencimiento que se sella en
> cada cargo, **toda la cartera de clientes envejecía como si fuera de contado**: una factura a 30
> días capturada hace 20 caía en *«1 a 30 vencido»* en vez de en *«corriente»*. ⭐⭐ **Por qué llevaba
> tanto invisible — la ASIMETRÍA, por triplicado:** (1) la rama del **proveedor**, tres líneas más
> abajo, **sí** leía su plazo, así que el archivo parecía simétrico de un vistazo; (2) **el ETL
> también estaba bien** (`loaders/terceros-saldos.ts:313-324` lo leía para los dos terceros por
> igual) — *el camino de carga correcto y el camino vivo roto*, de modo que revisar la migración
> daba verde; y (3) 🔴 **ninguna prueba discriminaba**: `config-aging.int.test.ts:90` creaba su
> cliente con `diasCredito: 0` (*"Cliente contado"*) y **pasaba idéntico con y sin el defecto**, y
> `terceros-motor.int.test.ts:146` sí probaba la derivación… **por PROVEEDOR**, la rama que nunca
> estuvo rota. *Había cobertura y no cubría nada.* El arreglo son **tres líneas** —idénticas a la
> rama del proveedor, no una segunda forma de decir lo mismo— más los **tres** comentarios fósiles
> borrados (el commit presumió de «dos» y se le quedó vivo el del archivo hermano,
> `terceros/migracion.ts`; corregido en la ronda del reviewer). ⭐ **Y una prueba UNITARIA que sí
> corre sin base de datos y que se pudo MUTAR de verdad**: su `tx` falso **respeta el `select`**
> (proyecta sólo lo pedido, como Prisma), y por eso caza **las dos** formas de romperlo —el `0` a
> fuego y quitar el campo del `select` dejando el `?? 0`—. **Mutación medida por el lead**, no
> reportada: `expected +0 to be 45` / `to be 30`, 2 rojas de 4. ✅ **Lo prospectivo (§Post-F9.98 (e))
> salió GRATIS y se comprobó ANTES de tocar nada** —era el riesgo que podía volverla una etapa
> mayor—: el vencimiento se **sella** en `movimientos_tercero.fecha_vencimiento`
> (`cuenta-terceros.ts:194`) y el aging agrupa por **esa columna**, nunca recalcula desde el
> catálogo, así que arreglar los días **no mueve ni un cargo ya emitido**. 🔴 **Lo que NO hace, dicho
> y no enterrado:** **editar el plazo factura por factura** (§Post-F9.98 (b)) **no existe** —ni
> endpoint, ni dominio, ni pantalla— y es trabajo aparte, diferido al post-arranque porque
> **Finanzas no entra en la primera versión**; y 🟡 **NINGUNA de las dos pantallas de aging muestra
> la columna de días de crédito** —`CxcPagina.tsx` y `CxpPagina.tsx` no referencian `f.diasCredito`,
> aunque los dos backends ya la mandan en cada fila—, más la asimetría de captura: **Proveedores**
> enseña el plazo en su panel de detalle (`ProveedoresPagina.tsx:629`) y **Clientes** sólo dentro
> del diálogo de edición. Pintarla **NO cambia el contrato** (`contrato/esquemas/cxc.ts:138` ya la
> lleva): se difiere porque **no toca antes del arranque**. ⚠️⚠️ **EL CÓDIGO SANO NO ARREGLA LOS
> DATOS:** el ETL del catálogo de clientes **no carga `dias_credito`**, así que todo cliente migrado
> nace en `NULL` = contado — **con el catálogo vacío, el código arreglado da la misma cartera que el
> roto**. 🔴 **El ETL de apertura de Finanzas NO debe correrse antes de que Daniel capture los días
> de crédito de sus clientes.** SIN migración, SIN permisos, SIN cambio de contrato.
>
> ✅ **`V1-E4f` · LA BARRA DE LA COMPRA: FECHA A FUERZAS, Y EL ALTA DENTRO DEL DESPLEGABLE ⭐**
> (24-ago, **0.022**): dos decisiones de Daniel que van juntas porque viven en la misma barra de
> «Explosión de materiales», y las dos salieron de él **mirando la 0.020**. *"La [fecha] de entrega no
> debería de poder estar vacía. **Tiene que tener fecha de entrega a fuerzas**"* (§Post-F9.103) y,
> viendo el botón «＋ Dirección» suelto, *"**está mejor dentro del cuadro desplegable. Casi no se va a
> usar. No tiene caso tener un botón para eso**"* (§Post-F9.104). ⭐⭐ **Lo primero no fue construir sino
> MEDIR dónde faltaba de verdad — y casi todo ya estaba hecho:** el alta manual (`crearOC`) y la
> explosión (`planearCompra`, que la devuelve como bloqueo) **ya exigían** la fecha; 🔴 **la puerta que
> quedaba abierta era DUPLICAR**, que copiaba `fechaEntrega` tal cual — y como el ETL escribe `null`
> cuando el CSV viene en blanco (`migracion/loaders/ordenes-compra.ts:354`), duplicar una de las **7,978
> OC migradas** que llegara sin fecha **paría hoy una OC NUEVA sin fecha**: un documento que nace mudo
> sobre el *cuándo*, sin compromiso que reclamar, retraso que medir ni nada que meter a la ruta crítica.
> *(Cuántas de las 7,978 están así **no se midió**: los CSV del volcado no están en el contenedor. El
> defecto no necesita el conteo — basta con que la puerta exista.)* Cerrado con `motivoNoDuplicarOc`
> (pura y exportada, para que una prueba la vea **sin base de datos**) dentro de la transacción de
> `duplicarOC`, ⚠️ **prospectivo** (decisión (e)): la OC vieja **se queda como está**, sólo se impide que
> el defecto se propague — y el mensaje **dice el camino** en vez de sólo negarse (*"captúrasela primero
> en Editar › «Fecha de entrega» y vuelve a duplicarla"*). ⭐⭐ **En pantalla, la validación mira EL PLAN,
> no el formulario:** §Post-F9.71 ya había fijado que **la fecha propia del proveedor GANA** y que la de
> arriba es sólo *el valor inicial de todas*, así que lo obligatorio es **que cada OC tenga fecha, NO que
> el campo de arriba esté lleno** —pedirlo sería reclamar un dato ya capturado en otro lado—. La cascada
> de la pantalla es **la misma del servidor y en el mismo orden** (verificado leyendo `resolverFechasDeOc`
> en `mrp.ts`, **búscalo por nombre**: `propia del proveedor ?? base ?? la entrega más próxima de sus OP`;
> el respaldo es no-nulo **si al menos una** OP trae fecha, el predicado exacto que usa la pantalla).
> ⚠️ **Y su margen de error quedó ESCRITO en el código:** la pantalla no puede reproducir el plan entero
> (el servidor aplica además la firma de Desarrollo y los ajustes del comprador), así que se le pidió lo
> contrario de la precisión — **que jamás bloquee de más**: lo peor que pasa es que se pida una fecha de
> sobra, **nunca** que salga una OC sin ella, porque **la autoridad sigue siendo el servidor** (A1). El
> aviso usa el **mismo trato** que el de la dirección (§Post-F9.96: gris al abrir, amarillo sólo al
> intentar generar, foco al campo) porque Daniel lo pidió así *"para que nadie tenga que aprender dos
> reglas"*, y ⭐ **los dos faltantes se dicen de un solo golpe, no en cascada** —un `return` temprano
> habría dejado el segundo en gris y el comprador se habría topado un amarillo nuevo tras arreglar el
> primero—. ⚖️ **§Post-F9.104 no contradice §Post-F9.96, la AFINA:** la opción de alta sigue a un clic, en
> el mismo control donde ya estás mirando; lo que se corrige es el **peso visual** — *la frecuencia manda
> sobre la barra*, y un botón permanente le quitaba espacio a lo diario (selector, fecha, «Revisar y
> generar OC») para servir a un caso excepcional. **Ruido permanente por un caso raro es la misma falla
> que los nueve avisos amarillos.** Va **al final y separada**, 🔴 **se pinta aunque el catálogo esté
> VACÍO** —justo cuando más se necesita: esconder la única puerta detrás de una lista sin elementos
> dejaría al comprador sin salida, el defecto que V1-E4d había arreglado—, compara `'nueva'` **antes** de
> convertir a número (`Number('nueva')` es `NaN`, y un `NaN` de `idDireccionEntrega` sería el dato
> inventado que §Post-F9.86 prohíbe), y **esconde Y bloquea** (§Post-F9.68). 🔴 **El accidente de la
> noche:** el coder original **murió a media faena** (*API 529 Overloaded*, 04:02) y no lo delató el
> estado del proceso sino **el `mtime` de sus archivos** —dos horas y media sin escribir—; su trabajo
> estaba **intacto y sin comitear**, y lo salvó que **nadie más tocaba el árbol** (la regla de UN CODER A
> LA VEZ). Un segundo coder lo remató con el encargo explícito de **revisar lo que el muerto dejó**,
> porque nadie lo había mirado. *La señal de vida de un agente es el `mtime` de lo que escribe, no que el
> proceso siga listado.* ⭐⭐ **Y el segundo coder no sólo remató: destapó dos cosas del trabajo del
> primero.** (1) 🔴 **El mensaje mandaba por un camino CERRADO** — decía *"captúrasela en Editar"*, pero
> el ETL le hereda a cada OC migrada el estatus que traía de Access (`estatusOCMigrada`, loader `:212`:
> **`cancelada` > `autorizada` > `borrador`**) y `actualizarOC` **bloquea al no-admin** sobre una
> autorizada (`ordenes-compra.ts:957-960`): al comprador se le ofrecía una salida cerrada, **el mismo
> defecto que un reviewer ya cazó en este track** (*culpar al comprador de algo que el sistema no le dejó
> hacer*). Arreglado en la misma ronda: la función recibe el **estatus** y añade que esa captura la hace un
> administrador — 🔴 **sin recibir la sesión ni `esAdmin`**, para que **siga siendo pura y sin base de
> datos**: que un admin lea el aviso de más es inofensivo, que el comprador no lo lea no lo es. *Un mensaje
> que ofrece una salida cerrada es peor que uno que no ofrece ninguna.* ⭐⭐ **Y el reviewer del PR cazó que
> ese mismo arreglo MENTÍA en un tercer caso**: a la **`cancelada`** no la edita nadie —`actualizarOC` la
> rechaza *antes* de mirar quién eres, y es terminal—, así que prometerle un administrador la mandaba por
> la misma puerta cerrada. **La raíz, escrita para no repetirla:** se copió de `actualizarOC` el predicado
> `!ESTATUS_EDITABLES_NORMAL.includes(estatus)` **sin la guarda de la línea de arriba**, que era la única
> razón por la que allá significa *"sólo un admin"* — la misma lista, despojada de su guarda. Hoy la
> cancelada tiene **su propia rama**, que ofrece la salida que sí existe: levantar la compra a mano en
> Compras › Nueva. (2) 🔴 **Un FALSO VERDE del lead**: reportó los comandos del frontend en verde con
> `format:check` en **ROJO** (Prettier, un `<option>` partido en cuatro líneas). **La misma cicatriz del
> 14-ago con otro disfraz** — allá fue el comando suelto, aquí medir **a tiempo pasado** y no repetir tras
> la última edición. La regla que faltaba, y queda escrita: ⚠️ **una validación sólo vale para el árbol
> que se midió; "lo corrí hace rato" no es haberlo corrido** — y el **CI sigue siendo el único juez**.
> **Verificación: 20 mutaciones, TODAS rojas** (entre ellas las dos que el lead exigió: quitar la opción
> del desplegable y reponer el botón suelto), y la de **integración** es la única que mata *"quitar la
> llamada en `duplicarOC`"*: anula la `fechaEntrega` por Prisma como las migradas, exige el rechazo y
> comprueba que **no nazca una segunda OC**. ⚠️ **Y se dice lo que el arreglo NO logra:** el mensaje **dejó de mentir, no dejó de ser un rebote** — el comprador sabe a quién acudir, pero sigue sin poder resolverlo él mismo; hacerlo en el acto (pedir la fecha dentro del propio duplicar) **sería alcance nuevo** y no se hizo.
>
> ✅ **`V1-E4e` · EL IMPRESO DE LA OC: CONSOLIDADO Y SÓLO AUTORIZADO ⭐** (24-ago, **0.021**): dos
> decisiones de Daniel que van juntas porque tocan el mismo PDF, y las dos salieron de él **usando el
> sistema**. *"Nunca debe de dejar imprimir una orden que no esté autorizada… **ni aunque diga
> borrador**. Para no generar confusiones con el proveedor"* (§Post-F9.101) y, tras generar la OC 7965,
> *"**para el proveedor debe de salir solamente una sola cantidad sumando todo el rojo**… las órdenes a
> las que corresponden **no son relevantes para el proveedor**"* (§Post-F9.102). ⚖️ **La consolidación no
> contradice §Post-F9.86: la COMPLETA** — aquella decía *"se ve junto y se guarda repartido"* y faltaba
> **la tercera cara, lo que sale a la calle**: guardado por material×OP (costos), pantalla con el
> desglose (control del comprador), **impreso con una cantidad por material y sin folios de OP**. Y no
> es sólo ruido: **son números internos que el proveedor usaría como referencia para facturar**, creando
> una correspondencia que el sistema no reconoce. Entrega `motivoNoImprimirOC` **reusando
> `ESTATUS_OC_COMPROMETIDA`** —⭐ de ahí **la cancelada sale gratis**, sin una línea escrita para ella—,
> guarda en el **SERVIDOR** con **las mismas dos frases** que la pantalla, `consolidarRenglonesParaProveedor`
> que **no fusiona con precios distintos** (nada se promedia), 🔴 el campo `folioOrden` **borrado del
> TIPO** —*sin campo, ningún cambio futuro lo recuela*— y las matrices talla×color **sumándose** al
> fusionar, o el papel se contradiría a sí mismo. ⭐⭐ **Y el coder destapó un defecto PRE-EXISTENTE que
> nadie había reportado y que el lead mandó arreglar aquí:** el impreso **nunca había mostrado el
> complemento de tela**, pero **su importe SÍ estaba sumado** → `cantidad × precio ≠ importe`, el
> proveedor **no podía reconstruir la cifra** y **ni se enteraba de que debía mandar el Cardigan**; la
> pantalla sí lo mostraba, **el papel se lo callaba**. *Entregar una etapa que arregla el impreso "para
> que no confunda al proveedor" dejando dentro una confusión mayor sería incoherente.* 🔴 **Y el hallazgo más caro
> salió en la revisión: con el complemento a PRECIO 0 y dos renglones fusionados, el impreso sacaba un
> importe NEGATIVO** (`+ $-0.01 de Cardigan`) — **frecuencia medida 12.1 %** de ese escenario, y
> **alcanzable**: basta un Cardigan *"incluido"* a $0 con la misma tela pedida para dos OP, **el caso
> exacto de la OC 7965**. Cerrado con un tope que **por construcción impide que cualquiera de las dos
> mitades baje de cero**. ⚖️ **Y una corrección de rumbo de DANIEL que vale más que el arreglo:** el lead
> escaló los tres hallazgos del reviewer a una ronda de pruebas de centavos y él cortó —*"no importan los
> centavos así, no te claves en eso"*—; el alcance se recortó al **signo**, no al centavo, y **la etapa
> dejó de prometer que la cuenta cuadra a la vista** (al fusionar puede diferir por un centavo, ~25 % de
> las veces; es irreducible porque el total está fijado). *Una promesa que no aporta al negocio no se
> cumple: se retira.* 🔴 **De paso se corrigió una afirmación FALSA de la propia ficha** —decía que esa
> aritmética estaba *"fijada con prueba"* y **no lo estaba**: el reviewer la sustituyó por un recálculo y
> **la suite completa pasó**, porque todas las pruebas usaban **números redondos**. Habría sido la quinta
> del track, y **la escribió el lead** repitiendo al coder sin comprobarlo; *una prueba con números feos
> habría destapado el negativo por su cuenta*. ⭐ Y el coder rechazó una simplificación que el lead le
> ofreció — **la decisión era correcta pero la razón escrita NO, y el reviewer la midió**: recalcular las
> dos mitades por multiplicación **no puede dar un negativo** (es el producto de dos no negativos); lo
> que hace es **dejar de CERRAR en el 30.7 %** de los renglones fusionados con complemento —*el bloque
> que existe para explicar el importe pasaría a contradecirlo*—, mientras que la variante que sí cierra
> mueve el negativo **al cuerpo** (3.0 %). ⚖️ *«Rechazó con evidencia» sólo se sostiene si la evidencia
> es la que se midió: una decisión correcta sostenida por una razón falsa es la misma enfermedad que
> esta ronda vino a curar, sólo que del lado de la cura.* **49 mutaciones, 49 muertas**, incluidas dos
> supervivientes de la primera vuelta que **eran defectos reales**: una **aliasaba** el complemento en
> una función anunciada como PURA (fusionar le cambiaba el dato a quien lo pasó), y otras cambiaban
> **varios campos de la clave a la vez**, así que no distinguían nada. **Sin migración, sin permisos
> nuevos, sin seed, sin cambio de contrato.**
>
> ✅ **`V1-E4d` · LOS OCHO AVISOS RESTANTES, EN SU LUGAR ⭐** (23-ago, **0.020**): continuación directa
> de E4c, con la misma regla (§Post-F9.96) aplicada a los **ocho amarillos que quedaban** apilados
> antes del primer renglón. ⭐ **El inventario del LEAD resultó equivocado en un punto y el coder se
> plantó con evidencia:** `huboCambios` y `desalineacion` parecen el mismo aviso y **no lo son** —el
> primero compara la explosión **contra su propio snapshot anterior** y se arregla **volviendo a
> explotar**; el segundo compara la **receta congelada contra el BOM vivo** y **no se arregla
> explotando**, hay que traer el cambio a mano, y en rojo cuando la orden **ya tiene compras**.
> Fundirlos habría borrado **dos causas y dos remedios distintos**. *Tercera vez en el track que un
> agente corrige al lead con razón.* De los otros: uno era **duplicado exacto** (borrado), uno era la
> **leyenda de las etiquetas** y no un aviso, y dos eran **información pintada como problema** (una
> incluso verde y otra azul) → **una sola línea gris de resumen**; lo que tiene detalle bajó **DEBAJO de
> la lista**, sin alarma; y los avisos de verdad salen **al pulsar «Revisar y generar»**, calculados en
> el servidor y **descontando lo que la OC sí va a escribir** —*un material liberado después de explotar
> se compra igual, y decir "no entra" sería mentir*—. **La dirección de entrega sigue BLOQUEANDO**
> (Daniel, 23-ago); lo que cambió es **cuándo se dice**: gris junto a su campo, amarilla **sólo al
> intentar generar**, con el foco al campo — y **se puede dar de alta sin salir de la pantalla**,
> reusando el diálogo del catálogo con `compras.administrar`, **el mismo permiso que el servidor ya
> exige**. **26 mutaciones, 26 muertas**, ⭐ **siete de ellas protegiendo el DISEÑO y no la lógica**
> (que el resumen se pinte como alarma, que los bloques vuelvan al amarillo, que las notas vuelvan
> arriba del primer renglón): *si alguien revierte lo que Daniel pidió, algo se pone rojo.* ⚠️ **UNA
> superviviente** declarada, del cableado servidor y **sólo matable en CI** — con **dos pruebas de
> integración escritas por adelantado**, aplicando la lección de E4c. *(Este renglón decía «dos»: era el
> conteo de la 1ª vuelta, que las vueltas 2 y 3 dejaron atrás —2 → 1 → 1, el filtro del arte SÍ se pudo
> matar—. Corregido en `V1-E8m`, donde además se cuentan las **costuras sólo-CI**, que son otra cosa y
> son dos.)* **Sin migración, sin permisos
> nuevos, sin seed.**
>
> ✅ **`V1-E4c` · EL COLOR DE LA TELA SE DICE EN SU RENGLÓN ⭐⭐** (23-ago, **0.019**): Daniel, probando
> la 0.017, *"no puedo comprar las telas por color"*. 🔴 **La función existía desde la 0.013, completa
> y verificada: el defecto no era de lógica, era de UBICACIÓN.** Al enseñarle dónde estaba: *"ya vi
> dónde está, **pero no me gusta que sea ahí**. ¿Por qué no poner la opción **directo en el renglón de
> la tela**? … **los avisos en amarillo salen muchos y confunde lo que realmente se busca**"*, y *"está
> muy rebuscado… no me gustó la interfaz"*. De ahí salió **la regla que rige de aquí en adelante**
> (§Post-F9.96): *"el proceso normal es **llenar ahí la información**… **primero que dé la opción de
> meterlo, y si no se hace, entonces que mande los mensajes en amarillo**"* — o sea: **capturar es el
> proceso NORMAL y el aviso es la CONSECUENCIA de no llenar**; hoy la pantalla hacía lo contrario,
> recibía con **nueve** avisos amarillos apilados y el lugar de arreglar cada cosa **dentro del
> regaño**. El hueco, en tres hechos: el único camino era un enlace **dentro** del amarillo; ese aviso
> **sólo salía si el color faltaba**, así que **corregir uno ya dicho no se veía por dónde**; y ⭐ **la
> forma que Daniel pedía YA EXISTÍA a dos líneas en el mismo renglón** —«asignar proveedor»—, *el color
> se había salido del patrón sin razón*. Entrega: la captura **inline en el renglón**, siempre
> disponible, listando **todos** los casos (OP × color de prenda) que le tocan a ESE renglón y **sin
> aplicar nada por su cuenta**; el amarillo **fuera de la entrada** y reaparecido en la **revisión
> previa**, sólo por lo que de verdad se escribe (avisa, **no bloquea**); **con la OC autorizada el
> color no se cambia** (el camino es des-autorizar, §Post-F9.79); y 🔴 **la orden sin matriz de colores
> DICE qué le falta en vez de ofrecer un campo que no puede guardar nada** —de paso cierra un hueco que
> nadie había reportado: ese caso **se compraba sin color y el sistema no avisaba**—. ⭐ **El coder
> corrigió el encargo del lead, con razón:** `comprometidoEnOc()` **no servía** para esta regla (su
> lista incluye el `borrador`, porque contesta *"¿hace falta recomprar?"*, y aquí se pregunta *"¿ya me
> comprometí con el proveedor?"*); lo reusable era la lista **privada** de `receta-orden.ts`, que se
> movió a `comprometido-en-oc.ts` con el TSDoc de **por qué son dos y no una**. Dos precisiones suyas:
> el bloqueo va **por (tela, COLOR)** —una guarda por tela habría cerrado el camino que la etapa abre—
> y **las 7,978 líneas de OC sin color NO bloquean**, o ninguna orden histórica podría capturar sus
> colores nunca. **Sin migración, sin permisos nuevos, sin seed.**
> 🔴 **Rechazada en su primera versión por DOS frentes a la vez —el reviewer y el CI— y corregida:** el
> backend salió **rojo con 3 de las 7 pruebas de integración del propio coder**, las que verifican la
> regla (C). ⭐ **Era UNA sola causa y NO la guarda:** el fixture compraba **sin explotar materiales
> antes**, y como `planearCompra` lee el snapshot, el bucle que crea las OC **no iteraba ni una vez** y
> devolvía lista vacía **sin lanzar error** — así que no había nada que autorizar y por eso *"el bloqueo
> es por color"* fallaba. ⚖️ **Y el arreglo destapó algo peor: la prueba de «en borrador sí se puede
> cambiar» estaba pasando EN EL VACÍO** —verde por la razón equivocada—; ahora **el fixture se comprueba
> a sí mismo** (1 OC, en `borrador`, con una línea por tono) y **un fixture vacío ya no puede pasar por
> verde**. Del reviewer, dos hallazgos de cara al usuario: 🔴 el enlace *«Ver todos los colores…»* **que
> esta misma etapa agregó** dejaba cambiar un color que el servidor rechaza con 409 —incoherencia
> introducida por el commit—, y 🔴 **después de guardar bien, el bloque decía «la orden N ya no tiene
> colores en este renglón»**: *el único acuse de recibo de un guardado exitoso era un mensaje diciendo
> que no hay nada*, y pasaba también en la primera captura. Tirando de ese hilo salió un segundo
> defecto: el bloque **se cerraba solo** al terminar la primera captura, porque se identificaba por el
> id de snapshot y decir un color **recalcula la explosión con ids nuevos**. Más: `plan.avisos` **sin
> ninguna prueba** (el patrón *«se construye y nadie lo ve»*, el mismo que originó la etapa), la trampa
> del `beforeEach` estático **mordiendo otra vez**, y 🟡 **una regla puesta en boca de Daniel como cita
> textual** —no la dijo: es un default del lead no objetado, §Post-F9.96(f)—, que aquí no es detalle:
> *una cita atribuida es fuente de verdad del negocio*. ⚠️ **Y se corrigió la propia ficha:** decía *"18
> mutaciones, 18 muertas, 0 supervivientes"* y había **3 supervivientes** — la cuarta afirmación del
> track que se leía como verificada sin estarlo.
> 🔴 **Y una ÚLTIMA MILLA que valió lo que costó:** el reviewer verificó el código **ejecutándolo** —una
> sonda con un `tx` falso que corre el dominio **sin Postgres**, 8 escenarios y 8 correctos— y aun así
> rechazó por **tres costuras que pasaban por verde sin probar nada**. ⭐ La más cara: *«el bloqueo es
> POR COLOR»* **no probaba que fuera por color** — el test cambiaba un color **que nunca tuvo amarre**,
> y la guarda sólo corre con `idAnterior !== null`, así que **la llave ni se consulta**; mutando la
> llave a `${idTela}` la sonda **pasaba 7/7**. El escenario que de verdad decide —**corregir un color ya
> amarrado** mientras otro tono de esa tela está comprado, o sea *el flujo que da nombre a la etapa*—
> **no existía en ningún test del repo**. El código estaba bien; lo que fallaba es que **la frase
> titular de la ficha y del HISTORIAL la sostenía un test incapaz de ponerse rojo por esa razón**.
> Las otras dos: una prueba que **podía pasar habiendo probado cero** *(el defecto de la ronda
> reintroducido en el lote escrito para matarlo)*, y **un estado que sobrevivía a su propio contexto**
> —el bloque reaparecía montado sobre otra orden— **abierto por el arreglo de la ronda anterior**: con
> el id de snapshot se auto-corregía, con la clave estable ya no *(y el panel de proveedor arrastraba el
> mismo accidente)*. ⭐ El coder volvió a **cazar un error suyo y decirlo**: su primera prueba de eso
> quitaba la ÚNICA OP, así que la pantalla se desmontaba y el panel desaparecía solo — *el mismo error
> que venía a corregir, en su propia prueba*. ✅ **APROBADA en la tercera vuelta**, con la **cuarta puerta**
> cerrada como entrega: la **precarga de las órdenes hermanas** era el único de los cuatro sitios que
> mueven el conjunto que **no olvidaba los paneles abiertos** — casi invisible (esa consulta llega
> antes que la explosión), pero **contradecía la regla que el propio TSDoc de la ronda acababa de
> escribir**; cerrada y con prueba. El reviewer dio el veredicto tras **ejecutar** la guarda con una
> sonda de `tx` falso —9 escenarios, y **con la llave por tela caen 2**— en vez de leerla. ⬜ Queda fuera, con su razón, el *"aplicar el mismo color a todas"*: que
> lo decida el sistema está prohibido (§Post-F9.86), pero **un botón que la persona elige** es aditivo
> y se agrega si Daniel lo pide.
>
> ✅ **`V1-E3z` · LA REVISIÓN PREVIA DE LA OC, EDITABLE ⭐⭐** (23-ago, **0.018**): Daniel, *"al hacer
> las órdenes de compra en explosión de materiales, ya hay una pantalla previa, pero **no me deja poner
> el precio correcto ni la cantidad**… **no me deja modificar nada**"* (§Post-F9.94). Era verdad:
> `RevisionPrevia` pintaba **todo como texto** y sólo ofrecía «volver» y «confirmar». 🔴 **Y la razón por
> la que nació de solo lectura NO se rompió, se conserva:** al cambiar un número la previa **le vuelve a
> pedir el plan al SERVIDOR** y repinta lo que él diga — sigue sin sumar, sin multiplicar y sin repartir
> (A1). Lo único que cambió es **dónde** puede corregir el comprador: la última pantalla antes de
> comprometer el dinero, la única donde ve el total. Entrega: campos de **cantidad** y **precio** por
> renglón; la cantidad **reusa** el canal que ya existía (`ajustes[].cantidadTotal`, §Post-F9.86, con la
> clave armada ahora en **un solo lugar** del frontend) y el precio **estrena el suyo**
> (`ajustes[].precioUnitario`, con `cantidadTotal` vuelto opcional y un `.refine` que rechaza el ajuste
> que no dice nada). La REGLA vive **pura y aparte** en `dominio/compras/ajuste-comprador.ts`, así que la
> previa y la generación son literalmente el mismo código. **Interacción:** se recalcula al **salir del
> campo** (o con Enter) y **sólo si el número cambió** — sin rebote por pulsación a propósito, porque
> teclear «1500» mandaría a planear compras de 1, 15 y 150; mientras recalcula, «Confirmar y generar» se
> apaga. **Casos feos, decididos:** vacío = *"no lo toqué"* (y es el deshacer); precio **0** se acepta y
> significa *"la línea nace sin precio"* (ya pasaba cuando la cascada no encontraba ninguno, y la OC ya
> acepta `precio ≥ 0`); precio negativo lo rechaza el contrato; un `0.004` **bloquea** nombrando el
> material (*"si de verdad va sin precio, escribe 0"*); bajar la cantidad se permite y avisa. ⭐ **Y la
> pregunta de Daniel —¿el precio corregido se recuerda?— ya estaba resuelta y se VERIFICÓ:** el costeo
> lee el último precio de la **línea de OC AUTORIZADA** (§Post-F9.48), así que se propaga solo al
> autorizar **sin escribir una sola vez en el catálogo** (§Post-F9.88), con prueba de las dos mitades.
> **De regalo, tres defectos adyacentes que la edición volvió alcanzables:** la previa prometía líneas
> que la generación se saltaba (ahora `seEscribe` viaja y la generación **filtra por él**), el total del
> renglón sumaba esas líneas fantasma, y un bloqueo **desaparecía el renglón que nombraba** (dejando al
> comprador sin campo donde corregirlo). 🔴 **RECHAZADA por el reviewer en su primera versión y
> corregida (23-ago):** `cuerpoDeCompra` **descartaba en silencio** el valor inválido (`cantidad > 0`,
> `precio >= 0`), y como el aviso de error del previo vive **sólo en la rama de la explosión —que está
> DESMONTADA mientras se ve la previa—**, teclear `-5` en «Precio» dejaba el `-5` en el campo, no
> mandaba nada, no decía nada, dejaba «Confirmar» encendido y **la OC nacía al precio anterior**: la
> frase del contrato *"El precio no puede ser negativo"* **no se ejecutaba jamás**. Es el **octavo caso**
> del patrón de la semana —*el aviso existe, pero no sigue vivo quien lo muestra*— y el mismo del toast
> que se desmontaba en V1-E3x. Se arregló **quitando la regla, no moviéndola**: *el cliente no juzga el
> valor, lo entrega*; el servidor ya tiene las frases y es el único que puede tenerlas (A1), y duplicar
> su criterio es cómo los dos se separan —**y el que calla es siempre el cliente**—. Con el error
> pintado DENTRO de la previa, «Confirmar» apagado mientras el plan no corresponda a lo tecleado, y un
> contador que impide que una respuesta tardía pise a la última. 🔴 **Y RECHAZADA UNA SEGUNDA VEZ, por
> algo MÁS ANCHO que la etapa (23-ago):** el arreglo se apoyaba en *"el servidor ya tiene las frases"*
> — **y esas frases no llegaban**. Un rechazo de Zod pone el motivo en `detalles[].mensaje` y
> `mensajeDeError` (`frontend/src/api/errores.ts`) devolvía **sólo `mensaje`**, el genérico: un `grep`
> de `detalles` en todo `src/` no encontraba **ni un lugar** que las pintara. O sea que **todas** las
> frases del contrato —los `min`/`max`, los `refine`, las escritas a mano en cada esquema— viajaban
> por la red y **nunca llegaban a ninguna pantalla del sistema**; lo que se leía siempre era *"Los
> datos enviados no son válidos"*. Arreglado **en el punto único** (no en la pantalla que lo
> descubrió), con dedupe y tope: el defecto era de toda la app y así se corrige en todos lados. 🔬 **La
> lección, que vale más que el arreglo:** la prueba que debía cazarlo **mockeaba el mensaje ya
> digerido** — horneaba la premisa falsa y medía mi suposición sobre el backend, no el backend. Ahora
> construye el error con el **cuerpo real** y las dos mitades del contrato tienen prueba, cada una en
> su lado (el backend exige que la frase venga en `detalles`, no vacía).
>
> 🔴 **Y RECHAZADA UNA TERCERA VEZ (23-ago), por la MISMA lección en otro plano: un dato correcto con
> un razonamiento falso.** Escribí que *"en todo el backend hay UN SOLO lugar que puebla `detalles`;
> ningún `ErrorDominio` lo hace"*. **Hay DOS:** la rama Zod del handler HTTP (un **arreglo** de
> `{campo, mensaje}`) y **`validarEntrada`** (`comun/validacion.ts`), que lanza `ErrorValidacion` con
> `z.flattenError` — un **objeto** `{formErrors, fieldErrors}` que `cuerpoDeErrorDominio` propaga— y
> que es el helper de validación **estándar de toda la capa de dominio** (PLANMAESTRO §9.2): **320
> llamadas**. El barrido de aserciones salió limpio igual, pero **por un accidente de forma** (la
> guarda `!Array.isArray` descartaba sola la segunda forma), no por lo que afirmé — y mientras tanto
> **la mitad más transitada del defecto seguía viva**. Corregido el reconocimiento (las dos formas) y
> corregida la afirmación. ⚠️ **La lección para todo el proyecto: un número correcto sostenido por una
> razón falsa es peor que un número dudoso, porque se lee como verificado.** **Sin migración, sin
> permisos nuevos, sin seed.**
>
> 🔴 **3ª vuelta: el reviewer independiente la RECHAZÓ, y tenía razón.** El riesgo declarado era el
> **merge** (la rama nació de la 0.016 y encima entró `V1-E3y`) y quedó descartado **con evidencia**:
> el diff ni siquiera toca los archivos de E3y, y `mrp.ts` no aparece en el stat del merge porque E3y
> nunca lo tocó —ahí git no auto-mergeó nada—; de **16 mutaciones, murieron 16**. Lo que fallaba era
> la PANTALLA: `CampoPrevia` reconciliaba contra **el valor** y no contra **la identidad del plan**,
> así que cuando el servidor devolvía **el mismo número** el efecto no corría y **el texto tecleado
> sobrevivía**. Dos caras, las dos reproducidas con sonda: se teclea `2.004`, el chip dice *«Precio
> ajustado (propuesto $2.00)»*, el importe dice `$2.00` **y el campo sigue diciendo `2.004`** —la OC
> nace bien, **miente la pantalla**, que es todo lo que la previa es—; y tras un rechazo, **vaciar el
> campo lo dejaba en blanco para siempre** con el renglón diciendo `300`, y **cada paso por el campo
> costaba otra petición**. ⚖️ Ninguna de las 77 pruebas lo tocaba porque el helper **siempre responde
> el mismo plan y nadie miraba el `value` del input después**: *una prueba que nunca mira lo que quedó
> escrito en el campo no puede cazar un campo que miente.* 🔴 **Y el arreglo que recetó el reviewer,
> SOLO, abría una regresión nueva —la cazó el coder, no la revisión—:** con la dependencia en la
> revisión, tabular de «Comprar» a «Precio» **le borraba al comprador el precio que iba tecleando**;
> se cerró con una guardia de foco, con prueba que la mata. *Aceptar una receta correcta sin construir
> lo que arrastra es cómo un arreglo crea el siguiente defecto.* En la misma ronda, y porque **aquí un
> defecto conocido no es "menor"**: la fila de campos **desbordaba en horizontal** en móvil (sin
> `flex-wrap`), **`cantidadTotal` no tenía tope** —un `1e13` reventaba en Postgres con un 500 genérico,
> y la etapa acababa de poner ese campo al alcance de un teclazo— y se barrió un `console.log` de
> depuración heredado de V1-E3q.
> 🔴 **4ª vuelta — y el hallazgo más caro de la etapa: el arreglo traía adentro el defecto que venía a
> cerrar.** La guardia que el coder añadió se saltaba la reconciliación **por tener el cursor dentro**,
> no por estar tecleando. El segundo reviewer lo reprodujo con el gesto más natural que hay: se teclea
> `2.004`, se sale con Tab, y **mientras dice «Recalculando…» el comprador hace clic de vuelta al campo
> a revisar lo que puso** → llega la respuesta y **el campo se queda en `2.004` con el chip «Precio
> ajustado (propuesto $2.00)» al lado**. La misma pantalla del rechazo anterior, y **la ventana dura
> todo el recálculo**, justo cuando se está mirando ese número. **La condición correcta no es *tener el
> foco*, es *estar sucio*:** la marca se levanta al **teclear** y se baja al salir — en un input
> controlado el `onChange` sólo lo dispara la persona, así que separa con precisión **teclazos de
> repintado**. De la misma raíz salió el segundo: pasar por un campo **sin teclear** podía mandar **un
> ajuste que nadie capturó**, pisando los precios por OP de V1-E3m (puerta abierta, no incendio — y aun
> así cerrada). ⭐ **Y una mutación SOBREVIVIÓ, resuelta por el camino honesto:** el comentario prometía
> una precaución de orden *que ningún camino ejercita*; el coder verificó que el orden es irrelevante y
> **borró la afirmación en vez de inventar una prueba que la sostuviera**. *Una prueba escrita para
> justificar un comentario no prueba nada; lo que hay que quitar es el comentario.*
> 🔴 **5ª vuelta — un reviewer NUEVO (a propósito) avaló la guardia y rechazó por algo de otra familia
> y más caro: cerrar la previa no cancelaba la petición que ella misma había disparado.** Sonda medida:
> se cambia «Comprar» de 300 a 77, el comprador se arrepiente y hace clic en «Volver y corregir» —el
> `mousedown` saca el foco y **sale una petición**—, ya en la explosión **quita una OP** (lo que además
> borra los ajustes), y al llegar la respuesta tardía **la previa REABRE SOLA con el plan viejo**: la
> pantalla dice *«surte las órdenes 7, 8»* y «Confirmar y generar» manda `idsOrden: [51]`. ⚖️ **Es peor
> que el campo que mentía:** la última pantalla antes de comprometer dinero se abre sin que nadie la
> pida y emite OC **para órdenes distintas de las que se acaban de revisar** — la razón de ser de la
> previa, rota. 🔴 **Lo introdujo esta etapa** (`1d45098`; en `prueba` no existe `CampoPrevia` ni el
> segundo `previo.mutate`), así que **nunca llegó a `prueba`**. Se cierra con `cerrarPrevia()`, que
> invalida lo en vuelo en los **cinco** sitios —el que nadie había señalado: tras generar, reabrir una
> previa vieja **propondría recomprar**—, más `previo.reset()` para que un fallo tardío no deje en
> pantalla un error de algo ya abandonado. ⭐⭐ **Y de aquí salió el hallazgo transversal de la etapa: el
> MOCK ESTÁTICO.** El reviewer midió un caso que fallaba en la prueba y no en el navegador y lo dejó
> fuera del veredicto; el coder fue a ver por qué diferían y **el defecto estaba en la prueba**: el mock
> reportaba un `isPending` fijo, así que el botón nunca se deshabilitaba como en producción. *Ese mock a
> modo es probablemente lo que dejó pasar varios de los defectos de estas cinco vueltas: las pruebas no
> medían la pantalla, medían una suposición sobre la pantalla.* ⭐ Y la prueba nueva **salió decorativa
> dos veces y el coder la cazó él mismo** (falso verde con `await Promise.resolve()`; inestable con
> `setTimeout(0)`): la versión final ancla la espera al estado real de la mutación.
> 🔴 **6ª vuelta — el reviewer dio por cerrado su hallazgo (remedido con sus sondas) y rechazó por dos
> cosas de otra naturaleza: guardas que funcionan y que NADA sostiene.** Revertir cualquiera de los
> cuatro `cerrarPrevia()` restantes dejaba la suite en **88/88 verde** — sólo uno estaba vigilado— y los
> caminos existen, medidos: con la generación de OC en vuelo se corrige un número y **el recálculo
> abandonado reabre la previa CON LAS OC YA EMITIDAS**, proponiendo recomprar lo recién comprado; y
> agregar o quitar una OP con «Revisar» pendiente **abría la previa sola con el conjunto viejo**.
> Cerrado con tres pruebas y **revirtiendo sitio por sitio** para comprobar que cada guarda pone algo
> rojo; `elegirOrdenBase` queda **sin prueba y DECLARADO** (su único llamador está detrás de
> `idsOrden.length === 0`, y con la lista vacía no puede haber plan en vuelo). ⭐⭐ **Y el segundo, que
> es la lección de la etapa mordiéndose la cola: la prueba escrita para defender el arreglo del mock
> estático estaba hecha CON un mock estático** — su docstring prometía cazar que se moviera el `reset()`
> de sitio, el reviewer lo movió y salió **88/88 verde**, porque montaba `isError` literal y un `reset`
> inerte. Rehecha con el hook auténtico. ⚖️ *La enfermedad que acabas de diagnosticar se cuela en la
> cura si no la mides también ahí.* 📝 De paso se corrigieron **dos frases de esta misma documentación**
> que el reviewer cazó como no verificadas. **Sin migración, sin permisos nuevos, sin seed.**
>
> ✅ **`V1-E3y` · NO SE QUITA DE LA RECETA LO YA COMPRADO, Y UNA OC AUTORIZADA SE PUEDE DES-AUTORIZAR ⭐**
> (22-ago): Daniel, mirando «restaurar del modelo», *"¿Qué pasa si ya se liberó un renglón, se hace la OC
> de ese avío… **se puede luego quitar**? Eso no está bien"* (§Post-F9.79). Tenía razón y **nada lo
> impedía**: quedaba una contradicción —la OC decía *"compramos esto para la orden N"* y la receta de N
> decía *"esto no va"*—, la explosión dejaba de contarlo y el *"qué tengo / qué falta"* ya no cuadraba con
> lo comprado; peor con un renglón `agregadoAMano`, que al quitarse **se borra**. 🔴 **El LEAD propuso un
> permiso para SALTARSE la regla; DANIEL propuso algo mejor:** *"una OC ya autorizada ya no se puede
> quitar de la receta. **A menos que se pueda des-autorizar**"* — **en vez de una llave para saltarse la
> regla, se deshace el hecho que la creó** (el principio de D3 aplicado a la firma de compra). **Las dos
> piezas van juntas:** el bloqueo sin la marcha atrás sería una trampa sin salida. ⚖️ **El bloqueo va por
> MATERIAL, no por orden**, y sólo cuando ya hay compromiso: con la OC en `borrador` (o cancelada) la
> receta se mueve libre. Se cierran **tres** mutaciones con un criterio único —*¿esto saca de la compra
> algo ya comprado?*— aplicado a **quitar**, **editar** y **restaurar**. 🔴 **El reviewer RECHAZÓ la
> primera versión y con razón:** el criterio miraba `paraProduccion` y `consumoPorPrenda`, pero en un
> avío **por talla** (R18) el requerido sale de las **MEDIDAS**, así que ponerlas todas en **0** vaciaba
> la compra con los dos campos intactos — **una TERCERA puerta**; y su espejo (consumo 0 con medidas > 0)
> quedaba sin proteger. *Una lista de campos elegidos a mano siempre se queda corta:* el criterio pasó a
> ser **el requerido REAL** (*antes pedía algo, después no pide nada*), calculado con
> `requeridoAvioReceta` — la MISMA función de R18 que usan el MRP y la habilitación, para que no pueda
> derivar. De paso se unificó la cascada de las medidas en **una sola definición** (`medidasResultantes`,
> que ahora usa también `reemplazarMedidasAvio`): lo cazó **una mutación que sobrevivió**. **No** se bloquean `traerDelModelo` ni `agregar`:
> verificado que sólo CREAN o REVIVEN — meten material, nunca lo sacan. **El arte queda fuera** porque una
> línea de OC no puede apuntar a un arte. ⚠️ **Si la OC ya se RECIBIÓ no hay marcha atrás** (Daniel,
> 20-ago: *"una vez recibido no se puede desautorizar"*): el camino es devolución o ajuste, y el mensaje
> lo dice con esas palabras. **Des-autorizar** quita el sello, devuelve la OC a **`borrador`** —verificado
> que **nada escribe `pendiente_autorizacion`**, por eso la bandeja pide borradores—, exige **motivo** y
> deja en bitácora **la firma que se borró** (A7/D3). 🔴 **El efecto en la RUTA CRÍTICA no se escribió a
> mano, y se verificó en vez de suponerlo:** `reevaluarCompraTela` **relee el estado físico**, así que
> des-autorizar emite el **MISMO** `oc-tela-resuelta` que autorizar y cancelar y el proceso `compraTela`
> se des-completa solo. Permiso **PROPIO y nuevo `compras.desautorizar`**, en el **perfil** (§Post-F9.67),
> restado de `directivo` → sólo Administrador y AdministracionDireccion. **Sin migración**, pero ⚠️ **CON
> PERMISO NUEVO → el deploy a `prueba` REQUIERE `SEED_ON_START=true`** (sin eso el botón no le aparece a
> nadie, ni a dirección).
>
> ✅ **`V1-E3x` · PONERLE PROVEEDOR A VARIOS AVÍOS DE UN GOLPE ⭐** (22-ago): Daniel, *"cuando no
> tengan proveedor los avíos, ya en la pantalla de explosión, podemos hacer una forma de poder poner el
> proveedor de manera más rápida a varios elementos que lleven el mismo proveedor"* (§Post-F9.88).
> §Post-F9.82 ya dejaba al comprador desatorar, pero **renglón por renglón**: seis avíos del mismo
> proveedor eran seis veces el mismo tecleo. ⚖️ **En bloque aquí SÍ se vale, y la regla importa:** *lo que
> se puede hacer en bloque es lo que **no compromete dinero*** — asignar proveedor no compra (la OC sigue
> pasando por la **previa** de §Post-F9.85 y por su autorización), y por eso **liberar la receta sigue
> siendo uno por uno** (§Post-F9.80). Entrega: panel en la explosión con los materiales sin proveedor,
> «Seleccionar todos», un proveedor y **un acto**; `PUT /api/materiales/proveedor-en-bloque`. 🔴 **El
> dominio NO duplica una sola validación: DELEGA renglón por renglón en la función de a uno, dentro de
> UNA transacción** — una segunda ruta que validara *"casi"* igual se desincronizaría en la primera
> corrección y la vía rápida sería también la vía floja. **A7**: cada renglón conserva su bitácora pero
> los N llevan el mismo `idLote` + un resumen por orden, para que se lean como **un acto** y no como seis
> sueltos. ⬜ **La pregunta abierta de Daniel —*"que sugiera a quién agrupar"*— se cerró en NO, y la razón
> es del motor**: el proveedor **habitual** y el **más barato** YA son escalones de la cascada
> (`proveedor-material.ts`), así que un material sólo cae en esta lista cuando **ninguno** resolvió — el
> sistema no se está callando una sugerencia, **no la tiene**; y adivinarla del histórico de compras sería
> escribir una suposición como hecho (§Post-F9.86). El panel dice dónde se arregla **para siempre**:
> marcando el **habitual** del avío o el **dueño** de la tela en el catálogo. Decisiones nuevas: el acto
> es **TODO O NADA** nombrando cuál falló (medio lote aplicado obligaría a revisar renglón por renglón,
> justo lo que esto vino a quitar), el **alcance lo elige el usuario** (todas las OP de la compra, o una:
> el sistema no inventa un *"todas"*), y **en bloque sólo se PONE** —quitar sigue de a uno, porque
> arrastra el precio—. **Sin migración, sin permisos nuevos, sin seed.**
>
> ✅ **`V1-E3w` · EL IMPORTADOR DE PDFs Y EL LÍMITE QUE NADIE HACÍA CUMPLIR ⭐** (22-ago): Daniel reportó
> que importar **varias** OC del cliente en PDF moría con *«Failed to fetch»* (§Post-F9.92). 🔴 **El
> límite real del sistema era 1 MB, no los 64 MiB que declara el backend**: `nginx` va en medio y su
> `location /api/` no traía `client_max_body_size`, así que regía su default — y como los PDFs viajan en
> base64 (infla ~33 %), con tres o cuatro OC de ~200 KB ya se pasaba. **Lo que hizo al defecto duradero
> no fue el número sino la FORMA de fallar:** nginx corta el cuerpo *antes* de que llegue al backend y
> cierra la conexión, así que no hay 413 con cuerpo, no hay CORS y **en los logs del backend no aparece
> nada** — el defecto no dejaba huella en el lugar donde se busca. Se arreglan las dos mitades: el límite
> (espejo del backend, **amarrado con una prueba** que lee los dos archivos y truena si se separan) y el
> mensaje (un fallo de envío ya dice *"prueba con menos archivos a la vez"*, sin inventar la causa, y sin
> pisar el error que el servidor sí contestó). ⚠️ **Requiere reconstruir el FRONTEND** para tomar efecto:
> la plantilla de nginx se procesa al arrancar su contenedor. ⬜ **Sin verificar: el proxy de Railway**
> puede tener su propio tope y no se puede comprobar desde el repo.
>
> ✅ **`V1-E3v` · LOS AVÍOS FAVORITOS SE SUGIEREN AL ARMAR LA RECETA** (22-ago): Daniel, *"cuando damos
> de alta una receta, deberíamos de tener algunos avíos «favoritos». Todo lleva etiqueta de lavado, por
> ejemplo. (…) Y debemos de tenerla con **1 pieza por default**"*, y sobre cómo: *"los favoritos aparecen
> como **sugerencia**. Pero **solo hay que aceptarlos y ya**"* (§Post-F9.90). 🔴 **La mitad ya estaba
> construida desde F1-E3 y NADIE la leía:** `Avio.favorito` y `Avio.cantFav` existen con su regla validada
> (*favorito ⇒ cantidad > 0*) y sus pruebas, pero `grep favorito|cantFav` en las pantallas de modelos y de
> órdenes daba **cero** — se podía marcar un avío como favorito con su cantidad y al armar la receta **no
> pasaba nada**. Es el patrón que salió **cuatro veces esta semana**: *el dato llega al modelo y no al
> usuario*. Entrega: en la sección de **Avíos** de la receta del **MODELO**, una tarjeta lista los
> favoritos que le faltan con **su** cantidad y unidad, y **un solo botón los acepta todos** (ni precarga
> silenciosa —nadie los vería— ni palomear uno por uno, §Post-F9.36 punto 3); aceptar es **aditivo y en
> una transacción**: no toca ni un renglón que ya esté, no borra nada (D3) y es idempotente. 🔴 **NO se
> cableó ninguna lista de avíos ni ningún número**: cuáles son favoritos y con cuánto lo dice el catálogo
> (A1), así que si Daniel no marca ninguno la tarjeta no aparece — y eso es correcto. Las decisiones que
> la etapa cerró: la sugerencia aparece **también con la receta a medio armar** (*el olvido no ocurre en
> el minuto uno, ocurre a la mitad*); un favorito que ya está **no se duplica** y **el resto se sigue
> ofreciendo** (*tratar "ya tengo uno" como "ya los revisé todos" es cómo se pierde el segundo*); un
> favorito marcado **sin cantidad no se adivina, pero se nombra**; y aceptar con captura **sin guardar**
> queda **bloqueado con la razón a la vista**, porque recargar la ficha resembraría el editor y se
> perdería lo tecleado. **SIN migración, SIN permisos nuevos, SIN seed.**
>
> ✅ **`V1-E3u` · LA TELA SE COMPRA POR COLOR ⭐⭐** (21-ago): Daniel, *"cuando se hace la receta no lleva
> el color, solo lleva la tela. Pero al pedir la tela, no puedo pedir esa tela solamente, tengo que pedir
> el color en cada modelo. **Debo de tener la posibilidad de ir comprando esa tela en diferentes colores
> (y pantones)**"* (§Post-F9.89). 🔴 **El hueco en una frase: el sistema obligaba a RECIBIR por color y no
> dejaba PEDIR por color** — el kardex de telas exige `idTelaColor` desde siempre, pero ni la receta de la
> OP ni el renglón de OC lo llevaban, así que **quien recibía tenía que inventar la correspondencia** y la
> misma tela en tres tonos era un solo renglón que no decía cuánto de cada uno. De ahí colgaba el otro
> reporte del mismo día (*"no me deja poner precio ya estando en la explosión"*): `TelaColor` guarda
> **precio por color** y **precio de complemento por color** precisamente porque varían, y sin color el
> renglón **no tenía el dato con el que decidir cuál era el precio**. Entrega: **`OrdenTelaColor`**, el
> puente color-de-prenda → color-de-tela que vive **en la orden** (el modelo define la TELA, el COLOR es de
> cada pedido); la **explosión por tela×COLOR** con la cantidad que sale de la **matriz color×talla que ya
> existía** (`piezas de ESE color × consumo`, la Σ no cambia); el **precio del color** —el escalón
> `color-referencia` llevaba meses en la cascada única y **el MRP nunca lo llenaba**, porque el renglón no
> sabía de qué color era—; el **color en la línea de OC**, en el **impreso con su pantone**, y **cruzado en
> la recepción**. Las tres decisiones: **(a)** el sistema propone y **Compras teclea**, con el desvío
> avisando a quien autoriza —umbral **10 %**, por empresa y editable sin deploy: el doble del 5 % que el
> negocio ya reconoce como normal (§Post-F9.19), por debajo de lo que cuesta redondear al rollo, y por
> encima de lo que un rollo entero de más significa; 🔴 **avisa y NO bloquea** (§Post-F9.64)—; **(b)**
> corregir el precio **actualiza el catálogo**, con `compras.administrar` (un permiso nuevo nacería sin
> asignar a nadie y cerraría el camino que la decisión vino a abrir) y auditoría A7 que dice **de cuánto a
> cuánto y desde qué OP/OC**; **(c)** se compra el COLOR y el almacén reparte — un renglón por color, y
> **una línea de OC por OP** dentro de él (§Post-F9.86 intacta: *se ve junto, se guarda repartido*).
> 🔴 **Los AVÍOS se MIDIERON y el hueco NO es el mismo**: en la tela el color existía en los dos extremos
> y faltaba el eslabón de en medio; al avío le falta **la mitad del proveedor** — no existe `AvioColor`
> (el equivalente de `TelaColor`), el kardex de avíos no tiene color y la recepción no lo pide. (La
> **intención** de compra sí se puede diferenciar hoy, por `OrdenCompraLineaTalla`, que lleva color de
> **prenda** × talla.) ✅ **Cerrado por `V1-E8c` (27-ago, §Post-F9.126) SIN construir el catálogo**:
> el avío se compra por color de **PRENDA** y el color que lee el proveedor va como **texto** en la
> línea — la mitad del proveedor que aquí se daba por necesaria no hizo falta.
> ⚠️ **Cierre el 22-ago, en dos vueltas y las dos por lo mismo:** el dato llegaba al **contrato** y no a
> la **persona**. Primero, el `avisoDesvio` no se pintaba en ninguna pantalla y el color sólo salía en el
> impreso → la bandeja de autorización avisa ahora **en la tarjeta**, el renglón enseña la frase completa
> y el `calculado: N`, y el color se dice en el detalle de la OC y en la revisión previa. Y en la
> revisión independiente, la misma forma **más grave**: 🔴 la tela **no se recibe** en la pantalla que se
> había arreglado (§Post-F9.14 la deja deshabilitada) sino en *Inventarios › Telas › Entradas*, donde el
> color de la OC **no llegaba ni al contrato** — o sea que la etapa había puesto un **cruce que rechaza
> la factura** y le había quitado a quien recibe el dato para cumplirlo. Cerrado eso (+ el color pegado al
> editar la OC, el umbral sin puerta, la ambigüedad del acervo sin color marcada, el multi-OP aterrizando
> en la orden correcta y las pruebas que faltaban). 🔴 El desvío sigue sin bloquear.
> ⚠️ **CON migración, aditiva**: lo viejo no se toca, **nada se backfilea**, una OC sin color se compra y
> se recibe igual que siempre. **SIN permisos nuevos, SIN seed.**
>
> ✅ **`V1-E3s` · RECIBIR EMPIEZA POR EL PROVEEDOR ⭐** (21-ago): Daniel, *"en la recepción de orden de
> compra debería buscar primero por proveedor y de ahí que muestre todas las OC abiertas de ese
> proveedor. **No tiene caso empezar por el número de orden. En la realidad cuando vas a recibir algo,
> buscas al proveedor que llegó a entregar**"* (§Post-F9.87). **La pantalla preguntaba al revés que la
> vida**: quien llega al almacén es el proveedor, y el número de OC es lo que hay que AVERIGUAR. Ahora
> se teclea el proveedor (búsqueda **en el servidor**, reusando `SelectorProveedor`, EL selector de
> proveedor de la app) y salen **sus OC abiertas** con lo que sirve para reconocerlas al recibir
> —número, fecha, estatus y **qué trae pendiente** por nombre—; si sólo hay una, **queda elegida sola**;
> y el número sigue de **atajo** para quien lo trae en la remisión. 🔴 **De pasada mata un defecto vivo
> que Daniel no reportó:** el selector se llenaba con **dos consultas de 100** y las OC de más abajo eran
> **INALCANZABLES** desde esa pantalla —la misma trampa del `<select>` de colores que V1-E4 ya había
> arreglado, y que **empeoraba sola** con cada OC nueva—. La raíz quedó cerrada: la OC elegida se pide
> **por id**, no se busca dentro de una página. Y el tope que queda **se declara** (`total`/`truncado`):
> *"Se muestran 50 de 300 OC abiertas"* — a las de más atrás se llega **por su número**, no navegando.
> ⭐ **Y el orden va por CREACIÓN, no por folio**, que es lo que impide que el defecto vuelva por la
> puerta de atrás: hoy el folio **no es monótono** (los ETL dejaron las secuencias en cero → las OC
> nuevas toman folios 1, 2, 3…, §Post-F9.85, arreglo **manual pendiente**) y las ~7,978 migradas quedan
> **abiertas para siempre** con folios altos, así que ordenar por folio habría devuelto una página de
> pura historia dejando fuera la OC que Daniel acaba de crear. ⚠️ **`recibirCompra` NO se tocó** — esto
> es cómo se ELIGE la OC, no cómo se recibe. **SIN migración, SIN permisos nuevos, SIN seed.**
>
> ✅ **`V1-E3n` · MODELOS DE DESARROLLO vs. DE PRODUCCIÓN** (20-ago): Daniel, probando, *"en la última OP
> que hice de pruebas (la 5558) heredó el modelo de desarrollo… habíamos acordado que el sistema iba a
> proponer un modelo de producción y yo solo lo confirmaría"*. 🔴 **Tenía razón, y la explicación es que la
> decisión existía y NUNCA SE CONSTRUYÓ**: §Post-F9.34 la cerró entera el 12-ago y terminaba con *"Aplica
> en: NADA todavía"*. Entrega: `Modelo.origen` + `Modelo.codigoDesarrollo` + `Cliente.abreviatura`; serie
> propia de desarrollo `CYA-26-71-001` **armada entera por el sistema** y congelada al nacer, que **no
> quema** consecutivo de producción; **«pasar a producción»** desde el catálogo y desde «Generar OP», con
> el nº de 5 dígitos **precargado y editable** (§Post-F9.46); catálogo y galería en **producción por
> default**; y el promovido **conservando sus dos números, los dos buscables** (D3). Daniel cerró la última
> duda el 20-ago (**§Post-F9.83**): *"el concepto y género van FIJOS y los consecutivos disponibles son los
> otros 3"*. ⚠️ **Su decisión técnica de fondo:** el consecutivo de producción **no puede salir de una
> secuencia**, y se midió — el par `51` del Access tiene **535 usados de 999 con el 999 YA ocupado**, así
> que una secuencia propondría `1000`; la propuesta es el **hueco libre más bajo** bajo advisory lock del
> par. El de desarrollo sí es secuencia atómica pura. Y **`Modelo.numeroProduccion` se REDEFINE**: guardaba
> un consecutivo global **sin significado** que se minteaba al generar la OP sin cambiar el código del
> modelo — ése era exactamente el bug de la 5558.
>
> *(histórico)* **`V1-E3f pieza B` (proveedores)**: renombres de rol, contactos como tabla, **el campo corto
> fusionado en uno y único**, el `tipo` retirado, el **lector de la Constancia de Situación Fiscal** y la
> **segmentación con/sin factura en CxP**. Su hallazgo caro: `{ not: true }` **no incluye los NULL** —los
> cargos migrados se caían de los dos segmentos mientras el encabezado sí los sumaba— y **ninguna de las
> 74 pruebas del área lo tocaba**.
>
> *(histórico)* **`V1-E6b`** · *esconder, no negar* — las **tres capas** que
> pidió Daniel. La de en medio **no existía**: de las 135 rutas solo 2 miraban permisos, así que tecleando
> la URL se **entraba** a cualquier pantalla (el backend sí rechazaba, pero se veía el esqueleto). Aprobada
> en segunda vuelta; el hallazgo fue que **cinco pantallas de Administración heredaban la unión de permisos
> del hub** y que la prueba que lo debía impedir era **ciega a esa forma del hueco**.
>
> 🔴 **Y de `V1-E3g` salió el hallazgo más caro de todo el track:** el reviewer midió el precosteo **REAL** y el
> modelo pasaba de **432 a 8** — **el sistema estaba costeando 54 cierres por prenda en vez de 1**, porque
> **la medida se leía como cantidad**. El arreglo **no mueve costos: REPARA un sobrecosto de 54×**.
> *(Este párrafo decía lo contrario hasta el 18-ago — ver la corrección en la ficha.)*
> ⚠️ Su despliegue exige **contar antes** las filas con medidas activas **y** `consumoPorTalla = true`,
> no para autorizar un cambio sino **para medir cuánto está mal hoy**.
>
> *(Texto histórico de V1-E4b, conservado:)* **`V1-E4b`** (etapa
> NUEVA, nacida de Daniel el 16-ago: *"hay procesos que también son después de costura"* — y pasa HOY).
> Primera vuelta **RECHAZADA** por el reviewer, en corrección: el modelo quedó avalado (reusa el almacén
> «Tránsito» que ya existía desde F3-E1, y D3/A2 aguantaron seis envíos simultáneos), pero el stock del
> bucket **«sin orden»** —o sea **todo lo migrado y todo el conteo físico de arranque de Daniel**— no se
> podía mandar a proceso, y se podía cancelar **una sola pata** del traspaso haciendo desaparecer prendas
> del kardex. ⚠️ **Esta etapa SÍ exige `SEED_ON_START=true`** al desplegar. Ficha en
> `docs/hoja-de-ruta/V1-etapas.md`.
>
> ⚠️ **PENDIENTE DE GABRIEL:** **CINCO etapas integradas en `prueba` y SIN DESPLEGAR** (`V1-E3c` #180,
> `V1-E3e` #181, `V1-E3d pieza B` #182, `V1-E4` #183 y `V1-E6a`). Las tres primeras van **sin
> migración, sin permisos y sin seed**; **`V1-E3d pieza B` y `V1-E4` y `V1-E6a` SÍ llevan migración**
> (automática, sin `SEED_ON_START`). Hasta que se despliegue, **Daniel no ve nada de esto**.
> ✅ **`SEED_ON_START=true` YA ESTÁ PUESTO en `prueba`** desde principios de agosto (Gabriel, 20-ago-2026).
> Las etapas que lo exigen se siembran solas al desplegar; **ya no hace falta pedirlo cada vez**.
> ✅ **`RESPALDO_LLAVE`: Gabriel la reporta como generada y guardada** (20-ago-2026). ⚠️ *Reportada, no
> verificada por el equipo:* la única comprobación que vale es **restaurar un respaldo**, y eso no se ha
> hecho. Un respaldo que nunca se restauró es una hipótesis, no una red.
>
> *(histórico)* 🔑 **El respaldo no corre hasta que Gabriel genere `RESPALDO_LLAVE`** y la guarde **también fuera de
> Railway** (`docs/GUIA-RAILWAY-R2.md` §7.1): si se pierde, los respaldos son irrecuperables por
> diseño. *(La subida de fotos en `prueba` quedó **resuelta** el 25-ago-2026 — era configuración de
> Cloudflare R2; las trampas siguen documentadas en `docs/hoja-de-ruta/F1-etapas.md:222`.)*
>
> **PENDIENTES del track:** el **tránsito de prendas a proceso** (§Post-F9.61: el envío saca de PT
> para que faltantes y segundas tengan dónde caer — **antes de capturar inventario real**), la etapa
> fusionada **arte + proveedores** (§Post-F9.52/.54/.55/.57/.58), lo que queda de `V1-E6`, `V1-E7`
> (el ensayo, **con Daniel**), y la separación **desarrollo vs
> producción** (§Post-F9.34, con sus tres cabos cerrados el 15-ago en §Post-F9.46 — el nº de
> producción **se precarga editable**, cambio de opinión de Daniel).
> ✅ **Resuelto (25-ago-2026):** **subir fotos en `prueba` ya funciona** — Daniel confirmó que la
> configuración de Cloudflare R2 quedó al 100%. Era eso y no código, como decía el diagnóstico del
> 15-ago. Las trampas de R2 siguen documentadas en `docs/hoja-de-ruta/F1-etapas.md:222` por si
> reaparece.
>
> **Contexto previo (12-jul-2026): F9 ✅ COMPLETA (6/6, 10-jul) + remates post-F9 ✅ (corrida autónoma 11-jul, PRs #123–#140: cierre visual F9/EsMa, emisores RC ~18 automáticos, 23 PDFs a identidad verde + pool de workers para PDF/Excel, móvil en 4 olas, rediseño de las 26 altas, code review general con Fable 5, retiro del panel viejo de Órdenes).** El **12-jul**, con **DANIEL en vivo simulando la operación real**, se construyó el **importador de OC del cliente por PDF (plantilla C&A)** — ver §4 y `DECISIONES.md §(Post-F9.2)`. **SIGUE: F10 (Migración + Go-live)** — NO arranca hasta la decisión de Gabriel (¿todos los años o solo 2025–2026?) y sus insumos (corte SINUBE para el ETL de apertura F9, carpeta de fotos, diseño del formato del auditor R21). *(Contexto previo, 10-jul:)* Entre F8 y F9 corrió el **REDISEÑO DEL FRONTEND completo (R1–R9, 7–10 jul)** — track propio en `docs/rediseno/PLAN-IMPLEMENTACION.md`, ✅ **CERRADO**: toda la UI quedó al estándar del prototipo de Daniel (verificada FOTO contra FOTO), con funciones nuevas que nacieron ahí: **importador de pedido del cliente** (R8 de REQUISITOS-NUEVOS, versión Excel), **catálogo de Auditores** (+R21 flujo del auditor, pendiente de diseño), **Resumen operativo** (`GET /api/resumen`), KPIs de servidor en Compras/Calidad/WIP/EDR/Notas, y columnas server-side en Modelos. Decisiones D14 (dictámenes del rediseño) y D15 (arranque de F9) en `DECISIONES.md`. PRs #101–#115+ en `prueba`. **F9 arrancó el 10-jul** con las decisiones de arranque cerradas (D15): **`F9-E1` ✅ CÓDIGO COMPLETO (motor de cuenta corriente de terceros; 1 coder + **2 reviewers APROBARON** (write-skew de doble-cancel y crash TDZ hallados y cerrados en 2 rondas); gates locales verdes back `typecheck`/`lint`/`format`/`test:unit` **855** + `openapi`, front `gen:api`/`typecheck`/`test` **656**/`build`, sin drift; **pend. review + commit/PR + verif. de Gabriel en `prueba`**)** — `MovimientoTercero` + `ServicioCuentaTerceros` (D15a/ADR-0017: tercero por tipo+id, sin tabla polimórfica; `saldo=Σ monto` con signo por origen, D3; dos ejes/dos vistas; **EsMa por convivencia de LECTURA** con no-regresión reusando la fórmula de F6; cancelación por inverso; aging D15d; permisos `terceros.ver`/`.administrar`/`.fiscal`, reparto conservador). **SIN pantallas** (E1 es motor puro; CxP/CxC son E2/E4). **El deploy a `prueba` requiere `SEED_ON_START=true`.** **`F9-E2` ✅ COMPLETA (10-jul; reviewer APROBÓ tras 2 rondas — DEBE del fold EsMa en la bandeja + % al corriente honesto, ambos corregidos; pend. verif. Gabriel):** CxP operable — ServicioCxP por composición sobre el motor, aging server-side con cubeta "Maquila (sin antigüedad)" foldeando EsMa (bandeja==detalle probado), pantallas /cxp + estado de cuenta con captura de pagos y PDF, permisos `cxp.ver`/`.administrar` → **deploy requiere `SEED_ON_START=true`**. **`F9-E3` ✅ COMPLETA (10-jul; reviewer APROBÓ tras 3 rondas — XML server-side R2-primero, Empresa.rfc para el receptor, parser endurecido, guard del modo local; pend. verif. Gabriel):** importación de CFDI 4.0 de proveedores — parser puro + `/cxp/importar-cfdi` (previsualizar→conciliar sin auto-liga→confirmar), cargo fiscal = total del CFDI vía el motor, anti-duplicado por UUID, migración aditiva `empresa.rfc` (capturar el RFC de FR Moda en Admin›Empresas activa el rechazo de receptor ajeno); SIN permisos nuevos. **`F9-E4` ✅ COMPLETA (10-jul; reviewer APROBÓ; pend. verif. Gabriel):** CxC + importación de CFDI de ventas — espejo de CxP por composición (Cliente.diasCredito/rfc; origen `factura_cliente`; aging común extraído; emisor=empresa activa, receptor=cliente, liga a pedido sin auto-liga; pantallas /cxc completas; permisos `cxc.*` → **SEED_ON_START**). **`F9-E5` ✅** (reportes fiscales + aging configurable D15d) · **`F9-E6` ✅ COMPLETA (10-jul; reviewer APROBÓ)** — ETL de saldos de apertura (CSV flexible, facturas con fecha = aging día 1, por lotes, idempotente, folios en bloque A3) + importador masivo de CFDI + cuadre-f9 + `docs/modulos/finanzas.md`. **CON ESTO F9 QUEDA COMPLETA (6/6, construida el 10-jul-2026).** ⚠️ Pendientes operativos: (1) el ETL está LISTO pero NO CORRIDO — espera el corte de SINUBE de Daniel (D15c; comandos en `migracion/README.md`); (2) verificación de Gabriel en `prueba` (menús de Finanzas requieren `SEED_ON_START=true` por los permisos de E1/E2/E4); (3) capturar el RFC de FR Moda en Administración › Empresas. Ficha: `docs/hoja-de-ruta/F9-etapas.md`.

**`F8` (Desarrollo, Cotización y Listas de Precios) — ✅ COMPLETA (6/6)** (fase NUEVA, arrancó 4-jul-2026; D13/R16–R20/módulo 15). **`F8-E1` ✅ (E1a backend + E1b pantallas; **2 reviewers independientes APROBARON**; validaciones locales verdes — back `typecheck`/`lint`/`format`/`test:unit` 750 + `openapi`, front `typecheck`/`lint`/`format`/`test` 491/`build`; **pend. commit/PR + verif. de Gabriel en `prueba`**)** — cimientos de datos: `TelaProveedor`/`TelaProveedorColor` (precio por proveedor y por color, R17), medidas por talla en avíos (`ModeloAvioTalla`, R18), `ConceptoCosto`/`EstadoLista`/`ClienteDepartamento`, la **migración aditiva ÚNICA de toda la fase** (15 tablas + 2 enums, verificada línea por línea), el **helper de resolución de precios** (extiende `calcularPreCosto` de F7 con test de no-regresión) y **13 permisos** (`desarrollo.*`/`listas.*`/`concepto-costo.*`/`estado-lista.*`). Pantallas: precios por proveedor en Tela (grid color×precio), medidas por talla en el BOM, departamentos en Cliente, CRUD admin de conceptos/estados. **El deploy a `prueba` requiere `SEED_ON_START=true`.** **`F8-E2` ✅ (1 coder + 1 reviewer APROBÓ; back `typecheck`/`lint`/`test:unit` 750, front `typecheck`/`lint`/`test` 498/`build`; OpenAPI + cliente en sync; **pend. commit/PR + verif. de Gabriel en `prueba`**)** — **proyectos de desarrollo** (1 cliente + 1 departamento, con tema; R16) + **desarrollos** con **estado derivado** (`en-desarrollo → cotizado → en-lista → ligado-produccion`, con `apagado`) por un único helper reutilizado en los conteos, folio de proyecto por secuencia atómica, validación depto↔cliente y **scope por empresa (A9)** en dominio, apagar/reactivar con motivo+auditoría, actualizaciones idempotentes; **módulo nuevo "Desarrollo"** en el menú (entre Modelos y Pedidos) con página lista+detalle y "modelo nuevo" orquestado en el front. **SIN migración ni permisos nuevos** (nacieron en E1). **`F8-E3` ✅ (⭐ motor central; **1 coder + 2 reviewers** — #1 pidió CAMBIOS, #2 APROBÓ CON OBSERVACIONES; **ambos hallaron por separado el mismo bloqueante B1** y TODO se corrigió en una ronda, incluido el cierre del **write-skew que violaría D3**; sin migración/permisos/seed nuevos; gates locales verdes back `test:unit` 750 + `openapi`, front `test` 504 + `build`, sin drift de OpenAPI/cliente; **pend. commit/PR + verif. de Gabriel en `prueba`**)** — **precosto PERSISTIDO por desarrollo** (`backend/src/dominio/desarrollo/precostos.ts`): `generarPrecosto` desde el BOM con los **precios amarrados de E1** (tela por proveedor/color, avío por amarre/más-barato) + **promedio simple de medidas por talla** (R18/decisión g) + conceptos manuales (R19), **regalía FUERA del costo** (D2); `recalcularDesdeBom` no pisa los manuales; `congelarVersion` **inmutable** (D3) con `costoTotal` persistido; **a lo más un borrador** y **TODA mutación serializada por `pg_advisory_xact_lock`** (A3/D3, con scope de empresa A9) → `exigirBorrador` bajo el lock; estado del desarrollo → `cotizado` al congelar v1 (deriva del helper de E2). 8 endpoints (`desarrollo.precostear` **AND** `.ver` en mutaciones; importes ocultos sin `consultas.ver-importes`, server-side), pantalla en el detalle del desarrollo. Refactor sin regresión de F7 (`redondear2`/`num` extraídos a `dominio/costos/decimales.ts`). **`F8-E4` ✅ (1 coder + 1 reviewer independiente; veredicto inicial **CAMBIOS REQUERIDOS** —1 bloqueante B1 (TOCTOU en `crearLista`, cerrado con `pg_advisory_xact_lock` por empresa) + N1–N7— TODO corregido en una ronda → **APROBADO**; **sin migración/permisos/seed nuevos**; gates locales verdes back `test:unit` **761** + `openapi`, front `test` **504** + `build`, sin drift; **pend. commit/PR + verif. de Gabriel en `prueba`**)** — **factores del cliente** (default + override por departamento) + **lista de precios por Cliente+Departamento** generada desde los precostos congelados con la **fórmula en cascada** (decisión b, redondeo al alza D2; helper puro aislado): snapshot de factores editable, folio A3, **aprobación del dueño renglón por renglón** (`listas.aprobar`: aprobar el calculado o teclear otro, con rastro), recalcular sin pisar aprobados, invariante *un desarrollo → a lo más una lista* serializada por lock; **impreso PDF (R9) + Excel** (cierra el pendiente de §4); módulo nuevo **"Listas de precios"** en el menú. **`F8-E5` ✅ (1 coder + 1 reviewer independiente **APROBÓ**; solo **1 hallazgo de doc** —un comentario `TODO(E5)` obsoleto— corregido en la misma ronda; **rebasada sobre `prueba` con el PR #98 (admin de roles) que aterrizó a mitad de sesión** y OpenAPI/cliente regenerados sin drift; gates locales verdes back `typecheck`/`lint`/`format`/`test:unit` **761** + `openapi`, front `typecheck`/`lint`/`format`/`test` **520** + `build`; integración y e2e en CI; **pend. commit/PR + verif. de Gabriel en `prueba`**)** — trae la **negociación de precios por VERSIONES** (`backend/src/dominio/desarrollo/negociacion.ts`): **nueva ronda** (re-apunta el renglón de lista a un precosto **congelado** re-costeado del MISMO desarrollo, recalcula `precioCalculado` con los factores snapshot y **resetea `precioAprobado`** —el precio nuevo se re-aprueba con `listas.aprobar`, separando al negociador del aprobador, coherente con el seed— dejando el precosto anterior **recuperable**, D3), **acuerdos sin re-costeo**, **cambio de estado** de la lista (`listas.negociar`, con **reapertura auditada** de una lista de cierre), e **historial por renglón** (`NegociacionEvento` **inmutable**, A7); TODA mutación bajo el **mismo `pg_advisory_xact_lock` por lista** + **guard `esCierre`** (cierra los 3 `TODO(E5)` que E4 dejó, incluido el TOCTOU de `aprobar`/`ajustar`), y la invariante *un desarrollo → a lo más una lista* **blindada a nivel BD** con `@@unique([idDesarrollo])` (la ÚNICA migración de E5). Pantallas: panel de negociación del renglón, comparador de versiones (deltas de costo/precio), selector de estado y **archivo del departamento** — **sin módulo nuevo al menú** (viven en "Listas de precios"). **SIN permisos ni seed nuevos** (`listas.negociar` ya repartido en E1). **`F8-E6` ✅ (E6a backend + E6b front/adjuntos/cierre; 2 reviewers independientes APROBARON; gates corridos por el lead — back `typecheck`/`lint`/`format`/`test:unit` **775** + `openapi`, front `typecheck`/`lint`/`format`/`test` **532**/`build`; pend. verif. de Gabriel en `prueba`)** — **enganche + CIERRE de F8**: el MRP (`mrp.ts`) hereda el amarre de proveedor/precio de la tela (`resolverPrecioTela`; sin amarre → NULL, **no-regresión F4 probada**), antepone `ModeloAvio.idAvioProveedor` al "más barato" y compra avíos por **Σ(medida×piezas) por talla** (R18), con `avisos[]` (tela multi-color / talla sin medida / proveedor amarrado inactivo); **liga desarrollo↔orden** (`liga-orden.ts` sobre `DesarrolloOrden`) con `sugerenciaLigaOrden` + **vista 360** + **tablero** por estado (agregación en servidor); **adjuntos R6 de la orden** (migración aditiva `orden_archivo` + **borrado físico R2** best-effort → **salda la deuda §8 para órdenes**); docs de módulo `desarrollo-cotizacion.md` (nuevo) + `compras-mrp.md`. **Precio al pedido = MOSTRAR editable, NO pre-llenar `PedidoLinea.precio`** (decisión de Gabriel 6-jul; pre-llenado en F2 al backlog §4). **1 migración aditiva; SIN permisos nuevos** (adjuntos reusan `ordenes.*`). Con E6, **F8 queda COMPLETA (6/6)**; sigue **F9 (Finanzas)**. Ficha: `docs/hoja-de-ruta/F8-etapas.md`.

**`F7` (Costos/EDR + Indicadores) — ✅ COMPLETA (6/6, 3-jul-2026).** Decisiones de negocio cerradas con Daniel el 2-jul-2026 (`DECISIONES.md` D2, 12 puntos). **`F7-E1` ✅ (3-jul-2026; reviewer APROBÓ; CI verde; en `prueba` PR #86; pend. verif. de Gabriel + cuadre numérico contra la hoja manual de Daniel)** — **motor de costeo**: `CostoOrden` (tela/procesos/avíos, **regalía FUERA del costo**) + enum `BaseProrrateo`; dominio pre-costo/costo-orden/márgenes (fórmula D2 `1 − costo/(precio−bonif)`, precio sugerido redondeado **al alza**); 8 rutas `/api/costos`; 5 pantallas + 2 PDF + Excel; permisos `costos.*`/`precostos.*`. **`F7-E2` ✅ (3-jul-2026; reviewer independiente APROBÓ sin cambios; CI verde; pend. verif. de Gabriel en `prueba`)** — **EDR mensual CONSOLIDADO** (todas las empresas `paraEdr`, no la activa): `Edr` (encabezado global por mes, gastos/intereses/bonif/otros globales D2 #6) + `EdrLinea` (`origen` automatica|ajustada|manual, `precioVenta` = lo **facturado** editable, D2 #5) + enum `EdrOrigenLinea`; dominio `edr/edr.ts` con **`generarEdrMes` IDEMPOTENTE** (pre-propone desde entregas F3; reconcilia solo automáticas, respeta ajustada/manual) y `calcularEdr` a **costo ACTUAL** (D1, vivo desde `CostoOrden`) con cortes por empresa y por cliente; 12 endpoints `/api/edr` + permisos `edr.ver`/`edr.capturar` (**el deploy a `prueba` requiere `SEED_ON_START=true`**); módulo de menú propio con 4 pantallas teal + PDF mensual/anual + Excel. **`F7-E3` ✅ (3-jul-2026; reviewer pidió cambios→corregidos y re-verificados; CI verde; pend. verif. de Gabriel en `prueba`)** — **motor de KPIs en 2º plano** (reutiliza pg-boss de F5: cola `kpi-refrescar` + 7 vistas materializadas con `REFRESH CONCURRENTLY` + tabla `KpiRefresco` "datos al:"; la captura NUNCA espera el recálculo, plan §11) + **3 tableros directivos** (KPI de Ruta Crítica/D11, calidad por maquilero/F6, WIP analítico/F3); "entrega a tiempo" = `fecha_real ≤ fecha_planeada_vigente` del último proceso (D2/#7), denominador = medibles (con plan); permiso `indicadores.ver`; ADR-0015. Limitación v1 rotulada en la UI (`BadgeHistorico`): lead time/cuellos/desempeño/defectos son histórico acumulado (no filtran por periodo). Deploy a `prueba` requiere `SEED_ON_START=true` + `JOBS_ACTIVOS≠false`. **`F7-E4` ✅ (3-jul-2026; reviewer independiente APROBÓ completitud+correctitud; CI verde; pend. verif. de Gabriel en `prueba`)** — **productividad unificada IP/Almacén** (motor con `PersonalArea`/`ActividadProductividad`/`RegistroProductividad` + `jornadaBaseAlmacen` parametrizada; índices IP y Almacén validados a mano; vistas semanal/mensual por AGREGACIÓN real, no /5 /30) + **fichas confiables** (checklist por filas A6, 8 reactivos, % confiables) + **muestrarios** (KPI cumplimiento); 23 endpoints bajo `/api/indicadores` con permisos ya existentes (guard nuevo `conAlgunPermiso`); 5 pantallas teal; migración aditiva sin permisos nuevos (seed solo agrega los 8 reactivos). Auto-alimentación de productividad DESCARTADA para F7 (registrada en `MEJORAS.md`). **`F7-E5` ✅ (3-jul-2026; reviewer independiente APROBÓ tras 1 ciclo de corrección —bloqueante de concurrencia B1 cerrado con `SELECT … FOR UPDATE` de ejecución única—; CI verde; pend. verif. de Gabriel en `prueba`)** — **inventario cíclico contra el kardex propio de v2** (D6/D3/D4): `InventarioCiclico`/`Det` a la granularidad real del artículo de kardex (incluye `idOrden`, F6-E2); **alta CONGELA el teórico** bajo lock (nunca la vista), **conteo CIEGO** (ni el endpoint ni el PDF muestran el teórico) y **ajuste = solo MOVIMIENTO de kardex** (tipos dedicados `ajuste-ciclico-*`, salidas no-negativas, protegido contra doble-generación); 3 pantallas teal + hoja de conteo PDF; permisos `indicadores.ciclicos-*` ya existentes (SIN permisos nuevos); **5S DESCARTADO** (decisión de Daniel #8). El deploy a `prueba` requiere `SEED_ON_START=true` (2 tipos de movimiento nuevos). **`F7-E6` ✅ (3-jul-2026; reviewer APROBÓ tras 1 ajuste; verificación local verde)** — ETL histórico de **costeos** (2,513→`CostoOrden`, regalía fuera del costo D2) + **indicadores** completos (productividad, fichas, muestrarios, cíclico Proscai modo-migración D6) + cuadre v1↔v2 + docs de módulo; **EDR NO se migra** (D2#11, arranca 2026). **F7 queda 6/6. Sigue F8 — que desde el 4-jul-2026 es la fase NUEVA "Desarrollo, Cotización y Listas de Precios" (D13, R16–R20, módulo 15; propuesta de Daniel estructurada ese día): la capa previa al pedido — proyectos por cliente+departamento, precosteo amarrado (telas por proveedor/color, medidas por talla, conceptos abiertos), listas de precios con factores del cliente, aprobación del dueño y negociación por versiones, enganchada al MRP/OC. Ficha completa en `docs/hoja-de-ruta/F8-etapas.md` (sus preguntas para Daniel ya van con defaults). Con esa inserción, Finanzas pasó de F8 a F9 y Migración+Go-live de F9 a F10 (fichas renombradas; mismo criterio secuencial que cuando entró Finanzas).** El **cuadre numérico** contra las hojas manuales de Daniel (E1 y E2) es criterio de cierre de fase; el histórico de costeos se migra en E6 (el EDR arranca 2026, sin histórico).

- **F6 — Calidad + EsMa: ✅ COMPLETA (6/6, 2-jul-2026; reviewer independiente APROBÓ; pend. commit/PR + verif. de Gabriel en `prueba`).** E1–E5 en `prueba` (PRs #80/#81/#82/#83/#84). **`F6-E6` ✅ (cierre de fase)** — ETL del histórico de Calidad (40 defectos / 488 auditorías / 15,296 detalles) y EsMa (7,401 cargos —**+1,251 de estampado recuperados** al arreglar el mapeo de maquilero del loader (bug de `esma-cargos.ts`, no proveedores faltantes; cierra `DECISIONES §F3-E6 (a)`)—, 554 abonos / 743 descuentos / 5,935 pagos), TODO **vía dominio modo-migración** (sin efectos derivados: auditorías sin evento RC, pagos LIBRES sin aplicaciones/lock), idempotente y por lotes; **reporte de cuadre v1↔v2** (`cuadre-f6.ts`: conteos + saldo por maquilero con la fórmula derivada D3 + conciliación recibido-vs-cargado) e incidencias LISTADAS (1 cargo huérfano, refs de maquilero de empresas viejas → F10); + `docs/modulos/{calidad,esma}.md`. **SIN migración/permisos/seed nuevos** (el ETL se corre a mano post-deploy). **Siguiente: `F7` (Costos/EDR + Indicadores).** Detalle histórico E1–E3: Decisiones de fase (a–h) cerradas con Daniel ANTES de arrancar (`DECISIONES.md` §"Decisiones de negocio de F6": resultado de auditoría MANUAL con comentarios —el cálculo por nivel AQL queda como sugerencia, la severidad no entra en el veredicto— · muestra automática con default y override autorizado · **un solo plan AQL para todos** —se cae la asignación por cliente/producto— · defectos por **tipo de producto** (catálogo nuevo + etiqueta + tipo heredado del modelo) · estampado a su propio precio · `Orden.pagada` derivada + segundas sin costo · bloqueo duro de pagos duplicados · con/sin factura → dos estados de cuenta). **`F6-E1` ✅ (24-jun-2026; 1 coder + 1 reviewer independiente; pendiente verificación de Gabriel en `prueba`) — Calidad, base configurable + consulta de bitácora.** Migración aditiva `f6_e1_calidad_catalogos` (6 tablas: `DefectoCatalogo` enriquecido —clave/pag/`nivelAQL`/favorito/categoría/`severidad` metadato/`aplicaGeneral`—, `TipoProducto`, su puente M:N `DefectoTipoProducto`, y el motor de planes `PlanMuestreoAQL`+`PlanMuestreoRenglon`+`PlanMuestreoLimite`; + columna NULLABLE `Modelo.idTipoProducto`). Dominio `dominio/calidad/{tipos-producto,defectos,planes-aql}.ts` (CRUD borrado suave + A2/A7; `resolverPlan(lote,nivel)` = plan default activo → muestra + Ac/Re por nivel, decisiones (a)/(b)/(c)/(d)) + lectura de bitácora `dominio/admin/bitacora.ts` (el motor A7 de F0 solo escribía). Rutas `/api/calidad/{defectos,tipos-producto,planes-aql}` (+ `/planes-aql/resolver`) y `GET /api/admin/bitacora`; permisos nuevos `calidad.ver`/`calidad.administrar-catalogo`/`admin.ver-bitacora` (deny-by-default). Seed: tipos de producto base + UN plan AQL default ISO 2859-1 nivel general II (AQL 1.0/2.5/10) como DATOS. Frontend teal lista+detalle: Catálogo de defectos (multiselect de tipos + "general"), Tipos de producto, Planes AQL (con preview en vivo lote+nivel), Consulta de bitácora (bajo Administración) + selector de tipo de producto en Modelos. **SIN seed de defectos** (los 40 reales los carga el ETL de E6). El ETL del módulo y el cuadre v1↔v2 son de **F6-E6** (cierre). **`F6-E2`** ✅ (27-jun-2026; 1 coder + 1 reviewer independiente APROBÓ; pendiente verificación de Gabriel en `prueba`) — **núcleo de auditorías de calidad**: migración aditiva `f6_e2_calidad_auditorias` (`Auditoria` con folio por **secuencia atómica A3** —no `Max()+1`—, doble responsable elaboró/auditor, tipo en_piso/final, borrado suave, + `AuditoriaDefecto`). Dominio `crearAuditoria` (tx: folio + cantidad de la orden + maquileros propuestos de las entregas reales + pre-carga de TODOS los favoritos activos + muestra automática del plan default), `capturarResultado` (**resultado MANUAL**, decisión (a): el cálculo por nivel AQL es solo sugerencia informativa, NO vinculante; la severidad no entra), `reclasificar` (Primeras↔Segundas vía **traspaso de kardex** con no-negativo bajo lock, D3, nunca edita existencias). **Integración RC**: auditoría final aprobada auto-completa su proceso (idempotente, des-completa si cambia el estado). 2 pantallas (alta responsive para piso + captura con sugerencia en vivo) + endpoints; **SIN permisos nuevos** (reusa `calidad.generar-auditorias`/`actualizar-auditorias`). El reviewer pidió 2 fixes de frontend (typecheck + tarjeta en la portada) → corregidos → APROBADO. **+ Ampliación "PT ligado a la orden"** (Daniel, `DECISIONES.md §F6 (i)/(j)`; reviewer APROBÓ): el inventario de PT lleva la **orden** como dimensión (`movimiento_det_pt.idOrden` nullable + `existencia_pt` por orden; recibo/entrega/reclasif la pueblan, manual/histórico = bucket NULL; BACKFILL de lo ya en prueba; **ADR-0014**). La **reclasificación ahora opera solo sobre la orden auditada** (objetivo de Daniel). Restaura el `IPT_Modelos.IdOrdenes` de v1. Histórico por orden = pendiente F10. **`F6-E3`** ✅ (1-jul-2026; 1 coder + 1 reviewer independiente APROBÓ; pendiente verificación de Gabriel en `prueba`) — **Calidad, consulta + impreso R9 + historial por maquilero + modificar/cancelar.** Dominio `dominio/calidad/auditorias.ts` ampliado: `listarAuditorias` (paginado y filtrado EN SERVIDOR —orden/maquilero/resultado/tipo/fechas/incluir-canceladas—, proyección ligera, orden determinista), `historialPorMaquilero` (% de aprobación operativo = aprobadas/(aprobadas+reprobadas), excluye canceladas, null si no hay calificadas), `modificarAuditoria` (encabezado; re-evalúa la RC al cambiar el tipo) y `cancelarAuditoria` (borrado suave + motivo en bitácora + des-completa la RC vía evento al outbox). Impreso PDF R9 `dominio/calidad/impresos/impreso-auditoria.ts` (ex `FormatoAuditorias`). 5 rutas nuevas con RBAC por acción (`calidad.ver` lista/historial/impreso; `calidad.modificar-auditorias` modificar/cancelar). Frontend teal: Consulta de auditorías, Auditorías por maquilero, diálogos de modificar/cancelar. **SIN migración, SIN permisos nuevos, SIN re-seed** → el deploy a `prueba` NO requiere `SEED_ON_START`. Sigue, en paralelo, la cadena de EsMa (**`F6-E4`→`F6-E5`**) y el cierre **`F6-E6`** (ETL + cuadre). El detalle por etapa en `docs/hoja-de-ruta/F6-etapas.md`.
- **F5 — Ruta Crítica ⭐: ✅ COMPLETA (7/7, 23-jun-2026).** Decisiones de fase (a–h) cerradas con Daniel ANTES de arrancar (`DECISIONES.md` §"Decisiones de negocio de F5": calendario L–V + festivos MX/FR · los factores SÍ afectan duraciones · la RC no pisa la fecha de entrega · auto-avance hasta cantidad completa con el automático mandando sobre lo manual · cancelar des-completa · PDF + Excel sí). **`F5-E7` ✅ (23-jun-2026; 2 coders en paralelo —piezas sin solape— + 1 reviewer independiente APROBADO; pendiente verificación de Gabriel en `prueba`) — CIERRE DE FASE F5: concentrado planeado-vs-real + export Excel + ETL del módulo.** **Pieza A:** `dominio/ruta-critica/concentrado.ts` — agregación **EN SERVIDOR con SQL crudo parametrizado** (sin vista → SIN migración; el pivote se hace en SQL, **NUNCA en el cliente** —el pecado del `RC_ConcentradoDif` viejo, 2,061 líneas); paginada, filtrable por cliente/proceso/responsable, ordenable por retraso/cliente/fecha; semáforo/atraso REUSANDO la lógica pura de E4 (ADR-0013, `UMBRAL_RIESGO_DIAS=3`); con **test de volumen** (200 órdenes × 26 procesos paginado <4s). Endpoints `GET /ruta-critica/concentrado` + `/concentrado/excel` que **REUSAN `rc.ruta-ver`** (→ deploy SIN `SEED_ON_START`); **export a Excel** (`exceljs`, decisión (h)) del MISMO resultado (todo el filtro, no solo la página). Frontend `ConcentradoPagina.tsx` (teal responsive PC+móvil, reusa `Semaforo`) + ruta + portada-hub + menú (con `login.spec` ajustado). **Pieza B:** ETL del módulo (`migracion/ruta-critica/` + orquestador `etl-ruta-critica.ts` + `cuadre-f5.ts`, idempotente/por-lotes/CP850/vía dominio modo-migración `dominio/ruta-critica/migracion.ts`): verifica los 26 procesos de E1 (el mapeo `TipoProceso→tipoEvento` vive en el seed de E1, el ETL NO re-mapea), crea familias/artículos/`FactorCantidad`(11)/`DuracionPorTipoTela`(7)/`DuracionPorAplicacion`(9) faltantes, **materializa las 54 `ProcesoDefRol` vigentes** (14 huérfanas LISTADAS), plantillas (156 tiempos), `UsuarioRol` (23 con tipo), **181 `RC` históricas → `RutaOrden`** con `capturadoPor`/`capturadoEn` (KPI D11) + checklist IP3/IP4, estado RC de órdenes y `ColchonCostura`. **SIN migración / SIN permisos / SIN seed nuevos** (carga en tablas de E1–E6; el ETL se corre a mano post-deploy: `npx tsx --env-file=.env migracion/etl-ruta-critica.ts`, idempotente → 2ª corrida = mismos números). **Bloqueante del reviewer (corregido + re-verificado):** el SQL crudo del concentrado usaba nombres de tabla en SINGULAR (`"orden"`/`"cliente"`/`"modelo"`) en vez de los plurales reales (`@@map` → `"ordenes"`/`"clientes"`/`"modelos"`) → habría tronado contra la BD real; lo tapaba que vive en un `*.int.test.ts` (solo CI). **Ajustes a la ficha (realidad de los CSV):** el checklist histórico son **9 ítems** (IP3 6 + IP4 3 columnas reales), no 12. **Dependencia cruzada con F10:** los 137 usuarios del viejo no están migrados a v2 todavía (F10); el ETL NO crea usuarios — casa por login contra usuarios v2 existentes y **lista los pendientes "hasta F10"** (idempotente → re-correr tras F10 los materializa; hasta entonces la Bandeja con datos reales se demuestra con un usuario sembrado). **Deja abierto:** **D8** (auditoría-como-proceso de la RC → **F6**; los procesos #16/#20/#23 quedan con `tipoEvento='auditoria'`), **D11** (tableros KPI → **F7** sobre `RutaOrden`) y **notificaciones push/correo → F7** (el badge de E5 es el mínimo viable). Pendiente operativo: lista de fechas propias de FR para el calendario (decisión (a), no bloquea). Módulo documentado en [`docs/modulos/ruta-critica.md`](docs/modulos/ruta-critica.md). **Verificación consolidada del lead (comandos exactos del CI):** backend `lint/typecheck/format/build` + gate OpenAPI en sync + `test:unit` (los `*.int.test.ts` corren en CI); frontend gate cliente en sync + `typecheck/lint/format/build/test` **409**; todo verde (7 timeouts de render de PDF bajo carga local son flake ambiental pre-existente, verdes en aislamiento 52/52 y en CI). **Siguiente fase: `F6` — Calidad + EsMa** (ficha en [`docs/hoja-de-ruta/F6-etapas.md`](docs/hoja-de-ruta/F6-etapas.md)). · **`F5-E6` ✅ (23-jun-2026; 1 coder + 1 reviewer independiente APROBADO; pendiente verificación de Gabriel en `prueba`) — Auto-avance por eventos de F3/F4 ("las fechas se llenan solas donde aplica").** Los servicios de Producción (corte/envío/recibo/entrega + cancelaciones, `produccion/{etapas,recibos,entregas-cliente}.ts`) y Compras (recepción de tela ya emitía `material-recibido` + su reverso, `compras/recepciones.ts`) escriben su evento en el **OUTBOX DURABLE** (ADR-0011, `comun/eventos-dominio.ts`) DENTRO de la tx del hecho (atómico: si el hecho hace rollback, el evento no existe) + `dispararPublicacion()` tras el commit; ganchos MÍNIMOS (el `emitir()` in-process de F3-E1 queda intacto; `autorizarOC` NO emite —no hay `tipoEvento` de autorización de OC). Consumidor NUEVO `dominio/ruta-critica/autoAvance.ts` (worker de la cola `eventos-dominio`, registrado en `servidor.ts` DESPUÉS de `iniciarMotorJobs` para no perder el `encolarJob` del CPM; SIN sesión → el evento es AUTORITATIVO, bitácora de sistema `registrarBitacora(tx, null, …)`): **IDEMPOTENTE por RE-EVALUACIÓN del estado físico** (Σ `EtapaMovimientoDet` vivos vs `OrdenLineaTalla` por celda color×talla con `≥`; ignora celdas pedidas en 0) → un evento duplicado/reintento = UN solo efecto (sin persistir id de origen); `fechaReal` = la **fecha FÍSICA** del hecho (la `fecha` de la etapa/recepción que llevó la cantidad al tope, KPI D11; `capturadoEn` sí es el sello del sistema); serializa por orden con el MISMO `pg_advisory_xact_lock(empresa,orden)` de `cumplimiento.ts`; tras cada cambio encola el recálculo del CPM. **Decisiones de Daniel (d/e/f — (e) y (f) INVIRTIERON los defaults de la ficha):** (d) completa SOLO al cubrirse la cantidad COMPLETA (color×talla, D4), marca `parcialEnCurso` desde el 1er parcial; (e) el evento **PISA** la fecha manual (rastro `pisoCapturaManual` en Bitácora); (f) cancelar el origen **DES-COMPLETA** + revisa sucesores activados + reabre RC si terminal + recalcula CPM. **`recepcionTela`:** denominador = saldo de líneas de TELA de OCs ligadas (no color×talla; sin OC de tela → no se auto-completa). **Migración aditiva `20260623120000`** = 1 columna `RutaOrden.parcialEnCurso BOOLEAN NOT NULL DEFAULT false`; **SIN permisos, SIN seed, SIN tablas nuevas** (reusa outbox + motor de jobs) → el deploy a `prueba` necesita la migración pero **NO `SEED_ON_START`**. Frontend (A1, menor): badge **"Parcial en curso"** en bandeja y RC por orden; `openapi.json` (back+front) + `esquema.gen.ts` regenerados. **Suites COMPLETAS de F3 y F4 verdes y SIN debilitar** (regresión verificada por el reviewer: ningún `*.test.ts` de `produccion/`/`compras/` tocado). Tests nuevos `autoAvance.test.ts` (unit) + `autoAvance.int.test.ts` (integración: recibo cuadra WIP+IPT+EsMa+RC en UNA tx + auto-completa, parcial no completa, remesa que completa, **duplicado=1 efecto**, evento pisa manual con rastro, cancelación des-completa + regresa sucesor). CI verde local (backend `format/typecheck/lint/test:unit` **650**/`build`; frontend ídem **402**; integración con testcontainers + e2e en CI). Ficha en [`docs/hoja-de-ruta/F5-etapas.md`](docs/hoja-de-ruta/F5-etapas.md). **`F5-E7` ✅ cerrada (ver arriba) — F5 COMPLETA; sigue F6.** · **`F5-E5` ✅ (22-jun-2026; 1 coder backend + 1 coder frontend secuenciales + 1 reviewer independiente APROBADO; pendiente verificación de Gabriel en `prueba`) — Pantallas de operación (el motor de E3/E4 en manos del usuario, PC + móvil, A1: cero lógica de negocio en React).** **Backend:** 2 consultas en `dominio/ruta-critica/bandeja.ts` — `consultarBandeja` ("mis tareas" = `RutaOrden` `estado='activo'` de órdenes con `rcActiva` donde los roles del usuario INTERSECTAN `ProcesoDefRol` N:M —replica `exigirCapturaProceso`, admin ve todo; `todas` solo amplía con `rc.programar`; filtro `idProcesoDef` se interseca, no expone ajenos; scope por empresa; una query con `include` anti-N+1; **semáforo y `diasAtraso` calculados en el dominio** reusando `estadoSemaforoProceso`; orden por urgencia) y `contarAlertas` (`{atrasados,enRiesgo}` para el badge). 2 endpoints GET con RBAC `rc.ruta-ver`; **extensión ADITIVA** `capturadoPorNombre` al `GET …/ruta` (resuelto sin N+1, declarado en schema y poblado en proyección, no rompe E4). **SIN migración, SIN permisos, SIN seed** → el deploy a `prueba` **NO requiere `SEED_ON_START`** por E5. **Frontend (teal, responsive):** componente reutilizable **`Semaforo`** (tri-estado) + `fechaRc` (sin desfase UTC, tolera datetime ISO); **`ProgramarRcPagina`** (`rc.programar`: form artículo/tela/aplicación con `porPagina:100`, Programar/Re-programar, "copiar de orden anterior" reusando GET ruta, indicador **"recalculando…"** vía `refetchInterval` condicionado que NO bloquea la captura, ajustes de procesos de ESA orden por PATCH con el texto "la plantilla no se toca, D10"); **`BandejaTareasPagina`** (`rc.ruta-ver`, PC+móvil: mis tareas por urgencia con semáforo, captura rápida **Hoy/Ayer** en fecha LOCAL sin off-by-one, checklist, filtros + "ver todas"); **`RutaPorOrdenPagina`** (`rc.ruta-ver`, PC+móvil: timeline plan vs real + quién/cuándo capturó); **`BadgeAlertasRc`** en el header (conteo, rojo/ámbar, click→bandeja); + rutas en `App.tsx`, menú "Bandeja de tareas", botones "Programar RC"/"Ver Ruta Crítica" en el detalle de órdenes. **Impreso PDF del plan (R9): CONSTRUIDO en E5** (decisión (g) de Daniel) — server-side (`@react-pdf/renderer`), ruta binaria `GET /ruta-critica/ordenes/:id/plan-impreso` (`rc.ruta-ver`, scope A9) + botón "Imprimir plan" en RC por orden. **Hallazgo del review cerrado (🔴):** `fechaRc` rendía "Invalid Date" en TODA fecha (contrato = datetime ISO, función parseaba date-only; mocks date-only lo ocultaban — verde en CI, roto en Railway); fix `slice(0,10)` + guard endurecido + mocks realineados + test de regresión. **BUG DE PRODUCTO del motor (E3/E4) que el e2e de E5 destapó en CI — corregido (reviewer APROBÓ):** `generarRutaOrden` dejaba todo en `'pendiente'` y nadie activaba el proceso RAÍZ (el CPM no toca estado; solo `activarSucesoresListos` activa, al completar un antecesor) → la bandeja jamás se poblaba tras programar; fix = helper `activarProcesosListos(tx, idOrden)` (promueve `'pendiente'→'activo'` los renglones con todos sus antecesores completados —raíz incluido—) llamado al final de `generarRutaOrden`/`ajustarRutaOrden`, + tests de E3 corregidos + 2 regresiones. Lección: el e2e de extremo a extremo cazó un bug que las suites unit/int (que pre-seteaban `estado='activo'`) no veían. CI verde local (backend `format/typecheck/lint/test/build` **1381**; frontend ídem + `test` **400**; integración —bandeja por roles N:M, conteo, `capturadoPorNombre`, arranque del conjunto listo— y e2e —flujo completo + móvil 390×844— en CI). Ficha en [`docs/hoja-de-ruta/F5-etapas.md`](docs/hoja-de-ruta/F5-etapas.md). **`F5-E6` ✅ cerrada (ver arriba).** · **`F5-E4` ✅ (22-jun-2026; 1 coder + 2 reviewers independientes APROBARON; pendiente verificación de Gabriel en `prueba`) — Motor RC parte 2 (backend): CPM en pg-boss + captura de avance + checklist + semáforo/EnRiesgo.** **SIN migración** (los campos ya existían de E3). **CPM backward-pass** `dominio/ruta-critica/cpm.ts` (PURO) + `cpm-job.ts` (handler de la cola `recalcularRutaOrden` que E3 dejó sin implementar): programa hacia atrás desde `Orden.fechaEntregaRC` (terminal ancla en la entrega; `fin(p)=MIN(inicio sucesores)`; `inicio=sumarDiasHabiles(fin,-dur)` reusando `comun/diasHabiles.ts` de E2, UTC; duración 0 ⇒ inicio=fin), orden topológico **Kahn**, N antecesores = la cadena más larga (equiv. MAX del forward), reemplaza el forward+nudge `'OtraVez'` del viejo por una pasada exacta; **idempotente** (`fechaPlaneadaOriginal` solo si null —snapshot D11—, `fechaPlaneadaVigente`/`acumuladoDias` siempre, NUNCA toca fecha real/captura/estado); serializado por orden (singletonKey de E3). **Cumplimiento** `dominio/ruta-critica/cumplimiento.ts` (A2/A7): `completarProceso` (valida `rc.capturar` **Y** intersección de roles del usuario con `ProcesoDefRol` N:M —o admin—; activa los sucesores con TODOS sus antecesores completos, "la pelota pasa de mano en mano", generaliza `QueActiva` a N; `ultimoProceso` → cierra la RC `rcActiva=false`=`MatarRC`), `revertirProceso` (reabre, audita), `marcarChecklistItem` (completar todos auto-completa el padre con `origenCaptura='evento'`; desmarcar SOLO revierte lo auto-completado, nunca pisa una captura manual). **La RC NUNCA escribe `Orden.fechaEntrega`** (decisión (c)); **todas las capturas de una orden serializan con `pg_advisory_xact_lock(idEmpresa,idOrden)`** (misma familia 0x4F='O' que F3-E2). **Semáforo** `dominio/ruta-critica/semaforoYRiesgo.ts` (PURO/derivado A1): `aTiempo|enRiesgo|atrasado` por proceso y orden vs `fechaPlaneadaVigente`, umbral único `UMBRAL_RIESGO_DIAS=3`; regla "EnRiesgo nace antes de programar" como **job recurrente** `comun/jobs/riesgo-rc.ts` (cola `barridoRiesgoRc`, cron horario `RC_RIESGO_CRON`, persiste `Orden.enRiesgo` legacy; GET deriva en vivo). **API:** 2 `PUT` (capturar/revertir, checklist) + `GET …/ruta` extendido con semáforo + estado de recálculo; **permiso NUEVO `rc.capturar`** → **el deploy a `prueba` requiere `SEED_ON_START=true`**; OpenAPI + `esquema.gen.ts` regenerados. **`npm run demo:rc`** + **ADR-0013**. **A ratificar con Daniel (no bloquea):** umbral del semáforo (3 días) y frecuencia del barrido (horaria). CI verde local (backend **622** unit incl. CPM/semáforo con fechas a mano; frontend **383** sin regresión —solo cliente regenerado, sin UI nueva—; integración con testcontainers —cumplimiento, concurrencia, manual-no-pisado— en CI). Ficha en [`docs/hoja-de-ruta/F5-etapas.md`](docs/hoja-de-ruta/F5-etapas.md). **Siguiente: `F5-E5` — Pantallas de operación (Programar RC, bandeja de tareas con semáforo, RC por orden; PC + móvil).** · **`F5-E3` ✅ (22-jun-2026; 1 coder + 2 reviewers; pendiente verificación de Gabriel en `prueba`) — Motor RC parte 1 (backend): jobs + ruta viva + duraciones + generación/ajuste.** Migración aditiva `20260622140000` con 2 enums (`EstadoProcesoRuta`, `OrigenCaptura`) + 3 tablas (`RutaOrden` un renglón por proceso×orden con snapshot de banderas + `duracionDias` + fechas planeada/real + estado + captura, **para explotación analítica D11**; `RutaOrdenDep` snapshot del DAG de ESA orden editable sin tocar la plantilla **D10**; `RutaOrdenChecklist`) + **campos NUEVOS en `Orden`** (`rcActiva`, `fechaProgramada`, `esResurtidoRC` + FKs `idArticuloRcProg`/`idDuracionTela`/`idDuracionAplicacion`; los escalares RC legados de v1 se conservan SIN tocar). **Motor de jobs pg-boss** `comun/jobs/` (instancia separada del relay de eventos de ADR-0011, arranque/cierre en `servidor.ts`, **serialización por orden vía `singletonKey`** → dos recálculos de la misma orden colapsan en uno; guarda `JOBS_ACTIVOS` NO-OP en CI): el job CPM `rc-recalcular-ruta` se registra y se ENCOLA; su handler lo monta E4. **`calcularDuracion`** (puro, cero números a fuego): `fija`=tiempoEstandar · `porCantidad`=`max(1, round(t×factor+colchón))` · `porTipoTela`=`dias` DIRECTOS (NO ×factorTela) · `porAplicacion`=`max(0, round(diasAplic×factorCantidad))` — **PRENDE el factor de cantidad (corrige el ex-bug `FactCantAp`)**; `factorTela` y `factor` de aplicación se CONSERVAN como referencia pero NO se multiplican (doble-conteo — decisión de Daniel 22-jun, ADR-0012). **`generarRutaOrden`/`ajustarRutaOrden`** (A2/A7): resuelve plantilla por artículo→familia; OMITE condicionales sin aplicación RECONECTANDO a los antecesores TRANSITIVOS vivos (reusa `grafo.ts`, no el frágil `VerifAntecesor`); resurtido → procesos `esResurtido` duración 0; **duración 0 = auto-completado** (`fechaReal`=inicio, estado completado, `origenCaptura`='evento'); RE-GENERAR conserva las fechas reales capturadas; la RC NUNCA pisa `Orden.fechaEntrega` (decisión (c)); ajuste valida grafo acíclico SIN tocar la plantilla (D10); encola el recálculo tras el commit. **API** `POST /ruta-critica/ordenes/:id/programar` (respuesta INMEDIATA, estado 'pendiente-de-calculo'), `PATCH …/ruta`, `GET …/ruta`; **2 permisos nuevos** `rc.programar`/`rc.ruta-ver` (operativos, cascadean) → **el deploy a `prueba` requiere `SEED_ON_START=true`**; OpenAPI + `esquema.gen.ts` regenerados. **ADR-0012.** Las FECHAS planeadas son E4 (aquí quedan null). CI verde local (backend format/typecheck/lint/build + unit; **frontend SIN cambios de UI** —etapa solo-backend—, solo se regeneró el cliente OpenAPI `esquema.gen.ts` y su suite 383 quedó verde como no-regresión; integración con testcontainers en CI: **ciclo cruzado del lote de ajuste**, condicionales reconectados, resurtido, duración 0, re-generación conservando fechas, ajuste sin tocar plantilla). Ficha en [`docs/hoja-de-ruta/F5-etapas.md`](docs/hoja-de-ruta/F5-etapas.md). **`F5-E4` ✅ cerrada (ver arriba).** · **`F5-E2` ✅ (22-jun-2026; 1 coder + 1 reviewer; verificación de correctitud del lead APROBADA —gates locales en verde + dominio revisado a fondo; pendiente verificación de Gabriel en `prueba`) — Plantillas de ruta + reglas de duración + calendario laboral.** Migración aditiva `20260622130000` con **7 tablas nuevas** (`FamiliaArticulo`, `ArticuloRC`, `PlantillaRuta` + `PlantillaRutaProceso` + `PlantillaRutaDep` —encadenamiento **PROPIO** de la plantilla, DAG distinto del genérico de E1—, `FactorCantidad`, `DuracionPorTipoTela` con `factorTela`, `DuracionPorAplicacion`, `CalendarioEmpresa` + `DiaFestivo` por empresa); `colchonCostura` **REUTILIZADO** (ya existía desde F0, nullable → sin backfill, sin trampa NOT NULL); **SIN FK a `Orden`** (los escalares RC quedan como están — prueba tiene órdenes ETL con esos valores). Dominio `dominio/ruta-critica/{plantillasRuta,reglasDuracion,familiasArticulos,calendarioLaboral}.ts` (A1, tx A2, bitácora A7, borrado suave) — las plantillas **reúsan `grafo.ts`** para rechazar ciclos del encadenamiento propio. **`comun/diasHabiles.ts`** PURO (`esDiaHabil`/`sumarDiasHabiles` n±/`contarDiasHabiles`, todo UTC) con **tests exhaustivos de bordes** (finde, festivo, cruce de año, **n negativo = backward del CPM**, festivo-en-finde, intervalo invertido) — pieza crítica que consumirá el CPM de E4. API `/api/ruta-critica/{plantillas,familias,articulos,reglas-duracion/*,calendario}` con RBAC **reusado** (`rc.catalogo-ver`/`.administrar`, **sin permisos nuevos**); contrato + cliente regenerados frescos. **Decisión (b):** los catálogos GUARDAN `factorTela` (0.07–2.30) y el factor de aplicación aunque el viejo no los aplicara (la fórmula se aplica en E3). **Decisión (a):** calendario configurable por empresa; seed con L–V + festivos MX (las **fechas propias de FR** las carga Gabriel por el CRUD cuando Daniel se las dé). Frontend: **3 pantallas teal** (Plantillas de ruta con rechazo de ciclos en vivo + CRUD de familia/artículo · Reglas de duración con 3 pestañas · **Configuración RC** en Administración con colchón + calendario/festivos) + menú + rutas con guard + e2e. **Seed de desarrollo bakeado** (no lee CSV en runtime): 2 plantillas reales + `CP_Cant` (11) + `RC_TipoTelas` (7) + `RC_Aplicaciones` (9) + calendario. **El deploy a `prueba` requiere `SEED_ON_START=true`** (datos de catálogo nuevos; no hay permisos ni roles nuevos). **Equipo: 1 coder + 1 reviewer** (NO 2 en paralelo: las piezas A/B comparten esquema/migración/contrato/menú → demasiado solape; la propia ficha manda 1 coder en ese caso). CI verde local (backend format/typecheck/lint/build; frontend format/typecheck/build/test **380**; integración con testcontainers + e2e en CI). Ficha en [`docs/hoja-de-ruta/F5-etapas.md`](docs/hoja-de-ruta/F5-etapas.md). · **`F5-E1` ✅ (22-jun-2026; 1 coder + 1 reviewer independiente APROBADO —único bloqueante fue la doc de cierre, código limpio; pendiente verificación de Gabriel en `prueba`) — "Procesos como datos".** Corazón configurable del workflow: migración aditiva `20260622120000` con 4 modelos (`ProcesoDef` con banderas + `condicionAplicabilidad`/`tipoEvento`/`tipoDuracion` TIPADOS —no motor de expresiones—, `ProcesoDefRol` **N:M sobre el RBAC único** A4, `ProcesoDep` **DAG**, `ProcesoChecklist`); dominio `dominio/ruta-critica/catalogoProcesos.ts` (A1) + `grafo.ts` con **rechazo de ciclos** (auto/directo/transitivo, DFS iterativo, ignora aristas previas al re-definir) + bitácora A7 en tx A2 + borrado suave; 8 endpoints `/api/ruta-critica/procesos*` con RBAC por ruta (**2 permisos nuevos** `rc.catalogo-ver`/`.administrar`); alta de los **18 roles funcionales reales** (`RC_TipoUsuarios`, reusa "Administrador"); 2 pantallas teal (Catálogo de procesos + Editor de dependencias con rechazo de ciclos en vivo) + menú + contrato sincronizado; **seed de desarrollo** con 26 procesos + 54 asignaciones N:M + dependencias (de `AntecesorRef`) + checklist (datos BAKEADOS, no lee CSV en runtime; **cuadre seed↔CSV reales 1:1 verificado por el reviewer**, 0 mismatches). CI verde (type-check back+front, **548 unit backend** + `grafo.test.ts`; integración con testcontainers —CRUD, N:M, ciclos auto/directo/transitivo, soft delete, bitácora— + e2e en CI). **Deuda explícita aceptada (E2+):** el editor de roles/dependencias usa `GET /api/roles` (exige `roles.administrar`; el admin de RC tiene ambos) → en E2 exponer un GET de roles ligero bajo `rc.catalogo-ver`. **El deploy a `prueba` requiere `SEED_ON_START=true`** (2 permisos + 18 roles + 26 procesos nuevos). Ficha en [`docs/hoja-de-ruta/F5-etapas.md`](docs/hoja-de-ruta/F5-etapas.md). **Siguiente: `F5-E3` — Motor RC parte 1 (infraestructura pg-boss + datos de la ruta viva + duraciones + generación/ajuste de ruta).**
- **F4 — Compras / MRP: ✅ COMPLETA (6/6, 22-jun-2026).** **`F4-E6` ✅ (22-jun-2026; reviewer independiente APROBADO —10/10 criterios verificados; 2 🟢 nits no bloqueantes; pendiente verificación de Gabriel en `prueba`) — CIERRE DE FASE F4.** ETL idempotente del histórico real de Compras/Notas/Telas (escrito **por lotes**, vía dominio modo-migración no-REST, CP850) + cuadre + docs de módulo. **2 coders en paralelo** (piezas disjuntas) + 1 reviewer. **Pieza A** (compras+notas legacy): `dominio/compras/migracion.ts`/`dominio/notas/migracion.ts` (folio explícito, líneas legacy SOLO texto libre, **SIN kardex ni RecepcionCompra**; notas `confirmada` histórica sin descontar avíos — anti-doble-conteo) + loaders `ordenes-compra.ts`/`notas-salida.ts` + orquestador `etl-compras-notas.ts`. **Pieza B** (telas): `dominio/inventarios/migracion.ts` extendido + `comun/pares-traspaso-tela.ts` (detector PURO determinista de pares de traspaso) + `loaders/entradas-salidas-telas.ts` (clasificación **(a)** pares `Factura='Transferencia'`↔salida sin orden → `traspaso` pareado [359/368 limpio en datos reales, 9 reportadas] · **(b)** entradas de compra → `entrada-recepcion` directa `costoUnit=TelasColores.Precio` **SIN RecepcionCompra** · **(c)** salidas con orden → `salida-a-orden` · **(d)** restantes → `ajuste-salida` LISTADO) + `etl-telas.ts` + **`cuadre-f4.ts`** (TelasColAlm v1 vs Σ movimientos v2, descuadres LISTADOS no corregidos D3). **Lotes legacy POR COLOR** (refinamiento técnico de la decisión (f): las salidas legacy no referencian lote y v2 unificó Telas+TelasDis ADR-0009 → por-color cuadra 1:1 con TelasColAlm; `DECISIONES.md §"ETL F4-E6" (E6.1)`, a ratificar con Daniel). **Empresas viejas 1-6 OMITIDAS y listadas** (solo migran 7=Marilyn Fitness / 8=FR Moda); ventana temporal configurable `ETL_VENTANA_ANIOS` (default 0). Idempotencia vía `MapeoMigracion`+uniques; **escritura por lotes** (`enLotes`+`conReintentoTransitorio`); transacción por documento/par (A2); **nada se pierde en silencio** (§7 — todo lo omitido se lista en el reporte de cuadre). **Reconciliación con go-live (decisión (c) de Daniel):** E6 preserva el histórico de consumos y el cuadre; el saldo de existencia de telas al go-live = 0 es de **F10**. Docs `docs/modulos/{compras-mrp,inventario-telas-avios}.md`. **SIN migración Prisma, SIN permisos, SIN seed** → el deploy a `prueba` NO requiere `SEED_ON_START` para E6; el ETL se corre a mano post-deploy (`etl-compras-notas` → `etl-telas` → `cuadre-f4`). CI verde (backend incl. **141 unit de migración**; integración con testcontainers en CI: clasificación, lote 2-componentes con suma+costo, traspaso pareado, **corrida doble = idempotencia**, sin-kardex, CP850 con salto de línea embebido). Ficha en [`docs/hoja-de-ruta/F4-etapas.md`](docs/hoja-de-ruta/F4-etapas.md). **Criterio de salida de F4 a verificar EN VIVO por Gabriel:** el tablero "qué tengo / qué falta" responde igual o mejor que el drive manual. **Siguiente fase: `F5` — Ruta Crítica** (ficha en [`docs/hoja-de-ruta/F5-etapas.md`](docs/hoja-de-ruta/F5-etapas.md)). · **`F4-E5` ✅ (21-jun-2026; 2 reviewers independientes APROBARON —backend y frontend, sin bloqueantes; pendiente verificación de Gabriel en `prueba`) — notas de salida estructuradas (R4)**: sustituye las notas de texto libre por renglones contra catálogo ligados a la orden. Dominio `dominio/notas/notas-salida.ts` (A1): `crearNotaSalida/actualizarNotaSalida/confirmarNotaSalida/cancelarNotaSalida/obtener/listar`. **`confirmarNotaSalida`** en UNA tx (A2) descuenta el kardex **solo de los AVÍOS** (movimiento `salida-por-nota`, ya de E1) bajo **advisory lock por nota** (`bloquearNotaSalida`, namespace `bigint` `0x4e53` disjunto de OC y del kardex → sin doble-confirmación ni deadlock, tomado antes de leer el estatus). **Los renglones de TELA solo REFERENCIAN una salida-a-orden YA registrada (`idMovimientoSalidaTela`) sin generar segundo movimiento (decisión (e))** — garantía **estructural** (confirmar itera solo los avíos) + `validarRenglones` (empresa, `origenTipo=salida-tela-orden`, misma orden, tela/lote en el detalle, **no reversado**, **único entre renglones**) + test anti-doble-descuento. `cancelar` = inverso auditado (D3) que reversa solo los avíos. **Almacén origen en el ENCABEZADO (decisión (g), espejo de la recepción):** `NotaSalida.idAlmacen` validado con `exigirAlmacen` (`comun/almacenes.ts`) al crear/editar **y al confirmar**. Folio `NumNota` A3, soft-cancel, A7/A9. **Migración aditiva `20260621130000`** (`NotaSalida`+`idAlmacen` / `NotaSalidaLinea`). **3 permisos nuevos `notas.ver`/`.administrar`/`.cancelar`** → el deploy a `prueba` requiere **`SEED_ON_START=true`**. **PDF de nota (R9)** (impreso + ruta binaria `GET /notas-salida/:id/impreso`). **Frontend:** módulo `notas-salida/` — captura (encabezado maquilero+almacén; tela elegida de una salida-a-orden, **sin cantidad libre**), consulta por nota y notas por orden (responsive regla 10), diálogos editar/cancelar, descarga de PDF; cliente regenerado, router + 3 entradas de menú. **Incluye el fix de CI** (prettier de 10 archivos de E4 que dejaban roja la `prueba` por formato). 1 coder + 1 reviewer (varias pasadas: backend → correcciones → almacén → frontend → re-revisiones). CI verde local (backend **524** unit; frontend +21 notas + 7 del PDF; integración —anti-doble-descuento, doble-confirmación concurrente, almacén desactivado, atomicidad, reverso— en CI). **SIN tocar F3.** Ficha en [`docs/hoja-de-ruta/F4-etapas.md`](docs/hoja-de-ruta/F4-etapas.md). · **`F4-E4` ✅ (21-jun-2026; reviewer independiente APROBADO —0 bloqueantes; 4 menores, 3 corregidos+re-verificados y 1 confirmado no-issue—; pendiente verificación de Gabriel en `prueba`) — EL CORAZÓN MRP Y CRITERIO DE SALIDA DE LA FASE.** Dominio `compras/mrp.ts` (A1): **`explosionarOrden`** (R3) — requerido = `consumoPorPrenda` del BOM con bandera **`paraProduccion`** × **Σ piezas color×talla** de la orden, para **telas Y avíos**; SIEMPRE por orden (Make-to-Order); persiste el **snapshot `RequerimientoOrden`** (borra+reescribe en UNA tx A2 → congela la explosión) y devuelve el **diff** vs el previo. **Genéricos (decisión (d) de Daniel):** un avío `esGenerico` se **netea contra existencia REAL del kardex** (Σ movimientos, D3) — lo cubierto → "cubierto por stock", solo el faltante a compra; telas y no-genéricos completos. **`generarOCDesdeExplosion`** — agrupa el pendiente **por proveedor** → una OC por proveedor en un clic, **reusando `crearOC`** (folio atómico A3, ligas N:N) y ligando **cada línea a su orden de producción** (R7 sin prorrateos); precio desde `AvioProveedor` (R1); telas omitidas (captura manual, sin liga proveedor en v2). **`estatusMaterialesOrden`** (R7) — cruce **on-demand** Requerido(snapshot) vs En-OC (Σ líneas `estatus != cancelada`) vs Recibido (Σ recepciones `reversadaEn=null`) → `pendiente`/`en-oc`/`recibido-parcial`/`completo`; líneas libres → **'no-identificado'** sin inflar; canceladas/reversadas no cuentan. **Migración aditiva `20260621120000`** (`RequerimientoOrden`: idOrden Cascade, idTela XOR idAvio Restrict, idProveedorSugerido Restrict) — **SIN backfill, SIN seed, SIN permisos** (explosión/estatus=`compras.ver`, generar-OC=`compras.administrar`, ya de E2) → el deploy a `prueba` **NO requiere `SEED_ON_START`**. **Frontend:** 2 pantallas teal — Explosión (agrupada por proveedor, neteo visible, diff marcado, **selección múltiple + "Generar OC"**, imprimir) y Tablero "qué tengo / qué falta" (semáforo R7, **tarjetas en móvil** + tabla en PC). **2 PDFs (R9)** (explosión + estatus) + **E2E Playwright** del flujo explosión→OC→autorizar→recibir→tablero. **Fixes del review cerrados:** (1) **desacople de permiso** — el neteo usa el helper nuevo `existenciaAvioTotalEmpresa` de `comun/kardex.ts` (Σ pura, sin guard, lectura de PLANEACIÓN; único consumidor `mrp.ts`) → rol custom con `compras.ver` sin `inventario-avios.ver` ya no choca; `consultarExistenciasAvio` intacta; (2) **eliminado el `GET /explosion` que mutaba** (regeneración solo en POST); (3) **desempate determinista** del proveedor más barato. (4) la existencia de genéricos lee la vista `existencia_avio` → **NO-issue** (planeación, no validación anti-negativo). 1 coder + 1 reviewer. CI verde (backend **503** unit; frontend páginas 7; integración `mrp.int.test.ts` + e2e en CI). **SIN tocar F3.** Ficha en [`docs/hoja-de-ruta/F4-etapas.md`](docs/hoja-de-ruta/F4-etapas.md). · **`F4-E3` ✅ (21-jun-2026; 2 reviewers independientes APROBARON —el transaccional sin condiciones—; pendiente verificación de Gabriel en `prueba`)** — **recepción de compras (R7)**: `recibirCompra`/`reversarRecepcion` en UNA transacción (A2) que valida OC autorizada (**regla (b)** de Daniel, A4) y el almacén destino (A9, helper `comun/almacenes.ts` compartido con F3 sin regresión), folio A3, crea `RecepcionCompra`/`Linea` + `Lote`+componentes (**D5**), registra la entrada al kardex (`entrada-recepcion`) con **conversión de cantidad ×factor Y costo ÷factor** (invariante de valuación D1/D3), recalcula el estatus de la OC **bajo `pg_advisory_xact_lock` por OC** (anti-carrera R7, namespace `bigint` propio), Bitácora A7 y **publica `material-recibido` vía OUTBOX transaccional**; reverso = inverso auditado (D3) que destraba el candado de cancelación de E2. **Infra NUEVA pg-boss 12 + outbox** (F0 no la dejó; worker tras flag `EVENTOS_COLA_ACTIVA`, consumidor en F5) + **ADR-0011** con el contrato versionado del evento. Permiso `compras.recibir`. Frontend: pantalla de Recepción (lote 1..N componentes desde el catálogo de telas) + historial/reverso + estatus en el listado de OC. Migración aditiva `20260620140000`. **SIN tocar F3** (salvo el dedup idéntico del helper de almacén). 1 coder + 2 reviewers. CI verde (backend **481** unit; frontend **348**; integración en CI: atomicidad/rollback, parciales acumuladas, existencia=Σmov + valuación, outbox atómico, reverso, **concurrencia 500+500→`recibida_total`**). **El deploy a `prueba` requiere `SEED_ON_START=true`** (permiso nuevo). Decisión provisional **(b.1)** en `DECISIONES.md §F4`: costo de componentes acompañantes del lote = **NULL** (confirmar con Daniel antes de F7); **telas se manejan 1:1** (el factor vive en avíos). Ficha en [`docs/hoja-de-ruta/F4-etapas.md`](docs/hoja-de-ruta/F4-etapas.md). · **`F4-E2` ✅ (en `prueba`, PR #62, commit `b4ee1e2`)** — **órdenes de compra**: `OrdenCompra` (folio `NumCompra` por secuencia por empresa A3, estatus **enum** `borrador/pendiente_autorizacion/autorizada/recibida_parcial/recibida_total/cancelada`, autorización usuario+fecha, cancelación suave, `observaciones`/`correspondeA`/`facturasAmparadasLegacy`, A9/A7) + `OrdenCompraLinea` (liga a tela/avío + `idAvioProveedor` para el precio R1, `idOrden` **por línea**, línea libre de fallback) + `OrdenCompraLineaTalla` (detalle talla×color opcional, decisión **(c)**) + `OrdenCompraOrden` (N:N). Dominio `crearOC/actualizarOC/autorizarOC/cancelarOC/duplicarOC/obtenerOC/listarOC` (A1); permisos `compras.ver/.administrar/.cancelar/.autorizar` (ex-acceso #8). Pantallas de listado/captura/autorización (móvil)/compras-por-orden + impreso PDF de OC. **Decisión (a):** OC autorizada bloqueada salvo admin (con Bitácora) + "Duplicar a nueva OC". NO toca el kardex (eso es E3). · **`F4-E1` ✅ (20-jun-2026; reviewer independiente APROBADO sin condiciones; pendiente verificación de Gabriel en `prueba`)** — **kardex de telas y avíos + pantallas de inventario** (primer cimiento de F4, sobre el motor kardex de F3-E1). Motor kardex extendido a las dimensiones **Tela (tela×lote, D5)** y **Avío (R4)** en `comun/kardex.ts` (no-negativo por **suma directa bajo `pg_advisory_xact_lock`, NUNCA la vista** — D3) + **motor de conversión** presentación→unidad de consumo `comun/conversion.ts` (cantidad ×factor, precio ÷factor con invariante de valuación; factor en `AvioProveedor.factorConversion`→`Avio.factorConversion`→1:1, R1; lo consumirá la recepción de E3). Dominio `inventarios/{telas,avios}.ts` (A1): `ajustarInventario` (crea `Lote`+componentes D5 en UNA tx A2, motivo obligatorio), `registrarSalidaTelaAOrden` (ÚNICA vía que descuenta tela hacia una orden, traza `origenId=idOrden` → base del anti-doble-descuento de E5), `traspasar` (atómico; **guard nuevo: no se cancela una sola pata de traspaso**, se revierte con traspaso inverso), `cancelar` (= movimiento INVERSO auditado, NUNCA edita/borra — D3), `consultarExistencias`/`kardex`. **Migración aditiva `20260620120000`** (`Lote`/`LoteComponente`, FK `idLote` en `MovimientoDetTela/Avio`, `factorConversion`, vistas `existencia_tela`/`existencia_avio`). 6 endpoints RBAC (`inventario-telas.ver`/`.mover`, `inventario-avios.ver`/`.mover`) con **importes ocultos server-side** a quien no tenga el ex-acceso #7 `telas.ver-totales`. Frontend: **6 pantallas teal** (Existencias de telas con componentes del lote **expandibles**, Kardex de materiales, Existencias de avíos con `esGenerico`, Salida de tela a orden, Traspaso, Ajuste/inventario físico con captura de lote 1..N; las **3 consultas en móvil**) + **PDF de inventario de telas** (R9). **Equipo:** 1 coder + 1 reviewer independiente (APROBADO, 0 bloqueantes; el guard de cancelación de traspaso + 3 menores se corrigieron en el mismo entregable y el reviewer los re-verificó). CI verde (backend **457** unit; frontend **317** + build; integración con testcontainers en CI). **SIN tocar F3.** **El deploy a `prueba` requiere `SEED_ON_START=true`** (4 permisos + 3 tipos de movimiento nuevos). Decisiones de fase F4 (a–f) cerradas con Daniel en `DECISIONES.md`. Ficha en [`docs/hoja-de-ruta/F4-etapas.md`](docs/hoja-de-ruta/F4-etapas.md). **Siguiente: `F4-E6` (ETL + cuadre de existencias, docs de módulos y cierre de fase F4).**
- **F3 — Producción / WIP: ✅ COMPLETA (6/6, 20-jun-2026).** **`F3-E6` ✅ (20-jun-2026; reviewer independiente APROBADO con 0 bloqueantes + 2 menores cerrados; pendiente verificación de Gabriel en `prueba`) — CIERRE DE FASE F3.** ETL idempotente del histórico real de producción e inventario PT (cargado **por lotes**, vía funciones de dominio de modo-migración no-REST, CP850), con reporte de cuadre y docs de módulo. **Pieza A** (corte + envíos costura/estampado + recibos **en variante SIN efectos derivados** + cargos EsMa): los recibos migrados NO generan entrada al kardex ni `EsMaCargo` (excepción justificada a §7 — el kardex sale solo de `IPT_Movs`, los cargos solo de `EsMa_Recibos`; así las 2,468 entradas tipo 2 del viejo no se duplican); folio por secuencia A3 (el `Consecutivo` viejo no es folio global → se preserva en `MapeoMigracion`). **Pieza B** (kardex IPT + cuadre + docs): `IPT_Movs/IPT_MovsDet`→`Movimiento`+`MovimientoDetPt` con **decisión (c) "sin desglose"** (Color/Talla sentinela `(sin especificar)` inactivos — el viejo nunca tuvo color/talla en PT; cuadra por modelo×almacén); `cuadre-f3.ts` con conteos v1 vs v2, Σ kardex v2 vs `IPT_Mod_Alm` (descuadres LISTADOS con causa, nunca corregidos — D3) y CHECK de no-doble-conteo. Vista `existencia_pt` se deja normal + índices (materializar solo si `prueba` lo exige). **SIN migración Prisma, SIN permisos nuevos, SIN re-seed** → el ETL se corre a mano post-deploy (`etl-produccion` → `etl-ipt` → `cuadre-f3`). 2 coders + 1 reviewer (APROBADO; 8 invariantes confirmados; 2 menores cerrados). CI verde (backend 420 unit + integración en CI). Decisión (c) en `DECISIONES.md`; docs `docs/modulos/{produccion-wip,inventario-pt}.md`. Ficha en [`docs/hoja-de-ruta/F3-etapas.md`](docs/hoja-de-ruta/F3-etapas.md). **Criterio de salida de F3 a verificar EN VIVO por Gabriel:** una orden recorre todo el ciclo y el inventario PT cuadra por kardex. **Siguiente fase: `F4` — Compras / MRP** (ficha en [`docs/hoja-de-ruta/F4-etapas.md`](docs/hoja-de-ruta/F4-etapas.md)). · **`F3-E5` ✅ (19-jun-2026; reviewer independiente APROBADO sin bloqueantes; pendiente verificación de Gabriel en `prueba`)** — **cierre del ciclo de la orden**: PIEZA A **entrega a cliente** (transacción única `EtapaMovimiento(entrega_cliente)` + det color×talla + **salida de kardex PT** tipo `entrega-cliente`/`origenTipo=entregaCliente` con `{tx}` → atomicidad real; **no-negativo ESTRICTO** por suma directa de `MovimientoDetPt` bajo `pg_advisory_xact_lock` orden determinista, NUNCA la vista; **seguimiento del pedido DERIVADO** sin columnas, D3; cancelación por **inverso** auditado `error-salida`; **comprobante PDF**) y PIEZA B **tablero WIP + existencias de maquilero** (pendientes por etapa DERIVADOS de `EtapaMovimientoDet` con drill-down color×talla; "por entregar" = recibido de **costura** −entregado; `soloPendientes` re-validado con `z.boolean()` local; responsive PC+móvil). **2 coders en paralelo + 1 reviewer** (cableado de los 4 archivos compartidos + regeneración del contrato en fase de integración única para evitar carreras). El reviewer **avaló** el reuso de `idAlmacenPrimeras` como almacén de origen solo-display (el autoritativo vive en `Movimiento.idAlmacen`) → **SIN migración**, **SIN permisos nuevos**, **SIN re-seed** (`produccion.entrega`/`.wip-ver`/`.cancelar` y los tipos `entrega-cliente`/`error-salida` ya de E1) → el deploy a `prueba` **NO requiere `SEED_ON_START`**. CI verde (backend **404** unit; frontend **301**; integración —entrega baja existencia, dos entregas concurrentes sin negativo (test real), inverso neutraliza saldo, WIP cuadra celda por celda— + e2e en CI). Ficha en [`docs/hoja-de-ruta/F3-etapas.md`](docs/hoja-de-ruta/F3-etapas.md). **Siguiente: `F3-E6` (ETL de producción e inventario PT + cuadre + docs + cierre de fase) — ⚠️ el ETL debe escribir POR LOTES, no 1×1.** · **`F3-E4` ✅ (19-jun-2026, commit `e691a0c`, **mergeado a `prueba` PR #58**; doble review independiente APROBADO)** — recibo de maquila ⭐ como UNA transacción con efectos por `generaEntradaPt` (costura: WIP + entrada a kardex PT + cargo EsMa; estampado: WIP + cargo, sin tocar PT); `recibido ≤ enviado` estricto; calidad primeras/segundas separada del almacén destino; elimina la bandera "Inventariado"; `validarCargoEsMa`; **migración aditiva `20260619120000`** (calidad + almacenes destino) que se aplica sola en el deploy, sin permisos nuevos ni re-seed. Nota de cierre completa en la ficha. · **`F3-E3` ✅ (19-jun-2026; reviewer independiente APROBADO; pendiente verificación de Gabriel en `prueba`)** — **inventario PT operable** (primer uso real del motor kardex de E1): movimientos manuales, traspasos entre almacenes, existencias y kardex, dominio→API→UI. `registrarMovimientoPt` (entrada/salida manual con tipo del catálogo; las **salidas validan no-negativo** por suma directa del detalle bajo lock, NUNCA la vista —ADR-0010 §3). `registrarTraspasoPt` (abre la tx en dominio, toma el lock, valida existencia del ORIGEN y delega al motor de `comun/kardex.ts` en la MISMA tx — **cierra su TODO** sin tocar el núcleo). `cancelarMovimientoPt` (= movimiento INVERSO auditado con motivo en Bitácora A7; reemplaza 'Error de Entrada/Salida', NUNCA edita/borra — D3). `consultarExistenciasPt` (lee la vista `existencia_pt`, aquí SÍ la vista por ser CONSULTA) y `kardexPt` (por modelo con saldo corrido y por folio). 6 endpoints `/api/inventarios/pt/*` con RBAC (`inventario-pt.ver`/`.mover`); **CERO endpoints de edición/borrado** (D3). Frontend: 4 pantallas teal — Movimientos manuales, Traspaso, **Existencias responsive PC+MÓVIL** (la consulta móvil del módulo) y Kardex (por modelo/folio + cancelación con confirmación); reutiliza `MatrizColorTalla`. **SIN migración** (tablas y vista ya de E1) y **SIN permisos nuevos** (`inventario-pt.*` ya sembrados en E1); lo ÚNICO del seed son **2 tipos de movimiento** nuevos (`transferencia-salida`/`transferencia-entrada`, para las patas del traspaso) → el deploy a `prueba` **requiere `SEED_ON_START=true`**. **`IPT_Revision` NO se construye** (con kardex puro no hay saldo materializado que recuadrar). **Patrón consistente:** las consultas re-validan en el dominio con esquemas LOCALES `z.boolean()` (no el `stringbool` del contrato), evitando de raíz el bug de banderas que afectó a F2 (hotfix `fix(ordenes)` PR #56). **Equipo:** 1 coder + 1 reviewer. CI verde (backend 375 unit; frontend 293; integración —existencia=suma de movimientos, no-negativo en salida/traspaso, traspaso atómico, inverso neutraliza saldo, dos salidas concurrentes sin negativo— + e2e en CI con testcontainers). Ficha en [`docs/hoja-de-ruta/F3-etapas.md`](docs/hoja-de-ruta/F3-etapas.md). **Siguiente: `F3-E4` (recibo de maquila ⭐ — transacción WIP + kardex PT condicionado por proceso + cargo EsMa + validación de cargos).**
- **`F3-E2` ✅ (18-jun-2026; reviewer independiente APROBADO; pendiente verificación de Gabriel en `prueba`)** — primer vertical sobre `EtapaMovimiento`: **corte + envío a maquila unificado** (dominio→API→UI + 2 PDFs), sin tocar el kardex PT todavía (eso llega con el recibo en E4). `registrarCorte` (det color×talla, folio A3, valida cortador con rol `corte`; **sobre-corte LIBRE** —solo avisa, decisión (f)). `registrarEnvioMaquila` (UN servicio para costura Y estampado parametrizado por TipoProceso D8; maquilero filtrado por el rol que mapea al proceso; **sobre-envío ESTRICTO** `enviado ≤ cortado` por proceso, suma directa de `EtapaMovimientoDet` bajo `pg_advisory_xact_lock` tomado ANTES de las sumas, decisión (g)). `cancelarEtapaMovimiento` (suave + motivo + Bitácora; bloquea cancelar un corte con envíos vivos). Consultas DERIVADAS `pendientesPorOrden`/`corteSemanalPorCortador` + `listarEtapasOrden` (historial vivo/cancelado). 9 endpoints RBAC + 2 PDFs (envío + ficha de estampado). Frontend: Captura de corte, Envío unificado (selector de proceso en la MISMA pantalla), Corte semanal **responsive**, e `HistorialEtapasOrden` (cancelar con motivo). **SIN migración, SIN permisos nuevos, SIN tocar el seed** (`produccion.*` ya estaban de E1 → el deploy a `prueba` **NO requiere `SEED_ON_START`**). Decisiones (f)/(g) en `DECISIONES.md` (ambas con tope configurable; para E4 queda fijado **`recibido ≤ enviado`**). **Bloqueante que cazó el reviewer (resuelto):** la cancelación quedaba inalcanzable desde la UI → se agregó `listarEtapasOrden` + `HistorialEtapasOrden`. **Equipo:** 1 coder + 1 reviewer. CI verde (backend 364 unit; frontend producción 12/12; integración —incl. dos envíos concurrentes— en CI). Ficha en [`docs/hoja-de-ruta/F3-etapas.md`](docs/hoja-de-ruta/F3-etapas.md). **`F3-E3` ✅ cerrada** (ver arriba).
- **`F3-E1` ✅ (17-jun-2026, verificada por Gabriel; los 2 reviewers APROBARON)** — cimiento de la fase. **Motor kardex genérico** `backend/src/comun/kardex.ts` (registrar movimiento encabezado+detalle en transacción A2, folio atómico A3, traspaso de 2 patas en UNA transacción, inverso auditado, y `existenciaPtBloqueada`/`bloquearArticuloPt` = suma directa de `MovimientoDet` bajo advisory lock, **NUNCA la vista** — base de "no recibir lo no enviado"/"no entregar lo que no existe" de E4/E5) + despachador de eventos `comun/eventos.ts` (gancho para la RC de F5, sin consumidores). **Modelo de datos de TODA F3 en una migración aditiva única** (`20260617120000_f3_e1_produccion_kardex`): `EtapaMovimiento`/`EtapaMovimientoDet` (corte/envío/recibo/entrega, color×talla D4, folio A3, cancelación suave, idEmpresa A9, liga `idEtapaEnvio` nullable), kardex genérico `Movimiento` + **un detalle por tipo de artículo** `MovimientoDetPt`/`Tela`/`Avio` (extensibilidad verificada D5/R4: F4 agrega tela/avío con código nuevo + 1 FK aditiva, **sin migrar filas ni tocar el núcleo de `kardex.ts`**), `EsMaCargo` (solo esquema; el flujo en E4), `TipoMovimientoInventario`, y la **vista `existencia_pt`** (Σ movimientos, D3, nunca tabla editable). `TipoProceso` extendido con `generaEntradaPt`. **CRUD 'Tipos de proceso'** end-to-end (la marca *genera entrada a PT* editable **solo por admin, validado en el servidor**) + GET de tipos de movimiento. Seeds idempotentes (19 tipos de movimiento desde `IPT_TiposMov.csv` en **CP850**, 3 almacenes PT, tipos de proceso con su bandera) + **9 permisos RBAC nuevos**. ADR-0010. **costoUnit NULL en toda F3** (D1/D2; la valuación llega en F7). **Decisiones de Gabriel (reversibles, ambas defaults — ver `DECISIONES.md`):** (d) liga recibo↔envío = agregado por orden+proceso + campo opcional nullable; (e) `generaEntradaPt` = solo costura (**Gabriel lo confirma con Daniel antes de E4**). **Trampa de la fase (no perder):** agregar una columna con `DEFAULT` a una tabla **ya sembrada en `prueba`** (aquí `tipos_proceso`, nacida en F1) + seed con `update:{}` deja la fila vieja con el default → la pantalla mostraría costura **sin** la bandera en `prueba` aunque los tests en BD limpia pasen; **fix = backfill `UPDATE` en la migración** (lo cazó el 2º reviewer, no los tests). **Equipo:** 1 coder + 2 reviewers (el 2º validó el diseño del ADR **antes** de codear, contra D5/R4 y la liga; luego revisó el diff y halló 2 bloqueantes que el 1º no vio). La decisión de **tolerancia de sobre-corte/sobre-envío** que esto requería ya se consiguió y quedó en `DECISIONES.md` (incisos (f)/(g)). **F3-E2 ✅ cerrada** (ver arriba). Ficha en [`docs/hoja-de-ruta/F3-etapas.md`](docs/hoja-de-ruta/F3-etapas.md).
- **F2 — Pedidos + Órdenes: ✅ COMPLETA (5/5, 17-jun-2026).** **`F2-E1` ✅ (16-jun-2026, en `prueba`, PR #46)** — módulo Pedidos internos + Pedidos Reales (vertical completo: 4 tablas, dominio, API, UI; folio por secuencia por empresa A3, importes ocultos server-side, snapshots `V1` de solo lectura D3). **Diferido pendiente de Daniel:** la política de cancelación del **Pedido Real** (solo queda un TODO; no bloquea el resto). **`F2-E2` ✅ (16-jun-2026, en `prueba`, PR #48)** — verificado por Gabriel en Swagger. Backend de Órdenes completo: 5 tablas (Orden + 34 columnas mapeadas 1:1, OrdenLinea, OrdenLineaTalla, OrdenReferencia con índice D7, OrdenComentario) + migración a mano; dominio (crear con autorrelleno + exige renglón, matriz con estado derivado `completa`/`fechaCompletada`, copiar, cancelar, referencias D7, comentarios, búsqueda combinada); total siempre derivado (sin columna total, D4/D3); folio por empresa (A3); 9 endpoints REST + OpenAPI + cliente front; script demo + guía `VERIFICACION-F2-E2.md`. **Decisiones (Gabriel, 16-jun):** UPC eliminado (sin `generarUPC`; `upc` solo dato histórico de lectura) y orden sin pedido = solo histórico (captura nueva exige renglón; FK nullable solo para el ETL). **`F2-E3` ✅ (16-jun-2026, en `prueba`, PR #50)** — verificado por Gabriel. Frontend completo de Órdenes: **componente reutilizable `matriz-color-talla`** (presentación pura A1, reuso en F3/F6: filas=colores × columnas=tallas de la curva + extra, totales en vivo, captura por teclado, solo-lectura, README del contrato) + **pantalla Producción → Órdenes** (lista+detalle: alta pedido→renglón con autorrelleno, editor de encabezado, matriz, copiar matriz, referencias D7 dinámicas por cliente, comentarios inmutables, cancelar con motivo, badge de estado derivado). Hooks TanStack, ruta y entrada de menú "Órdenes". **Sin botón "Generar UPC"** (UPC en retiro, decisión Gabriel). Review independiente APROBADO; CI frontend en verde. **`F2-E4` ✅ (16-jun-2026, en `prueba`, PR #52)** — verificado por Gabriel. Operación diaria de Órdenes: **impreso de orden (R9)** en PDF server-side (`@react-pdf/renderer`, primer PDF de servidor del repo) individual y por **lote consolidado** (encabezado + fotos R2 + matriz con totales + telas/bordados/habilitación del BOM; **sin precios ni código de barra**; se imprime con solo `ordenes.ver`, foto faltante no truena); **consulta ligera** con filtros + impresión múltiple; **órdenes incompletas** con semáforo derivado (verde ≤3d / amarillo 4–7d / urgente >7d); **tablero 'Pedidos por mes'** con saltos; **buscador global** en el layout (folio / modelo / valor de OrdenReferencia D7). 6 endpoints nuevos con **proyecciones ligeras** (NO reusan el listado pesado de E2), todo `ordenes.ver` (**sin permisos nuevos → sin re-seed, sin migración**). Construido por **2 coders en paralelo con límites de archivos declarados** (pieza A impreso / pieza B consultas+frontend) + reviewer independiente (APROBADO; 1 menor [el impreso ya no exige `modelos.ver`] + 3 nits, todos cerrados). **`F2-E5` ✅ (17-jun-2026, verificada por Gabriel; reviewer independiente APROBADO con 0 bloqueantes + 3 menores corregidos) — CIERRE DE FASE F2.** ETL idempotente de pedidos y órdenes (7 CSVs reales, CP850) cargado vía un **modo migración** dedicado en la capa de dominio (A1, NO expuesto en el API → E1–E4 intactos): preserva folios viejos, órdenes sin pedido (idPedidoLinea NULL en las 26 históricas), estado/fechaCompletada desde el viejo, snapshots V1 y auditoría original; siembra de secuencias `pedido`/`orden` por empresa al máximo migrado (A3); despivote de la matriz parseando `Ordenes.Tallas` (catálogo real de **183 cadenas**); **reporte de cuadre en dos niveles** (filas/sumas + columnas, plan §7) que LISTA las inconsistencias para Daniel (**8 cadenas de talla ambiguas**, **~1,415 piezas sin etiqueta**, Monarch == código del modelo descartados ~3,212, **26 órdenes sin pedido**); docs de módulo `docs/modulos/{pedidos,ordenes}.md`. **En el MISMO cambio: RETIRO TOTAL de los códigos de barra** (decisión de Gabriel, ya no se usan): eliminado el módulo `codigos-barra` (front+back), el permiso `modelos.codigos-barra`, las columnas `Orden.upc` y `Empresa.upc` (migración `20260616140000_retiro_codigos_barra`), el generador/impreso de F1-E5 y su UI; deps `bwip-js` y `@react-pdf/renderer` quitadas del frontend; menú a 18. CI local verde (backend 345 + 110 migración, frontend 270). **Pendiente operativo de Gabriel:** commit → PR a `prueba` → correr `npm run etl:pedidos-ordenes` en Railway (el ETL es re-ejecutable; se vuelve a correr en F10 al corte). **Siguiente fase: `F3` — Producción / WIP** (ficha en [`docs/hoja-de-ruta/F3-etapas.md`](docs/hoja-de-ruta/F3-etapas.md)). Ficha de F2 en [`docs/hoja-de-ruta/F2-etapas.md`](docs/hoja-de-ruta/F2-etapas.md).
- **F1 — Catálogos + Modelos: ✅ COMPLETA (15-jun-2026, en `prueba`).** Las 8 etapas hechas, verificadas por Gabriel y desplegadas en `prueba`: `F1-E1` ✅, `F1-E1B` ✅, `F1-E2` ✅, `F1-E3` ✅, `F1-E4` ✅, `F1-E5` ✅, `F1-E6` ✅ (ETL de catálogos/materiales + mapeos `MapeoMigracion` + fusión de colores; PR #42/#43) y **`F1-E7` ✅ (ETL de modelos+BOM + cuadre de fase + docs de módulo + cierre; PR #44)**. **Criterio de salida F1 cumplido:** un modelo real con su receta completa capturado y verificado en `prueba`. **Pendiente explícito (no bloquea):** el ETL de **fotos masivas** quedó construido y probado, pero la **carpeta física de fotos** (`S:\...\FotosMod` + bordados) aún no la tiene Gabriel — se corre con `--fotos-modelos`/`--fotos-bordados` cuando la consiga. **Decisión abierta para Daniel:** avío `IdHabilitacion=12` (842 recetas lo usan) fue borrado del catálogo viejo — ¿re-darlo de alta o dejarlo retirado? **Siguiente fase: `F2` — Pedidos + Órdenes** (ficha en [`docs/hoja-de-ruta/F2-etapas.md`](docs/hoja-de-ruta/F2-etapas.md)).
- **Hecho:** ingeniería inversa + diseño ✅ 100 % (validado por Daniel). **F0 (Fundación) ✅ construida y desplegada** — desde el 12-jun-2026 corre en Railway **como ambiente de prueba** (login real funcionando). El despliegue de **producción NO se monta todavía**: se contrata al acercarse el go-live, por costo (decisión de Gabriel, 12-jun-2026).
- **Pendientes manuales de Gabriel** (no bloquean el arranque de F1): cambiar el password de `admin` (seed `Control.2026!`), activar backups del Postgres en Railway, montar **Cloudflare R2** (⚠️ sí se necesita antes de F1-E3/E4, que suben fotos), borrar el servicio frontend viejo si quedó en el canvas, y proteger las ramas exigiendo los checks del CI.

```
Entender + diseñar    : ██████████  100 %  ✅
Construir (F0–F10)    : █████████░  F0–F9 ✅ (10 de 11) + rediseño R1–R9 ✅ + remates post-F9 ✅ · F10 pendiente de arranque
```

| Fase | Etapas | Estado |
|---|---|---|
| **F0 · Fundación** | 5 | ✅ **hecha** (construida + desplegada como prueba, 12-jun-2026) |
| **F1 · Catálogos + Modelos** | 8 | ✅ **hecha** (8 etapas, verificadas y en prueba, 15-jun-2026) |
| **F2 · Pedidos + Órdenes** | 5 | ✅ **hecha** (5 etapas, 17-jun-2026) |
| **F3 · Producción / WIP** | 6 | ✅ **hecha** (6 etapas, 20-jun-2026) |
| **F4 · Compras / MRP** | 6 | ✅ COMPLETA (6/6, 22-jun-2026) |
| **F5 · Ruta Crítica ⭐** | 7 | ✅ COMPLETA (7/7, 23-jun-2026) |
| **F6 · Calidad + EsMa** | 6 | ✅ COMPLETA (6/6, 2-jul-2026) |
| **F7 · Costos / EDR + Indicadores** | 6 | ✅ COMPLETA (6/6, 3-jul-2026) |
| **F8 · Desarrollo, Cotización y Listas de Precios** | 6 | 🔄 EN CURSO (E1–E5 ✅ 5/6; D13) |
| **F9 · Finanzas (CxC/CxP + CFDI)** | 6 | ✅ COMPLETA (6/6, 10-jul-2026; ETL en espera del corte SINUBE) |
| **F10 · Migración + Go-live** | 7 | ⬜ (antes F9) |

---

## 2. Cómo funciona el trabajo (el "motor")

Cada **etapa** es una tarea cerrada que pasa siempre por el mismo circuito:

1. **El lead (orquestador)** especifica la etapa a partir de su ficha (no escribe código de producción).
2. Un **coder** la construye (o varios en paralelo **solo si** las piezas son independientes — la ficha de cada etapa ya lo dice).
3. Un **reviewer independiente** la revisa; **tiene la última palabra** y rige *"todo lo menor es mayor"* (cero pendientes diferidos).
4. **Gabriel verifica** con el checklist "Verificación de Gabriel" de la ficha (navegador o `docker compose up`).
5. Recién entonces se integra: **rama de tarea → PR a `prueba` → PR a `main`** (nunca directo), con el CI en verde.

### ⚙️ Reglas de MÉTODO nacidas en V1-E8j, V1-E8k y V1-E8l (aplican a toda etapa, no sólo a ésas)

- 🟢 **Se puede correr INTEGRACIÓN en local sin Docker.** La regla del proyecto prohíbe **Docker y
  testcontainers**, no un PostgreSQL ya instalado: se arranca el que trae la máquina, se le aplican las
  migraciones reales y se corre Vitest con una config de **scratchpad** que sustituye el `globalSetup`.
  `vitest.config.ts` **queda intacto** y nada de esa config se comitea. Con esto se pueden **ver morir
  las mutaciones de integración sin esperar al CI** — antes eran siempre «lo juzga el CI».
  **Pasos exactos:** `docs/hoja-de-ruta/V1-etapas.md` §V1-E8j → *«Correr integración en local sin Docker»*.
- 🔴 **Al mutar para probar un candado, restaura con `cp`, NUNCA con `git checkout --`.** Sobre trabajo
  **sin comitear**, `git checkout` lo **borra**: en V1-E8j se perdió un refactor entero y la corrida
  siguiente salió con 11 rojas. Se detectó sólo porque la **BASE se corre antes y después** — háganlo
  siempre. Lo más seguro: **comitear antes de mutar**.
- 🟡 **Una regla nueva necesita su prueba en el estado ACUMULADO, no sólo en el primer acto (V1-E8k).**
  La mutación que EXCEDE —contar dos veces lo que ya se había devuelto— **sobrevivió a 33 pruebas**
  porque todas medían el PRIMER movimiento, donde el acumulado está vacío y el doble conteo no se nota.
  El defecto sólo asomaba en el segundo. Al escribir la mutación que EXCEDE, pregúntese: *¿mi caso
  parte de cero, o de un estado ya construido?* Si parte de cero, la mutación no la va a matar.
  Detalle: `docs/hoja-de-ruta/V1-etapas.md` §V1-E8k → *«Cómo se verificó»*.
- 🟡 **Una guarda con DOS consumidores necesita DOS aserciones positivas, aunque el booleano sea uno
  solo (V1-E8l).** La etapa escondió una columna con un `puedeVerCostoReal` calculado **una vez** y
  aplicado a la tabla de escritorio **y** a la tarjeta de móvil — «para que no puedan divergir». Pero la
  prueba positiva acotaba todo a `getByTestId('modelos-tabla')`, así que **apagar el ternario del móvil
  dejaba la suite 41/41 en VERDE**: el booleano no divergía, **la COBERTURA sí**. En un cambio de
  *«esto se ve / esto no se ve»*, enumere **cada sitio que lo pinta** y exija a cada uno sus dos
  direcciones. Y acote la aserción **al sitio**, no a un contenedor que sólo cubre uno de ellos.
  Detalle: `docs/hoja-de-ruta/V1-etapas.md` §V1-E8l → *«Cómo se verificó»*.

**Reglas transversales a toda etapa** (del `PLANMAESTRO.md`, se verifican en cada review): lógica de negocio solo en `backend/src/dominio` (A1) · transacciones multi-tabla (A2) · folios por secuencia atómica (A3) · existencias solo por kardex (D3) · RBAC en cada ruta (A4) · auditoría uniforme (A7) · el contrato **OpenAPI se regenera y el cliente del frontend se sincroniza en la misma etapa** · los impresos (R9) van dentro de la etapa de su grupo funcional · la **última etapa de cada fase** incluye su parte del ETL, la doc del módulo en `docs/modulos/` y la verificación del criterio de salida en el ambiente de prueba.

---

## 3. Las fases y sus etapas

Cada fase tiene su **ficha completa** en `docs/hoja-de-ruta/F#-etapas.md`: por etapa van objetivo, alcance concreto, entregables, criterio de cierre, **checklist de verificación para Gabriel**, equipo sugerido y referencias a la doc funcional. Lo de abajo es el índice con estado. **El desglose de una fase se confirma/ajusta al arrancarla** (es plan, no escritura sagrada — lo que cambie se actualiza en la ficha y aquí).

### F0 · Fundación — ✅ HECHA

**Salida cumplida:** `docker compose up` levanta todo; app desplegada en Railway; login real; CRUD patrón (Almacenes) end-to-end.

| Etapa | Qué entregó | Estado |
|---|---|---|
| **F0-E1** | Esqueleto dockerizado (backend Fastify + frontend nginx + compose) + tema claro/oscuro | ✅ en main |
| **F0-E2** | Datos + dominio: Prisma (14 tablas), seed real FR Moda, motores comunes (folios A3, auditoría A7, permisos, archivos R2). 114 tests | ✅ en main |
| **F0-E3** | API REST + OpenAPI + login real (bloqueo a 5 intentos) + permisos server-side. 149 tests | ✅ en main |
| **F0-E4** | Frontend: login, layout 13 módulos por permisos, CRUD patrón Almacenes, cliente tipado. 38 tests | ✅ en main |
| **F0-E5** | CI bloqueante, railway.json, ADRs 0001–0006, guía Railway/R2, limpieza | ✅ en main |
| **Despliegue** | Railway (Postgres + backend + frontend privados/público) — **funge como ambiente de prueba** | ✅ 12-jun-2026 |

### F1 · Catálogos + Modelos — ✅ HECHA (15-jun-2026, en `prueba`)

**Salida cumplida:** Un modelo real con su receta completa, capturado y verificado en el ambiente de prueba. · **Ficha completa con notas de cierre:** [`docs/hoja-de-ruta/F1-etapas.md`](docs/hoja-de-ruta/F1-etapas.md)

| Etapa | Qué entrega | Equipo | Estado |
|---|---|---|---|
| **F1-E1** | Catálogos sencillos + mini-pantallas de Administración (usuarios/empresas) + decisión A9 | 1 coder backend (cat.) → 1 coder backend (admin) → 1 coder frontend + 1 reviewer (cadena por contrato, ver nota de cierre) | ✅ **13-jun-2026 (en prueba)** |
| **F1-E1B** | Catálogo de Proveedores **enriquecido** (R15): roles multi-valor + campos fiscales/pago/operativos + adjuntos R2 — cimiento de las CxP (D12) | 1 coder + 1 reviewer (extiende el Proveedor de E1) | ✅ **13-jun-2026 (en prueba)** |
| **F1-E2** | Catálogos estructurados: maquila unificada, tallas/curvas D4 y clientes D7 | 3 coders en paralelo + 1 reviewer | ✅ **13-jun-2026 (en prueba)** · ⚠️ **rectificado 14-jun (D12/R15): se ELIMINÓ el catálogo de Maquilero — un maquilero es un Proveedor con roles de servicio, ver abajo)** |
| **F1-E3** | Catálogos de materiales: telas unificadas, avíos R1 y bordados con foto R2 | 3 coders en paralelo + 1 reviewer | ✅ **14-jun-2026 (en prueba)** |
| **Fusión de terceros** | Rectificación D12/R15: se eliminan los catálogos `Maquilero` (de F1-E2) y `Cortador` (de F1-E1) — UN solo catálogo de terceros: el Proveedor con casillas de roles. `precioReferencia` del cortador → desuso; el **costo del corte va en la orden (F2/F3)**. `TipoProceso` se conserva para la Ruta Crítica (F5). | 1 coder + 1 reviewer (rama `tarea/fusion-terceros`) | 🔄 14-jun-2026 |
| **F1-E4** | Modelos: ficha + fotos R2 + BOM completo | 1 coder + 1 reviewer (cadena sobre los mismos archivos) | ✅ **14-jun-2026 (en prueba)** |
| **F1-E5** | Galería de modelos + generador de códigos de barra por empresa | 2 coders + 1 reviewer | ✅ **14-jun-2026 (en prueba)** |
| **F1-E6** | ETL de catálogos y materiales + mapeos reutilizables + fusión de colores | 2 coders en paralelo + 1 reviewer | ✅ **15-jun-2026 (en prueba)** · PR #42/#43 |
| **F1-E7** | ETL de modelos + BOM + fotos masivas + docs del módulo + cierre de fase en `prueba` | 1 coder + 1 reviewer | ✅ **15-jun-2026 (en prueba)** · PR #44 · **cierre de fase F1** |

### F2 · Pedidos + Órdenes — ✅ HECHA (5 etapas, 17-jun-2026)

**Salida:** Un pedido fluye hasta su orden; impreso de orden. · **Ficha completa:** [`docs/hoja-de-ruta/F2-etapas.md`](docs/hoja-de-ruta/F2-etapas.md)

| Etapa | Qué entrega | Equipo | Estado |
|---|---|---|---|
| **F2-E1** | Pedidos internos + Pedidos Reales | 1 coder + 1 reviewer (con corte de contingencia E1a/E1b previsto) | ✅ **16-jun-2026 (en prueba)** · PR #46 |
| **F2-E2** | Órdenes: datos + dominio + API | 1 coder + 1 reviewer (review en dos cortes) | ✅ **16-jun-2026 (en prueba)** · PR #48 |
| **F2-E3** | Frontend de órdenes: componente MatrizColorTalla (se reusa en F3/F6) + captura completa | 1 coder + 1 reviewer | ✅ **16-jun-2026 (en prueba)** · PR #50 |
| **F2-E4** | Consultas, tableros, búsqueda global e impreso de orden | 2 coders en paralelo + 1 reviewer (límites de archivos declarados) | ✅ **16-jun-2026 (en prueba)** |
| **F2-E5** | ETL de pedidos y órdenes + documentación + cierre de fase (+ retiro total de códigos de barra) | 1 coder + 1 reviewer | ✅ **17-jun-2026** · cierre de fase F2 |

### F3 · Producción / WIP — ✅ HECHA (6 etapas, 20-jun-2026)

**Salida:** Una orden recorre todo el ciclo; inventario PT cuadra por kardex. · **Ficha completa:** [`docs/hoja-de-ruta/F3-etapas.md`](docs/hoja-de-ruta/F3-etapas.md)

| Etapa | Qué entrega | Equipo | Estado |
|---|---|---|---|
| **F3-E1** | Modelo de datos F3 + motor kardex genérico + catálogos base | 1 coder + 2 reviewers | ✅ **17-jun-2026** |
| **F3-E2** | Corte + envío a maquila unificado | 1 coder + 1 reviewer | ✅ **18-jun-2026** |
| **F3-E3** | Inventario PT operable: movimientos, traspasos, existencias y kardex | 1 coder + 1 reviewer | ✅ **19-jun-2026** |
| **F3-E4** | **Recibo de maquila ⭐** — transacción WIP + kardex PT + cargo EsMa (el punto de integración central del plan) | 1 coder + 2 reviewers independientes | ✅ **19-jun-2026** (commit `e691a0c`, en `prueba` PR #58; doble review APROBADO) |
| **F3-E5** | Entrega a cliente + tablero WIP y consultas | 2 coders en paralelo + 1 reviewer | ✅ **19-jun-2026** (reviewer APROBADO; pend. verif. Gabriel) |
| **F3-E6** | ETL de producción e inventario PT + cuadre + docs + cierre de fase | 2 coders en paralelo + 1 reviewer | ✅ **20-jun-2026** (reviewer APROBADO; pend. verif. Gabriel) · cierre de fase F3 |

### F4 · Compras / MRP — ✅ COMPLETA (6/6, 22-jun-2026)

**Salida:** El tablero "qué tengo / qué falta" reemplaza el drive manual. · **Ficha completa:** [`docs/hoja-de-ruta/F4-etapas.md`](docs/hoja-de-ruta/F4-etapas.md)

| Etapa | Qué entrega | Equipo | Estado |
|---|---|---|---|
| **F4-E1** | Kardex de telas y avíos + pantallas de inventario | 1 coder + 1 reviewer (la más cargada de la fase; contingencia prevista en la ficha) | ✅ (20-jun-2026) |
| **F4-E2** | Órdenes de compra: captura, autorización, cancelación, consultas e impresos | 1 coder + 1 reviewer (puede correr en paralelo con E1) | ✅ (en prueba, PR #62) |
| **F4-E3** | Recepción de compras: lotes D5, entrada al kardex y evento para la RC | 1 coder + 2 reviewers | ✅ (21-jun-2026) |
| **F4-E4** | Explosión R3, generar OC desde la explosión y tablero "qué tengo / qué falta" | 1 coder + 1 reviewer | ✅ (21-jun-2026) |
| **F4-E5** | Notas de salida estructuradas: captura, consumo de avíos, consultas e impreso | 1 coder + 1 reviewer | ✅ (21-jun-2026) |
| **F4-E6** | ETL + cuadre de existencias, docs de módulos y cierre de fase | 2 coders en paralelo + 1 reviewer | ✅ (22-jun-2026) · cierre de fase F4 |

### F5 · Ruta Crítica ⭐ — ✅ COMPLETA (7/7)

**Salida:** Una orden corre con su RC y las fechas se llenan solas donde aplica. · **Ficha completa:** [`docs/hoja-de-ruta/F5-etapas.md`](docs/hoja-de-ruta/F5-etapas.md)

| Etapa | Qué entrega | Equipo | Estado |
|---|---|---|---|
| **F5-E1** | Procesos como datos: catálogo + roles responsables + DAG de dependencias + checklists | 1 coder + 1 reviewer | ✅ **22-jun-2026** (reviewer APROBADO; pend. verif. Gabriel) |
| **F5-E2** | Plantillas de ruta por familia + reglas de duración + calendario laboral | 1 coder + 1 reviewer (solape de esquema/contrato → no se paralelizó) | ✅ **22-jun-2026** (reviewer/lead APROBADO; pend. verif. Gabriel) |
| **F5-E3** | Motor RC parte 1: jobs + datos de la ruta viva + generación de ruta | 1 coder + 2 reviewers | ✅ **22-jun-2026** (reviewers APROBARON; pend. verif. Gabriel) |
| **F5-E4** | Motor RC parte 2: CPM en pg-boss + captura de avance + semáforo | 1 coder + 2 reviewers | ✅ **22-jun-2026** (2 reviewers APROBARON; pend. verif. Gabriel) |
| **F5-E5** | Pantallas: Programar RC, bandeja de tareas con semáforo, RC por orden | 1 coder backend + 1 coder frontend (secuenciales, solape de cliente/router/header) + 1 reviewer | ✅ **22-jun-2026** (reviewer APROBADO; pend. verif. Gabriel) |
| **F5-E6** | Auto-avance: eventos de dominio en F3/F4 y suscriptor de la RC | 1 coder + 1 reviewer | ✅ **23-jun-2026** (reviewer APROBADO; pend. verif. Gabriel) |
| **F5-E7** | Concentrado planeado vs real + exportación + ETL + docs + cierre de fase | 2 coders en paralelo + 1 reviewer | ✅ **23-jun-2026** (reviewer APROBADO, 1 bloqueante corregido; pend. verif. Gabriel) · **cierre de fase F5** |

### F6 · Calidad + EsMa — ✅ COMPLETA (6/6)

**Salida:** EsMa cuadra contra los recibos del periodo. · **Ficha completa:** [`docs/hoja-de-ruta/F6-etapas.md`](docs/hoja-de-ruta/F6-etapas.md)

| Etapa | Qué entrega | Equipo | Estado |
|---|---|---|---|
| **F6-E1** | Calidad: catálogo de defectos + motor de planes AQL + consulta de bitácora | 1 coder + 1 reviewer (Calidad y EsMa pueden correr en paralelo) | ✅ **24-jun-2026 (en prueba, PR #80)** |
| **F6-E2** | Calidad: auditorías con folio atómico + **resultado MANUAL** + integración RC + reclasificación (+ **PT-por-orden**, ADR-0014) | 1 coder + 1 reviewer | ✅ **1-jul-2026 (en prueba, PR #81)** |
| **F6-E3** | Calidad: consulta e impresión (R9), historial por maquilero, modificar/cancelar | 1 coder + 1 reviewer | ✅ **1-jul-2026 (en prueba, PR #82)** |
| **F6-E4** | EsMa: movimientos, validación de cargos, saldos (derivados D3), conciliación, prendas-por-pagar (g), recibo de pago R9 | 1 coder + 1 reviewer | ✅ **1-jul-2026 (2 reviewers APROBARON; pend. verif. Gabriel)** |
| **F6-E5** | EsMa: estado de cuenta, saldos de todos, semanales, desglosado (Excel) + impreso R9 + vista móvil | 1 coder + 1 reviewer | ✅ **1-jul-2026** (reviewer APROBÓ; pend. commit/PR + verif. Gabriel) |
| **F6-E6** | ETL Calidad + EsMa, reporte de cuadre v1 vs v2, docs y cierre de fase | 2 coders en paralelo + 1 reviewer | ✅ **2-jul-2026** (reviewer APROBÓ; pend. verif. Gabriel) · cierre de fase F6 |

### F7 · Costos / EDR + Indicadores — ✅ COMPLETA (6/6)

**Salida:** Costos y tableros cuadran contra el cálculo manual. · **Ficha completa:** [`docs/hoja-de-ruta/F7-etapas.md`](docs/hoja-de-ruta/F7-etapas.md) · **Decisiones de negocio cerradas con Daniel (2026-07-02):** ver `DECISIONES.md` D2 (12 puntos) — regalía fuera del costo, redondeo del precio al alza, EDR desde facturación real, gastos globales, entrega-a-tiempo vs RC, 5S fuera, histórico de EDR no se migra.

| Etapa | Qué entrega | Equipo | Estado |
|---|---|---|---|
| **F7-E1** | Motor de costeo: pre-costo, costo de orden y márgenes por pedido (D1) | 1 coder + 1 reviewer | ✅ **3-jul-2026** (reviewer APROBÓ; CI verde; pend. verif. Gabriel en prueba) |
| **F7-E2** | EDR automatizado: generación desde entregas, conciliación, consultas | 1 coder + 1 reviewer | ✅ **3-jul-2026** (reviewer APROBÓ; CI verde; pend. verif. Gabriel en prueba) |
| **F7-E3** | Motor de KPIs en segundo plano (pg-boss) + tableros directivos (D11) | 1 coder + 1 reviewer (+1 coder opcional para páginas) | ✅ **3-jul-2026** (reviewer pidió cambios→corregidos; CI verde; pend. verif. Gabriel en prueba) |
| **F7-E4** | Productividad unificada IP/Almacén + fichas confiables + muestrarios | 1 coder + 1 reviewer | ✅ **3-jul-2026** (reviewer APROBÓ; CI verde; pend. verif. Gabriel en prueba) |
| **F7-E5** | Inventario cíclico contra el kardex propio (D6); 5S descartado por Daniel | 1 coder + 1 reviewer | ✅ **3-jul-2026** (reviewer APROBÓ tras 1 corrección —concurrencia B1—; CI verde; pend. verif. Gabriel en prueba) |
| **F7-E6** | ETL histórico + cuadre numérico v1 vs v2 + docs y cierre de fase | 1 coder + 1 reviewer | ✅ **3-jul-2026** (reviewer APROBÓ tras 1 ajuste; verificación local verde; pend. verif. Gabriel en prueba) · cierre de fase F7 |

### F8 · Desarrollo, Cotización y Listas de Precios — ✅ COMPLETA (6/6, 6-jul-2026)

**Salida:** Un desarrollo recorre el ciclo completo: proyecto → precosteo amarrado → lista con factores del cliente → aprobación del dueño → una ronda de negociación versionada → liga a orden de producción → el MRP sugiere la tela con proveedor/precio predefinidos y compra los avíos por medidas por talla. · **Ficha completa:** [`docs/hoja-de-ruta/F8-etapas.md`](docs/hoja-de-ruta/F8-etapas.md)

| Etapa | Qué entrega | Equipo | Estado |
|---|---|---|---|
| **F8-E1** | Cimientos: precios amarrados (telas por proveedor y por color, R17), medidas por talla en avíos (R18), conceptos de costo/estados de lista/departamentos del cliente + **modelo de datos de TODA la fase en una migración** + permisos sembrados | 1 coder + 1 reviewer (contingencia E1a/E1b prevista en la ficha) | ✅ **4-jul-2026** (E1a+E1b; 2 reviewers APROBARON; pend. verif. Gabriel en `prueba`) |
| **F8-E2** | Proyectos de desarrollo (1 cliente + 1 departamento, con tema; R16) + desarrollos con estado derivado + módulo "Desarrollo" en el menú | 1 coder + 1 reviewer | ✅ **4-jul-2026** (reviewer APROBÓ; sin migración/permisos nuevos; pend. verif. Gabriel en `prueba`) |
| **F8-E3** | **Motor de precosteo por desarrollo ⭐**: persistido, amarrado a proveedor/producto/precio, versionable por congelado inmutable (R17/R18/R19) | 1 coder + 2 reviewers (motor central) | ✅ **5-jul-2026** (2 reviewers; sin migración/permisos nuevos; write-skew/D3 cerrado; pend. verif. Gabriel en `prueba`) |
| **F8-E4** | Factores del cliente + lista de precios por cliente+departamento + **aprobación del dueño modelo por modelo** + impreso PDF (R9) y Excel | 1 coder + 1 reviewer | ✅ **6-jul-2026** (reviewer APROBÓ tras cerrar B1/N1–N7; sin migración/permisos/seed nuevos; pend. verif. Gabriel en `prueba`) |
| **F8-E5** | **Negociación por versiones**: re-costeo interactivo, acuerdos por modelo, estados configurables, archivo del departamento | 1 coder + 1 reviewer | ✅ **6-jul-2026** (reviewer APROBÓ; 1 hallazgo de doc cerrado en la misma ronda; migración `@@unique([idDesarrollo])`, sin permisos/seed nuevos; rebasada sobre `prueba`+PR #98; pend. verif. Gabriel en `prueba`) |
| **F8-E6** | Enganche: liga desarrollo↔orden, el MRP/OC hereda amarres y medidas por talla (telas dejan de capturarse a mano), tablero + **adjuntos R6 de la orden** + docs + **cierre de fase** | 1 coder + 1 reviewer (por sub-pieza E6a/E6b) | ✅ **6-jul-2026** (E6a backend + E6b front/adjuntos/cierre; 2 reviewers APROBARON; migración aditiva `orden_archivo` + borrado físico R2 saldado para órdenes; back 775 / front 532; pend. verif. Gabriel en `prueba`) |

> **Nota F8:** fase integrada el **4-jul-2026** (decisión **D13**, requisitos **R16–R20**, módulo **15**) desde `Documentacion_MJD/PROPUESTA-Desarrollo-Cotizacion-y-Listas-de-Precios.md`; con su inserción, **Finanzas pasó de F8 a F9** y **Go-live de F9 a F10**. Las sub-decisiones de negocio **ya las resolvió Daniel** (ver D13); las pocas preguntas restantes van **con defaults** en la ficha (se hacen todas juntas al arrancar, regla §6). **SIN ETL de Access** (proyectos/listas/negociación vivían en Excel; arranca en cero, como el EDR). **No tiene dependencia técnica con F9 (Finanzas)**: usa el motor de costeo de F7, el BOM/proveedores de F1 y el MRP/OC de F4. El esquema Prisma de la ficha es partida aterrizada contra el código real, se confirma al construir.

### F9 · Finanzas (CxC/CxP + CFDI) — 🔨 en curso (E1 ✅ código, pend. review + verif. Gabriel)

**Salida:** CxC y CxP cuadran por suma de movimientos; un CFDI de proveedor y uno de venta importados, conciliados y ligados a su operación; reporte fiscal para el contador. · **Ficha completa:** [`docs/hoja-de-ruta/F9-etapas.md`](docs/hoja-de-ruta/F9-etapas.md)

| Etapa | Qué entrega | Equipo | Estado |
|---|---|---|---|
| **F9-E1** | Motor de cuenta corriente de terceros (generaliza EsMa, R10): movimiento con ejes origen+fiscal, saldo = Σ movimientos, notas de crédito, dos vistas | 1 coder + 2 reviewers (motor central) | ✅ código (pend. review + verif. Gabriel) |
| **F9-E2** | CxP — cuentas por pagar de proveedores: cargos desde recibos/entradas/OC, pagos/abonos, estado de cuenta, conciliación con maquila (EsMa) | 1 coder + 1 reviewer | ⬜ |
| **F9-E3** | Importación de CFDI de proveedores (R11): parseo/validación del XML, ligado a OC/entrada, conciliación del cargo, XML en R2 | 1 coder + 1 reviewer | ⬜ |
| **F9-E4** | CxC — cuentas por cobrar + importación de CFDI de ventas (R12): XML timbrado por fuera → cargo CxC ligado a pedido/cliente, cobros, estado de cuenta | 1 coder + 1 reviewer | ⬜ |
| **F9-E5** | Reportes fiscales para el contador (R13): exportación de movimientos fiscales de clientes y proveedores; vistas y conciliaciones | 1 coder + 1 reviewer | ⬜ |
| **F9-E6** | ETL de saldos/históricos de terceros (desde SINUBE/CFDI) + cuadre + docs del módulo + cierre de fase en `prueba` | 1 coder + 1 reviewer | ⬜ |

> **Nota F9:** el **timbrado nativo vía PAC (R14)** es sub-entrega **posterior** (lo regulado) — no entra en estas 6 etapas; queda como visión a futuro una vez que R10–R12 dejaron la estructura lista. El **catálogo de proveedores enriquecido (R15)** NO está aquí: se construye antes, en **F1-E1B** (es el cimiento de las CxP). El desglose se confirma/ajusta al arrancar la fase (esquema Prisma y pantallas se definen al construir, D12 §8). *(Era F8; renumerada el 4-jul-2026 al insertarse la nueva F8, D13.)*

### F10 · Migración + Go-live — ⬜ pendiente

**Salida:** Saldos v2 = saldos Access en fecha de corte; usuarios operando. · **Ficha completa:** [`docs/hoja-de-ruta/F10-etapas.md`](docs/hoja-de-ruta/F10-etapas.md)

| Etapa | Qué entrega | Equipo | Estado |
|---|---|---|---|
| **F10-E1** | Cimientos del ETL integrado: extracción al corte + transporte a la nube + staging + "modo migración" + consola | 2 coders en paralelo + 1 reviewer | ⬜ |
| **F10-E2** | ETL bloque A: usuarios + catálogos + modelos/BOM + pedidos + órdenes + calibrador de folios | 1 coder + 1 reviewer | ⬜ |
| **F10-E3** | ETL bloque B: producción M/A + kardex PT + telas + OC/notas + EsMa + costos + RC/CC | 2 coders en paralelo + 1 reviewer | ⬜ |
| **F10-E4** | Archivo histórico de solo lectura + frontera de 10 años por grafo | 1 coder + 1 reviewer | ⬜ |
| **F10-E5** | Saldos iniciales como AJUSTE de kardex + reporte de cuadre v1 vs v2 | 2 coders en paralelo + 1 reviewer | ⬜ |
| **F10-E6** | Capa de seguridad de usuarios + fotos a R2 + tablero de go-live | 2 coders en paralelo + 1 reviewer | ⬜ |
| **F10-E7** | Prueba reina + ensayo del corte + capacitación + **paralelo 2–4 semanas con cuadre diario** + corte final y go-live | 1 coder + 1 reviewer; Gabriel opera el cuadre; Daniel valida | ⬜ |

> **Nota F10:** aquí también se monta el **ambiente de producción en Railway** (hoy solo existe el de prueba, por costo) y el **modo mantenimiento** para congelar capturas durante el corte. *(Era F9; renumerada el 4-jul-2026, D13.)*
>
> ⚠️ **Paso obligatorio al CERRAR la carga (F10-E3/E5, y en toda re-corrida de ETL):**
> `npx tsx --env-file=.env migracion/realinear-estado-ordenes.ts`. El ETL escribe el `estado` de la
> orden **explícito de Access** (`crearOrdenMigrada`, fiel a la fuente y sin recalcular), pero desde
> el 26-jul-2026 ese estado es **automático** (tallas + avíos, y arte si aplica) y "Órdenes
> incompletas" filtra por el estado guardado: sin este paso el semáforo queda desalineado y el
> backlog del arte que pidió Daniel queda invisible. El script es idempotente, va por lotes, reusa la
> regla del dominio y **nunca degrada órdenes con producción viva**. Detalle en
> `backend/migracion/README.md`.

---

## 4. Piezas que el plan §6 no asignaba a ninguna fase (ya asignadas — auditoría 12-jun-2026)


> 🔴 **La suite de backend tarda 25 min, y eso es deuda (25-ago-2026).** El `timeout-minutes` del job
> se subió de 30 a **45** porque la corrida sana ya rozaba el techo y los runners degradados la
> mataban — **y es la SEGUNDA vez** (el 6-ago se subió de 20 a 30 por lo mismo). Subir el techo **no
> hace la suite más rápida**: sólo compra tiempo. El sospechoso medido es el **arranque repetido de
> testcontainers** por archivo de integración. Mientras no se ataque, esto se repite cada tres
> semanas.
>
> ⚠️ Y lo que más costó no fue el tope, sino **cómo se ve**: al agotarse, GitHub marca el job como
> `cancelled` —idéntico a un push que pisa la corrida—. El 25-ago costó **tres ciclos y dos
> diagnósticos equivocados** antes de que alguien midiera la duración. **Ante un `cancelled` en
> `backend`, lo primero es mirar cuánto duró.**

- **🟡 ABIERTO POR V1-E8q — LA TERCERA PUERTA: el hilo de comentarios de la ORDEN pinta el id crudo.**
  `frontend/src/modulos/ordenes/PanelComentarios.tsx` hace `{comentario.idUsuario ?? 'Sistema'}` — o sea
  **exactamente el defecto que V1-E8q eliminó** en las dos pantallas del hilo de negociación, vivo en una
  tercera: en producción eso pinta un cuid de 25 caracteres (`cm3x9k2q…`) donde debería ir un nombre.
  Es la **misma familia** (`OrdenComentario` tampoco tiene FK al usuario — log inmutable — así que el
  nombre hay que **resolverlo en el servidor**) y de hecho V1-E8q citó a `OrdenComentario` como el patrón
  a copiar, sin notar que su pantalla arrastraba el mismo hueco.
  **La receta ya está escrita y probada:** `nombresDeAutores` (`dominio/desarrollo/negociacion.ts`)
  resuelve los nombres de un lote en UNA consulta, y `autorDeEvento` (`frontend/src/lib/formato.ts`) ya
  distingue los tres casos (Sistema / nombre / «Usuario dado de baja»). Falta portarlas a
  `agregarComentarioOrden`/`obtenerOrden` + su contrato y a esta pantalla.
  ⚠️ **Y al hacerlo, revisar el fixture**: la cicatriz de V1-E8q fue que un id con **forma de nombre**
  (`'daniel'`) enmascaró el defecto y la prueba pasó verde — el fixture debe tener **forma de cuid**.
  **Por qué NO se arregló en V1-E8q, con la razón explícita:** está **fuera del alcance** de la etapa
  (que era el hilo de la NEGOCIACIÓN, §Post-F9.141) y toca el contrato de `Orden`, que es superficie de
  otro módulo; meterlo habría mezclado dos módulos en un PR. **No es «menor»: es deuda con nombre.**

- **🟡 ABIERTO POR V1-E8p — LA GEMELA EN COLORES: el importador resucita colores absorbidos y los
  vuelve INFUSIONABLES.** V1-E8p arregló que `resolverOCrearDepartamento` reactivara un departamento
  apagado (deshacía la fusión en silencio). **`resolverOCrearColor`, en el mismo archivo
  (`dominio/pedidos/importacion-pdf.ts`), sigue haciéndolo** — es el mismo defecto en el hermano que
  esa etapa cita como referencia. 🔴 **Y ahí es PEOR, por dos vueltas de tuerca:** ese resolver
  **devuelve id y lo amarra a la matriz de la orden**, así que el color resucitado **vuelve a acumular
  referencias**; y `fusionarColores` **se niega a fusionar un origen en uso** (§Post-F9.129) ⇒ la
  siguiente OC no sólo deshace la fusión: **la deja irrepetible**, porque el color ya no se podrá
  volver a fusionar nunca.
  **Por qué NO se arregló en V1-E8p, con la razón de diseño explícita:** tocar ese resolver cambia el
  importador en un camino que **sí amarra datos a la orden** (el color entra en la matriz color×talla
  de la OP), a diferencia del de departamentos, que devuelve `void` y no amarra nada. Merece su propia
  medición y sus propias pruebas, no un hunk de arrastre en una etapa de departamentos.

- **🔴 ABIERTO POR V1-E8p (fusión de departamentos, §Post-F9.122a) — LA QUINTA PIEZA: la búsqueda por
  referencia sigue partida después de fusionar.** La fusión repunta las **cuatro** llaves foráneas del
  departamento (proyectos, listas de precios, cotizaciones, factores), pero el importador de OC guarda
  **además** el texto CRUDO de la División (`"2-HOMBRE"`) en `OrdenReferencia.valor` (D7), **indexado
  para búsqueda** (`@@index([idClienteCampo, valor])`). ⇒ Juntar «2-HOMBRE» en «Caballeros» unifica el
  trabajo **pero no la búsqueda**: quien busque órdenes por referencia sigue viendo dos mundos.
  **Decisión pendiente de Daniel, y por eso no se tocó:** reescribir un valor capturado de un documento
  del cliente es una decisión de negocio (el mismo criterio por el que `Cotizacion.nombreDepartamento`
  se deja congelado a propósito), no un efecto colateral de limpiar un catálogo. Los caminos son tres:
  (i) dejarlo como está y aceptar que la referencia es historia del papel, (ii) reescribir los valores
  del campo «División» de las órdenes afectadas junto con la fusión, o (iii) resolver la búsqueda por
  sinónimos, que es la pieza (b) —el importador que **aprende** que `"2-HOMBRE"` de C&A es «Caballeros»—
  aplicada también a la consulta. Detalle en `docs/hoja-de-ruta/V1-etapas.md` §V1-E8p.

- **⭐ ABIERTO POR V1-E8k (prendas incompletas, §Post-F9.136)** — cinco cabos que la etapa dejó a
  propósito, con su detalle en `docs/hoja-de-ruta/V1-etapas.md` §V1-E8k → *«Lo que queda ABIERTO»*:
  - 🟡 **Una incompleta de PRENDA YA TERMINADA se queda viva en TRÁNSITO para siempre** (envío
    `prendaTerminada`, V1-E4b): el recibo sólo devuelve primeras y segundas, y el maquilero ya no
    puede devolverlas. Es coherente con §Post-F9.61 y con la decisión A, pero ese saldo **sólo se
    limpia con un movimiento manual de PT**. Darle salida automática sería inventar una merma que
    Daniel no pidió.
  - 🟠 **PREGUNTA PARA DANIEL: ¿el KPI de calidad del maquilero debe mirar las incompletas?** Hoy
    NO: quien entrega 200 incompletas sigue con calidad perfecta (el indicador mira primeras vs.
    segundas). Puede ser lo correcto —no son un defecto de calidad, son piezas que faltaron— o justo
    lo que quiere medir. **No se decidió.**
  - 🔵 La conciliación EsMa muestra un renglón **0/0/0** cuando el recibo fue sólo de incompletas
    (hay recibo, no hay cargo). No genera falso descuadre; es ruido visual.
  - 🔵 **Choque de nombres:** el menú ya tiene *«Órdenes incompletas»* (F2-E4), otro concepto.
  - 🔵 Sesgo del acumulado: `incompletasDeMaquilero`, `recibosSemanalesPorMaquilero` y
    `aCargoSalida` se prueban con un solo recibo y una sola celda — el mismo sesgo que dejó viva la
    mutación que EXCEDE.

- **⬜ ABIERTO POR V1-E8l (0.049) — la tarjeta de MÓVIL de Modelos, medida y no arreglada.** Al mutar
  el arreglo de esa etapa se barrió el resto de la tarjeta y **dos mutantes sobrevivieron**: apagar
  `stockPt` (mutante M-F) o borrar `telaPrincipal` (M-G) del pintado móvil **deja la suite en 41/41
  verde**. La causa es la misma que la etapa acaba de aprender: las aserciones se acotan a
  `getByTestId('modelos-tabla')`, o sea a **escritorio**, y el móvil sólo se ejercita en la dirección
  negativa. **Razón de diseño de no arreglarlo en E8l:** la única cifra de DINERO de esa tarjeta es el
  costo, y ésa sí quedó cubierta en las dos direcciones; `stockPt` y `telaPrincipal` son cantidad y
  nombre —fuera del estado prohibido de la etapa— y el PR no toca una sola línea suya. Se anota para que
  **no se re-descubra**: `frontend/src/modulos/modelos/ModelosPagina.test.tsx`, la prueba *«pinta las
  columnas Tela principal, Stock PT y Costo…»*.

- **⭐⭐ DECISIONES DEL 29-ago-2026 (§Post-F9.138–.142) — QUEDA ESCRITO EL DISEÑO DE
  LA NEGOCIACIÓN DE PRECIOS.** Daniel cerró en una sola conversación **la mecánica de la mesa de
  negociación**, que §Post-F9.110 había dejado planteada y explícitamente pendiente. **Sólo
  documentación: no se tocó una línea de código, y por eso no sube la versión.** Van aquí, y no colgadas
  de una etapa, porque son **transversales** al módulo de Desarrollo/Cotización entero.

  **El porqué y el detalle viven en `Documentacion_MJD/DECISIONES.md` §Post-F9.138–.142** —con las citas
  textuales de Daniel—. *No se copian aquí a propósito: una copia deriva.* En una línea cada una:

  - **§Post-F9.138 · El negociador en vivo** — un renglón *"casi como si fuera un excel"* donde precio y
    margen se persiguen **en las dos direcciones**, y **ningún botón que saque de la pantalla** (única
    excepción concedida: los avíos).
  - **§Post-F9.139 · Los estimados ⭐ (la pieza que cambió el diseño)** — en la mesa se negocia con
    **números libres** y el simulador **NO CREA NADA** en el catálogo. Parte la negociación en **dos
    momentos**: negociar con estimados / cuadrar la realidad después. El porqué es medido: la misma
    cicatriz de §Post-F9.106 (el texto libre fragmentó las medidas de avío en `"53 cm"`/`"53cm"`/`"53"`
    y partió una orden de compra en tres).
  - ✅ **§Post-F9.140 · El filtro de después — CONSTRUIDA en `V1-E8r` (29-ago-2026).** Es la bandeja
    **«Recetas por revisar»** (`recetas-por-revisar.ts`), con la forma que Daniel ya aprobó en «Recetas
    por liberar» (*"está buenísima"*) y con su regla: **NO FIRMA, LLEVA** — la compuerta de V1-E7d no se
    duplicó. ⚠️ **Queda abierto su criterio de entrada:** *"sólo las que usaron estimados"* depende de
    §Post-F9.139, que no está construida, así que hoy la cola lista **todas las versiones** a las que la
    revisión les niega producción (lo que ya la mantiene corta: los modelos que se aceptan tal cual
    nunca generan una versión).
  - ✅ **§Post-F9.141 · Los comentarios — CONSTRUIDA en `V1-E8q` (29-ago-2026), y pedía MENOS de lo que
    creía.** Son **de la negociación**, no del modelo (*"es en esta negociacion"*), y van **en hilo
    inmutable**. 🔴 **Al medir, el hilo YA EXISTÍA**: `NegociacionEvento` (F8-E1, operado desde F8-E5)
    cuelga del renglón de la lista, es inmutable, y guarda texto + autor + fecha + el cambio de precio
    cuando lo hay. **Lo único que faltaba era el AUTOR en pantalla** (se leía el qué y el cuándo, nunca
    el quién) — eso construyó V1-E8q. ⚠️ `Desarrollo.notas` (campo suelto que se sobreescribe) **no** es
    la forma que se quiere, y se confirmó que no se usó.
  - ✅ **§Post-F9.142 · El candado de la firma — NO ES TRABAJO, es registro.** Daniel describió, sin ver
    el código, **la regla que el sistema YA tiene**: no se compran los avíos sin firmar, pero la tela
    firmada sí se compra. Eso es exactamente `exigirRecetaLiberada` + `exigirMaterialesLiberados`
    (`produccion/receta-orden.ts`), construidas en V1-E3d/V1-E3h ⇒ **§Post-F9.72 acertó**, validado por
    el dueño del negocio. 🔴 **Corrige de paso una regla mal dicha ese día:** el candado **también**
    gatea al **explotar** (`explosionarUna`, `compras/mrp.ts`) cuando no hay **nada** firmado — la regla real es *«sin nada
    firmado no hay nada que comprar»*, no *«sólo al generar la OC»*. Lo que nunca se frena es el piso
    (cortar, enviar, recibir, entregar). **Sin migración, sin permisos, sin pendientes.**

  ⏳ **De las cuatro que SÍ son trabajo (.138–.141), YA quedaron CONSTRUIDAS `.141` (`V1-E8q`, 29-ago) y
  `.140` (`V1-E8r`, 29-ago); siguen pendientes `.138` y `.139` — pero NO se parte de cero, y el detalle
  importa**
  (medido contra el código el 29-ago, está en cada decisión):

  - ✅ **La calculadora de margen YA EXISTE** (`simularNegociacion`, `desarrollo/negociacion.ts`): la
    dirección *precio → margen* está resuelta, con los factores y su candado. 🔴 **Falta la otra
    dirección** (*mover un costo → mover el margen*): hoy el costo sólo puede venir del vigente o de un
    precosto **congelado**, así que **no se le pueden pasar costos movidos a mano**. Ése es el trabajo,
    no la fórmula.
  - ✅ **§Post-F9.140 YA ESTÁ CONSTRUIDA (`V1-E8r`, 29-ago).** La **compuerta** era de `V1-E7d` y no se
    volvió a construir; lo que faltaba —**la bandeja**— es hoy `consultarRecetasPorRevisar`
    (`modelos/recetas-por-revisar.ts`) + la pantalla «Recetas por revisar». ⚠️ **Con un pendiente
    explícito:** su criterio de entrada *"sólo las negociadas CON ESTIMADOS"* **espera a §Post-F9.139**
    (ese dato no existe todavía); mientras tanto la cola lista **todas las versiones** que el muro
    frena, que ya la mantiene corta.
  - 🔴 **Lo verdaderamente nuevo son los ESTIMADOS** (§Post-F9.139): necesitan **su propia forma de
    guardarse** dentro de la versión del precosto (hoy `PrecostoLinea` cuelga de
    tela/avío/`ConceptoCosto`). Hay que resolverlo **antes de codear**.
  - ✅ **§Post-F9.141 NO lleva migración — y ya está construida (`V1-E8q`).** Lo que decía esta línea
    («migración aditiva, tabla de comentarios») era **falso**: la tabla `NegociacionEvento` existe desde
    F8-E1. Se redactó desde el pedido, sin medir el código. Lo real era una columna «Quién» y resolver
    el nombre del autor en el servidor (no hay FK física al usuario). **Sin migración, sin permisos.**

- **⭐ DECISIONES DEL 28-ago-2026 SIN ETAPA ASIGNADA (§Post-F9.132–.137).** Daniel las cerró todas en
  una jornada y **el porqué quedó guardado en `DECISIONES.md`; el "qué sigue" es esto.** Van aquí para
  que **no se pierdan en el go-live**, que es exactamente donde dos de ellas muerden.

  ⚠️ **ESTADO AL 28-ago-2026, ya avanzada la jornada: TRES de las seis quedaron CONSTRUIDAS** y en
  `prueba` el mismo día (.134 en la 0.047, .136 en la 0.048, .137 en la 0.049). **Este encabezado decía
  "ninguna está construida" y se quedó viejo en horas** — cada renglón de abajo lleva ahora su propio
  estado. Lo que sigue pendiente es **.133 (ETL de packs)** y **.135 (1:N)**.

  - **🔴 El ETL de Access tiene que JUNTAR LOS PACKS** (§Post-F9.133) — `Negro A` + `Negro B` = un solo
    `Negro`, en el ETL y en la captura manual de OP. **Prerrequisito: el censo de nombres del volcado**
    (`Respaldo CLAUDE/TABLAS/`, CP850). **Es requisito del ARRANQUE, no una mejora** — y va junto con la
    segunda mitad de §Post-F9.10 (el pack como campo propio).
  - ✅ **El modelo siempre nace en desarrollo** (§Post-F9.134) — **CONSTRUIDA en V1-E8j (0.047).** Era:
    retirar el alta directa de modelo de
    producción y mover el default del filtro de origen a `todos` **en los CUATRO sitios donde vive**
    (dominio, contrato, `ModelosPagina.tsx`, `GaleriaModelos.tsx`); el frontend manda el valor
    explícito, así que tocar sólo el backend no cambia nada.
  - **🔴 De un modelo de desarrollo nacen VARIOS de producción (1:N), con UNA sola receta**
    (§Post-F9.135) — **alcance grande**: toca la promoción «pasar a producción», el linaje de versiones,
    el generador de nomenclatura y la receta. Incluye la corrección en bloque de las órdenes que
    dependen del modelo (aplicar donde se puede, **saltar y reportar** donde no, bitácora por orden).
    ⭐ **YA ESTÁ DISEÑADO, y el plan está escrito** (V1-E8n, 28-ago-2026, **0.051** — etapa de sólo
    documentación: **no tocó una línea de código**). El plan completo —lo que se midió contra el
    código, la columna nueva `Modelo.idModeloDesarrollo`, la **receta compartida por referencia** con
    sus alternativas descartadas, la acción en bloque con transacción **por orden**, el troceado
    E1–E5 y las **10 preguntas con su default**— vive en **`Documentacion_MJD/DECISIONES.md`
    §Post-F9.135, sección «⭐ EL PLAN»**. *No se copia aquí a propósito: una copia deriva.*
    ⏳ **Bloqueado hasta que Daniel conteste las 10 preguntas** (agendadas en §6). De lo medido, dos
    cosas que conviene saber sin abrir el plan: **cero permisos nuevos** ⇒ ninguna etapa pedirá
    `SEED_ON_START`, y **una sola migración** (aditiva, en E1).
  - ✅ **Prendas incompletas en el recibo de maquila** (§Post-F9.136) — **CONSTRUIDA en V1-E8k (0.048)**,
    con su migración aditiva (`EtapaMovimientoDet.cantidadIncompletas`, **fuera** de `cantidad`, para que
    no se paguen ni se inventaríen) y su reflejo en el estado de cuenta del maquilero. ⬜ Deja **cinco
    cabos abiertos**, listados arriba en esta misma sección. ⏳ **Falta la palabra de Daniel** en dos
    preguntas suyas: si las incompletas deben pesar en el **KPI de calidad** del maquilero (hoy NO) y qué
    hacer con el **saldo de tránsito** que dejan.
  - ✅ **Esconderle el costo real del listado de modelos a Gerencial** (§Post-F9.137) — **CONSTRUIDA en
    V1-E8l (0.049).** ⚠️ Este renglón anunciaba **`SEED_ON_START=true`** y que *"el mismo permiso
    gobierna los importes de Costos y Márgenes"*: **las dos cosas resultaron falsas al medir.** Quitarle
    `consultas.ver-importes` a Gerencial le habría apagado **el precosteo entero** (`pre-costo.ts`
    nulifica todos sus importes con ese permiso), así que **no se movió ningún reparto**: el candado se
    colgó de `costos.ver`, que Gerencial ya no tenía. **Sin migración, sin permiso nuevo, sin
    `SEED_ON_START`.** El detalle en `DECISIONES.md` §Post-F9.137.
  - ⚖️ **Y la que NO cuesta código:** *lo viejo no se repara* (§Post-F9.132). No es una tarea: es lo que
    **mueve todas las de arriba al ETL del arranque** — y es **un permiso con fecha**, que caduca el día
    que lo capturado en `prueba` deje de ser práctica.

- **🔴 DEUDA NUEVA (26-ago-2026, V1-E7d) — «la TERCERA puerta»: se puede crear una OP sin promover el
  modelo, saltándose la compuerta de revisión.** `POST /api/ordenes` → `crearOrden` crea la orden de
  producción **sin pasar por `promoverAProduccionNucleo`**, así que **nunca toca la compuerta** de
  §Post-F9.34 (`resolverOrigenPedido` valida `modelo.activo`, jamás `origen`). Es decir: **son TRES los
  caminos que llegan a una OP, no dos** — V1-E7d cubrió los dos que promueven.
  **Por qué no se cerró ahí:** no tiene **ni un llamador en el frontend**, y los dos importadores de
  pedido (Excel y PDF C&A) reusan `salidaAProduccion` ⇒ ésos sí pasan por la compuerta. Es un hueco
  **sólo por API**, **pre-existente** (viene de F2), y cerrarlo es tocar un módulo ajeno sin revisión.
  ⚖️ **Queda escrito con nombre** porque la frase cómoda —*"las dos puertas"*— es de las que engañan a
  quien la lee después: **quien vaya a cerrar §Post-F9.34 tiene que saber que hay una tercera.** Detalle
  en `docs/hoja-de-ruta/V1-etapas.md` §V1-E7d.

- **⚠️ DEUDA NUEVA (17-ago-2026) — `singletonKey` NO serializa nada, y la Ruta Crítica cree que sí.**
  Salió de la revisión de V1-E6a, **verificado ejecutando** contra pg-boss real: dos `send` con el
  mismo `singletonKey` fueron **ambos aceptados**. La razón está en `node_modules/pg-boss/dist/plans.js:567-590`
  — los índices únicos sobre `(name, singleton_key)` sólo existen para colas con política
  `short`/`singleton`/`stately`/`exclusive`/`key_strict_fifo`, y `comun/jobs/index.ts` crea **todas**
  las colas **sin política** (→ `standard`), donde la clave **se guarda pero no restringe nada**.
  ⚠️ **A quién le importa:** `encolarJob` (F5-E3, ADR-0012) usa `singletonKey: claveSerializacion(cola, idRecurso)`
  para **serializar el recálculo del CPM por orden**, y su comentario afirma que *"pg-boss garantiza
  que, para un `singletonKey` dado, a lo sumo UN job está en `created`/`active`"*. **Eso no se cumple
  hoy**: varios eventos seguidos sobre la misma orden encolarían jobs duplicados en vez de colapsar en
  uno, y podrían recalcular la misma ruta **en paralelo**.
  **No muerde en la v1** porque la Ruta Crítica está apagada (§Post-F9.36 punto 1) — por eso es deuda y
  no bloqueante. **Arreglo:** política `stately`/`exclusive` al crear esas colas, con su prueba; y de
  paso **corregir el comentario**, que es la parte peligrosa (alguien se apoya en él). En V1-E6a la
  opción se **retiró** en vez de fingirla, con el porqué escrito en el código.

- **⚠️ RIESGO DECLARADO — 8 pruebas de la defensa anti-duplicado fallaron UNA vez en la suite completa,
  y la causa NO se identificó (V1-E4, 16-ago-2026).** En una corrida de los 133 archivos de
  integración, `importacion-pdf.int.test.ts` e `importacion.int.test.ts` dieron **8 rojas** con una
  firma inequívoca: **fallaban todas las que exigen BLOQUEAR y pasaban todas las que exigen dejar
  pasar** (`cargarOcYaImportadas` devolviendo vacío). **No es reproducible.** Se descartaron
  **ejecutando** las tres hipótesis con nombre: secuencia no reiniciada (se sembró
  `numero_produccion_seq` en 65 con el `contexto.ts` original → 34/34 verde), crash aguas arriba
  (62/62 verde), y locale del cluster (34/34 verde); y los 133 archivos se cubrieron por bloques sobre
  bases compartidas, todo verde. Se arregló **un defecto de aislamiento REAL** —`TRUNCATE … RESTART
  IDENTITY` no reinicia las secuencias independientes, y `numero_produccion_seq` sobrevivía la corrida
  entera— pero el reviewer **probó que NO es la causa** de los 8. **Queda como riesgo, no como
  resuelto.** Reproducción a vigilar: una corrida única de los 133 archivos. ⚠️ La verificación local
  fue **PG16 nativo**; el **CI usa postgres:17** y es el único juez. Si vuelve a aparecer, ya está la
  firma exacta identificada.

- **⚠️ Deuda técnica ACTIVA — el typecheck del backend está al filo de la memoria del runner
  (16-ago-2026).** `tsc --noEmit` murió en CI con **OOM (exit 134)** y se destrabó subiéndole el heap
  a 6 GB en `.github/workflows/ci.yml`, **la misma venda que el lint ya llevaba desde el 6-ago** — en
  su momento se le puso solo al lint y la cicatriz se repitió un paso más abajo. **Medido, no
  supuesto** (`tsc --extendedDiagnostics`): `prueba` pedía **5.22 GB** y la rama que reventó **5.28 GB
  (+1 %)**, o sea que **ninguna etapa concreta lo causó** — son 2,614 archivos, **3.5 M de tipos** y
  **19.7 M de instanciaciones** (Prisma + Zod generan tipos enormes) creciendo poco a poco.
  ⚠️ **Subir el número otra vez NO es la cura:** cada etapa suma tipos y el techo del runner no se
  mueve. Cuando 6 GB no alcancen hay que **atacar la causa** — proyectos de TS separados,
  `--build` incremental, o adelgazar los tipos generados. **El siguiente en caer será el typecheck
  del frontend** (`tsc -b`), que hoy pasa pero va por el mismo camino.

- **Módulo 12 · Documental:** los **adjuntos por orden (R6)** → ✅ **hechos en F8-E6b** (tabla `orden_archivo`; subir/listar/descargar/eliminar con **borrado físico R2**; la Orden es su ancla; el motor R2 existe desde F0). Las **fichas técnicas estructuradas (R5)** → **F6** (la auditoría AQL las consume como referencia) — siguen pendientes aparte, NO son lo mismo que los adjuntos. Confirmar al arrancar.
- **Módulo 13 · Administración (lo que faltaba):** pantallas de usuarios/empresas → **F1-E1** (ya en la ficha) · consulta de bitácora → **F6-E1** (ya en la ficha) · configuración por empresa (ex-`Propiedades`) → **F1** (confirmar al arrancar) · **modo mantenimiento** → **F10**.
- **Respaldo doble** (job pg-boss con `pg_dump` diario cifrado a R2, §2.2 del plan): etapa chica al **inicio de F1**, en cuanto Gabriel monte R2. Es la mitigación #1 de la tabla de riesgos y hoy nadie la tiene.
- **Impreso "Lista de precios"** (R9): ✅ RESUELTO — la lista **por modelo** (precios sugeridos) quedó con su impreso en **F7-E1**; la lista **por cliente** (con factores, aprobación y negociación) ✅ **hecha en F8-E4** (PDF + Excel; D13).
- **Administración de Roles y permisos:** ✅ **hecha (2026-07-06)** — pieza huérfana diferida en **F1-E1** (nació solo-lectura para el selector de rol; la administración fina no tenía fase). Se expusieron las rutas de mutación (crear/editar/asignar-permisos/eliminar) + `GET /permisos` sobre el dominio que ya existía, con **guard anti-lockout a nivel usuario** (bajo `pg_advisory_xact_lock` de clave constante: no se puede dejar al sistema sin ningún usuario activo que pueda administrar roles), y la pantalla en Administración (árbol de permisos por módulo). Rama `tarea/admin-roles-permisos`. SIN migración/seed/permiso nuevo.
- **~~Deuda técnica — el COMPLEMENTO de la tela no se concilia contra la OC al recibir~~ ✅ SALDADA el mismo día (§Post-F9.19):** Daniel dictó el criterio que faltaba (*"se debe de marcar como recibido si se recibe lo mismo que está en la OC; si en la OC lleva cardigan, se debe de recibir el cardigan"*) y con eso se cerró: el estatus de la OC, el `porRecibir` del tablero y los pendientes de la captura miran ahora **cuerpo Y complemento**, con **banda del 5% en tela** (*"nunca se recibe la cantidad exacta"*). NO hizo falta migración: `RecepcionCompraLinea.cantidadComplemento` ya existía desde B1 y la entrada ya lo escribía — faltaba **mirarlo**. Queda para segunda etapa, por decisión de Daniel, **autorizar** las diferencias mayores al 5% (hoy simplemente no cierran la orden). Texto original de la deuda, para rastro: ~~ ahora la OC dice cuánto Cardigan se compra (`OrdenCompraLinea.cantidadComplemento`) y la entrada dice cuánto llegó (`EntradaTelaLinea.cantidadComplemento`), pero **las dos cifras no se cruzan**: `RecepcionCompraLinea.cantidadRecibida` guarda solo el CUERPO, así que ni el estatus de la OC (`recibida_parcial`/`recibida_total`) ni el `porRecibir` del resumen toman en cuenta el complemento — una OC cuyo cuerpo llegó completo pasa a `recibida_total` aunque falte Cardigan. **Razón de diseño para no cerrarlo hoy:** el arreglo honesto exige una columna nueva de complemento recibido en la recepción **y** decidir qué significa "recibida total" cuando cuerpo y complemento van a distinto ritmo — una regla de negocio que Daniel no ha dictado; inventarla ahora sería peor que dejar el hueco visible. Lo que NO pasa: no se pierde información (ambas cantidades están guardadas y auditadas) ni se duplica inventario (el kardex del complemento ya entra por la entrada, D3)."~~
- **Deuda técnica — anti-lockout en el dominio de USUARIOS (descubierta 2026-07-06):** el guard anti-lockout se cerró para **roles** (`asignarPermisos`/`eliminarRol`), pero `backend/src/dominio/admin/usuarios.ts` (`desactivarUsuario` / `asignarRoles`) **NO** tiene guard análogo: desactivar al último usuario administrador, o quitarle sus roles, puede provocar el mismo lockout del RBAC por la otra puerta. Fix futuro: aplicar la MISMA invariante ("≥1 usuario activo con `roles.administrar`") bajo el mismo `pg_advisory_xact_lock` de clave constante. Sin fase asignada — retomar cuando se priorice.
- **Deuda técnica — borrado físico en R2 (PARCIALMENTE saldada en F8-E6b):** el motor `backend/src/comun/archivos.ts` **ya tiene `eliminarObjeto` (`DeleteObjectCommand`)** desde F8-E6b, y los **adjuntos de orden (R6)** ya borran el objeto R2 **tras el commit** y **best-effort**. Falta **cablearlo** en los otros 3 módulos que suben archivos (**modelos, bordados, proveedores**) — hoy siguen dejando el objeto **huérfano en R2** al borrar el registro. Fix pendiente: reusar el mismo `eliminarObjeto` best-effort tras el commit en esos 3 borrados. Sin fase asignada — retomar cuando se priorice.
- **Fix RBAC (pentest 2026-07-07):** `rc.catalogo-administrar` estaba **cascadeando a roles clericales** (Asistente/Secretarial/Logística/Ventas/Gerencial/Directivo) porque el `sin(todos, ...)` del rol base `directivo` en `backend/prisma/seed.ts` **omitía restarlo** (a diferencia del resto de `*.administrar` de catálogos maestros) → un Asistente podía `DELETE` procesos/plantillas de la Ruta Crítica. Ahora se resta en `directivo` como los demás catálogos: queda **restringido a Administrador/AdministracionDireccion**. Requiere `SEED_ON_START=true` al desplegar para re-sembrar los permisos de rol.
- **Mejora futura — precio propuesto en el renglón del pedido (F8-E6, decisión de Gabriel 6-jul-2026):** al ligar un desarrollo a su orden, hoy el precio acordado se **muestra** editable pero **NO se pre-llena** en `PedidoLinea.precio` (la orden cuelga de un renglón de pedido ya capturado en F2, así que escribirlo hacia atrás sería raro y cruzaría el dominio de Pedidos). Mejora opcional: en la **captura del pedido (F2)**, si el modelo tiene un desarrollo con precio aprobado, proponerlo como default editable del renglón. Requiere tocar el dominio de Pedidos de F2. Sin fase asignada.
- **Pregunta de negocio — precio en el impreso PDF del recibo de maquila (descubierta en R2 del rediseño, 7-jul-2026):** R2 gateó TODOS los montos de precios reales en el API tras `ordenes.ver-precio-real-maquila` (orden `maquilaOrd`/`aplicacionOrd`, `EtapaSalida.precioPactado`, respuesta de cancelación de recibos; quien captura sí ve lo que tecleó). PERO el impreso `GET /produccion/recibos/:id/impreso` (gated solo `produccion.wip-ver`) IMPRIME "Precio pactado" (`impreso-recibo-maquila.ts:332`). Se ACEPTÓ con razón de diseño explícita: es el documento operativo que se entrega al maquilero (que conoce su propio precio; es la base de conciliación EsMa) y redactarlo o re-gatear el endpoint sin input de negocio rompería la operación real. Pregunta para Daniel/Gabriel: ¿el impreso debe exigir el permiso de precios, imprimirse sin precio, o quedarse así? Sin fase asignada.
- **Pulido transversal — mostrar NOMBRE de usuario en vez del id crudo (nota del reviewer F8-E6b):** varias vistas pintan "por {id}" (adjuntos de orden y de proveedor, acuerdos de negociación, algunas bitácoras) porque el endpoint devuelve `subidoPorId`/`registradoPorId` (el id), no el nombre. Fix **global**: que esos endpoints resuelvan y devuelvan el nombre del usuario (join a `Usuario`). Cosmético; se dejó **consistente a propósito** (no se arregló solo en E6 para no crear inconsistencia con las vistas viejas). Sin fase asignada.
- **Huecos de backend detectados en R9 (rediseño, Lote 1 — Inventarios/Compras, 8-jul-2026):** pantallas frontend-only donde el proto pide datos que el endpoint NO da; el re-vestido los OMITE sin inventarlos (A1) y quedan como endpoints de resumen a futuro si Daniel los quiere: (a) **Inventario PT** sin `comprometido`/`disponible` (ni barra "Nivel") — "comprometido" tiene definición de negocio a confirmar con Daniel; (b) **catálogos de Telas/Avíos** sin `valor de inventario`/`costo por lote`/umbral de `mínimos`, y el conteo de proveedores / badge "Por medida" no viajan inline (se ven al expandir); (c) **lista de OC** sin `recibido` por-OC (barra de avance de recepción por renglón) ni agregados de cabecera (OC abiertas / $ por recibir / recibido-a-tiempo %). Sin fase asignada.
- **Huecos de backend detectados en R9 (rediseño, Lote 2 — Catálogos/Comercial/Admin, 8-jul-2026):** pantallas frontend-only donde el proto pide datos que el endpoint NO da; omitidos sin inventarlos (A1): (a) **Proveedores** sin **saldo CxP** (Al corriente / Saldo vencido) → placeholder "llega con Finanzas F9"; (b) **Usuarios** sin `Nivel` (v2 no usa niveles en cascada), `Módulos con acceso` (se derivan de permisos) ni `Último acceso` (no se registra) — columnas omitidas; (c) **Clientes**: columnas de factores/departamentos/proyectos no viajan en la lista → se ven dentro del cajón por su propio endpoint; (d) **Modelos**: tela principal / colores (swatches) / stock PT / costo / matriz color×talla de existencias no vienen en el payload de lista (viven en BOM/inventario/costeo) → se ven en el cajón/otros módulos, y "Exportar" sin endpoint. Sin fase asignada.
- **Huecos de backend detectados en R9 (rediseño, Lote 3 — Producción/WIP + Calidad, 9-jul-2026):** (a) **Tablero WIP** — las piezas por etapa (Por cortar/En maquila/En estampado/Por recibir) como KPIs agregados no las da `/produccion/wip` (es por-orden; el agregado por etapa vive en Indicadores, `indicadores.ver`) → se muestran los KPIs de órdenes disponibles. (b) **Consulta de Calidad** — "Defecto principal" (frecuencia de defectos) y columna "AQL" escalar por auditoría: sin endpoint → omitidos. **Auditores y Ventas** quedaron como `proximamente` en el Lote 3 → **reclasificados al lote "Backend 100%" (ver abajo)** por la directiva de Gabriel del 9-jul.
- **Huecos de backend detectados en R9 (rediseño, Lote 4 — Análisis: Resumen/Costos/EDR/Indicadores, 9-jul-2026):** frontend-only, omitidos sin inventar (A1): (a) **Resumen** sin "cortes por semana" (no hay serie temporal de cortes para un tablero genérico); (b) **Costos** sin los 4 KPIs de portada del proto (costo prom. modelo / margen bruto prom. / ventas del mes / utilidad bruta — `/costos/lista` es listado paginado; el margen promedio ponderado sería pivote en cliente → REHUSADO en `MargenesPagina`); (c) **Indicadores** sin las gráficas del proto (barras cortes/semana, dona de mezcla, barras de eficiencia por maquilero, cumplimiento 6 meses) ni KPIs de planta (Productividad pzas/día, Merma de tela %) — los endpoints F7 dan tablas agregadas, no series ni esos escalares; (d) **EDR por mes** deriva `utilidadBruta = ventas − costo` en cliente (PRE-EXISTENTE, resta de 2 escalares del servidor, no pivote) → conviene exponer `edr.utilidadBruta` a nivel mes. Todos → lote "Backend 100%".
- **R9 · Lote "Backend 100%" (directiva de Gabriel 9-jul-2026: "quiero que quede todo al 100%, no que difieras cosas porque luego nunca se hace"):** los huecos NO-F9 detectados en los Lotes 1–4 dejan de ser "sin fase asignada" y se **construyen** en un lote dedicado ANTES del barrido final. Alcance: (1) **Auditores** ✅ **HECHO (9-jul, rama `tarea/rediseno-r9-auditores`, reviewer APROBÓ):** catálogo propio `Auditor` (modelo Prisma + migración `20260709120000_r9_auditores` + dominio CRUD con borrado suave + pantalla `TablaCatalogo`), fiel al proto (Rol · Nivel AQL · # auditorías derivado por match de nombre sobre `Auditoria.auditorPorId`, filtrando canceladas); Daniel decide si "auditor" es entidad o bandera al revisarlo en `prueba`. **REÚSA `calidad.ver`/`calidad.administrar-catalogo` → SIN permiso nuevo → NO requiere `SEED_ON_START`** (solo migración auto-aplicada). (2) **Ventas** → **RECLASIFICADA a F9**: la vista `vVentas` del proto es facturación/importe de venta = F9; queda como placeholder "llega con Finanzas (F9)", NO se construye (aplicando la regla de Gabriel "lo que tenga que ver con F9 no lo hagas"). (3) **KPIs no-F9** ✅ **HECHO (9-jul, rama `tarea/rediseno-r9-kpis`, reviewer APROBÓ):** agregados EN SERVIDOR (A1), todos reúsan permisos de vista → sin permiso/migración/seed. **Compras** `GET /ordenes-compra/resumen` (OC abiertas + $ por recibir); **Calidad** `GET /calidad/auditorias/resumen` (defecto principal + AQL por auditoría, canceladas excluidas); **Producción WIP** `totales` de piezas por etapa en `/produccion/wip` (quitó el KPI placeholder "Con pendientes", metió las 4 etapas reales); **EDR** `utilidadBruta` a nivel mes. **Desviación deliberada vs proto (NO se inventó dato):** el WIP no distingue "en maquila/en estampado" en el total agregado (ese split por `TipoProceso` vive en el drill-down de la orden) → se usaron las 4 etapas honestas del pipeline (Por cortar/enviar/recibir/entregar), idénticas a las columnas de la tabla. **BLOQUEADOS esperando definición de negocio de Daniel/Gabriel — preguntas enviadas 9-jul (NO se inventan):** inventario PT `comprometido`/`disponible` (regla de qué cuenta como comprometido), `valor` (requiere costo de PT/telas/avíos — telas/avíos SÍ tienen costo, PT lo dejó en NULL F3 por D1/D2), y stock `mínimo`/barra de "Nivel". Se construyen en el Lote 5 si Daniel define. **Queda F9 (NO se toca aquí):** saldo CxP de proveedores, importe de venta/facturación/CFDI, CxC/CxP, Ventas.

- **Rediseño de los diálogos de "Agregar" ✅ COMPLETO (11-jul-2026, PRs #137/#138/pasada de calidad; pedido de Gabriel "MUY IMPORTANTE — que quede impresionante"):** auditoría de las ~26 altas del sistema (spec del auditor) + 2 lotes + pasada de calidad final foto-por-foto. Lo que estrena: **la convención de obligatorios** (`FieldLabel required` → asterisco + sr-only + `LeyendaObligatorios` — NO existía en ningún diálogo), ejemplos reales del dominio en cada campo, hints de negocio (patrón del RFC), secciones tituladas en los forms largos, footer fijo con primaria full-width en móvil, `AvisoAlta` de "qué sigue en el detalle", autofocus en las 26 (ComboboxBuscable ganó prop `autoFocus` opt-in para el constructor de pedido), RFC en mayúsculas al teclear, botón primario específico en todas. **Nuevo Cliente completo** (secciones Identidad/Contacto/Fiscal y crédito + campo NUEVO `Cliente.razonSocial` — única migración, espejo de Proveedor/Empresa). Convención RATIFICADA por reviewers (desviación consciente de la spec): solo asterisco + leyenda, SIN rotular "(opcional)" por campo. Regla de oro en los 3 PRs: asterisco↔Zod del form en ambos sentidos; NINGÚN contrato endurecido; cero obligatorios nuevos "por criterio" (si Daniel quiere RFC obligatorio, es decisión suya pendiente). Galería completa de los 26 diálogos en el scratchpad de la sesión (11-jul).
- **Code review general con Fable 5 (11-jul-2026, cierre de la corrida autónoma):** 6 revisores independientes barrieron TODO el código (dominio completo, api/comun/auth, seeds/ETL/migraciones, frontend, e2e, infra). **Corregido en el mismo lote:** 1 BLOQUEANTE (endpoints de RC por orden sin scope de empresa — A9, mutación cross-tenant; el impreso lo compensaba localmente y los endpoints no) + 4 DEBEs (cancelar envío con recibos vivos quedaba permitido y dejaba PT/EsMa huérfanos; el reporte fiscal contaba los inversos de cancelación como "sin CFDI" fantasma; el export del tablero WIP topaba silencioso en 100; las pantallas de captura tragaban errores de catálogo y Corte listaba TODOS los proveedores en una ventana de carga) + ~12 piezas de código muerto (módulo `comun/eventos.ts` in-process entero con un SELECT desperdiciado por operación, 19 hooks de API sin consumidor, rama muerta de Administración, duplicados de `redondear2`/`semanaIso`, migración de limpieza de los 6 permisos huérfanos `cortadores.*`/`maquileros.*`). **Notas DOCUMENTADAS con razón (no son defectos activos):** (a) ⚠️ **ANTES de reactivar una 2ª empresa (rescate de historia con Daniel / F10): falta membresía usuario↔empresa** — `resolverEmpresaActiva` acepta cualquier empresa activa por header; hoy inofensivo (solo FR Moda activa), sería salto de tenant con 2+; (b) el relay del outbox puede encolar 2× la misma fila (barrido vs disparo concurrentes) — inocuo con consumidores idempotentes; endurecer con SKIP LOCKED al tocar el relay; (c) EDR redondea 2× el costo por línea (coherente con lo mostrado en pantalla; VIGILAR en el cuadre contra las hojas de Daniel); (d) tablero de productividad cuenta NULL como 0 en el agregado pero lo excluye en el detalle (borde de datos mal capturados); (e) movimientos/traspasos manuales de PT operan solo el bucket "sin orden" por diseño — confirmar con Daniel que el PT por-orden nunca necesita traspaso manual; (f) `exigirSesion` duplicado en 80 archivos de rutas — limpieza diferida por churn (riesgo>beneficio en este lote); (g) fronteras del aging duplicadas JS(tests)/SQL(prod) — un cambio de rangos en SQL no lo cazan los tests de `cubetaPorAtraso`; (h) el tablero de saldos EsMa suma en float8 (drift de 1 centavo vs el estado de cuenta, pre-existente de F6).
- **Móvil — auditoría completa + 3 olas de fixes ✅ (11-jul-2026, PRs #131/#132/ola 3):** research de las 117 rutas a 390×844 (pedido de Gabriel: "con tanto cambio se descuidó el teléfono"): CERO overflow-x del body en todo el sistema; 3 pantallas ROTAS (headers que encimaban botones sobre el título), 4 "SIN SENTIDO" (la métrica que da nombre a la pantalla quedaba fuera de cuadro) y ~22 apachurradas — todas arregladas en 3 olas. **Patrones ESTÁNDAR que las páginas nuevas deben seguir:** (1) header responsivo `flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center` (43 páginas); (2) tabla de escritorio intacta `hidden lg:block` + **tarjetas móviles** `lg:hidden` con testids `-tarjeta` propios, mismos datos/handlers sin duplicar lógica (Centro de Órdenes + 11 consultas + 8 análisis/admin; `TablaCatalogo` trae slot opt-in `renderTarjeta`); (3) pivotes pesados = scroll-x CONTENIDO + primera columna sticky (`sticky left-0 … lg:left-auto` — head y cuerpo SIMÉTRICOS); (4) en móvil la métrica del nombre de la pantalla se ve SIN scroll lateral. ⚠️ Trampa e2e: hay 4 specs con viewport MÓVIL (galeria-modelos, analisis-rc, concentrado, Mis pendientes) — todo cambio `hidden lg:block` se cruza contra `grep -i viewport frontend/e2e/`. Fotos antes/después + mediciones en el scratchpad de la sesión del 11-jul. **Ola 4 (auditoría INTERACTIVA de flujos + fixes, 11-jul):** hallazgo de Gabriel en su teléfono real — las páginas "panel" (filtros/KPIs fijos + lista con scroll INTERNO, correcto en escritorio) eran inusables en móvil (KPIs gigantes comiéndose el viewport y la lista en una ranura o inalcanzable). Patrones nuevos del estándar: (5) **panel→documento en `<lg`**: raíz `overflow-y-auto lg:overflow-visible`, card `shrink-0 … lg:min-h-0 lg:flex-1 lg:shrink`, body `overflow-auto lg:min-h-0 lg:flex-1` — la clave es el `shrink-0` de la card en móvil (sin él la card se encoge y el body vuelve a ser scroller interno); ~30 páginas + TablaCatalogo (≈19 catálogos de un golpe); (6) **KpiTiles compacto 2×2 en `<sm`** (restaura auto-fit desde sm); (7) **CajonDetalle a ancho completo en `<sm`** (`data-[side=right]:w-full` — el `w-full` plano SIEMPRE perdió contra el `w-3/4` del Sheet base, misma trampa de variantes del PR #128); (8) **lupa `abrir-paleta-movil`** en la topbar `<md` abre la PaletaComandos (antes no había búsqueda en móvil). Notas de datos para Gabriel: "Marilyn Fitness" en la UI es el NOMBRE de la empresa en BD (renombrable en Admin › Empresas); el WIP negativo (−2.2M pzas) es artefacto del histórico migrado (cuadrar con Daniel).
- **Exports Excel arman el workbook completo en el hilo principal — ✅ RESUELTO (11-jul-2026):** el pool de workers de los PDFs se generalizó a documentos (`REGISTRO_EXCEL` + `renderizarExcelEnWorker` en `comun/pdf-worker*`, timeout propio de 60 s `EXCEL_WORKER_TIMEOUT_MS`; los PDFs siguen en 30 s); los 11 exports migrados (reporte-fiscal, EsMa estado de cuenta, márgenes, concentrado/desempeño RC, ventas/EDR, indicadores ×3, lista de precios) con `armarDatos*` (BD, hilo principal) separado del builder puro (worker), SIN topes (son el fallback "para el total" al que apuntan las leyendas de los PDFs), y el color de marca `ARGB_MARCA` derivado de `PALETA.marca` (fuera el teal de los xlsx). **Deuda nueva (menor, a futuro):** `excel-reporte-fiscal` y `excel-ventas` acumulan todo el periodo en memoria del worker — sobre varios años podrían rondar ~100k filas; ahí tocaría el streaming de exceljs (`WorkbookWriter`), cambio de arquitectura del builder que se decide cuando exista ese volumen real.
- **Auto-avance RC — ✅ RESUELTO (remate post-F9, 11-jul-2026):** los ~8 emisores que faltaban ya existen y el catálogo queda **~18 automáticos**, como el proto §4.9 de Daniel. Lo que se construyó: `TipoEventoProceso` +8 valores y `TipoAuditoria` +`corte` (migraciones `20260710240000`/`20260710250000`, enum-separada y orden BD==schema); emisores en la misma tx en `autorizarOC`/`cancelarOC` (→`compraTela`, por orden ligada con línea de tela) y confirmar/cancelar nota de salida (→`surtidoAvios`, líneas de avío); el consumidor re-evalúa también `auditoriaCorte` (auditoría tipo `corte` aprobada viva — el evento `auditoria-calidad-resuelta` ya se emitía); y la tabla **`HitoOrden`** (revisión OP / fit / tono de tela / avíos / empaque / **arte** — cierra el latente `autorizacion-arte` de F5-E1) con captura en el detalle de la orden (permiso reusado `rc.capturar`, unique parcial de hito vivo, cancelación con motivo). Backfill data-only del catálogo con guarda anti-pisado (solo donde seguía `manual`). Defaults de negocio en `DECISIONES.md §(Post-F9.1)`. Detalle en `docs/modulos/ruta-critica.md §Auto-avance`. **Verificar en `prueba` post-deploy:** Gabriel vio "solo 3" automáticos cuando el seed tenía 8 — posible edición manual en la BD de prueba; tras este deploy deben verse ~18; si no, mirar la BD (el backfill respeta ediciones manuales a propósito).

- **Importador de OC del cliente por PDF — plantilla C&A ✅ (12-jul-2026, sesión con DANIEL en vivo; rama `tarea/importador-pdf-cya`):** extensión del importador R8 (Excel) a **PDFs con plantilla por cliente** (`PlantillaImportacion.formato='pdf-cya'` + `camposVariables` + `porcentajeAdicional`): parseo del PDF real de C&A (unpdf, anclas valor-antes-de-etiqueta), **multi-PDF → UN pedido interno + 1 OP por PDF** en una tx (A2), **liga aprendida** modeloCliente↔modelo interno (`ClienteModeloLiga`, propone solo activos), **referencia principal = nº de orden de la OC** ("Pedido cliente" en Centro/panel/búsqueda/impreso; Modelo ID/Código único/Semana/Sub División como adicionales D7), **sobre-pedido por PACKS** (C&A=7%: round al nº de packs × proporción del pack; SKU round por talla; **vista previa editable celda a celda**; el renglón del pedido conserva las cantidades ORIGINALES), **`Orden.packsCliente` jsonb** (SKUs por talla + grupos — base del futuro módulo de EMPAQUE), **`OrdenLinea.pantone`** (capturado del PDF si viene, editable, en el impreso junto al color) y la OC adjunta a cada OP. Reglas de negocio dictadas por Daniel en `DECISIONES.md §(Post-F9.2)`; detalle técnico en la nota R8.1 de `docs/rediseno/PLAN-IMPLEMENTACION.md`. 3 migraciones aditivas sin permisos/seed → **NO requiere `SEED_ON_START`**. **Diferido con razón de diseño:** panel read-only "Packs / SKUs del cliente" en el cajón de la orden → se construye con el módulo de **EMPAQUE** (la persistencia ya está; el jsonb es consultable). **Siguientes plantillas:** Daniel irá subiendo OCs de otros clientes para definirlas (cada cliente = su plantilla + su % adicional). **+ Crear modelo desde la vista previa ✅ (12-jul, 2º PR — "cuando hago nuevos pedidos es cuando genero los modelos internos"):** botón "Crear modelo nuevo" (gate `modelos.administrar`) que REUSA el `DialogoModelo` estándar prellenado con la Descripción Cliente; código repetido → bloqueado por el alta (409); Modelo ID ya ligado a otro modelo → advertencia blanda; el creado queda ligado a mano y se aprende al confirmar. FRONTEND-ONLY (backend diff=0 verificado por el reviewer). **Consideración futura sin fase:** el análogo en el importador Excel sería "crear DESARROLLO desde el preview" (ese liga a Desarrollo, no a Modelo).

- **Deuda técnica — las acciones inmediatas del diálogo de la orden tiran las capturas pendientes (detectada por reviewer el 24-jul-2026, NO arreglada):** desde el **guardado único** del diálogo de la orden (petición de Daniel, ver `docs/cambios-frontend-daniel.md` 2026-07-24), las secciones con captura (encabezado, matriz, referencias) acumulan cambios hasta que el usuario pulsa "Guardar". El guardado múltiple ya se protege solo (captura todos los payloads antes de mandar el primero, y **bloquea la re-inicialización** de las secciones mientras dura la tanda y si queda a medias — `useReinicioBloqueado` en `frontend/src/modulos/ordenes/guardado-orden.tsx`). Lo que **NO** está protegido: cualquier **acción inmediata del mismo diálogo que modifique la orden** — *copiar matriz de otra orden*, *cancelar la orden*, *registrar/cancelar un hito*, *ligar/quitar el desarrollo*, *subir/quitar un adjunto*, *agregar un comentario* — invalida el detalle, cambia `orden.modificadoEn` y **re-inicializa las 3 secciones, tirando lo que el usuario tuviera capturado sin avisar**. El riesgo existía antes (cada sección ya se reiniciaba así), pero **ahora es mayor**: el botón único invita a acumular cambios en varias secciones antes de guardar. Fixes posibles: (a) extender el mismo bloqueo de re-inicialización a esas acciones y refrescar solo lo que cambian; (b) que esas acciones avisen ("tienes cambios sin guardar") antes de ejecutarse, como el guardia de cierre; (c) que el diálogo re-siembre las secciones fusionando en vez de reemplazando. Sin fase asignada — retomar cuando se priorice.

- **Deuda técnica — `confirmarLogo` no verifica que el objeto EXISTA en R2 (detectada por reviewer el 25-jul-2026, NO arreglada a propósito):** el logo de la empresa (branding post-F9) se sube en tres pasos —preparar → PUT a R2 → **confirmar**— y el paso de confirmación liga el `Archivo` a `Empresa.idArchivoLogo` y borra el anterior **sin hacer un `HeadObject`** contra R2. Un cliente que MIENTA (confirme sin haber subido, o tras un PUT fallido) deja la FK apuntando a un objeto inexistente, y el sistema se queda con el logo empaquetado en vez del suyo. **Por qué NO se arregla ahora:** (a) requiere un cliente malicioso o roto — el navegador real solo confirma después de un PUT con `response.ok`, y hacerlo exige el permiso `empresas.administrar`; (b) el daño quedó ACOTADO por la caché negativa de `comun/logo-empresa.ts`: una key que no existe cuesta **un viaje fallido a R2 cada 10 s**, no uno por impreso como habría sido sin ella; (c) es reversible desde la propia pantalla (volver a subir el logo o quitarlo). Fix futuro, barato: un `HeadObject` (o un `descargarContenido` con tope) dentro de `confirmarLogo` antes de reapuntar la FK, y rechazar con 409 si el objeto no está. Sin fase asignada — retomar cuando se priorice.
- **Deuda anotada — el DESVÍO DE PRECIO no queda guardado en la línea de OC (V1-E3z, 23-ago-2026; decisión del coder, dicha y no callada):** desde §Post-F9.94 el comprador puede corregir el precio en la revisión previa, y la previa **avisa** del cambio (chip «Precio ajustado (propuesto $X)»). Pero ese aviso **no se persiste**: `OrdenCompraLinea` guarda `cantidadSugerida` (para que la bandeja de autorización mida el desvío de la CANTIDAD, §Post-F9.89(a)) y **no tiene su equivalente de precio**. O sea que quien autoriza una OC generada en otra sesión ve el precio final pero **no contra cuál se cambió**. **Por qué no se hizo hoy:** pide **una columna nueva con su migración**, y §Post-F9.94 no lo pidió — Daniel reportó que no podía editar, no que faltara la traza. **Fix, cuando se decida:** `precioSugerido Decimal(12,2)?` en `OrdenCompraLinea`, llenado desde `PlanRenglon.precioPropuesto` (que ya se calcula y ya viaja), y leído por la bandeja igual que la cantidad.
- **Deuda anotada — el acto EN BLOQUE de proveedor corre con el `timeout` por DEFECTO de la transacción (V1-E3x, 22-ago-2026; señalada por el reviewer, NO accionada):** `asignarProveedorDeMaterialEnBloque` acepta hasta **500** renglones y los escribe delegando uno por uno dentro de UNA transacción interactiva, sin pasarle `{ timeout }` a `enTransaccion`. Con un lote grande y una base lenta podría chocar contra el timeout por defecto de Prisma (5 s) y **abortar el acto entero** — que es el comportamiento correcto (todo o nada), pero con un mensaje técnico en vez de uno útil. **Por qué no se arregla hoy:** el caso real de Daniel son ~6 renglones, la explosión más grande del sistema no se acerca a 500, y elegir el número del timeout sin una medición sería inventarlo. **Fix, cuando se vuelva a tocar el archivo:** pasar `{ timeout }` explícito a `enTransaccion` (el tercer parámetro ya existe) y/o bajar el tope del contrato al máximo real observado.
- **Deuda anotada — superficie de contrato que viaja y no se pinta (V1-E3x, 22-ago-2026; señalada por el reviewer, NO accionada):** la respuesta del acto en bloque incluye `asignados[]` con `folioOrden`, `tipo`, `idMaterial` y `material` de cada renglón, y **la pantalla no usa ninguno** (sólo `proveedor`, `renglones` y `ordenes` para el aviso). **Por qué se dejó:** es el detalle de lo que se escribió, útil para un consumidor de la API y para depurar un acto que salió raro, y quitarlo sería un cambio de contrato para ahorrar bytes que nadie está pagando. Si en la próxima revisión sigue sin usarse, es candidato a recortarse.

- **Estado automático de la orden + bandera "lleva arte" ✅ (26-jul-2026, decisión de Daniel `DECISIONES.md §Post-F9.4`):** la orden se marca `completa` sola con *tallas + avíos, y arte si aplica*; el arte lo decide la casilla **`Modelo.llevaArte` (default `true`, también para lo migrado)** — *"por default sí lleva… si no meten la información del arte, o no desmarcan la casilla, está como incompleto"*. **Efecto querido:** muchas órdenes vivas quedan incompletas hasta capturar el arte o desmarcar la casilla; por eso el estado quedó **informativo** (ninguna de las 7 pantallas de captura filtra ni bloquea por él — el `SelectorOrden` filtraba `completa` y se corrigió) y **des-completar** solo ocurre al editar la matriz de esa orden y sin producción viva. Migración aditiva `20260726120000_modelo_lleva_arte`, SIN permisos nuevos (no requiere `SEED_ON_START`). Detalle en `docs/modulos/ordenes.md` y `docs/cambios-frontend-daniel.md` (2026-07-26).

- **Costo REAL de materiales desde las órdenes de compra ✅ (26-jul-2026, petición de Daniel `DECISIONES.md §Post-F9.5`):** el costo de **tela y avíos** de la orden ya no sale solo de la receta × precios de catálogo, sino de **lo realmente comprado** — Σ de las líneas de OC **autorizada+ ligadas a la orden** (`OrdenCompraLinea.idOrden`, R7/F4) más el consumo sin compra propia valuado a **último precio de compra** (así los **genéricos** se costean y una compra compartida se **prorratea por consumo**, las tres reglas que dictó Daniel). La **sobre-compra se costea COMPLETA** (aclaración de Daniel: 1,100 etiquetas / 1,000 cortadas ⇒ 1.1 por prenda): el importe directo **nunca** se topa al requerido. El **requerido** va siempre en la base del costeo (**piezas cortadas**): el snapshot del MRP se **escala** desde su base (piezas pedidas) y se **reconcilia contra el BOM `paraCosto`** con aviso en los dos sentidos. Motor nuevo `backend/src/dominio/costos/costo-real-compras.ts` (núcleo puro + lectura + desglose), endpoint `GET /api/costos/ordenes/{idOrden}/real`, tercera columna "Real de compras" en *Costos › Costeo de orden* con su cajón de desglose (OC, proveedor, precio, qué se valuó) y la base del cálculo a la vista. **Cambia el DEFAULT del PRIMER costeo**: con compras ligadas, `telaCost`/`aviosCost` proponen el real; sin compras, el teórico de siempre — el usuario sigue pudiendo teclear y **lo ya costeado se conserva** (omitir un componente ya no lo pisa). Los **procesos** (maquila/arte) y el **EDR** no se tocan. Migración aditiva `20260726140000_costo_orden_real_compras` (`tela_real`/`avios_real`, nullable), **SIN permisos nuevos** (no requiere `SEED_ON_START`). Detalle en `docs/modulos/costos-edr.md` y `docs/cambios-frontend-daniel.md` (2026-07-26).

- **Deuda técnica — la línea de OC generada por el MRP está en unidad de CONSUMO, pero el resto del sistema la lee como PRESENTACIÓN ✅ RESUELTA (26-ago-2026, `V1-E8a` / §Post-F9.97).** Durante meses las dos mitades de F4 no se pusieron de acuerdo: el MRP escribía la línea en unidad de consumo y la recepción la leía como presentación, así que con un `factorConversion ≠ 1` la existencia entraba al kardex **inflada ×factor** y el costo unitario **dividido entre el factor** — con el importe total cuadrando, que es por qué nadie lo veía. **Daniel cortó por lo sano en vez de arbitrar entre las dos convenciones:** los avíos se compran y se costean por **medida unitaria**, la línea de OC va **SIEMPRE en unidad de consumo** y la presentación (rollo, caja) se dice como **texto informativo** en las observaciones. Se alineó al LECTOR con el ESCRITOR y **se retiró el factor de conversión completo** — los ~9 lectores, el motor `comun/conversion.ts` (borrado) y el campo `precioUnidadConsumo` del contrato. Las dos columnas se conservan **muertas y vacías** en el esquema (D3), documentadas como tales. **Sin migración de datos** (el factor nunca tuvo escritor ⇒ siempre NULL ⇒ las dos convenciones coincidían numéricamente y toda línea histórica es válida). Ficha: `docs/hoja-de-ruta/V1-etapas.md` §V1-E8a.

- **Pregunta de producto — "Mis pendientes" NO lista los pendientes programados a más de 4 días (detectada al depurar el e2e de RC, 26-jul-2026):** en la vista por defecto (agrupada por **Urgencia**), `MisPendientesPagina` solo pinta renglones para `vencida / hoy / semana / sinFecha`; los `despues` (fecha planeada a >4 días, `DIAS_SEMANA_PENDIENTES` en `backend/src/dominio/ruta-critica/bandeja.ts`) **solo se cuentan** en la nota "+N programadas más adelante" y en el KPI "Total a tu cargo". Es fiel al proto §4.9 de Daniel y está cubierto por su prueba unitaria, así que **se declara, no se cambia**: con un filtro puesto, un supervisor puede ver la lista vacía y el total en 3 sin entender por qué (en "Agrupar por: Proceso" sí salen todos, porque ese modo no agrupa por urgencia). Decisión para Daniel/Gabriel: ¿agregar una sección "Más adelante" colapsada? Sin fase asignada. *(Efecto colateral ya arreglado: el e2e `ruta-critica-motor.spec.ts` programaba la entrega a +30 días y solo pasaba mientras el job del CPM no hubiera fechado los procesos —ventana de carrera—; ahora programa a +3 días, con `test.setTimeout` propio y el patrón `toPass` de recarga+refiltrado en los dos pasos. **No alejar esa fecha más de 4 días** o la prueba vuelve a quedar en rojo.)*

- **El "atrás" del teléfono cierra la capa flotante, no la pantalla ✅ (28-jul-2026, reporte de Daniel):** en móvil el detalle vive en un **cajón** (Sheet) que NO es una ruta, así que el "regresar" del celular sacaba al usuario de la pantalla (Daniel aterrizaba en Almacenes desde Órdenes). Hook nuevo `frontend/src/lib/useCerrarConAtras.ts`: cada capa abierta ocupa una entrada CLON del historial (misma URL y mismo `state` de React Router + una **marca con su nivel**, campo que RR ignora porque solo lee `usr`/`key`/`idx`), y el estado se **reconcilia leyendo el nivel del historial** contra las capas abiertas — nunca se retrocede a ciegas. Aplicado en `CajonDetalle` (**las 17 pantallas** que lo usan, escritorio incluido: el Back del navegador ahora cierra el cajón) y en `AvanceProduccion`. Con capas anidadas el "atrás" cierra **solo la de encima**; un clon huérfano (se navegó a otra ruta con el cajón abierto) **se salta solo** al volver a pisarlo, sin "atrás muertos". **Trampas que costaron una ronda de reviewer (no re-romper):** (a) la sincronización va **diferida un tick** a propósito — si el clon se apilara en el mismo commit, el `navigate(…, {replace:true, state:null})` con que las pantallas limpian su deep-link caería SOBRE el clon (regresión reproducible en `ModelosPagina`, que abre el cajón en el PRIMER render); (b) por lo mismo, cerrar una capa y abrir otra en el mismo commit (el botón de avance) **no toca el historial**, y eso es lo que evita la carrera `back()`/`pushState` que en StrictMode se comía el primer "atrás". En el mismo cambio: el botón **"Registrar avance de producción"** no servía en móvil porque el panel abría DEBAJO del cajón (Sheet portalizado al body vs. panel en línea) → abrir el avance cierra el cajón, igual que ya hacía "Modificar". Frontend-only: SIN migración, SIN permisos, SIN seed. Detalle en `docs/cambios-frontend-daniel.md` (2026-07-28).

- **Campos numéricos sin incremento por gesto ✅ (28-jul-2026, petición de Daniel — `DECISIONES.md §(Post-F9.6)`):** regla de UI **global**, no campo por campo. Se apagan los **tres** caminos del mismo control en los ~123 `input[type="number"]` del sistema: el **widget de flechitas** (CSS en `frontend/src/index.css`, `@layer base`), la **rueda del mouse** y las **flechas ↑/↓** (guarda global `frontend/src/lib/sin-incrementos-numericos.ts`, instalada en `main.tsx`). Los campos siguen siendo `type="number"` (teclado numérico en móvil + validación del navegador); lo único que se apaga es el gesto. **Defecto REAL que salió en la revisión y llevaba tiempo vivo:** `MatrizColorTalla` mueve el foco con ↑/↓ pero solo cancelaba el default **cuando había celda destino** → en el **último renglón** un ↓ por costumbre restaba 1 a la cantidad recién tecleada (120 → 119) **en silencio**, en la captura de corte/maquilas/recibos/entregas. **Trade-off documentado:** en la rueda se suelta el FOCO en vez de cancelar el evento (cancelarlo congelaría el scroll de la página sobre la celda) → el siguiente Tab arranca desde el principio del documento; en las matrices se navega con ↑/↓ y clic, no con Tab. **Verificación:** jsdom no implementa ni el paso por rueda ni el de las flechas, así que las 9 pruebas unitarias solo pueden afirmar "se soltó el foco"/"se canceló el default" — la comprobación de que **el valor no se mueve** es el e2e `frontend/e2e/campos-numericos.spec.ts`, en navegador real. Frontend-only: SIN migración, SIN permisos, SIN seed. Detalle en `docs/cambios-frontend-daniel.md` (2026-07-28).

- **Avance de producción (WIP): maquileros y descarga de tela ✅ (28-jul-2026, peticiones de Daniel — `DECISIONES.md §(Post-F9.7)` y `§(Post-F9.8)`):** (a) la **entrega a maquila** arranca con el maquilero asignado en la OP (`Orden.idMaquilero`) como **default editable**; solo costura, porque la OP no programa Prov. de Arte. (b) El **recibo** deja de ser "filtro" y pasa a ser **candado**: el saldo por recibir se lleva **POR MAQUILERO**, no por proceso — desglose `porMaquilero` **derivado en servidor** (`wipDeOrden` + contrato `esquemas/wip.ts`), la pantalla ofrece solo a quien tiene entrega viva con su pendiente, y `registrarReciboMaquila` **re-valida** (una lista filtrada se brinca por API). **DEFECTO REAL que esto cierra:** antes se validaba `recibido ≤ enviado` del proceso entero → con dos maquileros en la misma orden se le podía cargar a uno lo que devolvió el otro, falseando EsMa y las existencias en poder del maquilero. **Riesgo asumido:** bloqueo DURO (la regla textual de Daniel) — si el histórico migrado trae recibos que no cuadran contra su entrega, una orden vieja podría rechazar un recibo nuevo; el mensaje nombra a quien SÍ tiene entrega viva, así que se diagnostica solo. **RATIFICADO y CERRADO por Gabriel (30-jul-2026):** el candado duro se queda; los datos de hoy son de prueba y se van a recargar, así que **la inconsistencia vieja se deja quieta** y **NO se construye** pantalla para asignarle maquilero a las entregas migradas sin tercero (*"en lo nuevo no se permite que hayan inconsistencias"*). (c) Vocabulario: **Entrega de Arte / Recibo de Arte / Prov. de Arte** (completa el barrido del 24-jul; el código conserva `aplicacion`). (d) **Enlace "Descargar tela del inventario"** en la etapa de Corte → abre `/inventarios/telas/salida-orden` con la orden puesta (deep-link nuevo en esa pantalla), gated por `inventario-telas.mover`. **NO se automatizó** el descuento de tela al cortar, con razón de diseño: el corte es en PIEZAS por color×talla y la salida de tela en metros/kilos por tela y lote, que dependen del tendido real y del lote — derivarlo sería inventar un número que descuadra el inventario. Las dos vías de salida que describió Daniel (por orden / nota abierta) **ya existían** desde F4; lo que faltaba era el puente. Hay cambio de contrato pero SIN migración, SIN permisos, SIN seed. Detalle en `docs/cambios-frontend-daniel.md` (2026-07-28).

- **Deuda de una línea — el default del maquilero falta en `/produccion/envios` (28-jul-2026):** el default de la OP (`DECISIONES.md §(Post-F9.7)`) se aplicó en el panel de avance, pero `EnvioMaquilaPagina` (la pantalla de *Envío a maquila* del menú) **también es entrega a maquila** y sigue arrancando con el campo vacío. Se dejó fuera de la ronda a propósito —es comodidad ausente, no una UI que contradiga al servidor, a diferencia del recibo, donde sí había que cerrar las dos pantallas— y queda anotado para que no se pierda: Daniel pidió el default "en entrega a maquila", sin distinguir pantalla. Sin fase asignada.

- **Telas A1 — el catálogo reestructurado ✅ (6-ago-2026, `DECISIONES.md §Post-F9.11`):** identidad en 4 datos (tipo = la categoría re-etiquetada · composición de catálogo NUEVO `ComposicionTela` · proveedor DUEÑO obligatorio en altas nuevas · nombre del proveedor), complemento como PARTE de la misma tela (`nombreCuerpo`/`nombreComplemento`; NULL = no lleva; su invariante de precios vive en DOMINIO), y **`TelaColor` reestructurado a HIJO de la tela**: `id` propio, `nombre` texto libre único por tela, `pantone`, 2 precios, e `idColor` como liga LEGACY nullable (solo filas migradas — el catálogo global `Color` queda SOLO para el color de PRENDA). Alta de color de prenda AL VUELO en la matriz de la OP (server-side, gated `colores.administrar`). Helper `resolverPrecioColorReferencia` (liga legacy → nombre → null) LISTO pero sin cablear: hoy NINGÚN flujo lee `TelaColor` para precios (MRP lo omite por decisión F8-E6) — el primer consumidor será A2/la corrección del costo de tela. La fusión de colores de prenda conserva pantone/precioComplemento al fusionar. SIN permisos nuevos (no requiere `SEED_ON_START`); una migración con data-copy (los nombres salen de la liga vieja). **Deuda registrada (reviewer A1, opción (b) elegida por el lead):** `TelaProveedorColor` (R17/F8) sigue apuntando al catálogo de PRENDA → el "precio por color del proveedor" solo aplica a telas MIGRADAS (las nuevas nacen sin liga); la UI lo dice honesto y deshabilita el modo por-color. NO se reapuntó a `TelaColor` a propósito: con el proveedor DUEÑO en la tela, R17 va camino a simplificarse/retirarse — decidir su destino antes de invertirle. **Nota para la ficha de A2 (reviewer R2-10):** tras A1 conviven DOS modelos del "color de la tela" — `TelaColor` (hijo, nombre libre) y `Lote.idColor` (F4), que sigue apuntando al catálogo de PRENDA; A2 (partidas con folio propio) lo choca de frente y debe resolverlo (la partida debería colgar de `TelaColor`). **Deuda menor declarada por el reviewer (no bloquea, razón explícita):** intercambiar los NOMBRES de dos colores de la misma tela en un solo guardado choca contra el unique y el mensaje dice "Ya existe una tela con ese nombre" (habla de la TELA, no de los colores); los datos quedan a salvo (la tx revierte). Fix de una línea (`error.meta.target` → mensaje de colores) — hacerlo al volver a tocar `actualizarTela`. **Pendiente del track de telas:** A2 (partidas con folio propio + inventario de dos componentes + doble clic al color), entrada por factura/remisión, pantalla de stocks, packing list; luego el PACK (§Post-F9.10) y el costo de tela por consumo (§Post-F9.11 punto 6).

- **Telas A2 — el inventario nuevo por PARTIDAS y COLOR ✅ (6-ago-2026; 1 coder + 1 reviewer independiente — RECHAZÓ con 7 hallazgos, TODO corregido en una ronda → veredicto final en la ficha del PR):** `PartidaTela` (folio propio por secuencia atómica `partida-tela` por empresa, A3; `loteProveedor` texto buscable; FK a `TelaColor` → **RESUELVE la deuda "dos modelos de color"** anotada por el reviewer de A1: la partida cuelga del color HIJO de la tela, y el flujo `Lote`/`Lote.idColor` de F4 queda como LEGADO en cuarentena). `MovimientoDetTela` +3 columnas nullable (`idTelaColor`/`idPartida`/`cantidadComplemento`); el complemento viaja SIEMPRE junto al cuerpo en el mismo renglón (cuerpo 0 permitido = compra de solo cardigan); **una entrada crea UNA partida POR RENGLÓN** (una factura con 2 lotes del mismo color = 2 renglones = 2 partidas); las SALIDAS no escogen partida (el consumo empareja por TELA+COLOR — la pantalla avisa "riesgo de tono" SIN bloquear, §Post-F9.11 punto 2). Vista `existencia_tela_color` (Σ ambos componentes) y la vista vieja `existencia_tela` REEMPLAZADA con filtro `id_tela_color IS NULL` (hallazgo bloqueante del reviewer: sin eso el flujo nuevo contaminaba el legado — filas fantasma sin complemento; misma cirugía en `kardexTela` y `existenciaTelaBloqueada`). Pantallas: existencias TELA PADRE→colores (columnas cuerpo/complemento, doble clic o botón → kardex de saldo corrido doble con cancelar-inverso y filtro por partida), ajuste por color (puerta del arranque DESDE CERO), traspaso por color, salida a orden POR COLOR (hereda el deep-link "Descargar tela"); las pantallas por lote siguen vivas retituladas "(legado)" en rutas propias. Riel: `telas` pasó de colapsar a PADRE con 4 hijos visibles (existencias, catálogo — Daniel no lo encontraba —, salida a orden, ajuste). SIN permisos/tipos/seed nuevos (**no requiere `SEED_ON_START`**); 1 migración automática aditiva. **Deuda que sigue viva:** R17 `TelaProveedorColor` (decidir destino), fix de una línea del mensaje swap-de-nombres en `actualizarTela`, el hueco PRE-EXISTENTE de todo el módulo de inventarios (ningún ajuste valida que `idAlmacen` sea de la empresa — señalado por el reviewer de A2, fuera de su alcance), y el **guard asimétrico de los endpoints LEGADOS de tela** (deuda del reviewer de A2 con razón explícita: `cancelarMovimientoTela`/`obtenerMovimientoTela` en `dominio/inventarios/telas.ts` no rechazan un id del flujo por color; NO bloquea porque el inverso que producen es idéntico al del endpoint por color — el motor copia las 3 dimensiones nuevas — y ninguna UI llega ahí; fix de una línea al volver a tocar el archivo: exigir `idTelaColor: null` en ambos). **A1.1 (remates del catálogo, feedback textual de Daniel 6-ago tras probar A1 — `DECISIONES.md §Post-F9.11` punto 7) ✅ construida el mismo día:** peso/ancho (gr/m² y m, opcionales con tope en contrato), favorito default al alta, placeholder "Negro", `paraProduccion` y `tipoComponente` OCULTOS de la UI (columnas quedan como LEGADO comentado en el schema; test de regresión fija que editar una tela vieja NO los resetea), complemento pre-llenado "Cardigan" + cuerpo propuesto desde el tipo (solo con la casilla marcada — sin escrituras invisibles), `Proveedor.nombreCorto` (capturable Y visible en el detalle) + **nombre compuesto auto-armado** "corto + nombre del proveedor de la tela" con bandera de "tocado" (edición no re-arma sola; la salida de tela lleva el corto para que el re-armado en edición use el MISMO nombre que el alta). 1 migración aditiva (3 columnas opcionales); SIN permisos → sin `SEED_ON_START`.

- **Telas B1 — la entrada de tela por FACTURA/REMISIÓN y la recepción de OC al flujo nuevo ✅ (6-ago-2026; 1 coder + 1 reviewer independiente — RECHAZÓ con 12 hallazgos (4 bloqueantes), TODO corregido en una ronda):** cierra la decisión **§Post-F9.9 punto 7** de Daniel (*"permitir las dos vías… una cabecera por documento y N partidas"*). **(a)** `EntradaTela` + `EntradaTelaLinea` + `EntradaTelaArchivo`: folio propio por secuencia atómica `entrada-tela` (A3), tipo factura|remisión, número del documento del proveedor, proveedor/fecha/almacén, **PDF adjunto en R2** (espejo de los adjuntos de la orden, borrado físico best-effort tras el commit) y ciclo **borrador → confirmada → cancelada** (el borrador NO toca inventario: se adjunta y se revisa antes de mover). Cada línea = **una partida** (mismo tela+color repetido = dos partidas), con lote del proveedor y **precio de compra**. Confirmar = partidas + UN movimiento `entrada-recepcion` en UNA transacción (folio de partida SIEMPRE antes del de movimiento, anti-deadlock); doble confirmación imposible (`updateMany` filtrando el estatus previo dentro de la misma tx → la segunda revienta y revierte todo); cancelar = **inverso auditado**. **Aviso suave de factura duplicada** (mismo proveedor + mismo número, excluyendo canceladas): avisa, NO bloquea ni impone unique duro (el número lo pone el proveedor). **(b)** `recibirCompra` (F4, código VIVO) deja de crear `Lote` para TELA y entra por **color/partida**: exige el `idTelaColor` (nunca lo adivina, `ErrorValidacion` explícito), valida que el color pertenezca a la tela comprada, crea la partida y mueve el kardex con su costo; `RecepcionCompraLinea` +`idPartida`+`cantidadComplemento`; **avíos y libres intactos**; `cantidadRecibida` NO cambia de significado (el complemento no cuenta contra lo pedido) → MRP, `ordenes-compra` y el auto-avance de RC verificados sin regresión. **Decisión del lead sobre el hallazgo 4 del reviewer:** `MovimientoDetTela.costoUnitComplemento` se agregó AHORA (misma migración aditiva) y lo pueblan las DOS vías — sin eso el cardigan quedaba invaluable desde el kardex por ambas puertas y §Post-F9.11 punto 6 (costo por consumo) nacería cojo. SIN permisos/seed/tipos de movimiento nuevos (**no requiere `SEED_ON_START`**); 1 migración automática aditiva (0 DROPs). **Deudas declaradas con razón explícita:** (i) cancelar una entrada CONFIRMADA **no valida no-negativo** (el inverso es corrección contable; bloquearlo dejaría documentos inanulables y empujaría a editar movimientos, justo lo que D3 prohíbe) → si la tela ya se consumió, ese color queda negativo y toda salida suya se bloquea hasta un ajuste por conteo; (ii) la entrada por factura **no dispara el hito `compraTela` de RC** (una `EntradaTela` no liga OP; forzarlo inventaría una liga que el negocio no tiene — la tela que mueve la RC entra por la vía con OC), y por lo mismo `costos/costo-real-compras.ts` tampoco la ve, cosa que resuelve B3; (iii) por la vía de OC no se recibe **solo complemento** (`cantidad` es `.positive()` y se compara contra lo pedido): ese caso va por B1. **Pendiente del track:** packing list, PACK (§Post-F9.10), costo de tela por consumo (§Post-F9.11 punto 6).
- **Selectores de proveedor acotados por ROL ✅ (7-ago-2026, petición de Daniel — `DECISIONES.md §(Post-F9.12)`):** *"en los inventarios de telas, solo debe de mostrar los proveedores de telas para poder dar de alta una nueva tela… los proveedores de tela son importantes para futuras consultas"*. **La clasificación ya existía y ya era consultable** (el `tipo` heredado de `TipoProv` H/T/S **y** los roles multi-valor de R15, ambos con filtro propio en la lista de proveedores y ambos llenados por el ETL de forma consistente); lo que faltaba era **usarla para acotar los selectores**. Criterio elegido por Daniel: el **ROL** (`vende-telas`), no el tipo — es multi-valor (quien vende telas Y avíos sale en las dos pantallas) y es el mismo criterio que Producción ya usaba para cortadores/maquileros. **Dónde:** alta/edición de tela del catálogo (el proveedor DUEÑO de §Post-F9.11 — el "dar de alta una nueva tela" de la petición), entrada de tela por factura/remisión (B1) y el ajuste del flujo LEGADO por lote. **En órdenes de compra** el filtro sigue a los renglones en vivo (solo telas → `vende-telas`; solo avíos → `vende-avios`; **mixta o líneas libres → sin acotar**, una OC mixta es legítima). **Regla dura:** el proveedor ya capturado se conserva como opción aunque no cumpla el rol vigente (OCs/documentos viejos o migrados) — el filtro es ayuda de captura, no candado retroactivo. **CxP NO se acota** (una cuenta por pagar puede ser de cualquier tercero). **Efecto a cuidar:** a un proveedor de telas sin la casilla `Vende telas` hay que marcársela para que vuelva a aparecer. Hook nuevo `useProveedoresPorRol` que centraliza el patrón. **Solo frontend** (el API ya soportaba `?rol=` desde F1-E1B): SIN migración, SIN permisos, SIN seed → **no requiere `SEED_ON_START`**.
- **Almacén de telas ↔ CORTADOR + el traspaso al taller ✅ (7-ago-2026, petición de Daniel — `DECISIONES.md §(Post-F9.13)`):** *"ligar cada almacén de telas (opcional) a un cortador… que la ventana de descarga de tela abra con el almacén relacionado"* + *"es muy importante hacer una pantalla de traspaso de telas entre almacenes"*. **La pantalla de traspaso YA EXISTÍA** (A2: *Inventarios › Telas › Traspaso de telas por color*, dos patas atómicas con no-negativo bajo lock) — no se duplicó, se **arregló lo que la hacía inservible**: listaba almacenes de PT y de avíos, y no decía qué bodega era de qué taller. Nuevo `Almacen.idCortador` (nullable, **único**: un cortador = un almacén, si no el default sería ambiguo) validado en dominio (solo tipo TELA · proveedor activo con rol `corte` · el mensaje dice dónde marcar la casilla). El *"abre automáticamente"* se implementó como **el enlace que ya existía llevándose el dato** —no una navegación que se dispara sola, que con la matriz del corte a medio teclear sería hostil (§Post-F9.8 ya preguntaba antes de salir)—: al elegir cortador aparecen **"Descargar tela"** (orden + almacén puestos) y **"Mandar tela al cortador"** (traspaso con el DESTINO puesto; el origen no se adivina). El mismo puente se agregó a *Producción › Captura de corte* para no repetir la deuda de §Post-F9.7. Lo propuesto **nunca pisa lo elegido** (se propone una vez y solo con el campo vacío). **Defecto propio cerrado en la misma ronda:** el efecto del deep-link dependía de la lista de almacenes y llamaba a `navigate` dentro → **bucle infinito** con identidad de datos nueva por render; lo cazó la prueba nueva del traspaso (se colgó) y se cerró con candado por `ref` en las dos pantallas. 1 migración aditiva (`20260807120000_almacen_cortador`), SIN permisos → **no requiere `SEED_ON_START`**.
- **La entrada de tela por factura, ligada a su ORDEN DE COMPRA ✅ (7-ago-2026, petición de Daniel — `DECISIONES.md §(Post-F9.14)`):** *"al dar entrada de tela de una factura, la relacionemos con la OC de esa tela… se marca con estatus de recibido"*. Cierra la deuda (ii) que B1 había declarado. **UNA sola puerta** (decisión de Daniel): `recibirCompra` **rechaza** los renglones de tela apuntando a la factura —convivir permitía recibir la misma tela dos veces e inflar el inventario—; **avíos y líneas libres siguen recibiéndose desde la OC**. La liga es **por renglón** (`EntradaTelaLinea.idOrdenCompraLinea`, nullable): una factura puede surtir dos OCs y traer tela suelta en el mismo documento. **Confirmar la factura ES la recepción**: genera una `RecepcionCompra` por OC surtida (`id_entrada_tela` guarda de cuál nació) con la MISMA contabilidad de F4 —renglones, recálculo de estatus R7 y evento `material-recibido` para la RC— **sin mover inventario otra vez** (reusa la partida y el movimiento de la entrada). **Cancelarla** reversa esas recepciones (suave, D3) y la OC vuelve a pendiente. Validaciones al confirmar: renglón de tela · color de la tela comprada · mismo proveedor · OC autorizada/parcial; si algo falla se revierte todo. Endpoint nuevo `GET /api/compras/lineas-tela-pendientes` como ayuda de captura (solo ofrece renglones de la MISMA tela). **Locks de OC al principio de la tx y en orden ascendente**, igual que `recibirCompra`, para que las dos puertas no se traben entre sí. 1 migración aditiva (`20260807160000_entrada_tela_orden_compra`), SIN permisos → **no requiere `SEED_ON_START`**.
- **Replanteo de la entrada de tela: se arranca desde la OC ✅ (7-ago-2026, feedback de Daniel al probar lo anterior — `DECISIONES.md §(Post-F9.15)`):** *"cada proveedor de telas tiene sus telas definidas. No puedo meter una felpa alsatex en el proveedor bloom"* + *"la manera de relacionar la OC tampoco me gusta. Chance estaría mejor recibir las telas a partir de las OC"*. **(1)** La tela es DEL proveedor: era un **defecto** —el dueño ya existía desde A1, pero `listarTelas` no sabía filtrar por él— resuelto con el filtro `idProveedor` (**estricto**: las migradas sin dueño no aparecen, porque el catálogo se captura desde cero y las viejas quedan solo informativas para los consumos). **(2)** El punto de partida pasa a ser la **orden de compra**: botón **"Dar entrada a la tela"** en la OC → abre la factura con el **proveedor FIJO** y el panel **"Pendiente de la orden de compra"**, donde cada renglón trae su botón *Capturar* que precarga tela + cantidad que falta + precio. Solo queda capturar **el color** (lo único que la OC no define). ⚠️ **SUPERADO por §Post-F9.89 (22-ago-2026): la OC SÍ define el color.** Desde V1-E3u la orden de compra de tela lleva `idTelaColor`, el panel de pendientes lo enseña con su pantone y la captura lo **preselecciona** (editable, porque manda lo que de verdad llegó). Se deja la frase original porque explica por qué el código fue así entre el 7 y el 22 de agosto. Se **retiró** el selector "Renglón de OC": la liga ya no se busca, viene de la orden. La captura desde el menú queda para la tela **suelta**. **La contabilidad de §Post-F9.14 no cambió** — esto es el punto de entrada, no el mecanismo. El proveedor viaja en el enlace (`state`) para no releer la OC, y los pendientes se piden **acotados a esa orden**. SIN migración ni permisos → **no requiere `SEED_ON_START`**. **Pendiente abierto:** la **CxP al dar entrada** (petición de Daniel del mismo día) — registrada en `DECISIONES.md §(Post-F9.15)` con el gancho que F9 dejó listo (`registrarCargoCompraCxp`, origen `entrada_sin_factura`, **no fiscal**: el CFDI se concilia después) y las 4 cosas que faltan resolver al construirla.
- **La tela del proveedor, también al capturar la OC ✅ (7-ago-2026, Daniel siguiendo el flujo desde cero — `DECISIONES.md §(Post-F9.15)` punto 3):** *"al seleccionar el proveedor, me vuelve a desplegar todas las telas"*. El filtro se había aplicado a la entrada de tela pero **faltaba en la captura de la OC**, que es donde empieza el flujo. Ahora el selector de tela de la OC solo ofrece las del proveedor del encabezado y **no consulta hasta que hay proveedor** (el combo lo dice, en vez de quedarse vacío sin explicación); **cambiar de proveedor limpia las telas ya capturadas** y avisa, en vez de dejar que el servidor rechace el guardado con la orden entera tecleada; y la regla **se valida en el DOMINIO** (`validarLineas`, A1 — el mensaje dice de quién es la tela). **Excepción deliberada:** las telas migradas SIN dueño no se rechazan (bloquearlas dejaría OCs viejas inmodificables; como el catálogo se captura desde cero, las nuevas siempre traen dueño y la puerta se cierra sola). SIN migración ni permisos → **no requiere `SEED_ON_START`**.
- **La pantalla DICE por qué no se puede dar entrada a la tela ✅ (7-ago-2026, Daniel: *"No me aparece el botón que dices. ¿Por qué es?"* — `DECISIONES.md §(Post-F9.16)`):** su OC autorizada tenía renglones de **TEXTO LIBRE** (así migró el ETL las OCs viejas), no telas del catálogo, así que la ausencia del botón era CORRECTA — pero la pantalla no lo decía y la tabla mostraba `tela ?? avio ?? descripcionLibre` **sin distinguirlos**. Se agregó la columna **Tipo** (Tela/Avío/Texto libre) al detalle de la OC, y el booleano `puedeRecibirTelaDeLaOc` se volvió **`motivoNoRecibirTela`**: cuando no se puede, la barra de acciones **pinta la razón** (sin autorizar · cancelada · solo avíos → van por Compras › Recepción · texto libre → así se migraron las viejas). **Excepción:** la falta de permiso NO se explica (A4: la UI esconde lo que no le toca al usuario, no lo informa). **Consecuencia a conocer:** las OCs **migradas no se pueden recibir por factura** — el flujo nuevo necesita OCs con telas del catálogo. Frontend-only, SIN migración ni permisos.
- **Las secuencias de folio que los ETL dejaron en cero ✅ (7-ago-2026, Daniel: *"hice la OC pero al refrescar el listado, no la veo"* — `DECISIONES.md §(Post-F9.17)`):** la OC **sí se guardó**; tomó **folio 1** y el listado ordena `numCompra` DESC, así que se fue a la última página detrás de las ~7,978 migradas. **Causa raíz: un hueco de los ETL** — quien migra con folio EXPLÍCITO debe adelantar su secuencia al máximo migrado, y de las 12 series solo 4 lo hacían (`pedido`/`orden` en F2-E5, `etapa-mov` en F3-E6, `auditoria` en F6-E6): **`etl-compras-notas.ts` no sembraba ninguna**, dejando `orden-compra` y `nota-salida` en cero. **Y era peor que un problema de orden:** el unique `(idEmpresa, numCompra)` seguía ahí, así que al alcanzar un folio migrado la captura habría tronado con choque de unique. Se hizo la **red permanente**: **`backend/migracion/reparar-secuencias.ts`** recalcula las 7 series con histórico contra el máximo REAL por empresa —**idempotente y monótono** (`GREATEST`: nunca retrocede lo que la captura ya avanzó), corrible después de CUALQUIER ETL— y **`etl-compras-notas.ts` ahora siembra sus dos series al cerrar**, reusando ese motor (el olvido no se puede repetir). Trampa que costó encontrar: el campo del folio **no se llama igual** en todas las tablas (`folio`, pero `numCompra`/`numNota`/`numAuditoria`). SIN migración ni permisos → **no requiere `SEED_ON_START`**, pero **SÍ un paso manual de Gabriel**, una vez en `prueba`: `npx tsx --env-file=.env migracion/reparar-secuencias.ts`. La OC de folio 1 ya capturada sigue existiendo (los folios no se reescriben, D3): si se quiere con folio de la serie real, se cancela y se recaptura.
- **Seis reglas de captura de la ORDEN DE COMPRA ✅ (7-ago-2026, dictadas por Daniel siguiendo el flujo de compras — `DECISIONES.md §(Post-F9.18)`):** **(1) fecha de emisión del SERVIDOR** (*"la del día que se hace, sin opción a cambiarla"*): salió del formulario y del cuerpo del API; el duplicado se emite HOY; el histórico conserva la suya porque entra por `crearOCMigrada`. **(2) fecha de entrega OBLIGATORIA** al crear y **no nullable** al editar (las migradas sin ella siguen editables). **(3) la dirección de entrega es un CATÁLOGO** (`DireccionEntrega` global, ADR-0007: nombre corto + dirección completa + contacto + **favorita** que la OC preselecciona; la favorita es única y no se puede dejar apagada) — **SIN permisos propios**, se gobierna con `compras.ver`/`.administrar` (ADR-0009); `entregaEn` se conserva y en las nuevas se **copia** el texto elegido, para que impresos y consultas viejas sigan leyendo un campo sin join. **(4) la unidad de la tela la manda la TELA** (*"no puede ser una tela que se compra en kilos y en la OC la unidad sea piezas"*): se fija en el DOMINIO ignorando el cuerpo; en **avíos sigue libre** a propósito (presentación ≠ unidad de consumo, R1 tiene su factor). **(5) una OC ligada a varias OP: YA se podía** —la liga es por renglón y el encabezado deriva el N:N— pero no se veía: se hizo visible y quedó **probado** para que nadie lo "arregle" duplicando OCs. **(6) la tela se compra CON su complemento** (Cardigan): `OrdenCompraLinea.cantidadComplemento`/`precioComplemento` (NULL = al precio del cuerpo), su importe **suma al subtotal**, y el dominio lo **exige** cuando la tela lo define y lo **prohíbe** cuando no. ⭐ **Hueco cerrado sin inventar datos:** la explosión MRP no sabe cuánto Cardigan lleva una tela (el BOM guarda un consumo único), así que sus OC nacen con el complemento pendiente (bandera interna `automatica`, no viaja por el API) y **`autorizarOC` no las deja pasar** hasta capturarlo; sus fecha/dirección salen de la orden de producción y de la favorita del catálogo, y si falta alguna se dice qué falta en vez de generar una OC a medias. 1 migración **aditiva**, SIN permisos → **no requiere `SEED_ON_START`**; **paso manual una vez:** dar de alta las direcciones en Catálogos › Direcciones de entrega y marcar la favorita (el catálogo nace vacío a propósito: una dirección es dato del negocio).
- **Cuándo se marca RECIBIDA una orden de compra ✅ (7-ago-2026, criterio dictado por Daniel — `DECISIONES.md §(Post-F9.19)`):** *"se debe de marcar como recibido si se recibe lo mismo que está en la OC. Si en la OC lleva cardigan, se debe de recibir el cardigan"* + *"en telas nunca se recibe la cantidad exacta: si se piden 400 kilos, el proveedor puede entregar +/− 5%"*. Se hizo **una sola función pura** (`dominio/compras/tolerancia-recepcion.ts`) que manda en los TRES lugares donde antes se comparaba a mano —estatus de la OC, `porRecibir` del tablero y pendientes que ofrece la captura de la factura—: el renglón cierra cuando el **cuerpo** alcanza lo pedido *menos la banda del 5%* **Y**, si la OC pidió complemento, cuando el **complemento** también lo alcanza. La banda **NO es exclusiva de la tela** (aclaración de Daniel el mismo día: *"en avíos también puede haber una diferencia"*): vive en `TOLERANCIA_POR_TIPO` (`tela`/`avio`, hoy 5% las dos, separadas para afinar una sin tocar la otra), y **la cantidad recibida SIEMPRE se captura** —nunca se asume igual a la pedida, ni se rechaza por diferir— tanto en la recepción de avíos como en la factura de telas. Dentro de la banda lo que falte deja de contar como faltante; el complemento pendiente SÍ cuenta, valuado a su precio o al del cuerpo. La captura de la factura dice *"faltan 380 kg + 5 de Cardigan"* y precarga las dos cantidades. **SALDA la deuda que §Post-F9.18 había asumido** y **sin migración** (`RecepcionCompraLinea.cantidadComplemento` ya existía desde B1; faltaba mirarlo). **SEGUNDA ETAPA por decisión de Daniel** (*"lo podemos hacer en una segunda etapa… ahorita ya quiero terminar con eso"*): **autorizar** las diferencias mayores al 5% — hoy esa diferencia simplemente no cierra la orden (queda `recibida_parcial`, visible en el tablero), no se bloquea ni se pide permiso. SIN permisos → **no requiere `SEED_ON_START`**.
- **Leer la FACTURA (XML del CFDI) para llenar la entrada de tela ✅ (7-ago-2026, petición de Daniel — `DECISIONES.md §(Post-F9.20)`):** *"lo ideal es que pueda leer la factura y llenar los campos"* → *"que la información la tomes del XML… y el PDF que se suba solo como referencia"*. **Del XML porque es exacto** (RFC, UUID, fecha, serie/folio y cada concepto con cantidad/valor unitario/importe); del PDF habría que adivinar con OCR o plantilla por proveedor. El endpoint **solo LEE** y devuelve una **propuesta**: reconoce al proveedor por su **RFC**, y cruza cada concepto con el renglón de OC pendiente en dos pasadas —primero por **nombre de la tela** (normalizando mayúsculas/acentos/signos) y luego por cantidad parecida o único pendiente—, sin asignar un renglón a dos conceptos y **diciendo por qué** sugirió cada uno. Es **conservador a propósito** (exige que todas las palabras del nombre aparezcan): un renglón vacío se corrige en un clic, un amarre equivocado descuadra la OC en silencio. Las **cantidades y precios que valen son los de la factura** (es lo que llegó y lo que se paga), editables. Lo único que sigue capturándose a mano es el **COLOR**, que el CFDI no dice. **La misma factura no se recibe dos veces:** `entradas_tela.uuid_cfdi` con unique por empresa + aviso si ese UUID ya está en otra entrada o ya en CxP. **REUSA el parser de F9** (un solo lugar entiende de CFDI; se le agregaron `serie`/`folio`, aditivo). Permiso `inventario-telas.mover` (recibir), NO `cxp.administrar`. 1 migración aditiva, SIN permisos → **no requiere `SEED_ON_START`**. **Queda pendiente la otra mitad:** que al **confirmar** se genere la **CxP** con ese mismo CFDI (los datos ya están; F9 ya sabe crear el cargo fiscal — falta cablearlo en la transacción con el permiso resuelto como dice §Post-F9.15).
- **La CUENTA POR PAGAR nace al confirmar la entrada de tela ✅ (7-ago-2026 — `DECISIONES.md §(Post-F9.21)`):** cierra la petición abierta en §Post-F9.15, con la información del **XML** como pidió Daniel. **Al guardar**, el servidor **re-parsea** el XML (el total fiscal jamás se acepta del cliente), valida que el **emisor sea el proveedor** de la entrada y que el CFDI no esté ya en CxP, sube el XML a R2 y sella `uuidCfdi` + `totalCfdi` + archivo. **Al confirmar** nace el cargo **en la misma transacción** (A2): **fiscal**, por el **TOTAL del comprobante** (con impuestos, no por la suma de renglones), con UUID/RFC/XML de respaldo y ligado a la entrada (`refTipo: entrada-tela`, punto **(b)**). **Al cancelar**, el cargo se cancela por su **inverso auditado** (D3, punto **(c)**) — sin eso quedaría vivo el cargo de una entrada cancelada. **Sin CFDI NO se inventa cargo** (remisión/captura a mano): un cargo sin comprobante no es una cuenta por pagar, es una suposición. **Permiso, punto (a) resuelto:** variantes **internas** `registrarMovimientoTerceroInterno`/`cancelarMovimientoTerceroInterno` (mismo código sin el guard, **solo dominio**, nunca desde una ruta) para los cargos que nacen como consecuencia de un acto ya autorizado — exigir `terceros.administrar` obligaría a Finanzas a recapturar a mano cada factura ya recibida. **Correcciones de la revisión (11-ago-2026):** editar el borrador ya **no pierde ni desvía el sello** (el `uuidCfdi` salió del PUT; sin XML nuevo el sello se conserva y se re-valida contra el proveedor); el cargo nace **con el RFC del emisor** (`entradas_tela.rfc_cfdi`, viaja como `rfcTercero` al reporte del contador); **con CFDI el RFC del proveedor es OBLIGATORIO** — la comparación "el emisor debe ser el proveedor" solo corría *si el proveedor tenía RFC*, y como los **155 migrados no lo tienen**, con datos reales era un **NO-OP**: se podía amarrar la factura de un tercero a otro y nacía un cargo fiscal a nombre de quien no facturó (⚠️ **para recibir por factura hay que capturarle el RFC al proveedor** en *Catálogos › Proveedores*); y el choque con Finanzas ya dice la **única salida real** (cancelar el borrador y recapturarlo sin XML — cancelar el movimiento en Finanzas NO libera el folio, y "quitarle la factura" ya no existe). **2 migraciones aditivas** (`20260810160000_entrada_tela_cfdi_para_cxp` y `20260811120000_entrada_tela_rfc_cfdi`), SIN permisos → **no requiere `SEED_ON_START`**.
- **Dos tipos de proveedor: el que factura y el que no ✅ (10-ago-2026, petición de Daniel — `DECISIONES.md §(Post-F9.22)`):** *"tenemos dos tipos de proveedores… esto aplica para todo tipo de proveedores (maquila, arte, avíos, servicios, telas, etc)… para los que no, todo se tiene que meter manual"*. La bandera `Proveedor.factura` **ya existía** desde F1-E1B (R15 §4, casilla *"¿Emite factura (CFDI)?"* con la regla `factura ⇒ RFC + régimen`); lo que faltaba es que **MANDARA**. Ahora decide el camino desde **un solo lugar** del dominio (`terceros/facturacion-proveedor.ts`) — la distinción es del **tercero**, no del documento, así que queda lista para cualquier flujo futuro. **Tres estados, no dos:** `factura` (camino fiscal), `sin-factura` (todo a mano) y **`no-definida` (NULL)**, que son los **migrados de Access** y se tratan **como los que facturan** — tratarlos como informales habría apagado en silencio la lectura de facturas de casi todos los proveedores que ya existen. **En la entrada de tela:** al informal se le esconde el lector de XML y se le quita la opción *Factura* (queda **remisión**), y el **servidor lo rechaza igual** (esconder no es impedir, A4); **pero su CxP nace igual**, **NO fiscal**, por la suma de `cantidad × precio` de cuerpo **y complemento** — si esperáramos su factura, esa deuda no se registraría **nunca** (el motor de terceros ya distinguía fiscal/no fiscal desde F9: es el mismo criterio del fold de EsMa). **Sin precios capturados no se inventa una deuda de cero.** Si se lee un CFDI de alguien marcado "no factura", **leer avisa** (el XML prueba que sí timbra) y **guardar rechaza**: la casilla la define quien da de alta al proveedor, no se corrige sola. **SIN migración, SIN permisos, SIN seed** → no requiere `SEED_ON_START`. **Pendiente de captura (Daniel):** revisar la casilla de los proveedores migrados.
- **Depurar el catálogo de proveedores: solo los de 2025-2026 ✅ (10-ago-2026, petición de Daniel — `DECISIONES.md §(Post-F9.23)`):** *"hay demasiados proveedores con los que ya no se trabaja… solo vamos a jalar esos proveedores y corregirlos porque les falta mucha información"*. El Access acumuló **1,052 fichas** de terceros en ~20 años (443 Proveedores + 69 Cortadores + 496 Maquileros + 44 Estampadores); con movimiento **desde 2025** quedan **155** (92 comerciales, 5 cortadores, 58 talleres): **se depura el 85 %**. **La regla es "movió algo", no "está en el catálogo"** — ninguna bandera `Activo` del viejo (nadie la mantuvo), sino los documentos con fecha: `OrdCompra` para el comercial, `Corte` para el cortador y `Entregas`/`Recibos`/`Notas`/`EntregasEst`/`RecibosEst` para el taller. **⚠️ HALLAZGO: `Estampadores.csv` es un catálogo MUERTO** — `EntregasEst`/`RecibosEst` traen la columna `IdMaquileros` pero apuntan a **Maquileros** (de los 15 ids que estampan en 2025/26, 14 están en `Maquileros` y **ninguno** en `Estampadores`): quien estampa es un taller, y el ETL venía creando 44 proveedores que nadie usa. **Nada se descarta en silencio** (plan §7): cada depurado sale en el reporte con nombre, fuente e id viejo. **Lo que falta capturar a mano** (el Access nunca lo tuvo): todo lo fiscal y comercial está al 0 % — `¿Emite factura?`, RFC, régimen, uso de CFDI, retenciones, crédito, banco/CLABE, lead time; `migracion/analisis/proveedores-depuracion.ts` escribe un CSV con los 155 y las columnas vacías para llenarlo cómodo. SIN migración, SIN permisos, SIN seed.
- **La migración lleva SOLO 2025 y 2026 ✅ (10-ago-2026, Daniel + Gabriel — `DECISIONES.md §(Post-F9.24)`):** sube a regla de TODA la migración lo que §Post-F9.23 había hecho solo para proveedores. **Un solo interruptor, `ETL_DESDE`** (`ETL_DESDE=2025` = corte al 1-ene-2025, no depende del día en que se corra); convive con el `ETL_VENTANA_ANIOS` de F4 y **gana** cuando vienen los dos; **sin ninguna de las dos NO recorta** (todo sigue igual que hasta hoy). El mismo interruptor alimenta la depuración del catálogo, para que documentos y proveedores no puedan desalinearse. **El corte se aplica en los documentos ANCLA** y, desde el 11-ago, en **siete loaders más** que no cuelgan de la orden (IPT, los cuatro conceptos de EsMa, productividad, muestrarios y cíclico) — el mapa real está en §Post-F9.24; decir "solo en los ancla" era falso: `Pedidos` (por `FechaPedido`) y **`Ordenes` (por `Fecha`), que arrastra todo lo demás** — cortes, envíos, recibos, RC, auditorías, comentarios y costos cuelgan de la orden; se poda también `OrdenesDet` para no pre-crear colores y tallas de 20 años de órdenes que no van a migrar. **Un DOCUMENTO sin fecha legible SE QUEDA** (al revés que un tercero dudoso: un tercero se re-da de alta en un minuto, un documento tirado no se recupera). **Qué queda:** órdenes 5,451→**262** · pedidos 1,529→**112** · EsMa 11,369→**384** · OC 7,978→**554** · proveedores 1,052→**155**. **⚠️ Consecuencias que Gabriel debe tener a la vista: `CC_Auditorias` (488, la última de 2017) y `PedidosReales` (161, el último de 2010) quedan en CERO** — Calidad arranca vacío y Pedidos Reales no migra nada (la función se dejó de usar hace 16 años); e `IPT_Movs` también, resuelto en §Post-F9.25. SIN migración, SIN permisos, SIN seed.
- **El almacén de PT arranca en CERO, y recuerda de qué orden vieja salió ✅ (10-ago-2026, Daniel — `DECISIONES.md §(Post-F9.25)`):** *"el almacén de PT empieza también desde cero… será bueno incluir un campo de orden de producción para saber qué orden anterior es la que se fabricó, para poder consultar en Control viejo"*. Cierra el pendiente que dejó abierto §Post-F9.24: `IPT_Movs` (5,072 cabeceras de 2020-2023, la última de 2023) no aporta nada con el corte, así que el inventario de PT **arranca del conteo físico**, igual que el de telas. **El campo es `MovimientoDetPt.numOrdenV1`, TEXTO y opcional**: la FK `idOrden` que ya existía solo puede apuntar a órdenes que viven en v2 (262 de 5,451), y lo que está hoy en el anaquel lo fabricaron órdenes **viejas**. **NO entra en la llave de existencia** (modelo×color×talla×orden×almacén) — es una nota de consulta, y fragmentar el stock por ella habría partido en pedazos el inventario de arranque. Se captura **una vez por movimiento** y se replica a cada color; **el inverso lo hereda**; el kardex muestra la orden de v2 si existe y si no el número con la marca *"(Control viejo)"*. **NO hacen falta campos temporales de modelo/color/talla** (Daniel lo planteó): el corte aplica a DOCUMENTOS con fecha, no a los catálogos — los **4,987 modelos** migran completos y colores y tallas vienen de sus propias tablas. 1 migración aditiva, SIN permisos → **no requiere `SEED_ON_START`**.
- **Archivo histórico de órdenes: la historia se consulta, no se opera ✅ (10-ago-2026, idea de Daniel — `DECISIONES.md §(Post-F9.26)`):** *"me gustaría tenerlas también como archivo histórico de órdenes… para poder buscar por cliente, número de modelo, tipo de prenda, fecha de producción, maquilero, etc."*. **Lo que lo hace barato es que sea de SOLO LECTURA:** tres tablas planas (`HistoricoOrdenV1` + líneas + procesos), sin folios, sin estados, sin kardex, sin permisos de operación. **Dos reglas lo mantienen inocuo:** (1) **los terceros van como TEXTO**, resueltos UNA vez al migrar leyendo los CSV del viejo — un taller que no sobrevivió a la depuración aparece escrito y **no revive** como `Proveedor`; (2) **la única FK de verdad es al `Modelo`**, que es lo que permite filtrar por tipo de prenda y género sin duplicar esos campos (y la razón de no depurar el catálogo de modelos). **Se carga:** **las 5,451 órdenes** del viejo · **39,853 celdas** color×talla · **35,296 movimientos** de los cinco documentos de producción (corte 6,967 · entregas 7,334 · recibos 12,440 · entregas est. 4,496 · recibos est. 4,059) = **80,600 renglones**. *(Al principio eran 3,923: las de las 6 empresas viejas que no migran se saltaban; **Daniel mandó rescatarlas el 11-ago** — ver la viñeta de §Post-F9.29.)* **Dónde se ve:** *Producción › Archivo de órdenes*, con los filtros que Daniel pidió textualmente (cliente, modelo, tipo de prenda, fecha de producción y maquilero) más búsqueda libre; el número abre la ficha con la matriz color×talla y quién la trabajó. **El archivo NO tiene ventana de años: van también las 262 que migran como operativas** — una orden reciente aparece en los dos lados **a propósito**: viva en Producción y buscable en el archivo, para que la respuesta no cambie el 1 de enero. **No se normalizan los colores** (el viejo los guardaba como texto libre: adivinar equivalencias entre casi 40,000 celdas metería errores silenciosos) y **no hay escritura**: el dominio solo expone `listar`/`obtener` y el ETL escribe con Prisma directo (excepción consciente a A1 — no hay regla de negocio que proteger). Permiso REUSADO `ordenes.ver`. 1 migración aditiva (3 tablas + 1 enum), **cero permisos, cero seed**. **⚠️ El ETL NO corre solo:** después del deploy hay que correrlo a mano desde `backend/` — `npx tsx --env-file=.env migracion/etl-historico-ordenes.ts` (va después de `etl-catalogos`, que le da los mapeos de Empresa y Modelo; es idempotente y re-correrlo **completa** lo que una corrida interrumpida haya dejado a medias). Cómo quedó construido: `docs/modulos/archivo-historico.md`.
- **En el archivo van TODOS los talleres, no solo el primero ✅ (10-ago-2026, corrección de Daniel — `DECISIONES.md §(Post-F9.27)`):** *"está bien lo que comentas, excepto el tema de maquilero. Sí es importante que vayan todos. Y no solo el primero. Lo mismo para estampadores. Pero lo puedes poner en un campo abierto, donde sí pueda encontrarlo, pero no esté ligado a nada"*. La primera versión mostraba el maquilero de la **cabecera** (`Ordenes.IdMaquileros`), que es solo el **asignado**: en el taller una orden **pasa por varios** —se corta en uno, se cosen partidas en dos o tres, se estampa en otro—, así que buscar *"¿qué le hemos mandado a este taller?"* dejaba fuera a la mayoría. Ahora hay **tres columnas de texto abierto** con los nombres DISTINTOS de cada rol separados por `" · "`: `cortadores` (de `Corte`), `maquileros` (de `Entregas`+`Recibos`) y `estampadores` (de `EntregasEst`+`RecibosEst`). El **listado** muestra los de costura (lo que se busca a diario) y cae al asignado si la orden no tuvo movimientos; la **ficha** muestra los tres roles (*Cortaron · Cosieron · Estamparon*); el **filtro de taller busca en todos lados** (cabecera + los tres campos + los propios movimientos). **Se ordenan alfabéticamente a propósito:** el orden de los CSV no es estable, y un archivo cuyo texto cambia entre corridas no se puede comparar. **Duplicar lo que ya está en los procesos es deliberado** —se ven en el renglón y se buscan sin un subquery por fila— y aquí no cuesta nada: el archivo es **inmutable** (se llena una vez y no se edita). La migración del archivo se **regeneró** con las tres columnas incluidas (no había corrido en ningún ambiente). SIN permisos, SIN seed.
- **Directorio histórico de terceros: la libreta, fuera del catálogo ✅ (10-ago-2026, pregunta de Daniel — `DECISIONES.md §(Post-F9.28)`):** *"al no pasar la información de los maquileros, ¿qué hacemos si quisiera encontrar algún teléfono o nombre?… ¿podríamos guardarlo en algún otro repositorio que no sea el catálogo de proveedores?"*. La depuración (§Post-F9.23) deja fuera del catálogo **~897 de 1,052** terceros — que es lo que se quería, que no estorben al capturar—, pero su **teléfono y su dirección siguen sirviendo**. La respuesta es `DirectorioTerceroV1`: una **libreta de direcciones**, no un catálogo — **no sale en NINGÚN selector de captura**, no tiene roles ni `activo` ni FK a nada, es de **solo lectura** y **no hay —ni habrá— botón de "convertir en proveedor"** (ese botón sería la puerta trasera por la que volvería la basura recién depurada: si un taller vuelve, se da de alta LIMPIO copiando de aquí lo que sirva). **Entran todos, también los 155 que sobrevivieron**, marcados con `enCatalogo`, para que la libreta sea la foto completa del Access y nadie tenga que preguntarse en cuál de los dos lados buscar. **Lo que la hace útil** más allá del teléfono: la **última actividad** (fecha del último documento suyo en el viejo) y **cuántos documentos** tuvo — *"¿hace cuánto que no trabajamos con este, y qué tanto?"*, que es lo que decide si vale la pena volver a llamarlo; y **se busca también por TELÉFONO** (a veces se llega al revés). **Son 1,046 de las 1,052 fichas:** doce no traen nombre y **seis se recuperan por su clave corta** (`Corto`) — entre ellas Bordaprint, Fit Print y Eurobordados, con teléfono y dirección reales; las 6 restantes son cascarones sin un solo dato y se descartan **listándolas en el reporte** (corregido en la revisión del 11-ago: antes se caían en silencio). Vive en *Catálogos › Directorio histórico*, junto al catálogo pero claramente separado (*"solo consulta; NO es el catálogo"*). Permiso REUSADO `proveedores.ver`, cero seed; 1 migración aditiva. **Se llena con el MISMO ETL del archivo de órdenes** (`etl-historico-ordenes`), que también se corre **a mano** después del deploy. Ficha del módulo: `docs/modulos/archivo-historico.md`.
- **El archivo lleva TODAS las órdenes; la empresa vieja se guarda escrita ✅ (11-ago-2026, decisión de Daniel — `DECISIONES.md §(Post-F9.29)`):** *"sí, está bien, rescata todas y solo pon en algún lugar la empresa a la que correspondía"*. El archivo cargaba **3,923 de las 5,451** órdenes: las que no tenían empresa mapeada se saltaban, y **las 6 empresas viejas no migran** (decisión de Gabriel del 17-jun, ver §6) — se caían **1,528 órdenes** con **10,497 celdas** y **9,204 movimientos**, y era justo **la historia más vieja** (**1,523 de 2005-2012**), o sea la razón de ser del archivo. Ahora se cargan **las 5,451** (**39,853 celdas · 35,296 movimientos = 80,600 renglones**): las de empresas extintas **cuelgan de la empresa principal** —`idEmpresa` es FK real y el listado filtra por la empresa activa (A9), así que colgarlas de una empresa que nadie tiene activa sería rescatarlas para que nadie las vea— y **conservan escrita** su empresa en la columna nueva `empresaV1`, en TEXTO y ligada a nada (mismo criterio que los talleres de §Post-F9.27). **La principal es FR Moda** (la del seed F0, la favorita, la que el resto del ETL usa para los almacenes; Marilyn Fitness es la MISMA empresa renombrada): el loader la resuelve por nombre → favorita → primera del mapeo (determinista, para pruebas). **Lo que ya mapeaba su empresa se queda en la suya** (rescatar no es reasignar) y **`empresaV1` se llena SIEMPRE**, también en las activas — si solo lo trajeran las rescatadas, un vacío sería ambiguo. Se ve en la **ficha** de la orden (*Empresa (Control viejo)*, no como 9ª columna del listado) y **se busca desde la caja libre**: como todas comparten `idEmpresa`, ese texto es la única forma de volver a juntar la historia de una empresa extinta. El ETL ya no reporta "omitidas" sino **cuántas rescató y de qué empresa vieja**, agrupado (plan §7). La migración del archivo se **regeneró** con la columna (no había corrido en ningún ambiente); aditiva y nullable, **SIN permisos, SIN seed**. **Cierra la deuda** que §Post-F9.26 había dejado en §4.
- **El re-volcado del go-live: dos causas arregladas y tres deudas ASUMIDAS con razón ✅/⚠️ (11-ago-2026, a raíz de Daniel: _"cuando pongamos en producción, subiré las bases de datos de ese momento para migrar la última info"_):** una auditoría de los 17 ETL encontró que ese segundo volcado, tal como estaba, **no funcionaba**. Se arreglaron en código las dos causas graves y se escribieron las **reglas de go-live** (`backend/migracion/README.md` §Reglas de go-live + la ficha `docs/hoja-de-ruta/F10-etapas.md`).
  **Arreglado (C1) — la colisión de folio silenciosa:** los cinco loaders con folio propio (`Pedido`, `Orden`, `OrdenCompra`, `NotaSalida`, `Auditoria`) resolvían "ya existe" por `(idEmpresa, folio)` y, al encontrarlo, **mapeaban la clave vieja a ese documento y salían como `existente`**. Sobre base limpia eso recupera una corrida cortada entre el `create` y el `guardarMapeo`; sobre la base viva del go-live **casaba dos documentos distintos** (la orden 8001 que v2 capturó vs. la 8001 que el Access numeró por su cuenta) y, con el mapeo escrito, **todos los hijos del volcado nuevo** —cortes, envíos, recibos, cargos EsMa, costos, RC, auditorías— **se pegaban a la orden equivocada**: WIP inflado, cargo al maquilero que no fue. Y el desenlace era `existente`, o sea **sin reporte, sin excepción, sin conteo anómalo**. Ahora `backend/migracion/comun/colision-folio.ts` distingue por dos señales exactas —¿el documento ya es DESTINO de otro mapeo? ¿lo creó el ETL (`creado_por_id = 'etl-sistema'`)?— y ante la duda **no mapea: reporta**. Los casos se cuentan aparte de los `existentes` y salen listados con folio, clave vieja e id de v2. **Y desde la revisión del 11-ago son DOS avisos distintos, no uno** (`DECISIONES.md §Post-F9.30`): el **duplicado en el ORIGEN** —el Access trae dos documentos con el mismo folio; medido: **4 pares de `NumCompra` repetidos** en la empresa 8 con fecha de 2026, dos de ellos con proveedores distintos— **no dice nada de la base de v2**, mientras que la **colisión con V2** sí significa *"la base no estaba limpia, para"*. Reportarlos con el mismo texto y el mismo contador era darle a Gabriel un diagnóstico falso en la mitad de los casos; ahora cada uno tiene su sección de reporte, su contador y su línea de consola, y el aviso dice **qué se queda fuera con la fila que no entró** (sus renglones; en OC además sus ligas a órdenes y sus recepciones). **Ante folios duplicados entra CUALQUIERA de los dos** y el otro se reporta: Daniel — *"mete la que sea… es irrelevante para mí"* —, así que **no se construye** la regla de "la de mayor monto" (exigiría una pre-pasada en los cinco loaders solo para cambiar cuál gemelo entra). **Y la mitigación del caso feo va por proceso, no por código:** si una corrida se **interrumpe**, se **vacía la base y se empieza de nuevo** (README, Regla 1) — retomarla puede mapear la fila `A` a un documento creado con los datos de su gemela `B`. **Los cinco ETL que no imprimían la ventana ya la imprimen** (`etl-produccion` —que sí recorta, por los cargos EsMa—, `etl-calidad`, `etl-costos`, `etl-ruta-critica` y `etl-historico-ordenes`, este último avisando que la **ignora a propósito**): el runbook mandaba verificar en el log un dato que en cinco de once no existía.
  **Arreglado (C2) — dos loaders ignoraban `ETL_DESDE`, y la doc afirmaba lo contrario:** `loaders/ipt-kardex.ts` (kardex de PT) y los **movimientos planos de EsMa** (`loaders/esma-cargos.ts`: abonos/descuentos/pagos) no dependen de la orden y no leían la ventana. Con el corte de 2025-2026, el primero cargaba igual las **5,072 cabeceras `IPT_Movs` de 2020-2023** (los movimientos del kardex son sus renglones de `IPT_MovsDet`, más) → el kardex de PT (existencia = Σ movimientos, D3) quedaba **inflado** con partidas de hace años, invisibles porque van con el color/talla sentinela; el segundo habría metido **554 abonos + 743 descuentos + 5,935 pagos COMPLETOS** contra los cargos de apenas **384 cabeceras EsMa** del periodo → saldo de cada maquilero **masivamente negativo**, como si a todos se les hubiera pagado de más 16 años. Ambos recortan ya por la fecha de su documento (`IPT_Movs.Fecha` · `EsMa.FechaEsMa`), y **EsMa recorta por la MISMA fecha en los cuatro conceptos** (cargos incluidos) para que la cuenta corriente quede lo más coherente posible — **pero no del todo, y así se dice ahora**: el cargo necesita ADEMÁS el mapeo de su orden, así que una cabecera EsMa de 2025 con recibo de una orden de 2024 pierde su cargo mientras sus abonos/pagos sí entran (sesgo residual a lo negativo). Esos cargos se cuentan aparte (`sinMapeoOrden`) y salen en el resumen de la corrida (11-ago-2026). En la misma auditoría aparecieron **tres huecos más del mismo tipo**, también arreglados: **productividad IP y de almacén**, **muestrarios** y el **cíclico histórico Proscai** (KPIs, no saldos — el daño era menor, pero la migración lleva solo 2025-2026 y traían 16 años).
  **Deuda ASUMIDA, con su razón (⚠️ NO se arregla — la razón es la Regla 1: en producción el ETL de documentos corre UNA sola vez, sobre base limpia, y no se construye un modo "actualizar"):** (a) **el BOM de modelos y la Ruta Crítica se REEMPLAZAN al re-correr** (borran y rehacen su detalle) → pisarían lo editado en v2; (b) **los cambios a documentos ya migrados no se recogen** — una orden que en el Access nuevo se canceló, una OC que cambió de estatus o un costo recalculado **no actualizan** la fila ya migrada (el loader ve "ya existe" y sale): el ETL trae lo NUEVO, no reconcilia lo viejo; (c) **el mapeo de renglones de pedido es POSICIONAL** (`loaders/pedidos.ts`): al retomar un pedido existente casa cada `IdPedidosDet` con el renglón de v2 **por orden de creación**, así que un renglón insertado o borrado en v2 corre el emparejamiento. Las tres solo existen al re-volcar encima de una base viva; con la Regla 1 no pueden ocurrir, y si alguien la rompiera, el guardia de colisión de folio lo grita en la primera orden.
- **Deuda de paridad front/back — los 10 catálogos de uso general se ven en el menú pero el backend los gatea (descubierta 12-ago-2026, al destapar el menú de Inventarios):** en `frontend/src/modulos/catalogo.ts` **diez catálogos (once hojas)** llevan `permisos: 'autenticado'` —**colores, tallas, temporadas, almacenes, clientes (catálogo), proveedores, etiquetas de marca, bordados (que son DOS hojas: el catálogo y su galería), telas y avíos**— pero **el backend sí exige su permiso** en el endpoint de listado (`GET /colores` → `colores.ver`, `GET /telas` → `telas.ver`, `GET /avios` → `avios.ver`, etc.). Consecuencia real: a un rol sin permisos (el básico del seed, `prisma/seed.ts`, `permisos: []`) el riel le pinta entradas fijas —**4 de ellas dentro del padre «Catálogos base»**, más Telas y Avíos desde hoy— que al abrirlas **dan 403**. **Por qué NO se arregló aquí:** el `'autenticado'` es un **pedido explícito de Daniel** de la etapa A2 (*"que el catálogo de telas siempre se vea en el menú, **como los demás catálogos de uso general**"*), así que no es un olvido sino una decisión suya que hoy choca con lo que el servidor hace; y arreglar **solo 2 de los 10** —que fue el primer intento de esta etapa, revertido— habría dejado una excepción sin razón: esconder Telas/Avíos mientras se siguen mostrando Colores, Tallas, Temporadas y Almacenes. **Se resuelve parejo o no se resuelve**, y la decisión es de Daniel, con dos caminos limpios: (1) **alinear el front** (los 10 pasan a su `<catálogo>.ver`) → el menú deja de mentir, pero un rol de consulta pierde de vista catálogos que él quiere visibles; o (2) **alinear el backend** (que el LISTADO de los catálogos de uso general sea `autenticado` y solo la escritura pida `*.administrar`) → se respeta su pedido y desaparecen los 403, a costa de abrir la lectura de esos catálogos a cualquier sesión. Nótese que la pantalla que esconde **nunca fue la protección** (A1: el servidor decide); esto es calidad de la experiencia, no un hueco de seguridad. Sin fase asignada — llevarlo a Daniel junto con la pregunta de los hubs `/catalogos` e `/inventarios` (ver `docs/cambios-frontend-daniel.md`).
- **Dar de baja el faltante NO cierra el pendiente del WIP contra el maquilero (V1-E4b, 17-ago-2026):**
  las prendas que se quedan vivas en **Tránsito** —el faltante que Daniel quería poder ver— se dan de baja
  con un movimiento manual de PT, con motivo y auditoría. Pero eso **no salda** lo que el tablero de WIP
  le sigue reclamando al maquilero: cerrarlo exigiría un **quinto `TipoEtapaMovimiento`** y rehacer la
  aritmética de pendientes en ~6 lugares (`wip.ts`, `recibos.ts`, contrato y frontend). **La limitación es
  PREEXISTENTE** —hoy tampoco se puede cerrar un pendiente sin recibir— y por eso es deuda y no defecto de
  la etapa; se dice para que nadie la descubra como sorpresa. **Consecuencia a conocer:** kardex y WIP
  llevan el mismo saldo por caminos distintos y **nada los reconcilia**.
- **`Almacen.esTransitoProceso` solo la administra el seed, no hay pantalla (V1-E4b):** es el mismo patrón
  de los `TipoMovimientoInventario` por código (`entrada-maquila`, `transferencia-salida`) — filas de
  catálogo críticas que la UI no toca. **Consecuencia:** si el estado queda inválido, se arregla con SQL a
  mano o re-sembrando —aunque desde V1-E4b la base **impide** que haya dos (índice único parcial), así que
  el estado inválido que antes solo se detectaba ahora es imposible—. Se consideró
  `ConfiguracionEmpresa.idAlmacenTransito` (lo habría dejado dentro del alcance de la aplicación) y se
  prefirió la bandera porque el almacén **ya existía** en el catálogo y no pedía pantalla de configuración
  nueva. *(Corrección: la primera redacción de esta deuda citaba `Almacen.idCortador` como precedente de
  "campo del almacén que la UI no toca". **Es falso** — `DialogoAlmacen.tsx:179` lo pinta como select y lo
  manda al crear y al editar. El precedente válido es el otro: los `TipoMovimientoInventario` por código.)*
- **⚠️ `codigoRolProveedor` ata proceso↔rol POR TEXTO, sin FK (V1-E3f, 18-ago-2026):** el selector de
  proveedores del arte acota por rol resolviendo la **coincidencia del `codigo`** entre `TipoProceso` y
  `RolProveedor`. **El reviewer lo aceptó, pero rechazó la razón que se dio** (*"degrada con gracia"*):
  degradar a ofrecer **TODOS** los proveedores es un **ensanchamiento silencioso** — nadie ve nada raro,
  solo una lista más larga. Lo que sí lo sostiene es que **la identidad de códigos ya no es universal y
  el repo lo sabía**: `recibos.ts:96-102` tiene un `MAPEO_PROCESO_A_ROL` escrito a mano porque `costura`
  mapea a `maquila-costura`. Es decir, el acoplamiento invisible funciona **justo en los cuatro que son
  arte** y se rompe en el único que no lo es. Y el `codigo` **sí** es editable por UI
  (`actualizarTipoProceso`), así que el riesgo no es teórico. Daño tope: el selector deja de acotar — no
  corrompe dato, no cruza empresa, no toca inventario. El campo ya está en el contrato, así que **meter
  la FK después no rompe consumidores**. **Atarlo a la etapa de proveedores**, que de todos modos toca
  `RolProveedor`.
- **`SelectNativo` de proveedor con tope de 100: barrido en 8 pantallas, pero SIGUE VIVO en otras
  (V1-E3f):** con más de 100 proveedores, el que buscas **no aparece** — es la cuarta vez que este mismo
  defecto sale en el proyecto. V1-E3f lo convirtió a `ComboboxBuscable` (que **sí** busca contra el
  servidor, verificado) en ocho pantallas, pero quedan al menos `notas-salida/DialogoEditarNota.tsx:94`,
  `ordenes-compra/DialogoEditarOc.tsx:94`, `inventarios/CapturaEntradaTelaPagina.tsx:108`+`:517` (el tope
  de 100 vive en `api/proveedores.ts:230`) y los filtros
  de maquilero de producción y calidad. Fuera del alcance de esa etapa — **se dice, no se calla**.
- **El impreso de la orden descarga TODAS las fotos de arte aunque pinte 4 (V1-E3f, 18-ago-2026):** con
  las fotos en plural, `armarDatosImpresoOrden` presigna y baja de R2 **todas** las fotos de todos los
  artes, y la rejilla recorta después (`impreso-orden.ts:418-425`, `:455`). En impresión **por lotes**
  —`impresoOrdenes` recorre las órdenes **en serie**— eso son cientos de viajes a R2 antes de que arranque
  el worker de PDF. **Degrada en lentitud, no en fallo** (la descarga ocurre fuera del
  `PDF_WORKER_TIMEOUT_MS`) y **no lo introdujo esa etapa**. Ahora que `porRondas` deja las importantes al
  frente, recortar **antes** de descargar es viable — pero **no es la línea única que parece**: el conteo
  *"se muestran 4 de 7"* se calcula del total y habría que llevarlo aparte, y las fotos que fallan al
  bajar se descartan **después**, así que el recorte necesita margen.
- **⭐ El MRP NO desglosa la compra por medida — la instrucción "pide el cierre de 53" no le llega al
  proveedor por el sistema (declarada en V1-E3g, 18-ago-2026):** el `schema.prisma` **promete** que
  *"la compra/MRP desglosa por medida×talla"* y **no está implementado** — verificado por el coder y
  reconfirmado por el reviewer: **cero referencias a `idAvioMedida` en `src/dominio/compras/`**. La orden
  de compra sigue saliendo con **una línea agregada por avío**. Es **anterior** a V1-E3g y por eso no la
  bloqueó: esa etapa hizo lo que prometía —cerrar la ambigüedad **en el origen**, dejando la medida como
  dato limpio y numérico—, que es justamente lo que hace viable el desglose. **Es el siguiente paso
  natural de lo que Daniel pidió**, y sin él la mitad del valor de capturar la medida se queda en el
  sistema. Relacionado: el **impreso de la orden tampoco muestra la medida por talla**
  (`impreso-orden.ts` solo imprime `consumoPorPrenda`) — cambiar el PDF pide el visto bueno visual de
  Daniel.
- **No hay aviso para "cierre sin medida amarrada en una talla" (V1-E3g):** `tallasSinMedida` sólo cubre
  el caso `consumoPorTalla`. Se dejó fuera **a propósito** —el encargo prohibía construir avisos nuevos,
  justo para no duplicar el que ya existía— y se declara aquí en vez de callarse.
- **Índice de una página de las decisiones, para el GO-LIVE (pedido por Daniel, 18-ago-2026):** una línea
  por decisión con su enlace, para poder repasarlas sin abrir un archivo de 3,000+ líneas. Daniel lo
  quiere **cuando salga el primer producto a producción**, no antes — *"más adelante… pero cuando lancemos
  el primer producto a producción"*. Se anota aquí para que no se pierda entre etapas.
- **⚠️ `unicidadDeCampo` NUNCA devuelve `true` con el driver adapter de Prisma 7 — y la misma suposición
  decide en Ruta Crítica (descubierto en V1-E3f pieza B, 18-ago-2026):** `comun/prisma-errores.ts:44-50`
  busca `meta.target`, pero con `@prisma/adapter-pg` el error P2002 **no trae esa llave**: la información
  viaja en `meta.driverAdapterError.cause.constraint.fields`. En proveedores se arregló; **el mismo defecto
  sigue vivo en `dominio/ruta-critica/hitosOrden.ts:161-176`**, donde `esViolacionHitoVivoUnico` también
  devuelve **siempre `false`**, así que la carrera sobre `hito_orden_vivo_unico` **no se traduce al
  `ErrorConflicto` que su comentario promete**. Es de la época de F5 y **no muerde en la v1 porque la RC
  está apagada** — por eso es deuda y no bloqueante. ⚠️ **Y su prueba FABRICA el error con `meta.target` a
  mano** (`hitosOrden.test.ts:32`): el mismo patrón del fixture inventado que ya costó un rechazo en esta
  tanda — *una prueba que confirma la suposición de quien la escribió en vez de cazarla*. Al arreglarlo,
  la prueba tiene que construirse contra un P2002 **real**.
- **🔴 Un parpadeo de red SACA AL USUARIO A LA PANTALLA DE LOGIN (descubierto 19-ago-2026, al diagnosticar
  un e2e flaky):** `sesion/ProveedorSesion.tsx` consulta la sesión con **`retry: false`** y luego hace
  `consulta.data?.autenticado ? … : null`. Un **401 legítimo** se maneja bien — pero **cualquier otro
  fallo** (500, corte, timeout) deja `data` en `undefined` → `sesion = null` → `RutaProtegida` hace
  `Navigate to="/login"`. **No distingue "no hay sesión" de "no pude preguntar".**
  ⚠️ **Importa especialmente en Railway**, donde los baches de conexión están documentados (§8 de
  `CLAUDE.md`: el backend arranca antes que Postgres y hubo que hacer el entrypoint resiliente). El
  usuario pierde lo que estaba capturando por un parpadeo.
  **Cómo se descubrió:** `pedidos.spec.ts:193` es **flaky crónico en `prueba`** —falla el intento 1 y se
  salva con el reintento en las 3 corridas del 18-ago— y el patrón es **binario, no gradual** (quema los
  10 s enteros o encuentra el encabezado al instante), lo que apunta a *aterrizó en otra pantalla*, no a
  *tardó*. **NO está confirmado**: la traza de Playwright vive en un artefacto que el sandbox no puede
  descargar. **Para confirmarlo bastan 5 minutos con internet**: bajar `playwright-report` del run
  32209748934 y mirar la URL del screenshot. Mientras tanto, el e2e afirma primero la URL para que el
  fallo **diga dónde acabó** en vez de "element(s) not found".

- **DEUDA de V1-E3h (19-ago-2026) — no existe "des-liberar" explícito.** La única forma de revocar una
  firma puesta por error es **tocar el contenido del renglón** (editarlo o restaurarlo), que es lo que
  dispara el re-cierre. Funciona, pero obliga a un cambio real para deshacer un clic. No lo pedía
  §Post-F9.72; si Daniel lo quiere, es etapa aparte.
- **DEUDA de V1-E3h — la puerta de la OC a mano bloquea de más, a propósito.** Mira **todas** las líneas
  de la orden en esa OC, no solo las que se agregan (`dominio/compras/ordenes-compra.ts:522-543`), para
  conservar la protección de V1-E3d y que un material fuera de la receta no sirva de caballo de Troya. El
  costo: **agregar una línea de un material ya firmado se bloquea si otro renglón de esa orden se
  re-cerró**. Decisión escrita en `DECISIONES.md §Post-F9.76`.
- **DEUDA de V1-E3h — fricción de dos pasos en el panel de la orden.** En una orden recién creada (todos
  los renglones `sin_revisar`), los botones de firmar **rebotan** hasta que se pulsa «marcar todo
  revisado». Es el comportamiento de V1-E3d extendido a los botones nuevos y el mensaje nombra la salida,
  así que **no se bloqueó**; pero si Daniel se topa con ello, la respuesta es *"así se decidió"* — y la
  bandeja sí lo resuelve en un acto (`DECISIONES.md §Post-F9.75`).

- **DEUDA de V1-E3i (19-ago-2026) — `refetchOnReconnect: 'always'` sin prueba.** Lo declaró el coder. El
  resto del camino de sesión sí quedó cubierto y mutado.
- **DEUDA de V1-E3i — la siembra de la plantilla de C&A solo tiene cobertura de INTEGRACIÓN**, y esas
  pruebas son **dependientes del orden** dentro de `seed.int.test.ts` (la de idempotencia se apoya en el
  cliente que creó la anterior). Funciona, pero es frágil: si alguien reordena el archivo, se cae sin que
  el defecto esté en el código.
- **DEUDA de V1-E3i — si C&A ya tuviera una plantilla de Excel (R8) vigente en `prueba`, el seed NO la
  toca** (a propósito: nunca pisa lo que configuró una persona) y **el 7% seguiría sin operar**. La única
  señal es una línea en el log del arranque. Hay que confirmarlo en `prueba` tras el `SEED_ON_START=true`.
  ⚠️ Y como la lista cerrada acepta `ca` pelón, vale una ojeada al catálogo real por un falso positivo.

- **DEUDA de V1-E3i — 🔴 el importador de EXCEL puede tumbar el 7% de C&A, en silencio.** Guardar un
  formato Excel para ese cliente (`ImportadorPedido.tsx:207-212` → `guardarPlantilla`) manda solo `{mapeo}`,
  así que `formato` cae a `excel` y el porcentaje a `0`; y `guardarPlantilla` **no edita: baja la vigente y
  crea una versión nueva**. Desde ese instante `leerConfigPlantillaPdf` exige `formato === 'pdf-cya'` y
  vuelve a **0%** — el 7% deja de operar sin aviso, y **el seed no lo repara nunca** porque solo siembra
  cuando el cliente no tiene ninguna plantilla. **Por qué no se arregló en V1-E3i (razón de diseño, no
  "menor"):** la vigencia **única por cliente** es arquitectura preexistente de R8, compartida por los dos
  importadores y documentada así en `schema.prisma:1195`; hacerla **por formato** exige migración y cambio
  de dominio, fuera del alcance de una etapa cuyo trabajo era sembrar la plantilla. **Guardarraíl mientras
  tanto:** si alguien guarda un formato Excel para C&A, el 7% hay que reponerlo a mano desde la pantalla del
  importador de PDF.
- **DEUDA de V1-E3i — el `<input>` del % ya tiene prueba de que se ve vacío**, pero la mitad visible de
  *"0 no es vacío"* vive solo ahí: si mañana alguien lo pinta como `0`, la pantalla mentiría sobre lo que se
  va a aplicar. Cazado por mutación en la tercera vuelta; se anota para que no se "simplifique".
- **VERIFICACIÓN DE DESPLIEGUE de V1-E3i (no es deuda de código):** tras `SEED_ON_START=true` en `prueba`,
  confirmar que C&A quedó con su plantilla **`pdf-cya` vigente al 7%**, y revisar el catálogo real de
  clientes por un falso positivo de la lista cerrada (`ca` pelón cazaría un «C.A.»).

- **DEUDA de V1-E3j (19-ago-2026) — la fecha de entrega se pinta en crudo** (`2026-09-30`) en el encabezado
  de la receta y en la bandeja, mientras el resto del sistema usa `formatearFecha` (*"30 sep 2026"*).
  ⚠️ **No se "arregla" a la ligera:** `formatearFecha` hace `new Date('2026-09-30')`, que es medianoche
  **UTC** y en UTC-6 se pinta **29 sep**. Unificarlo exige formatear la fecha-sin-hora **sin** conversión de
  zona; hacerlo mal empeora el dato en vez de mejorarlo.
- **DEUDA de V1-E3j — la explosión del MRP no lleva a la pantalla nueva.** El comprador sigue viendo el
  texto de `DONDE_SE_LIBERA`, que **sigue siendo cierto** (el resumen de la OP lleva ahí), pero es un salto
  manual pudiendo ser un enlace.
- **APRENDIZAJE de V1-E3j, para toda prueba de permisos:** **la validación del cuerpo corre ANTES del guard
  de permiso**. Un payload inválido devuelve **500 en vez del 403** que la prueba cree estar comprobando —
  la forma más silenciosa de que una prueba de seguridad pase por la razón equivocada. Documentado en
  `backend/src/api/produccion/receta-orden.rutas.test.ts`.

- **DEUDA de V1-E3k (20-ago-2026) — la cerca que impide volver a la firma en bloque es por TESTID y por
  REDACCIÓN, no por conducta.** Un botón con otras palabras que hiciera N firmas por renglón pasaría las
  pruebas en verde (verificado por el reviewer). Es el límite honesto de una cerca de pruebas y está escrito
  en `DECISIONES.md §Post-F9.80`: **el servidor sí impide el comodín** —hay que nombrar cada renglón— pero
  nada obliga a un renglón por llamada, a propósito (N llamadas de uno equivalen a una de N, así que la
  restricción sería teatro y cerraría un futuro multi-select). **Volver a ofrecerlo con un botón sería
  re-tomar la decisión de Daniel, no aprovechar un hueco.**
- **DEUDA de V1-E3k — el fixture de `ResumenRecetaOrden.test.tsx` es *load-bearing* y no lo dice.**
  `excluido:false` + `liberadoEn:null` es el único estado en que el botón se pintaría; **relajarlo vacía la
  aserción en silencio** (comprobado por el reviewer). El comentario explica por qué hay una tela, no por qué
  ese estado.

- **PREGUNTA ABIERTA de V1-E3m (20-ago-2026) — la COTIZACIÓN y la COMPRA pueden separarse cuando alguien
  lo decide** *(enunciado corregido: no es que "el precosteo se equivoque", es que el precosteo sigue al más
  barato y la compra al habitual; la divergencia solo nace de una decisión humana explícita, y el día del
  deploy es CERO. La pregunta es de negocio y es de Daniel: ¿la cotización debe seguir a la compra?)*. La etapa cambió
  a quién le COMPRA el MRP (habitual > más barato) pero **no tocó** la cascada de PRECIOS compartida
  (`costos/resolucion-precios.ts`), que sigue valuando el avío sin amarre con «el más barato». Se separó a
  propósito —una responde *"¿cuánto cuesta?"* y la otra *"¿a quién le compro?"*— y **ningún precosteo
  existente cambia** (la bandera nace en `false`). Pero la consecuencia real es que un avío cuyo habitual no
  sea el más barato se **comprará** más caro de lo que se **precosteó**. No es silencioso (es el precio del
  proveedor elegido, visible en la línea de la OC), pero hay que decidir con Daniel si el precosteo debe
  seguir al habitual. Escrito en `DECISIONES.md §Post-F9.82`.
- 🔴 **APRENDIZAJE de V1-E3s (21-ago-2026) — un `<select>` llenado con UNA PÁGINA del catálogo es un
  defecto latente, no una comodidad, y ya va la cuarta vez.** La recepción de compras armaba su
  desplegable con **dos consultas de `porPagina: 100`**: las OC de más abajo eran **INALCANZABLES** desde
  esa pantalla —no incómodas: inalcanzables— y **empeoraba sola**, porque cada OC nueva empujaba a las
  viejas fuera del tope. Es **la misma trampa** que ya se había arreglado por separado en el BOM (V1-E3c),
  en clientes (V1-E4) y en arte/materiales (V1-E3f). **La regla:** donde se elige una entidad de un
  catálogo que crece, va `ComboboxBuscable` en modo `busquedaServidor` (o su envoltorio, p. ej.
  `SelectorProveedor`), nunca un `<select>` alimentado por una página. Y su gemela, que es la que de
  verdad cierra el agujero: **la entidad ELEGIDA se pide POR ID**, no se busca dentro de la página que se
  trajo — mientras la pantalla dependa de que el registro "venga en la lista", el defecto puede volver.
  🔴 **Y el corolario de honestidad:** si por rendimiento se deja un tope, el servicio **devuelve `total` y
  `truncado`** y la pantalla lo **dice** (*"Se muestran 50 de 300"*) con la salida a mano. Un tope que no
  se declara es una mentira que crece sola.
- 🔴 **APRENDIZAJE de V1-E3s — «la más reciente» NO es «el folio más alto» mientras las secuencias sigan
  rotas.** El listado de OC abiertas ordenaba por `numCompra desc` con el comentario *"la más reciente
  primero"*, y en `prueba` eso es **falso**: §Post-F9.85 dejó las secuencias en cero (las OC nuevas
  toman folios 1, 2, 3…) y el ETL migra toda OC histórica autorizada como `autorizada` **sin crear
  recepciones**, o sea **abierta para siempre**. Sumado: la OC recién creada se iba al final y el
  recorte la escondía. **La regla:** para *"lo más nuevo primero"* se ordena por algo **monótono con la
  creación** (`id`, o `creadoEn`), nunca por un folio de negocio — y menos por uno cuyo arreglo depende
  de un **paso manual** que §Post-F9.85 ya demostró que puede quedarse trece días sin darse. Un
  comentario que promete un orden y una cláusula que entrega otro es un defecto, no un matiz.
- 🔴 **APRENDIZAJE de V1-E3q (2ª vuelta, 21-ago-2026) — no basta con NO CALLARSE: hay que NO MENTIR.**
  El arreglo del bloqueante abrió una mentira nueva: como lo pendiente ya venía redondeado, todo
  faltante por debajo de 0.01 se reportaba como *"ya está en una orden de compra viva (0 pza) — si esa
  OC se cancela, vuelve a aparecer"*, **sin que existiera ninguna OC**. §Post-F9.85 nació porque Daniel
  dejó de creerle a la pantalla; **una previa que afirma un hecho falso es exactamente ese fallo**,
  aunque la decisión operativa de fondo sea correcta. Una lista de motivos sólo vale si cada motivo es
  verdad. (Arreglado con un motivo propio, `menor-al-minimo`, en vez de mover el corte: mover el corte
  habría borrado la información verdadera del caso *"ya está comprado"*.)
- 🔴 **APRENDIZAJE de V1-E3q — una aserción LAXA sobre una promesa ESTRICTA es una prueba que miente.**
  El docstring prometía que el tablero y la explosión *"nunca dicen números distintos"*, y su prueba
  usaba `toBeCloseTo`: **no podía** cazar que uno dijera `0.3` y el otro `0.30000000000000004`. Si la
  promesa es exacta, la aserción tiene que serlo.
- **APRENDIZAJE de V1-E3q — "una sola verdad" se sostiene EN LA FUENTE, no en cada consumidor.** El
  redondeo estaba en 2 de los 3 lectores y el tercero (R7) quedó crudo. Ahora vive dentro de
  `comprometidoEnOc`. Y su gemela: **lo recibido NO se redondea a 2** porque su columna es
  `Decimal(14,4)` — *cada número a la escala de SU columna*, no la del vecino.
- ⚠️ **APRENDIZAJE de V1-E3q — el guardia contra una trampa puede fabricar la trampa contraria.** Puse
  un control para detectar `-t` que no seleccionan nada (falsos verdes)… y contaba mal cuando **todas**
  las pruebas fallaban (`Tests 1 failed (1)`, sin "passed"), así que reportó *"filtro vacío"* sobre
  mutantes que en realidad **sí morían**. Un instrumento de medición también hay que verificarlo.
- 🔴 **APRENDIZAJE de V1-E3q (21-ago-2026) — un número no está bien calculado hasta que está bien
  GUARDADO.** La etapa fue **RECHAZADA** por el reviewer: el defecto que vino a arreglar seguía vivo.
  El reparto corría a **4 decimales** y `OrdenCompraLinea.cantidad` es **`Decimal(14,2)`**. La
  aritmética era correcta en memoria y se rompía al cruzar a la columna: el renglón reaparecía con
  `0.002` pendientes, se encadenaban OC con líneas en `0.00` **quemando folios**, y `Σ(líneas) ≠ lo
  comprado` (100 → 99.99), con lo que **la revisión previa mentía**. **La regla, para toda etapa
  futura: la escala manda desde el DESTINO, y quien reparte cierra la suma EN ESA escala.**
- 🔴 **APRENDIZAJE de V1-E3q — un comentario puede mentir tan caro como el código.** El módulo decía
  *"la BD guarda cantidades con 4 decimales"*; era falso para el destino real, y **es lo que hizo que
  nadie mirara la columna**. La corrección arregló el comentario Y el código. Corolario amargo: la
  primera corrección dejó la constante `ESCALA_CANTIDAD_COMPRA` **de adorno** (el redondeo no la
  usaba), así que cambiarla no cambiaba nada — **la misma clase de mentira, cometida al arreglarla**.
  La cazó el mutador, no la revisión.
- 🔴 **APRENDIZAJE de V1-E3q — un suite en verde puede ser un suite CIEGO.** Las 84 pruebas pasaban
  sobre un defecto vivo porque **todas** sus cantidades (180, 100, 300, 400) caen exactas en 2
  decimales: el viaje de ida y vuelta por la BD no perdía nada y **el fixture no podía expresar el
  fallo**. Al elegir los datos de una prueba hay que preguntarse *"¿este valor puede FALLAR?"*, no
  sólo *"¿es representativo?"*. Y la Σ hay que pedírsela a **Postgres**, no a JavaScript.
- **APRENDIZAJE de V1-E3q — un mutante que sobrevive puede ser un hueco o una redundancia, y hay que
  distinguirlos midiendo.** De 12 mutaciones, 10 murieron; las 2 supervivientes se probaron
  equivalentes mutando **todas** las guardas del mismo invariante a la vez (ahí sí se ponen rojas).
  Lo que NO vale es declarar "equivalente" sin esa prueba: dos de los cinco supervivientes de la
  primera vuelta eran huecos de verdad. ⚠️ Y una trampa propia del método: un `-t` que no casa con
  ningún test devuelve **exit 0** y el mutante parece sobrevivir — hay que verificar que el filtro
  selecciona algo antes de creerle a la tabla.
- **DEUDA de V1-E3q (20-ago-2026) — la explosión multi-OP no tiene e2e ni impreso propio.** El flujo
  (armar el conjunto de OP → revisar → confirmar) está cubierto por integración (**20** pruebas nuevas
  contra Postgres nativo) y por pruebas de componente (**11** nuevas), pero ningún spec de Playwright lo
  recorre; el spec de explosión sólo comprueba que los controles nuevos existen. Y el **impreso PDF de la
  explosión sigue siendo POR ORDEN**: con varias OP en pantalla imprime la primera y lo dice en el
  tooltip. Un impreso del conjunto es trabajo aparte y nadie lo ha pedido.
- ✅ **CERRADA por Daniel (22-ago-2026) — los avíos NO llevan catálogo de color.** *"Podríamos dar de
  alta cada avío con su propio color en la descripción y ya… No es la misma relevancia que la tela,
  porque acá son pocos los avíos que son por color"*, y al confirmarlo: *"Va. Entonces lo dejamos así y
  ponemos los avíos con color en la misma descripción del avío"* (§Post-F9.91). 🔴 **Su conclusión de
  entonces —*"no se construye nada: el color del avío vive en su descripción, como un avío más del
  catálogo"*— la CORRIGIÓ el propio Daniel el 26-ago** al traer el caso completo: pidió **un solo avío
  repetido cuatro veces** (*"poner 4 veces el cierre y en la descripción del avío ponerle el color"*), no
  cuatro avíos del catálogo —que habrían multiplicado por cuatro su BOM, su precosto y su inventario—.
  ✅ **Lo construyó `V1-E8c` (§Post-F9.126) sin desviarse de la decisión de alcance**: sigue sin haber
  catálogo de color de avío. Se conserva abajo el análisis que llevó a preguntárselo, porque explica
  **por qué no era obvio**. ⚠️ **La pregunta del catálogo está contestada: no se le vuelve a hacer.**

- ✅ ~~**PROPUESTA de V1-E3u — ¿los AVÍOS también se compran por color?**~~ *(el análisis, conservado;
  la pregunta la cerró Daniel y `V1-E8c` la construyó — ver el cierre al final del punto)* Daniel lo sospechó
  (*"y seguramente también en avíos"*, §Post-F9.89). **Se midió antes de asumirlo, y el hueco NO es el
  mismo**: en la TELA el color existía en los dos extremos (`TelaColor` en el catálogo, `idTelaColor`
  obligatorio en la entrada) y sólo faltaba el eslabón de en medio. Al AVÍO le falta **la mitad del
  proveedor**: no hay `AvioColor` (el equivalente de `TelaColor`, con nombre libre, pantone y precio),
  `MovimientoDetAvio` no tiene color y la recepción no lo pide. ⚠️ **Lo que SÍ existe ya** (re-medido el
  22-ago, corrige la primera redacción): la **intención** de compra de un avío se puede diferenciar hoy
  por `OrdenCompraLineaTalla`, que lleva `idColor` (color de **prenda**) × `idTalla` — la versión
  estructurada de la tabla de Excel que el sistema viejo dejaba pegar en la OC. Aun así, construir el
  resto es catálogo nuevo + kardex por color + recepción por color + migración del histórico: **otra
  etapa, del tamaño de V1-E3u o más**. ✅ **CONTESTADA Y CONSTRUIDA en `V1-E8c` (27-ago-2026,
  §Post-F9.126), y por el camino barato:** Daniel dijo **sin catálogo** —*"poner 4 veces el cierre y en
  la descripción del avío ponerle el color"*—, así que el renglón se parte por el color de **PRENDA**
  (el que ya vive en la matriz de la OP) y el texto del color viaja **editable** en la línea. El kardex
  y la recepción por color de avío **no se construyeron y no hicieron falta**: se recibe contra la
  LÍNEA, y la línea lleva su color. ⚠️ Queda un **límite declarado**: una entrega parcial sabe el color
  pero no la MEDIDA (ver la ficha de `V1-E8c`).
- 🔴 **APRENDIZAJE de V1-E3u (21-ago-2026) — cuando un dato es obligatorio en un extremo y no existe en
  el otro, el defecto NO está en ninguno de los dos: está en el eslabón que los une.** La recepción de
  telas exigía el color y lo hacía bien; la receta y la OC no lo llevaban y también "funcionaban". El
  costo lo pagaba una persona: **quien recibe tenía que inventar la correspondencia**, todos los días, sin
  que ningún error saltara nunca. Vale la pena buscar el patrón en otros pares (¿qué más se exige al
  cerrar que no se puede decir al abrir?).
- **APRENDIZAJE de V1-E3u — una regla nueva para PROPONER es barata; la misma regla para VALUAR no.**
  El casado color-prenda↔color-tela ya existía para resolver precios (`resolverPrecioColorReferencia`:
  liga → nombre). La propuesta de la etapa le agregó **pantone** y **único-sin-ambigüedad**… pero
  **sólo para proponer**: meterlas a la cascada de precios habría movido números del precosteo que nadie
  pidió mover. La persona ve una propuesta y la confirma; nadie ve un precio cambiar.
- 🔴 **APRENDIZAJE de V1-E3u (22-ago-2026, segunda vuelta) — UNA VALIDACIÓN NUEVA OBLIGA A PREGUNTAR
  QUIÉN TIENE QUE CUMPLIRLA, Y CON QUÉ INFORMACIÓN CUENTA.** La etapa añadió un cruce que **rechaza la
  factura entera** si el color no coincide con el de la OC. Correcto… salvo que la tela **no se recibe**
  en la pantalla que parecía (§Post-F9.14 deja sus renglones deshabilitados) sino en *Inventarios › Telas
  › Entradas*, donde el color de la OC **no llegaba ni al contrato**. Resultado: **una tranca nueva y la
  información para pasarla, quitada**. El costo lo paga quien recibe, que ya no puede guardar la factura y
  no tiene de dónde sacar el dato. **Añadir un control sin dar el dato no protege: traslada el problema a
  quien menos puede resolverlo.** El barrido correcto no es *"¿arreglé la pantalla?"* sino *"¿cuáles son
  TODAS las superficies por donde pasa este flujo?"* — aquí eran tres (la manual, la del XML del CFDI, y
  el editor de la OC), y la frase que había dejado de ser cierta estaba en **cinco** archivos, no en dos.
- 🔴 **APRENDIZAJE de V1-E3v (22-ago-2026) — la misma forma, pero en su versión más barata: un campo del
  MODELO DE DATOS que ninguna pantalla lee.** `Avio.favorito` y `Avio.cantFav` llevaban **desde F1-E3**
  construidos, validados (*favorito ⇒ cantidad > 0*) y **probados**… y `grep favorito|cantFav` en las
  pantallas de modelos y de órdenes daba **cero**. Se podía marcar un avío como favorito con su cantidad y
  al armar la receta **no pasaba absolutamente nada**: la marca no hacía nada, y quien la palomeaba no
  tenía cómo saberlo. Es el mismo defecto que §Post-F9.89 en su forma más difícil de detectar, porque
  aquí **nada falla**: no hay error, no hay número mal, no hay pantalla rota — sencillamente el trabajo
  que alguien capturó no sirve para nada. 🔴 **La búsqueda que lo destapa es barata y hay que hacerla:
  por cada columna que una etapa agrega al esquema, `grep` de su nombre en `frontend/src/`.** Si no
  aparece, o la columna no debía existir todavía, o la etapa no terminó. Corolario que se aplicó al
  cerrarla: cuando una marca **empieza** a hacer algo, la pantalla donde se captura tiene que **decir qué
  provoca** (la casilla de favorito ahora lo explica en una línea).
- 🔴 **APRENDIZAJE de V1-E3u (22-ago-2026) — «lo expone el contrato» NO es «lo ve la persona».** La
  etapa entregó `avisoDesvio` por renglón de OC, bien calculado y bien probado contra la BD… y **ninguna
  pantalla lo pintaba**. La decisión de Daniel no era *"guarda el desvío"*, era *"**que le notifique a la
  persona que va a autorizar la OC**"*, así que el requisito estaba cumplido en el JSON y **sin cumplir
  en el producto**. Lo mismo con el color: viajaba en la línea y sólo salía en el **impreso**, de modo que
  quien recibe seguía comparando la factura contra una OC que **en pantalla** no decía de qué color era —
  exactamente la fricción que la etapa venía a quitar. **La prueba de que una etapa así terminó no es que
  el endpoint devuelva el campo: es abrir la pantalla donde vive la decisión y verlo.** (Misma forma de
  §Post-F9.17/.85: *un arreglo que necesita que alguien haga algo no está terminado hasta que alguien lo
  hace*.) Corolario barato: **al partir una fila en varias, revisar las claves de React** — la explosión y
  la revisión previa se llaveaban por `tipo-material[-proveedor]` y desde el corte por color eso ya no es
  único.
- ⚠️ **APRENDIZAJE de V1-E3u — partir una fila en varias obliga a revisar a QUIÉN le habla cada consumidor.**
  Al pasar el snapshot de una fila por tela a una por tela×color, el tablero R7 habría pintado una fila por
  color **leyendo el `enOc` del material completo en cada una** (su índice es por material): habría dicho
  que hay tres veces más comprado del que hay. Se arregló sumando por material ANTES de cruzar. La
  pregunta que hay que hacerse al partir una fila no es *"¿sale bien el detalle?"* sino *"¿contra qué está
  indexado cada consumidor que la lee?"*.
- 🔴 **PENDIENTE MANUAL de V1-E3q (bloquea que Daniel vea sus OC) — `reparar-secuencias.ts` + el salto a
  10001.** Las OC que Daniel generó tomaron folios 1, 2, 3… y el listado, ordenado por folio DESC, las
  mandó detrás de las ~7,978 migradas. **No es código de la etapa**: es correr, desde `backend/`,
  `npx tsx --env-file=.env migracion/reparar-secuencias.ts`, y después el salto de la serie de OC a
  **10001** (§Post-F9.85; requiere que ese script acepte *salto a escalón* y no sólo `max+1`).
- 🔴 **APRENDIZAJE de V1-E3q — un arreglo que necesita que alguien corra algo NO está terminado hasta que
  se corre.** El arreglo de §Post-F9.17 estaba escrito y "listo" desde el **7-ago** y el defecto siguió
  vivo **trece días**, hasta que Daniel volvió a tropezar con él el 20-ago — porque dependía de un paso
  manual que nadie dio. La lección no es sobre el script: es que **el entregable incluye el paso manual**,
  y mientras esté pendiente la etapa está a medias, no cerrada.
- **APRENDIZAJE de V1-E3q — "dos verdades sobre el mismo número" es el defecto, no la duplicación de
  código.** La explosión proponía comprar lo ya comprado **teniendo el cruce ya escrito** dentro del
  tablero R7. No faltaba la función: faltaba **reusarla donde se compra**. Se sacó a un módulo propio
  (`comprometido-en-oc.ts`) precisamente para que la próxima pantalla que pregunte *"¿cuánto ya compré?"*
  no tenga la tentación de volver a calcularlo.
- **APRENDIZAJE de V1-E3q — el mismo dato puede necesitar DOS criterios distintos, y hay que escribir
  cuál es cuál.** Para saber *"¿hace falta volver a comprar esto?"* el **borrador cuenta**; para saber
  *"¿qué precio pagó la empresa?"* (§Post-F9.48) **no**. Copiar el criterio del costo —que estaba ahí,
  escrito y probado— habría dejado el defecto exactamente igual. Cada criterio quedó documentado **donde
  se usa**, con la pregunta que responde.
- **APRENDIZAJE de V1-E3q — un mutante que sobrevive no siempre es un hueco: a veces es defensa en
  profundidad.** Quitar el filtro por empresa de una de las tres guardas de A9 dejó la prueba en verde
  porque las otras dos siguen dando 404. Se verificó a mano con las **tres** fuera (ahí sí se pone roja),
  se dejó anotado en el propio archivo de pruebas, y **no** se agregó una prueba por línea: lo que se
  cubre es la invariante. El otro superviviente sí era un hueco real y se cerró.
- 🔴 **APRENDIZAJE de V1-E3r (21-ago-2026) — un trabajo sin comitear no existe.** La etapa se construyó
  ENTERA y se perdió con un reinicio del contenedor: 39 archivos sin comitear, cero rastro. Lo único que
  sobrevivió fue el **veredicto del reviewer**, que resultó valiosísimo (la reconstrucción arrancó ya
  corregida en sus siete defectos), pero el código hubo que rehacerlo desde nada. **Comitear en la rama de
  trabajo no mergea nada ni se salta al reviewer**: es gratis, y es la única red que hay.
- ⭐ **APRENDIZAJE de V1-E3r — medir el dato ANTES de diseñar cambió el diseño tres veces.** La escala del
  orden de tallas parecía obvia ("alfabético para letras, numérico para números"). Medirla sobre las 5,451
  órdenes reales tumbó las tres intuiciones: las combinaciones mixtas van **número→letra** 15 a 1 (así que
  los números van ANTES, no después); **meses y años pertenecen a la escala numérica** convertidos a meses
  (`3M-6M-9M-12-18-2A-3A` sale bien con la MISMA regla que `4-6-8-10-12`); y **`3X` es letra**, lo que la
  hace acertar en sus dos familias en vez de fallar en las dos. Ninguna de las tres se habría descubierto
  razonando. **Y el corolario:** el volcado real no estaba en el árbol de trabajo (se sacó de
  `main/prueba` en su día), pero **sí en el historial de git** — `git show <commit>^:"ruta"` lo recupera.
  Antes de reportar *"no puedo medir"*, buscarlo ahí.
- **APRENDIZAJE de V1-E3r — un mutante que sobrevive no siempre es un hueco (se repite el patrón de
  V1-E3q).** La búsqueda de "la curva que cubre exactamente este conjunto" tiene **tres** guardas
  redundantes (`some` en la consulta, el filtro del lote y el lookup por firma). Tumbar **una sola** deja
  el suite en verde; con **dos** se pone rojo y con **las tres**, también la prueba de la curva vacía. Es
  defensa en profundidad, no falta de cobertura — se verificó a mano, se dejó escrito en el archivo de
  pruebas y **no** se agregó una prueba por guarda: lo que se cubre es la INVARIANTE, no cada línea.
- **APRENDIZAJE de V1-E3r — el guardia del mutador atrapó al propio mutador.** La regla *"el patrón tiene
  que casar exactamente una vez"* abortó una mutación cuyo texto (`    .min(1, {`) casaba **tres** veces en
  el archivo: sin ella, el mutador habría cambiado la línea equivocada y dictado un veredicto sobre algo
  que nadie quiso probar. Un instrumento sin verificar miente en las dos direcciones — hay que **verificar
  el instrumento antes de creerle**.
- **DEUDA de V1-E3r — las etiquetas que la escala de tallas no reconoce se quedan en 0 y salen PRIMERO.**
  Son **26 combinaciones de 161** (58 órdenes de un universo de **5,383**), casi todas data sucia del
  Access (`UT`, `MC`, `M.`, `G'`, el separador suelto de dos curvas pegadas). Se dejó a propósito: darles
  una posición inventada sería afirmar algo que no se sabe (D3). Se acomodan a mano desde Catálogos ›
  Tallas si alguna estorba. **Y dos fallas de diseño declaradas:** `CH-M-G-EX-38-42` (letra→número, 2
  órdenes) y `G-EX-2X-3X-M` (1 orden) salen desordenadas — es el precio de que los números vayan antes,
  que es lo correcto para las otras 15 combinaciones / 309 órdenes. *(Cifras de la ronda de corrección:
  se re-corren con `migracion/analisis/medicion-orden-de-tallas.ts`, no se re-citan.)*
- 🔴 **APRENDIZAJE de V1-E3r (ronda de corrección, 21-ago-2026) — una cifra citada a mano se pudre en
  silencio; una que sale de un script se vuelve a sacar.** Las cifras del volcado publicadas en el TSDoc de
  la escala no se reproducían, y el módulo llegó a **contradecir a su propia prueba** (`2-3-3X`: 303
  órdenes en uno, 252 en la otra). Era la **segunda** vez que un reviewer lo señalaba: la primera se
  arregló *corrigiendo las cifras*, y volvió a pasar. El arreglo bueno fue otro — **convertir la medición
  en código** (`backend/migracion/analisis/medicion-orden-de-tallas.ts`, con el parser del propio ETL y la
  escala del dominio), que además imprime **cada cifra que la doc cita** en una tabla de cotejo. La regla
  que queda: *si un comentario presume de estar MEDIDO, la medición se comitea con él*.
- **APRENDIZAJE de V1-E3r — dos formas de contar en la misma frase.** El «164 combinaciones» y las «94
  filas `Talla`» eran ambos correctos y ambos incompatibles: uno cuenta distinguiendo mayúsculas y el otro
  no (el loader deduplica las curvas con `mode: 'insensitive'`, así que el número real es **161**). Cuando
  una cifra depende de cómo se normaliza, hay que **decir cuál se usó** — o imprimir las dos.
- 🔴 **APRENDIZAJE de V1-E3r — una prueba verde puede estar pasando por la razón equivocada.** La prueba
  titulada *«🔴 NO bloquea»* renderizaba el componente con aviso y **sin propuesta**, y afirmaba que no
  había botón — pero en ese estado **no hay ningún botón que pintar**. Mutar el componente para que el
  aviso deshabilitara literalmente la acción dejaba las 45 pruebas en verde. La regla práctica: **para
  probar que algo NO bloquea, hay que montar el estado donde haya algo que bloquear.**
- **APRENDIZAJE de V1-E3r — las corridas de mutación van SOLAS.** Correr el suite de integración completo
  en segundo plano mientras se mutaba contra la **misma base** dio `deadlock detected` y **14 pruebas
  rojas** en una mutación que aislada sólo tumba **1**. Un entorno contaminado miente en la dirección
  cómoda: hace parecer que la prueba tiene más dientes de los que tiene.
- **APRENDIZAJE de V1-E3r — «sobrevive» no siempre significa «equivalente».** La mutación que quitaba la
  guarda `datos.orden === undefined` no cambiaba el valor guardado (la rama del `orden` explícito va
  primero), pero **la bitácora empezaba a atribuirle a la escala una decisión humana**. Antes de archivar
  un mutante superviviente como equivalencia, hay que preguntarse **qué más observa el sistema** además
  del valor: la auditoría también es comportamiento.
- **DEUDA de V1-E3r — el jalón de la curva no tiene e2e.** Está cubierto por integración (32 pruebas) y por
  componente (13), pero el flujo completo *"abro el modelo sin curva → veo la propuesta → confirmo → la
  matriz de abajo cambia"* no se recorre en Playwright.
- **DEUDA de V1-E3n (20-ago-2026) — el dígito de nomenclatura del GÉNERO no tiene pantalla.** El del
  TIPO DE PRENDA sí la tiene (se cerró en la ronda de corrección: era un **callejón sin salida**, el
  sistema mandaba a *"captúralo en su catálogo"* y el catálogo no tenía el campo). `Genero` es un
  catálogo **selector sin ABM desde F1** —igual que `RolProveedor` o `TipoProceso`—, así que abrirle uno
  excede la etapa. Los ocho géneros del seed traen su dígito y la migración se lo pone a los existentes;
  uno nuevo queda en NULL y el generador **lo dice con su nombre** (*"El género «Unisex» no tiene dígito
  de nomenclatura capturado…"*) en vez de inventar un número. Sin riesgo de código equivocado, pero hay
  que ir a la base si aparece un género nuevo.
- **DEUDA de V1-E3n — «Pasar a producción» no tiene e2e.** Está cubierto por unit (**13**), integración
  (**43** del motor + **12** de la salida a producción) y pruebas de componente (**27** de front), pero
  ningún spec de Playwright recorre el camino completo catálogo → botón → número precargado → confirmar.
  Mismo caso que el «asignar proveedor» de V1-E3m.
- **APRENDIZAJE de V1-E3n — un COMENTARIO puede prometer una cobertura que no existe.** La prueba del
  dígito repetido afirmaba en su comentario que protegía el `catch` de P2002 (*"esta tabla tiene DOS
  únicos y culpar al nombre mandaría a corregir el campo equivocado"*), pero pasaba por la **guarda del
  dominio**: mutar `mensajeDeUnicidad` dejaba 37/37 en verde. Es el vicio de toda la tanda —el título
  afirma identidad, el cuerpo comprueba presencia— **mudado a la justificación**, donde nadie lo busca.
  **La regla:** cuando un comentario diga *"esto protege X"*, la mutación que rompe X tiene que tirar
  ESA prueba; si no, el comentario miente y hay que reescribirlo o escribir la prueba que falta.
- **APRENDIZAJE de V1-E3n — la cifra de las pruebas se equivocó DOS veces, y la segunda ya se
  contradecía entre tres documentos.** No es cosmético: el reviewer lee esos números para saber qué
  está cubierto, y una cifra inflada es una promesa de cobertura que no existe —la misma familia del
  "título que afirma identidad y cuerpo que comprueba presencia"—. **La regla:** las cifras se copian
  de la SALIDA de la corrida (`Tests N passed`), archivo por archivo, y se escriben al final, después
  de la última prueba agregada; nunca de memoria ni de una cuenta a mano de los `it(`.
- 🔴 **APRENDIZAJE de V1-E3n — el reporte final se emite DESPUÉS de la última edición, no antes.** El
  coder cerró diciendo *"los ocho comandos en 0"* y `npm run lint` del backend estaba **rojo**, con el
  error **dentro del remate que acababa de escribir** (`calidad.int.test.ts`). Lo cazó el lead corriendo
  los gates antes de comitear; de haber ido tal cual, el CI se caía. Esto **no** es la cicatriz de
  «valida con los `npm run` del proyecto» (esa ya está escrita y se cumplió): es la de al lado —**quien
  remata vuelve a correr los ocho**, aunque el remate "no toque lógica"—. Una corrida vieja pegada en el
  reporte final vale lo mismo que no haber corrido nada.
- **APRENDIZAJE de V1-E3n — una decisión "cerrada" no es una decisión CONSTRUIDA.** §Post-F9.34 quedó
  redactada entera el 12-ago, con tabla de dígitos, formato del código y los siete puntos de qué construir
  — y terminaba con *"Aplica en: **NADA todavía** — es decisión de rumbo"*. Ocho días después Daniel probó
  la OP 5558 y se topó con el hueco. El texto era correcto; lo que faltó fue **una etapa que lo
  implementara**. Cuando una decisión cierre sin etapa asignada, conviene que quede en el radar de
  `HOJA-DE-RUTA.md` como pendiente, no sólo en `DECISIONES.md` como historia.
- **APRENDIZAJE de V1-E3n — medir el dato viejo cambió el diseño.** El plan decía "consecutivo por
  secuencia atómica (A3)". Contar los 4,987 modelos del Access enseñó que el par `51` tiene **535 usados
  de 999 y el 999 ocupado**: una secuencia habría propuesto `1000` desde el primer día y dejado 464
  números inalcanzables. La regla A3 sigue viva donde aplica (el consecutivo de DESARROLLO), y donde no
  aplica se sustituyó por algo con la MISMA garantía —hueco libre bajo `pg_advisory_xact_lock` del par— y
  se dijo por qué. Escrito en `DECISIONES.md §Post-F9.83`.
- **APRENDIZAJE de V1-E3m (20-ago-2026) — un script de mutación que muere por timeout DEJA EL ÁRBOL
  MUTADO.** Al mutar contra integración (52 s por corrida), el script se pasó del tope de 2 min y murió
  **entre** la mutación y su restauración: `proveedor-de-orden.ts` se quedó con un `if (false)` que
  desactivaba la validación de proveedor inactivo. Se detectó por `grep` al terminar, no por el suite —
  ninguna prueba lo habría notado hasta la siguiente corrida. **La regla:** todo mutador restaura en un
  `finally` **y** corre sin tope de tiempo (background), y al terminar se verifica el árbol
  (`git diff`/`grep` del ancla) antes de seguir. Es la versión chica de la cicatriz del 13-ago: el árbol
  de trabajo es compartido, y quien lo mueve tiene que dejarlo como lo encontró.
- **APRENDIZAJE de V1-E3m — la integración SÍ se puede correr localmente sin Docker.** `initdb`+`pg_ctl`
  de un Postgres nativo, `prisma migrate deploy`, y un config de vitest temporal cuyo `globalSetup`
  publica esa URL en vez de arrancar testcontainers. Sirvió para mutar el motor contra la base real (8/8
  cazadas) y, de paso, **probó que las migraciones aplican en secuencia sobre una base virgen** — algo que
  `prisma migrate diff` no verifica. No sustituye al CI (Postgres 17 vs 16 local), pero convierte
  "no lo pude correr" en "lo corrí y además lo muté".
- **DEUDA de V1-E3m — el «asignar proveedor» del comprador no está cubierto por e2e.** Su cobertura es
  unitaria (política de proveedor, 11 mutaciones cazadas) + integración (Postgres, en CI). El e2e de la
  explosión sigue verificando solo que la pantalla carga y wirea sus controles, como desde F4-E4.

- ⬜ **PENDIENTE de V1-E3v — la TELA FAVORITA en inventarios (lo aclaró DANIEL, 22-ago-2026).** Al leer
  la doc de los avíos favoritos, Daniel corrigió una suposición que el desarrollo había escrito como
  hecho: *"Las telas favoritas tienen otro sentido que los avíos. Era para mostrar en inventarios un
  grupo reducido de telas que son las que más uso. **No** para que por default me ofrezca una tela. Es
  completamente otra cosa que los avíos."*
  **Lo que hay hoy:** `Tela.favorito` existe, se captura, **nace marcada** y se pinta como badge
  *«Favorita»* en `TelasPagina` — y **ninguna pantalla de existencias la mira** (cero coincidencias en
  `frontend/src/modulos/inventarios/`). O sea: **la marca está, la función no**.
  **Lo que falta:** que las existencias de telas (`ExistenciasTelasPagina`, `ExistenciasTelasColorPagina`)
  puedan mostrar **sólo las favoritas** — el grupo corto de las que de verdad se mueven— en vez de obligar
  a recorrer el catálogo completo. ⬜ **Por definir con Daniel:** si es un **filtro** que él prende, o si
  las favoritas **arrancan arriba** por omisión; y si aplica también a **avíos** (`Avio.favorito` ya
  existe y ahí sí tiene el otro significado, así que ojo: la misma bandera **no** puede servir para las
  dos cosas sin decidirlo antes).
  🔴 **El aprendizaje, que vale más que la función:** dos modelos con un campo del **mismo nombre**
  invitan a suponerles la **misma intención**, y aquí la suposición llegó a escribirse como razón de
  diseño (*"a la tela le falta `cantFav`"*) en tres documentos. **Un nombre igual no es una intención
  igual** — y el que sabe cuál es la intención es Daniel, no el esquema.
### 🔎 BARRIDO de «datos que llegan al contrato y no a la pantalla» (22-ago-2026, lo pidió Daniel)

Barrido de **solo lectura** sobre las **143 banderas `Boolean`** del esquema (155 modelos), buscando dos
formas del mismo patrón: **(A)** el backend lo construye y **ninguna pantalla lo lee**; **(B)** el dato
**sí se pinta** pero **no acciona nada**. Descartados por diseño: banderas de auditoría, las que sólo usa
el ETL, las de la **Ruta Crítica** (apagada a propósito) y `emailVerified` (de better-auth).

**Los dos hallazgos, ordenados por lo que le cuestan a Daniel:**

1. 🔴 **Un pedido nacido en v2 NO se puede marcar como entregado. Nunca.** — `Pedido.entregadoTienda`.
   La pantalla *Pedidos por mes* tiene el filtro **«entregados»** (`PedidosMesPagina.tsx:138,375`) y
   pinta el chip **«Entregado»** (`:74`); el backend deriva ese estatus de la bandera
   (`dominio/pedidos/consulta-mes.ts:118-120,292`) y el endpoint de actualizar **la acepta**
   (`dominio/pedidos/pedidos.ts:553`). Pero **ninguna pantalla la manda**: fuera del contrato
   generado, la única mención en `frontend/src` es un dato de prueba
   (`modulos/pedidos/PedidosPagina.test.tsx:94`), que no captura nada. El **ETL sí la llena** (`migracion/loaders/pedidos.ts:327`),
   así que el filtro **funciona para los pedidos migrados de Access y para nada más**. Eso es lo que lo
   vuelve peligroso: no se ve como un hueco, se ve como que el sistema **perdió** la marca. Confianza
   **alta**.
2. 🟡 **Hay dos endpoints de EsMa que nadie llama** — `Orden.pagadaForzada`. `GET`/`POST
   /esma/ordenes/:id/pagada` (`api/esma/cuenta.rutas.ts:101,118`, permisos `esma.ver-pagos` /
   `esma.modificar`) sobre un módulo de dominio completo con su bitácora
   (`dominio/esma/orden-pagada.ts`): forzar «pagada» a mano y volver a la derivación automática
   (decisión (f) de F6). El frontend **no llama a ninguno** (cero coincidencias de `/pagada` fuera del
   contrato generado). No hay dato capturado que se pierda —nadie puede capturarlo—, así que duele menos
   que el anterior: es **capacidad construida y no entregada**, no trabajo tirado. Confianza **alta**.

3. ✅ **`Avio.factorConversion` / `AvioProveedor.factorConversion` — CERRADO: no era un dato que
   faltara capturar, era una pieza que nunca hizo falta (26-ago-2026, `V1-E8a` / §Post-F9.97).**
   Era el factor de presentación de compra —*cuántas unidades del BOM trae una presentación del
   proveedor*, un rollo de 50 m— con toda su maquinaria construida (`comun/conversion.ts`), leída por
   ~9 archivos del dominio y **escrita por NADIE**: cero en el contrato, cero en el ETL, cero en el
   frontend. Se catalogó aquí como *"una entrada que nadie puede llenar"* y se dejó anotado que
   **antes de construir nada había que preguntarle a Daniel** si de verdad compra por presentación.

   ⭐ **Se le preguntó, y la respuesta cerró el ticket en vez de abrirlo:** *"la información viene
   desde el desarrollo, y ahí se costea por metro, no por rollo"*. La captura del factor **se
   canceló** (no se pospuso) y el factor **se retiró completo**. ⚖️ El argumento que lo hace correcto
   y no sólo cómodo: una traducción **en medio de la cadena del dinero** es donde se cuelan los
   errores que nadie ve — el factor multiplica la cantidad y divide el precio, así que el importe
   total sale igual **sobre números equivocados**.

   **Y con eso murió también el ticket gemelo**: esto se engranaba con la deuda del MRP registrada
   más arriba en este mismo §4 (*la línea de OC en unidad de consumo leída como presentación*), que
   estaba **dormida** precisamente porque el factor no podía ser ≠ 1. **No eran dos tickets: era
   uno**, y se cerró de una sola vez. Las columnas quedan **muertas y vacías** en el esquema (D3),
   documentadas como tales.

   📌 **La lección que sí se conserva, porque no era sobre el factor:** la pregunta que caza esta
   familia de defectos no es *"¿esto se VE?"* sino **"¿esto se puede CAPTURAR?"** — y la que la sigue
   es **"¿alguien lo necesita?"**, que hay que hacerle al dueño antes de construir la captura.


4. ⏱️ **El ENSAYO DE RESTAURACIÓN se caía por TIEMPO — tope subido a 300s (27-ago-2026, V1-E8c).**
   No es un fallo de la prueba ni del respaldo: hace el **ciclo completo** —volcado, cifrar,
   descifrar, restaurar en OTRA base y comprobar que el dato está— y venía rozando sus 180s. La
   ficha de `V1-E6c` ya lo tenía anotado como *"al filo de su límite"*; el CI de V1-E8c lo tumbó y
   se subió a 300s **en el diff de esa etapa aunque no fuera suyo**, porque un CI rojo bloquea todo
   lo demás.
   🔴 **Y queda dicho, porque subir un tope no arregla nada:** si vuelve a caerse con 300s, el ciclo
   se está haciendo **lento de verdad** y hay que medir por qué, **no darle más aire**. No se salta
   ni se apaga: es la ÚNICA prueba que sostiene que un respaldo se puede restaurar.
   📌 Sigue pendiente lo de **Gabriel**: restaurar un respaldo **de verdad**, a mano, contra los
   datos reales. Que la prueba pase en CI dice que el mecanismo funciona; **no** dice que el respaldo
   de anoche sirva.

5. 🟡 **DEUDA PREEXISTENTE — el reparto puede devolver un renglón NEGATIVO cuando el total es minúsculo.**
   La destapó el reviewer de **V1-E8c** haciendo fuzz, y **no es de esa etapa**: vive en
   `reparto-ordenes.ts` desde **V1-E3z**, y el desglose por medida sólo la hereda.
   **Repro determinista:** `repartirEntreOrdenes([30, 30, 30, 10], 0.02) === [0.01, 0.01, 0.01, -0.01]`.
   Con un total en el suelo de la escala y 4+ cubetas, **la última parte sale negativa**.
   🔴 **Por qué se cuela:** la Σ sigue cerrando, así que el cerrojo `motivoDesgloseInvalido` —que
   vigila justamente que la suma cuadre— lo deja pasar. *Una invariante que se cumple no garantiza que
   cada sumando tenga sentido*, y aquí podría imprimirse un **−0.01 en el papel del proveedor**.
   **Cuánto muerde hoy:** con totales ≥ 1 no ocurre **nunca** (0 en 300 000 casos de fuzz), y las
   cantidades reales de compra son piezas o metros enteros. Por eso **no se arregló en caliente**:
   tocarlo es cambiar el reparto que ya usan las OC repartidas por OP desde V1-E3z, y eso merece su
   propia etapa con su reviewer, no un parche de pasada.
   **El arreglo, cuando toque:** repartir el residuo sin dejar que ninguna parte baje de cero.

6. ⚠️ **Dos apuntes para cuando se retome «apagar la RC»** (rama pausada `trabajo/v1-e3t-apagar-rc`;
   su ficha vive en el `docs/hoja-de-ruta/V1-etapas.md` **de esa rama**, ~`:2743-2751`).

   ⚠️ **Antes que nada, lo que esa etapa YA decidió y no hay que deshacer.** E3t inventarió **las
   tres** piezas de fondo y resolvió dos de ellas: `registrarAutoAvanceRc` y `registrarHandlerCpm`
   **se quedan ENCENDIDOS a propósito** —apagar el consumidor del outbox haría crecer `pgboss.job`
   sin fin—, y la única sin decidir es `barrerRiesgoRc`, que es el defecto que dejó la etapa parada.
   *(Corrige una versión anterior de esta nota que decía lo contrario; se escribió sin abrir la
   ficha de la rama. La regla que deja: **si citas una etapa, ábrela** — aunque viva en otra rama.)*

   **Lo que sí es nuevo, verificado aquí:**
   - 🔴 **`procesarOrdenCreada` no tiene compuerta.** `autoAvance.ts:697-699` despacha el evento
     `ordenCreada` sin consultar ningún interruptor, así que **crear una OP le genera su ruta**
     aunque la RC se dé por apagada. E3t da por hecho que *"la generación automática está apagada"*,
     y en `prueba` **no lo está**. Es lo primero que hay que mirar al retomar.
   - 🔴 **El cron de pg-boss queda PERSISTIDO en la base** (`dist/plans.js` crea la tabla `schedule` e
     inserta), así que dejar de llamar a `schedule()` al arrancar **no lo quita**: hace falta
     `unschedule(name, key?)` (`pg-boss` 12.20 lo expone en `dist/index.d.ts:75`).
   - ⚠️ Sólo hay **tres** `schedule()` en todo el backend; los otros dos (`respaldo-bd`,
     `refrescar-kpis`) **NO se tocan**.

**⚠️ Lo que este método NO habría encontrado (dicho sin maquillar).** El barrido busca por **nombre de
campo**, y eso lo deja ciego cuando **varios modelos comparten el nombre**: basta con que UNO lo use de
verdad para que los demás pasen por sanos. Se comprobó con un **control ciego** —`Tela.favorito`, un caso
(B) real hallado por un reviewer y deliberadamente NO incluido en el encargo— y **el método no lo
encontró**: `favorito` existe en `Avio`, `Tela` y `Defecto`, y como `Defecto.favorito` sí manda en un
`where`, la bandera entera quedó clasificada como sana. **La lección: el barrido por nombre sirve para
nombres distintivos y miente en los compartidos.** Para cerrar ese hueco hay que barrer por
`Modelo.campo`, mirando qué modelo devuelve cada endpoint — más caro, y todavía **sin hacer**. Tampoco
se barrieron los campos que **no** son `Boolean` (fechas, números, textos), donde el mismo patrón puede
estar vivo.

- 🔴 **DEUDA de V1-E3z (23-ago-2026, señalada por el reviewer) — los mensajes por defecto de Zod salen
  en INGLÉS, y desde esta etapa SÍ se ven.** Al hacer que las frases de `detalles` lleguen a la pantalla,
  llegan **todas**: las escritas a mano en español (*"El precio no puede ser negativo"*) y también las que
  Zod genera solo cuando nadie le puso texto (*"Invalid input: expected object, received string"*,
  *"Invalid option: expected one of \"tela\"|\"avio\""*). No hay ningún `z.config(z.locales.es())` en el
  backend (verificado: cero coincidencias de `z.config` / `locales` / `errorMap` en `backend/src`).
  **Por qué no se arregló aquí, con la razón explícita:** (a) **no es regresión** — antes se veía un
  genérico igual de inútil; (b) sólo aparece cuando el payload viene mal de una forma que la pantalla no
  debería producir (tipo equivocado, enum ausente), mientras que los campos que el usuario teclea sí
  tienen frase en español; y (c) el arreglo global —`z.config(z.locales.es())` en el arranque del
  backend— **toca muchos textos de golpe y necesita su propia verificación de CI**, que es más de lo que
  cabía en esta etapa. ⚠️ **No se calla porque es conocido**: hay una prueba que lo asienta
  (`frontend/src/api/errores.test.ts`, el caso de la raíz que no es objeto afirma textualmente el mensaje
  en inglés). Quien lo retome: es una línea de configuración más el barrido de las aserciones que hoy
  esperan el texto en inglés.

- **~~DEUDA de V1-E6b (25-ago-2026) — la SEGUNDA puerta del alta de color no existía~~ ✅ CERRADA
  (29-ago-2026, `V1-E8o`).** V1-E6b abrió el alta de color de tela **desde el renglón** de la explosión
  («＋ Nuevo color…», última opción del desplegable) y **dejó escrito en su propio código** que el
  diálogo «Ver todos los colores y precios de la orden N» —al que se llega desde ese mismo bloque, a un
  clic— seguía sin ella: sólo **apuntaba** al desplegable de al lado (*"cierra este cuadro y usa…"*).
  ⚠️ **La deuda vivía SÓLO en el comentario del componente y en el de su prueba** — nunca llegó a esta
  lista, que es la razón por la que estuvo a punto de perderse; se anota aquí ya cerrada para que el
  registro exista. **Cerrada montando `DialogoNuevoColorDeTela` ahí mismo**, con el color recién creado
  **quedando elegido** (sin eso el problema se mueve, no se cierra), la guarda de permiso siendo el
  **mismo booleano** que en el renglón (`compras.administrar`) y el centinela `OPCION_NUEVO_COLOR`
  convertido en **un solo símbolo** que las dos puertas importan. El obstáculo real no se veía desde
  fuera: con el catálogo vacío el diálogo pintaba el aviso **en lugar** de las filas, así que no había
  desplegable donde poner la puerta. Ficha: `docs/hoja-de-ruta/V1-etapas.md` §V1-E8o.

- **🔴 DEUDA NUEVA (29-ago-2026, `V1-E8o`) — «la TERCERA puerta»: en el ALMACÉN, la tela sin el color
  capturado es un callejón sin salida Y SIN LETRERO.** El barrido por estado de V1-E8o (*"al usuario se
  le manda fuera a dar de alta un color"*) encontró una tercera boca del mismo callejón, en
  **inventarios**: `frontend/src/modulos/inventarios/CapturaRenglonesTelaColor.tsx` (el `SelectNativo`
  de color). Si la tela no tiene el color capturado, **no se puede dar de alta desde ahí**. Lo usan
  **cuatro** pantallas: entrada de tela, traspaso, ajuste y salida por orden — y desde §Post-F9.14 la
  tela **ya no se recibe desde la OC**, así que está en el **camino obligatorio** de recibir tela.
  ✅ **La mitad que no necesitaba a nadie YA SE HIZO** (misma etapa, ronda de corrección): con la tela
  sin colores el bloque **nombra un destino** (*Catálogos › Telas*, y *"o, si tú compras, en el renglón
  de la explosión"*), con prueba y dos mutaciones. Antes era **peor** que las dos puertas cerradas: ni
  alta, **ni destino**. ⬜ **Lo que queda es el ALTA desde esa pantalla**, y eso sí espera a Daniel.
  ⚠️ **Por qué el alta espera:** la pantalla vive bajo `inventario-telas.mover` y el servidor exige
  **`compras.administrar`** para `agregarColorATela` → un almacenista pulsaría el botón y se comería un
  **403**. **No existe decisión de Daniel** sobre cuál debe ser el permiso, e inventarlo está prohibido.
  🔴 **La lección de la ronda de corrección, que vale más que la deuda:** esa razón es verdadera y
  **cubría sólo la mitad** — se usó para no hacer NADA, cuando el permiso bloquea *construir el alta*,
  no *decir a dónde ir*. Un motivo legítimo para aplazar una pieza no es un motivo para aplazar la
  pieza de al lado. ⭐ **La lección que esta deuda documenta es la de la etapa entera:** este estado ha llegado
  a tener **tres** puertas y las dos primeras se "arreglaron" una por una — *cerrar una puerta no cierra
  su gemela*.
  Quien lo retome: **preguntarle a Daniel quién da de alta un color de tela desde el almacén** (un
  `inventario-telas.administrar`, o el mismo `compras.administrar` si el almacén también compra), y
  entonces montar `DialogoNuevoColorDeTela` ahí con el mismo patrón — el componente ya es reusable y el
  backend (`agregarColorATela`) ya existe.

- **DEUDA CON NOMBRE de V1-E6b (25-ago-2026) — `claveNombreColor` no normaliza ACENTOS, y eso fragmenta
  el catálogo justo como las medidas de avío.** La llave de unicidad del color DENTRO de una tela
  (`backend/src/dominio/catalogos/telas.ts`, `claveNombreColor`) hace `trim().toLowerCase()`: caza
  *"MARINO"* vs *"  marino "*, pero **no** *"Marrón"* vs *"Marron"* — que quedan como **dos colores de la
  misma tela**, cada uno con su precio, su pantone y su historial de compras. Es **exactamente la
  fragmentación que §Post-F9.106 cita como razón** para exigir el clic en vez del alta automática (la
  cicatriz de *"53 cm"* / *"53cm"* / *"53"*), sobreviviendo dentro de la puerta que se construyó para
  evitarla.
  ⚠️ **NO es regresión de V1-E6b:** el grid de la tela se comporta igual **desde F1** — el alta nueva
  hereda la llave, no la empeora. Y **no se toca a dos días del arranque**: `claveNombreColor` es la
  llave de EMPAREJAMIENTO del set-completo (`sincronizarColores`) contra **datos vivos**, así que
  normalizar acentos cambia qué fila casa con cuál en cada edición de tela ya capturada — un cambio que
  necesita su propia verificación, no un rato antes de que Daniel y Aurora empiecen a capturar.
  Quien lo retome: normalizar con `String.prototype.normalize('NFD')` + quitar diacríticos en la clave,
  y **decidir qué hacer con los duplicados que ya existan** (que es la mitad difícil: fusionarlos mueve
  amarres, precios y kardex).

- **~~Deuda técnica — «Fusionar colores» NO arrastra las referencias fuera de las telas~~ ✅ CERRADA
  el mismo día que se declaró, BLOQUEANDO (27-ago-2026, `V1-E8g` / §Post-F9.129):** la herramienta del
  catálogo (`fusionarColores` en `backend/src/dominio/catalogos/colores.ts`) reasigna al destino **sólo
  las referencias de TELAS** (`TelaColor`, vía `reasignarReferenciasColor`) y luego **desactiva** el
  origen. **`Color` tiene DOCE llaves foráneas entrantes y la fusión sólo sabe mover UNA** — las once
  restantes (matriz de órdenes, receta de tela de la orden, corte/envío/recibo, kardex de PT, renglones
  de OC de tela y de avío, requerimientos de la explosión, faltantes dados por cubiertos, lotes,
  inventario cíclico y precios por color de proveedor) quedaban apuntando a un color **apagado**, y una
  orden viva con color inactivo ya **no se puede editar** (`sincronizarMatriz`). ⚠️ **La primera
  redacción de esta deuda decía "nunca miró `OrdenLinea`" y SUBESTIMABA el agujero**; se deja escrito
  porque es la tercera vez que estas referencias se enumeran mal (el código original miraba 1, esta nota
  dijo 1, una revisión dijo 6). §Post-F9.129 **fabricaba el motivo** para dispararlo (dejó el catálogo
  lleno de `NEGRO A/B/C` que él mismo declara "no eran colores, eran empaques", y el diálogo prometía
  mover "las telas" sin mencionar las órdenes). **Cerrada RECHAZANDO, no reasignando:** entre no hacer
  nada y la migración irreversible había un tercer camino que no toca ni un dato — negarse y decir por
  qué. `fusionarColores` cuenta ahora esas once referencias antes de tocar nada y lanza `ErrorConflicto`
  nombrando el color, sus usos con sus cuentas y el camino de salida; el diálogo lo advierte antes. La
  lista vive en `colores-fusion-referencias.ts` con una prueba que **la deriva de `prisma/schema.prisma`**
  → una FK nueva al color que no se agregue pone el CI en rojo en vez de reabrir el hueco. **Lo que sigue
  pendiente (y por eso el bloqueo, no la reasignación):** reasignar de verdad exige mover `OrdenLinea`
  **junto con** `EtapaMovimientoDet` y `MovimientoDetPt` —moverlos por separado los deja incoherentes—,
  y eso es la **migración de las órdenes ya importadas**, irreversible y ~~con la palabra de Daniel
  pendiente~~ → 🔁 **cerrada NO (28-ago-2026, §Post-F9.132): esa migración NO se hace.** *"Lo viejo
  ahorita es irrelevante"* ⇒ los colores partidos de `prueba` se quedan como están, **el bloqueo de
  `fusionarColores` se queda igual** (es lo correcto), y quien tiene que juntar `Negro A` con `Negro B`
  es el **ETL del arranque** (§Post-F9.133). Ficha: `docs/hoja-de-ruta/V1-etapas.md` §V1-E8g.

## 5. Fuera de alcance del primer desarrollo (para que nadie lo busque como "hueco")

- **R8** (importar pedidos de clientes y generar órdenes): ~~"Etapa 2" por decisión del dueño~~ → ✅ **CONSTRUIDO antes de tiempo**: versión **Excel** en el rediseño (nota R8 de `docs/rediseno/PLAN-IMPLEMENTACION.md`, 8-jul-2026) y versión **PDF plantilla C&A** dictada por Daniel en vivo (12-jul-2026, ver §4). D7 (campos por cliente) resultó el cimiento esperado. Los demás clientes se suman plantilla por plantilla.
- **Promoda** (D9): cliente extinto — sus tablas NO se migran. **Proscai** (D6): ERP retirado — la comparación de cíclico es contra el propio kardex.

## 6. Decisiones de negocio aún abiertas (agendar con Daniel, con fecha límite)

| Decisión | Cuándo se necesita |
|---|---|
| **D2** — detalles de por qué Costos/EDR no se usa hoy | antes de abrir **F7** (sesión durante F5/F6) |
| **D8** — ubicación final de Control de Calidad (¿proceso de la RC?) | al cerrar **F5** |
| **A9** — qué catálogos son por empresa vs globales | en **F1-E1** (la firma Gabriel) |
| **Nº interno de producción** — ✅ **CERRADA (Daniel, 13-ago-2026, §Post-F9.36 punto 5):** *"Continuaría. Pero no el siguiente número disponible. Me saltaría al siguiente escalón. Para saber que las nuevas órdenes empiezan a partir de la 6000 por ejemplo (para OP). Esto para OP y OC también."* Aplica a **órdenes de producción Y órdenes de compra**. El número exacto se fija **en el ensayo**, cuando se conozca el máximo real migrado. Requiere que `migracion/reparar-secuencias.ts` acepte un **salto a escalón**, no solo `max+1`. ⚠️ **Irreversible una vez arrancado.** | construir antes del go-live; el número se elige en el **ensayo** |
| **¿«Mejor siempre desde producción» quiso decir «siempre desde DESARROLLO»?** (§Post-F9.134) — la frase de Daniel del 28-ago, leída al pie de la letra, dice lo contrario del resto de su párrafo. La lectura del lead —que el modelo llegue a producción **sólo por la puerta de «pasar a producción»**— está escrita y **marcada como pendiente de confirmar**, no dada por buena. | **antes de construir** §Post-F9.134 (es una pregunta de una línea) |
| **⭐ Las 10 preguntas de la relación 1:N** (§Post-F9.135) — un modelo de desarrollo del que nacen VARIOS de producción con **una sola receta**. Todas van **con default propuesto** y están en `DECISIONES.md` §Post-F9.135, sección «⭐ EL PLAN» §6. Las dos que más mueven el alcance: **la 6b** (¿se **prohíbe** además cambiar a mano una orden ya cortada? — sólo esa mitad dispara la etapa E5; la 6a, la del botón masivo, no) y **la 10** (se acaban los números de 5 dígitos: el aviso y el salto **ya existen**, lo que falta decidir es **qué dígito de continuación se le abre a Dama, Niño, Niña, Bebo y Beba**, que hoy no tienen ninguno). | **antes de construir** §Post-F9.135 — hoy es lo único que lo bloquea |
| **Historia de las 6 empresas viejas INACTIVAS** — ✅ **CERRADA (Daniel, 13-ago-2026, §Post-F9.37 punto 7):** *"Con el archivo basta. Ya no operan ahorita. Solo activa FR Moda."* **NO existen como `Empresa` operativa en v2.** Sus ~1,528 órdenes ya viven en el archivo histórico (§Post-F9.29) con su empresa original en `empresaV1`. Efecto colateral útil: la deuda de **membresía usuario↔empresa** (§4) **queda dormida** — con una sola empresa activa no muerde. ⚠️ **Si algún día se activa una 2ª, esa deuda pasa a BLOQUEANTE.** | — |

### Cerradas el 13-ago-2026 (repaso del flujo completo — `docs/DIAGNOSTICO-FLUJO-COMPLETO.md`)

Daniel cerró **nueve** decisiones de una sentada para desbloquear la primera versión. Están en
`DECISIONES.md` **§Post-F9.36** y **§Post-F9.37**; aquí solo el titular:

| # | Decisión | Efecto en el plan |
|---|---|---|
| 1 | **Ruta Crítica APAGADA en la v1** (*"hoy honestamente no lo estamos ocupando"*) | **Retira 5 bloqueantes**: sin ETL de F5, sin `UsuarioRol` de los 23, sin festivos, sin el admin viendo pendientes ajenos, sin alarmas falsas |
| 2 | **Una sola pantalla por acto en Producción** | Se queda el panel de avance (+ imprimir y segundas); se retiran `/produccion/{corte,envios,recibos}` |
| 3 | **`noProducir`: solo hacerlo visible** | Alcance mínimo |
| 4 | ⭐ **SE ARRANCA SIN CONTEO FÍSICO**, cargando el inventario sobre la marcha | **El importador Excel deja de ser bloqueante** — era el mayor riesgo de fecha. ⚠️ Vuelve **más grave** el bloqueo de autorización de OC: si el stock no nace de un conteo, la única vía es recibirlo |
| 5 | **Numeración: continúa saltando al escalón** (OP y OC) | Ver la fila de arriba |
| 6 | **El comprobante de entrega actual basta** | No se construye remisión ni packing list |
| 7 | **Solo FR Moda activa** | Ver la fila de arriba |
| 8 | **La cobranza la ven solo administración y Daniel** | El seed **se queda como está**; cierra EN CONTRA la pregunta abierta de F9-E4. **Deliberado, no olvido** |
| 9 | **El Pedido Real sí se puede cancelar** | Cierra el TODO abierto desde F2-E1 |

**Sigue abierta:** si la **salida de tela a una orden** debe generar un documento «nota de salida»
como en el viejo, o basta el movimiento de kardex (hoy la nota solo puede documentar avíos).

## 7. ¿Cuánto tarda? (gruesa, honesta)

Los agentes comprimen en horas lo que tomaría semanas; el **calendario real** lo mandan tus verificaciones por etapa, los pasos manuales de infra y, al final, las **2–4 semanas fijas de paralelo** (F10-E7, no se aceleran: son el seguro de que todo cuadra antes de apagar el viejo). Fases pesadas: **F3**, **F5** y **F10**. Orden de magnitud total: **unos pocos meses**.

## 8. Cómo se mantiene este documento (regla para toda sesión)

1. Al **cerrar una etapa**: cambiar su ⬜ → ✅ (con fecha) aquí **y** en la ficha de la fase; actualizar la sección *¿Dónde vamos?*.
2. Al **arrancar una fase**: revisar su ficha completa y confirmar/ajustar el desglose (los ajustes se escriben en la ficha, con una línea de por qué).
3. Decisiones de negocio nuevas → `Documentacion_MJD/DECISIONES.md`; decisiones técnicas → ADR en `docs/arquitectura/`. Este documento solo **apunta**, no duplica.
