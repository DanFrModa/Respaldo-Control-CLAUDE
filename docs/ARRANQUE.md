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


> **VEREDICTO (al 19-sep-2026): lo que frena el arranque YA NO ES CÓDIGO — es procedimiento e infraestructura.** La
> migración está construida y con su instructivo escrito, y de los bloqueantes quedan **tres**, de los cuales
> **dos son «que Daniel lo mire»** y uno lo ejecuta Gabriel. Lo que de verdad falta son los pasos a mano de §2b y §3:
> el **ambiente real que todavía no existe**, el **respaldo que nunca se ha restaurado**, las **fotos y los CSV que
> no se han conseguido** y el **ensayo en seco que no se ha agendado**.
>
> *(Este veredicto decía «un puñado de pasos a mano y **seis** revisiones/arreglos pendientes». Se corrige el
> 19-sep-2026: eran seis el 10-sep y hoy son tres — ver el recuadro medido de §2a.)*

*Medición de solo lectura original: **10-sep-2026**, rama `prueba` (versión **0.140**). Cada afirmación trae su archivo o su comando. Lo que no medí lo digo con las palabras «NO MEDIDO».*

> 🔄 **PUESTA AL DÍA: 19-sep-2026, contra `origin/prueba` (versión `0.175`).** **Lo que se RE-MIDIÓ ese día, y
> es lo único que lleva esa fecha:** el recuento de bloqueantes y de filas (§2a), los riesgos **⑤** y **⑥** de
> §4 —los dos habían quedado viejos— y las citas de línea que el crecimiento de los archivos había dejado
> apuntando a otro sitio.
>
> ⚠️ **LO QUE NO SE RE-MIDIÓ, dicho con todas sus letras: la §1 ENTERA sigue siendo la medición del
> 10-sep-2026 (versión `0.140`)** — los 16 cargadores, los 10 reportes de cuadre y las afirmaciones de
> seguridad **no se volvieron a comprobar el 19-sep**. Se dan por buenos, no por medidos. **No le heredes a
> §1 la confianza de §2a**: si algo de §1 va a decidir un paso del arranque, **vuelve a medirlo**.
>
> Y la regla de siempre: si algo aquí choca con el código, **gana el código**, y se corrige **aquí mismo**,
> con su fecha, sin borrar lo que decía antes.

---

## 1. Lo que el plan da por pendiente y en realidad YA ESTÁ CONSTRUIDO

La ficha `docs/hoja-de-ruta/F10-etapas.md` marca sus **7 etapas como pendientes** (líneas **45, 98, 148, 204, 247, 297, 341** — las citas decían 26, 79, 129, 185, 228, 278, 322: **desfase uniforme de +19, comprobado en los siete encabezados uno por uno**, no extrapolado; corregido el 19-sep-2026). ⭐ **Y el desfase no se produjo después: NACIÓ con esta sección** — el mismo commit del 10-sep que escribió §1 añadió esas 19 líneas a la ficha, así que las citas se midieron contra el archivo de antes y se guardaron ya rotas. **Un número de línea puede nacer muerto**: por eso cada cita de aquí lleva ahora su ancla de texto al lado. y se escribió el 11-ago. **Está desactualizada.** Esto es lo que hay hoy en el repositorio:

**16 cargadores de datos + 10 reportes de cuadre**, todos escritos (`ls backend/migracion/etl-*.ts` y `cuadre*.ts`; el décimo es `cuadre-fase.ts`, el cuadre completo de F1, que **la tabla de abajo no lista** — decía «9» y se corrigió el 19-sep-2026. `cuadre-f7.test.ts` no cuenta: es una prueba):

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

