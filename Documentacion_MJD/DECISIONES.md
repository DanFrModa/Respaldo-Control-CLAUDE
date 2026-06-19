# Decisiones y mejoras del dueño

> Bitácora de decisiones de negocio y mejoras pedidas por Daniel para el **sistema nuevo**.
> Se llena conforme revisamos cada módulo. La documentación de cada módulo describe el sistema *actual*; aquí van los *cambios deseados*.

| # | Módulo | Decisión / mejora | Estado |
|---|--------|-------------------|--------|
| D0 | General | **Rediseñar con libertad.** CONTROL se hizo hace ~30 años con medios limitados; hay inconsistencias conocidas. Se autoriza proponer y aplicar mejoras de diseño en todo el sistema, dejándolas documentadas para el desarrollo nuevo. | ✅ Registrada |
| D1 | 06 — Costos y EDR | El costeo debe usar el **costo ACTUAL**, no el viejo/congelado (`CostoViejo`). No replicar la lógica de `CostoBueno`. | ✅ Registrada |
| D2 | 06 — Costos y EDR | El módulo **no está en uso** por detalles pendientes; se **rediseñará** con mejoras del dueño (pendientes de definir). | 🕓 Por detallar |
| D3 | 04 — Inventarios | La existencia NO debe editarse a mano ni por eventos de foco; debe ser **el resultado de sumar los movimientos** (kardex transaccional). | ✅ Registrada |
| D4 | 03 — Producción / 04 — Inventarios | **Tallas ilimitadas** (eliminar el límite de 8). **TODA etapa del WIP se registra por color × talla**: corte, envío y recibo de costura, envío y recibo de estampado, y entrega al cliente. El **inventario de PT** también por **modelo × color × talla × almacén**. | ✅ Registrada |
| D5 | 04 — Inventarios (Telas) | Una tela/lote puede traer **N telas acompañantes** (cuerpo + cardigan + otras), **del mismo lote y color** (eliminar el límite de 2). El inventario de telas debe ligar acompañantes por **lote/color**. | ✅ Registrada |
| D6 | 05 — Indicadores / General | **Proscai ya no se usa.** El inventario cíclico (`CantProscai`) debe comparar contra el **propio inventario de CONTROL v2**, no contra un sistema externo. Eliminar dependencia de Proscai. | ✅ Registrada |
| D7 | 03 — Producción / Clientes | **Campos de referencia/búsqueda configurables por cliente.** El campo `Monarch` (hoy usado para el No. de pedido del cliente) se generaliza: cada cliente define sus propios campos (No. pedido, estilo, CEDIS, etc.), todos **buscables**, para localizar órdenes con la nomenclatura del cliente. | ✅ Registrada |
| D8 | General / Navegación | **Redefinir la estructura de módulos y submódulos en el desarrollo.** La organización actual del menú no es definitiva (p. ej. hoy EsMa, RC y CC son submódulos de Producción). En particular, **la ubicación de Control de Calidad (CC) queda por definir** (¿módulo aparte, parte de Maquileros/Recepción, o proceso de la RC?). La numeración de los documentos es solo organizativa, **no** propone la estructura final. | ✅ Registrada |
| D9 | 01 — Modelos (Promoda) | **Excluir el módulo Promoda** del sistema nuevo. Era para el cliente *Promoda*, con procesos muy específicos que **ya no se usan**. Se retira del mapa y no se documenta a detalle. | ✅ Registrada |
| D10 | 08 — Ruta Crítica | Rediseñar la RC como **motor de workflow/procesos configurable** (agregar/quitar/reordenar procesos sin código; dependencias como grafo; responsables; reglas de duración y aplicabilidad como datos). Es el módulo **más importante** y hoy no está en uso. | ✅ Registrada |
| D11 | 08 — RC / KPIs | **La mayoría de los KPIs del sistema se derivan de la Ruta Crítica.** Diseñar el modelo de RC pensado para explotación analítica (tableros: entregas a tiempo, lead time por proceso, cuellos de botella, desempeño por responsable). | ✅ Registrada |
| D12 | 14 — Finanzas (NUEVO) | **Finanzas en CONTROL sin contabilidad.** La contabilidad y las declaraciones siguen con el contador; CONTROL incorpora **CxC + CxP** como una **cuenta corriente única de terceros** que generaliza EsMa (saldo = Σ movimientos, nunca editable, D3), con **marca fiscal** por movimiento y **dos vistas** (operativa / fiscal para el contador). CFDI por **importación** del XML ya timbrado (proveedores→CxP; ventas→CxC); **timbrado vía PAC = fase posterior** (R14). Catálogo de proveedores enriquecido (R15) en F1. Requisitos R10–R15; módulo 14; fase F8 (Finanzas). Meta: apagar SINUBE por etapas. | ✅ Registrada |

