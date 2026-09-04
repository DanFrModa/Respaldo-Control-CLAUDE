/**
 * Tests de integración del INVENTARIO de TELAS y AVÍOS (F4-E1). Postgres efímero (testcontainers).
 * Cubre lo que la ficha exige:
 *  (a) existencia = SUM de movimientos (D3) y las vistas lo reflejan (telas y avíos);
 *  (b) ajuste de ENTRADA de tela con LOTE multi-componente (D5: Felpa + Cardigan, mismo color);
 *  (c) salida de tela a una orden (traza Salidas.IdOrdenes → origenId) y no-negativo;
 *  (d) traspaso de tela atómico (dos patas; sin existencia no deja nada);
 *  (e) cancelación de movimiento (inverso) neutraliza el saldo y no se re-cancela;
 *  (f) avíos: ajuste, traspaso, no-negativo, multi-almacén y distinción esGenerico;
 *  (g) ex-acceso #7: sin `telas.ver-totales` el kardex omite costos/importes.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type {
  Almacen,
  Avio,
  Color,
  Empresa,
  PrismaClient,
  Proveedor,
  Tela,
} from '../../datos/index.js';
import { ErrorConflicto, ErrorValidacion } from '../../comun/errores.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import type { ClavePermiso } from '../../contrato/index.js';
import {
  ajustarInventarioTela,
  cancelarMovimientoTela,
  consultarExistenciasTela,
  kardexTela,
  registrarSalidaTelaAOrden,
  traspasarTela,
} from './telas.js';
import {
  ajustarInventarioAvio,
  cancelarMovimientoAvio,
  consultarExistenciasAvio,
  kardexAvio,
  traspasarAvio,
} from './avios.js';

let cliente: PrismaClient;
let empresa: Empresa;
let colorRojo: Color;
let telaFelpa: Tela;
let telaCardigan: Tela;
let avioCierre: Avio;
let avioGenerico: Avio;
let proveedor: Proveedor;
let almA: Almacen;
let almB: Almacen;
let almAvioA: Almacen;
let almAvioB: Almacen;
let idTipoAjusteEntrada: number;
let idTipoAjusteSalida: number;

const PERM_TELAS: ClavePermiso[] = [
  'inventario-telas.ver',
  'inventario-telas.mover',
  'telas.ver-totales',
];
const PERM_AVIOS: ClavePermiso[] = ['inventario-avios.ver', 'inventario-avios.mover'];
const sesion = (permisos: ClavePermiso[]) =>
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
  colorRojo = await cliente.color.create({ data: { nombre: 'Rojo' } });
  telaFelpa = await cliente.tela.create({ data: { nombre: 'Felpa' } });
  telaCardigan = await cliente.tela.create({ data: { nombre: 'Cardigan' } });
  avioCierre = await cliente.avio.create({ data: { clave: 'CIE-01', descripcion: 'Cierre 20cm' } });
  avioGenerico = await cliente.avio.create({
    data: { clave: 'HIL-01', descripcion: 'Hilo blanco', esGenerico: true },
  });
  proveedor = await cliente.proveedor.create({ data: { nombre: 'Textiles SA' } });
  almA = await cliente.almacen.create({ data: { nombre: 'Bodega A', tipo: 'TELA' } });
  almB = await cliente.almacen.create({ data: { nombre: 'Bodega B', tipo: 'TELA' } });
  // Fila 0.137 — los avíos NO se mueven en un almacén de telas: el dominio exige que el tipo del
  // almacén case con el del artículo, así que el bloque de avíos tiene los suyos.
  almAvioA = await cliente.almacen.create({ data: { nombre: 'Avíos A', tipo: 'AVIO' } });
  almAvioB = await cliente.almacen.create({ data: { nombre: 'Avíos B', tipo: 'AVIO' } });
  // Tipos de movimiento que el dominio resuelve por código.
  const tipos = await cliente.tipoMovimientoInventario.createManyAndReturn({
    data: [
      { codigo: 'ajuste-entrada', nombre: 'Ajuste (Entrada)', direccion: 'entrada' },
      { codigo: 'ajuste-salida', nombre: 'Ajuste (Salida)', direccion: 'salida' },
      { codigo: 'salida-a-orden', nombre: 'Salida a Orden', direccion: 'salida' },
      { codigo: 'transferencia-salida', nombre: 'Transf (Salida)', direccion: 'salida' },
      { codigo: 'transferencia-entrada', nombre: 'Transf (Entrada)', direccion: 'entrada' },
    ],
  });
  idTipoAjusteEntrada = tipos.find((t) => t.codigo === 'ajuste-entrada')!.id;
  idTipoAjusteSalida = tipos.find((t) => t.codigo === 'ajuste-salida')!.id;
});

/** Crea una orden mínima para la salida-a-orden. Devuelve su id. */
async function crearOrden(): Promise<number> {
  const clienteNegocio = await cliente.cliente.create({ data: { nombre: 'Cliente X' } });
  const modelo = await cliente.modelo.create({ data: { codigo: 'M-1', descripcion: 'Playera' } });
  const orden = await cliente.orden.create({
    data: {
      folio: 1n,
      idEmpresa: empresa.id,
      idModelo: modelo.id,
      idCliente: clienteNegocio.id,
    },
  });
  return orden.id;
}

