/**
 * Impreso "PLAN DE LA RC POR ORDEN" (F5-E5, R9; doc `08-Ruta-Critica.md`; decisión (g) de Daniel): la
 * hoja (PDF) que documenta el plan de la Ruta Crítica de UNA orden — encabezado de la orden + tabla de
 * procesos (en orden de secuencia) con fecha planeada vigente, duración, responsables (roles), estado
 * y fecha real.
 *
 * Documento generado EN EL SERVIDOR con `@react-pdf/renderer` (`renderToBuffer`), MISMO motor y patrón
 * que `impreso-entrega-cliente.ts` / `impreso-recibo-maquila.ts` (A1: la ruta solo valida permiso+Zod
 * y delega). REUSA `obtenerRutaOrden` (encabezado de RC + procesos ya con duración/fechas/semáforo
 * DERIVADOS por el dominio) — A9: filtra por la empresa activa → 404 si la orden no es de la empresa.
 * Si la orden NO tiene RC generada, lanza `ErrorValidacion` (la ruta lo mapea a 400) — no truena.
 *
 * Datos que el dominio NO trae y aquí se resuelven (sin N+1):
 *  • encabezado de la orden (folio, cliente, modelo): una sola query.
 *  • responsables por proceso (nombres de rol de `ProcesoDefRol`): una sola query para TODOS los
 *    procesos de la ruta, agrupada en memoria (mismo criterio "sin N+1" que `capturadoPorNombre`).
 */
import { createElement as h, type ReactElement } from 'react';

import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
  type DocumentProps,
} from '@react-pdf/renderer';

import { renderizarPdfEnWorker } from '../../../comun/pdf-worker.js';

import { ErrorNoEncontrado, ErrorValidacion } from '../../../comun/errores.js';
import type { SesionUsuario } from '../../../comun/permisos.js';
import { clienteLectura, type ContextoBd } from '../../../comun/transaccion.js';
import type { EstadoSemaforo } from '../semaforoYRiesgo.js';
import { obtenerRutaOrden, type RutaOrdenDto } from '../rutaOrden.js';

// ── Datos resueltos del impreso (forma PURA: ya sin BD) ──────────────────────────────────────────

/** Estado de avance de un proceso (etiqueta legible). */
type EstadoProceso = 'pendiente' | 'activo' | 'completado';

/** Un renglón (proceso) del plan, ya proyectado para el PDF. */
export interface RenglonPlanRc {
  secuencia: number;
  nombreProceso: string;
  critico: boolean;
  /** Fecha planeada vigente (YYYY-MM-DD) o null si el CPM aún no la calculó. */
  fechaPlaneada: string | null;
  duracionDias: number;
  /** Nombres de los roles responsables del proceso (vacío si ninguno). */
  responsables: string[];
  estado: EstadoProceso;
  /** Fecha real de cumplimiento (YYYY-MM-DD) o null si no se ha cumplido. */
  fechaReal: string | null;
}

/** Todo lo que necesita el plan de la RC, ya resuelto (sin BD) → función pura. */
export interface DatosImpresoPlanRc {
  empresa: string;
  idOrden: number;
  folioOrden: number;
  cliente: string;
  modelo: string;
  /** Fecha de entrega de la RC (YYYY-MM-DD) o null. */
  fechaEntregaRC: string | null;
  /** Fecha de inicio de la RC (YYYY-MM-DD) o null. */
  fechaInicioRC: string | null;
  /** Semáforo de cumplimiento de la orden (el peor de sus procesos). */
  semaforo: EstadoSemaforo;
  esResurtido: boolean;
  procesos: RenglonPlanRc[];
}

/** `YYYY-MM-DD` (UTC) a partir de un `Date` (o null). Solo el día calendario importa en el plan. */
function aFechaCorta(fecha: Date | null): string | null {
  return fecha === null ? null : fecha.toISOString().slice(0, 10);
}

/** Dependencias inyectables (los tests inyectan un `obtenerRutaOrden` fake para no tocar BD). */
export interface DepsImpresoPlanRc {
  obtenerRutaOrden?: typeof obtenerRutaOrden;
}

/**
 * Resuelve los datos del plan de la RC de una orden (A9). Reusa `obtenerRutaOrden` (procesos con
 * duración/fechas/semáforo ya derivados) y enriquece con el encabezado de la orden y los responsables
 * por proceso (una sola query cada uno, sin N+1). Lanza `ErrorValidacion` si la orden no tiene RC.
 */
