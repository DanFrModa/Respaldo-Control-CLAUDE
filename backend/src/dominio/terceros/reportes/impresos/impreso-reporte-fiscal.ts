/**
 * Impreso PDF del REPORTE FISCAL del contador (F9-E5, R9; doc
 * `Documentacion_MJD/PROPUESTA-Finanzas-y-Proveedores.md` §2/§3.2). La vista fiscal del libro de
 * terceros (movimientos `esFiscal=true` de CxP y CxC) con su CFDI (folio, RFC, UUID, total) y los
 * totales del periodo. Documento generado EN EL SERVIDOR con `@react-pdf/renderer` (`renderToBuffer`):
 * función pura `armarDatos…` + componente + render. Reusa {@link reporteFiscal} (A1: la ruta solo
 * valida permiso + Zod y delega; A9 + `terceros.fiscal` + ocultamiento de importes ya los aplica el
 * servicio). EMPRESA = la razón social de la empresa activa (A9), nunca hardcodeada.
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

import type { esquemaReporteFiscalQuery } from '../../../../contrato/index.js';
import {
  ETIQUETAS_ORIGEN_MOVIMIENTO_TERCERO,
  type ReporteFiscalSalida,
  type OrigenMovimientoTerceroClave,
} from '../../../../contrato/index.js';
import type { z } from 'zod';
import type { SesionUsuario } from '../../../../comun/permisos.js';
import { clienteLectura, type ContextoBd } from '../../../../comun/transaccion.js';
import { renderizarPdfEnWorker } from '../../../../comun/pdf-worker.js';
import {
  estilosDoc,
  FUENTE,
  PALETA,
  EncabezadoDocumento,
  PieDocumento,
  LeyendaTruncado,
} from '../../../../comun/impresos-estilos.js';

import { reporteFiscal } from '../reportes-fiscales.js';

/** Filtros del reporte (forma de ENTRADA: la ruta pasa su query ya validada, aquí se acepta amplia). */
type FiltrosReporte = z.input<typeof esquemaReporteFiscalQuery>;

// ── Datos resueltos del impreso (forma PURA: ya sin BD) ──────────────────────────────────────────

/** Todo lo que necesita el documento del reporte fiscal, ya resuelto (sin BD). */
export interface DatosImpresoReporteFiscal {
  /** Emisor del reporte: razón social o nombre de la empresa (A9) — nunca hardcodeado. */
  empresa: string;
  reporte: ReporteFiscalSalida;
}

/** Dependencias inyectables (los tests inyectan `reporteFiscal` fake para no tocar BD). */
export interface DepsImpresoReporteFiscal {
  reporteFiscal?: typeof reporteFiscal;
}

/**
 * Resuelve los datos del reporte fiscal (A9). Para el impreso trae hasta 100 movimientos (la página
 * máxima) respetando el periodo/filtros; los totales son del periodo completo.
 */
export async function armarDatosImpresoReporteFiscal(
  sesion: SesionUsuario,
  query: FiltrosReporte,
  bd?: ContextoBd,
  deps: DepsImpresoReporteFiscal = {},
): Promise<DatosImpresoReporteFiscal> {
  const obtener = deps.reporteFiscal ?? reporteFiscal;
  const reporte = await obtener(sesion, { ...query, pagina: 1, porPagina: 100 }, bd);

  const cliente = clienteLectura(bd);
  const empresaBd = await cliente.empresa.findUnique({
    where: { id: sesion.idEmpresaActiva },
    select: { razonSocial: true, nombre: true },
  });
  const empresa = empresaBd?.razonSocial ?? empresaBd?.nombre ?? sesion.nombreEmpresaActiva;

  return { empresa, reporte };
}

// ── Documento PDF (react-pdf, sin JSX) ──────────────────────────────────────────────────────────

