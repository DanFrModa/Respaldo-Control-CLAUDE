# Requisitos nuevos para CONTROL v2

> Funcionalidades **que el sistema actual nunca tuvo** y que el dueño quiere incluir en el desarrollo del sistema nuevo.
> A diferencia de [MEJORAS.md](MEJORAS.md) (que mejora lo que ya existe), aquí van **cosas que faltan por completo**.

| # | Tema | Descripción corta | Prioridad | Estado |
|---|------|-------------------|-----------|--------|
| R1 | Catálogo de avíos por proveedor | Catálogo de insumos organizado por proveedor para pedir | 🔴 | ✅ Registrado |
| R2 | BOM de avíos en el modelo | Desarrollo define todos los avíos de la prenda desde catálogo | 🔴 | ✅ Registrado |
| R3 | Explosión de materiales (MRP) | Calcular qué comprar (avíos **y telas**) a partir de modelo × cantidades; **por orden** | 🔴 | ✅ Registrado |
| R4 | Inventario de avíos (multi-almacén) | Kardex de avíos: entradas, existencias y consumo; sin mínimos | 🔴 | ✅ Registrado |
| R5 | Fichas técnicas por orden | Ficha técnica (estructurada) ligada a la orden de producción | 🟡 | ✅ Registrado |
| R6 | Repositorio de documentos por orden | Adjuntar archivos de apoyo (imágenes, PDF, etc.) a la orden | 🟡 | ✅ Registrado |
| R7 | Seguimiento de recepción de materiales | Estatus automático recibido/pendiente por orden; auto-alimenta la RC | 🔴 | ✅ Registrado |
| R8 | Importar pedidos de clientes (**Etapa 2**) | Bajar pedidos del cliente y generar órdenes de producción automáticamente | 🟢 Etapa 2 | ✅ Registrado |
| R9 | Formatos de documentos impresos | Definir/rediseñar todos los impresos (órdenes, notas, OC, recibos…) | 🟡 | ✅ Registrado |
| R10 | Cuenta corriente unificada de terceros | Generaliza EsMa: saldo = Σ movimientos; ejes **origen** + **fiscal**; dos vistas (operativa/fiscal); incluye notas de crédito; maquila sigue en EsMa con XML conciliado | 🟡 | ✅ Registrado |
| R11 | Importar CFDI de proveedores (XML→CxP) | Leer/validar el XML sellado del proveedor, ligarlo a OC/entrada y conciliar el cargo en CxP (marca fiscal) | 🟡 | ✅ Registrado |
| R12 | Importar CFDI de ventas (XML→CxC) | Jalar el XML ya timbrado (emitido por fuera), ligarlo al pedido/cliente y generar el cargo en CxC | 🟡 | ✅ Registrado |
| R13 | Información detallada para el contador | Reportes/exportación de clientes, proveedores y sus movimientos **fiscales** | 🟡 | ✅ Registrado |
| R14 | Timbrado nativo vía PAC (**futuro**) | Emitir + timbrar desde CONTROL; R10–R12 ya dejan la estructura lista | 🟢 Futuro | ✅ Registrado |
| R15 | Catálogo de proveedores enriquecido | Catálogo único con **roles multi-valor** + campos fiscales/contacto/pago/operativos; va en **F1** | 🟡 | ✅ Registrado |
| R16 | Proyectos de desarrollo (Cliente + Departamento) | Proyectos temáticos por cliente/departamento que agrupan **desarrollos** (modelo con nº del cliente y el nuestro); departamentos de cliente como catálogo | 🔴 | ✅ Registrado |
| R17 | Precio de insumo amarrado (proveedor + producto + precio) | Por insumo del BOM: proveedor sugerido + producto + precio, editable al comprar; **telas con precio por proveedor** y, en ciertos proveedores, **por color** | 🔴 | ✅ Registrado |
| R18 | Medidas por talla en ciertos avíos | Cierres, elástico…: medida por talla guardada; el precosteo usa promedio, la compra usa las medidas exactas | 🔴 | ✅ Registrado |
| R19 | Conceptos de costo extensibles | Tela+avíos+maquila siempre; + estampado/bordado/otros procesos/otros conceptos, como datos (sin límite) | 🟡 | ✅ Registrado |
| R20 | Listas de precios por cliente + negociación por versiones | Lista por **Cliente+Departamento** desde los precostos con factores del cliente; aprobación del dueño modelo por modelo; **re-costeo por versiones** con acuerdos; estados configurables; historial aunque no cierre | 🔴 | ✅ Registrado |

