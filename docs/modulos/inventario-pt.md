# Módulo Inventario PT (Producto Terminado) — Cómo quedó construido (F3-E3 + F3-E6)

> Referencia funcional: `Documentacion_MJD/04-Inventarios.md` (IPT) — no se duplica (ADR-0002).
> Motor y reglas del kardex: `docs/arquitectura/ADR-0010-motor-kardex-produccion.md`.
> Construido en F3-E1 (motor + modelo de datos), F3-E3 (operable: movimientos/traspasos/existencias/kardex)
> y migrado en F3-E6 (histórico real de IPT_Movs).

El inventario de **producto terminado** en v2 es un **kardex puro** (D3): la existencia NUNCA es una
columna editable, es **la SUMA de los movimientos**. Esto erradica el problema del sistema viejo, donde
`IPT_Mod_Alm.Existencia` se podía editar a mano y descuadraba contra los movimientos (doc 04 — Observación 1).

## Entidades y tablas de BD

| Entidad v2 | Tablas v2 | Fuente (CSV viejo) |
|---|---|---|
| Movimiento (encabezado de kardex) | `movimientos` | `IPT_Movs.csv` (~5,072) |
| MovimientoDetPt (renglón modelo×color×talla) | `movimiento_det_pt` | `IPT_MovsDet.csv` (~6,886) |
| TipoMovimientoInventario | `tipos_movimiento_inventario` | `IPT_TiposMov.csv` (19) + 2 patas de traspaso v2 |
| Almacen (PT) | `almacenes` (tipo `PT`) | `IPT_Almacenes.csv` (3: Primeras/Segundas/Tránsito) |
| existencia_pt (VISTA, solo consulta) | `existencia_pt` (CREATE VIEW) | — (derivada, D3) |

El **encabezado `Movimiento` es genérico** (PT/tela/avío — ADR-0010 §2); en F3 solo se ejercita el
detalle PT (`MovimientoDetPt`, dimensión modelo×color×talla — D4). El **origen** del movimiento es una
referencia polimórfica (`origenTipo` + `origenId`, ADR-0010 §1; valores en `comun/origenes.ts`).

## Motor de kardex (`backend/src/comun/kardex.ts`)

El ÚNICO lugar que escribe `Movimiento`/`MovimientoDetPt`. Genérico, sin lógica de negocio:
`registrarMovimientoPt` (encabezado+detalle+bitácora en una tx, folio atómico A3), `registrarTraspasoPt`
(dos patas salida+entrada en la MISMA tx), `cancelarMovimientoPt` (inverso auditado — D3/A7, JAMÁS borra),
`bloquearArticuloPt` + `existenciaPtBloqueada` (validación de no-negativo bajo advisory lock, suma DIRECTA
del detalle, NUNCA la vista — ADR-0010 §3). `costoUnit` queda NULL en toda F3 (D1/D2).

## Servicios de dominio (`backend/src/dominio/inventarios/`)

- `movimientos-pt.ts` (F3-E3) — orquesta el motor con las VALIDACIONES de negocio: movimiento manual
  (entrada/salida/ajuste; salidas validan no-negativo bajo lock), traspaso entre almacenes (valida el
  origen), cancelación (elige el tipo inverso `error-entrada`/`error-salida`), consulta de **existencias**
  (lee la vista `existencia_pt` — aquí SÍ, es consulta), **kardex por modelo** (saldo corrido en memoria)
  y por folio. Permisos `inventario-pt.ver` / `inventario-pt.mover` (A4).
  **El kardex por modelo es SIEMPRE de un PERIODO (fila 0.138)** — ver la sección de abajo.
- `impresos/impreso-traspaso-pt.ts` (fila 0.100) — **hoja del traspaso de PT** en PDF: el papel que
  acompaña las prendas que salen a otro almacén. Lleva el folio, la fecha, **quién lo registró**, los dos
  almacenes, el modelo, el **motivo** y la matriz color×talla con la orden de cada renglón. NO genera
  folio ni documento nuevo — imprime el folio que el traspaso YA tiene (el de la pata de salida), por el
  id de CUALQUIERA de las dos patas (por eso se **reimprime desde el kardex, modo «Por folio»**). Un
  traspaso cancelado no se imprime. Espejo de la hoja de tela (`impreso-traspaso-tela.ts`, §Post-F9.38),
  **incluidas sus dos puertas**: al guardar el traspaso y al buscarlo después por folio. El nombre del usuario se
  resuelve con `comun/nombres-usuario.ts` (`Movimiento.idUsuario` es un id sin FK, ADR-0005); si no
  resuelve, sale «—» y la hoja no se degrada (D3).
