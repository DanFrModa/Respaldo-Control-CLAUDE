/**
 * Pruebas unitarias del impreso de la orden (F2-E4, R9). No tocan BD ni R2: ejercitan
 *  • `armarTabla` — la proyección de la matriz a tabla color × talla con totales (deben CUADRAR).
 *  • `generarPdfOrden` / `generarPdfOrdenes` — que devuelven un Buffer PDF real (cabecera `%PDF`),
 *    incluso con matriz grande, orden cancelada o sin fotos (degradación elegante).
 *  • `armarDatosImpresoOrden` — reúsa `obtenerOrden`/`leerBom`/`leerFotosModelo`/`listarAdjuntos`/
 *    `leerTelasCompradas` (inyectados), filtra `paraProduccion`, excluye precios, descarta fotos no
 *    descargables (best-effort) y trae como ARTES las fotos del arte del modelo + los adjuntos
 *    de la orden con `tipoMime` image/*.
 *  • `textoTelaComprada` — el texto de la TELA a partir de las OC ligadas (dedup + folios).
 *  • `descargarImagenComoDataUrl` — best-effort (un fallo de red → `null`, no truena).
 */
import { describe, expect, it, vi } from 'vitest';

import { ErrorNoEncontrado } from '../../../comun/errores.js';
import type { ServicioArchivos } from '../../../comun/archivos.js';
import type { SesionUsuario } from '../../../comun/permisos.js';
import type { OrdenSalida } from '../../../contrato/index.js';
import type { ModeloArteDetalle } from '../../modelos/arte-modelo.js';
import type { BomModelo } from '../../modelos/bom-modelo.js';
import type { FotoModeloConUrl } from '../../modelos/fotos-modelo.js';
import type { RecetaParaImpreso } from '../receta-orden.js';
import type { AdjuntoOrdenConUrl } from '../adjuntos-orden.js';

import {
  armarDatosImpresoOrden,
  armarTabla,
  descargarImagenComoDataUrl,
  generarPdfOrden,
  generarPdfOrdenes,
  porRondas,
  recortarArtes,
  recortarFotos,
  textoTelaComprada,
  MAX_ARTES,
  MAX_FOTOS,
  type DatosImpresoOrden,
  type DepsImpreso,
  type TelaCompradaOrden,
} from './impreso-orden.js';

/** Servicio de archivos inocuo (los tests inyectan `listarFotos`, que es quien lo usaría). */
const archivosFake = {
  solicitarSubida: vi.fn(),
  urlDescarga: vi.fn(() => Promise.resolve('https://r2/x')),
} as unknown as ServicioArchivos;

/**
 * Un ARTE del modelo con los campos que al impreso le importan (descripción/tipo/fotos) y el resto
 * con valores inocuos: `ModeloArteDetalle` trae toda la ficha del arte y repetirla en cada caso
 * solo agregaría ruido. V1-E3f: el `nombre` se retiró y las fotos son PLURALES — `keysFoto` acepta
 * varias para poder probar el arte con más de una imagen.
 */
function arteBom(over: {
  id: number;
  nombre: string;
  tipo?: 'BORDADO' | 'ESTAMPADO';
  precio?: number;
  keyFoto?: string;
  keysFoto?: string[];
}): ModeloArteDetalle {
  const keys = over.keysFoto ?? (over.keyFoto === undefined ? [] : [over.keyFoto]);
  return {
    id: over.id,
    idModelo: 1,
    descripcion: over.nombre,
    posicion: null,
    puntadas: null,
    precio: over.precio ?? null,
    idTipoArte: over.tipo === 'ESTAMPADO' ? 2 : 1,
    tipoArte: over.tipo === 'ESTAMPADO' ? 'Estampado' : 'Bordado',
    codigoTipoArte: over.tipo === 'ESTAMPADO' ? 'estampado' : 'bordado',
    usaPuntadas: over.tipo !== 'ESTAMPADO',
    idProveedor: null,
    proveedor: null,
    fotos: keys.map((key, i) => ({
      idFoto: over.id * 100 + i,
      idArchivo: `arch-${key}`,
      orden: i,
      key,
    })),
    orden: 0,
    creadoEn: new Date('2026-01-01T00:00:00Z'),
    creadoPorId: null,
    modificadoEn: new Date('2026-01-01T00:00:00Z'),
    modificadoPorId: null,
  };
}

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
    tela: 'Chifón (OC 334)',
    observaciones: 'Cuidar el tono.',
    obsMaquila: 'Doble costura.',
    ...tabla,
    telas: [{ nombre: 'Jersey', consumoPorPrenda: 0.4 }],
    listaArte: [{ descripcion: 'Logo pecho', tipoArte: 'Bordado' }],
    habilitacion: [{ clave: 'AV-1', descripcion: 'Hilo', consumoPorPrenda: 1 }],
    fotos: [],
    artes: [],
    ...over,
  };
}

/** PNG de 1×1 real (base64) para las pruebas de render con imagen incrustada. */
const PNG_1X1 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/** ¿El Buffer empieza con la firma de un PDF? */
function esPdf(buffer: Buffer): boolean {
  return buffer.length > 0 && buffer.subarray(0, 5).toString('latin1') === '%PDF-';
}

/**
 * Cuenta las PÁGINAS de un PDF: cada hoja es un objeto `/Type /Page` (el `[^s]` evita cazar el
 * `/Type /Pages` del nodo raíz, que es uno solo). Sirve para vigilar que el impreso siga cabiendo
 * en una hoja cuando se le agrega contenido.
 */
