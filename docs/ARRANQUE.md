# ARRANQUE — qué falta de verdad, y los pasos del día del corte

> ## ⭐ ESTE ES EL DOCUMENTO VIVO DEL ARRANQUE. Los otros tres están viejos.
>
> **Sustituye como lista operativa a:** `docs/PUESTA-EN-PRODUCCION.md` (7-jul, da por pendientes cosas
> que ya están hechas), `docs/PLAN-DE-ARRANQUE.md` (24-ago, **su calendario venció pero su criterio
> sigue vigente**: arrancar con tres usuarios y sin Finanzas) y `docs/hoja-de-ruta/F10-etapas.md`
> (11-ago, marca 7 etapas pendientes cuando ~90 % está construido).
>
> **Cómo se hizo:** medición de **solo lectura** contra el código de la rama `prueba`, no contra los
> planes. Cada afirmación trae su archivo o su comando; lo que no se midió lo dice con las palabras
> «NO MEDIDO». **Si este documento y otro se contradicen, gana el que traiga la línea de código.**
>
> ⚠️ **Y la regla que lo mantiene honesto:** el día que algo de aquí se haga o cambie, **se corrige
> aquí**, no en otro sitio. Un plan de arranque desactualizado es peor que no tener plan, porque
> alguien lo sigue.


> **VEREDICTO: el arranque está a DÍAS de trabajo técnico, no a semanas — la migración ya está construida y con su instructivo escrito; lo que falta es sobre todo un puñado de pasos a mano y seis revisiones/arreglos pendientes.**

*Medición de solo lectura, 10-sep-2026, rama `prueba` (versión 0.140). Cada afirmación trae su archivo o su comando. Lo que no medí lo digo con las palabras «NO MEDIDO».*

---

## 1. Lo que el plan da por pendiente y en realidad YA ESTÁ CONSTRUIDO

La ficha `docs/hoja-de-ruta/F10-etapas.md` marca sus **7 etapas como pendientes** (líneas 26, 79, 129, 185, 228, 278, 322) y se escribió el 11-ago. **Está desactualizada.** Esto es lo que hay hoy en el repositorio:

**16 cargadores de datos + 9 reportes de cuadre**, todos escritos (`ls backend/migracion/etl-*.ts` y `cuadre*.ts`):

| Qué carga | Cargador | ¿Tiene cuadre? |
|---|---|---|
| Catálogos y materiales | `etl-catalogos.ts` | Sí, `cuadre.ts` |
| Modelos, receta, arte y **fotos** | `etl-modelos.ts` | Sí, `cuadre.ts` |
| Pedidos y órdenes | `etl-pedidos-ordenes.ts` | Sí, `cuadre-f2.ts` |
| Producción (corte, envíos, recibos) | `etl-produccion.ts` | Sí, `cuadre-f3.ts` |
| Compras y notas de salida | `etl-compras-notas.ts` | Sí, `cuadre-f4.ts` |
| Ruta Crítica | `etl-ruta-critica.ts` | Sí, `cuadre-f5.ts` |
| Calidad y EsMa (maquileros) | `etl-calidad.ts`, `etl-esma.ts` | Sí, `cuadre-f6.ts` |
| Costos e indicadores | `etl-costos.ts`, `etl-indicadores.ts` | Sí, `cuadre-f7.ts` |
| Archivo histórico de órdenes | `etl-historico-ordenes.ts` | — |
| Saldos de proveedores (SINUBE) | `etl-terceros-saldos.ts`, `etl-apertura-sinube.ts` | Sí, `cuadre-f9.ts`, `cuadre-apertura-sinube.ts` |
| Facturas electrónicas (CFDI) | `etl-cfdi-masivo.ts` | — |
| Inventario PT / telas *(NO se corren)* | `etl-ipt.ts`, `etl-telas.ts` | — |

**⭐ Y existe el instructivo del día del arranque, con los comandos EN ORDEN**: `backend/migracion/README.md` líneas 34–80. Eso es, en la práctica, lo que F10-E1/E2/E3 pedían construir.

