# Módulo Modelos — Cómo quedó construido (F1-E4/E5/E7)

> Referencia funcional: `Documentacion_MJD/01-Modelos.md` (no se duplica aquí — ADR-0002).

## Entidades y tablas de BD

| Entidad v2 | Tabla BD | Descripción |
|---|---|---|
| `Modelo` | `modelos` | Catálogo de productos (código único global, ADR-0007). Nace activo. Descontinuable (borrado suave). Desde **V1-E3n** lleva `origen` (desarrollo/producción), `codigoDesarrollo` y `numeroProduccion` — ver §Nomenclatura. |
| `SecuenciaGlobal` | `secuencias_globales` | Contador atómico SIN empresa (A3) para las numeraciones de los catálogos globales; hoy la del consecutivo de DESARROLLO por cliente+año+par. |
| `ModeloFoto` | `modelo_foto` | N fotos por modelo (tipo FRENTE/ESPALDA/OTRO + orden). |
| `Archivo` | `archivos` | Registro de cada foto en R2 (bucket, key, metadatos). |
| `ModeloTela` | `modelo_tela` | Renglones BOM de tela (consumo + 3 banderas). PK compuesta (idModelo, idTela). |
| `ModeloAvio` | `modelo_avio` | Renglones BOM de avío (consumo + 3 banderas). PK compuesta (idModelo, idAvio). |
| `ModeloArte` | `modelo_arte` | **ARTE del modelo** (V1-E3d, §Post-F9.35): nombre, tipo, puntadas, precio (el que viaja a la OP), proveedor y foto. Hijo del modelo, ya NO un puente a un catálogo. `nombre` único dentro del modelo; `precio` nullable en BD (histórico migrado). |

## Mapeo producido por E7

| `entidad` en MapeoMigracion | Descripción |
|---|---|
| `Modelo` | `IdModelos` viejo → `id` de `Modelo` en v2 |

Consumido por: F2 (Pedidos), F3 (Producción), F4 (Compras/MRP), F7 (Costos), F8 (Desarrollo y Cotización) y F9 (Finanzas).

## Nomenclatura: DESARROLLO vs. PRODUCCIÓN (V1-E3n — §Post-F9.34 / §Post-F9.46 / §Post-F9.83)

Un modelo puede tener **DOS números**, y la tabla es una sola (lo que se separa es la marca y la
numeración, no la entidad: BOM, arte, fotos y precosteo cuelgan del `id`, que nunca cambia).

| Campo | Qué es |
|---|---|
| `codigo` | El código **VIGENTE**, el que se enseña en toda pantalla e impreso. Único global. |
| `codigoDesarrollo` | El `CYA-26-71-001`, **congelado al nacer**. Se CONSERVA tras pasar a producción (D3) y es buscable. |
| `numeroProduccion` | El entero de 5 dígitos (`71001`). Se guarda aparte del texto para que el generador razone por (concepto, género) sin parsear. |
| `origen` | `desarrollo` mientras vive fuera del catálogo de producción; `produccion` en cuanto se le asigna su número. |

**Producción — 5 dígitos: concepto + género + consecutivo.** Los dos primeros son FIJOS y el consecutivo
corre por ese par, con tope de **999 por par** (§Post-F9.83). Los dígitos son DATOS del catálogo
(`TipoProducto.digitoConcepto`, `Genero.digitoNomenclatura`), no constantes en el código;
`Genero.digitoAlterno` es la continuación del género cuando su serie se agota — hoy sólo Caballero (1→5).

**Dónde se captura el dígito.** El del **concepto** vive en *Calidad › Tipos de producto*, junto al
nombre del tipo: es **único entre los tipos ACTIVOS** (dos conceptos con el mismo dígito se repartirían
la misma serie de 999), lo valida el dominio y lo respalda un **índice único parcial**
(`WHERE activo AND digito_concepto IS NOT NULL`). Un tipo desactivado libera su dígito; reactivarlo con
el dígito ya tomado se rechaza. Los nueve conceptos de la tabla de Daniel vienen sembrados
(2 Conjunto · 3 Short · 4 Vestido · 5 Playera · 6 Sudadera · 7 Pantalón · 8 Chamarra · 9 Gorra; el 0 y el
1 no se usan). El del **género** viene del seed y **todavía no tiene pantalla** (`Genero` es catálogo
selector sin ABM desde F1): un género nuevo nace sin dígito y el generador lo dice con su nombre.

**Desarrollo — `CYA-26-71-001`** = abreviatura del cliente (`Cliente.abreviatura`) + año de **ENTREGA** +
los mismos dos dígitos + consecutivo que reinicia por `cliente + año + par`. Lo arma el sistema ENTERO
(`mintearCodigoDesarrollo`) y **no consume** consecutivo de producción.

