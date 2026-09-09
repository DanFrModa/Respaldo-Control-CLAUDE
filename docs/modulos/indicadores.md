# Módulo — Indicadores (F7)

> Cómo quedó construido el **módulo de Indicadores** en CONTROL v2. No duplica el funcional
> (ADR-0002): para el QUÉ del negocio, ver `Documentacion_MJD/05-Indicadores.md`, `08-Ruta-Critica.md`
> §4.4 y `DECISIONES.md` §D6/D11. Aquí va el CÓMO de v2.

Construido en F7 (E3 = motor de KPIs/tableros, E4 = productividad + fichas + muestrarios, E5 =
inventario cíclico, E6 = ETL de cierre). Es el **módulo 11** del plan.

## Alcance

- **Productividad unificada IP / Almacén** (F7-E4): índices de productividad vs estándar, con **un
  solo motor** distinguido por `area` (Ingeniería del Producto / Almacén) en vez de las tablas
  paralelas del viejo (A6/D4).
- **Fichas confiables** (F7-E4): checklist de confiabilidad de la ficha técnica **por orden**.
- **Muestrarios pendientes** (F7-E4): seguimiento boards/muestras (solicitud → entrega) con KPI de
  cumplimiento.
- **Inventario cíclico** (F7-E5; **extendido a las TRES dimensiones en la fila 0.099**): conteo
  físico **contra el kardex propio de v2** (D6), de **producto terminado, telas o avíos**.
- **Tableros/KPIs directivos** (F7-E3): sobre **vistas materializadas** que refresca un job de
  pg-boss; la captura nunca espera un recálculo (muestra "datos al: `<fecha>`").

## Capas (A1 — lógica solo en dominio)

- **Dominio** `backend/src/dominio/indicadores/`:
  - `productividad.ts` — CRUD de `PersonalArea` y `ActividadProductividad` (catálogos GLOBALES,
    ADR-0007) + `registrarProductividad` / `cancelarRegistroProductividad` + el **tablero agregado en
    servidor**. El `area` la determina la ACTIVIDAD (se sella). **IP** exige `idPersona` (área ip) y
    `horasBase`; **Almacén** usa la cuadrilla `personas` y el estándar `pzPersDia > 0` (divisor del
    índice). Cancelación SUAVE (A7); nunca se edita/borra.
  - `fichas.ts` — `obtenerFichaOrden` / `verificarFichaOrden` (upsert por `(idOrden, idReactivo)`).
    El indicador **% de fichas confiables** = Σ reactivos OK ÷ Σ evaluados, agregado en SQL.
  - `muestrarios.ts` — `crearMuestrario` / `actualizarMuestrario` / `entregarMuestrario` /
    `cancelarMuestrario` + el KPI de cumplimiento (`fechaEntregado ≤ fechaRequerida`).
  - `inventario-ciclico.ts` — el **MOTOR** del cíclico, común a las tres dimensiones:
    `crearInventarioCiclico` (ALTA que **CONGELA el teórico** desde el kardex, D6),
    `capturarConteo`, `agregarRenglonCiclico` (mercancía que el sistema cree que **no tiene**),
    `consultarExactitud`, `generarAjusteCiclico` (el ajuste es un **movimiento de kardex**, D3, nunca
    una edición de saldo) y `cancelarInventarioCiclico`. `planearAjuste` está **exportada para
    probarse**: es la aritmética pura del cierre (las dos patas + el aviso).
  - `ciclico/` (fila 0.099) — **un ADAPTADOR por dimensión** (`pt.ts` / `tela.ts` / `avio.ts`) detrás
    del contrato de `tipos.ts`, más su `registro.ts`. El adaptador aporta las cuatro operaciones que
    dependen de la LLAVE del artículo —**enumerar**, **congelar/re-leer la existencia bajo bloqueo**,
    **aplicar el ajuste al kardex** y **describir** el artículo— y declara su `escala` (0 en PT, 4 en
    telas y avíos), si su conteo es ciego y qué permiso EXTRA exige su ajuste. Sumar una cuarta
    dimensión es escribir su adaptador y añadirlo al registro.
  - `kpis.ts` / `fechas.ts` — los tableros sobre vistas materializadas y el gate de "fecha libre".
    **La ventana de captura**: sin `indicadores.fecha-libre`, los **cuatro** llamadores (alta de ficha,
    alta y entrega de muestrario, y registro de productividad) sólo aceptan los **últimos 7 días** y
    nunca una fecha futura; con el permiso, cualquiera. La guarda es `comun/fecha-capturable.ts` —
    **la misma pieza que usa el almacén de PT** con su propio permiso, y el número vive ahí y en
    ningún otro sitio.
    ⏱️ **Y «hoy» es el día del NEGOCIO, no el del servidor (fila 0.174).** Se ancla en `hoyDelNegocio`
    (`comun/fecha-negocio.ts`). Antes se anclaba en el día **UTC**: como México va en −06:00, de 18:00
    a 23:59 —el turno de la tarde entero— se colaba **el día siguiente** del calendario mexicano y la
    ventana valía 6 días completos en vez de 7.
    ⚠️ **Efecto que se nota aunque no toques ningún permiso:** cuando el alta de ficha
    (`fichas.ts:282`) o la de muestrario (`muestrarios.ts:129`/`:222`) vienen **sin fecha**, el acto se
    sella con el día del negocio **antes** de la guarda y con independencia de la llave ⇒ una ficha
    capturada a las 19:00 se fecha **hoy**, no mañana, **para todos**. El compromiso a futuro tiene su
    propio campo (`fechaRequerida` del muestrario, sin ventana): no hacía falta que la fecha del acto
    se adelantara.
    📌 **Los atajos de la pantalla (`frontend/.../indicadores/comun.ts`) cuentan con la zona del
    NAVEGADOR**, no con la del negocio. En un navegador puesto en México coinciden; en uno adelantado
    respecto de México, un atajo puede ofrecer una fecha que el servidor rebota.
  - `migracion.ts` (F7-E6) — `crearInventarioCiclicoMigrado`: modo migración del cíclico histórico
    (ver abajo).
