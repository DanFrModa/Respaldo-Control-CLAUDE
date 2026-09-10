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
 *  • Sección AVÍOS = los avíos de la RECETA DE LA ORDEN marcados `paraProduccion` y no excluidos
 *    (V1-E3d: el papel dice lo que ESTA orden lleva, no lo que lleva la plantilla) (rotulada "Avíos" — el
 *    renombrado de vocabulario de Daniel; la estructura interna sigue llamándose `habilitacion`).
 *  • Impresión por lote = UN solo PDF consolidado, una orden por página (salto entre órdenes).
 *
 * Innegociables aplicados:
 *  • A1 — TODA la lógica de armado vive aquí (dominio); la ruta (corte 2) solo valida permiso+Zod
 *    y delega. A4 — `verificarPermiso(sesion, 'ordenes.ver')`. A9 — la orden se resuelve por
 *    `obtenerOrden`, que filtra por la empresa activa de la sesión (una orden de otra empresa, para
 *    esta sesión, no existe → `ErrorNoEncontrado`/404).
 *  • REUSO — los datos se arman con lo que ya existe: `obtenerOrden` (encabezado + matriz + total),
 *    `leerRecetaParaImpreso` (telas/avíos y el ARTE **de la RECETA DE LA ORDEN**, V1-E3d),
 *    `leerBom` (solo para la FOTO de cada arte, que vive en el modelo) y `listarFotos`. NO se reinventa.
 *
 * Fotos: se incrustan en el PDF bajando los bytes del objeto R2 (vía la URL GET prefirmada que da
 * `listarFotos`) y degradando con ELEGANCIA: el PDF se renderiza igual aunque una imagen no se
 * pueda obtener (jamás se trunca el impreso por una foto faltante). El servicio de archivos y la
 * descarga de bytes son INYECTABLES para los tests (sin R2 real).
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
 * su bloque y están BLINDADAS contra los topes (`recortarFotos`/`recortarArtes`): pase lo que pase
 * se imprimen —y si sus bytes no llegaron, se imprime su HUECO en ese sitio—. No hay bandera en BD:
 * "principal" = ser el primero por `orden`.
 *
 * ⭐⭐ 0.106 — ESTE PAPEL VA A PISO Y NO PUEDE MENTIR SOBRE SUS IMÁGENES. Dos correcciones con el
 * mismo origen (bajaba TODO y recortaba al pintar):
 *  • **el tope se aplica sobre lo que la orden PIDE y ANTES de presignar/bajar** — así el conteo
 *    del título ("se muestran 4 de 6") habla de lo que la prenda lleva, no de lo que R2 alcanzó a
 *    dar, y no se gastan descargas ni memoria en imágenes que se van a tirar;
 *  • **una imagen que no llega deja HUECO visible** con su rótulo y su aviso, en su sitio, en vez
 *    de desaparecer y dejar que otra ocupe su lugar. Es la cura que la ficha de arte (0.094) ya
 *    tenía; aquí faltaba, y con ella un papel que decía «3 artes» para una prenda de 5 se producía
 *    mal. Lo compartido vive en `imagenes-impreso.ts` (`recortarAlTope`, `presignarKeys`).
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

import type { EstadoOrden } from '../../../datos/index.js';
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
import { leerRecetaParaImpreso } from '../receta-orden.js';
// Se lee a BAJO NIVEL (`leerFotosModelo`, sin `verificarPermiso(modelos.ver)`) a propósito: la
// impresión ya está autorizada por `ordenes.ver` y las fotos del modelo son parte del documento de
// la orden. Exigir `modelos.ver` haría que un rol con `ordenes.ver` pero sin `modelos.ver` reciba
// 403 y truene el PDF entero, contradiciendo el degradado best-effort de fotos.
import { leerFotosModelo } from '../../modelos/fotos-modelo.js';
// Los ARTES (imágenes subidas a la orden, F8-E6) sí se leen por `listarAdjuntos`: ese servicio
// exige exactamente `ordenes.ver` (el mismo permiso que ya autoriza esta impresión), así que no
// introduce ningún 403 nuevo; la descarga de sus bytes es igual de best-effort que las fotos.
import { listarAdjuntos, type AdjuntoOrdenConUrl } from '../adjuntos-orden.js';
// Fotos del modelo que ESTA orden quitó (§Post-F9.169(b)). Lectura de BAJO NIVEL, sin permiso
// propio: la impresión ya está autorizada por `ordenes.ver` y qué fotos lleva la OP es parte del
// documento de la orden (mismo criterio que `leerFotosModelo`).
import { leerIdsFotosOcultasOrden } from '../fotos-ocultas-orden.js';
// ⭐ §Post-F9.177 — LAS FOTOS DEL ARTE SON DE LA OP: qué fotos heredadas apagó cada renglón y qué
// fotos subió ESTA orden. Lectura de BAJO NIVEL, sin permiso propio: la impresión ya está
// autorizada y qué arte lleva la OP es parte del documento de la orden.
import { leerArteOrdenParaImpreso, type ArteOrdenFotosImpreso } from '../fotos-arte-orden.js';
import {
  anteponerPrincipal,
  descargarImagenComoDataUrl,
  fotosArteDeLaOrden,
  porRondas,
  presignarKeys,
  recortarAlTope,
  type DescargarImagen,
} from './imagenes-impreso.js';
import { obtenerOrden } from '../ordenes.js';