**⭐ Y existe el instructivo del día del arranque, con los comandos EN ORDEN**: `backend/migracion/README.md`, *«Regla 3 — orden de corrida del go-live»*, líneas **101–161** *(la cita decía «34–80»; el README creció y se corrigió el 19-sep-2026 — hoy la 34–56 es material de CFDI y las reglas de go-live abren en la 57, así que ahí no están los comandos)*. ⚠️ **La referencia buena es el NOMBRE de la regla, no el número de línea** — y el rango llega hasta la **161** a propósito: de la 148 a la 161 está la otra mitad de la Regla 3, la de **qué NO se corre** (`etl-ipt`, `etl-telas`, Ruta Crítica y F9). Quien se quede en la 147 corre los cargadores sin enterarse. Eso es, en la práctica, lo que F10-E1/E2/E3 pedían construir.

**Mi lectura: entre F10-E2 y F10-E3, alrededor del 90 % ya está en el repositorio.** El 10 % que no está es andamiaje que se resolvió de otra forma: no hay pantalla de migración, ni "orquestador", ni el programa en Python que abriría los Access directamente (`find -name "*.py"` → sólo librerías ajenas). En su lugar, los comandos se corren a mano desde la terminal y el mapeo viejo→nuevo vive en una tabla (`backend/prisma/schema.prisma:3166`, `model MapeoMigracion` — la cita decía `:3053`; medido y corregido el 19-sep-2026). **Funciona igual y no vale la pena construir lo otro para arrancar.**

**Otras dos etapas que el plan da por pendientes y están hechas:**

- **F10-E4 (archivo histórico).** Existe el cargador y **existe la pantalla** (`frontend/src/modulos/historico/ArchivoOrdenesPagina.tsx`, dada de alta en `frontend/src/App.tsx:134` *(la cita decía `:133`; medido y corregido el 19-sep-2026)*). ⚠️ **Pero la "frontera de 10 años" que dice la ficha ya no aplica:** tú y Gabriel decidieron el 10-ago que **la migración lleva sólo 2025 y 2026** (`backend/migracion/comun/ventana.ts:8-11`), y todo lo demás entra como archivo plano de consulta. **Mi lectura: F10-E4 NO hace falta para arrancar; ya está resuelto de otra manera, mejor.**
- **F10-E6, la mitad de fotos.** Las fotos masivas a la nube están construidas y con ensayo en seco (`backend/migracion/loaders/fotos-modelos.ts`, instructivo en `README.md:642-663`, *«Fotos masivas»* — la cita decía `492-505` y se corrigió el 19-sep-2026). Sólo esperan la carpeta física.

**Y del pendiente de seguridad, casi todo se cerró después de que se escribieran esas fichas:** las cabeceras de seguridad del sitio ya están puestas (`frontend/nginx.conf.template:99-220`); el candado que impide quedarse sin administrador ya existe y tiene prueba (`backend/src/dominio/admin/roles.ts:251` y `usuarios.int.test.ts:289`); el respaldo cifrado automático **y su script para restaurarlo** ya existen (`backend/src/comun/jobs/respaldo-bd.ts`, `backend/scripts/restaurar-respaldo.ts`); y el reparto de permisos dejó de ser en cascada el 3-sep (`backend/prisma/seed.ts:105-127`), que era el defecto más feo del pentest.

⚠️ **Ojo: `docs/PUESTA-EN-PRODUCCION.md` (del 7-jul) dice que varias de esas cosas faltan. Ya no faltan.** Ese documento está viejo; no lo uses como lista.

---

## 2. Lo que falta DE VERDAD

### 2a. Código (lo que hay que programar)

