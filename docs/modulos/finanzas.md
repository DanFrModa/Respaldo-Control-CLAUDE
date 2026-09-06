# Módulo — Finanzas (CxC / CxP + CFDI) (F9)

> Cómo quedó construido el módulo de **Finanzas** (cuentas por cobrar/pagar + importación de CFDI) en
> CONTROL v2. No duplica el funcional (ADR-0002): para el QUÉ del negocio, ver
> `Documentacion_MJD/PROPUESTA-Finanzas-y-Proveedores.md`, `DECISIONES.md` §D12/D15 y
> `REQUISITOS-NUEVOS.md` §R10–R14. Aquí va el CÓMO de v2.

Construido en F9 (etapas E1 → E6). Generaliza el motor **EsMa** de F6
([`esma.md`](esma.md)) sin migrar sus datos (convivencia de lectura). El decisor técnico central es
**ADR-0017** (motor de terceros: referencias por tipo, no tabla polimórfica).

## Alcance

Un **único motor de cuenta corriente de terceros** del que cuelgan **CxP** (proveedores, formales e
informales), **CxC** (clientes) y —por convivencia— **EsMa** (maquileros). **Importación** de CFDI ya
timbrados en los dos sentidos (proveedores → CxP; ventas propias → CxC), conciliados con su operación
real y guardados en R2. **Reportes fiscales** para el contador (la vista fiscal del libro) con exports
Excel/PDF y aging configurable. **Meta:** apagar SINUBE por etapas — lo operativo primero, el timbrado
nativo vía PAC (R14) es posterior. **CONTROL no lleva contabilidad** (pólizas/DIOT/declaraciones): eso
sigue con el contador; CONTROL le entrega información fiscal limpia.

## Principio de oro (D3, A1)

`saldo(tercero) = Σ monto` — **nunca** una columna editable. Cada hecho (factura, pago, abono, nota de
crédito, apertura) es un **movimiento**; el saldo se deriva sumando. La cancelación es un **inverso
auditado** (patrón kardex), jamás una edición/borrado. Toda la lógica vive en `backend/src/dominio`.

## Un motor, dos ejes, dos vistas

- **Eje 1 — `origen`** (enum `OrigenMovimientoTercero`): fija la **dirección contable** vía
  `signoDeOrigen` (`src/dominio/terceros/origen-tercero.ts`, el ÚNICO lugar de verdad del signo).
  - **CARGO (+)**: `recibo_maquila`, `factura_proveedor`, `entrada_sin_factura`, `factura_cliente`.
  - **ABONO (−)**: `nota_credito`, `pago`, `abono`, `descuento`.
  - El API recibe `importe` **positivo**; el servidor le pone el signo por el origen.
- **Eje 2 — `esFiscal`** (+ `uuidCfdi` / `rfcTercero` / `idArchivoCfdi`): naturaleza fiscal del
  movimiento (con CFDI o no).
- **Dos vistas = dos filtros del MISMO libro** (no dos libros): **operativa** (todo) y **fiscal**
  (`esFiscal = true`, exige `terceros.fiscal`).

## Capas (A1 — lógica solo en dominio)

