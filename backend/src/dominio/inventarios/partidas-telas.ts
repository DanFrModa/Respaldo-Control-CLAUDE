/**
 * Inventario de TELAS NUEVO por COLOR — partidas + existencias + kardex (etapa A2; Daniel
 * §Post-F9.9 opción B y §Post-F9.11 puntos 2/4/5). Toda la lógica vive AQUÍ (A1); las rutas REST
 * solo validan permiso + Zod y delegan. Orquesta el MISMO motor de kardex (`comun/kardex.ts`) que
 * el flujo viejo por Lote — ese flujo queda INTACTO como legado consultable (`telas.ts`).
 *
 * Reglas del modelo nuevo:
 *  • La dimensión de existencia es TELA × COLOR (`TelaColor`, hijo de la tela) × almacén; el
 *    CUERPO y el COMPLEMENTO (cardigan) viajan SIEMPRE JUNTOS en el mismo renglón (comprar solo
 *    complemento = cuerpo en 0). `Tela.nombreComplemento != NULL` = la tela lleva complemento.
 *  • La PARTIDA es la unidad de ENTRADA (folio propio consecutivo POR EMPRESA — A3, secuencia
 *    `partida-tela` — + número de lote del proveedor, texto opcional buscable). El CONSUMO
 *    empareja por TELA+COLOR: las salidas NO piden partida (`idPartida` va NULL).
 *  • ⭐ **EXCEPCIÓN, y es la única (fila 0.142):** el TRASPASO entre almacenes SÍ nombra el lote en
 *    sus dos patas — se reparte FIFO por folio sobre el saldo por lote del origen, sin pantalla
 *    nueva ({@link repartirPorPartidaFifo}). No es «pedir partida en la salida»: nadie la escoge,
 *    la calcula el sistema. Sin eso, el almacén del cortador —alimentado sólo por traspasos— nunca
 *    sabría de qué lotes es su tela, y el aviso de riesgo de tono era ciego justo ahí.
 *  • El inventario ARRANCA DESDE CERO (conteo físico): la puerta es el ajuste de entrada, que
 *    CREA la(s) partida(s) en la MISMA transacción (A2).
 *  • D3 — existencia = Σ de movimientos. Las validaciones de no-negativo (de AMBOS componentes)
 *    suman `MovimientoDetTela` DIRECTO bajo `pg_advisory_xact_lock` (motor:
 *    `existenciaTelaColorBloqueada`), NUNCA la vista `existencia_tela_color` (solo consulta).
 *  • Cancelar = movimiento INVERSO auditado (NUNCA edita/borra) — `cancelarMovimientoMaterial`.
 *  • A4 — permisos REUSADOS: `inventario-telas.ver` / `inventario-telas.mover` (cero permisos
 *    nuevos, cero seed). Ex-acceso #7 (`telas.ver-totales`): costos/importes del kardex se OMITEN
 *    (null) server-side.
 *  • A9 — todo se filtra/sella por la empresa activa de la sesión.
 *
 * ⚠️ Orden de folios (aviso de `comun/secuencias.ts`): cuando una transacción pide DOS claves
 * (partida + movimiento) SIEMPRE se toman en el mismo orden — primero `partida-tela`, luego
 * `movimiento` (que toma el motor) — para no interbloquear transacciones cruzadas.
 */
import {
  esquemaAjusteTelaColorCrear,
  esquemaConteoTelaColorCrear,
  esquemaSaldosTelaColorQuery,
  esquemaSalidaTelaColorCrear,
  esquemaSalidaTelaColorSinOrdenCrear,
  esquemaTraspasoTelaColorCrear,
  esquemaMovimientoMaterialCancelarCuerpo,
  type ConteoTelaColorRenglonSalida,
  type ConteoTelaColorSalida,
  type MovimientoTelaColorSalida,
  type SaldosTelaColorSalida,
  type TraspasoTelaColorSalida,
  type ExistenciasTelaColorLista,
  type ExistenciaTelaAgrupada,
  type ExistenciaTelaColorHijo,
  type KardexTelaColorLista,
  type KardexTelaColorRenglon,
  type PartidasTelaLista,
} from '../../contrato/index.js';
import { DireccionMovimiento, Prisma } from '../../datos/index.js';
import { z } from 'zod';

import { exigirAlmacenDelTipo } from '../../comun/almacenes.js';
import { registrarBitacora } from '../../comun/auditoria.js';
import { ErrorConflicto, ErrorNoEncontrado, ErrorValidacion } from '../../comun/errores.js';
import {
  bloquearTelaColor,
  cancelarMovimientoMaterial,
  existenciaTelaColorBloqueada,
  existenciasTelaColorPorColor,
  registrarMovimientoTela as registrarMovimientoTelaMotor,
  registrarTraspasoTela as registrarTraspasoTelaMotor,
  SUMAS_TELA_COLOR,
  type ExistenciaTelaColor,
  type LineaMovimientoTela,
} from '../../comun/kardex.js';
import { ORIGEN } from '../../comun/origenes.js';
import { siguienteFolio } from '../../comun/secuencias.js';
import { verificarPermiso, tienePermiso, type SesionUsuario } from '../../comun/permisos.js';
import {
  clienteLectura,
  enTransaccion,
  type ClienteLectura,
  type ContextoBd,
  type Tx,
} from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';
import { exigirCancelableFueraDelCiclico } from './cancelacion-comun.js';
import {
  CODIGO_TIPO_MOV_POR_CONCEPTO,
  exigirPermisoParaCancelarSalidaSinOrden,
  exigirPermisoSalidaSinOrden,
} from './salida-sin-orden.js';
import { rechazarTipoReservado } from './tipos-reservados.js';
import { aDateColumna, aNumero, tipoPorCodigo, tipoPorId } from './telas.js';

/** Clave de la secuencia de folios de partida (A3 — consecutivo por empresa, jamás Max()+1). */
export const CLAVE_SECUENCIA_PARTIDA = 'partida-tela';

/** Tipo inverso para CANCELAR una entrada (dirección `salida`). */
const COD_AJUSTE_SALIDA = 'ajuste-salida';
/** Tipo inverso para CANCELAR una salida (dirección `entrada`). */
const COD_AJUSTE_ENTRADA = 'ajuste-entrada';
/** Tipos de las patas del traspaso. */
const COD_TRANSFERENCIA_SALIDA = 'transferencia-salida';
const COD_TRANSFERENCIA_ENTRADA = 'transferencia-entrada';
/** Tipo de la salida ligada a una orden. */
const COD_SALIDA_A_ORDEN = 'salida-a-orden';

// ── Helpers ──────────────────────────────────────────────────────────────────────────────────────

/** Un color de tela con los datos de su tela padre que las reglas necesitan. */
export interface ColorConTela {
  idTelaColor: number;
  nombreColor: string;
  idTela: number;
  nombreTela: string;
  /** `null` = la tela NO lleva complemento (la bandera es `Tela.nombreComplemento`). */
  nombreComplemento: string | null;
}

/** La forma MÍNIMA de un renglón por color que las reglas necesitan (sin `loteProveedor` — las
 * líneas de salida/traspaso ya no traen ese campo en el contrato, reviewer A2 #4). */
export interface LineaColorBase {
  idTelaColor: number;
  cantidad: number;
  cantidadComplemento?: number | undefined;
}

/**
 * Resuelve los colores capturados con su tela padre y VALIDA las reglas del complemento:
 * la cantidad de complemento solo se acepta en telas que LLEVAN complemento; en las que lo
 * llevan, un complemento no capturado se toma como 0. Rechaza colores inexistentes; los
 * REPETIDOS se rechazan SALVO `permitirRepetidos` (ajuste de ENTRADA: una factura puede traer
 * DOS lotes del MISMO tela+color en un documento — cada renglón crea SU partida, DECISIONES
 * §Post-F9.11 punto 4).
 */
export async function resolverColores(
  tx: Tx,
  lineas: readonly LineaColorBase[],
  opciones?: { permitirRepetidos?: boolean },
): Promise<Map<number, ColorConTela>> {
  const ids = lineas.map((l) => l.idTelaColor);
  if (opciones?.permitirRepetidos !== true && new Set(ids).size !== ids.length) {
    throw new ErrorValidacion('No repitas el mismo color de tela en dos renglones de la captura.');
  }
  const colores = await tx.telaColor.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      nombre: true,
      tela: { select: { id: true, nombre: true, nombreComplemento: true } },
    },
  });
  const porId = new Map<number, ColorConTela>(
    colores.map((c) => [
      c.id,
      {
        idTelaColor: c.id,
        nombreColor: c.nombre,
        idTela: c.tela.id,
        nombreTela: c.tela.nombre,
        nombreComplemento: c.tela.nombreComplemento,
      },
    ]),
  );
  for (const linea of lineas) {
    const color = porId.get(linea.idTelaColor);
    if (color === undefined) {
      throw new ErrorNoEncontrado('TelaColor', linea.idTelaColor);
    }
    if (color.nombreComplemento === null && (linea.cantidadComplemento ?? 0) > 0) {
      throw new ErrorValidacion(
        `La tela "${color.nombreTela}" no lleva complemento: no se puede capturar cantidad de complemento en el color "${color.nombreColor}".`,
      );
    }
  }
  return porId;
}

/**
 * Convierte los renglones capturados a líneas del MOTOR de kardex. `cantidad` = cuerpo (admite
 * 0); `cantidadComplemento` se guarda como número (0 incluido) SOLO si la tela lleva complemento
 * — en telas sin complemento va NULL (la columna distingue "no lleva" de "llevó 0").
 * `idPartidaPorLinea` va POR ÍNDICE (no por color): en una entrada el mismo color puede aparecer
 * en varios renglones y cada uno lleva SU propia partida.
 */
export function aLineasMotor(
  lineas: readonly LineaColorBase[],
  colores: Map<number, ColorConTela>,
  idPartidaPorLinea?: readonly (number | null)[],
): LineaMovimientoTela[] {
  return lineas.map((l, i) => {
    const color = colores.get(l.idTelaColor);
    if (color === undefined) {
      throw new ErrorNoEncontrado('TelaColor', l.idTelaColor);
    }
    const llevaComplemento = color.nombreComplemento !== null;
    return {
      idTela: color.idTela,
      idTelaColor: l.idTelaColor,
      idPartida: idPartidaPorLinea?.[i] ?? null,
      cantidad: l.cantidad,
      cantidadComplemento: llevaComplemento ? (l.cantidadComplemento ?? 0) : null,
    };
  });
}

/**
 * DECIMALES de una cantidad de inventario de tela: los mismos que guarda la columna
 * (`Decimal(14,4)`). Sumar y restar en `number` arrastra ruido binario, y ese ruido acabaría
 * escribiendo renglones de kardex de una millonésima o inventando «tela que no se puede nombrar»
 * que no existe. Vive AQUÍ y lo importa `previa-salida-tela-orden.ts`: si mañana cambia la escala
 * de la columna, cambia en UN sitio y los dos caminos se mueven juntos.
 */
export function aCantidadTela(valor: number): number {
  return Number(valor.toFixed(4));
}

/**
 * ⭐ **EL SALDO VIVO DE UNA PARTIDA EN UN ALMACÉN** (fila 0.142): lo que ENTRÓ nombrando esa
 * partida MENOS lo que SALIÓ nombrándola, por cada componente. No es «lo que entró alguna vez».
 */
export interface SaldoPartidaTela {
  idPartida: number;
  idTelaColor: number;
  /** Folio de la partida (A3): el criterio FIFO del reparto y el orden en que se lista. */
  folio: number;
  /** Saldo del CUERPO (Σ con signo de los renglones que nombran esta partida en ese almacén). */
  cuerpo: number;
  /** Saldo del COMPLEMENTO (cardigan) — existencia INDEPENDIENTE del cuerpo (motor de kardex). */
  complemento: number;
}

