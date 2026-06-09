# Mejoras de diseño para el sistema nuevo (CONTROL v2)

> Catálogo consolidado de **oportunidades de mejora** detectadas durante la ingeniería inversa de CONTROL.
> El sistema actual lo construyó Daniel hace ~30 años con los medios de la época; aquí registramos qué conviene **rediseñar** al reconstruirlo, para hacerlo bien desde el diseño.
>
> Leyenda de prioridad: 🔴 alta · 🟡 media · 🟢 baja/nice-to-have.
> Las **decisiones ya tomadas por el dueño** viven en [DECISIONES.md](DECISIONES.md).

---

## 1. Mejoras transversales (arquitectura)

Estas aplican a **todo el sistema**, no a un módulo:

| # | Tema | Situación actual | Mejora propuesta | Prio |
|---|------|------------------|------------------|------|
| A1 | **Lógica en la interfaz** | Las reglas de negocio (cargar inventario, costear, numerar) viven en eventos de formularios con `INSERT/UPDATE` directos por SQL. | Mover la lógica a **servicios/backend** reutilizables, con API. La pantalla solo presenta. | 🔴 |
| A2 | **Sin transacciones** | Un movimiento = varias operaciones sueltas; si falla a la mitad, queda inconsistente. | Operaciones **atómicas (transacciones)** y con integridad referencial. | 🔴 |
| A3 | **Concurrencia** | Numeración por `Max()+1` y contadores editados por eventos de foco → riesgo de duplicados/descuadres en multiusuario. | **Secuencias** reales y saldos calculados, no editables. | 🔴 |
| A4 | **Seguridad casera** | Niveles numéricos + arreglo `PrP(50)` + bloqueo manual; oculta/muestra menús de Access. | **Autenticación + roles/permisos (RBAC)** estándar; el front no depende de "esconder Access". | 🔴 |
| A5 | **Rutas y archivos fijos** | Fotos en `S:\AplicacionesMJD\Control\FotosMod\<modelo>.jpg` (ruta hardcodeada). | Almacenamiento **configurable** (carpeta/bucket) y archivos referenciados en BD, no por convención de nombre. | 🟡 |
| A6 | **Columnas de ancho fijo** | Tallas en `T1..T8`, telas en `…1/…2`. Límite rígido. | **Normalizar** a tablas de detalle. → **Decisiones firmes D4 (tallas) y D5 (telas)** con modelo de datos objetivo en [DECISIONES.md](DECISIONES.md). | 🔴 |
| A7 | **Auditoría parcial** | Solo algunas tablas guardan usuario/fecha. | **Auditoría uniforme** (quién/cuándo creó y modificó) en todo. | 🟡 |
| A8 | **Datos con contraseña Jet** | Back-ends `.mdb` con contraseña; vínculos por ruta absoluta. | Base de datos **moderna** (servidor) con respaldos y acceso por credenciales. | 🔴 |
| A9 | **Multi-empresa improvisado** | `IdEmpresas` + "favorita" por `Importancia=1`. | Modelo **multi-empresa/tenant** explícito y consistente. | 🟢 |
| A10 | **Versionado/actualización casero** | Compara `VersionAct` vs `VersionDis()` y pide copiar archivos. | **Despliegue** moderno (web = sin instalar; o auto-update real). | 🟢 |

> 💡 **Patrones actuales que SÍ conviene conservar:** borrado/cancelación **suave** (`Activo`, `PedCancelado`, `Desactivado`), trazabilidad por talla en cada etapa, costo "snapshot", y el **menú manejado por datos** (se traduce a ruteo por configuración).

---

## 2. Mejoras por módulo

### 00 — Arranque / Seguridad
- Reemplazar bloqueo manual (`CantBloq>=5`) y `EstaLogiado` por manejo de sesión estándar. 🟡
- Modo mantenimiento (`Mantenimiento`) → feature flag / página de mantenimiento. 🟢

### 01 — Modelos
- Fotos: ver A5 (gestión de imágenes, no por nombre de archivo). 🟡
- Receta (BOM) ya bien modelada; conservar las 3 banderas `bPreCosto/bProduccion/bCosto` pero con nombres claros. 🟢

### 02 — Pedidos
- `NumeroPed = Max()+1` → secuencia atómica por empresa (ver A3). 🔴
- Copiado de pedido **uno-por-uno con MsgBox** → selección múltiple en un clic. 🟡
- Conservar el modelo **Pedido interno vs Pedido Real** (forecast vs órdenes reales por CEDIS). ✅ mantener

