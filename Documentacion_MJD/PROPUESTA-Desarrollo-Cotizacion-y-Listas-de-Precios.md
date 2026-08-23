# PROPUESTA — Desarrollo, Cotización y Listas de Precios por Cliente

> **Estado: INTEGRADA AL PLAN (2026-07-04).** Esta propuesta quedó incorporada como la decisión
> **D13** (`DECISIONES.md`), los requisitos **R16–R20** (`REQUISITOS-NUEVOS.md`), el **módulo 15
> (Desarrollo y Cotización)** y la **fase F8 (Desarrollo, Cotización y Listas de Precios)**
> (`PLANMAESTRO.md` §4/§5/§6), con su ficha en `docs/hoja-de-ruta/F8-etapas.md`.
> **Numeración resuelta por Gabriel (mismo criterio secuencial que con Finanzas):** la fase nueva
> es **F8**; **Finanzas pasó de F8 a F9** (ficha renombrada a `F9-etapas.md`) y **Migración +
> Go-live pasó de F9 a F10** (ficha renombrada a `F10-etapas.md`). El plan queda **F0–F10, 11 fases**.
> Origen: idea de Daniel conversada y estructurada el 2026-07-04 (las decisiones del §8 ya las
> resolvió él en esa conversación).

---

## 1. Problema / oportunidad

Hoy CONTROL v2 arranca en "modelo terminado" y en "pedido". **Falta la capa previa de
desarrollo y cotización por cliente**: el precosteo (F7) usa precios genéricos de catálogo — no
amarra proveedor/producto/precio real — y no existen listas de precios **por cliente** ni un
espacio para registrar la **negociación** (hoy se hace en Excel, fuera del sistema).

**Meta:** cotización lo más precisa posible → precio con los factores del cliente → el dueño
aprueba o ajusta → se negocia (re-costeando) → y al haber orden de producción, todo desemboca
en la compra de material a proveedores con lo predefinido desde el desarrollo.

## 2. Concepto central: Proyectos de desarrollo (Cliente + Departamento)

- Un **Proyecto** se liga a un **Cliente** y a un **Departamento del cliente** (ej. C&A / NIÑOS)
  y concentra los **desarrollos** de ese cliente/departamento.
- Cada **desarrollo** es un modelo con **dos números**: el del cliente y el nuestro.
- **Regla fija:** proyecto = 1 cliente + 1 departamento. PERO puede haber **varios proyectos por
  departamento en la misma temporada**, como agrupaciones temáticas (proyecto joggers, Disney,
  básicos…). El proyecto lleva un **nombre/tema**.

## 3. Precosteo preciso (la base)

- **Por insumo** (tela, avío, bordado) dejar predefinido: **proveedor sugerido + producto de ese
  proveedor + precio**. Modificable al comprar.
- **Énfasis en telas:** hoy no traen precio por proveedor (verificado en el código: existe
  `AvioProveedor` con precio, pero NO existe `TelaProveedor`; la tela solo tiene un
  `precioSugerido` genérico y un precio por color no ligado a proveedor). Se necesita **precio de
  tela por proveedor** y, para **ciertos proveedores, por color** (la misma tela cuesta distinto
  en cada color). El precosteo lee de ese mismo catálogo.
- **Consumo por talla — solo ciertos avíos** (cierres, elástico…): medida por talla; el precosteo
  usa un **promedio**, pero las medidas por talla **se guardan** para comprar correcto.
- **Las telas NO van por talla:** consumo por modelo completo (tampoco por color).
- **Conceptos del costo ABIERTOS:** todo lleva al menos **tela, avíos y maquila**, pero también
  estampado, bordado, otros procesos u otros conceptos. Dejar abierta la cantidad de conceptos.

## 4. Lista de precios (factores del cliente) + aprobación

- Se genera **desde los precostos** con los **factores del cliente**: margen objetivo, % de
  descuentos del cliente, regalías, costo de ventas en %.
- **Flujo:** el sistema propone → el dueño revisa y, **modelo por modelo, aprueba o modifica el
  precio a mano** → aprobada, la toma comercial.
- **Negociación = re-costeo interactivo por versiones (clave):** se cambia el desarrollo para
  cerrar el precio (ej. quitar bolsas ⇒ menos tela + maquila más barata ⇒ nuevo costo ⇒ nuevo
  precio). Hoy se hace en Excel; la idea es hacerlo **en el sistema**. Se registran por modelo
  los **acuerdos de diseño + el precio acordado**, y se **guardan versiones**.
- La lista **se guarda por Cliente + Departamento**, con fechas y toda la negociación. Aunque no
  se cierre venta, queda **archivada** como información del departamento.

## 5. Conexión con pedidos y compras (el punto fino)

Hay **dos "órdenes de compra" distintas** que no deben confundirse:

1. La **OC DEL CLIENTE** → es la que genera **pedido / orden de producción** (la lista de
   precios **NO** dispara pedidos).
2. **NUESTRA OC a PROVEEDORES** → se alimenta **del desarrollo**.

