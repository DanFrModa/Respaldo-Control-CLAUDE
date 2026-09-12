/**
 * RESOLUCIÓN DE PRECIOS DE INSUMO amarrados a proveedor/producto/precio (F8-E1; R17/D13 —
 * PROPUESTA-Desarrollo-Cotizacion-y-Listas-de-Precios.md §7-A/B). Funciones PURAS (las ejercitan
 * los tests unitarios), SIN dependencias de BD: reciben ya los precios leídos del catálogo
 * y devuelven el precio efectivo + de DÓNDE salió (traza).
 *
 * Es la pieza HABILITADORA de la fase: hoy el pre-costo de F7 valúa la tela con el
 * `Tela.precioSugerido` GENÉRICO y el avío con `Avio.precioReferencia`/"más barato"; F8 amarra el
 * precio a un proveedor concreto elegido por Desarrollo. La MISMA cascada la usan el precosteo
 * persistido (E3) y el MRP enganchado (E6) — por eso vive aquí, compartida, con tests.
 *
 * ⭐ **V1-E3e (DANIEL, 15-ago-2026 — `DECISIONES.md` §Post-F9.48): manda el precio REAL de compra.**
 * *"No hay ningún motivo por el cual tener dos precios distintos. Hay que unificarlo. Si ya tenemos
 * precios reales, lo mejor es tomar ese costo. El más actualizado. El de referencia podría funcionar
 * solo cuando es algo nuevo que no se ha comprado."* La cascada estrena un ESCALÓN 1 por encima de
 * todo lo del catálogo: la **última compra REAL** del material (`ultimo-precio-compra.ts`, la misma
 * maquinaria de §Post-F9.5 — no una copia). Los cuatro escalones, tela y avío por igual:
 *
 *   1. **último precio de COMPRA REAL** — siempre que ese material ya se haya comprado (OC AUTORIZADA);
 *   2. precio del proveedor en el CATÁLOGO — si a ese proveedor nunca se le ha comprado;
 *   3. `precioReferencia`/`precioSugerido` — SOLO lo nuevo que nunca se ha comprado;
 *   4. `sin-precio` — se dice; NO se inventa un `$0.00` mudo.
 *
 * ⭐ **El cruce con el amarre de Desarrollo (decisión fina de Daniel): el amarre elige el PROVEEDOR;
 * el precio es el de la última compra A ESE proveedor.** Si a ese proveedor aún no se le ha comprado
 * el material, se usa su precio negociado; y si tampoco hay, la cascada SIGUE por los escalones
 * generales (última compra a cualquiera → más barato/color → referencia), que es el fallback que ya
 * existía y no se rompe. Así el trabajo de negociación no se tira (sigue mandando la elección de
 * proveedor) y el costo no se queda viejo.
 *
 * CASCADA DE LA TELA:
 *   1. compra al amarrado — última compra REAL de esta tela AL PROVEEDOR AMARRADO.
 *   2. amarre CON color   — `TelaProveedorColor.precio` del proveedor amarrado, si maneja precio por
 *                           color Y hay color en contexto Y ese color tiene precio.
 *   3. amarre             — `TelaProveedor.precio` del proveedor amarrado por Desarrollo.
 *   4. última compra      — la compra REAL más reciente de esta tela, venga del proveedor que venga.
 *   5. referencia color   — `TelaColor.precio` (SIN proveedor) del color en contexto. Desde
 *                           §Post-F9.11 los colores de tela son HIJOS de la tela: el pegue con el
 *                           color de PRENDA va primero por la liga legacy `idColor` (migradas) y
 *                           luego por NOMBRE — ver {@link resolverPrecioColorReferencia}.
 *   6. sugerido           — `Tela.precioSugerido` (genérico, el de F7). Sin nada ⇒ `null`.
 *
 * CASCADA DEL COMPLEMENTO DE LA TELA (⭐⭐ 0.163 — el cárdigan que acompaña a la felpa; DANIEL:
 * *«El complemento de la tela debe de llevar un costo estimado»*). Viaja DENTRO del renglón de su
 * tela, así que NO es una cascada de material aparte: es la del MISMO renglón para su otra mitad.
 *   1. última compra   — `OrdenCompraLinea.precioComplemento` de la compra más reciente que compró
 *                        complemento (mismo criterio de estatus y mismo desempate que el cuerpo).
 *   2. color           — `TelaColor.precioComplemento`, sólo si el llamador tiene color en la mano.
 *   3. estimado        — `Tela.precioSugeridoComplemento`. Sin nada ⇒ `sin-precio` (NUNCA un 0 mudo).
 * Ver {@link resolverPrecioComplementoTela}.
 *
 * CASCADA DEL AVÍO (§Post-F9.97: TODOS los precios están ya en unidad de consumo — metro, pieza,
 * kilo—, así que no hay nada que normalizar. Hasta V1-E8a cada escalón dividía por un «factor de
 * conversión» presentación→consumo; se retiró con la dualidad de unidades que lo justificaba):
 *   1. compra al amarrado — última compra REAL de este avío AL PROVEEDOR AMARRADO.
 *   2. amarre     — `AvioProveedor.precio` del proveedor amarrado.
 *   3. última compra — la compra REAL más reciente del avío, venga de quien venga.
 *   4. más barato — el `AvioProveedor` más barato (regla F4 actual, el fallback).
 *   5. referencia — `Avio.precioReferencia` (fallback sin proveedor mapeable, ADR-0009). Sin nada ⇒ `null`.
 *
 * Los escalones nuevos son OPCIONALES en la entrada: un llamador que no pase `ultimaCompra*` obtiene
 * EXACTAMENTE la cascada de antes (no-regresión por construcción, y así lo ejercitan los tests).
 *
 * NOTA de moneda (decisión (d)): todo va en MXN; no hay motor de tipo de cambio (un proveedor en USD
 * se anota en `condiciones`). Estas funciones no redondean: el llamador decide la precisión final al
 * guardar en la columna Decimal.
 */

