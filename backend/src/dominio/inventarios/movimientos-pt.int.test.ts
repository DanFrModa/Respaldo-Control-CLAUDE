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
  registrarTraspasoPt as registrarTraspasoPtMotor,
  type LineaMovimientoPt,
} from '../../comun/kardex.js';
import { extraerTextoPdf } from '../../comun/pdf-texto.js';
import {
  armarDatosImpresoTraspasoPt,
  generarPdfTraspasoPt,
} from './impresos/impreso-traspaso-pt.js';
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
      motivo: 'Ajuste de la prueba',
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
    // PT por orden (F6-E2): un movimiento MANUAL cae en el bucket SIN orden (idOrden/folioOrden null).
    expect(fila?.idOrden).toBeNull();
    expect(fila?.folioOrden).toBeNull();
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
        motivo: 'Ajuste de la prueba',
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
          motivo: 'Ajuste de la prueba',
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
          motivo: 'Ajuste de la prueba',
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
        motivo: 'Ajuste de la prueba',
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
        motivo: 'Ajuste de la prueba',
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
        motivo: 'Ajuste de la prueba',
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
          motivo: 'Ajuste de la prueba',
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
          motivo: 'Ajuste de la prueba',
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
          motivo: 'Ajuste de la prueba',
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

describe('PT etiquetado por ORDEN se puede mover (V1-E3b — §Post-F9.40)', () => {
  /**
   * Crea una orden mínima de la empresa dada (el recibo de maquila etiqueta el PT con SU orden;
   * aquí se simula ese etiquetado capturando el movimiento con `idOrden`).
   */
  async function crearOrden(folio: bigint, idEmpresa = empresa.id): Promise<number> {
    const cli = await cliente.cliente.create({ data: { nombre: `Cliente ${String(folio)}` } });
    const orden = await cliente.orden.create({
      data: { folio, idEmpresa, idModelo: modelo.id, idCliente: cli.id },
    });
    return orden.id;
  }

  /** Entra `cantidad` de Rojo/CH al almacén, ETIQUETADO con una orden (como lo hace el recibo). */
  async function entrarConOrden(
    idAlmacen: number,
    cantidad: number,
    idOrden: number | null,
  ): Promise<number> {
    const mov = await registrarMovimientoPt(
      sesion(),
      {
        idTipoMov: tEntradaInicial.id,
        idAlmacen,
        idModelo: modelo.id,
        fecha: '2026-08-12',
        motivo: 'Ajuste de la prueba',
        lineas: [{ idColor: colorRojo.id, idOrden, tallas: [{ idTalla: tallaCH.id, cantidad }] }],
      },
      bd(),
    );
    return mov.id;
  }

  it('el movimiento manual SACA del bucket de la orden elegida (antes solo tocaba «sin orden»)', async () => {
    const idOrden = await crearOrden(9001n);
    await entrarConOrden(almPrimeras.id, 20, idOrden);

    const salida = await registrarMovimientoPt(
      sesion(),
      {
        idTipoMov: tEntregaCliente.id,
        idAlmacen: almPrimeras.id,
        idModelo: modelo.id,
        fecha: '2026-08-12',
        motivo: 'Ajuste de la prueba',
        lineas: [
          { idColor: colorRojo.id, idOrden, tallas: [{ idTalla: tallaCH.id, cantidad: 8 }] },
        ],
      },
      bd(),
    );
    expect(salida.lineas[0]?.idOrden).toBe(idOrden);
    expect(salida.lineas[0]?.folioOrden).toBe(9001);

    const existencias = await consultarExistenciasPt(sesion(), { idModelo: modelo.id }, bd());
    const fila = existencias.filas.find((f) => f.idOrden === idOrden);
    expect(fila?.existencia).toBe(12);
  });

  it('no deja sacar de una orden lo que hay en OTRA (los buckets no se suman entre sí)', async () => {
    const ordenA = await crearOrden(9002n);
    const ordenB = await crearOrden(9003n);
    await entrarConOrden(almPrimeras.id, 10, ordenA);

    await expect(
      registrarMovimientoPt(
        sesion(),
        {
          idTipoMov: tEntregaCliente.id,
          idAlmacen: almPrimeras.id,
          idModelo: modelo.id,
          fecha: '2026-08-12',
          motivo: 'Ajuste de la prueba',
          lineas: [
            {
              idColor: colorRojo.id,
              idOrden: ordenB,
              tallas: [{ idTalla: tallaCH.id, cantidad: 1 }],
            },
          ],
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorConflicto);

    // Y tampoco desde el bucket «sin orden» (que es donde caía TODO antes de §Post-F9.40).
    await expect(
      registrarMovimientoPt(
        sesion(),
        {
          idTipoMov: tEntregaCliente.id,
          idAlmacen: almPrimeras.id,
          idModelo: modelo.id,
          fecha: '2026-08-12',
          motivo: 'Ajuste de la prueba',
          lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 1 }] }],
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorConflicto);
  });

  it('el traspaso mueve el bucket de la orden y el DESTINO conserva la orden (no pierde el rastro)', async () => {
    const idOrden = await crearOrden(9004n);
    await entrarConOrden(almPrimeras.id, 30, idOrden);

    const traspaso = await registrarTraspasoPt(
      sesion(),
      {
        idAlmacenOrigen: almPrimeras.id,
        idAlmacenDestino: almSegundas.id,
        idModelo: modelo.id,
        fecha: '2026-08-12',
        motivo: 'Ajuste de la prueba',
        lineas: [
          { idColor: colorRojo.id, idOrden, tallas: [{ idTalla: tallaCH.id, cantidad: 12 }] },
        ],
      },
      bd(),
    );
    expect(traspaso.salida.lineas[0]?.idOrden).toBe(idOrden);
    expect(traspaso.entrada.lineas[0]?.idOrden).toBe(idOrden);

    const existencias = await consultarExistenciasPt(sesion(), { idModelo: modelo.id }, bd());
    expect(existencias.totalExistencia).toBe(30); // el total no cambia
    const origen = existencias.filas.find(
      (f) => f.idAlmacen === almPrimeras.id && f.idOrden === idOrden,
    );
    const destino = existencias.filas.find(
      (f) => f.idAlmacen === almSegundas.id && f.idOrden === idOrden,
    );
    expect(origen?.existencia).toBe(18);
    expect(destino?.existencia).toBe(12);
    // Y NO se creó un bucket «sin orden» en el destino (el rastro de producción se conserva).
    expect(
      existencias.filas.some((f) => f.idAlmacen === almSegundas.id && f.idOrden === null),
    ).toBe(false);
  });

  it('el bucket «SIN ORDEN» sigue moviéndose libre (arranque sin conteo físico, §Post-F9.36 punto 4)', async () => {
    await entrarConOrden(almPrimeras.id, 25, null);
    await registrarTraspasoPt(
      sesion(),
      {
        idAlmacenOrigen: almPrimeras.id,
        idAlmacenDestino: almSegundas.id,
        idModelo: modelo.id,
        fecha: '2026-08-12',
        motivo: 'Ajuste de la prueba',
        lineas: [
          { idColor: colorRojo.id, idOrden: null, tallas: [{ idTalla: tallaCH.id, cantidad: 25 }] },
        ],
      },
      bd(),
    );
    const existencias = await consultarExistenciasPt(sesion(), { idModelo: modelo.id }, bd());
    const destino = existencias.filas.find((f) => f.idAlmacen === almSegundas.id);
    expect(destino?.existencia).toBe(25);
    expect(destino?.idOrden).toBeNull();
  });

  it('una orden de OTRA empresa → 404 (A9: no se etiqueta PT con la orden ajena)', async () => {
    const otraEmpresa = await crearEmpresaPrueba(cliente, 'Otra Empresa SA');
    const ajena = await crearOrden(9005n, otraEmpresa.id);
    await expect(
      registrarMovimientoPt(
        sesion(),
        {
          idTipoMov: tEntradaInicial.id,
          idAlmacen: almPrimeras.id,
          idModelo: modelo.id,
          fecha: '2026-08-12',
          motivo: 'Ajuste de la prueba',
          lineas: [
            {
              idColor: colorRojo.id,
              idOrden: ajena,
              tallas: [{ idTalla: tallaCH.id, cantidad: 1 }],
            },
          ],
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);
  });

  it('la CANCELACIÓN neutraliza el MISMO bucket de orden (D3: inverso auditado)', async () => {
    const idOrden = await crearOrden(9006n);
    const idEntrada = await entrarConOrden(almPrimeras.id, 15, idOrden);
    await cancelarMovimientoPt(sesion(), idEntrada, { motivo: 'captura equivocada' }, bd());

    const existencias = await consultarExistenciasPt(
      sesion(),
      { idModelo: modelo.id, incluirCeros: true },
      bd(),
    );
    const fila = existencias.filas.find((f) => f.idOrden === idOrden);
    expect(fila?.existencia ?? 0).toBe(0);
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
        motivo: 'Ajuste de la prueba',
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
        motivo: 'Ajuste de la prueba',
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

describe('El almacén tiene que ser DEL TIPO del artículo (fila 0.137)', () => {
  /**
   * `Almacen.tipo` existe desde F3-E1, pero hasta la fila 0.137 NADIE lo verificaba al mover: el
   * desplegable de la pantalla era el único filtro, así que una entrada de producto terminado se
   * guardaba tan campante en la bodega de telas. Además, este servicio no validaba NADA del
   * almacén (ni empresa ni activo): esos dos casos también se cubren aquí.
   */
  it('un movimiento manual de PT contra un almacén de TELA se RECHAZA (y no escribe nada)', async () => {
    const bodegaTela = await cliente.almacen.create({
      data: { nombre: 'Naucalpan', tipo: 'TELA' },
    });
    await expect(
      registrarMovimientoPt(
        sesion(),
        {
          idTipoMov: tEntradaInicial.id,
          idAlmacen: bodegaTela.id,
          idModelo: modelo.id,
          fecha: '2026-06-19',
          motivo: 'Ajuste de la prueba',
          lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 10 }] }],
        },
        bd(),
      ),
    ).rejects.toThrow(/"Naucalpan" es de telas; este movimiento es de producto terminado/);
    // El guard corre ANTES de cualquier escritura: ni movimiento ni folio consumido.
    expect(await cliente.movimiento.count()).toBe(0);
  });

  it('un traspaso de PT cuyo DESTINO es de TELA se RECHAZA (no deja media pata)', async () => {
    await entrar(almPrimeras.id, 30);
    const bodegaTela = await cliente.almacen.create({
      data: { nombre: 'Naucalpan', tipo: 'TELA' },
    });
    const movimientosAntes = await cliente.movimiento.count();
    await expect(
      registrarTraspasoPt(
        sesion(),
        {
          idAlmacenOrigen: almPrimeras.id,
          idAlmacenDestino: bodegaTela.id,
          idModelo: modelo.id,
          fecha: '2026-06-20',
          motivo: 'Ajuste de la prueba',
          lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 10 }] }],
        },
        bd(),
      ),
    ).rejects.toThrow(/"Naucalpan" es de telas; este movimiento es de producto terminado/);
    // Ninguna de las dos patas se escribió y la existencia del origen quedó intacta.
    expect(await cliente.movimiento.count()).toBe(movimientosAntes);
    const existencias = await consultarExistenciasPt(sesion(), { idModelo: modelo.id }, bd());
    expect(existencias.totalExistencia).toBe(30);
  });

  it('un traspaso de PT cuyo ORIGEN es de TELA se RECHAZA', async () => {
    const bodegaTela = await cliente.almacen.create({
      data: { nombre: 'Naucalpan', tipo: 'TELA' },
    });
    await expect(
      registrarTraspasoPt(
        sesion(),
        {
          idAlmacenOrigen: bodegaTela.id,
          idAlmacenDestino: almPrimeras.id,
          idModelo: modelo.id,
          fecha: '2026-06-20',
          motivo: 'Ajuste de la prueba',
          lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 10 }] }],
        },
        bd(),
      ),
    ).rejects.toThrow(/"Naucalpan" es de telas; este movimiento es de producto terminado/);
    expect(await cliente.movimiento.count()).toBe(0);
  });

  it('el almacén PRIVADO de OTRA empresa se RECHAZA aunque sea de PT (A9)', async () => {
    const otra = await crearEmpresaPrueba(cliente, 'Otra Empresa');
    const ajeno = await cliente.almacen.create({
      data: { nombre: 'Bodega ajena', tipo: 'PT', idEmpresa: otra.id },
    });
    await expect(
      registrarMovimientoPt(
        sesion(),
        {
          idTipoMov: tEntradaInicial.id,
          idAlmacen: ajeno.id,
          idModelo: modelo.id,
          fecha: '2026-06-19',
          motivo: 'Ajuste de la prueba',
          lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 10 }] }],
        },
        bd(),
      ),
    ).rejects.toThrow(/"Bodega ajena" no es de esta empresa/);
    expect(await cliente.movimiento.count()).toBe(0);
  });

  it('un almacén DESACTIVADO se RECHAZA aunque sea de PT', async () => {
    const viejo = await cliente.almacen.create({
      data: { nombre: 'Bodega vieja', tipo: 'PT', activo: false },
    });
    await expect(
      registrarMovimientoPt(
        sesion(),
        {
          idTipoMov: tEntradaInicial.id,
          idAlmacen: viejo.id,
          idModelo: modelo.id,
          fecha: '2026-06-19',
          motivo: 'Ajuste de la prueba',
          lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 10 }] }],
        },
        bd(),
      ),
    ).rejects.toThrow(/"Bodega vieja" está desactivado/);
    expect(await cliente.movimiento.count()).toBe(0);
  });

  it('EL CASO FELIZ NO CAMBIA: entrada y traspaso entre dos almacenes de PT siguen pasando', async () => {
    await entrar(almPrimeras.id, 30);
    await registrarTraspasoPt(
      sesion(),
      {
        idAlmacenOrigen: almPrimeras.id,
        idAlmacenDestino: almSegundas.id,
        idModelo: modelo.id,
        fecha: '2026-06-20',
        motivo: 'Ajuste de la prueba',
        lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 10 }] }],
      },
      bd(),
    );
    const existencias = await consultarExistenciasPt(sesion(), { idModelo: modelo.id }, bd());
    expect(existencias.totalExistencia).toBe(30);
    expect(existencias.filas.find((f) => f.idAlmacen === almSegundas.id)?.existencia).toBe(10);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// Fila 0.100 — EL TRASPASO DE PT DEJA RASTRO (§Post-F9.193, decisiones 2 y 3)
