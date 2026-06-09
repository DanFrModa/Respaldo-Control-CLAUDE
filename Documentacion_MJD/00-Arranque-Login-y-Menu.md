# 00 — Arranque, Login y Menú Principal

> El verdadero punto de partida del sistema CONTROL (versión **4.41**, empresa *FR Moda SA de CV*).
> Aquí se explica qué pasa desde que abres el programa hasta que navegas por los módulos.

---

## 1. Secuencia de arranque

```mermaid
flowchart TD
    A[Abrir CONTROL_S_MJD.mdb] --> B[Formulario de LOGIN<br/>(form USUARIOS)]
    B -->|usuario + clave correctos| C[Configura seguridad y carga permisos]
    C --> D[Abre el MENÚ PRINCIPAL<br/>(form PANEL DE CONTROL)]
    D --> E[Submenús por módulo<br/>(36 menús en total)]
    E --> F[Formularios / Reportes de cada función]
```

### 1.1 Pantalla de Login (`form USUARIOS`)

Pide **Usuario** y **Clave**. Su lógica (procedimiento `Verif`):

1. Busca el usuario en la tabla `Usuarios`.
2. Si **`CantBloq >= 5`** → usuario **bloqueado** (5 intentos fallidos). Mensaje: *"Estás bloqueado, habla con Daniel Masri"*.
3. Si la clave es correcta:
   - Reinicia `CantBloq = 0`.
   - Registra el acceso en `UsuariosLog` (procedimiento `RegUsuarios`).
   - Define la **empresa favorita** (`Empresas` con `Importancia=1`).
   - Carga en memoria las variables globales de sesión:
     - `NivelAct` = nivel del usuario
     - `IdUsuarioACT` = id del usuario
     - `AlmDefPT` = almacén de PT por defecto (de `Propiedades`)
   - **Configura la seguridad de Access según el nivel** (procedimiento `Verif`):
     - Si el usuario **no es Administrador** (`NivelAct <> 1`): oculta la ventana de base de datos, los menús y barras de Access, y bloquea teclas especiales/escape a código. → El usuario solo ve la aplicación, no Access.
     - Si **es Administrador**: deja todo visible (modo desarrollo).
   - Carga los **permisos por pantalla** del usuario (procedimiento `Seguridad`): lee `UsuAccesos` y llena el arreglo global **`PrP(50)`** (50 banderas booleanas de "tiene acceso a X / no").
4. Si la clave es incorrecta: aumenta `CantBloq` y avisa *"¡Cuidado, te puedes bloquear!"*.
5. Si todo bien → cierra el login y abre `panel de control`.

> ⚠️ Para modernizar: el bloqueo, la bitácora de accesos (`UsuariosLog`) y los permisos por pantalla (`UsuAccesos` → `PrP`) son un **sistema de seguridad propio** que habrá que replicar con un esquema de autenticación/roles moderno.

---

## 2. Modelo de niveles de usuario (seguridad)

El sistema usa un **número de nivel**: **mientras más chico el número, más privilegios**. Está definido en el módulo `Niveles`:

| Constante | Nivel | Quién (ejemplos del código) | Qué puede |
|---|---:|---|---|
| `nivAdmin` | **1** | Daniel Masri | **Todo**, incluso modificar la base de datos |
| `nivAdminDir` | **20** | — | Todo **menos** modificar la base de datos |
| `nivDirectivo` | **30** | Papá, Jaime… | Todo **menos** modificar entradas/salidas de tela |
| `nivGerencial` | **40** | Nelly, Galia… | Como Directivo, pero **sin menú de Costos** ni ver costos |
| `nivVentas` | **45** | Alfredo, Alejandro Ocampo… | Sin ver el **total de ventas en $** en Pedidos |
| `nivLogistica` | **47** | Abakuc | Sin importes; **no puede crear/modificar órdenes** |
| `nivAsistente` | **50** | Caro | Sin el menú de Catálogos de la RC |
| `nivSecretarial` | **60** | Alicia, Lulú, Naucalpan, Tile… | No puede modificar el **precio de maquila** |
| `nivUltimo` | **100** | El resto | El más restringido |

**Cómo se aplica al menú:** cada opción del menú tiene un campo `Nivel`. La consulta `Elementos del Panel de Control Nivel` muestra una opción solo si `Nivel >= nivelta()` (el nivel del usuario). Así, un Directivo (30) ve casi todo, y un usuario nivel 100 solo ve las opciones marcadas con 100.

Además, dentro de cada formulario hay validaciones extra por nivel (ej. ocultar columnas de precio, deshabilitar botones).

---

## 3. El Menú Principal (`form PANEL DE CONTROL`)

Es un **Panel de Control (switchboard) manejado por datos**. No tiene los botones "fijos": los **lee de una tabla** y los dibuja dinámicamente.

### 3.1 Cómo funciona por dentro
- Tabla **`Elementos del Panel de control`** (166 renglones) define TODO el menú. Columnas:
  - `SwitchboardID` = a qué página/menú pertenece
  - `ItemNumber` = número de opción (0 = título del menú)
  - `ItemText` = texto que se muestra
  - `Command` = qué hace al hacer clic
  - `Argument` = el destino (otro menú, formulario, reporte, etc.)
  - `Nivel` = nivel mínimo para ver la opción
  - `NumeroMenu` = numeración jerárquica (ej. "3.6.2")
- El procedimiento `FillOptions` llena hasta **8 botones** por página leyendo esa tabla.
- El procedimiento `HandleButtonClick` ejecuta el `Command`:

