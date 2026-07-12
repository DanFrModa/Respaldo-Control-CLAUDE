/**
 * Pruebas unitarias del impreso de la orden (F2-E4, R9). No tocan BD ni R2: ejercitan
 *  • `armarTabla` — la proyección de la matriz a tabla color × talla con totales (deben CUADRAR).
 *  • `generarPdfOrden` / `generarPdfOrdenes` — que devuelven un Buffer PDF real (cabecera `%PDF`),
 *    incluso con matriz grande, orden cancelada o sin fotos (degradación elegante).
 *  • `armarDatosImpresoOrden` — reúsa `obtenerOrden`/`leerBom`/`leerFotosModelo` (inyectados), filtra
 *    `paraProduccion`, excluye precios y descarta fotos no descargables (best-effort).
 *  • `descargarImagenComoDataUrl` — best-effort (un fallo de red → `null`, no truena).
 */
import { describe, expect, it, vi } from 'vitest';

import { ErrorNoEncontrado } from '../../../comun/errores.js';
import type { ServicioArchivos } from '../../../comun/archivos.js';
import type { SesionUsuario } from '../../../comun/permisos.js';
import type { OrdenSalida } from '../../../contrato/index.js';
import type { BomModelo } from '../../modelos/bom-modelo.js';
import type { FotoModeloConUrl } from '../../modelos/fotos-modelo.js';

import {
  armarDatosImpresoOrden,
  armarTabla,
  descargarImagenComoDataUrl,
  generarPdfOrden,
  generarPdfOrdenes,
  type DatosImpresoOrden,
  type DepsImpreso,
} from './impreso-orden.js';

/** Servicio de archivos inocuo (los tests inyectan `listarFotos`, que es quien lo usaría). */
const archivosFake = {
  solicitarSubida: vi.fn(),
  urlDescarga: vi.fn(() => Promise.resolve('https://r2/x')),
} as unknown as ServicioArchivos;

/** Sesión de prueba con el permiso `ordenes.ver`. */
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

/** Construye unos datos de impreso mínimos, con overrides puntuales. */
function datosBase(over: Partial<DatosImpresoOrden> = {}): DatosImpresoOrden {
  const tabla = armarTabla([
    {
      color: 'Rojo',
      tallas: [
        { etiquetaTalla: 'CH', cantidad: 3 },
        { etiquetaTalla: 'M', cantidad: 5 },
      ],
    },
    {
      color: 'Azul',
      tallas: [
        { etiquetaTalla: 'M', cantidad: 2 },
        { etiquetaTalla: 'G', cantidad: 4 },
      ],
    },
  ]);
  return {
    empresa: 'FR Moda',
    folio: 1234,
    estado: 'completa',
    motivoCancelada: null,
    fecha: '2026-06-16',
    fechaEntrega: '2026-06-30',
    cliente: 'Cliente Demo',
    pedidoCliente: '620884',
    etiquetaMarca: 'Marilyn',
    maquilero: 'Maquila Norte',
    codigoModelo: 'MOD-501',
    descripcionModelo: 'Playera básica',
    composicion: '95% algodón 5% elastano',
    observaciones: 'Cuidar el tono.',
    obsMaquila: 'Doble costura.',
    ...tabla,
    telas: [{ nombre: 'Jersey', consumoPorPrenda: 0.4 }],
    bordados: [{ nombre: 'Logo pecho', tipo: 'BORDADO' }],
    habilitacion: [{ clave: 'AV-1', descripcion: 'Hilo', consumoPorPrenda: 1 }],
    fotos: [],
    ...over,
  };
}

/** ¿El Buffer empieza con la firma de un PDF? */
function esPdf(buffer: Buffer): boolean {
  return buffer.length > 0 && buffer.subarray(0, 5).toString('latin1') === '%PDF-';
}

