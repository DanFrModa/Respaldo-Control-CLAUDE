/**
 * Tests de integración del INVENTARIO de PRODUCTO TERMINADO operable (F3-E3). Postgres efímero
 * (testcontainers). Cubre lo que la ficha exige:
 *  (a) existencia = suma de movimientos (D3) y la vista lo refleja;
 *  (b) salida que dejaría negativo → rechazada (existencia nunca negativa);
 *  (c) traspaso atómico (dos patas; si falta existencia en origen no deja nada);
 *  (d) traspaso que excede el origen → rechazado;
 *  (e) movimiento inverso (cancelación) neutraliza el saldo;
 *  (f) dos salidas concurrentes del mismo artículo no dejan negativo (suma directa bajo bloqueo);
 *  (g) rechazo de la dirección `traspaso` como movimiento manual;
 *  (h) kardex con saldo corrido y kardex por folio.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type {
  Almacen,
  Color,
  Empresa,
  Modelo,
  PrismaClient,
  Talla,
  TipoMovimientoInventario,
} from '../../datos/index.js';
import { ErrorConflicto, ErrorNoEncontrado, ErrorValidacion } from '../../comun/errores.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import type { ClavePermiso } from '../../contrato/index.js';
import {
  cancelarMovimientoPt,
  consultarExistenciasPt,
  kardexPt,
  obtenerMovimientoPorFolio,
  registrarMovimientoPt,
  registrarTraspasoPt,
} from './movimientos-pt.js';

let cliente: PrismaClient;
let empresa: Empresa;
let modelo: Modelo;
let colorRojo: Color;
let tallaCH: Talla;
let tallaM: Talla;
let almPrimeras: Almacen;
let almSegundas: Almacen;
let tEntradaInicial: TipoMovimientoInventario;
let tEntregaCliente: TipoMovimientoInventario;
let tTransferAlmacenes: TipoMovimientoInventario; // dirección traspaso (NO se usa como pata)

const PERM_TODOS: ClavePermiso[] = ['inventario-pt.ver', 'inventario-pt.mover'];
const sesion = (permisos: ClavePermiso[] = PERM_TODOS) =>
  sesionDePrueba({ idEmpresaActiva: empresa.id, permisos });
const bd = () => ({ cliente });

beforeAll(() => {
  cliente = clientePruebas();
});

afterAll(async () => {
  await cliente.$disconnect();
});

beforeEach(async () => {
  await limpiarBaseDatos(cliente);
  empresa = await crearEmpresaPrueba(cliente);
  modelo = await cliente.modelo.create({ data: { codigo: 'A-100', descripcion: 'Playera' } });
  colorRojo = await cliente.color.create({ data: { nombre: 'Rojo' } });
  tallaCH = await cliente.talla.create({ data: { etiqueta: 'CH', orden: 1 } });
  tallaM = await cliente.talla.create({ data: { etiqueta: 'M', orden: 2 } });
  almPrimeras = await cliente.almacen.create({ data: { nombre: 'Primeras', tipo: 'PT' } });
  almSegundas = await cliente.almacen.create({ data: { nombre: 'Segundas', tipo: 'PT' } });
  // Tipos de movimiento que el dominio usa (por código) + los que el test elige a mano.
  tEntradaInicial = await cliente.tipoMovimientoInventario.create({
    data: { codigo: 'inventario-inicial', nombre: 'Inventario Inicial', direccion: 'entrada' },
  });
  tEntregaCliente = await cliente.tipoMovimientoInventario.create({
    data: { codigo: 'entrega-cliente', nombre: 'Entrega a Cliente', direccion: 'salida' },
  });
  tTransferAlmacenes = await cliente.tipoMovimientoInventario.create({
    data: {
      codigo: 'transferencia-almacenes',
      nombre: 'Transferencia entre almacenes',
      direccion: 'traspaso',
    },
  });
  // Patas del traspaso (las resuelve el dominio por código) + inversos de cancelación.
  await cliente.tipoMovimientoInventario.createMany({
    data: [
      {
        codigo: 'transferencia-salida',
        nombre: 'Transferencia entre Almacenes (Salida)',
        direccion: 'salida',
      },
      {
        codigo: 'transferencia-entrada',
        nombre: 'Transferencia entre Almacenes (Entrada)',
        direccion: 'entrada',
      },
      { codigo: 'error-entrada', nombre: 'Error de Entrada', direccion: 'salida' },
      { codigo: 'error-salida', nombre: 'Error de Salida', direccion: 'entrada' },
    ],
  });
});

/** Entra `cantidad` de Rojo/CH al almacén dado (inventario inicial). */
async function entrar(idAlmacen: number, cantidad: number, idTalla = tallaCH.id): Promise<number> {
  const mov = await registrarMovimientoPt(
    sesion(),
    {
      idTipoMov: tEntradaInicial.id,
      idAlmacen,
      idModelo: modelo.id,
      fecha: '2026-06-19',
      lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla, cantidad }] }],
    },
    bd(),
  );
  return mov.id;
}

