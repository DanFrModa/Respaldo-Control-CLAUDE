# 08 — Ruta Crítica (RC)

> Submódulo de **Producción** (menú 3.6).
> ⭐ **La Ruta Crítica es, para el dueño, el módulo más importante de todo el sistema** — y hoy NO está en uso. Esta es la pieza clave a rediseñar bien.
>
> *(Control de Calidad se documenta aparte en [09 — Control de Calidad](09-Control-de-Calidad.md); su ubicación como módulo se definirá en el desarrollo, D8.)*

---

## 1. Para qué sirve (en palabras del dueño)

> Controlar los **diferentes procesos** que lleva la producción: asignar **responsables** a cada proceso, definir **fechas** en que debería realizarse cada uno, y que cada usuario tenga **mapeadas sus responsabilidades en los tiempos correctos**.
>
> Funciona como **una pelota que va pasando de mano en mano**: hay **procesos anidados** (no puedes recibir la tela si no se ha comprado), entonces unos procesos **activan** a uno o más. Es ir cumpliendo **pequeños objetivos** para lograr el objetivo real: **entregar en tiempo y forma**.

En términos modernos: es un **motor de flujo de trabajo (workflow) con ruta crítica (CPM)**.

## 2. Cómo funciona HOY (as-is)

### 2.1 Catálogos (definición de procesos)
| Tabla | Rol | Campos clave |
|---|---|---|
| `CP_Familia` | Familias de prenda | `Familia` |
| `CP_Articulos` | Tipos de artículo/prenda | `Clave`, `IdCP_Familia`, `Costura` |
| `CP_Procesos` | **Catálogo de procesos** | `NumProceso`, **`AntecesorRef`** (predecesor), `Proceso`, `TipoProceso`, **`Critico`**, **`UltimoProceso`**, **`Variable`** (tiempo variable), **`NoLlevaProceso`** (condicional), **`EsResurtido`** |
| `CP_Tiempos` | **Tiempo estándar** por artículo × proceso | `IdCP_Articulos`, `IdCP_Procesos`, `Tiempo`, `Antecesor` |
| `CP_Cant` | **Factor por cantidad** (rangos) | `DeCant`, `ACant`, `FactorCant` |
| `RC_TipoTelas` | Días/factor por tipo de tela (abasto) | `TipoTela`, `Dias`, `FactorTela` |
| `RC_Aplicaciones` | Días por tipo de aplicación (estampado/bordado) | `ClaveAplicacion`, `Dias` |
| `RC_TipoUsuarios` | Roles responsables | `NombreTipoUsuario` |
| `RC_ProcUsua` | **Responsable por proceso** (proceso → rol) | `IdCP_Procesos`, `IdRC_TipoUsuarios` |

### 2.2 La ruta de cada orden
| Tabla | Rol | Campos clave |
|---|---|---|
| `RC` | **Un renglón por proceso de cada orden** | `IdOrdenes`, `IdCP_Procesos`, `NumProcesoRC`, **`TiempoRC`** (tiempo calculado), **`AntecesorRC`** (predecesor en esta orden), **`FechaEst`** (planeada), **`FechaReal`** (real), `IdUsuario` (responsable), **`Acumulado`** (tiempo acumulado) |
| `RC_IP2`…`RC_IP5` | Sub-checklists de Ingeniería del Producto | Moldes, MuestraFísica, FichaTécnica, Digitalización, Graduación, Corte, FichaProceso, Aprobada… |

En la orden (`Ordenes`) viven las banderas de control: `FechaInicioRC`, `FechaEntregaRC`, `FechaProg`, `EnRiesgo`, `SI_RC` (¿tiene RC?), `RC_Viva` (RC activa).

### 2.3 "Programar" la ruta de una orden (form `RC_Programacion`)
Al programar, el sistema **genera los renglones `RC`** de los procesos que apliquen y **calcula el tiempo de cada uno**:
```
Proceso normal      → TiempoRC = Tiempo (estándar de CP_Tiempos, según el artículo)
Proceso variable    → TiempoRC = FactCant(Tiempo)      (ajusta por rango de cantidad, CP_Cant)
Proceso de tela     → TiempoRC = TelasDias()           (días de abasto según RC_TipoTelas)
Proceso de aplicación → TiempoRC = FactCantAp(AplicDias())  (días de aplicación × factor cantidad)
```
Luego **encadena las fechas** por predecesor: `Acumulado` suma los tiempos a lo largo de la cadena de antecesores, y de ahí sale la `FechaEst` de cada proceso (esto es exactamente el **método de ruta crítica / CPM**). El procedimiento `VerifAntecesor` valida la dependencia.

Qué procesos aplican depende de la **"programación" del modelo/orden** (`NoLlevaProceso`, tipo de tela, si lleva aplicación, si es resurtido `EsResurtido`).

