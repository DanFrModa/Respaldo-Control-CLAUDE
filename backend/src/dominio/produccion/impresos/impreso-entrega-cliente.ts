/**
 * Comprobante de la ENTREGA A CLIENTE (F3-E5, R9): la hoja (PDF) que documenta la entrega de
 * producto terminado al cliente (cliente, modelo, matriz color×talla, fecha, folio). Decisión Gabriel
 * 2026-06-19: la entrega lleva comprobante imprimible (R9 que estaba "por definir").
 *
 * Documento generado EN EL SERVIDOR con `@react-pdf/renderer` (`renderToBuffer`), MISMO motor y
 * patrón que `impreso-recibo-maquila.ts` (A1: la ruta solo valida permiso+Zod y delega). Reusa
 * `obtenerEntrega` (encabezado + matriz + nombres) — A9: filtra por la empresa activa → 404 si no.
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
  BandaEstado,
} from '../../../comun/impresos-estilos.js';

import type { SesionUsuario } from '../../../comun/permisos.js';
import type { ContextoBd } from '../../../comun/transaccion.js';
import { obtenerEntrega } from '../entregas-cliente.js';
import type { EntregaClienteSalida } from '../../../contrato/index.js';

// ── Datos resueltos del impreso (forma PURA: ya sin BD) ──────────────────────────────────────────

/** Todo lo que necesita el comprobante de entrega, ya resuelto (sin BD) → función pura. */
export interface DatosImpresoEntrega {
  empresa: string;
  folio: number;
  fecha: string;
  cliente: string | null;
  modelo: string;
  almacen: string | null;
  folioOrden: number;
  observaciones: string | null;
  cancelado: boolean;
  /** Columnas: etiquetas de talla en el orden en que aparecen. */
  tallas: string[];
  /** Renglones color×talla; `cantidades[i]` alinea con `tallas[i]`. */
  renglones: { color: string; cantidades: number[]; totalFila: number }[];
  totalesColumna: number[];
  totalPiezas: number;
}

/** Proyecta la matriz de la entrega a la tabla color×talla del impreso (misma forma que el recibo). */
export function armarTablaEntrega(
  lineas: EntregaClienteSalida['lineas'],
): Pick<DatosImpresoEntrega, 'tallas' | 'renglones' | 'totalesColumna' | 'totalPiezas'> {
  const tallas: string[] = [];
  for (const linea of lineas) {
    for (const t of linea.tallas) {
      if (!tallas.includes(t.etiquetaTalla)) {
        tallas.push(t.etiquetaTalla);
      }
    }
  }

  const totalesColumna = new Array<number>(tallas.length).fill(0);
  let totalPiezas = 0;

  const renglones = lineas.map((linea) => {
    const porTalla = new Map(linea.tallas.map((t) => [t.etiquetaTalla, t.cantidad]));
    const cantidades = tallas.map((etiqueta) => porTalla.get(etiqueta) ?? 0);
    let totalFila = 0;
    cantidades.forEach((cantidad, i) => {
      totalFila += cantidad;
      totalesColumna[i] = (totalesColumna[i] ?? 0) + cantidad;
    });
    totalPiezas += totalFila;
    return { color: linea.color, cantidades, totalFila };
  });

  return { tallas, renglones, totalesColumna, totalPiezas };
}

/** Dependencias inyectables (los tests inyectan un `obtenerEntrega` fake para no tocar BD). */
export interface DepsImpresoEntrega {
  obtenerEntrega?: typeof obtenerEntrega;
}

