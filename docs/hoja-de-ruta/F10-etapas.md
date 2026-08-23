# F10 — Migración + Go-live · desglose en etapas

> Parte de la hoja de ruta viva ([`HOJA-DE-RUTA.md`](../../HOJA-DE-RUTA.md), raíz del repo).
> Una sesión nueva lee `CLAUDE.md` → `PLANMAESTRO.md` → `HOJA-DE-RUTA.md` → la ficha de la fase activa.
>
> **Entrega de la fase (plan §6):** ETL integrado de catálogos + ≥10 años de historial + saldos; paralelo con CONTROL viejo; corte final.
> **Criterio de salida:** Saldos v2 = saldos Access en fecha de corte; usuarios operando.
> **Estado:** ⬜ pendiente — el desglose se confirma/ajusta al arrancar la fase.

---

## 🚨 Reglas de go-live del ETL (escritas el 11-ago-2026 — leer ANTES de arrancar la fase)

Daniel, 11-ago-2026: _"Las bases de datos de Control no están actualizadas. Cuando pongamos en producción, subiré las bases de datos de ese momento para migrar la última info. Es decir, habrán algunas órdenes más y más información."_ Una auditoría de los 17 ETL comprobó que **ese re-volcado, tal como estaba, no funcionaba**. Se arreglaron en código las dos causas graves y se escribieron estas cuatro reglas, que son las que vuelven inocuo todo lo demás. **El runbook operativo completo vive en [`backend/migracion/README.md` §Reglas de go-live](../../backend/migracion/README.md)** — aquí queda el resumen y la liga, para no tener dos verdades.

1. **REGLA DURA — el ETL de documentos corre UNA sola vez, sobre base LIMPIA.** Después de eso ningún ETL de documentos se vuelve a correr sobre esa base. **NO se construye un modo "actualizar"**: se descartó a propósito (la migración es un evento, no un sincronizador). **Y si una corrida se INTERRUMPE, se vacía la base y se empieza de nuevo** — no se retoma: con folios duplicados en el origen, el camino de recuperación puede mapear la fila hermana al documento equivocado, en silencio. Es esta regla la que hace inocuos los tres riesgos que se decidió NO arreglar en código (BOM y RC destructivos al re-correr · cambios a documentos ya migrados que no se recogen · mapeo posicional de renglones de pedido) — ver `HOJA-DE-RUTA.md` §4.
2. **`etl-ipt` y `etl-telas` NO se corren en el go-live.** El inventario de PT (§Post-F9.25) y el de telas (§Post-F9.11 punto 5) arrancan del **conteo físico** de Daniel. ⚠️ Correrlos **después** del conteo lo **PISA** (existencia = Σ movimientos, D3).
3. **`ETL_DESDE=2025` se exporta ANTES del primer comando** y vale para toda la sesión. Si se olvida en uno solo, ese ETL desalinea a todos los demás. Los **once** ETL que recortan imprimen la ventana que aplicaron, así que "Ventana temporal: DESACTIVADA" en uno de ellos = ese ETL corrió mal. ⚠️ **Con UNA excepción: `etl-historico-ordenes` la imprime DESACTIVADA a propósito** —el archivo histórico existe justamente para guardar lo que la ventana deja fuera— y lo dice en su propia línea. No abortes por esa.
4. **Los ensayos en `prueba` se hacen sobre base VACIADA**, nunca re-corriendo encima. La base de `prueba` ya tiene la foto vieja **y** documentos capturados a mano por Daniel: un ensayo encima mide otra cosa y activa la colisión de folio.

**Red de seguridad (construida el 11-ago-2026):** los cinco loaders con folio propio ya no dan por "el mismo documento" a cualquiera que ocupe el folio. `backend/migracion/comun/colision-folio.ts` distingue **tres** desenlaces: la **recuperación** de una corrida cortada (lo creó el ETL y nadie más lo reclama, se mapea y sigue); el **folio duplicado en el ORIGEN** (el Access trae dos documentos con ese folio — entra uno, el otro se reporta con todo lo que se va con él, y **no es un problema de la base de destino: no vacíes nada por esto**); y la **COLISIÓN con v2** (el folio lo ocupa algo capturado en el sistema nuevo — ahí sí, la base no estaba limpia). En los dos últimos **no se mapea, no se crea y se REPORTA**. Antes, la colisión escribía el mapeo `IdOrdenes(Access) → orden de v2` y todos los hijos del volcado (cortes, envíos, recibos, cargos EsMa, costos, RC, auditorías) se pegaban a la orden equivocada, en silencio.

**Impacto en el desglose de abajo:** E3 ya NO incluye la carga del kardex de PT ni la de telas como parte del go-live (regla 2); E5 (saldos iniciales) es el que recibe el conteo físico; y el "ensayo general del corte" de E7 se especifica **sobre base vaciada** (regla 4).


## F10-E1 · Cimientos del ETL integrado: extracción al corte + transporte a la nube + staging + orquestador con 'modo migración' + consola — ⬜ pendiente

**Objetivo:** Construir la columna vertebral sobre la que corre TODA la fase (staging, bitácora de corridas, mapa de IDs, incidencias, orquestador idempotente, transporte extracción→nube) y despejar PRIMERO el riesgo técnico mayor: leer los 4 .mdb de producción CON contraseña vía access-parser. Va primero porque cada etapa posterior corre encima de esta tubería, y si el spike del .mdb falla hay que activar el plan B (exportación asistida) que cambia la logística de todo el paralelo.

**Alcance:**
- Tablas nuevas en esquema `migracion` (separado del modelo de dominio): MigracionCorrida (fuente, fecha, dominio, conteos origen/destino, duración, resultado), MigracionMapaId (id-viejo→id-nuevo por entidad, clave del upsert idempotente), MigracionIncidencia (huérfanos, negativos, duplicados, con campo de disposición)
- Esquema de staging: aterrizaje crudo de las 116 tablas exportadas (columnas texto, sin transformar), separado del dominio. REGLA EXPLÍCITA: staging aterriza las 116 crudas (para cuadre y trazabilidad); la carga a dominio solo procesa las marcadas 'migra' en el inventario de disposición
- ExtractorFuente (TS, backend/migracion): parser CSV REAL (campos con saltos de línea embebidos — Ordenes.csv: 7,049 líneas físicas con encabezado = 5,451 filas reales; Maquileros.csv: 1,712 físicas = 496 reales; NotasDet.csv: 29,113 físicas = 11,459 reales), encoding latin-1 EXPLÍCITO, fechas SIEMPRE dd/MM/yyyy HH:mm:ss (jamás por locale), asserts de rango de fechas por tabla. REGLA DE ORO escrita en el README y como test: 'conteo de referencia = filas CSV parseadas, JAMÁS líneas físicas (wc -l miente con saltos embebidos)'
- Pipeline de extracción al corte (Python, backend/migracion/extractor): access-parser sobre los .mdb (MJD_Taine 74 tablas, MJD_Nauc 33, MJD_Prop 6, MJD_Excel 1) → CSV + MANIFIESTO (conteos de filas reales y checksums por tabla, generado al extraer — es la vara del cuadre de conteos); SPIKE INMEDIATO de lectura con contraseña Jet; plan B documentado: exportación asistida desde Access (paso manual Gabriel/Daniel)
- Transporte extracción→nube (cierra la logística oficina→Railway): el pipeline empaqueta extracción+manifiesto y los sube a un prefijo `migracion/` del bucket R2; el orquestador consume la corrida desde DOS fuentes intercambiables — carpeta local (docker compose, sin depender de R2) o prefijo R2 (Railway `prueba`/producción y cuadre diario del paralelo); alternativa documentada en el README: ETL corriendo local apuntando a la DATABASE_URL del environment. Se decide y documenta aquí; se prueba en nube en el primer ensayo de E7
- OrquestadorMigracion: corridas por dominio en orden topológico, cada lote en transacción (A2), upsert vía MigracionMapaId (re-ejecutable N veces sin duplicar), errores y violaciones → MigracionIncidencia (nunca se fuerzan), auditoría con usuario 'migración' (A7)
- Contrato CargadorViaDominio con 'MODO MIGRACIÓN' explícito (antídoto del doble conteo): los ETL de dominio cargan SOLO vía servicios de dominio (A1, mismas validaciones de datos — ningún INSERT directo que brinque reglas) pero SIN efectos derivados — un recibo migrado NO genera cargo EsMa, NI entrada al kardex PT, NI avance de RC (cada tabla v1 se migra desde su propia fuente: Recibos de Recibos.csv, EsMa de EsMa.csv, kardex PT de IPT_Movs.csv) — y SIN consumir secuencias de folios (los folios v1 se insertan tal cual; A3 se calibra al cierre de la corrida)
- Endpoints /api/admin/migracion (listar/lanzar corridas, estado, conteos origen/destino por dominio) con permiso de admin (A4) + pantalla Admin → Migración (consola de corridas, solo PC)
- Inventario de disposición de las 116 tablas (migra / archivo / descarta) — versión 1: formaliza que las 11 Prom_* (D9), 'Errores de pegado', ITelas_Temp, Prom_CodigosTemp, OrdCompraExcel y 'Elementos del Panel de control' NO migran; UsuariosLog (26,086) y UsuariosLogAnt (33,439) van SOLO a archivo; y deja constancia de que las ~17 tablas de trabajo de impresos del front-end (OrdImp/OrdImpDet/OrdImpTela/OrdImpHab/OrdImpBor/OrdImp_Cor, NotasImp/NotaEntImp/NotasVer, OrdCompraImp/OrdCompraImpAdm/OrdCompraImpInter/OrdCompraVer, ReciboMaquilaImp/ReciboMaquilaImpEst/ReciboEntMaquilaImp, FichaEstImp — REQUISITOS-NUEVOS.md R9) NO forman parte de los 116 CSV y tienen disposición 'no migra'

