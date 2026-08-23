/**
 * CIFRADO del respaldo (V1-E6a — PLANMAESTRO §2.2 "respaldo doble... cifrado a R2").
 *
 * El volcado de `pg_dump` es la base de negocio ENTERA en un archivo: pedidos, costos, precios,
 * cuentas por pagar, usuarios. Sube a un bucket que administra un tercero, así que sale CIFRADO de
 * este proceso y solo se descifra al restaurar. Cloudflare cifra en reposo por su cuenta, pero eso
 * lo abre cualquiera con la llave del bucket; esto lo abre SOLO quien tenga `RESPALDO_LLAVE`.
 *
 * ⚠️ SI SE PIERDE LA LLAVE, EL RESPALDO ES IRRECUPERABLE. No hay puerta trasera, ni "recuperar
 * contraseña", ni forma de que Cloudflare o nosotros lo abramos: AES-256-GCM con una llave derivada
 * por scrypt no se rompe por fuerza bruta. La llave DEBE vivir fuera de Railway también (gestor de
 * contraseñas de Gabriel/Daniel) — ver `docs/GUIA-RAILWAY-R2.md`.
 *
 * ELECCIONES, y por qué:
 *  • **AES-256-GCM** y no AES-CBC: GCM es cifrado AUTENTICADO. Si el archivo se corrompe en R2 o
 *    alguien lo altera, el descifrado FALLA con error en vez de escupir basura que `pg_restore`
 *    intentaría cargar. En un respaldo, detectar la corrupción es la mitad del valor.
 *  • **scrypt** para derivar la llave de 32 bytes desde la frase: `RESPALDO_LLAVE` es un texto que
 *    escribe un humano en Railway, no 32 bytes crudos. scrypt (costoso en CPU y en RAM) hace que
 *    una frase adivinable siga siendo cara de atacar. La SAL es aleatoria por archivo y viaja en la
 *    cabecera: dos respaldos con la misma frase NO comparten llave.
 *  • **Streaming por trozos** y no `readFile`: el volcado puede pesar cientos de MB y el contenedor
 *    de Railway tiene RAM contada. Nunca se carga el archivo entero en memoria.
 *
 * FORMATO DEL ARCHIVO `.dump.enc` (todo binario, sin envoltura de texto):
 *
 * ```
 * ┌────────────┬─────────┬──────────┬────────┬──────────────────┬──────────┐
 * │ "CTRLRESP" │ versión │   sal    │   iv   │   texto cifrado  │ etiqueta │
 * │  8 bytes   │ 1 byte  │ 16 bytes │ 12 b.  │      variable    │  16 b.   │
 * └────────────┴─────────┴──────────┴────────┴──────────────────┴──────────┘
 * ```
 *
 * La etiqueta de autenticación (GCM) va AL FINAL porque solo se conoce cuando terminó de cifrarse
 * todo; al descifrar se leen esos últimos 16 bytes primero y se le pasan al descifrador.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt } from 'node:crypto';
import { createReadStream, createWriteStream, type WriteStream } from 'node:fs';
import { open, rm, stat } from 'node:fs/promises';

import { ErrorValidacion } from '../errores.js';

/** Marca de agua del formato: identifica el archivo y evita descifrar cualquier cosa. */
export const MAGIA = Buffer.from('CTRLRESP', 'ascii');
/** Versión del formato del archivo (si algún día cambia el esquema, se sube este número). */
export const VERSION_FORMATO = 1;
/** Bytes de la sal de scrypt (aleatoria por archivo). */
export const BYTES_SAL = 16;
/** Bytes del vector de inicialización de GCM (12 es el tamaño recomendado). */
export const BYTES_IV = 12;
/** Bytes de la etiqueta de autenticación de GCM. */
export const BYTES_ETIQUETA = 16;
/** Tamaño total de la cabecera: magia + versión + sal + iv. */
export const BYTES_CABECERA = MAGIA.length + 1 + BYTES_SAL + BYTES_IV;

/**
 * Parámetros de scrypt. `N` (costo) = 2^15: unos 32 MB de RAM y ~0.1 s por derivación — caro para
 * quien ataque por diccionario, imperceptible una vez al día. `maxmem` se sube a mano porque el
 * default de Node (32 MB) queda JUSTO en el límite de estos parámetros y la derivación fallaría.
 */
const SCRYPT_COSTO = 2 ** 15;
const SCRYPT_BLOQUE = 8;
const SCRYPT_PARALELISMO = 1;
const SCRYPT_MAX_MEM = 256 * 1024 * 1024;
/** Bytes de la llave AES-256. */
const BYTES_LLAVE = 32;

