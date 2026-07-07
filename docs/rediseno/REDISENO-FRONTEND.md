# Rediseño del Frontend — CONTROL v2 (handoff entre sesiones)

> **Para el chat que retoma esto:** este documento es el traspaso de una sesión de diseño que corrió **en local** (no se pudo transferir a la nube). Aquí está **todo**: la dirección aprobada, el sistema de diseño, el menú, cada pantalla diseñada con su lógica de negocio y las decisiones de Daniel. El entregable tangible es un **prototipo HTML autocontenido**: [`prototipo.html`](./prototipo.html) (ábrelo en un navegador; funciona sin build, sin servidor, con datos de ejemplo en memoria). **Léelo junto con este doc.**
>
> Estado: **prototipo aprobándose pantalla por pantalla con Daniel**. Todavía **NO** se ha tocado el código real de `frontend/`. La implementación real va después, con el proceso normal del proyecto (coder + reviewer, PR a `prueba`, verificación de Gabriel en Railway).

Fecha de arranque: **4–5 jul 2026**. Rama: **`tarea/rediseno-frontend`** (creada desde `origin/prueba`, sin trackear).

---

## 1. Qué pidió el cliente y por qué

Daniel (dueño del negocio) y Gabriel (desarrollo) pidieron un **rediseño COMPLETO del frontend** de CONTROL v2. No les gustaba el estándar visual actual (**teal "lista + detalle"** con menú colapsable). Lo que se acordó por preguntas dirigidas:

| Pregunta | Respuesta de Daniel |
|---|---|
| **Alcance** | **Overhaul completo**: nueva identidad + nuevo shell de navegación + layouts de página rediseñados. |
| **Estilo visual** | **Denso / "pro de datos"** (ERP serio, tabla-first, eficiente, poco aire desperdiciado). |
| **Qué le choca del actual** | El **layout/navegación** y la **densidad**. |
| **Color** | **Verde**, porque su marca es verde. (El teal actual jala a azul; se va a un **verde de marca real**.) |

### 1.1 Principio rector (aplica a TODAS las pantallas) ⭐

> **Tomar el QUÉ del sistema viejo (Access), mejorar el CÓMO.**

Daniel lo dijo explícito: *"así lo hice yo hace más de 20 años; no quiere decir que tenga que ser idéntico… mucho mejor, desde los espaciados hasta todo"*. Es decir: de las pantallas viejas se reproduce **la información, las relaciones y la lógica de negocio**, pero el **diseño (espaciados, jerarquía, tipografía, densidad, interacción) es moderno y NO imita** el layout de Access. El sistema viejo es referencia funcional, no estética.

---

## 2. Sistema de diseño (tokens)

Dirección: **denso, verde de marca, riel oscuro, tabla-first, claro/oscuro**. Todo tokenizado (igual que el real, que usa Tailwind v4 CSS-first con variables en `frontend/src/index.css`).

### Color (los hex exactos del prototipo)

**Claro (`:root`)** — neutros con leve sesgo verde:
- `--bg: #f4f7f4` · `--panel: #ffffff` · `--panel-2: #fafbfa` · `--hover: #f1f5f2`
- `--text: #101c16` · `--muted: #5b6b62` · `--faint: #8b988f`
- `--border: #e3e9e4` · `--border-strong: #d2dbd5`
- **Marca (verde pino/esmeralda, NO teal):** `--brand: #0e7c47` · `--brand-hover: #0b6a3c` · `--brand-fg: #fff` · `--brand-soft: #e2f2e9` · `--brand-bright: #16a05c`
- **Riel de navegación (verde muy oscuro, IGUAL en claro y oscuro):** `--rail-bg: #0b1712` · `--rail-fg: #aebfb5` · `--rail-fg-strong: #ecf3ef` · `--rail-active-fg: #55e39a` · `--rail-active-bg: rgba(52,217,138,.12)`
- **Semánticos (separados del verde de marca):** `--ok: #12864e` · `--warn: #b3790c` · `--crit: #cf3b3f` · `--info: #2b7f9e` (cada uno con su `*-soft`).

**Oscuro (`:root[data-theme="dark"]` / `@media`)** — verde profundo elegante:
- `--bg: #0a120e` · `--panel: #0f1813` · `--text: #e7efe9` · `--border: #1d2b23`
- `--brand: #22b56c` · `--brand-bright: #34d98a` · `--brand-soft: #12291d`

El tema por defecto es **claro**; el oscuro se activa con `data-theme="dark"` (toggle) o `prefers-color-scheme`. El riel se queda oscuro en ambos temas para anclar la marca.

### Tipografía
- UI/datos: **stack de sistema** (`ui-sans-serif, system-ui, -apple-system, "Segoe UI"…`). En Mac se ve como SF Pro. (En el real hoy es Inter Variable; se puede conservar Inter o migrar — el stack de sistema es deliberado para densidad y nitidez.)
- Cifras y códigos: **monoespaciada** (`ui-monospace, "SF Mono"…`) + `font-variant-numeric: tabular-nums` en TODA columna numérica (clave en un ERP: los números alinean).

### Densidad / forma
- Filas de tabla ~28–34px, base 13px. Radios: `--radius: 9px` (chips 20px). Chips de estado, badges con punto de color, semáforos.

---

## 3. Shell / navegación (lo nuevo)

- **Riel oscuro a la izquierda** (~216px, colapsable a 62px con **⌘B**), agrupado por secciones con **desplegables colapsables** de 2 niveles.
- **Barra superior**: buscador/command **⌘K** (encuentra órdenes y módulos), empresa activa, alertas RC, toggle claro/oscuro, usuario.
- **Contenido tabla-first** con **cajón de detalle deslizante** (o panel persistente en la pantalla de Órdenes).

### 3.1 Estructura del menú (APROBADA, con desplegables)

Un **padre con hijos SOLO despliega** (no navega); el hijo navega. El hijo principal va primero. Máximo 2 niveles.

```
OPERACIÓN
  Desarrollo ▾      Modelos · Pre-costeos · Cotizaciones / Listas de precios
  Pedidos
  Producción ▾      Órdenes (OP) · Notas de salida
  Ruta Crítica      (acceso directo a "Mis pendientes")
  Calidad ▾         Auditorías · Auditores
INVENTARIOS
  Inventario PT · Telas · Avíos · Compras / MRP
COMERCIAL
  Clientes ▾        Catálogo · Listas de precios · Ventas
  Proveedores       (acceso directo a su catálogo)
FINANZAS
  Cuentas por cobrar · Cuentas por pagar    (+ CFDI a futuro)
ANÁLISIS
  Análisis RC · Costos · EDR · Indicadores
SISTEMA
  Catálogos base ▾  Colores · Tallas · Temporadas · Tipos de proceso · Almacenes
  Procesos y responsables   (config de la Ruta Crítica: procesos · tiempos · antecesores · responsables)
  Usuarios y accesos
```

