/**
 * Impreso de la EXPLOSIÓN de materiales de una orden (F4-E4, R9 — REQUISITOS-NUEVOS.md §R3). El PDF
 * que resume QUÉ y CUÁNTO material hay que comprar para una orden, agrupado por proveedor sugerido,
 * con el neteo de genéricos visible (decisión (d)). Documento generado EN EL SERVIDOR con
 * `@react-pdf/renderer` (`renderToBuffer`), el mismo motor que los demás impresos del sistema. El
 * frontend solo abre el blob.
 *
 * Innegociables aplicados:
 *  • A1 — TODO el armado vive aquí (dominio); la ruta solo valida permiso+Zod y delega.
 *  • A4/A9 — la autorización y el filtro por empresa los hace `explosionarOrden` (`compras.ver`).
 *  • REUSO — los datos se arman con `explosionarOrden` (el mismo cálculo de la pantalla); el impreso
 *    es una vista del mismo dato, NO recalcula nada.
 *
 * `armarDatosImpresoExplosion` resuelve (única parte que toca BD) y `generarPdfExplosion` recibe los
 * datos ya resueltos (testeable sin BD). `explosionarOrden` es un seam inyectable para los tests.
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

import { verificarPermiso, type SesionUsuario } from '../../../comun/permisos.js';
import { type ContextoBd } from '../../../comun/transaccion.js';
import { explosionarOrden } from '../mrp.js';

// ── Datos resueltos del impreso (forma PURA: ya sin BD) ──────────────────────────────────────────

/** Un renglón de la explosión para imprimir. */
export interface LineaImpresoExplosion {
  material: string;
  requerido: number;
  unidad: string | null;
  esGenerico: boolean;
  existenciaStock: number;
  aComprar: number;
  precioSugerido: number | null;
}

/** Un grupo de materiales por proveedor sugerido. */
export interface GrupoImpresoExplosion {
  proveedor: string;
  lineas: LineaImpresoExplosion[];
}

/** Todo lo que necesita el PDF de explosión, ya RESUELTO (sin BD). */
export interface DatosImpresoExplosion {
  empresa: string;
  folioOrden: number;
  modelo: string;
  totalPiezas: number;
  grupos: GrupoImpresoExplosion[];
}

// ── Resolución de datos (lo único que toca BD) ───────────────────────────────────────────────────

/** Dependencias inyectables (los tests pasan un fake para no tocar la BD). */
export interface DepsImpresoExplosion {
  explosionarOrden?: typeof explosionarOrden;
}

/**
 * Resuelve los datos del impreso de explosión (A9: por la empresa activa). Reúsa `explosionarOrden`
 * (mismo cálculo de la pantalla). Lanza `ErrorNoEncontrado` (404) si la orden no es de la empresa.
 */
export async function armarDatosImpresoExplosion(
  sesion: SesionUsuario,
  idOrden: number,
  bd?: ContextoBd,
  deps: DepsImpresoExplosion = {},
): Promise<DatosImpresoExplosion> {
  verificarPermiso(sesion, 'compras.ver');
  const explosionar = deps.explosionarOrden ?? explosionarOrden;
  const ex = await explosionar(sesion, idOrden, bd);

  return {
    empresa: sesion.nombreEmpresaActiva,
    folioOrden: ex.folioOrden,
    modelo: ex.modelo,
    totalPiezas: ex.totalPiezas,
    grupos: ex.grupos.map((g) => ({
      proveedor: g.proveedor,
      lineas: g.renglones.map((r) => ({
        material: r.material,
        requerido: r.cantidadRequerida,
        unidad: r.unidad,
        esGenerico: r.esGenerico,
        existenciaStock: r.existenciaStock,
        aComprar: r.cantidadAComprar,
        precioSugerido: r.precioSugerido,
      })),
    })),
  };
}

// ── Documento PDF (react-pdf, sin JSX: `createElement`) ──────────────────────────────────────────