**Secuencia:** Desarrollo → precosteo → lista → aprobación → negociación (guardado por
versiones). **Aparte**, OC del cliente → pedido → orden de producción. Ahí **cada modelo se liga
a su orden de producción**, y por esa liga queda pegado todo el registro del desarrollo y la
negociación; de ahí desemboca en **nuestra OC a proveedores** (proveedor/producto/precio
predefinidos, editables; con medidas por talla de avíos). Si un desarrollo **no llega a
producción, se apaga** y queda archivado.

## 6. Roles

| Rol | Qué hace |
|---|---|
| **Desarrollo** | Crea proyecto, modelos, receta; amarra proveedor/producto/precio; captura medidas por talla |
| **Dueño** | Revisa y **aprueba o modifica precios directamente** |
| **Gerencia comercial y/o el dueño** | La **negociación** la hace comercial, el dueño, o ambos; registran acuerdos + precio acordado (versiones) |
| **Compras** | Con orden de producción, genera la OC a proveedores con lo predefinido |

## 7. Mejoras habilitadoras

- **(A) Proveedor + producto + precio por insumo** — sobre todo **telas** (precio por proveedor
  y, en ciertos proveedores, **por color**; el precosteo sale de ese catálogo).
- **(B) Medida por talla** en ciertos avíos.
- **(C) Conceptos de costo extensibles** (tela+avíos+maquila siempre; estampado / bordado /
  otros procesos / otros conceptos según la prenda).

## 8. Decisiones ya resueltas por el dueño (2026-07-04)

| Tema | Decisión de Daniel |
|---|---|
| Precio del insumo | **Ambos**: del catálogo o capturado a mano |
| Precio de TELA | **Por proveedor** y, en ciertos proveedores, **por color**; el precosteo lee de ese catálogo; las telas quedan **predefinidas desde el precosteo** (editable al comprar) |
| Conceptos del costo | **Abiertos** (mínimo tela+avíos+maquila; + estampado/bordado/otros) |
| Consumo por talla | **Solo ciertos avíos**; telas por modelo completo; **no** por color |
| Lista de precios | Por **Cliente + Departamento**, persistida con fechas e info de negociación; **historial aunque no cierre**; si cierra, ligada a los modelos en producción |
| Estados de la lista | **Configurables** (abierta / en negociación / cerrada / ya pedida, ampliables); los mueve el dueño o el gerente comercial |
| Versionado | **Sí**, por versiones de negociación (re-costeo en el sistema) |
| Enganche | Cada modelo se liga a **una orden de producción**; ahí queda todo el registro |
| Proyecto | = 1 cliente + 1 departamento, con nombre/tema; **varios proyectos por departamento/temporada** (joggers, Disney, básicos…) |
| Negociación | **Comercial y/o el dueño** |

## 9. Punto de partida (lo que YA existe en v2 — verificado en el código, 2026-07-04)

- **Modelos + BOM** (F1): `ModeloTela`/`ModeloAvio` con `consumoPorPrenda` + banderas
  `paraPreCosto`/`paraProduccion`/`paraCosto`; `ModeloBordado` con precio. **No hay consumo por
  talla** en ningún lado.
- **Avíos por proveedor con precio** (`AvioProveedor`: precio + factor de conversión +
  condiciones, R1). **Las telas todavía no** (solo `Tela.precioSugerido` genérico y
  `TelaColor.precio` por color SIN proveedor); **falta el por proveedor y el por color por
  proveedor**.
- **Precosteo y "lista de precios" ya construidos (F7-E1)** — pero como **cálculo al vuelo por
  MODELO** con parámetros **por empresa** (`ConfiguracionEmpresa.utilidadSugerida`/
  `regaliasBase`): NO por cliente, NO persistidos, sin negociación. Dominio en
  `backend/src/dominio/costos/pre-costo.ts` (+ `precio-sugerido.ts`, fórmula en cascada con
  redondeo al alza, D2).
- **Explosión MRP + OC a proveedores ya construidas (F4)**: los avíos ya se sugieren con
  proveedor/precio (el `AvioProveedor` más barato); **las telas salen a captura manual**
  (`RequerimientoOrden.idProveedorSugerido = NULL`) — este módulo las predefiniría desde el
  precosteo. La OC ya traza `idAvioProveedor` por línea y ya liga líneas a órdenes (R7).
- **Campos configurables por cliente** (D7, F2): patrón `ClienteCampo` + `OrdenReferencia`, hoy
  a nivel orden. **No existe entidad Departamento** del cliente.
- **Pedido interno y orden de producción** con matriz color×talla (D4); el precio pactado vive
  como snapshot en `PedidoLinea.precio`; `CostoOrden` (F7) es 1:1 con la orden.

## 10. Resumen en una línea

Un módulo de **Desarrollo/Cotización por Cliente+Departamento** (con proyectos temáticos) que
produce **precostos precisos** (proveedor/producto/precio de tela por proveedor y color + medidas
por talla en avíos + conceptos de costo abiertos) → arma una **lista de precios con factores del
cliente** → el **dueño aprueba o ajusta a mano** → se **negocia re-costeando por versiones**
(comercial y/o dueño) → y al **ligar cada modelo a su orden de producción**, todo queda listo
para alimentar la **compra a proveedores** (el pedido llega por separado, vía la OC del cliente).