**Decisiones clave del menú (Daniel, 4-jul):**
- **Clientes y Proveedores NO son "catálogos"** → son entidades de primer nivel bajo **COMERCIAL**.
- Las **cuentas (CxC/CxP) salen a una sección FINANZAS** propia (es el módulo de Finanzas del plan, generaliza EsMa). No viven dentro de la ficha del cliente/proveedor.
- **Compras/MRP SOLO en INVENTARIOS** (a Daniel le hacía ruido verla dentro de Proveedores). Proveedores es acceso directo a su catálogo (no se le cuelga un desplegable de un solo elemento).
- **Catálogos base** (colores, tallas, temporadas, tipos de proceso, almacenes) = listas de referencia de baja frecuencia → bajo **SISTEMA**.
- **Desarrollo** incluye **Cotizaciones / Listas de precios** (fase nueva F8 del plan: Desarrollo, Cotización y Listas de Precios).

---

## 4. Pantallas diseñadas (con su lógica de negocio)

> Cada pantalla se diseñó a partir de un **screenshot del Access viejo** que Daniel mandó + su explicación por voz. Aquí queda el resumen funcional. El detalle visual/interacción está en `prototipo.html`.

### 4.1 Pedidos — "por mes", pedido interno que agrupa varias OP ✅
- Pantalla **por mes** (tabs Ene–Dic + Todos), como la vieja "Por Meses".
- Un **pedido interno** tiene **folio consecutivo `-F`** (ej. `1502-F`) y **agrupa varios modelos**; **cada modelo = una orden de producción** (No. Ord).
- Daniel los agrupa porque van **juntos en compra de insumos y en la entrega** (ej. 5 modelos relacionados del depto. de niños de un cliente, misma tela/colores).
- UI: **tabla agrupada expandible** (cabecera de pedido con Cant. total + Importe total; debajo el desglose de modelos/órdenes con Cant., Precio, Importe, No. orden, Corte, Estatus). **Barra de totales** abajo (pedidos, órdenes, piezas, cortado, % avance, importe). Filtros: Cliente, Año, Empresa (FR Moda / Marilyn Fitness), estatus, Cantidades (Pendiente/Pedida).
- Click en un modelo → cajón con detalle de la orden y sección **"Va junto con"** (los demás modelos del pedido).

### 4.2 Órdenes de producción — PANTALLA PRINCIPAL / centro de comando ⭐ ✅
Es **la** pantalla; están en ella todo el día. Prioridad #1 de Daniel: **filtrado ágil**.
- **Filtros arriba**: buscador (OP / modelo / **pedido del cliente**) + selects (Cliente, Maquilero, Estampador, Empresa, OC tela) + **tabs de Mes de entrega**.
- **Tabla densa con 13 columnas** (significado exacto de cada una):
  1. **Empresa** (FR Moda / Marilyn Fitness — misma empresa, dos marcas).
  2. **No. OP** (consecutivo).
  3. **Modelo**.
  4. **Pedido del cliente** — en el Access aparece como campo **"monarch"** pero **NO es monarch**: es la **referencia/pedido del cliente** (D7: campo reutilizado; generalizar a "ref. del cliente").
  5. **Cant. ordenada**.
  6. **Cant. cortada** (0 = no se ha cortado; en gris/ámbar/verde según avance).
  7. **Maquilero** (al que se mandó).
  8. **Nº de maquileros** — badge `×2` si va a más de uno.
  9. **Estampador / bordador** (el primero asignado).
  10. **Pedido interno** (liga a la pantalla de Pedidos, el `-F`).
  11. **OC de tela** — si la OP ya tiene una orden de compra de **tela** relacionada, se muestra el folio. **Indicador clave** ("¿ya compramos la tela?"): verde `✓ 7654` si sí, ámbar "falta" si no.
  12. **Mes de entrega**.
  13. **Cliente**.
- **Panel de detalle a la derecha** (persistente; **encabezado + botones + matriz FIJOS arriba**, sin scroll — petición de Daniel):
  - **Matriz color×talla** (lo más relevante, va primero): colores y tallas **tomados de la orden** (no se pueden meter colores ajenos), con totales por talla y color y gran total. Reproduce la vieja (ej. OP 5424: Rojo A + Rojo B = 1,726).
  - **Precios**: venta, **maquila** y **aplicación** con botón **"editar" (solo con permiso)**; **Costo restringido 🔒**. (Ver 4.4.)
  - Encabezado (fechas, pedido cliente, pedido interno, etiqueta, observaciones), Tela y compra (OC tela, maquilero, estampador), Foto del modelo.
  - **Botones a módulos relacionados** (mosaicos): Modelo, Habilitación (avíos), **Notas de salida** (remisiones a maquileros ligadas a la OP), **O.C.**, **Ruta crítica**, **Consumo de tela**, Imprimir, Modificar. Varios **navegan de verdad** (Modelo/O.C./RC/Consumo).
- **Doble clic en una fila → abre "Avance de producción"** (ver 4.3). También hay botón "Registrar avance".
- **Combobox de proveedores con búsqueda por teclado** (ver 4.4).

### 4.3 Avance de producción ("Proceso") — desde la OP ⭐ ✅
Se abre con **doble clic** en una orden. Reemplaza el form "Proceso" del Access (tabs Corte / Entrega maquila / Recibo maquila / Entrega aplicación / Recibo aplicación).
- **Stepper de 5 etapas** con su avance (`1,726/1,726`) y color de estado.
- **RECOMENDACIÓN DE DISEÑO (importante):** el reto que planteó Daniel es que una misma OP puede ir a **varios proveedores** (varios maquileros, o parte a **estampado** y parte a **bordado**). Solución: **cada etapa es una LISTA de movimientos**; **cada movimiento lleva su proveedor + fecha + su desglose color×talla**. Así:
  - Se manda a **2 maquileros** = 2 movimientos de entrega.
  - Parte a **estampado** y parte a **bordado** = 2 movimientos de aplicación (con campo **Tipo: Estampado/Bordado**).
  - Los **recibos parciales** por proveedor cuadran solos (recibido = suma de movimientos).