- **Migración** `backend/migracion/loaders/indicadores-*.ts` + `etl-indicadores.ts`.

## Modelo de datos (`backend/prisma/schema.prisma`)

- **`PersonalArea`** (catálogo global): persona del área; `horasBase` solo aplica a IP.
- **`ActividadProductividad`** (catálogo global): una actividad por área; IP usa `porcentajeD`,
  almacén usa `pzPersDia`+`porcenPzas` (A6: campos configurables, no columnas por módulo).
- **`RegistroProductividad`**: registro diario (área, actividad, `cantidad`, `horasTrabajadas`,
  cuadrilla `personas`, opcional `idPersona` en IP / `idCliente` en almacén). Cancelación suave. A9.
- **`ChecklistFichaDef`** (catálogo global): reactivo del checklist; el seed siembra los **8 fijos**
  del viejo (`InfGeneral`..`MedidasPrendas`) — se pueden agregar más sin migración (A6).
- **`FichaVerificacion`**: una fila **reactivo × orden** (`hecho`, `revisorId`, `fecha`).
- **`Muestrario`**: solicitud → entrega, con `boardsOK`/`muestrasOK`, `fechaEntregado` y cancelación
  suave; `idCliente`/`idTemporada` a los catálogos.
- **`InventarioCiclico`**: encabezado (folio A3, almacén, estado) + **`dimension`** (`PT`/`TELA`/
  `AVIO`, fila 0.099) — se DERIVA del tipo del almacén al dar de alta y se **persiste** aquí para que
  el resto del ciclo no tenga que volver a preguntar. La migración la agregó con `DEFAULT 'PT'`, así
  que las hojas que ya existían se quedaron donde estaban (**sin backfill**, REGLA 0-B).
- **Un detalle POR DIMENSIÓN**, espejo del kardex — no columnas anulables de las tres en una misma
  tabla:
  - **`InventarioCiclicoDet`** (PT): granularidad REAL del kardex de PT
    (**modelo×color×talla×orden×almacén**, ADR-0014), cantidades **enteras**, `idMovimientoAjuste`.
  - **`InventarioCiclicoDetTela`**: un renglón por **tela×color** (la dimensión de
    `existencia_tela_color`), `Decimal(14,4)`, con **dos** pares teórico/real —cuerpo y complemento
    (D5)— y **dos** ligas de ajuste, porque un mismo renglón puede necesitar a la vez una entrada
    (lo que faltó) y una salida (lo que sobró).
  - **`InventarioCiclicoDetAvio`**: un renglón por **avío** (el lote NO entra, R4), `Decimal(14,4)`.

  En los tres: `cantTeorica` congelada, `cantReal` (lo contado) y la traza del movimiento de ajuste
  (D3).
- **`KpiRefresco`**: sello de la última materialización de las vistas de KPIs.

## Inventario cíclico contra el kardex propio (D6 / D3 / D4)

El **alta CONGELA** `cantTeorica` = Σ de movimientos del artículo **en ese instante** (bajo lock por
artículo, suma directa NUNCA la vista); se **captura LO CONTADO**, nunca una diferencia; el **ajuste**
aplica el delta como **movimiento de kardex** (entrada/salida), jamás editando un saldo (D3). Las
salidas validan no-negativo bajo lock por artículo. Máquina de estados
`abierto → contado → cerrado` (o `cancelado`).

