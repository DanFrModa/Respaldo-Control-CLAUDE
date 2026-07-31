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
 *  • Sección AVÍOS = los avíos del modelo marcados `paraProduccion` (rotulada "Avíos" — el
 *    renombrado de vocabulario de Daniel; la estructura interna sigue llamándose `habilitacion`).
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
 *
 * Artes (petición Daniel, jul-2026): además de las fotos del MODELO, el impreso incluye en la
 * sección "Artes (imágenes)" las FOTOS DE LOS BORDADOS/ESTAMPADOS del BOM (el arte propiamente
 * dicho, con su nombre debajo) y las IMÁGENES SUBIDAS A LA ORDEN (adjuntos F8-E6 con `tipoMime`
 * image/*), todas con el MISMO patrón de descarga best-effort. Daniel unificó el vocabulario:
 * bordado/estampado = ARTE, así que la sección de texto se rotula "Arte" (el subtipo
 * Bordado/Estampado se conserva por renglón).
 *
 * Imagen PRINCIPAL (petición Daniel, 25-jul-2026): el modelo tiene una FOTO principal (la primera
 * de su galería) y un ARTE principal (el primero de su BOM). En el impreso las dos van PRIMERO en
 * su bloque y están BLINDADAS contra los topes (`recortarFotos`/`recortarArtes`): pase lo que pase,
 * si se pudieron bajar, se imprimen. No hay bandera en BD: "principal" = ser el primero por `orden`.
 *
 * Tela (petición Daniel, jul-2026): el campo TELA del encabezado ya no depende solo de lo que se
 * capturó a mano en la orden (`Orden.idTela`): se arma con la(s) tela(s) que REALMENTE se
 * compraron para esa orden — las líneas de OC de tela ligadas a la OP (mismo criterio que el
 * `ocTelaFolio` del centro de comando) — y solo cae al valor manual si no hay ninguna OC.
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
  TIPO,
  EncabezadoDocumento,
  PieDocumento,
  TituloSeccion,
  BandaEstado,
} from '../../../comun/impresos-estilos.js';

import { servicioArchivos, type ServicioArchivos } from '../../../comun/archivos.js';
import { verificarPermiso, type SesionUsuario } from '../../../comun/permisos.js';
import { clienteLectura, type ContextoBd, type Tx } from '../../../comun/transaccion.js';
import { leerBom } from '../../modelos/bom-modelo.js';
// Se lee a BAJO NIVEL (`leerFotosModelo`, sin `verificarPermiso(modelos.ver)`) a propósito: la
// impresión ya está autorizada por `ordenes.ver` y las fotos del modelo son parte del documento de
// la orden. Exigir `modelos.ver` haría que un rol con `ordenes.ver` pero sin `modelos.ver` reciba
// 403 y truene el PDF entero, contradiciendo el degradado best-effort de fotos.
import { leerFotosModelo } from '../../modelos/fotos-modelo.js';
// Los ARTES (imágenes subidas a la orden, F8-E6) sí se leen por `listarAdjuntos`: ese servicio
// exige exactamente `ordenes.ver` (el mismo permiso que ya autoriza esta impresión), así que no
// introduce ningún 403 nuevo; la descarga de sus bytes es igual de best-effort que las fotos.
import { listarAdjuntos, type AdjuntoOrdenConUrl } from '../adjuntos-orden.js';
import { obtenerOrden } from '../ordenes.js';

// ── Datos resueltos del impreso (forma PURA: ya sin red ni BD) ──────────────────────────────────

/** Una foto del modelo ya descargada, lista para incrustar como `<Image src>` (data-URL). */
export interface FotoImpreso {
  /** Data-URL `data:<mime>;base64,...` con los bytes de la imagen. */
  dataUrl: string;
  /**
   * Rótulo opcional debajo de la imagen (lo usan los ARTES del BOM: el nombre del
   * bordado/estampado). Las fotos del modelo y los adjuntos de la orden van sin rótulo.
   */
  titulo?: string;
  /**
   * ¿Es la imagen PRINCIPAL de su bloque (jul-2026, petición de Daniel)? La marca la primera FOTO
   * del modelo y el primer ARTE del BOM (los dos "principales" que el usuario elige en la ficha
   * del modelo). Su efecto en el impreso es una GARANTÍA: {@link recortarFotos}/{@link recortarArtes}
   * la ponen al frente y NUNCA la dejan fuera del tope, aunque el bloque se recorte. A lo sumo hay
   * una por bloque; si no viene ninguna, los topes se comportan como siempre (las primeras N).
   *
   * Hay DOS casos sin principal marcada, ambos a propósito: (1) la imagen de la principal no se
   * pudo bajar de R2 (best-effort) y (2) el arte principal del BOM NO tiene foto — el segundo arte
   * **no hereda** el papel (ser principal es una decisión sobre un arte concreto, no un puesto que
   * se transfiera). En los dos casos el bloque se comporta como antes de esta mejora.
   */
  principal?: boolean;
}

/** Un renglón de la sección TELAS del impreso (solo nombre, sin precio). */
export interface TelaImpreso {
  nombre: string;
  consumoPorPrenda: number;
}

/** Un renglón de la sección AVÍOS (avíos del BOM `paraProduccion`; sin precio). */
export interface AvioImpreso {
  clave: string;
  descripcion: string;
  consumoPorPrenda: number;
}

/** Un renglón de la sección ARTE (solo nombre/subtipo; SIN precio, decisión del dueño). */
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
  /**
   * Pedido/OC del cliente (petición Daniel): la referencia PRINCIPAL (`referencias[0]`) o el `ocCliente`.
   * OPCIONAL: hay órdenes capturadas a mano SIN referencia del cliente (el encabezado muestra "—").
   */
  pedidoCliente?: string | null;
  etiquetaMarca: string | null;
  maquilero: string | null;
  codigoModelo: string;
  descripcionModelo: string | null;
  composicion: string | null;
  /**
   * TELA del encabezado (petición Daniel, jul-2026): la(s) tela(s) COMPRADAS para esta orden,
   * derivadas de las líneas de OC de tela ligadas a la OP (con su folio de OC), o —si no hay
   * ninguna— la tela capturada a mano en la orden. `null` solo si no hay ni una ni otra.
   */
  tela: string | null;
  observaciones: string | null;
  obsMaquila: string | null;
  /** Etiquetas de talla en el orden en que aparecen en la matriz (columnas de la tabla). */
  tallas: string[];
  /** Renglones color × talla; `cantidades[i]` alinea con `tallas[i]` (0 si la talla no aplica). */
  renglones: { color: string; pantone: string | null; cantidades: number[]; totalFila: number }[];
  /** Total por columna (alinea con `tallas`). */
  totalesColumna: number[];
  /** Total general de la orden (debe CUADRAR con `OrdenSalida.totalPiezas`). */
  totalPiezas: number;
  telas: TelaImpreso[];
  bordados: BordadoImpreso[];
  habilitacion: AvioImpreso[];
  fotos: FotoImpreso[];
  /**
   * ARTES (petición Daniel, jul-2026), ya descargados best-effort igual que `fotos`, en orden:
   * primero las FOTOS DE LOS BORDADOS/ESTAMPADOS del BOM (cada una con su nombre como `titulo`) y
   * después las IMÁGENES subidas como adjuntos de la orden (F8-E6, `tipoMime` image/*, sin
   * rótulo). Sección propia "Artes (imágenes)" en el impreso; vacío = la sección no se pinta.
   */
  artes: FotoImpreso[];
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

/** Una tela COMPRADA para la orden: la tela del catálogo + el folio de la OC que la pidió. */
export interface TelaCompradaOrden {
  /** Id de catálogo: es la LLAVE del dedup (dos telas distintas pueden llamarse igual). */
  idTela: number;
  nombre: string;
  folioOc: number;
}

/** Lectura de las telas compradas para una orden (seam de DI: los tests la inyectan). */
export type LeerTelasCompradas = (cliente: Tx, idOrden: number) => Promise<TelaCompradaOrden[]>;

/**
 * Telas REALMENTE compradas para una orden: las líneas de OC de tela ligadas a la OP (R7,
 * `OrdenCompraLinea.idOrden`), con el MISMO criterio que el `ocTelaFolio` del centro de comando
 * (línea de tela + OC que no esté en borrador ni cancelada). Orden estable y determinista: por OC
 * (de la más vieja a la más nueva) y luego por renglón. Lectura pura (sin permisos: la impresión
 * ya está autorizada por `ordenes.ver` y la orden ya se resolvió por la empresa activa, A9).
 */
export const leerTelasCompradasOrden: LeerTelasCompradas = async (cliente, idOrden) => {
  const lineas = await cliente.ordenCompraLinea.findMany({
    where: {
      idOrden,
      idTela: { not: null },
      ordenCompra: { estatus: { notIn: ['borrador', 'cancelada'] } },
    },
    orderBy: [{ idOrdenCompra: 'asc' }, { id: 'asc' }],
    select: {
      idTela: true,
      tela: { select: { nombre: true } },
      ordenCompra: { select: { numCompra: true } },
    },
  });
  return lineas.flatMap((linea) =>
    linea.idTela === null || linea.tela === null
      ? []
      : [
          {
            idTela: linea.idTela,
            nombre: linea.tela.nombre,
            folioOc: Number(linea.ordenCompra.numCompra),
          },
        ],
  );
};

/**
 * Arma el TEXTO de la tela del encabezado a partir de las telas compradas: una tela por
 * `idTela` (el dedup va por ID, NO por nombre: dos telas distintas del catálogo pueden llamarse
 * igual y no deben fundirse en un renglón), conservando el orden de aparición y con su(s)
 * folio(s) de OC entre paréntesis; varias telas se separan con " · " (p. ej.
 * `Chifón (OC 334) · Forro (OC 335)`). Sin compras → `null` (el llamador cae al valor capturado
 * a mano en la orden).
 */
export function textoTelaComprada(telas: TelaCompradaOrden[]): string | null {
  const porTela = new Map<number, { nombre: string; folios: number[] }>();
  for (const tela of telas) {
    const entrada = porTela.get(tela.idTela) ?? { nombre: tela.nombre, folios: [] };
    if (!entrada.folios.includes(tela.folioOc)) {
      entrada.folios.push(tela.folioOc);
    }
    porTela.set(tela.idTela, entrada);
  }
  if (porTela.size === 0) {
    return null;
  }
  return [...porTela.values()]
    .map(({ nombre, folios }) => `${nombre} (OC ${folios.join(', ')})`)
    .join('  ·  ');
}

/**
 * Dependencias inyectables de la resolución de datos. Por defecto usa los servicios REALES
 * (R2 + fetch + las lecturas de dominio que el impreso REUSA). Los tests inyectan fakes para no
 * tocar BD ni R2. `obtenerOrden`/`leerBom`/`leerFotosModelo`/`listarAdjuntos`/`leerTelasCompradas`
 * son seams de DI (no se reimplementa nada: el default es exactamente la función que ya existe).
 */
export interface DepsImpreso {
  archivos?: ServicioArchivos;
  descargarImagen?: DescargarImagen;
  obtenerOrden?: typeof obtenerOrden;
  leerBom?: typeof leerBom;
  leerFotosModelo?: typeof leerFotosModelo;
  listarAdjuntos?: typeof listarAdjuntos;
  leerTelasCompradas?: LeerTelasCompradas;
}

/**
 * Proyecta la matriz de la orden (lista de colores, cada uno con sus tallas) a la tabla
 * color × talla del impreso: columnas = unión ordenada de tallas que aparecen (preservando el
 * orden en que se ven), filas = colores, con totales por fila, por columna y total general.
 */
export function armarTabla(
  lineas: {
    color: string;
    pantone?: string | null;
    tallas: { etiquetaTalla: string; cantidad: number }[];
  }[],
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
    return { color: linea.color, pantone: linea.pantone ?? null, cantidades, totalFila };
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
  const listarAdjuntosOrden = deps.listarAdjuntos ?? listarAdjuntos;
  const leerTelasOc = deps.leerTelasCompradas ?? leerTelasCompradasOrden;

  // `obtenerOrden` ya verifica permiso + empresa activa (A9) y deriva la matriz/total. Va PRIMERO:
  // si la orden no es de la empresa activa, fallamos con 404 antes de tocar R2 (servicioArchivos()).
  const orden = await obtener(sesion, id, bd);

  const archivos = deps.archivos ?? servicioArchivos();
  const cliente = clienteLectura(bd);
  const bom = await leer(cliente, orden.idModelo);
  const fotos = await leerFotos(orden.idModelo, bd, archivos);

  // TELA (petición Daniel): la que de verdad se compró para la orden. BEST-EFFORT: si la lectura
  // truena, el impreso degrada al valor capturado a mano en la orden (jamás se trunca el PDF).
  let telaComprada: string | null = null;
  try {
    telaComprada = textoTelaComprada(await leerTelasOc(cliente, id));
  } catch (error) {
    console.warn(
      `No se pudo leer la tela comprada (OC) de la orden ${String(id)} para su impreso.`,
      error,
    );
  }

  // ARTES del MODELO: las fotos de los bordados/estampados del BOM. Presignar es una llamada a R2
  // por arte → BEST-EFFORT **POR IMAGEN** (`allSettled`, no `all`): si la key de un arte truena,
  // se pierde ESA imagen y las demás siguen saliendo (mismo criterio que la descarga de bytes).
  // El BOM llega ORDENADO (`leerBordadosBom`), así que su PRIMER renglón es el arte PRINCIPAL: se
  // marca para que el tope de la rejilla jamás lo recorte (Daniel, jul-2026).
  const artesBom = bom.bordados.flatMap((b, i) =>
    b.keyFoto === null ? [] : [{ titulo: b.nombre, key: b.keyFoto, principal: i === 0 }],
  );
  const presignados = await Promise.allSettled(
    artesBom.map(async (arte) => ({
      titulo: arte.titulo,
      principal: arte.principal,
      urlDescarga: await archivos.urlDescarga(arte.key),
    })),
  );
  const urlsArteBom = presignados.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
  const primerFallo = presignados.find((r): r is PromiseRejectedResult => r.status === 'rejected');
  if (primerFallo !== undefined) {
    console.warn(
      `No se pudieron presignar ${String(presignados.length - urlsArteBom.length)} foto(s) del arte (BOM) de la orden ${String(id)} para su impreso.`,
      primerFallo.reason,
    );
  }

  // ARTES: los adjuntos de la orden (F8-E6) que sean IMAGEN (`tipoMime` image/*). `listarAdjuntos`
  // exige el mismo `ordenes.ver` que ya autoriza esta impresión (no introduce 403 nuevos), pero
  // presigna TODOS los adjuntos antes de que podamos filtrar por MIME (filtrar antes exigiría
  // cambiarle la firma al servicio) → la llamada entera es BEST-EFFORT: si falla (R2 caído, etc.),
  // el impreso sale igual SIN artes; jamás se trunca el PDF por los adjuntos.
  let adjuntosImagen: AdjuntoOrdenConUrl[] = [];
  try {
    const adjuntos = await listarAdjuntosOrden(sesion, id, bd, archivos);
    adjuntosImagen = adjuntos.filter((a) => a.tipoMime.startsWith('image/'));
  } catch (error) {
    // Mismo patrón tenue que el resto del módulo de adjuntos: se loguea y se sigue sin artes.
    console.warn(
      `No se pudieron leer los adjuntos (artes) de la orden ${id} para su impreso.`,
      error,
    );
  }

  // Fotos y artes (del BOM y de la orden): se bajan en paralelo y se descartan las que no se
  // pudieron obtener (best-effort: una imagen caída JAMÁS trunca el impreso).
  const [dataUrls, dataUrlsArteBom, dataUrlsArtes] = await Promise.all([
    Promise.all(fotos.map((f) => descargarImagen(f.urlDescarga))),
    Promise.all(urlsArteBom.map((a) => descargarImagen(a.urlDescarga))),
    Promise.all(adjuntosImagen.map((a) => descargarImagen(a.urlDescarga))),
  ]);
  // La PRIMERA foto del modelo (las fotos llegan ordenadas por `orden`) es la PRINCIPAL: se marca
  // para que el bloque de fotos la ponga al frente y el tope nunca la recorte. Si esa foto no se
  // pudo bajar, simplemente no hay principal (best-effort de siempre) y las demás salen igual.
  const fotosImpreso: FotoImpreso[] = dataUrls.flatMap((dataUrl, i) =>
    dataUrl === null ? [] : [i === 0 ? { dataUrl, principal: true } : { dataUrl }],
  );
  // El arte del BOM va PRIMERO (es el arte del modelo) y lleva su nombre como rótulo; luego las
  // imágenes subidas a la orden (sin rótulo, como hasta hoy).
  const artesModelo: FotoImpreso[] = dataUrlsArteBom.flatMap((dataUrl, i) => {
    const arte = urlsArteBom[i];
    if (dataUrl === null || arte === undefined) {
      return [];
    }
    return [
      {
        dataUrl,
        ...(arte.titulo === undefined ? {} : { titulo: arte.titulo }),
        ...(arte.principal ? { principal: true } : {}),
      },
    ];
  });
  const artesImpreso: FotoImpreso[] = dataUrlsArtes
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
    // Pedido/OC del cliente: la referencia PRINCIPAL (la 1ª D7 — "Pedido cliente" de C&A) o, si no hay
    // referencias, el snapshot `ocCliente`. Así la OC del cliente "vive" también en el impreso (Daniel).
    pedidoCliente: orden.referencias[0]?.valor ?? orden.ocCliente,
    etiquetaMarca: orden.etiquetaMarca,
    maquilero: orden.maquilero,
    codigoModelo: orden.codigoModelo,
    descripcionModelo: orden.descripcionModelo,
    composicion: orden.composicion,
    // Tela: primero la COMPRADA (OC ligadas a la orden); si no hay ninguna, la capturada a mano.
    tela: telaComprada ?? orden.tela,
    observaciones: orden.observaciones,
    obsMaquila: orden.obsMaquila,
    ...tabla,
    // Telas y Avíos: SOLO los marcados `paraProduccion`. Arte: todo el del BOM.
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
    // Primero el arte del MODELO (fotos de los bordados del BOM), luego el subido a la orden.
    artes: [...artesModelo, ...artesImpreso],
  };
}

