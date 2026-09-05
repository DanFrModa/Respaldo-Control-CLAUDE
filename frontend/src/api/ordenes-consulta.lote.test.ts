/**
 * ⭐⭐ 0.140 (4ª ronda) — **LA MITAD FRONTEND DE LA COSTURA PDF-vs-ZIP.**
 *
 * ## El hueco que esto viene a tapar
 *
 * El impreso por lote dejó de ser siempre un PDF: cuando el lote no cabe en un archivo, el servidor
 * responde un **ZIP con varios PDF**. Quién de los dos vino lo dice el `Content-Type`, y de ahí sale
 * **la extensión del archivo que se baja el usuario**. La rama del servidor ya tiene sus pruebas
 * (`backend/src/api/produccion/impresos.rutas.test.ts`); **esta línea no tenía ninguna**, y se midió:
 * forzando `esZip = false` —o sea, ponerle `.pdf` a un ZIP, un archivo que no abre— la suite entera
 * del frontend seguía verde (216 archivos, 2 285 pruebas, salida 0).
 *
 * Lo otro que se fija aquí es el **mensaje accionable**. El ZIP viaja en flujo, así que un fallo a
 * media descarga llega DESPUÉS de la cabecera 200: `respuesta.ok` ya dijo que sí y lo que se corta
 * es el cuerpo. Sin el `catch` del `.blob()`, el usuario se queda con un archivo truncado y un
 * «no se pudo generar» que no le dice qué hacer.
 *
 * Se prueba el helper REAL (sin mock): lo que se sustituye es el navegador —`fetch`, el objectURL y
 * el clic del enlace—, porque es lo único que jsdom no trae.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

import { ErrorDeApi } from './errores';
import { imprimirLoteOrdenes } from './ordenes-consulta';

/** Los enlaces de descarga que la función llegó a pulsar, con su `download` ya puesto. */
const descargas: { nombre: string; href: string }[] = [];

/** Una respuesta del servidor con el `Content-Type` que se quiera y el cuerpo que se le pase. */
function respuestaCon(contentType: string, cuerpo: () => Promise<Blob>): Response {
  return {
    ok: true,
    headers: { get: (cabecera: string) => (cabecera === 'content-type' ? contentType : null) },
    blob: cuerpo,
  } as unknown as Response;
}

function conFetch(respuesta: Response | Promise<Response>): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(respuesta)),
  );
}

beforeEach(() => {
  descargas.length = 0;
  // jsdom no implementa el objectURL (ni descarga archivos de verdad): se sustituyen los dos.
  URL.createObjectURL = vi.fn(() => 'blob:prueba');
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    descargas.push({ nombre: this.download, href: this.href });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('imprimirLoteOrdenes — qué archivo acaba en la máquina del usuario (0.140)', () => {
  it('🔴 un ZIP se baja con extensión .zip', async () => {
    // Ésta es la mutación que sobrevivía: con `esZip = false` el ZIP se guarda como `.pdf` y no abre.
    conFetch(respuestaCon('application/zip', () => Promise.resolve(new Blob([new Uint8Array(4)]))));

    await imprimirLoteOrdenes([1, 2, 3]);

    expect(descargas).toHaveLength(1);
    expect(descargas[0]?.nombre).toBe('ordenes-3.zip');
  });

  it('🔴 un PDF se baja con extensión .pdf', async () => {
    conFetch(respuestaCon('application/pdf', () => Promise.resolve(new Blob([new Uint8Array(4)]))));

    await imprimirLoteOrdenes([7, 8]);

    expect(descargas).toHaveLength(1);
    expect(descargas[0]?.nombre).toBe('ordenes-2.pdf');
  });

  it('la extensión sale del `Content-Type` REAL, no de lo que se esperaba', async () => {
    // Mismo lote, misma llamada: lo único que cambia es lo que contestó el servidor.
    conFetch(respuestaCon('application/zip; charset=binary', () => Promise.resolve(new Blob())));
    await imprimirLoteOrdenes([1]);
    expect(descargas[0]?.nombre).toBe('ordenes-1.zip');
  });

  it('🔴 si la descarga se CORTA a media respuesta, el aviso dice qué hacer', async () => {
    // El 200 ya se recibió (el ZIP va en flujo): lo que falla es el cuerpo. El mensaje tiene que
    // llevar al usuario a la salida real —imprimir menos órdenes—, no dejarlo con un genérico.
    conFetch(respuestaCon('application/zip', () => Promise.reject(new TypeError('network error'))));

    const error = await imprimirLoteOrdenes([1, 2, 3, 4, 5]).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('5 órdenes');
    expect((error as Error).message).toContain('dos tandas');
    expect(descargas).toHaveLength(0); // y NO se le entrega un archivo truncado
  });

  it('un error del SERVIDOR sigue llegando como `ErrorDeApi` (el catch nuevo no lo tapa)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 403,
          headers: { get: () => null },
          json: () =>
            Promise.resolve({
              codigo: 'PROHIBIDO',
              mensaje: 'No tienes permiso para imprimir órdenes',
            }),
        } as unknown as Response),
      ),
    );

    const error = await imprimirLoteOrdenes([1]).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ErrorDeApi);
    expect((error as ErrorDeApi).message).toContain('permiso');
  });
});
