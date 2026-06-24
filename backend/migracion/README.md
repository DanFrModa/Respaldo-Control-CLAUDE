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
```

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

## Scripts disponibles

| Script | Qué hace |
|---|---|
| `migracion/etl-catalogos.ts` | F1: catálogos, materiales, proveedores, mapeos |
| `migracion/etl-modelos.ts` | F1: modelos + BOM (con `--fotos-modelos` / `--fotos-bordados` para las fotos masivas) |
| `migracion/etl-pedidos-ordenes.ts` | **F2: pedidos + pedidos reales + órdenes + matriz + comentarios** (imprime el cuadre al final) |
| `migracion/etl-produccion.ts` | **F3: corte + envío + recibo + cargos EsMa** (Pieza A; recibos SIN efecto de kardex) |
| `migracion/etl-ipt.ts` | **F3: kardex histórico de inventario PT** (Pieza B; IPT_Movs → Movimiento, color/talla sentinela) |
| `migracion/etl-compras-notas.ts` | **F4: OC + notas legacy** (OrdCompra*/Notas* → OrdenCompra/NotaSalida; texto libre, SIN kardex/RecepcionCompra) |
| `migracion/etl-telas.ts` | **F4: entradas/salidas/traspasos de tela + lotes legacy** (clasifica traspasos vs compra vs salida-a-orden) |
| `migracion/cuadre-f4.ts` | **F4: cuadre TelasColAlm** v1 vs Σ movimientos v2 (descuadres listados, nunca corregidos — D3) |
| `migracion/etl-ruta-critica.ts` | **F5: Ruta Crítica completa** (catálogos + 54 ProcesoDefRol vigentes + plantillas CP_Tiempos + UsuarioRol + rutas históricas RC/IP3/IP4 + estado RC de órdenes + colchón); LISTA 14 huérfanas + pendientes F9 |
| `migracion/cuadre-f5.ts` | **F5: cuadre** v1(CSV) vs v2(BD) + huérfanas/pendientes-F9/FactorTela no migrada |
| `migracion/cuadre.ts` | Cuadre F1 (conteos v1 CSV vs v2) |
| `migracion/cuadre-fase.ts` | Cuadre por fase |
| `migracion/cuadre-f2.ts` | Cuadre F2 en dos niveles (filas/sumas + columnas) + incidencias |
| `migracion/cuadre-f3.ts` | **Cuadre F3 en tres niveles** (conteos + existencias Σ kardex vs `IPT_Mod_Alm` + no-doble-conteo) |
| `migracion/analisis/catalogo-tallas.ts` | Análisis (read-only): catálogo de cadenas `Ordenes.Tallas` con frecuencia |

Todos: `npx tsx --env-file=.env migracion/<script>.ts`.

## Notas

- **Idempotente:** una segunda corrida no duplica (resuelve "ya existe" por `MapeoMigracion` y/o el unique `(idEmpresa, folio)`). Si una corrida se corta a media, re-ejecutar retoma donde quedó.
- **Re-ejecutable:** el ETL de F2 se vuelve a correr en F9 (al corte de go-live).
- **Reporte:** `etl-pedidos-ordenes.ts` escribe un `reporte-etl-f2e5-<timestamp>.txt` y `etl-ipt.ts` un `reporte-etl-f3-<timestamp>.txt` (ambos gitignored) con el cuadre y las incidencias a revisar con Daniel.
