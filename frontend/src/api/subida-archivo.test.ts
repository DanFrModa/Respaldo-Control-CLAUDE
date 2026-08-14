import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Qué pasa cuando el `PUT` a R2 falla, en TODOS los módulos que suben archivos.
 *
 * Dos defectos que se vieron en `prueba` (Daniel, subiendo la foto de un modelo con su internet
 * perfecto) y que estas pruebas fijan:
 *  1. el mensaje decía "Verifica tu conexión" cuando la causa real casi siempre es la
 *     configuración del almacenamiento (R2 rechaza y el navegador lo disfraza de falla de red);
 *  2. cada intento fallido dejaba el registro que el backend ya había creado → fotos/adjuntos
 *     fantasma que se acumulan al reintentar.
 * Y una garantía extra: si la limpieza TAMBIÉN falla, el usuario sigue viendo el error de la
 * subida (el de verdad), nunca uno del borrado.
 */

/** Respuesta cruda de `openapi-fetch` (solo lo que usa la capa de datos). */
type RespuestaApi = { data?: unknown; error?: unknown; response?: { ok: boolean } };

const post = vi.fn<(ruta: string, opciones: unknown) => Promise<RespuestaApi>>();
const del = vi.fn<(ruta: string, opciones: unknown) => Promise<RespuestaApi>>();

vi.mock('./cliente', () => ({
  api: {
    POST: (ruta: string, opciones: unknown): Promise<RespuestaApi> => post(ruta, opciones),
    DELETE: (ruta: string, opciones: unknown): Promise<RespuestaApi> => del(ruta, opciones),
    GET: vi.fn(),
    PATCH: vi.fn(),
    PUT: vi.fn(),
  },
}));

const { useSubirFotoModelo } = await import('./modelos');
const { useSubirFotoBordado } = await import('./bordados');
const { useSubirAdjuntoEntradaTela } = await import('./entradas-tela');
const { useSubirAdjuntoDesarrollo } = await import('./adjuntos-desarrollo');

const ARCHIVO = new File(['x'], 'foto.png', { type: 'image/png' });

/** Un módulo que sube archivos: cómo se dispara y qué debe limpiar si el PUT falla. */
interface Caso {
  nombre: string;
  /** Monta el hook y devuelve la función que dispara la subida. */
  useSubida: () => (archivo: File) => Promise<void>;
  /** Lo que responde el `POST` de metadatos (paso 1). */
  datosPost: Record<string, unknown>;
  /** Ruta del `DELETE` con el que se limpia el registro recién creado. */
  rutaLimpieza: string;
  /** Parámetros de ruta con los que debe llamarse esa limpieza. */
  paramsLimpieza: Record<string, unknown>;
  /** Cómo nombra el mensaje al archivo. */
  sustantivo: string;
}

const URL_SUBIDA = 'https://r2.fake/put';

const CASOS: Caso[] = [
  {
    nombre: 'foto de modelo',
    useSubida: () => {
      const mutacion = useSubirFotoModelo();
      return (archivo: File) => mutacion.mutateAsync({ idModelo: 5, archivo });
    },
    datosPost: {
      idFoto: 7,
      idArchivo: 'arch_1',
      nombreOriginal: 'foto.png',
      urlSubida: URL_SUBIDA,
      expiraEnSegundos: 900,
    },
    rutaLimpieza: '/api/modelos/{id}/fotos/{idFoto}',
    paramsLimpieza: { id: 5, idFoto: 7 },
    sustantivo: 'la imagen',
  },
  {
    nombre: 'imagen de bordado',
    useSubida: () => {
      const mutacion = useSubirFotoBordado();
      return (archivo: File) => mutacion.mutateAsync({ idBordado: 9, archivo });
    },
    datosPost: {
      idArchivo: 'arch_2',
      nombreOriginal: 'foto.png',
      urlSubida: URL_SUBIDA,
      expiraEnSegundos: 900,
    },
    rutaLimpieza: '/api/bordados/{id}/foto',
    paramsLimpieza: { id: 9 },
    sustantivo: 'la imagen',
  },
  {
    nombre: 'PDF de la entrada de tela',
    useSubida: () => {
      const mutacion = useSubirAdjuntoEntradaTela();
      return (archivo: File) => mutacion.mutateAsync({ id: 12, archivo });
    },
    datosPost: {
      idArchivo: 'arch_3',
      nombreOriginal: 'factura.pdf',
      urlSubida: URL_SUBIDA,
      expiraEnSegundos: 900,
    },
    rutaLimpieza: '/api/inventarios/telas/entradas/{id}/adjuntos/{idArchivo}',
    paramsLimpieza: { id: 12, idArchivo: 'arch_3' },
    sustantivo: 'el archivo',
  },
  {
    nombre: 'adjunto de desarrollo',
    useSubida: () => {
      const mutacion = useSubirAdjuntoDesarrollo();
      return (archivo: File) => mutacion.mutateAsync({ idDesarrollo: 21, archivo });
    },
    datosPost: {
      idArchivo: 'arch_4',
      nombreOriginal: 'techpack.pdf',
      urlSubida: URL_SUBIDA,
      expiraEnSegundos: 900,
    },
    rutaLimpieza: '/api/desarrollos/{idDesarrollo}/adjuntos/{idArchivo}',
    paramsLimpieza: { idDesarrollo: 21, idArchivo: 'arch_4' },
    sustantivo: 'el archivo',
  },
];

