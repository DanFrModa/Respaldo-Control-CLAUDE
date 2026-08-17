import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

/**
 * Qué pasa cuando el `PUT` a R2 falla, en TODOS los módulos que suben archivos.
 *
 * Dos defectos que se vieron en `prueba` (Daniel, subiendo la foto de un modelo con su internet
 * perfecto) y que estas pruebas fijan:
 *  1. el mensaje decía "Verifica tu conexión" cuando la causa real casi siempre es la
 *     configuración del almacenamiento (R2 rechaza y el navegador lo disfraza de falla de red);
 *  2. cada intento fallido dejaba el registro que el backend ya había creado → fotos/adjuntos
 *     fantasma que se acumulan al reintentar.
 * Y un tercero que salió al revisar ese arreglo: la limpieza del ARTE borraba "la foto que haya"
 * (su `DELETE` era el único sin id de archivo), así que podía llevarse la imagen buena que otro
 * usuario acababa de subir al mismo arte. El bloque final de este archivo fija esa regresión —
 * que desde V1-E3f ya no es siquiera expresable: con las fotos del arte en PLURAL
 * (§Post-F9.52 punto 5) el `DELETE` lleva el `idFoto` que devolvió SU propio POST, igual que las
 * fotos del modelo.
 *
 * Dos garantías extra: si la limpieza TAMBIÉN falla, el usuario sigue viendo el error de la subida
 * (el de verdad), nunca uno del borrado — pero el fallo del borrado deja rastro en la consola.
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
const { useSubirFotoArte } = await import('./artes');
const { useSubirAdjuntoEntradaTela } = await import('./entradas-tela');
const { useSubirAdjuntoDesarrollo } = await import('./adjuntos-desarrollo');
const { useSubirAdjuntoProveedor } = await import('./proveedores');
const { useSubirAdjuntoOrden } = await import('./adjuntos-orden');
const { useSubirAdjuntoPedido } = await import('./adjuntos-pedido');

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
  /**
   * Querystring con el que debe llamarse la limpieza. Hoy NINGÚN caso la usa: todos identifican el
   * registro por la RUTA. Se conserva el gancho porque la aserción "la consulta va vacía" es
   * justamente la que impide volver a un borrado "de lo que haya".
   */
  queryLimpieza?: Record<string, unknown>;
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
    nombre: 'imagen del arte del modelo',
    useSubida: () => {
      const mutacion = useSubirFotoArte();
      return (archivo: File) => mutacion.mutateAsync({ idModelo: 3, idArte: 9, archivo });
    },
    datosPost: {
      idFoto: 21,
      idArchivo: 'arch_2',
      nombreOriginal: 'foto.png',
      urlSubida: URL_SUBIDA,
      expiraEnSegundos: 900,
    },
    // V1-E3f: las fotos del arte son PLURALES, así que el renglón se identifica por la RUTA — el
    // `idFoto` de ESTE intento. Ya no hace falta acotar por querystring.
    rutaLimpieza: '/api/modelos/{id}/artes/{idArte}/fotos/{idFoto}',
    paramsLimpieza: { id: 3, idArte: 9, idFoto: 21 },
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
  {
    nombre: 'adjunto de proveedor',
    useSubida: () => {
      const mutacion = useSubirAdjuntoProveedor();
      return (archivo: File) =>
        mutacion.mutateAsync({ idProveedor: 33, archivo, tipo: 'CONSTANCIA' });
    },
    datosPost: {
      idArchivo: 'arch_5',
      nombreOriginal: 'constancia.pdf',
      urlSubida: URL_SUBIDA,
      expiraEnSegundos: 900,
    },
    rutaLimpieza: '/api/proveedores/{id}/adjuntos/{idArchivo}',
    paramsLimpieza: { id: 33, idArchivo: 'arch_5' },
    sustantivo: 'el archivo',
  },
  {
    nombre: 'adjunto de orden',
    useSubida: () => {
      const mutacion = useSubirAdjuntoOrden();
      return (archivo: File) => mutacion.mutateAsync({ idOrden: 44, archivo });
    },
    datosPost: {
      idArchivo: 'arch_6',
      nombreOriginal: 'oc.pdf',
      urlSubida: URL_SUBIDA,
      expiraEnSegundos: 900,
    },
    rutaLimpieza: '/api/ordenes/{idOrden}/adjuntos/{idArchivo}',
    paramsLimpieza: { idOrden: 44, idArchivo: 'arch_6' },
    sustantivo: 'el archivo',
  },
  {
    nombre: 'adjunto de pedido',
    useSubida: () => {
      const mutacion = useSubirAdjuntoPedido();
      return (archivo: File) => mutacion.mutateAsync({ idPedido: 55, archivo });
    },
    datosPost: {
      idArchivo: 'arch_7',
      nombreOriginal: 'oc-cliente.pdf',
      urlSubida: URL_SUBIDA,
      expiraEnSegundos: 900,
    },
    rutaLimpieza: '/api/pedidos/{idPedido}/adjuntos/{idArchivo}',
    paramsLimpieza: { idPedido: 55, idArchivo: 'arch_7' },
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

/** El `DELETE` de limpieza (ruta + params de ruta + querystring), tal como lo recibió el cliente. */
function llamadasDeBorrado(): { ruta: string; params: unknown; query: unknown }[] {
  return del.mock.calls.map(([ruta, opciones]) => {
    const params = (opciones as { params?: { path?: unknown; query?: unknown } }).params;
    return { ruta, params: params?.path, query: params?.query ?? {} };
  });
}

/** Cómo debe verse la ÚNICA llamada de limpieza de un caso. */
function borradoEsperado(caso: Caso): { ruta: string; params: unknown; query: unknown }[] {
  return [
    { ruta: caso.rutaLimpieza, params: caso.paramsLimpieza, query: caso.queryLimpieza ?? {} },
  ];
}

/**
 * Espía de `console.warn` (la pista que la limpieza best-effort deja para soporte).
 *
 * Va tipado a mano: `ReturnType<typeof vi.spyOn>` deja los genéricos sin resolver y colapsa a
 * `any`, así que leer `avisos.mock.calls` era acceso a un `any` (error de lint) y, peor, cualquier
 * aserción sobre el mensaje pasaba el typecheck aunque la forma del espía cambiara.
 */
let avisos: MockInstance<(...datos: unknown[]) => void>;

// El espía de consola se restaura entre pruebas: si no, sus llamadas se van acumulando y los
// conteos de una prueba arrastran los de las anteriores.
afterEach(() => {
  vi.restoreAllMocks();
});

describe.each(CASOS)('subida a R2 — $nombre', (caso) => {
  beforeEach(() => {
    post.mockReset();
    del.mockReset();
    post.mockResolvedValue({ data: caso.datosPost, error: undefined });
    del.mockResolvedValue({ response: { ok: true }, error: undefined });
    avisos = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
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

    expect(llamadasDeBorrado()).toEqual(borradoEsperado(caso));
  });

  it('si R2 contesta un rechazo, lo dice con su código y también limpia', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: false, status: 403 } as Response)),
    );

    const fallo = await errorDeSubida(caso);

    expect(fallo.message).toContain(`El almacenamiento rechazó ${caso.sustantivo} (error 403)`);
    expect(llamadasDeBorrado()).toEqual(borradoEsperado(caso));
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
    // ...pero el fallo del borrado NO se traga en silencio: queda el rastro en consola con el que
    // soporte se entera de que, además, quedó un registro fantasma.
    expect(avisos).toHaveBeenCalledTimes(1);
    expect(String(avisos.mock.calls[0]?.[0])).toContain('No se pudo limpiar el registro');
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

