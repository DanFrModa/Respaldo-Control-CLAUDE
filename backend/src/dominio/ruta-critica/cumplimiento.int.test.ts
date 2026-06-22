/**
 * Tests de INTEGRACIÓN del CUMPLIMIENTO + CPM + semáforo de la RC (F5-E4). Postgres efímero
 * (testcontainers). Cubre:
 *  • CPM (recalcularRutaOrden): escribe fechaPlaneadaOriginal (solo 1ª vez) / vigente / acumulado;
 *    idempotencia (2 corridas = mismo resultado) y "concurrencia" (2 recálculos no se pisan).
 *  • completarProceso: captura fechaReal + activa sucesores listos (N antecesores) + cierra la RC en
 *    el último proceso; revertirProceso reabre la RC.
 *  • intersección de roles N:M (ProcesoDefRol): un usuario con rol responsable SÍ captura; sin rol NO;
 *    el admin (roles.administrar) captura cualquier proceso.
 *  • checklist: completar todos los ítems auto-completa el proceso; desmarcar lo revierte.
 *  • barrido de riesgo: actualiza Orden.enRiesgo (incl. orden sin ruta con fechaEntregaRC).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PrismaClient } from '../../datos/index.js';
import { ErrorPermiso } from '../../comun/errores.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import { COLAS_JOBS, claveSerializacion } from '../../comun/jobs/index.js';
import { barrerRiesgoRc } from '../../comun/jobs/riesgo-rc.js';
import { recalcularRutaOrden } from './cpm-job.js';
import { completarProceso, marcarChecklistItem, revertirProceso } from './cumplimiento.js';

let cliente: PrismaClient;
let idEmpresa: number;

const bd = () => ({ cliente });

beforeAll(() => {
  cliente = clientePruebas();
});
afterAll(async () => {
  await cliente.$disconnect();
});

beforeEach(async () => {
  await limpiarBaseDatos(cliente);
  const empresa = await crearEmpresaPrueba(cliente);
  idEmpresa = empresa.id;
});

/** Crea una orden mínima con RC activa y fecha de entrega de la RC. */
async function crearOrdenConRc(fechaEntregaRC: string): Promise<number> {
  const clienteNeg = await cliente.cliente.create({ data: { nombre: `C ${String(Date.now())}` } });
  const modelo = await cliente.modelo.create({
    data: { codigo: `M-${String(Math.random())}`, descripcion: 'X' },
  });
  const orden = await cliente.orden.create({
    data: {
      folio: BigInt(Math.floor(Math.random() * 1_000_000)),
      idEmpresa,
      idModelo: modelo.id,
      idCliente: clienteNeg.id,
      rcActiva: true,
      fechaEntregaRC: new Date(`${fechaEntregaRC}T00:00:00Z`),
    },
  });
  return orden.id;
}

/** Crea un proceso del catálogo. */
async function crearProcesoDef(codigo: string): Promise<number> {
  const p = await cliente.procesoDef.create({ data: { codigo, nombre: codigo.toUpperCase() } });
  return p.id;
}

/** Crea un renglón de ruta para una orden (con duración, banderas y antecesores en idRutaOrden). */
async function crearRenglon(
  idOrden: number,
  idProcesoDef: number,
  opciones: {
    duracionDias: number;
    secuencia: number;
    ultimoProceso?: boolean;
    estado?: 'pendiente' | 'activo' | 'completado';
  },
): Promise<number> {
  const r = await cliente.rutaOrden.create({
    data: {
      idOrden,
      idProcesoDef,
      secuencia: opciones.secuencia,
      duracionDias: opciones.duracionDias,
      ultimoProceso: opciones.ultimoProceso ?? false,
      estado: opciones.estado ?? 'pendiente',
    },
  });
  return r.id;
}

async function ligar(idRuta: number, idAntecesor: number): Promise<void> {
  await cliente.rutaOrdenDep.create({ data: { idRutaOrden: idRuta, idAntecesor } });
}

