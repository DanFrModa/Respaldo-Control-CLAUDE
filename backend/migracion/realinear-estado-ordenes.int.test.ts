/**
 * Integración del SCRIPT de mantenimiento `realinear-estado-ordenes` — corre en CI
 * (testcontainers), NO en local.
 *
 * Por qué existe: con el borrado y recarga de datos que anunció Daniel (*"todo lo que hay se va a
 * borrar y meter nueva información"*), **este script —no la migración— es el camino que correrá en
 * el go-live**, así que su recorrido completo (paginación + transacción por lote + dry-run) tiene
 * que estar probado contra Postgres de verdad, no solo su motor.
 *
 * El motor (`realinearEstadoOrdenes`: la regla y sus cinturones) ya se prueba con dobles en
 * `src/dominio/produccion/requisitos-orden.test.ts`; aquí se cubre lo que SOLO la base revela:
 *  (a) **paginación real** con `--lote` chico y más órdenes que el lote: no se salta ni repite;
 *  (b) `--dry-run` **no deja rastro** (ni estados ni bitácora) pero devuelve el resumen correcto;
 *  (c) en corrida real **degrada, asciende y respeta** producción viva, canceladas y
 *      `fechaCompletada`;
 *  (d) **idempotencia**: la segunda corrida no escribe nada.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Cliente, Color, Empresa, Modelo, PrismaClient, Talla } from '../src/datos/index.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../src/pruebas/contexto.js';

import { realinearTodo, type OpcionesRealineado } from './realinear-estado-ordenes.js';

let cliente: PrismaClient;
let empresa: Empresa;
let otraEmpresa: Empresa;
let clienteNegocio: Cliente;
let colorRojo: Color;
let tallaCH: Talla;
/** Modelo que CUMPLE: receta de avíos + prenda lisa (`llevaArte: false`). */
let modeloOk: Modelo;
/** Modelo que LLEVA arte (default) y NO lo tiene capturado → sus órdenes no pueden completarse. */
let modeloSinArte: Modelo;

let folio = 0;

const opciones = (extra: Partial<OpcionesRealineado> = {}): OpcionesRealineado => ({
  tamanoLote: 500,
  dryRun: false,
  ...extra,
});

/** Crea una orden con el estado GUARDADO que se le pida (simula lo que deja el ETL). */
async function crearOrden(datos: {
  idModelo: number;
  estado: 'capturada' | 'completa' | 'cancelada';
  conMatriz?: boolean;
  fechaCompletada?: Date | null;
  idEmpresa?: number;
}): Promise<number> {
  folio += 1;
  const orden = await cliente.orden.create({
    data: {
      folio: BigInt(folio),
      idEmpresa: datos.idEmpresa ?? empresa.id,
      idModelo: datos.idModelo,
      idCliente: clienteNegocio.id,
      estado: datos.estado,
      fechaCompletada: datos.fechaCompletada ?? null,
      ...(datos.conMatriz === false
        ? {}
        : {
            lineas: {
              create: [
                {
                  idColor: colorRojo.id,
                  tallas: { create: [{ idTalla: tallaCH.id, cantidad: 10 }] },
                },
              ],
            },
          }),
    },
  });
  return orden.id;
}

/** Deja un corte VIVO en la orden → "en producción" (el cinturón la protege). */
async function cortar(idOrden: number): Promise<void> {
  folio += 1;
  await cliente.etapaMovimiento.create({
    data: {
      folio: BigInt(folio),
      idEmpresa: empresa.id,
      idOrden,
      tipo: 'corte',
      fecha: new Date('2026-07-01T00:00:00.000Z'),
    },
  });
}

/** Estados guardados de un conjunto de órdenes, por id. */
async function estados(ids: number[]): Promise<Map<number, string>> {
  const filas = await cliente.orden.findMany({
    where: { id: { in: ids } },
    select: { id: true, estado: true },
  });
  return new Map(filas.map((f) => [f.id, f.estado]));
}

