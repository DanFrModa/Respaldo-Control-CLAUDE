# Pagos · La corrida semanal y el catálogo de conceptos (filas 0.113 + 0.125)

> Cómo quedó el módulo al cerrarse (4-sep-2026). El **porqué** de cada regla vive en
> `Documentacion_MJD/DECISIONES.md` §Post-F9.185–189; el estado, en `HOJA-DE-RUTA.md`.
> Reemplaza el archivo semanal de Excel con el que finanzas armaba los pagos de la semana.

## 1. Qué es

Cada semana Daniel decide **a quién y cuánto se paga**. Antes lo hacía sobre un Excel (dos hojas: con y
sin factura) que finanzas rellenaba y él corregía. Ahora es **una pantalla**: el tablero de saldos con una
columna abierta —*«a pagar esta semana»*— por renglón. Lo que se paga **es lo que él teclea**; el saldo,
lo que está por revisar y los recibos de la semana se ven al lado sólo como referencia.

Hay **dos corridas por semana** —con factura y sin factura— y cada una se **guarda** con su ciclo:

| Estado | Qué significa | Qué se puede hacer |
|---|---|---|
| `borrador` | Se está armando | Editar montos, forma de pago, concepto, referencia; agregar y quitar renglones |
| `cerrada` | Es la relación de la semana | Ver la **relación ejecutable** (cuenta completa), imprimir, Excel/PDF; **nada se edita** (D3: una cerrada se corrige con otra) |
| `ejecutada` | Ya se pagó | Nada. Los pagos existen en EsMa/CxP |

Dos borradores del mismo segmento y semana **no pueden convivir** (lock `20_551`).

## 2. La relación es UNA, por rubros

Daniel: *«me encanta así todo junto»*. Una sola pantalla con secciones:

| Sección | De dónde sale | Columnas de referencia (nunca el número que se paga) |
|---|---|---|
| **Maquileros** | Proveedores con rol de maquila (`ROLES_MAQUILA_ESMA`) del segmento | Saldo EsMa · por revisar · recibos de la semana |
| **Proveedores** | El resto de la cartera CxP del segmento | Saldo · vencido (cubetas de la bandeja) |
| **Conceptos** | El catálogo de conceptos de pago (§4) | Ninguna: nacen en cero |

La pantalla muestra **toda la cartera del segmento** a propósito (enseñar de más nunca deja a nadie sin
cobrar; no existe «agregar proveedor»), ordenada con lo que pide decisión primero. El universo de
proveedores es **el mismo que la bandeja de CxP** (`carteraCombinadaPorProveedor`, extraída de
`bandejaPorPagar`): si divergieran, alguien podría quedarse sin cobrar.

⚠️ Hasta la **0.114**, `corte` y `empaque` no están en `ROLES_MAQUILA_ESMA`: un cortador cae en «Proveedores».

## 3. El renglón

`RenglonCorridaPago`: **uno por destino y por monto**. Un pago partido en dos cuentas son **dos
renglones**, nunca se colapsan (romperían las transferencias). Cada renglón lleva:

- **Destino**: proveedor **o** concepto (nunca ambos, nunca ninguno; CHECK en la base y `throw` en el dominio).
- **Rubro** (enum cerrado `RubroPago`) y **origen** (`maquila` / `proveedor` / `concepto`): **los deriva el
  dominio del destino**; el cliente no los manda. El origen decide en qué libro cae el dinero al ejecutar.
- **Monto** (> 0, tecleado), **forma de pago** (`efectivo` | `transferencia`; default = `formaPagoPreferida`
  del proveedor o del concepto, cambiable), **concepto libre** y **referencia** (folios) — las dos columnas
  que finanzas necesita para ejecutar.
- **El destino congelado**: además de la FK a la cuenta, copia beneficiario, banco, tipo, número, alias y
  `cuentaEsFiscal`. Editar la cuenta después **no cambia una corrida cerrada**. En la pantalla de trabajo el
  número viaja sólo como últimos 4; el completo, sólo en la relación ejecutable.

**Reglas de cierre** (`bloqueosDeCierre`, con nombre y renglón):
- transferencia ⇒ cuenta; efectivo ⇒ sin cuenta;
- **guarda fiscal**: en la corrida **con factura** el destino tiene que ser una cuenta `esFiscal`; sin cuenta
  fiscal, lo dice con nombre y no cierra. Por lectura literal, **bloquea también el efectivo** en ese
  segmento (default pendiente de Daniel, §Post-F9.189 (g-bis)).

