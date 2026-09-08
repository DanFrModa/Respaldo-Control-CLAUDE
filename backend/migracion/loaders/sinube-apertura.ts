/**
 * LECTOR + MAPEO del listado de cuentas por pagar de SINUBE (fila 0.131, §Post-F9.224).
 *
 * Daniel quiere apagar SINUBE. Para eso hay que meter al sistema los **saldos vivos de cada
 * proveedor** como movimientos de APERTURA. Él exporta de SINUBE un listado por proveedor (XLSX de
 * una hoja, encabezados en la fila 1, 53 columnas) y este módulo lo traduce a las entradas del
 * **modo migración del motor de cuenta corriente** que ya existe
 * (`src/dominio/terceros/migracion.ts`, F9-E6/D15c).
 *
 * ⚠️ **Aquí NO hay motor nuevo**: el signo lo pone `signoDeOrigen`, el vencimiento lo calcula
 * `calcularVencimiento`, los folios se reservan en bloque, la inserción va por lotes y la
 * idempotencia la lleva `MapeoMigracion` — todo eso ya estaba. Lo que este archivo aporta es el
 * LECTOR del Excel (con su trampa de fechas) y el MAPEO a esas entradas. La carga la hace
 * `cargarAperturas` de `loaders/terceros-saldos.ts`, sin tocarla.
 *
 * ## Las reglas de negocio, decididas por Daniel (§Post-F9.224)
 *
 * 1. **Sólo lo VIVO**: se cargan los renglones con `Saldo > 0`. Lo pagado, los complementos de pago
 *    (`Tipo fiscal = Pago`) y las notas de crédito ya aplicadas NO se cargan.
 * 2. **Se carga el `Saldo`, no el `Importe`**: en el archivo real hay facturas con abono parcial
 *    donde no coinciden; cargar el importe metería deuda que ya se pagó.
 * 3. **El vencimiento se CALCULA** (`fecha de la factura + Proveedor.diasCredito`), no se toma del
 *    archivo: *«esta fecha que trae no es necesariamente lo que está negociado; el trato son 90
 *    días»*. Medido en el archivo real: 97 de 98 facturas traen exactamente 90 días entre `Fecha` y
 *    `Pago probable`, y **una trae 92** — la desviación manual que calcular corrige.
 * 4. **El plazo corre desde la FECHA DE LA FACTURA**, no desde el recibo (aparcado para V2 por
 *    Daniel: *«por ahora cargamos con el mismo criterio que SINUBE»*). Es lo que el motor ya hace.
 * 5. ⚠️ **La columna «Recepción» del archivo NO es la fecha de recibo** (es idéntica a «Pago
 *    probable» en 97 de 98 renglones: está mal etiquetada). **No se usa para nada**, igual que
 *    `Pago probable`.
 *
 * ## Lo que ABORTA la corrida (y por qué aborta en vez de saltarse el renglón)
 *
 * Un renglón que no se puede representar bien **no se carga a medias ni se salta en silencio**: se
 * junta con todos sus hermanos y la corrida termina **sin escribir nada**, nombrando cada caso. Las
 * causas duras están en `PROBLEMAS_DUROS` (abajo) y la más importante es el **proveedor sin días de
 * crédito**: `Proveedor.diasCredito` es `Int?` y la semántica del motor dice que `null` y `0`
 * significan lo mismo (contado), así que cargar sin él **no fallaría** — produciría en silencio
 * facturas vencidas desde el día uno, con un error de hasta 90 días, justo en la pantalla con la que
 * Daniel decide a quién le paga. Por eso el ETL distingue lo que el motor no distingue: `null` =
 * **hueco** (aborta), `0` = **contado decidido** (válido, vence el mismo día).
 */
import { readFileSync } from 'node:fs';

import ExcelJS from 'exceljs';

import { normalizarRfc } from '../../src/dominio/terceros/cfdi/parser-cfdi.js';
import type { OrigenMovimientoTercero, PrismaClient } from '../../src/datos/index.js';

import { fechasIsoDeHoja, letraColumna } from '../comun/xlsx-fechas-iso.js';
import type { AperturaParseada } from './terceros-saldos.js';

// ── Los encabezados del listado (nombres EXACTOS del export de SINUBE) ─────────────────────────────