/**
 * Escalón 1: la última compra REAL de un material, tal como la devuelve
 * `ultimo-precio-compra.ts` — ya POR UNIDAD DE CONSUMO (es la unidad de la línea de OC). Se
 * declara aquí como forma MÍNIMA para que este módulo siga siendo puro (sin dependencias de BD).
 */
export interface CompraRealPrecio {
  /** Precio por unidad de consumo de la compra más reciente. */
  precio: number;
  /** Proveedor al que se le compró (traza: quién firma el precio que costea). */
  idProveedor: number;
}

// ── TELA ──────────────────────────────────────────────────────────────────────

/** De dónde salió el precio de la tela (traza para el renglón de precosto y la review). */
export type OrigenPrecioTela =
  | 'ultimo-precio-compra'
  | 'amarre-color'
  | 'amarre'
  | 'color-referencia'
  | 'sugerido'
  | 'sin-precio';

/**
 * Renglón proveedor–tela–precio amarrado por Desarrollo (`ModeloTela.idTelaProveedor` → el
 * `TelaProveedor` elegido). `precioColor` es el precio del COLOR EN CONTEXTO para ese proveedor
 * (`TelaProveedorColor.precio`), ya resuelto por el llamador; `null`/omitido si no aplica.
 */
export interface AmarreTela {
  /** `TelaProveedor.precio` (precio base del proveedor amarrado). Null si el proveedor no lo fija. */
  precio: number | null;
  /** `TelaProveedor.manejaPrecioPorColor`: ¿este proveedor cotiza por color? */
  manejaPrecioPorColor: boolean;
  /** `TelaProveedorColor.precio` del color en contexto para este proveedor (si maneja color). */
  precioColor?: number | null;
}

/** Entrada de la resolución del precio de una TELA (todo ya leído del catálogo por el llamador). */
export interface EntradaPrecioTela {
  /** `Tela.precioSugerido` (genérico, el de F7). El último escalón de la cascada. */
  precioSugerido: number | null;
  /** Amarre elegido por Desarrollo, o `null`/omitido si el BOM no amarró proveedor a esta tela. */
  amarre?: AmarreTela | null;
  /** `TelaColor.precio` del color en contexto (referencia por color SIN proveedor). */
  precioColorReferencia?: number | null;
  /**
   * ESCALÓN 1 (§Post-F9.48): última compra REAL de esta tela, venga del proveedor que venga.
   * Omitir/`null` = el llamador no consulta compras ⇒ cascada idéntica a la de antes de V1-E3e.
   */
  ultimaCompra?: CompraRealPrecio | null;
  /**
   * ESCALÓN 1 CON AMARRE (§Post-F9.48): última compra REAL de esta tela **al proveedor amarrado**.
   * El amarre elige el PROVEEDOR; el precio sale de la realidad más reciente con ÉL.
   */
  ultimaCompraProveedorAmarrado?: CompraRealPrecio | null;
}