**⚠️ Por qué el consecutivo de producción NO sale de una secuencia.** A3 manda folios por secuencia
atómica y el de desarrollo lo cumple (`siguienteFolioGlobal`). El de producción no puede: son 30 años de
numeración hecha a mano, hueca y **ya topada** — el par `51` del Access tiene 535 usados de 999 **con el
999 ocupado**. Una secuencia propondría `1000`, que no existe. La propuesta es el **hueco libre más bajo**
del par, calculada dentro de un `pg_advisory_xact_lock` del par (namespace 20_546); el `@unique` de
`codigo`/`numeroProduccion` es la última red. Todo vive en `backend/src/dominio/modelos/nomenclatura.ts`.
La desviación de A3 —dónde aplica, dónde NO, y las mediciones de concurrencia que la respaldan— está en
**`docs/arquitectura/ADR-0018`**.

**Pasar a producción** (`pasarModeloAProduccion`, y también dentro de `salidaAProduccion` al generar la
OP): el número llega **precargado** con el hueco libre y **es editable** (§Post-F9.46). Repetido
**bloquea**; dígitos que no cuadran con el tipo/género y serie cerca del tope **avisan sin bloquear**.

## Decisiones de diseño

### Temporadas — modelos sin temporada

El CSV viejo `Temporadas.csv` estaba **vacío** (E6 lo verificó). Todos los registros de `Modelos.csv` tienen `IdTemporadas=0`. Decisión del dueño: **los modelos se cargan SIN temporada**. Se reporta como incidencia en el reporte de cuadre (no null silencioso, §7). Las temporadas podrán asignarse manualmente desde la UI una vez que se definan.

### Composición textil — vive en el MODELO (Daniel, 24-jul-2026)

`Modelo.composicion` (TEXT nullable, migración `20260724120000_modelo_composicion`) es la **fuente
única** de la composición. Decisión textual de Daniel: _«La composición no sale de la OC del cliente.
Sale de la información del desarrollo del modelo. De ahí la jala.»_

- Toda **orden** de ese modelo **hereda** `Modelo.composicion` al nacer (`Orden.compForzada = false`).
- En una orden puntual se puede **corregir a mano**: queda con **override** (`compForzada = true`) y
  ya no se pisa. Vaciar el campo de la orden la devuelve a la del modelo.
- La **re-derivación** ocurre solo donde la orden ya se está tocando (alta y guardado del encabezado)
  y solo si NO tiene override — nunca hay recálculo masivo de órdenes históricas al editar el modelo.
  El modelo de una OP no es editable, así que no hay caso de "cambió el modelo".
- 🔒 **Heredar nunca destruye un dato:** si el modelo no tiene composición y la orden sí, se conserva
  la de la orden (salvo que el usuario vacíe el campo a propósito). Sin ese guard, guardar el
  encabezado de una OP histórica la habría vaciado en silencio, porque `modelos.composicion` nació
  vacía. La migración de datos `20260724130000_ordenes_composicion_historica` marca además como
  override todo lo que ya estaba capturado en `ordenes` (venía del ETL o del importador de PDF: nunca
  derivó de una ficha de modelo).
- La lógica está en `resolverComposicion` (`backend/src/dominio/produccion/ordenes.ts`); el
  **importador de OC por PDF** ya no pisa la del modelo (solo la usa de respaldo si el modelo no tiene
  ninguna, marcándola como override). Detalle completo en `docs/cambios-frontend-daniel.md` (2026-07-24).

### ¿La prenda LLEVA arte? — `Modelo.llevaArte` (Daniel, 26-jul-2026)

`Modelo.llevaArte` (BOOL NOT NULL **default `true`**, migración `20260726120000_modelo_lleva_arte`)
dice si la prenda lleva bordado/estampado. Decisión textual de Daniel: _«por default sí lleva. A
menos que la marques como que no lleva. Y de esa manera si no meten la información del arte, o no
desmarcan la casilla, está como incompleto. Es decir, siempre hay que atender ese tema.»_
(`DECISIONES.md §Post-F9.4`).

- Es el **requisito ARTE del estado automático de la orden**
  (`backend/src/dominio/produccion/requisitos-orden.ts`): con `true`, las órdenes del modelo NO se
  completan hasta que el BOM tenga su arte; con `false`, el arte no aplica.
- **Default `true` también para los ~miles de modelos migrados**, a propósito: el tema se atiende
  siempre. Efecto querido: muchas órdenes vivas quedan incompletas hasta capturar el arte o
  desmarcar la casilla. El estado es **informativo** — no impide operar la orden.