- **Dominio** `backend/src/dominio/terceros/`:
  - `origen-tercero.ts` — clasificación de orígenes y `signoDeOrigen` (fuente única del signo).
  - `terceros.ts` — resuelve el tercero por **tipo + id** (D15a: dos FKs reales nullable con CHECK de
    exclusividad, **sin** tabla `Tercero` polimórfica — ADR-0017); nombre + días de crédito (aging).
  - `cuenta-terceros.ts` — el **MOTOR** (`registrarMovimientoTercero` / `cancelarMovimientoTercero` /
    `calcularSaldoTercero` / `estadoDeCuentaTercero`): folio por **secuencia atómica por empresa**
    (A3, clave `movimiento-tercero`), signo por origen, **vencimiento derivado** del aging
    (`calcularVencimiento` = fecha + días de crédito, solo los cargos vencen), transacción + bitácora
    (A2/A7), cancelación = inverso auditado con **advisory lock + unique parcial** de
    `idMovimientoInverso` (anti write-skew de doble cancelación).
  - `convivencia-esma.ts` — para un PROVEEDOR, el saldo/estado de cuenta **INCLUYEN** los movimientos
    EsMa (F6) **reusando la fórmula `calcularSaldoMaquilero`** → no-regresión garantizada por
    reutilización; NO se migró ni un dato EsMa (opción **(b)**, compatibilidad de lectura).
  - `cxp/` y `cxc/` — usos de negocio del motor por **composición** (cero duplicación): registrar
    pagos/abonos/descuentos/NC, estado de cuenta operativo/fiscal, **aging server-side**
    (`aging-comun.ts`: cubetas + neteo FIFO). La bandeja "por pagar" **foldea** el saldo EsMa (misma
    cuenta del maquilero, en cubeta "Maquila sin antigüedad"); el `%` al corriente es honesto (`null`
    si no hay cartera clasificable). El fold trae DOS cosas por maquilero (`aportesEsMaSaldoLote`, un
    solo agregado, nunca N+1): el **saldo** —al que sólo entra lo REVISADO en los cuatro conceptos,
    V1 fila 0.115— y `maquilaPorRevisar`, lo capturado que aún espera revisión.
    - ⭐ **El corte de la bandeja es `saldo ≠ 0` **o** algo por revisar** (§Post-F9.188a, Daniel): un
      maquilero con TODO sin revisar tiene saldo 0 y, con el corte anterior, DESAPARECÍA justo cuando
      alguien tiene que decidir sobre ese dinero. Es el mismo corte del tablero de EsMa, con las
      mismas funciones (`tieneSaldo` / `hayPendiente` de `esma/formula-saldo.ts`), y se mide por el
      CONTEO de partidas, no por el neto (dos partidas pueden netear cero).
    - Lo por revisar **no es deuda todavía**: no suma a `carteraTotal`, a `maquilaTotal` ni a
      `proveedoresConSaldo` (los KPIs siguen contando sólo saldo ≠ 0), pero se declara aparte en el
      resumen y en la columna «Por revisar» de la tabla, con su importe y su conteo. Los importes se
      ocultan sin `consultas.ver-importes`; el conteo nunca.
  - `cfdi/` — `parser-cfdi.ts` (CFDI **4.0** puro, endurecido contra XML no confiable: sin DTD, sin
    expansión de entidades, tope 2 MB), `cfdi-proveedor.ts` (I → `factura_proveedor` +, E →
    `nota_credito` −) y `cfdi-ventas.ts` (reusa el parser con roles invertidos: emisor = empresa,
    receptor = cliente). El XML se sube **server-side** a R2 (orden seguro **R2 primero → tx
    después**: un cargo fiscal sin su XML sería irrecuperable por la unique del UUID). Anti-duplicado
    por **UUID único global** (pre-check + backstop P2002). `cfdi-comun.ts` comparte el RFC de la
    empresa activa (`Empresa.rfc`) y el chequeo de UUID.
  - `reportes/` — `ServicioReportesFiscales`: la vista `esFiscal=true` del libro (CxP+CxC) por
    periodo/empresa, con conciliación (con/sin CFDI, con/sin XML), tablero de salud fiscal y totales
    del periodo completo. Exports **Excel** (exceljs) y **PDF** (@react-pdf, con leyenda de truncado).
  - `config-aging.ts` — límites del aging **configurables por empresa**
    (`ConfiguracionEmpresa.agingLimite1/2`, default 30/60 — cierra D15d).
  - `migracion.ts` — **modo migración** (F9-E6): `insertarAperturasMigradas` inserta los saldos
    iniciales por **LOTES** (ver §ETL abajo).
- **Rutas** `backend/src/api/terceros/` — delegan al dominio; RBAC deny-by-default.
- **Frontend** — pantallas del riel FINANZAS: `/cxp`, `/cxc` (bandejas + estado de cuenta
  operativa/fiscal + captura + impreso PDF), `/cxp/importar-cfdi`, `/cxc/importar-cfdi`,
  `/reportes-fiscales`.