- `tipos-movimiento.ts` — catálogo de tipos de movimiento.
- `migracion.ts` (F3-E6) — **modo migración** dedicado: `crearMovimientoIptMigrado` (ver §Migración).

## El kardex por modelo es de un PERIODO (fila 0.138)

Antes, pedir el kardex de un modelo traía **todo su histórico**. Medido contra una base sintética de diez
años (100 000 movimientos / 500 000 renglones de detalle): **25 000 renglones y 8.3 MB de JSON en una sola
respuesta**. Daniel lo dijo en el repaso de inventarios: *«con diez años cargados, pedirlo trae todo»*.

Hoy `kardexPt` acota, y las reglas viven en el **dominio** (A1 — ni la ruta ni la pantalla deciden):

| Regla | Qué hace |
|---|---|
| `desde` / `hasta` (YYYY-MM-DD) | Periodo, **ambos bordes INCLUSIVOS**. Se resuelve en el `WHERE` (`movimientos.fecha`), nunca recortando en el cliente lo que ya llegó. |
| Ventana por omisión | Si no viene `desde`, se pone **hoy − 12 meses** (o `hasta` − 12 meses si sólo vino el techo). O sea: **el periodo SIEMPRE tiene piso**. Sin techo, para que un movimiento con fecha futura siga saliendo. |
| Tope duro `limite` | 1 000 renglones por omisión, **máximo 5 000**. Un rango ancho (`desde=2016-01-01`) no puede volver a traer todo. |
| ⭐ Dirección del corte | Cuando el periodo no cabe, se conserva **el FINAL** (`folio DESC` + inversión), no el principio. |

⭐ **Y el periodo trae de la mano su SALDO ANTERIOR (`saldosIniciales`).** Recortar a secas rompe la
columna «Saldo»: el primer renglón arrancaría en cero y todos los de abajo serían falsos. Una consulta
agregada suma, por artículo (color×talla×almacén×orden), todo lo que ese artículo movió **antes del primer
renglón visible** (D3: Σ de movimientos, jamás un saldo guardado) y con eso se siembra el saldo corrido.
Son dos ramas: lo anterior a `desde`, más —si hubo corte— lo del periodo que quedó por arriba, comparado
con **la misma llave `(folio, id)` con la que la lista se ordena y se corta**, no con la fecha; eso es lo
que impide que dos movimientos del mismo día a ambos lados del límite se dupliquen o se pierdan.

🔑 **El invariante que lo respalda, y que hay una prueba que lo fija:** *el saldo del último renglón
visible no depende de `limite`*. Medido sobre un artículo con 625 movimientos y existencia real 13 125:
con tope 5 000/1 000/100/10/1 el último renglón dice **13 125 en los cinco casos** — el saldo anterior
absorbe exactamente lo que el corte se llevó.

⚠️ **A9 y el MODELO son de corrección; color/talla/almacén/orden son de rendimiento.** La llave de
agrupación del saldo anterior es color×talla×almacén×orden, así que un renglón de otro color cae en otro
grupo y se descarta; pero `id_empresa` y `id_modelo` **no** están en esa llave, y quitarlos sumaría lo
ajeno dentro del mismo grupo. Por eso esos dos tienen prueba que muere al quitarlos y los otros cuatro no
pueden tenerla — dicho en el código en vez de fingido con una prueba que no mide nada.

La respuesta **declara qué pedazo se está viendo** (`desde`, `hasta`, `ventanaPorOmision`, `limite`,
`truncado`) y la pantalla lo pinta, con dos campos de fecha en la barra de filtros. Sin esa línea, una
ventana por omisión se leería como «este modelo no tiene más movimientos». Cuando corta, la pantalla dice
que se ven **los más recientes** y que lo anterior queda fuera pero **el saldo sí lo cuenta**.

### Sin índice nuevo, y por qué (medido)

