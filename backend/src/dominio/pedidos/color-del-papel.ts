/**
 * ⭐ QUÉ COLOR VA A QUEDAR DE VERDAD EN LA OP, dicho ANTES de confirmar.
 *
 * El papel de C&A trae un color genérico ("BLANCO"). Al confirmar, `resolverOCrearColor` lo resuelve
 * contra el catálogo y **puede DESVIARLO**: si a ese color se lo llevó una fusión, la OP no nace en
 * él sino en su CANÓNICO (§Post-F9.143 — el rastro `Color.idFusionadoEn`, que `colorCanonico` sigue).
 *
 * 🔴 **POR QUÉ HACE FALTA DECIRLO, y no basta con hacerlo bien.** El desvío es correcto —es lo que la
 * fusión quiso decir— pero **cambia el NOMBRE del color**, y la cadena de precio casa por NOMBRE
 * (`dominio/costos/resolucion-precios.ts`: `coloresTela.find((c) => c.nombre… === clave)`). Un
 * desvío silencioso puede caer en otro `TelaColor` con OTRO precio, y lo que se ve es **un precosto
 * que no cuadra con el papel del cliente y nada en pantalla que lo explique**. Hasta esta etapa el
 * único registro del desvío era una bitácora escrita DESPUÉS de confirmar, o sea: se descubría tarde
 * o no se descubría.
 *
 * **Vive aquí, y no dentro del importador**, por lo mismo que `oc-duplicada.ts`: la vista previa y el
 * confirm tienen que decir lo MISMO. Por eso este módulo no reimplementa la caminata de la fusión —
 * llama a `colorCanonico`, exactamente la misma función que usa el confirm. Un segundo recorrido
 * "equivalente" es justo como nacen las ramas gemelas que se arreglan a medias.
 *
 * ⚠️ **LO QUE ESTE MÓDULO NO AVISA, a propósito:** un color apagado A MANO (sin fusión) también
 * cambia al confirmar —se REACTIVA— pero eso no desvía nada: mismo id, mismo nombre, mismo precio.
 * No es lo mismo "inactivo" que "fusionado", y confundirlos llenaría la vista previa de avisos que
 * no obligan a hacer nada. Aquí sólo se avisa el DESVÍO.
 */
import type { AdvertenciaPdf } from '../../contrato/index.js';
import type { Tx } from '../../comun/transaccion.js';
import { colorCanonico, normalizarNombreColor } from '../catalogos/colores.js';

/** Clave de comparación de un nombre de color (normalización ligera del dominio + minúsculas). */
export function claveColor(nombre: string): string {
  return normalizarNombreColor(nombre).toLowerCase();
}

/** Qué le va a pasar, al confirmar, al color que nombra el papel. */
export type ResolucionColorPapel =
  /** No existe en el catálogo: se va a CREAR con ese nombre. */
  | { estado: 'nuevo' }
  /** Existe y la OP va a quedar en ÉL (lo normal; incluye el apagado a mano, que se reactiva). */
  | { estado: 'existe'; id: number }
  /** 🔴 Existe pero una fusión se lo llevó: la OP va a quedar en OTRO color, con OTRO nombre. */
  | { estado: 'fusionado'; id: number; canonico: { id: number; nombre: string } };

/**
 * Resuelve, para cada nombre de color del papel, en qué color va a acabar la OP.
 *
 * Se hace en DOS pasos porque el canónico casi nunca se llama igual que el color del papel (ese es
 * el punto de una fusión), así que no puede salir de la misma consulta por nombre:
 *  1. una consulta por el LOTE de nombres (insensible a mayúsculas, como el confirm);
 *  2. por cada uno encontrado, `colorCanonico` sigue el rastro de la fusión.
 *
 * El paso 2 es una consulta corta por color (una cadena real tiene 1 o 2 eslabones) y una vista
 * previa trae un puñado de PDFs; se prefiere eso a re-deducir aquí la regla de parada de la
 * caminata, que es lo que dejaría a la previa y al confirm diciendo cosas distintas.
 *
 * **El desempate se copia del confirm**: si el catálogo trae dos variantes de mayúsculas del mismo
 * nombre ("Blanco" y "BLANCO"), `resolverOCrearColor` se queda con la de id MENOR (`orderBy: id
 * asc`), y desde V1-E8s esa elección decide entre REDIRIGIR y REUSAR. Aquí se elige igual — a mano
 * sobre el resultado, para que no dependa del orden en que la base devuelva las filas.
 */