**Entregables:**
- backend/migracion con extractor, transporte (local/R2), staging, orquestador y motores de corrida/mapa/incidencia, todo con TSDoc
- Migración Prisma del esquema `migracion` + staging
- Tests con archivos REALES de 'Respaldo CLAUDE/TABLAS/': Ordenes.csv parsea 5,451 filas (no 7,048 físicas), Maquileros.csv parsea 496 (no 1,711), NotasDet.csv parsea 11,459 (no 29,112), eñes/acentos intactos (latin-1), fecha '04/01/2005 00:00:00' parsea como 4-ene, idempotencia (2 corridas = mismos conteos), conteos de staging = conteos del manifiesto
- Contrato CargadorViaDominio versionado con el 'modo migración' documentado (sin efectos derivados, sin consumir folios) — es la interface que E2/E3 implementan
- Pipeline Python documentado (README de backend/migracion: extraer→manifiesto→subir a R2 o carpeta local→staging→transformar/cargar, repetible) incluida la regla 'filas parseadas, jamás líneas físicas'
- Resultado escrito del spike .mdb con contraseña (funciona / plan B activado) en docs/
- Pantalla Admin → Migración funcionando; OpenAPI regenerado + cliente tipado del frontend sincronizado
- Inventario de disposición de 116 tablas v1 (en docs/, para firmarse en E3)

**Criterio de cierre:**
- La corrida 'staging' aterriza las 116 tablas crudas y la consola muestra conteos de filas PARSEADAS correctos: Ordenes 5,451 · OrdenesDet 9,511 · Usuarios 137 · Maquileros 496 · TelasColAlm 113,219 · NotasDet 11,459 — y cuadran contra el manifiesto del extractor
- Re-ejecutar la corrida deja conteos idénticos (idempotente, sin duplicados)
- El orquestador consume la misma corrida desde carpeta local y desde el prefijo R2 (o la alternativa local→DATABASE_URL quedó documentada y probada contra una BD efímera)
- Decisión del spike .mdb escrita y aceptada (lectura con password OK, o plan B de exportación asistida con su procedimiento manual documentado)
- CI en verde (tests del parser con archivos reales incluidos, en particular Maquileros 496 y NotasDet 11,459); reviewer aprobó

**Verificación de Gabriel:**
- [ ] Correr `docker compose up -d --build` en la raíz del repo y entrar a la app como admin
- [ ] Abrir Admin → Migración y lanzar la corrida 'staging' desde la pantalla
- [ ] Comparar en pantalla los conteos contra los verificados con parser real: Ordenes 5,451 · Usuarios 137 · TelasColAlm 113,219 · NotasDet 11,459 · Maquileros 496 (si la pantalla muestra 1,711 maquileros o 29,112 NotasDet, el parser está contando líneas físicas: es un BUG)
- [ ] Lanzar la MISMA corrida otra vez y verificar que los conteos NO se duplican
- [ ] Verificar que un texto con eñes/acentos (p. ej. un nombre de maquilero) se ve bien en staging (sin caracteres corruptos)
- [ ] Leer el doc del spike .mdb y confirmar con Daniel si la contraseña de los .mdb de producción está disponible para probar la extracción real
- [ ] Leer en el README cómo viaja la extracción de la oficina a Railway (R2 o alternativa) y confirmar que el paso manual que le toca a él/Daniel está claro

**Equipo:** 2 coders en paralelo (pieza A: pipeline Python access-parser/.mdb con contraseña + manifiesto + empaquetado/subida — lenguaje y carpeta propios; pieza B: staging + orquestador + contrato modo-migración + consola en TS) + 1 reviewer

**Referencias:**
- PLANMAESTRO.md §7 (migración: fuente, idempotencia, carga vía dominio) y §3 (estructura backend/migracion)
- PLANMAESTRO.md §5 ('recibo de maquila = UN servicio transaccional que genera WIP+IPT+EsMa+RC' — la razón de ser del modo migración) y Documentacion_MJD/03-Produccion.md (MeterInventario)
- CLAUDE.md §4 (encoding latin-1, CSV con saltos embebidos, access-parser)
- Documentacion_MJD/10-Modelo-Datos-y-Usuarios.md §1 (los 4 .mdb y sus tablas; contraseña en producción)
- DECISIONES.md D0 (transformar, no copiar) y D9 (Promoda excluido); MEJORAS A2, A7; REQUISITOS-NUEVOS.md R9 (tablas de impresión que no migran)
- docs/modulos/patron-crud.md (patrón de pantalla para la consola); docs/ESTADO-DESPLIEGUE.md y docs/GUIA-RAILWAY-R2.md (R2 para el transporte)

---

## F10-E2 · ETL de dominio bloque A: usuarios + empresas + catálogos + modelos/BOM + pedidos + órdenes + calibrador de folios — ⬜ pendiente

**Objetivo:** Re-ejecutar bajo el orquestador la primera mitad topológica del ETL de dominio: las entidades de las que TODO lo demás cuelga (usuarios, empresas, catálogos, modelos, pedidos, órdenes), con sus transformaciones clave (D4, D7, colores) y el calibrador de secuencias A3. Va después de E1 porque corre sobre su tubería y su contrato; va ANTES del bloque B porque producción, EsMa, costos y RC referencian estas entidades vía MigracionMapaId.

