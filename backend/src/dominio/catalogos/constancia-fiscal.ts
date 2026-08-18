/**
 * LECTOR de la Constancia de Situación Fiscal (CSF) del SAT — §Post-F9.55.
 *
 * Daniel: *"En proveedores me gustaría poder subir su Constancia de Situación Fiscal para darlos de
 * alta. Con ese documento se llena toda la info en automático: RFC, direcciones, etc."*
 *
 * ⭐ **El documento PROPONE, la persona CONFIRMA.** Esta pieza NO guarda nada: devuelve lo que dice el
 * papel y la pantalla llena los campos para que alguien los revise y acepte. El `rfc` y el
 * `regimenFiscalSat` alimentan el CFDI: un carácter mal leído no se nota hasta que una factura sale
 * mal. Dos segundos de revisión a cambio de no meter basura fiscal en silencio.
 *
 * Función PURA texto→estructura (la extracción del PDF vive en `comun/pdf-texto.ts`, la misma que usa
 * el importador de OC de C&A: *"se reusa, no se inventa"*). NO toca la BD ni el catálogo.
 *
 * ── LAS CUATRO TRAMPAS DEL FORMATO, y cómo se atienden ──────────────────────────────────────────
 *
 * 1. **Etiquetas VACÍAS que dejan el texto pegado.** En la constancia de persona física el
 *    `Tipo de Vialidad`, el `Nombre de la Localidad` y el `Entre Calle` vienen SIN valor, y el texto
 *    extraído queda así:
 *
 *        Tipo de Vialidad: Nombre de Vialidad: TAINE
 *
 *    Un lector que corte "hasta el fin de línea" mete `Nombre de Vialidad: TAINE` como tipo de
 *    vialidad y sigue tan campante: basura en el domicilio **sin fallar**, que es la peor forma de
 *    equivocarse. Por eso aquí cada campo se corta **en la SIGUIENTE ETIQUETA CONOCIDA**
 *    ({@link valorEntreEtiquetas}) y el vacío queda vacío.
 *
 * 2. **Dos formatos.** Persona MORAL trae `Denominación/Razón Social` + `Régimen Capital`; persona
 *    FÍSICA trae `CURP` + `Nombre (s)` + apellidos, y la razón social se **COMPONE** (el SAT no la
 *    imprime). Se distinguen por la presencia de `CURP:`.
 *
 * 3. **Varios regímenes.** La constancia física de la muestra trae DOS; la moral, uno. Con más de
 *    uno se PROPONEN todos y la persona escoge — nunca se toma el primero en silencio.
 *
 * 4. **Campos partidos entre páginas** (`Entre Calle:` cierra la pág. 1 y `Y Calle:` abre la 2): se
 *    concatena TODO el documento ANTES de recortar.
 *
 * Si el SAT cambia el formato y no se logra leer, esto NO bloquea el alta: devuelve lo que pudo con
 * sus advertencias y la pantalla deja capturar a mano (degradar con gracia, nunca al revés).
 */
import { ErrorValidacion } from '../../comun/errores.js';
import { extraerTextoPdf } from '../../comun/pdf-texto.js';

/** Un régimen fiscal leído de la constancia, ya traducido a la clave del catálogo del SAT. */
export interface RegimenParseado {
  /** Clave del catálogo `c_RegimenFiscal` del SAT (p. ej. "601"), o '' si no se reconoció. */
  clave: string;
  /** El texto tal como lo imprime la constancia. */
  descripcion: string;
}

/** Lo que la constancia PROPONE. Nada de esto se guarda sin que una persona lo acepte. */
export interface ConstanciaParseada {
  /** `fisica` si el documento trae CURP; `moral` si trae denominación/razón social. */
  tipoPersona: 'fisica' | 'moral';
  rfc: string;
  /** Moral: la denominación tal cual. Física: nombre + apellidos COMPUESTOS (el SAT no la imprime). */
  razonSocial: string;
  /** CURP (solo persona física), o '' . */
  curp: string;
  /** Regímenes encontrados. Si hay más de uno, la persona escoge (nunca se toma el primero solo). */
  regimenes: RegimenParseado[];
  /** CP del domicilio fiscal = CP de expedición del comprobante. */
  codigoPostalExpedicion: string;
  /** Domicilio armado con las partes que SÍ traen valor (las vacías no dejan hueco ni basura). */
  direccion: string;
  /** Lo que no se pudo leer, en lenguaje llano. NO bloquea: la pantalla deja capturar a mano. */
  advertencias: string[];
}

