import { ErrorDeApi } from './errores';

/**
 * Paso 2 COMPARTIDO del flujo presigned de F0: el `PUT` del archivo DIRECTO a R2.
 *
 * Todos los módulos que suben archivos (fotos de modelo, imagen de bordado, adjuntos de
 * desarrollo/orden/pedido/proveedor, PDF de entrada de tela, logo de empresa) hacen lo mismo:
 *   1) `POST` de metadatos al backend → registra el `Archivo` y devuelve una URL PUT prefirmada.
 *   2) el navegador hace `PUT` del archivo a esa URL.
 * El paso 2 vivía COPIADO en ocho archivos; aquí queda UNA sola vez (sin lógica de negocio, A1:
 * esto es puro manejo del error de una llamada HTTP).
 *
 * Dos cosas que este helper resuelve y las copias no resolvían:
 *
 * **a) El mensaje no puede culpar a la conexión del usuario.** Un `fetch` del navegador solo
 * *lanza* por red caída, DNS… o por **bloqueo CORS**. Cuando R2 rechaza el PUT por permisos (llave
 * S3 sin permiso de escritura) o cuando la política CORS del bucket ya no acepta PUT desde el
 * origen del front, la respuesta viene SIN cabeceras CORS y el navegador la disfraza de "falla de
 * red" — indistinguible de un cable desconectado. En la práctica, con el sistema navegando bien,
 * ese `catch` es casi siempre **configuración del almacenamiento**, no el internet del usuario
 * (ver `backend/src/comun/archivos.ts` y las trampas de R2 en `docs/hoja-de-ruta/F1-etapas.md`).
 * Por eso el texto visible no manda a "verificar tu conexión" ni menciona CORS/R2 (jerga que el
 * usuario final no debe leer): dice que pudo ser configuración y que avise a soporte.
 *
 * **b) El intento fallido deja un registro fantasma.** El backend crea el `Archivo` (y su liga:
 * `ModeloFoto`, adjunto, etc.) ANTES de que el navegador suba — es inherente al flujo prefirmado.
 * Si el PUT falla, ese registro apunta a una key sin objeto: foto vacía en la galería y conteos
 * inflados, y en serie (el usuario reintenta 5 veces) deja 5. Por eso quien llama pasa `limpiar`,
 * que quita el registro recién creado usando el endpoint de borrado que ya existe en su módulo.
 * No hay objeto que borrar en R2 (nunca llegó a subir), así que la deuda conocida de "borrar no
 * elimina el objeto físico" no aplica aquí.
 */

/** Cómo se nombra el archivo en el mensaje que lee el usuario. */
export type SustantivoArchivo = 'la imagen' | 'el archivo' | 'el logo';

/** Opciones del `PUT` prefirmado. */
export interface OpcionesSubidaPrefirmada {
  /** URL PUT prefirmada que devolvió el backend en el paso 1. */
  urlSubida: string;
  /** El archivo elegido por el usuario. */
  archivo: File;
  /** `Content-Type` EXACTO a mandar (el MISMO que se registró en el paso 1). */
  tipoMime: string;
  /**
   * Mandar también `Content-Length`. Es un "forbidden header": el navegador lo fija solo e ignora
   * el nuestro, y la URL prefirmada ya no lo firma. Se conserva donde ya se mandaba para no
   * cambiar el request de esos módulos.
   */
  conContentLength?: boolean;
  /** Con qué palabra nombrar el archivo en el mensaje del usuario. */
  sustantivo: SustantivoArchivo;
  /**
   * Limpieza del registro que el paso 1 YA creó, para que un intento fallido no deje fantasma.
   * Es BEST-EFFORT: si ella misma falla, el usuario sigue viendo el error de la subida (el de
   * verdad), nunca uno del borrado. Se omite donde el registro no estorba (p. ej. el logo, que no
   * se vuelve vigente hasta el paso de confirmación).
   */
  limpiar?: () => Promise<void>;
}

/** Quita el registro recién creado sin dejar que su propio fallo tape el error original. */
async function limpiarSinTapar(limpiar: (() => Promise<void>) | undefined): Promise<void> {
  if (limpiar === undefined) {
    return;
  }
  try {
    await limpiar();
  } catch (fallo) {
    // Best-effort a propósito: el error que importa es el de la SUBIDA, y ese es el que se lanza.
    // Pero tragárselo del todo dejaba a soporte sin pista de que ADEMÁS quedó un registro fantasma
    // (o de que el borrado no aplicó porque otro ya había reemplazado el archivo). Se deja rastro
    // en la consola —igual que el backend en sus best-effort—, sin tapar el error de la subida.
    console.warn('No se pudo limpiar el registro del intento de subida fallido.', fallo);
  }
}

/**
 * Hace el `PUT` prefirmado del archivo a R2. Si falla, limpia el registro del paso 1 (si le
 * pasaron `limpiar`) y lanza `ErrorDeApi` con un mensaje honesto para el toast.
 */
export async function subirArchivoPrefirmado({
  urlSubida,
  archivo,
  tipoMime,
  conContentLength = false,
  sustantivo,
  limpiar,
}: OpcionesSubidaPrefirmada): Promise<void> {
  const cabeceras: Record<string, string> = { 'Content-Type': tipoMime };
  if (conContentLength) {
    cabeceras['Content-Length'] = String(archivo.size);
  }

  let respuesta: Response;
  try {
    respuesta = await fetch(urlSubida, { method: 'PUT', headers: cabeceras, body: archivo });
  } catch {
    // Red caída, DNS… o CORS/permisos de R2 disfrazados de falla de red (ver nota (a) arriba).
    await limpiarSinTapar(limpiar);
    throw new ErrorDeApi({
      codigo: 'SUBIDA',
      mensaje:
        `No se pudo guardar ${sustantivo}. Puede tratarse de un problema de configuración del ` +
        `almacenamiento de archivos, no de tu conexión. Vuelve a intentar y, si sigue igual, ` +
        `avisa a soporte.`,
    });
  }

  if (!respuesta.ok) {
    // Aquí R2 SÍ contestó (403, 400…): el número le sirve a soporte para ubicar la causa.
    await limpiarSinTapar(limpiar);
    throw new ErrorDeApi({
      codigo: 'SUBIDA',
      mensaje:
        `El almacenamiento rechazó ${sustantivo} (error ${String(respuesta.status)}). Vuelve a ` +
        `intentar y, si sigue igual, avisa a soporte.`,
    });
  }
}