/**
 * ⭐⭐ **CUÁNTO QUEDA DE CADA PARTIDA EN UN ALMACÉN** — Σ de `movimiento_det_tela` DIRECTO, con el
 * signo de la dirección, agrupada por partida (D3: nunca una columna de saldo, nunca la vista).
 * Es la pieza que la fila 0.142 necesitaba en DOS sitios y por eso vive en uno solo:
 *
 *  1. **El reparto FIFO del traspaso** ({@link repartirPorPartidaFifo}): de qué lotes es la tela
 *     que se está moviendo, para que la pata de entrada la nombre en el almacén destino.
 *  2. **El aviso de riesgo de tono** (`previa-salida-tela-orden.ts`): qué lotes hay HOY en el
 *     anaquel — un NETO, comparable con la existencia, que también es un neto de hoy.
 *
 * 🔴 **NO filtra las canceladas, y es a propósito.** `cancelarMovimientoMaterial` copia `idPartida`
 * al inverso, así que el par original+inverso **se neutraliza solo** en esta Σ. Poner aquí el
 * `anuladoPor: { none: {} }` que usaba la versión de acumulado sería peor que inútil: dejaría fuera
 * al original (que sí está anulado) y dentro al inverso (que no lo está) ⇒ **restaría dos veces**.
 * Es la MISMA regla con la que el motor calcula la existencia, y por eso los dos números se pueden
 * comparar.
 *
 * ⚠️ **NO TOMA EL LOCK: lo toma —o no— quien la llama**, igual que `existenciasTelaColorPorColor`.
 * El traspaso la llama DESPUÉS de `validarNoNegativoTelaColor` (que ya bloqueó cada color del
 * origen); la previa la llama sin lock, porque es una lectura de consulta.
 *
 * Devuelve TODAS las partidas que tocaron ese almacén (incluidas las de saldo 0 o negativo): quién
 * llama decide qué hacer con ellas — y las dos decisiones están escritas donde se toman.
 */
export async function saldosPorPartidaTela(
  cliente: ClienteLectura,
  idEmpresa: number,
  idAlmacen: number,
  idsTelaColor: readonly number[],
): Promise<SaldoPartidaTela[]> {
  const ids = [...new Set(idsTelaColor)];
  if (ids.length === 0) return [];
  const filas = await cliente.$queryRaw<
    {
      idPartida: number;
      idTelaColor: number;
      folio: bigint;
      cuerpo: Prisma.Decimal | null;
      complemento: Prisma.Decimal | null;
    }[]
  >(Prisma.sql`
    SELECT
      d."id_partida"    AS "idPartida",
      d."id_tela_color" AS "idTelaColor",
      p."folio"         AS "folio",
${SUMAS_TELA_COLOR}
    FROM "movimiento_det_tela" d
    JOIN "movimientos" m ON m."id" = d."id_movimiento"
    JOIN "tipos_movimiento_inventario" t ON t."id" = m."id_tipo_mov"
    JOIN "partidas_tela" p ON p."id" = d."id_partida"
    WHERE m."id_empresa" = ${idEmpresa}
      AND m."id_almacen" = ${idAlmacen}
      AND d."id_partida" IS NOT NULL
      AND d."id_tela_color" IN (${Prisma.join(ids)})
    GROUP BY d."id_partida", d."id_tela_color", p."folio"
    ORDER BY p."folio" ASC, d."id_partida" ASC
  `);
  return filas.map((f) => ({
    idPartida: f.idPartida,
    idTelaColor: f.idTelaColor,
    folio: Number(f.folio),
    cuerpo: aCantidadTela(Number(f.cuerpo ?? 0)),
    complemento: aCantidadTela(Number(f.complemento ?? 0)),
  }));
}

/** Cómo queda repartida una captura de traspaso entre las partidas del almacén de ORIGEN. */
export interface RepartoPorPartida {
  /** Renglones EXPANDIDOS: uno por partida que aporta, más uno sin partida si algo no se nombra. */
  lineas: LineaColorBase[];
  /** La partida de cada renglón, POR ÍNDICE (paralelo a `lineas`); `null` = no se pudo nombrar. */
  idPartidaPorLinea: (number | null)[];
}

/**
 * ⭐⭐ **EL REPARTO FIFO DE UN TRASPASO ENTRE LAS PARTIDAS DEL ORIGEN** (fila 0.142, Daniel
 * §Post-F9.201 punto 1: *«el traspaso conserva el lote de origen —y su reparto, si la pata mueve
 * varios»*). Función PURA: no toca base ni sesión, así que la regla se puede medir sin Postgres.
 *
 * Se captura como siempre —color y cantidad, sin pantalla nueva (decisión P2 del lead)— y el
 * sistema decide de qué lotes sale, **del folio más viejo al más nuevo**. Cada partida que aporta
 * se lleva SU renglón, y el renglón viaja igual a las DOS patas (el motor pasa el mismo arreglo a
 * la salida del origen y a la entrada del destino) ⇒ el destino sabe de qué lote es su tela.
 *
 * 🔴 **CUERPO Y COMPLEMENTO SE REPARTEN POR SEPARADO, y no es un detalle**: son dos existencias
 * INDEPENDIENTES en el motor de kardex, y hay partidas de SÓLO complemento (comprar cardigan
 * suelto — §Post-F9.11 punto 2). Repartir sólo el cuerpo dejaría el cardigan sin nombre, o peor,
 * le inventaría un reparto imposible. Por eso las dos vueltas son independientes y luego se juntan
 * **por partida**: un renglón lleva lo que ESA partida aporta de cada componente (0 incluido).
 *
 * ⚠️ **Lo que ninguna partida alcanza a explicar viaja SIN lote (`null`), sin error.** Pasa siempre
 * que el origen tenga tela que nadie nombró: la que llegó por traspaso ANTES de esta fila (REGLA
 * 0-B: no se repara hacia atrás), la que entra por el **ajuste de ENTRADA del conteo cíclico** (que
 * no crea partida a propósito), la que devolvió la cancelación de una salida que tampoco llevaba
 * lote y —desde el tope de abajo— **la que el propio reparto se niega a nombrar** porque la
 * existencia no la respalda. Callar y mover la tela es lo correcto: el traspaso NO es el sitio
 * donde se inventan lotes. 🔁 Y como este reparto lo consume `traspasarTelaColor`, que pasa el MISMO
 * arreglo de renglones a las DOS patas, **la tela sin nombre se PROPAGA** al destino igual de
 * anónima, que es la verdad. El mapa completo de las cuatro puertas por las que entra tela sin lote
 * vive en la cabecera de `previa-salida-tela-orden.ts`.
 *
 * ⚠️ **Un renglón capturado en 0/0 sobrevive** (sale como renglón sin partida) para que lo rechace
 * `validarLineasTela` del motor con su mensaje, en vez de desaparecer del movimiento en silencio.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * 🔴🔴 **EL TOPE CONTRA LA EXISTENCIA REAL — sin esto, el traspaso NOMBRA EL LOTE EQUIVOCADO.**
 * (Ronda de corrección de la fila 0.142; el reviewer lo midió contra la base y salió tal cual.)
 *
 * El saldo por lote viene **INFLADO** y no es un defecto de la Σ: las **salidas a orden no nombran
 * lote** (decisión P3, §Post-F9.9), así que consumen existencia **sin descontarle nada a ningún
 * lote**. El escenario, en cuatro pasos:
 *
 *   1. entran 500 kg de `L-VIEJO` a la bodega;
 *   2. **salen 500 kg a una orden** — físicamente ya no queda nada de `L-VIEJO`, pero su saldo por
 *      lote sigue diciendo 500;
 *   3. entran 300 kg de `L-NUEVO`, que es **lo único que hay** (existencia = 300, Σ saldos = 800);
 *   4. se traspasan esos 300 al cortador.
 *
 * Sin tope, el FIFO reparte contra 800 y se lleva **el folio más viejo — el que ya se consumió** ⇒ el
 * destino recibe `L-VIEJO`, el aviso de tono dice **`sin-riesgo`** y **la hoja impresa lleva el
 * nombre de un lote que no es**. 🔑 **Eso es peor que el estado anterior a esta fila**: antes el
 * cortador leía *«no sé de qué lote es»* —que era VERDAD y mandaba a revisar el rollo— y ahora leería
 * una afirmación falsa con confianza total. Es justo lo contrario de lo que dice
 * `impreso-traspaso-tela.ts` (*«decir un lote que no se sabe sería peor que callar»*).
 *
 * ⭐ **El tope:** antes de repartir, a los lotes se les quita el **déficit** `Σ saldos − existencia`
 * **empezando por los folios más viejos** — o sea, se asume que lo que se consumió sin nombre salió
 * de lo más viejo, la MISMA hipótesis FIFO con la que se reparte (coherente con P2). En el ejemplo
 * `L-VIEJO` queda en 0, `L-NUEVO` en 300, y el reparto acierta.
 *
 * ⭐ **LO QUE EL TOPE SÍ APORTA — y es sobre la IDENTIDAD del lote, no sobre la cantidad:** que el
 * lote escogido sea **uno que la existencia pueda respaldar**, cuando el desajuste viene sólo de
 * consumo no apuntado — que es el caso normal de la bodega. Eso es lo que convierte `L-VIEJO` en
 * `L-NUEVO` en el ejemplo de arriba, y está medido (la prueba *«NO nombra un lote que la existencia
 * real ya no respalda»* y los cuatro pasos en integración).
 *
 * ⚠️ **Lo que el tope NO aporta, aunque una versión anterior de este bloque lo presumía «medido»:**
 * que *«no se nombre más tela de la que hay»*. **Esa propiedad ya la daba
 * {@link validarNoNegativoTelaColor}**, que rechaza la captura si pasa de la existencia, y el reparto
 * nunca reparte más de lo capturado ⇒ `Σ nombrado ≤ existencia` es cierto **con tope y sin él**. El
 * único estado donde el tope la sostendría —dos renglones del MISMO color en una captura— lo prohíbe
 * `resolverColores`. Era una promesa **vacua**, y su prueba pasaba con el tope borrado: la cazó el
 * reviewer y **se sustituyó por otra que sí muerde**.
 *
 * 🔑 **Dicho en una línea: el tope no cambia CUÁNTA tela se nombra — cambia CUÁL lote se nombra.**
 * Lo que no alcance viaja sin lote, que es la verdad.
 *
 * 🔻🔻 **LO QUE **NO** GARANTIZA, y se escribe aquí porque la primera versión de este bloque prometió
 * de más y una prueba lo desmintió** (`previa-salida-tela-orden.int.test.ts`, la que se llama
 * `🔻 LÍMITE:`). Decía también *«nunca se nombra un lote que ya no tiene nada»*, y **es FALSO cuando
 * además ha entrado tela SIN lote**:
 *
 *  • El desajuste `Σ saldos − existencia` **mezcla dos causas de signo contrario que la Σ no puede
 *    separar**: el **consumo no nombrado** (el lote reclama de MÁS ⇒ habría que restarle) y la
 *    **entrada sin lote** (reclama de MENOS ⇒ NO habría que restarle). Se cancelan entre sí.
 *  • Medido: 500 de un lote consumidos por una salida a orden (sobre-reclamo real = 500) **+ 200
 *    entrados sin lote** ⇒ el tope sólo ve **300** de desajuste y le deja al fantasma **200 kg que no
 *    son suyos**. El escenario del reviewer —sin tela sin lote de por medio— **sí** queda curado,
 *    porque ahí el déficit coincide exactamente con lo que el fantasma reclamaba.
 *  • Y aunque no hubiera tela sin lote: con **varios lotes vivos y consumo parcial** el tope quita
 *    del más viejo **por hipótesis**, así que el nombre puede acabar siendo el del lote de al lado.
 *
 * 🔑 **La raíz de las tres cosas es la misma: P3.** Mientras la salida a orden no nombre lote, el
 * sistema no sabe de CUÁL salió lo consumido. Está declarado para Daniel en `DECISIONES.md`
 * §Post-F9.206 (recuadro final), porque afecta a lo que él tiene que ratificar.
 *
 * ⚠️ **Y por qué este mismo tope NO se aplica al aviso de riesgo de tono** (`previa-salida-tela-
 * orden.ts`), aunque el saldo inflado también le afecte: ahí el error seguro va en la dirección
 * INOFENSIVA. Listar de más un lote que producción ya se llevó hace que alguien mire el anaquel de
 * sobra; **esconderlo** haría callar un aviso cuando sí hay dos tonos. En el papel del traspaso es al
 * revés: sobra-nombrar **es** la mentira. Misma cifra, dos usos, dos criterios — y por eso el tope
 * vive aquí y no en la Σ compartida.
 */