describe('armarTabla', () => {
  it('proyecta colores × tallas con totales por fila/columna y total general que cuadra', () => {
    const tabla = armarTabla([
      {
        color: 'Rojo',
        tallas: [
          { etiquetaTalla: 'CH', cantidad: 3 },
          { etiquetaTalla: 'M', cantidad: 5 },
        ],
      },
      {
        color: 'Azul',
        tallas: [
          { etiquetaTalla: 'M', cantidad: 2 },
          { etiquetaTalla: 'G', cantidad: 4 },
        ],
      },
    ]);

    // Columnas en orden de primera aparición.
    expect(tabla.tallas).toEqual(['CH', 'M', 'G']);
    // Renglón Rojo: CH=3, M=5, G=0 → 8.
    expect(tabla.renglones[0]).toEqual({
      color: 'Rojo',
      pantone: null,
      cantidades: [3, 5, 0],
      totalFila: 8,
    });
    // Renglón Azul: CH=0, M=2, G=4 → 6.
    expect(tabla.renglones[1]).toEqual({
      color: 'Azul',
      pantone: null,
      cantidades: [0, 2, 4],
      totalFila: 6,
    });
    // Totales por columna y total general.
    expect(tabla.totalesColumna).toEqual([3, 7, 4]);
    expect(tabla.totalPiezas).toBe(14);

    // El total general cuadra con la suma de filas y la suma de columnas.
    const sumaFilas = tabla.renglones.reduce((s, r) => s + r.totalFila, 0);
    const sumaColumnas = tabla.totalesColumna.reduce((s, c) => s + c, 0);
    expect(sumaFilas).toBe(tabla.totalPiezas);
    expect(sumaColumnas).toBe(tabla.totalPiezas);
  });

  it('lleva el pantone de cada color a su renglón (petición Daniel)', () => {
    const tabla = armarTabla([
      { color: 'Blanco', pantone: '11-0601 TCX', tallas: [{ etiquetaTalla: 'M', cantidad: 2 }] },
      { color: 'Rojo', tallas: [{ etiquetaTalla: 'M', cantidad: 3 }] },
    ]);
    expect(tabla.renglones[0]?.pantone).toBe('11-0601 TCX');
    // Sin pantone (no lo mandó la matriz) → null.
    expect(tabla.renglones[1]?.pantone).toBeNull();
  });

  it('cuadra con una matriz GRANDE (muchos colores y tallas)', () => {
    const tallas = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
    const lineas = Array.from({ length: 12 }, (_, c) => ({
      color: `Color ${c}`,
      tallas: tallas.map((etiquetaTalla, t) => ({ etiquetaTalla, cantidad: c * 10 + t })),
    }));
    const tabla = armarTabla(lineas);

    const esperado = lineas.reduce((s, l) => s + l.tallas.reduce((ss, t) => ss + t.cantidad, 0), 0);
    expect(tabla.tallas).toEqual(tallas);
    expect(tabla.renglones).toHaveLength(12);
    expect(tabla.totalPiezas).toBe(esperado);
    expect(tabla.totalesColumna.reduce((s, c) => s + c, 0)).toBe(esperado);
    expect(tabla.renglones.reduce((s, r) => s + r.totalFila, 0)).toBe(esperado);
  });

  it('tolera una matriz vacía (orden sin líneas)', () => {
    const tabla = armarTabla([]);
    expect(tabla.tallas).toEqual([]);
    expect(tabla.renglones).toEqual([]);
    expect(tabla.totalesColumna).toEqual([]);
    expect(tabla.totalPiezas).toBe(0);
  });
});

describe('generarPdfOrden', () => {
  it('devuelve un Buffer no vacío con cabecera %PDF', async () => {
    const buffer = await generarPdfOrden(datosBase());
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(esPdf(buffer)).toBe(true);
  });

  it('renderiza una orden CANCELADA con su motivo, sin truncar', async () => {
    const buffer = await generarPdfOrden(
      datosBase({ estado: 'cancelada', motivoCancelada: 'Cliente desistió' }),
    );
    expect(esPdf(buffer)).toBe(true);
  });

  it('renderiza sin fotos (degradación elegante)', async () => {
    const buffer = await generarPdfOrden(datosBase({ fotos: [] }));
    expect(esPdf(buffer)).toBe(true);
  });

  it('renderiza con secciones vacías (sin telas/bordados/habilitación)', async () => {
    const buffer = await generarPdfOrden(datosBase({ telas: [], bordados: [], habilitacion: [] }));
    expect(esPdf(buffer)).toBe(true);
  });
});

describe('generarPdfOrdenes', () => {
  it('consolida varias órdenes en un solo PDF', async () => {
    const buffer = await generarPdfOrdenes([
      datosBase({ folio: 1 }),
      datosBase({ folio: 2, estado: 'cancelada', motivoCancelada: 'x' }),
      datosBase({ folio: 3 }),
    ]);
    expect(esPdf(buffer)).toBe(true);
    // Tres páginas: el PDF debería ser más grande que el de una sola orden.
    const una = await generarPdfOrden(datosBase({ folio: 1 }));
    expect(buffer.length).toBeGreaterThan(una.length);
  });
});

