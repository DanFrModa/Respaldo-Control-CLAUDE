import type { MatrizLinea, MatrizTalla } from '@/componentes/matriz-color-talla/MatrizColorTalla';

/**
 * Helpers para la {@link MatrizColorTalla} en el inventario PT (F3-E3). Funciones PURAS (A1).
 *
 * ⭐ **FILA 0.215 — de dónde salen las filas y las columnas.** Hasta esta fila el cuadro arrancaba
 * VACÍO y se armaba a mano contra los catálogos GLOBALES de color y talla, y eso es lo que Daniel
 * encontró en el traspaso: *«me pone todas las tallas yo creo que existen en todos los modelos»*
 * (§Post-F9.243, punto 11). Hoy los ejes se DERIVAN de lo que hay —{@link ejesDeExistencias}—, como
 * la entrega a cliente los deriva de su orden. El catálogo de tallas sigue disponible **sólo donde
 * mete piezas nuevas** (la ENTRADA manual: un conteo inicial puede nombrar una talla que el kardex
 * todavía no conoce); para SACAR o TRASPASAR no hay nada que agregar que el almacén no tenga.
 */

/** Suma total de una matriz de captura (todas las celdas). */
export function totalMatriz(lineas: readonly MatrizLinea[]): number {
  return lineas.reduce(
    (suma, l) => suma + Object.values(l.cantidades).reduce((s, c) => s + c, 0),
    0,
  );
}

/**
 * Convierte la matriz de captura al cuerpo `lineas` que espera el API (descartando ceros).
 *
 * `numOrdenV1` (§Post-F9.25) es el nº de la orden del sistema VIEJO que fabricó estas prendas. El
 * API lo recibe POR COLOR, pero la pantalla lo captura UNA vez por movimiento y lo replica: en el
 * conteo inicial se cuenta un lote de una orden a la vez, y pedirlo color por color sería teclear lo
 * mismo N veces. Si un movimiento mezclara dos órdenes, se capturan dos movimientos.
 *
 * `idOrden` (§Post-F9.40) es la ORDEN de v2 de la que salen las piezas — el bucket de existencia
 * (modelo×color×talla×ORDEN×almacén, F6-E2). `null` = bucket «sin orden» (lo capturado a mano y lo
 * migrado). Se replica a todos los colores por la MISMA razón que `numOrdenV1`, y con la misma
 * consecuencia: un movimiento que mezcle dos órdenes se captura como dos movimientos (el servidor
 * exige un color por captura).
 */
export function aLineasApi(
  lineas: readonly MatrizLinea[],
  numOrdenV1?: string,
  idOrden?: number | null,
): {
  idColor: number;
  idOrden?: number | null;
  tallas: { idTalla: number; cantidad: number }[];
  numOrdenV1?: string;
}[] {
  const ref = (numOrdenV1 ?? '').trim();
  return lineas
    .map((l) => ({
      idColor: l.idColor,
      tallas: Object.entries(l.cantidades)
        .map(([idTalla, cantidad]) => ({ idTalla: Number(idTalla), cantidad }))
        .filter((t) => t.cantidad > 0),
      ...(idOrden === undefined || idOrden === null ? {} : { idOrden }),
      ...(ref === '' ? {} : { numOrdenV1: ref }),
    }))
    .filter((l) => l.tallas.length > 0);
}

/**
 * Valor del `<select>` de orden para el bucket «SIN ORDEN» (§Post-F9.40). Es una opción REAL del
 * negocio —donde cae lo capturado a mano y lo migrado—, no un "sin elegir": por eso tiene valor
 * propio y no cadena vacía.
 */
export const SIN_ORDEN = 'sin';

/** Traduce el valor del `<select>` al `idOrden` que espera el API (`null` = bucket «sin orden»). */
export function aIdOrden(valor: string): number | null {
  return valor === SIN_ORDEN ? null : Number(valor);
}

/** Una orden con movimientos de PT del artículo, para el selector de bucket. */
export interface OpcionOrdenExistencia {
  /** `null` = bucket «sin orden» (lo capturado a mano en el arranque y lo migrado). */
  idOrden: number | null;
  folioOrden: number | null;
  /**
   * Piezas de ese bucket (suma de las filas de existencia). En el caso ENTRADA puede ser 0 —y NO es
   * un tope: a una orden vacía sí se le pueden meter piezas—, por eso ahí no se muestra.
   */
  existencia: number;
}

