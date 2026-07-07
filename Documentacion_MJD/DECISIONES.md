# Decisiones y mejoras del dueño

> Bitácora de decisiones de negocio y mejoras pedidas por Daniel para el **sistema nuevo**.
> Se llena conforme revisamos cada módulo. La documentación de cada módulo describe el sistema *actual*; aquí van los *cambios deseados*.

| # | Módulo | Decisión / mejora | Estado |
|---|--------|-------------------|--------|
| D0 | General | **Rediseñar con libertad.** CONTROL se hizo hace ~30 años con medios limitados; hay inconsistencias conocidas. Se autoriza proponer y aplicar mejoras de diseño en todo el sistema, dejándolas documentadas para el desarrollo nuevo. | ✅ Registrada |
| D1 | 06 — Costos y EDR | El costeo debe usar el **costo ACTUAL**, no el viejo/congelado (`CostoViejo`). No replicar la lógica de `CostoBueno`. | ✅ Registrada |
| D2 | 06 — Costos y EDR | **Rediseño de Costos/EDR — resuelto con Daniel (2026-07-02).** Costo por prenda = tela (importe total ÷ prendas **cortadas**) + procesos (maquila/estampado/otros) + avíos (costura y empaque); **la regalía SALE del costo** (va sobre la venta). EDR **nuevo** derivado de la **facturación real** (modelo, precio, cantidad, cliente → totales por cliente); precio **ponderado** si un modelo se facturó a varios precios. Precio sugerido se redondea **al alza**. El histórico de EDR **no se migra** (se arranca con 2026). Detalle abajo. | ✅ Registrada |
| D3 | 04 — Inventarios | La existencia NO debe editarse a mano ni por eventos de foco; debe ser **el resultado de sumar los movimientos** (kardex transaccional). | ✅ Registrada |
| D4 | 03 — Producción / 04 — Inventarios | **Tallas ilimitadas** (eliminar el límite de 8). **TODA etapa del WIP se registra por color × talla**: corte, envío y recibo de costura, envío y recibo de estampado, y entrega al cliente. El **inventario de PT** también por **modelo × color × talla × almacén**. | ✅ Registrada |
| D5 | 04 — Inventarios (Telas) | Una tela/lote puede traer **N telas acompañantes** (cuerpo + cardigan + otras), **del mismo lote y color** (eliminar el límite de 2). El inventario de telas debe ligar acompañantes por **lote/color**. | ✅ Registrada |
| D6 | 05 — Indicadores / General | **Proscai ya no se usa.** El inventario cíclico (`CantProscai`) debe comparar contra el **propio inventario de CONTROL v2**, no contra un sistema externo. Eliminar dependencia de Proscai. | ✅ Registrada |
| D7 | 03 — Producción / Clientes | **Campos de referencia/búsqueda configurables por cliente.** El campo `Monarch` (hoy usado para el No. de pedido del cliente) se generaliza: cada cliente define sus propios campos (No. pedido, estilo, CEDIS, etc.), todos **buscables**, para localizar órdenes con la nomenclatura del cliente. | ✅ Registrada |
| D8 | General / Navegación | **Redefinir la estructura de módulos y submódulos en el desarrollo.** La organización actual del menú no es definitiva (p. ej. hoy EsMa, RC y CC son submódulos de Producción). En particular, **la ubicación de Control de Calidad (CC) queda por definir** (¿módulo aparte, parte de Maquileros/Recepción, o proceso de la RC?). La numeración de los documentos es solo organizativa, **no** propone la estructura final. | ✅ Registrada |
| D9 | 01 — Modelos (Promoda) | **Excluir el módulo Promoda** del sistema nuevo. Era para el cliente *Promoda*, con procesos muy específicos que **ya no se usan**. Se retira del mapa y no se documenta a detalle. | ✅ Registrada |
| D10 | 08 — Ruta Crítica | Rediseñar la RC como **motor de workflow/procesos configurable** (agregar/quitar/reordenar procesos sin código; dependencias como grafo; responsables; reglas de duración y aplicabilidad como datos). Es el módulo **más importante** y hoy no está en uso. | ✅ Registrada |
| D11 | 08 — RC / KPIs | **La mayoría de los KPIs del sistema se derivan de la Ruta Crítica.** Diseñar el modelo de RC pensado para explotación analítica (tableros: entregas a tiempo, lead time por proceso, cuellos de botella, desempeño por responsable). | ✅ Registrada |
| D12 | 14 — Finanzas (NUEVO) | **Finanzas en CONTROL sin contabilidad.** La contabilidad y las declaraciones siguen con el contador; CONTROL incorpora **CxC + CxP** como una **cuenta corriente única de terceros** que generaliza EsMa (saldo = Σ movimientos, nunca editable, D3), con **marca fiscal** por movimiento y **dos vistas** (operativa / fiscal para el contador). CFDI por **importación** del XML ya timbrado (proveedores→CxP; ventas→CxC); **timbrado vía PAC = fase posterior** (R14). Catálogo de proveedores enriquecido (R15) en F1. Requisitos R10–R15; módulo 14; fase F9 (Finanzas; originalmente F8, renumerada por D13). Meta: apagar SINUBE por etapas. | ✅ Registrada |
| D13 | 15 — Desarrollo y Cotización (NUEVO) | **Capa previa de desarrollo y cotización por cliente.** Proyectos de desarrollo por **Cliente + Departamento** (con nombre/tema; varios por departamento/temporada) que agrupan **desarrollos** (modelo con número del cliente y el nuestro). **Precosteo preciso**: por insumo se predefine **proveedor + producto + precio** (telas con precio **por proveedor** y, en ciertos proveedores, **por color**), **medidas por talla** en ciertos avíos (el precosteo usa promedio; la compra usa las medidas), **conceptos de costo abiertos** (mín. tela+avíos+maquila). **Lista de precios por Cliente+Departamento** generada con los factores del cliente (margen, descuentos, regalías, % costo de ventas); el **dueño aprueba o ajusta modelo por modelo**; **negociación = re-costeo por versiones** con acuerdos registrados; estados configurables; historial aunque no cierre. La lista NO dispara pedidos (eso lo hace la OC del cliente); al ligar el modelo a su orden de producción, el desarrollo alimenta **nuestra OC a proveedores** (telas predefinidas al MRP, avíos por medidas por talla). Requisitos R16–R20; módulo 15; **fase F8 nueva** (Finanzas pasa a F9, Go-live a F10). | ✅ Registrada |

> El catálogo completo de mejoras propuestas (no solo decisiones) está en **[MEJORAS.md](MEJORAS.md)**.

---

## Detalle

### D1 — Costo actual en lugar de costo congelado
- **Hoy:** la función `CostoBueno(Costo, CostoViejo)` prioriza `CostoViejo` (costo al momento de la venta).
- **Decisión:** valuar siempre con el **costo vigente** (`Costo`).
- **Fecha:** 2026-06-09.

### D2 — Rediseño del módulo de Costos/EDR
**Resuelto con Daniel el 2026-07-02** (sesión de arranque de F7; cierra el "por detallar" que quedó de 2026-06-09). Daniel no tiene hojas de cuadre "hechas", pero describió las fórmulas; el cuadre numérico se valida cuando entregue sus números o Gabriel arme un caso. Reglas cerradas:

1. **Fórmula de costo (por prenda).** Costo = **A)** importe total de la tela ÷ **prendas cortadas** (`CantCorte` = base de prorrateo `cortado`, default) + **B)** costo de maquila/estampado u **otros procesos** + **C)** costo de **avíos** de costura y empaque. El módulo viejo no costeaba bien los avíos (solo tela y maquila); v2 sí los costea al detalle.
2. **Regalía FUERA del costo.** La regalía ya **no es un componente del costo**: se aplica **sobre la venta** (Daniel la paga sobre lo facturado). En el costeo desaparece `regaliasCalc/regaliasCost`; los componentes quedan tela / procesos (maquila+estampado+otros) / avíos (+ `otros` para flexibilidad).
3. **Regalías siempre sobre la venta.** En la **lista de precios** el precio sugerido lleva la regalía sobre el precio (parametrizada con `ConfiguracionEmpresa.regaliasBase` = 10%, ya seedeada). Se ajusta el precio de venta para absorberla.
4. **Redondeo del precio sugerido: al alza (techo).** No el `CInt` del viejo (redondeo al más cercano) — se redondea **hacia arriba** a entero.
5. **Utilidad parametrizada.** El `×2` viejo = `ConfiguracionEmpresa.utilidadSugerida` (seedeada 50). Precio sugerido = f(costo, utilidadSugerida, regaliasBase) con redondeo al alza.
6. **Margen por pedido (fórmula de Daniel).** `margen = 1 − ( Costo ÷ ( PrecioVenta − bonificaciones del cliente ) )`. Las **bonificaciones del cliente** (costo logístico, publicidad, etc.) se **restan de la venta** (precio neto), no del costo. Ej.: `((70 ÷ 100) − 1) × −1 = 30%`.
7. **EDR nuevo, derivado de la FACTURACIÓN real.** El EDR se arma de la facturación por modelo de cada mes (**modelo, precio, cantidad, cliente**), se le pone el costo y se sacan **totales por cliente** (además del corte por empresa de la nota siguiente). El **precio manda desde lo facturado, NO desde el pedido**; si el mismo modelo se facturó a **varios precios → precio ponderado**. Como en F7 aún no existe el módulo de facturación/CFDI (es F9/D12), la pantalla de **conciliación captura/importa la facturación del mes**, pre-propuesta como comodín desde las **entregas a cliente** de F3, y el usuario la ajusta al número **realmente facturado**. Cuando llegue F9/CFDI se alimenta sola.
8. **Gastos del EDR: globales por mes** (como hoy — se capturan una vez al mes, sin empresa). Ventas y Costo se **desglosan por empresa** (y por cliente) desde las líneas; Gastos/Intereses/Bonificaciones/Resultado quedan a nivel **mensual consolidado**. El diseño deja lugar para gastos por empresa a futuro sin rehacer el esquema.
9. **"Entrega a tiempo"** (KPI de F7-E3) se mide contra la **fecha planeada del último proceso de la Ruta Crítica** (`fechaReal ≤ fechaPlaneada`), para que la RC tenga sentido.
10. **Auditoría 5S: fuera de F7** (nunca se usó — 0 filas). Se retoma más adelante dentro de Calidad. En F7-E5 se construye **solo el inventario cíclico**.
11. **Histórico de EDR: NO se migra** — se arranca con información **de este año (2026)**. Sí se migra el histórico de **costeos de órdenes** (`CostoOrd`, ~2,513) en E6 (barato y da contexto), pero **no** los 44 encabezados/1,431 líneas de EDR viejo.
12. **Auto-alimentar la productividad** desde movimientos/recibos (doc 05 obs. 4) queda como **mejora futura** (fuera de F7).

- **Fecha:** 2026-07-02.

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
- **Encaje en el plan:** módulo nuevo **14 (Finanzas)**; **fase F9 (Finanzas)** — al integrarse (2026-06-13) fue **F8** entre F7 y Go-live (que pasó a F9); el 2026-07-04, con **D13**, se insertó la nueva **F8 (Desarrollo y Cotización)** y Finanzas pasó a **F9** (Go-live a **F10**) —; **catálogo de proveedores enriquecido (R15) en F1** (etapa F1-E1B); requisitos derivados **R10–R15**. Detalle e insumo original: [PROPUESTA-Finanzas-y-Proveedores.md](PROPUESTA-Finanzas-y-Proveedores.md).
- **Fecha:** 2026-06-13.
- **Rectificación 2026-06-14 — UN solo catálogo de terceros (cierra R15 §4):** en v2 **NO** hay catálogos separados de `Maquilero` ni `Cortador`. Un tercero se da de alta **UNA sola vez como Proveedor** y marca sus servicios con **casillas de roles** (`RolProveedor`: maquila/costura, corte, estampado, bordado, lavado, aplicación, vende telas/avíos, otros). Esto evita duplicar terceros (un mismo taller puede maquilar **y** cortar) y unifica la base de las CxP/EsMa de F9 (Finanzas). Los atributos propios del maquilero (`corto`, `asegurado`, `obsPago`) se portaron a `Proveedor` (nullable). El **`precioReferencia` del cortador queda en DESUSO**: el **costo del corte se definirá en la orden de producción** (pendiente **F2/F3**). `TipoProceso` se conserva como catálogo aparte para la Ruta Crítica (F5). Implementado en la rama `tarea/fusion-terceros` (migración `fusion_terceros`).

