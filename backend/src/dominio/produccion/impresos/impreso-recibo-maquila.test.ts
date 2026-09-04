/**
 * Tests UNITARIOS del impreso del RECIBO de maquila (F3-E4) y de su FOTO DEL ARTE (0.107). No tocan
 * BD ni red: prueban el armado de la tabla color×talla, el criterio de "esto es un recibo de arte",
 * la resolución de las fotos (con lecturas/R2/descargas inyectadas) y la generación del PDF con
 * datos ya resueltos.
 *
 * ⭐ Por qué existe este archivo: hasta la 0.107 el recibo era uno de los DOS impresos de producción
 * sin pruebas unitarias propias —el otro, la entrega a cliente (`impreso-entrega-cliente.ts`), sigue
 * sin ellas—, y fue justo el que se quedó sin la foto que la 0.094 le puso a la ficha. La rama
 * gemela no tenía quién la mirara.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { ServicioArchivos } from '../../../comun/archivos.js';
import { extraerTextoPdf } from '../../../comun/pdf-texto.js';
import type { SesionUsuario } from '../../../comun/permisos.js';
import type { ReciboSalida } from '../../../contrato/index.js';
import type { FotoArteDeLaOrden } from './imagenes-impreso.js';
import { AVISO_FOTO_FALTANTE, MAX_BYTES_FOTO_ARTE, MAX_FOTOS_ARTE } from './bloque-fotos-arte.js';
// La LÍNEA BASE del conteo de imágenes se mide contra un documento DISTINTO que por diseño nunca
// lleva arte (ver `imagenesEnPdf` más abajo). Es el mismo recurso que usa el test de la ficha.
import { generarPdfEnvio, type DatosImpresoEnvio } from './impreso-envio-maquila.js';

import {
  armarDatosImpresoRecibo,
  armarTablaRecibo,
  bloqueArteRecibo,
  esReciboDeArte,
  generarPdfRecibo,
  type DatosImpresoRecibo,
} from './impreso-recibo-maquila.js';

describe('armarTablaRecibo (F3-E4)', () => {
  it('proyecta la matriz a columnas (tallas) y filas (colores) con totales correctos', () => {
    const tabla = armarTablaRecibo([
      {
        idColor: 1,
        color: 'Rojo',
        pack: '',
        totalPiezas: 30,
        tallas: [
          { idTalla: 1, etiquetaTalla: 'CH', cantidad: 10 },
          { idTalla: 2, etiquetaTalla: 'M', cantidad: 20 },
        ],
      },
      {
        idColor: 2,
        color: 'Azul',
        pack: '',
        totalPiezas: 5,
        tallas: [{ idTalla: 2, etiquetaTalla: 'M', cantidad: 5 }],
      },
    ] as unknown as ReciboSalida['lineas']);

    expect(tabla.tallas).toEqual(['CH', 'M']);
    expect(tabla.renglones).toEqual([
      { color: 'Rojo', cantidades: [10, 20], totalFila: 30 },
      { color: 'Azul', cantidades: [0, 5], totalFila: 5 },
    ]);
    expect(tabla.totalesColumna).toEqual([10, 25]);
    expect(tabla.totalPiezas).toBe(35);
  });

  it('el PACK entra en la etiqueta de la fila (§Post-F9.10) y sin pack la fila no cambia', () => {
    const tabla = armarTablaRecibo([
      {
        idColor: 1,
        color: 'Rojo',
        pack: ' 2 ',
        totalPiezas: 10,
        tallas: [{ idTalla: 1, etiquetaTalla: 'CH', cantidad: 10 }],
      },
      {
        idColor: 1,
        color: 'Rojo',
        pack: '',
        totalPiezas: 4,
        tallas: [{ idTalla: 1, etiquetaTalla: 'CH', cantidad: 4 }],
      },
    ] as unknown as ReciboSalida['lineas']);

    expect(tabla.renglones.map((r) => r.color)).toEqual(['Rojo  ·  PACK 2', 'Rojo']);
  });

  it('matriz vacía → sin tallas, sin renglones, total 0', () => {
    const tabla = armarTablaRecibo([]);
    expect(tabla.tallas).toEqual([]);
    expect(tabla.renglones).toEqual([]);
    expect(tabla.totalPiezas).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// ⭐ 0.107 — EL RECIBO DE UN PROCESO DE ARTE LLEVA LA FOTO (la rama gemela de la 0.094)
// ════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * PNG 2×2 válidos y **DISTINTOS entre sí**: react-pdf DEDUPLICA imágenes idénticas en un solo
 * XObject, así que con una sola foto repetida cuatro veces el PDF traería UNA imagen y la prueba
 * de "entraron 4" pasaría por construcción. Cada color es un objeto distinto en el PDF.
 */
