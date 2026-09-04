/**
 * Impresos de los ENVÍOS a maquila (F3-E2, R9):
 *  • {@link impresoEnvioMaquila} — DOCUMENTO DE ENVÍO/ENTREGA A MAQUILA (ref. viejo
 *    `ReciboEntMaquilaImp`/`ReciboEntMaqDetImp`): la hoja que acompaña las prendas que SALEN al
 *    maquilero/estampador. Encabezado (empresa, folio del envío, fecha, maquilero, proceso,
 *    orden/modelo, fecha compromiso, precio pactado) + matriz color×talla con totales. SIN precios
 *    de costo del modelo; SÍ el precio pactado del envío.
 *  • {@link impresoFichaEstampado} — FICHA DE ARTE (ref. viejo `FichaEst`/`FichaEstImp`): la
 *    ficha que acompaña un envío de proceso de estampado/aplicación. Estructura similar, rotulada
 *    como ficha de arte, con espacio para instrucciones del proceso — y, desde la 0.094, **CON LA
 *    FOTO DEL ARTE**.
 *
 * ⭐ 0.094 — LA FICHA DE ARTE LLEVA LA FOTO (Daniel, 2-sep-2026, §Post-F9.181(c): *"sí lleva foto
 * la ficha de estampado"*). Va en la FICHA y **no** en el documento de envío: el documento de envío
 * es el remito de las prendas que salen (quién, cuántas, a qué precio) y lo firma el maquilero de
 * costura; la ficha es el papel que el PROVEEDOR DE ARTE tiene en la mano mientras trabaja, y sin
 * la imagen no sabe qué tiene que estampar. La 0.083 ya decidió CUÁL foto manda en cada OP
 * (heredadas del modelo − las que la OP apagó + las que la OP subió): aquí sólo se LEE lo ya
 * resuelto (`imagenes-impreso.ts`), nunca se vuelve a decidir.
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
import type { SesionUsuario } from '../../../comun/permisos.js';
import { ErrorValidacion } from '../../../comun/errores.js';
import { clienteLectura, type ContextoBd } from '../../../comun/transaccion.js';
import { obtenerEtapa } from '../etapas.js';
import type { EtapaSalida } from '../../../contrato/index.js';
// ⭐ 0.094 — la regla de QUÉ FOTOS manda la OP (0.083) y la descarga de bytes viven en un módulo
// compartido con el impreso de la orden: dos papeles de la misma OP no pueden decidirlo por
// separado. Lecturas de BAJO NIVEL (sin permiso propio): esta impresión ya está autorizada por
// `produccion.wip-ver` y qué arte lleva la orden es parte de su documento.
import {
  descargarImagenComoDataUrl,
  leerFotosArteDeLaOrdenPorId,
  presignarKeys,
  recortarAlTope,
  type DescargarImagen,
  type FotoArteDeLaOrden,
} from './imagenes-impreso.js';

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
  /**
   * ⭐ V1-E4b — lo que se entrega YA ES PRODUCTO TERMINADO (proceso después de costura,
   * §Post-F9.61). Este papel lo FIRMA el maquilero: tiene que decirlo, porque no es lo mismo
   * recibir bultos cortados que prendas terminadas —cambia lo que se le reclama si no vuelven— y
   * porque esas piezas salieron de un almacén concreto, que también se imprime.
   */
  prendaTerminada: boolean;
  /** Almacén de PT del que salieron (solo cuando son prendas terminadas). */
  almacenOrigen: string | null;
  /** Salieron del stock «sin orden asignada» (histórico migrado / inventario de arranque). */
  stockSinOrden: boolean;
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
 * ⭐ 0.094 — CUÁNTAS FOTOS DEL ARTE CABEN EN LA FICHA.
 *
 * Cuatro, y el criterio es de negocio: el proveedor de arte tiene que **ver qué va a estampar**, y
 * una OP puede llevar varios artes (frente, espalda, manga). Con el reparto POR RONDAS que hace
 * `fotosArteDeLaOrden`, cuatro huecos alcanzan para que **cada arte distinto** enseñe su primera
 * foto antes de que ninguno enseñe la segunda: un arte con cinco fotos ya no expulsa a los demás.
 *
 * ⚠️ El tope se aplica **ANTES** de presignar y de bajar bytes. Así el trabajo y la memoria quedan
 * ACOTADOS: como mucho cuatro descargas por ficha, pase lo que pase en la receta. *(La 0.106 llevó
 * ese mismo criterio al impreso de la ORDEN, que hasta entonces bajaba todo y recortaba después.)*
 *
 * Lo que se recorta NO se esconde: el título de la sección dice cuántas se muestran del total.
 */