## 4. El catálogo de conceptos de pago (0.125)

`ConceptoPago`: **aparte de proveedores** (Daniel: *«que sean un catálogo aparte»*). Nombre · rubro · forma
de pago default · marca **`predeterminado`** · cuentas (`ConceptoPagoCuenta`, misma forma que
`ProveedorCuentaPago`: beneficiario, banco, tipo, número, alias, `esFiscal`, una por omisión).

Los **predeterminados se cargan en cero en cada corrida nueva** (*«caja chica, nómina por fuera… no quiero
que se me vaya a olvidar»*); los demás se agregan desde el catálogo cuando hacen falta. «Nómina por fuera
<fecha>» es un concepto con la fecha en el texto del renglón. «Caja chica» hoy es un concepto con monto a
mano; el libro de caja con reposición calculada es la fila **0.127**.

## 5. Ejecutar: aquí nacen los pagos

`ejecutarCorrida` corre en **una transacción** bajo el lock de la corrida y es idempotente (estado + FK del
movimiento en cada renglón, UNIQUE en `id_pago_maquilero` / `id_movimiento_tercero`):

| Origen | Qué nace | Estado |
|---|---|---|
| `maquila` | `PagoMaquilero` **a cuenta** (`crearPagoACuentaMaquilero`, sin aplicaciones: un pago sin recibos es el anticipo y deja saldo negativo) | `revisado` — ejecutar **es** la decisión de Daniel |
| `proveedor` | `MovimientoTercero` origen `pago` vía `registrarMovimientoCxp` | `revisado` |
| `concepto` | Nada: la corrida es su registro (no hay cuenta corriente de conceptos) | — |

Folios por `siguienteFolio` (una clave por transacción). Antes de ejecutar, la pantalla **confirma el conteo
de renglones y los totales por rubro y general**: ⚠️ **no existe cancelación de `PagoMaquilero`** (deuda en
`HOJA-DE-RUTA.md` §4); los movimientos de CxP sí se cancelan con inverso.

## 6. Salidas

- **Relación ejecutable** (pantalla, para quien hace las transferencias): por rubro, beneficiario, banco,
  cuenta completa, monto, concepto, referencia; totales por rubro y general. Visible desde `cerrada` con
  `pagos.corrida-ver`.
- **Concentrado** Excel/PDF: sólo renglones con monto, ordenados por monto, totales de efectivo y
  transferencia por rubro y gran total. Secundarios: la pantalla es el producto.
- **Bitácora** (A7) en todos los actos; **el número de cuenta nunca entra a la bitácora** (sólo beneficiario
  y si era fiscal).

## 7. Un solo criterio de «con / sin factura»

Convivían dos lecturas de «sin factura» (una contaba los movimientos con `conFactura` sin definir, la otra
no). Quedó **una**, en `dominio/esma/formula-saldo.ts`: `whereSegmentoFactura` / `sqlSegmentoFactura`
(«sin» = `false` **o** sin definir). Los cuatro consumidores delegan y una guardia recorre el árbol entero
(`segmento-factura.test.ts`) buscando copias a mano; la única excepción declarada es `corrida_pago.con_factura`,
que es `NOT NULL`. ⚠️ Efecto visible: los movimientos migrados sin el dato **entran** ahora al lado «sin
factura» del estado de cuenta y del tablero.

## 7-bis. ⭐ El COTEJO: la factura contra el documento que emitimos (fila 0.117, §Post-F9.232)

Daniel revisaba a mano la factura de cada maquilero contra lo que le había mandado. El sistema tenía
las dos mitades —importa los CFDI (F9-E3) y emite el documento para facturar (0.118)— y **no las
unía**. Esta pieza las une.