## RBAC (A4)

`terceros.ver` / `.administrar` / `.fiscal` (motor); `cxp.ver` / `.administrar` y `cxc.ver` /
`.administrar` (usos). Reparto conservador: administrar/fiscal solo Administrador/AdministraciónDirección;
`ver` baja hasta Gerencial (se corta en Ventas). Cada etapa que agrega permisos requiere
`SEED_ON_START=true` en el deploy a `prueba`.

## ETL de cierre (F9-E6) — arranque de SINUBE

A diferencia del resto de fases, **estos datos NO viven en Access**: viven en SINUBE / CFDI. Por eso el
ETL es de **saldos iniciales** + **importación masiva de CFDI**, no del `.mdb` viejo.

- **`migracion/etl-terceros-saldos.ts`** — carga el **punto de partida** de CxC/CxP como movimientos de
  **APERTURA** (D3: jamás un saldo editable). Fuente: un CSV de **formato flexible** (corte de SINUBE /
  export del contador). Daniel pidió el **detalle** de las facturas pendientes (cada una con su fecha →
  el aging cuenta desde el día 1); también acepta un **saldo neto** por tercero. Mecánica:
  - **Modo migración por LOTES** (`src/dominio/terceros/migracion.ts::insertarAperturasMigradas`,
    regla dura de Gabriel — nunca 1×1): por bloque de un tercero se **reserva un bloque de folios en
    una sentencia atómica** (`reservarBloqueFolios`, A3) y se insertan los movimientos con
    `createManyAndReturn` (un solo INSERT). El **signo** (`signoDeOrigen`) y el **vencimiento**
    (`calcularVencimiento`) se **reusan del motor** (A1: un solo lugar de verdad — el ETL no los
    recalcula).
  - **Idempotencia atómica**: cada movimiento + su renglón de `MapeoMigracion` (`AperturaTercero`,
    clave natural = folio de origen · UUID · `neto:<tipo>:<id>`) se crean en la MISMA transacción; una
    re-corrida NO duplica (el loader filtra por `MapeoMigracion` y por la unique global del `uuidCfdi`
    antes de insertar). Demostrado por test (2ª corrida = 0 nuevos).
  - Con `uuid` → cargo **fiscal** (`factura_proveedor`/`factura_cliente`); sin `uuid` → cargo **no
    fiscal** (`entrada_sin_factura`, requiere folio); saldo neto ± → `entrada_sin_factura`/`abono`.
- **`migracion/etl-cfdi-masivo.ts`** — recorre una **carpeta de XML**, decide **compra/venta** por el
  RFC de la empresa (`decidirDireccionCfdi`) y resuelve el tercero por RFC, luego **REUSA** los
  importadores interactivos de E3/E4 (`importarCfdi` / `importarCfdiVenta`) tal cual — la única lógica
  nueva es decidir la dirección y auto-resolver el tercero (en la UI lo elige un humano). **Idempotente
  por UUID** (el comprobante repetido cuenta como "duplicado", no error). Respeta `R2_SUBIDA_LOCAL`.
- **`migracion/cuadre-f9.ts`** — compara, por tercero, el **saldo esperado del corte** (columna
  `saldoEsperado`, o Σ de las aperturas del CSV con su signo) contra el **Σ monto de las aperturas
  cargadas** (los movimientos en `MapeoMigracion.AperturaTercero`). Los descuadres se **LISTAN**, nunca
  se fuerzan (§7).

Formato de entrada, ejemplos y cómo correr: `backend/migracion/README.md` (sección F9). **Se corre con
`npx tsx --env-file=.env migracion/etl-terceros-saldos.ts -- --archivo=...`** (NUNCA `npm run`).

## ⭐⭐ CORREGIR un movimiento SIN FACTURA (fila 0.145, §Post-F9.203)