/**
 * Deriva las ÓRDENES de las filas de existencia ya filtradas por modelo (y, en la salida, por
 * almacén) (§Post-F9.40): el selector ofrece SOLO esos buckets —nunca el catálogo entero de
 * órdenes—, además del bucket «sin orden». Función PURA (A1): el servidor sigue siendo la autoridad
 * del no-negativo.
 *
 * `incluirCeros` distingue los dos usos de la MISMA pantalla:
 *  • **salida** (default, `false`): solo buckets con piezas — de un bucket vacío no se puede sacar.
 *  • **entrada** (`true`): también los buckets en CERO. Es el va-y-ven de estampado: las piezas de
 *    la orden 55 salieron a Aplicación (bucket 55 = 0) y al volver tienen que poder REGRESAR a la
 *    orden 55; si se filtrara el cero, entrarían a «sin orden» y la entrega al cliente de esa orden
 *    diría "no hay existencia" con la mercancía físicamente en el almacén.
 */
export function ordenesConExistencia(
  filas: readonly { idOrden: number | null; folioOrden: number | null; existencia: number }[],
  opciones: { incluirCeros?: boolean } = {},
): OpcionOrdenExistencia[] {
  const incluirCeros = opciones.incluirCeros ?? false;
  const porOrden = new Map<string, OpcionOrdenExistencia>();
  for (const f of filas) {
    if (!incluirCeros && f.existencia <= 0) continue;
    const clave = f.idOrden === null ? 'sin' : String(f.idOrden);
    const acumulado = porOrden.get(clave);
    if (acumulado === undefined) {
      porOrden.set(clave, {
        idOrden: f.idOrden,
        folioOrden: f.folioOrden,
        existencia: f.existencia,
      });
    } else {
      acumulado.existencia += f.existencia;
    }
  }
  // El bucket «sin orden» primero (es el default de captura); luego por folio ascendente.
  return [...porOrden.values()].sort(
    (a, b) => (a.folioOrden ?? -1) - (b.folioOrden ?? -1) || (a.idOrden ?? 0) - (b.idOrden ?? 0),
  );
}

/** Cómo se rotula en el desplegable un color que ya NO está en el catálogo. */
export const SUFIJO_COLOR_RETIRADO = ' (retirado)';

/**
 * ⭐ FILA 0.164 — LOS COLORES RETIRADOS QUE TIENEN MERCANCÍA EN ESTE CONTEXTO.
 *
 * Son el EXTRA que el catálogo vivo no puede dar: el buscador de color pide los ACTIVOS, y así
 * tiene que seguir —una pantalla de captura que ofreciera todos los colores retirados invitaría a
 * meter existencia bajo uno de ellos—. Pero la existencia de PT son movimientos ya asentados (D3) y
 * **no se apaga cuando se apaga el color**: al fusionar dos duplicados (§Post-F9.222) el absorbido
 * queda `activo = false` con sus piezas intactas, y hasta la fila 0.164 ese color desaparecía de
 * los dos desplegables ⇒ el **ajuste manual** y el **traspaso** de esas piezas se quedaban sin
 * puerta.
 *
 * 🔑 **La puerta se abre SOLO donde hay mercancía, y quien decide dónde la hay es el SERVIDOR**:
 * `filasExistencia` son los renglones de `consultarExistenciasPt` que la pantalla YA pidió para su
 * contexto (modelo, y almacén cuando aplica), con el `colorActivo` que trae cada renglón. Esta
 * función no consulta ni deduce existencia: la deriva, exactamente como {@link ordenesConExistencia}
 * hace con los buckets de orden. Función PURA (A1).
 *
 * ⚠️ **El alcance lo fija la consulta que la pantalla hizo, no esta función.** En SALIDA los
 * renglones vienen sin ceros ⇒ sólo aparece el color retirado que hoy tiene piezas. En ENTRADA la
 * consulta pide `incluirCeros` a propósito (el va-y-ven del estampado) ⇒ también aparece el que
 * quedó en cero, que es justo el que tiene que poder REGRESAR.
 *
 * 📌 Y el retirado se ofrece **rotulado** ({@link SUFIJO_COLOR_RETIRADO}): sin la marca, un color
 * fusionado se leería como uno más del catálogo y volvería a capturarse. El nombre sólo se pinta —
 * al API viaja el `idColor`.
 *
 * 📌 **FILA 0.192 — por qué ya no recibe el catálogo.** Antes esta función devolvía *catálogo vivo
 * + retirados* porque la pantalla traía el catálogo entero en un `<select>`. Ese `<select>` se topaba
 * en 100 (el máximo del contrato) y escondía el resto sin avisar; hoy el catálogo vivo lo busca el
 * SERVIDOR (`SelectorColor`) y aquí sólo queda lo que el servidor no puede devolver: los retirados.
 */