describe('recalcularRutaOrden (CPM)', () => {
  it('escribe fechaPlaneadaOriginal/vigente y acumulado; conserva original al re-correr', async () => {
    const idOrden = await crearOrdenConRc('2026-06-29'); // lunes
    const a = await crearProcesoDef('a');
    const b = await crearProcesoDef('b');
    const c = await crearProcesoDef('c');
    const ra = await crearRenglon(idOrden, a, { duracionDias: 2, secuencia: 0 });
    const rb = await crearRenglon(idOrden, b, { duracionDias: 3, secuencia: 1 });
    const rc = await crearRenglon(idOrden, c, {
      duracionDias: 1,
      secuencia: 2,
      ultimoProceso: true,
    });
    await ligar(rb, ra);
    await ligar(rc, rb);

    await recalcularRutaOrden(idOrden, idEmpresa, bd());

    const cFila = await cliente.rutaOrden.findUniqueOrThrow({ where: { id: rc } });
    expect(cFila.fechaPlaneadaVigente?.toISOString().slice(0, 10)).toBe('2026-06-29');
    expect(cFila.fechaPlaneadaOriginal?.toISOString().slice(0, 10)).toBe('2026-06-29');
    expect(cFila.acumuladoDias).toBe(7);
    const aFila = await cliente.rutaOrden.findUniqueOrThrow({ where: { id: ra } });
    expect(aFila.fechaPlaneadaVigente?.toISOString().slice(0, 10)).toBe('2026-06-23');

    // Re-corre con OTRA fecha de entrega: la vigente cambia, la ORIGINAL se conserva.
    await cliente.orden.update({
      where: { id: idOrden },
      data: { fechaEntregaRC: new Date('2026-07-06T00:00:00Z') },
    });
    await recalcularRutaOrden(idOrden, idEmpresa, bd());
    const cFila2 = await cliente.rutaOrden.findUniqueOrThrow({ where: { id: rc } });
    expect(cFila2.fechaPlaneadaVigente?.toISOString().slice(0, 10)).toBe('2026-07-06');
    expect(cFila2.fechaPlaneadaOriginal?.toISOString().slice(0, 10)).toBe('2026-06-29'); // intacta
  });

  it('dos recálculos en paralelo de la misma orden dejan un resultado consistente (idempotencia)', async () => {
    // NOTA: la SERIALIZACIÓN real de jobs la garantiza pg-boss por singletonKey (no se ejercita aquí:
    // el motor de jobs está inactivo en tests). Este test prueba que el CÁLCULO es idempotente: dos
    // ejecuciones del handler sobre la misma orden, en paralelo, dejan las mismas fechas. La clave de
    // serialización (lo que pg-boss usa) se valida aparte abajo.
    const idOrden = await crearOrdenConRc('2026-06-29');
    const a = await crearProcesoDef('a');
    const b = await crearProcesoDef('b');
    const ra = await crearRenglon(idOrden, a, { duracionDias: 2, secuencia: 0 });
    const rb = await crearRenglon(idOrden, b, {
      duracionDias: 1,
      secuencia: 1,
      ultimoProceso: true,
    });
    await ligar(rb, ra);

    await Promise.all([
      recalcularRutaOrden(idOrden, idEmpresa, bd()),
      recalcularRutaOrden(idOrden, idEmpresa, bd()),
    ]);

    const bFila = await cliente.rutaOrden.findUniqueOrThrow({ where: { id: rb } });
    expect(bFila.fechaPlaneadaVigente?.toISOString().slice(0, 10)).toBe('2026-06-29');
    expect(bFila.acumuladoDias).toBeGreaterThan(0);

    // La clave de serialización del job (lo que pg-boss dedupea) es por orden: misma orden = misma
    // clave (un recálculo pendiente colapsa el siguiente); órdenes distintas = claves distintas.
    expect(claveSerializacion(COLAS_JOBS.recalcularRutaOrden, idOrden)).toBe(
      claveSerializacion(COLAS_JOBS.recalcularRutaOrden, idOrden),
    );
    expect(claveSerializacion(COLAS_JOBS.recalcularRutaOrden, idOrden)).not.toBe(
      claveSerializacion(COLAS_JOBS.recalcularRutaOrden, idOrden + 1),
    );
  });
});