**Qué resuelve.** Hasta la 0.145, un **abono o un pago a un maquilero capturado por error NO se podía
anular NUNCA**: de los cuatro conceptos de EsMa sólo el descuento tenía cancelación (fila 0.109, y sólo
para el *deshacer* de un cierre). En CxP, en cambio, se cancela todo desde F9-E1. Daniel pidió cerrar
esa asimetría con estas palabras: *«Quiero tener manera de modificar cualquier registro que se meta en
cualquier estado de cuenta de los proveedores **sin factura**. **Sólo yo. Nadie más ni con permiso.
Sólo yo.**»* — y sobre la forma, *«Sí, está bien **con rastro**.»*

### Cómo funciona

En pantalla es **un solo gesto que se comporta como editar**: se abre el renglón con sus valores, se
cambia lo que haga falta, se pone el **motivo** (obligatorio) y se guarda. Por dentro, **en UNA
transacción**:

1. el movimiento viejo queda **cancelado** —en el motor, con su **inverso auditado**; en EsMa, con
   cancelación **suave** (`canceladoEn` + autor + motivo)—;
2. nace uno **nuevo** con los valores corregidos, **ligado** al que sustituye
   (`MovimientoTercero.idMovimientoCorregido`, `AbonoMaquilero.idAbonoCorregido`,
   `DescuentoMaquilero.idDescuentoCorregido`, `PagoMaquilero.idPagoCorregido` — todos `@unique`);
3. la **bitácora** guarda quién, cuándo, el motivo y **qué decía antes** (A7).

⇒ **D3 intacto**: nada se edita ni se borra; el saldo sigue siendo Σ de movimientos y el pasado se
sigue pudiendo reconstruir. Una corrección se puede volver a corregir (se **encadenan**); el corregido,
ya cancelado, no.

**Dónde vive el código**

| Pieza | Archivo |
|---|---|
| Lo común y puro (¿es sin factura? ¿qué queda? ¿cambió algo?) | `dominio/finanzas/correccion-comun.ts` |
| El motor de terceros (CxP/CxC) — compone cancelar + registrar | `dominio/terceros/cuenta-terceros.ts::corregirMovimientoTercero` |
| CxP (verifica que sea de un proveedor y delega) | `dominio/terceros/cxp/cxp.ts::corregirMovimientoCxp` |
| EsMa (abono/descuento/pago) | `dominio/esma/correccion.ts::corregirMovimientoEsMa` |
| La mecánica del pago aplicado | `dominio/esma/pagos.ts` (`cancelarPagoMaquileroInterno`, `recapturarPagoCorregido`, `prendasPagadasVivas`) |
| La bandera de la persona | `comun/permisos.ts::verificarCorrectorSinFactura` |
| Endpoints | `POST /api/terceros/movimientos/{id}/corregir` · `POST /api/cxp/movimientos/{id}/corregir` · `POST /api/esma/movimientos/{concepto}/{id}/corregir` |
| *(Alcance de la ruta del motor)* | Como `cancelar`, la ruta del motor es **genérica**: acepta un movimiento de cliente (CxC) igual que uno de proveedor. La corrección se pidió **para proveedores**, así que sólo la OFRECEN las pantallas de CxP y de maquila; CxC no pinta el botón |
| Pantallas | el cajón compartido `components/dominio/CajonCorregirSinFactura.tsx`, montado en el estado de cuenta de **CxP** y en el de **maquila** |

### Quién puede: una BANDERA, no un permiso

`Usuario.puedeCorregirSinFactura` — mismo patrón que `Usuario.esAuditor`, pero **no se asigna desde
ninguna pantalla ni desde ningún endpoint**: se prende **sólo por base de datos**.

```sql
UPDATE usuarios SET puede_corregir_sin_factura = TRUE WHERE username = '…';
```

