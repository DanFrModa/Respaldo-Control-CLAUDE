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
npx tsx --env-file=.env migracion/cuadre-f5.ts             # F5: solo el cuadre (v1 CSV vs v2 + huérfanas/pendientes-F9/FactorTela)

# F6 (Calidad + EsMa) — idempotentes (Calidad y EsMa son independientes):
npx tsx --env-file=.env migracion/etl-calidad.ts           # F6: defectos + auditorías + detalles (modo migración, SIN eventos de RC)
npx tsx --env-file=.env migracion/etl-esma.ts              # F6: cargos (con fix de estampado) + abonos/descuentos/pagos históricos
npx tsx --env-file=.env migracion/cuadre-f6.ts             # F6: cuadre Calidad+EsMa (conteos + saldo por maquilero + conciliación)

# F7 (Costos/EDR + Indicadores) — idempotentes (Costos e Indicadores son independientes):
npx tsx --env-file=.env migracion/etl-costos.ts            # F7: CostoOrd → CostoOrden (D2: regalía FUERA del costo)
npx tsx --env-file=.env migracion/etl-indicadores.ts       # F7: personal/actividades + productividad IP/almacén + fichas + muestrarios + cíclico histórico (D6)
npx tsx --env-file=.env migracion/cuadre-f7.ts             # F7: cuadre (conteos + análisis de la regalía D2)
```

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
> · 23 usuarios con tipo · 181 renglones RC · checklist IP3/IP4. **⚠️ `UsuarioRol` depende de F9:** los 137
> usuarios del viejo aún NO están en v2 (eso es F9); el ETL asigna el rol a los que YA existen en v2 por su
> login y **LISTA el resto como "pendiente F9"** — **re-correr este ETL tras la migración de usuarios (F9)
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
- **`--sin-cuadres`**: se salta los 6 cuadres del final.

Qué hace, en orden: **(0)** limpieza (si `--limpiar --confirmar`) → **(1)** el **seed de fundación** (el MISMO `prisma/seed.ts` idempotente que dispara `SEED_ON_START`; correrlo aquí evita esperar un redeploy para poder cargar) → **(2)** los ETL: `etl-catalogos` → `etl-modelos` (SIN fotos masivas; esas se corren aparte cuando exista la carpeta) → `etl-pedidos-ordenes` → `etl-produccion` → `etl-ipt` → `etl-compras-notas` → `etl-telas` → `etl-ruta-critica` → `etl-calidad` → `etl-esma` → `etl-costos` → `etl-indicadores` → **(3)** `cuadre-f2`…`cuadre-f7`. Cada paso corre como subproceso secuencial con banner y duración; al final imprime la tabla resumen.

**Si un paso falla**, la recarga se detiene ahí con el mensaje de cómo seguir: los ETL son **idempotentes**, así que corriges la causa y re-corres con **`--confirmar` SIN `--limpiar`** — retoma desde donde quedó sin duplicar nada. **Caso especial:** si lo que falló fue el **seed** justo después de la limpieza, la BD quedó vacía y sin sembrar — ahí reanuda **CON `--limpiar --confirmar`** (volver a truncar una BD vacía es inocuo) o corre el seed a mano (`npx tsx --env-file=.env prisma/seed.ts`) y luego reanuda sin `--limpiar` (el propio comando imprime estas dos opciones).

**Al terminar (recordatorios que el propio comando repite):** reinicia el backend en Railway (invalida sesiones viejas y deja drenarse los jobs `pgboss` encolados antes de la limpieza — ese esquema NO se trunca; los handlers son resilientes y los absorben); el `admin` quedó con el password del seed — **cámbialo**; las fotos previas en R2 quedaron huérfanas (limitación conocida — deuda aparcada en `HOJA-DE-RUTA.md` §4); y cada ETL dejó su `reporte-etl-*.txt` en `backend/` para revisar con Daniel.

### Qué filtra la ventana (`--desde` / `ETL_DESDE`) y qué migra completo

- **Filtrado por fecha propia** (documento anterior al corte → NO migra; fecha vacía = migra): pedidos (`FechaPedido`), pedidos reales (`FechaPedPR`), órdenes (`Fecha`), y los movimientos/documentos de F3–F7 que ya la respetaban (OC/notas por F4). **Cascada:** un hijo cuyo padre quedó fuera se excluye también (orden de pedido excluido, comentarios de orden excluida, renglones) — cada bucket se **cuenta** en el resumen/reporte del ETL (nada se descarta en silencio).
- **Clientes por USO:** solo migran los clientes referenciados por pedidos/órdenes **dentro** de la ventana; el resto se cuenta y se lista en el reporte de `etl-catalogos`.
- **Migra COMPLETO (sin filtro):** todos los catálogos (colores, tallas, telas, avíos, proveedores, empresas, modelos+BOM) y la configuración de Ruta Crítica (procesos, plantillas, roles, calendario).
- **Kardex (PT y telas):** el histórico de movimientos ANTERIOR al corte no se migra movimiento a movimiento — se **condensa en saldos iniciales** a la fecha de corte (movimientos de saldo inicial tipo migración), para que las existencias cuadren sin cargar años de kardex. La condensación va por la granularidad real de cada kardex: en **PT** por **empresa × almacén × modelo** (con color/talla **sentinela**), y en **telas** por **tela × lote × almacén** (el lote va 1:1 con el color del viejo). Ya está implementado en los ETL de F3 (`etl-ipt`) y F4 (`etl-telas`).
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

| Script                                  | Qué hace                                                                                                                                                                                                                             |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `migracion/recargar.ts`                 | ⭐ **RECARGA de punta a punta en un comando** (limpieza opcional + seed + 12 ETL + 6 cuadres, secuencial con resumen; ver sección arriba)                                                                                            |
| `migracion/limpiar-datos.ts`            | **VACÍA la BD** (TRUNCATE de todo `public` menos `_prisma_migrations`); sin `--confirmar` solo ensaya. Lo reusa `recargar.ts --limpiar`                                                                                              |
| `migracion/etl-catalogos.ts`            | F1: catálogos, materiales, proveedores, mapeos                                                                                                                                                                                       |
| `migracion/etl-modelos.ts`              | F1: modelos + BOM (con `--fotos-modelos` / `--fotos-bordados` para las fotos masivas)                                                                                                                                                |
| `migracion/etl-pedidos-ordenes.ts`      | **F2: pedidos + pedidos reales + órdenes + matriz + comentarios** (imprime el cuadre al final)                                                                                                                                       |
| `migracion/etl-produccion.ts`           | **F3: corte + envío + recibo + cargos EsMa** (Pieza A; recibos SIN efecto de kardex)                                                                                                                                                 |
| `migracion/etl-ipt.ts`                  | **F3: kardex histórico de inventario PT** (Pieza B; IPT_Movs → Movimiento, color/talla sentinela)                                                                                                                                    |
| `migracion/etl-compras-notas.ts`        | **F4: OC + notas legacy** (OrdCompra*/Notas* → OrdenCompra/NotaSalida; texto libre, SIN kardex/RecepcionCompra)                                                                                                                      |
| `migracion/etl-telas.ts`                | **F4: entradas/salidas/traspasos de tela + lotes legacy** (clasifica traspasos vs compra vs salida-a-orden)                                                                                                                          |
| `migracion/cuadre-f4.ts`                | **F4: cuadre TelasColAlm** v1 vs Σ movimientos v2 (descuadres listados, nunca corregidos — D3)                                                                                                                                       |
| `migracion/etl-ruta-critica.ts`         | **F5: Ruta Crítica completa** (catálogos + 54 ProcesoDefRol vigentes + plantillas CP_Tiempos + UsuarioRol + rutas históricas RC/IP3/IP4 + estado RC de órdenes + colchón); LISTA 14 huérfanas + pendientes F9                        |
| `migracion/cuadre-f5.ts`                | **F5: cuadre** v1(CSV) vs v2(BD) + huérfanas/pendientes-F9/FactorTela no migrada                                                                                                                                                     |
| `migracion/etl-calidad.ts`              | **F6: Calidad** — `CC_Catalogo`(40)→DefectoCatalogo + `CC_Auditorias`(488)/`CC_AuditoriasDet`(15,296)→Auditoria/AuditoriaDefecto (modo migración: folio preservado, sin evento de RC)                                                |
| `migracion/etl-esma.ts`                 | **F6: EsMa** — cargos (fix estampado: +1,251 recuperados) + `EsMa_Abonos`(554)/`EsMa_Desc`(743)/`EsMa_Pagos`(5,935) planos (pagos LIBRES, sin aplicaciones)                                                                          |
| `migracion/cuadre-f6.ts`                | **F6: cuadre** Calidad+EsMa (conteos v1/v2 + saldo por maquilero con fórmula derivada D3 + conciliación recibido-vs-cargado; incidencias listadas)                                                                                   |
| `migracion/etl-costos.ts`               | **F7: Costos** — `CostoOrd`(2,513)→`CostoOrden` vía `guardarCostoOrden` (D2: regalía FUERA; procesos = maquila+bordado; avíos = habilitación)                                                                                        |
| `migracion/etl-indicadores.ts`          | **F7: Indicadores** — personal/actividades + productividad IP (`IP_Productiv`)/almacén (`Alm_Prd`×`Alm_Prd_Det`) + fichas (`IP_InfConf`, despivota 8→8) + muestrarios (`IP_MuesPend`) + cíclico histórico Proscai (`Alm_InvCic`, D6) |
| `migracion/cuadre-f7.ts`                | **F7: cuadre** (conteos v1/v2 + análisis empírico de la regalía D2: ¿el `Costo` viejo la incluía? + delta esperado)                                                                                                                  |
| `migracion/cuadre.ts`                   | Cuadre F1 (conteos v1 CSV vs v2)                                                                                                                                                                                                     |
| `migracion/cuadre-fase.ts`              | Cuadre por fase                                                                                                                                                                                                                      |
| `migracion/cuadre-f2.ts`                | Cuadre F2 en dos niveles (filas/sumas + columnas) + incidencias                                                                                                                                                                      |
| `migracion/cuadre-f3.ts`                | **Cuadre F3 en tres niveles** (conteos + existencias Σ kardex vs `IPT_Mod_Alm` + no-doble-conteo)                                                                                                                                    |
| `migracion/analisis/catalogo-tallas.ts` | Análisis (read-only): catálogo de cadenas `Ordenes.Tallas` con frecuencia                                                                                                                                                            |

Todos: `npx tsx --env-file=.env migracion/<script>.ts`.

## Notas

- **Idempotente:** una segunda corrida no duplica (resuelve "ya existe" por `MapeoMigracion` y/o el unique `(idEmpresa, folio)`). Si una corrida se corta a media, re-ejecutar retoma donde quedó.
- **Re-ejecutable:** el ETL de F2 se vuelve a correr en F9 (al corte de go-live).
- **Reporte:** `etl-pedidos-ordenes.ts` escribe un `reporte-etl-f2e5-<timestamp>.txt` y `etl-ipt.ts` un `reporte-etl-f3-<timestamp>.txt` (ambos gitignored) con el cuadre y las incidencias a revisar con Daniel.
