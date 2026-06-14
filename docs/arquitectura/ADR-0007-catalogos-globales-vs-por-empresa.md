# ADR-0007 — Catálogos maestros globales; `idEmpresa` solo en lo operativo (A9)

- **Estado:** Aceptado
- **Fecha:** 2026-06-12
- **Decisores:** Gabriel (dueño de la ejecución; la decisión A9 le corresponde firmar — `HOJA-DE-RUTA.md` §6)

## Contexto

`MEJORAS.md` A9 fija **"multi-empresa explícito: `idEmpresa` en lo operativo; empresa activa
en sesión"**. La fase F1 (Catálogos) exige cerrar A9 **antes** de congelar el esquema, porque
condiciona el diseño de TODAS las tablas de la fase (`docs/hoja-de-ruta/F1-etapas.md`, F1-E1):
¿qué catálogos llevan `idEmpresa` (son por empresa) y cuáles son globales (compartidos)?

Hechos que pesan:

- **Hecho del negocio (aclarado por Gabriel, 2026-06-12):** hoy se opera **una sola empresa**
  (FR Moda SA de CV). El "Marilyn Fitness" que aparece como segunda empresa activa en el
  sistema viejo es la **misma empresa con su nombre anterior** — antes se llamaba Marilyn,
  ahora FR Moda — por eso comparten el mismo prefijo de código de barras (UPC `7500092`).
  **No son dos negocios en paralelo.** Aun así, el sistema debe quedar **abierto a N empresas**
  a futuro (capacidad ya presente desde F0; no se elimina ni se amarra a una).
- **Letra de A9:** dice `idEmpresa` en lo **operativo**. Los catálogos maestros (Proveedor,
  Color, Cortador, Temporada, Etiqueta de marca) no son "lo operativo": son referencia.
- **Sistema viejo:** esas tablas de catálogo **nunca estuvieron segmentadas por empresa**
  (eran tablas planas compartidas); la multi-empresa del viejo era para IPT/EDR, folios y el
  prefijo UPC, no para los catálogos.
- **Precedente F0:** `Almacen` SÍ lleva `idEmpresa` (nullable) con `@@unique([idEmpresa,
  nombre])`. Es la excepción correcta: un almacén es un recurso físico por empresa y su
  inventario también (D3). Es el patrón a copiar **si** algún catálogo necesitara ser por
  empresa.

## Decisión

1. **Los catálogos maestros de F1 son GLOBALES (sin `idEmpresa`):** Proveedor, Cortador,
   Temporada, Etiqueta de marca y Color se capturan una sola vez y los comparten todas las
   empresas. Unicidad de nombre **global** (`@unique` sobre `nombre`).
   > **Nota posterior (14-jun-2026):** `Cortador` (y `Maquilero` de F1-E2) se **fusionaron en `Proveedor`** con roles multi-valor — ya no son catálogos propios (fusión de terceros, D12/R15; ver `DECISIONES.md`). Lo de "globales sin `idEmpresa`" sigue vigente para los catálogos que quedan; `Cortador` aquí es solo el ejemplo histórico de cuando esta decisión se tomó.
2. **`idEmpresa` (A9) se reserva para lo operativo y los recursos físicos por empresa:**
   almacenes/inventario (ya en F0), secuencias de folios (ya en F0) y la operación de F2+
   (pedidos, órdenes, movimientos de kardex, EsMa, costos). Los catálogos maestros quedan
   fuera.
3. **La capacidad multi-empresa se mantiene** (N empresas); no se elimina ni se hardcodea a
   una sola.
4. **Reversibilidad por catálogo:** si en el futuro un catálogo concreto necesitara ser por
   empresa, se le agrega `idEmpresa` nullable siguiendo el patrón `Almacen` — los registros
   existentes quedan como globales (`idEmpresa = null`). No se rehace lo demás.

## Consecuencias

- (+) Sin duplicados ni recaptura: un proveedor/color/cortador se da de alta una vez.
- (+) Migración (F1-E6/E7) más simple: las tablas viejas eran compartidas → mapeo directo.
- (+) El BOM de Modelos (F1-E4) referencia catálogos globales sin ambigüedad de empresa.
- (+) E2–E4 diseñan sus esquemas con el criterio ya fijado (no se re-litiga en cada etapa).
- (−) La unicidad de nombre es global: dos empresas no podrían tener "su propio" proveedor
  homónimo con datos distintos. **Asumido** — no es el caso del negocio (opera una empresa).
- **Invalida un supuesto de la ficha F1:** las etapas E5/E6 asumían dar de alta "Marilyn
  Fitness" como segunda empresa. Al ser la misma que FR Moda, **NO se crea una segunda
  empresa**; se revisa la redacción de la ficha al arrancar E5/E6 (queda anotado).

## Alternativas consideradas

- **Todos por empresa (`idEmpresa` en cada catálogo):** aislamiento total, pero obliga a
  recapturar proveedores/colores en cada empresa, hace ambiguo el BOM y complica la
  migración. Descartada — el negocio opera una empresa y comparte todo.
- **Mixto (algunos globales, otros por empresa):** añade complejidad de diseño sin beneficio
  hoy. Descartada por innecesaria — y reversible por catálogo si hiciera falta (punto 4).

## Vuelta atrás

Agregar `idEmpresa` (nullable) a un catálogo es una migración **aditiva y segura**: los
registros existentes quedan como globales (`null`) y la unicidad pasa de `nombre` a
`[idEmpresa, nombre]`. No hay pérdida de datos ni reescritura de la operación.

## Referencias cruzadas

- `Documentacion_MJD/MEJORAS.md` A9 (multi-empresa explícito).
- `HOJA-DE-RUTA.md` §6 (A9 la firma Gabriel en F1-E1) y `docs/hoja-de-ruta/F1-etapas.md` (E1).
- ADR-0005 (precedente: el criterio es por **semántica del campo**, no por tabla).
- `backend/prisma/schema.prisma`, modelo `Almacen` (patrón "por empresa" a copiar si hiciera
  falta) y `Secuencia`.
