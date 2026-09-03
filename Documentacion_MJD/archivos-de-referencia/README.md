# Los archivos reales de Daniel — copias SIN datos sensibles

Estos cinco Excel son **los que Daniel usa hoy**, y son la fuente de verdad de cómo trabaja de verdad
—no de cómo lo cuenta—. Se guardan aquí porque **cada uno corrigió algo que ninguna conversación había
sacado** (el relato completo está en `DECISIONES.md` **§Post-F9.186**).

> 🔑 **La regla que dejaron:** *el proceso se puede contar; los **ERRORES** sólo aparecen en los datos.*

## ⚠️ Qué se les quitó, y por qué
Daniel eligió guardarlos **sin los datos sensibles** (3-sep-2026). Se retiraron por script y se verificó
después por otro barrido independiente:
- **Números de cuenta** (CLABE y tarjeta) — eran ~150.
- **Nombres de los beneficiarios** — personas reales, distintas del proveedor.
- **RFCs**, incluido el del nombre de archivo original.

**Lo que SÍ se conservó**, que es lo que sirve para construir: la **estructura de columnas**, las
**cantidades**, los **precios**, los **totales** y la **forma de los cálculos**.
📌 En `DECISIONES.md` los beneficiarios aparecen como *«otra persona»* por la misma razón.
⛔ **No volver a meter esos datos aquí**: en git, lo que entra queda en el historial para siempre.

## Los cinco archivos

| Archivo | Qué es | Qué destapó |
|---|---|---|
| `relacion-pagos-sin-factura.xlsx` | Su directorio de ~150 beneficiarios + el concentrado de transferencias de la semana | Que **el beneficiario casi nunca es el proveedor**, y que «César Victoria 1/2/3» es **UN proveedor con TRES cuentas** |
| `excel-semanal-de-produccion.xlsx` | Lo que su encargado le manda cada semana con las maquilas a pagar | El **IVA escondido** en una columna llamada «BONOS / AJUSTES», y un **total que no cuadra por 2,277** cuya razón no está escrita |
| `antiguedad-de-saldos.xlsx` | El reporte de los jueves: saldo por factura de todos los proveedores con factura | Que **sí envejece a los maquileros** (Borda Print a 8 días), al revés de lo que el sistema supone |
| `cotizacion-que-manda-el-cliente.xlsx` | El precosteo que le manda el cliente por temporada | La estructura real del costeo: tela 1 + tela 2, y los conceptos que él usa |
| `lista-de-precios-de-daniel.xlsx` | Donde **él juega en vivo** con los precios y se los devuelve al cliente | Que **la fórmula del sistema compone mal los factores** (un peso arriba en 1 de cada 3-4 modelos), y **cómo debe ser la pantalla** |

## Cómo usarlos
**Antes de construir cualquiera de las filas 0.109–0.122, abrir el archivo que le toca.** No para copiarlo
—varias de sus columnas existen sólo porque Excel no sabe hacer otra cosa— sino para **medir contra él** lo
que el sistema hace hoy. Así salieron los hallazgos: comparando, no leyendo.
