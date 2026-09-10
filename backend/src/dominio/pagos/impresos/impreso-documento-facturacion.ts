/**
 * ⭐ IMPRESO del **DOCUMENTO PARA FACTURAR** (fila 0.118, §Post-F9.186(k)) — la hoja que Daniel le
 * manda al proveedor ANTES de que le facture.
 *
 * Daniel: *«Nadie me factura si no le mando yo un documento con los datos con los que me tiene que
 * facturar… no al revés. Y eso debe salir del sistema.»*
 *
 * Dos documentos, un mismo motor:
 *  • **uno por renglón** — la hoja de UN pago, la que se le manda a UN proveedor;
 *  • **la corrida entera** — una hoja por cada renglón facturable, precedida (si hace falta) por la
 *    página **«No se emitieron»**, que lista a quién NO se le puede pedir factura y por qué. Esa
 *    página es la mitad útil del impreso masivo: es donde Daniel ve, de un vistazo, a quién le falta
 *    el RFC. *«Hay que AVISAR cuál falta, nunca inventarlo.»*
 *
 * Mismo patrón que el resto de impresos (`esma/impresos/impreso-recibo-pago.ts`): el hilo principal
 * resuelve los datos contra la base (`dominio/pagos/documento-facturacion.ts`) y la construcción del
 * PDF es PURA y corre en el worker (`comun/pdf-worker.ts`). La ruta sólo valida permiso y delega.
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

import type { DocumentoFacturacion } from '../../../contrato/index.js';

import {
  estilosDoc,
  EncabezadoDocumento,
  FUENTE,
  PALETA,
  PieDocumento,
  TituloSeccion,
} from '../../../comun/impresos-estilos.js';
import { renderizarPdfEnWorker } from '../../../comun/pdf-worker.js';
import type { SesionUsuario } from '../../../comun/permisos.js';
import { ErrorValidacion } from '../../../comun/errores.js';
import type { ContextoBd } from '../../../comun/transaccion.js';

import {
  datosDocumentoFacturacion,
  documentosDeCorrida,
  type DocumentosDeCorrida,
  type RenglonNoEmitido,
} from '../documento-facturacion.js';

// ── Estilos propios (lo compartido vive en `estilosDoc`) ─────────────────────────────────────────

const estilos = StyleSheet.create({
  intro: { fontSize: 10, lineHeight: 1.45, marginBottom: 12 },
  destacado: { fontFamily: FUENTE.negrita },
  /** Las dos partes (emisor / receptor) lado a lado. */
  partes: { flexDirection: 'row', gap: 14, marginBottom: 4 },
  parte: {
    flexGrow: 1,
    flexBasis: 0,
    borderWidth: 0.5,
    borderColor: PALETA.borde,
    borderRadius: 3,
    padding: 8,
  },
  parteTitulo: {
    fontSize: 8,
    fontFamily: FUENTE.negrita,
    color: PALETA.marca,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 4,
  },
  campo: { marginBottom: 4 },
  sugerido: { fontSize: 8, color: PALETA.warn, fontFamily: FUENTE.negrita },
  celdaConcepto: { flexGrow: 1, flexBasis: 0 },
  celdaImporte: { width: 110, textAlign: 'right' },
  totalGrande: { fontSize: 16, fontFamily: FUENTE.negrita, color: PALETA.marca },
  aviso: {
    fontSize: 9,
    color: PALETA.muted,
    marginTop: 14,
    borderTopWidth: 0.5,
    borderTopColor: PALETA.borde,
    paddingTop: 6,
  },
  celdaNombre: { width: 118 },
  celdaBeneficiario: { width: 118 },
  celdaMotivo: { flexGrow: 1, flexBasis: 0 },
  celdaMonto: { width: 70, textAlign: 'right' },
  faltante: { fontSize: 8, color: PALETA.muted, marginTop: 1 },
});