describe('armarDatosImpresoOrden', () => {
  /** Orden mínima tal como la devuelve `obtenerOrden` (solo los campos que usa el impreso). */
  function ordenSalida(over: Partial<OrdenSalida> = {}): OrdenSalida {
    return {
      idModelo: 7,
      folio: 999,
      estado: 'completa',
      motivoCancelada: null,
      fecha: '2026-06-16',
      fechaEntrega: '2026-06-30',
      cliente: 'Cliente',
      // Como la devuelve `obtenerOrden`: referencias del cliente (D7) + snapshot `ocCliente`. El impreso
      // deriva `pedidoCliente` de la 1ª referencia (o del `ocCliente` si no hay ninguna).
      ocCliente: 'OC-2',
      referencias: [{ valor: '620884' }],
      etiquetaMarca: 'Marca',
      maquilero: 'Maquila',
      codigoModelo: 'MOD-7',
      descripcionModelo: 'Desc',
      composicion: 'algodón',
      observaciones: null,
      obsMaquila: null,
      lineas: [
        {
          color: 'Rojo',
          tallas: [
            { etiquetaTalla: 'CH', cantidad: 2 },
            { etiquetaTalla: 'M', cantidad: 3 },
          ],
        },
      ],
      totalPiezas: 5,
      ...over,
    } as unknown as OrdenSalida;
  }

  /** `deps` con las lecturas de dominio inyectadas (fakes), parametrizable por BOM/fotos. */
  function depsCon(
    orden: OrdenSalida,
    bom: BomModelo,
    fotos: FotoModeloConUrl[],
    descargarImagen?: DepsImpreso['descargarImagen'],
  ): DepsImpreso {
    return {
      archivos: archivosFake,
      obtenerOrden: () => Promise.resolve(orden),
      leerBom: () => Promise.resolve(bom),
      leerFotosModelo: () => Promise.resolve(fotos),
      ...(descargarImagen ? { descargarImagen } : {}),
    };
  }

  it('reúsa obtenerOrden+leerBom+leerFotosModelo, filtra paraProduccion y excluye precios', async () => {
    const bom: BomModelo = {
      telas: [
        {
          idTela: 1,
          nombre: 'Jersey',
          consumoPorPrenda: 0.4,
          paraPreCosto: false,
          paraProduccion: true,
          paraCosto: false,
        },
        {
          idTela: 2,
          nombre: 'Forro',
          consumoPorPrenda: 0.1,
          paraPreCosto: false,
          paraProduccion: false,
          paraCosto: false,
        },
      ],
      avios: [
        {
          idAvio: 1,
          clave: 'AV-1',
          descripcion: 'Hilo',
          consumoPorPrenda: 1,
          paraPreCosto: false,
          paraProduccion: true,
          paraCosto: false,
        },
        {
          idAvio: 2,
          clave: 'AV-2',
          descripcion: 'Cierre',
          consumoPorPrenda: 1,
          paraPreCosto: false,
          paraProduccion: false,
          paraCosto: false,
        },
      ],
      bordados: [{ idBordado: 1, nombre: 'Logo', tipo: 'BORDADO', precio: 12.5 }],
    };

    const datos = await armarDatosImpresoOrden(
      sesionConVer(),
      1,
      undefined,
      depsCon(ordenSalida(), bom, []),
    );

    // Solo las telas/avíos paraProduccion entran; los bordados no llevan precio.
    expect(datos.telas).toEqual([{ nombre: 'Jersey', consumoPorPrenda: 0.4 }]);
    expect(datos.habilitacion).toEqual([
      { clave: 'AV-1', descripcion: 'Hilo', consumoPorPrenda: 1 },
    ]);
    expect(datos.bordados).toEqual([{ nombre: 'Logo', tipo: 'BORDADO' }]);
    expect(JSON.stringify(datos)).not.toContain('12.5'); // ningún precio se filtró al impreso

    // Totales derivados de la matriz cuadran con el totalPiezas de la orden.
    expect(datos.totalPiezas).toBe(5);
    expect(datos.empresa).toBe('FR Moda');
    expect(datos.folio).toBe(999);
    // El "Pedido cliente" del impreso sale de la referencia PRINCIPAL del cliente (D7).
    expect(datos.pedidoCliente).toBe('620884');
  });

  it('el "Pedido cliente" cae al snapshot ocCliente cuando la orden no tiene referencias', async () => {
    const bom: BomModelo = { telas: [], avios: [], bordados: [] };
    const datos = await armarDatosImpresoOrden(
      sesionConVer(),
      1,
      undefined,
      depsCon(ordenSalida({ referencias: [], ocCliente: 'OC-99' }), bom, []),
    );
    expect(datos.pedidoCliente).toBe('OC-99');
  });

  it('descarta fotos que no se pudieron descargar (best-effort) y conserva las buenas', async () => {
    const bom: BomModelo = { telas: [], avios: [], bordados: [] };
    const fotos = [
      { urlDescarga: 'https://r2/ok' },
      { urlDescarga: 'https://r2/falla' },
    ] as unknown as FotoModeloConUrl[];
    const descargarImagen = vi.fn((url: string) =>
      Promise.resolve(url.endsWith('ok') ? 'data:image/jpeg;base64,AAAA' : null),
    );

    const datos = await armarDatosImpresoOrden(
      sesionConVer(),
      1,
      undefined,
      depsCon(ordenSalida(), bom, fotos, descargarImagen),
    );

    expect(datos.fotos).toEqual([{ dataUrl: 'data:image/jpeg;base64,AAAA' }]);
    // El PDF se genera igual con la foto buena (y sin truncar por la faltante).
    const buffer = await generarPdfOrden(datos);
    expect(esPdf(buffer)).toBe(true);
  });

  it('NO depende de modelos.ver: con solo ordenes.ver no lanza ErrorPermiso', async () => {
    // Sesión con ordenes.ver pero SIN modelos.ver. El impreso lee fotos a bajo nivel
    // (`leerFotosModelo`, sin verificar permiso), así que NO debe rebotar por falta de modelos.ver.
    const sesionSoloOrdenes = {
      id: 'u2',
      username: 'piso',
      nombre: 'Piso',
      idEmpresaActiva: 1,
      nombreEmpresaActiva: 'FR Moda',
      permisos: new Set(['ordenes.ver']),
    } as unknown as SesionUsuario;
    expect(sesionSoloOrdenes.permisos.has('modelos.ver')).toBe(false);

    const bom: BomModelo = { telas: [], avios: [], bordados: [] };
    const fotos = [{ urlDescarga: 'https://r2/ok' }] as unknown as FotoModeloConUrl[];
    const datos = await armarDatosImpresoOrden(
      sesionSoloOrdenes,
      1,
      undefined,
      depsCon(ordenSalida(), bom, fotos, () => Promise.resolve('data:image/jpeg;base64,AAAA')),
    );

    // Se resolvió sin ErrorPermiso y con la foto incluida.
    expect(datos.folio).toBe(999);
    expect(datos.fotos).toEqual([{ dataUrl: 'data:image/jpeg;base64,AAAA' }]);
  });

  it('propaga el ErrorNoEncontrado de obtenerOrden (orden de otra empresa → 404)', async () => {
    const deps: DepsImpreso = {
      archivos: archivosFake,
      obtenerOrden: () => Promise.reject(new ErrorNoEncontrado('Orden', 999)),
      leerBom: () => Promise.resolve({ telas: [], avios: [], bordados: [] }),
      leerFotosModelo: () => Promise.resolve([]),
    };
    await expect(
      armarDatosImpresoOrden(sesionConVer(), 999, undefined, deps),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);
  });
});

describe('descargarImagenComoDataUrl', () => {
  it('devuelve un data-URL con los bytes cuando la descarga es OK', async () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // cabecera PNG
    const fetchFake = vi.fn(() =>
      Promise.resolve({
        ok: true,
        headers: new Headers({ 'content-type': 'image/png' }),
        arrayBuffer: () => Promise.resolve(bytes.buffer.slice(0, bytes.length)),
      } as unknown as Response),
    );
    vi.stubGlobal('fetch', fetchFake);
    try {
      const url = await descargarImagenComoDataUrl('https://r2/firmada');
      expect(url).toMatch(/^data:image\/png;base64,/);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('devuelve null si la respuesta no es OK (best-effort, no truena)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: false, status: 404 } as unknown as Response)),
    );
    try {
      expect(await descargarImagenComoDataUrl('https://r2/falla')).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('devuelve null si fetch lanza (red caída)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('ECONNREFUSED'))),
    );
    try {
      expect(await descargarImagenComoDataUrl('https://r2/timeout')).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
