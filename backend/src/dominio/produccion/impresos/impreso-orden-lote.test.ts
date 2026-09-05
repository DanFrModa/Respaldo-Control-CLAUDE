/**
 * ⭐⭐ 0.140 — EL FRENO DE MEMORIA DEL IMPRESO DE LA ORDEN, el papel que se imprime POR LOTE.
 *
 * Lo que este archivo cuida —y que hasta la 0.140 no cuidaba nadie— es que **imprimir cien órdenes
 * de un golpe no pueda tumbar el servidor**. Son cuatro conductas distintas y cada una se prueba
 * con su control negativo (quitar la pieza pone la prueba en rojo):
 *
 *  1. **Tope por imagen**: el impreso pide sus bytes con `MAX_BYTES_IMAGEN_IMPRESO`, el mismo tope
 *     que ya usaban la ficha de arte y el recibo. Una foto por encima **no se descarga** (ni se
 *     lee el cuerpo de la respuesta) y sale como HUECO con el aviso de siempre.
 *  2. **Presupuesto por PDF**: las órdenes de un archivo comparten UN presupuesto de imágenes, así
 *     que el número de descargas —y con él lo retenido en memoria— **no crece con el número de
 *     órdenes**. Lo que ya no cabe sale como hueco `'lote-lleno'`, con un aviso que dice qué hacer.
 *  3. **Corte del lote**: cuando el presupuesto se acaba el lote sigue en OTRO PDF, así que ninguna
 *     hoja sale coja; el corte sale del presupuesto y no de un número escrito a mano.
 *  4. **Piso de la hoja**: aun con el bolsón agotado cae al menos un arte y una foto (cinturón).
 *
 * El worker de PDF se sustituye (`vi.mock`): estas pruebas miden la RESOLUCIÓN de los datos —dónde
 * vive el defecto— y no el render, que ya tiene sus propios tests.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import type { ServicioArchivos } from '../../../comun/archivos.js';
import type { SesionUsuario } from '../../../comun/permisos.js';
import type { OrdenSalida } from '../../../contrato/index.js';
import type { ModeloArteDetalle } from '../../modelos/arte-modelo.js';
import type { BomModelo } from '../../modelos/bom-modelo.js';
import type { FotoModeloConUrl } from '../../modelos/fotos-modelo.js';
import { extraerTextoPdf } from '../../../comun/pdf-texto.js';

import {
  MAX_BYTES_IMAGEN_IMPRESO,
  MAX_RETENIDO_POR_IMAGEN,
  PRESUPUESTO_IMAGENES_LOTE,
  descargarImagenComoDataUrl,
  nuevoPresupuestoImagenes,
} from './imagenes-impreso.js';
import {
  armarDatosImpresoOrden,
  generarPdfOrden,
  impresoOrden,
  impresoOrdenesPorPartes,
  AVISO_HUECO,
  MAX_ARTES,
  MAX_FOTOS,
  type DatosImpresoOrden,
  type DepsImpreso,
} from './impreso-orden.js';

// El render vive en un worker aparte (hilo + logo por BD): aquí no se ejercita, se sustituye.
vi.mock('../../../comun/pdf-worker.js', () => ({
  renderizarPdfEnWorker: vi.fn(() => Promise.resolve(Buffer.from('%PDF-falso'))),
}));
// Se importa DESPUÉS del mock para poder leer, en las pruebas del corte, qué hojas fue a parar a
// cada PDF: es la forma de mirar el reparto sin añadirle al dominio un gancho que sólo usan tests.
const { renderizarPdfEnWorker } = await import('../../../comun/pdf-worker.js');

const archivosFake = {
  solicitarSubida: vi.fn(),
  urlDescarga: vi.fn((key: string) => Promise.resolve(`https://r2/${key}`)),
} as unknown as ServicioArchivos;

function sesionConVer(): SesionUsuario {
  return {
    id: 'u1',
    username: 'tester',
    nombre: 'Tester',
    idEmpresaActiva: 1,
    nombreEmpresaActiva: 'FR Moda',
    permisos: new Set(['ordenes.ver']),
  } as unknown as SesionUsuario;
}

/** Un arte del BOM con UNA foto (los campos que al impreso le importan; el resto, inocuo). */
function arteConFoto(id: number): ModeloArteDetalle {
  return {
    id,
    idModelo: 1,
    descripcion: `Arte ${String(id)}`,
    posicion: null,
    puntadas: null,
    precio: null,
    idTipoArte: 1,
    tipoArte: 'Bordado',
    codigoTipoArte: 'bordado',
    usaPuntadas: true,
    idProveedor: null,
    proveedor: null,
    fotos: [
      { idFoto: id * 100, idArchivo: `arch-${String(id)}`, orden: 0, key: `arte-${String(id)}` },
    ],
    orden: id,
    creadoEn: new Date('2026-01-01T00:00:00Z'),
    creadoPorId: null,
    modificadoEn: new Date('2026-01-01T00:00:00Z'),
    modificadoPorId: null,
  };
}

