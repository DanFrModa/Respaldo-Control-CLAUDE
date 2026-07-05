# PROPUESTA — Finanzas (CxC/CxP + CFDI) y Catálogo de Proveedores

> **✅ ESTADO: INTEGRADO (2026-06-13).** Esta propuesta ya se incorporó a los documentos
> oficiales. Su contenido vive ahora en: **D12** (`DECISIONES.md`), **R10–R15**
> (`REQUISITOS-NUEVOS.md`), **módulo 14** y la **fase F9 (Finanzas)** (`PLANMAESTRO.md` §5/§6),
> la **fase F9** + la etapa **F1-E1B** (proveedor enriquecido, R15) en `HOJA-DE-RUTA.md` y
> `docs/hoja-de-ruta/` (ficha `F9-etapas.md`), y el contexto en `CLAUDE.md`. **Numeración
> resuelta por Gabriel:** al integrarse, la fase de Finanzas fue **F8** y **Migración + Go-live
> pasó a F9**; el **2026-07-04** (D13), al insertarse la fase **F8 · Desarrollo, Cotización y
> Listas de Precios**, **Finanzas pasó a F9** y **Go-live a F10**.
> Este archivo queda como **insumo histórico** (la plática con Daniel que originó la decisión);
> la versión viva y normativa son esos documentos. *(Nota: en el cuerpo de abajo, las
> referencias a "F8" para el Go-live son de la numeración tentativa previa a la decisión.)*
>
> **Fecha de la propuesta:** 2026-06-13 · **Integrada:** 2026-06-13.
> **Resumen en una línea:** traer a CONTROL —por etapas y sin tocar contabilidad— las cuentas
> por cobrar/pagar, la importación de CFDI ya timbrados y un catálogo de proveedores rico, con
> el objetivo final de **apagar SINUBE**.

---

## 1. Origen y motivación

Hoy Daniel emite y timbra sus facturas **fuera** de CONTROL, en **SINUBE**, y ahí lleva
también cuentas de clientes y proveedores. Quiere, a futuro, **dejar de depender de SINUBE**
y que CONTROL sea el repositorio único que **amarra cada documento fiscal con su operación
real** (pedido, orden de compra, recibo de maquila). La contabilidad y las declaraciones
**no** son su área y **seguirán con su contador**.

La ingeniería inversa actual **no contempla** nada de facturación, CFDI, CxC ni CxP: el único
modelo de "cuenta corriente" que existe es **EsMa** (estados de cuenta de maquileros), cuya
lógica *saldo = suma de movimientos* es el molde natural para generalizar.

---

## 2. Alcance acordado (futura decisión D12)

- **Contabilidad: FUERA de CONTROL.** La sigue llevando el contador. CONTROL **no** lleva
  pólizas, balanza, DIOT ni declaraciones. En su lugar, **le entrega al contador información
  detallada y limpia** de clientes y proveedores (solo lo fiscal).
- **Se incorporan CxC (cuentas por cobrar) y CxP (cuentas por pagar)** dentro de CONTROL.
- **CFDI por importación (no por emisión, en la primera etapa):** las facturas se siguen
  emitiendo por fuera y CONTROL **jala el XML ya sellado**, en los dos sentidos:
  - **Proveedores:** el XML que te mandan → alimenta CxP, costos e inventario.
  - **Ventas propias:** el XML ya timbrado (emitido en SINUBE u otro) → alimenta CxC, ligado
    al pedido/cliente.
- **Timbrado nativo desde CONTROL (vía un PAC): FASE POSTERIOR.** Queda anotado como visión a
  futuro, fuera del alcance inicial. Cuando se aborde, pasar de "importar XML" a
  "emitir + timbrar" es un salto pequeño, porque toda la estructura ya estará armada.
- **Meta de fondo:** poder **apagar SINUBE** por etapas, empezando por lo operativo (sin
  riesgo regulatorio) y dejando lo regulado (PAC) para el final.

---

## 3. Modelo de dominio confirmado

### 3.1. Un motor único de "cuenta corriente de terceros"

Generaliza el **EsMa** de hoy. El principio es el mismo que ya rige el sistema:

```
SALDO del tercero = Σ(cargos) − Σ(abonos/pagos)
```

