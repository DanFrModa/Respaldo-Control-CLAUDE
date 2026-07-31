/**
 * EXTRACTOR de la Orden de Compra de C&A en PDF (petición Daniel). Función PURA texto→estructura: toma
 * el texto de las páginas del PDF (ya extraído con `unpdf`) y lo parsea POR ANCLAS DE ETIQUETA (el
 * layout del sistema de C&A es estable: pares "Etiqueta: valor"). NO conoce el negocio (no toca BD,
 * no resuelve modelos/colores): sólo devuelve lo que dice el papel + las advertencias de cuadre. El
 * reconocimiento (modelo↔liga, color/talla↔catálogo) y el alta viven en `importacion-pdf.ts` (A1).
 *
 * Por qué `unpdf`: wrapper moderno de una build serverless de pdf.js (Mozilla), 100 % JS SIN
 * dependencias nativas (a diferencia de las libs con binarios), mantenido y con tipos. Extrae SÓLO
 * texto (no renderiza), que es lo único que necesitamos. Verificado contra la OC real de C&A: mantiene
 * "Etiqueta: valor" en la misma línea (mucho más limpio que otras libs). Como sólo extrae texto de un
 * PDF chico (~200 KB, 3 páginas) es RÁPIDO (decenas de ms): corre inline en el request, SIN worker
 * (el worker de documentos del repo es para GENERAR PDFs con @react-pdf, otra cosa).
 *
 * Robustez del parseo: se trabaja sobre el texto NORMALIZADO (saltos de línea → espacios, espacios
 * colapsados) con regex ancladas a la etiqueta y con la FORMA del valor (número/fecha/token), de modo
 * que tolera que una etiqueta se parta en dos líneas ("Monto Total Orden de\nCompra:") o que un valor
 * quede pegado a la etiqueta de al lado. Las validaciones de cuadre (Σ tallas == Piezas Totales;
 * Σ×precio ≈ Monto Total) NO bloquean: se devuelven como ADVERTENCIAS para que el usuario decida.
 */
import { extractText } from 'unpdf';

import { ErrorValidacion } from '../../comun/errores.js';

/** Una talla del PDF (fila de la tabla SKU/Talla/Piezas). */
export interface TallaParseada {
  talla: string;
  piezas: number;
  sku: string | null;
}

/** Cantidad de una talla dentro de un pack (fila del desglose de la sección "Detalles PACK / SKU"). */
export interface DesglosePackParseado {
  talla: string;
  cantidad: number;
}

/**
 * Un grupo de la sección "Detalles PACK / SKU" del PDF. `tipo` = "PACK" (prendas empacadas en un pack
 * con una PROPORCIÓN fija por talla) o "SKU" (piezas sueltas por talla). `desglose` = la corrida por
 * talla de ESE grupo. Base del sobre-pedido por packs (dominio) y del futuro módulo de empaque.
 */
export interface PackParseado {
  pack: string;
  packId: string | null;
  tipo: string;
  unidadesPack: number;
  totalPacks: number;
  totalUnidades: number;
  desglose: DesglosePackParseado[];
}

/** Una advertencia de cuadre (no bloquea la importación). */
export interface AdvertenciaParseada {
  tipo: 'suma-tallas' | 'suma-monto' | 'sin-tallas';
  mensaje: string;
}

/** Resultado del parseo de UNA OC de C&A. */
export interface RenglonPdfCyaParseado {
  numeroOrden: string;
  modeloCliente: string;
  costoUnitario: number;
  piezasTotales: number;
  division: string;
  subDivision: string;
  descripcionArticulo: string;
  idColorCliente: string;
  colorGenerico: string;
  /** Código PANTONE de la OC (vacío si el papel no lo trae — frecuente en C&A). */
  pantone: string;
  codigoUnico: string;
  semanaCliente: string;
  composicion: string;
  montoTotal: number;
  /** Inicio de la ventana "Entrega en DC" en ISO `YYYY-MM-DD`, o null. */
  fechaEntrega: string | null;
  tallas: TallaParseada[];
  packs: PackParseado[];
  advertencias: AdvertenciaParseada[];
}

/** Tope del PDF decodificado (los OCs son chicos; blinda memoria/parseo). */
export const MAX_PDF_BYTES = 10 * 1024 * 1024;

// ── Utilidades de texto ──────────────────────────────────────────────────────

/** Colapsa TODO el espacio en blanco (incl. saltos de línea) a un solo espacio y recorta. */
function normalizar(texto: string): string {
  return texto.replace(/\s+/g, ' ').trim();
}