describe('Movimiento manual (F3-E3)', () => {
  it('(a) entrada suma a la existencia; la vista lo refleja', async () => {
    await entrar(almPrimeras.id, 30);
    const existencias = await consultarExistenciasPt(sesion(), { idModelo: modelo.id }, bd());
    expect(existencias.totalExistencia).toBe(30);
    const fila = existencias.filas.find((f) => f.idAlmacen === almPrimeras.id);
    expect(fila?.existencia).toBe(30);
    expect(fila?.color).toBe('Rojo');
    expect(fila?.modelo).toBe('A-100');
  });

  it('salida dentro de la existencia descuenta', async () => {
    await entrar(almPrimeras.id, 30);
    await registrarMovimientoPt(
      sesion(),
      {
        idTipoMov: tEntregaCliente.id,
        idAlmacen: almPrimeras.id,
        idModelo: modelo.id,
        fecha: '2026-06-20',
        lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 10 }] }],
      },
      bd(),
    );
    const existencias = await consultarExistenciasPt(sesion(), { idModelo: modelo.id }, bd());
    expect(existencias.totalExistencia).toBe(20);
  });

  it('(b) RECHAZA una salida que dejaría existencia negativa', async () => {
    await entrar(almPrimeras.id, 5);
    await expect(
      registrarMovimientoPt(
        sesion(),
        {
          idTipoMov: tEntregaCliente.id,
          idAlmacen: almPrimeras.id,
          idModelo: modelo.id,
          fecha: '2026-06-20',
          lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 6 }] }],
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorConflicto);
    // No quedó nada de esa salida: la existencia sigue en 5.
    const existencias = await consultarExistenciasPt(sesion(), { idModelo: modelo.id }, bd());
    expect(existencias.totalExistencia).toBe(5);
  });

  it('(g) RECHAZA un tipo de dirección "traspaso" como movimiento manual', async () => {
    await entrar(almPrimeras.id, 10);
    await expect(
      registrarMovimientoPt(
        sesion(),
        {
          idTipoMov: tTransferAlmacenes.id, // dirección traspaso
          idAlmacen: almPrimeras.id,
          idModelo: modelo.id,
          fecha: '2026-06-20',
          lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 1 }] }],
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('los folios son consecutivos por secuencia (A3)', async () => {
    const m1 = await registrarMovimientoPt(
      sesion(),
      {
        idTipoMov: tEntradaInicial.id,
        idAlmacen: almPrimeras.id,
        idModelo: modelo.id,
        fecha: '2026-06-19',
        lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 1 }] }],
      },
      bd(),
    );
    const m2 = await registrarMovimientoPt(
      sesion(),
      {
        idTipoMov: tEntradaInicial.id,
        idAlmacen: almPrimeras.id,
        idModelo: modelo.id,
        fecha: '2026-06-19',
        lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaM.id, cantidad: 1 }] }],
      },
      bd(),
    );
    expect(m2.folio).toBe(m1.folio + 1);
  });
});

describe('Traspaso entre almacenes (F3-E3)', () => {
  it('(c) traspaso mueve la existencia del origen al destino, sin cambiar el total', async () => {
    await entrar(almPrimeras.id, 30);
    const traspaso = await registrarTraspasoPt(
      sesion(),
      {
        idAlmacenOrigen: almPrimeras.id,
        idAlmacenDestino: almSegundas.id,
        idModelo: modelo.id,
        fecha: '2026-06-20',
        lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 10 }] }],
      },
      bd(),
    );
    expect(traspaso.salida.direccion).toBe('salida');
    expect(traspaso.entrada.direccion).toBe('entrada');

    const existencias = await consultarExistenciasPt(sesion(), { idModelo: modelo.id }, bd());
    expect(existencias.totalExistencia).toBe(30); // total no cambia
    const primeras = existencias.filas.find((f) => f.idAlmacen === almPrimeras.id);
    const segundas = existencias.filas.find((f) => f.idAlmacen === almSegundas.id);
    expect(primeras?.existencia).toBe(20);
    expect(segundas?.existencia).toBe(10);
  });

  it('(d) RECHAZA un traspaso que excede la existencia del origen (atómico: no deja nada)', async () => {
    await entrar(almPrimeras.id, 5);
    await expect(
      registrarTraspasoPt(
        sesion(),
        {
          idAlmacenOrigen: almPrimeras.id,
          idAlmacenDestino: almSegundas.id,
          idModelo: modelo.id,
          fecha: '2026-06-20',
          lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 6 }] }],
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorConflicto);
    // Atómico: ni la salida ni la entrada quedaron (el origen sigue en 5, el destino en 0).
    const existencias = await consultarExistenciasPt(
      sesion(),
      { idModelo: modelo.id, incluirCeros: true },
      bd(),
    );
    expect(existencias.totalExistencia).toBe(5);
    const segundas = existencias.filas.find((f) => f.idAlmacen === almSegundas.id);
    expect(segundas?.existencia ?? 0).toBe(0);
  });

  it('RECHAZA origen = destino sin tocar la base', async () => {
    await expect(
      registrarTraspasoPt(
        sesion(),
        {
          idAlmacenOrigen: almPrimeras.id,
          idAlmacenDestino: almPrimeras.id,
          idModelo: modelo.id,
          fecha: '2026-06-20',
          lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 1 }] }],
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });
});