/** Crea un lote con Felpa+Cardigan (D5) por un ajuste de entrada. Devuelve el id del lote. */
async function entrarLote(cantFelpa: number, cantCardigan: number): Promise<number> {
  const mov = await ajustarInventarioTela(
    sesion(PERM_TELAS),
    {
      idTipoMov: idTipoAjusteEntrada,
      idAlmacen: almA.id,
      fecha: '2026-06-20',
      motivo: 'inventario inicial',
      lote: {
        idColor: colorRojo.id,
        idProveedor: proveedor.id,
        factura: 'F-100',
        componentes: [
          { idTela: telaFelpa.id, cantidad: cantFelpa, peso: 25 },
          { idTela: telaCardigan.id, cantidad: cantCardigan },
        ],
      },
    },
    bd(),
  );
  // El idLote del renglón de la salida.
  const idLote = mov.renglones[0]?.idLote;
  if (idLote == null) throw new Error('el lote no se creó');
  return idLote;
}

describe('Telas — ajuste con lote multi-componente (D5)', () => {
  it('(a/b) crea el lote con 2 componentes y la existencia = lo capturado', async () => {
    const idLote = await entrarLote(100, 40);
    const existencias = await consultarExistenciasTela(sesion(PERM_TELAS), {}, bd());
    // 2 filas: Felpa×lote y Cardigan×lote en Bodega A.
    expect(existencias.filas).toHaveLength(2);
    const felpa = existencias.filas.find((f) => f.idTela === telaFelpa.id);
    const cardigan = existencias.filas.find((f) => f.idTela === telaCardigan.id);
    expect(felpa?.existencia).toBe(100);
    expect(cardigan?.existencia).toBe(40);
    expect(felpa?.idLote).toBe(idLote);
    expect(felpa?.color).toBe('Rojo');
    expect(felpa?.proveedor).toBe('Textiles SA');
    // Los componentes del lote vienen para expandir en la UI (D5).
    expect(felpa?.componentes).toHaveLength(2);
    expect(existencias.totalExistencia).toBe(140);
  });

  it('property: existencia mostrada = SUM de movimientos del kardex', async () => {
    const idLote = await entrarLote(100, 40);
    // Una salida parcial de Felpa.
    await ajustarInventarioTela(
      sesion(PERM_TELAS),
      {
        idTipoMov: idTipoAjusteSalida,
        idAlmacen: almA.id,
        fecha: '2026-06-21',
        motivo: 'merma',
        lineas: [{ idTela: telaFelpa.id, idLote, cantidad: 30 }],
      },
      bd(),
    );
    const kardex = await kardexTela(sesion(PERM_TELAS), { idTela: telaFelpa.id }, bd());
    const sumaKardex = kardex.renglones.reduce((s, r) => s + r.entrada - r.salida, 0);
    const existencias = await consultarExistenciasTela(
      sesion(PERM_TELAS),
      { idTela: telaFelpa.id },
      bd(),
    );
    expect(existencias.filas[0]?.existencia).toBe(70);
    expect(sumaKardex).toBe(70);
    // El saldo corrido del último renglón coincide.
    expect(kardex.renglones.at(-1)?.saldo).toBe(70);
  });

  it('rechaza crear un lote en un ajuste de dirección SALIDA (el lote solo entra)', async () => {
    await expect(
      ajustarInventarioTela(
        sesion(PERM_TELAS),
        {
          idTipoMov: idTipoAjusteSalida, // dirección salida
          idAlmacen: almA.id,
          fecha: '2026-06-20',
          motivo: 'intento inválido',
          lote: {
            idColor: colorRojo.id,
            componentes: [{ idTela: telaFelpa.id, cantidad: 10 }],
          },
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('rechaza un ajuste con líneas vacías', async () => {
    await expect(
      ajustarInventarioTela(
        sesion(PERM_TELAS),
        {
          idTipoMov: idTipoAjusteSalida,
          idAlmacen: almA.id,
          fecha: '2026-06-20',
          motivo: 'sin renglones',
          lineas: [],
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });
});

describe('Telas — salida a orden y no-negativo (D3)', () => {
  it('(c) descuenta ligada a la orden (origenId) y rechaza dejar negativo', async () => {
    const idLote = await entrarLote(100, 40);
    const idOrden = await crearOrden();
    const salida = await registrarSalidaTelaAOrden(
      sesion(PERM_TELAS),
      {
        idOrden,
        idAlmacen: almA.id,
        fecha: '2026-06-21',
        lineas: [{ idTela: telaFelpa.id, idLote, cantidad: 60 }],
      },
      bd(),
    );
    expect(salida.direccion).toBe('salida');
    expect(salida.origenTipo).toBe('salida-tela-orden');
    expect(salida.origenId).toBe(String(idOrden));

    const exis = await consultarExistenciasTela(sesion(PERM_TELAS), { idTela: telaFelpa.id }, bd());
    expect(exis.filas[0]?.existencia).toBe(40);

    // Intentar sacar más de lo que hay → rechazado, sin tocar la existencia.
    await expect(
      registrarSalidaTelaAOrden(
        sesion(PERM_TELAS),
        {
          idOrden,
          idAlmacen: almA.id,
          fecha: '2026-06-21',
          lineas: [{ idTela: telaFelpa.id, idLote, cantidad: 50 }],
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorConflicto);
    const exis2 = await consultarExistenciasTela(
      sesion(PERM_TELAS),
      { idTela: telaFelpa.id },
      bd(),
    );
    expect(exis2.filas[0]?.existencia).toBe(40);
  });
});

describe('Telas — traspaso atómico (A2)', () => {
  it('(d) mueve del origen al destino sin cambiar el total', async () => {
    const idLote = await entrarLote(100, 40);
    const traspaso = await traspasarTela(
      sesion(PERM_TELAS),
      {
        idAlmacenOrigen: almA.id,
        idAlmacenDestino: almB.id,
        fecha: '2026-06-21',
        lineas: [{ idTela: telaFelpa.id, idLote, cantidad: 30 }],
      },
      bd(),
    );
    expect(traspaso.salida.direccion).toBe('salida');
    expect(traspaso.entrada.direccion).toBe('entrada');

    const enA = await consultarExistenciasTela(
      sesion(PERM_TELAS),
      { idTela: telaFelpa.id, idAlmacen: almA.id },
      bd(),
    );
    const enB = await consultarExistenciasTela(
      sesion(PERM_TELAS),
      { idTela: telaFelpa.id, idAlmacen: almB.id },
      bd(),
    );
    expect(enA.filas[0]?.existencia).toBe(70);
    expect(enB.filas[0]?.existencia).toBe(30);
  });

  it('traspaso sin existencia en el origen NO deja nada (atómico)', async () => {
    const idLote = await entrarLote(10, 5);
    await expect(
      traspasarTela(
        sesion(PERM_TELAS),
        {
          idAlmacenOrigen: almA.id,
          idAlmacenDestino: almB.id,
          fecha: '2026-06-21',
          lineas: [{ idTela: telaFelpa.id, idLote, cantidad: 50 }],
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorConflicto);
    const enB = await consultarExistenciasTela(
      sesion(PERM_TELAS),
      { idTela: telaFelpa.id, idAlmacen: almB.id },
      bd(),
    );
    expect(enB.filas).toHaveLength(0);
  });

  it('RECHAZA cancelar UNA SOLA PATA de un traspaso (no descuadra los almacenes) — obs. #2', async () => {
    const idLote = await entrarLote(100, 40);
    const traspaso = await traspasarTela(
      sesion(PERM_TELAS),
      {
        idAlmacenOrigen: almA.id,
        idAlmacenDestino: almB.id,
        fecha: '2026-06-21',
        lineas: [{ idTela: telaFelpa.id, idLote, cantidad: 30 }],
      },
      bd(),
    );
    // Cancelar SOLO la pata de salida debe rechazarse (dejaría el origen recuperado y el destino con
    // la entrada viva → +30 fantasma en el total).
    await expect(
      cancelarMovimientoTela(sesion(PERM_TELAS), traspaso.salida.id, { motivo: 'error' }, bd()),
    ).rejects.toBeInstanceOf(ErrorConflicto);
    // Y la pata de entrada igual.
    await expect(
      cancelarMovimientoTela(sesion(PERM_TELAS), traspaso.entrada.id, { motivo: 'error' }, bd()),
    ).rejects.toBeInstanceOf(ErrorConflicto);
    // Ambos almacenes quedan EXACTAMENTE como tras el traspaso (70 en A, 30 en B): nada se canceló.
    const enA = await consultarExistenciasTela(
      sesion(PERM_TELAS),
      { idTela: telaFelpa.id, idAlmacen: almA.id },
      bd(),
    );
    const enB = await consultarExistenciasTela(
      sesion(PERM_TELAS),
      { idTela: telaFelpa.id, idAlmacen: almB.id },
      bd(),
    );
    expect(enA.filas[0]?.existencia).toBe(70);
    expect(enB.filas[0]?.existencia).toBe(30);
  });
});

describe('Telas — cancelación por inverso (D3/A7)', () => {
  it('(e) el inverso neutraliza el saldo y no se re-cancela', async () => {
    const idLote = await entrarLote(100, 40);
    const salida = await ajustarInventarioTela(
      sesion(PERM_TELAS),
      {
        idTipoMov: idTipoAjusteSalida,
        idAlmacen: almA.id,
        fecha: '2026-06-21',
        motivo: 'merma',
        lineas: [{ idTela: telaFelpa.id, idLote, cantidad: 30 }],
      },
      bd(),
    );
    // Tras la salida: 70.
    const cancelado = await cancelarMovimientoTela(
      sesion(PERM_TELAS),
      salida.id,
      { motivo: 'capturé de más' },
      bd(),
    );
    expect(cancelado.cancelado).toBe(true);
    const exis = await consultarExistenciasTela(sesion(PERM_TELAS), { idTela: telaFelpa.id }, bd());
    expect(exis.filas[0]?.existencia).toBe(100); // el inverso re-entró las 30.

    // No se re-cancela.
    await expect(
      cancelarMovimientoTela(sesion(PERM_TELAS), salida.id, { motivo: 'otra vez' }, bd()),
    ).rejects.toBeInstanceOf(ErrorConflicto);
  });
});

describe('Telas — ex-acceso #7 (importes)', () => {
  it('(g) sin telas.ver-totales el kardex omite costos/importes', async () => {
    const idLote = await entrarLote(100, 40);
    // Captura una salida con permiso de importes (no afecta: ajustes van con costo NULL).
    await ajustarInventarioTela(
      sesion(PERM_TELAS),
      {
        idTipoMov: idTipoAjusteSalida,
        idAlmacen: almA.id,
        fecha: '2026-06-21',
        motivo: 'merma',
        lineas: [{ idTela: telaFelpa.id, idLote, cantidad: 10 }],
      },
      bd(),
    );
    const sinImportes: ClavePermiso[] = ['inventario-telas.ver', 'inventario-telas.mover'];
    const kardex = await kardexTela(sesion(sinImportes), { idTela: telaFelpa.id }, bd());
    // Las cantidades sí se ven; los costos/importes vienen null.
    expect(kardex.renglones.every((r) => r.costoUnit === null && r.importe === null)).toBe(true);
    expect(kardex.renglones.length).toBeGreaterThan(0);
  });
});

describe('Avíos — multi-almacén (R4)', () => {
  it('(f) ajuste de entrada, existencia por avío×almacén y distingue esGenerico', async () => {
    await ajustarInventarioAvio(
      sesion(PERM_AVIOS),
      {
        idTipoMov: idTipoAjusteEntrada,
        idAlmacen: almAvioA.id,
        fecha: '2026-06-20',
        motivo: 'conteo físico',
        lineas: [
          { idAvio: avioCierre.id, cantidad: 500 },
          { idAvio: avioGenerico.id, cantidad: 1000 },
        ],
      },
      bd(),
    );
    const exis = await consultarExistenciasAvio(sesion(PERM_AVIOS), {}, bd());
    expect(exis.totalExistencia).toBe(1500);
    const generico = exis.filas.find((f) => f.idAvio === avioGenerico.id);
    expect(generico?.esGenerico).toBe(true);

    // Filtro soloGenericos.
    const soloGen = await consultarExistenciasAvio(
      sesion(PERM_AVIOS),
      { soloGenericos: true },
      bd(),
    );
    expect(soloGen.filas).toHaveLength(1);
    expect(soloGen.filas[0]?.idAvio).toBe(avioGenerico.id);
  });

  it('traspaso de avío mueve entre almacenes; no-negativo bloquea', async () => {
    await ajustarInventarioAvio(
      sesion(PERM_AVIOS),
      {
        idTipoMov: idTipoAjusteEntrada,
        idAlmacen: almAvioA.id,
        fecha: '2026-06-20',
        motivo: 'conteo',
        lineas: [{ idAvio: avioCierre.id, cantidad: 500 }],
      },
      bd(),
    );
    await traspasarAvio(
      sesion(PERM_AVIOS),
      {
        idAlmacenOrigen: almAvioA.id,
        idAlmacenDestino: almAvioB.id,
        fecha: '2026-06-21',
        lineas: [{ idAvio: avioCierre.id, cantidad: 200 }],
      },
      bd(),
    );
    const exisB = await consultarExistenciasAvio(
      sesion(PERM_AVIOS),
      { idAvio: avioCierre.id, idAlmacen: almAvioB.id },
      bd(),
    );
    expect(exisB.filas[0]?.existencia).toBe(200);

    // Sacar de más → rechazado.
    await expect(
      ajustarInventarioAvio(
        sesion(PERM_AVIOS),
        {
          idTipoMov: idTipoAjusteSalida,
          idAlmacen: almAvioA.id,
          fecha: '2026-06-21',
          motivo: 'salida',
          lineas: [{ idAvio: avioCierre.id, cantidad: 9999 }],
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorConflicto);
  });

  it('property avíos: existencia = SUM de movimientos del kardex', async () => {
    await ajustarInventarioAvio(
      sesion(PERM_AVIOS),
      {
        idTipoMov: idTipoAjusteEntrada,
        idAlmacen: almAvioA.id,
        fecha: '2026-06-20',
        motivo: 'conteo',
        lineas: [{ idAvio: avioCierre.id, cantidad: 500 }],
      },
      bd(),
    );
    await ajustarInventarioAvio(
      sesion(PERM_AVIOS),
      {
        idTipoMov: idTipoAjusteSalida,
        idAlmacen: almAvioA.id,
        fecha: '2026-06-21',
        motivo: 'consumo',
        lineas: [{ idAvio: avioCierre.id, cantidad: 120 }],
      },
      bd(),
    );
    const kardex = await kardexAvio(sesion(PERM_AVIOS), { idAvio: avioCierre.id }, bd());
    const suma = kardex.renglones.reduce((s, r) => s + r.entrada - r.salida, 0);
    const exis = await consultarExistenciasAvio(
      sesion(PERM_AVIOS),
      { idAvio: avioCierre.id },
      bd(),
    );
    expect(suma).toBe(380);
    expect(exis.filas[0]?.existencia).toBe(380);
    expect(kardex.renglones.at(-1)?.saldo).toBe(380);
  });

  it('cancelación de avío por inverso regresa la existencia', async () => {
    await ajustarInventarioAvio(
      sesion(PERM_AVIOS),
      {
        idTipoMov: idTipoAjusteEntrada,
        idAlmacen: almAvioA.id,
        fecha: '2026-06-20',
        motivo: 'conteo',
        lineas: [{ idAvio: avioCierre.id, cantidad: 500 }],
      },
      bd(),
    );
    const salida = await ajustarInventarioAvio(
      sesion(PERM_AVIOS),
      {
        idTipoMov: idTipoAjusteSalida,
        idAlmacen: almAvioA.id,
        fecha: '2026-06-21',
        motivo: 'consumo',
        lineas: [{ idAvio: avioCierre.id, cantidad: 200 }],
      },
      bd(),
    );
    await cancelarMovimientoAvio(sesion(PERM_AVIOS), salida.id, { motivo: 'error' }, bd());
    const exis = await consultarExistenciasAvio(
      sesion(PERM_AVIOS),
      { idAvio: avioCierre.id },
      bd(),
    );
    expect(exis.filas[0]?.existencia).toBe(500);
  });

  it('RECHAZA cancelar UNA SOLA PATA de un traspaso de avío (no descuadra) — obs. #2', async () => {
    await ajustarInventarioAvio(
      sesion(PERM_AVIOS),
      {
        idTipoMov: idTipoAjusteEntrada,
        idAlmacen: almAvioA.id,
        fecha: '2026-06-20',
        motivo: 'conteo',
        lineas: [{ idAvio: avioCierre.id, cantidad: 500 }],
      },
      bd(),
    );
    const traspaso = await traspasarAvio(
      sesion(PERM_AVIOS),
      {
        idAlmacenOrigen: almAvioA.id,
        idAlmacenDestino: almAvioB.id,
        fecha: '2026-06-21',
        lineas: [{ idAvio: avioCierre.id, cantidad: 200 }],
      },
      bd(),
    );
    await expect(
      cancelarMovimientoAvio(sesion(PERM_AVIOS), traspaso.salida.id, { motivo: 'error' }, bd()),
    ).rejects.toBeInstanceOf(ErrorConflicto);
    await expect(
      cancelarMovimientoAvio(sesion(PERM_AVIOS), traspaso.entrada.id, { motivo: 'error' }, bd()),
    ).rejects.toBeInstanceOf(ErrorConflicto);
    const enA = await consultarExistenciasAvio(
      sesion(PERM_AVIOS),
      { idAvio: avioCierre.id, idAlmacen: almAvioA.id },
      bd(),
    );
    const enB = await consultarExistenciasAvio(
      sesion(PERM_AVIOS),
      { idAvio: avioCierre.id, idAlmacen: almAvioB.id },
      bd(),
    );
    expect(enA.filas[0]?.existencia).toBe(300);
    expect(enB.filas[0]?.existencia).toBe(200);
  });
});

describe('Telas — ajuste con lote NULL (clave del kardex 0, IS NOT DISTINCT FROM)', () => {
  it('(8b) un ajuste de entrada SIN lote (idLote NULL) suma y la existencia lo refleja', async () => {
    // Entrada directa de tela sin lote (línea con idLote nulo): el motor acepta idLote NULL y la
    // vista agrupa esa existencia como "sin lote". Se usa el motor directamente porque el dominio de
    // ajuste exige un lote en la entrada; aquí se valida la rama NULL del kardex (clave 0 del lock,
    // IS NOT DISTINCT FROM en la suma directa).
    const { registrarMovimientoTela } = await import('../../comun/kardex.js');
    const { ORIGEN } = await import('../../comun/origenes.js');
    await registrarMovimientoTela(
      sesion(PERM_TELAS),
      {
        idEmpresa: empresa.id,
        idTipoMov: idTipoAjusteEntrada,
        idAlmacen: almA.id,
        fecha: new Date('2026-06-20T00:00:00.000Z'),
        origenTipo: ORIGEN.movimientoManual,
        lineas: [{ idTela: telaFelpa.id, idLote: null, cantidad: 25 }],
      },
      bd(),
    );
    const exis = await consultarExistenciasTela(
      sesion(PERM_TELAS),
      { idTela: telaFelpa.id, incluirCeros: true },
      bd(),
    );
    const sinLote = exis.filas.find((f) => f.idTela === telaFelpa.id && f.idLote === null);
    expect(sinLote?.existencia).toBe(25);
    expect(sinLote?.loteClave).toBeNull();
    // El kardex de la tela también cuenta el renglón sin lote.
    const kardex = await kardexTela(sesion(PERM_TELAS), { idTela: telaFelpa.id }, bd());
    const renSinLote = kardex.renglones.find((r) => r.idLote === null);
    expect(renSinLote?.entrada).toBe(25);
    expect(renSinLote?.saldo).toBe(25);
  });
});

describe('El almacén tiene que ser DEL TIPO del artículo (fila 0.137)', () => {
  /**
   * Espejo del bloque de PT en `movimientos-pt.int.test.ts`: hasta esta fila el tipo del almacén
   * no lo miraba nadie, así que la tela entraba a un almacén de producto terminado y los avíos a
   * uno de telas. Aquí se prueban los dos cruces que sí ofrece el catálogo real.
   */
  it('una ENTRADA de tela contra un almacén de PT se RECHAZA (y no escribe nada)', async () => {
    const bodegaPt = await cliente.almacen.create({ data: { nombre: 'Primeras', tipo: 'PT' } });
    const movimientosAntes = await cliente.movimiento.count();
    const lotesAntes = await cliente.lote.count();
    await expect(
      ajustarInventarioTela(
        sesion(PERM_TELAS),
        {
          idTipoMov: idTipoAjusteEntrada,
          idAlmacen: bodegaPt.id,
          fecha: '2026-06-20',
          motivo: 'inventario inicial',
          lote: {
            idColor: colorRojo.id,
            idProveedor: proveedor.id,
            factura: 'F-100',
            componentes: [{ idTela: telaFelpa.id, cantidad: 100 }],
          },
        },
        bd(),
      ),
    ).rejects.toThrow(/"Primeras" es de producto terminado; este movimiento es de telas/);
    // El guard corre antes de crear el lote y antes del movimiento: nada quedó a medias.
    expect(await cliente.movimiento.count()).toBe(movimientosAntes);
    expect(await cliente.lote.count()).toBe(lotesAntes);
  });

  it('un TRASPASO de tela cuyo destino es de PT se RECHAZA', async () => {
    // Los DOS componentes con cantidad > 0: el lote es multi-componente (D5) y el contrato exige
    // `positive` en cada uno (`esquemaLoteComponenteEntrada`). Un 0 aquí muere en el Zod del ajuste,
    // ANTES de llegar al guard que esta prueba quiere medir.
    const idLote = await entrarLote(300, 100);
    const bodegaPt = await cliente.almacen.create({ data: { nombre: 'Primeras', tipo: 'PT' } });
    const movimientosAntes = await cliente.movimiento.count();
    await expect(
      traspasarTela(
        sesion(PERM_TELAS),
        {
          idAlmacenOrigen: almA.id,
          idAlmacenDestino: bodegaPt.id,
          fecha: '2026-06-21',
          lineas: [{ idTela: telaFelpa.id, idLote, cantidad: 50 }],
        },
        bd(),
      ),
    ).rejects.toThrow(/"Primeras" es de producto terminado; este movimiento es de telas/);
    expect(await cliente.movimiento.count()).toBe(movimientosAntes);
  });

  it('un AJUSTE de avíos contra un almacén de TELA se RECHAZA', async () => {
    const movimientosAntes = await cliente.movimiento.count();
    await expect(
      ajustarInventarioAvio(
        sesion(PERM_AVIOS),
        {
          idTipoMov: idTipoAjusteEntrada,
          idAlmacen: almA.id, // 'Bodega A' es de TELA
          fecha: '2026-06-20',
          motivo: 'conteo físico',
          lineas: [{ idAvio: avioCierre.id, cantidad: 500 }],
        },
        bd(),
      ),
    ).rejects.toThrow(/"Bodega A" es de telas; este movimiento es de avíos/);
    expect(await cliente.movimiento.count()).toBe(movimientosAntes);
  });

  it('un TRASPASO de avíos hacia un almacén de TELA se RECHAZA', async () => {
    await ajustarInventarioAvio(
      sesion(PERM_AVIOS),
      {
        idTipoMov: idTipoAjusteEntrada,
        idAlmacen: almAvioA.id,
        fecha: '2026-06-20',
        motivo: 'conteo',
        lineas: [{ idAvio: avioCierre.id, cantidad: 500 }],
      },
      bd(),
    );
    const movimientosAntes = await cliente.movimiento.count();
    await expect(
      traspasarAvio(
        sesion(PERM_AVIOS),
        {
          idAlmacenOrigen: almAvioA.id,
          idAlmacenDestino: almB.id, // 'Bodega B' es de TELA
          fecha: '2026-06-21',
          lineas: [{ idAvio: avioCierre.id, cantidad: 100 }],
        },
        bd(),
      ),
    ).rejects.toThrow(/"Bodega B" es de telas; este movimiento es de avíos/);
    expect(await cliente.movimiento.count()).toBe(movimientosAntes);
  });

  it('EL CASO FELIZ NO CAMBIA: tela en almacén de TELA y avíos en almacén de AVIO', async () => {
    // Mismo motivo que arriba: los dos componentes con cantidad > 0 (el contrato los exige).
    const idLote = await entrarLote(300, 100);
    expect(idLote).toBeGreaterThan(0);
    await ajustarInventarioAvio(
      sesion(PERM_AVIOS),
      {
        idTipoMov: idTipoAjusteEntrada,
        idAlmacen: almAvioA.id,
        fecha: '2026-06-20',
        motivo: 'conteo',
        lineas: [{ idAvio: avioCierre.id, cantidad: 500 }],
      },
      bd(),
    );
    const exisAvio = await consultarExistenciasAvio(
      sesion(PERM_AVIOS),
      { idAvio: avioCierre.id, idAlmacen: almAvioA.id },
      bd(),
    );
    expect(exisAvio.filas[0]?.existencia).toBe(500);
  });
});
