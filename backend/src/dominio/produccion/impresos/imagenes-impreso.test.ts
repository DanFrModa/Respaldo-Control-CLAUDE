/**
 * Tests UNITARIOS del módulo compartido de imágenes de los impresos de una orden (0.094):
 *  • `fotosArteDeLaOrden` — la REGLA de qué fotos de arte manda la OP (0.083, §Post-F9.177), ahora
 *    compartida por el impreso de la ORDEN y la FICHA DE ARTE. Función pura.
 *  • `anteponerPrincipal` — la garantía anti-recorte.
 *  • `descargarImagenComoDataUrl` — best-effort y su TOPE DE PESO opcional.
 * No tocan BD ni red: `fetch` va stubbeado.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ArteOrdenFotosImpreso } from '../fotos-arte-orden.js';

import {
  anteponerPrincipal,
  descargarImagenComoDataUrl,
  fotosArteDeLaOrden,
  leerFotosArteDeLaOrdenPorId,
  porRondas,
  type ArteModeloParaImpreso,
  type DepsFotosArteOrden,
} from './imagenes-impreso.js';

/** Un arte del modelo con sus fotos (ids correlativos a la key para poder apagarlas por id). */
function arte(id: number, descripcion: string, fotos: number[]): ArteModeloParaImpreso {
  return { id, descripcion, fotos: fotos.map((idFoto) => ({ idFoto, key: `k${String(idFoto)}` })) };
}

/** La decisión de un renglón de arte de la OP (qué apagó y qué subió). */
function decision(over: Partial<ArteOrdenFotosImpreso>): ArteOrdenFotosImpreso {
  return {
    idOrdenArte: 1,
    idModeloArte: null,
    descripcion: 'X',
    ocultas: [],
    propias: [],
    ...over,
  };
}

