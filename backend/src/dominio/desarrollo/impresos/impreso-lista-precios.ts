/**
 * Impreso "LISTA DE PRECIOS" (F8-E4, R9; D13/R20a): la hoja (PDF) que documenta la lista de precios de
 * un Cliente+Departamento — encabezado (cliente, departamento, folio, fecha, estado) + tabla de
 * renglones con **modelo / número del cliente / precio** (= `precioAprobado` si existe, si no
 * `precioCalculado`).
 *
 * Documento generado EN EL SERVIDOR con `@react-pdf/renderer` (`renderToBuffer`), MISMO motor/patrón
 * que `impreso-plan-rc.ts` (A1: la ruta solo valida permiso + Zod y delega). REUSA `obtenerLista` (A9:
 * filtra por la empresa activa → 404 si la lista no es de la empresa; los importes ya vienen resueltos
 * por el dominio). La ruta EXIGE `consultas.ver-importes`, así que en este camino los precios siempre
 * llegan (el impreso ES la exportación de precios).
 *
 * ⭐⭐ **V1-E8x (§Post-F9.155) — LOS DROPEADOS NO SALEN.** El papel muestra los renglones NO
 * dropeados, y esa única regla cubre los dos momentos: antes de negociar no hay ninguno dropeado
 * (sale la lista completa, la *cotización previa* de Daniel) y después salen sólo los vigentes.
 *
 * 🔴 **V1-E8b (§Post-F9.125(c)) — SIN APROBACIÓN NO SALE ESTA HOJA.** Imprimía
 * `precioAprobado ?? precioCalculado`, o sea que de una lista sin firmar salía un papel con precios
 * que nadie autorizó y con la MISMA pinta que el bueno. Daniel: *"si no está aprobado no debería de
 * poder bajar ni un borrador porque puede confundir al cliente"*. Hoy pasa por
 * {@link exigirRenglonesAprobados}, el MISMO guard de la cotización — no una copia con criterio
 * propio.
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
  EncabezadoDocumento,
  PieDocumento,
  TituloSeccion,
} from '../../../comun/impresos-estilos.js';

import type { SesionUsuario } from '../../../comun/permisos.js';
import type { ContextoBd } from '../../../comun/transaccion.js';
import { exigirRenglonesAprobados } from '../cotizaciones.js';
import { obtenerLista } from '../listas-precios.js';

/** Un renglón de la lista, ya proyectado para el PDF. */
export interface RenglonListaImpreso {
  codigoModelo: string;
  descripcionModelo: string | null;
  numeroCliente: string | null;
  /**
   * Precio a imprimir. SIEMPRE el APROBADO (§Post-F9.125(c): sin aprobación no sale la hoja); el
   * `?? precioCalculado` es sólo la red del tipo, porque {@link exigirRenglonesAprobados} ya rechazó
   * el caso. Null únicamente si la sesión no viera importes, que la ruta impide.
   */
  precio: number | null;
  aprobado: boolean;
}

/** Todo lo que necesita el impreso de la lista, ya resuelto (sin BD) → función pura. */
export interface DatosImpresoListaPrecios {
  empresa: string;
  folio: number;
  cliente: string;
  departamento: string;
  fecha: string;
  estado: string;
  notas: string | null;
  renglones: RenglonListaImpreso[];
}

/** Dependencias inyectables (los tests inyectan un `obtenerLista` fake para no tocar BD). */
export interface DepsImpresoListaPrecios {
  obtenerLista?: typeof obtenerLista;
}

/**
 * Resuelve los datos del impreso de la lista (A9). Reusa `obtenerLista` (renglones con sus precios ya
 * resueltos), EXIGE que todos los renglones estén aprobados (§Post-F9.125(c)) y proyecta el precio a
 * imprimir.
 */
export async function armarDatosImpresoListaPrecios(
  sesion: SesionUsuario,
  idLista: number,
  bd?: ContextoBd,
  deps: DepsImpresoListaPrecios = {},
): Promise<DatosImpresoListaPrecios> {
  const obtener = deps.obtenerLista ?? obtenerLista;
  const lista = await obtener(sesion, idLista, bd);

  // §Post-F9.125(c): ni un borrador de una lista sin aprobar. Va ANTES de armar nada — si no puede
  // salir, no se gasta un worker de PDF en construirlo.
  //
  // ⭐⭐ V1-E8x (§Post-F9.155): el guard exige la firma **sólo de los vigentes** y DEVUELVE esos
  // vigentes, que son los que se imprimen. Los dropeados no salen en la hoja que ve el cliente —y
  // tampoco se mencionan: que un modelo se haya caído es asunto NUESTRO, no suyo.
  const vigentes = exigirRenglonesAprobados(lista.lineas, 'bajar el impreso de la lista');

  return {
    empresa: sesion.nombreEmpresaActiva,
    folio: lista.folio,
    cliente: lista.nombreCliente,
    departamento: lista.nombreDepartamento,
    fecha: lista.fecha,
    estado: lista.nombreEstado,
    notas: lista.notas,
    renglones: vigentes.map((l) => ({
      codigoModelo: l.codigoModelo,
      descripcionModelo: l.descripcionModelo,
      numeroCliente: l.numeroCliente,
      precio: l.precioAprobado ?? l.precioCalculado,
      aprobado: l.aprobado,
    })),
  };
}