> ### 📏 MEDIDO EL 19-sep-2026 CONTRA `origin/prueba` (versión **`0.175`**): **152 filas** en el listado, **3 bloqueantes ABIERTOS**
>
> ⚠️ **Este renglón decía «seis asuntos marcados *bloquea V1*… de 135 renglones del listado, 34 siguen
> abiertos» y estaba viejo.** Era el recuento del 10-sep, heredado del párrafo *«Dónde va el programa»* de
> `HOJA-DE-RUTA.md`. **No se borra: se corrige a la vista**, porque la diferencia es justo la buena noticia —
> **tres de aquellos seis ya se cerraron**.
>
> **Desglose completo**, contando por el **emoji de estado de cada fila** y **no por la prosa** *(la prosa de
> una fila ya cerrada sigue conteniendo las palabras «BLOQUEA V1»: leerla engaña)*: **152 filas** numeradas
> —**159 renglones**, porque 7 aparecen dos veces: la tabla de *«lo que espera a la fase 2»* las repite— ·
> **112 ✅ cerradas** · **25 ⬜ abiertas** · **14 ⏸️ aparcadas** · **1 🔶 a medias**. De las 25 abiertas:
> **3 🔴 bloquean V1**, 8 marcadas *post-V1* y 14 *«duele»* o *«puede esperar»*.
> *(Re-medido tras entrar la v0.175, que añadió dos filas: la **0.209**, que nace ya cerrada porque es
> lo que esa misma versión entregó, y la **0.210**, abierta ⇒ el listado pasó de 150 a 152, las cerradas
> de 111 a 112 y las abiertas de 24 a 25. **Los tres bloqueantes NO cambiaron** —se comprobó
> nombrándolos, no contándolos: siguen siendo 0.096, 0.097 y 0.123—, porque las dos nuevas nacen
> «duele pero se aguanta» y «puede esperar a después de arrancar».)*
>
> 🔁 **Cómo recalcularlo** (desde la raíz del repo; **si da otra cosa, gana la medición nueva** y este recuadro
> se corrige con su fecha, igual que se corrigió éste):
>
> ```bash
> grep -oP '^> \| \*\*0\.\d+\*\*' HOJA-DE-RUTA.md | sort -u | wc -l          # filas del listado     → 152
> grep -cP '^> \| \*\*0\.\d+\*\* ✅' HOJA-DE-RUTA.md                           # cerradas              → 112
> grep -cP '^> \| \*\*0\.\d+\*\* ⬜' HOJA-DE-RUTA.md                           # abiertas              →  25
> grep -cP '^> \| \*\*0\.\d+\*\* ⬜ \| 🔴 \*\*BLOQUEA V1\*\*' HOJA-DE-RUTA.md   # bloqueantes ABIERTOS  →   3
> ```

**LOS TRES QUE SIGUEN ABIERTOS:**

1. **0.096 — tu repaso de Inventarios.** No es programar: es que tú lo veas. Nunca lo has revisado.
2. **0.097 — tu repaso de Finanzas.** Igual: se construyó en julio y nunca lo miraste. *(El RFC de FR Moda ya lo subiste el 7-sep; de los dos requisitos sólo queda el corte de SINUBE.)* ⭐ **Y éste sale del camino crítico si se arranca sin Finanzas — ver el atajo, más abajo.**
3. **0.123 — los datos personales publicados** (77 nombres con lo que se le paga a cada quien, en un repositorio público). Ver paso manual 0. **Lo ejecuta Gabriel, no es programar.**

**LOS TRES QUE YA SE CERRARON** *(se dejan escritos, con su versión, en vez de borrarlos: estaban en esta misma lista el 10-sep y hoy son historia buena)*:

- ✅ **0.117 — la factura del maquilero no se cotejaba contra lo recibido.** Cerrada en la **v0.159** (14-sep-2026): ya se compara sola contra el documento que se le mandó, y la que no cuadra no se puede pagar.
- ✅ **0.120 — un permiso que regalaba otros cinco de pasada.** Cerrada en la **v0.147** (11-sep-2026): dar «administrar roles» ya no concede nada más de propina. *(Dijiste «lo arreglamos cuando vayamos a producción»; se adelantó.)*
- ✅ **0.163 — el costo no veía el complemento** (el cárdigan que se compra y no se cobra ⇒ el precio salía bajo). Cerrada en la **v0.149** (12-sep-2026). **Era el único de los seis que costaba dinero.**