describe('Cancelación = inverso auditado (F3-E3)', () => {
  it('(e) cancelar una ENTRADA genera un inverso que neutraliza el saldo', async () => {
    const idEntrada = await entrar(almPrimeras.id, 30);
    const original = await cancelarMovimientoPt(
      sesion(),
      idEntrada,
      { motivo: 'captura equivocada' },
      bd(),
    );
    expect(original.cancelado).toBe(true);
    // Tras la cancelación, la existencia vuelve a 0 (la entrada quedó neutralizada).
    const existencias = await consultarExistenciasPt(
      sesion(),
      { idModelo: modelo.id, incluirCeros: true },
      bd(),
    );
    expect(existencias.totalExistencia).toBe(0);
  });

  it('cancelar dos veces el mismo movimiento → ErrorConflicto', async () => {
    const idEntrada = await entrar(almPrimeras.id, 10);
    await cancelarMovimientoPt(sesion(), idEntrada, { motivo: 'error' }, bd());
    await expect(
      cancelarMovimientoPt(sesion(), idEntrada, { motivo: 'otra vez' }, bd()),
    ).rejects.toBeInstanceOf(ErrorConflicto);
  });

  it('cancelar un movimiento inexistente o de otra empresa → 404', async () => {
    await expect(
      cancelarMovimientoPt(sesion(), 999_999, { motivo: 'no existe' }, bd()),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);
  });
});

describe('Concurrencia: existencia nunca negativa (F3-E3)', () => {
  it('(f) dos salidas concurrentes del mismo artículo no dejan negativo', async () => {
    await entrar(almPrimeras.id, 10);
    // Dos salidas de 6 cada una (12 > 10): a lo sumo UNA debe pasar.
    const intento = () =>
      registrarMovimientoPt(
        sesion(),
        {
          idTipoMov: tEntregaCliente.id,
          idAlmacen: almPrimeras.id,
          idModelo: modelo.id,
          fecha: '2026-06-20',
          lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 6 }] }],
        },
        bd(),
      );
    const resultados = await Promise.allSettled([intento(), intento()]);
    const exitosos = resultados.filter((r) => r.status === 'fulfilled').length;
    expect(exitosos).toBe(1);
    const existencias = await consultarExistenciasPt(sesion(), { idModelo: modelo.id }, bd());
    expect(existencias.totalExistencia).toBeGreaterThanOrEqual(0);
    expect(existencias.totalExistencia).toBe(4); // 10 − 6
  });
});

describe('Kardex (F3-E3)', () => {
  it('(h) kardex por modelo lista los movimientos con saldo corrido', async () => {
    await entrar(almPrimeras.id, 30); // saldo 30
    await registrarMovimientoPt(
      sesion(),
      {
        idTipoMov: tEntregaCliente.id,
        idAlmacen: almPrimeras.id,
        idModelo: modelo.id,
        fecha: '2026-06-20',
        lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 10 }] }],
      },
      bd(),
    ); // saldo 20

    const kardex = await kardexPt(sesion(), { idModelo: modelo.id }, bd());
    expect(kardex.modelo).toBe('A-100');
    expect(kardex.renglones).toHaveLength(2);
    expect(kardex.renglones[0]?.entrada).toBe(30);
    expect(kardex.renglones[0]?.saldo).toBe(30);
    expect(kardex.renglones[1]?.salida).toBe(10);
    expect(kardex.renglones[1]?.saldo).toBe(20);
  });

  it('kardex por folio devuelve un movimiento con su matriz', async () => {
    const m = await registrarMovimientoPt(
      sesion(),
      {
        idTipoMov: tEntradaInicial.id,
        idAlmacen: almPrimeras.id,
        idModelo: modelo.id,
        fecha: '2026-06-19',
        lineas: [
          {
            idColor: colorRojo.id,
            tallas: [
              { idTalla: tallaCH.id, cantidad: 10 },
              { idTalla: tallaM.id, cantidad: 20 },
            ],
          },
        ],
      },
      bd(),
    );
    const porFolio = await obtenerMovimientoPorFolio(sesion(), m.folio, bd());
    expect(porFolio.id).toBe(m.id);
    expect(porFolio.totalPiezas).toBe(30);
    expect(porFolio.lineas).toHaveLength(1);
  });

  it('kardex por folio inexistente → 404', async () => {
    await expect(obtenerMovimientoPorFolio(sesion(), 999_999, bd())).rejects.toBeInstanceOf(
      ErrorNoEncontrado,
    );
  });
});