/** Cuánto se lee de disco por vuelta (64 KB: suficiente para no ir byte a byte, sin comerse la RAM). */
const TROZO_BYTES = 64 * 1024;

/** El archivo no tiene la forma que produce {@link cifrarArchivo} (o está truncado/corrupto). */
export class ErrorRespaldoIlegible extends ErrorValidacion {}

/**
 * Deriva la llave AES de 32 bytes desde la frase y la sal (scrypt). Exportada porque la usan tanto
 * el cifrado (job diario) como el descifrado (script de restauración) y DEBEN coincidir.
 */
export async function derivarLlave(frase: string, sal: Buffer): Promise<Buffer> {
  // Se envuelve a mano en vez de con `promisify`: la firma promisificada de `scrypt` se queda con la
  // sobrecarga de 3 argumentos y no admite el objeto de opciones (donde van el costo y el `maxmem`).
  return new Promise<Buffer>((resolver, rechazar) => {
    scrypt(
      frase,
      sal,
      BYTES_LLAVE,
      { N: SCRYPT_COSTO, r: SCRYPT_BLOQUE, p: SCRYPT_PARALELISMO, maxmem: SCRYPT_MAX_MEM },
      (error, llave) => {
        if (error === null) {
          resolver(llave);
        } else {
          rechazar(error);
        }
      },
    );
  });
}

/** Escribe un trozo respetando la contrapresión del stream (resuelve cuando ya se vació). */
async function escribir(salida: WriteStream, datos: Buffer): Promise<void> {
  if (datos.length === 0) {
    return;
  }
  await new Promise<void>((resolver, rechazar) => {
    salida.write(datos, (error) => {
      if (error === null || error === undefined) {
        resolver();
      } else {
        rechazar(error);
      }
    });
  });
}

/** Cierra el stream de salida esperando a que el sistema operativo confirme el vaciado. */
async function cerrar(salida: WriteStream): Promise<void> {
  await new Promise<void>((resolver, rechazar) => {
    salida.on('error', rechazar);
    salida.end(() => {
      resolver();
    });
  });
}

/** Lo que deja {@link cifrarArchivo}: cuánto pesa el archivo cifrado y su huella SHA-256. */
export interface ArchivoCifrado {
  /** Tamaño en bytes del archivo cifrado (lo que debe pesar el objeto en R2). */
  bytes: number;
  /**
   * SHA-256 (hex) del archivo cifrado, calculado AL VUELO mientras se escribe (no cuesta una
   * segunda lectura del disco). Sirve para comprobar un respaldo bajado de R2 **sin la llave** y
   * **antes** de necesitarlo: el tamaño que confirma R2 caza una subida truncada, pero no una
   * corrupción del mismo largo — ésa sólo la cazaría GCM al descifrar, o sea el día del desastre.
   */
  sha256: string;
}

/**
 * Cifra `origen` en `destino` con AES-256-GCM y una llave derivada de `frase`. Escribe la cabecera
 * (magia + versión + sal + iv), el texto cifrado y la etiqueta de autenticación al final, y calcula
 * de paso el SHA-256 de todo lo que escribió.
 *
 * Si algo truena a media escritura, BORRA el `destino` a medias: un respaldo parcial que parece
 * archivo es justo la clase de mentira que esta etapa existe para evitar.
 */
export async function cifrarArchivo(
  origen: string,
  destino: string,
  frase: string,
): Promise<ArchivoCifrado> {
  const sal = randomBytes(BYTES_SAL);
  const iv = randomBytes(BYTES_IV);
  const llave = await derivarLlave(frase, sal);
  const cifrador = createCipheriv('aes-256-gcm', llave, iv);

  // El hash se alimenta con CADA trozo que se escribe, en el mismo paso: la huella sale gratis.
  const huella = createHash('sha256');
  const salidaCifrada = createWriteStream(destino);
  /** Escribe en el archivo y alimenta la huella con lo mismo (nunca uno sin el otro). */
  const volcar = async (datos: Buffer): Promise<void> => {
    if (datos.length === 0) {
      return;
    }
    huella.update(datos);
    await escribir(salidaCifrada, datos);
  };
  try {
    await volcar(Buffer.concat([MAGIA, Buffer.from([VERSION_FORMATO]), sal, iv]));
    const entrada = createReadStream(origen, { highWaterMark: TROZO_BYTES });
    for await (const trozo of entrada) {
      await volcar(cifrador.update(trozo as Buffer));
    }
    await volcar(cifrador.final());
    await volcar(cifrador.getAuthTag());
    await cerrar(salidaCifrada);
  } catch (error) {
    salidaCifrada.destroy();
    await rm(destino, { force: true });
    throw error;
  }

  const info = await stat(destino);
  return { bytes: info.size, sha256: huella.digest('hex') };
}