export function coloresRetiradosConExistencia(
  filasExistencia: readonly { idColor: number; color: string; colorActivo: boolean }[] = [],
): { id: number; nombre: string }[] {
  // El `Map` es lo que deduplica: un mismo color retirado viene en TANTAS filas como
  // talla×almacén×orden tenga piezas.
  const retirados = new Map<number, string>();
  for (const f of filasExistencia) {
    if (f.colorActivo) continue;
    retirados.set(f.idColor, `${f.color}${SUFIJO_COLOR_RETIRADO}`);
  }
  return [...retirados.entries()]
    .map(([id, nombre]) => ({ id, nombre }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es') || a.id - b.id);
}

/** Columnas (tallas) para la matriz, desde el catálogo, ordenadas por su `orden`. */
export function tallasColumnas(
  tallas: readonly { id: number; etiqueta: string; orden: number }[],
): MatrizTalla[] {
  return tallas
    .slice()
    .sort((a, b) => a.orden - b.orden || a.id - b.id)
    .map((t) => ({ idTalla: t.id, etiqueta: t.etiqueta }));
}

/** Lo que un renglón de existencias tiene que traer para poder armar el cuadro con él. */
export interface FilaParaEjes {
  idColor: number;
  color: string;
  colorActivo: boolean;
  idTalla: number;
  etiquetaTalla: string;
  ordenTalla: number;
  /** `null` = bucket «sin orden». */
  idOrden: number | null;
  /** Piezas de ESE renglón (modelo×color×talla×orden×almacén). Puede venir NEGATIVA. */
  existencia: number;
}

/** Los ejes de un cuadro de captura: sus COLUMNAS (tallas) y sus FILAS (colores), ya ordenados. */
export interface EjesMatrizPt {
  tallas: MatrizTalla[];
  lineas: MatrizLinea[];
  /**
   * ⭐ FIRMA del CONTENIDO de los ejes: qué bucket, qué tallas y qué colores. Es lo que las pantallas
   * comparan para decidir si el cuadro hay que REARMARLO, en vez de comparar la identidad del objeto.
   *
   * 🔴 **Y no es un adorno: sin ella el rearme se colgaba.** El efecto que arma el cuadro dependía de
   * la identidad de `ejes`, que cuelga de la respuesta de la consulta; en cuanto algo entrega un
   * objeto NUEVO en cada render, el efecto vuelve a correr, vuelve a escribir estado y no para nunca
   * (medido: la suite de Movimientos se quedó **10 minutos sin imprimir una línea**). Con la firma, un
   * objeto nuevo con el mismo contenido no rearma nada.
   *
   * 📌 Lleva el **bucket** dentro a propósito: dos órdenes pueden tener los mismos colores y las
   * mismas tallas y NO son el mismo cuadro —su saldo es otro—, así que cambiar de orden tiene que
   * vaciar lo capturado. Lo que la firma NO sabe es el modelo ni el almacén: eso lo añade cada
   * pantalla, que es la que los conoce (y la de Movimientos lo añade **según la dirección**, porque
   * su consulta de ENTRADA no filtra por almacén).
   *
   * ⏳ **DECISIÓN ESCRITA (ronda de corrección): la firma lleva IDs, no ETIQUETAS, y se queda así.**
   * Consecuencia real y conocida: si mientras la pantalla está abierta alguien **renombra una talla**
   * o **retira un color** (que le añadiría el rótulo «(retirado)»), el cuadro sigue pintando los
   * rótulos viejos hasta el siguiente rearme. Se acepta porque **la firma no gobierna lo que se
   * pinta: gobierna si se TIRA lo que la persona ya tecleó.** Meter las etiquetas dentro haría que un
   * renombre en otra pestaña borrara una captura a medias — cambiar trabajo perdido por un rótulo
   * fresco es un mal trueque. Y el daño está acotado a lo cosmético: al API viaja el **`idColor` /
   * `idTalla`**, que sí son los correctos, así que el movimiento que se guarda nunca es el equivocado;
   * el rótulo se corrige en cuanto cambia el modelo, el almacén, la orden o se guarda.
   */
  firma: string;
}

/**
 * ⭐⭐ FILA 0.215 — EL CUADRO SE ARMA CON LO QUE DE VERDAD HAY, NO CON EL CATÁLOGO.
 *
 * Nace del repaso de Inventarios de DANIEL (§Post-F9.243, punto 11), sobre el traspaso de PT:
 *
 * > *«Tiene que haber un cuadro igual al de la entrega. No lo hay, pide que escoja una talla y un
 * > color. No tiene sentido, me está poniendo cosas que no existen. Me pone todas las tallas yo
 * > creo que existen en todos los modelos. Está muy mal. **No puedo avanzar**.»*
 *
 * 🔑 **De dónde salen las columnas, y por qué NO de la orden.** La entrega a cliente deriva su
 * matriz de la ORDEN (`produccion/matriz-orden.ts` → `tallasDeOrden`) y eso ahí es correcto: se
 * entrega contra lo pedido. Aquí NO: el traspaso y la salida manual mueven **lo que hay en el
 * almacén**, y la existencia de PT es por modelo×color×talla×**ORDEN**×almacén (F6-E2). Una talla de
 * la orden con existencia **cero** en ese almacén es, palabra por palabra, *«algo que no existe»*: el
 * servidor la rechazaría bajo bloqueo (D3) y la columna sólo serviría para cosechar el error. Por eso
 * los ejes se derivan de los **renglones de existencia del bucket elegido**, que son los mismos de
 * los que ya salían el desplegable de órdenes (`ordenesConExistencia`) y el «disponible».
 *
 * ⭐ **`incluirCeros` es EL MISMO parámetro, con el MISMO criterio, que su gemela
 * {@link ordenesConExistencia}** — y tenerlos distintos era un defecto (hallazgo del reviewer):
 *  • **salida / traspaso** (default, `false`): sólo renglones con piezas. ⚠️ Y el filtro hace falta
 *    AQUÍ, no basta el del servidor: el servidor descarta `existencia <> 0` pero **NO los
 *    NEGATIVOS**, así que un renglón en −3 —el rastro de un error de captura— se volvía columna y
 *    fila de una SALIDA, ofreciendo sacar de donde debe menos que nada.
 *  • **entrada** (`true`): también el CERO, a propósito. Es el va-y-ven del estampado: la orden 55
 *    salió completa a Aplicación (su bucket quedó en 0) y al volver las piezas tienen que encontrar
 *    su color y su talla en el cuadro. Aquí el negativo también entra, y está bien: corregirlo es
 *    justo lo que una entrada hace.
 *
 * 📌 El color RETIRADO (fila 0.164) llega rotulado igual que en el buscador: sus piezas son
 * movimientos ya asentados y siguen ahí, pero nadie debe confundirlo con uno del catálogo vivo.
 *
 * Función PURA (A1): el servidor sigue siendo la autoridad del no-negativo.
 */
export function ejesDeExistencias(
  filas: readonly FilaParaEjes[],
  idOrden: number | null,
  opciones: { incluirCeros?: boolean } = {},
): EjesMatrizPt {
  const incluirCeros = opciones.incluirCeros ?? false;
  const tallas = new Map<number, { talla: MatrizTalla; orden: number }>();
  const lineas = new Map<number, MatrizLinea>();
  for (const f of filas) {
    // 🔴 EL BUCKET MANDA: un renglón de OTRA orden no es existencia de este movimiento. Sin este
    // filtro el cuadro volvería a ofrecer «cosas que no existen», sólo que disfrazadas de reales.
    if (f.idOrden !== idOrden) continue;
    // 🔴 Y SIN PIEZAS NO ES EJE (salvo en la entrada): mismo corte que `ordenesConExistencia`.
    if (!incluirCeros && f.existencia <= 0) continue;
    if (!tallas.has(f.idTalla)) {
      tallas.set(f.idTalla, {
        talla: { idTalla: f.idTalla, etiqueta: f.etiquetaTalla },
        orden: f.ordenTalla,
      });
    }
    if (!lineas.has(f.idColor)) {
      lineas.set(f.idColor, {
        idColor: f.idColor,
        color: f.colorActivo ? f.color : `${f.color}${SUFIJO_COLOR_RETIRADO}`,
        cantidades: {},
      });
    }
  }
  // Las columnas van en el orden del CATÁLOGO de tallas (CH, M, G…), que es el que trae cada
  // renglón: ordenarlas por id las pintaría en el orden en que se dieron de alta.
  const columnas = [...tallas.values()]
    .sort((a, b) => a.orden - b.orden || a.talla.idTalla - b.talla.idTalla)
    .map((t) => t.talla);
  const filasOrdenadas = [...lineas.values()].sort(
    (a, b) => a.color.localeCompare(b.color, 'es') || a.idColor - b.idColor,
  );
  return {
    tallas: columnas,
    lineas: filasOrdenadas,
    firma: [
      idOrden === null ? 'sin' : String(idOrden),
      columnas.map((t) => t.idTalla).join(','),
      filasOrdenadas.map((l) => l.idColor).join(','),
    ].join('#'),
  };
}