> El catálogo completo de mejoras propuestas (no solo decisiones) está en **[MEJORAS.md](MEJORAS.md)**.

---

## Detalle

### D1 — Costo actual en lugar de costo congelado
- **Hoy:** la función `CostoBueno(Costo, CostoViejo)` prioriza `CostoViejo` (costo al momento de la venta).
- **Decisión:** valuar siempre con el **costo vigente** (`Costo`).
- **Fecha:** 2026-06-09.

### D2 — Rediseño del módulo de Costos/EDR
- El dueño aportará la lista de detalles a corregir antes de reconstruirlo.
- **Pendiente:** que Daniel enumere los "varios detalles" del módulo.

### D4 — Tallas ilimitadas + inventario de PT por talla y color
- **Hoy:** columnas fijas `T1..T8` (orden) y `TC1..TC8` (corte/entrega/recibo). El IPT guarda existencia solo por **modelo × almacén** (pierde talla y color).
- **Objetivo:** tallas variables/ilimitadas e inventario de PT a nivel **modelo × color × talla × almacén**.
- **Modelo de datos propuesto (normalizado):**
  ```
  Talla            ( IdTalla, Etiqueta, Orden )           -- catálogo: "2","4","CH","M","28"...
  CurvaTalla       ( IdCurva, Nombre )                    -- opcional: agrupa tallas por tipo/cliente
  CurvaTallaItem   ( IdCurva, IdTalla )
  Modelo           ( ..., IdCurva )                       -- el modelo usa una curva

  OrdenLinea       ( IdOrdenLinea, IdOrden, IdColor )     -- una línea por color  (reemplaza el "ancho" T1..T8)
  OrdenLineaTalla  ( IdOrdenLinea, IdTalla, Cantidad )    -- N renglones, uno por talla

  -- TODAS las etapas del WIP usan el mismo patrón (línea con color + cantidad por talla):
  --   Corte, EnvíoCostura, ReciboCostura, EnvíoEstampado, ReciboEstampado, EntregaCliente
  -- p. ej.:
  EtapaMovimiento     ( IdEtapaMov, IdOrden, Tipo, Fecha, IdMaquilero/IdEstampador )  -- Tipo: corte|envio_costura|recibo_costura|envio_estampado|recibo_estampado|entrega_cliente
  EtapaMovimientoDet  ( IdEtapaMov, IdColor, IdTalla, Cantidad )                       -- siempre color × talla

  ExistenciaPT     ( IdModelo, IdColor, IdTalla, IdAlmacen, Existencia )   -- saldo = suma de movimientos (ver D3)
  MovimientoPTDet  ( IdMovimiento, IdModelo, IdColor, IdTalla, Cantidad )
  ```
- **Nota:** el flujo actual YA captura cantidades por talla y color en `OrdenesDet`; al normalizar, esa granularidad llega hasta el inventario sin esfuerzo extra.

### D5 — Telas acompañantes del mismo lote (cuerpo + cardigan + N)
- **Contexto:** el **cardigan** (tejido para cuellos/puños) llega **del mismo lote y color** que la tela principal; por eso deben registrarse juntos para garantizar que los colores casen. A veces son más de una tela acompañante.
- **Hoy:** dos telas fijas (`ExTela1/ExTela2`, `…1/…2`).
- **Objetivo:** N telas acompañantes por lote, ligadas por **lote/color**.
- **Modelo de datos propuesto:**
  ```
  Tela             ( IdTela, Nombre, Tipo, UnidadMedida )    -- Tipo: cuerpo / cardigan / otro
  Lote             ( IdLote, Proveedor, Factura, Fecha, IdColor )   -- el lote define el color/teñido
  LoteComponente   ( IdLote, IdTela, Cantidad, Peso )        -- N telas que llegan en ese lote (mismo color)

  ExistenciaTela   ( IdTela, IdLote, IdAlmacen, Existencia ) -- saldo por tela y lote (ver D3)
  MovimientoTelaDet( IdMovimiento, IdTela, IdLote, Cantidad )
  ```
- **Beneficio:** trazabilidad por **lote** (clave para que cuerpo y cardigan casen en color) y sin límite de telas acompañantes.