**Alcance:**
- PRIMERO los 137 registros Usuario (Usuarios.csv): TODOS migran como entidad inactiva y SIN credenciales (Usuarios.Clave en texto plano JAMÁS se copia ni se hashea), con su entrada en MigracionMapaId — son prerequisito de todo el historial que referencia IdUsuarios (IPT_Movs, CC_Auditorias, EsMa, RC, UsuariosLog/Ant). La capa de seguridad (better-auth, roles, activación) es de E6
- Empresas (8) → catálogos: Cliente 117 · Maquilero 496 · Proveedor 443 · Cortador 69 · Estampador 44 · Tela 877/TelasDis 109/TelasCategorias 21 · Avío (Habilitacion) 629 · Bordado 2,964 · Talla/CurvaTalla desde T1..T8+Ordenes.Tallas · Color deduplicado desde TelasColores 4,566 con tabla de equivalencias revisable (no automágica) · Almacén 56 · Temporada · EtiquetaM 81 · Departamentos 8 (si el inventario los dispone 'migra')
- Modelo 4,987 + BOM: ModeloTela 791 · ModeloAvio (ModelosHab) 7,163 · ModeloBordado (ModelosBor) 2,378 con banderas paraPreCosto/paraProduccion/paraCosto
- Pedido 1,529/PedidoDet 5,636 + PedidoReal 161/644 (OJO heredado: EntregasCliente está VACÍA — lo entregado vive en PedidosDet.EntregadoParcial/CantFalt)
- Orden 5,451 procesadas → 5,450 cargadas + OrdenLinea/OrdenLineaTalla (OrdenesDet 9,511 × T1..T8, D4); la orden Id=1 con IdModelos=0 va a MigracionIncidencia (caso de prueba real: 5,451 = 5,450 + 1)
- Transformación D7: Ordenes.Monarch (~99% de órdenes) → ClienteCampo 'No. de pedido del cliente' + OrdenReferencia indexada
- Toda carga vía servicios de dominio en MODO MIGRACIÓN (contrato E1: mismas validaciones, sin efectos derivados, sin consumir folios); violaciones → MigracionIncidencia
- CalibradorSecuencias (A3) como paso de cierre de TODA corrida: posiciona las secuencias de las entidades ya migradas (pedido, orden) en Max(folio migrado)+1 POR EMPRESA, con test de integración — E3 lo extiende a nota/OC/recibo sin reescribirlo

**Entregables:**
- ETLs del bloque A integrados y adaptados al contrato de E1, con tests por dominio sobre los CSV reales (conteos esperados = filas parseadas)
- Tabla de equivalencias de colores revisable, versionada y editable
- CalibradorSecuencias con test de integración A3: capturar un folio nuevo tras migrar no choca con ninguno migrado
- Reporte de conteos origen/destino por dominio desde la consola + lista inicial REAL de incidencias (la orden Id=1 incluida)
- Corrida del bloque A documentada con duración (objetivo parcial: minutos)
- Sin cambios de contrato API esperados (los endpoints genéricos de E1 cubren el reporte por dominio); si la consola crece, OpenAPI regenerado + cliente tipado sincronizado EN ESTA etapa

**Criterio de cierre:**
- La corrida del bloque A termina en verde con conteos de filas parseadas: Empresas 8 · Clientes 117 · Maquileros 496 · Proveedores 443 · Cortadores 69 · Estampadores 44 · Modelos 4,987 · ModelosHab 7,163 · ModelosBor 2,378 · Pedidos 1,529/5,636 · Ordenes 5,450 cargadas + 1 incidencia · OrdenesDet 9,511 (las diferencias quedan TODAS como incidencias, ninguna silenciada)
- Re-ejecutar la corrida N veces no duplica nada (verificado por conteos y por MigracionMapaId)
- Los 137 usuarios existen como entidad inactiva sin credenciales y NINGUNO puede hacer login
- El primer folio de pedido/orden capturado en vivo después de migrar es Max+1 por empresa (test automatizado + prueba manual)
- CI verde; reviewer aprobó

**Verificación de Gabriel:**
- [ ] Lanzar la corrida 'bloque A' desde Admin → Migración y cronometrarla
- [ ] Comparar conteos en pantalla: Maquileros 496 · Estampadores 44 · Modelos 4,987 · Ordenes 5,450 cargadas · OrdenesDet 9,511 · Usuarios 137
- [ ] Abrir las pantallas reales: un modelo conocido con su BOM completo (telas, avíos, bordados); una orden con su matriz color×talla (ya no T1..T8)
- [ ] Buscar una orden por su referencia Monarch (número de pedido del cliente) y encontrarla
- [ ] Verificar en Admin → Usuarios que los 137 usuarios migrados aparecen INACTIVOS y que uno de ellos NO puede hacer login
- [ ] Capturar un pedido y una orden nuevos y verificar que el folio continúa después del último migrado (no choca)
- [ ] Relanzar la corrida y verificar que ningún conteo se duplica
- [ ] Revisar incidencias: la orden Id=1 (IdModelos=0) aparece listada, no cargada a la fuerza ni desaparecida

**Equipo:** 1 coder + 1 reviewer (es una cadena topológica pura — usuarios→empresas→catálogos→modelos→pedidos→órdenes — sobre los mismos transformadores; paralelizar aquí violaría la regla de independencia)

**Referencias:**
- PLANMAESTRO.md §6 ('cada fase incluye su parte del ETL' — F10 integra y re-ejecuta) y §7 (transformaciones clave)
- DECISIONES.md D4 (tallas ilimitadas), D7 (Monarch→referencia del cliente), D9; MEJORAS A1, A2, A3, A7, A8/A9 (empresa heredada o default en tablas v1 sin IdEmpresas)
- Documentacion_MJD/01-Modelos.md §2 (BOM y banderas) y 02-Pedidos.md (pedidos/pedidos reales; EntregadoParcial/CantFalt)
- Documentacion_MJD/10-Modelo-Datos-y-Usuarios.md §4 y §6.3 (usuarios; claves en texto plano que NO se copian)
- Contrato CargadorViaDominio y regla de conteos parseados (entregables de E1)

---

## F10-E3 · ETL de dominio bloque B: producción M/A + kardex PT (IPT) + telas/kardex + OC/notas + EsMa + costos/EDR + RC/CC + indicadores + Propiedades + inventario firmado — ⬜ pendiente

**Objetivo:** Completar el ETL de dominio con todo el historial transaccional que cuelga del bloque A, aplicando a rajatabla el 'modo migración' (cada tabla v1 desde su propia fuente, cero derivación) e incluyendo el kardex de Producto Terminado (IPT_Movs) que es la ÚNICA fuente de las salidas de PT. Cierra con el inventario de disposición firmado. Va después de E2 porque todos estos dominios resuelven sus FKs contra el MigracionMapaId que el bloque A pobló.