export function repartirPorPartidaFifo(
  lineas: readonly LineaColorBase[],
  saldos: readonly SaldoPartidaTela[],
  /** Existencia REAL por color, leída bajo el MISMO lock (D3). Es el techo del reparto. */
  existenciaPorColor: ReadonlyMap<number, ExistenciaTelaColor>,
): RepartoPorPartida {
  // Lo disponible por color, en orden FIFO de folio y con el restante MUTABLE: si dos renglones
  // pidieran el mismo color (hoy `resolverColores` lo prohíbe en la captura, pero nada obliga a que
  // siga siendo así) el segundo no volvería a repartir lo que el primero ya se llevó.
  const disponibles = new Map<
    number,
    { idPartida: number; cuerpo: number; complemento: number }[]
  >();
  // 🔴 El FIFO se ordena AQUÍ, no se hereda del orden en que lleguen los saldos. `saldosPorPartidaTela`
  // ya los devuelve por folio, pero si esta función dependiera de eso la regla viviría en un `ORDER
  // BY` que ninguna prueba pura puede vigilar — y el día que alguien cambie la consulta, el reparto
  // cambiaría de lote sin que nada se ponga rojo. Desempate por `idPartida` para que sea determinista.
  const porFolio = [...saldos].sort((a, b) => a.folio - b.folio || a.idPartida - b.idPartida);
  for (const s of porFolio) {
    const lista = disponibles.get(s.idTelaColor) ?? [];
    // Un saldo NEGATIVO (sólo puede venir de un inverso de corrección) se ofrece como 0: nombrar
    // esa partida diría que hay tela suya en el anaquel cuando no queda. No lleva guarda propia a
    // propósito — con el saldo en 0 el `continue` de más abajo la salta igual, y una guarda que
    // ninguna prueba puede poner en rojo es exactamente la rama que nadie vigila.
    lista.push({
      idPartida: s.idPartida,
      cuerpo: Math.max(0, s.cuerpo),
      complemento: Math.max(0, s.complemento),
    });
    disponibles.set(s.idTelaColor, lista);
  }

  // 🔴 EL TOPE CONTRA LA EXISTENCIA REAL (ver la cabecera): se le quita a los lotes, del más VIEJO
  // al más nuevo, todo lo que digan tener de más que lo que hay en el anaquel. Por COMPONENTE,
  // porque cuerpo y complemento son dos existencias independientes y su déficit no tiene por qué
  // coincidir.
  for (const [idTelaColor, lista] of disponibles) {
    const existencia = existenciaPorColor.get(idTelaColor);
    const topeCuerpo = Math.max(0, existencia?.cuerpo ?? 0);
    const topeComplemento = Math.max(0, existencia?.complemento ?? 0);
    let deficitCuerpo = aCantidadTela(
      Math.max(0, lista.reduce((t, d) => t + d.cuerpo, 0) - topeCuerpo),
    );
    let deficitComplemento = aCantidadTela(
      Math.max(0, lista.reduce((t, d) => t + d.complemento, 0) - topeComplemento),
    );
    for (const disp of lista) {
      if (deficitCuerpo <= 0 && deficitComplemento <= 0) break;
      const quitaCuerpo = aCantidadTela(Math.min(deficitCuerpo, disp.cuerpo));
      const quitaComplemento = aCantidadTela(Math.min(deficitComplemento, disp.complemento));
      disp.cuerpo = aCantidadTela(disp.cuerpo - quitaCuerpo);
      disp.complemento = aCantidadTela(disp.complemento - quitaComplemento);
      deficitCuerpo = aCantidadTela(deficitCuerpo - quitaCuerpo);
      deficitComplemento = aCantidadTela(deficitComplemento - quitaComplemento);
    }
  }

  const expandidas: LineaColorBase[] = [];
  const idPartidaPorLinea: (number | null)[] = [];

  for (const l of lineas) {
    const lista = disponibles.get(l.idTelaColor) ?? [];
    /** Lo asignado a cada partida. Un `Map` conserva el orden de inserción = el orden FIFO. */
    const asignado = new Map<number, { cuerpo: number; complemento: number }>();
    let restaCuerpo = aCantidadTela(l.cantidad);
    let restaComplemento = aCantidadTela(l.cantidadComplemento ?? 0);

    for (const disp of lista) {
      if (restaCuerpo <= 0 && restaComplemento <= 0) break;
      const tomaCuerpo = aCantidadTela(Math.min(Math.max(0, restaCuerpo), disp.cuerpo));
      const tomaComplemento = aCantidadTela(
        Math.min(Math.max(0, restaComplemento), disp.complemento),
      );
      if (tomaCuerpo <= 0 && tomaComplemento <= 0) continue;
      asignado.set(disp.idPartida, { cuerpo: tomaCuerpo, complemento: tomaComplemento });
      disp.cuerpo = aCantidadTela(disp.cuerpo - tomaCuerpo);
      disp.complemento = aCantidadTela(disp.complemento - tomaComplemento);
      restaCuerpo = aCantidadTela(restaCuerpo - tomaCuerpo);
      restaComplemento = aCantidadTela(restaComplemento - tomaComplemento);
    }

    for (const [idPartida, cant] of asignado) {
      expandidas.push({
        idTelaColor: l.idTelaColor,
        cantidad: cant.cuerpo,
        cantidadComplemento: cant.complemento,
      });
      idPartidaPorLinea.push(idPartida);
    }
    // El remanente que ninguna partida explicó (y el renglón capturado en 0/0, para que lo juzgue
    // el motor) viaja al final, sin lote.
    if (restaCuerpo > 0 || restaComplemento > 0 || asignado.size === 0) {
      expandidas.push({
        idTelaColor: l.idTelaColor,
        cantidad: Math.max(0, restaCuerpo),
        cantidadComplemento: Math.max(0, restaComplemento),
      });
      idPartidaPorLinea.push(null);
    }
  }

  return { lineas: expandidas, idPartidaPorLinea };
}

/** Datos de la PARTIDA que se crea al dar una entrada de tela por color. */
export interface DatosPartidaTela {
  idEmpresa: number;
  idTelaColor: number;
  /** Número de lote del proveedor (texto libre, opcional). */
  loteProveedor?: string | null | undefined;
  /** Factura/remisión que ampara la entrada (opcional). */
  factura?: string | null | undefined;
  /** Fecha de la entrada (`YYYY-MM-DD`). */
  fecha: string;
}

/**
 * Crea UNA partida de tela (la unidad de ENTRADA del inventario por color) con su folio atómico
 * por empresa (A3, secuencia `partida-tela`) y su bitácora (A7), DENTRO de la transacción del
 * llamador (A2). Es el único lugar donde nace una `PartidaTela`: lo usan el ajuste de entrada por
 * color (A2), el documento de entrada por factura/remisión y la recepción de compra (B1).
 *
 * ⚠️ Orden de folios: si la transacción también pide el folio del MOVIMIENTO, la partida va
 * PRIMERO (mismo orden en todos los llamadores para no interbloquear — ver `comun/secuencias.ts`).
 */
export async function crearPartidaTela(
  tx: Tx,
  sesion: SesionUsuario,
  datos: DatosPartidaTela,
): Promise<{ id: number; folio: bigint }> {
  const folio = await siguienteFolio(tx, datos.idEmpresa, CLAVE_SECUENCIA_PARTIDA);
  const partida = await tx.partidaTela.create({
    data: {
      folio,
      idEmpresa: datos.idEmpresa,
      idTelaColor: datos.idTelaColor,
      loteProveedor: datos.loteProveedor?.trim() || null,
      factura: datos.factura?.trim() || null,
      fecha: aDateColumna(datos.fecha),
      creadoPorId: sesion.id,
      modificadoPorId: sesion.id,
    },
  });
  await registrarBitacora(tx, sesion, {
    entidad: 'PartidaTela',
    idEntidad: partida.id,
    accion: 'CREAR',
    datos: {
      folio: folio.toString(),
      idTelaColor: datos.idTelaColor,
      ...(partida.loteProveedor === null ? {} : { loteProveedor: partida.loteProveedor }),
    },
  });
  return { id: partida.id, folio };
}

/**
 * Valida, bajo bloqueo, que SACAR `lineas` (tela×color) del almacén no deje NINGUNO de los DOS
 * componentes en negativo (D3). Advisory lock por color (`bloquearTelaColor`) + suma DIRECTA de
 * `MovimientoDetTela` (`existenciaTelaColorBloqueada`) — NUNCA la vista (ADR-0010 §3). Locks en
 * orden DETERMINISTA (por idTelaColor) para evitar deadlocks entre operaciones cruzadas.
 *
 * ⭐ **DEVUELVE la existencia que leyó, por color** (fila 0.142, ronda de corrección). No es un
 * detalle de implementación: es **el único sitio del flujo donde la existencia se lee bajo el lock**,
 * y el reparto por lote del traspaso la necesita como techo ({@link repartirPorPartidaFifo}).
 * Leerla otra vez fuera de aquí sería una **segunda Σ** que podría ver otro estado. Los llamadores
 * que sólo validan pueden ignorar el valor devuelto, y eso es lo que hacen los otros tres.
 *
 * ⚠️ **Y ojo con lo que esta función ya garantiza, porque se confunde:** al rechazar toda captura que
 * pase de la existencia, **ella sola** hace cierto que *«no se reparte más tela de la que hay»*. Eso
 * NO es mérito del tope del reparto — presumirlo como tal fue un error que costó una vuelta de
 * revisión (ver la cabecera de `repartirPorPartidaFifo`).
 */
async function validarNoNegativoTelaColor(
  tx: Tx,
  idEmpresa: number,
  idAlmacen: number,
  lineas: readonly LineaColorBase[],
  colores: Map<number, ColorConTela>,
): Promise<Map<number, ExistenciaTelaColor>> {
  /** La existencia que se leyó BAJO LOCK, por color. Se devuelve en vez de tirarse: el traspaso la
   *  necesita para acotar el reparto por lote (fila 0.142, ronda de corrección) y leerla otra vez
   *  fuera de aquí sería una segunda Σ que podría ver otro estado. */
  const existencias = new Map<number, ExistenciaTelaColor>();
  const ordenadas = [...lineas].sort((a, b) => a.idTelaColor - b.idTelaColor);
  for (const l of ordenadas) {
    const color = colores.get(l.idTelaColor);
    if (color === undefined) {
      throw new ErrorNoEncontrado('TelaColor', l.idTelaColor);
    }
    await bloquearTelaColor(tx, idEmpresa, idAlmacen, l.idTelaColor);
    const existencia = await existenciaTelaColorBloqueada(tx, idEmpresa, idAlmacen, l.idTelaColor);
    existencias.set(l.idTelaColor, existencia);
    if (existencia.cuerpo - l.cantidad < 0) {
      throw new ErrorConflicto(
        `No hay existencia suficiente de "${color.nombreTela} · ${color.nombreColor}": se intenta ` +
          `sacar ${l.cantidad} de cuerpo con ${existencia.cuerpo} en existencia (no se permite dejar ` +
          `el inventario en negativo).`,
      );
    }
    const complemento = l.cantidadComplemento ?? 0;
    if (existencia.complemento - complemento < 0) {
      throw new ErrorConflicto(
        `No hay existencia suficiente del complemento de "${color.nombreTela} · ${color.nombreColor}": ` +
          `se intenta sacar ${complemento} con ${existencia.complemento} en existencia (no se permite ` +
          `dejar el inventario en negativo).`,
      );
    }
  }
  return existencias;
}

// ── Proyección a la salida ───────────────────────────────────────────────────────────────────────

/** `include` para proyectar un movimiento por color con nombres legibles. */
const incluirMovimientoTelaColor = {
  tipoMov: { select: { nombre: true, direccion: true } },
  almacen: { select: { nombre: true } },
  anuladoPor: { select: { id: true } },
  detallesTela: {
    orderBy: [{ idTelaColor: 'asc' }, { id: 'asc' }],
    include: {
      tela: { select: { nombre: true } },
      telaColor: { select: { nombre: true, pantone: true } },
      partida: { select: { folio: true, loteProveedor: true } },
    },
  },
} satisfies Prisma.MovimientoInclude;

type MovimientoTelaColorConDetalle = Prisma.MovimientoGetPayload<{
  include: typeof incluirMovimientoTelaColor;
}>;

/**
 * Proyecta un movimiento por color (con detalle) a la forma del contrato. `verImportes`
 * (ex-acceso #7) decide si se exponen los costos/importes o van null (A4).
 */