describe('fotosArteDeLaOrden — la regla de QUÉ FOTOS manda la OP', () => {
  it('solo salen los artes que ESTA orden lleva (por la traza), no todo el BOM del modelo', () => {
    const salida = fotosArteDeLaOrden(
      [arte(10, 'Frente', [1]), arte(20, 'Espalda', [2])],
      [{ idModeloArte: 10 }],
      [],
    );
    expect(salida).toEqual([{ titulo: 'Frente', key: 'k1', principal: true }]);
  });

  it('🔑 una foto heredada que la OP APAGÓ no se imprime; las demás del mismo arte sí', () => {
    const salida = fotosArteDeLaOrden(
      [arte(10, 'Frente', [1, 2, 3])],
      [{ idModeloArte: 10 }],
      [decision({ idModeloArte: 10, ocultas: [2] })],
    );
    expect(salida.map((f) => f.key)).toEqual(['k1', 'k3']);
  });

  it('🔑 sin decisiones (lo ya capturado) la OP enseña TODAS las heredadas', () => {
    const salida = fotosArteDeLaOrden([arte(10, 'Frente', [1, 2])], [{ idModeloArte: 10 }], []);
    expect(salida.map((f) => f.key)).toEqual(['k1', 'k2']);
  });

  it('las fotos que subió la OP van DETRÁS de las heredadas de su mismo arte y nunca son principal', () => {
    const salida = fotosArteDeLaOrden(
      [arte(10, 'Frente', [1])],
      [{ idModeloArte: 10 }],
      [decision({ idModeloArte: 10, propias: [{ idFoto: 90, key: 'propia' }] })],
    );
    expect(salida).toEqual([
      { titulo: 'Frente', key: 'k1', principal: true },
      { titulo: 'Frente', key: 'propia', principal: false },
    ]);
  });

  it('🔑 el arte AGREGADO A MANO (sin traza) imprime sus fotos, al final', () => {
    const salida = fotosArteDeLaOrden(
      [arte(10, 'Frente', [1])],
      [{ idModeloArte: 10 }, { idModeloArte: null }],
      [
        decision({
          idModeloArte: null,
          descripcion: 'Etiqueta a mano',
          propias: [{ idFoto: 91, key: 'mano' }],
        }),
      ],
    );
    expect(salida.map((f) => f.titulo)).toEqual(['Frente', 'Etiqueta a mano']);
    expect(salida[1]?.principal).toBe(false);
  });

  it('🔑 SER PRINCIPAL NO ES UN PUESTO: si la OP apaga la primera del primer arte, NADIE es principal', () => {
    const salida = fotosArteDeLaOrden(
      [arte(10, 'Frente', [1, 2])],
      [{ idModeloArte: 10 }],
      [decision({ idModeloArte: 10, ocultas: [1] })],
    );
    expect(salida.map((f) => f.key)).toEqual(['k2']);
    expect(salida.every((f) => !f.principal)).toBe(true);
  });

  it('🔑 el reparto POR RONDAS: un arte con muchas fotos no expulsa la única del otro', () => {
    const salida = fotosArteDeLaOrden(
      [arte(10, 'Frente', [1, 2, 3]), arte(20, 'Espalda', [4])],
      [{ idModeloArte: 10 }, { idModeloArte: 20 }],
      [],
    );
    // Ronda 1: la 1ª de cada arte. Ronda 2 y 3: las extra del primero.
    expect(salida.map((f) => f.key)).toEqual(['k1', 'k4', 'k2', 'k3']);
  });

  it('🔑 solo la PRIMERA foto del PRIMER arte es la principal (no una por arte)', () => {
    const salida = fotosArteDeLaOrden(
      [arte(10, 'Frente', [1, 2]), arte(20, 'Espalda', [3, 4])],
      [{ idModeloArte: 10 }, { idModeloArte: 20 }],
      [],
    );
    expect(salida.filter((f) => f.principal).map((f) => f.key)).toEqual(['k1']);
  });

  it('una orden sin arte no produce ninguna foto', () => {
    expect(fotosArteDeLaOrden([arte(10, 'Frente', [1])], [], [])).toEqual([]);
  });

  it('un arte que la orden lleva pero SIN fotos no produce nada (y no rompe)', () => {
    expect(fotosArteDeLaOrden([arte(10, 'Frente', [])], [{ idModeloArte: 10 }], [])).toEqual([]);
  });
});

/** Imagen mínima para ejercitar {@link anteponerPrincipal} sin arrastrar la forma real. */
interface Imagen {
  id: number;
  principal?: boolean;
}

describe('porRondas / anteponerPrincipal', () => {
  it('porRondas intercala y conserva el orden dentro de cada ronda', () => {
    expect(porRondas([['a1', 'a2', 'a3'], ['b1'], ['c1', 'c2']])).toEqual([
      'a1',
      'b1',
      'c1',
      'a2',
      'c2',
      'a3',
    ]);
  });

  it('anteponerPrincipal trae la principal al frente conservando el resto', () => {
    const r = anteponerPrincipal<Imagen>([
      { principal: false, id: 1 },
      { principal: false, id: 2 },
      { principal: true, id: 3 },
    ]);
    expect(r.map((x) => x.id)).toEqual([3, 1, 2]);
  });

  it('sin principal (o ya al frente) devuelve el mismo orden', () => {
    expect(anteponerPrincipal<Imagen>([{ id: 1 }, { id: 2 }]).map((x) => x.id)).toEqual([1, 2]);
    expect(
      anteponerPrincipal<Imagen>([
        { principal: true, id: 1 },
        { principal: false, id: 2 },
      ]).map((x) => x.id),
    ).toEqual([1, 2]);
  });
});

