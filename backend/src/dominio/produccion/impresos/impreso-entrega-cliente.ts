/**
 * Comprobante de la ENTREGA A CLIENTE (F3-E5, R9): la hoja (PDF) que documenta la entrega de
 * producto terminado al cliente (cliente, modelo, matriz color×talla, fecha, folio). Decisión Gabriel
 * 2026-06-19: la entrega lleva comprobante imprimible (R9 que estaba "por definir").
 *
 * Documento generado EN EL SERVIDOR con `@react-pdf/renderer` (`renderToBuffer`), MISMO motor y
 * patrón que `impreso-recibo-maquila.ts` (A1: la ruta solo valida permiso+Zod y delega). Reusa
 * `obtenerEntrega` (encabezado + matriz + nombres) — A9: filtra por la empresa activa → 404 si no.
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

import type { SesionUsuario } from '../../../comun/permisos.js';
import type { ContextoBd } from '../../../comun/transaccion.js';
import { obtenerEntrega } from '../entregas-cliente.js';
import type { EntregaClienteSalida } from '../../../contrato/index.js';

// ── Datos resueltos del impreso (forma PURA: ya sin BD) ──────────────────────────────────────────

/** Todo lo que necesita el comprobante de entrega, ya resuelto (sin BD) → función pura. */
export interface DatosImpresoEntrega {
  empresa: string;
  folio: number;
  fecha: string;
  cliente: string | null;
  modelo: string;
  almacen: string | null;
  folioOrden: number;
  observaciones: string | null;
  cancelado: boolean;
  /** Columnas: etiquetas de talla en el orden en que aparecen. */
  tallas: string[];
  /** Renglones color×talla; `cantidades[i]` alinea con `tallas[i]`. */
  renglones: { color: string; cantidades: number[]; totalFila: number }[];
  totalesColumna: number[];
  totalPiezas: number;
}

/** Proyecta la matriz de la entrega a la tabla color×talla del impreso (misma forma que el recibo). */
export function armarTablaEntrega(
  lineas: EntregaClienteSalida['lineas'],
): Pick<DatosImpresoEntrega, 'tallas' | 'renglones' | 'totalesColumna' | 'totalPiezas'> {
  const tallas: string[] = [];
  for (const linea of lineas) {
    for (const t of linea.tallas) {
      if (!tallas.includes(t.etiquetaTalla)) {
        tallas.push(t.etiquetaTalla);
      }
    }
  }

  const totalesColumna = new Array<number>(tallas.length).fill(0);
  let totalPiezas = 0;

  const renglones = lineas.map((linea) => {
    const porTalla = new Map(linea.tallas.map((t) => [t.etiquetaTalla, t.cantidad]));
    const cantidades = tallas.map((etiqueta) => porTalla.get(etiqueta) ?? 0);
    let totalFila = 0;
    cantidades.forEach((cantidad, i) => {
      totalFila += cantidad;
      totalesColumna[i] = (totalesColumna[i] ?? 0) + cantidad;
    });
    totalPiezas += totalFila;
    return { color: linea.color, cantidades, totalFila };
  });

  return { tallas, renglones, totalesColumna, totalPiezas };
}

/** Dependencias inyectables (los tests inyectan un `obtenerEntrega` fake para no tocar BD). */
export interface DepsImpresoEntrega {
  obtenerEntrega?: typeof obtenerEntrega;
}

/** Resuelve los datos del comprobante de una entrega (A9). Reusa `obtenerEntrega`. */
export async function armarDatosImpresoEntrega(
  sesion: SesionUsuario,
  idEntrega: number,
  bd?: ContextoBd,
  deps: DepsImpresoEntrega = {},
): Promise<DatosImpresoEntrega> {
  const obtener = deps.obtenerEntrega ?? obtenerEntrega;
  const entrega = await obtener(sesion, idEntrega, bd);
  const tabla = armarTablaEntrega(entrega.lineas);
  return {
    empresa: sesion.nombreEmpresaActiva,
    folio: entrega.folio,
    fecha: entrega.fecha,
    cliente: entrega.cliente,
    modelo: entrega.modelo,
    almacen: entrega.almacen,
    folioOrden: entrega.folioOrden,
    observaciones: entrega.observaciones,
    cancelado: entrega.cancelado,
    ...tabla,
  };
}

