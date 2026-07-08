/**
 * Tests de INTEGRACIÓN del tablero "Análisis RC" (R7). Postgres efímero (testcontainers). Cubre lo
 * NUEVO de R7 (la entrega/ciclo vive en la vista materializada de F7-E3, ya probada allá; aquí solo
 * se verifica que el tablero la incluye sin romper):
 *  • SALUD: KPIs (activas / a tiempo / en riesgo / atrasadas / % cumplimiento) y A9 por empresa.
 *  • TRIAGE: órdenes que requieren atención con etapa atorada + responsable, ordenadas por urgencia.
 *  • ALERTAS predictivas (CPM forward pass): órdenes a tiempo con colchón proyectado negativo.
 *  • RIESGO POR CLIENTE y CUELLOS por proceso.
 *  • DESEMPEÑO (scoring + bono): % en tiempo, vencidos, calificación, bono; gate `rc.programar`.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PrismaClient } from '../../datos/index.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import { analisisRc, desempenoRc } from './analisisRc.js';

let cliente: PrismaClient;
let idEmpresa: number;

const bd = () => ({ cliente });
const hoy = new Date('2026-06-22T00:00:00Z'); // lunes

beforeAll(() => {
  cliente = clientePruebas();
});
afterAll(async () => {
  await cliente.$disconnect();
});
beforeEach(async () => {
  await limpiarBaseDatos(cliente);
  idEmpresa = (await crearEmpresaPrueba(cliente)).id;
});

let folioSeq = 1;

async function crearOrden(opciones?: {
  nombreCliente?: string;
  rcActiva?: boolean;
  fechaEntregaRC?: string;
  idEmpresa?: number;
  idCliente?: number;
}): Promise<{ idOrden: number; idCliente: number }> {
  const clienteNeg =
    opciones?.idCliente !== undefined
      ? { id: opciones.idCliente }
      : await cliente.cliente.create({
          data: { nombre: opciones?.nombreCliente ?? `C ${folioSeq}-${String(Math.random())}` },
        });
  const modelo = await cliente.modelo.create({
    data: { codigo: `M-${folioSeq}-${String(Math.random())}`, descripcion: 'Modelo X' },
  });
  const orden = await cliente.orden.create({
    data: {
      folio: BigInt(folioSeq++),
      idEmpresa: opciones?.idEmpresa ?? idEmpresa,
      idModelo: modelo.id,
      idCliente: clienteNeg.id,
      rcActiva: opciones?.rcActiva ?? true,
      ...(opciones?.fechaEntregaRC === undefined
        ? {}
        : { fechaEntregaRC: new Date(`${opciones.fechaEntregaRC}T00:00:00Z`) }),
    },
  });
  return { idOrden: orden.id, idCliente: clienteNeg.id };
}

async function crearProcesoDef(codigo: string): Promise<number> {
  const p = await cliente.procesoDef.create({ data: { codigo, nombre: codigo.toUpperCase() } });
  return p.id;
}

async function crearRenglon(
  idOrden: number,
  idProcesoDef: number,
  opciones: {
    secuencia: number;
    estado?: 'pendiente' | 'activo' | 'completado';
    fechaPlaneadaVigente?: string | null;
    fechaReal?: string | null;
    duracionDias?: number;
    capturadoPorId?: string;
    capturadoEn?: string;
  },
): Promise<number> {
  const r = await cliente.rutaOrden.create({
    data: {
      idOrden,
      idProcesoDef,
      secuencia: opciones.secuencia,
      duracionDias: opciones.duracionDias ?? 1,
      estado: opciones.estado ?? 'pendiente',
      ...(opciones.fechaPlaneadaVigente === undefined || opciones.fechaPlaneadaVigente === null
        ? {}
        : { fechaPlaneadaVigente: new Date(`${opciones.fechaPlaneadaVigente}T00:00:00Z`) }),
      ...(opciones.fechaReal === undefined || opciones.fechaReal === null
        ? {}
        : { fechaReal: new Date(`${opciones.fechaReal}T00:00:00Z`) }),
      ...(opciones.capturadoPorId === undefined ? {} : { capturadoPorId: opciones.capturadoPorId }),
      ...(opciones.capturadoEn === undefined
        ? {}
        : {
            capturadoEn: new Date(
              opciones.capturadoEn.includes('T')
                ? opciones.capturadoEn
                : `${opciones.capturadoEn}T12:00:00Z`,
            ),
          }),
    },
  });
  return r.id;
}

const verTablero = () =>
  sesionDePrueba({ idEmpresaActiva: idEmpresa, permisos: ['rc.ruta-ver', 'roles.administrar'] });
const gestion = () =>
  sesionDePrueba({ idEmpresaActiva: idEmpresa, permisos: ['rc.programar', 'roles.administrar'] });

describe('analisisRc — salud + A9', () => {
  it('cuenta activas / a tiempo / en riesgo / atrasadas y % cumplimiento (empresa activa)', async () => {
    // Atrasada.
    const a = await crearOrden();
    await crearRenglon(a.idOrden, await crearProcesoDef('p-atr'), {
      secuencia: 0,
      estado: 'activo',
      fechaPlaneadaVigente: '2026-06-10',
    });
    // En riesgo (dentro de 3 días).
    const r = await crearOrden();
    await crearRenglon(r.idOrden, await crearProcesoDef('p-rie'), {
      secuencia: 0,
      estado: 'activo',
      fechaPlaneadaVigente: '2026-06-24',
    });
    // A tiempo (lejos).
    const t = await crearOrden();
    await crearRenglon(t.idOrden, await crearProcesoDef('p-ok'), {
      secuencia: 0,
      estado: 'activo',
      fechaPlaneadaVigente: '2026-07-20',
    });
    // Sin RC viva → no cuenta. De otra empresa → no cuenta (A9).
    await crearOrden({ rcActiva: false });
    const otra = await crearEmpresaPrueba(cliente, 'Otra SA');
    const o = await crearOrden({ idEmpresa: otra.id });
    await crearRenglon(o.idOrden, await crearProcesoDef('p-otra'), {
      secuencia: 0,
      estado: 'activo',
    });

    const res = await analisisRc(verTablero(), bd(), hoy);
    expect(res.salud.ordenesActivas).toBe(3);
    expect(res.salud.atrasadas).toBe(1);
    expect(res.salud.enRiesgo).toBe(1);
    expect(res.salud.aTiempo).toBe(1);
    expect(res.salud.cumplimiento).toBe(33); // 1/3
  });

  it('triage: etapa atorada + responsable, ordenado por urgencia (más vencida primero)', async () => {
    const rol = await cliente.rol.create({ data: { nombre: 'Cortadores', descripcion: 'x' } });
    const corte = await crearProcesoDef('corte');
    const empaque = await crearProcesoDef('empaque');
    await cliente.procesoDefRol.create({ data: { idProcesoDef: corte, idRol: rol.id } });

    const o = await crearOrden({ nombreCliente: 'Boutique Aurora', fechaEntregaRC: '2026-06-30' });
    // corte muy vencido (la etapa atorada) + empaque futuro.
    await crearRenglon(o.idOrden, corte, {
      secuencia: 0,
      estado: 'activo',
      fechaPlaneadaVigente: '2026-06-12',
    });
    await crearRenglon(o.idOrden, empaque, {
      secuencia: 1,
      estado: 'pendiente',
      fechaPlaneadaVigente: '2026-07-10',
    });

    const res = await analisisRc(verTablero(), bd(), hoy);
    expect(res.salud.atencion).toHaveLength(1);
    const fila = res.salud.atencion[0];
    expect(fila?.etapaAtorada).toBe('CORTE');
    expect(fila?.responsable).toBe('Cortadores');
    expect(fila?.semaforo).toBe('atrasado');
    expect(fila?.holguraDias).toBe(-10); // 2026-06-12 vs 2026-06-22
  });
});

describe('analisisRc — alertas predictivas (forward pass)', () => {
  it('marca una orden a tiempo cuyo trabajo restante no cabe antes de la entrega', async () => {
    // A tiempo hoy (planeada nula → aTiempo), pero un proceso de 5 días y entrega en 2 hábiles.
    const apretada = await crearOrden({ nombreCliente: 'Apretada', fechaEntregaRC: '2026-06-24' });
    await crearRenglon(apretada.idOrden, await crearProcesoDef('largo'), {
      secuencia: 0,
      estado: 'activo',
      duracionDias: 5,
      fechaPlaneadaVigente: null,
    });
    // A tiempo con holgura de sobra (proceso corto, entrega lejana) → NO alerta.
    const holgada = await crearOrden({ nombreCliente: 'Holgada', fechaEntregaRC: '2026-08-30' });
    await crearRenglon(holgada.idOrden, await crearProcesoDef('corto'), {
      secuencia: 0,
      estado: 'activo',
      duracionDias: 1,
      fechaPlaneadaVigente: null,
    });

    const res = await analisisRc(verTablero(), bd(), hoy);
    expect(res.alertas.map((a) => a.idOrden)).toEqual([apretada.idOrden]);
    expect(res.alertas[0]?.colchonDias).toBeLessThan(0);
    expect(res.alertas[0]?.procesosRestantes).toBe(1);
  });
});

describe('analisisRc — riesgo por cliente + cuellos', () => {
  it('agrupa por cliente con semáforo y agrega los cuellos por proceso', async () => {
    const cli = await cliente.cliente.create({ data: { nombre: 'Tienda Zeta' } });
    const corte = await crearProcesoDef('corte');
    // Dos órdenes del mismo cliente: una atrasada, una a tiempo.
    const o1 = await crearOrden({ idCliente: cli.id });
    await crearRenglon(o1.idOrden, corte, {
      secuencia: 0,
      estado: 'activo',
      fechaPlaneadaVigente: '2026-06-10',
    });
    const o2 = await crearOrden({ idCliente: cli.id });
    await crearRenglon(o2.idOrden, corte, {
      secuencia: 0,
      estado: 'activo',
      fechaPlaneadaVigente: '2026-07-30',
    });

    const res = await analisisRc(verTablero(), bd(), hoy);
    const riesgo = res.riesgoCliente.find((c) => c.idCliente === cli.id);
    expect(riesgo?.activas).toBe(2);
    expect(riesgo?.atrasadas).toBe(1);
    expect(riesgo?.semaforo).toBe('crit');

    const cuello = res.cuellos.find((c) => c.codigoProceso === 'corte');
    expect(cuello?.total).toBe(2); // dos procesos activos "corte"
    expect(cuello?.vencidos).toBe(1); // uno vencido
  });
});

describe('analisisRc — permisos', () => {
  it('el tablero exige rc.ruta-ver', async () => {
    const sinPermiso = sesionDePrueba({ idEmpresaActiva: idEmpresa, permisos: [] });
    await expect(analisisRc(sinPermiso, bd(), hoy)).rejects.toThrow();
  });
  it('el desempeño exige rc.programar', async () => {
    const soloVer = sesionDePrueba({ idEmpresaActiva: idEmpresa, permisos: ['rc.ruta-ver'] });
    await expect(desempenoRc(soloVer, bd(), hoy)).rejects.toThrow();
  });
});

describe('desempenoRc — scoring + bono', () => {
  it('calcula % en tiempo, calificación y bono por persona', async () => {
    // Dos roles/procesos/usuarios. P y Q son procesos ACTIVOS del catálogo (para entrar a la población).
    const rolCorte = await cliente.rol.create({ data: { nombre: 'Cortadores', descripcion: 'x' } });
    const rolEst = await cliente.rol.create({ data: { nombre: 'Estampadores', descripcion: 'x' } });
    const corte = await crearProcesoDef('corte');
    const estampado = await crearProcesoDef('estampado');
    await cliente.procesoDefRol.create({ data: { idProcesoDef: corte, idRol: rolCorte.id } });
    await cliente.procesoDefRol.create({ data: { idProcesoDef: estampado, idRol: rolEst.id } });

    const ana = await cliente.usuario.create({
      data: { username: 'ana', nombre: 'Ana Pérez', email: 'ana@control.local' },
    });
    const beto = await cliente.usuario.create({
      data: { username: 'beto', nombre: 'Beto Ruiz', email: 'beto@control.local' },
    });
    await cliente.usuarioRol.create({ data: { idUsuario: ana.id, idRol: rolCorte.id } });
    await cliente.usuarioRol.create({ data: { idUsuario: beto.id, idRol: rolEst.id } });

    // Historial: Ana 2 capturas EN TIEMPO (100%); Beto 1 en tiempo + 1 tarde (50%).
    const oHist = await crearOrden({ rcActiva: false });
    await crearRenglon(oHist.idOrden, corte, {
      secuencia: 0,
      estado: 'completado',
      fechaPlaneadaVigente: '2026-06-15',
      fechaReal: '2026-06-14',
      capturadoPorId: ana.id,
      capturadoEn: '2026-06-14',
    });
    await crearRenglon(oHist.idOrden, corte, {
      secuencia: 1,
      estado: 'completado',
      fechaPlaneadaVigente: '2026-06-16',
      fechaReal: '2026-06-16',
      capturadoPorId: ana.id,
      capturadoEn: '2026-06-16',
    });
    await crearRenglon(oHist.idOrden, estampado, {
      secuencia: 2,
      estado: 'completado',
      fechaPlaneadaVigente: '2026-06-15',
      fechaReal: '2026-06-15',
      capturadoPorId: beto.id,
      capturadoEn: '2026-06-15',
    });
    await crearRenglon(oHist.idOrden, estampado, {
      secuencia: 3,
      estado: 'completado',
      fechaPlaneadaVigente: '2026-06-15',
      fechaReal: '2026-06-20', // tarde
      capturadoPorId: beto.id,
      capturadoEn: '2026-06-20',
    });

    const res = await desempenoRc(gestion(), bd(), hoy);
    const ap = res.personas.find((p) => p.idUsuario === ana.id);
    const bp = res.personas.find((p) => p.idUsuario === beto.id);
    expect(ap?.onTimePct).toBe(100);
    expect(ap?.calificacion).toBe(100);
    expect(ap?.badge).toBe('excelente');
    expect(ap?.bono).toBe(true);
    expect(ap?.area).toBe('Cortadores');
    expect(bp?.onTimePct).toBe(50);
    expect(bp?.calificacion).toBe(50);
    expect(bp?.bono).toBe(false);
    // Orden: mejor calificación primero.
    expect(res.personas[0]?.idUsuario).toBe(ana.id);
    expect(res.conBono).toBe(1);
    expect(res.parametros.umbralBono).toBe(90);
  });

  it('calcula la REACCIÓN (h desde que el proceso cae en su cancha) y la TENDENCIA vs la semana pasada', async () => {
    // ── Carla: REACCIÓN. Un proceso captado con un ANTECESOR captado 6 h antes.
    const rolAcab = await cliente.rol.create({ data: { nombre: 'Acabadores', descripcion: 'x' } });
    const acabado = await crearProcesoDef('acabado');
    const cortePrev = await crearProcesoDef('corte-prev');
    await cliente.procesoDefRol.create({ data: { idProcesoDef: acabado, idRol: rolAcab.id } });
    const carla = await cliente.usuario.create({
      data: { username: 'carla', nombre: 'Carla Díaz', email: 'carla@control.local' },
    });
    await cliente.usuarioRol.create({ data: { idUsuario: carla.id, idRol: rolAcab.id } });

    const oR = await crearOrden({ rcActiva: false });
    // Antecesor: se captó a las 08:00 (sin dueño; solo marca cuándo terminó lo previo).
    const idAnt = await crearRenglon(oR.idOrden, cortePrev, {
      secuencia: 0,
      estado: 'completado',
      fechaReal: '2026-06-18',
      capturadoEn: '2026-06-18T08:00:00Z',
    });
    // Sucesor de Carla: lo captó a las 14:00 → reacción = 6 h.
    const idSuc = await crearRenglon(oR.idOrden, acabado, {
      secuencia: 1,
      estado: 'completado',
      fechaPlaneadaVigente: '2026-06-18',
      fechaReal: '2026-06-18',
      capturadoPorId: carla.id,
      capturadoEn: '2026-06-18T14:00:00Z',
    });
    await cliente.rutaOrdenDep.create({ data: { idRutaOrden: idSuc, idAntecesor: idAnt } });

    // ── Darío: TENDENCIA. Semana pasada 50% (1 de 2), esta semana 100% (2 de 2) → +50 pts.
    const rolEmp = await cliente.rol.create({ data: { nombre: 'Empaque', descripcion: 'x' } });
    const empaque = await crearProcesoDef('empaque');
    await cliente.procesoDefRol.create({ data: { idProcesoDef: empaque, idRol: rolEmp.id } });
    const dario = await cliente.usuario.create({
      data: { username: 'dario', nombre: 'Darío Luna', email: 'dario@control.local' },
    });
    await cliente.usuarioRol.create({ data: { idUsuario: dario.id, idRol: rolEmp.id } });

    const oD = await crearOrden({ rcActiva: false });
    // Semana pasada (captado 2026-06-10, en [hoy-14, hoy-7)): 1 en tiempo + 1 tarde.
    await crearRenglon(oD.idOrden, empaque, {
      secuencia: 0,
      estado: 'completado',
      fechaPlaneadaVigente: '2026-06-10',
      fechaReal: '2026-06-10',
      capturadoPorId: dario.id,
      capturadoEn: '2026-06-10',
    });
    await crearRenglon(oD.idOrden, empaque, {
      secuencia: 1,
      estado: 'completado',
      fechaPlaneadaVigente: '2026-06-10',
      fechaReal: '2026-06-12', // tarde
      capturadoPorId: dario.id,
      capturadoEn: '2026-06-10',
    });
    // Esta semana (captado 2026-06-18, en [hoy-7, hoy]): 2 en tiempo.
    await crearRenglon(oD.idOrden, empaque, {
      secuencia: 2,
      estado: 'completado',
      fechaPlaneadaVigente: '2026-06-18',
      fechaReal: '2026-06-18',
      capturadoPorId: dario.id,
      capturadoEn: '2026-06-18',
    });
    await crearRenglon(oD.idOrden, empaque, {
      secuencia: 3,
      estado: 'completado',
      fechaPlaneadaVigente: '2026-06-18',
      fechaReal: '2026-06-18',
      capturadoPorId: dario.id,
      capturadoEn: '2026-06-18',
    });

    const res = await desempenoRc(gestion(), bd(), hoy);
    const cp = res.personas.find((p) => p.idUsuario === carla.id);
    const dp = res.personas.find((p) => p.idUsuario === dario.id);
    expect(cp?.reaccionHoras).toBe(6);
    expect(dp?.tendencia).toBe(50); // 100% esta semana − 50% la pasada
  });
});