Nunca editable; **siempre calculado como suma de movimientos** (consistente con D3 de
inventario). Este motor sirve a **tres usos** sobre la misma mecánica:

- **Clientes (CxC):** lo que te deben.
- **Proveedores de material (CxP):** lo que les debes.
- **Producción (EsMa):** maquileros, estampadores, cortadores.

### 3.2. Formal vs informal = UN libro, dos vistas

Daniel tiene proveedores que **facturan** (formales: con RFC, IVA y CFDI) y otros que **no**
(informales: sin IVA, ni siquiera dados de alta), y a todos necesita llevarles su estado de
cuenta porque les debe igual.

**Decisión:** NO se hacen dos sistemas paralelos. Se lleva **un solo estado de cuenta por
tercero**, donde **cada movimiento trae una marca fiscal**:

- **Fiscal** = tiene CFDI + IVA (+ RFC del tercero).
- **No fiscal** = sin factura.

De ese único libro salen **dos vistas**:

1. **Estado de cuenta operativo:** completo (todo lo que le debes, facture o no).
2. **Reporte fiscal (para el contador):** filtra **solo los movimientos fiscales**.

> Así, "estado de cuenta de formales" y "de informales" son **dos filtros del mismo libro**,
> no dos libros separados. No se duplican terceros ni cuentas.

### 3.3. Dos ejes en cada movimiento

| Eje | Valores |
|---|---|
| **Origen** | recibo de maquila · factura de proveedor · entrada sin factura · nota de crédito · pago · abono · descuento |
| **Naturaleza fiscal** | fiscal (con CFDI + IVA) · no fiscal (sin factura) |

El **origen** determina de dónde nace el cargo y **en qué vista** aparece (EsMa vs CxP). La
**naturaleza fiscal** determina si entra al reporte del contador.

### 3.4. Maquila (maquileros / estampadores / cortadores)

- **Permanecen en su cuenta corriente tipo EsMa.** Su cargo nace del **recibo de maquila**
  (cantidad recibida × precio real), **no** de una factura — esa es su naturaleza operativa.
- Al maquilero que **sí factura**, se le **adjunta y concilia el XML sobre ese mismo
  movimiento** del recibo, y queda marcado como **fiscal** → entra al reporte del contador
  **sin salir de EsMa**.

### 3.5. Notas de crédito

- Son **un tipo de movimiento** más (un **egreso** que baja el saldo), con su CFDI cuando es
  fiscal.
- Aplican igual a **CxC** (notas de crédito a clientes) y a **CxP** (de proveedores).

---

## 4. Catálogo de proveedores enriquecido

El catálogo de proveedores del CONTROL viejo era muy pobre. Se propone uno rico, **paralelo a
los campos por cliente (D7)**.

### 4.1. Un solo catálogo con roles/servicios (multi-valor)

No hay un "tipo" único y exclusivo. Cada proveedor marca **uno o varios roles**:

- **Producción / EsMa:** maquila (costura), corte, estampado/aplicación.
- **Bienes / otros:** vende material (telas, avíos), otros productos o servicios.

Esto resuelve el caso real de **un mismo taller que maquila y también corta** (varios
servicios), e incluso —aunque sea raro— alguien que te **vende avíos y además te maquila**
(roles de ambas familias) sin duplicarlo. El **origen de cada movimiento** (recibo vs
factura/entrada) decide en qué vista cae (EsMa vs CxP).

### 4.2. Campos propuestos (por grupo)

- **Identificación / clasificación:** nombre comercial, razón social, **roles/servicios**
  (multi-valor), qué provee (líneas/categorías → engancha R1, catálogo de avíos por
  proveedor), activo/inactivo.
- **Fiscal:** **flag `¿factura?`** (define formal/informal), RFC, régimen fiscal (SAT), uso de
  CFDI habitual, código postal (lugar de expedición), retenciones aplicables (IVA/ISR a
  personas físicas, común en maquila).
- **Contacto:** persona/vendedor, teléfono/WhatsApp, **email** (para enviar la OC y recibir el
  XML), dirección.
- **Comercial / pago:** condiciones (contado o **días de crédito**), moneda (MXN/USD), forma y
  método de pago (transferencia/efectivo/cheque; PUE/PPD), **datos bancarios** (banco, CLABE),
  límite de crédito (opcional).
