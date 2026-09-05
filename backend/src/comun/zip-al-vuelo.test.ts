/**
 * ⭐ 0.140 (2ª ronda) — LAS PRUEBAS DEL ZIP ESCRITO A MANO.
 *
 * 🔴 **Aquí no se comprueba la teoría del formato: se comprueba que los bytes que salen se pueden
 * volver a abrir.** Un empaquetador escrito a mano falla en silencio —el archivo se genera, pesa lo
 * que debe y sólo revienta en la máquina del usuario cuando le da doble clic—, así que estas
 * pruebas **descomprimen de verdad** lo que produce {@link empaquetarZipAlVuelo} y comparan el
 * contenido byte a byte con lo que entró. Si el CRC, un desplazamiento o el directorio central
 * salen mal, esto se pone rojo aquí y no en la mesa de corte.
 *
 * El lector de ZIP de estas pruebas es propio y mínimo (lee el directorio central, que es como lo
 * lee cualquier descompresor de verdad): traer una librería sólo para el test volvería a dejar sin
 * vigilar justo lo que hay que vigilar.
 */
import { describe, expect, it } from 'vitest';
import { crc32 } from 'node:zlib';

import { empaquetarZipAlVuelo, type ArchivoZip } from './zip-al-vuelo.js';

/** Junta el flujo en un Buffer (los ZIP de estas pruebas son de juguete). */
async function juntar(flujo: NodeJS.ReadableStream): Promise<Buffer> {
  const trozos: Buffer[] = [];
  for await (const trozo of flujo) {
    trozos.push(Buffer.from(trozo as Buffer));
  }
  return Buffer.concat(trozos);
}

/**
 * Descompresor mínimo: encuentra el fin del directorio central, lo recorre y saca cada archivo
 * SALTANDO por su desplazamiento (que es justo lo que un lector real hace, y lo que se rompe si el
 * empaquetador lleva mal la cuenta de los bytes).
 */
function abrirZip(zip: Buffer): { nombre: string; contenido: Buffer; crcOk: boolean }[] {
  const finFirma = 0x06054b50;
  let fin = zip.length - 22;
  while (fin >= 0 && zip.readUInt32LE(fin) !== finFirma) {
    fin -= 1;
  }
  if (fin < 0) {
    throw new Error('ZIP sin fin de directorio central');
  }
  const cuantos = zip.readUInt16LE(fin + 10);
  let puntero = zip.readUInt32LE(fin + 16);

  const salida: { nombre: string; contenido: Buffer; crcOk: boolean }[] = [];
  for (let i = 0; i < cuantos; i += 1) {
    if (zip.readUInt32LE(puntero) !== 0x02014b50) {
      throw new Error(`Entrada ${String(i)} del directorio central con firma mala`);
    }
    const crcDeclarado = zip.readUInt32LE(puntero + 16);
    const tamano = zip.readUInt32LE(puntero + 24);
    const largoNombre = zip.readUInt16LE(puntero + 28);
    const largoExtra = zip.readUInt16LE(puntero + 30);
    const largoComentario = zip.readUInt16LE(puntero + 32);
    const desplazamiento = zip.readUInt32LE(puntero + 42);
    const nombre = zip.subarray(puntero + 46, puntero + 46 + largoNombre).toString('utf8');

    // Y ahora por la cabecera LOCAL, saltando a su desplazamiento: si la cuenta de bytes del
    // empaquetador estuviera mal, aquí no habría una firma local válida.
    if (zip.readUInt32LE(desplazamiento) !== 0x04034b50) {
      throw new Error(`"${nombre}": el desplazamiento no apunta a una cabecera local`);
    }
    const nombreLocal = zip.readUInt16LE(desplazamiento + 26);
    const extraLocal = zip.readUInt16LE(desplazamiento + 28);
    const inicio = desplazamiento + 30 + nombreLocal + extraLocal;
    const contenido = zip.subarray(inicio, inicio + tamano);

    salida.push({ nombre, contenido, crcOk: crc32(contenido) >>> 0 === crcDeclarado });
    puntero += 46 + largoNombre + largoExtra + largoComentario;
  }
  return salida;
}