// ── Documento PDF (react-pdf, sin JSX) ──────────────────────────────────────────────────────────

const TEAL = '#0d9488';
const GRIS = '#64748b';
const GRIS_BORDE = '#e2e8f0';
const TINTA = '#0f172a';
const ROJO = '#b91c1c';

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
  bandaCancelada: {
    backgroundColor: ROJO,
    color: '#ffffff',
    paddingVertical: 4,
    paddingHorizontal: 8,
    marginBottom: 10,
    borderRadius: 4,
  },
  bandaCanceladaTitulo: { fontSize: 12, fontFamily: 'Helvetica-Bold' },
  filaCampos: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 },
  campo: { width: '33%', marginBottom: 6, paddingRight: 8 },
  campoAncho: { width: '66%', marginBottom: 6, paddingRight: 8 },
  etiquetaCampo: { fontSize: 7, color: GRIS, textTransform: 'uppercase' },
  valorCampo: { fontSize: 10, fontFamily: 'Helvetica-Bold' },
  valorCampoTexto: { fontSize: 9 },
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
  celdaColor: { flexGrow: 1, flexBasis: 0, textAlign: 'left' },
  celdaTalla: { width: 34, textAlign: 'center' },
  celdaTotal: { width: 42, textAlign: 'center', fontFamily: 'Helvetica-Bold' },
  filaTotales: { backgroundColor: '#f8fafc' },
  notaEntrega: { marginTop: 10, fontSize: 9 },
  firmas: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 36 },
  firma: { width: '45%', borderTopWidth: 0.5, borderTopColor: GRIS, paddingTop: 4 },
  firmaEtiqueta: { fontSize: 8, color: GRIS, textAlign: 'center' },
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
function campo(etiqueta: string, valor: string | null, ancho = false): ReactElement {
  return h(
    View,
    { style: ancho ? estilos.campoAncho : estilos.campo, key: etiqueta },
    h(Text, { style: estilos.etiquetaCampo }, etiqueta),
    h(Text, { style: estilos.valorCampo }, valor ?? '—'),
  );
}

/** Banda roja "ENTREGA CANCELADA" (solo si está cancelada). */
function bandaCancelada(datos: DatosImpresoEntrega): ReactElement | null {
  if (!datos.cancelado) {
    return null;
  }
  return h(
    View,
    { style: estilos.bandaCancelada },
    h(Text, { style: estilos.bandaCanceladaTitulo }, 'ENTREGA CANCELADA'),
  );
}

/** Tabla MATRIZ color×talla con totales por fila/columna y total general. */
function tablaMatriz(datos: DatosImpresoEntrega): ReactElement {
  const filaEncabezado = h(
    View,
    { style: estilos.filaTabla, key: 'enc' },
    h(Text, { style: [estilos.celda, estilos.celdaEncabezado, estilos.celdaColor] }, 'Color'),
    ...datos.tallas.map((t, i) =>
      h(
        Text,
        { key: `th-${i}`, style: [estilos.celda, estilos.celdaEncabezado, estilos.celdaTalla] },
        t,
      ),
    ),
    h(Text, { style: [estilos.celda, estilos.celdaEncabezado, estilos.celdaTotal] }, 'Total'),
  );

  const filasColor = datos.renglones.map((r, fila) =>
    h(
      View,
      { style: estilos.filaTabla, key: `fila-${fila}` },
      h(Text, { style: [estilos.celda, estilos.celdaColor] }, r.color),
      ...r.cantidades.map((c, i) =>
        h(
          Text,
          { key: `c-${fila}-${i}`, style: [estilos.celda, estilos.celdaTalla] },
          c === 0 ? '' : String(c),
        ),
      ),
      h(Text, { style: [estilos.celda, estilos.celdaTotal] }, String(r.totalFila)),
    ),
  );

  const filaTotales = h(
    View,
    { style: [estilos.filaTabla, estilos.filaTotales], key: 'tot' },
    h(Text, { style: [estilos.celda, estilos.celdaEncabezado, estilos.celdaColor] }, 'Total'),
    ...datos.totalesColumna.map((c, i) =>
      h(
        Text,
        { key: `tc-${i}`, style: [estilos.celda, estilos.celdaEncabezado, estilos.celdaTalla] },
        String(c),
      ),
    ),
    h(
      Text,
      { style: [estilos.celda, estilos.celdaEncabezado, estilos.celdaTotal] },
      String(datos.totalPiezas),
    ),
  );

  const cuerpo =
    datos.renglones.length === 0
      ? [h(Text, { style: estilos.vacio, key: 'vacio' }, 'Sin matriz.')]
      : [filaEncabezado, ...filasColor, filaTotales];

  return h(
    View,
    { style: estilos.seccion },
    h(Text, { style: estilos.tituloSeccion }, 'Cantidades entregadas (color × talla)'),
    ...cuerpo,
  );
}