- **No es** `roles.administrar` ni ningún permiso de admin (ése es el defecto de la fila 0.120).
- **No es** un `cxp.corregir` asignable: Daniel dijo *«ni con permiso»*.
- La exige el **DOMINIO** (A1), no la ruta.
- **No exime del permiso del módulo**: sigue haciendo falta `terceros.administrar`/`cxp.administrar`
  (motor) o `esma.modificar`/`esma.ver-pagos` (EsMa), y `esma.revisar` si el movimiento estaba
  `revisado` —porque el corregido **hereda** ese estado, y nacer `revisado` es un acto de validación
  (fila 0.128)—.

**La pantalla no adivina nada:** cada renglón del estado de cuenta llega con `corregible` y
`importeCorregible` ya calculados por el servidor, así que nunca se ofrece un botón que después se
rechaza. Por eso la bandera **no** viaja en `GET /api/sesion`.

### 🔴 QUÉ **NO** SE PUEDE CORREGIR (y por qué)

| No se corrige | Por qué |
|---|---|
| **Un renglón CON factura** (`esFiscal = true` en el motor, `conFactura = true` en EsMa), **aunque sea del mismo proveedor** | Un CFDI se cancela ante el SAT y se vuelve a timbrar; no se edita por dentro. El segmento es del **MOVIMIENTO**, no del tercero: un proveedor `ambos` tiene de los dos |
| **El PROVEEDOR o el TIPO de movimiento** | No son campos del cuerpo (`strictObject` ⇒ **400** explícito) y el servidor los toma del corregido. Cambiar de proveedor o de concepto no es *corregir* un renglón: es **otro renglón** — para eso está cancelar y capturar de nuevo |
| **El IMPORTE de un PAGO ya aplicado a cargos** | Su monto no es un dato suelto: es `Σ(prendas × precio del cargo)`, y el modelo promete `monto = Σ aplicaciones.importe`. Se corrigen su **fecha** y sus **observaciones**; para cambiar el dinero hay que cambiar las prendas, y eso es capturar el pago de nuevo. El cajón lo dice con todas sus letras |
| **El DESCUENTO que propuso el CIERRE de una orden** | Su liga al cierre es `@unique` e intransferible: el sustituto no podría heredarla y el *deshacer* del cierre quedaría buscando un descuento que ya nadie usa. **Se deshace el cierre** |
| **Un CARGO de EsMa** | No es un movimiento que alguien «meta» en el estado de cuenta: nace de un **recibo de maquila** y ya tiene su propio camino (validarlo fija cantidad y precio reales; cancelarlo lo saca) |
| **Un movimiento ya cancelado, o el inverso de una cancelación** | No hay nada que corregir: se corrige el renglón bueno |
| *(Al revés — lo que SÍ se permite a propósito)* **corregir el movimiento de un maquilero DESACTIVADO** | Capturar uno nuevo sí exige que esté activo; corregir, no. **Corregir no es hacer negocio nuevo: es arreglar lo que ya pasó.** Obligar a reactivar un taller para poder tocar su contabilidad sería mover el catálogo por la contabilidad |
| **Una corrección que no cambia nada** | Quemaría dos folios y metería dos renglones vacíos de contenido en el estado de cuenta |

📌 El `conFactura` **sin definir (`null`)** de lo migrado cuenta como **sin factura** —es lo que ya hace
la partición `whereSegmentoFactura('sin')`—, así que lo viejo también se corrige (REGLA 0-B: el dato
viejo se tolera, no se repara).

### ⭐⭐ El caso difícil: el pago aplicado a cargos

Un pago de EsMa **consume «prendas por pagar»** de cargos concretos, y de ahí se deriva `Orden.pagada`.
Cancelarlo cambiando sólo su renglón dejaría los cargos **marcados como pagados con dinero que ya no
existe**. Por eso:

- las prendas por pagar se cuentan por la **suma VIVA** de `PagoAplicacion`
  (`pago.canceladoEn IS NULL`) — la columna `EsMaCargo.cantidadPagada` sigue siendo un **cache**, no la
  verdad;
- corregir un pago aplicado **deshace su aplicación y la vuelve a hacer**, bajo el
  `pg_advisory_xact_lock` **por maquilero**, recalculando `cantidadPagada` y `Orden.pagada`;