/** Fotos del modelo, ya presignadas por `leerFotosModelo` (así llegan al impreso). */
function fotosDelModelo(cuantas: number): FotoModeloConUrl[] {
  return Array.from({ length: cuantas }, (_, i) => ({
    idFoto: i + 1,
    idArchivo: `f${String(i)}`,
    orden: i,
    key: `foto-${String(i)}`,
    urlDescarga: `https://r2/foto-${String(i)}`,
  })) as unknown as FotoModeloConUrl[];
}

const bomConArtes = (cuantos: number): BomModelo => ({
  telas: [],
  avios: [],
  artes: Array.from({ length: cuantos }, (_, i) => arteConFoto(i + 1)),
});

/**
 * `deps` con todas las lecturas de dominio inyectadas: la orden trae `MAX_FOTOS` fotos del modelo y
 * `MAX_ARTES` artes con foto, o sea el MÁXIMO de imágenes que una hoja puede pedir.
 */
function depsCon(
  descargarImagen: DepsImpreso['descargarImagen'],
  extra: Partial<DepsImpreso> = {},
): DepsImpreso {
  const bom = bomConArtes(MAX_ARTES);
  return {
    archivos: archivosFake,
    obtenerOrden: (_sesion: unknown, id: number) =>
      Promise.resolve({
        idModelo: 7,
        folio: 900 + id,
        estado: 'completa',
        motivoCancelada: null,
        fecha: '2026-06-16',
        fechaEntrega: '2026-06-30',
        cliente: 'Cliente',
        ocCliente: null,
        referencias: [],
        etiquetaMarca: null,
        maquilero: null,
        codigoModelo: 'MOD-7',
        descripcionModelo: 'Desc',
        composicion: null,
        tela: null,
        observaciones: null,
        obsMaquila: null,
        lineas: [{ color: 'Rojo', pack: '', tallas: [{ etiquetaTalla: 'CH', cantidad: 2 }] }],
        totalPiezas: 2,
      } as unknown as OrdenSalida),
    leerBom: () => Promise.resolve(bom),
    leerRecetaParaImpreso: () =>
      Promise.resolve({
        telas: [],
        avios: [],
        artes: bom.artes.map((a) => ({
          descripcion: a.descripcion,
          tipoArte: a.tipoArte,
          idModeloArte: a.id,
        })),
      }),
    leerFotosModelo: () => Promise.resolve(fotosDelModelo(MAX_FOTOS)),
    leerIdsFotosOcultas: () => Promise.resolve([]),
    leerArteOrdenFotos: () => Promise.resolve([]),
    listarAdjuntos: () => Promise.resolve([]),
    leerTelasCompradas: () => Promise.resolve([]),
    ...(descargarImagen ? { descargarImagen } : {}),
    ...extra,
  };
}

/** Cuántas imágenes puede pedir UNA hoja al máximo (las dos rejillas llenas). */
const IMAGENES_POR_HOJA = MAX_FOTOS + MAX_ARTES;

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  // ⚠️ `restoreAllMocks` NO deshace `stubGlobal`: sin esto, el `fetch` simulado de los tests del
  // tope sobrevive y se lo come el WASM de `yoga-layout` cuando más abajo se renderiza un PDF de
  // verdad (falla con "expected magic word": le llegan los bytes de la foto simulada).
  vi.unstubAllGlobals();
});

// ── (a) TOPE POR IMAGEN ─────────────────────────────────────────────────────────────────────────

