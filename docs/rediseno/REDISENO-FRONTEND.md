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
  Ruta Crítica ▾    Mis pendientes
  Calidad ▾         Auditorías · Auditores
INVENTARIOS
  Inventario PT · Telas · Avíos · Compras / MRP
COMERCIAL
  Clientes ▾        Catálogo · Listas de precios · Ventas
  Proveedores       (acceso directo a su catálogo)
FINANZAS
  Cuentas por cobrar · Cuentas por pagar    (+ CFDI a futuro)
ANÁLISIS
  Costos · EDR · Indicadores
SISTEMA
  Catálogos base ▾  Colores · Tallas · Temporadas · Tipos de proceso · Almacenes
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
Resumen (KPIs + órdenes por vencer + cortes/semana + bandeja RC), Modelos (tabla + cajón con ficha/BOM/matriz), Producción/WIP, Ruta Crítica (ruta viva con semáforo por etapa + holgura CPM), Inventario PT (existencias por almacén), Telas y avíos (tono por tipo), Compras/MRP (banner de faltantes + avance de recepción), Proveedores (catálogo + saldo CxP + cajón), Costos y EDR (costeo desglosado + margen), Indicadores (barras/dona/productividad), Calidad AQL (auditorías con resultado), Usuarios (RBAC).

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
- **Editor de modelo** (panel deslizante): números **nuestro + del cliente**, **telas** (un modelo puede llevar **varias** — D5, ej. felpa + acompañante) cada una con su **consumo por prenda**, **maquila**, **procesos** (estampado/bordado/lavado/otros — lista N), **avíos** + consumo, con **costeo en vivo** (tela + avíos + procesos + maquila = costo; **precio sugerido** por margen). 
- **Avíos con varios proveedores (viable — YA en el backend: `AvioProveedor` con precio por proveedor + `ModeloAvio.idAvioProveedor` NULLABLE, R17):** un avío puede ser surtido por **varios proveedores, cada uno con su precio**; en el precosteo el avío puede quedar **sin proveedor** (selector "— sin definir (más barato) —" → costea al más barato / `Avio.precioReferencia`) y el **proveedor real se amarra en la compra** (MRP/OC). La pantalla **Avíos** lista los proveedores/precios por avío (expandible; ej. "Etiqueta de lavado" sin proveedor todavía). Aplica también en la calculadora de negociación.
- **Telas también con varios proveedores (`TelaProveedor`, espejo de `AvioProveedor`, R17):** mismo patrón que avíos — selector de proveedor por tela en el precosteo/negociación, "— sin definir (más barato) —" o un proveedor asumido; el proveedor **y el precio** se pueden cambiar en la compra.
- **Dos conceptos distintos de "genérico" (aclaración Daniel, 6-jul):** (a) el `esGenerico` del backend = ítem que se compra **para stock** y se **netea en el MRP** (badge "Genérico · stock" vs "Por orden" en Avíos) — un eje de planeación; (b) lo que Daniel llama "genérico" coloquial = un avío/tela **sin proveedor pinneado en el precosteo** — que es simplemente el selector en "sin definir". Son ejes independientes. **Recomendación (decisión pendiente de Daniel):** en el precosteo conviene **pinnear un proveedor asumido** (costo concreto, lista sólida), sabiendo que la **compra puede cambiar proveedor y precio** (el modelo lo soporta: `ModeloAvio.idAvioProveedor` NULLABLE + la OC captura el real); "sin definir" queda como excepción.
- **Administrar el vínculo avío↔proveedor (petición Daniel, 6-jul) — por los DOS lados:** desde el **avío** (Avíos → expandir → "Agregar proveedor" con su precio / quitar) y desde el **proveedor** (Proveedores → ficha → "Avíos que surte" → "Asignar avío que surte" con su precio / quitar). El segundo resuelve el caso "un proveedor me ofrece un avío que **ya tengo dado de alta**". Ambos crean/borran el registro `AvioProveedor` (precio por proveedor).
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
- **Sesión de negociación = calculadora en vivo (petición Daniel, 6-jul):** por renglón, un panel donde **se editan TODOS los elementos en vivo** (tela+consumo, maquila, procesos, avíos — quitar/agregar) para mover el costo; se captura un **precio objetivo**; y se ve en tiempo real el **costo**, el **precio neto** (objetivo − descuentos/regalías/costo ventas) y el **% de margen bruto** = (neto − costo) ÷ neto, **coloreado** contra el margen objetivo del cliente — para decidir en la mesa. **Guardar versión** persiste una **nueva versión del modelo** (`Precosto` versionado) + un **`NegociacionEvento`** con el acuerdo (texto inmutable), precio anterior→nuevo y costo anterior→nuevo; el historial es una **línea de tiempo** con `vN`. Ejemplo del proto: "se quitan bolsas traseras → $224 → $205".
- **La lista NO dispara pedidos** (el pedido nace de la OC del cliente, F2).

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
- **Diseñadas a fondo** (6-jul): Pre-costeo (§4.7) y **Lista de precios + Negociación (§4.8)** — calzadas con el backend F8 ya construido.
- Pantallas con **base inicial** (prototipadas 6-jul, aún por afinar con Daniel): Avíos, Clientes (con factores), Ventas, CxC/CxP, EDR, Auditores, Catálogos base (colores/tallas/temporadas/tipos de proceso/almacenes). Son bases funcionales con datos de ejemplo; Daniel las irá revisando una por una.
- **Nota de salida de TELAS:** pendiente de diseñar. Sale del **almacén de telas** (otro almacén), así que va en su **propia nota** relacionada a ese almacén, separada de la de avíos (decisión Daniel, 6-jul). Puede reusar la "salida de tela a orden" que ya existe en Inventario (F4) como documento de respaldo.
- Confirmar si se conserva **Inter** o se adopta el stack de sistema en el real.
- La pantalla vieja de Órdenes tenía además: Composición/Composición forzada, Precio de venta editable, "Maquila real", EXP/Copiar, RC (Clave/Tipo tela/Programar/Concentrado). Evaluar cuáles entran.

---

## 8. Enlace al prototipo vivo

Durante la sesión el prototipo se publicó como artifact (privado del usuario). La copia **fiel y versionada** vive aquí: [`docs/rediseno/prototipo.html`](./prototipo.html). Es la fuente de verdad del diseño para quien retome.