El candidato era `movimientos(id_empresa, fecha)`. Medido en PostgreSQL 16 con 500 000 renglones de
detalle, con la consulta que Prisma emite de verdad:

| | consulta de renglones | consulta del saldo anterior |
|---|---|---|
| **SIN** índice | ~39 ms | ~68 ms |
| **CON** índice | ~33 ms | ~109 ms (**peor**) |

La selectividad la da `movimiento_det_pt.id_modelo` —ya es columna líder de
`@@index([idModelo, idColor, idTalla])`— y el salto a `movimientos` va por su PK. En el saldo anterior el
índice **empeora** el plan: `fecha < desde` toca ~90 % de las filas y el planeador se va igual a `Seq
Scan`, pagando de más. **No se puso**: encarecería cada escritura del kardex —la operación más frecuente
del módulo— a cambio de nada.

**Cuándo volver a mirarlo** (umbral concreto, no corazonada): correr el `EXPLAIN (ANALYZE, BUFFERS)` del
kardex y comparar los bloques del `Seq Scan on movimientos` contra los del `Bitmap Heap Scan on
movimiento_det_pt`. Hoy son ~1 000 contra ~4 700 (el 18 %). **Si el seq scan pasa a leer MÁS bloques que
el detalle del modelo, el índice empieza a pagar.** En la práctica eso ocurre cuando `movimientos` crece
mucho más rápido que los renglones del modelo típico — orientativamente, por encima del **millón de filas
en `movimientos`** con modelos de pocos miles de renglones.

> ⚠️ **QUÉ NO PRUEBA LA BASE SINTÉTICA.** Sirve para **tamaño y tiempo**, y **no** para saber qué ve el
> usuario cuando la lista se corta. Sus folios se generaron sin relación con la fecha (correlación medida
> folio↔fecha: **−0.0007**; el folio 1 está fechado 2026-08-13 y el 100 000 en 2018-09-27), mientras que en
> producción el folio es la **secuencia atómica por empresa (A3)** y por tanto crece con el tiempo. Ese
> detalle escondió un defecto real: con `ORDER BY folio ASC LIMIT 1000`, en una base de folios
> cronológicos la pantalla decía «Periodo: 2025-09-05 en adelante» y enseñaba **hasta 2026-02-07**,
> ocultando los siete meses recientes. **Cualquier medición sobre el corte se hace con una base cuyo folio
> sea monótono con la fecha**, o directamente contra `prueba`.

### Cómo medir esto en `prueba` (queda por hacer — es de Gabriel)

La fila pedía medir **existencias y kardex** con el histórico cargado. Lo de arriba es sintético; esto es
lo que falta, y se corre contra la base de `prueba`.

**1 · Volumen del kardex** (`psql` contra `prueba`, o el runner de SQL de Railway):

```sql
SELECT count(*) AS movimientos FROM movimientos;
SELECT count(*) AS renglones   FROM movimiento_det_pt;
SELECT min(fecha), max(fecha) FROM movimientos;

-- Reparto por año: cuánto pesa el histórico viejo.
SELECT date_part('year', m.fecha) AS anio, count(*) AS renglones
FROM movimiento_det_pt d JOIN movimientos m ON m.id = d.id_movimiento
GROUP BY 1 ORDER BY 1;

-- ⭐ El MODELO más pesado: es el que hay que abrir para medir el peor caso real.
SELECT mo.codigo, count(*) AS total,
       count(*) FILTER (WHERE m.fecha >= current_date - interval '12 months') AS ult12m
FROM movimiento_det_pt d
JOIN movimientos m  ON m.id  = d.id_movimiento
JOIN modelos     mo ON mo.id = d.id_modelo
GROUP BY 1 ORDER BY 2 DESC LIMIT 10;

-- ⭐ Y la comprobación que la base sintética NO puede dar: ¿el folio es cronológico?
-- El folio es consecutivo POR EMPRESA (A3), así que la correlación se mide DENTRO de una empresa:
-- mezclar dos numeraciones en el mismo `corr()` da un número que no significa nada. Hoy sólo hay
-- una empresa y sale igual, pero el día que haya dos, sin el WHERE deja de ser cierto.
SELECT id_empresa,
       corr(folio::float8, extract(epoch FROM fecha)) AS correlacion_folio_fecha
FROM movimientos GROUP BY 1;
```

