/**
 * Impresos de los ENVÍOS a maquila (F3-E2, R9):
 *  • {@link impresoEnvioMaquila} — DOCUMENTO DE ENVÍO/ENTREGA A MAQUILA (ref. viejo
 *    `ReciboEntMaquilaImp`/`ReciboEntMaqDetImp`): la hoja que acompaña las prendas que SALEN al
 *    maquilero/estampador. Encabezado (empresa, folio del envío, fecha, maquilero, proceso,
 *    orden/modelo, fecha compromiso, precio pactado) + matriz color×talla con totales. SIN precios
 *    de costo del modelo; SÍ el precio pactado del envío.
 *  • {@link impresoFichaEstampado} — FICHA DE ESTAMPADO (ref. viejo `FichaEst`/`FichaEstImp`): la
 *    ficha que acompaña un envío de proceso de estampado/aplicación. Estructura similar, rotulada
 *    como ficha de estampado, con espacio para instrucciones del proceso.
 *
 * Documentos generados EN EL SERVIDOR con `@react-pdf/renderer` (`renderToBuffer`), MISMO motor y
 * patrón que `impreso-orden.ts` (deps inyectables, A1: la ruta solo valida permiso+Zod y delega).
 *
 * Innegociables: A1 (toda la lógica aquí), A9 (`obtenerEtapa` filtra por la empresa activa → 404 si
 * no es de la empresa). Se reusa `obtenerEtapa` (encabezado + matriz + nombres) — NO se reinventa.
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
import { ErrorValidacion } from '../../../comun/errores.js';
import type { ContextoBd } from '../../../comun/transaccion.js';
import { obtenerEtapa } from '../etapas.js';
import type { EtapaSalida } from '../../../contrato/index.js';

// ── Datos resueltos del impreso (forma PURA: ya sin BD) ──────────────────────────────────────────

/** Todo lo que necesita el documento de envío a maquila, ya resuelto (sin BD) → función pura. */
export interface DatosImpresoEnvio {
  empresa: string;
  folio: number;
  fecha: string;
  fechaCompromiso: string | null;
  maquilero: string | null;
  proceso: string | null;
  folioOrden: number;
  precioPactado: number | null;
  observaciones: string | null;
  cancelado: boolean;
  /** Columnas: etiquetas de talla en el orden en que aparecen en la matriz. */
  tallas: string[];
  /** Renglones color×talla; `cantidades[i]` alinea con `tallas[i]`. */
  renglones: { color: string; cantidades: number[]; totalFila: number }[];
  totalesColumna: number[];
  totalPiezas: number;
}

/**
 * Proyecta la matriz de la etapa (colores con sus tallas) a la tabla color×talla del impreso:
 * columnas = unión ordenada de tallas (preservando orden de aparición), filas = colores, con
 * totales por fila, por columna y total general. Misma forma que `armarTabla` de `impreso-orden`.
 */
