# Fila 0.123 · Los datos personales publicados — el paquete para ejecutar la remediación

> **Para qué es este archivo.** La fila **0.123** de `HOJA-DE-RUTA.md` cuenta *qué pasó* y *qué se
> decidió*. Este documento es lo otro: **los datos duros y el orden de las operaciones** para que quien
> lo ejecute —Gabriel— no tenga que volver a medir nada.
>
> 🔑 **Por qué existe, y es la mitad del punto:** este paquete **ya se había hecho una vez**, el 9-sep, y
> vivía en el *scratchpad* de la sesión que lo midió. Esa sesión terminó, su contenedor se recicló y
> **el paquete se perdió entero**. Hubo que volver a medirlo desde cero. Es la misma cicatriz que la fila
> deja escrita para los hallazgos —*un hallazgo que no está donde se toma la decisión es un hallazgo que
> no existe*— aplicada a un documento: **lo que no está en el repo, no está.**

---

## 1. Qué está expuesto hoy

**Medido el 11-sep-2026** (método al final de cada punto, para que se pueda **volver a correr**):

| Hecho | Estado | Cómo se midió |
|---|---|---|
| El repositorio es **PÚBLICO** | 🔴 **SIGUE PÚBLICO** | API de GitHub: `"private": false`, `"visibility": "public"` |
| Los cinco `.xlsx` en el **tip de `prueba`** | 🔴 **SIGUEN AHÍ** | `git ls-tree -r origin/prueba Documentacion_MJD/archivos-de-referencia/` |
| El dato grave | 🔴 **77 nombres completos de personas físicas, cada uno pegado al monto que cobra** (`relacion-pagos-sin-factura.xlsx`, hoja «General», columna O) + **nombres de autor reales** en `docProps/core.xml` de los cinco | medido el 3-sep abriendo el XML; el aviso vive junto a los archivos, en `Documentacion_MJD/archivos-de-referencia/README.md` |
| **`main`** | ✅ **LIMPIO** — nunca los recibió | `git merge-base --is-ancestor bff9653d origin/main` → **NO**, y `git ls-tree -r origin/main` no tiene ninguno de los cinco |

⚠️ **Daniel decidió el 3-sep-2026 poner el repositorio en privado** (§Post-F9.188(c)). **Ocho días después
sigue público.** Es un interruptor, lo ejecuta Gabriel, **no depende de ninguna decisión pendiente** y es
**lo único que corta la exposición hoy** — todo lo demás tarda días.

---

## 2. Los datos duros

**El commit que introduce los cinco archivos es UNO SOLO: `bff9653d`**
(«Guardar los cinco archivos reales de Daniel, sin datos sensibles» — el título es falso, y por eso
buscarlo por su mensaje engaña).

- ✅ Es **ancestro de `origin/prueba`**. ❌ **NO** es ancestro de `origin/main`.
- ✅ **No hay una versión anterior peor escondida**: los cinco blobs entran en ese único commit y no se
  han vuelto a tocar.
- 📌 **No es el merge `209348a`** el que hay que nombrarle a Support: ése no introduce blobs.

**Los cinco blobs** (lo que Support tiene que purgar; la ruta de todos es
`Documentacion_MJD/archivos-de-referencia/`):

| Archivo | SHA del blob | Bytes |
|---|---|---|
| **`relacion-pagos-sin-factura.xlsx`** 🔴 *el de los 77 nombres* | `f5e719c2468d3f47861ce23c865b20d5e920640b` | 16 300 |
| `antiguedad-de-saldos.xlsx` | `da2b24dabfac70548109dae6ba0ed621a3316bf2` | 19 836 |
| `cotizacion-que-manda-el-cliente.xlsx` | `16679bb16a6d94eab8b274b4e77633cf987ee000` | 179 261 |
| `excel-semanal-de-produccion.xlsx` | `38b06ea567e015ce9617230bd09a7ee17fe1d36e` | 9 144 |
| `lista-de-precios-de-daniel.xlsx` | `057e1ff1561cd21fb9a8732e4c6714408fba2c6d` | 27 860 |

> Los otros cuatro llevan los **nombres de autor en los metadatos**, así que entran en la misma
> operación aunque el dato grave esté sólo en el primero.

### ⭐ Cuántas ramas lo arrastran — y por qué es mejor noticia de lo que parecía

Un objeto de Git **no se purga mientras siga siendo alcanzable desde cualquier ref**. Medido con el
historial **completo** (ver el aviso de §5):

- **65 ramas remotas** contienen `bff9653d`, de 223.
- ⭐ **63 de esas 65 ya están contenidas en `prueba`**: son ramas de trabajo ya integradas, y **borrarlas
  no pierde nada**.
- **Sólo 2 tienen trabajo que no está en `prueba`**, y hay que tratarlas aparte:
  - `origin/tarea/propuesta-facturacion-cfdi` — es el **PR #338**, abierto y vivo.
  - `origin/trabajo/el-impreso-por-lote-sin-reventar` — la fila **0.140**, suspendida por Daniel con el
    trabajo comiteado sin terminar.
- Y **`refs/pull/287/head`**, que **sobrevive aunque la rama se borre** y hay que nombrárselo a Support
  explícitamente.

---

## 3. El orden de las operaciones (y por qué ese orden)

> 🔴 **Pedirle el purgado a Support ANTES de que las refs dejen de apuntar a ese commit no puede
> funcionar: no habría nada que purgar.** Éste es el error que este documento existe para evitar.