// ── Catálogo `c_RegimenFiscal` del SAT (clave → frase distintiva de su nombre) ───────────────────
// La constancia imprime el NOMBRE del régimen, no su clave, así que hay que traducir. Se busca por
// una frase DISTINTIVA y en orden: las más específicas primero, porque varias se contienen entre sí
// ("Actividades Empresariales" está en el 612 y también, con otra cola, en el 625).
const REGIMENES_SAT: { clave: string; frase: string; nombre: string }[] = [
  {
    clave: '625',
    frase: 'plataformas tecnologicas',
    nombre: 'Actividades Empresariales con ingresos a través de Plataformas Tecnológicas',
  },
  {
    clave: '612',
    frase: 'empresariales y profesionales',
    nombre: 'Personas Físicas con Actividades Empresariales y Profesionales',
  },
  { clave: '626', frase: 'simplificado de confianza', nombre: 'Régimen Simplificado de Confianza' },
  {
    clave: '601',
    frase: 'general de ley personas morales',
    nombre: 'General de Ley Personas Morales',
  },
  {
    clave: '603',
    frase: 'fines no lucrativos',
    nombre: 'Personas Morales con Fines no Lucrativos',
  },
  {
    clave: '605',
    frase: 'sueldos y salarios',
    nombre: 'Sueldos y Salarios e Ingresos Asimilados a Salarios',
  },
  { clave: '606', frase: 'arrendamiento', nombre: 'Arrendamiento' },
  {
    clave: '607',
    frase: 'enajenacion o adquisicion de bienes',
    nombre: 'Enajenación o Adquisición de Bienes',
  },
  { clave: '608', frase: 'demas ingresos', nombre: 'Demás ingresos' },
  {
    clave: '610',
    frase: 'residentes en el extranjero',
    nombre: 'Residentes en el Extranjero sin Establecimiento Permanente en México',
  },
  { clave: '611', frase: 'dividendos', nombre: 'Ingresos por Dividendos (socios y accionistas)' },
  { clave: '614', frase: 'ingresos por intereses', nombre: 'Ingresos por intereses' },
  {
    clave: '615',
    frase: 'obtencion de premios',
    nombre: 'Régimen de los ingresos por obtención de premios',
  },
  { clave: '616', frase: 'sin obligaciones fiscales', nombre: 'Sin obligaciones fiscales' },
  {
    clave: '620',
    frase: 'sociedades cooperativas de produccion',
    nombre: 'Sociedades Cooperativas de Producción que optan por diferir sus ingresos',
  },
  { clave: '621', frase: 'incorporacion fiscal', nombre: 'Incorporación Fiscal' },
  {
    clave: '622',
    frase: 'agricolas, ganaderas',
    nombre: 'Actividades Agrícolas, Ganaderas, Silvícolas y Pesqueras',
  },
  { clave: '623', frase: 'grupos de sociedades', nombre: 'Opcional para Grupos de Sociedades' },
  { clave: '624', frase: 'coordinados', nombre: 'Coordinados' },
];

/**
 * TODAS las etiquetas que la constancia puede imprimir. Es la pieza clave del parseo: el valor de un
 * campo va desde su etiqueta hasta la SIGUIENTE etiqueta de esta lista (trampa 1). Incluye a
 * propósito etiquetas que no se usan (estatus, obligaciones, teléfonos…): están aquí justamente
 * para servir de FRENO al campo anterior. Se aceptan las variantes de redacción que el SAT ha
 * usado (`Denominación/Razón Social` y `Denominación o Razón Social`, con y sin acento).
 */
const ETIQUETAS: string[] = [
  'RFC',
  'CURP',
  'Nombre \\(s\\)',
  'Primer Apellido',
  'Segundo Apellido',
  'Denominaci[oó]n/Raz[oó]n Social',
  'Denominaci[oó]n o Raz[oó]n Social',
  'R[eé]gimen Capital',
  'Nombre Comercial',
  'Fecha de inicio de operaciones',
  'Fecha inicio de operaciones',
  'Situaci[oó]n del contribuyente',
  'Estatus en el padr[oó]n',
  'Fecha de [uú]ltimo cambio de estado',
  'Nombre del Contribuyente',
  'C[oó]digo Postal',
  'Tipo de Vialidad',
  'Nombre de Vialidad',
  'N[uú]mero Exterior',
  'N[uú]mero Interior',
  'Nombre de la Colonia',
  'Nombre de la Localidad',
  'Municipio o Delegaci[oó]n',
  'Nombre de la Entidad Federativa',
  'Entre Calle',
  'Y Calle',
  'Tipo de Inmueble',
  'Correo Electr[oó]nico',
  'Al\\. Telef[oó]nica',
  'Tel\\. Fijo Lada',
  'N[uú]mero',
  'Datos de identificaci[oó]n del contribuyente',
  'Datos del domicilio registrado',
  'Caracter[ií]sticas fiscales',
  'Reg[ií]menes',
  'Obligaciones',
];