**Alcance:**
- Producción: EtapaMovimiento/Det unificados — corte (Corte 6,967 + OrdenesDetCorte 12,946), costura M (Entregas 7,334 + OrdenesDetEntM 15,220 / Recibos 12,440 + OrdenesDetRecM 14,254), estampado A (EntregasEst 4,496 + OrdenesDetEntA 7,619 / RecibosEst 4,059 + OrdenesDetRecA 5,475) con TipoProceso (A = aplicación/estampado, NO almacén) y Recibos.TipoPrendas 1/2 → ALMACENES Primeras/Segundas. MODO MIGRACIÓN: los 12,440 recibos migrados NO generan cargos EsMa, NI entradas IPT, NI avance de RC
- Kardex de Producto Terminado (D3 — ALCANCE ANTES FALTANTE): IPT_Modelos 1,224 (ítem de PT, mapea IdOrdenes vía MigracionMapaId) + catálogos IPT_Almacenes 3 / IPT_TiposMov 19 / IPT_Generos 8 / IPT_TipoProd 23 / IPT_TipoPiezas 3 + IPT_Movs 5,072 / IPT_MovsDet 6,886 como movimientos del kardex v2 (con su IdUsuarios e IdRecibos mapeados). Es la única fuente de las salidas de PT (EntregasCliente está VACÍA): sin esto no cuadra el kardex PT contra IPT_Mod_Alm en E5
- Telas/kardex (D5): TelasColores 4,566 + Entradas 8,017/EntradasDet 11,041 + Salidas 16,525/SalidasDet 22,734 → Lote/LoteComponente con 'lotes de migración' sintéticos por tela×color (ligados a factura de Entradas cuando exista) MARCADOS para no contaminar trazabilidad futura; movimientos del kardex único (D3). TelasColAlm 113,219 aterriza en staging y sirve a E5 (saldos), no se carga como existencia editada
- OC/Notas: OrdenCompra 7,978 + OrdCompraDet 18,163 + OrdCom-Ord 19,600 con autorización/cancelación auditada; Nota 4,712 + NotaDet 11,459 como renglón histórico de TEXTO LIBRE sin impacto en inventario de avíos
- EsMa: EsMa 11,369 + EsMa_Recibos 7,401 (con EsEstampado y RevisionPendiente) + Abonos 554 + Desc 743 + Pagos 5,935 — migra TAL CUAL desde sus tablas (verdad contable, no derivar de Recibos: modo migración)
- Costos/EDR CONGELADOS (D1): CostoOrd 2,513, EdoResult 44 + EdoResultDet 1,431 conservando CostoViejo histórico sin re-valuar; indicadores IP_*/Alm_* (Alm_InvCic 542 con CantProscai tal cual, D6); RC: catálogos CP_*/RC_* → ProcesoDef/ProcesoDep/PlantillaRuta + RutaOrden (RC 181 filas); CC: CC_Catalogo 40 + CC_Auditorias 488 + CC_AuditoriasDet 15,296 (auditor mapeado a usuarios de E2)
- Propiedades (1 registro — ALCANCE ANTES FALTANTE): transformación a la configuración por empresa de v2 (módulo 13 del plan, 'ex-Propiedades'): ColchonCostura (insumo del CPM de RC), UtilidadSujerida, Regalias, IPT_Almacen_Default, fechas de inventario físico — o, si algún parámetro se decide capturar a mano, disposición explícita 'no migra — se configura manualmente' en el inventario
- Extensión del CalibradorSecuencias (A3) a nota, OC y recibo: al cierre de la corrida, Max(folio migrado)+1 por empresa
- Inventario de disposición de 116 tablas FIRMADO (incluye disposición explícita de las menores: Departamentos 8, ComentaOrd 795, ComentaComp 81, Ind_FechasSemanas 457, OrdenesHab 28,432, y la constancia de los impresos R9 que no son CSV)

**Entregables:**
- ETLs del bloque B integrados al contrato de E1, con tests por dominio sobre los CSV reales (incluido: la existencia PT derivada SOLO de IPT_Movs migrados es consistente, sin entradas dobles por recibo)
- Fixtures de MigracionMapaId precargado para que cada pieza se pruebe sin re-correr el bloque A completo
- Corrida completa (bloque A + B) documentada con duración total (objetivo: minutos, para permitir cuadre diario)
- Reporte de conteos origen/destino por dominio desde la consola + lista de incidencias actualizada (huérfanos Id=0, negativos, duplicados)
- Test de integración A3 extendido: folio nuevo de nota/OC/recibo tras migrar no choca
- Inventario de disposición de las 116 tablas firmado en docs/
- Sin cambios de contrato API esperados (consola de E1); si la consola crece, OpenAPI regenerado + cliente tipado sincronizado EN ESTA etapa

**Criterio de cierre:**
- La 'corrida completa' termina en verde con conteos de filas parseadas: Corte 6,967 · Entregas 7,334 · Recibos 12,440 · EntregasEst 4,496 · RecibosEst 4,059 · IPT_Movs 5,072 · IPT_MovsDet 6,886 · IPT_Modelos 1,224 · Entradas 8,017 · Salidas 16,525 · OrdenCompra 7,978 · OrdCompraDet 18,163 · OrdCom-Ord 19,600 · Notas 4,712 · NotasDet 11,459 · EsMa 11,369 · EsMa_Recibos 7,401 · Abonos 554 · Desc 743 · Pagos 5,935 · CostoOrd 2,513 · RC 181 · CC_Auditorias 488 · CC_AuditoriasDet 15,296 (diferencias TODAS como incidencias)
- Cero efectos derivados: el número de cargos EsMa = filas EsMa migradas (ni uno generado por recibo) y el número de movimientos del kardex PT = filas IPT_Movs/Det migradas (verificado por test)
- Re-ejecutar la corrida completa N veces no duplica nada
- El primer folio de nota/OC/recibo capturado en vivo es Max+1 por empresa
- Tiempo total de la corrida completa aceptable para cuadre diario (minutos, no horas)
- ColchonCostura y demás parámetros visibles en la configuración por empresa (o su disposición manual firmada)
- CI verde; reviewer aprobó; inventario de disposición firmado

**Verificación de Gabriel:**
- [ ] Lanzar la 'corrida completa' desde Admin → Migración y cronometrarla (debe terminar en minutos)
- [ ] Comparar conteos en pantalla: Recibos 12,440 · IPT_Movs 5,072 · IPT_MovsDet 6,886 · OrdenCompra 7,978 · Notas 4,712 · NotasDet 11,459 · EsMa 11,369 · CC_Auditorias 488 · CC_AuditoriasDet 15,296
- [ ] Abrir el estado de cuenta de un maquilero conocido en EsMa y verificar que sus renglones son los re-capturados de v1 (no derivados de recibos): el total de cargos del maquilero debe coincidir con sus filas en EsMa.csv
- [ ] Abrir el kardex PT de un modelo conocido y ver sus movimientos históricos (entradas por recibo Y salidas) venidos de IPT_Movs
- [ ] Capturar una nota y una OC nuevas: el folio continúa después del último migrado
- [ ] Abrir la configuración por empresa y ver ColchonCostura con el valor real de Propiedades
- [ ] Relanzar la corrida completa y verificar que ningún conteo se duplica
- [ ] Revisar y firmar el inventario de disposición de las 116 tablas

**Equipo:** 2 coders en paralelo (pieza A: producción M/A → kardex PT/IPT → telas/kardex; pieza B: OC/notas → EsMa → costos/EDR → RC/CC → indicadores → Propiedades) + 1 reviewer — las piezas NO dependen entre sí: ambas dependen solo del bloque A (E2, ya cerrada) vía MigracionMapaId, con fixtures precargados para probarse de forma aislada; archivos sin solape

**Referencias:**
- PLANMAESTRO.md §7 (transformaciones clave) y §5 (módulo 13: configuración por empresa ex-Propiedades)
- Documentacion_MJD/03-Produccion.md (M = costura, A = estampado/aplicación, NO almacén; MeterInventario — lo que el modo migración NO debe disparar; OC con autorización)
- Documentacion_MJD/04-Inventarios.md §A.1 (IPT_Modelos/IPT_Movs/IPT_MovsDet/IPT_TiposMov — el kardex PT; TipoPrendas 1/2 = almacenes Primeras/Segundas) y §B (telas dos componentes)
- Documentacion_MJD/07-EsMa-Estados-de-Cuenta-Maquileros.md §2 (EsMa es re-captura manual: migra tal cual, no se deriva)
- Documentacion_MJD/08-Ruta-Critica.md (el valor está en los catálogos CP_*/RC_*, no en el histórico de 181 filas); 09-Control-de-Calidad.md; 05-Indicadores.md; 06-Costos-y-EDR.md
- Documentacion_MJD/10-Modelo-Datos-y-Usuarios.md §5 (Propiedades: ColchonCostura, UtilidadSujerida, Regalias) y §6.4 (→ configuración por empresa)
- DECISIONES.md D1 (costos congelados), D3 (kardex), D5 (lotes), D6 (Proscai); MEJORAS A1, A2, A3, A7

