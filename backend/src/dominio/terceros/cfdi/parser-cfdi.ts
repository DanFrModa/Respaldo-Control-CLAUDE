/**
 * PARSER + VALIDADOR de CFDI 4.0 (F9-E3; R11; doc `Documentacion_MJD/PROPUESTA-Finanzas-y-Proveedores.md`
 * §2). Toma el XML ya SELLADO que manda el proveedor y extrae los datos que la conciliación de CxP
 * necesita: emisor, receptor, conceptos, impuestos (IVA trasladado + retenciones ISR/IVA), total,
 * UUID del Timbre Fiscal Digital, fecha y tipo de comprobante.
 *
 * Es una función PURA (A1): sin BD, sin permisos, sin efectos. El servicio de dominio la usa para
 * previsualizar/importar; los tests la ejercen con XML sintéticos.
 *
 * Regla de oro (R11): el XML es la VERDAD FISCAL. Si el XML está mal formado, no es 4.0, no trae
 * Timbre, o su tipo no es I (ingreso→cargo) / E (egreso→nota de crédito), se lanza `ErrorValidacion`
 * con un mensaje CLARO y NO se devuelve nada a medias — jamás un cargo parcial.
 *
 * Namespaces (`cfdi:`, `tfd:`): se eliminan con `removeNSPrefix` para leer los nodos sin el prefijo.
 * Los importes se dejan como TEXTO (`parseAttributeValue: false`) y se convierten a número aquí, para
 * que `Version="4.0"` no se degrade a `4` ni un RFC/UUID se malinterprete como número.
 */
import { XMLParser } from 'fast-xml-parser';

import { ErrorValidacion } from '../../../comun/errores.js';

/** Un renglón (concepto) del CFDI. */
export interface CfdiConcepto {
  descripcion: string;
  cantidad: number;
  valorUnitario: number;
  importe: number;
}

/** Tipo de comprobante soportado: I = ingreso (cargo), E = egreso (nota de crédito). */
export type TipoComprobanteCfdi = 'I' | 'E';

/** Datos extraídos y validados de un CFDI 4.0. */
export interface CfdiParseado {
  /** Versión del CFDI (siempre '4.0' si el parseo pasa). */
  version: string;
  /** I = ingreso (factura → cargo +) · E = egreso (nota de crédito → abono −). */
  tipoComprobante: TipoComprobanteCfdi;
  /** UUID (folio fiscal) del Timbre Fiscal Digital. Único global (base de la conciliación). */
  uuid: string;
  /** Fecha de emisión del comprobante (YYYY-MM-DD). */
  fecha: string;
  /** Fecha del timbrado (ISO) o null. */
  fechaTimbrado: string | null;
  /** Serie del comprobante (atributo `Serie`), o null. */
  serie: string | null;
  /** Folio del comprobante (atributo `Folio`), o null. Serie+Folio es el "número de factura". */
  folio: string | null;
  /** RFC del emisor (el proveedor). */
  emisorRfc: string;
  /** Razón social del emisor o null. */
  emisorNombre: string | null;
  /** RFC del receptor (debe ser la empresa activa; lo valida el servicio). */
  receptorRfc: string;
  /** Razón social del receptor o null. */
  receptorNombre: string | null;
  /** Moneda del comprobante (ej. MXN). */
  moneda: string;
  /** Subtotal (antes de impuestos). */
  subtotal: number;
  /** Total del comprobante (la verdad fiscal: el cargo entra por ESTE monto). */
  total: number;
  /** IVA trasladado total (impuesto 002). */
  ivaTrasladado: number;
  /** ISR retenido total (impuesto 001). */
  isrRetenido: number;
  /** IVA retenido total (impuesto 002 en retenciones). */
  ivaRetenido: number;
  /** Conceptos (renglones) del comprobante. */
  conceptos: CfdiConcepto[];
}

/** Claves de impuesto del SAT que nos interesan. */
const IMPUESTO_ISR = '001';
const IMPUESTO_IVA = '002';

/** Prefijo con el que fast-xml-parser expone los atributos XML. */
const PREFIJO_ATRIBUTO = '@_';

/**
 * Parser reutilizable (sin estado). `removeNSPrefix` limpia `cfdi:`/`tfd:`; `ignoreAttributes:false`
 * expone los atributos (`@_Nombre`); `parseAttributeValue:false` los deja como TEXTO (los números los
 * convertimos nosotros, con validación).
 */
const parserXml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: PREFIJO_ATRIBUTO,
  removeNSPrefix: true,
  parseAttributeValue: false,
  trimValues: true,
  ignoreDeclaration: true,
  // El XML llega de FUERA (lo manda el proveedor): NO expandir entidades. Evita ataques de expansión
  // de entidades (XXE / "billion laughs") vía DTD. Los CFDI reales no usan entidades personalizadas;
  // los campos fiscales (RFC/UUID/Total) nunca las llevan. (S1; se REFUERZA rechazando DOCTYPE abajo.)
  processEntities: false,
});

/** Un nodo XML ya parseado (mapa de atributos/hijos). */
type NodoXml = Record<string, unknown>;