---

## 🧵 La cadena de avíos (MRP) — visión integral

Los 4 requisitos forman **una sola cadena de valor** del avío, de punta a punta:

```mermaid
flowchart LR
    CAT[R1. Catálogo de avíos<br/>por proveedor] --> BOM[R2. BOM de avíos<br/>en el modelo]
    BOM --> EXP[R3. Explosión de materiales<br/>modelo × cantidades]
    EXP --> OC[Órdenes de compra<br/>(ya existe)]
    OC --> INV[R4. Inventario de avíos]
    INV --> NOTA[Notas de salida<br/>(consumo a maquila)]
    NOTA --> INV
```

> Hoy existe a medias: el modelo ya tiene una "receta" de habilitación (`ModelosHab` → `Habilitacion`), las órdenes de compra existen, y las notas de salida documentan (en texto libre) lo que se manda. **Lo que falta es: catálogo por proveedor sólido, BOM completo y explotable, la explosión automática, y el inventario de avíos.**

---

## R1 — Catálogo de avíos por proveedor

- **Qué resuelve:** poder pedir insumos a partir de catálogos que ya tengamos, sabiendo qué ofrece cada proveedor.
- **Quién lo usa:** Compras y Desarrollo.
- **Cómo funciona (propuesta):**
  - Catálogo de avíos enriquecido (mejora sobre `Habilitacion`): clave, descripción, unidad, **proveedor(es)**, precio por proveedor, presentación (rollo, pieza, etc.).
  - Un mismo avío puede tener **varios proveedores** con su precio/condición → elegir al comprar.
- **Relación:** base de R2, R3 y R4.

## R2 — BOM de avíos en el modelo (lista de materiales)

- **Qué resuelve:** que **Desarrollo** capture, al hacer el modelo, **todos los avíos** que lleva la prenda, tomándolos del catálogo (R1).
- **Quién lo usa:** Desarrollo / Ingeniería del Producto.
- **Cómo funciona (propuesta):**
  - Extiende la receta actual (`ModelosHab`): por cada avío, **cantidad/consumo por prenda** y unidad.
  - Considerar consumo por **talla/color** cuando aplique (liga con D4).
- **Relación:** alimenta la explosión (R3).

## R3 — Explosión de materiales (MRP) — avíos **y telas**

- **Qué resuelve:** que **Compras no calcule a mano**: a partir del modelo (su BOM, R2) y las **cantidades** (de la orden/pedido), el sistema **explota** automáticamente todos los materiales a comprar.
- **Aplica a avíos Y telas:** mismo proceso para habilitación (`ModelosHab`) y tela (`ModelosTela`). ✅ confirmado.
- **Quién lo usa:** Compras (y Planeación).
- **Cómo funciona (propuesta):**
  - `Material a pedir = Σ (consumo del material en el modelo × cantidad a producir)`, por proveedor.
  - **Compra por orden (Make-to-Order):** normalmente se compra **lo justo para cada orden de producción**, no para stock (ver principio abajo). La explosión por tanto es **por orden/pedido**.
  - Generar las **órdenes de compra** (módulo que ya existe) directo desde la explosión.
- **Relación:** consume R2 + cantidades de producción; produce órdenes de compra; alimenta R4.

## R4 — Inventario de avíos (multi-almacén)

- **Qué resuelve:** hoy **no hay** inventario de avíos; no se sabe qué hay ni cuánto se consume.
- **Quién lo usa:** Almacén, Compras, Producción.
- **Cómo funciona (propuesta):**
  - Kardex igual que telas/PT (existencia = suma de movimientos, ver D3): **entradas** por compra recibida, **salidas** por consumo.
  - **Multi-almacén:** existencia por avío **y almacén**. ✅ confirmado.
  - **Consumo ligado a las Notas de salida**: lo que se manda al maquilero descuenta del inventario de avíos → por eso las notas deben **estructurarse** (no texto libre; ver MEJORAS módulo 03).
  - **Sin mínimos/máximos ni reorden automático** (no se compra para stock; ver principio abajo). Salvo unos pocos genéricos que sí se tienen en existencia.
- **Relación:** recibe de compras (R3), entrega vía notas de salida.

## R7 — Seguimiento de recepción de materiales (estatus por orden)

