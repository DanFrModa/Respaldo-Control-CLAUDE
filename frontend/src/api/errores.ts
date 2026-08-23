/**
 * Manejo uniforme de errores del API en el frontend.
 *
 * El backend responde los errores con la forma estable `{ codigo, mensaje,
 * detalles? }` (contrato OpenAPI, `esquemaErrorApi`). `openapi-fetch` entrega
 * ese cuerpo en el campo `error` de la respuesta. Aqui se normaliza a un mensaje
 * en espanol listo para mostrar (toast), SIN inventar logica: solo presenta lo
 * que el servidor decidio (el frontend nunca razona reglas de negocio, A1).
 */

/** Forma del cuerpo de error del API (espejo de `esquemaErrorApi` del backend). */
export interface ErrorApi {
  codigo: string;
  mensaje: string;
  detalles?: unknown;
}

/**
 * Cuantas frases de `detalles` se pegan al mensaje, como maximo. Con un cuerpo grande —una compra de
 * veinte renglones— Zod puede devolver una por renglon; volcarlas todas daria un aviso que nadie
 * lee. Se dicen las primeras y se cuenta el resto.
 */
const MAXIMO_DETALLES = 3;

/**
 * 🔴 **V1-E3z (3a vuelta) — LAS FRASES DEL SERVIDOR VIVEN EN `detalles`, NO EN `mensaje`.**
 *
 * Un rechazo de validacion del backend sale asi (`backend/src/api/errores.ts`, rama 2 del handler):
 *
 * ```json
 * { "codigo": "VALIDACION",
 *   "mensaje": "Los datos enviados no son válidos.",
 *   "detalles": [{ "campo": "/ajustes/0/precioUnitario",
 *                  "mensaje": "El precio no puede ser negativo" }] }
 * ```
 *
 * ⚠️ Hasta aqui `mensajeDeError` devolvia **solo `error.mensaje`**, o sea el generico — y un `grep`
 * de `detalles` en todo `src/` no encontraba **ni un lugar** que las pintara. O sea que **todas** las
 * frases del contrato (los `min`/`max`, los `refine`, los mensajes escritos a mano en cada esquema)
 * estaban escritas, viajaban por la red y **nunca llegaban a una pantalla**. Lo que el usuario veia
 * al teclear un precio negativo era *"Los datos enviados no son válidos."*: ni que campo, ni por que.
 *
 * Se arregla **aqui, en el punto unico**, y no en la pantalla que lo descubrio: el defecto era de
 * toda la aplicacion, y arreglarlo en un solo sitio devuelve las frases en todos lados.
 *
 * ⚠️⚠️ **HAY DOS PRODUCTORES DE `detalles`, CON FORMAS DISTINTAS, Y LOS DOS CUENTAN.** La 3a vuelta
 * de esta etapa cubrio solo uno y afirmo por escrito —falsamente— que era el unico. Los dos:
 *
 *  1. **`backend/src/api/errores.ts`** (rama Zod del handler HTTP): un **ARREGLO** de
 *     `{ campo, mensaje }`, uno por issue. Es lo que rechaza el `body` de la ruta.
 *  2. **`backend/src/comun/validacion.ts`** (`validarEntrada`): un **OBJETO APLANADO**
 *     `{ formErrors: string[], fieldErrors: Record<string, string[]> }` (`z.flattenError`), que
 *     `cuerpoDeErrorDominio` propaga tal cual al cuerpo HTTP. Es el helper de validacion
 *     **estandar de toda la capa de dominio** (PLANMAESTRO §9.2) — **320 llamadas** en
 *     `src/dominio`. O sea: no es un rincon, es el camino normal.
 *
 * Reconocer solo el arreglo dejaba viva justo la mitad mas transitada: un rechazo de dominio seguia
 * leyendose *"Los datos capturados no son válidos."* a secas, con los `fieldErrors` muriendo en el
 * camino igual que antes.
 */