- las filas de `PagoAplicacion` del pago cancelado **NO se borran** (D3): son el rastro. Lo que cambia
  es que la suma que manda las excluye.

### El pago que nació de la corrida semanal: la relación NO se repunta (deliberado)

Un pago de la **corrida semanal** (fila 0.113) se puede corregir como cualquier otro. Cuando se
corrige, el `RenglonCorridaPago` **sigue apuntando al pago viejo** y no al nuevo.

🔴 **Es deliberado, no un cabo suelto — no lo "arregles".** El renglón de la corrida es el registro
histórico de **lo que esa corrida emitió ese día**; la corrección es un **hecho posterior**, y queda
ligada por `idPagoCorregido`. Repuntar el renglón sería **reescribir el pasado**, que es exactamente
lo que esta fila existe para evitar. Además, el monto que la relación reporta vive en su **propia
columna** (`RenglonCorridaPago.monto`), así que no hay doble conteo con el libro. La FK del renglón es
`@unique`, de modo que tampoco *podría* apuntar a los dos.

⭐ **Y vale IGUAL para el otro lado de la corrida.** Un renglón de corrida de un **proveedor** (no
maquilero) apunta a un movimiento del motor por `RenglonCorridaPago.idMovimientoTercero`, que lleva el
**mismo `@@unique`**: al corregir ese movimiento, el renglón sigue apuntando al viejo, por la misma
razón y con la misma conclusión. Se dice aquí para que nadie lea la nota de arriba como si fuera sólo
de maquila.

### El RECIBO en PDF de un pago anulado va SELLADO

`GET /api/esma/pagos/{id}` y su impreso **siguen devolviendo** un pago anulado —esconderlo rompería el
rastro y dejaría un id que «desaparece»—, pero la proyección trae `canceladoEn`/`motivoCancelacion` y
el PDF estampa arriba del importe: **«RECIBO ANULADO — NO ES COMPROBANTE DE PAGO»**, con la fecha y el
motivo. 🔑 Este papel es el que se le entrega al maquilero: antes de la 0.145 un pago no se podía
anular, así que el impreso no tenía nada que decir; **un comprobante anulado que no lo dice se puede
cobrar dos veces**. El texto del sello vive en `textoSelloAnulado` (función pura, probada suelta) para
que se pueda afirmar sin abrir un binario.

### El `importeGuardado`: por qué el `monto` no servía para corregir

Cada renglón del estado de cuenta trae **dos** números y no son el mismo:

| Campo | Qué es | Cuándo va `null` |
|---|---|---|
| `monto` | La **aportación al saldo**: lleva signo (un pago resta) y **se vacía si el renglón todavía no está revisado** (no aporta) | sin revisar · sin `consultas.ver-importes` |
| `importeGuardado` | El **importe capturado**, normalizado a POSITIVO por `importeGuardadoDe` | en un renglón **corregible**, **sólo** sin `consultas.ver-importes` (el CARGO va `null` siempre: su importe se deriva, y nunca es corregible) |

🔴 El cajón de corrección arranca de `importeGuardado`, y la razón es un defecto real: un movimiento
«capturado por error» es, por definición, uno **que aún no se revisó** —el caso central de la fila—, y
arrancando de `monto` el importe quedaba intocable justo ahí… explicado además con un mensaje sobre
permisos que era **falso**. Regla que queda: **en un renglón corregible, el `null` de
`importeGuardado` significa una sola cosa**, y por eso el mensaje de permisos sólo puede salir cuando
de verdad faltan.

⚠️ **Y el POSITIVO no es cosmético.** El ETL de EsMa carga los *«saldo anterior»* del sistema viejo
**en negativo** (`dominio/esma/migracion.ts`: *«los servicios normales rechazarían montos negativos,
que el viejo SÍ tiene»*), y llegan con `conFactura = null`, que cuenta como **sin factura** ⇒ son
corregibles. Si el importe llegara en negativo, el cajón cortaría al guardar con «captura un importe
mayor a 0» **aunque sólo se hubiera cambiado la fecha**: el botón no serviría justo sobre los
renglones viejos que más se van a querer tocar. Por eso la normalización vive en **un solo helper**
compartido por el motor y las seis ramas de EsMa — cuando estaba escrita a mano en cada sitio, el
motor la cumplía y EsMa no.