/** Formatea un importe en pesos (es-MX). */
function pesos(n: number): string {
  return `$${n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Un campo etiqueta/valor dentro de un bloque de parte. */
function campo(etiqueta: string, valor: string, clave: string): ReactElement {
  return h(
    View,
    { style: estilos.campo, key: clave },
    h(Text, { style: estilosDoc.etiquetaCampo }, etiqueta),
    h(Text, { style: estilosDoc.valorCampo }, valor),
  );
}

/** El bloque de una de las dos partes (quién factura / a quién se le factura). */
function bloqueParte(
  titulo: string,
  parte: DocumentoFacturacion['emisor'],
  extra: ReactElement | null,
  clave: string,
): ReactElement {
  return h(
    View,
    { style: estilos.parte, key: clave },
    h(Text, { style: estilos.parteTitulo }, titulo),
    campo('Razón social', parte.razonSocial, `${clave}-rs`),
    campo('RFC', parte.rfc, `${clave}-rfc`),
    campo('Régimen fiscal', parte.regimenFiscalSat, `${clave}-reg`),
    campo('Código postal', parte.codigoPostal, `${clave}-cp`),
    extra,
  );
}

/** La tabla de importes: subtotal, IVA EXPLÍCITO y total. Es el corazón del documento. */
function tablaImportes(doc: DocumentoFacturacion): ReactElement {
  const fila = (etiqueta: string, valor: string, clave: string, total = false): ReactElement =>
    h(
      View,
      { style: estilosDoc.filaTabla, key: clave },
      h(
        Text,
        {
          style: total
            ? [estilosDoc.celda, estilosDoc.celdaTotal, estilos.celdaConcepto]
            : [estilosDoc.celda, estilos.celdaConcepto],
        },
        etiqueta,
      ),
      h(
        Text,
        {
          style: total
            ? [estilosDoc.celda, estilosDoc.celdaTotal, estilos.celdaImporte]
            : [estilosDoc.celda, estilos.celdaImporte],
        },
        valor,
      ),
    );
  return h(
    View,
    { style: estilosDoc.seccion, key: 'importes' },
    TituloSeccion('Importes'),
    fila('Subtotal', pesos(doc.subtotal), 'subtotal'),
    fila(`IVA trasladado ${doc.tasaIvaTexto}`, pesos(doc.iva), 'iva'),
    fila('Total a facturar', pesos(doc.total), 'total', true),
    h(
      Text,
      { style: [estilos.totalGrande, { marginTop: 8 }], key: 'total-grande' },
      `${pesos(doc.total)} ${doc.moneda}`,
    ),
  );
}

/** Una página: el documento de UN pago. */
function paginaDocumento(doc: DocumentoFacturacion): ReactElement {
  const usoExtra = doc.usoCfdiSugerido
    ? h(
        Text,
        { style: estilos.sugerido, key: 'uso-sugerido' },
        'SUGERIDO (no capturado en el catálogo)',
      )
    : null;
  const hijos: (ReactElement | null)[] = [
    EncabezadoDocumento({
      empresa: doc.receptor.razonSocial,
      titulo: 'Documento para facturar — CONTROL v2',
      derecha: { etiqueta: 'Corrida', valor: `#${String(doc.folioCorrida)}`, grande: true },
    }),
    h(
      Text,
      { style: estilos.intro, key: 'intro' },
      'Éstos son los datos con los que debe emitirse la factura de este pago. ',
      h(Text, { style: estilos.destacado }, 'Factura exactamente por el total indicado abajo'),
      `, con el IVA desglosado. Pago de la semana del ${doc.semana}.`,
    ),
    h(
      View,
      { style: estilos.partes, key: 'partes' },
      bloqueParte('Emisor — quien factura', doc.emisor, null, 'emisor'),
      bloqueParte(
        'Receptor — a quien se factura',
        doc.receptor,
        h(
          View,
          { style: estilos.campo, key: 'uso' },
          h(Text, { style: estilosDoc.etiquetaCampo }, 'Uso de CFDI'),
          h(Text, { style: estilosDoc.valorCampo }, doc.usoCfdi),
          usoExtra,
        ),
        'receptor',
      ),
    ),
    h(
      View,
      { style: estilosDoc.filaCampos, key: 'campos' },
      h(
        View,
        { style: estilosDoc.campoCompleto, key: 'concepto' },
        h(Text, { style: estilosDoc.etiquetaCampo }, 'Concepto'),
        h(Text, { style: estilosDoc.valorCampoTexto }, doc.concepto),
      ),
      h(
        View,
        { style: estilosDoc.campoTercio, key: 'forma' },
        h(Text, { style: estilosDoc.etiquetaCampo }, 'Forma de pago'),
        h(Text, { style: estilosDoc.valorCampo }, `${doc.formaPagoSat} ${doc.formaPagoTexto}`),
      ),
      h(
        View,
        { style: estilosDoc.campoTercio, key: 'metodo' },
        h(Text, { style: estilosDoc.etiquetaCampo }, 'Método de pago'),
        h(Text, { style: estilosDoc.valorCampo }, `${doc.metodoPagoSat} ${doc.metodoPagoTexto}`),
      ),
      h(
        View,
        { style: estilosDoc.campoTercio, key: 'moneda' },
        h(Text, { style: estilosDoc.etiquetaCampo }, 'Moneda'),
        h(Text, { style: estilosDoc.valorCampo }, doc.moneda),
      ),
      doc.referencia === null
        ? null
        : h(
            View,
            { style: estilosDoc.campoCompleto, key: 'referencia' },
            h(Text, { style: estilosDoc.etiquetaCampo }, 'Referencia'),
            h(Text, { style: estilosDoc.valorCampoTexto }, doc.referencia),
          ),
    ),
    tablaImportes(doc),
    h(
      Text,
      { style: estilos.aviso, key: 'aviso' },
      'Este documento no es un comprobante fiscal: es la instrucción de cómo facturar este pago. ' +
        'Si algún dato de tu empresa cambió, avísanos antes de timbrar.',
    ),
    PieDocumento({
      contexto:
        `CONTROL v2 · ${doc.receptor.razonSocial} · Documento para facturar · ` +
        `corrida ${doc.semana} #${String(doc.folioCorrida)} · ${doc.nombreProveedor}`,
    }),
  ];
  return h(
    Page,
    { size: 'A4', style: estilosDoc.pagina, key: `doc-${String(doc.idRenglon)}` },
    ...hijos.filter((x) => x !== null),
  );
}

