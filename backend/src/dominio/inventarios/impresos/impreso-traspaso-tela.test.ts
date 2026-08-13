/**
 * Tests UNITARIOS de la hoja de TRASPASO DE TELA (V1-E3b, §Post-F9.38). No tocan BD ni red: el
 * `cliente` de Prisma se inyecta por `bd` (`clienteLectura` lo prefiere sobre el global) con
 * respuestas fijas. Cubren lo que hace de esta hoja un documento y no una ocurrencia:
 *  • se arma con el folio QUE YA EXISTE (el de la pata de salida) — nunca uno nuevo;
 *  • dice origen, destino y el CORTADOR del almacén destino, y ambos componentes por renglón;
 *  • se puede pedir desde CUALQUIERA de las dos patas (así se reimprime desde el historial);
 *  • un traspaso CANCELADO no se imprime (su papel no vuelve a salir con un bulto);
 *  • un movimiento que no es traspaso no tiene hoja;
 *  • sin `inventario-telas.ver` → ErrorPermiso (A4, deny-by-default).
 * Y que el PDF se genera (Buffer no vacío) a partir de datos ya resueltos (función pura).
 */
import { describe, expect, it, vi } from 'vitest';

import { ErrorPermiso, ErrorValidacion } from '../../../comun/errores.js';
import type { ContextoBd } from '../../../comun/transaccion.js';
import { sesionDePrueba } from '../../../pruebas/sesiones.js';
import {
  armarDatosImpresoTraspasoTela,
  generarPdfTraspasoTela,
  type DatosImpresoTraspasoTela,
} from './impreso-traspaso-tela.js';

const sesionVer = () => sesionDePrueba({ permisos: ['inventario-telas.ver'] });

/** Detalle de tela de la pata de SALIDA (una tela con cuerpo + complemento). */
const DETALLE = [
  {
    idTela: 7,
    cantidad: 120.5,
    cantidadComplemento: 12,
    tela: { nombre: 'Felpa 100% algodón', nombreCuerpo: 'Felpa', nombreComplemento: 'Cardigan' },
    telaColor: { nombre: 'Marino', pantone: '19-4024' },
    lote: null,
  },
];

/** Pata de SALIDA (origen). `origenId` null: es la primera del par. */
const PATA_SALIDA = {
  id: 100,
  folio: 4321n,
  fecha: new Date('2026-08-12T00:00:00.000Z'),
  observaciones: 'Va con el chofer',
  origenTipo: 'traspaso',
  origenId: null,
  tipoMov: { direccion: 'salida' },
  almacen: { nombre: 'Naucalpan', cortador: null },
  anuladoPor: [] as { id: number }[],
  detallesTela: DETALLE,
};

/** Pata de ENTRADA (destino): apunta a la salida por `origenId` y su almacén tiene cortador. */
const PATA_ENTRADA = {
  id: 101,
  folio: 4322n,
  fecha: new Date('2026-08-12T00:00:00.000Z'),
  observaciones: 'Va con el chofer',
  origenTipo: 'traspaso',
  origenId: '100',
  tipoMov: { direccion: 'entrada' },
  almacen: { nombre: 'Taller Pérez', cortador: { nombre: 'Cortes Pérez' } },
  anuladoPor: [] as { id: number }[],
  detallesTela: DETALLE,
};

/**
 * `bd` con un `movimiento.findFirst` que responde por id (o por `origenId` cuando se busca la
 * gemela hacia adelante). `patas` permite variar el escenario (cancelado, no-traspaso…).
 */
function bdCon(patas: Record<number, unknown>): ContextoBd {
  const porId = new Map(Object.entries(patas).map(([id, p]) => [Number(id), p]));
  const findFirst = vi.fn((args: { where: Record<string, unknown> }) => {
    if (typeof args.where.id === 'number') {
      return Promise.resolve(porId.get(args.where.id) ?? null);
    }
    // Búsqueda de la gemela hacia adelante: la entrada trae `origenId` = id de la salida.
    const idSalida = Number(args.where.origenId);
    const gemela = [...porId.values()].find(
      (p) => (p as { origenId: string | null }).origenId === String(idSalida),
    );
    return Promise.resolve(gemela ?? null);
  });
  return { cliente: { movimiento: { findFirst } } } as unknown as ContextoBd;
}

