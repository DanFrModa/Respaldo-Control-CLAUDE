/**
 * ⭐ Impreso "COTIZACIÓN" (V1-E7c, §Post-F9.109; R9) — **el punto de toda la etapa**: es lo ÚNICO
 * que ve el cliente. La hoja lleva membrete, folio, cliente + departamento, fecha, un renglón por
 * modelo (nuestro código, descripción, su número de catálogo y el precio ofrecido) y el total.
 *
 * 🔴 Imprime **valores CONGELADOS**: cada renglón trae el precio y la descripción tal como estaban al
 * emitir, copiados en `cotizacion_linea`. Reimprimir la cotización de marzo en mayo debe dar
 * EXACTAMENTE el mismo papel aunque la lista se haya seguido negociando — si el PDF releyera la lista,
 * el documento mentiría sobre lo que se le mandó al cliente. Por eso reusa `obtenerCotizacion` (que
 * proyecta desde las columnas del documento) y NO toca `obtenerLista`.
 *
 * Una cotización CANCELADA se sigue pudiendo imprimir, con su banda roja y el motivo: lo que se mandó
 * el 12 de marzo se mandó; cancelar dice que ya no está vigente, no que no pasó (D3).
 *
 * Documento generado EN EL SERVIDOR con `@react-pdf/renderer`, MISMO motor/patrón que su vecino
 * `impreso-lista-precios.ts` (A1: la ruta sólo valida permiso + Zod y delega; A9: `obtenerCotizacion`
 * filtra por la empresa activa → 404 si la cotización no es de la empresa). La ruta EXIGE
 * `consultas.ver-importes`, así que en este camino los precios siempre llegan (el impreso ES precios).
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
  PALETA,
  BandaEstado,
  EncabezadoDocumento,
  PieDocumento,
  TituloSeccion,
} from '../../../comun/impresos-estilos.js';

import type { SesionUsuario } from '../../../comun/permisos.js';
import type { ContextoBd } from '../../../comun/transaccion.js';
import { ESTADO_CANCELADA, obtenerCotizacion } from '../cotizaciones.js';

/** Un modelo ofrecido, ya proyectado para el PDF (todo congelado). */
export interface RenglonCotizacionImpreso {
  codigoModelo: string;
  descripcionModelo: string | null;
  numeroCliente: string | null;
  /** Precio unitario OFRECIDO (congelado). Null sólo si no hubo importes. */
  precio: number | null;
}

/** Todo lo que necesita el impreso de la cotización, ya resuelto (sin BD) → función pura. */
export interface DatosImpresoCotizacion {
  empresa: string;
  folio: number;
  folioLista: number;
  cliente: string;
  departamento: string;
  fecha: string;
  cancelada: boolean;
  motivoCancelacion: string | null;
  notas: string | null;
  renglones: RenglonCotizacionImpreso[];
  total: number | null;
}

/** Dependencias inyectables (los tests inyectan un `obtenerCotizacion` fake para no tocar BD). */
export interface DepsImpresoCotizacion {
  obtenerCotizacion?: typeof obtenerCotizacion;
}

/**
 * Resuelve los datos del impreso (A9). Reusa `obtenerCotizacion`, que ya proyecta desde las columnas
 * CONGELADAS del documento — aquí no se consulta la lista ni el modelo por ningún lado, a propósito.
 */
export async function armarDatosImpresoCotizacion(
  sesion: SesionUsuario,
  idCotizacion: number,
  bd?: ContextoBd,
  deps: DepsImpresoCotizacion = {},
): Promise<DatosImpresoCotizacion> {
  const obtener = deps.obtenerCotizacion ?? obtenerCotizacion;
  const cotizacion = await obtener(sesion, idCotizacion, bd);

  return {
    empresa: sesion.nombreEmpresaActiva,
    folio: cotizacion.folio,
    folioLista: cotizacion.folioLista,
    cliente: cotizacion.nombreCliente,
    departamento: cotizacion.nombreDepartamento,
    fecha: cotizacion.fecha,
    cancelada: cotizacion.estado === ESTADO_CANCELADA,
    motivoCancelacion: cotizacion.motivoCancelacion,
    notas: cotizacion.notas,
    renglones: cotizacion.lineas.map((l) => ({
      codigoModelo: l.codigoModelo,
      descripcionModelo: l.descripcionModelo,
      numeroCliente: l.numeroCliente,
      precio: l.precioUnit,
    })),
    total: cotizacion.total,
  };
}

// ── Documento PDF (react-pdf, sin JSX) ──────────────────────────────────────────────────────────