describe('0.140 (a) — el impreso de la orden baja sus imágenes CON TOPE de bytes', () => {
  it('🔑 pide cada imagen con `MAX_BYTES_IMAGEN_IMPRESO` (el mismo tope de la ficha de arte)', async () => {
    const descargarImagen = vi.fn(() => Promise.resolve('data:image/jpeg;base64,AA=='));
    await armarDatosImpresoOrden(sesionConVer(), 1, undefined, depsCon(descargarImagen));

    expect(descargarImagen).toHaveBeenCalledTimes(IMAGENES_POR_HOJA);
    // NINGUNA llamada sin tope: el defecto de la 0.140 era exactamente ese (bajaba lo que viniera).
    for (const [, maxBytes] of descargarImagen.mock.calls as unknown as [string, number][]) {
      expect(maxBytes).toBe(MAX_BYTES_IMAGEN_IMPRESO);
    }
  });

  it('🔑 una imagen POR ENCIMA del tope NO se descarga y sale como HUECO (de punta a punta)', async () => {
    // Descarga REAL contra un `fetch` simulado: así se prueba la cadena entera —el impreso pasa el
    // tope y la descarga lo aplica— y no sólo que se pase un número.
    const gorda = MAX_BYTES_IMAGEN_IMPRESO + 1;
    const leerBytes = vi.fn(() => Promise.resolve(new ArrayBuffer(8)));
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          headers: { get: (h: string) => (h === 'content-length' ? String(gorda) : 'image/jpeg') },
          arrayBuffer: leerBytes,
        }),
      ),
    );

    const datos = await armarDatosImpresoOrden(
      sesionConVer(),
      1,
      undefined,
      depsCon(descargarImagenComoDataUrl),
    );

    expect(datos.fotos).toHaveLength(MAX_FOTOS);
    expect(datos.fotos.every((f) => f.dataUrl === null)).toBe(true);
    expect(datos.artes.every((a) => a.dataUrl === null)).toBe(true);
    // El hueco es el de SIEMPRE («no se pudo traer»), no el del lote: para el papel, una imagen que
    // pesa de más y una que no llegó son lo mismo.
    expect(datos.fotos.every((f) => f.motivoHueco === undefined)).toBe(true);
    // Y no se bufferó ni un byte: el tope se ve en el `content-length`, antes de leer el cuerpo.
    expect(leerBytes).not.toHaveBeenCalled();
  });

  it('una imagen DENTRO del tope se incrusta con normalidad', async () => {
    const chica = Buffer.alloc(1024, 7);
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          headers: {
            get: (h: string) => (h === 'content-length' ? String(chica.length) : 'image/jpeg'),
          },
          arrayBuffer: () => Promise.resolve(chica.buffer.slice(0, chica.length)),
        }),
      ),
    );

    const datos = await armarDatosImpresoOrden(
      sesionConVer(),
      1,
      undefined,
      depsCon(descargarImagenComoDataUrl),
    );

    expect(datos.fotos.every((f) => f.dataUrl?.startsWith('data:image/jpeg;base64,'))).toBe(true);
    expect(datos.artes.every((a) => a.dataUrl !== null)).toBe(true);
  });
});

// ── (b) EL LOTE SE PARTE EN VARIOS PDFs, Y CADA HOJA TIENE SU PISO ──────────────────────────────

/** Junta los PDF que va soltando el generador, contándolos (los buffers aquí son de mentira). */
async function partesDe(gen: AsyncGenerator<Buffer>): Promise<Buffer[]> {
  const partes: Buffer[] = [];
  for await (const parte of gen) {
    partes.push(parte);
  }
  return partes;
}

