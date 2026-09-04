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
chica (**0.127**) · cancelación de pagos de maquila (sin fila aún; §4).

## 10. Dónde está el código

`backend/src/dominio/pagos/` (corrida, ejecución, concentrado) · `backend/src/dominio/catalogos/conceptos-pago*.ts`
y `cuentas-pago-reglas.ts` · `backend/src/dominio/esma/pagos.ts::crearPagoACuentaMaquilero` ·
`backend/src/api/pagos/` · `backend/src/contrato/esquemas/corrida-pago.ts` · `frontend/src/modulos/pagos/`
(`CorridaPagosPagina`, `RelacionEjecutable`, `ConfirmarEjecutar`, `ConceptosPagoPagina`) ·
`frontend/e2e/corrida-pagos.spec.ts`.
