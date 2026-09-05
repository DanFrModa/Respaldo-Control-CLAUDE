/**
 * Tests UNITARIOS de la hoja de TRASPASO DE PRODUCTO TERMINADO (fila 0.100, §Post-F9.193). No tocan
 * BD ni red: el `cliente` de Prisma se inyecta por `bd` (`clienteLectura` lo prefiere sobre el
 * global) con respuestas fijas. Cubren lo que hace de esta hoja un documento y no una ocurrencia:
 *  • se arma con el folio QUE YA EXISTE (el de la pata de salida) — nunca uno nuevo (A3 intacto);
 *  • dice origen, destino, modelo, QUIÉN lo registró y el MOTIVO, y la matriz color×talla con la
 *    ORDEN de cada renglón;
 *  • se puede pedir desde CUALQUIERA de las dos patas (así reimprime el kardex, modo «Por folio»);
 *  • un traspaso CANCELADO no se imprime (su papel no vuelve a salir con un bulto);
 *  • un movimiento que no es traspaso no tiene hoja;
 *  • ⭐ REGLA 0-B: un traspaso VIEJO sin motivo (`observaciones` NULL) se lee e imprime igual;
 *  • sin `inventario-pt.ver` → ErrorPermiso (A4, deny-by-default).
 *
 * Y el PDF se mide POR SU TEXTO RENDERIZADO (`extraerTextoPdf`), no por el `%PDF-`: que el folio,
 * los almacenes y el motivo salgan IMPRESOS es justamente lo que esta fila vino a garantizar — un
 * Buffer no vacío también lo daría una hoja en blanco.
 */
import { describe, expect, it, vi } from 'vitest';

import { ErrorPermiso, ErrorValidacion } from '../../../comun/errores.js';
import { extraerTextoPdf } from '../../../comun/pdf-texto.js';
import type { ContextoBd } from '../../../comun/transaccion.js';
import { sesionDePrueba } from '../../../pruebas/sesiones.js';
import {
  armarDatosImpresoTraspasoPt,
  generarPdfTraspasoPt,
  type DatosImpresoTraspasoPt,
} from './impreso-traspaso-pt.js';

const sesionVer = () => sesionDePrueba({ permisos: ['inventario-pt.ver'] });

/**
 * Detalle color×talla de las dos patas: Marino en CH y G de la orden 8801, más Marino CH del bucket
 * «sin orden». Las tallas llegan DESORDENADAS a propósito (G antes que CH) para que la prueba mida
 * que la matriz ordena por el `orden` del catálogo y no por el orden de llegada.
 *
 * ⚠️ Y los ids DISCREPAN del `orden` a propósito: CH va con el id ALTO (22) y G con el bajo (11).
 * Es el caso REAL de una talla dada de alta después —id grande, `orden` chico— y es lo único que
 * distingue las dos claves: con `id` y `orden` de acuerdo, ordenar por id daba el mismo resultado y
 * la prueba pasaba igual con el criterio equivocado. Con esta discrepancia, caerse a `id` baraja
 * las columnas de la hoja impresa y la prueba lo ve.
 */
const DETALLE = [
  {
    idColor: 3,
    idTalla: 11,
    idOrden: 55,
    cantidad: 40,
    modelo: { codigo: '10432', descripcion: 'Sudadera cerrada' },
    color: { nombre: 'Marino' },
    talla: { etiqueta: 'G', orden: 3 },
    orden: { folio: 8801n },
  },
  {
    idColor: 3,
    idTalla: 22,
    idOrden: 55,
    cantidad: 60,
    modelo: { codigo: '10432', descripcion: 'Sudadera cerrada' },
    color: { nombre: 'Marino' },
    talla: { etiqueta: 'CH', orden: 1 },
    orden: { folio: 8801n },
  },
  {
    idColor: 3,
    idTalla: 22,
    idOrden: null,
    cantidad: 5,
    modelo: { codigo: '10432', descripcion: 'Sudadera cerrada' },
    color: { nombre: 'Marino' },
    talla: { etiqueta: 'CH', orden: 1 },
    orden: null,
  },
];

/** Pata de SALIDA (origen). `origenId` null: es la primera del par. */
const PATA_SALIDA = {
  id: 200,
  folio: 9910n,
  fecha: new Date('2026-09-04T00:00:00.000Z'),
  // Quién registró el traspaso: un id suelto, SIN FK (ADR-0005). El nombre se resuelve aparte.
  idUsuario: 'u-almacen',
  observaciones: 'Se pasan a Primeras para embarcar',
  origenTipo: 'traspaso',
  origenId: null,
  tipoMov: { direccion: 'salida' },
  almacen: { nombre: 'Segundas' },
  anuladoPor: [] as { id: number }[],
  detallesPt: DETALLE,
};