**Qué mirar:** si `ult12m` del modelo más pesado supera **1 000**, la pantalla va a avisar de corte para
ese modelo — y ahí se decide si 1 000 es el número bueno o conviene subirlo (el techo es 5 000). La
correlación debe salir **cercana a 1**: si sale cerca de 0, el folio no es cronológico en producción y hay
que revisar la dirección del corte.

**2 · El kardex, en la pantalla** (`/inventarios/kardex`, con DevTools › Network abierto). Abrir el modelo
más pesado del punto 1 y anotar, de `GET /api/inventarios/pt/kardex`, **tamaño transferido y tiempo**:

| Caso | Qué pedir | Qué anotar |
|---|---|---|
| Por omisión | sólo elegir el modelo | tamaño, tiempo, y si sale el aviso de corte |
| Diez años a mano | `?idModelo=…&desde=2016-01-01` | tamaño, tiempo |
| Tope máximo | `?idModelo=…&desde=2016-01-01&limite=5000` | tamaño, tiempo |

**Criterio:** por omisión debería quedar **por debajo de ~400 KB y ~1 s**. Si el caso «diez años a mano»
con `limite=5000` pasa de **~2 MB o ~3 s**, conviene bajar el techo de 5 000.

**3 · ⭐ EXISTENCIAS, que esta fila NO tocó y puede ser fila propia.** `consultarExistenciasPt` lee la
vista `existencia_pt` con su propio SQL crudo y **no tiene tope ni paginación**: sin filtro de modelo
devuelve la vista entera.

```sql
SELECT count(*) AS filas_vista FROM existencia_pt;
SELECT count(*) AS con_saldo   FROM existencia_pt WHERE existencia <> 0;
-- Y el peor caso de la pantalla, tal cual lo pide sin filtros:
EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM existencia_pt WHERE id_empresa = 1 AND existencia <> 0;
```

Luego, en `/inventarios/existencias` **sin elegir modelo**, anotar tamaño y tiempo de
`GET /api/inventarios/pt/existencias`.

> 📌 **Ya hay un primer número, y no es tranquilizador.** Corrido contra una base de 525 000 renglones
> (sintética, no `prueba`): `existencia_pt` devolvió **56 860 filas en 614 ms**, sin tope ni paginación,
> en una sola respuesta. Confirma la forma del problema; falta el número de `prueba` para dimensionarlo.

**Criterio:** por encima de **~5 000 filas** (o ~1 MB / ~2 s) esa pantalla necesita su propia fila. El
rango de fechas **no aplica ahí** —una existencia no tiene fecha—: lo que aplicaría es paginación o exigir
modelo/almacén, y eso es un cambio de contrato que esta fila no hizo.

> **`IPT_Revision` (recuadre del viejo) NO se construye.** Con kardex puro no hay saldo materializado que
> "recuadrar"; cualquier ajuste es un movimiento de ajuste o un inverso auditado.

## Permisos (RBAC, A4)

- `inventario-pt.ver` — leer existencias / kardex / movimientos.
- `inventario-pt.mover` — registrar movimientos, traspasos, cancelaciones.

## Pantallas (frontend)

Lista + detalle (teal): existencias (responsive PC+móvil), kardex por modelo, captura de movimiento manual
y de traspaso, detalle de un movimiento por folio. Las dos capturas manuales exigen **motivo**.

La **hoja del traspaso** tiene **dos puertas** (fila 0.100), igual que la de tela:
1. `TraspasosPtPagina` — al guardar aparece el botón **«Hoja del traspaso»** con el folio recién registrado.
2. `KardexPtPagina`, modo **«Por folio»** — la **reimpresión**: se busca el folio y el detalle vuelve a
   ofrecer el botón. Guarda: sólo si el movimiento es un traspaso (`origenTipo === 'traspaso'`) y **no**
   está cancelado. Va con `inventario-pt.ver` (leer y reimprimir no es mover).

⚠️ El botón **no** está en la tabla del kardex *por modelo*: ese renglón (`esquemaKardexPtRenglon`) no
trae `origenTipo`, y añadírselo sería un cambio de contrato que esta fila no necesita. La reimpresión
entra por folio.

