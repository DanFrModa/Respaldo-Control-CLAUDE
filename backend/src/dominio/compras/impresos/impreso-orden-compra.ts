/**
 * Impreso de la ORDEN DE COMPRA (F4-E2) — el PDF que se le manda al proveedor para comprar
 * material (telas/avíos). Documento generado EN EL SERVIDOR con `@react-pdf/renderer`
 * (`renderToBuffer`), el mismo motor que los demás impresos del sistema (orden de producción,
 * envío de maquila, etc.). El frontend solo abre el blob.
 *
 * Decisiones del dueño (Daniel, cerradas):
 *  • (c) UN SOLO PDF de OC (se retiran las variantes viejas y el Excel). La matriz talla×color del
 *    renglón que la use se imprime como tabla. La cantidad del renglón = Σ de su matriz.
 *  • A diferencia de la orden de PRODUCCIÓN, la OC SÍ lleva importes (precio, importe, total): es un
 *    documento de COMPRA, no una hoja de piso.
 *
 * Innegociables aplicados:
 *  • A1 — TODA la lógica de armado vive aquí (dominio); la ruta solo valida permiso+Zod y delega.
 *  • A4 — la autorización la hace `obtenerOC` (`verificarPermiso(sesion, 'compras.ver')`).
 *  • A9 — la OC se resuelve por `obtenerOC`, que filtra por la empresa activa de la sesión (una OC de
 *    otra empresa, para esta sesión, no existe → `ErrorNoEncontrado`/404).
 *  • REUSO — los datos se arman con `obtenerOC` (encabezado + líneas + matriz + total derivado). NO
 *    se reinventa la consulta ni el cálculo del total; el impreso es una vista del mismo dato.
 *
 * Es PURO sobre los datos: `armarDatosImpresoOC` resuelve (única parte que toca BD) y
 * `generarPdfOrdenCompra` recibe los datos ya resueltos (testeable sin BD). `obtenerOC` es un seam
 * inyectable para los tests.
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

import { verificarPermiso, type SesionUsuario } from '../../../comun/permisos.js';
import { type ContextoBd } from '../../../comun/transaccion.js';
import { obtenerOC } from '../ordenes-compra.js';

// ── Datos resueltos del impreso (forma PURA: ya sin BD) ──────────────────────────────────────────

/** Una celda de la matriz talla×color de un renglón (para imprimirla como tabla). */
export interface CeldaMatrizImpreso {
  color: string;
  talla: string;
  cantidad: number;
}

/** Un renglón del impreso de la OC, con su importe derivado y (opcional) su matriz. */
export interface LineaImpresoOC {
  /** Texto del material: nombre de tela/avío, o la descripción libre. */
  material: string;
  cantidad: number;
  unidad: string | null;
  precio: number;
  importe: number;
  /** Folio de la orden de producción ligada (R7), o null. */
  folioOrden: number | null;
  /** Matriz talla×color del renglón (vacía si no aplica). */
  matriz: CeldaMatrizImpreso[];
}

/**
 * Todo lo que necesita el documento PDF de UNA orden de compra, ya RESUELTO (sin BD): así
 * `generarPdfOrdenCompra` es una función pura y testeable. El total CUADRA con `CompraSalida.total`.
 */
export interface DatosImpresoOC {
  empresa: string;
  numCompra: number;
  estatus: string;
  cancelada: boolean;
  motivoCancelacion: string | null;
  proveedor: string;
  fecha: string | null;
  fechaEntrega: string | null;
  entregaEn: string | null;
  observaciones: string | null;
  correspondeA: string | null;
  /** Facturas amparadas en v1 (solo lectura, lo llena el ETL), o null. */
  facturasAmparadasLegacy: string | null;
  lineas: LineaImpresoOC[];
  total: number;
}

// ── Resolución de datos (lo único que toca BD) ───────────────────────────────────────────────────

/**
 * Dependencias inyectables de la resolución de datos. Por defecto usa la lectura de dominio real
 * (`obtenerOC`, que ya verifica permiso + empresa activa). Los tests inyectan un fake para no tocar
 * la BD.
 */