describe('0.140 (b) — el lote se parte en varios PDFs para que ninguna hoja salga coja', () => {
  /**
   * Descarga que devuelve SIEMPRE la misma data-URL del peso máximo que una imagen puede retener
   * ({@link MAX_RETENIDO_POR_IMAGEN}): o sea, hojas al PEOR caso, que es donde el presupuesto
   * muerde. La cadena es la MISMA referencia en todas las llamadas, así el test no se come 100 MB.
   */
  function descargaAlTope(): DepsImpreso['descargarImagen'] & { llamadas: () => number } {
    const relleno = 'x'.repeat(MAX_RETENIDO_POR_IMAGEN);
    const fn = vi.fn(() => Promise.resolve(relleno));
    return Object.assign(fn, { llamadas: () => fn.mock.calls.length });
  }

  /**
   * Las hojas que fueron a parar a cada PDF, leídas del worker (que está sustituido). El worker
   * recibe `(tipo, datos, opciones)` y el segundo argumento llega como `unknown` desde el mock, así
   * que se le pone tipo UNA vez, aquí, en vez de en cada aserción.
   */
  function hojasPorParte(): DatosImpresoOrden[][] {
    const llamadas = vi.mocked(renderizarPdfEnWorker).mock.calls as unknown as [
      string,
      DatosImpresoOrden[],
      unknown,
    ][];
    return llamadas.map((args) => args[1]);
  }

  it('🔴 NINGUNA HOJA SALE COJA: 12 órdenes al peor caso salen en varias partes, TODAS completas', async () => {
    // ⭐ LA conducta que Daniel pidió en la 2ª ronda. Antes, con UN solo PDF y un presupuesto
    // compartido, sólo las ~7 primeras órdenes conservaban sus imágenes: a 100 órdenes salían 651
    // huecos en 93 hojas. Ahora el lote se corta y cada PDF estrena presupuesto.
    const partes = await partesDe(
      impresoOrdenesPorPartes(
        sesionConVer(),
        Array.from({ length: 12 }, (_, i) => i + 1),
        undefined,
        depsCon(descargaAlTope()),
      ),
    );

    // Se partió: 12 hojas al PEOR caso no caben en un presupuesto (una sola retiene 112 MB).
    expect(partes.length).toBeGreaterThan(1);
    const hojas = hojasPorParte().flat();
    // Las 12 llegaron —ninguna se perdió por el camino— y todas con TODAS sus imágenes.
    expect(hojas).toHaveLength(12);
    for (const [i, hoja] of hojas.entries()) {
      expect(
        hoja.fotos.filter((f) => f.dataUrl !== null).length,
        `hoja ${String(i + 1)}: le faltan fotos`,
      ).toBe(MAX_FOTOS);
      expect(
        hoja.artes.filter((a) => a.dataUrl !== null).length,
        `hoja ${String(i + 1)}: le faltan artes`,
      ).toBe(MAX_ARTES);
    }
    // Y ninguna lleva el hueco del presupuesto: con el corte, eso pasó a ser el borde.
    expect(hojas.some((h) => [...h.fotos, ...h.artes].some((i) => i.motivoHueco))).toBe(false);
  });

  it('🔑 el corte NO se escribe a mano: sale del presupuesto, así que con fotos chicas caben más órdenes por archivo', async () => {
    // Mismo lote, dos tamaños de imagen. Si el número de órdenes por archivo estuviera escrito en el
    // código, las dos corridas darían el MISMO número de partes; y no lo dan.
    const ids = Array.from({ length: 12 }, (_, i) => i + 1);
    const chicas = 'x'.repeat(1024);
    const conChicas = await partesDe(
      impresoOrdenesPorPartes(
        sesionConVer(),
        ids,
        undefined,
        depsCon(vi.fn(() => Promise.resolve(chicas))),
      ),
    );
    vi.mocked(renderizarPdfEnWorker).mockClear();
    const conGordas = await partesDe(
      impresoOrdenesPorPartes(sesionConVer(), ids, undefined, depsCon(descargaAlTope())),
    );

    expect(conChicas).toHaveLength(1); // con fotos normales, las 12 caben en un archivo
    expect(conGordas.length).toBeGreaterThan(conChicas.length);
  });

  it('🔴 EL GENERADOR NO SE ADELANTA: nunca hay más PDF armados que los que se le pidieron', async () => {
    // Es lo que hace que el pico no crezca con el lote, y se mide CONTANDO los PDF construidos, no
    // afirmándolo. (Cuántos quedan VIVOS a la vez en la cadena real —son 2— se mide aparte, con
    // `WeakRef`, porque eso no se ve desde aquí: ver la cabecera de `comun/zip-al-vuelo.ts`.)
    vi.mocked(renderizarPdfEnWorker).mockClear();
    const gen = impresoOrdenesPorPartes(
      sesionConVer(),
      Array.from({ length: 12 }, (_, i) => i + 1),
      undefined,
      depsCon(descargaAlTope()),
    );
    expect(renderizarPdfEnWorker).toHaveBeenCalledTimes(0); // aún no se ha pedido nada

    expect((await gen.next()).done).toBe(false);
    expect(renderizarPdfEnWorker).toHaveBeenCalledTimes(1);

    expect((await gen.next()).done).toBe(false);
    expect(renderizarPdfEnWorker).toHaveBeenCalledTimes(2);

    await gen.return(); // se puede abandonar a media descarga sin dejar nada colgado
    expect(renderizarPdfEnWorker).toHaveBeenCalledTimes(2); // y abandonar no construye de más
  });

  it('el caso de todos los días (fotos normales) sigue saliendo en UN SOLO PDF', async () => {
    // Partir sólo tiene sentido cuando hace falta: con fotos de tamaño normal, un lote entero cabe
    // en un archivo y el usuario baja UNO, como siempre.
    const normales = 'x'.repeat(3 * 1024 * 1024); // ~3 MB de data-URL por imagen
    const partes = await partesDe(
      impresoOrdenesPorPartes(
        sesionConVer(),
        Array.from({ length: 6 }, (_, i) => i + 1),
        undefined,
        depsCon(vi.fn(() => Promise.resolve(normales))),
      ),
    );
    expect(partes).toHaveLength(1);
  });

  it('una orden SOLA no estrena presupuesto: imprime todas sus imágenes', async () => {
    const descargar = descargaAlTope();
    await impresoOrden(sesionConVer(), 1, undefined, depsCon(descargar));
    expect(descargar.llamadas()).toBe(IMAGENES_POR_HOJA);
  });
});