const PNGS = [
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP4z8AARAwQCgAf7gP9i18U1AAAAABJRU5ErkJggg==',
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAD0lEQVR4nGNg+M8AQhAKABvyA/1tVLjHAAAAAElFTkSuQmCC',
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAD0lEQVR4nGNgYPgPRmAKABf2A/1+6zfzAAAAAElFTkSuQmCC',
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP4/58BiBggFAA70gf5zW9MuAAAAABJRU5ErkJggg==',
] as const;
const PNG = PNGS[0];

const SESION = {
  id: 'u1',
  username: 'piso',
  nombre: 'Piso',
  idEmpresaActiva: 1,
  nombreEmpresaActiva: 'FR Moda',
  permisos: new Set(['produccion.wip-ver']),
} as unknown as SesionUsuario;

/**
 * Recibo mínimo (los campos que el impreso lee; el resto no participa). Por omisión es un recibo de
 * ARTE: `generaEntradaPt: false`, que es exactamente lo que lo hace de arte.
 */
function reciboSalida(over: Partial<ReciboSalida> = {}): ReciboSalida {
  return {
    id: 12,
    folio: 33,
    idEmpresa: 1,
    idOrden: 99,
    folioOrden: 42,
    idTipoProceso: 3,
    tipoProceso: 'Estampado',
    generaEntradaPt: false,
    idTercero: 8,
    tercero: 'Serigrafía del Norte',
    idEtapaEnvio: 5,
    idAlmacenPrimeras: null,
    almacenPrimeras: null,
    idAlmacenSegundas: null,
    almacenSegundas: null,
    fecha: '2026-06-25',
    precioPactado: 12.5,
    observaciones: 'Volvió completo',
    cancelado: false,
    lineas: [
      {
        idColor: 1,
        color: 'Rojo',
        pack: '',
        totalPiezas: 30,
        totalIncompletas: 0,
        tallas: [{ idTalla: 1, etiquetaTalla: 'CH', cantidad: 30 }],
      },
    ],
    totalPiezas: 30,
    totalPrimeras: 28,
    totalSegundas: 2,
    totalIncompletas: 0,
    ...over,
  } as unknown as ReciboSalida;
}

const foto = (titulo: string, key: string, principal = false): FotoArteDeLaOrden => ({
  titulo,
  key,
  principal,
});

/**
 * Servicio de archivos que presigna cada key como una URL derivada de ella. Devuelve el espía
 * SUELTO además del servicio: leerlo como `archivos.urlDescarga` sería pasar un método sin ligar
 * (`@typescript-eslint/unbound-method`), y las pruebas necesitan contarle las llamadas.
 */
function archivosFake(fallanKeys: string[] = []): {
  servicio: ServicioArchivos;
  urlDescarga: ReturnType<typeof vi.fn>;
} {
  const urlDescarga = vi.fn((key: string) =>
    fallanKeys.includes(key)
      ? Promise.reject(new Error(`R2 rechazó ${key}`))
      : Promise.resolve(`https://r2/${key}`),
  );
  return { servicio: { urlDescarga } as unknown as ServicioArchivos, urlDescarga };
}

/**
 * 🔑 EL CRITERIO, probado sin renderizar: qué recibo es "de arte". Es el mismo que usa la pantalla
 * (`esCostura = TipoProceso.generaEntradaPt`), no uno nuevo — que era justo lo que había que evitar
 * para que los dos papeles del proveedor de arte no volvieran a separarse.
 */
describe('esReciboDeArte — quién lleva la foto', () => {
  it('un proceso que NO mete a inventario PT (estampado, bordado, lavado) SÍ es de arte', () => {
    expect(esReciboDeArte({ generaEntradaPt: false })).toBe(true);
  });

  it('la COSTURA no: es la que crea el producto terminado', () => {
    expect(esReciboDeArte({ generaEntradaPt: true })).toBe(false);
  });
});