function paginasPdf(buffer: Buffer): number {
  return (buffer.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
}

/**
 * Orden PESADA para vigilar el presupuesto de altura: matriz de 4 colores × 5 tallas, las dos
 * observaciones, 3 fotos del modelo y `artes` imágenes de arte.
 */
function ordenDensa(artes: number): DatosImpresoOrden {
  const tabla = armarTabla(
    Array.from({ length: 4 }, (_, c) => ({
      color: `Color ${String(c)}`,
      tallas: ['XS', 'S', 'M', 'L', 'XL'].map((etiquetaTalla, t) => ({
        etiquetaTalla,
        cantidad: 10 + t,
      })),
    })),
  );
  return datosBase({
    ...tabla,
    fotos: [{ dataUrl: PNG_1X1 }, { dataUrl: PNG_1X1 }, { dataUrl: PNG_1X1 }],
    artes: Array.from({ length: artes }, (_, i) => ({
      dataUrl: PNG_1X1,
      titulo: `Arte ${String(i)}`,
    })),
  });
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

  it('renderiza con secciones vacías (sin telas/arte/habilitación)', async () => {
    const buffer = await generarPdfOrden(datosBase({ telas: [], listaArte: [], habilitacion: [] }));
    expect(esPdf(buffer)).toBe(true);
  });

  it('renderiza la sección de ARTES cuando la orden trae imágenes subidas', async () => {
    const buffer = await generarPdfOrden(
      datosBase({ artes: [{ dataUrl: PNG_1X1 }, { dataUrl: PNG_1X1 }] }),
    );
    expect(esPdf(buffer)).toBe(true);
    // Con artes el PDF crece respecto al mismo impreso sin artes (la sección sí se pintó).
    const sinArtes = await generarPdfOrden(datosBase({ artes: [] }));
    expect(buffer.length).toBeGreaterThan(sinArtes.length);
  });

  it('rotula el arte del BOM con su nombre debajo de la imagen', async () => {
    const conRotulo = await generarPdfOrden(
      datosBase({ artes: [{ dataUrl: PNG_1X1, titulo: 'Logo pecho bordado' }] }),
    );
    const sinRotulo = await generarPdfOrden(datosBase({ artes: [{ dataUrl: PNG_1X1 }] }));
    expect(esPdf(conRotulo)).toBe(true);
    // El mismo impreso con el texto del rótulo pesa más (el `Text` extra sí se pintó).
    expect(conRotulo.length).toBeGreaterThan(sinRotulo.length);
  });

  it('renderiza sin tela (ni comprada ni manual): el campo cae al "—"', async () => {
    expect(esPdf(await generarPdfOrden(datosBase({ tela: null })))).toBe(true);
  });

  // PRESUPUESTO DE ALTURA (el impreso es de UNA hoja). Esta orden es de las pesadas: matriz de 4
  // colores × 5 tallas, las dos observaciones, 3 fotos del modelo y 4 imágenes de arte. Cuida que
  // el título grande + la rejilla de artes no se coman la página: con las tarjetas de arte de
  // 110 × 120 y sin tope, este mismo impreso se iba a una SEGUNDA hoja.
  it('una orden densa con fotos y 4 artes cabe en UNA sola página', async () => {
    const buffer = await generarPdfOrden(ordenDensa(4));
    expect(esPdf(buffer)).toBe(true);
    expect(paginasPdf(buffer)).toBe(1);
  });

  it('el tope de la rejilla no deja que 9 artes agreguen filas (misma paginación que 4)', async () => {
    const conTope = paginasPdf(await generarPdfOrden(ordenDensa(4)));
    const conMuchos = paginasPdf(await generarPdfOrden(ordenDensa(9)));
    // Las 5 imágenes extra no se pintan (solo la leyenda de truncado): no agregan hoja.
    expect(conMuchos).toBe(conTope);
  });

  // GARANTÍA de la imagen PRINCIPAL (Daniel, 25-jul-2026): que esté al final del arreglo no la
  // deja fuera del tope, y anteponerla NO cuesta altura (misma paginación que sin marcarla).
  it('el arte PRINCIPAL se imprime aunque venga al final de 9 artes, sin costar una hoja', async () => {
    const densa = ordenDensa(9);
    const artes = densa.artes.map((arte, i) =>
      i === densa.artes.length - 1 ? { ...arte, principal: true } : arte,
    );

    // El recorte lo sube a la primera posición (y sigue mostrando solo MAX_ARTES).
    const { mostradas } = recortarArtes(artes);
    expect(mostradas[0]?.titulo).toBe('Arte 8');
    expect(mostradas).toHaveLength(MAX_ARTES);

    const buffer = await generarPdfOrden({ ...densa, artes });
    expect(paginasPdf(buffer)).toBe(paginasPdf(await generarPdfOrden(ordenDensa(9))));
    expect(paginasPdf(buffer)).toBe(1);
  });

  it('la foto PRINCIPAL del modelo se imprime aunque venga al final, sin costar una hoja', async () => {
    const densa = ordenDensa(4);
    // 5 fotos (más que el tope de 3) con la principal hasta el final.
    const fotos = Array.from({ length: 5 }, (_, i) => ({
      dataUrl: PNG_1X1,
      ...(i === 4 ? { principal: true } : {}),
    }));

    expect(recortarFotos(fotos)).toEqual([fotos[4], fotos[0], fotos[1]]);

    const buffer = await generarPdfOrden({ ...densa, fotos });
    expect(paginasPdf(buffer)).toBe(1);
  });
});

