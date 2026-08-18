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
 * TODAS las etiquetas que la constancia imprime, **tomadas del texto real de dos constancias del
 * SAT** (una física y una moral) tal como lo entrega `unpdf` — no de una reconstrucción. Es la
 * pieza clave del parseo: el valor de un campo va desde su etiqueta hasta la SIGUIENTE etiqueta de
 * esta lista (trampa 1). Incluye a propósito etiquetas que no se usan (estatus, obligaciones,
 * actividades económicas…): están aquí justamente para servir de FRENO al campo anterior.
 *
 * 🔴 **Aquí estuvo el defecto que costó esta etapa.** La lista decía `Municipio o Delegación`,
 * pero el SAT imprime la forma LARGA: **`Nombre del Municipio o Demarcación Territorial:`**. Al no
 * reconocerla, el valor de `Nombre de la Localidad` se la tragaba entera y el domicilio salía con
 * la etiqueta dentro — sin tronar y sin avisar. Se descubrió al probar contra los PDF reales, no
 * contra el texto reconstruido. Por eso ahora hay, además, la RED de {@link etiquetaColada}.
 *
 * Se aceptan las variantes de redacción que el SAT ha usado (con y sin acento; la forma corta
 * `Municipio o Delegación` se conserva por si vuelve).
 */
const ETIQUETAS: string[] = [
  // ── Identificación ──────────────────────────────────────────────────────────
  'idCIF',
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
  'Datos de Identificaci[oó]n del Contribuyente',
  // ── Domicilio ───────────────────────────────────────────────────────────────
  'C[oó]digo Postal',
  'Tipo de Vialidad',
  'Nombre de Vialidad',
  'N[uú]mero Exterior',
  'N[uú]mero Interior',
  'Nombre de la Colonia',
  'Nombre de la Localidad',
  // ⚠️ La forma LARGA primero: la corta es prefijo de nada, pero el orden documenta cuál manda.
  'Nombre del Municipio o Demarcaci[oó]n Territorial',
  'Municipio o Delegaci[oó]n',
  'Nombre de la Entidad Federativa',
  'Entre Calle',
  'Y Calle',
  'Tipo de Inmueble',
  'Correo Electr[oó]nico',
  'Al\\. Telef[oó]nica',
  'Tel\\. Fijo Lada',
  'N[uú]mero',
  // ── Secciones y pies ────────────────────────────────────────────────────────
  'Actividades Econ[oó]micas',
  'Caracter[ií]sticas fiscales',
  'Reg[ií]menes',
  'Obligaciones',
  'Descripci[oó]n de la Obligaci[oó]n',
  'Cadena Original Sello',
  'Sello Digital',
];

/**
 * Encabezados de sección que el SAT imprime **SIN dos puntos** (`Datos del domicilio registrado`,
 * la fila de títulos de las tablas…). No aportan valor, pero SÍ tienen que frenar al campo
 * anterior: sin ellos, `Nombre Comercial:` se comería el encabezado de la sección siguiente.
 * Van aparte porque {@link ETIQUETAS} exige el `:` y éstos no lo llevan.
 */
const CORTES_SIN_DOS_PUNTOS: string[] = [
  'Datos del domicilio registrado',
  'Registro Federal de Contribuyentes',
  'Nombre, denominaci[oó]n o raz[oó]n',
  'Lugar y Fecha de Emisi[oó]n',
  'C[EÉ]DULA DE IDENTIFICACI[OÓ]N FISCAL',
  'CONSTANCIA DE SITUACI[OÓ]N FISCAL',
  'Orden Actividad Econ[oó]mica Porcentaje',
  'R[eé]gimen Fecha Inicio Fecha Fin',
  'P[aá]gina \\[',
];

/**
 * Alternancia de TODO lo que frena a un campo: las etiquetas con sus dos puntos y los encabezados
 * de sección que no los llevan.
 */
const RE_CUALQUIER_ETIQUETA = new RegExp(
  `(?:(?:${ETIQUETAS.join('|')})\\s*:|${CORTES_SIN_DOS_PUNTOS.join('|')})`,
  'i',
);

