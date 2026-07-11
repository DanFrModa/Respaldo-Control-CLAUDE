/**
 * Impreso del RECIBO DE PAGO a un maquilero (F6-E4, R9; ref. viejo `ReciboMaquileros`, doc 07-EsMa §4):
 * la hoja "RECIBÍ DE <EMPRESA> LA CANTIDAD DE $X POR CONCEPTO DE PAGO DE MAQUILA" que firma el maquilero.
 *
 * PAGADOR = el nombre/razón social de la EMPRESA activa (A9, decisión (h)) — NO el "SR. DANIEL MASRI"
 * hardcodeado del reporte viejo. Documento generado EN EL SERVIDOR con `@react-pdf/renderer`
 * (`renderToBuffer`), MISMO patrón que `calidad/impresos/impreso-auditoria.ts` (A1: la ruta solo valida
 * permiso+Zod y delega). Reusa `obtenerPagoMaquilero` (A9 + permiso `esma.ver-pagos`).
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
import { clienteLectura, type ContextoBd } from '../../../comun/transaccion.js';
import { obtenerPagoMaquilero } from '../pagos.js';

// ── Datos resueltos del impreso (forma PURA: ya sin BD) ──────────────────────────────────────────

/** Un renglón del detalle del pago (a qué cargo/orden se aplicó). */
export interface RenglonImpresoPago {
  folioOrden: number;
  tipoProceso: string;
  cantidad: number;
  importe: number | null;
}

/** Todo lo que necesita el documento del recibo de pago, ya resuelto (sin BD) → función pura. */
export interface DatosImpresoReciboPago {
  /** Pagador: razón social o nombre de la empresa (A9) — nunca hardcodeado. */
  pagador: string;
  folioPago: number;
  maquilero: string;
  fecha: string;
  monto: number;
  conFactura: boolean | null;
  observaciones: string | null;
  renglones: RenglonImpresoPago[];
}

/** El nombre del PAGADOR de una empresa: razón social si la tiene, si no su nombre (decisión (h)). */
export function pagadorDeEmpresa(empresa: { razonSocial: string | null; nombre: string }): string {
  return empresa.razonSocial ?? empresa.nombre;
}

/** Dependencias inyectables (los tests inyectan `obtenerPagoMaquilero` fake para no tocar BD). */
export interface DepsImpresoReciboPago {
  obtenerPagoMaquilero?: typeof obtenerPagoMaquilero;
}

/**
 * Resuelve los datos del recibo de pago (A9, vía `obtenerPagoMaquilero`). Consulta aparte el
 * nombre/razón social de la EMPRESA activa para el pagador (no viaja en la proyección del pago).
 */
export async function armarDatosImpresoReciboPago(
  sesion: SesionUsuario,
  idPago: number,
  bd?: ContextoBd,
  deps: DepsImpresoReciboPago = {},
): Promise<DatosImpresoReciboPago> {
  const obtener = deps.obtenerPagoMaquilero ?? obtenerPagoMaquilero;
  const pago = await obtener(sesion, idPago, bd);
  const cliente = clienteLectura(bd);

  const empresa = await cliente.empresa.findUnique({
    where: { id: sesion.idEmpresaActiva },
    select: { razonSocial: true, nombre: true },
  });
  const pagador = pagadorDeEmpresa(
    empresa ?? { razonSocial: null, nombre: sesion.nombreEmpresaActiva },
  );

  return {
    pagador,
    folioPago: pago.id,
    maquilero: pago.maquilero,
    fecha: pago.fecha,
    monto: pago.monto ?? 0,
    conFactura: pago.conFactura,
    observaciones: pago.observaciones,
    renglones: pago.aplicaciones.map((a) => ({
      folioOrden: a.folioOrden,
      tipoProceso: a.tipoProceso,
      cantidad: a.cantidad,
      importe: a.importe,
    })),
  };
}

// ── Documento PDF (react-pdf, sin JSX) ──────────────────────────────────────────────────────────

