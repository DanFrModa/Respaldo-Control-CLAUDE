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
```

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
