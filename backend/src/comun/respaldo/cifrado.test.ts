/**
 * Pruebas del CIFRADO del respaldo (V1-E6a). Lo que se verifica es lo que hace que el respaldo
 * sirva el día que haga falta: que lo que se cifra se puede volver a leer BIT A BIT, y que cualquier
 * desviación (llave equivocada, archivo alterado, archivo truncado) se DETECTA en vez de entregar
 * basura que `pg_restore` intentaría cargar.
 */
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  BYTES_CABECERA,
  BYTES_ETIQUETA,
  cifrarArchivo,
  descifrarArchivo,
  ErrorRespaldoIlegible,
  MAGIA,
} from './cifrado.js';

const FRASE = 'frase-de-pruebas-suficientemente-larga-2026';

let carpeta: string;

beforeAll(async () => {
  carpeta = await mkdtemp(join(tmpdir(), 'prueba-cifrado-'));
});

afterAll(async () => {
  await rm(carpeta, { recursive: true, force: true });
});

/** Escribe un archivo de `bytes` aleatorios y devuelve su ruta y su huella SHA-256. */
async function archivoAleatorio(
  nombre: string,
  bytes: number,
): Promise<{ ruta: string; huella: string }> {
  const contenido = randomBytes(bytes);
  const ruta = join(carpeta, nombre);
  await writeFile(ruta, contenido);
  return { ruta, huella: createHash('sha256').update(contenido).digest('hex') };
}

async function huellaDe(ruta: string): Promise<string> {
  return createHash('sha256')
    .update(await readFile(ruta))
    .digest('hex');
}

describe('cifrado del respaldo', () => {
  it('ida y vuelta: lo descifrado es IDÉNTICO al original', async () => {
    const { ruta, huella } = await archivoAleatorio('original.bin', 300_000);
    const cifrado = join(carpeta, 'ida.enc');
    const vuelta = join(carpeta, 'vuelta.bin');

    const tamanoCifrado = await cifrarArchivo(ruta, cifrado, FRASE);
    const tamanoVuelta = await descifrarArchivo(cifrado, vuelta, FRASE);

    expect(await huellaDe(vuelta)).toBe(huella);
    expect(tamanoVuelta).toBe(300_000);
    // El cifrado pesa el original + cabecera + etiqueta (GCM no infla el texto cifrado).
    expect(tamanoCifrado).toBe(300_000 + BYTES_CABECERA + BYTES_ETIQUETA);
  });

  it('funciona con archivos que no son múltiplo del bloque ni del trozo de lectura', async () => {
    const { ruta, huella } = await archivoAleatorio('raro.bin', 65 * 1024 + 7);
    const cifrado = join(carpeta, 'raro.enc');
    const vuelta = join(carpeta, 'raro-vuelta.bin');
    await cifrarArchivo(ruta, cifrado, FRASE);
    await descifrarArchivo(cifrado, vuelta, FRASE);
    expect(await huellaDe(vuelta)).toBe(huella);
  });

  it('el archivo cifrado NO contiene el texto original (de verdad cifra)', async () => {
    const ruta = join(carpeta, 'secreto.txt');
    await writeFile(ruta, 'PRECIO CONFIDENCIAL DEL CLIENTE 12345');
    const cifrado = join(carpeta, 'secreto.enc');
    await cifrarArchivo(ruta, cifrado, FRASE);
    const bytes = await readFile(cifrado);
    expect(bytes.includes(Buffer.from('PRECIO CONFIDENCIAL'))).toBe(false);
    // Pero sí lleva la marca de agua del formato, al principio.
    expect(bytes.subarray(0, MAGIA.length).equals(MAGIA)).toBe(true);
  });

  it('dos cifrados de lo MISMO dan archivos distintos (sal e iv aleatorios por archivo)', async () => {
    const { ruta } = await archivoAleatorio('repetido.bin', 5_000);
    const uno = join(carpeta, 'rep1.enc');
    const otro = join(carpeta, 'rep2.enc');
    await cifrarArchivo(ruta, uno, FRASE);
    await cifrarArchivo(ruta, otro, FRASE);
    expect(await huellaDe(uno)).not.toBe(await huellaDe(otro));
  });

  it('con la llave EQUIVOCADA falla, y no deja un volcado a medias en el disco', async () => {
    const { ruta } = await archivoAleatorio('llave.bin', 50_000);
    const cifrado = join(carpeta, 'llave.enc');
    const vuelta = join(carpeta, 'llave-vuelta.bin');
    await cifrarArchivo(ruta, cifrado, FRASE);

    await expect(
      descifrarArchivo(cifrado, vuelta, 'otra-frase-completamente-distinta'),
    ).rejects.toThrow(ErrorRespaldoIlegible);
    await expect(stat(vuelta)).rejects.toThrow(); // el destino a medias se borró
  });

  it('detecta un archivo ALTERADO (un solo byte cambiado en medio)', async () => {
    const { ruta } = await archivoAleatorio('alterado.bin', 40_000);
    const cifrado = join(carpeta, 'alterado.enc');
    await cifrarArchivo(ruta, cifrado, FRASE);

    const bytes = await readFile(cifrado);
    const posicion = Math.floor(bytes.length / 2);
    bytes[posicion] = (bytes[posicion] ?? 0) ^ 0xff;
    await writeFile(cifrado, bytes);

    await expect(
      descifrarArchivo(cifrado, join(carpeta, 'alterado-vuelta.bin'), FRASE),
    ).rejects.toThrow(ErrorRespaldoIlegible);
  });

  it('detecta un archivo TRUNCADO (una subida cortada a la mitad)', async () => {
    const { ruta } = await archivoAleatorio('truncado.bin', 40_000);
    const cifrado = join(carpeta, 'truncado.enc');
    await cifrarArchivo(ruta, cifrado, FRASE);

    const bytes = await readFile(cifrado);
    await writeFile(cifrado, bytes.subarray(0, bytes.length - 5_000));

    await expect(
      descifrarArchivo(cifrado, join(carpeta, 'truncado-vuelta.bin'), FRASE),
    ).rejects.toThrow(ErrorRespaldoIlegible);
  });

  it('rechaza un archivo que no es un respaldo nuestro (sin marca de agua)', async () => {
    const impostor = join(carpeta, 'impostor.enc');
    await writeFile(impostor, randomBytes(1_000));
    await expect(
      descifrarArchivo(impostor, join(carpeta, 'impostor-vuelta.bin'), FRASE),
    ).rejects.toThrow(/no es un respaldo cifrado/i);
  });

  it('rechaza un archivo demasiado corto para tener siquiera cabecera y etiqueta', async () => {
    const corto = join(carpeta, 'corto.enc');
    await writeFile(corto, randomBytes(10));
    await expect(descifrarArchivo(corto, join(carpeta, 'corto-vuelta.bin'), FRASE)).rejects.toThrow(
      /demasiado corto/i,
    );
  });

  it('rechaza un formato de versión desconocida (respaldo de un futuro sistema)', async () => {
    const { ruta } = await archivoAleatorio('futuro.bin', 1_000);
    const cifrado = join(carpeta, 'futuro.enc');
    await cifrarArchivo(ruta, cifrado, FRASE);
    const bytes = await readFile(cifrado);
    bytes[MAGIA.length] = 99;
    await writeFile(cifrado, bytes);
    await expect(
      descifrarArchivo(cifrado, join(carpeta, 'futuro-vuelta.bin'), FRASE),
    ).rejects.toThrow(/formato versión 99/i);
  });
});
