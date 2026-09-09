/**
 * ⭐⭐ **LOS DOS AVISOS DE LA SALIDA DE TELA** (fila 0.101 — Daniel §Post-F9.193, decisiones 8 y 9).
 *
 * La pantalla «Salida de tela a orden» descuenta tela por TELA+COLOR y la liga a una orden de
 * producción. Hasta la 0.100 avisaba **una sola cosa, y la avisaba siempre**:
 *
 *  1. **(b) «Riesgo de tono»** salía en cuanto había un renglón capturado, dijera lo que dijera el
 *     inventario. Un aviso que sale SIEMPRE deja de leerse: se vuelve parte del decorado. Daniel
 *     pidió que salga **sólo cuando de verdad hay riesgo** —*más de una partida de ese color en el
 *     almacén del que se está sacando*— y que además **enseñe la lista de partidas**, para que quien
 *     surte pueda escoger a conciencia en vez de sólo enterarse de que el riesgo existe.
 *  2. **(a) «Sobre-salida»** no existía. **Nada** comparaba lo que se saca contra lo que la orden
 *     pide: se podía sacar el doble sin que el sistema chistara.
 *
 * 🔴 **LOS DOS AVISAN Y NINGUNO BLOQUEA.** No hay guarda, ni `throw`, ni botón apagado: la salida se
 * registra igual. Es la misma línea que ya seguía el aviso de tono (DECISIONES §Post-F9.11 punto 2)
 * — el sistema dice lo que sabe y la persona decide, porque el almacén tiene información que el
 * sistema no tiene (un rollo que se manchó, una diferencia de peso real, un sobrante que ya estaba
 * cortado).
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * ## ⭐ DE DÓNDE SALE «LO QUE LA ORDEN PIDE» — Y POR QUÉ ES LA MISMA CIFRA QUE VE EL COMPRADOR
 *
 * De **`RequerimientoOrden`**: el snapshot que escribe la explosión de materiales (`compras/mrp.ts`,
 * `explosionarUna`) y que ya leen la pantalla de explosión y el tablero *«qué tengo / qué falta»*
 * ({@link estatusMaterialesOrden}). **No se vuelve a calcular nada aquí.**
 *
 * 🔴 Y es a propósito, con cicatriz de por medio: la fila 0.061 acabó de cerrar el caso del costo
 * unitario, donde **cinco publicadores de la misma cifra** convivían y dos no respetaban la regla.
 * Re-derivar aquí *consumo por prenda × piezas de la matriz* habría creado el sexto: el mismo
 * número, calculado en dos sitios, divergiendo el día que alguien toque uno de los dos. Se lee el
 * snapshot **tal cual**, y si el snapshot no existe, este módulo **calla** (ver `tieneExplosion`).
 *
 * ⚠️ **Se compara POR TELA, no por color, y eso también es una decisión.** El snapshot tiene una
 * fila por tela×color desde V1-E3u, pero la comparación suma **todas las filas de la tela** — la
 * MISMA regla, y por las MISMAS razones, con la que `estatusMaterialesOrden` arma su tablero:
 *   • Es la decisión (c) de Daniel vista desde el almacén: *«se compra el color y el almacén lo
 *     reparte»*. La pregunta del que surte es *«¿me estoy pasando de la tela de esta orden?»*.
 *   • Es **robusto**: hay órdenes cuyo color de tela todavía nadie amarró (el snapshot las guarda
 *     con `idTelaColor = NULL`) y hay histórico migrado de Access sin color ninguno. Comparando por
 *     color, ésas no casarían con nada y el aviso mentiría en las dos direcciones.
 *   • Recoge **también lo que salió por la vía LEGADA por lote** (`registrarSalidaTelaAOrden`), que
 *     no tiene color pero sí tela. Esa vía dejó de capturar en la fila 0.170 —se quedó sin ruta—,
 *     pero sus movimientos siguen ahí (histórico migrado y lo que se alcanzó a capturar) y tienen
 *     que contar. Sumando por tela, ninguno se escapa del conteo.
 * 🔻 **Lo que cuesta:** sacar de más en un color y de menos en otro, sin pasarse del total de la
 * tela, NO avisa. Es el precio de no inventar una segunda verdad; si algún día Daniel lo pide por
 * color, el sitio a cambiar es {@link evaluarSobreSalidaDeTela} y nada más.
 *
 * ⚠️ **Sólo se compara el CUERPO.** La explosión **no sabe cuánto complemento (Cardigan) lleva una
 * tela que lo tiene** —el BOM guarda un solo consumo por tela, y por eso las OC automáticas nacen
 * con el complemento PENDIENTE (§Post-F9.18)—. Comparar el cardigan contra un requerido que nadie
 * calculó sería inventarlo. Se dice hasta donde el dato alcanza y ni una palabra más.
 *
 * ⭐ **Y cuenta LO YA SACADO ANTES, no sólo el renglón que se está capturando.** Sin eso, sacar de a
 * poquito evade el aviso —tres salidas de 400 contra un requerido de 1,000 no dirían nada— y un
 * aviso que se esquiva sin querer no sirve para nada. `yaSalido` es la Σ de TODAS las salidas vivas
 * ligadas a la orden (`origenTipo = salida-tela-orden`, `origenId = idOrden`), **sin las
 * canceladas**: una salida cancelada ya volvió al inventario (su inverso la neutraliza), así que no
 * cuenta como consumida.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * ## ⚠️⚠️ EL RIESGO DE TONO TIENE **TRES** ESTADOS, NO DOS — Y EL TERCERO ES «NO SE SABE»
 *
 * La partida es la unidad de **ENTRADA** del inventario por color. **Las salidas a orden no llevan
 * partida** —el consumo empareja por color, decisión de Daniel §Post-F9.9— así que el sistema **no
 * puede saber de qué partida salió cada metro**. Eso no es un hueco de esta fila: es exactamente
 * **la razón por la que el riesgo de tono existe**.
 *
 * ⭐⭐ **LO QUE CAMBIÓ CON LA FILA 0.142 (Daniel §Post-F9.201 punto 1): EL TRASPASO YA NOMBRA EL
 * LOTE.** Hasta la 0.141 las dos patas del traspaso se escribían con `idPartida = NULL`, y eso
 * dejaba este aviso **ciego justo donde hace falta**: la pantalla arranca en el almacén DEL
 * CORTADOR, y a ese almacén la tela llega casi siempre traspasada desde la bodega. Medido entonces:
 * 800 kg físicos en «Corte», cero partidas visibles, aviso mudo — con N tonos posibles enfrente de
 * quien escoge el rollo. Hoy el traspaso reparte **FIFO por folio** sobre el saldo por lote del
 * origen (`partidas-telas.ts`, `repartirPorPartidaFifo`) y la pata de entrada nombra el lote en el
 * destino ⇒ **las dos mitades de lo que Daniel pidió** (*«sólo cuando hay más de una partida»* y
 * *«con la lista a la vista»*) se entregan **en el almacén donde se escoge el rollo**.
 *
 * ⭐ El veredicto sigue siendo un **estado de tres valores** ({@link EstadoTono}), porque queda tela
 * que nadie puede nombrar (ver abajo), y el criterio que los ordena no cambió: **la ignorancia NO se
 * presenta como tranquilidad.**
 *
 * | estado | cuándo | qué hace |
 * |---|---|---|
 * | `varias-partidas` | hay **más de un lote VIVO** del color en ese almacén | avisa **y los lista** |
 * | `origen-desconocido` | hay **más existencia que la que los lotes vivos explican** (`existencia > Σ saldo`) | lo **dice**, en línea NEUTRA (no alarma) |
 * | `sin-riesgo` | un solo lote que explica toda la existencia, o no hay tela ahí | **calla** |
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * ## ⭐ POR QUÉ AHORA LOS DOS LADOS SE PUEDEN COMPARAR (y antes no)
 *
 * La comparación es `existencia > Σ saldo de los lotes vivos`. Hasta la 0.141 el lado derecho era
 * un **acumulado histórico que nunca bajaba** —a la partida nadie le descontaba las salidas— contra
 * un **neto de hoy** a la izquierda, y de ahí salían **dos fallos sistemáticos**, los dos medidos:
 *
 *  1. **ENCENDIDO PERMANENTE donde nunca hubo partidas** (el almacén del cortador): `Σ = 0` siempre
 *     ⇒ el estado salía en TODAS las capturas mientras quedara tela.
 *  2. **APAGADO donde ya se consumió algo**: 500 con lote consumidos + 300 llegados por traspaso
 *     daban `300 > 500` = falso ⇒ **callaba** con tela de origen desconocido en el anaquel.
 *
 * 🔑 **La fila 0.142 los cierra a los dos con un solo cambio**, y no por casualidad: al hacer que el
 * traspaso nombre el lote, el fallo 1 desaparece (ya hay lotes que listar) y al pasar la Σ a **neto
 * vivo** (`entradas − salidas` que nombran el lote — decisión P1 del lead) los dos lados quedan en
 * la misma clase de número. Se descartó la alternativa que se había dejado escrita aquí —comparar
 * *acumulado contra acumulado*— porque era **PEGAJOSA**: en cuanto entrara una sola vez tela sin
 * lote, el estado se quedaría encendido **para siempre**, aunque esa tela se hubiera consumido
 * entera. Eso cambia el significado de *«ahora mismo no puedo nombrar lo que hay»* a *«alguna vez
 * pasó por aquí tela que no supe nombrar»*, y lo primero es lo que necesita quien surte.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * ## 🔻 QUÉ SIGUE SIN CUADRAR, Y HAY QUE SABERLO ANTES DE CONFIAR EN EL NÚMERO
 *
 *  • ⭐ **NINGUNA SALIDA NOMBRA LOTE, SALVO LA PATA DEL TRASPASO.** La prosa de esta fila decía «las
 *    salidas **a orden**» como si fuera la única, y no lo es — el mapa completo, que es justo el que
 *    hace falta para entender el defecto de abajo: la **salida a orden** (`registrarSalidaTela
 *    ColorAOrden`), la **salida SIN orden** (fila 0.104), la **pata de sobrante del conteo**, el
 *    **ajuste de salida** y el **ajuste de salida del cíclico**. Todas descuentan existencia sin
 *    descontarle nada a ningún lote (decisión P3 / §Post-F9.9: el consumo empareja por color).
 *  • ⇒ en un almacén que CONSUME, el saldo por lote queda **por encima** de lo que de verdad hay:
 *    `varias-partidas` puede listar un lote que la producción ya se llevó, y `sinNombrar` puede
 *    quedarse corto. **El saldo por lote nunca cuadra del todo en un almacén que consume**, y ése es
 *    el precio explícito de no pedirle al almacén que escoja partida en cada salida.
 *  • 🔴🔴 **Y ese mismo saldo inflado tuvo una consecuencia GRAVE en el traspaso, que hay que conocer
 *    al leer este aviso.** Si el reparto del traspaso se hiciera contra el saldo inflado, mandaría al
 *    cortador —y a la hoja impresa— el nombre de un lote **ya consumido**, y este aviso diría
 *    `sin-riesgo` sobre una mentira. Se acotó en origen (`partidas-telas.ts`,
 *    `repartirPorPartidaFifo` topa el reparto contra la existencia real), pero **el tope acota y no
 *    cura**: lo que aporta es que el lote escogido sea **uno que la existencia pueda respaldar**
 *    cuando el desajuste viene sólo de consumo no apuntado — cambia CUÁL lote se nombra, no cuánta
 *    tela. Con varios lotes vivos y consumo parcial —o si además entró tela sin lote, que tapa el
 *    desajuste— el nombre puede seguir siendo el equivocado. La raíz es P3. Aquí
 *    el error va en la dirección inofensiva —se lista de más, nunca de menos— y por eso este módulo
 *    **no** aplica ese tope: esconder un lote sería callar un aviso que sí hacía falta.
 *  • **La tela vieja se queda sin nombre.** REGLA 0-B: la 0.142 es **aditiva y sin backfill** — los
 *    traspasos ya registrados siguen con `idPartida = NULL`, así que su tela sigue saliendo por la
 *    línea neutra hasta que se consuma. **No es un defecto: es lo acordado.**
 *  • ⭐ **EL MAPA COMPLETO DE LO QUE ENTRA SIN LOTE — medido, puerta por puerta**, porque la ronda de
 *    corrección de la 0.142 encontró que este párrafo nombraba una fuente FALSA y se callaba la real:
 *      1. **El ajuste de ENTRADA del conteo CÍCLICO de telas** (`indicadores/ciclico/tela.ts`) —
 *         **ésta es la puerta viva de verdad**. Su propio TSDoc lo dice: *«el ajuste de ENTRADA no
 *         crea partida… va sin partida, igual que las salidas»*, porque una hoja de conteo cíclico no
 *         tiene ni factura ni lote del proveedor que poner en una partida.
 *      2. **La CANCELACIÓN de una salida que no llevaba lote** (una salida a orden, una salida sin
 *         orden, la pata de sobrante de un conteo): el inverso copia el `idPartida` del original, y
 *         si el original iba en NULL el inverso también ⇒ entra tela sin nombre.
 *      3. **Los traspasos ANTERIORES a la fila 0.142**, que se escribieron con `idPartida = NULL` y
 *         **no se reparan** (REGLA 0-B).
 *      4. ⭐ **UN TRASPASO DE HOY, cuando el origen tiene tela que él tampoco puede nombrar.** El
 *         reparto FIFO nombra lo que puede y **el remanente viaja con `idPartida = NULL`** — o sea,
 *         la tela sin nombre **se propaga de almacén en almacén**, que es justo lo que hay que
 *         esperar: el traspaso no inventa lotes. Desde la ronda de corrección hay una segunda vía
 *         para lo mismo: **el remanente que deja el TOPE** cuando recorta lotes que la existencia no
 *         respalda (`repartirPorPartidaFifo`). *(Esta cuarta puerta faltaba cuando este mapa se
 *         declaraba «completo»; la cazó el reviewer en la 3ª vuelta.)*
 *    🔴 **Lo que NO es una fuente, aunque se dijo en ONCE sitios: el «sobrante» de un conteo por
 *    color.** En el vocabulario de este módulo sobrante = *contado < sistema* = **SALIDA**, y una
 *    salida BAJA la existencia ⇒ nunca deja tela sin nombre en el anaquel; y el caso contrario —el
 *    faltante— entra por una ENTRADA que **sí crea partida** (`registrarConteoTelaColor`). Era falso
 *    en las dos lecturas.
 *
 * 🔑 **POR ESO ESTE ESTADO NO SE PINTA COMO ALARMA.** La pantalla lo enseña como una **línea
 * neutra** —*«esta tela no la puedo nombrar, míralo tú»*— y reserva el ámbar para `varias-partidas`
 * —*«ojo, hay varios lotes, escoge»*—. La primera acompaña; la segunda interrumpe. Pintar de ámbar
 * el que puede salir seguido le devolvería a Daniel el problema que esto vino a resolver (*«un aviso
 * que sale siempre no lo lee nadie»*) con otro texto, y quemaría el canal de alarma para cuando de
 * verdad hay de dónde escoger.
 *
 * 🔻 **Y el límite de `varias-partidas`:** un lote que se consumió **por una salida a orden** sigue
 * contando (nadie le descontó nada — ver arriba), así que ese aviso **puede sobrar**; y con **un
 * solo** lote que explique toda la existencia calla, aunque ese único rollo tuviera vetas: eso el
 * sistema no lo puede saber.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * ## 🖥️ SIRVE A LA ÚNICA PANTALLA QUE SACA TELA A UNA ORDEN
 *
 * La vigente por COLOR (`lineas`). Nació sirviendo a DOS: la otra era la **LEGADA por lote**
 * (`lineasTela`, tela sin color), que entraba sólo al aviso (a) —la comparación es por tela de
 * todos modos— y no decía nada del tono, porque en ese flujo no hay ni color ni partida. Se incluyó
 * a propósito: sus salidas ya contaban en `yaSalido` (comparten `origenTipo`), así que dejarla
 * fuera la convertía en la puerta trasera por la que se saca de más sin que nadie diga nada.
 *
 * 🔻 **Esa pantalla se retiró en la fila 0.170** (capturaba sin color) ⇒ **`lineasTela` se quedó SIN
 * NINGÚN CLIENTE que lo mande**: el frontend sólo envía `lineas`, y la rama que lo procesa (abajo)
 * ya **no se puede alcanzar desde el API**. Se conserva —campo, rama y su prueba— por la misma razón
 * que las tres funciones de escritura de `inventarios/telas.ts`: es código correcto que documenta y
 * mide la forma LEGADA, y borrarlo no arregla nada. Lo que **no** se hace es seguir describiéndolo
 * como si la pantalla existiera.
 *
 * A9: todo se acota a la empresa activa. A4: reusa `inventario-telas.mover` (el permiso de la
 * captura que la previa acompaña) — **cero permisos nuevos, cero seed, cero migración**.
 */