/** Formatea un importe en pesos (o "—" si es null). */
function pesos(n: number | null): string {
  if (n === null) {
    return '—';
  }
  return `$${n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Etiqueta legible de un origen (usa el catálogo del motor; cae al valor crudo si no lo conoce). */
function origenTexto(origen: string): string {
  return ETIQUETAS_ORIGEN_MOVIMIENTO_TERCERO[origen as OrigenMovimientoTerceroClave] ?? origen;
}

const estilos = StyleSheet.create({
  // Celda DENSA propia (el reporte fiscal lleva muchas columnas en landscape) + anchos y totales.
  celda: {
    borderWidth: 0.5,
    borderColor: PALETA.borde,
    paddingVertical: 3,
    paddingHorizontal: 3,
    fontSize: 7,
    color: PALETA.tinta,
  },
  colFolio: { width: 34 },
  colFecha: { width: 52 },
  colCuenta: { width: 30, textAlign: 'center' },
  colTercero: { flexGrow: 1, flexBasis: 0 },
  colRfc: { width: 78 },
  colUuid: { width: 132 },
  colXml: { width: 24, textAlign: 'center' },
  colNum: { width: 62, textAlign: 'right' },
  cancelado: { color: PALETA.faint, textDecoration: 'line-through' },
  totalesBloque: {
    marginTop: 14,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 24,
    borderTopWidth: 1,
    borderTopColor: PALETA.marca,
    paddingTop: 8,
  },
  totalItem: { alignItems: 'flex-end' },
  totalValor: { fontSize: 11, fontFamily: FUENTE.negrita },
  totalNeto: { fontSize: 14, fontFamily: FUENTE.negrita, color: PALETA.marca },
});

/** Tabla de movimientos fiscales. */
function tablaMovimientos(reporte: ReporteFiscalSalida): ReactElement {
  const movs = reporte.filas;
  if (movs.length === 0) {
    return h(
      View,
      { key: 'tabla' },
      h(Text, { style: estilosDoc.vacio }, 'Sin movimientos fiscales en el periodo.'),
    );
  }
  const encabezado = h(
    View,
    { style: estilosDoc.filaTabla, key: 'enc' },
    h(Text, { style: [estilos.celda, estilosDoc.celdaEncabezado, estilos.colFolio] }, 'Folio'),
    h(Text, { style: [estilos.celda, estilosDoc.celdaEncabezado, estilos.colFecha] }, 'Fecha'),
    h(Text, { style: [estilos.celda, estilosDoc.celdaEncabezado, estilos.colCuenta] }, 'Cta'),
    h(Text, { style: [estilos.celda, estilosDoc.celdaEncabezado, estilos.colTercero] }, 'Tercero'),
    h(Text, { style: [estilos.celda, estilosDoc.celdaEncabezado, estilos.colRfc] }, 'RFC'),
    h(Text, { style: [estilos.celda, estilosDoc.celdaEncabezado, estilos.colUuid] }, 'UUID (CFDI)'),
    h(Text, { style: [estilos.celda, estilosDoc.celdaEncabezado, estilos.colXml] }, 'XML'),
    h(Text, { style: [estilos.celda, estilosDoc.celdaEncabezado, estilos.colNum] }, 'Importe'),
  );
  const filas = movs.map((m, i) => {
    const estiloCelda = m.cancelado ? [estilos.celda, estilos.cancelado] : [estilos.celda];
    return h(
      View,
      { style: estilosDoc.filaTabla, key: `m-${i}`, wrap: false },
      h(Text, { style: [...estiloCelda, estilos.colFolio] }, String(m.folio)),
      h(Text, { style: [...estiloCelda, estilos.colFecha] }, m.fecha),
      h(
        Text,
        { style: [...estiloCelda, estilos.colCuenta] },
        m.tipoTercero === 'cliente' ? 'CxC' : 'CxP',
      ),
      h(
        Text,
        { style: [...estiloCelda, estilos.colTercero] },
        `${m.tercero} · ${origenTexto(m.origen)}`,
      ),
      h(Text, { style: [...estiloCelda, estilos.colRfc] }, m.rfcTercero ?? '—'),
      h(Text, { style: [...estiloCelda, estilos.colUuid] }, m.uuidCfdi ?? '(pendiente)'),
      h(Text, { style: [...estiloCelda, estilos.colXml] }, m.tieneXml ? 'Sí' : '—'),
      h(Text, { style: [...estiloCelda, estilos.colNum] }, pesos(m.monto)),
    );
  });
  return h(View, { key: 'tabla' }, encabezado, ...filas);
}

/** Bloque final con los totales del periodo. */
function bloqueTotales(reporte: ReporteFiscalSalida): ReactElement {
  const t = reporte.totales;
  return h(
    View,
    { style: estilos.totalesBloque },
    h(
      View,
      { style: estilos.totalItem, key: 'c' },
      h(Text, { style: estilosDoc.etiquetaMenor }, 'Cargos'),
      h(Text, { style: estilos.totalValor }, pesos(t.cargos)),
    ),
    h(
      View,
      { style: estilos.totalItem, key: 'a' },
      h(Text, { style: estilosDoc.etiquetaMenor }, 'Abonos'),
      h(Text, { style: estilos.totalValor }, pesos(t.abonos)),
    ),
    h(
      View,
      { style: estilos.totalItem, key: 'n' },
      h(Text, { style: estilosDoc.etiquetaMenor }, `Neto · ${String(t.movimientos)} mov.`),
      h(Text, { style: estilos.totalNeto }, pesos(t.neto)),
    ),
  );
}

/**
 * Texto del aviso de truncado, o `null` si la página ya muestra TODO el periodo. El impreso trae hasta
 * 100 movimientos (la página máxima) mientras los totales son del periodo completo: cuando hay más
 * movimientos que los mostrados, el contador vería filas que NO cuadran con el total → hay que avisarlo
 * y remitir al Excel, que sí trae el detalle completo. Pura (sin BD/react-pdf) para poder testearse.
 */
export function leyendaTruncadoTexto(
  reporte: Pick<ReporteFiscalSalida, 'total' | 'filas'>,
): string | null {
  if (reporte.total <= reporte.filas.length) {
    return null;
  }
  return `Mostrando los primeros ${String(reporte.filas.length)} de ${String(reporte.total)} movimientos — usa el export a Excel para el detalle completo.`;
}

/** Aviso visible de truncado (o `null` para no pintar nada) cuando la página no muestra todo. */
function avisoTruncado(reporte: ReporteFiscalSalida): ReactElement | null {
  const texto = leyendaTruncadoTexto(reporte);
  if (texto === null) {
    return null;
  }
  return LeyendaTruncado(texto);
}

/** Una página del reporte fiscal. */
function paginaReporte(datos: DatosImpresoReporteFiscal): ReactElement {
  const r = datos.reporte;
  const periodo = `${r.desde ?? '—'} a ${r.hasta ?? '—'}`;
  const aviso = avisoTruncado(r);
  return h(
    Page,
    { size: 'A4', orientation: 'landscape', style: estilosDoc.pagina },
    EncabezadoDocumento({
      empresa: datos.empresa,
      titulo: 'Reporte fiscal para el contador (CFDI) — CONTROL v2',
      derecha: { etiqueta: 'Periodo', valor: periodo },
    }),
    tablaMovimientos(r),
    ...(aviso === null ? [] : [aviso]),
    bloqueTotales(r),
    PieDocumento({
      contexto: `CONTROL v2 · ${datos.empresa} · Reporte fiscal ${periodo} · Solo información fiscal (sin contabilidad)`,
    }),
  );
}

/** Documento del reporte fiscal. */
function documentoReporte(datos: DatosImpresoReporteFiscal): ReactElement<DocumentProps> {
  return h(
    Document,
    {
      title: 'Reporte fiscal',
      author: datos.empresa,
      subject: 'Reporte fiscal para el contador (CFDI)',
    },
    paginaReporte(datos),
  );
}

/** Genera el PDF (Buffer) del reporte fiscal a partir de sus datos resueltos. */
export async function generarPdfReporteFiscal(datos: DatosImpresoReporteFiscal): Promise<Buffer> {
  return renderToBuffer(documentoReporte(datos));
}

/** Resultado de generar el impreso (solo el Buffer; el filename lo arma la ruta). */
export interface ImpresoReporteFiscal {
  buffer: Buffer;
}

/** Resuelve los datos (A9) y devuelve el PDF del reporte fiscal. */
export async function impresoReporteFiscal(
  sesion: SesionUsuario,
  query: FiltrosReporte,
  bd?: ContextoBd,
  deps: DepsImpresoReporteFiscal = {},
): Promise<ImpresoReporteFiscal> {
  const datos = await armarDatosImpresoReporteFiscal(sesion, query, bd, deps);
  return { buffer: await renderizarPdfEnWorker('reporte-fiscal', datos) };
}
