/**
 * ⭐⭐ 0.140 (2ª ronda) — **UN ZIP QUE SE ESCRIBE AL VUELO, SIN JUNTAR LOS ARCHIVOS EN MEMORIA.**
 *
 * ## Para qué existe
 *
 * La impresión por lote de órdenes dejó de ser UN PDF: cuando el lote no cabe en el presupuesto de
 * imágenes se **parte en varios PDFs** para que ninguna hoja salga coja (Daniel, 2ª ronda de la
 * 0.140). El usuario tiene que poder bajarse eso de una sola vez, y un ZIP es la forma normal de
 * entregar varios archivos por una sola respuesta HTTP.
 *
 * 🔴 **Pero juntarlos para comprimirlos tiraría por la borda justo lo que la fila vino a arreglar.**
 * Si se generan los quince PDFs y luego se empaquetan, se retienen los quince a la vez y el pico
 * vuelve a crecer con el número de órdenes — que es el criterio que la fila NO puede incumplir. Por
 * eso esto es un empaquetador **de flujo**: recibe los archivos de uno en uno, escribe cada uno en
 * cuanto lo tiene y **lo suelta**.
 *
 * ⚠️ **CUÁNTOS PDF HAY VIVOS A LA VEZ — contados, no razonados: DOS.** Este empaquetador retiene
 * uno mientras lo escribe y `Readable.from` pide por delante, así que la cadena entera (ruta → este
 * empaquetador → el flujo) sostiene **2 PDF en el peor instante**. Medido con `WeakRef` + `gc()`
 * muestreando en los dos extremos —cuando se pide una parte nueva y cuando el consumidor recibe un
 * trozo—: `medicion/vivos-r4.mts`, 10 partes de 32 MB ⇒ **máximo 2** (163 MB de pico).
 *
 * 🔴 Y el número se ganó con un arreglo, no con una frase: hasta la 4ª ronda la ruta guardaba sus
 * dos primeras partes en `const` **dentro del generador**, que el marco sujeta hasta el final del
 * ZIP; el mismo arnés sobre esa forma da **máximo 4** (227 MB). Las rondas 2 y 3 llegaron a escribir
 * aquí «nunca hay dos PDF vivos a la vez», que era falso en los dos sentidos: ni era uno, ni el
 * código de al lado lo cumplía. **Lo que importa se conserva: ese 2 NO depende del número de
 * órdenes del lote.**
 *
 * ## Por qué a mano, y por qué SIN comprimir
 *
 * No hay librería de ZIP en el backend y no valía la pena traer una: un ZIP **almacenado** (método
 * 0, sin compresión) son tres estructuras y un CRC-32, y el CRC lo da `node:zlib`. Además comprimir
 * no serviría de nada —**un PDF ya viene comprimido por dentro**—, así que "almacenado" no es un
 * atajo sino la elección correcta: cuesta cero CPU y el archivo pesa lo mismo.
 *
 * Escribir el formato a mano es exactamente el tipo de cosa que sale mal en silencio, así que la
 * prueba de este archivo **no se cree la teoría**: escribe un ZIP y lo vuelve a abrir para
 * comprobar que los bytes que salen son los que entraron.
 *
 * ⚠️ **Límite conocido y dicho:** esto NO implementa ZIP64, así que vale hasta 4 GiB por archivo,
 * 4 GiB de total y 65 535 archivos. Un lote de 100 órdenes son ~15 PDFs de ~100 MB: dos órdenes de
 * magnitud por debajo. {@link empaquetarZipAlVuelo} lo comprueba y falla ruidosamente si algún día
 * se acerca, en vez de emitir un archivo corrupto que nadie sabría leer.
 */
import { Readable } from 'node:stream';
import { crc32 } from 'node:zlib';

/** Firmas del formato ZIP (APPNOTE 4.3): cabecera local, entrada del central y fin del central. */
const FIRMA_LOCAL = 0x04034b50;
const FIRMA_CENTRAL = 0x02014b50;
const FIRMA_FIN_CENTRAL = 0x06054b50;