### D7 — Campos de referencia configurables por cliente (generaliza "Monarch")
- **Hoy:** el campo `Ordenes.Monarch` (lleno en el 99% de las órdenes) se usa para guardar **el No. de pedido del cliente** y así **buscar las órdenes de producción con la referencia del cliente**. Originalmente el campo era para otra cosa.
- **Objetivo:** cada cliente puede definir **sus propios campos** de referencia/búsqueda (No. pedido, estilo, CEDIS, código de barras del cliente, etc.). Todos buscables.
- **Modelo de datos propuesto:**
  ```
  Cliente          ( IdCliente, Cliente, ... )
  ClienteCampo     ( IdClienteCampo, IdCliente, Etiqueta, Tipo, Orden, Activo )  -- qué campos tiene cada cliente
  OrdenReferencia  ( IdOrden, IdClienteCampo, Valor )                            -- valor por orden (indexado/buscable)
  ```
  - Al capturar/consultar una orden de un cliente, la UI muestra **solo los campos de ese cliente**.
  - Búsqueda global de órdenes por **cualquier** valor de referencia del cliente.
  - `Monarch` migra como **un** `ClienteCampo` ("No. de pedido del cliente").
- **Nota:** podría aplicar también a nivel **Pedido** además de **Orden**, según se defina.

> ⚠️ Los modelos de datos anteriores son **propuestas de partida** para discutir y refinar con Daniel, no la versión final.

### D12 — Finanzas (CxC/CxP + CFDI) en CONTROL, sin contabilidad
- **Contexto:** hoy Daniel emite y timbra sus facturas **fuera** de CONTROL (en **SINUBE**), donde además lleva cuentas de clientes y proveedores. Quiere que CONTROL **amarre cada documento fiscal con su operación real** (pedido, OC, recibo de maquila) y, por etapas, **apagar SINUBE**. La contabilidad y las declaraciones **no** son su área: **siguen con su contador**.
- **Alcance dentro de CONTROL:** CxC (cuentas por cobrar) + CxP (cuentas por pagar) como **cuenta corriente única de terceros** — el principio de EsMa generalizado: `saldo = Σ(cargos) − Σ(abonos/pagos)`, **nunca editable** (consistente con D3). Cada movimiento lleva dos ejes: **origen** (recibo de maquila · factura de proveedor · entrada sin factura · nota de crédito · pago · abono) y **naturaleza fiscal** (fiscal con CFDI+IVA / no fiscal). De un solo libro por tercero salen **dos vistas**: operativa (todo lo que se debe, facture o no) y fiscal (solo movimientos con CFDI, para el contador). Las **notas de crédito** son un tipo de movimiento más. La **maquila sigue en EsMa**; al maquilero que factura se le **concilia el XML** sobre el movimiento del recibo y queda marcado fiscal (entra al reporte del contador sin salir de EsMa).
- **CFDI por importación primero (no emisión):** las facturas se siguen emitiendo por fuera y CONTROL **jala el XML ya sellado** — del proveedor (→ CxP, costos, inventario) y de las ventas propias (→ CxC, ligado al pedido/cliente). El **timbrado nativo vía un PAC** queda como **fase posterior** (R14): cuando se aborde, pasar de "importar XML" a "emitir + timbrar" es un salto chico porque la estructura ya está armada.
- **Fuera de alcance (con el contador / a futuro):** contabilidad electrónica (pólizas, balanza, DIOT, declaraciones); tesorería y conciliación bancaria completa; elección de PAC y costos de timbrado.
- **Encaje en el plan:** módulo nuevo **14 (Finanzas)**; **fase F8 (Finanzas)** entre F7 y Go-live (que pasa a **F9**); **catálogo de proveedores enriquecido (R15) en F1** (etapa F1-E1B); requisitos derivados **R10–R15**. Detalle e insumo original: [PROPUESTA-Finanzas-y-Proveedores.md](PROPUESTA-Finanzas-y-Proveedores.md).
- **Fecha:** 2026-06-13.
- **Rectificación 2026-06-14 — UN solo catálogo de terceros (cierra R15 §4):** en v2 **NO** hay catálogos separados de `Maquilero` ni `Cortador`. Un tercero se da de alta **UNA sola vez como Proveedor** y marca sus servicios con **casillas de roles** (`RolProveedor`: maquila/costura, corte, estampado, bordado, lavado, aplicación, vende telas/avíos, otros). Esto evita duplicar terceros (un mismo taller puede maquilar **y** cortar) y unifica la base de las CxP/EsMa de F8. Los atributos propios del maquilero (`corto`, `asegurado`, `obsPago`) se portaron a `Proveedor` (nullable). El **`precioReferencia` del cortador queda en DESUSO**: el **costo del corte se definirá en la orden de producción** (pendiente **F2/F3**). `TipoProceso` se conserva como catálogo aparte para la Ruta Crítica (F5). Implementado en la rama `tarea/fusion-terceros` (migración `fusion_terceros`).

### Decisiones de diseño F3-E1 (motor kardex / Producción) — 2026-06-17

Tomadas al congelar el esquema único de F3 (una sola migración). Detalle técnico en
[`docs/arquitectura/ADR-0010-motor-kardex-produccion.md`](../docs/arquitectura/ADR-0010-motor-kardex-produccion.md)
y en la ficha `docs/hoja-de-ruta/F3-etapas.md` §F3-E1.