/** Las columnas del listado que el ETL usa. El resto de las 53 se ignora. */
const COL = {
  serie: 'Serie',
  folio: 'Folio',
  fecha: 'Fecha',
  razonSocial: 'Razón social proveedor',
  importe: 'Importe',
  saldo: 'Saldo',
  moneda: 'Moneda',
  estatusPago: 'Estatus pago',
  rfc: 'RFC proveedor',
  estatusSat: 'Estatus en SAT',
  tipoFiscal: 'Tipo fiscal',
  uuid: 'UUID',
} as const;

/** Columnas SIN las cuales el archivo no es el listado que esperamos (falta = aborta). */
const COLUMNAS_OBLIGATORIAS: string[] = [
  COL.fecha,
  COL.saldo,
  COL.rfc,
  COL.tipoFiscal,
  COL.uuid,
  COL.moneda,
];

/** Monedas que se aceptan como pesos mexicanos. `MovimientoTercero` NO tiene columna de moneda. */
const MONEDAS_PESOS = new Set(['MXN', 'MXP', 'MN', 'PESOS', 'PESO']);

/**
 * Los valores de `Estatus en SAT` que significan **CANCELADO**, exactos y en minúsculas sin acentos.
 *
 * 🔴 **Por qué una lista y no un `includes('cancel')`.** El SAT tiene estados que llevan la palabra
 * «cancel» y describen un comprobante **VIGENTE**: «Cancelable sin aceptación», «Cancelable con
 * aceptación», «No cancelable» — hablan de si SE PUEDE cancelar, no de que se haya cancelado. Con la
 * comparación por subcadena los tres se descartaban como cancelados: deuda REAL fuera de la carga, y
 * con una etiqueta que además mentía sobre el motivo.
 *
 * ⚠️ Y por eso cualquier otro valor con «cancel» que no esté aquí **ABORTA** en vez de suponer: es el
 * mismo criterio que ya se aplica a `Tipo fiscal` y a `Moneda`. No se puede comprobar contra el
 * archivo real —no está en el repositorio, y es correcto que no esté—, y ésa es justamente la razón
 * para no adivinar.
 */
const ESTATUS_SAT_CANCELADO = new Set([
  'cancelado',
  'cancelada',
  'cancelado sin aceptacion',
  'cancelada sin aceptacion',
  'cancelado con aceptacion',
  'cancelada con aceptacion',
]);

// ── Estructuras ────────────────────────────────────────────────────────────────────────────────────

/** Un renglón del listado, ya tipado (crudo: sin reglas de negocio aplicadas). */
export interface RenglonSinube {
  /** Número de fila en la hoja (la 1 es el encabezado, así que el primer dato es la 2). */
  fila: number;
  serie: string | null;
  folio: string | null;
  fecha: Date | null;
  razonSocial: string | null;
  importe: number | null;
  saldo: number | null;
  moneda: string | null;
  estatusPago: string | null;
  rfc: string | null;
  estatusSat: string | null;
  tipoFiscal: string | null;
  uuid: string | null;
  /**
   * El TEXTO tal cual de la celda `Saldo`, aunque no se haya podido leer como número. Distingue las
   * dos cosas que `saldo === null` confundía: la celda **de verdad vacía** (`saldoCrudo === null`,
   * documento saldado) y la celda **con algo ilegible** dentro (`saldoCrudo !== null`: `N/D`,
   * `1.234,56`, `(500)`…), que es un renglón del que NO se sabe cuánto se debe.
   */
  saldoCrudo: string | null;
}

/** Un renglón que NO se carga, con el motivo (siempre sale en el reporte de cuadre). */
export interface DescarteSinube {
  fila: number;
  motivo: string;
  detalle: string;
}

/** Un problema DURO: la corrida aborta sin escribir nada, nombrando todos los que haya. */
export interface ProblemaSinube {
  motivo: string;
  detalle: string;
}

/** Conteos y sumas de la clasificación (materia prima del reporte de cuadre). */
export interface ResumenSinube {
  /** Renglones con datos leídos de la hoja (sin contar el encabezado ni las filas vacías). */
  leidos: number;
  /** Cuántos hay de cada `Tipo fiscal` (tal como venga escrito en el archivo). */
  porTipoFiscal: Record<string, number>;
  /** Cuántos se cargan. */
  cargados: number;
  /** Cuántos se descartan, por motivo. */
  descartesPorMotivo: Record<string, number>;
  /** Σ de la columna `Saldo` de los renglones CARGADOS (la cifra que Daniel compara con su archivo). */
  sumaSaldoCargado: number;
  /** Σ de `Saldo` cargado, desglosada por `Tipo fiscal`. */
  sumaSaldoPorTipoFiscal: Record<string, number>;
  /** Efecto NETO sobre la cuenta (cargos − abonos): las notas de crédito restan. */
  netoCargado: number;
  /** Σ de `Saldo` de los renglones descartados, por motivo (para ver qué se quedó fuera). */
  sumaDescartadaPorMotivo: Record<string, number>;
}