/**
 * ⭐ LA RED DE SEGURIDAD (§Post-F9.55, exigida tras el defecto del municipio).
 *
 * Vale más que cualquier etiqueta que se agregue a la lista: comprueba que un valor ya extraído no
 * lleve DENTRO el texto de otra etiqueta. Si lo lleva, el corte falló —da igual por qué—, así que
 * el valor se recorta ahí y se AVISA. Convierte toda esta familia de errores de invisible en
 * visible.
 *
 * Detecta DOS casos, y el segundo es el que importa:
 *  1. Una etiqueta **conocida** metida en el valor: se nombra tal cual, para que el aviso diga qué
 *     pasó.
 *  2. ⭐ Cualquier otro `Texto:` que quede dentro. Los campos de una constancia **no llevan dos
 *     puntos en su valor** (ni el RFC, ni el nombre, ni el domicilio), así que un `:` sobrante
 *     sólo puede venir de una etiqueta que el lector NO conoce. Éste es justo el caso que se nos
 *     coló: el SAT cambió `Municipio o Delegación` por `Nombre del Municipio o Demarcación
 *     Territorial` y, al no reconocerla, el domicilio se la tragó sin una queja. Con esta segunda
 *     regla, el próximo cambio de formato del SAT AVISA en vez de guardar basura.
 *
 * Devuelve el texto de lo que se coló (etiqueta conocida o fragmento sospechoso), o `null` si el
 * valor está limpio.
 */
export function etiquetaColada(valor: string): string | null {
  const conocida = new RegExp(`(${ETIQUETAS.join('|')})\\s*:`, 'i').exec(valor);
  if (conocida !== null) {
    return conocida[1] ?? null;
  }
  return etiquetaDesconocida(valor);
}

/** ¿La palabra tiene forma de PALABRA DE ETIQUETA? (Title Case: mayúscula seguida de minúscula). */
function esPalabraDeEtiqueta(palabra: string): boolean {
  return /^[A-ZÁÉÍÓÚÑ][a-záéíóúñ]/.test(palabra);
}

/** Conectores que unen las palabras de una etiqueta ("Nombre **de la** Colonia"). */
const CONECTORES = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'o', 'y', 'e', 'en', 'a']);

/**
 * Busca una etiqueta que el lector NO conoce dentro de un valor, apoyándose en cómo el SAT
 * TIPOGRAFÍA la constancia: las **etiquetas van en Title Case** ("Nombre de la Colonia") y los
 * **valores en MAYÚSCULAS** ("LOMAS VERDES"). Así, ante
 * `LOMAS VERDES Nombre de la Sub-Localidad:` se devuelve `Nombre de la Sub-Localidad` y el valor
 * limpio (`LOMAS VERDES`) se conserva, en vez de tirarlo entero.
 *
 * Un valor de constancia no lleva dos puntos, así que un `:` sobrante siempre es señal de corte
 * fallido; lo que esta función acota es CUÁNTO de lo que quedó es la etiqueta intrusa.
 */
function etiquetaDesconocida(valor: string): string | null {
  const dosPuntos = valor.indexOf(':');
  if (dosPuntos < 0) {
    return null;
  }
  const palabras = valor.slice(0, dosPuntos).trim().split(/\s+/);
  let desde = palabras.length;
  let hayTitulo = false;
  while (desde > 0) {
    const palabra = palabras[desde - 1] ?? '';
    if (esPalabraDeEtiqueta(palabra)) {
      hayTitulo = true;
    } else if (!CONECTORES.has(palabra.toLowerCase())) {
      break;
    }
    desde -= 1;
  }
  // Sin ninguna palabra en Title Case no hay etiqueta reconocible: se reporta el resto tal cual
  // (algo raro pasó, y callarlo sería justo lo que no se vale).
  const etiqueta = hayTitulo ? palabras.slice(desde).join(' ') : palabras.join(' ');
  return etiqueta === '' ? null : etiqueta;
}

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

/**
 * Extrae un campo **con la red puesta**: corta por la siguiente etiqueta y, si aun así se coló el
 * texto de otra etiqueta conocida, RECORTA ahí y deja una advertencia con el nombre del campo.
 *
 * Recortar además de avisar es a propósito: la mitad limpia del valor casi siempre sirve, y así el
 * formulario nunca se llena con la etiqueta dentro. Lo que NO se vale es guardarlo callado.
 */