#### (d) — Liga recibo↔envío: AGREGADO por orden+proceso, con liga opcional (reversible)
- **Contexto:** la doc no fija que cada recibo de maquila corresponda a un envío puntual; en el viejo el WIP se cuadra por **agregado**: enviado/recibido por orden y proceso (1,309 envíos viejos ni siquiera traen precio).
- **Decisión:** v2 cuadra el WIP por **orden + tipo de proceso** (por recibir = Σ enviado − Σ recibido). NO se exige amarrar cada recibo a un envío específico. El esquema deja un campo de liga **OPCIONAL** (`EtapaMovimiento.idEtapaEnvio`, nullable, autorreferencia): hoy queda NULL y nada depende de él.
- **Reversible sin migración destructiva:** si más adelante Daniel pide amarre **estricto** por envío, se empieza a poblar `idEtapaEnvio` (es DATO) y se endurece la validación en el dominio — sin alterar el esquema ni migrar filas. Queda documentada como decisión reversible (pendiente confirmar con Daniel; si no decide, este default queda).
- **Fecha:** 2026-06-17.

#### (e) — `generaEntradaPt`: qué proceso deja prenda terminada (solo costura = sí)
- **Contexto:** el recibo de maquila debe meter a inventario PT SOLO cuando el proceso deja **prenda terminada**. Evidencia del viejo: `Recibos.Inventariado` existe **solo** en costura; `RecibosEst` (estampado) **no** trae esa columna; `IPT_Movs` tiene **2,468** entradas tipo 2 'Entrada de Maquila' contra **3** del tipo 3 'Entrada de Aplicación'. El estampado pre-costura serían paneles sin coser en PT, y post-costura sería **doble conteo**.
- **Decisión:** `TipoProceso` lleva una bandera **`generaEntradaPt`** (dato, no código). **SOLO costura = `true`**; estampado/aplicación, bordado y lavado = `false`. El recibo (F3-E4) consulta la bandera para decidir si crea la entrada al kardex PT. El va-y-ven del estampado por inventario se maneja con los tipos de movimiento 6 'Salida a Aplicación' / 3 'Entrada de Aplicación' (F3-E3), no con el recibo.
- **Nace en F3-E1** con este default; el `default` de columna es `false` (lo seguro: un proceso nuevo no mete a PT salvo que se marque), y el seed pone `true` solo en costura. **Cambiar el valor luego es DATO** (UI de admin, editable solo por admin), NO migración. Confirmar con Daniel a más tardar antes de F3-E4.
- **Fecha:** 2026-06-17.

### Decisiones de diseño F3-E2 (corte + envío a maquila) — 2026-06-18

Tolerancias de las validaciones de corte/envío. La doc funcional NO fija la regla (el Access viejo no validaba). Decisión de Gabriel (con criterio de negocio de Daniel), 2026-06-18. Detalle en la ficha `docs/hoja-de-ruta/F3-etapas.md` §F3-E2.

#### (f) — Sobre-corte: LIBRE (solo avisa, nunca bloquea)
- **Contexto:** en textil casi siempre se corta de más por mermas/segundas/reposiciones; el corte fija el "techo físico" de las piezas, no la orden.
- **Decisión:** `registrarCorte` **NO bloquea** por cortar más que lo pedido en la orden (por color×talla). Se permite cortar cualquier cantidad ≥ 0; la pantalla **avisa** cuánto excede lo pedido (informativo), pero el servidor lo acepta. Las validaciones de sanidad sí aplican: cantidades enteras ≥ 0 y color/talla deben pertenecer al modelo/curva de la orden.
- **Implementación:** la holgura de sobre-corte se modela como **parámetro configurable** (default: sin tope = ilimitado). Cambiarla luego es config, no migración.
- **Fecha:** 2026-06-18.

#### (g) — Sobre-envío: ESTRICTO (`enviado ≤ cortado` por proceso) — y la misma regla para recibo en E4
- **Contexto:** no se pueden enviar a maquila piezas que no se cortaron. El cortado es el techo del envío.
- **Decisión:** `registrarEnvioMaquila` **bloquea** server-side si lo enviado excede el **cortado disponible** para ese color×talla y proceso (= cortado − ya enviado a ese mismo proceso, agregado por orden+proceso, decisión (d)). Validación por **suma directa de `EtapaMovimientoDet`** dentro de la transacción (nunca acumuladores ni la vista). Tope configurable con **default 0%** (estricto).
- **Extensión confirmada por Gabriel para F3-E4 (recibo):** `recibido ≤ enviado` con el mismo criterio estricto (no se puede recibir más de lo que se entregó a maquila). Se registra aquí para que no se pierda; se aplica en E4.
- **Fecha:** 2026-06-18.