function frasesDeDetalles(detalles: unknown): string[] {
  if (typeof detalles !== 'object' || detalles === null) return [];

  // Forma 1 — ARREGLO de `{ campo, mensaje }` (rama Zod del handler HTTP).
  const crudas = Array.isArray(detalles)
    ? detalles.map((d) =>
        typeof d === 'object' && d !== null ? (d as Record<string, unknown>).mensaje : null,
      )
    : // Forma 2 — OBJETO APLANADO de `validarEntrada` (`z.flattenError`). Primero lo que no cuelga
      // de ningun campo (`formErrors`) y luego lo de cada campo, para que lo general se lea antes
      // que lo particular. Las CLAVES de `fieldErrors` no se pintan: son nombres tecnicos del
      // esquema (`ajustes`, `cantFav`), no lo que el usuario ve en pantalla.
      [
        ...aplanarTextos((detalles as Record<string, unknown>).formErrors),
        ...Object.values((detalles as Record<string, unknown>).fieldErrors ?? {}).flatMap(
          aplanarTextos,
        ),
      ];

  const frases = crudas
    .filter((m): m is string => typeof m === 'string' && m.trim().length > 0)
    .map((m) => m.trim());
  // Se DEDUPLICAN: veinte renglones con el mismo defecto producen veinte detalles identicos, y
  // repetir la misma frase veinte veces es peor que decirla una.
  return [...new Set(frases)];
}

/** Un valor que deberia ser `string[]`, tratado con desconfianza (viene de la red). */
function aplanarTextos(valor: unknown): unknown[] {
  return Array.isArray(valor) ? valor : [];
}

/** Le pone punto final a una frase que no lo trae, para poder pegarlas sin que se lean como una. */
function conPunto(frase: string): string {
  return /[.!?:]$/.test(frase) ? frase : `${frase}.`;
}

/** Mensaje de respaldo cuando no se reconoce el error (red caida, 5xx sin cuerpo, etc.). */
export const MENSAJE_ERROR_DESCONOCIDO =
  'Ocurrio un error inesperado. Intenta de nuevo en un momento.';

/** ¿El valor tiene la forma `{ codigo, mensaje }` del error del API? */
function esErrorApi(valor: unknown): valor is ErrorApi {
  return (
    typeof valor === 'object' &&
    valor !== null &&
    typeof (valor as Record<string, unknown>).mensaje === 'string' &&
    typeof (valor as Record<string, unknown>).codigo === 'string'
  );
}

/**
 * Traduce el `error` de una respuesta de `openapi-fetch` (o un error de red) a un
 * mensaje en espanol. Prefiere el `mensaje` del backend; si no lo hay, el de
 * respaldo.
 *
 * ⭐ Y le pega las frases especificas de `detalles` cuando las trae (ver
 * {@link frasesDeDetalles}): el `mensaje` de un rechazo de validacion es siempre el mismo generico,
 * asi que sin esto el usuario nunca sabe **que** estuvo mal.
 */
export function mensajeDeError(error: unknown): string {
  if (esErrorApi(error)) {
    const frases = frasesDeDetalles(error.detalles);
    if (frases.length === 0) return error.mensaje;
    const dichas = frases.slice(0, MAXIMO_DETALLES).map(conPunto).join(' ');
    const resto = frases.length - MAXIMO_DETALLES;
    return resto > 0
      ? `${conPunto(error.mensaje)} ${dichas} (y ${String(resto)} ${resto === 1 ? 'problema' : 'problemas'} más)`
      : `${conPunto(error.mensaje)} ${dichas}`;
  }
  if (error instanceof Error && error.message.length > 0) {
    return MENSAJE_ERROR_DESCONOCIDO;
  }
  return MENSAJE_ERROR_DESCONOCIDO;
}

/**
 * Error tipado que lanzan los hooks de datos cuando el API responde un fallo.
 * Lleva el codigo estable y el mensaje en espanol para que la UI decida (mostrar
 * toast, etc.). Se usa con TanStack Query (`throwOnError`/`onError`).
 */
export class ErrorDeApi extends Error {
  readonly codigo: string;

  constructor(error: unknown) {
    super(mensajeDeError(error));
    this.name = 'ErrorDeApi';
    this.codigo = esErrorApi(error) ? error.codigo : 'DESCONOCIDO';
  }
}