| Command | Acción |
|---:|---|
| 1 | Ir a otro submenú (`Argument` = SwitchboardID destino) |
| 2 | Abrir formulario en modo **Agregar** |
| 3 | Abrir formulario (consulta) |
| 4 | Abrir reporte |
| 6 | Salir de la aplicación |
| 7 | Ejecutar macro |
| 8 | Ejecutar código (`Application.Run`) |
| 9 | (propio) Abrir formulario e ir a registro nuevo |

- Al abrir muestra: **Empresa actual**, **Usuario actual**, **Versión**, **No. de menú**, y avisa si hay **versión nueva** disponible (`VersionAct 4.41 < VersionDis()`).
- El botón **Administración** solo aparece si `NivelAct <= nivAdminDir` (≤20).
- Cada nivel de menú tiene un **color de franja** distinto (negro para el principal, verde, rojo, azul, amarillo… según el grupo).

> 💡 Esta arquitectura "menú en tabla" es muy buena: para modernizar, ese mismo concepto se traduce directo a un **menú/ruteo definido por configuración** en la app nueva.

---

## 4. Mapa completo de menús (los 6 módulos)

Reconstruido de la tabla del menú. Entre paréntesis, el **formulario** que abre cada opción.

### 🟦 1. MODELOS
- **Catálogos:** Modelos · Habilitación · Telas (`TelasDis`) · Bordados/Estampados · Verificar y alta de modelos
- **Consultas:** Lista completa (`TodosModelos`) · Fotos de modelos · Fotos de bordados · Generar listas de precios · Consultar PreCostos
- **Generador de códigos de barra** (`Codigo`)
- ~~**PROMODA**~~ (submenús 35/36): **excluido del sistema nuevo** — era para el cliente *Promoda*, que ya no se usa (ver DECISIÓN D9).

### 🟩 2. PEDIDOS
- Consultar pedidos por mes (`PedidosPorMes`)
- Agregar/Modificar **Pedidos** (`Pedidos`)
- Agregar/Modificar **Clientes** (`Clientes`)
- Ver y administrar **Pedidos Reales** (`PedidosRealesVer`)

### 🟩 3. PRODUCCIÓN
- **Catálogos:** Habilitación · Maquileros · Etiquetas de marca · Cortadores · Estampadores
- **Alimentar la producción:** Proceso de órdenes (`Proceso`) · Hacer/modificar **Orden** (`Ordenes`) · Ver órdenes incompletas
- **Consultas:** Lista de órdenes · Imprimir varias · Existencias de maquileros · Consultar órdenes (`OrdenVer`) · Para copiar · Entradas de maquileros · Programación a maquileros
- **Notas de salida** · **Órdenes de compra** (con proveedores)
- **Ruta Crítica (RC):** Meter avances (`RC_MeterFechas`) · Consultas (Concentrado, por orden, por usuario) · Catálogos (Artículos, Procesos, Familias, Tiempos, Programar)
- **Control de Calidad (CC):** Auditorías a maquileros (Alta, Captura, Consulta, Por maquilero)
- **Administración de Maquileros:** Directorio · **Estado de cuenta** (`EsMa_EdoCta`) · Saldos · Pagos semanales · Recibo semanal

### 🟪 4. INVENTARIOS
- **Producto Terminado (PT):** Alimentar (Alta modelos, Movimientos `IPT_Mov`, Clasificar, Almacenes) · Consultas (Existencias `IPT_Exis`, Movimientos por modelo, por folio) · Revisión suma vs existencias
- **Telas:** Alimentar (Agregar telas, Entradas, Salidas, Transferencias, Almacenes) · Consultas (Existencias, Movimientos, Entradas por factura, Salidas por corte, Salidas por nota)

### 🟨 5. INDICADORES
- **Ingeniería del Producto (IP):** Productividad · Información confiable de fichas técnicas · Muestrarios pendientes · Catálogos (Personal, Actividades)
- **Almacén:** Inventarios cíclicos (Alta, Conteo, Consulta) · Productividad del almacén · Catálogo de actividades

### 🟥 6. COSTOS Y EDR *(solo nivel ≤30)*
- **Costos:** Agregar/Modificar costos (`CostoOrd`) · Ver costos por pedidos
- **Estados de Resultados (EDR):** Agregar mes · Meter costos y datos · Consultar por mes · Consultar por año

### Opciones globales del menú principal
- **9.** Cambio de contraseña y propiedades personales (`CambioClave`)
- **0.** Salir del programa
- **Administración** (botón, solo nivel ≤20): gestión de usuarios y accesos

---

## 5. Datos técnicos importantes detectados

- **Ruta de fotos hardcodeada:** `Ubica = "S:\AplicacionesMJD\Control\"` (módulo `Constantes`). Las fotos de modelos viven en el servidor S:. Al migrar hay que mover esto a almacenamiento configurable.
- **Versión actual:** `VersionAct = 4.41` (constante en código). El sistema se auto-revisa contra `VersionDis()` y pide actualizar.
- **Variables globales de sesión** (módulo `Constantes`): `NivelAct`, `IdUsuarioACT`, `EmpresaFav`, `AlmDefPT`, y `PrP(50)` (permisos).
- **Multi-empresa:** el sistema maneja varias empresas (`Empresas`, campo `IdEmpresas` en pedidos y órdenes); la "favorita" se elige por `Importancia=1`.
- **Modo mantenimiento:** existe una bandera `Mantenimiento` que, si está activa, saca a todos del sistema (procedimiento `HayMant`).

---

*Siguiente lectura recomendada: [01 — Flujo de Producción](01-Flujo-Produccion.md), que detalla el módulo 3 (Producción) de punta a punta.*