export const MAX_FOTOS_FICHA_ARTE = 4;

/**
 * Tope DURO de bytes por foto de la ficha. Las fotos se suben con el límite general de archivos
 * (50 MB): cuatro de ese tamaño serían ~200 MB de Buffer, ~267 MB más de data-URL en base64 (que
 * abulta 4/3) y otra copia al cruzar al worker de PDF por `postMessage` — más de medio giga de pico
 * por UNA hoja de piso, capaz de tumbar el contenedor. Con 12 MB por foto el peor caso baja a ~48 MB
 * de imagen, y pasa de sobra cualquier foto de cámara o de celular.
 *
 * ⚠️ Y no falla en silencio: una foto que rebasa el tope se imprime como HUECO (igual que una que
 * no se pudo traer), así que en el papel se ve que esa imagen existe y no llegó.
 */
export const MAX_BYTES_FOTO_ARTE = 12 * 1024 * 1024;

/** Una imagen del arte tal como la pinta la ficha. */
export interface FotoFichaArte {
  /** Rótulo bajo la imagen: la descripción del arte. */
  titulo: string;
  /**
   * Data-URL lista para `<Image src>`, o **`null` = no se pudo traer** → la ficha imprime el HUECO
   * con su aviso. Nunca se descarta en silencio: el papel tiene que salir igual y decirlo.
   */
  dataUrl: string | null;
}

/**
 * Datos de la FICHA DE ARTE: los del envío + las fotos del arte que manda esta OP.
 *
 * Es un tipo APARTE (y no un campo opcional de {@link DatosImpresoEnvio}) para que el documento de
 * ENVÍO no cargue nunca con las imágenes: sus datos cruzan al worker por `postMessage`, y meterle
 * megas de data-URL a un papel que no las pinta sería pagarlas dos veces por nada.
 */
export interface DatosImpresoFichaArte extends DatosImpresoEnvio {
  /** Las que se imprimen, ya recortadas al tope y bajadas (o con `dataUrl` null si no llegaron). */
  fotosArte: FotoFichaArte[];
  /** Cuántas fotos del arte quedaron fuera por el tope (para el aviso del título). */
  fotosArteOcultas: number;
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
    return { color: etiquetaColorPack(linea.color, linea.pack), cantidades, totalFila };
  });

  return { tallas, renglones, totalesColumna, totalPiezas };
}

/** Dependencias inyectables (los tests inyectan un `obtenerEtapa` fake para no tocar BD). */
export interface DepsImpresoEnvio {
  obtenerEtapa?: typeof obtenerEtapa;
}

/**
 * Dependencias de la FICHA DE ARTE: las del envío + lo que hace falta para las imágenes. Los tests
 * las inyectan para no tocar BD ni R2.
 */
export interface DepsImpresoFichaArte extends DepsImpresoEnvio {
  archivos?: ServicioArchivos;
  descargarImagen?: DescargarImagen;
  /** Qué fotos de arte manda esta OP (la regla de la 0.083, ya resuelta). */
  leerFotosArte?: typeof leerFotosArteDeLaOrdenPorId;
}

/**
 * Trae la ETAPA y exige que sea un ENVÍO a maquila (A9: `obtenerEtapa` filtra por la empresa
 * activa de la sesión). Lanza `ErrorValidacion` si no lo es (un corte no tiene "documento de
 * envío"); `ErrorNoEncontrado` (404) si la etapa no es de la empresa activa.
 */
async function etapaDeEnvio(
  sesion: SesionUsuario,
  idEtapa: number,
  bd: ContextoBd | undefined,
  deps: DepsImpresoEnvio,
): Promise<EtapaSalida> {
  const obtener = deps.obtenerEtapa ?? obtenerEtapa;
  const etapa = await obtener(sesion, idEtapa, bd);
  if (etapa.tipo !== 'envio_maquila') {
    throw new ErrorValidacion('El documento de envío solo aplica a etapas de envío a maquila.');
  }
  return etapa;
}

