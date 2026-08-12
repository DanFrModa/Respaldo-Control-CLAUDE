# V1 · Primera versión a producción — ficha de etapas

> **Origen:** el repaso del flujo completo del 13-ago-2026 (`docs/DIAGNOSTICO-FLUJO-COMPLETO.md`) y
> las nueve decisiones de Daniel (`DECISIONES.md` §Post-F9.36 y §Post-F9.37).
>
> Daniel: *"Ya quiero sacar la primera versión. Ya se fue mucho tiempo con esto."*
>
> **Esto NO es una fase nueva del plan** (F0–F10 no cambia). Es el **empujón de cierre**: la lista de
> lo que falta para que el sistema se pueda operar de verdad, ordenada por lo que bloquea.

## Cómo leer esta ficha

Cada etapa trae **qué entrega**, **qué NO entra** (para que nadie la infle), las **decisiones ya
tomadas** (no se re-abren) y el **criterio de cierre**. El detalle de cada hallazgo, con su
`archivo:línea`, vive en el diagnóstico — aquí no se duplica.

**Reglas que aplican a todas:** 1 coder + 1 reviewer independiente · nunca Docker local · la
documentación entra en el MISMO commit · nada se comitea sin autorización · un defecto conocido no
es "menor" (§7.3).

---

## V1-E1 · Los cuatro arreglos del precosteo — ✅ construida, en revisión

Buscador en el selector de modelos · el cliente visible en el precosteo y en la ficha del desarrollo
· elegir un avío del catálogo en el renglón manual (con el precio resuelto por el dominio) · botón
«Generar lista de precios» desde el proyecto, **con motivo visible cuando no se puede usar**.

**Nota de despliegue:** sin migración, sin permisos nuevos, sin seed → **no** hace falta
`SEED_ON_START`.

---

## V1-E2 · Destapar la cadena de compras ⭐ — 🔨 en construcción

**El bloqueo #1 del sistema.** Sin esto no entra material al inventario — y con el arranque **sin
conteo físico** (§Post-F9.36 punto 4) esa es **la única vía**.

**Qué entrega**

1. **Autorizar una OC desde `borrador`**, y que la **Bandeja de autorización** liste lo que de verdad
   espera autorización. Hoy `pendiente_autorizacion` **no lo escribe nada** y la bandeja está vacía
   para siempre.
2. **Una prueba que fije que una OC recién creada se puede autorizar.** Es lo más valioso de la
   etapa: el fixture del test unitario usaba justamente el estado fantasma, por eso el CI nunca vio
   el bloqueo.
3. **Retirar el botón roto «Nueva nota de telas»** (cableado al motor legado por lote: selector vacío
   y un aviso que miente sobre un folio que no crea ninguna nota) y enlazar a la pantalla que sí
   opera, «Salida de tela a orden» por color.
4. **«Ajuste de materiales» se queda solo para avíos** (su pestaña de telas es el motor legado y lo
   capturado ahí no aparece en Existencias). Renombrar en el menú para que no compita con «Ajuste de
   telas por color».
5. **La recepción de avíos precarga el pendiente**, no el pedido completo, y **muestra lo ya
   recibido**. No se bloquea la sobre-recepción; se hace visible.
6. **Direcciones de entrega vacías:** explicar y **ofrecer el enlace** al catálogo (§Post-F9.16).

**Decisiones ya tomadas (lead):** se autoriza **directo desde borrador** —sin inventar un paso
intermedio— y la bandeja lista borradores; el valor `pendiente_autorizacion` **se queda en el enum**
(retirarlo pediría migración), solo se deja de depender de él.

**Qué NO entra:** el factor de conversión del MRP, el amarre proveedor↔insumo, que la explosión
escriba al mirarla, y el renglón de tela de la nota de salida (pregunta de producto abierta).

**Criterio de cierre:** capturar una OC nueva, autorizarla, recibir su material y verlo en
existencias — sin tocar la base de datos a mano.

---

## V1-E3 · Cerrar el ciclo de producción

**Qué entrega**

1. **Destapar el menú de Producción** (15 de 17 pantallas están fuera del riel) y **el hub de
   Calidad** (sus catálogos son inalcanzables desde toda la app porque el padre del riel no navega).