/** Convierte una lista en el iterable asíncrono que el empaquetador consume. */
async function* comoFlujo(archivos: ArchivoZip[]): AsyncGenerator<ArchivoZip, void, undefined> {
  for (const archivo of archivos) {
    // El productor real espera a que se renderice cada PDF; esperar aquí deja al empaquetador en
    // las mismas condiciones (tiene que volver a pedir, no puede tirar de todos de golpe).
    await Promise.resolve();
    yield archivo;
  }
}

describe('empaquetarZipAlVuelo (0.140)', () => {
  it('🔴 lo que sale se puede ABRIR, y trae exactamente lo que entró', async () => {
    const archivos: ArchivoZip[] = [
      { nombre: 'ordenes-parte-01.pdf', contenido: Buffer.from('%PDF-1.7 primera parte\n%%EOF') },
      { nombre: 'ordenes-parte-02.pdf', contenido: Buffer.from('%PDF-1.7 segunda parte\n%%EOF') },
      { nombre: 'ordenes-parte-03.pdf', contenido: Buffer.alloc(70_000, 0x41) },
    ];

    const abierto = abrirZip(await juntar(empaquetarZipAlVuelo(comoFlujo(archivos))));

    expect(abierto.map((a) => a.nombre)).toEqual(archivos.map((a) => a.nombre));
    for (const [i, entrada] of abierto.entries()) {
      expect(entrada.crcOk, `${entrada.nombre}: CRC malo`).toBe(true);
      expect(entrada.contenido.equals(archivos[i]!.contenido), `${entrada.nombre}: bytes`).toBe(
        true,
      );
    }
  });

  it('🔑 PIDE LOS ARCHIVOS DE UNO EN UNO: el empaquetador no acumula', async () => {
    // Es la razón de ser de este archivo. Si el empaquetador juntara los PDF antes de escribir, el
    // pico volvería a crecer con el número de órdenes — el criterio que la fila no puede incumplir.
    // ⚠️ Esto mide lo que retiene EL EMPAQUETADOR (uno). El techo de la cadena entera es ≈3, porque
    // `Readable.from` pide por delante y la ruta guarda la primera parte: ver su docstring.
    let vivos = 0;
    let maxVivos = 0;
    async function* uno(): AsyncGenerator<ArchivoZip, void, undefined> {
      for (let i = 1; i <= 5; i += 1) {
        await Promise.resolve(); // como el productor real, que espera a cada PDF
        vivos += 1;
        maxVivos = Math.max(maxVivos, vivos);
        yield { nombre: `p${String(i)}.pdf`, contenido: Buffer.alloc(1000, i) };
        // Cuando el empaquetador vuelve a pedir, el anterior ya se escribió y se soltó.
        vivos -= 1;
      }
    }

    const zip = await juntar(empaquetarZipAlVuelo(uno()));
    expect(maxVivos).toBe(1);
    expect(abrirZip(zip)).toHaveLength(5);
  });

  it('un solo archivo también produce un ZIP válido', async () => {
    const solo: ArchivoZip = { nombre: 'ordenes.pdf', contenido: Buffer.from('%PDF-uno') };
    const abierto = abrirZip(await juntar(empaquetarZipAlVuelo(comoFlujo([solo]))));
    expect(abierto).toHaveLength(1);
    expect(abierto[0]?.contenido.toString()).toBe('%PDF-uno');
  });

  it('🔑 si el productor falla, el flujo falla — nunca sale un ZIP truncado que parezca bueno', async () => {
    async function* revienta(): AsyncGenerator<ArchivoZip, void, undefined> {
      await Promise.resolve();
      yield { nombre: 'p1.pdf', contenido: Buffer.from('%PDF-1') };
      throw new Error('se cayó la orden 2');
    }
    await expect(juntar(empaquetarZipAlVuelo(revienta()))).rejects.toThrow('se cayó la orden 2');
  });

  it('los nombres con acentos sobreviven (se guardan en UTF-8)', async () => {
    const archivo: ArchivoZip = { nombre: 'órdenes-ñ.pdf', contenido: Buffer.from('x') };
    const abierto = abrirZip(await juntar(empaquetarZipAlVuelo(comoFlujo([archivo]))));
    expect(abierto[0]?.nombre).toBe('órdenes-ñ.pdf');
  });
});