/**
 * REGRESIÓN del arte: la limpieza NO puede borrar "la foto que haya".
 *
 * Cuando el arte tenía UNA sola foto, su `DELETE` era el único sin id del registro en la ruta, y
 * mientras la limpieza mandaba el borrado a secas este escenario destruía datos EN SILENCIO:
 * Daniel sube una versión nueva del arte y su `PUT` a R2 tarda en fallar; en esos segundos la
 * asistente reemplaza la imagen del mismo arte y a ella SÍ le sale; cuando falla el `PUT` de
 * Daniel, su limpieza se lleva la imagen buena de la asistente.
 *
 * V1-E3f cerró el hueco por construcción (§Post-F9.52 punto 5): con las fotos en PLURAL, el POST
 * devuelve el `idFoto` de SU renglón y el DELETE va a ESA ruta — no existe la forma de pedir "la
 * que haya". Estas pruebas se conservan para que un futuro rediseño no reintroduzca el borrado a
 * ciegas.
 */
describe('subida a R2 — el arte no pierde la foto de otro usuario', () => {
  const CASO_ARTE = CASOS.find((c) => c.nombre === 'imagen del arte del modelo') as Caso;

  beforeEach(() => {
    post.mockReset();
    del.mockReset();
    post.mockResolvedValue({ data: CASO_ARTE.datosPost, error: undefined });
    avisos = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('Failed to fetch'))),
    );
  });

  it('la limpieza apunta al renglón de SU intento (nunca a "la foto que haya")', async () => {
    del.mockResolvedValue({ response: { ok: true }, error: undefined });

    await errorDeSubida(CASO_ARTE);

    const [borrado] = llamadasDeBorrado();
    expect(borrado?.ruta).toBe('/api/modelos/{id}/artes/{idArte}/fotos/{idFoto}');
    // El `idFoto` del POST de ESTE intento: la foto de otro usuario es INALCANZABLE desde aquí.
    expect(borrado?.params).toEqual({ id: 3, idArte: 9, idFoto: 21 });
    // Y sin querystring que pueda significar "la vigente, sea de quien sea".
    expect(borrado?.query).toEqual({});
  });

  it('si el borrado de limpieza falla, el usuario solo ve SU error de subida', async () => {
    // Lo que contesta el backend si ese renglón ya no está (p. ej. otro usuario lo quitó).
    del.mockResolvedValue({
      response: { ok: false },
      error: {
        codigo: 'NO_ENCONTRADO',
        mensaje: 'Foto del arte no encontrada',
      },
    });

    const fallo = await errorDeSubida(CASO_ARTE);

    // El usuario ve SU error de subida; el 409 de la limpieza no lo tapa (solo deja rastro).
    expect(fallo.message).toContain('No se pudo guardar la imagen.');
    expect(fallo.message).not.toContain('Foto del arte no encontrada');
    expect(del).toHaveBeenCalledTimes(1);
    expect(avisos).toHaveBeenCalledTimes(1);
  });
});