- **Desmarcarla recalcula** las órdenes de ese modelo en la misma transacción (`actualizarModelo` →
  `recalcularEstadoOrdenesDeModelo`), y como todo recálculo por catálogo **solo puede completar**.
- UI: casilla "Lleva arte (bordado o estampado)" en el alta/edición del modelo (sección Desarrollo)
  y el estado del arte en la ficha del detalle (*Lleva arte* / *Lleva arte — falta capturarlo* /
  *No lleva arte*).

### BOM — banderas `b*` → `para*`

Los CSV del BOM viejo usan banderas `bPreCosto`/`bProduccion`/`bCosto` (valores `0`/`1`). En v2 son `paraPreCosto`/`paraProduccion`/`paraCosto` (booleanos). La transformación es directa y está cubierta por unit tests en `etl-modelos-unit.test.ts`.

### ARTE — precio (V1-E3d)

`ModelosBor.csv` no tiene columna de precio (el viejo no lo guardaba por renglón). El ETL toma el
`Precio` del catálogo viejo (`Bordados.csv`) al crear el arte dentro del modelo — la MISMA cascada
que aplicaba el costeo (`ModeloBordado.precio ?? Bordado.precio`), para que el costo no se mueva.
`ModeloArte.precio` sigue **nullable en BD** (ADR-0009 — histórico que no traía precio); la UI lo
pide.

### Códigos duplicados

Si `Modelos.csv` contiene dos filas con el mismo código (`Modelo`), el segundo se omite con un `ErrorConflicto` reportado al cuadre. El primero gana. No se pierde silenciosamente: queda en el reporte de incidencias.

### Fotos — convención de nombres del viejo

El sistema viejo guardaba el NOMBRE DEL ARCHIVO de cada foto en los campos `Foto1` y `Foto2` del registro de modelo:
- `Foto1` = frente del modelo (frecuente: código del modelo).
- `Foto2` = espalda del modelo (frecuente: código + `-P`, p. ej. `51714-P`).

El ETL busca en `ETL_FOTOS_MOD_DIR` un archivo cuyo nombre-base (sin extensión) coincida case-insensitive con `Foto1`/`Foto2`. Si no encuentra el archivo, reporta la incidencia y continúa.

### Fotos — arte (completadas en E7)

El campo `Foto` de `Bordados.csv` no se cargó en E6. E7 lo completa usando `ETL_FOTOS_BOR_DIR`,
ligando la imagen a TODOS los artes que salieron de ese arte viejo: un arte compartido por varios
modelos se duplicó al migrar (§Post-F9.35) y las copias COMPARTEN el mismo `Archivo` (el objeto de
R2 se sube una vez; `archivos.key` es único). Por eso quitar la foto de un arte solo borra el
`Archivo` cuando ningún otro arte lo referencia.

Esa cuenta se hace **con la fila de `archivos` bloqueada** (`SELECT … FOR UPDATE` antes del
`count`, en `borrarArchivoSiQuedoHuerfano`). No es adorno: sin el candado, copiar un arte y quitar
su foto en paralelo podían cruzarse y dejar **la copia sin foto y su `Archivo` borrado** (el
`count` no ve el INSERT que aún no commitea, y el `ON DELETE SET NULL` de la FK hace el resto);
y dos quitados simultáneos dejaban la fila `Archivo` huérfana. El candado conflictúa con el
`FOR KEY SHARE` que toma el INSERT y serializa ambos casos. Los tres caminos que borran arte —
quitar la foto, eliminar el arte y **copiar la receta con reemplazo** (`bom-modelo.ts`)— pasan por
la misma función.

### Foto principal y arte principal (Daniel, 25-jul-2026)

El modelo tiene **una foto principal** ("la más importante") y **un arte principal**. La regla es:
**principal = el PRIMERO**, y punto. No hay bandera `esPrincipal` en ninguna tabla — la única fuente
de verdad es el orden (`ModeloFoto.orden`, que ya existía, y `ModeloArte.orden`, heredado de la
migración `20260725130000_modelo_bordado_orden`) — así es imposible que una bandera contradiga al
orden de despliegue. Por default es la primera, sin que nadie tenga que marcar nada.

- **Marcarla** = mover ese renglón al lugar 0 y reindexar los demás 0..N-1 conservando su orden
  relativo, en UNA transacción con bitácora (`marcarFotoPrincipal` en `dominio/modelos/fotos-modelo.ts`
  y `marcarArtePrincipal` en `arte-modelo.ts`; el cálculo puro y compartido vive en
  `dominio/modelos/orden-principal.ts`). Es **idempotente**: repetirla no escribe nada.