describe('porRondas — un arte con muchas fotos NO se come la rejilla (V1-E3f)', () => {
  it('reparte primero la 1ª foto de cada arte, luego las siguientes', () => {
    expect(porRondas([['a1', 'a2', 'a3'], ['b1'], ['c1', 'c2']])).toEqual([
      'a1',
      'b1',
      'c1',
      'a2',
      'c2',
      'a3',
    ]);
  });

  it('es estable con listas vacías, con una sola y sin artes', () => {
    expect(porRondas([])).toEqual([]);
    expect(porRondas([[], ['b1'], []])).toEqual(['b1']);
    expect(porRondas([['a1', 'a2']])).toEqual(['a1', 'a2']);
  });

  it('⭐ con el tope real, 5 fotos de UN arte no dejan fuera a los demás', () => {
    // El caso que la etapa destapó: antes de repartir por rondas, `recortarArtes` se llevaba las
    // 4 primeras imágenes —las 4 del MISMO arte— y los otros tres artes no salían en el papel.
    const conCinco = ['A-1', 'A-2', 'A-3', 'A-4', 'A-5'];
    const repartidas = porRondas([conCinco, ['B-1'], ['C-1'], ['D-1']]);
    const { mostradas } = recortarArtes(
      repartidas.map((titulo) => ({ dataUrl: `data:${titulo}`, titulo })),
    );
    expect(mostradas.map((m) => m.titulo)).toEqual(['A-1', 'B-1', 'C-1', 'D-1']);
  });
});

describe('recortarArtes', () => {
  const arte = (i: number) => ({ dataUrl: PNG_1X1, titulo: `Arte ${String(i)}` });

  it('deja pasar todas cuando no llegan al tope', () => {
    const artes = [arte(1), arte(2)];
    expect(recortarArtes(artes)).toEqual({ mostradas: artes, ocultas: 0 });
  });

  it('corta en MAX_ARTES conservando las PRIMERAS (el arte del BOM va primero) y cuenta el resto', () => {
    const artes = Array.from({ length: 9 }, (_, i) => arte(i));
    const { mostradas, ocultas } = recortarArtes(artes);
    expect(mostradas).toHaveLength(MAX_ARTES);
    expect(mostradas).toEqual(artes.slice(0, MAX_ARTES));
    expect(ocultas).toBe(9 - MAX_ARTES);
  });

  it('NUNCA recorta el arte PRINCIPAL: lo antepone aunque venga al final de 9', () => {
    const artes = Array.from({ length: 9 }, (_, i) => ({ ...arte(i), principal: i === 8 }));
    const { mostradas, ocultas } = recortarArtes(artes);

    expect(mostradas[0]).toBe(artes[8]);
    expect(mostradas).toHaveLength(MAX_ARTES);
    // Los que sí caben detrás conservan su orden relativo, y el conteo del título no miente.
    expect(mostradas.slice(1).map((a) => a.titulo)).toEqual(['Arte 0', 'Arte 1', 'Arte 2']);
    expect(ocultas).toBe(9 - MAX_ARTES);
  });

  it('sin ninguna marcada como principal se comporta igual que siempre', () => {
    const artes = Array.from({ length: 6 }, (_, i) => arte(i));
    expect(recortarArtes(artes).mostradas).toEqual(artes.slice(0, MAX_ARTES));
  });
});