export async function armarDatosImpresoPlanRc(
  sesion: SesionUsuario,
  idOrden: number,
  bd?: ContextoBd,
  deps: DepsImpresoPlanRc = {},
): Promise<DatosImpresoPlanRc> {
  const obtener = deps.obtenerRutaOrden ?? obtenerRutaOrden;
  const ruta = await obtener(sesion, idOrden, bd);

  // Sin ruta generada (orden nunca programada): 400 claro, no un PDF vacío.
  if (ruta.procesos.length === 0) {
    throw new ErrorValidacion(
      'La orden no tiene una Ruta Crítica generada; prográmala antes de imprimir su plan.',
    );
  }

  const cliente = clienteLectura(bd);

  // Encabezado de la orden (folio + nombres de cliente/modelo), SCOPEADO por la empresa activa (A9):
  // una orden de otra empresa "no existe" → 404. (`obtenerRutaOrden` no filtra por empresa, así que el
  // scope se IMPONE aquí, en el impreso, para no filtrar el plan de otra empresa.)
  const orden = await cliente.orden.findFirst({
    where: { id: idOrden, idEmpresa: sesion.idEmpresaActiva },
    select: {
      folio: true,
      cliente: { select: { nombre: true } },
      modelo: { select: { codigo: true, descripcion: true } },
    },
  });
  if (orden === null) {
    throw new ErrorNoEncontrado('Orden', idOrden);
  }

  // Responsables por proceso: una sola query con TODOS los idProcesoDef de la ruta (sin N+1). Se
  // agrupa en memoria a `idProcesoDef -> [nombres de rol]`.
  const idsProceso = [...new Set(ruta.procesos.map((p) => p.idProcesoDef))];
  const puentes = await cliente.procesoDefRol.findMany({
    where: { idProcesoDef: { in: idsProceso } },
    select: { idProcesoDef: true, rol: { select: { nombre: true } } },
    orderBy: { rol: { nombre: 'asc' } },
  });
  const responsablesPorProceso = new Map<number, string[]>();
  for (const puente of puentes) {
    const lista = responsablesPorProceso.get(puente.idProcesoDef) ?? [];
    lista.push(puente.rol.nombre);
    responsablesPorProceso.set(puente.idProcesoDef, lista);
  }

  const modeloNombre =
    orden.modelo.descripcion !== null && orden.modelo.descripcion !== ''
      ? `${orden.modelo.codigo} — ${orden.modelo.descripcion}`
      : orden.modelo.codigo;

  return {
    empresa: sesion.nombreEmpresaActiva,
    idOrden: ruta.idOrden,
    folioOrden: Number(orden.folio),
    cliente: orden.cliente.nombre,
    modelo: modeloNombre,
    fechaEntregaRC: aFechaCorta(ruta.fechaEntregaRC),
    fechaInicioRC: aFechaCorta(ruta.fechaInicioRC),
    semaforo: ruta.semaforo,
    esResurtido: ruta.esResurtido,
    procesos: ruta.procesos.map((p) => proyectarProceso(p, responsablesPorProceso)),
  };
}

/** Proyecta un proceso del DTO de dominio al renglón del plan (con sus responsables). */
function proyectarProceso(
  p: RutaOrdenDto['procesos'][number],
  responsablesPorProceso: ReadonlyMap<number, string[]>,
): RenglonPlanRc {
  return {
    secuencia: p.secuencia,
    nombreProceso: p.nombreProceso,
    critico: p.critico,
    fechaPlaneada: aFechaCorta(p.fechaPlaneadaVigente),
    duracionDias: p.duracionDias,
    responsables: responsablesPorProceso.get(p.idProcesoDef) ?? [],
    estado: p.estado,
    fechaReal: aFechaCorta(p.fechaReal),
  };
}

// ── Etiquetas legibles ───────────────────────────────────────────────────────────────────────────

const ETIQUETA_SEMAFORO: Record<EstadoSemaforo, string> = {
  aTiempo: 'A tiempo',
  enRiesgo: 'En riesgo',
  atrasado: 'Atrasado',
};

const ETIQUETA_ESTADO: Record<EstadoProceso, string> = {
  pendiente: 'Pendiente',
  activo: 'Activo',
  completado: 'Completado',
};

// ── Documento PDF (react-pdf, sin JSX) ──────────────────────────────────────────────────────────

const TEAL = '#0d9488';
const GRIS = '#64748b';
const GRIS_BORDE = '#e2e8f0';
const TINTA = '#0f172a';
const AMBAR = '#b45309';
const ROJO = '#b91c1c';
const VERDE = '#15803d';

