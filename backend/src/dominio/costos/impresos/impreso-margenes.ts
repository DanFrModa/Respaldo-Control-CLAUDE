/**
 * Impreso PDF de COSTOS Y MÁRGENES POR PEDIDO (F7-E1, R9; doc 06-Costos-y-EDR §5). Reusa
 * {@link margenesPorPedido} (A1: la lógica NO se duplica; el ocultamiento de importes/márgenes sin
 * `consultas.ver-importes` y el scope de empresa A9 ya los aplica el dominio). Generado EN EL SERVIDOR
 * con `@react-pdf/renderer`. El Excel del mismo reporte vive en `excel-margenes.ts`.
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

import type { MargenesSalida, MargenesQuery } from '../../../contrato/index.js';
import type { SesionUsuario } from '../../../comun/permisos.js';
import { clienteLectura, type ContextoBd } from '../../../comun/transaccion.js';
import type { z } from 'zod';
import type { esquemaMargenesQuery } from '../../../contrato/index.js';

import { margenesPorPedido } from '../margenes.js';

import { pagadorDeEmpresa } from './impreso-lista-precios.js';

/** Datos resueltos del impreso (forma PURA). */
export interface DatosImpresoMargenes {
  pagador: string;
  margenes: MargenesSalida;
}

/** Dependencias inyectables (tests inyectan `margenesPorPedido` fake). */
export interface DepsImpresoMargenes {
  margenesPorPedido?: typeof margenesPorPedido;
}

/** Resuelve los datos (A9) + la razón social de la empresa activa. */
export async function armarDatosImpresoMargenes(
  sesion: SesionUsuario,
  query: z.input<typeof esquemaMargenesQuery> = {},
  bd?: ContextoBd,
  deps: DepsImpresoMargenes = {},
): Promise<DatosImpresoMargenes> {
  const obtener = deps.margenesPorPedido ?? margenesPorPedido;
  const margenes = await obtener(sesion, query, bd);
  const empresa = await clienteLectura(bd).empresa.findUnique({
    where: { id: sesion.idEmpresaActiva },
    select: { razonSocial: true, nombre: true },
  });
  const pagador = pagadorDeEmpresa(
    empresa ?? { razonSocial: null, nombre: sesion.nombreEmpresaActiva },
  );
  return { pagador, margenes };
}

const TEAL = '#0d9488';
const GRIS = '#64748b';
const GRIS_BORDE = '#e2e8f0';
const TINTA = '#0f172a';