- **Captura por talla×color con CANDADO**: la matriz de captura usa **los colores y tallas de la orden**, no se puede meter otro color. El total se suma solo.
- **Auto–Ruta Crítica**: al registrar una etapa se marca **automáticamente en RC** (no hay que volver a entrar a RC a decir "ya se cortó"). En el real esto es el auto-avance por eventos F3→F5 que ya existe.
- **Resumen abajo** en dos bloques: **Costura** (Ordenada/Cortada/Entregada/Recibida + por cortar/entregar/recibir) y **Estampado-Bordado** (Entregada/Recibida/Falta por recibir).

### 4.4 Comentarios de Daniel ya incorporados (feedback de la sesión) ⭐
Estos son **requisitos**, no opcionales:
1. **Proveedores homónimos** (Óscar Jiménez, Óscar Hernández, Óscar López): el selector de proveedor es un **combobox con búsqueda por teclado** (escribes "óscar" → los tres; "her" → solo Hernández; ignora acentos/mayúsculas). Permite texto libre (proveedor nuevo); **decisión pendiente**: ¿forzar que solo se elija de la lista? (preguntado a Daniel, sin cerrar).
2. **Detalle de la OP**: encabezado + botones **fijos arriba** (sticky) y **matriz color×talla visible sin scroll** (es la info más relevante).
3. **Precios editables con permiso + auditoría**: el modelo trae un **precio de referencia** (estimado, heredado del modelo al crearse); en la OP se captura el **precio real negociado**. Solo ciertos usuarios pueden editar (permiso RBAC). Se guarda **quién lo capturó, cuándo y con qué proveedor se negoció**. El precio se marca "real" (verde) vs "referencia" (gris). Aplica a **precio de maquila y de estampado/aplicación**.
4. **Auditoría en TODO**: **cada registro** (movimiento de avance, edición de precio) guarda y muestra **"capturado por [usuario] · fecha"**. En el real sale de la sesión (better-auth) + RBAC.

### 4.5 Otras pantallas prototipadas (más simples, para ver el patrón)
Resumen (KPIs + órdenes por vencer + cortes/semana + bandeja RC), Modelos (tabla + cajón con ficha/BOM/matriz), Producción/WIP, Ruta Crítica → **"Mis pendientes"** (rediseñada a fondo, ver §4.9), Inventario PT (existencias por almacén), Telas y avíos (tono por tipo), Compras/MRP (banner de faltantes + avance de recepción), Proveedores (catálogo + saldo CxP + cajón), Costos y EDR (costeo desglosado + margen), Indicadores (barras/dona/productividad), Calidad AQL (auditorías con resultado), Usuarios (RBAC).

Además: **todos los botones de "alta"** abren un **formulario funcional** que agrega la fila a su tabla (con folios autogenerados, fechas "hoy", selects poblados desde los datos, validación) — para que Daniel sienta la app "casi 100% funcional".

