# Módulo Catálogos — Cómo quedó construido (F1-E1/E2/E3/E6)

> Referencia funcional: `Documentacion_MJD/` (no se duplica aquí — ADR-0002).

## Entidades del catálogo y tablas de BD

| Entidad v2 | Tablas v2 | Fuente (CSV viejo) | Etapa |
|---|---|---|---|
| Empresa | `empresas` | `Empresas.csv` | F1-E1 |
| Cliente | `clientes`, `cliente_campo` | `Clientes.csv` | F1-E2 |
| EtiquetaMarca | `etiquetas_marca` | `EtiquetasM.csv` | F1-E1 |
| Genero | `generos` | `IPT_Generos.csv` | F1-E1 |
| Temporada | `temporadas` | `Temporadas.csv` (vacío) | F1-E1 |
| TelaCategoria | `telas_categorias` | `TelasCategorias.csv` | F1-E1 |
| Proveedor (fusión) | `proveedores`, `proveedor_rol`, `proveedor_archivo` | `Proveedores.csv`+`Cortadores.csv`+`Maquileros.csv`+`Estampadores.csv` | F1-E1B/E2 |
| Almacen | `almacenes` | `IPT_Almacenes.csv`+`Almacenes.csv` | F1-E2 |
| Bordado | `bordados`, `archivos` | `Bordados.csv` (fotos: E7) | F1-E3 |
| Avio (habilitación) | `avios`, `avio_proveedor` | `Habilitacion.csv` | F1-E3 |
| Color | `colores` | texto libre normalizado de `TelasColores.csv` | F1-E6 |
| Tela | `telas`, `telas_colores` | `Telas.csv`+`TelasDis.csv` (unificadas, D5) | F1-E3/E6 · reestructura A1 (§Post-F9.11) |
| ComposicionTela | `composiciones_tela` | — (catálogo NUEVO, sin ETL: se captura a mano) | Telas A1 (6-ago-2026) |
| Talla / CurvaTalla | `tallas`, `curvas_talla` | derivadas de `Ordenes.Tallas` | F1-E2 |

## Decisiones de diseño (ver también `DECISIONES.md`)

- **D4 Tallas ilimitadas:** columnas `T1..T8` del viejo → tabla `Talla` + tabla pivot `CurvaTalla`.
- **D5 Telas unificadas:** `Telas` y `TelasDis` del viejo eran la misma entidad desdoblada. En v2 hay UNA tabla `Tela`. La llave de unificación es el nombre normalizado (ADR-0009). Las `TelasDis` sin match en `Telas` se crean como `Tela` propia y se reportan.
- **D7 Clientes con campos extra:** el campo `Monarch` (referencia del cliente) se generaliza a `ClienteCampo` (N campos configurables por cliente). El valor real se migra en F2/F10; aquí solo la DEFINICIÓN.
- **Fusión de terceros (R15):** los 4 catálogos del viejo (`Proveedores/Cortadores/Maquileros/Estampadores`) se fusionan en UNA tabla `Proveedor` con N roles. Los homónimos se fusionan y se reportan al cuadre.
- **Temporadas:** la fuente `Temporadas.csv` está VACÍA. Los modelos tienen `IdTemporadas=0` → se cargan sin temporada (decisión del dueño). Reportado como incidencia en el cuadre E7.
- **Catálogos globales (A9/ADR-0007):** todos los catálogos de F1 son GLOBALES (sin `idEmpresa`).

## Mapeos producidos por E6 (tabla `MapeoMigracion`)

| `entidad` en MapeoMigracion | Descripción |
|---|---|
| `Color` | texto normalizado → `id` de `Color` |
| `Cliente` | `IdClientes` → `id` de `Cliente` |
| `EtiquetaMarca` | `IdEtiquetasM` → `id` |
| `Bordado` | `IdBordados` → `id` |
| `Avio` | `IdHabilitacion` → `id` |
| `Genero` | `IdGeneros` → `id` |
| `Temporada` | (vacío) |
| `TelaCategoria` | `IdTelasCategorias` → `id` |
| `Empresa` | `IdEmpresas` → `id` |
| `Tela:IdTelas` | `IdTelas` de `Telas.csv` → `id` unificado de `Tela` |
| `Tela:IdTelasDis` | `IdTelasDis` de `TelasDis.csv` → `id` unificado de `Tela` |
| `Proveedor:IdProveedor` | `IdProveedor` → `id` de `Proveedor` |
| `Proveedor:IdMaquileros` | `IdMaquileros` → `id` de `Proveedor` |
| `Proveedor:IdEstampadores` | `IdEstampadores` → `id` de `Proveedor` |
| `Proveedor:IdCortadores` | `IdCortadores` → `id` de `Proveedor` |
| `Almacen:IPT` | `IdIPTAlmacenes` → `id` de `Almacen` |
| `Almacen:Tela` | `IdAlmacenes` → `id` de `Almacen` |

## Cómo correr el ETL de catálogos

```bash
# Variables requeridas
export DATABASE_URL="postgresql://..."
# Apuntar a los CSV del sistema viejo (por defecto: Respaldo CLAUDE/TABLAS/ en la raíz del repo)
export TABLAS_DIR="/ruta/a/Respaldo CLAUDE/TABLAS"   # opcional

# Cargar catálogos y materiales (E6)
npm run etl:catalogos

# Solo el cuadre de E6 (no carga nada)
npm run etl:cuadre

# Cuadre completo de la fase F1 (E6+E7)
npm run etl:cuadre-fase
```

## Colores — fusión y variantes A/B

Los colores en el sistema viejo son texto libre en `TelasColores.Nombre`. El ETL:
1. Normaliza el nombre (minúsculas, sin acentos, colapsa espacios).
2. Si el nombre normalizado termina en ` a` o ` b`, detecta una variante (el mismo color con dos acabados). Se crean dos colores: `Color A` y `Color B`, y se reportan como incidencia A/B.
3. Los colores ya existentes (por nombre normalizado) se reusan sin duplicar.