/** Alternancia de TODAS las etiquetas, con sus dos puntos. Es el "freno" de cada campo. */
const RE_CUALQUIER_ETIQUETA = new RegExp(`(?:${ETIQUETAS.join('|')})\\s*:`, 'i');

/** Quita acentos y baja a minúsculas (para comparar sin pelearse con la tipografía del SAT). */
function normalizarComparacion(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/** Colapsa todo el espacio en blanco (saltos de línea incluidos) a un espacio y recorta. */
function aplanar(texto: string): string {
  return texto.replace(/\s+/g, ' ').trim();
}

/**
 * ⭐ EL CORAZÓN DEL PARSEO (trampa 1). Devuelve el valor de `etiqueta` cortado en la **siguiente
 * etiqueta conocida**, no en el fin de línea. Si entre las dos etiquetas no hay nada, devuelve ''
 * — que es la respuesta correcta para un campo que el SAT imprimió vacío.
 *
 * `Tipo de Vialidad: Nombre de Vialidad: TAINE` → tipo de vialidad = '' y nombre de vialidad =
 * 'TAINE'. Cortar por fin de línea daría 'Nombre de Vialidad: TAINE' como tipo de vialidad.
 */
export function valorEntreEtiquetas(texto: string, etiqueta: string): string {
  const inicio = new RegExp(`${etiqueta}\\s*:`, 'i').exec(texto);
  if (inicio === null) return '';
  const resto = texto.slice(inicio.index + inicio[0].length);
  const siguiente = RE_CUALQUIER_ETIQUETA.exec(resto);
  const crudo = siguiente === null ? resto : resto.slice(0, siguiente.index);
  return aplanar(crudo);
}

/** Une con ', ' las partes que traen algo (una parte vacía no deja hueco ni coma suelta). */
function unir(partes: (string | undefined)[], separador = ', '): string {
  return partes.filter((p): p is string => p !== undefined && p.trim() !== '').join(separador);
}

/**
 * Busca los regímenes en el bloque que va de `Regímenes:` a `Obligaciones:` (o al final). Devuelve
 * uno por cada nombre del catálogo del SAT que aparezca, SIN repetir. Si el bloque trae texto pero
 * no se reconoce ningún nombre, devuelve un renglón con la clave vacía y el texto crudo: se ve lo
 * que dice el papel y la persona teclea la clave.
 */
export function parsearRegimenes(texto: string): RegimenParseado[] {
  const desde = /R[eé]g[ií]menes\s*:?/i.exec(texto);
  if (desde === null) return [];
  const resto = texto.slice(desde.index + desde[0].length);
  const hasta = /Obligaciones\s*:/i.exec(resto);
  const bloque = hasta === null ? resto : resto.slice(0, hasta.index);
  const plano = normalizarComparacion(aplanar(bloque));

  const encontrados: RegimenParseado[] = [];
  for (const r of REGIMENES_SAT) {
    if (plano.includes(r.frase) && !encontrados.some((e) => e.clave === r.clave)) {
      encontrados.push({ clave: r.clave, descripcion: r.nombre });
    }
  }
  if (encontrados.length === 0 && aplanar(bloque) !== '') {
    // El bloque existe pero no empata con el catálogo (¿formato nuevo? ¿régimen que no está en la
    // lista?). Se devuelve el texto crudo, recortado, para que se vea y se decida a mano.
    const crudo = aplanar(bloque)
      .replace(/Fecha\s+(Inicio|Fin)/gi, '')
      .trim();
    if (crudo !== '') {
      encontrados.push({ clave: '', descripcion: crudo.slice(0, 200) });
    }
  }
  return encontrados;
}

/**
 * Parsea el TEXTO ya extraído de la constancia (parte pura y probable sin PDF). Recibe las páginas y
 * las CONCATENA antes de recortar (trampa 4: `Entre Calle:` cierra una página y `Y Calle:` abre la
 * siguiente).
 */
export function parsearTextoConstancia(paginas: string[]): ConstanciaParseada {
  const texto = paginas.join('\n');
  const advertencias: string[] = [];

  const curp = valorEntreEtiquetas(texto, 'CURP').toUpperCase();
  const tipoPersona: 'fisica' | 'moral' = curp === '' ? 'moral' : 'fisica';

  // El RFC aparece dos veces (cédula + datos de identificación) con el MISMO valor: la primera basta.
  const rfc = valorEntreEtiquetas(texto, 'RFC').toUpperCase().replace(/\s+/g, '');
  if (rfc === '') {
    advertencias.push('No se encontró el RFC en el documento.');
  }

  let razonSocial: string;
  if (tipoPersona === 'moral') {
    razonSocial =
      valorEntreEtiquetas(texto, 'Denominaci[oó]n/Raz[oó]n Social') ||
      valorEntreEtiquetas(texto, 'Denominaci[oó]n o Raz[oó]n Social');
    if (razonSocial === '') {
      advertencias.push('No se encontró la denominación o razón social.');
    }
  } else {
    // Persona física: el SAT NO imprime una "razón social" — se COMPONE con nombre y apellidos.
    razonSocial = unir(
      [
        valorEntreEtiquetas(texto, 'Nombre \\(s\\)'),
        valorEntreEtiquetas(texto, 'Primer Apellido'),
        valorEntreEtiquetas(texto, 'Segundo Apellido'),
      ],
      ' ',
    );
    if (razonSocial === '') {
      advertencias.push('No se encontró el nombre del contribuyente.');
    }
  }

  const codigoPostal = valorEntreEtiquetas(texto, 'C[oó]digo Postal')
    .replace(/\D/g, '')
    .slice(0, 5);
  if (codigoPostal.length !== 5) {
    advertencias.push('No se encontró un código postal de 5 dígitos.');
  }

  // Domicilio: cada parte se corta en la siguiente etiqueta, así que las VACÍAS quedan vacías y no
  // arrastran el texto de la de al lado.
  const tipoVialidad = valorEntreEtiquetas(texto, 'Tipo de Vialidad');
  const nombreVialidad = valorEntreEtiquetas(texto, 'Nombre de Vialidad');
  const numeroExterior = valorEntreEtiquetas(texto, 'N[uú]mero Exterior');
  const numeroInterior = valorEntreEtiquetas(texto, 'N[uú]mero Interior');
  const colonia = valorEntreEtiquetas(texto, 'Nombre de la Colonia');
  const localidad = valorEntreEtiquetas(texto, 'Nombre de la Localidad');
  const municipio = valorEntreEtiquetas(texto, 'Municipio o Delegaci[oó]n');
  const entidad = valorEntreEtiquetas(texto, 'Nombre de la Entidad Federativa');

  const calle = unir([tipoVialidad, nombreVialidad], ' ');
  const numeros = unir(
    [
      numeroExterior === '' ? undefined : `No. ${numeroExterior}`,
      numeroInterior === '' ? undefined : `Int. ${numeroInterior}`,
    ],
    ' ',
  );
  const direccion = unir([
    unir([calle, numeros], ' '),
    colonia === '' ? undefined : `Col. ${colonia}`,
    localidad,
    municipio,
    entidad,
    codigoPostal === '' ? undefined : `C.P. ${codigoPostal}`,
  ]);
  if (direccion === '') {
    advertencias.push('No se encontró el domicilio fiscal.');
  }

  const regimenes = parsearRegimenes(texto);
  if (regimenes.length === 0) {
    advertencias.push('No se encontró el régimen fiscal.');
  } else if (regimenes.length > 1) {
    advertencias.push(
      `La constancia trae ${String(regimenes.length)} regímenes: escoge cuál usar para el CFDI.`,
    );
  } else if (regimenes[0]?.clave === '') {
    advertencias.push(
      'El régimen no está en el catálogo del SAT que conoce el sistema: captúralo a mano.',
    );
  }

  return {
    tipoPersona,
    rfc,
    razonSocial,
    curp,
    regimenes,
    codigoPostalExpedicion: codigoPostal,
    direccion,
    advertencias,
  };
}

/** Extrae el texto del PDF y lo parsea. Único punto con I/O de este módulo. */
export async function parsearConstanciaPdf(buffer: Buffer): Promise<ConstanciaParseada> {
  const paginas = await extraerTextoPdf(buffer);
  const parseada = parsearTextoConstancia(paginas);
  // Un PDF que no es una constancia (una factura, una foto escaneada) no trae NADA de esto. Se
  // corta aquí con un mensaje claro en vez de devolver un formulario lleno de vacíos.
  if (parseada.rfc === '' && parseada.razonSocial === '' && parseada.direccion === '') {
    throw new ErrorValidacion(
      'No se pudo leer el documento como una Constancia de Situación Fiscal (¿es el archivo ' +
        'correcto? ¿es un escaneo en imagen?). Captura los datos a mano.',
    );
  }
  return parseada;
}