/** Cuántos renglones de bitácora dejó el realineado. */
function contarBitacoraRealineado(): Promise<number> {
  return cliente.bitacora.count({
    where: { entidad: 'Orden', datos: { path: ['motivo'], equals: 'realineado-post-carga' } },
  });
}

beforeAll(() => {
  cliente = clientePruebas();
});

beforeEach(async () => {
  await limpiarBaseDatos(cliente);
  folio = 0;
  empresa = await crearEmpresaPrueba(cliente);
  otraEmpresa = await crearEmpresaPrueba(cliente, 'Marilyn Fitness de Prueba');
  clienteNegocio = await cliente.cliente.create({ data: { nombre: 'Liverpool' } });
  colorRojo = await cliente.color.create({ data: { nombre: 'Rojo' } });
  tallaCH = await cliente.talla.create({ data: { etiqueta: 'CH', orden: 1 } });

  const avio = await cliente.avio.create({ data: { clave: 'HIL-1', descripcion: 'Hilo' } });
  modeloOk = await cliente.modelo.create({ data: { codigo: 'OK-1', llevaArte: false } });
  await cliente.modeloAvio.create({
    data: { idModelo: modeloOk.id, idAvio: avio.id, consumoPorPrenda: 1, paraProduccion: true },
  });
  // `llevaArte` NO se pasa: nace `true` (el default de Daniel) y el BOM no tiene arte.
  modeloSinArte = await cliente.modelo.create({ data: { codigo: 'ARTE-1' } });
  await cliente.modeloAvio.create({
    data: {
      idModelo: modeloSinArte.id,
      idAvio: avio.id,
      consumoPorPrenda: 1,
      paraProduccion: true,
    },
  });
});

afterAll(async () => {
  await cliente.$disconnect();
});

describe('realinearTodo — corrida real sobre el corpus recién cargado', () => {
  it('degrada, asciende y RESPETA producción viva, canceladas y la fecha sellada', async () => {
    const sello = new Date('2020-05-05T00:00:00.000Z');
    // Lo que deja el ETL: estados explícitos de Access, sin recalcular.
    const degradable = await crearOrden({
      idModelo: modeloSinArte.id,
      estado: 'completa',
      fechaCompletada: sello,
    });
    const sinMatriz = await crearOrden({
      idModelo: modeloOk.id,
      estado: 'completa',
      conMatriz: false,
      fechaCompletada: sello,
    });
    const ascendible = await crearOrden({ idModelo: modeloOk.id, estado: 'capturada' });
    const enProduccion = await crearOrden({
      idModelo: modeloSinArte.id,
      estado: 'completa',
      fechaCompletada: sello,
    });
    await cortar(enProduccion);
    const cancelada = await crearOrden({ idModelo: modeloSinArte.id, estado: 'cancelada' });
    const alDia = await crearOrden({
      idModelo: modeloOk.id,
      estado: 'completa',
      fechaCompletada: sello,
    });

    const resumen = await realinearTodo(cliente, opciones());

    // 5 revisadas (la cancelada no se evalúa).
    expect(resumen).toEqual({
      revisadas: 5,
      degradadas: 2,
      completadas: 1,
      protegidasPorProduccion: 1,
    });

    const e = await estados([degradable, sinMatriz, ascendible, enProduccion, cancelada, alDia]);
    expect(e.get(degradable)).toBe('capturada');
    expect(e.get(sinMatriz)).toBe('capturada');
    expect(e.get(ascendible)).toBe('completa');
    expect(e.get(enProduccion)).toBe('completa'); // cinturón: está cortada
    expect(e.get(cancelada)).toBe('cancelada'); // cancelada siempre gana
    expect(e.get(alDia)).toBe('completa');

    // El sello histórico NO se borra al degradar, y la que ascendió SÍ lo estrena.
    const fechas = await cliente.orden.findMany({
      where: { id: { in: [degradable, ascendible] } },
      select: { id: true, fechaCompletada: true },
    });
    const porId = new Map(fechas.map((f) => [f.id, f.fechaCompletada]));
    expect(porId.get(degradable)).toEqual(sello);
    expect(porId.get(ascendible)).not.toBeNull();

    // A7: una bitácora por orden tocada (3), atribuida al sistema.
    expect(await contarBitacoraRealineado()).toBe(3);
    const renglon = await cliente.bitacora.findFirst({
      where: { entidad: 'Orden', idEntidad: String(degradable) },
    });
    expect(renglon?.idUsuario).toBeNull();
  });

  it('es IDEMPOTENTE: la segunda corrida no cambia nada ni duplica bitácora', async () => {
    await crearOrden({ idModelo: modeloSinArte.id, estado: 'completa' });
    await crearOrden({ idModelo: modeloOk.id, estado: 'capturada' });

    const primera = await realinearTodo(cliente, opciones());
    expect(primera.degradadas + primera.completadas).toBe(2);
    const bitacorasTrasPrimera = await contarBitacoraRealineado();

    const segunda = await realinearTodo(cliente, opciones());

    expect(segunda).toMatchObject({ revisadas: 2, degradadas: 0, completadas: 0 });
    expect(await contarBitacoraRealineado()).toBe(bitacorasTrasPrimera);
  });

  it('respeta --empresa: no toca las órdenes de otra empresa', async () => {
    const propia = await crearOrden({ idModelo: modeloSinArte.id, estado: 'completa' });
    const ajena = await crearOrden({
      idModelo: modeloSinArte.id,
      estado: 'completa',
      idEmpresa: otraEmpresa.id,
    });

    const resumen = await realinearTodo(cliente, opciones({ idEmpresa: empresa.id }));

    expect(resumen).toMatchObject({ revisadas: 1, degradadas: 1 });
    const e = await estados([propia, ajena]);
    expect(e.get(propia)).toBe('capturada');
    expect(e.get(ajena)).toBe('completa');
  });
});

