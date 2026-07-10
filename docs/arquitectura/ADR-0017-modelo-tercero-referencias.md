# ADR-0017 — Modelo del TERCERO en la cuenta corriente: referencias por tipo+id (no tabla polimórfica)

- **Estado:** Aceptado
- **Fecha:** 2026-07-10
- **Decisores:** **Gabriel** (dueño de la ejecución) — decisión de arranque de F9 registrada en
  `Documentacion_MJD/DECISIONES.md` **D15(a)**: _"el movimiento de cuenta corriente **referencia a
  Cliente o Proveedor existentes** (tipo + id), SIN tabla 'Tercero' polimórfica nueva — el Proveedor
  ya unifica maquilero/estampador vía roles (R15)"_.
- **Ámbito:** F9-E1 (motor de cuenta corriente de terceros, Módulo 14). Base sobre la que E2–E6
  construyen CxP, CFDI, CxC y reportes fiscales.

## Contexto

F9 incorpora **CxC + CxP** como una **cuenta corriente única de terceros** que generaliza EsMa (D12):
`saldo = Σ movimientos`, nunca editable (D3), con marca fiscal y dos vistas. El movimiento
(`MovimientoTercero`) tiene que apuntar a QUIÉN le debes / te debe. Los "terceros" del negocio son:

- **Clientes** (CxC) — ya existen como catálogo `Cliente` (F1/F2).
- **Proveedores** (CxP y EsMa) — ya existen como catálogo `Proveedor`, que en la **fusión de terceros
  (D12/R15)** ABSORBIÓ a maquileros/cortadores/estampadores: un tercero se da de alta **una sola vez**
  como `Proveedor` y marca sus servicios con roles (`RolProveedor`). Por eso un proveedor que maquila
  **y** vende telas tiene UNA sola identidad.

La pregunta de diseño (planteada como decisión a cerrar en la ficha de F9-E1): ¿se crea una entidad
`Tercero` polimórfica que unifique Cliente/Proveedor, o el movimiento los referencia por separado?

## Decisión

**El movimiento referencia al tercero por `tipoTercero` + id, con dos FKs REALES nullable
(`idCliente` / `idProveedor`) y un CHECK de exclusividad. NO se crea tabla `Tercero`.**

```
tipoTercero  TipoTercero ('cliente' | 'proveedor')
idCliente    Int?  → clientes(id)     (Restrict)
idProveedor  Int?  → proveedores(id)  (Restrict)

CHECK (
  (tipo_tercero = 'cliente'   AND id_cliente   IS NOT NULL AND id_proveedor IS NULL)
  OR
  (tipo_tercero = 'proveedor' AND id_proveedor IS NOT NULL AND id_cliente   IS NULL)
)
```

### Por qué (y por qué NO una tabla `Tercero`)

1. **El Proveedor YA unifica** (D12/R15): maquilero, estampador, cortador y vendedor de bienes son el
   mismo `Proveedor` con distintos roles. Una tabla `Tercero` encima volvería a introducir una capa de
   identidad que la fusión de terceros eliminó a propósito → duplicaría el problema que R15 resolvió.
2. **Integridad referencial real.** Con FKs a `clientes`/`proveedores`, la base garantiza que el
   tercero existe (no un id "polimórfico" suelto sin FK, que sería el precio de una `Tercero`
   sintética o de un par `(tipo, id)` sin FK). `Restrict` impide borrar un tercero con movimientos.
3. **Los catálogos ya son la fuente de verdad.** Nombre, RFC, días de crédito (R15) viven en
   `Proveedor` (y llegarán al `Cliente` en E4). Una `Tercero` los duplicaría o los dejaría vacíos.
4. **Simplicidad de las dos vistas.** El `origen` del movimiento (recibo vs factura) decide EsMa vs
   CxP; el `esFiscal`, la vista fiscal. No hace falta una entidad extra para eso.

### Consecuencias