// ── Datos resueltos del impreso (forma PURA: ya sin red ni BD) ──────────────────────────────────

/** Una imagen del papel ya resuelta: sus bytes como data-URL, o el HUECO si no se pudieron traer. */
export interface FotoImpreso {
  /**
   * Data-URL `data:<mime>;base64,...` con los bytes de la imagen, o **`null` = esta orden SÍ manda
   * esta imagen y no se pudo traer** (presign rechazado, red caída, HTTP ≠ 2xx, cuerpo vacío) → el
   * papel pinta su HUECO con el aviso. ⭐ 0.106: antes se descartaba en silencio y la siguiente
   * imagen ocupaba su lugar, así que la hoja de piso se veía completa sin estarlo.
   */
  dataUrl: string | null;
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
   * Casos SIN principal marcada, a propósito: (1) el arte principal del BOM NO tiene foto —el
   * segundo arte **no hereda** el papel: ser principal es una decisión sobre un arte concreto, no
   * un puesto que se transfiera— y (2) ESTA OP ocultó la foto principal del modelo
   * (§Post-F9.169(b)), con el mismo criterio. En los dos el bloque se comporta como siempre.
   *
   * ⭐ 0.106: que sus BYTES no lleguen ya NO la desmarca — sigue marcada, en su sitio, como HUECO.
   * Antes desaparecía, y con ella el aviso de que faltaba justo la imagen más importante.
   */
  principal?: boolean;
}

/** Un renglón de la sección TELAS del impreso (solo nombre, sin precio). */
export interface TelaImpreso {
  nombre: string;
  consumoPorPrenda: number;
}

/** Un renglón de la sección AVÍOS (avíos de la receta de la orden `paraProduccion`; sin precio). */
export interface AvioImpreso {
  clave: string;
  descripcion: string;
  consumoPorPrenda: number;
}

/** Un renglón de la sección ARTE (solo nombre/subtipo; SIN precio, decisión del dueño). */
export interface ArteImpreso {
  /** Descripción del arte (V1-E3f: el `nombre` se retiró, §Post-F9.52 punto 1). */
  descripcion: string;
  /** Nombre del TIPO, ya resuelto del catálogo único (ex enum BORDADO/ESTAMPADO). */
  tipoArte: string;
}

/**
 * Todo lo que necesita el documento PDF de UNA orden, ya RESUELTO (sin red ni BD): así
 * `generarPdfOrden`/`generarPdfOrdenes` son funciones puras y testeables. Las cantidades de la
 * matriz se proyectan a una tabla color × talla con totales por fila/columna y total general.
 */
