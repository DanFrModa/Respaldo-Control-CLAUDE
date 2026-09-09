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
import { ajustarInventarioTelaColor } from './partidas-telas.js';

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

/**
 * ⭐ FILA 0.173 — POR QUÉ ESTAS PRUEBAS PIDEN UN `desde` EXPLÍCITO. Desde esta fila, un kardex sin
 * periodo se lee con la VENTANA POR OMISIÓN (12 meses hacia atrás desde HOY). Las fixturas de este
 * archivo están fechadas en junio de 2026: hoy caen dentro de la ventana, pero pasado junio de 2027
 * dejarían de caer y estas pruebas empezarían a fallar por el CALENDARIO, no por el código. Fijar el
 * piso las vuelve deterministas y deja claro que lo que miden es el saldo, no el periodo. El periodo
 * tiene sus propias pruebas, más abajo, y ésas SÍ lo ejercitan a propósito.
 */
const PERIODO_COMPLETO = '2000-01-01';
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
    const kardex = await kardexTela(
      sesion(PERM_TELAS),
      { idTela: telaFelpa.id, desde: PERIODO_COMPLETO },
      bd(),
    );
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
    const kardex = await kardexTela(
      sesion(sinImportes),
      { idTela: telaFelpa.id, desde: PERIODO_COMPLETO },
      bd(),
    );
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
        motivo: 'Surtido al taller',
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
    const kardex = await kardexAvio(
      sesion(PERM_AVIOS),
      { idAvio: avioCierre.id, desde: PERIODO_COMPLETO },
      bd(),
    );
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
        motivo: 'Surtido al taller',
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

/**
 * ⭐ FILA 0.172 — el MOTIVO del traspaso de AVÍO queda en LAS DOS patas.
 *
 * 🔴 Sólo se puede medir contra Postgres: el motor (`comun/kardex.ts` → `registrarTraspasoAvio`,
 * patas en `:1234` y `:1249`) pasa el MISMO encabezado a las dos, así que basta con que alguien deje
 * de pasarlo a la pata de ENTRADA para que el kardex del almacén que RECIBE el avío no diga por qué
 * llegó — y ninguna otra prueba se pondría roja. En avíos duele más que en tela: aquí NO hay hoja
 * impresa que lo rescate.
 */