describe('armarDatosImpresoRecibo — las fotos del arte llegan al recibo (0.107)', () => {
  it('trae las fotos que manda la OP, con su rótulo, en el orden en que llegan', async () => {
    const descargarImagen = vi.fn((url: string) => Promise.resolve(`${PNG}#${url}`));
    const datos = await armarDatosImpresoRecibo(SESION, 12, undefined, {
      obtenerRecibo: vi.fn(() => Promise.resolve(reciboSalida())),
      leerFotosArte: vi.fn(() =>
        Promise.resolve([foto('Frente', 'k1', true), foto('Espalda', 'k2')]),
      ),
      archivos: archivosFake().servicio,
      descargarImagen,
    });

    expect(datos.fotosArte).toEqual([
      { titulo: 'Frente', dataUrl: `${PNG}#https://r2/k1` },
      { titulo: 'Espalda', dataUrl: `${PNG}#https://r2/k2` },
    ]);
    expect(datos.fotosArteOcultas).toBe(0);
    expect(descargarImagen).toHaveBeenCalledTimes(2);
    // Y el resto del papel sigue saliendo igual que antes de la 0.107.
    expect(datos.folio).toBe(33);
    expect(datos.totalPiezas).toBe(30);
    expect(datos.totalPrimeras).toBe(28);
  });

  it('🔑 las fotos se leen de la ORDEN del recibo y con la EMPRESA ACTIVA (A9)', async () => {
    const leerFotosArte = vi.fn(() => Promise.resolve([]));
    await armarDatosImpresoRecibo(SESION, 12, undefined, {
      obtenerRecibo: vi.fn(() => Promise.resolve(reciboSalida({ idOrden: 777 }))),
      leerFotosArte,
    });
    expect(leerFotosArte).toHaveBeenCalledWith(expect.anything(), 777, 1, {});
  });

  it('🔑 cada foto se baja CON el tope de peso (o un arte de 50 MB tumbaría el contenedor)', async () => {
    const descargarImagen = vi.fn(() => Promise.resolve(PNG));
    await armarDatosImpresoRecibo(SESION, 12, undefined, {
      obtenerRecibo: vi.fn(() => Promise.resolve(reciboSalida())),
      leerFotosArte: vi.fn(() => Promise.resolve([foto('Frente', 'k1')])),
      archivos: archivosFake().servicio,
      descargarImagen,
    });
    expect(descargarImagen).toHaveBeenCalledWith('https://r2/k1', MAX_BYTES_FOTO_ARTE);
  });

  it('🔑 una foto que NO se pudo bajar deja HUECO (dataUrl null) y las demás sí salen', async () => {
    const datos = await armarDatosImpresoRecibo(SESION, 12, undefined, {
      obtenerRecibo: vi.fn(() => Promise.resolve(reciboSalida())),
      leerFotosArte: vi.fn(() => Promise.resolve([foto('Frente', 'k1'), foto('Espalda', 'k2')])),
      archivos: archivosFake().servicio,
      descargarImagen: vi.fn((url: string) =>
        Promise.resolve(url.endsWith('k1') ? null : `${PNG}#ok`),
      ),
    });

    expect(datos.fotosArte).toEqual([
      { titulo: 'Frente', dataUrl: null },
      { titulo: 'Espalda', dataUrl: `${PNG}#ok` },
    ]);
  });

  it('🔑 si el PRESIGN de una key truena, esa sale como hueco y las demás siguen saliendo', async () => {
    const datos = await armarDatosImpresoRecibo(SESION, 12, undefined, {
      obtenerRecibo: vi.fn(() => Promise.resolve(reciboSalida())),
      leerFotosArte: vi.fn(() => Promise.resolve([foto('Frente', 'rota'), foto('Espalda', 'k2')])),
      archivos: archivosFake(['rota']).servicio,
      descargarImagen: vi.fn(() => Promise.resolve(PNG)),
    });

    expect(datos.fotosArte).toEqual([
      { titulo: 'Frente', dataUrl: null },
      { titulo: 'Espalda', dataUrl: PNG },
    ]);
  });

  it('🔑 LA GEMELA: una OP sin arte imprime NORMAL — ni fotos ni huecos, y sin tocar R2', async () => {
    const archivos = archivosFake();
    const descargarImagen = vi.fn(() => Promise.resolve(PNG));
    const datos = await armarDatosImpresoRecibo(SESION, 12, undefined, {
      obtenerRecibo: vi.fn(() => Promise.resolve(reciboSalida())),
      leerFotosArte: vi.fn(() => Promise.resolve([])),
      archivos: archivos.servicio,
      descargarImagen,
    });

    expect(datos.fotosArte).toEqual([]);
    expect(datos.fotosArteOcultas).toBe(0);
    expect(archivos.urlDescarga).not.toHaveBeenCalled();
    expect(descargarImagen).not.toHaveBeenCalled();
    expect(datos.folio).toBe(33);
  });

  it('🔑 si la LECTURA de las fotos truena, el recibo sale igual (sin arte) y no revienta', async () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const datos = await armarDatosImpresoRecibo(SESION, 12, undefined, {
      obtenerRecibo: vi.fn(() => Promise.resolve(reciboSalida())),
      leerFotosArte: vi.fn(() => Promise.reject(new Error('BD caída'))),
      archivos: archivosFake().servicio,
      descargarImagen: vi.fn(() => Promise.resolve(PNG)),
    });

    expect(datos.fotosArte).toEqual([]);
    expect(datos.folio).toBe(33);
    expect(datos.renglones).toHaveLength(1);
    // Y el aviso DICE de qué papel habla: sin eso hay que reproducir el caso para saberlo.
    expect(aviso).toHaveBeenCalledWith(
      expect.stringContaining('el recibo de maquila 12'),
      expect.anything(),
    );
    aviso.mockRestore();
  });

  it('🔑 el TOPE se aplica ANTES de tocar R2: 6 fotos → 4 presigns, 4 descargas y el resto contado', async () => {
    const archivos = archivosFake();
    const descargarImagen = vi.fn(() => Promise.resolve(PNG));
    const datos = await armarDatosImpresoRecibo(SESION, 12, undefined, {
      obtenerRecibo: vi.fn(() => Promise.resolve(reciboSalida())),
      leerFotosArte: vi.fn(() =>
        Promise.resolve([
          foto('A', 'k1', true),
          foto('B', 'k2'),
          foto('C', 'k3'),
          foto('D', 'k4'),
          foto('E', 'k5'),
          foto('F', 'k6'),
        ]),
      ),
      archivos: archivos.servicio,
      descargarImagen,
    });

    expect(datos.fotosArte).toHaveLength(MAX_FOTOS_ARTE);
    expect(datos.fotosArteOcultas).toBe(2);
    expect(datos.fotosArte.map((f) => f.titulo)).toEqual(['A', 'B', 'C', 'D']);
    expect(archivos.urlDescarga).toHaveBeenCalledTimes(MAX_FOTOS_ARTE);
    expect(descargarImagen).toHaveBeenCalledTimes(MAX_FOTOS_ARTE);
  });

  it('la foto PRINCIPAL nunca se recorta, aunque llegue en último lugar', async () => {
    const datos = await armarDatosImpresoRecibo(SESION, 12, undefined, {
      obtenerRecibo: vi.fn(() => Promise.resolve(reciboSalida())),
      leerFotosArte: vi.fn(() =>
        Promise.resolve([
          foto('A', 'k1'),
          foto('B', 'k2'),
          foto('C', 'k3'),
          foto('D', 'k4'),
          foto('LA BUENA', 'k5', true),
        ]),
      ),
      archivos: archivosFake().servicio,
      descargarImagen: vi.fn(() => Promise.resolve(PNG)),
    });

    expect(datos.fotosArte.map((f) => f.titulo)).toEqual(['LA BUENA', 'A', 'B', 'C']);
    expect(datos.fotosArteOcultas).toBe(1);
  });

  it('🔑 un recibo de ARTE que DEVUELVE DE TRÁNSITO (V1-E4b) también lleva su foto', async () => {
    const datos = await armarDatosImpresoRecibo(SESION, 12, undefined, {
      obtenerRecibo: vi.fn(() =>
        Promise.resolve(
          reciboSalida({
            generaEntradaPt: false,
            idAlmacenPrimeras: 4,
            almacenPrimeras: 'PT Central',
          }),
        ),
      ),
      leerFotosArte: vi.fn(() => Promise.resolve([foto('Frente', 'k1')])),
      archivos: archivosFake().servicio,
      descargarImagen: vi.fn(() => Promise.resolve(PNG)),
    });

    expect(datos.devuelveDeTransito).toBe(true);
    expect(datos.fotosArte).toEqual([{ titulo: 'Frente', dataUrl: PNG }]);
  });
});

