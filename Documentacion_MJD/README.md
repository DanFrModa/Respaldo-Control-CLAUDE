# Documentación del Sistema MJD (Control de Producción Marilyn)

> Ingeniería inversa del ERP en Access 97, con miras a modernizarlo.
> Generado a partir del volcado de **292 formularios, 161 consultas, 13 módulos y 116 tablas**.

> 👉 **¿Primera vez aquí o quieres el panorama completo?** Empieza por el **[RESUMEN-EJECUTIVO.md](RESUMEN-EJECUTIVO.md)** — todo el proyecto en una vista.

## Índice

| # | Documento | Estado |
|---|-----------|--------|
| 00 | [Arranque, Login y Menú Principal](00-Arranque-Login-y-Menu.md) — el punto de partida + mapa de los 36 menús + niveles de usuario | ✅ Listo |
| 01 | [Módulo MODELOS](01-Modelos.md) — catálogo de productos + receta (telas/habilitación/bordados) | ✅ Listo |
| 02 | [Módulo PEDIDOS](02-Pedidos.md) — pedidos internos, clientes y Pedidos Reales | ✅ Listo |
| 03 | [Módulo PRODUCCIÓN](03-Produccion.md) — Orden → Corte → Maquila → Recibo → Entrega | ✅ Listo |
| 04 | [Módulo INVENTARIOS](04-Inventarios.md) — Producto Terminado (IPT) y Telas | ✅ Listo |
| 05 | [Módulo INDICADORES](05-Indicadores.md) — IP (Ingeniería del Producto) y Almacén | ✅ Listo |
| 06 | [Módulo COSTOS y EDR](06-Costos-y-EDR.md) — pre-costo, costo por orden y estado de resultados | ✅ Listo |
| 07 | [Estados de Cuenta de Maquileros (EsMa)](07-EsMa-Estados-de-Cuenta-Maquileros.md) — *hoy: submódulo de Producción (3.8)* | ✅ Listo |
| 08 | [Ruta Crítica (RC)](08-Ruta-Critica.md) — ⭐ el módulo más importante; *hoy: submódulo de Producción (3.6)* | ✅ Listo |
| 09 | [Control de Calidad (CC)](09-Control-de-Calidad.md) — auditorías AQL; *ubicación a definir (D8)* | ✅ Listo |
| 10 | [Modelo de Datos completo + Usuarios y Permisos](10-Modelo-Datos-y-Usuarios.md) | ✅ Listo |
| — | ~~Promoda~~ — **excluido** (cliente que ya no se usa, ver DECISIÓN D9) | ❌ Fuera de alcance |

**Documentos de apoyo:** [DECISIONES.md](DECISIONES.md) (decisiones del dueño) · [MEJORAS.md](MEJORAS.md) (mejoras de diseño) · [REQUISITOS-NUEVOS.md](REQUISITOS-NUEVOS.md) (funciones nuevas que faltan) · [PROPUESTA-Finanzas-y-Proveedores.md](PROPUESTA-Finanzas-y-Proveedores.md) (insumo de Finanzas — ✅ integrado: D12 + R10–R15 + módulo 14 / fase F9) · [PROPUESTA-Desarrollo-Cotizacion-y-Listas-de-Precios.md](PROPUESTA-Desarrollo-Cotizacion-y-Listas-de-Precios.md) (insumo de Desarrollo/Cotización — ✅ integrado: D13 + R16–R20 + módulo 15 / fase F8).

> Documentado siguiendo el **orden estricto del menú**: 1. MODELOS · 2. PEDIDOS · 3. PRODUCCIÓN · 4. INVENTARIOS · 5. INDICADORES · 6. COSTOS Y EDR.
>
> ⚠️ **La numeración de los documentos es solo organizativa, NO la estructura final.** Varios documentos (07 EsMa, 08 RC/CC) son hoy **submódulos** dentro de Producción; se les dio archivo propio solo por su tamaño/sustancia. La estructura de módulos/submódulos se **redefinirá en el desarrollo** (ver **DECISIÓN D8**).
>
> 📌 Decisiones del dueño → **[DECISIONES.md](DECISIONES.md)**.
> 🛠️ Catálogo de mejoras de diseño para el sistema nuevo → **[MEJORAS.md](MEJORAS.md)**.

> **Empieza por el documento `00`** — explica cómo arranca el sistema y te da el mapa completo para ubicar todo lo demás.

## Arquitectura del sistema actual

- **Front-end** (`CONTROL_S_MJD.mdb`): todas las pantallas y el código.
- **Back-ends** (datos, con contraseña):
  - `MJD_Taine.mdb` — núcleo del ERP (74 tablas)
  - `MJD_Nauc.mdb` — telas, corte, inventarios (33 tablas)
  - `MJD_Prop.mdb` — usuarios y permisos (6 tablas)
  - `MJD_Excel.mdb` — exportación de órdenes de compra (1 tabla)
- Tecnología: **Access 97 (Jet 3.0)** con tablas vinculadas y código VBA 5.

## Convención de tallas (importante)

En casi todo el sistema, las cantidades por talla se guardan en **8 columnas fijas**:
`T1, T2, … T8` (en pedidos/órdenes) y `TC1 … TC8` (en corte, entregas y recibos).
Cada modelo usa una "curva de tallas" propia; las 8 columnas son las posiciones de esa curva.