describe('realinearTodo — paginación', () => {
  it('con lote chico recorre TODAS sin saltarse ni repetir ninguna', async () => {
    // 7 órdenes degradables y lotes de 2 → 4 páginas (2+2+2+1) y una consulta final vacía.
    const ids: number[] = [];
    for (let i = 0; i < 7; i += 1) {
      ids.push(await crearOrden({ idModelo: modeloSinArte.id, estado: 'completa' }));
    }

    const resumen = await realinearTodo(cliente, opciones({ tamanoLote: 2 }));

    // Ni una de más (repetida) ni una de menos (saltada).
    expect(resumen).toEqual({
      revisadas: 7,
      degradadas: 7,
      completadas: 0,
      protegidasPorProduccion: 0,
    });
    const e = await estados(ids);
    expect([...e.values()].every((v) => v === 'capturada')).toBe(true);
    // Una bitácora por orden: la paginación no duplica renglones.
    expect(await contarBitacoraRealineado()).toBe(7);
  });
});

describe('realinearTodo — --dry-run', () => {
  it('devuelve el MISMO resumen que la corrida real pero deja la base intacta', async () => {
    const degradable = await crearOrden({ idModelo: modeloSinArte.id, estado: 'completa' });
    const ascendible = await crearOrden({ idModelo: modeloOk.id, estado: 'capturada' });
    const antes = await estados([degradable, ascendible]);

    const simulado = await realinearTodo(cliente, opciones({ dryRun: true, tamanoLote: 1 }));

    expect(simulado).toMatchObject({ revisadas: 2, degradadas: 1, completadas: 1 });
    // Nada cambió: ni estados ni bitácora (el rollback deshizo hasta el rastro).
    expect(await estados([degradable, ascendible])).toEqual(antes);
    expect(await contarBitacoraRealineado()).toBe(0);

    // Y al aplicarlo de verdad, el resultado es el que la simulación anunció.
    const real = await realinearTodo(cliente, opciones());
    expect(real).toMatchObject({ revisadas: 2, degradadas: 1, completadas: 1 });
    const despues = await estados([degradable, ascendible]);
    expect(despues.get(degradable)).toBe('capturada');
    expect(despues.get(ascendible)).toBe('completa');
  });
});