---

## F10-E4 · Archivo histórico de solo lectura + frontera de 10 años por grafo — ⬜ pendiente

**Objetivo:** Separar todo lo anterior a la ventana de 10 años (≈2005–2015) a un esquema de SOLO LECTURA consultable, cortando por GRAFO completo (cada cadena pedido→orden→movimientos→EsMa→costos viaja junta) para que no queden FKs rotas entre la BD viva y el archivo. Va después de E3 porque clasifica sobre el universo completo ya migrable, y ANTES de los saldos (E5) porque el ajuste de saldo inicial depende de qué historial quedó vivo.

**Alcance:**
- Esquema `archivo` de solo lectura (mismo Postgres, esquema separado; sin servicios de escritura)
- ServicioArchivoHistorico: clasificador por grafo — una orden de 2017 colgada de un pedido de 2015 NO se parte; la cadena completa va a un solo lado; la frontera se decide por cadena, no por fecha de tabla individual
- UsuariosLog (26,086) + UsuariosLogAnt (33,439): van SOLO al archivo histórico (nunca a la BD viva); sus IdUsuarios resuelven contra los 137 usuarios migrados en E2
- Endpoints /api/archivo (consulta) + pantalla 'Archivo Histórico': búsqueda por folio, modelo, cliente y referencia del cliente; PC + móvil (solo consulta); permiso RBAC propio (A4)
- Integración al orquestador: la separación corre como paso de la corrida completa (idempotente, re-ejecutable)

**Entregables:**
- Servicio con tests, incluido el caso real de cadena que cruza la frontera (pedido 2015 → orden 2017 → recibos 2018: viaja completa, no se parte)
- Test de integridad: cero FKs rotas en BD viva y cero en archivo tras la separación; suma vivo+archivo = total origen por entidad
- Pantalla de consulta del archivo (PC + móvil) con su API
- OpenAPI regenerado + cliente tipado sincronizado
- Documentación de la regla de frontera (qué entidades anclan el grafo y cómo se decide la ventana) en docs/

**Criterio de cierre:**
- La corrida completa reparte BD viva vs archivo sin ninguna FK rota en ninguno de los dos lados
- Para cada entidad: filas(viva) + filas(archivo) = filas(origen dispuestas a migrar) — visible en la consola
- UsuariosLog 26,086 + UsuariosLogAnt 33,439 están íntegros en el archivo y ausentes de la BD viva
- Las búsquedas del archivo responden por folio, modelo, cliente y referencia
- CI verde; reviewer aprobó

**Verificación de Gabriel:**
- [ ] Lanzar la corrida completa con frontera de 10 años desde la consola
- [ ] Abrir 'Archivo Histórico' y buscar un pedido viejo (p. ej. de 2008) por folio: debe aparecer con su cadena completa (orden, movimientos, EsMa)
- [ ] Buscar una cadena que cruza la frontera (pedido ~2015 con orden posterior) y verificar que está COMPLETA en un solo lado
- [ ] En las pantallas vivas (Pedidos, Órdenes) verificar que lo reciente sigue ahí y que lo archivado ya no aparece
- [ ] Abrir la consulta del archivo desde el celular y hacer una búsqueda
- [ ] Verificar en la consola que vivo + archivo = total origen para Ordenes (5,450 cargadas) y Pedidos (1,529)

**Equipo:** 1 coder + 1 reviewer (cadena esquema→servicio→API→pantalla sobre los mismos archivos)

**Referencias:**
- PLANMAESTRO.md §7 ('lo anterior queda en un archivo histórico de solo lectura consultable')
- Documentacion_MJD/10-Modelo-Datos-y-Usuarios.md §3 (relaciones por convención: 30 años sin integridad → el grafo se reconstruye con cuidado)
- MEJORAS A2 (FKs reales) y A4 (permiso de consulta)
- docs/modulos/patron-crud.md (patrón de pantalla de consulta)

---

## F10-E5 · Saldos iniciales como AJUSTE de kardex (D3) + reporte de cuadre v1 vs v2 + incidencias con disposición — ⬜ pendiente

**Objetivo:** Cuadrar las existencias al corte con MOVIMIENTOS de ajuste del kardex (D3, jamás existencia editada, jamás duplicando el historial ya migrado) y construir el instrumento de verificación de toda la fase: el reporte de cuadre obligatorio (PLANMAESTRO §7) y la pantalla de incidencias con disposición registrada. PRIMER PASO BLOQUEANTE de la etapa: validar con Daniel/Gabriel la decisión del desglose PT talla/color — la decisión de diseño más espinosa de F10.

**Alcance:**
- Decisión documentada (ADR + DECISIONES.md si aplica) del desglose del saldo PT: v1 solo tiene modelo×almacén (IPT_Mod_Alm, 3,655 saldos) vs kardex v2 modelo×color×talla×almacén (D4) → conteo físico al corte o dimensión 'sin desglose (migración)' que se depura en operación
- DEFINICIÓN ANTI-DUPLICACIÓN del 'saldo inicial': como el historial de movimientos YA está migrado (E3) y parte se archivó (E4), el saldo inicial NO es el saldo completo — es un movimiento de AJUSTE de migración = existencia oficial v1 al corte − Σ movimientos migrados a la BD viva. PT: ajuste contra IPT_Mod_Alm (la existencia 'oficial' v1 manda); telas: ajuste contra TelasColAlm (filtrando ceros); EsMa: partida de apertura por maquilero = saldo de la fórmula sobre los movimientos que quedaron en el archivo, de modo que apertura + Σ movimientos vivos = saldo total v1. Todo como movimiento del kardex (D3), en transacción (A2), con auditoría 'migración' (A7)
- Política documentada para existencias v1 DESCUADRADAS por diseño (Σ movimientos v1 ≠ existencia almacenada; IPT_Revision existe para recuadrar): manda la existencia 'oficial' v1; el ajuste la materializa y, si excede tolerancia, la diferencia queda como MigracionIncidencia visible
- Captura de conteo físico: import desde plantilla Excel (exceljs) + pantalla simple para avíos (R4: no existen en v1, su saldo ES el conteo) y para el desglose PT si así se decide
- ServicioCuadre: por entidad compara conteos v1 (staging) vs v2 (viva+archivo); Σ existencias PT a nivel modelo×almacén (el único comparable con v1) contra IPT_Mod_Alm y telas contra TelasColAlm; saldo EsMa por maquilero con la fórmula real de EsMa_SaldosMaq: Σ(CantRecEsMa×PrecioEsMa)+ΣAbonos−ΣPagos−ΣDescuentos con nulos=0 (ceronulo)
- Pantalla Admin → Reporte de cuadre: por entidad, con drill-down a las diferencias; PC + móvil (consulta) — es el instrumento del cuadre diario del paralelo; export a Excel (exceljs) y PDF (@react-pdf/renderer) — el impreso NUEVO de la fase (R9), el documento que firma el corte
- Pantalla Admin → Incidencias de origen: lista con captura de disposición (aceptar/excluir/ajustar), quién y cuándo decidió — cumple §7: 'se listan para decisión, no se arreglan en silencio'
- ServicioParaleloCuadreDiario: corrida diaria del cuadre contra export fresco de Access (vía el transporte R2/local de E1), con rastro por día para decidir el corte

