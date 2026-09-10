# Mapa de la cadena: desarrollo del modelo → OP → orden de compra → explosión

> **Para qué es esto.** Cualquiera que vaya a tocar esta cadena empieza aquí y se ahorra volver a
> medirla. Nació el **7-sep-2026**, cuando **Daniel recorrió el flujo completo en `prueba` con datos
> suyos** —del desarrollo de un modelo hasta las OC internas— y encontró 17 puntos. Para clasificarlos
> hubo que levantar este mapa con el código en la mano.
>
> ⚠️ **Es un mapa MEDIDO, no un diseño.** Todo lo de aquí se comprobó leyendo el código en la versión
> **0.122**; lo que no se midió se dice. Las referencias `archivo:línea` envejecen — **si algo no cuadra,
> manda el código**, y conviene corregir esta página en el mismo cambio.
>
> El *qué* del negocio vive en `Documentacion_MJD/` (ADR-0002: aquí no se copia). El *porqué* de cada
> decisión, en `DECISIONES.md`. El *qué sigue*, en `HOJA-DE-RUTA.md`.

## Los cinco pasos, y quién manda en cada uno

| # | Paso | Pantalla | Dominio |
|---|---|---|---|
| 1 | Proyecto → desarrollo → **receta** → **precosto** → lista de precios | «Pre-costeos» `/desarrollo` · «Modelos» `/modelos` · «Listas de precios» | `dominio/desarrollo/*`, `dominio/modelos/*` |
| 2 | **Salida a producción** (nace el modelo hijo por color) | *ninguna propia*: ocurre dentro de «Generar OP» | `produccion/salida-produccion.ts`, `modelos/nomenclatura.ts` |
| 3 | Pedido interno → **OP** → **receta congelada de la orden** | «Pedidos» `/pedidos` · Centro de Órdenes | `dominio/pedidos/*`, `produccion/ordenes.ts`, `produccion/receta-orden.ts` |
| 4 | **Explosión** → revisión previa → **generar OC** | «Explosión de materiales» `/compras/explosion` | `compras/mrp.ts`, `compras/ordenes-compra.ts` |
| 5 | Qué tengo / qué falta | `/compras/estatus-materiales` | `compras/mrp.ts` |

### La distinción que más confunde, y el código la resuelve en una línea
- **Derivar** (`nomenclatura.ts` `derivarModeloDeProduccion`) → **crea una fila NUEVA** y deja el
  desarrollo intacto. Es lo que permite que de un desarrollo salgan cuatro modelos, uno por color.
- **Promover** (`nomenclatura.ts` `promoverAProduccionNucleo`, botón «Pasar a producción») →
  **TRANSFORMA la fila** del desarrollo: le cambia el código, le pone el número y lo muda de catálogo.
  **Un número para todo el modelo, no uno por color, y NO tiene vuelta atrás.**

⭐ **La receta SE COMPARTE, no se copia** (`modelos/receta-compartida.ts`): la regla única de lectura es
`idModeloDeLaReceta = idModeloDesarrollo ?? id`. El hijo **no puede** editar su BOM
(`exigirRecetaPropia`): se edita en el padre y todos los colores la ven.

## Dónde se atasca alguien la primera vez (ordenado por probabilidad)

Los dos primeros son los caros, porque **el aviso llega tarde o en otra pantalla**.

1. 🔴 **«Falta capturar el tipo de producto y el género»** (`nomenclatura.ts:222`). Salta al pulsar
   **«Generar OP»**, o sea **después de teclear la matriz de tallas entera**. Le pasa a todo modelo de
   desarrollo creado antes de que esos campos fueran obligatorios. *(Lo cierra la fila **0.155**:
   heredarlos del proyecto.)*
2. 🔴 **La receta de la OP nació VACÍA y nadie lo dice al generarla.** `receta-orden.ts` copia el BOM
   **al crear la orden**; si el modelo aún no tenía receta, la OP nace sin nada que liberar ni explotar.
   El aviso llega **dos pantallas después**, desde el MRP, y es correcto pero incompleto: dice dónde se
   libera, **no** que no hay renglones. La salida existe («Traer del modelo») pero el mensaje no la nombra.
3. **El precosto no congela** aunque sume > 0: nace con empaque automático, y se exige algo costeado
   **fuera** del empaque. *(Mensaje bueno: nombra el importe y a dónde ir.)*
4. **Un desarrollo sólo puede estar en UNA lista de precios, para siempre** (`@@unique([idDesarrollo])`).
   Quitarlo es la única salida, y el mensaje de «ya está en una lista» **no lo dice**.
5. **No se puede emitir la cotización** porque falta el **precio aprobado por el dueño** — eje distinto
   del estado del renglón. Un renglón «cerrado» **no** implica aprobado.
6. **La OP nunca llega a «completa»** por el arte: `llevaArte` es `true` por omisión (decisión
   deliberada), y se desmarca **en el MODELO**, no en la orden. El texto «Falta: arte» no dice dónde.