/** Formatea un precio a "$1,234.00" (MXN) o "—" si null. */
function formatearPrecio(precio: number | null): string {
  if (precio === null) {
    return '—';
  }
  return `$${precio.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const estilos = StyleSheet.create({
  // Estilos PROPIOS de la cotización (lo compartido vive en `estilosDoc`).
  celdaModelo: { width: 95, textAlign: 'left' },
  celdaDescripcion: { flexGrow: 1, flexBasis: 0, textAlign: 'left' },
  celdaNumero: { width: 95, textAlign: 'left' },
  celdaPrecio: { width: 80, textAlign: 'right' },
  notas: { fontSize: 8, color: PALETA.muted, marginTop: 8 },
  vigencia: { fontSize: 7.5, color: PALETA.faint, marginTop: 10 },
});

/** Un campo etiqueta/valor del encabezado. */
function campo(etiqueta: string, valor: string): ReactElement {
  return h(
    View,
    { style: estilosDoc.campoTercio, key: etiqueta },
    h(Text, { style: estilosDoc.etiquetaCampo }, etiqueta),
    h(Text, { style: estilosDoc.valorCampo }, valor === '' ? '—' : valor),
  );
}

/**
 * Tabla de los MODELOS ofrecidos (modelo / descripción / nº del cliente / precio) + fila de total.
 * Van TODOS los de la cotización: el documento se lee solo, sin la vuelta anterior al lado.
 */
function tablaRenglones(datos: DatosImpresoCotizacion): ReactElement {
  const filaEncabezado = h(
    View,
    { style: estilosDoc.filaTabla, key: 'enc' },
    h(
      Text,
      { style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.celdaModelo] },
      'Modelo',
    ),
    h(
      Text,
      { style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.celdaDescripcion] },
      'Descripción',
    ),
    h(
      Text,
      { style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.celdaNumero] },
      'Su número',
    ),
    h(
      Text,
      { style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.celdaPrecio] },
      'Precio unitario',
    ),
  );

  const filas = datos.renglones.map((r, i) =>
    h(
      View,
      { style: estilosDoc.filaTabla, key: `fila-${i}`, wrap: false },
      h(Text, { style: [estilosDoc.celda, estilos.celdaModelo] }, r.codigoModelo),
      h(Text, { style: [estilosDoc.celda, estilos.celdaDescripcion] }, r.descripcionModelo ?? '—'),
      h(Text, { style: [estilosDoc.celda, estilos.celdaNumero] }, r.numeroCliente ?? '—'),
      h(Text, { style: [estilosDoc.celda, estilos.celdaPrecio] }, formatearPrecio(r.precio)),
    ),
  );

  const filaTotal = h(
    View,
    { style: [estilosDoc.filaTabla, estilosDoc.filaTotal], key: 'total' },
    h(Text, { style: [estilosDoc.celda, estilosDoc.celdaTotal, estilos.celdaModelo] }, ''),
    h(
      Text,
      { style: [estilosDoc.celda, estilosDoc.celdaTotal, estilos.celdaDescripcion] },
      'Suma de precios unitarios',
    ),
    h(Text, { style: [estilosDoc.celda, estilosDoc.celdaTotal, estilos.celdaNumero] }, ''),
    h(
      Text,
      { style: [estilosDoc.celda, estilosDoc.celdaTotal, estilos.celdaPrecio] },
      formatearPrecio(datos.total),
    ),
  );

  return h(
    View,
    { style: estilosDoc.seccion },
    TituloSeccion(`Modelos cotizados (${String(datos.renglones.length)})`),
    filaEncabezado,
    ...filas,
    filaTotal,
  );
}

/** Una página de la cotización. */
function paginaCotizacion(datos: DatosImpresoCotizacion, clave: string): ReactElement {
  const hijos: ReactElement[] = [
    EncabezadoDocumento({
      empresa: datos.empresa,
      titulo: 'Cotización — CONTROL v2',
      derecha: { etiqueta: 'Cotización', valor: String(datos.folio), grande: true },
    }),
    // Una cotización cancelada SÍ se imprime (D3), pero se ve de un golpe que ya no está vigente.
    ...(datos.cancelada
      ? [BandaEstado({ titulo: 'CANCELADA', detalle: datos.motivoCancelacion })]
      : []),
    h(
      View,
      { style: estilosDoc.filaCampos, key: 'campos' },
      campo('Cliente', datos.cliente),
      campo('Departamento', datos.departamento),
      campo('Fecha', datos.fecha),
      campo('Lista de precios', `#${String(datos.folioLista)}`),
    ),
    tablaRenglones(datos),
    ...(datos.notas !== null && datos.notas !== ''
      ? [h(Text, { style: estilos.notas, key: 'notas' }, `Notas: ${datos.notas}`)]
      : []),
    h(
      Text,
      { style: estilos.vigencia, key: 'vigencia' },
      'Precios unitarios en pesos mexicanos, antes de IVA. Esta cotización refleja las condiciones ' +
        'acordadas a la fecha indicada; cualquier cambio posterior se documenta en una cotización nueva.',
    ),
    PieDocumento({
      contexto: `CONTROL v2 · ${datos.empresa} · Cotización ${String(datos.folio)} · ${String(datos.renglones.length)} modelos`,
    }),
  ];
  return h(Page, { key: clave, size: 'A4', style: estilosDoc.pagina }, ...hijos);
}

/** Documento de la COTIZACIÓN. */
function documentoCotizacion(datos: DatosImpresoCotizacion): ReactElement<DocumentProps> {
  return h(
    Document,
    {
      title: `Cotización ${String(datos.folio)}`,
      author: datos.empresa,
      subject: `Cotización para ${datos.cliente}`,
    },
    paginaCotizacion(datos, 'cotizacion'),
  );
}

/** Genera el PDF (Buffer) de la cotización a partir de sus datos ya resueltos (función pura). */
export async function generarPdfCotizacion(datos: DatosImpresoCotizacion): Promise<Buffer> {
  return renderToBuffer(documentoCotizacion(datos));
}

/** Resultado de generar la cotización (Buffer + folio para el `filename`). */
export interface ImpresoCotizacion {
  buffer: Buffer;
  folio: number;
}

/** Resuelve los datos de la cotización (A9) y devuelve su PDF + el folio para el nombre del archivo. */
export async function impresoCotizacion(
  sesion: SesionUsuario,
  idCotizacion: number,
  bd?: ContextoBd,
  deps: DepsImpresoCotizacion = {},
): Promise<ImpresoCotizacion> {
  const datos = await armarDatosImpresoCotizacion(sesion, idCotizacion, bd, deps);
  return {
    buffer: await renderizarPdfEnWorker('desarrollo-cotizacion', datos, {
      idEmpresa: sesion.idEmpresaActiva,
    }),
    folio: datos.folio,
  };
}