export interface DatosImpresoOrden {
  empresa: string;
  folio: number;
  /** Estado de la orden: el TIPO del enum, NUNCA una copia literal de sus valores (0.061). */
  estado: EstadoOrden;
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
  /** Lista de TEXTO del arte del modelo (nombre + subtipo). Las IMÁGENES van en `artes`. */
  listaArte: ArteImpreso[];
  habilitacion: AvioImpreso[];
  /**
   * FOTOS del modelo que este papel imprime, **ya recortadas al tope** ({@link MAX_FOTOS}) y con
   * los HUECOS de las que no se pudieron traer (0.106). Vacío = el bloque no se pinta.
   */
  fotos: FotoImpreso[];
  /**
   * Cuántas fotos del modelo que ESTA orden manda quedaron fuera POR EL TOPE (0.106). Se cuenta
   * sobre lo PEDIDO, no sobre lo que se pudo bajar, y el bloque lo dice en su fila.
   */
  fotosOcultas: number;
  /**
   * ARTES (petición Daniel, jul-2026), ya descargados best-effort igual que `fotos` y **recortados
   * al tope** ({@link MAX_ARTES}), en orden: primero las FOTOS DE LOS BORDADOS/ESTAMPADOS del BOM
   * (cada una con su nombre como `titulo`) y después las IMÁGENES subidas como adjuntos de la
   * orden (F8-E6, `tipoMime` image/*, sin rótulo). Sección propia "Artes (imágenes)" en el
   * impreso; vacío = la sección no se pinta.
   */
  artes: FotoImpreso[];
  /**
   * Cuántas imágenes de arte que ESTA orden manda quedaron fuera POR EL TOPE (0.106). Se cuenta
   * sobre lo PEDIDO —no sobre lo que R2 alcanzó a dar— y es lo que dice el TÍTULO de la sección
   * ("se muestran 4 de 6"). Contarlo sobre lo descargado era mentir en el papel que va a piso.
   */
  artesOcultas: number;
}

/**
 * ⭐ 0.106 — Una imagen que ESTA orden manda imprimir, **antes de tocar R2**: es lo que entra al
 * tope. Sobre esta lista se cuenta lo que queda fuera y de ella salen las descargas, para que el
 * papel nunca hable de "lo que se pudo bajar" ni gaste una descarga en lo que no va a imprimir.
 */
interface ImagenPedida {
  /** Rótulo bajo la imagen (el arte del modelo); las fotos del modelo y los adjuntos van sin él. */
  titulo?: string;
  /** ¿Es la PRINCIPAL de su bloque? El tope la antepone y jamás la deja fuera. */
  principal?: boolean;
  /**
   * De dónde sale su URL de descarga: una KEY de R2 que se presigna DESPUÉS del tope (el arte del
   * modelo, cuyas keys llegan del BOM), o una URL ya prefirmada por la lectura que la trajo (las
   * fotos del modelo y los adjuntos de la orden, que se presignan antes de que este impreso pueda
   * decidir nada).
   */
  origen: { tipo: 'key'; valor: string } | { tipo: 'url'; valor: string };
}

// ── Resolución de datos (lo único que toca BD/red) ──────────────────────────────────────────────

/**
 * Descarga de imágenes del impreso. Vive en `imagenes-impreso.js` (la comparte con la FICHA DE
 * ARTE); se RE-EXPORTA porque es parte de la superficie histórica de este módulo y sus tests la
 * ejercitan desde aquí.
 */
export { descargarImagenComoDataUrl, type DescargarImagen };

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
  /** Receta CONGELADA de la orden (V1-E3d): lo que de verdad lleva ESTA orden. */
  leerRecetaParaImpreso?: typeof leerRecetaParaImpreso;
  leerFotosModelo?: typeof leerFotosModelo;
  /**
   * Fotos del modelo que ESTA orden decidió no enseñar (§Post-F9.169(b)). Devuelve ids de
   * `ModeloFoto`; vacío = la OP enseña todas (el caso normal y el de todo lo ya capturado).
   */
  leerIdsFotosOcultas?: typeof leerIdsFotosOcultasOrden;
  /**
   * ARTE de la orden con sus decisiones sobre fotos (§Post-F9.177): qué heredadas apagó cada
   * renglón y qué fotos subió la OP. Vacío = ninguna decisión, y entonces el papel se comporta
   * EXACTAMENTE como antes (el caso de todo lo ya capturado, REGLA 0-B).
   */
  leerArteOrdenFotos?: typeof leerArteOrdenParaImpreso;
  listarAdjuntos?: typeof listarAdjuntos;
  leerTelasCompradas?: LeerTelasCompradas;
}

/**
 * Etiqueta de la fila de la matriz: el color y, cuando la orden se fabrica por packs (§Post-F9.10),
 * SU TENDIDO. El pack tiene que salir en el papel: es lo que el cortador y el maquilero usan para
 * saber qué corrida están manejando, y sin él dos filas del mismo color se leerían como un error de
 * captura. En una orden sin packs es cadena vacía y la fila se imprime exactamente igual que antes.
 */
function etiquetaColorPack(color: string, pack: string): string {
  return pack.trim() === '' ? color : `${color}  ·  PACK ${pack.trim()}`;
}

/**
 * Proyecta la matriz de la orden (lista de colores, cada uno con sus tallas) a la tabla
 * color × talla del impreso: columnas = unión ordenada de tallas que aparecen (preservando el
 * orden en que se ven), filas = colores, con totales por fila, por columna y total general.
 */
