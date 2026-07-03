/**
 * Impreso PDF del ESTADO DE RESULTADOS MENSUAL (F7-E2, R9; doc 06-Costos-y-EDR §4). Reusa
 * {@link calcularEdr} (A1: la lógica NO se duplica; el scope consolidado y el costo actual ya los
 * aplica el dominio). Muestra el P&L (Ventas − Costo − Gastos − Intereses + Bonif ± Otros = Resultado)
 * y los cortes por empresa y por cliente. Generado EN EL SERVIDOR con `@react-pdf/renderer`.
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

import type { EdrCalculado } from '../../../contrato/index.js';
import type { SesionUsuario } from '../../../comun/permisos.js';
import type { ContextoBd } from '../../../comun/transaccion.js';

import { calcularEdr } from '../edr.js';

import { etiquetaPeriodo, membreteConsolidado, pesos } from './comun-edr.js';

/** Datos resueltos del impreso mensual. */
export interface DatosImpresoEdrMensual {
  membrete: string;
  edr: EdrCalculado;
}

/** Dependencias inyectables (tests inyectan `calcularEdr` fake). */
export interface DepsImpresoEdrMensual {
  calcularEdr?: typeof calcularEdr;
}

/** Resuelve el EDR calculado + el membrete consolidado. */
export async function armarDatosImpresoEdrMensual(
  sesion: SesionUsuario,
  idEdr: number,
  bd?: ContextoBd,
  deps: DepsImpresoEdrMensual = {},
): Promise<DatosImpresoEdrMensual> {
  const obtener = deps.calcularEdr ?? calcularEdr;
  const edr = await obtener(sesion, idEdr, bd);
  const membrete = await membreteConsolidado(bd);
  return { membrete, edr };
}

const TEAL = '#0d9488';
const GRIS = '#64748b';
const GRIS_BORDE = '#e2e8f0';
const TINTA = '#0f172a';

const estilos = StyleSheet.create({
  pagina: {
    paddingVertical: 36,
    paddingHorizontal: 40,
    fontFamily: 'Helvetica',
    fontSize: 9,
    color: TINTA,
  },
  encabezado: {
    borderBottomWidth: 1,
    borderBottomColor: TEAL,
    paddingBottom: 8,
    marginBottom: 12,
  },
  empresa: { fontSize: 14, fontFamily: 'Helvetica-Bold', color: TEAL },
  subtitulo: { fontSize: 8, color: GRIS, marginTop: 2 },
  seccion: { fontSize: 11, fontFamily: 'Helvetica-Bold', marginTop: 12, marginBottom: 6 },
  filaResumen: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 3,
    borderBottomWidth: 0.5,
    borderBottomColor: GRIS_BORDE,
  },
  etiqueta: { fontSize: 10 },
  valor: { fontSize: 10, textAlign: 'right' },
  filaResultado: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    marginTop: 4,
    borderTopWidth: 1,
    borderTopColor: TEAL,
  },
  etiquetaResultado: { fontSize: 12, fontFamily: 'Helvetica-Bold' },
  valorResultado: { fontSize: 12, fontFamily: 'Helvetica-Bold', textAlign: 'right' },
  filaTabla: { flexDirection: 'row' },
  celda: {
    borderWidth: 0.5,
    borderColor: GRIS_BORDE,
    paddingVertical: 3,
    paddingHorizontal: 4,
    fontSize: 8,
  },
  celdaEncabezado: { backgroundColor: '#f1f5f9', fontFamily: 'Helvetica-Bold' },
  colFlex: { flexGrow: 1, flexBasis: 0 },
  colNum: { width: 90, textAlign: 'right' },
  pie: {
    position: 'absolute',
    bottom: 24,
    left: 40,
    right: 40,
    fontSize: 7,
    color: '#94a3b8',
    textAlign: 'center',
  },
});

/** Una fila etiqueta/valor del resumen. */
function filaResumen(etiqueta: string, valor: string, key: string): ReactElement {
  return h(
    View,
    { style: estilos.filaResumen, key },
    h(Text, { style: estilos.etiqueta }, etiqueta),
    h(Text, { style: estilos.valor }, valor),
  );
}