/** Pata de ENTRADA (destino): apunta a la salida por `origenId`. */
const PATA_ENTRADA = {
  ...PATA_SALIDA,
  id: 201,
  folio: 9911n,
  origenId: '200',
  tipoMov: { direccion: 'entrada' },
  almacen: { nombre: 'Primeras' },
};

/** Catálogo de usuarios del mock: sólo `u-almacen` resuelve (`u-purgado` a propósito, NO). */
const USUARIOS = [{ id: 'u-almacen', nombre: 'Almacén de producto terminado' }];

/**
 * `bd` con un `movimiento.findFirst` que responde por id (o por `origenId` cuando se busca la
 * gemela hacia adelante). `patas` permite variar el escenario (cancelado, no-traspaso…).
 *
 * Trae también `usuario.findMany`, porque el nombre de quien registró el traspaso NO viaja por
 * `include` (`idUsuario` es un id suelto sin FK — ADR-0005) y se resuelve con una consulta aparte.
 */
function bdCon(patas: Record<number, unknown>): ContextoBd {
  const porId = new Map(Object.entries(patas).map(([id, p]) => [Number(id), p]));
  const findFirst = vi.fn((args: { where: Record<string, unknown> }) => {
    if (typeof args.where.id === 'number') {
      return Promise.resolve(porId.get(args.where.id) ?? null);
    }
    const idSalida = Number(args.where.origenId);
    const gemela = [...porId.values()].find(
      (p) => (p as { origenId: string | null }).origenId === String(idSalida),
    );
    return Promise.resolve(gemela ?? null);
  });
  const findMany = vi.fn((args: { where: { id: { in: string[] } } }) =>
    Promise.resolve(USUARIOS.filter((u) => args.where.id.in.includes(u.id))),
  );
  return {
    cliente: { movimiento: { findFirst }, usuario: { findMany } },
  } as unknown as ContextoBd;
}