### 2.4 Ejecución y seguimiento
- Cada usuario abre `RC_MeterFechas` → ve **sus** procesos pendientes y captura la **`FechaReal`** al completarlos. (La "pelota" pasa al siguiente responsable.)
- La orden se marca `EnRiesgo` cuando va atrasada vs `FechaEst`.
- Consultas: `RC_ConcentradoDif` (concentrado planeado vs real — 2,061 líneas, la pantalla más pesada del sistema), `RC_PorOrden`, `RC_PorUsuario`.

## 3. Las limitaciones de hoy (lo que hay que mejorar)

> En palabras del dueño: *"Hoy son completamente rígidos. No podemos meter o quitar procesos. Y no tenemos una buena manera de analizar toda esa información, que es muchísima. De ahí quisiera que se desencadenen la mayoría de los KPI."*

1. **Procesos rígidos:** aunque hay un catálogo (`CP_Procesos`), las dependencias y sobre todo los sub-checklists de IP viven en **columnas fijas** (`RC_IP3.Moldes`, `.FichaTecnica`, etc.). Agregar/quitar un proceso o un paso implica **cambiar la estructura** (columnas/código). Por eso no se puede modificar libremente.
2. **Análisis pobre:** hay muchísima información de tiempos planeados vs reales, pero no una herramienta para explotarla.
3. **No está en uso** actualmente, pese a ser el módulo más valioso.

---

## 4. Cómo DEBERÍA funcionar (visión del dueño + propuesta)

> 🟢 **DECISIÓN D10:** rediseñar la RC como un **motor de procesos flexible y configurable**, fuente principal de los KPIs.

**Requisitos (del dueño):**
- Procesos **flexibles**: agregar, quitar y reordenar procesos **sin tocar código**.
- Asignar **responsables** por proceso y que cada usuario vea **sus tareas en su tiempo**.
- **Dependencias** entre procesos (uno activa a otro/varios; "pelota de mano en mano").
- **Tiempos variables** según complejidad del modelo, cantidad, tipo de tela, aplicación.
- Procesos **condicionales** (aplican o no según definición del modelo).
- **Análisis y KPIs** que se desprendan de toda esta información.

**Modelo de datos propuesto (flexible, sin columnas fijas):**
```
Proceso          ( IdProceso, Nombre, Critico, EsCondicional, Activo )
ProcesoDependencia( IdProceso, IdProcesoAntecesor )        -- N predecesores (grafo de dependencias)
ProcesoResponsable( IdProceso, IdRol | IdUsuario )         -- responsables por proceso
ProcesoChecklist  ( IdProceso, IdItem, Etiqueta )          -- sub-pasos configurables (reemplaza RC_IP2..5 fijos)

ReglaDuracion    ( IdProceso, Tipo, ... )                  -- fija | por cantidad | por tela | por aplicación
FactorCantidad   ( DeCant, ACant, Factor )                 -- (= CP_Cant de hoy)
ReglaAplicabilidad( IdProceso, Condicion )                 -- cuándo aplica un proceso (por modelo/artículo/tela)

RutaOrden        ( IdOrden, IdProceso, FechaPlaneada, FechaReal, IdResponsable, Estado )  -- la ruta viva
RutaOrdenChecklist( IdOrden, IdProceso, IdItem, Hecho, FechaHecho )
```

**Capacidades clave del rediseño:**
1. **Procesos como datos + reglas**, no como columnas. Se agregan/quitan desde configuración.
2. **Grafo de dependencias** → recálculo automático de fechas (CPM) cuando algo cambia.
3. **Bandeja de tareas por usuario** con semáforo: a tiempo / en riesgo / atrasado, y alertas.
4. **Motor de KPIs sobre la RC:** % entregas a tiempo, lead time por proceso, cuellos de botella, desempeño por responsable/rol, tendencia de ciclo, procesos que más atrasan. → 🟢 **DECISIÓN D11: la mayoría de los KPIs del sistema se derivan de la RC.**
5. Conserva lo bueno de hoy: tiempo estándar por artículo, factor por cantidad, días por tela/aplicación, criticidad y resurtido.

---

## Observaciones para la modernización (resumen)

1. **RC = motor de workflow configurable** (D10): procesos, dependencias, responsables, reglas de duración y aplicabilidad, todo como **datos**. 🔴
2. **KPIs desde la RC** (D11): es la mina de oro de indicadores; diseñar el modelo pensando en explotarlo (tableros). 🔴
3. **Sub-checklists configurables** (reemplazar `RC_IP2..5` de columnas fijas). 🟡
4. Conservar: cálculo por ruta crítica (CPM), tiempo estándar por artículo, factores por cantidad/tela/aplicación, criticidad y resurtido.

> 💬 **¿La auditoría de calidad es un proceso de la RC?** Es una posibilidad (la auditoría podría ser un paso más del flujo), pero **queda pendiente de definir en el desarrollo (D8)**. Por ahora, CC se documenta como tema aparte → [09 — Control de Calidad](09-Control-de-Calidad.md).

---

*Siguiente: [09 — Control de Calidad (CC)](09-Control-de-Calidad.md).*
