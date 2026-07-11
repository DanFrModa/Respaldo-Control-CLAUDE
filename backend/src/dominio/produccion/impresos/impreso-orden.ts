/**
 * Impreso de la ORDEN de producción (F2-E4, R9) — la HOJA (PDF) de PISO DE PRODUCCIÓN que se le da
 * al maquilero/corte para producir una orden. Documento generado EN EL SERVIDOR con
 * `@react-pdf/renderer` (`renderToBuffer`), el mismo motor que el primer impreso del sistema
 * (códigos de barra, F1-E5).
 *
 * Decisiones del dueño (Gabriel, cerradas — se respetan al pie de la letra):
 *  • SIN precios ni costos: NO se imprime el precio de bordados, ni `maquilaOrd`/`aplicacionOrd`,
 *    ni `maquilaBase`. Es una orden para PRODUCIR, no un costeo.
 *  • SIN código de barra / UPC (esa funcionalidad está en retiro).
 *  • Sección HABILITACIÓN = los avíos del modelo marcados `paraProduccion` (rotulada "Habilitación").
 *  • Impresión por lote = UN solo PDF consolidado, una orden por página (salto entre órdenes).
 *
 * Innegociables aplicados:
 *  • A1 — TODA la lógica de armado vive aquí (dominio); la ruta (corte 2) solo valida permiso+Zod
 *    y delega. A4 — `verificarPermiso(sesion, 'ordenes.ver')`. A9 — la orden se resuelve por
 *    `obtenerOrden`, que filtra por la empresa activa de la sesión (una orden de otra empresa, para
 *    esta sesión, no existe → `ErrorNoEncontrado`/404).
 *  • REUSO — los datos se arman con lo que ya existe: `obtenerOrden` (encabezado + matriz + total),
 *    `leerBom` (telas/avíos/bordados del modelo) y `listarFotos` (fotos del modelo). NO se reinventa.
 *
 * Fotos: se incrustan en el PDF bajando los bytes del objeto R2 (vía la URL GET prefirmada que da
 * `listarFotos`) y degradando con ELEGANCIA: si una foto no se puede obtener, el PDF se renderiza
 * igual sin esa imagen (jamás se trunca el impreso por una foto faltante). El servicio de archivos
 * y la descarga de bytes son INYECTABLES para los tests (sin R2 real).
 */
import { createElement as h, type ReactElement } from 'react';

