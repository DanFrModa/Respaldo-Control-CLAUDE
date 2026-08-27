# V1 · Primera versión a producción — ficha de etapas

> **Origen:** el repaso del flujo completo del 13-ago-2026 (`docs/DIAGNOSTICO-FLUJO-COMPLETO.md`) y
> las nueve decisiones de Daniel (`DECISIONES.md` §Post-F9.36 y §Post-F9.37).
>
> Daniel: *"Ya quiero sacar la primera versión. Ya se fue mucho tiempo con esto."*
>
> **Esto NO es una fase nueva del plan** (F0–F10 no cambia). Es el **empujón de cierre**: la lista de
> lo que falta para que el sistema se pueda operar de verdad, ordenada por lo que bloquea.

## Cómo leer esta ficha

Cada etapa trae **qué entrega**, **qué NO entra** (para que nadie la infle), las **decisiones ya
tomadas** (no se re-abren) y el **criterio de cierre**. El detalle de cada hallazgo, con su
`archivo:línea`, vive en el diagnóstico — aquí no se duplica.

**Reglas que aplican a todas:** 1 coder + 1 reviewer independiente · nunca Docker local · la
documentación entra en el MISMO commit · nada se comitea sin autorización · un defecto conocido no
es "menor" (§7.3).

## ⭐ ORDEN DE EJECUCIÓN (DANIEL, 15-ago-2026) — *"ya quiero empezar a usar el sistema"*

> Daniel: *"Lo primero sería tener desde el desarrollo a inventarios pasando por compras de avíos,
> telas, estados de cuenta de maquilas (EsMa), etc."* Y sobre la Ruta Crítica y Costos: *"podría ser
> en una segunda etapa"* (confirma §Post-F9.36 punto 1).

**El punto de partida que cambia la lectura de esta ficha:** lo que Daniel pide **YA ESTÁ
CONSTRUIDO** — Desarrollo, compras de avíos y telas, inventarios, EsMa y producción son F1–F9,
cerradas. Lo que falta no es el negocio: son **las fugas, las defensas y el ensayo**.

| Ola | Etapas, en orden | Por qué |
|---|---|---|
| 🟢 **1 — la columna vertebral** | ~~`E3e`~~ ✅ → ~~**`E3d pieza B`**~~ ✅ *(en CI)* → ~~`E3b`~~ ✅ *(ya estaba, 13-ago)* → **`E4`** (defensas) → `E6` (arranque) → `E7` (el ensayo) | Es la cadena desarrollo → compras → inventarios → EsMa que Daniel nombró |
| 🟡 **2 — con el sistema ya en uso** | nomenclatura desarrollo/producción (§Post-F9.34/.46) · lo que queda de `E5` (días de crédito del cliente) | No bloquean capturar trabajo real |
| 🔵 **Segunda etapa** | **Ruta Crítica** · **Costos/EDR + indicadores** | Decisión de Daniel, ratificada el 15-ago |

**`E3d pieza B` se queda en la Ola 1 por decisión expresa de Daniel** (15-ago: *"sí lo haría de una
vez. Es importante"*), pese a ser la más grande y llevar migración. Coherente con lo que ya había
dicho el 14-ago: *"creo que sí es indispensable… así funciona en control viejo"*. Y tiene lógica de
cadena: **el MRP explota de la receta**, así que congelarla en la OP es lo que hace que las compras
salgan de lo que de verdad se va a producir.

⚠️ **`E5` punto 1 salió de la lista**: lo entregó `V1-E3c` el 15-ago (ver su nota).

---

## V1-E1 · Los cuatro arreglos del precosteo — ✅ HECHA (13-ago-2026)

Buscador en el selector de modelos · el cliente visible en el precosteo y en la ficha del desarrollo
· elegir un avío del catálogo en el renglón manual (con el precio resuelto por el dominio) · botón
«Generar lista de precios» desde el proyecto, **con motivo visible cuando no se puede usar**.

**Nota de cierre.** Cuatro rondas de revisión. Lo que el reviewer encontró y no se habría visto
probando a mano:
- **El botón de generar lista bloqueaba con un motivo FALSO** cuando el modelo ya había salido a
  producción (decía *"todos ya están en una lista"* estando en ninguna) — porque el habilitado se
  derivaba del estado, y `ligado-produccion` pisa a `en-lista`. Ahora **manda la consulta de
  candidatos del servidor**.
- **Y volvía a trabarse justo después de obedecer el mensaje**: congelabas el precosto, el badge
  pasaba a «Cotizado» y el botón seguía gris — faltaba invalidar la cache de candidatos. Candado
  cerrado: lo único que la refrescaba era abrir el diálogo, que el botón deshabilitado impedía.
- **Tres caminos escribían `precioUnit` sin redondear** mientras el importe se calculaba con el
  número completo. El peor no necesitaba que nadie tecleara nada raro: bastaba un avío comprado por
  caja (100/144 → se guardaba 0.69, el importe salía 4.17 en vez de 4.14). **Tres centavos que
  entraban al costo congelado y de ahí al precio del cliente.**
- El mismo defecto **un campo más allá**, en el promedio del consumo por talla. Se cerró con
  `redondear4` en `decimales.ts` y se aplicó también a los dos campos donde el consumo **se teclea**
  (inputs de texto libre, sin límite de decimales).

**Nota de despliegue:** sin migración, sin permisos nuevos, sin seed → **no** hace falta
`SEED_ON_START`.

---

## V1-E2 · Destapar la cadena de compras ⭐ — ✅ HECHA (13-ago-2026)

**El bloqueo #1 del sistema.** Sin esto no entra material al inventario — y con el arranque **sin
conteo físico** (§Post-F9.36 punto 4) esa es **la única vía**.

**Qué entrega**

1. **Autorizar una OC desde `borrador`**, y que la **Bandeja de autorización** liste lo que de verdad
   espera autorización. Hoy `pendiente_autorizacion` **no lo escribe nada** y la bandeja está vacía
   para siempre.
2. **Una prueba que fije que una OC recién creada se puede autorizar.** Es lo más valioso de la
   etapa: el fixture del test unitario usaba justamente el estado fantasma, por eso el CI nunca vio
   el bloqueo.
3. **Retirar el botón roto «Nueva nota de telas»** (cableado al motor legado por lote: selector vacío
   y un aviso que miente sobre un folio que no crea ninguna nota) y enlazar a la pantalla que sí
   opera, «Salida de tela a orden» por color.
4. **«Ajuste de materiales» se queda solo para avíos** (su pestaña de telas es el motor legado y lo
   capturado ahí no aparece en Existencias). Renombrar en el menú para que no compita con «Ajuste de
   telas por color».
5. **La recepción de avíos precarga el pendiente**, no el pedido completo, y **muestra lo ya
   recibido**. No se bloquea la sobre-recepción; se hace visible.
6. **Direcciones de entrega vacías:** explicar y **ofrecer el enlace** al catálogo (§Post-F9.16).

**Decisiones ya tomadas (lead):** se autoriza **directo desde borrador** —sin inventar un paso
intermedio— y la bandeja lista borradores; el valor `pendiente_autorizacion` **se queda en el enum**
(retirarlo pediría migración), solo se deja de depender de él.

**Qué NO entra:** el factor de conversión del MRP *(que acabó **retirándose** en `V1-E8a`, §Post-F9.97,
en vez de construirse)*, el amarre proveedor↔insumo, que la explosión
escriba al mirarla, y el renglón de tela de la nota de salida (pregunta de producto abierta).

**Criterio de cierre:** capturar una OC nueva, autorizarla, recibir su material y verlo en
existencias — sin tocar la base de datos a mano.

**Nota de cierre.** Tres rondas. **El bloqueo era 100 % de pantalla**: `autorizarOC` aceptaba
`borrador` desde siempre, así que **no se tocó una sola línea del dominio** — el reviewer lo verificó
en las tres rondas. Lo que faltaba era el botón.

Lo que el reviewer encontró en la corrección y sí cambiaba comportamiento:
- **El camino de error reintroducía el doble conteo.** Si la consulta de "cuánto llevas recibido"
  fallaba —y el cliente tiene `retry: false`—, la pantalla precargaba **lo pedido completo** y
  quitaba el letrero de Recibido/Falta, en silencio y **sin recuperarse en toda la sesión**. Ahora
  **no precarga nada**, lo dice con un aviso fijo y ofrece reintentar.
- **El aviso de direcciones mentía al fallar**: decía *"el catálogo está vacío"* y bloqueaba generar
  la OC **con el catálogo lleno**. Ahora tiene rama propia de error y **no bloquea por un error de
  lectura** (el servidor sí para la OC sin dirección).
- **«Ajuste de avíos» quedó colgando del padre «Telas»** tras el renombre — se movió a «Avíos».

**Nota de despliegue:** sin migración, sin permisos nuevos, sin seed → **no** hace falta
`SEED_ON_START`. ⚠️ **Para Daniel:** la bandeja de autorización lista **todos los borradores**,
incluidos los que estés armando a medias — es consecuencia directa de autorizar desde borrador. Si
estorba, se agrega después una marca de "en captura".

---

## V1-E3 · Cerrar el ciclo de producción

> **Partida en dos** (13-ago-2026): **E3a** el menú y las pantallas (✅ hecha), **E3b** los papeles y
> el arreglo del inventario de PT (pendiente). El corte se hizo porque la etapa juntaba demasiado y
> el árbol de trabajo solo admite un coder a la vez (`CLAUDE.md` §7.4).


**Qué entrega**

1. **Destapar el menú de Producción** (15 de 17 pantallas están fuera del riel) y **el hub de
   Calidad** (sus catálogos son inalcanzables desde toda la app porque el padre del riel no navega).
2. **La entrega a cliente en el panel de avance**, y una entrada de menú. Hoy la pantalla existe,
   funciona, y **no la enlaza nada**: el producto entra a PT y no sale nunca.
3. **Una sola pantalla por acto** (§Post-F9.36 punto 2): se queda el panel de avance y **se le agrega
   lo que hoy solo tienen las viejas** —imprimir y capturar segundas—; se retiran
   `/produccion/{corte,envios,recibos}`.
4. **Reimpresión**: los PDF hoy solo se ofrecen para el movimiento recién guardado. Si se cierra la
   pantalla, la hoja de envío del bulto ya no se recupera.
5. **La nota del TRASPASO de tela** (§Post-F9.38): mandar tela a un cortador **saca la tela
   físicamente** y el papel va con ella — hoy el traspaso **no genera ningún documento**. Impreso con
   folio, origen, destino, tercero y detalle por color, **reimprimible desde el historial**. Y
   **retirar el renglón de tela de la nota de salida**: la salida a una orden **no lleva nota**
   (basta el kardex), así que ese renglón no hay que arreglarlo — hay que quitarlo.
6. **El PT etiquetado por orden se puede mover** (movimientos manuales y traspasos validan contra el
   bucket «sin orden» mientras el recibo etiqueta con la orden: **son dos saldos que no se hablan**;
   la pantalla muestra existencia que el sistema rechaza mover). ⚠️ **Confirmado leyendo el código,
   no ejecutado** — verificar en vivo antes de tocar.
7. **`noProducir` visible y editable** (§Post-F9.36 punto 3).

**Qué NO entra:** la RC (apagada en v1), la programación de órdenes a maquileros, el estado final de
la orden ("Cortada" para siempre) salvo que salga barato al tocar lo demás.

**Criterio de cierre:** cortar, enviar a maquila, recibir con segundas, imprimir el papel del bulto y
entregar al cliente — todo desde el menú, sin escribir una URL.

### E3a — ✅ HECHA (13-ago-2026): el menú y las pantallas

Entregó los puntos 1, 2, 3, 4 y 7. **El punto 6 —el PT que no se puede mover— NO entró**: va en E3b (§Post-F9.40). El menú de Producción pasó de 2 a **6 hijos** (Centro de
Órdenes, Entrega a cliente, Tablero WIP, En poder del maquilero, **Consulta de órdenes** y Notas de
salida); `/produccion` dejó de pintar *"Próximamente"* y ahora es un **hub** que indexa las **14
sub-vistas** del módulo —las 6 del riel más las 7 que quedaron fuera, y «Tipos de proceso», que
cuelga de Catálogos—; *(«Documental» no aparece ahí: su ruta es `/documental`, así que vive solo en
⌘K)*; **Calidad pasó a hoja colapsada** y sus 4 catálogos huérfanos dejaron de
ser inalcanzables; la **entrega a cliente es la 6ª etapa del stepper** y el KPI «Por entregar» del WIP
lleva a entregar esa orden; se retiraron `/produccion/{corte,envios,recibos}` (con **redirección**,
no borradas, por los marcadores y los deep-links de RC).

**Lo que se migró ANTES de retirar** — sin esto se perdía funcionalidad: capturar **segundas**,
**los 4 impresos**, y —esto no estaba en el encargo, lo encontró el coder— el **precio pactado** y la
**fecha compromiso**. Sin el precio, el cargo EsMa nace vacío.

**Lo que la revisión encontró y no se habría visto probando a mano:**
- **Las decisiones (f) y (g) quedaron invertidas en la percepción**: el **sobre-corte, que SÍ se
  permite**, se pintaba en rojo como error; el **sobre-envío, que NO se permite**, no se frenaba y el
  usuario se comía un 400 con toda la matriz tecleada.
- Y una rama peor: **se podía enviar a maquila una orden con CERO cortado**. El panel derivaba bien la
  referencia y luego la **tiraba** cuando daba cero, creyendo que "sin base no hay contra qué
  comparar". Sí la había: cero cortado significa que no se puede enviar nada.
- **Un envío cancelado seguía imprimible** desde la barra del recién guardado — rompiendo la regla que
  el propio código declara (*"su papel no debe volver a salir con un bulto"*).
- **El comprobante de entrega** se ofrecía a quien el backend le devuelve 403.
- **El tablero WIP se quedó sin ninguna puerta para capturar** producción, con un comentario que
  afirmaba lo contrario.

**Decisiones del lead en esta etapa:** §Post-F9.41 (el precio pactado **se teclea sin permiso
especial**; solo su lectura se redacta) y §Post-F9.42 («Consulta de órdenes» entra al riel porque
**imprimir en lote es capacidad propia**, no una consulta duplicada).

**Deuda anotada, no arreglada:** `procesoCostura` toma **el primero** de los procesos con
`generaEntradaPt`, y al retirar las pantallas se perdió el escape de elegirlo a mano. Hoy no muerde
(el seed trae exactamente uno), pero hay que resolverlo **antes** de dar de alta un segundo. Está
anotado en el código con el arreglo correcto.

**Nota de despliegue:** sin migración, sin permisos nuevos, sin seed → **no** hace falta
`SEED_ON_START`.

### E3b — ✅ HECHA (13-ago-2026): los papeles y el inventario de PT

> **Estado:** ✅ **aprobada e integrada en `prueba`** — verificado el 16-ago contra la rama:
> `impreso-traspaso-tela.ts` y `SelectorOrdenPt.tsx` están ahí. *(La nota decía "revisión en curso"
> desde el 13-ago y se quedó congelada; con `V1-E3a` ✅ y `E3b` ✅, **`V1-E3` está COMPLETA**.)*

**1. El impreso del traspaso de tela** (§Post-F9.38). Mandar tela a un cortador la saca físicamente y
el papel va con ella. Se imprime **el folio que el traspaso ya tiene**: cero registros nuevos, cero
secuencias (Daniel: *"No debe de generar otro folio de nada. Me refiero a solo A la impresión del
folio que ya existe"*). El impreso vive en `backend/src/dominio/inventarios/impresos/impreso-traspaso-tela.ts`
y sale por `GET /inventarios/telas/traspasos/:id/impreso` con `inventario-telas.ver`; se reimprime
desde el cajón del kardex. Acepta **cualquiera de las dos patas** (el usuario hace clic en la que
tenga enfrente, entrada o salida) y **se niega** en tres casos: traspaso cancelado, movimiento que no
es traspaso, y pata huérfana —un renglón cuya contraparte no aparece—, porque un papel a medias es
peor que ningún papel.

**2. El renglón de tela sale de la nota de salida.** Al decidir Daniel que la tela consumida por una
orden **no lleva nota**, ese renglón dejó de tener para qué existir: se retiró de la captura. Lo ya
migrado **no se toca** —`RenglonTelaHistorico` se pinta de solo lectura—, siguiendo D3: no se edita
ni se borra lo que ya pasó.

**3. El PT etiquetado por orden ya se puede mover** (§Post-F9.40). Al mover a mano se **elige de qué
orden** salen (o a cuál entran) las piezas, y lo que ofrece `SelectorOrdenPt` **depende de la
dirección del tipo de movimiento**: en una **salida**, solo las órdenes con existencia real de ese
artículo en ese almacén —de un bucket vacío no se saca nada—; en una **entrada**, también las órdenes
del modelo cuyo bucket quedó en **cero**, y sin filtrar por almacén. Esa segunda mitad la trajo la
revisión: es el va-y-ven de estampado que la pantalla existe para operar —las piezas salen a
Aplicación (el bucket de la orden queda en 0) y al volver tienen que poder **regresar a su orden**; si
el cero las excluyera entrarían a «sin orden» y la entrega al cliente de esa orden diría "no hay
existencia" con la mercancía en el almacén—. En la entrada **no se anuncian piezas** junto a la orden:
ahí el disponible no es un tope y un "0 pzas" se leería como que no se puede elegir. El **traspaso se
queda solo con la regla de salida** en sus dos patas: el destino hereda la orden del origen y un
traspaso no crea piezas. Lo importante está abajo: `validarNoNegativo` bloquea y
suma contra **ese** bucket, no contra el total —si hay 100 piezas repartidas entre dos órdenes, sacar
80 de una que solo tiene 30 se frena—, y lo hace sumando movimientos bajo lock, nunca leyendo la
vista (D3). La **pata origen del traspaso valida igual**, y en la pantalla tanto el disponible que se
muestra como la advertencia de sobre-traspaso siguen el bucket elegido. Se agregó
`validarOrdenesDeLaEmpresa` (A9) en todos los caminos que aceptan `idOrden`.

**Las dos decisiones que la etapa tuvo que cerrar:**

- **La tela se rechaza al ALTA, y al EDITAR solo pasa la que ya estaba.** El rechazo del alta
  (`rechazarTelaEnAlta`) corre **antes de abrir la transacción**, para no quemar un folio en una nota
  que va a fallar. La edición no puede rechazarla del todo —hay borradores viejos que la traen y
  guardarlos los mutilaría en silencio, justo el daño callado que estamos persiguiendo—, pero la
  primera versión la aceptaba **entera**, y ahí la puerta no cerraba nada: bastaba crear un borrador
  con un avío y **editarlo metiéndole tela** para que naciera una nota 100 % de tela, se confirmara y
  saliera con folio (lo cazó la revisión). Ahora `exigirTelaYaEnLaNota` acepta un renglón de tela
  **solo si esa misma terna tela/lote/movimiento ya está persistida en esa nota**: se conserva
  exactamente el caso que justifica la excepción y nada más. Los tests del renglón de tela siembran
  el renglón **directo en la BD** (como lo trae una nota vieja) y afirman sobre el **mensaje** del
  error, para que ninguno pueda pasar por la razón equivocada.
- **`tipo` pasó de dos valores a tres**: `avio | tela | historico`. Lo migrado dejó de disfrazarse de
  renglón normal: `descripcionLegacy` **ahora sí se pinta** (antes se guardaba y no se veía), lo que
  vino con `cantidad = 0` muestra **«—» y no "0"** —un cero es una afirmación, y no sabemos que sea
  cierta— y lleva badge «Migrado».

**Nota de despliegue:** sin migración, sin permisos nuevos, sin seed → **no** hace falta
`SEED_ON_START`.

---

## V1-E3c · El editor de la receta del modelo — ✅ HECHA (15-ago-2026)

Salió de Daniel usando el editor de BOM en `prueba`. Seis observaciones suyas, **todas verificadas
contra el código**. Se agrupan porque tocan los mismos archivos (`EditorBom.tsx`,
`EditorMedidasAvio.tsx`, el contrato del modelo y el BOM del dominio).

**Sube de prioridad:** sin poder capturar el consumo por talla ni el proveedor amarrado, **el
precosteo no da los números reales** — cae siempre al fallback.

1. **⭐ El consumo por talla está roto EN CÍRCULO.** `EditorMedidasAvio` solo sabe **editar renglones
   que ya existen** y **nada en el sistema los crea**: no hay botón de agregar, ni selector de talla,
   ni deriva la curva del modelo. Nunca habrá filas, porque la única forma de crearlas es un PUT que
   la UI no puede componer. **Y el mensaje MIENTE**: dice *"El modelo no tiene curva de tallas"* pero
   el código **nunca mira la curva** (`medidas-avio-talla.ts:105-130` hace un solo `findMany` sobre
   `ModeloAvioTalla`). Sale igual con curva capturada. Agravante: la ficha del modelo **ni siquiera
   proyecta las tallas de la curva** (`modelos.ts:58,91` trae solo `curvaTalla.nombre`), así que hoy
   el frontend tampoco tiene con qué armar la lista.
2. **Tres columnas de AMARRE DE PRECIO sin escritor.** `ModeloAvio.idAvioProveedor`,
   `ModeloTela.idTelaProveedor` y `ModeloAvioTalla.idAvioMedida`: las **leen** el pre-costo (F7), el
   precosteo (F8), la cascada de resolución de precios y el MRP — y **nada las escribe** (no están en
   el contrato de captura ni en `sincronizarAvios`/`copiarBom`; los únicos que las asignan son tests
   de integración, con Prisma directo). **Toda la cascada de "precio amarrado" de D13/R17 está inerte
   en producción.** Es la promesa central del módulo de Desarrollo.
3. **La receta no muestra proveedor ni precio** del componente: la etiqueta es solo
   `clave — descripción` (`EditorBom.tsx:86,202,387-390`). Por eso Daniel "no lo ve": no está.
4. **Los selectores del BOM son `<select>` nativos con tope de 100.** El catálogo tiene **~877
   telas**: **777 son inalcanzables** desde ahí. Y el "buscar tecleando" de un `<select>` es el
   typeahead del navegador, que solo hace match **por prefijo** — de ahí *"solo encuentra por orden
   alfabético"*. ⚠️ **El backend YA busca bien**: `contains` insensitive sobre nombre, proveedor,
   color y pantone (`telas.ts:1575-1582`). El defecto es de pantalla, y son **4 sitios** con la misma
   forma: BOM, encabezado de orden, notas de salida y órdenes de compra. **El patrón correcto ya
   existe y está en producción**: `SelectorTela` (debounce + `busqueda` server-side + `ComboboxBuscable`).
5. ~~Quitar las tres banderas~~ — ❌ **RETIRADO (14-ago-2026). NO se quitan.** La propuesta nació de
   un *"esto está obsoleto… yo creo que lo quitaría"* de Daniel, y **el error fue del lead: se
   propuso quitarlas sin preguntar para qué existían.** Al día siguiente Daniel explicó su razón de
   ser, que es real y vigente: *"se negocia con el cliente que ya no lleve alguna cosa (por ejemplo,
   quitarle una jareta para abaratar el costo). El modelo original sí lo lleva, pero para producción
   ya no."* Las banderas son hoy el **único** mecanismo que existe para eso.
   **Lo que sí está mal no es que existan, es dónde viven:** la bandera es **del modelo**, no de la
   orden — apagarla afecta a TODAS las órdenes de ese modelo, incluidas las ya producidas. Eso se
   resuelve en **V1-E3d** (el BOM se congela en la OP). Después de E3d las banderas se quedan, con el
   significado limpio: qué lleva la **plantilla** para cada propósito. **No hace falta el conteo en
   `prueba`** que este punto pedía como prerrequisito.
6. **La lista es demasiado alta.** Cada renglón son ~110-150 px (tarjeta con borde + dos filas); **8
   avíos ≈ 1,150 px**. El `<fieldset>` de las tres casillas son **35 líneas de JSX** y el ~60 % del
   bulto: sin él, el renglón cabe en **una línea de ~44 px** y los 8 avíos bajan a ~400 px. El patrón
   a copiar ya está en el repo: `TablaDensa` (30+ pantallas) y la fila-compacta-con-panel-expandible
   de `AviosPagina`.

**Criterio de cierre:** capturar un avío por talla con su consumo, amarrarle proveedor y precio, y
que el precosto salga con **esos** números y no con el fallback.

### Nota de cierre (15-ago-2026)

**Por qué se construyó ahora:** Daniel abrió la pantalla de Modelos en `prueba` y dijo *"ya habíamos
hecho varios comentarios, pero no se hicieron… esto se supone que ya estaba hecho"*. Tenía razón: los
seis puntos llevaban dos días documentados y verificados contra el código, con etiqueta **PROPUESTA**
y sin una sola línea escrita. Ordenó *"éntrale a todo de una vez"*.

**Qué quedó, punto por punto** (el 5 estaba retirado de antes y no se tocó):

1. **El círculo se rompió por el lado correcto, y salió mejor que lo pedido.** No se agregó el "botón
   de agregar" que la ficha pedía: los renglones **nacen de la curva del modelo en el servidor**
   (`medidas-avio-talla.ts:130-180`), así que la matriz aparece completa sola. `tieneCurva` hace
   honesto el mensaje que antes mentía, y `enCurva:false` **conserva** las tallas de una curva vieja
   en vez de tirarlas.
2. **El amarre de precio ya se escribe** (`idTelaProveedor`, `idAvioProveedor`, `idAvioMedida`), de
   punta a punta y con prueba a nivel HTTP + aserción contra BD, incluido el rechazo de un amarre
   ajeno. `copiarBom` **conserva** el amarre y copia `ModeloAvioTalla` con su medida;
   `sincronizarAvios` **no** pisa la captura por talla. Con esto la cascada de D13/R17, que llevaba
   dos fases leída-pero-nunca-escrita, deja de estar inerte.
3. **La receta muestra proveedor y precio** — pero no como se había planteado: ver la decisión
   **§Post-F9.47**, que nació de esta revisión.
4. **Buscador de verdad**, reusando `SelectorTela`/`ComboboxBuscable` (el patrón que ya estaba en
   producción). Se acabó el tope de 100 que dejaba **777 de 877 telas inalcanzables** y el typeahead
   por prefijo del navegador (el *"solo encuentra por orden alfabético"* de Daniel).
6. **Renglón compacto** con el detalle en panel expandible. **Las tres banderas NO se quitaron** —
   sirven para negociar quitarle piezas al modelo—: solo dejaron de ocupar el 60 % del renglón.

**Lo que cazó el reviewer independiente, y que ninguna prueba manual habría visto** (rechazó la
primera entrega; los cuatro pasaban el CI en verde):

- **⭐ El cero fantasma.** La lectura sintetizaba `consumo: 0` para pintar la matriz y la UI lo
  **devolvía como captura real**: dejar XG/XXG en blanco creaba filas en cero. El precosto sacaba el
  promedio **con los ceros adentro** (0.45 → **0.27**: el avío costeado ~40 % por debajo, y de ahí al
  precio del cliente), y el MRP pedía **cero material** para esas tallas **sin levantar el aviso**
  `tallasSinMedida` — porque 0 es un valor *definido*. Se cerró distinguiendo *no capturado* de *cero
  de verdad* (el 0 tecleado es válido: hay avíos que no llevan en cierta talla).
  **Y la prueba consagraba el defecto** (`toEqual([{10,1.5},{11,0},{12,0}])` como correcto): se
  corrigió la prueba, no solo el código.
- **La receta enseñaba una cifra distinta de la que costea**, en tres caminos → §Post-F9.47.
- **El ETL del BOM borraba TODOS los amarres al re-correrse.** El endpoint es set-completo y el
  loader re-enviaba renglones de Access, que no traen amarre → todo a NULL, en silencio. Los ETL son
  re-corribles **por diseño** y la fase que sigue es **F10**: habría borrado esta etapa entera sin
  avisar. Ahora el loader relee el amarre de la BD y lo re-envía, con prueba de re-corrido
  (`etl-modelos.int.test.ts:183-219`).
- **De proceso:** el coder comiteó y empujó contra la instrucción expresa, y ese commit **reprobaba
  el CI solo** (llevaba `backend/openapi.json` pero no los dos generados del frontend, que el CI
  compara). Fue a rama de trabajo, no a `prueba`; se resolvió con squash.

**⭐ El quinto camino, que apareció buscando el cuarto.** Un avío **con medidas activas** (R5/B11) se
costea con el **promedio de los precios de sus medidas**, y ese escalón **GANA sobre el amarre**
(`precostos.ts:164-169`). La receta habría mostrado los $20 del proveedor amarrado mientras el
precosto costeaba **$6.00** — y amarrar un proveedor no movía la cifra. Se alineó igual que los
otros. Los cinco caminos hoy dicen la verdad: `amarre` (+ precio por color) · `mas-barato` (+ «sin
amarrar» / «amarre sin precio») · `promedio-medidas` · `referencia` · `sin-precio` (antes un `$0.00`
mudo).

**Refactor declarado, no silencioso:** `precioAvioDeCatalogo` se movió de `precostos.ts` (donde era
privada) a `resolucion-precios.ts`, para que la capa de lectura **no duplicara la regla** — que es
justo como divergen los números. Movimiento puro: misma aritmética y mismo redondeo.

**Dos cosas que se reportan y NO se tocaron** (§7.3: se dicen, no se callan):

1. ⚠️ **Dos motores costean distinto el mismo renglón.** `pre-costo.ts` (el pre-costo rápido de F7)
   usa `Avio.precioReferencia` cuando no hay amarre; el precosteo persistido usa **el más barato**.
   Está puesto a propósito («no-regresión: F7 NO aplicaba más barato», `pre-costo.ts:141-142`). La
   receta se alineó al **persistido**, que es el que fija precios de cliente y alimenta el MRP.
   **Decisión de negocio ABIERTA, planteada a Daniel:** ¿se unifican, o el rápido es para tantear y
   el formal para comprometerse? Mientras no se cierre, la diferencia es conocida y deliberada.
2. **`color-referencia` de la cascada de tela no tiene consumidores** — escalón preparado para el
   futuro. Cuando alguien lo encienda, la receta tendrá que decirlo (hoy no puede: el color se define
   hasta la orden).

**Criterio de cierre:** ✅ cumplido — se captura el consumo por talla, se amarra proveedor y precio, y
el precosto sale con **esos** números y no con el fallback.

**Nota de despliegue:** **SIN migración, SIN permisos nuevos, SIN seed** → el deploy a `prueba` **no**
requiere `SEED_ON_START`. Las tres columnas del amarre ya existían en el esquema desde F8; lo único
que faltaba era quién las escribiera.

---

## V1-E3d · El BOM vive en la OP, y el arte vive en el modelo ⭐ (14-ago-2026)

**Indispensable para la primera versión** (Daniel: *"creo que sí es indispensable… De hecho así
funciona en control viejo. El BOM debe de vivir en la OP"*). Decisiones en `DECISIONES.md`
**§Post-F9.43** y **§Post-F9.35**.

> **⭐ ABSORBE §Post-F9.35 (el arte sale del catálogo y se va al modelo).** Daniel, revisando el
> modelo en `prueba` el 14-ago: *"habíamos quedado que el arte ya no va a salir de un catálogo, sino
> que va a vivir en el modelo directamente. No tiene sentido usar un catálogo de artes"*. Estaba
> decidido con todo detalle el 12-ago pero **sin etapa asignada**, a propósito: *"por si aparecen
> otros cambios del mismo tipo que convenga hacer juntos"*. Apareció éste, y **son el mismo cambio**:
>
> | | Arte (§Post-F9.35) | BOM en la OP (§Post-F9.43) |
> |---|---|---|
> | Hoy vive en | un catálogo global | el modelo, en vivo |
> | Debe vivir en | el modelo, como **plantilla** | la OP, **congelado** |
> | El precio del modelo es | **referencia** | **referencia** |
> | El precio real se define en | **la OP** | **la OP** |
> | El override es | por arte **y por orden** | por renglón **y por orden** |
>
> **Daniel: _"Hazlo junto, el arte y el BOM de una vez"_** (14-ago). Razones: **una sola migración**
> (las dos tocan el mismo territorio), **una sola pantalla** de receta de la OP —donde el arte es un
> renglón más—, y **`costo-orden.ts` se toca UNA vez** (ahí se suman maquila, aplicación y artes;
> partirlo obligaría a reabrirlo dos veces). La ficha de E3d ya contemplaba copiar los **artes** a la
> receta de la OP, así que el arte por orden hacía falta de todos modos.
>
> **Lo que §Post-F9.35 ya dejó resuelto y NO se re-abre:** los **167 artes compartidos se duplican**
> al migrar (cada modelo con su copia + botón «copiar arte de otro modelo»); los **898 nunca usados
> NO se migran** (la depuración que Daniel quería, gratis); la **galería sobrevive**, armada desde
> los modelos y diciendo de qué modelo es cada foto.
>
> ⚠️ **Invariante que no se puede romper (§Post-F9.35):** el precio del arte **entra UNA vez por
> modelo, SIN multiplicar por cantidad** (así está testeado en `costo-orden.test.ts`). Al mover el
> arte al modelo desaparece el precio del catálogo y queda **un solo precio**; el cálculo debe seguir
> dando **exactamente lo mismo** para los datos existentes.
>
> **Se puede partir POR DENTRO** (primero el modelo y su arte, luego la receta de la OP) para poder
> probar antes — pero con **un solo diseño detrás**, no dos.

### Pieza A — ✅ HECHA (14-ago-2026): el arte se va al modelo

`ModeloArte` (nombre, tipo bordado/estampado, puntadas, **precio**, **proveedor** ⭐nuevo, foto) como
**hijo del `Modelo`**; el catálogo `Bordado` y el puente `ModeloBordado` **desaparecen**. Con botón
**«copiar arte de otro modelo»** (la conveniencia del catálogo sin reinventarlo) y la **galería
armada desde los modelos**, donde cada foto dice de qué modelo es. **85 archivos, +8,792 / −12,982**
— el saldo es negativo porque se retira más de lo que se agrega.

**Cómo se verificó la invariante del costeo** (que era la línea roja): la prueba de
`costo-orden.test.ts` **reimplementa la fórmula VIEJA** (`precioRenglon ?? precioCatalogo`), aplica la
resolución de la migración sobre los mismos datos y exige igualdad — cubriendo renglón-manda,
renglón-vacío-cae-al-catálogo, ambos nulos, **renglón en 0 que NO cae al catálogo**, y varios artes
mezclados. Hallazgo fino que lo confirma: el costeo viejo **no filtraba por `bordados.activo`**, así
que migrar los inactivos-pero-en-uso como artes vivos **preserva el costeo exacto** — es coherente,
no un descuido.

**La migración se EJECUTÓ, no solo se leyó** (Postgres nativo desechable; sin Docker, sin
testcontainers, sin `migrate dev`): `prisma migrate diff` → **«No difference detected»** (el DDL a
mano produce exactamente el schema); un arte de 3 modelos dejó **3 copias** con su foto; los precios
salieron clavados a la cascada vieja (incluido el **0.00 que NO cae al catálogo**); los nunca usados
**se reportan con `NOTICE`, no se tiran en silencio**; las 3 copias **comparten el mismo `Archivo`**
(correcto: `archivos.key` es único y R2 no se clona desde SQL); y la traza del precosto se re-apuntó
al arte del mismo modelo. Limpieza completa: tablas y enums viejos fuera, `bordados.ver`/`.administrar`
borrados de `permisos` **y** de `roles_permisos`.

**Permisos: CERO nuevos** (se quitan 2) → **este deploy NO requiere `SEED_ON_START`**.

**Ronda de corrección del reviewer (8 hallazgos, todos arreglados — §7.3: un defecto conocido no es
"menor"):**

- **El arte que se va NO se va en silencio (D3).** «Copiar receta» con *reemplazar* borraba el arte
  del destino registrando solo **cuántos** se crearon. Antes eso era inocuo (se borraba un puente y
  el catálogo conservaba los datos); ahora **esa fila ES el arte**. Se lee ANTES de borrar y cada
  renglón queda ÍNTEGRO en la bitácora (precio, proveedor, foto), y sus `Archivo` sin dueño se
  limpian con la misma regla de foto compartida.
- **La "deuda declarada" se cerró, y su enunciado era falso.** No solo quedaba una fila huérfana:
  copiar un arte y quitar su foto EN PARALELO podía dejar **la copia sin foto y su `Archivo`
  borrado** (el `count` no veía el INSERT aún sin commitear). Ahora `borrarArchivoSiQuedoHuerfano`
  toma `SELECT … FOR UPDATE` sobre la fila de `archivos` antes de contar: conflictúa con el
  `FOR KEY SHARE` del INSERT y serializa los quitados simultáneos. **Una línea, los dos casos.**
- **La depuración de los 898 descartados ya no depende de un `RAISE NOTICE`** (que
  `prisma migrate deploy` no propaga): la migración deja una fila por arte descartado en
  `mapeo_migracion` (entidad **`Bordado:DescartadoSinUso`**, datos completos en `datos`),
  consultable después del deploy. El `NOTICE` se conserva como comodidad.
- **El ETL vuelve a escribir POR LOTES** (regla de `CLAUDE.md` §8): el arte se agrupa **por modelo**
  en una transacción, con su mapeo dentro; el mapeo se precarga de un golpe (se va el N+1 de
  `leerMapeo`). Medido con 600 artes en 200 modelos: **601 → 201 transacciones**, **603 → 4**
  consultas al mapeo, −29 % de tiempo. Si un lote truena por data sucia se reintenta renglón por
  renglón (la tolerancia del ETL no se pierde).
- **Pruebas de vuelta:** se portó la prueba del hook «quitar foto» (`api/artes.foto.test.ts`,
  regresión de `d938e92`, un bug que llegó a producción) y se estrenó
  `dominio/modelos/arte-modelo.int.test.ts` (11 casos: foto compartida, bitácora completa del
  borrado, copiar arte, galería). Además, en `precostos.int.test.ts`, el arte ajustado que perdió su
  traza (`idModeloArte = null` por SetNull) **ya no se duplica** al recalcular: se reconoce por
  nombre (es la identidad del arte dentro del modelo).
- **Bitácora de `eliminarArte` completa** (faltaban `descripcion`, `orden` e `idArchivoFoto` — la
  foto es la que importa: sin ella nadie puede volver a nombrar el objeto de R2), comentarios
  rancios de "telas/avíos/bordados" corregidos, `vi.mock` a un módulo borrado retirado, y el
  razonamiento de por qué el `DELETE` de `archivos` de la migración no puede arrastrar una
  `modelo_foto`/`proveedor_archivo` escrito **junto al `DELETE`**.

**Sigue la pieza B:** la receta de la OP congelada + liberación por Desarrollo + el precio del arte
**por orden** + el ETL del histórico de `OrdenesHab`.

### El hueco

Hoy **la receta no se graba en la OP**: no existe ninguna tabla `OrdenTela`/`OrdenAvio`. Todo lo que
en producción necesita saber qué lleva la prenda va y lee el BOM del **modelo**, en vivo, en el
momento en que corre — el MRP y la habilitación con `paraProduccion`, el costeo real con `paraCosto`,
el semáforo de "orden completa" con `paraProduccion`.

Consecuencia: la bandera es del **modelo**, así que apagar la jareta de un cliente la apaga **en
todas las órdenes de ese modelo**, incluidas las ya producidas *con* jareta. Y no es hipotético — al
editar el BOM el código ya alcanza hacia atrás (`recalcularEstadoOrdenesDeModelo`). Con un solo
interruptor por modelo no se pueden tener dos clientes del mismo modelo, uno con jareta y otro sin.

### La evidencia del sistema viejo (medida, no recordada)

`OrdenesHab(IdOrdenes, IdHabilitacion, CantHabOrd, PrecioHabOrd)` — el viejo congela por orden el
avío, **la cantidad de esa orden y el precio de esa orden**. Sobre el volcado real (5,451 órdenes,
28,432 renglones):

| Hallazgo | Dato |
|---|---|
| Órdenes vivas con receta propia | **3,799** |
| Comparables contra el BOM de su modelo | 1,222 — de ellas **132 (10.8 %) NO coinciden** |
| … **quitaron** un avío que el modelo sí lleva | 72 *(el caso de la jareta, literal)* |
| … **agregaron** uno que el modelo no trae | 100 |
| … cambiaron una cantidad | 60 |
| Órdenes cuyo modelo **no tiene BOM**: la receta **solo** existe en la OP | **2,577** (2 de cada 3) |
| Renglones con **precio distinto** al del catálogo | **15,255 de 24,480 (62 %)** |

El 62 % del precio **no es negociación renglón por renglón**: es que la OP guardó **el precio del
día** y el catálogo siguió su camino (etiqueta de lavado catálogo $0.14 / orden $0.15; gancho 18"
catálogo $0.88 / orden $0.85, sistemáticos). O sea: el snapshot es tanto para **la historia** como
para el override.

**Dos precisiones que la memoria no traía:** el viejo **NO** congela la tela (`Ordenes.IdTelasDis` =
una sola tela en el encabezado, sin tabla por orden) y **NO** hace nada por orden con los bordados.

### Qué entrega

1. **Receta de la OP** — se copia del modelo **al crear la orden** (decisión de Daniel), con
   **cantidad y precio** por renglón. Se puede **quitar, agregar y editar**; lo tocado queda marcado
   para que un cambio posterior del modelo no lo pise. Mismo patrón que el precosteo ya usa
   (`ajustado` + `restaurarLineaBom`), que es el precedente probado del repo.
   **Incluye TELA**, aunque el viejo no lo hiciera: en v2 la tela tiene consumo por prenda y alimenta
   el MRP — dejarla fuera repetiría el hueco que la etapa viene a tapar.
2. **Liberación por Desarrollo.** Cada renglón nace como **propuesta sin revisar**; Desarrollo ajusta,
   define las **medidas por talla** y **libera**. Hasta entonces **no se puede explotar el MRP ni
   generar OC** de esa orden. **Cortar y producir NO se bloquean** (la puerta va antes de *comprar*,
   que es lo que Daniel pidió: *"la información correcta que se tiene que comprar"*).
   ⚠️ **NO se fuerza el OK uno por uno:** el 89 % de las órdenes lleva la receta del modelo tal cual;
   obligar a 8 clics por OP entrena a la gente a clickear sin leer. Estado por renglón
   (*sin revisar / revisado / ajustado*) + **un botón de "marcar todo revisado"**, y el que se desvía
   del modelo se pinta distinto. Permiso REUSADO `desarrollo.administrar` (ya existe, seed:245).
3. **Los cuatro consumidores leen la receta de la ORDEN**, no la del modelo: MRP, habilitación,
   costeo real y el semáforo de "orden completa" —que pasa de *"¿el modelo tiene avíos?"* a *"¿la
   receta de la OP está liberada?"*, mismo semáforo diciendo algo verdadero—.
4. **Los dos avisos de desalineación** (Daniel): al cambiar el BOM de un modelo se detectan las OP
   vivas desalineadas y se parten en dos.
   - **Sin OC todavía** → **rojo en el lugar de la decisión**: al explotar el MRP / generar la OC, los
     renglones que cambiaron salen marcados diciendo *qué* cambió (agregado / quitado / cantidad /
     precio). No necesita notificación: la persona ya está ahí, a punto de gastar.
   - **Con OC ya hecha** → **aviso visible en la orden**, calculado igual, en el momento de abrirla.
   ⚠️ **SIN evento, SIN outbox, SIN estado acumulado** (Daniel, 14-ago: *"ya veremos si vale la pena
   lo de los correos o no… no tiene caso ahorita hacer nada de eso"*). La desalineación **se calcula
   al vuelo**: la receta de la OP está congelada y el BOM del modelo está vivo, así que la diferencia
   sale de comparar los dos cuando alguien abre la pantalla. **Lo único que compraba el evento era
   EMPUJAR** el aviso hacia quien no está mirando — que es exactamente lo que hace el correo; sin
   correo, no compra nada. *Se pierde saber cuándo cambió y qué decía antes, y no importa: lo que se
   revisa es la diferencia de HOY, que es contra lo que se va a comprar.* Si el correo llega a valer
   la pena, agregar el evento entonces es chico; el costo aceptado es que no se podrá mandar lo
   ocurrido antes.
5. **ETL del histórico, FUERA del catálogo.** Los 28,432 renglones de `OrdenesHab` **hoy no se
   migran** (ni una mención en `migracion/` — se tiran completos). Entran al **archivo histórico**
   como cuarta tabla junto a `HistoricoOrdenV1Linea`/`Proceso`, con la **regla ya establecida en
   §Post-F9.28**: el avío va como **TEXTO**, no como FK. Con eso **no se crea ni un solo registro en
   el catálogo de avíos**, no sale en ningún selector, es de solo lectura y **no hay botón de "traer
   al catálogo"** —ese botón sería la puerta trasera por la que volvería la basura de 30 años, y por
   eso tampoco existe en el directorio histórico—. Es la respuesta literal a la condición de Daniel:
   *"no quiero que interfiera con el nuevo catálogo"*.

### Decisión pendiente, con default aplicado

Si Desarrollo ya liberó y **después** cambia el BOM del modelo: **la OP queda congelada** (para eso se
congela), con aviso de *"el modelo cambió desde que se liberó"* y opción de traer los cambios **a
mano**. Mismo comportamiento que el precosteo con sus renglones ajustados. Daniel lo aprobó.

### Criterio de cierre

Dos órdenes del mismo modelo, una con jareta y otra sin, que compren cosas distintas y cuesten
distinto — sin que ninguna de las dos altere a la otra ni a las ya producidas.

### Nota de cierre de la pieza B (16-ago-2026)

**Criterio de cierre: ✅ cumplido y VERIFICADO por el reviewer**, no aceptado por lectura. Corrió
`receta-orden.int.test.ts` contra Postgres real (40/40) y comprobó que **las aserciones discriminan**:
la orden A lleva la jareta y explota 3 renglones, la B no la lleva y explota 2 — con el código viejo
B daría 3 y la prueba fallaría. Habilitación 2 vs 1, costeo 12 vs 4. Y el segundo caso —el modelo
pierde la jareta *después*— exige que la orden ya producida siga costeando 12 con la jareta presente.

**Qué quedó**

1. **Cuatro tablas** (`OrdenTela` · `OrdenAvio` + `OrdenAvioTalla` · `OrdenArte`) con cantidad, precio,
   las tres banderas, el amarre de proveedor, `estado` por renglón, `agregadoAMano` y `excluido`.
   La receta se **copia del modelo al crear la orden** y ahí se congela.
2. **Seis consumidores** dejan de preguntarle al modelo: MRP, habilitación, costeo, semáforo, **el
   impreso de la OP** y **la Ruta Crítica** — los dos últimos los encontró el coder, no la ficha. El
   impreso *"mentía en una de dos órdenes hermanas"*.
3. **Cortado el alcance hacia atrás:** `recalcularEstadoOrdenesDeModelo` ya no lo llaman
   `bom-modelo.ts` ni `arte-modelo.ts`. Editar el BOM de un modelo dejó de alcanzar a las órdenes
   vivas.
4. **ETL** de los 28,432 renglones de `OrdenesHab` —que **hoy se tiraban completos**— al archivo
   histórico, con el avío como **TEXTO, no FK** (§Post-F9.28): cero registros nuevos en el catálogo,
   sin selector y **sin botón de "traer al catálogo"**.
5. Las **seis reglas de negocio** que la construcción obligó a fijar están en `DECISIONES.md`
   **§Post-F9.50**.

**La migración: "impecable" (palabra del reviewer), y la EJECUTÓ él mismo** contra un Postgres nativo
desechable con cinco casos sembrados — modelo con BOM → liberada · **cancelada → NO** · **modelo sin
BOM → vacía y NO liberada** · **solo arte → SÍ** (el `EXISTS` no deja hueco) · solo tela → sí. Banderas
conservadas una por una (`para_produccion=false` de la jareta sobrevivió), `precio` NULL en todo, y
**bitácora por orden que dice la verdad orden por orden**. `prisma migrate diff` → **«No difference
detected»**: las 254 líneas escritas a mano producen exactamente el esquema.

**DOS RONDAS de revisión, catorce hallazgos, ninguno archivado como "menor".**

*Primera ronda (8):* re-agregar un renglón vivo lo **sobrescribía en silencio** · el backfill y el ETL
**liberaban recetas vacías** · el aviso de precio **se disparaba por compras y nombraba mal la causa**
· el primer aviso de §Post-F9.43(d) **no existía** · la puerta **no cubría la OC capturada a mano** ·
un **sexto consumidor** (RC) seguía preguntándole al modelo · y cinco menores.

*Segunda ronda (6), con dos violaciones de D3 **dentro del módulo nuevo**:*

- **⭐ El botón «Restaurar al modelo» destruía el precio congelado sin dejarlo escrito.** El reviewer
  no lo dedujo: lo **ejecutó**. Dejó el renglón en `precio 9.99 / consumo 4`, restauró, y en la
  bitácora solo quedaron los valores del modelo — *"los 9.99 no existen en ningún lado"*. Un clic
  desde la pantalla, sobre **el dato exacto que la etapa existe para proteger**. ⚠️ **Era el MISMO
  defecto que la pieza A ya había cerrado para el arte** (*"se lee ANTES de borrar y cada renglón
  queda ÍNTEGRO en la bitácora"*), y las funciones que lo resuelven —`fotoTela`/`fotoAvio`/`fotoArte`—
  **ya vivían en ese mismo archivo**, escritas por el propio coder y usadas en quitar y en revivir.
  La lección no viajó del arte a la receta.
- Lo mismo, más chico, en **editar**: un `antes` de dos campos, con las medidas por talla borradas
  por el set-completo yéndose sin registro.
- **La promesa incumplida:** §Post-F9.43(c) dice literal *"Desarrollo ajusta, **define las medidas por
  talla** y libera"* — y la pantalla las mostraba **en texto plano**. El único camino era editar el BOM
  del **modelo** y pulsar «Restaurar», o sea empujar hacia la plantilla justo lo que la etapa vino a
  sacar de ella. **Se construyó** (celda editable por talla, conservando el `idAvioMedida` del
  catálogo), no se archivó con una excusa — se le había ofrecido esa salida y el coder eligió construir.

*Tercera ronda (4), las dos primeras **reproducidas ejecutando el dominio**, no deducidas:*

- **⭐ El arreglo de la puerta la abrió de más.** La exención que permitía a Compras corregir una OC ya
  hecha se aplicó **por ORDEN, no por línea**. El reviewer lo reprodujo: con la firma **revocada**,
  metió una **línea nueva de 5,000 kg de otra tela** a la OC ligada y **pasó**. Eso es literalmente
  *"gastar dinero contra una receta que nadie miró"*, el único propósito de la puerta. Se cerró con
  identidad **material + conteo** (`tela:{id}`/`avio:{id}`/`libre:{desc}`), y el reviewer comprobó
  después los tres huecos que quedaban: **cambiar el material** de una línea existente, **duplicarla**
  y **dos líneas libres con la misma descripción** — los tres rechazados.
- **⭐ Un comentario que MENTÍA.** El arreglo de H5 declaraba en el código y en un comentario de prueba
  que *"su desviación se sigue vigilando en vez de volverse sorda para siempre"*, y era **falso**:
  `comunesNuevo` seguía poniendo `estado: 'ajustado'` a todo renglón nuevo, y `desviadoAProposito` lo
  callaba igual. El reviewer lo probó (`consumo orden 1 / modelo 9 → hayCambios = false`). Se corrigió
  **haciendo cierta la frase** —el renglón copiado fiel del modelo nace `revisado`— en vez de borrarla.
  *Un comentario falso es peor que ninguno: el siguiente que lo lea lo va a creer.*
- **H3 quedó a medias:** *ajustar sí, definir no*. El editor de la OP era un **subconjunto estricto**
  del del modelo. Se completó **extendiendo V1-E3c**, no reinventándolo (ver abajo).
- La documentación del campo `agregadoAMano` quedó contradiciéndose tras cambiarle el significado —
  incluida **la descripción publicada en el OpenAPI**.

**⚠️ LA LECCIÓN DE PROCESO DE ESTA ETAPA: la lección no viajó, dos veces.** El H1 de la segunda ronda
era **el mismo defecto que la pieza A había cerrado dos días antes** para el arte, con la función del
arreglo viviendo **en el mismo archivo**, escrita por el propio coder y ya usada en otros dos caminos.
Y H3 volvió a resolverse sin mirar cómo se había resuelto el problema idéntico en V1-E3c. A la tercera
se le dijo explícitamente; el coder abrió `medidas-avio-talla.ts` + `EditorMedidasAvio` **antes de
escribir una línea**, y el resultado fue *la misma forma con el universo cambiado*, no una
implementación paralela. **Saber que un módulo vecino ya resolvió tu problema no es opcional: es parte
de la tarea.**

**El editor de medidas por talla en la OP** (N4) trajo las tres reglas de V1-E3c con **el universo
cambiado**: los renglones nacen de **la matriz color×talla de la ORDEN** (en el modelo era la curva),
porque es lo que esa orden produce y lo que el MRP explota; `null ≠ 0` en el contrato (vacío
descaptura, un `0` tecleado se guarda); selector de `idAvioMedida` y toggle `consumoPorTalla`
operables desde la orden. Una medida capturada de una talla que la orden **ya no lleva** no
desaparece: sale marcada `enLaOrden: false`, y el reviewer verificó **contra el servidor** que el MRP
la ignora por completo.

**⭐ El arreglo de H5, que salió mejor que el encargo.** El aviso *"el modelo agregó X"* no tenía
acción, y traer el material con «Agregar» lo hacía nacer sin amarre, sin medidas y **marcado
`agregadoAMano`, con lo que su desviación quedaba sorda para siempre**. El coder no puso un letrero:
**cambió el significado del campo**. `agregadoAMano` dejó de ser *"lo agregó una persona"* y pasó a ser
**"esto no está en el modelo"**. Así, un material que sí vive en el BOM hereda precio, banderas, amarre
y su juego de medidas, nace con `agregadoAMano: false` y **se le sigue vigilando**; solo lo ajeno al
modelo queda a mano. Refuerza `desviadoAProposito` en vez de parcharlo.

**Lo que el reviewer acreditó y no hay que deshacer:** `desviadoAProposito` es *"el corazón fino de la
etapa"* (22 casos unitarios sin BD) · **separar `precio-mercado`** es *"la clase de detalle que solo se
ve pensando en el día 30"* —sin eso, cada OC autorizada dejaría en **rojo permanente** a toda orden
viva con esa tela— · `exigirNoEstaVivo` resuelto **en el contrato**, no con un parche · el test de RC
usa **dos modelos distintos a propósito** para que el reuso de parámetros no tape lo que mide, que es
*"escribir la prueba pensando en cómo podría mentir"*.

**Una sospecha que el reviewer descartó PROBÁNDOLA:** temió un aviso de precio espurio permanente por
congelar a 2 decimales un `precioCosteo` con más (promedio de medidas: (0.14+0.15)/2 = 0.145). Lo montó
y **no ocurre**: `redondear2` en `bom-modelo.ts:311,453` deja a los dos lados comparando la misma cifra.

**Lo que se acepta por lectura, dicho de frente:** el **e2e** no se pudo ejecutar (exige Docker,
prohibido) — lo juzga el CI. Y el reviewer no terminó la suite de integración completa por lentitud del
contenedor; sí corrió el archivo de la etapa.

**Nota de despliegue:** ⚠️ **REQUIERE MIGRACIÓN** (4 tablas + backfill). **Es el primer despliegue de
la sesión que no se deshace con un clic** — conviene coordinarlo con Gabriel. Permisos: **ninguno
nuevo** (reusa `desarrollo.administrar`); seed: no.

---

## V1-E3e · Un solo costo: manda el precio REAL de compra ⭐ (15-ago-2026)

**Nace de la revisión de V1-E3c**, que destapó que conviven **tres cifras** para el mismo renglón: la
receta, el pre-costo rápido de F7 y el precosto congelado. Daniel, al enterarse: *"No hay ningún
motivo por el cual tener dos precios distintos. Hay que unificarlo. Si ya tenemos precios reales, lo
mejor es tomar ese costo. El más actualizado."* Decisión completa en `DECISIONES.md` **§Post-F9.48**.

**No es una idea nueva:** es el mismo criterio que Daniel ya dictó el 26-jul (§Post-F9.5) para el
costo real de una orden. Lo que falta es **extenderlo a la receta y al precosteo**, que siguen
viviendo del catálogo.

**Qué entrega**

1. **Una sola cascada** para todos los motores: último precio de **compra real** → precio del
   proveedor en catálogo → `precioReferencia` (**solo lo nunca comprado**) → `sin-precio`.
2. **El amarre elige el PROVEEDOR; el precio es el de la última compra a ESE proveedor** (decisión
   fina de Daniel, elegida de tres opciones). El trabajo de negociación no se tira y el costo no se
   queda viejo.
3. **`pre-costo.ts` deja de ser un motor aparte.** El reviewer verificó que **no escribe nada** (es
   lectura pura), así que alinearlo **no mueve ningún precio pactado**. Cierra sus **cuatro**
   divergencias, no solo la que estaba documentada.
4. La receta muestra el nuevo origen, con la misma regla de §Post-F9.47: **nunca una cifra distinta
   de la que costea, y siempre diciendo de dónde salió**.

**Qué NO entra:** cambiar qué se considera "comprado" — se reusa §Post-F9.5 regla 1 (**manda la OC
autorizada**, no lo recibido ni lo surtido).

⚠️ **A diferencia de §Post-F9.47, esto SÍ cambia el motor.** Los precosteos **congelados no se
mueven** (son fotografías), pero **todo cálculo nuevo dará números distintos** a los de ayer — por
diseño, que es justo lo que Daniel pidió. **Exige pruebas de no-regresión** de que lo congelado sigue
dando lo mismo.

**A decidir al construir:** si el último precio de compra se lee **en vivo** o se **materializa**
(rendimiento — lo consultan la receta, el precosteo y el MRP). Reusa la maquinaria que ya existe en
`dominio/costos/costo-real-compras.ts`.

**Criterio de cierre:** el mismo renglón, visto desde la receta, el pre-costo rápido y el precosteo,
da **el mismo número** — y ese número es el de la última compra real.

### Nota de cierre (15-ago-2026)

**Qué quedó**

1. **La regla se EXTRAJO, no se copió** — `dominio/costos/ultimo-precio-compra.ts` (nuevo). La lógica
   del "último precio de compra" vivía **privada** dentro de `costo-real-compras.ts` (§Post-F9.5);
   ahora es un módulo propio del que ése importa. **Una sola** definición de *comprado* (OC autorizada
   / recibida parcial / total) y **un solo** desempate (`fecha DESC NULLS LAST → folio DESC → renglón
   DESC`). Duplicar la regla es exactamente cómo divergen los números — el defecto que la etapa vino a
   matar—, así que copiarla habría sido construir el problema de nuevo. De paso, `costo-real-compras`
   pasó de un `findFirst` por material a **una consulta por lote**.
2. **La cascada única** en `resolucion-precios.ts`, con el escalón 1 por encima del catálogo, en tela
   y en avío. El cruce con el amarre tal como lo dictó Daniel: **el amarre elige el proveedor; el
   precio es el de la última compra a ESE proveedor**; si nunca se le compró, su precio negociado; si
   tampoco, la cascada general. **Los campos nuevos son opcionales** → quien no los pasa obtiene la
   cascada de antes, idéntica.
3. **`pre-costo.ts` dejó de ser un motor aparte:** cerradas sus **CUATRO** divergencias (no solo la
   que su propio comentario documentaba) — la del "más barato", `promedio-medidas`, `consumoPorTalla`
   y el redondeo antes de multiplicar.
4. **Se retiró la re-implementación de la cascada en TSX** (`AmarreTela`/`AmarreAvio`): era una
   **quinta divergencia** y ya no podía acertar, porque al cliente le falta el histórico de compras.
   Ahora el renglón conserva el precio que costea hoy y marca *"falta guardar"*. El reviewer: *"fue la
   decisión honesta: el cliente ya no puede acertar y ahora no lo finge."*

**En vivo por LOTE, no materializado** (decisión del coder, con razón escrita). Una sola consulta
`DISTINCT ON` para todos los materiales pedidos → **O(1) consultas por llamada**; la lista de precios
resuelve **todo el catálogo en 3 consultas fijas**. Se descartó materializar (`Tela.ultimoPrecioCompra`)
por la invalidación: habría que actualizarla en **cinco caminos** (autorizar / des-autorizar / cancelar
/ editar renglón / borrarlo) **más el ETL**, y el que se olvide deja un precio falso **en silencio** —
justo la clase de defecto que la etapa combate—. Además choca con D3 (la existencia es la suma de
movimientos, nunca un nivel guardado).

**⭐ La línea roja, verificada por el reviewer en TRES vías** (no se le aceptó al coder):

1. **Estructural:** la lectura del precosto es proyección pura de filas persistidas — **no hay
   recálculo en lectura**, así que un cambio de precio de compra no puede alcanzar una foto congelada.
2. **Guarda:** `exigirBorrador` protege los **6** caminos de mutación, y en cada uno corre **antes** de
   leer las últimas compras, bajo el advisory lock por desarrollo.
3. **Prueba:** un precosto se congela con la tela a $30 (total 70), **después** entra una OC autorizada
   a $55, y al re-leer sigue en 70 — el total proyectado, el `precioUnit`, el `importe`, **el valor
   persistido en BD** y el `ErrorConflicto` de `recalcularDesdeBom`. Y la **versión nueva sí da 120**:
   el cambio por diseño, visible. *(De regalo, otra prueba: una compra de OTRA empresa no altera este
   precosto — A9.)*

**El defecto que el coder cazó ANTES de entregar, y no calló.** Su primer `DISTINCT ON` ordenaba por
las claves del grupo y no por fecha, así que el ganador global habría sido **el del proveedor con id
más chico**, no el más reciente — un precio equivocado **en silencio**. Lo corrigió y le puso dos
pruebas discriminantes; el reviewer comprobó que **sí discriminan** (verificó el orden de creación de
los proveedores: la versión con el bug fallaría).

**Lo que encontró el reviewer y entró en la ronda de corrección:**

- **Se había apagado la alerta de "tu amarre no se está usando".** Excluir `ultimo-precio-compra` del
  chip crítico es correcto en el caso normal, pero se excluía **incondicionalmente**. Escenario
  alcanzable: se amarra la tela a Alsatex para fijar la relación, su `precio` sigue en blanco (columna
  nullable — amarrar antes de capturar el precio es lo normal), nunca se le compró, y la última compra
  fue a **otro** proveedor. La cascada salta el amarre y costea con el precio del otro: la cifra es
  correcta, pero **el aviso desapareció justo en el camino que esta etapa vuelve el más común**.

  **Cómo se cerró:** el dato lo calcula el **servidor** (`amarreNoFirmaElPrecio`), comparando **ids de
  proveedor, nunca nombres**, y sale al contrato como `amarreIgnorado`. Su `default → true` hace que
  **un escalón nuevo que alguien agregue mañana grite por omisión** en vez de callarse — la polaridad
  correcta para una alerta. Con **pruebas pareadas** (front y backend): una exige que grite en el caso
  del amarre sin precio, su gemela exige que **se calle** cuando la compra sí es del amarrado. Ya no se
  puede "arreglar" en una dirección sin romper la otra.
- **Un aviso que describía mal su propia causa.** El del multi-color decía *"se usó el precio base del
  proveedor"*, pero se armaba **antes** de que D1 pisara el precio. El reviewer lo marcó como nit; se
  arregló igual (§7.3: un defecto conocido no se archiva) porque es **el mismo pecado que esta etapa
  vino a corregir en la receta — decir una cosa y hacer otra**. Al escribirlo apareció que **mentía en
  DOS casos, no en uno**: un proveedor amarrado *sin precio base* hacía caer la cascada al precio de
  catálogo de la tela y el aviso seguía atribuyéndoselo al proveedor. Se resolvió por la vía buena —el
  aviso **se arma después de resolver el precio**— y hoy los cuatro estados alcanzables tienen su
  texto fiel.

**Dos decisiones de Daniel que llegaron con la etapa ya aprobada** (§Post-F9.49):

- **El precio de la OC del MRP** nace de lo último que **ESE** proveedor cobró. Respeta al 100 % la
  objeción del coder —que el reviewer había avalado— de no poner **nunca** el precio de un tercero: el
  helper solo consulta el mapa **por material+proveedor**, jamás el global, y **no cambia el proveedor
  en ninguna rama** (a quién se le compra lo sigue fijando R1/F4). Verificado por el lead además del
  reviewer: no existe la línea de código que podría poner el precio de otro.
  **⭐ Y el coder blindó de más, con razón:** si el precio salió de `amarre-color`, **no se pisa** —
  `OrdenCompraLinea` no guarda color, así que la última compra es ciega a él y dejarla ganar cotizaría
  una tela negra con el precio de la blanca. El MRP es el **único** llamador con color, o sea el único
  donde esa ceguera estaría viva. El reviewer repasó los cuatro casos de *"hay color pero ganó otro
  escalón"* y confirmó que en todos pisar el precio es lo correcto, y que `color-referencia` es
  **inalcanzable** en el MRP.
- **La migración deja de borrar lo capturado en v2**, y el agujero era **más ancho** que el amarre: el
  set-completo borraba **el renglón entero** que el CSV no trae y, por cascada, sus `ModeloAvioTalla`.
  La regla quedó en una línea: **«el CSV manda en lo que trae; la BD manda en lo que el CSV no trae»**,
  con la consecuencia asumida escrita al lado (una baja hecha en Access después de una corrida ya no se
  propaga sola — el intercambio que Daniel eligió). Con prueba de re-corrido que afirma los valores
  **exactos** y comprueba que el renglón migrado **sigue** actualizándose: no se "arregló" preservando
  todo y dejando de migrar.

**Lo que NO entró, con su razón (§7.3: se dice, no se calla):**

- **`promedio-medidas` sigue ganando** al último precio de compra: una línea de OC se liga al **avío**,
  no a la medida, así que su precio es el de **una** medida y cotizaría mal a las demás.
- **La misma ceguera existe con el color de las telas** y quedó escrita: `OrdenCompraLinea` no tiene
  color, así que la "última compra" de una tela es tan ciega al color como al tamaño en los avíos. **No
  está vivo** (ningún llamador pasa `precioColor`), pero el día que alguien meta color al precosto, una
  tela negra se costearía con el precio de la blanca comprada al final.
- ~~**Deuda pre-existente que ahora se ve más:** con factor de conversión ≠ 1, el último precio arrastra
  el defecto conocido del MRP (`HOJA-DE-RUTA` §4). `costo-real-compras` avisa; la receta y el precosteo
  todavía no.~~ → ✅ **Sin sujeto desde `V1-E8a` (26-ago-2026):** el factor de conversión se retiró
  (§Post-F9.97), así que ya no hay un ≠ 1 posible ni deuda que arrastrar; el aviso de
  `costo-real-compras` desapareció con el problema que anunciaba.

**Nota de despliegue:** **SIN migración, SIN permisos nuevos, SIN seed** → no requiere `SEED_ON_START`.

---

## V1-E4 · Las defensas contra el daño callado

Lo peor que puede pasar en producción no es que algo truene: es que corrompa datos sin avisar.

**Qué entrega**

1. **Que importar dos veces la misma OC del cliente no duplique todo** (hoy crea pedido, órdenes, nº
   de producción, RC y MRP por duplicado, en silencio; se descubre semanas después cortando doble).
2. **Que no se pueda congelar un precosto con costo cero** por falta de receta — esa versión es
   inmutable y puede acabar de base de un precio al cliente.
3. **El resurtido**: hoy la segunda OP de un renglón no se puede crear desde la pantalla, aunque el
   backend lo modela a propósito.
4. **Que un renglón de lista de precios se pueda quitar** y una lista borrar: hoy un desarrollo
   metido por error **queda atrapado para siempre**.
5. **Que «Cancelar pedido» diga la verdad** — hoy afirma que deja de producirse y las OPs siguen
   vivas, cortándose.
6. **Cancelar el Pedido Real** (§Post-F9.37 punto 9), suave y con motivo.
7. **Los selectores topados a 100** que quedan (clientes ~117, colores al generar la OP), con el
   patrón de búsqueda server-side que ya se usa.

**Criterio de cierre:** cada uno con su prueba de regresión. Sin prueba no cuenta: son defectos que
por definición nadie nota al probar a mano.

### Nota de cierre — ✅ HECHA (16-ago-2026)

**Los siete, verificados contra el código antes de tocarlos.** Dos resultaron **peores** que la ficha:
el punto 4 no era *"queda atrapado"* sino **para siempre** (el `@@unique([idDesarrollo])` impedía que
ese desarrollo entrara **nunca** a otra lista), y el punto 7 no era una pantalla sino **doce**.

**Qué quedó:** defensa anti-duplicado en los **dos** importadores (identidad `ocCliente`+cliente,
**excluyendo canceladas**, con re-verificación dentro de la tx bajo `pg_advisory_xact_lock`) ·
precosto que ya no se congela en cero · resurtido creable desde la pantalla · renglón y lista de
precios liberables **con el objeto íntegro en bitácora** · «Cancelar pedido» que dice la verdad y
puede cancelar en cascada con motivo · Pedido Real cancelable (cierra el TODO de F2-E1) · y el
buscador server-side en las 12 pantallas de cliente. Reglas de negocio en **§Post-F9.51**.

**TRES rondas de revisión. Lo que cazó el reviewer, y cómo:**

- **⭐ Ronda 1 — cuatro de las pruebas de la propia etapa estaban ROJAS.** Se habían reportado como
  *"escritas, no verificadas"* porque la integración exige testcontainers (prohibidos). El reviewer
  demostró que **sí se pueden correr**: Postgres nativo desechable, y ahí aparecieron. El código de
  producción era correcto; **el arnés no**. Un fake reiniciaba su contador en cada llamada y la 2ª
  importación chocaba por `unique` **antes** de llegar a su aserción — o sea que los dos casos ⭐ que
  blindan la defensa **no los verificaba nadie**.
- **⭐ Ronda 2 — el punto 4 NO FUNCIONABA: reventaba en el 100 % de las llamadas.** `esDecimal` usaba
  el operador `in` sobre un primitivo → `TypeError` con **cualquier** fila (todas traen `id: number`).
  «Quitar renglón» y «Borrar lista» daban toast rojo **siempre**: la trampa que la etapa venía a abrir
  seguía cerrada. **Lo introdujo la corrección de la ronda 1** — sexta vez en el proyecto que un
  arreglo mete un defecto nuevo, y la causa fue exactamente que **esa corrección no llevó prueba**.
- **Dos regresiones de UI las introdujo el arreglo del punto 7**: un diálogo perdió su candado de
  edición, y **la selección precargada se veía VACÍA** (con búsqueda server-side el combobox sólo
  conoce 10 clientes; al editar un pedido de cualquiera de los otros ~107, el campo obligatorio salía
  en blanco). Una tercera, la peor, sobrevivió a la ronda 2: la Consulta de órdenes mostraba
  **«Todos los clientes»** mientras filtraba por uno — **la pantalla mintiendo sobre su propio
  filtro**, en la etapa que trata de eso.

**⚠️ RIESGO RESIDUAL DECLARADO — B2, no cerrado.** En una corrida de la **suite completa**, el reviewer
vio **8 pruebas rojas** de la defensa anti-duplicado (fallaban todas las que exigen bloquear, pasaban
todas las que exigen dejar pasar). **No es reproducible y su causa NO se identificó.** Se descartaron
**ejecutando** las tres hipótesis con nombre —secuencia no reiniciada, crash aguas arriba, locale del
cluster— y los 133 archivos se cubrieron por bloques en verde. El coder encontró y arregló **un defecto
de aislamiento real** (`TRUNCATE … RESTART IDENTITY` no reinicia las secuencias independientes;
`numero_produccion_seq` sobrevivía toda la corrida), pero el reviewer **probó que ese arreglo NO es la
causa** de los 8. Se anota como riesgo, **no como resuelto**: cambiar un *"no sé"* por un *"ya está"*
es la mentira cómoda que esta etapa vino a erradicar. **El CI es el juez** (usa postgres:17; la
verificación local fue PG16). Detalle en `HOJA-DE-RUTA.md` §4.

**Lo bien hecho, acreditado por el reviewer:** la defensa central es *"correcta, race-free y bien
razonada"* — la **prueba de concurrencia es real** (quitó el candado y la carrera pasó a 2 ganadores);
la identidad elegida **no produce falsos positivos** (el resurtido legítimo se atiende por su botón, no
re-importando); **M2 quedó cerrado, no documentado** (`oc-duplicada.ts` consulta las dos puertas, así
que una OC entrada por PDF bloquea la de Excel); el multi-PDF recuperado **prueba dos OC en una sola
transacción**; y el punto 4 respeta **D3** de verdad — el `antes` va íntegro con sus
`NegociacionEvento`, no un conteo.

**Límites conocidos, escritos como límites y no como olvidos:** un Excel **sin OC capturada** no se
puede deduplicar (inventar una identidad bloquearía importaciones legítimas), y la puerta de Desarrollo
controla **qué** se compra, no **cuánto**.

**Nota de despliegue:** **una migración** (`20260816120000_cancelar_pedido_real`). **CERO permisos
nuevos, CERO seed** → no requiere `SEED_ON_START`.

---

## V1-E4b · El tránsito de las prendas enviadas a proceso después de costura ⭐ (17-ago-2026)

> **Nace de una frase de Daniel, no de un plan:** *"Hay procesos que también son después de costura. O
> sea, llega a producto terminado"* y *"en varias ocasiones se manda un estampado después de costura o
> algún otro proceso"*. **Pasa HOY.** Decisiones en `DECISIONES.md` **§Post-F9.59 · .60 · .61**.

### El hueco

Una prenda ya terminada vive en el kardex de PT. Cuando se manda a estampar/lavar/aplicar con un tercero,
**sale del piso pero el inventario sigue diciendo que está ahí**. El saldo global cuadraba por
compensación —el envío no tocaba el kardex y el recibo tampoco, salvo en costura— así que el error no era
un descuadre: era que **el inventario sobrestimaba la presencia física**. Daniel escogió la opción (b)
—existencia localizada— con una razón que no era contable sino operativa: *"¿de qué manera manejamos los
faltantes o segundas?"*

### Qué entrega

**No creó entidad nueva.** Reusó el almacén **«Tránsito»**, sembrado desde F3-E1, heredado de
`IPT_Almacenes` del Access y **nunca usado**; lo único nuevo es la bandera `Almacen.esTransitoProceso`,
para resolverlo por dato y jamás por nombre. El movimiento reusa `registrarTraspasoPt` (dos patas en una
transacción). El detalle del mecanismo vive en `docs/modulos/produccion-wip.md`, no aquí.

Con eso, **la segunda dejó de ser una edición de saldo y pasó a ser un movimiento real**, y el faltante
—que antes no tenía dónde estar— **se queda vivo en Tránsito**. Verificado contra la base: 100 → envío →
recibo de 95 primeras + 3 segundas deja **95 / 3 / 2 en tránsito**.

**El nivel equivocado, corregido sin parche:** `generaEntradaPt` se queda significando *"este proceso crea
producto terminado"* —que sí es propiedad del tipo, la costura— y la **posición** antes/después la lleva
el **envío**, porque un mismo estampado va antes en una orden y después en otra (§Post-F9.59).

### Nota de cierre — ⬜ EN CORRECCIÓN (17-ago-2026)

**Primera vuelta: reviewer independiente RECHAZÓ**, y el rechazo fue útil. Lo que **sí** aguantó, probado
rompiéndolo a propósito: seis envíos simultáneos sobre la misma existencia (5 pasan, 1 rechazado, suma
exacta), carreras contra salidas manuales, dobles cancelaciones sin inversos duplicados. **D3 y A2 de
pie.** Y el reviewer avaló el **modelo**: reusar el almacén estuvo bien, y confirmó **en el código** —no
de palabra del coder— que el *"¿de quién son?"* lo responde `wip.ts:226` por tercero.

**Los dos hallazgos que valían el rechazo, ambos verificados EJECUTANDO:**

1. **⭐ El bucket «sin orden» no se podía mandar a proceso, y el error mentía.** Con 100 piezas de
   `idOrden = null`, el envío tronaba con *"un artículo con 0 en existencia"*: la pantalla mostraba 100 y
   el sistema decía 0. Y ese bucket es exactamente *"lo capturado a mano en el arranque y lo migrado"* —
   o sea **todo el histórico de `prueba` y todo el conteo físico de arranque de Daniel**. Era la
   limitación con más probabilidad de pegar el día uno, y **la única de las cuatro que no se declaró**.
2. **⭐ Se podía cancelar UNA sola pata del traspaso.** Desde Inventarios, cancelando solo la entrada al
   tránsito: `primeras=0, tránsito=0` y el **WIP seguía reclamando 100 al estampador**. Cien prendas
   desaparecidas — *la misma enfermedad que la etapa vino a curar, entrando por la puerta de atrás*. La
   raíz era **preexistente** (`cancelarMovimientoPt` nunca miró `origenTipo`), pero esta etapa la agrava
   porque el saldo del tránsito pasa a **sostener** la historia del faltante.

**Y una lección que se repite en toda esta tanda:** el coder reportó *"nueve mutaciones, todas cazadas"*;
el reviewer quitó el `exigirExistenciaPt` de la pata de vuelta y `transito.int.test.ts` pasó **19/19 en
verde**. Un invariante D3 con **cobertura cero** bajo una afirmación de cobertura total. **La verificación
que no verifica** — tercera vez en esta tanda.

*(Los otros cinco hallazgos —opciones de «Tránsito» que el servidor siempre rechaza, una etiqueta de
bitácora que mentiría, y la falta de índice único parcial— van en la misma ronda: un defecto conocido no
es "menor".)*

**Ronda de corrección (17-ago), pendiente de segunda revisión.** Los siete cerrados. El arreglo de H1 dejó
una pieza de modelo que vale más que el defecto que lo originó: la existencia de PT se lleva **por bucket
de orden**, el envío **elige de cuál sale** (`stockSinOrden`) y el recibo devuelve **al mismo** —
reetiquetar al regresar habría movido saldo entre buckets sin que nadie lo pidiera. H2 cerró la puerta de
atrás en `cancelarMovimientoPt`, que ahora **solo acepta lo capturado a mano**: todo lo demás es el
*efecto* de un hecho con su propio estado, y anular el movimiento suelto revertía el inventario dejando el
hecho en pie. H7 pasó de **detectable a imposible** (índice único parcial). Integración **1846** (+9).

**Declarado, no callado:** H6 (la etiqueta de bitácora) va **sin prueba propia** — cubrirla exigiría
afirmar sobre el JSON de `Bitacora`, cosa que ninguna prueba del repo hace hoy, y se prefirió decirlo
antes que escribir una prueba decorativa. Esta tanda ya destapó tres de ésas.

---

## V1-E3f · Un solo catálogo de procesos, y el arte como Daniel lo usa ⭐ (17-ago-2026)

> Decisiones en `DECISIONES.md` **§Post-F9.52 · .54 · .58 · .59 · .63 · .65**. Se partió de la etapa
> original de "arte + proveedores": juntas eran catorce cosas más un lector de PDF, y como solo puede
> haber **un coder a la vez sobre el árbol** iban a ser secuenciales de todos modos. **Pieza A = arte;
> pieza B = proveedores.**

### El hueco

Convivían **dos listas casi idénticas**: `TipoProceso` (catálogo administrable) y un **enum fijo
`TipoArte`** con solo BORDADO/ESTAMPADO. Daniel lo cerró textual: *"De acuerdo. Y un solo catálogo"*, y
corrigió de paso que **aplicación TAMBIÉN es arte**. El objetivo de fondo es el **principio del proceso
raro** (§Post-F9.54): que un «embosado» se dé de alta **una vez** y sirva para las dos cosas, porque *"hay
procesos que hago muy muy poco, no justifica hacer todo un desarrollo"*.

### Qué entrega

`TipoProceso` gana `esArte` y `usaPuntadas`; el enum **desaparece** y `ModeloArte`/`OrdenArte` apuntan al
catálogo. **No se arrastró el error de `generaEntradaPt`:** `esArte` **sí** es propiedad del tipo, a
diferencia de la posición antes/después de costura, que V1-E4b acababa de mover al envío — y el porqué de
la diferencia quedó escrito.

Los siete del arte: **el nombre se retira** y la descripción toma su lugar (§Post-F9.63), posición como
**texto libre**, tipo del catálogo, **fotos en plural**, puntadas **atadas al tipo** en vez de borradas, y
el proveedor deja de ser un select con tope de 100 — **barrido en 8 pantallas**, no solo la del arte.

### Nota de cierre — ✅ HECHA (18-ago-2026)

**Primera vuelta: RECHAZADO — y el rechazo NO fue por el código.** El reviewer lo dice textual: *"no
encontré ni un solo defecto funcional"*. Verificó ejecutando que la migración aplica sobre una base al
estado de `prueba` con **0 filas perdidas y 0 reetiquetadas**, que el guardarraíl de duplicados hace
**rollback atómico**, y que las dos rutas —base nueva por seed, base existente por migración— dejan
**banderas idénticas**, confirmando que el deploy **no** requiere `SEED_ON_START`.

**Lo que lo bloqueó fueron dos MUTACIONES VIVAS, y las dos tocan la historia congelada en la orden:**

1. **`copiarRecetaDelModelo` no tenía NINGUNA prueba de arte.** Es el productor principal de `OrdenArte`.
   El reviewer mutó `posicion: a.posicion` → `null` —**perder en el congelado un campo que Daniel acababa
   de pedir**— y la suite **completa** siguió verde: 1865 + 1445, idénticos.
2. **`restaurarRenglonReceta`, rama arte, sin prueba.** Mutó la resolución por traza a `artesModelo[0]`:
   restaurar **pisaría el renglón congelado con los datos de OTRO arte**. Escribir encima de historia
   (D3), con la suite en verde.

**El patrón, otra vez:** en V1-E4b fueron tres afirmaciones no verificadas; aquí son dos rutas que nadie
probaba. **La suite completa en verde no dice que algo esté cubierto — dice que nadie lo rompió hoy.**

**Y un hallazgo del coder que el reviewer CONFIRMÓ:** la nota de §Post-F9.54 sobre cómo renombrar los
roles de proveedor era **falsa** (`update: {}` no toca el nombre). Corregida en su lugar — importa porque
de ahí cuelga la pieza B.

**Segunda vuelta: APROBADO.** El reviewer repitió sus dos mutaciones y **mueren**; repitió la que el coder
declaró que se le había escapado y **también muere**; y muto además `puntadas`+`idProveedor` a la vez y el
`antes` de la bitácora — las tres matan. Su veredicto sobre la cobertura: *"es real, no perimetral"*.

**El coder se cachó solo un fallo que nadie le habría visto:** su mutación del tipo del arte **sobrevivió
en el primer intento**, porque con **un solo arte** en el modelo "el tipo del primero" y "su tipo" son lo
mismo. Rehízo la prueba con dos artes de tipos distintos. El reviewer lo anotó: *"reportó honestamente un
fallo propio que nadie le habría visto — eso vale más que el arreglo"*.

**Decisión avalada como decisión, no solo como prueba:** con las fotos en plural había que decidir qué
hacer cuando un arte trae más fotos de las que caben en el impreso. Se reparten **por rondas** —la 1ª de
cada arte antes que la 2ª de ninguno—, porque *el papel del piso tiene que enseñar qué artes lleva la
prenda, no cinco ángulos de uno*. El reviewer lo ejercitó contra cinco escenarios y **dijo también dónde
reparte peor**: un arte complejo con 4 tomas junto a tres etiquetas triviales pierde sus tomas de detalle.
Gana igual, por principio: `MAX_ARTES` es una restricción de **maquetación**, no una declaración de
importancia, y el número de fotos que alguien alcanzó a subir no es señal de prioridad. Nada se esconde:
el título dice *"se muestran 4 de 7"*, calculado sobre el total.

**⚠️ Y un hallazgo contra la documentación del LEAD** (§Post-F9.64): decía que una talla sin medida *"sale
en cero"* y que *"nadie avisa"*. **Falso en los dos puntos** — cae al consumo por prenda y el MRP ya arma
el aviso. Corregido en su lugar. Es la **segunda** nota quemada en dos días por lo mismo: una afirmación
sobre el sistema escrita **sin ejecutar**. La regla de verificar antes de afirmar **no es solo para los
coders**.

**Deuda anotada, no callada** (§4): con las fotos en plural, `armarDatosImpresoOrden` presigna y descarga
**todas** las fotos aunque la rejilla pinte 4 — en impresión por lotes son cientos de viajes a R2 antes de
que arranque el worker. Degrada en lentitud, no en fallo, y no lo introdujo esta etapa.

---

## V1-E3g · Medida vs. consumo por talla ⭐ + el aviso de tallas sin medida (18-ago-2026)

> **Salió de Daniel CAPTURANDO**, no de un plan ni de una revisión técnica. Es el **segundo** hallazgo de
> esa naturaleza en dos días (el otro fue el tránsito de prendas), y los dos encontraron cosas que **ningún
> reviewer habría visto: el código estaba bien, lo que estaba mal era el modelo del negocio.**
> Decisiones: `DECISIONES.md` **§Post-F9.66** (el grueso) y **§Post-F9.64** (el aviso).

### El hueco de fondo

Dos ideas distintas vivían en el mismo campo. En el **elástico**, el valor por talla **es el consumo**
(0.75 m) y se multiplica por el precio del metro: los decimales son correctos. En el **cierre**, el
consumo es **1 pza siempre** y lo que cambia por talla es **la especificación** (53 cm), que no se
multiplica por nada — es una instrucción de compra. *No es que unos avíos usen decimales y otros no: unos
capturan **cuánto gastas** y otros **qué pides**.*

Y las etiquetas eran parte del defecto: el panel se llamaba *"Consumo por talla"* para las dos cosas y el
esquema documentaba el campo como *"Medida (consumo)"* — **la confusión estaba escrita desde el origen**.

### Qué entrega

La medida deja de ser texto libre: `AvioMedida` gana valor numérico y **la etiqueta la DERIVA el dominio**
de valor + unidad. El **modo** (consumo / medida) se deriva de un hecho que **ya existía** —¿el avío tiene
medidas activas?—, el mismo con el que el precosto decide promediar: **sin bandera nueva**. Los dos modos
**nunca** están vivos a la vez. La migración convierte lo convertible y deja el resto **marcado, vivo y
usable**. Y el aviso de tallas sin medida se **REUSÓ** —la habilitación lo tiraba a la basura— en vez de
construir uno nuevo; de paso dejó de señalar tallas con 0 piezas, que nadie iba a cortar.

### Nota de cierre — ✅ HECHA (18-ago-2026)

**Primera vuelta: RECHAZADA.** El reviewer confirmó lo más caro de verificar —la migración **no pierde un
solo dato** (22 filas antes → 22 después contra datos sucios reales), el elástico **no se movió**, y el
aviso **se reusó y no se duplicó**— y aun así encontró dos cosas que valían el rechazo:

1. **⭐ La rendija estaba en el camino principal.** Se normalizó el toggle en `agregarRenglonReceta`,
   `editarRenglonReceta` y `restaurarRenglonReceta` —los **tres secundarios**— y se dejó
   `copiarRecetaDelModelo`, **por donde pasa el 100 % de las órdenes**. Sonda: orden nueva con toggle
   heredado → requerido **70 cuando por prenda serían 10**. Es *exactamente el "MRP en la sombra" que la
   etapa invocó como razón para forzar la bandera*, fabricándose en cada orden nueva.
2. **⭐ La migración no marcaba el caso que justifica toda la decisión.** §Post-F9.66 dice textual que
   *"`53 cm`, `53cm` y `53` serían tres cosas distintas"*. El reviewer migró **ese caso exacto**: tres
   filas indistinguibles, **ninguna marcada, ningún aviso** — y al guardar, `ErrorValidacion` sin pista de
   cuál borrar. Palabra por palabra lo que Daniel pidió evitar.

**Y una prueba decorativa más:** la que se llama *"nombra las tallas SIN capturar EN ORDEN CANÓNICO"* pasa
con el `.sort()` borrado, porque el fixture mete la M antes que la G y orden de inserción y orden canónico
coinciden. **La aserción no discrimina.**

**Del lado del lead:** la ficha describía solo §Post-F9.64 —la mitad chica de la etapa—, `HOJA-DE-RUTA.md`
no la mencionaba y las deudas declaradas no estaban escritas en §4. Reparado aquí.

**Segunda vuelta: rechazada otra vez, y el hallazgo fue contra la documentación del lead** — el 432→8 de
arriba. Además, **el arreglo de la primera vuelta estaba probado en una sola dirección**: mutar la línea a
`consumoPorTalla: false` a secas —apagar el toggle a **todos** los avíos al nacer la orden, incluido el
elástico legítimo— dejaba **191 pruebas en verde**. El comportamiento era correcto; faltaba la aserción.
*Es el mismo patrón que la prueba decorativa de la vuelta anterior, ahora en el código recién escrito para
impedir ese defecto.* Y **dos de las cuatro consultas del conteo previo mentían**: contaban órdenes
canceladas pese a que su propio comentario decía que solo importan las vivas, y la que anuncia la cola de
revisión manual **subreportaba 5 de 9 — por el lado malo**.

**Tercera vuelta: APROBADA.** Las cuatro mutaciones supervivientes mueren; la consulta reescrita predijo
**12 filas** y la migración marcó **12, las mismas**; y el barrido del repo confirmó que ningún lugar
sigue diciendo "mueve costos". Integración final: **1914**.

**El reviewer se corrigió a sí mismo:** su mutación del precio de la heredada en la segunda vuelta estaba
**mal formada** (`&& false ? A : B` — `&&` liga más que `? :`, así que caía al brazo completo y el precio
sí se comparaba). El hallazgo era legítimo; **su evidencia de entonces no**. La rehízo y esta vez muere
con tres pruebas. *Lo dijo sin que nadie se lo pidiera.*

**Lo que se llevó la etapa, en una línea:** tres vueltas, seis hallazgos reales, y **el más caro no fue un
bug de código sino una afirmación sobre dinero escrita sin ejecutarla**. El sistema llevaba tiempo
costeando 54 cierres por prenda y nadie lo sabía. Lo destapó **medir en vez de leer**.

### ⭐ El hallazgo que cambia el sentido de la etapa: el sistema estaba costeando 54× de más

🔴 **CORRECCIÓN (18-ago-2026).** La primera redacción de esta ficha decía que el forzado *"mueve dinero"*
y que había que contar las filas afectadas para **autorizar un cambio de costos**. **Es al revés**, y lo
midió el reviewer **ejecutando `calcularPreCosto` real** sobre el cierre de Daniel (1 pza/prenda, medidas
53 y 55 capturadas en el campo de consumo por talla):

```
ANTES    consumoPorPrenda: 54   importe: 432
DESPUÉS  consumoPorPrenda:  1   importe:   8
costo TOTAL del modelo:  432 → 8
```

**El forzado no mueve costos: REPARA un sobrecosto de 54×.** El mecanismo es exactamente el hallazgo de
Daniel — **la medida se estaba leyendo como cantidad**, así que el sistema costeaba *54 cierres por
prenda* (54 = promedio de 53 y 55) en vez de 1. **El estado actual es el error; el cambio es la
corrección.**

⚠️ **El conteo previo al despliegue SIGUE siendo obligatorio, pero mide otra cosa:** no autoriza un
cambio, **mide cuánto está mal hoy**. Sin él nadie sabe cuántos modelos y órdenes vivas traen precios
inflados. Consultas en `scratchpad/v1-e3g-conteo-antes-del-deploy.sql`.

*(Se deja escrito el error en vez de borrarlo: el texto viejo se redactó **antes** de que apareciera el
54×, y es lo que Gabriel habría leído para decidir. Es la tercera nota de este proyecto que se quema por
lo mismo — **una afirmación sobre el sistema escrita sin ejecutarlo**.)*

### El aviso de tallas sin medida (§Post-F9.64) ⬜ (pedida 17-ago-2026)

> Nace de una pregunta de Daniel sobre la curva de tallas. Decisión y criterios en `DECISIONES.md`
> **§Post-F9.64**. La curva **ya** es una guía y no una jaula —capturar el XCH fuera de curva se puede
> hoy—; y el aviso **ya existe y ya es compartido** (`receta-avios.ts` lo reporta en `tallasSinMedida`),
> solo que **hoy únicamente lo usa el MRP**: la habilitación lo ignora y la pantalla no lo enseña. Lo que
> falta es **usarlo donde Daniel lo necesita**, no construirlo. **Avisa, no bloquea.**
>
> ⚠️ La primera redacción decía *"sale en cero y nadie avisa"* — **falso en los dos puntos**, corregido en
> §Post-F9.64 tras verificarlo el reviewer. Se deja dicho porque construir sobre la versión vieja
> **duplicaría un aviso que ya existe**.
>
> Se le suma **§Post-F9.66** (medida vs. consumo por talla): son la misma pantalla.

---

## V1-E8h · EL AVISO YA SABÍA TODO Y NO DABA LA PUERTA: el botón «Corregir» ⭐⭐⭐ (27-ago-2026) — ✅ HECHA

**§Post-F9.130.** Daniel, por cuarta vez sobre lo mismo:

> *«Sigue estando mal lo de los cierres… me sigue multiplicando por las medidas… Y me sigue poniendo
> 53 mil cierres por comprar (orden 5562). ¿Debo de hacer un nuevo modelo desde el principio para que
> funcione bien? o sigue siendo algún tema de programación? **Siento que estamos atorados en lo mismo
> desde hace varias versiones. No podemos desatorarlo.**»*

### 🔴 Por qué se llevaban varias versiones sin desatorar (medido, no supuesto)

**Se arreglaba el MOTOR y el DATO seguía congelado.** Las tres correcciones previas (§Post-F9.66,
§Post-F9.105 y su remate) tocaron sólo lo primero:

| | Estado real al 27-ago |
|---|---|
| **El motor** (`sembrarRecetaDeOrden` en `receta-orden.ts`, la línea `consumoPorTalla: porMedida.has(a.idAvio) ? false : a.consumoPorTalla`) | ✅ **Sano desde el 18-ago.** Una OP **nueva** nace bien. |
| **El dato ya congelado** en las órdenes viejas (`OrdenAvio.consumoPorTalla`) | 🔴 **Intacto.** La receta es una foto del día que nació la orden — a propósito (D3, §Post-F9.43). Ninguna corrección del motor vuelve hacia atrás, y ninguna debía. |

⇒ Daniel arreglaba el cálculo, volvía a abrir **la misma OP 5562** y veía **el mismo número**. Desde su
silla eso se lee *"no lo arreglan"*; en el código eran dos problemas y sólo se había cerrado uno.

### 🔴 Y el defecto que quedaba NO era el cálculo: era el REMEDIO

El sistema ya hacía todo lo difícil y aun así el usuario no podía avanzar. Tres piezas que **ya
existían** antes de esta etapa:

- **`modoCapturaAvio`** (`receta-orden.ts`) — decide si el avío es «por medida» (≥1 `AvioMedida` activa).
- **`avisoCapturaAvio`** (`receta-orden.ts`) — la condición exacta del defecto: modo `medida` + la
  bandera `consumoPorTalla` encendida.
- **`requeridoContradictorioPorMedida`** (`receta-avios.ts`) — **ya calculaba la magnitud**: lo que la
  orden pide hoy y lo que debería pedir.

…y el aviso terminaba con **«Guarda el renglón para normalizarlo.»** — **un conjuro**. *Normalizar* no es
palabra del negocio ni el rótulo de ningún botón, y «guardar el renglón» exige saber que cualquier
guardado dispara por dentro una corrección invisible. **Un sistema que detecta el error, sabe la
solución y le pide al usuario que adivine el hechizo está PEOR que uno que no lo detecta.**

### Qué entrega

1. **`corregirCapturaAvio`** (`dominio/produccion/receta-orden.ts`) — apaga `consumoPorTalla` en UN
   renglón, en transacción (A2), con bitácora que guarda la **foto íntegra** de lo que había (D3) **y la
   magnitud** (`requeridoAntes` / `requeridoDespues`, A7). Permiso **REUSADO** `desarrollo.administrar`.
2. **`POST /api/ordenes/{id}/receta/renglones/avio/{idRenglon}/corregir`** — endpoint propio, nunca un
   efecto de la lectura.
3. **`capturaReparable`** en el contrato del renglón de avío — el SERVIDOR dice cuándo hay botón. La
   pantalla no lee el texto del aviso para adivinarlo (A1), y no todo `avisoCaptura` es reparable: el
   mismo campo también avisa de un número absurdo para la unidad, que se arregla capturando bien.
4. **El botón «Corregir» pegado al aviso**, dentro de su misma caja (`AvisoCapturaAvio` en
   `PanelRecetaOrden.tsx`) — no en un menú aparte: ése era exactamente el defecto.
5. **El aviso, reescrito y con la CIFRA PRIMERO** (`avisoAvioPorMedidaConCantidadesPorTalla` +
   `magnitudContradiccion`, en `catalogos/unidades-avio.ts`): *«Esta orden pide 53,095 pza y deberían ser
   3,200 pza: el requerido sale MULTIPLICADO por 16.6, son 49,895 pza de MÁS. Viene de una captura
   vieja… Se arregla con el botón «Corregir» de este renglón.»*
6. **La prosa barrida en los tres sitios**: la explosión de materiales (`compras/mrp.ts`) manda al botón
   por su nombre, el BOM del modelo (`modelos/medidas-avio-talla.ts`) a su «Guardar medida por talla», y
   el detector (`migracion/analisis/avios-por-medida-contradictorios.ts`) también.

### Lo que NO se toca (y por qué)

- **El motor**: `sembrarRecetaDeOrden` ya está bien. Ni una línea.
- **El cálculo del MRP**: intacto. Lo que cambia es el dato de entrada, cuando una persona lo pide.
- **La regla de D3**: la bandera **no se apaga sola** al leer la pantalla. Sigue siendo un acto explícito
  —lo único que cambia es que ahora el acto es **un botón que se entiende**, no un hechizo.
- **El estado del renglón**: corregir **no** lo deja «ajustado». Marcarlo apagaría para siempre sus avisos
  de *"el modelo cambió"* (`desviadoAProposito`), o sea que reparar un defecto nuestro le costaría al
  usuario una señal que sí necesita.
- **Las cantidades por talla**: se quedan escritas, sólo dejan de mandar (D3).

### 🔴 Lo que NO hace, declarado y no enterrado

1. **NO hay reparación EN BLOQUE, y es deliberado.** Tocaría de un golpe datos de muchas órdenes vivas
   —cambiando lo que compran— y **eso necesita la palabra de Daniel, que todavía no está dada**. Lo que
   haría falta el día que la dé: (a) una `updateMany` bajo la MISMA condición del botón, por lotes y en
   transacción; (b) bitácora **por renglón** (no una sola del lote) para no perder la trazabilidad de D3;
   (c) decidir qué hacer con las firmas —revocar en bloque cerraría de golpe la compra de decenas de
   órdenes—; y (d) la guarda de OC (§Post-F9.79) aplicada renglón a renglón, saltando y REPORTANDO los
   que no se puedan en vez de abortar el lote entero.
   **La consulta que dice cuántas órdenes están afectadas** (además del detector, que ya mide el exceso
   en dinero de material):
   ```sql
   SELECT COUNT(DISTINCT oa.id_orden) AS ordenes_afectadas,
          COUNT(*)                    AS renglones_afectados
   FROM   orden_avio oa
   JOIN   ordenes o ON o.id = oa.id_orden
   WHERE  oa.consumo_por_talla = TRUE
     AND  o.estado <> 'cancelada'
     AND  EXISTS (SELECT 1 FROM avio_medida am
                  WHERE am.id_avio = oa.id_avio AND am.activo = TRUE);
   ```
   Y el reporte completo, con el exceso medido por la función del dominio:
   `npx tsx --env-file=.env migracion/analisis/avios-por-medida-contradictorios.ts`
2. **Las órdenes viejas no se arreglan solas.** El botón hace el trabajo de un clic; **el recorrido sigue
   siendo humano**, orden por orden y renglón por renglón.
3. **La habilitación/surtido (`habilitacion-orden.ts`) sigue enseñando el número inflado** mientras el
   renglón no se corrija — usa el mismo `requeridoAvioReceta`. Deuda ya nombrada en V1-E6a, **sigue
   abierta**.
4. **`calcularDesalineacion` sigue comparando sólo `consumoPorPrenda` y `precio`**: cambiar las medidas
   por talla de un modelo no marca desalineada ninguna OP. Hermano del defecto, **sigue abierto**.

### Nota de cierre — mutaciones probadas

Todas ROJAS y revertidas: quitar la guarda de permiso del botón (muere *«sin permiso… el aviso se ve,
pero sin botón»*) · pintar el botón mirando el TEXTO del aviso en vez de `capturaReparable` (muere *«con
aviso pero SIN capturaReparable no hay botón»*) · mandar `idAvio` en vez del id del renglón (muere *«el
aviso trae el botón AL LADO, y repara ese renglón»*) · sacar el botón de la caja del aviso (muere la
misma) · devolver la magnitud al medio del texto (muere *«arranca por la MAGNITUD»*) · devolver el
conjuro al aviso del MRP (muere *«avisa EN EL RENGLÓN y dice cuánto se pide de más»*) · ensanchar el
permiso de la ruta nueva (muere *«corregir captura del avío rechaza a quien solo puede VER»*) · invertir
los parámetros del handler (muere *«llama al dominio con la orden y el renglón de la URL»*).

⚠️ **7 pruebas de integración NO se vieron ponerse rojas** (sin Docker; el juez es el CI): el aviso que
nombra el botón, la corrección de 530 → 20 con la explosión de punta a punta, la bitácora con la
magnitud, el 409 sobre un renglón sano, el re-cierre de la firma sólo de ese renglón, el RBAC, y la
guarda de OC con el consumo por prenda en 0.

**SIN migración de BD. SIN permisos nuevos ⇒ NO requiere `SEED_ON_START`.**

---

## V1-E8g · EL PACK DEJA DE SER UN COLOR ⭐⭐ (27-ago-2026) — ✅ HECHA

**§Post-F9.129.** Daniel, mirando la **Explosión de materiales**:

> *«Ahora estás poniendo dos renglones por cada orden (Negro A y Negro B). Necesitamos agrupar por orden
> cuando es el mismo color. Habíamos acordado hace tiempo que los packs se verían reflejados en otro
> campo. Negro A y Negro B es lo mismo. Solo cambia la distribución del empaque. Pero no tiene sentido
> separar las compras para cada renglón: veo demasiados registros.»*

### La causa raíz, medida (no supuesta)

Dos funciones del importador de OC por PDF, `backend/src/dominio/pedidos/importacion-pdf.ts`:

- **`componerColor`** armaba `` `${nombre} ${letra}` `` → `Negro A`.
- **`crearOrdenDesdePdf`** llamaba a **`resolverOCrearColor`** **una vez por pack**, dentro del `for (const
  fila of filas)` → creaba un `Color` de catálogo **por cada pack**.

Como **todo lo que va aguas abajo agrupa por color** (explosión/MRP, órdenes de compra, inventario,
recepción), `Negro A` y `Negro B` viajaban separados hasta el final. No fue un descuido: era una copia
deliberada de la maña del sistema viejo, pedida por Daniel en **§Post-F9.3**, y ya señalada como algo a
cambiar en **§Post-F9.10**.

### Qué se construyó

| Pieza | Dónde |
| --- | --- |
| La letra del pack sale del nombre del color (`componerColor` → **`colorDeLaOrden`**) | `backend/src/dominio/pedidos/importacion-pdf.ts` |
| **`fusionarPacksEnUnaCorrida`** — suma pura de los renglones-pack talla por talla | `backend/src/dominio/pedidos/fusion-packs-cya.ts` (módulo nuevo) + su unit |
| La orden nace con **UN renglón de color** (fusión aplicada en `crearOrdenDesdePdf`) | `backend/src/dominio/pedidos/importacion-pdf.ts` |
| La vista previa etiqueta **packs**, y su renglón de totales dice **«A fabricar · Negro»** | `frontend/src/modulos/pedidos/ImportadorPedidoPdf.tsx` |
| Prosa del contrato (`.describe()` de Zod) al día con lo construido | `backend/src/contrato/esquemas/importacion-pdf.ts` |
| 🔴 **`fusionarColores` RECHAZA** un color usado fuera de las telas (11 referencias) + su mensaje | `backend/src/dominio/catalogos/colores-fusion-referencias.ts` (nuevo) + `colores.ts` (`fusionarColores`) |
| La lista de las 11 **derivada de `schema.prisma`** por una prueba (no se puede pudrir en silencio) | `backend/src/dominio/catalogos/colores-fusion-referencias.test.ts` (nuevo) |
| El diálogo de fusión **avisa antes** de que el servidor rechace | `frontend/src/modulos/colores/DialogoFusionColores.tsx` |

**SIN migración de BD. SIN permisos nuevos ⇒ NO requiere `SEED_ON_START`.**

### Las decisiones que se tomaron al construir, y por qué

- **UNA SOLA PUERTA.** La suma se hace en el único punto por donde la matriz de un PDF llega a la orden,
  así que cubre por igual los **dos** caminos: la propuesta automática de sobre-pedido **y** la
  `matrizEditada` que el usuario tocó en la previa. Es justo la cicatriz de "normalizar en tres puertas
  dejando abierta la principal": aquí sólo hay una y es la principal.
- **La fusión va ANTES de guardar, no dentro de `sincronizarMatriz`.** Esa función impone
  `@@unique([idOrden, idColor])` con un mensaje claro y **la comparte con la captura manual de la orden**:
  enseñarle a sumar renglones repetidos escondería un error de captura real. Quien sabe que esos renglones
  son packs del mismo color es el importador. *(Sin fusionar, quitar la letra habría hecho reventar la
  importación con "Un color no puede aparecer dos veces en la misma orden" — el arreglo a medias no
  compilaba con la realidad.)*
- **El pantone no tuvo que desempatarse.** Se temía el conflicto "dos packs, dos pantones". **No puede
  pasar:** el pantone es **uno por OC** (cada PDF trae un color genérico y un pantone; el ajuste manual de
  la previa también es por PDF, no por pack). Va tal cual en el único renglón, y así quedó escrito en el
  código para que nadie vuelva a buscarle desempate.
- **La función devuelve UNA corrida, no un agrupado por color.** Un `group by` sobre el color sólo podría
  producir un grupo (una OC = un color genérico) — sería una rama que **ninguna prueba puede poner en
  rojo**. Se prefirió decir la verdad estructural.
- **Se normaliza la etiqueta de talla al fundir.** `CH` / `ch` / `" CH "` resuelven la **misma** talla del
  catálogo: sin normalizar, el renglón habría llevado la misma `idTalla` dos veces y la importación entera
  se habría abortado.
- **La guarda `if (corrida.length > 0)` (no crear el color si no quedó corrida) NO está cubierta por
  pruebas, y no se presume verificada.** El caso que arregla **no** es "el usuario vació toda la OC"
  —ahí la matriz sale vacía y `salidaAProduccion` aborta la tx entera, así que el color se revertía
  igual—: es que `filasDesdePropuesta` puede producir **una fila toda en cero** (un grupo con
  `totalPacks = 0`) mientras otras sí traen piezas, y entonces la tx **sí comitea** y el
  `resolverOCrearColor` del bucle viejo dejaba el color colgado. **Mutación que SOBREVIVE:** cambiar la
  guarda por `if (true)` no pone en rojo ninguna prueba, porque ninguna construye un PDF con un grupo de
  0 packs. Se deja así a propósito —el borde es raro y la guarda es correcta—, pero queda dicho para que
  nadie la lea como probada.
- **La previa es fiel al papel, pero no miente.** Se descartó colapsar la matriz de la previa (Daniel la
  usa para cotejar contra la OC, donde los packs existen) y también dejarla como estaba (rotulaba colores
  que ya no van a existir). Cambio mínimo: los renglones se rotulan **«Pack A»/«Pack B»**, el renglón de
  totales —que ya existía— pasa a decir **«A fabricar · Negro»** y una línea bajo la tabla lo dice con
  todas sus letras. **No se rediseñó la pantalla.**

### Cómo se verificó (mutación, no sólo verde)

Cinco mutaciones al módulo puro, dos a la previa, tres a la guarda de fusión y dos al aviso del
diálogo; **las doce mataron la prueba esperada**:

| Mutación | Prueba que murió |
| --- | --- |
| `claveTalla` deja de normalizar | *funde la MISMA talla escrita distinto…* |
| `+=` → `=` (pisa en vez de sumar) | las tres de suma/orden/fusión |
| se quita el filtro de totales en 0 | *descarta la talla que queda en 0 en TODOS los packs…* |
| se ordena alfabéticamente la salida | *conserva el orden de PRIMERA aparición…* |
| se quita el `trim()` de la etiqueta | *funde la MISMA talla…* y *sin renglones… corrida vacía* |
| `etiquetaPack` vuelve a componer el color | *la previa etiqueta PACKS (no colores)…* |
| el total pierde el nombre del color | *…el total dice el color que va a quedar en la OP* |
| **(guarda de fusión)** se le olvida `movimientosDetPt` a la lista de las 11 | *cubre TODAS las relaciones entrantes de `model Color` menos `telas`* |
| **(guarda de fusión)** alguien mete `telas` en la lista (rompería la fusión legítima) | esa misma + *no repite relaciones ni incluye `telas`* |
| **(guarda de fusión)** el mensaje pierde el camino de salida | *nombra el color, cada uso con su cuenta, y el camino de salida* |
| **(aviso del diálogo)** el aviso vuelve a ser un 2º `DialogDescription` | *avisa que solo se fusionan colores SIN uso, y ese aviso es accesible* |
| **(aviso del diálogo)** se borra el aviso entero | esa misma |

⚠️ **Lo que NO se pudo poner en rojo aquí:** las pruebas de **integración** (`importacion-pdf.int.test.ts`,
reescritas en esta etapa: 1 renglón `Blanco` en vez de 3 `Blanco A/B/C`, por los dos caminos —propuesta y
matriz editada—) **no corren en esta máquina**: exigen Postgres con testcontainers, y Docker está prohibido
(regla innegociable). **El CI es el juez** de esa parte.

### Lo que NO entró, dicho con su razón

- ⚠️ **Las órdenes YA IMPORTADAS conservan sus colores partidos.** El arreglo es **sólo hacia adelante**.
  Unificarlas es una migración **irreversible** que toca matrices de órdenes vivas y cortes/envíos ya
  capturados: necesita la palabra de Daniel y va como pieza aparte.
- 🔴 **«Fusionar colores» habría sido el parche obvio y ahora SE NIEGA — construido en esta etapa
  (ronda de corrección).** La primera versión de esta ficha lo dejaba sólo documentado y **eso estaba
  mal por dos motivos**: (1) la deuda **subestimaba el agujero** —decía "no toca los renglones de las
  órdenes", cuando `Color` tiene **DOCE** FK entrantes y la fusión sólo mueve **UNA** (`TelaColor`); las
  otras once incluyen corte/envío/recibo, kardex de PT, OC de tela y de avío, requerimientos, lotes,
  inventario cíclico y precios de proveedor—; y (2) la razón de diseño ("el arreglo honesto es la
  migración") era un **falso dilema**: entre no hacer nada y la migración irreversible existe un tercer
  camino que **no toca ni un dato — negarse**. Además este cambio **fabrica el motivo** para el atajo
  (deja el catálogo lleno de `NEGRO A/B/C` que él mismo declara "no eran colores, eran empaques", y el
  diálogo prometía mover "las telas" sin mencionar las órdenes) y **rompe un invariante que el propio
  dominio impone**: una orden viva no puede apuntar a un color inactivo (`sincronizarMatriz`). Eso lo
  saca de "menor". **Ver la pieza construida más abajo.**
- **El pack todavía no viaja al corte ni a la maquila** (la otra mitad de §Post-F9.10). Consecuencia
  honesta: como antes el pack venía disfrazado de color, la matriz *de hecho* permitía cortar por pack;
  ahora no. Daniel pidió el cambio conociendo el orden de las cosas, y el dato sigue guardado en
  `Orden.packsCliente`.
- **El importador de EXCEL no se tocó**: nunca usó letras de pack.

### 🔴 La negativa de `fusionarColores` (ronda de corrección, 27-ago-2026)

**Qué se construyó.** `backend/src/dominio/catalogos/colores-fusion-referencias.ts`:
`REFERENCIAS_QUE_BLOQUEAN_FUSION` (las **once** FK entrantes de `Color` que la fusión NO sabe mover),
`contarUsosQueBloqueanFusion` y `mensajeFusionBloqueada`. En `colores.ts` (`fusionarColores`) se llama
**antes** de reasignar o desactivar nada: si hay algún uso, `ErrorConflicto` y la tx entera se revierte
(A2) — el catálogo queda intacto. El mensaje nombra el color, cada uso con su cuenta y el camino de
salida (§Post-F9.129). El diálogo del frontend lo advierte antes de que el usuario lo intente.

**Por qué se BLOQUEA y no se reasigna.** Mover sólo `OrdenLinea` sería **peor que no hacer nada**:
`EtapaMovimientoDet` (corte/envío/recibo) y `MovimientoDetPt` (kardex de PT) cuelgan del **mismo**
color, así que reasignar la matriz y dejar quietos el corte y el kardex los deja **incoherentes entre
sí**. Unificar de verdad es la migración de las órdenes ya importadas — irreversible, y con la palabra
de Daniel pendiente. Rechazar, en cambio, **no toca ni un dato** y es reversible por definición.

**Por qué la lista no se mantiene a mano sin red.** Estas referencias se enumeraron **tres veces y las
tres se enumeraron mal**: el código original miraba 1, la primera redacción de la deuda dijo 1, y una
revisión dijo 6 (nombrando además una tabla que no existe, `OrdenCompraLineaDet`, y confundiendo el
campo `colorPrenda` con un modelo). Son **once**. Por eso `colores-fusion-referencias.test.ts` **lee
`prisma/schema.prisma`**, extrae las relaciones de vuelta de `model Color` y exige que la lista las
cubra todas menos `telas`: el cuarto olvido será un rojo de CI, no un hueco silencioso.

**Qué NO cambió.** Fusionar colores que todavía **no se usan** —el caso para el que se construyó la
herramienta en F1-E6— sigue funcionando igual; hay una prueba que lo fija para que la guarda no se
convierta en un bloqueo total por accidente.

**Defecto de accesibilidad que salió en la 2ª revisión y se corrigió.** El aviso del diálogo nació como
un **segundo `<DialogDescription>`** dentro del mismo `<DialogHeader>`, y el primitivo de Radix toma su
`id` del **contexto del diálogo**, no de cada instancia: los dos párrafos salían con el **mismo `id`** y
el `aria-describedby` del diálogo apuntaba sólo al primero. HTML inválido — y el aviso, que es justo el
que evita que el 409 sorprenda, quedaba **invisible para un lector de pantalla**. Ahora es un `<p>` con
las clases del primitivo, y la prueba fija las dos mitades: que el aviso **exista y diga lo que el
servidor hará**, y que **no lleve `id`** con una sola `[data-slot="dialog-description"]` en el árbol.

### Nota de cierre — ✅ HECHA (27-ago-2026)

El desglose de packs **se sigue guardando** íntegro en **`Orden.packsCliente`** (jsonb) desde que se
construyó el importador — ése es "el otro campo" que Daniel recordaba haber acordado, y es la base del
futuro módulo de **EMPAQUE**.

⚠️ **Pero "no se perdió nada" sería falso.** Hoy **nadie lee ese campo**: cero referencias fuera del
importador y sus pruebas, y el impreso de la OP no lo menciona. Hasta este cambio el desglose por pack
**se veía** (eran renglones de la matriz, y salían en el impreso de la OP y en el de envío a maquila);
desde aquí está guardado pero **no se muestra en ninguna pantalla ni papel** — para un taller que tiende
por pack eso no es un matiz. Y lo guardado es el desglose **del cliente** (cantidades originales), **no
las fabricadas**: el reparto del 7 % por pack y las ediciones del usuario en la previa ya no quedan
registrados pack por pack en ningún lado.

---

## V1-E8f · LAS COTIZACIONES NO SE ENCUENTRAN ⭐⭐ (27-ago-2026) — ✅ HECHA

**§Post-F9.128.** El motor de cotización está construido desde F8 y `V1-E7c` le puso el documento. Nada
de eso falló. Lo que falló fue **llegar a él**: Daniel se topó con **cuatro muros seguidos**.

> 1. *"En cotizaciones **no puedo hacer nada**… no veo ninguna actualización."* → *"**Aaaaaa, yo estaba
>    viendo los precosteos** (en lugar de lista de precios)."*
> 2. *"**no está la opción de listas de precios** en desarrollo."*
> 3. *"si, ya estoy en cotizaciones, pero **supuse que de ahí jalo un proyecto de precosteo**… **No me
>    deja hacer una lista de precios nueva**."*
> 4. *"si tengo el permiso. Sí veo el botón. Justo me sale la leyenda de que **no hay desarrollos
>    disponibles**."*

**El dueño del sistema se perdió cuatro veces en un módulo que funciona.** No faltaba capacidad:
faltaba el **camino**, y faltaba que el sistema dijera **por qué no podía**.

### Lo que se MIDIÓ antes de construir

**(a) Las cinco condiciones de candidatura**, que vivían disueltas en un `where` de Prisma
(`listas-precios.ts`, `candidatosParaLista`). Un desarrollo entra a una lista si: **no está apagado** ·
su proyecto es de la **empresa activa** (A9) · del **cliente** y del **departamento** pedidos · tiene
**≥1 precosto en estado `congelado`** · y **no tiene renglón en ninguna lista**. La que fallaba en el
caso de Daniel es la del **precosto congelado**: el precosto existía, pero en **borrador**. Escrito como
`where`, ese filtro **sólo sabe contestar "hay / no hay"**.

**(b) Dónde vivía cada cosa en el menú** — de aquí salen enteros los muros 1 y 2:

| Lo que buscó | Cómo se llamaba | Dónde | Ruta | Permiso |
|---|---|---|---|---|
| Listas de precios | **«Pre-costeos»** | Operación › Desarrollo | `/desarrollo` | `desarrollo.ver` |
| Listas de precios | **«Cotizaciones»** | Operación › Desarrollo | `/listas-precios` | `listas.ver` |
| Listas de precios | **«Listas de precios»** | Comercial › Clientes | `/listas-precios` | `listas.ver` |

**La MISMA pantalla se llamaba distinto en dos lugares**, y el nombre que buscaba sólo existía en el
grupo donde no la fue a buscar.

**(c) El eslabón sin puerta.** De `precosteo → congelar → lista → cotización`, los extremos ya tenían
puerta («Generar lista de precios» en el proyecto; «Emitir cotización» en la lista). **Congelar** no:
decía `"Precosto v1 congelado."` y ahí terminaba.

### Qué entrega

- ⭐ **El servidor CLASIFICA, ya no sólo filtra.** La regla de **quién califica** salió del `where` a una **función
  pura**, `motivoNoCandidato` (`listas-precios.ts`), y la consulta devuelve **candidatos Y descartados
  con su motivo**: `ya-en-lista` > `apagado` > `precosto-borrador` > `sin-precosto`, en esa precedencia
  —que **no es cosmética**: decide qué remedio se ofrece—.
- ⭐ **El aviso NOMBRA el modelo, el motivo y el acto.** Donde se leía *"No hay desarrollos cotizados
  disponibles para este departamento"* ahora va, agrupado por motivo: *«Su precosto sigue en BORRADOR
  (1) · A-100 — v3 en borrador · Ábrelo en «Precosto» y usa «Congelar versión»»*, con **botón a
  Pre-costeos** cuando hay algo que arreglar ahí. El que ya está colocado **dice en qué lista** (folio).
- **Se acabó la adivinanza en el cliente.** El motivo bajo «Generar lista de precios» del proyecto se
  **deducía del estado derivado** y su propio comentario admitía que *"no se puede separar sin mentir"*
  → salía una **disyunción**. Hoy se leen los hechos por separado, con su conteo.
- **La pantalla se llama IGUAL en los dos lados: «Listas de precios»** (era «Cotizaciones» bajo
  Desarrollo). La palabra *Cotizaciones* **no se pierde**: encabeza la descripción (⌘K la indexa), sigue
  en el H1 y es el nombre del documento que se emite.
- **Congelar dice para qué sirvió:** *"Precosto v3 congelado: ya puede incluirse en una lista de precios
  (Desarrollo › Listas de precios)"*.
- **El rechazo del API, con el mismo criterio y sin repetirlo:** `crearLista` **reusa**
  `motivoNoCandidato` en vez de escribir la regla por segunda vez, y su mensaje pasó de *"MOD-X: no
  tiene un precosto congelado"* a *"MOD-X: su precosto v1 sigue en BORRADOR: congélalo («Precosto» →
  «Congelar versión»)"*.
- **La pantalla vacía de Listas** distingue *"todavía no hay ninguna"* (y dice cómo nace una) de *"no
  hay ninguna que coincida con el filtro"*.

### 🔴 La regla que gobierna la etapa

> **Capturar es el proceso normal: primero el lugar para llenar, y el aviso sólo si de verdad no se
> puede.** Un mensaje que dice *"no hay X disponibles"* **sin decir por qué ni qué hacer ES el
> defecto**, no la ayuda. (§Post-F9.96)

### Tabla de mutaciones

Cada conducta se **mutó**, se corrió, se **vio roja**, se confirmó que murió **la esperada** y se
restauró. Las anclas llevan el **nombre** del código, no sólo el número (el número caduca).

| Mutación | Qué debía morir | ¿Murió la esperada? |
|---|---|---|
| `listas-precios.ts:982` (`motivoNoCandidato`) — `precostos.length > 0 ? 'precosto-borrador' : 'sin-precosto'` → siempre `'sin-precosto'` | *«con precosto(s) pero NINGUNO congelado → precosto-borrador»* + *«todo motivo está en el catálogo»* | ✅ 2 |
| `listas-precios.ts:982` (`motivoNoCandidato`) — invertir el orden `apagado` / `ya-en-lista` | *«la precedencia es apagado > ya-en-lista > lo del precosto»* | ✅ 1 |
| `listas-precios.ts:982` (`motivoNoCandidato`) — `precostos.some(estado==='congelado')` → `precostos.length > 0` | *«con precosto(s) pero NINGUNO congelado»* + *«todo motivo está en el catálogo»* | ✅ 2 |
| `motivos-candidatura.ts:77` (`etiquetaDescartado`) — quitar el sufijo `— vN en borrador` | *«nombra el modelo, la versión y el acto de congelarlo»* | ✅ 1 |
| `DialogoCrearLista.tsx:315` (`SinCandidatos` › `hayQueArreglar`) → `true` fijo | *«sin nada que congelar, NO ofrece la puerta a Pre-costeos»* | ✅ 1 |
| `motivos-candidatura.ts:97` (`resumenSinCandidatos`) — quitar el remedio del resumen | los **3** del motivo bajo «Generar lista de precios» en `ProyectosPagina` | ✅ 3 |
| `catalogo.ts:239` (hoja `listas-precios`, `titulo`) → volver a `'Cotizaciones'` | *«se llama IGUAL en Desarrollo y en Clientes»* | ✅ 1 |

⚠️ Los números de línea del árbol **sólo valen en el commit que los escribió**; los nombres, no caducan.

### Lo que NO se hizo, y por qué

- **No se agregó un selector de proyecto al diálogo de «Nueva lista»**, que es lo que Daniel supuso en
  el muro 3. La lista es de un **cliente+departamento**, no de un proyecto: puede juntar modelos de
  varios proyectos y ésa es la razón de que exista. Lo que se corrigió es lo que de verdad lo dejó
  parado —que al llegar ahí no supiera qué le faltaba— y **desde el proyecto ya existe la puerta**
  («Generar lista de precios», acotada a ese proyecto). Si además quiere arrancar eligiendo proyecto,
  es decisión suya y **no está construida** (dicho también en §Post-F9.128).
- **No se corrieron las pruebas de integración ni las e2e**: nada de Docker en esta máquina (regla del
  proyecto). Están **escritas** —seis casos nuevos en `listas-precios.int.test.ts` sobre
  `diagnosticoCandidatosLista` (borrador con su versión · **congelar lo mueve a candidato** · sin
  precosto · ya-en-lista con folio · apagado · A9) y el bloque de menú en `login.spec.ts`— y viajan al
  CI, **que es el único juez**.
- **Estas conductas quedan cubiertas SÓLO por integración** y no se pudieron mutar aquí: que la consulta
  de verdad **traiga a los apagados y a los ya colocados** (el `where` viejo ni los veía) y el scope por
  empresa del diagnóstico. Queda **dicho**, en vez de aparentar cobertura que no existe.
- **No se tocó el motor de cotización**: esta etapa hace **visible y explicable** lo que ya existía; no
  construyó ni una capacidad nueva de negocio.

### 🔴 Ronda de corrección: el defecto de la etapa, cometido DENTRO de la etapa

El reviewer aprobó la ingeniería —la regla es una sola, las seis condiciones siguen ahí, los dobles se
corrigieron antes de probar una suposición— y **rechazó por cinco cosas**. La primera es la que duele:

**C · El vacío nuevo de la pantalla de Listas MENTÍA.** Decidía con `listas.length === 0`, pero esa
lista **ya viene filtrada por el servidor**: filtrar por un cliente o un estado sin listas contestaba
*"todavía no hay ninguna lista… congela tus precostos en Desarrollo"* — **mandando a arreglar algo que
no está roto**. Y la ficha y el historial **afirmaban** que las dos ramas se distinguían, sin que
ninguna prueba tocara ninguna.
⚖️ **Es el muro de Daniel construido otra vez, tres pantallas más allá, dentro de la etapa que existe
para cerrarlo.** *Distinguir "no hay nada" de "no hay nada AQUÍ" es la diferencia entre orientar y
desorientar.* Arreglado, con **una prueba por rama** y la mutación que lo confirma.

**D · La precedencia ofrecía un remedio que no lleva a ningún lado.** `apagado` ganaba a `ya-en-lista`,
y como **nada impide apagar un desarrollo ya colocado**, el caso es alcanzable: el usuario leía
*"reactívalo antes de cotizarlo"*, lo reactivaba **y seguía sin poder**. Peor: el comentario del propio
test **consagraba el razonamiento equivocado**.
⇒ **Ahora gana `ya-en-lista`**, porque su remedio sí se puede cumplir y **la cadena termina bien**:
quitarlo de la lista → reactivarlo → cotizarlo. *Un remedio que promete un resultado que no puede
entregar es peor que no ofrecer ninguno.*

**A · «La regla ENTERA salió del `where`» era falso, en cinco sitios.** Salieron **tres** de las seis:
las de **alcance** (empresa · cliente · departamento) siguen en el `where` **y deben seguir**, porque
definen el universo y no un descarte. Importa porque quien reusara `motivoNoCandidato` creyendo que
trae el A9 dentro **se saltaría el scope por empresa**.

**B · El conteo se contradecía solo:** *"cinco condiciones"* con **seis viñetas al lado**, en la misma
línea.

**E/F/G ·** Dos comentarios seguían llamando a la pantalla por el nombre retirado (en la etapa cuyo
entregable **es** el renombre) · `candidatosParaLista` quedó **sin llamador de producción** y se anota
con su fecha de caducidad en vez de callarse · y el universo, que el comentario llamaba *"acotado"*
**sin medirlo**, queda dicho: el cubo `ya-en-lista` **sólo crece**, y con ~200 desarrollos por cliente
hay que paginar. *Llamar "acotado" a algo que sólo crece es la clase de suposición que se descubre el
día que duele.*

⭐ **Y una que el reviewer señaló sin exigirla, y que sí se hizo:** Daniel dijo *"supuse que de ahí jalo
un proyecto de precosteo"*. Su modelo mental seguía sin corregirse **donde se equivocó: en la
pantalla**. El diálogo ahora se lo dice — *"elige cliente y departamento, no un proyecto: una lista
puede juntar modelos de varios"*—, que es el mismo criterio de §Post-F9.96 que gobierna la etapa.

| Mutación (ronda de corrección) | Qué murió | ¿La esperada? |
|---|---|---|
| `ListasPreciosPagina.tsx` (`hayFiltroDeServidor`) — quitar la condición | *«CON un filtro puesto: NO manda a congelar precostos»* | ✅ |

⚠️ **Al restaurar, se usó COPIA PREVIA, no `git checkout --`**: al coder ese comando le revirtió un
archivo entero y por poco se lleva un cambio real en silencio.

### Nota de cierre — ✅ HECHA (27-ago-2026)

Versión **0.043**. **SIN permisos nuevos** ⇒ **NO requiere `SEED_ON_START`**. **SIN migración de BD**:
no se agregó ni una columna — todo el diagnóstico sale de datos que ya existían y que nadie leía. El
contrato **cambia de forma** (la respuesta de `/api/listas-precios/candidatos` gana `descartados`), así
que el cliente del frontend se regeneró en la misma tarea. **Toca el menú** ⇒ `login.spec` ajustado.

---

## V1-E8e · «CON ESTO QUEDA CUBIERTO»: EL FALTANTE CHICO QUE NO SE PERSIGUE ⭐⭐ (27-ago-2026) — ✅ HECHA

**§Post-F9.99.** Daniel, usando la explosión de materiales en `prueba`:

> *"En las telas, compré **480 en lugar de 481** que era el cálculo de la tela. Y me sigue poniendo que
> me falta comprar 1 kilo… no sé cómo manejar eso, pero **a veces pasa eso en la realidad**. Y **no voy
> a hacer otra OC por 1 kilo**."*

### El problema

`RequerimientoOrden` sólo guardaba **cuánto se necesita**. No existía el concepto de *"esto ya lo doy por
surtido aunque falte un pedacito"*, así que **el faltante lo perseguía para siempre**: cada explosión
volvía a ofrecerle comprar 1 kilo, y el renglón nunca se apagaba.

### Qué entrega

- ⭐ **La pregunta EN EL MOMENTO de decidir.** Cuando el comprador baja la cantidad en la **revisión
  previa** por debajo de lo que se necesitaba, el renglón pregunta qué significa:
  *"el resto **sigue pendiente**"* / *"**con esto queda cubierto** — no me lo vuelvas a pedir"*. Ahí es
  cuando la persona sabe la respuesta; un interruptor escondido en otra pantalla la obligaría a
  acordarse y a buscarlo.
- **La segunda puerta**, desde el renglón de la explosión (`PUT /api/explosion/dado-por-cubierto`), para
  los faltantes **que ya se escaparon** —como el que originó la queja, que ya estaba generado— con su
  **«volver a pedirlo»**.
- **La marca durable:** tabla nueva `RequerimientoCubierto`, por *(orden, material, **color**)*.
- **El criterio, UNO solo:** `pendienteDeComprar(aComprar, enOc, cubierto)` en `comprometido-en-oc.ts`.
- **El motivo de omisión propio** (`dado-por-cubierto`), que **manda sobre `ya-en-oc`**.
- **Rastro completo (A7):** quién, cuándo, contra qué requerido y con qué cantidad comprada. Deshacer es
  **suave** (`canceladoEn`, D3): nunca borra.

### 🔴 Dónde vive la marca — la decisión de fondo de la etapa

**NO puede vivir en `RequerimientoOrden`.** Ese snapshot se **borra y se reescribe ENTERO en cada
explosión** (`deleteMany` + recreación, `mrp.ts:1998` (`requerimientoOrden.deleteMany`)). Una bandera ahí **se borraría la próxima vez que
alguien explotara la orden**, y el faltante volvería sin que nadie entendiera por qué. Por eso vive en su
propia tabla, con una identidad **durable**.

**Y el COLOR está en esa identidad porque se midió antes de elegir.** Desde `V1-E3u` (§Post-F9.89) el
renglón de tela es *(tela, color)* y desde `V1-E8c` (§Post-F9.126) el de avío es *(avío, color de
prenda)*: la clave con la que netean la explosión, la agrupación (`claveAgrupada`) y el ajuste del
comprador (`claveAjuste`) **ya lleva el color**. Una marca por material a secas habría **cubierto el
cierre rojo y seguido pidiendo los otros tres**. La clave se llama `claveMaterialColor` y **se mudó de
`mrp.ts` a `comprometido-en-oc.ts`** el día que un tercer módulo necesitó escribirla: una clave que dos
archivos arman por su cuenta es una clave que en la primera corrección se escribe distinta.

⚠️ **NO lleva proveedor**, a diferencia de `claveAgrupada`: el proveedor cambia (Compras lo reasigna
desde la propia pantalla, §Post-F9.82) sin que el renglón deje de ser el mismo.

### 🔴 UN criterio, no dos

> El requerimiento queda satisfecho cuando **comprometido + dado-por-cubierto ≥ requerido**.

La resta vivía **repetida** en dos sitios (`proyectarRenglones` de la explosión y `planearCompra`). Con un
tercer sumando, el día que uno se quedara atrás la explosión y la revisión previa dirían números
distintos sobre lo mismo — el defecto exacto que §Post-F9.85 vino a cerrar. Se recogió en **una sola
función**, `pendienteDeComprar`, junto a la única verdad sobre *"cuánto ya compré"*.

### 🔴 Por qué NO una tolerancia automática

Es lo primero que se le ocurre a uno, y está descartado con razón: **1 kg de 481 es nada, pero 1 kg de 5
es el 20 %**. Un porcentaje único **o tapa faltantes de verdad o no sirve**, y un faltante tapado en
silencio es la clase de defecto que este track lleva semanas sacando del sistema. *Que la persona lo diga
es más barato y más honesto que adivinarlo.*

### 🔴 Lo que esta etapa NO cierra — declarado, no callado

1. **El tablero R7 («qué tengo / qué falta») NO cuenta la marca.** Ese tablero mide lo **FÍSICO** —qué
   llegó al almacén— y dar por cubierto **no mueve ni un gramo de material**: con 4 de 5 comprados sigue
   diciendo *recibido parcial*, que es la verdad. Es la misma distinción que ya separa el criterio del
   **costo** (§Post-F9.48) del de *"¿hace falta volver a comprar?"*. **No es un segundo criterio: es otra
   pregunta.**
2. **Cancelar la OC no deshace la marca.** El material vuelve a pedirse (la OC deja de cubrir) pero el
   pedazo cerrado sigue cerrado — se compraría de menos. Se corrige con **«volver a pedirlo»**, que
   existe justo para eso. Atarlo a la cancelación habría exigido decidir *qué marca* muere con *qué OC*,
   y eso no está en la decisión.
3. **Cambiar el color de una tela reabre su faltante.** La marca cuelga de *(material, color)*: si el
   renglón pasa de *sin color* a *marino* es **otro renglón** (la premisa de §Post-F9.89), y la marca
   vieja deja de corresponderle. Es correcto, pero puede sorprender.
4. **Sin backfill.** No hay dato del que deducir qué faltantes históricos alguien habría dado por
   cubiertos; los que ya se escaparon se cierran a mano desde el renglón.
5. **Dos actos SIMULTÁNEOS sobre el mismo renglón pueden cubrir de más.** No hay lock, y es una
   decisión: la marca sólo **resta** y `pendienteDeComprar` clampa en 0, así que **no rompe ninguna
   invariante** (a diferencia del kardex, donde el lock existe para sostener el no-negativo); las dos
   personas pidieron dejar de perseguirlo; los dos actos quedan con su autor y **«volver a pedirlo»
   los deshace**. Meter un `pg_advisory_xact_lock` aquí protegería una invariante que no existe.

### Cómo se verificó (mutación, no sólo verde)

Cada mutación se ancló **por número de línea**, se imprimió ANTES/DESPUÉS y se confirmó con `diff` contra
una copia limpia que tocó **código**, no un comentario. **Dos sobrevivieron y se arreglaron las pruebas**
(no el código): están marcadas 🔁.

| Mutación | Qué murió | ¿La esperada? |
|---|---|---|
| `comprometido-en-oc.ts:180` quitar `- cubierto` | **5 rojas**, incl. *«EL CASO DE DANIEL … ⇒ NO falta nada»* y *«el renglón deja de pedirse»* | ✅ es LA aserción de la etapa |
| `comprometido-en-oc.ts:180` quitar `Math.max(0, …)` | *«nunca es negativo: cubrir de más no genera un sobrante»* | ✅ |
| `comprometido-en-oc.ts:152` `claveMaterialColor` sin color | **3 rojas**: *«el cierre ROJO no cubre al azul»*, *«la marca de OTRO color NO cubre a éste»*, *«la TELA usa su propio color»* | ✅ el color en la identidad |
> 🔴 **DÉCIMO GOLPE DE LA TRAMPA DEL ANCLA, y el remedio que veníamos usando NO SIRVE.** Siete de las
> nueve anclas del backend apuntaban a **comentarios**, desfasadas 10–15 líneas. No fue descuido: el
> coder las leyó de verdad, y **después su propio trabajo movió esos archivos**. La regla que teníamos
> —*"reléelas al final"*— tampoco alcanzó, porque también hubo dos *puntos de guardado* del lead entre
> medias.
>
> **El remedio de aquí en adelante: el ancla lleva el NOMBRE del código, no sólo el número.** Un número
> caduca al primer `import` nuevo; `requerimientoOrden.deleteMany` no caduca nunca. El número sirve para
> llegar rápido; **el nombre es el que dice si llegaste al lugar correcto**.
>
> *(Las seis anclas del FRONTEND estaban bien. La diferencia: ese archivo dejó de moverse antes.)*

| 🔁 `dado-por-cubierto.ts:203` (`const comprada = l.seEscribe ? ...`) `comprada = l.cantidad` (ignora `seEscribe`) | **sobrevivió**: el fixture usaba `0.004` y el redondeo a 2 decimales devolvía `50` por los dos caminos. Con `0.009` muere *«una línea que NO se escribe cuenta como comprada en CERO»* | ✅ tras corregir el fixture |
| 🔁 `dado-por-cubierto.ts:205` (`if (!seGuardaComoAlgo(faltante))`) `!seGuardaComoAlgo(f)` → `f <= 0` | **equivalente** (el faltante ya llega redondeado a 2, así que `< 0.005` ⇔ `=== 0`). Quitando el guard ENTERO mueren **4** | ✅ mutante equivalente, verificado |
| `mrp.ts:2580` (`return 'dado-por-cubierto'`) quitar la rama `dado-por-cubierto` | *«EL CASO DE DANIEL: … el renglón deja de pedirse»* (el motivo caía en `ya-en-oc`) | ✅ *no basta con no callarse* |
| `mrp.ts:3142` (`cantidadFaltante: faltante`) `cantidadFaltante: 0` | **2 rojas**: *«bajar la cantidad ANUNCIA el faltante»* y *«la respuesta VIAJA hasta el plan»* | ✅ el disparador de la pregunta |
| `mrp.ts:3143` (`restoCubierto: ajuste?.restoCubierto ?? false`) `restoCubierto: false` fijo | *«la respuesta «con esto queda cubierto» VIAJA hasta el plan»* | ✅ |
| `mrp.ts:1662` (`const cubiertoFila = cubiertoDe(...)`) `cubiertoFila = 0` (el plan ignora la marca) | **2 rojas**: *«el renglón deja de pedirse»* y *«la marca RESTA, no cierra de más»* | ✅ |
| `ExplosionMaterialesPagina.tsx:805` no mandar `restoCubierto` | *«contestar «con esto queda cubierto» VIAJA al servidor»* | ✅ |
| `ExplosionMaterialesPagina.tsx:631` no borrar la respuesta al vaciar la cantidad | *«BORRAR la cantidad borra la respuesta: no revive sola»* | ✅ |
| `ExplosionMaterialesPagina.tsx:2392` invertir el radio del default | **2 rojas**, incl. *«bajar la cantidad PREGUNTA qué significa»* | ✅ **el default no cierra** |
| `ExplosionMaterialesPagina.tsx:2372` preguntar SIEMPRE (sin faltante) | **4 rojas**, incl. *«comprar COMPLETO no pregunta nada»* | ✅ |
| `ExplosionMaterialesPagina.tsx:2635` quitar el chip «Dado por cubierto» | *«lo dado por cubierto SE VE, y el botón pasa a ser «volver a pedirlo»»* | ✅ |
| `ExplosionMaterialesPagina.tsx:2789` `onDarPorCubierto(true)` fijo | la misma: nunca se podría **deshacer** | ✅ |
| `ExplosionMaterialesPagina.tsx:249` festejar aunque no se movió nada | *«si el servidor no movió nada se DICE»* | ✅ |
| 🔁 `ExplosionMaterialesPagina.tsx:245` mandar `[renglon.id]` en vez de `idsRequerimiento` | **sobrevivió**: el fixture tenía UNA sola OP, así que los dos valores coincidían. Con el renglón agrupando dos (`[1, 9]`) mueren **2** | ✅ tras corregir el fixture |

⚠️ Los números de línea son los del árbol de esta etapa y **sólo valen en el commit que los escribió**.

### Lo que NO se hizo, y por qué

- **No se corrieron las pruebas de integración ni las e2e**: nada de Docker en esta máquina (regla del
  proyecto). Están **escritas** —`dado-por-cubierto.int.test.ts` gana el ciclo completo (comprar de menos
  → contestar → **volver a explotar dos veces** → la marca sigue ahí; el default que no cierra; deshacer;
  idempotencia; A9 y A4) y el e2e recorre cerrar → recargar → sigue cerrado → deshacer— y viajan al CI,
  **que es el único juez**.
- **Estas conductas del dominio quedan cubiertas SÓLO por integración** y no se pudieron mutar aquí: el
  filtro `canceladoEn: null` de `dadoPorCubierto`, el `if (!r.restoCubierto) continue` de
  `escribirDadosPorCubierto`, el filtro por proveedores **con OC creada**, y el reparto del acervo sin
  color dentro de `darPorCubierto`. Están escritas en el `.int.test.ts`; queda **dicho** que ninguna
  prueba de unidad las vigila, en vez de aparentar una cobertura que no existe.
- **No se tocó el tablero R7** (razón en el punto 1 de arriba) ni el criterio del costo.
- **No se puso umbral ni tolerancia** — es exactamente lo que la decisión descarta.
- **`restoCubierto` NO pasa por `aplicarAjusteDelComprador`**, igual que `colorTexto` desde V1-E8c: ese
  módulo existe para lo que puede **impedir generar**, y esto no bloquea nada. Meterlo ahí habría
  disfrazado de decisión un `?? false`.

### Nota de cierre — ✅ HECHA (27-ago-2026)

Versión **0.042**. **SIN permisos nuevos** (reusa `compras.administrar`, el mismo que genera las OC) ⇒
**NO requiere `SEED_ON_START`**. **CON migración** (`20260827180000_con_esto_queda_cubierto`), 100 %
**aditiva**: un enum y una tabla nuevos, sin backfill, sin tocar ninguna fila existente — se aplica sola
en el deploy y no exige nada especial. El contrato **cambia de forma** (los renglones ganan
`cantidadCubierta`; el plan gana `cantidadFaltante`/`restoCubierto`; el ajuste gana `restoCubierto`; hay
un motivo de omisión nuevo y un endpoint nuevo), así que el cliente del frontend se regeneró en la misma
tarea.

---

## V1-E8d · AVISAR CUANDO LA RECETA CAMBIA BAJO UN PRECIO YA APROBADO ⭐ (27-ago-2026) — ✅ HECHA

**§Post-F9.127.** El **eslabón que `V1-E8b` dejó medido y declarado**, y que Daniel mandó cerrar:

> *"Si. Ok. **Que me avise.**"*

### El problema

Un renglón de lista de precios guarda un **precosto CONGELADO** —inmutable por diseño (D3)— y una
**copia** de su costo. Cambiar la **receta del modelo** no mueve ninguno de los dos: hay que **congelar
una versión nueva Y registrar una ronda**, las dos **a mano**. Si se olvida cualquiera, el precio
aprobado sigue en pie sobre un costo que ya no corresponde a la receta de hoy — y **nada lo decía**.

### Qué entrega

- **La señal:** `Modelo.recetaTocadaEn` + `Modelo.recetaTocadaCambio`, escritas **sólo** por
  `tocarModeloPorCambioDeReceta` (el embudo de `V1-E7e`, cuello obligado de las **6 puertas** de la
  receta). Migración **aditiva** de dos columnas nullable, **sin backfill**.
- **El criterio, UNO solo:** `avisoDeCostoViejo` (`dominio/desarrollo/costo-viejo.ts`), función **pura**
  que devuelve **la frase completa** o `null`.
- **La pantalla:** el aviso se ve en **tres sitios** — pegado a su renglón en la lista de precios (con
  qué parte de la receta cambió, cuándo, y contra qué versión del precosto), en el **resumen** del
  encabezado de esa tabla (cuántos y cuáles), y en el diálogo de **emitir cotización**, que es la puerta
  por la que un precio sobre un costo viejo sale hacia el cliente. Más un **chip** «Costo viejo» para
  cazarlo de un vistazo en una lista larga.
- **Avisa aunque el renglón NO esté aprobado**, con otra frase (*"…antes de aprobar el precio"*): avisar
  sólo sobre lo aprobado dejaría firmar un precio nuevo sobre el costo viejo, que es el mismo agujero un
  minuto antes.
- **Se apaga solo** al recostear (congelar versión nueva + ronda). **No hay estado muerto.**

### 🔴 Por qué (B) y no la opción barata

La señal parecía existir ya: `Modelo.modificadoEn > Precosto.congeladoEn`, sin migración. Pero
`modificadoEn` es **`@updatedAt`**: lo mueve **cualquier** escritura al modelo, y hay **11** en el código
que no son receta (renombrarlo, pasarlo a producción, la propia firma de revisión, subirle una foto).
*Un aviso que nace gritando en falso se aprende a ignorar, y el día que sea de verdad nadie lo mira.*

**La prueba que justifica toda la etapa** es la gemela de la principal: **renombrar el modelo NO dispara
nada**. Contra `modificadoEn` esa línea sale ROJA.

### 🔴 Por qué AVISA y no tumba la firma — y por qué NO es un tercer criterio

Los hermanos §Post-F9.116 y §Post-F9.125(d) **sí** tumban. La regla unificada es *«cambiar aquello sobre
lo que se firmó tumba la firma»*, y la palabra que trabaja es **aquello**:

| Caso | Sobre qué se firmó | Qué cambió | ¿Es lo mismo? |
|---|---|---|---|
| §Post-F9.116 | la **receta del modelo** | la receta del modelo | **Sí** — misma fila |
| §Post-F9.125(d) | un precio calculado **con esos factores** | esos factores | **Sí** — misma lista, misma tx |
| **V1-E8d** | un precio calculado **sobre el precosto congelado v3** | el **modelo** del que salió el v3 | **No** — el v3 no cambió, ni puede |

El precosto congelado es inmutable **por diseño**: el precio firmado sigue siendo coherente con lo que se
firmó. Lo que ya no se sabe es si **lo firmado sigue describiendo lo que se va a fabricar**. Y encima, un
cambio de receta **puede no mover el costo ni un peso** (se corrigió el arte, se ajustó una medida) y el
sistema **no tiene forma de saberlo** sin volver a costear. Tumbar aquí cancelaría precios firmados —y ya
mandados al cliente— por hechos que a lo mejor no los tocan.

### 🔴 Lo que este aviso NO cierra — declarado, no callado

1. **Un aviso se puede ignorar.** Con el desfase a la vista, la **cotización, el PDF y el Excel siguen
   saliendo** y el renglón se puede aprobar igual. Cerrarlo sería **bloquear el papel mientras el costo
   esté viejo** — y eso es **MÁS de lo que Daniel pidió**. Queda **sobre la mesa**, para él.
2. **Un desfase ANTERIOR al despliegue no se detecta.** `recetaTocadaEn` nace en NULL para todo el
   catálogo y NULL significa **"no se sabe"**, no "nunca se tocó". Rellenarla con `modificadoEn` sería
   justo la mentira que la etapa descartó. Se detecta el **primer cambio de receta posterior**.
3. **`congeladoEn` en NULL no avisa** (no hay contra qué comparar). En la práctica no ocurre —congelar
   sella la fecha en la misma escritura y el renglón siempre apunta a un congelado—, pero está dicho.

### Cómo se verificó (mutación, no sólo verde)

Cada mutación se ancló **por número de línea**, se imprimió ANTES/DESPUÉS y se confirmó con `diff` contra
la copia limpia que tocó **código**, no un comentario.

| Mutación | Qué murió | ¿La esperada? |
|---|---|---|
| `costo-viejo.ts:87` `<=` → `<` | *"tocada en el MISMO instante del congelado tampoco"* | ✅ 1 roja |
| `costo-viejo.ts:81` `recetaTocadaEn ?? new Date(8.64e15)` (NULL se leería como "tocada") | **3 rojas**: *"un modelo cuya RECETA nunca se ha tocado"*, *"receta SIN tocar ⇒ null"* y *"cada renglón se juzga por SU modelo"* | ✅ es LA aserción de la etapa |
| `costo-viejo.ts:81` `congeladoEn ?? new Date(0)` | *"sin fecha de congelado … no se inventa una alarma"* | ✅ |
| `costo-viejo.ts:92` `const cierre = false` (fuerza la rama SIN aprobar) | **2 rojas**: la frase del aprobado en el criterio y en la proyección | ✅ |
| `costo-viejo.ts:92` `const cierre = true` (fuerza la rama aprobado) | **2 rojas**: *"sin aprobar … pide recostear ANTES de aprobar"* | ✅ las dos ramas ancladas |
| `costo-viejo.ts:99` `fechaDelActo` → `toISOString()` | **2 rojas**, incl. *"las fechas son las de MÉXICO"* (afirma `27/8`, no el `28/8` de UTC) | ✅ el huso está probado |
| `costo-viejo.ts:91` `queCambio = 'la receta'` (el aviso deja de decir QUÉ) | **5 rojas** en 2 archivos | ✅ |
| `revision-modelo.ts:554` `recetaTocadaEn: undefined` | *"sella `recetaTocadaEn` + `recetaTocadaCambio`"* | ✅ el embudo es la fuente |
| `revision-modelo.ts:555` `recetaTocadaCambio: 'telas'` fijo | **2 rojas**: *"cada cambio guarda SU código"* y *"la sella TAMBIÉN en un modelo normal"* | ✅ |
| `revision-modelo.ts:418` quitar `cambio in TEXTO_CAMBIO` | **2 rojas**: un código desconocido daría `undefined` en mitad del aviso | ✅ |
| `listas-precios.ts:165` `avisoCostoViejo: null` en la proyección | **4 rojas**: la frase no llega al renglón | ✅ |
| `ListasPreciosPagina.tsx:898` quitar el renglón del aviso | *"pinta la FRASE ENTERA del servidor, no un símbolo mudo"* | ✅ |
| `ListasPreciosPagina.tsx:418` `conCostoViejo = []` | *"el resumen dice CUÁNTOS y CUÁLES"* | ✅ |
| `ListasPreciosPagina.tsx:796` quitar el chip | *"el chip permite cazarlo de un vistazo"* | ✅ |
| `DialogoEmitirCotizacion.tsx:57` `conCostoViejo = []` | *"avisa nombrando los modelos, y NO bloquea la emisión"* | ✅ la puerta de salida |

### Lo que NO se hizo, y por qué

- **No se corrieron las pruebas de integración ni las e2e**: nada de Docker en esta máquina (regla del
  proyecto). Están **escritas** —`listas-precios.int.test.ts` gana el ciclo completo por las **puertas
  reales** (el PUT de telas del BOM y el PATCH del modelo) más el recosteo que apaga el aviso, y el e2e
  recorre renombrar-no-dispara → agregar-arte-sí-dispara— y viajan al CI, **que es el único juez**.
- **El aviso NO va tras la reja de `consultas.ver-importes`**: no lleva ni un número de dinero, y quien
  no ve importes también tiene que saber que ese renglón está costeado con una receta vieja.
- **NO se imprime en el PDF ni en el Excel de la lista, ni en el documento de cotización**, a
  propósito: esos papeles los lee el **cliente**, y *"el costo de este modelo quedó viejo"* es una nota
  interna. El aviso va donde se **decide** (la pantalla de aprobación y el diálogo de emitir), no donde
  se **comunica**.
- **No se tocó la inmutabilidad del precosto congelado** (D3) ni el mecanismo de la ronda: el aviso se
  apaga con lo que ya existía.

### Nota de cierre — ✅ HECHA (27-ago-2026)

Versión **0.041**. **SIN permisos nuevos** ⇒ **NO requiere `SEED_ON_START`**. **CON migración**
(`20260827160000_aviso_costo_viejo`), 100 % **aditiva**: dos columnas nullable en `modelos`, sin
backfill, sin índices, sin CHECK — se aplica sola en el deploy y no exige nada especial. El contrato
**cambia de forma** (el renglón de lista gana `avisoCostoViejo`), así que el cliente del frontend se
regeneró en la misma tarea.

---

## V1-E8c · LA MEDIDA Y EL COLOR DEL AVÍO EN LA ORDEN DE COMPRA ⭐⭐ (27-ago-2026) — ✅ HECHA

**§Post-F9.126.** Daniel lo reportó **dos veces** usando el sistema:

> *"Le había puesto que **el cierre lo tengo que comprar por medidas**. Y al hacer la OC **no me
> aparece cantidad por medida… sólo veo un solo renglón**."*

> *"Ese modelo nos lo piden en **4 variantes de color**. Se generan 4 órdenes de producción. A la hora
> de comprar, vamos a juntar las 4 OP en **una sola OC**. Los cierres se compran todos al mismo
> proveedor, pero **cada color es diferente y cada color tiene cantidades por medida**… **En la receta
> no viene definido el color. Eso viene hasta que nos hacen el pedido.** … Esto mismo pasa en
> **jaretas, cintas palmita**, etc."*

Su forma preferida, textual: *"poner 4 veces el cierre y **en la descripción del avío ponerle el
color**, y sólo que me dé el desglose de cantidad por medida sería suficiente"*.

### 🔴 La regla que ordena todo lo demás

> **Lo que parte el RENGLÓN es lo que se recibe por separado. Lo que sólo hay que decirle al
> proveedor va en la TABLITA.**

- El **COLOR parte el renglón**: se recibe **contra la LÍNEA, que lleva el color**, y
  `comprometido-en-oc.ts` netea por renglón. Si un renglón cargara 4 colores, **recibir tendría que
  aprender a leer una tabla**.
  ⚠️ **El kardex de avíos NO lleva color** — y esta ficha decía lo contrario en su primera redacción
  (lo cazó el reviewer, en siete sitios a la vez). Por eso el stock del genérico se netea una vez y se
  consume color por color.
- La **MEDIDA no se recibe** (llegan *"3,200 cierres"*): va en una tablita bajo el renglón, para él.
- **La medida NO multiplica nunca.** La cantidad sale de **cuántas prendas** llevan esa medida (curva ×
  consumo por prenda); leer el `50` de *"50 cm"* como consumo es de donde salieron los **133,095**
  cierres de §Post-F9.105.

### Qué entrega

- **La explosión parte los avíos por COLOR DE PRENDA**, con el MISMO mecanismo que las telas desde
  V1-E3u: `claveAgrupada` (`material | color | proveedor`) con un concepto de color más ancho
  (`colorDelRenglon`: de tela en telas, **de prenda en avíos**). **No hay una segunda clave.**
- **Desglose por medida** congelado en el snapshot y repartido a cada línea de OC, con
  **Σ medidas = cantidad de la línea, exactamente** (`repartirEntreOrdenes`, la última absorbe el
  residuo). Sale de abrir la MISMA regla R18 (`requeridoAvioReceta` ahora devuelve `porTalla`), **no**
  de una cuenta paralela.
- **Las tres salidas**: la explosión y la **revisión previa** (chip de color + `Por medida: …`), el
  **detalle de la OC**, y el **impreso PDF** del proveedor (color pegado al material + sub-tabla
  *"Desglose por medida"*). El impreso **consolida** (§Post-F9.102).
- 🔴 **Y el otro extremo de la cadena: la RECEPCIÓN nombra el renglón con su color.** No estaba en el
  encargo y salió al barrer: con cuatro renglones del mismo cierre, quien recibe leía *"CIE-53 —
  Cierre"* **cuatro veces** y no tenía con qué elegir — el defecto de esta etapa trasladado al final.
  Se arregla en los dos sitios donde se nombra (`nombreMaterialDeLinea` de las OC recibibles y la
  proyección de la recepción) y en la pantalla, que ya usaba el helper compartido.
- **El color es EDITABLE antes de generar** (§Post-F9.94): `colorTexto` en el ajuste del comprador —
  el avío puede ir en **contraste**.
- **Un solo precio** por renglón (§Post-F9.113): se desglosan **cantidades**, no precios.

### Migración — ADITIVA, sin backfill

`20260827120000_la_medida_y_el_color_del_avio`: 3 columnas (`requerimiento_orden.id_color_prenda`,
`orden_compra_linea.id_color_prenda`, `orden_compra_linea.color_avio`) y 2 tablas
(`requerimiento_orden_medida`, `orden_compra_linea_medida`). **Nada se borra, nada se rellena**: NULL
significa *"esta compra no dijo color"* / *"no se pidió por medida"*, que es exactamente lo que dicen
las OC de hoy. **SIN permisos nuevos ⇒ no requiere `SEED_ON_START`.**

### 🔴 Dos defectos que se arreglaron al pasar (un defecto conocido no es "menor")

1. **`duplicarOC` no copiaba `idTelaColor`** — no es de esta etapa: V1-E3u le dio color a la línea y el
   duplicado se quedó sin arrastrarlo, así que duplicar devolvía una compra *"de la misma tela"* **sin
   tono**. Se arregla junto con los tres campos nuevos, con su prueba.
2. **El impreso de la EXPLOSIÓN no decía el color** (tampoco el de tela, desde V1-E3u). Con el renglón
   partido eso habría dejado cuatro filas idénticas con cantidades distintas: ahora el material lleva
   su color y su desglose.

### ⚠️ El límite, declarado y aceptado por Daniel

Una **entrega parcial sabrá el COLOR pero no la MEDIDA**: la recepción cruza contra la LÍNEA (que lleva
el color) y la medida es informativa — no hay dimensión de medida ni en la recepción ni en el kardex de
avíos. **No es un callejón sin salida**: el día que importe, la medida sube de la tablita al renglón
con este mismo mecanismo, igual que el color acaba de subir.

### Cómo se verificó (mutación, no sólo verde)

Cada mutación se ancló **por número de línea**, se imprimió la línea original y se confirmó con
`git diff` que tocó **código**:

| Mutación | Qué murió | ¿La esperada? |
|---|---|---|
| `desglose-por-medida.ts:83` quitar `if (!conMedida) return []` | *"sin NINGUNA medida amarrada no hay desglose"* | ✅ |
| `desglose-por-medida.ts:98` `previa.cantidad += ` → `=` | *"junta las tallas que comparten medida"* | ✅ |
| `desglose-por-medida.ts:128` no repartir (devolver las bases) | **3 rojas** de `repartirDesglose`, incl. *"se reparte contra lo que SE VA A COMPRAR"* | ✅ |
| `desglose-por-medida.ts:151` `previa.cantidad = m.cantidad` | *"suma por etiqueta"* + *"no deja polvo de coma flotante"* | ✅ |
| `desglose-por-medida.ts:191` `if (suma !== esperada)` → `if (false)` | *"si la suma NO es la cantidad, lo dice con los dos números"* | ✅ |
| `mrp.ts:1553` `colorDelRenglon(fila)` → `fila.idTelaColor` | **⭐ *"4 colores ⇒ claves distintas"*** + *"sin color no se funde con CON color"* | ✅ la regla de Daniel |
| `comprometido-en-oc.ts:128` `colorDelRenglon` → `m.idTelaColor` | las mismas dos | ✅ el criterio es UNO |
| `receta-avios.ts:81` `.filter(() => false)` | **3 rojas**: *"SIN consumo por talla también hay desglose"*, *"Σ porTalla = requerido"*, la talla en cero | ✅ |
| `receta-avios.ts:81` `piezas > 0` → `>= 0` | *"una talla con CERO piezas no aporta renglón"* | ✅ |
| `impreso-orden-compra.ts:366` sacar `r.colorAvio` de la clave | **3 rojas**: los dos colores se funden, el sin-color se funde, los textos distintos se funden | ✅ |
| `impreso-orden-compra.ts:474` no sumar las medidas al fusionar | *"DOS OP del MISMO color… sus MEDIDAS se suman"* | ✅ |
| `impreso-orden-compra.ts:218` no pegar el color al material | *"en la descripción del avío ponerle el color"* | ✅ |
| `piezas.tsx:84` idem en la pantalla | *"avío con color se lee «Avío · Color»"* | ✅ |
| `captura.ts:199` `colorAvio: null` | *"corregir el PRECIO no borra el color"* + la de soltar el desglose | ✅ |
| `captura.ts:176` `desgloseCuadra` → siempre `true` | *"si la CANTIDAD se edita a mano, el desglose se SUELTA"* | ✅ |
| `ExplosionMaterialesPagina.tsx:1789` `colorDeRenglon` ignora el prenda | *"el COLOR del avío es EDITABLE y viaja como `colorTexto` **de ESE color**"* | ✅ |
| `ExplosionMaterialesPagina.tsx:2440 / 2493 / 2271 / 2160` borrar cada bloque de UI | su prueba, una por una (chip y desglose, en el renglón y en la previa) | ✅ 4 de 4 |
| `DetalleRenglonesOc.tsx:76` borrar el desglose del detalle | *"el DESGLOSE POR MEDIDA se pinta bajo el renglón"* | ✅ |

🔴 **Una mutación SOBREVIVIÓ y destapó un defecto de diseño, no un hueco de prueba.** Sacar
`r.idColorPrenda` de `claveConsolidacion` (impreso) no mataba nada… porque **no debía estar ahí**: con
el id en la clave, dos líneas corregidas al MISMO texto ("Negro contraste" para el rojo y para el azul)
salían como **dos renglones idénticos** en el papel del proveedor — justo lo contrario de §Post-F9.102.
Se **quitó el campo** (y su lectura, que quedaba sin nadie) y se escribió la prueba que lo fija.

⚠️ **Otra "mutación" no contó y se dice:** el primer intento sobre `textoMaterial` cambió la rama
**verdadera** del ternario por **su mismo valor** — `git diff` salió con cambios (el comentario) pero el
código era idéntico. Se repitió sobre la rama correcta (`:218`) y murió la esperada. *Es la trampa del
ancla otra vez: comparar el `ANTES:` impreso, no sólo confiar en el `git diff`.*

### 🔴 3ª vuelta: el CI tumbó OCHO pruebas de integración, y detrás había un defecto de dinero

Ni el coder ni el reviewer podían verlas: **sólo corren contra Postgres**, y aquí no hay Docker. Las
dos validaciones dieron verde de buena fe.

**Causa raíz ÚNICA de las ocho.** Partir el renglón por color cambió **la identidad** del renglón, y
con ella la clave del ajuste del comprador (§Post-F9.94). Un ajuste que no nombra el color **dejó de
casar — y el sistema no hacía nada**. Medido con un doble de transacción, sin base de datos: ajuste
sin color contra renglón con color ⇒ sale **la cantidad propuesta (100)**, `ajustado: false`,
`bloqueos: []`. El comprador teclea *"compra 0.1"* y **se compran 180**.

⚖️ **Las ocho eran AMBAS cosas, y las dos mitades son reales:** la prueba estaba incompleta (el
renglón cambió de identidad; un ajuste tiene que nombrarla ⇒ 18 cuerpos actualizados) **y el código
estaba mal** — no por el número, sino **por el silencio**. *Ajustar la expectativa para que pase es
cómo se entierra un defecto.*

**Lo construido:** un ajuste que no encuentra su renglón se vuelve **bloqueo** y la OC no se genera,
**sólo cuando ese material sí se le va a comprar a ese proveedor** (si quedó fuera del plan, bloquear
sería ruido que atora al comprador por algo que no cambia nada). Detalle y porqués en §Post-F9.126.

⭐ **El efecto lateral que vale más que el arreglo:** de las **18** pruebas con ajuste, **unas diez
estaban en verde con su ajuste convertido en no-op**. Pasaban por lo que afirmaban *después*, no por
lo que creían estar ejerciendo. **Ahora ninguna puede.**

**La sospecha del lead, TUMBADA midiendo** (y esto también importa): sospechó que el neteo contra lo ya
comprado se había roto —las OC viejas no tienen color y el requerimiento ahora sí—, lo que habría
hecho al sistema decir *"cómpralo otra vez"* sobre material ya comprado. **No pasa:** requerimiento de
100 con color contra línea vieja sin color de 60 ⇒ `cantidadTotal 40`, `desdeAcervoSinColor 60`. El
reparto hacía su trabajo. Igual quedó **anclado** en una prueba de unidad (antes sólo vivía en
integración) que muere al mutar `comprometido-en-oc.ts:332`.

| Mutación (3ª vuelta) | Qué murió | ¿Esperada? |
|---|---|---|
| `ajuste-comprador.ts:223` `if (true) continue` | 2 puras + la del bloqueo | ✅ |
| `ajuste-comprador.ts:228` `if (false) continue` | las 2 de *ajuste irrelevante* | ✅ |
| `mrp.ts:3018` `clave: 'nunca-casa'` | las 2 de «el ajuste sí se aplica» | ✅ |
| `comprometido-en-oc.ts:332` `acervo = 0` | 4 puras + ⭐ la del acervo migrado | ✅ |
| `mrp.ts:2938` quitar el guard de «aplicados» | **NADA** | ❌ sobrevivió |

🔴 **La que sobrevivió no era un hueco de prueba: era código MUERTO.** El `Set` de *"ajustes aplicados"*
guardaba la misma información que la función pura ya calcula comparando claves, y su guard **no podía
ser falso nunca**. Se **borró**, en vez de escribirle una prueba a una redundancia. *Una guarda que no
puede fallar no protege: estorba y miente sobre lo que el código necesita.*

### 📌 Por qué pasaron desapercibidas, y qué queda para la próxima

El cambio **no rompió a quien LEE el color: rompió a quien CONSTRUYE la identidad** del renglón. El
barrido buscó lecturas, y los cuerpos `ajustes[]` de las pruebas **escriben** esa identidad a mano.
Todo lo que la construye vive detrás de una transacción, donde `test:unit` no llega.

1. ⭐ **El doble de transacción YA EXISTÍA y nadie lo reutilizaba** (`mrp.test.ts`, desde §Post-F9.120,
   para probar la fecha). Extenderlo costó ~100 líneas y alcanza **`planearCompra` entero sin
   Postgres**. Con eso, estas ocho se habrían visto en **300 ms** en vez de en 27 minutos de CI.
   ⇒ **Regla: toda conducta de `planearCompra` que se pueda expresar con el doble, se prueba ahí.**
2. **La lista mecánica** al tocar una clave (agrupación, ajuste, neteo o diff):
   `grep -rn "ajustes:" src --include=*.int.test.ts` (hoy son dos archivos), más
   `ordenes-compra.int.test.ts` y `recepciones.int.test.ts`.
3. **El candado nuevo es el detector permanente:** un ajuste que no casa ya no pasa en verde.

⚠️ **Y una nota de método, del lead:** la lista de fallos que se le pasó al coder salió de un registro
de CI **cortado por la cola** y se le presentó como completa. El coder midió y respondió que **al menos
cuatro pruebas más** deberían haber estado ahí. Tenía razón en desconfiar. El arreglo las cubre igual
—atacó la causa, no los síntomas—, pero *una lista incompleta presentada como completa es una forma de
mentir con datos ciertos*.

> ⚠️ **Dos números de esta tabla apuntaban a otra cosa** (`mrp.ts:1537` era la firma del tipo;
> `impreso-orden-compra.ts:464`, un comentario). Habían quedado de un estado anterior del archivo,
> mientras las mutaciones sí ocurrieron y sí mataban lo declarado — el reviewer las reprodujo. Se
> corrigen porque **una tabla que existe para ser auditada no puede mandar a un comentario**: es
> exactamente la trampa del ancla, en el documento en vez de en el `sed`.

### Lo que NO se hizo, y por qué

- **No se corrieron las pruebas de integración ni las e2e**: nada de Docker en esta máquina (regla del
  proyecto). Están **escritas** —el caso completo de Daniel en `mrp.int.test.ts` (4 OP → 1 OC → 4
  renglones con su desglose que cuadra; el color editable; una OP con varios colores) y el cerrojo del
  desglose + el duplicado en `ordenes-compra.int.test.ts`— y viajan al CI, **que es el único juez**.
- **Lo que sólo cubre la integración, dicho:** el reparto por color dentro de `calcularRequerimientos`,
  el `colorTexto` de `planearCompra`, la escritura en `crearLineas`/`generarOCDesdeExplosion` y el
  cerrojo de `validarLineas` **no tienen prueba de unidad** — necesitan una transacción. La REGLA que
  aplican (`motivoDesgloseInvalido`, `claveAgrupada`, `desglosarPorMedida`) sí está extraída, pura y
  mutada.
- **No hay Excel de la OC**: la orden de compra sólo tiene impreso **PDF** (se comprobó: no existe
  `excel-orden-compra`). No se inventó uno.
- **No se agregó un e2e nuevo, y con razón:** `e2e/explosion-mrp.spec.ts` es deliberadamente
  **tolerante a los datos** (recorre lo que haya en `prueba` y acepta las dos ramas de la puerta de
  la receta), y esta etapa sólo se ve cuando hay **un avío con medidas amarradas por talla** — que
  ningún seed siembra. Un spec que lo exigiera sería rojo crónico, y uno que lo hiciera opcional no
  probaría nada. La conducta la sostienen las pruebas de componente (13 archivos, 269 pruebas del
  módulo) y la integración.
- **No se creó catálogo de color de avío** — decisión de Daniel (§Post-F9.91): *"el color va en su
  descripción"*.
- **La recepción no aprendió medidas** — es el límite declarado de arriba.

### Nota de cierre — ✅ HECHA (27-ago-2026)

Versión **0.040**. **CON migración** (aditiva, `20260827120000_la_medida_y_el_color_del_avio`) y **SIN
permisos nuevos** ⇒ **no requiere `SEED_ON_START`**. Backend **169 archivos / 2 100 pruebas**, frontend
**190 / 1 637**; typecheck, lint, format y los dos contratos regenerados, en verde. El contrato **cambia
de forma** (el ajuste del comprador renombra `idTelaColor` → `idColor` y estrena `colorTexto`; los
renglones y las líneas estrenan color y desglose), así que el cliente del frontend se regeneró en la
misma tarea.

---

## V1-E8b · EL PRECIO DE VENTA ES SÓLO DEL DUEÑO ⭐⭐ (26-ago-2026) — ✅ HECHA

**§Post-F9.125.** Cuatro decisiones de Daniel del mismo día, que son **una sola pieza**, y un principio
que resuelve los casos que no se previeron:

> *"Puede hacer sus cálculos, pero **el sistema no le muestra información digerida**."*

### El problema

§Post-F9.123 dejó escrito cómo se trabaja hoy: *"ella arma un excel con todos los costos, me los pasa,
**yo reviso y le doy el precio de venta**"*. El sistema no reproducía ese reparto. Aurora —`Gerencial`—
podía **mover** los porcentajes con los que se calcula el precio, **verlos**, y **bajarle al cliente** un
papel con precios que nadie había aprobado. Y encima, mover un factor **dejaba en pie** aprobaciones que
ya no correspondían a esos factores.

### Qué entrega

- **(a)** Mover los cuatro factores —margen · descuentos · regalías · costo de ventas— exige
  **`listas.aprobar`**, no `listas.administrar`. **En las DOS puertas**: el snapshot de la lista y el
  catálogo de factores del **CLIENTE**, del que la lista copia su snapshot al nacer.
- **(b)** Los cuatro salen en **`null`** para quien no los pueda mover, con **UN solo criterio**
  (`puedeVerFactoresDePrecio`) que usan las tres proyecciones.
- **(c)** **De una lista sin aprobar no sale papel, ni borrador**: cotización, PDF y Excel comparten el
  guard `exigirRenglonesAprobados`, que rechaza **nombrando los renglones** que faltan.
- **(d)** Mover un factor **tumba las aprobaciones**, con nota de qué las invalidó y cuándo; la firma
  vieja no se borra (D3) y se vuelve a firmar normalmente. **No hay estado muerto.**

### 🔴 El barrido encontró TRES puertas a los factores, no dos — y la tercera era la más ancha

El encargo nombraba el snapshot de la lista. Aparecieron dos más, y ninguna era obvia:

1. **El catálogo de factores del CLIENTE** (`cliente-factores.ts`). Blindar sólo la lista habría dejado
   ésta abierta: se mueve el factor del cliente y el precio de la **próxima** lista sale distinto, sin
   pasar por el dueño. *Un candado que se rodea por el catálogo de al lado no es un candado.*
2. **La CALCULADORA de la mesa** (`simularNegociacion`). No "dejaba deducir" el margen: lo **servía**.
   `margenObjetivoPct` **ES** el factor `margenPct` del snapshot, devuelto tal cual; `precioNeto ÷
   objetivo` entrega la **suma de los otros tres**; `margenBrutoPct` arrastra esa fuga; y
   `cumpleObjetivo` es un **oráculo** (se mueve el objetivo hasta que la respuesta cambia y se
   reconstruye el margen a voluntad). La pantalla lo pintaba literalmente: **`Cumple · obj. 44.4%`**.
   Eso es *información digerida*, que es justo lo que Daniel dijo que no debía pasar.

Y una **cuarta**, en el frontend, que **la levantó una prueba y no el barrido**:
`EditorFactoresCliente.tsx` tenía su **propia "segunda barrera"** en `consultas.ver-importes`, mientras
la página de arriba ya pedía `listas.aprobar`. Era exactamente el par de criterios *"casi iguales"* que
se desincronizan — y se desincronizó en la misma etapa que los unificaba.

### 📏 Cómo se cuentan, porque los números confunden juntos

**CUATRO** lugares que proyectan o mueven factores (lista · catálogo del cliente · simulación · editor
del frontend), **UN** criterio (`puedeVerFactoresDePrecio`), **TRES** salidas de documento que comparten
el guard de aprobación (cotización · PDF · Excel).

### ⭐ Y (d) no se parcheó: se unificó

`editarFactoresLista` recalculaba *"sin tocar los aprobados"*, escrito como cortesía —**no pisarle la
firma al dueño**— y con el efecto contrario: un precio APROBADO que ya no correspondía a los porcentajes
con que se calculó, presentado como firmado.

🔴 **Y había DOS criterios para el mismo hecho:** `registrarRonda` SÍ resetea la aprobación cuando cambia
el COSTO. Que mover el costo tumbara la firma y mover el margen no, **no era una distinción de negocio**:
era que nadie las había mirado juntas.

Se unificaron con la regla de **V1-E7e (§Post-F9.116)** y **por el mismo camino**: el
`NegociacionEvento` inmutable que la ronda ya usaba. Sin migración, sin columna nueva, y el historial que
la pantalla ya enseña se lleva la nota. La bitácora guarda además, renglón por renglón, **quién había
aprobado y cuándo**.

⚖️ **Guardar los MISMOS valores no tumba nada**: sin hecho detrás no hay firma que caer.

### ⚠️ El límite que se declara, no se calla

Aurora ve el **costo** y ve el **precio** ⇒ **el margen sale con una división**. Se le planteó a Daniel y
**eligió a sabiendas**: se oculta el NÚMERO, no la ARITMÉTICA. Cerrarlo exigiría quitarle el costo o el
precio a Desarrollo y **rompería su trabajo**. Queda escrito en `cliente-factores.ts`, en el contrato y
en la decisión — para que dentro de seis meses nadie lo "descubra" y crea que es un defecto.

### Cómo se verificó (mutación, no sólo verde)

Cada mutación se ancló **por número de línea** y se confirmó con `git diff` que tocó **código**, no un
comentario:

| Mutación | Qué murió | ¿La esperada? |
|---|---|---|
| `listas-precios.ts:505` `'listas.aprobar'` → `'listas.administrar'` | *"AURORA … ya NO puede: 403 y NADA escrito"* | ✅ |
| `listas-precios.ts:181` `verFactores` → `verImportes` | *"a AURORA los cuatro le llegan en null"* | ✅ |
| `listas-precios.ts:184` quitar el ternario de `costoVentasPct` | la misma | ✅ cada factor anclado por separado |
| `listas-precios.ts:552` `const tumbar = false` | **4 rojas**: limpieza + evento/bitácora + "no hay estado muerto" + "cualquiera de los cuatro" | ✅ exactas |
| `listas-precios.ts:521` `const cambiaron = true` | *"guardar los MISMOS factores no tumba ninguna firma"* | ✅ |
| `listas-precios.ts:593` `aprobadoPorId: null` | *"la firma vieja NO se borra … (D3)"* | ✅ D3 anclado |
| `listas-precios.ts:570` `fechaDelActo` → `toISOString()` | la misma (afirma `12/8/2026`, no el 13 de UTC) | ✅ el huso del negocio está probado |
| `negociacion.ts:403/405/406` quitar el ternario, **uno por uno** | *"a AURORA los CUATRO le llegan en null"*, roja las 3 veces | ✅ cada campo anclado |
| `cliente-factores.ts:75` criterio → `consultas.ver-importes` | **4 rojas**, las tres proyecciones + el criterio | ✅ el criterio es UNO |
| `cliente-factores.ts:256` `'listas.aprobar'` → `'listas.administrar'` | *"AURORA no puede GUARDARLOS"* | ✅ la 2ª puerta |
| `cliente-factores.ts:133` quitar el ternario | *"los % le llegan en null"* | ✅ |
| `impreso-lista-precios.ts:93` borrar el guard | *"el PDF se rechaza NOMBRANDO el modelo que falta"* | ✅ |
| `excel-lista-precios.ts:51` borrar el guard | *"el Excel se rechaza igual"* + la lista vacía | ✅ |
| `cotizaciones.ts:145` `sinAprobar = []` | **7 rojas** en 2 archivos: el guard, sus mensajes, el folio no quemado, el PDF y el Excel | ✅ un solo criterio para las tres salidas |

**El permiso NO se probó leyendo el seed:** `roles-reparto.test.ts` **ejecuta** `definirRoles()` y afirma
que `listas.aprobar` lo tienen **exactamente** `Administrador`, `AdministracionDireccion` y `Directivo`
—y **nadie más**—, que `Gerencial` y `Ventas` **sí** tienen `listas.administrar` y **no** el de aprobar, y
que `consultas.ver-importes` no alcanza. (La lista completa se compara con `toEqual`, así que una fuga
como la del `.concat` de §Post-F9.123 sale roja con nombre y apellido.)

### Lo que NO se hizo, y por qué

- **No se corrieron las pruebas de integración ni las e2e**: nada de Docker en esta máquina (regla del
  proyecto). Están **escritas** —la suite de factores de `listas-precios.int.test.ts` se **invirtió**
  entera, `negociacion.int.test.ts` gana el caso de la simulación en `null`, y el e2e comprueba el **409
  del PDF y del Excel antes de aprobar** más los botones deshabilitados— y viajan al CI, **que es el
  único juez**.
- **`precioAprobado ?? precioCalculado` sobrevive** donde el número es un **default interno editable** y
  no un papel para el cliente: el precio sugerido al ligar la orden (`sugerenciaLigaOrden`) y los
  candidatos del pedido. Es una decisión, no un olvido.
- **No se cerró el eslabón de abajo** — es alcance nuevo y lo tiene que decidir Daniel.

### 🔴 EL ESLABÓN SUELTO — medido, NO construido

**Lo que se midió con los ojos:**

1. `ListaPreciosLinea` guarda `idPrecosto` (una versión **CONGELADA**) y una **copia** de su `costoUnit`.
2. Las versiones congeladas son **INMUTABLES** por diseño (`precostos.ts`: recalcular/editar/congelar
   sobre una congelada ⇒ `ErrorConflicto`). **Eso está bien** y no se toca.
3. Cambiar la receta del modelo pasa por el embudo de V1-E7e (`tocarModeloPorCambioDeReceta`, **12
   llamadas** desde 5 archivos): tumba la **revisión del MODELO** y sella `Modelo.modificadoEn`. **No
   toca ningún precosto ni ningún renglón de lista.**
4. ⇒ Tras cambiar la receta hay que **congelar una versión nueva** *y* **registrar una ronda** (que
   re-apunta el renglón y resetea la firma), las dos **a mano**. Si se olvida cualquiera, **el precio
   aprobado sigue en pie sobre un costo que ya no existe, y nada avisa.**

**Lo acotado que sería cerrarlo, y su trampa:** la señal ya existe en los datos —
`Modelo.modificadoEn > Precosto.congeladoEn` (las dos columnas están y `congeladoEn` se llena al
congelar)— así que **marcar la lista no necesita migración**. 🔴 **Pero `Modelo.modificadoEn` es
`@updatedAt`**: se mueve con **cualquier** escritura al modelo, y hay **14** en el código que no son
receta (renombrar la descripción, pasar a producción, la propia firma de revisión, las fotos…). Usarla
tal cual daría **falsas alarmas**, que es la peor clase de aviso: el que se aprende a ignorar.

> ⚠️ **El «14» no se pudo reproducir al construirlo.** Recontando en `V1-E8d`, las escrituras a
> `Modelo` que **no** son cambio de receta salen **11** (9 fuera de `revision-modelo.ts` —editar el
> modelo, la curva desde órdenes, pasar a producción, las 4 de fotos, el desarrollo y el ETL de
> fotos— más las **2 firmas de revisión**; la invalidación de V1-E7e no cuenta porque la causa un
> cambio de receta). Se corrige el número **y se anota en vez de borrarse**: el argumento no depende
> de la cifra —basta con que sean varias— pero *un número citado que nadie puede reproducir enseña
> a no verificar los demás*.

**Las dos opciones, para que Daniel elija:**

- **(A) Barata y honesta** — comparar contra `Modelo.modificadoEn` y decir en el aviso lo que de verdad
  sabe: *"este modelo se tocó después de congelarse el costo; revísalo"*. Cero migración, falsos
  positivos asumidos y **dichos**.
- **(B) Exacta** — una columna `recetaTocadaEn` en `Modelo`, escrita **sólo** por el embudo de V1-E7e
  (una línea, y el embudo ya es obligatorio: una puerta nueva no compila sin declarar su cambio).
  Migración de **una columna aditiva**, sin falsos positivos.

**Recomendación: (B).** El embudo ya existe y ya es un cuello obligado; la columna lo aprovecha en vez
de inventar un mecanismo nuevo, y evita estrenar un aviso que nace mintiendo. **NO se construyó ninguna
de las dos.**

> ✅ **CERRADO en `V1-E8d` (27-ago-2026, §Post-F9.127).** Daniel: *"Si. Ok. **Que me avise.**"* Se
> construyó la **(B)**. ⚠️ Se cerró como **AVISO**: la firma **no** se cae y la cotización/PDF/Excel
> **siguen saliendo** — el hueco que eso deja queda declarado en la ficha de `V1-E8d` y en la decisión.

### Nota de cierre — ✅ HECHA (26-ago-2026)

Versión **0.039**. **SIN permisos nuevos** (`listas.aprobar` ya existía y su reparto **no se toca**)
⇒ **NO requiere `SEED_ON_START`**. **SIN migración de BD.** Backend **168 archivos / 2 049 pruebas**,
frontend **190 / 1 623**; typecheck, lint, format y los dos contratos regenerados, en verde. El
contrato **cambia de forma** (los cuatro campos de la simulación pasan a `nullable`), así que el cliente
del frontend se regeneró en la misma tarea.

---

## V1-E8a · SE RETIRA EL FACTOR DE CONVERSIÓN DE AVÍOS ⭐⭐ (26-ago-2026) — ✅ HECHA

**§Post-F9.97.** Daniel, al presentarle el análisis del factor —la deuda que arrastraba V1-E5, con tres
trampas y una columna nueva por delante—: *"Vamos a simplificar las cosas. Vamos a meter los avíos por
**medidas unitarias** y así dejamos de batallar con factores… dejamos la orden de compra por metro y en
todo caso **en observaciones ponemos la cantidad de rollos de manera informativa**. Porque aparte **la
información viene desde el desarrollo, y ahí se costea por metro, no por rollo**."*

⭐ **LA REGLA que queda escrita: la línea de orden de compra va SIEMPRE en unidad de consumo** (metro,
pieza, kilo). La presentación —rollo, caja, bolsa— **no es una unidad del sistema**: si hay que decirla,
va como texto informativo en `OrdenCompra.observaciones` o en `OrdenCompraLinea.descripcionLibre`.

⚖️ **Por qué es correcta y no sólo cómoda.** El costo nace en Desarrollo, y ahí se costea por metro. Un
sistema que compra en rollos y costea en metros necesita una traducción **en medio de la cadena del
dinero**, y ahí es donde se cuelan los errores que nadie ve: como el factor **multiplica la cantidad y
divide el precio**, el importe total sale idéntico —la invariante de valuación se cumple— **sobre números
equivocados**. Sin dos unidades no hay traducción que equivocarse.

**Esta etapa es de RETIRAR, no de agregar.** No se construyó la captura de `factorConversion` ni la
columna `orden_compra_linea.factor_aplicado`: las dos quedaron **canceladas**, no pospuestas.

### 🔴 Lo que se midió con los ojos ANTES de tocar nada

1. **El defecto era real y estaba en el LECTOR.** El MRP escribe la línea de OC ya en unidad de consumo
   (`mrp.ts`: la cantidad sale del requerido del BOM y el precio de `resolverPrecioAvio`, que devolvía
   `precio ÷ factor`), y la recepción la volvía a **multiplicar** por el factor y a **dividir** el precio.
   ⇒ el arreglo era **alinear al lector con el escritor**, tal como decía la decisión. Verificado leyendo
   las dos puntas antes de editar: si el escritor hubiera escrito en presentación, el sentido del arreglo
   se invertía.
2. **Riesgo de datos: CERO, comprobado de nuevo aquí.** `grep factorConversion` da **0 hits** en
   `backend/src/contrato/`, **0** en `backend/migracion/`, **0** en `frontend/src/` y **0** en el contrato
   generado del frontend. **El factor nunca tuvo escritor**: jamás se pudo capturar. Con la columna en
   NULL, presentación ≡ consumo, así que **toda línea histórica es válida en la lectura de hoy**. No hay
   migración de datos, ni reproceso de kardex, ni nota al pie.
3. 🔴 **Había una CUARTA pieza que el encargo no traía: seis lectores más.** El análisis previo señalaba
   tres sitios; el barrido encontró que el factor se leía además en **toda la cascada de precios**
   (`resolucion-precios.ts`, `ultimo-precio-compra.ts`, `proveedor-material.ts`, `pre-costo.ts`,
   `precostos.ts`, `bom-modelo.ts`, `catalogos/avios.ts`, `mrp.ts`) y en el **costo real**
   (`cantidadConsumo = cantidad × factor`, el mismo defecto de la recepción en otra pantalla).

### ⭐ Por qué se retiraron TODOS los lectores y no sólo los tres del encargo

La decisión dice que los campos quedan *"muertos: **sin escritor, sin lector**"*. Con seis lectores vivos
eso no sería cierto — y **un retiro parcial sería peor que cualquiera de los dos extremos**: si la cascada
siguiera dividiendo el precio por el factor mientras la recepción ya no multiplica la cantidad, quedaría
**exactamente la traducción asimétrica** que la decisión mata, sólo que a la mitad. Numéricamente el
retiro completo es un **no-op** hoy (el factor siempre es NULL ⇒ identidad); lo que cambia es que la bomba
deja de estar armada.

### Lo retirado

- **La recepción deja de convertir** (`compras/recepciones.ts`): se fue `convertirLineaCompra` y el helper
  `factorAvioLinea`; la línea entra al kardex con `cantidad` y `precio` **tal cual**.
- **El costo real deja de convertir** (`costos/costo-real-compras.ts`): murieron `avisoFactor`,
  `factorDeLinea`, `leerFactores` y el campo `cantidadConsumo` de `LineaCompraLigada` (era la MISMA
  cantidad, multiplicada de más). ⭐ Con ellos **quedó saldada la «deuda conocida de F4»** que ese módulo
  documentaba y que `HOJA-DE-RUTA.md` §4 listaba: el aviso desapareció junto con el problema que anunciaba.
- **La cascada de precios deja de dividir**: `resolucion-precios.ts` (`costoNormalizado` → `costoDeProveedor`,
  que ya sólo devuelve el precio), `ultimo-precio-compra.ts` (fuera `leerFactoresDeConversion`, `factorDeFila`
  y el campo `factor` del resultado), `proveedor-material.ts`, `pre-costo.ts`, `precostos.ts`,
  `modelos/bom-modelo.ts`, `catalogos/avios.ts` y el plomería del `mrp.ts`.
- **`comun/conversion.ts` y su test: BORRADOS.** Sin lectores, el módulo era aritmética muerta — y dejar
  viva una función llamada `convertirLineaCompra` es justo cómo se reintroduce la dualidad.
- **El campo `precioUnidadConsumo` del contrato de avíos: RETIRADO.** Existía **sólo** como
  `precio ÷ factor`; sin factor era una copia literal de `precio`, o sea la dualidad escrita en el
  contrato. La pantalla del amarre (`EditorBom.tsx`) ya caía a `precio`, así que fue una línea.

### Lo que se CONSERVA, y por qué

🔴 **Las columnas `Avio.factorConversion` y `AvioProveedor.factorConversion` NO se borran.** El proyecto
sigue D3: nada se destruye. Quedan en el esquema **marcadas como muertas** —con la regla completa y su
porqué en el TSDoc— y **vacías**, que es la garantía de que siguen muertas. **No hace falta migración:** el
único cambio del `schema.prisma` es de comentarios.

**Dónde quedó escrita la regla** (tres sitios, redactada como regla y no como nota): el modelo
`OrdenCompraLinea` del esquema, la cabecera de `dominio/compras/recepciones.ts` y el TSDoc de las dos
columnas muertas. Las tres dicen lo mismo y las tres explican **por qué** no se reintroduce.

### Verificación — mutaciones ancladas POR LÍNEA

| # | Qué se mutó (archivo:línea) | Qué prueba murió | ¿La esperada? |
|---|---|---|---|
| M1 | `resolucion-precios.ts:281` — `costoDeProveedor` devuelve `precio / 50` | *el precio del proveedor ES el costo por unidad de consumo — no se divide por nada* (+5 de la cascada) | ✅ sí |
| M2 | `proveedor-material.ts:109` — `precioProveedorAvio` devuelve `precio / 2` | *devuelve el precio TAL CUAL, sin dividirlo por nada* (+3: habitual y más barato) | ✅ sí |
| M3 | `costo-real-compras.ts:349` — `comprado += l.cantidad * 144` | *resta del requerido la cantidad de la línea de OC, tal cual* (+2 de prorrateo) | ✅ sí |

Las tres se verificaron **leyendo la línea mutada** después de aplicarla (`sed -n`), no por texto: la
trampa del ancla es cambiar un comentario que menciona la frase y creer que se mutó el código.

| | backend | frontend |
|---|---|---|
| tests | **166 / 2002** ✅ | **190 / 1615** ✅ |
| typecheck · lint · format | ✅ · ✅ · ✅ | ✅ · ✅ (22 warnings pre-existentes) · ✅ |

### ⚠️ Declarado y NO hecho

- 🔴 **LA RECEPCIÓN —la pieza 1, el corazón del arreglo— NO TIENE PRUEBA CORRIDA.** Su única cobertura es
  de **integración** (`recepciones.int.test.ts`), y las de integración **no se corrieron** (nunca Docker
  local, §7.9). La prueba está **reescrita** para ser el guardián exacto: ceba la columna muerta con 144 y
  exige que la existencia del kardex quede en 2,160 y no en 311,040. 🔴 **La aserción que caza el defecto
  es la de la EXISTENCIA, no la del importe** — el importe cuadra en $4,320 con factor y sin él, y por eso
  el defecto vivió tanto. **La palabra final es el CI.**
- **Tampoco se corrieron** las otras pruebas de integración reescritas: `ultimo-precio-compra.int`,
  `costo-real-compras.int`, `catalogos/avios.int`, `modelos.int`, `mrp.int`, `precostos.int`.
- **Cobertura retirada, no perdida.** Murieron con su sujeto: *"el fallback más barato usa el
  `Avio.factorConversion`"*, *"cae al factor del AVÍO cuando el proveedor no fija el suyo"*, *"usa el
  factor del AVÍO"* y todo `comun/conversion.test.ts`. Cada una probaba la conversión, que **dejó de
  existir**. Lo que sí sobrevivía de dos de ellas se conservó re-apuntado: que amarrar al mismo proveedor
  no mueva el precio, y que la ficha del modelo abra con la columna muerta cebada.
- ⚠️ **Dos pruebas de cola larga cambiaron de FUENTE, y hay que saberlo.** *"con un precio de cola larga,
  el total de la previa es el que la OC guarda"* (`mrp.int`) y *"un precio de cola larga no descuadra
  precio e importe"* (`precostos.int`) sacaban sus decimales infinitos del factor (100 ÷ 3). Sin factor,
  **todos los precios de catálogo son `Decimal(12,2)`** y por ahí ya no entra ninguna cola. Se
  re-apuntaron a las **dos fuentes que siguen vivas**: el precio que **teclea el comprador** en la previa
  (§Post-F9.94, un `number` del cuerpo sin tope de decimales) y el **promedio de medidas** del avío por
  medida (R5/B11). El redondeo que protegen sigue haciendo falta; sólo cambió quién lo pone a prueba.
- **No se tocó** el avío "por medida" (R5/B11) ni su promedio: es otra cosa: N precios por medida, no dos
  unidades del mismo precio.

---

## V1-E7e · LA APROBACIÓN SE CAE SI LA RECETA CAMBIA ⭐ (26-ago-2026) — ✅ HECHA

**§Post-F9.116.** El hueco que **declaró el coder de V1-E7d** al cerrar su etapa —no lo encontró
Daniel usando el sistema: salió de un coder diciendo en voz alta lo que su propio trabajo dejaba
abierto— y que **Daniel mandó cerrar**: *"Sí, ciérralo."*

### El problema

Aurora revisa la versión y la **aprueba**. Después alguien le cambia el consumo de una tela, o le
mueve el arte. Y la orden de producción sale **con la aprobación vieja**, sobre una receta que ya no
es la que ella miró.

⚖️ Es **exactamente el problema que la revisión viene a evitar, entrando por otra puerta** — y peor,
porque el sistema **la presenta como revisada**. *Una firma que no está amarrada a lo que se firmó no
es una firma: es un adorno.*

Y Daniel puso la condición que fijó el alcance: *"cubrir sólo una parte sería **PEOR** que no cubrir
nada: parecería resuelto sin estarlo"*.

### Qué entrega

- **Cualquier cambio a la receta de una versión APROBADA la devuelve a `pendiente`**, con nota de
  **qué la invalidó y cuándo**, más de cuándo era la firma que tumbó (A7).
- **La firma vieja no se borra** (D3): vive en la bitácora con quién aprobó y cuándo. El sistema puede
  contestar *"Aurora la aprobó el 12, se le cambió la tela el 14, y volvió a firmarse el 15"*.
- **Se vuelve a firmar normalmente**, con el mismo permiso. **No hay estado muerto.**
- **§Post-F9.119 de pasada:** no se versiona un modelo descontinuado — hay que reactivarlo primero. El
  vecino `crearDesarrollo` ya lo bloqueaba: eran **dos puertas con reglas distintas para el mismo
  hecho**. *El valor no está en impedir el versionado —reactivar cuesta un clic— sino en que revivir un
  modelo sea un acto que alguien decide, y no un efecto lateral de otra operación.*

### 🔴 El barrido encontró SEIS puertas, no las cuatro que el lead listó

Se le habían escapado dos, y ninguna era obvia:

1. **Avíos favoritos** — un botón que mete avíos **directo al BOM**, saltándose la pantalla normal.
2. **Las fotos del arte** — y ésta importa: *la imagen ES lo que el bordador va a hacer.* Cambiarla
   cambia el producto. El código ya las trataba como modificación del modelo; el lead no las contó.

📏 **Cómo se cuentan, porque los dos números son ciertos y confunden juntos:** **SEIS puertas**
—acciones del usuario: PUT de telas, PUT de avíos, copiar receta de otro modelo, avíos favoritos,
medidas por talla, y el arte— repartidas en **CINCO archivos**. El guardián trabaja por archivo; el
negocio cuenta acciones. *(La primera redacción usaba los dos números sin decir cuál era cuál; lo
levantó el reviewer.)*

### ⭐ Y no se parchearon las seis

Había **tres copias** de `tocarModelo` —bom / arte / medidas— y cada mutación llamaba a la suya. **El
embudo ya existía: sólo estaba triplicado.**

Se unificaron en **`tocarModeloPorCambioDeReceta(tx, sesion, idModelo, cambio)`**, con `cambio` como
**parámetro obligatorio** ⇒ **una puerta nueva no compila hasta que declara qué toca.** Deja de
depender de que alguien se acuerde de añadirla.

> 📌 **Y ese embudo terminó valiendo más de lo que costó:** `V1-E8d` (§Post-F9.127) le colgó ahí mismo
> la **marca de agua de la receta** (`Modelo.recetaTocadaEn` + `recetaTocadaCambio`), que es lo que
> permite avisar cuando un precio ya aprobado quedó sobre un costo viejo — sin inventar un mecanismo
> nuevo y sin falsas alarmas.

### Cómo se verificó (mutación, no sólo verde)

| Mutación | Qué murió | ¿La esperada? |
|---|---|---|
| Quitar el argumento `'telas'` en `bom-modelo.ts` | **El compilador**: `TS2554: Expected 4 arguments, but got 3` | ✅ el `cambio` es obligatorio de verdad |
| Archivo nuevo con `tx.modeloTela.updateMany` | 2 pruebas del guardián, nombrando el archivo | ✅ |
| Vaciar `invalidarRevisionSiAprobada` | 6 rojas: el embudo + **los cinco ciclos**, uno por tipo de cambio | ✅ exactas |
| Borrar la llamada al embudo **una por una**, en los 7 sitios | El guardián de conteo, rojo en las 7 | ✅ cada puerta anclada individualmente |
| `idAprobadorAnterior: null` | *"la BITÁCORA se lleva la firma vieja entera"* | ✅ D3 anclado |
| `if (!padre.activo)` → `if (false)` | 2 rojas (§Post-F9.119 + su mensaje) | ✅ |
| Revertir `ModelosPagina.tsx` a la resolución de `prueba` | *"una versión INVALIDADA enseña POR QUÉ perdió la firma"* | ✅ y demuestra que `prueba` **mentía** |
| Puerta nueva **ANIDADA** (`modelo.update({data:{telas:{updateMany}}})`) | **Al principio, NADA** — punto ciego (ver abajo) | ❌ → cerrado en la ronda de corrección |

### 🔴 Lo que el reviewer encontró — RECHAZADA en la 1ª vuelta

El reviewer barrió las puertas por su cuenta (no se creyó la lista) y **aprobó la ingeniería sin
reservas**: 12 llamadas al embudo, todas presentes; cero SQL crudo; las 12 dentro de la misma
transacción que el cambio (A2); la única excepción —`versiones.ts`, que copia la receta a un modelo
recién nacido sin firma que tumbar— **declarada con su razón**.

**Rechazó por la DOCUMENTACIÓN**, y tenía razón: es parte del entregable (CLAUDE.md §7.2) y faltaba.

1. 🔴 **La ficha de esta etapa no existía.** El diff no tocaba un solo archivo de `docs/`. *(Ésta.)*
2. 🔴 **§Post-F9.116 no estaba en `DECISIONES.md`** — la decisión que gobierna toda la etapa, citada
   por **20 lugares** entre código y pruebas, y **quien siguiera la referencia no llegaba a nada**. Al
   escribirla aparecieron **tres más en la misma situación** (117, 118, 121): dos números que se
   pronunciaron en el chat y nunca fueron entrada, y la **118** —lo que entra y lo que no a la primera
   versión— que sí era de Daniel y sí estaba citada. *Se escribieron las cuatro.*
3. **El punto ciego de la escritura ANIDADA.** El reviewer escribió
   `tx.modelo.update({ data: { telas: { updateMany: … } } })` y **el guardián no la vio**: sólo miraba
   la escritura directa. Cerrado: hoy mira las dos formas, y la mutación lo confirma.
4. **El guardián sólo barría `src/`**, y `backend/migracion/` también escribe estas tablas. Hoy barre
   las dos raíces, con los cargadores del ETL como **excepción declarada** (cargan modelos migrados,
   que nunca tuvieron firma) — que es lo contrario de no mirarlos.
5. **Los dos conteos peleados** (SEIS vs. CINCO). Unificados con la explicación de cuál es cuál.
6. **Un fixture desactualizado** con fechas ISO que el backend ya no emite. No rompía ninguna
   aserción — y por eso mismo enseñaba un formato falso a quien lo leyera. Corregido.

⚖️ **Lo que el reviewer NO exigió, y lo dijo con su razón:** una carrera de milisegundos entre firmar y
editar la receta. *"Es un subconjunto de milisegundos de una carrera humana de minutos que el diseño ya
acepta de raíz —Aurora mira la receta, pasa medio minuto, firma—. Cerrar la de la base sin poder cerrar
la del humano sería precisión falsa."* Queda dicho, no callado.

### El CI en rojo, y era la prueba

Una prueba de integración exigía que la bitácora tuviera **exactamente tres** actos. Pero ahí se anotan
también otros hechos de la vida del modelo (`crear-version`, `pasar-a-produccion`), y se puso roja en
cuanto V1-E7d añadió el suyo: **falló sin que la conducta que vigila hubiera cambiado**. Ahora filtra
los actos de revisión y afirma **su orden**. *Una prueba que se rompe por algo que no vigila enseña a
ignorarla.*

### Notas del trasplante

Esta rama se rebasó sobre `prueba` **tres veces** (el merge aplastado de V1-E7d rompía la ascendencia):

- **La función de fechas se unificó con V1-E7d**: aquélla renombró `fechaCorta` → `fechaDelActo` al
  arreglar que el mensaje y la pantalla enseñaran **días distintos** para el mismo acto. La prueba de
  la nota afirmaba ISO —cierto cuando se escribió— y **se actualizó, no se aflojó**.
- **El conflicto de la pantalla se resolvió a favor de esta rama, y no por ser la nuestra**: `prueba`
  enseña *"nadie la ha revisado todavía"* cuando no hay firma, y **no conoce el caso que esta etapa
  estrena** —una versión que volvió a pendiente **CON nota**—. El reviewer lo comprobó revirtiéndolo.
- **Renumerada tres veces** (0.035 → 0.036 → 0.037): el ETL de fotos y el arreglo del respaldo tomaron
  esos números primero. *El número se asigna al entrar a `prueba`, no al escribirse.*

### Declarado y NO hecho

- ⚠️ Sigue en pie **la TERCERA puerta a producción** (`crearOrden` hace la OP sin promover), anotada
  desde V1-E7d en `HOJA-DE-RUTA.md` §4.
- **Siguen abiertas** las dos preguntas de §Post-F9.110: la versión **nace suelta** y la lista de
  precios sigue apuntando al padre.

### Nota de cierre — ✅ HECHA (26-ago-2026)

Versión **0.037**. **Sin permisos nuevos** (reusa `modelos.aprobar-receta` de V1-E7b) ⇒ **no requiere
`SEED_ON_START`**. Sin migración. Backend **168 / 2046**, frontend **190 / 1618**; typecheck, lint,
format y los dos contratos regenerados, en verde. Las de integración **no se corrieron en local** (nada
de Docker, regla del proyecto): viajan en el CI, que es el único juez.

---

## V1-E7d · LA REVISIÓN ANTES DE MANDAR A PRODUCIR ⭐ (26-ago-2026) — ✅ HECHA

> ✅ **El hueco que esta etapa DECLARÓ quedó cerrado por `V1-E7e`** (arriba, versión 0.037): una
> aprobación ya no sobrevive a un cambio de receta. Se anota aquí para que nadie lea esta ficha y crea
> que el agujero sigue abierto. *Un hueco declarado que nadie cierra se vuelve, con el tiempo,
> indistinguible de uno que nadie vio.*

> 📌 **Viaja con §Post-F9.123 — «Aurora administra modelos»** (mismo commit, misma versión **0.034**):
> `modelos.administrar` cambia de escalón y pasa a cortarse en **Ventas** en vez de en Directivo, así que
> lo conservan Administrador, AdministracionDireccion, Directivo y **Gerencial** (Aurora). Entra aquí
> porque es el mismo territorio —los permisos de modelos— y porque sin él quien lleva Desarrollo no podía
> ni dar de alta un modelo. Decisión completa, la línea *"ve el PLAN, no el RESULTADO"* y la fuga de
> permisos que hubo que corregir: `DECISIONES.md` **§Post-F9.123**.
> 🔴 **Requiere `SEED_ON_START=true`** en el deploy, o el reparto nuevo no llega.

**§Post-F9.110, apartado (b)** — la segunda de las dos piezas de esa decisión (la primera fue `V1-E7b`,
abajo). Daniel:

> *"Creo también que después de la negociación con el cliente, debe de haber una revisión antes de
> mandar a producir. Porque luego en la negociación enfrente del cliente puede ser que se cometa una
> imprudencia o un error."*

### El problema que resuelve

`V1-E7b` entregó el MECANISMO: la negociación mueve la receta en vivo y, en vez de editar el modelo,
nace `CYA-26-71-001-01` con la receta heredada y el padre intacto. Lo que faltaba es **la bisagra**: el
momento en que esa decisión de mesa se vuelve un compromiso de producción, y que ese momento quede
**firmado, con quién y cuándo** (A7).

⇒ **Una versión no pasa a producción sin que alguien la firme.**

### Lo construido

| Pieza | Qué hace |
|---|---|
| `Modelo.revisionEstado` + `idRevisadoPor` + `revisadoEn` + `revisionNota` | El acto de revisión como dato: en qué quedó, quién lo firmó, cuándo y con qué observación. Migración aditiva; enum `EstadoRevisionModelo`. |
| `dominio/modelos/revision-modelo.ts` | La **compuerta** (`exigirRevisionAprobadaParaProducir`, función pura) y las **dos firmas** (`aprobarRevisionModelo` / `rechazarRevisionModelo`), cada una en UNA transacción con su bitácora dentro (A2/A7). |
| `POST /api/modelos/:id/revision/aprobar` · `.../rechazar` | Las dos puertas, bajo `modelos.aprobar-receta` — el permiso que ya creó `V1-E7b`, **no** `listas.aprobar` (el precio sigue siendo sólo del dueño). |
| Chip de estado + los dos botones en la ficha | Dice en qué quedó la revisión, quién firmó y cuándo; el rechazo enseña **el motivo**, que es lo único que le sirve a quien tiene que corregir. |

### 🔴 Dónde vive la compuerta, y por qué no donde parecía

La regla **no** vive en el endpoint «pasar a producción»: vive dentro de `promoverAProduccionNucleo`
(`nomenclatura.ts`), el núcleo que ese endpoint **comparte con generar una OP** —
`produccion/salida-produccion.ts` paso 4 **promueve el modelo solo**. Puesta en el endpoint, una versión
sin revisar llegaría a producción por la **puerta lateral** de generar su OP, que es exactamente lo que
la decisión viene a impedir.

Por eso la compuerta cubre **los dos caminos que PROMUEVEN** el modelo. Y está probado donde de verdad se
puede romper: al borrar la compuerta mueren **cuatro** pruebas de `salida-produccion.test.ts` — o sea, la
puerta lateral **sí** está cubierta, no sólo declarada.

### A quién alcanza, y a quién NO

Sólo a las **versiones**: lo que nació de una negociación (`idModeloPadre` **o** `versionDesarrollo` no
nulos — cualquiera de las dos basta; la lectura conservadora es exigir la firma de más, nunca de menos).
Los ~4,987 modelos migrados del Access y los desarrollos normales **no cambian de conducta**. Ensanchar
la compuerta al catálogo entero sería una decisión de negocio que Daniel no ha tomado.

**`null` se lee como PENDIENTE**, nunca como aprobada: una versión sin firma no se produce.

### 🔴 Lo que encontró la revisión independiente

**Una versión con `revisionEstado` en NULL quedaba SIN SALIDA en la pantalla.** El dominio pregunta *"¿es
versión?"* por el **linaje**; el frontend lo preguntaba por `revisionEstado !== null` — un **proxy** que
sólo acierta porque «crear versión» siempre escribe `'pendiente'`. Con la columna en NULL, el backend
niega producir (null = pendiente) y la ficha **no pintaba ni el chip ni los botones**: una versión que no
se puede producir y que nadie puede firmar. **Dos puertas con reglas distintas para el mismo hecho** — el
patrón que §Post-F9.119 acaba de marcar en este mismo proyecto.

Y era **alcanzable**: `V1-E7b` entró a `prueba` (0.029) **antes** que esta migración, así que toda versión
creada ahí nace sin la columna. El código prometía una firma que la pantalla no dejaba dar. Arreglado
haciendo que **las dos condiciones usen el mismo predicado del dominio** (las dos columnas del linaje ya
viajaban en `ModeloSalida`, no hizo falta tocar el contrato), con prueba anclada en el caso `null` y con
las dos pruebas del otro lado —un desarrollo normal y un migrado **siguen sin** chip ni botones—.

Cerrados en la misma ronda, además: la prueba gemela de *"un modelo ya en producción tampoco se
**rechaza**"* (la de aprobar existía; el guard es compartido, la prueba faltaba) y la **fecha del
mensaje**, que salía en UTC mientras la ficha la pinta en hora de México — un rechazo firmado después de
las 18:00 decía **dos fechas distintas para el mismo acto**.

### 🔴 Deuda con nombre — «la TERCERA puerta: crear la OP sin promover»

`POST /api/ordenes` → `crearOrden` **crea la orden de producción sin promover el modelo**, así que no
pasa por `promoverAProduccionNucleo` y por tanto **nunca toca la compuerta** (`resolverOrigenPedido`
valida `modelo.activo`, jamás `origen`). Es decir: **son tres los caminos que llegan a una OP, no dos**,
y esta etapa cubre los dos que promueven.

**Por qué NO se cerró aquí:** no tiene **ni un llamador en el frontend**, y los dos importadores de
pedido (Excel y PDF C&A) **reusan `salidaAProduccion`** ⇒ ésos sí pasan por la compuerta. Es un hueco
**sólo por API**, **pre-existente a esta etapa** (viene de F2) y que además se salta la promoción de
§Post-F9.34 entera. Cerrarlo es tocar un módulo ajeno sin revisión — se anota como deuda, no se
improvisa.

⚖️ *Se deja escrito con nombre justamente porque la frase cómoda —"las dos puertas"— es de las que
engañan a quien la lee después: quien vaya a cerrar §Post-F9.34 tiene que saber que hay una tercera.*

📌 **También anotada en `HOJA-DE-RUTA.md` §4** (CLAUDE.md §7.3: una deuda declarada va al backlog, no
sólo a la ficha de su etapa — donde nadie que no esté leyendo esta etapa la encuentra). En la primera
redacción se quedó únicamente aquí; es reincidencia de la lección de más arriba en este mismo archivo
(*"las deudas declaradas no estaban escritas en §4"*).
## V1-E7h · EL CONSECUTIVO DE DESARROLLO ARRANCA DONDE DE VERDAD VA ⭐ (25-ago-2026) — ✅ HECHA

**Defecto VIVO en `prueba`, reportado por Daniel usando el sistema:**

> *"Habíamos quedado que el consecutivo en los modelos de desarrollo iban a ser por cliente. No por tipo
> de producto. Ahorita metí 2 sudaderas y un jogger nuevos. **Las sudaderas me dieron 001 y 002 y el
> jogger 008** (ya tenía modelos que llegaban al 007)."*

### El diagnóstico, que cabe en sus números

**El contador SÍ era por cliente+año** —V1-E7a lo hizo bien—. Lo que estaba mal es **de dónde arranca**:
para un cliente+año que ya tiene modelos, la secuencia empezaba en **1**.

| | El contador dio | Código armado | ¿Libre? | Quedó |
|---|---|---|---|---|
| 1ª sudadera | **1** | `…-71-001` | sí (no había sudaderas) | **001** |
| 2ª sudadera | **2** | `…-71-002` | sí | **002** |
| jogger | **3** | `…-72-003` | **NO** (joggers hasta 007) | el bucle salta → **008** |

El bucle de reintentos "absorbía" la colisión, **pero el resultado se veía idéntico al criterio viejo**.

### 🔴 Salió de una decisión equivocada del LEAD, y queda dicho

El reviewer de V1-E7a propuso **exactamente este arreglo** —*"adelantar la secuencia al máximo consecutivo
existente de ese cliente+año"*— y **el lead eligió el otro camino** (subir el tope de reintentos), por
parecer más simple. La nota que escribió decía *"vas a ver un salto la primera vez"*, **como si fuera
cosmético**. No lo era: rompía la regla que Daniel pidió. *Una alternativa ofrecida por un reviewer y
descartada por comodidad es deuda, no simplicidad.*

### Lo construido

**El piso va DENTRO de la sentencia atómica**, no en JS:

```sql
VALUES (clave, piso::bigint + 1) …
ON CONFLICT DO UPDATE SET valor = GREATEST(valor, piso::bigint) + 1 RETURNING valor
```

- `pisoConsecutivoDesarrollo` calcula el mayor consecutivo existente para ese cliente+año.
- **Cálculo en cada alta, no siembra única** — y la razón importa: una siembra *"la primera vez que se usa
  la clave"* **no alcanzaría a los clientes que ya vienen del criterio anterior** (el de Daniel tiene la
  fila creada y en 3 mientras el catálogo va en 7), y haría falta SQL a mano cliente por cliente.
- ⭐ **Regla única: la secuencia nunca retrocede, pero sí adelanta.** Con eso **el caso de Daniel se
  corrige solo en su siguiente alta**, sin script.
- **A3 intacto:** el piso es un *parámetro de la misma sentencia* que incrementa — no hay
  leer-decidir-escribir en JS. `GREATEST` sólo puede adelantar, así que un piso viejo es inofensivo, y dos
  altas simultáneas siguen esperándose en el candado de la fila. *Lo que sería `Max()+1` disfrazado —leer
  el máximo y escribirlo con un `UPDATE`— es justo lo que no se hace, y hay un mutante que lo demuestra.*
- **Prospectivo:** los tres códigos ya emitidos **no se renumeran** (D3).

### Verificación

**10 mutaciones ancladas por línea.** La decisiva —volver al arranque en 1— mata **⭐ `el caso de Daniel:
… dan 008, 009 y 010`** más 7. La prueba existe **por duplicado**: unitaria y de integración contra
Postgres real, que además ejercita el `startsWith … insensitive` y el `GREATEST` de verdad, más
**concurrencia con piso** (5 altas simultáneas → 8..12, sin repetidos ni huecos).

El doble emula `equals`/`startsWith` obedeciendo `mode`, **revienta** ante un filtro que no sabe emular, y
**revienta** si la sentencia no trae `GREATEST(` — *esa guarda es lo que convirtió un mutante superviviente
en muerto*.

| | backend | frontend |
|---|---|---|
| tests | **165 / 1967** | sin cambios (no se tocó) |

### ⚠️ Declarado y NO hecho

- **Un mutante sobrevive la suite unitaria** (piso negativo aceptado). No es alcanzable desde el dominio
  —el piso es ≥ 0 por construcción— y lo cubre una prueba de integración, **que el CI juzga**. Se dice
  porque hasta que corra **no está verificado**.
- **El bucle de reintentos quedó casi inalcanzable.** Para que su rama no fuera código muerto que alguien
  borre con la suite en verde, sus pruebas usan una opción del doble que **ciega al piso a propósito**,
  documentada como **mentira deliberada**. *Forzar un estado que el flujo real ya no produce, y decirlo.*
- **El piso busca por prefijo de ABREVIATURA mientras la clave usa el id del cliente.** Si se renombra la
  abreviatura, los códigos viejos quedan fuera del prefijo nuevo — pero tampoco pueden chocar con él y la
  secuencia (por id) no retrocede, así que **no hay duplicados**. Consecuencia deliberada.
- **La consulta del piso es un recorrido de tabla** (`ILIKE` no usa el índice único). Medido: ~5 mil
  modelos, una vez por alta. **No se metió índice** para no arrastrar una migración a un arreglo de
  defecto; si el catálogo crece un orden de magnitud, un índice `text_pattern_ops` es la salida.
## V1-E7g · EL BUSCADOR DE PROVEEDOR, EN TODAS LAS PANTALLAS ⭐ (25-ago-2026) — ✅ HECHA

**Reportado por Daniel usando `prueba`:** *"Para seleccionar a un proveedor al dar de alta una nueva OC
independiente, el proveedor no busca por todas sus palabras. Busca sólo por orden alfabético. **Ya
habíamos acordado** que en todos lados donde busque un proveedor que lo haga de la otra manera."*

🔴 **Es la CUARTA vez que reaparece.** Ya diagnosticado en §Post-F9.52 punto 7: **el servidor busca bien**
(`idsPorNombreSinAcentos` hace `LIKE %texto%` sin acentos); el defecto es de **pantalla** — un
`SelectNativo` cuyo "buscar tecleando" es el **typeahead del navegador**, que sólo pega por prefijo. Se
arregló en el BOM (V1-E3c), en las 12 pantallas de cliente (V1-E4) y en el arte (V1-E3f), **y las tres
veces no viajó**. Ya en la tercera quedó escrito *"barrer TODOS los `SelectNativo` de proveedor"*.

### 🔴 La medición del lead era mala, y el coder hizo bien en no creérsela

El lead pasó **23 pantallas** localizadas por cercanía de texto. **Sólo 6 eran reales.** Los otros 17 eran
el `SelectNativo` **vecino**: almacenes, colores, tipos de proceso, tipos de auditoría, «con/sin factura».
Y **se le habían escapado 4 reales** en Producción/Almacenes (`DialogoAlmacen`, `CorteSemanalPagina`,
`RecibosSemanalesPagina`, `ExistenciasMaquileroPagina`). En una, la línea era falso positivo **pero el
defecto estaba 25 líneas abajo**.

⇒ **11 pantallas arregladas.** *Una medición por proximidad no es una medición: es una pista.*

### Lo construido

- **Captura → `SelectorProveedor`** (5): OC, entrada de tela, nota de salida, cortador del almacén.
- **Filtro → `FiltroProveedor`**, nuevo, **gemelo exacto de `FiltroCliente` de V1-E4** (7 pantallas). El ✕
  del combobox hace de «Todos».
- **Dos NO se cambiaron, con su razón en el código**: los proveedores **del avío** con su precio R1 (1-3
  opciones que vienen dentro del avío) y los maquileros **de esa orden**. *No hay catálogo que buscar.*
- **Backend intacto**: `git diff --name-only origin/prueba -- backend/` devuelve 0.

### Contra la quinta vez

`src/selector-proveedor-unico.test.ts` recorre los `.tsx` y **se pone roja** si un `SelectNativo` se
alimenta de una lista de proveedores/maquileros/cortadores, nombrando archivo:línea. **Verificado por
mutación en las dos direcciones.**
⚠️ **Su límite, dicho claro:** reconoce la lista por el **nombre de la variable**. Encontró las once sin
dejar ninguna, pero una llamada `terceros` se le escaparía. **Es una red, no una demostración** — y es lo
que faltó las tres veces anteriores, cuando la única defensa era una nota.

### 🔴 Dos defectos que el propio cambio abrió, y se cerraron

1. **El nombre del proveedor no viajaba con el id.** En la entrada de tela el id llega de tres lados que
   no son el combobox (edición, deep-link desde la OC, CFDI leído) y sólo uno pasaba el nombre. Como la
   búsqueda trae **10 por página**, el proveedor casi nunca caería ahí: **el campo se vería vacío y
   deshabilitado**, que se lee como *"la pantalla perdió el dato"*.
2. ⚠️ **Dos FALSOS VERDES del `tsc -b` incremental** — la cicatriz del 14-ago **con otra cara**: esta vez
   no fue un comando suelto sino **la CACHÉ**. Sólo salieron al validar en frío al final. Y el `vitest`
   completo destapó otra que el coder no vio por correr sólo el módulo tocado. **Lección: la suite
   entera, no el módulo.**

**Mejora colateral:** la bandera `factura` del proveedor (§Post-F9.22) se resolvía buscándolo dentro de
una página de 100 — con un proveedor del final del alfabeto **ya fallaba**. Ahora el combobox emite el
proveedor completo.

| | backend | frontend |
|---|---|---|
| tests | **165 / 1951** | **190 / 1607** |

### ⚠️ Declarado y NO hecho

- **`ConsultaNotasPagina` y `ExistenciasMaquileroPagina` no tienen prueba propia** — nunca la tuvieron. El
  cambio está cubierto por el typecheck y el barrido, **no por una prueba de comportamiento**. Conviene
  verlas en vivo.
- **No se partió la búsqueda en palabras**: Daniel lo cerró el 16-ago (*"como ya funciona el buscador, que
  busques una palabra está perfecto"*).
## V1-E7f · LA FECHA DE ENTREGA DE LA OC NO SE HEREDA DE NINGÚN LADO ⭐ (25-ago-2026) — ✅ HECHA

**§Post-F9.120.** Daniel, usando la explosión en `prueba`: *"No puse fecha de entrega en una OC de tela, y
tomó la fecha de entrega de la OC del cliente (la 7970)."*

**El sistema hacía lo que se le pidió, y lo que se le pidió estaba mal.** `generarOCDesdeExplosion` armaba
un `respaldoPorProveedor` con la fecha de entrega de la **orden de producción** y lo pasaba como último
recurso a `resolverFechasDeOc`. Venía de V1-E3q, cuando se hizo obligatoria la fecha: en vez de bloquear
siempre, se decidió reusar la de la orden si la traía.

⚖️ **Por qué está mal, y es de negocio:** la fecha de la orden es **cuándo se le entrega al CLIENTE**; la
de la OC es **cuándo tiene que llegar la TELA**. Igualarlas le pide al proveedor la materia prima **el
mismo día en que hay que entregar la prenda terminada**.

🔴 **Y lo grave no es que quede vacío: es que queda LLENO con un número equivocado que se ve legítimo.**

### Lo construido

- **Fuera el `respaldoPorProveedor`**, con una lápida en su lugar explicando por qué no vuelve.
- **`entregaDe` quedó MUERTO** al quitarlo (era su único consumidor) → eliminado. La fecha de la OP sigue
  viajando en `fichas` porque la pantalla la **enseña**, pero ya no alimenta ningún cálculo.
- **`resolverFechasDeOc` perdió su 4º parámetro**: no se dejó recibiendo `undefined`. ⭐ Efecto lateral
  bueno: **devolver la herencia ya no compila** sin editar a mano la firma del dominio.
- Tres descripciones del **contrato** que seguían prometiendo *"por omisión, la de la orden de
  producción"* — corregidas: viajan al OpenAPI y al cliente generado.

### 🔴 El hallazgo que no estaba en el encargo

**La PANTALLA replicaba el respaldo.** `ocSinFechaDeEntrega` hacía `return !oc.idsOrden.some(...)`, o sea
**se callaba cuando las OP traían fecha**. Con el servidor ya rechazando, eso era **el peor de los dos
mundos**: una compra que parece lista y revienta al generarla. Se quitó ese peldaño; con él murieron
`OcPlaneadaEnPantalla.idsOrden` y el filtro por `porOrden`, que existían **sólo** para el respaldo.

### Verificación

**5 mutaciones ancladas por línea.** La decisiva —devolver el respaldo entero— **mata la prueba
`la OP CON fecha de entrega NO se la presta: sin capturarla, se RECHAZA`**, que es el caso exacto de
Daniel. **Entra por la puerta real** (`generarOCDesdeExplosion`, no la función pura: el defecto vivía en
*quien llamaba*), con un doble de `Tx` que **honra los `where`** y **revienta con nombre** ante cualquier
tabla o método no implementado — nada devuelve `undefined` en silencio.

| | backend | frontend |
|---|---|---|
| tests | **165 / 1953** | **189 / 1601** |
| typecheck · lint · format | ✅ · ✅ · ✅ | ✅ · ✅ (22 warnings pre-existentes) · ✅ |

**Ripple honesto:** como ninguna compra avanza sin fecha, **23 pruebas de pantalla** capturan ahora la
fecha con un paso nuevo (`capturarEntregaInicial()`) — que es lo que el comprador hace de verdad.

### ⚠️ Declarado y NO hecho

- **Riesgo que sólo el CI puede cerrar:** se ajustaron ~78 llamadas en tres archivos de integración para
  que capturen la fecha. El repaso final destapó **8 cuerpos armados en variable** que el primer barrido
  no vio y **habrían salido rojos en CI**. Invocaciones de `generarOCDesdeExplosion` /
  `previoCompraDesdeExplosion` en pruebas de integración, **contadas** (`grep -cE` por archivo, tras la
  ronda de corrección): **92** = 74 `mrp.int` + 16 `color-de-la-tela.int` + 2 `receta-orden.int`. Las
  únicas sin fecha son las que deben rechazar. **Aun así, la palabra final es el CI.**
- **Cobertura retirada, no perdida (dos pruebas):** *"una OP sin pendiente NO aporta su fecha de
  respaldo"* y —en la ronda de corrección— *"la OC toma la fecha de entrega MÁS PRÓXIMA de sus OP"*. El
  sujeto de las dos —la fecha de respaldo— **dejó de existir**; el `>=` que la primera protegía quedó
  re-fijado por otra, y lo único reutilizable de la segunda (*"una compra para dos OP genera UNA sola
  OC"*) ya lo fija la prueba de al lado.
- **No se tocó** la captura por proveedor (§Post-F9.71(A), sigue vigente) ni el cálculo hacia atrás
  (§Post-F9.71(B)), que **depende de la Ruta Crítica** y por eso no se construye todavía.

### 🔴 Lo que encontró la REVISIÓN INDEPENDIENTE (25-ago-2026) — y quedó cerrado

El núcleo aguantó (el reviewer re-corrió las mutaciones, auditó el doble por las dos vías —honra los
`where` y el trueno es real, `El doble no implementa "proveedor.findUnique"` **dentro de `crearOC`**— y
barrió las tres puertas por las que nace una OC). Lo que **rechazó** fue esto:

- 🔴 **BLOQUEANTE — una prueba de integración seguía afirmando la herencia recién muerta.** *"La OC toma
  la fecha de entrega MÁS PRÓXIMA de sus OP"* (`mrp.int.test.ts`) esperaba `2026-09-15` (la OP B) cuando
  la compra ya nace con la fecha CAPTURADA (`2026-09-30`). **Rojo determinista en CI**, y el reviewer lo
  demostró sin Docker encadenando `resolverFechasDeOc` → `mrp.ts:2716` → `crearOC`. **Borrada.**
  ⚖️ **La lección, que vale para todo el track:** el barrido del coder fue **mecánico** — preguntó
  *"¿lleva fecha?"*, no *"¿su aserción sigue siendo cierta?"*. Meterle el dato a una prueba **la calla**;
  no la vuelve verdadera. Tras un cambio de regla hay que barrer **afirmaciones**, no llamadas.
- 🟠 **Un comentario falso vivo en `cuerpoDeCompra()`** (`ExplosionMaterialesPagina.tsx`), el primero que
  lee quien toca el cuerpo de la petición: *"…o, si tampoco hay, con la entrega más próxima de las OP"*.
  Se reescribieron cinco comentarios de ese archivo y **se saltó éste**. No cambiaba la conducta, pero
  **es el mecanismo exacto por el que el respaldo vuelve**: alguien lo lee, lo cree y deja de mandar la
  fecha. Corregido — y con él, otros dos que seguían explicando la herencia en los fixtures de
  integración (`mrp.int.test.ts:96` y el de la OP B).
- **Nits de esta ficha, medidos en vez de recordados:** 22 warnings (no 23) y el conteo de invocaciones
  **contado** (92 hoy; eran 93 antes de borrar la prueba de arriba — el "92" del reporte anterior salió
  de un parser que se comía una). Y en `HISTORIAL-DE-VERSIONES.md`, la 0.031 se había insertado entre el
  `---` y la 0.030, dejándola sin separador: restituido.

---

## V1-E7c · EL DOCUMENTO DE COTIZACIÓN ⭐ (25-ago-2026) — ✅ HECHA

**§Post-F9.109.** Había **motor de cálculo** y **no había documento**. El flujo llegaba hasta la lista de
precios y ahí se cortaba: `Proyecto → Desarrollo → Precosto → 🔑 Lista de precios → 🔴 COTIZACIÓN (no
existía) → OC del cliente → Pedido → OP`.

**La cotización es el papel que sale de la mesa, no la mesa.** Se negocia en la LISTA; de esa versión se
**EMITE** el documento, amarrado a lo que lo produjo — para poder contestar siempre *"¿qué le mandé al
cliente el 12 de marzo, y con qué receta?"*.

### Lo que Daniel dictó

- **UNA cotización con VARIOS modelos**: *"es un documento con las 5 cotizaciones"*, *"o sea una
  cotización con los 5 modelos"*. Cuelga de la **LISTA** (cliente + departamento).
- 🔴 **Si en la segunda vuelta sólo cambian 3 de los 5, la cotización nueva lleva LOS CINCO.** El cliente
  la lee sola, sin la anterior al lado; mandarle el delta lo obligaría a reconstruir el paquete de
  memoria. *Una cotización dice lo que se ofrece AHORA, completo.*
- **El correo va DESPUÉS**, etapa aparte: *si se hacen juntos y el correo falla, no se sabe si falló el
  papel o el envío.*

### Lo que decidió el LEAD (marcado para que Daniel pueda objetarlo)

1. **Inmutable.** Nace ya emitida —es la foto de un momento— y **no se edita jamás**. Otra vuelta = otra
   cotización. Se **cancela** con motivo, auditado; nunca se borra (D3). **No hay PUT ni PATCH**, a
   propósito.
2. **Cada renglón CONGELA VALORES**, no sólo referencias: código del modelo, descripción, su número, la
   versión del precosto y el precio, **copiados**. La lista sigue moviéndose después de emitir; con sólo
   punteros, reimprimir la de marzo enseñaría los precios de mayo.
3. **Folio por secuencia atómica** (A3), nunca `Max()+1`.
4. 🔴 **No se emite con un precio SIN APROBAR** — se rechaza nombrando cuáles. Mandarle al cliente un
   precio que el dueño no aprobó es el compromiso que nadie firmó, y Daniel fue explícito: *"el precio lo
   apruebo solo yo"*. **Si lo objeta, se quita el guard y caen 4 pruebas que lo dicen por su nombre.**
5. **Sin permiso nuevo:** emitir usa `listas.negociar` (quien está en la mesa), ver usa `listas.ver`.
   ⇒ **este deploy NO requiere `SEED_ON_START`**, sólo las migraciones automáticas.

### 🔴 El defecto que la mutación destapó en la propia prueba

La mutación *"que el dominio se traiga sólo 3 de los 5 renglones"* **SOBREVIVIÓ**. Causa: el doble de
`listaPreciosLinea.findMany` **ignoraba los argumentos** y devolvía siempre las 5 filas, así que la
prueba *"van los cinco modelos"* —la que sostiene la regla estrella de Daniel— **probaba la suposición
del coder, no el sistema**. Un `take: 3` colado en el dominio habría pasado en verde.

Corregido el doble para que honre `where` y `take` como Prisma; re-corrida, la mutación muere. *Cuarta
vez en el track que un doble más complaciente que el código deja viva una mutación.*

### Verificación

**13 mutaciones**, ancladas por número de línea con un arnés que **exige que la línea contenga el texto
esperado** e imprime antes/después (la trampa del ancla ya asomó siete veces en el track). Todas
murieron donde debían.

| | backend | frontend |
|---|---|---|
| tests | **163 / 1913** | **187 / 1582** |
| typecheck · lint · format | ✅ · ✅ · ✅ | ✅ · ✅ (22 warnings pre-existentes, medidas con `git stash` contra la base) · ✅ |
| `openapi` / `gen:api` | ✅ | ✅ |

**La migración, sin BD y sin Docker:** `prisma validate` limpio, y las 16 líneas DDL comparadas con
`diff` **en los dos sentidos** contra las que emite `prisma migrate diff --from-empty --to-schema`:
idénticas.

### RECHAZADA por el reviewer y corregida (25-ago)

**5 hallazgos. El primero confirmó una sospecha del lead y resultó más grande de lo que él veía.**

🔴 **H1 · El `RESTRICT` y el encabezado sin congelar eran EL MISMO defecto.** El lead los había declarado
como dos cosas distintas. El reviewer midió que no:

> El documento **no era autosuficiente** ⇒ para imprimirse tenía que preguntarle a la lista ⇒ había que
> **blindar el puntero** ⇒ y blindar el puntero es lo que dejaba el renglón atrapado.

Y era **el mismo atrapamiento que arregló V1-E4**, no uno parecido: aquél no era *"queda atrapado"* sino
**"para siempre"**, por el `@@unique([idDesarrollo])` de `ListaPreciosLinea` —**que sigue vivo**—, y aquí
**ni cancelar liberaba**. Verificó **leyendo el código** que el impreso sobrevive al null: sólo lee
columnas congeladas, y ningún archivo del frontend usa el detalle. ⇒ Encabezado congelado
(`nombreCliente`, `nombreDepartamento`, `folioLista`), FK de procedencia a **`SetNull`**, y **fuera el
helper `exigirSinCotizaciones`** que el propio coder había puesto para maquillar el `RESTRICT`. Los dos
`include` ya **no tienen ni un join**. Registrado en **§Post-F9.115** como criterio para todo documento
futuro. **Con las tablas vacías, sin backfill: el momento más barato que iba a existir.**

⭐ **Y el coder mejoró la instrucción del lead**, que le ofrecía dejar `idPrecosto` en `RESTRICT` por ser
inerte: lo pasó a `SetNull` igual, porque *"sostener la decisión en «hoy no existe el camino» es la forma
exacta de argumento que este proyecto tiene prohibida"* — y porque al soltar el `RESTRICT` vecino, el
suyo se quedaba de único titular.

🔴 **H2 · No declarado, y destructivo: el motivo de cancelación se arrastraba de un documento a otro.**
El reviewer lo **probó**: tecleas un motivo para la #7, pulsas «Volver», abres cancelar en la #8 → el
campo **sigue diciendo el motivo de la #7** *y el botón destructivo está habilitado*. Un clic **sella un
motivo equivocado en el documento equivocado, para siempre** — no hay corrección posible, porque
re-cancelar se rechaza por D3. Causa: «Volver» cierra volteando el `open` del padre, y **Radix no dispara
`onOpenChange` en cierres programáticos**. El hermano `DialogoEmitirCotizacion` sí lo hacía bien.
*Ninguna prueba unitaria lo cazaba —hay que abrir dos diálogos seguidos y mirar—, y por eso se
escapó hasta la revisión. **Ahora sí hay una** (`CotizacionesDeLista.test.tsx`): abre cancelar en la
#7, teclea, cierra con «Volver», abre la #8 y exige campo vacío + botón bloqueado.*

**H3 · Las 5 decisiones del lead no estaban en `DECISIONES.md`** — vivían sólo en esta ficha. El reviewer:
*"hoy Daniel sólo puede objetarla si lee un archivo del track de desarrollo"*, y una de ellas es el
bloqueo 🔴 que la propia ficha marcaba *"para que Daniel pueda objetarla"*. **Una decisión que el dueño no
puede encontrar no está tomada, está escondida.** Registradas en **§Post-F9.114**.

**H4/H5 · nits reales:** faltaba el `---` del historial; y la suma del diálogo imprimía **«$0.00»** en vez
de «—» para quien tiene `listas.negociar` sin `consultas.ver-importes` — *"no lo alcanza el seed de hoy"
está prohibido como excusa*.

**Observación A · el doble seguía siendo más complaciente que Prisma.** Añadirle
`precioAprobado: { not: null }` al `findMany` **sobrevivía 21/21** — con Prisma de verdad esa mutación
**tira en silencio del documento los modelos sin aprobar Y deja el guard inalcanzable**, las dos reglas
estrella de Daniel a la vez. Cerrada de raíz: el doble ahora tiene **motor genérico de `where`** (un
operador desconocido **revienta**, no devuelve `true`) y `select` que proyecta como Prisma. Ese motor
**encontró un defecto en el propio fixture** apenas se encendió, y destapó que **`aResumen` no tenía ni
una prueba unit**.

| | backend | frontend |
|---|---|---|
| tests tras la ronda | **163 / 1918** | **188 / 1587** |

**La migración va APARTE, no reescrita:** si la primera ya se aplicó en algún ambiente, reescribirla le
cambia el checksum y **`prisma migrate deploy` aborta el arranque del backend**. Validada comparando el
delta contra `prisma migrate diff --from-schema <viejo> --to-schema`: **18 sentencias idénticas**, y
comprobado que las dos encadenadas desde vacío aterrizan en el schema final.

---

### ⚠️ Declarado y NO hecho (redactado ANTES de la ronda de corrección — H1 ya está resuelto)

> ✅ **Los dos primeros de esta lista YA NO APLICAN.** Eran el `RESTRICT` que amarraba lo ya cotizado y el
> encabezado sin congelar — **el mismo defecto**, resuelto en la ronda de corrección de arriba (H1). Se
> conserva la mención porque **así es como se declararon** y ese es el relato honesto: se declararon como
> dos cosas separadas, y el reviewer midió que eran una.
- **La cancelación escribe sobre la fila** (estado + motivo + quién/cuándo). No es editar el documento
  —una prueba verifica que el `UPDATE` toca exactamente esas 5 columnas y ninguna de contenido— pero se
  dice tal cual en vez de vender «inmutable» a secas.
- **El diálogo no lleva casillas desmarcables**: como la regla es que van todos siempre, unas casillas
  invitarían justo al error que la regla evita. **Y el API tampoco acepta selección**, que es lo que de
  verdad lo impide.
- **Las 12 pruebas de integración no se corrieron** (Docker prohibido) — incluida la más fuerte del
  congelado (emitir → mover el precio en la lista → releer). La versión unit sí se corrió y sí muere al
  mutar. **Las juzga el CI.**
## V1-E7b · LA VERSIÓN DE UN MODELO NACE CON SUFIJO ⭐ (25-ago-2026) — ✅ HECHA

**§Post-F9.110, apartado (a)** — la primera de las dos piezas de esa decisión. Daniel:

> *"¿Por qué no dejamos el mismo modelo, pero le adjuntamos un nuevo número? Al final le ponemos otro
> **-01** y así sabemos que heredamos el modelo xxx pero es la nueva versión. […] De esta manera creamos
> el nuevo modelo, que tendrá la nueva receta, y **el modelo original queda igual**."*

### El problema que resuelve

La negociación con el cliente **mueve la receta en vivo** (se le quita el cierre para llegar al precio).
Editar el modelo en sitio sería el error: el modelo puede vivir en otros proyectos, se perdería el
testimonio de *cómo* se llegó, y —palabras de Daniel— *"frente al cliente se pueden cometer
imprudencias"*, que quedarían en producción antes de que nadie las revise.

⇒ **Nace un modelo nuevo con sufijo. El padre no se toca.**

### Lo construido

| Pieza | Qué hace |
|---|---|
| `Modelo.idModeloPadre` + `versionDesarrollo` | El linaje como **dato consultable**, no sólo como texto en el código. Migración aditiva, auto-relación `Restrict`. |
| `dominio/modelos/versiones.ts` | El minteo: raíz → siguiente sufijo **bajo lock** → alta + copia de receta + bitácora, todo en UNA transacción (A2/A7). |
| Permiso `modelos.aprobar-receta` | **SEPARADO de `listas.aprobar`** (ver la tensión abajo). Lo conserva Gerencial; se corta en Ventas. |
| `POST /api/modelos/:id/version` | La puerta, con el permiso nuevo. |
| Botón «Crear versión» + linaje en el detalle | Sólo se pinta si el modelo **tiene** número de desarrollo. |
| `Cliente.abreviatura` = 3 letras | §Post-F9.112, mismo territorio. |

### 🔴 La tensión que había que respetar, y por qué son DOS permisos

F8-E4 dejó decidido que **aprobar precios de lista es del DUEÑO**, y a Gerencial se le quitó
`listas.aprobar` **a propósito** (`seed.ts`, decisión (h)). Aurora es Gerencial, y Daniel dijo que ella
sí puede aprobar la **receta**.

| Aprobación | Qué compromete | Quién |
|---|---|---|
| La **RECETA** (esta etapa) | que el modelo quede técnicamente bien | Daniel **y** Aurora |
| El **PRECIO** (F8-E4) | lo que se le cobra al cliente | **sólo el dueño** |

*Si se hubieran juntado por descuido, Aurora acabaría aprobando precios sin que nadie lo hubiera
decidido.* Hay pruebas que fijan el reparto de los dos por separado.

### Las reglas, y la prueba que sostiene cada una

- **PLANO, nunca anidado.** Versionar `...-001-01` da `...-001-02`. Con anidamiento, en tres temporadas
  hay `-01-02-01` y nadie lo lee.
- ⚠️ **La raíz no puede confundir el `-001` del consecutivo con un sufijo.** `CYA-26-71-001` sin sufijo
  tiene que dar raíz `CYA-26-71-001`, no `CYA-26-71`. Un "quita el último `-NN`" a ciegas lo rompe — hay
  mutación que lo caza.
- **El lock se toma ANTES de leer la familia**, no después: elegir el hueco y escribirlo son un solo
  hecho, o dos personas versionando el mismo padre sacan las dos `-01`.
- **El padre NO se toca**: ni un `update`.
- **Comparaciones `mode: 'insensitive'`** — la cicatriz de V1-E7a: comparar con caja exacta mientras el
  alta bloquea sin distinguir mayúsculas hace que el minteo devuelva un código que el alta rechaza
  después, **abortando la transacción entera en vez de absorberse**.
- **Sin `codigoDesarrollo` se RECHAZA.** El versionado vive en el mundo de desarrollo; un migrado de
  producción no tiene de dónde colgar el sufijo. Acotado a propósito.

### El defecto que apareció al terminarla

El comentario del botón prometía *"sólo se pinta si el modelo TIENE número de desarrollo"* y **la prueba
ya lo exigía**, pero el código **nunca implementó la condición**: los ~5,000 modelos migrados enseñaban
un botón que el dominio rechaza siempre. *Una puerta pintada sobre un muro.* Corregido.

### 🔴 Y el hueco que sólo apareció mutando

La regla de las 3 letras es **prospectiva**: aprieta la ENTRADA y deja tolerante la SALIDA, para no
romper la lectura de clientes ya capturados con otra longitud. **Pero nada lo vigilaba.** Al apretar el
esquema de salida a propósito, las 26 pruebas de cliente **seguían verdes**.

Y el daño no habría sido un renglón: el listado valida la respuesta **como un todo**, así que el
**primer** cliente viejo de 2 letras **tumba el catálogo entero**. Ahora hay una prueba que lo sostiene.

### Verificación

**18 mutaciones**, ancladas por número de línea (la trampa del ancla ya pegó cinco veces en el track);
en todas murió la prueba esperada. Y **dos resultados falsos cazados por el propio coder y rehechos**:
un `git checkout` del arnés revirtió un `export` sin comitear (las pruebas murieron por la razón
equivocada), y un `\d` que llegó literal a través del shell hizo que **la mutación no hiciera lo que él
creía**. *Los declara en vez de callarlos, que es lo que esta casa pide.*

| | backend | frontend |
|---|---|---|
| tests | 163 / 1918 | 187 / 1593 |
| typecheck · lint · format | ✅ · ✅ · ✅ | ✅ · ✅ (22 warnings pre-existentes) · ✅ |
| `openapi` / `gen:api` | ✅ sin deriva | ✅ sin deriva |

**La migración, sin BD y sin Docker:** `prisma validate` limpio, y comprobada contra el SQL canónico que
emite `prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script` — **idéntico** al
escrito a mano (mismas columnas, mismo índice, mismo `ON DELETE RESTRICT`). El `--from-migrations`, que
es el que detectaría deriva de verdad, exige shadow DB: **lo juzga el CI**.

> 🔴 **Aquí decía `--to-schema-datamodel`, que en este Prisma NO EXISTE**: la orden aborta con
> ``` `--to-schema-datamodel` was removed. Please use `--[from/to]-schema` instead ```. La sustancia
> aguantó —el SQL sale idéntico con el flag bueno, rehecho y visto— pero **la frase no se podía
> repetir**: quien la copiara obtenía un error, no una confirmación. Es la sexta vez en este track
> que una afirmación de rendición de cuentas nombra mal el comando que la respalda. La regla que
> deja: **el comando se pega desde la terminal donde corrió**, nunca de memoria.

### 🔴 RECHAZADA por el reviewer y corregida (25-ago) — dos frases que mentían y una regresión que sólo vio el CI

Tres hallazgos, y el tercero es el que enseña algo.

**H1 · El diálogo prometía el código ANIDADO que esta etapa existe para impedir.** El ejemplo de la
confirmación se armaba pegando `-01` **al código del padre**. Con un padre RAÍZ acertaba por casualidad;
con un padre que YA era versión escribía `CYA-26-71-001-01-01` — la forma que Daniel descartó
(*"en tres temporadas hay -01-02-01 y nadie lo lee"*), **exhibida como promesa a quien está a punto de
aprobar la receta**. El servidor siempre creó bien el `-02`: el que mentía era el texto. No corrompe
datos, y por eso es fácil archivarlo como cosmético; no lo es, porque es la superficie donde se rinde
cuentas del acto.

⚠️ **Y pasaba en VERDE**: la prueba que existía usaba un padre raíz, el único caso en que la cuenta
sale bien. La nueva usa un padre `-01`.

Se quitó el ejemplo en vez de calcularlo mejor, por dos razones independientes: **(1)** el cliente no
puede saber el número —el sufijo es `max(la familia) + 1` leído bajo lock, y una familia con `-01` y
`-02` recibe `-03`—, así que calcularlo sólo movería la mentira a *"falla a veces"*, que es cuando se le
cree; **(2)** derivar la raíz en el cliente obligaría a **copiar** `raizDeCodigoDesarrollo` al frontend,
lógica de negocio fuera de `backend/src/dominio` (A1). Backend y frontend sólo comparten el OpenAPI
(ADR-0002): *"la misma función"* no está disponible, sólo la copia prohibida.

**H2 · La frase del comando de Prisma nombraba un flag que no existe** (`--to-schema-datamodel`). Ver el
recuadro de arriba.

**H3 · 🔴 REGRESIÓN DEL CI — y es la que deja lección.** El e2e de pedidos fabricaba la abreviatura del
cliente como `E` + 5 caracteres en base 36 (`E4K7M2`): 6 caracteres **con dígitos**, válidos con la regla
vieja (2–6, `[A-Z0-9]`) y **rechazados** por la nueva de 3 letras. El alta del cliente dejó de pasar, el
aviso «Cliente … creado.» nunca apareció y **se cayó el flujo entero detrás**.

⚠️ **Las 3 letras se habían validado en el modelo, en el contrato y en la pantalla — pero nadie recorrió
el flujo completo.** Sólo el CI lo hace, y por eso lo encontró él, no las unitarias ni dos revisores.
**La regla que deja: cuando una regla cambia algo que se captura en muchos lados, revisar dónde se
DEFINE no basta — hay que barrer dónde se USA.** El barrido se hizo después y confirmó que era el único
sitio (ni el ETL ni el seed fabrican abreviaturas).

⚠️ **El margen encogió, y queda dicho en vez de callado.** La abreviatura sigue saliendo del reloj
porque `abreviatura` es `@unique` y un choque no da un nombre feo, da un **409**. Pero de ~17 h (base 36,
5 caracteres) se pasa a **~17.6 s** (26³ = 17,576 valores a resolución de milisegundo). Basta por tres
motivos concretos: la BD de CI nace vacía (`down -v`), el spec crea **un solo** cliente, y el **seed no
siembra ninguna abreviatura**. 🔴 Deja de bastar si algún spec crea VARIOS clientes o si dos specs con
cliente propio corren en paralelo contra la misma base.

*Nota: `versiones.ts:70` y `nomenclatura.ts:131` siguen aceptando `{2,6}` **a propósito** — son parsers
de LECTURA, tolerantes por el mismo diseño prospectivo que deja la salida sin patrón. No se aprietan.*

**N1 · Y en el arreglo de H3 venía otra prueba que no probaba nada.** El colector que valida el
generador contra el contrato leía `properties.abreviatura.pattern` como propiedad **directa**, pero los
dos esquemas de escritura no tienen la misma forma: el alta declara el campo plano y **la edición lo
envuelve en `anyOf`** (por el `.nullable()` que permite VACIAR el dato, M1). El de edición no se recogía
nunca, así que *"alta y edición declaran la misma regla"* comparaba un conjunto de UN elemento consigo
mismo — **una tautología**. El reviewer lo probó dejando el contrato con `{3}` en el alta y `{4}` en la
edición: **todo siguió verde**. Ahora el colector baja por `anyOf`/`oneOf`/`allOf` y esa misma
divergencia lo pone rojo.

Al medirlo aparecieron **7** apariciones del campo, no 2: **2 de escritura** (alta y edición) que traen
el patrón y **5 de lectura** (listado, alta-201, detalle, edición-200 y baja) que **no traen ninguno**.
Por eso el colector separa por lado —metidas en un saco, esas 5 ausencias parecerían una divergencia— y
de paso queda sujeta en el CONTRATO la garantía prospectiva (§Post-F9.112) que ya estaba sujeta en el
Zod: **si la regla se colara a las respuestas, el primer cliente viejo con otra longitud tumbaría el
catálogo entero al listarse**.

### ⚠️ Declarado y NO hecho

- **La ruta HTTP no tiene prueba de nivel API.** El dominio debajo sí (unit + int, permiso incluido) y el
  `preHandler` es redundante con el `verificarPermiso` del dominio, así que el riesgo residual es bajo —
  pero **el hueco existe** y se dice. No se escribió una prueba que no se puede correr aquí: sería
  exactamente *"una afirmación sin prueba que se ponga roja"*.
- 🔴 **Consecuencia real de las 3 letras:** un cliente ya capturado con `LI` o `MARILY` **no se podrá
  guardar** —ni para cambiarle el teléfono— sin corregir antes la abreviatura. Es coherente con lo que
  pidió Daniel y el error nombra la regla, pero **es un bloqueo**. Deberían ser poquísimos (el campo
  nació en V1-E3n); **no se pudo medir sin BD**.
- **La versión nace SUELTA**, y no es un descuido: `Desarrollo` es `(idProyecto, idModelo)` y la versión
  nace **sin fila de `Desarrollo`**. La lista de precios **sigue apuntando al padre** y no se entera. Las
  dos preguntas las dejó §Post-F9.110 *"por confirmar al construir"* y **siguen abiertas**: van con la
  pieza 2.
- **Falta la pieza 2 de §Post-F9.110: la REVISIÓN** antes de mandar a producir. Esta etapa entrega el
  mecanismo de versionar; el paso de que alguien revise y apruebe formalmente es lo siguiente.

**SIN permisos que rompan nada, pero CON permiso nuevo** (`modelos.aprobar-receta`) ⇒ 🔴 **el deploy a
`prueba` requiere `SEED_ON_START=true`**, o el botón no aparece para nadie.

---

## V1-E7a · EL CONSECUTIVO DE DESARROLLO CORRE POR CLIENTE + AÑO ⭐ (25-ago-2026) — ✅ HECHA

**§Post-F9.108, bloque «✅ RESUELTO».** Daniel: *"Me gusta solo por cliente por año. O sea **71-001 y el
siguiente 72-002**."*

> ⚠️ *La primera redacción de esta ficha citaba **§Post-F9.110**, que es otra decisión por completo (*"la
> negociación edita la receta en vivo"*). Error del lead, cazado por el reviewer. Se corrige aquí y se
> deja dicho: el código citaba bien en sus cuatro lugares, el número malo estaba sólo en la ficha.*

🔴 **SUSTITUYE lo decidido en §Post-F9.34 y §Post-F9.46** sobre el alcance del contador. Se declara como
**cambio de criterio, no como corrección**: aquella se tomó con el documento «Estructura de modelos FR
Moda» de 2014 enfrente y **sigue legible**.

| | Antes | Ahora |
|---|---|---|
| Alcance del contador | cliente + año + **concepto + género** | **cliente + año** |
| 1er jogger de dama de ese cliente/año | `CYA-26-72-`**`001`** | `CYA-26-72-`**`002`** |

Los dos dígitos de concepto+género **siguen en el código** (describen la prenda) pero **ya no gobiernan
la serie**.

### El cambio de fondo es UNA LÍNEA — y lo que lo hace seguro ya existía

Fuera el `parTexto(...)` de la clave de la secuencia. Al hacerlo, el contador **arranca en 1** para un
cliente+año que **ya tiene modelos** del criterio viejo ⇒ **podría generar un duplicado**.

**Pero el bucle del minteo ya lo prevenía**: pide número, arma el código, y **si está ocupado vuelve a
pedir otro**. ⇒ **Se absorbe solo: sin migración y sin renumerar.** *Se verificó ANTES de tocar nada —
era la pieza que decidía si esto era una línea o una etapa con migración.*

⚠️ **"Se absorbe solo" tiene un límite, y hay que decirlo con el límite puesto: se absorbe mientras los
códigos ocupados quepan en el tope de reintentos** (hoy **1000**, la serie entera de un cliente+año).
Con el tope original de **50** no era cierto sin condición: el bucle avanza de uno en uno y el código
lleva el par, así que sólo choca contra los del MISMO par — un cliente+año con `71-001..010` y
`91-001..070` deja la secuencia en 11 y el alta del par 91 quema los 50 intentos sin llegar al 71.
**Y agotarlos es IRRECUPERABLE:** el minteo corre dentro de la transacción del llamador, así que al
lanzar **la secuencia se revierte con ella** — reintentar arranca del mismo número y falla igual, y ese
cliente+año se queda sin poder dar de alta desarrollos hasta que alguien adelante el contador con SQL a
mano (no hay `sembrarSecuenciaGlobal`, ni pantalla, y `reparar-secuencias.ts` no toca
`secuencias_globales`). Hoy **no era alcanzable** —el criterio viejo lleva dos días y sólo en `prueba`—,
pero la afirmación sin condición era inexacta. **Subido a 1000**, que es el techo natural del diseño de 3
dígitos: la pared queda **inalcanzable por construcción, no por suerte**. Hallazgo del reviewer.

### 🔴 Y ahí apareció un defecto que SÓLO importa por este cambio

Ese centinela comparaba con **caja EXACTA**, mientras que `crearModelo` bloquea duplicados
**case-insensitive**.

Con el criterio viejo casi nunca se tocaba. **Ahora es la pieza que sostiene la etapa**, y un
`cya-26-71-001` heredado habría hecho que el minteo devolviera un código **que el alta rechaza
después** ⇒ **abortando la transacción entera en vez de absorberse**. Corregido a `mode: 'insensitive'`,
como ya lo hacía `promoverAProduccionNucleo`.

*Un cambio de una línea convirtió una comprobación decorativa en la viga que aguanta el techo — y la
viga estaba mal calibrada. Eso no se ve leyendo el diff: se ve preguntándose **qué pasa a ser
importante**.*

### ⚠️ La trampa del ancla casi pega otra vez — y el coder la cazó SOLO

En la primera vuelta **la mutación de la caja SOBREVIVIÓ**: su `findFirst` falso **ignoraba el flag
`mode`**, así que la prueba **comprobaba el fake, no el código**. Corrigió el fake para **obedecer**
`mode` y sólo entonces murió la prueba correcta. **Lo anotó dentro del test** para que nadie lo
"simplifique".

*Cuarta aparición de esta familia de trampa en el track —la anterior le pegó al lead—. Que el coder la
cazara en su propio trabajo, sin que nadie se lo señalara, es el estándar.*

### 🔴 RECHAZADA por el reviewer y corregida (25-ago) — la prueba que no probaba nada

**El reviewer borró la rama `codigoDesarrollo` del centinela y la suite quedó 21/21 VERDE.** Nada la
sostenía, por dos motivos que eran del coder:

- el `findFirst` falso leía `args.where.OR[0].codigo` ⇒ **colapsaba las dos ramas del `OR` en una** y la
  segunda ni la miraba;
- en integración, el helper que siembra modelos escribía **el mismo valor en las dos columnas**, así que
  quitar cualquiera de las dos seguía encontrando el choque.

⚠️ **Y el escenario desprotegido era el MÁS probable de los códigos viejos:** un modelo del criterio
anterior **ya promovido**. Ahí `codigo` es el de 5 dígitos (`71001`) y el `CYA-26-71-001` vive **sólo**
en `codigoDesarrollo` (D3). Sin esa rama el minteo entrega un duplicado ⇒ P2002 contra el `@unique` ⇒
**aborta la transacción entera del alta**: exactamente lo que la etapa promete evitar.

*Es la QUINTA aparición de esta familia de trampa en el track, y la segunda dentro de esta misma etapa:
la primera la cazó el coder solo (el `mode` ignorado), ésta se le escapó. El patrón es siempre el mismo
—**el doble que se le pone al código para probarlo se parece de más a lo que se quiere demostrar**— y no
se caza leyendo: se caza **borrando la línea y viendo si alguien grita**.*

### Verificación

| Mutación | Rojas | Cuál murió |
|---|---|---|
| volver a meter el par en la clave | **5** | los pares correlativos + la clave de la secuencia |
| quitar el centinela anti-colisión | **3** | las dos de choque + la de intentos agotados |
| centinela con caja exacta | **1** | la del choque por CAJA |
| mensaje de error viejo (*"serie 71"*) | **1** | la de intentos agotados |
| **borrar la rama `codigoDesarrollo`** | **1** | la del **modelo ya promovido** *(antes: ninguna)* |
| **borrar la rama `codigo`** | **1** | la del código capturado a mano |
| **tope de reintentos de vuelta a 50** | **1** | la del tope que cubre la serie entera |
| **mensaje sin la parte accionable** | **1** | la de intentos agotados |

**Las pruebas viejas que daban por hecho el criterio anterior se ACTUALIZARON, no se borraron**, con el
comentario invertido. Más **3 de integración nuevas**: que un cliente+año con códigos viejos **se salta
los ocupados sin renumerar**; que **se salta el de un modelo YA PROMOVIDO**, que sólo vive en
`codigoDesarrollo`; y que **5 altas SIMULTÁNEAS de pares distintos** sacan consecutivos correlativos —
**interacción nueva**, porque ahora los pares **comparten fila de secuencia** (A3).

**Backend 161/1886 · frontend 185/1568 · contrato sin cambios.** **SIN migración**: lo de
`schema.prisma` es sólo documentación.

### Declarado y NO hecho

**Sin tope de 999** al consecutivo de desarrollo — no lo había antes, `armarCodigoDesarrollo` **degrada
a 4 dígitos** (con prueba), y Daniel cerró justo ese punto. Avisar al acercarse al tope sería etapa
aparte. *(No confundir con el **tope de reintentos** del minteo, que sí se subió a 1000 en esta etapa:
uno limita cuántos códigos caben, el otro cuántas veces se pide otro número cuando el que tocaba está
ocupado.)*

**Sin manera de destrabar la secuencia global desde el sistema.** Si alguna vez se agotaran los
reintentos, la única salida sigue siendo SQL a mano: no existe `sembrarSecuenciaGlobal`, no hay pantalla
y `reparar-secuencias.ts` sólo toca `secuencias` (por empresa), no `secuencias_globales`. Con el tope en
1000 la situación es **inalcanzable por construcción**, así que construir el destrabador hoy sería
resolver un problema que no puede ocurrir — **queda dicho, no callado**, por si algún día el formato del
código cambia.

---

## V1-E6d · CABECERAS DE SEGURIDAD EN NGINX 🔴 (25-ago-2026) — ✅ HECHA

**El último bloqueante del arranque que dependía del equipo.** Cinco cabeceras + `server_tokens off`.
Las cuatro fijas completas; **el CSP en modo REPORTE**, como decidió Daniel: *"vigila y avisa, pero no
bloquea"* el jueves.

### ⭐ El TLS NO termina en nginx — y eso decide cómo se pone el HSTS

Lo termina **el edge de Railway**, que entrega la petición **en claro** por la red interna. Dentro del
contenedor **`$scheme` vale siempre `http`** y no sirve para decidir. Lo que sí llega es
`X-Forwarded-Proto`.

⇒ El HSTS sale de un **`map`**: se emite **sólo si la petición original fue HTTPS**, y el
**healthcheck interno de Railway** —que pega por HTTP— no lo dispara. **Sin `preload`** a propósito: es
prácticamente irreversible y hoy el dominio es de Railway.

*Poner `$scheme` a ciegas habría sido lo natural y lo equivocado.*

### 🔴 La trampa de la herencia NO era teórica, y era grave

`add_header` **no se hereda** a una `location` que declara el suyo. Y `location = /index.html` **ya
tenía** su `Cache-Control`.

No es un bloque cualquiera: el **`try_files … /index.html` de la SPA** hace una **redirección interna
que vuelve a elegir location**, así que **casi todo documento HTML que ve el usuario sale por ahí**
—cualquier ruta profunda y también `/`—.

⇒ **Limitarse al bloque `server` habría dejado la página principal de CONTROL SIN NINGUNA cabecera, y
todo lo demás sería adorno.** Por eso el juego va **repetido entero** ahí, y queda escrito en el
archivo que **quien le añada un `add_header` tiene que copiarlas todas**.

`location /api/` **no** declara `add_header` propio ⇒ **hereda las cinco**, así que JSON, PDFs y Excel
salen protegidos.

**Todas con `always`:** sin eso nginx sólo las agrega a 200/204/301/302/304, y **un 401, 404 o 500
saldría desnudo** — justo cuando el navegador ve contenido inesperado.

### El CSP se escribió CONTRA EL BUNDLE COMPILADO, no de memoria

Se corrió `npm run build` y se auditó el `dist`. De ahí salió cada decisión:

| Directiva | Por qué (medido) |
|---|---|
| `script-src 'self' 'sha256-…'` | el hash del **único** script en línea (el que aplica el tema oscuro antes de pintar). **Sin `'unsafe-eval'`**: cero `eval(`, cero `new Function(`, cero WebAssembly en el bundle |
| `style-src 'self' 'unsafe-inline'` | **obligado, no pereza**: radix-ui y sonner **inyectan `<style>` en caliente** (3 `createElement('style')`). Sin esto se rompe el bloqueo de scroll de **todos** los diálogos. *(Los `style={{…}}` de React NO lo necesitan: van por CSSOM, que el CSP no gobierna.)* |
| `img-src` y `connect-src` con **R2** | **no es opcional**: el navegador **sube archivos con `fetch` PUT directo al bucket** y el visor descarga por URL prefirmada. Sin esto, el día que bloquee **se caen todas las subidas y descargas de foto** |
| `font-src 'self'` | hoy **0 `url(`** en el CSS compilado (las fuentes son del sistema). `'self'` y no `'none'` para no romper el día que se empaquete una |
| `object-src`/`frame-src`/`worker-src` `'none'` | no hay `<object>`, **ni un solo `<iframe>`**, ni Workers |

**`Referrer-Policy: same-origin`**, y el porqué importa: las URLs de CONTROL **llevan el dato del
negocio a la vista** (`/ordenes/1234`). Con el default de los navegadores, cualquier destino externo se
entera **al menos del host de la empresa**.

### La verificación, SIN poder levantar nginx

*El encargo pedía explícitamente **cómo** se iba a demostrar, no que se afirmara.*

1. **Con el parser OFICIAL de NGINX Inc.** Se instaló **`crossplane`** y se parseó la plantilla
   **renderizada como lo hace el entrypoint**, en los **dos escenarios** (compose y Railway), dentro de
   un `http {}` equivalente al de la imagen oficial. ⭐ **Con control negativo** — pero **con una precisión que el reviewer exigió**: el arnés de los dos
   escenarios corre con `strict=False` y **NO caza** una directiva inventada; el control negativo vivió
   en un **tercer render con `strict=True`** y **sin el bloque `map`**, porque el cuerpo del `map` hace
   fallar el modo estricto (limitación conocida de `crossplane`, no error de la config). *La sustancia
   se sostiene* —el reviewer corrió `strict=True` sobre la plantilla real completa y los únicos errores
   son esos dos del `map`— pero **la frase original afirmaba más de lo demostrado**.
2. **Un candado de 10 pruebas** que **recalcula el SHA-256** del script en línea y lo compara con el del
   CSP, exige que **todo bloque con `add_header` traiga el juego completo** (la regla general, no los
   dos de hoy), que todas lleven `always`, que los dos CSP sean **idénticos carácter por carácter**, y
   que siga en modo reporte. **Mutilado seis veces** por el coder → rojo las seis.
   ⭐ **Re-mutado por el lead — y el lead cayó en la trampa que llevaba toda la noche advirtiendo.** Buscó el bloque con `indexOf('location = /index.html')`, que **engancha el comentario de la línea 79**, no el bloque de la 214: acabó mutando el **`server`** y reportó *"2 rojas"* como si fueran del bloque de `index.html`. **Medido bien por el reviewer:** quitar una cabecera del bloque de `index.html` da **1 roja**; del `server`, **2**. *La trampa del ancla no distingue rangos.*

### La regresión que el coder causó y arregló

Su comentario nuevo menciona el literal `location /api/`, y una prueba **que ya existía** lo buscaba con
`indexOf` **sin filtrar comentarios** → enganchaba el comentario en vez del bloque real: **3 pruebas en
rojo** con un mensaje que apuntaba al lugar equivocado. **Endureció la prueba** en vez de sólo reescribir
su comentario, *para que la mina no le explote al siguiente*.

### 🔴 Lo que NO queda verificado

- **Que nginx arranque con esta config y que las cabeceras lleguen al navegador.** Sólo lo demuestra el
  servicio corriendo. `crossplane` valida gramática y contexto, **no ejecuta nginx**.
- **Que `X-Forwarded-Proto: https` llegue del edge de Railway** (⇒ que el HSTS se emita). Es el
  comportamiento documentado; el `curl` al deploy lo bloquea el proxy de salida de la sesión.
- **Los impresos**: PDF y Excel se abren en pestaña servida por `/api`, y el visor de PDF de Chrome se
  apoya en un documento de plugin — hay antecedentes de `object-src 'none'` estorbándole. **En modo
  reporte no puede romper nada**, y es la razón nº 1 para no activar el bloqueo sin probarlo en Chrome,
  Edge y Firefox.

🔴 **Dos huecos que el checklist de tres `curl` NO cubre (los añadió el reviewer):**

- **`nosniff` y el MIME del bundle.** Con `nosniff`, un `<script type="module">` servido con un
  Content-Type que no sea de JavaScript **se rechaza → pantalla en blanco**, sin más pista que la
  consola. Probabilidad casi nula (la imagen oficial trae `mime.types` y la plantilla no toca `types`),
  pero **es la única manera realista de que estas cabeceras tumben la app**:
  `curl -sSI …/assets/index-<hash>.js | grep -i content-type` → debe decir `application/javascript`,
  **nunca** `octet-stream`.
- **El `map` es de coincidencia EXACTA.** Sólo casa `https` literal; si el edge mandara `https, https`
  (proxy encadenado), el valor queda vacío y **el HSTS no se emite nunca, sin que nada lo diga** — una
  protección que se cree puesta y no lo está. ⇒ En el `curl` a la raíz, **`Strict-Transport-Security`
  DEBE aparecer**; si no aparece, ésa es la causa.

**Se cierra en 10 segundos tras el deploy** con tres `curl -sSI` (la raíz, una ruta profunda —que sale
por `location = /index.html`— y `/api/health`).

### 🟡 Hallazgo colateral, declarado y NO tocado

**`proxy_set_header X-Forwarded-Proto $scheme`** le manda al backend **`http`**, no el protocolo
original. Si algún día el backend decide algo por esa cabecera (cookies `secure`, redirects), **estaría
decidiendo con un dato falso**. Lo correcto sería `$http_x_forwarded_proto`. **Hoy no rompe nada**
porque better-auth se guía por `BETTER_AUTH_URL`. *No se toca en semana de arranque.*

### ⚠️ Y una limitación del "modo reporte" que hay que decir

**Los avisos del CSP salen sólo en la consola del navegador (F12).** No hay `report-uri` ⇒ **nadie los
ve desde el servidor**. Para dos usuarios el jueves alcanza con mirar la consola, pero *"vigila y avisa"*
hoy avisa **sólo a quien tenga las herramientas de desarrollo abiertas**. Recoger los reportes de verdad
pide un endpoint propio — **post-arranque**.

---

## V1-E6c · QUE EL SISTEMA NO SE PUEDA QUEDAR SIN ADMINISTRADOR 🔴 (25-ago-2026) — ✅ HECHA

**Bloqueante del arranque.** Con **dos usuarios** (Daniel + Aurora) y **Daniel como único admin**,
cerrarse la puerta era **un clic**.

### Lo que el lead midió, y lo que el coder encontró encima

✅ **Ya existía media defensa**: no puedes **desactivarte a ti mismo** (``desactivarUsuario`, la guarda de "no puedes desactivarte a ti mismo"`).

🔴 **El hueco medido:** `actualizarUsuario` **calcula** `cambiaRoles` y **no lo usa para ninguna guarda**;
`asignarRoles` es un atajo sobre él y hereda el hueco. Y desactivar a **OTRO** que resulta ser el último
admin **sí se podía**: la guarda era sólo *sobre uno mismo*.

⭐⭐ **Y el coder encontró DOS PUERTAS MÁS al mismo precipicio:**

1. **BLOQUEAR** al último admin. `cargarPermisosDeUsuario` devuelve set **vacío** para un usuario
   bloqueado, así que `{ bloqueado: true }` lo apaga igual que desactivarlo. **Tercera cara del mismo
   defecto.**
2. 🔴🔴 **`roles.ts` YA tenía un guard anti-lockout… pero sólo para `roles.administrar`.** Un rol que
   otorgara **únicamente** `usuarios.administrar` se podía vaciar —o borrar— desde la pantalla de Roles,
   y **el guard nuevo se sorteaba en dos clics**. Además contaba sólo `activo`, **sin `bloqueado`**: un
   admin trabado "rescataba" a un sistema que ya estaba sin nadie.

*Un guard que existe pero cubre una sola de las llaves da una falsa sensación de puerta cerrada.*

### ⭐ El write-skew CRUZA los dos módulos — por eso el lock es uno solo

Transacción 1 le quita el rol a Daniel (mira `UsuarioRol`, ve que Aurora tiene el permiso). Transacción
2 le quita el permiso al rol de Aurora (mira `RolPermiso`, ve que Daniel lo tiene). **Ninguna ve el
cambio no comiteado de la otra** → las dos commitean → **cero administradores**.

⇒ Lock y conteo extraídos a **`guard-administradores.ts`** con **UNA sola clave**
(`0x524f4c45535f41n`, la que `roles.ts` ya usaba), **compartida por las cinco puertas**. Se toma
**condicionalmente**, decidido con la entrada sola, para no serializar las ediciones de nombre o correo.

### 🔴🔴 La QUINTA puerta, y la única que no la abre un administrador — hallazgo del reviewer

El reviewer **rechazó** la primera versión por una puerta que ninguna de las cuatro cubría:
`registrarIntentoFallido` (`dominio/auth/login.ts`, `MAX_INTENTOS = 5`) **escribe la MISMA columna
`bloqueado`** que el guard protege, **sin guard, sin lock y sin conteo**.

**Y es la que más fácil pasa en la vida real, porque no la dispara nadie con permisos:** es *el propio
dueño tecleando mal su contraseña cinco veces*. El escenario del arranque, exacto: Daniel es el único
admin → se bloquea solo → `cargarPermisosDeUsuario` le devuelve set **vacío** → Aurora es Gerencial y
**no puede desbloquearlo** (`desbloquearUsuario` exige `usuarios.administrar`) → y **re-correr el seed
tampoco rescata**, porque `sembrarAdmin` hace `upsert` con `update: {}` y no toca `bloqueado`. **Sistema
cerrado por dentro**, recuperable sólo entrando a la base de datos a mano.

**Cómo quedó:** si bloquear esa cuenta dejaría al sistema sin ningún administrador vivo, **los intentos
suben pero la cuenta NO se bloquea**, y queda constancia en bitácora (`bloqueo-omitido-ultimo-
administrador`) de que no se bloqueó y por qué. El lock se toma **sólo cuando el intento va a
transicionar** (los cuatro primeros fallos no serializan nada) y **se re-lee bajo el lock**: decidir con
la lectura rápida sería justo el write-skew que el lock cierra.

⚠️ **La contrapartida de seguridad, dicha en voz alta (decisión de diseño — conviene que Daniel la
ratifique):** al último administrador vivo **no se le bloquea la cuenta por intentos fallidos**. No queda
indefenso —la contraseña sigue haciendo falta y el **rate-limit de login** (`AUTH_LOGIN_RATE_MAX`) sigue
puesto, que es la defensa real contra fuerza bruta; el bloqueo por intentos nunca lo fue, porque
**cualquiera que sepa un username puede dispararlo contra su dueño**—. La alternativa es un ERP capaz de
auto-inutilizarse con cinco tecleos mal dados.

### 🔴 Y esa quinta puerta **rompía una prueba de integración** — cazado al verificar

`src/api/auth.int.test.ts` siembra la base en cada `beforeEach` y hace fallar el login de **`admin`**
cinco veces esperando `bloqueado === true`. Pero el `admin` sembrado es **el único administrador** de esa
base → con el guard nuevo **ya no se bloquea**, y la prueba habría puesto el CI en **rojo** (es la misma
familia del mutante M8 que sobrevivió la primera vuelta: *el guard que dispara de más sólo se nota
cuando no queda ningún admin*). Se corrigió y de paso **ganó cobertura**: el bloqueo se prueba ahora con
un usuario de **Ventas** (sin claves de gobierno), y se añadieron dos pruebas de punta a punta — *al
único administrador cinco fallos NO le bloquean la cuenta* (y con la contraseña buena **entra**) y *con
DOS administradores sí se bloquea*. Las otras dos int-tests que bloquean cuentas
(`rate-limit-login.int.test.ts`, `dominio/auth/login.int.test.ts`) **no se ven afectadas**: crean
usuarios **sin roles**.

### El seed también podía desarmar el guard, y ahora no

`sembrarRoles` **sincroniza** los roles de sistema borrando lo que sobre. Si Daniel le da
`usuarios.administrar` al rol **Gerencial** desde la pantalla de Roles —para que Aurora administre— y
luego se quita el suyo (**el guard lo permite, y hace bien: Aurora cuenta**), el siguiente deploy con
`SEED_ON_START=true` **se la arrancaría a Gerencial** → **cero administradores**. Y sería el peor caso:
no hay transacción de aplicación de por medio, así que **el advisory lock ni se entera**.

⇒ El seed **sigue OTORGANDO** lo que dice la definición, pero **NUNCA REVOCA una clave de gobierno**. Y
al terminar, `avisarSiNoQuedanAdministradores` **grita en los logs de arranque de Railway** si no queda
nadie activo y no bloqueado con cada clave — no arregla, pero es donde alguien lo va a ver a tiempo.

⚠️ **Sin cobertura automática:** el seed sólo se ejercita en pruebas de **integración**, que no corren
fuera del CI; su mutación no se pudo medir en esta sesión.

### La verificación: dos mutantes se le cayeron al coder y los reportó

| Mutante | Rojo |
|---|---|
| guard borrado entero | 10 |
| guard sólo "sobre uno mismo" | (b), (c), bloquear, (d), (e) — **(a) sigue verde, como debe** |
| el conteo ignora `bloqueado` / ignora `activo` | *"un administrador INACTIVO o BLOQUEADO no rescata"* |
| el conteo no excluye al que pierde el permiso | 10 |
| el lock **después** de contar | *"el conteo va BAJO el lock"* |
| **protege sólo `usuarios.administrar`** | *"protege CADA capacidad por separado"* — **remutado y verificado por el lead**: 1 roja de 15 |
| el guard dispara **siempre** | *"en un sistema que YA no tiene administradores, no bloquea a nadie más"* |

🔴 **M8 SOBREVIVIÓ la primera vuelta y el coder lo dijo.** Un guard que dispara **de más** sólo se nota
cuando *no queda ningún* admin, y no había ese caso. **Y no era cosmético: habría roto el CI**, porque
las pruebas de integración existentes corren en un sistema sin administradores (la sesión de pruebas no
es un usuario real de la BD).

🔴 **Y su propio mock mentía.** M3a/M3b morían **por la prueba equivocada** porque el `tx` falso trataba
una clave **ausente** del `where` como `=== undefined` en vez de *"no filtrar"*, que es lo que hace
Prisma. **El fake hacía parecer el guard más estricto de lo que era.** Lo corrigió y entonces murieron
por la prueba correcta.

*Es la deuda declarada de esta casa —"una prueba que mockea tu suposición prueba tu suposición"—
cazándose a sí misma. Que el coder lo mirara en vez de apuntar «mutante muerto» es lo que la hizo real.*

### Mutación de la quinta puerta y del remate del reviewer (24 pruebas en el archivo del guard)

| Mutante | Rojas | Cuáles |
|---|---|---|
| `bloqueado = usuario.bloqueado \|\| transiciona` (guard de la quinta puerta **borrado**) | **3** | *al ÚNICO administrador…* · *sigue sin bloquearse…* · *deja constancia en bitácora…* |
| `bloquearGuardAdministradores(tx)` **borrado** del login | **1** | *el conteo va BAJO el lock, y los intentos que NO transicionan no lo piden* |
| `claveQueQuedariaHuerfana` sin el `if (!usuario.activo) return null` | **1** | *un administrador ya INACTIVO no se salva del bloqueo* |
| el conteo **no excluye** al que se va a bloquear | **3** | las mismas tres de la primera fila |
| 🔴 **`const eraAdmin = tenia;`** (la mitad de ESTADO, el mutante que **sobrevivía** las 15) | **2** | *a un ex-administrador YA INACTIVO se le puede editar…* · *…YA BLOQUEADO también* |

**Todas murieron por la prueba que se esperaba**, no por otra — se verificó nombre por nombre (en este
track ya pasó dos veces que un mutante pegaba en la línea equivocada).

### La pantalla avisa, no esconde

`AvisoQuitaAdministracion.tsx` + `gobierno.ts`: aviso ámbar al desmarcar el rol y al desactivar.
**No esconde ni deshabilita nada** — los botones siguen vivos; explica **qué capacidad se pierde** y
**dice la salida**. El servidor decide (§Post-F9.68). Sin petición extra: comparte `queryKey` con el
selector de roles.

**El mensaje del servidor dice la salida, no sólo el «no»:** *«…el usuario "daniel" es el último camino
a ese permiso. Primero nombra a otro administrador —dale a alguien más, activo y no bloqueado, un rol
con el permiso «usuarios.administrar»— y luego repite este cambio.»* De paso, *«No puedes desactivar tu
propio usuario»* ganó su salida: *«…pídeselo a otro administrador.»*

### 🔴 Declarado y NO hecho

**No se revocan las sesiones vivas.** A quien le quitan el rol **le siguen valiendo los permisos de su
sesión** hasta que vuelva a entrar. Es **preexistente** y ajeno a este defecto, pero conviene saberlo:
quitarle el acceso a alguien **no lo saca en el acto**.

---

### ⭐⭐ EL CI LO DEMOSTRÓ: de deducción a MEDICIÓN

El coder dedujo **leyendo** que el arreglo de la quinta puerta rompería `auth.int.test.ts`. **No se quedó en deducción: el CI lo probó.** La corrida del commit WIP (`61b0426`, *antes* del arreglo del test) falló con:

```
FAIL  src/api/auth.int.test.ts > API de autenticación (E3) > login
      > al 5º intento fallido bloquea con el mensaje correcto
AssertionError: expected false to be true
 ❯ src/api/auth.int.test.ts:127:33
```

**Exactamente lo previsto**, en la línea prevista: el `admin` sembrado es el único administrador de esa base, así que el guard nuevo ya no lo bloquea. *Una afirmación que empezó como lectura del código terminó con su evidencia.*

⇒ **Y confirma el valor del hallazgo del reviewer**: sin esa verificación, la etapa habría llegado al PR con el CI en rojo y el diagnóstico habría costado una vuelta entera.

### ⚠️ El segundo fallo de esa misma corrida: el ENSAYO DE RESTAURACIÓN, al filo del tiempo

La misma corrida falló también en `src/comun/jobs/respaldo-bd.int.test.ts:494` — la prueba llamada, literalmente, **«⭐ ENSAYO DE RESTAURACIÓN (un respaldo que no se sabe restaurar no es un respaldo)»**, que hace el ciclo completo `pg_dump → cifrar → descifrar → pg_restore en otra base` — con **`Test timed out in 180000ms`**.

**No es una regresión de esta etapa** (el diff no toca respaldos) y **pasó en las tres integraciones anteriores** (`41125a9`, `58e03f6`, `409a91a`, backend en verde las tres) — apunta a **lentitud del runner**, no a que el respaldo esté roto.

🔴 **Pero se anota, y no como nota al pie:** esa prueba está **al filo de su límite de tiempo**, y es justo la que cubre lo único que puede **posponer el arranque** (que Gabriel restaure un respaldo y compruebe que sirve). Un ensayo de restauración que a veces no termina **es un aviso**, no ruido. **Deuda con nombre: subirle el timeout o medir por qué tarda tanto.**

*(Vale decir lo bueno: **existe** una prueba automática que ensaya la restauración de punta a punta. Eso no sustituye a restaurar el respaldo real de producción —lo de Gabriel sigue pendiente— pero el mecanismo sí está cubierto.)*

## V1-E6b · Esconder, no negar — y la capa de ruta que faltaba ⭐ — ✅ HECHA (18-ago-2026)

> Daniel: *"Las personas que no tengan acceso a algo me gustaría que no vean esa opción. **Si no tienen
> acceso a costos, en lugar de mandarle un mensaje diciendo que no tienen permiso, mejor que les borre esa
> opción.**"* Y después, defensa en profundidad: *"ocultar botones mientras se pueda y **al mismo tiempo
> bloquear pantallas para asegurarnos que no haya una puerta que no estemos viendo**"*.
> Decisión en `DECISIONES.md` **§Post-F9.68**.

### Las tres capas — y la de en medio no existía

| Capa | Qué hace | Antes | Ahora |
|---|---|---|---|
| **Menú** | esconde la opción | ✅ | ✅ |
| **Ruta** | cierra la pantalla | 🔴 **NO EXISTÍA** | ✅ |
| **Backend** | rechaza la operación | ✅ | ✅ |

**La intuición de Daniel era correcta y la puerta existía:** `RutaProtegida.tsx` comprobaba **solo que hubiera
sesión** —lo decía su propio comentario: *"es solo la PRIMERA barrera (UX)"*— y de las **135 rutas solo 2**
mencionaban permisos. Quien tecleara la URL de una pantalla ajena **entraba**, veía encabezados y botones, y
todo fallaba al cargar. **No era agujero de seguridad** —el backend rechaza— pero era la puerta que él
intuyó sin verla.

Ahora las 135 declaran su exigencia **tomándola de `catalogo.ts`**, la misma fuente del menú: si fueran dos
listas, en seis meses alguien agrega una pantalla al menú, olvida la ruta, y el hueco vuelve sin que nadie
lo note.

### La pregunta grave, contestada con evidencia

Se recorrieron **los 558 endpoints** del backend: **556 llevan guardia de permiso**; los 2 sin ella
(`GET /sesion`, `GET /empresas/logo`) más `/health` son públicos a propósito. **Ningún endpoint dependía de
que la UI escondiera el botón.** Esconder sigue siendo **presentación**, no seguridad.

### Nota de cierre — ✅ HECHA (18-ago-2026)

Ocho pantallas corregidas (las 3 conocidas **+ 5 que el coder encontró**), incluida una que mostraba el
**nombre técnico del permiso** en pantalla y un mosaico *deshabilitado con tooltip "Requiere permiso de
Avíos"* — la puerta enseñada y luego cerrada, justo lo que Daniel no quería.

**⭐ El hallazgo de la revisión, y por qué importa más que el hueco:** cinco pantallas de **Administración**
(`usuarios`, `roles`, `empresas`, `conceptos-costo`, `estados-lista`) **heredaban la UNIÓN de permisos del
hub**. Medido: alguien con **solo `admin.ver-bitacora`** abría Usuarios, Roles y Empresas, veía el botón
«Nuevo», y la consulta reventaba — *el síntoma exacto que la etapa venía a matar, en el módulo más sensible
del sistema*.

**Y lo peor no era el hueco: era que la prueba de deriva era ESTRUCTURALMENTE CIEGA a él.** Esas rutas caían
en el bucket "gateadas" y pasaban las dos aserciones. La garantía cubría *sin declaración* y *abierta por
herencia*, **no *gateada de más por herencia***. Se cerró haciendo que el resolvedor devuelva **de qué
declaración salió** el permiso —sin eso una ruta heredada y una con gate propio **se ven idénticas**— más
una tercera aserción. El reviewer la probó colgando pantallas nuevas a **los diez hubs**, no a los dos que
tocó el coder: las cazó todas.

**Un arreglo destapó otro:** el 404 decía *"no existe o no tienes permiso para verla"* — tras esta etapa esa
cláusula era **el único texto de la app que le hablaba de permisos al usuario**, y era **falsa**. Al ir a
quitarla apareció que esa pantalla la usaban **dos** caminos: el comodín y el de un módulo escondido por
permisos, que sin la cláusula habría dicho "no existe". Se separó en tres mensajes, cada uno cierto para su
caso, con el texto aprobado por Daniel viviendo en **un solo archivo**.

**31 pruebas nuevas, todas en pareja:** cada "no aparece sin permiso" tiene su gemela "sí aparece con
permiso". Sin las dos, una prueba de ocultamiento **pasa igual cuando el elemento nunca aparece por otro
motivo**. Cero regresiones en 104 hojas de menú y 7 hubs.

**Aplazado y declarado:** **36 de 82** controles siguen `disabled` en vez de ausentes — son controles de
**escritura dentro de pantallas de consulta** (`costos.capturar` sobre `costos.ver`, `calidad.actualizar-
auditorias` sobre `calidad.ver`…). Los otros 46 quedaron cubiertos por la capa de ruta, verificado pantalla
por pantalla por las dos partes.

⚠️ **Lo que Daniel debe decidir, y no es de esta etapa:** los **9 catálogos** (`telas`, `avios`, `colores`,
`tallas`, `clientes`, `proveedores`, `almacenes`, `temporadas`, `etiquetas-marca`) siguen en `'autenticado'`
— deuda **pre-existente** (§4), con ese valor pedido por él en su momento. **En esas nueve su petición de
§Post-F9.68 sigue sin cumplirse**: cualquiera que entre al sistema ve el catálogo de clientes y el de
proveedores, con sus nombres y condiciones.

---

## V1-E3f pieza B · Proveedores, como Daniel los usa ⭐ (18-ago-2026)

> Las ocho piezas que Daniel dictó el 16-ago. Decisiones en `DECISIONES.md` **§Post-F9.54 · .55 · .56 ·
> .57 · .58**. Se separó de la pieza A (el arte) porque juntas eran catorce cosas más un lector de PDF, y
> como solo puede haber **un coder a la vez sobre el árbol**, iban a ser secuenciales de todos modos.

### Qué entrega

Renombres de rol (**Estampador**, **Bordador**, **Telas**, **Avíos**) · **contactos como TABLA** con el
puesto en **texto libre** (*"sí un catálogo de contactos, pero deja el campo abierto qué rol tiene cada
persona"*) · **el campo corto fusionado en UNO y ÚNICO** (*"sí debe de ser único"*) · el `tipo` retirado
traduciéndose a rol de forma aditiva · la bandera de factura obedecida · «está asegurado» solo en talleres
· el **lector de la Constancia de Situación Fiscal** · y la **segmentación con/sin factura en CxP**,
reusando el motor de EsMa.

### La trampa de §Post-F9.54, cerrada con evidencia

La nota decía que **el seed actualiza el nombre del rol si el código ya existe** y que bastaba
`SEED_ON_START`. **Era falsa** (`update: {}` no toca el nombre) y ya estaba corregida. Al construir se
verificó lo que faltaba: **no existe CRUD de `RolProveedor`, solo un `GET`** — o sea que **renombrar a mano
era imposible** y la vía correcta es el `UPDATE` en migración. Confirmado por el reviewer.

### Nota de cierre — ✅ HECHA (18-ago-2026)

**Segunda vuelta: APROBADA.** El reviewer no se fio de las pruebas del coder: **escribió la suya desde
cero** —mezclando EsMa en los tres estados con movimientos del motor, sumando **montos** y no conteos— y
verificó que **falla con el código viejo** (`expected 4 to be 5`). Montó el índice sobre `lower()` contra
una base con **cuatro variantes de caja** del mismo corto (posible en la base real, porque `corto` era
único **exacto**): migración en **exit 0, 13 → 13**, con los tres desplazados en bitácora. Y la carrera
concurrente con distinta caja pasó de **2 filas a 1**.

**Lo que resistió desde el principio, que era lo que más miedo daba:** la migración fusiona **dos columnas en una con
unicidad**, convierte un campo en tabla y tira un enum. El reviewer la montó contra datos adversarios
—cortos duplicados exactos y con distinta caja, con espacios, vacíos, contactos en blanco, acentos, roles
destino faltantes— y salió **11 proveedores → 11**, los 6 contactos exactos, y **4 filas de bitácora** con
el desplazado y las colisiones. **Nada se resolvió en silencio** (D3).

**🔴 El hallazgo que valía el rechazo, y es el más sutil de todo el track.** El coder escribió
`{ conFactura: { not: true } }` para separar los movimientos con y sin factura, con un comentario
explicando que lo hacía así **precisamente para incluir los migrados** (`conFactura = NULL`). **La premisa
era falsa:** en lógica de tres valores `NULL <> true` es `NULL`, así que la fila **se descarta igual**. Las
dos formas son idénticas en efecto. Verificado en Postgres sobre `(true, false, NULL)`:

```
con_factura <> true        -> 1 fila        (lo que emite `not: true`)
con_factura = false        -> 1 fila
(= false OR IS NULL)       -> 2 filas       <- la unica que si los incluye
```

**Consecuencia en dinero:** los cargos EsMa migrados **se caían de los DOS segmentos** en la lista,
mientras el encabezado (`saldoSinFactura = saldo - saldoFiscal`) **sí los sumaba**. Encabezado y renglones
contradiciéndose, y **los dos segmentos sin dar el total**.

**⚠️ Y lo que lo vuelve instructivo: ninguna prueba lo tocaba.** El reviewer mutó esa línea y las **74
pruebas** de terceros/EsMa/CxP siguieron **en verde**, porque todas usaban movimientos del motor —donde el
campo es NOT NULL y la partición es exacta por construcción—: **probaban algo que no podía fallar.** De las
23 mutaciones del coder, **ninguna tocó esa consulta**.

*Es el mismo patrón que ya costó tres veces esta semana, ahora en dinero: una afirmación sobre el sistema
escrita sin ejecutarla, con una prueba al lado que parecía respaldarla.*

**Los otros:** el aviso de código postal era **inalcanzable** —el recorte a 5 dígitos corría **antes** del
control de longitud—, así que un CP de expedición equivocado **se persistía callado**; y **la unicidad del
campo corto se violaba con distinta caja** en concurrencia — *la migración se tomó el trabajo de deduplicar
sin distinguir caja para que ese estado no existiera, y la base lo volvía a permitir al día siguiente*.
Cerrado con índice único sobre `lower()`.

### El lector de la constancia: por qué el fixture inventado no sirve

Antes de la revisión, el **lead probó el lector contra los dos PDF reales** que Daniel subió, y encontró
que la etiqueta `Nombre del Municipio o Demarcación Territorial` **se colaba dentro del domicilio** — no
tronaba, no avisaba: **guardaba basura**.

**Sobrevivió por una razón que vale más que el defecto:** el fixture era **inventado**, y el coder había
escrito en la prueba **la misma etiqueta corta que tenía mal en el código**. *La prueba confirmaba su
suposición en vez de cazarla.* **Un fixture reconstruido no prueba el parser: prueba a quien lo escribió.**

Al arreglarlo aparecieron **cuatro etiquetas más** —incluido un bloque entero de actividades económicas,
sin el cual se comía media página—, encabezados **sin dos puntos**, y detalles del layout real que ninguna
reconstrucción tenía: campos sin espacio tras los dos puntos y el municipio **partido en dos líneas**.

**La guarda de fondo, que vale más que el arreglo:** cualquier `:` que sobreviva dentro de un valor delata
una etiqueta desconocida, así que **el próximo cambio de formato del SAT avisa en vez de guardar basura**.
El coder **rehízo su primera versión** al descubrir que era *prácticamente inalcanzable* —buscaba solo
etiquetas conocidas, que el corte ya frenaba— y lo dijo en vez de entregarla. El reviewer le tiró **nueve
constancias malformadas**: degrada con advertencias, nunca truena.

⚠️ **Los PDF son documentos fiscales REALES, uno personal.** El fixture es texto **anonimizado** con la
estructura intacta. En la verificación final el lead encontró **dos fragmentos del domicilio real** que
seguían en un comentario y una prueba pese a que se había reportado la anonimización como hecha: retirados.

---

## V1-E3h · La receta en la OP: verla, liberarla POR PARTES, y jalar del modelo lo que falte ⭐ (19-ago-2026)

> Salió de Daniel recorriendo el flujo completo con una orden real y **no encontrando dónde autorizar los
> avíos**. Decisiones en `DECISIONES.md` **§Post-F9.72 · .73 · .74**.

### Qué entrega

**La receta se ve y se libera desde la OP**, con `desarrollo.ver`/`.administrar` y **sin** `ordenes.administrar`
· **liberación POR RENGLÓN** con acciones en bloque (todas las telas / todos los avíos / todo / selección)
· la puerta de compra pasa de *«sin liberar no se compra»* a **«se compra lo liberado»** ·
**el comprador ve qué falta** en la explosión, con nombre, cantidad y el camino a donde se firma ·
**`traerDelModelo`**, por Desarrollo, que nunca pisa lo ajustado a mano · y la **bandeja «Recetas por
liberar»**, aprobada por Daniel en vivo (*"está buenísima"*).

De paso, el mosaico **«Modificar» quedó condicionado a `ordenes.administrar`** — no lo estaba, a diferencia
de los de compras, ruta y telas.

### Por qué era de fondo, y no un cambio de lugar

El botón de liberar —*la puerta que abre la compra*— vivía dentro del diálogo de «Modificar». Con la frase
de Daniel encima (**"nadie va a tener permiso de modificar la OP más que yo"**) eso dejaba dos salidas, las
dos malas: **Daniel de cuello de botella** firmando todas las recetas, o **Desarrollo con permiso sobre la
OP entera** —cantidades, fechas, matriz de tallas— solo para aprobar una lista de materiales. Los dos
permisos ya existían separados; **lo que estaba mal era que la puerta física era una sola.**

### Nota de cierre — ✅ HECHA (19-ago-2026)

**Primera vuelta RECHAZADA; segunda APROBADA.** Los dos bloqueantes eran de los que no se ven leyendo:

**🔴 El fixture que iba a poner el CI en rojo.** `sembrarRecetaDeOrden({liberada:true})` sellaba
`Orden.recetaLiberadaEn` pero dejaba **todos los renglones sin firmar**. Como la puerta ya no consulta esa
columna, `contarLiberados` daba 0 → `ErrorConflicto` en **46 llamadas a la explosión** de `mrp.int.test.ts`
más 7 líneas de `ordenes-compra.int.test.ts`. El coder sí se acordó del ETL de go-live; se le pasó el
fixture. Y el fondo pesa más que el arreglo: **el helper fabricaba un estado que el dominio ya no puede
producir** — justo la invariante que la etapa introdujo. *Es la cicatriz de "nada de Docker local" en su
forma pura: no se puede correr, así que no se vio.*

**🔴 La bandeja no liberaba nada en su caso dominante.** `copiarRecetaDelModelo` no fija `estado` y el
default del esquema es `sin_revisar`; liberar exige que no quede ninguno sin revisar. Resultado: orden
recién creada → aparece en la bandeja → «Liberar todo» → error, y a dar la vuelta por el Centro de Órdenes
**— exactamente lo que la bandeja existe para evitar**, y con el 100 % de las órdenes nunca tocadas, que
son las que la pueblan. Se resolvió con `revisarPendientes`: marcaba revisado **dentro del alcance** y firmaba
**en la misma transacción**, dejando `revisadosEnEsteActo` en la bitácora — **sin disfrazarse de "ya estaban
revisados"**. ⛔ **RETIRADO el 20-ago-2026 en V1-E3k**: Daniel eliminó la liberación en bloque
(*"no tiene sentido liberar las cosas sin ver"*), la bandeja dejó de firmar y esa bandera se quedó sin
usuario. Se relata aquí porque **explica el defecto de su momento**, no porque siga vivo.

**⚠️ Y el hallazgo que vuelve a repetir el patrón de la semana: «8 mutaciones, 8 cazadas» no era cobertura.**
El reviewer mutó lo que el coder **no** había mutado y **4 de 8 sobrevivieron**. La peor: borrar la mitad
**avío** de la puerta por material dejaba las 14 pruebas en verde —y la suite unitaria completa también—,
porque los tests de integración compraban tela. **El código estaba bien; la verificación no existía** — y
el avío es *precisamente* el caso que originó la decisión. También sobrevivían: `contarLiberados` sin el
filtro de lápidas (una orden cuyos únicos firmados fueran lápidas pasaría la puerta con nada vivo
autorizado), la guarda de receta vacía (`[].every(...) === true`: una receta vaciada se sellaba como
«liberada completa»), y las lápidas en la UI. En la segunda vuelta **las 4 mueren**.

**Lo que resistió desde la primera lectura:** el backfill contra datos adversarios (órdenes liberadas por la
migración anterior con autor NULL, sin renglones, con lápidas, canceladas) · que **revivir una lápida borra
su firma por las dos vías** y excluir no revoca · que **no hay puerta trasera de compras** (el snapshot se
regenera entero y la generación re-verifica material por material en el momento del clic) · el SQL de la
bandeja (parametrizado, A9, canceladas y lápidas fuera) · y las tres capas de §Post-F9.68.

**Una afirmación inflada, corregida:** el coder dijo que su DDL coincidía *"carácter por carácter"* con el
de Prisma. Lo exacto —verificado por los dos— es que **las seis columnas coinciden en nombre, tipo y
nulabilidad y los tres índices se llaman igual**; lo que difiere es el agrupamiento de los `ALTER TABLE`.
Equivalente en resultado, pero lo dijo de más y lo reconoció sin defenderlo.

---

## V1-E3i · La cadena de importar y comprar, y el parpadeo que sacaba al usuario ⭐ (19-ago-2026)

> Cinco de las seis piezas salieron de **Daniel recorriendo el flujo con una OC real de C&A** (orden
> 620672, 1,744 pzas) y atorándose. Decisiones en `DECISIONES.md` **§Post-F9.70** y **§Post-F9.71**. La
> sexta es el paso del CI que se colgó dos veces esa misma noche.

### Qué entrega

**Fecha de entrega POR OC** en la explosión (*"cada OC interna va a tener una fecha diferente"*) ·
**«Archivo de la OC» que SÍ lee el PDF** y propone cargarlo · la **plantilla de C&A sembrada con su 7%** ·
el **botón mudo que ahora dice qué le falta** · el **parpadeo de red que sacaba al usuario al login** · y
un **límite de tiempo** en el paso de CI que se cuelga.

### Nota de cierre — ✅ HECHA (19-ago-2026)

**TRES vueltas: dos RECHAZADAS y la tercera APROBADA.**

> ⚠️ *Este encabezado dijo «✅ HECHA — primera vuelta RECHAZADA; segunda APROBADA» **antes de que la
> segunda vuelta terminara**: lo escribió el lead dando por hecho el resultado. Lo cazó el reviewer. Al
> corregirlo, el reemplazo pegó en la **nota de V1-E3h** —que tenía el texto idéntico y era correcta—
> dejando intacta la equivocada; también lo cazó el reviewer. Se deja anotado porque es **exactamente la
> lección que esta ficha viene documentando**, dos veces seguidas y del lado de quien la escribía.*

**🔴 El defecto que valía el rechazo: dos piezas de esta MISMA etapa se cancelaban entre sí.** El arranque
automático del importador —la puerta nueva de la pieza 2— llamaba al análisis desde un efecto de montaje
cuya **clausura se creó en el primer render**, cuando el porcentaje aún valía `0`; el valor real llega
**por red** desde la plantilla. Y `0` **no es "no mandé nada"**: el backend hace
`datos.porcentajeAdicional ?? config.porcentajeAdicional`, así que **el cero explícito le ganaba a la
plantilla recién sembrada**.

En el caso de Daniel: sube el PDF → «Sí, cargar la OC» → la matriz propone **1,744 en vez de 1,866**, y las
OPs nacen con las cantidades exactas del cliente. *Es textualmente el defecto de §Post-F9.70 punto 2 que
esta etapa vino a cerrar, reintroducido por la puerta nueva* — y **en silencio**, porque el campo del
porcentaje vive solo en el paso que ese camino se salta.

**⚠️ Y la razón por la que sobrevivió es la lección, no el defecto: la prueba estaba montada de forma que
el fallo no podía ocurrir.** El mock de la plantilla devolvía `undefined`, así que **en ninguna prueba el
porcentaje podía ser distinto de 0**; y la aserción del cuerpo miraba `idCliente`, que pasa igual con el
porcentaje equivocado. *Mismo patrón que el fixture inventado de V1-E3f pieza B: una prueba que confirma la
suposición de quien la escribió en vez de cazarla.* El reviewer no lo dedujo — **imprimió el cuerpo real
que viaja al servidor** y comprobó que por el camino manual sí iba el 7.

**🔴 Y una TERCERA puerta, en la segunda vuelta: el % del cliente anterior se pegaba al siguiente — y se
GUARDABA en él.** El efecto que carga el % de la plantilla trae un `if (pctGuardado !== null)` —correcto
para no pisar lo que el usuario tecleó cuando la consulta refresca— que **también impide volver a "sin
opinión" al cambiar de cliente**. Escenario: alguien abre el importador, elige C&A, se da cuenta de que la
OC es de otro cliente, **cambia el cliente**, carga y confirma → las OPs de ese cliente nacen con **+7% que
nadie pidió**, y el backend le crea al **cliente equivocado** una plantilla vigente al 7% con los campos
variables de C&A encima. Reproducido ejecutando (`PCT TRAS CAMBIAR DE CLIENTE = 7`).

**⚠️ Y el patrón que ya no es anécdota: TRES veces en esta sola etapa, el ANDAMIO DE PRUEBAS era lo que
volvía el fallo imposible.** Primero el mock de la plantilla devolvía `undefined` **constante**, así que en
ninguna prueba el porcentaje podía ser distinto de 0. Luego la aserción del cuerpo miraba `idCliente`, que
pasa igual con el porcentaje equivocado. Y por último el mock no recibía el `idCliente`, con lo que *"el %
del cliente anterior se pega al siguiente"* era **inexpresable**: no había forma de escribir el escenario.
*Una prueba montada de modo que el fallo no pueda ocurrir no prueba nada* — y en las tres, arreglar el
andamio fue lo que destapó el defecto.

**Las tres variantes salen de la MISMA raíz**, y ése es el aprendizaje que vale más que los tres arreglos:
**un valor que significa dos cosas**. Mientras `0` quisiera decir a la vez *"cero por ciento"* y *"no tengo
opinión"*, cada vuelta destapaba una salida nueva —analizar, confirmar, cambiar de cliente— y taparlas de
una en una no cerraba la familia.

### Lo que resistió, que fue casi todo

El reviewer corrió **19 mutaciones propias**, incluidas las que el coder no había hecho: **17 cazadas**.
Verificó la **pieza 1** invariante por invariante (A1 con la función pura en el dominio, A2 —las fechas se
resuelven antes de crear la primera OC y el int test asevera `count() === 0` tras el rechazo—, D3 —nombra
a los proveedores sin fecha y **rechaza** dos fechas contradictorias en vez de quedarse con la última—).

A la **pieza 5** (sesión) **le buscó la puerta trasera y no la tiene**: un 401 real **sigue cerrando
sesión**, porque `obtenerSesion` traduce el 401 a **dato** y no a error, así que llega como «sin sesión» y
**no se reintenta**; los reintentos solo alcanzan a lo que *lanza* (5xx y red). Y *"lo conocido gana sobre
el fallo"* no deja a nadie dentro con permisos ajenos: el guard es solo experiencia de usuario y cada ruta
del backend re-verifica.

La **pieza 6** la reprodujo en bash: después de `fi`, `$?` da **0** —por eso leerlo dentro del `else` era
obligatorio, y la primera versión del coder estaba mal—, y un `timeout` que corta (código **124**) se ve
como fallo del intento sin abortar el paso pese al `set -e`.

### Dos cosas que el propio coder confesó, y que conviene no perder

1. **Su primera pasada salió VERDE en las pruebas con typecheck y lint en ROJO.** El juez sigue siendo el
   CI, y las pruebas pasando no significan que el proyecto compile.
2. De sus **26 mutaciones, 2 sobrevivieron** y las arregló él mismo: una prueba que miraba el campo vecino
   pero **nunca el que tocaba**, y un filtro que resultó ser **código muerto** — lo eliminó en vez de
   taparlo con una prueba, y dejó la regla en un solo camino (vaciar la fecha de un grupo **borra la
   excepción** y vuelve a seguir a la de arriba).

---

## V1-E3j · La receta merece pantalla propia ⭐ (19-ago-2026)

> Salió de Daniel probando **0.005** en vivo. Decisiones en `DECISIONES.md` **§Post-F9.77** y **§Post-F9.78**.

### Qué entrega

Una **pantalla completa** de la receta (`/produccion/ordenes/:id/receta`, permiso `desarrollo.ver` para
entrar y `.administrar` para firmar — **nunca** `ordenes.administrar`) · el bloque del detalle de la OP
convertido en **resumen con su botón** · la bandeja «Recetas por liberar» que ahora **lleva al detalle** en
vez de solo ofrecer el bloque · el llamado a **traer del modelo arriba de todo**, en tono de acción · y
firmar **por renglón con botón de texto**, no un ícono mudo.

### Por qué existe: el mecanismo estaba completo, y aun así falló

Daniel buscaba meter a una OP unos avíos agregados al modelo después. El bloque decía **"la receta de esta
orden está vacía"**, y ese cartel se llevó la atención mientras **justo debajo** estaba el aviso con su
botón. Al verlo, funcionó a la primera: *"ya logré jalarlos. Justo me faltó poner el botón."*

⚠️ **§Post-F9.73 estaba cableado de punta a punta y verificado. Lo que no estaba era a la vista.** *Una
función que el usuario no encuentra no existe* — y el sistema estaba **invitando al clic equivocado**: con
la receta vacía ofrecía «liberar», cuyo único resultado posible era el mensaje que tapaba la salida.

### Nota de cierre — ✅ HECHA (19-ago-2026)

**TRES vueltas: dos RECHAZADAS y la tercera APROBADA.**

> ⚠️ **Y el lead volvió a escribir el resultado antes de que ocurriera.** Este encabezado decía «✅ HECHA —
> primera vuelta RECHAZADA; **segunda APROBADA**» estando la segunda revisión **todavía corriendo**; terminó
> en RECHAZADO. Lo cazó el reviewer, que lo señaló como *"textualmente la lección que la ficha de V1-E3i
> dejó anotada 150 líneas más arriba, repetida en el mismo archivo que la documenta"*. **Es la segunda vez
> en dos etapas.** Se deja a la vista, otra vez, porque el patrón —dar por hecho un resultado que todavía no
> se ha ejecutado— es exactamente el que estas fichas vienen documentando, y no deja de serlo porque lo
> cometa quien las escribe.

Lo notable es **dónde** estuvieron los defectos: **ninguno en la parte que daba miedo**. Los dos cambios de
backend —ensanchar el permiso de lectura y derivar el encabezado en el servidor— el reviewer los verificó
uno por uno, en dos revisiones, y **los dos estaban bien**. De los cinco hallazgos de la primera vuelta,
**cuatro fueron pruebas que no probaban lo que decían**; el quinto (la columna «Acciones» vacía con su
encabezado) fue un **defecto de comportamiento** contra §Post-F9.68 regla 1, no un hueco de verificación.

**🔴 El más grave, y ya es el cuarto de esta familia en la tanda:** las pruebas que afirmaban *"lleva a la
receta de ESA orden"* **no comprobaban la orden**. El reviewer cambió el destino a un id fijo y equivocado
(`/999/receta`) y salieron **13/13 y 7/7 verdes**, porque la ruta de prueba matchea cualquier id. Escenario:
un refactor que pierda el id —fácil ahora que las dos entradas comparten destino— manda al usuario **a la
receta de otra OP**, que es donde se firma el material que abre la compra.

**🔴 «El resumen no calcula nada» era falso.** El predicado de *qué cuenta como faltante* estaba escrito
**dos veces**, y el reviewer lo demostró relajando **solo la copia del resumen**: 7/7 verdes, mientras la
del panel sí tenía su gemela. Coincidían por casualidad. Al unificarlo, el coder encontró una **tercera**
copia que nadie había señalado —el markup de la insignia con sus `data-testid`— y **corrigió el comentario
que afirmaba lo contrario**: *un comentario que miente es peor que ninguno, porque el siguiente se lo cree*.

**Los otros tres:** una OP **cancelada** con faltantes podía pintar botones que el backend rechaza —el
letrero de error que esta etapa vino a eliminar—, sin nada que lo sostuviera; `totalPiezas` estaba probado
con **una sola fila de matriz**, donde suma, máximo, mínimo y promedio dan lo mismo (se cerró con 3/5/7/11 →
26, que no coincide con ninguno); y la columna «Acciones» quedaba **vacía con su encabezado** para quien no
puede firmar — *invisible hasta esta etapa, porque antes el encabezado era mudo*, y contrario a la regla de
Daniel de que un dato que se va por permiso **se va con su encabezado**.

**🔴 Y en la SEGUNDA vuelta, la misma familia un nivel más arriba: la pantalla lee la orden DOS veces** —una
para el encabezado, otra para las tablas— **y la prueba no distinguía cuál se había equivocado**. Afirmaba
*"pide SU receta, no la de otra"* con un solo `toHaveBeenCalledWith(50)` sobre un mock **compartido**, así
que la llamada del panel satisfacía la aserción aunque la de la página estuviera mal, y al revés. El
reviewer lo verificó con las dos mutaciones por separado: **9/9 verdes las dos**. Escenario: el encabezado
dice *«Receta de la OP 1234 · C&A · 1,200 pzas»* y las tablas de abajo —con sus botones «Liberar»— son de
**otra OP**, en la pantalla donde se firma el material que abre la compra.

Se cerró afirmando **la lista completa de llamadas** (`[50, 50]`), con el conteo **medido** por una sonda
desechable —no adivinado— y verificado por el reviewer con la suya: son exactamente dos lecturas, y
`renderConProveedores` no envuelve en `StrictMode`, así que el número es estable. Una tercera lectura futura
pondrá la prueba roja: es **canaria, no fragilidad**.

⚠️ **Y al escribir esa aserción apareció la quinta variante, la más sigilosa:** el primer intento rompió el
lint con `no-unsafe-return` porque el mock era `vi.fn()` pelado y `mock.calls` es `any[]` — *o sea que la
aserción destinada a proteger la identidad de la orden estaba a punto de escribirse sobre `any`, donde el
lenguaje ya no comprueba nada*. El reviewer lo confirmó revirtiendo el tipado: **2 errores, y el segundo es
la línea de esa aserción**.

**Las cinco variantes de la misma familia, en una sola etapa** —un destino de ruta con `:param`, un panel, una
columna, dos lecturas y un tipo vacío— tienen todas la misma forma: **el objeto observado acepta cualquier
valor sin quejarse**, y la prueba afirmaba *presencia* donde su título prometía *identidad*. La regla que
queda: **antes de dar por buena una aserción sobre «el X correcto», nombra el valor concreto que la pondría
roja si estuviera mal.** Si no existe ninguno, la aserción no dice lo que promete.

### Una trampa nueva, que vale para toda prueba de permisos

Al escribir las pruebas de ruta, el coder descubrió que **la validación del cuerpo corre ANTES del guard de
permiso**: un payload inválido devolvía **500 en vez del 403** que la prueba creía estar comprobando. Queda
documentado en el propio archivo. *Es la forma más silenciosa de que una prueba de seguridad pase por la
razón equivocada.* De paso, el comentario decía «las OCHO mutaciones» en tres lugares: **son 7**, contadas.

---

## V1-E3k · La receta se firma UNO POR UNO ⭐ (20-ago-2026)

> Daniel recorriendo el flujo: *"me parece una mala idea el botón de «Liberar todo lo que falta». Creo que
> siempre se debe liberar uno por uno, para que se revise lo que se está haciendo. **No tiene sentido
> liberar las cosas sin ver**."* Decisión en `DECISIONES.md` **§Post-F9.80**; retira **§Post-F9.75**.

### Qué entrega

Se retira la **liberación en bloque** en los tres lugares donde existía —«Liberar todo lo que falta», los
botones por sección, y el «Revisar y liberar» de la bandeja— **y también del contrato**. Queda **firmar
renglón por renglón**. **«Marcar todo revisado» se conserva** por decisión explícita de Daniel: no libera
nada ni compromete dinero.

### Lo que hay que no perder: los botones NO los pidió Daniel

Su decisión (§Post-F9.72 punto 4) fue *"debería poder liberarse por partes, y que el comprador vea qué le
falta"*. **Las acciones en bloque las agregó el LEAD**, razonando que *"lo rutinario no cueste veinte
clics"*.

⚠️ **Ese razonamiento optimiza para la prisa en el punto donde se compromete el dinero.** La firma no es un
trámite: **es la puerta que abre la compra**, y un botón que aprueba diez cosas de un clic entrena
exactamente lo que la firma existe para evitar. La regla que queda, y que Daniel confirmó: **la fricción se
cobra donde hay consecuencia** — por eso «marcar revisado» (que no gasta) conserva su atajo y «liberar» (que
sí) lo pierde.

*Es la segunda vez en la tanda que una comodidad añadida por el equipo, no pedida, resulta ser el defecto:
la primera fue el botón de liberar sobre una receta vacía, cuyo único resultado posible era el cartel que
tapaba la salida.*

### La línea en el servidor, y el hueco declarado

No bastaba quitar los botones: **esconder sin bloquear es lo que §Post-F9.68 vino a matar**, y una decisión
de negocio se cumple en el dominio. Se retiraron del contrato `alcance` y `revisarPendientes`; el cuerpo
pasó a `{ renglones: [{tipo, id}] }` **requerido**. Verificado antes de cerrarlo que **nadie real usaba el
comodín**: el ETL **no pasa por `liberarReceta`** (escribe la firma directo por Prisma), que era el único
argumento para conservarlo.

**Dónde quedó la línea, a propósito:** el servidor **jamás expande un comodín** —hay que nombrar cada
renglón, y para nombrarlo hubo que leer la receta—, pero **no** se fuerza un renglón por llamada: N llamadas
de uno equivalen a una de N, así que la restricción no compraría seguridad verificable y cerraría un futuro
multi-select con casillas, que sí es "ver". **El hueco residual está declarado en el TSDoc**: un cliente
puede leer la receta, juntar los ids y mandarlos todos. Volver a ofrecerlo con un botón sería re-tomar la
decisión de Daniel, no aprovechar un hueco.

### Nota de cierre — ✅ HECHA (20-ago-2026)

**Dos vueltas: la primera RECHAZADA, la segunda APROBADA.** Ningún hallazgo tocó el código de producción —
el reviewer respondió que **no queda ningún camino que firme más de lo que se vio**, verificado en dominio,
ruta y UI, y comprobó que el `updateMany` de la firma pasó de `{idOrden, excluido:false}` a
`{idOrden, excluido:false, id:{in:ids}}`: **estrictamente más angosto**.

**🔴 El hallazgo: una guardia de e2e que no podía ponerse roja NUNCA.** El bucle que vigilaba *"que los
botones no vuelvan por la puerta de atrás, en ninguna de sus cuatro formas"* corría sobre una OP con
`resumen.total === 0` — y con receta vacía **los cuatro ya estaban ocultos antes de la etapa**. Reintroducir
el bloque entero la habría dejado verde. **Afirmaba una cobertura inexistente**, que es el estándar que esta
misma tanda se puso.

Se borró en vez de rescatarla, y el reviewer respaldó el intercambio con un dato que zanja la duda de
"quitar cobertura de e2e merece segunda mirada": barrió `frontend/e2e/` entero y **ningún e2e ha clickeado
jamás un botón de firmar** — el bucle tenía cobertura **cero desde el día que se escribió**. Lo que vuelve
segura la eliminación es que el comentario deja **la razón mecánica** y **nombra a su sustituto por el
título**, y ese par de pruebas unitarias **sí cae bajo mutación** (2 de 48).

**⚠️ Y al arreglar la segunda deuda, el coder casi repite el mismo error:** su primer intento cambiaba una
aserción permanentemente vacía por **otra igual de vacía** —un testid que tampoco podía existir, porque el
fixture no tenía telas—. Lo notó y lo dijo. Se resolvió dándole a esa prueba una receta **con** tela; el
reviewer verificó después que el **estado** del fixture (`excluido:false`, `liberadoEn:null`) es
*load-bearing*: relajarlo vacía la aserción en silencio.

**Un hallazgo del pipeline que vale registrar:** `tsc -b` cazó que ese fixture nuevo no llevaba
`precioModelo` ni `precioModeloDeCompra` —copiado de uno más viejo que el tipo—. **Las pruebas pasaban en
runtime con el fixture incompleto**; el único que lo vio fue el typecheck. Es la cicatriz del 14-ago otra
vez, y la razón de que el fixture **no lleve ningún `as`**: así `tsc` lo valida estructuralmente.

**El residuo, dicho y no tapado:** nada obliga a un renglón por llamada, y las cercas de prueba son por
testid y por redacción — un botón con otras palabras que hiciera N firmas por renglón pasaría verde. Es el
límite honesto de una cerca de pruebas, está escrito en §Post-F9.80, y **volver a ofrecerlo con un botón
sería re-tomar la decisión de Daniel, no aprovechar un hueco.**

---

## V1-E3m · El proveedor del material ⭐ (20-ago-2026)

> Daniel, con toda la receta liberada, en `Compras › Explosión de Materiales`: *"no me deja hacer nada… ahí
> veo todo, pero no puedo avanzar"*. El botón «Generar OC» solo se enciende con renglones que traigan
> **proveedor sugerido**, y ninguno lo tenía. Decisión en `DECISIONES.md` **§Post-F9.82**.

### ⭐ El hallazgo: no faltaba una función, había una DESVIACIÓN

**La regla de las telas ya estaba en el modelo de datos y el motor de compras la ignoraba.**
`Tela.idProveedor` existe desde §Post-F9.11 con la regla de Daniel escrita en su propio comentario —*"la
felpa de Alsatex y la de otro proveedor son telas DISTINTAS"*—, pero **F8 agregó `TelaProveedor`** (precios
por proveedor, para material que se compra a varios) y la resolución del MRP se fue por ahí. Sin ese amarre
—que casi ninguna tela tiene— el motor se rendía. Por eso el sistema le pedía a Daniel capturar un
proveedor **que la tela ya tenía**, y por eso *"no veo dónde se le asigna"*: buscaba lo que ya estaba puesto.

Eso hace la etapa barata: **corregir la desviación**, no rediseñar.

### Qué entrega

1. **TELA — el motor resuelve por el proveedor DUEÑO.** Cascada: `amarre de Desarrollo → DUEÑO de la tela →
   asignación de Compras`. Su precio sale de su renglón negociado (`TelaProveedor`) si lo tiene y, si no,
   del precio de **REFERENCIA** de la tela — que es otra cosa, y por eso **se avisa** (`Tela.precioSugerido`
   es lo que Daniel vio rotulado «referencia», uno en $0.00).
2. **AVÍO — proveedor HABITUAL, no «el más barato».** Bandera `AvioProveedor.habitual` (uno por avío,
   garantizado por un **índice único parcial** en la base). Cascada: `amarre → HABITUAL → más barato → 
   asignación de Compras`. **El más barato NO se retira**: queda de fallback para el avío que nadie ha
   marcado. ⚠️ **Alcance exacto:** ningún avío con **varios** proveedores cambia de comportamiento; el de
   **uno solo** sí lo toca el backfill (y con precio da la misma respuesta que el "más barato" — sin
   precio es donde de verdad cambia: deja de salir sin proveedor).
3. **El proveedor propuesto es SUGERENCIA, no atadura.** *"Sí puede cambiar la tela con todo y su proveedor
   a la hora de comprar. Lo mismo en avíos"* — eso ya vivía en la OC, que nace en `borrador` y es editable;
   esta etapa no lo toca y **no** convierte la sugerencia en amarre.
4. **⭐ El comprador desatora desde SU pantalla — solo para esa OP.** «Asignar proveedor» en el renglón
   (proveedor + precio opcional), guardado en `OrdenTela/OrdenAvio.idProveedorCompra`. **Jamás toca el
   catálogo.**
5. **El botón apagado DICE qué le falta, con los nombres.** *"3 materiales sin proveedor: …"* — era
   exactamente el defecto que V1-E3i arregló en el importador (*ofrecer una puerta y no explicar por qué no
   abre*, §Post-F9.70 punto 3) y aquí había quedado igual.

### La decisión de diseño que sostiene todo: la asignación de Compras va HASTA ABAJO

Daniel fue textual: *"el comprador asigna un proveedor **para esa OP en particular**… no para siempre ni
para todo. **El proveedor puede seguir viniendo desde desarrollo**"*. Ponerla en el ÚLTIMO escalón cumple esa
frase **en el motor**, no en un comentario:

- **no puede pisar a Desarrollo ni al catálogo** — solo se usa donde hay hueco, que es el caso que vino a
  desatorar;
- si mañana Desarrollo amarra un proveedor, **Desarrollo gana solo**, sin que nadie tenga que acordarse de
  borrar la asignación de urgencia;
- y esa asignación que quedó sin usarse **no se calla** (D3): la explosión la nombra en un aviso
  («Compras había asignado a X… ya NO se usa porque…»), con el camino para quitarla.

**Corolario en la UI:** «Asignar proveedor» se ofrece **solo** donde no hay proveedor (o para corregir lo
que Compras ya puso). Donde el proveedor viene del catálogo o de Desarrollo, se cambia **en la OC** — cada
frase de Daniel tiene UN mecanismo y no se pisan.

### Por qué una BANDERA en `AvioProveedor` y no un `Avio.idProveedorHabitual`

El habitual tiene que ser uno de los que **de verdad** surten el avío: en el par avío–proveedor lo es por
construcción, y trae consigo su `precio` y su `factorConversion` —justo lo que el MRP necesita para proponer
precio sin un segundo viaje—. Un FK suelto en `Avio` podría apuntar a un proveedor **sin renglón** (sin
precio ni factor) y habría que validarlo a mano en cada escritura. El riesgo del otro lado —dos
habituales— lo cierra la **base** con `CREATE UNIQUE INDEX … ON avio_proveedor(id_avio) WHERE habitual`.
Mismo patrón que `DireccionEntrega.favorita`. ⚠️ Consecuencia de construcción: al mover el habitual de A a
B hay que **apagar antes de encender** (el índice se verifica por sentencia); tiene su prueba de integración.

### Precedencia, en una línea

`TELA: amarre de Desarrollo → dueño de la tela → asignación de Compras`
`AVÍO: amarre de Desarrollo → habitual → más barato (F4) → asignación de Compras`
El **amarre por modelo** (`ModeloAvio.idAvioProveedor`, que la orden congela) sigue mandando sobre el
habitual: es más específico —lo eligió una persona para ESE modelo— y es la autoridad de Desarrollo.

### Nota de cierre — ✅ HECHA (20-ago-2026)

Migración `20260820120000_proveedor_del_material` (3 columnas + 1 índice único parcial + 2 FK), **sin
permisos nuevos y sin seed** → el deploy a `prueba` NO exige `SEED_ON_START`. Lleva **un solo backfill, el
que no decide nada**: el avío con **un único** proveedor **ACTIVO** queda con ése marcado como
habitual — no hay elección que hacer y es lo mismo que hace la pantalla al agregar el primero; los avíos
con varios proveedores **no se tocan** (ahí sí hay decisión de negocio, y la toma una persona). Reusa
`compras.administrar` (asignar/quitar en la orden) y `avios.administrar` (marcar el habitual).

**Dos vueltas: la primera RECHAZADA, la segunda APROBADA** (con una línea de prueba que el reviewer verificó
él mismo en las dos direcciones, así que entró sin tercera vuelta).

**⭐ El hallazgo que hace barata toda la etapa: la regla ya estaba escrita y el motor la ignoraba.**
`Tela.idProveedor` existía desde §Post-F9.11, con el comentario que dice literalmente la regla de Daniel
—*"la felpa de Alsatex y la de otro proveedor son telas DISTINTAS"*—. Al llegar F8 se agregó `TelaProveedor`
(precios por proveedor, para material que se compra a varios) y **la resolución empezó a ir por ahí**. Por
eso el sistema le pedía a Daniel capturar un proveedor **que la tela ya tenía**, y por eso *"no veo dónde se
le asigna"*: **buscaba lo que ya estaba puesto.** No fue rediseño: fue **corregir una desviación**.

**🔴 El defecto que valía el rechazo: el backfill marcaba habitual a proveedores DADOS DE BAJA.** Un avío con
un único proveedor inactivo pasaba de *"sin proveedor, desatóralo tú"* a **comprable con un proveedor
muerto** —y `crearOC` no valida `activo`—. Peor: **el botón «asignar proveedor» no se pintaba**, porque el
sistema creía que ya tenía uno. *Era el atorón de Daniel devuelto con otra forma, y metido en una migración
que nadie deshace.*

Lo instructivo es que **el coder ya había escrito la regla correcta a treinta líneas de distancia**:
`proveedor-de-orden.ts` rechaza asignar un proveedor desactivado, con este argumento textual — *"esto es una
elección que se está tomando AHORA, no una heredada que ya estaba tomada"*. **Un backfill es exactamente una
elección que se toma ahora.** Tenía la regla; no la aplicó donde también hacía falta.

**⭐ Y esta etapa rompió un límite que la tanda arrastraba: la integración SE PUEDE correr aquí, sin Docker.**
Postgres nativo (`initdb` + `pg_ctl`) + `prisma migrate deploy`. El coder corrió **98/98** y el reviewer lo
**reprodujo** por su cuenta. Eso verificó algo que `migrate diff` no mira: **que las migraciones aplican en
secuencia sobre una base virgen**, y que el índice parcial existe de verdad. Hasta hoy toda esa capa se subía
"a cargo del CI"; ya no hace falta.

**La prueba que mejor envejece de esta etapa**, y vale copiarla: el test del backfill **lee el SQL del archivo
de migración y lo ejecuta**, en vez de una copia. El reviewer lo comprobó con la mutación que a nadie se le
habría ocurrido — **renombró un comentario del `.sql`** y la prueba se puso roja. Una copia embebida se habría
quedado verde para siempre mientras la migración real cambiaba debajo.

**⚠️ Un incidente que el coder confesó y que vale como regla:** su script de mutación **murió entre mutar y
restaurar**, dejando `proveedor-de-orden.ts` con un `if (false)` que **desactivaba la validación de proveedor
inactivo**. Lo cazó un `grep`, **no la suite** — ninguna prueba lo habría notado hasta la corrida siguiente.
*Un mutador que muere a medias deja el código roto en silencio*: van con `finally`, sin tope de tiempo, y con
verificación del árbol al terminar. El reviewer barrió residuos por su cuenta y salió limpio.

**Lo último que faltaba, cazado por el reviewer:** `proveedorSugeridoInactivo` **no tenía cobertura de
backend** — mutarla a `false` fijo dejaba **62/62 en verde**, porque el único test que la tocaba era de
frontend **con el payload mockeado**: probaba que el chip se pinta, no que el servidor lo diga. Si el backend
la regresara, el botón «asignar otro» **desaparecería en silencio del único renglón donde urge**.

### Nota de la SEGUNDA VUELTA (rechazo del reviewer) — tres defectos, todos reales

1. 🔴 **El backfill marcaba habitual a proveedores DADOS DE BAJA.** Con un solo `AvioProveedor` apuntando
   a un proveedor inactivo, el renglón pasaba de *"sin proveedor"* (el "más barato" sí filtra activos) a
   **comprable con un proveedor muerto**: `candidatoHabitualAvio` conserva al inactivo a propósito y
   `crearOC` no valida `activo`. **Y el comprador no podía repararlo** — el botón nuevo no se pintaba
   (había proveedor) y el catálogo no deja guardar con un proveedor desactivado. Era **el atorón de Daniel
   devuelto del revés, en una migración que nadie iba a deshacer**. Se contradecía, además, con el propio
   dominio de la etapa: `proveedor-de-orden.ts` **rechaza** asignar un proveedor de baja porque *"es una
   elección que se toma AHORA"* — y un backfill es exactamente eso. Fix: `AND EXISTS (… AND p."activo")`.
2. 🔴 **`precioFijado` no tenía ninguna prueba.** El único test que lo tocaba afirmaba el precio en un
   escenario **sin compra previa**: pasaba igual con el guard quitado. Se agregó el par completo (con
   compra vieja a $40: con precio tecleado gana 1.25; sin precio tecleado gana 40).
3. 🔴 **La documentación afirmaba lo que la propia migración desmentía** (*"ningún avío existente cambia"*,
   en tres archivos). Acotado a *"ningún avío con varios proveedores"*, y el backfill documentado en
   `docs/modulos/compras-mrp.md`, que ni lo mencionaba.

**Y dos deudas cerradas en vez de anotadas:** (a) la explosión **ofrece reasignar cuando el proveedor
propuesto está de baja** (`proveedorSugeridoInactivo` + chip en la fila) — antes el aviso no tenía salida;
(b) la UI del catálogo **deja QUITAR el habitual**, no solo moverlo, que es lo que el backend, el contrato
y la base ya soportaban.

**Cómo se verificó, sin Docker:** el backfill y toda la batería de integración corrieron contra un
**Postgres 16 nativo** (`initdb` + `pg_ctl`, cero contenedores) con las migraciones reales aplicadas. La
prueba del backfill **lee el SQL del archivo de migración** y lo ejecuta: no es una copia, así que aflojar
el `WHERE` la pone en rojo. **8 mutaciones sobre el motor y el SQL, 8 cazadas** — incluida *"la asignación
de Compras escribe en el catálogo"*, que cae con nombre y apellido.

**Lo que quedó FUERA a propósito, dicho y no tapado:** la cascada compartida de PRECIOS
(`costos/resolucion-precios.ts`) **no se tocó**. El precosteo de F8 sigue valuando el avío sin amarre con
«el más barato»; el MRP es quien cambia de política de COMPRA. Se separaron a propósito: `resolverPrecioAvio`
responde *"¿cuánto cuesta?"* y esta etapa responde *"¿a quién le compro?"*. La consecuencia real es que un
avío cuyo habitual NO sea el más barato se **comprará** más caro de lo que se **precosteó** — no en
silencio (es el precio del proveedor que se eligió, visible en la línea de la OC), pero conviene decidir
más adelante si el precosteo debe seguir al habitual. **Ningún precosteo existente cambia** (la bandera
nace en `false` y las columnas nuevas en NULL).

---

## V1-E3n · Modelos de DESARROLLO vs. de PRODUCCIÓN ⭐ (20-ago-2026)

> Daniel, probando: *"se supone que tenemos modelos de desarrollo y modelos de producción. En la última OP
> que hice de pruebas (la 5558) heredó el modelo de desarrollo. Creo que habíamos acordado que el sistema
> iba a proponer un modelo de producción y yo solo lo confirmaría. Pero el modelo que quedó en la OP es el
> de desarrollo."*

**Tenía razón, y la explicación es que la decisión existía y NUNCA SE CONSTRUYÓ.** `DECISIONES.md`
**§Post-F9.34** (12-ago) la cerró entera y terminaba con *"Aplica en: **NADA todavía** — es decisión de
rumbo"*; **§Post-F9.46** (15-ago) la corrigió en un punto (el nº de producción **sí se precarga**), y
**§Post-F9.83** (20-ago) cerró la última duda: *"el concepto y género van FIJOS y los consecutivos
disponibles son los otros 3"*.

### Qué entrega

1. **La marca y la numeración se separan; la TABLA no.** `Modelo.origen` (`desarrollo` | `produccion`) +
   `Modelo.codigoDesarrollo`. Un modelo de desarrollo necesita lo mismo que uno de producción (BOM, arte,
   fotos, precosteo), así que duplicar la entidad habría duplicado todo eso.
2. **`Cliente.abreviatura`** — el `CYA` del código, único entre clientes. No existía.
3. **Serie propia de desarrollo `CYA-26-71-001`**, armada ENTERA por el sistema (cliente + año de ENTREGA
   + concepto/género + consecutivo por secuencia atómica **global**), que **no consume** consecutivo de
   producción. El código se **congela** al nacer.
4. **«Pasar a producción»** desde el catálogo **y** desde «Generar OP»: el campo llega **precargado** con
   el siguiente libre y **es editable** (§Post-F9.46). Repetido **bloquea**; dígitos que no cuadran y serie
   cerca del tope **avisan**.
5. **Catálogo y galería enseñan PRODUCCIÓN por default**, con desarrollo detrás de un filtro; el modelo
   promovido **conserva su nº de desarrollo** y los DOS son buscables (D3).
6. **Los dígitos son DATOS**, no constantes: `TipoProducto.digitoConcepto` y
   `Genero.digitoNomenclatura`/`digitoAlterno` (la continuación Caballero 1→5), sembrados con la tabla de
   Daniel de 2014.

### ⭐ Lo que la medición cambió: el consecutivo NO puede salir de una secuencia

A3 manda folios por secuencia atómica, y el de **desarrollo** lo cumple al pie de la letra (serie nueva,
arranca en 1, nadie más escribe: `secuencias_globales` + `siguienteFolioGlobal`). El de **producción no
puede**, y esto se midió sobre los 4,987 modelos del Access: el par `51` tiene **535 usados de 999 y el
999 YA OCUPADO**; igual `20`, `30`, `39`, `73`, `74`. Una secuencia —que sólo sabe avanzar— propondría
`1000`, que no existe como modelo, y dejaría 464 números libres inalcanzables.

La propuesta es por eso **el hueco libre más bajo del par**, calculada dentro de un
`pg_advisory_xact_lock` del par (namespace 20_546): dentro del lock, elegir el hueco y escribirlo son un
solo hecho serializado, y el `@unique` de `codigo`/`numeroProduccion` queda de última red. Misma garantía
que la secuencia —nunca dos modelos con el mismo número— sobre una serie que la secuencia no modela.

### La redefinición que hubo que hacer, dicha en voz alta

`Modelo.numeroProduccion` **existía** desde el rediseño R3/B4, pero guardaba un consecutivo **global sin
significado** (`numero_produccion_seq`: 1, 2, 3…) que se minteaba solo al generar la primera OP — sin
cambiar el código del modelo ni sacarlo del catálogo de desarrollo. **Ése era el bug que Daniel vio.** La
migración la redefine como el entero de 5 dígitos y la rellena desde el código (`^\d{5}$`): 4,702 de los
4,987 migrados lo cumplen; los otros 285 (`51783a`, `71240-1`, `M-18`) se quedan en NULL a propósito y no
ocupan consecutivo. Los valores viejos se limpian, **no en silencio**: cada minteo quedó en la `bitacora`
(`Orden`/`OTRO`/`datos.numeroProduccion`) y el módulo sólo había corrido en `prueba`.

### Ronda de corrección: tres caminos que la etapa dejaba rotos

El reviewer aprobó el motor —incluida la desviación de A3, que **probó en vivo**: 20 promociones
concurrentes dan 20 números distintos con el lock y 2 éxitos + 18 conflictos sin él— y rechazó por lo que
la etapa dejaba **inalcanzable**:

1. **Faltaban dos conceptos de Daniel y el dígito no se podía capturar.** El seed traía 6 tipos con
   dígito y `Ropa interior` sin él; **faltaban Chamarra (8) y Gorra (9)** — 356 y 73 modelos en el Access,
   el **9 % del catálogo**. Y aunque `TipoProducto` tiene CRUD, sus esquemas no llevaban el campo: el
   combo de «modelo nuevo» ofrecía los tipos sin dígito y el alta reventaba con *"captúralo en su
   catálogo"* → **una pantalla que no tenía el campo**. Se cierra con `digitoConcepto` de punta a punta
   (contrato + dominio + ruta + diálogo + lista), Chamarra y Gorra sembradas **en el seed y en la
   migración**, el dígito **único entre tipos activos** (dominio + índice único parcial: dos conceptos
   con el mismo dígito se repartirían la misma serie de 999), y el combo enseñando **deshabilitados** los
   tipos sin dígito en vez de dejar que fallen al enviar.
2. **El default `origen: 'produccion'` escondía los modelos de desarrollo de 4 buscadores más.** El
   criterio *"se NAVEGA vs. se TECLEA"* estaba bien, pero aplicado a 1 de 5 llamadas: faltaban el buscador
   del **pre-costo** (precostear un modelo de desarrollo es el corazón de D13), la **liga manual** del
   importador de OC por PDF, **copiar receta** y —el más grave— el **combo del renglón del pedido**, que
   dejaba *inalcanzable por captura manual el camino que esta misma etapa construye*.
3. **El lock que sustituye a A3 no tenía una sola prueba.** Volverlo un no-op dejaba 40/40 en verde.
   Ahora hay dos pruebas de concurrencia (`Promise.all` de 20 promociones del mismo par → 20 números
   distintos y consecutivos, sin fallos; y 3 simultáneas sobre una serie hueca → rellenan 002/004/005),
   y mutar el lock a `SELECT 1` **las tira**.

En una segunda vuelta corta salieron tres remates más, y el primero vale como lección: **un comentario
que promete una cobertura que no existe.** La prueba del dígito repetido decía protegernos de que el
`catch` de P2002 *"culpara al nombre"*, pero pasaba por la **guarda del dominio** — mutar
`mensajeDeUnicidad` dejaba 37/37 en verde. Es el vicio de la tanda («el título afirma identidad, el
cuerpo comprueba presencia») mudado a la **justificación**. Se cerró con dos altas SIMULTÁNEAS del
mismo dígito —la única forma de llegar al `catch`, porque la guarda tapa cualquier intento
secuencial— más la simétrica del nombre, y el comentario ahora dice exactamente qué ejercita y qué no.
Los otros dos: las **cifras de las pruebas**, mal por segunda vez y contradiciéndose entre tres
documentos, y **media línea de despliegue** sobre el `ON CONFLICT` del alta de Chamarra/Gorra.

### Nota de cierre — ✅ HECHA (20-ago-2026)

**Tres vueltas: dos RECHAZADAS y la tercera APROBADA.**

**⭐ El hallazgo que corrige lo que Daniel reportó, y no era lo que parecía.** Yo le dije que la decisión
*"estaba decidida y sin construir"* —cierto, pero incompleto—. La causa real: `Modelo.numeroProduccion`
**sí existía**, pero guardaba un consecutivo **global y sin significado** (1, 2, 3…) que se minteaba al
generar la OP **sin cambiar el código del modelo ni sacarlo del catálogo de desarrollo**. El sistema creía
promover y no hacía nada visible. Eso es exactamente lo que vio en la 5558.

**⭐ Y el hallazgo que solo aparece MIDIENDO, no razonando:** sobre los 4,987 modelos del Access, el par
`51` tiene **535 usados de 999 y el 999 YA ocupado** (igual `20`, `30`, `39`, `73`, `74`). Una secuencia
—que solo avanza— propondría **1000**, que no existe como modelo, dejando **464 huecos inalcanzables**. Por
eso el consecutivo de producción sale del **hueco libre más bajo** bajo `pg_advisory_xact_lock` del par, y
**no** de una secuencia. Es una desviación de **A3** y tiene su **ADR-0018**, con la tabla de dónde SÍ y
dónde NO aplica la excepción. *El reviewer la aprobó probándola en vivo: 20 promociones concurrentes del
mismo par → 20 números distintos; sin el lock, 2 éxitos y 18 conflictos.* Y **reprodujo cada cifra** de la
medición contra el CSV: 4,987 / 4,702 / 285 / 61 pares / `{20,30,39,51,73,74}`. Exacta.

**🔴 Lo que valió el primer rechazo: la etapa dejaba rotos caminos que ella misma necesitaba.**

1. **Un callejón sin salida.** Faltaban los conceptos **8 (Chamarra)** y **9 (Gorra)** —**429 modelos, el
   9 % del catálogo real**— y `digitoConcepto` **no se podía capturar por ninguna pantalla**. El combo
   ofrecía tipos sin dígito y al enviar el sistema decía *"captúralo en su catálogo"*: **mandaba a una
   pantalla que no existía**. Se cerró de verdad —no solo permitiendo capturarlo, sino **deshabilitando
   con su motivo** los tipos sin dígito (§Post-F9.68: se ve, no se usa)—.
2. **Una regresión de la propia etapa.** El default `origen: 'produccion'` **escondía los modelos de
   desarrollo de cuatro buscadores**, entre ellos el del **pre-costo** (el corazón de D13) y el combo del
   renglón del pedido — *sin ese último, «generar OP promueve el modelo» era inalcanzable por captura
   manual*. Lo notable: el coder **tenía el criterio correcto y lo escribió** (*"se NAVEGA vs. se TECLEA"*)
   pero lo aplicó en **1 de 5** llamadas.
3. **El lock que sustituye a A3 no tenía una sola prueba**: mutarlo a no-op dejaba **40/40 en verde**.

**⚠️ Y el remate final es la lección de la tanda mudada de sitio: un comentario que promete una cobertura
que no existe.** Los comentarios de `calidad.int.test.ts` afirmaban que esa prueba protegía el `catch` de
P2002 (*"culpar al nombre mandaría a corregir el campo equivocado"*), pero la prueba pasaba por la **guarda
del dominio** — mutar el mensaje para que culpara siempre al nombre dejaba **37/37 en verde**. *El vicio ya
no está en el título de la prueba sino en su justificación, que es donde nadie lo busca.* Se cerró con dos
pruebas de `Promise.allSettled` que sí entran al `catch`, cada una asertando el mensaje exacto **y que no
menciona el otro campo**.

**Dos cicatrices que se repitieron, ahora del lado de quien revisa:**

- El bucle de mutación **del reviewer** murió con el reinicio del contenedor **entre mutar y restaurar** y
  dejó `PreCostoPagina.tsx` con el valor volteado — *justo el que hace desaparecer los modelos de
  desarrollo del pre-costo*. Lo reparó y lo dijo. 🔴 **Y lo que lo vuelve importante: el barrido de
  residuos NO puede cazarlo** — no es basura, es **un valor válido cambiado por otro válido** dentro de un
  archivo que ya estaba modificado. `grep` de `if (false)`/`// MUT`/`.only` pasa limpio. Al recuperar un
  agente muerto hay que **mirar el `git diff` de lo que tocó**, no solo buscar marcas.
- **Las cifras de la ficha salieron mal DOS veces** —y la segunda se contradecían entre tres documentos—.
  Regla que queda: *las cifras se copian de la salida `Tests N passed`, archivo por archivo, nunca de
  memoria ni contando `it(`*.
- 🔴 **Y la tercera, al ir a comitear: el coder reportó «los ocho comandos en 0» y `npm run lint` del
  backend estaba en ROJO** —`no-unnecessary-type-assertion` en `calidad.int.test.ts:245`, o sea **dentro
  del remate que acababa de escribir**—. Lo cazó el lead corriendo los gates antes del commit; de haber
  ido tal cual, el CI se caía. *La lección no es «valida con los `npm run`» —eso ya estaba escrito— sino
  la de al lado: **el reporte final se emite DESPUÉS de la última edición, no antes**. Quien remata
  vuelve a correr los ocho, aunque el remate «no toque lógica».* Se cerró quitando el `as` (el `find`
  con predicado ya estrecha el tipo) y re-corriendo lint/typecheck/format en verde.

- **Migración** `20260820160000_modelos_desarrollo_vs_produccion`, validada con `prisma migrate diff`
  contra un Postgres nativo. Aditiva salvo la redefinición de arriba. Trae un **CHECK** (un modelo de
  desarrollo no puede tener nº de producción) y un **índice único parcial** del `digito_concepto` entre
  tipos activos. **Sin permisos nuevos**; el seed sí cambia (dígitos de géneros y tipos de producto) →
  el deploy a `prueba` quiere `SEED_ON_START=true`, aunque la migración ya siembra los dígitos de los
  catálogos existentes por nombre.
  ⚠️ **Un detalle del despliegue:** el alta de *Chamarra* y *Gorra* va con `ON CONFLICT ("nombre") DO
  NOTHING`, así que **si `prueba` ya tiene un tipo con ese nombre capturado a mano, la migración lo
  salta y ese tipo se queda SIN dígito**. No corrompe nada —el generador lo dirá con su nombre en vez
  de inventar un número— y `SEED_ON_START=true` se lo pone; si no, se captura desde
  Calidad › Tipos de producto.
- **Backend:** `dominio/modelos/nomenclatura.ts` (motor completo), `pasarModeloAProduccion`,
  `crearDesarrolloConModeloNuevo` (una sola transacción), `salidaAProduccion` promoviendo de verdad,
  filtro de origen + búsqueda por los dos códigos, `siguienteFolioGlobal` en `comun/secuencias.ts`.
  Endpoints nuevos: `GET /api/modelos/:id/propuesta-produccion`,
  `POST /api/modelos/:id/pasar-a-produccion`, `POST /api/proyectos/:id/desarrollos/modelo-nuevo`.
- **Frontend:** abreviatura en el cliente, chips de origen + segundo código + acción «Pasar a producción»
  en el catálogo, filtro de origen en la galería, campo precargado en «Generar OP», y el alta de
  desarrollo que **ya no pide el código**.
- **Pruebas** *(cifras copiadas de la salida de cada corrida, archivo por archivo — la cuenta se
  equivocó dos veces antes)*: **13** unit de las reglas puras · **43** de integración del motor
  (`nomenclatura.int.test.ts`: hueco libre, encadenamiento Caballero 1→5, tope, promoción,
  no-regresión de receta/arte/fotos/órdenes, minteo del código de desarrollo, unicidad cruzada de los
  dos códigos, filtro y búsqueda, A9 y permisos, chamarra/gorra de punta a punta, y **2 de
  CONCURRENCIA del lock**) · **12** de la salida a producción · **8** agregadas al de Calidad (el seed
  real de los nueve conceptos, el dígito y **las dos direcciones del `catch` de P2002**) ·
  **27** de front (**20** en cuatro archivos nuevos —`DialogoPasarAProduccion` 6, `PanelGenerarOP` 4,
  `DialogoTipoProducto` 5, `origen-buscadores` 5— y 7 agregadas a los existentes). La integración se
  corrió aquí contra **Postgres nativo** —138 archivos / 2068 pruebas—, no se dejó al CI.
- **Queda fuera (dicho, no callado):** no se agregó e2e de la promoción, y el dígito de NOMENCLATURA del
  GÉNERO sigue sin pantalla (el del tipo de producto sí la tiene desde la ronda de corrección; `Genero`
  es un catálogo selector sin ABM desde F1 y abrirle uno excede la etapa — un género nuevo nace sin
  dígito y el motor lo dice **con su nombre** en vez de inventarlo).

---

## V1-E3q · La compra desde la explosión ⭐ (20-ago-2026)

> Daniel, probando en vivo: *"acabo de hacer unas OC desde la explosión de materiales… Dice que se
> generaron las OC, pero no se ven reflejadas en las OC. No veo dónde se generó. No sé si realmente se
> generó o solo dice eso, porque **me vuelvo a meter en la pantalla y sigue apareciendo ahí los elementos
> y me deja volver a hacerla**. Creo que hace falta trabajar en ese proceso."*
>
> Y su petición: *"Me gustaría que al darle «generar OC desde la explosión», te mande a una pantalla
> previa, antes de generar la OC. **Una revisión previa es indispensable**."*
>
> Y, en la misma sesión: *"¿Cómo hacemos cuando una OC cubre varias OP? Es muy muy común hacerlo.
> **Normalmente compramos varias OP con una sola OC.**"*

Decisiones: **§Post-F9.85** y **§Post-F9.86**. Las tres piezas van **juntas** porque se sostienen entre
ellas: una revisión previa **sin** el neteo volvería a enseñar como pendiente lo ya comprado, y el neteo
sin el reparto por OP no cuadraría en cuanto la compra cubra dos órdenes.

### Qué entrega

**(a) La revisión previa — `POST /api/explosion/previo`.** Enseña, **antes de comprometer nada**: qué OC
va a salir, a qué proveedor, con qué renglones y cantidades, **de qué OP es cada cantidad**, con qué
fecha de entrega y por cuánto; y **lo que se va a OMITIR, con su razón dicha con letras**
(`sin-proveedor` · `ya-en-oc` · `cubierto-por-stock` · `no-seleccionado` · `sin-cantidad`). Hasta hoy los
renglones sin proveedor se descartaban **en silencio** y sólo se sabía después, contando las OC que
salieron — que es exactamente por lo que Daniel no sabía si su compra se había hecho.

> ⭐ **La previa y la generación son EL MISMO cálculo.** `planearCompra` es la única función que decide
> qué se compra; la previa la pinta y la generación la ejecuta. Una revisión previa que calculara por su
> cuenta sería una promesa que el sistema no cumple. Los **bloqueos** (falta la dirección favorita, falta
> la fecha de un proveedor) se **devuelven** en la previa y se **lanzan** al generar: mismo cálculo, dos
> maneras de reaccionar.

**(b) 🔴 No volver a comprar lo ya comprado — el defecto de fondo.** `comprometidoEnOc`
(`backend/src/dominio/compras/comprometido-en-oc.ts`) es ahora **la única verdad del sistema** sobre
*"cuánto de esto ya está en una OC"*. El cruce ya existía —enterrado dentro del tablero R7— y se **sacó**
para que el tablero, la explosión, la revisión previa y la generación lean **el mismo número**. Cada
renglón de la explosión sale con `cantidadEnOc` y `cantidadPendiente`, y **sólo lo pendiente se compra**.

> ⚖️ **Qué estatus cuentan como "ya comprado": TODOS menos `cancelada`** — y el `borrador` **SÍ cuenta**.
> Es el corazón del arreglo: la OC que genera esta misma pantalla **nace en borrador**, así que si el
> borrador no contara, el defecto seguiría vivo. `cancelada` no cuenta porque cancelar es la manera
> documentada de deshacer (D3): una OC cancelada deja de cubrir su material y éste vuelve a aparecer
> como pendiente.
>
> ⚠️ **NO es el criterio del COSTO, y es a propósito.** Para costear (`ultimo-precio-compra.ts`,
> §Post-F9.48) sólo cuentan `autorizada` y `recibida_*`, porque ahí la pregunta es *"¿qué precio pagó de
> verdad la empresa?"* y un borrador no es un precio pagado. Aquí la pregunta es otra: *"¿hace falta
> volver a comprar esto?"*. **Dos preguntas distintas, dos criterios distintos**, cada uno escrito donde
> se usa. Copiar el del costo sin pensarlo habría dejado el defecto exactamente igual.

**(c) Una OC para VARIAS OP.** El modelo **ya lo aguantaba entero** (`OrdenCompraLinea.idOrden` +
la liga N:N `OrdenCompraOrden`); lo que faltaba era **el camino**. La raíz era **qué pregunta hacía la
pantalla**: preguntaba *"¿qué necesita ESTA OP?"* y el comprador hace otra, *"¿qué necesito comprar
hoy?"*, que casi nunca cabe en una sola OP. Ahora el conjunto se llena de **dos maneras, con el mismo
control**: **precargado** con las OP del pedido interno (`GET /api/ordenes/:id/del-mismo-pedido` — los
avíos del 1515; las canceladas se listan pero **no** se precargan) o **a mano**, agregando OP sueltas con
el buscador (las cajas, que cruzan pedidos).

> ⭐ **Se ve junto, se guarda repartido** (innegociable de §Post-F9.86). La pantalla **agrupa** las
> cantidades por material+proveedor; la OC guarda **una línea por (material, OP)**, cada una con su
> `idOrden`. Sin ese desglose el *"qué tengo / qué falta"* de cada OP deja de cuadrar y el costo no cae
> donde debe.
>
> **El SOBRANTE de compra sí se reparte** (*"comprar el rollo completo es una decisión del comprador en
> el momento de comprar — es un hecho entonces"*): el comprador teclea el TOTAL y **el servidor** lo
> reparte entre las OP **en proporción a lo que cada una necesita**, con la última absorbiendo el residuo
> del redondeo para que la suma cuadre exactamente (`reparto-ordenes.ts`, función pura). La pantalla no
> reparte nada (A1).
>
> **El FALTANTE de la recepción NO se reparte** — propuesta del lead **tumbada por Daniel**: *"los
> consumos son estimados… a la hora de ir descargando las telas es cuando se va a poder saber a cuál
> aplica"*. No es contradicción: el sobrante es un hecho al comprar, el faltante es un dato que **todavía
> no existe** cuando llega el material. No se construyó nada de eso.

**Tres cosas más que salieron del mismo hilo:**

- **La fecha de la OC con varias OP es la entrega MÁS PRÓXIMA de las OP que surte** (no la más lejana:
  el material tiene que estar a tiempo para la que entrega antes). Sigue mandando la fecha por proveedor
  de §Post-F9.71 y la del formulario; ésta es el último respaldo.
- **El stock de avíos genéricos se REPARTE entre las OP del lote.** Si dos OP piden el mismo hilo,
  explotarlas por separado le daría a las dos la existencia completa y el sistema compraría de menos —
  un faltante silencioso en el material del que nadie lleva cuenta. Hay un ledger por lote y el orden es
  determinista (por folio ascendente: la OP más vieja, que se produce antes, se queda con el stock).
- **Lo omitido viaja también en el RESULTADO de generar**, no sólo en la previa.
- **La precarga corre UNA sola vez por OP base y los chips salen de lo que el usuario eligió**, no de
  la respuesta de la explosión. Los dos son la misma trampa vista de dos lados: si la consulta del
  pedido se refresca sola, un efecto que mirara la forma del conjunto **re-metería la OP que acaban de
  quitar**; y mientras la explosión se recalcula, su respuesta trae el conjunto ANTERIOR, así que
  pintar los chips desde ahí enseñaría OP quitadas y escondería las recién agregadas. Los dos casos
  tienen prueba.
- **El impreso PDF de la explosión pasó a enseñar lo PENDIENTE** en su columna *"A comprar"* (antes
  traía la demanda bruta). Un impreso hecho **después** de generar la OC decía *"compra 180"* de algo
  ya pedido — el mismo defecto de Daniel, pero en papel y sin nadie que lo contradiga. El *"Requerido"*
  no se tocó: sigue diciendo cuánto lleva la orden en total.

### Cómo quedó por dentro

| Pieza | Dónde |
|---|---|
| La verdad de "cuánto ya está en OC" | `backend/src/dominio/compras/comprometido-en-oc.ts` (**un solo lugar**) |
| El reparto entre OP (sobrante) | `backend/src/dominio/compras/reparto-ordenes.ts` (función PURA) |
| Explosión de un CONJUNTO de OP | `explosionarOrdenes` en `mrp.ts` (`explosionarOrden` = atajo de una) |
| El plan de compra (previa **y** generación) | `planearCompra` en `mrp.ts` |
| Endpoints | `POST /api/explosion` · `POST /api/explosion/previo` · `POST /api/explosion/generar-oc` · `GET /api/ordenes/:id/del-mismo-pedido` |
| Pantalla | `frontend/src/modulos/ordenes-compra/ExplosionMaterialesPagina.tsx` (chips de OP + paso de revisión) |

**Invariantes:** A1 (el frontend no decide nada: manda el total y el servidor reparte) · A2 (los
snapshots de todas las OP y todas las OC nacen en UNA transacción, o ninguna) · A3 (el folio sigue
saliendo de `crearOC`) · A4/§Post-F9.68 (la **revisión previa** exige `compras.administrar`, el mismo
permiso que comprar: es la primera mitad de la acción, no una consulta) · A9 (cualquier OP de otra
empresa → 404, y no se escribe nada) · D3 (nada se omite en silencio).

### 🔴 El RECHAZO del reviewer y lo que enseñó (21-ago-2026)

La primera versión de esta etapa **fue RECHAZADA**, y con razón: **el defecto que vino a arreglar
seguía vivo**. La aritmética del reparto corría a **4 decimales** y la columna donde acaban esos
números —`OrdenCompraLinea.cantidad`— es **`Decimal(14,2)`**. Nadie cerraba ese hueco, y el propio
comentario del módulo afirmaba lo contrario (*"la BD guarda cantidades con 4 decimales"*): **falso
para el destino real**. Tres síntomas, los tres MEDIDOS corriendo, no leyendo:

1. **El renglón REAPARECÍA** — la queja literal de Daniel. `0.1234 × 30 = 3.7020` → la línea guardaba
   `3.70` → quedaban `0.002` "pendientes", por encima de la tolerancia de `1e-6`, y el material
   volvía a salir comprable con el botón encendido.
2. **PEOR QUE ANTES: cadena de OC basura.** Cada vuelta creaba otra OC con la línea en `0.00`,
   **quemando un folio** (A3) por documento vacío. El defecto original al menos era visible (la OC
   duplicada llevaba las 180 piezas); éste se acumulaba en silencio.
3. **Σ(líneas) ≠ lo comprado.** 100 entre tres OP iguales guardaba `[33.33, 33.33, 33.33]` = `99.99`
   y la OC totalizaba `199.98` cuando la previa prometía `200.00`. **La revisión previa MENTÍA**, que
   es exactamente lo que §Post-F9.85 vino a impedir.

**Por qué las 84 pruebas no lo cazaban:** todas sus cantidades (180, 100, 80, 300, 400, 120) caen
exactas en 2 decimales, así que el viaje de ida y vuelta por la BD no perdía nada. **El fixture no
podía expresar el fallo.** Un suite entero en verde sobre un defecto vivo.

**Y un cuarto síntoma que el rechazo no nombraba pero es el MISMO defecto, en otra columna — la
previa mentía sobre el DINERO.** `OrdenCompraLinea.precio` es `Decimal(12,2)`, y el precio sugerido
sale de `precio ÷ factorConversion` (R1), que produce colas larguísimas (100 ÷ 3 = 33.333333…). Con
el precio largo la revisión previa prometía **5,999.99** donde la orden de compra guardaba
**5,999.40**. Se buscó al arreglar la cantidad, se midió, y se arregló en la misma vuelta: el precio
se lleva a la escala de su columna y el importe usa **la misma función** con la que `aCompraSalida`
deriva el subtotal de la línea.

**El arreglo — la escala manda desde el DESTINO:**
`ESCALA_CANTIDAD_COMPRA = 2` (y `redondearCantidadCompra` **se deriva de ella**, no la ignora) ·
lo PENDIENTE se calcula y se compara en esa escala · el reparto cierra la Σ **en esa escala**, con la
última OP absorbiendo el residuo · el corte de *"¿queda algo?"* es **media unidad del último dígito
guardable** (`0.005`), no `1e-6` · una línea que se guardaría como `0.00` **no se escribe**, y un
ajuste por debajo del mínimo **se rechaza diciendo por qué**.

> 🔴 **La lección, que no es sobre decimales:** *un número no está bien calculado hasta que está bien
> **guardado**.* La aritmética era correcta en memoria y el error apareció al cruzar a la columna. Y
> la segunda mitad: **un comentario puede mentir tan caro como el código** — el que decía "la BD
> guarda 4 decimales" es lo que hizo que nadie mirara la columna. Se arreglaron los dos.
>
> Y una tercera, del propio arreglo: la primera corrección dejó `ESCALA_CANTIDAD_COMPRA` **de
> adorno** (el redondeo llamaba directo a `redondear2`), así que cambiarla no cambiaba nada. Una
> constante que no gobierna lo que dice gobernar es **la misma clase de mentira**. Lo cazó el
> mutador, no la revisión.

### 🔴 La SEGUNDA vuelta del reviewer: la previa inventaba una OC (21-ago-2026)

El bloqueante de la primera vuelta murió, pero el arreglo abrió **una mentira nueva**, y de la peor
clase. Como `cantidadPendiente` llega redondeado a 2 decimales, **todo `aComprar` entre `1e-6` y
`0.005` daba pendiente 0** y caía en la rama `'ya-en-oc'` aunque **no hubiera ninguna OC**. Al
comprador se le decía:

> *"HIL-01 — Hilo **ya está en una orden de compra viva** para la orden 1 **(0 pza)**: no hace falta
> volver a comprarlo. **Si esa OC se cancela, vuelve a aparecer aquí.**"*

**No existía ninguna OC.** Se le mandaba a cancelar un documento inexistente, y la etapa se
contradecía a sí misma: el renglón de la explosión seguía marcado *faltante-parcial*. Se reproduce por
el camino de todos los días —un genérico neteado contra el kardex (decisión (d))— y con un
`consumoPorPrenda` de 4 decimales, que la columna admite.

**El arreglo: un motivo propio, `menor-al-minimo`**, y la rama `ya-en-oc` **exige que de verdad haya
algo en una OC** (`seGuardaComoAlgo(cantidadEnOc)`). Se eligió eso y **no** mover el corte antes de la
rama de `enOc`, porque eso habría metido en el mismo saco un caso REAL de *"ya está comprado"* y
**habría perdido información verdadera y útil**. Son dos hechos distintos y merecen dos frases distintas.

> ⚠️ **El ejemplo que lo demuestra es uno muy concreto, y conviene no equivocarlo** (lo cazó el reviewer
> en la 3ª vuelta: la primera redacción de este párrafo citaba *"requerido 3.7020 contra una línea de
> 3.70"*, que **NO discrimina** — ahí `seGuardaComoAlgo(3.7020)` es `true`, así que la variante
> descartada habría dicho `ya-en-oc` igual). El caso que sí separa las dos opciones es **un requerido
> POR DEBAJO del mínimo que YA está cubierto por una OC** (`aComprar 0.008` con una OC viva de `0.02`):
> ahí *"cortar antes"* habría dicho `menor-al-minimo` y **escondido que el material ya estaba comprado**,
> mientras que lo construido dice `ya-en-oc`.
>
> ⚠️ **Y esa prueba hubo que escribirla: no existía.** La ficha afirmaba que el caso *"tiene prueba
> propia"* citando *"…pero con una OC REAL detrás, sí dice ya-en-oc"* — pero **esa prueba usa
> `aComprar 3.7020`, por encima del mínimo, así que tampoco discrimina**. Se midió mutando el dominio
> con la variante descartada: la prueba citada quedaba **VERDE** y sólo la nueva —*"un requerido por
> DEBAJO del mínimo pero YA cubierto por una OC"*, con el BOM corregido a la baja después de comprar—
> se pone **ROJA**. La afirmación de la corrección era, ella misma, una promesa sin respaldo: la
> recursión completa de la etapa, en tres niveles (código → comentario → ficha).
>
> 🔴 **Y la lección de segundo orden, que es la de toda la etapa:** *una decisión correcta justificada
> con un ejemplo que no la demuestra es una promesa sin respaldo* — la misma familia del comentario que
> provocó el primer rechazo, sólo que en la ficha en vez de en el código.

> 🔴 **La lección: no basta con no callarse — hay que no mentir.** §Post-F9.85 nació porque Daniel
> dejó de creerle a la pantalla (*"no sé si realmente se generó o solo dice eso"*). Una revisión previa
> que afirma un hecho FALSO **es exactamente ese fallo**, aunque la decisión operativa que hay detrás
> (0.002 pza no se compran) sea la correcta. La lista de motivos sólo vale si **cada motivo es verdad**.

**Y la "una sola verdad" volvió a ser literal.** El redondeo de `enOc` estaba en **dos** de los tres
consumidores, así que el tablero R7 quedaba crudo: la explosión decía `0.3` y R7
`0.30000000000000004`. En pantalla no se veía; **en el JSON del API sí viajaba**. Ahora se redondea
dentro de `comprometidoEnOc` —la función que ES la verdad— y **lo RECIBIDO no se toca**, porque su
columna (`RecepcionCompraLinea.cantidadRecibida`) es `Decimal(14,4)` y recortarlo tiraría precisión
real. *Cada número a la escala de SU columna.* La prueba que comparaba los dos usaba `toBeCloseTo`
—una aserción laxa sobre una promesa estricta, incapaz de cazarlo— y pasó a comparación exacta.

### Verificación

- **102 pruebas de integración** de MRP en verde contra **Postgres nativo** (no se dejaron al CI), de
  las cuales **40 nuevas** cubren las tres piezas, los hallazgos de las DOS rondas de rechazo, el
  hueco del precio y la mentira del motivo. Unit: `reparto-ordenes.test.ts` (**17**). **45** pruebas de la pantalla (12 nuevas).
- Las cantidades de las pruebas nuevas están elegidas para que **el fixture pueda expresar el
  fallo**: `0.1234 × 30`, `100` entre tres OP iguales, `1000` entre bases 180/120/60, `0.1 + 0.2`.
  La Σ se pide a **Postgres con SQL** (`SUM` sobre la columna `numeric`), no a JavaScript: es la
  única manera de afirmar sobre lo que de verdad quedó escrito.
- **MUTACIÓN, 2ª vuelta: 10 muertas + 2 equivalentes probadas.** Mueren: repartir a 4 decimales otra
  vez · el redondeo ignorando la constante · la última OP sin absorber el residuo · lo pendiente sin
  redondear · quitar el filtro anti-línea-cero · quitar `idEmpresa` del neteo · `claveAgrupada` sin
  proveedor · el ajuste diminuto sin rechazar · `enOc` sin redondear · el desglose por OP.
  También mueren las dos del precio (el precio sin llevar a su escala y el importe sin la regla de la
  OC). **Equivalentes (no huecos), probadas como tales:** el corte `seGuardaComoAlgo` frente a `1e-6`
  —redundante mientras lo pendiente venga redondeado; con **las tres** guardas fuera la prueba sí se
  pone roja— y A9 de la revisión previa, sostenido en **tres** lugares (`planearCompra`,
  `exigirRecetaLiberada` y `exigirMaterialesLiberados`); con los tres fuera, roja.

### Nota de cierre

**SIN migración de esquema, SIN permisos nuevos, SIN seed** → el deploy a `prueba` **no requiere**
`SEED_ON_START`.

⚠️ **Contrato:** los dos endpoints viejos por orden única (`POST /api/ordenes/:id/explosion/generar-oc`)
**se retiraron**; la compra ahora viaja con `idsOrden` en el cuerpo. `POST /api/ordenes/:id/explosion`
se conserva como atajo de una sola OP.

⚠️ **PASOS MANUALES DE GABRIEL en `prueba`, que NO son código de esta etapa** (§Post-F9.85):
1. `npx tsx --env-file=.env migracion/reparar-secuencias.ts` — destapa las OC con folio 1, 2, 3… que
   Daniel ya generó y que el listado (ordenado por folio DESC) mandó a la última página.
2. Después, el salto de la serie de OC a **10001** (*"el sistema anterior va en la 8082; tenemos mucho
   colchón"*), que requiere que ese script acepte **salto a escalón**, no sólo `max+1`.

🔴 **Y la lección que Daniel dejó escrita con este defecto, que no es sobre el script:** el arreglo de
§Post-F9.17 estaba escrito y "listo" desde el **7-ago** y el defecto siguió vivo **trece días**, porque
dependía de un paso manual que nadie dio. **Un arreglo que necesita que alguien corra algo no está
terminado hasta que se corre.**

---

## V1-E3s · Recibir empieza por el proveedor ⭐ (21-ago-2026)

**Estado: ✅ HECHA (21-ago-2026)** · Decisión: `DECISIONES.md` §Post-F9.87 · Módulo:
`docs/modulos/compras-mrp.md`

### Por qué existe: la pantalla preguntaba al revés que la vida

Daniel, 21-ago-2026: *"en la recepción de orden de compra, debería de buscar primero por proveedor y
de ahí que muestre todas las OC abiertas de ese proveedor. **No tiene caso empezar por el número de
orden. En la realidad cuando vas a recibir algo, buscas al proveedor que llegó a entregar.**"*

Quien llega al almacén es el **proveedor**, con su mercancía. El número de OC es lo que hay que
**averiguar**, no lo que se sabe. Es el mismo error de altitud que §Post-F9.86 corrigió en la
explosión.

### 🔴 Y un defecto VIVO que Daniel no reportó, y que iba en la misma pantalla

El selector se armaba con **dos consultas de `porPagina: 100`** (una `autorizada`, otra
`recibida_parcial`) volcadas en un `<select>` plano. **Las OC que caían fuera del tope eran
INALCANZABLES** desde esa pantalla — no incómodas: inalcanzables, porque el `<select>` no busca en el
servidor. Es **la misma trampa del selector de colores** que V1-E4 ya había arreglado, repetida aquí.
Y **empeoraba sola**: cada OC nueva empujaba a las viejas fuera del tope.

### Qué entrega

1. **Primero el PROVEEDOR**, con búsqueda **en el servidor**. Se **reusó `SelectorProveedor`**
   (`modulos/cxp/SelectorProveedor.tsx`), que ya es *EL* selector de proveedor de toda la app sobre el
   `ComboboxBuscable` del kit (typeahead con debounce + anti-carrera). No se inventó otro combobox;
   lo único que se le agregó es un `deshabilitado` opcional (para §Post-F9.68).
2. **Luego sus OC abiertas** (`autorizada` + `recibida_parcial`) como **lista de filas elegibles**,
   cada una con lo que sirve para reconocerla en el andén: **número, fecha, estatus y qué trae
   pendiente** (*"1 de 2 renglones por recibir"* + los materiales que faltan, por nombre).
3. **Si el proveedor tiene UNA SOLA OC abierta, queda elegida sola** (con una sola opción no hay nada
   que escoger).
4. **El número de OC sigue sirviendo de ATAJO** para quien ya lo trae en la remisión: se busca por
   proveedor **o** por número. Los dos filtros están a la vista y **acotan juntos**, así que el
   resultado siempre se puede explicar mirando la pantalla — nada de filtros que se caen solos.
5. 🔴 **Sin topes silenciosos.** El servicio tiene tope (arrastrar el catálogo entero no ayuda a
   nadie) pero lo **DECLARA**: devuelve `total` (cuántas cumplen el filtro de verdad) y `truncado`, y
   la pantalla lo dice — *"Se muestran 50 de 300 OC abiertas. Escribe el número de la OC para llegar a
   las demás."* ⚠️ **La verdad completa sobre ese tope:** *navegando* no se pasa de él (no hay
   "siguiente página"); a las de más atrás se llega **por su número**, que es justo lo que el aviso
   ofrece. Es aceptable **sólo mientras el orden ponga adelante lo que importa** — ver el punto 6.
6. ⭐ **El orden es por CREACIÓN (`id desc`), NO por folio** — y esto no es un detalle de estilo. Hoy
   en `prueba` **el folio no es monótono con la creación**: los ETL dejaron las secuencias en cero, así
   que las OC nuevas toman folios 1, 2, 3… mientras las **~7,978 migradas** (que el ETL carga como
   `autorizada` **sin crear recepciones**, o sea **abiertas para siempre**) llevan folios altos
   (§Post-F9.85, cuyo arreglo es un paso **manual todavía pendiente**). Ordenando por folio, un
   proveedor con más de 50 OC históricas abiertas habría devuelto una página entera de historia
   dejando **fuera la OC que Daniel acaba de crear** — el defecto de esta etapa, de vuelta, con un
   número más chico. `id` crece con la creación, nunca es nulo, y **no depende de que alguien corra
   nada**.

### Cómo quedó por dentro

- **Dominio (A1):** `ocsRecibibles` en `backend/src/dominio/compras/recepciones.ts`. El pendiente lo
  calcula el **dominio**, con el **MISMO** criterio del estatus y del resto de la recepción
  (`faltantePorRecibir`, banda de tolerancia por tipo de material, §Post-F9.19) — **no** una
  derivación paralela. La pantalla no resta cantidades. Dos consultas por página (las OC + un solo
  `groupBy` de lo recibido para TODOS sus renglones), lectura pura sin locks.
- **API:** `GET /api/compras/ordenes-recibibles?idProveedor&numCompra&limite`, permiso `compras.ver`,
  acotado a la empresa activa (A9).
- **La OC elegida se pide POR ID** (`useOrdenCompra`, nuevo hook sobre el `GET /api/ordenes-compra/{id}`
  que ya existía). Ahí está la **raíz** del arreglo: la pantalla ya no depende de que la orden venga
  en alguna página de un listado, así que ninguna OC puede volverse inalcanzable por crecimiento del
  catálogo.
- ⚠️ **El dominio de recepción (`recibirCompra`) NO se tocó.** Esto es cómo se **ELIGE** la OC, no
  cómo se recibe.

### Verificación

- **Integración contra Postgres NATIVO** (sin Docker), no dejada al CI: **34 pruebas** del archivo de
  recepción en verde, de las cuales **12 nuevas** cubren el filtro por proveedor, el tope declarado, A9,
  solo-abiertas, el atajo por número, el pendiente por nombre, el permiso, **la banda de tolerancia**
  (96 de 100 ya está surtido), **el conteo de los materiales que no se nombran** (5 → 3 + 2) y **el
  orden por creación** (dos pruebas, con folios altos reetiquetados a mano para reproducir §Post-F9.85).
- **13 pruebas de la pantalla** (7 nuevas), y el suite completo del frontend en verde
  (**177 archivos / 1 369 pruebas**).
- **MUTACIÓN: 14 muertas, ninguna sobreviviente.** Backend (10): el tope de 50 bajado a 1 · ignorar el
  proveedor · quitar `idEmpresa` (A9) · `truncado` siempre false · quitar el filtro de estatus ·
  ignorar `numCompra` · **volver a `orderBy: numCompra`** —o sea: revertir el arreglo pone el suite en
  rojo, en dos pruebas— · **cambiar `faltantePorRecibir` por una resta cruda** (esto es lo que sostiene
  la afirmación central de la etapa) · `materialesPendientesMas` cableado a 0 · nombrar todos los
  materiales sin el corte. Frontend (4): el aviso de recorte nunca pintado · sin auto-elección · el
  atajo por número sin viajar al servidor · el proveedor sin viajar al servidor.
- **El instrumento se verificó antes de creerle**, en los dos sentidos: una mutación cosmética debe
  **SOBREVIVIR** con las 34/13 ejecutadas a la vista, y un sabotaje del `return` debe **MORIR**
  nombrando las rojas. El mutador exige que el patrón case **exactamente una vez** y que **empiece en
  principio de línea** —una ancla con sangría de 4 se colaba DENTRO de una línea con sangría de 8
  (`estatus: { in: [...] }` aparece dos veces en el archivo), el md5 cambiaba y el mutante *parecía*
  sobrevivir—, **imprime el diff aplicado** para ver qué línea cambió de verdad, exige **nombres de
  pruebas rojas** para dictar *muere* (un `Killed` por OOM deja 0 ejecutadas → `INSTRUMENTO-ROTO`,
  nunca *muere*), cuenta **ejecutadas = passed + failed**, restaura en `finally` y comprueba **md5
  contra HEAD**.

### Nota de cierre — ✅ HECHA (21-ago-2026)

**SIN migración de esquema, SIN permisos nuevos, SIN seed** → el deploy a `prueba` **no requiere**
`SEED_ON_START`. El endpoint nuevo es aditivo (`compras.ver`, que ya existía).

⚠️ **Cambia la pantalla que Gabriel verifica:** el `<select>` «Orden de compra» **ya no existe**. Ahora
se teclea el proveedor, salen sus OC abiertas como lista, y se hace clic en la que llegó. Los
`data-testid` de la selección cambiaron (`rec-oc` → `rec-proveedor` / `rec-num-oc` / `rec-oc-{id}`);
ningún e2e los usaba (el único que menciona la Recepción es `login.spec`, y sólo por el nombre de su
entrada en el riel, que no se tocó).

⚠️ **La pantalla NO queda limpia del patrón, y hay que decirlo:** el `<select>` de **almacén destino**
sigue alimentado por `useAlmacenes({ porPagina: 100 })` — el mismo patrón que el aprendizaje de abajo
declara defecto latente. Hoy no muerde (el catálogo de almacenes es diminuto y no crece), así que no se
tocó en esta etapa; pero queda **anotado, no barrido**.

🔴 **La lección que deja, y que ya va tres veces:** el `<select>` topado a 100 se arregló en el BOM
(V1-E3c), en clientes (V1-E4), en arte y materiales (V1-E3f) — y seguía vivo aquí. **Un desplegable
que se llena con una página del catálogo es un defecto latente, no una comodidad**: el día que el
catálogo rebasa el tope, lo que ya existe se vuelve inalcanzable y nadie se entera. Cuando aparezca
otro, el arreglo ya está escrito: `SelectorProveedor` / `ComboboxBuscable` en modo `busquedaServidor`.

---

## V1-E3r · Curvas de talla ⭐ (21-ago-2026) — ✅ HECHA

> **Decisión que la manda:** `Documentacion_MJD/DECISIONES.md` **§Post-F9.81** (con §Post-F9.64 detrás:
> *la curva es una GUÍA, no una jaula*).

⚠️ **Esta etapa es una RECONSTRUCCIÓN.** Se construyó entera una primera vez y se perdió con un reinicio
del contenedor (39 archivos sin comitear; el código no sobrevivió en ningún lado). Lo que **sí** sobrevivió
fue el **veredicto del reviewer**, con los siete defectos que le había encontrado — así que la
reconstrucción arrancó **ya corregida** en esos siete puntos, y las pruebas se escribieron para que ninguno
pueda volver sin ponerse rojo. La lección operativa quedó aplicada desde el primer minuto: **comitear en
cuanto hay algo que funciona**, en la rama de trabajo, que no mergea nada ni se salta al reviewer.

### De dónde sale: Daniel corrigiéndose a sí mismo

Daniel, capturando el consumo por talla de un avío: *"me da la curva diferente a como la di de alta… yo le
puse la curva de la XCH a la XG y en «recetas por liberar» me pone tallas de bebés"*. Y acto seguido:
*"perdón… creo que el error es mío. Yo di de alta el modelo a partir de una OC de C&A que es de bebés, y
cuando hice la receta le puse tallas de caballeros. **Mi información de pruebas es incongruente.** Pero
entonces, ¿de dónde toma las tallas realmente?"*.

**El sistema no tenía un defecto de cálculo** —tomaba las tallas de donde debe, de la matriz de la ORDEN—.
Tenía uno peor: **dejó capturar dos curvas que se contradicen sin decir ni media palabra**, y desde afuera
eso es indistinguible de un error de cálculo.

### Qué entrega

**(a) El aviso de curva distinta.** Cuando la curva del modelo y las tallas de la orden no coinciden, se
**AVISA** con los **nombres de las dos curvas** y **qué tallas sobran o faltan, en las dos direcciones**.
Sale en los tres lugares donde se ven las dos a la vez: la **captura de medidas por talla del avío** (donde
Daniel lo encontró), la **receta de la OP** y la **ficha del modelo**.
🔴 **JAMÁS BLOQUEA** — Daniel eligió *"que me diga"* sobre *"que no me deje"*.
🔴 **Lo redacta el SERVIDOR** (A1): la pantalla no arma la frase, no resuelve el singular/plural y no
ordena las etiquetas. Si lo hiciera, la receta y la ficha acabarían diciendo cosas distintas del mismo
desajuste — que es exactamente el problema que la etapa vino a matar.

**(b) Jalar la curva de la OP cuando el modelo no tiene.** Se **PROPONE y la persona confirma**: asignar
la curva escribe en el catálogo y de ahí la heredan el precosteo (D13), las medidas por talla del BOM (R18)
y la matriz de la siguiente OP (D3). **Si varias OP usan curvas distintas se enseñan TODAS**, con cuántas
OP usa cada una y sus folios: una regla de desempate inventada ("la más reciente") fallaría **en silencio**
justo en el caso que dio origen a la decisión. La puerta **sólo llena huecos**: rechaza si el modelo ya
tiene curva, y el conjunto confirmado se **re-valida** contra los propuestos.

**(c) El ORDEN de las tallas.** `Talla.orden` valía **0 en todo lo migrado** —el ETL llama a
`crearTalla(sesion, { etiqueta })` sin `orden`— y el desempate caía en la etiqueta: *CH, G, M, XG*. Dos
mitades: **tapar el hueco** (`crearTalla` DEDUCE el orden cuando nadie lo da) y **reparar los datos ya
cargados** (en el **seed**, idempotente y sólo sobre el sentinela `orden = 0`).

### ⭐ Lo que la MEDICIÓN cambió del diseño

La escala **no se inventó: se midió** sobre `Respaldo CLAUDE/TABLAS/Ordenes.csv` (columna `Tallas`, ancho
fijo de 2, **CP850**), con el parser real del ETL (`migracion/comun/tallas.ts`).

⭐ **La medición es un SCRIPT, no una cita:** `backend/migracion/analisis/medicion-orden-de-tallas.ts`.
Cada número de esta sección sale de correrlo, y se vuelve a sacar con un comando en vez de re-copiarse
(cómo correrlo — incluido rescatar el volcado del historial, porque ya no vive en el árbol — está en su
TSDoc). Es la respuesta al defecto 1 de la ronda de corrección: la primera versión publicó cifras a mano,
no se reproducían, y el módulo llegó a contradecir a su propia prueba.

| Medida | Número |
|---|---|
| Renglones | **5,451** (5,450 con `Tallas` no vacío) |
| Cadenas raras (dos curvas pegadas con `--`, saltos de línea, longitud impar) | 17 distintas / **67 órdenes** — el loader nunca las cargó |
| **Universo** de la medición | **5,383 órdenes** |
| Etiquetas distintas | **101** contando la caja → **94** filas `Talla` reales (el ETL dedupe sin distinguir mayúsculas) |
| Combinaciones distintas | **161** |

⚠️ **161 y no 164.** Contando la caja salen 164, pero `ch-m-g-eg` y `CH-M-G-EG` **no crearon curvas
aparte**: el loader busca la curva con `mode: 'insensitive'`. Publicar 164 junto a las «94 filas `Talla`»
era mezclar las dos formas de contar en la misma frase — el script ahora imprime las dos, con la
advertencia, para que no se vuelva a colar.

Tres hallazgos mandaron el diseño, y los tres son contraintuitivos:

1. **Los NÚMEROS van ANTES que las LETRAS.** De las combinaciones que mezclan las dos familias y la escala
   reconoce enteras, **15 van número→letra** (309 órdenes: `2-3-3X`, `12-14-16-CH-M-G-EX-2X`…) contra **1
   sola al revés** (`CH-M-G-EX-38-42`, 2 órdenes). Contando también las que traen alguna etiqueta sucia son
   **19 / 333** contra la misma **1 / 2**: el veredicto no depende de dónde se corte. Por eso las letras
   arrancan en `BASE_LETRAS = 1000`.
2. **Los MESES y los AÑOS caen en la MISMA recta numérica**, convertidos a meses. Es lo que hace que
   `3M-6M-9M-12-18-2A-3A` (57 órdenes) salga bien con la **misma** regla que `4-6-8-10-12-14-16-18` (22
   órdenes): en la primera el `12` y el `18` YA son meses, y `2A`/`3A` son 24 y 36.
3. **`3X` es LETRA**, no número — y eso es lo que la hace acertar en sus **dos** familias: entre puros
   números (`2-3-3X`, **252** órdenes) queda al final porque las letras van después; entre letras
   (`CH-M-G-EX-2X-3X`, **17** órdenes; **57** sumando todas las curvas de puras letras que la traen) queda
   en su peldaño. Leerla como "3" la habría mandado al principio de la primera.

**Resultado de la escala completa contra las 161 combinaciones reales:** **130 combinaciones = 5,311
órdenes = 98.7 %** del universo quedan monótonas; **26 combinaciones / 58 órdenes** traen alguna etiqueta
que la escala no reconoce (`UT`, `MC`, `M.`, `G'`… data sucia, más el separador suelto de las cadenas que
son dos curvas pegadas); y **5 combinaciones / 14 órdenes** las desordena — **3** por traer la **misma
talla repetida** (`EX-CH-M-G-EX`, `CH-M-G-EX-CH-M-G-EG`, `M-G-EX-2X-3X-XC-CH-M`: no hay orden posible, la
cadena está mal) y **2** fallas de diseño reales: `CH-M-G-EX-38-42` (2 órdenes, la combinación
letra→número) y `G-EX-2X-3X-M` (1 orden).

⚠️ **Lo que la escala NO reconoce se queda en 0** y sigue desempatando por etiqueta, como hoy. Inventarle
una posición a una etiqueta que nadie entiende sería afirmar algo que no se sabe (D3).

### Los SIETE defectos del reviewer de la versión perdida, y cómo quedaron

| # | Defecto | Cómo quedó |
|---|---|---|
| 1 | **A9**: la lectura de órdenes del modelo contaba órdenes de OTRA empresa | `idEmpresa` **obligatorio sin default** en `curvasDeLasOrdenesDelModelo`, propagado a los **tres** caminos (ficha, medidas por talla, revalidación al asignar). El fixture monta **DOS empresas**: con una sola, quitar el filtro no cambiaría nada y el escenario no podría expresar la fuga. ⚠️ Matiz: el **catálogo** de tallas SÍ es global (ADR-0007); lo que no puede ser global es leer **órdenes** ajenas. |
| 2 | La puerta escribía el catálogo **en crudo** (`curvaTalla.create` suelto) | Llama a **`crearCurva(sesion, …, { tx })`**, su módulo dueño, con sus cinco reglas intactas (tallas activas, nombre único, posiciones 0-based, `creadoPorId` en los items, permiso). El nombre determinista que choca **se desambigua** en vez de reventar con un P2002 → 500. |
| 3 | La guarda de exactitud de la búsqueda de curva, **sin cobertura** | `curvaQueCubreExactamente` documenta por qué las dos condiciones son necesarias (`items: { every: … }` en Prisma es *vacuously true* para una curva vacía) y **la prueba usa una curva de CERO items**: con una de tres tallas el conteo la descarta sola y la mutación sobreviviría. |
| 4 | `orden = 0` capturado a mano **sí se pisaba** | El contrato exige **`min(1)`** y el 0 queda como sentinela puro. Espejo en el formulario: `min(1)`, el placeholder dice «se deduce de la etiqueta», y una talla con orden 0 abre el campo **vacío** (si pintara «0», guardar sin tocar nada lo mandaría de vuelta y el contrato lo rechazaría). |
| 5 | Un comentario con **justificación FALSA** sobre el orden de las comprobaciones | El comentario dice la verdad: las tres familias son **disjuntas por construcción** (`fullmatch` en los patrones numéricos), así que el orden **no es load-bearing** — se escribe así porque se lee mejor. |
| 6 | **Cifras mal** en la doc | Todas las de arriba salen de correr la medición sobre el volcado real, no de memoria. |
| 7 | Menores: `select` muerto, **N+1 dentro de la transacción**, singular/plural reimplementado en el cliente, `obtenerModelo` **después** de escribir | Sin `select` muertos; las curvas existentes de las sugerencias se resuelven con un `Promise.all` (no un `await` por grupo); el plural lo redacta el servidor (`cuantasTallas`) y hay prueba de ello; y la asignación **no llama a `obtenerModelo`** — devuelve una forma propia, para que un rol con sólo `modelos.administrar` no reciba un 403 sobre su propio cambio. |

### La RONDA DE CORRECCIÓN (21-ago-2026) — cuatro defectos más

Un reviewer independiente RECHAZÓ la etapa con cuatro hallazgos. Los siete de arriba siguen cerrados; el
**diseño de la escala sobrevivió intacto** (al re-medir, los tres hallazgos se confirman). Lo que cambió:

| # | Defecto | Cómo quedó |
|---|---|---|
| 1 | **Las cifras publicadas del volcado NO se reproducían** — y el módulo se contradecía con su propia prueba (`2-3-3X`: **303** órdenes en `orden-de-tallas.ts`, **252** en `orden-de-tallas.test.ts`). Era la SEGUNDA vez: ya había sido el defecto 6 de la ronda anterior. | Se **re-midió**, y sobre todo la medición dejó de ser una cita: vive en **`backend/migracion/analisis/medicion-orden-de-tallas.ts`**, usa el parser del propio ETL y la escala del dominio, e imprime **cada cifra que la doc cita** en una tabla de cotejo. Corregidas: **164 → 161** combinaciones, **133 → 130** monótonas, `2-3-3X` **252**, `CH-M-G-EX-2X-3X` **17**, `EX` **2,854**, y las fallas de diseño reales son **2**, no 1. |
| 2 | **`actualizarTalla` no re-deducía el orden al renombrar.** `crearTalla` deducía; el renombrado no. Dar de alta `CH` (1040) y renombrarla a `3M` la dejaba **para siempre** después de toda talla numérica, y el seed jamás la reparaba (su orden ya no era el sentinela). Sin ninguna prueba. | Re-deduce, **sólo si el orden vigente lo puso la escala** (`=== 0` o `=== deducirOrdenTalla(etiquetaVieja)`). Un `orden` explícito en la misma llamada manda; una etiqueta que la escala no reconoce vuelve al sentinela **0** (quedarse con el viejo afirmaría que `UT` va donde iba `CH`); el cambio queda **auditado** (nadie lo pidió: sin bitácora sería invisible). **+7 pruebas.** |
| 3 | **La prueba «🔴 NO bloquea» no defendía nada.** Renderizaba con aviso y SIN propuesta, y afirmaba que no había botón — pero en ese estado no hay **ningún** botón que pintar. Mutando a `disabled={… \|\| avisos.length > 0}` sobrevivían las 45 pruebas. | Ahora renderiza con **aviso Y propuesta a la vez** y afirma que «Asignar esta curva» sigue **habilitado**. Esa mutación ahora la mata. |
| 4 | Una curva **DESACTIVADA** con las mismas tallas producía la gemela **«Curva CH-M-G (2)»** — justo lo que el TSDoc dice querer evitar. | Se **RECHAZA**, con el nombre de la curva y dónde reactivarla. Razón escrita: reactivarla sola desharía en silencio un acto deliberado **y pediría `tallas.administrar`**, que esa puerta no exige (sería un agujero de privilegio). `curvaQueCubreExactamente` acepta `incluirInactivas` y devuelve `activo` — la regla de "cubrir exactamente" sigue en UN solo lugar. |
| nits | `{@link avisoCurvaDeLaOrden}` apuntaba a una función inexistente; el historial decía *«sólo donde nadie había puesto nada»* callando que un `orden: 0` puesto **a propósito** sí se pisa. | Corregidos los dos. El historial ahora lo dice, con la salvedad y por qué de aquí en adelante deja de poder pasar. |

🔴 **Las tres lecciones de esta ronda:**

1. **Una cifra citada a mano se pudre en silencio; una que sale de un script se vuelve a sacar.** El
   argumento entero de la escala es *"no se inventó: se MIDIÓ"* — y ese argumento no lo sostiene un
   número copiado, lo sostiene un comando. Por eso el arreglo no fue corregir cifras (eso ya se había
   intentado una vez y volvió a fallar): fue **convertir la medición en código**.
2. **Dos formas de contar en la misma frase.** El «164» y las «94 filas `Talla`» eran ambos correctos y
   ambos incompatibles: uno cuenta distinguiendo la caja y el otro no. El script imprime **los dos**, con
   la advertencia, para que la mezcla no se vuelva a colar.
3. **Una prueba verde puede estar pasando por la razón equivocada.** «No hay botón» y «el botón no está
   deshabilitado» se leen igual en el reporte y son cosas distintas. La regla práctica: para probar que
   *algo no bloquea*, hay que montar el estado donde **haya algo que bloquear**.

### Verificación

- **Backend:** `typecheck` · `lint` · `format:check` · `test:unit` (**153 archivos / 1,649 pruebas**) ·
  `openapi` (sin diff). Integración **completa**: **139 archivos / 2,167 pruebas, 0 rojas** (~20 min),
  contra Postgres nativo (initdb con **`C.UTF-8`** — con `C`, `lower('Ó')` no baja a `ó` y 4 suites de
  búsqueda salen rojas *por el entorno, no por el código*; 🚫 nunca Docker).
- **Frontend:** `gen:api` (sin diff) · `typecheck` (`tsc -b`) · `lint` · `format:check` · `test`
  (**178 archivos / 1,383 pruebas**).
- ⚠️ **Una cicatriz del entorno:** correr el suite de integración COMPLETO en segundo plano mientras se
  mutaba contra la **misma base** produjo `deadlock detected` y **14 pruebas rojas** en una mutación que
  aisladas sólo tumba **1**. Las corridas de mutación van **solas**: un veredicto sacado de un entorno
  contaminado miente en la dirección cómoda (parece que la prueba tiene más dientes de los que tiene).
- ⚠️ **Y dos cicatrices más del INSTRUMENTO, no del código** (la lección de siempre: *verifica el
  instrumento antes de creerle*): (1) `pgrep -f "vitest…"` en un bucle de espera **se casa a sí mismo** —el
  patrón está en su propia línea de comando—, así que el bucle nunca termina y parece que el suite sigue
  corriendo cuando ya murió; hay que filtrar por el proceso real (`node.*vitest`) o mirar el archivo de
  salida. (2) `vitest run --reporter=basic` **no existe en Vitest 4**: el comando falla al arrancar sin
  correr NADA, y el envoltorio de fondo reportó *exit 0* mientras el exit real era **1**. Se detectó por
  mirar el `EXIT_…` que el propio comando escribe, no el del envoltorio.
- **Pruebas nuevas:** 36 unit (la escala medida + la redacción del aviso) y 32 de integración.
- **MUTACIONES — «verde no es cubierto».** Ocho, con veredicto por **nombres de pruebas rojas**, no por
  exit code. El mutador restaura en `finally` y **verifica con md5 contra HEAD**.

  | Mutación | Veredicto | Pruebas rojas |
  |---|---|---|
  | M1 · se cae el filtro de EMPRESA al leer las órdenes del modelo (A9) | **MUERE** | 4 |
  | M2 · caen **las dos** guardas de exactitud (filtro del lote + lookup por firma) | **MUERE** | 2 |
  | M2b · la FIRMA deja de ordenar los ids | **MUERE** | 1 |
  | M2c · se cae en la trampa: `some` → `every` (+ las dos guardas) | **MUERE** | 3 |
  | M3 · el contrato vuelve a aceptar `orden: 0` | **MUERE** | 1 |
  | M4 · `crearTalla` ignora el orden capturado y siempre deduce | **MUERE** | 4 |
  | M5 · las letras dejan de ir después de los números (`BASE_LETRAS`) | **MUERE** | 1 |
  | M6 · el aviso sólo sale si faltan **Y** sobran tallas | **MUERE** | 4 |

  🔴 **Dos cosas que la mutación enseñó y que valen más que la tabla:**
  1. **Un mutante que sobrevive no siempre es un hueco.** Tumbar UNA sola de las tres guardas de
     exactitud (`some`, `buscadas.has(firma)`, `get(firma)`) deja el suite en verde, porque son
     **redundantes entre sí** — defensa en profundidad, cada una tapa el caso de la otra. Se verificó
     tumbando **dos** (rojo) y **las tres** (rojo, y ahí sí cae la curva vacía), se dejó escrito en el
     propio archivo de pruebas, y **no** se agregó una prueba por guarda: lo que se cubre es la
     invariante, no cada línea. *(Mismo patrón que el aprendizaje de V1-E3q sobre las tres guardas de A9.)*
  2. **El guardia del mutador atrapó al mutador.** La regla *"el patrón casa exactamente una vez"* abortó
     una mutación cuyo texto casaba **tres** veces en el archivo: sin ella habría mutado la línea
     equivocada y dictado un veredicto sobre algo que nadie quiso probar.

- **MUTACIONES de la RONDA DE CORRECCIÓN.** Cinco más, con el instrumento **verificado antes de creerle**
  (dos controles: un ancla inexistente debe **ABORTAR**, no "sobrevivir"; un comando que ejecuta **0**
  pruebas debe **ABORTAR**, no "morir"). Se cuenta **ejecutadas = passed + failed**, el patrón casa
  **exactamente una vez y anclado a línea completa**, y *muere* exige **nombres de pruebas rojas**.

  | Mutación | Veredicto | Pruebas rojas |
  |---|---|---|
  | M1 · el aviso **deshabilita** el botón «Asignar esta curva» | **MUERE** | 1 — *«🔴 NO bloquea: con aviso Y propuesta a la vez…»* |
  | M2 · renombrar **no re-deduce** el orden | **MUERE** | 4 |
  | M3 · la curva **apagada** vuelve a ser invisible (nace la gemela «(2)») | **MUERE** | 1 |
  | M4 · re-deduce **siempre**, pisando el orden que puso una persona | **MUERE** | 1 |
  | M5 · se cae la guarda `datos.orden === undefined` | **MUERE** *(tras corregir)* | 1 |

  🔴 **M5 sobrevivía, y no era equivalencia.** Se arregló la PRUEBA, no el código: el defecto estaba en
  la red, no en el trapecio.
  ⚠️ **La primera explicación de por qué importaba era INEXACTA, y el reviewer la corrigió midiendo.**
  Decía *"no cambia el valor guardado —el `orden` explícito gana igual, porque su rama va primero"*. Esa
  rama va primero **sólo cuando `cambiaOrden` es true**, o sea cuando el valor explícito DIFIERE del
  vigente. Si alguien renombra la etiqueta y manda el MISMO `orden` que ya tenía, `cambiaOrden` es false,
  y sin la guarda el `else if` **pisa el número que la persona acaba de pedir**: su sonda da `1040` con la
  guarda y `3` sin ella. Así que la guarda no protege sólo la bitácora: **protege el dato**.
  *Y la lección de segundo orden: la explicación de un arreglo se verifica igual que el arreglo.*

### Nota de cierre

**SIN migración de esquema, SIN permisos nuevos.** **CON seed**: `sembrarOrdenDeTallas` repara el
`orden = 0` de las tallas ya cargadas → el deploy a `prueba` **requiere `SEED_ON_START=true`**. Es
idempotente y no destructivo: sólo toca el sentinela, nunca un orden que puso una persona.

⚠️ **Contrato:** `esquemaTallaCrear.orden` pasó de `min(0)` a **`min(1)`**. Un cliente que mandara `0`
explícito ahora recibe 400 — es deliberado, y el formulario ya no lo produce.

⚠️ **Endpoints nuevos:** `GET /api/modelos/:id/curvas-sugeridas` (`modelos.ver`) y
`POST /api/modelos/:id/curva-desde-ordenes` (`modelos.administrar`, más `tallas.administrar` si hay que
crear la curva).

🔴 **Lo que esta etapa NO hace, a propósito:** no cambia la curva de un modelo que ya tiene una (eso se
edita en su ficha, donde queda constancia de que alguien la cambió queriendo), y no ordena las etiquetas
que la escala no reconoce.

⚠️ **Comportamientos nuevos de la ronda de corrección, para la verificación en `prueba`:** (1) renombrar
la etiqueta de una talla **mueve su orden** si nadie lo había puesto a mano — se ve en Catálogos › Tallas;
(2) asignar la curva de la OP a un modelo **falla con mensaje** si la curva con esas tallas existe pero
está desactivada (antes creaba una «(2)»).

⭐ **Para re-medir la escala** (no re-citarla): `npx tsx migracion/analisis/medicion-orden-de-tallas.ts`
desde `backend/`. El volcado ya no vive en el árbol (salió en `1398486`), así que hay que rescatarlo del
historial y apuntar `TABLAS_DIR` — el cómo está en el TSDoc del script.

---

## V1-E3u · La tela se compra POR COLOR ⭐⭐ (21-ago-2026) — ✅ HECHA

> Daniel: *"se selecciona una tela con la que se desarrolla el producto, de ahí nos piden esas telas
> para distintas órdenes en diferentes colores. Cuando se hace la receta no lleva el color, solo lleva
> la tela. Pero al pedir la tela, no puedo pedir esa tela solamente, tengo que pedir el color en cada
> modelo. **Debo de tener la posibilidad de ir comprando esa tela en diferentes colores (y pantones)**"*
> (`DECISIONES.md` §Post-F9.89).

### El hueco, en una frase

**El sistema obligaba a RECIBIR por color y no dejaba PEDIR por color.**

| Dónde | ¿Llevaba color? |
|---|---|
| BOM del modelo (`ModeloTela`) | **No** — y está bien: el modelo define la TELA |
| Orden de producción (`OrdenLinea`) | **Sí**, con pantone por color |
| **Receta de la OP (`OrdenTela`)** | 🔴 **NO** |
| **Renglón de OC (`OrdenCompraLinea`)** | 🔴 **NO** |
| Recepción (kardex de telas) | **Sí y OBLIGATORIO** (`MovimientoDetTela.idTelaColor`) |

Quien recibía tenía que **inventar la correspondencia**, y la misma tela en tres colores era un solo
renglón que no decía cuánto de cada uno. De ahí colgaba el segundo reporte del mismo día (*"no me deja
poner precio ya estando en la explosión"*): `TelaColor` guarda **precio por color** y **precio de
complemento por color** precisamente porque varían — sin color en el renglón, no había con qué decidir
cuál era el precio.

### Qué entrega

1. **`OrdenTelaColor` — el puente que faltaba.** Por renglón de receta y por color de la matriz de la
   OP, **qué color de la tela le toca**. Vive en la ORDEN (no en el catálogo ni en el BOM), igual que
   `idProveedorCompra` de §Post-F9.82: *el catálogo propone, la orden manda*.
2. **La explosión pasa a ser por tela×COLOR.** La cantidad de cada renglón sale de la **matriz
   color×talla que ya existía**: `piezas de ESE color × consumo por prenda`. La Σ no cambia.
3. **El precio sale del color** (decisión (b)): la cascada única ya tenía el escalón
   `color-referencia` (`TelaColor.precio`) y **el MRP nunca lo llenaba** —no tenía cómo, porque el
   renglón no sabía de qué color era—. Ahora sí. Y corregirlo desde la compra **actualiza el
   catálogo**, auditado.
4. **La línea de OC lleva el color** (`idTelaColor`), el **impreso lo dice con su pantone**, y **la
   recepción lo CRUZA** contra lo que llega.
5. **El desvío avisa a quien autoriza** (decisión (a)): la línea guarda `cantidadSugerida` —lo que el
   sistema calculó— y la OC expone `avisoDesvio` por renglón. 🔴 **No bloquea nada.**
6. **Lo que falta por decir se REPORTA** (`pendientesColor`), no se adivina — y su cantidad **sigue
   yendo a compra** en un renglón sin color, para que la OP no se quede corta por un dato pendiente.

### Las tres decisiones, cómo quedaron

**(a) El sistema propone, Compras captura, el desvío avisa.** La propuesta se ve al lado (nunca
pre-llena a ciegas): en el color, la propuesta del catálogo con su razón; en la cantidad, el
`cantidadPropuesta` junto al campo. El **umbral es 10 %**, por empresa
(`ConfiguracionEmpresa.pctDesvioCompra`) y editable sin deploy.

> **Por qué 10 %** — el negocio ya reconoce el **5 %** como variación normal (§Post-F9.19: *"el
> proveedor puede entregar +/− 5%"*), así que avisar por debajo de eso sería avisar de lo normal;
> redondear al rollo o al mínimo del proveedor casi siempre cae por debajo del 10 % y **ése es un
> ajuste que Daniel ya declaró legítimo** (§Post-F9.86, el sobrante de compra), mientras que **un rollo
> entero de más sí lo pasa** — que es justo el caso que Daniel quiere que llegue a quien autoriza. Y es
> un número que una persona puede razonar en voz alta, lo cual importa porque **lo va a ajustar Daniel
> con el uso**, no un programador. Se avisa de MÁS **y de MENOS**: comprar de menos es más peligroso
> (la OP se queda corta y nadie se entera hasta que falta la tela).

**(b) El precio sale del color y corregirlo actualiza el catálogo.** El permiso es
**`compras.administrar`** — no uno nuevo.

> **Por qué no un permiso propio** — nacería **sin asignar a nadie** y cerraría en silencio justo el
> camino que la decisión vino a abrir (la cicatriz de §Post-F9.17/.85: *un arreglo que necesita que
> alguien haga algo no está terminado hasta que alguien lo hace*). Y `telas.administrar` obligaría al
> comprador a esperar al dueño del catálogo, que es exactamente la espera que §Post-F9.82 quitó. El
> control es el que Daniel eligió para el desvío: **visibilidad**, no tranca — la corrección responde
> el ANTES y el DESPUÉS para que la pantalla lo enseñe, avisa que *"aplica a todas las compras
> futuras"*, y deja en bitácora **quién, cuándo, de cuánto a cuánto y desde qué OP/OC**.

**(c) Se compra el COLOR y el almacén lo reparte.** Dos OP que piden el mismo color de la misma tela
caen en **un renglón** de la revisión previa… y siguen guardándose **una línea por OP**.

> ⚠️ **Esto NO contradice §Post-F9.86 (*"reparto siempre por OP"*): son dos planos.** La OC registra
> cuánto es de cada OP —la INTENCIÓN, que es lo que hace cuadrar el *"qué falta"* y el costo— mientras
> **la tela física entra al almacén y la `salida-a-orden` decide el consumo REAL**. Misma estructura con
> la que Daniel resolvió el faltante: *el BOM es una estimación; el kardex es un hecho.*

### 🔴 Los AVÍOS: se MIDIÓ, y el hueco NO es el mismo

Daniel lo sospechó (*"y seguramente también en avíos"*). Se midió antes de asumirlo, y el resultado
**cambia la respuesta**:

| Dónde | Tela | Avío |
|---|---|---|
| Catálogo de colores | `TelaColor` (nombre libre + pantone + precio + precio de complemento) | 🔴 **no existe** — `grep AvioColor` no devuelve nada |
| Kardex | `MovimientoDetTela.idTelaColor` **obligatorio** | `MovimientoDetAvio` **no tiene color** |
| Recepción | exige el color | no lo pide ni lo puede pedir |
| Renglón de OC | le faltaba (lo que arregla esta etapa) | le falta… pero no tendría contra qué validarlo |

**En la tela el color existía en los dos extremos y faltaba el eslabón de en medio.**

⚠️ **Matiz que salió al re-medirlo (22-ago) y que corrige la fila «Renglón de OC» de arriba:** el
renglón de OC de un avío **sí puede diferenciarse hoy**, por `OrdenCompraLineaTalla`, que lleva
`idColor` × `idTalla`. O sea que la **intención de compra** de un avío ya se puede decir por color de
**prenda** y talla — es la versión estructurada de aquella tabla de Excel que el sistema viejo dejaba
pegar en la OC (§Post-F9 *"comprado diferenciado por talla y color"*). Lo que al avío le falta no es
*"todo"*, es la mitad del PROVEEDOR: **el color propio del avío** (el equivalente de `TelaColor`, con
su nombre libre, su pantone y su precio), **el kardex por ese color** y **la recepción por ese color**.

Aun así la conclusión no cambia: eso es un catálogo nuevo, una dimensión nueva de existencias, una
recepción nueva y una migración del histórico — **otra etapa, del tamaño de ésta o más**, y meterla
aquí habría duplicado el alcance de la que Daniel puso como prioridad.

⚠️ **Y hay un dato previo que hay que poner sobre la mesa antes de construir nada:** en **D13**
(4-jul-2026) Daniel ya había decidido, para el precosteo, *"consumo por talla solo ciertos avíos
(telas no; **tampoco por color**)"*. Puede que siga vigente, puede que la práctica lo haya rebasado —
pero la pregunta hay que hacérsela con esa decisión a la vista, no como si fuera terreno virgen.

✅ **RESUELTO en `V1-E8c` (27-ago-2026, §Post-F9.126)** — Daniel eligió: **sin catálogo**. El avío se
compra **por color de PRENDA** (el de la matriz de la OP, que no cuesta catálogo nuevo) y el color que
lee el proveedor va como **texto editable** en la línea (`colorAvio`), exactamente como él lo pidió:
*"poner 4 veces el cierre y en la descripción del avío ponerle el color"*. La mitad del proveedor que
esta nota daba por necesaria —kardex y recepción por color de avío— **no se construyó y no hizo falta**:
el renglón lleva el color, y la recepción cruza contra el renglón. Lo que sí quedó como **límite
declarado** es la MEDIDA en una entrega parcial (ver la ficha de `V1-E8c`).

### Qué pasa con las OC y las recetas que YA existen

**Nada se rompe y nada se backfilea.** La migración es 100 % aditiva y todas las columnas nuevas nacen
NULL:

- una **receta sin colores dichos** se explota como siempre (un renglón por tela, con el total de la
  orden) y sale listada en `pendientesColor`;
- una **OC sin color** se compra y se recibe **exactamente igual que antes**: la recepción sólo cruza el
  color **cuando el renglón lo trae**. Convertir ese `null` en un rechazo dejaría sin poder recibir a las
  ~7,978 OC migradas;
- el **neteo** contra lo ya comprado sigue cuadrando: `repartirComprometidoPorColor` da a cada renglón
  lo de su color y reparte el **acervo sin color** —con un solo renglón sin color, que es el caso de
  todo lo migrado, devuelve el acervo COMPLETO, o sea el número de siempre;
- **no se adivina el color de nada.** Adivinarlo escribiría como HECHO lo que sólo es una suposición
  (la lección de §Post-F9.86).

### Cómo quedó por dentro

- `dominio/compras/casar-color-de-tela.ts` — la **propuesta** (pura): liga del catálogo → mismo pantone
  → mismo nombre → único color **sin ambigüedad posible** (una orden de un color contra una tela de un
  color). ⚠️ **No se metió al cascada de PRECIOS**: `resolverPrecioColorReferencia` sigue casando por
  liga y nombre, porque una regla nueva para *proponer* es barata (la persona la ve y confirma) y una
  regla nueva para *valuar* movería números del precosteo que nadie pidió mover.
- `dominio/compras/desvio-de-compra.ts` — el desvío (puro). **No lanza nunca.**
- `dominio/compras/color-de-la-tela.ts` — leer / amarrar / corregir el precio.
- `comprometido-en-oc.ts` — `porColor` + `repartirComprometidoPorColor`.
- `mrp.ts` — la explosión por color, el neteo, la agrupación `material|color|proveedor`, el ajuste por
  color, y el plan que guarda `cantidadSugerida`.
- **El tablero R7 sigue por MATERIAL** y es a propósito: la pregunta ahí es *"¿tengo la tela para
  producir?"*. Además `comprometidoEnOc` está indexado por material — pintar una fila por color haría
  que CADA una leyera el `enOc` del material completo y el tablero diría que hay tres veces más
  comprado del que hay. **Se suma primero y se cruza después.**
- Frontend, **explosión**: chip de color en cada renglón, aviso `pendientesColor` con su acción, y el
  diálogo **«De qué color se compra la tela»** (propuesta al lado, precio con su advertencia). El chip
  de color va también en la **revisión previa** — es la última pantalla antes de generar la OC y sin él
  dos tonos de la misma tela se ven idénticos justo donde se decide qué se compra.
  ⭐⭐ Y por el **mismo** criterio viaja hasta la previa el aviso de que el sistema **eligió** una
  atribución (`cantidadEnOcSinColor`): la cantidad que se va a comprar salió de RESTAR ese número. En
  el renglón **omitido** por *"ya está en una OC"* pesa aún más —ese material se queda sin comprar—, así
  que el detalle deja de afirmarlo a secas y la fila se pinta como aviso.
- Frontend, **orden de compra**: `descripcionMaterial` dice el color, así que lo dicen los tres lados
  que la usan — detalle de la OC, **recepción** y compras por orden. Antes el color **sólo salía en el
  impreso**: quien recibe comparaba la factura contra una OC que en pantalla no decía de qué color era.
- Frontend, **autorización** (§Post-F9.89(a)): la **bandeja avisa en la tarjeta** cuántos renglones se
  apartan de lo calculado (sin abrir nada), el detalle **nace abierto** cuando hay desvío, y la frase
  completa que arma el servidor se lee en **su propia fila** del renglón, junto a un `calculado: N` al
  lado de lo pedido. 🔴 El botón «Autorizar» **no mira nada de esto**.

### ⚠️ Lo que faltaba al auditar la etapa (22-ago-2026) — y quedó cerrado

La etapa se construyó en dos tandas (la segunda tras perderse el contexto del primer coder). Al
**auditar lo ya hecho antes de tocar nada**, el backend estaba completo y bien probado, pero **el
último tramo del cable no llegaba a ninguna pantalla**:

| Hallazgo | Por qué importaba |
|---|---|
| 🔴 `avisoDesvio` se calculaba y **nadie lo pintaba** | La decisión (a) es *"que le notifique a la persona que va a autorizar la OC"*. Un dato en el JSON no notifica a nadie: el requisito estaba en el contrato, no en el producto. (La propia lista de verificación de esta ficha pedía *"abrirla y ver el aviso de desvío"* — que era **imposible**.) |
| 🔴 El **color sólo salía en el impreso** | En pantalla el renglón decía *"Felpa 280"* a secas — incluida la **pantalla de recepción**, que es justo donde alguien cruza lo que llegó contra lo que se pidió. |
| 🔴 Dos **claves de React duplicadas** | La lista de la explosión y la de la revisión previa se llaveaban por `tipo-material[-proveedor]`; desde esta etapa la misma tela sale en **varios** renglones con el **mismo** proveedor. |
| El color no se veía en la **revisión previa** | Es la última pantalla antes de generar la OC: dos tonos de la misma tela se veían idénticos. |
| `format:check` **en rojo** (3 archivos) | CI lo habría rebotado. |
| El encabezado de `recepciones.ts` seguía diciendo *"la OC se pide por TELA, sin color"* | Dejó de ser cierto en esta misma etapa, y ahí es donde lo lee el siguiente. |

Todo cerrado en la segunda tanda, con **9 pruebas de consumo** nuevas (que la pantalla ENSEÑE lo que el
servidor manda; que el servidor lo CALCULE bien ya vivía en `color-de-la-tela.int.test.ts`).

### 🔴 Lo que encontró la REVISIÓN INDEPENDIENTE (22-ago-2026) — y quedó cerrado

Cinco de las seis afirmaciones del cierre se sostuvieron con datos (incluida (c) verificada contra la BD:
dos OP → un renglón, **dos** líneas de OC, Σ = 90, pendiente a 0). Falló la que más pesa:

| # | Hallazgo | Cómo quedó |
|---|---|---|
| **D1** 🔴 | **La tela NO se recibe donde yo la arreglé.** §Post-F9.14 deja los renglones de tela `disabled` en `RecepcionComprasPagina`; se reciben en *Inventarios › Telas › Entradas*. Y ahí el color de la OC **no llegaba ni al contrato**: la etapa había añadido un **cruce que rechaza la factura entera** y le había quitado a quien recibe el único dato con el que cumplirlo. | `lineasTelaPendientesDeProveedor` devuelve `idTelaColor`/`telaColor`/`pantoneTelaColor`; el panel de pendientes lo enseña con su pantone y la captura lo **preselecciona** (editable: manda lo que llegó). |
| **D1+** ⚠️ | Al barrer aparecieron **dos superficies más**: el camino del **XML del CFDI** (`cfdi-entrada-tela.ts`) alimenta la MISMA pantalla y tampoco llevaba color; y la frase *"la OC no lo define"* estaba en **cinco** sitios, no dos. | El color viaja también por el CFDI. Las cinco frases corregidas; en `DECISIONES.md` no se reescribe la historia: se anota **SUPERADO por §Post-F9.89**. |
| **D2** 🔴 | El cruce nuevo **sin ninguna prueba** — ni que dispare, ni **que NO dispare** con renglón sin color. Esa segunda mitad protege a las ~7,978 OC migradas. | 4 pruebas de integración. La clave: quitar `linea.idTelaColor !== null &&` deja el histórico irrecibible, y ahora se pone rojo. |
| **D3** 🔴 | Cambiar la tela de un renglón de OC dejaba **pegado el color de la tela anterior**; el cerrojo lo rechazaba al guardar y el usuario leía el error **sin ningún control para corregirlo** (el editor nunca mostraba el color). | Cambiar de tela (o de tipo) **suelta** el color; el renglón enseña «Color: X» con su «quitar». |
| **D4** 🔴 | `pctDesvioCompra` era una **columna sin puerta**: sólo se cambiaba con `UPDATE` a mano, y la ficha afirmaba que era editable sin deploy. | Campo en *Administración › Empresas › Configuración*, por el patrón que ya existía (`agingLimite1/2`). |
| **D5** 🟠 | El *"último absorbe"* no era cosmético: con acervo **insuficiente**, el **orden de las filas** decide a quién se le atribuye, y se pintaba como hecho plano. | La ambigüedad es irreducible, pero se **marca**: `cantidadEnOcSinColor` viaja al renglón y la pantalla lo dice. |
| **D6** 🟠 | `repartirComprometidoPorColor` **sin una sola prueba**, siendo la base de todo el *"lo viejo no se rompe"*. | 8 pruebas: sus tres ramas + la ambigüedad de D5 **fijada** (se comprueba invirtiendo las filas). |
| **D7** 🟠 | Con varias OP, *"decir de qué color"* abría **siempre la primera**: se leía «Orden 5560» y se aterrizaba en la 5558. | Cada pendiente lleva su `idOrden` y **su propia acción**, que nombra su orden. |
| **D8** 🟡 | El marcador de D5 **no llegaba a la revisión previa**. El reviewer lo daba por aceptable, pero señaló que **mi propio argumento de la ronda 1 lo contradecía**: *"la previa es la última pantalla antes de generar la OC"* fue la razón para enseñar ahí el color. | Se hizo. Y al mirarlo apareció un caso **más filoso**: un omitido por `ya-en-oc` **desaparece de la compra** con un *"no hace falta volver a comprarlo"* que, si la atribución fue una elección, **afirma un hecho insostenible** (el fallo que §Post-F9.85 cerró). Ahora los dos avisan. |

🔴 **La lección, que es la de esta etapa en otra piel:** *un dato que llega al contrato no ha llegado a la
persona*. Y una segunda: **añadir una validación obliga a preguntarse quién tiene que cumplirla y con qué
información cuenta** — un control sin el dato no protege, traslada el problema a quien menos puede
resolverlo.

### Nota de cierre — ✅ HECHA (21/22-ago-2026)

⚠️ **CON migración** (`20260821180000_la_tela_se_compra_por_color`), **aditiva** y validada con
`prisma migrate diff` contra Postgres nativo (diff vacío tras aplicarla). **SIN permisos nuevos** y
**SIN seed** → el deploy a `prueba` **no requiere `SEED_ON_START`**.

⚠️ **Endpoints nuevos:** `GET`/`PUT /api/ordenes/:id/colores-tela` (`compras.ver` / `compras.administrar`)
y `PUT /api/telas-colores/:idTelaColor/precio` (`compras.administrar`).

⚠️ **Contrato:** `OrdenCompraLinea` gana `idTelaColor`, `telaColor`, `pantoneTelaColor`,
`cantidadSugerida` y `avisoDesvio`; el renglón de explosión gana `idTelaColor`/`telaColor`; la
explosión gana `pendientesColor`; los `ajustes` de la compra ganan `idTelaColor`. Un cliente viejo
sigue funcionando (todo lo nuevo es opcional o adicional).

🔴 **Lo que esta etapa NO hace, a propósito:** no toca los avíos (ver la medición de arriba); no
backfilea color en lo migrado; no cambia la cascada de precios del **precosteo**; y **el desvío no
bloquea** — si algún día se quiere topar el gasto, ése es un control de autorización por importe, no
una tranca en la captura.

⚠️ **Para verificar en `prueba`:** entrar a *Compras › Explosión*, elegir una OP de varios colores →
debe salir el aviso *"Falta decir de qué color se compra…"* → abrir el diálogo, usar la propuesta en un
color y elegir otro a mano → la explosión debe partirse en un renglón por color con las cantidades de
cada uno (y cada renglón enseña su **chip de color**) → teclear un total muy distinto en uno → pasar a
la **revisión previa**, donde cada renglón debe decir su color → generar la OC.

Y del lado de **quien autoriza**, que es donde vive la decisión (a):
- *Compras › Autorización*: la tarjeta debe avisar **"N renglones se apartan de lo que el sistema
  calculó"** **sin abrir nada**, con el detalle ya desplegado y la frase completa en el renglón;
- 🔴 y el botón **«Autorizar» debe seguir funcionando** — el desvío avisa, **no bloquea**;
- en el detalle de la OC (y en la pantalla de **recepción**) el renglón debe decir *"Tela · Color"*,
  no la tela a secas;
- el **impreso** de la OC debe decir el color y su pantone.

---

## V1-E3v · Los avíos FAVORITOS se sugieren al armar la receta (22-ago-2026) — ✅ HECHA

**De dónde sale:** `DECISIONES.md` §Post-F9.90 (DANIEL, 22-ago-2026).

> *"Cuando damos de alta una receta, deberíamos de tener algunos avíos «favoritos». Todo lleva
> etiqueta de lavado, por ejemplo. Podría ser la única favorita. O no sé si etiqueta de marca
> también. Y debemos de tenerla con **1 pieza por default**."* — y sobre cómo deben aparecer:
> *"Los favoritos aparecen como **sugerencia**. Pero **solo hay que aceptarlos y ya**."*

### La mitad ya existía, y nadie la leía

`Avio.favorito` y `Avio.cantFav` (*"cantidad preestablecida cuando es favorito"*) están construidos
desde **F1-E3**, con su regla validada en el dominio (*"si el avío es favorito, captura la cantidad
preestablecida (mayor a 0)"*), en el contrato y con sus pruebas. Y aun así, `grep favorito|cantFav`
en las pantallas de modelos y de órdenes daba **cero**: se podía marcar un avío como favorito con su
cantidad y **al armar la receta no pasaba nada**.

🔴 Es el patrón que ya salió cuatro veces esta semana — **el dato llega al modelo y no al usuario**
(el color en la recepción, el `avisoDesvio` sin pantalla, la elección que no llegaba a la previa, y
ahora esto). Lo que esta etapa agrega es exactamente **el tramo que faltaba: que alguien lo LEA**.

### Qué entrega

- **La sugerencia se VE** al armar la receta del **MODELO**, en la sección de *Avíos*: una tarjeta
  arriba de la tabla que lista cada favorito que le falta a esa receta con **su** cantidad y su
  unidad (*"ETQ-LAV — Etiqueta de lavado · 1 pza"*).
- **Un solo acto los acepta todos** — un botón *«Aceptar los N»*. Ni precarga silenciosa (nadie los
  vería) ni palomear uno por uno (§Post-F9.36 punto 3: obligar a ocho clics entrena a la gente a
  clickear sin leer). Después se ajustan o se quitan como cualquier renglón.
- **Cuáles son favoritos lo marca Daniel en el catálogo de avíos** — 🔴 **NO hay ninguna lista
  cableada**. Si no hay ninguno marcado, la tarjeta no aparece: eso es correcto, no un error. Lo
  mismo con el *"1 pieza por default"*: sale de `cantFav` de **cada** avío, nunca de una constante
  (las pruebas usan cantidades **distintas** —1 y 2— precisamente para que un 1 cableado se caiga).
- El **catálogo de avíos ya dejaba capturar el dato** (casilla *"¿Avío de uso frecuente (favorito)?"*
  + *"Cantidad preestablecida"*, con la regla ya validada). Se le agregó una línea de ayuda que dice
  **qué provoca** la marca, ahora que provoca algo.

### Las dos decisiones que la etapa tuvo que tomar (⬜ de §Post-F9.90)

**1. ¿Sólo en receta vacía, o también en una que ya tiene renglones? → SIEMPRE.**
Apagar la sugerencia en cuanto hay un renglón la volvería inútil justo donde más sirve: la receta
casi nunca se arma de un tirón, y quien vuelve al día siguiente a agregar la segunda tela necesita el
recordatorio **más** que quien empieza de cero. El olvido no ocurre en el minuto uno; ocurre a la
mitad. La tarjeta no estorba porque **desaparece sola** cuando ya no hay nada que sugerir.

**2. ¿Y un favorito que YA está puesto? → no se duplica, y el resto se sigue ofreciendo.**
Lo obvio es no duplicarlo (aceptar es aditivo: sólo mete lo que falta, y aceptar dos veces seguidas
agrega 0). Lo que **no** era obvio es qué hacer con los demás, y la respuesta es que se siguen
ofreciendo: tratar "ya tengo uno" como "ya revisé todos" es exactamente cómo se pierde el segundo.
El que ya está se **dice** aparte (*"El avío favorito del catálogo ya está en esta receta"*), para no
prometer de más ni dejar la duda de si se ignoró. 🔴 **Y se dice SIEMPRE, también cuando hay otros
que sí faltan** (el caso MIXTO: dos favoritos, uno puesto y otro no). Si el aviso sólo saliera cuando
no queda nada que ofrecer, en el caso mixto la tarjeta hablaría únicamente del que falta y la duda
quedaría intacta — que es justo lo que esta decisión vino a cerrar.

**Y una tercera que apareció al construir: un favorito marcado SIN cantidad no se adivina — pero
tampoco se calla.** La regla `favorito ⇒ cantFav > 0` se valida desde que existe, pero el ETL y las
filas viejas pudieron entrar sin ella. Un avío así **no se sugiere** (inventarle un consumo sería
escribir una suposición como hecho, la lección de §Post-F9.86) y **se nombra** en la tarjeta, para
que alguien vaya a completarlo al catálogo en vez de preguntarse por qué no sale.

### Cómo quedó por dentro

- **Dominio** `backend/src/dominio/modelos/avios-favoritos.ts` (A1: la pantalla no decide nada):
  - `sugerirAviosFavoritos(sesion, idModelo)` — permiso `modelos.ver`, modelo inexistente → 404.
    Devuelve **tres** buckets: `sugeridos` / `yaEnLaReceta` / `sinCantidad`. Orden por clave
    (determinista: una sugerencia que baila entre visitas destruye la confianza).
  - `aceptarAviosFavoritos(sesion, idModelo)` — permiso `modelos.administrar`, **UNA transacción**
    (A2), **aditiva**: `createMany` de lo que falta con `cantFav` como consumo y las tres banderas 🔑
    en true. **No toca ni un renglón existente** (ni consumo, ni banderas, ni amarre, ni medidas por
    talla) y **no borra nada** (D3). Idempotente. Bitácora (A7) **sólo si de verdad agregó algo**, y
    `tocarModelo` para que el cambio quede firmado. Un P2002 de carrera → 409, nunca un duplicado.
  - A9: la receta que devuelve se lee con `sesion.idEmpresaActiva`, así que el precio del renglón
    aceptado sale de las compras de **esta** empresa (dos pruebas lo fijan, con el caso y su control).
- **Contrato**: `esquemaAviosFavoritosSugerencia` y `esquemaAviosFavoritosAceptados`.
- **API**: `GET /api/modelos/:id/bom/avios/favoritos` (`modelos.ver`) y
  `POST /api/modelos/:id/bom/avios/favoritos` (`modelos.administrar`).
- **Frontend**: `SugerenciaAviosFavoritos.tsx` (tarjeta `bg-primary-soft`, un botón) cableada en la
  sección de *Avíos* de `EditorBom`. Sin `modelos.administrar` **no se pinta** y el servidor rechaza
  el POST (§Post-F9.68: esconder Y bloquear).
- ⚠️ **Un footgun que se cerró:** aceptar escribe en el servidor y recarga la ficha, lo que
  **resiembra la captura** del editor. Si se dejara pulsar con cambios sin guardar, lo tecleado se
  perdería **sin avisar**. El botón se **bloquea con la razón a la vista** (*"Guarda primero la
  receta…"*) en vez de tragárselo — `difiereDeLaFicha` compara por VALOR lo que el PUT manda de
  verdad, para no bloquear por un `1.0` tecleado sobre un `1`.

### Verificación

**Backend:** 16 pruebas de integración nuevas del dominio (`avios-favoritos.int.test.ts`) + 2 de API
(`modelos.int.test.ts`: el flujo completo GET→POST→POST idempotente, y el 403 de las dos rutas).
**Frontend:** 8 del componente (`SugerenciaAviosFavoritos.test.tsx` — incluye el caso **MIXTO**:
con un favorito puesto y otro no, la tarjeta menciona a los DOS) + 2 del cableado en `EditorBom`
(que se ve en Avíos y **no** en Telas; que un cambio sin guardar bloquea el botón con su razón).

### Nota de cierre — ✅ HECHA (22-ago-2026)

⚠️ **SIN migración, SIN permisos nuevos, SIN seed** (reusa `modelos.ver` / `modelos.administrar`) →
el deploy a `prueba` **no requiere `SEED_ON_START`**.

🔴 **Lo que esta etapa NO hace, a propósito:**
- **No toca la receta de la OP.** Cada orden lleva su receta **congelada** (§Post-F9.43); meter
  favoritos ahí sería reabrir el "alcance hacia atrás" que V1-E3d vino a cortar. Daniel dijo
  *"cuando damos de alta una receta"*, y la receta que se da de alta es la del **modelo**.
- **No sugiere telas ni arte.** 🔴 **Y OJO con la razón, porque la primera que se escribió estaba
  mal.** Se dijo que a la tela *"le falta `cantFav`"*, como si fuera un avío favorito a medias.
  **Daniel lo corrigió el 22-ago** al leer la doc: *"Las telas favoritas tienen otro sentido que los
  avíos. Era para mostrar en inventarios un grupo reducido de telas que son las que más uso. No para
  que por default me ofrezca una tela."* Las dos banderas **comparten el nombre y no la función**, y
  a la de la tela **no le falta cantidad**: la cantidad no interviene en lo que quiere resolver.
  Aprendizaje: *un campo con el mismo nombre en dos modelos invita a suponerle la misma intención —
  y la suposición se escribió como hecho.*
  ⚠️ **Estado real de `Tela.favorito`:** existe, se captura, **nace marcada** (A1.1 punto 2), se
  audita (`dominio/catalogos/telas.ts:978`, `:1073`), viaja en el contrato
  (`api/telas/telas.rutas.ts:85`) y se pinta tres veces en `TelasPagina` (`:309`, `:505`, `:574`) —
  pero **ninguna pantalla de existencias la mira** (`frontend/src/modulos/inventarios/*.tsx`: cero
  coincidencias). O sea que **lo de inventarios está por construir**, no a medias. Anotado en
  `HOJA-DE-RUTA.md`; no se hace aquí porque es alcance nuevo y de otro módulo.
  El **arte** sí carece de la bandera por completo (no hay catálogo de artes; es `TipoProceso` con
  `esArte`, sin `favorito`).
- **No marca ningún avío como favorito.** Eso es dato de Daniel, en el catálogo, cuando él quiera.

⚠️ **Para verificar en `prueba`:** ir a *Catálogos › Avíos*, editar la etiqueta de lavado → marcar
**¿Avío de uso frecuente (favorito)?** y poner **1** en *Cantidad preestablecida* → guardar. Luego
*Modelos*, abrir un modelo → pestaña **Avíos** de la receta: debe salir la tarjeta con el avío y
*"1 pza"*, y **«Aceptar el favorito»** debe meterlo a la receta de un clic. Volver a entrar: la
tarjeta ya no lo ofrece (dice que ya está). Marcar un segundo favorito con cantidad **2** y
comprobar que entra con **2**, no con 1.

---
## V1-E3w · El importador de PDFs y el límite que nadie hacía cumplir ⭐ (22-ago-2026) — ✅ HECHA

**Lo reportó Daniel:** importar **varias** OC del cliente en PDF de un jalón moría con *«Failed to
fetch»*. Una o dos, bien; tres o cuatro, muerto. La decisión y su razonamiento completo están en
`Documentacion_MJD/DECISIONES.md §Post-F9.92`.

### El diagnóstico, que no era donde parecía

El backend declara `LIMITE_CUERPO_IMPORTACION = 64 MiB` (`backend/src/api/pedidos/importacion-pdf.rutas.ts:30`)
y el contrato admite `MAX_ARCHIVOS_PDF = 40`. Pero **nginx** —que va en medio, sirviendo el frontend y
haciendo de proxy de `/api`— no declaraba `client_max_body_size` en su `location /api/`, así que regía su
**default: 1 MB**. Los PDFs viajan como base64 dentro del JSON (base64 infla ~33 %), o sea que con tres o
cuatro OC de ~200 KB ya se pasaba. **El límite real del sistema era 1 MB**, y el número que todos leían era
el otro.

🔴 **Y la forma de fallar era peor que el límite.** nginx corta el cuerpo **antes** de que llegue al
backend y cierra la conexión: sin 413 con cuerpo, sin cabeceras CORS, y **sin rastro en los logs del
backend** —la petición nunca llegó—. De ahí que el usuario viera el texto crudo del navegador y que del
lado del servidor no hubiera nada que investigar. Es la razón por la que este defecto sobrevivió: **no
dejaba huella en el lugar donde se busca.**

### Qué se construyó

1. **`frontend/nginx.conf.template`** — `client_max_body_size 64m;` dentro de `location /api/`, espejo del
   límite del backend, más `client_body_timeout` / `proxy_send_timeout` / `proxy_read_timeout` a 300 s
   (subir decenas de PDFs por una conexión lenta pasa de los 60 s por defecto, y un corte a media subida se
   ve **idéntico** al 413).
2. **`frontend/src/limite-cuerpo-api.test.ts`** — el candado. Lee los DOS archivos reales (la plantilla de
   nginx y el de rutas del backend) y exige que declaren **el mismo número de bytes**. Se eligió una prueba
   y no una constante compartida porque nginx no compila TypeScript: lo único que impide que se separen en
   silencio es algo que lea a los dos y truene. Acota la búsqueda **al bloque** `location /api/` a propósito
   —un `client_max_body_size` en otra `location` no protege a la API y darlo por bueno sería el falso verde
   que esto viene a evitar— y truena si algo no parsea, en vez de pasar en verde por omisión.
   🔴 **Y su hueco, que el reviewer del PR #203 encontró y COMPROBÓ:** en nginx una `location` con **regex**
   gana precedencia sobre el prefijo, así que agregar `location ~ ^/api/pedidos/ { … }` sin límite devuelve
   el importador a 1 MB **con las 3 pruebas en verde**. Cerrarlo exigiría modelar la precedencia de nginx
   dentro de la prueba —bastante más que leer una línea—, así que se decidió **no construirlo y sí dejarlo
   escrito**, en el test y aquí. *Un candado con un hueco documentado protege; uno con un hueco callado
   engaña.* Regla para quien toque la plantilla: **si agregas una `location` que atrape rutas de `/api/`,
   declárale su propio `client_max_body_size`.**
3. **`frontend/src/api/importacion-pdf.ts`** — un fallo **de red** (sin respuesta) se traduce a un mensaje
   que se puede seguir. No inventa la causa: *"si cargaste varios PDFs, prueba con menos archivos a la vez;
   si el problema sigue con uno solo, revisa tu conexión"*. Y un error que **sí** trae respuesta del
   servidor pasa **intacto** — el backend siempre gana (A1).

### Cómo se verificó (mutación, no sólo verde)

| Mutación | Resultado esperado | Lo que dio |
|---|---|---|
| Quitar `client_max_body_size` de nginx | el candado cae entero | **3 de 3 rojas**, con el mensaje que nombra el default de 1 MB |
| Bajar nginx a `32m` (los dos números se separan) | cae **sólo** la comparación | **1 roja / 2 verdes** |
| `conEnvioLegible` sin traducir (la conducta vieja) | caen las dos de red | **2 rojas / 1 verde** |
| `conEnvioLegible` traduciendo **todo** (el arreglo ingenuo) | cae **sólo** la del error del servidor | **1 roja / 2 verdes** |

Las cuatro firmas son distintas: las pruebas no sólo detectan que algo se rompió, **distinguen el arreglo
bueno del ingenuo**.

### Nota de cierre — ✅ HECHA (22-ago-2026)

**Sin migración, sin permisos, sin seed.** El deploy a `prueba` **no requiere `SEED_ON_START`**.
⚠️ **Pero sí requiere que el frontend se reconstruya**: el cambio vive en la plantilla de nginx, que se
procesa **al arrancar el contenedor** del frontend. Un deploy que sólo toque el backend deja el límite viejo.

**Lo que NO se hizo, y por qué:**
- **No se duplicó el número en el código del frontend.** Ya hay dos copias (nginx y el backend) amarradas
  por la prueba; una tercera en la pantalla sería un espejo más que mantener, y la pantalla no necesita
  conocer el límite para dar un mensaje útil.
- **No se verificó el proxy de Railway.** Puede tener su propio tope y **no se puede comprobar desde el
  repo**. Si el defecto reaparece en `prueba` con lotes grandes, ahí es donde hay que mirar. Anotado, no
  resuelto.

## V1-E3x · Ponerle proveedor a VARIOS avíos de un golpe ⭐ (22-ago-2026) — ✅ HECHA

**Lo pidió Daniel** (21-ago-2026): *"cuando no tengan proveedor los avíos, ya en la pantalla de
explosión, podemos hacer una forma de poder poner el proveedor de manera más rápida a varios
elementos que lleven el mismo proveedor"*. La decisión completa está en
`Documentacion_MJD/DECISIONES.md §Post-F9.88`.

### El punto de partida

§Post-F9.82 (V1-E3m) le dio al comprador el poder de **desatorar** asignando proveedor sin esperar a
Desarrollo, pero **renglón por renglón**: el formulario se abre *uno a la vez*. Con seis avíos del
mismo proveedor son seis veces el mismo tecleo — fricción pura, sin ganancia de control.

**Por qué en bloque aquí SÍ y firmar la receta NO** (§Post-F9.80): *lo que se puede hacer en bloque
es lo que **no compromete dinero***. Asignar proveedor no compra — la OC todavía pasa por la
**revisión previa** (§Post-F9.85) y por su **autorización**.

### Qué se construyó

1. **`backend/src/dominio/compras/proveedor-de-orden.ts` → `asignarProveedorDeMaterialEnBloque`.**
   **No valida nada por su cuenta: DELEGA** renglón por renglón en `asignarProveedorDeMaterial`,
   dentro de **UNA sola transacción** (A2; `enTransaccion` compone al recibir `{ tx }`). Es la
   decisión central de la etapa: una segunda ruta que validara *"casi"* igual —empresa, material en
   la receta, excluido, proveedor de baja— se desincronizaría de la de a uno en la primera
   corrección, y entonces **la vía rápida sería también la vía floja**.
2. **`ContextoLote` (A7)** — parámetro opcional nuevo de la función de a uno. Cada renglón sigue
   dejando **su** bitácora (el detalle no se pierde) pero los N llevan el **mismo `idLote`**, el
   total del acto y su posición; y se escribe además **un resumen por orden tocada**
   (`proveedorDeCompraEnBloque`). Así la bitácora dice *"seis en UN acto"* y no *"seis actos sueltos
   indistinguibles"*, que es lo que §Post-F9.88 exigía.
3. **`renglonesUnicos` (función PURA, exportada)** — quita duplicados `(orden, tipo, material)`
   conservando el orden. El tipo entra en la clave porque **la tela 7 y el avío 7 son materiales
   distintos**. Se extrajo a propósito: es la única pieza del acto que se puede —y se debe—
   ejercitar sin Postgres.
4. **`PUT /api/materiales/proveedor-en-bloque`** (`compras.administrar`, el mismo permiso que genera
   las OC). **Sin `:id` de orden** porque cada asignación nombra la suya: desde §Post-F9.86 una
   compra cubre varias OP.
5. **El panel en `ExplosionMaterialesPagina`** — arriba de los grupos, sólo con **2 o más** huecos:
   la lista de materiales sin proveedor con su casilla, «Seleccionar todos» / «Quitar selección», el
   selector de proveedor, el **alcance** (todas las OP de la compra, o una) y un **previo en texto**
   (*"se escribirán N renglones de receta en M órdenes; es todo o nada"*).

### ⬜ → ✅ Las decisiones que estaban abiertas y se cerraron al construir

**(a) *"Que sugiera a quién agrupar"* → NO se sugiere proveedor. Y la razón es del motor, no del
presupuesto.** Daniel dejó abierto si el sistema podía proponer el agrupamiento *"por proveedor
habitual, por el más barato, por lo que se compró la vez pasada"*. Verificado en
`backend/src/dominio/compras/proveedor-material.ts`: **el habitual y el más barato YA SON escalones
de la cascada** que elige proveedor (avío: `amarre → habitual → más barato → asignación de Compras`;
tela: `amarre → dueño → asignación de Compras`). Un material sólo cae en esta lista cuando
**ninguno** resolvió. O sea: **el sistema no se está callando una sugerencia que ya tiene — no la
tiene**; proponerla sería inventarla. Y la tercera vía —*"lo que se compró la vez pasada"*— sería
adivinar de un histórico y escribirlo **como hecho** en la receta congelada de la orden, que es
exactamente la trampa de §Post-F9.86. El que sabe *"estos seis son del mismo proveedor"* es el
comprador; lo que le faltaba no era la respuesta, era que decirla no costara seis formularios. Por
eso: **selección múltiple + «Seleccionar todos» + un acto**, y el panel dice **dónde se arregla para
siempre** (marcar el **habitual** del avío o el **dueño** de la tela en el catálogo hace que el
material deje de aparecer aquí — porque entonces sí hay escalón que resuelva).

**(b) El renglón 4 de 6 excluido → TODO O NADA, y el mensaje dice cuál.** Aplicar los buenos y
reportar los otros dejaría al comprador con una pantalla a medias que sólo entendería revisando
renglón por renglón —justo el trabajo que esta etapa vino a quitar— y con un *"algunos sí"* que nadie
termina de leer. Todo-o-nada es además lo único que A2 permite decir sin mentir: **o entró el acto, o
no entró**. El error conserva la clase (409 sigue siendo 409), nombra la **orden** y el **material**,
y remata con *"no se asignó NINGUNO de los N renglones"*.

**(c) El alcance lo elige el USUARIO, no el sistema.** La forma de a uno pregunta a cuál orden va
(§Post-F9.82: *"para esa OP en particular"*) y el acto en bloque **no podía inventar un "todas" que
nadie eligió**. Con varias OP en pantalla sale un select: **«Todas las órdenes de esta compra»**
(default) o **«Sólo la orden N»**. El default es "todas" porque son exactamente las OP que el
comprador armó arriba, y dejar a medias las demás volvería a apagar el botón de generar OC — el
atorón que esto vino a quitar.

**(d) En bloque sólo se PONE, y sin precio.** Quitar sigue siendo renglón por renglón: es deshacer
una decisión puntual y **se lleva el precio con ella** (regla ya vigente de §Post-F9.82). Y el
precio **es de cada material**: un mismo número para seis avíos distintos sería falso, así que el
cuerpo del acto en bloque **no lo lleva** — se captura por renglón o lo resuelve el catálogo.

**(e) El duplicado no infla el conteo.** Mandar el mismo par dos veces no cambia nada en la base
(el segundo `update` deja lo mismo) pero **sí** cambiaría el *"se asignaron 8"* que el usuario lee
como verdad y el `total` que queda en la bitácora. Se deduplica antes de escribir.

### Cómo se verificó (mutación, no sólo verde)

| Mutación | Resultado esperado | Lo que dio |
|---|---|---|
| Sacar el `tipo` de la clave del dedupe | cae **sólo** la prueba de "tela 7 ≠ avío 7" | **1 roja / 10 verdes** |
| Desactivar el dedupe (devolver todo) | caen las dos que miran el conteo y el orden | **2 rojas / 9 verdes** |
| Ignorar el **alcance** en el panel (mandar siempre todas las OP) | cae **sólo** la del alcance | **1 roja / 60 verdes** |
| Pintar el panel con **un** hueco y **sin mirar el permiso** | caen las dos del panel (+2 de V1-E3m, por el selector duplicado) | **4 rojas / 57 verdes** |

Pruebas: `proveedor-de-orden.test.ts` pasó de **3 a 11** unitarias (+3 de permisos A4 del acto en
bloque, +5 del dedupe) · **9** de
integración nuevas en `mrp.int.test.ts` (todo-o-nada con excluido, material fuera de la receta,
proveedor de baja, A9 con una orden ajena que tumba el acto entero, dedupe, la bitácora del lote, y
el caso multi-orden) · **8** de pantalla en `ExplosionMaterialesPagina.test.tsx` (incluida la del
aviso que sobrevive al desmontaje y la del material repetido en dos colores). Suites completas:
backend `test:unit` **1682/1682**, frontend `npm test` **1437/1437**.

### 🔴 Lo que el reviewer encontró y se corrigió antes de mergear

**La confirmación no se veía JUSTO cuando más importaba.** El mensaje de éxito vivía **dentro** del
panel… y el panel **se desmonta** en cuanto quedan menos de dos huecos. O sea que en el camino común
—«Seleccionar todos» y llenarlos **todos**— la confirmación **nunca aparecía**. Y la prueba original
no lo cazaba porque montaba un estado con dos huecos restantes: **verde sobre el caso que no es**.

Se arregló **por el lado del código, no del texto**: la confirmación salió del panel a un
`toast.success` disparado desde la **página** (que no se desmonta), en el `onSuccess` de la mutación.
Bajar la documentación al nivel de la conducta pobre habría sido resolver el problema escribiendo
peor — y *"se desmontó el panel"* no es una razón que Daniel pueda ver.
⚠️ **Y la prueba nueva ejercita EL caso real:** selecciona todos los huecos, la explosión responde
después **sin ninguno**, se comprueba que el panel **ya no está en el DOM** y que la confirmación
**sí se dio**. Mutación de verificación: devolver la confirmación al interior del panel (la conducta
vieja) la pone **roja** — 1 roja / 61 verdes, fallando exactamente en la aserción del aviso, con la
del panel desmontado en verde. *(El archivo del panel NO usaba `sonner`; sus vecinos del módulo
—`DialogoEditarOc`, `BandejaAutorizacionPagina`, `DialogoColoresDeTela`— sí, así que se siguió su
patrón.)*

**El previo se adelantaba al servidor.** El contador de renglones se calculaba **antes** del dedupe,
así que con una tela que sale en dos renglones por color (§Post-F9.89) la pantalla podía decir *"se
escribirán 2"* y el servidor escribir 1. Se dedupe ahora también del lado del cliente (`sinRepetir`,
espejo de `renglonesUnicos`) — **y no sólo el conteo: el cuerpo que se manda**, para que el previo y
el resultado digan lo mismo. El servidor sigue siendo quien manda (deduplica igual, A1).

**Y una malformación de comentario:** tres líneas del índice de endpoints de `mrp.rutas.ts` habían
perdido su prefijo `` * `` y colgaban dentro del bloque `/** … */`. Restituidas.

### Nota de cierre — ✅ HECHA (22-ago-2026)

**Sin migración, sin permisos nuevos, sin seed.** Reusa `compras.administrar` (el mismo de la de a
uno) y no toca el esquema: el deploy a `prueba` **NO requiere `SEED_ON_START`**.

**Lo que NO se hizo, y por qué:**
- **No se sugiere proveedor** — la razón completa arriba, decisión (a). Si algún día se quiere, el
  camino correcto **no** es esta pantalla: es **el catálogo** (habitual / dueño), que ya manda y ya
  está más arriba en la cascada.
- **No se toca `proveedor-material.ts`.** La política de a quién se le compra queda **idéntica**
  (§Post-F9.88 lo pedía explícitamente): esta etapa cambia cuántos renglones se capturan de un
  golpe, no quién gana.
- **Quitar en bloque, no.** No lo pidió Daniel y su semántica es distinta (arrastra el precio).
- **No se agrupó la lista por "posible proveedor".** Sin sugerencia que agrupar, un acordeón sería
  adorno: la lista plana con «Seleccionar todos» es lo que resuelve el caso real.

**Anotado y NO accionado** (con su razón, en `HOJA-DE-RUTA.md` §4): el acto corre con el **timeout
por defecto** de la transacción aunque el contrato admita 500 renglones (el caso real son ~6; elegir
el número sin medirlo sería inventarlo — fix de una línea al volver a tocar el archivo), y la
respuesta lleva un `asignados[]` **que la pantalla no pinta** (es el detalle de lo escrito, útil para
la API; recortarlo sería un cambio de contrato para ahorrar bytes que nadie paga).

## V1-E6b · EL ALTA DE COLOR SE ABRE DONDE SE COMPRA ⭐ (25-ago-2026) — ✅ HECHA

**§Post-F9.106.** Daniel, probando las OP 5562/5563/5564: *"Ya jaló los pantones desde la OC del
cliente. Ahora quiero comprar con esos pantones **pero no me deja**… me gustaría que acá pueda yo poner
los colores que voy a comprar."* Y al proponerle el diseño: *"Sí, está bien como lo propones. Darlo de
alta en ese momento. **Para el jueves sí es necesario**."*

### El terreno: dos colores, y está bien que lo sean

- **Color de la PRENDA** (`Color`, global): el de la matriz color×talla; trae el pantone que llegó de la
  OC del cliente (`OrdenLinea.pantone`).
- **Color de la TELA** (`TelaColor`): nombre LIBRE del proveedor (*"Marino Alsa 3040"*), con su **propio
  pantone**, precio y precio de complemento. Es lo que el almacén **recibe** y lo que el kardex guarda.
- `OrdenTelaColor` los amarra por orden y por renglón (§Post-F9.11 / V1-E4c).

El renglón ya dejaba **DECIR** de qué color se compra — pero **sólo ELEGIR entre los que ya existían**.
Sin colores, mandaba al catálogo: **fuera de la compra**, el defecto que V1-E4d ya había corregido para
las direcciones.

⭐ **La mitad difícil ya estaba hecha:** el pantone de la OP **ya viajaba** hasta ahí y el sistema ya
sabía proponer por *mismo-pantone*. **Faltaba la puerta, no el dato.**

### 🔴🔴 La mina que se esquivó por medirla ANTES de escribir

**No existía forma de agregar UN color a una tela.** La gestión es **SET-COMPLETO**
(`catalogos/telas.ts`: `deleteMany` de lo que no venga, luego updates, luego `createMany`).

⇒ **Reusar ese camino desde la compra habría BORRADO todos los demás colores de la tela.**

Se construyó `agregarColorATela` **aditiva**: un `create` y nada más, reusando lo que el set-completo ya
cuida (`bloquearColoresTela`, `exigirComplementoCoherente`, `claveNombreColor`, `pantoneONull`,
`idColor` NULL). *Buscar cómo se hace hoy antes de decidir cómo se hará mañana es lo que convirtió un
desastre silencioso en una función nueva de veinte líneas.*

### ⭐⭐ El permiso: se abre donde se compra, no donde se administra

El natural parecía `telas.administrar`. **Habría dejado la función inútil para quien la pidió:** ese
permiso se resta desde Directivo hacia abajo (`seed.ts:140-149`), así que sólo lo tienen Administrador y
AdministracionDireccion — y **Daniel acababa de dar de alta a AURORA con el rol Gerencial** para que
probara compras. **Gerencial no lo tiene.** La función habría existido para una sola persona.

Girado a **`compras.administrar`**, que no se recorta en ningún rol. El precedente ya estaba en el
sistema: **`fijarPrecioDeColor` escribe el catálogo —un PRECIO— con ese mismo permiso**. Si comprando ya
se puede fijar el precio de un color, dar de alta el color es del mismo orden.

El porqué quedó escrito en **tres sitios** (dominio, ruta y hook) con un **«no revertir por simetría con
el resto del catálogo»** explícito: *ésta es una puerta de la COMPRA.*

**Verificado con la mutación que importa:** revertir a `telas.administrar` —la "corrección por simetría"
que se teme— pone **9 de 23** pruebas en rojo.

### La desviación del coder, con la evidencia que la justificó

Se le pidió **girar** el `puedeAltaColorTela` del frontend. **Lo eliminó**, y no por gusto: hizo el giro
mínimo primero y corrió las pruebas. Al apuntarlo al mismo permiso que ya gatea el bloque de color
quedaban **dos nombres para un solo booleano**, y con ellos **una rama inalcanzable y un guard que
ningún caso puede poner en `false`** — o sea, inejercitable por prueba alguna. Archivar eso como menor es
lo que §7.3 prohíbe. **Un permiso, un gate**: esconder ocurre una vez y arriba; bloquear lo hace el
servidor (§Post-F9.68 intacto).

### Decisiones de diseño que se conservan

- 🔴 **Nombre duplicado = 409, NO "te devuelvo el que ya existe".** Devolver la fila vieja en silencio
  **descarta lo que el comprador acaba de capturar** y lo deja creyendo que se guardó — **compraría con
  otro precio**. Tampoco se sobrescribe la vieja: sus datos son de otra compra.
- **`nombreComplemento` viaja al renglón**: sin ese dato la pantalla ofrecería un campo de precio de
  complemento que el servidor va a rechazar — el control muerto que esta etapa vino a quitar.
- **El diálogo vive en `modulos/telas/`**, el módulo del catálogo al que escribe, para que Telas lo reuse
  y no nazca una segunda forma.
- **Precio y precio de complemento se piden pero NO se obligan** (default del lead, sin objeción de
  Daniel): obligar a capturar un precio que no se tiene sería la misma puerta cerrada que se lleva días
  quitando, y ese precio es **informativo** (el costo real va por lote).

### 🔴🔴 La noche de los tres reinicios

El contenedor se reinició **tres veces**, y el disco **se revierte**. La primera se llevó **una entrega
completa, terminada y validada, sin comitear**.

**Cómo se recuperó:** el trabajo se perdió, pero **el transcript del agente sobrevive**. Se le pidió al
**mismo** coder que **reaplicara** desde su propio contexto — mucho más barato que rehacerlo, y él mismo
verificó que la base había cambiado (`prueba` pasó de 0.023 a 0.024 mientras trabajaba) releyendo antes
de editar, en vez de reaplicar a ciegas. **De propina corrigió un dato que el lead le dio mal**
(`frontend/src/api/mrp.ts` no había cambiado; lo que cambió fueron los `mrp.ts` del *backend*).

**La regla que sale de aquí, y ya está en el recordatorio horario:**

> **Comitea EN CUANTO algo funcione**, aunque falte pulir. Comitear no es publicar — nada llega a
> `prueba` sin reviewer y CI. **Sólo git es durable.**

La tercera vez lo demostró: la regla ya estaba aplicada, y **los tres commits sobrevivieron intactos en
origin**. Sólo hubo que reubicar un commit de documentación que quedó sobre la rama vieja.

---

## V1-E6a · EL CIERRE PEDÍA 53 VECES DE MÁS, Y LA EXPLOSIÓN SE LO CALLABA ⭐⭐ (24-ago-2026) — ✅ HECHA

**§Post-F9.105.** Salió de **Daniel usando el sistema**: *"la compra de los cierres me está dando una
cantidad muchísimo mayor de la que necesito… no sé dónde está el error de cálculo"*.

**No era un error de cálculo.** Era un **dato contradictorio** que la explosión usaba **sin decir nada**.

### La contradicción

Un avío lleva por talla **una de dos cosas** (§Post-F9.66 existió para separarlas): **cuánto GASTAS**
(0.75 m de elástico en CH) o **qué MEDIDA pides** (el cierre de 53 cm, cantidad 1 pza). La regla que
decide es **una sola en todo el sistema** (`medidas-avio-talla.ts`, `exigirRenglonAvio` — hoy :166):

> `modoCaptura = avio._count.medidas(activo) > 0 ? 'medida' : 'consumo'`

⭐ El interruptor está en el **catálogo de Avíos**, no en el modelo: dar de alta una medida convierte al
avío en «por medida» **en todos los modelos donde aparezca**.

`requeridoAvioReceta` honra la bandera `consumoPorTalla`: encendida → `Σ(consumo_talla × piezas)`. Si en
una captura vieja la **longitud** (53) quedó en el campo de cantidad, el requerido sale **53× inflado**.

### 🔴 Por qué seguía vivo: la corrección fue PROSPECTIVA y nadie limpió lo viejo

- `copiarRecetaDelModelo` apaga la bandera al copiar (`receta-orden.ts:349`) — **desde el 18-ago-2026**
  (commit `a92c044`). Antes copiaba `consumoPorTalla: a.consumoPorTalla` **a secas**.
- Las **filas** de tallas se copian íntegras a propósito (D3: no se tira nada); sólo dejan de mandar.
- 🔴 **Ninguna puerta re-normaliza una OP existente:** `copiarRecetaDelModelo` se abstiene si ya hay
  renglones (`:265-270`); `traerDelModelo` **nunca escribe sobre un renglón existente** (`:2769-2777`);
  y `calcularDesalineacion` (`:674-820`) **sólo compara `consumoPorPrenda` y `precio`** → corregir el
  modelo **no levanta ni una alerta**.
- La migración de V1-E3g toca sólo `avios`/`avio_medida`: **ni un UPDATE** a `orden_avio`.

⇒ **Toda OP anterior al 18-ago-2026** con un avío de medidas activas puede traerlo. **No eran dos.**

### Qué entrega

**1. La explosión avisa — y avisa DONDE DUELE.** El `select` de `mrp.ts` no traía el conteo de medidas
activas: **el único hecho del que sale «es por medida»**. Ahora lo trae, y el aviso viaja **pegado al
renglón** (`RequerimientoSalida.avisos`, campo nuevo del contrato), no en la bolsa general.

⭐⭐ **Y esto fue una decisión, no un detalle.** Ya existía una caja `exp-avisos`, pero **no servía**: se
titula *«Notas de la explosión (precios y proveedores)»*, va en gris apagado y vive **después** de todos
los renglones. Soltar ahí un *"estás pidiendo 53× de más"* habría sido **mostrarlo y esconderlo a la
vez** — el patrón exacto que esta etapa vino a arreglar. Va en la línea siguiente al «Requerido …», en
tono de aviso, replicando el patrón de `exp-en-oc-sin-color`, que resuelve la misma clase de problema
tres líneas más abajo.

**El texto dice la MAGNITUD**, no sólo que hay una contradicción:
*«el requerido sale MULTIPLICADO por 53: 1,590 pza en vez de 30 pza: 1,560 pza de MÁS»* — el
multiplicador va pegado al TOTAL (1,590 = 53 × 30) y no a la diferencia (1,560, que es 52 ×).

**2. Una sola redacción, en tres pantallas.** El texto vive en `catalogos/unidades-avio.ts` —el módulo
que ya define la diferencia entre *cuánto gastas* y *qué medida pides*— y lo consumen las tres; lo único
que cambia por sitio es el *cómo se arregla*. *Si el aviso de pantalla y el de la explosión dijeran
cosas distintas parecerían dos reglas.* La **cuenta** vive aparte, en `receta-avios.ts`, que es de quien
es la regla R18.

⭐ **`requeridoContradictorioPorMedida` calcula el «normalizado» pidiéndoselo a `requeridoAvioReceta` con
la bandera apagada** — nunca reimplementando el requerido: dos definiciones del mismo número es
exactamente el hoyo del que salió todo esto. Y **calcula, NO corrige**: apagar la bandera en una LECTURA
sería el cambio callado que D3 prohíbe.

**3. El aviso salió del cajón.** En la receta de la OP vivía **dentro del desplegable colapsado**: se
podía tener la contradicción delante y no verla nunca. Ahora se pinta en la fila, junto a los chips, y
**con cifras también ahí**.

**4. Cualquier guardado normaliza.** `editarRenglonReceta` (`receta-orden.ts:1953`) perdió el
`&& datos.tallas !== undefined`: guardar sólo el precio ya cierra la contradicción — **que es lo que el
aviso llevaba meses prometiendo**. Y la medición de culpa que decide QUÉ error se explica mira los dos
hechos del renglón (avío por medida + bandera encendida), **no si el PATCH mandó la bandera**: el remedio
que documenta §Post-F9.105 —«Guardar medida por talla»— la manda EXPLÍCITA, y por ese camino salía el
mensaje viejo (*"des-autoriza la OC"*), que es el daño que la etapa vino a cerrar.

**5. El detector** (`migracion/analisis/avios-por-medida-contradictorios.ts`): solo lectura, por lotes,
lista las OP vivas afectadas con **el exceso de cada una**, si el renglón está **liberado** (sólo lo
liberado entra a la explosión) y si ese avío **ya tiene OC** (dónde ya salió el dinero). Usa la función
del dominio para la cuenta: *un detector que calculara por su cuenta podría discrepar de la explosión, que
es el tipo de divergencia que abrió este hoyo.*

**6. La revisión previa ya no es muda** — el hueco que el coder declaró y el lead mandó cerrar. Es **la
pantalla donde se confirma la compra**; que ahí saliera un renglón 53× inflado sin una palabra era el
mismo defecto en el momento más caro. No hizo falta join contra el snapshot: una consulta al lote, ya
filtrada a los renglones contradictorios. Y **la magnitud salió gratis** (bastó añadir `idTalla` a un
`select` que ya cargaba la matriz). Aquí **sí** sirve la caja que existe: la previa pinta sus avisos en
`warn-soft` bajo *«Se puede comprar así, pero revisa esto antes de firmar»* — el marco correcto, al revés
que la caja gris de la explosión. Va **primero** de la lista: los otros hablan de un dato que falta; éste,
de dinero que se va a gastar de más.

⭐ **El `where` filtra sólo por los dos hechos que definen la contradicción** —nada de `excluido` /
`liberadoEn`—: quién entra de verdad lo decide el **plan**. Filtrar en la consulta por un estado que pudo
cambiar *después* del snapshot podría **callar el aviso de un renglón que sí se está comprando**.

### ⚖️ El choque con la guarda de las OC: se MIDIÓ de quién es la culpa

Normalizar al guardar puede mandar el requerido a 0 (si el `consumoPorPrenda` congelado era 0) y disparar
`exigirNoSacarLoComprado` **en un PATCH donde alguien sólo cambió el precio**.

🔴 **La guarda NO se quitó** (hay dinero comprometido). En vez de eso se corre `sacaDeLaCompra` **una
segunda vez con la bandera vieja**: si el cambio del usuario también lo sacaba, la culpa es suya y el
mensaje de siempre es correcto; si la causa fue la normalización, el error **nombra la causa real y la
salida** —capturar el consumo por prenda en el mismo guardado— en vez de mandar a des-autorizar una OC
que está perfectamente bien. *La diferencia entre un mensaje que acusa y uno que informa.* Y hay prueba
de que esa salida **funciona**, no sólo de que se promete.

### El hueco de auditoría que se cerró sin pedirlo

La bandera se apaga **por decisión del sistema**, así que ahora aparece explícita en `cambios` de la
bitácora. *Un cambio que nadie pidió y que no se registra es indistinguible de uno que se calló.*

### 🔴 Las dos mutaciones que SOBREVIVIERON, y por qué valen más que las 18 que murieron

En la 1ª vuelta, la nº 13 —`porTalla.set(idTalla, cantidad)` en vez de acumular— **pasó en verde**. En la
2ª, el reviewer encontró la nº 14 (`conFolio` a "nunca prefijar"): **también verde**. Las dos por lo
mismo — cobertura que no llegaba, no código malo — y las dos cerradas con la prueba que faltaba.

**La 13 no era código malo: era un fixture pobre.** Tenía **una sola línea** de matriz, así que pisar en
vez de sumar no cambiaba nada. Pero **una OP real trae una línea por color**, con la misma talla repetida:
en cualquier OP multicolor el aviso habría dicho una magnitud **falsa**, y justo en el caso más común. Se
añadió el caso que faltaba (dos colores, 10+20 y 5+5 → 40 piezas) y se **re-aplicó: ROJO**.

**La 14 tampoco: era una regla sin dueño.** `conFolio` vivía como closure dentro de `proyectarRenglones`,
donde ninguna prueba podía alcanzarla. Se extrajo a `prefijarConLaOrden` —pura y exportada— y se fijó por
los dos lados: unitaria sobre la función y una aserción de integración con dos OP en el mismo renglón
agrupado. **Re-aplicada: ROJO.**

> *Fixture pobre, no código malo — pero el código no estaba protegido, que para el caso es lo mismo.*

### 🔴 2ª vuelta — lo que el reviewer RECHAZÓ (y por qué tenía razón)

**1. La medición de culpa no cubría el camino que ESTA MISMA decisión documenta.** Miraba si el PATCH
había mandado la bandera (`datos.consumoPorTalla === undefined`) — pero el remedio que §Post-F9.105 le
dice a Daniel que use, «Guardar medida por talla», **la manda EXPLÍCITA**. Por la puerta recomendada
salía el mensaje viejo: *"hay que DES-AUTORIZAR esas órdenes de compra"*. **El daño exacto que la etapa
dice haber cerrado, por el camino que nosotros mismos señalamos** — y con una promesa falsa impresa en
el detector (*"el error lo dice con esas palabras"*: por ahí no las decía).

La decisión se extrajo a `laCulpaEsDeLaNormalizacion` (pura, exportada, probada sin BD) y depende de
**tres hechos del renglón**, ninguno de ellos la forma del PATCH. ⭐ Con esa firma **el dato que causó
el defecto ni siquiera llega hasta la decisión**: no es una condición corregida, es una entrada que ya
no existe. Se conservó el término `porMedida` —que el arreglo propuesto no traía—: sin él, apagar a mano
el consumo por talla de un **elástico legítimo** recibiría el texto de la normalización y mandaría a
capturar un consumo que nadie tiene que capturar.

**2. El aviso salía sin nada que avisar.** Bandera encendida + **sin** cantidades por talla ⇒ R18 cae al
consumo por prenda y **el requerido es correcto**… y el aviso salía igual, diciendo *"las cantidades por
talla siguen contando"* cuando no hay ninguna. En la **receta** está bien (es donde se arregla, y una
captura futura lo inflaría); en la **explosión y la previa** era ruido amarillo colgado de un número
bueno, en la pantalla que **acaba de pasar por la limpieza de los nueve avisos** (§Post-F9.96, *"parecieran
que estamos haciendo algo mal"*). Ahora las dos preguntan `hayDescuadreDeRequerido` — una sola definición,
la misma que decide si el texto lleva magnitud. *Un aviso que grita sin motivo entrena a la gente a
ignorarlo, y entonces el que sí importa tampoco se lee.* El **detector** también separa las dos cifras:
cuántos renglones traen la contradicción y, **de ésos**, cuántos descuadran hoy.

**3. La mutación nº 14, que no estaba en la lista.** `conFolio` vivía como closure y **ninguna prueba lo
sostenía**: mutarlo a "nunca prefijar" dejaba todo en verde. Justo el caso en que el aviso sirve —varias
OP en pantalla, sólo una descuadrada— era el que nadie fijaba. Se extrajo a `prefijarConLaOrden` (pura,
probada) **y** se añadió la aserción de integración con dos OP en el mismo renglón agrupado.

**4. Punteros `archivo:línea` desfasados por el propio commit de la etapa**, en cuatro copias (una de
ellas fuera del repo, en el cuerpo del PR). Corregidos aquí y en `HOJA-DE-RUTA.md`.

**5. El paréntesis colgaba del número equivocado.** *"1,560 pza de MÁS (53 veces)"*: las tres cifras eran
exactas, pero 1,560 es **52×** de 30 — el 53 multiplica al TOTAL. Ahora encabeza la comparación
(*"MULTIPLICADO por 53: 1,590 pza en vez de 30 pza: 1,560 pza de MÁS"*).

**+ El hueco de auditoría HERMANO** (pre-existente, salió de tirar del mismo hilo): con
`consumoPorTalla: true` sobre un avío por medida se guardaba `false` y **la bitácora registraba `true`**.
Ahora se registra **lo que se guardó**, no lo que se pidió.

### La verificación

**20 mutaciones.** 12 rojas a la primera en la 1ª vuelta; la 13ª (fixture pobre, abajo); y **7 en la 2ª
vuelta**: quitar `porMedida` de la medición de culpa · ignorar si el usuario ya lo había vaciado ·
avisar sin descuadre en la explosión · lo mismo en la previa · **la nº 14 del reviewer** (nunca prefijar
la orden) · colgar otra vez el multiplicador de la diferencia · comparar los requeridos sin tolerancia.
Todas ROJAS y revertidas.

⚠️ **11 pruebas de integración NO se vieron ponerse rojas** (sin Docker; el juez es el CI): que guardar
sólo el precio normaliza, que la contradicción viaja hasta la salida, que un por-talla legítimo no la
lleva, el choque con la guarda de OC, las dos de la bitácora, las dos de la previa, el remedio documentado
con la bandera explícita, el mensaje de siempre en el caso legítimo, y el prefijo con dos OP.

### 🔴 Lo que NO hace, declarado y no enterrado

1. **La habilitación/surtido (`habilitacion-orden.ts`) muestra el mismo número inflado sin explicación** —
   usa el mismo `requeridoAvioReceta`. **Es el mismo arreglo en otro módulo.** Deuda con nombre.
2. **El impreso PDF de la explosión** no lleva el aviso (hoy no imprime ninguno).
3. **No hay backfill masivo.** Deliberado: es una escritura sobre órdenes vivas que **cambia lo que
   compran**, y §Post-F9.105 decidió que se arregla **guardando el renglón** (auditado). **El detector es
   la lista de trabajo.**
   > 🔁 **Actualizado por `V1-E8h` (§Post-F9.130, 27-ago-2026):** el remedio ya **no** es «guardar el
   > renglón» (un conjuro) sino el **botón «Corregir»** que vive junto al aviso. Lo que **sigue vigente
   > de este punto**: NO hay backfill masivo, y sigue esperando la palabra de Daniel.
4. **El detector sólo mira OP, no el BOM de los modelos.**
5. 🔴 **`calcularDesalineacion` sigue comparando sólo `consumoPorPrenda` y `precio`** — así que cambiar
   las medidas por talla de un modelo **no marca desalineada** ninguna OP. Es el hermano del defecto que
   esta etapa arregla, y **sigue abierto**.

---

## V1-E5 · LOS DÍAS DE CRÉDITO DEL CLIENTE: LA CARTERA DEJA DE MENTIR ⭐⭐ (24-ago-2026) — ✅ HECHA

**§Post-F9.98.** No salió de una revisión ni de una pantalla: salió de leer el código con la pregunta
*"¿qué de lo que va a producción está mal HOY?"*. Y estaba mal lo que más caro sale de tener mal.

### 🔴 El defecto: TODA la cartera de clientes envejecía como si fuera de contado

`Cliente.diasCredito` **ya existía** en el esquema (`prisma/schema.prisma:1179`) y **se podía capturar**
(contrato, ruta y campo en `DialogoCliente.tsx`). Pero `exigirTercero`
(`dominio/terceros/terceros.ts`) **no lo leía**: su `select` para el cliente pedía sólo
`{ nombre, activo }` y devolvía **`diasCredito: 0` a fuego**, con un comentario fósil que decía *"el
Cliente aún no tiene días de crédito (llega en E4)"* — **E4 había llegado hacía mucho**.

Como de ahí sale la fecha de vencimiento que se sella en cada cargo, **el aging de CxC agrupaba toda
la cartera como vencida antes de tiempo**. Una factura a 30 días capturada hace 20 aparecía en la
cubeta *«1 a 30 días vencido»* en vez de en *«corriente»*.

### ⭐⭐ Por qué llevaba tanto invisible: la ASIMETRÍA

Tres cosas lo escondieron, y las tres valen como lección:

1. **La rama del proveedor, tres líneas más abajo, SÍ leía su `diasCredito`.** O sea que CxP estaba
   bien y CxC mal, en la misma función. Mirando el archivo por encima, todo parecía simétrico.
2. **El ETL también estaba bien.** `migracion/loaders/terceros-saldos.ts:313-324` resuelve el plazo por
   su cuenta y ahí sí leía `diasCredito` **para los dos terceros por igual**. *El camino de carga era
   correcto y el camino vivo estaba roto* — así que cualquier revisión que mirara la migración daba
   verde.
3. 🔴 **Y NINGUNA prueba discriminaba.** `config-aging.int.test.ts:90` creaba su cliente con
   `diasCredito: 0` (*"Cliente contado"*), así que **pasaba idéntico con y sin el defecto**; y
   `terceros-motor.int.test.ts:146` sí probaba la derivación del vencimiento… **por PROVEEDOR**, la
   rama que nunca estuvo rota. *Había cobertura, y no cubría nada.*

### Qué entrega

- **Tres líneas de arreglo**: `diasCredito: true` en el `select` y `cliente.diasCredito ?? 0` en el
  return — **idéntico a la rama del proveedor**, no una segunda forma de decir lo mismo.
- **Los TRES comentarios fósiles BORRADOS**, y el encabezado del módulo reescrito para que diga lo
  que es verdad hoy. *(El commit dijo «los dos» y se equivocó: se le quedó vivo el del archivo
  hermano, `dominio/terceros/migracion.ts:44` —«Cliente = 0 (contado)»—, que era falso desde
  siempre porque el loader le pasa el `diasCredito` real del cliente. Lo cazó el reviewer; ver la
  sección del rechazo, abajo.)*
- ⭐ **Una prueba UNITARIA que sí corre aquí y que se pudo mutar de verdad**
  (`terceros.test.ts`, nueva). Su truco: el `tx` falso **respeta el `select`** —proyecta sólo lo
  pedido, como Prisma—, y por eso caza **las dos** formas de romperlo: devolver `0` a fuego, y quitar
  el campo del `select` dejando el `?? 0`.
- Dos de integración (**no ejecutables aquí**, corren en CI): el vencimiento sellado de un cliente a 45
  días, que **no se mueve** al cambiarle después los días al catálogo; y la cubeta del aging, que es
  donde el defecto se veía como negocio.

### La verificación

**Mutación medida por el lead** (no reportada por el coder): poner `diasCredito: 0` a fuego →

```
AssertionError: expected +0 to be 45
AssertionError: expected +0 to be 30
Tests  2 failed | 2 passed (4)
```

Archivo restaurado y comprobado idéntico. ⚠️ Las dos de integración **no se vieron ponerse rojas**
—son `*.int.test.ts` y el juez es el CI—; se dice así en vez de llamarlas verificadas.

### ✅ Lo prospectivo sale GRATIS (verificado, no supuesto)

§Post-F9.98 (e) pide que cambiar los días del cliente **no mueva las facturas ya emitidas**. No hubo
que construir nada: el vencimiento se **sella** en la columna `movimientos_tercero.fecha_vencimiento`
al crear el cargo (`cuenta-terceros.ts:194`) y el aging agrupa por **esa columna**
(`CURRENT_DATE - m.fecha_vencimiento`), **nunca recalcula desde el catálogo**. Queda afirmado con una
prueba, no sólo dicho.

*(Era el riesgo que podía haber convertido esto en una etapa mayor: si el aging recalculara, arreglar
los días habría movido retroactivamente facturas viejas. Se comprobó ANTES de tocar nada.)*

### 🔴 Lo que esta etapa NO hace, dicho y no enterrado

- **Editar el plazo factura por factura** (§Post-F9.98 (b)) **NO existe**: no hay endpoint, ni dominio,
  ni pantalla que modifique el `fechaVencimiento` de un movimiento ya creado. Es trabajo aparte
  —contrato + dominio + auditoría A7 + UI—, **no un remate de ésta**. Se difiere al post-arranque:
  **Finanzas no entra en la primera versión de producción**.
- 🟡 **NINGUNA de las dos pantallas de aging muestra la columna de días de crédito.** Ni
  `CxcPagina.tsx` ni `CxpPagina.tsx` referencian `f.diasCredito` —CxP pinta 7 columnas (Proveedor,
  Saldo, Corriente, 1–l1, l1+1–l2, +l2, Maquila) y CxC las mismas menos Maquila—, aunque **los dos
  backends ya la calculan y la mandan en cada fila**. No es un defecto de cálculo: es que el plazo
  no se ve, en las dos. **Y NO cambiaría el contrato**: `contrato/esquemas/cxc.ts:138` ya lleva
  `diasCredito: z.number().int()` en `esquemaBandejaCxcFila` (y `cxp.ts:149` su gemelo), así que
  pintarla es **un `<TablaDensaHead>` y una celda** — cero contrato, cero backend, cero migración.
  **Se difiere porque no toca antes del arranque**: Finanzas no entra en la primera versión de
  producción.
- 🟡 **La asimetría que SÍ estorba hoy: capturar el plazo del cliente a ciegas.** El catálogo de
  **Proveedores** enseña «Días de crédito» en su panel de detalle
  (`ProveedoresPagina.tsx:629`); el de **Clientes** no lo enseña en ningún lado **salvo dentro del
  diálogo de edición** (`DialogoCliente.tsx:404`), así que no hay manera de ver de un vistazo a
  qué clientes ya se les puso el plazo — justo lo que Daniel tiene que hacer cliente por cliente
  antes del ETL de apertura. Anotado, con el mismo motivo de diferimiento.

### ⚠️ EL CÓDIGO SANO NO ARREGLA LOS DATOS — precondición viva

**El ETL del catálogo de clientes NO carga `dias_credito`**, así que **todo cliente migrado nace en
`NULL` = contado**. Con el catálogo vacío, **el código arreglado produce exactamente la misma cartera
que el roto**.

🔴 **Por eso el ETL de apertura de Finanzas NO debe correrse antes de que Daniel capture los días de
crédito de sus clientes.** Es lo que hace que este arreglo sirva de algo.

### 🔴 EL RECHAZO DEL REVIEWER — y lo que rechazó NO fue el código

El reviewer independiente **RECHAZÓ la etapa**. Vale escribir lo que encontró, porque el patrón es
más caro que el defecto original: **las tres cosas que estaban mal eran afirmaciones de
DOCUMENTACIÓN, no de código.** El arreglo pasó limpio —lo verificó él mismo—; lo que falló fue **lo
que se dijo sobre él**.

1. 🔴 **Una frase falsa que además la lee Daniel.** El historial, `HOJA-DE-RUTA.md` y esta misma
   ficha decían *"CxC no muestra la columna de días de crédito; CxP sí"*. **Es falso: no la muestra
   ninguna de las dos.** `CxpPagina.tsx:235-243` pinta 7 columnas y **nunca** referencia
   `f.diasCredito`; en CxC, igual. Los dos backends la calculan y la mandan; los dos frontends la
   tiran. La cita que se dio como prueba (`cxp.ts:257`) es **un `SELECT` de backend usado para
   afirmar lo que se ve en pantalla** — no prueba nada de la UI.
2. 🔴 **Una razón técnica inventada.** Se cerró el diferimiento con *"cambiaría el contrato"*. **No
   lo cambiaría:** `contrato/esquemas/cxc.ts:138` **ya** lleva `diasCredito: z.number().int()` y el
   backend ya la llena en cada fila; pintarla es un `<TablaDensaHead>` y una celda. Diferirlo era
   legítimo —**no toca antes del arranque**—; inventarle una razón técnica, no.
3. 🟡 **Un TERCER comentario fósil vivo.** El commit presumió de haber borrado *"los dos"*. Eran
   **tres**: quedó en pie `dominio/terceros/migracion.ts:44`, que afirmaba *"Cliente = 0
   (contado)"* siendo que el loader (`loaders/terceros-saldos.ts:324`) le pasa el `diasCredito`
   real del cliente **desde siempre**. Es **el mismísimo mecanismo** que mantuvo el defecto
   invisible durante meses: un comentario que describe un mundo que ya no existe, en el archivo de
   al lado.

⚠️ **Y es REINCIDENCIA.** A este mismo track le pasó hace pocos commits: `8ce012b docs · la razón
para rechazar la simplificación era falsa: medida y corregida` — también un rechazo por **una
frase**, también una **razón para NO hacer algo** que nadie comprobó. **La lección, escrita para que
no haya una tercera vez:** *una razón para NO hacer algo se verifica exactamente igual que una para
hacerlo. Si no, la próxima sesión la hereda como verdad* — y una razón falsa es peor que ninguna,
porque cierra la puerta con llave.

**La lección de fondo de esta etapa:** en una etapa que **fue a cazar comentarios fósiles**, se dejó
uno en pie en el archivo hermano y se escribieron **tres frases nuevas que no se verificaron**. Ir a
cazar afirmaciones caducas no inmuniza contra escribirlas.

### ✅ Crédito al reviewer

- **Verificó las dos mutaciones por su cuenta**, sin creerle al reporte — incluida la de **quitar el
  campo del `select`**, que además **rompe el typecheck**, así que esa queda cazada **por partida
  doble** (tipos + prueba).
- **Dio por buena la desviación deliberada del coder en la prueba de aging, y tenía razón.** El
  borde exacto que pedía §Post-F9.98 (cargo fechado justo a `diasCredito` días) dejaba el resultado
  **a un día de cambiar de cubeta** y ataba la prueba a que el `CURRENT_DATE` del servidor y la
  fecha UTC del cargo cayeran el mismo día: **roja o verde según la hora a la que corriera el CI**.
  Con 30/20 —10 días de holgura a cada lado— **discrimina exactamente lo mismo** sin la trampa
  horaria. Apartarse de la letra del pedido fue **la decisión correcta**, y por eso queda escrita.

---

## V1-E4f · LA BARRA DE LA COMPRA: FECHA A FUERZAS, Y EL ALTA DENTRO DEL DESPLEGABLE ⭐ (24-ago-2026) — ✅ HECHA

**Dos decisiones de Daniel que van juntas porque viven en la misma barra de «Explosión de
materiales»**: §Post-F9.103 (la fecha de entrega es obligatoria) y §Post-F9.104 (el alta de dirección
se mete al desplegable). Las dos salieron de él **usando el sistema**, mirando la 0.020.

> *"La [fecha] de entrega no debería de poder estar vacía. **Tiene que tener fecha de entrega a
> fuerzas**."*
> *"**Está mejor dentro del cuadro desplegable. Casi no se va a usar. No tiene caso tener un botón para
> eso**."* (viendo el botón «＋ Dirección» suelto en la barra)

### ⭐⭐ El hallazgo: la fecha ya se exigía en dos de las tres puertas — y la tercera era DUPLICAR

Lo primero que hizo el coder no fue construir, fue **medir dónde faltaba de verdad**. Y resultó que
casi todo estaba hecho:

| Puerta a una OC nueva | ¿Exigía fecha ANTES de esta etapa? |
|---|---|
| Alta manual (`crearOC`) | ✅ sí — el contrato la pide, no es opcional |
| Explosión (`planearCompra` → `generarOCDesdeExplosion`) | ✅ sí — devuelve la falta como **bloqueo** |
| 🔴 **Duplicar (`duplicarOC`)** | ❌ **NO** — copiaba `fechaEntrega` tal cual |

🔴 **Y eso no era teórico.** `fecha_entrega` es **nullable**, y el ETL escribe `null` cuando el CSV
viene en blanco (`ordenes-compra.ts:354`, `parsearFechaSoloDia`) — así que entre las **7,978 OC
migradas** del sistema viejo, **cualquiera que llegara sin fecha era una puerta abierta**: duplicarla
paría hoy una OC **NUEVA** sin fecha. Un documento que nace mudo sobre el *cuándo*, con el que no hay
compromiso que reclamar, ni retraso que medir, ni nada que meter a la ruta crítica.

⚠️ **Cuántas de las 7,978 están así, NO se midió**: los CSV del volcado no están en este contenedor
(sólo los `__fixtures__`). El defecto no necesita el conteo —basta con que la puerta exista—, pero
**la cifra no se afirma**.

⚠️ **La regla es PROSPECTIVA y se respetó** (decisión (e)): la OC vieja **se queda como está**. Lo que
se cierra es que su defecto **se propague a una nueva**. Y el mensaje dice el camino en vez de sólo
negarse: *"captúrasela primero (Editar › «Fecha de entrega») y vuelve a duplicarla"*.

### Qué entrega

- **`motivoNoDuplicarOc(origen)`** en el dominio (pura y exportada, para que una prueba la vea **sin
  base de datos**), consumida por `duplicarOC` **dentro de su transacción**, antes de tomar folio.
- **En la pantalla, el aviso de fecha con el MISMO trato que el de dirección** (§Post-F9.96):
  **instrucción gris** al abrir, **amarillo sólo al intentar generar** sin haberla llenado, y **el foco
  al campo donde se arregla**. Daniel pidió expresamente que las dos se comportaran igual *"para que
  nadie tenga que aprender dos reglas"*.
- ⭐ **Los dos faltantes se dicen de un solo golpe, no en cascada.** Con fecha Y dirección vacías, un
  `return` temprano habría dejado el segundo en gris: el comprador arregla uno, da otro clic y se
  encuentra un amarillo nuevo. Se evalúan **las dos** antes de frenar.
- **`ocPlaneadasEnPantalla` + `ocSinFechaDeEntrega`**, puras y exportadas.

### ⭐⭐ Lo que la validación mira: EL PLAN, no el formulario

Éste es el matiz que hacía fácil equivocarse. §Post-F9.71 ya había fijado que **la fecha propia del
proveedor GANA** y que la de arriba es sólo *el valor inicial de todas*; §Post-F9.18 añadió el respaldo
de las OP. Entonces **lo obligatorio es que cada OC tenga fecha, NO que el campo de arriba esté
lleno**: pedir el campo de arriba sería reclamar un dato que ya está capturado en otro lado.

La cascada de la pantalla es **la misma del servidor, en el mismo orden** — verificado leyendo
`resolverFechasDeOc` (`mrp.ts`, busca por nombre): `fecha propia del proveedor ?? fecha base ?? la
entrega más próxima de sus OP ?? falta`. El respaldo del servidor es no-nulo **si al menos una** de las
OP trae fecha, que es exactamente el predicado que usa la pantalla.

⚠️ **Su margen de error, dicho en el código:** la pantalla **no puede** reproducir el plan entero (el
servidor aplica además la firma de Desarrollo y los ajustes del comprador). Así que se le pidió lo
contrario de la precisión: **que jamás bloquee de más**. Lo peor que puede pasar es que se pida una
fecha de más; **nunca** que se genere una OC sin ella — porque **la autoridad sigue siendo el
servidor** (A1), que devuelve la falta como bloqueo y rechaza la generación con o sin pantalla de por
medio. Esto es la manera de **decirlo a tiempo**, no la regla.

🔴 El grupo **sin proveedor sugerido** no genera OC ninguna, así que **no se le pide fecha**: reclamarla
sería bloquear la compra por un documento que no existe.

### §Post-F9.104 — por qué el botón se fue adentro

⚖️ **No contradice §Post-F9.96, la AFINA.** Aquella dice *"primero que dé la opción de meterlo"*, y la
opción **sigue estando a un clic**, en el mismo control donde ya estás mirando. Lo que se corrige es el
**peso visual**: *la frecuencia manda sobre la barra*. Un botón permanente le quitaba espacio a lo que
se usa a diario —el selector, la fecha, «Revisar y generar OC»— para servir a un caso excepcional.
**Ruido permanente por un caso raro es la misma falla que los nueve avisos amarillos.**

Dos detalles que **no** son cosméticos:

- La opción va **al final y separada** por un `<option disabled>` para que no se confunda con una
  dirección real.
- 🔴 **Se pinta aunque el catálogo esté VACÍO** — que es justo cuando más se necesita. Esconder la única
  puerta detrás de una lista sin elementos dejaría al comprador **sin salida**, y ése era precisamente
  el defecto que V1-E4d había arreglado.
- `OPCION_NUEVA_DIRECCION = 'nueva'` se compara **antes** de convertir a número: `Number('nueva')` es
  `NaN`, y un `NaN` viajando como `idDireccionEntrega` sería exactamente el dato inventado que
  §Post-F9.86 prohíbe.
- **Esconder Y bloquear** (§Post-F9.68): sin `compras.administrar` la opción no se pinta —mismo trato
  que el botón al que sustituye— y el servidor rechaza el alta igual.

### El accidente de la noche, y por qué no costó nada

🔴 **El coder original MURIÓ a media faena** (error del servidor, *API 529 Overloaded*, 04:02). No lo
detectó el estado del proceso sino **la fecha de modificación de sus archivos**: dos horas y media sin
escribir. Su trabajo estaba **intacto y sin comitear** en el árbol.

**Lo que lo salvó:** el árbol de trabajo es durable dentro de la sesión y **nadie más lo estaba
tocando** (la regla de UN CODER A LA VEZ, que ya había costado un choque el 13-ago). Un segundo coder
lo remató desde ahí, con el encargo explícito de **revisar lo que el muerto dejó** — nadie lo había
mirado.

**La lección, para la próxima:** *la señal de vida de un agente es el `mtime` de lo que escribe, no que
el proceso siga listado.*

### 🔴 El mensaje mandaba por un camino CERRADO (hallazgo del segundo coder, arreglado en la misma ronda)

`motivoNoDuplicarOc` decía *"captúrasela primero (Editar › «Fecha de entrega»)"*. Pero:

- el ETL le hereda a cada OC migrada **el estatus que traía de Access**
  (`migracion/loaders/ordenes-compra.ts:212`, `estatusOCMigrada`: **`cancelada` > `autorizada` >
  `borrador`**, en ese orden — ⚠️ **no "nacen autorizada"**, como esta ficha llegó a afirmar), y
- `actualizarOC` **bloquea al no-admin** sobre una OC autorizada (`ordenes-compra.ts:957-960`:
  *"solo un administrador puede modificarla"*).

O sea que a un comprador sin `roles.administrar` se le ofrecía **una salida cerrada**: daba la vuelta
completa para toparse con otro "no". ⚠️ **Es EXACTAMENTE el defecto que un reviewer ya cazó en este
mismo track** —*una pantalla que le echa la culpa al comprador de algo que el sistema no le dejó
hacer*— y por eso no se archivó como menor.

**Arreglo:** la función recibe también el **estatus** y, cuando no está en `ESTATUS_EDITABLES_NORMAL`,
el mensaje añade que esa captura **la tiene que hacer un administrador**. 🔴 **A propósito NO recibe la
sesión ni `esAdmin`**: el estatus basta para decir la verdad y así la función **sigue siendo pura y sin
base de datos**. Que un admin lea *"la tiene que hacer un administrador"* es inofensivo; que un
comprador **no** lo lea, no lo es.

*Un mensaje que ofrece una salida cerrada es peor que uno que no ofrece ninguna.*

⚠️ **Dicho sin adornos, porque el propio coder lo levantó:** el mensaje **dejó de mentir, no dejó de
ser un rebote**. El comprador sigue sin poder resolverlo él mismo — ahora sabe a quién acudir, que es
estrictamente mejor, pero no es lo mismo que resolverlo. **Resolverlo en el acto** (pedir la fecha
dentro del propio duplicar) **sería alcance nuevo**, y queda anotado como tal: no se hizo, y se dice.

⭐ El mensaje **nombra el estatus que cerró la puerta** en vez de decir «autorizada» a secas: la
mención vale igual para `recibida_parcial`/`recibida_total`, y afirmar «autorizada» ahí sería
sencillamente falso.

🔴 **Y esa frase, tal como se escribió, incluía `cancelada` — que es EXACTAMENTE lo contrario de lo
que hace el código.** La escribió el lead, y es la frase que habría cazado el hallazgo de abajo antes
de que llegara al PR: quien la leyera se quedaba con que a la cancelada la edita un administrador. No
lo hace nadie.

### La verificación: 20 mutaciones, todas ROJAS

No se afirmó nada que no se hubiera visto ponerse rojo. Las dos que el lead pidió explícitamente
—**quitar la opción del desplegable** y **reponer el botón suelto**— están entre ellas.

| Qué se rompió a propósito | Pruebas que se pusieron rojas |
|---|---|
| quitar la opción «＋ Nueva dirección…» | 7 |
| **reponer el botón suelto** (dejando la opción) | 1 |
| la opción al principio de la lista / sin separador | 1 · 1 |
| pintarla también **sin** `compras.administrar` | 1 |
| **no** pintarla con el catálogo vacío | 5 |
| tratar `'nueva'` como id (el `NaN` al servidor) | 4 |
| la fecha deja de bloquear en `revisar()` | 3 |
| ignorar la fecha propia del proveedor / la de arriba | 1 · 1 |
| ignorar el respaldo de las OP | **50** |
| tocar la fecha no baja la marca del intento | 1 |
| decir los dos faltantes **en cascada** | 1 |
| pedirle fecha al grupo **sin proveedor** (las DOS guardas a la vez) | 2 (hoy 4, ver abajo) |
| el aviso de fecha **siempre** amarillo | 2 |
| ignorar el mínimo guardable | 1 |
| `motivoNoDuplicarOc` nunca se queja (backend) | 1 |
| ignorar lo MARCADO en `ocPlaneadasEnPantalla` (bloquear de más) | 1 |
| **borrar la mención del administrador** | 1 |
| ponerla SIEMPRE (también en `borrador`) | 2 |

⭐ **La de integración es la única que mata «quitar la llamada en `duplicarOC`»**: anula la
`fechaEntrega` por Prisma —como las migradas—, exige el rechazo y comprueba que **no nazca una segunda
OC**. Corre en CI, no aquí (nada de Docker).

### 🔴 Un FALSO VERDE del lead, otra vez — y esta vez lo cazó el coder

El lead reportó los comandos del frontend en verde, **`format:check` incluido**. Estaba en **ROJO**:
`ExplosionMaterialesPagina.tsx` no pasaba Prettier (un `<option>` partido en cuatro líneas que cabía en
una). La medición se hizo **antes de la última edición** y no se repitió.

Es **la misma cicatriz del 14-ago-2026** con otro disfraz: allá fue validar con un comando suelto en vez
del `npm run`; aquí fue validar **a tiempo pasado**. La regla que faltaba, y queda escrita:

> **Una validación sólo vale para el árbol que se midió.** Si se tocó un archivo después, la medición
> ya no dice nada — y "lo corrí hace rato" no es haberlo corrido.

Y la que ya estaba y sigue mandando: **el CI es el único juez**. Habría salido rojo ahí, después del
commit y del PR.

### 🔴🔴 EL RECHAZO DEL REVIEWER (5 hallazgos, arreglados todos en la misma ronda)

El reviewer independiente **RECHAZÓ** el commit. Ninguno se archivó como "menor" (regla de la casa).

**H1 (bloqueante) — `motivoNoDuplicarOc` MENTÍA con la OC `cancelada`.** El arreglo del segundo coder
—*"esa captura la tiene que hacer un administrador"*— metió a `cancelada` en la rama del admin, porque
`ESTATUS_EDITABLES_NORMAL` no la contiene. **Es falso: a una cancelada no la edita NADIE, admin
incluido.** `actualizarOC` la rechaza con *"La orden de compra está cancelada; no se puede modificar"*
**antes** del chequeo de admin, y `cancelada` es terminal (el dominio no des-cancela).

⚠️ **Y era el flujo REAL, no un caso de laboratorio:** el ETL produce canceladas en su **primera**
rama (`estatusOCMigrada`) y les escribe `fechaEntrega: null` con el CSV en blanco; `duplicarOC` **no
tiene guarda de estatus**, así que *"rehacer esa compra que se canceló"* es legítimo. Ese comprador
leía *"…la tiene que hacer un administrador"*, iba a Editar y se topaba con *"está cancelada; no se
puede modificar"*: **callejón sin salida, para todos** — el defecto exacto que esta etapa existía para
cerrar.

> ⭐⭐ **LA LECCIÓN, y es de las que se repiten: se copió el predicado sin copiar la guarda que lo hacía
> cierto.** En `actualizarOC`, `!ESTATUS_EDITABLES_NORMAL.includes(estatus)` significa *"sólo un admin
> edita"* **únicamente porque la línea de arriba ya sacó `cancelada` del camino**. En
> `motivoNoDuplicarOc` se copió la condición y **no la guarda**. No eran dos listas parecidas: era la
> **misma lista despojada de su guarda**. Cuando un predicado se muda de lugar, lo que hay que copiar
> no es la línea — es **lo que la hace verdadera**.

**Arreglo:** `cancelada` tiene ahora su **propia rama**, primero y aparte (igual que en
`actualizarOC`), que dice la verdad y ofrece **la salida que sí existe**: la orden nueva se levanta a
mano en Compras › Nueva, con su fecha. El unit recorría `['autorizada','recibida_parcial',
'recibida_total']` y **omitía justo `cancelada`**; hoy la cubre y exige que el mensaje **no** prometa
un administrador ni mande a «Editar».

**H2 — la premisa del ETL estaba al revés en TRES documentos.** *"Las OC migradas nacen
`autorizada`"* es falso: `estatusOCMigrada` reparte **`cancelada` > `autorizada` > `borrador`**.
Corregido en el docstring del unit, en `HOJA-DE-RUTA.md` y en esta ficha. 🔴 **La peor era la de esta
ficha**, que afirmaba que la mención del administrador *"vale igual para `cancelada`"* — **lo
contrario exacto de lo que hace el código**, y la frase que habría cazado H1 antes del PR. **La
escribió el lead**, y así queda dicho.

**H3 — las dos guardas del "grupo sin proveedor" no estaban cubiertas por separado.** El reviewer
**midió**: neutralizar `if (idProveedor === null) continue;` **o** `r.idProveedorSugerido !== null`
por separado dejaba las 140 pruebas del archivo en VERDE; sólo las dos a la vez ponían 2 en rojo. No
es un bug (con los datos del servidor una implica la otra: `agruparPorProveedor` agrupa JUSTO por
`idProveedorSugerido`), pero el comentario 🔴 afirmaba dos reglas y las pruebas fijaban su conjunción.
**Arreglo:** 4 pruebas **directas** de `ocPlaneadasEnPantalla` (es pura y exportada, no hace falta
renderizar) con la forma incoherente que el tipo permite y el servidor no produce. Cada guarda cae
sola: **MUT guarda-grupo → 1 roja · MUT guarda-renglón → 1 roja · las dos → 4 rojas**.

**H4 — la 0.022 prometía de más: *"puede pedirte fecha de más, nunca de menos"*.** Leído literalmente
es falso: la pantalla **sí puede callarse mientras el servidor bloquea**. `ocPlaneadasEnPantalla`
armaba `idsOrden` con **todo** `porOrden`, sin filtrar por pendiente, así que una OP con pendiente 0
—ya cubierta por otra OC viva— aportaba su fecha de respaldo a la pantalla aunque el servidor la
omita (`motivoDeOmision` mira el pendiente **de cada OP**). **Se arregló de las dos maneras:** la
frase se corrigió (queda sólo lo cierto: *nunca deja pasar una OC sin fecha*, **la autoridad es el
servidor**), y como `porOrden` **sí trae su propia `cantidadPendiente`** —se comprobó en
`esquemaRepartoOrden` antes de tocar nada—, el filtro se alineó con el servidor **en una línea**.

**H5 — el comentario de `MINIMO_GUARDABLE` afirmaba una identidad que no existe.** Decía que era *"el
mismo corte que el servidor"*: no lo es —**0.01** en la pantalla contra **0.005**
(`MINIMO_CANTIDAD_COMPRA`) en el servidor—. Son *equivalentes* sólo porque el pendiente de cada OP
llega **ya redondeado a 2 decimales**. Hoy el comentario dice que la pantalla es **más estricta**, por
qué eso es seguro (lo que cuenta la pantalla ⊆ lo que cuenta el servidor) **y qué lo rompería**: si
ese redondeo previo desapareciera, la pantalla sumaría astillas que el servidor descarta una por una
y empezaría a **bloquear de más** — el único error que esta comprobación no se puede permitir.

---

## V1-E4e · EL IMPRESO DE LA OC: CONSOLIDADO Y SÓLO AUTORIZADO ⭐ (24-ago-2026) — ✅ HECHA

**Dos decisiones de Daniel que van juntas porque tocan el mismo PDF**: §Post-F9.101 (una OC sin
autorizar no se imprime) y §Post-F9.102 (el impreso se consolida para el proveedor). Las dos salieron
de él **usando el sistema**, no de una revisión técnica.

> *"Nunca debe de dejar imprimir una orden que no esté autorizada… **ni aunque diga borrador**. Para no
> generar confusiones con el proveedor."*
> *"Acabo de generar la OC 7965… **para el proveedor debe de salir solamente una sola cantidad sumando
> todo el rojo**. Ya de manera interna se divide."* · *"Las órdenes a las que corresponden **no son
> relevantes para el proveedor**."*

### Las tres vistas del mismo hecho

⚖️ La consolidación **no contradice §Post-F9.86, la completa**. Aquella decía *"se ve junto y se guarda
repartido"*; faltaba **la tercera cara: lo que sale a la calle**.

| Vista | Quién la lee | Qué muestra |
|---|---|---|
| **Guardado** | el sistema | una línea por **material × OP** (costos, surtido) — **intacto** |
| **Pantalla** | el comprador | junto, **con** el desglose por OP (es su control) — **intacto** |
| ⭐ **Impreso** | **el proveedor** | **una cantidad por material**, **sin** folios de OP |

### Qué entrega

- **`motivoNoImprimirOC(estatus)`**, pura y exportada, **reusando `ESTATUS_OC_COMPROMETIDA`** — no se
  escribió criterio nuevo. ⭐ De ahí **la cancelada sale gratis**: no está en la lista, así que no hay ni
  una línea escrita para ella. *La mejor señal de que el criterio era el correcto.*
- **Guarda en el SERVIDOR** (`ErrorValidacion` 400) antes de armar nada, no sólo esconder el botón
  (§Post-F9.68). El botón se esconde **y dice por qué**, con **exactamente las mismas dos frases** que
  el servidor —*si el aviso de pantalla y el 400 dijeran cosas distintas parecerían dos reglas*—.
- **`consolidarRenglonesParaProveedor`** (pura, exportada). **Regla de fusión:** mismo material (por
  ids) · misma unidad · **mismo precio** · **mismo precio efectivo de complemento**. Con cualquiera
  distinto **no se fusiona** — nada se promedia.
- 🔴 **`LineaImpresoOC` PIERDE el campo `folioOrden`** — se quitó del **tipo**, no sólo del render: *sin
  campo, ningún cambio futuro lo recuela.* `grep folioOrden` en el módulo = **0**.
- **Las matrices talla×color de los renglones fusionados también se suman** — si no, el papel se
  contradiría a sí mismo (arriba 160, abajo 100).

### ⭐ El defecto PRE-EXISTENTE que el coder destapó, reportó y (por decisión del lead) arregló aquí

**El impreso nunca había mostrado el complemento de tela (el Cardigan)** — pero **su importe SÍ estaba
sumado** en el renglón. O sea: en una tela con complemento **`cantidad × precio ≠ importe`**, el
proveedor **no podía reconstruir la cifra** y **ni se enteraba de que además tenía que mandar el
Cardigan**. La pantalla del comprador **sí** lo mostraba; **el papel se lo callaba**.

El coder lo reportó **sin arreglarlo**, con su razón (fuera del alcance de las dos decisiones; la
consolidación no lo empeora; qué imprimir con el complemento vacío es decisión de Daniel). ⚖️ **El lead
decidió arreglarlo aquí**, y la razón importa: Daniel pidió estas dos decisiones con la frase *"para no
generar confusiones con el proveedor"* — *entregar una etapa que arregla el impreso para que no confunda
al proveedor, dejando dentro una confusión mayor, sería incoherente.*

Ahora el Cardigan **cuelga de su tela**, indentado, con **dos frases que responden dos preguntas
distintas**: *"¿qué más tengo que mandar?"* y *"¿de dónde sale este importe?"*.

⭐ **La aritmética, y la ronda que la puso en su sitio.** El importe del cuerpo se calcula con **lo que
el proveedor ve en la fila** y el del complemento se lleva **el resto**, de modo que las dos cifras
impresas cuadren contra el importe del renglón.

🔴 **Y aquí está el hallazgo más caro de la etapa, que el reviewer cazó y era REAL:** con el
complemento a **precio 0** y dos renglones fusionados, **el polvo del redondeo excedía su valor y el
impreso sacaba un importe NEGATIVO** — `+ $-0.01 de Cardigan`. **Frecuencia medida: 12.1 %** de ese
escenario sobre 5,000 casos aleatorios. Y **alcanzable, no teórico**: `precioComplemento` admite `0`,
la UI lo captura libre, y basta un Cardigan *"incluido"* a $0 con la misma tela pedida para dos OP —
**el caso exacto de la OC 7965 de Daniel**. Al proveedor le habría llegado un papel con un número
absurdo: *peor que callar el Cardigan*, porque un negativo invita a una llamada o a una factura mal
hecha. Cerrado con un tope (`Math.min`) que, **por construcción, impide que cualquiera de las dos
mitades baje de cero**.

⚖️ **Y una corrección de rumbo del propio Daniel, que vale más que el arreglo.** El reviewer traía tres
hallazgos y el lead los escaló los tres a una ronda de pruebas de centavos. Daniel cortó:
> *"**No importan los centavos así. No te claves en eso. Por un centavo.**"*

Tenía razón, y el alcance se recortó a lo que de verdad importa: **el negativo se arregla por el SIGNO,
no por el centavo** —un `$-0.01` impreso se lee como un sistema roto—, y **todo lo demás del tema se
soltó**. ⚠️ **Con una consecuencia que se escribe, no se calla:** al fusionar, `cantidad × precio` puede
diferir del importe **por un centavo** (medido: ~25 % de las fusiones). *Es irreducible* —el total de la
OC está fijado y el centavo tiene que caer en algún lado— así que **la etapa dejó de prometer que la
cuenta cuadra a la vista** en lugar de perseguirlo. *Una promesa que no aporta al negocio no se cumple:
se retira.*

🔴 **Y una afirmación FALSA de esta misma ficha, corregida:** decía que esa aritmética estaba *"fijada
con prueba"*. **No lo estaba** — el reviewer sustituyó el resto exacto por un recálculo y **la suite
completa pasó**, porque todas las pruebas usaban **números redondos**, donde las dos ramas coinciden.
Habría sido la **quinta** afirmación del track que se lee como verificada sin estarlo, y **la escribió
el lead** repitiendo el reporte del coder sin comprobarlo. *Y no era sólo documentación: una prueba con
números feos habría destapado el negativo por su cuenta.* Hoy ese mutante **sobrevive por decisión
declarada**, no por descuido: con el negativo tapado, lo único que distingue las dos ramas es un centavo
del desglose, y el negocio dijo que ese centavo no importa. **El TOTAL sí sigue fijado con prueba** —eso
es dinero—. *Si algún día el desglose importa al centavo, ése es exactamente el mutante que hay que
escribir.*

⭐ **El coder rechazó una simplificación que el lead le ofreció — la DECISIÓN era correcta, pero la
razón que se escribió NO, y el reviewer la midió.** Decía que recalcular las dos mitades *"no quita el
negativo, lo cambia de lado"*. 🔴 **Imposible tal como estaba escrito:** `cantidad × precio` es el
producto de dos números no negativos (`cantidad` es `.positive()`, `precio` es `.min(0)`), así que
**nunca puede dar `−0.01`** — una tela a ~$0 da `0.00` exacto. Las tres variantes, medidas sobre 60,000
casos cada una:

| Variante | ¿negativos? | ¿cierra contra el importe? |
|---|---|---|
| **(a)** las dos mitades por multiplicación *(la que se rechazó)* | **0** | ❌ **falla en 30.7 %** |
| **(b)** complemento recalculado + cuerpo como **resto** | cuerpo `<0` en **3.0 %** | ✅ siempre |
| **(c)** la del PR: cuerpo **topado** + resto | **0** | ✅ siempre |

⚖️ **El motivo real de rechazar (a) es más fuerte que el que se había escrito:** con ella el negativo
**no vuelve** — lo que vuelve es **la suma que no cuadra**, en ~1 de cada 3 renglones fusionados con
complemento. *O sea que el bloque que existe para explicar el importe pasaría a contradecirlo*, justo lo
que la etapa vino a quitar. Y la frase describía el mecanismo de la variante **(b)**, que sí lleva
resta, colgándoselo a la **(a)**.

⚖️ **La lección, y es la de toda la etapa:** *«rechazó con evidencia» sólo se sostiene si la evidencia
es la que se midió.* Una decisión correcta sostenida por una razón falsa **es la misma enfermedad** que
esta ronda vino a curar — sólo que del lado de la cura.

### Nota de cierre — ✅ HECHA (24-ago-2026)

**Sin migración, sin permisos nuevos, sin seed. Sin cambio de contrato** (`openapi` y `gen:api` sin
diff, verificado).

**Verificado por mutación: 49 aplicadas, 49 muertas** *(las de la primera entrega; en la ronda de
corrección **una sobrevive por decisión declarada** — ver abajo, no es "todo cubierto")*. Entre ellas
las que protegen lo que Daniel pidió:
que **el folio de OP vuelva al papel**, que **el total se recalcule**, que **el complemento se calle**,
que **el cero se pinte** como renglón fantasma, y 🔴 que **desaparezca la suma** que hace legible el
importe.

⭐ **Dos supervivientes de la primera vuelta que resultaron ser defectos reales, no equivalentes:**
- **N07** — el acumulador suma la cantidad del complemento **en sitio**; si el primer grupo se quedaba
  con el objeto de entrada en vez de una copia, fusionar **le cambiaba la cantidad al dato que le
  pasaron**: *un efecto de lado invisible en una función anunciada como PURA*. Ya estaba copiando, pero
  **nada lo fijaba** — la mutación lo destapó. Es el mismo hallazgo que M18 dio con las matrices, **sólo
  que aquí sí mordía**.
- **M12/M13/M23** — las pruebas de "materiales distintos" cambiaban **varios campos de la clave a la
  vez**, así que quitar sólo uno seguía separando; y todas las matrices usaban **un solo color**.
  Cerradas con casos que varían **una sola cosa**.

⚠️ **Declarado:** las mutaciones **dentro de los elementos de `react-pdf` no son matables en unit** —el
texto va en una fuente *subset* con codificación propia y no se puede afirmar sobre el buffer—. Por eso
el texto salió a **`textosComplemento`, pura y exportada**, igual que se hizo antes con `textoMaterial`.
Lo único sin cubrir es el `View` que coloca esas dos cadenas: **plomería sin decisiones**.

⚠️ **Efecto colateral declarado, no callado:** quien imprimiera el borrador **para revisarlo en papel**
antes de autorizar deja de poder. Para eso están la pantalla de la OC y la revisión previa
(§Post-F9.85). Y **la franja roja «ORDEN DE COMPRA CANCELADA» se dejó VIVA a propósito** aunque hoy sea
inalcanzable: es lo que hace verdad la frase de §Post-F9.101(d) —*"si él prefiere conservarla para
archivo, se revierte en una línea"*—. *Borrarla habría convertido una línea en diez.*

---

## V1-E4d · LOS OCHO AVISOS RESTANTES, EN SU LUGAR ⭐ (23-ago-2026) — ✅ HECHA

**Continuación directa de V1-E4c**: la misma regla de Daniel (§Post-F9.96) aplicada a los **ocho
avisos amarillos que quedaban** apilados antes del primer renglón de «Explosión de materiales». Su
frase: *"los avisos en amarillo salen muchos y **confunde lo que realmente se busca**"*.

### ⭐ El inventario del lead resultó equivocado en un punto, y el coder se plantó con evidencia

El lead clasificó los ocho y dijo que `exp-aviso-cambios` y `exp-desalineacion` eran *"casi el mismo
mensaje, dos veces"* → fundir. 🔴 **No lo son, y fundirlos habría borrado dos causas y dos remedios
distintos:**

- **`huboCambios`** (`mrp.ts:1799`) compara la explosión **contra el snapshot anterior de ella misma**.
  Se arregla **volviendo a explotar**, y su marca por renglón es el `DiffBadge`.
- **`desalineacion`** (`mrp.ts:1640` → `armarReceta`) compara la **receta congelada de la orden contra
  el BOM vivo del modelo**. **NO se arregla explotando**: hay que traer el cambio a mano desde la
  receta. Y tiene variante **crítica en rojo** cuando la orden **ya tiene compras**.

Lo que sí procedía: `exp-aviso-cambios` **no era un aviso, era la leyenda de las etiquetas**
(*"los renglones afectados están marcados"*) → a la línea de resumen. Y `exp-desalineacion` bajó al
final **conservando su rojo sólo en el caso crítico**, porque §Post-F9.43(d) lo pide *"en el lugar de
la decisión"* y ahí sí hay dinero corriendo. ⚖️ *Es la tercera vez en el track que un agente corrige al
lead con evidencia y tiene razón.*

### Cómo quedaron los ocho

| Aviso | Qué era en realidad | Dónde quedó |
|---|---|---|
| `exp-falta-direccion` | **bloquea**, y el selector **ya existía**; lo que faltaba era la salida del catálogo vacío | instrucción **gris** junto a su campo; **amarilla sólo al intentar generar** sin llenarla, con el foco al campo |
| `exp-motivo-sin-oc` | 🔴 **cuatro ramas, no una** (sin proveedor / sin materiales / todo ya en OC / cubierto por stock) | fuera de la entrada: en el `title` del botón y completo en la previa |
| `exp-parcial-sin-proveedor` | 🔴 **NO era duplicado** *(ver corrección abajo)*: era el **caso complementario** — la compra PARCIAL | retirado de la entrada; **el hecho vive en la línea de resumen**, en gris |
| `exp-ya-en-oc` | información *(y era verde, no amarilla)* | cláusula de la línea de resumen |
| `exp-banner-faltantes` | instrucción de la pantalla *(era azul)* | ídem |
| `exp-pendientes-liberar` | tiene acción | al final, sin alarma **+ aviso nuevo en la previa** (calculado en el servidor) |
| `exp-aviso-cambios` | **leyenda de las etiquetas**, no aviso | línea de resumen |
| `exp-desalineacion` | **causa distinta** — ver arriba | al final; **rojo sólo en el caso crítico** |
| `exp-avisos` | lista genérica del enganche (F8-E6) | al final, sin alarma |

### 🔴 El CI en rojo: eran las PRUEBAS hablando de una compra que no existía

Las dos pruebas de integración que el coder escribió **por adelantado** —precisamente para cerrar la
superviviente que V1-E4c había dejado declarada— **fallaron**. Y lo que falló no fue la aserción del
aviso, sino **el candado heredado de V1-E4c(B)**: *"el plan tiene que traer renglones de verdad"*.

**La causa:** el fixture de `receta-orden.int.test.ts` crea la tela y los avíos **sin proveedor** —a
Desarrollo no le hace falta—, y sin proveedor `planearCompra` los manda a `omitidos` con motivo
`sin-proveedor` y **`plan.proveedores` llega vacío**. Las pruebas **afirmaban cosas sobre una compra que
no existía**. ⚖️ **El cableado sí funcionaba desde el principio** — lo que no había era a quién comprarle.
*Y el candado hizo exactamente su trabajo: en vez de pasar en verde sobre la nada, se puso rojo.*

**Y la observación de fondo del reviewer resultó cierta:** `exigirMaterialesLiberados` (`mrp.ts:2330`)
tira **409 antes** de que se calculen los avisos, así que un pendiente que **sí** se escribe **no puede
llegar** — el `continue` del descuento **nunca corre en producción**. Se conserva (cuesta una línea)
pero **reescrito como lo que es**: defensa por si esa puerta se mueve, dicho en el TSDoc, en el JSDoc de
la prueba **y en su nombre**. *El escenario imposible dejó de presentarse como el real.*

### ⭐ La mentira de la previa, arreglada de paso — y era de negocio

El hueco de B1 traía una consecuencia que nadie había reportado: un renglón **sin proveedor** —cuya
casilla está **deshabilitada**— se reportaba en la previa con motivo `no-seleccionado`:
🔴 *"No lo marcaste para esta compra."* **Es falso, y le echa la culpa al comprador de algo que el
sistema no le dejó hacer.**

Arreglado en 6 líneas: `planearCompra` pregunta **primero si el renglón era seleccionable**
(`idProveedorSugerido !== null && seGuardaComoAlgo(cantidadPendiente)` — exactamente lo que la pantalla
deja marcar) y, si no lo era, cae en su **motivo real** (`sin-proveedor`, `ya-en-oc`,
`cubierto-por-stock`). Verificado que **no abre un agujero**: un renglón no-seleccionable nunca puede
terminar con `motivo === null`, porque `null` exige justo esas tres condiciones. Con int test, y con un
**segundo material comprable** para que la mitad *"al que sí pudo se le sigue diciendo"* pruebe algo.

🔴 **Cierre de la 3ª vuelta — «seleccionable» son DOS mitades, y la segunda no la cubría nadie.** El
reviewer probó que dejar `seleccionable = idProveedorSugerido !== null` **a secas** dejaba el int test en
verde *incluso en CI*: el fixture no distingue las mitades (la Felpa no tiene proveedor, el ZIP sí). Y la
mitad sin cubrir es **la del caso más frecuente**: el material **ya cubierto por una OC viva**
(`cantidadPendiente = 0`, casilla también apagada) — el camino del chip «Ya comprado», que sale a diario.
Se cerró por los dos lados: **(1)** un int test que monta ese caso de verdad (compra sólo el botón,
re-explota y pide el previo con una selección que no lo incluye) y **(2)** la escalera sacada a
`motivoDeOmision`, **función pura exportada**, con las dos mitades fijadas en unit — incluida la
invariante *"nada no-seleccionable puede devolver `null`"*, que es la que impide que esta etiqueta cambie
jamás **qué se compra**.

### ⭐ Y el candidato que el coder VIO y NO tocó — *(con la razón CORREGIDA en la 3ª vuelta)*

Se le pidió avisar si encontraba otro caso del patrón *"el mecanismo existe y no llega al usuario por una
bandera sin prender"*. Reportó **`AvioProveedor.habitual`**: §Post-F9.82 lo dejó como *"al que se le
compra siempre"*, y si nadie marca la casilla la cascada cae al **más barato** **sin decirlo**. 🔴 **No lo
arregló por su cuenta y lo dijo**, que es lo que tocaba.

⚠️ **Pero la razón que dio para no tocarlo era FALSA, y una justificación floja es cómo un hallazgo real
se entierra.** Escribió que *"el panel de asignación en bloque ya le pide al comprador que marque el
habitual"*. **No lo hace**, y los tres datos —verificados sobre el código— dicen justo lo contrario:

- el panel **sólo se pinta con `sinProveedor.length > 1`**
  (`ExplosionMaterialesPagina.tsx:1164`), o sea en el caso **contrario**: materiales **sin** proveedor.
  A un renglón resuelto por *más barato* **no lo menciona nunca**;
- **`origenProveedor` YA VIAJA al cliente con `'mas-barato'`** (`mrp.ts:1109` tela / `:1176` avío), pero
  la pantalla **sólo lo lee para `=== 'asignado-compras'`** (`:1991` y `:2223`) → **la procedencia del
  proveedor es invisible**;
- y `ofreceAsignar` (`:1992-1997`) **no ofrece «Asignar proveedor»** en esas filas (sólo con hueco, con
  asignación de Compras o con proveedor dado de baja) → desde esta pantalla el comprador **ni la ve ni
  la puede cambiar**.

**La decisión de no tocarlo aquí SIGUE EN PIE** (coincide el reviewer): es de F4/§Post-F9.82, **degrada
en vez de bloquear** y **no produce un número falso** — nadie compra mal, sólo se compra al más barato
cuando quizá se quería al de siempre. **El arreglo probable es un CHIP, no una función:** pintar la
procedencia del proveedor cuando sea `'mas-barato'` (el dato ya está en el renglón), con el mismo patrón
del chip «Proveedor asignado por Compras». Queda **anotado para valorarlo aparte**, no enterrado.

*(Referencias de línea: son de esta etapa y **se mueven**; búsquense por el nombre del símbolo.)*

### 🔴 Corrección de la 2ª vuelta: el "duplicado exacto" **no era duplicado** (y el borrado dejó un hueco)

El coder acertó al plantarse con `exp-aviso-cambios` / `exp-desalineacion`, **y falló en el de al
lado**: dijo que `exp-parcial-sin-proveedor` repetía a `exp-motivo-sin-oc`. Lo cazó el reviewer, y la
evidencia es la condición de cada uno — **son mutuamente excluyentes, nunca pudieron salir juntos**:

| Aviso | Se pinta cuando |
|---|---|
| `exp-motivo-sin-oc` | `motivoSinOc !== null` ⟹ **`comprables.length === 0`** |
| `exp-parcial-sin-proveedor` | `sinProveedor.length > 0` **y `comprables.length > 0`** |

Uno decía *"no se puede generar nada"*; el otro, *"sí se genera, **pero N materiales se quedan
FUERA**"* — **el caso peligroso: la compra parcial**. Y con **UN solo** material sin proveedor no lo
decía nadie más: el panel de a varios exige dos o más, el `title` del botón calla porque sí hay
comprables, y en la previa ese renglón salía como *"No lo marcaste para esta compra"* **con su casilla
deshabilitada** — o sea, culpando al comprador de algo que el sistema no le dejó hacer.

**Los dos siguen fuera de la entrada** (ninguno es un error de quien llega), pero:
1. **el HECHO volvió a la línea gris de resumen** — `· N sin proveedor: NO entran en esta compra
   (asígnaselo en su renglón)` —, que cierra también el caso de uno solo; y
2. se corrigió la mentira de la previa: **"no lo marcaste" sólo se le dice a quien PUDO marcarlo**
   (`planearCompra` pregunta primero si el renglón era seleccionable; si no, cae en su motivo real
   —`sin-proveedor`, `ya-en-oc`, `cubierto-por-stock`…—). Es §Post-F9.85 otra vez: *no basta con no
   callarse; hay que no mentir*.

### La dirección de entrega: lo que entra y lo que no

**Sigue bloqueando** (decisión de Daniel, 23-ago): la petición del plan **no sale** sin dirección. Lo
que cambió es **cuándo se dice**. El **alta** entra y **salió barata porque se reusó el diálogo del
catálogo** (`DialogoDireccionEntrega`, ya completo con Zod) con una prop opcional `alCrear` que deja
**elegida** la recién creada aunque no sea favorita. Permiso: `compras.administrar`, **el mismo que el
servidor ya exige** para crear direcciones y para generar la OC → **cero permisos nuevos**.
⬜ **NO entra:** editar, desactivar ni marcar favorita desde aquí — para eso queda el enlace al catálogo.

### ⭐⭐ Instrucción NUEVA de Daniel en la misma ronda: «siempre dejarla fija» (23-ago-2026)

> *"El lugar de entrega en el 99% de las órdenes es en el mismo lugar. Podemos dejar por **default
> siempre** la dirección de entrega… podríamos modificarla si es que se requiera, pero **siempre
> dejarla fija**."*

🔴 **Y el mecanismo YA ESTABA CONSTRUIDO** —la dirección **favorita** se pone sola, y el dominio
garantiza que es única (`direcciones-entrega.ts:91-101`: prender una apaga las demás en la misma
transacción)—. Lo que fallaba **no era código: era un dato** — nadie había marcado ninguna. *Es la
sexta vez en la semana que aparece el mismo patrón: lo construido y verificado que no llega al usuario
porque falta prender una bandera.*

**Lo que sí se agregó** (una línea de cascada): **con UNA SOLA dirección activa se usa sola, aunque no
esté marcada favorita**. Pedirle a alguien que elija *"la favorita"* entre una única opción —y
**bloquearle la OC** mientras no lo haga— es exactamente la fricción que §Post-F9.96 vino a quitar.

- **La cascada queda:** la que eligió el comprador → la **FAVORITA** → la **ÚNICA activa** → pedirla.
- 🔴 **Sólo con UNA.** Con dos o más sin favorita **se sigue preguntando**: ahí hay una decisión real y
  el sistema no la inventa (§Post-F9.86). Elegirla para esta compra **no la marca favorita**.
- **Dos casos, dos frases:** *"No hay ninguna dirección de entrega activa"* (→ dala de alta aquí) vs.
  *"Hay N direcciones y ninguna marcada como favorita"* (→ elige). El texto viejo —*"ninguna está
  marcada como favorita"*— habría quedado **falso** en el primer caso.
- ⬜ **Pendiente del coordinador:** registrar esta instrucción en `DECISIONES.md` (§Post-F9.96 o su
  propia entrada). Aquí queda anotada para no perderla, pero la ley de negocio vive allá.

### El backend hizo falta, y por la razón correcta (A1)

Un aviso *"sólo por lo que de verdad se queda fuera"* **no lo puede calcular la pantalla**.
`planearCompra` ya llamaba `exigirRecetaLiberada` **y tiraba su resultado**; ahora lo guarda (**cero
consultas extra**) y alimenta `avisosDeMaterialSinLiberar()`, función **pura y exportada** que
**descuenta lo que la OC sí va a escribir** (`seEscribe`) — 🔴 *porque un material liberado después de
explotar se compra igual, y decir "no entra" sería mentir.* Mismo patrón que `avisosDeTelaSinColor` de
V1-E4c. Contrato: sólo la descripción de `avisos`, **sin cambio de forma**.

### Nota de cierre — ✅ HECHA (23-ago-2026)

**Sin migración, sin permisos nuevos, sin seed.**

**Cómo queda la pantalla al abrirla** —que es lo que Daniel mira—: **ningún aviso amarillo**. La
barra, **una línea gris de resumen** que junta las informaciones (incluida *"N sin proveedor: NO
entran en esta compra"*), y **lo único con fondo cálido arriba de la lista**: el panel donde se
**capturan** los proveedores de varios de un jalón *(que es un lugar donde se llena, no un aviso —
por eso la prueba guardiana lo excluye, y por eso el texto lo dice en vez de prometer un "nada
amarillo" que el propio panel desmentiría)*. Los renglones siguen con sus chips `warn` cuando les
falta algo, que es donde deben estar. Todo el detalle, **debajo de la lista**. Los avisos de verdad,
**al pulsar «Revisar y generar»**.

**Verificado por mutación: 40 aplicadas, 40 muertas** (26 en la 1ª vuelta + **10 en la 2ª** —el título
del botón, la marca del intento por sus dos puertas, el plan en vuelo, el hecho de la compra parcial, el
filtro del arte y las dos ramas de la cascada de dirección— + **4 en la 3ª**, las de la escalera de
motivos, con `R14` a la cabeza: **la que el reviewer no pudo matar ahora muere en unit**) — incluidas **siete que protegen el diseño, no la lógica**: que la dirección vuelva a ser amarilla desde el arranque, que el resumen se pinte como
alarma, que los tres bloques del final vuelvan al amarillo, y **que las notas vuelvan ARRIBA del primer
renglón**. *Si alguien revierte lo que Daniel pidió, algo se pone rojo.* `src/modulos/ordenes-compra/`
corrido **9 veces** (6 en la 1ª vuelta, 3 en la 2ª): **verde las nueve** (217/217 tras la 2ª vuelta).

⚠️ **Supervivientes: el conteo cambió entre vueltas, y aquí está cuál cuenta qué** *(el cuerpo del
commit de la 1ª vuelta dice "dos" y no se reescribe; **manda esta ficha**)*:

| Momento | Declaradas | Cuáles |
|---|---|---|
| 1ª vuelta (commit `b6803c9`) | **2** | desconectar `avisosDeMaterialSinLiberar` de `plan.avisos` · el filtro `tipo !== 'arte'` |
| 2ª vuelta (tras el reviewer) | **1** | sólo la primera — ⭐ **el filtro del arte SÍ era matable y se mató** |
| 3ª vuelta (cierre) | **1** | la misma, y **confirmada** como sólo-CI |

⭐ **Lo que cerró de verdad la 2ª vuelta:** el filtro del arte **se movió DENTRO de la función pura**
(vivía en el sitio de llamada, que ninguna prueba unitaria puede ver) y **ahora muere en unit**. *Declarar
una superviviente no es lo mismo que no poder matarla; ésa se podía.* La 3ª vuelta hizo lo mismo con la
escalera de motivos: `motivoDeOmision` salió de `planearCompra` a función pura exportada **porque su
único guardián posible era el CI**, y con eso la mutación que el reviewer no pudo matar (`R14`: quitarle
a *"seleccionable"* la mitad de `cantidadPendiente`) **muere ahora en unit, comprobado**.

🔴 **La que queda es de verdad sólo-CI**: desconectar `avisosDeMaterialSinLiberar` de `plan.avisos` vive
en `planearCompra`, que no es pura ni exportada — es **exactamente el hueco que V1-E4c documentó**, y por
eso se escribieron **dos pruebas de integración** en `receta-orden.int.test.ts`.

---

## V1-E4c · El color de la tela SE DICE EN SU RENGLÓN ⭐⭐ (23-ago-2026) — ✅ HECHA

**Lo reportó Daniel** (23-ago-2026), probando la 0.017: *"no puedo comprar las telas por color"*.
🔴 **Y la función existía desde la 0.013, completa y verificada** (§Post-F9.89). El defecto **no era
de lógica: era de UBICACIÓN**. Cuando se le enseñó dónde estaba, contestó:

> *"Ya vi dónde está, **pero no me gusta que sea ahí**. ¿Por qué no poner la opción **directo en el
> renglón de la tela**? … **los avisos en amarillo salen muchos y confunde lo que realmente se
> busca**."* · *"Está muy rebuscado… no me gustó la interfaz."*

Y al preguntarle cómo lo quería, dictó **la regla que rige la etapa** (§Post-F9.96), que vale para
toda la aplicación:

> ⭐ *"El proceso normal es **llenar ahí la información**. Los mensajes amarillos parecieran que
> estamos haciendo algo mal. **Primero que dé la opción de meterlo, y si no se hace, entonces que
> mande los mensajes en amarillo.**"*

### El hueco, en tres hechos medidos

1. **El único camino** para decir el color era un enlace subrayado **dentro** del aviso amarillo
   `exp-pendientes-color`. No había opción en el menú, ni en el renglón, ni en el catálogo.
2. **El aviso sólo aparecía si el color FALTABA** → en cuanto se decía, desaparecía **y con él el
   botón**: *corregir un color ya dicho no se veía por dónde*.
3. **La forma que Daniel pedía YA EXISTÍA en el mismo renglón, a dos líneas de distancia**: la acción
   inline de «asignar proveedor» (§Post-F9.82). *El color se había salido del patrón sin razón.*

⚖️ Y el marco: la pantalla abría con **NUEVE** avisos amarillos apilados antes del primer renglón, con
el lugar de arreglar cada cosa *dentro* del regaño. Leído desde afuera eso dice *"ya llegaste mal"*
antes de dejarte trabajar — exactamente lo que Daniel describió.

### Qué entrega

- **(A)** `FormaColorDeLaTela`: acción **inline en cada renglón de tela** (`exp-decir-color`), con la
  **misma forma** que «asignar proveedor» (bloque `bg-muted/30`, enlace subrayado, «Cerrar»).
  **Siempre disponible** —dice y corrige—, lista **todos** los casos (OP × color de prenda) que le
  tocan a **ese** renglón (filtrados por `idTelaColor`, para que dos renglones de la misma tela no
  enseñen la misma lista), y **nunca aplica nada por su cuenta**.
- **(B)** El bloque `exp-pendientes-color` **se elimina de la entrada** (queda un comentario en su
  sitio explicando por qué, para que nadie lo reponga); lo que falta lo dice el chip «Sin color» del
  renglón. El aviso **reaparece en la REVISIÓN PREVIA** (`exp-previa-avisos`), calculado por
  `avisosDeTelaSinColor()` **sobre el plan ya armado** y sólo por lo que de verdad se escribe
  (`seEscribe`). 🔴 **Avisa y NO bloquea** (§Post-F9.64). **Los otros ocho avisos, intactos** — su
  limpieza es la etapa siguiente.
- **(C)** **Con la OC AUTORIZADA el color no se cambia** (§Post-F9.79 aplicada aquí): `asignarColorDeTela`
  **rechaza** (409) y `coloresDeTelaDeOrden` **lo anticipa** con `puedeCambiar`/`motivoNoCambiar`, la
  **misma frase** en los dos lados. Con la OC en `borrador` se mueve libre.
- **(e)** **Orden sin matriz color×talla:** `sinMatrizColores` → el renglón **dice qué falta y dónde se
  captura**, y **NO ofrece el campo**.

### ⭐ La corrección que el coder le hizo al encargo, y tenía razón

El lead le dijo *"reusa `comprometidoEnOc()`, no escribas un criterio paralelo"*. **No servía:** esa
lista **incluye el `borrador`** —porque contesta *"¿hace falta recomprar?"*— y la regla (C) pregunta
otra cosa, *"¿ya me comprometí con el proveedor?"*, donde el borrador **no** cuenta. Lo reusable era
**la lista que `receta-orden.ts` tenía PRIVADA** desde §Post-F9.79: se movió a
`comprometido-en-oc.ts` como `ESTATUS_OC_COMPROMETIDA` (+ `algunaRecibida()`), con el TSDoc que
explica **por qué son dos listas y no una**, y ahora **las dos guardas leen la misma constante**. *El
espíritu de la instrucción, no su letra.*

### Dos decisiones de precisión que el coder tomó y documentó en el código

- 🔴 **El bloqueo va por (tela, COLOR), no por tela.** Con una OC autorizada de «Felpa · Grana», el
  Grana queda cerrado pero **el Azul se sigue capturando**. Una guarda por tela habría cerrado justo
  el camino que la etapa viene a abrir.
- 🔴 **Las líneas de OC SIN color (`idTelaColor = null`) no bloquean.** Son las **7,978 migradas**: no
  afirman nada del tono, y si bloquearan, **ninguna orden histórica podría capturar sus colores
  nunca**.

### Nota de cierre — ✅ HECHA (23-ago-2026)

**Sin migración, sin permisos nuevos, sin seed** (reusa `compras.administrar`; un permiso nuevo
nacería sin asignar a nadie y cerraría el camino que la etapa abre). Contrato regenerado en la misma
tarea. **`DialogoColoresDeTela` sigue vivo y accesible** desde el bloque —si se hubiera quedado
huérfano se habría ido con él la **corrección de precio del color** (decisión (b) de §Post-F9.89), que
sólo existe ahí.

**Verificado por mutación:** el coder reportó *"18 aplicadas, 18 muertas, 0 supervivientes"* —
⚠️ **y eso NO era exacto**: el reviewer independiente encontró **3 supervivientes** en código nuevo de
la etapa (ver la ronda de corrección). Lo que sí quedó confirmado por los dos: quitar la acción del
renglón mata **9 pruebas** y **reponer** el amarillo en la entrada mata 1 — el diseño que Daniel pidió
está protegido. *(Es la cuarta afirmación de este track que se leía como verificada y no lo estaba;
queda corregida aquí, que es donde se lee.)*

⚠️ **Declarado, no callado:** la guarda real del `PUT` (crear OC → autorizar → 409) y `sinMatrizColores`
contra la base **sólo los juzgan los `.int.test.ts`** (7 casos nuevos), que el coder no puede correr —
los ve el CI. Y **no montó ningún hook auténtico** porque **ninguna prueba suya depende de una petición
en vuelo**: prefirió no apoyarse en el `beforeEach` estático a fingir que lo ejercitaba. *(Ver la deuda
declarada de V1-E3z sobre ese `beforeEach`.)*

⬜ **Lo que NO entra, con su razón:** el *"aplicar el mismo color a todas"*. Con 8 OP del mismo color
son 8 capturas. Se dejó fuera porque **el sistema decidiéndolo por su cuenta está prohibido**
(§Post-F9.86) — pero **un botón que la persona ELIGE sí se vale** y es aditivo: si Daniel lo pide, no
toca nada de lo hecho.

### 🔴 Ronda de corrección: el CI en rojo y cinco hallazgos del reviewer (23-ago-2026)

**Dos fuentes a la vez, cerradas en una sola ronda.** El reviewer independiente RECHAZÓ *y* el CI dejó
el backend en rojo — **con 3 de las 7 pruebas de integración que el propio coder había escrito**, las
que verifican la regla (C). Lo que el reviewer sí verificó y quedó firme: el movimiento de
`ESTATUS_OC_COMPROMETIDA` **no cambió `receta-orden.ts`** (misma membresía, mismo sitio de uso intacto,
`algunaRecibida()` equivalente literal, sin ciclo de imports, y el int test de esa guarda —no tocado
por este commit— sigue cubriendo borrador/autorizada/cancelada/recibida), y el argumento del coder
para plantarse era correcto.

**⭐ El fallo del CI era UNA sola causa, y NO era la guarda.** `comprarPorColor()` **no llamaba a
`explosionarOrden` antes de generar**: `planearCompra` lee el **snapshot** `RequerimientoOrden`, así
que sin explotar no encontraba filas → el bucle que crea las OC **no iteraba ni una vez** → devolvía
la lista vacía **sin lanzar error**. De ahí los tres fallos con la misma raíz: dos por
`autorizarOC(…, undefined)` y el tercero —*«el bloqueo es POR COLOR»*, el que podía ser un defecto de
fondo— porque **nunca se autorizó nada, así que nada bloqueaba**. La evidencia no es un razonamiento:
en el **mismo archivo** y en el mismo run verde pasa `:549`, que hace **exactamente** esa secuencia con
el `explosionarOrden` en medio.

⚖️ **Y el arreglo destapó algo peor que el fallo: la prueba de *«en BORRADOR sí se puede cambiar»*
estaba pasando EN EL VACÍO.** Sin OC creada, claro que nada bloqueaba — *verde por la razón
equivocada*. Ahora **el fixture se comprueba a sí mismo** antes de asertar nada: que hay exactamente 1
OC, que está en `borrador`, y que trae **una línea por cada tono**. Sin eso, *"el bloqueo es por color"*
no significaba nada. **Un fixture vacío ya no puede pasar por verde.**

**Los cinco del reviewer, cerrados:**

- 🔴 **(1) `DialogoColoresDeTela` ignoraba `puedeCambiar`.** El enlace *«Ver todos los colores y precios
  de la orden N»* —que **esta misma etapa** agregó— dejaba el desplegable **abierto** en un color que el
  servidor rechaza con 409: en el renglón salía bloqueado con su motivo, y ahí adentro no. **La
  incoherencia la introducía este commit.** Cerrado en el desplegable **y** en «Usar la propuesta», con
  el motivo pintado — y con un **archivo de pruebas NUEVO** para ese diálogo, que no tenía ninguno.
- 🔴 **(2) Tras guardar bien, el bloque afirmaba algo FALSO.** El filtro miraba el `idTelaColor` **vivo**
  de la explosión, y entre el `setQueryData` (inmediato) y la invalidación (ida al servidor) el caso
  recién guardado dejaba de casar → salía *«la orden N ya no tiene colores en este renglón»*. O sea que
  **el único acuse de recibo de un guardado exitoso era un mensaje diciendo que no hay nada**, y pasaba
  también en la **primera** captura. Se cierra **congelando los casos al abrir el bloque** (por orden, en
  cuanto llega SU respuesta, para que una OP que falle no deje a las demás sin congelar) — se eligió eso
  y no «cerrar al guardar» porque cerrar **rompe el caso de varios colores**.
  🔴 **Y tirando de ese hilo salió un segundo defecto:** el bloque abierto se identificaba por el **id de
  snapshot** del renglón, y decir un color **recalcula la explosión con ids nuevos** → **el bloque se
  cerraba solo justo al terminar la primera captura**. Ahora usa la clave estable (tela+color+proveedor).
- 🟠 **(3) `plan.avisos` no lo probaba NADA:** desconectarlo sobrevivía a las 1,742 pruebas. *El patrón
  «se construye y nadie lo ve» — el mismo que originó esta etapa.* Atado con **3 pruebas de integración**
  (avisa / no avisa con los colores dichos / avisa sólo por el que falta).
- 🟠 **(4) La trampa del `beforeEach` estático SÍ mordió.** Sí había un camino que depende de una petición
  en vuelo (que no se re-dispare el select mientras guarda) y todas las pruebas lo fingían. ⚖️ *La frase
  «ninguna prueba depende de una petición en vuelo» era cierta sólo porque no se escribió ninguna.* Ahora
  hay una con `useMutation` + `useQueries` **auténticos** y la escritura **en vuelo de verdad**. Cubiertos
  además `exp-color-error`, `exp-color-sin-renglon`, el «Cargando…» y `exp-color-sin-casos` — que **cambió
  de texto**, porque ya no puede ser el acuse de un guardado.
- 🟡 **(5) Una regla puesta en boca de Daniel.** El int test presentaba la regla (C) como **cita textual
  suya**; **Daniel no la dijo** — es un default del lead del 23-ago que él no objetó, y así consta en
  §Post-F9.96(f). 🔴 **En este proyecto una cita atribuida es fuente de verdad del negocio**, así que se
  corrigió en los tres sitios, señalando además cuál sí es frase suya (*"una vez recibido no se puede
  desautorizar"*, 20-ago). Y las **9** referencias con fecha «22-ago» → **23-ago**, que es cuando ocurrió
  la conversación.

### 🔴 Última milla: tres costuras que pasaban por verde sin probar nada (23-ago-2026)

El reviewer **verificó el código EJECUTÁNDOLO**, no leyéndolo: montó una sonda que inyecta un `tx`
falso por `bd.tx` y corre **el dominio de verdad sin Postgres** — **8 escenarios, 8 correctos**,
incluido que `motivoNoCambiar` es **idéntico carácter a carácter** al mensaje del `throw`. Confirmó
también el diagnóstico del CI siguiendo la cadena, y verificó por su cuenta el segundo defecto del
coder: el *"GET"* de la explosión es un **POST** que hace `deleteMany` del snapshot y lo reescribe, o
sea que **cada recálculo trae ids nuevos**. Y aun así **RECHAZÓ**, por tres costuras. Las tres son de
la misma familia y valen más que un defecto:

- 🔴 **(A) Una prueba que podía pasar habiendo probado CERO.** *«Con los colores ya dichos no hay nada
  que advertir»* hacía `expect(plan.avisos).toEqual([])` **y nada más**: si el plan volviera vacío —el
  mismo tropiezo que acababa de costar el CI— la prueba pasa sin ejercitar nada. Su hermana sí llevaba
  el candado. ⚖️ *Era el defecto de esta ronda **reintroducido en el lote escrito para matarlo**.*
- 🔴 **(B) «El bloqueo es POR COLOR» no probaba que fuera por color.** El test cambiaba el Azul, que
  **nunca tuvo amarre**, y la guarda **sólo corre con `idAnterior !== null`**: para un color sin amarre
  **la llave da igual, no se consulta**. El reviewer mutó la llave a `${idTela}` y **su sonda pasó
  7/7**. Sólo murió con el escenario que de verdad decide —**corregir un color YA amarrado** mientras
  otro tono de esa tela está comprado—, que es el flujo *«corregir un color ya dicho»*, **el que da
  nombre a la etapa**, y **no existía en ningún test del repo**. 🔴 El código estaba bien; lo que estaba
  mal es que **la frase titular de la ficha y del HISTORIAL la sostenía un test incapaz de ponerse rojo
  por esa razón** — habría sido la quinta afirmación del track verificada sólo en apariencia. Cerrado
  con la segunda mitad del test, y el coder lo comprobó **con la misma sonda**: con la llave por tela,
  **dos aserciones caen**.
- 🟠 **(C) Un estado que sobrevivía a su propio contexto — y lo abrió el arreglo de la ronda anterior.**
  `elegirOrdenBase`/`agregarOrden`/`quitarOrden` limpian todo *("otro conjunto = otro contexto")* pero
  **no `colorAbiertoId`**: con el id de snapshot **eso se auto-corregía** (el id moría con la
  explosión), y **con la clave estable ya no** → el bloque **reaparecía montado sobre otra orden**.
  Cerrado en **un solo sitio** (`olvidarPanelesDeRenglon()`), y **el panel de proveedor arrastraba lo
  mismo** —vivía del **mismo accidente**—, así que se cerró igual y con prueba.

⭐ **Y el coder volvió a cazar un error suyo y lo dijo:** su primera prueba de (C) **quitaba la ÚNICA
OP**, así que la explosión se desmontaba y el panel desaparecía solo → **el mutante sobrevivió**. La
reescribió quitando **una de dos** y asertando que los renglones siguen en pantalla. *El mismo error
que venía a corregir, cazado en su propia prueba*, y anotado en el comentario del test.

**Y una razón corregida (D):** el coder había escrito que MUT-B10 no es matable en unit *"porque
`planearCompra` necesita Postgres"*. **Falso, y lo demostró el propio reviewer usando `bd.tx`.** La
razón honesta es otra: un doble de `tx` para `planearCompra` —orden, receta liberada, dirección,
requerimientos, líneas de OC, proveedores, fechas— **sería tan ancho que se volvería su propia fuente
de error: el fake acabaría siendo lo que se prueba**. La guarda del color sí cabe en una sonda porque
toca cinco tablas y ninguna regla ajena.

**(E)** El matiz *"se congela por orden, no cuando llegan todas"* **ya tiene prueba** (dos OP, la
segunda falla, la primera sigue capturable) en vez de ser una afirmación de diseño sin respaldo.

🟠 **Y en la vuelta de APROBACIÓN el reviewer encontró la CUARTA puerta del mismo tipo** (aprobó con
ella como entrega, no como otra ronda): **la PRECARGA de las órdenes hermanas del mismo pedido** es el
cuarto sitio que muta `idsOrden` y **el único que no pasaba por `olvidarPanelesDeRenglon()`**. Sonda:
`el conjunto YA es [50,92]; panel abierto = true`. En la práctica casi no se ve —`/explosion` es un
POST pesado y `del-mismo-pedido` un GET ligero, así que las hermanas llegan antes de que haya nada
abierto—, pero **si esa consulta reintenta** puede aterrizar con el comprador ya trabajando. No
escribe mal ni miente: simplemente **contradecía la regla que el propio TSDoc de la ronda acababa de
escribir**. Cerrada, **y con prueba sin escenario forzado** (el mecanismo *es* "la consulta contesta en
un repintado posterior"), que además comprueba **que el conjunto de verdad cambió** —sin eso pasaría
sin probar nada, la lección de la ronda anterior—. `M-P1` (quitar sólo esa llamada): **1 roja**.

🟡 Y un **rótulo corregido**: un docblock decía cubrir `elegirOrdenBase` y en realidad cubre
`agregarOrden` (con una OP ya elegida `idsOrden` no está vacío) — **las dos frases del mismo commit no
podían ser ciertas a la vez**, porque el TSDoc afirmaba que `elegirOrdenBase` no la fija ninguna
prueba. ⭐ El coder actualizó además el TSDoc de `olvidarPanelesDeRenglon` **porque su propio arreglo lo
dejaba desfasado**: ahora dice que son **cuatro** los sitios, **tres con prueba**, y que el de
`elegirOrdenBase` es defensivo e incubrible con el argumento completo. *No quiso cerrar la etapa con
una nota de honestidad que se hubiera quedado corta por su propio arreglo.*

**Mutaciones de la última milla: 8 aplicadas, 6 muertas, 2 supervivientes declaradas.** `MUT-B10`
(la de siempre, que matan las 3 int tests) y **`M-C2` — que NO es cubrible y no por descuido:**
`elegirOrdenBase` sólo corre con `idsOrden` vacío, y **el único camino de vuelta a vacío pasa por
`quitarOrden`, que ya limpió**; cualquier prueba sería vacua. La llamada se queda por uniformidad —si
mañana aparece otra forma de vaciar el conjunto— **y se dice en el TSDoc de la función**, no sólo aquí.
*(Es el mismo criterio que `elegirOrdenBase` recibió en V1-E3z: declarar en el código lo que ninguna
prueba cubre, en vez de aparentar cobertura.)*

**Mutaciones de la ronda anterior: 8 aplicadas, 7 muertas, 1 superviviente — declarada, no escondida.**
`MUT-B10` (desconectar `plan.avisos`) **sigue viva en lo que el coder puede correr**, y no parece
matable en unit: la costura es `planearCompra`, que necesita Postgres. **La matan las 3 pruebas de
integración nuevas, que juzga el CI.** ⭐ Y el coder reportó **un falso positivo suyo**: `M-F15` le
sobrevivió en el primer intento porque su simulación no re-renderizaba la página; escribió la prueba de
verdad y entonces murió. *Lo dijo en vez de callarlo, que es lo que hace utilizable una tabla de
mutaciones.*

---

## V1-E3z · La revisión previa de la OC, EDITABLE ⭐⭐ (23-ago-2026) — ✅ HECHA

**Lo reportó Daniel** (23-ago-2026): *"Al hacer las órdenes de compra en explosión de materiales, ya
hay una pantalla previa, pero **no me deja poner el precio correcto ni la cantidad**. Acuérdate que al
final puedo modificar precio o cantidad antes de generar la OC. **No me deja modificar nada**"*. La
decisión completa está en `Documentacion_MJD/DECISIONES.md §Post-F9.94`.

### El punto de partida — y por qué la previa nació de solo lectura

`RevisionPrevia` (`ExplosionMaterialesPagina.tsx`) pintaba **todo como texto** (`formatearCantidad` /
`formatearMoneda`) y sólo ofrecía «volver» y «confirmar». Ni un campo. El mapa real de dónde se podía
editar cada cosa:

| Dónde | Cantidad | Precio |
|---|---|---|
| **Explosión** (paso 2) | ✅ campo *«Comprar»*, **sólo en renglones comprables** | ❌ sólo al **asignar proveedor**, y ese formulario aparece nada más en ciertos renglones |
| **Revisión previa** (paso 3) | ❌ | ❌ |
| **Órdenes de compra → Editar** | ✅ | ✅ (pero **ya generada la OC**) |

Se hizo de solo lectura por una razón buena, escrita en su propio TSDoc: *"todo lo que pinta viene del
SERVIDOR, calculado por el MISMO código que luego genera — una previa que calculara por su cuenta sería
una promesa que el sistema no cumple (A1)"*.

🔴 **Esa razón NO se rompió: se conserva.** Al cambiar un número, la previa **vuelve a pedirle el plan
al servidor** (`POST /api/explosion/previo`) y repinta el total con lo que él diga. La pantalla sigue
sin sumar, sin multiplicar y sin repartir. Lo único que cambió es **dónde** puede corregir el
comprador: la última pantalla antes de comprometer el dinero, que es la única donde ve el total.

### Qué se construyó

**(a) El canal de la CANTIDAD se REUSÓ, no se inventó otro.** El campo «Comprar» de la explosión ya
viajaba como `ajustes[] = { tipo, idMaterial, idTelaColor, idProveedor, cantidadTotal }` y el servidor
lo reparte entre las OP (§Post-F9.86). La previa escribe en **ese mismo estado**, con **la misma
clave** — que ahora se arma en un solo lugar del frontend (`claveDeAjuste`), porque la teclean dos
pantallas y dos maneras de armarla es exactamente cómo un ajuste "no se aplica" en silencio.

**(b) El canal del PRECIO nació aquí.** `ajustes[].precioUnitario` (contrato), y `cantidadTotal` pasó a
ser **opcional**: los dos ajustes son independientes, se puede corregir sólo uno. El contrato exige que
cada ajuste traiga **al menos uno** de los dos (`.refine`); un ajuste que no dice nada se rechaza en vez
de aceptarse callado.

**(c) La REGLA vive en `dominio/compras/ajuste-comprador.ts`, pura y aparte.** `planearCompra` la llama
y punto — así la previa y la generación no pueden divergir (es el mismo código corriendo dos veces), y
los casos feos se prueban **enteros en `test:unit`, sin Postgres**.

**(d) Los casos feos, con su razón escrita:**

| Caso | Qué hace | Por qué |
|---|---|---|
| Campo **vacío** | No manda ajuste: gana lo que propuso el sistema | Vacío = *"no lo toqué"*. Es también el **deshacer** sin salir de la pantalla (mismo criterio que la fecha por proveedor: guardar el vacío dejaría un estado que se ve igual y significa otra cosa) |
| Precio **0** | **Se acepta**: la línea nace SIN precio | No es invención: es lo que ya pasaba cuando la cascada no encontraba ninguno (`sin-precio` → línea en `0.00`), y el contrato de la OC ya acepta `precio ≥ 0`. Prohibirlo aquí sería más estricto que la propia orden de compra |
| Precio **negativo** | **Viaja al servidor**, que lo rechaza con su frase (`min(0)`); la previa la pinta y apaga «Confirmar» | Una compra no se paga en negativo. 🔴 En la 1ª vuelta el cliente lo **descartaba en silencio** y la frase del contrato no se ejecutaba nunca — ver *«Lo que el reviewer encontró»* |
| Cantidad en **cero** | Igual: viaja y el servidor la rechaza (*"debe ser mayor que cero"*) | Un `0` no es *"no compres nada"*, es un campo mal llenado — y quien lo dice es el servidor |
| Precio **0.004** | **BLOQUEA**, nombrando el material, y el mensaje dice *"si de verdad va sin precio, escribe 0"* | Se guardaría como `0.00` y el comprador creería haber puesto un precio. Teclear `0.004` **no es** teclear `0` |
| Cantidad **más baja** | Se permite, y avisa (chip «Total ajustado», y `cantidadSugerida` en la línea para la bandeja de autorización) | Es justo lo que Daniel pidió poder hacer |
| Cantidad **0.004** | BLOQUEA (regla que ya existía) | Crearía una OC con una línea en `0.00` quemando un folio (A3) |
| Precio **> 9,999,999,999.99** | Rechazado por el contrato | Es el tope de `OrdenCompraLinea.precio Decimal(12,2)` |
| **Decimales** | `step="0.01"` en los dos campos; el servidor redondea a la escala de **su** columna (cantidad `Decimal(14,2)`, precio `Decimal(12,2)`) | *La escala manda desde el destino.* Ofrecer más decimales invita a teclear algo que el documento no puede guardar |

**(e) El aviso de «total ajustado» se conservó tal cual, y el precio ganó el suyo.** `precioAjustado`
+ `precioPropuesto` viajan en el plan → chip *«Precio ajustado (propuesto $X)»*. Quien autoriza sigue
viendo contra qué se cambió cada número.

**(f) La interacción: al SALIR del campo (o con Enter), y sólo si el número CAMBIÓ.** Sin rebote por
pulsación, a propósito: con un rebote, teclear «1500» mandaría a planear compras de 1, de 15 y de 150 —
totales de compras que nadie quiso hacer. Un campo terminado = una petición. Pasar con el tabulador sin
cambiar nada **no cuesta ninguna**. Y el valor que el campo pinta viene **siempre del plan del
servidor**: si el servidor redondea, el campo adopta SU número.

**(g) Mientras el plan de la pantalla no corresponda a lo tecleado, «Confirmar y generar» se apaga** —
tanto si el servidor está recalculando (dice *«Recalculando…»*) como si el recálculo fue **rechazado**.
Confirmar contra un plan que ya no es el de la pantalla sería emitir un documento que nadie revisó.

**(h) Dos defectos adyacentes que la edición volvió alcanzables, arreglados en la misma ronda:**
- 🔴 **La previa prometía líneas que la generación se salta.** Una OP cuya parte del reparto no llega a
  `0.01` no genera línea (el filtro ya existía en la generación), pero la previa la pintaba igual. Ahora
  el plan trae `PlanLineaOrden.seEscribe` —**calculado con el mismo predicado**— la generación **filtra
  por él** (una sola regla, no dos copias) y la pantalla lo dice: *"no alcanza el mínimo: esta orden no
  lleva línea"*. Bajar un total desde aquí hace ese caso común.
- 🔴 **El total del renglón sumaba esas líneas fantasma.** Con un precio alto, `0.004 × 1000 = 4.00`
  entraba al total prometido y no al de la OC. Ahora el importe suma **sólo** lo que se va a escribir.
- 🔴 **Un bloqueo desaparecía el renglón que nombraba.** El renglón bloqueado por su cantidad se
  descartaba (`continue`), así que el comprador se quedaba con un mensaje que nombra un material que ya
  no ve — y **sin campo donde corregirlo**. Ahora se sigue enseñando cuando el culpable es su propio
  ajuste; no promete nada, porque con bloqueos la generación no escribe ni una línea.

### ✅ Verificado: el precio corregido SÍ se recuerda — sin construir nada, y sin tocar el catálogo

Daniel preguntó si el precio cambiado aquí debía recordarse para la próxima compra. **No hizo falta
construir nada**, y se comprobó leyendo el código y con una prueba de integración:

- `costos/ultimo-precio-compra.ts` (§Post-F9.48) lee el precio de **la línea de la OC AUTORIZADA**
  (`ESTATUS_COMPRADO` = `autorizada` / `recibida_parcial` / `recibida_total`) — *"manda la OC
  AUTORIZADA, no lo recibido ni lo surtido"*. Ése es el escalón 1 de la cascada única de precios, de la
  que comen la receta, el precosteo y la lista de precios.
- ⇒ Un precio corregido aquí **se vuelve solo** el *"último precio de compra"* de ese material a ese
  proveedor **en cuanto la OC se autorice**, y **sin escribir una sola vez en el catálogo** — que es
  justo lo que §Post-F9.88 prohíbe (*la vía rápida no puede volverse una puerta trasera para el
  catálogo*).
- Las dos mitades quedaron con prueba de integración: **el catálogo no cambia** (se compara
  `AvioProveedor.precio` antes y después) y **el último precio sí** (7.25 tras autorizar).

**Cero escrituras nuevas al catálogo en toda la etapa.**

### Cómo se verificó (mutación, no sólo verde)

| Mutación | Resultado esperado | Lo que dio |
|---|---|---|
| El precio del comprador se ignora (gana siempre el del sistema) | caen las del precio | **8 rojas / 14 verdes** |
| Quitar el guard `> 0` del bloqueo de precio (teclear `0` bloquearía) | cae **sólo** la del cero explícito | **1 roja / 21 verdes** |
| `precioComunDelRenglon` devuelve siempre el primero | cae **sólo** la de precios distintos | **1 roja / 21 verdes** |
| Quitar el bloqueo de la cantidad impagable | caen las dos que lo miran | **2 rojas / 20 verdes** |
| El `.refine` del contrato acepta todo | cae la del ajuste vacío | **1 roja / 7 verdes** |
| El precio del contrato pierde piso y techo | caen la del negativo y la del tope | **2 rojas / 6 verdes** |
| El precio `0` se filtra como si fuera vacío (frontend) | cae la del cero que viaja | **1 roja / 73 verdes** |
| `onBlur` dispara siempre (aunque no haya cambio) | cae la del tabulador que no cuesta petición | **1 roja / 73 verdes** |
| La lista de ajustes vuelve a recorrer **sólo** las cantidades | caen las dos del precio | **2 rojas / 72 verdes** |
| Se puede confirmar mientras recalcula | cae la del botón apagado | **1 roja / 73 verdes** |
| La línea que no se escribe se pinta como si sí | cae la del reparto marcado | **1 roja / 73 verdes** |
| El campo **no se sincroniza** con el plan del servidor | ⚠️ **SOBREVIVIÓ** en la primera vuelta | ver abajo |
| Vaciar el campo ya no borra la entrada del mapa | ⚠️ **SOBREVIVIÓ** — mutante **equivalente** | ver abajo |
| **(2ª vuelta)** vuelve el **filtro silencioso** (`cantidad > 0` / `precio >= 0`) | caen las dos sondas del valor que debe viajar | **2 rojas / 77 verdes** |
| **(2ª vuelta)** el error del recálculo no se pinta dentro de la previa | cae la sonda 3 | **1 roja / 78 verdes** |
| **(2ª vuelta)** «Confirmar» sigue encendido con el recálculo rechazado | cae la sonda 3 | **1 roja / 78 verdes** |
| **(2ª vuelta)** se quita la guarda del contador (la respuesta tardía pisa) | cae la del desorden | **1 roja / 78 verdes** |
| **(3ª vuelta)** `mensajeDeError` vuelve a devolver **sólo el genérico** (el defecto original) | caen las del punto único **y la SONDA 3**, que antes no se habría movido | **5 rojas / 7** en `errores.test.ts` · **1 roja / 78** en la pantalla |
| **(4ª vuelta)** vuelve la guarda `!Array.isArray` (sólo se reconoce el arreglo — la conducta de la 3ª vuelta) | caen las cuatro de la forma aplanada | **4 rojas / 15 verdes** |
| **(4ª vuelta)** se ignoran los `formErrors` | cae la de la raíz que no es objeto | **1 roja / 18 verdes** |
| **(4ª vuelta)** el plural del sobrante se congela | cae la del singular | **1 roja / 18 verdes** |

🔬 **El mutante que sobrevivió y sí era un hueco:** quitar el `useEffect` que sincroniza el campo con
el plan del servidor dejaba la batería **entera en verde**. La prueba que existía pasaba el plan ya
recortado **desde el primer render**, así que sólo ejercitaba el valor **inicial** (que `useState` cubre
solo) y nunca el camino que importa: **el servidor responde con OTRO número después de teclear**. Se
reescribió para que el mock devuelva `499.99` tras teclear `500` y comprobar que el campo adopta el del
servidor. Con la prueba nueva, la misma mutación queda **roja (1/74)**.

🔬 **El otro es equivalente, y se dice en vez de callarlo:** vaciar el campo hace `delete` de la clave;
mutarlo a `nuevos[clave] = ''` deja la batería verde porque **el filtro de `cuerpoDeCompra` descarta
igual la cadena vacía**. Son dos capas que dicen lo mismo, así que **ninguna prueba puede distinguirlas
por su salida**. Se conserva el `delete` para que el mapa de estado no acumule claves muertas.

**Pruebas:** `ajuste-comprador.test.ts` **22 unitarias nuevas** (la regla entera: los dos ajustes por
separado y juntos, el cero, los redondeos, los dos bloqueos, el precio común) · `esquemas/mrp.test.ts`
**8 nuevas** del contrato (sólo-precio, sólo-cantidad, cero, negativo, tope, ajuste vacío) · **5 de
integración** en `mrp.int.test.ts` (el precio prometido = el guardado, el catálogo intacto, el último
precio tras autorizar, el bloqueo del `0.004` en previa y generación, y el renglón bloqueado que sigue
en pantalla) **+1 de la 2ª vuelta** (la previa marca la línea que la generación se salta, sin bloqueo de
por medio) · **17 de pantalla** en `ExplosionMaterialesPagina.test.tsx`, de 62 a **79** en el archivo
(las 12 de la 1ª vuelta + las 3 sondas del reviewer, la del aviso que no es permanente y la del
desorden). Suites completas: backend `test:unit` **1712/1712** (158 archivos), frontend `npm test`
**1468/1468** (182 archivos). En la 3ª vuelta: **+7** en `errores.test.ts` (de 5 a 12, con cuerpos
reales del handler HTTP) y **+1** aserción endurecida en `auth.int.test.ts` — ⚠️ ésta vive en el
**proyecto de integración**, así que **sólo el CI la juzga** (no corre en `test:unit`). En la 4ª:
**+7** más en `errores.test.ts` (de 12 a 19), con los cuerpos aplanados capturados ejecutando
`validarEntrada`.

### 🔴 Lo que el reviewer encontró y se corrigió antes de mergear

**El reviewer RECHAZÓ la primera vuelta.** El corazón estaba bien y lo verificó pieza por pieza (A1
conservado, un solo camino, `seEscribe` real, el catálogo intacto, los generados limpios), pero
encontró **una raíz con tres caminos, determinista y sin que fallara nada**:

`cuerpoDeCompra` traía un filtro que **descartaba en silencio** el valor inválido (`cantidad > 0`,
`precio >= 0`). Con la previa ya editable, eso significaba: el campo **conservaba el número malo** (el
`useEffect` sólo reacciona a `[valor]`, que no había cambiado), **no había dónde enseñar el error**
—`exp-error-previo` vive **sólo en la rama de la explosión, que está DESMONTADA** mientras se ve la
previa— y **«Confirmar» seguía encendido**. Lo probó con tres sondas y **las tres pasaron**:

| Sonda | Qué pasaba |
|---|---|
| `-5` en «Precio» | POST **sin el ajuste**, campo con `-5`, ningún aviso → **la OC nacía a $2**. El mensaje del contrato *"El precio no puede ser negativo"* **no se ejecutaba jamás** |
| `0` en «Comprar» | Idéntico: nada viajaba, nadie decía nada, la OC salía por **300** |
| El `POST /previo` **falla** | Campo `500`, **ningún** mensaje, el renglón con el total **viejo** ($600), «Confirmar» habilitado → **OC con un número que nadie revisó** |

🔴 **Y es el octavo caso del mismo patrón de la semana:** *el aviso existe, pero no sigue vivo quien lo
muestra*. Es literalmente lo mismo que el toast del panel que se desmontaba en **V1-E3x** — arreglado
allá, vuelto a entrar aquí por otra puerta.

**Cómo se arregló — quitando la regla, no moviéndola.** El camino elegido de los que ofrecía el
reviewer es el que él mismo señaló como el bueno: **el cliente no juzga el valor, lo entrega**. El
filtro se **eliminó** en vez de reubicarse, porque el servidor ya tiene las frases y es el único que
puede tenerlas (A1); duplicar su criterio aquí es exactamente cómo los dos se separan, **y el que calla
es siempre el cliente**. Menos código y una regla menos duplicada. Lo único que sigue sin viajar es el
campo **vacío** (que no es un valor sino su ausencia) y un valor **no finito** — que con `type="number"`
no puede salir del campo, así que tratarlo como vacío dice justo lo que la pantalla ya enseña.

Con eso, las tres mitades del arreglo:
- **(a)** `previo.isError`/`error.message` entran a `RevisionPrevia` como `errorRecalculo` y se pintan
  **dentro** (`exp-error-recalculo`), con la frase del servidor y el aviso de que *"los totales de abajo
  son los de ANTES de tu cambio"*.
- **(b)** «Confirmar» se apaga con `planDesfasado = recalculando || errorRecalculo !== null`, y el
  `title` del botón dice qué corregir.
- **(c)** El número malo **se queda en el campo** —ahora con el motivo a la vista— para corregirlo ahí.

**La variante menor de la misma raíz, también arreglada:** dos ediciones seguidas dejan dos `mutate` en
vuelo. Ahora un contador (`peticionPrevio`, un `ref`) hace que **sólo la última respuesta pinte**; no se
cancela nada, porque lo único que hay que garantizar es que la vieja **no pise** a la nueva.

**Y una afirmación FALSA en la doc, corregida:** el `HISTORIAL` decía que un precio negativo *"saca el
aviso rojo con el nombre del material"* — cierto para `0.004`, **falso para el negativo** (no salía nada
y la OC se generaba al precio anterior). La ficha tenía la versión suave (*"rechazado por el contrato"*:
lo rechazaría, pero el cliente nunca se lo entregaba). Las dos se reescribieron **según cómo quedó el
arreglo**, no al revés.

**El hueco de pruebas que señaló, cerrado:** ninguna prueba cubría la generación **saltándose** una
línea `seEscribe:false` **sin bloqueo de por medio**. Se agregó la integración que ata las dos mitades:
con `cantidadTotal: 0.01` entre dos OP no hay ningún bloqueo, la **previa marca** cuál línea no se
escribe (y su importe no entra al total del renglón) y **la generación escribe exactamente esa**.

### 🔴 Segundo rechazo del reviewer: *"la frase del servidor nunca llega a la pantalla"*

El arreglo de la 2ª vuelta se apoyaba en una premisa que quedó escrita en el código y repetida en los
dos documentos: *"el servidor ya tiene las frases y es el único que puede tenerlas"*. **Esa frase no
llegaba.**

- `backend/src/api/errores.ts` (rama 2): un rechazo de Zod sale como
  `{ codigo: 'VALIDACION', mensaje: 'Los datos enviados no son válidos.', detalles: [{ campo, mensaje: 'El precio no puede ser negativo' }] }`.
  **La frase específica vive en `detalles`, no en `mensaje`.**
- `frontend/src/api/errores.ts`: `mensajeDeError` devolvía **sólo `error.mensaje`**, y un `grep` de
  `detalles` en todo `src/` no encontraba **ni un lugar** que las pintara.

Comprobado con una sonda contra el cuerpo real: `mensajeDeError(cuerpo)` → `"Los datos enviados no son
válidos."`. Lo que Daniel iba a leer, con veinte renglones en pantalla, era eso y nada más: ni qué
campo, ni qué material, ni por qué. 🔴 **Incumpliendo el estándar que esta misma etapa fijó por
escrito** en `ajuste-comprador.ts`: *"un 'la cantidad es muy chica' a secas obliga al comprador a
adivinar cuál de veinte renglones fue"*.

🔬 **Y por qué el verde no lo delató — la lección que vale más que el arreglo.** La `SONDA 3`
mockeaba `error: { message: 'El precio no puede ser negativo' }`: **horneaba la premisa falsa**.
Probaba mi suposición sobre el backend, no el backend. Es primo hermano del mutante que sobrevivió en
la 1ª vuelta: la prueba pasaba **por cómo estaba montada**, no por lo que el sistema hace.

**El arreglo va en el PUNTO ÚNICO** (`frontend/src/api/errores.ts`), no en esta pantalla: el defecto
era de **toda la aplicación** —los `min`/`max` y los `refine` de todo el contrato tienen buenas frases
que nadie veía— y arreglarlo en un sitio las devuelve en todos lados, que es donde estaba el valor
desde el principio. `mensajeDeError` pega ahora las frases de `detalles` al mensaje genérico,
**deduplicadas** (veinte renglones con el mismo defecto no repiten la frase veinte veces) y **con tope
de 3** más *"y N problema(s) más"* (un aviso larguísimo no se lee).

**Las dos mitades del contrato quedaron con prueba, cada una en su lado:** el frontend, con cuerpos
copiados del handler real (`errores.test.ts`, +7); y **el backend**, que sólo comprobaba
`codigo: 'VALIDACION'` y ahora exige que la frase específica venga **dentro de `detalles[].mensaje`**
y no vacía (`auth.int.test.ts`). Si algún día el handler dejara de poblarla, el frontend volvería al
genérico y **ahora sí** se enteraría alguien.

**La `SONDA 3` se arregló para que mida el sistema:** construye el error con `new ErrorDeApi(cuerpo
real del backend)` —el mismo camino que recorre en producción— en vez de un mensaje ya digerido. La
prueba: con `mensajeDeError` mutado de vuelta al defecto original, **SONDA 3 se pone roja** (1/79) y
`errores.test.ts` cae entero (5/12). Antes, con el mock viejo, ninguna de las dos se habría movido.

**El barrido que el reviewer pidió por adelantado (la familia que tumbó el CI de #205):** busqué en
`frontend/src` y `frontend/e2e` aserciones sobre `'Los datos enviados no son válidos'` y sobre
`MENSAJE_ERROR_DESCONOCIDO`. 🔎 **Resultado: CERO aserciones que cambiar**, y la suite completa en
verde lo confirma. La única aserción de texto de error que existe en e2e (`login.spec.ts:33`,
`toHaveText` exacto) no se ve afectada — de hecho **ni siquiera pasa por `mensajeDeError`**: sale del
mapa de códigos de better-auth.

> 🔴 **CORRECCIÓN (4ª vuelta) — el número era correcto y la RAZÓN que escribí, falsa.** Afirmé aquí,
> en `HOJA-DE-RUTA.md` y en el commit que *"en todo el backend hay UN SOLO lugar que puebla `detalles`;
> ningún `ErrorDominio` lo hace"*. **No es cierto: hay DOS productores**, con formas distintas — ver el
> bloque siguiente. El barrido salió limpio de todos modos, pero **por un accidente de forma** (la
> guarda `!Array.isArray` descartaba sola la segunda forma), no por lo que escribí. Es la peor
> combinación posible: un dato correcto sostenido por un razonamiento falso **se lee como verificado**.

**Las dos frases de la doc se volvieron verdad solas** —que era la señal de que el arreglo es el
correcto—: el `HISTORIAL` ya puede citar *"El precio no puede ser negativo"* como lo que el usuario ve,
y la ficha, que *"la previa la pinta"*. No hubo que reescribirlas. Y como el arreglo es más ancho que
esta etapa, el `HISTORIAL` §0.018 **lo cuenta aparte**: los avisos de error del sistema entero pasaron
de *"no son válidos"* a decir qué estuvo mal.

### 🔴 Tercer rechazo: el SEGUNDO productor de `detalles` — el camino normal del dominio

**Dos productores, no uno**, y hay que decir cuál cubre qué:

| Productor | Forma de `detalles` | Cuándo |
|---|---|---|
| `backend/src/api/errores.ts:57` (rama Zod del handler HTTP) | **ARREGLO** `[{ campo, mensaje }]` | El `body` de la ruta no cumple su esquema |
| `backend/src/comun/validacion.ts:30` (`validarEntrada`) | **OBJETO APLANADO** `{ formErrors, fieldErrors }` (`z.flattenError`), propagado por `cuerpoDeErrorDominio` | El esquema de **dominio** rechaza — **320 llamadas** en `src/dominio`, el helper estándar de toda la capa (PLANMAESTRO §9.2) |

La 3ª vuelta cubría **sólo el primero**, así que la mitad **más transitada** del defecto seguía
abierta: un rechazo de dominio se leía *"Los datos capturados no son válidos."* a secas, con los
`fieldErrors` muriendo en el camino igual que antes — exactamente el defecto que esa vuelta declaraba
cerrado.

**Arreglado:** `frasesDeDetalles` reconoce ahora **las dos formas**. En la aplanada saca primero lo de
`formErrors` (lo que no cuelga de ningún campo) y luego los valores de `fieldErrors`; **las claves NO
se pintan** (`ajustes`, `cantFav` son nombres del esquema, no de la pantalla). El dedupe y el tope
siguen aplicando a las dos.

⚠️ **Y los cuerpos de prueba se CAPTURARON ejecutando `validarEntrada` de verdad** (`npx tsx` contra
`esquemaGenerarOcCuerpo` y `esquemaAvioCrear`), copiando su salida literal — no se inventaron. Es la
lección de la vuelta anterior aplicada a sí misma: *una prueba que mockea tu suposición prueba tu
suposición*. De ahí salieron los cuatro casos reales del bloque nuevo de `errores.test.ts`, incluido
el `formErrors` con la raíz que no es un objeto.

**Nit del reviewer, tomado:** *"(y 2 problema(s) más.)"* → *"(y 2 problemas más)"*, con singular
cuando sobra uno. Lo lee Daniel, no un log.

### Nota de cierre — ✅ HECHA (23-ago-2026)

**Sin migración, sin permisos nuevos, sin seed.** Reusa `compras.administrar` (el mismo que ya exigía la
previa: *es la primera mitad de comprar*): el deploy a `prueba` **NO requiere `SEED_ON_START`**.
Contrato regenerado en la misma tarea (`npm run openapi` → `npm run gen:api`).

**Lo que NO se hizo, y por qué:**
- **No se guarda "el precio propuesto" en la línea de OC.** La cantidad sí lo tiene
  (`cantidadSugerida`, §Post-F9.89(a)) porque la bandeja de autorización mide su desvío. Hacer lo mismo
  con el precio pide **una columna nueva y su migración**, y §Post-F9.94 no lo pidió. El desvío del
  precio **sí se ve en la previa** (chip «Precio ajustado») pero **no queda guardado**: anotado como
  deuda en `HOJA-DE-RUTA.md` §4, no callado.
- **No se toca el catálogo** — la razón completa arriba; es la regla de §Post-F9.88.
- **No se cambió la política de a quién se le compra** (`proveedor-material.ts` queda idéntico): esta
  etapa cambia **a qué precio nace la línea**, no quién gana.
- **No se agregó un rebote (debounce)** — la razón, en (f).

### 🔴 3ª vuelta: el reviewer independiente RECHAZÓ, y tenía razón (23-ago-2026)

**Lo que sobrevivió intacto, para que no se re-revise.** El riesgo declarado de esta vuelta era el
**merge**: la rama nació de la 0.016 y mientras tanto entró `V1-E3y`, que toca compras. Quedó
descartado con evidencia, no con confianza: el diff contra `prueba` **ni siquiera toca**
`ordenes-compra.ts`, `receta-orden.ts`, `comprometido-en-oc.ts`, `permisos.ts`, `seed.ts` ni
`ordenes-compra.rutas.ts` —byte a byte iguales—, y `mrp.ts` **no aparece en el stat del merge**
porque E3y nunca lo tocó: ahí git no auto-mergeó nada. El ajuste del comprador no mueve cantidades
comprometidas (`comprometidoEnOc` suma cantidades, no precios), no toca la receta, y la OC sigue
naciendo en `borrador`. **Escala del destino: correcta** — el `max` del precio cuadra exacto con
`Decimal(12,2)` y el redondeo a 2 va ANTES de comparar y de decidir el bloqueo, así que **no se
repite el defecto de V1-E3q**. Y de **16 mutaciones aplicadas, murieron 16**: las pruebas de la
etapa no son decorativas.

**🔴 El defecto, uno solo, con dos caras — y las dos REPRODUCIDAS CON SONDA, no deducidas.**
`CampoPrevia` reconciliaba su texto con `useEffect(…, [valor])`, y `valor` es **una cadena derivada
del plan**. Si el re-plan devuelve **el MISMO número** que ya estaba pintado, `valor` no cambia, el
efecto no corre y **el texto tecleado sobrevive**:

- **(a)** Renglón en `$2`. Se teclea `2.004`. El servidor redondea y devuelve `2` con
  `precioAjustado: true`: el chip dice *«Precio ajustado (propuesto $2.00)»*, el reparto dice
  `× $2.00`, el importe dice `$2.00`… **y el campo sigue diciendo `2.004`**. La OC nace correcta;
  **lo que miente es la PANTALLA** — que es todo lo que la previa es. Y miente exactamente contra la
  frase que esta misma versión promete por escrito: *«lo que se ve es lo que se va a guardar»*.
- **(b)** Renglón en `300`. Se teclea `0`, el servidor lo rechaza (bien), el plan no cambia. La
  persona se arrepiente y **borra** el campo → el ajuste se quita, el servidor devuelve el mismo
  plan → **el campo se queda EN BLANCO para siempre** mientras el renglón sigue diciendo `300 pza`.
  Y como `''` ya nunca vuelve a igualar a `'300'`, la guardia del `onBlur` deja de servir: **cada
  paso por el campo cuesta otra petición** y apaga «Confirmar y generar» un instante. Estado
  permanente hasta recargar.

⚖️ **La lección, que es la de la etapa entera:** el caso (a) es el **más frecuente** con precios
largos —los que salen de `precio ÷ factor`— y ninguna de las 77 pruebas lo tocaba, porque
`llegarALaPrevia` **siempre responde el mismo plan y nadie miraba el `value` del input después**.
*Una prueba que nunca mira lo que quedó escrito en el campo no puede cazar un campo que miente.*

**El arreglo: la reconciliación cuelga de la IDENTIDAD del plan, no de su valor** — un contador
`revisionPlan` que sube en cada respuesta del servidor **aunque los números vuelvan idénticos**
(respetando la guardia anti-respuesta-tardía), pasado como dependencia del efecto. Se descartó
`key={clave-revision}`: remontar tira el estado del input **y el foco** en cada respuesta, peor en
un formulario que se tabula.

**🔴 Y el arreglo del reviewer, SOLO, abría una regresión nueva — la cazó el coder, no la revisión.**
Con la dependencia en `revision`, tabular de «Comprar» a «Precio» dispara la petición de la cantidad,
y su respuesta —que ya no cambia el `valor` del precio, pero sí la `revision`— **le borra al
comprador el precio que va tecleando**. Se cerró con una **guardia de foco**: la reconciliación se
salta mientras el cursor está DENTRO del campo, y es autosanable (al salir, si lo escrito no es lo
del plan se confirma y el servidor contesta con el campo ya sin foco). Va con prueba propia, que la
mata. ⚖️ *Aceptar una receta correcta sin construir lo que la receta arrastra es cómo un arreglo
crea el siguiente defecto.*

**Los otros tres, cerrados en la misma ronda (aquí un defecto conocido NO es "menor"):**
- 🟠 **La fila de campos no envolvía**: el `<span>` pasó de un texto de ~130 px a dos `Input` con sus
  etiquetas (~490 px mínimos) sin `flex-wrap`, así que **desbordaba en horizontal** en móvil. Ahora
  envuelve (`flex-wrap` + inputs a `w-24`, ítem más ancho ~155 px contra los ~336 de la tarjeta).
- 🟠 **`cantidadTotal` no tenía tope, y la etapa acababa de ponerla al alcance de un teclazo.** Un
  `1e13` pasaba contrato y dominio y **reventaba en Postgres** como *numeric field overflow* → 500
  genérico en vez de una frase. Ahora `.max(999_999_999_999.99)`, **contado contra el esquema**
  (`OrdenCompraLinea.cantidad Decimal(14,2)` → 12 enteros + 2 decimales), con la cuenta escrita en el
  comentario y **una prueba que acepta el máximo EXACTO** — que es la que caza un tope mal contado
  (mutarlo a un dígito menos la pone roja).
- 🧹 **Basura de depuración heredada de V1-E3q**: `console.log('DBG renglones botón:', …)` con su
  `eslint-disable` inútil en `mrp.int.test.ts`. Era el único warning de lint del backend; ya no hay
  ninguno.

**Lo que la 3ª vuelta deja escrito para las que vengan:** la promesa *«el número que queda en el
campo es el del SISTEMA»* **era falsa hasta esta vuelta**, y estaba publicada en
`HISTORIAL-DE-VERSIONES.md` como si fuera un hecho. Una promesa redactada al construir no es una
promesa verificada; lo que la volvió cierta fue una prueba que **mira el `value` del input después
de que contesta el servidor**.

### 🔴 4ª vuelta: la guardia de foco reabría el mismo defecto por una puerta más estrecha

El segundo reviewer **volvió a RECHAZAR**, y el hallazgo es del tipo más caro: *el arreglo de la
vuelta anterior traía adentro el defecto que venía a cerrar.* La guardia se saltaba la
reconciliación **por tener el cursor dentro**, no por estar tecleando — y eso no es lo mismo.
Sonda del reviewer, con el gesto más natural que hay:

1. campo en `$2`, se teclea `2.004`, se sale con Tab → sale la petición, el botón dice
   *«Recalculando…»*;
2. el comprador **hace clic de vuelta en el campo** para revisar lo que puso;
3. llega la respuesta (`2`, con `precioAjustado`).

Medido: **`value = "2.004"` con el chip «Precio ajustado (propuesto $2.00)» al lado** — la MISMA
pantalla por la que la etapa fue rechazada en la vuelta anterior; y al salir, otra petición de más.
⚠️ **La ventana no es un instante: dura todo el recálculo**, que es exactamente cuando la persona
está mirando ese número.

**La condición correcta no es *tener el foco*, es *estar sucio*.** La marca se levanta al **teclear**
(`onChange`) y se baja **al salir** (`onBlur`); el `onFocus` desapareció. En un input controlado el
`onChange` **sólo lo dispara la persona** —nunca el `setTexto` del efecto—, así que la marca separa
con precisión **teclazos de repintado**, que es la distinción que el problema pedía desde el
principio. Con eso: vuelvo sin teclear → limpio → me corrige; vuelvo y tecleo → sucio → no me pisa.

**El segundo hallazgo de la misma raíz**, que sin la sonda no se ve: pasar por un campo **sin teclear
nada** podía hacer que el `onBlur` mandara **un ajuste explícito que nadie capturó** —encendiendo el
chip «Precio ajustado» y clavando ese precio en TODAS las líneas del renglón, pisando los precios por
OP de V1-E3m—. Hacía falta que el valor cambiara por fuera entre dos peticiones (otro usuario mueve
el catálogo), o sea **una puerta abierta, no un incendio** — y aun así se cerró, porque *aquí un
defecto conocido no es «menor»*.

⭐ **Y una mutación que SOBREVIVIÓ, resuelta por el camino honesto.** El reviewer cazó que mover
`enfocado.current = false` a después de `onConfirmar` no ponía roja ninguna prueba: el comentario
prometía una precaución (*«se suelta ANTES de confirmar»*) **que ningún camino ejercita**. El coder
lo verificó —React no corre efectos a media llamada del manejador, así que el orden es genuinamente
irrelevante— y en vez de inventar una prueba para sostener la afirmación, **borró la afirmación**:
ahora el comentario dice que el orden da igual, y por qué. ⚖️ *Una prueba escrita para justificar un
comentario no prueba nada; lo que hay que quitar es el comentario.* Es la misma lección de la 2ª
vuelta —*un dato correcto sostenido por una razón falsa se lee como verificado*— aplicada al revés.

**La frase del historial, verificada y NO tocada.** *«Mientras estás escribiendo dentro de un campo,
el sistema no te lo cambia. Se acomoda al salir.»* Con `sucio` es cierta **palabra por palabra**; con
la guardia de foco no lo era (no te lo cambiaba **estando parado sin escribir**), y de esa diferencia
salía el hallazgo. Es la tercera promesa de esta entrada que hubo que ir a comprobar contra el código
en vez de darla por buena.

**Declarado, no callado:** la mutación de `flex-wrap` (H3) sigue **sin prueba a propósito** — no hay
un solo `toHaveClass` en el frontend del proyecto, y montar la primera aserción de clases por esto
sería inventar una convención. Se verifica **a ojo en `prueba`**.

### 🔴 5ª vuelta: cerrar la previa no cancelaba lo que ella misma había disparado

Un reviewer **NUEVO** (a propósito: no había visto el código) confirmó que la guardia `sucio` quedó
bien —8 de 9 mutaciones muertas, la superviviente es la declarada, y la frase del historial es cierta
palabra por palabra contra el código— y **rechazó por otra cosa, de otra familia y más cara**.

**El defecto.** `onVolver` hacía `setPlan(null)` y nada más. `pedirPlan` filtra respuestas fuera de
orden con `peticionPrevio`, pero **salir de la previa no invalidaba nada**, así que *la petición
sobrevivía a la pantalla que la lanzó*. Sonda del reviewer, medida paso por paso:

1. en la previa se cambia «Comprar» de 300 a 77;
2. el comprador se arrepiente y hace clic en **«Volver y corregir»** → el `mousedown` saca el foco →
   el `onBlur` ve el cambio y **sale una petición** (medido: 1 en vuelo); el clic cierra la previa;
3. ya en la explosión, **quita una OP** — lo que además borra `ajustes`/`precios`;
4. llega la respuesta tardía → **medido: la previa REABRE sola con el plan viejo**;
5. la pantalla dice `Surte las órdenes 7, 8` y **«Confirmar y generar» manda `idsOrden: [51]`**,
   porque el cuerpo se arma con el estado ACTUAL.

⚖️ **Es peor que el campo que mentía:** la última pantalla antes de comprometer dinero **se abre
sola, sin que nadie la pida**, con el plan de un conjunto de OP que ya no es el elegido — y desde ahí
se emiten OC **para órdenes distintas de las que el comprador acaba de revisar**. Rompe la razón de
ser de la previa (*lo que ves es lo que se va a generar*). 🔴 **Lo introdujo ESTA etapa** (commit
`1d45098`): en `prueba` no existen `CampoPrevia`, `ajustarDesdeLaPrevia` ni `peticionPrevio`, y el
único `previo.mutate` es el que ABRE la previa — o sea que el camino *"petición en vuelo mientras se
sale de la previa"* nació aquí. **Nunca llegó a `prueba`.**

**El arreglo: `cerrarPrevia()`** sube `peticionPrevio.current` antes de `setPlan(null)`, en los
**cinco** sitios, revisados uno por uno (no aplicado a ciegas). El que no había señalado nadie:
`confirmarGeneracion` — con las OC **ya emitidas** y los requerimientos consumidos, reabrir una previa
vieja **propondría recomprar**.

**⭐ Y de aquí salió el hallazgo transversal de toda la etapa: el mock estático.** El reviewer había
medido que «Confirmar y generar» con el campo sucio mandaba el número a medio teclear *en la prueba*
pero **no en navegador real**, y lo dejó fuera del veredicto. El coder no se conformó: fue a ver por
qué diferían y **el defecto estaba en la prueba, no en el programa** — el mock reportaba un
`isPending` fijo, así que el botón nunca se deshabilitaba como en producción. Con un doble que sí
reporta el `isPending` de verdad, **ese caso** se comporta como el navegador y queda cerrado con
prueba en vez de con comentario.
⚖️ *Ese mock a modo es, con toda probabilidad, lo que dejó pasar varios de los defectos de estas
cinco vueltas: las pruebas no medían la pantalla, medían una suposición sobre la pantalla.*

> ⚠️ **Deuda declarada (no se arregló, y hay que decirlo con todas las letras).** El doble se
> arregló **en tres pruebas de 91**, no en el archivo: el `beforeEach` de
> `ExplosionMaterialesPagina.test.tsx` sigue sirviendo un `isPending: false` fijo a las otras 88, así
> que **ninguna de ellas ejercita la pantalla con una petición realmente en vuelo** — justo el estado
> donde vivían los defectos de las dos últimas vueltas. Se dejó así a propósito: reescribir el
> `beforeEach` cambia el terreno de todo el archivo y esa cirugía no cabía en una ronda de corrección
> sin volver a barajar pruebas que el reviewer ya había verificado. Queda como lo primero que hay que
> atacar si vuelve a aparecer un defecto de esta familia en esta pantalla.
>
> De esas tres, **dos montan el hook AUTÉNTICO** (`useMutation` de verdad con un `mutationFn`
> controlado: el fallo tardío de la petición abandonada y el error legítimo de «Revisar y generar
> OC») — ése es el camino a seguir. La tercera (el clic en «Confirmar y generar») usa un **doble con
> estado hecho a mano**, fiel para su caso pero **no equivalente al hook**, y lleva escrito por qué:
> `enVuelo` es un pestillo de una sola vía y **no repinta solo** — funciona porque el manejador que
> dispara la petición ya cambia estado de React. Para `revisar()`, que llama a `previo.mutate` sin
> tocar estado, no dispararía re-render. Quien lo reuse tiene que saberlo.

**El remate, decidido por el lead y no archivado.** Quedaba que un **fallo tardío** de una petición
abandonada siguiera pintando `exp-error-previo`. El coder lo había propuesto declarar como
pre-existente; **no lo era**: antes de esta etapa el único `previo.mutate` era el que ABRE la previa,
así que un error del previo siempre correspondía a algo que la persona acababa de pedir. Esta etapa
agregó un segundo emisor y con él el caso nuevo. Se cerró con `previo.reset()` dentro de
`cerrarPrevia` —verificando sitio por sitio que no borra ningún error legítimo, y quitando la llamada
duplicada que `elegirOrdenBase` ya tenía—, y **leyendo la fuente instalada de TanStack en vez de
suponerla**: `MutationObserver.reset()` se desuscribe de la mutación viva y `Mutation.#dispatch` sólo
notifica a los observadores que siguen en su lista. Queda citado con nombres de función en el
comentario. De paso, es una **segunda barrera independiente** del contador.

**⭐⭐ Lo que hay que no perder de esta vuelta: la prueba salió DECORATIVA dos veces, y el coder la
cazó él mismo.** Primer intento (`await Promise.resolve()`): la mutación sobrevivió → **falso verde**,
porque el error se pinta después de la microtarea que esperaba. Segundo intento (`setTimeout(0)`):
roja con la sonda puesta y verde sin ella → **inestable, que es peor que decorativa**. La versión
final ancla la espera al **estado real de la mutación** (`waitFor(() => expect(cliente.isMutating())
.toBe(0))`), que ocurre en los dos mundos: 3/3 roja sin el arreglo, 3/3 verde con él. La razón quedó
escrita en el comentario **para que nadie la "simplifique" de vuelta**.

### 🔴 6ª vuelta: guardas que funcionan y que nada sostiene — y la lección mordiéndose la cola

El reviewer **remidió su propio hallazgo con sus sondas y lo dio por cerrado** (la previa ya no
reabre; con **dos** peticiones en vuelo se invalidan **las dos**, no sólo la última; volver a pedir la
previa a mano después de cerrar funciona normal, el contador no dejó nada inutilizable), verificó
**contra la fuente instalada** la afirmación de TanStack —correcta palabra por palabra, incluido el
extremo de que los callbacks por-llamada viven en `#notify(action)` y el `#notify()` de `reset()` va
**sin** `action`— y confirmó que la prueba del `isMutating()` es estable. Y **rechazó por dos cosas
nuevas, las dos de la misma familia: afirmaciones que se leen como verificadas y no lo están.**

**🔴 (1) Cuatro de las cinco guardas no las sostenía NINGUNA prueba — y no son equivalentes.**
Revertir cualquiera de los cuatro a `setPlan(null)` dejaba la suite en **88/88 verde**; sólo el de
`onVolver` estaba vigilado. Y los caminos existen, medidos:
- **`confirmarGeneracion`** — los campos **no se deshabilitan** mientras se generan las OC: se pulsa
  «Confirmar y generar», con la generación en vuelo el comprador corrige un número, salen las OC (y
  se borran `ajustes`/`precios`/`seleccion`), y **el recálculo abandonado REABRE la previa con las OC
  ya emitidas** — proponiendo recomprar lo recién comprado. Era exactamente la consecuencia que la
  nota de la 5ª vuelta nombraba, **defendida sólo por un comentario**.
- **`agregarOrden`/`quitarOrden`** — «Revisar y generar OC» se deshabilita mientras hay `previo` en
  vuelo, pero **la lista de OP no**: agregar o quitar una OP con «Revisar» pendiente **abría la previa
  sola con el plan del conjunto viejo**.

Se cerraron con **tres pruebas** (las sondas del reviewer, levantadas tal cual), y esta vez **se
revirtió sitio por sitio para comprobar que cada guarda pone algo rojo**. ⚠️ **`elegirOrdenBase` sigue
sin prueba, y se dice en el código en vez de aparentar cobertura:** tiene un solo llamador detrás de
`idsOrden.length === 0`, y con la lista vacía **no puede haber plan en vuelo** (`revisar()` se sale
antes, y corregir un campo exige una previa abierta, o sea órdenes); para llegar a ese estado hay que
pasar por `quitarOrden`, que ya invalidó. La línea se queda —deja el sitio correcto de antemano si
algún día se entra por otra puerta— pero **declarada**.

**🔴 (2) La prueba escrita para defender el arreglo del mock estático… estaba hecha con un mock
estático.** Su docstring prometía cazar que alguien moviera el `reset()` a un sitio más general; el
reviewer **hizo literalmente eso** y salió **88/88 verde** — y no podía ser de otro modo: el caso
montaba `isError: true` **literal** y un `reset: vi.fn()` **inerte**, así que *ninguna* colocación del
`reset()` en el programa podía ponerlo rojo. Sólo probaba *«si el hook dice `isError`, la página
pinta el error»*, que no es la propiedad reclamada. Se rehízo con el **hook auténtico** (un
`mutationFn` que rechaza) **y** se reescribió el comentario para que diga sólo lo que sostiene,
nombrando las dos mutaciones que lo fijan y **el contraejemplo que legítimamente lo deja verde**.

⚖️ **La lección, y es la de toda la etapa:** *la enfermedad que acabas de diagnosticar se cuela en la
cura si no la mides también ahí.* Seis vueltas, y las tres últimas ya no cazaron defectos del
programa sino **pruebas que decían proteger algo y no lo protegían**.

📝 **Y dos frases de la propia documentación, corregidas en esta vuelta** (las cazó el reviewer): la
nota de la 5ª vuelta decía *«Arreglado el mock, la prueba se comporta como el navegador»* — falso tal
como estaba, porque el doble se arregló **en tres pruebas de 91**, no en el archivo; el `beforeEach`
sigue estático para las otras 88 y eso quedó **declarado como deuda** (ver el recuadro de arriba), no
callado. Y el mensaje del commit de la 5ª vuelta afirma *«queda fijado con prueba»* del error
legítimo: **no lo estaba** hasta esta vuelta. *(El commit ya está empujado y no se reescribe; queda
corregido aquí, que es donde se lee.)*

---

## V1-E3y · No se quita de la receta lo ya COMPRADO, y una OC autorizada se puede DES-AUTORIZAR ⭐ (22-ago-2026) — ✅ HECHA

**Lo pidió Daniel** (19-ago-2026), mirando el botón «restaurar del modelo»: *"¿Qué pasa si ya se
liberó un renglón, se hace la OC de ese avío… **se puede luego quitar**? Eso no está bien."* La
decisión completa —con la tabla de estados y las palabras textuales— está en
`Documentacion_MJD/DECISIONES.md §Post-F9.79`.

### El punto de partida, y el camino que se descartó

**Tenía razón, y nada lo impedía:** ninguna mutación de la receta consultaba las órdenes de compra.
Lo que quedaba tras quitar un material ya comprado era una **contradicción**: la OC decía *"compramos
esto para la orden N"* y la receta de N decía *"esto no va"*, así que la explosión dejaba de contarlo
y el *"qué tengo / qué falta"* ya no cuadraba con lo comprado. Peor si el renglón era
`agregadoAMano`: quitarlo **lo borra**.

⚠️ **El LEAD propuso un permiso para SALTARSE la regla** (que sólo Daniel pudiera quitar lo
comprado). **Daniel propuso algo mejor:** *"una OC ya autorizada ya no se puede quitar de la receta.
A menos que se pueda des-autorizar. Es indispensable tener un botón para desautorizar las órdenes,
que solo yo tenga acceso."* → **en vez de una llave para saltarse la regla, se deshace el hecho que
la creó.** Es el principio de D3 —cancelar es un inverso auditado, no un borrado— aplicado a la firma
de compra. **Las dos piezas van JUNTAS:** el bloqueo sin la marcha atrás sería una trampa sin salida.

### Qué se construyó

**Pieza 1 — el bloqueo** (`backend/src/dominio/produccion/receta-orden.ts`):

1. **`exigirNoSacarLoComprado`** — busca líneas de OC de la **misma empresa** (A9) ligadas a **esta
   orden** y a **este material**, con la OC en `autorizada`/`recibida_parcial`/`recibida_total`. El
   error nombra el **material**, los **folios** de la(s) OC y **qué hacer**; si ya se recibió, dice
   que ese camino **no existe** y por qué (devolución o ajuste).
2. **`requeridoDelRenglon`** (pura, exportada) — **cuánto pide la orden de ese material** con ese
   estado del renglón. Corta en `excluido`/`!paraProduccion` (que el MRP filtra en su `where`) y
   delega el número en **`requeridoAvioReceta`**, la MISMA función que usan la explosión MRP y la
   habilitación: una sola definición de R18, que no puede derivar.
   ⚠️ **NO es el filtro completo del MRP**, y conviene decirlo con precisión: el MRP filtra además
   por **`liberadoEn != null`**, que aquí **no se mira a propósito** (una firma revocada es un
   pendiente de firma, no una salida — ver la nota de cierre).
3. **`sacaDeLaCompra`** (pura, exportada) — el criterio, uno solo para las tres puertas: **antes
   pedía algo y después no pide nada**. El lado *"antes > 0"* es el que evita atrapar a nadie: un
   renglón que ya estaba fuera se puede seguir tocando.
4. **`medidasResultantes`** (pura, exportada) — la cascada de una medida por talla que llega en el
   cuerpo (`consumo` explícito → medida previa → consumo por prenda resultante). **Es la ÚNICA
   definición**: la usan `reemplazarMedidasAvio`, que la escribe, y la guarda, que necesita saber
   qué quedaría.

**Pieza 2 — des-autorizar** (`backend/src/dominio/compras/ordenes-compra.ts` →
`desautorizarOC`): quita el sello (`idUsuAutorizado`/`fechaAutorizado` → NULL), devuelve la OC a
**`borrador`**, exige **motivo**, deja bitácora con la firma que se borró (A7/D3), todo en **una
transacción** (A2). Permiso **PROPIO y nuevo `compras.desautorizar`**, ruta
`POST /api/ordenes-compra/:id/desautorizar`, y en el frontend el botón **«Des-autorizar»** con su
diálogo de motivo, al lado de donde vive la firma.

### Las decisiones que se tomaron al construir, y por qué

**(a) QUÉ MUTACIONES SE BLOQUEAN — tres de las cinco, y el criterio es uno solo: *¿esto saca de la
compra un material ya comprado?*** El caso que Daniel nombró es *quitar*, pero hay **dos puertas de
atrás** que logran exactamente el mismo efecto (verificado contra `dominio/compras/mrp.ts`, que
explota con `excluido: false` + `liberadoEn != null` + `paraProduccion: true`):

| Mutación | ¿Bloqueada? | Por qué |
|---|---|---|
| `quitarRenglonReceta` | **SÍ, siempre** | Es el caso de Daniel. Excluye (o **borra**, si era a mano). |
| `editarRenglonReceta` | **SÍ, sólo** si el cambio deja el requerido en **cero** | Lo demás —precio, amarre, notas, banderas de costo, subir o bajar el consumo o las medidas— **sigue libre**: ajustar lo comprado es legítimo. |
| `restaurarRenglonReceta` | **SÍ, sólo** si el valor del MODELO dejaría el requerido en cero | Restaurar **PISA** consumo, `paraProduccion` **y las medidas por talla** con lo que diga el modelo hoy: la misma puerta, entrada por el otro lado. Nunca excluye (levanta la lápida). |
| `traerDelModelo` | **NO** | Verificado en sus tres bucles: sólo hace `create` cuando el material **no está**, y `continue` en cuanto lo encuentra. No escribe ni un campo de un renglón existente. |
| `agregarRenglonReceta` | **NO** | Agrega o **REVIVE** una lápida: mete material a la receta, nunca lo saca. |

⚠️ **Y el criterio son TRES puertas, no dos** (ver la sección del reviewer, más abajo). Además de
apagar `paraProduccion` y de dejar el consumo en **0**, en un avío **por talla** (R18) el requerido
sale de las **MEDIDAS**: ponerlas todas en cero vacía la compra con los dos campos intactos. Por eso
el criterio dejó de ser una lista de campos y pasó a ser **el requerido real**: *antes pedía algo,
después no pide nada*.

**(b) Sólo TELA y AVÍO.** Una línea de OC apunta a `idTela` o `idAvio` (o es texto libre): **no hay
forma de ligar una OC a un ARTE concreto** de la receta, así que del arte no hay nada que comprobar.

**(c) Des-autorizar devuelve la OC a `borrador`, no a `pendiente_autorizacion`.** Verificado: **nada
en todo el sistema escribe `pendiente_autorizacion`** —por eso la bandeja de autorización pide
`borrador`—, y `borrador` es el estatus con el que **nacen** todas las OC. Así la OC des-autorizada
reaparece exactamente donde estaba antes de firmarse, y la bandeja la vuelve a mostrar.

**(d) El permiso va en el PERFIL, sin excepciones por usuario** (§Post-F9.67: *"cuando digo yo, es mi
perfil"*). En `prisma/seed.ts` se **resta de `directivo`**, así que queda sólo en **Administrador** y
**AdministracionDireccion** — mismo reparto que `terceros.administrar`. `compras.autorizar` **no se
toca**: firmar sigue cascadeando como siempre.

**(e) 🔴 EL EVENTO DE LA RUTA CRÍTICA BASTÓ — y se verificó antes de darlo por bueno.** El TSDoc de
`emitirOcTelaResuelta` decía que el consumidor *"relee el estado físico"*; se leyó
`reevaluarCompraTela` (`ruta-critica/autoAvance.ts`) y **es cierto**: busca *"¿hay una OC de la
empresa en autorizada/recibida\_\* con una línea de tela ligada a esta orden?"* y pasa
`completo: oc !== null` a `aplicarAProceso`, que **des-completa** cuando el renglón estaba completado
por evento. **No se escribió ningún inverso a mano**: des-autorizar emite el **MISMO** evento que
autorizar y cancelar, y el consumidor decide el efecto por lo que encuentra.

### Cómo se verificó (mutación, no sólo verde)

**Primera ronda** (contra el criterio de dos campos, antes del rechazo):

| Mutación | Resultado esperado | Lo que dio |
|---|---|---|
| `saldriaDeLaCompra`: `consumo <= 0` → `consumo < 0` (el 0 deja de sacar) | caen las dos de la puerta del consumo 0 | **2 rojas / 24 verdes** |
| `cuentaParaLaCompra`: quitar `paraProduccion` del filtro | cae la que mira ese campo | **1 roja / 25 verdes** |
| Botón: quitar `estatus === 'autorizada'` (ofrecerlo siempre) | cae la de "no aparece en borrador/recibida/cancelada" | **1 roja / 15 verdes** |
| Botón: leer `compras.autorizar` en vez de `compras.desautorizar` | caen las dos de permiso | **2 rojas / 14 verdes** |
| Diálogo: quitar la exigencia de motivo | caen las tres del diálogo | **3 rojas / 0 verdes** |

**Segunda ronda** (contra el criterio del requerido real, tras el rechazo):

| Mutación | Resultado esperado | Lo que dio |
|---|---|---|
| `requeridoDelRenglon`: forzar `consumoPorTalla: false` (o sea, **el criterio viejo**) | caen las de la tercera puerta y su espejo | **4 rojas / 28 verdes** |
| `sacaDeLaCompra`: cambiar el lado *"antes"* por `antes.consumoPorPrenda > 0` | caen el espejo y el requerido por medidas | **2 rojas / 30 verdes** |
| `medidasResultantes`: romper la cascada (`t.consumo ?? 0`) — **1er intento** | *(esperado: alguna roja)* | 🔴 **0 rojas / 32 verdes — SOBREVIVIÓ** |
| `medidasResultantes`: la MISMA mutación, ya con la cascada cubierta | caen las tres de la cascada | **3 rojas / 33 verdes** |

Pruebas: **+14** unitarias en `receta-orden.test.ts` (el requerido real, las tres puertas, el espejo,
el toggle y la cascada de medidas) · **+3** de pantalla en
`OrdenesCompraPagina.test.tsx` · **+3** del diálogo nuevo en `DialogoDesautorizarOc.test.tsx`
(motivo obligatorio, motivo de puros espacios, y el texto recortado) · **+7** de integración en `ordenes-compra.int.test.ts` (permiso
propio, motivo obligatorio, el sello borrado + re-autorizar, la bitácora con la firma vieja, los
estatus que no se des-autorizan, la OC **recibida**, y A9) · **+17** de integración en
`receta-orden.int.test.ts` (borrador sí se quita, autorizada no —con folio en el mensaje—, las dos
puertas de atrás clásicas, editar lo comprado sigue siendo legítimo, restaurar, la marcha atrás
completa, la OC recibida, cancelar libera, por material, por orden, la tela, el renglón que ya
estaba fuera, **y las CINCO del avío por talla**: medidas en cero, bajar la medida sin vaciarla, el
espejo del consumo 0, apagar el toggle, y restaurar desde un modelo que lo vaciaría) · **+1** en
`eventosRc.int.test.ts` (**la del evento**: des-autorizar des-completa `compraTela`).
Suites completas: backend `test:unit` **1696/1696**, frontend `npm test` **1443/1443**.

⚠️ **Honestidad sobre el alcance de la verificación local:** las mutaciones de la tabla son las que
se pudieron **ejercitar de verdad** aquí (las pruebas unitarias y de pantalla). Las **25 de
integración** no corren en local —usan Docker, que este proyecto prohíbe (§7.9)— así que **las juzga
el CI**, no una corrida propia.

### 🔴 Lo que el reviewer encontró y se corrigió antes de mergear — **RECHAZADA en la 1ª vuelta**

**Una TERCERA puerta de atrás: el avío POR TALLA (R18) con las medidas en cero.** La primera versión
de la guarda miraba `paraProduccion` y `consumoPorPrenda`. **Pero en un avío `consumoPorTalla` el
`consumoPorPrenda` NO es lo que explota** — es sólo el *fallback* de las tallas sin medida
(`receta-avios.ts`, usado por `mrp.ts`). El camino, sin tocar ninguna mutación bloqueada: avío por
talla comprado con `consumoPorPrenda = 2` y medidas 1, se editan las tallas a **0**
(`esquemaRecetaTallaEntrada.consumo` es `nonnegative`, el 0 pasa), la guarda ve los dos campos
intactos y **no bloquea nada**, y la explosión calcula **0**. La MISMA contradicción que la etapa vino
a impedir. **Y su espejo**: un avío con `consumoPorPrenda = 0` y medidas > 0 sí pide material, y el
criterio viejo lo daba por fuera — o sea, tampoco lo protegía al quitarlo.

**El arreglo NO fue añadir un tercer campo a la lista, y esa es la lección.** Una lista de campos
elegidos a mano siempre se queda corta: hay que acordarse de ampliarla cada vez que aparezca otra
forma de llegar al mismo sitio. El criterio pasó a ser **el número que de verdad manda** —
`requeridoDelRenglon` delega en **`requeridoAvioReceta`**, la MISMA función de R18 que usan el MRP y
la habilitación—, y `sacaDeLaCompra` pregunta una sola cosa para las tres puertas: **¿antes pedía
algo y después no pide nada?** Si la regla R18 cambia, la guarda cambia con ella y no puede derivar.

**Y de paso se quitó una duplicación que era el mismo error en pequeño:** para saber qué medidas
quedarían, la guarda espejaba a mano la cascada de `reemplazarMedidasAvio` (`consumo ?? previa ??
consumo por prenda`). Dos definiciones de lo mismo, con la guarda calculando sobre medidas que
podrían no ser las que se guardan. Ahora **`medidasResultantes` es la única definición** y
`reemplazarMedidasAvio` la USA. 🔴 **Lo cazó una mutación que SOBREVIVIÓ** (romper la cascada dejaba
la suite verde: ninguna prueba la ejercitaba) — un instrumento ciego justo en el punto donde la
guarda decide. Se cubrió con 4 unitarias y la misma mutación ya se pone roja.

**Una afirmación FALSA en tres lugares.** El código y los dos documentos decían que el criterio era
*"literalmente el filtro que usa la explosión MRP"*. **No lo era**: el MRP filtra además por
`liberadoEn != null` y, en avíos, por las medidas. Lo llamativo es que la ficha **citaba el filtro
completo dos párrafos más abajo** — el dato estaba a la vista y nadie lo cruzó. Corregido en los tres,
y ahora se dice explícitamente **qué NO se mira y por qué** (`liberadoEn`: una firma revocada es un
pendiente de firma, no una salida).

**Dos menores, arreglados en la misma ronda:**
1. **El mensaje mandaba a hacer algo que el lector no puede.** Decía *"primero des-autoriza esa orden
   de compra"* a un usuario que en el 99 % de los casos **no tiene esa llave** (es de Dirección). Ahora
   nombra el camino **y a quién pedírselo**: *"ese botón es del perfil de Dirección: si no te aparece,
   pídeselo a quien lo tenga"*.
2. **El `HISTORIAL-DE-VERSIONES.md` no nombraba `SEED_ON_START=true`** (decía sólo *"hay que sembrar el
   permiso"*), cuando los otros tres archivos sí lo dicen literal. Añadido: es lo que se pierde en el
   deploy.

### Nota de cierre — ✅ HECHA (22-ago-2026)

**Sin migración** (el sello ya vive en columnas nullable; quitarlo es un `UPDATE`, y el rastro lo
guarda la bitácora — D3), pero ⚠️ **CON PERMISO NUEVO** (`compras.desautorizar`) → **el deploy a
`prueba` SÍ requiere `SEED_ON_START=true`**. Sin eso el botón **no le aparece a nadie, ni a
dirección**.

**Lo que NO se hizo, y por qué:**
- **No hay columna `desautorizadaEn`/`motivoDesautorizacion` en `OrdenCompra`.** El rastro completo
  —quién, cuándo, por qué, y **la firma que se borró**— queda en la bitácora (A7/D3), que es el motor
  que el proyecto ya usa para esto. Una columna extra sólo tendría sentido si alguna pantalla o
  reporte pidiera filtrar por *"OC des-autorizadas"*, y **nadie lo pidió**.
- **No se bloquea `traerDelModelo` ni `agregarRenglonReceta`** — no sacan nada (razón verificada
  arriba, decisión (a)). Bloquearlas sería ruido que enseña a ignorar el aviso.
- **No se tocó la revocación automática de firma** (`enRecetaEditable` re-cierra el renglón editado,
  V1-E3h). Deja el material fuera de la explosión **transitoriamente**, pero es un pendiente de
  firma, no una salida: el camino de vuelta son dos clics y el material sigue en la receta.
- **No se ofrece «des-autorizar» sobre una OC RECIBIDA, ni siquiera con el permiso** — decisión de
  Daniel del 20-ago, no una limitación técnica: *"una vez recibido no se puede desautorizar"*.
- ⭐ **NO se tocó `PanelRecetaOrden.tsx` para dejar de mandar las medidas en `0`, y es a propósito.**
  Ese panel filtra las tallas **en blanco** (así se "descaptura" una medida), pero un `"0"` tecleado
  pasa el filtro y viaja como `consumo: 0` — es el camino por el que se llega a la tercera puerta.
  **Bloquear el 0 en la pantalla sería un error**: poner una talla en cero *"esta talla no lleva el
  avío"* es captura **legítima**, y el requerido sigue > 0 mientras las otras tallas tengan medida.
  Lo que hay que impedir no es el 0, es **vaciar el requerido entero** — y esa distinción sólo la
  puede hacer el servidor, que es quien conoce la matriz de la orden. Por eso la defensa vive donde
  vive el dato, y el panel se deja capturar libre.
- **No se reversa nada de inventario ni de kardex** al des-autorizar: una OC sin recepciones no
  movió existencias (y con ellas no se puede des-autorizar).

## V1-E5 · Que los números sean los tuyos

**Qué entrega**

1. ~~**El amarre proveedor↔insumo** (`ModeloTela.idTelaProveedor`, `ModeloAvio.idAvioProveedor`): las
   columnas existen y el motor **las lee**, pero **nada las escribe** — no hay API ni UI.~~
   → ✅ **YA ENTREGADO en V1-E3c (15-ago-2026)**, junto con `ModeloAvioTalla.idAvioMedida`: contrato,
   dominio y UI, con prueba HTTP + aserción contra BD y rechazo de amarre ajeno. La promesa de
   D13/R17 dejó de estar inerte. **Este punto sale de E5** (queda con 2, no 3).
2. ~~**El factor de conversión en la OC del MRP**: la línea va en unidad de consumo y el resto la lee
   como presentación. Con un rollo de 50 m, recibir **infla la existencia ×50 y divide el costo
   ÷50**. Hoy solo avisa.~~
   → ✅ **RESUELTO en `V1-E8a` (26-ago-2026)**, y **no como se planteaba aquí**: Daniel lo cortó de
   raíz (§Post-F9.97) — *"la información viene desde el desarrollo, y ahí se costea por metro, no por
   rollo"*. En vez de arbitrar entre las dos convenciones, **se retiró el factor de conversión
   completo** y quedó la regla de que la línea de OC va SIEMPRE en unidad de consumo. **Este punto
   sale de E5**, que se reduce a los días de crédito.
3. **Los días de crédito del cliente**, que hoy **se ignoran**: el vencimiento se persiste como la
   fecha del cargo, así que toda factura cae en "vencido" al día siguiente y **el aging de CxC es
   falso**.

**Qué NO entra:** el timbrado (R14, diferido), el ETL de apertura de Finanzas (espera el corte de
SINUBE), y la liga entrega→cobro.

---

## V1-E6 · Preparar el arranque

**Qué entrega**

1. **Permisos a los roles funcionales de RC**, o forzar en la UI que cada usuario lleve **dos roles**
   (uno de acceso + uno funcional). Hoy los 18 se crean **sin un solo permiso**: quien reciba solo su
   rol de RC **entra y no ve nada**. *(Aplica aunque la RC esté apagada: los roles existen y se van a
   asignar.)*
2. **Guard anti-lockout de usuarios** (existe para roles, no para usuarios): con 23 usuarios
   creándose a mano, desactivar al último admin deja el sistema sin llave.
3. **Respaldo `pg_dump` diario cifrado a R2** — es la mitigación #1 del plan de riesgos y **no
   existe**; hoy solo está el backup de Railway, y habilitarlo es manual.
4. **Cabeceras de seguridad en nginx** (HSTS, CSP, X-Frame-Options, nosniff, Referrer-Policy).
5. **Cambio de contraseña de auto-servicio** (hoy solo el admin puede cambiarlas).
6. **El salto de escalón en `reparar-secuencias.ts`** (§Post-F9.36 punto 5): OP y OC. El número exacto
   se elige **en el ensayo**. ⚠️ Irreversible.
7. **Los 10 catálogos de uso general**: opción 2 de Daniel — **leer libre, editar con permiso**. Se
   resuelve **parejo en los diez** o no se resuelve.
8. **Festivos 2027** si el go-live cruza el año (hoy están hardcodeados solo los de 2026).

### E6a — ✅ HECHA (17-ago-2026): el respaldo mensual cifrado a R2

> **Adelantada del resto de E6 por decisión de Daniel** (*"sí ok"*, 16-ago): de los ocho puntos de
> esta etapa era **el único que protege de algo sin vuelta atrás**, y por eso se construyó antes de
> que empiece a capturarse trabajo real.

**Qué es y por qué existe habiendo backups de Railway.** Los diarios de Railway **están encendidos** y
cubren el día a día. Éste es el **segundo** respaldo del `PLANMAESTRO` §91 (*"además de los backups de
Railway"*), y su único valor es el caso en que **el problema SEA Railway**: cuenta suspendida, servicio
borrado, caída larga, o mudarse. Un respaldo que vive dentro de Railway se va con el barco.
**Cadencia mensual** por decisión de Gabriel (§Post-F9.62) — desviación consciente del plan, que decía
diario.

**Qué quedó.** Job pg-boss mensual: `pg_dump` → cifrado **AES-256-GCM** (sal por archivo, IV por
corrida, etiqueta verificada, streaming de 64 KB) → subida a R2 → **verificación con HeadObject de que
el objeto quedó y el tamaño cuadra** → retención → rastro. **Retención de 12 copias, no de días**
(la frecuencia es configurable y una retención en días cambiaría en silencio cuántas copias existen),
con piso no configurable de **35 días**. Script de restauración con `--listar`, `--sha256`,
`--solo-verificar` y `--si-estoy-seguro`, y **ensayo de restauración automatizado** en la suite.

**El requisito rector era que NO fallara en silencio**, y con cadencia mensual pesa más: *si falla en
enero, nadie lo nota hasta junio*. **Tres rondas de revisión giraron casi por completo alrededor de
eso.**

**Lo que cazó el reviewer, todo EJECUTANDO (nada por lectura):**

- **⭐ Ronda 1 — dos caminos morían callados.** (1) **Sin motor de jobs, el respaldo no se programaba y
  no dejaba NI UNA línea** — y no es hipotético: el backend arranca antes de que Postgres responda y
  **sigue sirviendo** (la cicatriz de `CLAUDE.md` §8), así que el escenario más probable era justo el
  invisible. (2) El `mkdtemp` estaba **fuera del `try`**, así que un disco lleno hacía **lanzar** a una
  función cuyo contrato dice *"NO lanza"*, y el fallo terminaba anotado dentro del **único esquema que
  el respaldo excluye del volcado**. Invisible por partida doble.
- **Dos de las tres guardas de la retención tenían pruebas decorativas:** el código protegía, pero
  borrarlas dejaba **31 pruebas en verde**. Falla la red de seguridad, no la red eléctrica.
- **La regresión de `pg_restore --dbname` no protegía al script**: el ensayo **copiaba** los argumentos
  en vez de llamar a la función real. Borrando `--dbname` del script, pasaba **6/6**.
- **⭐ Ronda 3 — un defecto NUEVO, nacido del arreglo de la ronda 2.** Al escribir la fila "en curso" al
  empezar, el barrido de huérfanas **cerraba corridas que seguían VIVAS** y dejaba en la bitácora un
  **FALLO que nunca ocurrió** — con los dos rastros contradiciéndose y **mintiendo el inmutable** (A7/D3).
  Además dos corridas compartían key y una **pisaba el objeto de la otra en R2**.
  **El disparador no era exótico, era el propio diseño contra sí mismo:** pg-boss da el job por expirado
  a los **15 minutos** y lo reintenta sin matar al que corre, mientras el `RESPALDO_TIMEOUT_MIN` recién
  introducido declaraba **180**. Dos números contradiciéndose, ganando el de la cola. **Latente hoy**
  (el volcado pesa 641 KB y tarda segundos); **se encendía solo** conforme creciera la base — el
  horizonte exacto para el que se escribió ese timeout.
  **Se cerró derivando AMBOS del mismo número** (`ventanaCorridaMinutos()` = timeout + 60 de margen),
  para que no puedan volver a desalinearse, más guarda de antigüedad en el barrido y `singletonKey`.

**Decisiones declaradas, no silenciadas:** la key compartida se resolvió **por la causa** (impedir el
solape) y no haciendo la key colisión-proof · se prefirió guardar el **SHA-256 en la BD** antes que
mandar `ChecksumSHA256` a R2 sin poder probarlo (*"mandar a ciegas algo que puede romper la primera
corrida habría sido lo contrario de esta etapa"*) · el esquema `pgboss` **se excluye** del volcado
(restaurarlo re-dispararía trabajos viejos), con el hueco fino —evento publicado pero no consumido—
escrito en la cabecera del script.

**⚠️ La limitación real, dicha y no escondida:** el aviso es **PASIVO**. No hay correo ni notificación
(el plan los difirió). Revisar la bitácora tiene que ser parte del procedimiento mensual hasta que
exista notificación activa.

**Dos lecciones de proceso que valen para todo el proyecto:**

1. **Nunca juzgar un comando ENTUBADO.** `npm run lint | tail` devuelve el exit de `tail` — **siempre
   0**. Así se reportó "lint limpio" estando rojo. **Capturar `$?` a archivo.** Lo sufrieron los dos
   lados y lo confirmaron ejecutando.
2. **Comprobar cada afirmación contra el diff antes de escribirla.** Los dos únicos tropiezos del coder
   con el reviewer **no fueron errores de código sino afirmaciones no verificadas**.

**Nota de despliegue:** **una migración aditiva** (`respaldo_corrida` + enums). **CERO permisos nuevos,
CERO seed.** Requiere que Gabriel ponga `RESPALDO_LLAVE` en Railway **y la guarde también fuera**
(si se pierde, los respaldos son irrecuperables por diseño). Procedimiento completo en
`docs/GUIA-RAILWAY-R2.md` §7.1.

---

## V1-E7 · El ensayo

Sobre **base vaciada** (nunca encima de lo que hay en `prueba`, que mezcla la foto vieja con
documentos capturados a mano).

Migraciones + seed → `export ETL_DESDE=2025` → la Regla 3 completa de `backend/migracion/README.md`
**cronometrando cada paso** → `realinear-estado-ordenes` + `reparar-secuencias` → **leer los 6
cuadres con Daniel** (el kardex de PT y telas en CERO es lo **esperado**) → crear los ~23 usuarios
con sus dos roles → capturar direcciones de entrega, RFC y las telas con las que se está trabajando →
**la prueba reina**: pedido → orden → explosión → OC → recepción → corte → maquila → recibo → entrega
→ costo, cuadrando cada número a mano.

---

## Lo que queda FUERA de la primera versión

- **Ruta Crítica** (§Post-F9.36 punto 1) — se construye después, y con ella el **concentrado de
  pendientes por persona** que pidió Daniel.
- **Calidad** — se puede apagar sin reservas; nada valida ni bloquea contra auditorías.
- **CxC / CxP** — dormidas hasta el corte de SINUBE. Cobranza sin saldo de apertura **da respuestas
  equivocadas**. *(EsMa sí se migra: los maquileros tendrán saldo el día 1 y los clientes no.)*
- **El importador Excel de conteo físico** — dejó de ser bloqueante al decidirse el arranque sin
  conteo; se construye cuando se quiera cargar el resto del almacén.
- **Avíos por tamaño** y **el arte dentro del modelo** (§Post-F9.33 y §Post-F9.35) — segunda etapa.
- **Remisión / packing list** — el comprobante de entrega actual basta (§Post-F9.36 punto 6).
- **Timbrado (R14)** — la factura se sigue haciendo en SINUBE.

> 🔴 **PRECONDICIÓN OPERATIVA DEL ETL DE APERTURA (23-ago-2026) — escrita aquí para que no se pase.**
> **NO se corre el ETL de apertura de Finanzas hasta que `clientes.dias_credito` esté capturado.**
> El loader (`backend/migracion/loaders/terceros-saldos.ts:313-324`) **sí lee** el plazo y calcula bien
> el vencimiento — pero `backend/migracion/loaders/clientes.ts` **NO carga ese campo** (`grep
> diasCredito` → 0), así que **todo cliente migrado nace con el plazo en NULL**. Si el ETL corre así,
> produce **exactamente la misma cartera falsa** que el defecto de `terceros.ts:46` — sólo que con el
> código ya sano, y entonces **no habrá a qué culpar**. *El código correcto con el dato vacío da el
> mismo resultado que el código roto.*

## Preguntas abiertas

**Ninguna de producto.** La última —si la salida de tela debía generar «nota de salida»— la cerró
Daniel el 13-ago (§Post-F9.38): **la salida a una orden no lleva nota**, el **traspaso entre
almacenes sí**. Ambas cosas entran en V1-E3.

**Ninguna de diseño tampoco.** Daniel confirmó que la nota del traspaso **no genera folio nuevo**:
es la **impresión del folio que ya existe** (*"no debe de generar otro folio de nada"*). Sin registro
`NotaSalida` paralelo y sin secuencia nueva.