// ── Documento PDF (react-pdf, sin JSX: `createElement`) ──────────────────────────────────────────

const estilos = StyleSheet.create({
  // Estilos PROPIOS de esta orden (lo compartido vive en `estilosDoc`).
  //
  // TÍTULO del documento (petición Daniel, jul-2026): "ORDEN DE PRODUCCIÓN" tiene que LEERSE como
  // el título de la hoja (antes iba de subtítulo tenue de 8 pt dentro del encabezado compartido),
  // al estilo del impreso viejo de FR Moda: grande, arriba a la izquierda, bajo el membrete.
  //
  // PRESUPUESTO DE ALTURA (el impreso vive en UNA hoja; A4 = 841.9 pt − 34 de `paddingTop` − 52 de
  // `paddingBottom` ≈ 756 pt útiles; ancho útil = 595 − 80 ≈ 515 pt):
  //  • Título: 16 pt × 1.2 (lineHeight de Helvetica) + 6 de `marginBottom` ≈ 25 pt.
  //  • Compensación en el bloque de fotos: alto 130 → 120 y `marginBottom` 12 → 8 = −14 pt, pero
  //    SOLO cuando la orden trae fotos (sin fotos el bloque ni se pinta) → neto ≈ +11 pt con
  //    fotos, +25 pt sin fotos (y esas hojas son justo las más holgadas).
  //  • La rejilla de ARTES es la que de verdad desbordaba (no tenía tope): se capó a `MAX_ARTES`
  //    y sus tarjetas se compactaron a 80 × 88 (≈ 98 pt por fila con rótulo, contra ~140 de las
  //    tarjetas de 110 × 120 del bloque de fotos) → −42 pt por fila de artes.
  // Medido contando páginas del PDF renderizado (regex `/Type /Page`) contra la versión anterior:
  // en las órdenes CON ARTE esta versión pagina igual o mejor (13 escenarios que se iban a 2 hojas
  // ahora caben en 1, y ninguno empeora); en las órdenes SIN ARTE el título cuesta ~1 renglón de
  // capacidad (p. ej. 3 colores con fotos: 6 → 5 renglones de lista en una hoja), porque ahí no hay
  // palanca que lo compense — es el precio del título que pidió Daniel, asumido a conciencia. La
  // prueba "una orden densa con fotos y 4 artes cabe en UNA página" del `.test.ts` cuida el tope.
  tituloDocumento: {
    fontSize: 16,
    fontFamily: FUENTE.negrita,
    color: PALETA.tinta,
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  fotos: { flexDirection: 'row', marginBottom: 8, gap: 8 },
  foto: {
    width: 110,
    height: 120,
    objectFit: 'contain',
    borderWidth: 1,
    borderColor: PALETA.borde,
  },
  // Artes: tarjeta MÁS CHICA que la del bloque de fotos (son miniaturas de referencia del arte, no
  // la foto de la prenda), en fila que ENVUELVE y con rótulo opcional debajo (el nombre del
  // bordado/estampado del BOM). 4 × 80 + 3 × 8 = 344 pt: una sola fila con holgura.
  artes: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  arte: { width: 80 },
  arteFoto: {
    width: 80,
    height: 88,
    objectFit: 'contain',
    borderWidth: 1,
    borderColor: PALETA.borde,
  },
  arteTitulo: { fontSize: TIPO.pie, color: PALETA.muted, marginTop: 2, textAlign: 'center' },
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
    // A PROPÓSITO se muestran hasta MAX_FOTOS (la principal SIEMPRE, luego las que sigan por
    // orden): es una hoja de PISO de producción, no una galería; más desbordaría el encabezado.
    ...recortarFotos(datos.fotos).map((foto, i) =>
      h(Image, { key: `foto-${i}`, style: estilos.foto, src: foto.dataUrl }),
    ),
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
      h(
        Text,
        { style: [estilosDoc.celda, estilos.colColor] },
        r.pantone ? `${r.color}  ·  PANTONE ${r.pantone}` : r.color,
      ),
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

/**
 * Tope de imágenes de la rejilla de ARTES. Igual que las fotos del modelo (capadas a 3), esta hoja
 * es de PISO, no una galería. El tope real es de ALTURA, no de ancho: en el ancho útil (515 pt)
 * cabrían 6 tarjetas de 80, pero cada fila de artes cuesta ≈ 98 pt y sin tope un modelo con varios
 * bordados con foto + adjuntos metía 2-3 filas y se iba a segunda hoja. Lo que se recorta NO se
 * esconde: el TÍTULO de la sección dice cuántas se muestran del total (avisar ahí cuesta 0 pt de
 * altura) y la lista de texto "Arte" sigue enumerando TODOS los bordados/estampados del modelo.
 *
 * El ARTE PRINCIPAL (el primero del BOM) está GARANTIZADO: `recortarArtes` lo antepone antes de
 * cortar, así que ocupa la posición 0 y el tope jamás lo deja fuera (Daniel, jul-2026).
 *
 * ⚠️ LIMITACIÓN CONOCIDA (pendiente de decisión de Daniel, ver `docs/modulos/impreso-orden.md`): el
 * tope se aplica al arreglo completo y el arte del BOM va primero, así que un ADJUNTO recortado no
 * aparece en ningún lado salvo en el conteo del título (los bordados del BOM sí quedan siempre en la
 * lista de texto). Con 5+ bordados con foto, los adjuntos de la orden no se ven.
 */
export const MAX_ARTES = 4;

/** Tope de fotos del MODELO en el encabezado (bloque `bloqueFotos`). Igual que antes: 3. */
export const MAX_FOTOS = 3;

/**
 * Pone al frente la imagen marcada como `principal` (si la hay), conservando el orden relativo de
 * las demás. Junto con el `slice` del tope es lo que garantiza que la foto principal del modelo y
 * el arte principal SIEMPRE se impriman y salgan PRIMERO, aunque el bloque se recorte (Daniel,
 * jul-2026). Pura y estable: sin principal (o si ya va al frente) devuelve el arreglo tal cual.
 *
 * ⚠️ En el pipeline REAL nunca mueve nada: el orden lo fija la BD (`leerFotosModelo` /
 * `leerBordadosBom` ya devuelven la principal en la posición 0) y `armarDatosImpresoOrden` solo la
 * MARCA. Esto es CINTURÓN (defensa en profundidad) por si mañana se reordena la entrada — p. ej. si
 * los adjuntos de la orden pasaran antes del arte del BOM, o si alguien arma los datos a mano.
 */
export function anteponerPrincipal(imagenes: FotoImpreso[]): FotoImpreso[] {
  const indice = imagenes.findIndex((imagen) => imagen.principal === true);
  const principal = indice <= 0 ? undefined : imagenes[indice];
  if (principal === undefined) {
    return imagenes;
  }
  return [principal, ...imagenes.slice(0, indice), ...imagenes.slice(indice + 1)];
}

/**
 * Aplica el tope de la rejilla de ARTES: la principal al frente ({@link anteponerPrincipal}) y las
 * primeras {@link MAX_ARTES} imágenes; devuelve además cuántas quedaron fuera (para el aviso del
 * título). Como el tope es ≥ 1 y la principal quedó en la posición 0, el ARTE PRINCIPAL nunca se
 * recorta. Función pura, exportada para probar el criterio sin renderizar.
 */
export function recortarArtes(artes: FotoImpreso[]): { mostradas: FotoImpreso[]; ocultas: number } {
  const mostradas = anteponerPrincipal(artes).slice(0, MAX_ARTES);
  return { mostradas, ocultas: artes.length - mostradas.length };
}

/**
 * Mismo criterio para las FOTOS del modelo del encabezado: la principal al frente y hasta
 * {@link MAX_FOTOS}. No devuelve conteo porque ese bloque no lleva título donde avisarlo (la
 * cantidad de fotos no es información de piso, a diferencia del arte).
 */
export function recortarFotos(fotos: FotoImpreso[]): FotoImpreso[] {
  return anteponerPrincipal(fotos).slice(0, MAX_FOTOS);
}

/**
 * Sección "Artes (imágenes)" (petición Daniel, jul-2026): las fotos de los BORDADOS/ESTAMPADOS del
 * BOM (con su nombre debajo) y las IMÁGENES subidas a la orden (adjuntos F8-E6 con `tipoMime`
 * image/*), ya descargadas best-effort, capadas a {@link MAX_ARTES}. Sin artes NO se pinta nada
 * (ni el título): el impreso histórico queda idéntico.
 */
function bloqueArtes(datos: DatosImpresoOrden): ReactElement | null {
  if (datos.artes.length === 0) {
    return null;
  }
  const { mostradas, ocultas } = recortarArtes(datos.artes);
  // El aviso de truncado va EN EL TÍTULO de la sección, no en una leyenda aparte: así el conteo
  // total sigue a la vista sin costar un renglón extra de altura (que en las órdenes pesadas es
  // justo lo que empujaba el impreso a una segunda hoja).
  const titulo =
    ocultas === 0
      ? 'Artes (imágenes)'
      : `Artes (imágenes) — se muestran ${String(mostradas.length)} de ${String(datos.artes.length)}`;
  return h(
    View,
    { style: estilosDoc.seccion },
    TituloSeccion(titulo),
    h(
      View,
      { style: estilos.artes },
      ...mostradas.map((arte, i) =>
        h(
          View,
          { key: `arte-${i}`, style: estilos.arte },
          h(Image, { style: estilos.arteFoto, src: arte.dataUrl }),
          arte.titulo === undefined ? null : h(Text, { style: estilos.arteTitulo }, arte.titulo),
        ),
      ),
    ),
  );
}

/** Sección de lista simple (Telas / Arte / Avíos), con su texto o un "—" si va vacía. */
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
      titulo: 'CONTROL v2 · hoja de piso de producción',
      // "Orden", no "Folio" (petición Daniel, jul-2026): el impreso dice "Orden 5341".
      derecha: { etiqueta: 'Orden', valor: String(datos.folio), grande: true },
    }),
    // Título GRANDE del documento (petición Daniel, jul-2026), justo debajo del membrete.
    h(Text, { key: 'titulo', style: estilos.tituloDocumento }, 'ORDEN DE PRODUCCIÓN'),
    bandaCancelada(datos),
    bloqueFotos(datos),
    h(
      View,
      { style: estilosDoc.filaCampos, key: 'campos' },
      campo('Cliente', datos.cliente),
      campo('Pedido cliente', datos.pedidoCliente ?? null),
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
      // Tela COMPRADA para la orden (OC ligada), o la capturada a mano si no hay compra.
      campo('Tela', datos.tela),
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
    // "Arte", no "Bordados" (Daniel unificó el vocabulario: bordado/estampado = ARTE). El SUBTIPO
    // sí se conserva por renglón ("Bordado"/"Estampado").
    seccionLista(
      'Arte',
      datos.bordados.map(
        (b) => `${b.nombre} (${b.tipo === 'ESTAMPADO' ? 'Estampado' : 'Bordado'})`,
      ),
    ),
    // "Avíos", no "Habilitación" (mismo renombrado de vocabulario de Daniel que ya rige en toda la
    // app; este archivo no se pudo tocar en su momento y quedó con el rótulo viejo).
    seccionLista(
      'Avíos',
      datos.habilitacion.map(
        (a) => `${a.clave} — ${a.descripcion} (consumo ${a.consumoPorPrenda} / prenda)`,
      ),
    ),
    bloqueArtes(datos),
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
  // El LOGO del membrete se resuelve por la empresa ACTIVA de la sesión (A9), igual que el nombre
  // que ya sale de `sesion.nombreEmpresaActiva`: sin esto el PDF mezclaría el texto de una empresa
  // con el logo de la predeterminada.
  const buffer = await renderizarPdfEnWorker('orden', datos, {
    idEmpresa: sesion.idEmpresaActiva,
  });
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
  // Mismo criterio de A9 que `impresoOrden`: el logo sale de la empresa ACTIVA de la sesión (todas
  // las órdenes del lote son de ella, `armarDatosImpresoOrden` ya lo garantiza).
  return renderizarPdfEnWorker('ordenes', ordenes, { idEmpresa: sesion.idEmpresaActiva });
}