// ── (c) EL PISO DE LA HOJA: «al menos una de arte y una del modelo» ─────────────────────────────

describe('0.140 (c) — el piso de la hoja (Daniel): al menos UNA de arte y UNA del modelo', () => {
  const relleno = 'x'.repeat(MAX_RETENIDO_POR_IMAGEN);
  const alTope = (): DepsImpreso['descargarImagen'] => vi.fn(() => Promise.resolve(relleno));

  /** Arma N hojas seguidas COMPARTIENDO un presupuesto, que es donde el piso tiene que notarse. */
  async function hojasCon(
    presupuesto: ReturnType<typeof nuevoPresupuestoImagenes>,
    cuantas: number,
    extra: Partial<DepsImpreso> = {},
  ): Promise<{ fotos: number; artes: number }[]> {
    const deps = depsCon(alTope(), extra);
    const salida: { fotos: number; artes: number }[] = [];
    for (let id = 1; id <= cuantas; id += 1) {
      const datos = await armarDatosImpresoOrden(sesionConVer(), id, undefined, {
        ...deps,
        presupuestoImagenes: presupuesto,
      });
      salida.push({
        fotos: datos.fotos.filter((f) => f.dataUrl !== null).length,
        artes: datos.artes.filter((a) => a.dataUrl !== null).length,
      });
    }
    return salida;
  }

  it('🔴 NINGUNA HOJA SE QUEDA CIEGA DE UN LADO: con el bolsón agotado siguen cayendo 1 arte y 1 foto', async () => {
    // El defecto que esto cierra, MEDIDO antes del piso: con el presupuesto de producción y hojas
    // al peor caso, la 2ª hoja salía con 3/3 fotos decorativas y **0/4 artes** — perdía justo la
    // imagen que el papel manda a conseguir antes de producir. Y no lo decidía nadie: lo decidía
    // que las fotos del modelo llegan presignadas y los artes no.
    //
    // Con un presupuesto de UN byte el bolsón está agotado desde la primera hoja, así que lo único
    // que puede hacer pasar una imagen es el piso. Sin piso, la 1ª hoja se lo comería entero por la
    // carrera y las demás saldrían a cero.
    const hojas = await hojasCon(nuevoPresupuestoImagenes(1), 5);

    for (const [i, hoja] of hojas.entries()) {
      expect(hoja.artes, `hoja ${String(i + 1)}: se quedó sin NINGÚN arte`).toBeGreaterThanOrEqual(
        1,
      );
      expect(hoja.fotos, `hoja ${String(i + 1)}: se quedó sin NINGUNA foto`).toBeGreaterThanOrEqual(
        1,
      );
    }
    // Y el presupuesto SÍ mordió: si todas salieran completas, esta prueba no probaría nada.
    expect(hojas.some((h) => h.artes < MAX_ARTES || h.fotos < MAX_FOTOS)).toBe(true);
  });

  it('🔑 EL DEFECTO EXACTO, al derecho: nunca una hoja con fotos y CERO artes', async () => {
    // Ésta es la forma que tenía el defecto: 3/3 fotos decorativas y 0/4 artes. La prueba lo pinta
    // como invariante, no como anécdota — y en las dos direcciones, porque mañana la carrera puede
    // ganarla el otro bloque y el papel quedaría igual de cojo.
    const hojas = await hojasCon(nuevoPresupuestoImagenes(1), 5);
    for (const [i, hoja] of hojas.entries()) {
      expect(
        hoja.artes > 0,
        `hoja ${String(i + 1)}: ${String(hoja.fotos)} fotos y CERO artes`,
      ).toBe(true);
      expect(
        hoja.fotos > 0,
        `hoja ${String(i + 1)}: ${String(hoja.artes)} artes y CERO fotos`,
      ).toBe(true);
    }
  });

  it('🔴 EL TAMAÑO DEL PRESUPUESTO ESTÁ ATADO A UNA CONDUCTA, no a un número decorativo', async () => {
    // Lo único que el presupuesto tiene que garantizar es que **una hoja sobre presupuesto RECIÉN
    // ESTRENADO salga entera**: es lo que hace que rehacer la orden en un PDF nuevo (el corte)
    // sirva de algo. Antes esto lo "vigilaba" la desigualdad `128 > 112`, que era decorativa: con
    // 100 MB —o con 60— la hoja también sale entera, así que bajar el número no ponía nada rojo.
    //
    // MEDIDO, el umbral real es `MAX_FOTOS × MAX_RETENIDO_POR_IMAGEN` (48 MB): las fotos del modelo
    // llegan presignadas, ganan la carrera y cobran primero, así que al arte le basta con que sobre
    // algo después de ellas. Con 48 la hoja sale coja; con 49, entera.
    const umbral = MAX_FOTOS * MAX_RETENIDO_POR_IMAGEN;

    // (a) Con el presupuesto de PRODUCCIÓN, la hoja sale ENTERA. Si alguien lo baja del umbral,
    //     ESTA aserción se pone roja — que es justo lo que antes no pasaba.
    const conProduccion = await armarDatosImpresoOrden(sesionConVer(), 1, undefined, {
      ...depsCon(alTope()),
      presupuestoImagenes: nuevoPresupuestoImagenes(),
    });
    expect(conProduccion.fotos.filter((f) => f.dataUrl !== null)).toHaveLength(MAX_FOTOS);
    expect(conProduccion.artes.filter((a) => a.dataUrl !== null)).toHaveLength(MAX_ARTES);
    expect(PRESUPUESTO_IMAGENES_LOTE).toBeGreaterThan(umbral);

    // (b) Y JUSTO EN el umbral la hoja sale coja: la prueba es sensible al número, no lo acompaña.
    const enElUmbral = await armarDatosImpresoOrden(sesionConVer(), 1, undefined, {
      ...depsCon(alTope()),
      presupuestoImagenes: nuevoPresupuestoImagenes(umbral),
    });
    expect(enElUmbral.artes.filter((a) => a.dataUrl !== null).length).toBeLessThan(MAX_ARTES);
  });

  it('🔑 el piso NO gasta nada cuando la orden no tiene esa clase de imagen', async () => {
    // Una orden sin artes no debe consumir su permiso de arte ni penalizar a las fotos.
    const sinArte: Partial<DepsImpreso> = {
      leerBom: () => Promise.resolve(bomConArtes(0)),
      leerRecetaParaImpreso: () => Promise.resolve({ telas: [], avios: [], artes: [] }),
    };
    const hojas = await hojasCon(nuevoPresupuestoImagenes(1), 3, sinArte);
    expect(hojas.every((h) => h.artes === 0)).toBe(true);
    // Y sus fotos siguen llegando: el permiso de arte, al no usarse, no le quita nada a nadie.
    expect(hojas.every((h) => h.fotos >= 1)).toBe(true);
  });

  it('la PRIMERA hoja sale SIEMPRE entera, y lo que falte se dice en el papel (0.106)', async () => {
    const hojas = await hojasCon(nuevoPresupuestoImagenes(), 8);
    expect(hojas[0]).toEqual({ fotos: MAX_FOTOS, artes: MAX_ARTES });

    // Y lo que no cabe nunca desaparece en silencio: sale como hueco con su motivo.
    const deps = depsCon(alTope());
    const presupuesto = nuevoPresupuestoImagenes(1);
    await armarDatosImpresoOrden(sesionConVer(), 1, undefined, {
      ...deps,
      presupuestoImagenes: presupuesto,
    });
    const segunda = await armarDatosImpresoOrden(sesionConVer(), 2, undefined, {
      ...deps,
      presupuestoImagenes: presupuesto,
    });
    expect(segunda.fotos.some((f) => f.motivoHueco === 'lote-lleno')).toBe(true);
    expect(segunda.fotos).toHaveLength(MAX_FOTOS);
    expect(segunda.totalPiezas).toBe(2); // la hoja sale ENTERA: falta la imagen, no la orden
  });
});