**Entregables:**
- Servicios con tests: fórmula EsMa con nulos tratados como 0; el ajuste entra como movimiento y la existencia derivada del kardex v2 = IPT_Mod_Alm / TelasColAlm EXACTAMENTE (test del anti-doble-conteo de toda la cadena E3+E4+E5); el cuadre DETECTA una diferencia sembrada a propósito
- ADR de la decisión del desglose PT validada por Daniel/Gabriel
- Pantallas de cuadre e incidencias funcionando (PC + móvil consulta); export Excel y PDF del reporte de cuadre
- Plantilla de captura de conteo físico (avíos / desglose PT) con su import probado
- OpenAPI regenerado + cliente tipado sincronizado
- Bitácora del cuadre diario (modelo de datos + pantalla de historial por día)

**Criterio de cierre:**
- Tras corrida completa + ajustes, el reporte de cuadre muestra cada diferencia EXPLICADA: en cero o ligada a una incidencia con disposición (nada 'volando')
- El saldo EsMa calculado en v2 (apertura + movimientos vivos) coincide con la fórmula EsMa_SaldosMaq sobre los datos v1 para todos los maquileros (o la diferencia está listada)
- La existencia PT por modelo×almacén derivada del kardex v2 (movimientos IPT migrados + ajuste) = IPT_Mod_Alm, fila por fila sobre los 3,655 saldos (o incidencia)
- El export a Excel abre y trae los mismos números que la pantalla
- CI verde; reviewer aprobó; decisión del desglose PT firmada ANTES de construir el cargador

**Verificación de Gabriel:**
- [ ] Primero: sesión corta con Daniel para decidir el desglose PT (conteo físico vs 'sin desglose (migración)') — sin esta firma la etapa no arranca su construcción
- [ ] Correr corrida completa + ajustes desde la consola y abrir Admin → Reporte de cuadre
- [ ] Comparar el saldo EsMa de 2–3 maquileros conocidos contra el Access real (o contra la consulta EsMa_SaldosMaq exportada) — deben coincidir centavo a centavo
- [ ] Verificar la existencia de un modelo conocido contra IPT_Mod_Alm (a nivel modelo×almacén) y comprobar que en su kardex se ven los movimientos históricos + UN ajuste de migración (no el saldo duplicado)
- [ ] Exportar el cuadre a Excel, abrirlo y validar que coincide con la pantalla; generar también el PDF
- [ ] Abrir Admin → Incidencias, registrar la disposición de una incidencia real (p. ej. la orden Id=1) y verificar que queda con usuario y fecha
- [ ] Abrir el reporte de cuadre desde el celular (solo consulta)
- [ ] Probar el import de la plantilla de conteo físico con 2–3 renglones de prueba y ver que entran como movimiento (no como existencia editada)

**Equipo:** 2 coders en paralelo (pieza A: cargadores de ajustes de saldo + desglosador PT + captura/import de conteos; pieza B: servicio de cuadre + pantallas de cuadre e incidencias + exports Excel/PDF) + 1 reviewer — piezas en archivos distintos, se integran al final contra el mismo esquema de E1

**Referencias:**
- PLANMAESTRO.md §7 (reporte de cuadre obligatorio; incidencias para decisión) y §11 (mitigación de descuadres)
- DECISIONES.md D3 (saldos = movimientos del kardex), D4 (dimensiones PT), D5 (lotes); REQUISITOS-NUEVOS.md R4 (avíos no existen en v1 → conteo físico) y R9 (el cuadre es el impreso nuevo de la fase)
- Documentacion_MJD/07-EsMa-Estados-de-Cuenta-Maquileros.md §1 (fórmula real de EsMa_SaldosMaq + ceronulo)
- Documentacion_MJD/04-Inventarios.md §A.1 (IPT_Mod_Alm es modelo×almacén, 'pierde talla y color'; IPT_Movs ya migrados en E3) y §A.2 (existencias editadas por eventos; IPT_Revision recuadra)
- MEJORAS A2, A7

---

## F10-E6 · Capa de seguridad de usuarios (better-auth + roles) + fotos a R2 + tablero de go-live — ⬜ pendiente

**Objetivo:** Dejar lista la capa humana y de archivos del corte: credenciales SEGURAS sobre los 137 registros Usuario que E2 ya migró (las claves v1 están en texto plano y jamás se copian), propuesta de rol desde sus accesos reales, fotos de modelos a R2 y el tablero de checklist del corte. Va aquí porque opera sobre los usuarios migrados en E2 y alimenta directamente la capacitación y el corte (E7).

**Alcance:**
- MigradorSeguridad (A4) SOBRE los 137 registros Usuario migrados en E2: los 117 inactivos quedan VISIBLES pero inactivos (sus Id ya resuelven en auditorías históricas vía MigracionMapaId); los ~20 activos quedan activables con alta en better-auth (scrypt) + password temporal + cambio forzado al primer login; Usuarios.Clave (texto plano) NO se toca jamás, ni hasheada
- Propuesta de rol por usuario activo: similitud de sus UsuAccesos (38 accesos del catálogo, 5,173 asignaciones) contra los 9 roles seedeados en F0; Nivel (1..100) absorbido como rol predefinido; reporte de diferencias usuario por usuario para revisión con Daniel (38×~20 es revisable a mano)
- Extensión de la pantalla Admin → Usuarios (F0): activación de usuarios migrados, rol propuesto editable, generación de password temporal
- MigradorArchivos (A5): fotos S:\AplicacionesMJD\Control\FotosMod\<modelo>.jpg y trasera <modelo>-P.jpg → bucket R2 + registro en tabla Archivo (nunca por convención de nombre); modelos sin foto se REPORTAN, no truenan (v1 muestra 'NoFoto')
- Tablero de go-live: checklist del corte con semáforo por paso (v1 congelado → extracción fresca → ETL → cuadre en ceros → usuarios activados) montado sobre MigracionCorrida + el cuadre de E5 (alternativa aceptable si aprieta el tiempo: runbook en docs/ + reporte de cuadre — decidirlo al arrancar la etapa)

**Entregables:**
- Servicios con tests (ningún test ni fixture contiene una clave v1 real; login migrado exige cambio de password; mapeo accesos→rol determinista y reportado)
- Reporte usuario→rol propuesto con diferencias, listo para sesión con Daniel
- Pantalla de usuarios extendida + tablero de go-live
- Corrida de fotos a R2 con reporte de faltantes
- OpenAPI regenerado + cliente tipado sincronizado

**Criterio de cierre:**
- Los ~20 usuarios activos con rol propuesto y password temporal generable; los 117 inactivos visibles pero sin acceso
- Login de un usuario migrado funciona con password temporal y FUERZA el cambio antes de entrar
- Las fotos existentes se ven en la pantalla de Modelos servidas desde R2 (incluida la trasera -P); los faltantes están listados (no rompen la pantalla)
- Tablero de go-live muestra el estado real de cada paso del corte
- CI verde; reviewer aprobó; reporte de roles revisado con Daniel

**Verificación de Gabriel:**
- [ ] Revisar con Daniel el reporte usuario→rol de los ~20 activos y ajustar los que no cuadren
- [ ] Activar un usuario real de prueba desde Admin → Usuarios, generar su password temporal, hacer login con él y comprobar que obliga a cambiar el password antes de entrar
- [ ] Verificar que un usuario inactivo aparece en la lista pero NO puede hacer login
- [ ] Abrir un modelo CON foto (se ve, servida desde R2, incluida la trasera -P) y uno SIN foto (mensaje limpio, no error)
- [ ] Revisar el reporte de fotos faltantes contra 2–3 modelos conocidos
- [ ] Abrir el tablero de go-live y verificar que refleja el estado real de las corridas y el cuadre

**Equipo:** 2 coders en paralelo (pieza A: migrador de seguridad + pantalla de usuarios; pieza B: fotos a R2 + tablero de go-live) + 1 reviewer — sin solape de archivos

