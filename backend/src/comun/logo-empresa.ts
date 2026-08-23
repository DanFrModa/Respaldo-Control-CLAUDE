/**
 * LOGO DE LA EMPRESA — el único punto por el que TODO el sistema resuelve la marca (post-F9,
 * petición de Daniel del 25-jul-2026: *"no vas a pegar el logo en todos lados, sino que vas a
 * llamar el mismo archivo para poder cambiarlo en cualquier momento sin tener que cambiar todo"*).
 *
 * Fuente de verdad: `Empresa.idArchivoLogo` → objeto en R2, subido desde Administración › Empresas.
 * Cambiarlo ahí actualiza los 23 impresos PDF y la app entera SIN desplegar. Si la empresa todavía
 * no tiene logo (o R2 falla, o el objeto ya no está), se cae al PNG EMPAQUETADO del repo
 * (`logo-empaquetado.ts`), así que el sistema se ve brandeado desde el primer arranque.
 *
 * Reglas de este módulo:
 *  • **Nunca lanza.** Un logo es decoración: si algo falla, se devuelve el empaquetado y ya. Un
 *    impreso JAMÁS debe romperse por la marca.
 *  • **Cachea en memoria** (el logo cambia rarísimo y se pide en cada PDF y en cada carga de la
 *    app): por empresa, con TTL corto e invalidación explícita al subir/quitar
 *    ({@link invalidarLogoEmpresa}). La clave incluye el `idArchivoLogo` visto, así que si otra
 *    instancia lo cambia, el TTL lo alcanza sin reiniciar.
 *  • **Con tope de tiempo.** La lectura (BD + R2) corre contra {@link TOPE_RESOLUCION_MS}; si se
 *    pasa, se responde con el empaquetado. Así una base lenta no atrasa un PDF ni una pantalla.
 *
 * Lo consumen: `pdf-worker.ts` (inyecta el logo al hilo que renderiza los PDFs, ver
 * `impresos-estilos.ts` → `fijarLogoImpresos`) y las rutas del API que sirven el logo a la app.
 */
import {
  ErrorArchivoDemasiadoGrande,
  servicioArchivos,
  type ServicioArchivos,
} from './archivos.js';
import {
  bytesLogoEmpaquetado,
  LOGO_EMPAQUETADO_DATA_URL,
  LOGO_EMPAQUETADO_MIME,
} from './logo-empaquetado.js';
import { clienteLectura, type ContextoBd } from './transaccion.js';

/** Cuánto se conserva en memoria un logo resuelto antes de volver a preguntarle a la BD (ms). */
const TTL_CACHE_MS = 5 * 60 * 1000;

/**
 * Cuánto se recuerda un FALLO de resolución (BD o R2 caídos) antes de reintentar (ms).
 *
 * Corto a propósito: si no se recordara nada, un bache de la base le costaría un viaje FALLIDO a
 * CADA impreso y a cada carga de la app (y en las pruebas, a cada render del pool de workers); y si
 * se recordara tanto como un éxito, el logo tardaría hasta 5 min en volver tras recuperarse. Diez
 * segundos corta la avalancha sin que nadie note la espera.
 */
const TTL_FALLO_MS = 10_000;

/** Tope de la resolución completa (BD + descarga de R2). Si se pasa, se usa el empaquetado. */
const TOPE_RESOLUCION_MS = 4_000;

/** MIME que se aceptan como logo: los que `@react-pdf/renderer` sabe incrustar en un PDF. */
export const MIME_LOGO_PERMITIDOS = ['image/png', 'image/jpeg'] as const;

/** Tamaño máximo del logo (5 MB): es un membrete, no una foto de catálogo. */
export const TAMANO_MAXIMO_LOGO_BYTES = 5 * 1024 * 1024;

/** De dónde salió el logo que se está usando. */
export type OrigenLogo = 'empresa' | 'empaquetado';

/** Logo ya resuelto y listo para pintar (en un PDF o por HTTP). */
export interface LogoResuelto {
  /** Bytes de la imagen. */
  bytes: Buffer;
  /** Tipo MIME real de esos bytes. */
  tipoMime: string;
  /** Data-URL lista para `<Image src>` de react-pdf o un `<img>`. */
  dataUrl: string;
  /** `empresa` = el que subió el usuario; `empaquetado` = el respaldo del repo. */
  origen: OrigenLogo;
  /** Id del `Archivo` cuando el logo es de la empresa (sirve de ETag/versión); `null` si es el empaquetado. */
  idArchivo: string | null;
}

