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

### E3b — construida (13-ago-2026): los papeles y el inventario de PT

> **Estado:** código y doc terminados en la rama de tarea; **revisión independiente en curso** al
> momento de escribir esta nota. No se abre el PR a `prueba` hasta que el reviewer apruebe.

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

## V1-E3c · El editor de la receta del modelo (PROPUESTA — 13-ago-2026)

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

---

## V1-E3d · El BOM vive en la OP ⭐ (14-ago-2026)

**Indispensable para la primera versión** (Daniel: *"creo que sí es indispensable… De hecho así
funciona en control viejo. El BOM debe de vivir en la OP"*). Decisiones en `DECISIONES.md`
**§Post-F9.43**.

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

---

## V1-E5 · Que los números sean los tuyos

**Qué entrega**

1. **El amarre proveedor↔insumo** (`ModeloTela.idTelaProveedor`, `ModeloAvio.idAvioProveedor`): las
   columnas existen y el motor **las lee**, pero **nada las escribe** — no hay API ni UI. Es la
   promesa central de D13/R17 y hoy no se puede ejercer: el precosto de tela cae al precio sugerido
   genérico y el de avío al **más barato automáticamente**.
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