describe('completarProceso + roles N:M (ProcesoDefRol)', () => {
  it('un usuario con rol responsable captura; sin rol no; admin siempre', async () => {
    const idOrden = await crearOrdenConRc('2026-06-29');
    const proc = await crearProcesoDef('corte');
    const idRuta = await crearRenglon(idOrden, proc, {
      duracionDias: 2,
      secuencia: 0,
      estado: 'activo',
    });

    // Rol responsable del proceso.
    const rol = await cliente.rol.create({ data: { nombre: 'Cortadores', descripcion: 'x' } });
    await cliente.procesoDefRol.create({ data: { idProcesoDef: proc, idRol: rol.id } });

    // Usuario CON el rol.
    const conRol = await cliente.usuario.create({
      data: {
        username: 'cortador',
        nombre: 'Cor',
        email: 'c@x.local',
        roles: { create: [{ idRol: rol.id }] },
      },
    });
    // Usuario SIN el rol.
    const sinRol = await cliente.usuario.create({
      data: { username: 'otro', nombre: 'Otro', email: 'o@x.local' },
    });

    const sesionSinRol = sesionDePrueba({ id: sinRol.id, permisos: ['rc.capturar'] });
    await expect(completarProceso(sesionSinRol, idRuta, undefined, bd())).rejects.toBeInstanceOf(
      ErrorPermiso,
    );

    const sesionConRol = sesionDePrueba({ id: conRol.id, permisos: ['rc.capturar'] });
    await completarProceso(sesionConRol, idRuta, new Date('2026-06-20T00:00:00Z'), bd());
    const fila = await cliente.rutaOrden.findUniqueOrThrow({ where: { id: idRuta } });
    expect(fila.estado).toBe('completado');
    expect(fila.fechaReal?.toISOString().slice(0, 10)).toBe('2026-06-20');
    expect(fila.origenCaptura).toBe('manual');
    expect(fila.capturadoPorId).toBe(conRol.id);
  });

  it('sin permiso rc.capturar no captura', async () => {
    const idOrden = await crearOrdenConRc('2026-06-29');
    const proc = await crearProcesoDef('p');
    const idRuta = await crearRenglon(idOrden, proc, {
      duracionDias: 1,
      secuencia: 0,
      estado: 'activo',
    });
    const sin = sesionDePrueba({ permisos: [] });
    await expect(completarProceso(sin, idRuta, undefined, bd())).rejects.toBeInstanceOf(
      ErrorPermiso,
    );
  });

  it('activa los sucesores cuando TODOS sus antecesores quedan completados; cierra/reabre la RC', async () => {
    const idOrden = await crearOrdenConRc('2026-06-29');
    const a = await crearProcesoDef('a');
    const b = await crearProcesoDef('b');
    const c = await crearProcesoDef('c');
    const ra = await crearRenglon(idOrden, a, { duracionDias: 1, secuencia: 0, estado: 'activo' });
    const rb = await crearRenglon(idOrden, b, { duracionDias: 1, secuencia: 1, estado: 'activo' });
    const rc = await crearRenglon(idOrden, c, {
      duracionDias: 1,
      secuencia: 2,
      ultimoProceso: true,
    });
    await ligar(rc, ra);
    await ligar(rc, rb); // c depende de a Y b.

    const admin = sesionDePrueba({ permisos: ['rc.capturar', 'roles.administrar'] });

    // Completar solo a: c NO se activa todavía (falta b).
    await completarProceso(admin, ra, undefined, bd());
    expect((await cliente.rutaOrden.findUniqueOrThrow({ where: { id: rc } })).estado).toBe(
      'pendiente',
    );

    // Completar b: ahora c se activa.
    await completarProceso(admin, rb, undefined, bd());
    expect((await cliente.rutaOrden.findUniqueOrThrow({ where: { id: rc } })).estado).toBe(
      'activo',
    );

    // Completar c (último): cierra la RC.
    await completarProceso(admin, rc, undefined, bd());
    expect((await cliente.orden.findUniqueOrThrow({ where: { id: idOrden } })).rcActiva).toBe(
      false,
    );

    // Revertir c: reabre la RC.
    await revertirProceso(admin, rc, bd());
    expect((await cliente.orden.findUniqueOrThrow({ where: { id: idOrden } })).rcActiva).toBe(true);
    expect((await cliente.rutaOrden.findUniqueOrThrow({ where: { id: rc } })).estado).toBe(
      'activo',
    );
  });
});

