# 05 — Módulo INDICADORES

> Corresponde al **Menú 5 (INDICADORES)**. Es el módulo de **KPIs / métricas de desempeño** de dos áreas de apoyo:
> - **Ingeniería del Producto (IP)** — productividad, calidad de fichas técnicas y muestrarios.
> - **Almacén** — productividad, inventarios cíclicos y auditorías 5S.
>
> A diferencia de los módulos operativos (Modelos/Pedidos/Producción), aquí no se "produce": se **mide**.

---

# A) Ingeniería del Producto (IP)

## A.1 Productividad de IP
Mide cuánto produce cada persona del área contra un estándar.

| Tabla | Rol | Campos |
|---|---|---|
| `IP_Personal` | Personal del área | `NombreIP`, `HorasBase`, `Puesto`, `Activo` |
| `IP_Actividades` | Catálogo de actividades | `Actividad`, `PorcentajeD` (peso/estándar) |
| `IP_Productiv` | Registro diario | `Fecha`, `IdIp_Personal`, `IdIp_Actividades`, `CantidadAct` (cantidad hecha), `HorasTrabajadas` |

**Indicador:** productividad ≈ `CantidadAct / HorasTrabajadas`, comparada contra el estándar de la actividad y las `HorasBase` de la persona. Pantalla `IP_Productiv` (con accesos rápidos "Hoy/Ayer/Sábado" para capturar por fecha).

## A.2 Información Confiable de Fichas Técnicas (`IP_InfConf`)
Una **lista de verificación por orden** de qué tan confiable/completa está la ficha técnica:

| Campo | Verifica |
|---|---|
| `IdOrdenes` | Orden revisada |
| `InfGeneral`, `InfTela`, `InfHab`, `Medidas`, `Dibujo`, `InfEtiqueta`, `EspCostura`, `MedidasPrendas` | Aspectos de la ficha (cada uno se marca como OK/no) |
| `IdUsuarios`, `FechaRevision` | Quién revisó y cuándo |

Pantalla `IP_InfConfAgregar`. Es un **control de calidad de la información**, no de la prenda.

## A.3 Muestrarios pendientes (`IP_MuesPend`)
Seguimiento de **boards y muestras** solicitados:

| Campo | Significado |
|---|---|
| `Cliente`, `Categoria`, `Temporada` | A qué pertenece |
| `CantBoards`, `CantMuestras` | Cuántos se piden |
| `FechaSolicitado`, `FechaRequerida`, `FechaEntregado` | Fechas |
| `BoardsOK`, `MuestrasOK` | Cuántos quedaron listos |
| `IdUsuarioSolicitante`, `Cancelado` | Solicitante / cancelación |

Pantallas: `IP_MuesPend_Solicitud` (solicitar) y `IP_MuesPend_Pend` (revisar pendientes).

---

# B) Almacén

## B.1 Productividad del Almacén
Igual filosofía que IP: piezas procesadas vs horas/persona.

| Tabla | Rol | Campos |
|---|---|---|
| `Alm_Prd` | Día de trabajo | `FechaAlm`, `Personas`, `HorasTrabajadas` |
| `Alm_Prd_Act` | Catálogo de actividades | `ActividadAlm`, `Pz_Pers_Dia` (estándar piezas/persona/día), `PorcenPzas` |
| `Alm_Prd_Det` | Detalle | `IdAlm_Prd`, `IdAlm_Prd_Act`, `IdClientes`, `Piezas` |

**Indicador:** piezas procesadas por persona/día vs el estándar `Pz_Pers_Dia`. Pantalla `Alm_Prd_Diaria` (con captura por fecha). Existe la constante `HorasBaseAlm = 9` (jornada base del almacén).

## B.2 Inventario Cíclico (`Alm_InvCic`)
Conteos físicos periódicos para validar la exactitud del inventario:

| Campo | Significado |
|---|---|
| `FechaIC` | Fecha del conteo |
| `ModeloIC` | Modelo contado |
| `CantProscai` | Cantidad **según el sistema Proscai** (teórica) |
| `CantReal` | Cantidad **física contada** |

**Indicador:** diferencia/exactitud = `CantReal − CantProscai`. Pantallas: `Alm_IC_Alta` (alta de modelos a revisar), `Alm_IC_Cont` (captura del conteo), `Alm_IC_Consulta`.

> 🔎 **Dato de integración (actualizado):** `CantProscai` compara contra **Proscai**, otro ERP. → 🟢 **DECISIÓN D6: Proscai ya NO se usa.** En CONTROL v2 el inventario cíclico debe comparar contra **el propio inventario** (existencia teórica de CONTROL v2). El campo `Monarch`, en cambio, **sí sigue vigente** pero con otro uso: guarda la referencia/pedido del cliente (ver [DECISIONES.md D7](DECISIONES.md)).

## B.3 Auditorías 5S (`Alm_5s`)
Evaluaciones de orden y limpieza (metodología 5S):

| Campo | Significado |
|---|---|
| `FechaRevision_5s`, `IdUsuarios` | Cuándo y quién auditó |
| `1s` … `16s` | **16 puntos de evaluación** (calificación por reactivo) |

Pantalla `Alm_5s_Revision`.

---

## Pantallas (Menú 5)
| Submenú | Opción | Formulario |
|---|---|---|
| IP (25) | Productividad de IP | `IP_Productiv` |
| | Información confiable de fichas | `IP_InfConfAgregar` |
| | Muestrarios pendientes | `IP_MuesPend_Solicitud` / `IP_MuesPend_Pend` |
| | Catálogos de IP (26) | `IP_Personal`, `IP_Actividades` |
| Almacén (27) | Productividad del almacén | `Alm_Prd_Diaria` |
| | Inventarios cíclicos (28) | `Alm_IC_Alta`, `Alm_IC_Cont`, `Alm_IC_Consulta` |
| | Catálogo de actividades | `Alm_Prd_Act_Cat` |

---

## Observaciones para la modernización

1. **Patrón repetido de "productividad" (IP y Almacén).** Misma estructura: persona/día + actividad + cantidad + horas vs estándar. Se puede unificar en un **motor de KPIs/productividad** configurable por área. 🟡
2. **Columnas fijas `1s..16s` en 5S** → normalizar a tabla de reactivos (igual que tallas T1..T8). 🟡
3. **Inventario cíclico contra Proscai (`CantProscai`)** → 🟢 **DECISIÓN D6:** Proscai ya no se usa; comparar contra el inventario propio de CONTROL v2. 🔴
4. **Captura manual diaria** (Hoy/Ayer/Sábado): podría alimentarse de datos ya existentes (movimientos, recibos) para reducir captura. 🟢
5. Buen activo: ya hay **estándares** definidos (`Pz_Pers_Dia`, `PorcentajeD`, `HorasBase`) → base sólida para tableros de eficiencia.

---

*Siguiente en el orden del menú: [06 — Costos y EDR](06-Costos-y-EDR.md) (ya documentado). Pendientes (submódulos de Producción): [07 — EsMa](07-EsMa-Estados-de-Cuenta-Maquileros.md), 08 — RC/CC.*
