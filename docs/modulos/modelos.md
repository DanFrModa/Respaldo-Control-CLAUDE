# Módulo Modelos — Cómo quedó construido (F1-E4/E5/E7)

> Referencia funcional: `Documentacion_MJD/01-Modelos.md` (no se duplica aquí — ADR-0002).

## Entidades y tablas de BD

| Entidad v2 | Tabla BD | Descripción |
|---|---|---|
| `Modelo` | `modelos` | Catálogo de productos (código único global, ADR-0007). Nace activo. Descontinuable (borrado suave). |
| `ModeloFoto` | `modelo_foto` | N fotos por modelo (tipo FRENTE/ESPALDA/OTRO + orden). |
| `Archivo` | `archivos` | Registro de cada foto en R2 (bucket, key, metadatos). |
| `ModeloTela` | `modelo_tela` | Renglones BOM de tela (consumo + 3 banderas). PK compuesta (idModelo, idTela). |
| `ModeloAvio` | `modelo_avio` | Renglones BOM de avío (consumo + 3 banderas). PK compuesta (idModelo, idAvio). |
| `ModeloBordado` | `modelo_bordado` | Renglones BOM de bordado (precio nullable). PK compuesta (idModelo, idBordado). |

## Mapeo producido por E7

| `entidad` en MapeoMigracion | Descripción |
|---|---|
| `Modelo` | `IdModelos` viejo → `id` de `Modelo` en v2 |

Consumido por: F2 (Pedidos), F3 (Producción), F4 (Compras/MRP), F7 (Costos), F8 (Desarrollo y Cotización) y F9 (Finanzas).

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

### BOM — banderas `b*` → `para*`

Los CSV del BOM viejo usan banderas `bPreCosto`/`bProduccion`/`bCosto` (valores `0`/`1`). En v2 son `paraPreCosto`/`paraProduccion`/`paraCosto` (booleanos). La transformación es directa y está cubierta por unit tests en `etl-modelos-unit.test.ts`.

### BOM — precio de bordados

`ModelosBor.csv` no tiene columna de precio (el viejo no lo guardaba por renglón). En v2 `ModeloBordado.precio` es **nullable en BD** (ADR-0009 — relajado para el ETL). La UI lo exige y lo pre-llena con `Bordado.precio` (editable). Esto es intencional y documentado.

### Códigos duplicados

Si `Modelos.csv` contiene dos filas con el mismo código (`Modelo`), el segundo se omite con un `ErrorConflicto` reportado al cuadre. El primero gana. No se pierde silenciosamente: queda en el reporte de incidencias.

### Fotos — convención de nombres del viejo

El sistema viejo guardaba el NOMBRE DEL ARCHIVO de cada foto en los campos `Foto1` y `Foto2` del registro de modelo:
- `Foto1` = frente del modelo (frecuente: código del modelo).
- `Foto2` = espalda del modelo (frecuente: código + `-P`, p. ej. `51714-P`).

El ETL busca en `ETL_FOTOS_MOD_DIR` un archivo cuyo nombre-base (sin extensión) coincida case-insensitive con `Foto1`/`Foto2`. Si no encuentra el archivo, reporta la incidencia y continúa.

### Fotos — bordados (completadas en E7)

El ETL de E6 cargó el CATÁLOGO de bordados pero NO las fotos (campo `Foto` de `Bordados.csv`). E7 completa las fotos usando `ETL_FOTOS_BOR_DIR`.

### Foto principal y arte principal (Daniel, 25-jul-2026)

El modelo tiene **una foto principal** ("la más importante") y **un arte principal**. La regla es:
**principal = el PRIMERO**, y punto. No hay bandera `esPrincipal` en ninguna tabla — la única fuente
de verdad es el orden (`ModeloFoto.orden`, que ya existía, y `ModeloBordado.orden`, agregado en la
migración `20260725130000_modelo_bordado_orden`) — así es imposible que una bandera contradiga al
orden de despliegue. Por default es la primera, sin que nadie tenga que marcar nada.

- **Marcarla** = mover ese renglón al lugar 0 y reindexar los demás 0..N-1 conservando su orden
  relativo, en UNA transacción con bitácora (`marcarFotoPrincipal` en `dominio/modelos/fotos-modelo.ts`
  y `marcarBordadoPrincipal` en `bom-modelo.ts`; el cálculo puro y compartido vive en
  `dominio/modelos/orden-principal.ts`). Es **idempotente**: repetirla no escribe nada.
- **Permisos:** `modelos.administrar` (el mismo de editar el modelo/BOM; sin permisos nuevos).
- **Endpoints:** `POST /api/modelos/:id/fotos/:idFoto/principal` y
  `POST /api/modelos/:id/bom/bordados/:idBordado/principal` (ambos devuelven la lista ya reordenada).
- **Lecturas ordenadas:** las fotos por `orden, id`; el arte del BOM por `orden, nombre, idBordado`
  (el desempate por nombre deja el histórico —todo en `orden` 0— exactamente como se listaba antes).
- **Concurrencia:** el reindexado es leer-calcular-escribir, así que ambas operaciones toman un
  `pg_advisory_xact_lock(namespace, idModelo)` como primer paso de la transacción (namespaces 20 543
  fotos / 20 544 arte). Sin él, dos marcados simultáneos del mismo modelo dejarían `orden` duplicado
  y, con el desempate, la principal equivocada (lost update bajo READ COMMITTED).
- **No se desbanca solo:** al guardar la receta, los artes nuevos entran con el `orden` siguiente al
  máximo (nunca en 0) y entre ellos conservan el orden del cuerpo enviado; al copiar el BOM,
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
export ETL_FOTOS_BOR_DIR="/ruta/absoluta/a/fotos/de/bordados"  # ~2,686 archivos

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

# Solo fotos de bordados
npm run etl:fotos-bordados

# Cuadre completo de la fase F1 (E6+E7) — solo cuenta, no carga
npm run etl:cuadre-fase
```

## Idempotencia

Todos los loaders son re-ejecutables:
- **Modelos:** la clave de idempotencia es `MapeoMigracion.claveVieja` (`IdModelos`). Si ya existe, se salta.
- **BOM:** el dominio usa "set-completo" (diff agrega/quita/actualiza). Re-ejecutar produce el mismo estado.
- **Fotos de modelos:** se salta si ya existe un `ModeloFoto` de tipo FRENTE/ESPALDA con key `modelos/<id>/etl-*`.
- **Fotos de bordados:** se salta si el bordado ya tiene `idArchivoFoto` no null.

## Estructura de keys en R2

```
modelos/<idModelo>/etl-<uuid>/<nombre-saneado>.<ext>   → fotos de modelos (migración)
modelos/<idModelo>/<uuid>/<nombre-saneado>.<ext>        → fotos subidas por la UI
bordados/etl-<uuid>/<nombre-saneado>.<ext>              → fotos de bordados (migración)
bordados/<uuid>/<nombre-saneado>.<ext>                  → fotos de bordados (UI)
```

El prefijo `etl-` en el UUID distingue las fotos migradas de las subidas por UI, para la idempotencia del ETL.