/** Respuesta de `fetch` falsa con control sobre las cabeceras y los bytes. */
function respuesta(opciones: {
  ok?: boolean;
  contentType?: string | null;
  contentLength?: string | null;
  bytes?: Buffer;
}): Response {
  const cabeceras = new Map<string, string>();
  if (opciones.contentType !== null) {
    cabeceras.set('content-type', opciones.contentType ?? 'image/png');
  }
  if (opciones.contentLength !== null && opciones.contentLength !== undefined) {
    cabeceras.set('content-length', opciones.contentLength);
  }
  const bytes = opciones.bytes ?? Buffer.from('abc');
  return {
    ok: opciones.ok ?? true,
    headers: { get: (k: string) => cabeceras.get(k.toLowerCase()) ?? null },
    arrayBuffer: (): Promise<ArrayBuffer> => {
      const copia = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(copia).set(bytes);
      return Promise.resolve(copia);
    },
  } as unknown as Response;
}

describe('descargarImagenComoDataUrl — best-effort y TOPE DE PESO', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('devuelve la data-URL con el content-type de la respuesta', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(respuesta({ contentType: 'image/jpeg' }))),
    );
    await expect(descargarImagenComoDataUrl('https://r2/x')).resolves.toBe(
      `data:image/jpeg;base64,${Buffer.from('abc').toString('base64')}`,
    );
  });

  it('una respuesta que no es OK devuelve null (no truena)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(respuesta({ ok: false }))),
    );
    await expect(descargarImagenComoDataUrl('https://r2/x')).resolves.toBeNull();
  });

  it('un cuerpo vacío devuelve null', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(respuesta({ bytes: Buffer.alloc(0) }))),
    );
    await expect(descargarImagenComoDataUrl('https://r2/x')).resolves.toBeNull();
  });

  it('🔑 CONTROL NEGATIVO: SIN tope, una imagen enorme SÍ se incrusta', async () => {
    const gorda = Buffer.alloc(3 * 1024 * 1024, 7);
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(respuesta({ bytes: gorda, contentLength: String(gorda.length) })),
      ),
    );
    await expect(descargarImagenComoDataUrl('https://r2/x')).resolves.not.toBeNull();
  });

  it('🔑 con tope, la MISMA imagen se rechaza por el `content-length`, sin llegar a bufferearla', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const gorda = Buffer.alloc(3 * 1024 * 1024, 7);
    const res = respuesta({ bytes: gorda, contentLength: String(gorda.length) });
    const leerBytes = vi.spyOn(res, 'arrayBuffer');
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(res)),
    );
    await expect(descargarImagenComoDataUrl('https://r2/x', 1024)).resolves.toBeNull();
    expect(leerBytes).not.toHaveBeenCalled();
  });

  it('🔑 y si la respuesta NO declara `content-length`, el tope se aplica sobre los bytes leídos', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(respuesta({ bytes: Buffer.alloc(5000, 7), contentLength: null })),
      ),
    );
    await expect(descargarImagenComoDataUrl('https://r2/x', 1024)).resolves.toBeNull();
  });

  it('por debajo del tope se incrusta con normalidad', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(respuesta({ bytes: Buffer.alloc(100, 7) }))),
    );
    await expect(descargarImagenComoDataUrl('https://r2/x', 1024)).resolves.not.toBeNull();
  });

  it('un fallo de red devuelve null (best-effort)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('sin red'))),
    );
    await expect(descargarImagenComoDataUrl('https://r2/x')).resolves.toBeNull();
  });
});

/**
 * ⭐ EL CABLEADO CONTRA BD — etapa → orden → modelo → BOM → receta → decisiones.
 *
 * 🔴 Es el único código nuevo de la 0.094 que toca la base, y un error aquí **no da un 500: da la
 * foto EQUIVOCADA, en silencio, en el papel que el proveedor de arte tiene en la mano** — peor que
 * no imprimirla. Por eso se prueba el cableado ENTERO (no sólo la regla pura): la guarda A9, el
 * best-effort de las decisiones y **el orden de los argumentos** de cada lectura.
 *
 * Sin BD: el cliente de lectura y las tres lecturas van inyectados.
 */