2. **La entrega a cliente en el panel de avance**, y una entrada de menú. Hoy la pantalla existe,
   funciona, y **no la enlaza nada**: el producto entra a PT y no sale nunca.
3. **Una sola pantalla por acto** (§Post-F9.36 punto 2): se queda el panel de avance y **se le agrega
   lo que hoy solo tienen las viejas** —imprimir y capturar segundas—; se retiran
   `/produccion/{corte,envios,recibos}`.
4. **Reimpresión**: los PDF hoy solo se ofrecen para el movimiento recién guardado. Si se cierra la
   pantalla, la hoja de envío del bulto ya no se recupera.
5. **La nota del TRASPASO de tela** (§Post-F9.38): mandar tela a un cortador **saca la tela
   físicamente** y el papel va con ella — hoy el traspaso **no genera ningún documento**. Impreso con
   folio, origen, destino, tercero y detalle por color, **reimprimible desde el historial**. Y
   **retirar el renglón de tela de la nota de salida**: la salida a una orden **no lleva nota**
   (basta el kardex), así que ese renglón no hay que arreglarlo — hay que quitarlo.
6. **El PT etiquetado por orden se puede mover** (movimientos manuales y traspasos validan contra el
   bucket «sin orden» mientras el recibo etiqueta con la orden: **son dos saldos que no se hablan**;
   la pantalla muestra existencia que el sistema rechaza mover). ⚠️ **Confirmado leyendo el código,
   no ejecutado** — verificar en vivo antes de tocar.
7. **`noProducir` visible y editable** (§Post-F9.36 punto 3).

**Qué NO entra:** la RC (apagada en v1), la programación de órdenes a maquileros, el estado final de
la orden ("Cortada" para siempre) salvo que salga barato al tocar lo demás.

**Criterio de cierre:** cortar, enviar a maquila, recibir con segundas, imprimir el papel del bulto y
entregar al cliente — todo desde el menú, sin escribir una URL.

---

## V1-E4 · Las defensas contra el daño callado

Lo peor que puede pasar en producción no es que algo truene: es que corrompa datos sin avisar.

**Qué entrega**

1. **Que importar dos veces la misma OC del cliente no duplique todo** (hoy crea pedido, órdenes, nº
   de producción, RC y MRP por duplicado, en silencio; se descubre semanas después cortando doble).
2. **Que no se pueda congelar un precosto con costo cero** por falta de receta — esa versión es
   inmutable y puede acabar de base de un precio al cliente.
3. **El resurtido**: hoy la segunda OP de un renglón no se puede crear desde la pantalla, aunque el
   backend lo modela a propósito.
4. **Que un renglón de lista de precios se pueda quitar** y una lista borrar: hoy un desarrollo
   metido por error **queda atrapado para siempre**.
5. **Que «Cancelar pedido» diga la verdad** — hoy afirma que deja de producirse y las OPs siguen
   vivas, cortándose.
6. **Cancelar el Pedido Real** (§Post-F9.37 punto 9), suave y con motivo.
7. **Los selectores topados a 100** que quedan (clientes ~117, colores al generar la OP), con el
   patrón de búsqueda server-side que ya se usa.

**Criterio de cierre:** cada uno con su prueba de regresión. Sin prueba no cuenta: son defectos que
por definición nadie nota al probar a mano.

---

## V1-E5 · Que los números sean los tuyos

**Qué entrega**

1. **El amarre proveedor↔insumo** (`ModeloTela.idTelaProveedor`, `ModeloAvio.idAvioProveedor`): las
   columnas existen y el motor **las lee**, pero **nada las escribe** — no hay API ni UI. Es la
   promesa central de D13/R17 y hoy no se puede ejercer: el precosto de tela cae al precio sugerido
   genérico y el de avío al **más barato automáticamente**.
2. **El factor de conversión en la OC del MRP**: la línea va en unidad de consumo y el resto la lee
   como presentación. Con un rollo de 50 m, recibir **infla la existencia ×50 y divide el costo
   ÷50**. Hoy solo avisa.