import { DireccionMovimiento } from '../../datos/index.js';
import type { z } from 'zod';

import { ErrorNoEncontrado } from '../../comun/errores.js';
import { ORIGEN } from '../../comun/origenes.js';
import { verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import { existenciasTelaColorPorColor } from '../../comun/kardex.js';
import { clienteLectura, type ClienteLectura, type ContextoBd } from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';
// El redondeo a los decimales de la columna y la Σ del saldo por lote viven en el módulo de
// partidas (fila 0.142): AQUÍ se importan para que la aritmética del aviso y la del traspaso sean
// literalmente la misma, y no dos copias que un día divergen.
import { aCantidadTela as aCantidad, saldosPorPartidaTela } from './partidas-telas.js';
import {
  esquemaPreviaSalidaTelaColorCrear,
  type PreviaSalidaTelaColorSalida,
  type PreviaSalidaTelaRenglon,
  type PreviaSalidaColorRenglon,
  type PreviaSalidaPartida,
} from '../../contrato/index.js';

/** Entrada de la previa tal como la manda la pantalla (forma de dominio, antes de los defaults). */
export type EntradaPreviaSalidaTelaColor = z.input<typeof esquemaPreviaSalidaTelaColorCrear>;

// ── Núcleo PURO (sin base de datos): las dos reglas, en un solo sitio ────────────────────────────

/** Lo que la orden PIDE de una tela — Σ de sus filas del snapshot de la explosión. */
export interface RequeridoDeTela {
  idTela: number;
  /** Unidad de consumo del BOM (KG/M), congelada en el snapshot. */
  unidad: string | null;
  /** Σ `cantidadRequerida` de todas las filas (todos los colores) de esa tela. */
  requerido: number;
}

/**
 * Un renglón capturado en la pantalla, ya resuelto contra el catálogo de telas y colores.
 *
 * `idTelaColor = null` = viene de la pantalla LEGADA por lote (tela sin color). Cuenta igual para el
 * aviso (a) —la comparación es por TELA— y **no participa** del riesgo de tono, que no existe sin
 * color ni partida.
 */
export interface LineaCapturada {
  idTelaColor: number | null;
  telaColor: string | null;
  idTela: number;
  tela: string;
  /** Cantidad de CUERPO que se está a punto de sacar (lo único comparable — ver cabecera). */
  cantidad: number;
}

/**
 * **REGLA (a) — ¿ESTA SALIDA PASA DE LO QUE LA ORDEN PIDE?** Agrupa lo capturado por TELA y lo
 * compara contra el requerido del snapshot **más lo que ya salió antes** contra esa misma orden.
 *
 * `requerido = null` cuando el snapshot no dice nada de esa tela (la orden no se ha explotado, o la
 * tela no está en la receta liberada): entonces **no se avisa nada**, porque no hay contra qué
 * comparar. Callar cuando no se sabe es la mitad del arreglo de esta fila; inventar un requerido de
 * cero convertiría cada salida de una orden sin explotar en un falso positivo.
 *
 * El `excedente` sale ya calculado —no es cosa de la pantalla— **redondeado a los 4 decimales de la
 * columna** ({@link aCantidad}), y ESE redondeo es lo que mata el ruido de coma flotante: `400.1 +
 * 200.3 − 600.4` da `1.1e-13` en binario, que redondeado es `0`. No hay ninguna tolerancia además
 * del redondeo, y no la hubo nunca de verdad: la que había (`> 1e-6` sobre un número ya redondeado
 * a `0.0001`) era **inerte** —equivalía a `> 0`— y hacía que la prueba del ruido decimal pasara por
 * una razón distinta de la que decía vigilar. Cualquier exceso REAL es ≥ `0.0001`, que es lo más
 * fino que la base puede guardar.
 *
 * ⚠️ **No hay banda de tolerancia de negocio**, y es a propósito: Daniel no dio ninguna para este
 * aviso (la de ±5% de §Post-F9.19 es de la RECEPCIÓN de una OC, otra pregunta). Inventar aquí un
 * margen del 5% callaría exactamente los casos que el aviso viene a enseñar.
 */
export function evaluarSobreSalidaDeTela(
  lineas: readonly LineaCapturada[],
  requeridos: ReadonlyMap<number, RequeridoDeTela>,
  yaSalidoPorTela: ReadonlyMap<number, number>,
): PreviaSalidaTelaRenglon[] {
  /** Acumula por TELA lo capturado (una tela puede venir en varios colores). */
  const porTela = new Map<number, { tela: string; aSacar: number; colores: string[] }>();
  for (const l of lineas) {
    const acum = porTela.get(l.idTela) ?? { tela: l.tela, aSacar: 0, colores: [] };
    acum.aSacar += l.cantidad;
    if (l.telaColor !== null) acum.colores.push(l.telaColor);
    porTela.set(l.idTela, acum);
  }

  const renglones: PreviaSalidaTelaRenglon[] = [];
  for (const [idTela, acum] of porTela) {
    const necesidad = requeridos.get(idTela);
    const yaSalido = yaSalidoPorTela.get(idTela) ?? 0;
    const requerido = necesidad?.requerido ?? null;
    const excedente =
      requerido === null ? 0 : Math.max(0, aCantidad(yaSalido + acum.aSacar - requerido));
    renglones.push({
      idTela,
      // El nombre sale del CATÁLOGO (lo que se acaba de capturar), no de la copia del snapshot:
      // el snapshot puede ser viejo y el aviso tiene que nombrar la tela como se llama hoy.
      tela: acum.tela,
      unidad: necesidad?.unidad ?? null,
      requerido,
      yaSalido: aCantidad(yaSalido),
      aSacar: aCantidad(acum.aSacar),
      excedente,
      sobreSalida: excedente > 0,
      colores: acum.colores,
    });
  }
  // Orden estable por nombre de tela: dos corridas iguales pintan el aviso igual.
  return renglones.sort((a, b) => a.tela.localeCompare(b.tela, 'es'));
}

/**
 * **REGLA (b) — ¿HAY RIESGO DE TONO EN ESTE COLOR?** El consumo empareja por color, así que el
 * sistema **no elige el rollo**: lo elige la persona. Este es el veredicto de tres valores que la
 * tabla de la cabecera resume — y el que cambia el aviso de *«sale siempre»* a *«sale cuando hay
 * algo que decir, y dice cuál de las dos cosas es»*.
 *
 *  • `varias-partidas` — más de un lote VIVO ⇒ avisa **y los lista**, para poder escoger.
 *  • `origen-desconocido` — hay MÁS existencia que la que los lotes vivos explican ⇒ avisa diciendo
 *    la verdad: que no se sabe de qué lotes es esa tela. **Callar aquí era presentar la ignorancia
 *    como tranquilidad.**
 *  • `sin-riesgo` — un solo lote que explica toda la existencia, o nada de ese color ahí.
 *
 * ⭐ **La aritmética no cambió con la fila 0.142; cambió LA CLASE DE NÚMERO que recibe.** Antes
 * `partidas[].saldo` era un acumulado histórico de entradas y `existencia` un neto de hoy: restar
 * uno del otro comparaba peras con manzanas. Ahora los dos son netos de hoy, así que `sinNombrar`
 * significa de verdad *«esto es lo que hay en el anaquel y no puedo nombrar»*.
 */
export function evaluarRiesgoDeTono(
  lineas: readonly LineaCapturada[],
  partidasPorColor: ReadonlyMap<number, readonly PreviaSalidaPartida[]>,
  /** Existencia (cuerpo + complemento) de cada color EN ESE ALMACÉN — Σ de movimientos, D3. */
  existenciaPorColor: ReadonlyMap<number, number>,
): PreviaSalidaColorRenglon[] {
  const vistos = new Set<number>();
  const renglones: PreviaSalidaColorRenglon[] = [];
  for (const l of lineas) {
    // La captura LEGADA por lote no tiene color: no hay partidas entre las que escoger, así que no
    // participa de este aviso (sí del de sobre-salida, que va por tela).
    if (l.idTelaColor === null || l.telaColor === null) continue;
    if (vistos.has(l.idTelaColor)) continue;
    vistos.add(l.idTelaColor);
    const partidas = partidasPorColor.get(l.idTelaColor) ?? [];
    const existencia = aCantidad(existenciaPorColor.get(l.idTelaColor) ?? 0);
    // Lo que los lotes vivos EXPLICAN. Los dos números se redondean a los 4 decimales de la columna
    // antes de compararse: sin eso, el ruido binario inventaría "tela de origen desconocido" por
    // una millonésima.
    const saldoConocido = aCantidad(partidas.reduce((suma, p) => suma + p.saldo, 0));
    // Cuánto de lo que hay HOY no explica ninguna partida conocida. Se calcula UNA vez: es a la vez
    // lo que enciende `origen-desconocido` y el número que la pantalla enseña. Si viviera dos veces
    // (aquí una comparación, allá una resta) podrían decir cosas distintas del mismo hecho.
    const sinNombrar = aCantidad(Math.max(0, existencia - saldoConocido));
    renglones.push({
      idTelaColor: l.idTelaColor,
      telaColor: l.telaColor,
      idTela: l.idTela,
      tela: l.tela,
      // ⚠️ EL ORDEN DE ESTE TERNARIO ES LA REGLA, no un detalle de escritura: cuando las DOS
      // condiciones son ciertas —hay varias partidas Y además tela que ninguna explica— gana la
      // ALARMA, porque es la que trae información accionable (la lista de entre las que escoger).
      // Invertirlo escondería esa lista justo en el caso mixto, que es la dirección dañina; y para
      // que no se pierda lo otro, la pantalla añade en ese caso cuánto NO puede nombrar.
      estadoTono:
        partidas.length > 1
          ? 'varias-partidas'
          : sinNombrar > 0
            ? 'origen-desconocido'
            : 'sin-riesgo',
      existencia,
      saldoConocido,
      sinNombrar,
      partidas: [...partidas],
    });
  }
  return renglones;
}

// ── Lectura (la previa completa que consume la pantalla) ─────────────────────────────────────────

/**
 * **LA PREVIA DE LA SALIDA DE TELA A UNA ORDEN**: recibe lo que la pantalla lleva capturado y
 * devuelve **los dos veredictos ya tomados** (`sobreSalida` y `estadoTono`) con los números y las
 * partidas que los sostienen. La pantalla **no compara nada**: pinta lo que este módulo dice (A1).
 *
 * Es SOLO LECTURA: no registra ningún movimiento ni toca el snapshot de la explosión. Va por POST
 * porque el cuerpo es la captura en curso (N renglones), no un filtro de URL — mismo patrón que la
 * vista previa de la fusión de departamentos y que la revisión previa de la compra.
 *
 * Permiso `inventario-telas.mover`: es la previa del acto de sacar, y quien la ve es quien va a
 * capturarlo. Empresa activa (A9): una orden de otra empresa responde 404 y no se dice nada más.
 */
export async function previaSalidaTelaColorAOrden(
  sesion: SesionUsuario,
  entrada: EntradaPreviaSalidaTelaColor,
  bd?: ContextoBd,
): Promise<PreviaSalidaTelaColorSalida> {
  verificarPermiso(sesion, 'inventario-telas.mover');
  const datos = validarEntrada(esquemaPreviaSalidaTelaColorCrear, entrada);
  const idEmpresa = sesion.idEmpresaActiva;
  const cliente = clienteLectura(bd);

  const orden = await cliente.orden.findFirst({
    where: { id: datos.idOrden, idEmpresa },
    select: { id: true, folio: true },
  });
  if (orden === null) {
    throw new ErrorNoEncontrado('Orden', datos.idOrden);
  }

  // Los colores capturados, resueltos contra el catálogo (nombre de color + tela padre). Un color
  // que no existe NO truena la previa: se ignora — la previa avisa, y el que valida de verdad es el
  // registro de la salida (`registrarSalidaTelaColorAOrden`, que sí lanza 404).
  const idsColor = [...new Set(datos.lineas.map((l) => l.idTelaColor))];
  const colores = await cliente.telaColor.findMany({
    where: { id: { in: idsColor } },
    select: { id: true, nombre: true, tela: { select: { id: true, nombre: true } } },
  });
  const colorPorId = new Map(colores.map((c) => [c.id, c]));
  const lineas: LineaCapturada[] = [];
  for (const l of datos.lineas) {
    const color = colorPorId.get(l.idTelaColor);
    if (color === undefined) continue;
    lineas.push({
      idTelaColor: color.id,
      telaColor: color.nombre,
      idTela: color.tela.id,
      tela: color.tela.nombre,
      cantidad: l.cantidad,
    });
  }

  // Renglones de la pantalla LEGADA por lote: tela SIN color. Entran al MISMO aviso (a) —el que
  // compara por tela— para que capturar por el flujo viejo no sea la puerta trasera que se salta
  // el aviso. Las salidas de esa pantalla ya contaban en `yaSalido` (comparten `origenTipo`).
  if (datos.lineasTela.length > 0) {
    const telas = await cliente.tela.findMany({
      where: { id: { in: [...new Set(datos.lineasTela.map((l) => l.idTela))] } },
      select: { id: true, nombre: true },
    });
    const telaPorId = new Map(telas.map((t) => [t.id, t]));
    for (const l of datos.lineasTela) {
      const tela = telaPorId.get(l.idTela);
      if (tela === undefined) continue;
      lineas.push({
        idTelaColor: null,
        telaColor: null,
        idTela: tela.id,
        tela: tela.nombre,
        cantidad: l.cantidad,
      });
    }
  }

  const [requeridos, tieneExplosion] = await requeridoDeLaOrden(cliente, datos.idOrden);
  const yaSalido = await yaSalidoDeLaOrden(cliente, idEmpresa, datos.idOrden);
  const partidas = await partidasVivasPorColor(cliente, idEmpresa, datos.idAlmacen, idsColor);
  // ⭐ La EXISTENCIA de cada color en ese almacén, por la Σ compartida del motor de kardex
  // (`existenciasTelaColorPorColor`, misma aritmética que el conteo — nunca la vista, ADR-0010 §3).
  // Es lo que permite distinguir «no hay nada que escoger» de «no se sabe qué hay»: la tela que
  // entró sin lote (el ajuste de ENTRADA del conteo cíclico, la cancelación de una salida que no
  // llevaba lote, y los traspasos anteriores a la 0.142) sólo se ve restándole a esta existencia el
  // saldo de los lotes vivos. Ver el mapa completo en la cabecera.
  const existencias = await existenciasTelaColorPorColor(
    cliente,
    idEmpresa,
    datos.idAlmacen,
    idsColor,
  );
  const existenciaPorColor = new Map(
    existencias.map((e) => [e.idTelaColor, e.cuerpo + e.complemento]),
  );

  const telas = evaluarSobreSalidaDeTela(lineas, requeridos, yaSalido);
  const coloresPrevia = evaluarRiesgoDeTono(lineas, partidas, existenciaPorColor);

  return {
    idOrden: orden.id,
    folioOrden: Number(orden.folio),
    idAlmacen: datos.idAlmacen,
    tieneExplosion,
    telas,
    colores: coloresPrevia,
    haySobreSalida: telas.some((t) => t.sobreSalida),
    hayRiesgoTono: coloresPrevia.some((c) => c.estadoTono !== 'sin-riesgo'),
  };
}

/**
 * **LO QUE LA ORDEN PIDE, DEL SNAPSHOT DE LA EXPLOSIÓN** — la MISMA tabla que lee el tablero
 * «qué tengo / qué falta» (`RequerimientoOrden`), sumada por TELA (ver la cabecera del módulo).
 * El segundo valor dice si la orden tiene snapshot **siquiera**: sin él no hay nada que comparar y
 * la pantalla no enseña el aviso (a) — en vez de decir que todo sobra.
 */
async function requeridoDeLaOrden(
  cliente: ClienteLectura,
  idOrden: number,
): Promise<[Map<number, RequeridoDeTela>, boolean]> {
  const filas = await cliente.requerimientoOrden.findMany({
    where: { idOrden },
    select: { idTela: true, unidad: true, cantidadRequerida: true },
  });
  const porTela = new Map<number, RequeridoDeTela>();
  for (const f of filas) {
    if (f.idTela === null) continue; // los avíos no salen por esta pantalla
    const acum = porTela.get(f.idTela) ?? { idTela: f.idTela, unidad: f.unidad, requerido: 0 };
    acum.requerido += Number(f.cantidadRequerida);
    porTela.set(f.idTela, acum);
  }
  return [porTela, filas.length > 0];
}

/**
 * **LO QUE YA SALIÓ ANTES CONTRA ESTA ORDEN**, por tela: Σ del CUERPO de todas las salidas vivas
 * ligadas a la orden (`origenTipo = salida-tela-orden` + `origenId = idOrden`), de las DOS vías
 * (la de color y la LEGADA por lote, que comparten origen).
 *
 * 🔴 **Las canceladas NO cuentan**: `anuladoPor: { none: {} }` deja fuera al movimiento que ya tiene
 * su inverso, y el inverso mismo nunca entra porque nace con `origenTipo = cancelacion` (no con el
 * de la orden). Contar una salida cancelada diría que se consumió tela que ya volvió al almacén.
 */
async function yaSalidoDeLaOrden(
  cliente: ClienteLectura,
  idEmpresa: number,
  idOrden: number,
): Promise<Map<number, number>> {
  const filas = await cliente.movimientoDetTela.groupBy({
    by: ['idTela'],
    where: {
      movimiento: {
        idEmpresa,
        origenTipo: ORIGEN.salidaTelaOrden,
        origenId: String(idOrden),
        tipoMov: { direccion: DireccionMovimiento.salida },
        anuladoPor: { none: {} },
      },
    },
    _sum: { cantidad: true },
  });
  return new Map(filas.map((f) => [f.idTela, Number(f._sum.cantidad ?? 0)]));
}

/**
 * ⭐⭐ **LOS LOTES QUE QUEDAN HOY DE CADA COLOR EN EL ALMACÉN DEL QUE SE SACA**, con **el saldo vivo**
 * de cada uno (fila 0.142, decisión P1 del lead). Vivo = queda algo: `Σ entradas − Σ salidas` que
 * nombran esa partida en ESE almacén, descartando el neto ≤ 0.
 *
 * 🔴 **Hasta la 0.141 esto sumaba SÓLO ENTRADAS**, o sea un **acumulado histórico que nunca baja**,
 * y se comparaba contra la existencia, que es un **neto de hoy**. Dos clases de número distintas
 * ⇒ el aviso fallaba en los dos sentidos, y el fallo malo estaba **medido**: 500 con lote ya
 * consumidos + 300 llegados por traspaso daban `300 > 500` = falso ⇒ **callaba** con tela de origen
 * desconocido en el anaquel. Ahora los dos lados son netos y son comparables.
 *
 * 🔴 **La Σ NO filtra las canceladas, y eso es lo correcto ahora que resta**: el inverso copia el
 * `idPartida` del original (`cancelarMovimientoMaterial`), así que el par se neutraliza solo. El
 * viejo `anuladoPor: { none: {} }` sacaba al original y dejaba al inverso ⇒ **restaría dos veces**.
 * Una entrada cancelada deja el lote en 0 y por tanto **fuera de la lista**, igual que antes — pero
 * por aritmética, no por un filtro. Medido en la integración.
 *
 * 🔻 **Lo que este saldo NO cuadra, y hay que saberlo:** las **salidas a orden no nombran lote**
 * (decisión P3 — es otra fila), así que en un almacén que consume el saldo por lote se queda **por
 * encima** de lo que de verdad hay. Consecuencia práctica: `varias-partidas` puede listar un lote
 * que la producción ya se llevó, y `sinNombrar` puede quedarse corto. Lo que SÍ desapareció con la
 * 0.142 es la ceguera del traspaso, que era el caso normal del almacén del cortador.
 */
async function partidasVivasPorColor(
  cliente: ClienteLectura,
  idEmpresa: number,
  idAlmacen: number,
  idsColor: readonly number[],
): Promise<Map<number, PreviaSalidaPartida[]>> {
  const porColor = new Map<number, PreviaSalidaPartida[]>();
  if (idsColor.length === 0) return porColor;

  // La MISMA Σ por lote que reparte el traspaso (`saldosPorPartidaTela`), ya ordenada por folio.
  // Cuerpo + complemento juntos: una partida de puro cardigan también pone un rollo con su tono en
  // el anaquel, y por eso cuenta para el riesgo de tono.
  const saldos = await saldosPorPartidaTela(cliente, idEmpresa, idAlmacen, idsColor);
  // 🔴 VIVO se decide POR COMPONENTE, no por la suma. Un lote con cuerpo +100 y complemento −100
  // (alcanzable con un inverso de corrección) neta 0, y con el filtro sobre la suma **desaparecía de
  // la lista** aunque 100 kg de cuerpo sí fueran suyos — justo el aviso que hay que dar. Por la
  // misma razón cada componente se acota a 0 antes de sumar: un componente en negativo no puede
  // borrar tela del otro que sí está en el anaquel.
  const vivas = saldos
    .map((s) => ({
      idPartida: s.idPartida,
      saldo: aCantidad(Math.max(0, s.cuerpo) + Math.max(0, s.complemento)),
      vivo: s.cuerpo > 0 || s.complemento > 0,
    }))
    .filter((s) => s.vivo);
  if (vivas.length === 0) return porColor;

  const partidas = await cliente.partidaTela.findMany({
    where: { idEmpresa, id: { in: vivas.map((v) => v.idPartida) } },
    select: {
      id: true,
      folio: true,
      idTelaColor: true,
      loteProveedor: true,
      factura: true,
      fecha: true,
    },
  });
  const porId = new Map(partidas.map((p) => [p.id, p]));
  // Se recorre `vivas` (no `partidas`) para conservar el ORDEN POR FOLIO que trae la Σ: dos
  // corridas iguales listan los lotes igual. Una partida de otra empresa no aparece en `porId` y
  // simplemente no se lista (A9: no se dice nada de ella).
  for (const v of vivas) {
    const p = porId.get(v.idPartida);
    if (p === undefined) continue;
    const lista = porColor.get(p.idTelaColor) ?? [];
    lista.push({
      id: p.id,
      folio: Number(p.folio),
      loteProveedor: p.loteProveedor,
      factura: p.factura,
      fecha: p.fecha === null ? null : p.fecha.toISOString().slice(0, 10),
      saldo: v.saldo,
    });
    porColor.set(p.idTelaColor, lista);
  }
  return porColor;
}