/** Resultado de clasificar el listado. */
export interface ClasificacionSinube {
  aperturas: AperturaParseada[];
  descartes: DescarteSinube[];
  problemas: ProblemaSinube[];
  resumen: ResumenSinube;
  /** Avisos que NO bloquean pero que hay que mirar (p. ej. estatus de pago contradictorio). */
  avisos: ProblemaSinube[];
}

// ── Lectura del XLSX ───────────────────────────────────────────────────────────────────────────────

/** Texto de una celda de `exceljs`, ya recortado; `null` si está vacía. */
function texto(valor: ExcelJS.CellValue): string | null {
  if (valor === null || valor === undefined) return null;
  if (typeof valor === 'string') return valor.trim() === '' ? null : valor.trim();
  if (typeof valor === 'number' || typeof valor === 'boolean') return String(valor);
  if (valor instanceof Date) return valor.toISOString();
  const obj = valor as { text?: unknown; result?: unknown; richText?: { text: string }[] };
  if (Array.isArray(obj.richText)) {
    const t = obj.richText
      .map((r) => r.text)
      .join('')
      .trim();
    return t === '' ? null : t;
  }
  if (typeof obj.text === 'string') return obj.text.trim() === '' ? null : obj.text.trim();
  if (typeof obj.result === 'number') return String(obj.result);
  if (typeof obj.result === 'string') return obj.result.trim() === '' ? null : obj.result.trim();
  return null;
}

/**
 * Número de una celda. Acepta el número nativo de Excel y el formato **estadounidense** en texto
 * (`8,000.00`, `$ 1,250.50`, `-300`). Devuelve `null` para cualquier otra cosa.
 *
 * 🔴 **Por qué NO basta con quitar las comas.** Quitarlas a ciegas convierte `1.234,56` (coma decimal
 * europea) en `1.23456`: un número **finito y con pinta razonable** que entraba a la carga como si
 * nada. No era «un texto que no se pudo leer», era **una cifra equivocada leída con toda confianza**,
 * y en la columna `Saldo` eso es dinero. Aquí se exige que el formato sea inequívoco: si el separador
 * decimal es ambiguo, se devuelve `null` y el renglón acaba abortando por «Saldo ILEGIBLE» — nombrado,
 * no adivinado.
 */