describe('armarDatosImpresoRecibo — el recibo de COSTURA sigue exactamente como estaba', () => {
  it('🔑 no pregunta por fotos, no toca R2 y no baja nada', async () => {
    const archivos = archivosFake();
    const leerFotosArte = vi.fn(() => Promise.resolve([foto('Frente', 'k1')]));
    const descargarImagen = vi.fn(() => Promise.resolve(PNG));
    const datos = await armarDatosImpresoRecibo(SESION, 12, undefined, {
      obtenerRecibo: vi.fn(() =>
        Promise.resolve(
          reciboSalida({
            tipoProceso: 'Costura',
            generaEntradaPt: true,
            idAlmacenPrimeras: 4,
            almacenPrimeras: 'PT Central',
          }),
        ),
      ),
      leerFotosArte,
      archivos: archivos.servicio,
      descargarImagen,
    });

    expect(datos.fotosArte).toEqual([]);
    expect(datos.fotosArteOcultas).toBe(0);
    expect(leerFotosArte).not.toHaveBeenCalled();
    expect(archivos.urlDescarga).not.toHaveBeenCalled();
    expect(descargarImagen).not.toHaveBeenCalled();
    // El papel de costura sigue diciendo lo suyo.
    expect(datos.generaEntradaPt).toBe(true);
    expect(datos.almacenPrimeras).toBe('PT Central');
  });

  it('🔑 un recibo de COSTURA no construye `servicioArchivos()` (sin `archivos` inyectado)', async () => {
    // A propósito NO se inyecta `archivos`: en las pruebas unitarias no hay `R2_*` en el entorno,
    // así que si el código construyera `servicioArchivos()` en este camino, LANZARÍA y el recibo
    // se quedaría sin salir. Es la forma nueva de perder el papel que la 0.107 no debe estrenar.
    //
    // La premisa, dicha en voz alta: si un día el entorno trajera R2_*, esto avisa en vez de
    // degradarse en silencio a una prueba que ya no discrimina nada.
    expect(Object.keys(process.env).filter((k) => k.startsWith('R2_'))).toEqual([]);

    const datos = await armarDatosImpresoRecibo(SESION, 12, undefined, {
      obtenerRecibo: vi.fn(() =>
        Promise.resolve(reciboSalida({ tipoProceso: 'Costura', generaEntradaPt: true })),
      ),
    });

    expect(datos.fotosArte).toEqual([]);
    expect(datos.folio).toBe(33);
  });

  it('🔑 y un recibo de ARTE SIN fotos tampoco lo construye', async () => {
    expect(Object.keys(process.env).filter((k) => k.startsWith('R2_'))).toEqual([]);

    const datos = await armarDatosImpresoRecibo(SESION, 12, undefined, {
      obtenerRecibo: vi.fn(() => Promise.resolve(reciboSalida())),
      leerFotosArte: vi.fn(() => Promise.resolve([])),
    });

    expect(datos.fotosArte).toEqual([]);
    expect(datos.totalPiezas).toBe(30);
  });
});