/** Una página del comprobante de ENTREGA a cliente. */
function paginaEntrega(datos: DatosImpresoEntrega, clave: string): ReactElement {
  const hijos: (ReactElement | null)[] = [
    h(
      View,
      { style: estilos.encabezado, key: 'enc' },
      h(
        View,
        {},
        h(Text, { style: estilos.empresa }, datos.empresa),
        h(Text, { style: estilos.subtitulo }, 'Comprobante de entrega a cliente — CONTROL v2'),
      ),
      h(
        View,
        { style: estilos.folioBloque },
        h(Text, { style: estilos.folioEtiqueta }, 'Folio de entrega'),
        h(Text, { style: estilos.folioValor }, String(datos.folio)),
      ),
    ),
    bandaCancelada(datos),
    h(
      View,
      { style: estilos.filaCampos, key: 'campos' },
      campo('Cliente', datos.cliente),
      campo('Modelo', datos.modelo),
      campo('Orden', String(datos.folioOrden)),
      campo('Fecha de entrega', datos.fecha),
      campo('Almacén de salida', datos.almacen),
    ),
    datos.observaciones
      ? h(
          View,
          { style: estilos.campoAncho, key: 'obs' },
          h(Text, { style: estilos.etiquetaCampo }, 'Observaciones / referencia'),
          h(Text, { style: estilos.valorCampoTexto }, datos.observaciones),
        )
      : null,
    tablaMatriz(datos),
    h(
      Text,
      { style: estilos.notaEntrega, key: 'nota' },
      `Total entregado: ${datos.totalPiezas} piezas.`,
    ),
    h(
      View,
      { style: estilos.firmas, key: 'firmas' },
      h(
        View,
        { style: estilos.firma },
        h(Text, { style: estilos.firmaEtiqueta }, 'Entregó'),
      ),
      h(
        View,
        { style: estilos.firma },
        h(Text, { style: estilos.firmaEtiqueta }, 'Recibió (cliente)'),
      ),
    ),
    h(
      Text,
      { style: estilos.pie, key: 'pie', fixed: true },
      `CONTROL v2 · ${datos.empresa} · Entrega ${datos.folio} · Orden ${datos.folioOrden} · ${datos.totalPiezas} piezas`,
    ),
  ];
  return h(
    Page,
    { key: clave, size: 'A4', style: estilos.pagina },
    ...hijos.filter((x) => x !== null),
  );
}

/** Documento de UNA entrega a cliente. */
function documentoEntrega(datos: DatosImpresoEntrega): ReactElement<DocumentProps> {
  return h(
    Document,
    { title: `Entrega ${datos.folio}`, author: datos.empresa, subject: 'Entrega a cliente' },
    paginaEntrega(datos, 'entrega'),
  );
}

/** Genera el PDF (Buffer) del comprobante de entrega a partir de sus datos resueltos. */
export async function generarPdfEntrega(datos: DatosImpresoEntrega): Promise<Buffer> {
  return renderToBuffer(documentoEntrega(datos));
}

/** Resultado de generar un comprobante de entrega (Buffer + folio para el `filename`). */
export interface ImpresoEntrega {
  buffer: Buffer;
  folio: number;
}

/** Resuelve los datos de la entrega (A9) y devuelve su PDF + el folio para el nombre del archivo. */
export async function impresoEntregaCliente(
  sesion: SesionUsuario,
  idEntrega: number,
  bd?: ContextoBd,
  deps: DepsImpresoEntrega = {},
): Promise<ImpresoEntrega> {
  const datos = await armarDatosImpresoEntrega(sesion, idEntrega, bd, deps);
  return { buffer: await generarPdfEntrega(datos), folio: datos.folio };
}