/** Versión mínima para extraer: 2.0 (la de un ZIP "almacenado" de toda la vida). */
const VERSION_NECESARIA = 20;
/** Bit 11 del flag general: los nombres van en UTF-8. */
const FLAG_UTF8 = 0x0800;
/** Método de compresión 0 = ALMACENADO (los PDF ya vienen comprimidos). */
const METODO_ALMACENADO = 0;

/** Techo de ZIP sin ZIP64. Pasarse de aquí produce un archivo que nadie puede abrir. */
const TECHO_ZIP32 = 0xffffffff;
/** Máximo de entradas en el directorio central sin ZIP64. */
const MAX_ARCHIVOS = 0xffff;

/** Un archivo a meter en el ZIP. */
export interface ArchivoZip {
  /** Nombre dentro del ZIP (con su extensión). Se guarda en UTF-8. */
  nombre: string;
  /** Su contenido completo. Se escribe y se suelta: no se conserva. */
  contenido: Buffer;
}

/** Lo que hay que recordar de cada archivo ya escrito para armar el directorio central. */
interface EntradaEscrita {
  nombre: Buffer;
  crc: number;
  tamano: number;
  desplazamiento: number;
  fecha: { hora: number; dia: number };
}

/**
 * La fecha/hora en el formato MS-DOS que usa el ZIP (resolución de 2 segundos, desde 1980). Se
 * guarda la hora LOCAL del servidor, que es lo que el formato define y lo que espera cualquier
 * descompresor.
 */
function fechaDos(cuando: Date): { hora: number; dia: number } {
  const anio = Math.max(1980, cuando.getFullYear());
  return {
    hora:
      (cuando.getHours() << 11) |
      (cuando.getMinutes() << 5) |
      (Math.floor(cuando.getSeconds() / 2) & 0x1f),
    dia: ((anio - 1980) << 9) | ((cuando.getMonth() + 1) << 5) | cuando.getDate(),
  };
}

/** Cabecera LOCAL: va justo antes de los bytes del archivo. */
function cabeceraLocal(entrada: EntradaEscrita): Buffer {
  const cabecera = Buffer.alloc(30);
  cabecera.writeUInt32LE(FIRMA_LOCAL, 0);
  cabecera.writeUInt16LE(VERSION_NECESARIA, 4);
  cabecera.writeUInt16LE(FLAG_UTF8, 6);
  cabecera.writeUInt16LE(METODO_ALMACENADO, 8);
  cabecera.writeUInt16LE(entrada.fecha.hora, 10);
  cabecera.writeUInt16LE(entrada.fecha.dia, 12);
  cabecera.writeUInt32LE(entrada.crc, 14);
  // Almacenado ⇒ comprimido y sin comprimir miden lo mismo.
  cabecera.writeUInt32LE(entrada.tamano, 18);
  cabecera.writeUInt32LE(entrada.tamano, 22);
  cabecera.writeUInt16LE(entrada.nombre.length, 26);
  cabecera.writeUInt16LE(0, 28); // sin campos extra
  return Buffer.concat([cabecera, entrada.nombre]);
}