**El documento emitido por fin tiene identidad.** No nace ninguna tabla: el `RenglonCorridaPago` YA
es el documento. Lo que le faltaba era NÚMERO, y ahora lo tiene — `folioDocumento`, la **octava
serie** de folios del sistema (clave `documento-facturacion`, §Post-F9.233). Se reparte **al CERRAR**
la corrida, con un solo `reservarBloqueFolios` (A3) y en el **orden de la relación**
(`compararEnOrdenDeLaRelacion`), para que el folio más chico sea la primera hoja del fajo. Sólo lo
reciben los renglones de una corrida **CON factura**, **con monto** y que **no** son un concepto del
catálogo. Sale impreso en grande y la hoja le pide al proveedor que lo cite en su factura.
⚠️ **No entra en el escalón del arranque** (`migracion/reparar-secuencias.ts`): las **siete** series
de §Post-F9.233 saltan al siguiente millar porque vienen con pasado del sistema viejo, y ésta **nace
en cero** el día del go-live — no hay de qué saltar. Si alguna vez se quiere, se pregunta primero.
⚠️ El renglón gana también `idEmpresa` (copiada de la corrida): sin ella no hay dónde colgar el
`UNIQUE (empresa, folio de documento)`, porque el folio se numera por empresa (A9/A3).

**A quién le toca cotejo:** la **factura de un proveedor** (`origen = factura_proveedor`) que **NO va
ligada a una operación de compra** (`refTipo IS NULL`). Ésa es la que nace contra un documento que
nosotros emitimos. La ligada a una OC se coteja contra la OC, como siempre; un pago, un abono o una
nota de crédito no se cotejan contra nada. La regla vive en UN sitio (`sujetaACotejo`).

**La liga es una TABLA, no un `refTipo`.** La decisión (d) —*«como venga»*— descarta el 1:1 de forma
explícita: una factura puede cubrir varios documentos y varias facturas pueden repartirse uno solo.
`CotejoFacturaDocumento` (mismo patrón que `PagoAplicacion`) guarda el importe cubierto de cada
documento. Es **la única vía**: no se dejó además el `refTipo` como segundo mecanismo para lo mismo.

**El rojo vive en la FACTURA, no en la liga** (`MovimientoTercero.estadoCotejo`), porque el descuadre
más común es la factura **sin ninguna liga** y una marca en la liga no tendría dónde ponerse. El
veredicto es mecánico y se **recalcula** en la misma transacción cada vez que cambian las ligas; la
decisión humana va aparte (`cotejoAtendidoEn` / `PorId` / `cotejoNota`) para que recalcular no borre
en silencio el acto de una persona (D3/A7).

**La tolerancia es UN PESO FIJO, en un solo módulo** (`dominio/pagos/cotejo-tolerancia.ts`). Daniel:
*«está bien con 1 peso de diferencia»* — el default propuesto era 0.5 % con piso de un peso y él lo
dejó más estricto. 🔴 **Prohibido deducir un porcentaje**: la decisión lo dice con todas sus letras.
Los dos lados comparados son el **total CON IVA** (el que imprime el documento y el que trae el CFDI).

**El bloqueo muerde al EJECUTAR**, con el patrón de `bloqueosDeCierre`: se publica en el detalle como
`bloqueosEjecucion` para que la pantalla lo pinte, y se vuelve a consultar dentro de la transacción de
`ejecutarCorrida` para lanzar nombrando al proveedor y el folio de su factura. **Sólo en la relación
CON factura**: la SIN factura es otro reparto de dinero y no tiene facturas de por medio.

⭐ **Y muerde también en EsMa › Pagos** (`esma/pagos.ts::crearPagoMaquilero`), que era **la puerta de al
lado y más ancha que la principal**: la corrida va bajo `pagos.corrida-armar` (sólo Administrador) y ese
camino pide `esma.ver-pagos`, que en el seed tienen ocho perfiles ⇒ sin cerrarlo, lo que Daniel pidió lo
podía saltar cualquiera pagando por el otro lado. Mismo criterio y misma función
(`facturasQueFrenanElPago`), y **sólo cuando el pago es con factura**. Medido: las cuatro suites de
integración de EsMa siguen en verde, porque su maquilero de pruebas es `solo_sin` — el segmento sin
factura no se toca.

⚠️ **CANCELAR una factura LIBERA su documento.** Las ligas de una factura cancelada **dejan de contar**
(`LIGA_DE_FACTURA_VIVA`), aunque **no se borran**: siguen visibles como rastro (D3). Sin eso, cancelar y
reexpedir un CFDI —rutina en México, y el maquilero es quien lo hace— dejaba el documento con
`disponible = 0` para siempre y **la factura de reemplazo no se podía ligar a nada**: se quedaba en rojo,
frenaba la corrida de ese proveedor, y la única salida habría sido marcar como «atendida» una factura
correcta. Es además el mismo criterio que ya usaban `facturasQueFrenanElPago` y `frenaElPago` — este era
el tercer sitio que hacía la misma pregunta y contestaba lo contrario.