> ## ⭐ LO QUE SALE DE ESTA MEDICIÓN, CON TODAS SUS LETRAS
>
> **De lo que bloquea, DOS DE TRES no son programación: son «que Daniel lo mire»** (0.096 y 0.097), y el
> tercero (0.123) **lo ejecuta Gabriel**. ⇒ **En la lista de BLOQUEANTES no queda ni una línea de código por
> escribir.** *(Fuera de esa lista sí queda algún hueco de código que no bloquea —el de cambiar la propia
> contraseña, aquí abajo— y las filas «duele» o «puede esperar» del listado.)*
>
> 🔑 **Por tanto, lo que frena el arranque no es el código: es procedimiento e infraestructura.** Es lo que ya
> está escrito en **§2b** y en **§3**, y que conviene leer aquí porque **§2a es donde se mira primero**:
>
> - **el ambiente real todavía NO EXISTE** — hoy sólo hay `prueba`, y hace falta base propia, claves nuevas (no
>   recicladas), R2 y dominio *(paso 2)*;
> - **el respaldo NUNCA se ha restaurado** — el script existe, pero nadie ha comprobado que sirva; **si falla,
>   no se arranca** *(paso 1)*;
> - **las fotos y los CSV del sistema viejo no se han conseguido** — la carpeta física lleva meses esperando, y
>   la carpeta `Respaldo CLAUDE/` ya no está en la rama *(pasos 3 y 4)*;
> - **el ensayo en seco no se ha agendado**, ni están dichos los otros dos usuarios *(paso 6)*.
>
> ⚠️ **Nada de eso se programa: se agenda y se hace.** Y ninguno depende de una versión nueva del sistema.

> ## 🚪 EL ATAJO, QUE YA ESTÁ PROPUESTO Y SIGUE SIENDO EL MÁS SENSATO: **tres usuarios y SIN Finanzas**
>
> Lo propone `docs/PLAN-DE-ARRANQUE.md` (24-ago): *«Finanzas NO entra en el primer arranque»*, con tres
> usuarios. **Su calendario venció —apuntaba al 27-ago— pero su criterio no**, y es el que sigue vigente.
>
> ⭐ **La consecuencia, dicha explícitamente y verificada contra la fila y contra los pasos 17–20 de §3:**
> **si Finanzas no entra el día uno, el repaso de Finanzas (0.097) DEJA DE BLOQUEAR EL DÍA UNO.** La fila
> 0.097 es exactamente *«que Daniel revise F9»*, y sus dos requisitos operativos son de Finanzas: el RFC (✅ ya
> capturado el 7-sep) y **el corte de SINUBE, que Daniel todavía no tiene**. Los pasos **17–20** de §3 ya
> viven, por eso, bajo el rótulo *«Cuando entre Finanzas (después, no el día uno)»*. ⇒ **0.097 viaja con el
> módulo, a la semana siguiente, junto con ese corte.**
>
> 🔴 **Y entonces, del día uno, queda UN solo bloqueante de verdad: el repaso de Inventarios (0.096)** —más el
> paso manual 0, que es de Gabriel—.
>
> ⚠️ **Un cabo que hay que atar con Daniel, no lo decide este documento:** la fila 0.096 dice que el repaso de
> Inventarios *«arranca cuando finanzas cierre»*, y el paso 7 de §3 los pide *«Finanzas primero»*. Si Finanzas
> se va a la semana siguiente, **ese orden hay que confirmarlo**: o el repaso de Inventarios se adelanta solo,
> o se decide que arrastra al de Finanzas. **Es una pregunta de una línea, y es la que abre el día uno.**

**Y dos huecos que encontré midiendo** *(el primero ya se cerró — fila 0.194, 14-sep-2026)***:**