/**
 * El bloque, sin renderizar. Aquí es donde se comprueba el ÚNICO texto que este papel no comparte
 * con la ficha: el PDF comprime sus flujos, así que sobre el Buffer una aserción de texto pasaría
 * siempre y no discriminaría nada.
 */
describe('bloqueArteRecibo — qué pinta el recibo y con qué aviso', () => {
  it('🔑 sin fotos NO pinta la sección (ni el título): el recibo de siempre', () => {
    expect(bloqueArteRecibo({ ...DATOS, fotosArte: [], fotosArteOcultas: 0 })).toBeNull();
  });

  it('con fotos pinta la sección, con el rótulo de cada arte', () => {
    const bloque = bloqueArteRecibo({
      ...DATOS,
      fotosArte: [{ titulo: 'Frente', dataUrl: PNG }],
    });
    expect(JSON.stringify(bloque)).toContain('Frente');
  });

  it('🔑 el HUECO dice PÍDELA ANTES DE DAR POR BUENO LO RECIBIDO — no "antes de producir"', () => {
    const pintado = JSON.stringify(
      bloqueArteRecibo({ ...DATOS, fotosArte: [{ titulo: 'Espalda', dataUrl: null }] }),
    );
    expect(pintado).toContain(AVISO_FOTO_FALTANTE.antesDeCotejar);
    // El arte ya se hizo: mandar a pedirla "antes de producir" sería mandar a un momento que pasó.
    expect(pintado).not.toContain(AVISO_FOTO_FALTANTE.antesDeProducir);
    // Y el hueco CONSERVA su rótulo: en el papel se lee de qué arte faltaba la imagen.
    expect(pintado).toContain('Espalda');
  });

  it('🔑 una foto que SÍ llegó no lleva ningún aviso de foto faltante', () => {
    const pintado = JSON.stringify(
      bloqueArteRecibo({ ...DATOS, fotosArte: [{ titulo: 'Frente', dataUrl: PNG }] }),
    );
    expect(pintado).not.toContain('no se pudo traer');
  });

  it('con recorte el TÍTULO dice cuántas se muestran del total', () => {
    const bloque = bloqueArteRecibo({
      ...DATOS,
      fotosArte: [
        { titulo: 'A', dataUrl: PNG },
        { titulo: 'B', dataUrl: PNG },
      ],
      fotosArteOcultas: 3,
    });
    expect(JSON.stringify(bloque)).toContain('se muestran 2 de 5');
  });

  it('sin recorte el título no habla de recorte', () => {
    const bloque = bloqueArteRecibo({
      ...DATOS,
      fotosArte: [{ titulo: 'A', dataUrl: PNG }],
    });
    expect(JSON.stringify(bloque)).toContain('Arte (imágenes)');
    expect(JSON.stringify(bloque)).not.toContain('se muestran');
  });
});