- **Operativo:** **tiempo de entrega típico (lead time)** —alimenta el MRP/Make-to-Order—,
  notas, **adjuntos en R2** (constancia de situación fiscal, contrato).

---

## 5. Requisitos derivados (numeración tentativa R10–R15)

| # | Tema | Descripción corta | Prioridad |
|---|---|---|---|
| **R10** | Cuenta corriente unificada de terceros | Generaliza EsMa: saldo = suma de movimientos; ejes **origen** + **fiscal**; dos vistas (operativa / fiscal); incluye **notas de crédito**; maquila sigue en EsMa con XML conciliado | 🟡 |
| **R11** | Importación de CFDI de proveedores (XML→CxP) | Leer/validar el XML sellado del proveedor, ligarlo a OC/entrada y conciliar el cargo en CxP (marca fiscal) | 🟡 |
| **R12** | Importación de CFDI de ventas (XML→CxC) | Jalar el XML ya timbrado (emitido por fuera), ligarlo al pedido/cliente y generar el cargo en CxC | 🟡 |
| **R13** | Información detallada para el contador | Reportes/exportación de clientes, proveedores y sus movimientos **fiscales** | 🟡 |
| **R14** | Timbrado nativo vía PAC (futuro) | Emitir + timbrar desde CONTROL. R10–R12 ya dejan la estructura lista | 🟢 (futuro) |
| **R15** | Catálogo de proveedores enriquecido | Catálogo único con roles multi-valor + campos fiscales/contacto/pago/operativos (§4). Va en **F1** | 🟡 |

---

## 6. Encaje en el plan maestro (propuesta — la numeración la define Gabriel)

- **Módulo nuevo (tentativo 14) — Finanzas (cuentas de terceros + CFDI):** cuenta corriente
  única (CxC + CxP + EsMa) con marca fiscal y dos vistas; importación/conciliación de CFDI de
  clientes y proveedores; notas de crédito; reportes para el contador.
- **Fase nueva de Finanzas:** ubicada **después de Compras/MRP (F4)** —porque CxC necesita
  Pedidos (F2) y CxP necesita Compras (F4)— y **antes de Migración + Go-live (F8)**, que
  permanece como última fase. Dos sub-entregas:
  1. **CxC + CxP + importación de CFDI** (lo operativo, sin riesgo regulatorio).
  2. **Timbrado vía PAC** (lo regulado; opcional/posterior — corresponde a R14).
- **El catálogo de proveedores enriquecido (R15) entra ya en F1** (módulo 1, Catálogos), pues
  es el cimiento sobre el que luego se paran las CxP.
- **Pendiente de definir por Gabriel:** si la fase nueva renombra (F8 Go-live → F9) o se
  inserta con etiqueta (p.ej. "F7.5"). No es bloqueante para registrar la visión.

---

## 7. Reaprovechamiento (lo que ya existe)

- **Patrón EsMa:** `Documentacion_MJD/07-EsMa-Estados-de-Cuenta-Maquileros.md` (saldo = suma de
  movimientos; tipos recibos/abonos/pagos/descuentos; banderas de revisión pendiente).
- **Motores de la Fundación (F0), ya construidos en `backend/`:**
  - **Secuencias atómicas (A3)** — folios de facturas, notas, movimientos.
  - **Auditoría uniforme (A7)** — quién creó/modificó cada movimiento.
  - **Transacciones (A2)** — operaciones atómicas (registrar CFDI + crear el cargo).
  - **Archivos en R2** — guardar el **XML** (y el PDF) de cada CFDI.
  - **RBAC (A4)** — quién puede capturar facturas, pagos, conciliaciones.
  - **Multi-empresa** — CxC/CxP segmentadas por empresa.

---

## 8. Lo que esta propuesta deliberadamente NO incluye

- **Contabilidad electrónica** (pólizas, balanza, DIOT, declaraciones): se queda con el
  contador.
- **Tesorería / conciliación bancaria** completa: fuera de alcance por ahora.
- **Elección de PAC y costos de timbrado:** se evaluará cuando se aborde R14.
- **Esquema de datos (Prisma) y diseño de pantallas:** se definirán al construir la fase, no
  en esta propuesta.