## Decisiones de diseño

- **Motivo OBLIGATORIO al mover PT a mano (fila 0.100, §Post-F9.193 decisión 3).** El movimiento manual y
  el traspaso exigen `motivo` (3–500 caracteres) — *"hoy se mueven mil piezas sin una palabra"* (Daniel).
  Es el MISMO campo, con el mismo texto y los mismos límites, que ya exigían los ajustes de tela y avío
  (`esquemaAjusteTelaCrear.motivo`), y se guarda en la MISMA columna que allá: `Movimiento.observaciones`
  (por eso el campo de ENTRADA se llama `motivo` y el de SALIDA `observaciones`). **Sin migración**: la
  columna ya existía. Sustituye al viejo `observaciones` opcional del cuerpo: dos textos libres apuntando
  a la misma columna acabarían con uno de los dos mintiendo.
  > **REGLA 0-B** — aplica de aquí en adelante. Los movimientos ya guardados sin motivo se quedan con
  > `observaciones` NULL, se leen y se imprimen tal cual («—» en la hoja); **no se rellenan ni se reparan**.
- **La hoja del traspaso NO genera folio (fila 0.100, decisión 2).** Daniel: la hoja lleva *"el folio del
  traspaso que ya existe"*. Un documento paralelo sería una SEGUNDA fuente de verdad del mismo hecho
  físico cuando el saldo ya se deriva del kardex (D3), y A3 queda intacto: no se toca ninguna secuencia.
- **Existencias y kardex de PT a Excel: NO se hacen** (decisión de Daniel en la misma fila). Se agregarán
  si los pide.
- **D3 existencia = Σ movimientos:** sin columna/tabla de saldo editable. Las validaciones transaccionales
  suman `MovimientoDetPt` DIRECTO bajo lock; la vista `existencia_pt` es **solo** para consulta/tableros.
- **D4 tallas/colores ilimitados:** el detalle del kardex es modelo×color×talla (catálogos `Color`/`Talla`).
- **Cancelación = inverso auditado (D3/A7):** nunca se edita ni borra un movimiento.

## Migración del histórico de IPT (F3-E6, Pieza B)

Se carga con el **MODO MIGRACIÓN** del dominio (`inventarios/migracion.ts` → `crearMovimientoIptMigrado`,
A1 — NO expuesto en REST), que llama al motor de kardex con `origenTipo = ORIGEN.migracion`. Reglas:

- **Decisión (c) — SENTINELA (DECISIONES.md F3-E6):** el viejo NO tenía color/talla en IPT. Cada
  movimiento histórico entra con un **Color y una Talla `(sin especificar)`** del catálogo, marcados
  **inactivos** (no aparecen en los selectores de captura nueva). Se upsertan una sola vez y se reúsan.
  Lo que el viejo sí sabía (modelo×almacén×cantidad) se preserva exacto; lo que nunca tuvo se marca como tal.
- **Un `Movimiento` por `IPT_MovsDet`** (no por `IPT_Movs`): cada renglón es su propio movimiento.
- **Empresa = la del MODELO viejo** (`IPT_Modelos.IdEmpresas` → mapeo `Empresa`): `IPT_Movs` no trae
  empresa. Modelo de empresa sin mapeo (inactivas / 0) → movimiento OMITIDO + reportado.
- **Tipo de movimiento:** `IPT_Movs.IdIPT_TipoMov` (1..19) → código del seed por POSICIÓN. Tipo `0/vacío`
  (464 filas del viejo) → "Otras Entradas/Salidas" según `EnSa`. Dirección que NO casa con `EnSa` (p. ej.
  el tipo 9 'traspaso', dir 3 — el histórico NO trae la contraparte de un traspaso v2) → se carga por
  `EnSa` como entrada/salida simple y se LISTA.
- **Almacén:** `IPT_Movs.IdIPT_Almacenes` → mapeo `Almacen:IPT`. Modelo: `IdIPT_Mod_Alm` →
  `IPT_Mod_Alm.IdIPT_Modelos` → `IPT_Modelos.NumMod` (= **código** de v2) → modelo.
- **`IPT_Movs.IdRecibos`** (2,353 filas): se conserva como **referencia informativa** en `observaciones`
  (`[v1 IdRecibos=…]`), **NUNCA** como FK ni efecto.
