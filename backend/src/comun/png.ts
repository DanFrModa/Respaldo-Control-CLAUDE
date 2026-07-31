/**
 * Lectura de la CABECERA de un PNG (chunk IHDR) — sin librerías: basta con un `Buffer`.
 *
 * Para qué: `@react-pdf/renderer` (el motor de TODOS los impresos) no pinta bien dos variantes
 * legítimas del formato — los PNG de **16 bits por canal** y los de **color indexado con
 * transparencia** (paleta + chunk `tRNS`). Salen con los colores corridos o el fondo en negro. El
 * caso real: un logo así se ve perfecto en el navegador y se imprime mal en cada PDF, sin ningún
 * mensaje de error que explique por qué.
 *
 * Por eso el logo se INSPECCIONA al subirlo y se rechaza con un mensaje que dice qué hacer, en vez
 * de dejar que el problema aparezca semanas después en un documento que ya se mandó a un cliente.
 *
 * Formato (spec PNG): 8 bytes de firma + chunks `[largo(4) | tipo(4) | datos | crc(4)]`. El primer
 * chunk SIEMPRE es `IHDR` (13 bytes de datos): ancho(4), alto(4), profundidad(1), tipo de color(1),
 * compresión(1), filtro(1), entrelazado(1).
 */

/** Firma de 8 bytes con la que empieza todo PNG. */
const FIRMA_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Offsets dentro del archivo (firma 8 + largo 4 + tipo 4 = 16 → aquí empiezan los datos IHDR). */
const OFFSET_DATOS_IHDR = 16;
const OFFSET_PROFUNDIDAD = OFFSET_DATOS_IHDR + 8; // tras ancho(4) + alto(4)
const OFFSET_TIPO_COLOR = OFFSET_PROFUNDIDAD + 1;

/** Tipo de color del IHDR (spec PNG §11.2.2). */
export const TIPO_COLOR_INDEXADO = 3;

/** Lo que interesa de la cabecera de un PNG. */
export interface CabeceraPng {
  ancho: number;
  alto: number;
  /** Bits por canal: 1, 2, 4, 8 o 16. */
  profundidadBits: number;
  /** 0 gris · 2 RGB · 3 indexado (paleta) · 4 gris+alfa · 6 RGBA. */
  tipoColor: number;
  /** ¿Trae el chunk `tRNS` (transparencia fuera del canal alfa)? */
  tieneTrns: boolean;
}

/** ¿El buffer empieza con la firma de un PNG? (los JPG y demás dan `false`). */
export function esPng(bytes: Buffer): boolean {
  return bytes.length >= FIRMA_PNG.length && bytes.subarray(0, FIRMA_PNG.length).equals(FIRMA_PNG);
}

/**
 * Lee la cabecera de un PNG. Devuelve `null` si el buffer no es un PNG legible (firma equivocada o
 * truncado antes del IHDR) — quien llama decide si eso es un error.
 */
export function leerCabeceraPng(bytes: Buffer): CabeceraPng | null {
  if (!esPng(bytes) || bytes.length < OFFSET_TIPO_COLOR + 1) return null;
  // El primer chunk debe ser IHDR; si no, el archivo no cumple la spec.
  if (bytes.subarray(12, 16).toString('latin1') !== 'IHDR') return null;

  const tipoColor = bytes.readUInt8(OFFSET_TIPO_COLOR);
  return {
    ancho: bytes.readUInt32BE(OFFSET_DATOS_IHDR),
    alto: bytes.readUInt32BE(OFFSET_DATOS_IHDR + 4),
    profundidadBits: bytes.readUInt8(OFFSET_PROFUNDIDAD),
    tipoColor,
    // El `tRNS` solo se busca cuando puede cambiar el veredicto (paleta transparente).
    tieneTrns: tipoColor === TIPO_COLOR_INDEXADO && tieneChunk(bytes, 'tRNS'),
  };
}

/**
 * ¿Está presente el chunk `tipo`? Recorre la cadena de chunks saltando por su largo declarado (no
 * busca el texto a ciegas: los datos comprimidos pueden contener esos 4 bytes por casualidad). Se
 * detiene en `IDAT` — los chunks que nos importan van antes de los datos de imagen.
 */
function tieneChunk(bytes: Buffer, tipo: string): boolean {
  let posicion = 8; // tras la firma
  while (posicion + 8 <= bytes.length) {
    const largo = bytes.readUInt32BE(posicion);
    const nombre = bytes.subarray(posicion + 4, posicion + 8).toString('latin1');
    if (nombre === tipo) return true;
    if (nombre === 'IDAT' || nombre === 'IEND') return false;
    // largo + 12 = los 4 del largo, los 4 del tipo y los 4 del CRC.
    const siguiente = posicion + largo + 12;
    // Guard anti-archivo-corrupto: un largo absurdo (o negativo por overflow) corta el recorrido.
    if (siguiente <= posicion || siguiente > bytes.length) return false;
    posicion = siguiente;
  }
  return false;
}

/**
 * Valida que un PNG sea de los que el generador de PDFs SÍ pinta bien. Devuelve el mensaje de
 * error (en lenguaje de usuario, con la salida sugerida) o `null` si el PNG es apto.
 *
 * No opina de nada más (tamaño, dimensiones o si es PNG siquiera): eso ya lo validan las capas de
 * arriba. Función PURA para poder probar cada variante sin R2 ni base de datos.
 */
export function problemaPngParaPdf(bytes: Buffer): string | null {
  const cabecera = leerCabeceraPng(bytes);
  if (cabecera === null) {
    return 'El archivo no es un PNG válido (su cabecera está dañada o incompleta). Vuelve a guardarlo como PNG de 8 bits o JPG.';
  }
  if (cabecera.profundidadBits === 16) {
    return 'El logo es un PNG de 16 bits por canal y los PDF de CONTROL lo imprimen con los colores alterados. Guárdalo como PNG de 8 bits o JPG y vuelve a subirlo.';
  }
  if (cabecera.tipoColor === TIPO_COLOR_INDEXADO && cabecera.tieneTrns) {
    return 'El logo es un PNG de color indexado (paleta) CON transparencia y los PDF de CONTROL lo imprimen con el fondo en negro. Guárdalo como PNG de 8 bits o JPG y vuelve a subirlo.';
  }
  return null;
}