/** Tabla de cortes (empresa o cliente). */
function tablaCortes(
  titulo: string,
  cortes: EdrCalculado['cortesEmpresa'],
  prefijo: string,
): ReactElement {
  const enc = h(
    View,
    { style: estilos.filaTabla, key: 'enc' },
    h(Text, { style: [estilos.celda, estilos.celdaEncabezado, estilos.colFlex] }, titulo),
    h(Text, { style: [estilos.celda, estilos.celdaEncabezado, estilos.colNum] }, 'Ventas'),
    h(Text, { style: [estilos.celda, estilos.celdaEncabezado, estilos.colNum] }, 'Costo'),
    h(Text, { style: [estilos.celda, estilos.celdaEncabezado, estilos.colNum] }, 'Utilidad'),
  );
  const filas = cortes.map((c, i) =>
    h(
      View,
      { style: estilos.filaTabla, key: `${prefijo}-${i}`, wrap: false },
      h(Text, { style: [estilos.celda, estilos.colFlex] }, c.nombre),
      h(Text, { style: [estilos.celda, estilos.colNum] }, pesos(c.ventas)),
      h(Text, { style: [estilos.celda, estilos.colNum] }, pesos(c.costo)),
      h(Text, { style: [estilos.celda, estilos.colNum] }, pesos(c.utilidadBruta)),
    ),
  );
  return h(
    View,
    { key: prefijo },
    ...(filas.length === 0
      ? [enc, h(Text, { key: 'v', style: estilos.subtitulo }, 'Sin datos.')]
      : [enc, ...filas]),
  );
}

function pagina(datos: DatosImpresoEdrMensual): ReactElement {
  const e = datos.edr;
  const utilidadBruta = Math.round((e.ventas - e.costo) * 100) / 100;
  return h(
    Page,
    { size: 'A4', style: estilos.pagina },
    h(
      View,
      { style: estilos.encabezado, key: 'enc' },
      h(Text, { style: estilos.empresa }, datos.membrete),
      h(
        Text,
        { style: estilos.subtitulo },
        `Estado de Resultados · ${etiquetaPeriodo(e.encabezado.anio, e.encabezado.mes)} · Consolidado (costo actual)`,
      ),
    ),
    h(Text, { style: estilos.seccion, key: 's1' }, 'Resumen'),
    filaResumen('Ventas', pesos(e.ventas), 'r-ventas'),
    filaResumen('(−) Costo (actual)', pesos(e.costo), 'r-costo'),
    filaResumen('(=) Utilidad bruta', pesos(utilidadBruta), 'r-bruta'),
    filaResumen('(−) Gastos', pesos(e.gastos), 'r-gastos'),
    filaResumen('(−) Intereses', pesos(e.intereses), 'r-int'),
    filaResumen('(+) Bonificaciones', pesos(e.bonificaciones), 'r-bon'),
    filaResumen('(±) Otros', pesos(e.otros), 'r-otros'),
    h(
      View,
      { style: estilos.filaResultado, key: 'r-res' },
      h(Text, { style: estilos.etiquetaResultado }, 'Resultado'),
      h(Text, { style: estilos.valorResultado }, pesos(e.resultado)),
    ),
    ...(e.lineasSinCosto > 0
      ? [
          h(
            Text,
            { style: estilos.subtitulo, key: 'aviso' },
            `Aviso: ${e.lineasSinCosto} línea(s) sin costo (no valuadas). Revisa el costeo de sus órdenes.`,
          ),
        ]
      : []),
    h(Text, { style: estilos.seccion, key: 's2' }, 'Por empresa'),
    tablaCortes('Empresa', e.cortesEmpresa, 'emp'),
    h(Text, { style: estilos.seccion, key: 's3' }, 'Por cliente'),
    tablaCortes('Cliente', e.cortesCliente, 'cli'),
    h(
      Text,
      { style: estilos.pie, key: 'pie', fixed: true },
      `CONTROL v2 · ${datos.membrete} · Estado de Resultados`,
    ),
  );
}

function documento(datos: DatosImpresoEdrMensual): ReactElement<DocumentProps> {
  return h(
    Document,
    {
      title: `EDR ${etiquetaPeriodo(datos.edr.encabezado.anio, datos.edr.encabezado.mes)}`,
      author: datos.membrete,
      subject: 'Estado de Resultados mensual',
    },
    pagina(datos),
  );
}

/** Genera el PDF (Buffer) del EDR mensual. */
export async function generarPdfEdrMensual(datos: DatosImpresoEdrMensual): Promise<Buffer> {
  return renderToBuffer(documento(datos));
}

/** Resuelve los datos y devuelve el PDF del EDR mensual. */
export async function impresoEdrMensual(
  sesion: SesionUsuario,
  idEdr: number,
  bd?: ContextoBd,
  deps: DepsImpresoEdrMensual = {},
): Promise<{ buffer: Buffer }> {
  const datos = await armarDatosImpresoEdrMensual(sesion, idEdr, bd, deps);
  return { buffer: await generarPdfEdrMensual(datos) };
}