- **Qué resuelve:** hoy el seguimiento de qué avíos ya se recibieron y cuáles faltan se lleva **a mano en un drive compartido**. Se quiere **automatizar**.
- **Quién lo usa:** Compras, Producción, Planeación.
- **La idea (del dueño):** si cada avío comprado tiene definido **su tipo / identidad** (desde el catálogo R1) y sabemos qué requiere la orden (explosión R3), el sistema puede dar **automáticamente el estatus de cada material requerido**.
- **Cómo funciona (propuesta):**
  - Por cada orden de producción, el sistema conoce los **materiales requeridos** (explosión R3).
  - Al **recibir** una compra (`OrdCompra` → recepción → entrada a inventario R4), el sistema **cruza** lo recibido contra lo requerido.
  - Estatus por material y por orden: **Requerido → En orden de compra → Recibido (parcial/total) → Pendiente**.
  - Tablero por orden: "qué tengo / qué me falta" — reemplaza el drive manual.
- **🔗 Integración con la Ruta Crítica (¡sí se puede automatizar!):**
  - Los procesos de la RC tipo *"comprar tela"*, *"recibir tela"*, *"recibir avíos"* pueden **marcarse como cumplidos automáticamente** cuando la recepción se registra → la `FechaReal` del proceso se llena sola.
  - Esto conecta directo con la visión de **RC como motor de KPIs** (D10/D11): el avance se actualiza sin captura manual.
- **Relación:** consume R3 (requerido) + OrdCompra (comprado) + R4 (recibido); alimenta la RC.

> 💡 **Insight clave (del dueño):** controlar los avíos desde el catálogo es lo que **habilita** todo esto. Una vez que el material está identificado, el estatus de recepción y el avance de la RC se vuelven **automáticos**.

---

## 📂 Gestión documental por orden de producción

### R5 — Fichas técnicas ligadas a la orden
- **Qué resuelve:** tener la **ficha técnica** de la prenda accesible desde la orden de producción.
- **Cómo funciona (propuesta):** ficha técnica **estructurada** (medidas, especificaciones de costura, tela, habilitación, dibujo/identidad) ligada a la orden y/o al modelo. Se relaciona con lo que hoy mide `IP_InfConf` (confiabilidad de fichas) en [05 — Indicadores](05-Indicadores.md).

### R6 — Repositorio de documentos / archivos de apoyo
- **Qué resuelve:** poder **adjuntar archivos** de cualquier tipo (imágenes, PDF, Excel, fotos de muestra, contramuestras, etc.) ligados a una orden de producción.
- **Cómo funciona (propuesta):** repositorio de adjuntos por orden (y quizá por modelo), con metadatos (tipo, fecha, quién subió). Almacenamiento configurable (no rutas fijas, ver MEJORAS A5).
- **Nota del dueño:** la **ficha técnica (R5)** y los **archivos generales (R6)** probablemente sean **cosas independientes** — una es estructurada, el otro es un repositorio libre.
- **Estado / cuándo (2026-07-04):** Daniel lo **re-priorizó** al arrancar F8 — quiere subir Excel/PDF de apoyo a las órdenes ahora que Desarrollo/Cotización arranca **sin ETL** (para no perder los archivos viejos). **Programación: F8-E6 — CONFIRMADO por Gabriel (2026-07-04)**; se construye junto con la vista 360 de la orden. Reutiliza el motor de archivos + Cloudflare R2 ya existente (el mismo de las fotos de modelos/bordados).

---

## R9 — Formatos de documentos impresos

- **Qué resuelve:** cada módulo de producción genera **documentos impresos** (órdenes, notas, recibos, etc.) que deben existir en el sistema nuevo con un formato bien definido.
- **Recomendación:** **inventariarlos ahora** (para no olvidar ninguno) y usar los actuales como **referencia**; el **diseño visual final** se hace durante el desarrollo, ya con el nuevo modelo de datos y la tecnología elegida.
- **Documentos impresos a definir (basado en los del sistema actual):**
  | Documento | Origen actual |
  |---|---|
  | **Orden de producción** (con detalle, tela, habilitación, bordado, corte) | `OrdImp`, `OrdImpDet`, `OrdImpTela`, `OrdImpHab`, `OrdImpBor`, `OrdImp_Cor` |
  | **Nota de salida** (a maquilero) | `NotasImp`, `NotaEntImp`, `NotasVer` |
  | **Orden de compra** (versión admin e interna) | `OrdCompraImp`, `OrdCompraImpAdm`, `OrdCompraImpInter`, `OrdCompraVer` |
  | **Recibo de maquila** (costura y estampado) | `ReciboMaquilaImp`, `ReciboMaquilaImpEst`, `ReciboEntMaquilaImp` |
  | **Recibo a maquileros / estado de cuenta** | `ReciboMaquileros` (reporte), `EsMaRecibos` |
  | **Ficha (estampado)** | `FichaEstImp` |
  | **Auditoría de calidad** | `FormatoAuditorias`, `FormatoAuditoriasDet` (reportes) |
  | **Lista de precios** | `ListaPrecios` (reporte) |
  | **Inventario de telas** | `InventariosTela` (reporte) |