/** Proyección PURA de la etapa a los datos del papel (sin BD): la comparten los dos impresos. */
function datosDeLaEtapa(etapa: EtapaSalida, empresa: string): DatosImpresoEnvio {
  return {
    empresa,
    folio: etapa.folio,
    fecha: etapa.fecha,
    fechaCompromiso: etapa.fechaCompromiso,
    maquilero: etapa.tercero,
    proceso: etapa.tipoProceso,
    folioOrden: etapa.folioOrden,
    precioPactado: etapa.precioPactado,
    prendaTerminada: etapa.prendaTerminada,
    almacenOrigen: etapa.almacenOrigen,
    stockSinOrden: etapa.stockSinOrden,
    observaciones: etapa.observaciones,
    cancelado: etapa.cancelado,
    ...armarTablaEtapa(etapa.lineas),
  };
}

/**
 * Resuelve los datos del impreso de un envío (A9: por la empresa activa de la sesión). Reusa
 * `obtenerEtapa` (encabezado + matriz + nombres). Lanza `ErrorValidacion` si la etapa NO es un
 * envío a maquila; `ErrorNoEncontrado` (404) si no es de la empresa activa.
 *
 * ⚠️ SIN imágenes, a propósito: el documento de envío es el remito de las prendas, no el papel del
 * proveedor de arte (0.094).
 */
export async function armarDatosImpresoEnvio(
  sesion: SesionUsuario,
  idEtapa: number,
  bd?: ContextoBd,
  deps: DepsImpresoEnvio = {},
): Promise<DatosImpresoEnvio> {
  return datosDeLaEtapa(await etapaDeEnvio(sesion, idEtapa, bd, deps), sesion.nombreEmpresaActiva);
}

/**
 * Aplica el tope de la ficha: la foto PRINCIPAL al frente y las primeras
 * {@link MAX_FOTOS_FICHA_ARTE}; devuelve además cuántas quedaron fuera (para el aviso del título).
 * El criterio vive en `imagenes-impreso.ts` ({@link recortarAlTope}, compartido con el impreso de
 * la orden desde la 0.106); aquí solo se le pone EL TOPE DE ESTA FICHA. Las fotos llegan repartidas
 * por rondas, así que el tope se lleva primero las fotos EXTRA de un arte y solo después la única
 * foto de otro. Pura, exportada para probar el criterio sin renderizar.
 */
export function recortarFotosArte(fotos: readonly FotoArteDeLaOrden[]): {
  mostradas: FotoArteDeLaOrden[];
  ocultas: number;
} {
  return recortarAlTope(fotos, MAX_FOTOS_FICHA_ARTE);
}

/**
 * ⭐ 0.094 — Datos de la FICHA DE ARTE: los del envío + las fotos del arte que manda esta OP.
 *
 * 🔴 **EL PAPEL SALE SIEMPRE.** Es una hoja de producción: si no se imprime, el proveedor de arte
 * se queda sin su hoja. Por eso TODO el bloque de imágenes es best-effort, en tres capas:
 *
 *  1. **La lectura entera** (receta + arte del modelo + decisiones de la OP) va envuelta: si la BD
 *     truena ahí, la ficha sale SIN sección de arte y se loguea. Se elige eso, y no un 500, porque
 *     sin la lectura no se sabe siquiera **cuántas** fotos debería haber — no hay hueco que pintar.
 *     ⚠️ Es el único camino por el que una foto que existe no deja rastro en el papel — y por eso
 *     el fallo se LOGUEA siempre: recortar sí deja rastro (el título cuenta el total), y no llegar
 *     también (el hueco).
 *  2. **El presign de cada key** (`allSettled`, no `all`): si R2 rechaza UNA, esa sale como HUECO y
 *     las demás siguen saliendo.
 *  3. **La descarga de bytes** de cada imagen: `null` (fallo, vacío o pasada de peso) → HUECO.
 *
 * ⚠️ En esta hoja una imagen que existe y no llegó **se dice**: quien la tiene en la mano ve que
 * falta algo y lo pide, en vez de estampar creyendo que no había arte. *(Cuando esto se escribió,
 * el impreso de la ORDEN sí descartaba en silencio; la 0.106 le aplicó esta misma cura, así que hoy
 * los dos papeles de la orden se comportan igual.)*
 *
 * 🔑 **La gemela:** una OP **sin arte, o con arte sin fotos, imprime NORMAL** — `fotosArte` queda
 * vacío y la ficha no pinta ni la sección ni un hueco. El hueco es sólo para una foto que la OP
 * SÍ manda y que no llegó.
 */