/** Resultado de resolver el precio de una tela. */
export interface PrecioResuelto {
  /** Precio efectivo por unidad de consumo, o `null` si no hay ningún precio en la cascada. */
  precio: number | null;
  /** De qué escalón de la cascada salió. */
  origen: OrigenPrecioTela;
  /**
   * Proveedor cuyo precio se usó cuando el escalón lo identifica (hoy: la última compra real).
   * `null` en los escalones que salen del catálogo genérico o cuando no hay precio. El amarre NO lo
   * llena: quien lo consume ya conoce al proveedor amarrado.
   */
  idProveedor: number | null;
}

/** ¿Es un precio utilizable? (número finito ≥ 0; los `null`/negativos/NaN se saltan). */
function precioUsable(valor: number | null | undefined): valor is number {
  return typeof valor === 'number' && Number.isFinite(valor) && valor >= 0;
}

/** Un color de TELA (hijo de la tela, §Post-F9.11) para resolver la referencia por color. */
export interface ColorTelaReferencia {
  /** `TelaColor.nombre` (nombre libre del color de esa tela). */
  nombre: string;
  /** `TelaColor.precio` (del cuerpo). */
  precio: number | null;
  /** `TelaColor.precioComplemento` (del cárdigan, 0.163). `null`/omitido = ese color no lo fija. */
  precioComplemento?: number | null;
  /** LEGACY: `TelaColor.idColor` — liga al color de PRENDA de las filas migradas; null en las nuevas. */
  idColor: number | null;
}

/**
 * Resuelve el `precioColorReferencia` (paso 3 de la cascada de la tela) desde los colores
 * HIJOS de la tela, dado el color de PRENDA en contexto. Desde §Post-F9.11 `TelaColor` ya no
 * cuelga del catálogo de prenda, así que el pegue va en DOS pasos:
 *
 *   1. por la LIGA LEGACY `idColor` (filas migradas de F1-E6) — el comportamiento de siempre;
 *   2. si no pega, por NOMBRE (insensible a mayúsculas): el color de tela cuyo nombre coincide
 *      con el del color de prenda en contexto;
 *   3. si tampoco, `null` — y la cascada de {@link resolverPrecioTela} cae al escalón que sigue
 *      (`precioSugerido`), como siempre.
 *
 * Función PURA (el llamador ya leyó los colores de la tela); alimenta el campo
 * `precioColorReferencia` de {@link EntradaPrecioTela} SIN cambiar ninguna firma existente.
 */
export function resolverPrecioColorReferencia(
  coloresTela: readonly ColorTelaReferencia[],
  contexto: { idColor: number; nombre: string },
): number | null {
  // 1. Liga legacy al catálogo de prenda (lo migrado sigue resolviendo como siempre).
  const porLiga = coloresTela.find((c) => c.idColor !== null && c.idColor === contexto.idColor);
  if (porLiga !== undefined && precioUsable(porLiga.precio)) {
    return porLiga.precio;
  }
  // 2. Por nombre (insensible): "Negro" de la tela pega con el color de prenda "NEGRO".
  const clave = contexto.nombre.trim().toLowerCase();
  const porNombre = coloresTela.find((c) => c.nombre.trim().toLowerCase() === clave);
  if (porNombre !== undefined && precioUsable(porNombre.precio)) {
    return porNombre.precio;
  }
  return null;
}

