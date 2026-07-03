/**
 * Tests de INTEGRACIÓN del MOTOR DE KPIs (F7-E3) contra Postgres efímero (testcontainers). Arma un
 * dataset SINTÉTICO calculado A MANO, refresca las VISTAS MATERIALIZADAS con `refrescarKpis(bd)` (sin
 * transacción — CONCURRENTLY lo exige) y ejercita el DOMINIO (no HTTP). Verifica:
 *  (a) `refrescarKpis` estampa el sello `datosAl` (última actualización).
 *  (b) % de entregas a tiempo del último proceso (3 órdenes, 2 a tiempo → 66.7%).
 *  (c) lead time / cuellos de botella / desempeño por responsable salen agregados.
 *  (d) % de aprobación de un maquilero (3 calificadas, 2 aprobadas → 66.7%) + defectos top.
 *  (e) WIP de una etapa (cortado 30 − enviado 20 → 10 por enviar) + totales.
 *  (f) A9: la empresa activa NO ve las órdenes de otra empresa.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Empresa, PrismaClient } from '../../datos/index.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import type { ClavePermiso } from '../../contrato/index.js';
import { refrescarKpis } from '../../comun/jobs/refrescar-kpis.js';

import { kpisRutaCritica, kpisCalidadMaquilero, kpisWip } from './kpis.js';

let cliente: PrismaClient;
let empresa: Empresa;
let empresa2: Empresa;
let idMaquilero: number;
let idOrdenWip: number;
// Catálogos globales sembrados en beforeEach, reutilizables por los tests que arman datos extra.
let idModelo: number;
let idCliente: number;
let idProcesoB: number;
let idAna: string;

const PERM: ClavePermiso[] = ['indicadores.ver'];
const sesion = (idEmpresa: number) =>
  sesionDePrueba({ idEmpresaActiva: idEmpresa, permisos: PERM });
const bd = () => ({ cliente });

/** Crea una orden mínima (sin pedido) en una empresa. */
async function crearOrden(
  idEmpresa: number,
  idModelo: number,
  idCliente: number,
  folio: bigint,
): Promise<number> {
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

/**
 * Crea el último proceso de la RC de una orden (define entregas a tiempo). Si `fechaPlaneada` es null,
 * la orden queda COMPLETADA pero SIN plan (no medible) → fuera del denominador del % a tiempo.
 */
async function crearUltimoProceso(
  idOrden: number,
  idProcesoDef: number,
  fechaReal: string,
  fechaPlaneada: string | null,
  capturadoPorId: string,
): Promise<void> {
  await cliente.rutaOrden.create({
    data: {
      idOrden,
      idProcesoDef,
      secuencia: 2,
      duracionDias: 3,
      ultimoProceso: true,
      fechaReal: new Date(fechaReal),
      fechaPlaneadaVigente: fechaPlaneada === null ? null : new Date(fechaPlaneada),
      capturadoPorId,
      estado: 'completado',
    },
  });
}

beforeAll(() => {
  cliente = clientePruebas();
});

afterAll(async () => {
  await cliente.$disconnect();
});

beforeEach(async () => {
  await limpiarBaseDatos(cliente);
  empresa = await crearEmpresaPrueba(cliente, 'Empresa KPI');
  empresa2 = await crearEmpresaPrueba(cliente, 'Empresa Otra');

  const ana = await cliente.usuario.create({
    data: { username: 'ana', email: 'ana@control.local', nombre: 'Ana' },
  });
  idAna = ana.id;

  const rojo = await cliente.color.create({ data: { nombre: 'Rojo' } });
  const tCH = await cliente.talla.create({ data: { etiqueta: 'CH', orden: 1 } });
  const tM = await cliente.talla.create({ data: { etiqueta: 'M', orden: 2 } });
  const modelo = await cliente.modelo.create({ data: { codigo: 'MOD-1', descripcion: 'Playera' } });
  idModelo = modelo.id;
  const clienteNeg = await cliente.cliente.create({ data: { nombre: 'Tienda X' } });
  idCliente = clienteNeg.id;
  const maquilero = await cliente.proveedor.create({ data: { nombre: 'Taller A' } });
  idMaquilero = maquilero.id;

  const procA = await cliente.procesoDef.create({ data: { codigo: 'armado', nombre: 'Armado' } });
  const procB = await cliente.procesoDef.create({ data: { codigo: 'empaque', nombre: 'Empaque' } });
  idProcesoB = procB.id;

  // ── 3 órdenes de empresa1 con su último proceso (2 a tiempo, 1 tarde) ────────────
  const o1 = await crearOrden(empresa.id, modelo.id, clienteNeg.id, 1n);
  const o2 = await crearOrden(empresa.id, modelo.id, clienteNeg.id, 2n);
  const o3 = await crearOrden(empresa.id, modelo.id, clienteNeg.id, 3n);
  idOrdenWip = o1;

  // Un proceso intermedio (para lead time / cuellos) + el último (entregas a tiempo).
  for (const [o, realA, planA, realB, planB] of [
    [o1, '2026-06-04', '2026-06-05', '2026-06-10', '2026-06-12'],
    [o2, '2026-06-06', '2026-06-05', '2026-06-15', '2026-06-14'],
    [o3, '2026-06-03', '2026-06-05', '2026-06-05', '2026-06-10'],
  ] as const) {
    await cliente.rutaOrden.create({
      data: {
        idOrden: o,
        idProcesoDef: procA.id,
        secuencia: 1,
        duracionDias: 2,
        fechaReal: new Date(realA),
        fechaPlaneadaVigente: new Date(planA),
        capturadoPorId: ana.id,
        estado: 'completado',
      },
    });
    await crearUltimoProceso(o, procB.id, realB, planB, ana.id);
  }

  // A9: una orden en empresa2 con su último proceso a tiempo (NO debe contar para empresa1).
  const o4 = await crearOrden(empresa2.id, modelo.id, clienteNeg.id, 1n);
  await crearUltimoProceso(o4, procB.id, '2026-06-05', '2026-06-10', ana.id);

  // ── WIP de o1: pedido 35 (matriz), cortado 30, enviado 20 ────────────────────────
  await cliente.ordenLinea.create({
    data: {
      idOrden: o1,
      idColor: rojo.id,
      tallas: {
        create: [
          { idTalla: tCH.id, cantidad: 15 },
          { idTalla: tM.id, cantidad: 20 },
        ],
      },
    },
  });
  await cliente.etapaMovimiento.create({
    data: {
      folio: 100n,
      idEmpresa: empresa.id,
      idOrden: o1,
      tipo: 'corte',
      fecha: new Date('2026-06-02T00:00:00.000Z'),
      detalles: {
        create: [
          { idColor: rojo.id, idTalla: tCH.id, cantidad: 12 },
          { idColor: rojo.id, idTalla: tM.id, cantidad: 18 },
        ],
      },
    },
  });
  await cliente.etapaMovimiento.create({
    data: {
      folio: 101n,
      idEmpresa: empresa.id,
      idOrden: o1,
      tipo: 'envio_maquila',
      idTercero: maquilero.id,
      fecha: new Date('2026-06-03T00:00:00.000Z'),
      detalles: { create: [{ idColor: rojo.id, idTalla: tM.id, cantidad: 20 }] },
    },
  });

  // ── Auditorías de calidad de o1 (maquilero A): 2 aprobadas, 1 reprobada, 1 sin calificar ──
  const defecto = await cliente.defectoCatalogo.create({
    data: { clave: 'D1', descripcion: 'Costura floja', nivelAQL: 2.5 },
  });
  const auds: {
    folio: bigint;
    resultado: 'aprobado' | 'reprobado' | 'no_calificado';
    fecha: string;
    fallas: number;
    cancelada: boolean;
  }[] = [
    { folio: 1n, resultado: 'aprobado', fecha: '2026-06-05', fallas: 5, cancelada: false },
    { folio: 2n, resultado: 'aprobado', fecha: '2026-06-10', fallas: 3, cancelada: false },
    { folio: 3n, resultado: 'reprobado', fecha: '2026-06-15', fallas: 0, cancelada: false },
    { folio: 4n, resultado: 'no_calificado', fecha: '2026-06-20', fallas: 0, cancelada: false },
    { folio: 5n, resultado: 'aprobado', fecha: '2026-06-25', fallas: 9, cancelada: true },
  ];
  for (const a of auds) {
    await cliente.auditoria.create({
      data: {
        numAuditoria: a.folio,
        idEmpresa: empresa.id,
        idOrden: o1,
        idMaquilero: maquilero.id,
        fechaElaboracion: new Date(a.fecha),
        fechaAuditoria: new Date(a.fecha),
        tamanoMuestra: 20,
        resultado: a.resultado,
        cancelada: a.cancelada,
        ...(a.fallas > 0
          ? { defectos: { create: [{ idDefecto: defecto.id, numFallas: a.fallas }] } }
          : {}),
      },
    });
  }

  // Refresca las vistas materializadas (fuera de transacción) para que reflejen lo sembrado.
  await refrescarKpis(bd());
});

describe('kpisRutaCritica', () => {
  it('estampa el sello datosAl tras refrescar', async () => {
    const k = await kpisRutaCritica(sesion(empresa.id), {}, bd());
    expect(k.datosAl).not.toBeNull();
  });

  it('% de entregas a tiempo del último proceso (2 de 3 → 66.7%)', async () => {
    const k = await kpisRutaCritica(sesion(empresa.id), {}, bd());
    expect(k.entregasATiempo.completadas).toBe(3);
    expect(k.entregasATiempo.medibles).toBe(3); // las 3 tienen plan → son medibles
    expect(k.entregasATiempo.completadasSinPlan).toBe(0);
    expect(k.entregasATiempo.aTiempo).toBe(2);
    expect(k.entregasATiempo.porcentaje).toBeCloseTo(0.6667, 4);
  });

  it('excluye del denominador las completadas SIN fecha planeada (2 a tiempo de 2 medibles = 100%)', async () => {
    // Empresa aislada: 2 a tiempo CON plan + 1 completada SIN plan. La sin-plan NO es medible → el %
    // es 2/2 = 100% (NO 2/3 = 66.7%): una RC histórica sin plan no debe castigar el indicador.
    const emp = await crearEmpresaPrueba(cliente, 'Empresa SinPlan');
    const oa = await crearOrden(emp.id, idModelo, idCliente, 10n);
    const ob = await crearOrden(emp.id, idModelo, idCliente, 11n);
    const oc = await crearOrden(emp.id, idModelo, idCliente, 12n);
    await crearUltimoProceso(oa, idProcesoB, '2026-06-05', '2026-06-10', idAna); // a tiempo, medible
    await crearUltimoProceso(ob, idProcesoB, '2026-06-05', '2026-06-10', idAna); // a tiempo, medible
    await crearUltimoProceso(oc, idProcesoB, '2026-06-05', null, idAna); // completada SIN plan
    await refrescarKpis(bd());

    const k = await kpisRutaCritica(sesion(emp.id), {}, bd());
    expect(k.entregasATiempo.completadas).toBe(3); // las 3 tienen fecha real
    expect(k.entregasATiempo.medibles).toBe(2); // solo 2 tienen plan
    expect(k.entregasATiempo.completadasSinPlan).toBe(1);
    expect(k.entregasATiempo.aTiempo).toBe(2);
    expect(k.entregasATiempo.porcentaje).toBeCloseTo(1, 4); // 2/2, no 2/3
  });

  it('agrega lead time por proceso, cuellos de botella y desempeño por responsable', async () => {
    const k = await kpisRutaCritica(sesion(empresa.id), {}, bd());
    expect(k.leadTime.length).toBeGreaterThan(0);
    expect(k.cuellosBotella.length).toBeGreaterThan(0);
    // Cuellos ordenados por atraso medio DESC (el mayor primero).
    for (let i = 1; i < k.cuellosBotella.length; i += 1) {
      const prev = k.cuellosBotella[i - 1]?.atrasoMedioDias ?? 0;
      const cur = k.cuellosBotella[i]?.atrasoMedioDias ?? 0;
      expect(prev).toBeGreaterThanOrEqual(cur);
    }
    expect(k.desempeno.find((d) => d.responsable === 'Ana')).toBeDefined();
    expect(k.tendencia.length).toBeGreaterThan(0);
  });

  it('A9: la empresa activa NO ve las órdenes de otra empresa', async () => {
    const k1 = await kpisRutaCritica(sesion(empresa.id), {}, bd());
    expect(k1.entregasATiempo.completadas).toBe(3); // no cuenta la orden de empresa2
    const k2 = await kpisRutaCritica(sesion(empresa2.id), {}, bd());
    expect(k2.entregasATiempo.completadas).toBe(1);
  });

  it('filtra por periodo (año/mes) sin romper', async () => {
    const k = await kpisRutaCritica(sesion(empresa.id), { anio: 2026, mes: 6 }, bd());
    expect(k.entregasATiempo.completadas).toBe(3);
    const vacio = await kpisRutaCritica(sesion(empresa.id), { anio: 2099 }, bd());
    expect(vacio.entregasATiempo.completadas).toBe(0);
  });
});

describe('kpisCalidadMaquilero', () => {
  it('% de aprobación por maquilero (2 aprobadas de 3 calificadas → 66.7%); excluye canceladas', async () => {
    const k = await kpisCalidadMaquilero(sesion(empresa.id), {}, bd());
    const m = k.maquileros.find((x) => x.idMaquilero === idMaquilero);
    expect(m).toBeDefined();
    expect(m?.numAuditorias).toBe(4); // la cancelada NO cuenta
    expect(m?.aprobadas).toBe(2);
    expect(m?.calificadas).toBe(3);
    expect(m?.porcentaje).toBeCloseTo(0.6667, 4);
  });

  it('defectos top = Σ fallas (5 + 3 = 8), sin las auditorías canceladas', async () => {
    const k = await kpisCalidadMaquilero(sesion(empresa.id), {}, bd());
    expect(k.defectosTop[0]?.clave).toBe('D1');
    expect(k.defectosTop[0]?.totalFallas).toBe(8); // 9 de la cancelada NO cuenta
    expect(k.tendencia.length).toBeGreaterThan(0);
  });
});

describe('kpisWip', () => {
  it('WIP por etapa: cortado 30 − enviado 20 = 10 por enviar; por cortar 5; por recibir 20', async () => {
    const k = await kpisWip(sesion(empresa.id), { soloPendientes: true }, bd());
    expect(k.totales.cortado).toBe(30);
    expect(k.totales.enviado).toBe(20);
    expect(k.totales.cortadoPorEnviar).toBe(10);
    expect(k.totales.porCortar).toBe(5); // pedido 35 − cortado 30
    expect(k.totales.porRecibir).toBe(20); // enviado 20 − recibido 0
    const fila = k.datos.find((o) => o.idOrden === idOrdenWip);
    expect(fila).toBeDefined();
    expect(fila?.cortadoPorEnviar).toBe(10);
  });

  it('soloPendientes=false incluye también las órdenes sin avance', async () => {
    const todas = await kpisWip(sesion(empresa.id), { soloPendientes: false }, bd());
    const soloPend = await kpisWip(sesion(empresa.id), { soloPendientes: true }, bd());
    expect(todas.total).toBeGreaterThanOrEqual(soloPend.total);
  });
});