export function armarTabla(
  lineas: {
    color: string;
    /** Pack / tendido del renglón (§Post-F9.10); cadena vacía en las órdenes sin packs. */
    pack: string;
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
    return {
      color: etiquetaColorPack(linea.color, linea.pack),
      pantone: linea.pantone ?? null,
      cantidades,
      totalFila,
    };
  });

  return { tallas, renglones, totalesColumna, totalPiezas };
}

/**
 * Resuelve TODOS los datos del impreso de una orden (A9: por la empresa activa de la sesión).
 * Reúsa `obtenerOrden` (encabezado + matriz + total), `leerRecetaParaImpreso` (telas/avíos y el
 * ARTE de la RECETA DE LA ORDEN, ya filtrada) y `leerFotosModelo` (fotos del modelo, cuyos bytes
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
  const leerRecetaImpreso = deps.leerRecetaParaImpreso ?? leerRecetaParaImpreso;
  const leerFotos = deps.leerFotosModelo ?? leerFotosModelo;
  const leerOcultas = deps.leerIdsFotosOcultas ?? leerIdsFotosOcultasOrden;
  const leerArteFotos = deps.leerArteOrdenFotos ?? leerArteOrdenParaImpreso;
  const listarAdjuntosOrden = deps.listarAdjuntos ?? listarAdjuntos;
  const leerTelasOc = deps.leerTelasCompradas ?? leerTelasCompradasOrden;

  // `obtenerOrden` ya verifica permiso + empresa activa (A9) y deriva la matriz/total. Va PRIMERO:
  // si la orden no es de la empresa activa, fallamos con 404 antes de tocar R2 (servicioArchivos()).
  const orden = await obtener(sesion, id, bd);

  const archivos = deps.archivos ?? servicioArchivos();
  const cliente = clienteLectura(bd);
  // ⭐ V1-E3d (§Post-F9.43): las LISTAS del papel (telas, habilitación y artes) salen de la RECETA
  // CONGELADA DE LA ORDEN, no del BOM del modelo — el piso tiene que leer lo que ESTA orden lleva.
  // Del BOM del modelo se sigue leyendo UNA sola cosa: la FOTO de cada arte (vive en el modelo; R2
  // no se clona por orden), y se casa por NOMBRE, que es la identidad del arte.
  const [bom, receta] = await Promise.all([
    leer(cliente, orden.idModelo, sesion.idEmpresaActiva),
    leerRecetaImpreso(cliente, id),
  ]);
  // ⭐⭐ V1-E3 (§Post-F9.172(b)) — la orden de un modelo nacido POR COLOR apunta al HIJO, que no
  // trae fotos propias: enseña las de su desarrollo. Esa resolución vive DENTRO de
  // `leerFotosModelo` (`idModeloDeLasFotos`: la propia gana, y si no hay, las del padre) y NO aquí
  // — resolverla antes de llamar haría que la foto PROPIA del hijo, si un día se le sube, no
  // ganara nunca. Aquí se pasa el modelo de la ORDEN, tal cual.
  const fotosDelModelo = await leerFotos(orden.idModelo, bd, archivos);

  // ⭐ §Post-F9.169(b) — LAS FOTOS QUE ESTA OP QUITÓ no salen en su papel. Daniel pidió que la foto
  // fuera "de la OP, no del desarrollo": si la pantalla deja de enseñarla y el impreso la sigue
  // imprimiendo, la mitad del sistema no se enteró. La marca vive en `OrdenFotoOculta` y **no toca
  // la foto del modelo** (D3): otra orden del mismo modelo la sigue imprimiendo.
  const ocultasEnLaOrden = new Set(await leerOcultas(cliente, id));
  // ⚠️ SER PRINCIPAL NO ES UN PUESTO QUE SE TRANSFIERA (mismo criterio que el arte principal sin
  // foto, más abajo): si esta OP ocultó la principal del modelo, esta OP se imprime SIN principal —
  // la segunda foto no hereda la estrella ni el blindaje contra el tope.
  const principalOculta =
    fotosDelModelo.length > 0 && ocultasEnLaOrden.has(fotosDelModelo[0]?.idFoto as number);
  const fotos = fotosDelModelo.filter((f) => !ocultasEnLaOrden.has(f.idFoto));

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

  /*
   * ⭐⭐ §Post-F9.177 — LO QUE **ESTA OP** DECIDIÓ SOBRE LAS FOTOS DEL ARTE, en su papel.
   *
   * La regla —de qué artes del modelo, menos las heredadas que la OP apagó, más las que la OP
   * subió, más los artes agregados a mano— vive en `imagenes-impreso.ts` y la comparte con la
   * FICHA DE ARTE (0.094): dos papeles de la misma orden no pueden decidir por separado cuál foto
   * manda, o se separan en silencio a la primera corrección.
   *
   * BEST-EFFORT como todo el bloque de imágenes: si la lectura de las decisiones truena, el papel
   * sale con el arte del modelo tal cual —el comportamiento de antes de esa etapa—, nunca truncado.
   */
  let decisionesArte: ArteOrdenFotosImpreso[] = [];
  try {
    decisionesArte = await leerArteFotos(cliente, id);
  } catch (error) {
    console.warn(
      `No se pudieron leer las decisiones de foto del arte de la orden ${String(id)} para su impreso.`,
      error,
    );
  }
  // El orden y la marca de PRINCIPAL los fija `fotosArteDeLaOrden` —recorre `bom.artes`, ORDENADO
  // por el `orden` del modelo, y conserva sólo los artes que ESTA orden lleva por su TRAZA
  // `idModeloArte`—, así que el arte principal sigue siendo el primero del modelo y el tope de la
  // rejilla jamás lo recorta (Daniel, jul-2026). Aquí todavía NO se toca R2: son keys y rótulos.
  const artesBom = fotosArteDeLaOrden(bom.artes, receta.artes, decisionesArte);

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

  /*
   * ⭐⭐ 0.106 — EL TOPE VA SOBRE LO QUE LA ORDEN **PIDE**, Y **ANTES** DE TOCAR R2.
   *
   * Hasta aquí sólo hay LISTAS (keys, URLs y rótulos): ni un byte bajado. Se recorta ahora, y sólo
   * después se presigna y se baja lo que de verdad se va a imprimir. Dos cosas que antes salían
   * mal —las dos por bajar primero y recortar al pintar—:
   *  • el conteo del título contaba sobre lo DESCARGADO: una orden con 6 imágenes de arte a la que
   *    se le caían 2 acababa mostrando 4 y diciendo «Artes (imágenes)» a secas, como si estuvieran
   *    todas. En una hoja de PISO eso se produce mal: el papel dice 3 artes y la prenda lleva 5;
   *  • una imagen caída DESAPARECÍA y su sitio lo ocupaba la siguiente —típicamente otra foto del
   *    mismo arte—, así que un arte entero podía quedar fuera del papel sin dejar rastro.
   * Y de regalo, el trabajo queda ACOTADO: como mucho MAX_FOTOS + MAX_ARTES descargas por orden
   * (antes eran todas las fotos del modelo, más todas las del arte, más todos los adjuntos — y esos
   * megas cruzaban además al worker del PDF).
   */
  const fotosPedidas: ImagenPedida[] = fotos.map((foto, i) => ({
    origen: { tipo: 'url' as const, valor: foto.urlDescarga },
    // La PRIMERA foto del modelo (llegan ordenadas por `orden`) es la PRINCIPAL: se marca para que
    // el tope la anteponga y nunca la recorte. Si ESTA OP la ocultó, este papel sale sin principal.
    ...(i === 0 && !principalOculta ? { principal: true } : {}),
  }));
  const artesPedidos: ImagenPedida[] = [
    // El arte del MODELO va PRIMERO (es el arte del modelo) y lleva su nombre como rótulo…
    ...artesBom.map((arte) => ({
      titulo: arte.titulo,
      origen: { tipo: 'key' as const, valor: arte.key },
      ...(arte.principal ? { principal: true } : {}),
    })),
    // …y detrás las imágenes subidas a la orden (sin rótulo, como hasta hoy).
    ...adjuntosImagen.map((adjunto) => ({
      origen: { tipo: 'url' as const, valor: adjunto.urlDescarga },
    })),
  ];
  // Mismo criterio y misma constante que el cinturón del render (`recortarFotos`/`recortarArtes`);
  // aquí se aplica sobre lo PEDIDO, que es lo que hace que el conteo diga la verdad.
  const { mostradas: fotosAImprimir, ocultas: fotosOcultas } = recortarAlTope(
    fotosPedidas,
    MAX_FOTOS,
  );
  const { mostradas: artesAImprimir, ocultas: artesOcultas } = recortarAlTope(
    artesPedidos,
    MAX_ARTES,
  );

  // Presign (sólo de las keys que sobrevivieron al tope) + bytes. Una imagen que no llegue queda
  // con `dataUrl: null` → HUECO en el papel, nunca un descarte mudo.
  const [fotosImpreso, artesImpreso] = await Promise.all([
    bajarImagenesPedidas(
      fotosAImprimir,
      archivos,
      descargarImagen,
      `de las fotos del modelo de la orden ${String(id)}`,
    ),
    bajarImagenesPedidas(
      artesAImprimir,
      archivos,
      descargarImagen,
      `del arte de la orden ${String(id)}`,
    ),
  ]);

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
    // Telas, Avíos y Arte: de la RECETA DE LA ORDEN, ya filtrada (`paraProduccion`, no excluidos).
    telas: receta.telas,
    listaArte: receta.artes.map((a) => ({ descripcion: a.descripcion, tipoArte: a.tipoArte })),
    habilitacion: receta.avios,
    fotos: fotosImpreso,
    fotosOcultas,
    // Primero el arte del MODELO (sus fotos), luego el subido a la orden.
    artes: artesImpreso,
    artesOcultas,
  };
}

