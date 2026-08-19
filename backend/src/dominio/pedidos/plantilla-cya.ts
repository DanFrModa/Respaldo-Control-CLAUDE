/**
 * CONFIGURACIÓN DE FÁBRICA de la plantilla de importación de C&A (formato `pdf-cya`).
 *
 * Vive en su propio módulo —y no dentro de `importacion-pdf.ts`— porque además del importador la
 * necesita el SEED (`prisma/seed.ts`), y arrastrar el importador entero (parser de PDF, R2, salida a
 * producción) al arranque del contenedor sería caro y frágil. Aquí no hay dependencias: son datos y
 * una función pura.
 *
 * ⭐ §Post-F9.70 punto 2 — POR QUÉ ESTO EXISTE. El 7% de sobre-pedido por packs es una decisión de
 * Daniel (§Post-F9.2: C&A acepta hasta +5% y él fabrica ese 5% + 2% de merma), pero el sistema
 * nacía SIN ninguna `PlantillaImportacion`, así que `leerConfigPlantillaPdf` caía al default
 * `porcentajeAdicional: 0` y **las OPs nacían con las cantidades exactas del cliente en vez de las
 * que se fabrican**. La regla existía en el papel y no operaba en la máquina.
 */
import type { CampoVariableImportacion } from '../../contrato/index.js';

/**
 * Campos variables por DEFECTO de una OC de C&A (Daniel: capturables como referencia del cliente).
 * Se usan cuando la plantilla del cliente aún no define los suyos; al guardar el formato pdf-cya se
 * SIEMBRAN éstos para que queden editables (más variables sin migración).
 *
 * ORDEN IMPORTANTE (precisión de Daniel): la referencia PRINCIPAL del cliente es el NÚMERO DE ORDEN
 * de su OC (p. ej. 620884), NO el Modelo ID. El Centro de comando y el detalle muestran como "Pedido
 * cliente" la PRIMERA referencia de la orden (`referencias[0]`, ordenadas por id de creación), así
 * que el número de orden va PRIMERO. El resto (Modelo ID, División, Sub División, Código único,
 * Semana C&A, Descripción) quedan como referencias/campos ADICIONALES (información). El número de
 * orden va ADEMÁS en `Orden.ocCliente` (snapshot que alimenta la cadena de trazabilidad "OC
 * cliente").
 */
export const CAMPOS_VARIABLES_DEFAULT_CYA: CampoVariableImportacion[] = [
  { campo: 'numeroOrden', etiqueta: 'Pedido cliente' },
  { campo: 'modeloCliente', etiqueta: 'Modelo ID' },
  { campo: 'division', etiqueta: 'División' },
  { campo: 'subDivision', etiqueta: 'Sub División' },
  { campo: 'descripcionArticulo', etiqueta: 'Descripción C&A' },
  { campo: 'codigoUnico', etiqueta: 'Código único' },
  { campo: 'semanaCliente', etiqueta: 'Semana C&A' },
];

/**
 * % ADICIONAL de producción de C&A (§Post-F9.2, decisión de Daniel): +5% que el cliente acepta
 * recibir de más, +2% de merma ⇒ **7%**. Es el valor de arranque de la plantilla sembrada; queda
 * EDITABLE desde la pantalla del importador (guardar ahí crea una versión nueva y ésta deja de ser
 * la vigente).
 */
export const PORCENTAJE_ADICIONAL_CYA = 7;

/** Nombre de cliente reducido a letras y dígitos, sin acentos ni signos: "C & A." → "ca". */
function normalizarNombreCliente(nombre: string): string {
  return nombre
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Grafías con las que C&A puede estar dado de alta en el catálogo (el cliente lo trae el ETL de
 * Access, no el seed, así que el nombre exacto no está bajo nuestro control). Se comparan
 * NORMALIZADAS: "C&A", "C & A", "C. y A.", "CYA México" caen todas aquí.
 *
 * Es una lista CERRADA a propósito: un `contains` cazaría "Calzado", "Cadena" y media docena de
 * clientes que no son. Si mañana C&A aparece con otra grafía, se agrega aquí — que es exactamente
 * el lugar donde alguien va a buscarlo.
 */
const NOMBRES_CYA = new Set(['ca', 'cya', 'camexico', 'cyamexico']);

/** ¿Este nombre de cliente es C&A? (comparación normalizada contra {@link NOMBRES_CYA}). */
export function esNombreDeCya(nombre: string): boolean {
  return NOMBRES_CYA.has(normalizarNombreCliente(nombre));
}
