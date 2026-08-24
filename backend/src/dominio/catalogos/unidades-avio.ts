/**
 * UNIDADES de un avío — la pieza pura de V1-E3g (§Post-F9.66), donde se decidió que **la unidad del
 * avío manda**.
 *
 * El hallazgo de Daniel capturando un cierre: hay DOS números por talla que no son la misma cosa.
 *
 *  • El **CONSUMO** (`ModeloAvioTalla.consumo`) — *cuánto gastas*: 0.75 m de elástico en CH, 0.80 en
 *    M. Va en `Avio.unidad`, admite decimales con naturalidad y **se multiplica** por el precio.
 *  • La **MEDIDA** (`AvioMedida.valor`) — *qué pides*: el cierre de 53 cm. Va en
 *    `Avio.unidadMedida`, es una instrucción de compra y **no** se multiplica por nada (del cierre
 *    se consume 1 pza por prenda, punto).
 *
 * Por eso la medida dejó de ser texto libre: `"53 cm"`, `"53cm"` y `"53"` eran tres cosas distintas
 * y la orden de compra salía partida en tres. Ahora se captura **un número** y la unidad vive UNA
 * vez, en el avío — *"quita la ambigüedad en el origen en vez de limpiarla después"*.
 *
 * ⚠️ El riesgo que queda es que un avío tenga **mal puesta su unidad**. Contra eso, dos cosas: la
 * UI **pega la unidad al campo** mientras se captura (`0.75 m`, `53 cm`), y este módulo produce un
 * **AVISO cuando el número es absurdo para esa unidad** (un `1` en un cierre en cm casi seguro
 * quiso ser `100`). **Avisa, NO bloquea**: los rangos son de sentido común, no reglas del negocio,
 * y un bloqueo con un rango mal calibrado pararía una captura legítima.
 *
 * Módulo PURO (sin BD, sin sesión): sólo texto y números.
 */

/** Normaliza una unidad para compararla: sin espacios sobrantes, en minúsculas. `''` ⇒ null. */
export function normalizarUnidad(unidad: string | null | undefined): string | null {
  if (unidad === null || unidad === undefined) return null;
  const limpia = unidad.trim().toLowerCase();
  return limpia === '' ? null : limpia;
}

/**
 * ETIQUETA de una medida a partir de su número y la unidad del avío: `53 + "cm"` ⇒ `"53 cm"`.
 * Es lo que se muestra y lo que respalda el `@@unique([idAvio, medida])` del catálogo. Los enteros
 * salen SIN decimales (`53`, no `53.00`) y los decimales conservan los suyos (`0.75`); la unidad se
 * escribe tal como está capturada en el avío (sin inventar una si no hay).
 */
export function etiquetaMedida(valor: number, unidadMedida: string | null | undefined): string {
  // `String(53)` ⇒ "53" y `String(0.75)` ⇒ "0.75": el número se escribe tal cual, sin ceros de
  // relleno (un `Decimal(12,2)` de Prisma llega ya convertido a `number`, no como "53.00").
  const numero = String(valor);
  const unidad = normalizarUnidad(unidadMedida);
  return unidad === null ? numero : `${numero} ${unidad}`;
}

/**
 * Rango de sentido común por unidad, para el AVISO de número absurdo. Cada entrada es
 * `[mínimo, máximo]` de lo que se ve normalmente en una prenda.
 *
 * ⚠️ Esto NO es una regla de negocio y por eso NUNCA bloquea: es un detector de dedazos y de
 * unidades mal puestas. Las claves son las variantes que de hecho se escriben en el catálogo; una
 * unidad que no esté aquí simplemente no genera aviso (mejor callarse que gritar en falso).
 */
const RANGOS: Readonly<Record<string, readonly [number, number]>> = {
  // Longitud "de especificación" (largo de un cierre, ancho de un elástico…).
  cm: [3, 400],
  cms: [3, 400],
  centimetro: [3, 400],
  centimetros: [3, 400],
  mm: [30, 4000],
  pulg: [1, 160],
  plg: [1, 160],
  in: [1, 160],
  '"': [1, 160],
  // Longitud "de consumo" por prenda.
  m: [0.01, 20],
  mt: [0.01, 20],
  mts: [0.01, 20],
  metro: [0.01, 20],
  metros: [0.01, 20],
  yd: [0.01, 20],
  yarda: [0.01, 20],
  yardas: [0.01, 20],
  // Conteo por prenda.
  pza: [1, 200],
  pzas: [1, 200],
  pieza: [1, 200],
  piezas: [1, 200],
  pz: [1, 200],
  par: [1, 50],
  pares: [1, 50],
  jgo: [1, 50],
  juego: [1, 50],
  // Peso / volumen por prenda.
  kg: [0.001, 20],
  kgs: [0.001, 20],
  g: [0.5, 20_000],
  gr: [0.5, 20_000],
  grs: [0.5, 20_000],
  lt: [0.001, 20],
  lts: [0.001, 20],
  l: [0.001, 20],
};

/** Formatea un número del rango para el texto del aviso (sin ceros de relleno). */
function n(valor: number): string {
  return String(valor);
}