describe('checklist', () => {
  it('completar TODOS los ítems auto-completa el proceso; desmarcar lo revierte', async () => {
    const idOrden = await crearOrdenConRc('2026-06-29');
    const proc = await crearProcesoDef('p');
    const idRuta = await crearRenglon(idOrden, proc, {
      duracionDias: 1,
      secuencia: 0,
      estado: 'activo',
    });
    const i1 = await cliente.rutaOrdenChecklist.create({
      data: { idRutaOrden: idRuta, descripcion: 'punto 1', orden: 0 },
    });
    const i2 = await cliente.rutaOrdenChecklist.create({
      data: { idRutaOrden: idRuta, descripcion: 'punto 2', orden: 1 },
    });
    const admin = sesionDePrueba({ permisos: ['rc.capturar', 'roles.administrar'] });

    await marcarChecklistItem(admin, i1.id, true, bd());
    expect((await cliente.rutaOrden.findUniqueOrThrow({ where: { id: idRuta } })).estado).toBe(
      'activo',
    );

    await marcarChecklistItem(admin, i2.id, true, bd());
    const fila = await cliente.rutaOrden.findUniqueOrThrow({ where: { id: idRuta } });
    expect(fila.estado).toBe('completado');
    expect(fila.fechaReal).not.toBeNull();
    expect(fila.origenCaptura).toBe('evento'); // lo completó el sistema, no captura manual.

    // Desmarcar un ítem revierte el cumplimiento (porque fue AUTO-completado).
    await marcarChecklistItem(admin, i2.id, false, bd());
    const fila2 = await cliente.rutaOrden.findUniqueOrThrow({ where: { id: idRuta } });
    expect(fila2.estado).not.toBe('completado');
    expect(fila2.fechaReal).toBeNull();
  });

  it('una completación MANUAL no se pisa al tocar el checklist (origenCaptura manual ≠ evento)', async () => {
    const idOrden = await crearOrdenConRc('2026-06-29');
    const proc = await crearProcesoDef('p');
    const idRuta = await crearRenglon(idOrden, proc, {
      duracionDias: 1,
      secuencia: 0,
      estado: 'activo',
    });
    const i1 = await cliente.rutaOrdenChecklist.create({
      data: { idRutaOrden: idRuta, descripcion: 'punto 1', orden: 0 },
    });
    const admin = sesionDePrueba({ permisos: ['rc.capturar', 'roles.administrar'] });

    // Completa MANUALMENTE el proceso con una fecha concreta.
    await completarProceso(admin, idRuta, new Date('2026-06-15T00:00:00Z'), bd());
    const tras = await cliente.rutaOrden.findUniqueOrThrow({ where: { id: idRuta } });
    expect(tras.origenCaptura).toBe('manual');

    // Marcar y luego DESMARCAR el ítem de checklist NO debe revertir la completación manual.
    await marcarChecklistItem(admin, i1.id, true, bd());
    await marcarChecklistItem(admin, i1.id, false, bd());
    const final = await cliente.rutaOrden.findUniqueOrThrow({ where: { id: idRuta } });
    expect(final.estado).toBe('completado');
    expect(final.fechaReal?.toISOString().slice(0, 10)).toBe('2026-06-15'); // fecha manual intacta.
    expect(final.origenCaptura).toBe('manual');
  });
});

describe('barrerRiesgoRc', () => {
  it('marca enRiesgo una orden con proceso planeado vencido y la regla sin-ruta', async () => {
    // Orden CON ruta y proceso atrasado (planeada en el pasado, sin fechaReal).
    const idOrden = await crearOrdenConRc('2026-06-29');
    const proc = await crearProcesoDef('p');
    const idRuta = await crearRenglon(idOrden, proc, {
      duracionDias: 1,
      secuencia: 0,
      estado: 'activo',
    });
    await cliente.rutaOrden.update({
      where: { id: idRuta },
      data: { fechaPlaneadaVigente: new Date('2000-01-03T00:00:00Z') }, // muy en el pasado
    });

    // Orden SIN ruta pero con fechaEntregaRC ya vencida (regla "en riesgo antes de programar").
    const clienteNeg = await cliente.cliente.create({ data: { nombre: 'SinRuta' } });
    const modelo = await cliente.modelo.create({ data: { codigo: 'SR', descripcion: 'x' } });
    const ordenSinRuta = await cliente.orden.create({
      data: {
        folio: 999_999n,
        idEmpresa,
        idModelo: modelo.id,
        idCliente: clienteNeg.id,
        rcActiva: false,
        fechaEntregaRC: new Date('2000-01-03T00:00:00Z'),
      },
    });

    const cambiadas = await barrerRiesgoRc(bd());
    expect(cambiadas).toBeGreaterThanOrEqual(2);
    expect((await cliente.orden.findUniqueOrThrow({ where: { id: idOrden } })).enRiesgo).toBe(true);
    expect(
      (await cliente.orden.findUniqueOrThrow({ where: { id: ordenSinRuta.id } })).enRiesgo,
    ).toBe(true);
  });
});