function numero(valor: ExcelJS.CellValue): number | null {
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null;
  const t = texto(valor);
  if (t === null) return null;
  const limpio = t.replace(/[$\s]/g, '');
  if (limpio === '') return null;
  // Entero o decimal con punto, con comas SÓLO como separador de millares (grupos de 3 exactos).
  if (!/^-?\d{1,3}(,\d{3})*(\.\d+)?$/.test(limpio) && !/^-?\d+(\.\d+)?$/.test(limpio)) {
    return null;
  }
  const n = Number(limpio.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** Normaliza un encabezado para comparar (sin acentos, sin dobles espacios, minúsculas). */
function normalizarEncabezado(h: string): string {
  return h
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Error de lectura del archivo (formato inesperado). Aborta antes de tocar la base. */
export class ErrorListadoSinube extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'ErrorListadoSinube';
  }
}

/**
 * Lee el listado de SINUBE de un XLSX y devuelve sus renglones tipados.
 *
 * 🔴 **La trampa de las fechas, tapada aquí.** SINUBE escribe las fechas en celdas `t="d"` (ISO 8601
 * dentro del `<v>`); `exceljs` 4.4.0 **no implementa ese tipo** y devuelve **`1905-07-18` para
 * TODAS** — sin lanzar, sin avisar. Sin este parche las facturas entrarían fechadas en 1905 y la
 * pantalla de antigüedad diría ~44 mil días vencidos. Por eso se lee el libro con `exceljs` (que es
 * quien sabe de `sharedStrings`, estilos y hojas) y las fechas se **superponen** desde el XML crudo
 * con `fechasIsoDeHoja`, por dirección de celda. Detalle en `migracion/comun/xlsx-fechas-iso.ts`.
 */
export async function leerListadoSinube(buffer: Buffer): Promise<RenglonSinube[]> {
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load(buffer as unknown as ArrayBuffer);
  const hoja = libro.worksheets[0];
  if (hoja === undefined) {
    throw new ErrorListadoSinube('El archivo de SINUBE no tiene ninguna hoja.');
  }

  // Encabezados de la fila 1 → índice de columna (1-based), por nombre normalizado.
  const columnaPorNombre = new Map<string, number>();
  const filaCabecera = hoja.getRow(1);
  for (let c = 1; c <= hoja.columnCount; c += 1) {
    const h = texto(filaCabecera.getCell(c).value);
    if (h !== null) columnaPorNombre.set(normalizarEncabezado(h), c);
  }
  const faltantes = COLUMNAS_OBLIGATORIAS.filter(
    (h) => !columnaPorNombre.has(normalizarEncabezado(h)),
  );
  if (faltantes.length > 0) {
    throw new ErrorListadoSinube(
      `El archivo no tiene la forma del listado de SINUBE: faltan las columnas ${faltantes
        .map((f) => `"${f}"`)
        .join(', ')}. Encabezados encontrados: ${[...columnaPorNombre.keys()].join(' · ')}`,
    );
  }
  const indice = (nombre: string): number | null =>
    columnaPorNombre.get(normalizarEncabezado(nombre)) ?? null;

  // Las fechas REALES, por dirección de celda (el parche a `exceljs`).
  const fechasIso = fechasIsoDeHoja(buffer, 0);

  const cols = {
    serie: indice(COL.serie),
    folio: indice(COL.folio),
    fecha: indice(COL.fecha),
    razonSocial: indice(COL.razonSocial),
    importe: indice(COL.importe),
    saldo: indice(COL.saldo),
    moneda: indice(COL.moneda),
    estatusPago: indice(COL.estatusPago),
    rfc: indice(COL.rfc),
    estatusSat: indice(COL.estatusSat),
    tipoFiscal: indice(COL.tipoFiscal),
    uuid: indice(COL.uuid),
  };

  const leerTexto = (fila: ExcelJS.Row, col: number | null): string | null =>
    col === null ? null : texto(fila.getCell(col).value);
  const leerNumero = (fila: ExcelJS.Row, col: number | null): number | null =>
    col === null ? null : numero(fila.getCell(col).value);

  const renglones: RenglonSinube[] = [];
  for (let n = 2; n <= hoja.rowCount; n += 1) {
    const fila = hoja.getRow(n);
    const rfc = leerTexto(fila, cols.rfc);
    const uuid = leerTexto(fila, cols.uuid);
    const saldo = leerNumero(fila, cols.saldo);
    const tipoFiscal = leerTexto(fila, cols.tipoFiscal);
    const razonSocial = leerTexto(fila, cols.razonSocial);
    // Fila totalmente vacía (las que deja Excel al final): se salta sin contarla.
    if (
      rfc === null &&
      uuid === null &&
      saldo === null &&
      tipoFiscal === null &&
      razonSocial === null
    ) {
      continue;
    }
    // La fecha SIEMPRE sale del XML crudo cuando la celda es `t="d"`; si no lo es (export clásico
    // con número de serie), se toma la de `exceljs`, que para ESE formato sí acierta.
    //
    // ⚠️ Se decide con `has`, no con el valor: una celda `t="d"` que el XML no deja leer entra al
    // mapa con `null`, y ese `null` significa **«no hay fecha»**, no «pregúntale a exceljs». Caer al
    // valor de `exceljs` ahí sería volver a meter el 1905 por la puerta de atrás, y esta vez sin que
    // ninguna prueba lo estuviera mirando.
    const dirFecha = cols.fecha === null ? null : `${letraColumna(cols.fecha)}${String(n)}`;
    const esCeldaIso = dirFecha !== null && fechasIso.has(dirFecha);
    const fechaIso = dirFecha === null ? null : (fechasIso.get(dirFecha) ?? null);
    const fechaExcel = cols.fecha === null ? null : fila.getCell(cols.fecha).value;
    renglones.push({
      fila: n,
      serie: leerTexto(fila, cols.serie),
      folio: leerTexto(fila, cols.folio),
      fecha: esCeldaIso ? fechaIso : fechaExcel instanceof Date ? aMedianocheUtc(fechaExcel) : null,
      razonSocial,
      importe: leerNumero(fila, cols.importe),
      saldo,
      // El texto crudo viaja aparte para poder distinguir «celda vacía» de «celda ilegible».
      saldoCrudo: leerTexto(fila, cols.saldo),
      moneda: leerTexto(fila, cols.moneda),
      estatusPago: leerTexto(fila, cols.estatusPago),
      rfc,
      estatusSat: leerTexto(fila, cols.estatusSat),
      tipoFiscal,
      uuid,
    });
  }
  return renglones;
}

/** Lee el listado desde una ruta de disco. */
export async function leerArchivoSinube(ruta: string): Promise<RenglonSinube[]> {
  return leerListadoSinube(readFileSync(ruta));
}

/** Recorta una fecha a medianoche UTC (la columna destino es `@db.Date`). */
function aMedianocheUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
}

