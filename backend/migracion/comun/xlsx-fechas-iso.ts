/**
 * FECHAS ISO 8601 (`t="d"`) de una hoja de Excel — parche a un defecto **MEDIDO** de `exceljs` 4.4.0
 * (la librería que este proyecto ya usa), necesario para el listado de SINUBE de la fila 0.131.
 *
 * ## El defecto, medido (no supuesto)
 *
 * ECMA-376 §18.18.11 admite que una celda declare `t="d"` y lleve la fecha como **texto ISO 8601**
 * dentro del `<v>`, en vez del número de serie de 1900 que usa casi todo el mundo:
 *
 * ```xml
 * <c r="C2" t="d" s="3"><v>2026-08-31T00:00:00</v></c>
 * ```
 *
 * `exceljs` **no implementa ese tipo**: su `cell-xform.js` (`parseClose`, `case 'c'`) tiene ramas
 * para `s` · `str` · `inlineStr` · `b` · `e`, y **todo lo demás cae en el `default:`**, que hace
 * `parseFloat(model.value)`. Sobre `"2026-08-31T00:00:00"` eso devuelve **`2026`** (`parseFloat` para
 * en el primer `-`), la celda queda tipada como Número y, como su estilo es de fecha, el serial 2026
 * se convierte a **`1905-07-18`**.
 *
 * ⚠️ **No lanza. Devuelve mal.** Comprobado contra `exceljs` 4.4.0 con un XLSX construido a mano:
 * `1905-07-18T00:00:00.000Z` para un `<v>2026-08-31T00:00:00</v>`. En el archivo real de SINUBE
 * TODAS las fechas vienen así, de modo que sin este parche la carga de apertura entraría fechada en
 * 1905 y la pantalla de antigüedad de saldos diría ~44 mil días vencidos — con un número, sin un
 * error. La prueba que lo clava vive en `migracion/loaders/sinube-apertura.test.ts`.
 *
 * ## Cómo se tapa, y por qué así
 *
 * `exceljs` sigue siendo el lector de la estructura (celdas, `sharedStrings`, estilos, hojas): es
 * robusto y ya está en el proyecto. Este módulo **sólo re-lee del XML crudo las celdas `t="d"`** y
 * devuelve su fecha real por dirección (`C2` → Date), para que el lector la superponga encima de lo
 * que `exceljs` haya devuelto. Es la superficie mínima que arregla el defecto: ni se reimplementa un
 * lector de XLSX, ni se toca la librería.
 *
 * El XLSX es un ZIP, así que hace falta abrirlo. Se hace con `node:zlib` (~60 líneas, abajo) en vez
 * de sumar una dependencia nueva: `jszip`/`unzipper` sólo están aquí como dependencias TRANSITIVAS de
 * `exceljs`, y colgar el ETL de un paquete que nadie declaró es una avería esperando a un `npm i`.
 */
import { inflateRawSync } from 'node:zlib';

import { XMLParser } from 'fast-xml-parser';

// ── Lector ZIP mínimo (sólo lo que un XLSX necesita) ───────────────────────────────────────────────

/** Una entrada del directorio central del ZIP. */
interface EntradaZip {
  /** 0 = almacenada sin comprimir · 8 = deflate. Cualquier otro método se rechaza. */
  metodo: number;
  tamanoComprimido: number;
  /** Desplazamiento de su cabecera local dentro del buffer. */
  offsetLocal: number;
}

const FIRMA_EOCD = 0x0605_4b50;
const FIRMA_CENTRAL = 0x0201_4b50;
const FIRMA_LOCAL = 0x0403_4b50;
/** Centinela de ZIP64 en los campos de 32 bits (tamaños/offsets que no caben). */
const MARCA_ZIP64 = 0xffff_ffff;

/**
 * Lee el directorio central del ZIP y devuelve sus entradas por nombre. Lanza —nunca devuelve algo a
 * medias— si el archivo no es un ZIP legible o si usa ZIP64 (un XLSX de un listado de facturas jamás
 * lo necesita; si algún día lo hiciera, es mejor un error claro que un dato truncado).
 */
