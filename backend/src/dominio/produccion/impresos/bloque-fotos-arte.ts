/**
 * ⭐⭐ 0.107 — **EL BLOQUE DE ARTE DE LOS PAPELES DEL PROVEEDOR DE ARTE**: cuántas fotos caben, con
 * qué tope de bytes se bajan, cómo se resuelven y cómo se pintan. Uno solo, para los DOS papeles
 * que el proveedor de arte tiene en la mano mientras trabaja: la **ficha de arte** (que sale con el
 * envío) y el **recibo de maquila** (la constancia que se firma al devolver el trabajo).
 *
 * ── Por qué existe ─────────────────────────────────────────────────────────────────────────────
 * La 0.094 le puso la foto a la FICHA y la 0.106 se la puso al impreso de la ORDEN; la 0.107
 * descubrió que el RECIBO —el tercer papel de la misma persona— seguía sin ella. La lección que
 * dejó esa fila tiene nombre: **se arregló un lado y el verde del lado arreglado no dijo nada del
 * otro**. Por eso el bloque no se copió al recibo: se SUBIÓ aquí, y desde aquí lo usan los dos. Si
 * mañana cambia el tope, el hueco o el rótulo, cambia para ambos o no cambia para ninguno.
 *
 * ── Qué NO vive aquí ───────────────────────────────────────────────────────────────────────────
 * La regla de **cuál** foto manda cada OP (heredadas del modelo − las que la OP apagó + las que la
 * OP subió, §Post-F9.177) vive —y sigue viviendo— en `imagenes-impreso.ts`, junto con el presign
 * y la descarga. Este módulo no vuelve a decidir nada de eso: lo LEE y lo pinta.
 *
 * El impreso de la ORDEN no usa este bloque: allí el arte es una sección entre otras diez, con su
 * propio tamaño y su propio sitio (al final, porque arriba van las fotos de la PRENDA). Lo que sí
 * comparte con estos dos papeles es la capa de abajo, `imagenes-impreso.ts`.
 */
import { createElement as h, type ReactElement } from 'react';

import { Image, StyleSheet, Text, View } from '@react-pdf/renderer';

import { estilosDoc, PALETA, TIPO, TituloSeccion } from '../../../comun/impresos-estilos.js';
import { servicioArchivos, type ServicioArchivos } from '../../../comun/archivos.js';
import { clienteLectura, type ContextoBd } from '../../../comun/transaccion.js';
import {
  descargarImagenComoDataUrl,
  leerFotosArteDeLaOrdenPorId,
  presignarKeys,
  recortarAlTope,
  type DescargarImagen,
  type FotoArteDeLaOrden,
} from './imagenes-impreso.js';

/**
 * ⭐ 0.094 — CUÁNTAS FOTOS DEL ARTE CABEN EN UN PAPEL DEL PROVEEDOR DE ARTE.
 *
 * Cuatro, y el criterio es de negocio: el proveedor de arte tiene que **ver qué va a estampar**, y
 * una OP puede llevar varios artes (frente, espalda, manga). Con el reparto POR RONDAS que hace
 * `fotosArteDeLaOrden`, cuatro huecos alcanzan para que **cada arte distinto** enseñe su primera
 * foto antes de que ninguno enseñe la segunda: un arte con cinco fotos ya no expulsa a los demás.
 *
 * ⚠️ El tope se aplica **ANTES** de presignar y de bajar bytes. Así el trabajo y la memoria quedan
 * ACOTADOS: como mucho cuatro descargas por papel, pase lo que pase en la receta. *(La 0.106 llevó
 * ese mismo criterio al impreso de la ORDEN, que hasta entonces bajaba todo y recortaba después.)*
 *
 * Lo que se recorta NO se esconde: el título de la sección dice cuántas se muestran del total.
 */
export const MAX_FOTOS_ARTE = 4;

/**
 * Tope DURO de bytes por foto de arte. Las fotos se suben con el límite general de archivos
 * (50 MB): cuatro de ese tamaño serían ~200 MB de Buffer, ~267 MB más de data-URL en base64 (que
 * abulta 4/3) y otra copia al cruzar al worker de PDF por `postMessage` — más de medio giga de pico
 * por UNA hoja de piso, capaz de tumbar el contenedor. Con 12 MB por foto el peor caso baja a ~48 MB
 * de imagen, y pasa de sobra cualquier foto de cámara o de celular.
 *
 * ⚠️ Y no falla en silencio: una foto que rebasa el tope se imprime como HUECO (igual que una que
 * no se pudo traer), así que en el papel se ve que esa imagen existe y no llegó.
 */