/** Resuelve los datos del comprobante de una entrega (A9). Reusa `obtenerEntrega`. */
export async function armarDatosImpresoEntrega(
  sesion: SesionUsuario,
  idEntrega: number,
  bd?: ContextoBd,
  deps: DepsImpresoEntrega = {},
): Promise<DatosImpresoEntrega> {
  const obtener = deps.obtenerEntrega ?? obtenerEntrega;
  const entrega = await obtener(sesion, idEntrega, bd);
  const tabla = armarTablaEntrega(entrega.lineas);
  return {
    empresa: sesion.nombreEmpresaActiva,
    folio: entrega.folio,
    fecha: entrega.fecha,
    cliente: entrega.cliente,
    modelo: entrega.modelo,
    almacen: entrega.almacen,
    folioOrden: entrega.folioOrden,
    observaciones: entrega.observaciones,
    cancelado: entrega.cancelado,
    ...tabla,
  };
}

// ── Documento PDF (react-pdf, sin JSX) ──────────────────────────────────────────────────────────

const estilos = StyleSheet.create({
  // Estilos PROPIOS del comprobante (lo compartido vive en `estilosDoc`).
  colColor: { flexGrow: 1, flexBasis: 0, textAlign: 'left' },
  colTalla: { width: 34, textAlign: 'center' },
  colTotal: { width: 42, textAlign: 'center', fontFamily: FUENTE.negrita },
  notaEntrega: { marginTop: 10, fontSize: 9 },
  firmas: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 36 },
  firma: { width: '45%', borderTopWidth: 0.5, borderTopColor: PALETA.muted, paddingTop: 4 },
  firmaEtiqueta: { fontSize: 8, color: PALETA.muted, textAlign: 'center' },
});

/** Un campo etiqueta/valor del encabezado. */
function campo(etiqueta: string, valor: string | null, ancho = false): ReactElement {
  return h(
    View,
    { style: ancho ? estilosDoc.campoDosTercios : estilosDoc.campoTercio, key: etiqueta },
    h(Text, { style: estilosDoc.etiquetaCampo }, etiqueta),
    h(Text, { style: estilosDoc.valorCampo }, valor ?? '—'),
  );
}

/** Banda roja "ENTREGA CANCELADA" (solo si está cancelada). */
function bandaCancelada(datos: DatosImpresoEntrega): ReactElement | null {
  if (!datos.cancelado) {
    return null;
  }
  return BandaEstado({ titulo: 'ENTREGA CANCELADA' });
}

/** Tabla MATRIZ color×talla con totales por fila/columna y total general. */
function tablaMatriz(datos: DatosImpresoEntrega): ReactElement {
  const filaEncabezado = h(
    View,
    { style: estilosDoc.filaTabla, key: 'enc' },
    h(Text, { style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.colColor] }, 'Color'),
    ...datos.tallas.map((t, i) =>
      h(
        Text,
        { key: `th-${i}`, style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.colTalla] },
        t,
      ),
    ),
    h(Text, { style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.colTotal] }, 'Total'),
  );

  const filasColor = datos.renglones.map((r, fila) =>
    h(
      View,
      { style: estilosDoc.filaTabla, key: `fila-${fila}` },
      h(Text, { style: [estilosDoc.celda, estilos.colColor] }, r.color),
      ...r.cantidades.map((c, i) =>
        h(
          Text,
          { key: `c-${fila}-${i}`, style: [estilosDoc.celda, estilos.colTalla] },
          c === 0 ? '' : String(c),
        ),
      ),
      h(Text, { style: [estilosDoc.celda, estilos.colTotal] }, String(r.totalFila)),
    ),
  );

  const filaTotales = h(
    View,
    { style: [estilosDoc.filaTabla, estilosDoc.filaTotal], key: 'tot' },
    h(Text, { style: [estilosDoc.celda, estilosDoc.celdaTotal, estilos.colColor] }, 'Total'),
    ...datos.totalesColumna.map((c, i) =>
      h(
        Text,
        { key: `tc-${i}`, style: [estilosDoc.celda, estilosDoc.celdaTotal, estilos.colTalla] },
        String(c),
      ),
    ),
    h(
      Text,
      { style: [estilosDoc.celda, estilosDoc.celdaTotal, estilos.colTotal] },
      String(datos.totalPiezas),
    ),
  );

  const cuerpo =
    datos.renglones.length === 0
      ? [h(Text, { style: estilosDoc.vacio, key: 'vacio' }, 'Sin matriz.')]
      : [filaEncabezado, ...filasColor, filaTotales];

  return h(
    View,
    { style: estilosDoc.seccion },
    TituloSeccion('Cantidades entregadas (color × talla)'),
    ...cuerpo,
  );
}