**Referencias:**
- Documentacion_MJD/10-Modelo-Datos-y-Usuarios.md §4 (Accesos/UsuAccesos, los 38 permisos, niveles) y §6.3 (claves en texto plano)
- Documentacion_MJD/01-Modelos.md §4 (convención de fotos <modelo>.jpg / <modelo>-P.jpg)
- MEJORAS A4 (RBAC único), A5 (archivos por tabla, no por convención), A7
- docs/arquitectura/ADR-0003-better-auth.md y ADR-0004-hash-scrypt.md
- docs/ESTADO-DESPLIEGUE.md (R2 debe estar montado ANTES de esta etapa — pendiente operativo de F0)

---

## F10-E7 · Prueba reina + ensayo general del corte + documentación de cierre + capacitación + paralelo con cuadre diario + corte final y go-live — ⬜ pendiente

**Objetivo:** Cerrar la CONSTRUCCIÓN de F10 (prueba reina sobre datos reales, ensayos del corte en `prueba`, runbook y docs/modulos/migracion.md) y luego OPERAR la transición: capacitar a los ~20 usuarios activos sobre SUS datos migrados, correr el paralelo 2–4 semanas con cuadre diario, y ejecutar el corte final según el runbook hasta cumplir el criterio de salida de la fase (§6): saldos v2 = saldos Access en fecha de corte y usuarios operando. Es la última etapa porque es el evento que todo lo anterior preparó.

**Alcance:**
- Prueba reina (§10) sobre datos migrados en `prueba`: alta de modelo con BOM → pedido → orden → explosión y OC → recepción (auto-avance RC) → corte → envío/recibo de maquila (IPT + EsMa + WIP en una captura, esta vez SÍ con efectos derivados: es captura viva, no migración) → auditoría de calidad → entrega a cliente → costo de la orden → KPIs — cada número cuadrado contra cálculo manual con Daniel
- Ensayo general del corte, mínimo 2 veces completas en el environment `prueba` de Railway: extracción fresca (de los .mdb con contraseña, o asistida según el plan de E1) → transporte a R2 → ETL completo → ajustes de saldo → cuadre → activación de usuarios — siguiendo el runbook al pie de la letra y cronometrando cada paso (primer uso REAL del transporte oficina→nube de E1)
- Contraste de los impresos R9 de F2–F7 contra los del sistema viejo con datos reales migrados (orden, nota, OC, recibos, EsMa, auditoría)
- Correcciones que salgan del ensayo: por el flujo normal (rama de tarea → PR a `prueba`, coder + reviewer, CI)
- Documentación de cierre (regla 6, en la ÚLTIMA etapa): docs/modulos/migracion.md (staging, mapa de IDs, incidencias, orquestador, modo migración, ajustes de saldo, cuadre) + runbook del corte versionado en docs/ + plan del paralelo (responsables de doble captura por módulo, rutina de cuadre diario con dueño Gabriel, criterio explícito de 'listo para corte': N días seguidos de cuadre limpio) + plan de capacitación por módulo
- Capacitación por módulo de los ~20 usuarios activos, sobre el ambiente de prueba con sus propios datos migrados (no demos sintéticas)
- Activación de usuarios reales con los roles validados por Daniel (mecanismo de E6)
- Paralelo 2–4 semanas (§10): doble captura sobre órdenes reales con responsables por módulo; mitigación del riesgo humano de abandono: rutina de cuadre diario con dueño (Gabriel) y seguimiento de quién capturó qué; cuadre diario = export fresco de Access → transporte E1 → ServicioParaleloCuadreDiario → reporte por día (inventarios PT/telas + saldos EsMa)
- Conteos físicos reales al corte: avíos (R4) y desglose PT si así se decidió en E5, capturados con la plantilla de E5 coordinando con Almacén
- Evento de corte siguiendo el runbook: congelar v1 (solo consulta) → extracción fresca → ETL completo → cuadre en ceros o con diferencias aceptadas y FIRMADAS → activación de usuarios → go-live en producción; acta de corte final (resumen del cuadre, usuarios activados, diferencias aceptadas — respaldo documental de apagar v1)
- Guardia post-go-live: correcciones SOLO por el flujo normal de ramas (rama → PR a `prueba` → verificación → `main`), nada de hotfixes directos

**Entregables:**
- Acta de la prueba reina: cada número del ciclo cuadrado contra el cálculo manual, firmada por Daniel y Gabriel
- Runbook del corte en docs/ con tiempos medidos por paso (≥2 ensayos completos)
- docs/modulos/migracion.md (documentación del módulo, regla 6 de la fase)
- Plan del paralelo y de capacitación ejecutados; bitácora completa de cuadres diarios (un registro por día con resultado y observaciones)
- Correcciones del ensayo mergeadas con sus tests; CI verde
- Acta de corte final firmada (cuadre, usuarios, diferencias aceptadas) — generada desde el reporte de cuadre de E5
- CONTROL v2 operando en producción con catálogos completos + ≥10 años de historial + saldos cuadrados; archivo histórico consultable; CONTROL viejo congelado en modo solo-consulta
- MigracionMapaId permanente como trazabilidad v1→v2 para auditorías futuras

**Criterio de cierre:**
- Prueba reina completada y cuadrada contra cálculo manual (criterio §10) con Daniel presente
- El ensayo del corte corrió completo al menos 2 veces en `prueba` siguiendo el runbook, sin pasos improvisados, con cuadre en ceros o con diferencias aceptadas y dispuestas
- Los impresos contrastados contra los del viejo sin diferencias de fondo
- Criterio de salida de la fase (PLANMAESTRO §6): saldos v2 = saldos Access a la fecha de corte (cuadre en ceros o con diferencias aceptadas y firmadas)
- Los ~20 usuarios reales operando en producción con sus roles (capturando SOLO en v2); v1 apagado para captura (queda como consulta); acta de corte firmada por Daniel y Gabriel
- Sin incidencias de migración sin disposición; toda la documentación de cierre en docs/ revisada por el reviewer

**Verificación de Gabriel:**
- [ ] Ejecutar él mismo el runbook paso a paso en el environment `prueba` (extracción → transporte → ETL → ajustes → cuadre), anotando duración de cada paso
- [ ] Recorrer con Daniel el ciclo completo de la prueba reina como usuarios, cuadrando contra el cálculo manual (costo de la orden, saldo EsMa, existencias) y verificando que la captura VIVA sí dispara los efectos derivados (un recibo de prueba genera IPT + EsMa + avance RC)
- [ ] Imprimir/generar 2–3 impresos (orden, recibo de maquila, estado de cuenta) y compararlos lado a lado con los del Access
- [ ] Firmar el acta de la prueba reina y dar el visto bueno para arrancar capacitación y paralelo
- [ ] Durante el paralelo, rutina diaria: correr el cuadre del día, revisar el reporte, registrar el resultado en la bitácora y perseguir los descuadres con el responsable del módulo
- [ ] Antes del corte: verificar el criterio 'listo para corte' (N días seguidos de cuadre limpio según el plan)
- [ ] El día del corte: ejecutar el runbook con el tablero de go-live en pantalla y verificar cada semáforo en verde antes del siguiente paso
- [ ] Al día siguiente del go-live: confirmar que la captura real ocurre SOLO en v2, que los folios nuevos continúan sin chocar, y que cada usuario activo pudo entrar y trabajar su módulo
- [ ] Verificar una consulta al archivo histórico y una búsqueda por referencia de cliente en producción
- [ ] Archivar el acta de corte y actualizar CLAUDE.md / docs/ESTADO-DESPLIEGUE.md con el estado post-go-live

**Equipo:** 1 coder + 1 reviewer (correcciones del ensayo y guardia post-go-live, por el flujo normal de ramas; docs de cierre); Gabriel dueño del cuadre diario y del evento de corte; Daniel valida la prueba reina, los roles y las diferencias — la primera mitad de la etapa cierra la construcción, la segunda es operativa