export const MAX_BYTES_FOTO_ARTE = 12 * 1024 * 1024;

/** Una imagen del arte tal como la pinta el papel. */
export interface FotoArteImpresa {
  /** Rótulo bajo la imagen: la descripción del arte. */
  titulo: string;
  /**
   * Data-URL lista para `<Image src>`, o **`null` = no se pudo traer** → el papel imprime el HUECO
   * con su aviso. Nunca se descarta en silencio: la hoja tiene que salir igual y decirlo.
   */
  dataUrl: string | null;
}

/**
 * Lo que un papel añade a sus datos para poder pintar el arte.
 *
 * Es un tipo APARTE (y no un campo opcional de los datos de cada papel) para que los documentos que
 * NO pintan arte —la hoja de envío, el recibo de costura— no carguen nunca con las imágenes: los
 * datos cruzan al worker de PDF por `postMessage`, y meterle megas de data-URL a un papel que no
 * las pinta sería pagarlas dos veces por nada.
 */
export interface DatosFotosArte {
  /** Las que se imprimen, ya recortadas al tope y bajadas (o con `dataUrl` null si no llegaron). */
  fotosArte: FotoArteImpresa[];
  /** Cuántas fotos del arte quedaron fuera por el tope (para el aviso del título). */
  fotosArteOcultas: number;
}

/**
 * Aplica el tope del papel: la foto PRINCIPAL al frente y las primeras {@link MAX_FOTOS_ARTE};
 * devuelve además cuántas quedaron fuera (para el aviso del título). El criterio vive en
 * `imagenes-impreso.ts` ({@link recortarAlTope}, compartido con el impreso de la orden desde la
 * 0.106); aquí solo se le pone EL TOPE DE ESTOS PAPELES. Las fotos llegan repartidas por rondas,
 * así que el tope se lleva primero las fotos EXTRA de un arte y solo después la única foto de otro.
 * Pura, exportada para probar el criterio sin renderizar.
 */
export function recortarFotosArte(fotos: readonly FotoArteDeLaOrden[]): {
  mostradas: FotoArteDeLaOrden[];
  ocultas: number;
} {
  return recortarAlTope(fotos, MAX_FOTOS_ARTE);
}

/** Lecturas y accesos a R2 inyectables (los tests los sustituyen para no tocar BD ni red). */
export interface DepsFotosArteImpresas {
  archivos?: ServicioArchivos;
  descargarImagen?: DescargarImagen;
  /** Qué fotos de arte manda esta OP (la regla de la 0.083, ya resuelta). */
  leerFotosArte?: typeof leerFotosArteDeLaOrdenPorId;
}

/**
 * ⭐ Resuelve las fotos de arte de un papel: las lee, aplica el tope, presigna y baja los bytes.
 *
 * 🔴 **EL PAPEL SALE SIEMPRE.** Es una hoja de producción: si no se imprime, el proveedor de arte
 * se queda sin su hoja. Por eso TODO el bloque de imágenes es best-effort, en tres capas:
 *
 *  1. **La lectura entera** (receta + arte del modelo + decisiones de la OP) va envuelta: si la BD
 *     truena ahí, el papel sale SIN sección de arte y se loguea. Se elige eso, y no un 500, porque
 *     sin la lectura no se sabe siquiera **cuántas** fotos debería haber — no hay hueco que pintar.
 *     ⚠️ Es el único camino por el que una foto que existe no deja rastro en el papel — y por eso
 *     el fallo se LOGUEA siempre: recortar sí deja rastro (el título cuenta el total), y no llegar
 *     también (el hueco).
 *  2. **El presign de cada key** (`allSettled`, no `all`): si R2 rechaza UNA, esa sale como HUECO y
 *     las demás siguen saliendo.
 *  3. **La descarga de bytes** de cada imagen: `null` (fallo, vacío o pasada de peso) → HUECO.
 *
 * ⚠️ En estas hojas una imagen que existe y no llegó **se dice**: quien la tiene en la mano ve que
 * falta algo y lo pide, en vez de trabajar creyendo que no había arte.
 *
 * 🔑 **La gemela:** una OP **sin arte, o con arte sin fotos, imprime NORMAL** — `fotosArte` queda
 * vacío y el papel no pinta ni la sección ni un hueco. El hueco es sólo para una foto que la OP
 * SÍ manda y que no llegó.
 *
 * @param papel cómo se nombra ESTE papel en los avisos ("la ficha del envío 5", "el recibo 12"):
 *   un aviso que no dice de qué hoja habla obliga a reproducir el caso para saberlo.
 */