function abrirZip(buffer: Buffer): Map<string, EntradaZip> {
  // El EOCD está al final, pero puede llevar un comentario de hasta 65535 bytes detrás.
  const minimo = Math.max(0, buffer.length - 22 - 65_535);
  let eocd = -1;
  for (let i = buffer.length - 22; i >= minimo; i -= 1) {
    if (buffer.readUInt32LE(i) === FIRMA_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) {
    throw new Error(
      'El archivo no parece un XLSX/ZIP válido (no se encontró el fin del directorio).',
    );
  }
  const total = buffer.readUInt16LE(eocd + 10);
  const inicioCentral = buffer.readUInt32LE(eocd + 16);
  if (inicioCentral === MARCA_ZIP64) {
    throw new Error('XLSX en formato ZIP64: no soportado por el lector de fechas del ETL.');
  }

  const entradas = new Map<string, EntradaZip>();
  let p = inicioCentral;
  for (let i = 0; i < total; i += 1) {
    if (buffer.readUInt32LE(p) !== FIRMA_CENTRAL) {
      throw new Error(`Directorio central del XLSX corrupto en la entrada ${String(i + 1)}.`);
    }
    const metodo = buffer.readUInt16LE(p + 10);
    const tamanoComprimido = buffer.readUInt32LE(p + 20);
    const largoNombre = buffer.readUInt16LE(p + 28);
    const largoExtra = buffer.readUInt16LE(p + 30);
    const largoComentario = buffer.readUInt16LE(p + 32);
    const offsetLocal = buffer.readUInt32LE(p + 42);
    const nombre = buffer.toString('utf8', p + 46, p + 46 + largoNombre);
    if (tamanoComprimido === MARCA_ZIP64 || offsetLocal === MARCA_ZIP64) {
      throw new Error(`XLSX en formato ZIP64 (entrada "${nombre}"): no soportado por el ETL.`);
    }
    entradas.set(nombre, { metodo, tamanoComprimido, offsetLocal });
    p += 46 + largoNombre + largoExtra + largoComentario;
  }
  return entradas;
}

/** Extrae UNA entrada del ZIP como texto UTF-8. Lanza si el método de compresión no es 0 ni 8. */
function leerEntrada(buffer: Buffer, entrada: EntradaZip, nombre: string): string {
  const base = entrada.offsetLocal;
  if (buffer.readUInt32LE(base) !== FIRMA_LOCAL) {
    throw new Error(`Cabecera local corrupta para "${nombre}" dentro del XLSX.`);
  }
  const largoNombre = buffer.readUInt16LE(base + 26);
  const largoExtra = buffer.readUInt16LE(base + 28);
  const inicio = base + 30 + largoNombre + largoExtra;
  const crudo = buffer.subarray(inicio, inicio + entrada.tamanoComprimido);
  if (entrada.metodo === 0) {
    return crudo.toString('utf8');
  }
  if (entrada.metodo === 8) {
    return inflateRawSync(crudo).toString('utf8');
  }
  throw new Error(
    `Método de compresión ${String(entrada.metodo)} no soportado para "${nombre}" (sólo 0 y 8).`,
  );
}

/** Lee una parte del XLSX por nombre; `null` si no está. */
function parteXlsx(
  buffer: Buffer,
  entradas: Map<string, EntradaZip>,
  nombre: string,
): string | null {
  const e = entradas.get(nombre);
  return e === undefined ? null : leerEntrada(buffer, e, nombre);
}

// ── Resolución de la hoja N → su parte XML ─────────────────────────────────────────────────────────

/** Prefijo con el que fast-xml-parser expone los atributos (mismo criterio que el parser de CFDI). */
const PREFIJO_ATRIBUTO = '@_';

const parserXml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: PREFIJO_ATRIBUTO,
  removeNSPrefix: true,
  parseAttributeValue: false,
  trimValues: true,
  ignoreDeclaration: true,
  // El XLSX llega de FUERA (lo exporta SINUBE): no se expanden entidades (XXE / "billion laughs").
  processEntities: false,
});

/** Normaliza `undefined | objeto | arreglo` a un ARREGLO (fast-xml-parser colapsa el hijo único). */
function comoArreglo(valor: unknown): Record<string, unknown>[] {
  if (valor === undefined || valor === null) return [];
  return (Array.isArray(valor) ? valor : [valor]) as Record<string, unknown>[];
}

/**
 * Ruta de la parte XML de la hoja `indice` (0-based, en el ORDEN del libro), resuelta como manda el
 * formato: `xl/workbook.xml` da el orden de las hojas y su `r:id`, y `xl/_rels/workbook.xml.rels`
 * traduce ese id a la parte real. Se resuelve de verdad —en vez de asumir `sheet1.xml`— porque el
 * número del archivo NO tiene por qué coincidir con el orden de las pestañas, y leer la hoja
 * equivocada devolvería fechas de otra tabla sin decir nada.
 */
function rutaDeHoja(buffer: Buffer, entradas: Map<string, EntradaZip>, indice: number): string {
  const libro = parteXlsx(buffer, entradas, 'xl/workbook.xml');
  if (libro === null)
    throw new Error('XLSX sin `xl/workbook.xml`: no es un libro de Excel válido.');
  const doc = parserXml.parse(libro) as Record<string, unknown>;
  const wb = doc['workbook'] as Record<string, unknown> | undefined;
  const hojas = comoArreglo((wb?.['sheets'] as Record<string, unknown> | undefined)?.['sheet']);
  const hoja = hojas[indice];
  if (hoja === undefined) {
    throw new Error(
      `El XLSX no tiene la hoja #${String(indice + 1)} (tiene ${String(hojas.length)}).`,
    );
  }
  const rid = hoja[`${PREFIJO_ATRIBUTO}id`];
  const rels = parteXlsx(buffer, entradas, 'xl/_rels/workbook.xml.rels');
  if (rels === null) throw new Error('XLSX sin `xl/_rels/workbook.xml.rels`.');
  const docRels = parserXml.parse(rels) as Record<string, unknown>;
  const lista = comoArreglo(
    (docRels['Relationships'] as Record<string, unknown> | undefined)?.['Relationship'],
  );
  const rel = lista.find((r) => r[`${PREFIJO_ATRIBUTO}Id`] === rid);
  const destino = rel?.[`${PREFIJO_ATRIBUTO}Target`];
  if (typeof destino !== 'string') {
    throw new Error(`No se pudo resolver la parte XML de la hoja #${String(indice + 1)}.`);
  }
  // Los Target vienen relativos a `xl/` (y a veces absolutos, con `/` inicial).
  return destino.startsWith('/') ? destino.slice(1) : `xl/${destino.replace(/^\.\//, '')}`;
}