- **`MovimientoTercero`** lleva `idEmpresa` (A9), `folio` por secuencia atómica (A3), `origen` +
  `monto` **con signo** (`saldo = Σ monto`, D3), `esFiscal` + campos CFDI mínimos, `fechaVencimiento`
  derivada (aging D15d), referencia polimórfica **sin FK** a la operación real (`refTipo`/`refId`,
  criterio ADR-0005/ADR-0010) e `idArchivoCfdi` → `Archivo` (R2). Cancelación = **inverso auditado**
  (D3/A7), nunca borrado/edición (patrón kardex).
- **Convención de signo** (única, en el dominio `signoDeOrigen`): cargo `+` (aumenta el saldo del
  tercero), abono/pago/nota de crédito/descuento `−`. Es neutral al tipo de cuenta: para un proveedor
  saldo>0 = "le debemos"; para un cliente saldo>0 = "nos debe".
- **EsMa NO se migra** (F9-E1): se re-expresa por **convivencia de lectura** (opción b) — el saldo y
  el estado de cuenta de un proveedor INCLUYEN sus movimientos EsMa reusando la fórmula de F6
  (`calcularSaldoMaquilero`), lo que **garantiza la no-regresión** de los 319 saldos del ETL. Cada
  renglón del estado de cuenta trae `fuente = motor | esma`.
- **Alcance del permiso fiscal (decisión D12, opción b).** Hay TRES permisos: `terceros.ver`
  (consultar saldos/estados de cuenta, vista operativa), `terceros.administrar` (capturar/cancelar) y
  `terceros.fiscal`. Este último gatea **solo la VISTA/REPORTE fiscal pre-filtrado** del contador (la
  vista `fiscal` = únicamente los movimientos con CFDI). **NO** gatea los ATRIBUTOS fiscales de cada
  renglón (`esFiscal`, `uuidCfdi`, `rfcTercero`, `idArchivoCfdi`) ni el `saldoFiscal`: esos viajan en
  la vista OPERATIVA con `terceros.ver` **a propósito**, coherente con la premisa de D12 ("dos vistas
  = dos filtros del MISMO libro") y con EsMa/F6, donde la distinción con/sin factura siempre fue
  visible en el estado de cuenta operativo (y el RFC ya es visible en el catálogo de proveedores). Si
  el negocio decide enmascarar esos campos para quien no tenga `terceros.fiscal`, se ajusta en **E3**
  (parser de CFDI), antes de que entren datos fiscales reales.
- **Extensible sin romper el modelo:** E4 (CxC) agrega el campo de días de crédito al `Cliente` y los
  orígenes de venta/cobro al enum; el signo lo sigue fijando el dominio (no un CHECK), así que ampliar
  el enum no exige migrar el CHECK.

### Alternativas descartadas

- **Tabla `Tercero` polimórfica (unifica Cliente/Proveedor).** Re-introduce una identidad que la
  fusión de terceros (R15) ya consolidó en `Proveedor`; obliga a sincronizar/duplicar datos de
  catálogo; sin ganancia real (las dos vistas salen del `origen`/`esFiscal`, no de la identidad).
- **Un solo `idTercero` + `tipoTercero` SIN FK (referencia suelta).** Pierde integridad referencial
  (nada impide un id inexistente) — inaceptable para el libro contable del negocio.
- **Dos tablas separadas (`MovimientoCliente` / `MovimientoProveedor`).** Duplica el motor, las rutas
  y los reportes; rompe la promesa de D12 de un **motor único** de terceros.

## Referencias

- `Documentacion_MJD/DECISIONES.md` — D12 (Finanzas), D15 (arranque F9).
- `Documentacion_MJD/PROPUESTA-Finanzas-y-Proveedores.md` §3 (un motor, dos ejes, dos vistas), §4 (roles del proveedor).
- ADR-0005 (auditoría/referencias sin FK), ADR-0007 (catálogos globales), ADR-0010 (motor kardex: existencia = Σ, cancelación por inverso).
- `docs/hoja-de-ruta/F9-etapas.md` §F9-E1.