/** Monta el hook del caso con su proveedor y dispara la subida (propagando el error). */
async function subir(caso: Caso): Promise<void> {
  const cliente = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const { result } = renderHook(() => caso.useSubida(), {
    wrapper: ({ children }) => createElement(QueryClientProvider, { client: cliente }, children),
  });
  await result.current(ARCHIVO);
}

/** Dispara la subida esperando que falle y devuelve el error que vería el usuario. */
async function errorDeSubida(caso: Caso): Promise<Error> {
  try {
    await subir(caso);
  } catch (fallo) {
    return fallo as Error;
  }
  throw new Error('se esperaba que la subida fallara y no falló');
}

/** El `DELETE` de limpieza, tal como lo recibió el cliente del API. */
function llamadasDeBorrado(): { ruta: string; params: unknown }[] {
  return del.mock.calls.map(([ruta, opciones]) => ({
    ruta,
    params: (opciones as { params?: { path?: unknown } }).params?.path,
  }));
}

describe.each(CASOS)('subida a R2 — $nombre', (caso) => {
  beforeEach(() => {
    post.mockReset();
    del.mockReset();
    post.mockResolvedValue({ data: caso.datosPost, error: undefined });
    del.mockResolvedValue({ response: { ok: true }, error: undefined });
  });

  it('el PUT que falla como "red" NO culpa a la conexión del usuario', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('Failed to fetch'))),
    );

    const fallo = await errorDeSubida(caso);

    expect(fallo.message).toContain(`No se pudo guardar ${caso.sustantivo}.`);
    expect(fallo.message).toContain('configuración del almacenamiento');
    expect(fallo.message).toContain('avisa a soporte');
    // El mensaje viejo mandaba a revisar el internet: justo lo que NO hay que decir aquí.
    expect(fallo.message).not.toContain('Verifica tu conexión');
    // Tampoco jerga técnica: Daniel no debe leer "CORS" ni "R2".
    expect(fallo.message).not.toMatch(/CORS|R2/);
  });

  it('el PUT que falla limpia el registro que el paso 1 ya había creado', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('Failed to fetch'))),
    );

    await errorDeSubida(caso);

    expect(llamadasDeBorrado()).toEqual([{ ruta: caso.rutaLimpieza, params: caso.paramsLimpieza }]);
  });

  it('si R2 contesta un rechazo, lo dice con su código y también limpia', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: false, status: 403 } as Response)),
    );

    const fallo = await errorDeSubida(caso);

    expect(fallo.message).toContain(`El almacenamiento rechazó ${caso.sustantivo} (error 403)`);
    expect(llamadasDeBorrado()).toEqual([{ ruta: caso.rutaLimpieza, params: caso.paramsLimpieza }]);
  });

  it('si la limpieza TAMBIÉN falla, el usuario sigue viendo el error de la subida', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('Failed to fetch'))),
    );
    del.mockResolvedValue({
      response: { ok: false },
      error: { codigo: 'PERMISO', mensaje: 'No tienes permiso para borrar' },
    });

    const fallo = await errorDeSubida(caso);

    expect(fallo.message).toContain(`No se pudo guardar ${caso.sustantivo}.`);
    expect(fallo.message).not.toContain('No tienes permiso para borrar');
    expect(del).toHaveBeenCalledTimes(1);
  });

  it('cuando el PUT sale bien no borra nada', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: true, status: 200 } as Response)),
    );

    await subir(caso);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(del).not.toHaveBeenCalled();
  });
});