/**
 * Resuelve el precio de una TELA según la cascada única de §Post-F9.48 (compra al proveedor
 * amarrado → amarre-color → amarre → última compra real → referencia por color → sugerido).
 * Devuelve el precio, su ORIGEN y —cuando el escalón lo identifica— el proveedor que lo firma;
 * `precio: null` + `origen: 'sin-precio'` cuando la tela no tiene ningún precio en ningún escalón
 * (el llamador decide qué hacer: en el precosteo, un 0 avisado).
 *
 * ⚠️ La entrada SIN `ultimaCompra*` reproduce exactamente la cascada anterior a V1-E3e: los
 * escalones nuevos solo existen si el llamador consultó el histórico de compras.
 */
export function resolverPrecioTela(entrada: EntradaPrecioTela): PrecioResuelto {
  const amarre = entrada.amarre;
  if (amarre != null) {
    // 1. ⭐ El amarre elige el PROVEEDOR; el precio es el de la última compra A ESE proveedor.
    const alAmarrado = entrada.ultimaCompraProveedorAmarrado;
    if (alAmarrado != null && precioUsable(alAmarrado.precio)) {
      return {
        precio: alAmarrado.precio,
        origen: 'ultimo-precio-compra',
        idProveedor: alAmarrado.idProveedor,
      };
    }
    // 2. Amarre CON color: solo si el proveedor amarrado maneja color y ese color tiene precio.
    if (amarre.manejaPrecioPorColor && precioUsable(amarre.precioColor)) {
      return { precio: amarre.precioColor, origen: 'amarre-color', idProveedor: null };
    }
    // 3. Amarre (precio base del proveedor amarrado).
    if (precioUsable(amarre.precio)) {
      return { precio: amarre.precio, origen: 'amarre', idProveedor: null };
    }
    // Amarre sin nada utilizable ⇒ la cascada SIGUE por los escalones generales (no truena en
    // silencio ni se salta al catálogo: sigue mandando "el precio real más reciente" que haya).
  }
  // 4. Última compra REAL de la tela (cualquier proveedor) — el escalón 1 sin amarre.
  const ultima = entrada.ultimaCompra;
  if (ultima != null && precioUsable(ultima.precio)) {
    return {
      precio: ultima.precio,
      origen: 'ultimo-precio-compra',
      idProveedor: ultima.idProveedor,
    };
  }
  // 5. Referencia por color sin proveedor (`TelaColor.precio`).
  if (precioUsable(entrada.precioColorReferencia)) {
    return { precio: entrada.precioColorReferencia, origen: 'color-referencia', idProveedor: null };
  }
  // 6. Sugerido genérico (`Tela.precioSugerido`, el de F7).
  if (precioUsable(entrada.precioSugerido)) {
    return { precio: entrada.precioSugerido, origen: 'sugerido', idProveedor: null };
  }
  return { precio: null, origen: 'sin-precio', idProveedor: null };
}

// ── COMPLEMENTO DE LA TELA (0.163) ────────────────────────────────────────────