export async function resolverFotosArte(
  bd: ContextoBd | undefined,
  idOrden: number,
  idEmpresa: number,
  papel: string,
  deps: DepsFotosArteImpresas = {},
): Promise<DatosFotosArte> {
  const leerFotos = deps.leerFotosArte ?? leerFotosArteDeLaOrdenPorId;
  const descargarImagen = deps.descargarImagen ?? descargarImagenComoDataUrl;

  // Capa 1: la lectura. Si truena, el papel sale sin sección de arte (nunca se trunca la hoja).
  let deLaOrden: FotoArteDeLaOrden[];
  try {
    deLaOrden = await leerFotos(clienteLectura(bd), idOrden, idEmpresa, {});
  } catch (error) {
    console.warn(
      `No se pudieron leer las fotos del arte de la orden ${String(idOrden)} para ${papel}.`,
      error,
    );
    return { fotosArte: [], fotosArteOcultas: 0 };
  }

  // ⚠️ El tope va ANTES de tocar R2: como mucho se presignan y bajan MAX_FOTOS_ARTE.
  const { mostradas, ocultas } = recortarFotosArte(deLaOrden);

  // 🔑 Una OP SIN ARTE sale por aquí y NO TOCA R2 **ni para construir el servicio**.
  //
  // ⚠️ No es una micro-optimización: `servicioArchivos()` resuelve la config de R2 desde el entorno
  // y **LANZA** si falta cualquier `R2_*`. Antes de la 0.094 la ficha no tocaba R2 en absoluto, y
  // antes de la 0.107 tampoco el recibo; dejar esa construcción en el camino común estrenaría una
  // forma NUEVA de quedarse sin el papel —y precisamente en el papel SIN arte, que es el que estas
  // etapas prometen dejar intacto— por una variable de entorno que ni siquiera iba a usarse.
  if (mostradas.length === 0) {
    return { fotosArte: [], fotosArteOcultas: ocultas };
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
      `No se pudieron presignar ${String(fallos)} foto(s) del arte de la orden ${String(idOrden)} para ${papel}.`,
      // El MOTIVO del primer fallo, igual que el impreso de la orden: sin él, un rechazo de R2 deja
      // un aviso que dice que pasó algo pero no qué, y hay que reproducirlo para saberlo.
      primerMotivo,
    );
  }

  return {
    fotosArte: mostradas.map((foto, i) => ({ titulo: foto.titulo, dataUrl: dataUrls[i] ?? null })),
    fotosArteOcultas: ocultas,
  };
}

// ── El bloque pintado (react-pdf, sin JSX) ──────────────────────────────────────────────────────

