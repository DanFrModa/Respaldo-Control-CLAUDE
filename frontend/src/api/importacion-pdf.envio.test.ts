import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * EL IMPORTADOR NO PUEDE MORIR CON «Failed to fetch».
 *
 * Este importador manda VARIOS PDFs en base64 dentro del JSON, así que es la pantalla del
 * sistema con más probabilidad de que un intermediario (nginx, el proxy de Railway) corte el
 * cuerpo por tamaño. Y cuando eso pasa, la conexión se cierra **sin** un 413 legible: no hay
 * cuerpo `{ codigo, mensaje }`, no hay cabeceras CORS, no hay nada. `fetch` rechaza con un
 * `TypeError` y —si nadie lo traduce— el usuario ve el texto crudo del navegador.
 *
 * Eso fue lo que reportó Daniel: *«Failed to fetch»* al importar varios PDFs de golpe. El
 * límite ya se subió en `nginx.conf.template` (y `limite-cuerpo-api.test.ts` lo amarra al del
 * backend), pero **el mensaje ilegible es un defecto aparte**: un corte por tamaño en otra
 * capa, un túnel caído o un internet malo producen el mismo síntoma, y la pantalla tiene que
 * decir algo que se pueda seguir. Arreglar sólo el límite dejaría el modo de fallo intacto
 * para la próxima vez.
 *
 * Las dos mitades que se comprueban aquí:
 *  1. un fallo de RED sale como mensaje accionable, no como el texto del navegador;
 *  2. un error CON respuesta del servidor pasa **intacto** — el backend siempre gana (A1), y
 *     taparlo con un mensaje genérico sería cambiar un defecto por otro peor: esconder la
 *     razón verdadera («ese PDF no es una OC de C&A») detrás de un «revisa tu conexión».
 */

/** Respuesta cruda de `openapi-fetch` (sólo lo que usa la capa de datos). */
type RespuestaApi = { data?: unknown; error?: unknown };

const post = vi.fn<(ruta: string, opciones: unknown) => Promise<RespuestaApi>>();

vi.mock('./cliente', () => ({
  api: {
    POST: (ruta: string, opciones: unknown): Promise<RespuestaApi> => post(ruta, opciones),
    GET: vi.fn(),
    PATCH: vi.fn(),
    DELETE: vi.fn(),
  },
}));

const { useAnalizarPdf, useConfirmarPdf } = await import('./importacion-pdf');

/**
 * El error con el que rechazó una llamada. Si NO rechaza, **truena**: una prueba que
 * espera un fallo y no lo obtiene tiene que ponerse roja, no pasar en vacío. (Esa es la
 * forma en que un `.catch()` suelto se vuelve un candado decorativo.)
 */
async function errorDe(promesa: Promise<unknown>): Promise<Error & { codigo?: string }> {
  try {
    await promesa;
  } catch (error) {
    return error as Error & { codigo?: string };
  }
  throw new Error('La llamada NO rechazó — y esta prueba existe justo para el caso en que falla.');
}

/** Monta un hook de mutación con su proveedor y devuelve su `mutateAsync`. */
function montar<V>(usarHook: () => { mutateAsync: (v: V) => Promise<unknown> }) {
  const cliente = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const { result } = renderHook(usarHook, {
    wrapper: ({ children }) => createElement(QueryClientProvider, { client: cliente }, children),
  });
  return (variables: V) => result.current.mutateAsync(variables);
}

const CUERPO_ANALIZAR = {
  idCliente: 1,
  archivos: [{ nombreArchivo: 'oc.pdf', archivoBase64: 'JVBERi0=' }],
};

beforeEach(() => {
  post.mockReset();
});

describe('el importador de PDFs cuando el envío no llega a tener respuesta', () => {
  it('traduce el fallo de RED a un mensaje que se puede seguir (analizar)', async () => {
    // Exactamente lo que hace el navegador cuando el intermediario cierra la conexión a
    // media subida: `fetch` rechaza, no devuelve `{ error }`.
    post.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const analizar = montar(useAnalizarPdf);
    const error = await errorDe(analizar(CUERPO_ANALIZAR));
    expect(error.codigo).toBe('ENVIO_FALLIDO');
    // Lo que NO puede pasar: que el texto del navegador llegue al usuario.
    expect(error.message).not.toContain('Failed to fetch');
    // Y lo que SÍ tiene que traer: la salida que de verdad funciona.
    expect(error.message).toContain('menos');
  });

  it('traduce el fallo de RED también al confirmar', async () => {
    // Confirmar manda el MISMO cuerpo pesado que analizar; si sólo se hubiera arreglado el
    // primer paso, el usuario cruzaría toda la vista previa para estrellarse al final —el
    // peor momento posible, porque ahí ya invirtió el trabajo de ligar los modelos.
    post.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const confirmar = montar(useConfirmarPdf);
    const error = await errorDe(confirmar({ idCliente: 1, archivos: [] }));
    expect(error.message).not.toContain('Failed to fetch');
    expect(error.codigo).toBe('ENVIO_FALLIDO');
  });

  it('NO pisa el error del servidor cuando sí hubo respuesta', async () => {
    // El backend explica lo que la pantalla no sabe («ese PDF no es una OC de C&A»). Si el
    // arreglo tapara también estos casos, cambiaríamos un mensaje ilegible por uno que
    // MIENTE, que es peor: mandaría a revisar la conexión con la conexión perfecta.
    post.mockResolvedValueOnce({
      error: { codigo: 'PDF_NO_RECONOCIDO', mensaje: 'El PDF no parece una OC de C&A.' },
    });

    const analizar = montar(useAnalizarPdf);
    const error = await errorDe(analizar(CUERPO_ANALIZAR));
    expect(error.message).toBe('El PDF no parece una OC de C&A.');
    expect(error.codigo).toBe('PDF_NO_RECONOCIDO');
  });
});