### 4.6 Notas de salida — envío de AVÍOS a maquileros (diseñada 6-jul-2026) ✅
Remisión de materiales al maquilero, **ligada al inventario de avíos**. Calca el modelo real de F4/R4 (`NotaSalida` + `NotaSalidaLinea` en `schema.prisma`; dominio `backend/src/dominio/notas/notas-salida.ts`), que **ya soporta** lo que pidió Daniel:
- **Una nota → varios renglones → cada renglón lleva SU orden** (`NotaSalidaLinea.idOrden`, por línea): una nota puede llevar avíos de **una o varias órdenes**. Consultar "qué notas mandé de la OP X" es directo (cada línea cita su orden). Desde el detalle de la OP, el botón **"Notas salida"** filtra la lista a esa orden (chip removible).
- **Avío por renglón** tomado del catálogo/inventario; al **confirmar** se descuenta el kardex de avíos (`salida-por-nota`, bajo advisory lock); estados **borrador → confirmada → cancelada** (cancelar = movimiento inverso auditado, D3). "Capturado por" en cada nota (A7).
- **Constructor multi-renglón** (panel deslizante estilo `proc`): maquilero (combobox typeahead — homónimos), empresa, almacén origen, fechas; renglones con avío + orden + cantidad + **existencia disponible** (avisa en rojo si excede). Totales vivos (# órdenes · # renglones). Lista con chips de "órdenes surtidas"; cajón de detalle **agrupado por orden**.
- **Ligado a la receta de la orden (decisión Daniel, 6-jul):** el modelo ya sabe qué avíos lleva la orden (BOM `ModeloAvio` / explosión MRP). El constructor **PROPONE, NO LIMITA**: botón **"Traer avíos de la orden"** carga los avíos de la receta con cantidad sugerida (piezas × consumo por pieza), y cada renglón marca **✓ "en la receta de la orden"** / **⚠ "fuera de la receta — se enviará igual"**. Se puede enviar un avío que la orden no define (ej. un cierre a una orden sin cierre) **sin bloqueo** — solo avisa.
- **Habilitación / surtido por orden (pedido Daniel, 6-jul):** panel deslizante "Habilitación de avíos — Orden N" que muestra, por orden, sus avíos de la receta con **Requerido vs. Enviado vs. Falta** (con barra de avance y estado Completo/Parcial/Pendiente), un **% de surtido** global, y los avíos enviados **fuera de receta** (marcados "Extra"). `Enviado` = Σ de las **notas confirmadas** de esa orden×avío; `Requerido` = receta × piezas. Se abre desde el botón **"Habilitación"** del detalle de la OP (Órdenes) y desde el banner de filtro de la lista de notas. **Surtido selectivo + re-envío (decisión Daniel, 6-jul — "no surtir todo a fuerza"):** cada renglón trae un **check** y un input **"A surtir"** (default = la falta; 0 en los completos). El usuario decide **qué avíos** y **cuánto** mandar (uno, varios, o todos con el check del encabezado; escribir una cantidad auto-marca el renglón), y **"Pasar a nota de salida (N)"** abre el constructor **pre-cargado solo con lo seleccionado** (cantidad = lo capturado en "A surtir", editable) y el maquilero de la orden. **Re-envío (pedido Daniel, 6-jul):** si un avío ya completo **se extravió o se dañó**, se puede **volver a mandar** (o parte) escribiendo la cantidad en "A surtir" aunque la falta sea 0; entonces `Enviado` **puede pasar del 100%** y el renglón queda como **"Sobre-surtido"** (con su % real, ej. 112%) — es un estado válido, no un error. **"Ver notas de esta orden"** → lista filtrada.

**Decisiones de Daniel (6-jul-2026), confirmadas:**
1. Una nota = **un maquilero**; todas sus órdenes de la **misma empresa** (folio por empresa, A9); **un solo almacén origen** por nota (decisión (g) de F4).
2. **Telas: NO van en esta nota.** Como la tela sale de **otro almacén** (almacén de telas), Daniel prefiere manejarla con **su propia nota de salida** relacionada al almacén de telas → estas notas quedan **solo-avíos**. *(El modelo real sí permite renglones de tela que referencian una salida-a-orden ya registrada sin re-descontar, decisión (e); se optó por separarlas por almacén. La nota de telas queda pendiente de diseñar — ver §7.)*

### 4.7 Pre-costeo (Desarrollo) — proyectos → modelos → costeo (diseñada 6-jul-2026) ✅
Primera pantalla de la fase F8. Spec de Daniel:
- **Proyecto** identificado por número (`P-1042`), apunta a **UN cliente + UN departamento** (cada cliente tiene sus **propios** departamentos: C&A → KIDS Moda / Baby / Hombre…). Se pueden tener **varios proyectos abiertos** a la vez. Lista con KPIs + tabla (proyecto, cliente, depto, temporada, # modelos, avance, estatus). "Nuevo proyecto" = modal con cliente→departamento **dependiente**.
- **Modelo por modelo** dentro del proyecto (grid de tarjetas con **estatus** Borrador/En proceso/Completo/Aprobado, costo, precio sugerido, chips de PDF/fotos y % de avance). Se construye poco a poco.
- **Editor de modelo** (panel deslizante): números **nuestro + del cliente**, **telas** (un modelo puede llevar **varias** — D5, ej. felpa + acompañante) cada una con su **consumo por prenda**, **maquilero cotizado** + **corte** y **maquila (costura)** (dos costos fijos por prenda, **separados** — petición Daniel, 6-jul), **procesos** (estampado/bordado/lavado/otros — lista N), **avíos** + consumo, con **costeo en vivo** (tela + avíos + procesos + **corte** + maquila = **costo**). El modelo captura **COSTO, no precio**.
- **El MARGEN NO va en el modelo (corrección Daniel, 6-jul):** el margen (y el precio) se definen en la **lista de precios**, que sólo maneja Daniel con sus factores del cliente — **de ninguna manera en el llenado del modelo**. Se quitó del editor el campo "Margen objetivo (%)" y todo "precio sugerido/de referencia": el precosteo muestra **sólo el costo**. La tarjeta y el pie del editor ya no muestran precio, sólo costo + "el precio se define en la lista".
- **Maquilero cotizado en el modelo (petición Daniel, 6-jul):** en el precosteo se define **con qué maquilero (costura) se coteó** la maquila (selector con el catálogo de maquileros, incluye homónimos Óscar J./H./L.). Sirve para que el **programa de maquileros** (fase posterior) lo tome **por default** como maquilero asignado — **cambiable después**. Se ve también en la tarjeta del modelo. En el real: campo del modelo/precosto que siembra el default del programa de producción (F3/F5).
- **Corte como costo fijo (petición Daniel, 6-jul):** el **corte** es un costo por prenda **aparte de la maquila (costura)** — antes faltaba en el precosteo. Va en la sección "Corte y maquila" y aparece como su propio renglón en el "Costo del modelo" (Tela · Avíos · Procesos · **Corte** · Maquila). Ya existe como columna en el módulo de **Costos** del sistema, así que es una línea de costo consistente. También se puede editar en la **negociación** (§4.8). En el real: campo de costo del modelo/precosto (F8), separado de la maquila.
  - **El corte NO lleva proveedor (decisión Daniel, 6-jul):** su costo **se estima aquí** y no tiene caso amarrarle un maquilero — el **maquilero cotizado aplica sólo a la maquila (costura)**. El corte queda como un simple monto estimado, sin selector de proveedor.
- **Dificultad DERIVADA del # de operaciones + tabla configurable (idea Daniel, 6-jul):** la dificultad **NO se teclea a mano** — sería subjetiva. En el desarrollo del modelo se captura el **# de operaciones de costura** de la prenda (un **dato real/objetivo**), y de ahí el sistema **deriva la dificultad** consultando una **tabla configurable de rangos de operaciones** — **NO una escala fija 1-6**: Daniel define **cuántos niveles, sus rangos, nombres y el tiempo de costura** de cada uno (ejemplo en el proto: 1-8 *Muy sencillo* 6 d · 9-14 *Sencillo* 8 d · 15-22 *Medio* 11 d · 23-32 *Complejo* 15 d · 33+ *Muy complejo* 20 d). El editor lo muestra **en vivo**: ej. **34 ops → Muy complejo → costura ≈ 20 d**. La Ruta Crítica toma esto del modelo; impacta **sobre todo la costura**. La tabla vive en la pantalla **"Procesos y responsables"** (card "Tabla de dificultad por # de operaciones", con Agregar/Editar rango). Ver §4.9. En el real: `# operaciones` en el modelo/precosto → tabla de dificultad → duración de la costura en el CPM.
- **Avíos con varios proveedores (viable — YA en el backend: `AvioProveedor` con precio por proveedor + `ModeloAvio.idAvioProveedor` NULLABLE, R17):** un avío puede ser surtido por **varios proveedores, cada uno con su precio**; en el precosteo el avío puede quedar **sin proveedor** (selector "— sin definir (más barato) —" → costea al más barato / `Avio.precioReferencia`) y el **proveedor real se amarra en la compra** (MRP/OC). La pantalla **Avíos** lista los proveedores/precios por avío (expandible; ej. "Etiqueta de lavado" sin proveedor todavía). Aplica también en la calculadora de negociación.
- **Telas también con varios proveedores (`TelaProveedor`, espejo de `AvioProveedor`, R17):** mismo patrón que avíos — selector de proveedor por tela en el precosteo/negociación, "— sin definir (más barato) —" o un proveedor asumido; el proveedor **y el precio** se pueden cambiar en la compra.
- **Precio de tela por COLOR (petición Daniel, 6-jul; backend `TelaColor.precio` / `TelaProveedorColor` + flag `manejaPrecioPorColor`, R17):** ciertas telas cuestan distinto según el color. En el precosteo cada tela con variación de color tiene un **selector de color**; si aún **no se define el color** (típico en negociación), el default usa el **color MÁS CARO** — regla conservadora de Daniel para proteger el margen. Se puede elegir un color específico (usa su precio). Las telas de precio plano muestran "— precio único —". Cascada real (F8-E1): color-amarrado → amarre proveedor → referencia por color → sugerido.
- **Dos conceptos distintos de "genérico" (aclaración Daniel, 6-jul):** (a) el `esGenerico` del backend = ítem que se compra **para stock** y se **netea en el MRP** (badge "Genérico · stock" vs "Por orden" en Avíos) — un eje de planeación; (b) lo que Daniel llama "genérico" coloquial = un avío/tela **sin proveedor pinneado en el precosteo** — que es simplemente el selector en "sin definir". Son ejes independientes. **Decisión Daniel (6-jul): pre-elegir el proveedor.** En el precosteo el selector **arranca con el proveedor asumido pre-seleccionado (el más barato)** para tener un costo concreto y una lista sólida; se puede cambiar a otro proveedor o a "sin definir", y sobre todo la **compra puede cambiar proveedor y precio** (el modelo lo soporta: `ModeloAvio.idAvioProveedor` NULLABLE + la OC captura el real). "Sin definir" queda como excepción.
- **Administrar el vínculo avío↔proveedor (petición Daniel, 6-jul) — por los DOS lados:** desde el **avío** (Avíos → expandir → "Agregar proveedor" con su precio / quitar) y desde el **proveedor** (Proveedores → ficha → "Avíos que surte" → "Asignar avío que surte" con su precio / quitar). El segundo resuelve el caso "un proveedor me ofrece un avío que **ya tengo dado de alta**". Ambos crean/borran el registro `AvioProveedor` (precio por proveedor).
- **Avíos "por medida" — UN registro con las medidas agrupadas dentro (petición Daniel, 6-jul):** ciertos avíos (típico: **cierres**) se **costean con un solo precio y un solo registro**, pero al **comprar** se piden **por medida y por talla, con precio distinto por medida**. Decisión de Daniel: **NO** tener cada medida como un avío independiente en el catálogo/inventario; las **medidas van agrupadas DENTRO del avío padre** (ej. "Cierre #5 metálico" contiene 15 cm $5.80 / 18 cm $6.20 / 22 cm $6.80). En el **precosteo/negociación** el avío entra como **un solo renglón** con **precio = promedio simple de las medidas** (protege el costo sin desglosar; `precioAvioPC` devuelve el promedio, R18 / decisión g). En la **compra e inventario** se **desglosa por medida×talla** con su precio real. En la pantalla **Avíos**: badge **"Por medida"** en el nombre y, al expandir, una sección **"Medidas del avío"** que lista cada medida con su precio y el **Promedio (precosteo)** — arriba de la lista de proveedores. Backend: `ModeloAvio.consumoPorTalla` (R18) + `ModeloAvioTalla` para el consumo/medida por talla.
- **Un solo catálogo de materiales (confirmación Daniel, 6-jul):** todos los **avíos y telas** del precosteo salen del **mismo catálogo de materiales de los proveedores** con el que se hacen las órdenes de compra y se llevan los inventarios (F4). No hay catálogos paralelos. *(En el prototipo, por ser mock, cada pantalla usa su propio arreglo de ejemplo — `AVIOS_PC` / `AVIOS_INV` / `MAT` / `PROV` / `TELAS_PC` — que no comparten datos vivos; es una limitación **solo del prototipo**. En el real es un único catálogo, como pidió Daniel.)*
- **Tech Pack / PDFs**: subir archivos de referencia (input file real — muestra el nombre); **Fotos** ligadas al modelo (telas, avíos, muestras) con thumbnails reales (FileReader → dataURL en el proto; R2 en el real). Estatus por modelo.
- Mapea a F8 (módulo 15, D13/R16–R20). En el real: telas con precio por proveedor y color (R16), medidas por talla en ciertos avíos, PDFs/fotos en R2, y liga posterior a lista de precios → orden. **SIN ETL** (arranca en cero).

### 4.8 Lista de precios + Negociación (diseñada 6-jul-2026) ✅ — calza con el backend F8 YA construido
> **Hallazgo (6-jul):** el backend de F8 **ya existe** (`schema.prisma`: `ClienteFactores`, `Proyecto`, `Desarrollo`, `Precosto` versionado, `ListaPrecios`, `ListaPreciosLinea`, `NegociacionEvento`, `EstadoLista`; dominio `backend/src/dominio/desarrollo/`). Por eso el front NO tiene que esperar: se diseñó **1:1 con lo construido**.

Flujo completo (propuesta de Daniel, 6-jul): **desarrollo trabaja el proyecto → avisa a Daniel → Daniel genera la lista → revisa/ajusta variables → aprueba precios → comercial la manda autorizada → sesión de negociación**.
- **Factores del cliente** (`ClienteFactores`): **margen · descuentos · regalías · costo de ventas**, default por cliente con **override por departamento**. Se ven en la pantalla **Clientes**.
- **Lista de precios** (`ListaPrecios`): se **genera desde un proyecto** (botón en Pre-costeos) por Cliente+Departamento. Copia los factores como **SNAPSHOT editable** — **solo el dueño** los edita (RBAC `listas.aprobar`, en el proto `PUEDE_PRECIOS`). **Fórmula en cascada (D2):** `precio = costo ÷ (1−margen) ÷ (1−(descuentos+regalías+costoVentas))`, **redondeado al alza**; recalcula al mover factores.
- **Aprobación modelo por modelo** (`ListaPreciosLinea.precioAprobado`+`aprobadoPor`): el sistema propone el precio calculado; Daniel lo aprueba o teclea otro, línea por línea. Con todo aprobado → **"Autorizar y pasar a negociación"**.
- **Estados** (`EstadoLista`, catálogo global): **abierta → en-negociación → cerrada → ya-pedida** (las dos últimas `esCierre` = bloquean ediciones).
- **Revisión de costos antes de la lista (petición Daniel, 6-jul):** cada renglón de la lista es **expandible** y muestra el **desglose de costo** del modelo (tela con consumo×precio, cada avío, procesos, maquila = costo total) — Daniel revisa que "le haga sentido" antes de aprobar/autorizar.
- **Sesión de negociación = calculadora en vivo (petición Daniel, 6-jul):** por renglón, un panel donde **se editan TODOS los elementos en vivo** (tela+consumo, **corte**, maquila, procesos, avíos — quitar/agregar) para mover el costo; se captura un **precio objetivo**; y se ve en tiempo real el **costo**, el **precio neto** (objetivo − descuentos/regalías/costo ventas) y el **% de margen bruto** = (neto − costo) ÷ neto, **coloreado** contra el margen objetivo del cliente — para decidir en la mesa. **Guardar versión** persiste una **nueva versión del modelo** (`Precosto` versionado) + un **`NegociacionEvento`** con el acuerdo (texto inmutable), precio anterior→nuevo y costo anterior→nuevo; el historial es una **línea de tiempo** con `vN`. Ejemplo del proto: "se quitan bolsas traseras → $224 → $205".
- **La lista NO dispara pedidos** (el pedido nace de la OC del cliente, F2).

### 4.9 Ruta Crítica — "Mis pendientes" (rediseñada 6-jul-2026) ✅ — calza con el backend F5 (el módulo ⭐)
> **Hallazgo:** el backend de F5 (Ruta Crítica) **ya está construido completo** (`docs/modulos/ruta-critica.md`): motor de workflow/CPM configurable (procesos como datos + DAG + roles N:M + checklists), plantillas + reglas de duración + calendario, **CPM backward-pass**, bandeja, badge, y **auto-avance por eventos** de F3/F4. El front se diseñó **1:1 con eso**.

Spec de Daniel (6-jul): *"cada orden debe tener los tiempos definidos de cada proceso; al ingresar la OP se genera una **ruta hacia atrás** con las fechas y el **responsable** de cada proceso; cada persona ve sus **pendientes del día** — funciona como su guía de trabajo."*

- **Ruta hacia atrás por orden (CPM):** al crear la OP se genera su ruta — cada **proceso** (Compra de tela · Corte · Envío a maquila · Maquila · Recibo · Estampado/Bordado · Auditoría de calidad · Entrega) con su **fecha compromiso** (calculada hacia atrás desde la fecha de entrega) y su **responsable**. Se ve en el **panel deslizante "Ruta de la orden"** (línea de tiempo con semáforo por proceso: Hecho/Vencido/Hoy/Programado; resalta los pasos de la persona con badge "tú"). Se abre al hacer clic en cualquier pendiente.
- **"Mis pendientes" = guía diaria por persona (pantalla nueva, la que pidió Daniel):** reemplaza el tablero global anterior. Deriva de las rutas **filtrando por responsable** los procesos NO terminados y los agrupa por urgencia: **⚠ Vencidas** (rojo, atrasadas contra su fecha), **Para hoy** (ámbar, el foco del día), **Próximas · esta semana** (verde, con "+N programadas más adelante"). KPIs: Vencidas · Para hoy · Esta semana · Total a tu cargo. Cada renglón: proceso + orden·modelo·cliente·entrega + badge de fecha/holgura + botón **"Hecho"** (marca el avance y promueve el siguiente proceso a "hoy" — en el real es el auto-avance por eventos F3/F4 que ya existe) + clic → abre la ruta de la orden.
  - **Agrupar por proceso (petición Daniel, 7-jul):** toggle **"Agrupar por: Urgencia / Proceso"**. En *Proceso*, los pendientes se agrupan por **tipo de proceso** (todos los Corte juntos, todos los Envío a maquila juntos…, con su conteo de vencidos/hoy) para **enfocarse en un proceso a la vez** y resolverlos en tanda, en vez de tener todo revuelto. En *Urgencia* (default) se mantienen las secciones Vencidas / Para hoy / Próximas.
- **Una persona = varios procesos (requisito Daniel):** el responsable puede tener procesos de **distinto tipo y de distintas órdenes** (ej. Laura de Producción: Corte + Envío + Maquila + Recibo de varias OP). El **selector "Viendo pendientes de:"** permite (a un admin/supervisor) revisar la lista de cualquiera; un usuario normal ve sólo la suya.
- **Catálogo de procesos configurable (petición Daniel, 6-jul):** pantalla nueva **"Procesos y responsables"** (bajo **Sistema** — es configuración de baja frecuencia, decisión Daniel 6-jul; Ruta Crítica en Operación queda como acceso directo a "Mis pendientes") — el catálogo de los procesos de la RC: **#secuencia · proceso · área · responsable por default · ¿cómo se completa? · acciones** (Nuevo proceso / Editar / Asignar responsable). "La **mayoría** de las prendas llevan estos procesos; por **orden/prenda** se pueden **agregar o quitar**; el **responsable siempre es asignable**." Es distinto del viejo "Tipos de proceso" (F3: costura M / aplicación A, `TipoProceso`) — este es el `ProcesoDef` de F5. En el real: `ProcesoDef` + `ProcesoDefRol` (roles N:M — puede haber más de un responsable) + antecesor (DAG del CPM) + duración.
  - **La lista concreta de procesos se define MÁS ADELANTE (decisión Daniel, 6-jul):** los procesos del prototipo son un **default de ejemplo**; Daniel definirá la lista real cuando toque, y **evolucionará con la operación** (agregar/quitar). El diseño NO depende de que quede final — lo único que importa es que el catálogo permita agregar/quitar/reasignar, que ya está.
  - **Tiempo por operación + variables (Excel real de Daniel `Procesos_RC.xlsx`, 6-jul):** cada proceso tiene un **tiempo** (días) que **alimenta el cálculo de la ruta hacia atrás (CPM)**. Ese tiempo puede: (a) **variar por la dificultad de la prenda** — que **NO se teclea a mano** ni es una escala fija 1-6: se **DERIVA del # de operaciones** de la prenda (capturado en el desarrollo del modelo, §4.7) contra una **tabla configurable de rangos** (rango de operaciones → nombre + tiempo de costura, que Daniel define; card en esta misma pantalla); impacta **sobre todo el tiempo de costura/maquila** (ej. **6→20 d** según el rango); o (b) **depender de un catálogo**, ej. **Recepción de tela según la velocidad con que llega la tela** (Local 5 d · Nacional 12 d · Importada 30 d) — **es la velocidad de recepción, NO el material** (aclaración Daniel, 6-jul; su catálogo real llega después). Además hay procesos **condicionales** que **solo aplican si la prenda los lleva** (Estampado/Bordado, su envío/recepción y su auditoría; Autorización de arte). La pantalla lo muestra con **columna Tiempo** + **renglón expandible** (los 6 tiempos por dificultad / la dependencia de catálogo / las reglas). El Excel real trae 26 procesos + matriz tiempo×dificultad; el prototipo tomó ~21 como muestra. En el real: `ProcesoDef.duración por dificultad` + reglas condicionales + duración dependiente de catálogo (tipo de tela) → todo alimenta el **CPM backward-pass** ya construido.
- **Auto-completado por evento del sistema (aclaración Daniel, 6-jul):** la **mayoría** de los procesos se marcan **solos** al registrar su acción en el sistema — Corte → al registrar el corte en **Avance de producción**; Envío → al enviar a maquila; **Maquila (costura) y Recibo → al registrar el recibo de maquila** (decisión Daniel, 6-jul: la costura se marca al recibir); Compra de tela → **recepción de material** (Compras); Calidad → **auditoría AQL**; Entrega → **entrega a cliente**. Los **manuales** son muy pocos (en el ejemplo: Programación y Aceptación de cliente — no tienen una acción de sistema que los dispare). **"Ficha de desarrollo" se eliminó** (decisión Daniel, 6-jul): ya no hace falta porque toda su información viene del **desarrollo del modelo (pre-costeo)**. Se distingue en 3 lados: el catálogo (columna "¿Cómo se completa?" con Automático+evento / Manual), "Mis pendientes" (tag **⟳ auto** vs **✋ manual**, y botón **"Registrar"** vs **"Marcar hecho"**) y la ruta de la orden (renglón "⟳ Automático — al registrar: …" / "✋ Manual — …"). En el real es el **auto-avance por eventos** (F3/F4/F6 → F5) que **ya está construido** (consumidor del outbox).
- **Datos:** `RUTAS` (orden → `proc[]` con `{proceso, responsable, fecha, estado, díasHolgura}`) + `PROCESOS_CAT` (catálogo: proceso, área, responsable, `auto`, evento) + `procCat()`; `misPendientes(persona)`. Responsables tomados del catálogo de usuarios (Producción/Compras/Calidad/Ventas/Desarrollo). En el real: `ProcesoDef` + `ProcesoDefRol` (roles N:M) + CPM backward-pass + `UsuarioRol` (F5, ya construido); "Mis pendientes" = la **bandeja** filtrada por los roles del usuario logueado (RBAC).
- **Antecesores / DAG del CPM + revisión de congruencia (Excel `Procesos_RC-antecesores.xlsx` + revisión, 6-jul):** cada proceso tiene sus **antecesores** (deben terminar antes de que arranque). Revisión de la tabla de Daniel: la **columna vertebral cuadra**, pero con **un solo antecesor por proceso no se puede expresar la convergencia** (un proceso que espera a VARIOS) → en la tabla original **13/26 procesos quedaban colgando**: los **avíos** (Surtido) y el **estampado** (Recepción de procesos) NO bloqueaban la confección, y la auditoría de estampado colgaba del *envío* en vez del *recibo*. **Corrección propuesta y aplicada en el proto:** **varios antecesores por proceso** + ramas reconectadas — ej. **Envío a maquila (confección) espera a Corte + Surtido de avíos** (y al estampado si aplica); Recepción de tela espera a OC de tela + Autorización de tono. Se ve en el catálogo, bloque **"Dependencias en la ruta (CPM): Espera a / Detona"**, donde **cada antecesor es EDITABLE** — chips con ✕ para quitar + "agregar antecesor" (decisión Daniel, 6-jul: *todo* debe ser modificable, los detonadores por proceso también); al editar, el "Detona →" de los demás se recalcula solo. En el real: dependencias `ProcesoDefDependencia` (DAG N:M) **editables** que el CPM recorre.
- **Estampado antes/después de coser — por modelo y flexible (decisión Daniel, 6-jul):** el modelo define la **secuencia de estampado/bordado** (campo nuevo en el editor de pre-costeo): **Antes (forzado)** = la confección SIEMPRE espera al estampado (dependencia fija); **Después**; **Flexible** = se decide en **producción según la carga de trabajo, incluso con el ciclo ya empezado**. Para las órdenes flexibles, la **ruta de la orden** (panel deslizante) trae un control **[Estampar ANTES] / [Estampar DESPUÉS]** que **reprograma la ruta en el momento**. En el real: la dependencia `Recepción de procesos → Envío a maquila` es **condicional** al `secEstampado` del modelo/orden; para las flexibles la orden guarda su elección y el CPM recalcula.

### 4.10 Análisis de Ruta Crítica — tablero de gestión (diseñada 6-jul-2026) ✅
De **capturar** a **analizar**. Pantalla nueva bajo **Análisis** (menú). Spec de Daniel: ver el estatus de las órdenes (a tiempo / riesgo / atraso), **calificar a los usuarios de la RC** como base para un **bono semanal** por cumplir en tiempo, y recomendar qué más analizar. Tres frentes + KPIs:
- **Salud de las órdenes (KPIs + triage):** *Órdenes activas · A tiempo · En riesgo · Atrasadas · % Cumplimiento*. Estado por orden = **atrasada** (algún proceso vencido) / **en riesgo** (proceso para hoy) / **a tiempo** (todo próximo). La tabla **"Órdenes que requieren atención"** lista atrasadas + en riesgo **ordenadas por urgencia (holgura)** con la **etapa atorada**, el **responsable**, el estado y la entrega; clic → abre la ruta de la orden.
- **Desempeño del equipo (scoring + bono):** por persona — área · procesos a cargo · **vencidos ahora** · **% en tiempo** · **reacción** (tiempo promedio en atender desde que el proceso cae en su cancha) · **tendencia** (vs semana pasada) · **calificación** (0-100 con badge Excelente/Bien/Regular/Bajo) · **Bono ✓**. **Calificación** = % en tiempo − penalización por vencidos; **Bono semanal** = calificación ≥ 90 **y** 0 vencidos (umbrales configurables). Botón **"Generar evaluación semanal"**. En el real, los datos salen del **kardex de procesos** de F5 (`capturadoPor`/`capturadoEn`, D11).
- **Cuellos de botella por proceso (recomendación de diseño):** qué **proceso** se atora más (vencidos + para hoy) — para atacar problemas **sistémicos** (ej. la tela llega tarde) y no solo culpar personas.
- **Analíticas adicionales — TODAS construidas (Daniel: "haz todas", 7-jul):** (1) **Entrega al cliente** (on-time delivery %) con tendencia de 4 semanas (sparkline) + **tiempo de ciclo** promedio (OP→entrega) con tendencia — el resultado que de verdad importa; (2) **Alertas predictivas** — órdenes que HOY se ven a tiempo pero cuyo **colchón proyectado** (días a la entrega − trabajo restante) es negativo → van a atrasarse (en el real = **CPM forward pass**); (3) **Riesgo por cliente** — a quién avisar/priorizar (activas · en riesgo · atrasadas con semáforo); (4) **Carga vs desempeño** — se marca **sobrecarga** a quien trae mucha carga, para que el bono sea justo (score bajo con carga alta ≠ descuido).
Mapea al backend F5 (**concentrado planeado-vs-real + export**, ya construido en F5-E7) + KPIs D11.

---

## 5. Cómo está hecho el prototipo (para modificarlo)

- **Un solo archivo** `prototipo.html`, autocontenido (HTML + CSS + JS inline, sin dependencias, sin CDN). Ábrelo en el navegador.
- **Tokens** en `:root` / `@media dark` / `[data-theme]` arriba del `<style>`. Recolorear ahí re-tematiza todo.
- **Datos de ejemplo** en arreglos JS al inicio de cada sección de vista (`OP`, `PEDIDOS_MES`, `MODELOS`, `MAT`, `PROV`, etc.). Están **en memoria** (al recargar vuelve al estado base).
- **Menú** en `const NAV = [...]` (grupos → items, con `hijos` para desplegables). Consumidores: `NAV_LEAVES`, `TITULOS`, `renderNav()`, `COMANDOS` (⌘K), `vPlaceholder`.
- Cada pantalla es una función `vXxx()` que devuelve HTML; el router mínimo es `ir(clave)` + `const VISTAS = {...}`. Módulos sin vista real caen en `vPlaceholder`.
- Interacciones destacadas: `wireOrdenes()` (doble clic → `abrirProceso`), `renderProceso()` (avance), `abrirPrecioOP`/`guardarPrecio` (precios+auditoría), `comboHTML`/`wireCombo` (typeahead), `wirePedidos()` (grupos expandibles).

---

## 6. Cómo llevarlo al código real (`frontend/`)

El front real: **React 19 + Vite + Tailwind v4 (CSS-first) + shadcn/ui (radix) + TanStack Query/Table**, menú **data-driven por permisos**. **La palanca:** casi toda la app pasa por 3 lugares — rediseñarlos re-viste la mayoría de las ~100 pantallas:

1. **Tokens** → `frontend/src/index.css` (bloque `@theme inline` + `:root`/`.dark`). Reemplazar la paleta **teal por el verde** de la §2. **Ojo:** hay clases Tailwind hardcodeadas fuera de tokens en `frontend/src/lib/tono.ts` y `frontend/src/components/dominio/visuales.tsx` (badges/avatares por tono) — hay que ajustarlas aparte.
2. **Shell** → `frontend/src/modulos/CascaronSistema.tsx` (riel + topbar), `NavegacionModulos.tsx` (nav; meterle los **desplegables** de la §3.1) y **`frontend/src/modulos/catalogo.ts`** (`MODULOS_MENU`, ~90 entradas gate por permiso — reestructurar a los grupos nuevos).
3. **Motor de pantallas** → `frontend/src/modulos/ListaDetalle.tsx` + `detalle.tsx` + `frontend/src/components/ui/*` (primitivos shadcn). Ajustar densidad/estilo aquí propaga a todos los catálogos.

Ruta sugerida (por fases, con el proceso normal coder+reviewer → PR a `prueba` → verificación de Gabriel en Railway):
- **Fase A — Núcleo:** tokens (verde) + shell (riel oscuro + desplegables + ⌘K) + primitivos `ui/` + densidad de `ListaDetalle`. Con esto la app entera cambia de piel.
- **Fase B — Órdenes (centro de comando):** la pantalla principal (§4.2) + avance de producción (§4.3) con multi-proveedor, matriz con candado, precios con permiso+auditoría, combobox. Es la de mayor valor.
- **Fase C — Pedidos por mes** (§4.1) y el resto de módulos, uno por uno, cerrando comentarios de Daniel.

**Reglas del proyecto que aplican (ver `CLAUDE.md` §7):** lógica solo en `backend/src/dominio`; NADA de commit/push sin autorización de Gabriel; documentar la etapa ANTES de comitear; verificación en Railway (no docker local). El **auditoría "capturado por"** y los **permisos de precio** ya existen en el backend (better-auth + RBAC + auditoría uniforme A7); el front solo los consume.

---

## 7. Pendientes / decisiones abiertas

- **Combobox de proveedores:** ¿permitir texto libre (proveedor nuevo) o **forzar selección de lista**? (preguntado, sin cerrar).
- **Avío por medida — proveedor vs. promedio (pulido menor, 6-jul):** en el editor de precosteo, el avío por medida (cierre) se costea con el **promedio de medidas** ($6.27) aunque el selector muestre un proveedor con su precio único ($6.20). Es **a propósito** (el precosteo del por-medida siempre usa el promedio, decisión de Daniel), pero el número del proveedor no coincide con el costeado y puede confundir. **Pulido posible:** que en avíos por medida el selector muestre "promedio de medidas" en vez de un precio de proveedor único. No urge; funcionalmente correcto.
- **Diseñadas a fondo** (6-jul): Pre-costeo (§4.7) y **Lista de precios + Negociación (§4.8)** — calzadas con el backend F8 ya construido.
- Pantallas con **base inicial** (prototipadas 6-jul, aún por afinar con Daniel): Avíos, Clientes (con factores), Ventas, CxC/CxP, EDR, Auditores, Catálogos base (colores/tallas/temporadas/tipos de proceso/almacenes). Son bases funcionales con datos de ejemplo; Daniel las irá revisando una por una.
- **Nota de salida de TELAS:** pendiente de diseñar. Sale del **almacén de telas** (otro almacén), así que va en su **propia nota** relacionada a ese almacén, separada de la de avíos (decisión Daniel, 6-jul). Puede reusar la "salida de tela a orden" que ya existe en Inventario (F4) como documento de respaldo.
- Confirmar si se conserva **Inter** o se adopta el stack de sistema en el real.
- La pantalla vieja de Órdenes tenía además: Composición/Composición forzada, Precio de venta editable, "Maquila real", EXP/Copiar, RC (Clave/Tipo tela/Programar/Concentrado). Evaluar cuáles entran.

---

## 8. Enlace al prototipo vivo

**Artifact publicado de Daniel (donde le pica él mismo):** `https://claude.ai/code/artifact/fe60f4cb-cf13-424a-81df-65b1891df45a` (privado del usuario; solo se lee/actualiza con su sesión de claude.ai — desde un entorno remoto sin login da HTTP 403).

La copia **fiel y versionada** (fuente de verdad del diseño) vive en el repo: [`docs/rediseno/prototipo.html`](./prototipo.html).

> **⚠️ FLUJO OBLIGATORIO al tocar el prototipo (regla Daniel, 6-jul):** cada cambio se hace en `docs/rediseno/prototipo.html` (repo) **Y** se **redespliega al artifact** con el mismo URL de arriba, para que Daniel vea la versión al día en su link. Editar el repo sin redesplegar deja el artifact atrasado (pasó el 6-jul con los cambios de "cierres por medida" y "corte"). El repo va a git; el artifact es la vista viva de Daniel — **los dos deben quedar sincronizados en el mismo paso.**