function aMovimientoTelaColorSalida(
  m: MovimientoTelaColorConDetalle,
  verImportes: boolean,
): MovimientoTelaColorSalida {
  let totalCuerpo = 0;
  let totalComplemento = 0;
  let totalImporte = 0;
  let hayImporte = false;
  const renglones = m.detallesTela
    .filter((d) => d.idTelaColor !== null && d.telaColor !== null)
    .map((d) => {
      const cantidad = Number(d.cantidad);
      const cantidadComplemento = aNumero(d.cantidadComplemento);
      totalCuerpo += cantidad;
      totalComplemento += cantidadComplemento ?? 0;
      const costoUnit = verImportes ? aNumero(d.costoUnit) : null;
      const costoUnitComplemento = verImportes ? aNumero(d.costoUnitComplemento) : null;
      // B1: el renglón valúa CADA componente con SU costo (el cardigan tiene su propio precio).
      const importe =
        costoUnit === null && costoUnitComplemento === null
          ? null
          : (costoUnit ?? 0) * cantidad + (costoUnitComplemento ?? 0) * (cantidadComplemento ?? 0);
      if (importe !== null) {
        totalImporte += importe;
        hayImporte = true;
      }
      return {
        idTela: d.idTela,
        tela: d.tela.nombre,
        // El filter de arriba garantiza ambos; el `??` cubre el estrechamiento de tipos.
        idTelaColor: d.idTelaColor ?? 0,
        telaColor: d.telaColor?.nombre ?? '',
        pantone: d.telaColor?.pantone ?? null,
        idPartida: d.idPartida,
        partidaFolio: d.partida === null ? null : Number(d.partida.folio),
        loteProveedor: d.partida?.loteProveedor ?? null,
        cantidad,
        cantidadComplemento,
        costoUnit,
        costoUnitComplemento,
        importe,
      };
    });

  return {
    id: m.id,
    folio: Number(m.folio),
    idEmpresa: m.idEmpresa,
    idTipoMov: m.idTipoMov,
    tipoMov: m.tipoMov.nombre,
    direccion: m.tipoMov.direccion,
    idAlmacen: m.idAlmacen,
    almacen: m.almacen.nombre,
    fecha: m.fecha.toISOString().slice(0, 10),
    origenTipo: m.origenTipo,
    origenId: m.origenId,
    observaciones: m.observaciones,
    cancelado: m.anuladoPor.length > 0,
    idMovimientoInverso: m.idMovimientoInverso,
    renglones,
    totalCuerpo,
    totalComplemento,
    totalImporte: verImportes && hayImporte ? totalImporte : null,
    creadoEn: m.creadoEn.toISOString(),
    creadoPorId: m.creadoPorId,
  };
}

/** Obtiene un movimiento por color de la empresa activa, o lanza (A9). */
async function obtenerMovimientoTelaColor(
  idMovimiento: number,
  idEmpresa: number,
  verImportes: boolean,
  bd?: ContextoBd,
): Promise<MovimientoTelaColorSalida> {
  const m = await clienteLectura(bd).movimiento.findFirst({
    where: { id: idMovimiento, idEmpresa },
    include: incluirMovimientoTelaColor,
  });
  if (m === null || !m.detallesTela.some((d) => d.idTelaColor !== null)) {
    throw new ErrorNoEncontrado('Movimiento de tela por color', idMovimiento);
  }
  return aMovimientoTelaColorSalida(m, verImportes);
}

// ── Operaciones de ESCRITURA ─────────────────────────────────────────────────────────────────────

/** Datos de un ajuste por color. */
export type EntradaAjusteTelaColor = z.input<typeof esquemaAjusteTelaColorCrear>;
/** Datos de una salida por color a orden. */
export type EntradaSalidaTelaColor = z.input<typeof esquemaSalidaTelaColorCrear>;
/** Datos de un traspaso por color. */
export type EntradaTraspasoTelaColor = z.input<typeof esquemaTraspasoTelaColorCrear>;
/** Datos de una salida por color que NO va a ninguna orden (fila 0.104). */
export type EntradaSalidaTelaColorSinOrden = z.input<typeof esquemaSalidaTelaColorSinOrdenCrear>;

/**
 * Registra un AJUSTE de inventario de tela POR COLOR (conteo físico / arranque desde cero /
 * corrección). El tipo de movimiento define la dirección. Una ENTRADA crea UNA PARTIDA por
 * renglón (folio atómico A3 — primero los folios `partida-tela`, luego el del movimiento — +
 * `loteProveedor` del renglón + `factura` del encabezado) en la MISMA transacción (A2). Una
 * SALIDA valida no-negativo de AMBOS componentes bajo lock (D3) y NO lleva partida ni
 * `loteProveedor`. Motivo OBLIGATORIO (A7). Permiso `inventario-telas.mover` (A4). RECHAZA
 * `traspaso` (va por {@link traspasarTelaColor}).
 */
export async function ajustarInventarioTelaColor(
  sesion: SesionUsuario,
  entrada: EntradaAjusteTelaColor,
  bd?: ContextoBd,
): Promise<MovimientoTelaColorSalida> {
  verificarPermiso(sesion, 'inventario-telas.mover');
  const datos = validarEntrada(esquemaAjusteTelaColorCrear, entrada);
  const idEmpresa = sesion.idEmpresaActiva;
  const verImportes = tienePermiso(sesion, 'telas.ver-totales');

  const idMovimiento = await enTransaccion(async (tx) => {
    // Fila 0.137 — el almacén del ajuste tiene que ser de TELA (además de existir, estar activo y
    // ser de esta empresa, A9). Antes no se miraba nada de eso aquí.
    await exigirAlmacenDelTipo(tx, datos.idAlmacen, 'TELA', idEmpresa);
    // Fila 0.104 — un ajuste NO puede estampar «Devolución a Proveedor» ni «Venta de Material»:
    // esos dos rótulos sólo los escribe la salida sin orden, que exige la llave del dueño. Y desde
    // la 0.171 tampoco los que escribe SÓLO el sistema (`error-*`, recibo, entrega, merma).
    await rechazarTipoReservado(tx, datos.idTipoMov);
    const tipo = await tipoPorId(tx, datos.idTipoMov);
    if (tipo.direccion === DireccionMovimiento.traspaso) {
      throw new ErrorValidacion(
        'Un tipo de movimiento de dirección "traspaso" no es un ajuste: usa el traspaso entre almacenes.',
      );
    }
    const esEntrada = tipo.direccion === DireccionMovimiento.entrada;
    // En ENTRADA el MISMO tela+color puede venir en varios renglones (una factura con dos lotes
    // del mismo color = dos partidas — DECISIONES §Post-F9.11 punto 4). En salida NO (no hay
    // partida que los distinga).
    const colores = await resolverColores(tx, datos.lineas, { permitirRepetidos: esEntrada });

    let idPartidaPorLinea: (number | null)[] | undefined;
    if (esEntrada) {
      // ENTRADA: crea la partida de cada RENGLÓN (unidad de entrada, opción B de Daniel) — por
      // índice, porque un color repetido lleva partidas distintas.
      idPartidaPorLinea = [];
      for (const linea of datos.lineas) {
        const partida = await crearPartidaTela(tx, sesion, {
          idEmpresa,
          idTelaColor: linea.idTelaColor,
          loteProveedor: linea.loteProveedor,
          factura: datos.factura,
          fecha: datos.fecha,
        });
        idPartidaPorLinea.push(partida.id);
      }
    } else {
      // SALIDA de ajuste: sin partida (el consumo empareja por color) y sin lote del proveedor.
      if (datos.lineas.some((l) => l.loteProveedor !== undefined && l.loteProveedor !== '')) {
        throw new ErrorValidacion(
          'El lote del proveedor solo se captura en ajustes de ENTRADA (la partida es la unidad de entrada).',
        );
      }
      await validarNoNegativoTelaColor(tx, idEmpresa, datos.idAlmacen, datos.lineas, colores);
    }

    const movimiento = await registrarMovimientoTelaMotor(
      sesion,
      {
        idEmpresa,
        idTipoMov: datos.idTipoMov,
        idAlmacen: datos.idAlmacen,
        fecha: aDateColumna(datos.fecha),
        origenTipo: ORIGEN.movimientoManual,
        lineas: aLineasMotor(datos.lineas, colores, idPartidaPorLinea),
        observaciones: datos.motivo,
      },
      { tx },
    );
    return movimiento.id;
  }, bd);

  return obtenerMovimientoTelaColor(idMovimiento, idEmpresa, verImportes, bd);
}

// ── CONTEO FÍSICO por COLOR (capturar LO CONTADO, no la resta — fila 0.098) ──────────────────────
//
// Daniel: «capturar lo contado, con el saldo del sistema a la vista, y que el sistema calcule y
// aplique la diferencia». La pantalla «Ajuste de telas por color» —con la que se va a INICIALIZAR
// todo el inventario de telas el día del arranque— pedía la RESTA: una entrada o una salida con su
// cantidad. Para ajustar había que ir a otra pantalla, ver la existencia, restar de cabeza y volver
// con el signo correcto.
//
// El PATRÓN se copia del CONTEO CÍCLICO de producto terminado (`indicadores/inventario-ciclico.ts`,
// F7-E5), que ya hace exactamente esto: lee el teórico bajo lock, captura lo CONTADO, calcula la
// diferencia y la aplica como MOVIMIENTO de kardex (D3) — jamás una escritura de la existencia; y
// agrupa los deltas del mismo signo en UN movimiento por almacén para no explotar el folio. Lo que
// NO se reusa es su MOTOR: el del cíclico es de producto terminado (modelo×color×talla×orden, con
// sus tablas, sus estados y su conteo ciego). Extenderlo a telas y avíos es otra fila (0.099).

/** Lo que se contó de un color (la forma MÍNIMA que la aritmética necesita). */
export interface LineaConteoBase {
  idTelaColor: number;
  contadoCuerpo: number;
  contadoComplemento?: number | undefined;
}

/** El saldo del sistema de un color en el almacén, ya leído bajo lock. */
export interface SaldoConteo {
  cuerpo: number;
  complemento: number;
}

/** Lo que sale de la aritmética del conteo: las dos patas + el detalle que se le devuelve al que contó. */
export interface DeltasConteo {
  /** FALTANTES (contado > sistema) → un solo movimiento de ENTRADA. */
  entradas: LineaColorBase[];
  /** Índice EN `lineas` de cada renglón de `entradas` (para amarrarle su `loteProveedor`/partida). */
  indicesEntradas: number[];
  /** SOBRANTES (contado < sistema) → un solo movimiento de SALIDA. */
  salidas: LineaColorBase[];
  /** Teórico vs contado vs diferencia, renglón por renglón (lo que se le enseña al usuario). */
  renglones: ConteoTelaColorRenglonSalida[];
}

/**
 * Escala decimal de `MovimientoDetTela.cantidad` / `cantidad_complemento` (`Decimal(14,4)`): la
 * diferencia se redondea a ELLA antes de decidir si hay movimiento.
 *
 * ⚠️ El ruido NO viene del saldo: la Σ la hace Postgres con decimales EXACTOS y llega con 4
 * decimales limpios. Nace aquí, en la RESTA en coma flotante de dos valores limpios —
 * `130.1 − 100.2` da `29.89999999999999`, no `29.9`—, y sin redondear se aplicaría un movimiento
 * con más decimales de los que la columna guarda… o, peor, un movimiento de 1e-15 cuando el conteo
 * en realidad cuadraba: un renglón de kardex que no dice nada y un conteo que "no cuadra" para
 * siempre.
 */
const ESCALA_CANTIDAD_TELA = 4;

/** Redondea a la escala de la columna (evita el ruido de coma flotante de las Σ de decimales). */
function aEscala(valor: number): number {
  const factor = 10 ** ESCALA_CANTIDAD_TELA;
  return Math.round(valor * factor) / factor;
}

/**
 * ARITMÉTICA PURA del conteo (sin BD, sin sesión): diferencia = CONTADO − TEÓRICO por componente, y
 * reparto en las dos patas.
 *
 * ⚠️ **Los CUATRO cuadrantes, porque cada componente decide su pata por separado.** Un movimiento
 * tiene UNA dirección y el cuerpo y el complemento viajan en el MISMO renglón, así que un color
 * cabe en las dos patas a la vez:
 *
 * |                        | complemento falta (+) | complemento cuadra (0) | complemento sobra (−) |
 * |------------------------|-----------------------|------------------------|-----------------------|
 * | **cuerpo falta (+)**   | sólo ENTRADA          | sólo ENTRADA           | ENTRADA + SALIDA      |
 * | **cuerpo cuadra (0)**  | sólo ENTRADA          | ninguna                | sólo SALIDA           |
 * | **cuerpo sobra (−)**   | ENTRADA + SALIDA      | sólo SALIDA            | sólo SALIDA           |
 *
 * Las dos diagonales cruzadas son SIMÉTRICAS y las dos existen: «sobra cuerpo / falta complemento»
 * y su ESPEJO «cuadra o falta cuerpo / sobra complemento». Escribir sólo una era, literalmente, la
 * trampa de la rama gemela: el reviewer quitó el disyuntor `difComplemento < 0` de la pata de
 * salida y las 14 pruebas seguían verdes, porque ningún caso tenía un complemento sobrante sin un
 * cuerpo sobrante que lo tapara.
 *
 * ⚠️ Telas SIN complemento: el complemento NO entra en la cuenta —ni siquiera para bajarlo a 0—.
 * La pantalla no pide ese número, así que fabricar un movimiento con él sería inventar un dato que
 * nadie contó. Si una fila vieja dejó ahí un saldo fantasma se TOLERA, no se compensa (REGLA 0-B).
 */
