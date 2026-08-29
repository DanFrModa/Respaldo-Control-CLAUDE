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
| D14 | General / UI (rediseño) | **Dictámenes operativos del rediseño (Daniel, 2026-07-10).** (a) **"Comprometido/disponible" NO existe** como concepto del negocio (venía del prototipo) — el inventario muestra solo la existencia real (kardex, D3). (b) **NO se manejan stocks mínimos de nada** (todo se pide sobre pedido, contra órdenes de producción — coherente con Make-to-Order): sin barra de "Nivel" ni alertas de reposición. (c) **Los colores NO son atributo del modelo**: se capturan al hacer la OP y el inventario los hereda de ella — se omite la columna de colores/swatches en el catálogo de Modelos. (d) **Flujo del auditor**: habrá usuarios auditores con un formato para capturar auditorías con **fotos de los hallazgos** y un **reporte impreso para dejar copia al maquilero** — **ese formato NO está diseñado aún**; no se construye hasta que Daniel lo diseñe (ver REQUISITOS-NUEVOS). | ✅ Registrada |
| D15 | 14 — Finanzas (arranque F9) | **Decisiones de arranque de F9 (2026-07-10).** (a) **Modelo del tercero** (Gabriel): el movimiento de cuenta corriente **referencia a Cliente o Proveedor existentes** (tipo + id), SIN tabla "Tercero" polimórfica nueva — el Proveedor ya unifica maquilero/estampador vía roles (R15). (b) **Historia de las 6 empresas viejas** (2005–2012): NO se rescata por ahora (los 78 saldos EsMa descuadrados ~−11M quedan explicados en reporte); se decide antes del go-live (F10). (c) **Arranque de CxC/CxP**: se pasan los **saldos actuales CON el desglose de las facturas por pagar** (cada factura pendiente = un movimiento con su fecha, para que el aging funcione desde el día 1); Daniel verá cómo sacarlo de SINUBE — **el ETL se construye y queda listo, pero NO se corre hasta tener los archivos**. (d) **Antigüedad de saldos**: se define el **plazo de crédito por Cliente y por Proveedor** (días) para derivar por-vencer/vencido, y los **cortes del reporte son configurables** (1–30, 31–60, etc.), no fijos. *(Implementado: Proveedor.diasCredito ya existía R15; Cliente.diasCredito en F9-E4; cortes configurables por empresa — `ConfiguracionEmpresa.agingLimite1/2`, editables en Administración › Empresas › Configuración — en F9-E5.)* | ✅ Registrada |

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

#### (Post-F9.1) — Auto-avance RC completo: momentos de disparo de los eventos nuevos (defaults, a ratificar con Daniel)
Al cerrar los emisores que faltaban (los ~18/20 automáticos del prototipo §4.9), se fijaron estos **momentos de disparo** como default:
- **"Orden de compra tela" (`compraTela`) se completa al AUTORIZAR la OC** (no al crearla ni al recibir el material — recibir ya tiene su propio proceso `recepcion-tela`). Cancelar la OC lo des-completa.
- **"Surtido de avíos" (`surtidoAvios`) se completa al CONFIRMAR la nota de salida** con líneas de avío de esa orden. Cancelar la nota lo des-completa.
- **"Auditoría de Corte" (`auditoriaCorte`):** se agregó el tipo **`corte`** al catálogo de tipos de auditoría de Calidad (antes solo en-piso/final); el proceso se completa cuando hay una auditoría de corte APROBADA viva de la orden.
- **Hitos capturados a mano (`HitoOrden`):** revisión de OP, autorización de fit, tono de tela, avíos, empaque y **autorización de arte** no nacen de ningún documento del sistema → se capturan como **hito de la orden** (quién/cuándo, cancelación con motivo) en el detalle de la orden, y ese registro dispara el auto-avance. La completitud es **por presencia** (sin cantidades). El hito de ARTE cierra el hueco latente de F5-E1 (`autorizacion-arte` era automático pero nadie emitía su evento).
- Todo con la mecánica vigente de F5-E6: evento en la MISMA tx (outbox), re-evaluación idempotente del estado físico, cancelar des-completa (decisión f), el automático manda sobre lo manual (decisión e).
- **Aplica en:** remate post-F9 "emisores de eventos RC" (11-jul-2026).
- **Fecha:** 2026-07-11.

#### (Post-F9.2) — Importador de OC del cliente por PDF: reglas de C&A (dictadas por DANIEL en vivo, 12-jul-2026)
Daniel entró a la sesión simulando la operación real y dictó el flujo del importador por PDF (empezando por **C&A**, con su OC real 620884 como caso). **Estas NO son defaults del equipo: las definió el dueño en persona.**

- **La OC del cliente VIVE en la orden:** cada PDF importado queda **adjunto a su orden de producción** ("deja esas órdenes de compra viviendo siempre en la OP y/o en el pedido"). **Varios PDFs subidos juntos = UN pedido interno**; cada PDF = **1 renglón del pedido + 1 orden de producción**.
- **Referencia del cliente (D7) para C&A = el NÚMERO DE ORDEN de su OC** (ej. 620884) — es LA referencia principal (columna "Pedido cliente" del Centro, panel, búsqueda e impreso). El **Modelo ID** de C&A (ej. 3138277), el Código único, la Semana y la **Sub División** quedan como referencias/campos **adicionales** informativos. La **División ES el departamento** del cliente; la Sub División es un campo **variable solo de C&A** (cada cliente tendrá sus propios campos variables).
- **Liga de modelos:** el Modelo ID de C&A ≠ modelo interno. El usuario liga la primera vez y el sistema **APRENDE** (`ClienteModeloLiga`); en importaciones siguientes lo propone solo (solo modelos activos).
- **Los modelos internos NACEN al capturar pedidos nuevos** (flujo real de Daniel, agregado el mismo 12-jul en un 2º PR): la vista previa del importador permite **crear el modelo nuevo ahí mismo** — alta estándar prellenada con la Descripción Cliente; el usuario captura su código interno — validando duplicados: código repetido → **bloqueado** (unique del alta); Modelo ID ya ligado a otro modelo → **advertencia** (no bloqueo, Daniel decide). El modelo creado queda ligado y se aprende al confirmar. *Solo aplica al importador PDF: el importador Excel liga a Desarrollo (entidad distinta); su análogo sería "crear desarrollo" — consideración futura.*
- **Fecha de entrega** = el **INICIO** de la ventana de entrega de la OC.
- **Sobre-pedido POR CLIENTE (C&A = 7%):** C&A permite entregar hasta **+5%** del pedido; Daniel fabrica ese 5% **+2% de merma** → **~7%**, configurable por cliente (`PlantillaImportacion.porcentajeAdicional`, C&A=7, default 0). Reglas de cálculo:
  - **Tipo PACK** (la OC trae "Detalles PACK / SKU"): el 7% se aplica **al número de packs** — `round` al MÁS CERCANO — y la corrida se reconstruye con la **proporción del pack** (ej. Pack A 2-1-1-3-3-2: 119 packs ×1.07 = 127.33 → 127 packs → 254-127-127-381-381-254). **NUNCA talla por talla en tipo PACK** (rompería los packs completos).
  - **Tipo SKU** (piezas sueltas): round al más cercano **talla por talla**.
  - **SKU chico:** Daniel lo integra a mano al Pack A "según mida la situación" → la **vista previa es EDITABLE celda por celda** (el sistema propone; él decide). Con la 620884: propuesta 2,032 pzas vs 1,903 pedidas.
  - **El renglón del pedido interno conserva las cantidades ORIGINALES del cliente** (lo contractual); el sobre-pedido vive **SOLO en la matriz de la OP** (lo que se manda fabricar).
- **SKU por talla SE GUARDA desde ya** (`Orden.packsCliente` jsonb: tabla SKU/talla/piezas + grupos de packs): no se usa para fabricar; es la base del futuro **módulo de EMPAQUE** (decisión explícita: guardarlo aunque empaque aún no exista).
- **Pantone = campo especial de la OP, por color** (`OrdenLinea.pantone`; antes Daniel lo metía en observaciones): opcional (muchas OCs no lo traen — la 620884 lo trae VACÍO), editable a mano, prefill del parser cuando la OC lo trae, visible en el impreso junto al color. A futuro, el **TechPack (TP) subido en Desarrollo** traerá el pantone (tarea aparte).
- **Fixture de pruebas:** la **OC real 620884 de C&A (con precios) SE QUEDA en el repo** como muestra del sistema — Daniel: "me da igual que la tengas" (repo privado).
- **Aplica en:** importador de OC por PDF (rama `tarea/importador-pdf-cya`); las plantillas de otros clientes se definirán igual, cliente por cliente.
- **Fecha:** 2026-07-12.

#### (Post-F9.3) — Importador PDF: UN RENGLÓN POR PACK + formato del nombre de color (DANIEL, 12-jul-2026) — 🔁 **REVERTIDA EN PARTE** por §Post-F9.129

> ⚠️ **Leer antes que lo de abajo (27-ago-2026).** El **"un renglón por pack"** de esta decisión
> **YA NO RIGE**: el mismo Daniel la revirtió en **§Post-F9.129** al ver que partía las compras de una
> misma orden (*"Negro A y Negro B es lo mismo"*). Hoy los packs se **suman en un solo renglón de
> color**, y su desglose vive en `Orden.packsCliente`. **Lo que SÍ sigue vigente** de esta decisión es
> el **formato del nombre del color** (Título: `AZUL INDIGO` → `Azul Indigo`, con acentos y guiones
> preservados) — sólo que ya no se le pega la letra del pack.

Revisando el importador en operación, Daniel precisó cómo deben nacer los renglones de la OP y cómo se escribe el color. **Definido por el dueño sobre datos reales.**

- **Un renglón por pack (A, B, C…):** cada pack va en **su propio renglón** de la matriz color×talla, **NO** todo junto — porque **se corta por separado** (cada pack lleva **distintas proporciones** de tallas). Referencia que dio Daniel: la orden vieja **4868**, que trae `Azul Indigo A` y `Azul Indigo B` como dos renglones con corridas distintas (A = corrida completa; B = solo tallas de en medio). El sobre-pedido (Post-F9.2) NO cambia la ESTRUCTURA de renglones, solo las cantidades → una OC con 3 packs siempre produce 3 renglones, aun a 0%.
- **Formato del nombre de color = `{Base} {LETRA}`:** el nombre del color en **Título** (primera letra de **cada palabra** en Mayúscula, el resto en minúscula: `AZUL INDIGO` → `Azul Indigo`) y la **letra del pack SIEMPRE en MAYÚSCULA** (A, B, C…). Preserva acentos (`MARRÓN` → `Marrón`) y guiones (`AZUL-MARINO` → `Azul-Marino`). Motivo de Daniel: "me gusta más cómo se ve".
- **Alcance del formato:** aplica **solo al importador de PDF** (helper `tituloColor`, backend y frontend en espejo — desde §Post-F9.129 lo usan `colorDeLaOrden` en el backend y el rótulo del total de la vista previa en el frontend; las funciones viejas `componerColor`/`componerColorUI`, que pegaban la letra del pack, ya no existen: hoy son `colorDeLaOrden` y `etiquetaPack`). La normalización global del catálogo (`normalizarNombreColor`) **NO** toca mayúsculas: un color que **ya existe** en el catálogo (aunque esté en MAYÚSCULAS) se **reutiliza tal cual** (case-insensitive), **no se renombra**; solo los colores **nuevos** que crea el importador nacen en Título. Renombrar en masa los colores viejos sería una limpieza aparte (no pedida).
- **Aplica en:** importador de OC por PDF (rama `tarea/importador-renglon-por-pack`).
- **Fecha:** 2026-07-12.

#### (Post-F9.4) — Estado de la orden AUTOMÁTICO y la bandera "lleva arte" (DANIEL, 26-jul-2026)

Daniel preguntó de dónde salía el estado `completa`/`incompleta` de la orden: *"El estado de la orden (completa, incompleta) no sé en base a qué existe. En CONTROL viejo existía, pero está en desuso. Acá podríamos definirla como completa cuando ya tenga los avíos, los artes. De manera automática se pone como completa."* Se le propuso la regla con el matiz de las prendas sin arte y **eligió "tallas + avíos, y arte si aplica"**.

- **La orden se marca COMPLETA sola** cuando: (1) tiene su **matriz de tallas** capturada, (2) el **modelo tiene su receta de avíos** de producción, y (3) el **arte**, si el modelo lo lleva. Nadie marca nada a mano.
- **El arte, textual de Daniel:** *"por default sí lleva. A menos que la marques como que no lleva. Y de esa manera si no meten la información del arte, o no desmarcan la casilla, está como incompleto. Es decir, siempre hay que atender ese tema."* → bandera **`Modelo.llevaArte`, default `true`**, también para los ~miles de modelos migrados de Access. Casilla "Lleva arte" en la ficha del modelo. **Consecuencia querida:** muchas órdenes vivas quedan incompletas hasta capturar el arte o desmarcar la casilla.
- **El estado es INFORMATIVO, nunca una llave para operar** (decisión del lead al implementar, para que el punto anterior no pare la planta): ninguna pantalla de captura —corte, envío a maquila, recibo, entrega a cliente, salida de tela, nota de salida de tela, alta de auditoría— filtra ni bloquea por `completa`. Lo único que impide operar una orden es que esté **cancelada**.
- **DES-COMPLETAR está acotado:** una orden vuelve de `completa` a `capturada` **solo** al editar **su propia matriz** y **solo si aún no tiene producción** (ningún corte/envío vivo). Cambiar el catálogo (receta de avíos, arte, la casilla) **solo puede COMPLETAR**, nunca degradar — para no des-completar de un clic el histórico ni sacar de los tableros una orden a medio producir.
- **La fecha en que quedó completa por primera vez** se sella una vez y **nunca se borra** (es el `FechaDet` del viejo); el estado no se deriva de ella.
- **Histórico migrado:** no se reescribe. El ETL carga `estado`/`fechaCompletada` explícitos y la regla entra cuando la orden se vuelve a tocar (o cuando se toca el catálogo de su modelo, y solo para completar).
- **Aplica en:** rama `claude/logo-pdf-estado`; regla en `backend/src/dominio/produccion/requisitos-orden.ts`; migración `20260726120000_modelo_lleva_arte`.
- **Fecha:** 2026-07-26.

#### (Post-F9.5) — El costo de MATERIALES de la orden sale de lo REALMENTE COMPRADO (DANIEL, 26-jul-2026)

Daniel señaló que el costo de materiales de la orden de producción se estaba calculando con la **receta del modelo × los precios de catálogo** (`Tela.precioSugerido` / `Avio.precioReferencia`) y que **eso no refleja la realidad**: al comprar cambian con frecuencia el **proveedor** y el **precio** de un material para esa orden concreta, y en v2 todo eso ya queda registrado en las **órdenes de compra ligadas a la orden de producción** (`OrdenCompraLinea.idOrden`, R7/F4). Sus tres definiciones, textuales:

1. **«Manda lo COMPRADO: la OC autorizada»** (no lo recibido, no lo surtido).
2. **«Los avíos genéricos se valúan al último precio de compra»** (los de stock, `Avio.esGenerico`, que no se compran por orden).
3. **«Cuando una compra surte a más de una orden, el costo se PRORRATEA.»**

Cómo quedó resuelto (motor `backend/src/dominio/costos/costo-real-compras.ts`):

- **Costo real de un material = atribución DIRECTA + valuación POR CONSUMO.**
  - **Directo** (regla 1) = Σ (cantidad × precio) de las líneas de OC **ligadas a la orden** cuya OC esté en `autorizada` / `recibida_parcial` / `recibida_total`. **Fuera**: `borrador`, `pendiente_autorizacion` y `cancelada`. Sin impuestos ni descuentos (la OC no los modela): el importe es literal.
  - **Por consumo** (reglas 2 y 3) = lo que la orden requiere y **no** tiene compra propia — `max(0, requerido − comprado)` — valuado al **último precio de compra** de ese material (la línea de OC autorizada+ más reciente **de la empresa activa**, sin importar a qué orden estuviera ligada). Ahí caen los genéricos y las compras grandes hechas sin ligar a una orden: **cada orden se lleva su parte en proporción a su consumo**, que es el prorrateo que pidió Daniel.
- **⚠️ Qué significa "último precio" (regla de negocio que Daniel puede querer discutir):** es el de la compra **MÁS RECIENTE** del material, **venga de la orden que venga — incluida la propia orden que se está costeando**. Ejemplo: la orden necesita 200 m de felpa, compró 120 m a $30 en junio, y en mayo hubo otra compra de felpa a $18 para otra orden. Los 80 m que faltan se valúan a **$30** (la compra de junio), no a $18. Razón: el "último precio" es el costo de **reponer hoy** ese material, y teniendo un precio fresco de la misma tela sería peor usar uno viejo. El desempate es determinista: **fecha de la OC descendente (las OC sin fecha van al final) → folio descendente → renglón descendente**; que la compra esté o no ligada a la orden **no influye** en cuál gana. *(Si Daniel prefiere que el remanente se valúe con la compra más reciente de OTRAS órdenes —ignorando la propia—, es un cambio de una línea en `leerUltimosPrecios`.)*
- **La SOBRE-COMPRA se costea COMPLETA** — aclaración de Daniel del mismo día, textual: *«si se cortaron 1,000 prendas pero la orden de etiquetas se hizo por 1,100, se debe costear —para efectos reales— el costo de la orden COMPLETA entre lo cortado. En este caso debería costar 1.1 etiquetas por prenda (o más bien su costo equivalente)»*. Por eso el importe **directo entra íntegro y sin tope**: NUNCA se recorta a `min(comprado, requerido)` ni se prorratea hacia abajo. El `max(0, requerido − comprado)` es SOLO para el remanente que la orden consume y no compró; si lo comprado excede al requerido ese remanente es 0 y ya. **Comprar de más es normal: no genera aviso de alarma.** El "1.1 por prenda" sale solo del `costoTotal ÷ cortado` (base de prorrateo, D2).
- **El "requerido" va SIEMPRE en la base del COSTEO: las piezas CORTADAS** (la misma del teórico), para que el real y el teórico sean comparables y el default no meta un sesgo invisible. El snapshot del MRP **no se usa tal cual**: se calcula sobre la receta `paraProduccion` y sobre las piezas **PEDIDAS**, así que (a) se **ESCALA** `× (cortadas ÷ pedidas)` y (b) se **RECONCILIA contra el BOM `paraCosto`** en los dos sentidos — un material `paraCosto` que no está en la explosión se costea con la receta **y avisa** (antes salía en **$0 sin decir nada**), y un material de la explosión que no es `paraCosto` **no se valúa** y avisa (su compra directa sí cuenta). Sin explosión: receta `paraCosto` × cortadas. Si la orden aún no se corta, el requerido es 0 y el real solo refleja lo comprado (con aviso). Se usa la cantidad **BRUTA** (antes del neteo contra stock): por eso el genérico sí se costea aunque salga del almacén.
- **Se calcula por separado para TELA y para AVÍOS** (son componentes distintos de `CostoOrden`). **Los PROCESOS no** (maquila/arte/bordados no se compran con OC de material).
- **Sin compras y sin historial de compra** de un material: cae al **precio de catálogo** y **avisa**; si tampoco hay catálogo, cuenta **0** y **avisa**. Nada se calla (mismo criterio de `avisos` que el MRP).
- **Compras LIBRES** (renglón de OC con `descripcionLibre`, sin material de catálogo) ligadas a la orden: se **reportan aparte** y **NO** se suman a tela ni a avíos (no hay forma de clasificarlas). Se avisa para capturarlas en "Otros" si corresponden.
- **Unidades (R1):** el importe directo no necesita conversión (cantidad × precio no cambia al convertir). La cantidad comprada y el último precio sí se normalizan a unidad de consumo con **exactamente la misma cascada que usa la recepción** (tela → factor 1; avío → `AvioProveedor.factorConversion` del proveedor de la OC → `Avio.factorConversion` → 1), para que el real cuadre con lo que entra al kardex. ⚠️ Cuando ese factor es **≠ 1** el renglón puede venir sesgado por un **defecto conocido de F4** (`mrp.generarOCDesdeExplosion` escribe la línea en unidad de consumo y la recepción la lee como presentación): el costo real **AVISA** por cada material afectado. La deuda está registrada en `HOJA-DE-RUTA.md` §4 con su reproducción exacta; **no** se corrigió aquí porque cambiar la semántica de la línea afectaría a las OC ya creadas.
- **Anti-subvaluación silenciosa (avisos):** además de los de arriba, se avisa cuando una **línea ligada trae precio en cero** (`OrdenCompraLinea.precio` admite 0, y el MRP escribe 0 cuando no hay precio sugerido), cuando un material **requerido acaba costando cero**, y cuando el real de un componente queda **por debajo de la MITAD** de su teórico (umbral 0.5: un buen precio negociado se mueve ±30 %, caer a menos de la mitad casi siempre son compras incompletas o sin precio). **Ningún aviso lleva una cifra de dinero dentro del texto**, para que no se filtre a un usuario con `costos.ver` pero sin `consultas.ver-importes`.
- **Solo cuenta la liga POR RENGLÓN** (`OrdenCompraLinea.idOrden`). La liga N:N de **encabezado** (`OrdenCompraOrden`, F4-E2) **no** se toma como compra directa: una OC ligada a 3 órdenes no dice cuánto de cada renglón es de cada orden, y repartirlo a ojo sería inventar. Esas compras entran igual al costo por la vía de la **valuación a último precio**, prorrateadas por consumo (regla 3 de Daniel). Si algún día se quiere atribución directa desde el encabezado, hay que capturar la liga en el renglón.
- **`RequerimientoOrden` no tiene índice único por (orden, material)**, así que las filas repetidas del mismo material se **fusionan** (suma de requeridos) al calcular. Se resolvió con dedupe defensivo en vez de un `@@unique` + migración, para no arriesgar que la migración truene con datos duplicados ya existentes en `prueba`.
- **El DEFAULT al guardar cambia** (el corazón de la petición): en el **PRIMER** costeo, si la orden **tiene compras ligadas**, `telaCost`/`aviosCost` caen al **REAL**; si no las tiene, siguen cayendo al **teórico** (comportamiento anterior intacto). `procesosCost` sigue al teórico. El usuario **siempre puede teclear su propio valor**. Y **lo ya costeado NO se mueve**: si la orden ya tenía costo, **omitir** un componente lo **conserva** (para borrarlo hay que mandar `null` explícito) — antes omitirlo lo pisaba con el default.
- **Trazabilidad:** el real se **congela** al guardar en `CostoOrden.telaReal`/`aviosReal` (columnas nuevas, nullable — el histórico queda en NULL) y la pantalla ofrece un **desglose por material**: qué se compró, a qué proveedor, a qué precio, y qué se valuó a último precio. El **ETL de migración** (`guardarCostoOrden` con `calcularReal: false`) **no** calcula ni congela el real: manda los tres componentes explícitos del CSV viejo, así que el real no se usaría para ningún default y solo serviría para sellar un número de HOY en una orden de los 90.
- **NO se tocó el EDR** (sigue recalculando desde `CostoOrden` al leer, D1) ni la regla del estado "completa" de la orden ni el MRP.
- **Aplica en:** rama `claude/costo-real-oc`; motor `backend/src/dominio/costos/costo-real-compras.ts`; endpoint `GET /api/costos/ordenes/{idOrden}/real`; migración `20260726140000_costo_orden_real_compras` (aditiva, sin permisos nuevos ni re-seed).
- **Fecha:** 2026-07-26.

#### (Post-F9.6) — Los campos numéricos NO se incrementan con el mouse ni con las flechas (DANIEL, 28-jul-2026)

Daniel, revisando la captura del avance de producción (WIP): *"En general en todos los campos para meter datos de corte, maquilas, incluso en la OP… pones una casilla con flechitas arriba y abajo para ir aumentando con el mouse… no funciona. Siempre se van a meter escribiendo o copiando los datos. Nunca se usarán esas flechitas. Quítalas por favor."*

- **Regla de UI, GLOBAL:** ningún campo numérico del sistema ofrece incremento por gesto. Las cantidades se **teclean o se pegan**, siempre. Aplica a los ~123 campos `number` (captura de corte/maquilas/recibos/entregas, matriz color×talla, precios, cantidades, configuración), no solo a los de producción.
- **Se apagan los TRES caminos del mismo control**, no solo el que se ve: (1) el **widget de flechitas**, con CSS; (2) la **rueda del mouse** sobre el campo enfocado; (3) las **flechas ↑/↓** del teclado. Los dos últimos son los peligrosos porque cambian la cantidad **en silencio** — el usuario creía estar haciendo scroll, o bajando al siguiente renglón de la matriz. El de las flechas **ya mordía**: la matriz de captura mueve el foco con ↑/↓ y solo cancelaba el incremento cuando había celda destino, así que en el **último renglón** un ↓ por costumbre dejaba 120 en 119 (hallazgo del reviewer, 28-jul).
- **Los campos siguen siendo `type="number"`** (no se pasaron a texto): eso conserva el **teclado numérico en el celular** y la validación del navegador. Lo único que se apaga es el incremento por gesto.
- **Trade-off aceptado en la rueda:** se le quita el **foco** al campo en vez de cancelar el evento, porque cancelarlo apagaría también el **scroll de la página** mientras el puntero esté encima de la celda — y quien gira la rueda quiere scrollear. El costo es que el siguiente **Tab** arranca desde el principio del documento; en las matrices se navega con ↑/↓ y con clic, no con Tab, y se recupera con un clic. Perder la posición del Tab se ve; una cantidad cambiada en silencio, no.
- **Aplica en:** rama `claude/cambios-prueba-xv95r8`; CSS en `frontend/src/index.css` (`@layer base`) + guarda global `frontend/src/lib/sin-incrementos-numericos.ts` (instalada en `main.tsx`). Frontend-only: sin migración, sin permisos, sin seed.
- **Fecha:** 2026-07-28.

#### (Post-F9.7) — Maquileros en el avance de producción: default en la entrega y CANDADO en el recibo (DANIEL, 28-jul-2026)

Daniel, sobre la captura del avance (WIP) dentro de la OP:

1. *"Si ya tengo un maquilero programado en la OP… que cuando le dé en entrega a maquila, me ponga por default el maquilero que ya estaba definido."*
2. *"En recibo de maquila me debe de filtrar solo a los maquileros que se le haya entregado el corte. **No puedo recibir un corte de un maquilero diferente al que se lo entregué.** Misma lógica para los maquileros de arte."*
3. *"…que quedamos que le vamos a cambiar los nombres a Arte (Entrega de Arte y Recibo de Arte)."*

- **El default de la entrega** sale de `Orden.idMaquilero` (el maquilero asignado en el encabezado de la OP, F2). Es un **default editable, no un candado**: si esta vez se manda a otro taller, se cambia. Solo aplica a **costura**: la OP **no** programa Prov. de Arte (el que se ve en el Centro de Órdenes sale del PRIMER envío de aplicación, no de una asignación).
- **El recibo es un CANDADO, no solo un filtro.** El saldo por recibir pasa a llevarse **POR MAQUILERO**, no por proceso: (a) la pantalla ofrece únicamente a los terceros con **entrega viva** de esa orden y proceso, con las piezas que le faltan devolver a cada uno, y la matriz se valida contra el pendiente de **ESE** maquilero; (b) el **servidor lo re-valida** al guardar (una lista filtrada se brinca llamando al API) y rechaza tanto recibirle a quien no se le entregó —diciendo a quién sí— como recibirle **más de lo que él tiene**.
  - **Lo que arregla:** antes se validaba `recibido ≤ enviado` del **proceso entero**. Con dos maquileros trabajando la misma orden, se le podía cargar a uno lo que devolvió el otro, y la cuenta de cada quien (EsMa, existencias en poder del maquilero) quedaba **falseada sin que nada lo impidiera**.
  - **Riesgo asumido, con los ojos abiertos:** si el histórico migrado tuviera recibos que no cuadran contra su entrega, una orden vieja podría rechazar un recibo nuevo. Se eligió el **bloqueo duro** (la regla textual de Daniel) sobre el aviso blando; el mensaje de error dice quién SÍ tiene entrega viva, así que el caso se diagnostica solo. **RATIFICADO por Gabriel (30-jul-2026):** *"El candado de no poder recibir de un maquilero que no haya recibido está bien. No debe de permitir recibir de alguien que no haya recibido el corte."* — la duda de bloqueo duro vs. aviso blando queda cerrada a favor del duro.
  - **Histórico migrado SIN maquilero** (el ETL crea envíos con `idTercero` NULL cuando el Access no lo traía): ahí no hay a quién recibirle, y las dos capas lo **dicen tal cual** —*"esta orden tiene entrega viva SIN maquilero (histórico migrado): hay que corregir esa entrega antes de poder recibir"*— en vez de responder "esta orden no tiene entregas", que era falso y dejaba al operador sin saber qué arreglar. La pantalla además **muestra** ese pendiente huérfano en vez de negar que exista. **CERRADO por Gabriel (30-jul-2026):** *"Los datos que hoy hay son de prueba. Se van a cargar nuevos datos. Si encuentras alguna inconsistencia, pues déjala así… asumiendo que es información vieja. Pero en lo nuevo no se permite que hayan inconsistencias."* → **NO se construye** una pantalla para asignarle maquilero a la entrega migrada, y **no hay que dimensionar nada**: el candado se queda como está (bloquea y explica), lo viejo inconsistente se deja quieto, y lo capturado en v2 no puede nacer inconsistente. Si una orden vieja queda trabada por eso, la salida sigue siendo cancelar la entrega y recapturarla — caso raro y aceptado.
  - **Se aplica en las DOS pantallas de recibo**, no solo en el panel de avance: `/produccion/recibos` (a donde manda la Ruta Crítica) usa el mismo desglose del servidor. Tener el mismo acto con dos reglas distintas era el hallazgo más grave de la revisión.
- **Vocabulario:** las etapas de aplicación pasan a llamarse **Entrega de Arte** y **Recibo de Arte**, y su proveedor, **Prov. de Arte** (completa el barrido de vocabulario del 24-jul). El **código** conserva `aplicacion` — es el concepto del dominio y los subtipos Bordado/Estampado siguen existiendo.
- **Aplica en:** rama `claude/cambios-prueba-xv95r8`; desglose `porMaquilero` derivado en servidor (`backend/src/dominio/produccion/wip.ts`, contrato `esquemas/wip.ts`), validación en `backend/src/dominio/produccion/recibos.ts`. SIN migración, SIN permisos nuevos, SIN seed.
- **Fecha:** 2026-07-28.

#### (Post-F9.8) — Al cortar se descarga la tela: enlace desde el avance de producción (DANIEL, 28-jul-2026)

Daniel: *"A la hora de cortar, es necesario descargar la tela de los inventarios… estaría bueno que en el mismo avance de producción podamos poner un enlace para descargar las telas cortadas. Del inventario hay dos maneras de sacar tela: 1- Por medio de una orden de producción, donde van relacionadas las salidas de todas las telas al consumo de la prenda de esa orden. 2- Por medio de una nota de salida abierta a lo que sea."*

- **Las dos vías que describe YA EXISTEN** desde F4 y no se duplican: la **salida de tela a una orden** (`/inventarios/telas/salida-orden`, F4-E1 — la única que descuenta tela ligándola a una OP y conserva la traza orden↔salida) y la **nota de salida abierta** (F4-E5, que no cuelga de una orden y por eso sigue viviendo en su módulo). Lo que faltaba era el **puente**: llegar ahí desde donde se registra el corte.
- **Lo que se agregó:** en la etapa de **Corte** del avance de producción, un enlace **"Descargar tela del inventario"** que abre esa pantalla **con la orden ya puesta** (deep-link), sin volver a buscarla. Gated por `inventario-telas.mover` (el mismo permiso de la pantalla destino).
- **NO se hizo automático a propósito:** el corte registra PIEZAS por color×talla y la salida de tela descuenta **metros/kilos por tela y lote**, que no se derivan del corte (dependen del tendido real, de la tela dispuesta y del lote del que se jaló). Inventarlo sería descuadrar el inventario con un número que nadie capturó. El enlace deja la decisión —y la captura— en manos de quien sabe.
- **Aplica en:** rama `claude/cambios-prueba-xv95r8`. Frontend-only: SIN migración, SIN permisos nuevos, SIN seed.
- **Fecha:** 2026-07-28.

#### (Post-F9.9) — Inventario de telas: unidad cerrada a kilos/metros, búsqueda por color y telas al tono (DANIEL, 30-jul-2026)

Daniel, enfocándose en consumos de tela e inventarios. Sus reglas, textuales:

1. *"Los rollos solo podrían ser informativos. Todos los inventarios se llevan en kilos o metros (depende de cómo se compren las telas). Los consumos se llevan en la misma medida de cómo se da de alta la tela."*
2. *"Todo lo que se compra en kilos se consume en kilos y lo que se compra en metros se consume en metros. La conversión podríamos ver más adelante si la ponemos solo como referencia."* Y: *"solo kilos y metros… no hay otras medidas."*
3. *"Se captura el consumo real… de ahí sale el consumo por prenda que deriva en el costo. Me gusta que al lado pongas el consumo estimado."*
4. *"Todo se descarga con captura de cantidad. Nada se estima, ni es un porcentaje… todo lleva una cantidad tecleada."*
5. *"Normalmente se descargan las telas al mismo tiempo cuando están relacionadas"* (la felpa y su cardigan al tono).
6. Sobrantes: *"solo damos salida de lo que se corta, no lo que viene en la partida. Bajo esa manera de trabajar no veo la necesidad de volver a meterlo al almacén."* → **NO hay devoluciones de tela al almacén**; nunca sale más de lo que se consumió.
7. Entradas: permitir **las dos** vías (con orden de compra y por factura/remisión sin OC), con **una cabecera por documento y N partidas** (cada una con su color y sus telas al tono).

**Lo que YA estaba y no había que construir:** el **lote** es una partida de UN color con **N telas dentro** (`Lote` + `LoteComponente`, decisión **D5**) — dos partidas de negro son dos lotes, cada uno con su cardigan al tono, y el inventario se lleva por **tela × lote × almacén**. También el **precio por color** (`TelaColor`) y el **precio por proveedor y por color** (`TelaProveedor`/`TelaProveedorColor`, F8-E1).

**Lo que se decidió y cambió (etapa A):**

- **`Tela.unidadMedida` deja de ser texto libre y pasa a enum `UnidadTela` = {KG, M}, NOT NULL.** Era `text` nullable, con una lista sugerida de seis valores (KILOGRAMO/YARDA/ROLLO/CONO…), y **venía vacía en TODAS las telas** (el ETL nunca la llenaba) — sin unidad, el stock, el consumo y el costo por prenda no significan nada. En el **alta es obligatoria y SIN default**: una tela de metros que naciera marcada en kilos ensuciaría todo en silencio; quien la da de alta lo sabe, el sistema no lo adivina. En la **edición** se puede cambiar de una a otra, pero **no vaciar**.
- **El ETL la carga del dato REAL del Access, no de una suposición:** `Telas.Medida` es la bandera de la unidad, y el mapeo está declarado literal en el formulario viejo `AgregarTelas` (`RowSource = "-1;\"Kilos\";0;\"Metros\""`), confirmado por `ExisTela` (*"Si=Kilos, No=Metros"*). En el volcado son **735 telas en kilos y 142 en metros**. Las telas que solo existen en `TelasDis` (no en `Telas`) no traen medida → quedan en KG y se reportan.
- **Migración de lo existente:** se respeta lo que estuviera capturado a mano (kg/kilo/m/metro…) y **todo lo demás** —NULL y cualquier texto no reconocido, p. ej. los `YARDA`/`ROLLO`/`CONO` del datalist viejo— queda en **KG**, sin dejar rastro (deliberado: Daniel confirmó que solo existen kilos y metros). Para corregir las 142 de metros **basta re-correr el ETL de catálogos**: el loader **reconcilia** la unidad de las telas ya migradas contra `Telas.Medida` y reporta cada corrección — no hay que borrar la base. *(Sin esa reconciliación el loader se salta las telas ya mapeadas y las dejaría mal para siempre; lo cazó el reviewer.)*
- **La búsqueda del catálogo de telas mira también el nombre de los COLORES** (y hay filtro duro `idColor`): en el almacén se busca "negro" más seguido que el nombre exacto de la tela.
- **Al descargar, el lote ofrece sus telas al tono:** elegido un lote, la pantalla muestra las OTRAS telas de esa partida con su disponible y un atajo para capturarlas seguidas, conservando el lote. **Se ofrecen, no se descuentan**: cada cantidad se teclea (regla 4). Las ya capturadas dejan de ofrecerse.
- **El botón "Consumo tela" de la OP** ahora abre la salida de tela **con esa orden puesta** (antes abría la pantalla en blanco).

**Lo que NO se hizo y por qué:** el **packing list de rollos** queda para el final y como **dato informativo del lote** (regla 1: la existencia se sigue llevando por lote, no por rollo). El **consumo por prenda** se mostrará en pantalla, pero **no se empuja solo al costeo** — eso toca el módulo de Costos y se hace aparte, con Daniel viéndolo. La **conversión kg↔m** no se construye (regla 2: "más adelante, solo como referencia").

- **Aplica en:** rama `claude/cambios-prueba-xv95r8`. Migración `20260730120000_unidad_tela` (automática). SIN permisos nuevos → **no requiere `SEED_ON_START`**.
- **Fecha:** 2026-07-30.

#### (Post-F9.10) — El PACK sale del nombre del color y se vuelve campo propio (DANIEL, 6-ago-2026) — ⏳ MITAD CONSTRUIDA, MITAD ABIERTA

> ⚖️ **AJUSTE (28-ago-2026) — el bullet de «Migración» de abajo (*partir los colores ya creados en
> color + pack*) queda SIN EFECTO para lo capturado en `prueba`:** *«Lo viejo ahorita es irrelevante»*
> ⇒ **§Post-F9.132**. Ese trabajo **no desaparece: cambia de sitio** y se vuelve requisito del **ETL de
> Access del arranque** ⇒ **§Post-F9.133**. Lo demás de esta entrada —el pack como **campo propio** que
> viaja al corte y al envío, y que el ETL y la **captura manual de OP** cumplan la misma regla que el
> importador de PDF— **sigue abierto y sigue siendo lo que hay que construir**.


> **Estado al 27-ago-2026.** La **primera mitad ✅ se construyó** en `V1-E8g` (**§Post-F9.129**): el
> importador de PDF dejó de componer el color con la letra del pack, y los packs se suman en un solo
> renglón de color. La **segunda mitad ⏳ sigue abierta**: el pack como **campo propio** que viaja al
> corte y al envío a maquila (y es opcional al recibir), más la **migración** de las órdenes que ya
> nacieron con `Negro A`/`Negro B`. Todo lo que sigue abajo describe esa parte pendiente.

**El problema.** C&A pide varios **tendidos** en una misma OP: el pack A con corrida 1-2-2-1 (CH-M-G-EG), el pack B con 1-1-1-2, etc. Daniel lo resuelve hoy metiendo el pack **dentro del nombre del color**: "Negro A", "Negro B". Y **v2 lo copió**: el importador de OC por PDF crea un renglón por pack con el color `{Base} {LETRA}` (`BLANCO A`/`B`/`C`) — a petición suya cuando se construyó (§Post-F9.2).

**Por qué hay que cambiarlo.** Daniel (6-ago-2026): *"Me gusta que exista un solo Negro y no esté fragmentado en miles de colores escritos de diferente manera."* Con el pack embebido en el color, cada OC de C&A **fabrica colores nuevos** ("NEGRO A", "NEGRO B", "NEGRO C"), y el inventario de producto terminado y los reportes dejan de poder sumar "todo lo negro". La prenda es la misma: un CH negro del pack A y uno del pack B son idénticos; lo que cambia es la corrida del tendido y cómo se empacan.

**Hasta dónde viaja el pack** (respuesta textual de Daniel): *"Creo que sí es importante que viaje el pack al menos en el corte, entrega a maquila… y que sea opcional al recibir. Lo ideal sería que sí entregue separado, pero en caso de que lo junten, poder recibirlo así también. Para el inventario ya deja de ser importante el pack. Hasta ahí queda, después ya no."*

| Etapa | El pack… |
| --- | --- |
| Matriz de la OP | **obligatorio** cuando la orden trae packs (renglón = color × pack) |
| Corte | **obligatorio** (cada tendido es de un pack) |
| Entrega a maquila | **obligatorio** |
| Recibo de maquila | **OPCIONAL** — se recibe por pack si el maquilero los separó, o sin pack si los juntó |
| Arte, entrega a cliente, inventario PT | **no aplica** — ahí ya es solo color |

- **Consecuencia de diseño a resolver al construir:** con el recibo opcional, el saldo "recibido ≤ enviado" no puede llevarse solo por pack. Un recibo SIN pack consume del saldo **agregado de todos los packs** de esa orden y proceso; uno CON pack, del suyo. Hay que definir (y probar) que las dos formas convivan sin permitir recibir de más en total.
- **Migración:** los colores ya creados con la convención vieja ("NEGRO A") hay que partirlos en color *NEGRO* + pack *A*, en la OP y en las etapas de corte/envío que ya existan. ~~El importador de PDF deja de componer el color con la letra.~~ ✅ **Esa última frase YA SE HIZO** en `V1-E8g` (§Post-F9.129); lo que sigue pendiente de este bullet es la **migración de lo ya capturado** — y mientras no exista, fusionar esos colores está **bloqueado** por el sistema, a propósito.
- **Alcance:** OP + `EtapaMovimientoDet` (corte/envío/recibo) + importador de PDF + matrices de captura. **NO** toca el kardex de PT.
- **Secuencia (Daniel):** *"Me parece bien terminar con las telas y luego retomas esto."* Va **después** de la reestructura de telas, como etapa propia.
- **Fecha:** 2026-08-06.

#### (Post-F9.11) — Reestructura de TELAS: tela padre + complemento, colores con pantone, y migración desde cero (DANIEL, 6-ago-2026)

Conversación completa con Daniel sobre consumos de tela e inventarios. Cierra el diseño de la reestructura (etapas A1 catálogo / A2 inventario).

**1. Identidad de la tela.** Hoy el nombre mezcla todo ("FelpaAlsa100"). Se parte en cuatro datos:

| Dato | Ejemplo | De dónde |
| --- | --- | --- |
| Tipo de tela | "Felpa" | La **categoría** que YA existe (se renombra a "Tipo de tela" en la UI; no se inventa campo nuevo) |
| Composición | "50% Algodón, 50% Poliéster" | **Catálogo nuevo** (petición textual: *"de un catálogo de composiciones para mantener misma congruencia"*) |
| Proveedor | Alsatex | El proveedor **dueño** del artículo |
| Nombre del proveedor | "Felpa Suiza" | Cómo le llama él |

Se lee de corrido: **Felpa · Alsatex · Felpa Suiza**. **Consecuencia:** la tela pasa a ser DE UN PROVEEDOR (la felpa de Alsatex y la de otro son telas distintas — correcto: no son el mismo rollo y no deben revolverse en el inventario). Eso deja casi de sobra el N:N `TelaProveedor` de F8; **NO se retira** (tocaría cotizaciones y listas de precios sin necesidad) — queda anotado para simplificar después. Proveedor **obligatorio en telas nuevas**, opcional en las 877 migradas (el viejo no lo traía como campo).

**2. El COMPLEMENTO es parte de la misma tela.** *"Es como parte de la misma tela para el manejo de todo. Es el mismo color, con el mismo pantone, parte de la misma tela padre… Hay que darle prioridad a que conviva como parte de la misma tela."*
- Una tela = **un cuerpo + un complemento OPCIONAL**, nombrados desde el alta ("Felpa" / "Cardigan"). Nunca más de uno.
- **Entradas y salidas siempre juntas**: un renglón, dos cantidades. (El sistema viejo ya lo hacía: `TelasColAlm.ExTela1/ExTela2` y `SalidasDet.TelaSal1/TelaSal2`.)
- **Comprar solo complemento** (pasa cuando se acaba el cardigan y se compra más, *"posiblemente de otro proveedor"*): es una entrada de esa MISMA tela y color con la cantidad del cuerpo en **0**, y su propia partida con su proveedor y factura. **No hace falta "ligar" nada.**
- ⚠️ **Por eso el consumo empareja por TELA+COLOR, no por partida:** el cuerpo puede salir de una partida y el complemento de otra. Cuando eso pase, la pantalla **avisa** (riesgo de tono) sin bloquear.

**3. Colores: hijos de la tela, no catálogo global.** Daniel, textual (6-ago-2026): *"No debería de haber un catálogo de colores. Debería ser un campo abierto. Chance estaría bien tener un nombre genérico del color, y un campo adicional con el pantone, en caso de que haya uno."* Nombre libre + **pantone**, con **dos precios** (cuerpo y complemento — *"el cardigan es otro precio que la tela"*). El pantone va en el color de la tela; dos partidas pueden traer tonos distintos del mismo pantone. Para no fragmentar, el campo sugiere los colores que **esa tela** ya tiene. **El catálogo global de `Color` NO se toca**: es el color de la PRENDA y lo exigen la matriz de la OP y todo el WIP (ver §Post-F9.10).

**4. Partidas.** Se identifican con **folio propio consecutivo** del sistema (secuencia atómica, A3) + el **número de lote/teñido del proveedor** como campo aparte, opcional y buscable (ese SÍ puede repetirse entre proveedores). Hoy la `clave` es texto único global y el auto-generado es ilegible (`LOTE-1-20260806-m1x2p3-a7f2`) — se corrige en A2. Daniel eligió explícitamente la opción de **partidas por lote** (con proveedor y factura) sobre la de "crear colores Negro/Negro 2".

**5. MIGRACIÓN — inventario desde cero.** *"Lo ideal va a ser partir de un inventario físico desde cero… hay muchos errores en el inventario."*
- **Existencias: CERO.** No se migra ni un movimiento de tela. El arranque es el **conteo físico** que capture FR Moda; el conteo YA trae el consumo adentro (lo que queda en el anaquel es lo que queda).
- **Catálogo: SE CONSERVA, sucio y depurable.** Borrarlo dejaría sin receta de telas al BOM de los modelos migrados y mudo al histórico de compras/notas. Las telas viejas se desactivan conforme dejen de usarse; las nuevas se dan de alta bien hechas.
- **Consumos históricos: SÍ se cargan** (2025-2026, ~400 órdenes), como **dato de la orden**: sin crear partidas y **sin tocar existencias** (mismo patrón anti-doble-conteo del histórico de producción de F3-E6). Las telas viejas quedan "solo para leer consumos viejos"; lo nuevo usa el catálogo nuevo.
- **Costo del consumo histórico: APROXIMADO y marcado como tal.** `Salidas`/`SalidasDet` del viejo traen la orden, la tela, el color y las dos cantidades — pero **no el precio**. Las cantidades son exactas; el costo se valúa con el precio del catálogo y la pantalla dice que es aproximado. *"El aproximado está perfecto."*
- **Por qué importa el consumo, más allá del costo** (Daniel): *"También por referencia cuando quiero hacer un nuevo modelo. Me sirve consultar cuánto se llevó alguna orden en particular."* → el consumo por orden tiene que quedar **consultable**, no solo alimentar el costeo.

**6. ⚠️ CORRECCIÓN A LO YA CONSTRUIDO — el costo de TELA sale del CONSUMO, no de la OC.** Daniel (6-ago): *"El costo por prenda de tela sí sale del consumo, no la de OC. De la OC salen los costos de los avíos pero no de las telas. Aparte es muy complicado sacar los costos de las OCs porque en una OC normalmente compro telas para varias OP. Sería imposible definir cuánto costó cada OP sin el consumo real."*
- Esto **refina §Post-F9.5** (26-jul, "manda lo comprado: la OC autorizada"), que hoy vale para **avíos** pero NO para telas.
- `dominio/costos/costo-real-compras.ts` valúa hoy la tela desde las líneas de OC, prorrateando entre órdenes por el consumo **teórico** de la receta. Para telas debe pasar a **consumo REAL**.
- **PENDIENTE, etapa propia del módulo de costos** — no se mezcla con la reestructura de telas.

**Secuencia acordada:** A1 (catálogo) → A2 (inventario) → entrada por factura/remisión → pantalla de stocks → packing list. El **pack** (§Post-F9.10) y la **corrección del costo de tela** van después.

**8. Decisiones que salieron al construir la ENTRADA de tela (etapa B1, 6-ago-2026 — derivadas de §Post-F9.9 punto 7; las tomó el lead dentro del margen de lo que Daniel ya decidió, se le confirman cuando pruebe):**
- **El COLOR es obligatorio al recibir una orden de compra de tela.** La línea de la OC no lo determina (se compra "felpa negra" pero el sistema necesita saber cuál color hijo). Antes de inventarlo, el sistema **lo exige** en la pantalla de recepción y el dominio rechaza la recepción sin él. Nunca se adivina un color.
- **El complemento NO cuenta contra lo pedido en la orden de compra.** El cardigan es el acompañante del mismo renglón; lo pedido se sigue midiendo por el cuerpo (si no, el MRP y la Ruta Crítica leerían mal el avance de la compra). Por la vía de OC **no** se recibe una entrega de solo complemento: ese caso entra por factura/remisión.
- **El documento de entrada tiene borrador.** Se captura, se le adjunta el PDF de la factura y se revisa **sin tocar el inventario**; hasta confirmarlo se crean las partidas y el movimiento. Cancelar una entrada ya confirmada **no borra nada**: registra el movimiento inverso (D3).
- **Factura repetida: avisa, no bloquea.** Si ya existe un documento vivo del mismo proveedor con el mismo número, la pantalla lo advierte y deja seguir (el número lo pone el proveedor y puede repetirse legítimamente). Importa porque el inventario arranca desde cero por conteo físico, justo por los errores del inventario viejo.
- **El precio del cardigan también se guarda en el kardex** (`costoUnitComplemento`), por las dos vías de entrada. Sin eso el complemento quedaba sin costo y la corrección del punto 6 (costo de tela por consumo) nacería incompleta.

**7. Remates del catálogo tras probarlo (DANIEL, 6-ago-2026, feedback textual sobre A1 en `prueba` — construidos como A1.1):**
- **Peso y ancho** de la tela: dos campos nuevos opcionales (*"Me faltó incluir un campo de peso y otro de ancho"*) — peso en gr/m², ancho en metros.
- **Favorita marcada por default** al dar de alta una tela nueva (solo el alta; editar no cambia).
- El ejemplo del alta de color es **"Negro"** (no "Marino Alsa 3040").
- **"¿Es tela de producción?" se OCULTA de la pantalla** (*"no entiendo la casilla"*): el dato queda en BD con su default `true` como legado del viejo; si algún día hace falta, se destapa.
- **"Tipo de componente" se RETIRA de la pantalla** (*"no sé si está siendo redundante"* — lo es): quedó superado por los nombres de cuerpo/complemento de la propia tela. Columna/enum quedan en BD como legado.
- **Nombre del complemento consistente**: al marcar "lleva complemento" se pre-llena **"Cardigan"** (editable — Daniel: el 99 % de las veces es cárdigan; mejor default que catálogo). Y el **nombre del cuerpo se propone desde el tipo de tela** (tipo "Felpa 50/50" → propone "Felpa"), sin pisar lo tecleado.
- **`Proveedor.nombreCorto`** (nuevo, opcional): BLOOM TEXTIL → "Bloom". Se usa para el nombre compuesto.
- **El nombre de la tela se ARMA solo** (*"me está sobrando el nombre… chance el nombre que aparezca debe de ser el compuesto"*): `nombre corto del proveedor + nombre del proveedor de la tela` → **"Bloom Felpa España"**. Editable (teclearlo lo protege; vaciarlo re-suelta el armado); sigue único global.

#### (Post-F9.12) — Los selectores de proveedor se acotan por ROL: "solo los proveedores de telas" (DANIEL, 7-ago-2026)

Daniel: *"Necesitamos definir en los atributos de proveedores los diferentes tipo (creo que ya estaba contemplado)… y en los inventarios de telas, solo debe de mostrar los proveedores de telas para poder dar de alta una nueva tela"*, y después: *"En control estaba definido así… los proveedores de tela son importantes para futuras consultas"* (en CONTROL viejo era el campo `Proveedores.TipoProv` = H/T/S).

**1. La clasificación YA existía — no se agrega nada al modelo.** Un proveedor trae **dos** clasificaciones, ambas capturables en su ficha y **ambas consultables** en la lista (hay filtro por tipo y filtro por rol):
- **Tipo** (una sola opción, el clasificador rápido heredado de `TipoProv`): `Telas` / `Avíos` / `Servicios` / `Sin clasificar`.
- **Roles / servicios** (multi-valor, R15 §4.1): `Vende telas`, `Vende avíos`, `Maquila (costura)`, `Corte`, `Estampado`, `Bordado`, `Lavado`, `Aplicación`, `Otros servicios`.

El ETL de terceros llena **las dos** de forma consistente (`TipoProv` T → tipo `TELAS` + rol `vende-telas`; H → `AVIOS` + `vende-avios`; S/vacío → `SERVICIOS` + `otros-servicios`), así que las **consultas históricas** por "proveedor de tela" funcionan por cualquiera de los dos caminos. Lo que faltaba no era el dato: era **usarlo para acotar los selectores**.

**2. El criterio para acotar es el ROL, no el tipo (decisión de Daniel).** Razones: el rol es **multi-valor** —un tercero que vende telas *y* avíos aparece en las dos pantallas, cosa que un `tipo` de un solo valor no permite— y es el **mismo criterio que ya usaba Producción** (Corte lista los de rol `corte`, Envío a maquila los de `maquila-costura`). El `tipo` se conserva como clasificador rápido y como filtro de consulta.

**3. Dónde se acota a `vende-telas`:**
- **Alta/edición de una tela del catálogo** (el "proveedor DUEÑO" que §Post-F9.11 volvió obligatorio) — es el "dar de alta una nueva tela" de la petición. La tela es DE quien la vende: nunca de un maquilero.
- **Entrada de tela por factura/remisión** (`CapturaEntradaTelaPagina`, etapa B1) — quien surte la partida.
- **Ajuste/inventario físico del flujo LEGADO por lote** (`AjusteMaterialesPagina`), por consistencia mientras siga vivo.

**4. En órdenes de compra el filtro va por lo que lleva la OC, y NUNCA bloquea.** Una OC tiene **un** proveedor en el encabezado, se captura **antes** que los renglones y sus renglones pueden mezclar telas, avíos y líneas libres. Decisión de Daniel: acotar **según los renglones capturados**, en vivo — solo telas → `vende-telas`; solo avíos → `vende-avios`; **mezclada o solo líneas libres → sin acotar** (una OC mixta es legítima y el filtro no debe estorbar una compra real).

**5. Regla dura de captura: el proveedor ya capturado se RESPETA siempre.** Si no cumple el rol vigente (típico al editar una OC vieja/migrada, o un documento cuyo proveedor no trae la casilla), **sigue apareciendo como opción** del selector en vez de desaparecer y perder el dato en silencio. El filtro es una ayuda de captura, no un candado retroactivo.

- **Lo que NO se acota:** los selectores de **CxP** (estado de cuenta e importación de CFDI) siguen mostrando a todos — una cuenta por pagar puede ser de cualquier tercero, no solo de quien vende material.
- **Efecto lateral a cuidar:** un proveedor de telas al que le falte la casilla `Vende telas` deja de aparecer en esas pantallas. Es el comportamiento pedido; se corrige marcándole el rol en su ficha.
- **Aplica en:** solo **frontend**. El API ya soportaba `GET /api/proveedores?rol=<id>` desde F1-E1B; hook nuevo `useProveedoresPorRol` (`frontend/src/api/proveedores.ts`) que centraliza el patrón. **SIN migración, SIN permisos nuevos, SIN seed.**
- **Fecha:** 2026-08-07.

#### (Post-F9.13) — Almacén de telas ligado a su CORTADOR, y el traspaso al taller (DANIEL, 7-ago-2026)

Daniel: *"En la sección de almacenes de telas, estaría bien que podamos ligar cada almacén de telas (opcional) a un cortador. Y entonces cuando seleccionemos a un cortador, automáticamente por default abre la ventana de descarga de tela con el almacén relacionado a ese cortador."* Y: *"También es muy importante hacer una pantalla de traspaso de telas entre almacenes. Ejemplo: recibo la tela en el almacén 'Naucalpan' (que es el principal) y de ahí le mando la tela a un cortador y en ese momento debo de hacer el movimiento entre almacenes al almacén del cortador para poder descargarlo de ese almacén."*

**1. La pantalla de traspaso YA EXISTÍA** (etapa A2, 6-ago): *Inventarios › Telas › Traspaso de telas por color*, con sus dos patas atómicas y la validación de no-negativo bajo lock. No se construyó una nueva —habría sido duplicar el mismo movimiento con dos reglas—, se **corrigió lo que la hacía inservible para este flujo**: listaba almacenes de PT y de avíos junto a los de tela, y no había forma de saber qué bodega era de qué taller.

**2. `Almacen.idCortador`** — liga OPCIONAL a un `Proveedor` con rol `corte`. Tres reglas, todas en dominio (A1/A4) y con mensajes que dicen qué hacer:
- **Solo almacenes de TELA.** En uno de PT o avíos la liga no significaría nada. Cambiar a PT/AVIO un almacén que ya tiene cortador se rechaza: primero se le quita la liga.
- **El tercero debe ser cortador de verdad** (activo + rol `corte`). Si no, el error dice *"márcale el rol Corte en su ficha de proveedor"* en vez de dejar al usuario adivinando.
- **Un cortador, un almacén** (índice único en BD + verificación previa que NOMBRA el almacén que ya lo tiene). Con dos almacenes por cortador, *"¿cuál es el almacén de este cortador?"* no tendría respuesta y el default de la descarga sería una moneda al aire.

**3. Los puentes desde la captura del corte.** *"Automáticamente por default abre la ventana"* se implementó como **el enlace que ya existía llevándose el dato**, no como una navegación que se dispara sola: con la matriz del corte a medio teclear, sacar al usuario de la pantalla sin que lo pida sería hostil (por eso el enlace ya preguntaba antes de salir, §Post-F9.8). Al elegir el cortador aparecen dos botones en el avance de producción:
- **"Descargar tela del inventario"** → salida a orden con la orden **y el almacén del cortador** ya puestos.
- **"Mandar tela al cortador"** (nuevo) → traspaso con el **destino** ya puesto. El **origen NO se adivina**: de qué bodega sale la tela es decisión de quien captura. Va junto a la descarga porque en el flujo de Daniel el traspaso la ANTECEDE.

El mismo puente de descarga se agregó a *Producción › Captura de corte* (la pantalla del menú), para no repetir la deuda de §Post-F9.7 donde una de las dos pantallas del mismo acto se quedó sin el default.

**4. Lo propuesto nunca pisa lo elegido.** El almacén se pre-selecciona **solo si el campo está vacío**, y una sola vez: si el usuario lo cambia o lo borra a propósito, no se le vuelve a poner. Un cortador **sin** almacén ligado simplemente no propone nada (no es un error).

- **Efecto lateral a cuidar:** los selectores de almacén de la salida y del traspaso de tela ahora **solo listan almacenes de tipo TELA**. Si alguna bodega de tela está capturada con otro tipo, hay que corregirle el tipo en *Administración › Almacenes* para que vuelva a aparecer.
- **Defecto propio encontrado y cerrado en la misma ronda:** la primera versión del efecto que resuelve el deep-link dependía de la lista de almacenes y llamaba a `navigate` dentro; con una identidad de datos nueva por render eso era un **bucle infinito** (lo cazó la prueba nueva del traspaso, que se colgó). Se cerró con un candado por `ref` en ambas pantallas.
- **Aplica en:** migración aditiva `20260807120000_almacen_cortador` (columna nullable + índice único + FK Restrict). **SIN permisos nuevos → no requiere `SEED_ON_START`.**
- **Fecha:** 2026-08-07.

#### (Post-F9.14) — La entrada de tela por factura, ligada a su ORDEN DE COMPRA (DANIEL, 7-ago-2026)

Daniel: *"También es muy importante que al dar entrada de tela de una factura, la relacionemos con la OC de esa tela. De esa manera amarramos que sea visible el recibo de la OC de la tela y se marca con estatus de recibido."*

Cierra la deuda (ii) que B1 dejó declarada: la entrada por factura no tocaba la orden de compra.

**1. UNA sola puerta para recibir tela (decisión de Daniel).** Había dos caminos —recepción desde la OC (F4) y entrada por factura (B1)— y hacerlos convivir permitía recibir la misma tela **dos veces**, una por cada uno, inflando el inventario sin que nada lo impidiera. Se eligió que la **factura sea la puerta**: `recibirCompra` **rechaza** los renglones de tela con un mensaje que dice a dónde ir; los **avíos y las líneas libres siguen recibiéndose desde la OC**, sin cambio.

**2. La liga es POR RENGLÓN, no por documento (decisión de Daniel).** `EntradaTelaLinea.idOrdenCompraLinea` (nullable). Así una misma factura puede amparar tela de **dos OCs distintas** y, en el mismo documento, tela **suelta** sin orden de compra — que es como facturan los proveedores. `NULL` sigue siendo un caso válido y frecuente.

**3. Confirmar la factura ES la recepción.** Al confirmar, los renglones con OC generan una `RecepcionCompra` **por cada OC surtida** (`recepciones_compra.id_entrada_tela` guarda de qué documento nació) con la MISMA contabilidad de F4: renglones contra `OrdenCompraLinea`, recálculo del estatus (R7 → `recibida_parcial`/`recibida_total`) y evento `material-recibido` al outbox, que es lo que hace avanzar la Ruta Crítica. **No mueve inventario otra vez**: reusa la partida y el movimiento de kardex que la entrada ya creó. Por eso la tela entra una vez al kardex y suma una vez a lo recibido.

**4. Cancelar la factura devuelve la OC a pendiente.** Las recepciones que generó se marcan **reversadas** (suave, D3 — nada se borra) y el estatus de cada OC se recalcula hacia atrás. El kardex lo neutraliza el inverso que ya hacía la cancelación; aquí no se toca dos veces.

**5. Validaciones al confirmar** (server-side, A1/A4), cada una con mensaje que dice qué revisar: el renglón de OC debe ser de **tela**; el **color** que llegó debe ser de la tela comprada; la OC debe ser del **mismo proveedor** que la factura; y debe estar en `autorizada`/`recibida_parcial` (decisión (b), igual que la otra puerta). Si algo falla, la transacción entera se revierte: no queda ni partida ni existencia.

**6. Ayuda de captura:** endpoint nuevo `GET /api/compras/lineas-tela-pendientes?idProveedor=` — los renglones de tela con pendiente de las OCs abiertas de ese proveedor (pendiente = pedido − recibido en recepciones activas, mismo criterio que el estatus). El selector de la captura solo ofrece los renglones **de la misma tela** del renglón que se está capturando, así que ligar felpa contra una OC de otra tela no se puede ni intentar.

- **Orden de locks (anti-interbloqueo):** el `pg_advisory_xact_lock` de cada OC se toma **al principio** de la transacción de confirmar/cancelar y en **orden ascendente de id** — el mismo orden que usa `recibirCompra` (primero la OC, después el inventario). Sin eso, las dos puertas podían tomarse los recursos en orden inverso y trabarse entre sí.
- **Efecto operativo a cuidar:** una OC de tela ya no se puede terminar de recibir desde *Compras › Recepción*. El renglón sigue **visible** ahí (para ver qué falta) pero deshabilitado, con la nota de a dónde ir.
- **Aplica en:** migración aditiva `20260807160000_entrada_tela_orden_compra` (dos columnas nullable + índices + FKs). **SIN permisos nuevos → no requiere `SEED_ON_START`.**
- **Fecha:** 2026-08-07.

#### (Post-F9.15) — Replanteo de la entrada de tela: se arranca desde la OC y la tela es del proveedor (DANIEL, 7-ago-2026)

Daniel, después de probar §Post-F9.14: *"El punto 3 no me gustó cómo quedó. Hay algo que me hace ruido. Cada proveedor de telas tiene sus telas definidas. No puedo meter una felpa alsatex en el proveedor bloom. Ahorita después de seleccionar el proveedor, me deja escoger cualquier tela del inventario. No está bien. Y la manera de relacionar la OC tampoco me gusta. Chance estaría mejor recibir las telas a partir de las OC. La buscamos ahí y damos la entrada desde allá."*

**1. La tela es DEL proveedor — era un defecto, no una decisión.** El catálogo ya guardaba el **proveedor dueño** desde A1 (§Post-F9.11: *"la felpa de Alsatex y la de otro son telas distintas"*), pero el listado de telas no sabía filtrar por él, así que el buscador ofrecía el catálogo entero. Se agregó el filtro `idProveedor` a `listarTelas` y el buscador de la captura lo usa. **Filtro ESTRICTO**: las telas migradas sin dueño NO aparecen — correcto, porque *"vamos a meter todas las telas desde cero; la migración solo va a servir para cargar los consumos… esas telas van a quedar en el olvido, solo informativas"* (Daniel, 7-ago-2026).

**2. El punto de partida es la ORDEN DE COMPRA, no la factura.** La versión de §Post-F9.14 obligaba a empezar por la factura y luego *buscar* a qué renglón de OC correspondía cada renglón — al revés de cómo se trabaja. Ahora en la OC hay un botón **"Dar entrada a la tela"** (gate `inventario-telas.mover`, visible solo en OC `autorizada`/`recibida_parcial` con renglones de tela) que abre la captura de la factura con:
- el **proveedor FIJO** (lo define la orden; cambiarlo dejaría los renglones ligados a otra OC — el campo queda deshabilitado y lo dice);
- el panel **"Pendiente de la orden de compra"**: un renglón por tela con lo que falta, cada uno con su botón **Capturar** que precarga tela + cantidad pendiente + precio de la OC + la liga.
- Lo único que queda por capturar es **el color que llegó** (y el lote), que es justo lo que la OC no define. Cantidades y precio son editables: lo que llegó puede no ser lo pedido.
  > ⭐⭐ **SUPERADO por §Post-F9.89 (V1-E3u, 22-ago-2026):** la OC **ya define el color**. La captura lo **preselecciona** desde el renglón de OC (y lo enseña en el panel de pendientes, con su pantone); sigue **editable** porque manda lo que de verdad llegó, y el confirmar **cuadra** los dos y lo dice si no coinciden. Lo que se conserva de esta decisión es el punto de partida y la contabilidad, no la frase *"la OC no lo define"*.

**Lo que NO cambió:** la contabilidad de §Post-F9.14 sigue intacta —la factura es la que mueve inventario, genera la recepción por OC, marca el estatus y avisa a la RC—; esto es **el punto de entrada**, no el mecanismo. El **selector "Renglón de OC" se retiró**: ya no hace falta buscar la liga porque viene de la orden. La captura **desde el menú** queda para la tela **suelta** (sin OC), y ahí no se pinta el panel.

- **El proveedor viaja en el enlace** (`state: { idOrdenCompra, idProveedor }`) en vez de releer la OC: la pantalla que manda ya lo tiene, y así el panel de pendientes se puede pedir de inmediato (necesita el proveedor).
- **Pendiente ACOTADO a esa OC:** `GET /api/compras/lineas-tela-pendientes` acepta `idOrdenCompra`. Llegando desde una orden solo se ofrece lo de ESA orden, no todo lo abierto del proveedor.
- **Aplica en:** SIN migración (los dos filtros son de consulta), SIN permisos nuevos → **no requiere `SEED_ON_START`**.
- **Fecha:** 2026-08-07.

**3. La regla también aplica al CAPTURAR la ORDEN DE COMPRA** (Daniel, 7-ago-2026, probando el flujo completo: *"al seleccionar el proveedor, me vuelve a desplegar todas las telas. Debería de ver solo las telas de ese proveedor"*). El punto 1 se había aplicado solo a la entrada de tela; faltaba la OC, que es donde empieza el flujo natural. Ahora:
- el selector de tela de la OC **solo ofrece las telas del proveedor del encabezado**, y **no consulta nada** hasta que hay proveedor (el combo lo dice: *"Elige primero el proveedor…"* / *"Este proveedor no tiene telas dadas de alta"*, en vez de quedarse vacío sin explicación);
- **cambiar de proveedor con telas ya capturadas las LIMPIA** (el renglón se conserva) y avisa, en vez de dejar que el servidor rechace el guardado con la orden entera ya tecleada;
- y sobre todo, **se valida en el DOMINIO** (`validarLineas`, A1: el servidor es la autoridad; el filtro del selector es solo ayuda de captura). El mensaje dice de quién es la tela: *"La tela X es de Bloom Textil: no se le puede comprar a este proveedor"*. Al **editar** se valida contra el proveedor que VA A QUEDAR.
- **EXCEPCIÓN deliberada:** una tela SIN dueño (migrada) **no se rechaza**. Bloquearlas dejaría OCs viejas imposibles de editar, y como el catálogo se captura desde cero, las telas nuevas siempre traen dueño → la puerta se cierra sola sin trabar lo viejo.

**PENDIENTE ABIERTO — la CxP de la entrada (DANIEL, 7-ago-2026):** *"es importante aclarar que desde que demos entrada a las telas, se debe de generar la cuenta por pagar del proveedor… y está bueno subir la factura de una vez y que se registre también para las CxP"*. **Registrado, NO construido todavía.** F9 dejó el gancho listo: `registrarCargoCompraCxp` (`dominio/terceros/cxp/cxp.ts`) con origen `entrada_sin_factura` y `esFiscal: false` — su propio TSDoc dice *"deja el origen LISTO para que el flujo de recepción de F4 lo invoque"*. Eso además **resuelve la duda del IVA sin preguntar**: el cargo de la entrada nace **por el importe de la mercancía, sin impuestos y no fiscal**, y la factura FISCAL se concilia después importando su CFDI (F9-E3, con anti-duplicado por UUID). Falta decidir/resolver al construirlo: (a) el **permiso** — quien confirma la entrada tiene `inventario-telas.mover`, no `cxp.administrar`, así que el cargo debe nacer como **consecuencia del acto ya autorizado** (sin exigir permiso de CxP), igual que el movimiento de kardex; (b) `refTipo: 'entrada-tela'` + `refId` para la traza; (c) **cancelar la entrada debe cancelar el cargo** por su inverso; (d) cómo se ve el PDF de la factura desde CxP.

#### (Post-F9.16) — "No me aparece el botón. ¿Por qué es?" — la pantalla debe DECIRLO (DANIEL, 7-ago-2026)

Daniel, con una OC autorizada de BLOOM TEXTILES llena de renglones de tela en pantalla: *"No me aparece el botón que dices. ¿Por qué es?"*.

**Causa:** los renglones de esa OC son de **TEXTO LIBRE**, no telas del catálogo. Es una OC **migrada**, y el ETL de F4-E6 cargó las líneas legacy **solo como texto** (documentado: *"líneas legacy SOLO texto libre"*). El botón "Dar entrada a la tela" exige `idTela != null`, así que su ausencia era **correcta**.

**El defecto era de la PANTALLA, no de la regla:** (a) la tabla de renglones mostraba `tela ?? avio ?? descripcionLibre` sin distinguirlos, así que un texto libre se veía **idéntico** a una tela del catálogo; y (b) el botón simplemente **no se pintaba**, sin decir por qué. Esconder una acción sin explicarla convierte una regla razonable en un misterio — y el que la sufre es quien opera.

**Lo que se hizo:**
1. **Columna "Tipo"** en los renglones del detalle de la OC: `Tela` (verde) / `Avío` / `Texto libre`. De un vistazo se ve qué es cada renglón — y por qué una OC migrada no se puede recibir por factura.
2. El helper booleano `puedeRecibirTelaDeLaOc` se volvió **`motivoNoRecibirTela`**, que devuelve `null` (sí se puede) o **el motivo**. Cuando no se puede, la barra de acciones pinta la razón en texto:
   - sin autorizar → *"La orden todavía no está autorizada: primero autorízala."*;
   - cancelada → *"La orden está cancelada."*;
   - renglones de avío → *"…no trae telas del catálogo… Los avíos se reciben en Compras › Recepción."*;
   - renglones de texto libre → *"Los renglones de esta orden son de TEXTO LIBRE, no telas del catálogo (así se migraron las órdenes viejas)…"*.
3. **Excepción: falta de permiso NO se explica.** Sin `inventario-telas.mover` no se pinta ni el botón ni la nota — la acción no existe para ese usuario (A4, deny-by-default: la UI esconde, no informa de lo que no le toca).

- **Consecuencia práctica que Daniel debe conocer:** las OCs **migradas no se pueden recibir por factura**, porque sus renglones no apuntan al catálogo. Para el flujo nuevo hay que capturar OCs nuevas con telas del catálogo — consistente con *"vamos a meter todas las telas desde cero"*.
- **Aplica en:** frontend-only. SIN migración, SIN permisos → **no requiere `SEED_ON_START`**.
- **Fecha:** 2026-08-07.

#### (Post-F9.17) — "Hice la OC pero al refrescar el listado, no la veo": las secuencias de folio que los ETL dejaron en cero (DANIEL, 7-ago-2026)

Daniel, después de capturar su primera orden de compra nueva: *"Hice la OC pero al refrescar el listado, no la veo"*.

**La OC SÍ se guardó.** Estaba **invisible**, no perdida: tomó **folio 1** y el listado ordena por folio **descendente** (`numCompra desc` por default), así que se fue hasta la **última página**, detrás de las ~7,978 órdenes migradas (folios hasta ~7,920).

**Causa raíz — un hueco de los ETL, no del módulo de compras.** Cuando un ETL migra un documento con su folio **explícito** del sistema viejo, tiene que dejar la **secuencia** de esa serie adelantada al máximo migrado (`sembrarSecuencia`), o la primera captura nueva arranca en 1. De las 12 secuencias del sistema, los ETL solo sembraban **4** (`pedido`, `orden` en F2-E5; `etapa-mov` en F3-E6; `auditoria` en F6-E6). **`etl-compras-notas.ts` (F4-E6) no sembraba ninguna de las suyas** → `orden-compra` y `nota-salida` quedaron en cero.

**Y era peor que un problema de orden:** el unique `(idEmpresa, numCompra)` seguía ahí. La captura funcionó porque el folio 1 estaba libre (el histórico viejo arranca más arriba), pero en cuanto la serie nueva alcanzara un folio ya migrado, la captura habría **tronado con choque de unique** — un error opaco para el usuario, en medio de su trabajo.

**Lo que se hizo — la red permanente, no el parche:**
1. **`backend/migracion/reparar-secuencias.ts` (nuevo).** Recalcula **toda** serie con histórico contra el **máximo real por empresa** de su tabla, para las 7 series que se migran con folio explícito (`pedido`, `orden`, `etapa-mov`, `auditoria`, `orden-compra`, `nota-salida`, `movimiento-tercero`). Es **idempotente** y **monótono** (`sembrarSecuencia` usa `GREATEST`: **nunca retrocede** una serie que la captura ya avanzó), así que se puede correr cuantas veces se quiera y conviene correrlo **después de CUALQUIER ETL**. Acepta un filtro de claves para que un ETL siembre solo las suyas sin duplicar la lógica.
2. **`etl-compras-notas.ts` ahora siembra sus dos series al cerrar la carga** (`orden-compra`, `nota-salida`), reusando ese mismo motor. El hueco no se puede volver a abrir por olvido.
3. **Cuidado que costó encontrar:** el campo del folio **no se llama igual en todas las tablas** — es `folio` en pedidos/órdenes/etapas/terceros, pero **`numCompra`** en OC, **`numNota`** en notas y **`numAuditoria`** en auditorías. El script lo lee por nombre de campo, serie por serie.
4. Las secuencias que **no** entran son las que nacen legítimamente en cero: `entrada-tela`, `partida-tela`, `proyecto`, `recepcion-compra` (su histórico no se migra con folio propio) y `movimiento` (los movimientos migrados salen del motor de kardex, que **siempre** pide `siguienteFolio` — nunca folio explícito).

- **PASO MANUAL DE GABRIEL (obligatorio en `prueba`, y en producción cuando se migre):** correr una vez, desde `backend/`, **`npx tsx --env-file=.env migracion/reparar-secuencias.ts`** (NUNCA `npm run`: no lleva `--env-file`). Hasta que se corra, las OC nuevas seguirán tomando folios bajos.
- **La OC de folio 1 que Daniel ya capturó sigue existiendo** (al final del listado). Los folios no se reescriben —son la identidad del documento y ya viajaron a la bitácora—, así que si la quiere con folio de la serie real, lo correcto es **cancelarla y recapturarla** después de correr el script.
- **Aplica en:** backend (script de migración + siembra en el ETL de F4-E6). SIN migración de esquema, SIN permisos nuevos → **no requiere `SEED_ON_START`**.
- **Fecha:** 2026-08-07.

#### (Post-F9.18) — Seis reglas de captura de la ORDEN DE COMPRA (DANIEL, 7-ago-2026)

Daniel, siguiendo el flujo de compras desde cero, dictó seis cosas de la OC (la séptima de su lista era el defecto de folios, §Post-F9.17):

**1. La fecha de creación es la del día que se hace, SIN opción a cambiarla.** La fecha de emisión salió del formulario: ahora la pone el **servidor** al crear la OC, y el campo se muestra como texto ("Hoy — la pone el sistema al crearla"). Ya no viaja en el cuerpo del alta ni del PATCH, así que tampoco se puede colar por el API. El **duplicado** de una OC se emite HOY (es un documento nuevo), no el día de la original. El histórico migrado conserva su fecha: entra por `crearOCMigrada`, que es otra puerta.

**2. La fecha de entrega es OBLIGATORIA.** Obligatoria al crear, y **no nullable** al editar: una vez capturada no se puede vaciar. Las OC migradas que vienen sin ella siguen editables (solo se rechaza si alguien manda `null` a propósito).

**3. La dirección de entrega es un CATÁLOGO.** *"Para que la dirección de entrega, que en el 95% es el mismo, tenga la dirección correcta y escrita siempre de la misma manera"*. Catálogo nuevo `DireccionEntrega` (global, ADR-0007): nombre corto con el que se elige + dirección completa que sale impresa + contacto/teléfono + bandera **favorita** ("la de siempre"), que la captura de la OC **preselecciona**. La favorita es **única** (prender una apaga la otra en la misma transacción) y **no se puede dejar apagada** siendo favorita. **SIN permisos propios:** se gobierna con `compras.ver`/`compras.administrar` (mismo criterio que `TelaCategoria` con `telas.administrar`, ADR-0009) → **no requiere `SEED_ON_START`**. El texto libre `entregaEn` **se conserva**: es lo único que traen las OC migradas, y en las nuevas se **copia** el texto de la dirección elegida para que impresos y consultas viejas sigan leyendo un solo campo sin join.

**4. La unidad de la tela va LIGADA a la tela.** *"No puede ser una tela que se compra en kilos, y en la OC la unidad sea piezas"*. La `unidad` de un renglón de **tela** ya no se captura: la fija la `unidadMedida` de la tela (kg/m) **en el dominio** (A1), ignorando lo que venga en el cuerpo — la UI la muestra en solo lectura, pero la autoridad es el servidor. En **avíos** la unidad sigue siendo libre a propósito: ahí presentación (rollo, caja) y unidad de consumo (m, pza) son distintas por diseño y R1 tiene su factor de conversión.

**5. Una OC puede ir ligada a varias OP.** **Ya se podía** —la liga es POR RENGLÓN (`OrdenCompraLinea.idOrden`) y el encabezado deriva el N:N `OrdenCompraOrden`—, pero no se veía. No se cambió el modelo: se hizo **visible** (nota bajo el editor de renglones: *"cada renglón se liga a su propia orden de producción: una misma orden de compra puede surtir varias OP"*) y quedó **probado** para que nadie lo "arregle" duplicando órdenes de compra.

**6. La tela se compra CON su complemento (Cardigan) cuando lo tiene.** El complemento ya era *parte de la misma tela* desde A1.1 (`Tela.nombreComplemento` es la bandera) y la **entrada** ya lo recibía en el mismo renglón (`EntradaTelaLinea.cantidadComplemento`); faltaba en la COMPRA. Ahora `OrdenCompraLinea` lleva `cantidadComplemento` + `precioComplemento` (NULL = al precio del cuerpo), el importe del complemento **suma al subtotal** del renglón, y el dominio **exige** la cantidad cuando la tela define complemento (y la **prohíbe** cuando no, o en avíos/líneas libres).

- **La excepción del complemento, y cómo se cierra sin inventar datos:** la **explosión MRP** genera OC automáticamente y **no sabe** cuánto Cardigan lleva una tela (el BOM guarda un solo `consumoPorPrenda` por tela). Meterle una cantidad inventada sería peor que dejarla pendiente, así que esas OC nacen con el complemento en NULL (bandera interna `automatica`, que NO viaja por el API) y **`autorizarOC` no las deja pasar** hasta que alguien capture la cantidad. Nadie compra "media tela" y el sistema no invita números.
- **La OC generada por el MRP también necesita fecha y dirección**, y tampoco se inventan: toma la **fecha de entrega de la orden de producción** y la **dirección favorita** del catálogo (la pantalla puede mandar las suyas). Si la orden no tiene fecha de entrega, o no hay favorita, se dice **exactamente qué falta** en vez de generar una OC a medias.
- **PASO MANUAL DE DANIEL/GABRIEL (una vez):** el catálogo de direcciones **nace vacío** — no se siembra porque una dirección es dato del negocio y no se inventa. Antes de capturar la primera OC hay que dar de alta las direcciones en **Catálogos › Direcciones de entrega** y marcar la de siempre como favorita. Mientras esté vacío, el selector de la OC lo dice con letras.
- **Aplica en:** 1 migración **aditiva** (`20260809120000_oc_direccion_entrega_y_complemento`: tabla `direcciones_entrega` + `ordenes_compra.id_direccion_entrega` + `orden_compra_linea.cantidad_complemento`/`precio_complemento`), SIN permisos nuevos → **no requiere `SEED_ON_START`**.
- **Fecha:** 2026-08-07.

#### (Post-F9.19) — ¿Cuándo se marca RECIBIDA una orden de compra? (DANIEL, 7-ago-2026)

Respuesta de Daniel a la pregunta que quedó abierta en §Post-F9.18:

> *"No siempre lleva cardigan. Más bien, se debe de marcar como recibido si se recibe lo mismo que está en la OC. Si en la OC lleva cardigan, se debe de recibir el cardigan."*
>
> *"Es importante aclarar que en telas nunca se recibe la cantidad exacta que se pide. Si se piden 400 kilos, el proveedor puede entregar +/− 5%. Se me ocurre que si hay una diferencia más grande de ese porcentaje, se necesite una autorización para recibir esa tela (lo podemos hacer en una segunda etapa… ahorita ya quiero terminar con eso). Entonces ahorita lo que podemos hacer simplemente es saber que la cantidad que se recibe nunca va a coincidir exacto con lo de la OC."*

**El criterio, tal como quedó** (función pura `dominio/compras/tolerancia-recepcion.ts`, para que TODOS lo apliquen igual):

1. **Se cierra contra lo que la OC PIDIÓ, cuerpo y complemento.** Si la OC pidió Cardigan, la orden NO pasa a `recibida_total` hasta que llegue el Cardigan — aunque el cuerpo llegue completo. Si la OC no lo pidió (*"no siempre lleva cardigan"*), no se espera nada por ese lado.
2. **Hay banda de tolerancia del 5% por debajo de lo pedido.** 400 kg se dan por surtidos con 380; con 379 la orden sigue abierta. Por arriba nunca estorba (recibir más ya cumple). Sin esta banda, **toda** OC se quedaría en `recibida_parcial` para siempre, porque el proveedor nunca entrega la cantidad exacta.
3. **La banda NO es exclusiva de la tela** (aclaración de Daniel el mismo día: *"en avíos también puede haber una diferencia"*): también aplica a **avíos y líneas libres** — 171 de 180 piezas ya cierran. Lo que sí puede ser distinto por material es CUÁNTA diferencia es normal, así que la banda vive en `TOLERANCIA_POR_TIPO` (`tela` y `avio`, hoy **5% las dos** —el único número que Daniel dio— en constantes separadas para poder afinar una sin tocar la otra).
4. **La cantidad recibida SIEMPRE se captura** y nunca se asume igual a la pedida (*"siempre debe de haber un campo para definir lo que se recibe realmente"*): la recepción de avíos (`recibirCompra`) y la factura de telas (`entradas-tela`) traen el campo editable, y el dominio **no rechaza** que difiera, ni por arriba ni por abajo. Esto ya era así desde F4-E3/B1; la aclaración lo vuelve explícito y probado.
5. **El mismo criterio manda en los tres lugares** donde antes se comparaba a mano: el estatus de la OC (`recalcularEstatusOC`), el `porRecibir` del tablero de compras (`resumenOC`) y los renglones que la captura de la factura ofrece como pendientes (`lineasTelaPendientesDeProveedor`). Dentro de la banda, lo que falte **deja de contar como faltante**; el complemento que la OC pidió **sí cuenta** hasta que llega, valuado a su precio (o al del cuerpo si no trae propio).

- **Un cuarto lugar que también lo aplica:** el tablero *"qué tengo / qué falta"* de la orden (`calcularEstatusMaterial`, R7) usa la misma banda en **todas** sus filas. Sin eso el tablero diría "recibido parcial" para siempre, **contradiciendo** a la OC que ya se dio por recibida — dos pantallas del mismo hecho diciendo cosas distintas.
- **SEGUNDA ETAPA (decidida así por Daniel, no es un olvido):** **autorizar** una recepción cuya diferencia pase del 5%. Hoy una diferencia mayor simplemente **no cierra** el renglón: la OC queda `recibida_parcial` y se ve en el tablero; no se bloquea la entrada ni se le pide permiso a nadie. Cuando se construya, usará el mismo `TOLERANCIA_TELA` de la función pura.
- **Esto SALDA la deuda que §Post-F9.18 había asumido** (el complemento no se conciliaba contra la OC). No hizo falta migración: `RecepcionCompraLinea.cantidadComplemento` ya existía desde B1 y la entrada de tela ya lo escribía — lo que faltaba era **mirarlo** al decidir el estatus.
- **Aplica en:** backend (dominio + 1 campo nuevo en la respuesta de `lineas-tela-pendientes`) + la captura de la factura, que ahora dice *"faltan 380 kg + 5 de Cardigan"* y precarga las dos cantidades. **SIN migración, SIN permisos** → **no requiere `SEED_ON_START`**.
- **Fecha:** 2026-08-07.

#### (Post-F9.20) — Leer la FACTURA (XML del CFDI) para llenar la entrada de tela (DANIEL, 7-ago-2026)

Daniel: *"lo ideal es que pueda leer la factura y llenar los campos. ¿Se podría hacer eso?"* → tras proponerle los dos caminos: *"sí, está perfecto que la información la tomes del XML para las dos cosas, y el PDF que se suba solo como referencia para poder consultar siempre la factura"*.

**Del XML, no del PDF.** El CFDI trae los datos **estructurados y exactos** (RFC del emisor, UUID, fecha, serie/folio y cada concepto con cantidad, valor unitario e importe); del PDF habría que adivinarlos con OCR o con una plantilla por proveedor, que se rompe en cuanto cambian el formato. El **PDF se sigue subiendo como adjunto** del documento (mecanismo que ya existía) para consultar la factura tal cual — pero **no es de donde salen los datos**.

**Lo que hace, y lo que deliberadamente NO hace:**
1. **Solo LEE.** El endpoint devuelve una **propuesta**; no escribe nada. La persona revisa, corrige y captura lo único que el CFDI no dice: **el COLOR** de la tela que llegó.
2. **Reconoce al proveedor por su RFC** contra el catálogo. Si ninguno lo tiene capturado, lo dice y sugiere capturarlo *"para que la próxima factura se reconozca sola"*.
3. **Cruza cada concepto con el renglón de OC pendiente** que probablemente surte, en dos pasadas: primero por el **nombre de la tela** dentro de la descripción (normalizando mayúsculas, acentos y signos: el proveedor escribe *"FELPA PERCHADA 100% ALG."* y el catálogo dice *"Felpa Perchada"*), después por **cantidad parecida** o porque solo queda un pendiente. Un renglón de OC **no se le asigna a dos conceptos**, y cada sugerencia dice **por qué** se hizo para que la persona pueda juzgarla.
4. **Es conservador a propósito:** exige que TODAS las palabras del nombre de la tela aparezcan en la descripción. Preferimos no sugerir a sugerir mal — un renglón vacío se corrige en un clic, pero un amarre equivocado puede pasar desapercibido y descuadrar la orden de compra.
5. **Las cantidades y precios que valen son los de la FACTURA**, no los que faltaban en la orden: es lo que llegó y lo que se va a pagar. Siguen siendo editables.
6. **Una factura dirigida a OTRA empresa se RECHAZA**, no se avisa (regla heredada de F9, `validarReceptorCfdi`): recibir mercancía contra el comprobante de alguien más no es una advertencia, es un error. La ÚNICA excepción es cuando la empresa todavía no captura su RFC — ahí no hay contra qué validar, así que se avisa y se deja seguir (recordatorio: capturar el RFC de FR Moda en Administración › Empresas sigue siendo un pendiente de F9).
7. **La misma factura no se recibe dos veces:** la entrada guarda el `uuidCfdi` con un unique `(idEmpresa, uuidCfdi)`, y al leer se avisa si ese UUID ya está en otra entrada **o** ya se importó a Cuentas por pagar.

- **Permiso `inventario-telas.mover`** (quien captura la entrada), **NO** `cxp.administrar`: leer la factura para recibir mercancía es parte de recibir, no de finanzas.
- **REUSA el parser de F9** (`terceros/cfdi/parser-cfdi.ts`, el mismo que alimenta CxP): un solo lugar en todo el sistema entiende de CFDI. Se le agregaron `serie`/`folio` (para proponer el número de documento), que es aditivo y no afecta a CxP.
- **PENDIENTE, la otra mitad de "las dos cosas":** que al **confirmar** la entrada se genere la **CxP** del proveedor con ese mismo CFDI. Los datos ya están (UUID sellado en la entrada) y F9 ya sabe crear el cargo fiscal desde un CFDI (`importarCfdi`); falta cablearlo dentro de la transacción de la confirmación, con el permiso resuelto como dice §Post-F9.15 (el cargo nace como consecuencia del acto ya autorizado, no exigiendo `cxp.administrar` a quien recibe).
- **Aplica en:** 1 migración **aditiva** (`entradas_tela.uuid_cfdi` + unique por empresa), SIN permisos nuevos → **no requiere `SEED_ON_START`**.
- **Fecha:** 2026-08-07.

#### (Post-F9.21) — La CUENTA POR PAGAR nace al confirmar la entrada de tela (DANIEL, 7-ago-2026)

Cierra la petición que quedó abierta en §Post-F9.15 (*"desde que demos entrada a las telas, se debe de generar la cuenta por pagar del proveedor… y está bueno subir la factura de una vez"*), ahora con la información del **XML del CFDI** como pidió Daniel en §Post-F9.20 (*"que la información la tomes del XML para las dos cosas"*).

**Cómo quedó:**
1. **Al GUARDAR** la entrada, si la captura vino de un XML, el servidor lo **vuelve a parsear** — el total fiscal **jamás** se acepta del cliente: es el importe que se le va a deber al proveedor —, valida que el **emisor sea el proveedor de la entrada** (si no, la CxP nacería a nombre de quien no facturó) y que el CFDI no esté ya en CxP, sube el XML a R2 y sella en la entrada `uuidCfdi` + `totalCfdi` + el archivo.
2. **Al CONFIRMAR** (el momento en que la tela entra al inventario) nace el cargo de CxP **en la MISMA transacción** (A2): **fiscal**, por el **TOTAL del comprobante** (con impuestos — NO por la suma de renglones, que es cantidad×precio sin IVA), con su UUID, su RFC y el XML como respaldo, y ligado a la entrada (`refTipo: 'entrada-tela'`, `refId`) — que era el punto **(b)** de §Post-F9.15.
3. **Al CANCELAR** la entrada, el cargo se cancela por su **INVERSO auditado** (D3: nunca se edita ni se borra) — punto **(c)** de §Post-F9.15. Sin esto quedaría un cargo vivo de una entrada cancelada: le deberíamos al proveedor una tela que devolvimos.
4. **SIN CFDI no se inventa cargo.** Una remisión o una captura a mano entran al inventario igual, pero no generan CxP: Finanzas la registrará cuando llegue la factura. Es deliberado — un cargo sin comprobante no es una cuenta por pagar, es una suposición.

**El permiso — punto (a) de §Post-F9.15, resuelto:** quien confirma la entrada tiene `inventario-telas.mover`, no `terceros.administrar`. Se agregaron al motor de terceros las variantes **internas** `registrarMovimientoTerceroInterno` / `cancelarMovimientoTerceroInterno`: mismo código, sin el guard, **de uso exclusivo del dominio** (jamás desde una ruta REST), para los cargos que nacen como **consecuencia de un acto ya autorizado por otro permiso**. Exigir el segundo permiso obligaría a Finanzas a recapturar a mano cada factura ya recibida — justo lo que se pidió evitar.

- **El PDF sigue siendo solo referencia** (adjunto del documento, §Post-F9.20): los datos y el respaldo fiscal salen del XML.
- **Aplica en:** 1 migración **aditiva** (`entradas_tela.total_cfdi` + `id_archivo_cfdi`), SIN permisos nuevos → **no requiere `SEED_ON_START`**.
- **Fecha:** 2026-08-07.

**Correcciones de la revisión (11-ago-2026) — la regla completa de la EDICIÓN del borrador.** Los puntos 1-4 describían el alta y la confirmación, pero el borrador **se puede editar**, y por ahí se colaban tres agujeros que ya están cerrados:

1. **Editar NO puede perder el sello.** La edición reescribía `uuidCfdi` con lo que mandara la pantalla (que al editar no lo mandaba) y no tocaba `totalCfdi` ni el archivo: el borrador se quedaba **sin folio fiscal**, la cuenta por pagar **no nacía al confirmar** y nadie se enteraba — además de liberar el unique del UUID, con lo que la misma factura se podía capturar dos veces. Ahora **el sello guardado se conserva** y el `uuidCfdi` **salió del contrato del PUT**: un folio fiscal suelto, sin su XML, no prueba nada.
2. **Editar pasa por las MISMAS guardas que el alta.** Si la edición trae un `xmlCfdi` nuevo, se re-sella con todo el juego de validaciones (receptor = empresa activa, emisor = proveedor, proveedor que sí factura, UUID no repetido ni en otra entrada ni en CxP). Y si NO lo trae, el sello conservado **se re-valida contra el proveedor** con el que va a quedar el documento: sin eso se podía capturar con el XML de *Textiles X*, editar poniendo *Avíos Y* y confirmar → **cargo fiscal contra Y respaldado con la factura de X**.
3. **El cargo nace CON el RFC del emisor.** El punto 2 decía "con su UUID, su RFC y el XML", pero el RFC no se guardaba en ningún lado: el reporte fiscal del contador lo imprimía vacío, y la **misma** factura se veía distinta según si la había capturado Finanzas o el almacén de telas. Se agregó `entradas_tela.rfc_cfdi` (columna **aditiva y nullable**) y viaja al cargo como `rfcTercero`.
4. **La carrera con Finanzas se explica, no revienta.** El UUID se verifica al GUARDAR, pero el cargo nace al CONFIRMAR, que puede ser días después: si en medio alguien importó esa factura a CxP, la unique global del UUID tiraba un error opaco (500) y **la tela no podía entrar al almacén**. Ahora se re-checa dentro de la transacción y el choque se traduce a un conflicto legible que dice qué hacer.

**Segunda ronda de la revisión (11-ago-2026) — dos cosas que el papel decía y el código no cumplía:**

5. **Con CFDI, el RFC del proveedor es OBLIGATORIO** (y sin él no se guarda). El punto 1 decía *"valida que el emisor sea el proveedor de la entrada"*, pero la comparación solo corría **si el proveedor tenía RFC capturado** — y los **155 proveedores** que sobreviven a la depuración (§Post-F9.23) llegan del Access con **todo lo fiscal al 0 %**: ninguno lo tiene. Con datos reales, esa validación era un **NO-OP el día 1**: se leía el XML de *Textiles del Norte*, se elegía a mano a *Avíos del Centro* (sin RFC), se confirmaba, y nacía un cargo **FISCAL** contra Avíos del Centro con el RFC de Textiles del Norte — el contador veía un tercero cuyo nombre y RFC no coinciden, y el UUID quedaba consumido. Ahora, **si hay CFDI y el proveedor no tiene RFC, se corta** con un mensaje que dice qué capturar y dónde (*Catálogos › Proveedores*). Aplica en las **dos** puertas (subir el XML y editar el borrador conservando el sello) y hay un **último cerrojo** justo antes de escribir el cargo. **Consecuencia práctica para Daniel/Gabriel:** para recibir por factura hay que **capturarle el RFC al proveedor** — que es, de todos modos, el pendiente de captura que ya dejó §Post-F9.22.
6. **El mensaje del choque con Finanzas ya no manda a hacer lo imposible.** Proponía *"cancela ese movimiento en Finanzas o quítale la factura a la entrada"*, y **ninguna de las dos existe**: el `uuidCfdi` salió del contrato del PUT (punto 1), así que no hay forma de soltar la factura; y cancelar en Finanzas **no libera el folio** (la unique de `MovimientoTercero.uuidCfdi` es global, el inverso no copia el UUID y el chequeo no mira los cancelados). La salida real —y la que ahora dice el mensaje— es **cancelar el borrador y recapturarlo sin el XML**: la deuda ya está en Finanzas, y un borrador no tocó nada. **No se agregó un "quitar CFDI" al PUT** a propósito: sería reabrir la superficie que el punto 1 acaba de cerrar, para un caso que ya tiene salida. El mismo criterio aplica al callejón hermano —marcarle `factura = false` a un proveedor que ya tenía un borrador con CFDI—: se corrige la casilla del catálogo (el XML prueba que sí timbra) o se cancela el borrador.

**Tercera ronda de la revisión (11-ago-2026) — el aviso que mandaba a un callejón, y dos redes:**

7. **"Elige el proveedor a mano" ya no se ofrece cuando no lleva a ningún lado.** Al leer un CFDI cuyo emisor no está en el catálogo, el aviso proponía elegir el proveedor manualmente — y desde el punto 5 eso **siempre termina en error**: si el elegido no tiene RFC, guardar corta; si tiene otro, corta por el desajuste; y no puede tener el mismo, porque entonces se habría reconocido solo. Con los 155 proveedores migrados (ninguno con RFC) ese es el día 1 entero. Ahora el aviso dice **la ruta que sí existe** —capturarle el RFC al proveedor en *Catálogos › Proveedores*, o darlo de alta con él, y volver a leer la factura— y **la pantalla deja quieto el selector de proveedor** mientras haya un XML leído sin reconocer, en vez de invitar a un intento imposible. Como una factura leída ya no se podía soltar (el `uuidCfdi` salió del PUT y la captura manda siempre el XML), se agregó **"Quitar la factura leída"**: la salida honesta para capturar la entrada sin CFDI, conservando los renglones ya capturados.
8. **El último cerrojo falla CERRADO.** El cerrojo del punto 5 comprobaba el RFC *"si el cargo trae RFC"*: un cargo fiscal sin RFC del emisor —hoy imposible, porque el mismo sello escribe el total y el RFC juntos— se habría escrito **en silencio**, a nombre de nadie y con el UUID consumido para siempre. Una comprobación que no puede comprobar **no debe dejar pasar** (A4): ahora truena.
9. **El folio fiscal SUELTO (sin XML) también respeta la casilla.** Dar de alta con `uuidCfdi` pero sin XML no pasaba por *"¿este proveedor factura?"*. Con un proveedor marcado como que **no** factura, al confirmar nacía un cargo **NO fiscal** por los precios capturados, y el UUID quedaba en la entrada pero **no** en el `MovimientoTercero` — así que Finanzas podía importar **ese mismo CFDI** después: **dos cargos por la misma factura**. La edición ya lo prohibía; el alta se había quedado sin esa puerta y ahora la tiene.

- **Aplica en:** 1 migración **aditiva** más (`20260811120000_entrada_tela_rfc_cfdi` → `entradas_tela.rfc_cfdi`), SIN permisos → **no requiere `SEED_ON_START`**.

#### (Post-F9.22) — Dos tipos de proveedor: el que factura y el que no (DANIEL, 10-ago-2026)

> *"Recuerda que en algún momento hablamos que tenemos dos tipos de proveedores. Los que nos facturan y los que no facturan. Esto aplica para todo tipo de proveedores (maquila, arte, avíos, servicios, telas, etc). Entonces todo esto aplica para los proveedores que manejan facturas. Pero para los que no (eso se define desde que se da de alta el proveedor) todo se tiene que meter manual."*

La bandera ya existía desde **F1-E1B** (R15 §4): `Proveedor.factura`, capturada en el alta con la casilla *"¿Emite factura (CFDI)?"* y con la regla `factura ⇒ RFC + régimen fiscal`. Lo que faltaba es que esa casilla **MANDARA** en el flujo. Esta decisión la vuelve la que decide el camino, y lo hace en **un solo lugar** del dominio (`terceros/facturacion-proveedor.ts`) para que no se conteste distinto en cada módulo — la distinción es del **tercero**, no del documento.

**Los tres estados (y por qué son tres, no dos):**

| Estado | Qué significa | Cómo opera |
|---|---|---|
| `factura` (true) | Emite CFDI | Camino fiscal: se lee el XML y la CxP nace por el **total del comprobante** (con impuestos) |
| `sin-factura` (false) | No emite | Todo **a mano**: nunca hay XML ni UUID, el documento es **remisión/nota** |
| `no-definida` (null) | Nadie contestó la pregunta | Se trata **como los que facturan**, y se avisa para que se defina en el catálogo |

El **NULL no es "no factura"**: son los proveedores que venían **migrados de Access**, donde la pregunta jamás se hizo. Tratarlos como informales habría apagado en silencio la lectura de facturas de casi todos los proveedores que ya existen. El sistema no decide por ellos lo que nadie capturó.

**Cómo quedó en la entrada de tela** (el único flujo que hoy lee CFDI; la regla queda lista para los que vengan):

1. **El que NO factura pierde el camino del CFDI.** La pantalla esconde el lector del XML y quita la opción *"Factura"* del tipo de documento (se corrige solo a **remisión**); el **servidor lo rechaza** igual — esconder no es impedir (A4). Un cargo fiscal de alguien que no timbra ensuciaría la contabilidad del contador.
2. **Y aun así le nace su cuenta por pagar** — esta es la parte importante. Si esperáramos su factura, esa deuda **no se registraría nunca**. El cargo nace **NO FISCAL** por lo capturado a mano: la suma de `cantidad × precio` del cuerpo **y del complemento**. Sin IVA que sumar, esa suma **es** lo que se le debe. El motor de terceros ya distinguía fiscal/no fiscal desde F9 (es lo mismo que el fold de EsMa con los maquileros sin factura, `modalidadFacturacion`): no se inventó nada nuevo.
3. **Sin precios capturados no se inventa una deuda de cero.** Queda visible en el documento (los renglones sin precio se ven), no callado.
4. **Contradicción catálogo ↔ realidad:** si se lee un CFDI de un proveedor marcado como que NO factura, **leer solo avisa** (leer no escribe nada, y el XML es prueba de que sí timbra) y pide corregir el catálogo; **guardar sí lo rechaza**. La casilla la define quien da de alta al proveedor, así que no se corrige sola.
5. **El que SÍ factura, pero todavía sin CFDI** (llegó con remisión y la factura viene después) sigue como en §Post-F9.21: **no se inventa cargo**, se registrará con la factura, que es la que trae el importe bueno.

- **Aplica en:** SIN migración, SIN permisos nuevos, SIN seed → **no requiere `SEED_ON_START`**.
- **Pendiente de captura (Daniel):** revisar la casilla *"¿Emite factura (CFDI)?"* de los proveedores migrados — mientras esté en NULL se comportan como formales.
- **Fecha:** 2026-08-10.

#### (Post-F9.23) — Depurar el catálogo de proveedores: solo los de 2025-2026 (DANIEL, 10-ago-2026)

> *"Me gustaría depurar el catálogo de proveedores… creo que lo mejor va a ser empezar desde cero. Hay demasiados proveedores con los que ya no se trabaja. Creo que la decisión que te dio Gabriel es trabajar con información de 2025 y 2026 de Control. Solo vamos a jalar esos proveedores y corregirlos porque les falta mucha información."*

**Los números del dump (verificados, 10-ago-2026):** el Access acumuló **1,052 filas** en cuatro catálogos de terceros (443 Proveedores + 69 Cortadores + 496 Maquileros + 44 Estampadores) en ~20 años. Con movimiento **desde 2025** quedan **155**: 92 comerciales, 5 cortadores y 58 talleres. **Se depura el 85 %.**

**La regla: un tercero está vivo si MOVIÓ algo**, no si el catálogo lo tiene. No se mira ninguna bandera `Activo` del viejo (nadie la mantuvo), sino los documentos con fecha:

| Tipo | De dónde sale que está vivo |
|---|---|
| Comercial (telas/avíos/servicios) | `OrdCompra.IdProveedor` |
| Cortador | `Corte.IdCortadores` |
| Taller (costura y/o estampado) | `Entregas`, `Recibos`, `Notas`, `EntregasEst`, `RecibosEst` |

**⚠️ HALLAZGO — `Estampadores.csv` es un catálogo MUERTO.** `EntregasEst.IdMaquileros` y `RecibosEst.IdMaquileros` **apuntan a `Maquileros`, no a `Estampadores`**: de los 15 ids que estampan en 2025/26, **14 existen en `Maquileros` y ninguno en `Estampadores`** (el 15º es `0`, el nulo del viejo). Quien estampa es un **taller** del catálogo de maquileros. El ETL de F1-E6 venía creando 44 proveedores "estampadores" que nadie usa; con la depuración quedan fuera **los 44**. No es un descuido: es la consecuencia correcta de la regla, y se reporta explícito.

**Cómo quedó (`migracion/comun/proveedores-activos.ts` + el loader):**
- **Configurable y por defecto NO recorta** (mismo criterio que `ventana.ts`): sin `ETL_PROVEEDORES_DESDE` se cargan todos, como hasta hoy. Con `ETL_PROVEEDORES_DESDE=2025` entra la depuración. Así una corrida vieja sigue dando lo mismo y el recorte es una decisión explícita de quien migra.
- **Nada se descarta en silencio** (plan §7): cada tercero depurado sale en el reporte con su nombre, su fuente y su id viejo; el resumen imprime cuántos fueron.
- **Un movimiento sin fecha legible NO declara vivo a nadie**, y el `0` del viejo (su nulo) nunca revive: preferimos dejar fuera a un dudoso —se da de alta en un minuto— que arrastrar de vuelta la basura que se está depurando.
- **El análisis y la carga comparten el módulo**, para que no puedan discrepar.

**"Corregirlos porque les falta mucha información" — qué falta exactamente.** De los 155 que se quedan: nombre 100 %, teléfono 72 %, razón social 55 %, contacto 52 %, condiciones 51 %, tipo (T/H/S) 37 %, dirección 25 %. Y **todo lo fiscal y comercial está al 0 %**, porque **el Access nunca lo tuvo**: `¿Emite factura (CFDI)?` (§Post-F9.22), RFC, régimen fiscal, uso de CFDI, CP de expedición, retenciones, email, días de crédito, moneda, forma/método de pago, banco/CLABE y lead time. Esa captura es **manual e inevitable**. Para hacerla llevadera, `migracion/analisis/proveedores-depuracion.ts` escribe un **CSV con los 155 y las columnas vacías** por llenar (no toca la BD; se corre con `ETL_PROVEEDORES_DESDE=2025 npx tsx migracion/analisis/proveedores-depuracion.ts`).

**⚠️ CONSECUENCIA QUE HAY QUE CONFIRMAR CON GABRIEL (no la decide este cambio):** el catálogo depurado **solo alcanza para migrar historia de 2025-2026**. Los ETL de F3-E6 (producción), F4-E6 (compras/notas) y F5-E7 (RC) hoy cargan el histórico **completo**, y esas filas apuntan a los ~897 terceros depurados. **O la migración entera se acota a 2025-2026** —que es lo que Daniel entiende que decidió Gabriel, y lo que ya vale para los consumos de tela (§Post-F9.11 punto 5, *"2025-2026, ~400 órdenes"*)— **o esos ETL se quedan sin proveedor** y omitirían masivamente. Mientras no se confirme, la depuración **está apagada por default**.

- **Aplica en:** SIN migración de BD, SIN permisos, SIN seed. Es ETL: se activa al correr la migración.
- **Fecha:** 2026-08-10.

#### (Post-F9.24) — La migración lleva SOLO 2025 y 2026 (DANIEL + GABRIEL, 10-ago-2026)

> Daniel, confirmando: *"Sí… vamos a pasar información solo de 2025 y 2026."*

Sube a **regla de toda la migración** lo que §Post-F9.23 había hecho solo para el catálogo de proveedores, y generaliza lo que §Post-F9.11 punto 5 ya decía para los consumos de tela (*"2025-2026, ~400 órdenes"*).

**Un solo interruptor: `ETL_DESDE`.** `ETL_DESDE=2025` fija el corte al **1-ene-2025**, sin depender de qué día se corra el ETL. Convive con el `ETL_VENTANA_ANIOS` de F4 (*"los últimos N años"*), pero **`ETL_DESDE` gana** cuando vienen los dos: una fecha explícita manda sobre una relativa. Sin ninguna de las dos, **no recorta** (se migra todo, como hasta hoy). El mismo interruptor alimenta la depuración de proveedores (§Post-F9.23), para que el catálogo y los documentos no puedan quedar desalineados.

**Dónde se recorta, y por qué ahí** *(corregido el 11-ago-2026: la versión original decía que el corte se aplicaba "en los documentos ANCLA, no en cada loader" y listaba solo Pedidos/Órdenes/F4. Era **falso**: hay siete loaders más que recortan por su PROPIA fecha, porque no cuelgan de la orden y sin ventana propia habrían entrado completos)*:

- **Por su PROPIA fecha** (el loader lee `ETL_DESDE` y filtra):
  - **`Pedidos`** (por `FechaPedido`, que es la fecha del documento — `FechaElaboracion` es cuándo se capturó).
  - **`Ordenes`** (por `Fecha`). **Esta es la que arrastra a la mayoría:** cortes, envíos, recibos, rutas críticas, auditorías, comentarios y costos cuelgan de la orden. Se poda también el detalle (`OrdenesDet`) al mismo conjunto: si no, se pre-crearían colores y tallas sacados de 20 años de órdenes que no vamos a migrar — justo la basura de catálogo que se está depurando.
  - Los de **F4**: **OC** (`Fecha`), **notas de salida** (`FechaElaboracion`) y **entradas/salidas de tela** — ya tenían ventana y obedecen el mismo interruptor.
  - **`IPT_Movs`** (`Fecha`) — el kardex de PT. No dependía de la orden y no leía la ventana.
  - **EsMa, los CUATRO conceptos** (cargos, abonos, descuentos y pagos), por `EsMa.FechaEsMa` — ver §Post-F9.31.
  - **Productividad IP** (`Fecha`) y **de almacén** (`Alm_Prd.FechaAlm`), **muestrarios** (`FechaSolicitado`) y **cíclico histórico** (`FechaIC`).
- **De REBOTE, por la orden** (si la orden no migra, ellos tampoco): corte, envíos, recibos, comentarios, costos, fichas confiables, auditorías de calidad, ruta crítica y pedidos reales.
- **NO se recortan:** los **catálogos** (modelos, colores, tallas, telas…) — el corte aplica a DOCUMENTOS con fecha (§Post-F9.25); los **proveedores** llevan su propio criterio (`ETL_PROVEEDORES_DESDE`, §Post-F9.23); y el **archivo histórico** (`etl-historico-ordenes`) lo **ignora a propósito**: existe para guardar lo que la ventana deja fuera.

**Un DOCUMENTO sin fecha legible SE QUEDA** — al revés que en la depuración de proveedores. Es deliberado: un tercero dudoso se vuelve a dar de alta en un minuto, pero un documento que se tira no se recupera. Ante la duda con un documento, se migra y se reporta.

**Nada se descarta en silencio** (plan §7): cada pedido y cada orden excluidos salen listados en el reporte con su id y su fecha, y el resumen imprime los conteos y la ventana aplicada — aunque no recorte.

**Qué queda con el corte (medido sobre el dump, 10-ago-2026):**

| Tabla del viejo | Total | En 2025-2026 |
|---|---|---|
| `Ordenes` | 5,451 | **262** |
| `Pedidos` | 1,529 | **112** (incluye 18 sin fecha, que se quedan) |
| `EsMa` | 11,369 | **384** |
| `OrdCompra` | 7,978 | **554** |
| Proveedores (4 catálogos) | 1,052 | **155** |

**⚠️ TRES TABLAS SE QUEDAN EN CERO — hay que decidirlas, no dejarlas pasar:**
- **`IPT_Movs` (5,072 movimientos, el último de 2023):** es el **único** origen de las existencias de producto terminado (F3-E6). Con el corte, **el inventario de PT arrancaría en CERO**. Es el mismo caso que las telas (§Post-F9.11 punto 5: *"partir de un inventario físico desde cero"*), pero para PT **esa decisión no está tomada**. **Pendiente de Daniel.**
- **`CC_Auditorias` (488, la última de 2017):** el histórico de calidad desaparece. El módulo arranca vacío.
- **`PedidosReales` (161, el último de 2010):** la función dejó de usarse hace 16 años; no migra nada.

- **Aplica en:** SIN migración de BD, SIN permisos, SIN seed. Es ETL: se activa con `ETL_DESDE=2025` al correr la migración.
- **Fecha:** 2026-08-10.

#### (Post-F9.25) — El almacén de PT arranca en CERO, y recuerda de qué orden vieja salió (DANIEL, 10-ago-2026)

> *"Sí, el almacén de PT empieza también desde cero. Acá el único tema es que será bueno incluir un campo de orden de producción para poder saber qué orden anterior es la que se fabricó. Para poder consultar información en Control viejo."*

Cierra el pendiente que §Post-F9.24 dejó abierto: con el corte de 2025-2026, `IPT_Movs` (5,072 movimientos, el último de 2023) no aporta nada y **el inventario de producto terminado arranca vacío**, igual que el de telas (§Post-F9.11 punto 5). El arranque es el **conteo físico**.

**El campo: `MovimientoDetPt.numOrdenV1`** (texto, opcional).
- **Por qué TEXTO y no la llave `idOrden`** que ya existía (F6-E2 "PT por orden", ADR-0014): esa FK solo puede apuntar a órdenes que viven en v2, y de 5,451 solo migran 262. Las prendas que están hoy en el anaquel las fabricaron órdenes **viejas**, que no se migran. Se guarda el número **tal como lo imprime Control viejo**, que es exactamente para lo que Daniel lo pidió: poder ir a consultarlo allá.
- **Es INFORMATIVO: no entra en la llave de existencia** (modelo×color×talla×orden×almacén). Dos conteos del mismo artículo con distinta orden vieja son el **mismo** inventario — lo que cambia es de dónde vino, no qué hay en el anaquel. Fragmentar el stock por una nota de consulta habría partido en pedazos el inventario de arranque, y las vistas, los locks y las sumas del kardex no se tocan.
- **Se captura UNA vez por movimiento** y se replica a cada color. El API lo recibe por color (mismo nivel que `idOrden`), pero en el conteo se cuenta un lote de una orden a la vez: pedirlo color por color sería teclear lo mismo N veces. Si un movimiento mezclara dos órdenes, se capturan dos movimientos.
- **El movimiento INVERSO lo hereda**, para que el renglón que anula se lea igual que el que anuló.
- **Se ve en el kardex**: la columna de orden muestra la orden de v2 si existe, y si no el nº con la marca "(Control viejo)".

**⚠️ NO hacen falta campos temporales para modelo, color ni talla.** Daniel lo planteó (*"al no tener un catálogo de dónde vamos a tomar los modelos existentes, tendríamos que hacer campos temporales también para números de modelo, descripción, colores, tallas"*), pero el supuesto no se sostiene y se verificó contra el dump: **el corte de 2025-2026 aplica a DOCUMENTOS con fecha, no a los catálogos.** Los **4,987 modelos** de `Modelos.csv` migran completos con su descripción (aunque solo 241 se usaron en órdenes de 2025/26), y **colores y tallas** vienen de sus propias tablas, no de las órdenes. Al contar una prenda de 2019, el modelo **está** en el catálogo para escogerlo. Lo único que de verdad no existe es la **orden**, que es justo lo que resuelve este campo.

- **Queda abierto (Daniel):** ¿se depura también el catálogo de modelos, como el de proveedores? Recomendación: **no**. Un modelo no estorba (no se ofrece al capturar salvo que se busque) y es lo que permite identificar lo que hay en el almacén sin teclear descripciones a mano. Si se depurara a 241, **entonces sí** harían falta los campos temporales.
- **Aplica en:** 1 migración **aditiva** (`movimiento_det_pt.num_orden_v1` + índice), SIN permisos, SIN seed → **no requiere `SEED_ON_START`**.
- **Fecha:** 2026-08-10.

#### (Post-F9.26) — Archivo histórico de órdenes: la historia se consulta, no se opera (DANIEL, 10-ago-2026)

> *"¿Qué pasa si dejamos todos esos modelos con su información de producción a manera informativa con la información que hay? Es decir, sin poder manipular las órdenes y sin poder ver toda la info de una OP, pero sí con algo de información fija… sin jalar maquileros, estampadores dentro de un catálogo, sino como un campo informativo. ¿Podría ser viable?"* → y al confirmar el lugar: *"me gustaría tenerlas también como archivo histórico de órdenes. Normalmente cuando queremos consultar algo de información, lo hacemos más desde las órdenes de producción que del catálogo de modelos. Para poder buscar por cliente, número de modelo, tipo de prenda, fecha de producción, maquilero, etc."*

**El problema que resuelve.** La migración lleva solo 2025-2026 (§Post-F9.24): de 5,451 órdenes del viejo, **262** entran como órdenes OPERATIVAS. Las otras ~5,200 son historia que se quiere **consultar**, y traerlas como `Orden` obligaría a arrastrar folios, kardex, costeo, ruta crítica, existencias y los catálogos de terceros que justo se depuraron (§Post-F9.23) — es decir, deshacer la depuración para poder mirar el pasado.

**El archivo NO tiene ventana de años: van también las 262 recientes.** Una orden de 2025 aparece **a propósito en los dos lados**: viva en Producción, donde se opera, y en el archivo, donde se busca — así *"¿qué le hemos mandado a este taller?"* no cambia de respuesta el 1 de enero, ni hay que preguntarse en cuál de los dos lugares buscar. Las dos caras son de solo lectura desde el archivo: no hay forma de operar una orden desde aquí.

**SON LAS 5,451, TODAS** — pero no siempre lo fueron: la primera versión cargaba **3,923** (las de las 2 empresas activas) porque el loader saltaba las órdenes sin empresa mapeada y **las 6 empresas viejas inactivas no migran** (decisión de Gabriel del 17-jun-2026: MJD / Zipora / Skintex / Free Ride / Corporativo / Marilyn; ver `docs/hoja-de-ruta/F2-etapas.md`). Eso dejaba fuera **1,528 órdenes** con **10,497 celdas** y **9,204 movimientos**, y lo que se caía era **la historia más vieja**: **1,523 de esas 1,528 son de 2005-2012** (2 de 2014 y 3 de 2016). **Daniel decidió rescatarlas el 11-ago-2026 — ver §(Post-F9.29), abajo.**

**La idea de Daniel es la que lo hace barato: si es de SOLO LECTURA, no arrastra nada.** Tres tablas planas (`HistoricoOrdenV1` + sus líneas + sus procesos), sin folios, sin estados, sin permisos de operación.

**Las dos reglas que lo mantienen inocuo:**
1. **Los terceros van como TEXTO** (`maquilero`, `tercero` del proceso), no como FK a `Proveedor`. El nombre se resuelve UNA vez, al migrar, leyendo los CSV del viejo. Un taller que no sobrevivió a la depuración aparece escrito y **no revive** como proveedor.
2. **La única FK de verdad es al `Modelo`**, porque los modelos migran completos (4,987). Es la que permite filtrar por **tipo de prenda** y **género** sin duplicar esos campos — y la razón por la que el catálogo de modelos **no** se depura (ver abajo).

**Lo que se carga (medido sobre el dump, con el rescate de §Post-F9.29 ya incluido):** **5,451 órdenes** —todas— · **39,853 celdas** color×talla · **35,296 movimientos de producción** de los cinco documentos del viejo (corte 6,967 · entregas 7,334 · recibos 12,440 · entregas est. 4,496 · recibos est. 4,059). **80,600 renglones en total.** *(Las celdas cargables son 39,853 y no 39,866 porque **13 celdas de 11 renglones de `OrdenesDet` son huérfanas**: apuntan a órdenes que no existen en `Ordenes.csv`. Sin cabecera no hay dónde colgarlas.)*

**Dónde se ve:** *Producción › Archivo de órdenes*, con los filtros que Daniel pidió textualmente — **cliente, modelo, tipo de prenda, fecha de producción y maquilero** — más una caja de búsqueda libre (número de orden / modelo / cliente). El número de orden abre la ficha: matriz color×talla y **quién la trabajó** (cortador, taller de costura, estampador, con sus cantidades).

**El filtro de maquilero mira DOS lados** (y esto importa): en el viejo, el taller de la cabecera de la orden no es necesariamente quien la trabajó — el que cosió está en `Entregas`/`Recibos` y el que estampó en `EntregasEst`/`RecibosEst`. Buscar solo por la cabecera dejaría fuera justo lo que se busca (*"¿qué le hemos mandado a este taller?"*), así que la búsqueda cubre también los procesos.

**Lo que NO se hace, a propósito:**
- **No se normalizan los colores.** El viejo los guardaba como texto libre, así que conviven "MARINO", "Marino" y "MAR.". En un archivo de consulta eso se lee y se entiende; adivinar equivalencias entre casi 40,000 celdas metería errores silenciosos.
- **No se depura el catálogo de MODELOS** (a diferencia de proveedores). Un modelo no estorba —no se ofrece al capturar salvo que se busque— y es lo que permite identificar lo que hay en el almacén y filtrar el archivo por tipo de prenda. Depurarlo obligaría además a capturar a mano el número, descripción, colores y tallas en el conteo inicial de PT, que es trabajo extra para quien cuenta.
- **No hay escritura.** El dominio (`dominio/consultas/historico-ordenes.ts`) solo expone `listar` y `obtener`; las rutas son solo `GET`. El ETL escribe con Prisma directo — excepción consciente a A1, porque no hay regla de negocio que proteger (sin folios, sin kardex, sin estados) y una capa de dominio de escritura sería ceremonia sobre un `INSERT`.

**Permiso:** se REUSA `ordenes.ver` (quien ve órdenes ve las viejas). **Cero permisos nuevos, cero seed.**

- **Aplica en:** 1 migración **aditiva** (3 tablas + 1 enum) y 1 ETL nuevo que se corre a mano después de `etl-catalogos`: `npx tsx --env-file=.env migracion/etl-historico-ordenes.ts` (idempotente).
- **Fecha:** 2026-08-10.

#### (Post-F9.27) — En el archivo van TODOS los talleres, no solo el primero (DANIEL, 10-ago-2026)

> Corrigiendo la primera versión del archivo: *"Está bien lo que comentas, excepto el tema de maquilero. Sí es importante que vayan todos. Y no solo el primero. Lo mismo para estampadores. Pero lo puedes poner en un campo abierto, donde sí pueda encontrarlo, pero no esté ligado a nada."*

**Qué estaba mal.** El archivo (§Post-F9.26) mostraba en el listado el maquilero de la **cabecera** de la orden (`Ordenes.IdMaquileros`) — que es solo el **asignado**. En la realidad del taller, una orden **pasa por varios**: se corta en uno, se cosen partidas en dos o tres, y se estampa en otro. Con la cabecera sola, buscar *"¿qué le hemos mandado a este taller?"* dejaba fuera a la mayoría de los que de verdad trabajaron la orden.

**Cómo quedó.** Tres columnas nuevas de **TEXTO ABIERTO**, ligadas a nada, con los nombres **distintos** de cada rol separados por `" · "`:

| Columna | De dónde sale |
|---|---|
| `cortadores` | `Corte` |
| `maquileros` | `Entregas` + `Recibos` (costura) |
| `estampadores` | `EntregasEst` + `RecibosEst` |

- **El listado muestra los de costura** (que es lo que se busca a diario) y cae al asignado si la orden no tuvo movimientos; la **ficha muestra los tres roles** completos: *Cortaron · Cosieron · Estamparon*.
- **El filtro de taller busca en todos lados**: la cabecera, los tres campos abiertos y —como red— los movimientos de producción.
- **Se ordenan alfabéticamente** a propósito: el orden en que vienen los CSV no es estable, y un archivo cuyo texto cambia entre corridas es un archivo que no se puede comparar.

**Por qué se DUPLICA lo que ya está en `HistoricoOrdenV1Proceso`:** para poder **verlos en el renglón** del listado y buscarlos sin un subquery por fila. Normalmente desnormalizar así es deuda —la copia se desincroniza—, pero este archivo es **inmutable**: se llena una vez con el ETL y no se edita nunca. Es el caso en el que no cuesta nada.

**Sigue sin estar ligado a nada:** son en su mayoría los ~897 talleres que la depuración del catálogo (§Post-F9.23) dejó fuera, y así siguen fuera. Se ven y se buscan; no reviven como `Proveedor`.

- **Aplica en:** la migración del archivo (`20260810190000_historico_ordenes_v1`) se **regeneró** con las tres columnas incluidas, en vez de encimar una segunda — no había corrido en ningún ambiente. SIN permisos, SIN seed.
- **Fecha:** 2026-08-10.

#### (Post-F9.28) — Directorio histórico de terceros: la libreta, fuera del catálogo (DANIEL, 10-ago-2026)

> *"Al no pasar la información de los maquileros, ¿qué hacemos con la información de ellos si quisiera encontrar algún teléfono o nombre? ¿Habrá manera de mantener la información acá, sin tener toda la información basura en el catálogo? ¿Podríamos guardarlo en algún otro repositorio que no sea el catálogo de proveedores?"*

**La pregunta es la correcta, y la respuesta es sí.** La depuración (§Post-F9.23) deja fuera del catálogo **~897 de los 1,052** terceros del Access. Eso es exactamente lo que se quería —que no estorben al capturar una orden o una compra— pero su **teléfono y su dirección siguen sirviendo**: un taller con el que no se trabaja desde 2021 puede volver a hacer falta mañana.

**Cómo quedó:** una tabla aparte, `DirectorioTerceroV1`, con los terceros del Access y sus datos de contacto. Es una **libreta de direcciones**, no un catálogo:
- **No sale en NINGÚN selector de captura** (ni telas, ni OC, ni maquila, ni EsMa).
- **No tiene roles, ni `activo`, ni bandera de factura, ni FK a nada.**
- **Es de SOLO LECTURA** y no hay —ni habrá— botón de *"convertir en proveedor"*. Si un taller vuelve, **se da de alta LIMPIO** en el catálogo copiando de aquí lo que sirva. Ese botón sería exactamente la puerta trasera por la que volvería la basura que se acaba de depurar; no ponerlo es la decisión, no un pendiente.

**Entran TODOS, también los 155 que sobrevivieron**, marcados con `enCatalogo`. Así la libreta es la **foto completa** del Access y nadie tiene que preguntarse en cuál de los dos lados buscar; el filtro *"Solo los que ya no están"* aísla a los depurados cuando eso es lo que se quiere.

**Cuántos son, exactamente: 1,046 de las 1,052 filas** (corregido en la revisión del 11-ago-2026). Doce fichas no traen `Nombre`/`Apellidos`, y la primera versión las descartaba **en silencio** — entre ellas **Bordaprint, Fit Print y Eurobordados**, con teléfono y dirección reales, que es literalmente lo que la libreta existe para conservar. Su identidad vive en la clave corta (`Corto`), así que **el nombre cae a `Corto` cuando no hay otro** (el mismo fallback que ya usaba el archivo de órdenes): seis se recuperan así. Las **6** restantes son cascarones sin un solo dato —ni nombre, ni clave, ni teléfono— y se descartan **listándolas en el reporte** (plan §7: nada en silencio).

**Lo que hace útil a la libreta** —más allá del teléfono— es la **última actividad**: la fecha del último documento suyo en el viejo (OC, corte, entrega, recibo o nota) y **cuántos documentos** tuvo. Contesta de un vistazo *"¿hace cuánto que no trabajamos con este, y qué tanto trabajamos?"*, que es lo que decide si vale la pena volver a llamarlo.

**Se busca también por TELÉFONO**, no solo por nombre: la pregunta era literalmente *"encontrar algún teléfono"*, y a veces se llega al revés (tengo el número, ¿de quién es?).

**Dónde vive:** *Catálogos › Directorio histórico*, **junto** al catálogo de proveedores pero claramente separado de él (el subtítulo dice *"solo consulta; NO es el catálogo"*).

- **Permiso:** se REUSA `proveedores.ver`. Cero permisos nuevos, cero seed.
- **Aplica en:** 1 migración **aditiva** (una tabla). Se llena con el MISMO ETL del archivo de órdenes (`etl-historico-ordenes`): son las dos mitades de *guardar la historia sin ensuciar los catálogos*.
- **Fecha:** 2026-08-10.

#### (Post-F9.29) — El archivo lleva TODAS las órdenes; la empresa vieja se guarda escrita (DANIEL, 11-ago-2026)

> Sobre las 1,528 órdenes que el archivo (§Post-F9.26) dejaba fuera por pertenecer a las 6 empresas viejas que no migran: *"Sí, está bien, rescata todas y solo pon en algún lugar la empresa a la que correspondía."*

**Qué estaba mal.** El archivo cargaba **3,923 de las 5,451** órdenes del viejo. Las que no tenían su empresa mapeada se saltaban, y como **las 6 empresas inactivas no migran** (decisión de Gabriel del 17-jun-2026: MJD / Zipora / Skintex / Free Ride / Corporativo / Marilyn), se caían **1,528 órdenes** con **10,497 celdas** y **9,204 movimientos**. Y lo que se caía era justo **la historia más vieja** —**1,523 de esas 1,528 son de 2005-2012**—, es decir, precisamente la razón de existir de un archivo de solo consulta.

**Cómo quedó.** Se cargan **las 5,451**. Las de empresas que ya no existen **se cuelgan de la empresa principal** y **conservan escrita la empresa a la que pertenecían**, en la columna nueva `HistoricoOrdenV1.empresaV1`. Es el mismo criterio que se usó con los talleres en §Post-F9.27: **el dato viejo se guarda como TEXTO, ligado a nada** — no revive como entidad, no aparece en ningún selector, no se puede operar.

- **Por qué colgarlas de una empresa viva y no de una empresa "histórica" nueva:** `idEmpresa` es **FK real a `Empresa`**, y el listado filtra por la **empresa activa** de la sesión (A9). Crear una empresa "histórica" reabriría justo lo que la decisión de Gabriel cerró (y arrastraría la membresía usuario↔empresa que todavía no existe); colgarlas de una empresa que nadie tiene activa sería rescatarlas para que nadie las vea.
- **Cuál es la principal: FR Moda.** Es la del seed F0, la favorita, la que el resto del ETL usa para los almacenes y la que la gente tiene activa al entrar. Marilyn Fitness es la **misma empresa renombrada** (no son dos negocios), así que la elección no parte nada. El loader la resuelve en tres escalones: **FR Moda por nombre → la favorita → la primera empresa del mapeo** (este último, determinista, es para los ambientes de prueba).
- **Lo que ya estaba bien no se toca:** una orden cuya empresa **sí** mapea se queda en la suya. Rescatar no es reasignar.
- **`empresaV1` se llena SIEMPRE**, también en las órdenes de las 2 empresas activas: si solo lo trajeran las rescatadas, un valor vacío sería ambiguo (*¿es de la empresa activa, o el CSV no traía nombre?*).
- **Dónde se ve y cómo se busca:** en la **ficha** de la orden (*Empresa (Control viejo)*), no como columna del listado —que ya lleva 8—, y **se busca desde la caja de búsqueda libre**. Eso último importa: como todas las rescatadas comparten `idEmpresa`, ese texto es la **única** forma de volver a juntar la historia de una empresa extinta (teclear "Zipora" las trae todas).
- **Nada en silencio (plan §7):** el ETL ya no reporta "omitidas"; reporta **cuántas se rescataron y de qué empresa vieja era cada grupo** (agrupado por empresa, no 1,528 renglones), y lo dice también en el resumen de consola.

**Lo que se carga ahora, medido sobre el dump:** **5,451 órdenes · 39,853 celdas · 35,296 movimientos = 80,600 renglones** (antes: 3,923 · 29,356 · 26,092 ≈ 59,400). *(Las celdas son 39,853 y no 39,866 porque 13 celdas de 11 renglones de `OrdenesDet` son **huérfanas**: apuntan a órdenes que no existen en `Ordenes.csv`.)*

- **Aplica en:** la migración del archivo (`20260810190000_historico_ordenes_v1`) se **regeneró** con la columna incluida —no había corrido en ningún ambiente—, igual que se hizo con §Post-F9.27; es aditiva y nullable. SIN permisos, SIN seed. El ETL es idempotente, pero **re-correrlo no rellena `empresaV1` de órdenes ya cargadas**: como la tabla nace en esta misma entrega, no hay ninguna.
- **Con esto se cierra la deuda** que §Post-F9.26 dejó anotada en `HOJA-DE-RUTA.md` §4.
- **Fecha:** 2026-08-11.

#### (Post-F9.30) — Folio duplicado en el Access: entra CUALQUIERA de los dos, y el otro se reporta (DANIEL, 11-ago-2026)

> Sobre qué hacer cuando el Access trae **dos documentos con el mismo folio** (medido: 4 pares de `NumCompra` repetidos en la empresa 8 con fecha de 2026 — dentro de la ventana —, dos de ellos **con proveedores distintos**):
>
> Daniel: *"Mete la que sea. La de mayor monto."* … y al preguntarle si valía la pena construir el desempate: *"Es irrelevante para mí. Es algo demasiado pequeño para gastar tiempo. El hecho de que sea una u otra me da igual."*

**Qué se hace.** En los cinco documentos con folio propio (`Pedido`, `Orden`, `OrdenCompra`, `NotaSalida`, `Auditoria`), cuando dos filas del Access comparten `(empresa, folio)`: **entra la primera que llega** (la que gane la carrera del bucle concurrente) y **la otra NO se migra, se REPORTA** con su folio, su clave vieja, el id del documento con el que chocó y **qué se queda fuera con ella** (sus renglones; en OC además sus ligas a órdenes y sus recepciones).

**Qué NO se hace, y por qué.** **No se implementa la selección "la de mayor monto".** Habría que hacer una **pre-pasada agrupando por folio en los cinco loaders** —leer todas las filas, agrupar, sumar importes, elegir— para cambiar **únicamente CUÁL de los dos gemelos entra**. El dueño dijo explícitamente que le da igual cuál sea, así que el cambio no compra nada de negocio y sí cuesta código y riesgo en los cinco loaders. Queda **escrito como decisión consciente**, no como omisión: si algún día importa cuál entra, esto es lo que habría que construir.

**Lo que sí se construyó** (11-ago-2026), porque es lo que evita que la corrida del go-live **mienta**: separar el **duplicado del ORIGEN** (culpa del Access; la base de v2 puede estar impecable) de la **colisión con V2** (la base no estaba limpia y hay que parar). Antes los dos se reportaban con el mismo texto, el mismo contador y la misma línea de consola —*"si ves una sola colisión, para: la base no estaba limpia"*—, que para el duplicado del origen es un **diagnóstico falso**. Ahora cada uno tiene su sección de reporte, su contador y su aviso. Ver `backend/migracion/comun/colision-folio.ts` y `backend/migracion/README.md`.

- **Aplica en:** SIN migración de BD, SIN permisos, SIN seed. Es ETL + documentación.
- **Fecha:** 2026-08-11.

#### (Post-F9.31) — EsMa recorta por la fecha de su CABECERA en los cuatro conceptos, cargos incluidos (11-ago-2026)

**Decisión de negocio, no detalle técnico:** cambia **qué existe en la cuenta corriente del maquilero** después de la migración. Hasta ahora solo vivía en un comentario de código; aquí queda registrada.

**Qué se decidió.** Los **cuatro** conceptos de EsMa —**cargos**, abonos, descuentos y pagos— se recortan por la **fecha de la cabecera `EsMa.FechaEsMa`** (la fecha del documento), no cada uno por su cuenta.

**Por qué.** Los abonos/descuentos/pagos **no cuelgan de una orden**, así que sin ventana propia habrían entrado **completos** (554 + 743 + 5,935) contra los cargos de apenas **384 cabeceras EsMa** de 2025-2026. Como el saldo del maquilero es **derivado** (Σ movimientos, D3), a todos les habría salido un saldo **masivamente negativo** —como si se les hubiera pagado de más durante 16 años—: un dato falso, y de los que se ven en pantalla el primer día.

**El hueco que queda, dicho sin adornos.** El **cargo** necesita **además** el mapeo de su **ORDEN**. Una cabecera EsMa de 2025 cuyo recibo cuelga de una orden de 2024 **pasa la ventana pero pierde su cargo**, mientras los abonos/descuentos/pagos de esa MISMA cabecera sí entran → vuelve el saldo negativo derivado, **más chico pero real**. Y no es un caso rebuscado: una orden cortada en nov-dic se cobra en ene-feb. Por eso **no se afirma** *"o entra el documento EsMa completo, o no entra"*: el ETL **cuenta esos cargos aparte** (`sinMapeoOrden`), los lista uno por uno y **saca el conteo al resumen de la corrida** (`etl-produccion` y `etl-esma`), para que la magnitud del sesgo se **vea** en vez de quedar escondida entre los `omitidos`. Si al leer el reporte del go-live el número es grande, la decisión de qué hacer con esos saldos es de Daniel.

- **Aplica en:** SIN migración de BD, SIN permisos, SIN seed. Es ETL (`loaders/esma-cargos.ts`) + documentación.
- **Fecha:** 2026-08-11.

#### (Post-F9.32) — El traspaso de telas se hace POR COLOR; el de lote solo sigue vivo por los avíos (DANIEL, 12-ago-2026)

> Al destapar el menú de Inventarios, sobre cuál de los dos traspasos de tela debía ofrecer el riel:
>
> Daniel: *"El traspaso se hace por color. No siempre hay un lote completo para traspasar. De hecho no tengo muy claro cómo funcionan los lotes. En el sistema anterior todo era por color."*

**Qué se decidió.** El traspaso de telas **vigente es el POR COLOR** (*Inventarios › Telas › Traspaso de telas por color*, la pantalla que nació en A2). Entra al **riel** como hijo del padre «Telas», junto a los demás flujos por color. El **traspaso por LOTE** (*Traspaso de materiales*) **se queda en el menú, pero por los AVÍOS**: es la única pantalla que los mueve entre almacenes. Su pata de tela queda como legado, igual que las otras dos vistas por lote (*Existencias por lote* y *Salida a orden por lote*), que siguen fuera del riel y solo se alcanzan por ⌘K/URL.

**Por qué no es cosmético — la razón técnica, verificable.** El traspaso por lote graba sus renglones con **`id_tela_color = NULL`**, y la vista de existencias por color los **excluye**: `WHERE d."id_tela_color" IS NOT NULL` (`backend/prisma/migrations/20260806130000_a2_partidas_telas/migration.sql:137`). Es decir, **traspasar por lote NO mueve las existencias por color**: el usuario capturaría el movimiento y *Existencias de telas* —el primer hijo de ese mismo menú— seguiría igual, sin decirle nada. Ofrecer en la navegación primaria únicamente el traspaso por lote era mandar al usuario al flujo muerto. *(Es coherente con §Post-F9.11 punto 5: el inventario de telas arranca desde cero por color, así que ya no hay lotes históricos que mover.)*

**Ya se había pedido, y esta es la misma pantalla.** En §Post-F9.13 Daniel pidió *"una pantalla de traspaso de telas entre almacenes"* para mandar tela al cortador, y la respuesta fue exactamente esta: la de A2, a la que se le corrigió el selector de almacenes y a la que apunta el botón **"Mandar tela al cortador"** del avance de producción. Lo que faltaba —y cierra esta decisión— era que **se viera en el menú** sin depender de ese botón ni de ⌘K.

- **Aplica en:** `frontend/src/modulos/catalogo.ts` (`ESPEC_RIEL`, hijos del padre «Telas»). **SIN migración de BD, SIN permisos nuevos, SIN seed** — es una entrada de menú a una pantalla que ya existía, y el gate lo hereda del catálogo (`inventario-telas.mover`).
- **Fecha:** 2026-08-12.

#### (Post-F9.33) — Telas y avíos NO se separan: se separan sus PANTALLAS. Los avíos por tamaño quedan para una segunda etapa (DANIEL, 12-ago-2026)

> Daniel, al ver que el menú le ofrecía pantallas que mezclaban telas y avíos:
>
> *"No sé si está bien la idea de que sea el mismo inventario los avíos y telas. Tengo mis dudas. Creo que para las telas hay cosas muy específicas como el cardigan (dos campos en el mismo color) que no funciona igual para avíos. Y en avíos hay cosas como llevar inventarios por tamaño o talla que no viene en telas. Sé que está muy avanzado todo para hacer un cambio tan grande, pero no sé si sea funcional tener todo en el mismo inventario. Más bien revísalo bien y hazme una propuesta."*
>
> Y tras la propuesta: *"Está bien dejar para una segunda etapa los avíos por tamaño."*

**Qué se decidió.**

1. **El inventario NO se parte.** Telas y avíos siguen compartiendo el **motor de kardex** (ADR-0010) y el **encabezado `Movimiento`**. Lo que se separa son las **pantallas**.
2. **Avíos por tamaño/medida: SEGUNDA ETAPA.** No entra al arranque de producción.

**Por qué NO se parte — los hechos que sostienen la decisión.** La preocupación de Daniel era razonable pero el diseño ya la había resuelto:

- **No comparten tablas de detalle.** Hay una por tipo: `MovimientoDetTela`, `MovimientoDetAvio`, `MovimientoDetPt` (ADR-0010 §2, que rechaza explícitamente *"una tabla de detalle gorda con columnas de dimensión nullable"*). Ni una columna de tela vive NULL en un renglón de avío.
- **El cardigan no toca a los avíos.** `cantidadComplemento`/`costoUnitComplemento` existen **solo** en `MovimientoDetTela`; `MovimientoDetAvio` tiene 7 columnas y ninguna es de complemento.
- **Lo verdaderamente común son 51 de 5,630 líneas** del dominio de inventarios (`tipos-movimiento.ts`). El resto ya es código separado que solo *se parece*. Los permisos (`inventario-telas.*` / `inventario-avios.*`), los endpoints (`api/inventarios/avios.rutas.ts`, aislado) y las vistas de existencia (`existencia_tela_color`, `existencia_avio`) **ya estaban separados**.
- **Las existencias tampoco se mezclan:** hay una vista por dimensión, ninguna compartida.

**Lo que SÍ estaba mal, y es lo que Daniel percibió.** Las tres pantallas de *materiales* (**Ajuste**, **Traspaso** y **Kardex de materiales**) mezclan tela y avío con una pestaña, **y su pata de tela usa el flujo LEGADO por lote** — el que ya no opera (§Post-F9.32). Al mirarlas, Daniel estaba viendo el residuo de F4, no el diseño vigente: las telas ya tienen sus pantallas propias por color desde A2. **El problema era de interfaz, no de modelo de datos.**

**Lo que queda pendiente (segunda etapa, sin fase asignada).**

1. **Pantallas propias de avíos** — ajuste, traspaso y kardex **de avíos**, con los campos de avío y nada más; y retirar las tres mixtas, que dejan de tener razón de existir. Es lo que hace que el sistema *se sienta* separado, que es lo que Daniel pedía.
2. **Existencia de avíos por medida/tamaño** — **HOY NO EXISTE**. El dato vive en el catálogo (`AvioMedida`, con precio por medida) y el amarre talla→medida en el BOM (`ModeloAvioTalla.idAvioMedida`), pero **el inventario, el MRP, la recepción de compra y las notas de salida son planos por avío**: `MovimientoDetAvio` no tiene columna de medida ni de talla, y `existencia_avio` agrupa solo por avío×almacén×empresa. Que el sistema sepa que la talla M lleva cierre de 18 cm pero al contarlos los sume todos juntos es una **funcionalidad faltante**, no una consecuencia de compartir motor con telas: agregarla es **aditivo sobre una tabla que ya es exclusiva de avíos** (+ su llave de lock, la suma de existencia, la vista, y propagarla por `RequerimientoOrden`, `NotaSalidaLinea` y `RecepcionCompraLinea`).

- **Aplica en:** nada todavía — es una decisión de rumbo. **SIN migración, SIN permisos, SIN seed.** Los dos pendientes se planean como etapa propia después del arranque.
- **Fecha:** 2026-08-12.

#### (Post-F9.34) — Nomenclatura: el catálogo de modelos separa DESARROLLO de PRODUCCIÓN, y el modelo conserva sus dos números (DANIEL, 12-ago-2026)

> ⚖️ **AJUSTE (28-ago-2026) — dos de los puntos de «Qué se decidió construir» cambian:**
> • **El punto 2** (*el catálogo muestra **producción por defecto***) queda **SUSTITUIDO**: el default
> pasa a **`todos`**, con la etapa visible en cada renglón, porque tal como estaba **escondía los
> modelos que Desarrollo acababa de crear** ⇒ **§Post-F9.134** (que además **retira el alta directa de
> modelo de producción**). El motivo original —*«no quiero llenar de basura el catálogo»*— sigue
> vigente y ahora lo sirven la columna y el filtro, no el ocultamiento.
> • **El punto 4** (*«pasar a producción»*) deja de ser **1:1**: de un modelo de desarrollo pueden nacer
> **VARIOS** de producción, compartiendo **una sola receta** ⇒ **§Post-F9.135**.
> **Todo lo demás sigue vigente** (el significado de los dígitos, las dos series, que nada se borra).


> 🔴 **AVISO (25-ago-2026): el ALCANCE DEL CONTADOR del código de desarrollo que se decide aquí quedó
> SUSTITUIDO por §Post-F9.108, bloque «✅ RESUELTO».** Daniel cambió de criterio: el consecutivo corre
> por **cliente + año** (⇒ el primer jogger de dama de ese cliente y año es `CYA-26-72-`**`002`**), no
> por el prefijo completo con concepto+género. **Todo lo demás de esta entrada sigue vigente** —el
> significado de los dos dígitos, la separación desarrollo/producción, los dos números del modelo—.
> No se borra nada (D3): se anota, porque esta entrada se escribió con el documento «Estructura de
> modelos FR Moda» (2014) enfrente y sigue siendo la que explica de dónde salen los dígitos.

> Daniel: *"Me parece que en algún momento definimos que hay modelos de desarrollo y modelos de producción. Los modelos de producción tienen una razón de ser, tienen una nomenclatura. Y los modelos de desarrollo podrían tener algo distinto… ya que hay muchos modelos de desarrollo que no salen a producción. No quiero llenar de basura el catálogo."*
>
> Y sobre conservar la historia: *"Me gusta la lógica… solo que entonces me gustaría mantener en algún lado el modelo de desarrollo cuando salga a producción. Que no se borre."*

**El estado del que se parte (verificado en código, 12-ago-2026).** NO existía tal separación: `Desarrollo.idModelo` es NOT NULL y `crearDesarrollo` **exige un `Modelo` que ya exista y esté activo** (`backend/src/dominio/desarrollo/desarrollos.ts`, `exigirModeloActivo`). Es decir, **todo** desarrollo obliga a dar de alta un modelo en el catálogo, con la misma serie única de códigos que los de producción. Lo que D13 sí había definido era que *"un desarrollo que no llega a producción se apaga (archivado)"* — pero eso apaga el **desarrollo**, no el **modelo**: el modelo se quedaba en el catálogo. `Modelo.activo` es "descontinuado", no "es de desarrollo".

**La nomenclatura de PRODUCCIÓN (documento «Estructura de modelos FR Moda», 03-03-2014, entregado por Daniel).** Cinco dígitos, cada uno con significado:

| Posición | Significado | Valores |
|---|---|---|
| 1 | **Concepto** (tipo de prenda) | 2 Conjunto · 3 Bermuda, Falda · 4 Vestido · 5 Playera ⭐ · 6 Sudadera (medio cierre, capucha o c. redondo) · 7 Pantalón, Jogger, Leggings · 8 Chamarra, Chaleco con cierre · 9 Gorra, Polos, batas |

> ⭐ El documento de 2014 listaba el 5 como *"Playera, Vestido"*. Daniel lo corrigió el 15-ago-2026
> (§Post-F9.46): **el 5 es Playera y nada más**; el Vestido es el 4. Series independientes.
| 2 | **Género** | 1 Caballero · 2 Dama · 3 Niño Juvenil · 4 Niño Infantil · 5 Caballero · 6 Niña Infantil · 7 Niña Juvenil · 9 Bebas · 0 Bebos |
| 3, 4, 5 | **Consecutivo** | 001–999 |

**Las rarezas de la tabla, aclaradas por Daniel (12-ago-2026):**

> Daniel: *"El 1 no es nada. Caballero que aparece en dos es porque se usa mucho caballero y en algún momento quise poner más modelos de caballeros. No pasa nada."*

- **Concepto: el 1 no se usa.** No es un valor perdido en la conversión del .doc: simplemente no significa nada. El concepto arranca en 2.
- **Género: el 1 y el 5 son AMBOS «Caballero», a propósito.** No es una errata. Es una **ampliación de capacidad**: caballero es lo que más se produce, se llenó el consecutivo de 999 de la serie `x1` y Daniel abrió la serie `x5` para seguir numerando. El **8 no se usa**.

⚠️ **Consecuencia para el generador de códigos, que hay que respetar al construirlo:** el tope de 999 por combinación **NO es teórico — ya se alcanzó** en caballero, y la salida fue duplicar el dígito de género. Por lo tanto:

1. Al proponer el siguiente consecutivo para **Caballero**, el generador debe tratar `x1` y `x5` como **el mismo género**: llenar primero la serie `1` y, agotada, continuar en la `5`. Su espacio real es de 1,998 por concepto, no 999.
2. El generador debe **avisar cuando una combinación se acerque al tope**, en vez de fallar al llegar. Cualquier otra combinación puede llenarse igual, y ahí ya no habrá un dígito libre que duplicar.
3. ~~**Por confirmar al construir (no bloquea hoy):** en *concepto*, «Vestido» también aparece dos veces (4 = Vestido, 5 = Playera, Vestido). Puede ser el mismo truco de capacidad o coincidencia de nombre; si es lo primero, aplica la misma regla de continuidad.~~ → ✅ **RESUELTO (Daniel, 15-ago-2026, §Post-F9.46): _"Vestido es 4 y playera es 5."_** NO es el truco de capacidad: son conceptos distintos, cada uno con su serie independiente de 999. El *"Vestido"* que el documento de 2014 lista en el 5 es ruido del documento viejo. **El encadenamiento de series existe SOLO en el género** (Caballero 1→5), nunca en el concepto.

**La nomenclatura de DESARROLLO (definida por Daniel el 12-ago-2026).** Formato **`CYA-26-71-001`**:

- **`CYA`** — abreviatura del **cliente**. Campo NUEVO en el catálogo de clientes, único entre clientes. *(Daniel: "está bien hacer el campo de abreviatura en el cliente".)*
- **`26`** — **año de ENTREGA** del modelo, no el de creación. *(Daniel: "el año es para el año que se va a entregar el modelo".)*
- **`71`** — los **dos dígitos de la nomenclatura de producción**: concepto + género (aquí 7 = Pantalón/Jogger/Leggings, 1 = Caballero).
- **`001`** — consecutivo que **se reinicia cada año**. *(Daniel: "se reinicia cada año el contador".)*

**El código se CONGELA al crearse — CONFIRMADO POR DANIEL.**

> Daniel: *"Está bien como lo planteas. Se queda con el número que se hizo aunque después cambien de año."*

Si la entrega se recorre de 2026 a 2027, el número sigue siendo `CYA-26-…`. Para entonces ese código ya anda en correos, cotizaciones y en la lista de precios del cliente, y renumerarlo rompería la trazabilidad de la negociación. La **fecha real de entrega** vive en su campo y esa sí se actualiza: el año del código es el que se pretendía al nacer, no una promesa de cuándo se entrega.

**El consecutivo corre por cliente + año + tipo de prenda — CONFIRMADO POR DANIEL.**

> Preguntado si el consecutivo corría por cliente y año sin importar el tipo de prenda, Daniel: *"También por tipo de prenda."*

O sea que **el contador pertenece al prefijo completo**: cada combinación `CLIENTE-AÑO-CONCEPTO+GÉNERO` lleva su propia serie, que reinicia cada año. `CYA-26-71-001` es el primer jogger de caballero desarrollado para C&A con entrega en 2026; el primer jogger de dama de ese mismo cliente y año es `CYA-26-72-001`, no el `002`.

🔴 **SUSTITUIDO (25-ago-2026, §Post-F9.108 «✅ RESUELTO»): el contador pertenece a `cliente + año`**, así que ese jogger de dama es `CYA-26-72-`**`002`**. Lo demás del párrafo (qué significan los dos dígitos, el reinicio anual) sigue vigente.

*(Lectura del lead sobre un punto que Daniel no detalló: «tipo de prenda» se toma como **los dos dígitos juntos** —concepto Y género—, porque son un solo segmento del código; si el contador debiera correr solo por el concepto, los números saldrían con huecos entre géneros. Confirmar al construir.)*

**Qué se decidió construir.**

1. **NO se separa la tabla `Modelo`.** Un modelo de desarrollo necesita exactamente lo mismo que uno de producción (BOM, telas, avíos, fotos, tech pack, precosteo), y todo eso ya cuelga de `Modelo`; duplicar la entidad duplicaría el BOM, las fotos, el precosteo y las listas de precios. Se separan la **marca** y la **numeración**, no la entidad.
2. **Marca de origen en el modelo** + el catálogo y la galería mostrando **producción por defecto**, con los de desarrollo detrás de un filtro.
3. **Serie propia de desarrollo** (`CYA-26-71-001`), que **no consume** consecutivo de la serie de producción. Con solo 999 por combinación, quemar números en modelos que quizá nunca se fabrican es caro.
4. **Acción «pasar a producción»**: asigna el código de 5 dígitos y saca el modelo del filtro de desarrollo. **Los dos primeros dígitos ya vienen decididos** desde el `71` del código de desarrollo, así que solo se asigna el consecutivo — el paso deja de ser una decisión y se vuelve un trámite.
5. **NADA se borra (D3).** El modelo promovido **conserva su número de desarrollo** junto al de producción; ambos son buscables. Lo que cuelga del desarrollo —precosteo con sus versiones, negociación con sus acuerdos, tech pack, fotos de muestra, el número del cliente— **no se toca**: sigue ligado y consultable.
6. **El número del cliente NO se normaliza.** `Desarrollo.numeroCliente` ya existe: ahí va tal cual lo que mande el cliente, aunque cada vez venga distinto. *(Daniel: "normalmente le ponen letras que salen del cliente, y la verdad es que cada vez lo hacen diferente".)*
7. **El código de PRODUCCIÓN lo define DANIEL, no el sistema.**
   ⚠️ **SUPERADO por §Post-F9.46 (15-ago-2026): Daniel cambió de opinión y pidió que el sistema SÍ
   precargue el siguiente número libre, con el campo editable.** Lo de abajo se conserva como
   historia de por qué se había decidido al revés; **no se construye así**. Lo que SÍ sigue vigente
   de este punto es que el sistema *valida y avisa* sin bloquear (los tres guiones).

   > Daniel: *"Normalmente yo defino los modelos de producción, no el sistema."*

   El sistema **no impone** el número: Daniel lo captura. Lo que el sistema hace es **asistir y verificar**, nunca decidir:
   - **Muestra** cuál es el siguiente consecutivo libre de esa combinación, como dato a la vista — no como valor precargado que haya que borrar.
   - **Valida** que el código no esté repetido y que los dos primeros dígitos correspondan al tipo de prenda y al género elegidos (en v2 ambos ya son campos propios del modelo: `idTipoProducto`, `idGenero`), avisando si no cuadran. **Avisa, no bloquea** — si Daniel quiere una excepción, la excepción es suya.
   - **Advierte** cuando la combinación se acerque al tope de 999.

   Esto es lo contrario de lo que se había anotado en la primera versión de esta entrada (*"el sistema propone el código"*), y Daniel lo corrigió: automatizar la asignación le quitaría una decisión que él toma a propósito.

   **El código de DESARROLLO sí lo arma el sistema**, porque es mecánico y no tiene criterio de negocio: cliente + año de entrega + los dos dígitos + el consecutivo que sigue. *(Daniel acotó su corrección a los modelos de producción; si también quiere capturar a mano el de desarrollo, se ajusta.)*

- **Aplica en:** ✅ **CONSTRUIDA en V1-E3n (20-ago-2026)** — migración
  `20260820160000_modelos_desarrollo_vs_produccion`: `Modelo.origen` + `Modelo.codigoDesarrollo` +
  `Cliente.abreviatura` + los dígitos como DATOS en `TipoProducto`/`Genero`, con el catálogo y la galería
  filtrando producción por default, la acción «pasar a producción» (desde el catálogo y desde «Generar
  OP») y el motor `dominio/modelos/nomenclatura.ts`. La última duda del punto de arriba la cerró Daniel en
  **§Post-F9.83**. *(Hasta el 20-ago-2026 esta entrada decía "Aplica en: NADA todavía — es decisión de
  rumbo", y por eso la OP 5558 de Daniel se quedó con el modelo de desarrollo.)*
- **Fecha:** 2026-08-12.

#### (Post-F9.35) — El ARTE deja de ser catálogo y se maneja DENTRO del modelo (DANIEL, 12-ago-2026)

> Daniel, al repasar por qué existía el catálogo de bordados:
>
> *"Honestamente me parece que no tiene mucho sentido que viva en un catálogo. Originalmente cuando pensé en el sistema anterior, supuse que había artes que se iban a ocupar en más de un modelo. Por eso definí un catálogo. Pero en la práctica, cada arte va pegado siempre a un solo modelo. Entonces creo que sería más fácil manejar el arte (o varios) dentro del modelo. Ahí mismo establecer su precio, el proveedor, etc."*
>
> Y sobre el precio: *"Es importante que tenga su precio, que es el que va a viajar hasta la OP."*

**Los datos del sistema viejo le dan la razón** (medidos el 12-ago-2026 sobre `Respaldo CLAUDE/TABLAS/Bordados.csv` y `ModelosBor.csv`, rama `fuente-sistema-viejo`):

| | |
|---|---|
| Artes en el catálogo | **2,964** |
| **Nunca usados en ningún modelo** | **898** (30 % del catálogo) |
| Usados en **UN solo** modelo | **1,899** — el **92 %** de los usados |
| Usados en varios | 167 (8 %), casi todos en 2 o 3 |

Y el remate: **los artes están nombrados con el número del modelo** (los más compartidos se llaman `51901`, `25214`, `81561`, `55129-2`). Ni siquiera los compartidos son artes reutilizables: son el arte de un modelo que se resurtió o tuvo variante. **El catálogo nunca funcionó como catálogo.**

**Qué se decidió.**

1. **El arte se va DENTRO del modelo.** Cada modelo lleva su arte o sus artes con: nombre, tipo (bordado / estampado), puntadas, **precio**, **proveedor** (⚠️ NUEVO — hoy `Bordado` no tiene proveedor) y su foto. El catálogo global `Bordado` **desaparece como catálogo**.
2. **Los 167 compartidos se DUPLICAN al migrar**: cada modelo se queda con su copia. Son unos cientos de renglones. Para no perder la comodidad, un botón **«copiar arte de otro modelo»** trae el arte ya lleno y se ajusta — la conveniencia sin reinventar el catálogo.
3. **Los 898 nunca usados NO se migran.** Es la depuración que Daniel pedía, gratis.
4. **La galería de arte SOBREVIVE**, pero armada desde los modelos: sigue sirviendo para buscar visualmente *"ese bordado que hicimos"*, y ahora cada foto dice de qué modelo es.

**⚠️ INVARIANTE QUE NO SE PUEDE ROMPER: el precio del arte viaja hasta la OP.** Ya funciona hoy y el refactor debe preservarlo: `dominio/costos/costo-orden.ts` calcula `procesosPorPrenda = (maquilaOrd ?? modelo.maquilaBase) + (aplicacionOrd ?? 0) + Σ bordados`, tomando `ModeloBordado.precio` y cayendo al `Bordado.precio` del catálogo si el renglón viene vacío. El arte entra **UNA vez por modelo, SIN multiplicar por cantidad** (así está testeado en `costo-orden.test.ts`).

Al mover el arte al modelo **esto se simplifica**: desaparece el precio del catálogo y queda **un solo precio del modelo**. El cálculo debe seguir dando **exactamente lo mismo** para los datos existentes.

**⚠️ HUECO QUE ESTA ETAPA DEBE CERRAR: el precio del modelo es de REFERENCIA; el REAL se define en la OP.**

> Daniel: *"Al final el precio que viaja a la OP es un precio de referencia. El precio real se define en la OP (en ocasiones puede moverse para arriba o para abajo por alguna variable en producción)."*

**Hoy NO se puede** (verificado en `schema.prisma`, modelo `Orden`): la orden tiene `maquilaOrd` y `aplicacionOrd` —overrides a nivel orden para la maquila y la aplicación— pero **no existe ningún override para el precio del arte**. `costo-orden.ts` lo toma fijo del modelo (`ModeloBordado.precio ?? Bordado.precio`), sin manera de ajustarlo en la OP. Es un hueco, no una decisión: el mismo sistema ya reconoce que maquila y aplicación se mueven en producción, y el arte se mueve igual.

**Qué hay que construir:**

1. **Precio de arte POR ORDEN**, con el mismo patrón que ya existe: `precioEnLaOrden ?? precioDelModelo`. Como un modelo puede llevar **varios** artes, el override es **por arte y por orden** (no un campo suelto en `Orden`, que solo serviría si hubiera uno).
2. **El precio del modelo se rotula como REFERENCIA** en la interfaz, y el de la OP como el que manda. Quien mire la OP tiene que ver cuál se aplicó y, si se movió, que se movió.
3. **El costo real de la orden usa el de la OP.** Y como el arte ahora lleva **proveedor**, ese precio es además lo que se le paga: la liga con la cuenta corriente del proveedor debe leer el mismo número, no el de referencia.
4. **Cambiar el precio en la OP NO toca el modelo.** El de referencia se queda como está para las siguientes órdenes; mover uno no debe reescribir el otro en ninguna dirección.

**Alcance del cambio (no es un cambio de menú).** Toca: el esquema (`Bordado` → arte hijo de `Modelo`; `PrecostoLinea.idBordado`), el costeo (`costo-orden.ts`), el precosteo de F8, la galería, las pantallas de modelo y el ETL. **Requiere migración.** Es una **etapa propia**.

**Cuándo:** sin fase asignada. Salió del repaso del flujo real que Daniel pidió (12-ago-2026); el orden se decide **al terminar ese repaso**, por si aparecen otros cambios del mismo tipo que convenga hacer juntos.

- **Aplica en:** NADA todavía — decisión de rumbo. **Requiere migración** cuando se construya; permisos y seed, no.
- **Fecha:** 2026-08-12.

#### (Post-F9.36) — Las SEIS decisiones que definen la PRIMERA VERSIÓN (DANIEL, 13-ago-2026)

> Tras leer `docs/DIAGNOSTICO-FLUJO-COMPLETO.md`, Daniel cerró las decisiones que estaban frenando
> el arranque. *"Ya quiero sacar la primera versión. Ya se fue mucho tiempo con esto."*

**1. RUTA CRÍTICA: APAGADA en la v1.**

> Daniel: *"Sí podemos arrancar sin ruta crítica. Hoy honestamente no lo estamos ocupando en Control.
> Podríamos empezar sin eso sin problema. Y lo vamos construyendo."*

Se apaga para el arranque y se construye después. **Esto retira CINCO bloqueantes** del diagnóstico:
no hay que correr el ETL de F5 (plantillas), ni asignar `UsuarioRol` a los 23 usuarios, ni cargar los
festivos de FR Moda, ni resolver que el admin vea pendientes ajenos, ni las alarmas falsas del día 1.

**Pendiente al construir la v2 de RC** — Daniel lo pidió en la misma vuelta: *"como administrador me
gustaría ver el estatus de pendientes por persona"*. Hoy existe a medias (hay selector "Viendo
pendientes de:" para `rc.programar`) pero **no hay concentrado por persona**: el admin ve todo
revuelto en una sola lista como si fuera suya (`bandeja.ts:183-192`). La vista de supervisor —cuánto
trae cada quien, cuánto vencido, y de ahí al detalle— es parte del alcance cuando RC se encienda.

⚠️ **Apagarla NO es no hacer nada.** `rcAutomatica.ts` genera la ruta de toda orden nueva y no hay
interruptor: hay que quitar `rc.ruta-ver` de los roles de la v1 (apaga menú, campana y pantalla de un
golpe) **y** decidir si además se suspende la generación automática, para no acumular ~26 procesos
por orden que nadie va a capturar.

**2. Producción: UNA SOLA pantalla por acto.** *(Daniel: "Ok. Una sola pantalla está bien.")*
Se queda el **panel de avance** del Centro de Órdenes y se le agrega lo que hoy solo tienen las
viejas (**imprimir** y **capturar segundas**); `/produccion/corte`, `/produccion/envios` y
`/produccion/recibos` se retiran. Hoy conviven las cuatro y **ninguna es completa**.

**3. `noProducir`: mostrarlo y ya.** *(Daniel: "Ok. No es relevante. Casi no hay órdenes así.")*
Se hace visible y editable el campo, que hoy bloquea "Generar OP" sin aparecer en ninguna pantalla.
Sin más alcance.

**4. ⭐ SE ARRANCA SIN CONTEO FÍSICO. El inventario se carga sobre la marcha.**

> Daniel: *"Si son muchos está bien el Excel. Pero creo que también podríamos arrancar sin conteo
> físico. ¿Será viable? Quiero ir implementando lo antes posible y el conteo físico nos llevará
> tiempo. ¿Podemos ir metiendo sobre la marcha la información? ¿Podríamos meter las telas con las
> que estamos trabajando y más adelante cargar todo lo demás?"*

**Sí es viable.** Verificado antes de responder:

- **El costeo NO se distorsiona.** El costo real de una orden sale de las **órdenes de compra**, y lo
  que no tiene compra propia se valúa al **último precio de compra** de ese material
  (`costo-real-compras.ts`, §Post-F9.5). Como la migración trae las compras de 2025-2026, casi toda
  la tela ya tiene historial de precio: **tela que entre por ajuste no ensucia el costo**.
- **El riesgo real es el MRP**: netea contra existencias, así que **lo que no esté cargado lo manda a
  comprar** (`mrp.ts`). Con el almacén en cero, la primera explosión de cada orden pide todo aunque
  esté en bodega.
- **La mitigación es la que propuso Daniel**: cargar las telas y avíos **con los que se está
  trabajando**. Con eso la explosión de las órdenes vivas sale bien y el resto se carga cuando se
  necesite.
- **La regla práctica**: un color se captura **la primera vez que se va a usar**. Si se intenta
  descargar tela no cargada, el sistema la rechaza — ese es el recordatorio. La pantalla ya existe
  (*Ajuste de telas por color*, construida justo para "arranque desde cero").

**Consecuencia de calendario:** el **importador Excel de conteo físico deja de ser bloqueante** — era
el mayor consumidor de tiempo humano del go-live y el mayor riesgo de fecha. Se construye después,
con calma, para cargar el resto del almacén.

**5. Numeración: CONTINÚA, pero saltando al siguiente ESCALÓN.**

> Daniel: *"Continuaría. Pero no el siguiente número disponible. Me saltaría al siguiente escalón.
> Para saber que las nuevas órdenes empiezan a partir de la 6000 por ejemplo (para OP). Esto para OP
> y OC también."*

Aplica a **órdenes de producción Y órdenes de compra**. El número exacto se fija **en el ensayo**,
cuando se conozca el máximo real migrado (si la última OP fuera 5,847 → arrancar en 6,000). Requiere
que `migracion/reparar-secuencias.ts` acepte un **salto a escalón**, no solo `max+1`.
⚠️ **Es irreversible una vez arrancado.**

**6. El comprobante de entrega actual BASTA.** *(Daniel: "Con la que hay está bien. Por ahora nada
específico para nadie.")* No se construye remisión ni packing list por cliente.

- **Aplica en:** decisiones de rumbo + alcance de la v1. La 2, la 3 y la 5 requieren construcción; la
  1 requiere quitar permisos y decidir la generación automática; la 4 y la 6 **no requieren nada**.
- **Fecha:** 2026-08-13.

#### (Post-F9.37) — Empresas viejas, quién ve la cobranza y cancelar el Pedido Real (DANIEL, 13-ago-2026)

Cierra las tres decisiones que quedaban del diagnóstico.

**7. Las 6 empresas viejas NO existen como empresa operativa. Solo FR Moda activa.**

> Daniel: *"Con el archivo basta. Ya no operan ahorita. Solo activa FR Moda."*

Sus 1,528 órdenes ya viven en el **archivo histórico** (§Post-F9.29), rescatadas bajo la empresa
principal y conservando en `empresaV1` de quién eran. Eso basta para consultarlas; **no se crean
como `Empresa`**. Consecuencia técnica útil: la deuda de **membresía usuario↔empresa**
(`HOJA-DE-RUTA.md` §4) **queda dormida** — hoy `resolverEmpresaActiva` acepta cualquier empresa
activa por header, lo que sería un salto de tenant en cuanto hubiera una segunda. Con una sola
empresa activa no muerde. **Si algún día se activa otra, esa deuda pasa a BLOQUEANTE.**

**8. La cobranza la ven SOLO administración y Daniel. Ventas NO.**

> Daniel: *"No tiene caso. Cobranza por ahora solo la ve administración y yo."*

**El seed se queda como está** (`prisma/seed.ts:216-225` le quita a Ventas `cxc.ver`/`cxp.ver`/
`terceros.ver`). Esto **cierra en contra** la pregunta que quedó abierta al cerrar F9-E4 y la
recomendación del lead en el diagnóstico: *"quien vende no ve si le pagaron"* es **deliberado**, no
un olvido. Queda escrito para que nadie lo "arregle" en una revisión futura.

**9. El Pedido Real SÍ se puede cancelar.** *(Daniel: "Sí.")*
Cierra el TODO que estaba abierto desde F2-E1 (`dominio/pedidos/pedidos-reales.ts:321-323`,
*"pendiente de decisión de Daniel"*). Cancelación **suave con motivo**, como todo lo demás del
sistema (D3: nada se borra).

- **Aplica en:** la 7 y la 8 **no requieren construcción** (son confirmaciones del estado actual); la
  9 sí. SIN migración, SIN permisos nuevos, SIN seed.
- **Fecha:** 2026-08-13.

#### (Post-F9.38) — La salida de tela A UNA ORDEN no lleva nota; el TRASPASO entre almacenes SÍ (DANIEL, 13-ago-2026)

> Preguntado si la salida de tela hacia una orden debía seguir generando un documento «nota de
> salida» como en el sistema viejo, o bastaba el movimiento de kardex:
>
> Daniel: *"Está bien el movimiento de tela sin la nota de salida cuando sea para consumo de una
> orden. Vamos a necesitar notas cuando se mueva entre almacenes (si le mando tela a un cortador, si
> necesito una nota de salida)."*

**Qué se decidió.** Son **dos actos distintos** y llevan documento distinto:

| Acto | Documento |
|---|---|
| **Salida de tela a una orden** (consumo) | **NINGUNO.** Basta el movimiento de kardex. Cierra el hueco que el diagnóstico reportó como "el renglón de tela de la nota de salida es incapturable": **no hay que arreglarlo, hay que retirarlo.** |
| **Traspaso de tela entre almacenes** (p. ej. mandarla a un cortador) | **SÍ lleva nota**, porque la tela **sale físicamente** y el papel va con ella. |

**Estado hoy (verificado 13-ago-2026):** el traspaso **no genera ningún documento**. El único impreso
del inventario de telas es el listado de existencias (`dominio/inventarios/impresos/impreso-inventario-telas.ts`);
no hay impreso de traspaso en `api/inventarios/telas.rutas.ts`. **Falta construirlo.**

**Contexto que lo hace natural:** el cortador ya está modelado como un **almacén**
(`Almacen.idCortador`), y §Post-F9.13 dejó el botón *"Mandar tela al cortador"* apuntando al
traspaso por color. Lo que falta es el papel.

**CONFIRMADO POR DANIEL — la nota del traspaso NO genera folio nuevo: es la IMPRESIÓN del que ya existe.**

> Daniel: *"De acuerdo con lo de la nota de salida así como lo comentas. **No debe de generar otro
> folio de nada.** Me refiero a solo la impresión del folio que ya existe."*

Es decir: **no** se crea un registro `NotaSalida` paralelo, **ni una secuencia nueva**. El traspaso
**ya tiene folio propio y sus renglones**; lo único que falta es su **impreso** — con ese mismo
folio, fecha, almacén origen y destino, el tercero (cortador) y el detalle por color con ambos
componentes. Y **reimprimible desde el historial**, no solo al momento de guardar: el diagnóstico
encontró que en producción los PDF solo se ofrecen para el movimiento recién guardado, y ese defecto
no se repite.

Razón de fondo, ya confirmada: una `NotaSalida` paralela sería una **segunda fuente de verdad** del
mismo hecho físico, y el saldo ya se deriva del kardex (D3). Dos folios para un movimiento acaban
siempre con uno de los dos mintiendo.

- **Aplica en:** construir el impreso del traspaso de tela por color + su reimpresión. Retirar el
  renglón de tela de la nota de salida (queda solo para avíos). **SIN migración, SIN permisos nuevos,
  SIN seed.** Va en **V1-E3** (donde ya se agrupa el trabajo de impresión y reimpresión).
- **Fecha:** 2026-08-13.

#### (Post-F9.39) — Reglas nuevas del precosteo y de la autorización de compras (V1-E1 y V1-E2, 13-ago-2026)

Registro de las reglas que nacieron al construir las dos primeras etapas de la primera versión. No
son decisiones de Daniel: son **decisiones de diseño del lead** que quedan escritas para no
re-discutirlas.

**Del precosteo (V1-E1):**

1. **El cliente se PROPAGA desde el proyecto.** El desarrollo **no** tiene cliente propio ni columna
   nueva: se lee del `Proyecto` (que es Cliente + Departamento) y se muestra en el precosto y en la
   ficha. Sin migración.
2. **El renglón manual puede LIGARSE a un avío del catálogo** (`idAvio` opcional). Cuando viene, el
   **dominio** resuelve descripción y precio con la cascada que ya existe —extraída a
   `precioAvioDeCatalogo` para no duplicarla— y el precio queda **editable**. Un `precioUnit`
   explícito manda sobre el del catálogo. El texto libre se conserva para conceptos que no son avíos.
3. **Los candidatos a lista se pueden acotar por proyecto** (`idProyecto` opcional), y **el
   habilitado del botón sale de esa consulta**, nunca del estado derivado: `ligado-produccion` pisa a
   `en-lista` y oculta justo lo que hace falta saber.
4. **INVARIANTE DE REDONDEO — lo que se guarda y lo que se deriva son el MISMO número.** Todo valor
   que se persiste en una columna `Decimal` se redondea **a la escala de esa columna antes** de
   guardarlo y de calcular cualquier derivado: `redondear2` para importes/precios (`Decimal(12,2)`) y
   `redondear4` para consumos/cantidades (`Decimal(12,4)`), ambas en `dominio/costos/decimales.ts`.
   El redondeo vive **en la función que produce el valor**, no en cada consumidor, para que no nazca
   un camino nuevo mañana. *(Postgres **redondea** —half away from zero—, no trunca: por eso un valor
   crudo y su derivado se separan.)*

**De compras (V1-E2):**

5. **Una OC se autoriza desde `borrador`** y la **Bandeja de autorización lista los borradores**. El
   estatus `pendiente_autorizacion` **no lo escribía nada** en el sistema y era el único desde el que
   la pantalla ofrecía autorizar → la bandeja estaba vacía para siempre y **ninguna OC nueva se podía
   autorizar**. El dominio **siempre** lo aceptó (`ESTATUS_EDITABLES_NORMAL`): el bloqueo era 100 %
   de frontend. El valor se queda en el enum (retirarlo pediría migración); solo se dejó de depender
   de él. ⚠️ **Consecuencia para el usuario:** la bandeja muestra también las OC a medio armar.
6. **Un error de LECTURA no bloquea ni rellena.** Si no se puede saber lo ya recibido, la recepción
   **no precarga nada** (blanco, nunca "lo pedido") y lo dice con aviso fijo + reintentar; si no se
   puede leer el catálogo de direcciones, **no se bloquea** generar la OC — el servidor la para si de
   verdad falta. Regla general: **un dato vacío se nota, uno equivocado no.**
7. **La salida de tela por LOTE se quedó sin UI.** El motor legado nunca escribe `idTelaColor` y la
   vista `existencia_tela_color` lo excluye, así que lo capturado por ahí **no movía las existencias
   que la propia pantalla muestra**. Se retiraron el diálogo de «Nueva nota de telas» y la pestaña de
   telas del ajuste de materiales (hoy **«Ajuste de avíos»**, bajo el padre «Avíos»). El endpoint
   sigue vivo en el backend, sin consumidor.

- **Aplica en:** V1-E1 y V1-E2, ya construidas. **SIN migración, SIN permisos nuevos, SIN seed** →
  el deploy a `prueba` **no** requiere `SEED_ON_START`.
- **Fecha:** 2026-08-13.

#### (Post-F9.40) — Al mover producto terminado a mano SE ELIGE DE QUÉ ORDEN salen las piezas (DANIEL, 13-ago-2026)

> Planteado el defecto —el PT que produce la fábrica **no se puede traspasar ni sacar a mano**— y las
> dos salidas posibles, Daniel eligió: ***"La uno."***

**El defecto (confirmado en código, §Post-F9.x / diagnóstico B3).** El recibo de maquila etiqueta cada
pieza que entra a PT con **la orden de la que salió** (`recibos.ts`, *"PT por orden (F6-E2)"*), y la
existencia se valida **por orden** (`kardex.ts`, `d."id_orden" IS NOT DISTINCT FROM $idOrden`). Pero
los **movimientos manuales y los traspasos** escriben y validan contra el bucket **«sin orden»**
(`movimientos-pt.ts`, que pasa `null` explícito). **Son dos saldos que no se hablan:** lo que produce
la fábrica solo puede salir por la **entrega a cliente de esa misma orden** — no se traspasa entre
almacenes, no sale por movimiento manual (muestras, mermas, ajuste de conteo). Y la pantalla de
existencias **sí muestra ese stock, con su orden**, así que el usuario ve piezas que el sistema le
rechaza mover con un *"no hay existencia suficiente"* incomprensible.

**Qué se decidió — OPCIÓN 1: elegir la orden.** Al capturar un movimiento manual o un traspaso de PT,
el usuario **elige de qué orden** salen las piezas, entre las que tienen existencia de ese
modelo × color × talla en ese almacén (incluido el bucket **«sin orden»**, que es donde cae lo
capturado a mano y lo migrado).

**Por qué esta y no sumar el saldo entre órdenes** (la opción 2, descartada): sumar era más simple de
usar pero **perdía el rastro** — una pieza salía del almacén y ya no se sabía de qué producción era.
En un negocio donde **el costo se calcula por orden**, perder esa liga al sacar piezas desordena el
costeo. Y el dato ya existe: la pantalla de existencias ya muestra la orden de cada renglón, así que
enseñarla y luego no dejar usarla era la incoherencia.

**Consecuencias para quien lo construya:**
- El movimiento manual y el traspaso dejan de pasar `null` fijo: reciben la orden (o `null`
  explícito) **por renglón**, y validan el no-negativo contra **ese** bucket bajo el mismo lock.
- La UI necesita ofrecer las órdenes **con existencia real** de ese artículo en ese almacén — no el
  catálogo entero de órdenes.
- **NO se toca la invariante D3**: la existencia sigue siendo Σ movimientos y la cancelación sigue
  siendo un inverso auditado.
- El inventario **capturado a mano** en el arranque (§Post-F9.36 punto 4) cae en «sin orden» y se
  mueve con libertad: esta decisión **no** complica el arranque sin conteo físico.

- **Aplica en:** **V1-E3b**. Toca `dominio/inventarios/movimientos-pt.ts`, el contrato de esos
  movimientos y sus pantallas. ⚠️ **Verificar en vivo antes de tocar**: el defecto está confirmado
  leyendo las tres piezas juntas, pero no ejecutado. **SIN migración** (la columna `idOrden` ya existe
  en el detalle del kardex).
- **Fecha:** 2026-08-13.

#### (Post-F9.41) — El precio pactado de maquila se TECLEA sin permiso especial; solo su LECTURA se redacta (V1-E3a, 13-ago-2026)

**Decisión del lead**, tomada al retirar las tres pantallas de captura de producción (§Post-F9.36
punto 2). Se registra porque cambia quién puede hacer qué, y quedó a un paso de irse como efecto
colateral tácito.

**Qué pasó.** Al migrar el campo `precioPactado` al panel de avance, la primera versión lo puso
detrás de `ordenes.ver-precio-real-maquila`. **Ese gate no existía en las pantallas retiradas**: se
mostraba a cualquiera con `produccion.envio` / `produccion.recibo`.

**Por qué se desgateó.** El permiso se corta en **Logística hacia abajo** (`prisma/seed.ts:236`),
mientras `produccion.envio`/`.recibo` **no se cortan en ninguna parte** — o sea, gatearlo se lo
quitaba justo a **los roles que capturan la maquila todos los días**. Y como `esma/cargos.ts:69-74`
cae al `precioPactado` del recibo cuando la OP no trae `maquilaOrd`/`aplicacionOrd`, el resultado era
que **el cargo al maquilero nacía SIN PRECIO** y alguien lo tecleaba aparte: exactamente la doble
captura que v2 vino a eliminar (`03-Produccion.md`, "punto de integración central").

**La regla que queda, que ya era la del backend:**

> **Se TECLEA el precio que el maquilero cotizó hoy. NO se VE el precio real que capturó otro.**

El backend **nunca** gateó la escritura: solo **redacta en la lectura y en la cancelación**
(`etapas.ts:387-388`, `recibos.ts:423-424`), y su propio test lo dice — *"la respuesta de la
CANCELACIÓN redacta precioPactado sin ver-precio-real; **la captura no**"* (`recibos.int.test.ts:803`).
La UI ahora coincide con esa regla en vez de inventar una más estricta.

**La redacción de lectura NO se tocó.** Quien no tiene el permiso sigue sin ver los precios
capturados por otros.

- **Aplica en:** `AvanceProduccion.tsx` (campo sin gate; `precioApi` sin filtro). **SIN migración, SIN
  permisos nuevos, SIN seed.** Prueba que lo fija: sesión **sin** `ordenes.ver-precio-real-maquila` y
  **con** `produccion.envio` manda `precioPactado`.
- **Fecha:** 2026-08-13.

#### (Post-F9.42) — «Consulta de órdenes» entra al riel: imprimir EN LOTE es capacidad propia, no una consulta duplicada (V1-E3a, 13-ago-2026)

**Decisión del lead.** Al destapar el menú de Producción se curó la lista y ocho pantallas quedaron
fuera del riel con el argumento de que *"son consultas que duplican lo que ya hacen el Centro de
Órdenes o Pedidos"*. El reviewer **comprobó que el argumento era falso para dos**:

- **«Consulta de órdenes»** es la **única pantalla que imprime órdenes EN LOTE**
  (`ConsultaOrdenesPagina.tsx:135-143`); el Centro de Órdenes imprime **de a una**
  (`CentroOrdenesPagina.tsx:1356`). Eso es una **capacidad propia**, no un corte de otra pantalla.
  → **ENTRA al riel.**
- **«Archivo de órdenes»** es la producción del **sistema anterior**, que el Centro no lista.
  → **Queda fuera, pero por ser histórico**, no por duplicada. El comentario se corrigió para que
  diga la verdad.

Las otras seis **sí** son cortes de lo que ya resuelven el Centro o Pedidos, y siguen alcanzables por
⌘K **y por el hub `/produccion`** que esta etapa construyó.

**La lección, que aplica a toda curación futura del menú:** una pantalla no se saca del riel por
*parecer* una consulta. Se saca cuando **no aporta una capacidad que las demás no tengan** — y eso se
verifica leyendo qué hace, no por su nombre.

- **Aplica en:** `frontend/src/modulos/catalogo.ts` (`ESPEC_RIEL`, hijos de `produccion`), con
  `catalogo.test.ts` y `e2e/login.spec.ts` actualizados. **SIN migración, SIN permisos, SIN seed.**
- **Fecha:** 2026-08-13.

---

#### (Post-F9.43) — El BOM se CONGELA en la orden de producción; Desarrollo la libera antes de comprar (DANIEL, 14-ago-2026)

**La pregunta con la que empezó.** El lead propuso quitar las tres banderas
`paraPreCosto`/`paraProduccion`/`paraCosto` del BOM del modelo apoyándose en un comentario de Daniel
(*"esto está obsoleto… yo creo que lo quitaría"*). **El error fue del lead: proponer quitarlas sin
preguntar para qué existían.** Daniel explicó su razón de ser, que es real y vigente:

> *"Un modelo se desarrolla a partir de cierta información. Y en ocasiones se negocia con el cliente
> que ya no lleve alguna cosa (por ejemplo, quitarle una jareta para abaratar el costo). Entonces el
> modelo original sí lo lleva, pero para producción ya no lo llevaría. En su momento lo resolví de
> esa manera en Control, pero ahorita me parece que la información de la receta va a quedar grabada
> en la OP… ¿o dónde va a vivir esa información en producción?"*

Y al confirmar el diagnóstico: **_"Creo que sí es indispensable para la primera versión. De hecho así
funciona en Control viejo. El BOM debe de vivir en la OP."_**

**(a) LAS BANDERAS NO SE QUITAN.** Son hoy el único mecanismo que existe para "esto va en desarrollo
pero no en producción". Lo que estaba mal no es que existan: es **dónde viven**. La bandera es del
**modelo**, no de la orden — apagar la jareta la apaga en TODAS las órdenes de ese modelo, incluidas
las ya producidas *con* jareta (y el código ya alcanza hacia atrás:
`recalcularEstadoOrdenesDeModelo`). Después de esta decisión las banderas se quedan con el
significado limpio: **qué lleva la PLANTILLA** para cada propósito. Lo que cambia por cliente deja de
ser bandera y pasa a ser un ajuste de esa orden.

**(b) LA RECETA SE CONGELA EN LA OP, con cantidad y PRECIO.** Se copia del modelo **al crear la
orden** (elección de Daniel sobre la alternativa "al explotar el MRP": así se revisa y ajusta **antes
de comprar nada**). Se puede quitar, agregar y editar; lo tocado queda marcado para que un cambio
posterior del modelo no lo pise (mismo patrón `ajustado`/`restaurarLineaBom` que el precosteo de F8
ya usa). **Incluye TELA**, aunque el viejo no lo hiciera — en v2 la tela tiene consumo por prenda y
alimenta el MRP.

*Medido sobre el volcado real del viejo (`OrdenesHab`, 5,451 órdenes / 28,432 renglones), porque la
forma correcta ya estaba probada por 30 años de operación:* **132 de 1,222 órdenes comparables
(10.8 %) NO coinciden con el BOM de su modelo** (72 quitaron un avío, 100 agregaron, 60 cambiaron
cantidad); en **2,577 órdenes la receta SOLO existe en la OP** (su modelo no tiene BOM); y **15,255
de 24,480 renglones (62 %) traen precio distinto al del catálogo** — sistemático (etiqueta de lavado
catálogo $0.14 / orden $0.15), o sea **la OP guardó el precio del día**: el snapshot sirve tanto para
la historia como para el override. *(Dos precisiones: el viejo NO congela la tela —`Ordenes.IdTelasDis`,
una sola en el encabezado— ni hace nada por orden con los bordados.)*

**(c) DESARROLLO LIBERA LA RECETA, y la puerta va antes de COMPRAR.** Daniel: *"la gente de desarrollo
tendría que tener la responsabilidad de que la OP tenga solo la información correcta… El departamento
de desarrollo es el responsable de dejar la OP con la información correcta **que se tiene que
comprar**"*. Cada renglón nace como **propuesta sin revisar**; Desarrollo ajusta, define las
**medidas por talla** y **libera**. Hasta entonces **no se puede explotar el MRP ni generar OC**.
**Cortar y producir NO se bloquean**: el piso no se detiene porque Desarrollo no haya terminado de
revisar; lo único que se frena es **gastar dinero** contra una receta que nadie miró.

⚠️ **NO se fuerza el OK uno por uno** (Daniel lo planteó como opción: *"¿chance que ella vaya
metiendo una por una? ¿o que vaya dando el OK para cada avío?"*). **El 89 % de las órdenes lleva la
receta del modelo tal cual**: obligar a 8 clics en cada OP entrena a la gente a clickear sin leer, y
ahí se pierde el control con la ilusión de tenerlo. En su lugar: **estado por renglón** (*sin revisar
/ revisado / ajustado*), **un botón de "marcar todo revisado"** para la receta que viene limpia, y el
renglón que se desvía del modelo **pintado distinto** para que pida atención sola. Permiso REUSADO
`desarrollo.administrar`.

**(d) LOS DOS AVISOS DE DESALINEACIÓN, partidos por si ya se comprometió dinero** (Daniel):

- **Si la OC NO se ha hecho** → *"debería de indicarle en rojo que el BOM cambió para que lo revise"*.
  Va en el **lugar de la decisión** (al explotar el MRP / generar la OC), diciendo **qué** cambió
  (agregado / quitado / cantidad / precio). No necesita notificación: la persona ya está ahí.
- **Si la OC YA se hizo** → *"el sistema debería de mandar un correo para que sepa que cambió"*.

⭐ **EL CORREO QUEDA FUERA, y con él el evento** — Daniel lo cerró horas después: *"ya veremos si vale
la pena lo de los correos o no… no tiene caso ahorita hacer nada de eso"*. El lead había argumentado
que el **evento** sí debía registrarse desde ahora en el outbox transaccional, porque si no se anota
cuando ocurre el día que exista el canal no habrá nada que mandar. **Ese argumento solo vale si va a
haber correo:** lo único que compra el evento es **EMPUJAR** el aviso hacia quien no está mirando, que
es justamente lo que hace el correo. Sin correo, no compra nada.

**Cómo queda entonces: la desalineación se calcula AL VUELO, sin guardar nada.** La receta de la OP
está congelada y el BOM del modelo está vivo → la diferencia sale de compararlos cuando alguien abre
la pantalla. Eso cubre **las dos** necesidades de Daniel (el rojo antes de la OC y el aviso en la
orden después) **sin evento, sin outbox y sin estado acumulándose**. *Se pierde saber cuándo cambió y
qué decía antes — irrelevante aquí: lo que se revisa es la diferencia de HOY, que es contra lo que se
va a comprar; y si el modelo cambia y lo regresan, no hay nada que revisar.* Si el correo llega a
valer la pena, agregar el evento en ese momento es chico; **el costo aceptado, con los ojos abiertos,
es que no se podrá mandar lo ocurrido antes.** *(Pendiente de esa hipotética etapa: a quién le llega
— default propuesto, quien hizo la OC + Desarrollo.)*

**(e) EL HISTÓRICO SE MIGRA, PERO FUERA DEL CATÁLOGO.** Daniel: *"no sé si vale la pena migrar toda la
info… mucha de esa info no es tan real. No quisiera hacer un catálogo con información no precisa…
pero no quiero que interfiera con el nuevo catálogo para no meter información basura acumulada de 30
años"*. Los 28,432 renglones de `OrdenesHab` **hoy no se migran** (ni una mención en `migracion/`: se
tiran completos). Entran al **archivo histórico** como cuarta tabla junto a
`HistoricoOrdenV1Linea`/`Proceso`, con **la regla ya establecida en §Post-F9.28**: el avío va como
**TEXTO**, resuelto una vez al migrar. Con eso **no se crea ni un solo registro en el catálogo de
avíos**, no aparece en ningún selector de captura, es de solo lectura y **no hay —ni habrá— botón de
"traer al catálogo"** (ese botón sería la puerta trasera por la que volvería la basura recién
depurada; por eso tampoco existe en el directorio histórico). Lo que se gana: cuando alguien pregunte
*"¿qué llevaba de verdad este modelo en 2019 y a qué precio?"*, la respuesta existe.

**(f) SI EL MODELO CAMBIA DESPUÉS DE LIBERAR: la OP queda CONGELADA.** Default del lead, aprobado por
Daniel. Para eso se congela. Muestra aviso de *"el modelo cambió desde que se liberó"* con opción de
traer los cambios **a mano** — mismo comportamiento que el precosteo con sus renglones ajustados.

- **Aplica en:** V1-E3d (ficha `docs/hoja-de-ruta/V1-etapas.md`). Receta de la OP + liberación +
  los cuatro consumidores (MRP, habilitación, costeo real, semáforo "orden completa") + los dos
  avisos + ETL al archivo histórico. Permiso REUSADO `desarrollo.administrar`.
- **Fecha:** 2026-08-14.

---

#### (Post-F9.44) — El arte y el BOM de la OP se hacen JUNTOS; los datos reales se mueven al final (DANIEL, 14-ago-2026)

**(a) EL ARTE SE CONSTRUYE JUNTO CON EL BOM DE LA OP.** Daniel, revisando el modelo en `prueba`:

> *"Habíamos quedado que el arte ya no va a salir de un catálogo, sino que va a vivir en el modelo
> directamente. No tiene sentido usar un catálogo de artes."*

Tenía razón en el reclamo: **§Post-F9.35 estaba decidido con todo detalle desde el 12-ago pero NO
construido** — la propia decisión cerraba con *"Aplica en: NADA todavía — decisión de rumbo"* y
*"sin fase asignada… el orden se decide al terminar ese repaso, por si aparecen otros cambios del
mismo tipo que convenga hacer juntos"*. Apareció uno: **§Post-F9.43 (el BOM vive en la OP) es el
mismo cambio con otro contenido** — algo que hoy vive suelto pasa a ser **plantilla en el modelo** y
**copia congelada en la OP**, donde el precio del modelo es de **referencia** y el real se define en
la orden. Presentadas las dos formas lado a lado, Daniel: **_"Hazlo junto, el arte y el BOM de una
vez."_**

**Por qué juntos, en concreto:** **una sola migración** (las dos tocan el mismo territorio y las dos
la requieren); **una sola pantalla** de receta de la OP, donde el arte es un renglón más —separados
saldrían dos pantallas parecidas que después habría que unir—; y **`costo-orden.ts` se toca UNA
vez** (ahí se suman maquila, aplicación y artes). La ficha de E3d ya decía que la receta de la OP
copia *"telas, avíos, medidas por talla y artes"*, así que el arte por orden hacía falta igual.

**Advertencia dada y aceptada:** juntas son una etapa **grande** (esquema, costeo, precosteo,
galería, pantallas del modelo, receta de la OP y ETL). Se puede partir **por dentro** —primero el
modelo y su arte, luego la receta de la OP— para poder probar antes, pero con **un solo diseño**
detrás, no dos.

**(b) LAS BASES DE DATOS REALES SE MUEVEN AL FINAL.** Daniel: *"Hasta terminar de ver que todo esté
funcional, movemos las bases de datos."* O sea: primero se verifica el **sistema** con lo que hay en
`prueba`, y solo después se trae el corte fresco de Access.

⚠️ **Precisión que se le dio y no contradice la decisión:** la verificación **funcional** (pantallas,
flujos, botones) no necesita datos frescos, pero el **ensayo de migración (V1-E7) SÍ** — se corre
sobre base vaciada con el corte real. Así que el ensayo queda **al final de la fila**, después de la
verificación funcional. Con esto, el **Excel definitivo del inventario de telas** (sus tres hojas de
catálogo) también espera al corte; el borrador de trabajo ya está en manos de Daniel y su columna
**✔ Revisión** avisará sola si algún nombre cambió entre tanto.

**(c) Contexto: Cloudflare ya lo está revisando Gabriel.** El bloqueo de subida de fotos
(§Post-F9.45) es configuración —llave S3 sin permiso de escritura o CORS del bucket—, no código.

- **Aplica en:** V1-E3d, que absorbe §Post-F9.35 (ficha `docs/hoja-de-ruta/V1-etapas.md`).
  **Requiere migración**; permisos y seed, no.
- **Fecha:** 2026-08-14.

---

#### (Post-F9.45) — El error de subida de archivos mentía y borraba de más (V1, 14-ago-2026)

Daniel intentó subir la foto de un modelo en `prueba` y le salió *"No se pudo subir la imagen.
Verifica tu conexión e intenta de nuevo"* **con internet perfecto**. Diagnóstico: la **causa raíz no
es código** sino **configuración de Cloudflare R2** (llave S3 sin permiso de escritura, o CORS del
bucket) — la trampa ya estaba documentada desde F1 (`docs/hoja-de-ruta/F1-etapas.md:222`). Lo que sí
era del sistema:

1. **El mensaje mandaba a buscar donde no era.** Un `fetch` del navegador solo lanza por red, DNS o
   **CORS**, y R2 al rechazar por permisos contesta **sin cabeceras CORS** → el navegador disfraza un
   403 de falla de red. El texto ahora dice que puede ser configuración del almacenamiento y **no** la
   conexión; el camino donde R2 sí contesta incluye el **código HTTP** (el dato que le sirve a
   Gabriel), sin jerga visible para el usuario.
2. **Cada intento fallido dejaba un fantasma:** el registro se crea ANTES de subir (inherente al
   flujo prefirmado), así que N intentos dejaban N fotos apuntando a una imagen que nunca llegó.
   Ahora el fallo limpia en best-effort **sin tapar** el error original.
3. **Eran OCHO sitios, no cuatro** → se extrajo el helper `frontend/src/api/subida-archivo.ts`. El
   **logo de empresa va SIN limpieza a propósito**: su flujo tiene un tercer paso de confirmación y
   su `DELETE` borraría el logo **anterior**, que sigue siendo el bueno.

**Lo que encontraron las dos rondas de revisión — los dos defectos los introdujo el propio arreglo:**

- **El borrado del arte no decía CUÁL foto quitar.** Siete módulos borran el archivo recién creado;
  bordados borraba *la que estuviera puesta*. Dos personas tocando el mismo arte a la vez → la
  limpieza del que falla borraba **la imagen buena del otro**, en silencio. Cerrado con `idArchivo`
  opcional + **compare-and-set** (`updateMany` con el `WHERE` sobre `idArchivoFoto`, que Postgres
  re-evalúa tras tomar el lock): **sin ventana**, a diferencia del check-then-act.
- **La corrección rompió el botón «quitar foto».** TanStack Query llama al `mutationFn` con **dos**
  argumentos, así que al darle un segundo parámetro a `quitarFoto` el contexto interno caía en
  `idArchivo` y openapi-fetch reventaba antes del DELETE. Barridos los ~160 `mutationFn:` del
  frontend: era el único con función de más de un parámetro.

**⚠️ LA LECCIÓN DE PROCESO, que vale más que el arreglo:** el lead validó con `npx tsc --noEmit`,
que **NO** es el comando del proyecto (el del frontend es `tsc -b --noEmit`; sin `-b` no recorre los
proyectos referenciados y **sale limpio con errores reales adentro**). Reportó "typecheck limpio" en
el commit y al usuario **estando rojos el typecheck Y el lint**. Lo cazó el reviewer independiente.
Queda en `CLAUDE.md` §8 con los comandos correctos y el corolario: **el CI es el único juez**.

De oficio y sin callarlas (§7.3): dos carreras **pre-existentes** del mismo molde
(`solicitarSubidaFoto` y `confirmarFotoBordado`: dos reemplazos concurrentes → P2025 → **500**),
cerradas con el mismo compare-and-set.

- **Aplica en:** PR #178 (en `prueba`). **SIN migración, SIN permisos, SIN seed.** Cambio de contrato
  menor y compatible: `idArchivo` opcional en `DELETE /api/bordados/{id}/foto`.
  ⚠️ **NO arregla la subida** — eso depende de que Gabriel corrija Cloudflare.
- **Fecha:** 2026-08-14.

#### (Post-F9.46) — Los tres cabos sueltos de la nomenclatura, y el nº de PRODUCCIÓN cambia de dueño (DANIEL, 15-ago-2026)

> 🔴 **AVISO (25-ago-2026): el ALCANCE DEL CONTADOR del código de desarrollo que se decide aquí quedó
> SUSTITUIDO por §Post-F9.108, bloque «✅ RESUELTO».** Daniel cambió de criterio: el consecutivo corre
> por **cliente + año** (⇒ el primer jogger de dama de ese cliente y año es `CYA-26-72-`**`002`**), no
> por el prefijo completo con concepto+género. **Todo lo demás de esta entrada sigue vigente** —el
> significado de los dos dígitos, la separación desarrollo/producción, los dos números del modelo—.
> No se borra nada (D3): se anota, porque esta entrada se escribió con el documento «Estructura de
> modelos FR Moda» (2014) enfrente y sigue siendo la que explica de dónde salen los dígitos.

La decisión §Post-F9.34 (12-ago) dejó tres puntos marcados como *"confirmar al construir"*. Se le
preguntaron a Daniel **antes** de arrancar la etapa, para no frenarla a media construcción. Los tres
quedan cerrados aquí, y **el tercero cambia lo que §Post-F9.34 había decidido.**

**1. «Vestido» y «Playera» NO son una serie encadenada — son conceptos distintos.**

> Daniel: *"Vestido es 4 y playera es 5."*

La tabla del documento «Estructura de modelos FR Moda» (2014) listaba el 5 como *"Playera, Vestido"*,
y eso abría la duda de si era el mismo truco de capacidad que Daniel usó en el género Caballero
(llenar la serie `x1` y continuar en la `x5`). **No lo es:** el 4 es Vestido y el 5 es Playera, cada
uno con su consecutivo independiente. La mención de "Vestido" en el 5 es ruido del documento viejo.

⚠️ **Consecuencia para el generador:** el encadenamiento de series aplica **SOLO al GÉNERO**
(Caballero = 1 y 5, con espacio real de 1,998 por concepto, §Post-F9.34). En el **concepto** NO se
encadena nada: 4 y 5 son espacios separados de 999 cada uno.

**2. El consecutivo de desarrollo corre por los DOS dígitos juntos** (concepto **y** género),
reiniciando cada año.

> Daniel, preguntado si "tipo de prenda" eran los dos dígitos o solo el concepto: *"lo que
> recomiendes está bien."*

**Esta la decidió el lead, no Daniel** — queda dicho para que nadie la cite como dictada por el
negocio. La razón: si el contador corriera solo por el concepto, los números saldrían con huecos
entre géneros (el jogger de dama heredaría el consecutivo del de caballero). Así, `CYA-26-71-001` es
el primer jogger de caballero de C&A con entrega en 2026, y el primer jogger de dama del mismo
cliente y año es `CYA-26-72-001`, no el `002`. Confirma lo que ya se había anotado como lectura del
lead en §Post-F9.34.

🔴 **ESTE PUNTO 2 QUEDÓ SUSTITUIDO (25-ago-2026, §Post-F9.108 «✅ RESUELTO»).** Daniel lo decidió al
revés —*"Me gusta solo por cliente por año. O sea 71-001 y el siguiente 72-002"*—: **el contador corre
por `cliente + año`** y el jogger de dama **sí** hereda el consecutivo (`CYA-26-72-`**`002`**). Se deja
la redacción original porque explica el razonamiento del lead que Daniel descartó — pero **la regla
vigente es la de §Post-F9.108**.

**3. ⭐ EL Nº DE PRODUCCIÓN SÍ SE PRECARGA — Daniel cambió de opinión.**

> Daniel: *"Estoy cambiando de opinión. Chance sea mejor generar nuevos números de modelo para
> producción…"*

**Esto REEMPLAZA el punto 7 de §Post-F9.34**, donde Daniel había pedido lo contrario (*"normalmente
yo defino los modelos de producción, no el sistema"*, y el consecutivo libre **a la vista pero no
precargado**). Preguntado de nuevo con las tres opciones sobre la mesa, eligió:

**El sistema precarga el siguiente número libre de esa combinación, y Daniel lo puede cambiar.**

- Al **pasar un modelo a producción**, el campo llega **ya lleno** con el siguiente consecutivo libre
  (los dos primeros dígitos ya vienen decididos desde el código de desarrollo, §Post-F9.34 punto 4).
- Si le sirve, acepta y listo — el paso se vuelve un trámite de un clic.
- Si quiere otro, **lo borra y teclea el suyo**: la última palabra sigue siendo de Daniel.
- El sistema **valida** que no esté repetido y **avisa** (no bloquea) si los dos primeros dígitos no
  cuadran con el tipo de prenda y el género del modelo, y cuando la combinación se acerca al tope de
  999. Eso NO cambia: viene de §Post-F9.34 y sigue vigente.

**Por qué el cambio no es un capricho:** con precarga se acaban los huecos y los repetidos por
descuido, que es justo lo que un catálogo de 30 años acumula; y como el campo es editable, Daniel no
pierde la excepción cuando la quiere. Lo que se abandona es la postura de "el sistema no propone".

**El código de DESARROLLO lo sigue armando el sistema completo** (cliente + año de entrega + los dos
dígitos + consecutivo), porque es mecánico y no tiene criterio de negocio de por medio. Eso no se
tocó.

- **Aplica en:** ✅ **V1-E3n (20-ago-2026)**. El campo del nº de producción llega **precargado** con el
  siguiente libre y es **editable**, tanto en «Pasar a producción» del catálogo como en «Generar OP»;
  repetido BLOQUEA, dígitos que no cuadran y serie cerca del tope AVISAN. Migración
  `20260820160000_modelos_desarrollo_vs_produccion`; permisos, no; seed sí (los dígitos).
- **Fecha:** 2026-08-15.

#### (Post-F9.47) — La receta NUNCA enseña una cifra distinta de la que cuesta (DANIEL, 15-ago-2026)

Salió de la revisión de **V1-E3c**. El encargo original pedía mostrar en cada renglón de la receta *"el
precio del proveedor amarrado; si no hay amarre, el de catálogo marcado como referencia"* — una regla
que **dictó el lead**, no Daniel. El reviewer independiente demostró que esa regla **seguía mintiendo**:
la cascada real de `dominio/costos/resolucion-precios.ts` tiene más caminos que los dos supuestos, y en
tres de ellos la pantalla enseñaba un número y el motor costeaba otro.

**Los tres desfases encontrados:**

| Caso | Lo que mostraba la pantalla | Lo que costeaba el motor |
|---|---|---|
| Tela amarrada a proveedor con **precio por color** | `$62.50 · Alsatex` (el precio base) | **$78.00** — el del color negro en `TelaProveedorColor` (`resolucion-precios.ts:133-135`) |
| **Sin amarre** | el `precioReferencia` del catálogo, con chip "referencia" | el del **proveedor más barato normalizado** (`:222-232`) |
| Amarre cuyo proveedor **no tiene precio** | `—` con el nombre del proveedor | cae callado al más barato (`:218-220`) |

El primero era además un **dato muerto**: el backend calcula y publica `precioPorColor` a propósito
(`bom-modelo.ts:171`), y el frontend nunca lo mapeaba — el campo solo aparecía en un fixture de prueba.

**La regla que queda (elegida por Daniel de tres opciones):**

> **La receta muestra SIEMPRE el precio con el que se va a costear, y dice de dónde salió.**

- Sin amarre → el del **proveedor más barato**, nombrándolo (`$4.20 · el más barato: Zippers MX`), y
  **conservando la marca de "no negociado"** (que es la información útil: falta amarrarlo).
- Con amarre y precio por color → el **del color**, no el base.
- Amarre sin precio → se distingue que hay amarre pero sin precio, y qué se usa en su lugar.
- `Avio.precioReferencia` se muestra **solo** cuando de verdad es lo que costea (ningún proveedor con
  precio).

**⭐ Lo que Daniel DESCARTÓ, y por qué importa:** la tercera opción era arreglar el desfase **al revés**
—cambiar el motor para que sin amarre costeara al `precioReferencia`—. Se descartó a propósito: eso
movería los números de los precosteos **ya calculados y de los congelados**, que son la base de precios
pactados con clientes. **El motor de costeo NO se toca; la pantalla se alinea al motor, nunca al revés.**

- **Aplica en:** V1-E3c (`EditorBom.tsx`). **SIN migración, SIN permisos, SIN seed.** Cambio de
  presentación: ninguna cifra calculada cambia de valor.
- **Fecha:** 2026-08-15.

#### (Post-F9.48) — ⭐ UN SOLO COSTO: manda el precio REAL de compra más reciente (DANIEL, 15-ago-2026)

> Daniel, al enterarse de que el pre-costo rápido y el precosteo persistido costeaban distinto el
> mismo renglón: *"No hay ningún motivo por el cual tener dos precios distintos. Hay que unificarlo.
> Si ya tenemos precios reales, lo mejor es tomar ese costo. El más actualizado. El de referencia
> podría funcionar solo cuando es algo nuevo que no se ha comprado. No hay ningún motivo para tener
> dos costos diferentes. Entre más unificado esté, mejor."*

**De dónde salió.** La revisión de **V1-E3c** destapó que conviven **tres cifras** para el mismo
renglón: la receta (regla del motor persistido), el pre-costo rápido de F7 y el precosto congelado.
El reviewer documentó **cuatro** divergencias de `pre-costo.ts` —no una, como decía su comentario—:
sin amarre usa `precioReferencia` en vez del más barato; **no conoce `promedio-medidas`**; **ignora
`consumoPorTalla`** (justo lo que V1-E3c acaba de hacer capturable); y no redondea antes de
multiplicar. Hasta esta etapa la discrepancia era invisible; **ponerla en pantalla la volvió
insostenible.**

**No es una idea nueva: es la misma que Daniel ya dictó el 26-jul (§Post-F9.5)** para el costo real de
una orden (*"al comprar cambian con frecuencia el proveedor y el precio"*), y que hizo que los avíos
genéricos se valuaran al **último precio de compra**. Lo que se decide aquí es **extender ese criterio
a la receta y al precosteo**, que seguían viviendo del catálogo.

**LA CASCADA ÚNICA — una sola para todos los motores:**

| # | Escalón | Cuándo aplica |
|---|---|---|
| 1 | **Último precio de COMPRA REAL** | siempre que ese material ya se haya comprado |
| 2 | Precio del proveedor en el catálogo | si a ese proveedor nunca se le ha comprado |
| 3 | **`precioReferencia` del catálogo** | **solo lo nuevo que nunca se ha comprado** (Daniel, textual) |
| 4 | `sin-precio` | se dice; NO se inventa un `$0.00` mudo |

**⭐ El cruce con el amarre de Desarrollo — la pregunta fina, resuelta por Daniel:**

> **El amarre elige el PROVEEDOR; el precio es el de la última compra A ESE proveedor.**

Elegido de tres opciones. Lo que Desarrollo negocia es **con quién** se compra; el costo sale de la
realidad más reciente con ese proveedor. Si a ese proveedor aún no se le ha comprado el material, se
usa su precio negociado; y si tampoco hay, el de referencia. **Así el trabajo de negociación no se
tira** (sigue mandando la elección de proveedor) y el costo no se queda viejo. Se descartaron: que el
precio negociado mandara siempre (se queda viejo si el proveedor sube y nadie actualiza el amarre) y
que la última compra mandara siempre sin importar el amarre (amarrar dejaría de tener efecto).

**Qué se entiende por "comprado":** lo mismo que ya fijó §Post-F9.5 regla 1 — **manda la OC
AUTORIZADA**, no lo recibido ni lo surtido. Se reusa el criterio existente, no se inventa otro.

⚠️ **CONSECUENCIA QUE HAY QUE DECIR EN VOZ ALTA:** esto **SÍ cambia el motor de costeo**, a
diferencia de §Post-F9.47 (que fue solo de presentación). Los precosteos **ya congelados NO se
mueven** —son fotografías, y su valor es justo ese—, pero **todo cálculo nuevo dará números
distintos** a los de ayer. Es exactamente lo que Daniel quiere (números reales en vez de catálogo),
y por eso queda escrito: quien compare un precosto viejo con uno nuevo verá diferencias **por
diseño**.

**Lo que también se cierra de paso:** `pre-costo.ts` (F7) deja de ser un motor aparte. El reviewer
verificó que **no escribe nada** —es lectura pura, sin `create`/`update`/`enTransaccion`—, así que
alinearlo **no mueve ningún precio pactado**. La asimetría temida era la contraria a la real.

- **Aplica en:** etapa propia del track V1, **después** de V1-E3c (un solo coder a la vez sobre el
  árbol). Toca `dominio/costos/resolucion-precios.ts`, `dominio/costos/pre-costo.ts` y la lectura del
  BOM; reusa la maquinaria de último precio de compra que ya existe en
  `dominio/costos/costo-real-compras.ts`. **Requiere decidir al construir** si el "último precio" se
  lee en vivo o se materializa (rendimiento), y **pruebas de no-regresión** de que los precostos
  congelados siguen dando lo mismo.
- **Fecha:** 2026-08-15.

#### (Post-F9.49) — La OC nace del último precio DE ESE proveedor, y la migración deja de borrar lo capturado en v2 (DANIEL, 15-ago-2026)

Dos cabos que dejó abiertos §Post-F9.48, preguntados juntos para no frenar la construcción.

**1. ⭐ El precio con el que nace un renglón de ORDEN DE COMPRA (explosión del MRP).**

El coder de V1-E3e había **excluido el MRP a propósito** del escalón de "último precio de compra", con
una razón que el reviewer avaló: lo que el MRP produce no es un costo, es el **precio sugerido de una
OC dirigida a un proveedor concreto**, y poner ahí el precio de una compra a **otro** emitiría una
orden con un precio que ese proveedor nunca dio.

Daniel resolvió el fondo **sin romper ese argumento**, eligiendo de tres opciones:

> **La OC nace con lo último que ESE proveedor cobró; si nunca se le compró, su precio de catálogo.**

Se descartaron: dejarlo como estaba (el precio de la OC queda desalineado de lo que ese proveedor
cobró la última vez) y usar el último precio pagado **a quien sea** (le mandaría al proveedor A una
orden con el precio que dio el proveedor B).

⚠️ **A quién se le compra NO cambia:** lo sigue fijando R1/F4 (el amarrado; si no, el más barato).
Lo único que cambia es **a qué precio nace la línea**. Con esto el sistema queda con **un solo
criterio** de punta a punta, que es lo que Daniel viene pidiendo desde §Post-F9.48 (*"no hay ningún
motivo para tener dos costos diferentes"*).

**2. La migración NUNCA borra lo que se capturó en el sistema nuevo.**

Viene de un hallazgo del reviewer en V1-E3c: re-correr `etl-bom-modelos` **elimina los avíos
agregados en v2** que no están en el CSV de Access y, por cascada, sus `ModeloAvioTalla`. Es la misma
familia del amarre de precio que ya se protegió ahí, en otra dimensión. Elegido de dos opciones:

> **La migración actualiza lo que viene del Access, pero nunca borra lo capturado en v2.**

Importa porque **el ETL se re-corre varias veces antes del arranque y en el ensayo (V1-E7)**: sin
esto, cada corrida borra trabajo humano **en silencio**. Se descartó la alternativa (que la migración
mande y limpie) porque su única ventaja —fidelidad literal al Access— no compensa perder captura
hecha a mano entre corrida y corrida. **Exige prueba de re-corrido** que falle de verdad si alguien
quita la preservación, como la que ya existe para el amarre (`etl-modelos.int.test.ts:183-219`).

- **Aplica en:** V1-E3e (`dominio/compras/mrp.ts` y `migracion/loaders/bom-modelos.ts`). **SIN
  migración de esquema, SIN permisos, SIN seed.**
- **Fecha:** 2026-08-15.

#### (Post-F9.50) — Las cinco reglas que el BOM en la OP obligó a fijar (V1-E3d pieza B, 15/16-ago-2026)

Ninguna la preguntó Daniel: **salieron de construir §Post-F9.43/.44** y de dos rondas de revisión. Se
asientan porque **cambian lo que la gente ve y hace**, no solo cómo está escrito el código.

**1. Una orden nueva ya NO nace «completa»: nace «capturada — falta liberar la receta».**
Es el control que Daniel pidió (*"la información correcta que se tiene que comprar"*), pero es lo más
visible de la etapa en el día a día. La puerta va **antes de comprar**: sin liberar no se puede
explotar el MRP ni generar OC — **cortar y producir NO se bloquean**.

**2. El backfill LIBERA las órdenes vivas que ya existen** (no las canceladas, no las de receta
vacía). Sin esto, el día del deploy **todo el backlog quedaría sin poder comprar** hasta que alguien
firmara orden por orden. Se paga con que el control empieza a aplicar a las órdenes **nuevas**, no
retroactivamente — que es lo correcto: nadie revisó esas recetas, y fingir que sí las revisó sería
peor que no pedirlo.

**3. El backfill NO congela precios** (`precio` NULL → cae al catálogo). Reproducir la cascada de
precios en SQL sería **inventar un número que nadie calculó** y estamparlo como si fuera un acuerdo.
Las órdenes viejas siguen costeando por catálogo, como hasta hoy; las nuevas sí congelan.

**4. Quitar un renglón NO lo borra: lo marca como excluido (lápida).** Es lo que permite distinguir
*"a esta orden le quité la jareta"* de *"el modelo agregó una jareta que esta orden no tiene"* —
sin la lápida las dos se ven idénticas y el aviso de desalineación no podría existir. Coherente con
D3, y además la lápida **revive** si se vuelve a agregar el mismo material.

**5. ⭐ Editar una receta ya liberada REVOCA la firma.** Salió de un hallazgo del reviewer: sin esto
se podía meter material nuevo a una receta ya firmada y **comprarlo sin que nadie lo volviera a
revisar** — o sea, la puerta se podía rodear por dentro. Ahora agregar/editar/quitar/restaurar
re-abren la receta y dejan `liberacion-revocada` en la bitácora con su motivo, y la orden vuelve a
«falta liberar la receta». **«Marcar todo revisado» NO revoca** (no cambia qué se compra).

**6. El aviso de desalineación distingue quién movió el precio.** Si lo movió una persona en el
modelo → *"pasó de X a Y en el modelo"*, y con OC hecha enciende el **rojo**. Si lo movió **la última
compra real** (el motor de §Post-F9.48) → *"el modelo no cambió: cambió el precio de compra"*, y
**se informa sin encender la alarma**. Sin esta separación, cada OC autorizada dejaría en rojo
permanente a toda orden viva con esa tela, y el aviso se volvería ruido de fondo que nadie mira.

- **Aplica en:** V1-E3d pieza B. **REQUIERE MIGRACIÓN** (4 tablas nuevas + backfill) — es el primer
  despliegue de la sesión que no se deshace con un clic. Permisos: **ninguno nuevo** (reusa
  `desarrollo.administrar`); seed: no.
- **Fecha:** 2026-08-15/16.

#### (Post-F9.51) — Las reglas que las DEFENSAS obligaron a fijar (V1-E4, 16-ago-2026)

Daniel quiere operar el sistema. Esta etapa es la que se construye **antes** de capturar trabajo real:
*"lo peor que puede pasar en producción no es que algo truene: es que corrompa datos sin avisar"*.
Ninguna de estas reglas se le preguntó a Daniel — **son consecuencias de tapar los siete huecos**, y se
escriben aquí porque cambian cómo se comporta el sistema.

**1. ⭐ La identidad de una importación es `ocCliente` + CLIENTE, y las canceladas NO cuentan.**

Importar dos veces la misma OC del cliente **duplicaba todo en silencio** —pedido, órdenes, nº de
producción, ruta crítica y explosión de materiales— y se descubría semanas después **cortando doble**:
tela y horas de maquila reales. La defensa va en los **dos** importadores (PDF y Excel).

- **Excluir las canceladas es deliberado:** si la importación anterior se canceló, re-importar es
  legítimo y no debe trabarse.
- **El resurtido NO se atiende re-importando el papel** — se atiende con el botón de resurtido (punto 3
  de esta misma etapa). Por eso la regla no produce falsos positivos.
- **NO se puso un `@@unique(cliente, ocCliente)` en la BD**, y la razón es del negocio: esa columna
  viene del ETL del sistema viejo, donde el nº de OC **no estaba controlado** (repetidos y vacíos). El
  unique tumbaría la migración. El candado + la re-verificación dentro de la transacción dan la
  garantía **hacia adelante** sin tocar el histórico.
- ⚠️ **Límite conocido y aceptado:** un Excel **sin OC capturada** no se puede deduplicar — sin ese
  dato no hay identidad, e inventar una (nombre de archivo, fecha) **bloquearía importaciones
  legítimas** del mismo cliente el mismo día.

**2. Un precosto NO se puede congelar en CERO.** Un modelo sin receta generaba las anclas de maquila y
corte en $0 y la versión se congelaba **inmutable** — de ahí podía salir el precio de un cliente. Ahora
se rechaza al congelar, no al aprobar.

**3. «Cancelar pedido» dice la verdad, y puede cancelar en cascada.** Antes afirmaba que dejaba de
producirse **y las OPs seguían vivas, cortándose**. Ahora: sin OPs vivas cancela igual; con OPs vivas
**se niega nombrando los folios**; y con petición explícita + motivo las cancela en la misma
transacción, con bitácora **por orden**.
⚠️ **Cancelar una OP que ya llevaba corte SÍ se permite** — es **paridad exacta** con lo que el flujo
manual ya hacía, no una puerta nueva. Verificado línea por línea contra `cancelarOrden`.

**4. Un desarrollo metido por error en una lista de precios ya se puede sacar.** El
`@@unique([idDesarrollo])` de la BD significaba que ese desarrollo **no podía entrar NUNCA a otra
lista**: quedaba atrapado para siempre. El borrado es **físico** —un borrado suave no soltaría el
unique, o sea que no abriría la trampa—, y por eso **el objeto completo del `antes` más todos sus
`NegociacionEvento` van a la bitácora** antes de borrar, en la misma transacción (D3 se cumple ahí).

**5. El Pedido Real se puede cancelar** (§Post-F9.37 punto 9 — cierra el TODO abierto desde F2-E1).
Cancelación **suave con motivo**, y **cancelado deja de admitir edición y seguimiento**, para que no sea
un adorno. **Requiere migración** (`pedido_real` += `cancelado`, `motivo_cancelada`).

- **Aplica en:** V1-E4. **Una migración** (`20260816120000_cancelar_pedido_real`). **CERO permisos
  nuevos, CERO seed** — reusa `listas.administrar`, `pedidos-reales.administrar` y `ordenes.cancelar`.
- **Fecha:** 2026-08-16.

#### (Post-F9.52) — El ARTE, como Daniel lo usa de verdad (DANIEL, 16-ago-2026)

Daniel revisando la ficha del modelo en `prueba`, **dos días después** de que el arte se mudara del
catálogo al modelo (§Post-F9.35 / V1-E3d pieza A). Siete observaciones. **Cada una verificada contra
el código antes de escribirla aquí** — las siete aplican, ninguna estaba resuelta.

**1. El NOMBRE del arte no hace falta.**
> *"No necesita tener un nombre del arte. Si la tabla exige un nombre, ponle uno compuesto. O si no,
> no es necesario."*

Hoy `ModeloArte.nombre` es **obligatorio** (`String`, sin `?`). Deja de pedirse al usuario: o se
compone solo (tipo + posición + consecutivo, p. ej. *"Bordado frente 1"*) o desaparece. ⚠️ Ojo: hay un
`@@unique([idOrden, nombre])` en `OrdenArte` que un nombre compuesto debe seguir respetando.

**2. Falta decir si va en el FRENTE o la ESPALDA.**
> *"Creo que es importante definir si va en el frente o la espalda."*

Campo nuevo. No existe hoy.

✅ **CERRADO (Daniel, 16-ago-2026): CAMPO ABIERTO, no catálogo.** Preguntado si eran solo frente y
espalda o convenía un catálogo chico para agregar posiciones sin tocar el programa: *"puede ser un
campo abierto. Porque a veces son cosas muy específicas, que no tendría caso tenerlas en un
catálogo."* **Texto libre.** Más simple que la propuesta del lead y mejor para el caso real.

**3. El selector de proveedores debe mostrar SOLO los de arte.** Hoy muestra **todos**.

> Daniel: *"Tengo entendido que los proveedores se pueden clasificar mediante un catálogo de tipos de
> proveedores. Creo que ahí hay que ponerle que son de arte."*

⚠️ ~~**Corrección al entendido de Daniel:** `Proveedor.tipo` NO es un catálogo, es un enum grabado en el
programa; agregar `ARTE` exige migración.~~ ❌ **ESA "CORRECCIÓN" DEL LEAD ERA FALSA. Daniel tenía
razón** y lo demostró con una captura de la pantalla de proveedores.

✅ **Lo que de verdad hay (verificado en `prisma/seed.ts:354-369`):** existe **`ProveedorRol`**, un
**catálogo real en tabla, N:N** con el proveedor — *"Roles / servicios: qué hace este proveedor (elige
al menos uno)"*. Ya trae **nueve** roles sembrados: `maquila-costura`, `corte`, `estampado`, `bordado`,
`lavado`, `aplicacion`, `vende-telas`, `vende-avios`, `otros-servicios`. El `codigo` es la clave
estable y **el nombre visible es editable**.

**El error del lead:** miró `Proveedor.tipo` —una clasificación **vieja y burda** que convive con
ésta— y concluyó que no existía el catálogo. Lección: cuando el dueño dice *"tengo entendido que ya
existe"*, **buscar en la pantalla antes que en el esquema**.

✅ **CERRADO (Daniel, 16-ago-2026): el filtro del arte se hace por ROLES.** No hace falta enum nuevo, ni
migración, ni reclasificar a nadie: los proveedores de arte ya se marcan con `bordado` / `estampado`.
*(Al construir: decidir si `lavado` y `aplicacion` también cuentan como arte para ese selector —
Daniel los trata como tipos de arte en el punto 4.)*

**4. ⭐ El TIPO de arte debe ser un CATÁLOGO, no una lista fija.**
> *"Aparte de bordado y estampado, podríamos tener lavados, embosado, etc. Creo que hay que tener un
> catálogo de tipos de arte."*

Hoy es un **enum** (`TipoArte`: `BORDADO`/`ESTAMPADO`) — agregar un tipo exige migración y despliegue.
Pasa a catálogo administrable, como `TipoProceso` (F3-E1), que es el precedente del repo.

**5. Cada arte lleva SUS PROPIAS FOTOS, en plural.**
> *"Cada arte debe de llevar sus propias fotos (aparte de las fotos del modelo)."*

Hoy `ModeloArte.idArchivoFoto` es **UNA sola** foto. Pasa a colección, como `ModeloFoto`.

**6. Las PUNTADAS se van.**
> *"Las puntadas solo aplica para bordados. Yo quitaría ese campo."*

⚠️ Quitar la columna **borraría el dato de los bordados que sí lo tienen** (D3: nada se destruye en
silencio).

✅ **CERRADO (Daniel, 16-ago-2026): NO se borra — se ATA AL TIPO.** El lead propuso que el campo
dependa del tipo de arte (punto 4): que aparezca en bordado y desaparezca en estampado, lavado o
embosado. Daniel: *"Ok como tú lo dices."* Consigue lo que pedía —no ver un campo que no aplica— sin
tirar la historia de los bordados existentes.

**7. ⭐ El proveedor se busca por CUALQUIER PALABRA — y esto ya estaba acordado.**
> *"El proveedor debe de buscarse por cualquier palabra. No solo por la primera letra de la primera
> palabra. **Habíamos acordado** que siempre que se busque un proveedor debe de buscar en todas las
> palabras."*

**Causa verificada:** el selector del arte es un `SelectNativo` con `porPagina: 100`
(`DialogoArte.tsx:46,237`) — el "buscar tecleando" es el **typeahead del navegador**, que solo pega por
**prefijo**. El servidor **ya busca bien** (`idsPorNombreSinAcentos`: `LIKE %texto%` sin acentos, casa
en medio del nombre).

⚠️ **Es la TERCERA vez esta semana que aparece este patrón**: el mismo defecto se arregló en el BOM
(V1-E3c punto 4) y en las 12 pantallas de cliente (V1-E4 punto 7), **y no viajó al arte**. Al
construirlo: **reusar `ComboboxBuscable`**, y de paso **barrer TODOS los `SelectNativo` de proveedor
que queden**, no solo éste.

✅ **CERRADO (Daniel, 16-ago-2026):** preguntado si bastaba con que **una palabra** case en cualquier
parte del nombre (lo que el servidor ya hace) o si quería además que *"moda textil"* encontrara
*"Textiles Moda del Norte"* con las palabras sueltas y en otro orden — *"como ya funciona el buscador,
que busques una palabra está perfecto"*. **NO se parte la búsqueda en palabras.** El trabajo es
puramente de pantalla: cambiar el desplegable nativo por el `ComboboxBuscable` que ya consume esa
búsqueda.

**8. DIFERIDO a una etapa posterior, por decisión de Daniel:**
> *"En una siguiente etapa quiero poder poner la ficha del estampado."*

La **ficha técnica del estampado** adjunta al arte. **No entra en la primera versión**; queda anotado
para no perderse. Emparienta con las fichas técnicas estructuradas (R5) que ya estaban pendientes.

⚠️ **Ripple que hay que mirar al construir:** **`OrdenArte` copia de `ModeloArte`** desde V1-E3d pieza
B. Todo cambio de forma aquí (nombre, posición, tipo-catálogo, fotos múltiples, puntadas) **debe
recorrer también la receta congelada de la orden**, su copia y su comparador de desalineación.

- **Aplica en:** etapa propia — **`V1-E3f`**, después de V1-E4. **REQUIERE MIGRACIÓN** (nombre,
  posición, catálogo de tipos, fotos múltiples, puntadas) y probablemente **seed** (los tipos de arte
  iniciales). Permisos: reusar los de catálogos.
- **Fecha:** 2026-08-16.

#### (Post-F9.53) — Las fotos masivas se cargan por el NOMBRE del archivo, y el respaldo se adelanta (DANIEL, 16-ago-2026)

**1. Cómo llegan las fotos del sistema viejo — confirmado por Daniel y verificado en el código.**

> Daniel: *"En control viejo, cada orden lleva un modelo y dentro de ese modelo hay dos campos con los
> nombres de las fotos (jpg): si un archivo es `51001.jpg`, el campo dice `51001`. Eso para fotos de
> modelos… y de artes es similar. Hay un catálogo de artes y las fotos funcionan de la misma manera.
> ¿Sí vas a poder subir las fotos con esa referencia?"*

✅ **Sí, y ya está construido exactamente así** desde F1-E7 (`migracion/loaders/fotos-modelos.ts`),
esperando únicamente la carpeta física:

- `Foto1` = **frente**, `Foto2` = **espalda**. El loader busca en el directorio el archivo cuyo
  **nombre-base sin extensión** coincida con el valor del campo, **sin importar mayúsculas**, y acepta
  `.jpg .jpeg .png .gif .bmp .webp`. Es **idempotente**: re-correrlo no duplica.
- **Los artes igual**, desde la columna `Foto` de `Bordados.csv`. ⭐ Y el loader **ya está al día con
  V1-E3d pieza A**: como los artes compartidos **se duplicaron** al mudarse al modelo, sube la foto
  **una vez** y la liga a **todas** las copias de ese arte (vía `mapeo_migracion`), en vez de apuntar a
  la tabla `Bordado` que ya no existe.
- **Las órdenes NO necesitan carga propia:** la foto vive en el **modelo** y cada orden la muestra por
  su modelo. Cargar los modelos deja a todas las órdenes con foto.

**2. Se pide una MUESTRA antes del go-live.** El loader está probado contra datos **inventados**, nunca
contra los nombres reales. Daniel ofreció subir un ejemplo (*"¿quieres que te suba un ejemplo para ir
construyendo algo?"*) y el lead lo aceptó: **10–15 archivos de modelos y otros tantos de artes, con sus
nombres originales**, para cazar hoy lo que si no aparece el día de la migración — acentos, espacios al
final, extensiones en mayúsculas, o la convención `código-P` de la foto de espalda. **La carpeta
completa y los datos correctos llegan hasta el go-live**, como Daniel indicó.

**3. El respaldo diario cifrado se ADELANTA.** Preguntado si convenía sacarlo de V1-E6 y hacerlo en
cuanto cierre V1-E4 —porque **hoy no existe** un respaldo propio del sistema y es lo único de la lista
que expone de verdad al empezar a capturar trabajo real—: *"Sí ok."* **Se construye antes que el resto
de E6.**

- **Aplica en:** el punto 1 no requiere construir nada (ya existe); el punto 2 es un insumo de Daniel;
  el punto 3 reordena V1-E6.
- **Fecha:** 2026-08-16.

#### (Post-F9.54) — Los nombres de los roles de proveedor, y el principio del "proceso raro" (DANIEL, 16-ago-2026)

Daniel, viendo la pantalla de proveedores: *"Hoy tienes esto ya definido. Ya hay arte (estampado), arte
bordado, aplicaciones, lavados. Prácticamente ya hay todo."*

**1. Renombres pedidos.** El `codigo` es la clave estable; solo cambia el **nombre visible**:

| Código | Antes | **Ahora** |
|---|---|---|
| `estampado` | Prov. de Arte (estampado) | **Estampador** |
| `bordado` | Prov. de Arte (bordado) | **Bordador** |
| `vende-telas` | Vende telas | **Telas** |
| `vende-avios` | Vende avíos | **Avíos** |

> *"Yo cambiaría el nombre a Estampador, Bordador… El vende telas y vende avíos lo dejaría solo como
> Telas y Avíos, le quitaría el «Vende»."*

⚠️ ~~Los nombres se siembran en `ROLES_PROVEEDOR_BASE` y el seed **actualiza el nombre si el código ya
existe** → el deploy de este cambio **requiere `SEED_ON_START=true`**.~~

🔴 **CORRECCIÓN (18-ago-2026) — lo tachado arriba era FALSO.** Lo detectó el coder de V1-E3f y lo
**confirmó el reviewer independiente ejecutando**: `sembrarRolesProveedor` (`seed.ts:381-386`) usa
`update: {}`, que **explícitamente NO toca el nombre**. Con `SEED_ON_START=true` los renombres que pidió
Daniel **no ocurrirían** — el deploy pasaría en verde y los nombres seguirían igual, que es la peor forma
de fallar: *en silencio y con cara de éxito*.

**La etapa de proveedores necesita otra vía:** o la pantalla de catálogos permite renombrarlos a mano
(lo mejor — sin despliegue), o un `UPDATE` acotado en la migración. **Verificar cuál antes de
construir**, y no dar por buena esta nota sin volver a mirarla: ya mintió una vez.

**2. ⭐ El principio del "proceso raro" — vale más que el renombre.**

> Daniel, sobre el embosado: *"dentro de aplicación podemos poner el embosado, o podemos dar de alta
> embosado también… o en otros. **Hay procesos que hago muy muy poco. No justifica hacer todo un
> desarrollo para las pocas veces que lo ocupo.**"*

**Regla de diseño que queda para todo el proyecto:** un proceso poco frecuente **no justifica una
entidad propia**. Se acomoda en `aplicacion` o en `otros-servicios`, o se le da de alta un rol si es
tan barato como una fila de catálogo — pero **nunca** se le construye flujo, pantalla ni reporte
propio. Es el mismo criterio con el que Daniel apagó la Ruta Crítica en la v1 (§Post-F9.36 punto 1) y
descartó la remisión y el packing list (punto 6).

**Aplicado aquí:** el **embosado** NO recibe rol propio de entrada. Si al usarlo resulta que estorba
no distinguirlo, se agrega entonces — una fila de catálogo, no un desarrollo.

**3. Daniel anunció más observaciones sobre proveedores**, que mandará aparte para no cortar el hilo en
curso. **Pendiente de recibir.**

- **Aplica en:** V1-E3f (junto con los siete del arte). Los renombres van en `prisma/seed.ts`
  (**requiere `SEED_ON_START`**). Sin migración: los códigos no cambian.
- **Fecha:** 2026-08-16.

#### (Post-F9.55) — Alta de proveedor leyendo su Constancia de Situación Fiscal (DANIEL, 16-ago-2026)

> Daniel: *"En proveedores me gustaría poder subir su Constancia de Situación Fiscal para darlos de
> alta. Con ese documento se llena toda la info en automático: RFC, direcciones, etc."*

**Qué se llenaría, y por qué NO requiere migración.** Los campos que la constancia trae ya existen en
`Proveedor` (F1-E1B / R15): `rfc`, `razonSocial`, `regimenFiscalSat`, `codigoPostalExpedicion` y
`direccion` (texto libre, se compone de calle/número/colonia/municipio/estado). **Cero cambios de
esquema** para los datos; sí hace falta guardar el PDF como adjunto.

**El precedente que lo abarata:** ya hay un lector de PDF en producción — el **importador de OC de C&A**
(`parseo-pdf-cya.ts`, §Post-F9.2). Misma mecánica: extraer texto y mapear a campos. **Se reusa, no se
inventa.**

**⭐ REGLA: el documento PROPONE, la persona CONFIRMA. No hay llenado silencioso.**
El `rfc` y el `regimenFiscalSat` alimentan el **CFDI**: un carácter mal leído no se nota hasta que una
factura sale mal. El flujo es subir → la pantalla se llena con los datos resaltados → **Aceptar**. Dos
segundos más a cambio de no meter basura fiscal en silencio. *(Mismo criterio que §Post-F9.34 punto 7
para el nº de producción: el sistema asiste y verifica, no decide.)*

**Tres cosas a construir con cuidado:**

1. **Dos formatos:** persona **física** (nombre y apellidos) y persona **moral** (razón social). Traen
   campos distintos; se contemplan los dos.
2. **El SAT cambia el formato cada tanto.** Si no logra leerlo, **NO bloquea el alta**: se captura a
   mano como hoy, avisando que no pudo. Degradar con gracia, nunca al revés.
3. **La constancia se CONSERVA** como adjunto del proveedor, no se lee y se tira. La maquinaria de
   adjuntos + R2 ya existe.

**Fuera de alcance por ahora:** validar el QR de la constancia contra el SAT (exige salida a internet
desde el servidor; se puede agregar después si hace falta).

**Pregunta abierta a Daniel:** ¿solo en el **alta**, o también al **editar** un proveedor existente
(subir la constancia y que actualice sus datos fiscales)? *(Default del lead: **los dos** — es el mismo
trabajo.)*

- **Aplica en:** etapa de **proveedores**, junto con §Post-F9.54 y el resto de observaciones que Daniel
  anunció que mandará. **Se agrupa a propósito** para no tocar esa pantalla tres veces. Sin migración
  de datos; adjunto del proveedor por revisar si ya existe.
- **Fecha:** 2026-08-16.

#### (Post-F9.56) — Las siete observaciones de PROVEEDORES (DANIEL, 16-ago-2026)

Daniel revisando la pantalla de proveedores. **Las siete verificadas contra el código antes de
escribirlas**; dos ya estaban resueltas y una es una confusión de la pantalla, no un defecto de datos.

**1. Catálogo de CONTACTOS, no uno solo.**
> *"A veces es importante ir registrando al vendedor, a la de crédito y cobranza, al encargado del
> taller, a la supervisora… Depende qué tipo de proveedor y qué tipo de puestos se requieren."*

Hoy hay **un solo** `contacto String?` de texto libre. Necesita **tabla propia**: N contactos por
proveedor, cada uno con puesto, teléfono y correo. **Requiere migración.**

**2. El "nombre corto" duplicado — NO lo está: son dos campos distintos.**
> *"Está en el segundo campo y también lo pusiste casi al final como código corto en el taller.
> ¿Supongo que es lo mismo, o hay alguna razón de ser?"*

Hay razón de ser, pero **la pantalla no la explica** — la confusión es legítima:
- **`nombreCorto`** (`schema.prisma:581`) — lo pidió el propio Daniel el **6-ago**: *"Bloom"* para
  *"BLOOM TEXTIL"*, para **armar el nombre compuesto de la tela** (A1.1). Solo display, **sin unicidad**.
- **`corto`** (`:643`) — **clave corta de uso diario del taller**, heredada de `Maquilero.corto` del
  sistema viejo. **`@unique` global.**

**Propuesta:** etiquetarlos con claridad en la pantalla; y **si la clave del taller ya no se usa a
diario, retirarla** y dejar uno solo. → **pregunta abierta (2)**.

**3. El campo TIPO sale sobrando.**
> *"Tienes un campo de TIPO y aparte tienes el rol (que pueden ser más de uno)… creo que el de tipo
> sale sobrando. Y es importante poner todo lo que puede hacer un proveedor, porque puede hasta llegar
> a vender telas y ser maquilero."*

✅ **De acuerdo, y verificado:** `Proveedor.tipo` (enum `TipoProveedor`) se conservó junto a los roles
**por acta de Gabriel del 13-jun-2026**, no por una razón técnica. Los roles N:N cubren justo el caso
que Daniel nombra —vender telas **y** ser maquilero—, que el tipo único **no permite**. **Se retira.**
⚠️ Al construir: revisar sus consumidores (contrato, etiquetas, filtros) y qué hacer con la
clasificación de los migrados → **pregunta abierta (3)**.

**4. Si no emite CFDI, no debe pedir RFC.** La bandera `factura Boolean?` (*"¿Emite CFDI? Define formal
vs informal"*) **ya existe**; lo que falta es que **la pantalla la obedezca** y oculte RFC, régimen,
uso de CFDI y CP de expedición cuando esté apagada.

**5. ⭐ "Hay proveedores que a veces facturan y a veces no. ¿Cómo resolverlo?" — YA ESTÁ RESUELTO.**

`Proveedor.modalidadFacturacion` (`:655`, F6-E4 decisión (h)) tiene tres valores: **`solo_con`**
(siempre factura), **`solo_sin`** (nunca) y **`ambos`** — *"y en ese caso su estado de cuenta se
segmenta en dos"*. Cada cargo se marca `conFactura` al validarse (`dominio/esma/cargos.ts:216`) y el
estado de cuenta filtra por segmento (`dominio/esma/estado-cuenta.ts:48`).

**6. El hueco REAL, que Daniel intuyó en el mismo punto:** eso funciona **solo para talleres/maquila
(EsMa)**. Para los **proveedores de material (CxP)** el estado de cuenta **NO está segmentado**
(verificado: `dominio/cxp/` no menciona `conFactura`). Daniel lo pide para reportes —*"si necesito una
relación de proveedores con sus saldos, quisiera tener por separado los que son con factura y los sin
factura"*— y él mismo lo difiere: *"pero eso será después"*. **Queda anotado con su ubicación exacta.**

**7. "Está asegurado" solo aplica a maquila.** Ya está pensado así en los datos (`:645`, *"Nullable:
solo aplica a talleres"*), pero **la pantalla lo muestra siempre**. Se condiciona a los roles de
servicio (maquila, corte, arte…).

**Preguntas abiertas a Daniel** *(numeradas para que conteste con el número — convención pedida por él
el 16-ago)*: **(1)** ¿el **puesto** del contacto es catálogo o campo abierto? **(2)** ¿se sigue usando
la clave corta del taller o se retira? **(3)** al quitar el TIPO, ¿se **traducen** las clasificaciones
viejas a roles automáticamente o se reclasifica a mano?

- **Aplica en:** la etapa de **proveedores** (junto con §Post-F9.54 y §Post-F9.55). **Requiere
  migración** (contactos; retiro del tipo). El punto 6 queda **diferido** por decisión de Daniel.
- **Fecha:** 2026-08-16.

#### (Post-F9.57) — Cierre de las tres preguntas de proveedores, y el punto 6 SÍ entra (DANIEL, 16-ago-2026)

**(1) Contactos: tabla sí, puesto CAMPO ABIERTO.**
> *"O sea, sí un catálogo de contactos, pero deja el campo abierto qué rol tiene cada persona."*

Tabla de contactos por proveedor (N por proveedor), y el **puesto en texto libre** — no catálogo.
Mismo criterio que la posición del arte (§Post-F9.52 punto 2): Daniel prefiere abierto donde la
realidad es variada.

**(2) ⭐ Los dos campos cortos se FUSIONAN en uno solo.**
> *"Tanto para proveedores como para talleres necesitamos el campo corto. Podría ser el mismo campo. En
> la migración hay que meter el que ya está ahorita como campo corto de los maquileros."*

Se retira la duplicidad: **un solo campo corto**, válido para proveedor comercial y para taller. La
**migración lo siembra con el `corto` actual de los maquileros**.

⚠️ **Lo que hay que decidir al construir, porque los dos campos NO se comportan igual:** `corto` es
**`@unique` global** y `nombreCorto` **no tiene unicidad**. Al fusionarlos hay que elegir:
- **mantener la unicidad** (es una clave corta de uso diario; dos proveedores con la misma confunden
  al operar) — y entonces la migración puede **chocar** si dos registros comparten valor;
- o **soltarla**, y perder la garantía que el taller usaba.

**Recomendación del lead:** mantenerla **única**, y que la migración **REPORTE las colisiones** en vez
de resolverlas en silencio (D3: nada se decide callado). → **pregunta abierta (1)**.

**(3) Las clasificaciones viejas se TRADUCEN solas.**
> *"Sí, tradúcelo automáticamente."*

Al retirar `Proveedor.tipo`, su valor se convierte en rol: `TELAS` → *Telas*, `AVIOS` → *Avíos*,
`SERVICIOS` → *Otros servicios*, `SIN_CLASIFICAR` → sin rol. **Aditivo**: no pisa los roles que el
proveedor ya tenga marcados.

**⭐ Y el punto 6 (§Post-F9.56) DEJA DE ESTAR DIFERIDO.**
> *"En el punto 6 dijiste que lo dejamos para después, pero si quieres de una vez… hay proveedores de
> avíos o de telas que puede pasar que algunas cosas sean con factura y otras sin factura."*

Esto **cambia el alcance**: la segmentación con-factura / sin-factura deja de ser un asunto de
**talleres (EsMa)** y pasa a ser **general del proveedor**. Un proveedor de material puede surtir unas
cosas facturadas y otras no, así que **CxP necesita la misma partición** que EsMa ya tiene: el
movimiento se marca, el saldo se separa y el estado de cuenta se consulta por segmento.

**Lo que ya existe y se reusa** (no se inventa): `Proveedor.modalidadFacturacion` con
`solo_con`/`solo_sin`/**`ambos`**, el marcado por movimiento (`dominio/esma/cargos.ts:216`) y el filtro
por segmento (`dominio/esma/estado-cuenta.ts:48`). **Lo que falta:** llevarlo a `dominio/cxp/`.

⚠️ **Los REPORTES de saldos por separado siguen diferidos** — Daniel los pidió *"solo para que lo
consideres… pero eso será después"*. Se construye el **motor** (marcado + saldo segmentado); la
**relación de proveedores con sus saldos partida en dos consultas** viene después, y con el motor
puesto es barata.

- **Aplica en:** la etapa de proveedores. **Requiere migración** (contactos, fusión del campo corto,
  retiro del tipo con traducción a roles, segmentación en CxP).
- **Fecha:** 2026-08-16.

#### (Post-F9.58) — El campo corto es ÚNICO, y el ARTE y el PROCESO son casi el mismo catálogo (DANIEL, 16-ago-2026)

**1. ✅ El campo corto fusionado es ÚNICO.** Preguntado si al fusionar `nombreCorto` y `corto`
convenía mantener la unicidad global (recomendación del lead) o soltarla: *"Sí debe de ser único."* La
migración **reportará las colisiones** en vez de resolverlas en silencio (D3).

**2. ⭐ «Aplicación también es arte» — y eso destapó que hay DOS catálogos casi iguales.**
> Daniel: *"No solo bordado y estampado son artes. Aplicación también es arte… y los lavados no sé
> cómo vamos a trabajarlos. Al final es un proceso que se va a hacer."*

**Respuesta a lo del lavado, verificada en código: YA está modelado.** `TipoProceso` (F3-E1, catálogo
**administrable**) se siembra con **costura, estampado, bordado, lavado y aplicación**
(`prisma/seed.ts:411-417`), y cada uno trae `generaEntradaPt`: **solo `costura` es `true`** — las
prendas vuelven terminadas. Estampado, bordado, lavado y aplicación son `false`: se mandan, se reciben
y la prenda sigue en proceso. **El lavado se trabaja igual que el estampado.**

**El hallazgo de fondo:** conviven **dos listas casi idénticas**:

| | Qué es | Dónde vive | Valores |
|---|---|---|---|
| **Proceso** | qué se le manda a hacer a un tercero | `TipoProceso` (catálogo administrable) | costura · estampado · bordado · lavado · aplicación |
| **Arte** | qué lleva la prenda como diseño | `ModeloArte.tipo` (**enum fijo**) | bordado · estampado |

Se solapan en cuatro de cinco. La única diferencia real: **`costura` es proceso pero NO es arte**.

**Propuesta del lead: UN SOLO catálogo.** Reusar `TipoProceso` y agregarle una bandera **`esArte`**,
hermana de la `generaEntradaPt` que ya tiene. Con eso:
- **«Embosado» se da de alta UNA vez** y sirve para el arte y para el proceso (§Post-F9.54, principio
  del "proceso raro": una fila de catálogo, no un desarrollo).
- **Aplicación queda marcada como arte**, la corrección de Daniel, sin caso especial.
- El **filtro de proveedores de arte** (§Post-F9.52 punto 3) se deriva de la misma marca en vez de una
  lista escrita a mano.
- **No se construyen dos catálogos casi iguales** que acaban desincronizados — el defecto que este
  proyecto ya pagó tres veces con los selectores.

⚠️ **A cuidar si se acepta:** `ModeloArte.tipo` es hoy un **enum** y pasaría a FK del catálogo →
migración con traducción (`BORDADO`→`bordado`, `ESTAMPADO`→`estampado`), y el ripple a **`OrdenArte`**
(la receta congelada de la orden, V1-E3d pieza B).

→ **pregunta abierta (1)**: ¿un solo catálogo con la marca, o dos listas separadas?

- **Aplica en:** la etapa de proveedores + `V1-E3f` (arte). Ambas tocan lo mismo: **conviene fusionarlas
  en una sola etapa**.
- **Fecha:** 2026-08-16.

#### (Post-F9.59) — ⭐ CORRECCIÓN DE DANIEL: hay procesos DESPUÉS de la costura, y devuelven producto terminado (16-ago-2026)

> Daniel, corrigiendo la explicación del lead sobre `generaEntradaPt`: *"Está equivocado. Hay procesos
> que también son después de costura. O sea, llega a producto terminado."*

**Qué estaba mal.** El lead explicó —repitiendo lo que dice el seed— que *"solo la costura devuelve
prenda terminada; estampado, bordado, lavado y aplicación la devuelven para seguir trabajándola"*. Eso
asume que **el orden de los procesos es fijo**, y no lo es.

**El sistema ya sabe a medias que no lo es.** `Modelo.secuenciaEstampado` (enum `SecuenciaEstampado`,
`schema.prisma:4771`) existe con tres valores: **`antes` · `despues` · `flexible`** — capturado **por
modelo**. Hoy solo lo consume la Ruta Crítica (`rutaOrden.ts:151`), que está apagada en la v1.

**El defecto de modelado, dicho claro:** `TipoProceso.generaEntradaPt` es una bandera **por TIPO**
(`prisma/seed.ts:411-417`: costura `true`, los otros cuatro `false`). Pero **si un proceso ocurre
DESPUÉS de la costura, su recibo SÍ devuelve producto terminado** — el mismo estampado devuelve PT
cuando va después y no lo devuelve cuando va antes. La propiedad **no es del tipo: es de la posición
del proceso en esa orden**.

⚠️ **La consecuencia de inventario, que es la grave:** si se mandan prendas **ya terminadas** a lavar y
el recibo **no** las reingresa, **las piezas desaparecen del almacén** aunque estén físicamente ahí —
el envío las sacó y el recibo no las devolvió. Con D3 (existencia = suma de movimientos) eso es un
saldo equivocado, no un detalle de pantalla.

**Lo que hay que resolver al construir** (NO se decide aquí, se deja planteado con honestidad):
1. `generaEntradaPt` deja de ser propiedad fija del tipo y pasa a resolverse **por proceso de la
   orden** — derivándolo de la secuencia (`antes`/`despues`) o capturándolo al programar el envío.
2. Verificar **qué hace hoy el envío** de prendas ya terminadas: ¿las saca del PT? Si el envío no las
   saca y el recibo no las mete, el saldo cuadra por accidente; si el envío sí saca, hoy hay una fuga.
   **El lead verificó la bandera y el enum, NO trazó ese flujo completo.**
3. `secuenciaEstampado` está hoy **solo en el modelo** y **solo la lee la RC**. Si la v1 va a distinguir
   antes/después, alguien más tiene que leerla — o la orden necesita su propia secuencia.

**2. ✅ Catálogo ÚNICO aprobado.** *"De acuerdo. Y un solo catálogo."* Se fusiona `ModeloArte.tipo`
(enum) con `TipoProceso` (catálogo administrable) + bandera **`esArte`**. Con eso «embosado» se da de
alta una vez, **aplicación queda marcada como arte** (corrección de Daniel), y el filtro de proveedores
de arte se deriva de la misma marca.

⚠️ **Y esta corrección le agrega un requisito al catálogo único:** la bandera `esArte` es del tipo, pero
**`generaEntradaPt` NO puede seguir siéndolo**. Al fusionar, no arrastrar el error.

- **Aplica en:** la etapa fusionada de **proveedores + arte**. El punto 1 (procesos después de costura)
  **puede ser etapa propia** si al trazar el flujo resulta que toca el kardex de PT — se dimensiona al
  arrancar.
- **Fecha:** 2026-08-16.

#### (Post-F9.60) — Procesos DESPUÉS de costura: no hay fuga, hay inventario que MIENTE sobre lo que está físicamente (16-ago-2026)

> Daniel, preguntado si esto ya pasa o es a futuro: *"Sí sucede desde ahorita. En varias ocasiones se
> manda un estampado después de costura o algún otro proceso."*

**⚠️ CORRECCIÓN DEL LEAD a §Post-F9.59.** Ahí se advirtió que *"las piezas desaparecen del almacén"*.
**Eso era FALSO** y se dijo antes de trazar el flujo (el propio texto avisaba que no se había trazado).
Trazado ahora:

- **El ENVÍO no toca el kardex de PT.** Textual en `dominio/produccion/etapas.ts:7-9`: *"el corte y el
  envío NO tocan el kardex PT (no son entrada/salida de existencia). Escriben `EtapaMovimiento` +
  `EtapaMovimientoDet`. El kardex PT entra hasta el recibo de costura y la entrega."*
- **El RECIBO mete a PT sólo si `generaEntradaPt`** (`recibos.ts:14`, `:463`), o sea sólo costura.

**Qué pasa hoy con un estampado DESPUÉS de costura:** (1) el recibo de costura mete las prendas al
almacén; (2) el envío al estampador **no las saca**; (3) el recibo del estampado **no las mete**
(nunca salieron). **El saldo cuadra.** No hay fuga.

**⭐ El problema REAL es el contrario, y sí importa:** mientras las prendas están **físicamente en el
estampador**, el inventario dice que **están en el almacén**. Dos consecuencias concretas:

1. Se puede **comprometer o entregar** mercancía que no está en el piso.
2. El **inventario cíclico** (F7-E5) reportará diferencias **sin explicación**: el conteo físico no
   cuadra con el teórico y nada dice por qué.

Y una tercera, de diseño: `generaEntradaPt` **sigue estando en el nivel equivocado** (§Post-F9.59). Hoy
no muerde **porque el envío tampoco saca** — el saldo cuadra por compensación, no porque el modelo sea
correcto. Si algún día el envío empieza a sacar, aparece la fuga que se temía.

**Las dos salidas, para decidir con Daniel:**

- **(a) Dejarlo así en la v1**, y que la pantalla **avise** cuántas piezas de esa orden están fuera en
  proceso. Barato; el saldo sigue cuadrando; el conteo cíclico necesita saber leer ese aviso.
- **(b) Modelarlo de verdad:** el envío de prendas **ya terminadas** saca de PT hacia un bucket «en
  proceso externo», y el recibo las devuelve. El inventario diría la verdad física y el cíclico
  cuadraría solo. Más trabajo, toca el kardex (D3: movimientos, nunca edición de saldos).

**Recomendación del lead: (a) para la primera versión**, con el aviso visible — Daniel quiere arrancar,
el saldo no está mal, y (b) se puede construir después sin deshacer nada. Pero **(a) sólo es honesto si
el aviso existe**: dejarlo mudo es que el inventario mienta sin decirlo, y esta etapa (V1-E4) trata
justamente de eso.

- **Aplica en:** por decidir con Daniel. Si es (a), es chico y cabe en la etapa de proveedores/arte. Si
  es (b), **etapa propia** con su ETL de saldos en tránsito.
- **Fecha:** 2026-08-16.

#### (Post-F9.61) — ⭐ Opción (b): el envío a proceso SACA del almacén, porque si no, los faltantes y las segundas no tienen dónde caer (DANIEL, 16-ago-2026)

> Daniel, eligiendo entre avisar (a) o modelar el tránsito (b): *"Pensaría que B. O si no, ¿de qué
> manera manejamos los faltantes o segundas?"*

**Su pregunta es el argumento decisivo, y mejor que el que había dado el lead.** El lead defendía (b)
por exactitud —*"el inventario miente sobre dónde están las prendas"*—. Daniel señaló algo más duro:
**con (a) no hay dónde registrar lo que no vuelve, ni lo que vuelve peor de como salió.**

**Verificado en código:** el recibo **ya captura primeras y segundas** por color×talla
(`recibos.ts:161-202`) y, cuando `generaEntradaPt`, las manda a **sus almacenes respectivos**
(`:15`). Pero en un proceso **después de costura** (`generaEntradaPt: false`) ese desglose se queda
**sólo en el WIP**: no mueve inventario.

**El escenario que hoy no tiene salida:**

| | |
|---|---|
| Se mandan **100** al estampador | el almacén dice 100 primeras |
| Vuelven **95 primeras, 3 segundas, faltan 2** | el almacén **sigue diciendo 100 primeras** |

Las 3 segundas **no existen en ningún lado** y los 2 faltantes tampoco. Y no es que esté mal
registrado: **no hay movimiento donde registrarlo**.

**Lo que se construye (opción b):**

| Momento | Movimiento |
|---|---|
| Envío de prendas **ya terminadas** | **SALIDA** de PT → saldo «en proceso» con ese tercero (por orden y proceso) |
| Recibo de primeras | **ENTRADA** al almacén de primeras |
| Recibo de segundas | **ENTRADA** al almacén de segundas |
| Diferencia (enviado − recibido) | **queda VIVA** como saldo a cargo del tercero, hasta que llegue o alguien la dé de baja **con motivo** |

⭐ **El faltante NO se absorbe en silencio** (D3): queda como saldo pendiente del maquilero — que es
justo lo que se necesita para reclamárselo. Y resuelve de paso un caso que hoy tampoco tiene salida:
**la prenda que salió primera y vuelve segunda** es una **reclasificación** (salida de primeras +
entrada a segundas), expresable con movimientos sin editar saldos.

**Y arregla el problema de nivel de §Post-F9.59:** con el envío sacando de verdad, `generaEntradaPt`
deja de "cuadrar por compensación". El recibo mete a PT **según dónde va el proceso**, no según el tipo.

⚠️ **Costo, dicho de frente:** toca el **motor de kardex**, la pieza más delicada del sistema (D3:
existencia = suma de movimientos bajo lock, nunca un saldo editado). **Es etapa propia, no un ajuste.**
Pero es **más barato AHORA que después**: con meses de movimientos capturados bajo la mecánica vieja,
corregirlo obliga a reconstruir historia.

**A resolver al construir:** ¿el saldo «en proceso» es un almacén más (y entonces el traspaso ya
existente sirve) o un estado del kardex de PT? El repo ya tiene almacenes y traspasos entre ellos —
**mirar eso antes de inventar una entidad nueva**.

- **Aplica en:** etapa propia del track V1, **antes de que Daniel empiece a capturar inventario real**
  (ya manda estampados después de costura, §Post-F9.60). Requiere migración y toca kardex.
- **Fecha:** 2026-08-16.

#### (Post-F9.62) — El segundo respaldo es MENSUAL, no diario (GABRIEL, 17-ago-2026)

> Gabriel, al ver que se estaba construyendo el respaldo: *"¿Cómo que respaldos? Los respaldos están
> hechos en Railway, ¿qué haces?"* Y tras la explicación: *"Sí están prendidos, en Railway todos los
> respaldos. Chance en R2 una vez al mes nada más."*

**El planteamiento era correcto y la pregunta también.** `PLANMAESTRO.md` §91 pide **respaldo doble**:
*"además de los backups de Railway, un job de pg-boss hace `pg_dump` diario y lo sube cifrado a R2"*, y
la tabla de riesgos lo lista como **mitigación #1** de *"pérdida de datos (todo el negocio en una BD)"*.
Lo que el lead no sabía —y Gabriel confirmó— es que **los backups de Railway ya están encendidos** en
todos los ambientes.

**Qué cambia:** el plan decía **diario**; queda **MENSUAL** (`RESPALDO_CRON`, configurable sin
desplegar). **Es una desviación consciente del `PLANMAESTRO`, decidida por el dueño de la
infraestructura**, y se escribe aquí para que nadie la lea como un incumplimiento.

**Por qué el segundo respaldo sigue teniendo sentido** (la razón de no cancelarlo): el de Railway vive
**dentro** de Railway. Sirve para casi todo —borrar una tabla, corromper un dato—, pero **no sirve
cuando el problema ES Railway**: cuenta suspendida, servicio borrado por error, caída larga, o querer
mudarse. Es el mismo principio de portabilidad que Gabriel puso en la arquitectura (*"si Railway se
cae, se levanta en cualquier lado sin reescribir"*), aplicado a **los datos** y no sólo al código. Con
esa lógica, **una copia mensual fuera de Railway cubre el escenario** — el diario lo cubre Railway.

**Consecuencias del cambio, que NO son sólo "correr menos seguido":**

1. **Retención en COPIAS, no en días** (12 = un año). La frecuencia es configurable, y una retención en
   días cambiaría **en silencio** cuántas copias existen si alguien toca el cron.
2. **Piso no configurable de 35 días**: las corridas manuales del día que se configure R2 no deben
   empujar el año de historia fuera del tope.
3. ⚠️ **El aviso de fallo pasa a ser LA parte crítica.** Con corridas mensuales, **si falla en enero
   nadie lo nota hasta junio**. Por eso el requisito rector de la etapa fue *"que no falle en
   silencio"* — y por eso el reviewer la rechazó al encontrar dos caminos que morían callados.

**Pendiente que Gabriel debe hacer a mano:** generar `RESPALDO_LLAVE` (`openssl rand -base64 32`),
ponerla en Railway **y guardarla también fuera** (gestor de contraseñas). Si se pierde, los respaldos
son **irrecuperables por diseño**. Procedimiento completo en `docs/GUIA-RAILWAY-R2.md` §7.1.

- **Aplica en:** V1-E6a. Sin permisos ni contrato nuevos; una migración aditiva (`respaldo_corrida`).
- **Fecha:** 2026-08-17.

---

#### (Post-F9.63) — El nombre del arte SE RETIRA: basta la descripción (DANIEL, 17-ago-2026)

> Daniel, viendo la pantalla: *"Es completamente irrelevante el nombre del estampado. Creo que con la
> descripción sería suficiente. **¿Es indispensable el nombre para el funcionamiento del sistema?**"*

La pregunta tenía respuesta técnica: **sí lo era, pero no por el negocio.** El `nombre` era la **llave**
(`@@unique([idModelo, nombre])` en `ModeloArte`, `@@unique([idOrden, nombre])` en `OrdenArte`) y el
desempate del orden de despliegue. No se podía borrar sin reemplazar la identidad.

**Cómo quedó:**

- `descripcion` pasa a ser el campo visible y **requerido**; `nombre` se **retira** de ambas tablas.
- La migración **conserva el dato**: donde `descripcion` venía vacía (NULL, `''` o solo espacios), se
  llena con el `nombre` actual. **Nada se pierde en silencio** (D3). *(El reviewer verificó que sin ese
  relleno, artes como "LOGO FRENTE" se degradaban a "Arte 1" **sin tronar** — el relleno es cargante,
  no cosmético.)*
- La identidad pasa al propio registro; en `OrdenArte`, a `(idOrden, idModeloArte)`, con NULL para los
  agregados a mano —por eso caben varios—.
- El orden lo da el campo `orden` que ya existía, con desempate por `id`.

⚠️ **Dos consecuencias dichas, no calladas.** (1) Se **pierde** la red que impedía dos artes con el mismo
nombre en un modelo; queda un aviso en pantalla que **no bloquea**. (2) El histórico (todo en `orden` 0)
pasa a listarse **por antigüedad de captura y no alfabéticamente**; se corrige con un clic en
"principal".

- **Aplica en:** V1-E3f. Migración con relleno; sin permisos nuevos.
- **Fecha:** 2026-08-17.

---

#### (Post-F9.64) — La curva de tallas es una GUÍA, no una jaula — y el sistema debe AVISAR (DANIEL, 17-ago-2026)

> Daniel: *"¿Qué pasa si se pensó para una curva CH-M-G-EX y en la producción nos piden una talla más,
> XCH-CH-M-G-EX? A la hora de pasar la info a producción ¿podemos agregar la medida de la talla
> adicional?"*

**Sí se puede, y ya funcionaba** (verificado en código antes de responder): `ModeloAvioTalla` se lleva
**por talla**, no colgada de la curva. `listarMedidas` ya devuelve las tallas de la curva **más** las
capturadas que ya no están en ella, marcadas `enCurva: false`, con la razón escrita en el propio código:
*"para no perderlas en silencio si alguien cambió la curva después"*.

**El hueco:** si la orden pide una talla y ese avío **no tiene medida capturada**. Daniel: **"Sí. Haz el
ajuste porfa. Que sí avise."**

🔴 **CORRECCIÓN (18-ago-2026) — la primera redacción de este párrafo era FALSA en dos puntos.** Decía que
*"el renglón sale en cero"* y que *"nadie avisa"*. Lo escribió el lead a partir de su propia lectura del
código, sin verificarlo; lo desmintió el reviewer de V1-E3f, ejecutando:

1. **NO sale en cero.** `receta-avios.ts:56` cae al **consumo por prenda**: `requerido += consumoPorPrenda
   * piezas`.
2. **El MRP SÍ avisa.** `mrp.ts:510-514` empuja el aviso literal *"Avío …: sin medida por talla (R18)
   para \<tallas\>; se usó el consumo por prenda"*, y la cabecera del módulo declara la política: *"los
   casos ambiguos NO truenan en silencio: van a `avisos`"*.

**El hueco real es más chico y más preciso**, y lo dice el propio código en `receta-avios.ts:9-10`: *"se
reportan en `tallasSinMedida` para que el llamador decida si avisa (**el MRP arma un aviso con las
etiquetas; la habilitación lo ignora**)"*. O sea: **el mecanismo YA EXISTE y YA ES COMPARTIDO** — lo que
falta es que **la habilitación/producción y la pantalla lo usen**.

⚠️ **Por qué importa la corrección:** si se construye sobre la redacción vieja, se construye **un aviso
que ya existe** y se duplica. Y es la **segunda** nota de este archivo que se quema por lo mismo en dos
días (ver §Post-F9.54): **una afirmación sobre el sistema, escrita sin ejecutar**.

**Criterios cerrados con él:**

- **AVISA, NO BLOQUEA.** Dijo *"que sí avise"*, no *"que no deje"*: bloquear pararía producción legítima
  —la talla de última hora es exactamente el caso que describió—.
- Solo tallas que la orden **realmente pide** (cantidad > 0 en la matriz color×talla, D4).
- Solo avíos con consumo **por talla**; los de consumo plano no entran (serían ruido).
- Distinguir **"no capturada"** de **"capturada en cero"**: un cero deliberado no es un olvido y no debe
  gritar igual. El dominio ya los separa (`consumo: null` vs `0`).

- **Aplica en:** V1-E3g (etapa propia; toca producción y merece su revisión).
- **Fecha:** 2026-08-17.

---

#### (Post-F9.65) — La sección «Clasificación» del modelo abre por defecto (DANIEL, 17-ago-2026)

> Daniel, buscando dónde asignar la curva de tallas: *"no sé dónde hacerlo… no lo veo"*. Y al
> explicarle que estaba en una sección plegada: *"Sí, está bien que la abras. Creo que es información
> que vamos a tener en la mayoría de los modelos."*

El diálogo del modelo tiene tres secciones plegables y `defaultValue={['identidad','costos']}` dejaba
**Clasificación** cerrada — justo donde viven **curva de tallas, temporada y género**. La sección dejó de
ser el rincón de lo excepcional, así que abre sola.

*(Se registra aquí porque el reviewer de V1-E3f levantó, con razón, que el cambio se justificaba en el
código con una cita de Daniel **que no existía en ningún documento del repo**. La cita es real —dicha en
vivo el 17-ago—; lo que faltaba era esto.)*

- **Aplica en:** V1-E3f (una línea en `DialogoModelo.tsx`). Sin migración, permisos ni contrato.
- **Fecha:** 2026-08-17.

---

#### (Post-F9.66) — ⭐ Medida vs. consumo: dos ideas que vivían en el mismo campo (DANIEL, 17/18-ago-2026)

> **Salió de Daniel capturando un modelo real** —un cierre—, no de un plan ni de una revisión técnica.
> Es el segundo hallazgo de esa naturaleza en dos días (el otro fue el tránsito de prendas), y los dos
> encontraron cosas que **ningún reviewer habría visto: el código estaba bien, lo que estaba mal era el
> modelo del negocio**.

**El hallazgo.** Daniel: *"En el caso del cierre el consumo por prenda es 1 pieza… pero lo que hay que
poner por talla no es el consumo, sino **la medida a la que hay que pedir** ese cierre. Para cuestión de
consumos es 1, pero para cuestión de información, es por medida."*

Y después, la frase que destapó el fondo: *"Los costos de elástico o de jareta se expresan en metros.
Cuesta 3 pesos el metro. Entonces poner .75 hace sentido porque el costo se calcula con una simple
multiplicación."*

| | Elástico / jareta | Cierre |
|---|---|---|
| El valor por talla **es** | el **CONSUMO** (0.75 m en CH) | la **ESPECIFICACIÓN** (cierre de 53 cm) |
| La cantidad | varía por talla | **siempre 1 pza** |
| ¿Se multiplica por el precio? | **sí** ($3/m × 0.75) | no — es una instrucción de compra |
| Decimales | **naturales y correctos** | no tienen sentido |

**No es que unos avíos usen decimales y otros no: es que unos capturan CUÁNTO GASTAS y otros QUÉ PIDES.**
Por eso ninguna regla global funcionaba.

**El camino de la decisión, con lo descartado y su razón** *(no re-abrir)*:

- ❌ **"Siempre CM, sin decimales"** — lo propuso el **lead** y **Daniel lo tumbó con razón**: forzar el
  elástico a centímetros obliga a dividir entre 100 en algún lado, y ahí nacen los errores.
- ❌ **Medida como TEXTO LIBRE** — la pidió Daniel: *"un día pueden ser medidas de 52, 53, 54 cm y otro
  modelo de 67, 68, 69… no tiene sentido tener un catálogo con todas las medidas posibles"*. **Su queja
  era válida** (obligar a dar de alta cada centímetro es fricción absurda), pero el texto libre **rompe la
  compra**: `"53 cm"`, `"53cm"` y `"53"` serían tres cosas distintas y la orden de compra saldría partida
  en tres.
- ✅ **Lo que Daniel propuso y ganó:** *"le ponemos la medida en que va cada avío (como default CM) y el
  campo donde se captura lo dejamos solo numérico. Entonces obliga al usuario a evitar poner 53 cm, 53
  centímetros o 53CM."*
  **Quita la ambigüedad en el origen en vez de limpiarla después** — un campo que no admite el dato malo
  vale más que una validación que avisa, porque los avisos se ignoran.

**⚠️ El riesgo que queda, acotado:** que un avío tenga **mal puesta su unidad**. Contra eso, la unidad se
ve **pegada al campo** al capturar (`0.75 m`, `53 cm`) y hay **aviso —no bloqueo— cuando el número es
absurdo** para esa unidad (un `1` en un cierre casi seguro quiso ser `100`).

**Cerrado con Daniel:** ningún avío necesita **cantidad por talla Y medida por talla a la vez**
(*"no se me ocurre algo que lleve las dos cosas a la vez"*), así que **nunca se sostienen los dos modos
vivos**.

**Migración:** lo convertible se convierte; **lo que no, se marca para revisión manual** y sigue **vivo y
usable** — Daniel lo pidió con esas palabras: *"que un puñado te aparezca marcado a que el sistema decida
por ti y te enteres tres meses después"*.

**Las etiquetas eran parte del defecto:** el panel se llamaba *"Consumo por talla"* para las dos cosas y el
esquema documentaba el campo como *"Medida (consumo) del avío para esta talla"* — **la confusión estaba
escrita desde el origen**, y por eso Daniel llegó a la misma duda que habría tenido cualquiera.

- **Aplica en:** V1-E3g. Migración aditiva; **sin permisos nuevos, sin seed** → no requiere
  `SEED_ON_START`. Sí requiere que alguien revise en el catálogo de Avíos las medidas marcadas.
- **Fecha:** 2026-08-18.

---

#### (Post-F9.67) — ⭐ Los perfiles NO van en cascada: van por PUESTO, y se suman (DANIEL, 18-ago-2026)

> Daniel, sin que se lo preguntaran: *"El sistema de perfiles en cascada lo hice al principio pero **dejó
> de funcionar. No es funcional. No me gusta por cascada.** Mejor definir permisos directos por persona.
> O por perfil de puesto."*

**Lo que había, y por qué estaba mal.** El seed trae **ocho roles construidos por RESTA** —Administrador,
Directivo, Gerencial, Ventas, Logística, Asistente, Secretarial, Básico—, cada uno un subconjunto estricto
del anterior. Están anotados en el propio código con la frase *"absorbe el nivel 45"*: son la **traducción
literal de los niveles del Access viejo** (30, 40, 45, 47, 50, 60, 100).

⚠️ **Y eso los volvía la reconstrucción del sistema equivocado.** `10-Modelo-Datos-y-Usuarios.md` ya decía
que en el Access convivían **DOS** sistemas de seguridad —los niveles en cascada y los accesos granulares
por persona (`Accesos` + `UsuAccesos`)— y que **el que se usaba era el granular**. La ingeniería inversa lo
tenía documentado; el seed reprodujo el que Daniel ya había abandonado. Su incomodidad no era preferencia:
era que se copió lo que no servía.

**Lo que el modelo YA aguanta (verificado en `schema.prisma`, no supuesto):** `UsuarioRol` es **N:N** y
`RolPermiso` es **N:N**. O sea que **un usuario puede tener VARIOS roles y sus permisos son la UNIÓN**. La
cascada no existe en el modelo de datos — solo en cómo se llenaron esos ocho roles. **No hace falta
migración para cambiar de enfoque.**

**Cómo quedan:**

- **Perfiles por PUESTO**, no por nivel: *Cortador*, *Almacenista*, *Compras*, *Calidad*, *Contabilidad*…
  Cada uno con lo que ese puesto necesita, **sin importar quién está "arriba" de quién**.
- **Excepciones por persona = perfiles chicos SUMABLES**, de una sola capacidad: *Ve costos*, *Autoriza
  compras*, *Aprueba precios*. Alguien es **Compras + Ve costos**; otro es **Compras** a secas. Da
  granularidad por persona **sin** configurar permiso por permiso, que es justo donde el sistema viejo se
  volvió inmanejable.
- **Los ocho perfiles heredados se RETIRAN** al construir los nuevos.

**Criterio de reparto (del lead, aceptado como marco de la revisión):** de los 120 permisos, solo dos
familias son de verdad delicadas — **lo que toca dinero** (costos, precios, finanzas) y **lo que
autoriza** (compras, listas de precios), más un tercer grupo de **operaciones peligrosas** (deshacer,
antedatar, dejar existencias en negativo). En todo lo demás conviene ser **generoso**: *si alguien se topa
con «no tienes permiso» en su primera semana, deja de usar el sistema y se regresa al papel*. Es más fácil
apretar después con un caso real que recuperar a alguien que ya se fue.

**Los 13 puestos que Daniel definió (18-ago-2026):** Daniel (todo) · **Aurora** (gerente general y de
ventas — **SIN estado de resultados**, y algunos reportes de finanzas por definir) · Producción · Compras ·
Habilitaciones · Recibo de mercancía · Encargado de telas · Calidad · Administración y finanzas ·
Desarrollo de producto · **Gestión técnica** (2ª etapa: fichas técnicas) · Trazador · Entregas.

**Instrumento de trabajo:** matriz de **65 capacidades × 13 puestos** (que cubre los 120 permisos, cuadrado
sin faltantes ni sobrantes), entregada a Daniel para afinar. Seis cruces quedaron marcados como pregunta
abierta.

- **Aplica en:** etapa de perfiles y permisos (previa al go-live). **Sin migración** — el modelo ya lo
  soporta.
- **Fecha:** 2026-08-18.

---

#### (Post-F9.68) — Esconder, no negar: la UI no enseña lo que el usuario no puede usar (DANIEL, 18-ago-2026)

> Daniel: *"Las personas que no tengan acceso a algo me gustaría que no vean esa opción. **Si no tienen
> acceso a costos, en lugar de mandarle un mensaje diciendo que no tienen permiso para verlo, mejor que
> les borre esa opción.**"*

**El principio ya existía** (A4: *"la UI esconde lo que no le toca al usuario, no lo informa"*) y **el
menú ya lo cumple**: `frontend/src/modulos/catalogo.ts` declara el permiso de cada una de sus ~116
entradas y un grupo aparece solo si alguna hoja hija es visible; ⌘K usa el mismo filtro.

⚠️ **Pero adentro de las pantallas NO se aplica parejo** (verificado, no supuesto): `ImportarCfdiPagina`
dice *"No tienes permiso para importar CFDI (requiere administrar CxP)"* —que además **nombra el permiso
que falta**, o sea le cuenta al usuario la forma del sistema—, `ProgramarRcPagina` dice *"No tienes
permiso para programar la Ruta Crítica"*, y `SeccionDesarrolloOrden` pinta *"Sin permiso de importes"*
donde va el precio. **Medido:** 124 pantallas, **39 sin ninguna consulta de permiso**.

**Las dos reglas finas, cerradas con Daniel:**

1. **Columna entera, no celda vacía.** Si un dato desaparece por permiso, se va **con su encabezado**.
   Una celda vacía haría creer que el dato **no existe** o que el sistema falló — peor que el letrero que
   se está quitando.
2. **La excepción legítima es el enlace compartido.** Quien reciba la URL de una pantalla que no puede
   ver **sí** debe leer algo, o parecería que el sistema se rompió: *"Esta pantalla no está disponible
   para tu usuario."* **Sin** nombrar el permiso, sin sugerir a quién pedirlo, sin código de error.

**⭐ Y las TRES CAPAS, petición expresa de Daniel:** *"Podemos intentar ocultar botones mientras se pueda
y al mismo tiempo bloquear pantallas para asegurarnos que no haya una puerta que no estemos viendo. Así
aseguramos que no entran, y al mismo tiempo intentamos que no sea ofensivo para el usuario."*

| Capa | Qué hace | Estado (verificado 18-ago) |
|---|---|---|
| **Menú** | esconde la opción | ✅ ya funciona |
| **Ruta** | cierra la pantalla | 🔴 **NO EXISTE** |
| **Backend** | rechaza la operación | ✅ ya funciona |

🔴 **La capa de en medio falta.** `sesion/RutaProtegida.tsx` verifica **solo que haya sesión** —lo dice su
propio comentario: *"Es solo la PRIMERA barrera (UX)"*— y de las **135 rutas de `App.tsx` solo 2 mencionan
permisos**. Quien teclee la URL de una pantalla que no le toca **entra**, ve encabezados y botones, y la
pantalla falla al cargar. **No es agujero de seguridad** (el backend rechaza), pero es exactamente la
puerta que Daniel intuyó sin verla. Las rutas deben tomar su permiso de `catalogo.ts` —**una sola
fuente**—, no de una lista nueva que se desalinearía con el tiempo.

**Regla que NO se negocia:** esconder es **de presentación**. El backend sigue devolviendo 403/404 como
corresponde; **la seguridad nunca depende de que la UI no muestre el botón**. Si al barrer aparece un
endpoint que confiaba en que la pantalla lo escondiera, **es un hallazgo grave**, no una nota.

- **Aplica en:** V1-E6b. Sin migración, sin permisos nuevos, sin contrato.
- **Fecha:** 2026-08-18.

---

#### (Post-F9.69) — Las cinco reglas que la SEGMENTACIÓN de CxP obligó a fijar (V1-E3f pieza B, 18-ago-2026)

Daniel pidió (§Post-F9.57) que la partición **con factura / sin factura** dejara de ser cosa de talleres:
*"hay proveedores de avíos o de telas que puede pasar que algunas cosas sean con factura y otras sin
factura"*. Al llevar el motor de EsMa a CxP hubo que fijar cinco cosas que él no dijo. Se registran porque
**tocan dinero** y porque un reviewer las objetó una por una.

1. **Un movimiento `entrada_sin_factura` NUNCA se vuelve fiscal**, ni siquiera con un proveedor marcado
   `solo_con`, y **pedirlo se rechaza** en vez de corregirse en silencio. Sin esta regla, reusar el criterio
   de EsMa metía cargos **sin CFDI** al reporte del contador.
2. **`segmento` ≠ `vista: fiscal`.** Filtran la misma columna, pero el **segmento** pide solo
   `terceros.ver`: la partición que pidió Daniel es **operativa**, no contable, y no puede quedar detrás
   del candado del contador. La combinación contradictoria se **rechaza con mensaje**, no devuelve una
   lista vacía muda.
3. 🔴 **Los movimientos SIN DEFINIR (`conFactura = NULL`) van al segmento "sin".** La primera versión usó
   `{ not: true }` creyendo que los incluía — **falso**: en lógica de tres valores `NULL <> true` es `NULL`
   y la fila **se descarta igual**. La única forma que sí los trae es el `OR` explícito con `IS NULL`.
   **Importa porque el encabezado sí los sumaba** (`saldoSinFactura = saldo − saldoFiscal`), así que
   encabezado y renglones se contradecían y **los dos segmentos no daban el total**.
4. **CxC hereda `segmento`** por compartir el contrato del motor. Nadie lo pidió; es inocuo (default
   `todos`) y ahí la partición **sí es exacta**, porque `MovimientoTercero.esFiscal` es NOT NULL.
5. **El campo corto sobreviviente es `nombreCorto`, no `corto`** — es el que Daniel señaló en la pantalla,
   y los DTO de CxP/EsMa/CFDI se renombraron igual: *dejar dos nombres para un concepto es la
   desincronización que este proyecto ya pagó*.

**Y el criterio de la migración, que Daniel no dictó pero decide sobre sus datos:** la fusión de los dos
campos cortos deduplica **sin distinguir mayúsculas**, y por eso el índice único de la base también va
sobre `lower()` — si no, la base vuelve a permitir al día siguiente el estado que la migración se tomó el
trabajo de eliminar. Las colisiones y el valor desplazado **quedan en bitácora**; una diferencia de **sola
caja** se registra aparte, porque perder una tipografía no es lo mismo que perder un dato.

- **Aplica en:** V1-E3f pieza B. Migración aditiva; **sin permisos nuevos, sin seed** → no requiere
  `SEED_ON_START` (verificado por las dos partes; la nota vieja de §Post-F9.54 ya mintió sobre esto).
- **Fecha:** 2026-08-18.

---

#### (Post-F9.70) — Lo que Daniel encontró usando el importador de OC (DANIEL, 19-ago-2026)

Daniel intentó importar una OC real de C&A (**orden 620672**, 1,744 pzas, packs A y B) y **no pudo
avanzar**. Tres cosas, en orden de gravedad.

**1. ⭐ El campo «Archivo de la OC (opcional)» del pedido manual PARECE un importador y NO lo es.**

En `ConstructorPedido.tsx` («Nuevo pedido interno») hay un campo rotulado *"Archivo de la OC (opcional)"*.
Daniel le subió su PDF y esperó que lo leyera; el campo **solo llama a `subirAdjunto`** — guarda el archivo
pegado al pedido y nunca lo abre. Por eso el diálogo le seguía exigiendo **cantidad y precio a mano**, y su
reclamo era exacto: *"ahí está mal, porque la cantidad la tiene el pedido, no debo dárselas yo"*.

**No fue un malentendido suyo: es la lectura natural del rótulo.** Y el sistema **sí sabe leer ese PDF
exacto** —verificado ejecutando el parser contra su archivo: sacó los 4 SKU con 436 pzas cada uno, el Pack
A (8 u/pack × 168) y el Pack B (400 sueltas), **sin una sola advertencia**—, pero esa capacidad vive detrás
de **otro botón, en otra pantalla** (`Pedidos → «Importar OC (PDF)»`), y al lado se ofrece un campo que
aparenta lo mismo.

⚠️ **El patrón, que ya se repitió dos veces en la misma sesión:** Daniel buscó el importador **desde el
pedido**, no lo encontró; luego subió el PDF **al campo que parecía**. *Cuando el camino natural falla dos
veces, el que está mal es el camino.*

**Dos caminos, con recomendación del lead: (A)** que ese campo **sí lea** el PDF y proponga cargarlo
(*"Reconocí una OC de C&A: 4 tallas, 1,744 piezas, 2 packs. ¿La cargo?"*) — lo que él esperaba; **(B)**
dejarlo como adjunto pero **decirlo** y ofrecer ahí el acceso al importador. **(A) es la buena**: (B) solo
pone un letrero encima del mismo tropiezo. ✅ **Daniel autorizó (A) el 19-ago**, dentro de la tanda de siete puntos; construido en **V1-E3i**:
el campo lee el PDF y **propone** cargarlo (*"Reconocí una OC de C&A…"*), la persona confirma, y si no
se reconoce **se dice** y queda como adjunto — nunca se traga el archivo en silencio (D3).

**2. La plantilla de C&A no existe, así que el 7% de sobre-pedido NO se aplica.** Verificado:
`prisma/seed.ts` no siembra ninguna `PlantillaImportacion`, y `leerConfigPlantillaPdf` cae al default
**`porcentajeAdicional: 0`**. Consecuencia: las OPs nacen con las **cantidades exactas del cliente** en vez
de las que se fabrican. **El 7% fue una decisión de Daniel (§Post-F9.2) y hoy no está operando.**
✅ **Decidido (LEAD, 19-ago, V1-E3i): va SEMBRADA de fábrica**, no "que alguien la dé de alta" — *una
plantilla que hay que acordarse de crear es una plantilla que no existe el día que se necesita*, y ésta
lleva meses sin operar justo por eso. Sigue siendo editable desde la pantalla. El seed **busca** al cliente
por nombre normalizado contra una **lista cerrada** (`ca`, `cya`, `camexico`, `cyamexico` — un `contains`
cazaría "Calzado"), **nunca lo crea**, y **solo siembra si ese cliente no tiene ninguna plantilla**: jamás
pisa lo que configuró una persona. Si no lo encuentra, **lo dice en la salida del seed**.
⚠️ **Exige `SEED_ON_START=true`** al desplegar, y conviene confirmar en `prueba` que C&A quedó con su
plantilla vigente: si ya tenía una de Excel (R8), el seed **no la toca** a propósito y el 7% habría que
ponerlo desde la pantalla.

**3. El botón «Generar pedido interno + OPs» se queda mudo cuando está deshabilitado.** Solo se enciende
cuando **al menos un renglón está ligado a un modelo** —y en la primera OC de un modelo la liga no existe
todavía, porque se aprende—. No dice qué falta. Es el mismo defecto que V1-E6b barrió en otras pantallas:
**ofrecer una puerta y no explicar por qué no abre.**

- **Aplica en:** el importador de OC por PDF y el constructor de pedido. Sin migración.

#### (Post-F9.71) — Cada OC de la explosión lleva SU PROPIA fecha de entrega (DANIEL, 19-ago-2026)

Daniel, usando la explosión de materiales sobre una orden real: *"me pide fecha de entrega, pero cada OC
interna va a tener una fecha de entrega diferente"*.

**Tiene razón, y hoy no se puede.** `generarOCDesdeExplosion` (`dominio/compras/mrp.ts`) agrupa lo
pendiente **por proveedor** y crea **una OC por proveedor** en un clic — pero la **fecha de entrega es una
sola para todas**: la del formulario, o la de la orden si se deja en blanco. La tela se necesita semanas
antes que los avíos y cada proveedor tiene su propio tiempo: ponerles la misma fecha **convierte el dato
en decorativo**, y un dato que nadie cree no sirve para reclamar.

*(Se puede corregir cada OC después desde Órdenes de compra, pero es trabajo doble y es justo la fricción
que hace que la gente deje de usar el sistema.)*

**Dos caminos, y Daniel escogió el A:**

- ✅ **(A) Fecha por OC en la misma pantalla.** La explosión ya muestra los grupos por proveedor: que cada
  grupo tenga **su propia fecha**, con la de arriba como valor inicial. Resuelve el caso hoy.
- ⬜ **(B) Que el sistema la PROPONGA**, calculándola hacia atrás desde la entrega de la orden con el
  **tiempo de entrega guardado por proveedor**. Más potente, pero exige capturar ese dato. **Queda para
  después**, cuando los tiempos estén capturados — la recomendación del lead fue empezar por A y no
  bloquearse esperando datos que aún no existen.

- **Aplica en:** la pantalla de Explosión de materiales. Sin migración (la fecha ya existe por OC).
- **Fecha:** 2026-08-19.

---

#### (Post-F9.72) — ⭐ La receta se libera POR PARTES, y desde la OP — no desde «Modificar» (DANIEL, 19-ago-2026)

Salió de Daniel recorriendo el flujo completo con una orden real y **no encontrando dónde autorizar los
avíos**.

**El problema que destapó, y es de fondo.** El panel de receta —con el botón de **liberar**, que es *la
puerta que abre la compra*— vive dentro del diálogo de **«Modificar»** de la orden
(`CentroOrdenesPagina` → mosaico *Modificar* → `DialogoOrden` → `PanelRecetaOrden`). Daniel: *"ahí está y
no tendría que estar ahí"*, y la frase que lo vuelve grave: **"nadie va a tener permiso de modificar la OP
más que yo"**.

O sea: si liberar vive detrás de «Modificar», o **Daniel se vuelve el cuello de botella** firmando todas
las recetas, o **hay que darle a Desarrollo permiso sobre la OP entera** —cantidades, fechas, matriz de
tallas— solo para que apruebe una lista de materiales. **Los dos permisos ya existen separados
(`ordenes.administrar` vs `desarrollo.administrar`); lo que está mal es que la puerta física es una sola.**

*(De paso: el mosaico «Modificar» **no está condicionado por permiso**, a diferencia de los de compras,
ruta y telas que sí lo están — verificado en `CentroOrdenesPagina`.)*

**Y el hueco de navegación:** la explosión de materiales **frena** diciendo que la receta no está
liberada, pero **no lleva a donde se libera**. Deja al usuario adivinando en qué pantalla está el botón.

### Lo que Daniel decidió

1. **La receta se ve y se libera desde la OP**, no desde «Modificar».
2. **Quien libera es el mismo equipo que hace el desarrollo.**
3. **Las telas las autoriza Daniel** —hoy lo hace en la autorización de la OC—, y quiere **también poder
   liberarlas** para que salgan sus OC.
4. ⭐ **Se libera POR PARTES, y el comprador ve qué falta.** Textual: *"podría haber algún cierre que aún no
   autoriza el cliente, pero ya podríamos ir comprando lo demás."*

### Lo que esto implica (y lo que YA existe, que lo hace más chico de lo que parece)

- ✅ **La compra parcial ya está medio resuelta:** `generarOCDesdeExplosion` acepta `idsRequerimiento` —se
  puede generar solo para los renglones seleccionados—; vacío = todo lo pendiente. **No hay que
  inventarla.**
- 🔴 **La puerta es TODO-O-NADA:** hoy *"sin liberar no se compra"* aplica a la receta entera. Tiene que
  pasar a **"se compra lo que está liberado"**.
- 🔴 **La firma es una sola** para toda la receta. Tiene que ser **por renglón**. ~~Con acciones en bloque
  (*"liberar todas las telas"*, *"liberar todos los avíos"*) para que lo rutinario no cueste veinte clics.~~
  ⛔ **DEROGADO el 20-ago-2026 (§Post-F9.80).** Las acciones en bloque **no las pidió Daniel: las agregó el
  lead**, y él las retiró al recorrer el flujo: *"no tiene sentido liberar las cosas sin ver"*. Se firma
  **renglón por renglón**.
- 🔴 **El comprador no tiene dónde ver lo que falta liberar.** Es requisito explícito de Daniel:
  *"transparentemente qué le falta de liberar"*.
- **Se conserva** la protección de que **tocar una receta ya liberada la vuelve a cerrar** (*"Desarrollo
  tiene que volver a firmarla"*) — ahora por renglón.
- ✅ **Cerrado el 19-ago:** sí conviene la **bandeja «Recetas por liberar»**. Daniel la aprobó en vivo
  (*"está buenísima"*) — ver **§Post-F9.74**.

- **Aplica en:** etapa propia (toca la puerta de compra: es camino de dinero). Migración probable —el
  estado de liberación pasa de la orden al renglón.
- **Fecha:** 2026-08-19.

---

#### (Post-F9.73) — Lo que le falta a la receta se JALA del modelo, y lo jala Desarrollo (DANIEL, 19-ago-2026)

Daniel, sobre el flujo completo: *"Si le falta algo a la receta y se genera la OP… ¿ya no puede jalar la
info del modelo? Creo que está mal planteado. **Podría llegar a ser común que le falte algo a la
receta.**"*

**Tiene razón, y el diagnóstico exacto es éste:** el sistema **YA detecta** la desalineación y hasta la
nombra —`calcularDesalineacion` empuja el aviso literal *"El modelo ahora lleva «X», y esta orden no lo
tiene"*— pero **no hay forma de traerlo**. Las operaciones existentes son agregar **a mano**, editar,
quitar y `restaurarRenglonReceta` — y **restaurar solo aplica a renglones que YA están** en la orden. Para
lo que falta, alguien tiene que **volver a capturarlo mirando el modelo en otra pantalla**.

⚠️ **El sistema sabe qué falta, sabe de dónde sacarlo, lo dice con nombre y apellido — y aun así obliga a
teclearlo.** Y quien lo teclearía es **compras**, que no es quien sabe si ese material va o no va.

**Y el caso no es la excepción:** una receta incompleta al generar la OP es lo **normal** cuando el
desarrollo corre en paralelo con la venta, que es como trabaja FR Moda.

### Lo decidido

1. **El aviso trae su botón de «traer del modelo»** — renglón por renglón, o todos de un jalón.
2. ⭐ **Lo jala DESARROLLO, no compras.** Daniel: *"al final es el mismo quien lo va a liberar, para que
   compras solo haga la explosión del material… **si desarrollo es quien libera la receta, debe seguir
   haciéndolo con lo que falte** (aunque él mismo sea quien lo mete en el desarrollo)"*. **Las mismas manos
   que firman son las que jalan**; compras **explota**, no captura.
3. **Lo que se jala nace SIN LIBERAR**, para que pase por la misma firma que todo lo demás — encaja con la
   liberación por partes de §Post-F9.72: *lo que llega tarde entra como un renglón más pendiente*, y el
   comprador lo ve en la misma lista de "qué me falta".
4. 🔴 **NUNCA en silencio, y NUNCA pisando lo ajustado a mano.** Daniel: *"no debe de jalarlo en
   silencio"*. Si un renglón de la orden ya se ajustó para ESTA orden en concreto, traer del modelo
   **respeta el ajuste o avisa del choque** — jamás sobrescribe. Es la misma regla de la receta congelada:
   **el modelo propone, la orden manda** (D3).

- **Aplica en:** la misma etapa de §Post-F9.72 (la receta en la OP). Sin migración propia.
- **Fecha:** 2026-08-19.

---

#### (Post-F9.74) — ⭐ La bandeja «Recetas por liberar» (DANIEL, 19-ago-2026)

Cierra el *pendiente de diseño* que §Post-F9.72 había dejado abierto. Daniel preguntó *"¿qué es recetas por
liberar? ¿una pantalla especial solo para los pendientes de la gente de desarrollo?"* y, con la explicación
enfrente, la aprobó: **"está buenísima"**.

**El problema que resuelve.** Con la firma por renglón, para saber qué le falta autorizar, Desarrollo
tendría que abrir **orden por orden**. Nadie hace eso: **solo se libera lo que alguien viene a reclamar**, y
lo que nadie reclama **se detiene solo**. Es exactamente lo que le pasó a Daniel con los avíos, que fue el
origen de toda esta tanda.

### Cómo quedó

1. **Una fila por ORDEN**, no por material — es como Daniel recorre el trabajo. *(La alternativa, agrupar
   por insumo —"todos los cierres sin liberar de todas las órdenes"—, serviría si se liberara por tandas de
   material; se descartó por eso.)*
2. **Ordenada por fecha de entrega, no por folio.** Lo que estorba primero, arriba.
3. **Marca las que ya están frenando dinero**: la orden que **ya tiene OC** de otra parte de la receta no es
   lo mismo que una recién nacida.
4. ~~**Se libera desde ahí**, sin dar la vuelta por el Centro de Órdenes.~~ ⛔ **DEROGADO el 20-ago-2026
   (§Post-F9.80):** la bandeja **ya no firma**. Lleva a la receta, y ahí se firma **viendo** — desde la lista
   solo se veía *"3 avíos, 1 tela"*.
5. Permisos: `desarrollo.ver` para verla. ~~`desarrollo.administrar` para liberar.~~ Al no firmar desde la
   lista, la bandeja **solo necesita `desarrollo.ver`**. Sin permisos nuevos.

- **Aplica en:** V1-E3h, la misma etapa de §Post-F9.72/.73.
- **Fecha:** 2026-08-19.

---

#### (Post-F9.75) — Firmar desde la bandeja se hace SIN los renglones a la vista (LEAD, 19-ago-2026)

**Nace de un defecto, y por eso conviene que quede escrita.** La primera versión de la bandeja **no podía
liberar nada** en su caso dominante: una orden recién creada nace con sus renglones `sin_revisar`, y liberar
exige que no quede ninguno — así que el botón mandaba al Centro de Órdenes a «marcar todo revisado» y
volver, *la vuelta que la bandeja existe para evitar*.

**Cómo se resolvió:** liberar desde la bandeja marca revisado lo que esté sin revisar **dentro del alcance**
y firma **en el mismo acto y la misma transacción**, y lo deja anotado en la bitácora (`revisadosEnEsteActo`)
— **no se disfraza de "ya estaban revisados"**. Los renglones `ajustado` conservan su marca y las lápidas
quedan fuera. El botón dice lo que hace: **«Revisar y liberar»**.

⚠️ **La consecuencia de negocio, que Daniel debe conocer:** desde el panel de la orden se firma **con los
renglones en pantalla**; desde la bandeja se firma viendo solo *"3 avíos, 1 tela"*. No relaja ninguna
invariante (mismo permiso, todo auditado, todo en transacción) y es el mismo colapso que «marcar todo
revisado» ya hacía desde V1-E3d —que existe porque *"obligar a 8 clics por OP entrena a la gente a
clickear sin leer"*—, **pero es una decisión de producto, no un detalle de implementación**. En el panel de
la orden los dos botones siguen separados a propósito: ahí los renglones están a la vista y la fricción sí
compra algo.

> ⚠️ **RETIRADA el 20-ago-2026 por §Post-F9.80.** Daniel quitó el botón «Revisar y liberar» de la bandeja
> —*"no tiene sentido liberar las cosas sin ver"*— y con él se fue `revisarPendientes`, que solo existía
> para servirlo. La consecuencia de negocio que esta decisión dejó anotada es justamente la que él resolvió.

- **Aplica en:** V1-E3h. Señalado por el reviewer, que pidió explícitamente que no quedara solo en el código.
- **Fecha:** 2026-08-19.

---

#### (Post-F9.76) — Dos decisiones de diseño de V1-E3h que no deben vivir solo en comentarios (LEAD, 19-ago-2026)

Las señaló el reviewer: están bien resueltas, pero hoy solo existían en TSDoc y en el `migration.sql`.

1. **`Orden.recetaLiberadaEn` se CONSERVA, pero como DERIVADO** = *"no queda ningún renglón vivo sin
   firmar"*, mantenido únicamente por el dominio (`sincronizarLiberacionOrden`). **Ya no es la puerta de
   compra** —esa es por renglón—: lo que la lee es el **semáforo de "orden completa"** y el detalle de la
   orden. Retirarla obligaba a re-derivar ese semáforo con un `NOT EXISTS` por orden a cambio de nada.
   Verificado que **no hay ningún escritor suelto**: solo tres sitios escriben renglones de receta, y los
   tres sincronizan la bandera.
2. **La puerta de la OC capturada a mano mira TODAS las líneas de esa orden, no solo las que se agregan.**
   Es deliberado y del lado seguro: conserva la protección de V1-E3d (con la firma revocada no se le meten
   líneas nuevas a una OC ligada), y mirando solo lo agregado un material fuera de la receta serviría de
   caballo de Troya. **Tiene un costo real**: agregar una línea de un material ya firmado se bloquea si otro
   renglón de esa orden se re-cerró. Anotado también en `HOJA-DE-RUTA.md §4`.

- **Aplica en:** V1-E3h. Sin migración adicional.
- **Fecha:** 2026-08-19.

---

#### (Post-F9.77) — ⭐ La receta merece PANTALLA PROPIA, y es UNA sola (DANIEL, 19-ago-2026)

Salió de Daniel probando la versión **0.005** en vivo, y lo importante es **qué falló**: no la lógica, la
**visibilidad**.

Buscaba meter a una OP unos avíos que se habían agregado al modelo *después* de crearla. El bloque de la
receta le decía **"la receta de esta orden está vacía"** — y ese cartel se llevó toda la atención, mientras
**justo debajo** estaba el aviso *«El modelo ahora lleva X»* con su botón «Traer del modelo». Cuando por fin
lo vio, funcionó a la primera: *"ya logré jalarlos. **Justo me faltó poner el botón de traer la receta**."*

⚠️ **El mecanismo de §Post-F9.73 estaba completo y cableado de punta a punta. Lo que no estaba era a la
vista.** *Una función que el usuario no encuentra no existe.*

### Lo que pidió

*"Debería de haber una pantalla especial para ir liberando. Ahí mismo **en el cuadrito chiquito no se ve
toda la información**. Me gustaría que de ese botón te mande a una **pantalla más grande** con la
información más clara."*

Y al día siguiente, viendo la bandeja, lo afinó: *"**Está bien que haya una sola pantalla y sea la misma.**
El problema que veo en «Recetas por liberar» es que solo está la OP con un botón para liberar todas juntas.
**No veo dónde pueda ver todo completo e ir liberando una por una.**"*

### Lo decidido

1. **UNA sola pantalla**, y es **la misma** desde el detalle de la OP y desde la bandeja. No dos vistas que
   se parezcan: el mismo componente y la misma ruta, se llegue desde donde se llegue.
2. **Desde la bandeja hay que poder ENTRAR**, no solo liberar en bloque. ~~El «Revisar y liberar» de
   §Post-F9.75 se queda (existe para no dar la vuelta cuando ya sabes lo que hay), pero deja de ser la
   única salida.~~ ⛔ **DEROGADO el 20-ago-2026 (§Post-F9.80):** entrar dejó de ser *una* salida para ser
   **la única**. El «Revisar y liberar» se retiró: desde la lista se firmaba viendo solo *"3 avíos, 1
   tela"*.
3. **Firmar uno por uno tiene que ser lo evidente** — es literalmente lo que fue a buscar y no encontró.
4. **El bloque del detalle de la OP se queda como RESUMEN** con su botón: no se pierde el vistazo rápido
   desde la orden, y el trabajo de verdad se hace donde se ve.
5. **La jerarquía es el entregable, no la decoración.** El llamado a traer del modelo va **arriba**, en tono
   de acción y no de alarma; y con la receta vacía **ya no se ofrece «liberar»** — ese clic solo servía para
   que el servidor contestara *"está vacía"*, que fue el cartel que tapó la salida. **La regla del servidor
   NO cambió**: sigue rechazando. Lo que se quitó fue el botón que solo servía para chocar contra ella.

- **Aplica en:** V1-E3j. Sin migración.
- **Fecha:** 2026-08-19.

---

#### (Post-F9.78) — Leer la receta pasa a `ordenes.ver` **o** `desarrollo.ver` (LEAD, 19-ago-2026)

Apareció construyendo V1-E3j y **cierra un hueco que dejó V1-E3h**: ahí las mutaciones de la receta bajaron
a `desarrollo.administrar` y la bandeja quedó en `desarrollo.ver`, pero **la LECTURA se quedó en
`ordenes.ver`**. O sea: alguien de **Desarrollo puro** podía **firmar** una receta que no podía **leer**, y
la pantalla nueva —gobernada por `desarrollo.ver`— le habría contestado **403 en su primera consulta**. Es
justo el síntoma que §Post-F9.68 manda matar.

**No relaja nada, y se verificó en vez de suponerlo:** las 7 rutas de mutación siguen exigiendo
`desarrollo.administrar` (y en dominio hay **un solo** `verificarPermiso`, dentro de `enRecetaEditable`);
`obtenerRecetaOrden` **solo lo llama esa ruta**, así que el ensanche no se propaga al MRP ni al impreso; A9
sigue intacto. Y lo nuevo que ve un rol de solo-Desarrollo es **`estado` y `totalPiezas`**: `cliente` y
`fechaEntrega` **ya** se los servía la bandeja bajo ese mismo permiso.

De paso, la receta ahora incluye el **encabezado de la orden** (cliente, fecha de entrega, estado, total de
piezas). Es aditivo y **derivado en el SERVIDOR** (A1) con la misma semántica que usa el listado de órdenes.
La alternativa —pedirle el encabezado a `GET /ordenes/:id`— habría vuelto a atar la pantalla a
`ordenes.ver`, que es lo que esta etapa vino a soltar.

- **Aplica en:** V1-E3j.
- **Fecha:** 2026-08-19.

---

#### (Post-F9.79) — ⭐ No se quita de la receta lo ya COMPRADO, y una OC autorizada se puede DES-AUTORIZAR (DANIEL, 19-ago-2026)

Daniel, mirando el botón «restaurar del modelo»: *"¿Qué pasa si ya se liberó un renglón, se hace la OC de
ese avío… **se puede luego quitar**? Eso no está bien."*

**Verificado: tiene razón, y hoy nada lo impide.** Ninguna mutación de la receta consulta las órdenes de
compra; la única consulta de OC en `dominio/produccion/receta-orden.ts` (`:850`) solo decide si un aviso se
pinta rojo o amarillo. Lo que queda tras hacerlo es una **contradicción**: la OC dice *"compramos esto para
la orden N"* y la receta de N dice *"esto no va"* — y la explosión deja de contarlo, así que el *"qué tengo
/ qué falta"* ya no cuadra con lo comprado. **Peor** si el renglón era `agregadoAMano`: quitarlo **lo
borra**, y el único rastro queda en la bitácora.

### El camino que se descartó, y por qué importa

El **lead propuso** un permiso para **saltarse** la regla (que solo Daniel pudiera quitar lo comprado).
**Daniel propuso algo mejor:** *"una OC ya autorizada ya no se puede quitar de la receta. **A menos que se
pueda des-autorizar**. Es indispensable tener un botón para desautorizar las órdenes, que solo yo tenga
acceso."*

⚠️ **En vez de una llave para saltarse la regla, se deshace el hecho que la creó.** Nadie se salta nada y el
sistema sigue contando la verdad. *Es el mismo principio de D3 —cancelar es un movimiento inverso auditado,
no un borrado— aplicado a la autorización de compra.*

### La regla

| Estado de la OC | ¿Se puede quitar de la receta? |
|---|---|
| Sin OC, o cancelada | **Sí** (como hoy) |
| `borrador` / `pendiente_autorizacion` | **Sí** — todavía no hay compromiso con el proveedor |
| `autorizada` | **No.** Hay que des-autorizarla primero |
| `recibida_parcial` / `recibida_total` | **No, y ni des-autorizando** — ✅ **CONFIRMADO por DANIEL (20-ago-2026):** *"una vez recibido no se puede desautorizar"*. El material ya entró al inventario, y el camino honesto es devolución o ajuste, no deshacer la firma |

El bloqueo va **por material**, no por orden entera: cada línea de OC guarda de qué tela o avío es.

### Des-autorizar

**No existe.** `autorizarOC` (`dominio/compras/ordenes-compra.ts`) sella `idUsuAutorizado`/`fechaAutorizado`
y **no hay marcha atrás**. Permiso propio, **solo para el perfil de Daniel**; **motivo obligatorio** y
bitácora. ⚠️ **No basta con quitar el sello:** autorizar **emite un evento** (`emitirOcTelaResuelta`) que le
dice a la Ruta Crítica que la compra de tela quedó resuelta — des-autorizar tiene que **deshacer ese
efecto** o la RC se queda creyendo que ya se compró.

### Sobre "solo yo"

Daniel: *"cuando digo yo, **es mi perfil**. Está bien el tema de perfiles como lo planteas."* → **sin
excepciones por usuario**; el permiso vive en el perfil, como todo lo demás (§Post-F9.67). Queda dicho el
corolario: quien reciba ese perfil recibe también esta llave.

### ✅ Cómo quedó (V1-E3y, 22-ago-2026)

**Las dos piezas se construyeron JUNTAS**, como pedía la decisión.

**El bloqueo va por MATERIAL y sólo sobre TELA/AVÍO** (una línea de OC apunta a `idTela`/`idAvio` o es
texto libre: **no hay forma de ligar una OC a un ARTE**, así que ahí no hay nada que comprobar). Se
aplica a **tres** mutaciones, con un criterio único —*¿esto saca de la compra un material ya
comprado?*—, y el criterio no son *"estos campos"* sino **el REQUERIDO real**: *antes pedía algo y
después no pide nada*, calculado con `requeridoAvioReceta`, la misma función que usan la explosión
MRP y la habilitación. Se aplica a **quitar** (siempre), **editar** y **restaurar**.
⚠️ **Son TRES puertas, no dos**, y la tercera casi se escapa (la cazó el reviewer): además de apagar
`paraProduccion` y de dejar el consumo en **0**, en un avío **por talla** (R18) el requerido sale de
las **MEDIDAS**, así que ponerlas todas en cero vacía la compra con los dos campos intactos. Y su
espejo: un avío con consumo 0 y medidas > 0 **sí** pide material, y un criterio de dos campos lo daba
por fuera y no lo protegía. Por eso el criterio pasó a ser el número que de verdad manda.
**No** se bloquean `traerDelModelo` ni `agregarRenglonReceta`: verificado que sólo CREAN lo que no
está o REVIVEN una lápida — meten material, nunca lo sacan. Un renglón que **ya estaba fuera** antes
de comprarse no se bloquea: la puerta se cierra al que quiere salir, no al que nunca entró.

**Des-autorizar** devuelve la OC a **`borrador`** —y no a `pendiente_autorizacion`, porque se verificó
que **nada en el sistema escribe ese estatus** (la bandeja de autorización pide borradores): así la OC
reaparece exactamente donde estaba antes de firmarse. Permiso propio **`compras.desautorizar`**,
restado de `directivo` en el seed → queda sólo en **Administrador** y **AdministracionDireccion**.
⚠️ **El deploy a `prueba` requiere `SEED_ON_START=true`.**

**Sobre el efecto en la RC —el punto que la decisión marcó como indispensable— NO se escribió ningún
inverso a mano, y se verificó en vez de suponerlo:** `reevaluarCompraTela` (`ruta-critica/autoAvance.ts`)
**relee el estado físico** (*¿hay una OC de la empresa en autorizada/recibida\_\* con línea de tela ligada
a esta orden?*) y des-completa cuando ya no la encuentra. Así que des-autorizar emite el **MISMO**
`oc-tela-resuelta` que autorizar y cancelar, y el consumidor decide el efecto según lo que halle.

- **Aplica en:** **V1-E3y** (ficha en `docs/hoja-de-ruta/V1-etapas.md`). Sin migración; **CON permiso
  nuevo** → el deploy a `prueba` requiere `SEED_ON_START=true`.
- **Fecha:** 2026-08-19 (cerrada al construir el 22-ago-2026).


---

#### (Post-F9.80) — ⭐ La receta se firma UNO POR UNO: se van los botones de liberación en bloque (DANIEL, 20-ago-2026)

Daniel, recorriendo el flujo: *"me parece una mala idea el botón de «Liberar todo lo que falta». Creo que
siempre se debe liberar uno por uno, para que se revise lo que se está haciendo. **No tiene sentido liberar
las cosas sin ver**."*

⚠️ **Importa de dónde salieron los botones que se van: no eran decisión suya.** Su decisión en §Post-F9.72
fue *"debería poder liberarse por partes, y que el comprador vea qué le falta"*. Las **acciones en bloque**
las agregó el LEAD, razonando que *"lo rutinario no cueste veinte clics"* — un razonamiento que optimiza la
prisa, cuando **la firma no es un trámite: es la puerta que abre la compra**. Un botón que aprueba diez
cosas de un clic entrena exactamente lo que la firma existe para evitar.

**Qué se retira, en los tres lugares donde estaba:**

1. **«Liberar todo lo que falta»** en la pantalla de la receta y en el panel de la OP.
2. Los tres botones **por sección** («todas las telas», «todos los avíos», «todo el arte»).
3. **«Revisar y liberar»** de la bandeja «Recetas por liberar» — *el peor de los tres*, porque desde ahí se
   firmaba viendo solo *"3 avíos, 1 tela"*, **sin la lista enfrente**. Nació de un defecto (§Post-F9.75).
   **La bandeja pasa a hacer solo lo que debe: llevar a la receta**, donde se firma viendo.

**Qué SE QUEDA, y Daniel lo eligió explícitamente: «marcar todo revisado».** No libera nada — solo dice
*"ya miré estos renglones y vienen bien del modelo"*—, **no compromete dinero**, y existe desde V1-E3d
porque la mayoría de las órdenes lleva la receta del modelo tal cual y pedir el visto bueno uno por uno
**ahí sí** entrenaba a clickear sin leer. La distinción que Daniel confirmó es la regla de fondo:
**la fricción se cobra donde hay consecuencia.**

**Y se cumple EN EL SERVIDOR, no solo en la pantalla** (A1/A4 + §Post-F9.68: esconder *y* bloquear). El
cuerpo de `POST /ordenes/:id/receta/liberar` perdió el `alcance` (`todo`/`telas`/`avios`/`artes`/`seleccion`)
y la bandera `revisarPendientes` de §Post-F9.75, que queda **retirada** al desaparecer su único usuario.
Hoy el cuerpo es **obligatorio** y lleva la lista de renglones: **quien firma NOMBRA lo que firma**.
Se conserva lo que Daniel sí pidió en §Post-F9.72 —**liberar por partes**—: se puede firmar una parte y
dejar el resto pendiente; lo que ya no se puede es que **el servidor expanda** un comodín a renglones que
nadie nombró. Sin llamadores reales del bloque (el ETL de migración escribe la firma directo, no por esta
función), retirarlo no rompió nada.

⚠️ **Lo que esto NO pretende ser:** un cliente puede leer la receta, juntar los ids y mandarlos todos en
una llamada. Es deliberado — es la línea que el servidor sí puede sostener: **jamás se firma un renglón
cuyo id no se conocía**. Volver a ofrecerlo con un botón sería re-tomar esta decisión, no aprovechar un
hueco.

- **Aplica en:** V1-E3k. Sin migración, sin permisos nuevos, sin seed.
- **Fecha:** 2026-08-20.


---

#### (Post-F9.81) — ⭐ LA CURVA DE LA ORDEN MANDA, y cuando difiere de la del modelo se AVISA (DANIEL, 20-ago-2026)

Daniel, capturando el consumo por talla de un avío en la receta de la OP: *"me da la curva diferente a como
la di de alta… yo le puse la curva de la XCH a la XG y en «recetas por liberar» me pone tallas de bebés"*.

⚠️ **Y él mismo corrigió el diagnóstico, que es lo que vuelve valiosa esta decisión:** *"perdón… creo que el
error es mío. Yo di de alta el modelo a partir de una OC de C&A que es de bebés, y cuando hice la receta le
puse tallas de caballeros. **Mi información de pruebas es incongruente.** Pero entonces, ¿de dónde toma las
tallas realmente?"*. El sistema **no tenía un defecto de cálculo**: tomaba las tallas de donde debe. Lo que
sí tenía —y es el defecto real que Daniel nombró— es que **se dejó capturar dos curvas que se contradicen
sin decir ni media palabra**: *"no debería dejarme poner otra curva, o bien debería de decirme que ya tiene
una curva dada de alta"*.

**Las tres respuestas de Daniel, textuales:**

1. *"Está bien que cuando ya haya una curva de la OP, pida comprar sobre esa curva. **Está perfecto el
   criterio**."* → **la curva de la ORDEN manda.** Se compra y se consume sobre las tallas que el cliente
   realmente pidió, nunca sobre la curva teórica del catálogo. Esto ya era así (`medidasPorTalla` arma los
   renglones desde `ordenLineaTalla`); la decisión lo **ratifica** para que deje de ser un detalle de
   implementación y pase a ser regla escrita.
2. *"Sí estaría bien que **informe** que la curva es diferente (**solo como aviso**)."* → **avisar, NO
   bloquear.** Entre las dos salidas que él mismo ofreció —*"no debería dejarme"* o *"debería decirme"*— eligió
   la segunda. Es coherente con §Post-F9.64 (*la curva de tallas es una guía, no una jaula*): que una OP pida
   tallas fuera de la curva del modelo es **legítimo y ocurre**, y bloquearlo pararía trabajo real. El aviso
   dice **los nombres de las dos curvas y qué tallas sobran o faltan** — un aviso que solo dijera "son
   distintas" obligaría a ir a buscar la diferencia a otra pantalla, que es justo lo que a Daniel le pasó.
3. *"Si el modelo **no tiene curva** y ya tiene una OP, **que jale la curva de la OP**. Está perfecto."* →
   el hueco se llena solo con el dato que ya existe, en vez de mandar a capturar a mano algo que el sistema
   puede deducir.

**Lo que esta decisión NO cambia:** la curva del modelo **sigue existiendo y sirviendo** — es la propuesta
para las OP que aún no tienen matriz, y el punto de partida del precosteo (D13), donde todavía no hay orden
de la cual jalar nada. Lo que se acaba es que las dos convivan **en silencio**.

**🔴 Y un hallazgo del lead que viaja con esta decisión, porque es la MISMA queja vista de otro lado: el
ORDEN de las tallas.** `Talla.orden` es `Int @default(0)` y **el ETL nunca lo escribe** —`asegurarTalla`
llama a `crearTalla(sesion, { etiqueta })` sin `orden`—, así que **todas las tallas migradas del Access
valen 0** y el desempate cae en la etiqueta: *CH, G, M, XG* en vez de *CH, M, G, XG*. No es cosmético —una
matriz de tallas en desorden se lee mal y se captura mal— y aparece en **seis lugares** que ordenan por ese
campo. Es un arreglo de **datos** (sembrar el orden canónico de las etiquetas conocidas) más el **hueco del
ETL** que lo dejó así; no requiere preguntarle nada a nadie, porque el código es concluyente sobre lo que
se migró.

**Dos sub-decisiones cerradas en la RONDA DE CORRECCIÓN (21-ago-2026), del ingeniero, no de Daniel** (son
consecuencias técnicas de esta misma decisión, no reglas de negocio nuevas):

- **(i) Renombrar la etiqueta de una talla RE-DEDUCE su orden — pero sólo si el orden vigente lo puso la
  escala.** El alta ya deducía; si el renombrado no lo hiciera, el mismo defecto entraría por otra puerta
  (dar de alta `CH` y renombrarla a `3M` la dejaría para siempre entre las letras, y el seed no la repararía
  porque su orden ya no sería el sentinela `0`). Se sabe que *nadie lo puso a mano* en exactamente dos
  casos: `orden === 0`, o `orden === deducirOrdenTalla(etiquetaVieja)`. Cualquier otro valor es una decisión
  humana y **no se toca**. Un `orden` explícito en la misma llamada manda, y una etiqueta que la escala no
  reconoce vuelve al sentinela `0` (quedarse con el orden de la etiqueta vieja afirmaría que `UT` va donde
  iba `CH`, que es justo lo que este módulo se niega a inventar).
- **(ii) Si la curva que cubre esas tallas existe pero está DESACTIVADA, asignar la curva de la OP se
  RECHAZA** — con el nombre de la curva y dónde reactivarla. Las otras dos salidas se descartaron por
  escrito: *crear una gemela «Curva CH-M-G (2)»* deja una mentira permanente en el catálogo y parte en dos
  la misma idea; *reactivarla sola* desharía en silencio un acto deliberado (el borrado suave es un acto),
  y con esa razón basta. ⚠️ Se escribió aquí una tercera —que reactivar exigiría `tallas.administrar` y
  sería un agujero de privilegio— y **se retiró por INEXACTA**: la rama que crea la curva ya llama a
  `crearCurva`, que pide ese mismo permiso. *Una decisión correcta apuntalada con una razón falsa queda
  peor que con una razón menos.* Rechazar es lo único que ni ensucia el catálogo ni mueve nada que nadie
  pidió mover, y cuesta un clic que es exactamente el acto deliberado que hace falta.

⭐ **Y una regla de método que dejó esta decisión:** el TSDoc de la escala presume de estar **MEDIDO**. Esa
presunción sólo vale si la medición se puede **re-correr**, así que vive como script comiteado en
`backend/migracion/analisis/medicion-orden-de-tallas.ts` (usa el parser del propio ETL y la escala del
dominio, e imprime cada cifra que la documentación cita). Se llegó ahí después de que dos reviewers
seguidos encontraran cifras que no se reproducían: la primera vez se arreglaron *las cifras*, y volvió a
pasar.

- **Aplica en:** la etapa de curvas de talla del track V1. Sin permisos nuevos.
- **Fecha:** 2026-08-20 (sub-decisiones (i) y (ii): 2026-08-21).


---

---

#### (Post-F9.82) — ⭐ EL PROVEEDOR DEL MATERIAL: la tela lo trae, el avío lo tiene, y el comprador desatora (DANIEL, 20-ago-2026)

Daniel, con la receta de una OP **completamente liberada**, en `Compras › Explosión de Materiales`: *"no me
deja hacer nada… ahí veo todo, pero no puedo avanzar"*. El botón «Generar OC» solo se enciende con renglones
que traigan **proveedor sugerido**, y **ninguno lo tenía**.

⚠️ **El diagnóstico no fue "falta una función": fue una DESVIACIÓN.** `Tela.idProveedor` —el **proveedor
DUEÑO del artículo**— existe desde §Post-F9.11 con la regla de Daniel escrita en su propio comentario (*"la
felpa de Alsatex y la de otro proveedor son telas DISTINTAS"*). Pero **F8 agregó `TelaProveedor`** (precios
por proveedor, pensado para material que se compra a varios) y **la resolución del MRP se fue por ahí**; sin
ese amarre —que casi ninguna tela tiene— el motor se rendía. Por eso el sistema le pedía capturar un
proveedor **que la tela ya tenía**, y por eso *"no veo dónde se le asigna"*: buscaba lo que ya estaba puesto.

### Lo que Daniel dijo, y lo que se hizo con cada frase

1. **TELA = un proveedor dueño.** *"Normalmente las telas SÍ tienen un proveedor específico… el proveedor ya
   viene definido en la tela. **Ahí no tenemos telas que puedan pertenecer a más de un proveedor**."* →
   el MRP resuelve por `Tela.idProveedor`. Cascada: **amarre de Desarrollo → DUEÑO → asignación de Compras**.
   ⚠️ Su precio sale de su renglón negociado (`TelaProveedor`) si lo tiene; si no, del precio de
   **REFERENCIA** de la tela (`precioSugerido`) — que es **otra cosa** y por eso se **avisa**: es
   exactamente el $0.00 rotulado «referencia» que Daniel vio y que nadie le explicó.

2. **AVÍO = un proveedor HABITUAL, asignado.** *"En avíos sí podría ser que un elástico se compre con más de
   un proveedor y a desarrollo le da lo mismo… pero **tener avíos sin proveedor asignado está generando más
   problemas que beneficios**."* → bandera `AvioProveedor.habitual`, **uno por avío** (índice único PARCIAL
   en la base). Cascada: **amarre → HABITUAL → más barato → asignación de Compras**. Se invierte el default
   de F4, pero **el más barato NO se retira**: queda de fallback para el avío que nadie marcó.
   ⚠️ **Alcance exacto del "no cambia nada":** ningún avío con **varios** proveedores cambia de
   comportamiento — ahí el habitual solo nace de una decisión humana. El de **uno solo** SÍ lo toca el
   backfill, y a propósito: si ese proveedor tiene precio, el "más barato" ya lo elegía (misma respuesta);
   si **no** tiene precio, pasa de *"sin proveedor"* a *"proveedor + precio de referencia, avisado"*, que
   es justo el atorón que la decisión vino a quitar.

3. **El proveedor propuesto es SUGERENCIA, no atadura.** *"**Sí puede cambiar la tela con todo y su
   proveedor a la hora de comprar. Lo mismo en avíos**."* → eso ya vivía en la OC, que nace en `borrador` y
   es editable. La sugerencia **no** se convierte en amarre en ningún lado.

4. **⭐ El comprador desatora desde SU pantalla — SOLO para esa OP.** *"El comprador podría asignarle un
   proveedor y no esperar a que la gente de desarrollo se lo asigne."* Con su restricción, **textual y no
   negociable**: *"el comprador asigna un proveedor **para esa OP en particular**… no para siempre ni para
   todo. **El proveedor puede seguir viniendo desde desarrollo**."*
   → La asignación vive en la **receta congelada de la orden** (`OrdenTela/OrdenAvio.idProveedorCompra` +
   `precioCompra`) y **NUNCA toca el catálogo**: *el catálogo propone, la orden manda* (D3/§Post-F9.43).

### ⭐ La decisión de diseño que hace cumplible el punto 4: va HASTA ABAJO de la cascada

Poner la asignación de Compras en el **último escalón** es lo que cumple la frase de Daniel **en el motor** y
no en un comentario:

- **no puede pisar a Desarrollo ni al catálogo** — solo se usa donde hay HUECO, que es el caso que vino a
  desatorar;
- si mañana Desarrollo amarra un proveedor, **Desarrollo gana solo**, sin que nadie tenga que acordarse de
  borrar la asignación de urgencia;
- y la asignación que quedó **sin usarse no se calla** (D3): la explosión la nombra en un aviso, con el
  camino para quitarla. Un dato dormido e invisible es una mentira en diferido.

**Corolario en la pantalla:** «Asignar proveedor» aparece **solo** donde no hay proveedor (o para corregir lo
que Compras ya puso). Donde el proveedor viene del catálogo o de Desarrollo se cambia **en la OC**. Cada
frase de Daniel tiene UN mecanismo, y no se pisan.

### El botón apagado tiene que DECIR qué le falta

`«Generar OC»` se apagaba sin una sola pista. Es **el mismo defecto** que V1-E3i arregló en el importador
—*ofrecer una puerta y no explicar por qué no abre*, §Post-F9.70 punto 3— y aquí había quedado igual. Ahora
nombra la causa **y los materiales**: *"2 materiales sin proveedor: Felpa, Rib…"*. Y cuando SÍ se puede
comprar pero algo se va a quedar fuera, también lo dice en vez de generar OC incompletas en silencio.

### Lo que se dejó FUERA a propósito

La **cascada compartida de PRECIOS** (`costos/resolucion-precios.ts`) **no se tocó**: responde *"¿cuánto
cuesta?"*, mientras que esta decisión responde *"¿a quién le compro?"*. Consecuencia real, dicha y no
tapada: un avío cuyo habitual no sea el más barato se **comprará** más caro de lo que se **precosteó**. No
es silencioso (es el precio del proveedor elegido, visible en la línea de la OC) y **ningún precosteo
existente cambia** (la bandera nace en `false`), pero queda como pregunta abierta si el precosteo debe
seguir al habitual.

- **Aplica en:** **V1-E3m**. Migración `20260820120000_proveedor_del_material` (3 columnas + índice único
  parcial + 2 FK), **sin permisos nuevos** (reusa `compras.administrar` y `avios.administrar`) y **sin
  seed** → el deploy NO exige `SEED_ON_START`.
  **Un solo backfill, el que no decide nada:** el avío con **un único** proveedor queda con ése marcado
  como habitual (no hay elección que hacer, y es lo mismo que hace la pantalla al agregar el primero).
  A cambio, el avío de un solo proveedor **sin precio** deja de caer en el agujero —el "más barato" solo
  mira a los que tienen precio, así que salía sin proveedor—. **Los avíos con varios proveedores NO se
  tocan:** ahí sí hay una decisión de negocio y la toma una persona, no una migración.
- **Fecha:** 2026-08-20.


#### (Post-F9.83) — ⭐ El nº de PRODUCCIÓN: concepto y género FIJOS, 999 consecutivos por par (DANIEL, 20-ago-2026)

> Daniel, cerrando la última duda que §Post-F9.34 había dejado como *lectura del lead*: ***"el concepto y
> género van FIJOS y los consecutivos disponibles son los otros 3"***.

Con eso, el código de producción de 5 dígitos queda definido sin interpretación: **2 dígitos fijos
(concepto + género) + 3 de consecutivo**, y **el contador corre por la combinación concepto+género**, con
**999 por par**. Confirma lo que §Post-F9.34 traía como lectura y lo convierte en regla dictada.

**Consecuencia que NO es adorno:** con 999 por par, el aviso de *"te estás acercando al tope"* que pedía
§Post-F9.34 hay que construirlo — y se construyó. El tope **ya se alcanzó** en Caballero (por eso Daniel
abrió la serie `x5`), y cualquier otro par que se llene ya no tendrá un dígito libre que duplicar.

**⚠️ Lo que la medición obligó a decidir al construir (decisión TÉCNICA del lead, no de Daniel).** El
consecutivo de producción **no puede salir de una secuencia** aunque A3 lo mande para los folios. Medido
sobre los 4,987 modelos del Access: el par `51` tiene **535 usados de 999 y el 999 YA está ocupado**;
igual `20`, `30`, `39`, `73`, `74`. Una secuencia sólo avanza: propondría `1000`, que no existe como
modelo, y dejaría 464 huecos inalcanzables. La propuesta es **el hueco libre más bajo del par**, calculada
bajo `pg_advisory_xact_lock` del par: elegir el hueco y escribirlo quedan serializados, y el `@unique` de
`codigo`/`numeroProduccion` es la última red. La garantía es la misma que la de la secuencia —jamás dos
modelos con el mismo número— sobre una serie que la secuencia no sabe modelar. El consecutivo de
**DESARROLLO** sí es una secuencia atómica pura (`secuencias_globales`), porque es una serie nueva.
El detalle técnico —el alcance exacto de la excepción y las mediciones de concurrencia que la
respaldan— vive donde le toca: **`docs/arquitectura/ADR-0018`**.

- **Aplica en:** **V1-E3n** (la etapa que por fin construyó §Post-F9.34 + §Post-F9.46). Migración
  `20260820160000_modelos_desarrollo_vs_produccion`; **sin permisos nuevos**; el **seed sí cambia**
  (dígitos de géneros y tipos de producto), aunque la propia migración ya siembra los de los catálogos
  existentes por nombre.
- **Fecha:** 2026-08-20.

---

#### (Post-F9.85) — ⭐ GENERAR OC DESDE LA EXPLOSIÓN: revisión previa, y no volver a comprar lo ya comprado (DANIEL, 20-ago-2026)

Daniel, probando en vivo: *"acabo de hacer unas OC desde la explosión de materiales. Ya asigné a los
proveedores directamente ahí, para simular la compra desde el comprador. Dice que se generaron las OC,
pero no se ven reflejadas en las OC. (…) No veo dónde se generó. No sé si realmente se generó o solo dice
eso, porque me vuelvo a meter en la pantalla y sigue apareciendo ahí los elementos y me deja volver a
hacerla. Creo que hace falta trabajar en ese proceso."*

### Lo que pidió

> *"Me gustaría que al darle «generar OC desde la explosión», te mande a una pantalla previa, antes de
> generar la OC. **Una revisión previa es indispensable.**"*

### Los DOS defectos VERIFICADOS en el código (independientes; los dos explican lo que vio)

**1. 🔴 La explosión NO descuenta lo ya comprado → OC DUPLICADAS.** `generarOCDesdeExplosion`
(`mrp.ts:948-1030`) filtra por `cantidadAComprar > 0` leyéndolo del **snapshot persistido** de
requerimientos. Nada le resta lo que ya está en una OC — de hecho `mrp.ts:621` lo dice explícito para la
tela: *"telas siempre van completas a compra (no se netean)"*. Por eso los renglones siguen ahí y deja
volver a generar. ⚠️ **El cruce YA EXISTE**: el tablero «qué tengo / qué falta» calcula `enOc`
(`mrp.ts:1561-1610`). **No falta la función, falta reusarla donde se compra.**

**2. Las OC sí se generaron: están ESCONDIDAS.** Nacen en `borrador` (`ordenes-compra.ts:803`) y el
listado ordena por `numCompra` **DESC** por omisión (`contrato/esquemas/compra.ts:422-426`). Sumado a
§Post-F9.17 —las secuencias que los ETL dejaron en cero—, las OC nuevas toman folios **1, 2, 3…** y se van
a la ÚLTIMA página, detrás de las ~7,978 migradas.

### Los folios arrancan en 10001

§Post-F9.36 punto 5 ya lo había decidido (*"me saltaría al siguiente escalón"*). Daniel fijó el número:
*"el sistema anterior va en la **8082**. Tenemos mucho colchón antes de llegar a la 10001."*
→ **OC arranca en 10001.** ⬜ El escalón de **OP sigue sin número**.

### ⚠️ Pasos de GABRIEL en `prueba` — NO son código

1. `npx tsx --env-file=.env migracion/reparar-secuencias.ts` (destapa las OC que Daniel ya generó).
2. Después, el salto a **10001**, que requiere que ese script acepte *salto a escalón*, no solo `max+1`.

🔴 **La lección de fondo, que no es sobre el script:** el arreglo de §Post-F9.17 estaba escrito y "listo"
desde el **7-ago** y el defecto siguió vivo **trece días**, porque dependía de un paso manual que nadie
dio. **Un arreglo que necesita que alguien corra algo no está terminado hasta que se corre.**

- **Aplica en:** etapa propia, **junto con §Post-F9.86** (las dos se tocan: la revisión previa sin el
  neteo volvería a enseñar como pendiente lo ya comprado).
- **Fecha:** 2026-08-20.

---

#### (Post-F9.86) — ⭐ UNA OC PARA VARIAS OP: la explosión deja de ser de una sola orden (DANIEL, 20-ago-2026)

Daniel: *"¿cómo hacemos cuando una OC cubre varias OP? Es muy muy común hacerlo. Normalmente compramos
varias OP con una sola OC."*

**El modelo YA lo aguanta entero; lo que falta es el camino.** Cada `OrdenCompraLinea` guarda su `idOrden`
(una misma OC lleva tela de la 5558 y avíos de la 5560 sin perder de quién es cada cantidad) y existe la
liga **N:N** `OrdenCompraOrden` con su unique. Lo que no existe es **dónde decirlo**: hoy la explosión es
de UNA orden.

⚠️ **La raíz es qué pregunta hace la pantalla.** Hoy pregunta *"¿qué necesita esta OP?"*. El comprador
hace otra: *"¿qué necesito comprar hoy?"* — y esa casi nunca cabe en una sola OP.

### Cómo se llena el conjunto de OP — los DOS caminos, con los ejemplos de Daniel

*"Podríamos hacerlo por número de pedido interno. Muchas veces se compran los avíos de un mismo pedido
interno (que incluyen varias OP) (ejemplo 1515). Pero aparte a veces se compran más órdenes… por ejemplo
cuando se compran cajas, se hace el pedido por varias órdenes al mismo tiempo."* Y su propuesta: *"chance
sería bueno que en la pantalla de explosión de materiales podamos incluir ahí varias OP y que vaya
agrupando las cantidades."*

1. **Por PEDIDO INTERNO** (el caso común, los avíos del 1515): al entrar desde una OP, la pantalla trae
   **precargadas todas las OP de su pedido**; se pueden quitar.
2. **A MANO** (las cajas, que cruzan pedidos): un buscador para agregar OP sueltas.

**Es el MISMO control llenado de dos maneras, no dos pantallas.**

### Lo que Daniel cerró

- **Reparto: SIEMPRE por OP.** Sin eso, el *"qué tengo / qué falta"* de cada OP deja de cuadrar y el costo
  no cae donde debe. **Se ve junto, se guarda repartido.**
- **Sobrante de compra: se reparte entre las OP de la compra.** Comprar el rollo completo es una decisión
  del comprador **en el momento de comprar** — es un hecho entonces, y por eso sí se reparte.

### ❌ El faltante de la recepción NO se reparte — propuesta del LEAD DESCARTADA por Daniel

El lead propuso repartir el faltante (se compran 300, llegan 280) en la misma proporción. **Daniel la
tumbó:** *"¿debería definir qué OP se queda sin esos 20 kilos ahorita? ¿No podríamos simplemente ir usando
esa tela y ver qué pasa? Recuerda que **los consumos son estimados**. Es común que de repente un modelo se
lleve tantito más de lo esperado u otro tantito menos. Creo que a la hora de ir descargando las telas es
cuando se va a poder saber a cuál aplica."*

⚠️ **Y el sistema YA funciona así — la propuesta no solo era mala, era innecesaria.** La tela entra al
inventario al recibirse, y lo que la amarra a una OP es la **salida a orden** (`inventarios/telas.ts`:
*"la única vía que descuenta tela hacia una orden"*), que guarda `origenId = idOrden` y la cantidad
**real descargada**.

**La regla:** se compran 300, llegan 280, **entran 280 al almacén**, y cada OP se lleva lo que de verdad
se lleva. Si al final falta, se ve en el almacén cuando no alcanza, y se compra más.

🔴 **La lección para el lead:** repartir el faltante en la recepción habría pedido una decisión **con peor
información que la que iba a haber después**, y la habría dejado escrita **como si fuera un hecho**.
*El BOM es una estimación; el kardex es un hecho. No se resuelve un hecho futuro con una estimación
presente.*

⚠️ **Ojo con la aparente contradicción**, que no lo es: el **sobrante** sí se reparte y el **faltante** no,
porque el sobrante es una decisión tomada al comprar (un hecho) y el faltante es un dato que todavía no
existe cuando llega el material.

- **Aplica en:** la misma etapa de §Post-F9.85.
- **Fecha:** 2026-08-20.

---

#### (Post-F9.87) — ⭐ RECIBIR EMPIEZA POR EL PROVEEDOR, no por el número de OC (DANIEL, 21-ago-2026)

> Daniel: *"en la recepción de orden de compra, debería de buscar primero por proveedor y de ahí que
> muestre todas las OC abiertas de ese proveedor. **No tiene caso empezar por el número de orden. En la
> realidad cuando vas a recibir algo, buscas al proveedor que llegó a entregar.**"*

**La pantalla pregunta al revés que la vida.** Quien llega al almacén es el proveedor, con su mercancía;
el número de OC es lo que hay que *averiguar*, no lo que se sabe. Es el mismo error de altitud que
§Post-F9.86 corrigió en la explosión: la pantalla preguntaba *"¿qué necesita esta OP?"* cuando el
comprador se pregunta *"¿qué necesito comprar hoy?"*.

### Lo que hay hoy (`RecepcionComprasPagina.tsx:74-92, 310-332`)

Un **único `<select>`** con `OC {numCompra} · {proveedor}`, ordenado por `numCompra` **DESC**, alimentado
por dos consultas de **`porPagina: 100`** (una de `autorizada`, otra de `recibida_parcial`).

🔴 **Y de ahí sale un defecto que Daniel no reportó pero que ya está vivo: el tope de 100 hace
INALCANZABLES las OC de más abajo.** No es que estén incómodas: no hay forma de llegar a ellas desde esa
pantalla, porque el `<select>` no busca en el servidor. Es **la misma trampa del selector de colores** que
V1-E4 ya tuvo que arreglar (*"el `<select>` topado a 100 dejaba colores INALCANZABLES — el catálogo los
rebasa"*), repetida en otra pantalla. ⚠️ Y empeora sola: cada OC nueva empuja a las viejas fuera del tope.

### Lo que se construye

1. **Primero el PROVEEDOR**, con búsqueda **en el servidor** (no un `<select>` topado): se teclea el
   nombre, como ya se hace en la matriz de la OP desde §Post-F9.11.
2. **Luego sus OC abiertas** (`autorizada` + `recibida_parcial`), con lo que sirve para reconocerlas al
   momento de recibir: número, fecha, y **qué trae pendiente**. Si el proveedor tiene una sola, que quede
   elegida sola.
3. **El número de OC sigue sirviendo como atajo** para quien ya lo trae (viene en la remisión): se busca
   por proveedor **o** por número, pero **el camino por omisión es el proveedor**.
4. 🔴 **Sin topes silenciosos.** Si algo se recorta, se dice. Un catálogo que crece no puede volver
   inalcanzable lo que ya existe.

- **Aplica en:** etapa propia, en la cola de la noche del 21-ago. Toca `RecepcionComprasPagina` y las
  consultas que la alimentan; el dominio de recepción (`recibirCompra`) **no cambia**.
- **Fecha:** 2026-08-21.

---

#### (Post-F9.88) — Asignar proveedor a VARIOS avíos de un golpe, desde la explosión (DANIEL, 21-ago-2026)

> Daniel: *"cuando no tengan proveedor los avíos, ya en la pantalla de explosión, podemos hacer una forma
> de poder poner el proveedor de manera más rápida a varios elementos que lleven el mismo proveedor"*.

### Lo que hay hoy
§Post-F9.82 le dio al comprador el poder de **desatorar** asignando el proveedor sin esperar a Desarrollo,
pero **renglón por renglón**: `ExplosionMaterialesPagina.tsx:116` abre el formulario *"uno a la vez"*. Con
seis avíos del mismo proveedor son seis veces el mismo tecleo — fricción pura, sin ganancia de control.

### Por qué en BLOQUE aquí SÍ, cuando la firma de la receta NO
Es la misma distinción que Daniel planteó el mismo día al preguntar por «marcar todo revisado»
(§Post-F9.80): **lo que se puede hacer en bloque es lo que no compromete dinero.**

| Acto | ¿En bloque? | Por qué |
|---|---|---|
| **Liberar** un renglón de la receta | **NO, uno por uno** | abre la puerta a comprar (§Post-F9.80) |
| **Marcar revisado** | sí | dice *"ya lo miré"*, no compra nada |
| **Asignar proveedor** | **sí** ← esta decisión | la OC todavía pasa por la **revisión previa** (§Post-F9.85) y por su **autorización** |

⚠️ Y el riesgo del "clickear sin leer" que §Post-F9.80 evita **no aplica**: aquí no se está dando un visto
bueno, se está **capturando un dato** que además se ve entero en la previa antes de crear nada.

### Lo que se construye
- **Elegir varios renglones sin proveedor y asignarles UNO** de una vez, en la misma pantalla.
- ⚠️ **Sigue siendo SÓLO PARA ESA OP** (§Post-F9.82): se guarda en la receta de la orden, **NUNCA** en el
  catálogo. La asignación en bloque no puede convertirse en una puerta trasera para editar el catálogo.
- **Que sugiera a quién agrupar.** El caso real es *"estos seis son del mismo proveedor"*: si el sistema
  puede proponer el agrupamiento (por proveedor habitual, por el más barato, por lo que se compró la vez
  pasada) mejor que obligar a palomear seis casillas. **A decidir al construir**, con su razón escrita.
- **Auditoría (A7)**: que la bitácora diga que fueron N renglones en un acto, no N actos sueltos
  indistinguibles.

### ⬜ → ✅ Lo que quedaba abierto y se cerró al construir (V1-E3x, 22-ago-2026)

**(a) *"Que sugiera a quién agrupar"* → NO se sugiere proveedor, y la razón es del MOTOR.**
Verificado en `backend/src/dominio/compras/proveedor-material.ts`: **el proveedor habitual y el más
barato YA SON escalones de la cascada** que elige proveedor (avío: `amarre → habitual → más barato →
asignación de Compras`; tela: `amarre → dueño → asignación de Compras`). Un material sólo aparece en
la lista de "sin proveedor" cuando **ninguno** de esos resolvió. O sea: **el sistema no se está
callando una sugerencia que ya tiene — no la tiene.** Dos de las tres vías que Daniel imaginó son
imposibles por construcción, y la tercera —*"lo que se compró la vez pasada"*— sería **adivinar de un
histórico y escribirlo como HECHO** en la receta congelada de la orden: la trampa de §Post-F9.86.
Quien de verdad sabe *"estos seis son del mismo proveedor"* es el comprador; lo que le faltaba no era
la respuesta, era que decirla no costara seis formularios. Por eso: **selección múltiple +
«Seleccionar todos» + un acto**. Y se dice **dónde se arregla para siempre**: marcando el
**habitual** del avío (o el **dueño** de la tela) en el catálogo, el material deja de caer aquí.

**(b) 🔴 El renglón 4 de 6 EXCLUIDO → TODO O NADA, nombrando cuál.** *(Decisión de negocio nueva.)*
Aplicar los buenos y reportar los otros dejaría al comprador con una pantalla a medias que sólo
entendería revisando renglón por renglón —justo el trabajo que la etapa vino a quitar— y con un
*"algunos sí"* que nadie termina de leer. Todo-o-nada es además **lo único que A2 permite decir sin
mentir**: o entró el acto, o no entró. El error conserva su clase (409 sigue siendo 409), nombra la
**orden** y el **material**, y remata con *"no se asignó NINGUNO de los N renglones"*.

**(c) El ALCANCE lo elige el usuario, no el sistema.** La forma de a uno pregunta a cuál orden va
(§Post-F9.82: *"para esa OP en particular"*), así que el acto en bloque **no podía inventar un
"todas" que nadie eligió**. Con varias OP en pantalla hay un select: **«Todas las órdenes de esta
compra»** (default) o **«Sólo la orden N»**. El default es "todas" porque son exactamente las OP que
el comprador acaba de armar arriba, y dejar a medias las demás volvería a apagar el botón de generar
OC.

**(d) En bloque sólo se PONE proveedor, y SIN precio.** Quitar sigue siendo renglón por renglón: es
deshacer una decisión puntual y se lleva el precio con ella. Y el precio **es de cada material** —un
mismo número para seis avíos distintos sería falso—, así que el acto en bloque no lo lleva.

**(e) El duplicado no infla el conteo.** El mismo par `(orden, material)` repetido no cambia nada en
la base, pero **sí** cambiaría el *"se asignaron 8"* que el usuario lee como verdad. Se deduplica.

- **Aplica en:** ✅ **V1-E3x (22-ago-2026)** — `asignarProveedorDeMaterialEnBloque` en
  `backend/src/dominio/compras/proveedor-de-orden.ts` (delega renglón por renglón en la de a uno,
  dentro de UNA transacción), `PUT /api/materiales/proveedor-en-bloque`, y el panel de asignación en
  bloque de `ExplosionMaterialesPagina`. Ficha en `docs/hoja-de-ruta/V1-etapas.md §V1-E3x`.
  **La política de proveedor (`proveedor-material.ts`) NO cambió**, como esta decisión pedía.
- **Fecha:** 2026-08-21 · **cerrada al construir:** 2026-08-22.

---

#### (Post-F9.89) — ⭐⭐ LA TELA SE COMPRA POR COLOR: el color se pierde justo en el eslabón de comprar (DANIEL, 21-ago-2026)

> Daniel: *"se selecciona una tela con la que se desarrolla el producto, de ahí nos piden esas telas para
> distintas órdenes en diferentes colores. Cuando se hace la receta no lleva el color, solo lleva la tela.
> Pero al pedir la tela, no puedo pedir esa tela solamente, tengo que pedir el color en cada modelo. **Debo
> de tener la posibilidad de ir comprando esa tela en diferentes colores (y pantones).**"*

### El hueco, VERIFICADO en el esquema

| Dónde | ¿Lleva color? |
|---|---|
| BOM del modelo (`ModeloTela`) | **No** — y está bien: el modelo define la TELA, no el color |
| Orden de producción (`OrdenLinea`) | **Sí**, con **pantone por color** (campo propio) |
| **Receta de la OP (`OrdenTela`)** | 🔴 **NO** — sólo `idTela` |
| **Renglón de OC (`OrdenCompraLinea`)** | 🔴 **NO** — sólo `idTela` |
| Recepción (`recibirCompra`) | **Sí, y OBLIGATORIO** — *"exige el `idTelaColor`, nunca lo adivina"* |

⚠️ **El sistema obliga a RECIBIR por color pero no deja PEDIR por color.** Quien recibe tiene que inventar
la correspondencia, y la misma tela en tres colores es un solo renglón que no dice cuánto de cada uno.
Y arrastra el segundo reporte del mismo día (*"no me deja poner precio ya estando en la explosión"*):
`TelaColor` guarda **precio por color** y **precio de complemento por color** precisamente porque varían —
si el renglón no lleva color, **no tiene el dato con el que decidir cuál es el precio**.

### (a) El sistema PROPONE, Compras CAPTURA, y el desvío se avisa a quien autoriza

Daniel: *"me gusta la opción de que el sistema proponga, pero en campos editables, para poder checar y
modificar algo en caso de ser necesario. Es más, creo que estaría mejor que **ponga el cálculo el sistema
de lo que se requiere pero que compras capture cada cantidad**. El sistema debería de validar que las
cantidades no excedan un porcentaje. De cualquier manera falta una autorización para liberar la OC.
Entonces **si el sistema encuentra algún desvío grande que le notifique a la persona que va a autorizar la
OC**."*

Cuatro piezas, y el orden importa:
1. **El sistema calcula** cuánta tela de cada color pide la OP (sale de la matriz color×talla, que ya
   existe) y lo **propone**.
2. **Compras captura** la cantidad de cada color. No es un campo pre-llenado que se acepta a ciegas: la
   propuesta se ve al lado, el número lo teclea la persona.
3. **El sistema valida contra un porcentaje** de desvío. ⬜ El porcentaje queda por fijar (arranca con un
   default y se ajusta con el uso).
4. 🔴 **El desvío NO bloquea: se AVISA a quien autoriza la OC.** Es el mismo espíritu de §Post-F9.64 (*la
   curva es guía, no jaula*) y de §Post-F9.85 (*no basta con no callarse: hay que no mentir*) — el control
   está en la autorización que ya existe, no en una tranca que empuja a la gente a rodearla.

### (b) El precio sale del color, se corrige ahí, **y actualiza el catálogo**

Daniel eligió *"corregir ahí actualiza el catálogo"*. O sea: el renglón trae el precio de `TelaColor`, el
comprador puede corregirlo en la explosión, **y esa corrección queda como el precio de ese color para las
próximas compras**.
⚠️ **Consecuencia que hay que construir con cuidado:** corregir un precio en UNA compra cambia el catálogo
para TODOS. Exige **auditoría (A7)** —quién, cuándo, de cuánto a cuánto y desde qué OC— y que el cambio se
vea, no que ocurra callado. ⬜ Queda por decidir si hace falta permiso propio o basta con
`compras.administrar`.

### (c) Se compra el COLOR y el almacén lo reparte

*"Sí, se compra el color y el almacén lo reparte."* Si dos OP necesitan el mismo color de la misma tela, va
en un solo renglón.

⚠️ **Esto NO contradice §Post-F9.86 (*"reparto SIEMPRE por OP"*), aunque lo parezca.** Son dos planos:
- **La OC sigue registrando cuánto es de cada OP** — es la INTENCIÓN de compra, y es lo que hace que el
  *"qué tengo / qué falta"* de cada OP cuadre y que el costo caiga donde debe.
- **La tela FÍSICA entra al almacén y la `salida-a-orden` decide el consumo REAL.**
Es exactamente la misma estructura con la que Daniel resolvió el faltante en §Post-F9.86: *el BOM es una
estimación; el kardex es un hecho*. Comprar por color no cambia quién paga: cambia **qué se pide**.

- **Aplica en:** etapa propia y **grande** — toca el modelo de datos (`OrdenTela` y `OrdenCompraLinea`
  necesitan color), la receta de la OP, la explosión, la generación de OC y el cruce con la recepción.
  ⚠️ Es de las que **no deben mezclarse** con otra.
### ✅ CERRADO AL CONSTRUIRLO (V1-E3u, 21-ago-2026) — lo que quedaba por decidir

**1. El porcentaje de desvío: 10 %, por EMPRESA y editable sin deploy.**
Vive en `ConfiguracionEmpresa.pctDesvioCompra` (no en una constante) y **se edita en
*Administración › Empresas › Configuración***, campo *"Aviso de desvío en compras (%)"*, precisamente
porque Daniel dijo *"arranca con un default y se ajusta con el uso"*: una constante obligaría a un deploy para moverlo, y
§Post-F9.17/.85 ya enseñó que **un arreglo que necesita que alguien haga algo no está terminado hasta que
alguien lo hace**. El 10 % sale de tres cuentas: (i) el negocio ya reconoce el **5 %** como variación
normal (§Post-F9.19, *"el proveedor puede entregar +/− 5%"*), así que avisar por debajo sería avisar de lo
normal; (ii) **redondear al rollo o al mínimo del proveedor casi siempre cae por debajo del 10 %**, y ése
es un ajuste que Daniel YA declaró legítimo (§Post-F9.86, el sobrante de compra) — una alarma que suena
en cada compra deja de leerse; (iii) **un rollo entero de más sí lo pasa**, que es el caso que Daniel
quiere que llegue a quien autoriza. Se avisa de MÁS **y de MENOS**: comprar de menos es más peligroso (la
OP se queda corta y nadie se entera hasta que falta la tela). 🔴 **Y no bloquea nada**: la OC se genera
igual, el aviso viaja en el renglón y lo lee quien autoriza.

**2. El precio NO necesita permiso propio: basta `compras.administrar`.**
Un permiso nuevo nacería **sin asignar a nadie** y cerraría en silencio justo el camino que la decisión
vino a abrir; y `telas.administrar` obligaría al comprador a esperar al dueño del catálogo, que es
exactamente la espera que §Post-F9.82 quitó. El control es el mismo que Daniel eligió para el desvío —
**visibilidad, no tranca**: la corrección responde el ANTES y el DESPUÉS para que la pantalla lo enseñe,
la pantalla avisa que *"aplica a todas las compras futuras de ese color"*, y la bitácora (A7) guarda
**quién, cuándo, de cuánto a cuánto y desde qué OP u OC**. Editar el catálogo por la puerta de siempre
sigue pidiendo `telas.administrar`.

**3. 🔴 Los AVÍOS: se MIDIÓ, y el hueco NO es el mismo.**

| Dónde | Tela | Avío |
|---|---|---|
| Catálogo de colores | `TelaColor` (nombre libre + pantone + precio + precio de complemento) | 🔴 **no existe** |
| Kardex | `MovimientoDetTela.idTelaColor` **obligatorio** | `MovimientoDetAvio` **no tiene color** |
| Recepción | exige el color | ni lo pide ni podría pedirlo |
| Renglón de OC | le faltaba (lo que arregló V1-E3u) | le falta… pero no tendría contra qué validarlo |

**En la tela el color existía en los dos extremos y faltaba el eslabón de en medio.**

⚠️ **Matiz al re-medirlo (22-ago-2026), que corrige la fila «Renglón de OC» de la tabla:** el renglón de
OC de un avío **sí se puede diferenciar hoy**, vía `OrdenCompraLineaTalla` (`idColor` × `idTalla`). La
**intención de compra** de un avío ya se dice por color de **prenda** y talla — es la versión
estructurada de la tabla de Excel que el sistema viejo dejaba pegar en la OC. Lo que le falta al avío no
es *"todo"*: es la mitad del **proveedor** — el **color propio del avío** (el equivalente de `TelaColor`:
nombre libre, pantone y precio), el **kardex por ese color** y la **recepción por ese color**.

La conclusión no cambia: catálogo nuevo + dimensión nueva de existencias + recepción nueva + migración
del histórico = **otra etapa, del tamaño de ésta o más**. Por eso NO entró aquí (habría duplicado el
alcance de la etapa que Daniel puso como prioridad).

⬜ **Pendiente de Daniel:** ¿los avíos que de verdad importan por color (cintas, elásticos, cierres)
justifican el catálogo, o basta con que la descripción del avío lo diga? Anotado en `HOJA-DE-RUTA.md` §4.
⚠️ **Al preguntárselo, hay que poner sobre la mesa que en D13 (4-jul-2026) él ya había dicho** *"consumo
por talla solo ciertos avíos (telas no; **tampoco por color**)"* — puede seguir vigente o la práctica
puede haberlo rebasado, pero la pregunta se hace con esa decisión a la vista, no como terreno virgen.

**4. Qué pasa con las OC y las recetas que YA existen: nada, y a propósito.**
La migración es 100 % aditiva y las columnas nuevas nacen NULL. Una receta sin color se explota como
siempre (un renglón por tela, con el total de la orden) y sale listada aparte; **una OC sin color se
compra y se recibe exactamente igual que antes** — la recepción sólo cruza el color **cuando el renglón lo
trae**, porque convertir ese `null` en un rechazo dejaría sin poder recibir a las ~7,978 OC migradas. Y
**no se backfilea el color de nada**: adivinarlo escribiría como HECHO lo que sólo es una suposición, que
es la lección de §Post-F9.86.

**5. 🔴 Lo que faltaba cuando se auditó (22-ago-2026): el dato llegaba al contrato, no a la persona.**
La etapa se construyó en dos tandas. Al auditar la primera, el backend estaba completo y bien probado
—propuesta, captura por color, umbral por empresa, precio auditado, cruce en recepción— pero **el
`avisoDesvio` no se pintaba en ninguna pantalla** y **el color sólo salía en el impreso**. Es decir: la
decisión (a) —*"que le notifique a la persona que va a autorizar la OC"*— estaba cumplida en el JSON y
**no en el producto**, y quien recibe seguía comparando la factura contra una OC que en pantalla no
decía de qué color era. Cerrado en la segunda tanda: la **bandeja de autorización avisa en la tarjeta**
(sin abrir nada) y el renglón enseña la frase completa con el `calculado: N` al lado de lo pedido; el
color se dice en el detalle de la OC, en la **recepción** y en la **revisión previa**. 🔴 Y sigue sin
bloquear: el botón «Autorizar» no lo mira.
⚠️ **La lección, que no es nueva pero volvió a pasar:** una etapa que expone un dato en el contrato no
está terminada hasta que alguien lo VE — la misma forma de §Post-F9.17/.85 (*un arreglo que necesita que
alguien haga algo no está terminado hasta que alguien lo hace*).

**6. 🔴 Lo que encontró la revisión independiente (22-ago-2026), y por qué importa.**
Cinco de las seis afirmaciones del cierre se sostuvieron con datos. La que falló fue la que más pesa, y
tiene una forma que conviene recordar: **la etapa añadió una TRANCA al flujo de recibir y le quitó a
quien recibe la información con la que podría cumplirla.** El cruce de color rechaza la factura entera si
no coincide… pero la tela **no se recibe** en la pantalla que yo había arreglado (§Post-F9.14 la deja
deshabilitada): se recibe en *Inventarios › Telas › Entradas*, y ahí el color de la OC **no llegaba ni al
contrato**. Cerrado: el pendiente por recibir devuelve el color y la captura lo **preselecciona**.
⚠️ Y al barrer aparecieron **dos superficies más** que nadie había listado: el camino del **XML del CFDI**
(que alimenta la misma pantalla) y la frase *"la OC no lo define"* en **cinco** sitios, no dos.
Otros tres bloqueantes de la misma revisión: el editor de OC dejaba pegado el color de la tela anterior
**sin control para corregirlo**; `pctDesvioCompra` era una columna **sin puerta** (arriba); y el cruce
nuevo y `repartirComprometidoPorColor` no tenían **ni una prueba** — la mitad *"y se recibe igual"* de la
respuesta 4 estaba **escrita, no verificada**.
🔴 **La lección, que es la misma de arriba en otra piel:** *un dato que llega al contrato no ha llegado a
la persona*, y *una validación nueva obliga a preguntarse quién tiene que cumplirla y con qué información
cuenta*. Añadir un control sin dar el dato no es proteger: es trasladar el problema a quien menos puede
resolverlo.

⚠️ **Y un último apretón (22-ago), pequeño pero de la misma familia:** el aviso de *"esto lo eligió el
sistema"* se quedaba en la explosión y **no llegaba a la revisión previa** — que es la última pantalla
antes de comprometer el dinero. Al llevarlo apareció el caso que de verdad muerde: un renglón omitido por
*"ya está en una orden de compra viva"* **desaparece de la compra**, y si ese *"ya está comprado"* salió de
una atribución elegida, la frase **afirma un hecho que el sistema no puede sostener** y el material se
queda sin comprar sin que nadie lo mire. Ahora los dos lo dicen. *No basta con no callarse: hay que no
mentir* — §Post-F9.85, otra vez.

- **Aplica en:** ✅ **V1-E3u, construida el 21-ago-2026 y cerrada el 22-ago-2026** (ficha en
  `docs/hoja-de-ruta/V1-etapas.md`).
- **Fecha:** 2026-08-21 (cierre 2026-08-22).

---

#### (Post-F9.90) — Los avíos FAVORITOS se sugieren al armar la receta, y se aceptan de un acto (DANIEL, 22-ago-2026)

> Daniel: *"cuando damos de alta una receta, deberíamos de tener algunos avíos «favoritos». Todo lleva
> etiqueta de lavado, por ejemplo. Podría ser la única favorita. O no sé si etiqueta de marca también. Y
> debemos de tenerla con **1 pieza por default**."*

### ⚠️ La pieza YA EXISTE — y nadie la conectaba

`Avio.favorito` y **`Avio.cantFav`** (*"cantidad preestablecida cuando es favorito"*) están construidos
desde F1-E3, con su regla validada en el dominio (`catalogos/avios.ts`: *"si el avío es favorito, captura
la cantidad preestablecida (mayor a 0)"*), en el contrato y con sus pruebas.

🔴 **Pero ninguna pantalla lo leía.** `grep favorito|cantFav` en `frontend/src/modulos/modelos/` y
`/ordenes/` → **cero**. Se podía marcar un avío como favorito con su cantidad y al armar la receta **no
pasaba nada**. Es el patrón que ya salió cuatro veces esta semana: **el dato llega al modelo y no al
usuario** (el color en la recepción, el aviso de desvío sin pantalla, la elección que no llegaba a la
revisión previa, y ahora esto).

### La decisión: SUGERENCIA, no precarga — y aceptar es UN acto

> Daniel: *"los favoritos aparecen como sugerencia. **Pero solo hay que aceptarlos y ya.**"*

Ni precarga silenciosa (nadie los vería) ni palomear uno por uno (§Post-F9.36 punto 3: *obligar a 8 clics
entrena a la gente a clickear sin leer*). **Se ven antes de entrar, y entran de un clic.**

⚠️ **Encaja con la regla que salió de sus dos preguntas del 21-ago** (§Post-F9.88): *en bloque se puede
hacer lo que NO compromete dinero*. Poblar una receta no compra nada — la compra sigue pasando por liberar
uno por uno, la revisión previa y la autorización de la OC.

### Lo que se construyó
- Al armar la receta del **MODELO**, los avíos `favorito` se **sugieren** con su `cantFav` (el *"1 pieza
  por default"* de Daniel sale de ahí; ya es un dato por avío, no una constante).
- **Un acto los acepta todos**; se pueden quitar o ajustar antes o después.
- **Cuáles son favoritos lo decide Daniel marcándolos en el catálogo**, cuando quiera. **NO se cableó
  ninguna lista en el código** — él mencionó etiqueta de lavado y quizá la de marca, pero eso es dato, no
  reglas. Si no hay ninguno marcado, la sugerencia no aparece: es correcto.
- Toca la receta del **MODELO**, no la de la OP, así que **no cruza** con §Post-F9.89 (tela por color).

### ⬜ → ✅ Las decisiones que quedaron abiertas y se cerraron al construir (V1-E3v, 22-ago-2026)

**(a) ¿La sugerencia aparece sólo en receta VACÍA o también en una que ya tiene renglones? → SIEMPRE.**
Apagarla en cuanto hay un renglón la volvería inútil justo donde más sirve: la receta casi nunca se arma
de un tirón, y quien vuelve al día siguiente a agregar la segunda tela necesita el recordatorio **más** que
quien empieza de cero. **El olvido no ocurre en el minuto uno; ocurre a la mitad.** No estorba, porque la
tarjeta desaparece sola cuando ya no queda nada que sugerir.

**(b) ¿Y un favorito que YA está puesto? → no se duplica, y el resto se sigue ofreciendo.**
Lo obvio es no duplicarlo: aceptar es **aditivo** (sólo mete lo que falta) y es idempotente (aceptar dos
veces agrega 0). Lo que **no** era obvio es qué hacer con los demás, y la respuesta es que se siguen
ofreciendo: **tratar "ya tengo uno" como "ya los revisé todos" es exactamente cómo se pierde el segundo.**
El que ya está se **dice aparte** (*"El avío favorito del catálogo ya está en esta receta"*), para no
prometer de más ni dejar la duda de si se ignoró. 🔴 **Y se dice SIEMPRE, también cuando hay otros
que sí faltan** (el caso MIXTO: dos favoritos, uno puesto y otro no). Si el aviso sólo saliera cuando
no queda nada que ofrecer, en el caso mixto la tarjeta hablaría únicamente del que falta y la duda
quedaría intacta — que es justo lo que esta decisión vino a cerrar.

**(c) Un favorito marcado SIN cantidad no se adivina — pero tampoco se calla.** (Apareció al construir.)
La regla `favorito ⇒ cantFav > 0` se valida desde que existe, pero el ETL y las filas viejas pudieron
entrar sin ella. Un avío así **no se sugiere** —inventarle un consumo sería escribir una suposición como
hecho, la lección de §Post-F9.86— y **se nombra** en la tarjeta, para que alguien lo complete en el
catálogo en vez de preguntarse por qué no sale.

**(d) Aceptar NO puede pisar captura sin guardar.** Aceptar escribe en el servidor y recarga la ficha, lo
que **resiembra** la captura del editor: con cambios pendientes, lo tecleado se perdería **sin avisar**.
El botón se **bloquea con la razón a la vista** (*"Guarda primero la receta…"*) en vez de tragárselo — es
la misma familia de §Post-F9.85: *no basta con no callarse, hay que no mentir*.

### Lo que NO entró, a propósito
- **La receta de la OP no se toca.** Cada orden lleva su receta **congelada** (§Post-F9.43); meter
  favoritos ahí sería reabrir el *"alcance hacia atrás"* que V1-E3d vino a cortar. Daniel dijo *"cuando
  damos de alta una receta"*, y la que se da de alta es la del **modelo**.
- **No se sugieren telas ni arte — y con la tela, la razón NO es la que parecía.** 🔴 **Daniel lo
  corrigió el 22-ago-2026, leyendo esta misma doc:** *"Las telas favoritas tienen otro sentido que
  los avíos. Era para mostrar en inventarios un grupo reducido de telas que son las que más uso. No
  para que por default me ofrezca una tela. Es completamente otra cosa que los avíos."*
  Es decir: `Tela.favorito` y `Avio.favorito` **comparten el nombre y no la función**. El del avío
  es *"esto va en toda receta, pónmelo"*; el de la tela es *"éstas son las que muevo, enséñamelas
  primero en INVENTARIOS"*. No es una versión incompleta del otro, y **no le falta `cantFav`**: la
  cantidad no pinta nada en lo que la tela favorita quiere resolver. La lectura anterior —*"si algún
  día se quiere la tela sugerida, el paso previo es darle su cantidad"*— **era una suposición del
  desarrollo, no una petición de Daniel**, y queda retirada.
  ⚠️ **Y lo que hoy es verdad de la tela favorita: existe, se captura, nace marcada (A1.1 punto 2),
  se pinta como badge *«Favorita»* en el catálogo… y NINGUNA pantalla de existencias la mira.** Ni
  filtro, ni agrupación, ni orden. O sea que la función que Daniel describe **está pendiente de
  construir**, no a medias: lo único que hay es la marca. Anotado en `HOJA-DE-RUTA.md`.
  El **arte** sí carece de favoritos por completo: no hay catálogo de artes (su catálogo es
  `TipoProceso` con `esArte`, que no lleva la bandera).
- **No se marcó ningún avío como favorito.** Eso es dato suyo, en el catálogo, cuando él quiera.

- **Aplica en:** ✅ **V1-E3v, construida y cerrada el 22-ago-2026** (ficha en
  `docs/hoja-de-ruta/V1-etapas.md`).
- **Fecha:** 2026-08-22.

---

#### (Post-F9.91) — Los avíos NO llevan catálogo de color: el color va en su descripción (DANIEL, 22-ago-2026)

**De dónde salió.** Al cerrar §Post-F9.89 (*la tela se compra por color*), Daniel sospechó que lo mismo
haría falta en los avíos: *"y seguramente también en avíos"*. Y él mismo puso el ejemplo:
*"Un ejemplo de avíos por color. Es un cierre. Por ejemplo, hay que pedir en la OC 4 diferentes órdenes,
cada una de un color diferente."*

**Se midió antes de asumirlo, y el hueco NO era el mismo.** En la tela, el color **ya existía en los dos
extremos** (`TelaColor` en el catálogo, `idTelaColor` obligatorio en la entrada de inventario) y sólo
faltaba el eslabón de en medio — por eso V1-E3u fue una etapa y no un módulo. Al avío le falta **la mitad
del proveedor**: no hay `AvioColor`, `MovimientoDetAvio` no tiene color y la recepción no lo pide.
Construirlo es catálogo nuevo + kardex por color + recepción por color + migración del histórico: **otra
etapa del tamaño de V1-E3u o más**.

**La decisión de Daniel, con el costo a la vista:**

> *"Podríamos dar de alta cada avío en un color. Si es muy complejo, chance hay que evaluarlo. **No es la
> misma relevancia que la tela**, porque acá son pocos los avíos que son por color. Podríamos dar de alta
> cada avío con su propio color en la descripción y ya."*
>
> Y al confirmarlo: *"**Va. Entonces lo dejamos así y ponemos los avíos con color en la misma descripción
> del avío.**"*

**Qué significaba en la práctica (22-ago):** un cierre azul y un cierre rojo son **dos avíos** del
catálogo, cada uno con su clave y su descripción. Nada que construir: la explosión, la OC y la recepción
ya los tratan como avíos distintos.

> 🔴 **CORREGIDO POR §Post-F9.126 (27-ago-2026) — la conclusión de arriba, NO la decisión.** Lo que se
> mantiene intacto es lo que Daniel decidió: **no hay catálogo de color de avío, el color va en la
> descripción**. Lo que se cayó es el *"nada que construir"*: cuando Daniel usó el sistema volvió con el
> caso completo y pidió otra cosa —**un solo avío repetido**, no cuatro del catálogo—:
> *"poner **4 veces el cierre** y en la descripción del avío ponerle el color"*. Duplicar el avío en el
> catálogo habría multiplicado por cuatro su BOM, su precosto, sus proveedores y sus medidas, y habría
> partido su inventario en cuatro. **V1-E8c lo construyó por el camino barato:** el renglón se parte por
> el color de la **PRENDA** (el que ya vive en la matriz de la OP) y el texto del color viaja **editable**
> en la línea de OC — sin catálogo nuevo, que es exactamente lo que él dijo aquí. *La decisión de alcance
> aguantó; la manera de aplicarla no.*

**Por qué se escribe si no se construye nada.** Porque **una decisión que no se anota se vuelve a
preguntar**, y ésta se le hizo a Daniel con un análisis largo detrás. Queda cerrada: *no es un olvido del
plan, es una decisión suya*. ⚠️ El análisis del costo se conserva en `HOJA-DE-RUTA.md` §4 por si algún día
se reabre (cintas, elásticos o cierres en volumen), pero **no se le vuelve a preguntar** sin un motivo
nuevo.

⚠️ **Coherente con D13** (4-jul-2026), donde Daniel ya había dicho *"consumo por talla sólo ciertos avíos
(telas no; **tampoco por color**)"*. No hubo cambio de opinión: hubo confirmación.

- **Aplica en:** era *"nada que construir"*; lo construyó **V1-E8c** (§Post-F9.126) sin desviarse de la
  decisión de alcance de aquí — ver el recuadro de arriba. Registrada el 22-ago-2026.
- **Fecha:** 2026-08-22.

---

#### (Post-F9.92) — El límite REAL de una subida no es el que dice el backend (DANIEL lo reportó, 21-ago-2026)

**Lo que reportó Daniel:** al importar **varias** OC del cliente en PDF de un jalón, la pantalla moría
con *«Failed to fetch»*. Con uno o dos, bien. Con tres o cuatro, muerto.

**Lo que era.** El backend declara `LIMITE_CUERPO_IMPORTACION = 64 MiB` para esas rutas y el contrato
admite hasta `MAX_ARCHIVOS_PDF = 40` archivos. Pero entre el navegador y el backend está **nginx**, y su
`location /api/` **no declaraba `client_max_body_size`** → regía su default: **1 MB**. Los PDFs viajan como
base64 dentro del JSON (base64 infla ~33 %), así que con tres o cuatro OC de ~200 KB ya se pasaba del
megabyte. **El límite verdadero del sistema era 1 MB, no 64 MiB** — y el número que todo el mundo leía era
el del backend.

**La decisión, que es más general que este arreglo:**

1. **El límite real de una cadena es el del eslabón más estricto, y ése es el que hay que documentar.**
   Un límite escrito en un archivo que nadie hace cumplir no es una configuración: es una creencia. Aquí
   había dos números —64 MiB y 1 MB— y el que gobernaba era el que no estaba escrito en ninguna parte.
2. **Los dos números se amarran con una prueba, no con un comentario.** `frontend/src/limite-cuerpo-api.test.ts`
   lee la plantilla de nginx y el archivo de rutas del backend y **exige que digan lo mismo**. Se eligió una
   prueba y no una constante compartida porque nginx no compila TypeScript: lo único que puede evitar que
   se separen en silencio es algo que los lea a los dos y truene.
3. **La forma de fallar era peor que el límite.** nginx corta el cuerpo **antes** de que llegue al backend y
   cierra la conexión: no hay 413 con cuerpo, no hay cabeceras CORS, y en los logs del backend **no aparece
   nada** —la petición nunca llegó—. Por eso el usuario veía el texto crudo del navegador y el sistema no
   tenía ni rastro que investigar. **Subir el límite no arregla esto**: cualquier otro corte (el proxy de
   Railway, un túnel caído, un internet malo) produce el mismo síntoma. Así que se arreglan **las dos
   cosas**: el límite, y que un fallo de envío se traduzca a un mensaje que se pueda seguir.
4. **El mensaje no inventa la causa.** Dice *"si cargaste varios PDFs, prueba con menos archivos a la vez;
   si el problema sigue con uno solo, revisa tu conexión"*. Afirmar *"los archivos pesan demasiado"* sería
   más cómodo y a veces **falso** — mandaría a buscar un problema inexistente cuando lo que se cayó fue la
   red. Misma regla de §Post-F9.85: *no basta con no callarse, hay que no mentir.*
5. **Un error que SÍ trae respuesta del servidor pasa intacto.** El arreglo ingenuo —envolver todo en un
   mensaje genérico— cambiaría un defecto por otro peor: taparía *"ese PDF no es una OC de C&A"* con
   *"revisa tu conexión"*. El backend siempre gana (A1).

**Lo que este defecto enseña para lo que viene:** cada capa que se atraviesa puede tener su propio tope, y
sólo se descubre cuando alguien lo pisa. Las que faltan por verificar: el proxy de **Railway** (no se puede
comprobar desde el repo) y cualquier CDN que se meta en medio. **Anotado, no resuelto.**

- **Aplica en:** ✅ **V1-E3w, construida el 22-ago-2026** (ficha en `docs/hoja-de-ruta/V1-etapas.md`).
- **Fecha:** 2026-08-22.

---

#### (Post-F9.93) — Leer el XML de la factura al RECIBIR AVÍOS: propuesta y confirmación, nunca automático (DANIEL, 23-ago-2026)

Daniel: *"al recibir telas o avíos, en caso de que vengan con factura, ¿no estaría bien poder subir el XML
y que automáticamente genere la entrada? ¿Se podrá, o va a ser un problema ligar las entradas con los
renglones que corresponda cada uno? El tema es que un XML puede contener parte de una orden, no toda. Es
decir que cada orden puede recibir varios XML."*

### Lo que YA existe (para TELAS) y por qué su duda ya estaba resuelta
§Post-F9.20 construyó exactamente esto para telas (`dominio/inventarios/cfdi-entrada-tela.ts`): lee RFC del
emisor, UUID, fecha y cada concepto con cantidad e importe; guarda el XML en R2; de ahí nace el cargo de
CxP. **Y el cruce no es contra "la orden": es contra los renglones PENDIENTES del proveedor**
(`lineasTelaPendientesDeProveedor`). Por eso **una factura que trae parte de la orden encaja, y la
siguiente ve lo que quedó pendiente después de la primera** — varios XML contra una misma OC funcionan
**por construcción**, no porque se haya previsto el caso.

⚠️ Y **a propósito NO escribe nada**: el TSDoc lo dice en mayúsculas — devuelve una **propuesta** (para
cada concepto, el renglón de OC que probablemente surte) y **una persona confirma**, porque el XML no dice
**el color**, que es justo el dato que nadie puede adivinar.

### La decisión de Daniel para AVÍOS

> *"Cada proveedor puede hacerlo diferente, entonces que no sea tan automático. **Debería de haber una
> pantalla para confirmar a qué renglón corresponde**."*
> *"Sí, el usuario debe de confirmar. **Nada completamente automático**."*

**Mismo patrón que telas, y por la misma razón que él nombró**: la heterogeneidad entre proveedores es
precisamente lo que hace que un cruce automático falle seguido. Lo que se construye:
- Subir el XML en la recepción de avíos → **pantalla de confirmación** renglón por renglón (el sistema
  propone, la persona acepta o corrige).
- **Reusar**, no reconstruir: el parser (`terceros/cfdi/parser-cfdi.ts`), la validación de receptor y el
  cruce contra pendientes ya existen y están probados. *Un solo lugar entiende de CFDI en todo el sistema.*
- ⬜ **A resolver al construir:** qué hacer cuando un concepto **no se reconoce** (no debe perderse en
  silencio — §7 del proyecto), y si el cargo de CxP nace aquí o queda para Finanzas.

- **Aplica en:** etapa propia, en la cola. **Estado: hoy NO existe nada para avíos** (verificado: cero
  menciones de CFDI en `dominio/compras/recepciones.ts` y en `RecepcionComprasPagina.tsx`).
- **Fecha:** 2026-08-23.

---

#### (Post-F9.94) — La REVISIÓN PREVIA de la OC tiene que ser editable: precio y cantidad (DANIEL lo reportó, 23-ago-2026)

Daniel: *"Al hacer las órdenes de compra en explosión de materiales, ya hay una pantalla previa, pero **no
me deja poner el precio correcto ni la cantidad**. Acuérdate que al final puedo modificar precio o cantidad
antes de generar la OC. **No me deja modificar nada**."*

**Verificado: tiene razón.** `RevisionPrevia` (`ExplosionMaterialesPagina.tsx`) pinta **todo como texto**
—`formatearCantidad` / `formatearMoneda`— y sólo ofrece «volver» y «confirmar». Ni un campo.

⚠️ **Y el lead se equivocó al responderle** que en la pantalla anterior sí se podía: sólo a medias. El mapa
real, verificado:

| Dónde | Cantidad | Precio |
|---|---|---|
| **Explosión** (paso 2) | ✅ campo *«Comprar»*, **sólo en renglones comprables** | ❌ sólo al **asignar proveedor**, y ese formulario aparece nada más en ciertos renglones |
| **Revisión previa** (paso 3) | ❌ | ❌ |
| **Órdenes de compra → Editar** | ✅ por renglón | ✅ por renglón (pero **ya generada la OC**, y si está `autorizada` sólo el perfil admin) |

### Por qué la previa nació de solo lectura, y por qué eso NO impide arreglarlo
Se hizo así por una razón buena: *"todo lo que pinta viene del SERVIDOR, calculado por el MISMO código que
luego genera — una previa que calculara por su cuenta sería una promesa que el sistema no cumple (A1)"*.
**Esa razón se conserva:** al cambiar una cantidad o un precio, la previa **vuelve a pedirle el plan al
servidor** y repinta el total. Sigue sin calcular nada por su cuenta, y el usuario corrige **donde tiene
sentido corregir**: la última pantalla antes de comprometer el dinero, que es donde ve el total.

⬜ **Pregunta abierta a Daniel:** el precio cambiado en la previa, ¿se queda **sólo en esa OC** o se
recuerda para la próxima compra de ese material a ese proveedor? Lo segundo toca el catálogo, y él ya fue
claro en que la vía rápida no debe volverse una puerta trasera para editarlo (§Post-F9.88).

- **Aplica en:** ✅ **V1-E3z, construida el 23-ago-2026** (ficha en `docs/hoja-de-ruta/V1-etapas.md`).
  ⬜ **Queda abierta la sub-pregunta del precio recordado, y la respuesta fue que NO hay que construir
  nada:** el costeo ya toma el último precio **de la línea de OC autorizada** (§Post-F9.48), así que un
  precio corregido en la previa se vuelve el vigente **en cuanto la OC se autoriza**, sin tocar el
  catálogo — que es justo lo que §Post-F9.88 prohíbe.
- **Fecha:** 2026-08-23.

---

#### (Post-F9.95) — El factor de conversión es de AVÍOS: la tela siempre va en kilo o metro (DANIEL, 23-ago-2026)

Al preguntarle si compra por presentación, Daniel cerró dos cosas de un golpe:

> *"En compras el precio es **por unidad**. O sea, puede ser que se compre por rollos, pero en ese caso el
> precio es **justo por rollo**. Por eso importante el campo de unidad."*
> *"Me refería al rollo en los **avíos**. O docena, o cualquier otra medida. **En telas siempre es por kilo
> o por metro. Nunca hay otra medida**."*

**(a) La convención queda fijada: PRESENTACIÓN.** La cantidad y el precio de una línea de OC van en la
unidad que se compra (rollos, docenas), no en la de consumo. Es lo que ya asumen el schema y la recepción,
y **cierra la pregunta abierta** de la deuda de F4 registrada en `HOJA-DE-RUTA.md` §4 (*"decidir la
semántica — lo natural es dejarla en PRESENTACIÓN"*).

**(b) La regla de la tela ya estaba construida así, y está bien.** El motor de conversión fija **tela → 1**
y sólo el avío lleva factor (`AvioProveedor.factorConversion` → `Avio.factorConversion` → 1). No existe
ningún campo de factor en tela. La regla de Daniel y el código coinciden.

🔴 **(c) Y esto convierte en REAL un defecto que parecía teórico, acotado a AVÍOS.** El factor existe, lo
leen 12 archivos del dominio (65 lecturas: MRP, precosteo, resolución de precios, costo real, recepción)
y **NADIE puede escribirlo**: no está en ningún esquema del contrato ni lo llena el ETL — siempre es NULL,
siempre 1:1. Con la regla de Daniel eso significa que **un cierre comprado por docena a $60 la docena se
costea a $60 la pieza**. Mientras se compre y se consuma en la misma unidad no se nota; en cuanto la
presentación difiere del consumo, el costo de la prenda se va por un múltiplo.
⚠️ **Va en UN SOLO arreglo con la deuda del MRP** ya registrada (la explosión escribe la línea en unidad de
consumo y la recepción la lee como presentación): esa deuda está **dormida** justo porque el factor no se
puede capturar, y **se despierta el día que se construya la captura**. Quien haga una tiene que hacer la
otra, o el primer avío con factor 12 entra al inventario multiplicado por 12.

**(d) De dónde sale el costo: de la OC autorizada, y el XML corrige AVISANDO.** Daniel preguntó si el costo
debía actualizarse con las OC o con el XML del proveedor. **Con la OC ya está decidido y construido**
(§Post-F9.48, 15-ago: *"si ya tenemos precios reales, lo mejor es tomar ese costo, el más actualizado"*;
`ultimo-precio-compra.ts` manda la **OC autorizada**, *"no lo recibido ni lo surtido"*). Se conserva, y el
XML **no pisa el costo en silencio**: son dos verdades distintas y las dos sirven —la OC es **el precio
negociado**, disponible cuando el costeo lo necesita; el XML es **lo que el proveedor terminó cobrando**,
llega después y puede diferir—. Un costo ya revisado que cambia solo, después y sin avisar, es de las cosas
que rompen la confianza en los números; que el sistema **diga** *"esta factura llegó a un precio distinto
del que autorizaste"* es información que el dueño quiere ver, y ahí decide.

- **Aplica en:** (c) etapa propia junto con la deuda del MRP. (a)/(b)/(d) son reglas, ya vigentes.
- **Fecha:** 2026-08-23.

---

#### (Post-F9.96) — CAPTURAR ES EL PROCESO NORMAL: primero el lugar para llenar, y el aviso amarillo sólo si no se llenó (DANIEL, 23-ago-2026)

**Cómo salió.** Daniel probó la 0.017 y reportó que *"no puedo comprar las telas por color"*. La función
existía desde la 0.013 (§Post-F9.89), completa y verificada — lo que pasaba es que **estaba escondida en el
único lugar donde nadie la busca**: el único camino para decir el color era un enlace subrayado **dentro de
un aviso amarillo**, que además **sólo aparecía si el color faltaba**, así que en cuanto se decía, el aviso
desaparecía y con él el botón: **corregir un color ya dicho no se veía por dónde**. Cuando se le explicó
dónde estaba, contestó:

> *"Ya vi dónde está, **pero no me gusta que sea ahí**. ¿Por qué no poner la opción **directo en el renglón
> de la tela**? … **los avisos en amarillo salen muchos y confunde lo que realmente se busca**."*
> *"Está muy rebuscado… no me gustó la interfaz."*

Y al preguntarle cómo lo quería, dictó **la regla**, que vale para toda la aplicación y no sólo para el color:

> ⭐ *"O sea, **el proceso normal es llenar ahí la información**. Los mensajes amarillos parecieran que
> estamos haciendo algo mal. **Primero que dé la opción de meterlo, y si no se hace, entonces que mande los
> mensajes en amarillo.**"*

**La decisión, en una línea:** *capturar es el proceso NORMAL, no una excepción.* La pantalla **primero
ofrece el lugar para meter el dato, en el renglón**; el aviso amarillo es **la consecuencia de no llenarlo**,
y aparece **cuando se va a avanzar**, no al abrir la pantalla.

🔴 **Lo que estaba mal no era la falta de una función: era el ORDEN.** La pantalla de Explosión de materiales
recibía con **nueve** avisos amarillos apilados antes del primer renglón, y el lugar para arreglar cada cosa
estaba *dentro* del regaño. Leído desde afuera, eso dice *"ya llegaste mal"* antes de dejarte trabajar — que
es exactamente lo que Daniel describió como *"parecieran que estamos haciendo algo mal"*.

**Qué se aplica (V1-E4c, versión 0.019):**

- **(a)** El color de la tela **se captura en el renglón**, en línea, **con el mismo patrón que ya usa
  «asignar proveedor»** — que estaba a dos líneas de distancia en el mismo renglón. *La forma que Daniel
  pidió ya existía en la pantalla; el color se había salido del patrón sin razón.*
- **(b)** **Siempre disponible**, no sólo cuando falta: también para **corregir** un color ya dicho.
- **(c)** El aviso amarillo del color **sale de la entrada** de la pantalla; lo que falta lo dice el propio
  renglón (el chip «Sin color» ya existía), y el aviso **reaparece al ir a generar la OC**, sólo por lo que
  de verdad quedó sin llenar.
- **(d)** Cuando el renglón cubre **varias OP y/o varios colores de prenda**, se **listan todos** con su OP y
  su color. 🔴 **NUNCA se adivina ni se aplica "el mismo a todos" por cuenta del sistema** (§Post-F9.86);
  ofrecer un *"aplicar a todos"* que la persona **elige** sí se vale.
- **(e)** 🔴 **Si la orden no tiene capturada su matriz color×talla, NO se ofrece el campo: se dice qué falta
  y dónde se captura.** El amarre `OrdenTelaColor` cuelga del color de la PRENDA (`(idOrdenTela, idColor) →
  idTelaColor`), así que sin matriz **el dato es imposible de guardar, no difícil**. *Ofrecer un control
  muerto sería exactamente el defecto que esta etapa viene a corregir.* De paso se cierra un hueco que nadie
  había reportado: hoy ese caso **se lo traga callado** (con `nombresPrenda` vacío ni siquiera entra en
  `pendientesColor`, y la tela se compra sin color **sin avisar**).
- **(f)** **Cambiar el color se puede mientras la OC esté en BORRADOR; con la OC AUTORIZADA, no** — y el
  mensaje dice que el camino es **des-autorizar** primero. Es §Post-F9.79 aplicada aquí, reusando
  `comprometido-en-oc.ts` (la única verdad sobre *"cuánto ya compré"*) y **sin escribir un criterio
  paralelo**: una segunda regla que valide "casi" igual se desincroniza en la primera corrección.
  *(Default propuesto por el lead el 23-ago y no objetado por Daniel.)*

⚖️ **Por qué la regla vale más que la etapa.** Es la **quinta vez en dos semanas** que aparece el mismo
patrón —*el dato llega al modelo y no al usuario*— y la primera en que Daniel nombra la causa de raíz: no es
que las funciones falten, es que **el sistema pone el regaño antes que el lugar de trabajo**. La limpieza de
los otros **ocho** avisos de esa pantalla queda como etapa aparte, con esta misma regla.

- **Aplica en:** V1-E4c (el color). Los otros ocho avisos, etapa siguiente. La regla, de aquí en adelante.
- **Fecha:** 2026-08-23.

---

#### (Post-F9.97) — LOS AVÍOS SE COMPRAN Y SE COSTEAN POR MEDIDA UNITARIA: se RETIRA el factor de conversión (DANIEL, 23-ago-2026)

**Cómo salió.** Al presentarle el análisis del factor de conversión —la deuda que arrastraba V1-E5, con
tres trampas y una columna nueva por delante—, Daniel cortó por lo sano:

> *"Vamos a simplificar las cosas. Vamos a meter los avíos por **medidas unitarias** y así dejamos de
> batallar con factores. Por ejemplo: un rollo de 50 metros de elástico… **normalmente cobran por metro
> y costeamos por metro**. Entonces dejamos la orden de compra por metro y en todo caso **en
> observaciones ponemos la cantidad de rollos de manera informativa**. No tiene sentido desarrollar algo
> más complejo para los factores. **Porque aparte la información viene desde el desarrollo, y ahí se
> costea por metro, no por rollo.**"*

**La decisión, en una línea:** ⭐ **la línea de orden de compra va SIEMPRE en unidad de consumo** (metro,
pieza, kilo). La presentación (rollo, caja, bolsa) **no es una unidad del sistema**: si hace falta
decirla, va como **texto informativo** en las observaciones de la OC o en la descripción libre de la
línea — campos que **ya existen** (`OrdenCompra.observaciones`, `OrdenCompraLinea.descripcionLibre`).

⚖️ **El argumento de fondo, que es el que la hace correcta y no sólo cómoda:** *el costo nace en
Desarrollo, y ahí se costea por metro.* Un sistema que compra en rollos y costea en metros necesita una
traducción **en medio de la cadena del dinero** — y esa traducción es precisamente donde se cuelan los
errores que nadie ve, porque el importe total sale igual (la invariante de valuación se cumple sobre
números equivocados). **Sin dos unidades no hay traducción que equivocarse.**

**Qué CANCELA (trabajo que se borra, no que se pospone):**

- ⛔ La captura de `factorConversion` (contrato + dominio + UI de avíos) — **no se construye**.
- ⛔ La columna `orden_compra_linea.factor_aplicado` que se iba a proponer para congelar el factor.
- ⛔ **Las tres trampas que traía la etapa, disueltas de raíz:** (1) el orden del despliegue —capturar el
  factor antes de arreglar el MRP inflaba el inventario ese mismo día—; (2) las **OC abiertas cruzando
  el cambio** de convención; y (3) 🔴 la peor: que **capturar un factor reescribiera retroactivamente el
  último precio de compra** de ese material en todo el sistema, sin auditoría
  (`ultimo-precio-compra.ts:214-216`).

**Qué queda por hacer, y es RETIRAR, no agregar:**

1. **La recepción deja de convertir** (`recepciones.ts:580-590`): la línea se lee en unidad de consumo,
   tal cual. 🔴 **El MRP ya la escribe así** (`mrp.ts:2721-2736`), o sea que el arreglo es alinear al
   lector con el escritor, no al revés.
2. **Retirar `avisoFactor`** del costeo real (`costo-real-compras.ts:660-667`), que era una mitigación
   parcial de un problema que deja de existir.
3. **Dejar escrito** —en el esquema y en el módulo— que la línea de OC va **siempre** en unidad de
   consumo, para que nadie reintroduzca la dualidad.
4. Los campos `Avio.factorConversion` / `AvioProveedor.factorConversion` quedan **muertos**: sin
   escritor, sin lector. Se documentan como retirados; **borrarlos es opcional y aditivo**.

✅ **Riesgo de datos: CERO, y está medido.** El factor **nunca se pudo capturar**: `grep factorConversion`
da **0 hits** en `backend/src/contrato/`, **0** en `backend/migracion/`, **0** en el contrato generado del
frontend, y el único escritor de `AvioProveedor` en producción (`catalogos/avios.ts:276`, `:304`) **no lo
escribe**. Las migraciones sólo agregaron la columna nullable, **sin default ni backfill**. Las únicas
escrituras del campo en todo el repo **están en pruebas**. Con el factor en NULL, presentación ≡ consumo:
**las dos convenciones coinciden numéricamente y toda línea histórica es válida en ambas lecturas.** No
hay migración de datos, no hay reproceso de kardex, no hay nota al pie.

⚠️ **Precaución al ejecutar:** por eso mismo, esto **no puede esperar** a que alguien capture un factor
por SQL. Mientras el campo exista y la recepción lo lea, la bomba sigue armada aunque esté sin cebar.

*(Esta decisión REEMPLAZA el punto 2 de `V1-E5` en `docs/hoja-de-ruta/V1-etapas.md` y acota §Post-F9.95,
que ya decía que el factor era sólo de avíos y que la tela va siempre en kilo o metro. Ahora tampoco es
de avíos.)*

- **Aplica en:** V1-E5, que se reduce a los **días de crédito** + este retiro.
- **Fecha:** 2026-08-23.

---

#### (Post-F9.98) — DÍAS DE CRÉDITO: sólo las facturas NUEVAS, y el plazo se puede corregir FACTURA POR FACTURA (DANIEL, 23-ago-2026)

**Cómo salió.** Al presentarle el defecto —`terceros.ts:46` manda `diasCredito: 0` con un comentario
fosilizado que dice *"el Cliente aún no tiene el campo (llega en E4)"*, y E4 lo agregó hace tiempo—, la
pregunta era qué hacer con los cargos ya emitidos. Daniel:

> *"Los días de crédito podemos empezar a ponerlos en las facturas nuevas cargadas acá… **lo que sea más
> fácil**. Sólo **sí sería importante poder modificar los días de crédito de cada factura**. Pero si lo
> dejas solo que calcule las nuevas está perfecto."*

**Lo que se decide:**

- **(a) Sólo prospectivo.** Se arregla el cálculo para las facturas **nuevas**; **NO se recalcula ni se
  toca ningún cargo ya emitido**. Nada de `UPDATE` masivo sobre `movimientos_tercero.fecha_vencimiento`.
- **(b) ⭐ El plazo se puede corregir FACTURA POR FACTURA**, en días. Es el caso real que Daniel nombró:
  *el cliente va a 30 de norma, pero **esa** factura se negoció a 60.* Sin esto, la única salida sería
  mentirle al catálogo del cliente para acomodar una factura.
- **(c) El recálculo usa la MISMA fórmula** (`calcularVencimiento`, `cuenta-terceros.ts:120-129`), no una
  paralela — A1. Y **no toca el importe**, así que `saldo = Σ monto` queda intacto (D3): sólo cambia
  **cuándo** se considera vencida.
- **(d) Con bitácora A7**: quién, cuándo, y **de cuántos días a cuántos**. Hoy `fecha_vencimiento` **no
  tiene historial propio**, y a partir de que se vuelve editable sí lo necesita.
- **(e) 🔴 Cambiar los días de crédito DEL CLIENTE no mueve las facturas ya emitidas.** El plazo del
  cliente es **el default de las nuevas**; cada factura conserva el suyo. *Aplicarle a una factura vieja
  el plazo de hoy sería reescribir historia con datos actuales* — exactamente la trampa que §Post-F9.97
  acaba de esquivar en el factor de conversión, y la misma que hizo rechazar la opción de recálculo
  masivo. Si una factura vieja está mal, se corrige **esa**, con rastro.

⚠️ **La precondición que NO cambia** *(escrita también en la ficha de V1-E5)*: **el ETL de apertura de
Finanzas no se corre hasta que `clientes.dias_credito` esté capturado.** El loader de saldos **sí lee**
el plazo (`terceros-saldos.ts:313-324`), pero el de clientes **no carga ese campo**, así que todo cliente
migrado nace en NULL — y el ETL produciría **la misma cartera falsa** que el defecto, sólo que con el
código ya sano y sin nada a qué culpar. *El código correcto con el dato vacío da el mismo resultado que
el código roto.*

📌 **Y el motivo por el que el defecto sobrevivió a toda F9, que vale más que el arreglo:** `cxc.int.test.ts:70`
crea el cliente **con `diasCredito: 5`** y luego asierta sobre un cargo de **hoy** y otro de **hace 80
días** — ambos caen en la misma cubeta **con plazo 0 y con plazo 5**. **La prueba pasa igual con el bug y
sin él.** Había una prueba en el lugar correcto midiendo lo que no distingue. La prueba nueva debe fechar
un cargo a **exactamente `diasCredito` días** y exigir que caiga en `corriente`.

- **Aplica en:** V1-E5, que con §Post-F9.97 queda reducida a esto + el retiro del factor.
- **Fecha:** 2026-08-23.

---

#### (Post-F9.99) — «¿Con esto queda cubierto?»: cerrar el faltante chico en el momento de decidirlo (DANIEL, 23-ago-2026)

**Cómo salió.** Daniel, usando la explosión de materiales en `prueba`:

> *"En las telas, compré **480 en lugar de 481** que era el cálculo de la tela. Y me sigue poniendo que
> me falta comprar 1 kilo… no sé cómo manejar eso, pero **a veces pasa eso en la realidad**. Y **no voy a
> hacer otra OC por 1 kilo**."*

Verificado: `RequerimientoOrden` **sólo guarda cuánto se necesita**. No existe ningún concepto de *"esto
ya lo doy por surtido aunque falte un pedacito"*, así que el faltante lo persigue para siempre.

**Lo que se decide.** Cuando el comprador **baja la cantidad** en la revisión previa por debajo de lo
requerido —justo lo que V1-E3z (0.018) acaba de hacer posible—, el sistema **pregunta qué significa**:

> Pediste **480** de los **481** que se necesitaban.
> ○ El resto **sigue pendiente** (lo compro después)
> ○ **Con esto queda cubierto** — no me lo vuelvas a pedir

- ⭐ **Se pregunta en el momento de decidir, no después.** Ahí es cuando la persona sabe la respuesta; un
  interruptor escondido en otra pantalla obliga a acordarse y a buscarlo.
- **Se pregunta SIEMPRE que se baja por debajo de lo requerido**, sin umbral. *(Decisión del lead, no
  objetada: un umbral sería otro número inventado, y de todos modos es un clic.)*
- 🔴 **El default es «sigue pendiente». Nunca se cierra solo.**
- **Con rastro (A7):** quién lo dio por cubierto, cuándo, con qué cantidad y contra qué requerido.
- **Y un «dar por cubierto» desde la explosión**, para los casos que ya se escaparon —como el que
  originó esto, que ya estaba generado.

🔴 **Por qué NO se hace con una tolerancia automática** (que es lo primero que se le ocurre a uno): **1 kg
de 481 es nada, pero 1 kg de 5 es el 20 %**. Un porcentaje único o **tapa faltantes de verdad** o no
sirve. Y un faltante tapado en silencio es exactamente la clase de defecto que este track lleva semanas
sacando del sistema. *Que la persona lo diga es más barato y más honesto que adivinarlo.*

⚠️ **PRECAUCIÓN TÉCNICA, que hay que respetar o esto se rompe solo:** la marca **NO puede vivir en
`RequerimientoOrden`**. Ese snapshot se **borra y se reescribe entero en cada explosión** (`deleteMany` +
recreación, la misma razón por la que los ids de renglón cambian y por la que V1-E4c tuvo que pasar a
claves estables). Una bandera ahí **se borraría la próxima vez que alguien explote la orden**, y el
faltante volvería sin que nadie entienda por qué. Tiene que vivir en algo **durable por (orden,
material)** — junto a la receta de la orden o en su propia tabla— y el cálculo de *"¿qué falta?"* debe
leerla junto con `comprometido-en-oc.ts`, que ya es **la única verdad sobre cuánto se compró**: el
requerimiento queda satisfecho cuando **comprometido + dado-por-cubierto ≥ requerido**. **Un criterio,
no dos.**

- **Aplica en:** ✅ **V1-E8e** (27-ago-2026, versión **0.042**). Construido tal cual: la pregunta en la
  **revisión previa** cuando se baja la cantidad (default *«sigue pendiente»*, sin umbral), un
  **«dar por cubierto» / «volver a pedirlo»** desde el renglón de la explosión para los que ya se
  escaparon, y el rastro de A7 completo. La marca vive en **tabla propia**
  (`RequerimientoCubierto`, por *(orden, material, color)*) — **no** en el snapshot, que se reescribe
  entero en cada explosión— y el neteo la lee **en el mismo criterio** que lo comprometido
  (`pendienteDeComprar`: *comprometido + dado-por-cubierto ≥ requerido*). Ficha:
  `docs/hoja-de-ruta/V1-etapas.md` §V1-E8e; módulo: `docs/modulos/compras-mrp.md`.
- **Fecha:** 2026-08-23.

---

#### (Post-F9.100) — La MEDIDA del avío tiene que viajar a la orden de compra (DANIEL lo reportó, 23-ago-2026)

**Cómo salió.** Daniel, probando la explosión:

> *"Le había puesto que **el cierre lo tengo que comprar por medidas**. Y al hacer la OC **no me aparece
> cantidad por medida… sólo veo un solo renglón**."*

**Verificado, y era un pendiente ya conocido:** el dato de la medida (`AvioMedida` / R18) **nunca entra al
módulo de compras** — `grep AvioMedida backend/src/dominio/compras/` da **cero**. `OrdenCompraLinea` sí
tiene una matriz (`OrdenCompraLineaTalla`), pero **(a)** dice **color × talla**, no medida, y **(b)** sólo
la llena la captura **manual** de una OC (`ordenes-compra.ts:641`): **la OC que genera la explosión no la
llena**. Ya estaba escrito como deuda en el PR de promoción a `main`: *"la medida del avío todavía no
viaja a la orden de compra (el sistema no le dice al proveedor qué medida pedir)"*.

**Por qué no es un adorno:** sin la medida, **una OC de cierres es impracticable** — el proveedor no sabe
qué mandar. Aplica igual a **elásticos y cintas** y a todo avío con medida por talla (R18), no sólo a
cierres. Y el dato **ya existe capturado**: es el mismo patrón que este track lleva encontrando —*el dato
llega al modelo y no al usuario*—, esta vez entre módulos.

**Queda como etapa propia**, con el alcance por definir: el desglose por medida en la línea de la OC, en
el **impreso** que ve el proveedor, y el cruce al **recibir**. ⚠️ Y hay que decidir si la medida es una
dimensión propia del renglón o se deduce de la talla —hoy la matriz es color×talla y la medida **cuelga
de la talla**, así que puede que baste con nombrarla; **eso se mide antes de construir, no se supone**.

- **Aplica en:** etapa propia, sin programar aún.
- **Fecha:** 2026-08-23.

---

#### (Post-F9.101) — UNA ORDEN DE COMPRA SIN AUTORIZAR NO SE IMPRIME (DANIEL, 23-ago-2026)

**La regla, en sus palabras:**

> *"Nunca debe de dejar imprimir una orden que no esté autorizada… **ni aunque diga borrador**. Para no
> generar confusiones con el proveedor."*

**Verificado el estado actual:** hoy el impreso **sale de cualquier OC en cualquier estado**
(`GET /ordenes-compra/:id/impreso`). El estatus se pinta como **un campo más** del encabezado
(`impreso-orden-compra.ts:330`), y lo único que el PDF distingue de verdad es la **cancelada**
(`:154`). O sea: **un borrador se imprime prácticamente igual que una autorizada**.

⚖️ **Por qué importa, y por qué la palabra «borrador» impresa NO basta:** un papel con el membrete de la
empresa, folio, proveedor, materiales, cantidades y precios **es una orden de compra a los ojos de quien
la recibe**, diga lo que diga en una esquina. El proveedor no conoce nuestros estados internos: surte. Y
un borrador es, por definición, algo que **todavía puede cambiar** — cantidades, precios, incluso el
proveedor. Mandar a la calle un documento que aún puede cambiar es **crear un compromiso que nadie
firmó**. *La autorización es la firma; sin firma no hay papel.*

**Lo que se decide:**

- **(a)** El impreso **sólo se genera para una OC AUTORIZADA** o posterior (recibida parcial/total). El
  criterio ya existe y **no se escribe uno nuevo**: es `ESTATUS_OC_COMPROMETIDA` en
  `comprometido-en-oc.ts` —la lista que §Post-F9.97/.79 dejaron compartida—, que responde exactamente
  la pregunta *"¿ya me comprometí con el proveedor?"*. **Un criterio, no dos.**
- **(b)** Se **bloquea en el SERVIDOR**, no sólo escondiendo el botón. Esconder es cortesía; **negar es
  la regla** (§Post-F9.68: *esconder Y bloquear*). Con la URL a mano, un botón oculto no protege nada.
- **(c)** El botón **se esconde** también, y cuando la pantalla sepa que no se puede, **dice por qué**:
  *"Se imprime cuando la orden esté autorizada"*. No un botón muerto ni un error seco.
- **(d)** La **cancelada tampoco se imprime**. Hoy sí sale, marcada como cancelada — pero una OC
  cancelada en manos del proveedor es la misma confusión al revés. *(Extensión del lead sobre la regla
  de Daniel; si él prefiere conservarla para archivo, se revierte en una línea.)*

⚠️ **Ojo con el efecto colateral, que es real:** hoy alguien puede estar imprimiendo el borrador **para
revisarlo en papel antes de autorizar**. Eso deja de poder hacerse. Es aceptable —para revisar están la
pantalla de la OC y la **revisión previa** de §Post-F9.85, que es justo el paso que se construyó para
eso— pero **hay que decirlo en el historial** en vez de que alguien lo descubra el día que lo necesite.

- **Aplica en:** etapa propia, chica. Junto con las demás de compras.
- **Fecha:** 2026-08-23.

---

#### (Post-F9.102) — EL IMPRESO DE LA OC SE CONSOLIDA: el proveedor ve UNA cantidad, no el reparto interno (DANIEL, 23-ago-2026)

**Cómo salió.** Daniel, tras generar la OC 7965 en `prueba`:

> *"La orden de compra debe de juntar las cantidades de dos órdenes si es el mismo producto. Ejemplo:
> acabo de generar la OC 7965. En esa orden estamos pidiendo el rojo para dos órdenes. **Para el
> proveedor debe de salir solamente una sola cantidad sumando todo el rojo.** Ya de manera interna se
> divide."*
> *"Y **las órdenes a las que corresponden no son relevantes para el proveedor**."*

**Verificado:** el PDF recorre `oc.lineas` una por una (`impreso-orden-compra.ts:267`) y **pinta una
columna con el folio de la OP** (`:280`). Como §Post-F9.86 guarda **una línea por material × OP**, el
mismo material sale **partido en varios renglones**, cada uno con un número de orden interno.

⚖️ **Lo importante: esto NO contradice §Post-F9.86, la completa.** Aquella decía *"se ve junto y se
guarda repartido"* — el reparto interno es **necesario** (cada OP tiene que cargar su costo, y el
requerimiento de cada una tiene que saberse surtido). Lo que faltaba era la **tercera cara**: *lo que
sale a la calle*. Quedan tres vistas del mismo hecho, y **cada una responde a quién la lee**:

| Vista | Quién la lee | Qué muestra |
|---|---|---|
| **Guardado** | el sistema | una línea por **material × OP** (costos, surtido) |
| **Pantalla** | el comprador | junto, **con** el desglose por OP (es su control) |
| **⭐ Impreso** | **el proveedor** | **una sola cantidad por material**, **sin** folios de OP |

**Lo que se decide:**

- **(a)** El impreso **suma por material** (y por **color**, cuando lo lleva — §Post-F9.89: el color sí
  le importa al proveedor, es lo que le dice qué tono mandar). Un renglón por lo que él tiene que
  surtir.
- **(b)** **Se quita la columna del folio de OP.** 🔴 *"No son relevantes para el proveedor"* — y no es
  sólo ruido: son **números internos** que invitan a que el proveedor los use como referencia y luego
  facture o remisione contra ellos, creando una correspondencia que el sistema no reconoce.
- **(c)** ⚠️ **El precio tiene que ser el mismo en las líneas que se suman**, o la consolidación
  mentiría. Con precios distintos para el mismo material **NO se fusiona**: se dejan separados. *No se
  promedia ni se inventa un precio* — sería escribir una suposición como hecho (§Post-F9.86). Es un
  caso raro (el precio sale de la misma cascada) pero **posible** desde que V1-E3z dejó al comprador
  teclear el precio por renglón, así que hay que resolverlo, no ignorarlo.
- **(d)** **Sólo cambia el IMPRESO.** Nada del guardado ni de la pantalla del comprador: el desglose por
  OP **es su control** y ahí se queda.
- **(e)** El total de la OC **no cambia** — es la misma suma agrupada de otra forma. *Si cambia, hay un
  defecto.* **Debe haber una prueba que lo fije.**

- **Aplica en:** etapa propia, chica, junto con §Post-F9.101 (que una OC sin autorizar no se imprime).
- **Fecha:** 2026-08-23.

---

#### (Post-F9.103) — LA FECHA DE ENTREGA DE LA OC ES OBLIGATORIA (DANIEL, 24-ago-2026)

**La regla, en sus palabras:**

> *"La [fecha] de entrega no debería de poder estar vacía. **Tiene que tener fecha de entrega a
> fuerzas.**"*

**Verificado el estado actual:** una OC **puede nacer sin fecha de entrega**. La columna
`OrdenCompra.fechaEntrega` es **nullable** (`schema.prisma:4470`) y la propia **revisión previa lo
contempla**: `fechaEntrega: z.iso.date().nullable().describe('Fecha con la que nacería (null = falta).')`
(`contrato/esquemas/mrp.ts:693`).

🔴 **O sea: el sistema SABE que falta —lo dice con esas palabras— y la deja pasar igual.** Es el mismo
patrón que la dirección de entrega antes de §Post-F9.96: *saber y no impedir*.

⚖️ **Por qué es del mismo tipo que la dirección, y por eso mismo se trata igual:** una orden de compra
sin fecha **no le pide nada al proveedor**. Le dice *qué* y *cuánto*, pero no *cuándo* — y sin *cuándo*
no hay compromiso que reclamar, no hay retraso que medir y **no hay nada que meter a la ruta crítica**.
Un papel así no es una orden: es una lista de deseos.

**Lo que se decide:**

- **(a)** **Sin fecha de entrega no se genera la OC.** Se bloquea, no se avisa. Es el **segundo** dato
  bloqueante del documento, junto con la dirección (§Post-F9.101 y la regla de la dirección).
- **(b)** 🔴 **Se bloquea en el SERVIDOR**, no sólo en la pantalla. §Post-F9.68: *esconder Y bloquear*.
- **(c)** Y se dice **con la forma de §Post-F9.96**: al abrir, **instrucción en gris** junto a su campo;
  **amarillo sólo al intentar generar** sin llenarla, con el foco al campo. *Capturar es el proceso
  normal; el aviso es la consecuencia de no llenar.* **Exactamente el mismo trato que la dirección**,
  para que las dos se comporten igual y nadie tenga que aprender dos reglas.
- **(d)** ⚠️ **Respeta lo que ya existe:** la fecha de arriba es el **VALOR INICIAL de todas** y la
  **fecha por proveedor GANA** para ese proveedor (§Post-F9.71). Así que lo obligatorio es **que cada
  OC que se vaya a generar tenga fecha**, no que se llene el campo de arriba: si un proveedor trae la
  suya propia, **ésa cuenta**. La validación va sobre **el plan**, no sobre el formulario.
- **(e)** **Las OC ya existentes sin fecha NO se tocan.** Ninguna migración de datos, ningún
  `UPDATE`. Mismo criterio que §Post-F9.98: *prospectivo*. Y si una vieja se edita, ahí sí se pide.

- **Aplica en:** junto con V1-E4e (el impreso), que es la misma zona y el mismo documento.
- **Fecha:** 2026-08-24.

---

#### (Post-F9.104) — Dar de alta una dirección va DENTRO del desplegable, no en un botón propio (DANIEL, 24-ago-2026)

**Cómo salió.** V1-E4d puso un botón **«＋ Dirección»** al lado del selector «Entregar en», para poder
dar de alta sin salir de la pantalla (era la mitad de §Post-F9.96 aplicada a la dirección). Daniel lo
vio funcionando y lo acotó:

> *"Está mejor dentro del cuadro desplegable. **Casi no se va a usar. No tiene caso tener un botón para
> eso.**"*

**Lo que se decide:** el alta se convierte en **una opción dentro del desplegable** (*«＋ Nueva
dirección…»*, al final de la lista) y **el botón suelto desaparece**. La función **no se quita**: cambia
de lugar.

⚖️ **Por qué es coherente con §Post-F9.96 y no un retroceso.** Aquella regla dice *"primero que dé la
opción de meterlo"*, y esta decisión **no la contradice: la afina**. El lugar de captura sigue estando
ahí, a un clic, en el mismo control donde ya estás mirando. Lo que se corrige es el **peso visual**:

> *La frecuencia manda sobre la barra.* Un botón permanente compite por espacio con lo que se usa a
> diario —el propio selector, la fecha, «Revisar y generar OC»— para servir a algo que, en palabras del
> dueño, **casi no se va a usar**. Darle a lo raro el mismo tamaño que a lo cotidiano es otra forma de
> ensuciar la pantalla, del mismo tipo que los nueve avisos amarillos: **ruido permanente por un caso
> excepcional**.

**Detalles:**
- La opción va **al final** de la lista, separada de las direcciones reales, para que **no se confunda
  con una de ellas** ni se elija por error.
- **Elegirla abre el mismo diálogo** que el botón (se reusa `DialogoDireccionEntrega`), y la recién
  creada **queda elegida**, igual que hoy.
- Se conserva el permiso actual (`compras.administrar`): **sin él, la opción no aparece** — mismo trato
  que el botón que sustituye.
- ⚠️ **El caso del catálogo VACÍO no puede quedar sin salida:** si no hay ninguna dirección activa, el
  desplegable está vacío y **la opción tiene que verse igual** (es justo cuando más se necesita). *No
  esconder la única puerta detrás de una lista sin elementos.*

- **Aplica en:** junto con §Post-F9.103 (la fecha obligatoria), que es la misma barra.
- **Fecha:** 2026-08-24.

---

#### (Post-F9.105) — EL CIERRE PEDÍA 53 VECES DE MÁS: la contradicción «medida vs. consumo» sigue congelada en las órdenes viejas (DANIEL, 24-ago-2026)

> *"La compra de los cierres me está dando una cantidad muchísimo mayor de la que necesito (en
> explosión de materiales)… no sé dónde está el error de cálculo. ¿Me ayudas a checar las OP 5559 y
> 5561?"* — Daniel, usando el sistema.

**No era un error de cálculo.** Era un **dato contradictorio** que la explosión usa **sin decir nada**.

### El mecanismo (verificado en el código, no supuesto)

Un avío puede llevar por talla **dos cosas distintas**, y §Post-F9.66 (V1-E3g) existió precisamente
para separarlas:

- **cuánto GASTAS** en cada talla (0.75 m de elástico en CH) → se multiplica por las piezas;
- **qué medida PIDES** en cada talla (el cierre de 53 cm) → la cantidad **no varía**: es 1 pza.

`requeridoAvioReceta` (`produccion/receta-avios.ts:45-69`) honra la bandera `consumoPorTalla`: si está
encendida, el requerido es **Σ(consumo_talla × piezas)**. Si en una captura vieja la **longitud** (53)
quedó en el campo de cantidad, el requerido sale **53× inflado**.

### 🔴 Por qué sigue vivo: la corrección fue PROSPECTIVA y nadie limpió lo viejo

- `copiarRecetaDelModelo` apaga la bandera al copiar (`receta-orden.ts:346`) — **pero eso entró el
  18-ago-2026**, en el commit `a92c044`. Antes copiaba `consumoPorTalla: a.consumoPorTalla` **a secas**.
- Las **filas** de tallas se copian íntegras a propósito (D3: no se pierde nada) — sólo dejan de mandar.
- **Ninguna de las tres puertas re-normaliza una OP existente:** `copiarRecetaDelModelo` se abstiene si
  la orden ya tiene renglones (`:262-268`); `traerDelModelo` nunca escribe sobre un renglón que ya
  existe (`:2748-2756`, y su doc lo dice); y `calcularDesalineacion` (`:752-785`) **sólo compara
  `consumoPorPrenda` y `precio`** → corregir el modelo **no levanta ni una alerta** en la OP.
- La migración de V1-E3g toca sólo `avios` y `avio_medida`: **ni un UPDATE** a `orden_avio`.

⇒ **Toda OP creada antes del 18-ago-2026** con un avío que tenga medidas activas puede traer la
contradicción congelada — incluidas las cargadas por ETL. **No son sólo la 5559 y la 5561.**

### 🔴 Y el aviso está donde se ARREGLA, no donde se SUFRE

El sistema **ya conoce** este estado y tiene el texto escrito
(*"…las cantidades por talla ya no se capturan y **siguen contando en el requerido**"*), pero:

- vive en el editor del modelo y en la receta de la orden — **dentro de un desplegable COLAPSADO**
  (`PanelRecetaOrden.tsx:845`): se puede tener delante y no verlo nunca;
- y **la explosión no puede emitirlo aunque quisiera**: su `select` (`mrp.ts:304-330`) **ni siquiera
  trae** el conteo de medidas activas del avío, que es el único hecho del que sale *"es por medida"*.

*Es el patrón de siempre: se construyó, y nadie lo ve donde duele.*

### Lo que se decide

1. **La explosión avisa.** Añadir el conteo de medidas activas al `select` de `mrp.ts` y emitir el
   aviso en `requeridoAvio`. Sale casi gratis: se prefija solo con *"Orden {folio}: "* y ya hay caja
   pintada (`exp-avisos`).
2. **El aviso sale del desplegable** a la fila del renglón, junto a los chips.
3. **Cualquier guardado del renglón normaliza.** Hoy `editarRenglonReceta:1929-1931` deja pasar la
   contradicción si el PATCH no trae `tallas` — o sea que guardar precio o proveedor **no** la cierra,
   aunque el aviso prometa que guardar la normaliza. *El texto promete algo que el código no cumple.*
4. **Hace falta un detector** de qué OP vivas la traen: no basta arreglar las dos que Daniel vio.

### El remedio manual, mientras tanto (por OP y por avío)

Receta de la OP → enlace punteado **«(por talla: …)»** → elegir la medida de **todas** las tallas →
**«Guardar medida por talla»**. Tres consecuencias que hay que decir:
**(a)** es **set completo** — las tallas sin medida amarrada **se borran**;
**(b)** **revoca la liberación** de ese renglón, y la explosión sólo lee lo liberado → hay que
**volver a Liberar** o el avío **desaparece** de la explosión;
**(c)** si el `consumoPorPrenda` fuera 0 y ya hubiera OC de ese avío, el guardado se **rechaza**.

> ⚠️ **Los `archivo:línea` de arriba son los del DIAGNÓSTICO (24-ago, antes del arreglo) y ya no
> apuntan donde apuntaban:** la etapa **V1-E6a** los movió al construir la solución. Se dejan **tal
> cual a propósito** —esto es el registro fechado de lo que se encontró, y reescribirle los números
> cambiaría lo que el documento afirma haber visto—. **Para los punteros vigentes, la ficha de V1-E6a**
> en `docs/hoja-de-ruta/V1-etapas.md`, donde además se cambiaron los rangos frágiles por **nombres de
> símbolo**, que no se pudren.

- **Aplica en:** etapa propia **antes del arranque** — hace comprar de más sin avisar.
- **Fecha:** 2026-08-24.

---

#### (Post-F9.106) — DAR DE ALTA EL COLOR DE LA TELA DESDE LA COMPRA, precargado con el pantone del cliente (DANIEL, 24-ago-2026)

> *"Ya jaló los pantones desde la OC del cliente. Ahora quiero comprar con esos pantones pero no me
> deja. Porque me jala sólo algunos colores, que supongo que son los que están dados de alta. Pero me
> gustaría que acá pueda yo poner los colores que voy a comprar. Si no están dados de alta, hay que
> darlos de alta en esa pantalla, o de manera automática al comprar."* — Daniel, probando las OP
> 5562/5563/5564.

### El terreno (por qué son dos colores y está bien que lo sean)

- **Color de la PRENDA** (`Color`, catálogo global): el de la matriz color×talla. Trae el pantone que
  llegó de la OC del cliente (`OrdenLinea.pantone`).
- **Color de la TELA** (`TelaColor`): nombre LIBRE del proveedor (*"Marino Alsa 3040"*), con su **propio
  pantone**, su **precio** y su **precio de complemento**. Es lo que el almacén RECIBE y lo que el
  kardex guarda (`MovimientoDetTela.idTelaColor`, obligatorio).
- `OrdenTelaColor` los amarra **por orden y por renglón**: *para esta OP, el marino de la matriz es este
  color de esta tela* (§Post-F9.11 / V1-E4c).

### 🔴 El hueco

El renglón de la explosión ya deja **DECIR** de qué color se compra (V1-E4c, *"Decir de qué color se
compra"*), pero **sólo deja ELEGIR entre los `TelaColor` que ya existen**. Si la tela no tiene ese color
dado de alta, el bloque dice *"«X» no tiene colores dados de alta en el catálogo: dalos de alta en…"* y
**manda fuera de la compra** — exactamente lo que V1-E4d ya había corregido para las direcciones.

⭐ **La mitad difícil ya está hecha:** el pantone de la OP **ya viaja** hasta ahí
(`contrato/esquemas/color-de-la-tela.ts:54-57`) y el sistema ya sabe proponer por **`mismo-pantone`**
(`:20-24`). Lo que falta es **la puerta**, no el dato.

### Lo que se decide

**Alta del color de la tela DESDE el renglón de la compra**, con el mismo patrón que §Post-F9.104 (el
alta de dirección): **«＋ Nuevo color…» como ÚLTIMA opción del desplegable**, separada, y **se pinta
también con el catálogo vacío** —que es justo cuando más se necesita—.

⭐ **PRECARGADO** con el pantone y el nombre del color de prenda de la OP: el comprador confirma o
corrige, pone precio si lo sabe, y **sigue comprando sin salir de la pantalla**.

### 🔴 NO se da de alta solo al comprar (recomendación del lead, aceptada como default)

Daniel ofreció las dos vías. Se elige la del clic, **por una cicatriz propia**: el catálogo de **medidas
de avío** se fragmentó porque el texto libre creó *"53 cm"*, *"53cm"* y *"53"* como tres medidas
distintas y **partió la compra en tres** (por eso hoy la etiqueta se DERIVA de número + unidad y ya no
se teclea). Con los colores pasaría igual: *"Marino"*, *"MARINO"* y *"Marino Alsa"* como tres colores de
la misma tela, **cada uno con su precio y su historial de compras**.

Un clic con todo precargado cuesta lo mismo que el alta automática y **deja a una persona decidiendo el
nombre**, que es lo que evita la fragmentación. *Crear filas de catálogo como efecto secundario de otra
acción es una escritura invisible: nadie la pidió y nadie la revisa.*

⚠️ **Si Daniel prefiere el automático, manda su criterio** — es su negocio. Queda dicho el porqué del
default para que la decisión sea informada, no heredada.

- **Aplica en:** etapa propia, hermana de V1-E4d/§Post-F9.104 (mismo patrón, misma pantalla).
- **Fecha:** 2026-08-24.

### ⚖️ AJUSTE (25-ago-2026) — quién puede dar de alta el color: **`compras.administrar`**, no `telas.administrar`

Al construirlo se vio que el permiso natural —el del catálogo de telas— **dejaba la función fuera del
alcance de casi todos**: `telas.administrar` se resta desde el rol Directivo hacia abajo, así que sólo
lo tienen **Administrador** y **AdministracionDireccion**. Daniel acababa de dar de alta a **Aurora con
rol Gerencial** para que empezara a probar compras: **habría visto el desplegable y no la puerta**, y
esta función existiría para una sola persona.

Se decide que **la puerta es de la COMPRA**: se abre donde se compra y para quien compra. El precedente
es la decisión (b) de §Post-F9.89 — **corregir el PRECIO de un color ya actualiza el catálogo con
`compras.administrar`**; si comprando se puede fijar el precio de un color, dar de alta el color es del
mismo orden. Sigue siendo escritura de catálogo: queda auditada contra la tela (A7).

⚠️ **Daniel puede pedir marcha atrás.** Si prefiere que el alta de colores sea privilegio de quien
administra catálogos, se vuelve a `telas.administrar` cambiando **una línea** en el dominio, una en la
ruta y una **en cada una de las DOS pantallas** que hoy abren la puerta (el renglón de la explosión y
el cuadro de «colores y precios de la orden», V1-E8o del 29-ago-2026) — con el efecto conocido de que
ningún perfil de compras salvo el dueño podrá dar de alta un color desde la compra.

- **Fecha del ajuste:** 2026-08-25.

### ✅ EXTENSIÓN (29-ago-2026, `V1-E8o`) — la MISMA puerta en el cuadro de «colores y precios de la orden»

La etapa que implementó esta decisión abrió el alta **en el renglón** de la explosión y **dejó anotado
en su propio código** que el diálogo «Ver todos los colores y precios de la orden N» —al que se llega
**desde ese mismo bloque, a un clic**— seguía sin ella: sólo *apuntaba* al desplegable de al lado. La
frase con la que se le contó a Daniel (*"antes te mandaba a Catálogos › Telas… ahora es la última
opción del desplegable"*) era cierta **en una de las dos puertas**.

**Ya está en las dos, con el mismo patrón y el mismo permiso** (`compras.administrar`, sin cambio a lo
decidido el 25-ago): opción última y separada, precargada con el color y el pantone de la OP, y el
color recién creado **queda elegido**. No hay decisión nueva de negocio aquí — es la misma, aplicada
donde faltaba.

⭐ **Lo que sí se aprendió y vale para lo que sigue:** *cerrar una puerta no cierra su gemela.* Este
mismo texto ya se había corregido una vez (de *"ve a Catálogos › Telas"* a *"cierra este cuadro"*) y
seguía produciendo el estado prohibido, más cerca. El barrido por **estado** —no por función—
encontró además una **tercera** boca en el **almacén** (captura de entrada/traspaso/ajuste/salida de
tela por color) — y está en el **camino obligatorio** de recibir tela, porque desde §Post-F9.14 la tela
ya no se recibe desde la OC.

🔴 **Ahí se partió la deuda en dos, y la ronda de corrección enseñó por qué hay que partirla:** el
permiso que falta bloquea **construir el alta**, no **decir a dónde ir**. El letrero ya entró (esa
pantalla nombra ahora *Catálogos › Telas*); lo que espera es el alta.

⭐ **PREGUNTA ABIERTA PARA DANIEL:** **¿quién puede dar de alta un color de tela desde el ALMACÉN?**
Hoy el servidor exige `compras.administrar` para `agregarColorATela` y esas pantallas viven bajo
`inventario-telas.mover` → un almacenista se comería un **403**. Las opciones son un permiso propio
(`inventario-telas.administrar`) o reusar `compras.administrar` si quien recibe también compra. **No
se propone default**: es exactamente el tipo de decisión que §Post-F9.106 dejó en manos del dueño.
Anotada en `HOJA-DE-RUTA.md` §4.

---

#### (Post-F9.107) — LA PANTALLA DE AUTORIZAR OC: la decisión con el contexto AL LADO (DANIEL, 25-ago-2026)

> *"Vamos a tener que desarrollar una pantalla para las autorizaciones de las OC. Estaría muy padre
> poder ver en la misma pantalla **la OC de un lado y la receta del modelo del otro** (lo que ya está
> congelado en la OP), para poder ir revisando que efectivamente está comprando lo que se debe de
> comprar y que haga sentido. También está padre ver en alguna parte de la pantalla **el cuadrito de
> cantidades de las OP**. Todo esto para tener toda la info a la mano a la hora de autorizar las OC."*

### Qué la distingue de lo que ya hay

**No es una pantalla de captura: es una pantalla de DECISIÓN.** Autorizar una OC es el momento en que
el dinero se compromete con el proveedor, y hoy se hace **sin el contexto delante**: para saber si lo
que se compra tiene sentido hay que salir a la receta de la OP, y volver.

⚠️ **No se parte de cero:** ya existe `BandejaAutorizacionPagina.tsx`. Lo que falta no es el lugar, es
**poner el contexto al lado de la decisión**.

### Las tres piezas que pidió Daniel, y por qué cada una

| Pieza | Para qué sirve al autorizar |
|---|---|
| **La OC** | qué se está comprando, a quién, a qué precio |
| ⭐ **La receta CONGELADA de la OP** | contra qué se compara: *"¿esto es lo que la orden pide?"*. Congelada, no la del modelo — es la que manda (V1-E3d pieza B) |
| **El cuadro de cantidades de la OP** | la escala: *"¿esta cantidad hace sentido para estas piezas?"* |

*Las tres responden la misma pregunta desde tres ángulos, y hoy viven en tres pantallas distintas.*

### Lo que ya se sabe que hay que cuidar

- 🔴 **Comparar contra lo CONGELADO en la OP, nunca contra el modelo.** El modelo pudo cambiar después
  de crear la orden y **nada se jala solo** (`traerDelModelo` no pisa un renglón existente,
  `calcularDesalineacion` sólo compara consumo por prenda y precio). Enseñar el modelo aquí haría que
  el autorizador cotejara contra algo que la orden no va a producir.
- ⚠️ **Y la receta congelada puede traer defectos propios**: §Post-F9.105 (el cierre con la
  contradicción medida/consumo) vive justo ahí. Si esta pantalla enseña la receta, **debe arrastrar sus
  avisos** — autorizar contra un requerido inflado sin verlo sería el mismo defecto una capa más
  arriba.
- **Una OC puede surtir VARIAS OP** (§Post-F9.86). El lado derecho no es "la receta", son *las* recetas:
  hay que resolver cómo se enseñan sin volverlo ilegible.
- §Post-F9.101: una OC sin autorizar **no se imprime**. Esta pantalla es el paso anterior.

- **Aplica en:** etapa propia. **Prioridad PREGUNTADA a Daniel** — no está claro si la necesita para el
  arranque del jueves 27 (él sí autoriza OC desde el día uno, pero hoy lo hace sin el contexto y ha
  funcionado).

---

#### (Post-F9.108) — ⚠️ DUPLICADA: la nomenclatura YA estaba decidida (§Post-F9.34) y CONSTRUIDA

> 🔴 **ERROR DEL LEAD, 25-ago-2026.** Esta entrada se escribió como si la nomenclatura fuera un hueco
> nuevo. **No lo era.** Daniel lo dijo: *"ya te había mandado la nomenclatura de los modelos… ahí puedes
> ver qué dígito significa género y qué dígito significa tipo de producto"* — y tenía razón:
>
> - **§Post-F9.34** (12-ago-2026) ya la registra completa, con el documento **«Estructura de modelos FR
>   Moda», 03-03-2014**, que él mismo entregó. Ahí está el mapeo: **1er dígito = concepto/tipo de
>   prenda, 2º = género** (en `71`: `7` = Pantalón/Jogger/Leggings, `1` = Caballero).
> - **§Post-F9.46** (15-ago-2026) cerró tres cabos más.
> - Y **`backend/src/dominio/modelos/nomenclatura.ts` ESTÁ CONSTRUIDO** desde el 23-ago.
>
> **La lección, que es la que importa:** el lead registró como decisión nueva algo ya decidido **y ya
> implementado**, sin buscarlo primero. Le hizo repetir trabajo al dueño del negocio. *Antes de abrir
> una decisión nueva, se busca si ya existe — `DECISIONES.md` es largo precisamente porque el proyecto
> lleva meses.* Es la misma familia de error que las cuatro copias de una frase falsa: **no verificar
> contra lo que ya está escrito.**
>
> **Se conserva la entrada** (no se borra: D3, nada se tira) pero queda marcada como duplicada. **Manda
> §Post-F9.34 + §Post-F9.46.**
>
> 🔴 **LO ÚNICO VIVO DE AQUÍ — un CHOQUE que Daniel debe resolver:** el 25-ago dijo *"está bien que sea
> por año el reinicio del 001. O sea, **por cliente por año**"*, y eso **contradice lo registrado y
> construido**: §Post-F9.34 dice que el contador pertenece al **prefijo completo**
> (`CLIENTE-AÑO-CONCEPTO+GÉNERO`) y que *"el primer jogger de dama de ese mismo cliente y año es
> `CYA-26-72-001`, **no el `002`**"*, con la razón anotada de que los géneros no se hereden el
> consecutivo. **Preguntado a Daniel, sin respuesta.** Si confirma "por cliente+año", hay que cambiar
> `nomenclatura.ts`; si no, esta frase suya se descarta. **NO se toca el código hasta que él decida.**
>
> ---
>
> ## ✅ RESUELTO (25-ago-2026): **el consecutivo corre por CLIENTE + AÑO**
>
> > *"Me gusta solo por cliente por año. O sea **71-001 y el siguiente 72-002**."*
>
> 🔴 **Esto SUSTITUYE lo decidido en §Post-F9.34/§Post-F9.46 sobre el alcance del contador**, y **cambia
> código ya construido** (`nomenclatura.ts`). Se registra como cambio de criterio, **no** como si
> siempre hubiera sido así — la decisión de agosto se tomó con el documento de 2014 enfrente y merece
> quedar legible.
>
> | | Antes (agosto, construido) | Ahora (Daniel, 25-ago) |
> |---|---|---|
> | Alcance del contador | cliente + año + **concepto + género** | **cliente + año** |
> | 1er jogger caballero | `CYA-26-71-001` | `CYA-26-71-001` |
> | 1er jogger **dama** | `CYA-26-72-**001**` | `CYA-26-72-**002**` |
>
> ⇒ Los dos dígitos de concepto+género **siguen en el código** (describen la prenda) pero **ya no
> gobiernan la serie**.
>
> **Los 3 dígitos se quedan.** Daniel lo cerró con el argumento correcto y bajo ESTE esquema:
> *"es imposible que hagamos más de 999 modelos de un solo cliente en un año"*. ⚠️ El lead había
> recomendado un cuarto dígito **bajo un supuesto equivocado** (lo dijo pensando en el contador por
> cliente+año… que es justo el que se eligió, pero calculando mal el orden de magnitud). **Descartado
> con el argumento de Daniel, no con el del lead.**
>
> ⚠️ **PROSPECTIVO, sin renumerar.** Los códigos ya minteados con el criterio viejo **se quedan** —
> renumerarlos rompería lo que ya anda en correos, cotizaciones y listas de precios del cliente
> (§Post-F9.34 ya lo razonaba para el año). Van a convivir dos criterios, y **eso es correcto**.
>
> ⚠️ **El MOMENTO importa:** cada modelo de desarrollo que se cree antes del cambio nace con el criterio
> viejo. **Preguntado a Daniel:** si sigue creando modelos de desarrollo esta semana conviene cambiarlo
> ya; si no toca Desarrollo hasta después del arranque, va la semana entrante. **Sin respuesta.**
>
> **Lo que hay que tocar:** `backend/src/dominio/modelos/nomenclatura.ts` — la secuencia del consecutivo
> de desarrollo (`mintearCodigoDesarrollo` y su namespace de bloqueo) pasa a colgar de `cliente+año` en
> vez de `cliente+año+par`. Es una etapa chica **pero toca una secuencia atómica (A3)**: nada de
> `Max()+1`, y con su prueba de que dos altas simultáneas no repiten número.

---

#### (Post-F9.108) — NOMENCLATURA AUTOMÁTICA DE MODELOS, y el desarrollo empieza por el PROYECTO (DANIEL, 25-ago-2026) *(duplicada — ver aviso arriba)*

> *"Quiero tener una nomenclatura de modelos… 3 letras para el cliente, 2 números para el año, 2 números
> para definir tipo de producto y género, 3 números consecutivos, todo separado por un guion.
> **CYA-26-71-001**. Ese sería un jogger de caballeros de C&A. Y el consecutivo lo dé automático el
> sistema."*
>
> Y antes: *"Los modelos de desarrollo creo que estaría mejor que el sistema los dé en automático. Al
> hacer un proyecto… poner en una tablita el tipo de producto, el género y el cliente, y que
> automáticamente nos dé los números de modelo. **Creo que lo más práctico es empezar por un proyecto,
> no por un modelo.**"*

### El hueco (medido, 25-ago)

- 🔴 **No existe secuencia de modelos.** Hay `CLAVE_SECUENCIA_` para órdenes, pedidos, OC, **proyectos**,
  entradas de tela, notas, terceros, auditorías, etapas, partidas, recepciones y cíclicos — **para
  modelos NO**. La clave se teclea a mano, que es lo que produce claves duplicadas o con formato
  distinto para la misma clase de prenda.
- ✅ **El resto YA existe:** `Proyecto` (cliente + departamento + temporada + nombre, con su folio
  automático) y sus `Desarrollo[]`; y `Modelo` ya lleva **`idGenero`** y **`idTipoProducto`** contra los
  catálogos `Genero` y `TipoProducto`.

⇒ *Empezar por el proyecto no es un cambio de arquitectura: es lo que el modelo de datos ya dice. Lo
que falta es que la pantalla lleve por ahí.*

### Lo que se decide

1. **La clave la genera el SISTEMA**, con la forma `CLI-AA-TG-NNN` (`CYA-26-71-001`).
2. 🔴 **Los dos dígitos de tipo+género se DERIVAN** del `TipoProducto` y el `Genero` ya elegidos —
   **no se teclean**. Si se capturan a mano, tarde o temprano habrá dos joggers de caballero con
   códigos distintos, que es exactamente el defecto que esta decisión viene a cerrar. ⇒ Los catálogos
   `TipoProducto` y `Genero` necesitan **su dígito**.
3. 🔴 **El indicador de grupo NO va en la clave.** Daniel lo dudó por longitud; se rechaza por una razón
   más fuerte: **el PROYECTO ya es el grupo** y ya se puede filtrar por él. Y sobre todo, **la clave es
   permanente y el grupo es circunstancial**: si un modelo se reusa en otro proyecto la próxima
   temporada, la clave mentiría para siempre. *Un dato que puede cambiar no se mete en un
   identificador que no puede cambiar.*
4. ⚠️ **Prospectivo.** Los modelos ya cargados **conservan su clave**. NO se renombran en masa: romperían
   referencias vivas en órdenes, pedidos y compras. Se convive con dos formatos.

### ✅ CERRADO POR DANIEL (25-ago), con el mejor argumento posible

> *"Ya tenemos una nomenclatura de modelos **de producción**, donde vamos a ocupar los mismos dígitos
> para los modelos de desarrollo. Con esos 10 tenemos hasta ahorita bien. **No hemos necesitado de más
> en 30 años.** Creo que es suficiente."*
> *"El año creo que sería lo mejor el año de **desarrollo**, aunque el siguiente año se entregue uno con
> número 26. De esa manera somos muy claros cuando **nace** el modelo."*
> *"Y sí, cada año reinicia el 001, dado que el número del año cambia y con eso ya es un nuevo modelo."*

- **(a) Los 10 tipos ALCANZAN.** El lead advirtió que un dígito da sólo 10 tipos y que enumerando los
  suyos ya iban diez. Daniel lo cerró con **evidencia, no con estimación: 30 años sin necesitar más**.
  ⇒ La preocupación se retira. 1 dígito de tipo + 1 de género.
- **(b) El año es el de DESARROLLO** (nacimiento), confirmado como intencional: un modelo de 2026
  entregado en 2027 sigue diciendo `-26-`, *"para ser muy claros cuándo nace el modelo"*.
- **(c) El consecutivo REINICIA CADA AÑO.**
  ⚠️ **Queda un matiz por cerrar** (preguntado, sin respuesta): ¿reinicia por **cliente + año + tipo**
  (⇒ el primer jogger de caballero es `CYA-26-71-001` **y** el primer short de dama es `CYA-26-83-001`)
  o por **cliente + año** (⇒ el short sería `-002`, contando todos los modelos del cliente ese año)?
  Las dos son válidas; **se copia la que usen hoy en producción**.
  ⚠️ Técnico: con reinicio por combinación hacen falta **muchos contadores**, y la secuencia debe ser
  **atómica** (A3) — nada de `Max()+1`.

### ⭐⭐ EL DATO QUE CAMBIA CÓMO SE CONSTRUYE: la tabla YA EXISTE

Daniel: *"ya tenemos una nomenclatura de modelos **de producción**… vamos a ocupar los mismos dígitos"*.

⇒ **El mapeo dígito→tipo y dígito→género NO se inventa: se CAPTURA.** Hay una tabla viva en el negocio
desde hace décadas, y los modelos de desarrollo deben hablar **el mismo idioma** que los de producción
desde el día uno. Inventar un mapeo nuevo habría creado dos vocabularios para la misma prenda.

**Cómo conseguirla, en orden de preferencia:**
1. ⭐ **Deducirla de los modelos YA CARGADOS**: si las claves de producción ya llevan esos dígitos, el
   mapeo se extrae de los datos reales y Daniel **sólo confirma** — menos trabajo suyo y menos margen
   de error que dictarla.
2. Que la dicte él.

### Preguntas que siguen abiertas

- **(d) ¿Las 3 letras del cliente de dónde salen?** ¿Campo propio en el catálogo de Clientes (recomendado)
  o derivadas del nombre? Derivarlas choca el día que dos clientes empiecen igual.
- **(d) 3 dígitos = 999 por combinación.** Suficiente casi seguro; se dice para que sea a propósito.
- **(e) El año es el de NACIMIENTO** del modelo: uno desarrollado en diciembre de 2026 y vendido en 2027
  sigue diciendo `-26-`. Correcto, pero que no sorprenda.

- **Aplica en:** etapa propia del módulo de **Desarrollo**, **después del arranque** (no bloquea
  compras/inventarios/producción). Se planea en el ensayo del miércoles.
- **Fecha:** 2026-08-25.

---

#### (Post-F9.109) — FALTAN LAS COTIZACIONES: hay motor de cálculo, no hay documento (DANIEL, 25-ago-2026)

> *"Y nos falta desarrollar toda la parte de las cotizaciones (que nacen a partir de un precosteo, ¿no?)"*

**Sí, y tiene razón en las dos mitades.** Verificado en el esquema (25-ago):

| Existe | No existe |
|---|---|
| `Precosto` + `PrecostoLinea` (F8) | 🔴 **`Cotizacion`** — no hay modelo |
| `ListaPrecios` + `ListaPreciosLinea` (con los factores del cliente) | 🔴 el **documento** que se manda al cliente |

⇒ **Está el motor que calcula y falta el papel que sale**: la cotización como artefacto, con sus
**versiones** y el historial de *qué se le ofreció al cliente y cuándo*. F8 construyó precosteo →
lista de precios → aprobación → negociación por versiones; lo que no nació fue la cotización como
documento propio.

- **Aplica en:** etapa propia del módulo de **Desarrollo**, **después del arranque**. Se dimensiona en
  el ensayo del miércoles, junto con §Post-F9.108 (son la misma pantalla de entrada: el proyecto).

---

#### (Post-F9.110) — LA NEGOCIACIÓN EDITA LA RECETA EN VIVO, y de ahí vuelve al modelo — con una REVISIÓN de por medio (DANIEL, 25-ago-2026)

> *"En las cotizaciones, la idea es poder ir actualizando **en tiempo real la receta de los modelos**,
> porque ahí se va a gestar la negociación con el cliente **en vivo**. Entonces de alguna manera esa
> información va a afectar **de regreso** a la construcción del modelo. Por ejemplo, el cliente me pide
> una sudadera con cierre pero la quiere barata. Es posible que en la negociación lleguemos a que **si le
> quitamos el cierre** llegamos al precio que necesita. Entonces yo en la negociación le quiero poder
> eliminar el cierre. Ya cuando salga a producción, la receta va a cambiar. **Incluso el costo de
> maquila.** […] Quiero que quede **el registro de cómo fue construido el modelo y cómo fue cambiando con
> la necesidad del cliente**."*
>
> *"Y creo también que después de la negociación con el cliente, **debe de haber una revisión antes de
> mandar a producir**. Porque luego en la negociación enfrente del cliente puede ser que se cometa una
> imprudencia o un error."*

### ⭐ Lo que YA está construido (medido, 25-ago) — es más de lo que parecía

| Pieza | Estado |
|---|---|
| `Precosto` con **`version`**, `estado` y **congelado** (`congeladoEn`, `congeladoPorId`) | ✅ existe |
| `PrecostoLinea` por **`ConceptoCosto`**, con tela / avío / **conceptos abiertos** | ✅ existe ⇒ **la maquila cabe**, no sólo materiales |
| **`NegociacionEvento`** con `precostoAnterior` → `precostoNuevo` | ✅ existe ⇒ **el hilo de la negociación ya está modelado** |
| `Desarrollo` colgando de `Proyecto`, con `listaLineas` a `ListaPreciosLinea` | ✅ existe |

⇒ **No se empieza de cero.** Falta el *documento* de cotización (§Post-F9.109) y **la mecánica de esta
decisión**.

### 🔴 El principio de diseño (propuesto por el lead, pendiente de que Daniel lo confirme)

**La negociación NO edita el modelo. Edita la receta de ESA VERSIÓN del precosto.** Tres razones, y la
tercera es de Daniel:

1. **El modelo puede vivir en otros proyectos y otros clientes.** Editarlo en vivo le cambia la receta a
   todos.
2. **Se perdería el testimonio**: quedaría el estado final, no *cómo se llegó*. Y lo que Daniel pide es
   exactamente lo contrario.
3. 🔴 **«Frente al cliente se pueden cometer imprudencias»** — palabras suyas. Si la mesa escribe directo
   en el modelo, **la imprudencia ya está en producción antes de que nadie la revise**.

⇒ Se quita el cierre **en la versión N**, el precio se recalcula en vivo, y queda congelado como
*"versión N: sin cierre, a este precio"*. **El modelo no se mueve todavía.**

### ⭐⭐ La REVISIÓN que pide Daniel es la BISAGRA, no un trámite

Cuando la negociación cierra, alguien **revisa la versión aceptada y la PROMUEVE** a la receta del
modelo. Ése es el momento en que **una decisión de mesa se vuelve un compromiso de producción**, y debe
quedar **firmado, con fecha y con quién** (A7).

*Es el mismo patrón que ya gobierna la receta de la OP: se copia una vez, se congela, y nada se jala
solo (§Post-F9.34 y el detector de desalineación). Aquí la capa nueva es la de la NEGOCIACIÓN.*

### El registro histórico sale GRATIS

**La cadena de versiones ES la historia** de cómo el modelo cambió con las necesidades del cliente. No
hay que construir un historial aparte: `NegociacionEvento` ya encadena anterior → nueva.

### 🔴 Preguntas abiertas — hay que cerrarlas ANTES de construir

### ✅ (a) RESUELTA POR DANIEL (25-ago): **nace un modelo NUEVO, con SUFIJO de versión**

> *"¿Por qué no dejamos el mismo modelo, pero le adjuntamos un nuevo número? Al final le ponemos otro
> **-01** y así sabemos que heredamos el modelo xxx pero es la nueva versión. […] De esta manera creamos
> el nuevo modelo, que tendrá la nueva receta, y **el modelo original queda igual**."*

⇒ **`CYA-26-71-001-01`**. Resuelve las dos cosas a la vez:

- **El modelo original queda INTACTO** — lo ya producido con la receta vieja conserva su verdad.
- **El sufijo dice de dónde viene**, legible sin cruzar tablas ni abrir el historial.
- **No quema un consecutivo nuevo** (es sufijo, no número nuevo), y al ordenar, las versiones quedan
  juntas.

### 🔴 La regla que evita que el catálogo se llene de basura (propuesta del lead, aceptada como default)

**NO cada versión de la negociación se vuelve un modelo. Sólo la que se APRUEBA y de verdad CAMBIA la
receta.**

Si en la mesa se proponen cinco alternativas y el cliente acepta la tercera, **no nacen cinco modelos**:
nace **uno**, el `-01`. Las otras cuatro ya viven como **versiones del precosto** —que es donde deben
estar— y `NegociacionEvento` conserva el hilo completo.

⇒ Y si la negociación termina **sin cambiar la receta**, **no nace ningún modelo**: se produce el
original.

*Es el mismo criterio que gobierna el resto del sistema: el catálogo guarda lo que existe de verdad, no
cada cosa que alguien propuso.*

### Dos detalles fijados para que nadie los invente después

1. **Versión de una versión: PLANO, no anidado.** Si el `-01` se re-negocia y cambia, es **`-02`**, no
   `-01-01`. Con anidamiento, en tres temporadas hay `-01-02-01` y **nadie lo lee**.
2. **El sufijo vive en el mundo de DESARROLLO.** Al salir a producción, el modelo toma su número de
   producción como cualquier otro (§Post-F9.34): eso no cambia.

⚠️ **Por confirmar al construir:** ¿el `-01` hereda el mismo `Desarrollo`/proyecto o abre uno nuevo? ¿Y
qué pasa con la **lista de precios** del cliente, que apunta al padre?

---

- **(a) ~~Al promover, ¿se MODIFICA el modelo original o NACE UNO NUEVO?~~** ✅ RESUELTA arriba. Una sudadera **sin** cierre,
  ¿es el mismo modelo cambiado o es otro modelo? Tiene consecuencias en **la nomenclatura**
  (§Post-F9.34: ¿consume consecutivo?) y en el histórico de lo ya producido con la receta vieja.
### ✅ (b), (c) y (d) RESUELTAS POR DANIEL (25-ago)

**(b) ¿Quién revisa y aprueba?** → *"Los que tengan facultad para hacerlo… de entrada **Aurora podría
hacerlo aparte de mí**."* ⇒ **Es un PERMISO, no "sólo el dueño".**

🔴 **PERO OJO — hay una tensión con F8-E4 que hay que respetar:** ahí Daniel decidió que **aprobar
precios de lista es del DUEÑO** y a **Gerencial se le quitó `listas.aprobar` a propósito**
(`seed.ts`, decisión (h)). Aurora es Gerencial.

⇒ **Son DOS aprobaciones distintas y van con permisos SEPARADOS:**

| Aprobación | Qué compromete | Quién |
|---|---|---|
| **La RECETA** (esta decisión) | que el modelo quede técnicamente bien | Daniel **y Aurora** |
| **El PRECIO** (F8-E4, `listas.aprobar`) | lo que se le cobra al cliente | **sólo el dueño** |

*Si se juntaran por descuido, Aurora acabaría aprobando precios sin que nadie lo hubiera decidido.*
**Permiso nuevo para la receta; `listas.aprobar` NO se toca.**

**(c) ¿De dónde arranca la receta de la negociación?** — *la pregunta del lead estaba mal formulada* (habló
de "la última versión congelada" y Daniel entendió, con razón, la receta de la OP, que nace **después**).
Bien planteada: en la **tercera vuelta** —donde ya se quitó el cierre en la primera y se cambió la tela
en la segunda— ¿se arranca del modelo original o de donde quedó la segunda?

⇒ **La PRIMERA vuelta se copia del MODELO** (*"debería de arrancar del modelo"*, Daniel). **Cada vuelta
siguiente CONTINÚA la anterior** — si no, cada ronda habría que rehacer a mano todo lo ya acordado.

**(d) ¿Y si el modelo cambia mientras la negociación está viva?** → *"El modelo no cambia mientras la
negociación está viva, porque **en teoría el modelo está cerrado**. Si cambia, creo que sería el mismo
criterio que una negociación: pondría el 01, 02, etc. al final."*

⇒ **Mismo criterio, un solo mecanismo:** un cambio al modelo con una negociación viva **no lo edita en
sitio** — **mintea una versión con sufijo**, igual que la negociación. *No hacen falta dos maneras de
versionar un modelo.*

---
- **(c) ¿La receta de la negociación arranca copiada del modelo**, o de la última versión congelada?
- **(d) ¿Qué pasa si el modelo cambia MIENTRAS la negociación está viva?** (mismo problema que
  `calcularDesalineacion` resuelve entre modelo y OP).

### ⭐ EL FLUJO COMPLETO (aclarado con Daniel, 25-ago) — y la pieza que faltaba en su mapa

Daniel preguntó *"¿una vez terminado el precosteo pasa a cotización? ¿Ahí es donde voy a trabajar en vivo
las negociaciones?"*. **Faltaba un eslabón, y es uno que YA está construido: la LISTA DE PRECIOS.**

```
Proyecto → Desarrollo → Precosto (versionado, congelable)
                            ↓
                     🔑 Lista de precios      ← convierte COSTO en PRECIO con los factores
                        (por cliente+depto,      del cliente (margen, descuentos, regalías,
                         factores en snapshot)   costo de ventas). AQUÍ se aprueba el precio.
                            ↓
                        Negociación (versiones + NegociacionEvento)
                            ↓
                     🔴 COTIZACIÓN  ← NO EXISTE. El documento que se manda al cliente.
                            ↓
                        OC del cliente → Pedido → OP  (`DesarrolloOrden`, ya cableado)
```

**Dónde se negocia en vivo: en la LISTA, no en la cotización.** Ahí están el precio y los factores; ahí
se mueve la receta y se ve el precio recalcularse. **La cotización es el papel que sale de esa mesa, no
la mesa.** ⇒ Orden: **negociar en la lista → EMITIR la cotización de esa versión**, quedando amarrada a
la versión que la produjo, para poder contestar siempre *"¿qué le mandé al cliente el 12 de marzo, y con
qué receta?"*.

**El tramo final YA está cableado:** `DesarrolloOrden` liga la orden **al DESARROLLO** que la originó
—no al modelo suelto, que es lo correcto: arrastra toda la historia de la negociación— y `PedidoLinea`
también sale del desarrollo. *Lo que falta es el papel de en medio.*

### ✅ (e) UNA cotización con VARIOS modelos (Daniel, 25-ago)

> *"Es un documento con las 5 cotizaciones."*

⇒ **`Cotizacion` → N renglones**, uno por modelo, colgando de la **lista** (cliente + departamento) y no
de un `Desarrollo` suelto. **Encaja con la forma que el sistema ya tiene**: la lista ya es por
cliente+departamento con un renglón por desarrollo.

🔴 **Regla fijada, porque es fácil equivocarse:** si en la segunda vuelta sólo cambian 3 de los 5
modelos, **la cotización nueva lleva LOS CINCO**. El cliente la lee sola, sin la anterior al lado;
mandarle sólo el delta lo obligaría a reconstruir el paquete de memoria. *Una cotización dice lo que se
ofrece AHORA, completo.*

### El correo: en DOS tiempos, no en uno

Daniel: *"eventualmente voy a querer que el sistema mande la cotización por correo al cliente"*.
Factible, **pero necesita el documento primero**. ⇒ Primero la **cotización** (verla, imprimirla,
descargarla), después el **envío** con su historial. *Si se hacen juntos y el correo falla, no se sabe si
falló el papel o el envío.*

- **Aplica en:** módulo de **Desarrollo**, **después del arranque**. 🔴 **NO se toca antes del jueves:**
  no bloquea compras/inventarios/producción, y meterlo con prisa sería justo el error que la revisión
  que Daniel pide viene a evitar. Se dimensiona en el ensayo del miércoles, junto con §Post-F9.108
  (nomenclatura) y §Post-F9.109 (el documento de cotización) — **las tres son la misma pantalla de
  entrada: el proyecto**.
- **Fecha:** 2026-08-25.

---

#### (Post-F9.111) — AL ÚLTIMO ADMINISTRADOR VIVO NO SE LE BLOQUEA LA CUENTA POR INTENTOS FALLIDOS ⚠️ (25-ago-2026 — **PENDIENTE DE RATIFICAR POR DANIEL**)

**No es una decisión suya todavía.** Nació al cerrar la **quinta puerta** del guard anti-lockout (V1-E6c) y **se le preguntó**; se registra para que la ratifique o la rechace **con la información completa**, no para darla por hecha.

### Qué cambia

Hoy, cinco intentos fallidos bloquean una cuenta. **Con el cambio, al ÚLTIMO administrador activo NO se le bloquea**: se le suben los `intentosFallidos` pero no la bandera, y queda constancia en bitácora. **La excepción desaparece en cuanto hay un segundo administrador.**

### Por qué (y el reviewer de seguridad coincide)

🔴 **Sin esto, el sistema se auto-inutiliza:** Daniel es el único admin; teclea mal cinco veces; **Aurora (Gerencial) no puede desbloquearlo**; **re-correr el seed tampoco rescata** (`sembrarAdmin` hace `upsert` con `update: {}`). Sistema cerrado por dentro, recuperable **sólo entrando a la base a mano**.

Y el bloqueo por intentos **nunca fue una defensa contra fuerza bruta**: es un **vector de denegación de servicio** — *cualquiera que sepa un username congela a su dueño sin saber su contraseña*. La guía moderna prefiere estrangular a bloquear.

**No abre ningún vector nuevo:** no acerca al atacante a la contraseña, no otorga permisos, y **no se puede disparar CONTRA un tercero para desprotegerlo** (crear la condición *"último admin"* ya exige `usuarios.administrar`).

### ⚠️ El compensatorio es MÁS DÉBIL de lo que el PR decía — corregido aquí

El PR afirmaba que *"el rate-limit es la defensa real"*. **Medido:** `AUTH_LOGIN_RATE_MAX` = **20 intentos / 60 s POR IP** (`auth/config.ts:43-50`). Eso son **~28,800 intentos al día desde una sola IP**, y más desde varias.

El propio comentario de ese archivo describe las dos capas como **complementarias**: la per-IP corta el barrido sobre muchos usuarios; la per-usuario protegía **una cuenta concreta**. Esta etapa retira la segunda **para exactamente una cuenta**. ⇒ **Es un cambio real de exposición, no cero.**

### 🔴🔴 PRERREQUISITO — deja de ser aseo y pasa a ser BLOQUEANTE DEL JUEVES

**La contraseña del `admin` sembrado está ESCRITA EN EL REPOSITORIO** (`prisma/seed.ts:1019`, `PASSWORD_TEMPORAL_ADMIN = 'Control.2026!'`, y repetida en varios `*.int.test.ts`). Y `CLAUDE.md` **todavía la lista como pendiente manual de Gabriel**.

⇒ **Una cuenta con intentos ilimitados y contraseña pública documentada es el vector concreto.** Cambiarla **antes del arranque** deja de ser limpieza: **es el prerrequisito de esta decisión**. Lo mismo para la contraseña de Daniel, que debe ser larga.

### Dos cosas para DESPUÉS del arranque (no se hacen hoy)

1. **Devolverle la señal que el bloqueo le quitaba:** al siguiente acceso exitoso, decir *"hubo N intentos fallidos desde tu última entrada"*. El dato **ya se guarda** (`intentosFallidos`) y la bitácora ya registra el evento — **nadie los mira**.
2. **Bajar `AUTH_LOGIN_RATE_MAX` en producción**: es ajustable por variable de entorno, sin tocar código, y es el endurecimiento más barato ahora que ésta es la única capa para esa cuenta.

- **Aplica en:** V1-E6c (ya construido). ⚠️ **Si Daniel la rechaza**, hay que revertir el guard de `login.ts` **y aceptar el escenario del auto-bloqueo** — o construir otra salida (p. ej. que Gerencial pueda desbloquear).
- **Fecha:** 2026-08-25.

---

#### (Post-F9.114) — LAS CINCO REGLAS DEL DOCUMENTO DE COTIZACIÓN (LEAD, 25-ago-2026 — ⚠️ **DANIEL PUEDE OBJETARLAS**)

**Por qué está aquí.** §Post-F9.109 registró lo que **Daniel** pidió (una cotización con N modelos,
colgando de la lista, el correo después). Al construirlo (V1-E7c) hicieron falta **cinco reglas más**
que él no dictó. El reviewer independiente marcó —con razón— que vivían sólo en la ficha del track de
desarrollo: *"hoy Daniel sólo puede objetarla si lee un archivo del track"*. **Una decisión que el dueño
no puede encontrar no está tomada, está escondida.** Por eso se registran aquí.

**(a) La cotización es INMUTABLE.** Nace ya emitida —es la foto de un momento— y **no se edita jamás**:
no hay `PUT` ni `PATCH`, a propósito. Otra vuelta = **otra cotización**. Se **cancela con motivo**,
auditado, y la cancelada **se sigue imprimiendo** con su banda. *Un papel que ya salió no se corrige
borrándolo: se corrige con otro papel.* (D3.)

**(b) Cada renglón CONGELA VALORES, no punteros:** código del modelo, descripción, el número del
cliente, la versión del precosto y el precio, **copiados**. La lista sigue moviéndose después de emitir;
con sólo referencias, **reimprimir la de marzo enseñaría los precios de mayo**. Es lo que permite
contestar *"esto fue exactamente lo que le mandé"*.

**(c) Folio por secuencia atómica** (A3), nunca `Max()+1`. Y el guard va **antes** del folio: un rechazo
**no quema un folio**.

**(d) 🔴 NO se emite con un precio SIN APROBAR** — se rechaza **nombrando cuáles** faltan.
⚖️ *Mandarle al cliente un precio que el dueño no aprobó es el compromiso que nadie firmó*, y Daniel fue
explícito en F8-E4: *"el precio lo apruebo solo yo"*.
⚠️ **Ésta es la que más probable que él quiera ajustar**: si alguna vez quiere mandar una **preliminar**,
es un freno. Se quita retirando `exigirRenglonesAprobados` y caen 4 pruebas que lo dicen por su nombre.

**(e) Sin permiso nuevo.** Emitir usa **`listas.negociar`** (quien está en la mesa); ver usa
`listas.ver`. ⇒ el deploy **no requiere `SEED_ON_START`**.

- **Aplica en:** V1-E7c (construida). **Fecha:** 2026-08-25.

---

#### (Post-F9.115) — EL DOCUMENTO TIENE QUE SER AUTOSUFICIENTE (LEAD + reviewer, 25-ago-2026)

**Cómo salió, y por qué vale registrarlo.** La primera versión de V1-E7c dejó dos pegas declaradas como
**cosas distintas**: (1) las FK con `RESTRICT` dejaban **amarrado** lo ya cotizado —un renglón cotizado no
se podía quitar de la lista **ni con la cotización cancelada**—, y (2) el **encabezado no se congelaba**
(el nombre del cliente se leía por FK, así que un renombre reescribía el papel viejo).

🔴 **El reviewer midió que eran EL MISMO defecto**, y ahí está la lección:

> El documento **no era autosuficiente** ⇒ para imprimirse tenía que preguntarle a la lista ⇒ había que
> **blindar el puntero** ⇒ y blindar el puntero es lo que dejaba el renglón atrapado.

**Y era el mismo atrapamiento que arregló V1-E4**, no uno parecido: aquél no era "queda atrapado" sino
**"para siempre"**, por el `@@unique([idDesarrollo])` de `ListaPreciosLinea` — **que sigue vivo**.

**Lo que se decide, y sirve para TODO documento futuro:**

- **Un documento que sale a un tercero se congela ENTERO** —encabezado incluido—, no sólo sus renglones.
  El precedente ya estaba en el propio módulo: `ListaPrecios` **ya guardaba** los factores del cliente
  como snapshot en vez de apuntarlos.
- **Las FK de PROCEDENCIA van a `SetNull`, no a `RESTRICT`.** `RESTRICT` **no protege el papel** —su
  contenido está en sus propias columnas y nadie lo toca—: protege **el puntero**, y para eso **prohíbe
  una operación de otro agregado que el sistema construyó a propósito**. La procedencia ya está a salvo
  en la bitácora.
- ⇒ **D3 queda igual de satisfecho** (no se edita ni se borra nada del documento) **y V1-E4 deja de
  estar revertido**.

⭐ **Y el argumento del coder que cierra el caso**, sobre dejar una FK en `RESTRICT` "porque hoy no
existe ningún camino que borre eso": *sostener una decisión en «hoy no existe el camino» es la forma
exacta de argumento que este proyecto tiene prohibida.* Los caminos se construyen después, y entonces
nadie recuerda por qué el candado estaba ahí.

**Momento:** se hizo **con las tablas vacías**, sin backfill. *Es el momento más barato que iba a
existir* — un mes después habría sido una migración de datos.

- **Aplica en:** V1-E7c, y como criterio para todo documento nuevo. **Fecha:** 2026-08-25.

---

#### (Post-F9.116) — ⭐ LA APROBACIÓN SE CAE SI LA RECETA CAMBIA: una firma que no está amarrada a lo que se firmó no es una firma (DANIEL, 25-ago-2026)

**Cómo salió.** No lo reportó Daniel: lo **declaró el coder de V1-E7d** al cerrar su etapa, como hueco
conocido de lo que acababa de construir. Aurora revisa la versión y la **aprueba**. Después alguien le
cambia el consumo de una tela, o le mueve el arte. Y la orden de producción sale **con la aprobación
vieja**, sobre una receta que ya no es la que ella miró.

⚖️ **Es exactamente el problema que la revisión viene a evitar, entrando por otra puerta** — y peor,
porque el sistema la presenta como revisada. *Una firma que no está amarrada a lo que se firmó no es una
firma: es un adorno.*

**Respuesta de Daniel:** *"Sí, ciérralo."*

Y con una condición que fijó el alcance de toda la etapa:

> *"Cubrir sólo una parte sería **PEOR** que no cubrir nada: parecería resuelto sin estarlo."*

**Lo que se decide:**

- **(a)** **Cualquier cambio a la receta de una versión APROBADA la devuelve a `pendiente`**, con una
  nota que dice **qué la invalidó y cuándo**, más de cuándo era la firma que tumbó (A7).
- **(b)** **La firma vieja NO se borra** (D3): vive en la bitácora con quién la aprobó y cuándo, así que
  el sistema puede contestar *"Aurora la aprobó el 12, se le cambió la tela el 14, y volvió a firmarse
  el 15"*.
- **(c)** **Se vuelve a firmar normalmente**, con el mismo permiso. **No hay estado muerto**: nada queda
  atrapado sin salida.
- **(d)** **TODAS las puertas o ninguna** — la condición de Daniel. Cubrir cuatro de seis habría dejado
  un sistema que **dice** que la firma está viva.

🔴 **Y el barrido encontró SEIS puertas, no las cuatro que el lead había listado.** Las dos que se le
escaparon: **los avíos favoritos** (un botón que mete avíos **directo al BOM**, saltándose la pantalla
normal) y **las fotos del arte** — y ésta importa, porque *la imagen ES lo que el bordador va a hacer*:
cambiarla cambia el producto.

⭐ **Cómo se cerró, y esto vale más que la etapa:** había **tres copias** de la función que "toca" el
modelo, y cada mutación llamaba a la suya. **El embudo ya existía: sólo estaba triplicado.** Se
unificaron en una sola con el **tipo de cambio como parámetro OBLIGATORIO**, de modo que **una puerta
nueva no compila hasta que declara qué toca**. Deja de depender de que alguien se acuerde.

⚠️ **La red tiene dos límites, y quedan dichos** (los encontró el reviewer, no se descubrieron después):
el guardián trabaja **por archivo, no por función**, y mira las dos formas de escribir —directa y
anidada por relación— en **`src/` y `migracion/`**. Los cargadores del ETL quedan como **excepción
declarada** (cargan modelos migrados, que nunca tuvieron firma). *Es una red, no un teorema.*

- **Aplica en:** V1-E7e. **Fecha:** 2026-08-25.

---

#### (Post-F9.117) — ⚠️ NÚMERO NO USADO

Se pronunció en el chat al numerar la tanda del 25-ago y **nunca llegó a ser una entrada**. Se deja
asentado para que quien siga una referencia no crea que se perdió algo: **no hay decisión 117**. Lo
mismo con la **121**. *(Es la tercera cicatriz de numeración de este track — ver el aviso de la 108
duplicada y el de la 123.)*

---

#### (Post-F9.118) — LO QUE ENTRA Y LO QUE NO ENTRA A LA PRIMERA VERSIÓN DE PRODUCCIÓN (DANIEL, 25-ago-2026)

> ✅ **RATIFICADA (28-ago-2026): el punto (b) se le volvió a preguntar y contestó lo mismo —
> «Arrancamos sin ella».** La **Ruta Crítica NO entra el día uno**: está construida completa (F5, siete
> etapas) pero **nunca se ha usado en vivo**, y se enciende después del arranque, con calma. No hay
> decisión nueva que registrar: **se anota aquí para que quede claro que no es un olvido, sino la
> misma decisión sostenida**. Su consecuencia —que todo lo que dependía de la RC para tener fechas se
> pueda capturar a mano— sigue igual de vigente.


**Cómo salió.** Daniel, de corrido, contestando qué hacía falta decidir para arrancar:

> *"Las órdenes de compra quedamos que en producción **empezamos en 10000**. / **La ruta crítica
> después. Arrancamos sin ella**. / **Cargamos los saldos con las facturas que están vivas.** No es
> mucho tema. Son 3 o 4 clientes."*

**(a) El folio de las órdenes de compra arranca en 10000.** Y cuando el lead le preguntó si no
chocaría con la numeración del sistema viejo:

> *"Vamos a empezar con el 10000. **No choca. Yo sé en qué va el otro.** No te preocupes. **Déjalo como
> una regla.** Ya te había dicho. **Ya deja de preocuparte por cosas que ya están resueltas.**"*

⇒ Es una **regla del arranque**, no una configuración: el consecutivo de OC se siembra en 10000 al
poner producción. 🔴 **Es IRREVERSIBLE** (los folios no se re-numeran) y **hoy no existe herramienta
para sembrarlo**: hay que construirla antes del go-live, o quedará en 1.

**(b) La Ruta Crítica NO entra a la primera versión.** *"Arrancamos sin ella."* El módulo está
construido (F5, siete etapas) pero **no se enciende**: se prende después, con calma. ⇒ Lo que hoy
depende de la RC para tener fechas **tiene que poder capturarse a mano**, y eso no es un parche: **es
lo correcto mientras la RC esté apagada**.

**(c) Los saldos de apertura se cargan con las facturas VIVAS**, no con el histórico completo. *"Son 3
o 4 clientes."* ⇒ El ETL de apertura de F9 **no necesita el corte completo de SINUBE para arrancar**:
necesita las facturas abiertas. Sigue esperando que Daniel las entregue.

- **Aplica en:** (a) el go-live · (b) todo el track V1 · (c) el ETL de apertura de F9.
- **Fecha:** 2026-08-25.

---

#### (Post-F9.121) — ⚠️ NÚMERO NO USADO

Ver el aviso de la **117**: se pronunció al numerar y nunca llegó a ser entrada. **No hay decisión 121.**

#### (Post-F9.112) — LA ABREVIATURA DEL CLIENTE SON 3 LETRAS, SIEMPRE (DANIEL, 25-ago-2026)

**Cómo salió.** Daniel, sobre la nomenclatura de desarrollo:

> *"Acuérdate que el número de modelo de desarrollo se genera en automático. Hay que ponerle **3 letras
> identificadoras del cliente** dentro del catálogo de clientes para usar **siempre el mismo
> identificador**, ¿no?"*

**Ya existía, y él tenía razón en pedirlo:** `Cliente.abreviatura` (`schema.prisma`) es el `CYA` de
`CYA-26-71-001`, es **única entre clientes** (así que dos clientes no se pelean el mismo identificador)
y sin ella el minteo **no adivina**: lanza un error que dice qué capturar y dónde
(`nomenclatura.ts:406-410`). Eso último importa más de lo que parece — derivar las letras del nombre
automáticamente acabaría con dos clientes distintos compitiendo por las mismas tres sin que nadie lo
hubiera decidido.

**Lo que NO coincidía con lo que él pidió:** el Zod aceptaba **2 a 6 caracteres y admitía DÍGITOS**
(`contrato/esquemas/cliente.ts:113-119` y un segundo bloque en `:248`). O sea `CY`, `MARILY` y `CY2`
eran todos legales.

⚖️ **Por qué la longitud fija no es capricho:** con longitud variable el código deja de alinearse
(`CYA-26-71-001` contra `MARILY-26-71-001`) y se pierde justo lo que hace útil una nomenclatura —
poder leerla en columna y ordenarla. Daniel especificó **3 letras** las dos veces que tocó el tema.

**Lo que se decide:**

- **(a)** La abreviatura son **EXACTAMENTE 3 letras A–Z**. Sin dígitos, sin 2, sin 6.
- **(b)** 🔴 **PROSPECTIVO.** La regla aplica **al capturar o corregir**. **NO puede romper la LECTURA**
  de clientes ya capturados con otra longitud: si el apretón tocara el esquema de RESPUESTA, un cliente
  viejo de 2 letras **reventaría al listarse** y se caería el catálogo entero. Se aprieta la entrada; la
  salida se deja tolerante.
- **(c)** No se pudo medir cuántos clientes hay hoy fuera de norma (no hay BD local y Docker está
  prohibido). Se descubre en uso: al guardar un cliente viejo, el sistema lo rechaza y se corrige en
  ese momento.
- **(d)** Se conserva lo que ya estaba decidido y sigue vigente: **cambiar la abreviatura NO renumera
  los códigos ya emitidos** — quedaron congelados, porque ese código ya vive en órdenes, en papeles y
  en la cabeza de la gente.

- **Aplica en:** V1-E7b (mismo commit que el sufijo de versión, es el mismo territorio).
- **Fecha:** 2026-08-25.

---

#### (Post-F9.113) — UN SOLO PRECIO PARA TODAS LAS MEDIDAS DEL AVÍO (DANIEL, 25-ago-2026)

**La pregunta.** Al medir §Post-F9.100 (que la medida del avío viaje a la orden de compra) apareció un
cabo que la decisión original no contemplaba: cada `AvioMedida` tiene **precio propio** en el catálogo
(`schema.prisma:2028`) — el cierre de 53 cm puede costar distinto que el de 56 —, pero el renglón de la
orden de compra lleva **un solo `precio`**. Al desglosar el papel («120 piezas de 53 cm, 80 de 56 cm»),
¿el precio también se desglosa?

Se le planteó a Daniel como decisión de negocio, no de ingeniería, porque **desglosar cantidades sin
desglosar precios deja el detalle a medias** y ése es justo el documento que genera discusión con el
proveedor.

**Su respuesta:**

> *"Un solo precio para todas las medidas."*

⇒ **El renglón de la OC conserva UN precio.** El desglose por medida es **de cantidades**, para que el
proveedor sepa qué mandar. El importe sigue siendo `cantidad × precio` y **cuadra sin excepciones**.

**Lo que esto simplifica, y no es poco:**

- La **consolidación** de §Post-F9.102 sigue metiendo `precio` en su clave de agrupación sin conflicto:
  dos órdenes del mismo avío al mismo precio se funden aunque lleven medidas distintas.
- No hay que tocar `OrdenCompraLinea.precio` ni el cálculo de importes.
- El `precio` del catálogo por medida **no se contradice**: sigue sirviendo para el **precosteo**, que
  es donde se usa. Lo que se decide aquí es sólo qué se le imprime al proveedor.

⚠️ **Lo que queda dicho para que nadie lo descubra después:** si algún día un proveedor cobra de verdad
distinto por medida, esta decisión hay que revisitarla — el renglón tendría que partirse en uno por
medida, no llevar precios múltiples. **Partir el renglón es la salida natural**, y no requiere cambiar
el modelo de datos. Se anota aquí para no re-descubrirlo.

- **Aplica en:** la etapa de §Post-F9.100 (la medida en la OC), aún sin construir.
- **Fecha:** 2026-08-25.

---

#### (Post-F9.119) — NO SE VERSIONA UN MODELO DESCONTINUADO: HAY QUE REACTIVARLO PRIMERO (DANIEL, 25-ago-2026)

**Cómo salió.** El reviewer de V1-E7b lo levantó como **observación, no como defecto**: versionar un
modelo descontinuado estaba **permitido**, mientras que el vecino más cercano —`crearDesarrollo`— sí lo
bloquea (*"está descontinuado; no se puede desarrollar"*). **Dos puertas con reglas distintas para el
mismo hecho.** No rompía ninguna invariante y podía ser deliberado (revivir con receta nueva es un caso
de negocio real), pero **nadie lo había decidido**.

**Qué significa «descontinuado», medido antes de preguntar** (para que la decisión se tomara sobre
hechos y no sobre una idea):

- Es una **decisión manual y explícita**: una casilla en la ficha del modelo. **Nada lo hace solo** — ni
  por antigüedad, ni por falta de ventas, ni porque el cliente se fue.
- Es **reversible**: se reactiva con la operación inversa. **No se borra nada** (D3): el modelo conserva
  su historia, sus órdenes y su receta.
- Hoy ya implica tres cosas: desaparece de las listas por omisión (se ve marcando *"incluir
  descontinuados"*), **no se le puede abrir un desarrollo nuevo**, y si alguien intenta dar de alta otro
  modelo con ese código, el sistema **ofrece reactivarlo** en vez de dejar crear un duplicado.

**Respuesta de Daniel:** *"Sí. Está bien. **Hay que activarlo para poder usarlo nuevamente**."*

**Lo que se decide:**

- **(a)** **Versionar un modelo descontinuado se RECHAZA**, con un mensaje que diga qué hacer:
  reactivarlo primero.
- **(b)** El criterio queda **consistente en las dos puertas**: si descontinuar es un acto deliberado,
  ni se desarrolla ni se versiona sin deshacerlo antes. **Reactivar sigue siendo trivial**, así que no
  se pierde el caso de negocio de revivir un modelo — sólo se vuelve **explícito**.

⚖️ *El valor no está en impedir el versionado: está en que revivir un modelo sea un acto que alguien
decide, y no un efecto lateral de otra operación.*

- **Aplica en:** V1-E7e (añadido acotado; es el mismo territorio de `modelos/versiones.ts`).
- **Fecha:** 2026-08-25.

---

#### (Post-F9.123) — ⭐ AURORA ADMINISTRA MODELOS: un modelo NO es un catálogo como los demás (DANIEL, 26-ago-2026)

> ✅ **CERRADA LA NOTA QUE ESTA ENTRADA DEJÓ LEVANTADA (28-ago-2026).** Abajo queda anotado —y
> explícitamente NO resuelto por iniciativa propia— que la columna **«costo actual»** del listado de
> modelos enseña un **costo REAL de producción** y que Gerencial la ve por `consultas.ver-importes`,
> rozando el *«tampoco costos finales reales»* de Daniel. Se le preguntó y contestó **«Escóndesela»**
> ⇒ **§Post-F9.137** — **decisión cerrada y ✅ CONSTRUIDA** (V1-E8l, 28-ago-2026, versión 0.049):
> **ya no se ve.** El candado pasó a `costos.ver` + `consultas.ver-importes`, así que **a Gerencial no
> se le quitó ningún permiso** y su precosteo quedó intacto (el porqué, medido, está en §Post-F9.137).
> Lo demás de esta entrada (que `modelos.administrar` se corte en Ventas) **no cambia**.


**Cómo salió.** Daniel: *"Me comenta Aurora que no puede meter un nuevo modelo. Ella lleva toda la parte
de desarrollo, así es que debería de poder ver todo eso."*

**La causa, medida:** `modelos.administrar` se corta en **Directivo** hacia abajo, junto con telas, avíos,
colores, tallas y clientes, bajo la regla *"administrar catálogos es de Administración/Dirección"*.
Aurora es **Gerencial** ⇒ no lo tenía.

🔴 **El error de fondo: un modelo NO es un catálogo como los demás.** Una tela o un color son **datos
maestros** que se dan de alta una vez y casi no cambian. **Un modelo es el TRABAJO DIARIO de Desarrollo**
—se crea, se le mueve la receta, se le cambia el arte, se versiona—. Meterlo en el mismo saco que *"el
catálogo de colores"* dejó **a quien lleva Desarrollo sin poder desarrollar**.

⚠️ Y el sistema ya lo contradecía: Gerencial **sí** tenía todo `desarrollo.*` y todo `listas.*` —proyectos,
precosteo, negociar—. Le faltaba **la pieza sin la cual nada de eso arranca**.

### Cómo se trabaja HOY, en palabras de Daniel

> *"Ella hace todo el desarrollo con el equipo de desarrollo… arma un excel con todos los costos. Me los
> pasa, yo reviso y le doy el precio de venta que ella arma en una cotización y manda al cliente."*
>
> *"Solo yo defino los precios de los clientes… ella no los define, pero sí los ve."*
>
> *"Solamente no quiero que vea al final los estados de resultados… **Tampoco costos finales reales**. O
> sea tiene que ver todo en la parte de desarrollo **pero no cómo terminamos**."*

### ⭐ La línea que trazó, y que resultó estar YA construida

**Ve EL PLAN (lo que va a costar), no EL RESULTADO (cómo terminamos).** Se midió permiso por permiso y el
corte ya caía exactamente ahí:

| Permiso | Qué gobierna | ¿Gerencial? |
|---|---|---|
| `precostos.consultar` | **El PLAN**: el precosteo | ✅ ya lo tenía |
| `consultas.ver-importes` | Los importes de **Costos/Márgenes** (costeo de orden, márgenes, lista de costos) **y los del PRE-COSTEO** (`calcularPreCosto`/`listaPrecios` — por eso NO se le puede quitar sin apagarle el precosteo, §Post-F9.137). En el módulo de Modelos su único efecto era la columna **«costo actual»** del listado, que **desde §Post-F9.137 pide ADEMÁS `costos.ver`** | ✅ ya lo tenía |
| `costos.ver` / `.capturar` | **El RESULTADO**: costo real de la orden, costo real desde compras, márgenes | ❌ correcto |
| `ordenes.ver-costos` | El botón de costos de la orden ya producida | ❌ correcto |
| `edr.ver` / `.capturar` | Estado de resultados | ❌ correcto |
| `listas.aprobar` | **El precio de venta** | ❌ correcto — *"solo yo defino los precios"* |
| `listas.negociar` | Armar y **mandar** la cotización | ✅ ya lo tenía |

⇒ **Faltaba UN permiso, no un rediseño.** Se verificó además lo que más preocupaba —que Aurora no quede
**desarrollando a ciegas**— y el resultado, medido, fue todavía más simple de lo que se creía:

🔵 **La receta NO tiene candado de importes en absoluto.** `obtenerFichaModelo`, `listarTelasBom` y
`listarAviosBom` (`backend/src/dominio/modelos/bom-modelo.ts`) exigen **sólo `modelos.ver`**, y los
precios de telas y avíos viajan en su salida **sin permiso adicional**. O sea que la receta ya se veía
completa antes de este cambio, y `consultas.ver-importes` **no es lo que la destapa** (ese permiso
gobierna los importes de Costos/Márgenes). Su único uso dentro del módulo de Modelos era
`adjuntarAgregadosListado` (`backend/src/dominio/modelos/modelos.ts`).

⚠️ **Nota levantada con Daniel (preexistente — este cambio NO la introduce).** Ese único uso,
`adjuntarAgregadosListado`, alimenta `costoActual`: el **costo UNITARIO del ÚLTIMO costeo (F7) de una
orden del modelo**, pintado como **columna del listado de modelos**
(`frontend/src/modulos/modelos/ModelosPagina.tsx`, en sus dos pintados: tabla de escritorio y tarjeta de
móvil). Eso es un
**costo REAL de producción**, no del plan, y Gerencial **lo veía cuando se escribió esto** —ya desde
antes de §Post-F9.123, porque `consultas.ver-importes` siempre estuvo en su conjunto—. **Ya NO** (véase
§Post-F9.137, construida el 28-ago-2026). Roza el *"tampoco costos finales reales"*
de Daniel, así que **queda anotado y levantado con él**. **NO se cambia por iniciativa propia:** mover ese
permiso es decisión suya, y afecta también a Costos y Márgenes.

> ✅ **RESUELTA LA DECISIÓN (28-ago-2026): «Escóndesela»** — y ✅ **CONSTRUIDA en V1-E8l** (28-ago-2026,
> versión **0.049**): **Gerencial ya NO la ve.** Daniel decidió esconder esa columna y **bloquear el dato
> en el servidor**, y así quedó: sin permiso la columna no se pinta **y** el servidor ni siquiera
> consulta el costo.
>
> ⚠️ **El mecanismo salió DISTINTO del que esta nota daba por hecho.** Aquí se asumía que bastaba con
> mover a Aurora fuera de `consultas.ver-importes` *«que afecta también a Costos y Márgenes»*. Medido,
> ese permiso gobierna **además el PRE-COSTEO** (`calcularPreCosto`/`listaPrecios`), justo lo que Daniel
> dijo que ella SÍ debe ver ⇒ **no se le quitó ningún permiso**: el candado se colgó de `costos.ver` +
> `consultas.ver-importes` (`puedeVerCostoRealDeModelo`), y **el seed no se tocó**. El detalle, y el
> riesgo que Daniel aceptó, en **§Post-F9.137**.

**Lo que se decide:** **`modelos.administrar` cambia de escalón: se corta en VENTAS, no en Directivo.**
Sale de la resta de `directivo` y entra en la de `ventas` (`seed.ts`). ⇒ Lo tienen **Administrador,
AdministracionDireccion, Directivo y Gerencial**; **Ventas, Logística, Asistente y Secretarial NO**. Es el
mismo escalón donde ya se cortaba `modelos.aprobar-receta` (§Post-F9.110), y por la misma razón:
administrar y aprobar la receta son trabajo de **Desarrollo**.

🔴 **Por qué se mueve el CORTE y no se le "añade" el permiso a Gerencial.** La cascada del seed es
*"menor nivel ⊃ mayor nivel"* (`sin()`): cada rol es el anterior **menos** lo que pierde. Devolvérselo a
Gerencial con un `.concat` sobre `sin(directivo, …)` —como se intentó primero— **lo colaba ADEMÁS a
Ventas, Logística, Asistente y Secretarial**, que derivan de Gerencial, y encima **invertía la cascada**:
Directivo (nivel 30) se quedaba sin él y Secretarial (nivel 60) con él. Es la **misma fuga** que ya se
había corregido en `rc.catalogo-administrar` (*"antes se colaba a roles clericales"*). Lo cazó el reviewer
**ejecutando `definirRoles()`**, no leyéndolo, y ahora queda fijado por una prueba de **ALCANCE** en
`roles-reparto.test.ts` que nombra rol por rol dónde termina el permiso.

### La prueba que lo afirmaba al revés, INVERTIDA y no borrada

`roles-reparto.test.ts` tenía *"⭐ aprobar la receta NO arrastra administrar el catálogo (Aurora no
administra modelos)"*. **Era cierta bajo la regla de entonces.** Se invierte con su rastro escrito dentro
—por qué el sistema llegó a ese estado— y se **añade una gemela** que fija la línea nueva: administrar
modelos **no le abre** costos reales ni EDR, y el precio sigue siendo del dueño.

Y se añaden **dos pruebas de ALCANCE** —las que faltaban, y las que habrían matado la fuga del `.concat`
en el sitio—: que `modelos.administrar` **no baja de Gerencial** (nombrando a Ventas, Logística, Asistente
y Secretarial uno por uno) y que **la cascada no se invierte** (Directivo sí, Secretarial no). Las
aserciones de conteo de `seed.int.test.ts` **no ven** una fuga así: infla los dos escalones a la vez y la
cascada "sigue bajando".

*El flujo del Excel, dentro del sistema: ella desarrolla y cotiza, él aprueba el precio.*

- **Aplica en:** V1-E7d (mismo commit; es el territorio de permisos de modelos) — versión **0.034**.
  🔴 **Requiere `SEED_ON_START=true`** en el deploy, o el reparto nuevo no llega.
- **Fecha:** 2026-08-26.

> ⚠️ **Nota de archivo, para quien busque esto por el historial de git:** el commit que trae este cambio
> (`9b4e9a2`) lleva en su título **`§Post-F9.122`**, que es **otra decisión** (el catálogo de
> departamentos que se llena de sinónimos, aquí abajo). La numeración correcta de ESTA decisión es
> **§Post-F9.123**, que es la que llevan los archivos. No se reescribe la historia por un título; queda
> anotado aquí para que un `git log` no mande a la sección equivocada.
#### (Post-F9.122) — ⭐⭐ EL CATÁLOGO DE DEPARTAMENTOS DEL CLIENTE SE ESTÁ LLENANDO SOLO DE SINÓNIMOS (DANIEL, 25-ago-2026)

**Cómo salió.** Daniel, después de cargar tres modelos de C&A:

> *"Hay un problema de fondo que vale la pena resolver de una vez. Se ha vuelto algo confuso el género,
> el departamento, y conforme vayamos subiendo nuevas órdenes va metiendo a su catálogo nuevos
> nombres… Hice 3 modelos de C&A que los puse en el departamento **«2-HOMBRE»** (ese seguramente lo sacó
> de alguna OC), y luego hay **«Caballeros»**… y esta lista va a ir creciendo conforme vayamos subiendo
> nuevas OC."*

**Medido — el importador crea departamentos SOLO.** `importacion-pdf.ts:300-318`: si la OC del cliente
trae un departamento que no existe, lo **da de alta**. Comprueba que no exista **con ese mismo nombre**
(`mode: 'insensitive'`), pero `"2-HOMBRE"` y `"Caballeros"` **son textos distintos**, así que crea los
dos. Y como cada cliente escribe su departamento a su manera —y cambia el formato entre archivos—, **la
lista crece con sinónimos de lo mismo**.

⚖️ **Por qué importa más de lo que parece:** el departamento no es una etiqueta suelta. **La lista de
precios cuelga de cliente + departamento** (§Post-F9.109), y los candidatos a lista se filtran por él
(`candidatosParaLista`). ⇒ Dos nombres para el mismo departamento **parten el trabajo en dos mundos que
no se ven entre sí**: un desarrollo capturado en «2-HOMBRE» no aparece al armar la lista de «Caballeros».

⭐ **Y este problema YA SE RESOLVIÓ UNA VEZ en este sistema: los COLORES tienen fusión**
(`DialogoFusionColores`, `dominio/catalogos/colores.ts`). **La misma medicina aplica.** No hay que
inventar el patrón, hay que llevarlo a este catálogo.

**Respuesta de Daniel:** *"Sí, que me pregunte y yo le confirmo… pero creo que hay que empezar a
unificar."*

**Lo que se decide, y son DOS piezas:**

- **(a) FUSIÓN de departamentos**, igual que la de colores: se elige cuál se queda, cuáles se absorben, y
  **todo lo que apuntaba a los absorbidos pasa a apuntar al bueno**. **Nada se borra ni se pierde** (D3).
  Es lo que limpia lo que ya está.
- **(b) EL IMPORTADOR DEJA DE CREAR A CIEGAS.** Cuando llegue un departamento que no reconoce,
  **pregunta y Daniel confirma** a cuál de los suyos corresponde.
  ⭐ **Y APRENDE:** la primera vez pregunta; a partir de ahí **recuerda** que `"2-HOMBRE"` de C&A es su
  departamento `"Caballeros"`. **El patrón ya existe y está probado aquí**: `ClienteModeloLiga` hace
  exactamente eso con los modelos del cliente en el importador de OC. Se replica, no se inventa.

⚠️ **PENDIENTE DE MEDIR, no de suponer:** Daniel menciona en la misma frase que *"se ha vuelto confuso el
GÉNERO, el departamento"*. Son cosas distintas —`Genero` es catálogo global de FR Moda («Caballero» es un
dígito de la nomenclatura, §Post-F9.34) y `ClienteDepartamento` es del cliente— **pero se parecen tanto
en el nombre que pueden estar mezclándose en la captura**. **Hay que medirlo antes de opinar**: si el
sistema los está cruzando de verdad, es otro defecto; si sólo se parecen los nombres, es un problema de
rótulos y se arregla nombrando mejor.

### ✅ LA PIEZA (a) YA ESTÁ CONSTRUIDA — V1-E8p, 29-ago-2026

**Daniel ya puede juntar departamentos duplicados** desde la ficha del cliente («Juntar duplicados»):
elige el que se queda, marca los que son el mismo escrito de otra forma, **lee cuántos proyectos,
listas de precios y cotizaciones se van a mover**, y confirma. Todo lo que colgaba de los absorbidos
pasa al bueno; los absorbidos quedan **desactivados, nunca borrados** (D3).

⚠️ **REPUNTA, no bloquea — al revés que la fusión de COLORES.** `fusionarColores` se NIEGA cuando el
origen ya se usa (§Post-F9.129), porque `Color` tiene doce llaves entrantes y varias son movimientos ya
asentados (corte, kardex de PT) que no se pueden mover sin volverlos incoherentes entre sí. El
departamento no se parece: sus **cuatro** llaves entrantes —`Proyecto`, `ListaPrecios`, `Cotizacion` y
`ClienteFactores`— son documentos **vivos y editables**, y arreglar a dónde apuntan **es** el trabajo.
Bloquear aquí habría dejado a Daniel exactamente igual de atorado, porque los departamentos revueltos
son justamente los que ya tienen trabajo encima.

#### ⚖️ La decisión que había que tomar: **QUÉ FACTORES GANAN cuando los dos tienen**

`ClienteFactores` lleva `@@unique([idCliente, idClienteDepartamento])`: un cliente tiene **como mucho
un** juego de factores por departamento. Si el que se queda **y** el absorbido tienen los suyos, no se
pueden mover los dos. Y **la receta de los colores no traduce**: allá la colisión se resuelve
*rellenando huecos* (el destino conserva lo suyo y toma del origen sólo lo que tenía vacío), pero aquí
los cuatro porcentajes son obligatorios — **siempre están completos los dos juegos y hay que elegir**.

**Se decide: GANAN LOS DEL DEPARTAMENTO QUE SE QUEDA.** La razón es de negocio, no técnica: el canónico
es la identidad que sobrevive —conserva su id, su nombre y su historia— y **sus factores son parte de
esa identidad**. Que los del absorbido lo pisaran significaría que el departamento sale de la fusión con
el mismo nombre y **otro precio** — el cambio más caro del sistema (el factor **es** el precio dicho de
otra forma, §Post-F9.125) ocurriendo como efecto colateral invisible de una limpieza de catálogo.

- **No se pierden en silencio:** los cuatro valores del absorbido se **escriben en la bitácora** antes
  de retirar la fila. La decisión queda auditable y **rehacible a mano** si Daniel dice que los buenos
  eran los otros.
- **Tampoco se BLOQUEA la fusión por esto** (bloquear devuelve a Daniel al problema): se **avisa antes**,
  en la misma pantalla, y se ejecuta.
- El **default del cliente** (los factores sin departamento) no lo toca la fusión: no apunta a ninguno.
- ⚠️ **Si se absorben VARIOS y más de uno trae factores propios, se queda el del PRIMERO** (los
  absorbidos se procesan en el orden en que se marcaron): el primero se los lleva al canónico y los
  demás ya chocan contra ésos. La pantalla lo dice **por departamento**, uno por uno, antes de
  confirmar. *(Este caso llegó a mentir en la vista previa y se arregló al construirlo: ver la ficha
  de V1-E8p.)*

#### 🔴 Lo que la fusión NO alcanza — dos COPIAS DE TEXTO, y sólo una es problema

1. **`Cotizacion.nombreDepartamento`** — snapshot congelado **a propósito** (*"tal como se imprimió"*).
   **No se toca, y está bien:** un papel de marzo no se reescribe porque en agosto se unifiquen dos
   catálogos. Se dice para que nadie lo lea como un olvido.
2. **`OrdenReferencia.valor`** del campo «División» — el importador guarda el texto **crudo** de la OC
   (`"2-HOMBRE"`) como referencia de la orden (D7), y está **indexado para búsqueda**. ⇒ Después de una
   fusión los proyectos y las listas quedan unificados **pero la búsqueda por referencia sigue partida**.
   **Es la QUINTA PIEZA, y queda pendiente de la palabra de Daniel** (`HOJA-DE-RUTA.md` §4): tocar un
   valor capturado de un documento del cliente es una decisión de negocio, no un efecto colateral de
   limpiar un catálogo.

#### 🔴 Y una guarda que la fusión NECESITABA: el importador ya no RESUCITA lo absorbido

Medido al construir: `resolverOCrearDepartamento` (`pedidos/importacion-pdf.ts`) **reactivaba** un
departamento desactivado que volviera a aparecer en una OC. Con eso, Daniel junta «2-HOMBRE» en
«Caballeros» y **la siguiente OC de C&A le deshace la limpieza en silencio**. *Una limpieza no puede
durar menos que la siguiente importación.* Ahora lo **reusa sin reactivarlo** — y no se pierde nada,
porque ese resolver no amarra el departamento a la orden (la orden no tiene FK a departamento; la
División viaja como referencia de texto). **Esto NO es la pieza (b)**: es la guarda mínima para que (a)
no se deshaga sola.

#### La red contra la podredumbre

`cliente-departamentos-fusion-referencias.test.ts` **lee `prisma/schema.prisma`** y exige que la lista
de tablas a repuntar cubra **todas** las llaves entrantes del departamento, con igualdad exacta. Si
mañana alguien le cuelga una quinta tabla y no la agrega, **la prueba se pone roja** en vez de dejar la
fusión repuntando cuatro de cinco y la quinta apuntando a un departamento apagado, en silencio. Es la
misma red que se puso en los colores después de que aquella lista se enumerara mal **tres veces**.

**La pieza (b) —que el importador PREGUNTE y APRENDA— sigue pendiente**, con su etapa propia.

- **Aplica en:** **(a) V1-E8p ✅ (29-ago-2026, versión 0.053)** · **(b) ⬜ etapa propia, sin construir**.
  **SIN migración, SIN permiso nuevo** (reusa `clientes.administrar`) → el deploy **no** necesita
  `SEED_ON_START`.
- **Fecha:** 2026-08-25 (decisión) · 2026-08-29 (construcción de (a)).
#### (Post-F9.120) — 🔴 LA FECHA DE ENTREGA DE LA OC NO SE HEREDA DE NINGÚN LADO (DANIEL, 25-ago-2026)

**Cómo salió.** Daniel, usando la explosión en `prueba`:

> *"No puse fecha de entrega en una OC de tela, y tomó la fecha de entrega de la OC del cliente (la 7970)."*

**Medido: el sistema hacía lo que se le pidió, y lo que se le pidió estaba mal.** `generarOCDesdeExplosion`
(`dominio/compras/mrp.ts`) armaba un `respaldoPorProveedor` con la **fecha de entrega de la orden de
producción** y lo pasaba como último recurso a `resolverFechasDeOc`. Venía de V1-E3q, cuando se hizo
obligatoria la fecha (§Post-F9.103): en vez de bloquear siempre, se decidió reusar la de la orden si la
traía.

⚖️ **Por qué está mal, y es de negocio:** la fecha de la orden es **cuándo se le entrega al CLIENTE**; la
de la OC es **cuándo tiene que llegar la TELA**. Igualarlas le pide al proveedor que entregue la materia
prima **el mismo día en que hay que entregar la prenda terminada** — imposible por definición.

🔴 **Y lo grave no es que quede vacío: es que queda LLENO con un número equivocado que se ve legítimo.**
Un campo vacío que frena es honesto; un campo lleno con la fecha incorrecta **nadie lo revisa**, y el dato
sirve para reclamarle al proveedor.

**Y hay antecedente del propio Daniel** en §Post-F9.71: *"cada OC interna va a tener una fecha de entrega
diferente"* — porque **la tela se necesita semanas antes que los avíos**. Ahí quedaron dos caminos: (A)
capturar la fecha por proveedor —lo construido— y (B) que el sistema la **calcule hacia atrás** desde la
entrega de la orden con el tiempo de entrega de cada proveedor. El respaldo que había **no era ni A ni B**:
copiaba la fecha del cliente, la única de las tres que no puede ser correcta.

**Se le ofrecieron tres salidas. Daniel escogió la primera, sin matices:**

> *"Que marque error y pida poner una fecha de entrega. **No toma nada en automático de ningún lado**."*

**Lo que se decide:**

- **(a)** **Se ELIMINA el respaldo.** Sin fecha capturada, la explosión **no genera la OC** y lo dice.
  **Nada se hereda de la orden de producción, ni de ningún otro lado.**
- **(b)** 🔴 **El mensaje de error hay que reescribirlo.** El de hoy dice *"Captúrala en la orden, o
  indica la fecha de…"* — y bajo la regla nueva **«captúrala en la orden» es un consejo FALSO**: capturarla
  ahí ya no sirve de nada. Un mensaje que manda al usuario a hacer algo que no funciona es peor que
  ninguno.
- **(c)** Sigue vigente §Post-F9.71(A): **la fecha se captura por proveedor** en la misma pantalla, porque
  la tela y los avíos no llegan el mismo día.
- **(d)** El camino (B) —calcularla hacia atrás con el tiempo de entrega por proveedor— **sigue abierto y
  es el correcto de fondo**. Cuando exista, será una **PROPUESTA editable**, nunca un valor silencioso.

🔴 **Y Daniel precisó de qué depende, que es más de lo que el lead había supuesto:**

> *"Ya llegaremos en algún momento a que sea en automático… pero para eso tenemos que tener muy avanzado
> todo… **desde la Ruta Crítica**, pero aún no vamos a implementarlo."*

⇒ El lead había escrito que (B) *"exige capturar el tiempo de entrega por proveedor"*. **Es más que eso.**
Calcular hacia atrás una fecha de compra es, literalmente, **programación hacia atrás desde la entrega** —
que es lo que hace la **Ruta Crítica** (el CPM del sistema, F5: procesos con antecesores, duraciones y
*backward pass*). Poner una calculadora de fechas aparte en Compras sería **una segunda planeación que
compite con la buena** y que se desincroniza en cuanto la RC empiece a usarse de verdad.

**Y la Ruta Crítica está POSPUESTA a propósito** (§Post-F9.118(b), del mismo día: *"arrancamos sin ella"*).

⇒ **(B) NO se construye hasta que la Ruta Crítica esté operando.** Mientras tanto la fecha se captura a
mano, por proveedor, y **eso es lo correcto** — no un parche esperando algo mejor. *Un cálculo automático
apoyado en una planeación que nadie usa produciría exactamente el mismo tipo de dato falso que esta
decisión viene a quitar.*

- **Aplica en:** V1-E7f. **Fecha:** 2026-08-25.

#### (Post-F9.124) — 🔴 EL CLIENTE `pg_dump` DE LA IMAGEN VA ATADO A LA MAJOR DEL SERVIDOR DE RAILWAY (26-ago-2026)

> ⚠️ **Nació con el número 123, que ya estaba ocupado** por «Aurora administra modelos» (arriba). Dos
> ramas escribieron el mismo número el mismo día sin verse. Se renumera **ésta** —la de pg_dump— porque
> es la que **nadie referencia**: la de Aurora la citan seis archivos, y mover la más citada sería
> cambiar seis lugares para arreglar uno. **Es la tercera cicatriz de numeración del track** (ver la 108
> duplicada y el aviso de la 117/121). *El número se asigna al escribir; que dos plumas escriban a la
> vez es el costo de trabajar en paralelo, y se paga con un aviso, no borrando.*

> El comentario que ya estaba escrito en `backend/Dockerfile`, y que se cumplió al pie de la letra:
> *"Si algún día se sube la major del servidor en Railway, hay que subir este número también — el job
> lo detecta y lo dice con todas sus letras en el rastro de la corrida, **pero para entonces ya se
> habrán perdido corridas**."*

**Qué pasó.** Railway ya provisiona **PostgreSQL 18.6**. La imagen del backend instalaba
`postgresql-client-17`. Como **`pg_dump` se niega a volcar un servidor más nuevo que él**, el segundo
respaldo cifrado a R2 (V1-E6a) **no podía correr en ningún ambiente**: la corrida mensual habría
fallado en el paso `VOLCADO` sin escribir un byte, en `prueba` y en el environment de producción que
se está montando.

**Cómo se descubrió, y por qué importa el cómo.** Daniel notó que en R2 no existía la carpeta
`respaldos/`. Rastreando eso aparecieron **dos fallos encadenados, los dos invisibles**:

1. Una fila `FALLO`/`CONFIGURACION` del **17-ago** —faltaba `RESPALDO_LLAVE`— que llevaba **una
   semana** en `respaldo_corrida` sin que nadie la viera. Ya estaba resuelta (la llave se puso el
   19-ago; `pgboss.schedule` tenía el job agendado).
2. Al correr el respaldo **a mano por primera vez**, este otro: el desajuste de majors.

**La regla que queda escrita.** La major de `postgresql-client-NN` del `Dockerfile` **no es una
elección libre: va atada a la del servidor de Railway**. La restricción de `pg_dump` es de un solo
sentido — un cliente **más nuevo** vuelca servidores más viejos sin problema; uno más viejo **se
niega**. Ante la duda, se sube.

**Dónde se mueve, y siempre JUNTO:**
- `backend/Dockerfile`: el paquete `postgresql-client-NN` **y** el `ENV RESPALDO_PG_DUMP=/usr/lib/postgresql/NN/bin/pg_dump`.
  ⚠️ Las dos, no una: `/usr/bin/pg_dump` es un **wrapper** de `postgresql-client-common` que elige la
  versión según el clúster por defecto. Ya causó un CI rojo en el PR #184.
- `.github/workflows/ci.yml`: la instalación, el `GITHUB_PATH` y el paso *"Verificar que `pg_dump`
  del PATH es la NN"*.

**Lo que NO se movió, a propósito:** el `docker-compose.yml` local y el Postgres de **testcontainers**
siguen en **17**. No es descuido — un cliente 18 vuelca un servidor 17 sin problema, y subir la major
de la base local/CI toca el job `e2e` (que levanta el compose) sin comprar nada para este arreglo.
**Queda como divergencia consciente**; si algún día se quiere alinear, es una etapa aparte.

**Y el hueco que este arreglo NO cierra.** El aviso del respaldo es **PASIVO**: no hay correo ni
notificación. Los dos fallos de arriba vivieron días sin que nadie los notara, y con corridas
**mensuales** eso pesa más, no menos — *un fallo en enero se descubre en junio*. Mientras no exista
notificación activa, **revisar la bitácora `RespaldoBd` tiene que ser parte de la rutina mensual**.
Queda anotado como deuda, no como resuelto.

- **Aplica en:** SIN migración de BD, SIN permisos, SIN seed. Es imagen + CI + documentación.
  Se verifica corriendo `scripts/respaldar-ahora.ts --revisar` (imprime la versión de `pg_dump`).
- **Fecha:** 2026-08-26.

---

#### (Post-F9.125) — ⭐⭐ EL PRECIO DE VENTA ES SÓLO DEL DUEÑO: los cuatro factores, quién los ve, y la firma que se cae (DANIEL, 26-ago-2026)

**El principio, con sus palabras, y es lo que resuelve los casos que no se previeron:**

> *"Puede hacer sus cálculos, pero **el sistema no le muestra información digerida**."*

**Cómo salió.** Revisando cómo trabaja Desarrollo (§Post-F9.123: *"ella arma un excel con todos los
costos, me los pasa, **yo reviso y le doy el precio de venta**"*), quedó a la vista que el sistema no
reproducía ese reparto. Aurora —rol `Gerencial`— podía mover los porcentajes con los que se calcula el
precio, verlos, y bajarle al cliente un papel con precios que nadie había aprobado.

---

**(a) LOS CUATRO FACTORES SÓLO LOS MUEVE ÉL.** Margen · descuentos · regalías · costo de ventas.

> *"los factores sólo yo los puedo mover"*

Movían con **`listas.administrar`**, que Aurora tiene (y Ventas también). Hoy exigen **`listas.aprobar`**,
el permiso del dueño (Administrador · AdministracionDireccion · Directivo; a Gerencial se le resta en el
seed desde F8-E4). **Mover un factor ES mover el precio de venta**, y el precio ya era suyo.

🔴 **Y son DOS puertas, no una.** El snapshot editable de la lista **y** el catálogo de factores del
CLIENTE (`ClienteFactores`), del que la lista copia su snapshot al nacer. Blindar sólo la primera habría
dejado la segunda abierta: se mueve el factor del cliente y el precio de la próxima lista sale distinto,
sin pasar por él. *Un candado que se rodea por el catálogo de al lado no es un candado.* (Es la lección
de §Post-F9.116(d) —«todas las puertas o ninguna»— aplicada al precio.)

---

**(b) NADIE MÁS LOS VE.**

> *"y no son visibles para nadie más"*

Se ocultan (`null`) en la **proyección del servidor**, con el mismo mecanismo que ya existía para los
importes. Lo que cambia es **cuál es la reja**: era `consultas.ver-importes`, que **Aurora tiene y
necesita** —ve costos, arma precostos, manda cotizaciones—, así que nunca fue reja. Hoy es
`listas.aprobar`, y el criterio vive en **UNA sola función** (`puedeVerFactoresDePrecio`) que usan las
tres proyecciones. *Dos criterios que validan "casi" igual se desincronizan en la primera corrección.*

🔴 **La tercera puerta, que era la más ancha: la CALCULADORA de la mesa.** `simularNegociacion` no
"dejaba deducir" el margen — lo **servía**:

| Campo | Qué entregaba |
|---|---|
| `margenObjetivoPct` | **ES** el factor `margenPct` del snapshot, tal cual. No es derivable de nada. |
| `precioNeto` | `objetivo × (1 − suma/100)` ⇒ dividido entre el objetivo, da la **suma de los otros tres**. |
| `margenBrutoPct` | sale del neto ⇒ arrastra la misma fuga. |
| `cumpleObjetivo` | un **oráculo**: moviendo el objetivo hasta que cambia se reconstruye el margen a voluntad. |

La pantalla lo pintaba literalmente: `Cumple · obj. 44.4%`. Eso es *información digerida*, que es
exactamente lo que Daniel dijo que no debía pasar. Los cuatro salen hoy en `null` sin `listas.aprobar`,
y la pantalla **no los pide ni pinta guiones**: dice a quién le toca. El **input del precio se queda**
—es el «precio acordado» de la ronda, que sí es trabajo de quien negocia—: se retira el veredicto del
sistema, no la captura.

⚠️ **EL LÍMITE, DECLARADO Y ACEPTADO.** Aurora ve el **costo** (`desgloseCostoLinea`, el precosto) y ve
el **precio** ⇒ **el margen sale con una división**. Se le planteó a Daniel y **eligió a sabiendas**: se
oculta el NÚMERO, no la ARITMÉTICA. Cerrarlo de verdad exigiría quitarle el costo o el precio a
Desarrollo, y eso **rompería su trabajo** —ella hace el desarrollo y manda las cotizaciones—. Queda
**dicho en el código**, no callado, para que nadie lo "descubra" dentro de seis meses y crea que es un
defecto.

---

**(c) SIN APROBACIÓN NO SALE DOCUMENTO, NI BORRADOR.**

> *"si no está aprobado no debería de poder bajar ni un borrador porque puede confundir al cliente"*

La **cotización** (V1-E7c) ya lo hacía bien: rechaza nombrando los modelos que faltan. Pero el **impreso
PDF** y el **Excel** de la lista bajaban `precioAprobado ?? precioCalculado` — una hoja con precios que
nadie autorizó y **con la misma pinta que la buena**. *Era la ventana abierta al lado de la puerta
cerrada.* Hoy las tres salidas comparten **el mismo guard**, `exigirRenglonesAprobados`: rechazan (409)
**nombrando los renglones** que faltan, y también la lista vacía (una hoja en blanco no es una oferta).
En la pantalla los dos botones quedan deshabilitados **diciendo por qué** — negar en el servidor y
explicar en la pantalla, no esconder.

⚠️ **Lo que NO alcanza, y con su razón:** el `precioAprobado ?? precioCalculado` sobrevive donde el
número es un **default interno editable**, no un papel para el cliente — el precio sugerido al ligar la
orden (`sugerenciaLigaOrden`) y los candidatos del pedido. Ahí nadie le enseña nada a nadie de fuera.

---

**(d) MOVER UN FACTOR TUMBA LA FIRMA.** ⚠️ **Los factores. La RECETA todavía no** — ver el eslabón
abierto al final de esta decisión.

> 🔴 **Este encabezado decía «se mueva la receta o se muevan los factores», y era FALSO.** Lo escribió
> el lead, se lo dijo así a Daniel en el chat y llegó hasta aquí; lo cazó el reviewer de V1-E8b. El
> cuerpo de abajo siempre fue honesto —declara el eslabón suelto— pero **el encabezado es lo que se
> lee**, y prometía un candado que no existe. Queda corregido y **anotado en vez de borrado**, porque
> el modo de fallo importa más que el error: *una promesa de más en un documento de garantías es peor
> que no tener el documento; el lector deja de verificar justo donde más falta hace.*

`editarFactoresLista` recalculaba el precio **sin tocar `precioAprobado`**, y estaba escrito como una
cortesía: *no pisarle la firma al dueño*. **El efecto era el contrario del propósito** — quedaba un
precio APROBADO que ya no correspondía a los porcentajes con que se calculó, y el sistema lo seguía
presentando como firmado.

🔴 **Y había DOS criterios para el mismo hecho:** la **ronda de negociación** SÍ resetea la aprobación
cuando cambia el costo. Que mover el costo tumbara la firma y mover el margen no, **no era una
distinción de negocio**: era que nadie las había mirado juntas.

Se unifican con la regla que este proyecto ya adoptó en **V1-E7e (§Post-F9.116)**: *cambiar aquello
sobre lo que se firmó tumba la firma*.

- Mover **cualquiera** de los cuatro factores devuelve a `pendiente` **todos** los renglones aprobados
  de esa lista.
- **La firma vieja NO se borra** (D3): va al `NegociacionEvento` **inmutable** del renglón —el mismo
  libro que la pantalla ya enseña como historial— con el precio anterior y una **nota de qué la
  invalidó y de cuándo era**; y a la **bitácora**, con quién la aprobó y cuándo.
- **Se vuelve a aprobar normalmente**, con el mismo permiso. **No hay estado muerto.**
- **Guardar los MISMOS valores no tumba nada**: sin hecho detrás no hay firma que caer.

---

🔴 **EL ESLABÓN QUE ESTA DECISIÓN NO CIERRA (medido, no supuesto).** Cambiar la **receta del modelo** no
mueve el precosto congelado —son inmutables por diseño (D3)— ni el renglón de lista. Hay que **congelar
una versión nueva Y registrar una ronda**, las dos **a mano**; si se olvida cualquiera, **el precio
aprobado sigue en pie sobre un costo que ya no existe, y el sistema no avisa**. Es el hermano de
§Post-F9.116 del lado del precio. No se construyó aquí porque es **alcance nuevo** y hay que decidirlo:
el detalle de lo que se midió y las dos opciones están en `docs/hoja-de-ruta/V1-etapas.md` §V1-E8b.

> ✅ **RESUELTO en V1-E8d (27-ago-2026) — pero léelo con cuidado: se cerró como AVISO, no como firma
> que se cae.** Daniel: *"Si. Ok. **Que me avise.**"* Se construyó la opción **(B)** (columna
> `Modelo.recetaTocadaEn` escrita sólo por el embudo de la receta) y el sistema **lo dice** en la
> pantalla donde se aprueba y al emitir la cotización. **La firma NO se cae y el papel sigue saliendo**
> — el porqué, y el hueco que eso deja, están en **§Post-F9.127**.

- **Aplica en:** V1-E8b. **SIN permisos nuevos** (`listas.aprobar` ya existía y su reparto no se toca)
  ⇒ **no requiere `SEED_ON_START`**. **SIN migración de BD.** **Fecha:** 2026-08-26.

---

#### (Post-F9.126) — ⭐⭐ LA MEDIDA Y EL COLOR DEL AVÍO EN LA ORDEN DE COMPRA: lo que parte el renglón es lo que se recibe por separado (DANIEL, 26-ago-2026)

**Cómo salió.** Daniel lo reportó **dos veces** usando el sistema. La primera, corta:

> *"Le había puesto que **el cierre lo tengo que comprar por medidas**. Y al hacer la OC **no me
> aparece cantidad por medida… sólo veo un solo renglón**."*

Y después el caso completo, que es el que fijó el diseño:

> *"Se cotiza un cierre de un modelo. Ese modelo nos lo piden en **4 variantes de color**. Se generan
> 4 órdenes de producción. A la hora de comprar, vamos a juntar las 4 OP en **una sola OC**. Los
> cierres se compran todos al mismo proveedor, pero **cada color es diferente y cada color tiene
> cantidades por medida** de acuerdo a lo que nos pide por talla el cliente en cada OP. **En la
> receta no viene definido el color. Eso viene hasta que nos hacen el pedido.** … Esto mismo pasa en
> **jaretas, cintas palmita**, etc."*

Su forma preferida, textual: *"poner 4 veces el cierre y **en la descripción del avío ponerle el
color**, y sólo que me dé el desglose de cantidad por medida sería suficiente"*, con un
**"hazlo de la mejor manera que puedas"**. Y confirmó que **una sola OP con varios colores también
debe salir renglón por color**.

---

**🔴 LA REGLA DE DISEÑO, que es lo que hay que recordar de esta decisión:**

> **Lo que parte el RENGLÓN es lo que se recibe por separado. Lo que sólo hay que decirle al
> proveedor va en la TABLITA.**

De ahí salen las dos mitades, y ninguna es arbitraria:

**(a) EL COLOR PARTE EL RENGLÓN.** El renglón es la unidad de todo lo que viene después: se **recibe
contra la LÍNEA, que lleva el color**, y `comprometido-en-oc.ts` netea por renglón para no volver a
comprar lo ya comprado. Si un renglón cargara cuatro colores, **recibir tendría que aprender a leer
una tabla** — y eso sí sería caro.

> 🔴 **Aquí decía «y el kardex entra por color», y era FALSO.** Lo cazó el reviewer de V1-E8c: el
> kardex de avíos **no lleva color** —`MovimientoDetAvio` no tiene esa columna y la vista
> `existencia_avio` agrupa sin ella—, y el propio código lo dice a catorce líneas de distancia
> (`mrp.ts:~1326`), que es justo el motivo por el que el stock de un avío genérico se lee **una vez**
> y se consume color por color. La frase estaba en **siete sitios del mismo commit**, uno de ellos el
> comentario permanente de la migración. Se corrige y **se anota, no se borra**: el argumento que
> sostiene el diseño —*si un renglón cargara cuatro colores, recibir tendría que aprender a leer una
> tabla*— nunca necesitó del kardex. *Una razón falsa que sostiene una decisión correcta es peor que
> ninguna razón: el que venga después la usará para decidir otra cosa.*

Es literalmente lo que V1-E3u (§Post-F9.89) hizo con las telas; esta etapa le abre la misma puerta a
los avíos. **No hay un segundo mecanismo de agrupación**: es
`claveAgrupada` (`material | color | proveedor`) con un concepto de color más ancho — de tela en las
telas, **de prenda en los avíos**.

**(b) LA MEDIDA VA EN UNA TABLITA BAJO EL RENGLÓN.** **No se recibe por medida**: llegan *"3,200
cierres"* y el proveedor los mandó cortados según el desglose. Es información **para él**, así que su
destino útil es el papel (y la pantalla que lo revisa), no una dimensión del inventario.

**⚠️ LA MEDIDA NO MULTIPLICA NUNCA.** De ahí salieron los **133,095** cierres que Daniel cazó en
§Post-F9.105: el sistema leyó el `50` de *"50 cm"* como si fuera consumo. Lo que multiplica es el
**CONSUMO** (el elástico gasta distinto por talla, y de ahí sale cuánto comprar). La cantidad de una
medida sale de **cuántas prendas la llevan** — curva × consumo por prenda. Por eso el desglose se
calcula abriendo la MISMA regla R18 (`requeridoAvioReceta`, `porTalla`) y no con una cuenta paralela:
una segunda cuenta sobre medidas es exactamente como nació el defecto de los 133,095.

**(c) UN SOLO PRECIO PARA TODO EL RENGLÓN** (§Post-F9.113). Se desglosan **cantidades**, no precios;
el importe sigue siendo `cantidad × precio` y cuadra sin excepciones. **Σ del desglose = cantidad del
renglón, exactamente**, y no por casualidad: se reparte con la misma función que reparte una compra
entre las OP (`repartirEntreOrdenes`, la última absorbe el residuo). Hace falta porque el total del
renglón **no siempre es el requerido**: se le resta lo que ya está en otra OC (§Post-F9.85) y el
comprador lo puede editar antes de generar (§Post-F9.94).

**(d) EL SISTEMA PROPONE, LA PERSONA EDITA** — igual que la cantidad y el precio hoy (§Post-F9.94). El
color viaja en **dos piezas que hacen cosas distintas**: `idColorPrenda` es la **identidad** del
renglón (por ella netea la explosión y se reparte por OP) y `colorAvio` es **el texto que el proveedor
lee**, precargado con el nombre del color de la prenda y **editable en la revisión previa** — porque a
veces **el avío va en contraste** (cierre negro en prenda roja) y el nombre del color de la prenda
sería una instrucción equivocada.

---

**⛔ NO SE CREA CATÁLOGO DE COLOR DE AVÍO**, y es decisión de Daniel (§Post-F9.91):

> *"los avíos no llevan catálogo de color: **el color va en su descripción**"*

Por eso el texto es texto y no una FK. El id que sí existe (`idColorPrenda`) no es un catálogo nuevo:
es el color de la **prenda** que ya vive en la matriz color×talla de la OP (D4) — el mismo del que
sale la cantidad de cada renglón.

---

**⚠️ EL LÍMITE, DECLARADO Y ACEPTADO POR DANIEL — no es un defecto escondido.**

Una **entrega parcial sabrá el COLOR pero no la MEDIDA**. Sale directo de (b): la recepción cruza
contra la LÍNEA, y la línea lleva su color; la medida es informativa y no tiene dimensión ni en la
recepción ni en el kardex de avíos. Si algún día importa —si de verdad hay que recibir "1,200 de 53
cm" por separado—, **se parte también por medida con este mismo mecanismo**: la medida sube de la
tablita al renglón, igual que el color acaba de subir. **No es un callejón sin salida**, y decirlo así
importa tanto como decir el límite.

---

**Lo que NO cambia** (para que nadie lo lea al revés): el reparto sigue siendo **por OP** (§Post-F9.86,
una línea por material × OP), el **impreso sigue consolidando para el proveedor** (§Post-F9.102: él ve
una cantidad por color+medida, **no el reparto interno por OP**) y las telas siguen exactamente como
las dejó V1-E3u. Las OC anteriores a esta etapa quedan con el color en NULL y sin desglose, que es
justo lo que dicen hoy: el sistema no dejaba decirlo, y **inventárselo escribiría una suposición como
hecho** (D3).

🔴 **Un ajuste que se descubrió MUTANDO, y que aquí queda escrito:** en el **impreso** el papel agrupa
por el **TEXTO** del color, **no** por `idColorPrenda`. Dos líneas que el comprador corrigió al mismo
color ("Negro contraste" para el rojo y para el azul) salen en **un solo renglón**: al proveedor no le
sirven nuestros ids, y dos filas idénticas en un papel son ruido. El reparto por OP y por color de
prenda sigue **guardado intacto** — lo que se agrupa es sólo el documento.

---

**🔴 LO QUE EL CI DESTAPÓ, Y VALE MÁS QUE LA ETAPA: UN AJUSTE QUE NO CASA NO SE PUEDE TRAGAR EN SILENCIO.**

Al partir el renglón de avío por color, la **identidad** del renglón cambió: la clave del ajuste del
comprador (§Post-F9.94) pasó a llevar el color. Un ajuste que **no lo nombra dejó de casar** — y el
sistema **no hacía nada**. Medido con un doble de transacción, sin base de datos:

| Escenario | Cantidad que sale | ¿Se aplicó? | ¿Avisó? |
|---|---|---|---|
| Ajuste **sin** color, renglón **con** color | **100** (la propuesta del sistema) | ❌ | **nada** |
| Ajuste **con** color, renglón con color | 40 (lo tecleado) | ✅ | — |

⚖️ **Por qué esto no es "una prueba que se quedó vieja":** el comprador teclea *"compra 0.1"* y se
compran **180**. Es **dinero saliendo con una cantidad que nadie aprobó, sin traza**. La prueba que
falla es el síntoma; el defecto es el silencio.

**Lo que se decide:** un ajuste que no encuentra su renglón se convierte en **BLOQUEO** —nombrando el
material y los renglones que sí había—, y la orden de compra **no se genera**.

- **Es bloqueo y no aviso** porque no es un juicio de negocio (§Post-F9.64, *guía no jaula*): es el
  sistema diciendo **"no pude honrar tu instrucción"**. Avisar y comprar igual sería el mismo defecto
  con más letras.
- **Sólo se reclama cuando hay dinero en juego**: si ese material se le va a comprar a ese proveedor
  de todas formas. Si quedó fuera del plan —lo desmarcó, ya estaba cubierto, se quedó sin proveedor—
  el ajuste es irrelevante y bloquear sería ruido que atora al comprador por algo que no cambia nada.
  **Se reclama el dinero, no la contabilidad de claves.**

⭐ **El hallazgo que hay que recordar:** de las **18** pruebas que capturaban un ajuste, **unas diez
estaban en verde con su ajuste convertido en no-op**. Pasaban por lo que afirmaban *después*, no por
lo que creían estar ejerciendo. *Una prueba puede estar en verde y haber dejado de tocar el sistema.*

📌 **Y la regla de proceso que lo explica, para no repetirlo:** el cambio no rompió a quien **lee** el
color, sino a quien **construye la identidad** del renglón. El barrido buscó lecturas. ⇒ **Cuando una
etapa cambia la IDENTIDAD de una entidad, hay que barrer los sitios que la CONSTRUYEN, no sólo los que
la leen** — y los cuerpos de las pruebas son uno de esos sitios.

⚠️ **Nota de método, del lead:** la lista de fallos que se le pasó al coder salió de un registro de CI
**cortado por la cola**, y se le presentó como si fuera completa. El coder midió por su cuenta y
respondió que **al menos cuatro pruebas más** deberían haber estado ahí — y tenía razón en desconfiar.
El arreglo las cubre igual porque atacó la causa y no los síntomas, pero *una lista incompleta
presentada como completa es una forma de mentir con datos ciertos*.

---

#### (Post-F9.127) — ⭐ SI LA RECETA CAMBIA BAJO UN PRECIO YA APROBADO, EL SISTEMA **AVISA** (no tumba la firma, y el papel sigue saliendo) (DANIEL, 26-ago-2026)

**Cómo salió.** Es el **eslabón que §Post-F9.125 dejó abierto y declarado**. Se le explicó a Daniel así:
*"tu precio aprobado se queda parado sobre un costo que ya no existe. El sistema no avisa"*. Contestó,
textual:

> *"Si. Ok. **Que me avise.**"*

---

**EL HUECO, tal como estaba medido.** Un renglón de lista de precios guarda dos cosas: el id de un
**precosto CONGELADO** y una **copia** de su costo. Las versiones congeladas son **INMUTABLES por
diseño** (D3) — y eso está bien: es lo que hace que un precio firmado se pueda auditar años después.
La consecuencia es que **cambiar la receta del modelo no mueve nada del renglón**: hay que **congelar
una versión nueva Y registrar una ronda**, las dos **a mano**. Si se olvida cualquiera de las dos, el
precio aprobado sigue en pie sobre un costo que ya no corresponde a la receta de hoy, y hasta esta
etapa **nada lo decía**.

---

**(a) LA SEÑAL: una columna nueva escrita SÓLO por el embudo de la receta.**

`Modelo.recetaTocadaEn` + `Modelo.recetaTocadaCambio` (cuándo se tocó la receta, y qué parte). Las
escribe **una sola función**, `tocarModeloPorCambioDeReceta` — el embudo de V1-E7e por el que ya pasan
obligatoriamente las **6 puertas** que pueden mover la receta (telas, avíos, avíos favoritos, medidas
por talla, arte, copiado). Una puerta nueva las hereda sin hacer nada: no compila sin pasar por ahí.

🔴 **Se descartó la alternativa barata, y el porqué es lo que hay que recordar.** La señal parecía ya
existir: `Modelo.modificadoEn > Precosto.congeladoEn`, sin migración. Pero **`modificadoEn` es
`@updatedAt`**: lo mueve **cualquier** escritura al modelo, y hay **11** en el código que no son receta
—renombrarlo, pasarlo a producción, la propia firma de revisión, subirle una foto—. *Un aviso que nace
gritando en falso se aprende a ignorar, y el día que sea de verdad nadie lo mira.* La columna cuesta
una migración **aditiva de dos campos nullable** y compra que el aviso diga exactamente lo que promete.

⚠️ **NULL = "no se sabe", NO "nunca se tocó".** **Sin backfill**, a propósito: no hay dato del que
deducir cuándo se movió una receta antes del despliegue, y rellenarlo con `modificadoEn` sería la
mentira que la decisión acaba de descartar. **Consecuencia declarada:** un desfase que YA existía el
día del despliegue **no se detecta**; se detecta el primer cambio de receta posterior.

---

**(b) EL AVISO DICE QUÉ Y CUÁNDO, y lo arma el SERVIDOR.**

Un criterio único, `avisoDeCostoViejo` (`dominio/desarrollo/costo-viejo.ts`), devuelve **la frase
completa** o `null`. No un booleano ni un semáforo: la cicatriz de este proyecto es *"la frase del
servidor nunca llega a la pantalla"*. Dice qué parte de la receta cambió, en qué fecha, contra qué
versión del precosto, y qué hacer. Se ve en **tres sitios**: pegado a su renglón en la lista de precios
(donde Daniel aprueba), en el resumen del encabezado de esa tabla, y en el diálogo de **emitir
cotización** —que es la puerta por la que un precio sobre un costo viejo sale hacia el cliente—.

**Avisa aunque el renglón NO esté aprobado** (con otra frase: *"…antes de aprobar el precio"*). Avisar
sólo sobre lo aprobado dejaría firmar un precio nuevo sobre el costo viejo, que es el mismo agujero un
minuto antes.

⛔ **Y NO se imprime en el PDF, el Excel ni la cotización.** Esos papeles los lee el **cliente**, y
*"el costo de este modelo quedó viejo"* es una nota interna. El aviso va donde se **decide**, no donde
se **comunica**.

**Y el aviso se apaga solo** en cuanto se congela una versión nueva y se registra la ronda: la ronda
re-apunta el renglón a un precosto congelado DESPUÉS del cambio. **No hay estado muerto** y no hizo
falta un mecanismo nuevo para limpiarlo.

---

**🔴 (c) POR QUÉ AVISA Y NO TUMBA LA FIRMA — y por qué eso NO es un tercer criterio.**

Los dos hermanos **sí** tumban: §Post-F9.116 (cambiar la receta tumba la revisión del modelo) y
§Post-F9.125(d) (mover un factor tumba la aprobación del precio). La regla que este proyecto unificó es
*«cambiar aquello sobre lo que se firmó tumba la firma»* — y la palabra que hace el trabajo es
**aquello**:

| Caso | Sobre qué se firmó | Qué cambió | ¿Es lo mismo? |
|---|---|---|---|
| §Post-F9.116 | la **receta del modelo** | la receta del modelo | **Sí** — misma fila, mismo acto |
| §Post-F9.125(d) | un **precio calculado con esos factores** | esos factores | **Sí** — misma lista, misma transacción |
| **Aquí** | un precio calculado **sobre el precosto congelado v3** | el **modelo** del que salió el v3 | **No** — el v3 no cambió, ni puede |

El precosto congelado es **inmutable por diseño**, así que el precio firmado sigue siendo exactamente
coherente con lo que se firmó. Lo que ya no se sabe es si **lo que se firmó sigue describiendo lo que se
va a fabricar**. *No es la misma clase de hecho, y por eso no pide la misma clase de respuesta.*

Y hay una razón práctica encima: un cambio de receta **puede no mover el costo ni un peso** (se corrigió
el archivo del arte, se ajustó una medida por talla) y **el sistema no tiene forma de saberlo** sin
volver a costear — sólo el humano que congela la versión nueva puede decirlo. Tumbar aquí cancelaría
precios ya firmados, y ya comunicados al cliente en una cotización, por hechos que a lo mejor no los
tocan.

---

**🔴 EL HUECO QUE ESTE AVISO DEJA, dicho y no callado.** **Un aviso se puede ignorar.** Con el desfase a
la vista, la **cotización, el PDF y el Excel siguen saliendo** con ese precio aprobado, y el renglón se
puede aprobar igual. Cerrarlo del todo sería **bloquear el papel mientras el costo esté viejo** —el
mismo candado de §Post-F9.125(c), pero disparado por un hecho distinto—. **Eso es MÁS de lo que Daniel
pidió**, y es él quien lo tiene que decidir, no el código. Queda **sobre la mesa**, no construido.

- **Aplica en:** V1-E8d. **SIN permisos nuevos** ⇒ **NO requiere `SEED_ON_START`**. **CON migración de
  BD**, 100 % aditiva (`20260827160000_aviso_costo_viejo`: dos columnas nullable en `modelos`, sin
  backfill). **Fecha:** 2026-08-27.

---

#### (Post-F9.128) — 🔴 «NO HAY DESARROLLOS DISPONIBLES»: EL AVISO QUE NO DECÍA POR QUÉ NI QUÉ HACER (DANIEL, 27-ago-2026)

**Cómo salió.** El motor de cotización está construido desde F8 y V1-E7c le puso el documento. Nada de
eso falló. Lo que falló fue **llegar a él**: Daniel, que sabe el negocio mejor que nadie, se topó con
**cuatro muros seguidos**, en este orden y con estas palabras:

> 1. *"En cotizaciones **no puedo hacer nada**… no veo ninguna actualización."* — y al rato:
>    *"**Aaaaaa, yo estaba viendo los precosteos** (en lugar de lista de precios)."*
> 2. *"**no está la opción de listas de precios** en desarrollo."*
> 3. *"si, ya estoy en cotizaciones, pero **supuse que de ahí jalo un proyecto de precosteo**… no puedo
>    hacer nada ahí. **No me deja hacer una lista de precios nueva**."*
> 4. *"si tengo el permiso. Sí veo el botón. Justo me sale la leyenda de que **no hay desarrollos
>    disponibles**."*

**No faltaba capacidad: faltaba el camino, y faltaba que el sistema dijera por qué no podía.**

---

**LO QUE SE MIDIÓ (antes de tocar nada).**

**(a) Por qué no había candidatos.** La regla de candidatura vivía **disuelta en un `where` de Prisma**
(`candidatosParaLista`), y son **cinco condiciones**, todas obligatorias: el desarrollo **no está
apagado** · su proyecto es de la **empresa activa** (A9) · del **cliente** y del **departamento**
pedidos · tiene **al menos un precosto en estado `congelado`** · y **no tiene renglón en ninguna lista**
(`listaLineas: none`). La que falla en el caso de Daniel es la del **precosto congelado**: el precosto
existe, pero se quedó en **borrador**, y congelarlo es un acto aparte («Precosto» → «Congelar versión»)
que nada le pedía ni le nombraba. Escrito como `where`, ese filtro **sólo sabe contestar "hay / no
hay"**: preguntarle *"¿y por qué no?"* era imposible.

**(b) Dónde vivía cada cosa en el menú.** Las tres que Daniel confundió, medidas en el riel:

| Lo que buscó | Cómo se llamaba | Dónde | Ruta | Permiso |
|---|---|---|---|---|
| Listas de precios | **«Pre-costeos»** | Operación › Desarrollo | `/desarrollo` | `desarrollo.ver` |
| Listas de precios | **«Cotizaciones»** | Operación › Desarrollo | `/listas-precios` | `listas.ver` |
| Listas de precios | **«Listas de precios»** | Comercial › Clientes | `/listas-precios` | `listas.ver` |

O sea: **la MISMA pantalla se llamaba distinto en dos lugares**, y el nombre que él buscaba sólo existía
en el grupo donde no la fue a buscar. Sus muros 1 y 2 salen enteros de esta tabla.

**(c) El eslabón sin puerta.** El camino real es **precosteo → congelar → lista de precios →
cotización**. Los dos extremos ya tenían puerta (botón «Generar lista de precios» en el proyecto;
«Emitir cotización» en la lista). El que **no** la tenía es **congelar**: al congelar, el sistema decía
`"Precosto v1 congelado."` y ahí terminaba — nunca decía **para qué sirvió** ni **a dónde ir**.

---

**LA REGLA QUE SE APLICA (es doctrina de la casa, §Post-F9.96).**

> **Capturar es el proceso normal: primero el lugar para llenar, y el aviso sólo si de verdad no se
> puede.** Un mensaje que dice *"no hay X disponibles"* **sin decir por qué ni qué hacer ES el
> defecto**, no la ayuda.

**(1) El servidor CLASIFICA, ya no sólo filtra.** La regla de **quién califica** se sacó del `where` a
una función pura, `motivoNoCandidato`, y la consulta ahora devuelve **los candidatos Y los descartados
con su motivo**. Los motivos son **cuatro y exhaustivos**, con precedencia declarada: `apagado` >
`ya-en-lista` > `precosto-borrador` > `sin-precosto`. La precedencia **no es cosmética**: decide qué
remedio se le ofrece a la persona (un apagado se reactiva, no se congela).

**(2) El aviso NOMBRA el modelo, el motivo y el acto.** Donde se leía *"No hay desarrollos cotizados
disponibles para este departamento"* ahora se lee, modelo por modelo y agrupado por motivo: *«Su
precosto sigue en BORRADOR (1) · A-100 — v3 en borrador · Ábrelo en «Precosto» y usa «Congelar
versión»»*, con **botón a Pre-costeos** cuando hay algo que arreglar ahí. El que **ya está en una lista
dice en cuál** (folio), que es el dato con el que se va a buscarla.

**(3) Se acabó la adivinanza en el cliente.** El motivo bajo el botón «Generar lista de precios» del
proyecto se **deducía del estado derivado del desarrollo**, y su propio comentario admitía que en casi
toda mezcla *"no se puede separar 'ya está en una lista' de 'le falta congelar' sin mentir"* → salía una
**disyunción**. Hoy el motivo lo dice el servidor por modelo y se leen los dos hechos por separado, con
su conteo.

**(4) La pantalla se llama IGUAL en los dos lados: «Listas de precios».** Se retira «Cotizaciones» como
rótulo del riel (venía de que *"Cotizaciones / Listas de precios"* se **truncaba** feo, Gabriel
9-jul-2026). **La palabra no se pierde**: encabeza la descripción (⌘K la indexa), sigue en el H1 de la
pantalla y es el nombre del **documento** que se emite. Lo que se gana es que el nombre que el dueño
buscó **existe donde lo buscó**, y que dos entradas a la misma pantalla dejan de parecer dos pantallas.

**(5) Congelar dice para qué sirvió.** El aviso pasó a *"Precosto v3 congelado: ya puede incluirse en
una lista de precios (Desarrollo › Listas de precios)"*.

**(6) El rechazo del API también.** `crearLista` **reusa la misma función** en vez de repetir la regla, y
su rechazo pasó de *"MOD-X: no tiene un precosto congelado"* a *"MOD-X: su precosto v1 sigue en
BORRADOR: congélalo («Precosto» → «Congelar versión»)"*.

---

**🔴 LO QUE NO SE HIZO, y por qué.** Daniel supuso que desde Cotizaciones *"jalo un proyecto de
precosteo"* (muro 3). **No se agregó un selector de proyecto al diálogo**: el diálogo pide cliente +
departamento porque **la lista es de un cliente+departamento**, no de un proyecto — puede juntar modelos
de varios proyectos, y ésa es la razón de que exista. Lo que se corrigió es lo que de verdad lo dejó
parado: que al llegar ahí **no supiera qué le faltaba**. Si Daniel quiere además arrancar la lista
eligiendo un proyecto, es una decisión suya y **no está construida**.

- **Aplica en:** V1-E8f. **SIN permisos nuevos** ⇒ **NO requiere `SEED_ON_START`**. **SIN migración de
  BD** (no se agregó ni una columna: todo sale de datos que ya existían y nadie leía). **Fecha:**
  2026-08-27.

#### (Post-F9.129) — ⭐⭐ «NEGRO A Y NEGRO B ES LO MISMO»: EL PACK DEJA DE SER UN COLOR (DANIEL, 27-ago-2026)

> ⚖️ **AJUSTE (28-ago-2026) — lo de abajo dice *«unificar las órdenes ya importadas es una migración
> que no se hace sin la palabra de Daniel»*. La palabra llegó, y fue la contraria: NO SE MIGRAN.**
> *«Lo viejo ahorita es irrelevante… vamos a importar de nuevo la información cuando vayamos a
> producción»* ⇒ **§Post-F9.132**. La limpieza no se hace sobre lo capturado: **se hace en el ETL del
> arranque**, y ahí sí es obligatoria ⇒ **§Post-F9.133** (el ETL de Access junta los packs igual que
> el importador de PDF). El bloqueo de «Fusionar colores» sobre un color en uso **se queda tal cual**.


**La queja, textual.** Daniel, mirando la pantalla de **Explosión de materiales**:

> *«Ahora estás poniendo dos renglones por cada orden (Negro A y Negro B). Necesitamos agrupar por orden
> cuando es el mismo color. Habíamos acordado hace tiempo que los packs se verían reflejados en otro
> campo. Negro A y Negro B es lo mismo. Solo cambia la distribución del empaque. Pero no tiene sentido
> separar las compras para cada renglón: veo demasiados registros.»*

**Qué es un "pack".** C&A pide varios **tendidos** en una misma orden de compra: el pack A con una corrida
de tallas (por ejemplo 2-1-1-3-3-2) y el pack B con otra (1-0-0-2-2-2). Son la misma prenda del mismo
color; lo que cambia es **cómo se agrupan las piezas para empacarlas**. Un CH negro del pack A y uno del
pack B son idénticos.

**La causa raíz, medida.** El importador de OC por PDF metía la letra del pack **dentro del nombre del
color** —`componerColor` armaba `Negro A`— y resolvía-o-creaba **un color por cada pack**. Así nacían
colores de catálogo `NEGRO A`, `NEGRO B`, `NEGRO C`… y como **todo lo que va aguas abajo agrupa por
color** (explosión de materiales, MRP, órdenes de compra, inventario, recepción), una misma orden llegaba
a las compras **partida en dos o tres renglones**. Esto no fue un descuido: fue una copia deliberada de la
maña del sistema viejo, a petición del propio Daniel cuando se construyó el importador (**§Post-F9.2**), y
ya estaba señalada como algo a cambiar en **§Post-F9.10** (*"Me gusta que exista un solo Negro y no esté
fragmentado en miles de colores escritos de diferente manera"*).

### Lo que se decidió

1. **El color de la orden es el color genérico, y ya.** `Negro`, nunca `Negro A`. La letra del pack no
   entra en el nombre del color ni fabrica catálogo.
2. **Los packs se SUMAN talla por talla en un solo renglón de la orden.** Si el pack A pide 254 de la
   talla 5-6 y el B pide 61, la orden lleva **un** renglón `Negro` con **315** en la 5-6.
3. **El desglose por pack se sigue GUARDANDO en `Orden.packsCliente`** — ése es exactamente **"el otro
   campo"** que Daniel recuerda haber acordado. Se escribe desde que se construyó el importador
   (§Post-F9.2), por los dos caminos, y trae íntegro cada pack con su tipo, su número de packs y su
   corrida por talla, más los SKU del cliente. Es la base del futuro **módulo de EMPAQUE**.

   ⚠️ **Pero decir "no se perdió nada" sería falso, y hay que decirlo completo.** Hoy **nadie consume
   ese campo**: no hay una sola lectura fuera del importador y sus pruebas, y el impreso de la orden no
   lo menciona. Hasta este cambio el desglose por pack **se veía** —eran renglones de la matriz, y
   salían en el impreso de la OP y en el de envío a maquila—; desde aquí **está guardado pero no se
   muestra en ninguna pantalla ni papel**. Para un taller que tiende por pack eso no es un matiz: hoy
   esa información tiene que salir de la OC del cliente. La pantalla que lo lea es parte del módulo de
   empaque.

   ⚠️ **Y hay una pérdida fina:** lo que se guarda es el desglose **del cliente** (las cantidades
   originales de la OC), **no las que se van a fabricar**. El reparto del 7 % de sobre-pedido entre los
   packs y las ediciones que el usuario haga en la vista previa **ya no quedan registrados pack por
   pack** en ningún lado — antes quedaban, porque cada pack era un renglón de la matriz.
4. **La vista previa del importador sigue mostrando los packs por separado** —Daniel la usa para cotejar
   contra el papel de la OC, y en el papel los packs existen— pero **etiquetados como packs** («Pack A»,
   «Pack B»), no como colores que no van a existir. Y el renglón de totales de abajo, que es el que de
   verdad retrata la orden, ahora dice el nombre del color: **«A fabricar · Negro»**. Se prefirió esto a
   colapsar la previa: la previa debe ser fiel al papel, pero no debe **mentir** sobre lo que va a quedar
   en la orden.

### Lo que este cambio NO hace, y por qué

- ⚠️ **Las órdenes YA IMPORTADAS conservan sus colores partidos** (`Negro A`, `Negro B`). El arreglo es
  **sólo hacia adelante**. Unificarlas es una **migración irreversible** que toca matrices de órdenes
  vivas, cortes y envíos a maquila ya capturados: ~~no se hace sin la palabra de Daniel y va como pieza
  aparte~~ → 🔁 **CERRADA *NO* (28-ago-2026, §Post-F9.132): esa migración NO SE HACE.** La limpieza se
  muda al **ETL del arranque** (§Post-F9.133). *(Es el mismo aviso del banner de arriba, repetido aquí
  porque es aquí donde se lee.)*
- 🔴 **«Fusionar colores» ahora SE NIEGA a fusionar un color en uso — se construyó en esta misma
  etapa.** Era la trampa obvia (juntar `Negro A` y `Negro B` en `Negro` desde Catálogos › Colores ›
  Fusionar) y **este cambio fabrica el motivo para caer en ella**: deja el catálogo lleno de colores que
  él mismo declara *"no eran colores, eran empaques"*, y el diálogo prometía que *"las telas que usaban
  los duplicados pasan al canónico"* sin decir una palabra de las órdenes.

  **El agujero era más ancho de lo que se escribió en la primera redacción** (que decía "no toca los
  renglones de las órdenes", quedándose corta): `Color` tiene **DOCE** llaves foráneas entrantes y la
  fusión sólo sabe mover **UNA** (`TelaColor`). Las otras **once** —matriz de órdenes, recetas de tela de
  la orden, corte/envío/recibo, kardex de PT, renglones de OC de tela y de avío, requerimientos de la
  explosión, faltantes dados por cubiertos, lotes, inventario cíclico y precios por color de
  proveedor— quedaban apuntando a un color **apagado**. Y eso rompe una regla que el propio sistema
  impone al escribir: **una orden viva no puede apuntar a un color inactivo**
  (`sincronizarMatriz`) — o sea, la orden se volvía **ineditable**.

  **Se decidió BLOQUEAR, no reasignar.** Entre "no hacer nada" y la migración irreversible había un
  tercer camino que **no toca ni un dato**: negarse y decir por qué. Ahora `fusionarColores` cuenta esas
  once referencias antes de desactivar nada y, si hay alguna, rechaza nombrando el color, en qué está
  metido y con cuántos renglones. **Reasignar de verdad NO se hizo, y esa razón sí se sostiene:**
  mover sólo la matriz dejaría el corte (`EtapaMovimientoDet`) y el kardex de PT (`MovimientoDetPt`)
  colgando del color viejo, o sea **incoherentes entre sí** — eso es trabajo de la migración del punto
  anterior. Fusionar colores que **no** se usan sigue funcionando igual. La lista de las once no se
  mantiene a mano sin red: una prueba **lee `prisma/schema.prisma`** y se pone roja si mañana le cuelgan
  una FK nueva al color y no la agregan. *(Se enumeraron estas referencias tres veces —el código
  original miraba 1, la primera redacción de esta decisión dijo 1, una revisión dijo 6— y las tres se
  enumeraron mal. De ahí la red.)* Deuda actualizada en `HOJA-DE-RUTA.md` §4.
- **El pack todavía no viaja al corte ni a la maquila.** §Post-F9.10 pide que el pack se vuelva **campo
  propio** y acompañe al corte y al envío a maquila (obligatorio ahí, opcional al recibir). Eso **no está
  construido**. Consecuencia honesta de hoy: como antes el pack venía disfrazado de color, la matriz de la
  orden *de hecho* permitía cortar por pack; ahora ya no. Daniel pidió el cambio sabiendo el orden de las
  cosas (*"me parece bien terminar con las telas y luego retomas esto"*), y el dato del pack sigue
  guardado en `Orden.packsCliente` para cuando se construya el campo. §Post-F9.10 **sigue abierta**: esta
  etapa entrega sólo su primera mitad (el importador deja de componer el color con la letra).
- **El importador de EXCEL no se tocó**: nunca usó letras de pack.

### Detalles que se resolvieron al construir

- **El pantone no tuvo que desempatarse.** Se temía que dos packs trajeran pantones distintos. No puede
  pasar: **el pantone es uno por OC** (cada PDF trae un color genérico y un pantone, y el ajuste manual de
  la vista previa también es por PDF, no por pack). Va tal cual en el único renglón.
- **La fusión se hace ANTES de guardar, en el importador — no en la matriz de la orden.** La matriz
  (`sincronizarMatriz`) impone que un color no aparezca dos veces en la misma orden, y es la misma que usa
  la captura manual: enseñarle a sumar renglones repetidos escondería un error de captura real. Quien sabe
  que esos renglones son packs del mismo color es el importador.
- **Una sola puerta, no tres.** La suma se hace en el único punto por donde la matriz de un PDF llega a la
  orden, así que cubre por igual los dos caminos: la propuesta automática de sobre-pedido **y** la matriz
  que el usuario editó a mano en la vista previa.
- **La misma talla escrita distinto ya no revienta la importación.** Si dos packs escriben `CH` y `ch`, al
  sumarlos caen en una sola celda. Sin eso, el renglón habría llevado la misma talla dos veces y la
  importación entera se habría abortado.
- **Ya no queda un color huérfano cuando un pack sale en cero.** *(La primera redacción de este punto
  describía el caso equivocado —"una orden que el usuario vacía entera"— y era falso: si se vacía toda
  la OC la matriz sale vacía y `salidaAProduccion` **aborta la transacción entera**, así que el color se
  revertía igual.)* El huérfano real venía de otro lado: `filasDesdePropuesta` puede producir **una fila
  toda en cero** —un grupo con `totalPacks = 0` en el cálculo de sobre-pedido— mientras las otras filas
  sí traen piezas. Ahí la transacción **sí comitea**, y el `resolverOCrearColor` que corría dentro del
  bucle dejaba el color creado y colgando. Ahora el color sólo se resuelve-o-crea si de verdad quedó
  corrida. ⚠️ **Este borde no está cubierto por pruebas** (exige un PDF con un grupo de 0 packs y
  ninguna lo construye): la guarda es correcta, pero no se presuma verificada.

- **Aplica en:** V1-E8g. **SIN migración de BD** (no se agregó ni una columna). **SIN permisos nuevos**
  ⇒ **NO requiere `SEED_ON_START`**. **Fecha:** 2026-08-27.

---

#### (Post-F9.130) — ⭐⭐⭐ EL AVISO YA SABÍA TODO Y NO DABA LA PUERTA: nace el botón «Corregir» (DANIEL, 27-ago-2026)

> ⚖️ **AJUSTE (28-ago-2026) — el punto 6 espera *«la palabra de Daniel»* para la reparación en bloque.
> Llegó, y la respuesta es que NO HACE FALTA:** *«Lo viejo ahorita es irrelevante… no importan ahorita
> las órdenes que ya hay»* (**§Post-F9.132**). ⇒ **La reparación en bloque de las órdenes viejas se
> CANCELA**; el botón «Corregir» de una orden a la vez se queda —sirve para lo que se capture de aquí
> en adelante— y el detector se vuelve **insumo del ETL del arranque**, no de una campaña de limpieza.
>
> 📐 **Y una corrección de ANCLA de esta misma entrada (28-ago):** más abajo el motor que normaliza la
> bandera al nacer la orden se nombra **`sembrarRecetaDeOrden`**, y **ese símbolo NO es el motor: es un
> helper de PRUEBAS** (`backend/src/pruebas/receta.ts`, sólo lo importan tests). El motor real es
> **`copiarRecetaDelModelo`** (`backend/src/dominio/produccion/receta-orden.ts`), donde
> `consumoPorTalla: porMedida.has(a.idAvio) ? false : a.consumoPorTalla` es la línea que apaga la
> contradicción — y por ahí pasan **tanto la captura normal como el ETL**. Lo que la entrada afirma
> sigue siendo cierto; el nombre con el que lo señalaba, no.


> *"Sigue estando mal lo de los cierres… me sigue multiplicando por las medidas… Y me sigue poniendo
> 53 mil cierres por comprar (orden 5562). ¿Debo de hacer un nuevo modelo desde el principio para que
> funcione bien? o sigue siendo algún tema de programación? **Siento que estamos atorados en lo mismo
> desde hace varias versiones. No podemos desatorarlo.**"* — Daniel, usando el sistema.

### Por qué llevábamos varias versiones atorados

**Porque se arreglaba el MOTOR y el DATO seguía congelado.** Son dos cosas distintas y las tres
correcciones anteriores (§Post-F9.66 · §Post-F9.105 y su remate) tocaron sólo la primera:

- El **motor está sano** desde el 18-ago-2026: cuando nace una orden, el sistema apaga solo la
  contradicción (`sembrarRecetaDeOrden`). ⇒ **una OP nueva sale bien, y salía bien ya entonces.**
- Pero **la receta de cada orden es una foto**, congelada el día que la orden nació — y eso es a
  propósito (es lo que permite que dos clientes del mismo modelo lleven cosas distintas). **Ninguna
  corrección del motor vuelve hacia atrás a tocar esas fotos**, y ninguna debía: son datos de órdenes
  vivas.
- ⇒ Daniel arreglaba el cálculo, abría la **misma orden vieja** (la 5562) y veía **el mismo número**.
  Desde su silla eso se lee como *"no lo arreglan"*; desde el código eran dos problemas, y sólo se
  había resuelto uno.

### 🔴 Y el defecto que quedaba no era el cálculo: era el REMEDIO

Al 27-ago el sistema ya hacía **todo** lo difícil, y aun así el usuario no podía avanzar:

1. **Detectaba** el renglón contradictorio (avío que se compra POR MEDIDA con *"se consume por talla"*
   encendido de una captura vieja).
2. **Sabía la magnitud**: cuánto pide hoy la orden y cuánto debería pedir.
3. Y cerraba el aviso con: **«Guarda el renglón para normalizarlo.»**

Eso es **un conjuro**. Daniel no es programador: *normalizar* no es una palabra del negocio ni el
rótulo de ningún botón, y «guardar el renglón» exige saber que cualquier guardado —el precio, el
proveedor— dispara por dentro una corrección invisible. **Un sistema que detecta el error, sabe la
solución y le pide al usuario que adivine el hechizo está PEOR que uno que no lo detecta**: le enseña
que hay algo roto y lo deja sin salida.

### Lo que se decide

1. **Un BOTÓN «Corregir», en el renglón, pegado al aviso.** No en un menú aparte, no en otra pantalla:
   donde se lee el problema. Apaga la bandera vieja — exactamente lo mismo que ya hacía el guardado,
   pero con nombre.
2. **El aviso se reescribe en lenguaje de negocio y ABRE por la cifra**: *«Esta orden pide 53,095 pza y
   deberían ser 3,200 pza: el requerido sale MULTIPLICADO por 16.6…»*. Antes abría con dos renglones de
   explicación técnica y el número quedaba sepultado en medio. Lo que Daniel necesita para decidir son
   los dos números.
3. **Sigue siendo un acto EXPLÍCITO de una persona (D3).** Lo que §Post-F9.66 decidió y **NO se
   revierte**: la bandera no se apaga sola al abrir la pantalla, porque *una lectura no cambia datos, y
   voltear el cálculo de una orden viva sin que nadie lo pida sería el cambio callado que D3 prohíbe*.
   Es un endpoint propio (`POST …/receta/renglones/avio/{id}/corregir`), con bitácora que guarda la foto
   íntegra de lo que había **y la magnitud** (qué pedía y qué pide).
4. **Corregir NO borra nada** (las cantidades por talla se quedan, sólo dejan de mandar), **NO toca** el
   consumo por prenda, el precio ni el amarre, y **NO marca el renglón como «ajustado»** — marcarlo
   apagaría para siempre los avisos de *"el modelo cambió"* de ese renglón, o sea que reparar un defecto
   nuestro le costaría al usuario una señal que sí necesita.
5. **SÍ tumba la firma de ESE renglón** (y sólo de ése): el requerido cambia —y mucho—, así que
   Desarrollo tiene que volver a mirarlo antes de que se compre. Hay que **volver a Liberar**.
6. **Se corrige UNA ORDEN A LA VEZ.** ⚠️ **No hay reparación en bloque, y es deliberado**: tocaría de un
   golpe los datos de muchas órdenes vivas —cambiando lo que compran— y ~~**eso necesita la palabra de
   Daniel, que todavía no está dada**~~ → 🔁 **CERRADA *NO* (28-ago-2026, §Post-F9.132): la reparación
   en bloque se CANCELA.** El **detector** (`migracion/analisis/avios-por-medida-
   contradictorios.ts`) ~~sigue siendo la lista de trabajo y el insumo para pedirle esa decisión con
   números~~ → pasa a ser **insumo del ETL del arranque** (§Post-F9.133).
7. **Ningún sitio vuelve a decir «guarda para normalizarlo».** El aviso de la explosión de materiales
   manda al botón por su nombre; el del BOM del modelo, a su propio «Guardar medida por talla».

### Lo que esto NO arregla (declarado, no enterrado)

- **Las órdenes viejas no se arreglan solas.** Cada una hay que corregirla, renglón por renglón, desde
  su receta. El botón hace el trabajo de un clic; el recorrido sigue siendo humano.
- **La habilitación/surtido sigue enseñando el mismo número inflado** mientras el renglón no se corrija
  (usa el mismo cálculo). Es la deuda que §Post-F9.105 ya había dejado con nombre.
- ⚖️ **Corregir NO toca la orden de compra que ya se autorizó**, y es un límite deliberado: la guarda de
  §Post-F9.79 existe para que nadie **vacíe** una compra comprometida (sólo se dispara si el requerido
  quedaría en CERO), **no para vigilar el exceso**. Bajar de 53,095 a 3,200 con una OC viva por 53,095
  pasa sin decir nada: la receta queda bien y **la OC hay que revisarla aparte**. Va escrito en el
  historial de versiones, porque es exactamente el caso de la orden que Daniel nombró.
- **Un renglón EXCLUIDO también ofrece el botón** aunque hoy no compre nada: puede revivir, y más vale
  que reviva ya sano. ⚠️ Pero **ahí el aviso no lleva cifras**: decir *"esta orden pide 53,095"* de un
  renglón que la orden **no pide** sería una afirmación falsa — y con un botón al lado, un clic que no
  cambia nada. Lo mismo con un renglón apagado para producción. *Un condicional que no aplica es ruido;
  un enunciado factual falso es el mecanismo por el que se deja de creerle al sistema.*

- **Aplica en:** V1-E8h. **SIN migración de BD** (no se agregó ni una columna). **SIN permisos nuevos**
  (reusa `desarrollo.administrar`, el mismo que ya exige editar la receta) ⇒ **NO requiere
  `SEED_ON_START`**. **Fecha:** 2026-08-27.

#### (Post-F9.131) — ⭐⭐ CAPTURAR EL AVANCE DE UN CLIC: «lo que falta por cortar» y «lo que se cortó» (DANIEL, 28-ago-2026)

> *"Sería muy bueno que tenga la opción de **marcar el corte como completo** (un botón que llene los
> campos de cada talla con las cantidades que se ordenaron) y **otro de entrega a maquila con la
> información exacta de lo que se cortó**."* — Daniel, capturando avances de producción.

**El problema, en corto.** Capturar un corte o un envío a maquila obliga a teclear **talla por talla**
lo que **casi siempre es exactamente lo esperado**: se corta lo que pide la orden, y se manda a maquila
lo que se cortó. Una orden con 6 tallas × 4 colores son 24 campos que se copian a mano de un papel al
que ya se le sacó la cuenta. Cada uno es una oportunidad de equivocarse, y el sistema **ya sabe** el
número correcto.

### Lo que se decidió

1. **Dos botones, uno por captura, pegados a la matriz que llenan.**
   - En el **corte**: **«Llenar con lo que falta por cortar»**.
   - En la **entrega a maquila** (y en la de arte/estampado): **«Llenar con lo que se cortó»**.

   Cada botón muestra **el total que va a poner** entre paréntesis —*«Llenar con lo que se cortó (240
   pza)»*— para que se vea el número **antes** de picarlo.

2. 🔴 **PRECARGAN, NO GUARDAN.** El botón **llena los campos** y ahí se detiene: quien captura revisa,
   ajusta lo que haya que ajustar y **después** da «Guardar movimiento», igual que siempre. Es un
   atajo de captura, **no** una acción que escriba sola en el sistema. Bajo el botón lo dice con todas
   sus letras: *"No guarda nada: revisa y ajusta antes de Guardar."*

3. **PISAN lo que ya esté capturado, no lo suman.** Si ya había cantidades tecleadas, el botón las
   reemplaza. **Por qué pisar y no sumar:** sumar haría que un segundo clic **duplicara** las cantidades
   en silencio y sin vuelta atrás; pisar es reversible —se vuelve a picar el botón y queda igual— y es
   lo que la etiqueta promete. Las celdas que el sistema no propone quedan **vacías**, no en su valor
   anterior: si no, un intento previo dejaría restos mezclados con la propuesta y el total ya no sería
   "lo que falta".

4. ⭐ **El botón del corte propone lo que FALTA, no lo ordenado a secas.** Daniel lo pidió como *"las
   cantidades que se ordenaron"*, y **en el caso normal es exactamente eso**: una orden que todavía no
   se corta tiene "lo que falta" = "lo que se ordenó". La diferencia sólo aparece cuando **ya se
   capturó un corte parcial**: ahí proponer de nuevo lo ordenado **duplicaría piezas**. Se propone el
   resto.

5. ⭐⭐ **El botón del envío propone lo cortado MENOS lo que ya se le envió a ese proceso** — el caso
   del **segundo envío parcial**. Es la trampa que este botón tenía que esquivar: el sistema **no deja**
   enviar a maquila más de lo cortado (regla vieja, decisión (g) de F3-E2), así que si de 100 cortadas
   ya se mandaron 60 y el botón precargara **100**, al dar Guardar el sistema lo **rechazaría** — y el
   usuario se comería el error con la matriz ya llena. **Un botón que produce un error no es un atajo,
   es una trampa.** Ahora propone **40**.

6. ⚠️ **Lo cortado NO es lo ordenado.** Cortar de más **sí se permite** (decisión (f) de F3-E2), así que
   una orden de 100 puede tener 104 cortadas. El botón del envío lee **lo realmente cortado** (104), no
   lo que pedía la orden. El botón del **corte**, en cambio, nunca propone cantidades **negativas**: si
   en una talla ya se cortó de más, esa talla simplemente no se propone (cortar de más se sigue
   pudiendo, tecleándolo a mano).

7. **Cuando no hay nada que precargar, el botón se ve APAGADO y con la razón al lado** — nunca mudo, y
   **la matriz sigue ahí para capturar a mano**. Las cuatro razones, en palabras de taller:
   - *"Esta orden no trae desglose por color y talla: no hay de dónde copiar cantidades."*
   - *"Ya está cortado todo lo que pide la orden. Si vas a cortar de más, tecléalo: se permite."*
   - *"Todavía no hay ningún corte capturado en esta orden, así que no hay nada que enviar."*
   - *"Todo lo cortado ya se le envió a este proceso: no queda nada por enviar."*

   Y si la consulta falla, lo dice (*"No se pudo consultar qué falta. Captura las cantidades a mano."*)
   con un **Reintentar** al lado. El atajo puede fallar; la captura no se bloquea nunca.

8. ⚠️ **En la entrega de PRENDAS YA TERMINADAS a un proceso de arte, el botón se APAGA** (y dice por
   qué). Ahí lo que se manda ya es producto terminado que sale del almacén, y el sistema exige **dos**
   cosas, no una: que no se mande más de lo cortado **y** que el almacén de verdad tenga esas prendas.
   El botón sólo sabe la primera, así que con 1,000 cortadas y 400 recibidas te ofrecería 1,000 y al
   guardar te rebotaría por existencia — *la misma trampa que este atajo vino a cerrar*. Ahí se captura
   a mano, con el aviso al lado: *"Estas prendas salen del almacén de producto terminado y hay que
   respetar lo que hay en existencia."* Que el botón también mire la existencia queda pendiente.

9. **Si un color o una talla se quitó de la orden DESPUÉS de cortarse, el botón no lo propone.** Esa
   celda ya no se dibuja en la pantalla de captura y el sistema la descarta al guardar: proponerla
   haría que el botón prometiera 240 piezas y se guardaran 200. Sólo se propone lo que se puede ver y
   capturar.

10. **El RECIBO de maquila NO lleva botón.** Su pendiente no es del proceso sino **de cada maquilero**
   (a quién se le entregó, cuánto debe), y eso ya se resuelve con el desglose por maquilero que la
   pantalla muestra desde el 28-jul-2026. Meter aquí un botón "por proceso" ofrecería a un maquilero
   piezas que tiene otro.

### Un defecto que se cazó al revisar: el botón repetía el número de la pantalla anterior

Si acababas de estar en el **corte** y abrías **Entrega a arte**, el botón salía encendido con la cifra
de *lo que falta por cortar* —no la de lo que se cortó— mientras el aviso de al lado te pedía elegir
primero el proceso. **El botón y su aviso se contradecían**, y al picarlo la tabla se llenaba con la
respuesta de otra pregunta. Corregido: el botón sólo se enciende cuando la consulta de **esa** pantalla
está de verdad viva. Es el mismo principio que gobierna toda esta etapa: **una cifra que el sistema
afirma tiene que ser verdad**, o no se dice.

### Un remate técnico que venía de antes

El número que el botón propone **lo calcula el servidor**, no la pantalla: *"cuánto se puede enviar
todavía"* **es** la regla del sobre-envío mirada del otro lado, y la misma regla escrita en dos lados
acaba derivando. Al hacerlo se encontró que la pantalla **ya estaba** re-derivando por su cuenta cuánto
se había cortado (restaba *pedido − lo que falta por cortar*) para poner los topes de la matriz en el
**primer** envío de un proceso. Ese cálculo se borró: ahora el servidor manda lo cortado ya sumado.

- **Aplica en:** V1-E8i. **SIN migración de BD** (no se agregó ni una columna). **SIN permisos nuevos**
  (la consulta reusa `produccion.wip-ver`, el mismo con el que ya se ve el panel de avance) ⇒ **NO
  requiere `SEED_ON_START`**. **Fecha:** 2026-08-28.

---

#### (Post-F9.132) — 🔴🔴 LO VIEJO NO SE REPARA: toda la limpieza se muda al ETL DEL ARRANQUE (DANIEL, 28-ago-2026)

**Cómo salió.** Tres correcciones seguidas de la jornada —los packs metidos dentro del color
(§Post-F9.129), el botón «Corregir» de los avíos por medida (§Post-F9.130) y las que se decidieron
hoy— dejaron abierta **la misma pregunta**: ¿y los datos que ya están capturados? Preguntado de frente
si había que repararlos, Daniel:

> *«Lo viejo ahorita es irrelevante. Acuérdate que vamos a importar de nuevo la información cuando
> vayamos a producción… no importan ahorita las órdenes que ya hay.»*

### Lo que se decide

1. **Las órdenes ya capturadas en `prueba` NO se reparan.** Ni a mano, ni con una migración, ni con una
   acción en bloque. Ningún arreglo del sistema tiene que volver hacia atrás a tocarlas.
2. **Por qué se sostiene.** `prueba` es un ambiente de **captura de práctica**: lo que hay ahí lo tecleó
   Daniel para probar el sistema, no para operar el negocio. El arranque de producción **vuelve a
   importar desde Access** (§Post-F9.24 — la ventana 2025–2026; §Post-F9.25 — el almacén de PT arranca
   de un conteo físico). Reparar hoy es trabajo que se tira el día del go-live.

### ⚠️ La consecuencia, que es lo IMPORTANTE de esta decisión

🔴 **Todo el peso de la limpieza se mueve al ETL del arranque.** Cada defecto que hoy se declara *"no se
repara hacia atrás"* **deja de ser deuda de un ambiente de pruebas y se vuelve REQUISITO del ETL de
go-live**. Si el ETL no lo trae resuelto, el sistema **arranca en producción con exactamente la basura
que hoy estamos llamando irrelevante** — y ese día ya no será irrelevante: serán las órdenes con las que
se compra y se corta.

**La lista viva de lo que el ETL tiene que traer resuelto** (se le agrega cada vez que se decida "sólo
hacia adelante"):

| Defecto declarado "sólo hacia adelante" | Dónde se decidió | Qué debe hacer el ETL |
|---|---|---|
| El pack metido dentro del nombre del color (`Negro A` / `Negro B`) | §Post-F9.129 · §Post-F9.10 | Fusionarlos en un solo color — **§Post-F9.133**, con su censo previo |
| Renglones de avío *"se compra por medida"* + *"se consume por talla"* que inflan el requerido | §Post-F9.130 punto 6 | ✅ **YA LO HACE — verificado en el código, 28-ago.** El ETL crea sus órdenes por la MISMA puerta que la captura normal (**`backend/src/dominio/produccion/migracion.ts`** llama a **`copiarRecetaDelModelo`**), y esa función apaga la bandera contradictoria al copiar la receta a la orden. ⚠️ **Pero sólo la limpia en la ORDEN:** el BOM del modelo se queda con la contradicción, y ahí se arregla a mano (§Post-F9.130 punto 7). Confirmarlo con una corrida real, no darlo por hecho. |

3. **Lo que esta decisión NO autoriza.** No baja el listón de lo que se construye **hacia adelante**: una
   orden nueva sigue teniendo que nacer bien. *"Lo viejo es irrelevante"* justifica **no reparar**, nunca
   **dejar de arreglar el motor**.
4. ⚠️ **Y tiene fecha de caducidad.** Es cierto **mientras** lo capturado en `prueba` sea práctica. El día
   que Daniel capture ahí algo que quiera conservar —o el día del go-live, lo que llegue primero— esta
   decisión deja de aplicar y hay que volver a preguntarle. **No es una regla permanente: es un permiso
   con fecha.**

- **Aplica en:** el ETL de F10 (go-live) y toda etapa que decida corregir "sólo hacia adelante". **Hoy no
  se construye código por esta decisión** — lo que hace es **mover un requisito de sitio**. **Fecha:**
  2026-08-28.

---

#### (Post-F9.133) — 🔴 EL ETL DE ACCESS TAMBIÉN JUNTA LOS PACKS: `Negro A` y `Negro B` entran como UN solo `Negro` (DANIEL, 28-ago-2026)

**Cómo salió.** Daniel lo marcó él mismo con la palabra *«Importante»*, justo después de aceptar que las
órdenes viejas de `prueba` no se reparan (§Post-F9.132):

> *«Importante. Pero sí toma en cuenta lo de los colores y packs para las órdenes nuevas que importemos
> de Access y también de las nuevas OP. Un color Negro A y un Negro B de la misma orden, es el mismo
> modelo, es un solo negro. Por eso el pack debe de ir en otro campo y de esa manera no duplicamos
> colores.»*

**Lo que dice, en corto:** la regla de §Post-F9.129 **no es una regla del importador de PDF**. Es una
regla del sistema, y tiene **tres puertas**: el importador de PDF (✅ hecha), **el ETL de Access**
(⏳ ésta) y **la captura manual de una OP nueva** (⏳, es la segunda mitad de §Post-F9.10: el pack como
campo propio). Cerrar sólo la primera dejaba el catálogo limpiándose por delante y ensuciándose por
detrás el día del arranque.

### Lo que se midió (28-ago-2026) — el ETL no sabe nada de packs

- `migracion/loaders/ordenes.ts` → `cargarOrdenes` llama a **`precrearColores`**, que resuelve-o-crea
  **un color por cada texto distinto** de la columna `Color` de `OrdenesDet.csv`, normalizado con
  **`normalizarClaveColor`** (`migracion/comun/tallas-orden.ts`), que sólo baja mayúsculas, quita
  acentos y colapsa espacios. ⇒ **`NEGRO A` y `NEGRO B` son dos claves distintas y se crean al vuelo,
  como dos colores de catálogo.**
- **No hay una sola línea de lógica de packs en el loader.** No es que esté mal escrita: **no existe**.
- ⭐ **Lo que YA existe es la SUMA, no la regla.** `fusionarPacksEnUnaCorrida`
  (`backend/src/dominio/pedidos/fusion-packs-cya.ts`, de §Post-F9.129) hace **exactamente una cosa**:
  suma talla por talla varios renglones-pack en una sola corrida. **No sabe qué es un pack** —recibe
  `RenglonPackCya[]` con la letra **ya resuelta por el parser del PDF**— y **devuelve UNA sola corrida
  a propósito**, porque cada PDF de C&A es UNA OC con UN color genérico. ⚠️ **Una orden de Access trae
  MUCHOS colores**, así que el ETL no puede llamarla y ya: tiene que **agrupar primero por color base**
  y usarla para sumar cada grupo.
- 🔴 **Dónde está el riesgo real de dos implementaciones: en la REGLA, no en la suma.** *"Qué es un
  pack"* hoy **sólo vive en el parser del PDF de C&A**. El ETL la necesita, y la **captura manual de
  OP** también (segunda mitad de §Post-F9.10). **Hay que escribirla UNA vez y compartirla entre los
  tres**; si cada puerta se hace la suya, los colores se vuelven a separar dentro de un año y nadie
  sabrá cuál de las tres tenía razón.

### 🔴 Por qué NO se escribió la regla hoy: una regla ciega es peligrosa

**Falta ver los nombres REALES del volcado.** Los CSV viven en `Respaldo CLAUDE/TABLAS/` (**CP850**, ver
CLAUDE.md §4) y **no están en el contenedor donde se trabajó** (verificado: la carpeta no existe ahí).
Sin ese censo, cualquier regla se escribe a ciegas.

⚠️ **Y el riesgo es real, no teórico:** la regla obvia —*"colapsa todo lo que termine en una letra
suelta"*— **fusionaría colores legítimamente distintos**. Un `AZUL M` puede ser "azul marino" abreviado y
no el pack M de un azul; veinte años de captura libre producen nombres que ningún patrón adivina. **Y
fusionar dos colores que no eran el mismo no se nota**: se descubre meses después, cuando el inventario
de producto terminado suma peras con manzanas.

### Cómo se propone construirlo (a confirmar contra el censo, antes de escribir código)

1. **Fusionar sólo DENTRO DE LA MISMA ORDEN**, nunca como un reemplazo global del catálogo. Es
   literalmente la condición que Daniel puso: *"un color Negro A y un Negro B **de la misma orden**"*.
   Dos o más renglones de una misma orden cuya **base coincide** y que difieren **sólo** en un sufijo de
   una letra ⇒ son packs, se suman talla por talla.
2. **Un `NEGRO A` solitario —sin hermano en su orden— NO se toca: se LISTA.** Ahí no hay evidencia de que
   la letra sea un pack, y una fusión a solas es indistinguible de renombrar un color de verdad.
3. **Todo lo que se fusione va al reporte de cuadre, orden por orden.** Es la regla §7 del ETL de este
   proyecto —*nada se pierde en silencio*— y aquí manda doble: es la única forma de que Daniel pueda
   revisar si alguna fusión estuvo mal **antes** de operar sobre ella.
4. **Primero se cuenta, luego se fusiona.** Una pasada de sólo lectura sobre el volcado que diga cuántos
   colores traen sufijo de letra, cuántos tienen hermanos en su orden y cuántos están solos. Ese conteo
   es lo que convierte esta decisión en construible.

- **Aplica en:** el ETL de F10 (`migracion/loaders/ordenes.ts`) y, por separado, la captura manual de OP
  (segunda mitad de §Post-F9.10). **Pendiente de construir**; el censo del volcado es su
  prerrequisito. **Fecha:** 2026-08-28.

---

#### (Post-F9.134) — 🔴 EL MODELO SIEMPRE NACE EN DESARROLLO — y el catálogo escondía justo lo que acababas de crear (DANIEL, 28-ago-2026)

**Cómo salió.** Daniel, usando el sistema:

> *«Generé dos modelos en precosteo… y no los veo en modelos. ¿Dónde lo edito?»*

Y razonando en voz alta sobre el orden de las cosas:

> *«Si me voy en orden, primero está el modelo y luego el precosteo. Creo que no está bien. **Siempre se
> va a empezar creando un modelo de desarrollo**… el modelo de producción podríamos hacerlo en la parte
> de producción, a la hora de dar de alta las órdenes de producción.»*

**La causa, medida — son DOS cosas que se juntan, y por separado ninguna se ve mal:**

1. Un modelo creado desde Desarrollo **nace marcado como `desarrollo`**:
   `crearDesarrolloConModeloNuevo` (`backend/src/dominio/desarrollo/desarrollos.ts`) llama a
   `crearModelo` y **enseguida le pone `origen: 'desarrollo'`**.
2. El listado de modelos **arranca filtrado a producción**: el esquema de filtros
   `esquemaListarModelosDominio` (`backend/src/dominio/modelos/modelos.ts`) trae
   `origen: z.enum(['produccion','desarrollo','todos']).default('produccion')`.

⇒ **La pantalla le esconde por defecto exactamente lo que acaba de crear.** Cada mitad tiene su razón
—la de arriba viene de §Post-F9.34 punto 2, *"no quiero llenar de basura el catálogo"*— y juntas
producen un sistema que se traga el trabajo del usuario sin decir nada. **Un filtro que oculta lo
recién creado no se lee como un filtro: se lee como que no se guardó.**

### Lo que se decide

1. **El default del filtro de origen pasa a `todos`, con la ETAPA visible en cada renglón.** El motivo de
   §Post-F9.34 sigue siendo válido —no llenar el catálogo de desarrollos que nunca salen— pero **se
   sirve mejor con una columna que dice qué es cada renglón que escondiendo la mitad**. El filtro
   sigue ahí para quien quiera ver sólo producción. *(La mitad visual **ya existe**: el renglón pinta
   un chip «Desarrollo» —`ModelosPagina.tsx`—; lo que hay que cambiar es el default, no inventar la
   columna.)*

   🔴 **EL DEFAULT VIVE EN CUATRO SITIOS, Y CAMBIAR UNO SOLO NO CAMBIA NADA.** Medido el 28-ago:

   | # | Dónde | Qué es |
   |---|---|---|
   | 1 | `backend/src/dominio/modelos/modelos.ts` (`esquemaListarModelosDominio`) | el default del dominio |
   | 2 | `backend/src/contrato/esquemas/modelo.ts` (`esquemaModelosQuery`, que es donde vive el `.default()`; `esquemaFiltroOrigenModelo` es sólo el enum y NO lleva default) | el default del contrato/OpenAPI |
   | 3 | `frontend/src/modulos/modelos/ModelosPagina.tsx` | `useState('produccion')` del listado |
   | 4 | `frontend/src/modulos/modelos/GaleriaModelos.tsx` | `useState('produccion')` de la galería |

   ⚠️ **Y el que manda es el frontend, no el backend:** la pantalla envía `origen` **explícito** en cada
   consulta (hay una prueba que lo fija: *"el valor concreto importa: con 'todos' (o sin el campo) la
   vitrina traería los desarrollos"*, `ModelosPagina.test.tsx`). ⇒ **Tocar sólo el dominio no arregla
   nada de lo que Daniel reportó.** Es «todas las puertas o ninguna» (§Post-F9.116(d)) aplicado al
   filtro: **se cambian los cuatro, o no se cambia**.

   📌 **Y la prueba que fija el default hay que VOLTEARLA con él** —`ModelosPagina.test.tsx`, *"el
   catálogo pide SOLO producción por default"*—: **se va a poner en rojo, y eso es lo correcto, no algo
   que se rompió.** Se invierte con su rastro dentro (por qué el sistema llegó a ese estado), como se
   hizo en §Post-F9.123 con la prueba que afirmaba lo contrario sobre Aurora.

   ⚠️ **El costo, aceptado de frente:** la lista se hace más larga y trae modelos que quizá nunca se
   fabriquen. Se prefiere **ver de más a no encontrar lo que uno acaba de hacer**.
2. **Se retira el alta directa de modelo de PRODUCCIÓN.** Hoy `crearModelo`
   (`backend/src/dominio/modelos/modelos.ts`) crea el modelo **en producción** —es el default de la
   columna— y le deriva su nº de producción del código. Esa puerta se cierra: **el catálogo de
   producción se llena por la acción «pasar a producción»**, no por un alta suelta. Daniel:

   > *«Creo que nunca va a pasar que dé de alta un modelo de producción si no tiene ya una orden
   > asignada. No tendría sentido poner ahí una puerta. Mejor siempre desde producción.»*

   ⚠️ **Lectura del lead sobre la última frase, que hay que confirmar con Daniel:** *"mejor siempre
   desde producción"* se entiende como **"que llegue a producción siempre por la puerta de «pasar a
   producción»"**, es decir, naciendo en desarrollo y promoviéndose —que es lo que el resto del párrafo
   dice y lo que §Post-F9.34 punto 4 ya construyó—. Se deja **textual y señalado** en vez de suavizado,
   porque leída al pie de la letra la frase dice lo contrario del resto y **no es honesto corregirle las
   palabras a Daniel dentro de una comilla**.

3. **Por qué cerrar la puerta y no dejarla "por si acaso".** Un modelo que nace directo en producción
   **se salta todo lo que Desarrollo pone antes**: precosteo, receta revisada, aprobación del precio,
   linaje de versiones. Mientras exista el atajo, algún día se usará —y el modelo que llegue por ahí no
   tendrá con qué costearse.

4. **La GALERÍA va incluida, no es un caso aparte.** §Post-F9.34 punto 2 hablaba del *"catálogo **y la
   galería**"*, y `GaleriaModelos.tsx` tiene **el mismo `useState('produccion')`** y por tanto **el
   mismo defecto**: un modelo recién creado en Desarrollo tampoco aparece ahí. Cambia igual, por la
   misma razón. *(Sin esto, el banner de sustitución de §Post-F9.34 estaría prometiendo más de lo que
   esta decisión entrega.)*

### Lo que se construyó (V1-E8j, 28-ago-2026)

**A) Se cerraron las CUATRO puertas del punto 1** —la tabla de arriba las nombra, y ésa es la lista
buena; repetirla aquí sólo invitaba a que las dos derivaran—. **La galería entre ellas**, tal como manda
el punto 4: no es un caso aparte, es el mismo `useState('produccion')` y el mismo defecto, y
§Post-F9.34 punto 2 hablaba del *«catálogo **y la galería»***. Lo que la construcción confirmó midiendo:
**el frontend manda `origen` explícito en la query**, así que cambiar sólo el esquema del dominio no
habría movido nada de lo que Daniel reportó — «todas las puertas o ninguna» (§Post-F9.116(d)).

**Cada puerta quedó con una prueba que la mata.** Las que sostienen la etapa **no se conforman con leer
el default del esquema** —eso pasaría verde con el defecto vivo en la pantalla, que era el defecto
real—: miden que, **con la pantalla recién abierta y sin tocar un filtro, un modelo de DESARROLLO esté
en la lista** (las dos de pantalla) y que el listado **traiga de verdad** el modelo recién creado (las
dos del servidor, `nomenclatura.int.test.ts` y `modelos.int.test.ts`, contra Postgres). Aparte, un
unitario —`dominio/modelos/filtro-origen.test.ts`— duplica las dos del servidor **sin base de datos**:
la del dominio con un Prisma falso que captura el `where` (comprueba que `origen` va **ausente**), y la
del contrato sí sobre la querystring, que ahí **es** la puerta. Así ninguna queda sin candado en una
máquina sin Postgres.

**B) La ETAPA, dicha en cada renglón.** Columna **Etapa** en la tabla del catálogo (chip *Desarrollo* /
*Producción*), el mismo chip en la tarjeta de móvil, y un chip *Desarrollo* en la tarjeta de la galería
(ahí producción no lleva chip: es el caso normal y la vitrina no lo repite). El chip suelto que colgaba
del nombre se retiró: decirlo dos veces en el mismo renglón sólo le comía ancho al nombre.

**C) `crearModelo` ya no fabrica modelos de producción.** El modelo nace con `origen: 'desarrollo'`,
`numeroProduccion: null` y `codigoDesarrollo = codigo` —el código vigente y el de desarrollo valen lo
mismo mientras vive ahí (§Post-F9.34 punto 5), así que el código tecleado **se conserva y sigue
buscable** cuando la promoción lo sustituya por el número (D3)—. El alta lo dice de frente: *"Nace en
DESARROLLO: su número de producción se le asigna al pasarlo a producción"*. En `desarrollos.ts` se
**borró** el `update` que ponía `origen`/`codigoDesarrollo` aparte: ahora lo hace `crearModelo` y
escribirlo dos veces sólo invitaba a que los dos lados derivaran.

**D) El cabo suelto se cerró solo, como se esperaba.** `proponerNumeroProduccion` ya alimentaba los DOS
puntos donde se captura el número —el diálogo «Pasar a producción» y el panel «Generar OP»—, que llegan
**precargados** con el hueco libre y son editables (§Post-F9.46). El único sitio que hacía teclear un
número a pelo era el alta directa; cerrada ésa, **no queda ningún lugar donde se capture un nº de
producción sin propuesta**.

**E) Tres cosas que se revisaron ANTES de cerrar la puerta, y una que no se tocó:**

- 🔴 **El ETL del histórico SÍ dependía de esa puerta.** `backend/migracion/loaders/modelos.ts` carga los
  ~4,987 modelos del Access llamando a `crearModelo` (regla A1: nunca `prisma.create` del catálogo), y
  ésos **son de producción y no tienen orden**: su código de 5 dígitos *es* su nº de producción. Con la
  puerta cerrada habrían quedado todos marcados como desarrollo, con un nº de desarrollo inventado y sin
  poblar `numeroProduccion` —o sea, el generador del consecutivo habría dejado de ver ocupadas las
  series reales—. Se resolvió con el patrón que el proyecto ya usa en órdenes, compras, notas,
  inventarios, RC y terceros: un **modo migración dedicado**,
  `crearModeloMigrado` (`backend/src/dominio/modelos/migracion.ts`). ⚠️ **No llama a `crearModelo`:**
  los dos comparten `crearModeloNucleo` y la marca de nomenclatura viaja en el propio `create` (ver
  «El remate…» más abajo, que es donde quedó explicado el diseño final). El servicio normal queda
  **sin banderas de migración** y el modo migración **no se expone en ninguna ruta REST**.
- **El `@default(produccion)` de la columna `Modelo.origen` NO se cambió, y se documentó por qué.** El
  dominio escribe `origen` siempre explícito, así que ese default sólo lo alcanzan las escrituras crudas
  (`prisma.modelo.create`) que viven en las fixtures de pruebas y del ETL — donde el modelo sembrado es
  justamente uno de producción ya existente. Cambiarlo exigiría una migración y voltearía en silencio el
  significado de esas fixtures, a cambio de nada.
- **Renombrar un modelo de desarrollo ahora arrastra su nº de desarrollo.** Era un defecto latente
  (`codigoDesarrollo` se quedaba con el valor viejo y el modelo terminaba con dos códigos buscables y
  sólo uno visible) que era raro mientras el catálogo creaba modelos de producción, y con esta decisión
  pasa a ser el caso normal. Se arregló en la misma ronda.
- ❌ **NO se tocó el límite 1:1** (`Modelo.codigoDesarrollo @unique` / `numeroProduccion @unique`): que de
  un desarrollo nazcan VARIOS de producción con una sola receta es **§Post-F9.135**, otra pieza.
  *(Decía «con estructura por diseñar»; ese mismo día, más tarde, **V1-E8n** la diseñó y la escribió — el
  plan es la sección «⭐ EL PLAN» de §Post-F9.135. Sigue **sin construirse**, y el límite 1:1 sigue
  intacto.)*

🔴 **Y la lección de la ronda de corrección, que vale más que el arreglo:** toda la etapa se blindó
puerta por puerta y **el cambio del ETL —el único cuyo fallo es irreversible y masivo, los 4,987 modelos
históricos— se quedó sin una sola prueba**. Se demostró revirtiendo el loader a su versión anterior:
**typecheck, lint y las 221 pruebas seguían en VERDE**, porque el único test que lo ejercita afirmaba
**conteos** —y los conteos no cambian: los modelos se crean igual, sólo que marcados como desarrollo,
con un nº de desarrollo inventado y sin nº de producción—. *No bastaba con decir «lo juzga el CI»: el CI
tampoco lo juzgaba.* Se cerró con una prueba que afirma el **estado de las tres columnas** (y un fixture
con código de 5 dígitos, porque los que había eran todos no numéricos y la derivación del número no la
ejercitaba nadie), **vista morir** con el loader revertido y verde con el arreglo. **Un conteo que no se
mueve no es un candado.**

⚠️ **El costo nuevo, dicho de frente:** un modelo dado de alta en el catálogo **sin tipo de prenda y sin
género** no se puede promover —`digitosDelModelo` no tiene de dónde sacar sus dos dígitos y lo dice
pidiendo justo eso—. Antes daba igual porque nacía en producción. No se hicieron obligatorios esos dos
campos (el ETL carga sin ellos, y volverlos obligatorios es una decisión de negocio); en su lugar, el
alta lo pide en su aviso.

❓ **PREGUNTA ABIERTA PARA DANIEL, con su default propuesto:** *¿se vuelven OBLIGATORIOS el tipo de
prenda y el género al dar de alta un modelo en el catálogo?* **Default propuesto: SÍ.** Son los dos
dígitos con los que el sistema le arma su número; un modelo sin ellos se queda a medio camino y el error
sólo aparece más tarde, al querer generar su OP. Hoy quedan opcionales porque el ETL del histórico carga
sin ellos —pero ese camino ya va por su modo migración, así que la excepción no obliga a nada—.

⚠️ **Y una consecuencia que hay que saber, porque cambia lo que se ve:** al generar la OP de un modelo
recién dado de alta, **el modelo cambia de código** (pasa de `ORD-1234` al nº de 5 dígitos que le toque).
Es exactamente lo que Daniel pidió —*"el modelo de producción a la hora de dar de alta las órdenes"*—, el
código viejo se conserva como nº de desarrollo y sigue buscable (D3), y el aviso del sistema lo dice:
*"modelo de producción 71001 (antes ORD-1234, que se conserva)"*. Esta onda expansiva sólo se vio al
barrer los e2e: dos specs daban de alta su modelo sin los dos dígitos y le generaban la OP enseguida —lo
que antes no promovía nada— y habrían salido rojos. Se arreglaron capturando los dígitos, que es lo que
un usuario tendría que hacer. ⚠️ **Pero ese barrido se quedó corto y el CI lo demostró:** los DOS
importadores también terminan generando OP, por otra puerta, y ahí el usuario **no puede** capturar
nada en medio del asistente — de ahí que la solución acabara siendo cerrar el hueco **en el alta**
(ver el remate de abajo), no pedirle nada al importador.

### El remate que destapó el CI: los dos dígitos pasan a ser OBLIGATORIOS en el alta

Cerrar el alta directa dejó un hueco que **sólo apareció en el CI**: un modelo del catálogo **sin tipo
de prenda ni género no se puede numerar**, y al generar su OP el sistema lanzaba *«falta capturar el
tipo de producto del modelo y el género»*. Eso **rompía la importación de la OC del cliente** —el flujo
diario— porque `confirmarImportacion` es UNA transacción: se caía **el pedido y todas las OP del
archivo**, no sólo el modelo problemático. *(Medido contra Postgres: 0 órdenes creadas; no supuesto.)*

**Se decide: tipo de prenda y género son OBLIGATORIOS al dar de alta un modelo en el catálogo.**

> ⚠️ **Ejecutado sobre el DEFAULT PROPUESTO a Daniel, pendiente de que lo ratifique.** La pregunta se
> le planteó la noche del 28-ago —*«¿tipo de prenda y género pasan a ser obligatorios al dar de alta un
> modelo?»*, con **default propuesto: sí**— y no la objetó antes de dormirse, dejando instrucción de
> seguir. Si al despertar dice otra cosa, **se revierte** — cómo, justo abajo.

**Cómo se revierte, si Daniel los quiere opcionales.** ⚠️ **No es «un renglón»** —así se escribió las
dos primeras veces y las dos fue **falso**—. Son **OCHO** puntos, y esta lista **se ejecutó entera
antes de escribirse**: aplicándola, `npm run typecheck` sale **0 en los dos lados** (con siete todavía
no).

1. `contrato/esquemas/modelo.ts` → `esquemaModeloCrear`: los dos ids vuelven a `.optional()`.
2. `dominio/modelos/modelos.ts` → quitar la llamada `exigirDigitosDeNomenclatura(...)` de
   `crearModelo` (si no, no compila: los ids pasan a `number | undefined`).
3. `dominio/modelos/modelos.ts` → quitar la llamada `exigirNoDesnumerar(...)` de `actualizarModelo`.
4. `dominio/modelos/modelos.ts` → **borrar las dos funciones**, no sólo sus llamadas: sin llamador
   quedan muertas y `noUnusedLocals` tumba el typecheck (`TS6133`). De paso quedan un `{@link}`
   colgando y un párrafo `⭐` describiendo una regla que ya no existiría.
5. `frontend/.../esquemas.ts` → `esquemaModeloFormularioAlta` deja de extender con los `.min(1)`.
6. `DialogoModelo.tsx` → `exigeNomenclatura` a `false`, el `resolver` a `esquemaModeloFormulario`, y
   en `aCuerpoCrear` **quitar el `?? 0`** y volver a omitir los ids vacíos. *(Sin esto un alta sin
   género mandaría `idGenero: 0` y el servidor la rechazaría con «debe ser positivo»: reversa
   aplicada al pie de la letra, producto roto.)*
7. `DialogoModelo.tsx` → **borrar el `import` de `esquemaModeloFormularioAlta`**, que queda sin uso
   (`TS6133` otra vez — el mismo error del punto 4, un nivel más arriba).
8. 🔴 **REGENERAR EL CONTRATO**: `npm run openapi` (backend) + `npm run gen:api` (frontend). Sin
   esto, `ModeloCrear` sigue exigiendo los dos ids y **el punto 6 no puede compilar**. Es §7.6 del
   `CLAUDE.md`, pero una lista cuyo argumento es *«se verificó aplicándola»* no puede dejarlo
   implícito.

Y **SEIS pruebas** afirman la regla y hay que voltearlas con ella. En `modelos.int.test.ts`: *«sin tipo
de prenda o sin género, el alta se RECHAZA (400)»* · *«a un modelo de DESARROLLO no se le pueden quitar
los dos dígitos…»* · sus dos gemelas de dígito sin capturar · *«R4-H1: no se versiona un modelo al que
le falta un dígito»*. Y en `DialogoModelo.test.tsx`: *«sin tipo de prenda ni género NO envía el alta…»*.
Más el bloque `esquemaModeloCrearMigracion` del contrato. *(La versión anterior decía «tres» y nombraba
cinco — el nit que cazó el reviewer.)*

**Por qué ésta y no la otra salida.** La alternativa era *no bloquear la OP: promover «si se puede» y
avisar*. Se descartó porque **degrada el punto 4 de §Post-F9.34** de *«generar la OP promueve el
modelo»* a *«promueve si puede»*, y deja **modelos con OP viviendo en desarrollo** — un estado a medias
que nadie pidió y que después hay que explicar.

**Y no inventa una regla:** el alta de **Desarrollo ya exigía las dos cosas**, con el mismo criterio
(que el catálogo tenga el dígito capturado, no sólo que se haya elegido algo). Esto **alinea la segunda
puerta con la primera** — el hueco nació porque V1-E8j abrió un segundo camino hacia «desarrollo» que se
saltaba esa exigencia.

**Lo que ve Daniel:** en «Nuevo modelo» los dos selectores llevan asterisco, dicen *«Primer dígito del
número del modelo»* / *«Segundo dígito…»*, y el aviso del alta lo explica en una frase: *"son los dos
primeros dígitos de ese número: sin ellos no se le puede generar la orden de producción"*.
⚠️ **En la EDICIÓN siguen siendo opcionales PARA LOS MODELOS DE PRODUCCIÓN** —los ~4,987
migrados del Access, que no traen género y cuya ficha quedaría bloqueada para corregir cualquier
otra cosa—; **a uno de DESARROLLO no se le pueden quitar** (`exigirNoDesnumerar`): lo dejaría tan
innumerable como crearlo sin ellos.

**Y el ETL sigue cargando sin ellos.** La regla vive en **UNA sola capa**: `crearModelo`. El modo
migración (`crearModeloMigrado`) **no pasa por ahí** — los dos comparten `crearModeloNucleo`, que hace
lo común y recibe la nomenclatura ya decidida, y la exigencia queda **por encima** del núcleo. Así la
migración entra por debajo sin banderas y sin que nadie tenga que acordarse de excluirla.

- **Aplica en:** el módulo de Modelos —**listado Y galería**— más el alta, y Desarrollo. Son los
  **cuatro sitios del default** de la tabla de arriba. **CONSTRUIDA en V1-E8j (28-ago-2026)**:
  **SIN migración de BD** (no se agregó ni cambió una columna) y **SIN permisos nuevos** ⇒ **NO
  requiere `SEED_ON_START`**. **Fecha:** 2026-08-28.

---

#### (Post-F9.135) — 🔴🔴 DE UN MODELO DE DESARROLLO NACEN VARIOS DE PRODUCCIÓN (1:N), CON UNA SOLA RECETA (DANIEL, 28-ago-2026)

**Cómo salió.** Es el dato que le faltaba al sistema entero, y salió de una frase suelta:

> *«De un modelo de desarrollo pueden nacer 4 modelos de producción… y los 4 tendrían la misma receta
> (es el mismo modelo en distintos colores).»*

**Por qué son cuatro modelos y no uno con cuatro colores** —preguntado exactamente eso—:

> *«Es el mismo modelo en diferentes colores. Pero los manejamos con diferentes modelos porque cada uno
> tiene una OC del cliente distinta. Me dan 4 pedidos diferentes, uno por color.»*

**Y el argumento que cerró la discusión, que es suyo:**

> *«Al final esos modelos tendrían que estar en un catálogo, porque a partir de la OP, los modelos de
> producción son los que se van a inventariar. Los de desarrollo son sólo de desarrollo, esos no llevan
> inventarios.»*

⇒ **La línea queda trazada por el INVENTARIO:** el modelo de producción es la cosa que se cuenta en el
anaquel; el de desarrollo es un expediente de trabajo. Por eso los cuatro tienen que existir como
modelos de verdad, no como una etiqueta o un atributo de la orden.

### Lo que se decide

1. **La relación desarrollo → producción es 1:N.** Un modelo de desarrollo puede promover **varios**
   modelos de producción, cada uno con su número de 5 dígitos y su OC del cliente.
2. **⭐ UNA SOLA RECETA, COMPARTIDA — no copias.** Es requisito literal de Daniel:

   > *«Todos los modelos deben de llevar lo mismo. ¿Cómo lo controlas?»*

   **Por eso compartida y no copiada:** con cuatro copias no se *controla* que lleven lo mismo, se
   *vigila* — y vigilar depende de que alguien se acuerde de replicar cada cambio en las otras tres.
   **Una sola receta hace de la igualdad una propiedad estructural en vez de una disciplina.** La
   pregunta de Daniel no era retórica: era la especificación.
3. **Si el modelo cambia después de que ya hay OP, se ofrece corregir las órdenes que dependen de él —
   todas de un golpe.**

   > *«Si se modifica el modelo después de tener la OP ya hecha, que dé la opción de corregir las
   > órdenes que dependan de ese modelo. Y que sean todas al mismo tiempo.»*

   🔴 **Y aquí va el candado, porque la acción en bloque es la parte peligrosa:** algunas de esas órdenes
   **ya compraron material o ya se cortaron**. La regla es **aplicar donde se puede, SALTAR Y REPORTAR
   donde no**:
   - **Nunca abortar el lote entero** porque una orden no se dejó (eso convierte una acción útil en una
     que nunca funciona cuando más se necesita).
   - **Nunca saltar en silencio** (eso es peor: el usuario cree que corrigió las cuatro y corrigió dos).
   - **Bitácora POR ORDEN, no del lote.** Un solo asiento *"se corrigieron 4 órdenes"* no sirve para
     nada seis meses después; lo que se audita es qué le pasó **a la orden 5562**.

### ⚠️ Tres correcciones del lead, escritas con su nombre — valen más que la conclusión

**(a) «Ya está unificado, no hay que unificar nada» — CIERTO DEL CÓDIGO, FALSO COMO CONCLUSIÓN.**
El lead afirmó eso apoyado en §Post-F9.34 punto 1 (*"NO se separa la tabla `Modelo`"*), que es verdad:
desarrollo y producción **son la misma entidad** con una marca de origen. Pero la afirmación **suponía
1:1** —un desarrollo, un modelo de producción, el mismo registro promovido—. Con 1:N la promoción deja
de ser *"cambiarle la marca al registro"* y pasa a ser *"crear N registros que comparten una receta"*.
**El código estaba bien; el modelo mental estaba mal**, y ésa es la clase de error que ninguna revisión
técnica encuentra.

**(b) El número corto como ATRIBUTO DE LA ORDEN — DESCARTADO POR MEDICIÓN.**
El lead propuso no crear cuatro modelos y guardar el número de producción como un dato de la orden. Se
midió `prisma/schema.prisma`, **`model MovimientoDetPt`** (el detalle del kardex de producto
terminado): la llave del inventario PT es **`idModelo` + `idColor` + `idTalla`** (más `idOrden` y el
almacén desde F6-E2 / ADR-0014). **`idModelo` es OBLIGATORIO**: es el modelo, y sólo el modelo, lo que
identifica la prenda contada en el anaquel. Con el número corto colgado de la orden, **la existencia
habría quedado colgando del modelo de DESARROLLO** — justo el que Daniel dice que *"no lleva
inventarios"*. La propuesta no era discutible por gusto: la contradecía el esquema.

> 📐 **Precisión sobre `idOrden`, para que nadie la repita mal:** es **nullable**, pero **no es "sólo de
> rastreo"** — desde F6-E2 **forma parte de la llave de existencia** (modelo×color×talla×orden×almacén,
> con el NULL casado por `IS NOT DISTINCT FROM`). Nullable porque el histórico migrado y los
> movimientos manuales no traen orden. Lo que sostiene el argumento de arriba es que **`idModelo` no es
> nullable**, no que `idOrden` sea decorativo.

**(c) «Primero copien la receta» — RECTIFICADO MIDIENDO, en la misma conversación.**
El lead recomendó de entrada **copiar** la receta a cada modelo de producción, por miedo a que compartir
una receta viva expusiera órdenes ya lanzadas a cambios de última hora. Al medirlo, el miedo resultó
infundado: **compras, costos y producción NO leen el BOM del modelo — leen la receta CONGELADA DE LA
ORDEN** (V1-E3d). La receta se copia a la orden al nacer, con `copiarRecetaDelModelo`
(`backend/src/dominio/produccion/receta-orden.ts`), y vive en sus propias tablas **`OrdenTela` /
`OrdenAvio` / `OrdenArte`** — que son las que lee `armarReceta` en el mismo archivo, y de las que
depende la explosión de materiales (`backend/src/dominio/compras/mrp.ts`, que exige
`exigirRecetaLiberada` / `exigirMaterialesLiberados` de la orden).
⇒ **La protección ya vive en la ORDEN, no en el modelo.** Compartir la receta entre los cuatro modelos
de producción **no pone en riesgo nada de lo que ya se lanzó**, y por eso el requisito de Daniel
—*"todos deben llevar lo mismo"*— se puede cumplir de la forma fuerte. *Es también la razón por la que
el punto 3 de arriba (corregir las órdenes) tiene que existir: como la orden trae su copia, cambiar el
modelo **no** las alcanza solo.*

- **Aplica en:** Modelos + Desarrollo + la acción «pasar a producción» (§Post-F9.34 punto 4, que pasa de
  1:1 a 1:N). **DISEÑADO, no construido** — el plan completo (lo medido, la estructura, la receta
  compartida, la acción en bloque, el troceado y las 10 preguntas) es la sección **⭐ EL PLAN** de aquí
  abajo, escrita el **28-ago-2026** en la etapa **V1-E8n**, que **no tocó ni una línea de código**.
  Es alcance grande: toca el linaje de versiones, el generador de nomenclatura y la receta. **Bloqueado
  hasta que Daniel conteste las 10 preguntas. Fecha:** 2026-08-28.

### ⭐ EL PLAN (28-ago-2026) — diseñado y MEDIDO contra el código; espera las 10 respuestas de Daniel

> **Por qué está escrito aquí y no en la ficha de una etapa.** El plan se diseñó en sesión y vivía
> sólo en el chat. La regla del proyecto es que **lo que no está en el repo no existe**, y su
> corolario: lo enterrado en la ficha de una etapa se pierde. **Esto es DISEÑO, no construcción:** al
> escribirlo no cambió ni una línea de código, y **ninguna de las 10 preguntas de abajo está
> contestada todavía**.
>
> ⚠️ **Este plan pasó por una ronda de corrección** (28-ago) que **retiró una afirmación falsa** —*«toda
> la receta se lee por tres funciones»*, ver punto 1.6— y **un requisito derivado de un lector que no
> existe** (punto 3.1). El diseño de fondo salió intacto; lo que cambió es lo que el plan **afirmaba**.

#### 1. Lo que se midió — y lo que sorprendió

1. 🔴 **«Hoy es 1:1» es cierto en el efecto y engañoso en la magnitud.** No hay dos filas emparejadas:
   hay **UNA fila que se transforma**. `promoverAProduccionNucleo`
   (`backend/src/dominio/modelos/nomenclatura.ts`) hace **un solo `update` sobre el mismo id** —
   cambia `codigo`, escribe `numeroProduccion` y pone `origen: 'produccion'`, conservando
   `codigoDesarrollo`. **No nace ninguna fila nueva.** ⇒ el trabajo no es «duplicar el otro lado de
   una relación»: es **hacer nacer filas donde hoy no nace ninguna**.
2. **El síntoma de Daniel, medido.** Sus 4 OC → 4 renglones de pedido → 4 llamadas a
   `salidaAProduccion` (`backend/src/dominio/produccion/salida-produccion.ts`): la **primera**
   promueve y las otras tres entran por el `if (modelo.origen === 'desarrollo')`, lo encuentran ya en
   producción y **heredan el mismo número**. Resultado: 4 órdenes, **1** modelo de producción, **1**
   renglón de inventario PT. Ése es el hueco exacto que él describe.
3. ✅ **La maquinaria de «nacer un hijo con receta copiada» ya existe entera** en
   `backend/src/dominio/modelos/versiones.ts`: la auto-relación `Modelo.idModeloPadre` / `versiones`,
   `mintearVersionDeModelo` con su advisory lock, `CAMPOS_FICHA_HEREDADOS` y `copiarRecetaAlHijo`.
   ⚠️ Los dos últimos son **privados del módulo** (no exportados): reusarlos es exportarlos o subirlos,
   no simplemente importarlos.
4. 🔴 **`idModeloPadre` NO se puede reusar para este linaje.** `esVersionDeModelo`
   (`backend/src/dominio/modelos/revision-modelo.ts`) devuelve `true` si
   `idModeloPadre !== null || versionDesarrollo !== null`, y `exigirRevisionAprobadaParaProducir`
   —llamada **dentro** de `promoverAProduccionNucleo`— lanza si esa «versión» no está aprobada.
   Colgar los hijos de ahí **bloquearía su propia promoción**. Hace falta **columna nueva**.
5. 🔴 **`Modelo.codigoDesarrollo` es `@unique`** ⇒ los hijos van con `NULL` y el linaje se sostiene por
   la FK, no por el código. (`numeroProduccion` también es `@unique`, y eso está **bien**: cada hijo
   estrena el suyo.) Sigue vivo el CHECK `modelos_desarrollo_sin_numero_produccion_check`
   (`origen <> 'desarrollo' OR numero_produccion IS NULL`), que los hijos cumplen por nacer ya en
   producción.
6. 🔴 **La receta NO se lee por tres funciones — esa frase era FALSA y es la que dimensiona E2.**
   `leerTelasBom` / `leerAviosBom` (`backend/src/dominio/modelos/bom-modelo.ts`) y `leerArtesModelo`
   (`backend/src/dominio/modelos/arte-modelo.ts`) son la lectura **CANÓNICA** del BOM, y por ahí pasa
   la mayoría — pero **además hay decenas de sitios que leen las tablas DIRECTO por `idModelo`**, y
   ésos también necesitan el resolver. Medido (`findMany`/`findFirst`/`findUnique`/`count`/`aggregate`
   sobre `modeloTela`, `modeloAvio`, `modeloAvioTalla`, `modeloArte`, `modeloArteFoto`, excluyendo
   pruebas, ayudantes de prueba y el cliente Prisma generado): **44 sitios en 10 archivos** — 36 en
   `src/` (`arte-modelo.ts` 10, `bom-modelo.ts` 10, `produccion/receta-orden.ts` 7, `versiones.ts` 4,
   `medidas-avio-talla.ts` 3, `avios-favoritos.ts` 1, `modelos.ts` 1) y 8 en el ETL
   (`migracion/cuadre-fase.ts` 5, `migracion/loaders/bom-modelos.ts` 2,
   `migracion/loaders/fotos-modelos.ts` 1). *El número se mueve con el filtro; la conclusión no.*

   🔴 **Y el agravante que hunde la frase: `ModeloAvioTalla` —las medidas por talla, R18— NO la lee
   NINGUNA de las tres.** Medido: `leerAviosBom` no menciona esa tabla ni una vez. Pero el embudo sí
   la cuenta como receta (`revision-modelo.ts` nombra «medidas por talla» entre las cinco familias, y
   el guardián `receta-embudo.test.ts` la lleva en `TABLAS_DE_RECETA`). ⇒ **con el resolver puesto
   sólo en las tres funciones, cada orden de un hijo nacería SIN medidas por talla, en silencio** — y
   eso mueve el requerido del MRP.

   **Los sitios que hay que resolver a mano, por símbolo** (mínimo; no es la lista completa):
   - **`copiarRecetaDelModelo`** (`produccion/receta-orden.ts`) — **el más caliente: por ahí pasa el
     100 % de las órdenes**. Lee `tx.modeloAvioTalla.findMany` **incondicionalmente**, y en la rama
     `sinPrecios` (la del ETL) lee `tx.modeloTela.findMany` / `tx.modeloAvio.findMany` **directo**,
     saltándose las dos funciones canónicas.
   - Los **tres `modeloAvioTalla.findMany` por `orden.idModelo`** dentro del motor que **E4 va a
     reusar**: `agregarRenglonReceta`, `restaurarRenglonReceta` y **`traerDelModelo`**.
   - **`medidas-avio-talla.ts`** entero (3 lecturas + `deleteMany`/`createMany`/`update`).
   - **`idsAviosDelBom`** (`avios-favoritos.ts`), que lee `modeloAvio` directo.
   - **La tela principal del LISTADO** (`modelos.ts`), `modeloTela.findMany({ where: { idModelo: { in: ids } } })`.
   - **`copiarBom`** (`bom-modelo.ts`), que lee y escribe `modeloTela`/`modeloAvio`/`modeloAvioTalla` del origen.

   ✅ **Lo que SÍ sigue siendo cierto y sigue abaratando la receta compartida:** las tablas son cinco y
   están acotadas, el conjunto de archivos que las toca es **enumerable** (los 10 de arriba) y **el
   guardián del embudo ya obliga a declarar cualquier archivo nuevo**. Barato ≠ tres llamadas.
7. ✅ **El embudo de escritura ya existe y está vigilado.** `tocarModeloPorCambioDeReceta`
   (`revision-modelo.ts`) es el **único** escritor de `recetaTocadaEn` / `recetaTocadaCambio` —medido:
   el resto del backend sólo las lee— y `backend/src/dominio/modelos/receta-embudo.test.ts` **barre el
   código fuente** de `src/` y `migracion/` y se pone rojo si un archivo escribe receta sin pasar por
   el embudo, con las excepciones **declaradas nominalmente**.
8. ✅ **El precedente de «aplicar donde se puede, saltar y reportar» ya está construido.**
   `traerDelModelo` (`backend/src/dominio/produccion/receta-orden.ts`) devuelve **`traidos` +
   `respetados`**, con el motivo redactado por renglón; a su alrededor viven `enRecetaEditable`,
   `exigirNoSacarLoComprado`, `desviadoAProposito` y `revocarFirmaDeRenglones`. Y el precedente de
   **alcanzar hacia atrás a todas las órdenes de un modelo** es `recalcularEstadoOrdenesDeModelo`
   (`backend/src/dominio/produccion/requisitos-orden.ts`), que ya escribe **bitácora POR ORDEN**.
9. ⚠️ **Tensión con una decisión previa de Daniel.**
   `backend/src/dominio/produccion/recetas-por-liberar.ts` documenta que él **quitó** el botón masivo
   de liberar: *"siempre se debe liberar uno por uno… no tiene sentido liberar las cosas sin ver"*.
   ⇒ la acción en bloque puede **traer y corregir, pero NO puede firmar**: lo aplicado nace sin
   `liberadoEn`.
10. 🔴 **El riesgo que nadie había nombrado: se acaban los números.** `consecutivosUsados`
    (`nomenclatura.ts`) corre con `CONSECUTIVO_MAX = 999` **por par (concepto, género)**. Pasar a 1:N
    **multiplica el consumo por el número de colores/OC**. Que `Genero.digitoAlterno` exista
    —hoy sólo Caballero, `1 → 5`, porque su serie `x1` ya llegó a 999— **prueba que agotar una serie
    ya pasó en la vida real, en el Access**.

#### 2. La estructura propuesta

**Columna nueva** en `model Modelo`: **`idModeloDesarrollo Int?`** (`@map("id_modelo_desarrollo")`),
con relación de **nombre propio** (distinta de `ModeloVersion`) y su `@@index`. Semántica: *«este
modelo de PRODUCCIÓN nació del de DESARROLLO N, y su receta es la de N»*. `NULL` = no nació por esta
vía — que es el caso de los ~4,987 modelos migrados del Access.

**Migración aditiva y SIN backfill**, y eso es **decisión, no omisión**: inventarles un padre a los
migrados sería mentir, y el resolver trata `NULL` como *«la receta es la mía»*, que es exactamente la
conducta de hoy.

**Función nueva `derivarModeloDeProduccion`**, hermana de `promoverAProduccionNucleo`, reusando el
**mismo advisory lock del par**, `proponerNumeroProduccion`, `CAMPOS_FICHA_HEREDADOS` y
`crearModeloNucleo` (este último **sí** está exportado, en `modelos.ts`). **No copia receta: la
comparte.** Y la compuerta `exigirRevisionAprobadaParaProducir` se evalúa contra el **padre**, no
contra el hijo recién nacido —que no tiene revisión propia ni tendría por qué.

#### 3. La receta — la respuesta a *«¿cómo controlas que todos lleven lo mismo?»*

**UNA SOLA receta compartida por referencia**, vía un resolver
`idModeloDeLaReceta(modelo) = modelo.idModeloDesarrollo ?? modelo.id`, metido **dentro** de las tres
funciones canónicas de lectura **y, uno por uno, en los ~44 sitios que leen las tablas directo por
`idModelo`** (punto 1.6) **y en los escritores**. ⚠️ **No son tres llamadas**: creer eso es el defecto
que este plan ya cometió una vez.

**Por qué así:** con cuatro copias no se *controla*, se *vigila* — y vigilar depende de que alguien se
acuerde. **Con una sola receta la igualdad es estructural: no se puede violar aunque se quiera.**

**Qué se rompe y hay que CONSTRUIR (no descubrir):**

1. `recetaTocadaEn` / `recetaTocadaCambio` viven **en la fila**, y con el resolver la escritura cae en
   el **padre**. ⚠️ **Esto NO es un ítem de trabajo hoy, y hay que decirlo con precisión porque la
   primera redacción de este plan inventó aquí un lector que no existe.** Medido: esas dos columnas
   aparecen **sólo** en `revision-modelo.ts` (que las escribe), `costo-viejo.ts` y `listas-precios.ts`
   — **cero** veces en `backend/openapi.json`, **cero** en `backend/src/contrato/` y **cero** en
   `frontend/src/api/esquema.gen.ts`. **No están en el contrato, no llegan al frontend y ninguna ficha
   las enseña.** Y su único lector, `avisoDeCostoViejo`, llega por `linea.desarrollo.modelo` — o sea
   **por el padre**, que es justo donde caería la escritura. ⇒ **hoy no se rompe nada.** **Si algún día
   se exponen** (la ficha del modelo, un aviso en la pantalla de un hijo), **entonces** el resolver
   tendrá que alcanzar esa lectura — anotado como condicional, no como pendiente.
2. `invalidarRevisionSiAprobada` pasa a tumbar la firma **del padre** (la llama
   `tocarModeloPorCambioDeReceta`, que ya recibe el id resuelto). Es lo correcto, pero hay que decirlo.
3. El guardián `receta-embudo.test.ts` **se pone rojo** si el resolver vive en un archivo nuevo que
   escribe receta y no importa el embudo. Se cierra declarándolo, no relajando la prueba.
4. La ficha de un hijo enseña **una receta que no es suya**: la pantalla tiene que decirlo, o alguien
   creerá que editó «sólo aquí».
5. `copiarBom` (`bom-modelo.ts`) sobre un hijo **pisaría la receta de toda la familia**.

**Alternativas descartadas, con su razón:**

| Alternativa | Por qué NO |
|---|---|
| **Copias sincronizadas** entre los N hermanos | La igualdad depende de que la réplica nunca falle; cualquier escritura fuera del embudo las desincroniza **en silencio** |
| **Copia-al-nacer**, como `versiones.ts` | Es la más barata y **no contesta la pregunta de Daniel**: a la semana siguiente ya no llevan lo mismo |
| **El número corto como atributo de la ORDEN** | Ya descartado por medición en la corrección **(b)** de arriba: `MovimientoDetPt.idModelo` es NOT NULL y es la llave del inventario PT |

⚠️ **No choca con la receta congelada de la orden**, y por qué: lo compartido vive en el plano del
**catálogo**; lo congelado, en el de la **orden**. `copiarRecetaDelModelo` sigue copiando al nacer la
orden, exactamente como hoy. 🔴 **Pero hay que DECÍRSELO a Daniel:** dos órdenes creadas en fechas
distintas pueden llevar recetas distintas **aunque los cuatro modelos lleven lo mismo** — y el botón
que él pidió (corregir las órdenes en bloque) es justo el remedio de eso.

#### 4. La acción en bloque

**Universo:** las órdenes de la familia, **vivas**, de la empresa de la sesión.

⚖️ **Las de OTRA empresa no se tocan: se listan y se avisan.** Va como **regla escrita, no como
pregunta** — Daniel ya cerró que **sólo opera FR Moda** (§Post-F9.37 punto 7: *"Con el archivo basta.
Ya no operan ahorita. Solo activa FR Moda"*), así que hoy **el caso no existe** y preguntárselo sólo
gastaría una de sus respuestas. Queda anotado por si algún día se activa una segunda.

**Se salta y se reporta:** la orden **cancelada** · el renglón **excluido** (la lápida) · el renglón
`ajustado` o `agregadoAMano` · el material con **OC autorizada o recibida** (con el folio en el
mensaje, como ya lo redacta `exigirNoSacarLoComprado`).

**NO se salta:** el renglón **ya liberado cuyo contenido cambia** — se aplica y **se le cae la firma**,
reportado como consecuencia (es lo que ya hace `enRecetaEditable` con `cambiaElContenido`).

🔴 **Transacción POR ORDEN, no global** — y **esto hay que escribirlo en el código**, porque a primera
vista parece violar A2 y **no lo hace**: la operación atómica del negocio es *«corregir la orden
5562»*, y una transacción global abortaría el lote entero por una sola orden, que es justamente lo
prohibido. **Bitácora por orden** (el precedente es `recalcularEstadoOrdenesDeModelo`). **No toca
kardex**, y debe haber una prueba que lo afirme.

**Los tres niveles, y hasta dónde se construye:**

| Nivel | Qué hace | ¿Se construye? |
|---|---|---|
| **N1** | **Traer** lo que le falta a la orden y el modelo sí lleva | ✅ Sí (default) |
| **N2** | **Actualizar** lo que difiere y nadie tocó a mano | ✅ Sí (default) |
| **N3** | **Quitar** lo que el modelo ya no lleva | ❌ NO se construye — sólo se avisa |

**Permiso: `desarrollo.administrar`**, el mismo que ya exigen `traerDelModelo` y `enRecetaEditable`.
⇒ **CERO permisos nuevos en toda la fase**, y por lo tanto **ninguna etapa requiere `SEED_ON_START`**.

🔴 **El hueco que el repo NO puede contestar solo:** `enRecetaEditable` **no mira** si la orden ya se
cortó — medido: `receta-orden.ts` no menciona `EtapaMovimiento` ni una vez; sólo exige orden **viva**
(`exigirOrdenViva`). ⇒ **hoy la receta de una orden ya cortada SÍ se puede editar de a una.** Si Daniel
dice que no se debe, el candado va en **las dos puertas** (la de a una y la del bloque), y eso es
**etapa propia** (E5), porque cierra una puerta hoy abierta. ⚠️ **Por eso la pregunta 6 va partida en
dos mitades:** contestar «no la corrijas en bloque» —que es el default y lo que cualquiera contestaría—
**no** dispara E5; lo que la dispara es la mitad **6b**, la de prohibirlo también a mano. Si no se
partiera, Daniel creería haber cerrado la puerta y quedaría abierta la de a una.

#### 5. Troceado

| Etapa | Qué entrega | BD / permisos |
|---|---|---|
| **E1** | El **linaje**: `idModeloDesarrollo` + `derivarModeloDeProduccion` | 🔴 **Única con migración** (aditiva). Sin permisos |
| **E2** | El **resolver** de receta: las tres lecturas canónicas **+ los ~44 sitios que leen directo** (punto 1.6) + los escritores. 🔴 **`ModeloAvioTalla` no pasa por ninguna de las tres** — si se olvida, las órdenes de los hijos nacen sin medidas por talla **en silencio** | Sin migración, sin permisos |
| **E3** | La **salida a producción** que hace nacer N modelos | Sin migración, sin permisos |
| **E4** | **Corregir en bloque** las órdenes de la familia (N1+N2) | Sin migración, sin permisos |
| **E5** | El **candado de «ya cortada»** en **las DOS puertas** (la de a una y la del bloque) — **sólo si contesta que SÍ a la segunda mitad de la pregunta 6 (6b)** | Sin migración, sin permisos |

**Orden obligado 1 → 2 → 3 → 4.** E5 cuelga de la respuesta, no del orden.

#### 6. Las 10 preguntas para Daniel, cada una con su default

⏳ **Ninguna está contestada.** El default es lo que se construiría si sólo dijera «adelante».

⚠️ **Se le presentan en SU idioma, y eso obliga a dos cosas** que la primera redacción no cumplía:
**(1)** nunca decirle *«el hijo»* ni *«el padre»* —jerga nuestra, jamás suya—, y **(2)** no gastarle
una respuesta preguntándole algo que ya contestó o que el sistema ya hace. *(Por eso la vieja pregunta
sobre la OTRA empresa salió de la lista: ya la cerró en §Post-F9.37 punto 7 —* «Solo activa FR Moda» *—
y quedó escrita como regla en §4, arriba.)*

| # | La pregunta | Default propuesto |
|---|---|---|
| 1 | ¿El modelo de desarrollo se queda en desarrollo **para siempre**? | **Sí**, y **nunca lleva inventario**. Los que ya se convirtieron en `prueba` se quedan como están |
| 2 | ¿Qué hace nacer un modelo de producción nuevo? | **Uno por renglón de pedido** (= una OC del cliente). Si se **re-surte** la misma OC, se **reusa** el que ya nació |
| 3 | ¿El modelo de producción lleva escrito el **color**? | **No**: el color sigue siendo de la **orden**. Si lo quiere en el nombre, eso es la **descripción** |
| 4 | Si alguien entra a **uno de los cuatro** modelos de producción y le cambia la receta, ¿qué pasa? | **Se les cambia a los cuatro** (es una sola receta), con **aviso antes de guardar** de a cuántos modelos y órdenes alcanza |
| 5 | ¿Hasta dónde llega «corregir las órdenes»? | **(a) agregar** lo que falta **+ (b) actualizar** lo que cambió y nadie tocó. **NO (c) quitar** |
| **6a** | El botón que corrige **todas de un golpe**: cuando una de esas órdenes **ya se cortó**, ¿la corrige o la deja? | **La deja y te la lista** («la 5562 no se tocó porque ya se cortó»). El lote **nunca se detiene** por ella |
| **6b** | 🔴 **Segunda mitad, y es la que cuesta:** hoy esa orden ya cortada **sí se puede cambiar a mano, de a una**. ¿Quiere además que **se prohíba**? | **No se prohíbe** — se queda como hoy. ⚠️ **Si dice que sí, es TRABAJO APARTE** (es la etapa E5) y hay que cerrarlo en **las dos puertas**, o el sistema niega en masa lo que permite de a una |
| 7 | Una orden que **ya compró** ese material, ¿se corrige? | **Para ese material no** (ya lo impide y dice **en qué OC** está); **para lo demás sí** |
| 8 | Lo corregido, ¿queda ya **autorizado para comprar**? | **No: nace sin firma** — usted dijo que liberar es **uno por uno y viendo** |
| 9 | ¿**Quién** puede correr la corrección en bloque? | **Quien hoy toca y libera recetas** (`desarrollo.administrar`). **Sin permiso nuevo** |
| 10 | 🔴 **Se van a acabar los números de 5 dígitos.** Cada modelo se lleva uno, y ahora se gastarán **tantas veces más rápido como colores tenga el modelo — en su caso, 4**. La serie da **999 por concepto+género**, y **con Caballero ya se llenó una vez** en el Access: se le abrió la continuación `1 → 5`. **El aviso y el salto YA ESTÁN CONSTRUIDOS** (el sistema avisa al bajar de 50 libres y brinca solo a la serie de continuación) — **lo que falta es lo único que sólo usted puede decidir: ¿qué segundo dígito le abrimos a Dama, Niño, Niña, Bebo y Beba?** Hoy **ninguno de ellos tiene a dónde seguir**; sólo Caballero | **Decidirlo el día que pase**, con el aviso encima y a la vista de qué dígitos están libres — **no ahora a ciegas**. ⚠️ El riesgo de esperar: cuando la serie se llena de golpe, el número **hay que teclearlo a mano** y el alta se frena |

---

#### (Post-F9.136) — 🔴 PRENDAS INCOMPLETAS: se reciben, no se producen, no se pagan y no se inventarían (DANIEL, 28-ago-2026)

**Cómo salió.** Daniel, describiendo algo que pasa en el taller y que el sistema no sabía nombrar:

> *«Tendríamos que tener una entrada adicional para prendas incompletas. Sucede que a veces alguna pieza
> de la prenda no salió bien y no la cosen. Pero sí les pido que me traigan todo, porque los faltantes
> se los cobro… aunque son prendas inservibles, necesito que me las entreguen (eso no se va a ningún
> inventario… sólo al registro de la entrada como incompleta; tampoco se pagan).»*

**Qué es, en el negocio.** No es una segunda (una prenda con defecto que **sí** se puede vender más
barata). Es una prenda **que no existe como prenda**: le falta una pieza y nunca se terminó de coser. Se
exige que la traigan **porque el faltante se le cobra al maquilero**, y la única forma de saber si de
verdad faltó es que la tela regrese.

### La decisión, cerrada — se le presentaron dos caminos y eligió el A

| | Qué proponía | Consecuencia |
|---|---|---|
| **A ✅ ELEGIDA** | La incompleta **no cuenta como producida**: es una entrega registrada, y nada más | De 100 mandadas con 95 buenas + 5 incompletas, **la orden produjo 95** |
| **B** | La incompleta **sí cuenta como recibida**, en un balde aparte que cierra el WIP | La orden habría dado por **cumplidas las 100** y el pendiente contra el maquilero se cerraba solo — justo lo que Daniel necesita **abierto** para cobrar el faltante |

1. **La prenda incompleta NO cuenta como producida.** De 100 mandadas, si vuelven 95 buenas y 5
   incompletas, **la orden produjo 95**. No es una tercera calidad: es una **no-prenda**.
2. **No entra a ningún inventario.** Ni primeras, ni segundas, ni un almacén aparte. No hay nada que
   vender ni que contar.
3. **No se paga.** No genera cargo al maquilero — es exactamente lo que Daniel dijo: *"tampoco se pagan"*.
4. **Pero SÍ se registra en la entrada, y SÍ se ve.** Su remate fue el requisito completo:

   > *«Sólo quisiera ver reflejado en algún lado que sí las entrego, para revisar los temas de pago.»*

   ⇒ **Se ven en el ESTADO DE CUENTA DEL MAQUILERO, fuera del cargo.** Ése es el papel donde se discute
   el pago, y ahí es donde la pregunta *"¿me trajiste las 5 que faltaban?"* tiene respuesta. Aparecen
   como información —cuántas incompletas entregó— **sin sumar ni restar al importe**.

### ⚠️ La trampa que hay que esquivar al construirlo (medida, 28-ago)

🔴 **Si las incompletas se suman a la cantidad recibida, se PAGAN y se INVENTARÍAN** — exactamente lo
contrario de lo que Daniel pidió. El camino está medido:

- `registrarReciboMaquila` (`backend/src/dominio/produccion/recibos.ts`) crea el `EsMaCargo` **propuesto**
  a partir del recibo, y **la cantidad del cargo se DERIVA de los detalles**: en `aCargoSalida`
  (`backend/src/dominio/esma/cargos.ts`), **`cantidadPropuesta` es exactamente la suma de
  `etapaRecibo.detalles.cantidad`** —nada más—, y **`importePropuesto` es esa cantidad × el precio**.
  *(El precio de referencia sale de la ORDEN según el proceso —`maquilaOrd` para costura,
  `aplicacionOrd` para los demás— y el `precioPactado` del recibo es sólo el respaldo cuando la orden
  no lo trae.)* ⇒ **Toda pieza que entre a `cantidad` acaba multiplicada por un precio: se cobra.**
- La misma `cantidad` es la que alimenta el kardex de PT (primeras a su almacén, segundas al suyo).
- Y `aplanarYValidar` (mismo `recibos.ts`) **impone que `cantidadPrimeras + cantidadSegundas = cantidad`**
  ⇒ meter las incompletas ahí **rompe la invariante** o las disfraza de segundas.

⇒ **Las incompletas van en SU PROPIO CAMPO** del detalle del recibo (`EtapaMovimientoDet`), **fuera** de
`cantidad`: ni suman al total recibido, ni al cargo, ni al inventario. Es un dato del recibo, no una
calidad de la prenda.

### 📌 Nota: las PRIMERAS y SEGUNDAS ya existían — Daniel no las había encontrado

En la misma conversación quedó claro que **el desglose de calidad ya está construido desde F3-E4**, y no
se estaba usando: `EtapaMovimiento` tiene **`idAlmacenPrimeras`** e **`idAlmacenSegundas`** (los dos
destinos del recibo) y `EtapaMovimientoDet` tiene **`cantidadPrimeras`** y **`cantidadSegundas`** por
color×talla, con el kardex mandando cada una a su almacén.

*(Ojo con el nombre al buscarlo: **no existe una tabla `Recibo`**. El recibo es un `EtapaMovimiento` con
`tipo = recibo_maquila`; ahí viven esos campos.)*

⇒ **Que una función construida y correcta no se encuentre es un defecto igual de real que si faltara.**
Vale la pena revisar cómo se presenta la captura del recibo, no sólo agregarle un campo más.

### ✅ CÓMO QUEDÓ CONSTRUIDO (V1-E8k, 28-ago-2026)

**El campo.** `EtapaMovimientoDet.cantidadIncompletas` (`cantidad_incompletas`, `INTEGER` nullable),
migración **100 % aditiva** `20260828120000_prendas_incompletas`. NULL en corte/envío/entrega y en
**todo lo migrado** (el Access nunca tuvo el concepto); todos los derivados lo leen como 0. **Sin
backfill** y **sin `SEED_ON_START`**: no hay permisos, roles ni catálogos nuevos — la captura reusa
`produccion.recibo` y la consulta `esma.ver-pagos`.

**Dónde vive la aritmética.** Un módulo nuevo, `backend/src/dominio/produccion/incompletas.ts`, con
`piezasDevueltas` / `recibiblePorCelda` (el tope) e `incompletasDeMaquilero` (dónde se ven). Las dos
puertas de cada regla llaman a la MISMA función, no a un resumen suyo.

**Las cuatro reglas, y cómo se cumplen:**

1. **No cuentan como producidas.** Todo lo que produce, inventaría, cobra o mide —el kardex de PT,
   `esma/cargos.ts`, `esma/conciliacion.ts`, el EDR, los KPIs, el WIP— suma `cantidad`, y las
   incompletas viven fuera de ella: quedan excluidas **por construcción**, no por un filtro que
   alguien pueda olvidar mañana. `registrarReciboMaquila` las persiste aparte y `aplanarYValidar`
   mantiene intacta la invariante `primeras + segundas = cantidad` (meterlas ahí lanza un error que
   lo dice con todas sus letras).
2. **No entran a inventario.** El kardex se arma de `primeras`/`segundas`, que no las incluyen. Y un
   recibo que trae SOLO incompletas ya **no pide almacén destino** (no hay nada que guardar) — lo
   descubrió la prueba de integración, no el razonamiento: antes de este campo un recibo sin piezas
   era imposible, así que la puerta es nueva.
3. **No se pagan.** `aCargoSalida` sigue derivando `cantidadPropuesta` de `Σ detalles.cantidad`, sin
   tocarlas, y un recibo que trae **solo** incompletas **no genera `EsMaCargo`** (antes eso no podía
   pasar; sin el cambio la cola de validación se llenaría de cargos de $0).
4. **Sí se ven, donde se revisa el pago.** Bloque `incompletas` en las **dos** vistas del estado de
   cuenta (unificada y desglosada) — y de ahí al **PDF** (sección propia, sin columna de importe) y
   al **Excel** (hoja «Prendas incompletas»). También en la **cola de validación de cargos**, donde
   alguien teclea la cantidad a pagar: si no las viera ahí, podría sumarlas a mano creyendo que se le
   olvidaron al capturista. Y en el **recibo semanal por maquilero** y en el **PDF del recibo**.

**⚠️ Lo que la opción A obliga y no era obvio: el PENDIENTE se queda ABIERTO.** De 10 enviadas con 8
buenas + 2 incompletas, el WIP sigue diciendo *"faltan 2"* — que es exactamente lo que Daniel necesita
para cobrar el faltante (por eso descartó la opción B). Pero esas 2 piezas **ya salieron del taller**,
así que **no se pueden volver a recibir como buenas**: el tope de `recibido ≤ enviado` (decisión (g))
pasó a contar `cantidad + incompletas`. Son dos números distintos, y el contrato publica los dos
—`cantidad` (el pendiente, abierto) e `incompletas` (lo ya devuelto sin servir)— **más un tercero,
`recibible`, que calcula el SERVIDOR con la misma función del tope (`recibiblePorCelda`)**. La pantalla
de captura consume `recibible` tal cual y **no re-deriva la regla**: si sólo viajara el pendiente y el
cliente hiciera la resta, sería la misma regla escrita en dos lados — que es exactamente cómo divergen,
y el precio sería una matriz que ofrece celdas que el guardado rechaza. La pantalla lo explica en un aviso ámbar en vez de dejar el número sin explicar.

**Lo que NO se construyó, a propósito:** el **cobro automático del faltante**. Daniel explicó *por qué*
pide que se las entreguen (*"los faltantes se los cobro"*), pero **no pidió que el sistema haga ese
cargo**. Se registra y se muestra; el cobro sigue siendo una decisión suya.

- **Aplica en:** el recibo de maquila (`EtapaMovimientoDet` + la pantalla de captura del avance), el
  estado de cuenta del maquilero (pantalla, PDF y Excel), la cola de validación de cargos EsMa, los
  recibos semanales y el PDF del recibo. ✅ **CONSTRUIDO** (V1-E8k, 28-ago-2026, versión **0.048**);
  **lleva migración de BD** (aditiva, sin backfill, sin `SEED_ON_START`).
  **Fecha:** 2026-08-28.

---

#### (Post-F9.137) — ⭐ «ESCÓNDESELA»: el costo REAL del listado de modelos deja de verse sin permiso (DANIEL, 28-ago-2026)

**Cómo salió.** Cierra **la nota que §Post-F9.123 dejó levantada a propósito** y no resolvió por
iniciativa propia. El caso era éste: la columna **«costo actual»** del listado de modelos muestra el
costo **unitario del último costeo real (F7)** de una orden de ese modelo —o sea, **cómo terminamos**,
no lo que se planeó— y la gobierna `consultas.ver-importes`, que **Gerencial ya tenía desde antes**. Eso
choca de frente con lo que Daniel había dicho de Aurora: *«tampoco costos finales reales»*.

Preguntado si esconderla o dejarla, la respuesta fue de una palabra:

> **«Escóndesela.»**

**Por qué es coherente y no un capricho.** Es la misma línea que Daniel ha sostenido en todas las
decisiones del territorio: *«solo yo defino los precios de los clientes»* (§Post-F9.123) y, sobre los
factores, **dos frases suyas que en §Post-F9.125 están registradas por separado y aquí se citan como
tales**: *«los factores sólo yo los puedo mover»* y *«y no son visibles para nadie más»*. Desarrollo
**ve el plan**; **el resultado es del dueño**.

### Lo que se decide

1. **Esconder Y BLOQUEAR — las dos cosas.** Sin el permiso, **la columna no se pinta** y **el servidor no
   manda el dato**. Es el principio que este proyecto ya adoptó en **§Post-F9.68**: esconder sin bloquear
   es maquillaje, porque el número sigue viajando en la respuesta del API y basta con mirarla.
   **Ésta es la decisión, y se construyó tal cual** — el CÓMO está abajo, en «✅ CONSTRUIDO».
2. ⚠️ **El riesgo, que Daniel aceptó de frente: hay un permiso de por medio que no gobierna sólo esta
   columna, y esconderle la columna podría costarle a Aurora algo más.** **Si lo estaba usando, se va a
   quejar.** La decisión se toma sabiéndolo: **cuando pase, se destapa lo que haga falta, con nombre y
   por petición suya — no se revierte en silencio.** Un permiso que se devuelve calladito porque alguien
   se quejó es un permiso que nadie volverá a creer. *(Al construir se midió cuál era ese costo de
   verdad y se encontró una salida que **no le quita nada**; ver abajo. El riesgo de la queja **no
   desaparece**: la columna sí se le esconde.)*

> 🗄️ **Cómo se creía en el momento de decidir (28-ago, ANTES de medir) — se conserva porque explica de
> dónde venía el plan, y NO describe el código de hoy:** se daba por hecho que el candado del servidor
> vivía en `listarModelos` bajo `consultas.ver-importes` y que *«lo que cambia es quién tiene ese
> permiso»*, o sea sacar a Aurora de él, asumiendo que el daño colateral se limitaba a los importes de
> **Costos y Márgenes**. **Las dos cosas resultaron inexactas:** el candado colgaba de
> `adjuntarAgregadosListado` (no de `listarModelos`), y ese permiso gobierna **además el PRE-COSTEO**.
> ⇒ **Ese plan se DESCARTÓ.** Lo que hoy hay en el código está en «✅ CONSTRUIDO».

### ✅ CONSTRUIDO (V1-E8l, 28-ago-2026, versión **0.049**) — y el mecanismo salió DISTINTO al previsto

⚠️ **La DECISIÓN de los dos puntos de arriba se sostiene entera; lo que cambió es el CÓMO** — el plan
que se creía (recuadro 🗄️ de arriba) era sacar a Aurora de `consultas.ver-importes`, contando con que el
daño se limitaba a los importes de Costos y Márgenes. **Medido antes de construir, el costo real de esa
salida era mucho mayor, y caía justo sobre lo que Daniel dijo que ella SÍ debe ver:**

🔴 **`consultas.ver-importes` es también el candado de importes del PRE-COSTEO.** `calcularPreCosto` y
`listaPrecios` (`backend/src/dominio/costos/pre-costo.ts`) devuelven **todos** sus importes y precios
sugeridos en `null` sin él. O sea que quitárselo a Gerencial le habría **apagado el precosteo entero** —
el instrumento con el que ella *«arma un excel con todos los costos»* y monta la cotización que Daniel
aprueba (§Post-F9.123)—. **Habría cumplido la letra de «escóndesela» rompiéndole el trabajo**, que es
exactamente lo que Daniel excluyó al decir que *«puede hacer sus cálculos»*.

⭐ **La salida, que no le quita nada a nadie: colgar la columna del permiso que YA significa «el
RESULTADO».** La propia tabla de §Post-F9.123 nombra a `costos.ver` como *«costo real de la orden, costo
real desde compras, márgenes»* y lo marca **❌ correcto** para Gerencial: Aurora **ya estaba fuera de él
por diseño**. El candado del listado pasa de `consultas.ver-importes` a **`costos.ver` Y
`consultas.ver-importes` (los dos)** — `puedeVerCostoRealDeModelo`,
`backend/src/dominio/modelos/modelos.ts`—. Ejecutando `definirRoles()` (no leyéndolo), el resultado es
el pedido: lo ven **Administrador, AdministracionDireccion y Directivo**; **Gerencial y todo lo de abajo,
no**.

**Se exigen los DOS y no sólo `costos.ver`** porque en la cascada del seed el primero ya implica al
segundo, pero **los roles son datos editables** (`roles.administrar`): un rol a la medida podría llevar
`costos.ver` sin el de importes. Pedir los dos sólo puede ESTRECHAR el conjunto, nunca ampliarlo.

**Consecuencias de haber ido por aquí:**

- 🟢 **El seed NO cambia y NO hace falta `SEED_ON_START=true`** (a diferencia de lo que esta entrada
  anticipaba): no se movió el reparto de roles, se movió el candado del programa. **No hay permiso
  nuevo.**
- 🟢 **Aurora conserva íntegro el precosteo, las listas de precios, la negociación y las recetas.** Lo
  único que deja de ver es la columna «costo actual» del listado de modelos.
- 🔴 **El riesgo del punto 2 se reduce pero NO desaparece:** si ella usaba esa columna, se va a quejar.
  Sigue en pie lo acordado — **se destapa y se decide con nombre, no se revierte en silencio.**

**Esconder Y bloquear, las dos mitades, cada una con su prueba en las DOS direcciones** (lo que se pide
ocultar se prueba que NO se ve, y con el permiso puesto, que SÍ se ve):

- **Servidor:** `modelos-listado.int.test.ts` estrena el caso que el candado viejo dejaba pasar —
  `consultas.ver-importes` PUESTO y `costos.ver` ausente, o sea Gerencial exacto—. La prueba que ya
  existía (*«sin `consultas.ver-importes` el costo viene null»*) **pasaba en verde con el hueco
  abierto**, porque quitaba el permiso que Aurora sí tiene.
- **Pantalla:** `ModelosPagina.test.tsx` fija que sin `costos.ver` **no se pinta ni el encabezado ni la
  celda** en ninguno de los dos pintados (tabla de escritorio y tarjeta de móvil), y que el resto del
  listado le sigue llegando entero.

- **Aplica en:** V1-E8l — versión **0.049**. **SIN migración, SIN permiso nuevo, SIN `SEED_ON_START`.**
  **Fecha:** 2026-08-28.

---

#### (Post-F9.138) — ⭐⭐ EL NEGOCIADOR EN VIVO: un renglón tipo Excel donde el precio y el margen se persiguen en las dos direcciones (DANIEL, 29-ago-2026)

> *"es importante tener un campo donde vaya poniendo el precio y me de el porcentaje de margen que
> tengo, tomando en cuenta todas las condiciones. Ese campo lo voy usando para ir midiendo que margen
> voy teniendo con los precios que me piden los clientes."*

> *"Tambien me gustaria tener todos los elementos casi como si fuera un excel. Tengo que tener todos
> los precios en un renglon para ir moviendo en vivo e ir viendo como se va moviendo el margen si
> modifico cada elemento. Pero no quiero poner un boton que me lleve a otra pantalla para actualizar
> los precios. Quiero campos que vengan con los costos que tenga la receta y yo poder ir moviendo en
> vivo. Posiblemente el unico campo que si puedo pasar a otra pantalla para quitar y poner o mover,
> sean los avios."*

> *"Ejemplo.... estoy a media negociacion y el cliente me dice: ponle una jareta mas barata y bajame 3
> pesos... entonces yo voy jugando en tiempo real con la receta para llegar al costo que me pide. Por
> eso siempre tengo que saber el margen que tengo"*

### Lo que se decide

1. **Las dos direcciones, en el mismo renglón.** Se escribe **precio** → sale el **margen**; se mueve un
   **costo** de la receta → se mueve el margen. No es un campo de precio con un reporte al lado: es un
   instrumento que se persigue solo, en los dos sentidos, porque así es como Daniel negocia (*"ponle una
   jareta mas barata **y** bajame 3 pesos"* son las dos direcciones en una sola frase del cliente).
2. **Un RENGLÓN, no una pantalla por concepto.** *"casi como si fuera un excel"*: todos los elementos de
   costo visibles a la vez y editables en el sitio. El margen se recalcula **en vivo**, sin guardar y sin
   recargar.
3. 🔴 **NINGÚN botón que saque de la pantalla.** Es un requisito explícito y va literal: quien está en la
   mesa con el cliente enfrente no puede perder el hilo por navegar. **La única excepción que Daniel
   concede** es la de los **avíos** (quitar, poner o mover), que *"posiblemente"* sí puede vivir en otra
   pantalla — y es una excepción, no una puerta abierta a más.
4. **Los campos nacen cargados con los costos de la receta.** No se teclea desde cero: se **parte** de lo
   que la receta ya sabe y se mueve desde ahí. *"Quiero campos que vengan con los costos que tenga la
   receta y yo poder ir moviendo en vivo."*
5. **"Tomando en cuenta todas las condiciones"** — el margen que se enseña es el del precio **puesto en
   las condiciones de ese cliente**, no el margen bruto sobre costo pelón. Los cuatro factores del cliente
   ya están decididos y son **sólo del dueño** (§Post-F9.125): este instrumento los usa, y por eso vive
   detrás del mismo candado.

### De dónde viene y con qué se enlaza

Es la **mecánica** de la mesa que §Post-F9.110 dejó planteada (*"la negociación edita la receta en vivo"*)
y que esa decisión dejó explícitamente pendiente. §Post-F9.110 fijó **dónde** se escribe (en la versión
del precosto, **nunca en el modelo**) y **qué queda de testimonio** (`NegociacionEvento` encadena
anterior → nueva); esta decisión fija **cómo se opera**: un renglón, dos direcciones, sin navegar.

⚠️ **No re-abre lo ya cerrado:** la negociación **sigue sin tocar el modelo** (§Post-F9.110), el precio de
venta y sus factores **siguen siendo sólo del dueño** (§Post-F9.125), y si la receta se mueve bajo un
precio ya aprobado el sistema **avisa, no tumba la firma** (§Post-F9.127).

### ⭐ MEDIDO CONTRA EL CÓDIGO (29-ago-2026) — media decisión YA ESTÁ CONSTRUIDA

No se parte de cero, y conviene saber exactamente por dónde va el corte antes de estimar nada:

| Lo que pide Daniel | Estado medido |
|---|---|
| **Dirección 1:** escribo **precio** → sale el **margen** | ✅ **YA EXISTE** — `simularNegociacion` (`backend/src/dominio/desarrollo/negociacion.ts`) recibe `precioObjetivo` y devuelve `margenBrutoPct`, `margenObjetivoPct`, `precioNeto` y `cumpleObjetivo`. La aritmética vive en `simularMargenNegociacion` (`backend/src/dominio/costos/precio-lista.ts`). |
| *"tomando en cuenta todas las condiciones"* | ✅ **YA EXISTE** — simula sobre los **factores snapshot** de la lista, con la cascada completa. |
| **Dirección 2:** muevo un **costo** → se mueve el margen | 🔴 **NO EXISTE.** El `costo` sólo puede venir del `costoUnit` **vigente** del renglón o de un precosto **`congelado`** (`'Sólo se puede simular sobre una versión CONGELADA del precosto.'`). **No hay forma de pasarle costos movidos a mano**, que es justo lo que la mesa necesita. |
| **El renglón "casi como un excel"** (todos los elementos editables a la vez) | 🔴 **NO EXISTE.** Hoy la simulación es de **un precio contra un costo total**, no de los elementos por separado. |

⇒ **El trabajo real es la dirección 2 y el renglón**, no la calculadora de margen. Y ojo: `simularNegociacion`
es **lectura pura que no muta nada** — esa propiedad hay que **conservarla** al abrirla a costos libres
(§Post-F9.139: la mesa no escribe en el catálogo).

⚠️ **Y hay un candado que NO se toca:** los cuatro factores salen en `null` sin `listas.aprobar`
(§Post-F9.125(b) — *"ésta era la tercera puerta a los factores, y era la más ancha"*). Ampliar el
simulador **no puede** convertirse en una cuarta puerta: si el instrumento nuevo entrega margen, entrega
margen **con el mismo candado**.

- **Aplica en:** Desarrollo/Cotización — `negociacion.ts` (ampliar `simularNegociacion`) + pantalla de la
  lista/negociación. ⬜ **PENDIENTE, sin etapa asignada**, pero **sobre base ya construida**
  (`Precosto`/`PrecostoLinea`/`NegociacionEvento` + la calculadora de margen). **Fecha:** 2026-08-29.

---

#### (Post-F9.139) — ⭐⭐ LOS ESTIMADOS: en la mesa se negocia con NÚMEROS LIBRES, y el catálogo no se toca (DANIEL, 29-ago-2026)

> *"que pasa si me pide una jareta mas barata. Yo se que con algun proveedor puedo conseguir algo mas
> barato, pero en el momento no esta dado de alta en el catalogo. No puedo ponerme a dar de alta una
> jareta ahi, que ni certeza tengo de cuanto cuesta. Necesito ir poniendo estimados de distintas cosas,
> y despues ya en mi oficina poder ir cuadrando los avios que quiero meter al modelo..."*

**Ésta es la pieza que cambió el diseño**, y no es un detalle de captura: parte la negociación en **dos
momentos** que hasta ahora se estaban pensando como uno solo.

### Los dos momentos

| | **Negociar** (con el cliente enfrente) | **Cuadrar** (después, en la oficina) |
|---|---|---|
| Con qué se trabaja | **Estimados**: números libres | Materiales **reales** del catálogo |
| Certeza del precio | Ninguna — *"ni certeza tengo de cuanto cuesta"* | Se busca proveedor y se confirma |
| Qué toca del sistema | **NADA**: no crea catálogo | Ahí sí se da de alta y se amarra |
| Para qué sirve | Llegar al precio que pide el cliente | Que la receta de producción sea verdad |

### Lo que se decide

1. **El simulador acepta números LIBRES.** Un renglón de estimado es un **importe** (con su etiqueta para
   acordarse de qué era), **no una referencia al catálogo**. No exige que el avío exista, ni proveedor, ni
   precio confirmado.
2. 🔴 **El simulador NO CREA NADA.** Ni avío, ni proveedor, ni precio, ni medida. Nada de lo que se teclea
   en la mesa aparece después en un catálogo.
3. **El estimado se queda marcado como tal.** Lo negociado con estimados **no es una receta de
   producción** y no puede confundirse con una: es lo que obliga a que exista el filtro posterior
   (§Post-F9.140).

### ⭐ El porqué MEDIDO — no es una precaución teórica, es una cicatriz propia

Coincide exactamente con la razón por la que **§Post-F9.106** eligió el **alta por clic** y no el alta
automática. Ahí quedó escrito, y se cita porque es el mismo mecanismo de daño:

> *"Se elige la del clic, **por una cicatriz propia**: el catálogo de **medidas de avío** se fragmentó
> porque el texto libre creó `"53 cm"`, `"53cm"` y `"53"` como tres medidas distintas"* — y con eso **la
> orden de compra salió partida en tres**.

⇒ **Crear filas de catálogo a media prisa es cómo se ensucia un catálogo.** Y la mesa de negociación es
el lugar de MÁS prisa que hay en todo el sistema: cliente enfrente, precio moviéndose y, por confesión
del propio Daniel, **sin saber todavía cuánto cuesta la cosa**. Es exactamente la peor combinación
posible para dejar que algo escriba en un catálogo. §Post-F9.106 lo evitó pidiendo **un clic con una
persona decidiendo el nombre**; aquí se evita **no escribiendo nada en absoluto**.

*Y hay un segundo motivo, del propio texto de Daniel: dar de alta un avío del que **no se conoce el
precio** no sólo ensucia el catálogo — mete al sistema un dato que se va a usar para costear y que
**nadie confirmó**.*

- **Aplica en:** el negociador en vivo de §Post-F9.138. ⬜ **PENDIENTE — sin etapa asignada.**
  ⚠️ **Al construir**: los estimados necesitan **su propia forma de guardarse** dentro de la versión del
  precosto (hoy `PrecostoLinea` cuelga de tela/avío/`ConceptoCosto`); es el punto que hay que resolver
  antes de codear. **Fecha:** 2026-08-29.

---

#### (Post-F9.140) — ⭐⭐ DESPUÉS DE LA NEGOCIACIÓN, UN FILTRO: la bandeja que ya existe y que Daniel ya aprobó (DANIEL, 29-ago-2026)

> *"Creo que despues de una negociacion, tiene que haber una validadcion de la receta original. O sea,
> de alguna manera deberia de pasar un filtro para ver lo que se negocio con el cliente. y como se
> cerro. Hay muchos modelos que si se aceptan tal cual como esta la receta, pero otros que habra que
> cambiar en vivo (a estimado) y despues buscar proveedor y cambiar la receta para produccion"*

### Lo que se decide

1. **Hay una bandeja de negociaciones cerradas que esperan cuadre.** Es el *"filtro"* que pide Daniel: el
   puente entre el momento de negociar y el de cuadrar (§Post-F9.139).
2. ⭐ **Sólo caen ahí las que se negociaron CON ESTIMADOS.** Lo dice el propio Daniel: *"Hay muchos
   modelos que si se aceptan tal cual como esta la receta"* — **ésas pasan derecho**, no hay nada que
   cuadrar. La bandeja se llena sola con las que tienen algo que resolver, y por eso no se convierte en
   un trámite que hay que despachar para todo.
3. ⭐⭐ **LA FORMA YA EXISTE Y DANIEL YA LA APROBÓ — no se inventa una nueva.** Es la bandeja **«Recetas
   por liberar»** (`consultarRecetasPorLiberar`,
   `backend/src/dominio/produccion/recetas-por-liberar.ts`), nacida en V1-E3h, de la que Daniel dijo
   **«está buenísima»**, y cuya regla de operación la fijó él mismo:

   > *"siempre se debe liberar uno por uno… no tiene sentido liberar las cosas sin ver"*

   ⇒ Esa regla (§Post-F9.72 / V1-E3k, que **retiró la liberación en bloque incluso del contrato**) es
   **exactamente** lo que este filtro necesita: cuadrar un estimado es, por definición, algo que hay que
   **ver uno por uno**.
4. 🔴 **LA BANDEJA NO FIRMA: LLEVA.** Distinción que hay que respetar al construir. Esta bandeja
   **muestra** lo que quedó pendiente de cuadrar y **lleva** a la pantalla donde se cuadra; **la firma de
   Desarrollo sigue siendo la que ya existe** y sigue viviendo donde vive. No se duplica la compuerta ni
   se crea una segunda autoridad que libere.

### Cómo encaja con lo ya decidido

Es la **REVISIÓN bisagra** que §Post-F9.110 declaró indispensable —*"debe de haber una revisión antes de
mandar a producir. Porque luego en la negociación enfrente del cliente puede ser que se cometa una
imprudencia o un error"*—, **ahora con forma concreta y con su criterio de entrada** (sólo las de
estimados). §Post-F9.110 dijo *que* tenía que existir; esto dice **qué es** y **a qué se parece**.

⚠️ **Afina §Post-F9.110, no la contradice:** aquélla decía que alguien *"revisa la versión aceptada y la
PROMUEVE a la receta del modelo"*. Sigue siendo eso. Lo que se agrega es (a) que la cola tiene **forma de
bandeja ya conocida** y (b) que **no todas** las negociaciones pasan por ella.

### ⭐ MEDIDO CONTRA EL CÓDIGO (29-ago-2026) — la COMPUERTA ya existe; lo que falta es la BANDEJA

⚠️ **Corrección importante para quien construya:** la revisión que §Post-F9.110 pidió **ya se construyó**
en `V1-E7d`, y hay que no volver a construirla:

- ✅ **La compuerta existe.** `exigirRevisionAprobadaParaProducir`
  (`backend/src/dominio/modelos/revision-modelo.ts`) impide que una **versión** salga a producción sin
  firma, y vive dentro de `promoverAProduccionNucleo` para cubrir **también** la puerta lateral de
  generar la OP. `Modelo.revisionEstado` + `idRevisadoPor` + `revisadoEn` + `revisionNota` guardan el
  acto (A7). **`null` se lee como PENDIENTE.**
- 🔴 **La BANDEJA no existe.** No hay ninguna consulta que **liste** los modelos con
  `revisionEstado = 'pendiente'`: el estado se escribe (`versiones.ts`) y se **exige** al promover, pero
  **nadie puede ver la cola**. Hoy la compuerta es un **muro al final del camino**, no un filtro que
  alguien revisa.

⇒ **Esto es exactamente lo que Daniel está pidiendo**, y por eso su petición no es un duplicado: *"de
alguna manera deberia de pasar un filtro"* — el filtro se topa hoy cuando ya quieres producir, en vez de
poder trabajarlo antes. **Lo que se construye es la cola (y su criterio de entrada), no una segunda
compuerta.**

- **Aplica en:** Desarrollo/Cotización — una bandeja con la forma de `recetas-por-liberar.ts`, alimentada
  por `revisionEstado`/los estimados de §Post-F9.139, **reusando la compuerta ya existente de
  `revision-modelo.ts`**. ⬜ **PENDIENTE — sin etapa asignada.** **Fecha:** 2026-08-29.

---

#### (Post-F9.141) — ⭐ LOS COMENTARIOS SON DE LA NEGOCIACIÓN, NO DEL MODELO — y van en HILO (DANIEL, 29-ago-2026)

> *"y tambien necesito meter comentarios para cada modelo"*

Preguntado si eran comentarios **del MODELO** (que viajarían a todos los clientes y todos los proyectos)
o **de la NEGOCIACIÓN**, la respuesta fue:

> *"es en esta negociacion"*

### Lo que se decide

1. **Van en el RENGLÓN de la lista** — o sea en la pareja **cliente + modelo** de esa negociación—, **NO
   en el catálogo de modelos.** La frase *"para cada modelo"* describe **dónde se escriben** (uno por
   renglón), no **de quién son**. Un comentario de mesa como *"aceptó si le quitamos el cierre"* es
   verdad **de este cliente en esta negociación**, y ponerlo en el modelo se lo contaría a todos los
   demás.
2. **En HILO: varios, con autor y fecha, INMUTABLES.** No es un campo de notas que se reescribe.
3. **El patrón es `OrdenComentario`** (`backend/prisma/schema.prisma`), que viene del Access viejo y ya
   tiene exactamente esta forma: `idUsuario`, `comentario`, `fecha`, y su comentario en el esquema dice
   **«log inmutable»** y **«Inmutable»**. Se copia ese patrón; no se inventa otro.
4. ⚠️ **`Desarrollo.notas` es la OTRA forma y NO es la que se quiere aquí.** Es un campo suelto
   (`String?`) que se sobreescribe. Queda dicho para que nadie lo reuse por parecer más barato.

### El porqué

**Los comentarios de una negociación son HISTORIA**, y la historia no se edita. Un campo que se reescribe
deja que **el segundo comentario borre al primero** — y justo lo que Daniel pidió en §Post-F9.110 fue
*"el registro de cómo fue construido el modelo y cómo fue cambiando con la necesidad del cliente"*. Un
campo que se pisa a sí mismo es incapaz de guardar eso.

*Es además la misma línea que el resto del sistema ya sostiene: los movimientos no se editan, se
cancelan con su inverso (D3); la auditoría es uniforme (A7).*

- **Aplica en:** Desarrollo/Cotización (la lista de la negociación). ⬜ **PENDIENTE — sin etapa
  asignada.** Lleva **migración aditiva** (una tabla de comentarios de la negociación, con el patrón de
  `OrdenComentario`). **Fecha:** 2026-08-29.

---

#### (Post-F9.142) — ✅ EL CANDADO DE LA FIRMA: Daniel describió, sin ver el código, la regla que el sistema YA TIENE (DANIEL, 29-ago-2026)

> *"Si, podriamos avanzar pero si el modelo aun no esta firmado, no se pueden comprar los avios. Es
> indispensable revisar y modificarlo, antes de comprar nada"*

> *"bloquear solo lo que no esta firmado. Es comun que se avance con la compra de tela, que es lo que
> mas timepo tarda, en lo que se van aprobando otros avios..."*

⚠️ **Esta entrada NO abre trabajo: registra una CONFIRMACIÓN.** El sistema ya se comporta así. Lo que
vale la pena guardar no es la decisión —está construida desde V1-E3h— sino que **Daniel, sin haber visto
el código, describió la regla exacta que el sistema implementa, incluida su granularidad**. La segunda
cita es, casi palabra por palabra, lo que hace `exigirMaterialesLiberados`. ⇒ **§Post-F9.72 («se compra
LO LIBERADO») acertó**, y esto es su validación independiente: el dueño del negocio llegó solo al mismo
diseño.

### Lo que el sistema ya hace, por símbolo (medido el 29-ago-2026)

Las dos puertas viven en `backend/src/dominio/produccion/receta-orden.ts`:

| Símbolo | Qué hace |
|---|---|
| **`exigirRecetaLiberada`** | Lanza `ErrorConflicto` (409) **sólo si NADA está firmado** — *"no hay nada autorizado que comprar"*, y el mensaje dice dónde se libera. **Con algo firmado PASA y devuelve la lista de lo que falta.** ⚠️ Hace **las dos cosas**: lanzar y devolver la lista **no son excluyentes** — leer que "devuelve la lista" no autoriza a concluir que no lanza. |
| **`exigirMaterialesLiberados`** | Lanza 409 por **el MATERIAL CONCRETO** que se está comprando sin firma, nombrándolo. **Es la mitad que cumple literalmente la segunda cita de Daniel:** deja comprar la tela firmada mientras los avíos siguen aprobándose. |

**Los cinco sitios donde se invocan** (ninguno es de pruebas). ⚠️ **Por NOMBRE de función, no por
número de línea** — los números se pudren al primer cambio:

- **`validarLineas`** (`compras/ordenes-compra.ts`) — llama a **las dos** puertas. Es **la OC capturada
  A MANO**, la puerta de atrás: gasta el mismo dinero contra la misma receta.
- **`planearCompra`** (`compras/mrp.ts`) — llama a **las dos** puertas. Es **generar la OC** desde la
  explosión.
- **`explosionarUna`** (`compras/mrp.ts`) — llama a `exigirRecetaLiberada`. Es **explotar**.

### 🔴 La regla real es «sin nada firmado no hay nada que comprar» — y NO «sólo se gatea al generar la OC»

Se propuso al redactar esto que el candado fuera únicamente al generar la OC, *"porque explotar es mirar,
y mirar debe poder hacerse siempre"*. **El código dice otra cosa y manda el código:** `explosionarUna`
(`compras/mrp.ts`) **también** gatea al explotar cuando no hay **nada** firmado. Y es coherente, no un descuido — con cero
renglones autorizados la explosión no tendría nada que enseñar, y devolver un resultado vacío sin
explicación sería peor que el 409 que sí dice qué pasa y dónde se arregla.

⇒ Queda escrita **la regla del código**: *sin nada firmado no hay nada que comprar* — y por eso frena en
las tres puertas. Lo que **nunca** se frena es el piso: **cortar, enviar a maquila, recibir y entregar no
pasan por aquí a propósito**, tal como Daniel pidió (*"podriamos avanzar"*). Se detiene el dinero, no la
producción.

### `avisosDeMaterialSinLiberar` NO bloquea — a propósito, y no es el hueco

`compras/mrp.ts` levanta además un aviso amarillo en el paso de avanzar (*"X NO entra en esta compra"*).
**Ése no bloquea, y está bien que no lo haga**: es §Post-F9.64 (*"avisar no es bloquear"*) — comprar lo
liberado y dejar el resto para otra OC es una forma legítima de trabajar, justo la que §Post-F9.72 abrió.
Su propio comentario en el código deja dicho que el caso que atiende **hoy nunca corre en producción**,
porque `exigirMaterialesLiberados` rechaza con 409 unas líneas antes. **Es defensa a futuro, no un
agujero.**

### 🩹 La cicatriz, escrita porque sirve más escrita que callada

El 29-ago-2026, al preparar esta misma entrada, **se afirmó —con seguridad y a Daniel— que el sistema
«avisa pero no bloquea»**. Era **falso**. La medición se había hecho con un `grep` de `throw` **acotado a
`mrp.ts` y alrededor de `sinLiberar`**, y **las dos puertas viven en `receta-orden.ts`**: el barrido
completo las encontró y desmintió la afirmación antes de que llegara al documento.

⇒ Es exactamente la regla que este proyecto ya paga cara: **se verifica lo que se construye, no lo que se
escribe sobre lo construido** — y un `grep` acotado al archivo donde uno *cree* que está la lógica
confirma la hipótesis en vez de probarla. *La lección concreta, para la próxima: un símbolo que devuelve
una lista puede además lanzar; hay que abrir la función, no inferirla desde su sitio de llamada.*

- **Aplica en:** nada — ✅ **YA CONSTRUIDO** (V1-E3d §Post-F9.43(c) + V1-E3h §Post-F9.72). **Sin
  migración, sin permisos, sin trabajo pendiente.** Esta entrada es registro y validación.
  **Fecha:** 2026-08-29.
