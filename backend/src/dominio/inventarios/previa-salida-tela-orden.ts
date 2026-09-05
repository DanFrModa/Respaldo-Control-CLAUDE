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
 *   • Recoge **las dos vías de salida**: la de color (esta pantalla) y la LEGADA por lote
 *     (`registrarSalidaTelaAOrden`), que no tiene color pero sí tela. Sumadas por tela, ninguna se
 *     escapa del conteo.
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
 * La partida es la unidad de **ENTRADA** del inventario por color. **Las salidas NO llevan partida**
 * —el consumo empareja por color, decisión de Daniel §Post-F9.9— así que el sistema **no puede
 * saber de qué partida salió cada metro**, y por tanto tampoco cuál queda en el anaquel. Eso no es
 * un hueco de esta fila: es exactamente **la razón por la que el riesgo de tono existe**.
 *
 * 🔴 **Y hay tela que entra a un almacén SIN partida ninguna: la que llega por TRASPASO.** Las patas
 * del traspaso van con `idPartida = NULL` (`partidas-telas.ts`, `traspasarTelaColor`) porque no son
 * entradas de compra. ⇒ contar partidas y callar cuando no hay ninguna **hacía desaparecer el aviso
 * justo donde más falta**: la pantalla arranca en el almacén DEL CORTADOR, y a ese almacén la tela
 * llega casi siempre traspasada desde la bodega. Medido: 800 kg físicos en «Corte», cero partidas
 * visibles, aviso mudo — con N tonos posibles enfrente de quien escoge el rollo.
 *
 * ⭐ Por eso el veredicto es un **estado de tres valores** ({@link EstadoTono}), y el criterio que
 * los ordena es uno solo: **la ignorancia NO se presenta como tranquilidad.**
 *
 * | estado | cuándo | qué hace |
 * |---|---|---|
 * | `varias-partidas` | hay **más de una** partida conocida del color en ese almacén | avisa **y las lista** |
 * | `origen-desconocido` | hay **más existencia que la que las partidas conocidas explican** (`existencia > Σ entrado`) — típicamente porque llegó por traspaso | lo **dice**, en línea NEUTRA (no alarma) |
 * | `sin-riesgo` | una sola partida que explica toda la existencia, o no hay tela ahí | **calla** |
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * ## 🔻🔻 EL LÍMITE REAL DE `origen-desconocido`: FALLA SISTEMÁTICAMENTE EN LOS DOS SENTIDOS
 *
 * Hay que saberlo antes de confiar en este estado. La comparación es `existencia > Σ entrado`, y los
 * dos lados **no son la misma clase de número**: `Σ entrado` es un **acumulado histórico que nunca
 * baja** —a la partida nadie le descuenta las salidas, porque las salidas no la nombran— mientras
 * que `existencia` es un **neto de hoy**. Comparar *«lo que entró alguna vez»* contra *«lo que hay
 * ahora»* sólo se sostiene mientras el almacén no haya consumido nada. De ahí, dos fallos:
 *
 *  1. **ENCENDIDO PERMANENTE donde nunca hubo partidas.** A un almacén alimentado SÓLO por traspaso
 *     —**el del cortador, que es el caso normal**— la tela entra con `idPartida = NULL`, así que
 *     `Σ entrado = 0` siempre y `existencia > 0` dispara el estado en **TODAS** las capturas. Sólo
 *     calla con el anaquel vacío, o sea justo cuando la pantalla no sirve para nada. **Es lo
 *     esperado hoy**, no un defecto de esta función.
 *  2. **APAGADO CASI PERMANENTE donde ya se consumió algo.** Con historia de consumo,
 *     `existencia < Σ entrado` casi por definición. Medido: 500 con partida en Corte, se consumen
 *     enteros, llegan 300 **por traspaso** ⇒ `300 > 500` es falso ⇒ **se calla** con tela de origen
 *     desconocido en el anaquel. ⇒ el caso mixto (una partida conocida + tela traspasada) se detecta
 *     **sólo mientras el almacén no haya consumido nada**, y no siempre, como decía esta cabecera
 *     hasta la tercera revisión de la fila.
 *
 * ⚠️⚠️ **QUÉ SE PUEDE Y QUÉ NO — y hay que leerlo fallo por fallo, porque NO son el mismo caso.**
 * (Esta acotación existe porque la versión anterior de este párrafo decía «no se puede» a secas y
 * un lector la ataba a los dos fallos; quien escriba la fila de la cura merece el mapa completo.)
 *
 *  • **Homogeneizar ESTOS DOS LADOS CONCRETOS** —`existencia`, neto de hoy, contra `Σ entrado`,
 *    acumulado— **no se puede** sin que la partida viaje en el traspaso: hoy `traspasarTelaColor` la
 *    deja en NULL a propósito (las patas del traspaso no son entradas de compra).
 *  • **El fallo 1** (encendido permanente del cortador) **sólo lo cura eso**: mientras la tela entre
 *    sin partida, no hay nada aquí dentro que pueda nombrarla. Punto.
 *  • **El fallo 2 SÍ tiene una alternativa local, computable hoy y sobre esta misma tabla**:
 *    comparar **acumulado contra acumulado** — todo lo que ENTRÓ al almacén contra lo que entró
 *    **con** partida. En el caso que hoy se pierde (500 con partida ya consumidos + 300 traspasados)
 *    daría `800 > 500` ⇒ **lo vería**, y en una bodega alimentada sólo por compras no dispararía.
 *
 * 🔑 **Y no se toma, a propósito: es PEGAJOSA.** En cuanto entrara una sola vez tela sin partida, el
 * estado se quedaría encendido **para siempre** —aunque esa tela se hubiera consumido entera y la
 * hubiera sustituido tela con partida conocida—. Eso cambia el significado del estado de *«ahora
 * mismo no puedo nombrar lo que hay en el anaquel»* a *«en algún momento pasó por aquí tela que no
 * supe nombrar»*, y **lo primero es lo que necesita quien surte**. Es una DECISIÓN, no una
 * imposibilidad: quien retome esto tiene las dos formulaciones y el costo de cada una.
 *
 * 🔑 **POR ESO ESTE ESTADO NO SE PINTA COMO ALARMA.** La pantalla lo enseña como una **línea
 * neutra** —*«aquí no llevamos partidas, míralo tú»*— y reserva el ámbar para `varias-partidas`
 * —*«ojo, hay varios lotes, escoge»*—. La primera acompaña; la segunda interrumpe. Si el estado que
 * sale siempre gritara, le devolveríamos a Daniel el problema que esta fila vino a resolver
 * (*«un aviso que sale siempre no lo lee nadie»*) con otro texto, y de paso quemaríamos el canal de
 * alarma para cuando de verdad hay de dónde escoger.
 *
 * 🔻 **Y el límite de `varias-partidas`:** una partida ya consumida por completo sigue contando
 * —nadie le descontó nada—, así que ese aviso **puede sobrar**; y con **una sola** partida que
 * explique toda la existencia calla, aunque ese único rollo tuviera vetas: eso el sistema no lo
 * puede saber.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * ## 🖥️ SIRVE A LAS DOS PANTALLAS QUE SACAN TELA A UNA ORDEN
 *
 * La vigente por COLOR (`lineas`) y la **LEGADA por lote** (`lineasTela`, tela sin color). La
 * segunda entra sólo al aviso (a) —la comparación es por tela de todos modos— y no dice nada del
 * tono, porque en ese flujo no hay ni color ni partida. Se incluye a propósito: sus salidas ya
 * contaban en `yaSalido` (comparten `origenTipo`), así que dejarla fuera del aviso la convertía en
 * la puerta trasera por la que se saca de más sin que nadie diga nada.
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
 *  • `varias-partidas` — más de una partida conocida ⇒ avisa **y las lista**, para poder escoger.
 *  • `origen-desconocido` — hay MÁS existencia que la que las partidas conocidas explican ⇒ avisa
 *    diciendo la verdad: que no se sabe de qué partidas es esa tela (llegó por traspaso, que no
 *    lleva partida). **Callar aquí era presentar la ignorancia como tranquilidad.**
 *  • `sin-riesgo` — una sola partida que explica toda la existencia, o nada de ese color ahí.
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
    // Lo que las partidas conocidas EXPLICAN. Los dos números se redondean a los 4 decimales de la
    // columna antes de compararse: sin eso, el ruido binario inventaría "tela de origen
    // desconocido" por una millonésima.
    const entradoConocido = aCantidad(partidas.reduce((suma, p) => suma + p.entrado, 0));
    // Cuánto de lo que hay HOY no explica ninguna partida conocida. Se calcula UNA vez: es a la vez
    // lo que enciende `origen-desconocido` y el número que la pantalla enseña. Si viviera dos veces
    // (aquí una comparación, allá una resta) podrían decir cosas distintas del mismo hecho.
    const sinNombrar = aCantidad(Math.max(0, existencia - entradoConocido));
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
      entradoConocido,
      sinNombrar,
      partidas: [...partidas],
    });
  }
  return renglones;
}