// ═════════════════════════════════════════════════════════════════════════════════════════════════

describe('Fila 0.100 · el MOTIVO queda guardado (en la misma columna que telas)', () => {
  it('el motivo del movimiento manual se persiste en `Movimiento.observaciones`', async () => {
    const mov = await registrarMovimientoPt(
      sesion(),
      {
        idTipoMov: tEntradaInicial.id,
        idAlmacen: almPrimeras.id,
        idModelo: modelo.id,
        fecha: '2026-09-04',
        motivo: '  Conteo físico de septiembre  ',
        lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 12 }] }],
      },
      bd(),
    );

    // Recortado por el contrato (`.trim()`), no tal cual llegó.
    expect(mov.observaciones).toBe('Conteo físico de septiembre');
    const fila = await cliente.movimiento.findUniqueOrThrow({ where: { id: mov.id } });
    expect(fila.observaciones).toBe('Conteo físico de septiembre');
  });

  it('el motivo del traspaso queda en LAS DOS patas (la hoja lo lee de la salida)', async () => {
    await entrar(almPrimeras.id, 30);
    const traspaso = await registrarTraspasoPt(
      sesion(),
      {
        idAlmacenOrigen: almPrimeras.id,
        idAlmacenDestino: almSegundas.id,
        idModelo: modelo.id,
        fecha: '2026-09-04',
        motivo: 'Se pasan a Segundas por manchas',
        lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 10 }] }],
      },
      bd(),
    );

    expect(traspaso.salida.observaciones).toBe('Se pasan a Segundas por manchas');
    expect(traspaso.entrada.observaciones).toBe('Se pasan a Segundas por manchas');
  });

  it('sin motivo NO se guarda nada (ni el movimiento ni el traspaso dejan filas)', async () => {
    await entrar(almPrimeras.id, 30);
    const antes = await cliente.movimiento.count();

    await expect(
      registrarMovimientoPt(
        sesion(),
        {
          idTipoMov: tEntradaInicial.id,
          idAlmacen: almPrimeras.id,
          idModelo: modelo.id,
          fecha: '2026-09-04',
          lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 5 }] }],
        } as never,
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
    await expect(
      registrarTraspasoPt(
        sesion(),
        {
          idAlmacenOrigen: almPrimeras.id,
          idAlmacenDestino: almSegundas.id,
          idModelo: modelo.id,
          fecha: '2026-09-04',
          lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 5 }] }],
        } as never,
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);

    expect(await cliente.movimiento.count()).toBe(antes);
  });
});