- **Por definir con Daniel:** qué documentos conservar tal cual, cuáles rediseñar, y si hay nuevos (p. ej. impreso de la explosión de materiales R3, o del estatus de recepción R7).

---

## 💳 Finanzas: cuentas de terceros + CFDI (R10–R15)

> **Origen:** decisión **D12** (ver [DECISIONES.md](DECISIONES.md)). Detalle completo e insumo
> original en [PROPUESTA-Finanzas-y-Proveedores.md](PROPUESTA-Finanzas-y-Proveedores.md). La meta
> de fondo es **apagar SINUBE** por etapas, **sin tocar la contabilidad** (esa sigue con el
> contador). Encaje: módulo **14 (Finanzas)** + **fase F9 (Finanzas)** — originalmente F8;
> renumerada el 2026-07-04 al insertarse **F8 · Desarrollo y Cotización** (D13), y Go-live pasó
> a **F10** —; **R15 en F1** (etapa F1-E1B).

Hoy Daniel factura/timbra **fuera** de CONTROL (SINUBE) y ahí lleva cuentas de clientes y
proveedores. La meta: que CONTROL **amarre cada documento fiscal con su operación real**
(pedido, OC, recibo) y se vuelva el repositorio único. La contabilidad y las declaraciones
**no** entran (se quedan con el contador); CONTROL le entrega **información fiscal limpia**.

### R10 — Cuenta corriente unificada de terceros
Un solo motor que **generaliza el EsMa** de hoy: `saldo = Σ(cargos) − Σ(abonos/pagos)`, **nunca
editable** (consistente con D3). Sirve a **clientes (CxC)**, **proveedores (CxP)** y **maquila
(EsMa)** con la misma mecánica. Cada movimiento lleva dos ejes — **origen** (recibo de maquila ·
factura de proveedor · entrada sin factura · nota de crédito · pago · abono) y **naturaleza
fiscal** (fiscal con CFDI+IVA / no fiscal) — y de un solo libro por tercero salen **dos vistas**:
operativa (todo) y fiscal (solo CFDI). Las **notas de crédito** son un tipo de movimiento más.
La maquila **no sale de EsMa**: al maquilero que factura se le concilia el XML sobre el
movimiento del recibo.

### R11 / R12 — Importación de CFDI (no emisión, primera etapa)
CONTROL **jala el XML ya sellado**: del proveedor (→ alimenta **CxP**, costos e inventario) y de
las ventas propias (emitidas por fuera → alimenta **CxC**, ligado al pedido/cliente). El XML (y
el PDF) se guardan en **R2** y se concilian sobre el movimiento.

### R13 — Información para el contador
Reportes/exportación de clientes, proveedores y sus movimientos **fiscales** (la vista fiscal del
libro). CONTROL **no** lleva pólizas/balanza/DIOT ni declaraciones.

### R14 — Timbrado nativo vía PAC (futuro)
Emitir + timbrar desde CONTROL. **Fase posterior**: R10–R12 ya dejan la estructura armada, así
que pasar de "importar XML" a "emitir + timbrar" es un salto pequeño. Es lo regulado; se deja
para el final (apagar SINUBE por etapas: primero lo operativo sin riesgo regulatorio, luego lo
regulado).

### R15 — Catálogo de proveedores enriquecido
El catálogo viejo era muy pobre. Se enriquece **en paralelo a los campos por cliente (D7)**:
- **Identificación/clasificación:** nombre comercial, razón social, **roles/servicios multi-valor**
  (maquila, corte, estampado/aplicación, vende material/avíos, otros servicios — un mismo taller
  puede tener varios, sin duplicarlo), qué provee, activo/inactivo.