export interface DepsImpresoOC {
  obtenerOC?: typeof obtenerOC;
}

/** Texto del material de un renglón: nombre de tela/avío, o la descripción libre, o "—". */
function textoMaterial(linea: {
  tela: string | null;
  avio: string | null;
  descripcionLibre: string | null;
}): string {
  return linea.tela ?? linea.avio ?? linea.descripcionLibre ?? '—';
}

/**
 * Resuelve TODOS los datos del impreso de una OC (A9: por la empresa activa de la sesión). Reúsa
 * `obtenerOC` (encabezado + líneas + matriz + total derivado): el impreso es una vista del mismo
 * dato, no recalcula nada. Lanza `ErrorNoEncontrado` (404) si la OC no es de la empresa activa.
 */
export async function armarDatosImpresoOC(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
  deps: DepsImpresoOC = {},
): Promise<DatosImpresoOC> {
  verificarPermiso(sesion, 'compras.ver');
  const obtener = deps.obtenerOC ?? obtenerOC;

  // `obtenerOC` ya verifica permiso + empresa activa (A9) y deriva el total.
  const oc = await obtener(sesion, id, bd);

  return {
    empresa: sesion.nombreEmpresaActiva,
    numCompra: oc.numCompra,
    estatus: oc.estatus,
    cancelada: oc.estatus === 'cancelada',
    motivoCancelacion: oc.motivoCancelacion,
    proveedor: oc.proveedor,
    fecha: oc.fecha,
    fechaEntrega: oc.fechaEntrega,
    entregaEn: oc.entregaEn,
    observaciones: oc.observaciones,
    correspondeA: oc.correspondeA,
    facturasAmparadasLegacy: oc.facturasAmparadasLegacy,
    lineas: oc.lineas.map((l) => ({
      material: textoMaterial(l),
      cantidad: l.cantidad,
      unidad: l.unidad,
      precio: l.precio,
      importe: l.subtotal,
      folioOrden: l.folioOrden,
      matriz: l.tallas.map((t) => ({
        color: t.color,
        talla: t.etiquetaTalla,
        cantidad: t.cantidad,
      })),
    })),
    total: oc.total,
  };
}

// ── Documento PDF (react-pdf, sin JSX: `createElement`) ──────────────────────────────────────────

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
  bandaCanceladaMotivo: { fontSize: 8, marginTop: 2 },
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
  // Tabla de renglones.
  filaTabla: { flexDirection: 'row' },
  celda: {
    borderWidth: 0.5,
    borderColor: GRIS_BORDE,
    paddingVertical: 3,
    paddingHorizontal: 4,
    fontSize: 8,
  },
  celdaEncabezado: { backgroundColor: '#f1f5f9', fontFamily: 'Helvetica-Bold' },
  celdaMaterial: { flexGrow: 1, flexBasis: 0, textAlign: 'left' },
  celdaNum: { width: 52, textAlign: 'right' },
  celdaUnidad: { width: 46, textAlign: 'center' },
  celdaOrden: { width: 50, textAlign: 'center' },
  filaTotales: { backgroundColor: '#f8fafc' },
  // Sub-tabla de la matriz talla×color de un renglón.
  matrizContenedor: { marginTop: 2, marginBottom: 4, marginLeft: 8 },
  matrizTitulo: { fontSize: 7, color: GRIS, marginBottom: 1 },
  celdaMatriz: { width: 70, textAlign: 'left' },
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