/** Color del texto del semáforo (mismo criterio que la UI: rojo/ámbar/verde). */
function colorSemaforo(estado: EstadoSemaforo): string {
  if (estado === 'atrasado') return ROJO;
  if (estado === 'enRiesgo') return AMBAR;
  return VERDE;
}

const estilos = StyleSheet.create({
  pagina: {
    paddingVertical: 32,
    paddingHorizontal: 40,
    fontFamily: 'Helvetica',
    fontSize: 9,
    color: TINTA,
  },
  encabezado: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    borderBottomWidth: 1,
    borderBottomColor: TEAL,
    paddingBottom: 8,
    marginBottom: 12,
  },
  empresa: { fontSize: 13, fontFamily: 'Helvetica-Bold', color: TEAL },
  subtitulo: { fontSize: 8, color: GRIS, marginTop: 2 },
  folioBloque: { alignItems: 'flex-end' },
  folioEtiqueta: { fontSize: 8, color: GRIS, textTransform: 'uppercase' },
  folioValor: { fontSize: 16, fontFamily: 'Helvetica-Bold' },
  semaforoChip: { fontSize: 9, fontFamily: 'Helvetica-Bold', marginTop: 4 },
  filaCampos: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 },
  campo: { width: '33%', marginBottom: 6, paddingRight: 8 },
  etiquetaCampo: { fontSize: 7, color: GRIS, textTransform: 'uppercase' },
  valorCampo: { fontSize: 10, fontFamily: 'Helvetica-Bold' },
  seccion: { marginTop: 10 },
  tituloSeccion: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    color: TEAL,
    textTransform: 'uppercase',
    marginBottom: 4,
    borderBottomWidth: 0.5,
    borderBottomColor: GRIS_BORDE,
    paddingBottom: 2,
  },
  filaTabla: { flexDirection: 'row' },
  celda: {
    borderWidth: 0.5,
    borderColor: GRIS_BORDE,
    paddingVertical: 3,
    paddingHorizontal: 4,
    fontSize: 8,
  },
  celdaEncabezado: { backgroundColor: '#f1f5f9', fontFamily: 'Helvetica-Bold' },
  celdaNum: { width: 24, textAlign: 'center' },
  celdaProceso: { flexGrow: 1, flexBasis: 0, textAlign: 'left' },
  celdaFecha: { width: 60, textAlign: 'center' },
  celdaDuracion: { width: 40, textAlign: 'center' },
  celdaResponsables: { width: 110, textAlign: 'left' },
  celdaEstado: { width: 58, textAlign: 'center' },
  textoCritico: { color: ROJO, fontFamily: 'Helvetica-Bold' },
  vacio: { fontSize: 8, color: GRIS },
  pie: {
    position: 'absolute',
    bottom: 20,
    left: 40,
    right: 40,
    fontSize: 7,
    color: '#94a3b8',
    textAlign: 'center',
  },
});

/** Un campo etiqueta/valor del encabezado. */
function campo(etiqueta: string, valor: string | null): ReactElement {
  return h(
    View,
    { style: estilos.campo, key: etiqueta },
    h(Text, { style: estilos.etiquetaCampo }, etiqueta),
    h(Text, { style: estilos.valorCampo }, valor ?? '—'),
  );
}