- **Permisos:** `modelos.administrar` (el mismo de editar el modelo/BOM; sin permisos nuevos).
- **Endpoints:** `POST /api/modelos/:id/fotos/:idFoto/principal` y
  `POST /api/modelos/:id/artes/:idArte/principal` (ambos devuelven la lista ya reordenada).
- **Lecturas ordenadas:** las fotos por `orden, id`; el arte por `orden, nombre, id`
  (el desempate por nombre deja el histórico —todo en `orden` 0— exactamente como se listaba antes).
- **Concurrencia:** el reindexado es leer-calcular-escribir, así que ambas operaciones toman un
  `pg_advisory_xact_lock(namespace, idModelo)` como primer paso de la transacción (namespaces 20 543
  fotos / 20 544 arte). Sin él, dos marcados simultáneos del mismo modelo dejarían `orden` duplicado
  y, con el desempate, la principal equivocada (lost update bajo READ COMMITTED).
- **No se desbanca solo:** los artes nuevos entran con el `orden` siguiente al
  máximo (nunca en 0), en el orden en que se capturan; al copiar el BOM,
  reemplazar conserva el orden del origen y fusionar deja lo copiado detrás de lo que el destino ya
  tenía.
- **Captura sin guardar:** en el frontend, "Marcar como principal" del arte recarga la ficha (y con
  ella las tres pestañas del editor de receta), así que la acción se **deshabilita con aviso**
  mientras haya cambios sin guardar — antes borraba la captura en curso con un toast de éxito.
- **En el impreso de la orden** las dos principales encabezan su bloque y **nunca las recorta** el
  tope (ver `docs/modulos/impreso-orden.md`).

### Funciones diferidas

- **Generar listas de precios** (`GenerarLista` del viejo) → diferido a **F7** (Costos/Precios).
- **Consultar PreCostos** → diferido a **F7**.
- **Primeras/Segundas** (calidad de PT) → diferido a **F3** (Inventario PT); el modelo actual no gestiona calidad de unidades.

## Cómo correr el ETL de modelos (E7)

```bash
# Variables requeridas
export DATABASE_URL="postgresql://..."

# Variables opcionales — si no están, las fotos se saltan con aviso
export ETL_FOTOS_MOD_DIR="/ruta/absoluta/a/fotos/de/modelos"   # ~9,000 archivos
export ETL_FOTOS_BOR_DIR="/ruta/absoluta/a/fotos/del/arte"     # ~2,686 archivos

# Variables R2 — solo requeridas si se cargan fotos
export R2_ACCOUNT_ID="..."
export R2_ACCESS_KEY_ID="..."
export R2_SECRET_ACCESS_KEY="..."
export R2_BUCKET="control-v2-prueba"  # o control-v2-prod

# PRIMERO correr E6 (catálogos) — E7 depende de sus mapeos
npm run etl:catalogos

# ETL completo de E7: modelos + BOM + fotos (si están configuradas)
npm run etl:modelos

# Solo fotos de modelos (re-ejecutable si ya corrió etl:modelos)
npm run etl:fotos-modelos

# Solo fotos del arte
npm run etl:fotos-arte

# Cuadre completo de la fase F1 (E6+E7) — solo cuenta, no carga
npm run etl:cuadre-fase
```

## Idempotencia

Todos los loaders son re-ejecutables:
- **Modelos:** la clave de idempotencia es `MapeoMigracion.claveVieja` (`IdModelos`). Si ya existe, se salta.
- **BOM:** el dominio usa "set-completo" (diff agrega/quita/actualiza). Re-ejecutar produce el mismo estado.
- **Fotos de modelos:** se salta si ya existe un `ModeloFoto` de tipo FRENTE/ESPALDA con key `modelos/<id>/etl-*`.
- **Fotos del arte:** se salta los artes que ya tienen `idArchivoFoto` no null.

## Estructura de keys en R2

```
modelos/<idModelo>/etl-<uuid>/<nombre-saneado>.<ext>   → fotos de modelos (migración)
modelos/<idModelo>/<uuid>/<nombre-saneado>.<ext>        → fotos subidas por la UI
modelo-arte/etl-<uuid>/<nombre-saneado>.<ext>           → fotos del arte (migración)
modelo-arte/<idArte>/<uuid>/<nombre-saneado>.<ext>      → fotos del arte (UI)
```

El prefijo `etl-` en el UUID distingue las fotos migradas de las subidas por UI, para la idempotencia del ETL.
