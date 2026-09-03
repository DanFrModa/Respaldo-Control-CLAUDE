/**
 * Tests UNITARIOS de los impresos de envío a maquila (F3-E2) y de la FICHA DE ARTE (0.094). No
 * tocan BD ni red: prueban el armado de la tabla color×talla, la resolución de las fotos del arte
 * (con lecturas/R2/descargas inyectadas) y la generación del PDF con datos ya resueltos.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { ServicioArchivos } from '../../../comun/archivos.js';
import type { SesionUsuario } from '../../../comun/permisos.js';
import type { EtapaSalida } from '../../../contrato/index.js';
import type { FotoArteDeLaOrden } from './imagenes-impreso.js';

import {
  armarDatosImpresoEnvio,
  armarDatosImpresoFichaArte,
  altoDeLaTarjeta,
  armarTablaEtapa,
  bloqueArteFicha,
  generarPdfEnvio,
  generarPdfFichaEstampado,
  queSeEntrega,
  recortarFotosArte,
  MAX_BYTES_FOTO_ARTE,
  MAX_FOTOS_FICHA_ARTE,
  type DatosImpresoEnvio,
  type DatosImpresoFichaArte,
} from './impreso-envio-maquila.js';

describe('armarTablaEtapa (F3-E2)', () => {
  it('proyecta la matriz a columnas (tallas) y filas (colores) con totales correctos', () => {
    const tabla = armarTablaEtapa([
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
    ]);

    expect(tabla.tallas).toEqual(['CH', 'M']);
    expect(tabla.renglones).toEqual([
      { color: 'Rojo', cantidades: [10, 20], totalFila: 30 },
      { color: 'Azul', cantidades: [0, 5], totalFila: 5 },
    ]);
    expect(tabla.totalesColumna).toEqual([10, 25]);
    expect(tabla.totalPiezas).toBe(35);
  });

  it('matriz vacía → sin tallas, sin renglones, total 0', () => {
    const tabla = armarTablaEtapa([]);
    expect(tabla.tallas).toEqual([]);
    expect(tabla.renglones).toEqual([]);
    expect(tabla.totalPiezas).toBe(0);
  });
});

const DATOS: DatosImpresoEnvio = {
  empresa: 'FR Moda SA de CV',
  folio: 7,
  fecha: '2026-06-19',
  fechaCompromiso: '2026-06-26',
  maquilero: 'Maquila Costura SA',
  proceso: 'Costura',
  folioOrden: 42,
  precioPactado: 12.5,
  prendaTerminada: false,
  almacenOrigen: null,
  stockSinOrden: false,
  observaciones: 'Coser con hilo rojo',
  cancelado: false,
  tallas: ['CH', 'M'],
  renglones: [{ color: 'Rojo', cantidades: [10, 20], totalFila: 30 }],
  totalesColumna: [10, 20],
  totalPiezas: 30,
};

describe('generación de PDFs (F3-E2)', () => {
  it('el documento de envío genera un PDF no vacío', async () => {
    const buffer = await generarPdfEnvio(DATOS);
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 4).toString('latin1')).toBe('%PDF');
  });

  it('la ficha de arte genera un PDF no vacío', async () => {
    const buffer = await generarPdfFichaEstampado({
      ...DATOS,
      proceso: 'Estampado',
      fotosArte: [],
      fotosArteOcultas: 0,
    });
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 4).toString('latin1')).toBe('%PDF');
  });
});

/**
 * V1-E4b — el papel que FIRMA el maquilero tiene que decir QUÉ se le entrega. No es cosmética: no
 * es lo mismo recibir bultos cortados que prendas ya terminadas (cambia lo que se le reclama si no
 * vuelven), y esas piezas salieron de un almacén concreto que también se imprime.
 */