/**
 * La página **«No se emitieron»**: quién se quedó sin documento y por qué, con los faltantes
 * concretos debajo de cada uno. Va PRIMERO a propósito — es lo que hay que resolver antes de mandar
 * el resto.
 */
function paginaNoEmitidos(datos: DocumentosDeCorrida): ReactElement {
  // ⭐ DOS columnas, no una: `nombre` es con quién se contrató (el que sale en la relación) y
  // `beneficiario` es a nombre de quién iba el depósito, que en un pago partido o en uno que cobra
  // un tercero NO es la misma persona. Esta hoja se lee para saber A QUIÉN PERSEGUIR, así que
  // enseñar sólo una de las dos obliga a ir a buscar la otra a la relación ejecutable.
  const encabezado = h(
    View,
    { style: estilosDoc.filaTabla, key: 'enc' },
    h(
      Text,
      { style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.celdaNombre] },
      'Nombre',
    ),
    h(
      Text,
      { style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.celdaBeneficiario] },
      'Beneficiario',
    ),
    h(
      Text,
      { style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.celdaMotivo] },
      'Por qué no se emite',
    ),
    h(Text, { style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.celdaMonto] }, 'Monto'),
  );
  const fila = (r: RenglonNoEmitido, i: number): ReactElement =>
    h(
      View,
      { style: estilosDoc.filaTabla, key: `ne-${String(i)}` },
      h(Text, { style: [estilosDoc.celda, estilos.celdaNombre] }, r.nombre),
      h(Text, { style: [estilosDoc.celda, estilos.celdaBeneficiario] }, r.beneficiario),
      h(
        View,
        { style: [estilosDoc.celda, estilos.celdaMotivo] },
        h(Text, {}, r.motivoTexto),
        ...r.faltantes.map((f, j) =>
          h(Text, { style: estilos.faltante, key: `f-${String(j)}` }, `• ${f.texto}`),
        ),
      ),
      h(Text, { style: [estilosDoc.celda, estilos.celdaMonto] }, pesos(r.monto)),
    );
  return h(
    Page,
    { size: 'A4', style: estilosDoc.pagina, key: 'no-emitidos' },
    EncabezadoDocumento({
      empresa: datos.membrete,
      titulo: 'Documentos para facturar — CONTROL v2',
      derecha: { etiqueta: 'Corrida', valor: `#${String(datos.folioCorrida)}`, grande: true },
    }),
    h(
      Text,
      { style: estilos.intro, key: 'intro' },
      `Semana del ${datos.semana}. Se emitieron ${String(datos.documentos.length)} documento(s). ` +
        `Los siguientes ${String(datos.noEmitidos.length)} NO se pudieron emitir:`,
    ),
    encabezado,
    ...datos.noEmitidos.map(fila),
    h(
      Text,
      { style: estilos.aviso, key: 'aviso' },
      'Ningún dato fiscal se inventa: mientras falte alguno, el documento no sale. ' +
        'Los del proveedor se capturan en su ficha; los de la empresa, en Administración › Empresas.',
    ),
    PieDocumento({
      contexto: `CONTROL v2 · ${datos.membrete} · No se emitieron · corrida ${datos.semana} #${String(datos.folioCorrida)}`,
    }),
  );
}