export function calcularDeltasConteo(
  lineas: readonly LineaConteoBase[],
  saldos: ReadonlyMap<number, SaldoConteo>,
  colores: ReadonlyMap<number, ColorConTela>,
): DeltasConteo {
  const entradas: LineaColorBase[] = [];
  const indicesEntradas: number[] = [];
  const salidas: LineaColorBase[] = [];
  const renglones: ConteoTelaColorRenglonSalida[] = [];

  lineas.forEach((linea, indice) => {
    const color = colores.get(linea.idTelaColor);
    const saldo = saldos.get(linea.idTelaColor);
    if (color === undefined || saldo === undefined) {
      throw new ErrorNoEncontrado('TelaColor', linea.idTelaColor);
    }
    const llevaComplemento = color.nombreComplemento !== null;

    const teoricoCuerpo = aEscala(saldo.cuerpo);
    const contadoCuerpo = aEscala(linea.contadoCuerpo);
    const teoricoComplemento = llevaComplemento ? aEscala(saldo.complemento) : 0;
    const contadoComplemento = llevaComplemento ? aEscala(linea.contadoComplemento ?? 0) : 0;

    const difCuerpo = aEscala(contadoCuerpo - teoricoCuerpo);
    const difComplemento = aEscala(contadoComplemento - teoricoComplemento);

    if (difCuerpo > 0 || difComplemento > 0) {
      entradas.push({
        idTelaColor: linea.idTelaColor,
        cantidad: Math.max(difCuerpo, 0),
        ...(llevaComplemento ? { cantidadComplemento: Math.max(difComplemento, 0) } : {}),
      });
      indicesEntradas.push(indice);
    }
    if (difCuerpo < 0 || difComplemento < 0) {
      salidas.push({
        idTelaColor: linea.idTelaColor,
        cantidad: Math.max(-difCuerpo, 0),
        ...(llevaComplemento ? { cantidadComplemento: Math.max(-difComplemento, 0) } : {}),
      });
    }

    renglones.push({
      idTelaColor: linea.idTelaColor,
      idTela: color.idTela,
      tela: color.nombreTela,
      telaColor: color.nombreColor,
      nombreComplemento: color.nombreComplemento,
      teoricoCuerpo,
      contadoCuerpo,
      diferenciaCuerpo: difCuerpo,
      teoricoComplemento,
      contadoComplemento,
      diferenciaComplemento: difComplemento,
    });
  });

  return { entradas, indicesEntradas, salidas, renglones };
}

/** Tope de colores por consulta: la pantalla pide sus renglones de golpe, pero no es un volcado. */
const MAX_COLORES_POR_CONSULTA = 500;

/**
 * Mayor valor que cabe en la columna: `TelaColor.id` es `Int` de Prisma = **int4** en Postgres.
 * Un id por encima de esto NO es "un color que no existe": es un valor que la columna no puede
 * ni comparar, y llega hasta el `findMany` para reventar en la capa de DATOS con un error que no
 * es el 400 que le toca.
 */
const MAX_ID_INT4 = 2_147_483_647;

/**
 * Trocea la lista de colores del querystring (`"11,21,33"`) a ids DISTINTOS y ORDENADOS. Vive en el
 * dominio, no en el esquema: el contrato declara un `string` porque eso es lo que viaja por la URL
 * (y lo que el cliente generado sabe serializar), y aquí se valida lo que de verdad significa.
 *
 * ⚠️ **Los tres rechazos son DIAGNÓSTICOS DISTINTOS, y ninguno cita el número ya convertido.** El
 * texto que se devuelve es SIEMPRE el que se tecleó (`p`), nunca `Number(p)`: en el caso de la
 * precisión perdida son cosas distintas, y echarle en cara al usuario un número que él no escribió
 * es justo el error que esta rama viene a evitar.
 *
 *  1. **No es un entero positivo** (`''`, `'x'`, `'-3'`, `'0'`, `'2.5'`) — la forma está mal.
 *  2. **No se puede representar con exactitud** (`'9007199254740993'` → JavaScript lo convierte a
 *     `…992` **sin avisar**, porque pasa de `Number.MAX_SAFE_INTEGER`). Es el peor de los tres: no
 *     truena, MIENTE. Se caza con {@link Number.isSafeInteger} y se nombra aparte para que el
 *     mensaje diga la verdad de lo que pasó.
 *  3. **No cabe en la columna** (`'2147483648'`, int4 máx + 1). Éste es el que de verdad protege la
 *     consulta —los tres casos lo superan—, pero por sí solo diagnosticaría mal el caso 2.
 */
export function idsDeColorPedidos(lista: string): number[] {
  const partes = lista
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (partes.length === 0) {
    throw new ErrorValidacion('Indica al menos un color de tela.');
  }
  for (const parte of partes) {
    if (!/^\d+$/.test(parte) || Number(parte) <= 0) {
      throw new ErrorValidacion(
        'Los colores de tela van como ids enteros positivos separados por comas.',
      );
    }
    const numero = Number(parte);
    if (!Number.isSafeInteger(numero)) {
      throw new ErrorValidacion(
        `El color de tela «${parte}» es un número demasiado grande para manejarlo con exactitud.`,
      );
    }
    if (numero > MAX_ID_INT4) {
      throw new ErrorValidacion(`El color de tela «${parte}» está fuera del rango de ids válidos.`);
    }
  }
  const ids = [...new Set(partes.map((p) => Number(p)))].sort((a, b) => a - b);
  if (ids.length > MAX_COLORES_POR_CONSULTA) {
    throw new ErrorValidacion(
      `Demasiados colores en una sola consulta (máx ${String(MAX_COLORES_POR_CONSULTA)}).`,
    );
  }
  return ids;
}

/** Parámetros de los saldos para el conteo (forma de dominio). */
export type ParametrosSaldosTelaColor = z.input<typeof esquemaSaldosTelaColorQuery>;

/**
 * SALDOS del sistema de VARIOS tela-color en un almacén, por Σ DIRECTA de `MovimientoDetTela` —
 * **NUNCA** la vista `existencia_tela_color` (D3/ADR-0010 §3) — en UNA sola consulta.
 *
 * Es la columna «Sistema» de la pantalla de conteo, y suma con la MISMA aritmética que
 * {@link registrarConteoTelaColor} usa al aplicar la diferencia: el fragmento SQL vive UNA sola vez
 * en `comun/kardex.ts` (`SUMAS_TELA_COLOR`), compartido por el lector bajo lock y por éste, para
 * que no puedan divergir.
 *
 * 🔴 SIN LOCK, a propósito (corrección del reviewer). Un `pg_advisory_xact_lock` exclusivo aquí no
 * añadía garantía —bajo Read Committed la Σ ya lee un snapshot consistente, y el lock se soltaba al
 * commit de la propia lectura, o sea ANTES de que el usuario tecleara nada— y en cambio serializaba
 * una consulta: cargar el inventario del arranque son cientos de renglones. Lo que de verdad impide
 * "dos personas ajustando contra un saldo viejo" es que el delta se RECALCULA bajo lock al aplicar.
 *
 * Un color sin ningún movimiento devuelve `0/0` — **no se omite**: el `GROUP BY` no lo trae y el
 * relleno a 0 lo pone de vuelta (ver el comentario del `map`). Permiso `inventario-telas.ver`;
 * empresa activa (A9).
 */
export async function saldosTelaColorParaConteo(
  sesion: SesionUsuario,
  parametros: ParametrosSaldosTelaColor,
  bd?: ContextoBd,
): Promise<SaldosTelaColorSalida> {
  verificarPermiso(sesion, 'inventario-telas.ver');
  const filtros = validarEntrada(esquemaSaldosTelaColorQuery, parametros);
  const idEmpresa = sesion.idEmpresaActiva;
  const cliente = clienteLectura(bd);

  const ids = idsDeColorPedidos(filtros.idTelaColor);

  const colores = await cliente.telaColor.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      nombre: true,
      tela: { select: { id: true, nombre: true, nombreComplemento: true } },
    },
  });
  const porId = new Map(colores.map((c) => [c.id, c]));
  for (const id of ids) {
    if (!porId.has(id)) throw new ErrorNoEncontrado('TelaColor', id);
  }

  const existencias = await existenciasTelaColorPorColor(
    cliente,
    idEmpresa,
    filtros.idAlmacen,
    ids,
  );
  const porColor = new Map(existencias.map((e) => [e.idTelaColor, e]));

  return {
    idAlmacen: filtros.idAlmacen,
    // ⚠️ SE RECORREN LOS `ids` PEDIDOS, no las filas que volvieron. El `GROUP BY` **omite** los
    // colores sin NINGÚN movimiento, y en la pantalla del arranque «sin dato» y «cero» NO son lo
    // mismo: un color que nunca se ha movido tiene que enseñar 0, no blanco ni `undefined`. Si esto
    // se recorriera sobre `existencias`, los colores nuevos —justo los del arranque— desaparecerían
    // del renglón en silencio.
    saldos: ids.map((id) => {
      const color = porId.get(id);
      if (color === undefined) throw new ErrorNoEncontrado('TelaColor', id);
      const existencia = porColor.get(id);
      const llevaComplemento = color.tela.nombreComplemento !== null;
      return {
        idTelaColor: id,
        idTela: color.tela.id,
        tela: color.tela.nombre,
        telaColor: color.nombre,
        cuerpo: existencia?.cuerpo ?? 0,
        // Una tela sin complemento no tiene complemento que enseñar (aunque una fila vieja hubiera
        // dejado algo ahí): la pantalla no pide ese número y el conteo no lo mueve.
        complemento: llevaComplemento ? (existencia?.complemento ?? 0) : 0,
        nombreComplemento: color.tela.nombreComplemento,
      };
    }),
  };
}

/** Datos de un conteo por color. */
export type EntradaConteoTelaColor = z.input<typeof esquemaConteoTelaColorCrear>;

/**
 * Registra un CONTEO FÍSICO de tela POR COLOR: se captura LO CONTADO y el servidor calcula y aplica
 * la DIFERENCIA. Todo en UNA transacción (A2):
 *
 *  1. Resuelve los colores y valida las reglas del complemento (`resolverColores`). Un color NO se
 *     puede repetir: se cuenta UNA vez por almacén — dos renglones del mismo color se restarían dos
 *     veces contra el MISMO teórico y podrían dejar la existencia en negativo.
 *  2. Toma el lock de cada color (orden DETERMINISTA por `idTelaColor`, como
 *     `validarNoNegativoTelaColor`, para no interbloquear con operaciones cruzadas) y lee su saldo
 *     por Σ DIRECTA (`existenciaTelaColorBloqueada`), NUNCA la vista (D3).
 *  3. Calcula los deltas ({@link calcularDeltasConteo}) y los aplica como MOVIMIENTOS de kardex:
 *     uno de `ajuste-entrada` con todos los FALTANTES y uno de `ajuste-salida` con todos los
 *     SOBRANTES (patrón `generarAjusteCiclico`). Un conteo que cuadra en todo NO escribe nada.
 *
 * La pata de ENTRADA crea UNA PARTIDA por renglón (la partida es la unidad de entrada: así el
 * arranque desde cero —existencia 0, se cuenta X— nace con su partida y su lote del proveedor
 * opcional). La de SALIDA no lleva partida.
 *
 * ⚠️ Por qué las salidas del conteo NO repiten la validación de `validarNoNegativoTelaColor`: la
 * cantidad a sacar es `teórico − contado` con `contado ≥ 0` (Zod), o sea A LO MÁS EL TEÓRICO
 * ENTERO, leído bajo el MISMO lock que esta transacción conserva hasta el commit. Frente a todo lo
 * que TOMA ESE LOCK (otro conteo, una salida a orden, un traspaso), el resultado no puede quedar
 * negativo; y el único hueco interno del razonamiento —el mismo color contado dos veces, dos restas
 * contra el mismo teórico— lo cierra `resolverColores` en el paso 1.
 *
 * 🔴 Lo que ese lock NO cubre, y no es de esta función: `cancelarMovimientoMaterial` NO toma el
 * lock del color y, por diseño, NO valida no-negativo (es un inverso de corrección). Una
 * cancelación concurrente de una entrada puede, por tanto, dejar el saldo negativo — exactamente
 * igual que puede hacerlo hoy contra `validarNoNegativoTelaColor`. Es una propiedad del módulo, no
 * una que este conteo introduzca ni pueda arreglar por su cuenta.
 *
 * Motivo OBLIGATORIO (A7). Permiso `inventario-telas.mover` (A4). Empresa activa (A9).
 */
