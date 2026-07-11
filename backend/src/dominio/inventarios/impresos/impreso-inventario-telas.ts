/**
 * Impreso 'INVENTARIO DE TELAS' (F4-E1, R9 — referencia vieja: reporte `InventariosTela`). La hoja
 * (PDF) con las existencias de tela por tela × lote × almacén (Σ de movimientos, D3), agrupada por
 * tela, con los componentes del lote (D5) listados.
 *
 * Documento generado EN EL SERVIDOR con `@react-pdf/renderer` (`renderToBuffer`), MISMO motor y
 * patrón que `produccion/impresos/impreso-entrega-cliente.ts` (A1: la ruta solo valida permiso+Zod
 * y delega). Reusa `consultarExistenciasTela` (existencias + componentes + A9: filtra por empresa
 * activa). Honra el ex-acceso #7 indirectamente: las existencias NO traen importes (solo cantidades),
 * así que el impreso de existencias es visible para todo `inventario-telas.ver` sin exponer costos.
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
import { renderizarPdfEnWorker } from '../../../comun/pdf-worker.js';
import { MAX_FILAS_PDF, leyendaTruncado } from '../../../comun/impreso-topes.js';
import { consultarExistenciasTela, type ParametrosExistenciasTela } from '../telas.js';
import type { ExistenciasTelaLista } from '../../../contrato/index.js';

// ── Datos resueltos del impreso (forma PURA: ya sin BD) ──────────────────────────────────────────

/** Una fila del impreso: una tela×lote×almacén con su existencia y los componentes del lote. */
export interface FilaImpresoTela {
  tela: string;
  loteClave: string;
  color: string;
  proveedor: string;
  factura: string;
  almacen: string;
  existencia: number;
  /** Componentes del lote (D5): "Felpa (100)", "Cardigan (40)"… para listar bajo el renglón. */
  componentes: string[];
}

/** Todo lo que necesita el impreso de inventario de telas, ya resuelto (sin BD) → función pura. */
export interface DatosImpresoInventarioTelas {
  empresa: string;
  fecha: string;
  filas: FilaImpresoTela[];
  totalRenglones: number;
  totalExistencia: number;
}

/** Proyecta la respuesta de existencias a la tabla del impreso. */
export function armarFilasImpreso(lista: ExistenciasTelaLista): FilaImpresoTela[] {
  return lista.filas.map((f) => ({
    tela: f.tela,
    loteClave: f.loteClave ?? '(sin lote)',
    color: f.color ?? '—',
    proveedor: f.proveedor ?? '—',
    factura: f.factura ?? '—',
    almacen: f.almacen,
    existencia: f.existencia,
    componentes: f.componentes.map((c) => `${c.tela} (${c.cantidad.toLocaleString('es-MX')})`),
  }));
}

/** Dependencias inyectables (los tests inyectan un `consultarExistenciasTela` fake para no tocar BD). */
export interface DepsImpresoInventarioTelas {
  consultarExistenciasTela?: typeof consultarExistenciasTela;
}

/** Resuelve los datos del impreso de inventario de telas (A9). Reusa `consultarExistenciasTela`. */
export async function armarDatosImpresoInventarioTelas(
  sesion: SesionUsuario,
  parametros: ParametrosExistenciasTela = {},
  bd?: ContextoBd,
  deps: DepsImpresoInventarioTelas = {},
): Promise<DatosImpresoInventarioTelas> {
  const consultar = deps.consultarExistenciasTela ?? consultarExistenciasTela;
  const lista = await consultar(sesion, parametros, bd);
  const todas = armarFilasImpreso(lista);
  // Blindaje: se DIBUJAN a lo más `MAX_FILAS_PDF` renglones (miles bloquearían el render), pero el
  // conteo y la Σ existencia siguen siendo del universo COMPLETO del filtro (no del truncado).
  return {
    empresa: sesion.nombreEmpresaActiva,
    fecha: new Date().toISOString().slice(0, 10),
    filas: todas.slice(0, MAX_FILAS_PDF),
    totalRenglones: todas.length,
    totalExistencia: lista.totalExistencia,
  };
}

// ── Documento PDF (react-pdf, sin JSX) ──────────────────────────────────────────────────────────

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
  bloqueFecha: { alignItems: 'flex-end' },
  etiquetaFecha: { fontSize: 8, color: GRIS, textTransform: 'uppercase' },
  valorFecha: { fontSize: 11, fontFamily: 'Helvetica-Bold' },
  filaTabla: { flexDirection: 'row' },
  celda: {
    borderWidth: 0.5,
    borderColor: GRIS_BORDE,
    paddingVertical: 3,
    paddingHorizontal: 4,
    fontSize: 8,
  },
  celdaEncabezado: { backgroundColor: '#f1f5f9', fontFamily: 'Helvetica-Bold' },
  cTela: { width: '16%' },
  cLote: { width: '14%' },
  cColor: { width: '11%' },
  cProveedor: { width: '16%' },
  cFactura: { width: '11%' },
  cAlmacen: { width: '12%' },
  cExistencia: { width: '10%', textAlign: 'right' },
  cComponentes: { width: '10%' },
  filaTotales: { backgroundColor: '#f8fafc' },
  avisoTruncado: { fontSize: 8, color: '#b45309', fontFamily: 'Helvetica-Bold', marginTop: 8 },
  vacio: { fontSize: 9, color: GRIS, marginTop: 12 },
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