/**
 * SHA-256 (hex) de un archivo del disco, en streaming. Es la comprobación que puede hacer quien
 * RESTAURA sin tener la llave: se contrasta contra el `sha256` que guardó la corrida en
 * `RespaldoCorrida` (equivale a `sha256sum archivo`).
 */
export async function sha256Archivo(ruta: string): Promise<string> {
  const huella = createHash('sha256');
  for await (const trozo of createReadStream(ruta, { highWaterMark: TROZO_BYTES })) {
    huella.update(trozo as Buffer);
  }
  return huella.digest('hex');
}

/**
 * Descifra `origen` (un archivo producido por {@link cifrarArchivo}) en `destino`. Verifica la
 * marca de agua y la versión ANTES de gastar CPU, y la etiqueta GCM AL FINAL: si la frase es
 * equivocada o el archivo está alterado/truncado, lanza y borra el `destino` a medias — nunca
 * entrega un volcado a medio descifrar que `pg_restore` intentaría cargar.
 *
 * @returns el tamaño en bytes del archivo descifrado.
 */
export async function descifrarArchivo(
  origen: string,
  destino: string,
  frase: string,
): Promise<number> {
  const info = await stat(origen);
  if (info.size < BYTES_CABECERA + BYTES_ETIQUETA) {
    throw new ErrorRespaldoIlegible(
      `El archivo "${origen}" es demasiado corto para ser un respaldo de CONTROL (${String(info.size)} bytes).`,
    );
  }

  const manejador = await open(origen, 'r');
  let cabecera: Buffer;
  let etiqueta: Buffer;
  try {
    cabecera = Buffer.alloc(BYTES_CABECERA);
    await manejador.read(cabecera, 0, BYTES_CABECERA, 0);
    etiqueta = Buffer.alloc(BYTES_ETIQUETA);
    await manejador.read(etiqueta, 0, BYTES_ETIQUETA, info.size - BYTES_ETIQUETA);
  } finally {
    await manejador.close();
  }

  if (!cabecera.subarray(0, MAGIA.length).equals(MAGIA)) {
    throw new ErrorRespaldoIlegible(
      `El archivo "${origen}" no es un respaldo cifrado de CONTROL (le falta la marca "CTRLRESP").`,
    );
  }
  const version = cabecera[MAGIA.length];
  if (version !== VERSION_FORMATO) {
    throw new ErrorRespaldoIlegible(
      `El respaldo "${origen}" es de un formato versión ${String(version)}; esta versión del sistema ` +
        `solo sabe leer la ${String(VERSION_FORMATO)}.`,
    );
  }
  const sal = cabecera.subarray(MAGIA.length + 1, MAGIA.length + 1 + BYTES_SAL);
  const iv = cabecera.subarray(MAGIA.length + 1 + BYTES_SAL, BYTES_CABECERA);

  const llave = await derivarLlave(frase, sal);
  const descifrador = createDecipheriv('aes-256-gcm', llave, iv);
  descifrador.setAuthTag(etiqueta);

  const salida = createWriteStream(destino);
  try {
    // El cuerpo va de la cabecera hasta justo antes de la etiqueta (`end` es INCLUSIVO en fs).
    const entrada = createReadStream(origen, {
      start: BYTES_CABECERA,
      end: info.size - BYTES_ETIQUETA - 1,
      highWaterMark: TROZO_BYTES,
    });
    for await (const trozo of entrada) {
      await escribir(salida, descifrador.update(trozo as Buffer));
    }
    // `final()` es donde GCM comprueba la etiqueta: aquí truena la frase equivocada o el archivo
    // alterado. Se traduce a un error con nombre para que el script de restauración lo explique.
    try {
      await escribir(salida, descifrador.final());
    } catch {
      throw new ErrorRespaldoIlegible(
        `No se pudo descifrar "${origen}": la llave (RESPALDO_LLAVE) no corresponde a este respaldo, ` +
          'o el archivo está corrupto o incompleto.',
      );
    }
    await cerrar(salida);
  } catch (error) {
    salida.destroy();
    await rm(destino, { force: true });
    throw error;
  }

  const resultado = await stat(destino);
  return resultado.size;
}