**Mi lectura: entre F10-E2 y F10-E3, alrededor del 90 % ya está en el repositorio.** El 10 % que no está es andamiaje que se resolvió de otra forma: no hay pantalla de migración, ni "orquestador", ni el programa en Python que abriría los Access directamente (`find -name "*.py"` → sólo librerías ajenas). En su lugar, los comandos se corren a mano desde la terminal y el mapeo viejo→nuevo vive en una tabla (`backend/prisma/schema.prisma:3053`). **Funciona igual y no vale la pena construir lo otro para arrancar.**

**Otras dos etapas que el plan da por pendientes y están hechas:**

- **F10-E4 (archivo histórico).** Existe el cargador y **existe la pantalla** (`frontend/src/modulos/historico/ArchivoOrdenesPagina.tsx`, dada de alta en `frontend/src/App.tsx:133`). ⚠️ **Pero la "frontera de 10 años" que dice la ficha ya no aplica:** tú y Gabriel decidieron el 10-ago que **la migración lleva sólo 2025 y 2026** (`backend/migracion/comun/ventana.ts:8-11`), y todo lo demás entra como archivo plano de consulta. **Mi lectura: F10-E4 NO hace falta para arrancar; ya está resuelto de otra manera, mejor.**
- **F10-E6, la mitad de fotos.** Las fotos masivas a la nube están construidas y con ensayo en seco (`backend/migracion/loaders/fotos-modelos.ts`, instructivo en `README.md:492-505`). Sólo esperan la carpeta física.

**Y del pendiente de seguridad, casi todo se cerró después de que se escribieran esas fichas:** las cabeceras de seguridad del sitio ya están puestas (`frontend/nginx.conf.template:99-220`); el candado que impide quedarse sin administrador ya existe y tiene prueba (`backend/src/dominio/admin/roles.ts:251` y `usuarios.int.test.ts:289`); el respaldo cifrado automático **y su script para restaurarlo** ya existen (`backend/src/comun/jobs/respaldo-bd.ts`, `backend/scripts/restaurar-respaldo.ts`); y el reparto de permisos dejó de ser en cascada el 3-sep (`backend/prisma/seed.ts:105-127`), que era el defecto más feo del pentest.

⚠️ **Ojo: `docs/PUESTA-EN-PRODUCCION.md` (del 7-jul) dice que varias de esas cosas faltan. Ya no faltan.** Ese documento está viejo; no lo uses como lista.

---

## 2. Lo que falta DE VERDAD

### 2a. Código (lo que hay que programar)

**Seis asuntos marcados «bloquea V1»** en `HOJA-DE-RUTA.md` (de 135 renglones del listado, 34 siguen abiertos):

1. **0.096 — tu repaso de Inventarios.** No es programar: es que tú lo veas. Nunca lo has revisado.
2. **0.097 — tu repaso de Finanzas.** Igual: se construyó en julio y nunca lo miraste. *(El RFC de FR Moda ya lo subiste el 7-sep; de los dos requisitos sólo queda el corte de SINUBE.)*
3. **0.117 — la factura del maquilero no se coteja contra lo recibido.** El sistema tiene las dos mitades y no las une.
4. **0.120 — un permiso que regala otros cinco de pasada.** Tú mismo dijiste *«lo arreglamos cuando vayamos a producción»*: es ahora, el día que se reparten los permisos de verdad.
5. **0.123 — los datos personales publicados** (77 nombres con lo que se le paga a cada quien, en un repositorio público). Ver paso manual 0.
6. **0.163 — el costo no ve el complemento**: el cárdigan que se compra no se cobra ⇒ **el precio que se te cotiza sale bajo**. Es dinero.

**Y dos huecos que encontré midiendo, que NO tienen renglón en ningún lado:**

- 🔴 **El salto de folios no está programado.** Decidiste (`Documentacion_MJD/DECISIONES.md:1620-1625`) que las órdenes nuevas arranquen en un número redondo (6000, por ejemplo) y no en el siguiente disponible. El programa que acomoda los folios **sólo sabe hacer «último + 1»**: busqué «escalón» y «salto» en `backend/migracion/reparar-secuencias.ts` y **no aparecen** (`grep -i` → sin coincidencias). ⚠️ **Es irreversible una vez arrancado**, así que o se programa antes, o se arranca con numeración corrida.
- **Cambiar la propia contraseña no existe.** Sólo el administrador puede cambiársela a alguien (`backend/src/api/usuarios/usuarios.rutas.ts:230`, exige permiso `usuarios.administrar`). Busqué una pantalla de "mi cuenta" y no hay. Con tres usuarios se aguanta; con veintitrés estorba.

