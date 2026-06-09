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

## 🗓️ Etapa 2 (futuro)

### R8 — Importar pedidos de clientes → generar órdenes automáticamente
- **Qué resuelve:** **bajar los pedidos** de los clientes y **generar automáticamente** las órdenes de producción, sin captura manual.
- **Quién lo usa:** Ventas / Planeación.
- **Cómo funciona (idea):** importar el pedido del cliente (archivo/portal/EDI) → mapear a modelos y cantidades → crear el pedido y sus órdenes.
- **Relación:** se apoya en los **campos de referencia por cliente (D7)** y en el modelo **Pedido / Pedido Real** ([02 — Pedidos](02-Pedidos.md)).
- **Nota:** **explícitamente Etapa 2** (no en el primer desarrollo).

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
