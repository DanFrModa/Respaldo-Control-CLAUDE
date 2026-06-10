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