/** Tabla de PROCESOS del plan (en orden de secuencia). */
function tablaProcesos(datos: DatosImpresoPlanRc): ReactElement {
  const filaEncabezado = h(
    View,
    { style: estilos.filaTabla, key: 'enc' },
    h(Text, { style: [estilos.celda, estilos.celdaEncabezado, estilos.celdaNum] }, '#'),
    h(Text, { style: [estilos.celda, estilos.celdaEncabezado, estilos.celdaProceso] }, 'Proceso'),
    h(Text, { style: [estilos.celda, estilos.celdaEncabezado, estilos.celdaFecha] }, 'Planeada'),
    h(Text, { style: [estilos.celda, estilos.celdaEncabezado, estilos.celdaDuracion] }, 'Días'),
    h(
      Text,
      { style: [estilos.celda, estilos.celdaEncabezado, estilos.celdaResponsables] },
      'Responsables',
    ),
    h(Text, { style: [estilos.celda, estilos.celdaEncabezado, estilos.celdaEstado] }, 'Estado'),
    h(Text, { style: [estilos.celda, estilos.celdaEncabezado, estilos.celdaFecha] }, 'Real'),
  );

  const filas = datos.procesos.map((p, i) =>
    h(
      View,
      { style: estilos.filaTabla, key: `fila-${i}`, wrap: false },
      h(Text, { style: [estilos.celda, estilos.celdaNum] }, String(i + 1)),
      h(
        Text,
        {
          style: [
            estilos.celda,
            estilos.celdaProceso,
            ...(p.critico ? [estilos.textoCritico] : []),
          ],
        },
        p.critico ? `${p.nombreProceso} (crítico)` : p.nombreProceso,
      ),
      h(Text, { style: [estilos.celda, estilos.celdaFecha] }, p.fechaPlaneada ?? '—'),
      h(Text, { style: [estilos.celda, estilos.celdaDuracion] }, String(p.duracionDias)),
      h(
        Text,
        { style: [estilos.celda, estilos.celdaResponsables] },
        p.responsables.length === 0 ? '—' : p.responsables.join(', '),
      ),
      h(Text, { style: [estilos.celda, estilos.celdaEstado] }, ETIQUETA_ESTADO[p.estado]),
      h(Text, { style: [estilos.celda, estilos.celdaFecha] }, p.fechaReal ?? '—'),
    ),
  );

  return h(
    View,
    { style: estilos.seccion },
    h(Text, { style: estilos.tituloSeccion }, 'Procesos de la Ruta Crítica'),
    filaEncabezado,
    ...filas,
  );
}

/** Una página del plan de la RC. */
function paginaPlan(datos: DatosImpresoPlanRc, clave: string): ReactElement {
  const hijos: ReactElement[] = [
    h(
      View,
      { style: estilos.encabezado, key: 'enc' },
      h(
        View,
        {},
        h(Text, { style: estilos.empresa }, datos.empresa),
        h(Text, { style: estilos.subtitulo }, 'Plan de la Ruta Crítica por orden — CONTROL v2'),
        h(
          Text,
          { style: [estilos.semaforoChip, { color: colorSemaforo(datos.semaforo) }] },
          `Semáforo: ${ETIQUETA_SEMAFORO[datos.semaforo]}`,
        ),
      ),
      h(
        View,
        { style: estilos.folioBloque },
        h(Text, { style: estilos.folioEtiqueta }, 'Orden'),
        h(Text, { style: estilos.folioValor }, String(datos.folioOrden)),
      ),
    ),
    h(
      View,
      { style: estilos.filaCampos, key: 'campos' },
      campo('Cliente', datos.cliente),
      campo('Modelo', datos.modelo),
      campo('Entrega RC', datos.fechaEntregaRC),
      campo('Inicio RC', datos.fechaInicioRC),
      campo('Resurtido', datos.esResurtido ? 'Sí' : 'No'),
    ),
    tablaProcesos(datos),
    h(
      Text,
      { style: estilos.pie, key: 'pie', fixed: true },
      `CONTROL v2 · ${datos.empresa} · Orden ${datos.folioOrden} · ${datos.procesos.length} procesos`,
    ),
  ];
  return h(Page, { key: clave, size: 'A4', style: estilos.pagina }, ...hijos);
}

/** Documento del PLAN de la RC de UNA orden. */
function documentoPlan(datos: DatosImpresoPlanRc): ReactElement<DocumentProps> {
  return h(
    Document,
    {
      title: `Plan RC orden ${datos.folioOrden}`,
      author: datos.empresa,
      subject: 'Plan de la Ruta Crítica',
    },
    paginaPlan(datos, 'plan'),
  );
}

/** Genera el PDF (Buffer) del plan de la RC a partir de sus datos resueltos. */
export async function generarPdfPlanRc(datos: DatosImpresoPlanRc): Promise<Buffer> {
  return renderToBuffer(documentoPlan(datos));
}

/** Resultado de generar el plan de la RC (Buffer + folio de la orden para el `filename`). */
export interface ImpresoPlanRc {
  buffer: Buffer;
  folioOrden: number;
}

/** Resuelve los datos del plan de la RC (A9) y devuelve su PDF + el folio para el nombre del archivo. */
export async function impresoPlanRc(
  sesion: SesionUsuario,
  idOrden: number,
  bd?: ContextoBd,
  deps: DepsImpresoPlanRc = {},
): Promise<ImpresoPlanRc> {
  const datos = await armarDatosImpresoPlanRc(sesion, idOrden, bd, deps);
  return { buffer: await renderizarPdfEnWorker('plan-rc', datos), folioOrden: datos.folioOrden };
}