/** Entrada del DIRECTORIO CENTRAL: el índice que el descompresor lee primero. */
function entradaCentral(entrada: EntradaEscrita): Buffer {
  const cabecera = Buffer.alloc(46);
  cabecera.writeUInt32LE(FIRMA_CENTRAL, 0);
  cabecera.writeUInt16LE(VERSION_NECESARIA, 4); // versión que lo creó
  cabecera.writeUInt16LE(VERSION_NECESARIA, 6); // versión necesaria para extraer
  cabecera.writeUInt16LE(FLAG_UTF8, 8);
  cabecera.writeUInt16LE(METODO_ALMACENADO, 10);
  cabecera.writeUInt16LE(entrada.fecha.hora, 12);
  cabecera.writeUInt16LE(entrada.fecha.dia, 14);
  cabecera.writeUInt32LE(entrada.crc, 16);
  cabecera.writeUInt32LE(entrada.tamano, 20);
  cabecera.writeUInt32LE(entrada.tamano, 24);
  cabecera.writeUInt16LE(entrada.nombre.length, 28);
  cabecera.writeUInt16LE(0, 30); // extra
  cabecera.writeUInt16LE(0, 32); // comentario
  cabecera.writeUInt16LE(0, 34); // disco
  cabecera.writeUInt16LE(0, 36); // atributos internos
  cabecera.writeUInt32LE(0, 38); // atributos externos
  cabecera.writeUInt32LE(entrada.desplazamiento, 42);
  return Buffer.concat([cabecera, entrada.nombre]);
}

/** Cierre: dónde empieza el directorio central y cuánto mide. */
function finDelCentral(entradas: readonly EntradaEscrita[], inicio: number, largo: number): Buffer {
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(FIRMA_FIN_CENTRAL, 0);
  fin.writeUInt16LE(0, 4); // disco
  fin.writeUInt16LE(0, 6); // disco donde empieza el central
  fin.writeUInt16LE(entradas.length, 8);
  fin.writeUInt16LE(entradas.length, 10);
  fin.writeUInt32LE(largo, 12);
  fin.writeUInt32LE(inicio, 16);
  fin.writeUInt16LE(0, 20); // sin comentario
  return fin;
}

/**
 * Empaqueta en un ZIP los archivos que vayan saliendo de `archivos`, **de uno en uno**, y devuelve
 * un flujo listo para mandar por HTTP.
 *
 * 🔑 La clave es que `archivos` es un iterable ASÍNCRONO: cada archivo se pide sólo cuando toca
 * escribirlo, se escribe y se suelta. Quien lo produce (la impresión por lote) genera un PDF, lo
 * entrega y pasa al siguiente, así que **lo vivo no crece con el número de órdenes** — son 2 en el
 * peor instante, contados arriba, no uno.
 *
 * Si el productor lanza, el error viaja por el flujo (`destroy`) en vez de dejar un ZIP truncado
 * que parecería válido: una respuesta cortada se nota, un archivo corrupto no.
 */
export function empaquetarZipAlVuelo(archivos: AsyncIterable<ArchivoZip>): Readable {
  const entradas: EntradaEscrita[] = [];
  let desplazamiento = 0;

  async function* bytes(): AsyncGenerator<Buffer> {
    for await (const archivo of archivos) {
      const nombre = Buffer.from(archivo.nombre, 'utf8');
      const entrada: EntradaEscrita = {
        nombre,
        crc: crc32(archivo.contenido) >>> 0,
        tamano: archivo.contenido.length,
        desplazamiento,
        fecha: fechaDos(new Date()),
      };
      const cabecera = cabeceraLocal(entrada);
      desplazamiento += cabecera.length + entrada.tamano;
      if (desplazamiento > TECHO_ZIP32 || entradas.length >= MAX_ARCHIVOS) {
        // Ruidoso a propósito: mejor una descarga que falla que un .zip que nadie puede abrir.
        throw new Error(
          'El ZIP de impresos superó el límite del formato (4 GiB o 65 535 archivos). ' +
            'Hay que imprimir el lote en dos tandas con menos órdenes cada una.',
        );
      }
      entradas.push(entrada);
      yield cabecera;
      yield archivo.contenido;
      // A partir de aquí este PDF ya no lo referencia nadie: puede recogerse.
    }
    const inicio = desplazamiento;
    let largo = 0;
    for (const entrada of entradas) {
      const central = entradaCentral(entrada);
      largo += central.length;
      yield central;
    }
    yield finDelCentral(entradas, inicio, largo);
  }

  return Readable.from(bytes());
}