- **Fiscal:** flag **¿factura?** (define formal/informal), RFC, régimen fiscal (SAT), uso de CFDI
  habitual, código postal de expedición, retenciones aplicables (IVA/ISR a personas físicas).
- **Contacto:** persona/vendedor, teléfono/WhatsApp, **email** (para enviar la OC y recibir el
  XML), dirección.
- **Comercial/pago:** condiciones (contado o días de crédito), moneda (MXN/USD), forma y método
  de pago (PUE/PPD), **datos bancarios** (banco, CLABE), límite de crédito (opcional).
- **Operativo:** **lead time típico** (alimenta el MRP/Make-to-Order R3/R7), notas, **adjuntos en
  R2** (constancia de situación fiscal, contrato).

**Va en F1** (etapa **F1-E1B**): es el cimiento sobre el que luego se paran las CxP.

> **Lo que esta visión NO incluye:** contabilidad electrónica, tesorería/conciliación bancaria
> completa, y la elección/costos del PAC (se evalúan al abordar R14).

---

## 🧵 Desarrollo y cotización por cliente (R16–R20)

> **Origen:** decisión **D13** (ver [DECISIONES.md](DECISIONES.md)). Detalle completo e insumo
> original en [PROPUESTA-Desarrollo-Cotizacion-y-Listas-de-Precios.md](PROPUESTA-Desarrollo-Cotizacion-y-Listas-de-Precios.md).
> Encaje: módulo **15 (Desarrollo y Cotización)** + **fase F8** (nueva, entre F7 y Finanzas —que
> pasa a F9; Go-live a F10—). Las sub-decisiones ya las resolvió Daniel (2026-07-04, ver D13).

Hoy el sistema arranca en "modelo terminado" y "pedido": falta la **capa previa** donde se
desarrolla y cotiza para cada cliente. La negociación vive en Excel. Estos 5 requisitos la traen
al sistema, de punta a punta:

### R16 — Proyectos de desarrollo (Cliente + Departamento)
- **Qué resuelve:** un lugar donde concentrar los desarrollos de cada cliente/departamento.
- **Cómo funciona:** `Proyecto` = **1 cliente + 1 departamento** del cliente (catálogo nuevo de
  departamentos por cliente, ej. C&A / NIÑOS), con **nombre/tema** (joggers, Disney, básicos…);
  varios proyectos por departamento/temporada. Cada **desarrollo** del proyecto es un modelo con
  **dos números**: el del cliente y el nuestro. Si no llega a producción, **se apaga** (archivado).

### R17 — Precio de insumo amarrado: proveedor + producto + precio
- **Qué resuelve:** que el precosteo deje de usar precios genéricos y quede **amarrado a la
  realidad de compra** (y que Compras herede eso al generar la OC).
- **Cómo funciona:** por insumo del BOM se predefine **proveedor sugerido + producto de ese
  proveedor + precio** (del catálogo **o a mano** — ambos), editable al comprar. **Telas** (el
  hueco grande): precio **por proveedor** (hoy solo los avíos lo tienen, `AvioProveedor`) y, en
  **ciertos proveedores marcados, por color** (la misma tela cuesta distinto por color). El
  precosteo lee de ese catálogo; el MRP deja de sacar las telas "a captura manual".

### R18 — Medidas por talla en ciertos avíos
- **Qué resuelve:** comprar bien los avíos cuyo consumo depende de la talla (cierres, elástico,
  resortes…).
- **Cómo funciona:** el avío del BOM se marca "consumo por talla" y se capturan las **medidas por
  talla**; el **precosteo usa un promedio** (es estimación), pero la **explosión/OC usa la medida
  exacta × las cantidades por talla de la orden**. Las telas NO llevan talla (consumo por modelo
  completo) ni color.

### R19 — Conceptos de costo extensibles
- **Qué resuelve:** hoy el costo se arma de renglones fijos (tela/avíos/maquila/bordado); hay
  prendas con estampado, lavado u otros conceptos.
- **Cómo funciona:** catálogo `ConceptoCosto` como **datos** (patrón `TipoProceso`): tela, avíos
  y maquila **fijos** (siempre presentes); estampado, bordado, otros procesos y otros conceptos
  **ampliables sin código**. El precosteo/costeo suma N conceptos.

