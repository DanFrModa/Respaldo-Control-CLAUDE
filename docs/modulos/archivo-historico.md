# Módulo — Archivo histórico de órdenes y Directorio de terceros (post-F9)

> Cómo quedaron construidos los dos módulos de **CONSULTA de la historia del sistema viejo**. No
> duplica el funcional (ADR-0002): el QUÉ y el porqué de negocio están en
> `Documentacion_MJD/DECISIONES.md` §(Post-F9.26), §(Post-F9.27) y §(Post-F9.28). Aquí va el CÓMO.

Nacieron como consecuencia de dos decisiones previas: la **depuración del catálogo de proveedores**
(§Post-F9.23) y el **corte de la migración a 2025-2026** (§Post-F9.24). Entre las dos dejan fuera de
lo operativo ~5,200 órdenes y ~897 terceros, y estos dos módulos son donde esa historia **se
consulta sin volver a ensuciar los catálogos**.

## La idea que los hace baratos: SOLO LECTURA

Ninguno de los dos tiene alta, edición ni cancelación — y no los va a tener. Se llenan **una vez**
con el ETL y desde la aplicación solo se leen. Por eso:

- **No hay folios, ni estados, ni kardex, ni existencias**: nada que proteger con reglas de negocio.
- **El ETL escribe con Prisma directo**, sin pasar por una capa de dominio de escritura. Es una
  **excepción consciente a A1**, y la razón es explícita: una capa de dominio aquí sería ceremonia
  sobre un `INSERT`. El dominio existe, pero solo para LEER.
- **Cero permisos nuevos, cero seed**: se reusan `ordenes.ver` (el archivo) y `proveedores.ver`
  (el directorio).

## Archivo histórico de órdenes

### Datos (`backend/prisma/schema.prisma`)

| Tabla | Qué guarda |
|---|---|
| `HistoricoOrdenV1` | La cabecera de la orden vieja (`@@unique([idEmpresa, idOrdenV1])` = llave de idempotencia del ETL). |
| `HistoricoOrdenV1Linea` | Una celda color×talla ya despivotada (`OrdenesDet` de ancho fijo, ver abajo). |
| `HistoricoOrdenV1Proceso` | Un movimiento de producción del viejo (enum de 5 tipos: corte, envío/recibo de maquila, envío/recibo de estampado). |

**Dos reglas de modelado, y son las que lo mantienen inocuo:**

1. **Los terceros van como TEXTO** (`maquilero`, `cortadores`, `maquileros`, `estampadores`,
   `HistoricoOrdenV1Proceso.tercero`), resueltos UNA vez al migrar leyendo los CSV del viejo. Un
   taller que no sobrevivió a la depuración **se ve y se busca, pero no revive** como `Proveedor`.
2. **La única FK de verdad es `idModelo`**, porque los modelos migran completos (4,987). Es lo que
   permite filtrar por **tipo de prenda** y **género** sin copiar esos campos — y la razón por la que
   el catálogo de modelos NO se depura. `codigoModeloV1` respalda la búsqueda cuando el mapeo falló.

Las tres columnas de talleres (§Post-F9.27) **duplican** a propósito lo que ya está en los procesos:
se ven en el renglón del listado y se buscan sin un subquery por fila. Normalmente eso es deuda —la
copia se desincroniza—, pero este archivo es **inmutable**, así que aquí no cuesta nada.

### Dominio y API

- `backend/src/dominio/consultas/historico-ordenes.ts` — `listarHistoricoOrdenes` (filtros +
  paginación) y `obtenerHistoricoOrden` (ficha). **Solo lectura**, A9 por empresa activa.
- Rutas `GET` en `backend/src/api/consultas/historico-ordenes.rutas.ts`, permiso `ordenes.ver`.

**El filtro de taller mira TODOS los lados** (§Post-F9.27): la cabecera, los tres campos abiertos y
—como red— los propios movimientos de producción. Buscar solo por la cabecera dejaba fuera justo lo
que se busca.

**Orden con NULOS al final.** `fecha` y `cliente` son nullable y en Postgres `DESC` implica
`NULLS FIRST`; como el orden por defecto es `fecha desc`, sin `nulls: 'last'` la primera página se
llenaba de órdenes viejas sin fecha en vez de las más recientes. Ver `columnaDeOrden`.

### Pantallas

*Producción › Archivo de órdenes* (`frontend/src/modulos/historico/ArchivoOrdenesPagina.tsx`): los
filtros que pidió Daniel (cliente, modelo, tipo de prenda, fecha de producción, maquilero) + caja de
búsqueda libre; el número de orden abre la ficha con la matriz color×talla y **quién la trabajó**
(*Cortaron · Cosieron · Estamparon*).

## Directorio histórico de terceros

`DirectorioTerceroV1` es una **libreta de direcciones**, no un catálogo:

- **No sale en NINGÚN selector de captura** (ni telas, ni OC, ni maquila, ni EsMa).
- **No tiene roles, ni `activo`, ni bandera de factura, ni FK a nada.**
- **No hay —ni habrá— botón de "convertir en proveedor".** Ese botón sería la puerta trasera por la
  que volvería la basura recién depurada; si un taller vuelve, se da de alta LIMPIO copiando de aquí
  lo que sirva. **Es la decisión, no un pendiente.**
- Entran **todos**, también los 155 que sobrevivieron, marcados con `enCatalogo`.

Lo que la hace útil más allá del teléfono: `ultimaActividad` (fecha del último documento suyo en el
viejo) y `documentos` (cuántos tuvo). Se busca **también por teléfono** — a veces se llega al revés.
Igual que el archivo, el orden por `ultimaActividad` fuerza **NULOS al final**: si no, la consulta
natural (*"¿con quién trabajamos más recientemente?"*) devolvía primero a los que nunca movieron
nada.

- Dominio: `backend/src/dominio/consultas/directorio-terceros.ts` (solo `listar`).
- Pantalla: *Catálogos › Directorio histórico*
  (`frontend/src/modulos/historico/DirectorioTercerosPagina.tsx`), junto al catálogo de proveedores
  pero claramente separado de él (el subtítulo dice *"solo consulta; NO es el catálogo"*).

## El ETL — cómo se corre, y qué garantiza

Los dos módulos se llenan con **un solo ETL**, porque son las dos mitades de *guardar la historia sin
ensuciar los catálogos*:

```bash
# desde backend/, DESPUÉS de etl-catalogos (necesita los mapeos de Empresa y Modelo)
npx tsx --env-file=.env migracion/etl-historico-ordenes.ts
```

Nunca con `npm run etl:*` (esos no cargan `.env` a propósito, para no romper el CI).

**Se corre A MANO después del deploy**: no hay nada automático que lo dispare. Ignora a propósito la
ventana `ETL_DESDE` de §Post-F9.24 — existe justamente para guardar lo que la ventana deja fuera.

**Idempotente en los DOS sentidos** (`migracion/loaders/historico-ordenes.ts`):

- **No duplica**: la llave es `(idEmpresa, idOrdenV1)` para el archivo y `(fuente, idViejo)` para la
  libreta.
- **Completa lo que falte**: cabecera e hijos de cada tanda de órdenes viajan en la **misma
  transacción** (`ORDENES_POR_TX`), y al arrancar se detectan las órdenes que quedaron **sin
  detalle** por una corrida interrumpida y se reparan. Antes, una caída después de las cabeceras
  (son ~85,000 renglones, contra una BD que está del otro lado de la red) dejaba miles de órdenes sin
  una sola celda ni proceso **para siempre**, porque la re-corrida las daba por cargadas.

**Escritura POR LOTES** (`createMany` en tandas), nunca fila por fila — regla de Gabriel del 19-jun.

**Nada se descarta en silencio** (plan §7): las cadenas de tallas ambiguas, las órdenes sin empresa
mapeada, las que no ligan modelo y las fichas vacías del directorio salen listadas en el reporte que
el ETL escribe al terminar.

### Detalles del viejo que hay que conocer

- **`Ordenes.Tallas` es posicional**, en ventanas fijas de 2 caracteres: `T1..T8` de `OrdenesDet` se
  alinean con la ventana n. Se despivota con el MISMO lector de F2 (`comun/tallas-orden.ts`). Si la
  cadena es ambigua se reporta, pero **la cantidad no se pierde**: lo dudoso es la etiqueta.
- **`EntregasEst`/`RecibosEst` traen la columna `IdMaquileros` pero apuntan al catálogo de
  MAQUILEROS**, no al de Estampadores (verificado en §Post-F9.23: `Estampadores.csv` es un catálogo
  muerto). Por eso su tercero se resuelve contra el mapa de maquileros, y su actividad suma ahí.
- **La identidad de varios terceros vive en `Corto`**, no en `Nombre`+`Apellidos` (Bordaprint, Fit
  Print, Eurobordados…). El nombre cae a la clave corta cuando no hay otro; si no hay ninguno de los
  dos, la ficha está vacía y se descarta **reportándola**.
- **Los colores NO se normalizan**: el viejo los guardaba como texto libre, así que conviven
  "MARINO", "Marino" y "MAR.". En un archivo de consulta eso se lee y se entiende; adivinar
  equivalencias entre 39,866 celdas metería errores silenciosos.

## Pruebas

- `backend/migracion/etl-historico-ordenes.int.test.ts` — carga, idempotencia, **reparación de una
  corrida interrumpida** y el rescate de los terceros que solo tienen clave corta (fixture propio en
  `migracion/__fixtures__/tablas-historico/`).
- `backend/migracion/loaders/historico-ordenes.test.ts` — unit de `nombresDistintos` (§Post-F9.27).
- `backend/src/dominio/consultas/*.int.test.ts` — el orden con columnas nullable, contra Postgres de
  verdad (es donde se ve).