import {
  Document,
  Image,
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

import { servicioArchivos, type ServicioArchivos } from '../../../comun/archivos.js';
import { verificarPermiso, type SesionUsuario } from '../../../comun/permisos.js';
import { clienteLectura, type ContextoBd } from '../../../comun/transaccion.js';
import { leerBom } from '../../modelos/bom-modelo.js';
// Se lee a BAJO NIVEL (`leerFotosModelo`, sin `verificarPermiso(modelos.ver)`) a propósito: la
// impresión ya está autorizada por `ordenes.ver` y las fotos del modelo son parte del documento de
// la orden. Exigir `modelos.ver` haría que un rol con `ordenes.ver` pero sin `modelos.ver` reciba
// 403 y truene el PDF entero, contradiciendo el degradado best-effort de fotos.
import { leerFotosModelo } from '../../modelos/fotos-modelo.js';
import { obtenerOrden } from '../ordenes.js';

// ── Datos resueltos del impreso (forma PURA: ya sin red ni BD) ──────────────────────────────────

/** Una foto del modelo ya descargada, lista para incrustar como `<Image src>` (data-URL). */
export interface FotoImpreso {
  /** Data-URL `data:<mime>;base64,...` con los bytes de la imagen. */
  dataUrl: string;
}

/** Un renglón de la sección TELAS del impreso (solo nombre, sin precio). */
export interface TelaImpreso {
  nombre: string;
  consumoPorPrenda: number;
}

/** Un renglón de la sección HABILITACIÓN (avíos del BOM `paraProduccion`; sin precio). */
export interface AvioImpreso {
  clave: string;
  descripcion: string;
  consumoPorPrenda: number;
}

/** Un renglón de la sección BORDADOS (solo nombre/tipo; SIN precio, decisión del dueño). */
export interface BordadoImpreso {
  nombre: string;
  tipo: 'BORDADO' | 'ESTAMPADO';
}

/**
 * Todo lo que necesita el documento PDF de UNA orden, ya RESUELTO (sin red ni BD): así
 * `generarPdfOrden`/`generarPdfOrdenes` son funciones puras y testeables. Las cantidades de la
 * matriz se proyectan a una tabla color × talla con totales por fila/columna y total general.
 */
export interface DatosImpresoOrden {
  empresa: string;
  folio: number;
  estado: 'capturada' | 'completa' | 'cancelada';
  motivoCancelada: string | null;
  fecha: string | null;
  fechaEntrega: string | null;
  cliente: string;
  etiquetaMarca: string | null;
  maquilero: string | null;
  codigoModelo: string;
  descripcionModelo: string | null;
  composicion: string | null;
  observaciones: string | null;
  obsMaquila: string | null;
  /** Etiquetas de talla en el orden en que aparecen en la matriz (columnas de la tabla). */
  tallas: string[];
  /** Renglones color × talla; `cantidades[i]` alinea con `tallas[i]` (0 si la talla no aplica). */
  renglones: { color: string; cantidades: number[]; totalFila: number }[];
  /** Total por columna (alinea con `tallas`). */
  totalesColumna: number[];
  /** Total general de la orden (debe CUADRAR con `OrdenSalida.totalPiezas`). */
  totalPiezas: number;
  telas: TelaImpreso[];
  bordados: BordadoImpreso[];
  habilitacion: AvioImpreso[];
  fotos: FotoImpreso[];
}

// ── Resolución de datos (lo único que toca BD/red) ──────────────────────────────────────────────

/**
 * Baja los bytes de una imagen desde su URL GET prefirmada y los devuelve como data-URL, o `null`
 * si algo falla (best-effort, A1: una foto faltante NO trunca el impreso). Inyectable en tests.
 */
export type DescargarImagen = (url: string) => Promise<string | null>;

/** Descarga real (Node 22 trae `fetch`/`Blob` globales). Cualquier fallo → `null` (best-effort). */
export const descargarImagenComoDataUrl: DescargarImagen = async (url) => {
  try {
    const respuesta = await fetch(url);
    if (!respuesta.ok) {
      return null;
    }
    const tipo = respuesta.headers.get('content-type') ?? 'image/jpeg';
    const buffer = Buffer.from(await respuesta.arrayBuffer());
    if (buffer.length === 0) {
      return null;
    }
    return `data:${tipo};base64,${buffer.toString('base64')}`;
  } catch {
    return null;
  }
};

/**
 * Dependencias inyectables de la resolución de datos. Por defecto usa los servicios REALES
 * (R2 + fetch + las lecturas de dominio que el impreso REUSA). Los tests inyectan fakes para no
 * tocar BD ni R2. `obtenerOrden`/`leerBom`/`leerFotosModelo` son seams de DI (no se reimplementa
 * nada: el default es exactamente la función de dominio que ya existe).
 */
export interface DepsImpreso {
  archivos?: ServicioArchivos;
  descargarImagen?: DescargarImagen;
  obtenerOrden?: typeof obtenerOrden;
  leerBom?: typeof leerBom;
  leerFotosModelo?: typeof leerFotosModelo;
}

/**
 * Proyecta la matriz de la orden (lista de colores, cada uno con sus tallas) a la tabla
 * color × talla del impreso: columnas = unión ordenada de tallas que aparecen (preservando el
 * orden en que se ven), filas = colores, con totales por fila, por columna y total general.
 */
export function armarTabla(
  lineas: { color: string; tallas: { etiquetaTalla: string; cantidad: number }[] }[],
): Pick<DatosImpresoOrden, 'tallas' | 'renglones' | 'totalesColumna' | 'totalPiezas'> {
  // Columnas: primera aparición de cada etiqueta de talla, en orden.
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

/**
 * Resuelve TODOS los datos del impreso de una orden (A9: por la empresa activa de la sesión).
 * Reúsa `obtenerOrden` (encabezado + matriz + total), `leerBom` (telas/avíos/bordados, filtrando
 * `paraProduccion` para telas y habilitación) y `leerFotosModelo` (fotos del modelo, cuyos bytes
 * baja best-effort). Requiere SOLO `ordenes.ver`: las fotos se leen a bajo nivel (sin exigir
 * `modelos.ver`) porque la impresión ya está autorizada y la foto es parte del documento de la
 * orden. Lanza `ErrorNoEncontrado` (404) si la orden no es de la empresa activa.
 */
export async function armarDatosImpresoOrden(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
  deps: DepsImpreso = {},
): Promise<DatosImpresoOrden> {
  verificarPermiso(sesion, 'ordenes.ver');
  const descargarImagen = deps.descargarImagen ?? descargarImagenComoDataUrl;
  const obtener = deps.obtenerOrden ?? obtenerOrden;
  const leer = deps.leerBom ?? leerBom;
  const leerFotos = deps.leerFotosModelo ?? leerFotosModelo;

  // `obtenerOrden` ya verifica permiso + empresa activa (A9) y deriva la matriz/total. Va PRIMERO:
  // si la orden no es de la empresa activa, fallamos con 404 antes de tocar R2 (servicioArchivos()).
  const orden = await obtener(sesion, id, bd);

  const archivos = deps.archivos ?? servicioArchivos();
  const cliente = clienteLectura(bd);
  const bom = await leer(cliente, orden.idModelo);
  const fotos = await leerFotos(orden.idModelo, bd, archivos);

  // Fotos: se bajan en paralelo y se descartan las que no se pudieron obtener (best-effort).
  const dataUrls = await Promise.all(fotos.map((f) => descargarImagen(f.urlDescarga)));
  const fotosImpreso: FotoImpreso[] = dataUrls
    .filter((u): u is string => u !== null)
    .map((dataUrl) => ({ dataUrl }));

  const tabla = armarTabla(orden.lineas);

  return {
    empresa: sesion.nombreEmpresaActiva,
    folio: orden.folio,
    estado: orden.estado,
    motivoCancelada: orden.motivoCancelada,
    fecha: orden.fecha,
    fechaEntrega: orden.fechaEntrega,
    cliente: orden.cliente,
    etiquetaMarca: orden.etiquetaMarca,
    maquilero: orden.maquilero,
    codigoModelo: orden.codigoModelo,
    descripcionModelo: orden.descripcionModelo,
    composicion: orden.composicion,
    observaciones: orden.observaciones,
    obsMaquila: orden.obsMaquila,
    ...tabla,
    // Telas y Habilitación (avíos): SOLO los marcados `paraProduccion`. Bordados: todos.
    telas: bom.telas
      .filter((t) => t.paraProduccion)
      .map((t) => ({ nombre: t.nombre, consumoPorPrenda: t.consumoPorPrenda })),
    bordados: bom.bordados.map((b) => ({ nombre: b.nombre, tipo: b.tipo })),
    habilitacion: bom.avios
      .filter((a) => a.paraProduccion)
      .map((a) => ({
        clave: a.clave,
        descripcion: a.descripcion,
        consumoPorPrenda: a.consumoPorPrenda,
      })),
    fotos: fotosImpreso,
  };
}

// ── Documento PDF (react-pdf, sin JSX: `createElement`) ──────────────────────────────────────────

const estilos = StyleSheet.create({
  // Estilos PROPIOS de esta orden (lo compartido vive en `estilosDoc`).
  fotos: { flexDirection: 'row', marginBottom: 12, gap: 8 },
  foto: {
    width: 110,
    height: 130,
    objectFit: 'contain',
    borderWidth: 1,
    borderColor: PALETA.borde,
  },
  colColor: { flexGrow: 1, flexBasis: 0, textAlign: 'left' },
  colTalla: { width: 34, textAlign: 'center' },
  colTotal: { width: 42, textAlign: 'center', fontFamily: FUENTE.negrita },
  listaTexto: { fontSize: 8, marginBottom: 2 },
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

/** Banda roja "CANCELADA" + motivo (solo si la orden está cancelada). */
function bandaCancelada(datos: DatosImpresoOrden): ReactElement | null {
  if (datos.estado !== 'cancelada') {
    return null;
  }
  return BandaEstado({
    titulo: 'ORDEN CANCELADA',
    detalle: `Motivo: ${datos.motivoCancelada ?? 'sin especificar'}`,
  });
}

/** Bloque de fotos del modelo (vacío si no hay ninguna disponible). */
function bloqueFotos(datos: DatosImpresoOrden): ReactElement | null {
  if (datos.fotos.length === 0) {
    return null;
  }
  return h(
    View,
    { style: estilos.fotos },
    // A PROPÓSITO se muestran hasta 3 fotos (las primeras por orden): es una hoja de PISO de
    // producción, no una galería; más de 3 desbordaría el encabezado de la página. No es un bug.
    ...datos.fotos
      .slice(0, 3)
      .map((foto, i) => h(Image, { key: `foto-${i}`, style: estilos.foto, src: foto.dataUrl })),
  );
}

/** Tabla MATRIZ color × talla con totales por fila/columna y total general. */
function tablaMatriz(datos: DatosImpresoOrden): ReactElement {
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
      ? [h(Text, { style: estilosDoc.vacio, key: 'vacio' }, 'Sin matriz capturada.')]
      : [filaEncabezado, ...filasColor, filaTotales];

  return h(
    View,
    { style: estilosDoc.seccion },
    TituloSeccion('Matriz de producción (color × talla)'),
    ...cuerpo,
  );
}

/** Sección de lista simple (Telas / Bordados / Habilitación), con su texto o un "—" si va vacía. */
function seccionLista(titulo: string, lineas: string[]): ReactElement {
  const cuerpo =
    lineas.length === 0
      ? [h(Text, { style: estilosDoc.vacio, key: 'vacio' }, 'Sin renglones.')]
      : lineas.map((t, i) => h(Text, { key: `l-${i}`, style: estilos.listaTexto }, `• ${t}`));
  return h(View, { style: estilosDoc.seccion }, TituloSeccion(titulo), ...cuerpo);
}

/** Una página = una orden. `clave` la usa react para diferenciar páginas dentro del documento. */
function paginaOrden(datos: DatosImpresoOrden, clave: string): ReactElement {
  const hijos: (ReactElement | null)[] = [
    EncabezadoDocumento({
      empresa: datos.empresa,
      titulo: 'Orden de producción — CONTROL v2',
      derecha: { etiqueta: 'Folio', valor: String(datos.folio), grande: true },
    }),
    bandaCancelada(datos),
    bloqueFotos(datos),
    h(
      View,
      { style: estilosDoc.filaCampos, key: 'campos' },
      campo('Cliente', datos.cliente),
      campo('Etiqueta de marca', datos.etiquetaMarca),
      campo('Maquilero', datos.maquilero),
      campo('Fecha', datos.fecha),
      campo('Fecha de entrega', datos.fechaEntrega),
      campo('Estado', datos.estado),
      campo(
        'Modelo',
        `${datos.codigoModelo}${datos.descripcionModelo ? ` — ${datos.descripcionModelo}` : ''}`,
        true,
      ),
      campo('Composición', datos.composicion, true),
    ),
    datos.observaciones
      ? h(
          View,
          { style: estilosDoc.campoDosTercios, key: 'obs' },
          h(Text, { style: estilosDoc.etiquetaCampo }, 'Observaciones'),
          h(Text, { style: estilosDoc.valorCampoTexto }, datos.observaciones),
        )
      : null,
    datos.obsMaquila
      ? h(
          View,
          { style: estilosDoc.campoDosTercios, key: 'obsm' },
          h(Text, { style: estilosDoc.etiquetaCampo }, 'Observaciones de maquila'),
          h(Text, { style: estilosDoc.valorCampoTexto }, datos.obsMaquila),
        )
      : null,
    tablaMatriz(datos),
    seccionLista(
      'Telas',
      datos.telas.map((t) => `${t.nombre} (consumo ${t.consumoPorPrenda} / prenda)`),
    ),
    seccionLista(
      'Bordados',
      datos.bordados.map(
        (b) => `${b.nombre} (${b.tipo === 'ESTAMPADO' ? 'Estampado' : 'Bordado'})`,
      ),
    ),
    seccionLista(
      'Habilitación',
      datos.habilitacion.map(
        (a) => `${a.clave} — ${a.descripcion} (consumo ${a.consumoPorPrenda} / prenda)`,
      ),
    ),
    PieDocumento({
      contexto: `CONTROL v2 · ${datos.empresa} · Orden ${datos.folio} · ${datos.totalPiezas} piezas`,
    }),
  ];

  return h(
    Page,
    { key: clave, size: 'A4', style: estilosDoc.pagina },
    ...hijos.filter((x) => x !== null),
  );
}

/** Documento de N órdenes (una por página). */
function documentoOrdenes(ordenes: DatosImpresoOrden[]): ReactElement<DocumentProps> {
  const titulo =
    ordenes.length === 1 && ordenes[0] !== undefined
      ? `Orden ${ordenes[0].folio}`
      : `Órdenes de producción (${ordenes.length})`;
  return h(
    Document,
    { title: titulo, author: ordenes[0]?.empresa ?? 'CONTROL v2', subject: 'Orden de producción' },
    ...ordenes.map((datos, i) => paginaOrden(datos, `pagina-${i}`)),
  );
}

// ── Generación del Buffer (funciones puras: reciben datos resueltos) ─────────────────────────────

/** Genera el PDF (Buffer) de UNA orden a partir de sus datos ya resueltos. */
export async function generarPdfOrden(datos: DatosImpresoOrden): Promise<Buffer> {
  return renderToBuffer(documentoOrdenes([datos]));
}

/**
 * Genera UN solo PDF consolidado de VARIAS órdenes (una por página, salto entre órdenes), a partir
 * de sus datos ya resueltos. Las órdenes salen en el mismo orden de la lista recibida.
 */
export async function generarPdfOrdenes(ordenes: DatosImpresoOrden[]): Promise<Buffer> {
  return renderToBuffer(documentoOrdenes(ordenes));
}

// ── Orquestación de alto nivel (resuelve datos + genera) — la usa la ruta ────────────────────────

/** Resultado de generar el impreso de una sola orden (Buffer + folio para el `filename`). */
export interface ImpresoOrden {
  buffer: Buffer;
  folio: number;
}

/** Resuelve los datos de UNA orden (A9) y devuelve su PDF + el folio para el nombre del archivo. */
export async function impresoOrden(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
  deps: DepsImpreso = {},
): Promise<ImpresoOrden> {
  const datos = await armarDatosImpresoOrden(sesion, id, bd, deps);
  const buffer = await renderizarPdfEnWorker('orden', datos);
  return { buffer, folio: datos.folio };
}

/**
 * Resuelve los datos de VARIAS órdenes (en el orden de `ids`, todas de la empresa activa — A9) y
 * devuelve UN solo PDF consolidado (una orden por página). Si algún id no existe / no es de la
 * empresa activa, `armarDatosImpresoOrden` lanza `ErrorNoEncontrado` (404) y NO se genera nada.
 */
export async function impresoOrdenes(
  sesion: SesionUsuario,
  ids: number[],
  bd?: ContextoBd,
  deps: DepsImpreso = {},
): Promise<Buffer> {
  // Secuencial para que un id inválido falle con un 404 claro (y para no abrir N descargas a la vez).
  const ordenes: DatosImpresoOrden[] = [];
  for (const id of ids) {
    ordenes.push(await armarDatosImpresoOrden(sesion, id, bd, deps));
  }
  return renderizarPdfEnWorker('ordenes', ordenes);
}