### R20 — Listas de precios por cliente + negociación por versiones
- **Qué resuelve:** la lista de precios de F7 es por **modelo** con parámetros por **empresa**;
  falta la lista **por cliente** con su negociación (hoy en Excel).
- **Cómo funciona:** la lista se genera desde los **precostos** aplicando los **factores del
  cliente** (margen objetivo, % descuentos, regalías, % costo de ventas) → el **dueño aprueba o
  modifica a mano, modelo por modelo** → la toma comercial. **Negociación = re-costeo por
  VERSIONES**: se cambia el desarrollo (ej. quitar bolsas), se re-costea y queda registrado el
  **acuerdo de diseño + precio acordado**, versión por versión. La lista vive **por
  Cliente + Departamento** con estados **configurables** (abierta / en negociación / cerrada /
  ya pedida…) y se **archiva aunque no cierre**. La lista **NO dispara pedidos**: el pedido nace
  de la **OC del cliente** (flujo actual); al ligar modelo→orden de producción, el registro
  completo queda pegado a la orden y alimenta **nuestra OC a proveedores**.

---

## 🧾 Calidad — flujo del auditor (R21, pendiente de diseño de Daniel)

### R21 — Formato del auditor: captura con fotos de hallazgos + reporte para el maquilero
- **Qué resuelve (Daniel, 2026-07-10 / D14):** los **usuarios auditores** necesitan un formato dentro del sistema para **capturar sus auditorías**, **registrar FOTOS de los hallazgos**, y **generar un reporte impreso para el maquilero** (dejarle una copia con los comentarios de la revisión).
- **Estado:** **el formato NO está diseñado aún** — NO se construye hasta que Daniel lo diseñe. Cuando lo haga, se decide también cómo se liga el auditor (el catálogo `Auditor` del rediseño vs. `Usuario.esAuditor`) a la captura de auditorías (F6).
- **Base existente:** auditorías AQL (F6), motor de archivos R2 (fotos), impresos @react-pdf (R9), catálogo de auditores (rediseño R9).

---

## 🗓️ Etapa 2 (futuro)

### R8 — Importar pedidos de clientes → generar órdenes automáticamente
- **Qué resuelve:** **bajar los pedidos** de los clientes y **generar automáticamente** las órdenes de producción, sin captura manual.
- **Quién lo usa:** Ventas / Planeación.
- **Cómo funciona (idea):** importar el pedido del cliente (archivo/portal/EDI) → mapear a modelos y cantidades → crear el pedido y sus órdenes.
- **Relación:** se apoya en los **campos de referencia por cliente (D7)** y en el modelo **Pedido / Pedido Real** ([02 — Pedidos](02-Pedidos.md)).
- **Estado (2026-07-08): ✅ CONSTRUIDO (versión Excel) en el rediseño (R8 del plan de rediseño, PR #107).** El importador vive en Pedidos → "Importar de cliente": plantilla de **mapeo de columnas por cliente** (se enseña UNA vez), parseo del **Excel** de la OC del cliente, amarre modelo-del-cliente ↔ desarrollo por `numeroCliente`, resolución manual de no reconocidos, y **alta transaccional** pedido + OPs + RC (reusa `salidaAProduccion`). La variante **PDF con extracción asistida por IA** sigue pendiente (idea original de Daniel del 2026-07-04) — queda como iteración futura del importador.

---

## 🔑 Principio de negocio: compra por orden (Make-to-Order)

> **Confirmado por el dueño:** normalmente **se compra todo en función de cada orden de producción**, NO para tener stock. La planeación de materiales es **por orden**, no por reabastecimiento de inventario.
>
> **Excepción:** unos pocos insumos **genéricos** (cajas, bolsas, etc.) sí se manejan en stock.

**Implicaciones para el diseño:**
- El MRP (R3) es **dirigido por la orden/pedido**, no por niveles de inventario.
- El inventario de avíos (R4) sirve sobre todo para **trazabilidad y consumo** (qué entró por cada compra y qué se mandó a maquila), no para gestión de stock con mínimos.
- Conviene marcar los pocos avíos **genéricos / de stock** como un caso especial (esos sí podrían tener existencia permanente).

---

## Detalle / pendientes por definir

- *(resueltos: explosión aplica a telas ✅, inventario multi-almacén ✅, sin mínimos/máximos ✅)*

*(Se irá llenando conforme Daniel comparta más necesidades.)*