- ✅ **El salto de folios YA ESTÁ PROGRAMADO, y para las siete series** *(actualizado el 14-sep-2026, fila 0.194 — este renglón decía lo contrario y estaba viejo)*. Decidiste que la numeración nueva arranque en un número redondo (§Post-F9.36 punto 5 para OP y OC, **§Post-F9.233** para todas: *«me gustaría hacer saltos en todos los conteos… ubícate en el siguiente millar»*). El comando es uno solo y va en el paso 13 de abajo. ⚠️ **Sigue siendo irreversible** y **sigue siendo ahora o nunca**: si se arranca con la numeración corrida, se queda así para siempre.
- **Cambiar la propia contraseña no existe.** Sólo el administrador puede cambiársela a alguien (`backend/src/api/usuarios/usuarios.rutas.ts:230`, exige permiso `usuarios.administrar`). Busqué una pantalla de "mi cuenta" y no hay. Con tres usuarios se aguanta; con veintitrés estorba.

### 2b. Procedimiento (esto NO es código, y es lo que más falta)

**F10-E7 entero es procedimiento, no programación**: el ensayo general, la capacitación, el "paralelo" de semanas capturando en los dos sistemas y el corte final. **Nada de eso se programa: se agenda y se hace.** Y ya hay un plan escrito para ello, `docs/PLAN-DE-ARRANQUE.md` (24-ago), que propone arrancar **con tres usuarios y sin Finanzas** — sigue siendo, en mi lectura, la decisión más sensata del expediente. *(Ese plan apuntaba al 27-ago y no ocurrió; su calendario está vencido, su criterio no.)*

**Dos cosas grandes que YA NO hay que hacer, y conviene saberlo:**
- ✅ **No hay conteo físico de inventario.** Tú mismo lo decidiste (`DECISIONES.md:1609-1634`): se arranca en cero y se cargan las telas y avíos **con los que se está trabajando**, la primera vez que se usan. *Era el mayor consumidor de tiempo humano del arranque y desapareció.*
- ✅ **La Ruta Crítica salió de V1** (`DECISIONES.md` §Post-F9.226(a)). ⇒ **Con eso se caen del día uno:** el cargador `etl-ruta-critica.ts` y su cuadre `cuadre-f5.ts` (medido: nadie más los usa — sólo se llaman entre ellos), y deja de importar que los **18 roles de Ruta Crítica nazcan sin un solo permiso** (`backend/prisma/seed-ruta-critica.ts:476-482`), que era uno de los seis bloqueantes del plan de agosto — ⚠️ **otra lista, NO los «seis» de §2a**: los de agosto son técnicos (`docs/PLAN-DE-ARRANQUE.md:49-60`: permisos de los roles de RC, guarda anti-bloqueo de usuarios, cambio de contraseña, los 10 catálogos, cabeceras de nginx y migrar los usuarios reales) y **no comparten ni uno** con los de §2a; verificado el 19-sep-2026. **Ahorra un paso del arranque y un arreglo.** ⏳ *Falta decidir contigo si el menú de Ruta Crítica se deja visible o se apaga.*

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
| 5 | ✅ **Los números del salto de folios ya están dichos** (§Post-F9.233, 14-sep): **OP 6000**, **OC 10000**, y las otras cinco por la regla del **siguiente millar**, que el comando calcula solo. **Nada que preguntar** | — | Irreversible |
| 6 | **Decir quiénes son los otros dos usuarios** del arranque y apartar media mañana para el ensayo | **Daniel** | Camino crítico |
| 7 | **Tus dos repasos**: Inventarios (0.096) y Finanzas (0.097), en ese orden inverso — Finanzas primero. ⚠️ *(19-sep-2026: **si se arranca sin Finanzas** —el atajo de §2a— el de Finanzas se va con el módulo a la semana siguiente y del día uno sólo queda el de Inventarios; el orden «Finanzas primero» hay que confirmarlo con Daniel)* | **Daniel** | Bloquean V1 |

**El día del arranque, EN ESTE ORDEN (el orden importa):**

