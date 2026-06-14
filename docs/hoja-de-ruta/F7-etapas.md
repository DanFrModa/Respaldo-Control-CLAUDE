# F7 — Costos / EDR + Indicadores · desglose en etapas

> Parte de la hoja de ruta viva ([`HOJA-DE-RUTA.md`](../../HOJA-DE-RUTA.md), raíz del repo).
> Una sesión nueva lee `CLAUDE.md` → `PLANMAESTRO.md` → `HOJA-DE-RUTA.md` → la ficha de la fase activa.
>
> **Entrega de la fase (plan §6):** Costeo a costo actual (D1), EDR automatizado y tableros KPI derivados de la RC (D11).
> **Criterio de salida:** Costos y tableros cuadran contra el cálculo manual.
> **Estado:** ⬜ pendiente — el desglose se confirma/ajusta al arrancar la fase.

## F7-E1 · Motor de costeo: pre-costo, costo de orden y márgenes por pedido — ⬜ pendiente

**Objetivo:** Construir UNA sola implementación parametrizada de la fórmula de costeo (pre-costo = misma fórmula con precios de catálogo; costo real = componentes teóricos calculados + componentes guardados/ajustados que arman el total), con base de prorrateo explícita (D2) y valuación a costo actual (D1). Va primero porque E2 (EDR) referencia CostoOrden y porque el criterio de salida de la fase es numérico: el cuadre contra el cálculo manual de Daniel se valida desde aquí, no al final.

