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
```

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
invisible** (*"si no meten la información del arte, o no desmarcan la casilla, está como
incompleto… siempre hay que atender ese tema"*).

- **Idempotente y re-ejecutable**: la segunda corrida no escribe nada. Va por lotes (páginas de 500,
  cada una en su transacción corta) y termina con un resumen (revisadas / a incompleta / a completa
  / respetadas por producción viva).
- **Reusa la regla del dominio** (`realinearEstadoOrdenes` → `requisitosOrden`): no hay una segunda
  copia de la regla en el script. Respeta el mismo cinturón que la app: **nunca degrada una orden
  con `EtapaMovimiento` viva**, no toca las canceladas y **no borra `fechaCompletada`**.
- Deja **bitácora por orden** con `idUsuario` NULL (proceso de sistema).
- Flags: `--empresa=<id>` (por defecto todas), `--lote=<n>` (default 500), `--dry-run` (simula: hace
  el cálculo real y revierte, para ver el impacto antes de aplicarlo).

*(En la base de HOY la migración `20260726130000_recalculo_estado_ordenes` ya aplicó esta MISMA
REGLA, pero con menos alcance: corre **sola y UNA vez** y **solo DEGRADA** las `completa` que
dejaron de cumplir. El script hace **las dos direcciones** —degrada y también completa las
`capturada` que ya cumplían— y es re-ejecutable: es el que se corre después de cada carga.)*

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

## Recarga de punta a punta en UN comando (`recargar.ts`)

**Esta es LA forma principal de recargar la BD de `prueba`** (vaciar + seed + los 12 ETL + los 6 cuadres, en su orden, sin correr script por script). Desde `backend/`:

```powershell
# Windows (PowerShell) — así trabaja Gabriel:
npx tsx --env-file=.env migracion/recargar.ts --desde=2025-01-01 --limpiar --confirmar
```

```bash
# Linux/macOS (bash) — idéntico:
npx tsx --env-file=.env migracion/recargar.ts --desde=2025-01-01 --limpiar --confirmar
```

Banderas:

- **`--confirmar` (OBLIGATORIO para ejecutar)**: sin él, **cualquier** invocación es **MODO PLAN** — imprime el plan numerado (con la ventana que aplicaría y, si trae `--limpiar`, los conteos actuales de la BD) y sale con exit 0 **sin tocar nada**. `--confirmar` **sin** `--limpiar` significa "ejecuta la carga sin vaciar antes" — es el modo de **reanudar** una recarga interrumpida.
- **`--desde=YYYY-MM-DD`** (opcional): la ventana temporal. Se valida al arrancar (mal formada → ABORTA con mensaje, nunca se ignora) y se exporta como `ETL_DESDE` a todos los pasos. **Sin `--desde` → recarga COMPLETA** (sin ventana, migra todo el histórico).
- **`--limpiar`**: vacía la BD antes de cargar (TRUNCATE de todo `public` menos `_prisma_migrations`, reusa la lógica de `limpiar-datos.ts`) y agrega el paso de seed. Como todo, solo ejecuta con `--confirmar`.
- **`--sin-cuadres`**: se salta los cuadres del final (el realineado de estado SÍ corre igual: es carga, no verificación).
- **`--saldos-terceros=<ruta.csv>`** / **`--cfdi=<carpeta>`** (F9, opcionales): ver abajo. Sin ellas, esos pasos se OMITEN y el plan lo dice.

Qué hace, en orden: **(0)** limpieza (si `--limpiar --confirmar`) → **(1)** el **seed de fundación** (el MISMO `prisma/seed.ts` idempotente que dispara `SEED_ON_START`; correrlo aquí evita esperar un redeploy para poder cargar) → **(2)** los ETL: `etl-catalogos` → `etl-modelos` (SIN fotos masivas; esas se corren aparte cuando exista la carpeta) → `etl-pedidos-ordenes` → `etl-produccion` → `etl-ipt` → `etl-compras-notas` → `etl-telas` → `etl-ruta-critica` → `etl-calidad` → `etl-esma` → `etl-costos` → `etl-indicadores` → **(3)** F9 OPCIONAL, solo si pasas sus banderas (ver abajo) → **(4)** **`realinear-estado-ordenes`** (paso final obligatorio de toda carga) → **(5)** `cuadre-f2`…`cuadre-f7` (+ `cuadre-f9` si diste `--saldos-terceros`). Cada paso corre como subproceso secuencial con banner y duración; al final imprime la tabla resumen.

**El realineado del estado de las órdenes va SIEMPRE** (no hace falta bandera): el ETL es fiel a Access, y la regla automática de `completa` es de v2 — sin este paso el semáforo de "Órdenes incompletas" queda desalineado recién cargada la base (ver la sección obligatoria de arriba). Corre **antes de los cuadres** a propósito: así los cuadres reportan el estado FINAL de la BD. Ningún cuadre lee `Orden.estado` (verificado: `cuadre-f2` cuenta órdenes sin filtrar por estado; el `estado` de `cuadre-f6` es el de `EsMaCargo`), así que el orden no altera ninguna cifra.

**F9 (Finanzas) es OPCIONAL y NO corre por defecto**: sus fuentes (corte de SINUBE / export del contador) **aún no existen** (D15c), así que meterlas al flujo tronaría por archivo faltante. Se activan con banderas explícitas, y el plan dice claramente cuándo se omiten y por qué:

- `--saldos-terceros=<ruta.csv>` → agrega `etl-terceros-saldos -- --archivo=<ruta>` y, al final, `cuadre-f9 -- --archivo=<ruta>`.
  **El corte de finanzas se alinea con la ventana**: si diste `--desde=YYYY-MM-DD`, ambos reciben además `--corte=YYYY-MM-DD`, así los renglones de apertura sin fecha propia quedan fechados en el corte y NO en HOY (que es el default de esos scripts) — coherente con los otros saldos iniciales (kardex PT/telas y EsMa usan `fecha = corte`). Sin `--desde` (recarga completa) se respeta su default.
- `--cfdi=<carpeta>` → agrega `etl-cfdi-masivo -- --dir=<carpeta>`.

Si la ventana (`--desde`) está activa y el corte de SINUBE trae terceros que el prescan de uso excluyó, el propio `etl-terceros-saldos` los LISTA como *"Apertura con tercero sin resolver (OMITIDA)"* — la red de seguridad de siempre: se ve en su reporte, nunca se pierde en silencio.

**Si un paso falla**, la recarga se detiene ahí con el mensaje de cómo seguir: los ETL son **idempotentes**, así que corriges la causa y re-corres con **`--confirmar` SIN `--limpiar`** — retoma desde donde quedó sin duplicar nada. **Caso especial:** si lo que falló fue el **seed** justo después de la limpieza, la BD quedó vacía y sin sembrar — ahí reanuda **CON `--limpiar --confirmar`** (volver a truncar una BD vacía es inocuo) o corre el seed a mano (`npx tsx --env-file=.env prisma/seed.ts`) y luego reanuda sin `--limpiar` (el propio comando imprime estas dos opciones).

**Al terminar (recordatorios que el propio comando repite):** reinicia el backend en Railway (invalida sesiones viejas y deja drenarse los jobs `pgboss` encolados antes de la limpieza — ese esquema NO se trunca; los handlers son resilientes y los absorben); el `admin` quedó con el password del seed — **cámbialo**; las fotos previas en R2 quedaron huérfanas (limitación conocida — deuda aparcada en `HOJA-DE-RUTA.md` §4); y cada ETL dejó su `reporte-etl-*.txt` en `backend/` para revisar con Daniel.

### Rendimiento (BD remota: la carga es *latency-bound*)

La corrida real del 31-jul-2026 (Mac → Railway por el proxy público) midió **~0.43 s por renglón**: el cuello es el **viaje redondo**, no el CPU. Todo el afinado es configurable por entorno — `recargar.ts` imprime en su banner cuál quedó activo:

| Variable | Default | Para qué |
|---|---|---|
| `ETL_CONCURRENCIA` | **12** (tope duro 64) | Tareas simultáneas de `enLotes`. Default conservador: el pool del ETL convive con el de la app y pg-boss contra el `max_connections` de Railway, y arriba de ~12 los loaders con folio se serializan igual en la fila `Secuencia`. |
| `ETL_POOL_MAX` | `ETL_CONCURRENCIA` + 4 | Conexiones del pool de `pg`. Debe ser ≥ concurrencia o las tareas esperan conexión. |
| `ETL_QUERY_TIMEOUT_MS` | 120000 | Tope del lado cliente (`query_timeout`). **Es el que evita el `SocketTimeout`** que mató la corrida. |
| `ETL_STATEMENT_TIMEOUT_MS` | 120000 | Tope del lado servidor (`statement_timeout`). |
| `ETL_TX_TIMEOUT_MS` / `ETL_TX_MAXWAIT_MS` | 120000 / 20000 | Tiempos de `$transaction` (los defaults de Prisma dan `P2028` con esta latencia). |

**Si truena por conexiones** (`sorry, too many clients already`): baja `ETL_CONCURRENCIA` (p. ej. 6) — aunque ese error ya está en la lista de transitorios y se reintenta. **Si va holgado**: súbela (24, 32). En PowerShell: `$env:ETL_CONCURRENCIA='6'`.

El **seed** usa el mismo afinado y paraleliza sus bucles de catálogo independientes; `limpiar-datos.ts` va **sin** `statement_timeout` a propósito (un TRUNCATE largo no debe morir por el tope).

### Qué filtra la ventana (`--desde` / `ETL_DESDE`) y qué migra completo

- **Filtrado por fecha propia** (documento anterior al corte → NO migra; fecha vacía = migra): pedidos (`FechaPedido`), pedidos reales (`FechaPedPR`), órdenes (`Fecha`), y los movimientos/documentos de F3–F7 que ya la respetaban (OC/notas por F4). **Cascada:** un hijo cuyo padre quedó fuera se excluye también (orden de pedido excluido, comentarios de orden excluida, renglones) — cada bucket se **cuenta** en el resumen/reporte del ETL (nada se descarta en silencio).
- **TODOS los catálogos van filtrados por USO** — ⭐ **orden del DUEÑO: ningún catálogo se migra completo "porque es chico".** Su razón: el histórico del viejo está lleno de datos que no se hicieron para este sistema, y ver miles de registros basura **abruma y ensucia la operación**. Y dentro de la ventana, **solo lo que tuvo actividad**: una entidad sin movimiento en 2025–2026 **no entra aunque tenga existencia o saldo viejo** (el dueño acepta perder ese inventario: *"ya no me sirve"*). Prescan en `comun/prescan-uso.ts`:
  - **Clientes**: referenciados por pedidos/órdenes dentro de la ventana.
  - **Modelos**: pedidos/órdenes en ventana ∪ kardex PT **de fecha ≥ corte** ∪ cíclico en ventana.
  - **Telas**: BOM de modelo usado ∪ `Ordenes.IdTelasDis` en ventana ∪ movimiento (`Entradas`/`Salidas`) **≥ corte**.
  - **Avíos y bordados**: BOM de un modelo usado — se encogen solos con los modelos.
  - **Colores**: los de `TelasColores` de **telas usadas** (grid + lote legacy + saldos iniciales de tela) ∪ los de `OrdenesDet` de **órdenes en ventana** (matriz color×talla). *(El kardex PT usa color SENTINELA y `Alm_InvCic` no tiene color.)* Era el mayor costo de la recarga remota: 5,857 textos ≈ 40 min, justo donde tronó la corrida real.
  - **Proveedores/terceros**: OC en ventana ∪ proveedor (texto) de telas/avíos usados ∪ terceros con actividad en ventana (órdenes migradas, notas en ventana, **EsMa con fecha ≥ corte**).
  - **Etiquetas de marca**: órdenes en ventana ∪ `IPT_Modelos` de modelos migrados. **Géneros**: `IPT_Modelos` de modelos migrados. **Temporadas**: modelos migrados. **Tela-categorías**: telas migradas. **Tallas y curvas**: cadenas `Ordenes.Tallas` de las órdenes en ventana.
  - El BOM y las **fotos** siguen a su modelo/bordado (cascada); el grid `TelasColores` sigue a su tela.
- **ÚNICAS excepciones (estructurales):** **empresas** y **almacenes** — son el *continente* de cada movimiento (empresa+almacén de todo asiento de kardex); quitar uno rompería el kardex de algo que sí migra, y son ~8 y ~7 filas.
- **Cierre inverso VERIFICADO** contra los CSV reales (16 comprobaciones, 0 faltantes): ningún modelo migrado queda sin su género/etiqueta/temporada, ninguna orden sin su talla/color/cliente/tela/maquilero, ninguna tela sin su categoría y **ningún lote/saldo inicial sin su color**.
- **Lo que SÍ se conserva: el saldo inicial de las entidades que SÍ migran.** Un modelo usado en 2025 cuyo stock viene de 2024 conserva su existencia (si no, saldría negativo). La maquinaria de saldos iniciales (kardex PT/telas, EsMa) sigue intacta y **solo produce asientos de entidades dentro del set**: los loaders descartan la fila *antes* de acumular cuando el modelo/tela no mapea, así que no quedan sintéticos huérfanos.
- **Constancia de lo que se deja de migrar:** los modelos y telas EXCLUIDOS que **sí traían existencia** se vuelcan a `excluidos-sin-actividad-<timestamp>.txt` (con su existencia estimada); en el `Reporte` queda el conteo + la ruta. No es una incidencia: es la decisión aplicada, por escrito.
- **Descartes masivos = buckets agregados:** las decenas de miles de filas de kardex de los modelos/telas excluidos se reportan con `Reporte.agregarMuestra` (conteo total + muestra acotada), **nunca** una incidencia por fila — si no, el reporte explotaría.
- **Migra COMPLETO (sin filtro):** **colores** (chicos, y referenciados por texto libre desde muchas fuentes — filtrarlos arriesga romper un saldo inicial de las entidades que sí migran; decisión declarada), empresas, almacenes, géneros, temporadas, etiquetas de marca, tela-categorías, tallas/curvas, y la configuración de Ruta Crítica (procesos, plantillas, roles, calendario).
- **Red de seguridad:** si el prescan dejara fuera algo que un ETL posterior sí necesita, ese ETL ya lo REPORTA como "sin mapeo" (incidencia visible, nunca silenciosa) — se corrige afinando el criterio o re-corriendo sin ventana.
- **Kardex (PT y telas) de lo que SÍ migra:** el histórico de movimientos ANTERIOR al corte no se migra movimiento a movimiento — se **condensa en saldos iniciales** a la fecha de corte (movimientos de saldo inicial tipo migración), para que las existencias cuadren sin cargar años de kardex. La condensación va por la granularidad real de cada kardex: en **PT** por **empresa × almacén × modelo** (con color/talla **sentinela**), y en **telas** por **tela × lote × almacén** (el lote va 1:1 con el color del viejo). Ya está implementado en los ETL de F3 (`etl-ipt`) y F4 (`etl-telas`).
- Con la ventana activa los cuadres imprimen su configuración (`describirVentana`): el delta v1-vs-v2 queda **explicado** (lo excluido por fecha es a propósito, no pérdida).
- `ETL_DESDE` **gana** sobre la pareja `ETL_VENTANA_ANIOS`/`ETL_VENTANA_REF` de F4 si ambas están definidas. Un valor **no-vacío mal formado ABORTA** el ETL (nunca se ignora en silencio: en un runbook destructivo un typo migraría el histórico completo); vacía/ausente = sin ventana.

### Apéndice: paso a paso manual (avanzado)

Solo si necesitas correr una pieza suelta (debug, re-correr un solo ETL). Es exactamente lo que `recargar.ts` automatiza:

**1. Vaciar la BD** (sin `--confirmar` es un ensayo que solo imprime conteos):

```bash
npx tsx --env-file=.env migracion/limpiar-datos.ts              # ensayo (no borra nada)
npx tsx --env-file=.env migracion/limpiar-datos.ts --confirmar  # TRUNCATE de todo (menos _prisma_migrations)
```

**2. Re-sembrar:** reinicia el backend en Railway con **`SEED_ON_START=true`** (o corre `npx tsx --env-file=.env prisma/seed.ts`, que es el mismo seed). El TRUNCATE también borró catálogos base, permisos, roles y el usuario `admin`; sin el seed no hay login ni menús. ⚠️ El `admin` vuelve al password del seed — **cámbialo** al entrar. El esquema **`pgboss` NO se trunca** (pueden quedar jobs de RC encolados apuntando a filas borradas; los handlers los absorben y el reinicio del backend los deja drenarse).

**3. Correr los ETL en su orden documentado** (el de arriba: F1 catálogos/modelos → F2 → F3 → F4 → F5 → F6 → F7), anteponiendo `ETL_DESDE`:

```bash
# Linux/macOS (bash):
ETL_DESDE=2025-01-01 npx tsx --env-file=.env migracion/etl-catalogos.ts
ETL_DESDE=2025-01-01 npx tsx --env-file=.env migracion/etl-pedidos-ordenes.ts
# … y así con cada script, en su orden.
```

```powershell
# Windows (PowerShell) — la variable queda puesta para TODA la sesión:
$env:ETL_DESDE = '2025-01-01'
npx tsx --env-file=.env migracion/etl-catalogos.ts
npx tsx --env-file=.env migracion/etl-pedidos-ordenes.ts
# … resto de scripts en su orden. Para quitarla:  Remove-Item Env:ETL_DESDE
```

**4. Cuadres:** corre los `cuadre-f*.ts` de siempre.

## Scripts disponibles

| Script | Qué hace |
|---|---|
| `migracion/recargar.ts` | ⭐ **RECARGA de punta a punta en un comando** (limpieza opcional + seed + 12 ETL + realineado de estado + 6 cuadres, secuencial con resumen; ver sección arriba) |
| `migracion/limpiar-datos.ts` | **VACÍA la BD** (TRUNCATE de todo `public` menos `_prisma_migrations`); sin `--confirmar` solo ensaya. Lo reusa `recargar.ts --limpiar` |
| `migracion/realinear-estado-ordenes.ts` | ⚠️ **MANTENIMIENTO OBLIGATORIO al terminar cualquier carga/recarga**: realinea el estado `completa`/`capturada` con la regla automática (`requisitosOrden`). Idempotente, por lotes; `--empresa=<id>` `--lote=<n>` `--dry-run`. Lo corre `recargar.ts` como paso final |
| `migracion/etl-catalogos.ts` | F1: catálogos, materiales, proveedores, mapeos |
| `migracion/etl-modelos.ts` | F1: modelos + BOM (con `--fotos-modelos` / `--fotos-bordados` para las fotos masivas) |
| `migracion/etl-pedidos-ordenes.ts` | **F2: pedidos + pedidos reales + órdenes + matriz + comentarios** (imprime el cuadre al final) |
| `migracion/etl-produccion.ts` | **F3: corte + envío + recibo + cargos EsMa** (Pieza A; recibos SIN efecto de kardex) |
| `migracion/etl-ipt.ts` | **F3: kardex histórico de inventario PT** (Pieza B; IPT_Movs → Movimiento, color/talla sentinela) |
| `migracion/etl-compras-notas.ts` | **F4: OC + notas legacy** (OrdCompra*/Notas* → OrdenCompra/NotaSalida; texto libre, SIN kardex/RecepcionCompra) |
| `migracion/etl-telas.ts` | **F4: entradas/salidas/traspasos de tela + lotes legacy** (clasifica traspasos vs compra vs salida-a-orden) |
| `migracion/cuadre-f4.ts` | **F4: cuadre TelasColAlm** v1 vs Σ movimientos v2 (descuadres listados, nunca corregidos — D3) |
| `migracion/etl-ruta-critica.ts` | **F5: Ruta Crítica completa** (catálogos + 54 ProcesoDefRol vigentes + plantillas CP_Tiempos + UsuarioRol + rutas históricas RC/IP3/IP4 + estado RC de órdenes + colchón); LISTA 14 huérfanas + pendientes F10 |
| `migracion/cuadre-f5.ts` | **F5: cuadre** v1(CSV) vs v2(BD) + huérfanas/pendientes-F10/FactorTela no migrada |
| `migracion/etl-calidad.ts` | **F6: Calidad** — `CC_Catalogo`(40)→DefectoCatalogo + `CC_Auditorias`(488)/`CC_AuditoriasDet`(15,296)→Auditoria/AuditoriaDefecto (modo migración: folio preservado, sin evento de RC) |
| `migracion/etl-esma.ts` | **F6: EsMa** — cargos (fix estampado: +1,251 recuperados) + `EsMa_Abonos`(554)/`EsMa_Desc`(743)/`EsMa_Pagos`(5,935) planos (pagos LIBRES, sin aplicaciones) |
| `migracion/cuadre-f6.ts` | **F6: cuadre** Calidad+EsMa (conteos v1/v2 + saldo por maquilero con fórmula derivada D3 + conciliación recibido-vs-cargado; incidencias listadas) |
| `migracion/etl-costos.ts` | **F7: Costos** — `CostoOrd`(2,513)→`CostoOrden` vía `guardarCostoOrden` (D2: regalía FUERA; procesos = maquila+bordado; avíos = habilitación) |
| `migracion/etl-indicadores.ts` | **F7: Indicadores** — personal/actividades + productividad IP (`IP_Productiv`)/almacén (`Alm_Prd`×`Alm_Prd_Det`) + fichas (`IP_InfConf`, despivota 8→8) + muestrarios (`IP_MuesPend`) + cíclico histórico Proscai (`Alm_InvCic`, D6) |
| `migracion/cuadre-f7.ts` | **F7: cuadre** (conteos v1/v2 + análisis empírico de la regalía D2: ¿el `Costo` viejo la incluía? + delta esperado) |
| `migracion/etl-terceros-saldos.ts` | **F9: saldos iniciales** de CxC/CxP (corte SINUBE → aperturas vía modo migración del motor; por lotes; `-- --archivo=<csv>`) |
| `migracion/etl-cfdi-masivo.ts` | **F9: importación masiva de CFDI** (carpeta de XML → reusa E3/E4; compra/venta por RFC de empresa; `-- --dir=<carpeta>`) |
| `migracion/cuadre-f9.ts` | **F9: cuadre** (saldo esperado del corte vs Σ aperturas cargadas; descuadres listados; `-- --archivo=<csv>`) |
| `migracion/cuadre.ts` | Cuadre F1 (conteos v1 CSV vs v2) |
| `migracion/cuadre-fase.ts` | Cuadre por fase |
| `migracion/cuadre-f2.ts` | Cuadre F2 en dos niveles (filas/sumas + columnas) + incidencias |
| `migracion/cuadre-f3.ts` | **Cuadre F3 en tres niveles** (conteos + existencias Σ kardex vs `IPT_Mod_Alm` + no-doble-conteo) |
| `migracion/analisis/catalogo-tallas.ts` | Análisis (read-only): catálogo de cadenas `Ordenes.Tallas` con frecuencia |

Todos: `npx tsx --env-file=.env migracion/<script>.ts`.

## Notas

- **Idempotente:** una segunda corrida no duplica (resuelve "ya existe" por `MapeoMigracion` y/o el unique `(idEmpresa, folio)`). Si una corrida se corta a media, re-ejecutar retoma donde quedó.
- **Re-ejecutable:** el ETL de F2 se vuelve a correr en F10 (al corte de go-live).
- **Reporte:** `etl-pedidos-ordenes.ts` escribe un `reporte-etl-f2e5-<timestamp>.txt` y `etl-ipt.ts` un `reporte-etl-f3-<timestamp>.txt` (ambos gitignored) con el cuadre y las incidencias a revisar con Daniel.
