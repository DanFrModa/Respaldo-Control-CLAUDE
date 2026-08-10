# ETL de migración (CONTROL v1 Access → v2)

Scripts que migran los datos reales del sistema viejo (CSV en `Respaldo CLAUDE/TABLAS/`, **encoding CP850**) a la BD de v2, cargando **vía los servicios de dominio** (modo migración), de forma **idempotente** y re-ejecutable.

## ⚠️ Cómo se corren (IMPORTANTE)

Córrelos **desde `backend/`** con `npx tsx` y **siempre pasando `--env-file=.env`**:

```bash
cd backend
npx tsx --env-file=.env migracion/etl-pedidos-ordenes.ts   # F2: pedidos + órdenes
npx tsx --env-file=.env migracion/cuadre-f2.ts             # F2: solo el reporte de cuadre

# F3 (producción + inventario PT) — EN ESTE ORDEN:
npx tsx --env-file=.env migracion/etl-produccion.ts        # F3: corte/envío/recibo/EsMa (SIN kardex)
npx tsx --env-file=.env migracion/etl-ipt.ts               # F3: kardex histórico de IPT (genera el kardex)
npx tsx --env-file=.env migracion/cuadre-f3.ts             # F3: solo el reporte de cuadre de toda la fase

# F4 (compras / MRP / telas) — EN ESTE ORDEN:
npx tsx --env-file=.env migracion/etl-compras-notas.ts     # F4: OC + notas legacy (texto libre, SIN kardex)
npx tsx --env-file=.env migracion/etl-telas.ts             # F4: entradas/salidas/traspasos + lotes legacy (kardex de tela)
npx tsx --env-file=.env migracion/cuadre-f4.ts             # F4: cuadre TelasColAlm v1 vs Σ movimientos v2
npx tsx --env-file=.env migracion/_progreso.ts             # F4: chequeo rápido de conteos (local, gitignored)

# F5 (Ruta Crítica) — un solo comando (idempotente):
npx tsx --env-file=.env migracion/etl-ruta-critica.ts      # F5: catálogos + roles N:M + plantillas + UsuarioRol + rutas históricas + estado RC + colchón
npx tsx --env-file=.env migracion/cuadre-f5.ts             # F5: solo el cuadre (v1 CSV vs v2 + huérfanas/pendientes-F10/FactorTela)

# F6 (Calidad + EsMa) — idempotentes (Calidad y EsMa son independientes):
npx tsx --env-file=.env migracion/etl-calidad.ts           # F6: defectos + auditorías + detalles (modo migración, SIN eventos de RC)
npx tsx --env-file=.env migracion/etl-esma.ts              # F6: cargos (con fix de estampado) + abonos/descuentos/pagos históricos
npx tsx --env-file=.env migracion/cuadre-f6.ts             # F6: cuadre Calidad+EsMa (conteos + saldo por maquilero + conciliación)

# F7 (Costos/EDR + Indicadores) — idempotentes (Costos e Indicadores son independientes):
npx tsx --env-file=.env migracion/etl-costos.ts            # F7: CostoOrd → CostoOrden (D2: regalía FUERA del costo)
npx tsx --env-file=.env migracion/etl-indicadores.ts       # F7: personal/actividades + productividad IP/almacén + fichas + muestrarios + cíclico histórico (D6)
npx tsx --env-file=.env migracion/cuadre-f7.ts             # F7: cuadre (conteos + análisis de la regalía D2)

# F9 (Finanzas) — saldos iniciales de terceros + CFDI históricos. ⚠️ NO desde Access: la fuente es
# el corte de SINUBE / export del contador. Se pasa el archivo/carpeta por flag (tras `--`):
npx tsx --env-file=.env migracion/etl-terceros-saldos.ts -- --archivo=saldos.csv   # F9: saldos iniciales CxC/CxP (aperturas)
npx tsx --env-file=.env migracion/etl-cfdi-masivo.ts     -- --dir=./cfdi-historicos # F9: importación masiva de CFDI (XML)
npx tsx --env-file=.env migracion/cuadre-f9.ts           -- --archivo=saldos.csv    # F9: cuadre (corte vs aperturas cargadas)

# ⚠️ AL FINAL DE TODA CARGA/RECARGA (obligatorio, ver abajo):
npx tsx --env-file=.env migracion/realinear-estado-ordenes.ts            # pone al día el estado completa/incompleta
npx tsx --env-file=.env migracion/realinear-estado-ordenes.ts --dry-run  # (opcional) simula: reporta sin escribir
npx tsx --env-file=.env migracion/reparar-secuencias.ts                  # adelanta TODA secuencia de folio al máximo migrado
```

