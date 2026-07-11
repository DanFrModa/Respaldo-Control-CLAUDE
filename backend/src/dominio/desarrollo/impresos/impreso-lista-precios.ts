/**
 * Impreso "LISTA DE PRECIOS" (F8-E4, R9; D13/R20a): la hoja (PDF) que documenta la lista de precios de
 * un Cliente+Departamento — encabezado (cliente, departamento, folio, fecha, estado) + tabla de
 * renglones con **modelo / número del cliente / precio** (= `precioAprobado` si existe, si no
 * `precioCalculado`).
 *
 * Documento generado EN EL SERVIDOR con `@react-pdf/renderer` (`renderToBuffer`), MISMO motor/patrón
 * que `impreso-plan-rc.ts` (A1: la ruta solo valida permiso + Zod y delega). REUSA `obtenerLista` (A9:
 * filtra por la empresa activa → 404 si la lista no es de la empresa; los importes ya vienen resueltos
 * por el dominio). La ruta EXIGE `consultas.ver-importes`, así que en este camino los precios siempre
 * llegan (el impreso ES la exportación de precios).
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

import type { SesionUsuario } from '../../../comun/permisos.js';
import type { ContextoBd } from '../../../comun/transaccion.js';
import { obtenerLista } from '../listas-precios.js';

/** Un renglón de la lista, ya proyectado para el PDF. */
export interface RenglonListaImpreso {
  codigoModelo: string;
  descripcionModelo: string | null;
  numeroCliente: string | null;
  /** Precio a imprimir: aprobado si existe, si no el calculado. Null solo si no hubo importes. */
  precio: number | null;
  aprobado: boolean;
}

/** Todo lo que necesita el impreso de la lista, ya resuelto (sin BD) → función pura. */
export interface DatosImpresoListaPrecios {
  empresa: string;
  folio: number;
  cliente: string;
  departamento: string;
  fecha: string;
  estado: string;
  notas: string | null;
  renglones: RenglonListaImpreso[];
}

/** Dependencias inyectables (los tests inyectan un `obtenerLista` fake para no tocar BD). */
export interface DepsImpresoListaPrecios {
  obtenerLista?: typeof obtenerLista;
}

/**
 * Resuelve los datos del impreso de la lista (A9). Reusa `obtenerLista` (renglones con sus precios ya
 * resueltos) y proyecta el precio a imprimir (`precioAprobado ?? precioCalculado`).
 */
export async function armarDatosImpresoListaPrecios(
  sesion: SesionUsuario,
  idLista: number,
  bd?: ContextoBd,
  deps: DepsImpresoListaPrecios = {},
): Promise<DatosImpresoListaPrecios> {
  const obtener = deps.obtenerLista ?? obtenerLista;
  const lista = await obtener(sesion, idLista, bd);

  return {
    empresa: sesion.nombreEmpresaActiva,
    folio: lista.folio,
    cliente: lista.nombreCliente,
    departamento: lista.nombreDepartamento,
    fecha: lista.fecha,
    estado: lista.nombreEstado,
    notas: lista.notas,
    renglones: lista.lineas.map((l) => ({
      codigoModelo: l.codigoModelo,
      descripcionModelo: l.descripcionModelo,
      numeroCliente: l.numeroCliente,
      precio: l.precioAprobado ?? l.precioCalculado,
      aprobado: l.aprobado,
    })),
  };
}

// ── Documento PDF (react-pdf, sin JSX) ──────────────────────────────────────────────────────────

const TEAL = '#0d9488';
const GRIS = '#64748b';
const GRIS_BORDE = '#e2e8f0';
const TINTA = '#0f172a';
const VERDE = '#15803d';