export async function resolverColoresDelPapel(
  bd: Pick<Tx, 'color'>,
  nombres: readonly string[],
): Promise<Map<string, ResolucionColorPapel>> {
  const normalizados = [...new Set(nombres.map((n) => normalizarNombreColor(n)))].filter(
    (n) => n !== '',
  );
  if (normalizados.length === 0) return new Map();

  const encontrados = await bd.color.findMany({
    where: { nombre: { in: normalizados, mode: 'insensitive' } },
    select: { id: true, nombre: true },
  });

  // Un id por clave: el MENOR, igual que el confirm.
  const idPorClave = new Map<string, number>();
  for (const color of encontrados) {
    const clave = claveColor(color.nombre);
    const previo = idPorClave.get(clave);
    if (previo === undefined || color.id < previo) {
      idPorClave.set(clave, color.id);
    }
  }

  const resolucion = new Map<string, ResolucionColorPapel>();
  for (const nombre of normalizados) {
    const clave = claveColor(nombre);
    const id = idPorClave.get(clave);
    if (id === undefined) {
      resolucion.set(clave, { estado: 'nuevo' });
      continue;
    }
    const canonico = await colorCanonico(bd, id);
    resolucion.set(
      clave,
      canonico.id === id
        ? { estado: 'existe', id }
        : { estado: 'fusionado', id, canonico: { id: canonico.id, nombre: canonico.nombre } },
    );
  }
  return resolucion;
}

/**
 * Mensaje ÚNICO del desvío por fusión. Nombra los dos colores (el del papel y el que va a quedar) y
 * dice explícitamente lo que está en juego: el PRECIO se busca por nombre de color, así que un
 * desvío puede mover el precosto sin que nada más lo delate.
 */
export function mensajeColorFusionado(nombrePapel: string, nombreCanonico: string): string {
  return (
    `El color "${nombrePapel}" del papel lo absorbió una fusión: la OP va a nacer en ` +
    `"${nombreCanonico}". El precio se busca POR NOMBRE del color, así que revisa que el ` +
    `precosto cuadre con el papel del cliente.`
  );
}

/** Lo que un renglón de la vista previa tiene que decir sobre su color. */
export interface MarcaColorDelPapel {
  /** El color no existe: se va a crear al confirmar. */
  colorNuevo: boolean;
  /** Nombre del canónico al que la fusión va a desviar la OP, o null si no hay desvío. */
  colorFusionadoEn: string | null;
  /** Aviso a sumar a las advertencias del renglón, o null si no hay nada que avisar. */
  advertencia: AdvertenciaPdf | null;
}

/**
 * Traduce la resolución de un color a lo que el renglón de la vista previa enseña (DOMINIO PURO —
 * lo prueba `color-del-papel.test.ts`). Está aquí, y no en línea dentro del importador, para que
 * las TRES salidas —marca, campo y aviso— se decidan en un solo sitio y no puedan discrepar.
 *
 * Los tres estados dan tres respuestas DISTINTAS, y confundir dos cualesquiera miente:
 *  • `nuevo`      → "(nuevo)". No hay desvío: se va a crear con el nombre del papel.
 *  • `existe`     → nada. La OP se queda en ese color (aunque esté apagado: se reactiva).
 *  • `fusionado`  → marca + aviso. La OP nace en OTRO color, y con él puede cambiar el precio.
 *
 * Un renglón SIN color (el papel no lo trae, o el PDF no parseó) no es "nuevo" ni lleva aviso: no
 * hay color del que hablar.
 */
export function marcarColorDelPapel(
  colorGenerico: string,
  resolucion: ResolucionColorPapel | undefined,
): MarcaColorDelPapel {
  if (colorGenerico === '' || resolucion === undefined) {
    return { colorNuevo: false, colorFusionadoEn: null, advertencia: null };
  }
  if (resolucion.estado === 'fusionado') {
    return {
      colorNuevo: false,
      colorFusionadoEn: resolucion.canonico.nombre,
      advertencia: {
        tipo: 'color-fusionado',
        mensaje: mensajeColorFusionado(
          normalizarNombreColor(colorGenerico),
          resolucion.canonico.nombre,
        ),
      },
    };
  }
  return {
    colorNuevo: resolucion.estado === 'nuevo',
    colorFusionadoEn: null,
    advertencia: null,
  };
}
