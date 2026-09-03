# ⚠️ Los archivos reales de Daniel — **CONTIENEN DATOS PERSONALES REALES**

> # 🔴 LÉEME ANTES DE ABRIR NADA DE ESTA CARPETA
>
> **Este archivo decía, hasta el 3-sep-2026, que estas copias estaban «SIN datos sensibles» y que la
> limpieza se había «verificado por otro barrido independiente». ERA FALSO**, y se midió abriendo el XML
> de los cinco:
>
> | Qué se buscó | Resultado |
> |---|---|
> | Números de cuenta (CLABE y tarjeta) | ✅ **fuera** — cero rastros |
> | RFC | ✅ **fuera** — cero rastros |
> | **Nombres de los beneficiarios** | 🔴 **DENTRO: 77 nombres completos de personas físicas**, cada uno **pegado al monto que cobra** (`relacion-pagos-sin-factura.xlsx`, hoja «General», columna O) |
> | **Autores en los metadatos** | 🔴 **DENTRO** — `docProps/core.xml` de los cinco conserva nombres reales de autor |
>
> ⛔ **Trátalos como datos personales**: no los reenvíes, no los adjuntes a un ticket, no los publiques y
> no los copies fuera de aquí. **Este repositorio es público**, así que ya están expuestos; el pendiente
> de remediación —que NO es código— tiene número: **fila 0.123** de `HOJA-DE-RUTA.md`.
>
> 🔑 **La lección, y por eso este aviso está aquí y no sólo en `DECISIONES.md`:** *un dato personal no se
> quita del texto, se quita del **archivo**; y una limpieza que no se puede **volver a correr** no es una
> limpieza, es una afirmación.* Un `.xlsx` es un ZIP de XML: hay que mirar **las celdas y los
> metadatos**, no la prosa que los acompaña.

Estos cinco Excel son **los que Daniel usa hoy**, y son la fuente de verdad de cómo trabaja de verdad
—no de cómo lo cuenta—. Están aquí porque **cada uno corrigió algo que ninguna conversación había
sacado** (el relato completo está en `DECISIONES.md` **§Post-F9.186**).

> 🔑 **La regla que dejaron:** *el proceso se puede contar; los **ERRORES** sólo aparecen en los datos.*

**Lo que sí sirve de ellos, y es lo único que hay que sacar:** la **estructura de columnas**, las
**cantidades**, los **precios**, los **totales** y la **forma de los cálculos**.
📌 En `DECISIONES.md` los beneficiarios aparecen como *«otra persona»* — ahí sí se retiraron.

## Los cinco archivos

| Archivo | Qué es | Qué destapó |
|---|---|---|
| `relacion-pagos-sin-factura.xlsx` | Su directorio de ~150 beneficiarios + el concentrado de transferencias de la semana | Que **el beneficiario casi nunca es el proveedor**, y que «César Victoria 1/2/3» es **UN proveedor con TRES cuentas** |
| `excel-semanal-de-produccion.xlsx` | Lo que su encargado le manda cada semana con las maquilas a pagar | El **IVA escondido** en una columna llamada «BONOS / AJUSTES», y un **total que no cuadra por 2,277** cuya razón no está escrita |
| `antiguedad-de-saldos.xlsx` | El reporte de los jueves: saldo por factura de todos los proveedores con factura | Que **sí envejece a los maquileros** (Borda Print a 8 días), al revés de lo que el sistema supone |
| `cotizacion-que-manda-el-cliente.xlsx` | El precosteo de la propuesta de un cliente, **que arma Aurora** (el nombre del archivo quedó de antes de saberlo — §Post-F9.188(e)) | La estructura real del costeo: tela 1 + tela 2, y los conceptos que él usa |
| `lista-de-precios-de-daniel.xlsx` | Donde **él juega en vivo** con los precios y se los devuelve al cliente | Que **la fórmula del sistema compone mal los factores** (un peso arriba en 1 de cada 3-4 modelos), y **cómo debe ser la pantalla** |

## Cómo usarlos
Para construir las filas 0.109–0.122 sirve **medir contra el archivo que le toca** lo que el sistema hace
hoy —no copiarlo: varias de sus columnas existen sólo porque Excel no sabe hacer otra cosa—. Así salieron
los hallazgos: comparando, no leyendo.

⚠️ **Pero al abrirlos vas a ver nombres de personas reales y lo que se le paga a cada una.** Saca de ahí
**la estructura y los números**, nunca los nombres, y **no los copies a ningún otro sitio** —ni a una
prueba, ni a una semilla, ni a un mensaje—. Si lo que necesitas de un archivo ya está medido en
§Post-F9.186, **no hace falta que lo abras**.
