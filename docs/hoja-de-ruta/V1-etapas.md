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

**Qué NO entra:** el factor de conversión del MRP, el amarre proveedor↔insumo, que la explosión
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
- **Deuda pre-existente que ahora se ve más:** con factor de conversión ≠ 1, el último precio arrastra
  el defecto conocido del MRP (`HOJA-DE-RUTA` §4). `costo-real-compras` avisa; la receta y el precosteo
  todavía no.

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

### Nota de cierre — ⬜ EN CORRECCIÓN (18-ago-2026)

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

⚠️ **Acción de despliegue que NO puede saltarse:** el forzado **mueve dinero** para la combinación
heredada (avío con medidas activas **y** `consumoPorTalla = true`): pasa de promediar consumos por talla a
usar el consumo por prenda en el primer guardado. Daniel lo decidió, así que no se discute — pero **hay
que contar cuántas filas están en ese estado en `prueba` y enseñárselo a Gabriel antes de subir**.
Cambiar costos a ciegas no es opción.

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

## V1-E5 · Que los números sean los tuyos

**Qué entrega**

1. ~~**El amarre proveedor↔insumo** (`ModeloTela.idTelaProveedor`, `ModeloAvio.idAvioProveedor`): las
   columnas existen y el motor **las lee**, pero **nada las escribe** — no hay API ni UI.~~
   → ✅ **YA ENTREGADO en V1-E3c (15-ago-2026)**, junto con `ModeloAvioTalla.idAvioMedida`: contrato,
   dominio y UI, con prueba HTTP + aserción contra BD y rechazo de amarre ajeno. La promesa de
   D13/R17 dejó de estar inerte. **Este punto sale de E5** (queda con 2, no 3).
2. **El factor de conversión en la OC del MRP**: la línea va en unidad de consumo y el resto la lee
   como presentación. Con un rollo de 50 m, recibir **infla la existencia ×50 y divide el costo
   ÷50**. Hoy solo avisa.
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

## Preguntas abiertas

**Ninguna de producto.** La última —si la salida de tela debía generar «nota de salida»— la cerró
Daniel el 13-ago (§Post-F9.38): **la salida a una orden no lleva nota**, el **traspaso entre
almacenes sí**. Ambas cosas entran en V1-E3.

**Ninguna de diseño tampoco.** Daniel confirmó que la nota del traspaso **no genera folio nuevo**:
es la **impresión del folio que ya existe** (*"no debe de generar otro folio de nada"*). Sin registro
`NotaSalida` paralelo y sin secuencia nueva.