3. **Los días de crédito del cliente**, que hoy **se ignoran**: el vencimiento se persiste como la
   fecha del cargo, así que toda factura cae en "vencido" al día siguiente y **el aging de CxC es
   falso**.

**Qué NO entra:** el timbrado (R14, diferido), el ETL de apertura de Finanzas (espera el corte de
SINUBE), y la liga entrega→cobro.

---

## V1-E6 · Preparar el arranque

**Qué entrega**

1. **Permisos a los roles funcionales de RC**, o forzar en la UI que cada usuario lleve **dos roles**
   (uno de acceso + uno funcional). Hoy los 18 se crean **sin un solo permiso**: quien reciba solo su
   rol de RC **entra y no ve nada**. *(Aplica aunque la RC esté apagada: los roles existen y se van a
   asignar.)*
2. **Guard anti-lockout de usuarios** (existe para roles, no para usuarios): con 23 usuarios
   creándose a mano, desactivar al último admin deja el sistema sin llave.
3. **Respaldo `pg_dump` diario cifrado a R2** — es la mitigación #1 del plan de riesgos y **no
   existe**; hoy solo está el backup de Railway, y habilitarlo es manual.
4. **Cabeceras de seguridad en nginx** (HSTS, CSP, X-Frame-Options, nosniff, Referrer-Policy).
5. **Cambio de contraseña de auto-servicio** (hoy solo el admin puede cambiarlas).
6. **El salto de escalón en `reparar-secuencias.ts`** (§Post-F9.36 punto 5): OP y OC. El número exacto
   se elige **en el ensayo**. ⚠️ Irreversible.
7. **Los 10 catálogos de uso general**: opción 2 de Daniel — **leer libre, editar con permiso**. Se
   resuelve **parejo en los diez** o no se resuelve.
8. **Festivos 2027** si el go-live cruza el año (hoy están hardcodeados solo los de 2026).

---

## V1-E7 · El ensayo

Sobre **base vaciada** (nunca encima de lo que hay en `prueba`, que mezcla la foto vieja con
documentos capturados a mano).

Migraciones + seed → `export ETL_DESDE=2025` → la Regla 3 completa de `backend/migracion/README.md`
**cronometrando cada paso** → `realinear-estado-ordenes` + `reparar-secuencias` → **leer los 6
cuadres con Daniel** (el kardex de PT y telas en CERO es lo **esperado**) → crear los ~23 usuarios
con sus dos roles → capturar direcciones de entrega, RFC y las telas con las que se está trabajando →
**la prueba reina**: pedido → orden → explosión → OC → recepción → corte → maquila → recibo → entrega
→ costo, cuadrando cada número a mano.

---

## Lo que queda FUERA de la primera versión

- **Ruta Crítica** (§Post-F9.36 punto 1) — se construye después, y con ella el **concentrado de
  pendientes por persona** que pidió Daniel.
- **Calidad** — se puede apagar sin reservas; nada valida ni bloquea contra auditorías.
- **CxC / CxP** — dormidas hasta el corte de SINUBE. Cobranza sin saldo de apertura **da respuestas
  equivocadas**. *(EsMa sí se migra: los maquileros tendrán saldo el día 1 y los clientes no.)*
- **El importador Excel de conteo físico** — dejó de ser bloqueante al decidirse el arranque sin
  conteo; se construye cuando se quiera cargar el resto del almacén.
- **Avíos por tamaño** y **el arte dentro del modelo** (§Post-F9.33 y §Post-F9.35) — segunda etapa.
- **Remisión / packing list** — el comprobante de entrega actual basta (§Post-F9.36 punto 6).
- **Timbrado (R14)** — la factura se sigue haciendo en SINUBE.

## Preguntas abiertas

**Ninguna de producto.** La última —si la salida de tela debía generar «nota de salida»— la cerró
Daniel el 13-ago (§Post-F9.38): **la salida a una orden no lleva nota**, el **traspaso entre
almacenes sí**. Ambas cosas entran en V1-E3.

**Ninguna de diseño tampoco.** Daniel confirmó que la nota del traspaso **no genera folio nuevo**:
es la **impresión del folio que ya existe** (*"no debe de generar otro folio de nada"*). Sin registro
`NotaSalida` paralelo y sin secuencia nueva.