## ⚠️ PASO OBLIGATORIO AL TERMINAR CUALQUIER CARGA: reparar las secuencias de folio

Quien migra un documento con su folio **explícito** del sistema viejo tiene que dejar la **secuencia**
de esa serie adelantada al máximo migrado. Si no, la primera captura nueva **arranca en folio 1**: se
va al final de los listados (que ordenan descendente) y, en cuanto la serie alcance un folio ya
migrado, la captura truena con **choque del unique `(idEmpresa, folio)`**. Fue un defecto real
(§Post-F9.17, Daniel: _"hice la OC pero al refrescar el listado, no la veo"_): `etl-compras-notas.ts`
dejó `orden-compra` y `nota-salida` en cero.

```bash
npx tsx --env-file=.env migracion/reparar-secuencias.ts
```

Recalcula las 7 series con histórico (`pedido`, `orden`, `etapa-mov`, `auditoria`, `orden-compra`,
`nota-salida`, `movimiento-tercero`) contra el **máximo REAL por empresa**. Es **idempotente** y
**monótono** (`sembrarSecuencia` usa `GREATEST`: **nunca retrocede** una serie que la captura ya
avanzó), así que se corre cuantas veces se quiera y **conviene correrlo después de CUALQUIER ETL**.
Los ETL siembran además sus propias series al cerrar, pero este script es la red que no depende de que
nadie se acuerde. **Al agregar un ETL que migre folios explícitos, agrega su serie aquí.**

> Ojo al tocarlo: el campo del folio **no se llama igual** en todas las tablas — es `folio` en
> pedidos/órdenes/etapas/terceros, pero **`numCompra`** en OC, **`numNota`** en notas y
> **`numAuditoria`** en auditorías.

## ⚠️ PASO OBLIGATORIO AL TERMINAR CUALQUIER CARGA: realinear el estado de las órdenes

Después de correr los ETL (F10 completo o una re-corrida), hay que ejecutar **una vez**:

```bash
npx tsx --env-file=.env migracion/realinear-estado-ordenes.ts
```

