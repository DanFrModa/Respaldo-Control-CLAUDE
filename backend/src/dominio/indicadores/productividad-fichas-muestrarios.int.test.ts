/**
 * Tests de INTEGRACIÓN de F7-E4 (Módulo Indicadores: productividad, fichas confiables y muestrarios)
 * contra Postgres efímero (testcontainers). Ejercitan el DOMINIO (no HTTP). Verifican:
 *  (a) Productividad IP: el tablero AGREGA (Σ + promedio) los índices diarios reales por semana ISO,
 *      cruzando el SQL del tablero contra la fórmula pura `indiceProductividadIp`.
 *  (b) Productividad Almacén: el índice del tablero cuadra con `indiceProductividadAlmacen` (J=9).
 *  (c) Fichas confiables: % por orden y global (Σ OK ÷ Σ reactivos) + "confiable" (100% OK).
 *  (d) Muestrarios: cumplimiento (fechaEntregado ≤ fechaRequerida) en el KPI.
 *  (e) A9: la empresa activa NO ve datos de otra empresa.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Empresa, PrismaClient } from '../../datos/index.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import type { ClavePermiso } from '../../contrato/index.js';

import {
  crearActividad,
  crearPersonal,
  indiceProductividadAlmacen,
  indiceProductividadIp,
  registrarProductividad,
  tableroProductividad,
} from './productividad.js';
import { fichasConfiables, obtenerFichaOrden, verificarFichaOrden } from './fichas.js';
import {
  crearMuestrario,
  cumplimientoMuestrarios,
  entregarMuestrario,
  listarMuestrarios,
} from './muestrarios.js';

let cliente: PrismaClient;
let empresa: Empresa;
let idModelo: number;
let idCliente: number;

const PERM: ClavePermiso[] = [
  'indicadores.ip-productividad',
  'indicadores.almacen-productividad',
  'indicadores.ip-confiabilidad',
  'indicadores.ip-muestrarios',
  'indicadores.fecha-libre',
];
const sesion = (idEmpresa: number) =>
  sesionDePrueba({ idEmpresaActiva: idEmpresa, permisos: PERM });
const bd = () => ({ cliente });

async function crearOrden(idEmpresa: number, folio: bigint): Promise<number> {
  const orden = await cliente.orden.create({
    data: {
      folio,
      idEmpresa,
      idModelo,
      idCliente,
      estado: 'capturada',
      fecha: new Date('2026-06-01T00:00:00.000Z'),
      fechaInicioRC: new Date('2026-06-01T00:00:00.000Z'),
    },
  });
  return orden.id;
}

beforeAll(() => {
  cliente = clientePruebas();
});

afterAll(async () => {
  await cliente.$disconnect();
});

beforeEach(async () => {
  await limpiarBaseDatos(cliente);
  empresa = await crearEmpresaPrueba(cliente, 'Empresa E4');
  const modelo = await cliente.modelo.create({
    data: { codigo: 'MOD-E4', descripcion: 'Playera' },
  });
  idModelo = modelo.id;
  const c = await cliente.cliente.create({ data: { nombre: 'Tienda E4' } });
  idCliente = c.id;
});

describe('Productividad IP — tablero agrega índices reales por semana', () => {
  it('suma y promedia los índices diarios y cuadra con la fórmula pura', async () => {
    const s = sesion(empresa.id);
    const persona = await crearPersonal(s, { nombre: 'Laura', area: 'ip', horasBase: 8 }, bd());
    const act = await crearActividad(s, { nombre: 'Fichas', area: 'ip', porcentajeD: 1 }, bd());

    // Dos registros de la MISMA semana ISO (2026-06-01 lun, 2026-06-02 mar).
    await registrarProductividad(
      s,
      {
        fecha: '2026-06-01',
        idActividad: act.id,
        idPersona: persona.id,
        cantidad: 10,
        horasTrabajadas: 8,
        personas: 1,
      },
      bd(),
    );
    await registrarProductividad(
      s,
      {
        fecha: '2026-06-02',
        idActividad: act.id,
        idPersona: persona.id,
        cantidad: 5,
        horasTrabajadas: 8,
        personas: 1,
      },
      bd(),
    );

    const esperadoDia1 = indiceProductividadIp({
      horasBase: 8,
      horasTrabajadas: 8,
      porcentajeD: 1,
      cantidad: 10,
    });
    const esperadoDia2 = indiceProductividadIp({
      horasBase: 8,
      horasTrabajadas: 8,
      porcentajeD: 1,
      cantidad: 5,
    });

    const tablero = await tableroProductividad(s, { area: 'ip', agrupacion: 'semana' }, bd());
    expect(tablero.filas).toHaveLength(1);
    const fila = tablero.filas[0];
    expect(fila?.numRegistros).toBe(2);
    expect(fila?.indiceTotal).toBeCloseTo(esperadoDia1 + esperadoDia2, 4); // 15
    expect(fila?.indicePromedio).toBeCloseTo((esperadoDia1 + esperadoDia2) / 2, 4); // 7.5
    expect(fila?.porcentajeTrabajado).toBeCloseTo(1, 4); // 16 horas / 16 base
    expect(fila?.estandar).toBeCloseTo(1, 4);
  });
});

describe('Productividad Almacén — índice del tablero cuadra con la fórmula (J=9)', () => {
  it('agrega un registro de almacén con su estándar de piezas/persona/día', async () => {
    const s = sesion(empresa.id);
    const act = await crearActividad(
      s,
      { nombre: 'Empaque', area: 'almacen', pzPersDia: 100 },
      bd(),
    );
    await registrarProductividad(
      s,
      { fecha: '2026-06-15', idActividad: act.id, cantidad: 200, horasTrabajadas: 9, personas: 1 },
      bd(),
    );
    const esperado = indiceProductividadAlmacen({
      jornadaBase: 9,
      pzPersDia: 100,
      piezas: 200,
      personas: 1,
      horasTrabajadas: 9,
    });
    const tablero = await tableroProductividad(s, { area: 'almacen', agrupacion: 'mes' }, bd());
    expect(tablero.filas).toHaveLength(1);
    expect(tablero.filas[0]?.indiceTotal).toBeCloseTo(esperado, 4); // 2.0
    expect(tablero.filas[0]?.estandar).toBeCloseTo(100, 4);
  });
});

describe('Fichas confiables — % por orden y global', () => {
  it('calcula el % de una orden y el agregado; una orden 100% OK es "confiable"', async () => {
    const s = sesion(empresa.id);
    const r1 = await cliente.checklistFichaDef.create({
      data: { clave: 'InfGeneral', etiqueta: 'General', orden: 1 },
    });
    const r2 = await cliente.checklistFichaDef.create({
      data: { clave: 'InfTela', etiqueta: 'Tela', orden: 2 },
    });
    const idOrden = await crearOrden(empresa.id, 5001n);

    let ficha = await verificarFichaOrden(
      s,
      idOrden,
      {
        items: [
          { idReactivo: r1.id, hecho: true },
          { idReactivo: r2.id, hecho: false },
        ],
        fecha: '2026-06-10',
      },
      bd(),
    );
    expect(ficha.totalReactivos).toBe(2);
    expect(ficha.hechos).toBe(1);
    expect(ficha.porcentaje).toBeCloseTo(0.5, 4);

    let indicador = await fichasConfiables(s, {}, bd());
    expect(indicador.global.ordenesEvaluadas).toBe(1);
    expect(indicador.global.reactivosTotales).toBe(2);
    expect(indicador.global.reactivosOk).toBe(1);
    expect(indicador.global.porcentaje).toBeCloseTo(0.5, 4);
    expect(indicador.global.ordenesConfiables).toBe(0);
    expect(indicador.datos[0]?.confiable).toBe(false);

    // Marca el segundo reactivo OK → orden confiable al 100%.
    ficha = await verificarFichaOrden(
      s,
      idOrden,
      { items: [{ idReactivo: r2.id, hecho: true }], fecha: '2026-06-11' },
      bd(),
    );
    expect(ficha.hechos).toBe(2);
    expect(ficha.porcentaje).toBeCloseTo(1, 4);

    indicador = await fichasConfiables(s, {}, bd());
    expect(indicador.global.ordenesConfiables).toBe(1);
    expect(indicador.global.porcentaje).toBeCloseTo(1, 4);
    expect(indicador.datos[0]?.confiable).toBe(true);

    // obtenerFichaOrden refleja el mismo estado.
    const leida = await obtenerFichaOrden(s, idOrden, bd());
    expect(leida.hechos).toBe(2);
  });
});

describe('Muestrarios — cumplimiento (a tiempo)', () => {
  it('entrega dentro de la fecha requerida y el KPI cuenta el cumplimiento', async () => {
    const s = sesion(empresa.id);
    const creado = await crearMuestrario(
      s,
      {
        idCliente,
        cantBoards: 3,
        cantMuestras: 10,
        fechaSolicitado: '2026-06-01',
        fechaRequerida: '2026-06-20',
      },
      bd(),
    );
    expect(creado.estado).toBe('pendiente');

    const pendientes = await listarMuestrarios(s, { estado: 'pendiente' }, bd());
    expect(pendientes.total).toBe(1);

    const entregado = await entregarMuestrario(
      s,
      creado.id,
      { fechaEntregado: '2026-06-18', boardsOK: 3, muestrasOK: 10 },
      bd(),
    );
    expect(entregado.estado).toBe('entregado');
    expect(entregado.aTiempo).toBe(true);

    const kpi = await cumplimientoMuestrarios(s, {}, bd());
    expect(kpi.total).toBe(1);
    expect(kpi.entregados).toBe(1);
    expect(kpi.aTiempo).toBe(1);
    expect(kpi.tarde).toBe(0);
    expect(kpi.porcentaje).toBeCloseTo(1, 4);
  });

  it('cuenta como tarde una entrega posterior a la fecha requerida', async () => {
    const s = sesion(empresa.id);
    const creado = await crearMuestrario(
      s,
      {
        idCliente,
        cantBoards: 1,
        cantMuestras: 1,
        fechaSolicitado: '2026-06-01',
        fechaRequerida: '2026-06-10',
      },
      bd(),
    );
    const entregado = await entregarMuestrario(
      s,
      creado.id,
      { fechaEntregado: '2026-06-15' },
      bd(),
    );
    expect(entregado.aTiempo).toBe(false);
    const kpi = await cumplimientoMuestrarios(s, {}, bd());
    expect(kpi.tarde).toBe(1);
    expect(kpi.porcentaje).toBeCloseTo(0, 4);
  });
});

describe('A9 — aislamiento por empresa', () => {
  it('no muestra registros de otra empresa en el tablero', async () => {
    const otra = await crearEmpresaPrueba(cliente, 'Empresa Ajena');
    const sOtra = sesion(otra.id);
    const act = await crearActividad(
      sOtra,
      { nombre: 'Empaque', area: 'almacen', pzPersDia: 100 },
      bd(),
    );
    await registrarProductividad(
      sOtra,
      { fecha: '2026-06-15', idActividad: act.id, cantidad: 100, horasTrabajadas: 9, personas: 1 },
      bd(),
    );
    // La empresa "empresa" (activa por defecto en los tests) no ve nada de "otra".
    const tablero = await tableroProductividad(
      sesion(empresa.id),
      { area: 'almacen', agrupacion: 'mes' },
      bd(),
    );
    expect(tablero.filas).toHaveLength(0);
  });
});