/** Formatea un importe en pesos (2 decimales con separador de miles). */
function pesos(valor: number): string {
  return `$${valor.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Un campo etiqueta/valor del encabezado. */
function campo(etiqueta: string, valor: string | null, ancho = false): ReactElement {
  return h(
    View,
    { style: ancho ? estilos.campoAncho : estilos.campo, key: etiqueta },
    h(Text, { style: estilos.etiquetaCampo }, etiqueta),
    h(Text, { style: estilos.valorCampo }, valor ?? '—'),
  );
}

/** Banda roja "CANCELADA" + motivo (solo si la OC está cancelada). */
function bandaCancelada(datos: DatosImpresoOC): ReactElement | null {
  if (!datos.cancelada) {
    return null;
  }
  return h(
    View,
    { style: estilos.bandaCancelada },
    h(Text, { style: estilos.bandaCanceladaTitulo }, 'ORDEN DE COMPRA CANCELADA'),
    h(
      Text,
      { style: estilos.bandaCanceladaMotivo },
      `Motivo: ${datos.motivoCancelacion ?? 'sin especificar'}`,
    ),
  );
}

/** Sub-tabla de la matriz talla×color de un renglón (solo si el renglón la usa). */
function matrizLinea(linea: LineaImpresoOC, clave: string): ReactElement | null {
  if (linea.matriz.length === 0) {
    return null;
  }
  return h(
    View,
    { style: estilos.matrizContenedor, key: clave },
    h(Text, { style: estilos.matrizTitulo }, 'Desglose por talla y color:'),
    ...linea.matriz.map((c, i) =>
      h(
        View,
        { style: estilos.filaTabla, key: `m-${i}` },
        h(Text, { style: [estilos.celda, estilos.celdaMatriz] }, c.color),
        h(Text, { style: [estilos.celda, estilos.celdaMatriz] }, c.talla),
        h(Text, { style: [estilos.celda, estilos.celdaNum] }, String(c.cantidad)),
      ),
    ),
  );
}

/** Tabla de renglones de la OC (material, cantidad, unidad, precio, importe, orden ligada). */
function tablaLineas(datos: DatosImpresoOC): ReactElement {
  const filaEncabezado = h(
    View,
    { style: estilos.filaTabla, key: 'enc' },
    h(Text, { style: [estilos.celda, estilos.celdaEncabezado, estilos.celdaMaterial] }, 'Material'),
    h(Text, { style: [estilos.celda, estilos.celdaEncabezado, estilos.celdaNum] }, 'Cantidad'),
    h(Text, { style: [estilos.celda, estilos.celdaEncabezado, estilos.celdaUnidad] }, 'Unidad'),
    h(Text, { style: [estilos.celda, estilos.celdaEncabezado, estilos.celdaNum] }, 'Precio'),
    h(Text, { style: [estilos.celda, estilos.celdaEncabezado, estilos.celdaNum] }, 'Importe'),
    h(Text, { style: [estilos.celda, estilos.celdaEncabezado, estilos.celdaOrden] }, 'Orden'),
  );

  const filas: ReactElement[] = [];
  datos.lineas.forEach((l, i) => {
    filas.push(
      h(
        View,
        { style: estilos.filaTabla, key: `fila-${i}` },
        h(Text, { style: [estilos.celda, estilos.celdaMaterial] }, l.material),
        h(Text, { style: [estilos.celda, estilos.celdaNum] }, String(l.cantidad)),
        h(Text, { style: [estilos.celda, estilos.celdaUnidad] }, l.unidad ?? '—'),
        h(Text, { style: [estilos.celda, estilos.celdaNum] }, pesos(l.precio)),
        h(Text, { style: [estilos.celda, estilos.celdaNum] }, pesos(l.importe)),
        h(
          Text,
          { style: [estilos.celda, estilos.celdaOrden] },
          l.folioOrden === null ? '—' : String(l.folioOrden),
        ),
      ),
    );
    const matriz = matrizLinea(l, `matriz-${i}`);
    if (matriz !== null) {
      filas.push(matriz);
    }
  });

  const filaTotal = h(
    View,
    { style: [estilos.filaTabla, estilos.filaTotales], key: 'total' },
    h(
      Text,
      { style: [estilos.celda, estilos.celdaEncabezado, estilos.celdaMaterial] },
      'Total de la orden de compra',
    ),
    h(Text, { style: [estilos.celda, estilos.celdaEncabezado, estilos.celdaNum] }, ''),
    h(Text, { style: [estilos.celda, estilos.celdaEncabezado, estilos.celdaUnidad] }, ''),
    h(Text, { style: [estilos.celda, estilos.celdaEncabezado, estilos.celdaNum] }, ''),
    h(
      Text,
      { style: [estilos.celda, estilos.celdaEncabezado, estilos.celdaNum] },
      pesos(datos.total),
    ),
    h(Text, { style: [estilos.celda, estilos.celdaEncabezado, estilos.celdaOrden] }, ''),
  );

  const cuerpo =
    datos.lineas.length === 0
      ? [h(Text, { style: estilos.vacio, key: 'vacio' }, 'Sin renglones capturados.')]
      : [filaEncabezado, ...filas, filaTotal];

  return h(
    View,
    { style: estilos.seccion },
    h(Text, { style: estilos.tituloSeccion }, 'Renglones'),
    ...cuerpo,
  );
}

/** Una página = una orden de compra. */
function paginaOC(datos: DatosImpresoOC, clave: string): ReactElement {
  const hijos: (ReactElement | null)[] = [
    h(
      View,
      { style: estilos.encabezado, key: 'enc' },
      h(
        View,
        {},
        h(Text, { style: estilos.empresa }, datos.empresa),
        h(Text, { style: estilos.subtitulo }, 'Orden de compra — CONTROL v2'),
      ),
      h(
        View,
        { style: estilos.folioBloque },
        h(Text, { style: estilos.folioEtiqueta }, 'Folio'),
        h(Text, { style: estilos.folioValor }, String(datos.numCompra)),
      ),
    ),
    bandaCancelada(datos),
    h(
      View,
      { style: estilos.filaCampos, key: 'campos' },
      campo('Proveedor', datos.proveedor, true),
      campo('Estatus', datos.estatus),
      campo('Fecha', datos.fecha),
      campo('Fecha de entrega', datos.fechaEntrega),
      campo('Entregar en', datos.entregaEn, true),
      campo('Corresponde a', datos.correspondeA, true),
    ),
    datos.observaciones
      ? h(
          View,
          { style: estilos.campoAncho, key: 'obs' },
          h(Text, { style: estilos.etiquetaCampo }, 'Observaciones'),
          h(Text, { style: estilos.valorCampoTexto }, datos.observaciones),
        )
      : null,
    datos.facturasAmparadasLegacy
      ? h(
          View,
          { style: estilos.campoAncho, key: 'facturas' },
          h(Text, { style: estilos.etiquetaCampo }, 'Facturas amparadas (histórico)'),
          h(Text, { style: estilos.valorCampoTexto }, datos.facturasAmparadasLegacy),
        )
      : null,
    tablaLineas(datos),
    h(
      Text,
      { style: estilos.pie, key: 'pie', fixed: true },
      `CONTROL v2 · ${datos.empresa} · Orden de compra ${datos.numCompra} · Total ${pesos(datos.total)}`,
    ),
  ];

  return h(
    Page,
    { key: clave, size: 'A4', style: estilos.pagina },
    ...hijos.filter((x) => x !== null),
  );
}

/** Documento de UNA orden de compra. */
function documentoOC(datos: DatosImpresoOC): ReactElement<DocumentProps> {
  return h(
    Document,
    {
      title: `Orden de compra ${datos.numCompra}`,
      author: datos.empresa,
      subject: 'Orden de compra',
    },
    paginaOC(datos, 'pagina-0'),
  );
}

// ── Generación del Buffer (función pura: recibe datos resueltos) ──────────────────────────────────

/** Genera el PDF (Buffer) de una OC a partir de sus datos ya resueltos. */
export async function generarPdfOrdenCompra(datos: DatosImpresoOC): Promise<Buffer> {
  return renderToBuffer(documentoOC(datos));
}

// ── Orquestación de alto nivel (resuelve datos + genera) — la usa la ruta ─────────────────────────

/** Resultado de generar el impreso de una OC (Buffer + folio para el `filename`). */
export interface ImpresoOC {
  buffer: Buffer;
  numCompra: number;
}

/** Resuelve los datos de una OC (A9) y devuelve su PDF + el folio para el nombre del archivo. */
export async function impresoOrdenCompra(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
  deps: DepsImpresoOC = {},
): Promise<ImpresoOC> {
  const datos = await armarDatosImpresoOC(sesion, id, bd, deps);
  const buffer = await renderizarPdfEnWorker('orden-compra', datos);
  return { buffer, numCompra: datos.numCompra };
}
