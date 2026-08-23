# ADR-0018 — El consecutivo del nº de PRODUCCIÓN no sale de una secuencia: hueco libre bajo advisory lock

- **Estado:** Aceptado
- **Fecha:** 2026-08-20
- **Decisores:** el lead de **V1-E3n**, con la regla de negocio dictada por **Daniel**
  (`Documentacion_MJD/DECISIONES.md` **§Post-F9.34**, **§Post-F9.46** y **§Post-F9.83**: *"el concepto
  y género van FIJOS y los consecutivos disponibles son los otros 3"*).
- **Ámbito:** `backend/src/dominio/modelos/nomenclatura.ts` — la asignación del nº de producción de
  un modelo (5 dígitos: concepto + género + consecutivo). **NO** afecta a ningún otro folio del
  sistema.

## Contexto

**A3 es innegociable y dice:** los folios de negocio salen de una **secuencia atómica**, JAMÁS de
`Max()+1` (PLANMAESTRO §4; el sistema viejo numeraba con `Max()+1` y dos capturas simultáneas se
pisaban). El repo lo cumple en todos lados con `comun/secuencias.ts` (`siguienteFolio`,
`reservarBloqueFolios`), un `INSERT … ON CONFLICT … DO UPDATE … RETURNING` sobre la tabla
`Secuencia`.

V1-E3n construye §Post-F9.34: el modelo de producción se numera con **5 dígitos** = concepto (tipo
de prenda) + género + **consecutivo de 3 dígitos**, y **el consecutivo corre por la pareja
concepto+género**, con un techo de **999 por par**.

**El dato que cambió el diseño.** Se midieron los **4,987 modelos** del Access (`Modelos.csv`, CP850):

| | |
|---|---|
| Códigos numéricos de 5 dígitos | **4,702** (los otros 285 son variantes: `51783a`, `71240-1`, `M-18`) |
| Pares distintos en uso | 61 |
| Par `51` (playera caballero) | **535 usados de 999** — y el **999 YA ESTÁ OCUPADO** |
| Pares con el 999 tomado | `20`, `30`, `39`, `51`, `73`, `74` |

O sea: **son 30 años de numeración hecha a mano, hueca y ya topada.** No es una serie que avance de
uno en uno; es un espacio de 999 casillas parcialmente lleno, con los huecos repartidos y el techo
alcanzado en seis pares.

Una secuencia **sólo sabe avanzar**. Sembrada en el máximo del par `51` propondría **`1000`** —que
no es un código de modelo válido— y dejaría **464 casillas libres inalcanzables** para siempre. No es
un detalle de afinación: es que la herramienta no modela el problema.

## Decisión

**El consecutivo de PRODUCCIÓN se calcula como el HUECO LIBRE MÁS BAJO del par, dentro de un
`pg_advisory_xact_lock` tomado sobre ese par antes de mirar la ocupación.** El consecutivo de
**DESARROLLO** (`CYA-26-71-001`) **sí** es una secuencia atómica pura y A3 se cumple al pie de la
letra ahí.

```
promoverAProduccionNucleo(tx, …):
  1. pg_advisory_xact_lock(20_546, par)      ← PRIMERO: antes de leer nada
  2. leer la ocupación del par                (numero_produccion + el codigo textual)
  3. elegir el hueco libre más bajo (1…999)
  4. UPDATE del modelo                        ← dentro del MISMO lock y la MISMA tx
```

### Por qué esto NO reintroduce el defecto que A3 prohíbe

Lo que A3 prohíbe no es "contar": es que **dos capturas simultáneas saquen el mismo folio y se
pisen**. Con el lock, "elegir el hueco" y "escribirlo" son **un solo hecho serializado** por par: la
segunda transacción espera al commit de la primera y ve la ocupación ya actualizada. La garantía
resultante es la misma que la de la secuencia — *jamás dos modelos con el mismo número* — sobre una
serie que la secuencia no sabe representar.

Y hay dos redes más abajo: el `@unique` de `Modelo.codigo` y el de `Modelo.numeroProduccion`, con
la carrera residual traducida a un **409** claro (no un P2002 crudo).

### Lo que se midió, no se razonó

- **20 promociones concurrentes del mismo par** → **20 números distintos**, exactamente `71001…71020`,
  **cero fallos**.
- **Las mismas 20 con el lock quitado** → **2 éxitos y 18 conflictos**. El lock es imprescindible; el
  `@unique` por sí solo no alcanza.
- **3 simultáneas sobre una serie hueca** (`71001`, `71003`, `71999` ocupados) → rellenan **002, 004 y
  005**: los tres huecos más bajos.

Estas tres viven en `src/dominio/modelos/nomenclatura.int.test.ts` y son el **candado del lock**:
mutarlo a `SELECT 1` las pone rojas. Sin ellas, el lock era una línea que un refactor podía borrar en
silencio con el resto de la suite en verde.

### Alcance: dónde SÍ y dónde NO aplica esta excepción

| | |
|---|---|
| ✅ **Aplica** | El consecutivo del nº de PRODUCCIÓN de un modelo, y **sólo ahí**. |
| ❌ **No aplica** | Cualquier otro folio del sistema (pedido, orden, OC, nota de salida, movimiento de kardex, movimiento de tercero, auditoría, inventario cíclico, proyecto…). Todos ésos son series **nuevas, densas y propias**, que arrancan en 1 y no comparten espacio con datos migrados: para ellos la secuencia atómica es la herramienta correcta y **A3 se aplica sin excepción**. |
| ❌ **Tampoco aplica** | El consecutivo de DESARROLLO (`CYA-26-71-001`): serie nueva por `cliente + año + par` → `siguienteFolioGlobal` sobre `secuencias_globales`. |

**La regla para el futuro:** un folio sólo puede salirse de A3 si (a) su espacio de numeración está
**acotado y pre-poblado** por datos que el sistema no generó, y (b) la alternativa ofrece la **misma
garantía de exclusión** *y viene con una prueba de concurrencia que la demuestre*. Si falta cualquiera
de las dos, se usa la secuencia.

### Alternativas descartadas

- **Secuencia sembrada en el máximo del par.** Propondría `1000` en seis pares desde el primer día y
  dejaría inalcanzables cientos de huecos. Rechazada por los datos, no por gusto.
- **Secuencia + "saltar los ocupados" hacia adelante.** Sigue sin poder volver a los huecos de abajo:
  quema la serie a marchas forzadas y llega al 999 con 400 casillas libres detrás.
- **Sólo el `@unique`, con reintento en el cliente.** Medido: 2 de 20 pasan. Convertiría una operación
  normal en un juego de reintentos, y el usuario vería conflictos donde no hay conflicto real.
- **`SELECT … FOR UPDATE` sobre una fila-candado por par.** Equivalente en garantía, pero exige una
  tabla de candados con una fila por par (72 filas de nada) y su propio mantenimiento. El advisory
  lock da lo mismo sin tabla y ya es el patrón de la casa (familia de namespaces 20_5xx).
- **Renumerar el histórico para densificar las series.** Rompe 30 años de trazabilidad de un catálogo
  que Daniel usa a diario. Ni se consideró en serio.

## Vuelta atrás

Si algún día el catálogo se renumerara y las series quedaran densas, `proponerNumeroProduccion` se
sustituye por `siguienteFolioGlobal('modelo-produccion-<par>')` sembrada con `sembrarSecuencia`, se
retira el lock y **se borran las dos pruebas de concurrencia** (que dejarían de tener sentido). Nada
más cambia: el resto del motor —dígitos, encadenamiento Caballero 1→5, avisos de tope y congruencia,
la promoción— no depende de cómo se obtiene el número.

## Referencias

- `Documentacion_MJD/DECISIONES.md` — §Post-F9.34 (nomenclatura y qué construir), §Post-F9.46 (el nº
  se precarga y es editable), §Post-F9.83 (concepto y género fijos, 999 por par).
- `PLANMAESTRO.md` §4 y MEJORAS **A3** (folios por secuencia atómica, nunca `Max()+1`).
- `backend/src/dominio/modelos/nomenclatura.ts` (el motor) y `backend/src/comun/secuencias.ts`
  (`siguienteFolioGlobal`, el lado que SÍ es A3 puro).
- `backend/src/dominio/modelos/nomenclatura.int.test.ts` — las pruebas de concurrencia del lock.
- `docs/modulos/modelos.md` §Nomenclatura · `docs/hoja-de-ruta/V1-etapas.md` §V1-E3n.