/**
 * ⭐⭐ **0.163 — EL COMPLEMENTO TAMBIÉN CUESTA.** DANIEL: *«El complemento de la tela debe de llevar
 * un costo estimado»*.
 *
 * Una tela puede llevar COMPLEMENTO (el cárdigan que acompaña a la felpa): el CATÁLOGO dice quién lo
 * lleva (`Tela.nombreComplemento`) y la RECETA dice cuánto (`ModeloTela.consumoComplementoPorPrenda`,
 * congelado en `OrdenTela`). Viaja DENTRO del mismo renglón de tela, nunca como renglón aparte.
 * Hasta esta fila el costeo lo ignoraba por completo mientras el MRP sí lo compraba y lo cobraba
 * (`cantidadComplemento × (precioComplemento ?? precio)`): **se compraba y no se cobraba**, y el
 * precio cotizado al cliente salía BAJO. Esta cascada es lo que lo valúa.
 *
 * TRES ESCALONES — el espejo del cuerpo, con lo que el complemento SÍ tiene:
 *   1. **última compra REAL del complemento** — `OrdenCompraLinea.precioComplemento` de la línea
 *      más reciente que compró complemento, con el MISMO criterio de estatus de OC y el MISMO
 *      desempate que el cuerpo (`ultimo-precio-compra.ts`; no hay una regla nueva que mantener).
 *   2. **precio por COLOR** — `TelaColor.precioComplemento`, sólo cuando el llamador tiene color en
 *      la mano. ⚠️ Hoy **ningún motor de COSTEO se lo pasa** (la receta, el pre-costo y el precosto
 *      son POR MODELO: el color aparece hasta la orden), así que queda PREPARADO y sin alimentar.
 *      🔎 Medido el 12-sep-2026, para que nadie lo dé por muerto: el `color-referencia` del CUERPO
 *      **sí está vivo — en el MRP** (`compras/mrp.ts:1360` le pasa el `TelaColor.precio` del color
 *      con el que se pide el renglón, §Post-F9.89(b)); el comentario de `mrp.ts:733` que lo llama
 *      «inalcanzable» está desactualizado. El día que el MRP quiera también el precio del cárdigan
 *      por color, este escalón ya existe: sólo hay que alimentarlo.
 *   3. **el estimado del catálogo** — `Tela.precioSugeridoComplemento` (el campo que estrena 0.163).
 *
 * Sin ninguno ⇒ `precio: null` + `origen: 'sin-precio'`: el complemento **NO se valúa en silencio a
 * cero**, se dice — exactamente como ya hace el cuerpo.
 *
 * ⚠️ **Lo que esta cascada NO hace, en NINGÚN escalón: caer al precio del CUERPO.** `OrdenCompraLinea`
 * documenta *«precioComplemento NULL = se cobra al mismo precio que el cuerpo»*, pero eso responde a
 * otra pregunta: *«¿cuánto salió de la caja por ESTA compra?»* (y ahí sí se respeta — ver
 * `calcularCostoRealDeOrden`). La pregunta de aquí es *«¿con qué precio costeo un cárdigan del que
 * no sé nada?»*, y la respuesta no puede ser un precio que nadie tecleó para él.
 *
 * 🔴 Por eso el ESCALÓN 1 sólo mira compras **con `precio_complemento` propio**
 * (`leerUltimasComprasDeComplemento`). No es celo: la OC que genera el MRP **nunca** captura ese
 * campo, así que con un `COALESCE` al precio del cuerpo bastaba **una sola orden automática
 * autorizada** para que el cárdigan se costeara al precio de la felpa para siempre —con la traza
 * diciendo `ultimo-precio-compra`— y el estimado del catálogo no volviera a usarse nunca. El camino
 * normal del negocio habría anulado, en silencio, justo el número que esta fila vino a crear.
 */
export type OrigenPrecioComplemento =
  | 'ultimo-precio-compra'
  | 'color-complemento'
  | 'sugerido-complemento'
  | 'sin-precio';

/** Entrada de la resolución del precio del COMPLEMENTO de una tela (todo ya leído por el llamador). */
export interface EntradaPrecioComplemento {
  /** `Tela.precioSugeridoComplemento` (el estimado del catálogo). Último escalón. */
  precioSugeridoComplemento: number | null;
  /**
   * `TelaColor.precioComplemento` del color en contexto. Omitir/`null` = el llamador no tiene color
   * (el caso de TODO el costeo por modelo) ⇒ la cascada salta este escalón.
   */
  precioColorComplemento?: number | null;
  /** ESCALÓN 1: última compra REAL del complemento de esta tela. Omitir = no se consultó. */
  ultimaCompraComplemento?: CompraRealPrecio | null;
}

/** Resultado de resolver el precio del complemento (misma forma que el del cuerpo, con su origen). */
export interface PrecioComplementoResuelto {
  /** Precio efectivo del complemento por unidad de consumo, o `null` si no hay ninguno. */
  precio: number | null;
  /** De qué escalón salió (traza: se ve de dónde salió el número). */
  origen: OrigenPrecioComplemento;
  /** Proveedor que firma el precio cuando el escalón lo identifica (hoy: la última compra). */
  idProveedor: number | null;
}