describe('queSeEntrega — la declaración de prendas terminadas del impreso', () => {
  it('con bultos cortados no dice nada (el papel de siempre)', () => {
    expect(queSeEntrega({ ...DATOS, prendaTerminada: false })).toBeNull();
  });

  it('con prendas terminadas lo DICE y nombra el almacén del que salieron', () => {
    const texto = queSeEntrega({
      ...DATOS,
      prendaTerminada: true,
      almacenOrigen: 'Primeras',
      stockSinOrden: false,
    });
    expect(texto).toContain('PRENDAS YA TERMINADAS');
    expect(texto).toContain('Primeras');
    expect(texto).not.toContain('sin orden');
  });

  it('si salieron del stock sin orden asignada, también lo dice', () => {
    const texto = queSeEntrega({
      ...DATOS,
      prendaTerminada: true,
      almacenOrigen: 'Primeras',
      stockSinOrden: true,
    });
    expect(texto).toContain('PRENDAS YA TERMINADAS');
    expect(texto).toContain('stock sin orden asignada');
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// ⭐ 0.094 — LA FICHA DE ARTE LLEVA LA FOTO (Daniel, 2-sep-2026, §Post-F9.181(c))
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

/** Etapa de ENVÍO mínima (los campos que los impresos leen; el resto no participa). */
function etapaEnvio(over: Partial<EtapaSalida> = {}): EtapaSalida {
  return {
    id: 5,
    folio: 7,
    idEmpresa: 1,
    idOrden: 99,
    folioOrden: 42,
    tipo: 'envio_maquila',
    tipoProceso: 'Estampado',
    tercero: 'Serigrafía del Norte',
    fecha: '2026-06-19',
    fechaCompromiso: '2026-06-26',
    precioPactado: 12.5,
    prendaTerminada: false,
    almacenOrigen: null,
    stockSinOrden: false,
    observaciones: 'Estampar al centro',
    cancelado: false,
    lineas: [
      {
        idColor: 1,
        color: 'Rojo',
        pack: '',
        totalPiezas: 30,
        tallas: [{ idTalla: 1, etiquetaTalla: 'CH', cantidad: 30 }],
      },
    ],
    totalPiezas: 30,
    ...over,
  } as unknown as EtapaSalida;
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

describe('armarDatosImpresoFichaArte — las fotos del arte llegan a la ficha (0.094)', () => {
  it('trae las fotos que manda la OP, con su rótulo, en el orden en que llegan', async () => {
    const descargarImagen = vi.fn((url: string) => Promise.resolve(`${PNG}#${url}`));
    const datos = await armarDatosImpresoFichaArte(SESION, 5, undefined, {
      obtenerEtapa: vi.fn(() => Promise.resolve(etapaEnvio())),
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
  });

  it('🔑 cada foto se baja CON el tope de peso (o un arte de 50 MB tumbaría el contenedor)', async () => {
    const descargarImagen = vi.fn(() => Promise.resolve(PNG));
    await armarDatosImpresoFichaArte(SESION, 5, undefined, {
      obtenerEtapa: vi.fn(() => Promise.resolve(etapaEnvio())),
      leerFotosArte: vi.fn(() => Promise.resolve([foto('Frente', 'k1')])),
      archivos: archivosFake().servicio,
      descargarImagen,
    });
    expect(descargarImagen).toHaveBeenCalledWith('https://r2/k1', MAX_BYTES_FOTO_ARTE);
  });

  it('🔑 una foto que NO se pudo bajar deja HUECO (dataUrl null) y las demás sí salen', async () => {
    const datos = await armarDatosImpresoFichaArte(SESION, 5, undefined, {
      obtenerEtapa: vi.fn(() => Promise.resolve(etapaEnvio())),
      leerFotosArte: vi.fn(() => Promise.resolve([foto('Frente', 'k1'), foto('Espalda', 'k2')])),
      archivos: archivosFake().servicio,
      // La primera cae (R2 caído, objeto borrado…), la segunda no.
      descargarImagen: vi.fn((url: string) =>
        Promise.resolve(url.endsWith('k1') ? null : `${PNG}#ok`),
      ),
    });

    expect(datos.fotosArte).toEqual([
      { titulo: 'Frente', dataUrl: null },
      { titulo: 'Espalda', dataUrl: `${PNG}#ok` },
    ]);
    // El hueco CONSERVA su rótulo: en el papel se lee de qué arte faltaba la imagen.
    expect(datos.fotosArte[0]?.titulo).toBe('Frente');
  });

  it('🔑 si el PRESIGN de una key truena, esa sale como hueco y las demás siguen saliendo', async () => {
    const datos = await armarDatosImpresoFichaArte(SESION, 5, undefined, {
      obtenerEtapa: vi.fn(() => Promise.resolve(etapaEnvio())),
      leerFotosArte: vi.fn(() => Promise.resolve([foto('Frente', 'rota'), foto('Espalda', 'k2')])),
      archivos: archivosFake(['rota']).servicio,
      descargarImagen: vi.fn(() => Promise.resolve(PNG)),
    });

    expect(datos.fotosArte).toEqual([
      { titulo: 'Frente', dataUrl: null },
      { titulo: 'Espalda', dataUrl: PNG },
    ]);
  });

  it('🔑 LA GEMELA: una OP sin arte imprime NORMAL — ni fotos ni huecos', async () => {
    const archivos = archivosFake();
    const descargarImagen = vi.fn(() => Promise.resolve(PNG));
    const datos = await armarDatosImpresoFichaArte(SESION, 5, undefined, {
      obtenerEtapa: vi.fn(() => Promise.resolve(etapaEnvio())),
      leerFotosArte: vi.fn(() => Promise.resolve([])),
      archivos: archivos.servicio,
      descargarImagen,
    });

    expect(datos.fotosArte).toEqual([]);
    expect(datos.fotosArteOcultas).toBe(0);
    // Y no se toca R2 ni la red por una orden que no tiene arte.
    expect(archivos.urlDescarga).not.toHaveBeenCalled();
    expect(descargarImagen).not.toHaveBeenCalled();
    // El resto del papel sale íntegro.
    expect(datos.folio).toBe(7);
    expect(datos.totalPiezas).toBe(30);
  });

  it('🔑 una OP SIN ARTE no toca R2 NI PARA CONSTRUIR EL SERVICIO (sin `archivos` inyectado)', async () => {
    // A propósito NO se inyecta `archivos`: en las pruebas unitarias no hay `R2_*` en el entorno,
    // así que si el código construyera `servicioArchivos()` en este camino, LANZARÍA y la ficha se
    // quedaría sin salir. Es la forma nueva de perder el papel que la 0.094 no debe estrenar.
    //
    // La premisa de esta prueba, dicha en voz alta: si un día el entorno trajera R2_*, esto
    // avisa en vez de degradarse en silencio a una prueba que ya no discrimina nada.
    expect(Object.keys(process.env).filter((k) => k.startsWith('R2_'))).toEqual([]);

    const datos = await armarDatosImpresoFichaArte(SESION, 5, undefined, {
      obtenerEtapa: vi.fn(() => Promise.resolve(etapaEnvio())),
      leerFotosArte: vi.fn(() => Promise.resolve([])),
      descargarImagen: vi.fn(() => Promise.resolve(PNG)),
    });

    expect(datos.fotosArte).toEqual([]);
    expect(datos.fotosArteOcultas).toBe(0);
    expect(datos.folio).toBe(7);
    expect(datos.totalPiezas).toBe(30);
  });

  it('🔑 si la LECTURA de las fotos truena, la ficha sale igual (sin arte) y no revienta', async () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const datos = await armarDatosImpresoFichaArte(SESION, 5, undefined, {
      obtenerEtapa: vi.fn(() => Promise.resolve(etapaEnvio())),
      leerFotosArte: vi.fn(() => Promise.reject(new Error('BD caída'))),
      archivos: archivosFake().servicio,
      descargarImagen: vi.fn(() => Promise.resolve(PNG)),
    });

    expect(datos.fotosArte).toEqual([]);
    expect(datos.folio).toBe(7);
    expect(datos.renglones).toHaveLength(1);
    expect(aviso).toHaveBeenCalled();
    aviso.mockRestore();
  });

  it('🔑 el TOPE se aplica ANTES de tocar R2: 6 fotos → 4 presigns, 4 descargas y el resto contado', async () => {
    const archivos = archivosFake();
    const descargarImagen = vi.fn(() => Promise.resolve(PNG));
    const datos = await armarDatosImpresoFichaArte(SESION, 5, undefined, {
      obtenerEtapa: vi.fn(() => Promise.resolve(etapaEnvio())),
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

    expect(datos.fotosArte).toHaveLength(MAX_FOTOS_FICHA_ARTE);
    expect(datos.fotosArteOcultas).toBe(2);
    expect(datos.fotosArte.map((f) => f.titulo)).toEqual(['A', 'B', 'C', 'D']);
    // Lo que de verdad acota el trabajo: nunca se presignan ni se bajan las recortadas.
    expect(archivos.urlDescarga).toHaveBeenCalledTimes(MAX_FOTOS_FICHA_ARTE);
    expect(descargarImagen).toHaveBeenCalledTimes(MAX_FOTOS_FICHA_ARTE);
  });

  it('la foto PRINCIPAL nunca se recorta, aunque llegue en último lugar', async () => {
    const datos = await armarDatosImpresoFichaArte(SESION, 5, undefined, {
      obtenerEtapa: vi.fn(() => Promise.resolve(etapaEnvio())),
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

  it('🔑 el DOCUMENTO DE ENVÍO no carga con las fotos (solo la ficha las lleva)', async () => {
    // Sus dependencias (`DepsImpresoEnvio`) ni siquiera admiten un servicio de archivos: la única
    // prueba que distingue los dos mundos es que el resultado NO traiga el campo.
    const datos = await armarDatosImpresoEnvio(SESION, 5, undefined, {
      obtenerEtapa: vi.fn(() => Promise.resolve(etapaEnvio())),
    });

    expect(datos).not.toHaveProperty('fotosArte');
    expect(datos).not.toHaveProperty('fotosArteOcultas');
  });

  it('una etapa que NO es envío sigue rechazándose (la ficha no cambia esa regla)', async () => {
    await expect(
      armarDatosImpresoFichaArte(SESION, 5, undefined, {
        obtenerEtapa: vi.fn(() => Promise.resolve(etapaEnvio({ tipo: 'corte' }))),
      }),
    ).rejects.toThrow(/envío a maquila/);
  });
});

describe('recortarFotosArte — el criterio del tope, sin renderizar', () => {
  it('por debajo del tope no recorta nada', () => {
    const r = recortarFotosArte([foto('A', 'k1'), foto('B', 'k2')]);
    expect(r.mostradas.map((f) => f.titulo)).toEqual(['A', 'B']);
    expect(r.ocultas).toBe(0);
  });

  it('por encima del tope corta y CUENTA lo que quedó fuera', () => {
    const r = recortarFotosArte([
      foto('A', 'k1'),
      foto('B', 'k2'),
      foto('C', 'k3'),
      foto('D', 'k4'),
      foto('E', 'k5'),
    ]);
    expect(r.mostradas).toHaveLength(MAX_FOTOS_FICHA_ARTE);
    expect(r.ocultas).toBe(1);
  });
});

describe('bloqueArteFicha — qué se pinta y qué no', () => {
  const base: DatosImpresoFichaArte = { ...DATOS, fotosArte: [], fotosArteOcultas: 0 };

  it('🔑 sin fotos NO pinta la sección (ni el título): la ficha de siempre', () => {
    expect(bloqueArteFicha(base)).toBeNull();
  });

  it('con fotos pinta la sección', () => {
    const bloque = bloqueArteFicha({ ...base, fotosArte: [{ titulo: 'Frente', dataUrl: PNG }] });
    expect(bloque).not.toBeNull();
    expect(JSON.stringify(bloque)).toContain('Frente');
  });

  it('🔑 una foto que SÍ llegó no lleva el aviso de foto faltante', () => {
    const bloque = bloqueArteFicha({ ...base, fotosArte: [{ titulo: 'Frente', dataUrl: PNG }] });
    expect(JSON.stringify(bloque)).not.toContain('no se pudo traer');
  });

  it('🔑 una foto que NO llegó pinta el HUECO y LO DICE, con el rótulo de su arte', () => {
    const bloque = bloqueArteFicha({ ...base, fotosArte: [{ titulo: 'Espalda', dataUrl: null }] });
    const pintado = JSON.stringify(bloque);
    expect(pintado).toContain('no se pudo traer');
    expect(pintado).toContain('Espalda');
  });

  it('sin recorte el título no habla de recorte', () => {
    const bloque = bloqueArteFicha({ ...base, fotosArte: [{ titulo: 'Frente', dataUrl: PNG }] });
    expect(JSON.stringify(bloque)).toContain('Arte (imágenes)');
    expect(JSON.stringify(bloque)).not.toContain('se muestran');
  });

  it('con recorte el TÍTULO dice cuántas se muestran del total', () => {
    const bloque = bloqueArteFicha({
      ...base,
      fotosArte: [
        { titulo: 'A', dataUrl: PNG },
        { titulo: 'B', dataUrl: PNG },
        { titulo: 'C', dataUrl: PNG },
        { titulo: 'D', dataUrl: PNG },
      ],
      fotosArteOcultas: 3,
    });
    expect(JSON.stringify(bloque)).toContain('se muestran 4 de 7');
  });
});

/**
 * El PDF de verdad: se cuentan los XObject de imagen que quedaron DENTRO del archivo. Es la única
 * aserción que distingue "la foto se incrustó" de "el bloque se armó y nadie lo pintó".
 *
 * ⚠️ El membrete de la empresa YA es una imagen del PDF, así que el conteo crudo nunca arranca en
 * cero y hay que restar una línea base. Esa línea base se mide contra el **DOCUMENTO DE ENVÍO**,
 * que por diseño no puede llevar arte — y NO contra una ficha sin fotos, que era medir el mismo
 * documento contra sí mismo: `x − x === 0` pasa aunque la ficha pinte una imagen espuria, que es
 * justo el defecto que la prueba dice vigilar.
 */
function imagenesEnPdf(buffer: Buffer): number {
  return (buffer.toString('latin1').match(/\/Subtype\s*\/Image/g) ?? []).length;
}

/** Páginas del PDF (para que el arte no empuje la ficha a una segunda hoja). */
function paginasEnPdf(buffer: Buffer): number {
  return (buffer.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
}

describe('altoDeLaTarjeta — el tamaño MEDIDO contra la hoja', () => {
  it('una sola fila (1 o 2 fotos) se lleva la tarjeta grande', () => {
    expect(altoDeLaTarjeta(1)).toBe(190);
    expect(altoDeLaTarjeta(2)).toBe(190);
  });

  it('dos filas (3 o 4 fotos) bajan a la tarjeta que sí cabe', () => {
    expect(altoDeLaTarjeta(3)).toBe(125);
    expect(altoDeLaTarjeta(4)).toBe(125);
  });
});

describe('generarPdfFichaEstampado — la foto entra de verdad en el PDF (0.094)', () => {
  const base: DatosImpresoFichaArte = { ...DATOS, fotosArte: [], fotosArteOcultas: 0 };
  /** La ficha más pesada que se puede dar: matriz de 6 colores, obs. largas y banda de cancelado. */
  const densa: DatosImpresoFichaArte = {
    ...base,
    cancelado: true,
    observaciones: 'Estampar al centro. '.repeat(25),
    tallas: ['CH', 'M', 'G', 'XG'],
    renglones: ['Rojo', 'Azul', 'Negro', 'Blanco', 'Verde', 'Gris'].map((color) => ({
      color,
      cantidades: [8, 12, 10, 4],
      totalFila: 34,
    })),
    totalesColumna: [48, 72, 60, 24],
    totalPiezas: 204,
  };
  let membrete = 0;

  beforeAll(async () => {
    // Documento DISTINTO (el envío nunca lleva fotos): así la resta compara dos mundos, no uno
    // consigo mismo. Ambos comparten el mismo membrete, que es lo único que se quiere descontar.
    membrete = imagenesEnPdf(await generarPdfEnvio(base));
  });

  it('🔑 sin fotos el PDF no lleva NINGUNA imagen de arte (solo el membrete)', async () => {
    const buffer = await generarPdfFichaEstampado(base);
    expect(buffer.subarray(0, 4).toString('latin1')).toBe('%PDF');
    expect(imagenesEnPdf(buffer) - membrete).toBe(0);
  });

  it('🔑 con 2 fotos el PDF lleva 2 imágenes de arte', async () => {
    const buffer = await generarPdfFichaEstampado({
      ...base,
      fotosArte: [
        { titulo: 'Frente', dataUrl: PNGS[0] },
        { titulo: 'Espalda', dataUrl: PNGS[1] },
      ],
    });
    expect(imagenesEnPdf(buffer) - membrete).toBe(2);
  });

  it('🔑 un HUECO no incrusta imagen pero el PDF SALE IGUAL, con la foto buena dentro', async () => {
    const buffer = await generarPdfFichaEstampado({
      ...base,
      fotosArte: [
        { titulo: 'Frente', dataUrl: null },
        { titulo: 'Espalda', dataUrl: PNGS[1] },
      ],
    });
    expect(buffer.subarray(0, 4).toString('latin1')).toBe('%PDF');
    expect(imagenesEnPdf(buffer) - membrete).toBe(1);
  });

  it('con TODAS las fotos caídas el PDF sale igual, sin una sola imagen de arte', async () => {
    const buffer = await generarPdfFichaEstampado({
      ...base,
      fotosArte: [
        { titulo: 'Frente', dataUrl: null },
        { titulo: 'Espalda', dataUrl: null },
      ],
    });
    expect(buffer.subarray(0, 4).toString('latin1')).toBe('%PDF');
    expect(imagenesEnPdf(buffer) - membrete).toBe(0);
  });

  it('🔑 y una ficha DENSA con 4 HUECOS también cabe en una hoja (el hueco mide lo mismo)', async () => {
    const buffer = await generarPdfFichaEstampado({
      ...densa,
      fotosArte: ['A', 'B', 'C', 'D'].map((titulo) => ({ titulo, dataUrl: null })),
    });
    expect(paginasEnPdf(buffer)).toBe(1);
    expect(imagenesEnPdf(buffer) - membrete).toBe(0);
  });

  it('🔑 la ficha MÁS DENSA con 4 fotos sigue cabiendo en UNA hoja', async () => {
    const buffer = await generarPdfFichaEstampado({
      ...densa,
      fotosArte: PNGS.map((dataUrl, i) => ({ titulo: `Arte ${String(i)}`, dataUrl })),
    });
    expect(paginasEnPdf(buffer)).toBe(1);
    expect(imagenesEnPdf(buffer) - membrete).toBe(4);
  });

  it('🔑 y con 2 fotos —el caso de todos los días— también, con la tarjeta GRANDE', async () => {
    const buffer = await generarPdfFichaEstampado({
      ...densa,
      fotosArte: [
        { titulo: 'Frente', dataUrl: PNGS[0] },
        { titulo: 'Espalda', dataUrl: PNGS[1] },
      ],
    });
    expect(paginasEnPdf(buffer)).toBe(1);
    expect(imagenesEnPdf(buffer) - membrete).toBe(2);
  });
});