describe('el MOTIVO del traspaso de avío queda en LAS DOS patas (fila 0.172)', () => {
  it('⭐ salida Y entrada guardan el motivo, recortado, en `Movimiento.observaciones`', async () => {
    await ajustarInventarioAvio(
      sesion(PERM_AVIOS),
      {
        idTipoMov: idTipoAjusteEntrada,
        idAlmacen: almAvioA.id,
        fecha: '2026-06-20',
        motivo: 'conteo',
        lineas: [{ idAvio: avioCierre.id, cantidad: 400 }],
      },
      bd(),
    );
    const t = await traspasarAvio(
      sesion(PERM_AVIOS),
      {
        idAlmacenOrigen: almAvioA.id,
        idAlmacenDestino: almAvioB.id,
        fecha: '2026-06-21',
        // Con espacios de sobra a propósito: el contrato lo recorta (`.trim()`).
        motivo: '   Reacomodo de bodega   ',
        lineas: [{ idAvio: avioCierre.id, cantidad: 150 }],
      },
      bd(),
    );

    // 🔴 LAS DOS, leídas de la BASE (no del objeto que devuelve el dominio): es la columna que va a
    // mirar el kardex de cada almacén.
    const salida = await cliente.movimiento.findUniqueOrThrow({ where: { id: t.salida.id } });
    const entrada = await cliente.movimiento.findUniqueOrThrow({ where: { id: t.entrada.id } });
    expect(salida.observaciones).toBe('Reacomodo de bodega');
    expect(entrada.observaciones).toBe('Reacomodo de bodega');
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
    const kardex = await kardexTela(
      sesion(PERM_TELAS),
      { idTela: telaFelpa.id, desde: PERIODO_COMPLETO },
      bd(),
    );
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
          motivo: 'Surtido al taller',
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

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// EL PERIODO de los kardex de MATERIALES — fila 0.173 (mecanismo de la 0.138)
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// ⭐ Hasta esta fila, `kardexTela` (flujo LEGADO por lote) y `kardexAvio` pedían TODOS los
// movimientos, sin filtro de fechas y sin `LIMIT`. Ahora los dos tienen periodo, ventana por
// omisión de 12 meses y tope duro; y como los dos llevan columna de SALDO CORRIDO, recortar sin
// sembrar el saldo anterior las habría dejado mintiendo desde el primer renglón.

/** `AAAA-MM-DD` de hoy en el huso del negocio, corrido `meses` hacia atrás. */
function haceMeses(meses: number): string {
  const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
  const [a, m, d] = hoy.split('-').map(Number);
  return new Date(Date.UTC(a as number, (m as number) - 1 - meses, d)).toISOString().slice(0, 10);
}

describe('El PERIODO del kardex de TELA por lote (fila 0.173)', () => {
  /** Crea un lote de Felpa con una entrada en la fecha dada. Devuelve `{ idLote, folio }`. */
  async function crearLote(
    fecha: string,
    cantidad: number,
  ): Promise<{ idLote: number; folio: number }> {
    const mov = await ajustarInventarioTela(
      sesion(PERM_TELAS),
      {
        idTipoMov: idTipoAjusteEntrada,
        idAlmacen: almA.id,
        fecha,
        motivo: 'entrada de la prueba',
        lote: {
          idColor: colorRojo.id,
          idProveedor: proveedor.id,
          componentes: [{ idTela: telaFelpa.id, cantidad }],
        },
      },
      bd(),
    );
    const idLote = mov.renglones[0]?.idLote;
    if (idLote == null) throw new Error('el lote no se creó');
    return { idLote, folio: mov.folio };
  }

  /** Movimiento sobre lotes YA existentes, en la fecha dada. Devuelve el folio. */
  async function movimientoEn(
    fecha: string,
    direccion: 'entrada' | 'salida',
    lineas: { idLote: number; cantidad: number }[],
  ): Promise<number> {
    const mov = await ajustarInventarioTela(
      sesion(PERM_TELAS),
      {
        idTipoMov: direccion === 'entrada' ? idTipoAjusteEntrada : idTipoAjusteSalida,
        idAlmacen: almA.id,
        fecha,
        motivo: 'ajuste de la prueba',
        lineas: lineas.map((l) => ({
          idTela: telaFelpa.id,
          idLote: l.idLote,
          cantidad: l.cantidad,
        })),
      },
      bd(),
    );
    return mov.folio;
  }

  it('⭐ un movimiento FUERA del periodo NO llega: el recorte lo hace el servidor', async () => {
    const { idLote } = await crearLote('2026-01-15', 30); // fuera
    const dentro = await movimientoEn('2026-06-20', 'entrada', [{ idLote, cantidad: 7 }]);

    const kardex = await kardexTela(
      sesion(PERM_TELAS),
      { idTela: telaFelpa.id, desde: '2026-06-01', hasta: '2026-06-30' },
      bd(),
    );
    expect(kardex.renglones.map((r) => r.folio)).toEqual([dentro]);
    expect(kardex.desde).toBe('2026-06-01');
    expect(kardex.hasta).toBe('2026-06-30');
    expect(kardex.ventanaPorOmision).toBe(false);
    expect(kardex.truncado).toBe(false);
  });

  /**
   * ⭐⭐ LA PRUEBA DE QUE EL FILTRO ESTÁ EN EL `WHERE` Y NO EN JAVASCRIPT. Filtrando en el servidor,
   * la base sólo ve el de enero, el tope de 2 no lo alcanza y llega 1 renglón. Filtrando DESPUÉS de
   * traer, el tope se habría llevado los tres de junio (los más nuevos, `folio DESC`), el recorte
   * por fecha los tiraría y llegarían 0.
   */
  it('⭐⭐ el filtro va en la CONSULTA, no en memoria (el tope no se come el periodo)', async () => {
    const { idLote, folio: folioEnero } = await crearLote('2026-01-15', 1);
    await movimientoEn('2026-06-01', 'entrada', [{ idLote, cantidad: 1 }]);
    await movimientoEn('2026-06-02', 'entrada', [{ idLote, cantidad: 1 }]);
    await movimientoEn('2026-06-03', 'entrada', [{ idLote, cantidad: 1 }]);

    const kardex = await kardexTela(
      sesion(PERM_TELAS),
      { idTela: telaFelpa.id, desde: '2026-01-01', hasta: '2026-01-31', limite: 2 },
      bd(),
    );
    expect(kardex.renglones.map((r) => r.folio)).toEqual([folioEnero]);
    expect(kardex.truncado).toBe(false);
  });

  it('⭐ los DOS bordes son INCLUSIVOS, y un día más allá deja el movimiento fuera', async () => {
    const { idLote, folio: primero } = await crearLote('2026-06-01', 5);
    const ultimo = await movimientoEn('2026-06-30', 'entrada', [{ idLote, cantidad: 5 }]);

    const dentro = await kardexTela(
      sesion(PERM_TELAS),
      { idTela: telaFelpa.id, desde: '2026-06-01', hasta: '2026-06-30' },
      bd(),
    );
    expect(dentro.renglones.map((r) => r.folio)).toEqual([primero, ultimo]);

    const sinPrimero = await kardexTela(
      sesion(PERM_TELAS),
      { idTela: telaFelpa.id, desde: '2026-06-02', hasta: '2026-06-30' },
      bd(),
    );
    expect(sinPrimero.renglones.map((r) => r.folio)).toEqual([ultimo]);

    const sinUltimo = await kardexTela(
      sesion(PERM_TELAS),
      { idTela: telaFelpa.id, desde: '2026-06-01', hasta: '2026-06-29' },
      bd(),
    );
    expect(sinUltimo.renglones.map((r) => r.folio)).toEqual([primero]);
  });

  /**
   * ⭐ LA VENTANA POR OMISIÓN, Y POR QUÉ ES LA MISMA QUE EN PRODUCTO TERMINADO AUNQUE ESTE KARDEX
   * SEA UN ARCHIVO CONGELADO. Desde la fila 0.170 nadie escribe por lote: aquí sólo vive el
   * histórico migrado de Access. Se midió antes de decidir: con la ventana de migración vigente
   * (`ETL_DESDE=2025`) entran 259 renglones en 51 telas, con un máximo de 48 en la más movida — o
   * sea que NO hay un problema de volumen que justifique una regla propia. Lo que sí hay es una
   * pantalla que puede quedarse en blanco, y eso se cura diciéndolo (el vacío de
   * `KardexMaterialesPagina` dice «en el periodo» y manda a ampliar las fechas), no doblando el
   * diseño para que le cuadre al histórico (REGLA 0-B).
   */
  it('⭐ SIN periodo, la ventana por omisión deja fuera lo viejo (y lo dice)', async () => {
    const { idLote } = await crearLote(haceMeses(24), 40); // dos años atrás: fuera
    const reciente = await movimientoEn(haceMeses(1), 'entrada', [{ idLote, cantidad: 6 }]);

    const porOmision = await kardexTela(sesion(PERM_TELAS), { idTela: telaFelpa.id }, bd());
    expect(porOmision.renglones.map((r) => r.folio)).toEqual([reciente]);
    expect(porOmision.ventanaPorOmision).toBe(true);
    expect(porOmision.desde).toBe(haceMeses(12));
    expect(porOmision.hasta).toBeNull();

    // Y el histórico NO se perdió: pedirlo a mano lo trae. La ventana es un default, no un candado.
    const completo = await kardexTela(
      sesion(PERM_TELAS),
      { idTela: telaFelpa.id, desde: PERIODO_COMPLETO },
      bd(),
    );
    expect(completo.renglones).toHaveLength(2);
    expect(completo.ventanaPorOmision).toBe(false);
  });

  it('⭐ el SALDO del periodo arranca del saldo anterior, no de cero', async () => {
    const { idLote } = await crearLote('2026-01-15', 30);
    await movimientoEn('2026-06-20', 'entrada', [{ idLote, cantidad: 7 }]);

    const kardex = await kardexTela(
      sesion(PERM_TELAS),
      { idTela: telaFelpa.id, desde: '2026-06-01' },
      bd(),
    );
    // Si el saldo anterior se ignorara, este renglón diría 7 — y el kardex mentiría.
    expect(kardex.renglones).toHaveLength(1);
    expect(kardex.renglones[0]?.saldo).toBe(37);
    expect(kardex.saldosIniciales).toHaveLength(1);
    expect(kardex.saldosIniciales[0]?.saldo).toBe(30);
    expect(kardex.saldosIniciales[0]?.idLote).toBe(idLote);
    expect(kardex.saldosIniciales[0]?.almacen).toBe('Bodega A');
  });

  it('el saldo anterior RESTA las salidas anteriores (no es un total de entradas)', async () => {
    const { idLote } = await crearLote('2026-01-15', 30);
    await movimientoEn('2026-02-10', 'salida', [{ idLote, cantidad: 12 }]);
    await movimientoEn('2026-06-20', 'entrada', [{ idLote, cantidad: 1 }]);

    const kardex = await kardexTela(
      sesion(PERM_TELAS),
      { idTela: telaFelpa.id, desde: '2026-06-01' },
      bd(),
    );
    expect(kardex.saldosIniciales[0]?.saldo).toBe(18);
    expect(kardex.renglones[0]?.saldo).toBe(19);
  });

  it('sólo trae el saldo anterior de los LOTES que se movieron en el periodo', async () => {
    const { idLote: loteA } = await crearLote('2026-01-15', 30); // se moverá en el periodo
    await crearLote('2026-01-16', 50); // quieto durante el periodo
    await movimientoEn('2026-06-20', 'entrada', [{ idLote: loteA, cantidad: 7 }]);

    const kardex = await kardexTela(
      sesion(PERM_TELAS),
      { idTela: telaFelpa.id, desde: '2026-06-01' },
      bd(),
    );
    expect(kardex.saldosIniciales.map((s) => s.idLote)).toEqual([loteA]);
  });

  /**
   * ⭐⭐ EL CORTE SE LLEVA LO VIEJO, NO LO NUEVO. El folio es la secuencia atómica por empresa (A3),
   * o sea que crece con el tiempo: `ORDER BY folio ASC LIMIT n` devolvería los n MÁS VIEJOS de la
   * ventana. En producto terminado eso escondió siete meses recientes con la pantalla diciendo «en
   * adelante» — un kardex se abre para ver el final.
   */
  it('⭐⭐ el TOPE conserva el FINAL del periodo, y el saldo sigue cuadrando', async () => {
    const { idLote, folio: f1 } = await crearLote('2026-06-01', 1);
    const f2 = await movimientoEn('2026-06-02', 'entrada', [{ idLote, cantidad: 1 }]);
    const f3 = await movimientoEn('2026-06-03', 'entrada', [{ idLote, cantidad: 1 }]);

    const cortado = await kardexTela(
      sesion(PERM_TELAS),
      { idTela: telaFelpa.id, desde: '2026-01-01', limite: 2 },
      bd(),
    );
    expect(cortado.renglones).toHaveLength(2);
    expect(cortado.truncado).toBe(true);
    expect(cortado.limite).toBe(2);
    // Los DOS ÚLTIMOS, en orden cronológico. Con el corte al revés esto sería [f1, f2].
    expect(cortado.renglones.map((r) => r.folio)).toEqual([f2, f3]);
    expect(cortado.saldosIniciales[0]?.saldo).toBe(1);
    expect(cortado.renglones.map((r) => r.saldo)).toEqual([2, 3]);

    const completo = await kardexTela(
      sesion(PERM_TELAS),
      { idTela: telaFelpa.id, desde: '2026-01-01', limite: 3 },
      bd(),
    );
    expect(completo.renglones.map((r) => r.folio)).toEqual([f1, f2, f3]);
    expect(completo.truncado).toBe(false);
    expect(completo.saldosIniciales).toHaveLength(0);
    expect(completo.renglones.map((r) => r.saldo)).toEqual([1, 2, 3]);
  });

  it('⭐ tres movimientos del MISMO día con tope 2: el que se cae cuenta en el saldo anterior', async () => {
    const { idLote, folio: f1 } = await crearLote('2026-06-10', 5);
    const f2 = await movimientoEn('2026-06-10', 'entrada', [{ idLote, cantidad: 7 }]);
    const f3 = await movimientoEn('2026-06-10', 'entrada', [{ idLote, cantidad: 9 }]);
    expect(f1).toBeLessThan(f2);

    const kardex = await kardexTela(
      sesion(PERM_TELAS),
      { idTela: telaFelpa.id, desde: '2026-06-01', limite: 2 },
      bd(),
    );
    expect(kardex.renglones.map((r) => r.folio)).toEqual([f2, f3]);
    expect(kardex.saldosIniciales[0]?.saldo).toBe(5);
    expect(kardex.renglones.map((r) => r.saldo)).toEqual([12, 21]);
  });

  /**
   * ⭐⭐⭐ EL DESEMPATE POR `id` DEL DETALLE — la línea de la que cuelga todo el invariante, y la que
   * en producto terminado sobrevivía a 56 pruebas EN VERDE (fila 0.138) porque todas las fixturas
   * creaban movimientos de un solo renglón y la llave `(folio, id)` degeneraba en el folio.
   *
   * 🔑 Aquí el caso es el normal de esta pantalla: UN ajuste puede tocar VARIOS lotes de la misma
   * tela, así que un movimiento escribe varios renglones. Si el tope corta en medio de ese
   * movimiento, el renglón que queda fuera tiene el MISMO folio que el ancla y sólo el `id` los
   * separa. El montaje pone ese renglón en un lote que SÍ se ve (por otro movimiento posterior),
   * que es lo que hace visible el error: sin el `id`, el saldo anterior del lote A dice 100 en vez
   * de 107 y el último renglón cierra en 95 en vez de en 102 — la existencia real.
   */
  it('⭐⭐⭐ con el tope cortando DENTRO de un movimiento, el desempate es (folio, id) — no el folio', async () => {
    const { idLote: loteA } = await crearLote('2026-06-01', 100);
    const { idLote: loteB } = await crearLote('2026-06-01', 50);
    // UN movimiento con DOS renglones: lote A (+7) y lote B (+3), en ese orden de captura.
    const fMixto = await movimientoEn('2026-06-02', 'entrada', [
      { idLote: loteA, cantidad: 7 },
      { idLote: loteB, cantidad: 3 },
    ]);
    const fSalida = await movimientoEn('2026-06-03', 'salida', [{ idLote: loteA, cantidad: 5 }]);

    const kardex = await kardexTela(
      sesion(PERM_TELAS),
      { idTela: telaFelpa.id, desde: '2026-06-01', limite: 2 },
      bd(),
    );
    expect(kardex.truncado).toBe(true);
    // Se ven el SEGUNDO renglón del movimiento mixto y la salida; el primero (+7 al lote A) queda
    // fuera por el tope, con el MISMO folio que el ancla.
    expect(kardex.renglones.map((r) => r.folio)).toEqual([fMixto, fSalida]);
    expect(kardex.renglones.map((r) => r.idLote)).toEqual([loteB, loteA]);

    // ⭐ El número que mata la mutación: 107, no 100.
    const previoA = kardex.saldosIniciales.find((s) => s.idLote === loteA);
    expect(previoA?.saldo).toBe(107);
    expect(kardex.renglones[1]?.saldo).toBe(102);

    // Y 102 es la existencia REAL del lote A (100 + 7 − 5): el invariante que el tope no puede romper.
    const existencias = await consultarExistenciasTela(
      sesion(PERM_TELAS),
      { idTela: telaFelpa.id, idLote: loteA },
      bd(),
    );
    expect(existencias.filas[0]?.existencia).toBe(102);
  });

  /**
   * ⭐⭐ EL FILTRO DEL FLUJO LEGADO (`id_tela_color IS NULL`) ES DE CORRECCIÓN EN EL SALDO ANTERIOR.
   * La llave de agrupación es lote×almacén, y los renglones del inventario VIGENTE por color llevan
   * `id_lote` NULL: sin ese filtro caerían en el cubo «sin lote» del saldo anterior. Es el mismo
   * descuadre que el reviewer de la etapa A2 cazó en la LISTA — el saldo anterior tiene que mirar
   * exactamente el mismo universo que los renglones, o la columna «Saldo» miente entera.
   */
  it('⭐⭐ el saldo anterior tampoco ve el inventario VIGENTE por color', async () => {
    // Un color de la misma tela, con existencia ANTES del periodo por el flujo NUEVO.
    const color = await cliente.telaColor.create({
      data: { idTela: telaFelpa.id, nombre: 'Marino' },
    });
    await ajustarInventarioTelaColor(
      sesion(PERM_TELAS),
      {
        idTipoMov: idTipoAjusteEntrada,
        idAlmacen: almA.id,
        fecha: '2026-01-10',
        motivo: 'Conteo físico inicial',
        lineas: [{ idTelaColor: color.id, cantidad: 999 }],
      },
      bd(),
    );
    // Y el flujo LEGADO, con dos entradas SIN lote (una antes del periodo y otra dentro): caen en el
    // MISMO cubo «sin lote» que ocuparían los renglones por color si el filtro no estuviera. El
    // dominio del ajuste exige lote en la entrada, así que se usa el motor —igual que la prueba de
    // la rama NULL de más arriba—.
    const { registrarMovimientoTela } = await import('../../comun/kardex.js');
    const { ORIGEN } = await import('../../comun/origenes.js');
    for (const [fecha, cantidad] of [
      ['2026-01-15', 25],
      ['2026-06-20', 5],
    ] as const) {
      await registrarMovimientoTela(
        sesion(PERM_TELAS),
        {
          idEmpresa: empresa.id,
          idTipoMov: idTipoAjusteEntrada,
          idAlmacen: almA.id,
          fecha: new Date(`${fecha}T00:00:00.000Z`),
          origenTipo: ORIGEN.movimientoManual,
          lineas: [{ idTela: telaFelpa.id, idLote: null, cantidad }],
        },
        bd(),
      );
    }

    const kardex = await kardexTela(
      sesion(PERM_TELAS),
      { idTela: telaFelpa.id, desde: '2026-06-01' },
      bd(),
    );
    // 25, no 1024: los 999 del flujo por color no son de este kardex ni de su saldo anterior.
    expect(kardex.saldosIniciales).toHaveLength(1);
    expect(kardex.saldosIniciales[0]?.idLote).toBeNull();
    expect(kardex.saldosIniciales[0]?.saldo).toBe(25);
    expect(kardex.renglones[0]?.saldo).toBe(30);
  });

  /**
   * ⭐ A9 — la EMPRESA es de corrección en el saldo anterior: no está en la llave de agrupación
   * (lote×almacén), así que un movimiento de otra empresa sobre el mismo lote caería DENTRO del
   * mismo grupo y todos los saldos mentirían a la vez.
   */
  it('⭐ un movimiento de OTRA empresa no entra en el saldo anterior (A9)', async () => {
    const { idLote } = await crearLote('2026-01-15', 30);
    const otra = await crearEmpresaPrueba(cliente, 'Otra SA');
    await ajustarInventarioTela(
      sesionDePrueba({ idEmpresaActiva: otra.id, permisos: PERM_TELAS }),
      {
        idTipoMov: idTipoAjusteEntrada,
        idAlmacen: almA.id,
        fecha: '2026-01-20',
        motivo: 'entrada de otra empresa',
        lineas: [{ idTela: telaFelpa.id, idLote, cantidad: 999 }],
      },
      bd(),
    );
    await movimientoEn('2026-06-20', 'entrada', [{ idLote, cantidad: 7 }]);

    const kardex = await kardexTela(
      sesion(PERM_TELAS),
      { idTela: telaFelpa.id, desde: '2026-06-01' },
      bd(),
    );
    expect(kardex.saldosIniciales[0]?.saldo).toBe(30);
    expect(kardex.renglones[0]?.saldo).toBe(37);
  });

  /**
   * ⭐⭐⭐ LA LLAVE DEL `GROUP BY` SON **DOS** COLUMNAS (lote × almacén), Y AÑADIRLE UNA TERCERA ES
   * TAN LETAL COMO QUITAR UNA CONDICIÓN DEL `WHERE` — pero nadie lo medía.
   *
   * 🔑 Las demás pruebas de este bloque razonan sobre **QUITAR** guardas. Ésta fija la mutación
   * simétrica, que es la más natural de todas («agrupo también por lo que estoy mirando»):
   * `GROUP BY 1, 2, m."id_tipo_mov"` —o `, d."id"`— parte el cubo en una fila por dirección, el
   * `new Map(...)` del llamador se queda con **la última** (y el orden entre empates de
   * `ORDER BY a."nombre", l."clave"` **ni siquiera es estable**), y la columna «Saldo» arrancaría
   * de +150 o de −30 en vez de 120.
   */
  it('⭐⭐⭐ el saldo anterior de lote×almacén es UNA fila con la SUMA (entradas menos salidas)', async () => {
    const { idLote } = await crearLote('2026-01-10', 100);
    await movimientoEn('2026-01-11', 'entrada', [{ idLote, cantidad: 50 }]);
    await movimientoEn('2026-01-12', 'salida', [{ idLote, cantidad: 30 }]);
    // Algo DENTRO del periodo, para que el lote tenga renglón que enseñar.
    await movimientoEn('2026-06-20', 'entrada', [{ idLote, cantidad: 1 }]);

    const kardex = await kardexTela(
      sesion(PERM_TELAS),
      { idTela: telaFelpa.id, desde: '2026-06-01' },
      bd(),
    );

    // ⭐ UNA sola fila para el par (lote, almacén), con la suma neta.
    expect(kardex.saldosIniciales).toHaveLength(1);
    expect(kardex.saldosIniciales[0]?.idLote).toBe(idLote);
    expect(kardex.saldosIniciales[0]?.saldo).toBe(120); // 100 + 50 − 30
    expect(kardex.renglones).toHaveLength(1);
    expect(kardex.renglones[0]?.saldo).toBe(121);
  });
});

describe('El PERIODO del kardex de AVÍO (fila 0.173)', () => {
  /** Ajuste de avío en la fecha dada. Devuelve el folio. */
  async function ajusteEn(
    fecha: string,
    direccion: 'entrada' | 'salida',
    cantidad: number,
    idAlmacen: number = almAvioA.id,
  ): Promise<number> {
    const mov = await ajustarInventarioAvio(
      sesion(PERM_AVIOS),
      {
        idTipoMov: direccion === 'entrada' ? idTipoAjusteEntrada : idTipoAjusteSalida,
        idAlmacen,
        fecha,
        motivo: 'ajuste de la prueba',
        lineas: [{ idAvio: avioCierre.id, cantidad }],
      },
      bd(),
    );
    return mov.folio;
  }

  it('⭐ un movimiento FUERA del periodo NO llega: el recorte lo hace el servidor', async () => {
    await ajusteEn('2026-01-15', 'entrada', 30);
    const dentro = await ajusteEn('2026-06-20', 'entrada', 7);

    const kardex = await kardexAvio(
      sesion(PERM_AVIOS),
      { idAvio: avioCierre.id, desde: '2026-06-01', hasta: '2026-06-30' },
      bd(),
    );
    expect(kardex.renglones.map((r) => r.folio)).toEqual([dentro]);
    expect(kardex.desde).toBe('2026-06-01');
    expect(kardex.hasta).toBe('2026-06-30');
    expect(kardex.ventanaPorOmision).toBe(false);
    expect(kardex.truncado).toBe(false);
  });

  it('⭐⭐ el filtro va en la CONSULTA, no en memoria (el tope no se come el periodo)', async () => {
    const folioEnero = await ajusteEn('2026-01-15', 'entrada', 1);
    await ajusteEn('2026-06-01', 'entrada', 1);
    await ajusteEn('2026-06-02', 'entrada', 1);
    await ajusteEn('2026-06-03', 'entrada', 1);

    const kardex = await kardexAvio(
      sesion(PERM_AVIOS),
      { idAvio: avioCierre.id, desde: '2026-01-01', hasta: '2026-01-31', limite: 2 },
      bd(),
    );
    expect(kardex.renglones.map((r) => r.folio)).toEqual([folioEnero]);
    expect(kardex.truncado).toBe(false);
  });

  it('⭐ los DOS bordes son INCLUSIVOS, y un día más allá deja el movimiento fuera', async () => {
    const primero = await ajusteEn('2026-06-01', 'entrada', 5);
    const ultimo = await ajusteEn('2026-06-30', 'entrada', 5);

    const dentro = await kardexAvio(
      sesion(PERM_AVIOS),
      { idAvio: avioCierre.id, desde: '2026-06-01', hasta: '2026-06-30' },
      bd(),
    );
    expect(dentro.renglones.map((r) => r.folio)).toEqual([primero, ultimo]);

    const sinPrimero = await kardexAvio(
      sesion(PERM_AVIOS),
      { idAvio: avioCierre.id, desde: '2026-06-02', hasta: '2026-06-30' },
      bd(),
    );
    expect(sinPrimero.renglones.map((r) => r.folio)).toEqual([ultimo]);

    const sinUltimo = await kardexAvio(
      sesion(PERM_AVIOS),
      { idAvio: avioCierre.id, desde: '2026-06-01', hasta: '2026-06-29' },
      bd(),
    );
    expect(sinUltimo.renglones.map((r) => r.folio)).toEqual([primero]);
  });

  it('⭐ SIN periodo, la ventana por omisión deja fuera lo viejo (y lo dice)', async () => {
    await ajusteEn(haceMeses(24), 'entrada', 40);
    const reciente = await ajusteEn(haceMeses(1), 'entrada', 6);

    const porOmision = await kardexAvio(sesion(PERM_AVIOS), { idAvio: avioCierre.id }, bd());
    expect(porOmision.renglones.map((r) => r.folio)).toEqual([reciente]);
    expect(porOmision.ventanaPorOmision).toBe(true);
    expect(porOmision.desde).toBe(haceMeses(12));
    expect(porOmision.hasta).toBeNull();

    const completo = await kardexAvio(
      sesion(PERM_AVIOS),
      { idAvio: avioCierre.id, desde: PERIODO_COMPLETO },
      bd(),
    );
    expect(completo.renglones).toHaveLength(2);
    expect(completo.ventanaPorOmision).toBe(false);
  });

  it('⭐ el SALDO del periodo arranca del saldo anterior, y RESTA las salidas anteriores', async () => {
    await ajusteEn('2026-01-15', 'entrada', 30);
    await ajusteEn('2026-02-10', 'salida', 12);
    await ajusteEn('2026-06-20', 'entrada', 1);

    const kardex = await kardexAvio(
      sesion(PERM_AVIOS),
      { idAvio: avioCierre.id, desde: '2026-06-01' },
      bd(),
    );
    expect(kardex.renglones).toHaveLength(1);
    expect(kardex.saldosIniciales).toHaveLength(1);
    expect(kardex.saldosIniciales[0]?.saldo).toBe(18);
    expect(kardex.saldosIniciales[0]?.almacen).toBe('Avíos A');
    expect(kardex.renglones[0]?.saldo).toBe(19);
  });

  it('sólo trae el saldo anterior de los ALMACENES que se movieron en el periodo', async () => {
    await ajusteEn('2026-01-15', 'entrada', 30, almAvioA.id); // se moverá en el periodo
    await ajusteEn('2026-01-16', 'entrada', 50, almAvioB.id); // quieto durante el periodo
    await ajusteEn('2026-06-20', 'entrada', 7, almAvioA.id);

    const kardex = await kardexAvio(
      sesion(PERM_AVIOS),
      { idAvio: avioCierre.id, desde: '2026-06-01' },
      bd(),
    );
    expect(kardex.saldosIniciales.map((s) => s.almacen)).toEqual(['Avíos A']);
  });

  it('⭐⭐ el TOPE conserva el FINAL del periodo, y el saldo sigue cuadrando', async () => {
    const f1 = await ajusteEn('2026-06-01', 'entrada', 1);
    const f2 = await ajusteEn('2026-06-02', 'entrada', 1);
    const f3 = await ajusteEn('2026-06-03', 'entrada', 1);

    const cortado = await kardexAvio(
      sesion(PERM_AVIOS),
      { idAvio: avioCierre.id, desde: '2026-01-01', limite: 2 },
      bd(),
    );
    expect(cortado.renglones.map((r) => r.folio)).toEqual([f2, f3]);
    expect(cortado.truncado).toBe(true);
    expect(cortado.saldosIniciales[0]?.saldo).toBe(1);
    expect(cortado.renglones.map((r) => r.saldo)).toEqual([2, 3]);

    const completo = await kardexAvio(
      sesion(PERM_AVIOS),
      { idAvio: avioCierre.id, desde: '2026-01-01', limite: 3 },
      bd(),
    );
    expect(completo.renglones.map((r) => r.folio)).toEqual([f1, f2, f3]);
    expect(completo.truncado).toBe(false);
    expect(completo.saldosIniciales).toHaveLength(0);
  });

  it('⭐ tres movimientos del MISMO día con tope 2: el que se cae cuenta en el saldo anterior', async () => {
    const f1 = await ajusteEn('2026-06-10', 'entrada', 5);
    const f2 = await ajusteEn('2026-06-10', 'entrada', 7);
    const f3 = await ajusteEn('2026-06-10', 'entrada', 9);
    expect(f1).toBeLessThan(f2);

    const kardex = await kardexAvio(
      sesion(PERM_AVIOS),
      { idAvio: avioCierre.id, desde: '2026-06-01', limite: 2 },
      bd(),
    );
    expect(kardex.renglones.map((r) => r.folio)).toEqual([f2, f3]);
    expect(kardex.saldosIniciales[0]?.saldo).toBe(5);
    expect(kardex.renglones.map((r) => r.saldo)).toEqual([12, 21]);
  });

  /**
   * ⭐⭐ EL AVÍO es de corrección en el saldo anterior: la llave de agrupación es SÓLO el almacén,
   * así que otro avío del mismo almacén caería DENTRO del mismo grupo. (La EMPRESA, A9, tiene su
   * propia prueba en el bloque de telas: la condición es idéntica y el modo de falla, el mismo.)
   */
  it('⭐⭐ otro AVÍO del mismo almacén no entra en el saldo anterior', async () => {
    await ajusteEn('2026-01-15', 'entrada', 30);
    await ajustarInventarioAvio(
      sesion(PERM_AVIOS),
      {
        idTipoMov: idTipoAjusteEntrada,
        idAlmacen: almAvioA.id,
        fecha: '2026-01-20',
        motivo: 'otro avío',
        lineas: [{ idAvio: avioGenerico.id, cantidad: 999 }],
      },
      bd(),
    );
    await ajusteEn('2026-06-20', 'entrada', 7);

    const kardex = await kardexAvio(
      sesion(PERM_AVIOS),
      { idAvio: avioCierre.id, desde: '2026-06-01' },
      bd(),
    );
    expect(kardex.saldosIniciales[0]?.saldo).toBe(30);
    expect(kardex.renglones[0]?.saldo).toBe(37);
  });

  /**
   * ⭐ A9 — un movimiento de OTRA empresa no entra en el saldo anterior. `id_empresa` no está en la
   * llave de agrupación (el almacén), así que sin la condición sumaría dentro del mismo grupo.
   */
  it('⭐ un movimiento de OTRA empresa no entra en el saldo anterior (A9)', async () => {
    await ajusteEn('2026-01-15', 'entrada', 30);
    const otra = await crearEmpresaPrueba(cliente, 'Otra SA');
    await ajustarInventarioAvio(
      sesionDePrueba({ idEmpresaActiva: otra.id, permisos: PERM_AVIOS }),
      {
        idTipoMov: idTipoAjusteEntrada,
        idAlmacen: almAvioA.id,
        fecha: '2026-01-20',
        motivo: 'entrada de otra empresa',
        lineas: [{ idAvio: avioCierre.id, cantidad: 999 }],
      },
      bd(),
    );
    await ajusteEn('2026-06-20', 'entrada', 7);

    const kardex = await kardexAvio(
      sesion(PERM_AVIOS),
      { idAvio: avioCierre.id, desde: '2026-06-01' },
      bd(),
    );
    expect(kardex.saldosIniciales[0]?.saldo).toBe(30);
    expect(kardex.renglones[0]?.saldo).toBe(37);
  });
  /**
   * ⭐⭐⭐ LA LLAVE DEL `GROUP BY` ES **UNA SOLA COLUMNA** (el almacén), Y AÑADIRLE OTRA ES TAN LETAL
   * COMO QUITAR UNA CONDICIÓN DEL `WHERE` — pero nadie lo medía.
   *
   * 🔑 El lote del avío es la tentación exacta: está en el renglón y se pinta en la tabla, pero
   * **NO entra en la dimensión de existencia** (R4 — la existencia de avíos es avío×almacén). Con
   * `GROUP BY 1, d."id_lote"` el saldo anterior devuelve una fila por lote, el `new Map(...)` del
   * llamador se queda con **la última** (y el orden entre empates de `ORDER BY a."nombre"` **ni
   * siquiera es estable**), y la columna «Saldo» arranca del saldo de UN lote en vez del total del
   * almacén. El montaje mete además las dos direcciones, así que muere igual con
   * `GROUP BY 1, m."id_tipo_mov"` o con `GROUP BY 1, d."id"`.
   */
  it('⭐⭐⭐ el saldo anterior de un almacén es UNA fila con la SUMA (no una por lote)', async () => {
    // Dos lotes del MISMO avío en el MISMO almacén, antes del periodo. El lote se guarda en el
    // renglón (R4) pero no parte la existencia: los dos caen en el mismo cubo de saldo.
    const loteX = await cliente.lote.create({
      data: { clave: 'AVIO-LOTE-X', idColor: colorRojo.id },
    });
    const loteY = await cliente.lote.create({
      data: { clave: 'AVIO-LOTE-Y', idColor: colorRojo.id },
    });
    await ajustarInventarioAvio(
      sesion(PERM_AVIOS),
      {
        idTipoMov: idTipoAjusteEntrada,
        idAlmacen: almAvioA.id,
        fecha: '2026-01-10',
        motivo: 'entrada del lote X',
        lineas: [{ idAvio: avioCierre.id, idLote: loteX.id, cantidad: 100 }],
      },
      bd(),
    );
    await ajustarInventarioAvio(
      sesion(PERM_AVIOS),
      {
        idTipoMov: idTipoAjusteEntrada,
        idAlmacen: almAvioA.id,
        fecha: '2026-01-11',
        motivo: 'entrada del lote Y',
        lineas: [{ idAvio: avioCierre.id, idLote: loteY.id, cantidad: 50 }],
      },
      bd(),
    );
    // Y una SALIDA (sin lote) antes del periodo: en el mismo cubo conviven las dos direcciones.
    await ajusteEn('2026-01-12', 'salida', 30);
    // Algo DENTRO del periodo, para que el almacén tenga renglón que enseñar.
    await ajusteEn('2026-06-20', 'entrada', 1);

    const kardex = await kardexAvio(
      sesion(PERM_AVIOS),
      { idAvio: avioCierre.id, desde: '2026-06-01' },
      bd(),
    );

    // ⭐ UNA sola fila para Avíos A —no tres— y con la suma neta de todo lo anterior.
    expect(kardex.saldosIniciales).toHaveLength(1);
    expect(kardex.saldosIniciales[0]?.almacen).toBe('Avíos A');
    expect(kardex.saldosIniciales[0]?.saldo).toBe(120); // 100 + 50 − 30
    expect(kardex.renglones).toHaveLength(1);
    expect(kardex.renglones[0]?.saldo).toBe(121);
  });
});
