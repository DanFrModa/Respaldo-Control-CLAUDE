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

    // `desde` explícito A PROPÓSITO (fila 0.138): sin él manda la ventana por omisión, que se
    // mueve con el calendario — y este test, con fechas fijas de 2026, se pondría rojo solo al
    // pasar el año. Lo que aquí se mide es el saldo corrido, no el periodo.
    const kardex = await kardexPt(sesion(), { idModelo: modelo.id, desde: '2026-01-01' }, bd());
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

/**
 * ⭐ FILA 0.138 — EL KARDEX POR FECHAS, contra Postgres de verdad.
 *
 * Lo que se mide aquí es lo que el unit NO puede: que el recorte lo hace el `WHERE` y no un
 * `filter()` sobre lo que ya llegó. Por eso casi todas las aserciones son «este movimiento NO está
 * en la respuesta»: si el filtro viviera en el cliente, el renglón habría viajado igual.
 *
 * Nació de un defecto medido: con diez años cargados, el kardex de un modelo devolvía 25 000
 * renglones y 8.3 MB en una sola respuesta.
 */
describe('El kardex por FECHAS (fila 0.138)', () => {
  /** Registra una entrada de `cantidad` piezas (Rojo/CH) con la fecha dada. Devuelve el folio. */
  async function entradaEn(fecha: string, cantidad: number): Promise<number> {
    const mov = await registrarMovimientoPt(
      sesion(),
      {
        idTipoMov: tEntradaInicial.id,
        idAlmacen: almPrimeras.id,
        idModelo: modelo.id,
        fecha,
        motivo: 'Ajuste de la prueba',
        lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad }] }],
      },
      bd(),
    );
    return mov.folio;
  }

  /** `AAAA-MM-DD` de hoy en el huso del negocio, corrido `meses` hacia atrás. */
  function haceMeses(meses: number): string {
    const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
    const [a, m, d] = hoy.split('-').map(Number);
    return new Date(Date.UTC(a as number, (m as number) - 1 - meses, d)).toISOString().slice(0, 10);
  }

  it('⭐ un movimiento FUERA del periodo NO llega: el recorte lo hace el servidor', async () => {
    await entradaEn('2026-01-15', 30); // fuera
    const folioDentro = await entradaEn('2026-06-20', 7); // dentro

    const kardex = await kardexPt(
      sesion(),
      { idModelo: modelo.id, desde: '2026-06-01', hasta: '2026-06-30' },
      bd(),
    );

    expect(kardex.renglones).toHaveLength(1);
    expect(kardex.renglones[0]?.folio).toBe(folioDentro);
    expect(kardex.renglones.some((r) => r.fecha === '2026-01-15')).toBe(false);
    expect(kardex.desde).toBe('2026-06-01');
    expect(kardex.hasta).toBe('2026-06-30');
    expect(kardex.ventanaPorOmision).toBe(false);
    expect(kardex.truncado).toBe(false);
  });

  /**
   * ⭐⭐ LA PRUEBA DE QUE EL FILTRO ESTÁ EN EL `WHERE` Y NO EN JAVASCRIPT.
   *
   * Las demás pruebas de este bloque miran la salida, y la salida sale igual si alguien trae los
   * diez años y luego los recorta en memoria — que es justo lo que la fila prohíbe. Ésta las
   * distingue, cruzando el periodo con el TOPE:
   *
   *  • Filtrando en el SERVIDOR: la base sólo ve el movimiento de enero, el tope de 2 no lo alcanza
   *    y llega 1 renglón.
   *  • Filtrando DESPUÉS de traer: el tope se llevaría los 3 de junio (son los más nuevos, y la
   *    consulta pide por folio DESCENDENTE), el recorte por fecha los tiraría todos y llegarían 0.
   *
   * Es decir: si esta prueba dice 1, el `WHERE` hizo el trabajo.
   *
   * ⚠️ El periodo va en el extremo VIEJO a propósito: cuando el corte se llevaba la cola, este mismo
   * caso se escribía al revés. Si algún día el orden del `take` vuelve a cambiar, hay que darle la
   * vuelta otra vez — lo que no puede es quedarse como está y seguir pareciendo que mide algo.
   */
  it('⭐⭐ el filtro va en la CONSULTA, no en memoria (el tope no se come el periodo)', async () => {
    const folioEnero = await entradaEn('2026-01-15', 1);
    await entradaEn('2026-06-01', 1);
    await entradaEn('2026-06-02', 1);
    await entradaEn('2026-06-03', 1);

    const kardex = await kardexPt(
      sesion(),
      { idModelo: modelo.id, desde: '2026-01-01', hasta: '2026-01-31', limite: 2 },
      bd(),
    );
    expect(kardex.renglones.map((r) => r.folio)).toEqual([folioEnero]);
    expect(kardex.truncado).toBe(false);
  });

  it('⭐ los DOS bordes son INCLUSIVOS: el primer día y el último día SÍ entran', async () => {
    const folioPrimero = await entradaEn('2026-06-01', 5);
    const folioUltimo = await entradaEn('2026-06-30', 5);

    const dentro = await kardexPt(
      sesion(),
      { idModelo: modelo.id, desde: '2026-06-01', hasta: '2026-06-30' },
      bd(),
    );
    expect(dentro.renglones.map((r) => r.folio)).toEqual([folioPrimero, folioUltimo]);
  });

  it('y un día más allá de cada borde ya deja el movimiento fuera', async () => {
    const folioPrimero = await entradaEn('2026-06-01', 5);
    const folioUltimo = await entradaEn('2026-06-30', 5);

    // Un día DESPUÉS del primero: se cae el primero.
    const sinPrimero = await kardexPt(
      sesion(),
      { idModelo: modelo.id, desde: '2026-06-02', hasta: '2026-06-30' },
      bd(),
    );
    expect(sinPrimero.renglones.map((r) => r.folio)).toEqual([folioUltimo]);

    // Un día ANTES del último: se cae el último.
    const sinUltimo = await kardexPt(
      sesion(),
      { idModelo: modelo.id, desde: '2026-06-01', hasta: '2026-06-29' },
      bd(),
    );
    expect(sinUltimo.renglones.map((r) => r.folio)).toEqual([folioPrimero]);
  });

  it('⭐ SIN periodo, la ventana por omisión deja fuera lo viejo (y lo dice)', async () => {
    await entradaEn(haceMeses(24), 40); // dos años atrás: fuera de la ventana de 12 meses
    const folioReciente = await entradaEn(haceMeses(1), 6); // el mes pasado: dentro

    const porOmision = await kardexPt(sesion(), { idModelo: modelo.id }, bd());
    expect(porOmision.renglones.map((r) => r.folio)).toEqual([folioReciente]);
    expect(porOmision.ventanaPorOmision).toBe(true);
    expect(porOmision.desde).toBe(haceMeses(12));
    expect(porOmision.hasta).toBeNull();

    // Y el histórico NO se perdió: pedirlo a mano lo trae. La ventana es un default, no un candado.
    const completo = await kardexPt(sesion(), { idModelo: modelo.id, desde: '2000-01-01' }, bd());
    expect(completo.renglones).toHaveLength(2);
    expect(completo.ventanaPorOmision).toBe(false);
  });

  it('⭐ el SALDO del periodo arranca del saldo anterior, no de cero', async () => {
    await entradaEn('2026-01-15', 30); // antes del periodo
    await entradaEn('2026-06-20', 7); // dentro

    const kardex = await kardexPt(sesion(), { idModelo: modelo.id, desde: '2026-06-01' }, bd());

    // Si el saldo anterior se ignorara, este renglón diría 7 — y el kardex mentiría.
    expect(kardex.renglones).toHaveLength(1);
    expect(kardex.renglones[0]?.entrada).toBe(7);
    expect(kardex.renglones[0]?.saldo).toBe(37);

    // Y el saldo anterior viaja explícito, para que la pantalla pueda enseñar de dónde sale.
    expect(kardex.saldosIniciales).toHaveLength(1);
    expect(kardex.saldosIniciales[0]?.saldo).toBe(30);
    expect(kardex.saldosIniciales[0]?.color).toBe('Rojo');
    expect(kardex.saldosIniciales[0]?.etiquetaTalla).toBe('CH');
    expect(kardex.saldosIniciales[0]?.almacen).toBe('Primeras');
    expect(kardex.saldosIniciales[0]?.idOrden).toBeNull();
  });

  it('el saldo anterior RESTA las salidas anteriores (no es un total de entradas)', async () => {
    await entradaEn('2026-01-15', 30);
    await registrarMovimientoPt(
      sesion(),
      {
        idTipoMov: tEntregaCliente.id,
        idAlmacen: almPrimeras.id,
        idModelo: modelo.id,
        fecha: '2026-02-10',
        motivo: 'Ajuste de la prueba',
        lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 12 }] }],
      },
      bd(),
    );
    await entradaEn('2026-06-20', 1);

    const kardex = await kardexPt(sesion(), { idModelo: modelo.id, desde: '2026-06-01' }, bd());
    expect(kardex.saldosIniciales[0]?.saldo).toBe(18);
    expect(kardex.renglones[0]?.saldo).toBe(19);
  });

  it('sólo trae el saldo anterior de los artículos QUE SE MOVIERON en el periodo', async () => {
    await entradaEn('2026-01-15', 30); // Rojo/CH — se moverá en el periodo
    await registrarMovimientoPt(
      sesion(),
      {
        idTipoMov: tEntradaInicial.id,
        idAlmacen: almPrimeras.id,
        idModelo: modelo.id,
        fecha: '2026-01-16',
        motivo: 'Ajuste de la prueba',
        lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaM.id, cantidad: 50 }] }],
      },
      bd(),
    ); // Rojo/M — quieto durante el periodo
    await entradaEn('2026-06-20', 7);

    const kardex = await kardexPt(sesion(), { idModelo: modelo.id, desde: '2026-06-01' }, bd());
    expect(kardex.saldosIniciales.map((s) => s.etiquetaTalla)).toEqual(['CH']);
  });

  /**
   * ⭐⭐ EL CORTE SE LLEVA LO VIEJO, NO LO NUEVO.
   *
   * Aquí vive el defecto que casi se cuela: el folio es la secuencia atómica por empresa (A3), o sea
   * que crece con el tiempo, y `ORDER BY folio ASC LIMIT n` devolvía **los n más viejos** de la
   * ventana. Medido contra una base con folios cronológicos (25 000 renglones, 2 340 en doce meses),
   * la pantalla decía «Periodo: 2025-09-05 en adelante» y enseñaba hasta **2026-02-07**: siete meses
   * recientes escondidos. Un kardex se abre para ver el final.
   *
   * Lo que fija esta prueba es la DIRECCIÓN, y el saldo que la acompaña.
   */
  it('⭐⭐ el TOPE conserva el FINAL del periodo, y el saldo sigue cuadrando', async () => {
    const folios = [
      await entradaEn('2026-06-01', 1),
      await entradaEn('2026-06-02', 1),
      await entradaEn('2026-06-03', 1),
    ];

    const cortado = await kardexPt(
      sesion(),
      { idModelo: modelo.id, desde: '2026-01-01', limite: 2 },
      bd(),
    );
    expect(cortado.renglones).toHaveLength(2);
    expect(cortado.truncado).toBe(true);
    expect(cortado.limite).toBe(2);
    // Los DOS ÚLTIMOS, en orden cronológico. Con el corte al revés esto sería [folios0, folios1].
    expect(cortado.renglones.map((r) => r.folio)).toEqual([folios[1], folios[2]]);

    // Y el saldo NO arranca de cero ni del saldo del periodo: arranca de lo que había justo antes
    // del primer renglón visible — o sea, contando el movimiento que el tope se saltó.
    expect(cortado.saldosIniciales).toHaveLength(1);
    expect(cortado.saldosIniciales[0]?.saldo).toBe(1);
    expect(cortado.renglones.map((r) => r.saldo)).toEqual([2, 3]);

    // Con sitio para los tres, no hay corte, no hay saldo anterior y el último saldo es el mismo.
    const completo = await kardexPt(
      sesion(),
      { idModelo: modelo.id, desde: '2026-01-01', limite: 3 },
      bd(),
    );
    expect(completo.renglones).toHaveLength(3);
    expect(completo.truncado).toBe(false);
    expect(completo.saldosIniciales).toHaveLength(0);
    expect(completo.renglones.map((r) => r.saldo)).toEqual([1, 2, 3]);
  });

  /**
   * ⭐ EL BORDE DEL CORTE, QUE ES POR FOLIO Y NO POR FECHA. Tres movimientos **del mismo día**, tope
   * de 2: el que queda fuera es uno de ese día, así que el saldo anterior tiene que contarlo. Si el
   * anclaje usara la fecha (`fecha < la del primer renglón visible`) ese movimiento no entraría en
   * ninguna de las dos partes y el saldo se quedaría corto — el mismo error de borde de `<`/`<=`,
   * pero por folio.
   */
  it('⭐ tres movimientos del MISMO día con tope 2: el que se cae cuenta en el saldo anterior', async () => {
    const folios = [
      await entradaEn('2026-06-10', 5),
      await entradaEn('2026-06-10', 7),
      await entradaEn('2026-06-10', 9),
    ];

    const kardex = await kardexPt(
      sesion(),
      { idModelo: modelo.id, desde: '2026-06-01', limite: 2 },
      bd(),
    );
    expect(kardex.renglones.map((r) => r.folio)).toEqual([folios[1], folios[2]]);
    expect(kardex.saldosIniciales[0]?.saldo).toBe(5);
    expect(kardex.renglones.map((r) => r.saldo)).toEqual([12, 21]);
  });

  /**
   * ⭐⭐ CADA CONDICIÓN DE LA CONSULTA DEL SALDO ANTERIOR, CON UNA ASERCIÓN QUE MUERE AL QUITARLA.
   *
   * ⚠️ POR QUÉ ESTE BLOQUE EXISTE. `saldosAntesDelPeriodo` es SQL crudo y su modo de falla es el
   * peor que hay: si alguien toca su `WHERE`, **todas las filas de la columna «Saldo» mienten a la
   * vez y mienten de forma creíble** — nada se ve raro, sólo los números están mal. Las primeras
   * pruebas del periodo miraban `renglones` y **nunca `saldosIniciales`**, así que seis mutaciones
   * de esa consulta sobrevivían enteras.
   *
   * 🔑 Y LA LÍNEA FINA, que hay que entender antes de añadir nada aquí: **no todas las condiciones
   * pueden tener una prueba que muera.** La llave de agrupación es color×talla×almacén×orden, y el
   * llamador se queda sólo con los artículos que aparecen en el periodo. Entonces:
   *  • `id_empresa` (A9), `id_modelo`, el borde de fecha y el ancla **NO** están en esa llave:
   *    quitarlos suma cosas ajenas DENTRO del mismo grupo ⇒ contaminación real ⇒ prueba que muere.
   *  • `id_color`/`id_talla`/`id_almacen`/`id_orden` del `WHERE` **sí** están en la llave: quitarlos
   *    sólo produce grupos de más que el llamador descarta ⇒ son guardas de RENDIMIENTO, y ninguna
   *    aserción puede morir al quitarlas. Lo que sí se puede fijar —y se fija abajo— es que esas
   *    cuatro dimensiones **no se mezclen entre sí**, que es lo que se rompería si alguien tocara
   *    el `GROUP BY`.
   */
  describe('el SALDO ANTERIOR, condición por condición', () => {
    /** Entrada de Rojo/CH con fecha, almacén y (opcionalmente) empresa/modelo/color/talla propios. */
    async function entrada(opciones: {
      fecha: string;
      cantidad: number;
      idAlmacen?: number;
      idModelo?: number;
      idColor?: number;
      idTalla?: number;
      idOrden?: number | null;
      idEmpresa?: number;
      salida?: boolean;
    }): Promise<number> {
      const ses = sesionDePrueba({
        idEmpresaActiva: opciones.idEmpresa ?? empresa.id,
        permisos: PERM_TODOS,
      });
      const mov = await registrarMovimientoPt(
        ses,
        {
          idTipoMov: opciones.salida === true ? tEntregaCliente.id : tEntradaInicial.id,
          idAlmacen: opciones.idAlmacen ?? almPrimeras.id,
          idModelo: opciones.idModelo ?? modelo.id,
          fecha: opciones.fecha,
          motivo: 'Ajuste de la prueba',
          lineas: [
            {
              idColor: opciones.idColor ?? colorRojo.id,
              ...(opciones.idOrden === undefined ? {} : { idOrden: opciones.idOrden }),
              tallas: [{ idTalla: opciones.idTalla ?? tallaCH.id, cantidad: opciones.cantidad }],
            },
          ],
        },
        bd(),
      );
      return mov.folio;
    }

    it('⭐ A9: el saldo anterior de OTRA EMPRESA no se suma al de la mía', async () => {
      // La llave de agrupación NO lleva empresa: sin el filtro, estos 999 caerían en MI grupo.
      const otra = await crearEmpresaPrueba(cliente, 'Otra Empresa de Prueba');
      await entrada({ fecha: '2026-01-10', cantidad: 999, idEmpresa: otra.id });
      await entrada({ fecha: '2026-01-15', cantidad: 30 });
      await entrada({ fecha: '2026-06-20', cantidad: 7 });

      const kardex = await kardexPt(sesion(), { idModelo: modelo.id, desde: '2026-06-01' }, bd());
      expect(kardex.saldosIniciales).toHaveLength(1);
      expect(kardex.saldosIniciales[0]?.saldo).toBe(30);
      expect(kardex.renglones[0]?.saldo).toBe(37);
    });

    it('⭐ el saldo anterior es DEL MODELO pedido, no de todos', async () => {
      // El modelo tampoco está en la llave de agrupación: mismo riesgo que la empresa.
      const otroModelo = await cliente.modelo.create({ data: { codigo: 'B-200' } });
      await entrada({ fecha: '2026-01-10', cantidad: 500, idModelo: otroModelo.id });
      await entrada({ fecha: '2026-01-15', cantidad: 30 });
      await entrada({ fecha: '2026-06-20', cantidad: 7 });

      const kardex = await kardexPt(sesion(), { idModelo: modelo.id, desde: '2026-06-01' }, bd());
      expect(kardex.saldosIniciales).toHaveLength(1);
      expect(kardex.saldosIniciales[0]?.saldo).toBe(30);
    });

    it('⭐ EL BORDE: un movimiento fechado EXACTAMENTE en `desde` es del periodo, no del saldo anterior', async () => {
      // Con `<=` en vez de `<` este movimiento se contaría DOS veces: en el saldo anterior y como
      // renglón. Es el caso que separa un borde de otro, y por eso lleva un día propio.
      await entrada({ fecha: '2026-01-15', cantidad: 30 });
      const folioBorde = await entrada({ fecha: '2026-06-01', cantidad: 7 });

      const kardex = await kardexPt(sesion(), { idModelo: modelo.id, desde: '2026-06-01' }, bd());
      expect(kardex.renglones.map((r) => r.folio)).toEqual([folioBorde]);
      expect(kardex.saldosIniciales[0]?.saldo).toBe(30);
      expect(kardex.renglones[0]?.saldo).toBe(37); // 30 + 7, no 44
    });

    it('⭐⭐ EL INVARIANTE: el último saldo visible NO depende del tope (y cuadra con la existencia)', async () => {
      // La prueba más fuerte del anclaje: se corte donde se corte, el último renglón tiene que
      // decir la existencia REAL del artículo (Σ kardex, D3). Si el saldo anterior se calculara
      // con la fecha en vez de con la llave del corte, esto se desmoronaría en cuanto `truncado`.
      for (const dia of ['01', '02', '03', '04', '05']) {
        await entrada({ fecha: `2026-06-${dia}`, cantidad: 10 });
      }
      const existencia = await consultarExistenciasPt(sesion(), { idModelo: modelo.id }, bd());
      expect(existencia.totalExistencia).toBe(50);

      for (const limite of [5, 3, 2, 1]) {
        const k = await kardexPt(
          sesion(),
          { idModelo: modelo.id, desde: '2026-01-01', limite },
          bd(),
        );
        expect(k.renglones).toHaveLength(Math.min(limite, 5));
        expect(k.renglones[k.renglones.length - 1]?.saldo).toBe(50);
      }
    });

    it('⭐ el saldo anterior es POR ORDEN: dos órdenes del mismo artículo no comparten saldo', async () => {
      // Muere si `claveArticuloPt` deja de mirar la orden: las dos se fundirían en un solo saldo.
      const cli = await cliente.cliente.create({ data: { nombre: 'Cliente del kardex' } });
      const ordenA = (
        await cliente.orden.create({
          data: { folio: 7001n, idEmpresa: empresa.id, idModelo: modelo.id, idCliente: cli.id },
        })
      ).id;
      const ordenB = (
        await cliente.orden.create({
          data: { folio: 7002n, idEmpresa: empresa.id, idModelo: modelo.id, idCliente: cli.id },
        })
      ).id;

      await entrada({ fecha: '2026-01-10', cantidad: 40, idOrden: ordenA });
      await entrada({ fecha: '2026-01-11', cantidad: 5, idOrden: ordenB });
      await entrada({ fecha: '2026-06-20', cantidad: 1, idOrden: ordenA });
      await entrada({ fecha: '2026-06-21', cantidad: 2, idOrden: ordenB });

      const kardex = await kardexPt(sesion(), { idModelo: modelo.id, desde: '2026-06-01' }, bd());
      const porOrden = new Map(kardex.saldosIniciales.map((s) => [s.idOrden, s.saldo]));
      expect(porOrden.get(ordenA)).toBe(40);
      expect(porOrden.get(ordenB)).toBe(5);
      // Y el saldo corrido de cada renglón sigue su propia orden (41 y 7, no 46 y 48).
      expect(kardex.renglones.map((r) => r.saldo)).toEqual([41, 7]);
    });

    /**
     * ⭐⭐ EL DESEMPATE `d."id"`: LO QUE PASA CUANDO EL CORTE CAE **DENTRO** DE UN MOVIMIENTO.
     *
     * ⚠️ POR QUÉ FALTABA, que es lo interesante: todas las demás pruebas de este archivo capturan
     * movimientos de UN SOLO renglón, así que `(folio, id)` degenera en `folio` y el desempate
     * nunca se ejercita — se podía **borrar `d."id"` de la comparación y las 56 pruebas seguían en
     * verde**. Pero en este sistema un movimiento de UN renglón es la excepción: lo normal es la
     * matriz color×talla (D4), o sea **varios renglones compartiendo folio**. Y el tope corta por
     * renglones, no por movimientos: tarde o temprano cae en medio de una matriz.
     *
     * El caso: una matriz de dos tallas y un tope que parte el movimiento por la mitad. El renglón
     * que queda fuera tiene EL MISMO folio que el ancla, así que sólo el `id` puede distinguirlo.
     * Sin desempate, sus 100 piezas no entran ni en la lista ni en el saldo anterior: **se
     * evaporan en silencio**, que es exactamente la mentira creíble que esta fila vino a impedir.
     */
    it('⭐⭐ el corte DENTRO de una matriz color×talla no pierde el renglón que quedó fuera', async () => {
      // Un movimiento, DOS renglones (mismo folio); luego otro movimiento de la misma talla CH.
      await registrarMovimientoPt(
        sesion(),
        {
          idTipoMov: tEntradaInicial.id,
          idAlmacen: almPrimeras.id,
          idModelo: modelo.id,
          fecha: '2026-06-10',
          motivo: 'Ajuste de la prueba',
          lineas: [
            {
              idColor: colorRojo.id,
              tallas: [
                { idTalla: tallaCH.id, cantidad: 100 },
                { idTalla: tallaM.id, cantidad: 200 },
              ],
            },
          ],
        },
        bd(),
      );
      await entrada({ fecha: '2026-06-11', cantidad: 7 }); // Rojo/CH

      // Premisa que esta prueba da por buena y por eso deja fijada: dentro de un movimiento los
      // renglones salen en el ORDEN EN QUE SE CAPTURARON (por `id`), no en cualquiera.
      const enteroKardex = await kardexPt(
        sesion(),
        { idModelo: modelo.id, desde: '2026-01-01', limite: 3 },
        bd(),
      );
      expect(enteroKardex.renglones.map((r) => [r.etiquetaTalla, r.saldo])).toEqual([
        ['CH', 100],
        ['M', 200],
        ['CH', 107],
      ]);

      // Y ahora el corte JUSTO EN MEDIO de esa matriz: se queda fuera el renglón CH del primer
      // movimiento, que comparte folio con el ancla.
      const cortado = await kardexPt(
        sesion(),
        { idModelo: modelo.id, desde: '2026-01-01', limite: 2 },
        bd(),
      );
      expect(cortado.truncado).toBe(true);
      expect(cortado.renglones.map((r) => r.etiquetaTalla)).toEqual(['M', 'CH']);

      // ⭐ EL NÚMERO QUE LO DELATA: 107, no 7. Sin el desempate por `id`, las 100 piezas del renglón
      // cortado no las recoge nadie y este saldo diría 7.
      expect(cortado.renglones[1]?.saldo).toBe(107);
      // Y el saldo anterior las declara, para que se vea de dónde salen.
      const chPrevio = cortado.saldosIniciales.find((x) => x.etiquetaTalla === 'CH');
      expect(chPrevio?.saldo).toBe(100);
    });

    it('un artículo que quedó en CERO antes del periodo no ensucia el saldo anterior', async () => {
      // Muere si se quita el `HAVING saldo <> 0`: aparecería un renglón «Saldo anterior: 0».
      await entrada({ fecha: '2026-01-10', cantidad: 20 });
      await entrada({ fecha: '2026-01-11', cantidad: 20, salida: true });
      await entrada({ fecha: '2026-06-20', cantidad: 3 });

      const kardex = await kardexPt(sesion(), { idModelo: modelo.id, desde: '2026-06-01' }, bd());
      expect(kardex.saldosIniciales).toHaveLength(0);
      expect(kardex.renglones[0]?.saldo).toBe(3);
    });

    it('⭐ las cuatro dimensiones del artículo NO se mezclan entre sí (color/talla/almacén/orden)', async () => {
      // Ésta es la red del `GROUP BY` (las condiciones equivalentes del `WHERE` son de rendimiento,
      // ver la nota del bloque): cada artículo trae SU saldo, no la suma de sus vecinos.
      const cli = await cliente.cliente.create({ data: { nombre: 'Cliente mezcla' } });
      const orden = (
        await cliente.orden.create({
          data: { folio: 7003n, idEmpresa: empresa.id, idModelo: modelo.id, idCliente: cli.id },
        })
      ).id;
      const colorAzul = await cliente.color.create({ data: { nombre: 'Azul' } });

      // Cuatro artículos que sólo se diferencian en UNA dimensión cada uno.
      await entrada({ fecha: '2026-01-10', cantidad: 11 }); //  Rojo/CH/Primeras/sin orden
      await entrada({ fecha: '2026-01-10', cantidad: 22, idColor: colorAzul.id }); // otro COLOR
      await entrada({ fecha: '2026-01-10', cantidad: 33, idTalla: tallaM.id }); // otra TALLA
      await entrada({ fecha: '2026-01-10', cantidad: 44, idAlmacen: almSegundas.id }); // otro ALMACÉN
      await entrada({ fecha: '2026-01-10', cantidad: 55, idOrden: orden }); // otra ORDEN

      // Los cinco se mueven en el periodo, para que los cinco tengan que salir.
      await entrada({ fecha: '2026-06-20', cantidad: 1 });
      await entrada({ fecha: '2026-06-20', cantidad: 1, idColor: colorAzul.id });
      await entrada({ fecha: '2026-06-20', cantidad: 1, idTalla: tallaM.id });
      await entrada({ fecha: '2026-06-20', cantidad: 1, idAlmacen: almSegundas.id });
      await entrada({ fecha: '2026-06-20', cantidad: 1, idOrden: orden });

      const kardex = await kardexPt(sesion(), { idModelo: modelo.id, desde: '2026-06-01' }, bd());
      const saldos = kardex.saldosIniciales.map((s) => s.saldo).sort((x, y) => x - y);
      expect(saldos).toEqual([11, 22, 33, 44, 55]);

      // ⚠️ Y el saldo CORRIDO de cada renglón, que es la otra mitad: la consulta agrupa bien, pero
      // el saldo se lleva en memoria con `claveArticuloPt`. Si esa llave dejara de mirar una de las
      // cuatro dimensiones, dos artículos compartirían saldo y la de arriba seguiría en verde —
      // porque el arreglo `saldosIniciales` lo arma el SQL, no la llave.
      const corridos = kardex.renglones.map((r) => r.saldo).sort((x, y) => x - y);
      expect(corridos).toEqual([12, 23, 34, 45, 56]);
    });
  });

  it('el periodo convive con los demás filtros (almacén) sin colarse nada', async () => {
    await entradaEn('2026-06-10', 4); // Primeras
    await registrarMovimientoPt(
      sesion(),
      {
        idTipoMov: tEntradaInicial.id,
        idAlmacen: almSegundas.id,
        idModelo: modelo.id,
        fecha: '2026-06-11',
        motivo: 'Ajuste de la prueba',
        lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 9 }] }],
      },
      bd(),
    );

    const soloSegundas = await kardexPt(
      sesion(),
      { idModelo: modelo.id, desde: '2026-06-01', idAlmacen: almSegundas.id },
      bd(),
    );
    expect(soloSegundas.renglones).toHaveLength(1);
    expect(soloSegundas.renglones[0]?.almacen).toBe('Segundas');
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
