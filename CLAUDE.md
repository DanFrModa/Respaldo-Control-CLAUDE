# CLAUDE.md — Contexto del proyecto (handoff entre sesiones)

> **Para cualquier chat/sesión nueva:** lee este archivo primero. Resume qué estamos haciendo, dónde está todo y cómo continuar. El idioma de trabajo es **español** (el usuario es **Daniel Masri**, dueño del sistema).

---

## 1. Qué estamos haciendo

Modernizar **"CONTROL"**, un ERP textil (marca **Marilyn / MJD**, empresa *FR Moda SA de CV*) que Daniel construyó hace ~30 años en **Microsoft Access 97**. El objetivo de esta fase fue **entender y documentar** el sistema completo (código + pantallas + datos) por **ingeniería inversa**, para luego reconstruirlo con tecnología moderna ("CONTROL v2").

**Estado actual:** la **fase de documentación está COMPLETA** (todos los módulos). Estamos consolidando y, próximamente, se decidirá tecnología y plan de desarrollo. NO se ha escrito código del sistema nuevo todavía.

---

## 2. Ubicaciones clave (rutas absolutas)

Todo vive en: `/Users/dmasri/Dropbox/Negocios/Marilyn/Server Compartido/Respaldo Control CLAUDE/`

```
Respaldo Control CLAUDE/
├── CLAUDE.md                      ← este archivo
├── *.mdb                          ← bases Access 97 (datos, CON contraseña en producción)
├── Respaldo CLAUDE/               ← VOLCADO del sistema en texto (lo más importante)
│   ├── Respaldo CLAUDEFormularios/   292 formularios (.txt, diseño + código VBA)
│   ├── Respaldo CLAUDEConsultas/     161 consultas
│   ├── Respaldo CLAUDEModulos/       13 módulos VBA
│   ├── Respaldo CLAUDEReportes/      7 reportes
│   ├── Respaldo CLAUDEMacros/        (vacío)
│   └── TABLAS/                       116 tablas exportadas a CSV (datos reales)
└── Documentacion_MJD/             ← LA DOCUMENTACIÓN que generamos (entregable)
```

> Hay otra carpeta antigua con respaldos: `/Users/dmasri/Dropbox/Negocios/Marilyn/Respaldos CONTROL/` (solo los .mdb originales). La carpeta de trabajo real es la de arriba.

---

## 3. La documentación generada (en `Documentacion_MJD/`)

**Empieza siempre por `RESUMEN-EJECUTIVO.md`** (panorama completo). Luego:

| Archivo | Contenido |
|---|---|
| `README.md` | Índice + arquitectura |
| `00-Arranque-Login-y-Menu.md` | Login, seguridad, mapa de 36 menús, niveles |
| `01-Modelos.md` | Catálogo + receta/BOM (telas/habilitación/bordados) |
| `02-Pedidos.md` | Pedidos internos + Pedidos Reales + clientes |
| `03-Produccion.md` | Orden→corte→maquila→recibo→entrega, **estampado**, **WIP**, órdenes de compra, notas de salida |
| `04-Inventarios.md` | Producto Terminado (IPT) + Telas |
| `05-Indicadores.md` | KPIs de IP (Ingeniería Producto) y Almacén |
| `06-Costos-y-EDR.md` | Costeo y estado de resultados |
| `07-EsMa-Estados-de-Cuenta-Maquileros.md` | Cuenta corriente de maquileros |
| `08-Ruta-Critica.md` | ⭐ RC = workflow/CPM. El módulo más importante |
| `09-Control-de-Calidad.md` | Auditorías AQL |
| `10-Modelo-Datos-y-Usuarios.md` | ER de todas las tablas + 2 sistemas de seguridad |
| `DECISIONES.md` | **Decisiones del dueño (D0–D11)** — leer siempre |
| `MEJORAS.md` | Mejoras de diseño para v2 (A1–A10 + por módulo) |
| `REQUISITOS-NUEVOS.md` | Funciones que faltan (R1–R9 + principio Make-to-Order) |
| `RESUMEN-EJECUTIVO.md` | Consolidado de todo |

---

## 4. Cómo leer los archivos del sistema (notas técnicas)

El entorno es una **Mac sin mdbtools ni brew**. Lo que funciona:

- **Leer datos de los .mdb:** librería Python `access-parser` (ya instalada: `pip3 install --user access-parser`). Las tablas también ya están en `TABLAS/*.csv`.
- **Encoding:** TODOS los .txt exportados y los .csv están en **latin-1 (ISO-8859-1)**, NO utf-8. Al leer con Python usar `encoding="latin-1"`.
- **⚠️ `grep` falla** leyendo estos archivos por argumento (no devuelve nada, por el encoding/entorno). **Solución: usar Python** (`re` sobre el texto), o `grep` por **stdin** (`cat archivo | grep ...`). No confíes en `grep patrón archivo`.
- Los formularios exportados (`SaveAsText`) tienen el diseño (controles + propiedades) y, al final, una sección **`CodeBehindForm`** con el código VBA de cada control.

### Snippet útil (extraer estructura de un formulario)
```python
import re
t = open("Respaldo CLAUDE/Respaldo CLAUDEFormularios/Ordenes.txt", encoding="latin-1").read()
re.search(r'RecordSource ="([^"]*)"', t)           # origen de datos
re.findall(r'SourceObject ="([^"]*)"', t)          # subformularios
re.findall(r'(?:Private|Public) (?:Sub|Function) [^\(\r\n]+', t)  # procedimientos
# el código está en:  t[t.find("CodeBehindForm"):]
```

---

## 5. Hechos clave del sistema (para no re-descubrirlos)

- **Arquitectura:** front-end `CONTROL_S_MJD.mdb` (pantallas+código) + 4 back-ends de datos (`MJD_Taine` núcleo, `MJD_Nauc` telas/inventarios, `MJD_Prop` usuarios, `MJD_Excel`). En producción los back-ends tienen **contraseña**.
- **Menú:** manejado por datos (tabla `Elementos del Panel de control`), filtrado por nivel. Form de login = `USUARIOS`; menú principal = `PANEL DE CONTROL`.
- **Seguridad: DOS sistemas.** (1) Niveles en cascada (`Usuarios.Nivel`, 1=admin…100). (2) **Accesos granulares** (tablas `Accesos`+`UsuAccesos`, arreglo `PrP`) — **este es el que se usa hoy**.
- **Tallas:** hoy columnas fijas `T1..T8` / `TC1..TC8` (máx 8). Decisión D4: hacerlas ilimitadas.
- **Telas:** doble componente `ExTela1/ExTela2` (ej. felpa + cardigan, mismo lote). D5: N acompañantes por lote.
- **Maquila:** dos flujos paralelos → **M = costura** (`Entregas`/`Recibos`), **A = estampado/aplicación** (`EntregasEst`/`RecibosEst`). NO es "Almacén".
- **WIP:** form `Proceso` = avance por etapas (corte/envío/recibo/estampado + pendientes).
- **RC (Ruta Crítica):** es un **CPM hecho a mano** (procesos con antecesores, tiempos, fechas). El módulo más importante; hoy NO se usa. Será motor de workflow + KPIs (D10/D11).
- **Costos:** decisión D1 = usar **costo actual**, no `CostoViejo`.
- **Compra por orden (Make-to-Order):** no se compra para stock (salvo genéricos).
- **Excluido:** módulo **Promoda** (cliente que ya no existe, D9). **Proscai** = ERP viejo retirado (D6). **Monarch** = campo reutilizado para referencia del cliente → generalizar a campos por cliente (D7).

---

## 6. Estilo de trabajo con Daniel

- **Español, tono cercano y claro.** Daniel es el experto del negocio y autor del sistema; **validar con él** las interpretaciones (la documentación es ingeniería inversa).
- Cada vez que Daniel aporta una regla/decisión nueva → **registrarla** en `DECISIONES.md` (D#), `MEJORAS.md` o `REQUISITOS-NUEVOS.md` (R#) según corresponda, y referenciarla desde el doc del módulo.
- Al documentar un módulo: leer sus formularios + tablas reales, capturar **reglas de negocio del código** y **evidencia de datos** (no suponer), y añadir sección "Observaciones para la modernización".
- Mantener la **numeración organizativa** de los docs ≠ estructura final (la estructura de módulos se redefine en el desarrollo, D8).

---

## 7. Próximos pasos (cuando se retome)

1. Daniel revisa el `RESUMEN-EJECUTIVO.md`.
2. **Decidir tecnología** (web / escritorio / nube) y arquitectura.
3. **Diseñar el modelo de datos nuevo** (base: doc 10 + decisiones D4/D5/D7 + requisitos R1–R7).
4. **Plan de desarrollo por fases** (núcleo: Modelos→Pedidos→Producción + RC + cadena de avíos).
5. **Migración de datos** desde los .mdb / CSV.

> Si Daniel sigue aportando contexto del negocio, seguir capturándolo en los documentos correspondientes antes de pasar a desarrollo.