/** Encabezado de la tabla de existencias. */
function filaEncabezado(): ReactElement {
  return h(
    View,
    { style: estilos.filaTabla, key: 'enc' },
    h(Text, { style: [estilos.celda, estilos.celdaEncabezado, estilos.cTela] }, 'Tela'),
    h(Text, { style: [estilos.celda, estilos.celdaEncabezado, estilos.cLote] }, 'Lote'),
    h(Text, { style: [estilos.celda, estilos.celdaEncabezado, estilos.cColor] }, 'Color'),
    h(Text, { style: [estilos.celda, estilos.celdaEncabezado, estilos.cProveedor] }, 'Proveedor'),
    h(Text, { style: [estilos.celda, estilos.celdaEncabezado, estilos.cFactura] }, 'Factura'),
    h(Text, { style: [estilos.celda, estilos.celdaEncabezado, estilos.cAlmacen] }, 'Almacén'),
    h(Text, { style: [estilos.celda, estilos.celdaEncabezado, estilos.cExistencia] }, 'Existencia'),
    h(
      Text,
      { style: [estilos.celda, estilos.celdaEncabezado, estilos.cComponentes] },
      'Componentes',
    ),
  );
}

/** Una fila de existencia de tela. */
function filaTela(f: FilaImpresoTela, i: number): ReactElement {
  return h(
    View,
    { style: estilos.filaTabla, key: `fila-${i}`, wrap: false },
    h(Text, { style: [estilos.celda, estilos.cTela] }, f.tela),
    h(Text, { style: [estilos.celda, estilos.cLote] }, f.loteClave),
    h(Text, { style: [estilos.celda, estilos.cColor] }, f.color),
    h(Text, { style: [estilos.celda, estilos.cProveedor] }, f.proveedor),
    h(Text, { style: [estilos.celda, estilos.cFactura] }, f.factura),
    h(Text, { style: [estilos.celda, estilos.cAlmacen] }, f.almacen),
    h(Text, { style: [estilos.celda, estilos.cExistencia] }, f.existencia.toLocaleString('es-MX')),
    h(Text, { style: [estilos.celda, estilos.cComponentes] }, f.componentes.join(', ') || '—'),
  );
}

/** Fila de TOTAL general. */
function filaTotal(datos: DatosImpresoInventarioTelas): ReactElement {
  return h(
    View,
    { style: [estilos.filaTabla, estilos.filaTotales], key: 'total' },
    h(
      Text,
      { style: [estilos.celda, estilos.celdaEncabezado, { width: '80%' }] },
      `Total — ${datos.totalRenglones} renglón(es)`,
    ),
    h(
      Text,
      { style: [estilos.celda, estilos.celdaEncabezado, estilos.cExistencia] },
      datos.totalExistencia.toLocaleString('es-MX'),
    ),
    h(Text, { style: [estilos.celda, estilos.celdaEncabezado, estilos.cComponentes] }, ''),
  );
}

/** La página del impreso de inventario de telas. */
function paginaInventario(datos: DatosImpresoInventarioTelas): ReactElement {
  const cuerpo =
    datos.filas.length === 0
      ? [h(Text, { style: estilos.vacio, key: 'vacio' }, 'Sin existencias de tela para mostrar.')]
      : [filaEncabezado(), ...datos.filas.map((f, i) => filaTela(f, i)), filaTotal(datos)];

  const textoTruncado = leyendaTruncado(datos.filas.length, datos.totalRenglones);
  const aviso =
    textoTruncado === null
      ? []
      : [h(Text, { style: estilos.avisoTruncado, key: 'aviso' }, textoTruncado)];

  return h(
    Page,
    { key: 'pagina', size: 'A4', orientation: 'landscape', style: estilos.pagina },
    h(
      View,
      { style: estilos.encabezado, key: 'cab' },
      h(
        View,
        {},
        h(Text, { style: estilos.empresa }, datos.empresa),
        h(
          Text,
          { style: estilos.subtitulo },
          'Inventario de telas (existencias por tela × lote × almacén) — CONTROL v2',
        ),
      ),
      h(
        View,
        { style: estilos.bloqueFecha },
        h(Text, { style: estilos.etiquetaFecha }, 'Fecha de corte'),
        h(Text, { style: estilos.valorFecha }, datos.fecha),
      ),
    ),
    ...cuerpo,
    ...aviso,
    h(
      Text,
      { style: estilos.pie, key: 'pie', fixed: true },
      `CONTROL v2 · ${datos.empresa} · Inventario de telas · ${datos.totalRenglones} renglones · ${datos.totalExistencia.toLocaleString('es-MX')} en existencia`,
    ),
  );
}

/** Documento del inventario de telas. */
function documentoInventario(datos: DatosImpresoInventarioTelas): ReactElement<DocumentProps> {
  return h(
    Document,
    { title: 'Inventario de telas', author: datos.empresa, subject: 'Inventario de telas' },
    paginaInventario(datos),
  );
}

/** Genera el PDF (Buffer) del inventario de telas a partir de sus datos resueltos. */
export async function generarPdfInventarioTelas(
  datos: DatosImpresoInventarioTelas,
): Promise<Buffer> {
  return renderToBuffer(documentoInventario(datos));
}

/** Resuelve los datos del inventario de telas (A9) y devuelve su PDF. */
export async function impresoInventarioTelas(
  sesion: SesionUsuario,
  parametros: ParametrosExistenciasTela = {},
  bd?: ContextoBd,
  deps: DepsImpresoInventarioTelas = {},
): Promise<Buffer> {
  const datos = await armarDatosImpresoInventarioTelas(sesion, parametros, bd, deps);
  return renderizarPdfEnWorker('inventario-telas', datos);
}