🔴 **Y el gemelo del negativo, que `Math.abs` no cura: el importe 0.** El mismo ETL carga un monto
vacío como **cero** —`migracion/loaders/esma-cargos.ts:545`, `parsearDinero(...) ?? 0`, la mecánica
compartida por abonos, pagos y descuentos—, y esos movimientos también llegan con `conFactura = null`
⇒ **corregibles**. El cajón validaba
el importe en **todos** los envíos, así que sobre ellos guardar cortaba con *«Captura un importe mayor
a 0»* aunque sólo se hubiera cambiado la fecha — y el `<input min="0.01">` los dejaba `:invalid`, de
modo que el navegador ni llegaba a enviar el formulario. **La regla que queda:** ese mensaje habla del
importe **NUEVO**, así que sólo sale cuando el usuario propone uno (el campo se compara contra el texto
con el que nació), y el `min` del campo es **`0`** — el suelo de lo que el dato puede valer, no el de
lo que se puede teclear. Que un importe nuevo sea mayor que 0 lo exigen `enviar` y el servidor.

### Efecto de fondo: los tres movimientos planos vuelven a ser el mismo criterio

La condición de **estar vivo** (`canceladoEn IS NULL`) sube de ser sólo del descuento a serlo de los
tres movimientos planos en la definición única (`dominio/esma/formula-saldo.ts`). Como esa definición
alimenta a la vez a Prisma y al SQL crudo, viaja sola a **las cinco sumas del saldo** y a las listas: un
movimiento cancelado **ni suma al saldo ni sigue apareciendo como «esperando tu decisión»**.

## Decisiones (DECISIONES.md §D15)

- **D15a** — el movimiento referencia al tercero por **tipo + id** (dos FKs nullable + CHECK de
  exclusividad), sin tabla `Tercero` polimórfica (ADR-0017).
- **D15b** — EsMa se re-expresa por **convivencia de lectura**, NO por migración de datos.
- **D15c** — el ETL de saldos/CFDI **se construye y prueba pero NO se corre** hasta que Daniel entregue
  el corte de SINUBE; el corte trae el **desglose** de las facturas pendientes (fecha + folio/UUID +
  monto) para que el aging funcione desde el día 1.
- **D15d** — aging **configurable por empresa** (`agingLimite1/2`, default 30/60).

## Pendientes honestos

- **Correr el ETL** (`etl-terceros-saldos` + `etl-cfdi-masivo`) cuando Daniel entregue el corte de
  SINUBE / la carpeta de XML (D15c). Hoy solo están construidos y probados con fixtures.
- **Timbrado nativo vía PAC (R14)** — posterior; hoy es **importación**, no emisión. La estructura ya
  queda lista para que el salto sea chico.
- **Desglose base/IVA/retenciones** — el movimiento persiste el **TOTAL** del CFDI (la verdad fiscal);
  el desglose vive en el XML guardado en R2. Leerlo del XML para el reporte del contador es iteración
  posterior (documentado en el TSDoc de `reportes/`).
- **UsuarioRol / usuarios reales** — dependen de F10 (go-live); no afectan el motor.
- **Prender la bandera de corrección** (`usuarios.puede_corregir_sin_factura`) para Daniel en `prueba`
  y, más tarde, en producción. Es un **UPDATE a mano**: ninguna pantalla la reparte, ningún seed la
  siembra y ningún endpoint la escribe — que es justo lo que él pidió (§Post-F9.203).

> **Ver también:** `pagos-corrida.md` — la corrida semanal de pagos (0.113) y el catálogo de conceptos de pago (0.125), que es donde los saldos de CxP y EsMa se convierten en pagos.