export async function registrarConteoTelaColor(
  sesion: SesionUsuario,
  entrada: EntradaConteoTelaColor,
  bd?: ContextoBd,
): Promise<ConteoTelaColorSalida> {
  verificarPermiso(sesion, 'inventario-telas.mover');
  const datos = validarEntrada(esquemaConteoTelaColorCrear, entrada);
  const idEmpresa = sesion.idEmpresaActiva;
  const verImportes = tienePermiso(sesion, 'telas.ver-totales');

  const resultado = await enTransaccion(async (tx) => {
    // Fila 0.137 — el conteo físico se hace SOBRE un almacén de TELA. Va lo primero: no tiene
    // sentido tomar locks por color de un almacén que ni siquiera guarda tela.
    await exigirAlmacenDelTipo(tx, datos.idAlmacen, 'TELA', idEmpresa);
    // El complemento capturado en una tela que no lo lleva se rechaza aquí (misma regla que el
    // ajuste); los colores repetidos también — ver el aviso del no-negativo de arriba.
    const colores = await resolverColores(
      tx,
      datos.lineas.map((l) => ({
        idTelaColor: l.idTelaColor,
        cantidad: l.contadoCuerpo,
        cantidadComplemento: l.contadoComplemento,
      })),
    );

    // Saldos BAJO LOCK, en orden determinista por idTelaColor (anti-deadlock).
    const saldos = new Map<number, SaldoConteo>();
    for (const idTelaColor of [...new Set(datos.lineas.map((l) => l.idTelaColor))].sort(
      (a, b) => a - b,
    )) {
      await bloquearTelaColor(tx, idEmpresa, datos.idAlmacen, idTelaColor);
      saldos.set(
        idTelaColor,
        await existenciaTelaColorBloqueada(tx, idEmpresa, datos.idAlmacen, idTelaColor),
      );
    }

    const deltas = calcularDeltasConteo(datos.lineas, saldos, colores);

    const almacen = await tx.almacen.findUnique({
      where: { id: datos.idAlmacen },
      select: { nombre: true },
    });
    if (almacen === null) {
      throw new ErrorNoEncontrado('Almacen', datos.idAlmacen);
    }

    // Un conteo que cuadra en TODO no escribe movimiento: un kardex con renglones de 0 no dice
    // nada y ensuciaría el folio.
    if (deltas.entradas.length === 0 && deltas.salidas.length === 0) {
      return {
        almacen: almacen.nombre,
        renglones: deltas.renglones,
        idEntrada: null,
        idSalida: null,
      };
    }

    // ⚠️ Orden de folios (`comun/secuencias.ts`): PRIMERO las partidas (`partida-tela`), luego los
    // movimientos — el MISMO orden que el ajuste, para no interbloquear transacciones cruzadas.
    let idPartidaPorLinea: (number | null)[] | undefined;
    if (deltas.entradas.length > 0) {
      idPartidaPorLinea = [];
      for (const indice of deltas.indicesEntradas) {
        const linea = datos.lineas[indice];
        // Un índice fuera de rango sólo puede venir de un error de programación en el reparto; se
        // revienta en vez de caer a un `?? 0` que crearía la partida contra un color inexistente.
        if (linea === undefined) {
          throw new ErrorValidacion('Renglón de conteo inconsistente al crear su partida.');
        }
        const partida = await crearPartidaTela(tx, sesion, {
          idEmpresa,
          idTelaColor: linea.idTelaColor,
          loteProveedor: linea.loteProveedor,
          factura: datos.factura,
          fecha: datos.fecha,
        });
        idPartidaPorLinea.push(partida.id);
      }
    }

    const observaciones = `Conteo físico — ${datos.motivo}`;

    let idSalida: number | null = null;
    if (deltas.salidas.length > 0) {
      const tipoSalida = await tipoPorCodigo(tx, COD_AJUSTE_SALIDA);
      const mov = await registrarMovimientoTelaMotor(
        sesion,
        {
          idEmpresa,
          idTipoMov: tipoSalida.id,
          idAlmacen: datos.idAlmacen,
          fecha: aDateColumna(datos.fecha),
          origenTipo: ORIGEN.conteoTela,
          lineas: aLineasMotor(deltas.salidas, colores),
          observaciones,
        },
        { tx },
      );
      idSalida = mov.id;
    }

    let idEntrada: number | null = null;
    if (deltas.entradas.length > 0) {
      const tipoEntrada = await tipoPorCodigo(tx, COD_AJUSTE_ENTRADA);
      const mov = await registrarMovimientoTelaMotor(
        sesion,
        {
          idEmpresa,
          idTipoMov: tipoEntrada.id,
          idAlmacen: datos.idAlmacen,
          fecha: aDateColumna(datos.fecha),
          origenTipo: ORIGEN.conteoTela,
          lineas: aLineasMotor(deltas.entradas, colores, idPartidaPorLinea),
          observaciones,
        },
        { tx },
      );
      idEntrada = mov.id;
    }

    return { almacen: almacen.nombre, renglones: deltas.renglones, idEntrada, idSalida };
  }, bd);

  return {
    idAlmacen: datos.idAlmacen,
    almacen: resultado.almacen,
    fecha: datos.fecha,
    sinDiferencias: resultado.idEntrada === null && resultado.idSalida === null,
    renglones: resultado.renglones,
    entrada:
      resultado.idEntrada === null
        ? null
        : await obtenerMovimientoTelaColor(resultado.idEntrada, idEmpresa, verImportes, bd),
    salida:
      resultado.idSalida === null
        ? null
        : await obtenerMovimientoTelaColor(resultado.idSalida, idEmpresa, verImportes, bd),
  };
}

/**
 * Registra una SALIDA de tela POR COLOR hacia una orden de producción. El consumo empareja por
 * TELA+COLOR (NO pide partida — Daniel §Post-F9.9). Valida que la orden exista en la empresa
 * activa (A9) y que NINGUNO de los dos componentes quede negativo (D3, bajo lock). Conserva la
 * traza `origenTipo = salida-tela-orden` + `origenId = idOrden`. Desde la fila 0.170 es la ÚNICA
 * salida de tela a orden que se puede capturar: su gemela vieja `registrarSalidaTelaAOrden` (flujo
 * Lote) se quedó SIN RUTA REST. Permiso `inventario-telas.mover`.
 */
export async function registrarSalidaTelaColorAOrden(
  sesion: SesionUsuario,
  entrada: EntradaSalidaTelaColor,
  bd?: ContextoBd,
): Promise<MovimientoTelaColorSalida> {
  verificarPermiso(sesion, 'inventario-telas.mover');
  const datos = validarEntrada(esquemaSalidaTelaColorCrear, entrada);
  const idEmpresa = sesion.idEmpresaActiva;
  const verImportes = tienePermiso(sesion, 'telas.ver-totales');

  const idMovimiento = await enTransaccion(async (tx) => {
    const orden = await tx.orden.findFirst({
      where: { id: datos.idOrden, idEmpresa },
      select: { id: true },
    });
    if (orden === null) {
      throw new ErrorNoEncontrado('Orden', datos.idOrden);
    }
    // Fila 0.137 — la tela sale de un almacén de TELA, no de uno de PT ni de avíos.
    await exigirAlmacenDelTipo(tx, datos.idAlmacen, 'TELA', idEmpresa);
    const tipo = await tipoPorCodigo(tx, COD_SALIDA_A_ORDEN);
    const colores = await resolverColores(tx, datos.lineas);
    await validarNoNegativoTelaColor(tx, idEmpresa, datos.idAlmacen, datos.lineas, colores);

    const movimiento = await registrarMovimientoTelaMotor(
      sesion,
      {
        idEmpresa,
        idTipoMov: tipo.id,
        idAlmacen: datos.idAlmacen,
        fecha: aDateColumna(datos.fecha),
        origenTipo: ORIGEN.salidaTelaOrden,
        origenId: String(datos.idOrden),
        lineas: aLineasMotor(datos.lineas, colores),
        ...(datos.observaciones === undefined ? {} : { observaciones: datos.observaciones }),
      },
      { tx },
    );
    return movimiento.id;
  }, bd);

  return obtenerMovimientoTelaColor(idMovimiento, idEmpresa, verImportes, bd);
}

/**
 * ⭐ Registra una SALIDA de tela POR COLOR que **no va a ninguna orden** (fila 0.104 — DANIEL,
 * §Post-F9.193 resp. 12: *«Lo mismo en telas»*): devolución al proveedor, venta de material que ya
 * no se usa, u otra causa. **Sólo ajusta inventario**: no toca compras, CxP ni facturación.
 *
 * Es una salida de kardex como cualquier otra (D3) y por eso reusa TODO lo de esta casa: el mismo
 * `resolverColores` (con las reglas del complemento), el MISMO `validarNoNegativoTelaColor` (bajo
 * `pg_advisory_xact_lock` + suma directa de `MovimientoDetTela`, nunca la vista) y el mismo motor
 * `registrarMovimientoTela`. Lo único propio son las tres decisiones de la fila:
 *
 *  • **Quién** — `salida-material.registrar`, la llave del dueño, NO `inventario-telas.mover`
 *    (`salida-sin-orden.ts` explica por qué). Se exige lo PRIMERO, antes de validar la captura.
 *  • **Por qué** — el `concepto` elige un tipo de movimiento DEDICADO, para que el kardex sepa
 *    distinguir una devolución de una venta y las dos de un ajuste de conteo.
 *  • **Traza** — `origenTipo = salida-sin-orden` y SIN `origenId` (no hay entidad detrás). Eso es
 *    lo que después obliga a tener la misma llave para CANCELARLA.
 *
 * Sin partida (`idPartida` NULL: el consumo empareja por tela+color) y con motivo OBLIGATORIO, que
 * va a las observaciones del movimiento (A7). ⚠️ **Ya NO vale decir «como toda salida»**: desde la
 * fila 0.142 la **pata de salida del traspaso SÍ nombra el lote** (se reparte FIFO). Las que siguen
 * sin nombrarlo son ésta, la salida a orden, la pata de sobrante del conteo, el ajuste de salida y
 * el ajuste de salida del cíclico.
 */
export async function registrarSalidaTelaColorSinOrden(
  sesion: SesionUsuario,
  entrada: EntradaSalidaTelaColorSinOrden,
  bd?: ContextoBd,
): Promise<MovimientoTelaColorSalida> {
  exigirPermisoSalidaSinOrden(sesion);
  const datos = validarEntrada(esquemaSalidaTelaColorSinOrdenCrear, entrada);
  const idEmpresa = sesion.idEmpresaActiva;
  const verImportes = tienePermiso(sesion, 'telas.ver-totales');

  const idMovimiento = await enTransaccion(async (tx) => {
    // La tela sale de un almacén de TELA, y de uno usable por ESTA empresa (A9 — fila 0.137).
    await exigirAlmacenDelTipo(tx, datos.idAlmacen, 'TELA', idEmpresa);
    const tipo = await tipoPorCodigo(tx, CODIGO_TIPO_MOV_POR_CONCEPTO[datos.concepto]);
    const colores = await resolverColores(tx, datos.lineas);
    await validarNoNegativoTelaColor(tx, idEmpresa, datos.idAlmacen, datos.lineas, colores);

    const movimiento = await registrarMovimientoTelaMotor(
      sesion,
      {
        idEmpresa,
        idTipoMov: tipo.id,
        idAlmacen: datos.idAlmacen,
        fecha: aDateColumna(datos.fecha),
        origenTipo: ORIGEN.salidaSinOrden,
        lineas: aLineasMotor(datos.lineas, colores),
        observaciones: datos.motivo,
      },
      { tx },
    );
    return movimiento.id;
  }, bd);

  return obtenerMovimientoTelaColor(idMovimiento, idEmpresa, verImportes, bd);
}