### 2b. Procedimiento (esto NO es código, y es lo que más falta)

**F10-E7 entero es procedimiento, no programación**: el ensayo general, la capacitación, el "paralelo" de semanas capturando en los dos sistemas y el corte final. **Nada de eso se programa: se agenda y se hace.** Y ya hay un plan escrito para ello, `docs/PLAN-DE-ARRANQUE.md` (24-ago), que propone arrancar **con tres usuarios y sin Finanzas** — sigue siendo, en mi lectura, la decisión más sensata del expediente. *(Ese plan apuntaba al 27-ago y no ocurrió; su calendario está vencido, su criterio no.)*

**Dos cosas grandes que YA NO hay que hacer, y conviene saberlo:**
- ✅ **No hay conteo físico de inventario.** Tú mismo lo decidiste (`DECISIONES.md:1586-1611`): se arranca en cero y se cargan las telas y avíos **con los que se está trabajando**, la primera vez que se usan. *Era el mayor consumidor de tiempo humano del arranque y desapareció.*
- ✅ **La Ruta Crítica salió de V1** (`DECISIONES.md` §Post-F9.226(a)). ⇒ **Con eso se caen del día uno:** el cargador `etl-ruta-critica.ts` y su cuadre `cuadre-f5.ts` (medido: nadie más los usa — sólo se llaman entre ellos), y deja de importar que los **18 roles de Ruta Crítica nazcan sin un solo permiso** (`backend/prisma/seed-ruta-critica.ts:476-482`), que era uno de los seis bloqueantes del plan de agosto. **Ahorra un paso del arranque y un arreglo.** ⏳ *Falta decidir contigo si el menú de Ruta Crítica se deja visible o se apaga.*

---

## 3. LOS PASOS MANUALES DEL DÍA DEL ARRANQUE, en orden

*Ninguno es programar. Los junté de `CLAUDE.md`, `HOJA-DE-RUTA.md`, `DECISIONES.md`, `backend/migracion/README.md` y `docs/PUESTA-EN-PRODUCCION.md`.*

**Con días de antelación (no esperan al día del corte):**

| # | Paso | Quién | De qué depende |
|---|---|---|---|
| 0 | **Poner el repositorio en privado** y pedir a GitHub el borrado de los archivos con nombres de personas | Gabriel | Ya lo decidiste el 3-sep. **Antes que nada** |
| 1 | **Restaurar un respaldo y comprobar que sirve.** Nunca se ha hecho | Gabriel | El script existe. *Si falla, no se arranca* |
| 2 | **Crear el ambiente real, separado del de prueba**: base de datos propia, claves nuevas (no reciclar las de prueba), R2, dominio | Gabriel | Hoy sólo existe `prueba` |
| 3 | **Conseguir la carpeta física de fotos** (`S:\...\FotosMod` + arte) y correr el ensayo en seco | Gabriel | Lleva meses esperando |
| 4 | **Recuperar los CSV del sistema viejo.** ⚠️ La carpeta `Respaldo CLAUDE/` **ya no está en la rama** (`ls` → no existe); vive en la rama `fuente-sistema-viejo` | Gabriel | Ver riesgo ⑤ |
| 5 | **Decirle al lead el número redondo del salto de folios** (¿6000?) | **Daniel** | Irreversible |
| 6 | **Decir quiénes son los otros dos usuarios** del arranque y apartar media mañana para el ensayo | **Daniel** | Camino crítico |
| 7 | **Tus dos repasos**: Inventarios (0.096) y Finanzas (0.097), en ese orden inverso — Finanzas primero | **Daniel** | Bloquean V1 |

**El día del arranque, EN ESTE ORDEN (el orden importa):**