// ── Extracción de las celdas `t="d"` ───────────────────────────────────────────────────────────────

/**
 * Letra(s) de la columna 1-based, como las nombra Excel: 1 → `A`, 27 → `AA`, 53 → `BA`. Vive aquí
 * porque la usan tanto el lector (para casar la dirección de una celda con su fecha) como el fixture
 * que escribe XLSX sintéticos.
 */
export function letraColumna(n: number): string {
  let resto = n;
  let salida = '';
  while (resto > 0) {
    const r = (resto - 1) % 26;
    salida = String.fromCharCode(65 + r) + salida;
    resto = Math.floor((resto - 1) / 26);
  }
  return salida;
}

/** Fecha ISO (`YYYY-MM-DD`, con o sin hora) → `Date` a medianoche UTC. `null` si no encaja. */
export function fechaDesdeIso(texto: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(texto.trim());
  if (m === null) return null;
  // Se toma la PARTE DE FECHA literal y se ignora la hora: la columna destino es `@db.Date` y una
  // fecha de factura no tiene hora. Convertir por zona horaria podría correr el día ±1 en silencio.
  const d = new Date(`${m[1]!}-${m[2]!}-${m[3]!}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Devuelve **las celdas `t="d"` de la hoja `indiceHoja`** (0-based) del XLSX, indexadas por su
 * dirección (`"C2"`).
 *
 * 🔑 **El valor puede ser `null`, y esa distinción es la que evita un fallo silencioso.** Que una
 * dirección ESTÉ en el mapa significa «esta celda es `t="d"`, así que lo que `exceljs` diga de ella
 * es basura»; el valor es la fecha real, o **`null` si el `<v>` no se pudo leer**. Quien la use debe
 * mirar `has()`, no `get()`: si sólo mirara el valor, una celda `t="d"` con contenido raro caería al
 * valor de `exceljs` — que para ese tipo es **1905-07-18** — y volvería a entrar el defecto que este
 * módulo existe para tapar, esta vez por la puerta de atrás.
 *
 * Se recorre el XML con un barrido lineal en vez de parsearlo entero a un árbol: una hoja de listado
 * puede traer cientos de miles de celdas y aquí sólo interesan las de un tipo. El barrido busca cada
 * apertura `<c …>`, mira sus atributos y, si es `t="d"`, toma el `<v>` que va antes de su `</c>`.
 */
export function fechasIsoDeHoja(buffer: Buffer, indiceHoja = 0): Map<string, Date | null> {
  const entradas = abrirZip(buffer);
  const ruta = rutaDeHoja(buffer, entradas, indiceHoja);
  const xml = parteXlsx(buffer, entradas, ruta);
  if (xml === null) throw new Error(`El XLSX no contiene la parte "${ruta}".`);

  const fechas = new Map<string, Date | null>();
  const aperturaC = /<c\s([^>]*?)(\/?)>/g;
  let m: RegExpExecArray | null;
  while ((m = aperturaC.exec(xml)) !== null) {
    const atributos = m[1]!;
    if (m[2] === '/') continue; // <c … /> — celda vacía, sin valor
    if (!/\bt\s*=\s*"d"/.test(atributos)) continue;
    const dir = /\br\s*=\s*"([^"]+)"/.exec(atributos)?.[1];
    if (dir === undefined) continue;
    const finCelda = xml.indexOf('</c>', aperturaC.lastIndex);
    const abreV = xml.indexOf('<v>', aperturaC.lastIndex);
    // Celda `t="d"` sin `<v>` legible: se REGISTRA como sin fecha, para que nadie caiga al valor
    // equivocado de `exceljs`.
    if (abreV < 0 || (finCelda >= 0 && abreV > finCelda)) {
      fechas.set(dir.toUpperCase(), null);
      continue;
    }
    const cierraV = xml.indexOf('</v>', abreV);
    if (cierraV < 0) {
      fechas.set(dir.toUpperCase(), null);
      continue;
    }
    // Si el contenido no es una fecha ISO, se registra `null` (no se omite la dirección): la celda
    // SIGUE siendo `t="d"`, así que el valor de `exceljs` para ella sigue siendo basura.
    fechas.set(dir.toUpperCase(), fechaDesdeIso(xml.slice(abreV + 3, cierraV)));
  }
  return fechas;
}