**Alcance:**
- INSUMO PREVIO BLOQUEANTE (sin código, manos de Gabriel/Daniel): sesión con Daniel para que enumere los problemas por los que dejó de usar Costos (D2 abierto, doc 06 nota inicial y §7.1) + conseguirle POR ADELANTADO el dataset de cuadre: 1 orden costeada a mano, 1 mes de EDR a mano y 1 margen de pedido a mano. En la MISMA sesión se resuelve la pregunta del esquema del EDR de E2 (¿gastos del mes globales o por empresa? — ver E2) para no convocar a Daniel dos veces. Sin esto no se congela el diseño de E1 ni E2.
- Tabla CostoOrden (← CostoOrd): 1:1 con la orden; 6 componentes en doble juego teórico/guardado — telaCalc/telaCost, habCalc/habCost, bordCalc/bordCost, maquilaCalc/maquilaCost, regaliasCalc/regaliasCost, otros+descOtros — costoTotal = Σ de los GUARDADOS (doc 06 §3); baseProrrateo explícita (enum cortado|recibido|vendido, default cortado = CantCorte del viejo); observaciones; idEmpresa (A9); auditoría A7 + Bitacora (módulo financiero)
- VERIFICAR AL LLEGAR — Ordenes.noCost: el campo NoCost SÍ existe en el sistema viejo (Ordenes.csv, columna 14, verificado) pero la tabla Ordenes del v2 la construyó F2 y nada garantiza que lo haya incluido. Si F2 no lo trajo, E1 lo agrega con su migración Prisma y confirma si el ETL de F2 ya migró el dato (si no, el backfill queda en el ETL de E6).
- Permisos nuevos en el catálogo RBAC (A4): costos.capturar, costos.ver (ex nivel ≤30), precostos.consultar (ex ≤45) y reuso/extensión del permiso de 'ver importes y precios' (ex acceso #2) con soporte a OCULTAR COLUMNAS de importes en pantallas que el usuario sí ve (verificar si F2 ya lo creó; no duplicar)
- Servicios en backend/src/dominio/costos (A1): calcularPreCosto(idModelo) — receta paraPreCosto × precios de catálogo + Modelos.maquila + regalías % de EtiquetaMarca (doc 06 §2; OJO: el bordado entra UNA vez por modelo, sin cantidad — no inventarla); calcularCostoTeoricoOrden(idOrden) — receta paraCosto × precios vigentes + maquila de la orden + regalías (alimenta los *Calc); guardarCostoOrden(idOrden, componentes) — transaccional A2, valida Ordenes.noCost, costoTotal = Σ 6 guardados, auditoría A7 + Bitacora; costoUnitario(idOrden) — prorrateo sobre la base explícita D2; margenesPorPedido(filtros) — SQL crudo con fórmulas de MargenesPorPedido/CostoPedidosPromedio, solo órdenes con costo ≠ 0 (OrdenesConCosto), COALESCE en todo agregado (patrón ceronulo)
- Rutas REST en backend/src/api/costos: GET /api/costos/pre-costo/{idModelo}; GET+PUT /api/costos/ordenes/{idOrden} (teórico y guardado juntos); GET /api/costos/ordenes (lista de costos con filtros); GET /api/costos/margenes-por-pedido — permisos server-side en cada ruta; regenerar backend/openapi.json y sincronizar frontend/src/api/esquema.gen.ts EN ESTA etapa
- Pantallas (patrón docs/modulos/patron-crud.md): Pre-costo por modelo con subgrids tela/avíos/bordado, accesible también desde Modelos (PC + consulta móvil); Costeo de orden con los 6 componentes teórico vs guardado LADO A LADO, costo unitario con base de prorrateo visible, respeta noCost (PC); Lista de costos grid modelo/orden exportable (PC); Costos y márgenes por pedido — importe, margen promedio, margen ponderado, margen $/pieza (PC + consulta móvil directivo)
- Impresos R9 del grupo: Lista de precios PDF (@react-pdf/renderer; por género, activos/inactivos) con la fórmula del precio sugerido COMPLETA y parametrizada — verificado en ListaPreciosEd.txt: PrecioVenta = CInt((costo×2)/0.9), o sea TRES factores hardcodeados: utilidad (×2), regalías sobre el PRECIO de venta (/0.9 ≡ 10%) y redondeo a entero (CInt). Parametrizar la utilidad con ConfiguracionEmpresa.utilidadSugerida Y las regalías con ConfiguracionEmpresa.regaliasBase (ambos ya seedeados 50/10 desde F0 — consumir, no recrear) Y definir la regla de redondeo del precio sugerido (replicar el entero del viejo o acordar una nueva), validando contra el cálculo manual de Daniel la correspondencia entre el ×2 viejo y utilidadSugerida=50. NOTA: este SQL evidencia que en la lista de precios las regalías van SOBRE EL PRECIO — insumo directo para la pregunta abierta de la base de regalías del costeo (ver notasFase). + reporte de costos y márgenes por pedido en PDF/Excel (exceljs)
- NO entra: tabla PreCostoSnapshot (el pre-costo es cálculo de dominio — verificado: PreCostos no es tabla en el viejo); solo se agrega si la sesión D2 pide congelar estimados históricos

**Entregables:**
- Migración Prisma con CostoOrden (+ enum de base de prorrateo, + Ordenes.noCost si F2 no lo incluyó) y seed de los permisos nuevos
- Servicios de dominio costos con TSDoc (referencia a doc 06 y D1/D2) + tests unitarios de las fórmulas (incluye casos: componente nulo→0, bordado sin cantidad, regalías por etiqueta, noCost rechazado, precio sugerido con utilidad/regalías/redondeo parametrizados) + tests de integración contra Postgres efímero
- Rutas REST con Zod descritos, backend/openapi.json regenerado, cliente tipado del frontend sincronizado
- 4 pantallas funcionando end-to-end con tests Vitest + al menos 1 E2E Playwright (costear una orden y ver el unitario)
- Lista de precios PDF y reporte de márgenes PDF/Excel descargables desde sus pantallas
- Minuta de la sesión D2 con Daniel registrada (incluye la respuesta a gastos del EDR globales/por empresa para E2; decisiones nuevas → DECISIONES.md/MEJORAS.md si aplica)

**Criterio de cierre:**
- CI en verde (lint + typecheck + tests backend y frontend + build de imágenes)
- Reviewer independiente aprobó el diff contra doc 06, D1/D2 y estándares §8/§9
- El costo total y el costo unitario de la orden del dataset de Daniel CUADRAN exactamente contra su cálculo manual
- El pre-costo de un modelo real cuadra contra receta × precios calculado a mano
- La lista de precios cuadra contra el cálculo manual de Daniel con AMBOS factores parametrizados (utilidad y regalías) y la regla de redondeo definida
- Permisos verificados: usuario sin importes.ver no ve columnas de precios/costos
- Verificación de Gabriel completada y confirmada antes del PR a prueba

**Verificación de Gabriel:**
- [ ] Antes de que arranque el coder: agenda la sesión con Daniel (problemas del módulo viejo de Costos + sus mejoras + la pregunta del EDR: ¿gastos del mes globales o por empresa? — ver E2) y pídele el dataset de cuadre (1 orden costeada a mano, 1 mes de EDR, 1 margen de pedido); guarda sus hojas como referencia de toda la fase
- [ ] Corre docker compose up -d --build y entra como admin
- [ ] Abre Pre-costo de un modelo con receta completa; con calculadora suma cantidad × precio de cada tela/avío + precio de bordado (una vez, sin cantidad) + maquila + regalías %; compara contra lo que muestra la pantalla — debe ser idéntico
- [ ] Abre Costeo de orden con la orden del dataset de Daniel: captura/ajusta los 6 componentes como en su hoja y compara costoTotal y costo unitario contra su cálculo manual — número por número
- [ ] En esa pantalla verifica el doble juego: cambia a mano un componente guardado distinto del teórico y confirma que el total se arma con el GUARDADO y que el teórico sigue visible al lado
- [ ] Cambia la base de prorrateo de cortado a vendido y confirma que el unitario cambia y que la base queda visible en pantalla; regresa a cortado (default)
- [ ] Intenta costear una orden marcada noCost — el sistema debe rechazarlo con mensaje claro
- [ ] Abre Márgenes por pedido con el pedido del dataset y compara importe/margen promedio/margen $ por pieza contra la hoja de Daniel
- [ ] Descarga la Lista de precios PDF; cambia utilidadSugerida en Administración, regenera y confirma que los precios cambian (ya no hay ×2 fijo); luego cambia TAMBIÉN regaliasBase, regenera y confirma que los precios vuelven a cambiar (ya no hay /0.9 fijo); revisa que el redondeo del precio siga la regla definida
- [ ] Crea un usuario de prueba sin permiso de importes, entra con él y confirma que ve las pantallas permitidas pero SIN columnas de precios/costos
- [ ] Abre el costeo desde el celular en modo consulta y confirma que se lee bien

**Equipo:** 1 coder + 1 reviewer (cadena esquema→dominio→API→UI del mismo grupo funcional; no paralelizable)

**Referencias:**
- Documentacion_MJD/06-Costos-y-EDR.md §1, §2, §3, §5, §6, §7 (completo)
- Documentacion_MJD/01-Modelos.md §2 (receta/banderas bPreCosto, regalías de EtiquetasM) y §3 (reporte ListaPrecios)
- Documentacion_MJD/DECISIONES.md D1, D2; MEJORAS.md módulo 06; REQUISITOS-NUEVOS.md R9
- PLANMAESTRO.md §4 (Costos D1/D2), §9.2 (A1, A2, A4, A7, A9)
- docs/modulos/patron-crud.md (patrón de pantalla y ruta)
- Volcado viejo: consultas CostoTela/CostoHabilitacion/CostoBordado/MargenesPorPedido/CostoPedidosPromedio/OrdenesConCosto y ListaPreciosEd (fórmula del precio sugerido: ×2, /0.9, CInt); forms PreCostos*, CostoOrd, CostoOrdSub, QueModelosCosto, ListaCostos, CostosPorPedidos*; reporte ListaPrecios; Ordenes.csv columna NoCost (en Respaldo CLAUDE/, latin-1)

---

## F7-E2 · EDR automatizado: generación desde entregas, conciliación y consultas mes/año — ⬜ pendiente

**Objetivo:** Construir el Estado de Resultados mensual generado AUTOMÁTICAMENTE desde los movimientos de entrega a cliente del mes (MEJORAS 06), valuado SIEMPRE a costo actual (D1, sin replicar CostoBueno/CostoViejo), con validación/ajuste manual del usuario y desglose por empresa a nivel de línea. Va después de E1 porque EdrLinea referencia CostoOrden y el costo actual que valúa las ventas sale del motor de costeo.

**Alcance:**
- DECISIÓN BLOQUEANTE DEL ESQUEMA (se resuelve en la sesión con Daniel de E1, ANTES de congelar la migración de esta etapa): ¿los gastos/intereses/bonificaciones del mes son GLOBALES (como hoy: los captura una vez al mes) o los quiere POR EMPRESA hacia adelante? FORMA DEL DATO VIEJO VERIFICADA: el encabezado EdoResult es global por mes (IdEdoResult, Fecha, Gastos, Intereses, Bonificaciones, Otros, DescOtros — SIN IdEmpresas); la empresa vive POR LÍNEA en EdoResultDet.IdEmpresas. La respuesta fija el diseño de Edr y la regla de migración de los 44 encabezados históricos (E6).
- Tabla Edr (← EdoResult), diseño según la decisión anterior — PROPUESTA DEFAULT (espejo de hoy, compatible con el histórico): encabezado Edr GLOBAL por mes (mes, gastos, intereses, bonificaciones, otros/descOtros) + la empresa por línea en EdrLinea; las vistas 'EDR por empresa' se DERIVAN de las líneas (Ventas y Costo por empresa; Gastos/Resultado a nivel consolidado). Si Daniel quiere gastos por empresa, los gastos van en tabla aparte EdrGasto(idEdr, idEmpresa NULLABLE, concepto, monto) que soporta ambos modos sin rehacer el esquema. Auditoría A7 + Bitacora en todo caso.
- Tabla EdrLinea (← EdoResultDet): ref a orden/CostoOrden, modelo, cantVendida, precioVenta, idEmpresa (solo empresas con Empresa.paraEdr=true, A9/doc 10 §5), origen (automatica|manual|ajustada) y columna costoHistorico NULLABLE solo-informativa (se llena únicamente en el ETL de E6 con el CostoViejo congelado, para que el histórico siga cuadrando con lo reportado en su momento; la valuación NUEVA siempre usa costo actual D1)
- Servicios en backend/src/dominio/edr (A1): generarEdrMes(mes) — transaccional A2, IDEMPOTENTE y re-ejecutable (regenerar no duplica líneas ni pisa ajustes manuales — política explícita y testeada), propone líneas desde los movimientos de ENTREGA A CLIENTE de F3 (EtapaMovimiento tipo entrega_cliente + EtapaMovimientoDet, PLANMAESTRO §4 — o la entidad real que F3 haya dejado: VERIFICAR AL LLEGAR; ojo con la trampa de nomenclatura: 'Entregas' en el viejo es el flujo M de maquila, NO la entrega a cliente) con precio desde el pedido (doc 06 §7.4), respeta Ordenes.noCost, solo empresas paraEdr; calcularEdr(idEdr) — Ventas = Σ(cantVendida×precioVenta), Costo = Σ(costoActual×cantVendida), Resultado = Ventas − Costo − Gastos − Intereses + Bonificaciones ± Otros (consulta EdoResultTotales), con desglose Ventas/Costo por empresa desde las líneas, COALESCE en todo (ceronulo); ajustarLineaEdr/agregarLineaManual con auditoría
- Definir y documentar las reglas de los casos especiales del EDR automático (validar con Daniel sobre su mes de cuadre): entregas parciales, devoluciones, segundas (¿otro precio?), qué precio manda — el ajuste manual cubre lo que la regla no
- Rutas REST backend/src/api/costos (submódulo edr): POST /api/edr/{mes}/generar (alcance global con desglose por empresa en líneas, o por empresa si la decisión del esquema lo pidió); GET+PUT /api/edr/{id} (encabezado y gastos); GET+PUT /api/edr/{id}/lineas (conciliación con filtros fecha/modelo/empresa/referencias de cliente D7 — reemplaza el filtro Monarch de doc 06 §7.6); GET /api/edr/por-mes y /api/edr/por-anio (con corte por empresa derivado de líneas) — permisos edr.ver/edr.capturar; regenerar openapi.json + cliente del frontend EN ESTA etapa
- Pantallas: EDR gestión del mes — encabezado con gastos/intereses/bonificaciones/otros (global o por empresa según la decisión del esquema) (PC); Conciliación de ventas REDISEÑADA — las líneas se PROPONEN solas y el usuario valida/ajusta/agrega, con filtros D7 (PC); EDR por mes — desglose Ventas−Costo−Gastos−Intereses+Bonificaciones±Otros con corte por empresa en Ventas/Costo (PC + móvil); EDR por año — comparativo anual (PC + móvil)
- Impresos R9 del grupo: EDR mensual y anual en PDF (@react-pdf/renderer) + exportación a Excel (exceljs) — formato NUEVO (hoy solo pantalla)

**Entregables:**
- Migración Prisma con Edr/EdrLinea (+ EdrGasto si la decisión lo pidió) y seed de permisos edr.* — congelada DESPUÉS de la decisión con Daniel
- Servicios de dominio edr con TSDoc (referencia doc 06 §4/§7.4 y D1) + tests unitarios de fórmulas (nulos→0, empresa sin paraEdr excluida, noCost excluido) + tests de integración que prueban la IDEMPOTENCIA de generarEdrMes y la preservación de ajustes manuales
- openapi.json regenerado + cliente tipado del frontend sincronizado
- 4 pantallas end-to-end con tests + E2E Playwright del flujo generar mes → conciliar → consultar
- EDR PDF mensual/anual y Excel descargables
- Documento corto de reglas del EDR automático (casos especiales acordados con Daniel + la decisión gastos globales/por empresa) referenciado en el TSDoc

**Criterio de cierre:**
- CI en verde y aprobación del reviewer contra doc 06 §4/§7 y D1
- El esquema Edr se congeló DESPUÉS de la decisión con Daniel sobre gastos globales/por empresa (registrada en la minuta de la sesión de E1)
- El mes del dataset de Daniel, generado automáticamente y ajustado donde su hoja lo indique, CUADRA en Ventas, Costo y Resultado contra su EDR manual
- Re-ejecutar generarEdrMes sobre un mes ya conciliado no duplica líneas ni pierde ajustes (verificado en vivo, no solo en tests)
- Una empresa con paraEdr=false no aparece ni suma en el EDR (sus entregas no generan líneas)
- Verificación de Gabriel completada antes del PR a prueba

**Verificación de Gabriel:**
- [ ] Antes de que el coder congele la migración: confirma que la respuesta de Daniel a '¿gastos del mes globales o por empresa?' (de la sesión de E1) ya está registrada y pasada al equipo
- [ ] Con docker compose up y datos de prueba con movimientos de entrega a cliente del mes (los de F3): crea el encabezado del mes en EDR gestión y captura gastos/intereses como en la hoja de Daniel
- [ ] Pulsa Generar: confirma que las líneas aparecen solas desde las entregas a cliente del mes (no las capturas una por una)
- [ ] Compara contra la hoja de Daniel: cantidad vendida, precio y costo de cada línea, y abajo Ventas, Costo del mes y Resultado — número por número
- [ ] Edita una línea a mano (ajuste) y agrega una manual; vuelve a pulsar Generar y confirma que tus ajustes siguen ahí y que no se duplicó nada
- [ ] Verifica D1: cambia el costo guardado de una orden en Costeo (E1), regenera el cálculo del EDR y confirma que el mes se revalúa con el costo ACTUAL
- [ ] Filtra la conciliación por una referencia de cliente (campos D7) y confirma que filtra bien (ya no existe el filtro Monarch)
- [ ] Marca una empresa de prueba con paraEdr=false y confirma que sus entregas NO entran al EDR; revisa además que el EDR por mes muestre el corte de Ventas/Costo por empresa desde las líneas
- [ ] Abre EDR por mes y por año desde el celular; descarga el PDF mensual y el Excel anual y revisa que los totales sean los mismos de pantalla
- [ ] Entra con el usuario sin permisos de EDR y confirma que no ve el módulo

**Equipo:** 1 coder + 1 reviewer (cadena esquema→dominio→API→UI y dependencia directa de E1; no paralelizable)

**Referencias:**
- Documentacion_MJD/06-Costos-y-EDR.md §4 (EDR: tabla EdoResult UN registro por mes sin empresa + EdoResultDet con IdEmpresas por línea; CostoBueno y la DECISIÓN D1), §7.4 (automatizar desde entregas), §7.6 (filtro Monarch → D7)
- Documentacion_MJD/10-Modelo-Datos-y-Usuarios.md §5 (Empresas.ParaEdoRes)
- Documentacion_MJD/DECISIONES.md D1, D7; MEJORAS.md módulo 06; REQUISITOS-NUEVOS.md R9
- PLANMAESTRO.md §4 (multi-empresa A9; EtapaMovimiento tipo entrega_cliente — la entidad v2 de la entrega al cliente, construida en F3), §9.2 (A2, A7)
- backend/prisma/schema.prisma (Empresa.paraEdr ya existe desde F0 — consumir, no recrear)
- Volcado viejo: TABLAS/EdoResult.csv y EdoResultDet.csv (forma real del dato: encabezado global, empresa por línea); consulta EdoResultTotales; forms EdoResult, EdoResultSub, EdoResultBuscar, EdoResultBuscarDet2, EdoResultPorMes, EdoResultPorAno (Respaldo CLAUDE/, latin-1)

---

## F7-E3 · Motor de KPIs en segundo plano + tableros directivos (RC, calidad, WIP) — ⬜ pendiente

**Objetivo:** Construir la infraestructura de cálculo pesado de la fase — pg-boss + vistas materializadas + SQL crudo, donde la captura NUNCA espera un recálculo (plan §11) — y sobre ella los tres tableros directivos derivados de datos de fases previas: KPIs de Ruta Crítica (D11, el corazón del módulo 11), calidad por maquilero (F6) y WIP analítico (F3). Es un corte semi-horizontal justificado: el motor de jobs/vistas es nuevo y los tres tableros lo comparten. No depende de E1/E2 (lee RutaOrden, AQL y movimientos, no costos).

**Alcance:**
- Motor de jobs como motor común (backend/src/comun): cablear pg-boss 12 sobre el mismo Postgres SI F5 no lo dejó ya cableado para el CPM (verificado hoy: pg-boss NO existe aún en backend/ — confirmar al llegar a F7); cola refrescar-kpis con programación periódica (cron de pg-boss) + disparo on-demand vía endpoint
- Vistas materializadas (SQL crudo en migración Prisma, REFRESH ... CONCURRENTLY con índice único): kpi_entregas_a_tiempo, kpi_lead_time_proceso, kpi_cuellos_botella (atraso medio por proceso), kpi_desempeno_responsable — todas derivadas de RutaOrden de F5 (fechaPlaneada/fechaReal/responsable/estado); kpi_calidad_maquilero — % aprobación AQL, defectos top, tendencia por maquilero/temporada desde auditorías de F6 (doc 09 §5.3); kpi_wip — prendas atoradas por etapa, avance y mermas desde movimientos de F3 (MEJORAS 03-WIP)
- Servicio de dominio recalcularKpisRc (job): refresca las vistas y registra timestamp de última actualización; los KPIs de RC NO se migran — se derivan (la RC vieja no se usa, doc 08)
- DECISIÓN A VALIDAR con Daniel antes de congelar la vista: contra QUÉ fecha se mide 'entrega a tiempo' (propuesta: fechaReal ≤ fechaPlaneada del proceso final/entrega de la RC; alternativas: FechaEntrega de la orden o FechaHasta del pedido)
- Rutas REST backend/src/api/indicadores: GET /api/indicadores/rc (filtros periodo/cliente/maquilero/proceso), GET /api/indicadores/calidad-maquileros, GET /api/indicadores/wip, POST /api/indicadores/refrescar — todas devuelven el metadato 'datos al: <timestamp>'; permiso indicadores.ver (+ granular por tablero si la sesión D2 lo pidió); regenerar openapi.json + cliente del frontend
- Pantallas: Tablero KPI de Ruta Crítica — % entregas a tiempo, lead time por proceso y total, cuellos de botella, desempeño por responsable/rol, tendencia de ciclo, con filtros (PC + móvil; es EL tablero directivo, doc 08 §4.4); Tablero de calidad por maquilero (PC + móvil); Tablero WIP analítico (PC + móvil)
- Impresos R9 del grupo: exportación de los tres tableros a PDF (@react-pdf/renderer) y Excel (exceljs) para dirección

**Entregables:**
- Motor pg-boss operativo (o reuso del de F5) con la cola refrescar-kpis programada + ADR corto en docs/arquitectura/ si el cableado es nuevo (decisión técnica: vistas materializadas + jobs)
- Migración con las 6 vistas materializadas e índices únicos para REFRESH CONCURRENTLY
- Servicio recalcularKpisRc con TSDoc (referencia D11, doc 08 §4.4, plan §11) + tests de integración que validan cada KPI contra un dataset sintético calculado a mano en el test
- openapi.json regenerado + cliente tipado sincronizado
- 3 tableros responsive end-to-end con tests + E2E Playwright (abrir tablero RC con filtros)
- Exportaciones PDF/Excel de los 3 tableros
- Nota con la definición acordada de 'entrega a tiempo' (→ DECISIONES.md si es decisión nueva)

**Criterio de cierre:**
- CI en verde y aprobación del reviewer contra D11, doc 08 §4.4, doc 09 §5.3 y plan §11
- Un KPI verificado a mano cuadra: el % de entregas a tiempo de un periodo chico coincide con el conteo manual sobre las mismas órdenes
- El refresco corre en segundo plano: ninguna pantalla de captura espera al job (verificado en vivo)
- Los tableros muestran 'datos al: <fecha/hora>' y el botón de refrescar encola el job sin bloquear
- Los 3 tableros se ven y filtran bien en el celular
- Verificación de Gabriel completada antes del PR a prueba

**Verificación de Gabriel:**
- [ ] Con docker compose up y los datos de F5/F6 del ambiente de prueba (órdenes con RC corrida y auditorías AQL): abre el Tablero KPI de RC
- [ ] Escoge un periodo chico (1 semana) y un cliente; cuenta A MANO en las pantallas de RC cuántas órdenes entregaron a tiempo vs tarde y compara contra el % del tablero — debe coincidir exacto
- [ ] Revisa que el tablero diga 'datos al: <hora>'; captura un avance de RC nuevo (o un recibo) y confirma que la captura NO se queda esperando ningún recálculo
- [ ] Pulsa Refrescar indicadores: confirma que regresa de inmediato y que poco después el timestamp y los números se actualizan solos
- [ ] Abre el tablero de calidad por maquilero y compara el % de aprobación de UN maquilero contra sus auditorías AQL de F6 contadas a mano
- [ ] Abre el tablero WIP y compara las prendas atoradas de UNA etapa contra la pantalla de WIP de F3
- [ ] Abre los 3 tableros desde el celular y confirma que se leen y filtran bien
- [ ] Exporta el tablero RC a PDF y a Excel y confirma que los números son los de pantalla
- [ ] Entra con un usuario sin indicadores.ver y confirma que no ve los tableros

**Equipo:** 1 coder + 1 reviewer para motor pg-boss + vistas + API + tablero RC (cadena); opcional +1 coder en paralelo SOLO para las páginas de los tableros de calidad y WIP una vez regenerado el contrato OpenAPI (páginas independientes, sin solape de archivos)

**Referencias:**
- Documentacion_MJD/08-Ruta-Critica.md §2.4 (RC_ConcentradoDif: la pantalla más pesada del viejo), §3 ('no tenemos buena manera de analizar'), §4.4 (KPIs propuestos)
- Documentacion_MJD/09-Control-de-Calidad.md §5.3 (tablero de calidad por maquilero)
- Documentacion_MJD/MEJORAS.md módulo 03 (WIP analítico) y DECISIONES.md D11
- PLANMAESTRO.md §1 (pg-boss 12, SQL crudo para KPIs), §4 (RutaOrden), §11 (riesgo: cálculos pesados frenando la captura → cola en segundo plano)
- Nota del orquestador: KPIs pesados con SQL crudo y/o vistas materializadas + pg-boss; la captura nunca espera un recálculo
- Verificado en código: pg-boss aún no existe en backend/ (sin hits) — coordinar con lo que F5 haya cableado para el CPM

---

## F7-E4 · Productividad unificada IP/Almacén + fichas confiables + muestrarios — ⬜ pendiente

**Objetivo:** Construir el motor de productividad UNIFICADO IP/Almacén (MEJORAS 05 §1) con sus catálogos, captura y tablero, más el checklist de confiabilidad de fichas y los muestrarios pendientes — los indicadores de captura del módulo 11. No depende de E1–E3 (no toca costos ni RC): si la sesión D2 de E1 se atrasa, esta etapa puede adelantarse.

**Alcance:**
- Motor de productividad — tablas: PersonalArea (← IP_Personal: nombre, horasBase, puesto, activo, area IP|Almacen), ActividadProductividad (← IP_Actividades + Alm_Prd_Act: actividad, area, porcentajeD, pzPersDia, porcenPzas), RegistroProductividad (← IP_Productiv + Alm_Prd/Det: fecha, persona, actividad, cantidad, horasTrabajadas, personas para cuadrilla de almacén, idCliente opcional); NUEVA columna ConfiguracionEmpresa.jornadaBaseAlmacen (default 9 — hoy hardcodeada 3 veces en Ind_Alm_Productividad y como HorasBaseAlm)
- Servicio registrarProductividad + cálculo de índices (A1): índice IP RealDiario = (horasBase/horasTrabajadas)×porcentajeD×cantidadAct e índice Almacén ((((J/pzPersDia)/J)×piezas)/personas)×(J/horasTrabajadas) con J parametrizada — validar horasTrabajadas>0, personas>0, pzPersDia>0 (división por cero). DEFINIR EN EL DISEÑO (y en el TSDoc) las vistas semanal/mensual del tablero: la consulta vieja Ind_IP_Productividad deriva además RealSemanal (=RealDiario/5), RealMensual (=RealDiario/30) y PorcentajeTrabajado (=horasTrabajadas/horasBase) — verificado; decidir si esas heurísticas /5 y /30 se replican o se reemplazan por AGREGACIÓN de los registros diarios reales (propuesta: agregar diarios y mostrar PorcentajeTrabajado como columna), validándolo con Daniel en la misma pasada. Tablero vs estándar con SQL crudo.
- Pantallas de productividad: Catálogos (personal + actividades por área, patrón CRUD, PC); Captura unificada IP/Almacén con atajos Hoy/Ayer/Sábado (PC; captura móvil útil); Tablero de productividad vs estándar por persona/actividad/semana/mes (PC + móvil)
- ALCANCE NEGATIVO documentado: la auto-alimentación de la productividad desde datos ya existentes (movimientos, recibos — doc 05 Observación 4, prioridad 🟢) se DESCARTA para F7: se reconstruye la captura manual con atajos y la mejora queda registrada en MEJORAS.md como mejora futura (opcionalmente se confirma con Daniel en la sesión de E1 si quiere priorizarla)
- Fichas confiables: ChecklistFichaDef (reactivos configurables A6, seed con los 8 aspectos fijos de IP_InfConf: InfGeneral, InfTela, InfHab, Medidas, Dibujo, InfEtiqueta, EspCostura, MedidasPrendas) + FichaVerificacion por orden con revisor y fecha; servicio verificarFichaOrden + indicador % de fichas confiables (consulta Ind_IP_InfConfiable); dejar hook documentado para derivar reactivos automáticamente si R5 (ficha estructurada, módulo 12) se construye — NO duplicar funcionalidad
- Muestrarios: tabla Muestrario (← IP_MuesPend: cliente, categoría, temporada, cantBoards/cantMuestras, fechas solicitado/requerida/entregado, boardsOK/muestrasOK, solicitante, cancelación suave) + servicio gestionMuestrarios (solicitud→seguimiento→entrega, KPI de cumplimiento fechaEntregado vs fechaRequerida); pantallas solicitar + pendientes (PC + consulta móvil)
- Rutas REST backend/src/api/indicadores (submódulos productividad/fichas/muestrarios) con permisos granulares por submódulo; regenerar openapi.json + cliente del frontend EN ESTA etapa

**Entregables:**
- Migración Prisma (PersonalArea, ActividadProductividad, RegistroProductividad, ChecklistFichaDef, FichaVerificacion, Muestrario + columna jornadaBaseAlmacen) + seed de los 8 reactivos de fichas y de los permisos nuevos
- Servicios de dominio con TSDoc (referencias doc 05 §A.1–A.3/§B.1, MEJORAS 05 §1, A6) + tests unitarios de las DOS fórmulas de productividad contra valores calculados a mano (incluye las vistas semanal/mensual según la regla definida y los rechazos por división por cero)
- openapi.json regenerado + cliente tipado sincronizado
- 5–6 pantallas end-to-end con tests + E2E Playwright (capturar productividad y verla en el tablero)
- Nota de diseño de las vistas semanal/mensual del tablero (variantes del SQL viejo documentadas + la regla elegida) referenciada en el TSDoc
- Registro en MEJORAS.md del descarte de la auto-alimentación de productividad (doc 05 obs. 4) como mejora futura

**Criterio de cierre:**
- CI en verde y aprobación del reviewer contra doc 05 §A/§B.1, MEJORAS 05 y A6
- El índice de productividad IP y el de Almacén de un registro de prueba cuadran contra la fórmula calculada a mano (con la jornada parametrizada, no 9 fijo)
- Las vistas semanal/mensual del tablero siguen la regla definida y documentada (no quedó a interpretación del coder)
- Captura con horas=0 o personas=0 rechazada con mensaje claro
- El % de fichas confiables y el KPI de cumplimiento de muestrarios reflejan las capturas de prueba
- Verificación de Gabriel completada antes del PR a prueba

**Verificación de Gabriel:**
- [ ] Con docker compose up: da de alta una persona y una actividad de IP en los catálogos; captura un registro de productividad y compara el índice contra la fórmula (horasBase/horasTrabajadas)×porcentajeD×cantidad hecha con calculadora
- [ ] En el tablero, abre la vista semanal y la mensual y confirma que los números siguen la regla definida (agregación de diarios o las variantes /5 y /30 del viejo — la que se haya acordado); compara una semana chica contra la suma manual de sus días
- [ ] Captura productividad de almacén (con personas y cliente); luego cambia jornadaBaseAlmacen en Administración de 9 a 8 y confirma que el índice recalculado cambia (ya no hay 9 fijo)
- [ ] Intenta capturar con 0 horas trabajadas — debe rechazarlo
- [ ] Llena el checklist de ficha de una orden, y verifica que el % de fichas confiables del indicador refleje tu captura
- [ ] Solicita un muestrario, márcalo entregado después de la fecha requerida y confirma que el KPI de cumplimiento lo marca incumplido
- [ ] Abre el tablero de productividad y la consulta de muestrarios desde el celular y confirma que se leen bien
- [ ] Entra con un usuario sin los permisos de estos submódulos y confirma que no los ve

**Equipo:** 1 coder + 1 reviewer (cadena esquema→dominio→API→UI; tras el corte de la antigua E4 ya no se necesita paralelismo intra-etapa ni coordinación de permisos/OpenAPI entre coders)

**Referencias:**
- Documentacion_MJD/05-Indicadores.md §A.1 (productividad IP), §A.2 (fichas IP_InfConf), §A.3 (muestrarios IP_MuesPend), §B.1 (productividad almacén), Observaciones 1, 4 y 5
- Documentacion_MJD/MEJORAS.md módulo 05 §1 (motor unificado)
- PLANMAESTRO.md §4 (A6 vía patrón tallas), §9.1 (criterio de paralelización)
- docs/modulos/patron-crud.md (catálogos)
- Volcado viejo: consultas Ind_IP_Productividad (verificado: deriva RealDiario, RealSemanal=/5, RealMensual=/30 y PorcentajeTrabajado=horasTrabajadas/horasBase), Ind_Alm_Productividad, Ind_IP_InfConfiable, Ind_Muest_Pend; forms IP_Productiv, IP_InfConfAgregar, IP_MuesPend_*, IP_Personal, IP_Actividades, Alm_Prd_Diaria, Alm_Prd_Act_Cat (Respaldo CLAUDE/, latin-1)
- Riesgo a coordinar: traslape de FichaVerificacion con R5 (REQUISITOS-NUEVOS §R5, módulo 12 Documental)

---

## F7-E5 · Inventario cíclico contra kardex propio + auditoría 5S condicionada — ⬜ pendiente

**Objetivo:** Construir el inventario cíclico contra el kardex propio del v2 (D6/D3/D4: teórico congelado al alta, conteo ciego, ajuste solo por movimiento de kardex) y la auditoría 5S con reactivos configurables (A6) condicionada a la decisión de Daniel. No depende de E1–E4 (usa el motor de kardex de F0 y los catálogos/existencias de fases previas): es el segundo comodín si algo se bloquea.

**Alcance:**
- Inventario cíclico: tablas InventarioCiclico + InventarioCiclicoDet a granularidad D4 (modelo×color×talla×almacén); el ALTA CONGELA cantTeorica desde la existencia kardex v2 EN ESE MOMENTO (D6 — ya no Proscai; si se leyera al consultar, el teórico cambia mientras cuentan); captura de conteo CIEGO (el contador no ve el teórico); exactitud = cantReal − cantTeorica; el ajuste se aplica SOLO como movimiento de kardex (D3, motor común de F0 — jamás editar saldos)
- Pantallas del cíclico: alta (PC), conteo (MÓVIL prioritario — se cuenta caminando el almacén), consulta de exactitud + generación de ajuste (PC)
- Impreso R9 del grupo: hoja de conteo PDF SIN el teórico (conteo ciego), descargable desde la pantalla de alta
- 5S (CONDICIONADO: Alm_5s tiene 0 filas reales — confirmar con Daniel ANTES de construir; si dice que no, se descarta y se documenta): Reactivo5sDef (catálogo configurable A6, seed 16 reactivos ex-1s..16s) + Auditoria5s/Det con fecha y auditor; captura PC o móvil + histórico/tendencia
- Rutas REST backend/src/api/indicadores (submódulos ciclico/5s) con permisos granulares por submódulo; regenerar openapi.json + cliente del frontend EN ESTA etapa

**Entregables:**
- Migración Prisma (InventarioCiclico/Det + Reactivo5sDef/Auditoria5s/Det si 5S va) + seed de los 16 reactivos 5S (si va) y de los permisos nuevos
- Servicios de dominio con TSDoc (referencias doc 05 §B.2–B.3, D3/D4/D6, A6) + tests de integración del ciclo cíclico completo (alta congela → conteo ciego → ajuste por kardex, verificando que las existencias solo cambian por MOVIMIENTO)
- openapi.json regenerado + cliente tipado sincronizado
- 3–5 pantallas end-to-end con tests + E2E Playwright del flujo cíclico (alta→conteo→ajuste)
- Hoja de conteo ciego en PDF descargable desde la pantalla de alta
- Registro de la decisión de Daniel sobre 5S (construir/descartar) en la minuta de la fase

**Criterio de cierre:**
- CI en verde y aprobación del reviewer contra doc 05 §B.2–B.3 y D3/D4/D6/A6
- Ciclo cíclico verificado: el teórico queda congelado al alta, el conteo es ciego, y el ajuste aparece como MOVIMIENTO de kardex (las existencias nunca se editaron directo)
- La hoja de conteo PDF NO muestra el teórico
- Decisión 5S tomada y ejecutada (construido o descartado, sin ambigüedad)
- Verificación de Gabriel completada antes del PR a prueba

**Verificación de Gabriel:**
- [ ] Pregunta a Daniel (un mensaje): ¿la auditoría 5S se usa o se usará? (Alm_5s tiene 0 filas) — pasa la respuesta al equipo ANTES de que arranque esa pieza
- [ ] Inventario cíclico completo con docker compose up: da de alta un conteo de un modelo×color×talla×almacén con existencia conocida; ANOTA el teórico congelado; haz un movimiento de inventario de ese artículo (entrada o salida); regresa al conteo y confirma que el teórico NO cambió (quedó congelado al alta)
- [ ] Imprime la hoja de conteo y confirma que NO muestra el teórico (conteo ciego); captura el conteo desde el CELULAR con una cantidad distinta
- [ ] Genera el ajuste y verifica en el kardex (módulo Inventarios) que apareció un MOVIMIENTO de ajuste por la diferencia y que la existencia nueva cuadra — nunca se editó el saldo directo
- [ ] Si 5S va: captura una auditoría por reactivos desde el celular y revisa la tendencia; si se descartó, confirma que quedó documentado en la minuta
- [ ] Entra con un usuario sin los permisos de estos submódulos y confirma que no los ve

**Equipo:** 1 coder + 1 reviewer (cadena esquema→dominio→API→UI; sin paralelismo intra-etapa)

**Referencias:**
- Documentacion_MJD/05-Indicadores.md §B.2 (Inventario Cíclico Alm_InvCic), §B.3 (Auditorías 5S Alm_5s), Observaciones 2 y 3
- Documentacion_MJD/MEJORAS.md módulo 05 §2 (normalizar 1s..16s); DECISIONES.md D3, D4, D6
- PLANMAESTRO.md §4 (kardex único D3, granularidad D4, A6 vía patrón tallas), §9.2 (A2, A7)
- docs/modulos/patron-crud.md y el motor de kardex de F0 (backend/src/comun) para el ajuste del cíclico
- Volcado viejo: consulta Ind_Alm_IC; forms Alm_IC_Alta/Cont/Consulta, Alm_5s_Revision; TABLAS/Alm_InvCic.csv (542 filas) y Alm_5s.csv (0 filas) (Respaldo CLAUDE/, latin-1)

---

## F7-E6 · ETL histórico + cuadre numérico v1 vs v2 + documentación y cierre de fase — ⬜ pendiente

**Objetivo:** Migrar el histórico real de costos, EDR e indicadores desde los CSV del sistema viejo con cuadre numérico obligatorio (plan §7), documentar los módulos 10 y 11 en docs/modulos/, y cerrar la fase verificando el criterio de salida completo (costos y tableros cuadran contra el cálculo manual de Daniel) en el ambiente de prueba. Va al final porque necesita todas las tablas y servicios de E1–E5.

**Alcance:**
- ETL en backend/migracion (TypeScript, latin-1, IDEMPOTENTE y re-ejecutable, REUSANDO los servicios de dominio de E1–E5 — mismas validaciones que la captura, plan §7): CostoOrd.csv (2,513 filas) → CostoOrden mapeando los 6 componentes + Costo + Observaciones, ligando a las órdenes migradas (IdOrdenes)
- ETL EDR — regla de mapeo EXPLÍCITA acorde a la forma real del dato viejo (verificada: EdoResult.csv son 44 encabezados mensuales GLOBALES sin IdEmpresas; EdoResultDet.csv son 1,431 líneas CON IdEmpresas): si el esquema de E2 quedó con encabezado global (propuesta default), los 44 encabezados migran 1:1 a Edr y las líneas a EdrLinea con su idEmpresa; si la decisión con Daniel lo dejó por empresa, se aplica la regla acordada con él (migrarlos como 'EDR consolidado histórico' marcado como tal, o asignarlos a la empresa principal) — los gastos históricos NO se reparten entre empresas inventando una regla. En ambos casos el CostoViejo migra a EdrLinea.costoHistorico (dato congelado, solo informativo) y toda valuación NUEVA usa costo actual (D1) — la consulta histórica muestra ambos sin mezclarlos. La regla completa (encabezados + costoHistorico) se decide con Daniel ANTES de correr y queda en el acta de política de cuadre.
- CUADRE HISTÓRICO DEL EDR DEFINIDO A NIVEL CONSISTENTE CON EL DATO VIEJO: Ventas y Costo histórico cuadran por mes Y por empresa (desde las líneas, que sí traen IdEmpresas); Gastos/Intereses/Bonificaciones/Otros y el Resultado cuadran a nivel mensual CONSOLIDADO (los encabezados viejos son globales — no existe el dato por empresa para cuadrar)
- ETL indicadores: IP_Personal (7) + IP_Actividades (25) + Alm_Prd_Act (11) → PersonalArea/ActividadProductividad; IP_Productiv (1,870) + Alm_Prd (195)/Alm_Prd_Det (910) → RegistroProductividad (aplanar encabezado-día + detalle por cliente/actividad); IP_InfConf (160) → FichaVerificacion desnormalizando los 8 checks fijos a items de reactivo; IP_MuesPend (21) → Muestrario; Alm_InvCic (542) → InventarioCiclico con CantProscai como 'teórica histórica de origen externo retirado' (D6 — solo consultable, NO comparable contra kardex v2) resolviendo ModeloIC (texto) contra el catálogo migrado; Alm_5s (0 filas) → nada que migrar (solo seed de reactivos, ya hecho en E5 si 5S se construyó)
- NO se migra: KPIs de RC (se derivan de RutaOrden, doc 08: la RC vieja no se usa); Propiedades.UtilidadSujerida/Regalias (verificado: ya migrados en el seed de F0 → ConfiguracionEmpresa)
- Reporte de cuadre obligatorio v1 vs v2 (plan §7): conteos y sumas por entidad — 2,513 costeos y Σ Costo; 44 meses y 1,431 líneas EDR con Ventas/Costo histórico por mes y por empresa + Resultado consolidado por mes; 1,870+910 registros de productividad; 160 fichas; 21 muestrarios; 542 conteos — las inconsistencias de origen se LISTAN para decisión de Daniel, no se corrigen en silencio; este reporte alimenta el cuadre global de F9
- Documentación de cierre: docs/modulos/costos-edr.md y docs/modulos/indicadores.md (cómo quedaron construidos los módulos 10 y 11: modelo, servicios, fórmulas, decisiones aplicadas, referencias a Documentacion_MJD sin copiarla — ADR-0002)
- Verificación funcional completa de la fase en el ambiente de prueba (Railway): recorrido orden→costo→EDR→tableros con datos migrados, cuadrando contra el cálculo manual de Daniel (criterio de salida §6 y eslabón final de la prueba reina §10)

**Entregables:**
- Scripts de ETL por entidad en backend/migracion con tests de integración (corren contra extractos reales de los CSV en latin-1) y prueba de idempotencia (doble corrida = mismo resultado)
- Reporte de cuadre v1 vs v2 generado por el ETL (conteos, sumas, lista de inconsistencias de origen)
- docs/modulos/costos-edr.md y docs/modulos/indicadores.md
- Acta de la política de cuadre histórico del EDR (decisión con Daniel: regla de mapeo de los 44 encabezados globales + costoHistorico congelado + valuación nueva D1) registrada en DECISIONES.md si es decisión nueva
- Checklist de verificación de fase ejecutado en el ambiente de prueba con evidencia (capturas)

**Criterio de cierre:**
- CI en verde, ETL aplicable en limpio (job de migración del CI) y aprobación del reviewer
- Cuadre EXACTO en el reporte: conteo y Σ Costo de CostoOrden v1 = v2 (2,513); 44 meses y 1,431 líneas de EDR migradas; Ventas y Costo histórico (con costoHistorico) cuadran por mes y por empresa, y el Resultado histórico cuadra por mes a nivel CONSOLIDADO contra lo reportado por el sistema viejo; conteos de productividad/fichas/muestrarios/cíclico v1 = v2
- Toda inconsistencia de origen está LISTADA y decidida con Daniel (ninguna corregida en silencio)
- Criterio de salida de F7 (plan §6) verificado en el ambiente de prueba: costos y tableros cuadran contra el cálculo manual de Daniel
- Documentación de módulos publicada en docs/modulos/
- PR de prueba a main solo después de la verificación en vivo de Gabriel

**Verificación de Gabriel:**
- [ ] Antes de correr el ETL: confirma con Daniel la regla de mapeo de los 44 encabezados globales del EDR (consolidado histórico o empresa principal, según el esquema que quedó en E2) y que está en el acta
- [ ] Corre el ETL de la fase (comando documentado en backend/migracion/README) DOS veces seguidas y confirma que la segunda corrida no duplica nada (mismos conteos)
- [ ] Abre el reporte de cuadre y verifica los números gordos: 2,513 costeos, Σ Costo igual a la suma del CSV viejo, 44 meses de EDR, 1,431 líneas — si algo no es exacto, no se cierra
- [ ] Abre en el sistema un mes HISTÓRICO del EDR y compáralo contra lo que el viejo reportaba para ese mes (Daniel tiene esos números): Ventas y Costo por empresa desde las líneas, y Gastos/Resultado a nivel del mes completo (consolidado, como los reportaba el viejo) — debe cuadrar usando el costoHistorico congelado
- [ ] Confirma que ese mismo mes muestra clara la separación: valuación histórica congelada vs lo que daría a costo actual (D1) — sin mezclarse
- [ ] Abre un conteo cíclico migrado y confirma que su teórica aparece como dato histórico de origen externo (Proscai retirado), no comparada contra el kardex v2
- [ ] Revisa la lista de inconsistencias de origen con Daniel y registra qué se decidió de cada una
- [ ] En el ambiente de prueba de Railway, recorre el ciclo completo con los datos migrados: orden real → su costo → el EDR del mes → tableros KPI, y cuadra cada número contra el cálculo manual de Daniel (el criterio de salida de la fase)
- [ ] Lee docs/modulos/costos-edr.md y docs/modulos/indicadores.md y confirma que reflejan lo construido (es el handoff para F9)
- [ ] Da el visto bueno para el PR de prueba a main

**Equipo:** 1 coder + 1 reviewer (el ETL es una cadena sobre los mismos servicios de dominio y el cuadre de EDR depende del de costos; no paralelizable)

**Referencias:**
- PLANMAESTRO.md §7 (migración: idempotente, reusa servicios, reporte de cuadre, inconsistencias se listan), §6 (criterio de salida F7), §10 (prueba reina), §8.4 (docs/modulos)
- Documentacion_MJD/06-Costos-y-EDR.md §4 (CostoViejo/CostoBueno — la trampa del cuadre histórico; tabla EdoResult global por mes + EdoResultDet con IdEmpresas) y DECISIONES.md D1, D6
- Respaldo CLAUDE/TABLAS/: CostoOrd.csv, EdoResult.csv (encabezado global verificado: IdEdoResult, Fecha, Gastos, Intereses, Bonificaciones, Otros, DescOtros — sin IdEmpresas), EdoResultDet.csv (con IdEmpresas por línea), IP_Personal.csv, IP_Actividades.csv, IP_Productiv.csv, IP_InfConf.csv, IP_MuesPend.csv, Alm_Prd.csv, Alm_Prd_Det.csv, Alm_Prd_Act.csv, Alm_InvCic.csv, Alm_5s.csv (TODOS latin-1 — CLAUDE.md §4)
- backend/prisma/seed.ts (Propiedades → ConfiguracionEmpresa YA migrado en F0: no repetir)
- ETLs previos de F1–F6 en backend/migracion como patrón (mismo estilo idempotente)

---

## Notas de la fase (supuestos del diseño)

SUPUESTOS VERIFICADOS EN CÓDIGO Y EN EL VOLCADO: (1) ConfiguracionEmpresa.utilidadSugerida y .regaliasBase y Empresa.paraEdr YA existen desde F0 (backend/prisma/schema.prisma + seed.ts con valores reales de Propiedades.csv: 50/10) — F7 los consume; el ETL de Propiedades NO entra a E6 porque el seed de F0 ya lo hizo; solo se agrega ConfiguracionEmpresa.jornadaBaseAlmacen en E4. (2) pg-boss NO está cableado aún en backend/ (verificado, cero hits): el plan §1 lo asigna también a F5 (recálculo CPM) — supuesto: F5 lo introduce primero y E3 lo reusa; si F5 no lo hizo, E3 lo cablea como motor común con su ADR. (3) FORMA REAL DEL EDR VIEJO (verificada en EdoResult.csv/EdoResultDet.csv): encabezado mensual GLOBAL (gastos/intereses/bonificaciones sin empresa) + empresa POR LÍNEA en el detalle — el esquema Edr de E2 NO se congela hasta resolver con Daniel si los gastos van globales o por empresa, y el ETL de E6 trae la regla de mapeo explícita de los 44 encabezados (los gastos históricos no se reparten inventando una regla; el cuadre histórico de Gastos/Resultado es a nivel mensual consolidado, el de Ventas/Costo sí por empresa desde las líneas). (4) Lista de precios (ListaPreciosEd.txt): PrecioVenta=CInt((costo×2)/0.9) — TRES factores hardcodeados (utilidad ×2, regalías /0.9 sobre el PRECIO, redondeo CInt); E1 parametriza utilidad Y regalías (ya seedeadas 50/10) y define la regla de redondeo; ese mismo SQL evidencia que en el precio sugerido las regalías van SOBRE LA VENTA — insumo para la pregunta abierta de la base de regalías del COSTEO (¿sobre costo o sobre venta?), que se confirma contra el cálculo manual de Daniel. (5) NoCost existe en Ordenes.csv (columna 14) pero la tabla Ordenes del v2 la construyó F2: E1 verifica al llegar y lo agrega con su migración si falta (backfill en E6 si el ETL de F2 no lo trajo). (6) Variantes del índice IP en Ind_IP_Productividad: RealSemanal=/5, RealMensual=/30, PorcentajeTrabajado=horasTrabajadas/horasBase — E4 define explícitamente si las vistas semana/mes replican esas heurísticas o agregan los diarios (no se deja a interpretación del coder). RIESGO MAYOR DE LA FASE (D2 abierto): Daniel no ha enumerado por qué dejó de usar Costos; la sesión D2 + el dataset de cuadre (1 orden costeada a mano + 1 mes de EDR + 1 margen de pedido) son INSUMO BLOQUEANTE de E1 y deben conseguirse ANTES de congelar diseño — si se atrasan, reordenar: E4 y E5 son totalmente independientes y E3 solo depende de F5/F6; las tres pueden adelantarse. DECISIONES A VALIDAR CON DANIEL DURANTE LA FASE (la 1 bloquea el arranque de E1; la 2 bloquea congelar el esquema de E2 — ambas se resuelven en la MISMA sesión): (1) problemas del módulo viejo de Costos + dataset de cuadre (E1); (2) ¿gastos/intereses/bonificaciones del mes del EDR globales como hoy o por empresa hacia adelante? (E2/E6); (3) base del % de regalías del costeo (¿sobre costo o sobre venta? — la lista de precios evidencia sobre-venta en el precio sugerido; se verifica contra su cálculo manual, E1); (4) regla de redondeo del precio sugerido (E1); (5) fecha contra la que se mide 'entrega a tiempo' (E3); (6) casos especiales del EDR automático (parciales/devoluciones/segundas, E2); (7) construir o descartar 5S (0 filas reales, E5); (8) política del cuadre histórico del EDR (mapeo de encabezados globales + costoHistorico congelado, E6 — propuesta ya perfilada). ALCANCE DESCARTADO DOCUMENTADO: la auto-alimentación de la productividad desde movimientos/recibos (doc 05 Observación 4, prioridad 🟢) se descarta para F7 y se registra en MEJORAS.md como mejora futura (E4); opcionalmente se confirma con Daniel en la sesión. COSAS QUE PERTENECEN A OTRA FASE O SE ACOTAN: la fuente única del precio de maquila (Ordenes.MaquilaOrd vs EsMa_Recibos.PrecioEsMa vs CostoOrd.MaquilaCost, doc 07 §6.4) se DECIDE en E1 pero el dato lo produce F6/EsMa — si F6 no dejó expuesto el 'precio realmente pagado', E1 usa el de la orden y se documenta la deuda; el traslape FichaVerificacion↔R5 (ficha técnica estructurada) pertenece al módulo 12 Documental que NO tiene fase propia en plan §6 — E4 construye el checklist configurable con hook para derivar reactivos si R5 llega después (no duplicar); la Lista de precios la ubica el menú viejo en Modelos (F1) pero depende del motor de pre-costo — se entrega en E1 de F7 SALVO que F1 ya la haya entregado (verificar al llegar); PreCostoSnapshot no se construye por default (el pre-costo es cálculo de dominio — verificado que PreCostos no es tabla en el viejo), solo si la sesión D2 lo pide; la entrega a cliente del v2 es EtapaMovimiento tipo entrega_cliente de F3 (PLANMAESTRO §4) — E2 la consume verificando la entidad real al llegar ('Entregas' del viejo es flujo M de maquila, trampa de nomenclatura); los impresos no listados (orden, nota de salida, OC, recibos, EsMa, ficha de estampado, auditoría, inventario de telas) son de F2–F6; el cuadre global y los ≥10 años de historial son de F9 — E6 entrega el reporte de cuadre de SU dominio como insumo. SECUENCIA Y PARALELISMO (6 etapas, dentro del rango 3–7): E1→E2 es cadena dura (EdrLinea referencia CostoOrden y la decisión del esquema EDR sale de la sesión de E1); E3, E4 y E5 son independientes entre sí y de E1/E2 — el orden E1,E2,E3,E4,E5,E6 propuesto respeta la verificación por etapas de Gabriel (no soltar todo el enjambre), pero E3/E4/E5 son los comodines si algo bloquea; tras partir la antigua E4 ya NO hay paralelismo intra-etapa obligatorio (cada etapa es 1 coder + 1 reviewer); el único paralelismo opcional que queda es el de E3 (páginas de tableros de calidad/WIP tras congelar el contrato OpenAPI).