const TEAL = '#0d9488';
const GRIS = '#64748b';
const GRIS_BORDE = '#e2e8f0';
const TINTA = '#0f172a';

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
  grupo: { marginTop: 10 },
  tituloGrupo: {
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
  celdaMaterial: { flexGrow: 1, flexBasis: 0, textAlign: 'left' },
  celdaNum: { width: 56, textAlign: 'right' },
  celdaUnidad: { width: 40, textAlign: 'center' },
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

/** Formatea una cantidad (hasta 4 decimales, sin ceros sobrantes). */
function num(valor: number): string {
  return valor.toLocaleString('es-MX', { maximumFractionDigits: 4 });
}

/** Un campo etiqueta/valor del encabezado. */
function campo(etiqueta: string, valor: string): ReactElement {
  return h(
    View,
    { style: estilos.campo, key: etiqueta },
    h(Text, { style: estilos.etiquetaCampo }, etiqueta),
    h(Text, { style: estilos.valorCampo }, valor),
  );
}

/** Tabla de un grupo de proveedor. */
function tablaGrupo(grupo: GrupoImpresoExplosion, idx: number): ReactElement {
  const filaEncabezado = h(
    View,
    { style: estilos.filaTabla, key: 'enc' },
    h(Text, { style: [estilos.celda, estilos.celdaEncabezado, estilos.celdaMaterial] }, 'Material'),
    h(Text, { style: [estilos.celda, estilos.celdaEncabezado, estilos.celdaNum] }, 'Requerido'),
    h(Text, { style: [estilos.celda, estilos.celdaEncabezado, estilos.celdaUnidad] }, 'Un.'),
    h(Text, { style: [estilos.celda, estilos.celdaEncabezado, estilos.celdaNum] }, 'En stock'),
    h(Text, { style: [estilos.celda, estilos.celdaEncabezado, estilos.celdaNum] }, 'A comprar'),
  );
  const filas = grupo.lineas.map((l, i) =>
    h(
      View,
      { style: estilos.filaTabla, key: `f-${i}` },
      h(
        Text,
        { style: [estilos.celda, estilos.celdaMaterial] },
        `${l.material}${l.esGenerico ? ' (genérico)' : ''}`,
      ),
      h(Text, { style: [estilos.celda, estilos.celdaNum] }, num(l.requerido)),
      h(Text, { style: [estilos.celda, estilos.celdaUnidad] }, l.unidad ?? '—'),
      h(Text, { style: [estilos.celda, estilos.celdaNum] }, l.esGenerico ? num(l.existenciaStock) : '—'),
      h(Text, { style: [estilos.celda, estilos.celdaNum] }, num(l.aComprar)),
    ),
  );
  return h(
    View,
    { style: estilos.grupo, key: `g-${idx}` },
    h(Text, { style: estilos.tituloGrupo }, grupo.proveedor),
    filaEncabezado,
    ...filas,
  );
}

/** Página = la explosión de una orden. */
function paginaExplosion(datos: DatosImpresoExplosion): ReactElement {
  const cuerpo: ReactElement[] =
    datos.grupos.length === 0
      ? [h(Text, { style: estilos.vacio, key: 'vacio' }, 'La orden no requiere materiales (BOM vacío o sin piezas).')]
      : datos.grupos.map((g, i) => tablaGrupo(g, i));

  return h(
    Page,
    { key: 'pagina-0', size: 'A4', style: estilos.pagina },
    h(
      View,
      { style: estilos.encabezado, key: 'enc' },
      h(
        View,
        {},
        h(Text, { style: estilos.empresa }, datos.empresa),
        h(Text, { style: estilos.subtitulo }, 'Explosión de materiales (MRP) — CONTROL v2'),
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
      campo('Modelo', datos.modelo),
      campo('Total de piezas', num(datos.totalPiezas)),
    ),
    ...cuerpo,
    h(
      Text,
      { style: estilos.pie, key: 'pie', fixed: true },
      `CONTROL v2 · ${datos.empresa} · Explosión de la orden ${datos.folioOrden}`,
    ),
  );
}

/** Documento de UNA explosión. */
function documentoExplosion(datos: DatosImpresoExplosion): ReactElement<DocumentProps> {
  return h(
    Document,
    {
      title: `Explosión de la orden ${datos.folioOrden}`,
      author: datos.empresa,
      subject: 'Explosión de materiales',
    },
    paginaExplosion(datos),
  );
}

// ── Generación del Buffer (función pura: recibe datos resueltos) ──────────────────────────────────

/** Genera el PDF (Buffer) de la explosión a partir de sus datos ya resueltos. */
export async function generarPdfExplosion(datos: DatosImpresoExplosion): Promise<Buffer> {
  return renderToBuffer(documentoExplosion(datos));
}

// ── Orquestación de alto nivel (resuelve datos + genera) — la usa la ruta ─────────────────────────

/** Resultado de generar el impreso de explosión (Buffer + folio para el `filename`). */
export interface ImpresoExplosion {
  buffer: Buffer;
  folioOrden: number;
}

/** Resuelve los datos de la explosión (A9) y devuelve su PDF + el folio para el nombre del archivo. */
export async function impresoExplosion(
  sesion: SesionUsuario,
  idOrden: number,
  bd?: ContextoBd,
  deps: DepsImpresoExplosion = {},
): Promise<ImpresoExplosion> {
  const datos = await armarDatosImpresoExplosion(sesion, idOrden, bd, deps);
  const buffer = await generarPdfExplosion(datos);
  return { buffer, folioOrden: datos.folioOrden };
}