describe('armarDatosImpresoTraspasoTela (V1-E3b, §Post-F9.38)', () => {
  it('usa el folio QUE YA EXISTE (el de la pata de salida) y dice origen, destino y cortador', async () => {
    const datos = await armarDatosImpresoTraspasoTela(
      sesionVer(),
      100,
      bdCon({ 100: PATA_SALIDA, 101: PATA_ENTRADA }),
    );

    expect(datos.folio).toBe(4321);
    expect(datos.almacenOrigen).toBe('Naucalpan');
    expect(datos.almacenDestino).toBe('Taller Pérez');
    expect(datos.tercero).toBe('Cortes Pérez');
    expect(datos.fecha).toBe('2026-08-12');
    expect(datos.renglones).toEqual([
      {
        tela: 'Felpa 100% algodón',
        colorOLote: 'Marino',
        pantone: '19-4024',
        nombreCuerpo: 'Felpa',
        cantidadCuerpo: 120.5,
        nombreComplemento: 'Cardigan',
        cantidadComplemento: 12,
      },
    ]);
    expect(datos.totalCuerpo).toBe(120.5);
    expect(datos.totalComplemento).toBe(12);
  });

  it('se puede pedir desde la pata de ENTRADA y sale la MISMA hoja (reimpresión desde el historial)', async () => {
    const bd = bdCon({ 100: PATA_SALIDA, 101: PATA_ENTRADA });
    const desdeSalida = await armarDatosImpresoTraspasoTela(sesionVer(), 100, bd);
    const desdeEntrada = await armarDatosImpresoTraspasoTela(sesionVer(), 101, bd);

    expect(desdeEntrada).toEqual(desdeSalida);
  });

  it('un traspaso CANCELADO no se imprime (su papel no vuelve a salir con un bulto)', async () => {
    const salidaCancelada = { ...PATA_SALIDA, anuladoPor: [{ id: 999 }] };
    await expect(
      armarDatosImpresoTraspasoTela(
        sesionVer(),
        100,
        bdCon({ 100: salidaCancelada, 101: PATA_ENTRADA }),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('si la pata GEMELA está cancelada tampoco se imprime (el traspaso completo murió)', async () => {
    const entradaCancelada = { ...PATA_ENTRADA, anuladoPor: [{ id: 999 }] };
    await expect(
      armarDatosImpresoTraspasoTela(
        sesionVer(),
        100,
        bdCon({ 100: PATA_SALIDA, 101: entradaCancelada }),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('un movimiento que NO es traspaso (p. ej. una salida a orden) no tiene hoja de traspaso', async () => {
    const salidaAOrden = { ...PATA_SALIDA, origenTipo: 'salida-tela-orden', origenId: '55' };
    await expect(
      armarDatosImpresoTraspasoTela(sesionVer(), 100, bdCon({ 100: salidaAOrden })),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('si falta la otra pata lo DICE (no imprime media hoja sin destino)', async () => {
    await expect(
      armarDatosImpresoTraspasoTela(sesionVer(), 100, bdCon({ 100: PATA_SALIDA })),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('una pata de ENTRADA HUÉRFANA (sin `origenId`) lo dice con su propio aviso', async () => {
    // Regresión: `Number(null)` es 0 y `Number.isInteger(0)` es true, así que la huérfana se colaba
    // con id 0 y moría después con el mensaje genérico de "no se encontró la otra pata".
    const entradaHuerfana = { ...PATA_ENTRADA, origenId: null };
    await expect(
      armarDatosImpresoTraspasoTela(sesionVer(), 101, bdCon({ 101: entradaHuerfana })),
    ).rejects.toThrow(/no apunta a su pata de salida/);
  });

  it('una pata de ENTRADA con `origenId` VACÍO lo dice con el mismo aviso (no se cuela como id 0)', async () => {
    // Misma trampa que el NULL: `Number('')` (y `Number('  ')`) también es 0 e `Number.isInteger(0)`
    // sigue siendo true, así que la cadena vacía se colaba igual hasta el mensaje genérico.
    const entradaVacia = { ...PATA_ENTRADA, origenId: '' };
    await expect(
      armarDatosImpresoTraspasoTela(sesionVer(), 101, bdCon({ 101: entradaVacia })),
    ).rejects.toThrow(/no apunta a su pata de salida/);
  });

  it('una pata de ENTRADA con `origenId` que no es un id lo dice igual', async () => {
    const entradaRota = { ...PATA_ENTRADA, origenId: 'no-es-un-id' };
    await expect(
      armarDatosImpresoTraspasoTela(sesionVer(), 101, bdCon({ 101: entradaRota })),
    ).rejects.toThrow(/no apunta a su pata de salida/);
  });

  it('sin `inventario-telas.ver` → ErrorPermiso (A4)', async () => {
    await expect(
      armarDatosImpresoTraspasoTela(sesionDePrueba({ permisos: [] }), 100, bdCon({})),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });
});

describe('generarPdfTraspasoTela (V1-E3b)', () => {
  it('genera un PDF no vacío a partir de datos ya resueltos (función pura)', async () => {
    const datos: DatosImpresoTraspasoTela = {
      empresa: 'FR Moda SA de CV',
      folio: 4321,
      fecha: '2026-08-12',
      almacenOrigen: 'Naucalpan',
      almacenDestino: 'Taller Pérez',
      tercero: 'Cortes Pérez',
      observaciones: null,
      renglones: [
        {
          tela: 'Felpa',
          colorOLote: 'Marino',
          pantone: null,
          nombreCuerpo: 'Felpa',
          cantidadCuerpo: 100,
          nombreComplemento: null,
          cantidadComplemento: null,
        },
      ],
      totalCuerpo: 100,
      totalComplemento: 0,
    };

    const buffer = await generarPdfTraspasoTela(datos);
    expect(buffer.length).toBeGreaterThan(0);
  });
});