// ── Clasificación (reglas de negocio, PURA: sin base de datos) ─────────────────────────────────────

/** Motivos por los que un renglón se DESCARTA (no se carga, pero no aborta la corrida). */
export const MOTIVO_DESCARTE = {
  complementoPago: 'Complemento de pago (Tipo fiscal = Pago) — no es un saldo, no se carga',
  sinSaldo: 'Saldo = 0 (documento ya saldado) — sólo se carga lo vivo',
  saldoVacio: 'Celda de Saldo VACÍA (se lee como saldado) — sólo se carga lo vivo',
  canceladoSat: 'CFDI CANCELADO en el SAT — no crea deuda',
  sinTipoFiscal: 'Renglón sin Tipo fiscal y sin saldo — ruido del export',
} as const;

/** Normaliza un texto para comparar (sin acentos, minúsculas). */
function plano(t: string): string {
  return t
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

/** Redondeo monetario a 2 decimales (mismo criterio que el motor). */
function redondear2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Aplica las reglas de negocio a los renglones leídos: decide qué se carga, qué se descarta (con su
 * motivo) y qué ABORTA la corrida. Es PURA — no toca la base — para que las reglas se puedan medir
 * una por una. La verificación contra el catálogo de proveedores va aparte
 * (`verificarProveedoresApertura`), porque ésa sí necesita la base.
 */
export function clasificarSinube(renglones: RenglonSinube[]): ClasificacionSinube {
  const aperturas: AperturaParseada[] = [];
  const descartes: DescarteSinube[] = [];
  const problemas: ProblemaSinube[] = [];
  const avisos: ProblemaSinube[] = [];
  const porTipoFiscal: Record<string, number> = {};
  const descartesPorMotivo: Record<string, number> = {};
  const sumaDescartadaPorMotivo: Record<string, number> = {};
  const sumaSaldoPorTipoFiscal: Record<string, number> = {};
  const filasPorUuid = new Map<string, number[]>();
  let sumaSaldoCargado = 0;
  let netoCargado = 0;

  const descartar = (r: RenglonSinube, motivo: string, detalle: string): void => {
    descartes.push({ fila: r.fila, motivo, detalle });
    descartesPorMotivo[motivo] = (descartesPorMotivo[motivo] ?? 0) + 1;
    sumaDescartadaPorMotivo[motivo] = redondear2(
      (sumaDescartadaPorMotivo[motivo] ?? 0) + (r.saldo ?? 0),
    );
  };

  for (const r of renglones) {
    const ref = `fila ${String(r.fila)} ${r.serie ?? ''}${r.folio ?? '—'} · ${r.razonSocial ?? r.rfc ?? '—'}`;
    const tipo = r.tipoFiscal;
    if (tipo !== null) porTipoFiscal[tipo] = (porTipoFiscal[tipo] ?? 0) + 1;

    // (1) Sin `Tipo fiscal` no se puede clasificar. Con saldo vivo, ADIVINAR sería lo peligroso.
    if (tipo === null) {
      if (r.saldo !== null && r.saldo > 0) {
        problemas.push({
          motivo: 'Renglón CON saldo vivo pero SIN "Tipo fiscal" (no se puede clasificar)',
          detalle: `${ref} saldo=${r.saldo.toFixed(2)}`,
        });
      } else {
        descartar(r, MOTIVO_DESCARTE.sinTipoFiscal, ref);
      }
      continue;
    }

    const tipoPlano = plano(tipo);

    // (2) Los complementos de pago NO se cargan (regla 1 de Daniel): no son un saldo.
    if (tipoPlano === 'pago') {
      descartar(r, MOTIVO_DESCARTE.complementoPago, ref);
      continue;
    }

    // (3) Un `Tipo fiscal` que no sea Ingreso/Egreso/Pago no se inventa: aborta.
    if (tipoPlano !== 'ingreso' && tipoPlano !== 'egreso') {
      problemas.push({
        motivo: 'Tipo fiscal desconocido (se esperaba Ingreso, Egreso o Pago)',
        detalle: `${ref} tipo="${tipo}"`,
      });
      continue;
    }

    // (4) Sólo lo VIVO (regla 1). Ni el saldo NEGATIVO ni el ILEGIBLE se interpretan: abortan.
    if (r.saldo === null) {
      // Celda con algo dentro que no se pudo leer como número (`N/D`, `1.234,56`, `(500)`…): NO es
      // un documento saldado, es un renglón del que no se sabe cuánto se debe. Tratarlo como saldado
      // lo dejaba fuera de la carga y encima el cuadre decía que había dejado fuera 0.00 — el número
      // tranquilizador. Sólo la celda DE VERDAD vacía conserva el descarte.
      if (r.saldoCrudo !== null) {
        problemas.push({
          motivo: 'Saldo ILEGIBLE (hay algo en la celda, pero no es un número)',
          detalle: `${ref} saldo="${r.saldoCrudo}" — corrígelo en el origen y vuelve a correr`,
        });
        continue;
      }
      descartar(r, MOTIVO_DESCARTE.saldoVacio, ref);
      continue;
    }
    if (r.saldo === 0) {
      descartar(r, MOTIVO_DESCARTE.sinSaldo, ref);
      continue;
    }
    if (r.saldo < 0) {
      problemas.push({
        motivo:
          'Saldo NEGATIVO (el signo no se interpreta: podría ser un abono o un error del export)',
        detalle: `${ref} saldo=${r.saldo.toFixed(2)} tipo=${tipo}`,
      });
      continue;
    }

    // (5) Moneda: `MovimientoTercero` NO tiene columna de moneda, así que cargar algo que no sean
    //     pesos sería guardar un número en la unidad equivocada, en silencio.
    const moneda = r.moneda === null ? null : plano(r.moneda).toUpperCase();
    if (moneda === null || !MONEDAS_PESOS.has(moneda)) {
      problemas.push({
        motivo: 'Moneda distinta de pesos (o vacía): la cuenta corriente NO guarda moneda',
        detalle: `${ref} moneda="${r.moneda ?? '(vacía)'}" saldo=${r.saldo.toFixed(2)}`,
      });
      continue;
    }

    // (6) Un CFDI cancelado en el SAT no crea deuda. Se descarta CONTADO, nunca en silencio. Y un
    //     estado con «cancel» que NO esté en la lista no se interpreta: aborta (ver el porqué en
    //     `ESTATUS_SAT_CANCELADO`).
    if (r.estatusSat !== null) {
      const estatus = plano(r.estatusSat).replace(/\s+/g, ' ');
      if (ESTATUS_SAT_CANCELADO.has(estatus)) {
        descartar(r, MOTIVO_DESCARTE.canceladoSat, `${ref} estatusSat="${r.estatusSat}"`);
        continue;
      }
      if (estatus.includes('cancel')) {
        problemas.push({
          motivo: 'Estatus en SAT con «cancel» que NO se sabe si es un CFDI cancelado',
          detalle:
            `${ref} estatusSat="${r.estatusSat}" — «Cancelable…» y «No cancelable» son comprobantes ` +
            'VIGENTES; dime cuál es y se añade a la lista de cancelados',
        });
        continue;
      }
    }

    // (7) Sin fecha no hay antigüedad; sin RFC no hay proveedor; sin UUID no hay idempotencia.
    if (r.fecha === null) {
      problemas.push({
        motivo: 'Renglón vivo SIN fecha del documento (la antigüedad se calcula desde ella)',
        detalle: ref,
      });
      continue;
    }
    if (r.rfc === null) {
      problemas.push({
        motivo: 'Renglón vivo SIN RFC del proveedor (el proveedor se identifica por RFC)',
        detalle: `${ref} saldo=${r.saldo.toFixed(2)}`,
      });
      continue;
    }
    if (r.uuid === null) {
      problemas.push({
        motivo: 'Renglón vivo SIN UUID del CFDI (es la clave que hace la carga re-corrible)',
        detalle: `${ref} saldo=${r.saldo.toFixed(2)}`,
      });
      continue;
    }

    // El UUID se guarda en MAYÚSCULAS: es como lo sella el SAT en el timbre y como lo escribe el
    // importador de CFDI (F9-E3), de modo que el mismo comprobante NO se puede colar dos veces por
    // una diferencia de caja (la unique global de `uuidCfdi` sólo frena las cadenas idénticas).
    const uuid = r.uuid.toUpperCase();
    const filas = filasPorUuid.get(uuid) ?? [];
    filas.push(r.fila);
    filasPorUuid.set(uuid, filas);

    // (8) Aviso NO bloqueante: el estatus de pago contradice al saldo. Se carga el saldo (regla 2).
    if (r.estatusPago !== null && plano(r.estatusPago).startsWith('pagad')) {
      avisos.push({
        motivo: 'Estatus de pago dice PAGADA pero el Saldo es > 0 (se carga el Saldo)',
        detalle: `${ref} estatusPago="${r.estatusPago}" saldo=${r.saldo.toFixed(2)}`,
      });
    }

    const esNotaCredito = tipoPlano === 'egreso';
    const origen: OrigenMovimientoTercero = esNotaCredito ? 'nota_credito' : 'factura_proveedor';
    const importe = redondear2(r.saldo);
    const abonoParcial =
      r.importe !== null && Math.abs(redondear2(r.importe) - importe) > 0.005
        ? ` (importe original ${r.importe.toFixed(2)}; abonado ${(r.importe - importe).toFixed(2)})`
        : '';

    sumaSaldoCargado = redondear2(sumaSaldoCargado + importe);
    sumaSaldoPorTipoFiscal[tipo] = redondear2((sumaSaldoPorTipoFiscal[tipo] ?? 0) + importe);
    netoCargado = redondear2(netoCargado + (esNotaCredito ? -importe : importe));

    aperturas.push({
      tipoTercero: 'proveedor',
      rfc: r.rfc,
      nombre: r.razonSocial,
      // El listado es de UNA empresa; la elige el ETL (`--empresa`, o la favorita).
      empresaRef: null,
      // El listado de SINUBE NO declara un total por proveedor: el cuadre lo deriva sumando.
      saldoEsperado: null,
      movimiento: {
        origen,
        fecha: r.fecha,
        importe,
        esFiscal: true,
        uuidCfdi: uuid,
        rfcTercero: r.rfc,
        observaciones:
          `Apertura SINUBE · ${esNotaCredito ? 'nota de crédito' : 'factura'} ` +
          `${r.serie ?? ''}${r.folio ?? '—'} · saldo al corte${abonoParcial}`,
        refTipo: null,
        refId: null,
        claveFuente: `uuid:${uuid}`,
      },
    });
  }

  // (9) El mismo CFDI dos veces en el mismo archivo: no se escoge uno "a ojo" — aborta.
  for (const [uuid, filas] of filasPorUuid) {
    if (filas.length > 1) {
      problemas.push({
        motivo: 'UUID de CFDI REPETIDO dentro del mismo archivo',
        detalle: `uuid=${uuid} en las filas ${filas.join(', ')}`,
      });
    }
  }

  return {
    aperturas,
    descartes,
    problemas,
    avisos,
    resumen: {
      leidos: renglones.length,
      porTipoFiscal,
      cargados: aperturas.length,
      descartesPorMotivo,
      sumaSaldoCargado,
      sumaSaldoPorTipoFiscal,
      netoCargado,
      sumaDescartadaPorMotivo,
    },
  };
}

// ── La guarda contra la base: proveedor conocido y con días de crédito DECIDIDOS ───────────────────

/** Lo que se sabe de un proveedor del catálogo para esta carga. */
export interface ProveedorApertura {
  id: number;
  nombre: string;
  /** `null` = NADIE capturó el plazo (hueco). `0` = contado DECIDIDO. */
  diasCredito: number | null;
}

/** Error de la verificación previa: nombra TODOS los casos de golpe y aborta sin escribir nada. */
export class ErrorAperturaSinube extends Error {
  constructor(
    mensaje: string,
    readonly problemas: ProblemaSinube[],
  ) {
    super(mensaje);
    this.name = 'ErrorAperturaSinube';
  }
}

/** Índice de proveedores por RFC normalizado. `null` = ese RFC lo tienen VARIOS (ambiguo). */
export async function indiceProveedoresPorRfc(
  cliente: PrismaClient,
): Promise<Map<string, ProveedorApertura | null>> {
  const filas = await cliente.proveedor.findMany({
    select: { id: true, nombre: true, rfc: true, diasCredito: true },
  });
  const indice = new Map<string, ProveedorApertura | null>();
  for (const f of filas) {
    if (f.rfc === null || f.rfc.trim() === '') continue;
    const clave = normalizarRfc(f.rfc);
    indice.set(
      clave,
      indice.has(clave) ? null : { id: f.id, nombre: f.nombre, diasCredito: f.diasCredito },
    );
  }
  return indice;
}

/**
 * Verifica, ANTES de escribir nada, que cada RFC del listado exista en el catálogo y que su
 * proveedor tenga los días de crédito DECIDIDOS. Junta todos los fallos y lanza una sola vez con la
 * lista completa: así Daniel arregla el catálogo de una pasada, en vez de descubrir un proveedor por
 * corrida.
 *
 * 🔴 `diasCredito === null` **aborta**; `diasCredito === 0` es válido (contado explícito). El motor
 * trata los dos igual (`null o 0 = contado`, `Proveedor.diasCredito` es `Int?`), y por eso cargar sin
 * la guarda no daría ningún error: daría **facturas nacidas vencidas**, con hasta 90 días de
 * desviación, en la pantalla con la que se decide a quién pagar. La ambigüedad `null`/`0` sigue viva
 * en el resto del motor: esta fila NO la resuelve, sólo se niega a apoyarse en ella.
 */
export function verificarProveedoresApertura(
  aperturas: AperturaParseada[],
  indice: Map<string, ProveedorApertura | null>,
): Map<string, ProveedorApertura> {
  const problemas: ProblemaSinube[] = [];
  const resueltos = new Map<string, ProveedorApertura>();
  const desconocidos = new Map<string, string>();
  const ambiguos = new Map<string, string>();
  const sinPlazo = new Map<string, ProveedorApertura>();

  for (const a of aperturas) {
    if (a.rfc === null) continue; // ya lo cazó `clasificarSinube`
    const clave = normalizarRfc(a.rfc);
    if (
      resueltos.has(clave) ||
      desconocidos.has(clave) ||
      ambiguos.has(clave) ||
      sinPlazo.has(clave)
    ) {
      continue;
    }
    const prov = indice.get(clave);
    if (prov === undefined) {
      desconocidos.set(clave, a.nombre ?? '(sin razón social en el archivo)');
      continue;
    }
    if (prov === null) {
      ambiguos.set(clave, a.nombre ?? '(sin razón social en el archivo)');
      continue;
    }
    if (prov.diasCredito === null) {
      sinPlazo.set(clave, prov);
      continue;
    }
    resueltos.set(clave, prov);
  }

  for (const [rfc, nombre] of desconocidos) {
    problemas.push({
      motivo: 'RFC del archivo que NO existe en el catálogo de proveedores',
      detalle: `rfc=${rfc} · "${nombre}" — dalo de alta (con su RFC y sus días de crédito) y vuelve a correr`,
    });
  }
  for (const [rfc, nombre] of ambiguos) {
    problemas.push({
      motivo: 'RFC repetido en el catálogo de proveedores (no se sabe a cuál cargarle el saldo)',
      detalle: `rfc=${rfc} · "${nombre}" — deja un solo proveedor con ese RFC`,
    });
  }
  for (const [rfc, prov] of sinPlazo) {
    problemas.push({
      motivo: 'Proveedor SIN días de crédito capturados (sus facturas nacerían vencidas)',
      detalle:
        `rfc=${rfc} · #${String(prov.id)} "${prov.nombre}" — captura sus días de crédito ` +
        `(0 = contado, y es una respuesta válida) y vuelve a correr`,
    });
  }

  if (problemas.length > 0) {
    throw new ErrorAperturaSinube(
      `La carga de apertura NO se corrió: hay ${String(problemas.length)} problema(s) que hay que ` +
        'resolver antes. No se escribió nada en la base.',
      problemas,
    );
  }
  return resueltos;
}