const estilos = StyleSheet.create({
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

/**
 * ⭐ 0.094 — ALTO de cada tarjeta de arte, MEDIDO contra la hoja (no elegido a ojo).
 *
 * Estos papeles viven en UNA hoja A4 (≈ 756 pt útiles de alto) y ya traen encabezado, campos,
 * matriz color×talla y —la ficha— su caja de instrucciones. Renderizando y contando páginas
 * (`/Type /Page`) sobre una ficha DENSA —matriz de 6 colores × 4 tallas, observaciones largas y la
 * banda de CANCELADO, la misma que fija el `.test.ts`— sale que:
 *  • con UNA fila de tarjetas (hasta 2 fotos) caben **190 pt** de alto y la ficha sigue en 1 hoja;
 *  • con DOS filas (3 o 4 fotos) el techo baja a **125 pt**; a 130 ya se va a la segunda hoja en
 *    cuanto aparece la banda de cancelado.
 *
 * Por eso el alto DEPENDE de cuántas fotos hay, y no es un capricho: lo normal es que una OP lleve
 * uno o dos artes (frente y espalda), y ese caso —el de todos los días— se lleva la imagen GRANDE.
 * Los papeles de 3 o 4 artes ceden tamaño a cambio de seguir cupiendo en una sola hoja.
 *
 * ⚠️ **No es una garantía absoluta, y no se vende como tal:** medido, una matriz de 12 colores
 * cabe en una hoja pero SIN holgura —llena la página ella sola—, así que en ese caso el arte sí
 * empuja a una segunda. Es una densidad que ya estaba al límite antes de esta etapa; lo que aquí
 * se sostiene es que el arte no rompa un papel normal, no que ninguno pase de una hoja.
 *
 * ⚠️ El mismo alto lo usan la imagen **y el hueco**: si se separaran, un papel con una foto caída
 * quedaría descuadrado justo el día que algo falla.
 *
 * ⭐ **0.107 — el RECIBO de arte se MIDIÓ contra estos mismos altos, y da lo mismo.** Su cuerpo
 * pesa parecido al de la ficha (cambia la caja de instrucciones por las líneas de calidad y de
 * prendas incompletas): con la MISMA densidad con la que se midió la ficha —6 colores × 4 tallas,
 * banda de cancelado, la línea de incompletas y ~500 caracteres de observaciones— cabe en UNA hoja
 * con 1, 2, 3 y 4 fotos. Por eso los dos papeles del proveedor de arte enseñan el arte al MISMO
 * tamaño, que es media razón de que este bloque sea uno solo.
 *
 * ⚠️ Y las dos cosas que, MEDIDAS, sí lo empujan a una segunda hoja —cada una por su cuenta, y solo
 * con 3 o 4 fotos—: unas observaciones de ~675 caracteres, o que el recibo devuelva de tránsito
 * (V1-E4b), que añade los dos campos de almacén. Se dice, no se disimula: es la misma frontera que
 * el párrafo de arriba reconoce para la ficha, y ninguna de las dos se vende como garantía.
 */
export function altoDeLaTarjeta(cuantasFotos: number): number {
  return cuantasFotos <= 2 ? 190 : 125;
}

/**
 * Lo que dice el HUECO de una foto que no llegó. La frase es una sola por papel y las dos viven
 * aquí, juntas, a propósito: es lo ÚNICO que estos dos papeles no comparten palabra por palabra, y
 * verlas en el mismo sitio es lo que impide que mañana se separen sin que nadie lo note.
 *
 * La diferencia es real, no cosmética: en la FICHA el arte todavía no se ha hecho (hay que pedir la
 * foto **antes de producir**); en el RECIBO el trabajo ya volvió y lo que falta es con qué
 * cotejarlo (**antes de darlo por bueno**). Decirle al del recibo que la pida "antes de producir"
 * sería mandarlo a un momento que ya pasó.
 */
export const AVISO_FOTO_FALTANTE = {
  /** Ficha de arte: el arte está por hacerse. */
  antesDeProducir: 'La foto de este arte no se pudo traer. Pídela antes de producir.',
  /** Recibo de maquila de arte: el trabajo ya volvió y hay que cotejarlo. */
  antesDeCotejar:
    'La foto de este arte no se pudo traer. Pídela antes de dar por bueno lo recibido.',
} as const;

/**
 * ⭐ 0.094 — Sección "Arte (imágenes)": lo que el proveedor de arte tiene que estampar (o lo que
 * acaba de entregar, cuando el papel es el recibo).
 *
 * 🔑 **Sin fotos NO se pinta nada** (ni el título): una OP sin arte —o con arte sin fotos— imprime
 * exactamente el papel de siempre, sin sección vacía ni hueco raro. El hueco existe SÓLO para una
 * foto que esta OP sí manda y que no se pudo traer, y entonces lo DICE: este papel no puede callar
 * que faltaba una imagen.
 *
 * El aviso de recorte va EN EL TÍTULO (cuesta 0 pt de altura), igual que en el impreso de la orden.
 *
 * @param aviso qué dice el hueco (ver {@link AVISO_FOTO_FALTANTE}). Por omisión, el de la FICHA:
 *   es el papel donde nació el bloque, y así su llamada —y sus pruebas— quedaron intactas al
 *   compartirlo con el recibo en la 0.107.
 */
export function bloqueFotosArte(
  datos: DatosFotosArte,
  aviso: string = AVISO_FOTO_FALTANTE.antesDeProducir,
): ReactElement | null {
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
                h(Text, { style: estilos.arteHuecoTexto }, aviso),
              )
            : h(Image, { style: [estilos.arteFoto, { height: alto }], src: foto.dataUrl }),
          h(Text, { style: estilos.arteTitulo }, foto.titulo),
        ),
      ),
    ),
  );
}