function leerCampo(texto: string, etiqueta: string, campo: string, advertencias: string[]): string {
  const valor = valorEntreEtiquetas(texto, etiqueta);
  const colada = etiquetaColada(valor);
  if (colada === null) {
    return valor;
  }
  advertencias.push(
    `El documento trae un formato que no se reconoce del todo: en "${campo}" se coló la etiqueta ` +
      `"${colada}". Revisa ese dato antes de aceptarlo.`,
  );
  const corte = valor.toLowerCase().indexOf(colada.toLowerCase());
  return aplanar(valor.slice(0, corte < 0 ? 0 : corte));
}

/**
 * Une con ', ' las partes que traen algo (una parte vacía no deja hueco ni coma suelta) y colapsa
 * las REPETICIONES seguidas: en las constancias reales la localidad y el municipio suelen traer el
 * mismo texto ("NAUCALPAN DE JUAREZ, NAUCALPAN DE JUAREZ"), y repetirlo en el domicilio se lee
 * como un error. No se inventa nada: sólo se deja de escribir dos veces lo mismo.
 */
function unir(partes: (string | undefined)[], separador = ', '): string {
  const utiles = partes.filter((p): p is string => p !== undefined && p.trim() !== '');
  return utiles
    .filter(
      (p, i) => i === 0 || normalizarComparacion(p) !== normalizarComparacion(utiles[i - 1] ?? ''),
    )
    .join(separador);
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

  const curp = leerCampo(texto, 'CURP', 'CURP', advertencias).toUpperCase();
  const tipoPersona: 'fisica' | 'moral' = curp === '' ? 'moral' : 'fisica';

  // El RFC aparece dos veces (cédula + datos de identificación) con el MISMO valor: la primera basta.
  const rfc = leerCampo(texto, 'RFC', 'RFC', advertencias).toUpperCase().replace(/\s+/g, '');
  if (rfc === '') {
    advertencias.push('No se encontró el RFC en el documento.');
  }

  let razonSocial: string;
  if (tipoPersona === 'moral') {
    razonSocial =
      leerCampo(texto, 'Denominaci[oó]n/Raz[oó]n Social', 'razón social', advertencias) ||
      leerCampo(texto, 'Denominaci[oó]n o Raz[oó]n Social', 'razón social', advertencias);
    if (razonSocial === '') {
      advertencias.push('No se encontró la denominación o razón social.');
    }
  } else {
    // Persona física: el SAT NO imprime una "razón social" — se COMPONE con nombre y apellidos.
    razonSocial = unir(
      [
        leerCampo(texto, 'Nombre \\(s\\)', 'nombre', advertencias),
        leerCampo(texto, 'Primer Apellido', 'primer apellido', advertencias),
        leerCampo(texto, 'Segundo Apellido', 'segundo apellido', advertencias),
      ],
      ' ',
    );
    if (razonSocial === '') {
      advertencias.push('No se encontró el nombre del contribuyente.');
    }
  }

  const codigoPostal = leerCampo(texto, 'C[oó]digo Postal', 'código postal', advertencias)
    .replace(/\D/g, '')
    .slice(0, 5);
  if (codigoPostal.length !== 5) {
    advertencias.push('No se encontró un código postal de 5 dígitos.');
  }

  // Domicilio: cada parte se corta en la siguiente etiqueta, así que las VACÍAS quedan vacías y no
  // arrastran el texto de la de al lado.
  const tipoVialidad = leerCampo(texto, 'Tipo de Vialidad', 'tipo de vialidad', advertencias);
  const nombreVialidad = leerCampo(texto, 'Nombre de Vialidad', 'calle', advertencias);
  const numeroExterior = leerCampo(texto, 'N[uú]mero Exterior', 'número exterior', advertencias);
  const numeroInterior = leerCampo(texto, 'N[uú]mero Interior', 'número interior', advertencias);
  const colonia = leerCampo(texto, 'Nombre de la Colonia', 'colonia', advertencias);
  const localidad = leerCampo(texto, 'Nombre de la Localidad', 'localidad', advertencias);
  // ⚠️ La forma LARGA es la que imprime el SAT hoy (verificado en dos constancias reales); la
  // corta se intenta después, por si alguna vez vuelve.
  const municipio =
    leerCampo(
      texto,
      'Nombre del Municipio o Demarcaci[oó]n Territorial',
      'municipio',
      advertencias,
    ) || leerCampo(texto, 'Municipio o Delegaci[oó]n', 'municipio', advertencias);
  const entidad = leerCampo(texto, 'Nombre de la Entidad Federativa', 'estado', advertencias);

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