- **`EntregasCliente.csv` tiene 0 filas:** la entrega real vieja vive en `IPT_Movs` tipo 5 + PedidosReales
  (se documenta en el cuadre).
- **Idempotencia:** por `Movimiento.origenId` = `IdIPT_MovsDet` (origen `migracion`); 2ª corrida no duplica.
- **NO valida no-negativo:** el histórico se carga tal cual; un saldo inicial negativo o un descuadre del
  viejo se PRESERVA y se LISTA en el cuadre (no se corrige en silencio, §7).

### Excepción del ETL — por qué NO hay doble conteo

El kardex de v2 (entrada/salida real de existencia) en F3 proviene de **un único origen**: la migración de
`IPT_Movs`. La Pieza A (corte/envío/recibo/EsMa) carga sus etapas **SIN** generar kardex:

- Los **recibos de costura** del histórico se cargan como `EtapaMovimiento` tipo `recibo_maquila` **sin** la
  entrada a PT derivada (`generaEntradaPt`) que el flujo NUEVO (F3-E4) sí produce — porque esa entrada YA
  está en `IPT_Movs` (el viejo la registró como movimiento de inventario). Generarla otra vez duplicaría.
- Los **cargos EsMa** se cargan solo de `EsMa_Recibos` (cuenta de maquileros), NUNCA del kardex.

El **cuadre F3** lo verifica explícitamente (bloque 3): todo `Movimiento` de kardex tiene
`origenTipo = 'migracion'`; CERO provienen de `recibo-maquila` o de un cargo.

## Cómo correr el ETL de IPT y su cuadre

Ver `backend/migracion/README.md`. Desde `backend/`, SIEMPRE con `--env-file=.env` (NUNCA `npm run`):

```bash
# Prerequisitos: etl-catalogos (Empresa, Almacen:IPT) + etl-modelos (modelos por código) ya corridos,
# y el SEED del catálogo de tipos de movimiento + almacenes (SEED_ON_START=true en prueba).
npx tsx --env-file=.env migracion/etl-produccion.ts   # Pieza A (corte/envío/recibo/EsMa — sin kardex)
npx tsx --env-file=.env migracion/etl-ipt.ts          # Pieza B: kardex histórico de IPT (este módulo)
npx tsx --env-file=.env migracion/cuadre-f3.ts         # cuadre de TODA la fase (3 bloques)
```

`etl-ipt.ts` imprime el cuadre F3 al final y escribe `reporte-etl-f3-<timestamp>.txt` (gitignored).

### Cuadre F3 (tres bloques, §7)

1. **Conteos** v1 (CSV) vs v2 (BD) por entidad (cortes, envíos, recibos, cargos, movimientos IPT/dets).
2. **Existencias:** Σ kardex v2 por **modelo×almacén** (ignorando el sentinela) vs `IPT_Mod_Alm.Existencia`.
   Donde NO cuadra (saldo editado a mano en el viejo — D3 lo erradica) se **LISTA el descuadre con su
   causa**, jamás se corrige.
3. **No doble conteo:** todo el kardex es origen `migracion`; 0 de recibo/cargo.

## Decisión de rendimiento (vista normal vs materializada)

`existencia_pt` se deja como **VISTA normal** (no materializada) por ahora. Razones:

- Las validaciones transaccionales (no-negativo en salidas/traspasos/entregas) NUNCA usan la vista: suman
  `MovimientoDetPt` DIRECTO bajo advisory lock (ADR-0010 §3). La vista es solo para CONSULTA/tableros, donde
  una latencia mayor es tolerable.
- Hay índices de apoyo en `movimiento_det_pt` (`@@index([idModelo, idColor, idTalla])`, `@@index([idMovimiento])`)
  y en `movimientos` (empresa/almacén) que sostienen el `GROUP BY` de la vista para el volumen de `prueba`.
- **Recomendación:** medir en `prueba` con los 10 años de historia ya cargados ANTES de materializar. Si la
  consulta de existencias se vuelve lenta con el volumen real, materializar exige un **mini-ADR** y respeta
  ADR-0010: la materializada sería SOLO para consulta; las validaciones transaccionales seguirían sumando
  el detalle directo (la materializada nunca decide un no-negativo).
