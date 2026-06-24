/**
 * Impreso del RECIBO de maquila UNIFICADO (F3-E4, R9; ref. viejo `ReciboMaqImp`/`RecibosEstImp`): la
 * hoja que documenta la recepción de prenda terminada desde maquila. UN PDF parametrizado por
 * `TipoProceso` (costura/estampado/…, D8): el encabezado y la nota cambian según si el proceso metió
 * a inventario PT (costura) o no (estampado/bordado/lavado). Incluye la matriz color×talla con su
 * CALIDAD (primeras/segundas) y los totales.
 *
 * Documento generado EN EL SERVIDOR con `@react-pdf/renderer` (`renderToBuffer`), MISMO motor y
 * patrón que `impreso-envio-maquila.ts` (A1: la ruta solo valida permiso+Zod y delega). Reusa
 * `obtenerRecibo` (encabezado + matriz + nombres) — A9: filtra por la empresa activa → 404 si no.
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
import { obtenerRecibo } from '../recibos.js';
import type { ReciboSalida } from '../../../contrato/index.js';

// ── Datos resueltos del impreso (forma PURA: ya sin BD) ──────────────────────────────────────────

/** Todo lo que necesita el documento de recibo, ya resuelto (sin BD) → función pura. */
export interface DatosImpresoRecibo {
  empresa: string;
  folio: number;
  fecha: string;
  maquilero: string | null;
  proceso: string | null;
  generaEntradaPt: boolean;
  almacenPrimeras: string | null;
  almacenSegundas: string | null;
  folioOrden: number;
  precioPactado: number | null;
  observaciones: string | null;
  cancelado: boolean;
  /** Columnas: etiquetas de talla en el orden en que aparecen. */
  tallas: string[];
  /** Renglones color×talla; `cantidades[i]` alinea con `tallas[i]`. */
  renglones: { color: string; cantidades: number[]; totalFila: number }[];
  totalesColumna: number[];
  totalPiezas: number;
  totalPrimeras: number;
  totalSegundas: number;
}