export function armarTablaEtapa(
  lineas: EtapaSalida['lineas'],
): Pick<DatosImpresoEnvio, 'tallas' | 'renglones' | 'totalesColumna' | 'totalPiezas'> {
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

/** Dependencias inyectables (los tests inyectan un `obtenerEtapa` fake para no tocar BD). */
export interface DepsImpresoEnvio {
  obtenerEtapa?: typeof obtenerEtapa;
}

/**
 * Resuelve los datos del impreso de un envío (A9: por la empresa activa de la sesión). Reusa
 * `obtenerEtapa` (encabezado + matriz + nombres). Lanza `ErrorValidacion` si la etapa NO es un
 * envío a maquila (un corte no tiene "documento de envío"); `ErrorNoEncontrado` (404) si no es de
 * la empresa activa.
 */
export async function armarDatosImpresoEnvio(
  sesion: SesionUsuario,
  idEtapa: number,
  bd?: ContextoBd,
  deps: DepsImpresoEnvio = {},
): Promise<DatosImpresoEnvio> {
  const obtener = deps.obtenerEtapa ?? obtenerEtapa;
  const etapa = await obtener(sesion, idEtapa, bd);
  if (etapa.tipo !== 'envio_maquila') {
    throw new ErrorValidacion('El documento de envío solo aplica a etapas de envío a maquila.');
  }
  const tabla = armarTablaEtapa(etapa.lineas);
  return {
    empresa: sesion.nombreEmpresaActiva,
    folio: etapa.folio,
    fecha: etapa.fecha,
    fechaCompromiso: etapa.fechaCompromiso,
    maquilero: etapa.tercero,
    proceso: etapa.tipoProceso,
    folioOrden: etapa.folioOrden,
    precioPactado: etapa.precioPactado,
    observaciones: etapa.observaciones,
    cancelado: etapa.cancelado,
    ...tabla,
  };
}

// ── Documento PDF (react-pdf, sin JSX) ──────────────────────────────────────────────────────────

const estilos = StyleSheet.create({
  // Estilos PROPIOS del envío/ficha (lo compartido vive en `estilosDoc`).
  colColor: { flexGrow: 1, flexBasis: 0, textAlign: 'left' },
  colTalla: { width: 34, textAlign: 'center' },
  colTotal: { width: 42, textAlign: 'center', fontFamily: FUENTE.negrita },
  cajaInstrucciones: {
    marginTop: 10,
    borderWidth: 0.5,
    borderColor: PALETA.borde,
    minHeight: 70,
    padding: 6,
  },
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

/** Banda roja "CANCELADO" (solo si la etapa está cancelada). */
function bandaCancelada(datos: DatosImpresoEnvio): ReactElement | null {
  if (!datos.cancelado) {
    return null;
  }
  return BandaEstado({ titulo: 'ENVÍO CANCELADO' });
}

/** Tabla MATRIZ color×talla con totales por fila/columna y total general. */
function tablaMatriz(datos: DatosImpresoEnvio): ReactElement {
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
    TituloSeccion('Cantidades (color × talla)'),
    ...cuerpo,
  );
}

/** Pesos en MXN sin redondear (precio pactado). */
function pesos(valor: number | null): string | null {
  if (valor === null) return null;
  return valor.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
}

/** Una página del documento de ENVÍO a maquila. */
function paginaEnvio(datos: DatosImpresoEnvio, clave: string): ReactElement {
  const hijos: (ReactElement | null)[] = [
    EncabezadoDocumento({
      empresa: datos.empresa,
      titulo: 'Envío a maquila — CONTROL v2',
      derecha: { etiqueta: 'Folio de envío', valor: String(datos.folio), grande: true },
    }),
    bandaCancelada(datos),
    h(
      View,
      { style: estilosDoc.filaCampos, key: 'campos' },
      campo('Maquilero', datos.maquilero),
      campo('Proceso', datos.proceso),
      campo('Orden', String(datos.folioOrden)),
      campo('Fecha de envío', datos.fecha),
      campo('Fecha compromiso', datos.fechaCompromiso),
      campo('Precio pactado', pesos(datos.precioPactado)),
    ),
    datos.observaciones
      ? h(
          View,
          { style: estilosDoc.campoDosTercios, key: 'obs' },
          h(Text, { style: estilosDoc.etiquetaCampo }, 'Observaciones'),
          h(Text, { style: estilosDoc.valorCampoTexto }, datos.observaciones),
        )
      : null,
    tablaMatriz(datos),
    PieDocumento({
      contexto: `CONTROL v2 · ${datos.empresa} · Envío ${datos.folio} · Orden ${datos.folioOrden} · ${datos.totalPiezas} piezas`,
    }),
  ];
  return h(
    Page,
    { key: clave, size: 'A4', style: estilosDoc.pagina },
    ...hijos.filter((x) => x !== null),
  );
}

/** Una página de la FICHA DE ESTAMPADO (acompaña un envío de proceso de estampado/aplicación). */
function paginaFichaEstampado(datos: DatosImpresoEnvio, clave: string): ReactElement {
  const hijos: (ReactElement | null)[] = [
    EncabezadoDocumento({
      empresa: datos.empresa,
      titulo: 'Ficha de estampado — CONTROL v2',
      derecha: { etiqueta: 'Folio de envío', valor: String(datos.folio), grande: true },
    }),
    bandaCancelada(datos),
    h(
      View,
      { style: estilosDoc.filaCampos, key: 'campos' },
      campo('Estampador', datos.maquilero),
      campo('Proceso', datos.proceso),
      campo('Orden', String(datos.folioOrden)),
      campo('Fecha de envío', datos.fecha),
      campo('Fecha compromiso', datos.fechaCompromiso),
      campo('Precio pactado', pesos(datos.precioPactado)),
    ),
    tablaMatriz(datos),
    h(
      View,
      { style: estilosDoc.seccion, key: 'instr' },
      TituloSeccion('Instrucciones del estampado'),
      datos.observaciones
        ? h(View, { style: estilos.cajaInstrucciones }, h(Text, {}, datos.observaciones))
        : h(View, { style: estilos.cajaInstrucciones }, h(Text, { style: estilosDoc.vacio }, '')),
    ),
    PieDocumento({
      contexto: `CONTROL v2 · ${datos.empresa} · Ficha de estampado · Envío ${datos.folio} · ${datos.totalPiezas} piezas`,
    }),
  ];
  return h(
    Page,
    { key: clave, size: 'A4', style: estilosDoc.pagina },
    ...hijos.filter((x) => x !== null),
  );
}

/** Documento de UN envío a maquila. */
function documentoEnvio(datos: DatosImpresoEnvio): ReactElement<DocumentProps> {
  return h(
    Document,
    { title: `Envío ${datos.folio}`, author: datos.empresa, subject: 'Envío a maquila' },
    paginaEnvio(datos, 'envio'),
  );
}

/** Documento de UNA ficha de estampado. */
function documentoFichaEstampado(datos: DatosImpresoEnvio): ReactElement<DocumentProps> {
  return h(
    Document,
    {
      title: `Ficha de estampado ${datos.folio}`,
      author: datos.empresa,
      subject: 'Ficha de estampado',
    },
    paginaFichaEstampado(datos, 'ficha'),
  );
}

// ── Generación del Buffer (funciones puras) ──────────────────────────────────────────────────────

/** Genera el PDF (Buffer) del documento de envío a maquila a partir de sus datos resueltos. */
export async function generarPdfEnvio(datos: DatosImpresoEnvio): Promise<Buffer> {
  return renderToBuffer(documentoEnvio(datos));
}

/** Genera el PDF (Buffer) de la ficha de estampado a partir de sus datos resueltos. */
export async function generarPdfFichaEstampado(datos: DatosImpresoEnvio): Promise<Buffer> {
  return renderToBuffer(documentoFichaEstampado(datos));
}

// ── Orquestación de alto nivel (resuelve datos + genera) — la usa la ruta ────────────────────────

/** Resultado de generar un impreso de envío (Buffer + folio para el `filename`). */
export interface ImpresoEnvio {
  buffer: Buffer;
  folio: number;
}

/** Resuelve los datos del envío (A9) y devuelve su PDF + el folio para el nombre del archivo. */
export async function impresoEnvioMaquila(
  sesion: SesionUsuario,
  idEtapa: number,
  bd?: ContextoBd,
  deps: DepsImpresoEnvio = {},
): Promise<ImpresoEnvio> {
  const datos = await armarDatosImpresoEnvio(sesion, idEtapa, bd, deps);
  return { buffer: await renderizarPdfEnWorker('envio-maquila', datos), folio: datos.folio };
}

/** Resuelve los datos del envío (A9) y devuelve la ficha de estampado (PDF) + el folio. */
export async function impresoFichaEstampado(
  sesion: SesionUsuario,
  idEtapa: number,
  bd?: ContextoBd,
  deps: DepsImpresoEnvio = {},
): Promise<ImpresoEnvio> {
  const datos = await armarDatosImpresoEnvio(sesion, idEtapa, bd, deps);
  return { buffer: await renderizarPdfEnWorker('ficha-estampado', datos), folio: datos.folio };
}