/** Normaliza `undefined | objeto | arreglo` a un ARREGLO (fast-xml-parser colapsa el hijo único). */
function comoArray(valor: unknown): NodoXml[] {
  if (valor === undefined || valor === null) {
    return [];
  }
  return (Array.isArray(valor) ? valor : [valor]) as NodoXml[];
}

/** Lee un atributo de texto de un nodo (o null si no está / no es objeto). */
function atributo(nodo: unknown, nombre: string): string | null {
  if (nodo === null || typeof nodo !== 'object') {
    return null;
  }
  const valor = (nodo as NodoXml)[`${PREFIJO_ATRIBUTO}${nombre}`];
  // Los atributos XML (con parseAttributeValue:false) llegan como texto; un objeto no es un
  // atributo escalar (defensa por si el XML es raro) → se ignora.
  if (typeof valor !== 'string' && typeof valor !== 'number' && typeof valor !== 'boolean') {
    return null;
  }
  const texto = String(valor).trim();
  return texto === '' ? null : texto;
}

/** Lee un hijo (elemento anidado) de un nodo. */
function hijo(nodo: unknown, nombre: string): unknown {
  if (nodo === null || typeof nodo !== 'object') {
    return undefined;
  }
  return (nodo as NodoXml)[nombre];
}

/**
 * Convierte un atributo a número validando (R11: un importe ilegible es un CFDI corrupto, no un 0
 * silencioso). `obligatorio=false` permite null → devuelve `porDefecto`.
 */
function aNumero(
  valor: string | null,
  campo: string,
  obligatorio: boolean,
  porDefecto = 0,
): number {
  if (valor === null) {
    if (obligatorio) {
      throw new ErrorValidacion(`El CFDI no trae "${campo}" (dato obligatorio).`);
    }
    return porDefecto;
  }
  const n = Number(valor);
  if (!Number.isFinite(n)) {
    throw new ErrorValidacion(`El CFDI trae "${campo}" con un valor no numérico ("${valor}").`);
  }
  return n;
}

/** Suma los `Importe` de una lista de nodos de impuesto cuyo `Impuesto` coincide con `clave`. */
function sumarImpuesto(nodos: NodoXml[], clave: string): number {
  let suma = 0;
  for (const n of nodos) {
    if (atributo(n, 'Impuesto') === clave) {
      suma += aNumero(atributo(n, 'Importe'), 'Impuesto/Importe', false);
    }
  }
  return Math.round(suma * 100) / 100;
}

/**
 * Localiza el nodo `TimbreFiscalDigital` dentro de `Complemento` (que puede ser objeto o arreglo, y
 * contener otros complementos). Devuelve el nodo o null.
 */
function buscarTimbre(complemento: unknown): NodoXml | null {
  for (const c of comoArray(complemento)) {
    const timbre = hijo(c, 'TimbreFiscalDigital');
    if (timbre !== undefined && timbre !== null) {
      // Si hubiera varios timbres (no debería), toma el primero.
      const nodos = comoArray(timbre);
      return nodos[0] ?? null;
    }
  }
  return null;
}

/**
 * Parsea y VALIDA un CFDI 4.0. Lanza `ErrorValidacion` (mensaje claro) ante cualquier problema
 * estructural; nunca devuelve datos a medias.
 */