/** Devuelve el grupo `n` del primer match de `re` sobre `texto`, o '' si no hubo match. */
function match(texto: string, re: RegExp, n = 1): string {
  const m = re.exec(texto);
  return m?.[n]?.trim() ?? '';
}

/** Interpreta un texto como número (tolera separadores/moneda); vacío/inválido → 0. */
function aNumero(texto: string): number {
  if (texto === '') return 0;
  const limpio = texto.replace(/[^0-9.-]/g, '');
  const numero = Number(limpio);
  return Number.isFinite(numero) ? numero : 0;
}

/** Convierte `DD/MM/YYYY` a ISO `YYYY-MM-DD`; devuelve null si no es una fecha válida. */
function aFechaIso(ddmmyyyy: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(ddmmyyyy.trim());
  if (m === null) return null;
  const [, dd, mm, yyyy] = m;
  const dia = Number(dd);
  const mes = Number(mm);
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Colapsa la DUPLICACIÓN del color de C&A: su OC imprime el color genérico DOS veces (una como "Color
 * Generico" y otra como valor de "PANTONE", que en su formato espeja el genérico), así que el texto
 * entre ambas etiquetas es `X X` — p. ej. "BLANCO BLANCO" o "AZUL MARINO AZUL MARINO". Si las dos
 * mitades (por palabras) son idénticas, se devuelve UNA; si no es una duplicación limpia, el texto tal
 * cual (soporta colores de 1..N palabras sin recortar). Recorta y colapsa espacios.
 */
function desduplicarColor(texto: string): string {
  const limpio = texto.trim().replace(/\s+/g, ' ');
  if (limpio === '') return '';
  const palabras = limpio.split(' ');
  if (palabras.length % 2 === 0) {
    const mitad = palabras.length / 2;
    const primera = palabras.slice(0, mitad).join(' ');
    const segunda = palabras.slice(mitad).join(' ');
    if (primera === segunda) return primera;
  }
  return limpio;
}

// ── Extracción del texto del PDF (parte con I/O) ──────────────────────────────

/**
 * Extrae el texto de cada página del PDF con `unpdf`. Lanza `ErrorValidacion` con mensaje claro si el
 * archivo no es un PDF legible (corrupto/otro formato) — el llamador lo trata por-archivo.
 */
export async function extraerTextoPdf(buffer: Buffer): Promise<string[]> {
  if (buffer.length === 0) {
    throw new ErrorValidacion('El PDF está vacío o no se pudo leer.');
  }
  if (buffer.length > MAX_PDF_BYTES) {
    throw new ErrorValidacion('El PDF excede el máximo permitido (10 MB).');
  }
  try {
    // `extractText` acepta los bytes directamente (build serverless de pdf.js); `mergePages:false` da
    // el texto POR PÁGINA (la pág. 1 tiene el encabezado; la 2, la tabla de tallas).
    const { text } = await extractText(new Uint8Array(buffer), { mergePages: false });
    return text;
  } catch {
    throw new ErrorValidacion('El archivo no es un PDF válido o está dañado.');
  }
}

// ── Parseo del texto (parte PURA) ─────────────────────────────────────────────

/** Extrae las tallas de la página 2 (tabla SKU/Talla/Piezas), deteniéndose en Total/Detalles PACK. */
function parsearTallas(paginaTabla: string): TallaParseada[] {
  const tallas: TallaParseada[] = [];
  for (const linea of paginaTabla.split('\n')) {
    const t = linea.trim();
    if (/^total\b/i.test(t) || /detalles pack/i.test(t)) break;
    // Fila de tabla: <SKU 4+ dígitos> <talla> <piezas>. Las líneas de packs (empiezan con letra o
    // con "talla piezas") NO empatan (su primer token no es un SKU numérico largo).
    const m = /^(\d{4,})\s+(\S+)\s+(\d+)$/.exec(t);
    if (m !== null) {
      tallas.push({ sku: m[1] ?? null, talla: m[2] ?? '', piezas: aNumero(m[3] ?? '0') });
    }
  }
  return tallas;
}

/**
 * Extrae los grupos de la sección "Detalles PACK / SKU" CON su desglose por talla (nunca lanza). Cada
 * grupo abre con su renglón resumen (`<Letra> [<PackID>] <PACK|SKU> <u/pack> <packs> <unidades>`) y le
 * siguen sus filas `<talla> <cantidad>` hasta el siguiente grupo. El desglose es lo que el sobre-pedido
 * por packs (dominio) necesita para reconstruir la corrida con la proporción del pack.
 */
function parsearPacks(paginaTabla: string): PackParseado[] {
  try {
    const packs: PackParseado[] = [];
    const lineas = paginaTabla.split('\n');
    const inicio = lineas.findIndex((l) => /detalles pack/i.test(l));
    if (inicio < 0) return [];
    let actual: PackParseado | null = null;
    for (const raw of lineas.slice(inicio + 1)) {
      const linea = raw.trim();
      // Renglón resumen de un pack: <Letra> [<PackID 6+ dígitos>] <PACK|SKU> <u/pack> <packs> <unidades>.
      const resumen = /^([A-Z])\s+(?:(\d{6,})\s+)?(PACK|SKU)\s+(\d+)\s+(\d+)\s+(\d+)$/.exec(linea);
      if (resumen !== null) {
        actual = {
          pack: resumen[1] ?? '',
          packId: resumen[2] ?? null,
          tipo: resumen[3] ?? '',
          unidadesPack: aNumero(resumen[4] ?? '0'),
          totalPacks: aNumero(resumen[5] ?? '0'),
          totalUnidades: aNumero(resumen[6] ?? '0'),
          desglose: [],
        };
        packs.push(actual);
        continue;
      }
      // Fila del desglose del grupo abierto: `<talla> <cantidad>` (el encabezado de columnas y las
      // demás líneas no empatan: su forma no es "token + número" al final del renglón).
      const fila = /^(\S+)\s+(\d+)$/.exec(linea);
      if (fila !== null && actual !== null) {
        actual.desglose.push({ talla: fila[1] ?? '', cantidad: aNumero(fila[2] ?? '0') });
      }
    }
    return packs;
  } catch {
    return [];
  }
}

/**
 * Parsea el texto (por página) de una OC de C&A. PURA (testeable sin PDF). Exige que se reconozca como
 * C&A (nº de orden + modelo del cliente); si no, lanza `ErrorValidacion`. Los demás campos son
 * best-effort. Devuelve la estructura + las advertencias de cuadre (no bloquean).
 */
export function parsearTextoCya(paginas: string[]): RenglonPdfCyaParseado {
  const pagina1 = paginas[0] ?? '';
  const norm = normalizar(pagina1);

  const numeroOrden = match(norm, /Numero de Orden:\s*(\d+)/);
  const modeloCliente = match(norm, /Modelo ID:\s*(\d+)/);
  if (numeroOrden === '' || modeloCliente === '') {
    throw new ErrorValidacion(
      'El PDF no parece una orden de compra de C&A (no se encontró "Numero de Orden" y/o "Modelo ID").',
    );
  }

  const costoUnitario = aNumero(match(norm, /Costo Unitario \(FOB\):\s*([\d.,]+)/));
  const piezasTotales = aNumero(match(norm, /Piezas Totales:\s*(\d+)/));
  const montoTotal = aNumero(match(norm, /Monto Total Orden de\s*Compra:\s*([\d.,]+)/));
  // División: "3- KIDS". Se corta antes del siguiente código "\d+-" (la Familia) o de "Familia:".
  // `(?<!Sub )` evita casar la "Division:" de "Sub Division:".
  const division = match(
    norm,
    /(?<!Sub )Division:\s*(\d+\s*-\s*[^:]*?)(?=\s+\d+\s*-|\s+Familia:|$)/,
  );
  // Sub División: en el bloque "Descripcion del Articulo" el VALOR PRECEDE a la etiqueta (como en
  // "Entrega en DC"). En el layout real la fila es `Division: 3- KIDS | Sub Division: 34- NIÑO | Grupo
  // de Producto: 341- MODA`, pero unpdf aplana el valor ANTES de su etiqueta: `…34- NIÑOSub Division:`.
  // Se captura el código-valor (`\d+- TEXTO`) inmediatamente ANTES de "Sub Division:"; `[^:]` impide
  // cruzar la etiqueta previa ("Grupo de Producto:"), así que sólo casa "34- NIÑO". Vacío si no hay.
  const subDivision = match(norm, /(\d+\s*-\s*[^:]*?)\s*Sub Division:/);
  const descripcionArticulo = match(norm, /Descripcion del Articulo:\s*(.*?)\s*(?=ID Color:|$)/);
  const idColorCliente = match(norm, /ID Color:\s*(\d+)/);
  // Color genérico: C&A REPITE el color (el mismo texto va también como valor de PANTONE, que en su
  // formato espeja el color genérico): `Color Generico: BLANCO BLANCOPANTONE:`. Se captura TODO lo que
  // hay entre "Color Generico:" y "PANTONE:" (la etiqueta suele venir PEGADA al último token) y, si es
  // una duplicación limpia ("X X" → mitad === mitad), se toma UNA mitad; si no, el texto completo
  // (soporta colores de 2+ palabras: "AZUL MARINO"). Si no hay "PANTONE:", cae al run de letras.
  const colorGenerico = desduplicarColor(
    match(norm, /Color Generico:\s*(.*?)\s*PANTONE:/) ||
      match(norm, /Color Generico:\s*([A-Za-zÀ-ÿ]+(?:\s+[A-Za-zÀ-ÿ]+)*)/),
  );
  // PANTONE: el CÓDIGO va DESPUÉS de "PANTONE:" y ANTES de la siguiente etiqueta ("Composición:", que
  // en la OC de C&A siempre le sigue). En la OC real viene VACÍO (`…BLANCO BLANCOPANTONE: Composición:`
  // → ''); cuando trae código captura "11-0601 TCX". El `[^:]` impide cruzar a otra etiqueta (no arrastra
  // texto ajeno) y el color ya se cortó ANTES de "PANTONE:", así que ninguno se come al otro.
  const pantone = match(norm, /PANTONE:\s*([^:]*?)\s*Composici[oó]n:/);
  const codigoUnico = match(norm, /Codigo Unico:\s*(\S+)/);
  const semanaCliente = match(norm, /Semana C&A:\s*(\d+)/);
  const composicion = match(norm, /Composici[oó]n:\s*(.+?)\s*\d[\d.]*Costo Unitario Final:/);

  // Fecha de entrega = INICIO de la ventana "Entrega en DC" (petición Daniel); si no, "Fecha de Entrega".
  const ventana = match(norm, /(\d{2}\/\d{2}\/\d{4})\s*-\s*\d{2}\/\d{2}\/\d{4}\s*Entrega en DC:/);
  const fechaSuelta = match(norm, /Fecha de Entrega:\s*(\d{2}\/\d{2}\/\d{4})/);
  const fechaEntrega = aFechaIso(ventana !== '' ? ventana : fechaSuelta);

  const paginaTabla = paginas[1] ?? '';
  const tallas = parsearTallas(paginaTabla);
  const packs = parsearPacks(paginaTabla);

  const advertencias = validar({ piezasTotales, costoUnitario, montoTotal, tallas });

  return {
    numeroOrden,
    modeloCliente,
    costoUnitario,
    piezasTotales,
    division,
    subDivision,
    descripcionArticulo,
    idColorCliente,
    colorGenerico,
    pantone,
    codigoUnico,
    semanaCliente,
    composicion,
    montoTotal,
    fechaEntrega,
    tallas,
    packs,
    advertencias,
  };
}

/** Valida el cuadre (tallas/monto) y devuelve advertencias (nunca lanza; NO bloquean). */
function validar(datos: {
  piezasTotales: number;
  costoUnitario: number;
  montoTotal: number;
  tallas: TallaParseada[];
}): AdvertenciaParseada[] {
  const advertencias: AdvertenciaParseada[] = [];
  if (datos.tallas.length === 0) {
    advertencias.push({
      tipo: 'sin-tallas',
      mensaje: 'No se encontró la tabla de tallas del PDF; la OP no tendría matriz.',
    });
    return advertencias;
  }
  const sumaTallas = datos.tallas.reduce((s, t) => s + t.piezas, 0);
  if (sumaTallas !== datos.piezasTotales) {
    advertencias.push({
      tipo: 'suma-tallas',
      mensaje: `Las tallas suman ${sumaTallas} pz, pero el PDF declara ${datos.piezasTotales} pz totales.`,
    });
  }
  // Σ×precio ≈ Monto Total. Tolerancia proporcional (un centavo por prenda) para absorber el redondeo
  // del precio unitario, evitando falsas alarmas en OCs grandes.
  const esperado = sumaTallas * datos.costoUnitario;
  const tolerancia = Math.max(1, sumaTallas * 0.01);
  if (datos.montoTotal > 0 && Math.abs(esperado - datos.montoTotal) > tolerancia) {
    advertencias.push({
      tipo: 'suma-monto',
      mensaje: `Σ tallas × costo (${esperado.toFixed(2)}) no cuadra con el Monto Total del PDF (${datos.montoTotal.toFixed(2)}).`,
    });
  }
  return advertencias;
}

/** Extrae el texto del PDF y lo parsea como OC de C&A (I/O + parseo puro). */
export async function parsearPdfCya(buffer: Buffer): Promise<RenglonPdfCyaParseado> {
  const paginas = await extraerTextoPdf(buffer);
  return parsearTextoCya(paginas);
}