/** Página de cortesía cuando la corrida no dio ni un documento ni un motivo (nada que pagar). */
function paginaVacia(datos: DocumentosDeCorrida): ReactElement {
  return h(
    Page,
    { size: 'A4', style: estilosDoc.pagina, key: 'vacia' },
    EncabezadoDocumento({
      empresa: datos.membrete,
      titulo: 'Documentos para facturar — CONTROL v2',
      derecha: { etiqueta: 'Corrida', valor: `#${String(datos.folioCorrida)}`, grande: true },
    }),
    h(
      Text,
      { style: estilos.intro, key: 'intro' },
      `Semana del ${datos.semana}: esta corrida no tiene ningún renglón con monto, ` +
        'así que no hay nada que facturar.',
    ),
    PieDocumento({
      contexto: `CONTROL v2 · ${datos.membrete} · corrida ${datos.semana} #${String(datos.folioCorrida)}`,
    }),
  );
}

// ── Construcción pura (la que corre en el worker) ────────────────────────────────────────────────

/** Documento PDF de UN pago. */
function documentoUno(doc: DocumentoFacturacion): ReactElement<DocumentProps> {
  return h(
    Document,
    {
      title: `Documento para facturar — corrida ${String(doc.folioCorrida)} · ${doc.nombreProveedor}`,
      author: doc.receptor.razonSocial,
      subject: 'Datos con los que se debe emitir la factura de este pago',
    },
    paginaDocumento(doc),
  );
}

/** Genera el PDF (Buffer) del documento de UN renglón. PURA: recibe los datos ya resueltos. */
export async function generarPdfDocumentoFacturacion(doc: DocumentoFacturacion): Promise<Buffer> {
  return renderToBuffer(documentoUno(doc));
}

/**
 * Genera el PDF (Buffer) de TODA la corrida: la página «No se emitieron» (si la hay) y luego una
 * hoja por documento. PURA.
 */
export async function generarPdfDocumentosCorrida(datos: DocumentosDeCorrida): Promise<Buffer> {
  const paginas: ReactElement[] = [
    ...(datos.noEmitidos.length > 0 ? [paginaNoEmitidos(datos)] : []),
    ...datos.documentos.map(paginaDocumento),
  ];
  // `Document` exige al menos una página; una corrida sin nada que pagar la merece explicada.
  if (paginas.length === 0) {
    paginas.push(paginaVacia(datos));
  }
  return renderToBuffer(
    h(
      Document,
      {
        title: `Documentos para facturar — corrida ${String(datos.folioCorrida)}`,
        author: datos.membrete,
        subject: 'Datos con los que los proveedores deben facturar los pagos de la semana',
      },
      ...paginas,
    ),
  );
}

// ── Lo que llama la ruta (resuelve datos + delega el render al worker) ───────────────────────────

/** Resultado de un impreso: el Buffer y las piezas del nombre del archivo. */
export interface ImpresoDocumentoFacturacion {
  buffer: Buffer;
  folioCorrida: number;
  /** Nombre del proveedor (documento suelto) o `null` (la corrida entera). */
  proveedor: string | null;
}

/**
 * El PDF del documento de UN renglón (mismos permisos que la relación ejecutable).
 *
 * ⚠️ Si el renglón NO es facturable **no se genera nada**: se responde 400 con el motivo. Un PDF con
 * huecos sería peor que ninguno — el proveedor intentaría timbrar con él.
 */
export async function impresoDocumentoFacturacion(
  sesion: SesionUsuario,
  idCorrida: number,
  idRenglon: number,
  bd?: ContextoBd,
): Promise<ImpresoDocumentoFacturacion> {
  const salida = await datosDocumentoFacturacion(sesion, idCorrida, idRenglon, bd);
  if (salida.documento === null) {
    const partes = [
      'No se puede emitir el documento para facturar de este renglón.',
      salida.motivoTexto,
      ...salida.faltantes.map((f) => `${f.texto}.`),
    ].filter((x): x is string => x !== null && x !== '');
    throw new ErrorValidacion(partes.join(' '));
  }
  return {
    buffer: await renderizarPdfEnWorker('documento-facturacion', salida.documento, {
      idEmpresa: sesion.idEmpresaActiva,
    }),
    folioCorrida: salida.documento.folioCorrida,
    proveedor: salida.documento.nombreProveedor,
  };
}

/**
 * El PDF de TODA la corrida: una hoja por documento, precedida de «No se emitieron» cuando alguien
 * se queda fuera. Éste **sí** sale siempre: su valor está justo en enseñar lo que falta.
 */
export async function impresoDocumentosCorrida(
  sesion: SesionUsuario,
  idCorrida: number,
  bd?: ContextoBd,
): Promise<ImpresoDocumentoFacturacion> {
  const datos = await documentosDeCorrida(sesion, idCorrida, bd);
  return {
    buffer: await renderizarPdfEnWorker('documentos-facturacion-corrida', datos, {
      idEmpresa: sesion.idEmpresaActiva,
    }),
    folioCorrida: datos.folioCorrida,
    proveedor: null,
  };
}