describe('leerFotosArteDeLaOrdenPorId — el cableado que toca la BD', () => {
  /** Cliente de lectura falso: sólo se le pide la orden (para resolver su modelo). */
  function clienteFake(idModelo: number | null): {
    cliente: unknown;
    findFirst: ReturnType<typeof vi.fn>;
  } {
    const findFirst = vi.fn(() => Promise.resolve(idModelo === null ? null : { idModelo }));
    return { cliente: { orden: { findFirst } }, findFirst };
  }

  /** Lecturas inyectadas, con un arte del modelo que la orden SÍ lleva. */
  function lecturas(over: Partial<DepsFotosArteOrden> = {}): {
    deps: DepsFotosArteOrden;
    leerBom: ReturnType<typeof vi.fn>;
    leerReceta: ReturnType<typeof vi.fn>;
    leerDecisiones: ReturnType<typeof vi.fn>;
  } {
    const leerBom = vi.fn(() =>
      Promise.resolve({ telas: [], avios: [], artes: [arte(10, 'Frente', [1, 2])] }),
    );
    const leerReceta = vi.fn(() =>
      Promise.resolve({
        telas: [],
        avios: [],
        artes: [{ descripcion: 'Frente', tipoArte: 'ESTAMPADO', idModeloArte: 10 }],
      }),
    );
    const leerDecisiones = vi.fn(() => Promise.resolve([]));
    return {
      deps: {
        leerBom,
        leerRecetaParaImpreso: leerReceta,
        leerArteOrdenFotos: leerDecisiones,
        ...over,
      } as DepsFotosArteOrden,
      leerBom,
      leerReceta,
      leerDecisiones,
    };
  }

  it('🔑 resuelve el MODELO desde la orden y le pasa a cada lectura lo que le toca', async () => {
    const { cliente, findFirst } = clienteFake(77);
    const { deps, leerBom, leerReceta, leerDecisiones } = lecturas();

    const salida = await leerFotosArteDeLaOrdenPorId(cliente as never, 99, 1, deps);

    // La orden se busca por su id DENTRO de la empresa activa (A9).
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 99, idEmpresa: 1 } }),
    );
    // ⚠️ El ORDEN de los argumentos: el BOM va por MODELO + empresa, la receta por ORDEN.
    // Confundirlos no truena: devuelve el arte de otra prenda.
    expect(leerBom).toHaveBeenCalledWith(cliente, 77, 1);
    expect(leerReceta).toHaveBeenCalledWith(cliente, 99);
    expect(leerDecisiones).toHaveBeenCalledWith(cliente, 99);
    expect(salida).toEqual([
      { titulo: 'Frente', key: 'k1', principal: true },
      { titulo: 'Frente', key: 'k2', principal: false },
    ]);
  });

  it('🔑 A9: una orden que no es de la empresa activa no imprime arte, y NO se lee nada más', async () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { cliente } = clienteFake(null);
    const { deps, leerBom, leerReceta, leerDecisiones } = lecturas();

    await expect(leerFotosArteDeLaOrdenPorId(cliente as never, 99, 1, deps)).resolves.toEqual([]);

    expect(leerBom).not.toHaveBeenCalled();
    expect(leerReceta).not.toHaveBeenCalled();
    expect(leerDecisiones).not.toHaveBeenCalled();
    // Y no se va en un vacío mudo: un papel sin arte por una orden que no apareció tiene que
    // distinguirse de un papel sin arte porque la OP no lo tiene.
    expect(aviso).toHaveBeenCalled();
    aviso.mockRestore();
  });

  it('🔑 si la lectura de las DECISIONES truena, sale el arte del modelo entero (best-effort)', async () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { cliente } = clienteFake(77);
    const { deps } = lecturas({
      leerArteOrdenFotos: vi.fn(() => Promise.reject(new Error('BD caída'))),
    });

    const salida = await leerFotosArteDeLaOrdenPorId(cliente as never, 99, 1, deps);

    // Las DOS fotos del arte del modelo, ninguna apagada: sin decisiones no hay nada que apagar.
    expect(salida.map((f) => f.key)).toEqual(['k1', 'k2']);
    expect(aviso).toHaveBeenCalled();
    aviso.mockRestore();
  });
});