/**
 * DECIMALES de una cantidad de inventario: los mismos que guarda la columna (`Decimal(14,4)`).
 * Sumar/restar en `number` arrastra ruido binario y ese ruido acabaría impreso en el aviso.
 */
function aCantidad(valor: number): number {
  return Number(valor.toFixed(4));
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
  // Es lo que permite distinguir «no hay nada que escoger» de «no se sabe qué hay»: sin ella, la
  // tela que llegó por traspaso —sin partida— dejaba el aviso mudo con N tonos enfrente.
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
 * **LAS PARTIDAS CONOCIDAS DE CADA COLOR EN EL ALMACÉN DEL QUE SE SACA**, con lo que entró de cada
 * una. Conocida = tiene una entrada VIVA a ese almacén.
 *
 * ⚠️ Sólo las ENTRADAS llevan `idPartida` (las salidas **y las patas de traspaso** van con NULL):
 * por eso esto mide *«cuántas partidas entraron aquí»*, no *«cuántas quedan»* ni *«cuánta tela hay»*
 * — la tela traspasada no aparece en esta lista, y ése es justo el hueco que el tercer estado
 * (`origen-desconocido`) tapa comparando contra la existencia real. Ver la tabla de la cabecera.
 *
 * 🔴 **Una entrada CANCELADA no deja partida viva**, y hacen falta las DOS condiciones para eso:
 * `anuladoPor: { none: {} }` saca a la entrada original, y `direccion = entrada` saca a su inverso
 * —que es una SALIDA con el mismo `idPartida` copiado (`cancelarMovimientoMaterial`)—. Quitar
 * cualquiera de las dos resucita la partida cancelada; las dos están medidas en la integración.
 */
async function partidasVivasPorColor(
  cliente: ClienteLectura,
  idEmpresa: number,
  idAlmacen: number,
  idsColor: readonly number[],
): Promise<Map<number, PreviaSalidaPartida[]>> {
  const porColor = new Map<number, PreviaSalidaPartida[]>();
  if (idsColor.length === 0) return porColor;

  const entradas = await cliente.movimientoDetTela.groupBy({
    by: ['idPartida'],
    where: {
      idPartida: { not: null },
      idTelaColor: { in: [...idsColor] },
      movimiento: {
        idEmpresa,
        idAlmacen,
        tipoMov: { direccion: DireccionMovimiento.entrada },
        anuladoPor: { none: {} },
      },
    },
    _sum: { cantidad: true, cantidadComplemento: true },
  });
  /** Σ por partida de lo que entró a ESTE almacén (cuerpo + complemento: una entrada de puro
   *  cardigan también pone un rollo con su tono en el anaquel). */
  const entradoPorPartida = new Map<number, number>();
  for (const e of entradas) {
    if (e.idPartida === null) continue;
    entradoPorPartida.set(
      e.idPartida,
      Number(e._sum.cantidad ?? 0) + Number(e._sum.cantidadComplemento ?? 0),
    );
  }
  if (entradoPorPartida.size === 0) return porColor;

  const partidas = await cliente.partidaTela.findMany({
    where: { idEmpresa, id: { in: [...entradoPorPartida.keys()] } },
    select: {
      id: true,
      folio: true,
      idTelaColor: true,
      loteProveedor: true,
      factura: true,
      fecha: true,
    },
    orderBy: { folio: 'asc' },
  });
  for (const p of partidas) {
    // Sin filtro por cantidad, y es deliberado: el `where` de arriba ya deja SÓLO entradas vivas
    // (la cancelada la saca `anuladoPor`, su inverso la dirección), y ninguna entrada nace con las
    // DOS cantidades en cero (`alMenosUnaCantidad` del contrato). El `if (entrado <= 1e-6)` que
    // había aquí era inalcanzable —se mutó y ninguna prueba se puso roja—, así que se fue en vez de
    // quedarse como rama que nadie vigila.
    const entrado = entradoPorPartida.get(p.id) ?? 0;
    const lista = porColor.get(p.idTelaColor) ?? [];
    lista.push({
      id: p.id,
      folio: Number(p.folio),
      loteProveedor: p.loteProveedor,
      factura: p.factura,
      fecha: p.fecha === null ? null : p.fecha.toISOString().slice(0, 10),
      entrado: aCantidad(entrado),
    });
    porColor.set(p.idTelaColor, lista);
  }
  return porColor;
}
