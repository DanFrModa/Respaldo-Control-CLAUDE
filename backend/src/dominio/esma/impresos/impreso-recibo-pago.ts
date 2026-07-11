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
import {
  estilosDoc,
  FUENTE,
  PALETA,
  EncabezadoDocumento,
  PieDocumento,
  TituloSeccion,
} from '../../../comun/impresos-estilos.js';

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

/** Formatea un importe en pesos (es-MX). */
function pesos(n: number): string {
  return `$${n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const estilos = StyleSheet.create({
  // Estilos PROPIOS del recibo (lo compartido vive en `estilosDoc`).
  parrafo: { fontSize: 11, lineHeight: 1.5, marginBottom: 14 },
  montoGrande: { fontSize: 22, fontFamily: FUENTE.negrita, color: PALETA.marca, marginVertical: 8 },
  campo: { width: '50%', marginBottom: 6, paddingRight: 8 },
  celdaOrden: { width: 80 },
  celdaProceso: { flexGrow: 1, flexBasis: 0 },
  celdaNum: { width: 70, textAlign: 'right' },
  firma: { marginTop: 56, alignItems: 'center' },
  lineaFirma: { borderTopWidth: 1, borderTopColor: PALETA.tinta, width: 240, marginBottom: 4 },
  firmaTexto: { fontSize: 9 },
});

/** Un campo etiqueta/valor. */
function campo(etiqueta: string, valor: string): ReactElement {
  return h(
    View,
    { style: estilos.campo, key: etiqueta },
    h(Text, { style: estilosDoc.etiquetaCampo }, etiqueta),
    h(Text, { style: estilosDoc.valorCampo }, valor),
  );
}

/** Tabla de DETALLE de las aplicaciones del pago (orden, proceso, cantidad, importe). */
function tablaDetalle(datos: DatosImpresoReciboPago): ReactElement | null {
  if (datos.renglones.length === 0) {
    return null;
  }
  const encabezado = h(
    View,
    { style: estilosDoc.filaTabla, key: 'enc' },
    h(Text, { style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.celdaOrden] }, 'Orden'),
    h(
      Text,
      { style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.celdaProceso] },
      'Proceso',
    ),
    h(Text, { style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.celdaNum] }, 'Prendas'),
    h(Text, { style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.celdaNum] }, 'Importe'),
  );
  const filas = datos.renglones.map((r, i) =>
    h(
      View,
      { style: estilosDoc.filaTabla, key: `r-${i}` },
      h(Text, { style: [estilosDoc.celda, estilos.celdaOrden] }, String(r.folioOrden)),
      h(Text, { style: [estilosDoc.celda, estilos.celdaProceso] }, r.tipoProceso),
      h(Text, { style: [estilosDoc.celda, estilos.celdaNum] }, String(r.cantidad)),
      h(
        Text,
        { style: [estilosDoc.celda, estilos.celdaNum] },
        r.importe === null ? '—' : pesos(r.importe),
      ),
    ),
  );
  return h(
    View,
    { style: estilosDoc.seccion },
    TituloSeccion('Detalle del pago'),
    encabezado,
    ...filas,
  );
}

/** Una página del recibo de pago. */
function paginaReciboPago(datos: DatosImpresoReciboPago): ReactElement {
  const facturaTexto =
    datos.conFactura === null ? 'Sin definir' : datos.conFactura ? 'Con factura' : 'Sin factura';
  const hijos: (ReactElement | null)[] = [
    EncabezadoDocumento({
      empresa: datos.pagador,
      titulo: 'Recibo de pago de maquila — CONTROL v2',
      derecha: { etiqueta: 'No. pago', valor: String(datos.folioPago), grande: true },
    }),
    h(
      Text,
      { style: estilos.parrafo, key: 'parrafo' },
      `Recibí de ${datos.pagador} la cantidad de`,
    ),
    h(Text, { style: estilos.montoGrande, key: 'monto' }, pesos(datos.monto)),
    h(Text, { style: estilos.parrafo, key: 'concepto' }, 'por concepto de PAGO DE MAQUILA.'),
    h(
      View,
      { style: estilosDoc.filaCampos, key: 'campos' },
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
          h(Text, { style: estilosDoc.etiquetaCampo }, 'Observaciones'),
          h(Text, { style: { fontSize: 9 } }, datos.observaciones),
        )
      : null,
    h(
      View,
      { style: estilos.firma, key: 'firma' },
      h(View, { style: estilos.lineaFirma }),
      h(Text, { style: estilos.firmaTexto }, `Nombre y firma — ${datos.maquilero}`),
    ),
    PieDocumento({
      contexto: `CONTROL v2 · ${datos.pagador} · Recibo de pago ${datos.folioPago} · ${pesos(datos.monto)}`,
    }),
  ];
  return h(Page, { size: 'A4', style: estilosDoc.pagina }, ...hijos.filter((x) => x !== null));
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