const TEAL = '#0d9488';
const GRIS = '#64748b';
const GRIS_BORDE = '#e2e8f0';
const TINTA = '#0f172a';

/** Formatea un importe en pesos (es-MX). */
function pesos(n: number): string {
  return `$${n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const estilos = StyleSheet.create({
  pagina: {
    paddingVertical: 36,
    paddingHorizontal: 44,
    fontFamily: 'Helvetica',
    fontSize: 10,
    color: TINTA,
  },
  encabezado: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    borderBottomWidth: 1,
    borderBottomColor: TEAL,
    paddingBottom: 8,
    marginBottom: 16,
  },
  empresa: { fontSize: 14, fontFamily: 'Helvetica-Bold', color: TEAL },
  subtitulo: { fontSize: 8, color: GRIS, marginTop: 2 },
  folioBloque: { alignItems: 'flex-end' },
  folioEtiqueta: { fontSize: 8, color: GRIS, textTransform: 'uppercase' },
  folioValor: { fontSize: 16, fontFamily: 'Helvetica-Bold' },
  parrafo: { fontSize: 11, lineHeight: 1.5, marginBottom: 14 },
  montoGrande: { fontSize: 22, fontFamily: 'Helvetica-Bold', color: TEAL, marginVertical: 8 },
  filaCampos: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 },
  campo: { width: '50%', marginBottom: 6, paddingRight: 8 },
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
  celdaOrden: { width: 80 },
  celdaProceso: { flexGrow: 1, flexBasis: 0 },
  celdaNum: { width: 70, textAlign: 'right' },
  firma: {
    marginTop: 56,
    alignItems: 'center',
  },
  lineaFirma: {
    borderTopWidth: 1,
    borderTopColor: TINTA,
    width: 240,
    marginBottom: 4,
  },
  firmaTexto: { fontSize: 9 },
  pie: {
    position: 'absolute',
    bottom: 24,
    left: 44,
    right: 44,
    fontSize: 7,
    color: '#94a3b8',
    textAlign: 'center',
  },
});

/** Un campo etiqueta/valor. */
function campo(etiqueta: string, valor: string): ReactElement {
  return h(
    View,
    { style: estilos.campo, key: etiqueta },
    h(Text, { style: estilos.etiquetaCampo }, etiqueta),
    h(Text, { style: estilos.valorCampo }, valor),
  );
}

/** Tabla de DETALLE de las aplicaciones del pago (orden, proceso, cantidad, importe). */
function tablaDetalle(datos: DatosImpresoReciboPago): ReactElement | null {
  if (datos.renglones.length === 0) {
    return null;
  }
  const encabezado = h(
    View,
    { style: estilos.filaTabla, key: 'enc' },
    h(Text, { style: [estilos.celda, estilos.celdaEncabezado, estilos.celdaOrden] }, 'Orden'),
    h(Text, { style: [estilos.celda, estilos.celdaEncabezado, estilos.celdaProceso] }, 'Proceso'),
    h(Text, { style: [estilos.celda, estilos.celdaEncabezado, estilos.celdaNum] }, 'Prendas'),
    h(Text, { style: [estilos.celda, estilos.celdaEncabezado, estilos.celdaNum] }, 'Importe'),
  );
  const filas = datos.renglones.map((r, i) =>
    h(
      View,
      { style: estilos.filaTabla, key: `r-${i}` },
      h(Text, { style: [estilos.celda, estilos.celdaOrden] }, String(r.folioOrden)),
      h(Text, { style: [estilos.celda, estilos.celdaProceso] }, r.tipoProceso),
      h(Text, { style: [estilos.celda, estilos.celdaNum] }, String(r.cantidad)),
      h(
        Text,
        { style: [estilos.celda, estilos.celdaNum] },
        r.importe === null ? '—' : pesos(r.importe),
      ),
    ),
  );
  return h(
    View,
    { style: estilos.seccion },
    h(Text, { style: estilos.tituloSeccion }, 'Detalle del pago'),
    encabezado,
    ...filas,
  );
}

/** Una página del recibo de pago. */
function paginaReciboPago(datos: DatosImpresoReciboPago): ReactElement {
  const facturaTexto =
    datos.conFactura === null ? 'Sin definir' : datos.conFactura ? 'Con factura' : 'Sin factura';
  const hijos: (ReactElement | null)[] = [
    h(
      View,
      { style: estilos.encabezado, key: 'enc' },
      h(
        View,
        {},
        h(Text, { style: estilos.empresa }, datos.pagador),
        h(Text, { style: estilos.subtitulo }, 'Recibo de pago de maquila — CONTROL v2'),
      ),
      h(
        View,
        { style: estilos.folioBloque },
        h(Text, { style: estilos.folioEtiqueta }, 'No. pago'),
        h(Text, { style: estilos.folioValor }, String(datos.folioPago)),
      ),
    ),
    h(
      Text,
      { style: estilos.parrafo, key: 'parrafo' },
      `Recibí de ${datos.pagador} la cantidad de`,
    ),
    h(Text, { style: estilos.montoGrande, key: 'monto' }, pesos(datos.monto)),
    h(Text, { style: estilos.parrafo, key: 'concepto' }, 'por concepto de PAGO DE MAQUILA.'),
    h(
      View,
      { style: estilos.filaCampos, key: 'campos' },
      campo('Maquilero', datos.maquilero),
      campo('Fecha', datos.fecha),
      campo('Facturación', facturaTexto),
      campo('Bueno por', pesos(datos.monto)),
    ),
    tablaDetalle(datos),
    datos.observaciones
      ? h(
          View,
          { style: [estilos.campo, { width: '100%' as const, marginTop: 8 }], key: 'obs' },
          h(Text, { style: estilos.etiquetaCampo }, 'Observaciones'),
          h(Text, { style: { fontSize: 9 } }, datos.observaciones),
        )
      : null,
    h(
      View,
      { style: estilos.firma, key: 'firma' },
      h(View, { style: estilos.lineaFirma }),
      h(Text, { style: estilos.firmaTexto }, `Nombre y firma — ${datos.maquilero}`),
    ),
    h(
      Text,
      { style: estilos.pie, key: 'pie', fixed: true },
      `CONTROL v2 · ${datos.pagador} · Recibo de pago ${datos.folioPago} · ${pesos(datos.monto)}`,
    ),
  ];
  return h(Page, { size: 'A4', style: estilos.pagina }, ...hijos.filter((x) => x !== null));
}

/** Documento de UN recibo de pago. */
function documentoReciboPago(datos: DatosImpresoReciboPago): ReactElement<DocumentProps> {
  return h(
    Document,
    {
      title: `Recibo de pago ${datos.folioPago}`,
      author: datos.pagador,
      subject: 'Recibo de pago de maquila',
    },
    paginaReciboPago(datos),
  );
}

/** Genera el PDF (Buffer) del recibo de pago a partir de sus datos resueltos. */
export async function generarPdfReciboPago(datos: DatosImpresoReciboPago): Promise<Buffer> {
  return renderToBuffer(documentoReciboPago(datos));
}

/** Resultado de generar un impreso de recibo de pago (Buffer + folio para el `filename`). */
export interface ImpresoReciboPago {
  buffer: Buffer;
  folio: number;
}

/** Resuelve los datos del pago (A9) y devuelve su PDF + el folio para el nombre del archivo. */
export async function impresoReciboPago(
  sesion: SesionUsuario,
  idPago: number,
  bd?: ContextoBd,
  deps: DepsImpresoReciboPago = {},
): Promise<ImpresoReciboPago> {
  const datos = await armarDatosImpresoReciboPago(sesion, idPago, bd, deps);
  return { buffer: await renderizarPdfEnWorker('esma-recibo-pago', datos), folio: datos.folioPago };
}