export async function armarDatosImpresoFichaArte(
  sesion: SesionUsuario,
  idEtapa: number,
  bd?: ContextoBd,
  deps: DepsImpresoFichaArte = {},
): Promise<DatosImpresoFichaArte> {
  const etapa = await etapaDeEnvio(sesion, idEtapa, bd, deps);
  const datos = datosDeLaEtapa(etapa, sesion.nombreEmpresaActiva);
  const leerFotos = deps.leerFotosArte ?? leerFotosArteDeLaOrdenPorId;
  const descargarImagen = deps.descargarImagen ?? descargarImagenComoDataUrl;

  // Capa 1: la lectura. Si truena, la ficha sale sin sección de arte (nunca se trunca el papel).
  let deLaOrden: FotoArteDeLaOrden[];
  try {
    deLaOrden = await leerFotos(clienteLectura(bd), etapa.idOrden, sesion.idEmpresaActiva, {});
  } catch (error) {
    console.warn(
      `No se pudieron leer las fotos del arte de la orden ${String(etapa.idOrden)} para la ficha del envío ${String(idEtapa)}.`,
      error,
    );
    return { ...datos, fotosArte: [], fotosArteOcultas: 0 };
  }

  // ⚠️ El tope va ANTES de tocar R2: como mucho se presignan y bajan MAX_FOTOS_FICHA_ARTE.
  const { mostradas, ocultas } = recortarFotosArte(deLaOrden);

  // 🔑 Una OP SIN ARTE sale por aquí y NO TOCA R2 **ni para construir el servicio**.
  //
  // ⚠️ No es una micro-optimización: `servicioArchivos()` resuelve la config de R2 desde el entorno
  // y **LANZA** si falta cualquier `R2_*`. Antes de la 0.094 esta ficha no tocaba R2 en absoluto;
  // dejar esa construcción en el camino común habría estrenado una forma NUEVA de quedarse sin el
  // papel — y precisamente en la ficha sin arte, que es la que esta etapa promete dejar intacta —
  // por una variable de entorno que ni siquiera iba a usarse.
  if (mostradas.length === 0) {
    return { ...datos, fotosArte: [], fotosArteOcultas: ocultas };
  }

  const archivos = deps.archivos ?? servicioArchivos();

  // Capa 2: presign por imagen (`allSettled`, en `imagenes-impreso.ts`). Una key que R2 rechaza no
  // se lleva a las demás: se queda sin URL y más abajo se pinta como hueco.
  const { urls, fallos, primerMotivo } = await presignarKeys(
    mostradas.map((foto) => foto.key),
    archivos,
  );

  // Capa 3: bytes por imagen, con tope duro de peso. `null` (fallo o pasada de peso) → hueco.
  const dataUrls = await Promise.all(
    urls.map(async (url) =>
      url === null ? null : await descargarImagen(url, MAX_BYTES_FOTO_ARTE),
    ),
  );
  if (fallos > 0) {
    console.warn(
      `No se pudieron presignar ${String(fallos)} foto(s) del arte de la orden ${String(etapa.idOrden)} para la ficha del envío ${String(idEtapa)}.`,
      // El MOTIVO del primer fallo, igual que el impreso de la orden: sin él, un rechazo de R2 deja
      // un aviso que dice que pasó algo pero no qué, y hay que reproducirlo para saberlo.
      primerMotivo,
    );
  }

  return {
    ...datos,
    fotosArte: mostradas.map((foto, i) => ({ titulo: foto.titulo, dataUrl: dataUrls[i] ?? null })),
    fotosArteOcultas: ocultas,
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
  // ⭐ 0.094 — rejilla del ARTE. Tarjetas GRANDES, no miniaturas: en el impreso de la orden el arte
  // es una referencia entre otras diez secciones y cabe en 80 × 88; aquí es EL contenido del papel
  // —el proveedor tiene que ver qué estampar—, así que van DOS POR RENGLÓN a casi el ancho útil
  // (2 × 250 + 8 de hueco = 508 de los 515 útiles). La ALTURA la fija {@link altoDeLaTarjeta}.
  artes: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  arte: { width: 250 },
  arteFoto: {
    width: 250,
    objectFit: 'contain',
    borderWidth: 1,
    borderColor: PALETA.borde,
  },
  // El HUECO de una foto que no llegó: mismo marco y MISMA ALTURA que la imagen (se la pasa el
  // mismo `altoDeLaTarjeta`), para que el papel no se descuadre y se VEA que ahí faltaba algo.
  arteHueco: {
    width: 250,
    borderWidth: 1,
    borderColor: PALETA.borde,
    backgroundColor: PALETA.superficie,
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  arteHuecoTexto: { fontSize: TIPO.subtitulo, color: PALETA.muted, textAlign: 'center' },
  arteTitulo: { fontSize: TIPO.pie, color: PALETA.muted, marginTop: 2, textAlign: 'center' },
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

/**
 * QUÉ se entrega, en una línea, para el papel que firma el maquilero (V1-E4b). Sin prenda
 * terminada devuelve `null` y el campo ni se imprime: el envío de bultos cortados es el de siempre
 * y no hay nada nuevo que decir.
 */
export function queSeEntrega(datos: DatosImpresoEnvio): string | null {
  if (!datos.prendaTerminada) return null;
  const deDonde = datos.almacenOrigen === null ? '' : ` (salen del almacén ${datos.almacenOrigen}`;
  const bucket = datos.stockSinOrden ? ', stock sin orden asignada' : '';
  const cierre = deDonde === '' ? '' : `${bucket})`;
  return `PRENDAS YA TERMINADAS${deDonde}${cierre}`;
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
      // Solo aparece cuando SÍ son prendas terminadas (V1-E4b): en el envío de bultos cortados no
      // hay nada nuevo que declarar y el papel se queda como siempre.
      campo('Qué se entrega', queSeEntrega(datos), true),
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

/**
 * ⭐ 0.094 — ALTO de cada tarjeta de arte, MEDIDO contra la hoja (no elegido a ojo).
 *
 * La ficha vive en UNA hoja A4 (≈ 756 pt útiles de alto) y ya trae encabezado, campos, matriz
 * color×talla y la caja de instrucciones. Renderizando y contando páginas (`/Type /Page`) sobre una
 * ficha DENSA —matriz de 6 colores × 4 tallas, observaciones largas y la banda de CANCELADO, la
 * misma que fija el `.test.ts`— sale que:
 *  • con UNA fila de tarjetas (hasta 2 fotos) caben **190 pt** de alto y la ficha sigue en 1 hoja;
 *  • con DOS filas (3 o 4 fotos) el techo baja a **125 pt**; a 130 ya se va a la segunda hoja en
 *    cuanto aparece la banda de cancelado.
 *
 * Por eso el alto DEPENDE de cuántas fotos hay, y no es un capricho: lo normal es que una OP lleve
 * uno o dos artes (frente y espalda), y ese caso —el de todos los días— se lleva la imagen GRANDE.
 * Las fichas de 3 o 4 artes ceden tamaño a cambio de seguir cupiendo en una sola hoja.
 *
 * ⚠️ **No es una garantía absoluta, y no se vende como tal:** medido, una matriz de 12 colores
 * cabe en una hoja pero SIN holgura —llena la página ella sola—, así que en ese caso el arte sí
 * empuja a una segunda. Es una densidad que ya estaba al límite antes de esta etapa; lo que aquí
 * se sostiene es que el arte no rompa una ficha normal, no que ninguna ficha pase de una hoja.
 *
 * ⚠️ El mismo alto lo usan la imagen **y el hueco**: si se separaran, una ficha con una foto caída
 * quedaría descuadrada justo el día que algo falla.
 */
export function altoDeLaTarjeta(cuantasFotos: number): number {
  return cuantasFotos <= 2 ? 190 : 125;
}

/**
 * ⭐ 0.094 — Sección "Arte (imágenes)" de la ficha: lo que el proveedor de arte tiene que estampar.
 *
 * 🔑 **Sin fotos NO se pinta nada** (ni el título): una OP sin arte —o con arte sin fotos— imprime
 * exactamente la ficha de siempre, sin sección vacía ni hueco raro. El hueco existe SÓLO para una
 * foto que esta OP sí manda y que no se pudo traer, y entonces lo DICE: ese papel no puede callar
 * que faltaba una imagen.
 *
 * El aviso de recorte va EN EL TÍTULO (cuesta 0 pt de altura), igual que en el impreso de la orden.
 */
export function bloqueArteFicha(datos: DatosImpresoFichaArte): ReactElement | null {
  if (datos.fotosArte.length === 0) {
    return null;
  }
  const alto = altoDeLaTarjeta(datos.fotosArte.length);
  const total = datos.fotosArte.length + datos.fotosArteOcultas;
  const titulo =
    datos.fotosArteOcultas === 0
      ? 'Arte (imágenes)'
      : `Arte (imágenes) — se muestran ${String(datos.fotosArte.length)} de ${String(total)}`;
  return h(
    View,
    { style: estilosDoc.seccion, key: 'arte' },
    TituloSeccion(titulo),
    h(
      View,
      { style: estilos.artes },
      ...datos.fotosArte.map((foto, i) =>
        h(
          View,
          { key: `arte-${String(i)}`, style: estilos.arte },
          foto.dataUrl === null
            ? h(
                View,
                { style: [estilos.arteHueco, { height: alto }] },
                h(
                  Text,
                  { style: estilos.arteHuecoTexto },
                  'La foto de este arte no se pudo traer. Pídela antes de producir.',
                ),
              )
            : h(Image, { style: [estilos.arteFoto, { height: alto }], src: foto.dataUrl }),
          h(Text, { style: estilos.arteTitulo }, foto.titulo),
        ),
      ),
    ),
  );
}

/** Una página de la FICHA DE ARTE (acompaña un envío de proceso de estampado/aplicación). */
function paginaFichaEstampado(datos: DatosImpresoFichaArte, clave: string): ReactElement {
  const hijos: (ReactElement | null)[] = [
    EncabezadoDocumento({
      empresa: datos.empresa,
      titulo: 'Ficha de arte — CONTROL v2',
      derecha: { etiqueta: 'Folio de envío', valor: String(datos.folio), grande: true },
    }),
    bandaCancelada(datos),
    h(
      View,
      { style: estilosDoc.filaCampos, key: 'campos' },
      campo('Prov. de Arte', datos.maquilero),
      campo('Proceso', datos.proceso),
      campo('Orden', String(datos.folioOrden)),
      campo('Fecha de envío', datos.fecha),
      campo('Fecha compromiso', datos.fechaCompromiso),
      campo('Precio pactado', pesos(datos.precioPactado)),
      // Solo aparece cuando SÍ son prendas terminadas (V1-E4b): en el envío de bultos cortados no
      // hay nada nuevo que declarar y el papel se queda como siempre.
      campo('Qué se entrega', queSeEntrega(datos), true),
    ),
    // ⭐ 0.094 — el ARTE va ARRIBA, antes de las cantidades: es la identidad del trabajo (qué hay
    // que estampar), y las cantidades sólo tienen sentido una vez que se sabe de qué arte se habla.
    // ⚠️ Y NO donde lo pone el impreso de la ORDEN, que lo manda al final: allí el arte es una
    // sección entre diez y arriba van las fotos de la PRENDA, que es el asunto de esa hoja. En
    // ésta el asunto ES el arte, así que ocupa el sitio que allá ocupa la prenda.
    bloqueArteFicha(datos),
    tablaMatriz(datos),
    h(
      View,
      { style: estilosDoc.seccion, key: 'instr' },
      TituloSeccion('Instrucciones del arte'),
      datos.observaciones
        ? h(View, { style: estilos.cajaInstrucciones }, h(Text, {}, datos.observaciones))
        : h(View, { style: estilos.cajaInstrucciones }, h(Text, { style: estilosDoc.vacio }, '')),
    ),
    PieDocumento({
      contexto: `CONTROL v2 · ${datos.empresa} · Ficha de arte · Envío ${datos.folio} · ${datos.totalPiezas} piezas`,
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
function documentoFichaEstampado(datos: DatosImpresoFichaArte): ReactElement<DocumentProps> {
  return h(
    Document,
    {
      title: `Ficha de arte ${datos.folio}`,
      author: datos.empresa,
      subject: 'Ficha de arte',
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
export async function generarPdfFichaEstampado(datos: DatosImpresoFichaArte): Promise<Buffer> {
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
  return {
    buffer: await renderizarPdfEnWorker('envio-maquila', datos, {
      idEmpresa: sesion.idEmpresaActiva,
    }),
    folio: datos.folio,
  };
}

/** Resuelve los datos del envío + las fotos del arte (A9) y devuelve la FICHA DE ARTE + el folio. */
export async function impresoFichaEstampado(
  sesion: SesionUsuario,
  idEtapa: number,
  bd?: ContextoBd,
  deps: DepsImpresoFichaArte = {},
): Promise<ImpresoEnvio> {
  const datos = await armarDatosImpresoFichaArte(sesion, idEtapa, bd, deps);
  return {
    buffer: await renderizarPdfEnWorker('ficha-estampado', datos, {
      idEmpresa: sesion.idEmpresaActiva,
    }),
    folio: datos.folio,
  };
}