### Las TRES dimensiones, y quién elige (fila 0.099)

**La dimensión la manda el TIPO DEL ALMACÉN**, no un campo que teclee nadie: desde la fila 0.137 un
almacén guarda una sola clase de mercancía, así que un conteo suyo sólo puede ser de ésa. Al dar de
alta se lee el tipo del almacén, se deriva la dimensión (`PT`/`TELA`/`AVIO`) y se **persiste** en el
encabezado; de ahí en adelante manda ella. `exigirAlmacenDelTipo` es la **única** puerta que lo
verifica, y se pasa por ella **TRES veces** —al abrir, al agregar un renglón a mano y al cerrar—,
porque una hoja vive días y en ese rato el almacén pudo desactivarse o cambiar de tipo (el catálogo
lo permite mientras no tenga movimientos). **No hay una segunda barrera más abajo**: el motor de
kardex no mira el almacén, así que quitar cualquiera de las tres deja el hueco entero.

Diferencias por dimensión:

| | Producto terminado | Telas | Avíos |
|---|---|---|---|
| Llave | modelo×color×talla×orden | tela×color | avío |
| Escala | entero (piezas) | `Decimal(14,4)` | `Decimal(14,4)` |
| Segundo componente (D5) | — | sí, si la hoja lo **congeló** | — |
| Conteo | **CIEGO** (D6) | con el **saldo a la vista** | con el **saldo a la vista** |
| Permiso EXTRA del ajuste | — | `inventario-telas.mover` | `inventario-avios.mover` |

El conteo con el saldo a la vista en telas y avíos es decisión de Daniel (§Post-F9.193 punto 4); el
ciego de PT se queda como estaba (D6). La hoja impresa hace lo mismo que la pantalla: la columna
«Sistema» sale **sólo** cuando el conteo no es ciego. Y el permiso extra existe porque el ajuste
escribe en el kardex de SU dimensión: abrir el cíclico a telas sin eso le habría dado a cualquiera
con permiso de cíclicos la llave para mover el inventario de telas, que antes no tenía.

⚠️ **La forma de una hoja ABIERTA la fija lo CONGELADO, no el catálogo de hoy.** Quién lleva segundo
componente sale de `cantTeoricaComplemento`, no del `nombreComplemento` que la tela tenga en este
momento: el ajuste sólo puede mover el componente cuyo teórico congeló. Por eso la existencia actual
también se re-lee con la forma congelada al cerrar.

### El AVISO de «el almacén se movió» (§Post-F9.193 punto 6)

La diferencia se calcula contra el teórico **congelado** —el conteo físico es contemporáneo de ese
valor—, pero si el almacén se movió entre el alta y el cierre, el sistema **avisa y deja decidir, NO
bloquea**. Antes de la fila 0.099 nadie avisaba **en ninguna dimensión, PT incluida**: con 100
congelado, 95 contado y 20 piezas que entraron de verdad en medio, se escribía −5 y quedaban 115
mientras el anaquel decía 95, sin una palabra.

Ahora el primer `POST /api/indicadores/ciclicos/:id/ajuste` vuelve con `aplicado: false` y el aviso —artículo por artículo, con
lo congelado, lo que hay AHORA, lo contado, el ajuste y **en cuánto va a quedar la existencia**— y
**sin escribir nada**. El segundo, con `confirmarMovimiento: true`, aplica. El aviso es un **dato de
la respuesta (200), nunca una excepción**.

### Renglones agregados a mano

Se puede anotar **mercancía con existencia CERO** (`agregarRenglonCiclico`): el alta enumera sólo lo
que tiene existencia, así que lo que el sistema cree que no tiene entra a mano. Por eso el alta
**ya no rechaza una hoja vacía** — contar un almacén que el sistema cree vacío es el caso de uso del
arranque, no un error. El teórico del renglón nuevo se congela igual que el del alta (bajo lock, Σ
directa): normalmente es 0, y si el artículo se movió de verdad nace con lo que hay.

### El ajuste no se deshace desde Inventarios

Un movimiento con `origenTipo = ajuste-ciclico` **no se cancela por la vía normal**: la hoja quedaría
`cerrado` contando otra historia que el kardex. La regla vive **una sola vez** en
`dominio/inventarios/cancelacion-comun.ts` y la aplican las tres puertas de material (telas por lote,
telas por color y avíos); PT ya lo cerraba por otro camino (sólo cancela a mano lo que se capturó a
mano). Si el conteo estuvo mal, se corrige con un **movimiento manual nuevo** — compatible con D3.