export function parsearCfdi(xml: string): CfdiParseado {
  if (typeof xml !== 'string' || xml.trim() === '') {
    throw new ErrorValidacion('El XML del CFDI está vacío.');
  }

  // S1: rechaza CUALQUIER declaración de tipo de documento. Un CFDI legítimo no lleva DTD; un DOCTYPE
  // en un XML de FUERA es una bandera roja de entidades externas/XXE. Es defensa en profundidad junto
  // a `processEntities:false` (aunque el parser no expanda, no toleramos siquiera la declaración).
  if (/<!DOCTYPE/i.test(xml)) {
    throw new ErrorValidacion(
      'El XML del CFDI declara un DOCTYPE (no permitido). Los comprobantes válidos no llevan DTD.',
    );
  }

  let arbol: NodoXml;
  try {
    arbol = parserXml.parse(xml) as NodoXml;
  } catch {
    throw new ErrorValidacion('El XML del CFDI está mal formado (no se pudo leer).');
  }

  const comprobante = hijo(arbol, 'Comprobante');
  if (comprobante === undefined || comprobante === null || typeof comprobante !== 'object') {
    throw new ErrorValidacion(
      'El XML no es un CFDI: no tiene el nodo raíz "Comprobante". ¿Subiste un archivo distinto?',
    );
  }

  // ── Versión: SOLO 4.0 ──────────────────────────────────────────────────────
  const version = atributo(comprobante, 'Version');
  if (version !== '4.0') {
    throw new ErrorValidacion(
      `El CFDI es versión ${version ?? '(sin versión)'}; CONTROL solo importa CFDI 4.0. ` +
        'Pídele al proveedor el comprobante en la versión vigente.',
    );
  }

  // ── Tipo de comprobante: I (ingreso→cargo) o E (egreso→nota de crédito) ─────
  const tipo = atributo(comprobante, 'TipoDeComprobante');
  if (tipo !== 'I' && tipo !== 'E') {
    throw new ErrorValidacion(
      `El CFDI es de tipo "${tipo ?? '(sin tipo)'}"; solo se importan Ingreso (I) y Egreso (E). ` +
        'Los comprobantes de Pago (P), Nómina (N) o Traslado (T) no generan cargo de CxP.',
    );
  }

  // ── Timbre Fiscal Digital + UUID ───────────────────────────────────────────
  const timbre = buscarTimbre(hijo(comprobante, 'Complemento'));
  if (timbre === null) {
    throw new ErrorValidacion(
      'El CFDI no está TIMBRADO (falta el Timbre Fiscal Digital). Solo se importan comprobantes ' +
        'sellados por el SAT.',
    );
  }
  const uuid = atributo(timbre, 'UUID');
  if (uuid === null) {
    throw new ErrorValidacion('El Timbre Fiscal Digital del CFDI no trae UUID (folio fiscal).');
  }

  // ── Emisor / Receptor ──────────────────────────────────────────────────────
  const emisor = hijo(comprobante, 'Emisor');
  const emisorRfc = atributo(emisor, 'Rfc');
  if (emisorRfc === null) {
    throw new ErrorValidacion('El CFDI no trae el RFC del emisor.');
  }
  const receptor = hijo(comprobante, 'Receptor');
  const receptorRfc = atributo(receptor, 'Rfc');
  if (receptorRfc === null) {
    throw new ErrorValidacion('El CFDI no trae el RFC del receptor.');
  }

  // ── Montos del encabezado ──────────────────────────────────────────────────
  const total = aNumero(atributo(comprobante, 'Total'), 'Total', true);
  if (total <= 0) {
    throw new ErrorValidacion('El CFDI trae un Total menor o igual a cero.');
  }
  const subtotal = aNumero(atributo(comprobante, 'SubTotal'), 'SubTotal', false);
  const moneda = atributo(comprobante, 'Moneda') ?? 'MXN';
  const fechaRaw = atributo(comprobante, 'Fecha');
  if (fechaRaw === null) {
    throw new ErrorValidacion('El CFDI no trae la fecha de emisión.');
  }
  const fecha = fechaRaw.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    throw new ErrorValidacion(`El CFDI trae una fecha con formato inesperado ("${fechaRaw}").`);
  }

  // ── Impuestos globales (IVA trasladado + retenciones ISR/IVA) ───────────────
  const impuestos = hijo(comprobante, 'Impuestos');
  const trasladados = comoArray(hijo(hijo(impuestos, 'Traslados'), 'Traslado'));
  const retenciones = comoArray(hijo(hijo(impuestos, 'Retenciones'), 'Retencion'));
  const ivaTrasladado = sumarImpuesto(trasladados, IMPUESTO_IVA);
  const isrRetenido = sumarImpuesto(retenciones, IMPUESTO_ISR);
  const ivaRetenido = sumarImpuesto(retenciones, IMPUESTO_IVA);

  // ── Conceptos ──────────────────────────────────────────────────────────────
  const conceptosNodo = comoArray(hijo(hijo(comprobante, 'Conceptos'), 'Concepto'));
  const conceptos: CfdiConcepto[] = conceptosNodo.map((c) => ({
    descripcion: atributo(c, 'Descripcion') ?? '',
    cantidad: aNumero(atributo(c, 'Cantidad'), 'Concepto/Cantidad', false),
    valorUnitario: aNumero(atributo(c, 'ValorUnitario'), 'Concepto/ValorUnitario', false),
    importe: aNumero(atributo(c, 'Importe'), 'Concepto/Importe', false),
  }));

  return {
    version,
    tipoComprobante: tipo,
    uuid,
    fecha,
    fechaTimbrado: atributo(timbre, 'FechaTimbrado'),
    serie: atributo(comprobante, 'Serie'),
    folio: atributo(comprobante, 'Folio'),
    emisorRfc,
    emisorNombre: atributo(emisor, 'Nombre'),
    receptorRfc,
    receptorNombre: atributo(receptor, 'Nombre'),
    moneda,
    subtotal,
    total,
    ivaTrasladado,
    isrRetenido,
    ivaRetenido,
    conceptos,
  };
}

/**
 * ORIGEN de CxP según el tipo de comprobante: I (ingreso) → `factura_proveedor` (cargo +); E (egreso)
 * → `nota_credito` (abono −). El signo lo aplica el motor por el origen (`signoDeOrigen`).
 */
export function origenDeTipoComprobante(
  tipo: TipoComprobanteCfdi,
): 'factura_proveedor' | 'nota_credito' {
  return tipo === 'I' ? 'factura_proveedor' : 'nota_credito';
}

/**
 * Normaliza un RFC para comparar (mayúsculas, sin espacios). El SAT no distingue mayúsculas ni admite
 * espacios internos; comparar normalizado evita falsos "receptor ajeno".
 */
export function normalizarRfc(rfc: string): string {
  return rfc.toUpperCase().replace(/\s+/g, '').trim();
}