### D13 — Desarrollo, Cotización y Listas de Precios por Cliente
- **Contexto:** CONTROL (viejo y v2) arranca en "modelo terminado" y "pedido"; **la capa previa de desarrollo y cotización por cliente no existe**. El precosteo de F7 usa precios genéricos de catálogo (no amarra proveedor/producto/precio real), no hay listas de precios por cliente y la **negociación se lleva en Excel**, fuera del sistema. Daniel quiere: cotización lo más precisa posible → precio con los factores del cliente → él aprueba o ajusta → se negocia re-costeando → y con orden de producción, todo desemboca en la compra de material con lo predefinido.
- **Concepto central:** **Proyecto de desarrollo = 1 Cliente + 1 Departamento del cliente** (entidad nueva; ej. C&A / NIÑOS), con **nombre/tema**; puede haber varios proyectos por departamento/temporada (joggers, Disney, básicos…). El proyecto agrupa **desarrollos**: cada desarrollo es un modelo con **dos números** (el del cliente y el nuestro).
- **Precosteo preciso:** por insumo del BOM se predefine **proveedor + producto de ese proveedor + precio** (editable al comprar). **Telas:** precio **por proveedor** (`TelaProveedor`, nuevo) y, en ciertos proveedores, **por color**; el precosteo lee de ese catálogo. **Medidas por talla solo en ciertos avíos** (cierres, elástico…): el precosteo usa un **promedio**; la compra usa las medidas exactas. Telas SIN talla ni color (consumo por modelo completo). **Conceptos de costo abiertos**: mínimo tela+avíos+maquila; + estampado/bordado/otros procesos/otros conceptos, extensibles como datos.
- **Lista de precios + aprobación + negociación:** la lista se genera desde los precostos con los **factores del cliente** (margen objetivo, % descuentos, regalías, % costo de ventas); el sistema propone → el **dueño aprueba o modifica el precio a mano, modelo por modelo** → aprobada, la toma comercial. **Negociación = re-costeo interactivo por VERSIONES** (se cambia el desarrollo para cerrar el precio; queda el acuerdo de diseño + el precio acordado por modelo). La lista se guarda **por Cliente + Departamento** con fechas y toda la negociación; **queda archivada aunque no cierre venta**. **Estados configurables** (abierta / en negociación / cerrada / ya pedida; ampliables), los mueven el dueño o el gerente comercial.
- **Conexión con pedidos y compras (el punto fino):** hay DOS "órdenes de compra" distintas — la **OC DEL CLIENTE** genera pedido/orden de producción (**la lista NO dispara pedidos**); **NUESTRA OC a proveedores** se alimenta del desarrollo. Cada modelo se liga a su orden de producción y por esa liga queda pegado todo el registro del desarrollo/negociación; de ahí el MRP/OC hereda proveedor/producto/precio predefinidos (telas dejan de ser captura manual) y las cantidades de avíos por medidas por talla. Un desarrollo que no llega a producción **se apaga** (archivado).
- **Roles:** Desarrollo (proyectos/modelos/receta/amarres/medidas) · Dueño (aprueba o modifica precios) · Comercial y/o dueño (negocian, registran acuerdos y mueven estados) · Compras (genera la OC a proveedores con lo predefinido).
- **Sub-decisiones ya resueltas por Daniel (2026-07-04):** precio del insumo = catálogo **o** a mano (ambos) · tela por proveedor y por color solo en ciertos proveedores · conceptos abiertos · consumo por talla solo ciertos avíos (telas no; tampoco por color) · lista por Cliente+Departamento persistida con historial aunque no cierre · estados configurables · versionado sí · enganche modelo→orden de producción · proyecto = 1 cliente + 1 departamento con tema · negociación comercial y/o dueño.
- **Encaje en el plan:** módulo nuevo **15 (Desarrollo y Cotización)**; **fase F8 nueva** entre F7 (usa su motor de costeo) y Finanzas (que se renumera a **F9**; Go-live pasa a **F10** — mismo criterio secuencial que cuando se insertó Finanzas); requisitos derivados **R16–R20**; el impreso "Lista de precios" de R9 (pendiente sin módulo en `HOJA-DE-RUTA.md` §4) queda asignado aquí. **Sin ETL de Access**: proyectos/negociación hoy viven en Excel; la fase arranca en cero (como el EDR, D2 #11). Detalle e insumo original: [PROPUESTA-Desarrollo-Cotizacion-y-Listas-de-Precios.md](PROPUESTA-Desarrollo-Cotizacion-y-Listas-de-Precios.md).
- **Fecha:** 2026-07-04.

### Decisiones de negocio de F8 (arranque de fase — respuestas a las preguntas de la ficha) — 2026-07-04

Preguntas de [`docs/hoja-de-ruta/F8-etapas.md`](../docs/hoja-de-ruta/F8-etapas.md) resueltas por Daniel al arrancar la fase (vía Gabriel):
- **(a) Factores del cliente:** por cliente, con **override opcional por departamento** (ej. Damas Básicos con menor margen que Dama Moda); además el snapshot de factores se **copia y es editable en cada lista** de precios.
- **(b) Fórmula del precio de lista:** **cascada** (margen primero: `costo ÷ (1−margen)`, luego `÷ (1−(descuentos+regalías+costoVentas))`) con **redondeo al alza** (D2). Daniel subirá su Excel con las fórmulas para reconciliar la composición exacta en E4.
- **(c) Arranque:** **de cero** (no se capturan las listas viejas del Excel). En la misma plática Daniel pidió poder **adjuntar archivos de apoyo (Excel/PDF) a la orden de producción** (= **R6**, confirmado para **F8-E6**) para subir los archivos viejos.
- **(d) Moneda de insumos:** **todo en MXN**; si un proveedor cotiza en USD, va **solo como referencia** (texto en `condiciones`) y el costo se fija en pesos. Sin motor de tipo de cambio en esta fase.
- **(e) Precio al pedido:** **sí** — al ligar el desarrollo a su orden, el precio acordado se propone en el renglón del pedido como **default editable** (nunca candado). *(La automatización "OC-PDF del cliente → pedido → OP" es Etapa 2 futura = **R8**.)* **→ Refinado al construir F8-E6 (Gabriel, 6-jul): el precio acordado se MUESTRA editable en la orden (sección "Desarrollo" + vista 360); NO se pre-llena `PedidoLinea.precio` (ver nota de F8-E6 abajo). El pre-llenado del renglón en la captura del pedido (F2) queda como mejora futura (`HOJA-DE-RUTA.md` §4).**
- **(f) Desarrollos sobre modelos existentes:** **ambos** (ligar un modelo existente o crear uno nuevo).
- **(g) Promedio de medidas por talla para el precosto:** **promedio simple** (una sola medida promedio; el precosto es estimación). La **compra** sí usa las medidas exactas por talla de cada orden.
- **(h) Quién apaga/archiva y mueve estados:** apagar desarrollos / archivar proyectos = `desarrollo.administrar`; mover estados de lista = `listas.negociar` (dueño + gerente comercial).

**Refinamiento del reparto de permisos (F8-E1, confirmado por Gabriel 2026-07-04):** `desarrollo.ver` y `listas.ver` quedan **amplios** (cascadean hasta Secretarial); `desarrollo.administrar`, `desarrollo.precostear` y `listas.administrar` se **cortan en Logística hacia abajo** (mismo precedente que `precostos.consultar` de F7); `listas.aprobar` (dueño) y `listas.negociar` (dueño + gerente comercial) quedan restringidos según (h).

**Diseño de la negociación por versiones (F8-E5, 2026-07-06 — a confirmar con Daniel, no bloquea):** una **ronda** de negociación re-costea el modelo (se congela una versión nueva del precosto) y el renglón de la lista **re-apunta** a esa versión, recalculando el precio con los factores snapshot; al hacerlo **se resetea `precioAprobado`** → el precio nuevo lo **re-aprueba el dueño** con `listas.aprobar`. Esto separa al **negociador** (gerente comercial, `listas.negociar`, registra rondas/acuerdos y el precio acordado) del **aprobador** (dueño, `listas.aprobar`, fija el precio de venta), coherente con el reparto (h)/seed. El **precio acordado** de la ronda queda en la bitácora inmutable del renglón (`NegociacionEvento`), nunca fija por sí solo el aprobado. Cambiar el estado de la lista (incl. **reabrir** una cerrada) es `listas.negociar` y queda auditado; un estado de cierre bloquea nuevas rondas/ediciones de renglón.

**Decisiones de F8-E6 (enganche + cierre de fase, 2026-07-06):**
- **Precio al pedido (refinamiento de (e)):** al ligar un desarrollo a su orden, el precio acordado se **MUESTRA** de forma prominente y **editable** (sección "Desarrollo" de la orden + vista 360), pero **NO se pre-llena `PedidoLinea.precio`**. Razón: la `Orden` cuelga de un renglón de pedido (`PedidoLinea`) que se captura **antes** en el flujo F2, así que escribir el precio "hacia atrás" al momento de ligar (que ocurre a nivel de orden) sería semánticamente raro y cruzaría el dominio de Pedidos (A1). **Gabriel confirmó (6-jul) que mostrarlo satisface la intención de (e);** el **pre-llenado del renglón en la captura del pedido (F2)** queda como **mejora futura** (backlog `HOJA-DE-RUTA.md` §4).
- **Permiso de adjuntos R6 de la orden:** reusan `ordenes.ver` (listar/descargar) y `ordenes.administrar` (subir/eliminar) — **sin permiso nuevo**, mismo patrón que las fotos de modelo (`modelos.ver`/`.administrar`).
- **Borrado físico en R2:** F8-E6 agregó `eliminarObjeto` (`DeleteObjectCommand`) al motor `comun/archivos.ts` y lo usa al eliminar un adjunto de orden (best-effort, tras el commit) → **salda la deuda §8 para los adjuntos de orden**; cablearlo en modelos/bordados/proveedores queda de backlog (§4).
- **MRP con proveedor amarrado inactivo:** si el proveedor que Desarrollo amarró a una tela/avío está **inactivo**, el MRP **mantiene la sugerencia** (Desarrollo lo eligió a propósito y la OC es editable) pero deja un **AVISO** en la explosión — no truena en silencio, y no lo trata como el fallback "más barato" de F4 (que sí excluye inactivos).

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

### Decisiones de diseño F3-E5 (entrega a cliente + tablero WIP) — 2026-06-19

Flujo de entrega a cliente. La tabla vieja `EntregasCliente` tiene **0 filas**: en el Access viejo la entrega real se registraba como un **movimiento de inventario tipo 5 'Entrega a Cliente'** (salida de PT) más la actualización del seguimiento en `PedidosReales`. Decisión de Gabriel (con criterio de negocio de Daniel), 2026-06-19. Detalle en la ficha `docs/hoja-de-ruta/F3-etapas.md` §F3-E5.

#### (b) — Flujo de entrega a cliente: salida de kardex PT + seguimiento de pedido DERIVADO
- **Decisión:** `registrarEntregaCliente` es **una transacción** (A2) que crea `EtapaMovimiento(tipo=entrega_cliente, idOrden)` + detalle color×talla y genera la **SALIDA del kardex PT** (tipo de movimiento `entrega-cliente`, dirección salida; `origenTipo = entregaCliente`) del modelo×color×talla en el almacén elegido. El seguimiento del pedido (entregado/faltante por línea) queda **DERIVADO** de la suma de las entregas vivas (nunca un campo editable — D3; los `*V1` del ETL son solo histórico de lectura). Folio A3, Bitácora A7, evento `entrega-registrado` post-commit (gancho RC F5).
- **No-negativo (ESTRICTO):** no se puede entregar más de la **existencia disponible** del artículo. Validación por **suma directa de `MovimientoDet` bajo `pg_advisory_xact_lock`** dentro de la transacción (nunca la vista `existencia_pt` — regla del ADR-0010), con test de concurrencia (dos entregas simultáneas del mismo artículo no dejan negativo). Mismo patrón que el recibo de E4.
- **Cancelación:** por **movimiento inverso auditado** (nunca edita/borra); revierte la salida de kardex y devuelve el pendiente del pedido (derivado).
- **Fecha:** 2026-06-19.

#### Comprobante PDF de entrega (R9): SÍ
- **Decisión (Gabriel, 2026-06-19):** la entrega a cliente **lleva comprobante PDF** imprimible (cliente, modelo, matriz color×talla, fecha, folio), con el patrón `@react-pdf/renderer` ya usado en F2-E4/F3-E2/E4. Es impreso nuevo (R9 que estaba "por definir").
- **Fecha:** 2026-06-19.

### Decisiones de diseño F3-E6 (ETL de producción e inventario PT) — 2026-06-20

Estrategia de migración del histórico. Decisión de Gabriel, 2026-06-20. Detalle en la ficha `docs/hoja-de-ruta/F3-etapas.md` §F3-E6.

#### (c) — Histórico de kardex PT sin color×talla: carga "sin desglose" (sentinela)
- **Contexto:** el inventario de PT del sistema viejo se llevaba **solo por modelo × almacén** (`IPT_Mod_Alm`, 3,655 filas) y sus movimientos (`IPT_MovsDet`, 6,886 filas) apuntan a `IdIPT_Mod_Alm` — es decir, **el viejo NUNCA registró color ni talla en el inventario de PT** (es la limitación que la D4 corrige hacia adelante). El kardex de v2 (`MovimientoDetPt`) exige `modelo × color × talla`; esa granularidad no existe en la fuente y no puede inventarse con fidelidad.
- **Decisión:** migrar cada movimiento histórico de IPT con un **color y una talla sentinela `(sin especificar)`** (catálogo, marcados inactivos para que no aparezcan en los selectores de captura nueva). Es la representación **fiel** del dato real: lo que el viejo sí sabía (modelo × almacén × cantidad) se preserva exacto; lo que nunca tuvo (color/talla) se marca como tal. **No afecta la operación futura:** de F3-E4/E5 en adelante todo entra con color×talla real; el sentinela es exclusivo del histórico migrado.
- **Descartadas:** (1) *reconstruir* color×talla cruzando `IPT_Movs.IdRecibos → OrdenesDetRecM` — solo ~2,353 de 5,072 movimientos traen liga a recibo (solo entradas de costura); salidas/ajustes quedarían igual sin dato, e **inventaría** precisión que el viejo nunca tuvo, con riesgo de descuadre contra `IPT_Mod_Alm`. (2) *Híbrido* (reconstruido donde haya liga, sentinela para el resto) — dos criterios conviviendo en el mismo histórico, más complejo, beneficio parcial.
- **Cuadre:** Σ del kardex v2 agregado por **modelo × almacén** (ignorando el sentinela) se compara contra `IPT_Mod_Alm.Existencia`. Donde NO cuadre (el viejo permitía editar la existencia a mano — el problema que la D3 erradica), el descuadre se **LISTA con su causa** en el reporte, nunca se corrige en silencio.
- **Reversible / F10:** el ETL se re-corre en F10 al corte; si para entonces Daniel quiere otra estrategia para el saldo inicial, se decide ahí (los saldos iniciales de go-live entran como AJUSTE de kardex — F10-E5). Esto de F3-E6 es para el ambiente de **prueba**.
- **Fecha:** 2026-06-20.

---

### Decisiones de diseño F4 (Compras / MRP) — 2026-06-20

Reglas de Órdenes de Compra, recepción, explosión MRP, notas de salida y migración de la fase. Cerradas con **Daniel** (dueño / experto del negocio), relayed por Gabriel, 2026-06-20. Detalle operativo en la ficha `docs/hoja-de-ruta/F4-etapas.md`.

#### (a) — Edición de una OC autorizada: bloqueada salvo admin + "Duplicar a nueva OC" (E2)
- **Decisión:** una OC **autorizada** queda **bloqueada** para edición por usuarios normales. El **administrador SÍ puede editarla**, y cada cambio se registra en `Bitacora` (A7: quién, cuándo, qué). Además existe una acción **"Duplicar a nueva OC"** (para todos) que copia la OC a una nueva en estado borrador para ajustar un detalle sin recapturarla; la copia sigue su propio ciclo de autorización.
- **Por qué:** preserva el rastro de auditoría (no se reescriben a la ligera documentos ya autorizados) y resuelve la necesidad real de "cambiar un detallito sin rehacer".
- **Aplica en:** F4-E2.

#### (b) — La recepción exige OC autorizada (E3)
- **Decisión:** **NO se puede recibir nada contra una OC que no esté autorizada.** La recepción solo opera sobre OC en estatus `autorizada` / `recibida-parcial`. Si llega material de una OC sin autorizar, primero se autoriza.
- **Aplica en:** F4-E3 (regla dura, verificada server-side, deny-by-default A4).

#### (b.1) — PROVISIONAL · Valuación de los componentes ACOMPAÑANTES del lote de tela (E3) — **pendiente de confirmar con Daniel**
- **Contexto:** un lote de tela (D5) puede traer **N telas acompañantes** del mismo lote/color (cuerpo + cardigan + …). El precio de la OC es **por la tela comprada** en el renglón; el acompañante no tiene un precio propio en la OC.
- **Decisión provisional (default seguro, tomada por el equipo en F4-E3, NO con Daniel):** al recibir, el `costoUnit` (precio÷factor de la línea de OC, D1) se asigna **solo al componente de la tela comprada**; los **acompañantes entran al kardex con `costoUnit = NULL`**. Así la valuación del lote completo = el total de la línea de OC (no se infla cobrando el acompañante como si se hubiera pagado).
- **Pendiente:** confirmar con Daniel **antes de que F7 valúe inventario** (¿el acompañante debe heredar un costo, repartirse el costo del lote, o quedar en NULL?). Si cambia, se ajusta solo el reparto de costo en la recepción (el resto del flujo no depende de esto).
- **Aplica en:** F4-E3 (reparto de `costoUnit` en `crearLoteRecepcion`); revisar en F7 (valuación).

#### (c) — Detalle por talla×color NATIVO en el renglón de OC (reemplaza el Excel) (E2)
- **Contexto:** el sistema viejo permitía pegar una **tabla de Excel** dentro de la OC para un avío comprado diferenciado **por talla y color** (ej. etiquetas, aplicaciones). Era solo una **referencia** pegada, sin datos estructurados.
- **Decisión:** se **elimina el Excel**. El renglón de OC que lo requiera lleva una **matriz talla×color NATIVA** (reusa el componente de matriz D4 ya usado en pedidos F2 y producción F3); la **suma de la matriz = cantidad del renglón**; se imprime como tabla dentro del **único PDF de OC**. Los renglones que no lo necesiten quedan con cantidad simple. Daniel: *"antes era solo una referencia, ahora va a ser real"* → dato estructurado y cruzable.
- **Impresos:** **un solo formato de PDF de OC** (Daniel: "con uno solo está bien"); se retiran las variantes viejas (`OrdCompraImpAdm`/`OrdCompraImpInter`) y la **exportación a Excel** (`OrdCompraExcel`), salvo que surja otro uso.
- **Aplica en:** F4-E2 (`OrdenCompraLinea` gana un detalle talla×color opcional, análogo a `OrdenLineaTalla` de F2).

#### (d) — Avíos genéricos en la explosión: netean contra existencia real; el faltante se compra (E4)
- **Decisión:** en la explosión, un avío **`esGenerico`** NO genera compra por defecto: se **netea contra la existencia REAL del kardex** de avíos. Si la existencia cubre lo requerido → "cubierto por stock" (sin compra); si **no alcanza, solo el faltante va a compra**. La condición de Daniel ("que se confirme que sí exista realmente físicamente") se cumple porque el neteo es contra la existencia real del inventario (suma de movimientos, D3), no contra un número a mano, respaldado por el **ajuste por conteo físico** de E1.
- **Por qué:** Make-to-Order; no se sobre-diseña un MRP de reabastecimiento. El neteo evita comprar lo que ya se tiene, sin asumir stock inexistente.
- **Aplica en:** F4-E4 (explosión), apoyado en la existencia de avíos de F4-E1.

#### (e) — Telas en notas de salida: la nota referencia la salida-a-orden, sin segundo movimiento (E5)
- **Decisión:** la **tela** se descuenta **una sola vez** con `registrarSalidaTelaAOrden` (E1, fiel a `Salidas.IdOrdenes`). La **nota de salida** al maquilero **referencia** esa salida como documento de envío y **NO genera un segundo movimiento** de kardex para telas. Lo que la nota SÍ descuenta son los **avíos** (R4). Validación y test anti-doble-descuento obligatorios.
- **Aplica en:** F4-E5.

#### (f) — Síntesis de lotes legacy por entrada/factura; el precio viejo va al costo del movimiento (E6)
- **Decisión:** al migrar el histórico de telas, los **lotes legacy se sintetizan por entrada/factura** (cada entrada física = un lote; sus componentes `ExTela1`/`ExTela2` → `LoteComponente`, D5). El precio viejo (`TelasColores.Precio`) se carga como **`costoUnit` del movimiento de entrada legacy** (D1); no se crea tabla de precios editable.
- **Aplica en:** F4-E6.

#### (g) — Almacén origen de la nota de salida: en el ENCABEZADO (un almacén por nota) (E5)
- **Contexto:** al confirmar una nota de salida, los **avíos** se descuentan del kardex (R4) y hay que saber de qué almacén salen (el inventario de avíos es multi-almacén). Pregunta llevada a Daniel durante la construcción de E5.
- **Decisión:** el **almacén origen va en el ENCABEZADO de la nota** (un solo almacén por nota), capturado al crear — espejo de la **recepción de compra**, que lleva su almacén destino en el encabezado. Toda la nota sale del mismo almacén; **no** se maneja almacén por renglón. La tela no descuenta (decisión (e)), así que el almacén aplica a los **avíos**.
- **Aplica en:** F4-E5 (`NotaSalida.idAlmacen`, validado existe/activo/global-o-de-la-empresa A9; `confirmarNotaSalida` lo lee del encabezado, ya no como parámetro).
- **Fecha:** 2026-06-21. Cerrada con Daniel; relayed por Gabriel.

- **Fecha (a–f):** 2026-06-20. Cerradas con Daniel; relayed por Gabriel.

---

### Hallazgos y decisiones de la verificación del ETL de F3-E6 — 2026-06-21

Surgidas al revisar el cuadre del ETL de producción/inventario PT en `prueba`. Decisiones de **Daniel** (relayed por Gabriel), 2026-06-21.

#### (a) — Estados de cuenta de terceros UNIFICADOS, con los maquileros de PROCESO (estampadores) incluidos
- **Contexto:** el cuadre de F3-E6 **omitió 1,251 cargos EsMa de estampadores** cuyo `IdMaquileros` no mapea a un `Proveedor` de v2 (casi todos `esEstampado=true`). Daniel pregunta cómo se unifican TODOS los estados de cuenta de proveedores e insiste en que **los de proceso (estampadores) deben estar incluidos**.
- **Decisión:** **todos** los estados de cuenta de proveedores se llevan en **una sola cuenta corriente de terceros** (refuerza **D12**: motor único, **saldo = Σ movimientos**, nunca editable — D3; dos vistas operativa/fiscal; **F8-E1**). Incluye **sí o sí** a los maquileros de **proceso (estampado/aplicación)**, no solo costura. Cada estampador es **un `Proveedor` con rol `estampado`/`aplicacion`** (no hay catálogo aparte de "estampadores"); el cargo EsMa aplica a **costura Y estampado** (`EsMa_Recibos.EsEstampado`).
- **Deuda a cerrar (no es de F3):** esos estampadores **no están en el catálogo de Proveedores migrado**. Hay que **revisar/extender la migración de proveedores de F1** para incluirlos (averiguar de dónde salen esos `IdMaquileros` en el viejo y por qué no mapearon) **antes de F6** (EsMa completo) **/ F8** (unificación CxC/CxP). Se retoma en una tarea de saneo de proveedores o al re-correr el ETL en F9.
- **Aplica en:** F6 (EsMa), F9 (CxC/CxP unificado), y un saneo de proveedores de F1 (estampadores faltantes).

#### (b) — Inventario PT al go-live: se parte de CONTEO FÍSICO, no de los saldos viejos
- **Contexto:** el cuadre de F3-E6 demostró **empíricamente** que el inventario PT del viejo **NO está respaldado por movimientos**: Σ kardex v2 ≈ **154,299** vs Σ existencia vieja **389,369** (Δ≈−235,070; 89% de los modelos cuadran pero la suma total no). Es el problema que la **D3** erradica: el viejo editaba la existencia a mano (GotFocus/LostFocus, 04-Inventarios Obs.1).
- **Decisión:** al **go-live**, el saldo inicial del inventario PT **se parte de un CONTEO FÍSICO**, NO de los saldos viejos editados a mano. Entra como **AJUSTE de kardex** (saldo inicial), no migrando los movimientos/saldos históricos como verdad.
- **Aplica en:** **F10-E5** (saldos iniciales como ajuste de kardex + reporte de cuadre v1 vs v2). El cuadre de F3-E6 en `prueba` queda como informativo (descuadres listados, nunca corregidos).

#### (c) — Inventario de TELAS al go-live: se inicializa desde CERO; se conserva el registro de CONSUMOS por orden
- **Contexto:** análogo a la (b) de PT, pero para telas. Daniel aclara (2026-06-21) que el inventario de telas **no arrastra saldo viejo**.
- **Decisión:** al go-live, el inventario de **telas se inicializa desde CERO** (el stock de telas viejo NO se carga como saldo de existencia; las compras reales lo construyen de ahí en adelante). **PERO sí se conserva el registro de los CONSUMOS de tela por orden** (qué orden consumió qué tela — `Salidas.IdOrdenes` vía `registrarSalidaTelaAOrden`), por **trazabilidad y costeo**.
- **Relación con F4 (f) y F10:** el ETL de telas (F4-E6) puede sintetizar los lotes/movimientos legacy para preservar el **histórico de consumos por orden**, pero el **saldo de existencia de telas al corte = 0**. El equipo de F4-E6/F10 reconcilia la mecánica (consumos como histórico/referencia vs movimientos vivos) sin que el saldo inicial herede stock viejo de telas.
- **Aplica en:** F4-E6 (conservar consumos por orden) y F10 (saldo inicial de telas = 0).
- **Fecha:** 2026-06-21.

---

### Hallazgos y decisiones del ETL de F4-E6 (cierre de fase) — 2026-06-22

Tomadas por el equipo al construir el ETL del histórico de Compras/Notas/Telas. Las marcadas
**(a ratificar con Daniel)** son refinamientos técnicos de decisiones ya cerradas o defaults seguros;
no bloquean el cierre de F4 pero conviene confirmarlas antes de F10 (corte de go-live).

#### (E6.1) — Refinamiento de la decisión (f): lotes legacy POR COLOR, no por entrada/factura — **a ratificar con Daniel**
- **Decisión (f) original:** lotes legacy sintetizados *por entrada/factura*.
- **Refinamiento aplicado:** se sintetizan **por color** (`IdTelasColores`, clave `LEGACY-TELA-<id>`),
  un lote por color reusado por las entradas y salidas de ese color.
- **Por qué:** (1) v2 unificó `Telas`+`TelasDis` en UNA `Tela` con `tipoComponente` (ADR-0009) → no
  hay 2 telas por renglón; (2) las **salidas legacy NO referencian lote** → sintetizar por
  entrada/factura dejaría las salidas sin lote del cual descontar. Por-color es lo único que hace
  cuadrar la existencia v2 **1:1 con `TelasColAlm`** (que es por tela×color×almacén). El reviewer
  independiente lo avaló como técnicamente sólido. `costoUnit = TelasColores.Precio` solo en las
  entradas; NULL en salidas/traspasos (D1).
- **Aplica en:** F4-E6 (ETL de telas).

#### (E6.2) — Entradas de compra legacy: entrada DIRECTA al kardex, SIN RecepcionCompra
- **Decisión:** las entradas legacy de tela entran como movimiento `entrada-recepcion` directo; **no**
  se crea `RecepcionCompra` (el viejo no liga entrada↔OC: `RecepcionCompra` queda solo para
  operaciones v2). Las OC y notas legacy tampoco mueven kardex (anti-doble-conteo). El cuadre verifica
  0 telas con origen `recepcion-compra` y `movimiento=0` para OC/notas legacy.
- **Aplica en:** F4-E6.

#### (E6.3) — Defaults de migración (nada se pierde en silencio, §7)
- **Usuarios viejos** sin mapeo → `IdUsuAutorizado`/`IdUsuCancelado` preservados como texto
  `legacy:<id>` (columnas sin FK, ADR-0005). *(A ratificar: `legacy:` vs NULL.)*
- **Almacén sentinela** `(histórico — sin almacén)` global+inactivo para las notas legacy (el viejo no
  tenía almacén origen y `NotaSalida.idAlmacen` es NOT NULL), espejo del Color/Talla sentinela de
  F3-E6.
- **Ventana temporal CONFIGURABLE** (`ETL_VENTANA_ANIOS`, default **0 = sin recorte**): el recorte real
  lo hace el mapeo de empresas (solo migran las activas 7=Marilyn Fitness / 8=FR Moda; las 6 viejas se
  omiten y listan). El reporte siempre imprime la config y lo excluido. *(A ratificar si Daniel quiere
  un recorte temporal real además del de empresas.)*
- **Líneas legacy = texto libre** (`descripcionLibre`/`descripcionLegacy`), NO mapeadas a catálogo;
  `Totales` NO se migra (derivado).
- **Fecha:** 2026-06-22.

---

### Decisiones de negocio de F5 (Ruta Crítica) — 2026-06-22

Reglas nuevas del motor de workflow/CPM, auto-avance e impresos de la fase. Cerradas con **Daniel**
(dueño / experto del negocio), relayed por Gabriel, 2026-06-22, ANTES de arrancar la fase (preguntas
de fase juntas, regla CLAUDE.md §6). Detalle operativo en la ficha `docs/hoja-de-ruta/F5-etapas.md`.
Profundizan D10 (RC como workflow configurable) y D11 (modelo analítico).

> **Principio rector que ató varias respuestas (Daniel):** la RC **refleja la realidad física de
> producción**, así que **el dato automático (evento de producción) manda** sobre la captura a mano.
> De ahí salen (e) y (f).

#### (a) — Calendario laboral configurable: L–V + festivos MX + fechas propias de FR (E2)
- **Decisión:** la planta trabaja **lunes a viernes** (sin sábados ni domingos). El calendario laboral
  es **configurable por empresa** e incluye los **festivos oficiales de México** + un conjunto de
  **fechas propias de FR Moda** como días no hábiles. El CPM (E4) solo cuenta días hábiles contra este
  calendario (reemplaza el `L–V` hardcodeado y `CuantosSabYDom` del viejo).
- **Pendiente operativo:** Gabriel consigue con Daniel la **lista de fechas propias de FR** para
  cargarlas al construir el calendario en E2 (no bloquea E1).
- **Aplica en:** F5-E2 (`CalendarioLaboral`), consumido por el CPM en F5-E4.

#### (b) — Los factores SÍ afectan las duraciones: cantidad + tipo de producto + tipo de tela (E2/E3)
- **Decisión:** las duraciones de los procesos **deben variar** por **cantidad**, **tipo de producto**
  y **tipo de tela**. Esto **revierte el default** que se había propuesto (conservar el comportamiento
  viejo de NO aplicar ciertos multiplicadores): se **prenden** los factores que el sistema viejo tenía
  guardados pero **nunca aplicaba** (`FactorTela` 0.07–2.30, `FactCantAp`), además de lo que ya hacía
  (factor por rango de cantidad `CP_Cant`, días por tipo de tela `TelasDias`, y plantilla propia por
  artículo/familia = el "tipo de producto").
- **Cómo se valida:** el equipo define la fórmula exacta en E2/E3 y la **valida con Daniel mostrándole
  números concretos** ("esta tela + esta cantidad + este producto = N días") — NO se valida en
  abstracto. La ADR de E3 que iba a documentar el **descarte** de `FactorTela`/`FactCantAp` cambia de
  sentido: ahora documenta **cómo se aplican** los tres ejes.
- **Aplica en:** F5-E2 (reglas de duración) y F5-E3 (`calcularDuracion` + ADR).

##### (b.E3) — Fórmula exacta de duración cerrada con Daniel (22-jun-2026, F5-E3, ADR-0012)
- **Contexto:** al implementar `calcularDuracion` (E3) se cerró con Daniel CÓMO se aplican los ejes,
  evitando doble-conteo. Refina la (b): no TODOS los multiplicadores guardados se "prenden".
- **Decisión:** cada proceso tiene UN `tipoDuracion` y se calcula por esa regla (los ejes no se
  combinan en una sola multiplicación):
  - `fija` → `tiempoEstandar` de la plantilla (el "tipo de producto" ya está en la plantilla por
    artículo/familia).
  - `porCantidad` → `max(1, round(tiempoEstandar × factorCantidad(cant) + colchonCostura))`.
  - `porTipoTela` → los **`dias`** del catálogo de la tela, **DIRECTOS**. **NO se multiplica por
    `factorTela`** (los `dias` ya son el tiempo absoluto de espera de esa tela; multiplicar por su
    propio factor doble-contaría). `factorTela` se **conserva como referencia** en el catálogo.
  - `porAplicacion` → `max(0, round(diasAplicacion × factorCantidad(cant)))`. **SÍ se PRENDE el factor
    de cantidad** (corrige el ex-bug `FactCantAp`, que lo ignoraba). La columna
    `DuracionPorAplicacion.factor` **NO se usa** (referencia, como `factorTela`).
- **Por qué:** el eje que escala con el volumen es el **factor de cantidad** (más piezas = más tiempo);
  `factorTela` y el `factor` de aplicación se dejan en el catálogo para que nadie los "corrija" en
  silencio, pero aplicarlos sería doble-conteo sin sentido de negocio.
- **Aplica en:** F5-E3 (`backend/src/dominio/ruta-critica/calcularDuracion.ts`, ADR-0012).

#### (c) — La RC nunca modifica la fecha de entrega de la orden; el cierre se guarda aparte (E3/E4)
- **Decisión:** la fecha de entrega comprometida de la orden **no se modifica nunca** (a diferencia del
  viejo, donde completar el proceso 'C' la sobre-escribía en silencio). La RC **calcula y muestra** su
  fecha de término, pero no la pisa. Cuando la orden/RC **se cierra**, se registra **en otro lado** una
  marca de **"terminada el [fecha]"** (solo para saber que ya acabó) — derivada del cierre de la RC
  (`rcViva=false` + `fechaReal` del último proceso), sin tocar `fechaEntrega`.
- **Aplica en:** F5-E3/E4 (la RC expone su fecha; campo/indicador de terminación real separado de la
  fecha de entrega).

#### (d) — Auto-avance de recibos parciales: el proceso se completa hasta la cantidad COMPLETA (E6)
- **Decisión:** cuando un proceso se auto-completa por un evento que llega en **varias remesas**
  (recibo de maquila, recepción de tela, etc.), el proceso se marca **completo solo al llegar la
  cantidad completa**; desde el **primer recibo** lleva una **marca visible de "parcial en curso"**
  (sobre cantidades color×talla, D4).
- **Aplica en:** F5-E6.

#### (e) — Evento automático vs captura manual: gana el automático (E6)
- **Decisión:** si un proceso ya tenía fecha **capturada a mano** y luego **llega el evento**
  automático, **el evento PISA** la fecha manual; la `Bitacora` guarda que alguien la había puesto a
  mano (no se pierde el rastro, A7). *(Esto invierte el default propuesto de "el evento no pisa lo
  manual".)* Motivo: principio rector — el evento refleja lo que pasó físicamente.
- **Aplica en:** F5-E6.

#### (f) — Cancelación del movimiento origen: el proceso SÍ se des-completa (E6)
- **Decisión:** si se **cancela** el corte/recibo que auto-completó un proceso, el proceso **se
  des-completa automáticamente** y queda registro en `Bitacora`; después alguien puede volver a ponerlo
  **a mano** si corresponde. *(Esto invierte el default propuesto de "no se des-completa solo".)*
- **Implicación técnica (no es decisión de Daniel):** des-completar obliga a **recalcular el CPM** y a
  revisar los **sucesores ya activados** de ese proceso. Contemplado en el alcance de E6.
- **Aplica en:** F5-E6.

#### (g) — Impreso PDF del "Plan de la RC por orden": SÍ, pero lo principal es en línea (E5)
- **Decisión:** **sí** se construye el impreso PDF del plan por orden (R9), pero el uso principal es
  **consultar y actualizar en línea** (la pantalla RC por orden con timeline planeado-vs-real). El PDF
  es complemento para piso, no el flujo central.
- **Aplica en:** F5-E5 (CONSTRUIDO).
- **Cierre (Gabriel, 2026-06-22):** se construyó en E5, fiel a lo que decidió Daniel. Es un impreso
  **server-side** (`@react-pdf/renderer`, mismo patrón que orden/OC/nota/entrega): ruta binaria
  `GET /api/ruta-critica/ordenes/:id/plan-impreso` (permiso `rc.ruta-ver`, scope de empresa A9) con
  encabezado de la orden + tabla de procesos (fecha planeada, duración, responsables, estado, fecha
  real) y botón **"Imprimir plan"** en la pantalla *RC por orden*. (Inicialmente lo propuse mover a E7
  para agruparlo con el Excel del concentrado; Gabriel pidió hacerlo en E5 porque Daniel ya lo había
  aprobado para esta etapa. **Recordatorio de proceso:** revisar SIEMPRE las decisiones ya cerradas de
  Daniel antes de proponer o diferir algo.)

#### (h) — Exportación a Excel del concentrado planeado-vs-real: SÍ (E7)
- **Decisión:** **sí** al export a Excel del concentrado (exceljs, mismo resultado que el tablero).
  Daniel anota que **las vistas/reportes de análisis se trabajan a fondo más adelante** (eso es F7 —
  tableros/KPIs sobre el modelo `RutaOrden`, D11); en F5 va el concentrado + su export como base.
- **Aplica en:** F5-E7.

#### Decisiones TÉCNICAS de la fase (en ADR, sin Daniel)
- **CPM v2** = backward pass limpio en días hábiles (en vez del bucle iterativo `OtraVez` del viejo);
  con N antecesores `fechaInicio = MAX(fin de antecesores)`. ADR en E4.
- **Motor de jobs** = pg-boss 12 como motor común, **serializado por orden** (singleton key) para que
  dos recálculos de la misma orden no se pisen. Introducido en E3.
- **Modelo analítico (D11):** se congela el **plan original** (`fechaPlaneadaOriginal`) aparte del
  vigente y del real, con `capturadoPor`/`capturadoEn` y `origenCaptura` (manual|evento) — base de los
  KPIs de F7.

- **Fecha (a–h):** 2026-06-22. Cerradas con Daniel; relayed por Gabriel.

---

### Decisiones de negocio de F6 (Calidad + EsMa) — 2026-06-24

Respuestas de **Daniel** (dueño / experto del negocio), relayed por Gabriel, **2026-06-24**, ANTES de
arrancar la fase (preguntas de fase juntas, regla CLAUDE.md §6). Detalle operativo en la ficha
`docs/hoja-de-ruta/F6-etapas.md`. Varias **revierten** el default que la ficha había propuesto — marcadas
abajo. La ubicación final del módulo de Calidad (D8) sigue por definir.

#### (a) — Resultado de la auditoría: MANUAL con comentarios, NO cálculo automático AQL (E2)
- **Decisión:** el auditor **marca los defectos** (captura fallas) pero **decide a mano** si la auditoría
  se aprueba o reprueba, **con comentarios/observaciones**. *(Esto REVIERTE el default de la ficha, que
  calculaba el veredicto automáticamente por nivel AQL.)*
- **Cómo queda:** el cálculo por nivel AQL se conserva como **sugerencia informativa** en pantalla (y
  como metadato para los KPIs de F7), **sin ser vinculante**. El campo `resultado` lo fija el usuario; el
  override deja de ser excepción y pasa a ser el flujo normal, todo con `Bitacora` (A7).
- **Consecuencia:** la **severidad** de los 40 defectos (crítico/mayor/menor) ya **no entra** en ningún
  veredicto — es pura categorización para KPIs; el arranque automático (inferida del AQL, "por revisar")
  es suficiente y Daniel la ajusta en pantalla.
- **Aplica en:** F6-E1 (catálogo/severidad) y F6-E2 (`capturarResultado`).

#### (b) — Tamaño de muestra automático con default; cambiarlo requiere autorización (E1/E2)
- **Decisión:** el **tamaño de muestra** se determina **automático según la cantidad de la orden**, con
  un **default** (tabla ISO 2859 nivel II, AQL 1.0/2.5/10 como datos). **Modificar** la muestra propuesta
  **requiere autorización** (permiso).
- **Cómo queda:** la tabla AQL sirve para **calcular la muestra**, no para el veredicto (ver (a)). El
  override de la muestra se gobierna con un permiso server-side (A4).
- **Aplica en:** F6-E1 (`servicioPlanesAQL` / tabla de muestreo) y F6-E2 (alta con muestra propuesta).

#### (c) — Misma exigencia para todos: un solo plan, sin asignación por cliente/producto (E1)
- **Decisión:** la **misma exigencia** aplica a **todos los clientes y todos los productos** → **un solo
  plan default** del sistema. *(REVIERTE/simplifica el default de la ficha, que preveía asignar el plan
  por cliente y/o tipo de producto con un resolver en cascada.)*
- **Cómo queda:** se **cae** la tabla de asignación de planes y el resolver cliente→tipo→default; queda
  el plan único. Esto cierra el supuesto (7) de la ficha **para la tabla de muestreo** (el "tipo de
  producto" sigue vivo, pero por (d), para filtrar defectos, no para el plan).
- **Aplica en:** F6-E1.

#### (d) — Defectos por tipo de producto: catálogo nuevo, etiquetado, tipo heredado del modelo (E1/E2)
- **Decisión:** los defectos **se cargan**, pero **cada tipo de producto puede tener defectos distintos**.
  Solución acordada (propuesta del equipo + confirmación de Gabriel relayando a Daniel):
  - Catálogo nuevo **"Tipo de producto"**, **corto y editable** (arranca con una lista chica y se agranda
    sobre la marcha).
  - Cada **defecto se etiqueta** por tipo de producto donde aplica, más una marca **"general"** para los
    que aplican a cualquier producto.
  - El tipo de producto **viene del modelo por default** (se define una vez y se hereda a sus órdenes),
    con **override en la auditoría** como red de seguridad; el alta pre-carga los defectos del tipo + los
    generales y el auditor siempre puede agregar cualquier defecto a mano.
- **Pendiente operativo (no bloquea):** Daniel entrega la **lista inicial** de tipos de producto; mientras
  tanto se siembra una corta y editable.
- **Aplica en:** F6-E1 (catálogo `TipoProducto` + etiqueta en `DefectoCatalogo` + campo en `Modelo`) y
  F6-E2 (pre-carga por tipo).

#### (e) — Cargo de estampado a su propio precio (corrige bug v1) (E4)
- **Decisión:** el cargo de **estampado** se valúa con **su propio precio** (`AplicacionOrd`), **determinado
  en cada orden de producción** y que **puede variar de orden a orden** aun con el mismo estampado.
  Confirma el **fix del bug v1** (`EsMaRecibosSemEstCon` calculaba el importe con `MaquilaOrd`, el precio
  de costura). Cierra la consulta (a) de las notas de la ficha.
- **Aplica en:** F6-E4 (`servicioCargos.validar`).

#### (f) — Orden "pagada" derivada + forzar estatus + segundas sin costo (E4)
- **Decisión:** una orden se marca **pagada en automático** cuando **todos sus cargos** están pagados
  (derivada, D3), **pero**:
  - se admite una **casilla para forzar el estatus** en **excepciones** (override manual auditado);
  - las **"segundas"** (prendas reclasificadas como defectuosas) **a veces no se pagan** al maquilero →
    se debe poder **meterlas sin costo** (cargo en cero / excluidas del pago).
- **Cómo queda:** ajusta el supuesto (5) de la ficha (era "derivada, sin marca manual"). Liga
  **Calidad↔EsMa**: lo reclasificado a 2ª en una auditoría (E2) alimenta el "sin costo" del cargo.
- **Aplica en:** F6-E4 (`Orden.pagada` derivada + override; cargo con segundas sin costo).

#### (g) — Pagos duplicados: BLOQUEAR vía "prendas por pagar", no solo avisar (E4)
- **Decisión:** los pagos se ligan al **sistema de recibos**: al pagar se **descuentan las prendas
  pagadas** (quedan visibles como ya pagadas) y si se intenta **re-pagar lo mismo, arroja error**. El
  modelo es de **"prendas por pagar"**: cada cargo/prenda tiene saldo por pagar, pagar lo consume, y
  pagar de nuevo lo ya pagado se bloquea. *(REFUERZA el default de la ficha, que solo "advertía" por
  mismo maquilero+monto en ventana corta — ahora es bloqueo estructural, pagos aplicados contra cargos.)*
- **Aplica en:** F6-E4 (`servicioPagos`: pago ligado a cargos; antidoble-pago duro).

#### (h) — Recibo: pagador FR Moda; con/sin factura por proveedor; "ambos" → dos estados de cuenta (E4/E5)
- **Decisión:** el pagador del recibo es **FR Moda siempre** (desde la **config de empresa**, A9 — no el
  "SR. DANIEL MASRI" hardcodeado del reporte viejo). La modalidad **con factura / sin factura** se
  **determina por proveedor**; un proveedor puede operar **de las dos maneras** y en ese caso debe tener
  **dos estados de cuenta** (uno facturado, uno no facturado).
- **Cómo queda:** flag **`conFactura`** en cada movimiento de EsMa + atributo de **modalidad de
  facturación** en el **proveedor** (R15/F1: solo-con / solo-sin / ambos); el estado de cuenta de E5 se
  **segmenta** por factura (para "ambos", dos saldos corrientes separados).
- **Aplica en:** F6-E4 (modelo + recibo R9) y F6-E5 (estado de cuenta segmentado).

- **Fecha (a–h):** 2026-06-24. Cerradas con Daniel; relayed por Gabriel.

#### (i) PT ligado a la ORDEN de producción en el inventario

- **Contexto:** al construir la reclasificación Primeras↔Segundas de la auditoría (E2), esta operaba sobre el stock del **modelo** (el kardex PT era por modelo×color×talla×almacén, sin orden). Daniel: *"es importante que la mercancía esté ligada a la orden de producción en el inventario."*
- **Decisión:** el inventario de Producto Terminado lleva la **orden como dimensión**. Técnicamente: `movimiento_det_pt.idOrden` (NULLABLE) + la vista `existencia_pt` agrupa por orden; los flujos que conocen la orden la pueblan (recibo de maquila, entrega a cliente, reclasificación de auditoría); los que no (movimientos/traspasos manuales, ETL histórico) quedan en el **bucket `idOrden IS NULL`**. La **reclasificación de la auditoría opera solo sobre las prendas de la orden auditada**, no del modelo entero. Esto **restaura** el comportamiento de v1 (`IPT_Modelos.IdOrdenes`), que se había perdido al aplanar el ETL de F3-E6 por `NumMod`.
- **Consecuencia intencional:** una entrega ahora se valida contra el stock **de esa orden**; el PT histórico/manual (bucket sin orden) no se entrega "por orden" (habría que ligarlo antes). Enriquecer el **histórico** por orden (re-ETL desde `IPT_Modelos.IdOrdenes`) queda **pendiente para F9** (no bloquea).
- **Aplica en:** F6-E2 (reclasificación por orden) + F3 (motor kardex, recibo, entrega, existencias/pantallas) — cambio "PT por orden", documentado en **ADR-0014** (enmienda ADR-0010).

#### (j) Reclasificar Primeras/Segundas es INDEPENDIENTE del veredicto de la auditoría

- **Decisión:** reclasificar prendas a Segundas **no** exige que la auditoría esté reprobada. Daniel: *"siempre van a haber prendas de segunda; siempre que se reciben las prendas deben venir clasificadas primeras/segundas, aunque la auditoría esté aprobada."* La clasificación primaria ocurre al **recibir** (recibo de maquila, F3); la reclasificación de la auditoría es un ajuste que puede hacerse con cualquier estado del veredicto. **Confirma** el comportamiento ya construido en E2.
- **Aplica en:** F6-E2 (reclasificación).

- **Fecha (i–j):** 2026-06-27, respondidas por Daniel (relayed por Gabriel); (i) implementada como el cambio "PT por orden" el 2026-07-01.

---

### Hallazgos y decisiones del ETL de F6-E6 (cierre de fase) — 2026-07-02

Tomadas por el equipo al construir el ETL del histórico de Calidad y EsMa + el reporte de cuadre. Las marcadas **(a ratificar con Daniel)** son defaults seguros o refinamientos; no bloquean el cierre de F6 pero conviene confirmarlas antes de F9 (corte de go-live).

#### (E6.1) — El gap de estampadores de F3-E6 era un BUG del loader, NO proveedores faltantes — RESUELTO
- **Contexto:** la decisión `§F3-E6 (a)` dejó pendiente incluir ~1,251 cargos EsMa de estampadores cuyo `IdMaquileros` "no mapeaba a un `Proveedor` de v2", sospechando que faltaba migrar un catálogo de proveedores.
- **Causa raíz (verificada con los CSV reales):** de 1,252 cargos `EsMa_Recibos.EsEstampado=1`, **1,251 apuntan a maquileros con `Proceso=1`** (maquileros de costura que TAMBIÉN hacen estampado) que **SÍ existen** en `Maquileros.csv`; 0 apuntan al catálogo aparte de 44 `Estampadores`. El loader `esma-cargos.ts` buscaba el `IdMaquileros` de la cabecera EsMa en el mapa de **Estampadores** cuando `EsEstampado=1` → no resolvía. Era un **bug de mapeo**, no datos faltantes.
- **Decisión/fix:** para `EsEstampado=1` se resuelve por `Proveedor:IdMaquileros` (fallback a estampadores). Recupera 1,251 cargos; **1 huérfano real** (`IdEsMa_Recibos=5811`, sin `IdMaquileros`) se LISTA. **NO se extendió la migración de proveedores** (la deuda de `§F3-E6 (a)` queda cerrada por esta vía). El `idTipoProceso` del cargo sigue siendo estampado.
- **Refinamiento (a ratificar con Daniel, no bloquea):** un maquilero `Proceso=1` puede quedar en v2 solo con rol `maquila-costura` (sin `estampado`) → afecta el filtro de la UI de EsMa por tipo costura/estampado, no la validez del cargo. Si Daniel quiere que aparezcan al filtrar "estampado", se añade el rol `estampado` a los `Proceso=1` en un re-ETL de proveedores (F9).
- **Aplica en:** F6-E6 (ETL EsMa) y un posible refinamiento de roles de proveedor en F10.

#### (E6.2) — Modo migración SIN efectos derivados (auditorías y pagos)
- **Decisión:** el histórico se carga por un modo-migración de dominio que NO dispara efectos derivados (consistente con F3-E6/F5-E7): `crearAuditoriaMigrada` **no publica el evento de RC** (evita 488 auto-avances) y **preserva el folio `numAuditoria`** recalibrando la secuencia A3 al final; los **5,935 pagos históricos se migran LIBRES** (sin aplicaciones a cargos, sin `pg_advisory_xact_lock`, sin recomputar `Orden.pagada`) — el esquema de E4 dejó los pagos sin aplicaciones permitidos a propósito para esto.
- **Aplica en:** F6-E6 (dominio `calidad/auditorias.ts` y `esma/migracion.ts`).

#### (E6.3) — Mapeos y defaults del histórico (a ratificar con Daniel)
- **Severidad de defectos:** v1 no la tiene → INFERIDA del AQL (1→crítico, 2.5→mayor, 10→menor), marcada "para revisión". Es metadato, NO veredicto (decisión (a)). `aplicaGeneral=true` para los 40 (v1 no tiene tipo de producto; se etiquetan a mano después, decisión (d)).
- **Usuarios elaboró/auditor** de las auditorías: se preservan como TEXTO del id viejo (sin FK, ADR-0005); remapeables cuando F10 migre usuarios.
- **`estadoRevision`** de movimientos EsMa: abonos/descuentos → `revisado` (histórico ya conciliado, v1 no traía bandera); pagos por `RevisionPendienteP`. **`conFactura=null`** en todo el histórico (v1 no tiene el flag de facturación).
- **Empresa** de los movimientos planos (abono/desc/pago, que no cuelgan de orden): se toma la del histórico EsMa (una sola empresa activa, consistente con "empresas viejas no migradas").
- **Pares `(auditoría,defecto)` duplicados** del viejo → fusionados sumando fallas (defensa del `@@unique`).
- **Aplica en:** F6-E6.

#### (E6.4) — Cuadre de saldos: v1 comparable vs v2, diferencias LISTADAS nunca corregidas
- **Decisión:** el reporte de cuadre (`cuadre-f6.ts`) calcula el saldo por maquilero con la MISMA fórmula derivada del dominio (`saldoDeMaquilero`, D3: Σcargos validado no-sinCosto + Σabonos − Σpagos − Σdescuentos, ceronulo) y compara contra un v1 comparable; las diferencias sistemáticas (cargos de órdenes no migradas, refs de maquilero de empresas viejas, cargos con `IdEsMa=0`) se **LISTAN como inconsistencias de origen**, nunca se corrigen (plan §7). El criterio de salida "EsMa cuadra contra los recibos del periodo" se valida con la conciliación recibido-vs-cargado sobre un periodo histórico, EN VIVO en `prueba`.
- **Aplica en:** F6-E6 (criterio de salida de la fase).

- **Fecha (E6.1–E6.4):** 2026-07-02.

---

### Hallazgos y decisiones del ETL de F7-E6 (cierre de fase) — 2026-07-03

Tomadas por el equipo al construir el ETL del histórico de **Costos + Indicadores** y el reporte de cuadre. Consistentes con **D2** (cerrada con Daniel 2026-07-02). Las marcadas **(a ratificar con Daniel)** son defaults seguros o refinamientos; no bloquean el cierre de F7 pero conviene confirmarlas antes de F9.

#### (F7-E6.1) — EDR histórico NO se migra; costeos SÍ (D2#11)
- El ETL NO toca `EdoResult`/`EdoResultDet` (verificado por grep en el diff). Solo migra **costeos** (`CostoOrd`, 2,513) e **indicadores** completos. Consistente con **D2 punto 11** (el EDR arranca 2026).

#### (F7-E6.2) — Regalía fuera del costo (D2): el delta v1−v2 es ESPERADO y se LISTA
- Verificado empíricamente sobre `CostoOrd.csv`: el `Costo` viejo **SÍ incluía** la regalía (305/362 filas con `RegaliasCost`≠0 casan con-regalía, 0 sin-regalía; 57 no casan por inconsistencias del dato viejo, LISTADAS). Mapeo D2: `telaCost←TelaCost`, `aviosCost←HabCost`, `procesosCost←MaquilaCost+BordCost`; **`RegaliasCost` NO se migra** → `costoTotal` v2 = `Costo` viejo − `RegaliasCost`. El delta = Σ `RegaliasCost` sale en el cuadre como **ESPERADO por diseño**, nunca corregido en silencio (§7); el `Costo` viejo se preserva en `MapeoMigracion` para trazabilidad.
- **Aplica en:** F7-E6 (`etl-costos`, `cuadre-f7`).

#### (F7-E6.3) — Cíclico histórico Proscai en modo migración (D6), SIN cambio de esquema
- `crearInventarioCiclicoMigrado` (nuevo, `dominio/indicadores/migracion.ts`): registros `cerrado`, `cantTeorica=CantProscai` (**origen externo, NO comparable al kardex v2**), `cantReal=CantReal`, **SIN ajuste de kardex** (no toca existencias ni `existencia_pt`), sentinelas color/talla `(sin especificar)` + almacén `(Migración Proscai)` **INACTIVO**, `idOrden` NULL, **1 encabezado por fila** (fiel a la bitácora plana vieja e idempotencia limpia). La bandeja viva `listarInventariosCiclicos` filtra `almacen:{activo:true}` → los ~542 históricos NO tapan la operación pero siguen 100% consultables por detalle/exactitud y los cuenta el cuadre.
- **(a ratificar con Daniel):** granularidad 1:1 por fila vs. agrupar por fecha.

#### (F7-E6.4) — Preservación de usuario histórico (D11) y omisiones LISTADAS
- Fichas `revisorId` y muestrarios `solicitanteId` se preservan como el `id` del usuario viejo (texto sin FK, ADR-0005; F10 remapea), mismo precedente que F5 (`capturadoPor`). Filas no mapeadas se LISTAN, nunca se inventan: órdenes sin mapeo de F2, `noCostear`, persona/actividad sin mapeo, ~20 registros de productividad con horas fuera de rango (0/>24), `ModeloIC` sin match por código, y los **clientes-texto de muestrarios "Walmart"(4)/"Soriana"(1) se OMITEN** (no se crean clientes desde el ETL).
- **(a ratificar con Daniel):** si quiere esos 5 muestrarios, se crea primero el cliente en el catálogo.
- **Aplica en:** F7-E6 (todos los loaders de indicadores).

- **Fecha (F7-E6.1–F7-E6.4):** 2026-07-03.