/**
 * Registra un TRASPASO de tela POR COLOR entre dos almacenes de la empresa activa: DOS patas
 * atómicas (salida del origen + entrada al destino) en UNA transacción (A2, patrón
 * `registrarTraspasoTela`), con AMBAS cantidades juntas. Valida que el ORIGEN aguante los dos
 * componentes (D3, bajo lock). Permiso `inventario-telas.mover`.
 *
 * ⭐⭐ **EL LOTE VIAJA EN EL TRASPASO** (fila 0.142 — Daniel §Post-F9.201 punto 1). Hasta la 0.141
 * las dos patas se escribían con `idPartida = NULL` («no son entradas de compra»), y eso dejaba
 * ciego el aviso de riesgo de tono **justo donde hace falta**: al almacén DEL CORTADOR —donde
 * arranca la pantalla de salida de tela— la tela llega casi siempre traspasada, así que el sistema
 * nunca sabía de qué lotes era lo que había en el anaquel. Ahora el reparto se calcula **FIFO por
 * folio de partida** ({@link repartirPorPartidaFifo}) sobre el saldo por lote del ORIGEN, y el
 * renglón expandido viaja igual a las dos patas: la salida descuenta del lote y la entrada lo
 * nombra en el destino.
 *
 * 🔴 **EL REPARTO SE CALCULA DENTRO DE LA TRANSACCIÓN Y DESPUÉS DEL LOCK**, nunca antes:
 * {@link validarNoNegativoTelaColor} toma `pg_advisory_xact_lock` por empresa+almacén+color en
 * orden determinista. Calcularlo fuera del lock haría que dos traspasos simultáneos repartieran el
 * mismo lote dos veces **en silencio**, y el saldo por lote se iría a negativo sin que nada lo
 * validara (la validación de no-negativo es por COLOR, no por lote).
 *
 * ⚠️ **Lo que ninguna partida explique viaja SIN lote**, sin error: la tela que entró antes de esta
 * fila se queda sin nombre (REGLA 0-B — aditivo, sin backfill) y sigue saliendo por la línea neutra
 * del aviso de tono.
 *
 * 🔴 **Y el reparto va ACOTADO A LA EXISTENCIA REAL del origen** (la que la validación de no-negativo
 * acaba de leer bajo lock, y que por eso devuelve). Sin ese tope el traspaso puede nombrar un lote
 * **que ya se consumió** —porque las salidas a orden no lo descuentan— y mandar al cortador, y al
 * papel, un nombre falso. El porqué completo y lo que el tope NO cura, en
 * {@link repartirPorPartidaFifo}.
 */
export async function traspasarTelaColor(
  sesion: SesionUsuario,
  entrada: EntradaTraspasoTelaColor,
  bd?: ContextoBd,
): Promise<TraspasoTelaColorSalida> {
  verificarPermiso(sesion, 'inventario-telas.mover');
  const datos = validarEntrada(esquemaTraspasoTelaColorCrear, entrada);
  const idEmpresa = sesion.idEmpresaActiva;
  const verImportes = tienePermiso(sesion, 'telas.ver-totales');

  if (datos.idAlmacenOrigen === datos.idAlmacenDestino) {
    throw new ErrorValidacion(
      'El traspaso necesita un almacén de origen y otro de destino distintos.',
    );
  }

  const { idSalida, idEntrada } = await enTransaccion(async (tx) => {
    const tipoSalida = await tipoPorCodigo(tx, COD_TRANSFERENCIA_SALIDA);
    const tipoEntrada = await tipoPorCodigo(tx, COD_TRANSFERENCIA_ENTRADA);
    // Fila 0.137 — LOS DOS extremos del traspaso deben ser de TELA.
    await exigirAlmacenDelTipo(tx, datos.idAlmacenOrigen, 'TELA', idEmpresa);
    await exigirAlmacenDelTipo(tx, datos.idAlmacenDestino, 'TELA', idEmpresa);
    const colores = await resolverColores(tx, datos.lineas);
    // La existencia que devuelve viene leída BAJO EL LOCK que ella misma toma: es la que acota el
    // reparto (ronda de corrección de la 0.142). Volver a leerla aparte sería una segunda Σ.
    const existencias = await validarNoNegativoTelaColor(
      tx,
      idEmpresa,
      datos.idAlmacenOrigen,
      datos.lineas,
      colores,
    );

    // ⭐ Fila 0.142 — de qué lotes sale la tela que se mueve. VA AQUÍ, después del lock que acaba de
    // tomar la validación de no-negativo (ver la cabecera): el saldo por lote se lee y se reparte
    // con los colores del origen ya bloqueados, así que dos traspasos no se pisan el mismo lote.
    const saldosOrigen = await saldosPorPartidaTela(
      tx,
      idEmpresa,
      datos.idAlmacenOrigen,
      datos.lineas.map((l) => l.idTelaColor),
    );
    const reparto = repartirPorPartidaFifo(datos.lineas, saldosOrigen, existencias);

    const { salida, entrada: entradaMov } = await registrarTraspasoTelaMotor(
      sesion,
      {
        idEmpresa,
        idTipoMovSalida: tipoSalida.id,
        idTipoMovEntrada: tipoEntrada.id,
        idAlmacenOrigen: datos.idAlmacenOrigen,
        idAlmacenDestino: datos.idAlmacenDestino,
        fecha: aDateColumna(datos.fecha),
        // Renglones EXPANDIDOS (uno por lote) con su partida POR ÍNDICE. El motor pasa el MISMO
        // arreglo a las dos patas, así que el lote entra al destino sin tocar `kardex.ts`.
        // ⚠️ Efecto visible: la bitácora (A7) cuenta los renglones EXPANDIDOS, no los capturados —
        // un traspaso de un color que salga de dos lotes queda registrado con 2. Es lo honesto:
        // son los renglones que de verdad se escribieron en el kardex.
        lineas: aLineasMotor(reparto.lineas, colores, reparto.idPartidaPorLinea),
        ...(datos.observaciones === undefined ? {} : { observaciones: datos.observaciones }),
      },
      { tx },
    );
    return { idSalida: salida.id, idEntrada: entradaMov.id };
  }, bd);

  return {
    salida: await obtenerMovimientoTelaColor(idSalida, idEmpresa, verImportes, bd),
    entrada: await obtenerMovimientoTelaColor(idEntrada, idEmpresa, verImportes, bd),
  };
}

/**
 * CANCELA un movimiento por color generando su INVERSO auditado (D3/A7): NUNCA edita ni borra el
 * original. Reusa el motor genérico `cancelarMovimientoMaterial` (que copia TAMBIÉN
 * `idTelaColor`/`idPartida`/`cantidadComplemento` al inverso para que el par se neutralice en la
 * suma por color). `entrada` → inverso `ajuste-salida`; `salida` → inverso `ajuste-entrada`. El
 * inverso es de corrección: NO valida no-negativo. Permiso `inventario-telas.mover`; empresa
 * activa (A9). No se re-cancela ni se cancela una sola pata de un traspaso (motor).
 *
 * ⭐ **Y una llave EXTRA para las salidas sin orden (fila 0.104):** si el movimiento nació de una
 * salida que no iba a ninguna orden (`origenTipo = salida-sin-orden`), cancelarlo devuelve el
 * material al inventario — o sea, deshace la decisión que Daniel se reservó. Para ésas se exige
 * ADEMÁS `salida-material.registrar` (ver `salida-sin-orden.ts`). Para todo lo demás, este
 * permiso no cambia nada.
 */
export async function cancelarMovimientoTelaColor(
  sesion: SesionUsuario,
  idMovimiento: number,
  cuerpo: z.input<typeof esquemaMovimientoMaterialCancelarCuerpo>,
  bd?: ContextoBd,
): Promise<MovimientoTelaColorSalida> {
  verificarPermiso(sesion, 'inventario-telas.mover');
  const datos = validarEntrada(esquemaMovimientoMaterialCancelarCuerpo, cuerpo);
  const idEmpresa = sesion.idEmpresaActiva;
  const verImportes = tienePermiso(sesion, 'telas.ver-totales');

  await enTransaccion(async (tx) => {
    const original = await tx.movimiento.findFirst({
      where: { id: idMovimiento, idEmpresa },
      select: {
        id: true,
        origenTipo: true,
        tipoMov: { select: { direccion: true } },
        idMovimientoInverso: true,
        detallesTela: { select: { idTelaColor: true } },
      },
    });
    if (original === null || !original.detallesTela.some((d) => d.idTelaColor !== null)) {
      throw new ErrorNoEncontrado('Movimiento de tela por color', idMovimiento);
    }
    // Fila 0.104: la marcha atrás de una salida sin orden —y la marcha atrás de esa marcha atrás—
    // piden la MISMA llave que la salida.
    // Fila 0.099 — el ajuste de un cíclico NO se deshace desde Inventarios (la hoja quedaría
    // `cerrado` mientras el kardex dice otra cosa). Misma puerta de atrás que cerró la 0.104.
    exigirCancelableFueraDelCiclico(original.origenTipo);
    await exigirPermisoParaCancelarSalidaSinOrden(tx, sesion, original);
    const codigoInverso =
      original.tipoMov.direccion === DireccionMovimiento.entrada
        ? COD_AJUSTE_SALIDA
        : COD_AJUSTE_ENTRADA;
    const tipoInverso = await tipoPorCodigo(tx, codigoInverso);
    await cancelarMovimientoMaterial(sesion, idMovimiento, tipoInverso.id, { tx });
    await registrarBitacora(tx, sesion, {
      entidad: 'Movimiento',
      idEntidad: idMovimiento,
      accion: 'OTRO',
      datos: { motivoCancelacion: datos.motivo, dimension: 'tela-color' },
    });
  }, bd);

  return obtenerMovimientoTelaColor(idMovimiento, idEmpresa, verImportes, bd);
}

// ── Consultas de SOLO LECTURA ────────────────────────────────────────────────────────────────────

const esquemaConsultaExistenciasTelaColor = z.object({
  idTela: z.number().int().positive().optional(),
  idTelaColor: z.number().int().positive().optional(),
  idAlmacen: z.number().int().positive().optional(),
  idCategoria: z.number().int().positive().optional(),
  idProveedor: z.number().int().positive().optional(),
  busqueda: z.string().trim().max(150).optional(),
  incluirCeros: z.boolean().default(false),
});

/** Parámetros de la consulta de existencias por color (forma de dominio). */
export type ParametrosExistenciasTelaColor = z.input<typeof esquemaConsultaExistenciasTelaColor>;

/** Fila cruda de la vista + joins (una por tela×color×almacén). */
interface FilaExistenciaColor {
  idTela: number;
  tela: string;
  categoria: string | null;
  idProveedor: number | null;
  proveedor: string | null;
  nombreProveedor: string | null;
  unidadMedida: 'KG' | 'M';
  nombreCuerpo: string | null;
  nombreComplemento: string | null;
  idTelaColor: number;
  color: string;
  pantone: string | null;
  idAlmacen: number;
  almacen: string;
  cuerpo: Prisma.Decimal;
  complemento: Prisma.Decimal;
}

/**
 * Consulta las EXISTENCIAS del inventario NUEVO agrupadas TELA PADRE → COLORES hijos (cada color
 * con su desglose por almacén), leyendo la vista `existencia_tela_color` (aquí SÍ se usa la vista
 * — es una CONSULTA, ADR-0010 §3) filtrada por la empresa activa (A9). Filtros: tela, color,
 * almacén, tipo/categoría, proveedor dueño y búsqueda (nombre de tela / nombre del proveedor /
 * color / pantone). Por defecto OMITE los colores con AMBOS componentes en 0. Permiso
 * `inventario-telas.ver`. (Aquí no viajan importes; el ex-acceso #7 aplica al kardex.)
 */