**Por qué.** El ETL es **fiel a la fuente**: `crearOrdenMigrada` escribe el `estado` y la
`fechaCompletada` EXPLÍCITOS que traía Access (`FechaDet`/`OrdCancelada`) y **no recalcula** — así
debe ser, migrar es copiar el histórico, no reinterpretarlo. Pero desde el 26-jul-2026 el estado de
la orden es **automático** (`completa` = tallas + avíos, y arte si aplica; `DECISIONES.md
§Post-F9.4`) y la pantalla **"Órdenes incompletas"** filtra por el estado GUARDADO. Sin este paso, el
semáforo queda desalineado recién cargada la base y **el backlog que Daniel pidió atender queda
invisible** (_"si no meten la información del arte, o no desmarcan la casilla, está como
incompleto… siempre hay que atender ese tema"_).

- **Idempotente y re-ejecutable**: la segunda corrida no escribe nada. Va por lotes (páginas de 500,
  cada una en su transacción corta) y termina con un resumen (revisadas / a incompleta / a completa
  / respetadas por producción viva).
- **Reusa la regla del dominio** (`realinearEstadoOrdenes` → `requisitosOrden`): no hay una segunda
  copia de la regla en el script. Respeta el mismo cinturón que la app: **nunca degrada una orden
  con `EtapaMovimiento` viva**, no toca las canceladas y **no borra `fechaCompletada`**.
- Deja **bitácora por orden** con `idUsuario` NULL (proceso de sistema).
- Flags: `--empresa=<id>` (por defecto todas), `--lote=<n>` (default 500), `--dry-run` (simula: hace
  el cálculo real y revierte, para ver el impacto antes de aplicarlo).

_(En la base de HOY la migración `20260726130000_recalculo_estado_ordenes` ya aplicó esta MISMA
REGLA, pero con menos alcance: corre **sola y UNA vez** y **solo DEGRADA** las `completa` que
dejaron de cumplir. El script hace **las dos direcciones** —degrada y también completa las
`capturada` que ya cumplían— y es re-ejecutable: es el que se corre después de cada carga.)_

> **F7 (importante):** `etl-costos` y `etl-indicadores` son INDEPENDIENTES (entidades destino
> disjuntas). **Costos (D2):** la **REGALÍA** (`RegaliasCost`) NO se migra como componente del costo
> (va sobre la venta); `procesosCost = MaquilaCost + BordCost`, `aviosCost = HabCost`. El `Costo`
> viejo INCLUÍA la regalía → el `costoTotal` v2 es menor por Σ RegaliasCost (**delta ESPERADO por
> diseño**, lo muestra el cuadre; NO es pérdida de datos). **Indicadores:** ORDEN interno —
> catálogos ANTES que su productividad; la baja suave de personas inactivas se aplica DESPUÉS de su
> productividad (sus registros no se pueden capturar con la persona desactivada). El **cíclico
> histórico** es de origen EXTERNO Proscai (**D6**): se carga como registros **CERRADOS**,
> `cantTeorica = CantProscai` (NO comparable contra el kardex v2) y **SIN ajuste de kardex**, con
> Color/Talla `(sin especificar)` + almacén `(Migración Proscai)` INACTIVOS. Depende de los mapeos de
> F1 (clientes/modelos por código) y F2 (órdenes). Cada corrida escribe
> `reporte-etl-f7e6-{costos,indicadores}-*.txt`.

> **F5 (importante):** el ETL de la Ruta Crítica VERIFICA los catálogos que ya sembró F5-E1/E2 (procesos,
> familias, reglas, plantillas) y CREA solo lo que falte; **materializa las 54 asignaciones VIGENTES**
> `RC_ProcUsua → ProcesoDefRol` y **LISTA las 14 HUÉRFANAS** (proceso inexistente en v2) sin tocarlas.
> Carga la **ruta viva histórica** (`RC` + `RC_IP3`/`RC_IP4`) de las 8 órdenes que tenían RC, preservando
> fechas y captura originales (KPI D11). Depende del mapeo de **órdenes de F2** (`ENTIDAD_MAPEO.orden`) y
> del **SEED de F5-E1/E2** (`SEED_ON_START=true`). **Conteos del cuadre:** 26 procesos · 156 tiempos · 11
> rangos · 7 telas · 9 aplicaciones · 19 roles (RBAC único) · 68 RC_ProcUsua = **54 vigentes + 14 huérfanas**
> · 23 usuarios con tipo · 181 renglones RC · checklist IP3/IP4. **⚠️ `UsuarioRol` depende de F10:** los 137
> usuarios del viejo aún NO están en v2 (eso es F10); el ETL asigna el rol a los que YA existen en v2 por su
> login y **LISTA el resto como "pendiente F10"** — **re-correr este ETL tras la migración de usuarios (F10)
> materializa esas asignaciones** (es idempotente). `RC_TipoTelas.FactorTela` se declara **no migrada a
> propósito** (ADR-0012/E3: el viejo no la aplicaba). Cada corrida escribe `reporte-etl-f5e7-ruta-critica-*.txt`.

> **F4 (importante):** `etl-compras-notas` y `etl-telas` son INDEPENDIENTES (entidades destino disjuntas);
> el orden de arriba es solo convención. Solo las **empresas activas 7=Marilyn Fitness / 8=FR Moda**
> migran (las 6 viejas se omiten y listan). Ventana temporal opcional: exporta `ETL_VENTANA_ANIOS=<n>`
> (default **0 = sin recorte**, anclada a `ETL_VENTANA_REF`=hoy) si quieres recortar por antigüedad
> además del recorte por empresa. Cada corrida escribe `reporte-etl-f4e6-{compras,telas}-*.txt`.

> **Depuración de PROVEEDORES (§Post-F9.23):** el Access trae **1,052 filas** de terceros en cuatro
> catálogos y solo **155** movieron algo desde 2025. Exporta `ETL_PROVEEDORES_DESDE=2025` antes de
> `etl-catalogos` para cargar **solo esos** (default **sin variable = se cargan todos**, como hasta hoy).
> Un tercero está vivo si MOVIÓ algo (OC, corte, entrega, recibo, nota o estampado), no por la bandera
> `Activo` del viejo. **Ojo:** `EntregasEst/RecibosEst.IdMaquileros` apuntan a **Maquileros**, no a
> `Estampadores` → ese catálogo (44) queda fuera COMPLETO, y es correcto: quien estampa es un taller.
> Los depurados salen uno por uno en el reporte. ⚠️ Con la depuración activa **solo se puede migrar
> historia de 2025-2026**: los ETL de F3/F4/F5 cargan histórico completo y apuntarían a proveedores que
> ya no existen. Para ver a quién afecta y qué información falta, SIN tocar la BD:
> `ETL_PROVEEDORES_DESDE=2025 npx tsx migracion/analisis/proveedores-depuracion.ts` (escribe
> `proveedores-a-corregir.csv` con los 155 y las columnas por llenar).

> **Orden de F3 (importante):** `etl-produccion` carga corte/envío/recibo/EsMa **sin** efectos de kardex
> (los recibos de costura del histórico NO generan entrada a PT, porque esa entrada ya vive en `IPT_Movs`).
> `etl-ipt` carga el kardex como **único** origen de existencias (`origenTipo = 'migracion'`). Así NO hay
> doble conteo; el `cuadre-f3` lo verifica. Ambos ETL dependen de los mapeos de F1 (Empresa, Almacen:IPT,
> modelos por código) y del SEED del catálogo de tipos de movimiento + almacenes (`SEED_ON_START=true`).

> **F9 (importante — NO SE CORRE todavía):** la fase Finanzas se seeda desde el corte de **SINUBE /
> export del contador**, NO desde Access. Los archivos fuente **aún no existen** (Daniel está sacando
> el corte, decisión **D15c**): los scripts se construyeron y probaron con fixtures, y se ejecutan
> cuando llegue el corte. Dos ETL + un cuadre, **INDEPENDIENTES** entre sí:
>
> - **`etl-terceros-saldos`** carga los **saldos iniciales** de CxC/CxP como movimientos de **APERTURA**
>   (nunca un saldo editable, D3). El CSV es de **FORMATO FLEXIBLE** (encabezados case-insensitive, ver
>   abajo). Cada renglón → un movimiento vía el **modo migración** del motor de terceros
>   (`src/dominio/terceros/migracion.ts`), por **LOTES** (folio en bloque A3 + `createManyAndReturn`).
>   **Idempotente** por `MapeoMigracion` (`AperturaTercero`) + la unique global del `uuidCfdi`.
> - **`etl-cfdi-masivo`** recorre una **carpeta de XML**, decide **compra/venta** por el RFC de la
>   empresa, resuelve el tercero por RFC y **REUSA** los importadores de E3/E4 (`importarCfdi` /
>   `importarCfdiVenta`) para crear el cargo fiscal + subir el XML a R2. **Idempotente por UUID** (el
>   comprobante repetido se cuenta como "duplicado", no error). Respeta `R2_SUBIDA_LOCAL`.
> - **`cuadre-f9`** compara, por tercero, el **saldo esperado del corte** (columna `saldoEsperado`, o Σ
>   de las aperturas del CSV con su signo) contra el **Σ monto de las aperturas cargadas**. Los
>   descuadres se **LISTAN**, nunca se fuerzan (§7).
>
> **Formato del CSV de `etl-terceros-saldos`** (columnas por nombre, case-insensitive; alias entre
> paréntesis):
>
> - Comunes: **`tipo`** (`cliente`|`proveedor`; acepta `c`/`p`) · **`rfc`** y/o **`nombre`** (para
>   localizar al tercero: primero por RFC, luego por nombre exacto). Opcionales: **`empresa`** (id o
>   nombre; default = empresa favorita, o `--empresa`) · **`saldoEsperado`** (para el cuadre).
> - **Modo DETALLE** (Daniel lo pidió: cada factura pendiente con SU fecha → el aging cuenta desde el
>   día 1): **`fecha`** (`YYYY-MM-DD` o `DD/MM/YYYY`) + **`importe`** (`monto`/`total`) + (**`uuid`**
>   y/o **`folio`**). Con `uuid` → cargo **fiscal** (`factura_proveedor`/`factura_cliente`); sin `uuid`
>   → cargo **no fiscal** (`entrada_sin_factura`, requiere `folio` como clave de idempotencia).
> - **Modo SALDO NETO**: **`saldo`** (± ; sin desglose). `saldo>0` → cargo (`entrada_sin_factura`);
>   `saldo<0` → `abono`. `fecha` opcional (default = `--corte` o hoy).
>
>   Ejemplo mínimo (`saldos.csv`):
>
>   ```csv
>   tipo,rfc,nombre,fecha,importe,folio,uuid,saldo,saldoEsperado
>   proveedor,AAA010101AA1,Telas del Norte,2026-01-15,1000,,UUID-DE-LA-FACTURA,,1000
>   cliente,XAXX010101000,Cliente Uno,,,,,-300,-300
>   ```
>
> El **signo** y el **vencimiento** (aging) NO los pone el ETL: el importe entra POSITIVO y el motor
> aplica `signoDeOrigen` + `calcularVencimiento` (reusados de `cuenta-terceros.ts`, A1). El módulo
> completo vive en `docs/modulos/finanzas.md`.

**NO uses `npm run etl:*`.** Esos scripts del `package.json` corren `tsx migracion/...` **sin** `--env-file=.env`, así que `tsx` arranca sin la `DATABASE_URL` del `.env` y truena con un error de conexión / `no DATABASE_URL` **aunque la URL sí esté en el `.env`**.

> ¿Por qué los `npm run` no traen `--env-file=.env`? Porque se romperían en **CI**, donde no existe `.env` (allá la `DATABASE_URL` llega por variable de entorno). Por eso el ETL se invoca a mano con `npx tsx --env-file=.env`.

La BD destino es **Railway (remota)**: el ETL corre desde tu máquina contra esa BD vía la `DATABASE_URL` del `.env`. Asegúrate de que las **migraciones de Prisma ya estén aplicadas** en esa base antes de cargar.

## Scripts disponibles

| Script                                  | Qué hace                                                                                                                                                                                                                             |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `migracion/etl-catalogos.ts`            | F1: catálogos, materiales, proveedores, mapeos                                                                                                                                                                                       |
| `migracion/etl-modelos.ts`              | F1: modelos + BOM (con `--fotos-modelos` / `--fotos-bordados` para las fotos masivas)                                                                                                                                                |
| `migracion/etl-pedidos-ordenes.ts`      | **F2: pedidos + pedidos reales + órdenes + matriz + comentarios** (imprime el cuadre al final)                                                                                                                                       |
| `migracion/etl-produccion.ts`           | **F3: corte + envío + recibo + cargos EsMa** (Pieza A; recibos SIN efecto de kardex)                                                                                                                                                 |
| `migracion/etl-ipt.ts`                  | **F3: kardex histórico de inventario PT** (Pieza B; IPT_Movs → Movimiento, color/talla sentinela)                                                                                                                                    |
| `migracion/etl-compras-notas.ts`        | **F4: OC + notas legacy** (OrdCompra*/Notas* → OrdenCompra/NotaSalida; texto libre, SIN kardex/RecepcionCompra)                                                                                                                      |
| `migracion/etl-telas.ts`                | **F4: entradas/salidas/traspasos de tela + lotes legacy** (clasifica traspasos vs compra vs salida-a-orden)                                                                                                                          |
| `migracion/cuadre-f4.ts`                | **F4: cuadre TelasColAlm** v1 vs Σ movimientos v2 (descuadres listados, nunca corregidos — D3)                                                                                                                                       |
| `migracion/etl-ruta-critica.ts`         | **F5: Ruta Crítica completa** (catálogos + 54 ProcesoDefRol vigentes + plantillas CP_Tiempos + UsuarioRol + rutas históricas RC/IP3/IP4 + estado RC de órdenes + colchón); LISTA 14 huérfanas + pendientes F10                       |
| `migracion/cuadre-f5.ts`                | **F5: cuadre** v1(CSV) vs v2(BD) + huérfanas/pendientes-F10/FactorTela no migrada                                                                                                                                                    |
| `migracion/etl-calidad.ts`              | **F6: Calidad** — `CC_Catalogo`(40)→DefectoCatalogo + `CC_Auditorias`(488)/`CC_AuditoriasDet`(15,296)→Auditoria/AuditoriaDefecto (modo migración: folio preservado, sin evento de RC)                                                |
| `migracion/etl-esma.ts`                 | **F6: EsMa** — cargos (fix estampado: +1,251 recuperados) + `EsMa_Abonos`(554)/`EsMa_Desc`(743)/`EsMa_Pagos`(5,935) planos (pagos LIBRES, sin aplicaciones)                                                                          |
| `migracion/cuadre-f6.ts`                | **F6: cuadre** Calidad+EsMa (conteos v1/v2 + saldo por maquilero con fórmula derivada D3 + conciliación recibido-vs-cargado; incidencias listadas)                                                                                   |
| `migracion/etl-costos.ts`               | **F7: Costos** — `CostoOrd`(2,513)→`CostoOrden` vía `guardarCostoOrden` (D2: regalía FUERA; procesos = maquila+bordado; avíos = habilitación)                                                                                        |
| `migracion/etl-indicadores.ts`          | **F7: Indicadores** — personal/actividades + productividad IP (`IP_Productiv`)/almacén (`Alm_Prd`×`Alm_Prd_Det`) + fichas (`IP_InfConf`, despivota 8→8) + muestrarios (`IP_MuesPend`) + cíclico histórico Proscai (`Alm_InvCic`, D6) |
| `migracion/cuadre-f7.ts`                | **F7: cuadre** (conteos v1/v2 + análisis empírico de la regalía D2: ¿el `Costo` viejo la incluía? + delta esperado)                                                                                                                  |
| `migracion/etl-terceros-saldos.ts`      | **F9: saldos iniciales** de CxC/CxP (corte SINUBE → aperturas vía modo migración del motor; por lotes; `-- --archivo=<csv>`)                                                                                                         |
| `migracion/etl-cfdi-masivo.ts`          | **F9: importación masiva de CFDI** (carpeta de XML → reusa E3/E4; compra/venta por RFC de empresa; `-- --dir=<carpeta>`)                                                                                                             |
| `migracion/cuadre-f9.ts`                | **F9: cuadre** (saldo esperado del corte vs Σ aperturas cargadas; descuadres listados; `-- --archivo=<csv>`)                                                                                                                         |
| `migracion/cuadre.ts`                   | Cuadre F1 (conteos v1 CSV vs v2)                                                                                                                                                                                                     |
| `migracion/cuadre-fase.ts`              | Cuadre por fase                                                                                                                                                                                                                      |
| `migracion/cuadre-f2.ts`                | Cuadre F2 en dos niveles (filas/sumas + columnas) + incidencias                                                                                                                                                                      |
| `migracion/cuadre-f3.ts`                | **Cuadre F3 en tres niveles** (conteos + existencias Σ kardex vs `IPT_Mod_Alm` + no-doble-conteo)                                                                                                                                    |
| `migracion/reparar-secuencias.ts`       | **Repara TODAS las secuencias de folio** contra el máximo real por empresa (idempotente + monótono; correr al final de cualquier carga — §Post-F9.17)                                                                                |
| `migracion/analisis/catalogo-tallas.ts` | Análisis (read-only): catálogo de cadenas `Ordenes.Tallas` con frecuencia                                                                                                                                                            |

Todos: `npx tsx --env-file=.env migracion/<script>.ts`.

## Notas

- **Idempotente:** una segunda corrida no duplica (resuelve "ya existe" por `MapeoMigracion` y/o el unique `(idEmpresa, folio)`). Si una corrida se corta a media, re-ejecutar retoma donde quedó.
- **Re-ejecutable:** el ETL de F2 se vuelve a correr en F10 (al corte de go-live).
- **Reporte:** `etl-pedidos-ordenes.ts` escribe un `reporte-etl-f2e5-<timestamp>.txt` y `etl-ipt.ts` un `reporte-etl-f3-<timestamp>.txt` (ambos gitignored) con el cuadre y las incidencias a revisar con Daniel.