/** Formatea un precio a "$1,234" (entero, MXN) o "—" si null. */
function formatearPrecio(precio: number | null): string {
  if (precio === null) {
    return '—';
  }
  return `$${precio.toLocaleString('es-MX', { maximumFractionDigits: 2 })}`;
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
  celdaModelo: { width: 90, textAlign: 'left' },
  celdaDescripcion: { flexGrow: 1, flexBasis: 0, textAlign: 'left' },
  celdaNumero: { width: 90, textAlign: 'left' },
  celdaPrecio: { width: 70, textAlign: 'right' },
  aprobadoChip: { color: VERDE, fontSize: 7 },
  notas: { fontSize: 8, color: GRIS, marginTop: 8 },
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
function campo(etiqueta: string, valor: string): ReactElement {
  return h(
    View,
    { style: estilos.campo, key: etiqueta },
    h(Text, { style: estilos.etiquetaCampo }, etiqueta),
    h(Text, { style: estilos.valorCampo }, valor === '' ? '—' : valor),
  );
}

/** Tabla de RENGLONES de la lista (modelo / número del cliente / precio). */
function tablaRenglones(datos: DatosImpresoListaPrecios): ReactElement {
  const filaEncabezado = h(
    View,
    { style: estilos.filaTabla, key: 'enc' },
    h(Text, { style: [estilos.celda, estilos.celdaEncabezado, estilos.celdaModelo] }, 'Modelo'),
    h(
      Text,
      { style: [estilos.celda, estilos.celdaEncabezado, estilos.celdaDescripcion] },
      'Descripción',
    ),
    h(Text, { style: [estilos.celda, estilos.celdaEncabezado, estilos.celdaNumero] }, 'Nº cliente'),
    h(Text, { style: [estilos.celda, estilos.celdaEncabezado, estilos.celdaPrecio] }, 'Precio'),
  );

  const filas = datos.renglones.map((r, i) =>
    h(
      View,
      { style: estilos.filaTabla, key: `fila-${i}`, wrap: false },
      h(Text, { style: [estilos.celda, estilos.celdaModelo] }, r.codigoModelo),
      h(Text, { style: [estilos.celda, estilos.celdaDescripcion] }, r.descripcionModelo ?? '—'),
      h(Text, { style: [estilos.celda, estilos.celdaNumero] }, r.numeroCliente ?? '—'),
      h(
        Text,
        { style: [estilos.celda, estilos.celdaPrecio] },
        `${formatearPrecio(r.precio)}${r.aprobado ? '' : ' *'}`,
      ),
    ),
  );

  return h(
    View,
    { style: estilos.seccion },
    h(Text, { style: estilos.tituloSeccion }, `Renglones (${datos.renglones.length})`),
    filaEncabezado,
    ...filas,
    h(
      Text,
      { style: estilos.aprobadoChip, key: 'leyenda' },
      '* precio calculado (aún no aprobado por el dueño).',
    ),
  );
}

/** Una página de la lista de precios. */
function paginaLista(datos: DatosImpresoListaPrecios, clave: string): ReactElement {
  const hijos: ReactElement[] = [
    h(
      View,
      { style: estilos.encabezado, key: 'enc' },
      h(
        View,
        {},
        h(Text, { style: estilos.empresa }, datos.empresa),
        h(Text, { style: estilos.subtitulo }, 'Lista de precios por cliente — CONTROL v2'),
      ),
      h(
        View,
        { style: estilos.folioBloque },
        h(Text, { style: estilos.folioEtiqueta }, 'Lista'),
        h(Text, { style: estilos.folioValor }, String(datos.folio)),
      ),
    ),
    h(
      View,
      { style: estilos.filaCampos, key: 'campos' },
      campo('Cliente', datos.cliente),
      campo('Departamento', datos.departamento),
      campo('Fecha', datos.fecha),
      campo('Estado', datos.estado),
    ),
    tablaRenglones(datos),
    ...(datos.notas !== null && datos.notas !== ''
      ? [h(Text, { style: estilos.notas, key: 'notas' }, `Notas: ${datos.notas}`)]
      : []),
    h(
      Text,
      { style: estilos.pie, key: 'pie', fixed: true },
      `CONTROL v2 · ${datos.empresa} · Lista ${datos.folio} · ${datos.renglones.length} renglones`,
    ),
  ];
  return h(Page, { key: clave, size: 'A4', style: estilos.pagina }, ...hijos);
}

/** Documento de la LISTA de precios. */
function documentoLista(datos: DatosImpresoListaPrecios): ReactElement<DocumentProps> {
  return h(
    Document,
    {
      title: `Lista de precios ${datos.folio}`,
      author: datos.empresa,
      subject: 'Lista de precios por cliente',
    },
    paginaLista(datos, 'lista'),
  );
}

/** Genera el PDF (Buffer) de la lista de precios a partir de sus datos resueltos. */
export async function generarPdfListaPrecios(datos: DatosImpresoListaPrecios): Promise<Buffer> {
  return renderToBuffer(documentoLista(datos));
}

/** Resultado de generar la lista de precios (Buffer + folio para el `filename`). */
export interface ImpresoListaPrecios {
  buffer: Buffer;
  folio: number;
}

/** Resuelve los datos de la lista (A9) y devuelve su PDF + el folio para el nombre del archivo. */
export async function impresoListaPrecios(
  sesion: SesionUsuario,
  idLista: number,
  bd?: ContextoBd,
  deps: DepsImpresoListaPrecios = {},
): Promise<ImpresoListaPrecios> {
  const datos = await armarDatosImpresoListaPrecios(sesion, idLista, bd, deps);
  return {
    buffer: await renderizarPdfEnWorker('desarrollo-lista-precios', datos),
    folio: datos.folio,
  };
}