describe('Fila 0.100 · la HOJA del traspaso de PT', () => {
  /** Registra un traspaso real de `cantidad` piezas y devuelve sus dos patas. */
  async function traspasar(cantidad: number, motivo: string) {
    await entrar(almPrimeras.id, cantidad);
    return registrarTraspasoPt(
      sesion(),
      {
        idAlmacenOrigen: almPrimeras.id,
        idAlmacenDestino: almSegundas.id,
        idModelo: modelo.id,
        fecha: '2026-09-04',
        motivo,
        lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad }] }],
      },
      bd(),
    );
  }

  it('imprime el folio QUE YA EXISTE, los dos almacenes y el motivo (sin folio nuevo, A3)', async () => {
    const t = await traspasar(10, 'Embarque del viernes');
    const datos = await armarDatosImpresoTraspasoPt(sesion(), t.salida.id, bd());

    expect(datos.folio).toBe(t.salida.folio);
    expect(datos.almacenOrigen).toBe(almPrimeras.nombre);
    expect(datos.almacenDestino).toBe(almSegundas.nombre);
    expect(datos.motivo).toBe('Embarque del viernes');
    expect(datos.totalPiezas).toBe(10);

    const texto = (await extraerTextoPdf(await generarPdfTraspasoPt(datos))).join('\n');
    expect(texto).toContain(String(t.salida.folio));
    expect(texto).toContain(almPrimeras.nombre);
    expect(texto).toContain(almSegundas.nombre);
    expect(texto).toContain('Embarque del viernes');
  });

  it('dice QUIÉN lo registró, resuelto a nombre contra la tabla de usuarios', async () => {
    // `Movimiento.idUsuario` guarda sólo el id, SIN FK (ADR-0005): el nombre no viaja por `include`
    // y hay que ir por él. Aquí se crea la fila del usuario de la sesión para medir que resuelve de
    // verdad contra la base, no contra un mock.
    await cliente.usuario.create({
      data: {
        id: 'usuario-prueba',
        username: 'almacen.pt',
        nombre: 'Almacén de producto terminado',
        email: 'almacen.pt@ejemplo.invalid',
      },
    });
    const t = await traspasar(10, 'Embarque del viernes');
    const datos = await armarDatosImpresoTraspasoPt(sesion(), t.salida.id, bd());

    expect(datos.usuario).toBe('Almacén de producto terminado');
    const texto = (await extraerTextoPdf(await generarPdfTraspasoPt(datos))).join('\n');
    expect(texto).toContain('Almacén de producto terminado');
  });

  it('⭐ un usuario que NO existe como fila deja la hoja en «—», nunca la revienta (D3)', async () => {
    // SIN crear la fila: `usuario-prueba` no existe en la base. Dar de baja o purgar una cuenta no
    // borra el movimiento que escribió — la hoja sigue saliendo, sólo sin el nombre.
    const t = await traspasar(10, 'Embarque del viernes');
    const datos = await armarDatosImpresoTraspasoPt(sesion(), t.salida.id, bd());

    expect(datos.usuario).toBeNull();
    const texto = (await extraerTextoPdf(await generarPdfTraspasoPt(datos))).join('\n');
    expect(texto).toContain('REGISTRÓ');
    expect(texto).toContain(String(t.salida.folio));
  });

  it('se puede pedir desde CUALQUIERA de las dos patas (reimpresión desde el kardex)', async () => {
    const t = await traspasar(10, 'Embarque del viernes');
    const desdeSalida = await armarDatosImpresoTraspasoPt(sesion(), t.salida.id, bd());
    const desdeEntrada = await armarDatosImpresoTraspasoPt(sesion(), t.entrada.id, bd());

    expect(desdeEntrada).toEqual(desdeSalida);
  });

  it('⭐ REGLA 0-B — un traspaso VIEJO, guardado SIN motivo, se sigue leyendo e imprimiendo', async () => {
    // Se fabrica por el MOTOR (no por el dominio) para reproducir exactamente lo que hay en `prueba`
    // desde antes de esta fila: dos patas de traspaso con `observaciones` NULL. No se repara: se lee.
    await entrar(almPrimeras.id, 30);
    const tSalida = await cliente.tipoMovimientoInventario.findUniqueOrThrow({
      where: { codigo: 'transferencia-salida' },
    });
    const tEntrada = await cliente.tipoMovimientoInventario.findUniqueOrThrow({
      where: { codigo: 'transferencia-entrada' },
    });
    const lineas: LineaMovimientoPt[] = [
      { idModelo: modelo.id, idColor: colorRojo.id, idTalla: tallaCH.id, cantidad: 7 },
    ];
    const viejo = await registrarTraspasoPtMotor(
      sesion(),
      {
        idEmpresa: empresa.id,
        idTipoMovSalida: tSalida.id,
        idTipoMovEntrada: tEntrada.id,
        idAlmacenOrigen: almPrimeras.id,
        idAlmacenDestino: almSegundas.id,
        fecha: new Date('2026-01-15T00:00:00.000Z'),
        lineas,
      },
      bd(),
    );
    expect(viejo.salida.observaciones).toBeNull();

    const datos = await armarDatosImpresoTraspasoPt(sesion(), viejo.salida.id, bd());
    expect(datos.motivo).toBeNull();
    expect(datos.totalPiezas).toBe(7);

    // Y la hoja SALE: el dato viejo que falta no degrada nada más del documento.
    const texto = (await extraerTextoPdf(await generarPdfTraspasoPt(datos))).join('\n');
    expect(texto).toContain(String(viejo.salida.folio));
    expect(texto).toContain(almPrimeras.nombre);
  });

  it('un MOVIMIENTO MANUAL no tiene hoja de traspaso (y lo dice)', async () => {
    const idMov = await entrar(almPrimeras.id, 30);
    await expect(armarDatosImpresoTraspasoPt(sesion(), idMov, bd())).rejects.toBeInstanceOf(
      ErrorValidacion,
    );
  });

  it('un movimiento de OTRA empresa no se imprime (A9 → 404)', async () => {
    const t = await traspasar(10, 'Embarque del viernes');
    const otra = await crearEmpresaPrueba(cliente, 'Otra empresa SA de CV');
    await expect(
      armarDatosImpresoTraspasoPt(
        sesionDePrueba({ idEmpresaActiva: otra.id, permisos: PERM_TODOS }),
        t.salida.id,
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);
  });

  it('sin `inventario-pt.ver` → ErrorPermiso (A4)', async () => {
    const t = await traspasar(10, 'Embarque del viernes');
    await expect(
      armarDatosImpresoTraspasoPt(sesion(['inventario-pt.mover']), t.salida.id, bd()),
    ).rejects.toThrow();
  });
});
