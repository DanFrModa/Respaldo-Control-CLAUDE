/**
 * Impreso PDF del ESTADO DE RESULTADOS ANUAL (F7-E2, R9; doc 06-Costos-y-EDR §4 "EDR por año"). Reusa
 * {@link edrPorAnio} (A1). Comparativo mensual (ventas/costo/gastos/resultado por mes) + totales + el
 * corte por empresa del año. Generado EN EL SERVIDOR con `@react-pdf/renderer`.
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

import type { EdrPorAnioSalida } from '../../../contrato/index.js';
import type { SesionUsuario } from '../../../comun/permisos.js';
import type { ContextoBd } from '../../../comun/transaccion.js';

import { edrPorAnio } from '../edr.js';

import { MESES_ES, membreteConsolidado, pesos } from './comun-edr.js';

/** Datos resueltos del impreso anual. */
export interface DatosImpresoEdrAnual {
  membrete: string;
  anual: EdrPorAnioSalida;
}

/** Dependencias inyectables (tests inyectan `edrPorAnio` fake). */
export interface DepsImpresoEdrAnual {
  edrPorAnio?: typeof edrPorAnio;
}

/** Resuelve el comparativo anual + el membrete consolidado. */
export async function armarDatosImpresoEdrAnual(
  sesion: SesionUsuario,
  anio: number,
  bd?: ContextoBd,
  deps: DepsImpresoEdrAnual = {},
): Promise<DatosImpresoEdrAnual> {
  const obtener = deps.edrPorAnio ?? edrPorAnio;
  const anual = await obtener(sesion, anio, bd);
  const membrete = await membreteConsolidado(bd);
  return { membrete, anual };
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
  encabezado: { borderBottomWidth: 1, borderBottomColor: TEAL, paddingBottom: 8, marginBottom: 12 },
  empresa: { fontSize: 14, fontFamily: 'Helvetica-Bold', color: TEAL },
  subtitulo: { fontSize: 8, color: GRIS, marginTop: 2 },
  seccion: { fontSize: 11, fontFamily: 'Helvetica-Bold', marginTop: 12, marginBottom: 6 },
  filaTabla: { flexDirection: 'row' },
  celda: {
    borderWidth: 0.5,
    borderColor: GRIS_BORDE,
    paddingVertical: 3,
    paddingHorizontal: 4,
    fontSize: 8,
  },
  celdaEncabezado: { backgroundColor: '#f1f5f9', fontFamily: 'Helvetica-Bold' },
  celdaTotal: { backgroundColor: '#f8fafc', fontFamily: 'Helvetica-Bold' },
  colMes: { width: 74 },
  colFlex: { flexGrow: 1, flexBasis: 0 },
  colNum: { width: 80, textAlign: 'right' },
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

function pagina(datos: DatosImpresoEdrAnual): ReactElement {
  const a = datos.anual;
  const enc = h(
    View,
    { style: estilos.filaTabla, key: 'enc' },
    h(Text, { style: [estilos.celda, estilos.celdaEncabezado, estilos.colMes] }, 'Mes'),
    h(Text, { style: [estilos.celda, estilos.celdaEncabezado, estilos.colNum] }, 'Ventas'),
    h(Text, { style: [estilos.celda, estilos.celdaEncabezado, estilos.colNum] }, 'Costo'),
    h(Text, { style: [estilos.celda, estilos.celdaEncabezado, estilos.colNum] }, 'Gastos'),
    h(Text, { style: [estilos.celda, estilos.celdaEncabezado, estilos.colNum] }, 'Resultado'),
  );
  const filas = a.meses.map((m, i) =>
    h(
      View,
      { style: estilos.filaTabla, key: `m-${i}`, wrap: false },
      h(Text, { style: [estilos.celda, estilos.colMes] }, MESES_ES[m.mes] ?? String(m.mes)),
      h(Text, { style: [estilos.celda, estilos.colNum] }, pesos(m.ventas)),
      h(Text, { style: [estilos.celda, estilos.colNum] }, pesos(m.costo)),
      h(Text, { style: [estilos.celda, estilos.colNum] }, pesos(m.gastos)),
      h(Text, { style: [estilos.celda, estilos.colNum] }, pesos(m.resultado)),
    ),
  );
  const total = h(
    View,
    { style: estilos.filaTabla, key: 'total' },
    h(Text, { style: [estilos.celda, estilos.celdaTotal, estilos.colMes] }, 'TOTAL'),
    h(Text, { style: [estilos.celda, estilos.celdaTotal, estilos.colNum] }, pesos(a.totalVentas)),
    h(Text, { style: [estilos.celda, estilos.celdaTotal, estilos.colNum] }, pesos(a.totalCosto)),
    h(Text, { style: [estilos.celda, estilos.celdaTotal, estilos.colNum] }, ''),
    h(
      Text,
      { style: [estilos.celda, estilos.celdaTotal, estilos.colNum] },
      pesos(a.totalResultado),
    ),
  );

  const encEmp = h(
    View,
    { style: estilos.filaTabla, key: 'enc-emp' },
    h(Text, { style: [estilos.celda, estilos.celdaEncabezado, estilos.colFlex] }, 'Empresa'),
    h(Text, { style: [estilos.celda, estilos.celdaEncabezado, estilos.colNum] }, 'Ventas'),
    h(Text, { style: [estilos.celda, estilos.celdaEncabezado, estilos.colNum] }, 'Costo'),
    h(Text, { style: [estilos.celda, estilos.celdaEncabezado, estilos.colNum] }, 'Utilidad'),
  );
  const filasEmp = a.porEmpresa.map((c, i) =>
    h(
      View,
      { style: estilos.filaTabla, key: `e-${i}`, wrap: false },
      h(Text, { style: [estilos.celda, estilos.colFlex] }, c.empresa),
      h(Text, { style: [estilos.celda, estilos.colNum] }, pesos(c.ventas)),
      h(Text, { style: [estilos.celda, estilos.colNum] }, pesos(c.costo)),
      h(Text, { style: [estilos.celda, estilos.colNum] }, pesos(c.utilidadBruta)),
    ),
  );

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
        `Estado de Resultados ${a.anio} · Comparativo mensual · Consolidado (costo actual)`,
      ),
    ),
    h(Text, { style: estilos.seccion, key: 's1' }, 'Por mes'),
    ...(a.meses.length === 0
      ? [h(Text, { key: 'v', style: estilos.subtitulo }, 'Sin meses generados en el año.')]
      : [enc, ...filas, total]),
    h(Text, { style: estilos.seccion, key: 's2' }, 'Por empresa (año)'),
    ...(a.porEmpresa.length === 0 ? [] : [encEmp, ...filasEmp]),
    h(
      Text,
      { style: estilos.pie, key: 'pie', fixed: true },
      `CONTROL v2 · ${datos.membrete} · Estado de Resultados ${a.anio}`,
    ),
  );
}

function documento(datos: DatosImpresoEdrAnual): ReactElement<DocumentProps> {
  return h(
    Document,
    {
      title: `EDR ${datos.anual.anio}`,
      author: datos.membrete,
      subject: 'Estado de Resultados anual',
    },
    pagina(datos),
  );
}

/** Genera el PDF (Buffer) del EDR anual. */
export async function generarPdfEdrAnual(datos: DatosImpresoEdrAnual): Promise<Buffer> {
  return renderToBuffer(documento(datos));
}

/** Resuelve los datos y devuelve el PDF del EDR anual. */
export async function impresoEdrAnual(
  sesion: SesionUsuario,
  anio: number,
  bd?: ContextoBd,
  deps: DepsImpresoEdrAnual = {},
): Promise<{ buffer: Buffer }> {
  const datos = await armarDatosImpresoEdrAnual(sesion, anio, bd, deps);
  return { buffer: await generarPdfEdrAnual(datos) };
}