/** Entrada de la caché en memoria. */
interface EnCache {
  logo: LogoResuelto;
  /** Momento (epoch ms) a partir del cual hay que volver a resolver. */
  expiraEn: number;
}

/** Caché por empresa. Diminuta (hay una o dos empresas) y de vida corta. */
const cache = new Map<number, EnCache>();

/**
 * ¿Los bytes son de verdad un PNG o un JPEG? Se comprueba por FIRMA (magic bytes), no por el MIME
 * que declaró el navegador al subir: `@react-pdf/renderer` LANZA al incrustar una imagen corrupta o
 * de un formato que no entiende, y eso reventaría el impreso. Con esto, un archivo malo cae al
 * empaquetado en vez de romper el PDF.
 *
 * PNG: `89 50 4E 47 0D 0A 1A 0A`. JPEG: empieza en `FF D8 FF`.
 */
function esImagenSoportada(bytes: Buffer): boolean {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (bytes.byteLength >= png.byteLength && bytes.subarray(0, png.byteLength).equals(png)) {
    return true;
  }
  return bytes.byteLength >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

/** MIME REAL deducido de la firma (no del que declaró el navegador). */
function mimePorFirma(bytes: Buffer): string {
  return bytes[0] === 0xff ? 'image/jpeg' : 'image/png';
}

/** El logo empaquetado como {@link LogoResuelto} (se arma nuevo cada vez: el Buffer es del llamador). */
function logoEmpaquetado(): LogoResuelto {
  return {
    bytes: bytesLogoEmpaquetado(),
    tipoMime: LOGO_EMPAQUETADO_MIME,
    dataUrl: LOGO_EMPAQUETADO_DATA_URL,
    origen: 'empaquetado',
    idArchivo: null,
  };
}

/**
 * Olvida el logo cacheado de una empresa (o de TODAS si no se indica). La llaman los servicios de
 * dominio al subir o quitar el logo, para que el cambio se vea al instante en el mismo proceso.
 */
export function invalidarLogoEmpresa(idEmpresa?: number): void {
  if (idEmpresa === undefined) {
    cache.clear();
    return;
  }
  cache.delete(idEmpresa);
  // La entrada 0 es la "empresa predeterminada" (la que usan los impresos): puede ser justamente
  // ésta, así que se tira también — resolverla de nuevo cuesta una consulta y evita marca vieja.
  cache.delete(0);
}

/**
 * Id del `Archivo` que es el logo de una empresa, o `null` si no tiene. Consulta mínima (una
 * columna): la usa `GET /api/sesion` para que el frontend sepa si pedir el logo del servidor o
 * pintar el empaquetado, y como versión para invalidar la caché del navegador.
 */
export async function idLogoEmpresa(idEmpresa: number, bd?: ContextoBd): Promise<string | null> {
  const empresa = await clienteLectura(bd).empresa.findUnique({
    where: { id: idEmpresa },
    select: { idArchivoLogo: true },
  });
  return empresa?.idArchivoLogo ?? null;
}

/**
 * Lee el logo desde la BD + R2. Lanza si algo falla (el llamador decide qué hacer).
 *
 * `idEmpresa === undefined` = **empresa predeterminada**: la favorita y, si no hay, la primera
 * activa por id — el MISMO criterio con el que `auth/sesion.ts` elige la empresa activa. Es un
 * RESPALDO para los pocos llamadores sin sesión (la pantalla de login, que todavía no tiene
 * empresa activa); todo lo que tenga sesión debe pasar `sesion.idEmpresaActiva` (A9).
 */
async function leerLogoDeEmpresa(
  idEmpresa: number | undefined,
  bd: ContextoBd | undefined,
  archivos: ServicioArchivos | undefined,
): Promise<LogoResuelto> {
  const empresa = await clienteLectura(bd).empresa.findFirst({
    where: idEmpresa === undefined ? { activa: true } : { id: idEmpresa },
    orderBy: [{ favorita: 'desc' }, { id: 'asc' }],
    select: { archivoLogo: { select: { id: true, key: true, tipoMime: true } } },
  });
  const archivo = empresa?.archivoLogo ?? null;
  if (archivo === null) {
    return logoEmpaquetado();
  }

  // `servicioArchivos()` se resuelve AQUÍ (no como default del parámetro): lanza si faltan las
  // `R2_*`, y eso debe caer dentro del try/catch del llamador para acabar en el empaquetado.
  //
  // El TOPE es obligatorio: el `tamanoBytes` que validó el POST lo declaró el navegador y la URL
  // PUT prefirmada NO firma `Content-Length`, así que el objeto real puede ser mucho mayor que los
  // 5 MB aceptados. Sin tope, cada impreso y cada `GET /api/empresas/logo` se traerían el objeto
  // entero a RAM, lo cachearían 5 min y lo pasarían a base64 (≈ +33 %) dentro de cada PDF.
  let bytes: Buffer;
  try {
    bytes = await (archivos ?? servicioArchivos()).descargarContenido(
      archivo.key,
      TAMANO_MAXIMO_LOGO_BYTES,
    );
  } catch (error) {
    // "Pesa de más" es un estado ESTABLE del archivo, no un fallo transitorio de R2: se resuelve
    // al empaquetado y se CACHEA (si se dejara escapar como fallo, cada PDF repetiría el viaje a
    // R2 para volver a descartarlo). Cualquier otro error sí se propaga: es transitorio.
    if (error instanceof ErrorArchivoDemasiadoGrande) {
      return logoEmpaquetado();
    }
    throw error;
  }
  if (!esImagenSoportada(bytes)) {
    return logoEmpaquetado();
  }
  const tipoMime = mimePorFirma(bytes);
  return {
    bytes,
    tipoMime,
    dataUrl: `data:${tipoMime};base64,${bytes.toString('base64')}`,
    origen: 'empresa',
    idArchivo: archivo.id,
  };
}

/**
 * Resuelve el LOGO a usar para una empresa: el que subió el usuario o, si no hay (o falla algo),
 * el empaquetado del repo. **Nunca lanza y nunca tarda más de {@link TOPE_RESOLUCION_MS}.**
 *
 * El resultado se cachea en memoria y `invalidarLogoEmpresa` lo tira al subir/quitar. Una
 * resolución EXITOSA (haya logo propio o no) dura {@link TTL_CACHE_MS}; un FALLO se recuerda solo
 * {@link TTL_FALLO_MS}, lo justo para no repetir el viaje fallido en cada impreso pero recuperando
 * el logo real casi de inmediato.
 *
 * @param idEmpresa empresa cuyo logo se quiere. `undefined` = la predeterminada (favorita / primera
 *   activa), que es lo que usan los impresos.
 */
export async function obtenerLogoEmpresa(
  idEmpresa?: number,
  bd?: ContextoBd,
  archivos?: ServicioArchivos,
): Promise<LogoResuelto> {
  // La empresa predeterminada se cachea bajo la clave 0 (no hay empresas con id 0).
  const clave = idEmpresa ?? 0;
  const guardado = cache.get(clave);
  if (guardado !== undefined && guardado.expiraEn > Date.now()) {
    return guardado.logo;
  }

  let logo: LogoResuelto;
  try {
    // Tope duro: ni la BD ni R2 pueden atrasar un impreso o una pantalla por el membrete.
    logo = await Promise.race([
      leerLogoDeEmpresa(idEmpresa, bd, archivos),
      new Promise<LogoResuelto>((_, rechazar) =>
        setTimeout(
          () => rechazar(new Error('tiempo agotado al resolver el logo de la empresa')),
          TOPE_RESOLUCION_MS,
        ).unref(),
      ),
    ]);
  } catch {
    // Best-effort absoluto (el logo es decoración): sin BD, sin R2 o con el objeto borrado, el
    // sistema sigue brandeado con el empaquetado. El fallo se recuerda MUY poco (ver
    // {@link TTL_FALLO_MS}): lo justo para no repetir el viaje fallido en cada impreso, sin que el
    // logo real tarde en volver cuando la BD o R2 se recuperen.
    const respaldo = logoEmpaquetado();
    cache.set(clave, { logo: respaldo, expiraEn: Date.now() + TTL_FALLO_MS });
    return respaldo;
  }

  cache.set(clave, { logo, expiraEn: Date.now() + TTL_CACHE_MS });
  return logo;
}

/**
 * Atajo para los impresos: la data-URL del logo de la empresa (o del empaquetado). Es lo que
 * `pdf-worker.ts` manda al hilo que renderiza, para que `EncabezadoDocumento` lo pinte sin tener
 * que ser asíncrono ni tocar la BD desde el worker.
 */
export async function dataUrlLogoEmpresa(
  idEmpresa?: number,
  bd?: ContextoBd,
  archivos?: ServicioArchivos,
): Promise<string> {
  const logo = await obtenerLogoEmpresa(idEmpresa, bd, archivos);
  return logo.dataUrl;
}