describe('recortarFotos', () => {
  const foto = (i: number) => ({ dataUrl: PNG_1X1, titulo: `Foto ${String(i)}` });

  it('deja hasta MAX_FOTOS y conserva el orden cuando no hay principal marcada', () => {
    const fotos = Array.from({ length: 5 }, (_, i) => foto(i));
    expect(recortarFotos(fotos)).toEqual(fotos.slice(0, MAX_FOTOS));
  });

  it('sube la foto PRINCIPAL al frente y nunca la deja fuera del tope', () => {
    const fotos = [foto(0), foto(1), foto(2), { ...foto(3), principal: true }];
    const mostradas = recortarFotos(fotos);
    expect(mostradas).toHaveLength(MAX_FOTOS);
    expect(mostradas[0]?.titulo).toBe('Foto 3');
    expect(mostradas.slice(1).map((f) => f.titulo)).toEqual(['Foto 0', 'Foto 1']);
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
      // Tela capturada A MANO en la orden (`Orden.idTela`): es el FALLBACK del impreso.
      tela: 'Tela manual',
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

  /** Adjunto de la orden mínimo (solo los campos que usa el impreso), con overrides. */
  function adjunto(over: Partial<AdjuntoOrdenConUrl> = {}): AdjuntoOrdenConUrl {
    return {
      idArchivo: 'a1',
      nombreOriginal: 'arte.png',
      tipoMime: 'image/png',
      tamanoBytes: 10,
      urlDescarga: 'https://r2/arte',
      subidoPorId: null,
      nombreSubidoPor: null,
      creadoEn: new Date('2026-07-01'),
      ...over,
    };
  }

  /**
   * Deriva la RECETA DE LA ORDEN (V1-E3d) del fixture del BOM del modelo, aplicando el filtro
   * `paraProduccion` que antes hacía el propio impreso. Así los escenarios de estas pruebas no
   * cambian de significado al mover la fuente del papel del modelo a la orden.
   */
  function recetaDesdeBom(bom: BomModelo): RecetaParaImpreso {
    return {
      telas: bom.telas
        .filter((t) => t.paraProduccion)
        .map((t) => ({ nombre: t.nombre, consumoPorPrenda: t.consumoPorPrenda })),
      avios: bom.avios
        .filter((a) => a.paraProduccion)
        .map((a) => ({
          clave: a.clave,
          descripcion: a.descripcion,
          consumoPorPrenda: a.consumoPorPrenda,
        })),
      artes: bom.artes.map((a) => ({
        descripcion: a.descripcion,
        tipoArte: a.tipoArte,
        idModeloArte: a.id,
      })),
    };
  }

  /**
   * `deps` con las lecturas de dominio inyectadas (fakes), parametrizable por BOM/fotos/adjuntos y
   * por las telas COMPRADAS (OC ligadas a la orden; vacío = el impreso cae a la tela manual).
   */
  function depsCon(
    orden: OrdenSalida,
    bom: BomModelo,
    fotos: FotoModeloConUrl[],
    descargarImagen?: DepsImpreso['descargarImagen'],
    adjuntos: AdjuntoOrdenConUrl[] = [],
    telasCompradas: TelaCompradaOrden[] = [],
  ): DepsImpreso {
    return {
      archivos: archivosFake,
      obtenerOrden: () => Promise.resolve(orden),
      // El BOM del modelo se sigue leyendo para UNA sola cosa: la FOTO de cada arte (V1-E3d).
      leerBom: () => Promise.resolve(bom),
      // La RECETA DE LA ORDEN es la que arma las listas del papel. En estas pruebas se deriva del
      // MISMO fixture del BOM (aplicando el filtro `paraProduccion` que hacía el impreso), para
      // que las expectativas históricas sigan describiendo exactamente el mismo escenario.
      leerRecetaParaImpreso: () => Promise.resolve(recetaDesdeBom(bom)),
      leerFotosModelo: () => Promise.resolve(fotos),
      listarAdjuntos: () => Promise.resolve(adjuntos),
      leerTelasCompradas: () => Promise.resolve(telasCompradas),
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
          idTelaProveedor: null,
          proveedorAmarrado: null,
          precioPorColor: false,
          precioCosteo: null,
          origenPrecio: 'sin-precio' as const,
          proveedorPrecio: null,
          amarreIgnorado: false,
          precioReferencia: null,
        },
        {
          idTela: 2,
          nombre: 'Forro',
          consumoPorPrenda: 0.1,
          paraPreCosto: false,
          paraProduccion: false,
          paraCosto: false,
          idTelaProveedor: null,
          proveedorAmarrado: null,
          precioPorColor: false,
          precioCosteo: null,
          origenPrecio: 'sin-precio' as const,
          proveedorPrecio: null,
          amarreIgnorado: false,
          precioReferencia: null,
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
          consumoPorTalla: false,
          idAvioProveedor: null,
          proveedorAmarrado: null,
          precioCosteo: null,
          origenPrecio: 'sin-precio' as const,
          proveedorPrecio: null,
          amarreIgnorado: false,
          precioReferencia: null,
        },
        {
          idAvio: 2,
          clave: 'AV-2',
          descripcion: 'Cierre',
          consumoPorPrenda: 1,
          paraPreCosto: false,
          paraProduccion: false,
          paraCosto: false,
          consumoPorTalla: false,
          idAvioProveedor: null,
          proveedorAmarrado: null,
          precioCosteo: null,
          origenPrecio: 'sin-precio' as const,
          proveedorPrecio: null,
          amarreIgnorado: false,
          precioReferencia: null,
        },
      ],
      artes: [arteBom({ id: 1, nombre: 'Logo', tipo: 'BORDADO', precio: 12.5 })],
    };

    const datos = await armarDatosImpresoOrden(
      sesionConVer(),
      1,
      undefined,
      depsCon(ordenSalida(), bom, []),
    );

    // Solo las telas/avíos paraProduccion entran; el arte no lleva precio en el impreso.
    expect(datos.telas).toEqual([{ nombre: 'Jersey', consumoPorPrenda: 0.4 }]);
    expect(datos.habilitacion).toEqual([
      { clave: 'AV-1', descripcion: 'Hilo', consumoPorPrenda: 1 },
    ]);
    expect(datos.listaArte).toEqual([{ descripcion: 'Logo', tipoArte: 'Bordado' }]);
    expect(JSON.stringify(datos)).not.toContain('12.5'); // ningún precio se filtró al impreso

    // Totales derivados de la matriz cuadran con el totalPiezas de la orden.
    expect(datos.totalPiezas).toBe(5);
    expect(datos.empresa).toBe('FR Moda');
    expect(datos.folio).toBe(999);
    // El "Pedido cliente" del impreso sale de la referencia PRINCIPAL del cliente (D7).
    expect(datos.pedidoCliente).toBe('620884');
  });

  it('el "Pedido cliente" cae al snapshot ocCliente cuando la orden no tiene referencias', async () => {
    const bom: BomModelo = { telas: [], avios: [], artes: [] };
    const datos = await armarDatosImpresoOrden(
      sesionConVer(),
      1,
      undefined,
      depsCon(ordenSalida({ referencias: [], ocCliente: 'OC-99' }), bom, []),
    );
    expect(datos.pedidoCliente).toBe('OC-99');
  });

  /**
   * ⭐⭐ V1-E3 (§Post-F9.172(b)) — el papel pide las fotos AL MODELO DE LA ORDEN, **tal cual**.
   *
   * 🔴 Y eso es lo correcto justamente porque la resolución del linaje NO vive aquí: vive dentro de
   * `leerFotosModelo` (`idModeloDeLasFotos` — la foto propia del hijo gana, y si no tiene, se ven
   * las del padre). Resolverla ANTES de llamar, como hizo la primera versión de esta etapa, dejaría
   * la foto propia de un hijo **invisible para siempre**. Que el hijo sin fotos vea las del padre lo
   * demuestra `fotos-modelo.int.test.ts`, contra datos reales.
   */
  it('⭐⭐ las FOTOS se piden al modelo de la ORDEN tal cual (el linaje lo resuelve la lectura)', async () => {
    const bom: BomModelo = { telas: [], avios: [], artes: [] };
    const pedidasPara: number[] = [];
    const datos = await armarDatosImpresoOrden(sesionConVer(), 1, undefined, {
      ...depsCon(ordenSalida({ idModelo: 77 }), bom, []),
      leerFotosModelo: (idModelo: number) => {
        pedidasPara.push(idModelo);
        return Promise.resolve([{ url: 'https://r2/f1.jpg' } as unknown as FotoModeloConUrl]);
      },
      descargarImagen: (url: string) => Promise.resolve(`data:img;${url}`),
    });

    expect(pedidasPara).toEqual([77]);
    expect(datos.fotos).toHaveLength(1);
  });

  it('descarta fotos que no se pudieron descargar (best-effort) y conserva las buenas', async () => {
    const bom: BomModelo = { telas: [], avios: [], artes: [] };
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

    // La primera foto del modelo es la PRINCIPAL (Daniel, jul-2026) y viene marcada como tal.
    expect(datos.fotos).toEqual([{ dataUrl: 'data:image/jpeg;base64,AAAA', principal: true }]);
    // El PDF se genera igual con la foto buena (y sin truncar por la faltante).
    const buffer = await generarPdfOrden(datos);
    expect(esPdf(buffer)).toBe(true);
  });

  it('trae como ARTES solo los adjuntos de la orden con tipoMime image/*', async () => {
    const bom: BomModelo = { telas: [], avios: [], artes: [] };
    const adjuntos = [
      adjunto({ idArchivo: 'a1', tipoMime: 'image/png', urlDescarga: 'https://r2/arte-1' }),
      // Un Excel y un PDF adjuntos NO son artes: se excluyen por tipoMime.
      adjunto({
        idArchivo: 'a2',
        tipoMime: 'application/pdf',
        urlDescarga: 'https://r2/ficha.pdf',
      }),
      adjunto({ idArchivo: 'a3', tipoMime: 'image/jpeg', urlDescarga: 'https://r2/arte-2' }),
    ];
    const descargarImagen = vi.fn((url: string) => Promise.resolve(`data:img;${url}`));

    const datos = await armarDatosImpresoOrden(
      sesionConVer(),
      1,
      undefined,
      depsCon(ordenSalida(), bom, [], descargarImagen, adjuntos),
    );

    // Solo las 2 imágenes entran (y en su orden); el PDF adjunto ni se intenta descargar.
    expect(datos.artes).toEqual([
      { dataUrl: 'data:img;https://r2/arte-1' },
      { dataUrl: 'data:img;https://r2/arte-2' },
    ]);
    expect(descargarImagen).not.toHaveBeenCalledWith('https://r2/ficha.pdf');
  });

  it('descarta artes que no se pudieron descargar (best-effort, el PDF sale igual)', async () => {
    const bom: BomModelo = { telas: [], avios: [], artes: [] };
    const adjuntos = [
      adjunto({ idArchivo: 'a1', urlDescarga: 'https://r2/ok' }),
      adjunto({ idArchivo: 'a2', urlDescarga: 'https://r2/falla' }),
    ];
    const descargarImagen = vi.fn((url: string) =>
      Promise.resolve(url.endsWith('ok') ? PNG_1X1 : null),
    );

    const datos = await armarDatosImpresoOrden(
      sesionConVer(),
      1,
      undefined,
      depsCon(ordenSalida(), bom, [], descargarImagen, adjuntos),
    );

    expect(datos.artes).toEqual([{ dataUrl: PNG_1X1 }]);
    const buffer = await generarPdfOrden(datos);
    expect(esPdf(buffer)).toBe(true);
  });

  it('si listarAdjuntos FALLA por completo, el impreso sale igual SIN artes (best-effort)', async () => {
    const bom: BomModelo = { telas: [], avios: [], artes: [] };
    // Silencia el warn tenue del degradado para no ensuciar la salida del runner.
    const advertir = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const deps: DepsImpreso = {
        ...depsCon(ordenSalida(), bom, []),
        listarAdjuntos: () => Promise.reject(new Error('R2 caído')),
      };
      const datos = await armarDatosImpresoOrden(sesionConVer(), 1, undefined, deps);

      expect(datos.artes).toEqual([]);
      expect(advertir).toHaveBeenCalled();
      const buffer = await generarPdfOrden(datos);
      expect(esPdf(buffer)).toBe(true);
    } finally {
      advertir.mockRestore();
    }
  });

  it('rellena la TELA con las OC de tela ligadas a la orden (no con el campo manual)', async () => {
    const bom: BomModelo = { telas: [], avios: [], artes: [] };
    const datos = await armarDatosImpresoOrden(
      sesionConVer(),
      1,
      undefined,
      depsCon(
        ordenSalida(),
        bom,
        [],
        undefined,
        [],
        [
          { idTela: 1, nombre: 'Chifón', folioOc: 334 },
          // Segundo renglón de la MISMA tela y OC: se deduplica (no sale dos veces).
          { idTela: 1, nombre: 'Chifón', folioOc: 334 },
          { idTela: 2, nombre: 'Forro', folioOc: 335 },
        ],
      ),
    );
    expect(datos.tela).toBe('Chifón (OC 334)  ·  Forro (OC 335)');
    // La tela capturada a mano NO se usa cuando sí hay compra.
    expect(datos.tela).not.toContain('Tela manual');
  });

  it('cae a la TELA capturada a mano cuando la orden no tiene OC de tela', async () => {
    const bom: BomModelo = { telas: [], avios: [], artes: [] };
    const datos = await armarDatosImpresoOrden(
      sesionConVer(),
      1,
      undefined,
      depsCon(ordenSalida(), bom, [], undefined, [], []),
    );
    expect(datos.tela).toBe('Tela manual');
  });

  it('si la lectura de OC de tela TRUENA, degrada a la tela manual (best-effort)', async () => {
    const bom: BomModelo = { telas: [], avios: [], artes: [] };
    const advertir = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const deps: DepsImpreso = {
        ...depsCon(ordenSalida(), bom, []),
        leerTelasCompradas: () => Promise.reject(new Error('BD caída')),
      };
      const datos = await armarDatosImpresoOrden(sesionConVer(), 1, undefined, deps);

      expect(datos.tela).toBe('Tela manual');
      expect(advertir).toHaveBeenCalled();
      expect(esPdf(await generarPdfOrden(datos))).toBe(true);
    } finally {
      advertir.mockRestore();
    }
  });

  it('sin OC y sin tela manual, el campo queda en null (el impreso pinta "—")', async () => {
    const bom: BomModelo = { telas: [], avios: [], artes: [] };
    const datos = await armarDatosImpresoOrden(
      sesionConVer(),
      1,
      undefined,
      depsCon(ordenSalida({ tela: null }), bom, []),
    );
    expect(datos.tela).toBeNull();
    expect(esPdf(await generarPdfOrden(datos))).toBe(true);
  });

  // Caso documentado en `docs/modulos/impreso-orden.md`: si el arte PRINCIPAL no tiene foto, el
  // segundo NO hereda el papel (ser principal es una decisión sobre un arte concreto). Sin esta
  // prueba, "heredar la marca" pasaría desapercibido como cambio de comportamiento.
  it('si el arte PRINCIPAL del BOM no tiene foto, ninguna imagen queda marcada como principal', async () => {
    const bom: BomModelo = {
      telas: [],
      avios: [],
      artes: [
        // El principal (1º del modelo) NO tiene foto…
        arteBom({ id: 1, nombre: 'Principal sin foto', tipo: 'BORDADO' }),
        // …y el que sí la tiene NO se vuelve principal por eso.
        arteBom({ id: 2, nombre: 'Segundo', tipo: 'ESTAMPADO', keyFoto: 'bor/2.png' }),
      ],
    };

    const datos = await armarDatosImpresoOrden(sesionConVer(), 1, undefined, {
      ...depsCon(ordenSalida(), bom, [], (url) => Promise.resolve(`data:img;${url}`)),
      archivos: archivosQuePresignan(),
    });

    expect(datos.artes).toEqual([{ dataUrl: 'data:img;https://r2/bor/2.png', titulo: 'Segundo' }]);
    expect(datos.artes.some((a) => a.principal === true)).toBe(false);
    // El arte principal sin foto sigue en la lista de TEXTO (no desaparece del impreso).
    expect(datos.listaArte.map((a) => a.descripcion)).toEqual(['Principal sin foto', 'Segundo']);
    expect(esPdf(await generarPdfOrden(datos))).toBe(true);
  });

  it('incrusta como ARTES las fotos del arte del modelo, con su nombre, antes de los adjuntos', async () => {
    const bom: BomModelo = {
      telas: [],
      avios: [],
      artes: [
        arteBom({ id: 1, nombre: 'Logo pecho', tipo: 'BORDADO', keyFoto: 'bor/1.png' }),
        // Sin foto: sigue saliendo en la lista de texto, pero no aporta imagen.
        arteBom({ id: 2, nombre: 'Estampa espalda', tipo: 'ESTAMPADO' }),
      ],
    };
    // El servicio de archivos presigna la key del arte; la descarga devuelve un data-URL por URL.
    const urlDescarga = vi.fn((key: string) => Promise.resolve(`https://r2/${key}`));
    const archivos = { solicitarSubida: vi.fn(), urlDescarga } as unknown as ServicioArchivos;
    const descargarImagen = vi.fn((url: string) => Promise.resolve(`data:img;${url}`));

    const datos = await armarDatosImpresoOrden(sesionConVer(), 1, undefined, {
      ...depsCon(ordenSalida(), bom, [], descargarImagen, [
        adjunto({ idArchivo: 'a1', urlDescarga: 'https://r2/adjunto-1' }),
      ]),
      archivos,
    });

    // Arte del modelo primero (con rótulo y marcado como PRINCIPAL: es el primero), adjunto
    // de la orden después (sin rótulo).
    expect(datos.artes).toEqual([
      { dataUrl: 'data:img;https://r2/bor/1.png', titulo: 'Logo pecho', principal: true },
      { dataUrl: 'data:img;https://r2/adjunto-1' },
    ]);
    // Solo se presignó la key del arte CON foto.
    expect(urlDescarga).toHaveBeenCalledTimes(1);
    expect(urlDescarga).toHaveBeenCalledWith('bor/1.png');
    // La lista de texto del arte conserva los dos renglones (con su subtipo).
    expect(datos.listaArte).toEqual([
      { descripcion: 'Logo pecho', tipoArte: 'Bordado' },
      { descripcion: 'Estampa espalda', tipoArte: 'Estampado' },
    ]);
  });

  it('⭐ un ARTE con VARIAS fotos: todas se incrustan, y el tope reparte por rondas', async () => {
    // V1-E3f (§Post-F9.52 punto 5): las fotos del arte son plurales. Dos cosas que fijar aquí:
    //  1. las N fotos de un arte SÍ se incrustan (antes solo cabía una);
    //  2. con el tope de la rejilla, un arte con muchas fotos NO expulsa a los demás artes.
    const bom: BomModelo = {
      telas: [],
      avios: [],
      artes: [
        arteBom({
          id: 1,
          nombre: 'Logo pecho',
          keysFoto: ['bor/1a.png', 'bor/1b.png', 'bor/1c.png', 'bor/1d.png', 'bor/1e.png'],
        }),
        arteBom({ id: 2, nombre: 'Estampa espalda', keysFoto: ['est/2a.png'] }),
        arteBom({ id: 3, nombre: 'Etiqueta', keysFoto: ['eti/3a.png'] }),
      ],
    };

    const datos = await armarDatosImpresoOrden(sesionConVer(), 1, undefined, {
      ...depsCon(ordenSalida(), bom, [], (url) => Promise.resolve(`data:img;${url}`)),
      archivos: archivosQuePresignan(),
    });

    // Las SIETE fotos llegan al bloque (la rejilla las capa después, no la lectura).
    expect(datos.artes).toHaveLength(7);
    // Y llegan REPARTIDAS: la 1ª de cada arte antes que la 2ª de ninguno, así que las primeras
    // MAX_ARTES —lo que de verdad se imprime— cubren los TRES artes.
    expect(datos.artes.slice(0, MAX_ARTES).map((a) => a.titulo)).toEqual([
      'Logo pecho',
      'Estampa espalda',
      'Etiqueta',
      'Logo pecho',
    ]);
    expect(datos.artes[0]).toMatchObject({
      dataUrl: 'data:img;https://r2/bor/1a.png',
      titulo: 'Logo pecho',
      principal: true,
    });
    // Solo la PRIMERA foto del PRIMER arte es la principal (la que el tope nunca recorta).
    expect(datos.artes.filter((a) => a.principal === true)).toHaveLength(1);
    expect(esPdf(await generarPdfOrden(datos))).toBe(true);
  });

  /** Servicio de archivos que presigna cualquier key (`key` → `https://r2/<key>`). */
  function archivosQuePresignan(): ServicioArchivos {
    return {
      solicitarSubida: vi.fn(),
      urlDescarga: (key: string) => Promise.resolve(`https://r2/${key}`),
    } as unknown as ServicioArchivos;
  }

  /** Modelo con dos artes con foto, en el orden dado (para probar el rótulo por índice). */
  function bomDosArtes(primero: [string, string], segundo: [string, string]): BomModelo {
    return {
      telas: [],
      avios: [],
      artes: [
        arteBom({ id: 1, nombre: primero[0], tipo: 'BORDADO', keyFoto: primero[1] }),
        arteBom({ id: 2, nombre: segundo[0], tipo: 'ESTAMPADO', keyFoto: segundo[1] }),
      ],
    };
  }

  // El rótulo de cada arte se toma POR ÍNDICE de la lista presignada, así que hay que probar los
  // dos extremos: si solo se cubriera el caso "falla el ÚLTIMO", una implementación con
  // corrimiento de índice (filtrar los nulos y luego mapear el título por posición) pasaría igual.
  it.each([
    {
      caso: 'falla la PRIMERA (atrapa el corrimiento de índice)',
      bom: bomDosArtes(['Caída', 'falla.png'], ['Buena', 'ok.png']),
      // El arte PRINCIPAL (el 1º del modelo) es justo el que no bajó: no hay principal que marcar.
      esperado: [{ dataUrl: PNG_1X1, titulo: 'Buena' }],
    },
    {
      caso: 'falla la ÚLTIMA',
      bom: bomDosArtes(['Buena', 'ok.png'], ['Caída', 'falla.png']),
      esperado: [{ dataUrl: PNG_1X1, titulo: 'Buena', principal: true }],
    },
  ])('una foto de arte del BOM que no baja NO trunca el PDF ($caso)', async ({ bom, esperado }) => {
    const descargarImagen = vi.fn((url: string) =>
      Promise.resolve(url.endsWith('ok.png') ? PNG_1X1 : null),
    );

    const datos = await armarDatosImpresoOrden(sesionConVer(), 1, undefined, {
      ...depsCon(ordenSalida(), bom, [], descargarImagen),
      archivos: archivosQuePresignan(),
    });

    // La caída se descarta y la buena conserva SU rótulo (nunca el del arte caído).
    expect(datos.artes).toEqual(esperado);
    expect(esPdf(await generarPdfOrden(datos))).toBe(true);
  });

  it('si PRESIGNAR el arte del BOM truena, el impreso sale igual sin esas imágenes', async () => {
    const bom: BomModelo = {
      telas: [],
      avios: [],
      artes: [arteBom({ id: 1, nombre: 'Logo', tipo: 'BORDADO', keyFoto: 'bor/1.png' })],
    };
    const archivos = {
      solicitarSubida: vi.fn(),
      urlDescarga: () => Promise.reject(new Error('R2 caído')),
    } as unknown as ServicioArchivos;
    const advertir = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const datos = await armarDatosImpresoOrden(sesionConVer(), 1, undefined, {
        ...depsCon(ordenSalida(), bom, []),
        archivos,
      });

      expect(datos.artes).toEqual([]);
      expect(advertir).toHaveBeenCalled();
      // La lista de texto del arte sigue ahí (el bordado no desaparece del impreso).
      expect(datos.listaArte).toEqual([{ descripcion: 'Logo', tipoArte: 'Bordado' }]);
      expect(esPdf(await generarPdfOrden(datos))).toBe(true);
    } finally {
      advertir.mockRestore();
    }
  });

  it('si falla el presign de UN arte, los demás sí salen (best-effort por imagen)', async () => {
    const bom = bomDosArtes(['Caída', 'falla.png'], ['Buena', 'ok.png']);
    // R2 revienta SOLO con una key; la otra se presigna bien.
    const archivos = {
      solicitarSubida: vi.fn(),
      urlDescarga: (key: string) =>
        key === 'falla.png'
          ? Promise.reject(new Error('R2 rechazó la key'))
          : Promise.resolve(`https://r2/${key}`),
    } as unknown as ServicioArchivos;
    const advertir = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const datos = await armarDatosImpresoOrden(sesionConVer(), 1, undefined, {
        ...depsCon(ordenSalida(), bom, [], () => Promise.resolve(PNG_1X1)),
        archivos,
      });

      // El arte que sí se presignó sale (con SU rótulo); el otro se pierde solo él.
      expect(datos.artes).toEqual([{ dataUrl: PNG_1X1, titulo: 'Buena' }]);
      expect(advertir).toHaveBeenCalled();
      expect(esPdf(await generarPdfOrden(datos))).toBe(true);
    } finally {
      advertir.mockRestore();
    }
  });

  it('sin OC, sin fotos de arte y sin adjuntos, el impreso queda como siempre', async () => {
    const bom: BomModelo = {
      telas: [],
      avios: [],
      artes: [arteBom({ id: 1, nombre: 'Logo', tipo: 'BORDADO', precio: 9 })],
    };
    const urlDescarga = vi.fn(() => Promise.resolve('https://r2/x'));
    const archivos = { solicitarSubida: vi.fn(), urlDescarga } as unknown as ServicioArchivos;

    const datos = await armarDatosImpresoOrden(sesionConVer(), 1, undefined, {
      ...depsCon(ordenSalida(), bom, []),
      archivos,
    });

    expect(datos.artes).toEqual([]);
    expect(datos.fotos).toEqual([]);
    expect(datos.tela).toBe('Tela manual');
    // No se presignó nada (ningún bordado tiene foto).
    expect(urlDescarga).not.toHaveBeenCalled();
    expect(esPdf(await generarPdfOrden(datos))).toBe(true);
  });

  it('marca como PRINCIPAL la 1ª foto del modelo y el 1er arte del BOM (y solo esos)', async () => {
    // Las lecturas ya llegan ordenadas (`leerFotosModelo` / `leerBordadosBom`): la principal es la
    // primera de cada lista, y el impreso la marca para blindarla contra los topes.
    const bom = bomDosArtes(['Principal', 'uno.png'], ['Secundario', 'dos.png']);
    const fotos = [
      { urlDescarga: 'https://r2/foto-1' },
      { urlDescarga: 'https://r2/foto-2' },
    ] as unknown as FotoModeloConUrl[];

    const datos = await armarDatosImpresoOrden(sesionConVer(), 1, undefined, {
      ...depsCon(ordenSalida(), bom, fotos, (url) => Promise.resolve(`data:img;${url}`), [
        adjunto({ idArchivo: 'a1', urlDescarga: 'https://r2/adjunto-1' }),
      ]),
      archivos: archivosQuePresignan(),
    });

    expect(datos.fotos).toEqual([
      { dataUrl: 'data:img;https://r2/foto-1', principal: true },
      { dataUrl: 'data:img;https://r2/foto-2' },
    ]);
    expect(datos.artes).toEqual([
      { dataUrl: 'data:img;https://r2/uno.png', titulo: 'Principal', principal: true },
      { dataUrl: 'data:img;https://r2/dos.png', titulo: 'Secundario' },
      // El adjunto de la orden nunca es "el arte principal" (ese es del modelo).
      { dataUrl: 'data:img;https://r2/adjunto-1' },
    ]);
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

    const bom: BomModelo = { telas: [], avios: [], artes: [] };
    const fotos = [{ urlDescarga: 'https://r2/ok' }] as unknown as FotoModeloConUrl[];
    const datos = await armarDatosImpresoOrden(
      sesionSoloOrdenes,
      1,
      undefined,
      depsCon(ordenSalida(), bom, fotos, () => Promise.resolve('data:image/jpeg;base64,AAAA')),
    );

    // Se resolvió sin ErrorPermiso y con la foto incluida (la única es, por definición, la principal).
    expect(datos.folio).toBe(999);
    expect(datos.fotos).toEqual([{ dataUrl: 'data:image/jpeg;base64,AAAA', principal: true }]);
  });

  it('propaga el ErrorNoEncontrado de obtenerOrden (orden de otra empresa → 404)', async () => {
    const deps: DepsImpreso = {
      archivos: archivosFake,
      obtenerOrden: () => Promise.reject(new ErrorNoEncontrado('Orden', 999)),
      leerBom: () => Promise.resolve({ telas: [], avios: [], artes: [] }),
      leerRecetaParaImpreso: () => Promise.resolve({ telas: [], avios: [], artes: [] }),
      leerFotosModelo: () => Promise.resolve([]),
      listarAdjuntos: () => Promise.resolve([]),
    };
    await expect(
      armarDatosImpresoOrden(sesionConVer(), 999, undefined, deps),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);
  });
});