### 03 — Producción
- Tallas `T1..T8` → normalizar (A6). 🟡
- Lógica de recibo→inventario en botón → servicio transaccional (A1/A2). 🔴
- `TipoPrendas` mezcla **calidad** (Primeras/Segundas) con **almacén** → separar conceptos. 🟡
- Revisar duplicación **M (Maquila) / A (Almacén)** en entregas y recibos: ¿ambas en uso? 🟡

### 03 — Producción · Notas de salida
- **Notas de salida estructuradas:** hoy `NotasDet.Descripcion` es **texto libre**. → Ligar cada renglón al **catálogo de Habilitación** (avío + cantidad + unidad) para poder analizar lo enviado a maquileros y **descontarlo del inventario de avíos**. 🟡
- Órdenes de compra: conservar el **flujo de autorización** y la relación N:N con órdenes de producción (ya bien hechos). ✅

### 04 — Inventarios
- **Existencia por eventos de foco** (suma/resta en `GotFocus/LostFocus`) → kardex donde **existencia = suma de movimientos** (A2/A3). La pantalla `IPT_Revision` evidencia descuadres. 🔴
- Unificar los **dos inventarios** (PT y Telas) bajo un motor de inventario común. 🟡
- Telas de **dos componentes** (Felpa/Cardigan) → modelar como variantes (A6). 🟡

### 05 — Indicadores
- Unificar el patrón **productividad** (IP y Almacén comparten estructura) en un motor de KPIs configurable. 🟡
- Columnas `1s..16s` de 5S → normalizar a tabla de reactivos (A6). 🟡
- **Definir el rol de ERPs externos (Proscai, Monarch):** hoy el inventario cíclico compara contra `CantProscai`. Decidir si CONTROL v2 los reemplaza o se integra. 🔴
- Reducir captura manual diaria alimentándola de datos existentes. 🟢

### Clientes / Búsqueda (transversal)
- **Campos de referencia configurables por cliente** (generaliza `Monarch`): cada cliente define sus campos (No. pedido, estilo, CEDIS…), todos buscables. → **DECISIÓN D7** (modelo en DECISIONES.md). 🔴
- Búsqueda de órdenes por la **nomenclatura del cliente**, no solo por el No. interno. 🔴

### Integraciones externas
- **Proscai:** retirado, eliminar dependencia (D6). ✅
- **Monarch:** no es un sistema, es un **campo** reutilizado → migra a campo de referencia del cliente (D7). ✅

### 08 — Ruta Crítica (RC) y CC ⭐
- **Motor de workflow configurable** (D10): procesos/dependencias/responsables/reglas como datos; agregar-quitar-reordenar sin código. Reemplaza los `RC_IP2..5` de columnas fijas por checklists configurables. 🔴
- **Recálculo automático de fechas (CPM)** al cambiar tiempos o dependencias. 🔴
- **KPIs derivados de la RC** (D11): entregas a tiempo, lead time por proceso, cuellos de botella, desempeño por responsable/rol. Es la fuente principal de indicadores. 🔴
- **Bandeja de tareas por usuario** con semáforo (a tiempo / en riesgo / atrasado) y alertas. 🟡
- Conservar: CPM, tiempo estándar por artículo, factores por cantidad/tela/aplicación, criticidad, resurtido.

### 09 — Control de Calidad (CC)
- **Ubicación a definir** (D8): módulo aparte, parte de Maquileros/Recepción, o proceso de la RC. 🔴
- AQL **configurable** (por cliente/producto); catálogo de defectos con categorías/severidad. 🟡
- **KPIs de calidad por maquilero** (% aprobación, defectos frecuentes, tendencia) — se conectan con los KPIs de la RC (D11). 🟡

### 06 — Costos y EDR
- 🟢 **DECISIÓN D1:** usar **costo actual**, no `CostoViejo`. (ver DECISIONES.md)
- Módulo en desuso, a **rediseñar** con detalles del dueño (DECISIÓN D2). 🔴
- Pre-costo y costo real comparten estructura → **misma fórmula**, distinto origen de precios. 🟡
- EDR mensual capturado a mano → **automatizar** desde entregas al cliente. 🟡
- `Costo unitario = total / CantCorte`: dejar **explícita** la base de prorrateo. 🟡

---

*Este documento se actualiza conforme avanzamos. Pendiente: 08 RC/CC. (Promoda quedó excluido — DECISIÓN D9.)*