| # | Paso | Quién | Por qué va aquí |
|---|---|---|---|
| 8 | **Congelar el sistema viejo** (sólo consulta) y **sacar el volcado fresco** de los cuatro Access | Daniel/Gabriel | Dijiste que subirías las bases *"de ese momento"*. Todo lo demás cuelga de esto |
| 9 | Arrancar el sistema con la siembra encendida (`SEED_ON_START`, ya permanente) | automático | **Antes de cargar nada**: los permisos y catálogos tienen que existir primero |
| 10 | **Cambiar la contraseña del `admin`** (semilla `Control.2026!`, está publicada en el código) y desactivar las cuentas de prueba | Gabriel | Antes de que entre nadie |
| 11 | **Correr los cargadores en el orden del instructivo** (`backend/migracion/README.md:34-80`), con `ETL_DESDE=2025` puesto **antes del primer comando** | lead | Si se olvida en uno solo, ese desalinea a todos |
| 12 | **Correr los cuadres** y leerlos | lead | Es lo único que prueba que la migración cuadró |
| 13 | **Acomodar los folios** y aplicar el salto al número redondo | lead | Después de cargar, nunca antes |
| 14 | **Crear los usuarios reales con sus permisos** (arreglando de paso el 0.120) | Gabriel/Daniel | Necesita los catálogos ya cargados |
| 15 | **Marcar «Empaque»** en los talleres que empacan, uno por uno | **Daniel** | Dato de negocio; la siembra no lo pone (`DECISIONES.md:14150`) |
| 16 | **Cargar las telas y avíos con los que se está trabajando** | Almacén | Si no, la primera explosión manda a comprar lo que ya está en bodega |

**Cuando entre Finanzas (después, no el día uno):**

| # | Paso | Quién | Por qué |
|---|---|---|---|
| 17 | Capturar los **días de crédito de los clientes** | Daniel | **Antes del punto 18**: sin eso la antigüedad de la cartera nace falsa |
| 18 | Sacar el **corte de SINUBE** y correr la carga de apertura — **ensayo en seco primero** | Daniel/lead | Nunca se ha corrido. Cualquier corte anterior se desactualiza |
| 19 | 🔴 **Abrir SINUBE y comparar 3 o 4 proveedores contra el sistema, a ojo** | **Daniel** | **El reporte de cuadre NO puede cazar un doble descuento**: suma lo que él mismo cargó (`sinube-apertura.ts:574`). Cuesta dos minutos y es la única comprobación que sirve |
| 20 | Cargar los CFDI **sólo de facturas vivas** — y **siempre después** de la apertura | lead | Al revés queda registrada como deuda algo ya pagado |

---

## 4. Riesgos

1. **El ensayo va a encontrar cosas.** En un solo día de uso casual (23-ago) encontraste seis defectos reales, y ese ritmo no ha bajado. **Deja un día de colchón entre el ensayo y el arranque**; el plan de agosto ya lo contemplaba y sigue siendo la parte más valiosa de ese documento.
2. **El cuadre de SINUBE está de acuerdo consigo mismo.** Es el único número del arranque que ningún reporte puede verificar. El paso 19 no es opcional.
3. **La carga completa se corre UNA vez, sobre base limpia** (`README.md:11-24`). Si se interrumpe, **se vacía y se empieza de nuevo** — no se retoma. Conviene tener claro cuánto tarda antes del día del corte; **NO MEDIDO: no sé cuánto tarda la corrida completa** y no puedo medirlo sin base de datos.
4. **El salto de folios es irreversible** y hoy no está programado (§2a). Es la decisión que menos se puede deshacer de todo el arranque.
5. **Los datos de origen no están donde el instructivo dice.** Los cargadores buscan `Respaldo CLAUDE/TABLAS/` y esa carpeta ya no está en la rama; se puede redirigir con `TABLAS_DIR`, **pero el instructivo no lo menciona** (busqué `TABLAS_DIR` en `README.md` → sin coincidencias). Es media línea de documentación y evita un tropiezo el día del corte.
6. **Dos detalles menores del instructivo:** falta el cuadre de catálogos y modelos (`cuadre.ts`) en la lista ordenada de comandos —está en el índice del README (línea 400) pero no en la secuencia—, y `docs/ESTADO-DESPLIEGUE.md`, citado dos veces por la ficha de F10, **no existe**.