7. **No hay «liberar todo» la receta** — se retiró a petición de Daniel. Antes hay que pulsar
   **«marcar todo revisado»**, que es otro botón.
8. 🔴 **El botón «Confirmar y generar las OC», apagado**, por una de dos: falta la **fecha de entrega
   de la compra** (**no** se hereda de la OP: el respaldo se retiró a propósito) o no hay **dirección de
   entrega favorita** — y el mensaje manda a *«Compras › Direcciones de entrega»*, **pantalla que no
   está en el menú**.
9. **La casilla de un renglón deshabilitada sin decir por qué**: el motivo real (sin proveedor, ya en
   OC, cubierto por stock…) **sólo aparece en la revisión previa**, o sea en el paso siguiente.
10. **«Ya está en una orden de compra viva» sobre una OC en BORRADOR**: los borradores **cuentan** para
    cubrir la necesidad, así que hay que **cancelar** el borrador, no autorizarlo.

## Trampas para quien vaya a programar aquí

- **Al kardex de una orden se llega por TRES caminos**, no por una columna: **PT** por
  `MovimientoDetPt.idOrden`; **tela** por `origenTipo='salida-tela-orden'` + `origenId` (**texto**);
  **avíos** por `NotaSalidaLinea.idOrden`. Mirar sólo el obvio deja huecos.
- **Cancelar un movimiento de PT copia `idOrden` al movimiento inverso** (`comun/kardex.ts`), así que
  contar movimientos **nunca da cero**, ni cuando todo se canceló. Hay que descartar los anulados.
- **«Comprado» tiene DOS definiciones y no son intercambiables** (`compras/comprometido-en-oc.ts`):
  `ESTATUS_OC_QUE_CUBREN` **incluye** el borrador (*«¿hace falta volver a comprar?»*) y
  `ESTATUS_OC_COMPROMETIDA` lo **excluye** (*«¿ya me comprometí con el proveedor?»*). El propio archivo
  advierte que copiar una en la otra «habría dejado el defecto vivo». **Daniel decidió (7-sep) que el
  borrador NO cuenta como comprado.**
- **El MRP lee la receta CONGELADA de la orden, no el BOM vivo.** Si la OP nació con el BOM vacío, su
  receta queda vacía para siempre; el rescate es «Traer del modelo», que **sólo crea lo que falta**.
- **`RequerimientoOrden` y la ruta crítica se BORRAN y se recrean enteros** en cada explosión/generación:
  son derivados regenerables, **no** hechos. Lo que sí es hecho es `RutaOrden.fechaReal`.
- **`Tela.nombreComplemento` (el cárdigan) no cabe en la receta**: `ModeloTela` guarda **un solo**
  consumo, así que el MRP **no sabe cuánta tela acompañante lleva** y cada OC automática nace con el
  complemento pendiente de teclear a mano. *(Fila **0.156**.)*
- **El linaje no se ve en ninguna pantalla**: `Modelo.idModeloDesarrollo` existe en la base, pero el
  contrato de la orden **no lo transporta**. *(Filas **0.149** y **0.151**.)*

## Lo construido que NUNCA se ha usado con datos reales

Medido por fecha de commit + su fila del historial. **No** se comprobó contra la base de `prueba`.

| Pieza | Nació | Por qué no tiene rodaje |
|---|---|---|
| **Todo el paso 2** (linaje 1:N, receta compartida, salida a producción reescrita) | 1-sep-2026 | Es justo lo que Daniel estrenó el 7-sep |
| **Aviso de «hermanas» de la OP** | 2-sep-2026 | Necesita ≥2 OP del mismo desarrollo — no había |
| **«Promesas incumplidas» y el desenlace de la meta** | 2/3-sep-2026 | Ningún dato migrado la puede poblar |
| **Candado ABRIR/CERRAR receta** | 31-ago-2026 | Posterior al último recorrido completo |
| **«Dado por cubierto» y el ajuste del comprador** | 31-ago-2026 | Nacieron de un hallazgo suyo, sin re-ejercitar |
| **Color de la tela en la compra** | ago-2026 | Sus avisos sólo salen con OC históricas sin color |

## Lo que la migración de Access deja incompleto A PROPÓSITO

Esto **no son defectos**: el sistema viejo no tenía esos conceptos (REGLA 0-B: *tolerar ≠ compensar*).

`Modelo.idGenero`/`idTipoProducto` opcionales en migración ⇒ el modelo **no se puede numerar** ·
receta de la OP copiada **sin precios** · `Orden.estado` explícito de Access, **sin recalcular** (hay
que correr `realinearEstadoOrdenes`) · `Orden.idPedidoLinea` **NULL** en ~26 órdenes huérfanas ·
`Tela.idProveedor` puede ser NULL ⇒ «sin proveedor» en la explosión · `Modelo.codigoDesarrollo` NULL
⇒ los migrados **no se pueden versionar**.