**Referencias:**
- PLANMAESTRO.md §10 (prueba reina; paralelo 2–4 semanas con cuadre diario antes del corte definitivo), §6 (criterio de salida de F10) y §11 (mitigación de descuadres)
- PLANMAESTRO.md §2.4 y §9 (flujo de ramas y CI para las correcciones)
- Documentacion_MJD/07-EsMa-Estados-de-Cuenta-Maquileros.md §1 (la fórmula que se cuadra a diario); REQUISITOS-NUEVOS.md R4 (conteo físico de avíos al corte)
- docs/GUIA-RAILWAY-R2.md y docs/ESTADO-DESPLIEGUE.md (environment `prueba` debe estar activo — pendiente operativo)
- Runbook del corte y plan del paralelo (entregables de esta misma etapa); plan de extracción de E1 (contraseña o plan B)

---

## Notas de la fase (supuestos del diseño)

CONTEOS REGENERADOS (2026-06-12) con parser CSV real (csv.reader sobre latin-1, CLAUDE.md §4) contra 'Respaldo CLAUDE/TABLAS/': la versión anterior del desglose contaba LÍNEAS FÍSICAS en ≥12 tablas (la trampa exacta contra la que E1 advierte). REGLA PERMANENTE: conteo de referencia = filas CSV parseadas, JAMÁS líneas físicas. Correcciones aplicadas: Ordenes 5,451 (5,450 cargadas + 1 incidencia Id=1) · Maquileros 496 (no 1,711) · Cortadores 69 · Estampadores 44 (no 190) · Notas 4,712 · NotasDet 11,459 (no 29,112) · OrdCompra 7,978 · OrdCompraDet 18,163 · Entregas 7,334 · EntregasEst 4,496 · RC 181 · EsMa_Abonos 554 · EsMa_Desc 743 · CC_Auditorias 488 · TelasColores 4,566; y verificados de nuevo los que ya cuadraban (OrdenesDet 9,511, Usuarios 137, TelasColAlm 113,219, Recibos 12,440, EsMa 11,369, OrdCom-Ord 19,600, IPT_Mod_Alm 3,655, Modelos 4,987, IPT_Movs 5,072, IPT_MovsDet 6,886, IPT_Modelos 1,224, EntregasCliente 0, Propiedades 1). CAMBIOS ESTRUCTURALES vs versión anterior: (a) la vieja E2 (11 dominios) se partió en E2 (bloque A en cadena, 1 coder) y E3 (bloque B, 2 coders en piezas de verdad independientes entre sí, ambas colgando solo de E2 cerrada) — cumple la regla de paralelizar por independencia y el tamaño de tarea cerrada; (b) las viejas E6/E7 se fusionaron en E7 para respetar el tope de 7 etapas: su primera mitad (prueba reina + ensayos + runbook + docs/modulos/migracion.md) es el CIERRE DE CONSTRUCCIÓN (cumple la regla 6 en la última etapa) y su segunda mitad (capacitación + paralelo + corte) es OPERATIVA — excepción consciente a 'etapa = tarea de código': el go-live es un evento, y su entregable documental (actas, bitácora, actualización de CLAUDE.md/ESTADO-DESPLIEGUE.md) está listado; (c) el 'modo migración' del contrato CargadorViaDominio (E1) elimina el triple conteo estructural: el recibo de maquila v1 NO dispara MeterInventario/EsMa/RC al migrar (cada tabla v1 migra desde su propia fuente: Recibos, EsMa, IPT_Movs) y los saldos de E5 son AJUSTE (oficial v1 − Σ movimientos migrados vivos), no saldo completo; (d) el kardex PT (IPT_Movs 5,072/IPT_MovsDet 6,886/IPT_Modelos 1,224 + catálogos IPT_*) entró al alcance de E3 — es la ÚNICA fuente de salidas de PT porque EntregasCliente está VACÍA (0 filas, verificado); (e) los 137 registros Usuario migran en E2 (entidad inactiva sin credenciales, prerequisito de todo historial con IdUsuarios) y E6 solo agrega la capa de seguridad better-auth/roles/activación; (f) la logística oficina→nube quedó en E1 (extracción + manifiesto → prefijo R2, con fuente local como alternativa en compose y plan documentado), se estrena en los ensayos de E7; (g) Propiedades (1 registro: ColchonCostura, UtilidadSujerida, Regalias, IPT_Almacen_Default) migra en E3 hacia la configuración por empresa (módulo 13) o queda con disposición manual explícita; (h) staging aterriza las 116 tablas CRUDAS (cuadre/trazabilidad) y solo las 'migra' pasan a dominio; las ~17 tablas de impresión R9 del front-end NO son CSV y constan como 'no migra' en el inventario (v1 en E1, firmado en E3). SUPUESTOS QUE SIGUEN: (1) F1–F7 entregaron su parte del ETL conforme al contrato de backend/migracion; si algún ETL no nació al contrato (incluido el modo migración), su adaptación se absorbe en E2/E3 y esas etapas crecen — auditar al cerrar F7. (2) Ventana: corte ~2026 ⇒ migra ≥2016; 2005–2015 al archivo, SIEMPRE por grafo completo. (3) El spike access-parser con contraseña Jet se resuelve en E1; si falla, el plan B (exportación asistida) encarece el cuadre diario del paralelo — por eso E1 va primero. (4) La decisión del desglose PT (la más espinosa) es el primer paso BLOQUEANTE de E5; idealmente Daniel/Gabriel la validan durante E3/E4 para no frenar. (5) El tablero de go-live se acepta como pantalla simple; la alternativa runbook-en-docs + reporte de cuadre es válida (decisión al arrancar E6). DEPENDENCIAS OPERATIVAS (no código, condicionan fechas): contraseñas de los .mdb de producción desde E1; bucket R2 montado idealmente antes de E1 (transporte de extracciones — mientras no esté, las corridas usan fuente local en compose) e INDISPENSABLE antes de E6 (fotos) y del primer ensayo en `prueba` (E7); environment `prueba` de Railway activo antes de E7; unidad S:\ accesible para las fotos; disponibilidad de Almacén para conteos físicos y de los ~20 usuarios para capacitación y doble captura (E7). COSAS DEL INVENTARIO QUE PERTENECEN A OTRA FASE: los impresos R9 de catálogo (orden, nota, OC, recibos, EsMa, ficha de estampado, auditoría, lista de precios, inventario de telas) son de F2–F7 y deben llegar construidos — F10 solo los CONTRASTA en E7; la migración de indicadores IP_*/Alm_* y de costos/EDR es parte del ETL de F7 (E3 solo la re-ejecuta integrada); las pantallas operativas de negocio son de F1–F7 (F10 no agrega captura de negocio); el contrato del módulo de migración debería nacer en F1 (si no lo hizo, E1 lo crea y E2/E3 pagan la deuda). ADVERTENCIAS HEREDADAS A LOS CODERS: EntregasCliente está VACÍA (0 filas) — el cuadre de entregas se hace sobre PedidosDet.EntregadoParcial/CantFalt, jamás sobre esa tabla; EsMa migra TAL CUAL (verdad contable), no se deriva de Recibos; las salidas de PT viven SOLO en IPT_Movs; CostoViejo queda CONGELADO (D1) o el cuadre histórico no da; las 11 tablas Prom_* (D9), 'Errores de pegado', temporales y OrdCompraExcel NO migran; UsuariosLog/Ant van solo a archivo; y Maquileros/Estampadores/Notas/NotasDet son las pruebas ácidas del parser (496/44/4,712/11,459 filas reales, MUY lejos de sus líneas físicas).