📏 **Los topes se DICEN, no se callan** (§Post-F9.87 punto 4). La bandeja lee 500 facturas y el cajón 300
documentos; las dos salidas traen `hayMas` y la pantalla avisa, porque las dos van en orden descendente y
**lo que se cae de la lista es lo VIEJO** — justo lo que una factura atrasada necesita cubrir. Y el
número de «frenan un pago» sale de un `count()` **contra la base**, nunca del largo de la lista recortada:
contarlo ahí haría que con 600 en rojo la pantalla afirmara «500» como si fuera el dato.

**El veredicto nace en el MOTOR** (`terceros/cuenta-terceros.ts::registrarMovimientoTercero`) y no en
el importador de CFDI, para que la factura importada, la del ETL y cualquier alta futura queden
igual. ⚠️ Lo que el ETL de apertura carga por `createMany` (`terceros/migracion.ts`) **no** pasa por
ahí y entra sin veredicto — y así debe ser: el histórico no se pone en rojo (REGLA 0-B).

**Permisos: ninguno nuevo.** Leer con `cxp.ver`, ligar y atender con `cxp.administrar`
(§Post-F9.190: cero casillas nuevas en Roles, cero seed). Pantalla: **Finanzas › Cotejo de facturas**
(`frontend/src/modulos/cxp/CotejoFacturasPagina.tsx`). Migración aditiva
`20260914130000_la_factura_contra_lo_que_emitimos`.

⚠️ **Lo que NO alcanza, dicho a propósito:** las corridas cerradas **antes** de esta fila no tienen
folio de documento, así que sus renglones no se pueden ligar (el dominio lo rechaza nombrándolo) y su
impreso sigue rotulado con el folio de la corrida. No se rellena nada hacia atrás (REGLA 0-B).

## 8. Permisos y despliegue

| Permiso | Quién (seed) | Para qué |
|---|---|---|
| `pagos.corrida-armar` | Sólo administrador | Abrir, editar, cerrar y ejecutar la corrida |
| `pagos.corrida-ver` | Directivo · Gerencial | Ver corridas y la relación ejecutable. **Implica** ver los saldos de la semana; no se exige `cxp.ver`/`esma.ver-pagos` aparte (razón de diseño en `contrato/permisos.ts`) |
| `conceptos-pago.administrar` | Sólo administrador | Catálogo de conceptos |
| `conceptos-pago.ver` | Directivo · Gerencial | Ver el catálogo |

Migración `20260903190000_la_corrida_semanal_de_pagos`: 4 enums, 4 tablas, `proveedores.forma_pago_preferida`
(nullable, sin backfill — REGLA 0-B: los migrados lo piden al primer pago), CHECKs, índices, UNIQUE.
**El despliegue requiere `SEED_ON_START=true`.**

`Proveedor.formaPago` (texto libre con clave del SAT) **quedó superado** por `formaPagoPreferida`: sigue en
base y contrato, ya no se captura ni se muestra (deuda con nombre en `HOJA-DE-RUTA.md` §4).

## 9. Fuera de alcance (con fila)

Cotejo contra el banco (**0.126**) · IVA explícito (**0.118**) · corte y empaque (**0.114**) · libro de caja
chica (**0.127**) · cancelación de pagos de maquila (sin fila aún; §4). El cotejo de la factura contra
el documento emitido **ya NO está fuera de alcance**: entró con la fila **0.117** (§7-bis).

## 10. Dónde está el código

`backend/src/dominio/pagos/` (corrida, ejecución, concentrado) · `backend/src/dominio/catalogos/conceptos-pago*.ts`
y `cuentas-pago-reglas.ts` · `backend/src/dominio/esma/pagos.ts::crearPagoACuentaMaquilero` ·
`backend/src/dominio/pagos/cotejo.ts` + `cotejo-tolerancia.ts` · `backend/src/api/pagos/` y
`backend/src/api/terceros/cotejo.rutas.ts` · `backend/src/contrato/esquemas/corrida-pago.ts` y
`cotejo-factura.ts` · `frontend/src/modulos/cxp/CotejoFacturasPagina.tsx` · `frontend/src/modulos/pagos/`
(`CorridaPagosPagina`, `RelacionEjecutable`, `ConfirmarEjecutar`, `ConceptosPagoPagina`) ·
`frontend/e2e/corrida-pagos.spec.ts`.