1. **Poner el repositorio en PRIVADO.** Ya decidido por Daniel el 3-sep. **No espera a nada.** Es lo
   único inmediato, y lo único que corta la exposición mientras el resto se ejecuta.
2. **Decidir si los cinco archivos se retiran del tip de `prueba`.** Quitarlos del tip **no arregla el
   historial** —por eso no se hizo el 3-sep—, pero es condición para el paso 3. *(Si se retiran, el
   `README.md` de esa carpeta se queda: es el aviso, y explica por qué no están.)*
3. **Reescribir el historial** para que `bff9653d` deje de contener los blobs, y **borrar las 63 ramas
   remotas ya integradas** que lo arrastran. Las 2 vivas se rebasan o se rehacen sobre el historial nuevo.
   ⚠️ Esto reescribe `prueba`: **toda sesión y todo clon abiertos quedan obsoletos** y hay que avisar antes.
4. **Sólo entonces, pedir el purgado a GitHub Support**, nombrando `bff9653d`, los cinco SHAs de blob y
   `refs/pull/287/head`.
5. **Volver a medir** con los comandos de §5 y dejar el resultado escrito **aquí**.

---

## 4. Borrador del mensaje a GitHub Support

> Asunto: **Request to purge sensitive blobs from repository history (GDPR/personal data)**
>
> Repository: `DanFrModa/Respaldo-Control-CLAUDE`
>
> Five `.xlsx` files containing personal data (full names of individuals next to the amounts paid to
> them, plus real author names in the document metadata) were committed by mistake. They were introduced
> by a single commit, **`bff9653d`**, and have been removed from the branch history on our side.
>
> We are asking you to **purge the following blob objects** so they are no longer reachable through the
> API or through cached views:
>
> - `f5e719c2468d3f47861ce23c865b20d5e920640b`
> - `da2b24dabfac70548109dae6ba0ed621a3316bf2`
> - `16679bb16a6d94eab8b274b4e77633cf987ee000`
> - `38b06ea567e015ce9617230bd09a7ee17fe1d36e`
> - `057e1ff1561cd21fb9a8732e4c6714408fba2c6d`
>
> Please note the objects are also reachable through **`refs/pull/287/head`**, which survives the
> deletion of the pull request branch; that ref needs to be purged as well.
>
> The commit and the branches that referenced it have already been rewritten/removed on our side.

*(Enviarlo **después** del paso 3, no antes. Y no adjuntar los archivos al ticket: es exactamente lo que
el `README.md` de la carpeta prohíbe.)*

---

## 5. Lo que NO hay que hacer

- ❌ **No medir esto en un clon `shallow`.** El entorno de las sesiones remotas clona **en shallow**
  (`git rev-parse --is-shallow-repository` → `true`), y en un clon truncado
  `git merge-base --is-ancestor` y `git branch --contains` **dan respuestas equivocadas sin avisar**:
  en el primer intento de hoy, `bff9653d` salía como **NO ancestro de `prueba`** —lo contrario de la
  verdad—. **Antes de medir:** `git fetch --unshallow origin` (tarda unos minutos).
- ❌ **No borrar los archivos del tip creyendo que eso resuelve algo.** El historial y
  `refs/pull/287/head` quedan igual.
- ❌ **No pedir el purgado antes del paso 3.**
- ❌ **No reenviar, adjuntar ni copiar los archivos fuera de su carpeta**, ni siquiera a un ticket.

### Comandos para volver a medirlo (todo lo de este documento sale de aquí)

```bash
git fetch --unshallow origin          # imprescindible: en shallow las respuestas mienten
git log --all --oneline --find-object=f5e719c2468d3f47861ce23c865b20d5e920640b
git merge-base --is-ancestor bff9653d origin/prueba && echo "prueba lo arrastra"
git merge-base --is-ancestor bff9653d origin/main   && echo "main lo arrastra"
git ls-tree -r origin/prueba Documentacion_MJD/archivos-de-referencia/
git branch -r --contains bff9653d | wc -l
```

---

## 6. Lo que sigue esperando a Daniel (y NO bloquea poner el repo en privado)

Tres decisiones sobre **qué dato personal cabe en un repositorio público**, las tres levantadas por el
reviewer el 3-sep y ninguna archivada. Mientras esperan, los cuatro datos **siguen vivos en el tip de
`prueba`** — que es lo correcto, porque nadie ha decidido quitarlos:

| | Decisión | Recomendación del reviewer |
|---|---|---|
| **(a)** | Los **tres alias de proveedor persona física** que quedan pegados a información de pago (están nombrados en la fila 0.123 de `HOJA-DE-RUTA.md`; **no se repiten aquí a propósito** — republicarlos en el documento que existe para retirarlos sería el mismo defecto con otra ropa) | **seudonimizarlos** |
| **(b)** | Los **nombres de pila de empleadas con una valoración de desempeño** («las inconsistencias son errores de …»), cita textual de Daniel pero que identifica a una persona real | sustituir por el **rol**: «el capturista», «finanzas» |
| **(c)** | Si al citar un archivo se puede **nombrar a quien lo manda** | — |

> 🔑 **La regla que dejó la fila, y que este documento aplica a sí mismo:** *un dato personal se quita del
> **archivo**, no del texto; un `.xlsx` es un ZIP de XML y hay que mirar **celdas y metadatos**; y una
> limpieza que no se puede **volver a correr** no es una limpieza, es una afirmación.*