/** Una página del comprobante de ENTREGA a cliente. */
function paginaEntrega(datos: DatosImpresoEntrega, clave: string): ReactElement {
  const hijos: (ReactElement | null)[] = [
    EncabezadoDocumento({
      empresa: datos.empresa,
      titulo: 'Comprobante de entrega a cliente — CONTROL v2',
      derecha: { etiqueta: 'Folio de entrega', valor: String(datos.folio), grande: true },
    }),
    bandaCancelada(datos),
    h(
      View,
      { style: estilosDoc.filaCampos, key: 'campos' },
      campo('Cliente', datos.cliente),
      campo('Modelo', datos.modelo),
      campo('Orden', String(datos.folioOrden)),
      campo('Fecha de entrega', datos.fecha),
      campo('Almacén de salida', datos.almacen),
    ),
    datos.observaciones
      ? h(
          View,
          { style: estilosDoc.campoDosTercios, key: 'obs' },
          h(Text, { style: estilosDoc.etiquetaCampo }, 'Observaciones / referencia'),
          h(Text, { style: estilosDoc.valorCampoTexto }, datos.observaciones),
        )
      : null,
    tablaMatriz(datos),
    h(
      Text,
      { style: estilos.notaEntrega, key: 'nota' },
      `Total entregado: ${datos.totalPiezas} piezas.`,
    ),
    h(
      View,
      { style: estilos.firmas, key: 'firmas' },
      h(View, { style: estilos.firma }, h(Text, { style: estilos.firmaEtiqueta }, 'Entregó')),
      h(
        View,
        { style: estilos.firma },
        h(Text, { style: estilos.firmaEtiqueta }, 'Recibió (cliente)'),
      ),
    ),
    PieDocumento({
      contexto: `CONTROL v2 · ${datos.empresa} · Entrega ${datos.folio} · Orden ${datos.folioOrden} · ${datos.totalPiezas} piezas`,
    }),
  ];
  return h(
    Page,
    { key: clave, size: 'A4', style: estilosDoc.pagina },
    ...hijos.filter((x) => x !== null),
  );
}

/** Documento de UNA entrega a cliente. */
function documentoEntrega(datos: DatosImpresoEntrega): ReactElement<DocumentProps> {
  return h(
    Document,
    { title: `Entrega ${datos.folio}`, author: datos.empresa, subject: 'Entrega a cliente' },
    paginaEntrega(datos, 'entrega'),
  );
}

/** Genera el PDF (Buffer) del comprobante de entrega a partir de sus datos resueltos. */
export async function generarPdfEntrega(datos: DatosImpresoEntrega): Promise<Buffer> {
  return renderToBuffer(documentoEntrega(datos));
}

/** Resultado de generar un comprobante de entrega (Buffer + folio para el `filename`). */
export interface ImpresoEntrega {
  buffer: Buffer;
  folio: number;
}

/** Resuelve los datos de la entrega (A9) y devuelve su PDF + el folio para el nombre del archivo. */
export async function impresoEntregaCliente(
  sesion: SesionUsuario,
  idEntrega: number,
  bd?: ContextoBd,
  deps: DepsImpresoEntrega = {},
): Promise<ImpresoEntrega> {
  const datos = await armarDatosImpresoEntrega(sesion, idEntrega, bd, deps);
  return {
    buffer: await renderizarPdfEnWorker('entrega-cliente', datos, {
      idEmpresa: sesion.idEmpresaActiva,
    }),
    folio: datos.folio,
  };
}