export async function consultarExistenciasTelaColor(
  sesion: SesionUsuario,
  parametros: ParametrosExistenciasTelaColor = {},
  bd?: ContextoBd,
): Promise<ExistenciasTelaColorLista> {
  verificarPermiso(sesion, 'inventario-telas.ver');
  const filtros = validarEntrada(esquemaConsultaExistenciasTelaColor, parametros);
  const cliente = clienteLectura(bd);
  const idEmpresa = sesion.idEmpresaActiva;

  const condiciones: Prisma.Sql[] = [Prisma.sql`e."id_empresa" = ${idEmpresa}`];
  if (filtros.idTela !== undefined) condiciones.push(Prisma.sql`e."id_tela" = ${filtros.idTela}`);
  if (filtros.idTelaColor !== undefined)
    condiciones.push(Prisma.sql`e."id_tela_color" = ${filtros.idTelaColor}`);
  if (filtros.idAlmacen !== undefined)
    condiciones.push(Prisma.sql`e."id_almacen" = ${filtros.idAlmacen}`);
  if (filtros.idCategoria !== undefined)
    condiciones.push(Prisma.sql`te."id_categoria" = ${filtros.idCategoria}`);
  if (filtros.idProveedor !== undefined)
    condiciones.push(Prisma.sql`te."id_proveedor" = ${filtros.idProveedor}`);
  if (filtros.busqueda !== undefined && filtros.busqueda.length > 0) {
    const patron = `%${filtros.busqueda}%`;
    condiciones.push(
      Prisma.sql`(te."nombre" ILIKE ${patron} OR te."nombre_proveedor" ILIKE ${patron} OR p."nombre" ILIKE ${patron} OR c."nombre" ILIKE ${patron} OR c."pantone" ILIKE ${patron})`,
    );
  }
  if (!filtros.incluirCeros) {
    condiciones.push(Prisma.sql`(e."existencia_cuerpo" <> 0 OR e."existencia_complemento" <> 0)`);
  }
  const where = Prisma.join(condiciones, ' AND ');

  const filas = await cliente.$queryRaw<FilaExistenciaColor[]>(Prisma.sql`
    SELECT
      e."id_tela"        AS "idTela",
      te."nombre"        AS "tela",
      cat."nombre"       AS "categoria",
      te."id_proveedor"  AS "idProveedor",
      p."nombre"         AS "proveedor",
      te."nombre_proveedor"   AS "nombreProveedor",
      te."unidad_medida"      AS "unidadMedida",
      te."nombre_cuerpo"      AS "nombreCuerpo",
      te."nombre_complemento" AS "nombreComplemento",
      e."id_tela_color"  AS "idTelaColor",
      c."nombre"         AS "color",
      c."pantone"        AS "pantone",
      e."id_almacen"     AS "idAlmacen",
      a."nombre"         AS "almacen",
      e."existencia_cuerpo"      AS "cuerpo",
      e."existencia_complemento" AS "complemento"
    FROM "existencia_tela_color" e
    JOIN "telas"         te  ON te."id" = e."id_tela"
    JOIN "telas_colores" c   ON c."id"  = e."id_tela_color"
    LEFT JOIN "telas_categorias" cat ON cat."id" = te."id_categoria"
    LEFT JOIN "proveedores"      p   ON p."id"   = te."id_proveedor"
    JOIN "almacenes"     a   ON a."id" = e."id_almacen"
    WHERE ${where}
    ORDER BY te."nombre" ASC, c."nombre" ASC, a."nombre" ASC
  `);

  // Agrupa en memoria: TELA PADRE → COLORES hijos → almacenes (el ORDER BY ya viene agrupable).
  const telas: ExistenciaTelaAgrupada[] = [];
  let telaActual: ExistenciaTelaAgrupada | undefined;
  let colorActual: ExistenciaTelaColorHijo | undefined;
  let totalCuerpo = 0;
  let totalComplemento = 0;

  for (const f of filas) {
    const cuerpo = Number(f.cuerpo);
    const complemento = Number(f.complemento);
    if (telaActual === undefined || telaActual.idTela !== f.idTela) {
      telaActual = {
        idTela: f.idTela,
        nombre: f.tela,
        categoria: f.categoria,
        idProveedor: f.idProveedor,
        proveedor: f.proveedor,
        nombreProveedor: f.nombreProveedor,
        unidadMedida: f.unidadMedida,
        nombreCuerpo: f.nombreCuerpo,
        nombreComplemento: f.nombreComplemento,
        totalCuerpo: 0,
        totalComplemento: 0,
        colores: [],
      };
      telas.push(telaActual);
      colorActual = undefined;
    }
    if (colorActual === undefined || colorActual.idTelaColor !== f.idTelaColor) {
      colorActual = {
        idTelaColor: f.idTelaColor,
        nombre: f.color,
        pantone: f.pantone,
        existenciaCuerpo: 0,
        existenciaComplemento: 0,
        almacenes: [],
      };
      telaActual.colores.push(colorActual);
    }
    colorActual.almacenes.push({
      idAlmacen: f.idAlmacen,
      almacen: f.almacen,
      cuerpo,
      complemento,
    });
    colorActual.existenciaCuerpo += cuerpo;
    colorActual.existenciaComplemento += complemento;
    telaActual.totalCuerpo += cuerpo;
    telaActual.totalComplemento += complemento;
    totalCuerpo += cuerpo;
    totalComplemento += complemento;
  }

  return { telas, totalCuerpo, totalComplemento };
}

const esquemaConsultaKardexTelaColor = z.object({
  idTelaColor: z.number().int().positive(),
  idAlmacen: z.number().int().positive().optional(),
  idPartida: z.number().int().positive().optional(),
});

/** Parámetros del kardex por color (forma de dominio). */
export type ParametrosKardexTelaColor = z.input<typeof esquemaConsultaKardexTelaColor>;

/**
 * KARDEX por TELA+COLOR: lista CRONOLÓGICA de los movimientos del color, con SALDO CORRIDO de
 * AMBOS componentes por color×almacén (patrón `kardexTela`). Filtro opcional por almacén y por
 * partida (traza de entrada). Lee `MovimientoDetTela` DIRECTO (sin la vista — no preserva orden).
 * Los costos/importes se OMITEN (null) sin `telas.ver-totales` (ex-acceso #7). Permiso
 * `inventario-telas.ver`; empresa activa (A9).
 */
export async function kardexTelaColor(
  sesion: SesionUsuario,
  parametros: ParametrosKardexTelaColor,
  bd?: ContextoBd,
): Promise<KardexTelaColorLista> {
  verificarPermiso(sesion, 'inventario-telas.ver');
  const filtros = validarEntrada(esquemaConsultaKardexTelaColor, parametros);
  const cliente = clienteLectura(bd);
  const idEmpresa = sesion.idEmpresaActiva;
  const verImportes = tienePermiso(sesion, 'telas.ver-totales');

  const color = await cliente.telaColor.findUnique({
    where: { id: filtros.idTelaColor },
    select: {
      id: true,
      nombre: true,
      pantone: true,
      tela: {
        select: {
          id: true,
          nombre: true,
          unidadMedida: true,
          nombreCuerpo: true,
          nombreComplemento: true,
        },
      },
    },
  });
  if (color === null) {
    throw new ErrorNoEncontrado('TelaColor', filtros.idTelaColor);
  }

  const detalles = await cliente.movimientoDetTela.findMany({
    where: {
      idTelaColor: filtros.idTelaColor,
      ...(filtros.idPartida === undefined ? {} : { idPartida: filtros.idPartida }),
      movimiento: {
        idEmpresa,
        ...(filtros.idAlmacen === undefined ? {} : { idAlmacen: filtros.idAlmacen }),
      },
    },
    select: {
      cantidad: true,
      cantidadComplemento: true,
      costoUnit: true,
      costoUnitComplemento: true,
      idPartida: true,
      partida: { select: { folio: true, loteProveedor: true } },
      movimiento: {
        select: {
          id: true,
          folio: true,
          fecha: true,
          observaciones: true,
          origenTipo: true,
          origenId: true,
          idAlmacen: true,
          almacen: { select: { nombre: true } },
          idTipoMov: true,
          tipoMov: { select: { nombre: true, direccion: true } },
          anuladoPor: { select: { id: true } },
        },
      },
    },
    orderBy: [{ movimiento: { folio: 'asc' } }, { id: 'asc' }],
  });

  const saldoCuerpoPorAlmacen = new Map<number, number>();
  const saldoComplementoPorAlmacen = new Map<number, number>();
  const renglones: KardexTelaColorRenglon[] = detalles.map((d) => {
    const m = d.movimiento;
    const esEntrada = m.tipoMov.direccion === DireccionMovimiento.entrada;
    const esSalida = m.tipoMov.direccion === DireccionMovimiento.salida;
    const cuerpo = Number(d.cantidad);
    const complemento = aNumero(d.cantidadComplemento) ?? 0;
    const entradaCuerpo = esEntrada ? cuerpo : 0;
    const salidaCuerpo = esSalida ? cuerpo : 0;
    const entradaComplemento = esEntrada ? complemento : 0;
    const salidaComplemento = esSalida ? complemento : 0;

    const saldoCuerpo =
      (saldoCuerpoPorAlmacen.get(m.idAlmacen) ?? 0) + entradaCuerpo - salidaCuerpo;
    saldoCuerpoPorAlmacen.set(m.idAlmacen, saldoCuerpo);
    const saldoComplemento =
      (saldoComplementoPorAlmacen.get(m.idAlmacen) ?? 0) + entradaComplemento - salidaComplemento;
    saldoComplementoPorAlmacen.set(m.idAlmacen, saldoComplemento);

    const costoUnit = verImportes ? aNumero(d.costoUnit) : null;
    const costoUnitComplemento = verImportes ? aNumero(d.costoUnitComplemento) : null;
    return {
      idMovimiento: m.id,
      folio: Number(m.folio),
      fecha: m.fecha.toISOString().slice(0, 10),
      idTipoMov: m.idTipoMov,
      tipoMov: m.tipoMov.nombre,
      direccion: m.tipoMov.direccion,
      idAlmacen: m.idAlmacen,
      almacen: m.almacen.nombre,
      idPartida: d.idPartida,
      partidaFolio: d.partida === null ? null : Number(d.partida.folio),
      loteProveedor: d.partida?.loteProveedor ?? null,
      entradaCuerpo,
      salidaCuerpo,
      saldoCuerpo,
      entradaComplemento,
      salidaComplemento,
      saldoComplemento,
      costoUnit,
      costoUnitComplemento,
      // B1: cada componente con SU costo (el complemento ya no queda fuera de la valuación).
      importe:
        costoUnit === null && costoUnitComplemento === null
          ? null
          : (costoUnit ?? 0) * cuerpo + (costoUnitComplemento ?? 0) * complemento,
      origenTipo: m.origenTipo,
      origenId: m.origenId,
      cancelado: m.anuladoPor.length > 0,
      observaciones: m.observaciones,
    };
  });

  return {
    idTela: color.tela.id,
    tela: color.tela.nombre,
    idTelaColor: color.id,
    telaColor: color.nombre,
    pantone: color.pantone,
    unidadMedida: color.tela.unidadMedida,
    nombreCuerpo: color.tela.nombreCuerpo,
    nombreComplemento: color.tela.nombreComplemento,
    renglones,
  };
}

const esquemaConsultaPartidasTela = z.object({
  idTelaColor: z.number().int().positive().optional(),
  idTela: z.number().int().positive().optional(),
  busqueda: z.string().trim().max(100).optional(),
});

/** Parámetros de la búsqueda de partidas (forma de dominio). */
export type ParametrosListarPartidasTela = z.input<typeof esquemaConsultaPartidasTela>;

/** Cuántas partidas devuelve la búsqueda como máximo (selector typeahead). */
const MAX_PARTIDAS = 50;

/**
 * Busca PARTIDAS de tela (unidad de entrada) por folio, lote del proveedor o factura — para el
 * selector de la UI y consultas de traza. Filtro opcional por color o por tela. Devuelve las 50
 * más recientes (folio descendente). Permiso `inventario-telas.ver`; empresa activa (A9).
 */
export async function listarPartidasTela(
  sesion: SesionUsuario,
  parametros: ParametrosListarPartidasTela = {},
  bd?: ContextoBd,
): Promise<PartidasTelaLista> {
  verificarPermiso(sesion, 'inventario-telas.ver');
  const filtros = validarEntrada(esquemaConsultaPartidasTela, parametros);
  const cliente = clienteLectura(bd);
  const idEmpresa = sesion.idEmpresaActiva;

  const busqueda = filtros.busqueda;
  const filtrosBusqueda: Prisma.PartidaTelaWhereInput[] = [];
  if (busqueda !== undefined && busqueda.length > 0) {
    const or: Prisma.PartidaTelaWhereInput[] = [
      { loteProveedor: { contains: busqueda, mode: 'insensitive' } },
      { factura: { contains: busqueda, mode: 'insensitive' } },
    ];
    // Si lo tecleado es un número, también casa por folio exacto.
    if (/^\d+$/.test(busqueda)) {
      or.push({ folio: BigInt(busqueda) });
    }
    filtrosBusqueda.push({ OR: or });
  }

  const partidas = await cliente.partidaTela.findMany({
    where: {
      idEmpresa,
      ...(filtros.idTelaColor === undefined ? {} : { idTelaColor: filtros.idTelaColor }),
      ...(filtros.idTela === undefined ? {} : { telaColor: { idTela: filtros.idTela } }),
      AND: filtrosBusqueda,
    },
    select: {
      id: true,
      folio: true,
      idTelaColor: true,
      loteProveedor: true,
      factura: true,
      fecha: true,
      creadoEn: true,
      telaColor: { select: { nombre: true, tela: { select: { id: true, nombre: true } } } },
    },
    orderBy: { folio: 'desc' },
    take: MAX_PARTIDAS,
  });

  return {
    datos: partidas.map((p) => ({
      id: p.id,
      folio: Number(p.folio),
      idTelaColor: p.idTelaColor,
      telaColor: p.telaColor.nombre,
      idTela: p.telaColor.tela.id,
      tela: p.telaColor.tela.nombre,
      loteProveedor: p.loteProveedor,
      factura: p.factura,
      fecha: p.fecha === null ? null : p.fecha.toISOString().slice(0, 10),
      creadoEn: p.creadoEn.toISOString(),
    })),
  };
}