// ── El aviso del hueco, EN EL PAPEL ─────────────────────────────────────────────────────────────

describe('0.140 — el hueco dice POR QUÉ está vacío', () => {
  function datosConHueco(motivo?: 'lote-lleno'): DatosImpresoOrden {
    return {
      empresa: 'FR Moda',
      folio: 1234,
      estado: 'completa',
      motivoCancelada: null,
      fecha: '2026-06-16',
      fechaEntrega: '2026-06-30',
      cliente: 'Cliente',
      pedidoCliente: null,
      etiquetaMarca: null,
      maquilero: null,
      codigoModelo: 'MOD-1',
      descripcionModelo: null,
      composicion: null,
      tela: null,
      observaciones: null,
      obsMaquila: null,
      tallas: ['CH'],
      renglones: [{ color: 'Rojo', pantone: null, cantidades: [2], totalFila: 2 }],
      totalesColumna: [2],
      totalPiezas: 2,
      telas: [],
      listaArte: [],
      habilitacion: [],
      fotos: [{ dataUrl: null, ...(motivo ? { motivoHueco: motivo } : {}) }],
      fotosOcultas: 0,
      artes: [{ dataUrl: null, ...(motivo ? { motivoHueco: motivo } : {}) }],
      artesOcultas: 0,
    };
  }

  /**
   * El texto del PDF sale partido en renglones (y con guiones de corte) porque las cajas del hueco
   * son estrechas: se rearma antes de comparar, si no la aserción hablaría del ancho de la caja y
   * no de lo que dice el papel.
   */
  async function textoDelPdf(datos: DatosImpresoOrden): Promise<string> {
    const crudo = (await extraerTextoPdf(await generarPdfOrden(datos))).join('\n');
    return crudo.replace(/-\n/g, '').replace(/\s+/g, ' ').trim();
  }

  it('sin motivo, el hueco dice el aviso de siempre («no se pudo traer»)', async () => {
    const texto = await textoDelPdf(datosConHueco());
    expect(texto).toContain(AVISO_HUECO.fotoNoLlego);
    expect(texto).toContain(AVISO_HUECO.arteNoLlego);
    expect(texto).not.toContain('lote');
  });

  it('🔑 con el lote lleno, el hueco lo DICE y manda a imprimir esa orden sola', async () => {
    const texto = await textoDelPdf(datosConHueco('lote-lleno'));
    expect(texto).toContain(AVISO_HUECO.fotoLoteLleno);
    expect(texto).toContain(AVISO_HUECO.arteLoteLleno);
    expect(texto).not.toContain('no se pudo traer');
  });

  it('las cuatro frases del hueco viven juntas y son distintas entre sí', () => {
    const frases = Object.values(AVISO_HUECO);
    expect(new Set(frases).size).toBe(frases.length);
  });
});