// ── El PDF de verdad ────────────────────────────────────────────────────────────────────────────

/**
 * Se cuentan los XObject de imagen que quedaron DENTRO del archivo. Es la única aserción que
 * distingue "la foto se incrustó" de "el bloque se armó y nadie lo pintó".
 *
 * ⚠️ El membrete de la empresa YA es una imagen del PDF, así que el conteo crudo nunca arranca en
 * cero y hay que restar una línea base. Esa línea base se mide contra el **DOCUMENTO DE ENVÍO**,
 * que por diseño no puede llevar arte — y NO contra un recibo sin fotos, que sería medir el mismo
 * documento contra sí mismo: `x − x === 0` pasa aunque el recibo pinte una imagen espuria, que es
 * justo el defecto que esta prueba dice vigilar.
 */
function imagenesEnPdf(buffer: Buffer): number {
  return (buffer.toString('latin1').match(/\/Subtype\s*\/Image/g) ?? []).length;
}

/** Páginas del PDF (para que el arte no empuje el recibo a una segunda hoja). */
function paginasEnPdf(buffer: Buffer): number {
  return (buffer.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
}

/** Datos mínimos del documento de ENVÍO: solo sirven de línea base del membrete. */
const ENVIO_BASE: DatosImpresoEnvio = {
  empresa: 'FR Moda SA de CV',
  folio: 7,
  fecha: '2026-06-19',
  fechaCompromiso: null,
  maquilero: 'Maquila Costura SA',
  proceso: 'Costura',
  folioOrden: 42,
  precioPactado: null,
  prendaTerminada: false,
  almacenOrigen: null,
  stockSinOrden: false,
  observaciones: null,
  cancelado: false,
  tallas: ['CH'],
  renglones: [{ color: 'Rojo', cantidades: [30], totalFila: 30 }],
  totalesColumna: [30],
  totalPiezas: 30,
};

const DATOS: DatosImpresoRecibo = {
  empresa: 'FR Moda SA de CV',
  folio: 33,
  fecha: '2026-06-25',
  maquilero: 'Serigrafía del Norte',
  proceso: 'Estampado',
  generaEntradaPt: false,
  devuelveDeTransito: false,
  almacenPrimeras: null,
  almacenSegundas: null,
  folioOrden: 42,
  precioPactado: 12.5,
  observaciones: 'Volvió completo',
  cancelado: false,
  tallas: ['CH', 'M'],
  renglones: [{ color: 'Rojo', cantidades: [10, 20], totalFila: 30 }],
  totalesColumna: [10, 20],
  totalPiezas: 30,
  totalPrimeras: 28,
  totalSegundas: 2,
  totalIncompletas: 0,
  fotosArte: [],
  fotosArteOcultas: 0,
};

describe('generarPdfRecibo — la foto entra de verdad en el PDF (0.107)', () => {
  /**
   * El recibo denso con el que se MIDIÓ la tarjeta: matriz de 6 colores × 4 tallas, banda de
   * cancelado, la línea de incompletas y ~500 caracteres de observaciones — **la misma densidad con
   * la que se midió la ficha** (`impreso-envio-maquila.test.ts`), para que la comparación entre los
   * dos papeles del proveedor de arte sea de manzanas con manzanas.
   */
  const denso: DatosImpresoRecibo = {
    ...DATOS,
    cancelado: true,
    observaciones: 'Devuelto con observaciones. '.repeat(18),
    tallas: ['CH', 'M', 'G', 'XG'],
    renglones: ['Rojo', 'Azul', 'Negro', 'Blanco', 'Verde', 'Gris'].map((color) => ({
      color,
      cantidades: [8, 12, 10, 4],
      totalFila: 34,
    })),
    totalesColumna: [48, 72, 60, 24],
    totalPiezas: 204,
    totalPrimeras: 200,
    totalSegundas: 4,
    totalIncompletas: 3,
  };
  let membrete = 0;

  beforeAll(async () => {
    membrete = imagenesEnPdf(await generarPdfEnvio(ENVIO_BASE));
  });

  it('el recibo genera un PDF no vacío', async () => {
    const buffer = await generarPdfRecibo(DATOS);
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 4).toString('latin1')).toBe('%PDF');
  });

  it('🔑 sin fotos el PDF no lleva NINGUNA imagen de arte (solo el membrete)', async () => {
    const buffer = await generarPdfRecibo(DATOS);
    expect(imagenesEnPdf(buffer) - membrete).toBe(0);
  });

  /**
   * 🔑 EL CAMINO COMPLETO DEL RECIBO DE COSTURA: se arman los datos DE VERDAD —con una lectura de
   * fotos que sí devolvería una— y con ESOS datos se genera el PDF.
   *
   * ⚠️ Es la única prueba de este bloque que ata las dos mitades, y tiene que serlo: `generarPdfRecibo`
   * **no consulta `generaEntradaPt`** — sólo pinta las `fotosArte` que le dan. Una aserción sobre
   * `{...DATOS, generaEntradaPt: true}` no discriminaría NADA (DATOS ya va sin fotos): pasaría igual
   * con el criterio invertido. Quien decide es `esReciboDeArte`, dentro de `armarDatosImpresoRecibo`,
   * así que la prueba tiene que arrancar ahí. MEDIDO: al invertir `esReciboDeArte`, esta foto acaba
   * incrustada en el PDF y la prueba cae.
   */
  it('🔑 un recibo de COSTURA sale sin imagen de arte — de los datos al PDF', async () => {
    const datos = await armarDatosImpresoRecibo(SESION, 12, undefined, {
      obtenerRecibo: vi.fn(() =>
        Promise.resolve(reciboSalida({ tipoProceso: 'Costura', generaEntradaPt: true })),
      ),
      leerFotosArte: vi.fn(() => Promise.resolve([foto('Frente', 'k1')])),
      archivos: archivosFake().servicio,
      descargarImagen: vi.fn(() => Promise.resolve(PNGS[0])),
    });

    expect(datos.fotosArte).toEqual([]);
    const buffer = await generarPdfRecibo(datos);
    expect(imagenesEnPdf(buffer) - membrete).toBe(0);
  });

  it('🔑 con 2 fotos el PDF lleva 2 imágenes de arte', async () => {
    const buffer = await generarPdfRecibo({
      ...DATOS,
      fotosArte: [
        { titulo: 'Frente', dataUrl: PNGS[0] },
        { titulo: 'Espalda', dataUrl: PNGS[1] },
      ],
    });
    expect(imagenesEnPdf(buffer) - membrete).toBe(2);
  });

  it('🔑 un HUECO no incrusta imagen pero el PDF SALE IGUAL, con la foto buena dentro', async () => {
    const buffer = await generarPdfRecibo({
      ...DATOS,
      fotosArte: [
        { titulo: 'Frente', dataUrl: null },
        { titulo: 'Espalda', dataUrl: PNGS[1] },
      ],
    });
    expect(buffer.subarray(0, 4).toString('latin1')).toBe('%PDF');
    expect(imagenesEnPdf(buffer) - membrete).toBe(1);
  });

  it('con TODAS las fotos caídas el PDF sale igual, sin una sola imagen de arte', async () => {
    const buffer = await generarPdfRecibo({
      ...DATOS,
      fotosArte: [
        { titulo: 'Frente', dataUrl: null },
        { titulo: 'Espalda', dataUrl: null },
      ],
    });
    expect(buffer.subarray(0, 4).toString('latin1')).toBe('%PDF');
    expect(imagenesEnPdf(buffer) - membrete).toBe(0);
  });

  it('🔑 un recibo DENSO con 4 fotos sigue cabiendo en UNA hoja', async () => {
    const buffer = await generarPdfRecibo({
      ...denso,
      fotosArte: PNGS.map((dataUrl, i) => ({ titulo: `Arte ${String(i)}`, dataUrl })),
    });
    expect(paginasEnPdf(buffer)).toBe(1);
    expect(imagenesEnPdf(buffer) - membrete).toBe(4);
  });

  it('🔑 y un recibo DENSO con 4 HUECOS también (el hueco mide lo mismo que la foto)', async () => {
    const buffer = await generarPdfRecibo({
      ...denso,
      fotosArte: ['A', 'B', 'C', 'D'].map((titulo) => ({ titulo, dataUrl: null })),
    });
    expect(paginasEnPdf(buffer)).toBe(1);
    expect(imagenesEnPdf(buffer) - membrete).toBe(0);
  });

  it('🔑 con 2 fotos —el caso de todos los días— también, con la tarjeta GRANDE', async () => {
    const buffer = await generarPdfRecibo({
      ...denso,
      fotosArte: [
        { titulo: 'Frente', dataUrl: PNGS[0] },
        { titulo: 'Espalda', dataUrl: PNGS[1] },
      ],
    });
    expect(paginasEnPdf(buffer)).toBe(1);
    expect(imagenesEnPdf(buffer) - membrete).toBe(2);
  });

  /**
   * 🔑 EL ARTE VA ARRIBA, ANTES DE LAS CANTIDADES. Es la decisión que declara `paginaRecibo` —la
   * identidad del trabajo primero, las cantidades después, EN EL MISMO SITIO que en la ficha— y
   * hasta esta prueba no la medía nadie: intercambiar los dos bloques dejaba el archivo entero en
   * verde. Lo que hace gemelos a los dos papeles del proveedor de arte no es sólo QUÉ pintan, es
   * DÓNDE, y eso hay que fijarlo o se separa sin que nadie lo note (la ficha tiene su gemela en
   * `impreso-envio-maquila.test.ts`).
   *
   * ⚠️ Se mide sobre el TEXTO del PDF, no sobre el Buffer: los flujos van COMPRIMIDOS, así que
   * buscar el rótulo en los bytes crudos no lo encontraría nunca y la prueba pasaría por
   * construcción. Los títulos salen en MAYÚSCULAS porque `TituloSeccion` lleva `textTransform`.
   */
  it('🔑 el arte se pinta ARRIBA, antes de las cantidades (el mismo sitio que en la ficha)', async () => {
    const buffer = await generarPdfRecibo({
      ...DATOS,
      fotosArte: [{ titulo: 'Frente', dataUrl: PNGS[0] }],
    });
    const texto = (await extraerTextoPdf(buffer)).join('\n');
    const arte = texto.indexOf('ARTE (IMÁGENES)');
    const cantidades = texto.indexOf('CANTIDADES RECIBIDAS');
    // Que los dos rótulos ESTÉN: si un cambio de texto los dejara fuera, dos `-1` compararían
    // iguales y la prueba se volvería un verde vacío.
    expect(arte).toBeGreaterThanOrEqual(0);
    expect(cantidades).toBeGreaterThanOrEqual(0);
    expect(arte).toBeLessThan(cantidades);
  });
});