### Almacén de telas en el seed

El seed siembra un almacén global **«Almacén de telas»** (tipo `TELA`), idempotente, hermano del
«Almacén de avíos» de la fila 0.137. Sin él, una base sembrada **sin correr el ETL** no tenía ni un
almacén de tipo TELA —sólo el ETL los creaba— y la pantalla del arranque de telas se quedaba sin
almacén que ofrecer.

## Migración del histórico (F7-E6)

`etl-indicadores.ts` orquesta, en ORDEN, VÍA los servicios de dominio (A1), idempotente y por lotes:

1. **Catálogos** (globales): `IP_Personal` → `PersonalArea` (ip), `IP_Actividades` →
   `ActividadProductividad` (ip), `Alm_Prd_Act` → `ActividadProductividad` (almacen).
2. **Productividad IP**: `IP_Productiv` → `RegistroProductividad` (1 por fila).
3. **Productividad Almacén**: `Alm_Prd` × `Alm_Prd_Det` → `RegistroProductividad` (1 por DETALLE,
   aplanando el encabezado-día: fecha/cuadrilla/horas).
4. **Baja suave** de las personas de IP que el viejo tenía inactivas — se aplica **DESPUÉS** de su
   productividad (`registrarProductividad` rechaza a una persona desactivada; las personas 4/5 del
   viejo son inactivas PERO tienen registros).
5. **Fichas**: `IP_InfConf` → `FichaVerificacion`, **despivotando** las 8 columnas booleanas contra
   los 8 `ChecklistFichaDef`. El **revisor viejo** (`IdUsuarios`) se **PRESERVA** como `revisorId`
   (texto sin FK, ADR-0005; F10 remapea) corriendo con una sesión con ese id (patrón D11). `Observ`
   (texto libre) NO se migra (no hay campo en el modelo; se LISTA).
6. **Muestrarios**: `IP_MuesPend` → `Muestrario` con su ciclo de vida (entrega/cancelación). El
   `Cliente` es TEXTO → se resuelve por **nombre** contra el catálogo; sin match (p. ej. "Walmart",
   "Soriana") → OMITIDO y LISTADO (no se inventa un cliente). El solicitante viejo se preserva.
7. **Inventario cíclico histórico Proscai (D6)**: `Alm_InvCic` → `InventarioCiclico` vía
   `crearInventarioCiclicoMigrado` — es de **origen EXTERNO** (Proscai), "solo consultable, NO
   comparable contra el kardex v2". Se carga como registros **CERRADOS** con `cantTeorica =
   CantProscai` (NO la suma del kardex de v2) y **SIN ajuste de kardex** (`idMovimientoAjuste` NULL:
   no reconcilia contra v2). Como el viejo solo tenía **modelo + fecha**, se usan **SENTINELAS**:
   Color/Talla `(sin especificar)` inactivos (los mismos de F3-E6/IPT) + almacén `(Migración
   Proscai)` inactivo (tipo PT); `idOrden` NULL. El `ModeloIC` (texto) se resuelve por **código**;
   sin match → LISTADO. Aquí `cerrado` significa "histórico terminado e inmutable" (no "ajuste
   aplicado"): las transiciones normales rechazan un cerrado, así que el histórico queda a salvo, y la
   vista de exactitud lo muestra (consultable, D6).

Se corre con `npx tsx --env-file=.env migracion/etl-indicadores.ts` (ver `migracion/README.md`). El
cuadre (`cuadre-f7.ts`) reporta los conteos v1/v2 por entidad; los `v2 ≤ v1` son ESPERADOS (mapeos
faltantes / datos inválidos) y se explican por renglón.

## Decisiones aplicadas

- **D6** — inventario cíclico contra el **kardex propio** (teórico congelado, conteo ciego **en PT**,
  ajuste por movimiento); el **histórico Proscai** es externo, no comparable, sin ajuste.
- **§Post-F9.193 puntos 4·5·6** (fila 0.099) — se captura **lo contado** con el saldo del sistema a la
  vista (telas y avíos); el cíclico se extiende a **telas y avíos**; si el almacén se movió entre el
  alta y el cierre, **avisar y dejar decidir, no bloquear**; y se puede anotar mercancía con
  existencia **cero**.
- **D11** — KPIs directivos; captura preservada (`revisorId`/`capturadoPor` del histórico).
- **D4/A6** — motor de productividad **configurable por área** (filas, no tablas paralelas).
- **ADR-0007** (catálogos globales), **ADR-0014** (PT por orden), **A1/A2/A3/A7/A9**.
