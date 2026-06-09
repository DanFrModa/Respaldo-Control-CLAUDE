# Resumen Ejecutivo — Proyecto CONTROL v2

> Panorama completo del proyecto de modernización del ERP **CONTROL** (Marilyn / MJD).
> Documento de consolidación: una sola vista de todo lo trabajado. Para el detalle, ver cada documento referenciado.

---

## 1. El proyecto en una frase

Modernizar **CONTROL**, el ERP textil que el dueño construyó hace ~30 años en **Access 97**, conservando su lógica de negocio probada y corrigiendo las limitaciones estructurales — para reconstruirlo con tecnología actual.

## 2. Qué hicimos hasta ahora

1. **Extracción:** se sacó del Access 97 todo el sistema en texto legible — **292 formularios, 161 consultas, 13 módulos, 7 reportes y 116 tablas** (vía `SaveAsText` y exportación de datos).
2. **Ingeniería inversa:** se analizó el código y los datos reales para entender cada módulo, sus reglas de negocio y su modelo de datos.
3. **Documentación:** 11 documentos de módulos + decisiones + mejoras + requisitos nuevos (este conjunto).

## 3. Mapa de módulos (documentación)

| Doc | Módulo | Estado |
|---|---|---|
| 00 | Arranque, Login y Menú (+ mapa de 36 menús, niveles) | ✅ |
| 01 | MODELOS (catálogo + receta/BOM) | ✅ |
| 02 | PEDIDOS (internos + Pedidos Reales) | ✅ |
| 03 | PRODUCCIÓN (orden→corte→maquila→recibo→entrega + OC + notas) | ✅ |
| 04 | INVENTARIOS (Producto Terminado + Telas) | ✅ |
| 05 | INDICADORES (IP + Almacén) | ✅ |
| 06 | COSTOS y EDR | ✅ |
| 07 | EsMa — Estados de Cuenta de Maquileros | ✅ |
| 08 | RUTA CRÍTICA ⭐ | ✅ |
| 09 | Control de Calidad (AQL) | ✅ |
| 10 | Modelo de Datos + Usuarios/Permisos | ✅ |

> Promoda quedó **excluido** (cliente sin uso, D9).

## 4. Cómo funciona el negocio (flujo central)

```
MODELOS → PEDIDOS → PRODUCCIÓN (Ruta Crítica controla los tiempos)
   │                    ├─ Corte
   │                    ├─ Maquila (entrega/recibo) → Inventario PT
   │                    ├─ Control de Calidad (Primeras/Segundas)
   │                    └─ Entrega al cliente
   ├─ Compras (OC) y Notas de salida (avíos a maquila)
   ├─ Telas (inventario)
   ├─ Costos / EDR
   ├─ EsMa (cuenta de maquileros)
   └─ Indicadores (KPIs)
```

## 5. Decisiones del dueño (12)

Detalle en [DECISIONES.md](DECISIONES.md).

| # | Decisión |
|---|---|
| D0 | Rediseñar con libertad (hay inconsistencias de origen). |
| D1 | Costeo con **costo actual**, no congelado. |
| D2 | Módulo Costos/EDR a rediseñar (detalles pendientes del dueño). |
| D3 | Existencia = **suma de movimientos** (kardex transaccional). |
| D4 | **Tallas ilimitadas** + inventario PT por modelo×color×talla. |
| D5 | Telas: **N acompañantes por lote** (cuerpo+cardigan+…), por lote/color. |
| D6 | **Proscai retirado**; inventario cíclico contra inventario propio. |
| D7 | **Campos de referencia configurables por cliente** (generaliza "Monarch"). |
| D8 | **Redefinir estructura de módulos/submódulos** en el desarrollo (incluye ubicación de CC). |
| D9 | **Excluir Promoda**. |
| D10 | RC = **motor de workflow configurable**. |
| D11 | **La mayoría de KPIs se derivan de la RC**. |

## 6. Mejoras de arquitectura clave

Detalle en [MEJORAS.md](MEJORAS.md). Las de mayor impacto (🔴):

- **A1** Lógica de negocio fuera de los formularios → servicios/backend.
- **A2** Transacciones e integridad referencial.
- **A3** Concurrencia: secuencias reales, saldos calculados (no `Max()+1` ni contadores editables).
- **A4** Seguridad moderna (roles + permisos) — unificar los **dos** sistemas actuales (niveles + Accesos).
- **A6** Normalizar columnas fijas (tallas T1..T8, telas …1/…2, 5S 1s..16s).
- **A8** Una sola base de datos en servidor (hoy 4 .mdb con contraseña).

> **A conservar del sistema actual:** borrado/cancelación suave, trazabilidad por talla, costo "snapshot" (concepto), menú por configuración, ruta crítica (CPM), AQL en calidad, autorización/auditoría en compras, modelo Pedido/Pedido Real.

## 7. Requisitos nuevos (lo que falta por completo)

Detalle en [REQUISITOS-NUEVOS.md](REQUISITOS-NUEVOS.md).

**Cadena de avíos / MRP (lo más importante):**
- **R1** Catálogo de avíos por proveedor · **R2** BOM de avíos y telas en el modelo · **R3** Explosión de materiales (por orden) · **R4** Inventario de avíos (multi-almacén).
- **R7** Seguimiento de recepción: estatus automático por orden y **auto-avance de la RC**.

**Gestión documental:**
- **R5** Fichas técnicas por orden · **R6** Repositorio de archivos por orden.

**Otros:**
- **R9** Definir formatos de documentos impresos.
- **R8** *(Etapa 2)* Importar pedidos de clientes → generar órdenes automáticamente.

> 🔑 **Principio de negocio:** compra **por orden (Make-to-Order)**, no para stock (salvo pocos genéricos).

## 8. Próximos pasos sugeridos

1. **Revisión** de este consolidado por el dueño (validar/ajustar).
2. **Decidir la tecnología** (web / escritorio / nube) y la arquitectura.
3. **Diseñar el modelo de datos nuevo** (a partir del doc 10 + decisiones D4/D5/D7 + requisitos).
4. **Plan de desarrollo por fases**, empezando por el núcleo (Modelos→Pedidos→Producción + Ruta Crítica) y la cadena de avíos.
5. **Migración de datos** desde los respaldos actuales.

---

*Estado: documentación e ingeniería inversa **completas**. Listos para definir tecnología y diseño.*