function pesos(n: number | null): string {
  if (n === null) return '—';
  return `$${n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
/** Fracción → porcentaje legible (o "—"). */
function pct(n: number | null): string {
  if (n === null) return '—';
  return `${(n * 100).toLocaleString('es-MX', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

const estilos = StyleSheet.create({
  pagina: {
    paddingVertical: 36,
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
  empresa: { fontSize: 14, fontFamily: 'Helvetica-Bold', color: TEAL },
  subtitulo: { fontSize: 8, color: GRIS, marginTop: 2 },
  filaTabla: { flexDirection: 'row' },
  celda: {
    borderWidth: 0.5,
    borderColor: GRIS_BORDE,
    paddingVertical: 3,
    paddingHorizontal: 4,
    fontSize: 8,
  },
  celdaEncabezado: { backgroundColor: '#f1f5f9', fontFamily: 'Helvetica-Bold' },
  colChica: { width: 44 },
  colFlex: { flexGrow: 1, flexBasis: 0 },
  colNum: { width: 62, textAlign: 'right' },
  totalBloque: {
    marginTop: 14,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 24,
    borderTopWidth: 1,
    borderTopColor: TEAL,
    paddingTop: 8,
  },
  totalItem: { alignItems: 'flex-end' },
  totalValor: { fontSize: 12, fontFamily: 'Helvetica-Bold' },
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

function pagina(datos: DatosImpresoMargenes): ReactElement {
  const m = datos.margenes;
  const enc = h(
    View,
    { style: estilos.filaTabla, key: 'enc' },
    h(Text, { style: [estilos.celda, estilos.celdaEncabezado, estilos.colChica] }, 'Pedido'),
    h(Text, { style: [estilos.celda, estilos.celdaEncabezado, estilos.colFlex] }, 'Cliente'),
    h(Text, { style: [estilos.celda, estilos.celdaEncabezado, estilos.colChica] }, 'Fecha'),
    h(Text, { style: [estilos.celda, estilos.celdaEncabezado, estilos.colNum] }, 'Piezas'),
    h(Text, { style: [estilos.celda, estilos.celdaEncabezado, estilos.colNum] }, 'Importe'),
    h(Text, { style: [estilos.celda, estilos.celdaEncabezado, estilos.colNum] }, 'M. prom.'),
    h(Text, { style: [estilos.celda, estilos.celdaEncabezado, estilos.colNum] }, 'M. pond.'),
    h(Text, { style: [estilos.celda, estilos.celdaEncabezado, estilos.colNum] }, 'M. $/pza'),
  );
  const filas = m.filas.map((f, i) =>
    h(
      View,
      { style: estilos.filaTabla, key: `f-${i}`, wrap: false },
      h(Text, { style: [estilos.celda, estilos.colChica] }, `#${String(f.folio)}`),
      h(Text, { style: [estilos.celda, estilos.colFlex] }, f.cliente),
      h(Text, { style: [estilos.celda, estilos.colChica] }, f.fechaHasta ?? '—'),
      h(Text, { style: [estilos.celda, estilos.colNum] }, String(f.cantidad)),
      h(Text, { style: [estilos.celda, estilos.colNum] }, pesos(f.importe)),
      h(Text, { style: [estilos.celda, estilos.colNum] }, pct(f.margenPromedio)),
      h(Text, { style: [estilos.celda, estilos.colNum] }, pct(f.margenPonderado)),
      h(Text, { style: [estilos.celda, estilos.colNum] }, pesos(f.margenPesosPorPieza)),
    ),
  );
  return h(
    Page,
    { size: 'A4', orientation: 'landscape', style: estilos.pagina },
    h(
      View,
      { style: estilos.encabezado, key: 'enc' },
      h(
        View,
        {},
        h(Text, { style: estilos.empresa }, datos.pagador),
        h(Text, { style: estilos.subtitulo }, 'Costos y márgenes por pedido — CONTROL v2'),
      ),
    ),
    enc,
    ...(filas.length === 0
      ? [h(Text, { key: 'v', style: estilos.subtitulo }, 'Sin pedidos costeados en el periodo.')]
      : filas),
    h(
      View,
      { style: estilos.totalBloque, key: 'tot' },
      h(
        View,
        { style: estilos.totalItem, key: 'p' },
        h(Text, {}, 'Piezas'),
        h(Text, { style: estilos.totalValor }, String(m.totalPiezas)),
      ),
      h(
        View,
        { style: estilos.totalItem, key: 'i' },
        h(Text, {}, 'Importe'),
        h(Text, { style: estilos.totalValor }, pesos(m.totalImporte)),
      ),
    ),
    h(
      Text,
      { style: estilos.pie, key: 'pie', fixed: true },
      `CONTROL v2 · ${datos.pagador} · Costos y márgenes por pedido`,
    ),
  );
}

function documento(datos: DatosImpresoMargenes): ReactElement<DocumentProps> {
  return h(
    Document,
    {
      title: 'Márgenes por pedido',
      author: datos.pagador,
      subject: 'Costos y márgenes por pedido',
    },
    pagina(datos),
  );
}

/** Genera el PDF (Buffer) de los márgenes por pedido. */
export async function generarPdfMargenes(datos: DatosImpresoMargenes): Promise<Buffer> {
  return renderToBuffer(documento(datos));
}

/** Resuelve los datos (A9) y devuelve el PDF de márgenes por pedido. */
export async function impresoMargenes(
  sesion: SesionUsuario,
  query: z.input<typeof esquemaMargenesQuery> = {},
  bd?: ContextoBd,
  deps: DepsImpresoMargenes = {},
): Promise<{ buffer: Buffer }> {
  const datos = await armarDatosImpresoMargenes(sesion, query, bd, deps);
  return { buffer: await generarPdfMargenes(datos) };
}

/** Reexporta el tipo del filtro para la ruta (comodidad). */
export type { MargenesQuery };