/**
 * Resuelve el precio del COMPLEMENTO de una tela: última compra real → precio por color → estimado
 * del catálogo → `sin-precio`. Función PURA (el llamador ya leyó catálogo y compras) y sin redondeo:
 * la precisión final la decide quien guarda.
 *
 * 📌 **Por qué el escalón 2 (color) va DEBAJO de la última compra y no encima.** Es la misma
 * asimetría que el cuerpo lleva escrita en `resolverPrecioAvioCatalogo`: la «última compra» que
 * alimenta el escalón 1 es **CIEGA al color**. ⚠️ Ojo con el porqué, porque el motivo cambió y
 * conviene medirlo: desde V1-E3u (§Post-F9.89) la línea de OC de una tela **SÍ puede nombrar el
 * color** (`OrdenCompraLinea.idTelaColor`, nullable) — lo que pasa es que
 * {@link leerUltimasComprasDeComplemento} **no filtra por él a propósito**, para que una tela que
 * nunca se compró en ESE color siga teniendo un precio real reciente en vez de ninguno. Hoy es
 * inofensivo porque ningún llamador del costeo pasa color; el día que alguien meta color al
 * precosto tiene que subir `color-complemento` por encima del escalón 1, o restringir la última
 * compra al color — si no, un cárdigan NEGRO se costearía con el precio del BLANCO comprado al
 * final, en silencio.
 */
export function resolverPrecioComplementoTela(
  entrada: EntradaPrecioComplemento,
): PrecioComplementoResuelto {
  // 1. La última compra REAL del complemento (el dinero que de verdad se pagó por el cárdigan).
  const ultima = entrada.ultimaCompraComplemento;
  if (ultima != null && precioUsable(ultima.precio)) {
    return {
      precio: ultima.precio,
      origen: 'ultimo-precio-compra',
      idProveedor: ultima.idProveedor,
    };
  }
  // 2. Precio del complemento EN ESTE COLOR (`TelaColor.precioComplemento`), si hay color.
  if (precioUsable(entrada.precioColorComplemento)) {
    return {
      precio: entrada.precioColorComplemento,
      origen: 'color-complemento',
      idProveedor: null,
    };
  }
  // 3. El ESTIMADO del catálogo (`Tela.precioSugeridoComplemento`) — la decisión de Daniel.
  if (precioUsable(entrada.precioSugeridoComplemento)) {
    return {
      precio: entrada.precioSugeridoComplemento,
      origen: 'sugerido-complemento',
      idProveedor: null,
    };
  }
  // Sin nada: se DICE que falta (nunca un cero mudo).
  return { precio: null, origen: 'sin-precio', idProveedor: null };
}

/**
 * Resuelve el `precioColorComplemento` (escalón 2) desde los colores HIJOS de la tela, dado el color
 * de PRENDA en contexto. Gemelo exacto de {@link resolverPrecioColorReferencia} —liga legacy
 * `idColor` primero, nombre insensible después— pero leyendo `TelaColor.precioComplemento`.
 */
export function resolverPrecioColorComplemento(
  coloresTela: readonly ColorTelaReferencia[],
  contexto: { idColor: number; nombre: string },
): number | null {
  const porLiga = coloresTela.find((c) => c.idColor !== null && c.idColor === contexto.idColor);
  if (porLiga !== undefined && precioUsable(porLiga.precioComplemento)) {
    return porLiga.precioComplemento;
  }
  const clave = contexto.nombre.trim().toLowerCase();
  const porNombre = coloresTela.find((c) => c.nombre.trim().toLowerCase() === clave);
  if (porNombre !== undefined && precioUsable(porNombre.precioComplemento)) {
    return porNombre.precioComplemento;
  }
  return null;
}

// ── AVÍO ──────────────────────────────────────────────────────────────────────

/** De dónde salió el precio del avío. */
export type OrigenPrecioAvio =
  | 'ultimo-precio-compra'
  | 'amarre'
  | 'mas-barato'
  | 'referencia'
  | 'sin-precio';

/** Un proveedor del avío con su precio de compra (en unidad de consumo, §Post-F9.97). */
export interface ProveedorAvioPrecio {
  idProveedor: number;
  /** `AvioProveedor.precio`, POR UNIDAD DE CONSUMO (§Post-F9.97). Null si no lo fija. */
  precio: number | null;
}