describe('textoTelaComprada', () => {
  it('sin compras devuelve null (el impreso cae a la tela manual)', () => {
    expect(textoTelaComprada([])).toBeNull();
  });

  it('junta los folios de OC de una misma tela en un solo renglón', () => {
    const telas: TelaCompradaOrden[] = [
      { idTela: 7, nombre: 'Chifón', folioOc: 334 },
      { idTela: 7, nombre: 'Chifón', folioOc: 340 },
      { idTela: 7, nombre: 'Chifón', folioOc: 334 },
    ];
    expect(textoTelaComprada(telas)).toBe('Chifón (OC 334, 340)');
  });

  it('lista varias telas en el orden en que llegan, separadas por " · "', () => {
    const telas: TelaCompradaOrden[] = [
      { idTela: 1, nombre: 'Jersey', folioOc: 10 },
      { idTela: 2, nombre: 'Rib', folioOc: 11 },
    ];
    expect(textoTelaComprada(telas)).toBe('Jersey (OC 10)  ·  Rib (OC 11)');
  });

  it('NO funde dos telas distintas del catálogo que se llamen igual (dedup por idTela)', () => {
    const telas: TelaCompradaOrden[] = [
      { idTela: 1, nombre: 'Jersey', folioOc: 10 },
      { idTela: 2, nombre: 'Jersey', folioOc: 11 },
    ];
    // Son telas DISTINTAS (ids distintos) aunque compartan nombre: dos renglones, no uno.
    expect(textoTelaComprada(telas)).toBe('Jersey (OC 10)  ·  Jersey (OC 11)');
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