/**
 * ⭐ 0.106 — Presigna lo que haga falta y baja los bytes de UN bloque de imágenes **ya recortado al
 * tope**, conservando el ORDEN y el RÓTULO de cada una.
 *
 * Best-effort **por imagen** y en dos capas —presign (`allSettled`, en `imagenes-impreso.ts`) y
 * descarga—: la que no llegue sale con `dataUrl: null`, que en el papel es un HUECO con su aviso.
 * Nunca lanza: un impreso jamás se trunca por una imagen que no se pudo traer.
 *
 * ⚠️ Las URLs del presign vuelven SOLO de las pedidas que traían key, así que se re-casan por
 * posición recorriendo la lista en orden; las que ya venían con URL pasan tal cual. Casarlas de
 * otro modo (filtrar y mapear por índice) es justo el corrimiento que haría que una imagen saliera
 * con el rótulo de otra.
 */
async function bajarImagenesPedidas(
  pedidas: readonly ImagenPedida[],
  archivos: ServicioArchivos,
  descargarImagen: DescargarImagen,
  contexto: string,
): Promise<FotoImpreso[]> {
  const { urls, fallos, primerMotivo } = await presignarKeys(
    pedidas.flatMap((pedida) => (pedida.origen.tipo === 'key' ? [pedida.origen.valor] : [])),
    archivos,
  );
  if (fallos > 0) {
    console.warn(
      `No se pudieron presignar ${String(fallos)} imagen(es) ${contexto} para su impreso.`,
      primerMotivo,
    );
  }
  const urlsPorPedida: (string | null)[] = [];
  let siguienteKey = 0;
  for (const pedida of pedidas) {
    if (pedida.origen.tipo === 'url') {
      urlsPorPedida.push(pedida.origen.valor);
    } else {
      urlsPorPedida.push(urls[siguienteKey] ?? null);
      siguienteKey += 1;
    }
  }
  const dataUrls = await Promise.all(
    urlsPorPedida.map(async (url) => (url === null ? null : await descargarImagen(url))),
  );
  return pedidas.map((pedida, i) => ({
    dataUrl: dataUrls[i] ?? null,
    ...(pedida.titulo === undefined ? {} : { titulo: pedida.titulo }),
    ...(pedida.principal === true ? { principal: true } : {}),
  }));
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
  // ⭐ 0.106 — el HUECO de una imagen que ESTA orden manda y no se pudo traer. MISMO tamaño y marco
  // que la imagen que sustituye: así el papel no se descuadra el día que algo falla, y se VE que
  // ahí faltaba algo (el mismo criterio que la ficha de arte de la 0.094).
  fotoHueco: {
    width: 110,
    height: 120,
    borderWidth: 1,
    borderColor: PALETA.borde,
    backgroundColor: PALETA.superficie,
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  huecoTexto: { fontSize: TIPO.pie, color: PALETA.muted, textAlign: 'center' },
  // Aviso de recorte de las FOTOS. Va DENTRO de la fila (que ya mide 120 pt de alto por la
  // tarjeta) y pegado abajo: cuesta 0 pt de altura, igual que el aviso del título de los artes.
  fotosAviso: { fontSize: TIPO.pie, color: PALETA.muted, alignSelf: 'flex-end', maxWidth: 150 },
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
  // El HUECO de una foto de arte que no llegó: mismo tamaño y marco que la tarjeta que sustituye.
  arteHueco: {
    width: 80,
    height: 88,
    borderWidth: 1,
    borderColor: PALETA.borde,
    backgroundColor: PALETA.superficie,
    justifyContent: 'center',
    paddingHorizontal: 3,
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

/**
 * Bloque de fotos del modelo (vacío si no hay ninguna que imprimir: el impreso de siempre).
 *
 * A PROPÓSITO se muestran hasta {@link MAX_FOTOS} (la principal SIEMPRE, luego las que sigan por
 * orden): es una hoja de PISO de producción, no una galería; más desbordaría el encabezado. El
 * tope ya se aplicó al armar los datos —ahí es donde ahorra descargas—; aquí se vuelve a aplicar
 * como CINTURÓN (es idempotente) por si alguien construye los datos a mano.
 *
 * ⭐ 0.106 — dos cosas que este bloque ya no calla: la foto que ESTA orden manda y **no llegó**
 * deja su HUECO en el sitio que le tocaba (antes desaparecía y la siguiente ocupaba su lugar), y
 * las que quedaron fuera por el tope se DICEN al final de la fila, donde no cuestan altura.
 */
export function bloqueFotos(datos: DatosImpresoOrden): ReactElement | null {
  if (datos.fotos.length === 0) {
    return null;
  }
  const { mostradas, ocultas } = recortarFotos(datos.fotos);
  const fueraDelTope = ocultas + datos.fotosOcultas;
  return h(
    View,
    { style: estilos.fotos },
    ...mostradas.map((foto, i) =>
      foto.dataUrl === null
        ? h(
            View,
            { key: `foto-${String(i)}`, style: estilos.fotoHueco },
            h(Text, { style: estilos.huecoTexto }, 'Esta foto del modelo no se pudo traer.'),
          )
        : h(Image, { key: `foto-${String(i)}`, style: estilos.foto, src: foto.dataUrl }),
    ),
    fueraDelTope === 0
      ? null
      : h(
          Text,
          { key: 'aviso', style: estilos.fotosAviso },
          `Fotos del modelo: se muestran ${String(mostradas.length)} de ${String(mostradas.length + fueraDelTope)}`,
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
 *
 * ⭐ V1-E3f: con las fotos del arte en PLURAL, el reparto {@link porRondas} garantiza que el tope se
 * lleve primero las fotos EXTRA de un arte y no la única foto de otro — un arte con cinco fotos ya
 * no expulsa de la rejilla a los demás artes. Sobre los ADJUNTOS no cambia nada: siguen detrás.
 */
export const MAX_ARTES = 4;

/**
 * Tope de fotos del MODELO en el encabezado (bloque `bloqueFotos`). Igual que antes: 3.
 *
 * ⚠️ **PRESUPUESTO HORIZONTAL (0.106) — subir este número puede tirar el aviso fuera de la fila.**
 * El aviso de recorte («Fotos del modelo: se muestran 3 de 8») vive DENTRO de la fila de fotos para
 * no costar altura, así que compite por el ANCHO con las tarjetas. La cuenta, en A4 con el
 * `padding` de 40 por lado (≈ **515 pt útiles**):
 *
 *     3 tarjetas × 110 + 3 huecos × 8 (`gap`) + 150 (`maxWidth` de `estilos.fotosAviso`) = **504 pt**
 *
 * Quedan ~11 pt de holgura. Con `MAX_FOTOS = 4` serían 622 pt y el aviso se saldría de la fila (o
 * envolvería), y lo mismo si crece el ancho de la tarjeta, el `gap` o el `maxWidth` del aviso.
 * 🔴 `paginasPdf` NO lo detecta —el desborde es horizontal, no agrega hoja—, así que si tocas
 * cualquiera de esos cuatro números, **rehaz la cuenta y mira el PDF**.
 */
export const MAX_FOTOS = 3;

/**
 * Anteponer la imagen PRINCIPAL antes de recortar. La regla vive en `imagenes-impreso.js` (la
 * comparte con la ficha de arte); aquí se RE-EXPORTA porque `recortarArtes`/`recortarFotos` la
 * documentan como su garantía.
 */
export { anteponerPrincipal };

/**
 * ⭐ Reparto por rondas de las fotos de varios artes. La regla vive en `imagenes-impreso.ts`
 * (la comparten el impreso de la ORDEN y la FICHA DE ARTE); aquí se RE-EXPORTA porque es parte de
 * la superficie histórica de este módulo y su tope (`recortarArtes`) la documenta.
 */
export { porRondas };

/**
 * Aplica el tope de la rejilla de ARTES: la principal al frente ({@link anteponerPrincipal}) y las
 * primeras {@link MAX_ARTES} imágenes; devuelve además cuántas quedaron fuera (para el aviso del
 * título). Como el tope es ≥ 1 y la principal quedó en la posición 0, el ARTE PRINCIPAL nunca se
 * recorta. Las fotos de los artes llegan repartidas {@link porRondas}, así que el tope se lleva
 * primero las fotos EXTRA de un arte y solo después la única foto de otro. Función pura, exportada
 * para probar el criterio sin renderizar.
 *
 * ⭐ 0.106 — el tope de verdad se aplica ANTES de presignar y de bajar bytes, sobre la lista de lo
 * que la orden PIDE ({@link ImagenPedida}), con el mismo {@link recortarAlTope} y la misma
 * constante. Esta función es su gemela para imágenes YA resueltas: el CINTURÓN del render, por si
 * alguien arma los datos a mano. Es idempotente, así que aplicarla dos veces no cambia nada.
 */
export function recortarArtes(artes: readonly FotoImpreso[]): {
  mostradas: FotoImpreso[];
  ocultas: number;
} {
  return recortarAlTope(artes, MAX_ARTES);
}

/**
 * Mismo criterio para las FOTOS del modelo del encabezado: la principal al frente y hasta
 * {@link MAX_FOTOS}, con el conteo de las que quedaron fuera.
 *
 * ⭐ 0.106: antes devolvía sólo las mostradas —"ese bloque no lleva título donde avisarlo"—, y así
 * el papel se quedaba callado cuando el modelo tenía más fotos de las que caben. El bloque sigue
 * SIN título; el aviso va DENTRO de la fila de fotos, que no cuesta un solo pt de altura.
 */
export function recortarFotos(fotos: readonly FotoImpreso[]): {
  mostradas: FotoImpreso[];
  ocultas: number;
} {
  return recortarAlTope(fotos, MAX_FOTOS);
}

/**
 * Sección "Artes (imágenes)" (petición Daniel, jul-2026): las fotos de los BORDADOS/ESTAMPADOS del
 * BOM (con su nombre debajo) y las IMÁGENES subidas a la orden (adjuntos F8-E6 con `tipoMime`
 * image/*), ya descargadas best-effort, capadas a {@link MAX_ARTES}. Sin artes NO se pinta nada
 * (ni el título): el impreso histórico queda idéntico.
 */
export function bloqueArtes(datos: DatosImpresoOrden): ReactElement | null {
  if (datos.artes.length === 0) {
    return null;
  }
  // El tope ya se aplicó al armar los datos (antes de bajar nada); aquí se repite como CINTURÓN.
  const { mostradas, ocultas } = recortarArtes(datos.artes);
  // ⭐ 0.106 — el TOTAL es lo que la orden PIDE (`artesOcultas` viene contado sobre eso), no lo que
  // R2 alcanzó a dar. Contarlo sobre lo descargado hacía que un papel al que se le cayeron dos
  // imágenes dijera «Artes (imágenes)» a secas, como si estuvieran todas.
  const total = mostradas.length + ocultas + datos.artesOcultas;
  // El aviso de truncado va EN EL TÍTULO de la sección, no en una leyenda aparte: así el conteo
  // total sigue a la vista sin costar un renglón extra de altura (que en las órdenes pesadas es
  // justo lo que empujaba el impreso a una segunda hoja).
  const titulo =
    total === mostradas.length
      ? 'Artes (imágenes)'
      : `Artes (imágenes) — se muestran ${String(mostradas.length)} de ${String(total)}`;
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
          { key: `arte-${String(i)}`, style: estilos.arte },
          // Una imagen que ESTA orden manda y no llegó deja HUECO, y lo DICE: quien tiene el papel
          // en la mano ve que falta algo y lo pide, en vez de producir creyendo que no había arte.
          arte.dataUrl === null
            ? h(
                View,
                { style: estilos.arteHueco },
                h(
                  Text,
                  { style: estilos.huecoTexto },
                  'Esta foto del arte no se pudo traer. Pídela antes de producir.',
                ),
              )
            : h(Image, { style: estilos.arteFoto, src: arte.dataUrl }),
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
      datos.listaArte.map((a) => `${a.descripcion} (${a.tipoArte})`),
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
