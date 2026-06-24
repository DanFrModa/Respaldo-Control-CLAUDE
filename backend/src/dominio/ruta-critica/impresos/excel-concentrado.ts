/**
 * Export a EXCEL del CONCENTRADO "planeado vs real" de la Ruta Crítica (F5-E7; decisión (h) de Daniel
 * = SÍ exportar a Excel con `exceljs`). MISMO resultado que el tablero: reusa `consultarConcentrado`
 * (A1: la lógica de negocio NO se duplica) y vuelca sus filas a un `.xlsx`. Genera un BUFFER en el
 * servidor (mismo patrón que los impresos PDF, p. ej. `impreso-plan-rc.ts`): la ruta solo valida
 * permiso + Zod, llama aquí y responde el binario con sus headers.
 *
 * El export trae TODAS las órdenes del filtro (no solo una página): se pagina internamente con el
 * tope del backend (100) y se concatenan los lotes, para no romper el límite ni cargar todo de golpe.
 * Una fila por ORDEN con su encabezado + semáforo + máximo atraso, y una columna RESUMEN por proceso
 * ("nombre: plan→real [estado]") — el detalle por proceso del viejo cabe en una celda legible sin
 * pivotear a N columnas variables (el set de procesos difiere por orden).
 */
import ExcelJS from 'exceljs';

import type { ConcentradoFila, ConcentradoProceso } from '../../../contrato/index.js';
import type { SesionUsuario } from '../../../comun/permisos.js';
import type { ContextoBd } from '../../../comun/transaccion.js';

import { consultarConcentrado, type ParametrosConcentrado } from '../concentrado.js';
import type { EstadoSemaforo } from '../semaforoYRiesgo.js';

/** Etiqueta legible del semáforo (para el Excel). */
const ETIQUETA_SEMAFORO: Record<EstadoSemaforo, string> = {
  aTiempo: 'A tiempo',
  enRiesgo: 'En riesgo',
  atrasado: 'Atrasado',
};

/** Color de relleno (ARGB) del semáforo de la fila (rojo / ámbar / verde claros). */
const RELLENO_SEMAFORO: Record<EstadoSemaforo, string> = {
  atrasado: 'FFFEE2E2',
  enRiesgo: 'FFFEF3C7',
  aTiempo: 'FFDCFCE7',
};

const TEAL = 'FF0D9488';

/** `YYYY-MM-DD` a partir de un datetime ISO (o '—' si null). Solo el día calendario. */
function fechaCorta(iso: string | null): string {
  return iso === null ? '—' : iso.slice(0, 10);
}

/** Etiqueta legible del estado de un proceso. */
const ETIQUETA_ESTADO: Record<ConcentradoProceso['estado'], string> = {
  pendiente: 'Pendiente',
  activo: 'Activo',
  completado: 'Completado',
};

/** Resume los procesos de una orden en una celda: "Proceso: plan→real [estado]" por renglón. */
function resumenProcesos(procesos: ConcentradoProceso[]): string {
  return procesos
    .map((p) => {
      const plan = fechaCorta(p.fechaPlaneadaVigente);
      const real = fechaCorta(p.fechaReal);
      const atraso = p.diasAtraso > 0 ? ` (+${p.diasAtraso}d)` : '';
      return `${p.nombreProceso}: ${plan}→${real} [${ETIQUETA_ESTADO[p.estado]}]${atraso}`;
    })
    .join('\n');
}

/** Dependencias inyectables (los tests inyectan un `consultarConcentrado` fake para no tocar BD). */
export interface DepsExcelConcentrado {
  consultarConcentrado?: typeof consultarConcentrado;
}

/** Trae TODAS las filas del filtro paginando internamente con el tope del backend (100). */
async function todasLasFilas(
  sesion: SesionUsuario,
  parametros: ParametrosConcentrado,
  bd: ContextoBd | undefined,
  ahora: Date | undefined,
  consultar: typeof consultarConcentrado,
): Promise<ConcentradoFila[]> {
  const TOPE = 100;
  const filas: ConcentradoFila[] = [];
  let pagina = 1;
  for (;;) {
    const resultado = await consultar(
      sesion,
      { ...parametros, pagina, porPagina: TOPE },
      bd,
      ahora,
    );
    filas.push(...resultado.datos);
    if (pagina >= resultado.totalPaginas) break;
    pagina += 1;
  }
  return filas;
}

/** Resultado del export: el buffer del `.xlsx` listo para responder. */
export interface ExcelConcentrado {
  buffer: Buffer;
}

/**
 * Genera el `.xlsx` del concentrado (A9: scope por la empresa activa, ya lo impone
 * `consultarConcentrado`). MISMO resultado que el tablero; trae todas las órdenes del filtro.
 */
export async function excelConcentrado(
  sesion: SesionUsuario,
  parametros: ParametrosConcentrado = {},
  bd?: ContextoBd,
  ahora?: Date,
  deps: DepsExcelConcentrado = {},
): Promise<ExcelConcentrado> {
  const consultar = deps.consultarConcentrado ?? consultarConcentrado;
  const filas = await todasLasFilas(sesion, parametros, bd, ahora, consultar);

  const libro = new ExcelJS.Workbook();
  libro.creator = 'CONTROL v2';
  libro.created = ahora ?? new Date();
  const hoja = libro.addWorksheet('Concentrado RC', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  hoja.columns = [
    { header: 'Orden', key: 'folio', width: 10 },
    { header: 'Cliente', key: 'cliente', width: 28 },
    { header: 'Modelo', key: 'modelo', width: 22 },
    { header: 'Entrega RC', key: 'entrega', width: 12 },
    { header: 'Inicio RC', key: 'inicio', width: 12 },
    { header: 'Resurtido', key: 'resurtido', width: 10 },
    { header: 'Semáforo', key: 'semaforo', width: 12 },
    { header: 'Atraso (días)', key: 'atraso', width: 13 },
    { header: 'Pendientes', key: 'pendientes', width: 11 },
    { header: 'Procesos (plan→real)', key: 'procesos', width: 70 },
  ];

  // Encabezado teal en negrita, texto blanco.
  const encabezado = hoja.getRow(1);
  encabezado.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  encabezado.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TEAL } };
  encabezado.alignment = { vertical: 'middle' };

  for (const fila of filas) {
    const modelo =
      fila.descripcionModelo !== null && fila.descripcionModelo !== ''
        ? `${fila.codigoModelo} — ${fila.descripcionModelo}`
        : fila.codigoModelo;
    const renglon = hoja.addRow({
      folio: fila.folioOrden,
      cliente: fila.cliente,
      modelo,
      entrega: fechaCorta(fila.fechaEntregaRC),
      inicio: fechaCorta(fila.fechaInicioRC),
      resurtido: fila.esResurtido ? 'Sí' : 'No',
      semaforo: ETIQUETA_SEMAFORO[fila.semaforo],
      atraso: fila.maxDiasAtraso,
      pendientes: fila.procesosPendientes,
      procesos: resumenProcesos(fila.procesos),
    });
    renglon.getCell('procesos').alignment = { wrapText: true, vertical: 'top' };
    renglon.getCell('semaforo').fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: RELLENO_SEMAFORO[fila.semaforo] },
    };
  }

  // `exceljs` devuelve un ArrayBuffer-like; lo normalizamos a Buffer de Node.
  const datos = await libro.xlsx.writeBuffer();
  return { buffer: Buffer.from(datos) };
}