| # | Paso | Quién | Por qué va aquí |
|---|---|---|---|
| 8 | **Congelar el sistema viejo** (sólo consulta) y **sacar el volcado fresco** de los cuatro Access | Daniel/Gabriel | Dijiste que subirías las bases *"de ese momento"*. Todo lo demás cuelga de esto |
| 9 | Arrancar el sistema con la siembra encendida (`SEED_ON_START`, ya permanente) | automático | **Antes de cargar nada**: los permisos y catálogos tienen que existir primero |
| 10 | **Cambiar la contraseña del `admin`** (semilla `Control.2026!`, está publicada en el código) y desactivar las cuentas de prueba | Gabriel | Antes de que entre nadie |
| 11 | **Correr los cargadores en el orden del instructivo** (`backend/migracion/README.md:101-161`, *«Regla 3»* — **entera: la 148–161 dice qué NO se corre**; la cita decía `34-80` y se corrigió el 19-sep-2026 con rango corto, re-corregida el mismo día; **la referencia buena es el nombre de la regla, no el número de línea**), con `ETL_DESDE=2025` puesto **antes del primer comando** | lead | Si se olvida en uno solo, ese desalinea a todos |
| 12 | **Correr los cuadres** y leerlos | lead | Es lo único que prueba que la migración cuadró |
| 13 | **Acomodar los folios** y aplicar el salto al número redondo — **de las SIETE series**, con este comando y en dos pasos (ensayo, leer el cuadro, y el MISMO comando con `--aplicar`): `npx tsx --env-file=.env migracion/reparar-secuencias.ts --escalon-millar --escalon-orden=6000 --escalon-orden-compra=10000` | lead | Después de cargar, nunca antes. **`--escalon-millar` es de una sola vez**: si se repite después de capturar, vuelve a saltar |
| 14 | **Crear los usuarios reales con sus permisos** (arreglando de paso el 0.120) | Gabriel/Daniel | Necesita los catálogos ya cargados |
| 15 | **Marcar «Empaque»** en los talleres que empacan, uno por uno | **Daniel** | Dato de negocio; la siembra no lo pone (`DECISIONES.md:14665` — la cita decía `:14150` y se corrigió el 19-sep-2026) |
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
3. **La carga completa se corre UNA vez, sobre base limpia** (`README.md:61-73`, *«Regla 1 (DURA)»* — la cita decía `11-24` y se corrigió el 19-sep-2026). Si se interrumpe, **se vacía y se empieza de nuevo** — no se retoma. Conviene tener claro cuánto tarda antes del día del corte; **NO MEDIDO: no sé cuánto tarda la corrida completa** y no puedo medirlo sin base de datos.
4. **El salto de folios es irreversible.** Ya está programado (§2a, fila 0.194) y sus números ya están decididos, pero sigue siendo **la decisión que menos se puede deshacer de todo el arranque**: se aplica una vez, después de cargar, y no se re-numera. El comando **ensaya por omisión** — el cuadro que imprime hay que leerlo antes de poner `--aplicar`, y dice de dónde sale cada número.
5. ✅ **Los datos de origen no están donde el instructivo decía — RESUELTO** *(re-medido el 19-sep-2026; este riesgo decía que el instructivo no lo mencionaba, y ya no es cierto)*. Sigue siendo verdad que los cargadores buscan `Respaldo CLAUDE/TABLAS/` y **esa carpeta ya no está en la rama** (vive en `fuente-sistema-viejo`), pero el README **ya documenta el desvío**: `TABLAS_DIR` aparece dos veces (`backend/migracion/README.md:107` y `:114`, en la cabecera de *«Regla 3»*, con la advertencia *«sólo si los CSV no están en Respaldo CLAUDE/TABLAS/ (hoy NO lo están)»*). **Queda el paso 4: conseguir los CSV.**
6. **Dos detalles menores del instructivo — uno resuelto, uno no** *(re-medido el 19-sep-2026)*: ✅ el cuadre de catálogos y modelos (`cuadre.ts`) **ya está en la lista ordenada** (`backend/migracion/README.md:141`, dentro de *«Regla 3»*, con su propia marca *«⚠️ FALTABA en esta lista»*); ⬜ `docs/ESTADO-DESPLIEGUE.md`, citado dos veces por la ficha de F10, **sigue sin existir** (`ls` → no existe).