describe('armarDatosImpresoTraspasoPt (fila 0.100)', () => {
  it('usa el folio QUE YA EXISTE (el de la pata de salida) y dice origen, destino, modelo y motivo', async () => {
    const datos = await armarDatosImpresoTraspasoPt(
      sesionVer(),
      200,
      bdCon({ 200: PATA_SALIDA, 201: PATA_ENTRADA }),
    );

    expect(datos.folio).toBe(9910);
    expect(datos.almacenOrigen).toBe('Segundas');
    expect(datos.almacenDestino).toBe('Primeras');
    expect(datos.fecha).toBe('2026-09-04');
    expect(datos.modelo).toBe('10432');
    expect(datos.descripcionModelo).toBe('Sudadera cerrada');
    expect(datos.motivo).toBe('Se pasan a Primeras para embarcar');
    // Quién lo registró, resuelto a NOMBRE: el id no sirve en un papel que alguien firma.
    expect(datos.usuario).toBe('Almacén de producto terminado');
  });

  it('el usuario sale de la pata de SALIDA y se resuelve a nombre (no al id crudo)', async () => {
    // Se pide por la pata de ENTRADA a propósito: el «registró» de la hoja es siempre el de la
    // salida (la pata que nace primero), no el de la pata por la que se entró a imprimir.
    const datos = await armarDatosImpresoTraspasoPt(
      sesionVer(),
      201,
      bdCon({ 200: PATA_SALIDA, 201: { ...PATA_ENTRADA, idUsuario: 'u-purgado' } }),
    );

    expect(datos.usuario).toBe('Almacén de producto terminado');
  });

  it('un usuario que YA NO RESUELVE deja la hoja en null, no la revienta (D3: la historia queda)', async () => {
    // Dar de baja o purgar una cuenta NO borra el movimiento que escribió. La hoja sale igual.
    const datos = await armarDatosImpresoTraspasoPt(
      sesionVer(),
      200,
      bdCon({ 200: { ...PATA_SALIDA, idUsuario: 'u-purgado' }, 201: PATA_ENTRADA }),
    );

    expect(datos.usuario).toBeNull();
    expect(datos.folio).toBe(9910);
  });

  it('⭐ REGLA 0-B — un traspaso MIGRADO sin usuario (`idUsuario` NULL) tampoco truena', async () => {
    const datos = await armarDatosImpresoTraspasoPt(
      sesionVer(),
      200,
      bdCon({ 200: { ...PATA_SALIDA, idUsuario: null }, 201: PATA_ENTRADA }),
    );

    expect(datos.usuario).toBeNull();
    expect(datos.totalPiezas).toBe(105);
  });

  it('arma la matriz color×talla con las tallas en el ORDEN DEL CATÁLOGO y un renglón por orden', async () => {
    const datos = await armarDatosImpresoTraspasoPt(
      sesionVer(),
      200,
      bdCon({ 200: PATA_SALIDA, 201: PATA_ENTRADA }),
    );

    // CH (orden 1, id 22) antes que G (orden 3, id 11): manda el `orden` del CATÁLOGO, aunque G
    // llegó primero en el detalle Y tiene el id más bajo. Ordenar por id las barajaría.
    expect(datos.tallas).toEqual(['CH', 'G']);
    // Un renglón por color × ORDEN: fundirlos diría una orden que no es la de todas las piezas.
    expect(datos.renglones).toEqual([
      { color: 'Marino', folioOrden: 8801, cantidades: [60, 40], totalFila: 100 },
      { color: 'Marino', folioOrden: null, cantidades: [5, 0], totalFila: 5 },
    ]);
    expect(datos.totalesColumna).toEqual([65, 40]);
    expect(datos.totalPiezas).toBe(105);
  });

  it('se puede pedir desde la pata de ENTRADA y sale la MISMA hoja (reimpresión desde el kardex)', async () => {
    const bd = bdCon({ 200: PATA_SALIDA, 201: PATA_ENTRADA });
    const desdeSalida = await armarDatosImpresoTraspasoPt(sesionVer(), 200, bd);
    const desdeEntrada = await armarDatosImpresoTraspasoPt(sesionVer(), 201, bd);

    expect(desdeEntrada).toEqual(desdeSalida);
  });

  it('⭐ REGLA 0-B — un traspaso VIEJO sin motivo (observaciones NULL) se lee igual, no truena', async () => {
    const salidaVieja = { ...PATA_SALIDA, observaciones: null };
    const entradaVieja = { ...PATA_ENTRADA, observaciones: null };
    const datos = await armarDatosImpresoTraspasoPt(
      sesionVer(),
      200,
      bdCon({ 200: salidaVieja, 201: entradaVieja }),
    );

    expect(datos.motivo).toBeNull();
    expect(datos.folio).toBe(9910);
    expect(datos.totalPiezas).toBe(105);
  });

  it('un traspaso CANCELADO no se imprime (su papel no vuelve a salir con un bulto)', async () => {
    const salidaCancelada = { ...PATA_SALIDA, anuladoPor: [{ id: 999 }] };
    await expect(
      armarDatosImpresoTraspasoPt(
        sesionVer(),
        200,
        bdCon({ 200: salidaCancelada, 201: PATA_ENTRADA }),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('si la pata GEMELA está cancelada tampoco se imprime (el traspaso completo murió)', async () => {
    const entradaCancelada = { ...PATA_ENTRADA, anuladoPor: [{ id: 999 }] };
    await expect(
      armarDatosImpresoTraspasoPt(
        sesionVer(),
        200,
        bdCon({ 200: PATA_SALIDA, 201: entradaCancelada }),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('un movimiento MANUAL (no traspaso) no tiene hoja de traspaso', async () => {
    const manual = { ...PATA_SALIDA, origenTipo: 'movimiento-manual', origenId: null };
    await expect(
      armarDatosImpresoTraspasoPt(sesionVer(), 200, bdCon({ 200: manual })),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('un traspaso que NO es de PT (sin renglones de PT) no tiene esta hoja', async () => {
    const deTela = { ...PATA_SALIDA, detallesPt: [] };
    await expect(
      armarDatosImpresoTraspasoPt(sesionVer(), 200, bdCon({ 200: deTela })),
    ).rejects.toThrow(/no es de producto terminado/);
  });

  it('si falta la otra pata lo DICE (no imprime media hoja sin destino)', async () => {
    await expect(
      armarDatosImpresoTraspasoPt(sesionVer(), 200, bdCon({ 200: PATA_SALIDA })),
    ).rejects.toThrow(/No se encontró la otra pata/);
  });

  it('una pata de ENTRADA HUÉRFANA (sin `origenId`) lo dice con su propio aviso', async () => {
    // Regresión heredada de la hoja de tela: `Number(null)` es 0 y `Number.isInteger(0)` es true,
    // así que la huérfana se colaría con id 0 y moriría con el mensaje genérico equivocado.
    const entradaHuerfana = { ...PATA_ENTRADA, origenId: null };
    await expect(
      armarDatosImpresoTraspasoPt(sesionVer(), 201, bdCon({ 201: entradaHuerfana })),
    ).rejects.toThrow(/no apunta a su pata de salida/);
  });

  it('una pata de ENTRADA con `origenId` VACÍO lo dice con el mismo aviso (no se cuela como id 0)', async () => {
    const entradaVacia = { ...PATA_ENTRADA, origenId: '   ' };
    await expect(
      armarDatosImpresoTraspasoPt(sesionVer(), 201, bdCon({ 201: entradaVacia })),
    ).rejects.toThrow(/no apunta a su pata de salida/);
  });

  it('sin `inventario-pt.ver` → ErrorPermiso (A4, deny-by-default)', async () => {
    await expect(
      armarDatosImpresoTraspasoPt(sesionDePrueba({ permisos: [] }), 200, bdCon({})),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });
});

/** Datos base ya resueltos, para las pruebas de la función PURA que genera el PDF. */
const DATOS: DatosImpresoTraspasoPt = {
  empresa: 'FR Moda SA de CV',
  folio: 9910,
  fecha: '2026-09-04',
  usuario: 'Almacén de producto terminado',
  almacenOrigen: 'Segundas',
  almacenDestino: 'Primeras',
  modelo: '10432',
  descripcionModelo: 'Sudadera cerrada',
  motivo: 'Se pasan a Primeras para embarcar',
  tallas: ['CH', 'G'],
  renglones: [
    { color: 'Marino', folioOrden: 8801, cantidades: [60, 40], totalFila: 100 },
    { color: 'Marino', folioOrden: null, cantidades: [5, 0], totalFila: 5 },
  ],
  totalesColumna: [65, 40],
  totalPiezas: 105,
};

describe('generarPdfTraspasoPt (fila 0.100) — el TEXTO que sale impreso', () => {
  it('imprime el folio que ya existe, los dos almacenes y el MOTIVO', async () => {
    const buffer = await generarPdfTraspasoPt(DATOS);
    const texto = (await extraerTextoPdf(buffer)).join('\n');

    expect(texto).toContain('9910');
    expect(texto).toContain('Segundas');
    expect(texto).toContain('Primeras');
    expect(texto).toContain('Se pasan a Primeras para embarcar');
    expect(texto).toContain('10432');
    // Y QUIÉN lo registró, bajo su rótulo (`etiquetaCampo` va en mayúsculas).
    expect(texto).toContain('REGISTRÓ');
    expect(texto).toContain('Almacén de producto terminado');
  });

  it('⭐ REGLA 0-B — un traspaso sin usuario se imprime con «—» bajo REGISTRÓ, sin tronar', async () => {
    const buffer = await generarPdfTraspasoPt({ ...DATOS, usuario: null });
    const texto = (await extraerTextoPdf(buffer)).join('\n');

    expect(texto).toContain('REGISTRÓ');
    expect(texto).toContain('—');
    // Lo demás sigue saliendo: la hoja no se degrada por un dato viejo que falta.
    expect(texto).toContain('9910');
    expect(texto).toContain('Se pasan a Primeras para embarcar');
  });

  it('imprime la matriz color × talla con la ORDEN de cada renglón y los totales', async () => {
    const buffer = await generarPdfTraspasoPt(DATOS);
    const texto = (await extraerTextoPdf(buffer)).join('\n');

    expect(texto).toContain('Marino · OP 8801');
    expect(texto).toContain('CH');
    expect(texto).toContain('G');
    expect(texto).toContain('105');
  });

  it('NO imprime un campo de «cortador / tercero» (en PT nunca podría llenarse)', async () => {
    // `Almacen.idCortador` sólo se liga a almacenes de TELA (`exigirCortadorValido`) y las dos patas
    // de un traspaso de PT son de tipo PT (fila 0.137): el campo saldría «—» SIEMPRE. Un renglón
    // impreso que no puede llenarse nunca es ruido en un papel que alguien firma.
    const buffer = await generarPdfTraspasoPt(DATOS);
    const texto = (await extraerTextoPdf(buffer)).join('\n');

    expect(texto).not.toContain('CORTADOR');
    expect(texto).not.toContain('TERCERO');
  });

  it('⭐ REGLA 0-B — un traspaso VIEJO sin motivo se imprime con «—», sin tronar', async () => {
    const buffer = await generarPdfTraspasoPt({ ...DATOS, motivo: null });
    const texto = (await extraerTextoPdf(buffer)).join('\n');

    // El rótulo sale en MAYÚSCULAS (`estilosDoc.etiquetaCampo` lleva `textTransform: uppercase`).
    expect(texto).toContain('MOTIVO DEL TRASPASO');
    expect(texto).toContain('—');
    // Y lo demás sigue saliendo: la hoja no se degrada por un dato viejo que falta.
    expect(texto).toContain('9910');
    expect(texto).toContain('Segundas');
  });
});
