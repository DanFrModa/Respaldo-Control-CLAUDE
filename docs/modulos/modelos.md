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

Consumido por: F2 (Pedidos), F4 (Producción), F9 (Finanzas).

## Decisiones de diseño

### Temporadas — modelos sin temporada

El CSV viejo `Temporadas.csv` estaba **vacío** (E6 lo verificó). Todos los registros de `Modelos.csv` tienen `IdTemporadas=0`. Decisión del dueño: **los modelos se cargan SIN temporada**. Se reporta como incidencia en el reporte de cuadre (no null silencioso, §7). Las temporadas podrán asignarse manualmente desde la UI una vez que se definan.

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