// ── Documento PDF (react-pdf, sin JSX) ──────────────────────────────────────────────────────────

/** Formatea un precio a "$1,234" (entero, MXN) o "—" si null. */
function formatearPrecio(precio: number | null): string {
  if (precio === null) {
    return '—';
  }
  return `$${precio.toLocaleString('es-MX', { maximumFractionDigits: 2 })}`;
}

const estilos = StyleSheet.create({
  // Estilos PROPIOS de la lista (lo compartido vive en `estilosDoc`).
  celdaModelo: { width: 90, textAlign: 'left' },
  celdaDescripcion: { flexGrow: 1, flexBasis: 0, textAlign: 'left' },
  celdaNumero: { width: 90, textAlign: 'left' },
  celdaPrecio: { width: 70, textAlign: 'right' },
  aprobadoChip: { color: PALETA.ok, fontSize: 7 },
  notas: { fontSize: 8, color: PALETA.muted, marginTop: 8 },
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

/** Tabla de RENGLONES de la lista (modelo / número del cliente / precio). */
function tablaRenglones(datos: DatosImpresoListaPrecios): ReactElement {
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
      'Nº cliente',
    ),
    h(
      Text,
      { style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.celdaPrecio] },
      'Precio',
    ),
  );

  const filas = datos.renglones.map((r, i) =>
    h(
      View,
      { style: estilosDoc.filaTabla, key: `fila-${i}`, wrap: false },
      h(Text, { style: [estilosDoc.celda, estilos.celdaModelo] }, r.codigoModelo),
      h(Text, { style: [estilosDoc.celda, estilos.celdaDescripcion] }, r.descripcionModelo ?? '—'),
      h(Text, { style: [estilosDoc.celda, estilos.celdaNumero] }, r.numeroCliente ?? '—'),
      h(
        Text,
        { style: [estilosDoc.celda, estilos.celdaPrecio] },
        `${formatearPrecio(r.precio)}${r.aprobado ? '' : ' *'}`,
      ),
    ),
  );

  return h(
    View,
    { style: estilosDoc.seccion },
    TituloSeccion(`Renglones (${datos.renglones.length})`),
    filaEncabezado,
    ...filas,
    h(
      Text,
      { style: estilos.aprobadoChip, key: 'leyenda' },
      '* precio calculado (aún no aprobado por el dueño).',
    ),
  );
}

/** Una página de la lista de precios. */
function paginaLista(datos: DatosImpresoListaPrecios, clave: string): ReactElement {
  const hijos: ReactElement[] = [
    EncabezadoDocumento({
      empresa: datos.empresa,
      titulo: 'Lista de precios por cliente — CONTROL v2',
      derecha: { etiqueta: 'Lista', valor: String(datos.folio), grande: true },
    }),
    h(
      View,
      { style: estilosDoc.filaCampos, key: 'campos' },
      campo('Cliente', datos.cliente),
      campo('Departamento', datos.departamento),
      campo('Fecha', datos.fecha),
      campo('Estado', datos.estado),
    ),
    tablaRenglones(datos),
    ...(datos.notas !== null && datos.notas !== ''
      ? [h(Text, { style: estilos.notas, key: 'notas' }, `Notas: ${datos.notas}`)]
      : []),
    PieDocumento({
      contexto: `CONTROL v2 · ${datos.empresa} · Lista ${datos.folio} · ${datos.renglones.length} renglones`,
    }),
  ];
  return h(Page, { key: clave, size: 'A4', style: estilosDoc.pagina }, ...hijos);
}

/** Documento de la LISTA de precios. */
function documentoLista(datos: DatosImpresoListaPrecios): ReactElement<DocumentProps> {
  return h(
    Document,
    {
      title: `Lista de precios ${datos.folio}`,
      author: datos.empresa,
      subject: 'Lista de precios por cliente',
    },
    paginaLista(datos, 'lista'),
  );
}

/** Genera el PDF (Buffer) de la lista de precios a partir de sus datos resueltos. */
export async function generarPdfListaPrecios(datos: DatosImpresoListaPrecios): Promise<Buffer> {
  return renderToBuffer(documentoLista(datos));
}

/** Resultado de generar la lista de precios (Buffer + folio para el `filename`). */
export interface ImpresoListaPrecios {
  buffer: Buffer;
  folio: number;
}

/** Resuelve los datos de la lista (A9) y devuelve su PDF + el folio para el nombre del archivo. */
export async function impresoListaPrecios(
  sesion: SesionUsuario,
  idLista: number,
  bd?: ContextoBd,
  deps: DepsImpresoListaPrecios = {},
): Promise<ImpresoListaPrecios> {
  const datos = await armarDatosImpresoListaPrecios(sesion, idLista, bd, deps);
  return {
    buffer: await renderizarPdfEnWorker('desarrollo-lista-precios', datos, {
      idEmpresa: sesion.idEmpresaActiva,
    }),
    folio: datos.folio,
  };
}