/** Entrada de la resolución del precio de un AVÍO (ya leído del catálogo por el llamador). */
export interface EntradaPrecioAvio {
  /** `Avio.precioReferencia` (fallback sin proveedor, ADR-0009). Ya en unidad de consumo. */
  precioReferencia: number | null;
  /** Proveedores del avío con su precio (`AvioProveedor`). */
  proveedores: readonly ProveedorAvioPrecio[];
  /** Proveedor amarrado por Desarrollo (`ModeloAvio.idAvioProveedor`). Null = sin amarre. */
  idAvioProveedor?: number | null;
  /**
   * ESCALÓN 1 (§Post-F9.48): última compra REAL de este avío, venga del proveedor que venga, YA
   * normalizada a unidad de consumo por `ultimo-precio-compra.ts`. Omitir = cascada de antes.
   */
  ultimaCompra?: CompraRealPrecio | null;
  /** ESCALÓN 1 CON AMARRE: última compra REAL de este avío **al proveedor amarrado**. */
  ultimaCompraProveedorAmarrado?: CompraRealPrecio | null;
}

/** Resultado de resolver el precio de un avío (incluye el proveedor elegido, para la traza/E6). */
export interface PrecioAvioResuelto {
  /** Precio efectivo POR UNIDAD DE CONSUMO, o `null`. */
  precio: number | null;
  /** De qué escalón salió. */
  origen: OrigenPrecioAvio;
  /** Proveedor cuyo precio se usó (amarre o más barato); `null` si salió de referencia/sin-precio. */
  idProveedor: number | null;
}

/**
 * Costo por unidad de consumo de un renglón de proveedor: el precio TAL CUAL, porque
 * `AvioProveedor.precio` ya está en unidad de consumo (§Post-F9.97 — aquí se dividía por el factor
 * de conversión). `null` si el proveedor no tiene precio usable.
 */
function costoDeProveedor(proveedor: ProveedorAvioPrecio): number | null {
  return precioUsable(proveedor.precio) ? proveedor.precio : null;
}

/** De dónde salió el precio de un avío del CATÁLOGO (la cascada + el promedio por medidas). */
export type OrigenPrecioAvioCatalogo = OrigenPrecioAvio | 'promedio-medidas';

/** Resultado de valuar un avío del catálogo (cascada o promedio de medidas). */
export interface PrecioAvioCatalogoResuelto {
  precio: number | null;
  origen: OrigenPrecioAvioCatalogo;
  idProveedor: number | null;
}

/**
 * ⭐ REGLA COMPLETA del precio de un avío del CATÁLOGO — la ÚNICA fuente, compartida por el
 * precosto persistido (`desarrollo/precostos.ts`) y por la RECETA (`modelos/bom-modelo.ts`, que la
 * usa para ENSEÑAR en pantalla exactamente el número con el que se va a costear):
 *
 *  1. avío "POR MEDIDA" (≥1 `AvioMedida` activa, R5/B11) → **promedio simple** de los precios de
 *     sus medidas, SIN proveedor de traza (el precio no salió de un proveedor, decisión Daniel:
 *     protege el costo sin desglosar). Este escalón **gana sobre todo lo demás**.
 *  2. si no, la cascada única ({@link resolverPrecioAvio}: compra al amarrado → amarre → última
 *     compra real → más barato → referencia), que además dice QUÉ proveedor firmó el precio.
 *
 * ⚠️ **Por qué el promedio de medidas sigue GANANDO al último precio de compra (V1-E3e).** El avío
 * "por medida" no tiene UN precio: tiene N, uno por medida (elástico por ancho, cierre por largo…).
 * Una línea de OC se liga al AVÍO, no a la medida, así que su último precio es el de **una sola**
 * medida y usarlo cotizaría todas las demás con esa. Sería peor que el promedio y contradiría la
 * decisión que creó este escalón (Daniel: proteger el costo sin desglosar). §Post-F9.48 unifica de
 * DÓNDE sale el precio de un material con precio único; no re-abre los avíos por medida.
 *
 * ⚠️ **EL MISMO ARGUMENTO APLICA AL COLOR DE LAS TELAS — dejado escrito, hoy NO está vivo.**
 * `OrdenCompraLinea` tampoco guarda color (vive en `OrdenCompraLineaTalla`, y una línea puede cubrir
 * varios colores con UN precio), así que la "última compra" de una tela es tan **ciega al color**
 * como al tamaño en los avíos — y en {@link resolverPrecioTela} el escalón 1 quedó POR ENCIMA de
 * `amarre-color`/`color-referencia`. Hoy es inofensivo porque **ningún llamador de costeo pasa
 * `precioColor`** (la receta y el precosteo son por modelo: el color aparece hasta la orden). El día
 * que alguien meta color al precosto, una tela NEGRA se costearía con el precio de la BLANCA
 * comprada al final, en silencio: quien lo haga debe subir `amarre-color`/`color-referencia` por
 * encima del escalón 1, o restringir la última compra al color. El MRP —único llamador que SÍ tiene
 * color— ya lo trata así a propósito (`compras/mrp.ts`: un precio por color no se pisa con la última
 * compra).
 *
 * Se extrajo aquí (V1-E3c) porque vivía privada en el precosto: la pantalla de la receta la
 * necesitaba y copiarla habría creado dos reglas que derivan. **El comportamiento NO cambia**: es
 * la misma aritmética, y el redondeo lo sigue aplicando el llamador (este módulo no redondea).
 */