/**
 * AVISO —nunca error— cuando `valor` queda fuera de lo normal para `unidad`. Devuelve `null` si no
 * hay nada que decir: si la unidad no está en la tabla, si el valor es 0 (**un cero es
 * deliberado**, no un dedazo: significa "esta talla no lleva el avío") o si cae dentro del rango.
 *
 * `contexto` es lo que la UI necesita para saber DE QUÉ habla el aviso (`'La medida del cierre'`,
 * `'El consumo de la talla G'`).
 */
export function avisoValorFueraDeRango(
  contexto: string,
  valor: number,
  unidad: string | null | undefined,
): string | null {
  const clave = normalizarUnidad(unidad);
  if (clave === null) return null;
  if (valor === 0) return null;
  const rango = RANGOS[clave];
  if (rango === undefined) return null;
  const [min, max] = rango;
  if (valor >= min && valor <= max) return null;
  return (
    `${contexto} (${String(valor)} ${clave}) queda fuera de lo normal para "${clave}" ` +
    `(lo usual va de ${n(min)} a ${n(max)}). Revísalo: puede faltar un dígito o ` +
    `estar mal la unidad del avío.`
  );
}

/**
 * ⭐⭐ **§Post-F9.105 — LA CONTRADICCIÓN «avío POR MEDIDA con cantidades POR TALLA», DICHA UNA SOLA
 * VEZ.** Daniel, 24-ago-2026: *"la compra de los cierres me está dando una cantidad muchísimo mayor
 * de la que necesito"*. No era un error de cálculo: era este dato contradictorio, que la explosión
 * usaba **sin decir nada**.
 *
 * El texto vive AQUÍ —el módulo que define la diferencia entre *cuánto gastas* y *qué medida
 * pides*— porque lo dicen **tres pantallas**: el BOM del modelo (`modelos/medidas-avio-talla.ts`,
 * donde se arregla), la receta de la orden (`produccion/receta-orden.ts`, donde también se arregla)
 * y la **explosión de materiales** (`compras/mrp.ts`, donde se SUFRE). Si cada una lo redactara por
 * su cuenta parecerían **tres reglas distintas** en vez de una sola — y esta etapa nació justo de un
 * aviso que existía y no se veía donde dolía.
 */
export interface RequeridoContradictorio {
  /** Lo que la orden pide HOY (las cantidades por talla siguen mandando). */
  hoy: number;
  /** Lo que pediría YA NORMALIZADO (consumo por prenda × piezas). */
  normalizado: number;
  /** Unidad de consumo del avío, para escribir las cifras (o `null`). */
  unidad: string | null;
}

/** Cifra para el texto de un aviso: hasta 2 decimales y con separador de miles. */
function cifra(valor: number, unidad: string | null): string {
  const numero = valor.toLocaleString('es-MX', { maximumFractionDigits: 2 });
  const u = normalizarUnidad(unidad);
  return u === null ? numero : `${numero} ${u}`;
}

/**
 * LA MAGNITUD del descuadre, en prosa. 🔴 Sin ella el aviso sólo dice *"hay una contradicción"* —
 * y lo que Daniel necesita ver es **cuánto se está pidiendo de más**: la diferencia entre revisarlo
 * hoy o comprar 53 veces el cierre que hacía falta.
 *
 * Devuelve `''` cuando no hay diferencia que reportar (el toggle contradice, pero el requerido sale
 * igual): decir "0 de más" sería ruido.
 */
function magnitudContradiccion(r: RequeridoContradictorio): string {
  const diferencia = r.hoy - r.normalizado;
  if (Math.abs(diferencia) < 0.0001) return '';
  const sentido = diferencia > 0 ? 'de MÁS' : 'de MENOS';
  // Las "veces" sólo se pueden decir si hay contra qué dividir: con el normalizado en 0 (un avío
  // por medida con consumo por prenda 0) la proporción no existe, y escribir "∞ veces" sería peor
  // que callarla.
  const veces =
    r.normalizado > 0 && diferencia > 0
      ? ` (${(r.hoy / r.normalizado).toLocaleString('es-MX', { maximumFractionDigits: 1 })} veces)`
      : '';
  return (
    ` Con esas cantidades el requerido sale en ${cifra(r.hoy, r.unidad)} en vez de ` +
    `${cifra(r.normalizado, r.unidad)}: ${cifra(Math.abs(diferencia), r.unidad)} ${sentido}${veces}.`
  );
}

/**
 * EL AVISO (nunca un bloqueo, §Post-F9.64) de que un avío **por medida** trae encendido el
 * `consumoPorTalla` de una captura anterior a V1-E3g.
 *
 * `comoSeArregla` es lo ÚNICO que cambia entre pantallas: en el BOM y en la receta se arregla
 * guardando ahí mismo; en la explosión hay que ir a la receta de la orden. `requerido` es opcional
 * porque el BOM del modelo no sabe de piezas: sin una orden detrás no hay magnitud que calcular.
 */
export function avisoAvioPorMedidaConCantidadesPorTalla(
  comoSeArregla: string,
  requerido?: RequeridoContradictorio | null,
): string {
  return (
    'Este avío se compra POR MEDIDA (tiene medidas en su catálogo), pero trae encendido ' +
    '"se consume por talla" de una captura anterior: las cantidades por talla ya no se capturan y ' +
    'siguen contando en el requerido.' +
    (requerido == null ? '' : magnitudContradiccion(requerido)) +
    ` ${comoSeArregla}`
  );
}