/** Proyecta la matriz del recibo a la tabla color×talla del impreso (misma forma que el envío). */
export function armarTablaRecibo(
  lineas: ReciboSalida['lineas'],
): Pick<DatosImpresoRecibo, 'tallas' | 'renglones' | 'totalesColumna' | 'totalPiezas'> {
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

/** Dependencias inyectables (los tests inyectan un `obtenerRecibo` fake para no tocar BD). */
export interface DepsImpresoRecibo {
  obtenerRecibo?: typeof obtenerRecibo;
}

/** Resuelve los datos del impreso de un recibo (A9). Reusa `obtenerRecibo`. */
export async function armarDatosImpresoRecibo(
  sesion: SesionUsuario,
  idRecibo: number,
  bd?: ContextoBd,
  deps: DepsImpresoRecibo = {},
): Promise<DatosImpresoRecibo> {
  const obtener = deps.obtenerRecibo ?? obtenerRecibo;
  const recibo = await obtener(sesion, idRecibo, bd);
  const tabla = armarTablaRecibo(recibo.lineas);
  return {
    empresa: sesion.nombreEmpresaActiva,
    folio: recibo.folio,
    fecha: recibo.fecha,
    maquilero: recibo.tercero,
    proceso: recibo.tipoProceso,
    generaEntradaPt: recibo.generaEntradaPt,
    almacenPrimeras: recibo.almacenPrimeras,
    almacenSegundas: recibo.almacenSegundas,
    folioOrden: recibo.folioOrden,
    precioPactado: recibo.precioPactado,
    observaciones: recibo.observaciones,
    cancelado: recibo.cancelado,
    totalPrimeras: recibo.totalPrimeras,
    totalSegundas: recibo.totalSegundas,
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
  notaCalidad: {
    marginTop: 8,
    flexDirection: 'row',
    gap: 16,
  },
  notaItem: { fontSize: 9 },
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

/** Banda roja "RECIBO CANCELADO" (solo si está cancelado). */
function bandaCancelada(datos: DatosImpresoRecibo): ReactElement | null {
  if (!datos.cancelado) {
    return null;
  }
  return h(
    View,
    { style: estilos.bandaCancelada },
    h(Text, { style: estilos.bandaCanceladaTitulo }, 'RECIBO CANCELADO'),
  );
}

/** Tabla MATRIZ color×talla con totales por fila/columna y total general. */
function tablaMatriz(datos: DatosImpresoRecibo): ReactElement {
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
    h(Text, { style: estilos.tituloSeccion }, 'Cantidades recibidas (color × talla)'),
    ...cuerpo,
  );
}

/** Pesos en MXN sin redondear (precio pactado). */
function pesos(valor: number | null): string | null {
  if (valor === null) return null;
  return valor.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
}

/** Una página del documento de RECIBO de maquila. */
function paginaRecibo(datos: DatosImpresoRecibo, clave: string): ReactElement {
  const camposAlmacen = datos.generaEntradaPt
    ? [
        campo('Almacén primeras', datos.almacenPrimeras),
        campo('Almacén segundas', datos.almacenSegundas),
      ]
    : [];

  const hijos: (ReactElement | null)[] = [
    h(
      View,
      { style: estilos.encabezado, key: 'enc' },
      h(
        View,
        {},
        h(Text, { style: estilos.empresa }, datos.empresa),
        h(Text, { style: estilos.subtitulo }, 'Recibo de maquila — CONTROL v2'),
      ),
      h(
        View,
        { style: estilos.folioBloque },
        h(Text, { style: estilos.folioEtiqueta }, 'Folio de recibo'),
        h(Text, { style: estilos.folioValor }, String(datos.folio)),
      ),
    ),
    bandaCancelada(datos),
    h(
      View,
      { style: estilos.filaCampos, key: 'campos' },
      campo('Maquilero', datos.maquilero),
      campo('Proceso', datos.proceso),
      campo('Orden', String(datos.folioOrden)),
      campo('Fecha de recibo', datos.fecha),
      campo('Precio pactado', pesos(datos.precioPactado)),
      campo('Mete a inventario', datos.generaEntradaPt ? 'Sí (costura)' : 'No'),
      ...camposAlmacen,
    ),
    datos.observaciones
      ? h(
          View,
          { style: estilos.campoAncho, key: 'obs' },
          h(Text, { style: estilos.etiquetaCampo }, 'Observaciones'),
          h(Text, { style: estilos.valorCampoTexto }, datos.observaciones),
        )
      : null,
    tablaMatriz(datos),
    h(
      View,
      { style: estilos.notaCalidad, key: 'calidad' },
      h(Text, { style: estilos.notaItem }, `Primeras: ${datos.totalPrimeras}`),
      h(Text, { style: estilos.notaItem }, `Segundas: ${datos.totalSegundas}`),
      h(Text, { style: estilos.notaItem }, `Total recibido: ${datos.totalPiezas}`),
    ),
    h(
      Text,
      { style: estilos.pie, key: 'pie', fixed: true },
      `CONTROL v2 · ${datos.empresa} · Recibo ${datos.folio} · Orden ${datos.folioOrden} · ${datos.totalPiezas} piezas`,
    ),
  ];
  return h(
    Page,
    { key: clave, size: 'A4', style: estilos.pagina },
    ...hijos.filter((x) => x !== null),
  );
}

/** Documento de UN recibo de maquila. */
function documentoRecibo(datos: DatosImpresoRecibo): ReactElement<DocumentProps> {
  return h(
    Document,
    { title: `Recibo ${datos.folio}`, author: datos.empresa, subject: 'Recibo de maquila' },
    paginaRecibo(datos, 'recibo'),
  );
}

/** Genera el PDF (Buffer) del documento de recibo a partir de sus datos resueltos. */
export async function generarPdfRecibo(datos: DatosImpresoRecibo): Promise<Buffer> {
  return renderToBuffer(documentoRecibo(datos));
}

/** Resultado de generar un impreso de recibo (Buffer + folio para el `filename`). */
export interface ImpresoRecibo {
  buffer: Buffer;
  folio: number;
}

/** Resuelve los datos del recibo (A9) y devuelve su PDF + el folio para el nombre del archivo. */
export async function impresoReciboMaquila(
  sesion: SesionUsuario,
  idRecibo: number,
  bd?: ContextoBd,
  deps: DepsImpresoRecibo = {},
): Promise<ImpresoRecibo> {
  const datos = await armarDatosImpresoRecibo(sesion, idRecibo, bd, deps);
  return { buffer: await generarPdfRecibo(datos), folio: datos.folio };
}