export function resolverPrecioAvioCatalogo(
  entrada: EntradaPrecioAvio & { readonly medidas: readonly number[] },
): PrecioAvioCatalogoResuelto {
  if (entrada.medidas.length > 0) {
    const promedio = entrada.medidas.reduce((s, v) => s + v, 0) / entrada.medidas.length;
    return { precio: promedio, origen: 'promedio-medidas', idProveedor: null };
  }
  return resolverPrecioAvio(entrada);
}

/**
 * Resuelve el precio de un AVÍO según la cascada única de §Post-F9.48 (compra al proveedor amarrado
 * → amarre → última compra real → más barato → referencia). Todos los precios que compara están ya
 * en unidad de consumo (§Post-F9.97), así que se comparan directamente. Si hay amarre pero el proveedor amarrado no tiene ni
 * compra ni precio usable, la cascada sigue por los escalones generales (la regla F4 de "más barato"
 * se conserva como fallback: no-regresión).
 */
export function resolverPrecioAvio(entrada: EntradaPrecioAvio): PrecioAvioResuelto {
  const { proveedores, precioReferencia } = entrada;

  if (entrada.idAvioProveedor != null) {
    // 1. ⭐ El amarre elige el PROVEEDOR; el precio es el de la última compra A ESE proveedor.
    const alAmarrado = entrada.ultimaCompraProveedorAmarrado;
    if (alAmarrado != null && precioUsable(alAmarrado.precio)) {
      return {
        precio: alAmarrado.precio,
        origen: 'ultimo-precio-compra',
        idProveedor: alAmarrado.idProveedor,
      };
    }
    // 2. Amarre: el precio de catálogo del proveedor elegido por Desarrollo.
    const amarrado = proveedores.find((p) => p.idProveedor === entrada.idAvioProveedor);
    if (amarrado !== undefined) {
      const costo = costoDeProveedor(amarrado);
      if (costo !== null) {
        return { precio: costo, origen: 'amarre', idProveedor: amarrado.idProveedor };
      }
    }
    // Amarre sin precio usable ⇒ se sigue la cascada general (nunca truena en silencio).
  }

  // 3. Última compra REAL del avío (cualquier proveedor) — el escalón 1 sin amarre.
  const ultima = entrada.ultimaCompra;
  if (ultima != null && precioUsable(ultima.precio)) {
    return {
      precio: ultima.precio,
      origen: 'ultimo-precio-compra',
      idProveedor: ultima.idProveedor,
    };
  }

  // 4. Más barato (regla F4): el menor costo normalizado entre los proveedores con precio.
  let mejor: { precio: number; idProveedor: number } | null = null;
  for (const proveedor of proveedores) {
    const costo = costoDeProveedor(proveedor);
    if (costo !== null && (mejor === null || costo < mejor.precio)) {
      mejor = { precio: costo, idProveedor: proveedor.idProveedor };
    }
  }
  if (mejor !== null) {
    return { precio: mejor.precio, origen: 'mas-barato', idProveedor: mejor.idProveedor };
  }

  // 3. Referencia (`Avio.precioReferencia`, sin proveedor mapeable).
  if (precioUsable(precioReferencia)) {
    return { precio: precioReferencia, origen: 'referencia', idProveedor: null };
  }

  return { precio: null, origen: 'sin-precio', idProveedor: null };
}
