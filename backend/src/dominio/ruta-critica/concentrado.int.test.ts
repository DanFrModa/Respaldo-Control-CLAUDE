/**
 * Tests de INTEGRACIÓN del CONCENTRADO "planeado vs real" de la RC (F5-E7). Postgres efímero
 * (testcontainers). Cubre:
 *  • solo órdenes con RC viva (`rcActiva`) de la empresa activa (A9).
 *  • el semáforo de la orden = el PEOR de sus procesos; `maxDiasAtraso` y `procesosPendientes`.
 *  • el semáforo/atraso por proceso cuadra con el agregado.
 *  • filtros: cliente (texto), proceso (la orden que LO TIENE), responsable (rol).
 *  • orden: por retraso (atrasadas primero), por cliente, por fecha de entrega.
 *  • resumen por semáforo sobre TODO el filtro (no solo la página).
 *  • VOLUMEN: cientos de órdenes × ~26 procesos → responde paginado y rápido.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PrismaClient } from '../../datos/index.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import { consultarConcentrado } from './concentrado.js';

let cliente: PrismaClient;
let idEmpresa: number;

const bd = () => ({ cliente });
const hoy = new Date('2026-06-22T00:00:00Z');

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

/** Crea una orden con RC viva (cliente + modelo); devuelve { idOrden }. */
async function crearOrdenConRc(opciones?: {
  nombreCliente?: string;
  rcActiva?: boolean;
  fechaEntregaRC?: string;
  idEmpresa?: number;
}): Promise<number> {
  const clienteNeg = await cliente.cliente.create({
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
  return orden.id;
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
  },
): Promise<number> {
  const r = await cliente.rutaOrden.create({
    data: {
      idOrden,
      idProcesoDef,
      secuencia: opciones.secuencia,
      duracionDias: 1,
      estado: opciones.estado ?? 'pendiente',
      ...(opciones.fechaPlaneadaVigente === undefined || opciones.fechaPlaneadaVigente === null
        ? {}
        : { fechaPlaneadaVigente: new Date(`${opciones.fechaPlaneadaVigente}T00:00:00Z`) }),
      ...(opciones.fechaReal === undefined || opciones.fechaReal === null
        ? {}
        : { fechaReal: new Date(`${opciones.fechaReal}T00:00:00Z`) }),
    },
  });
  return r.id;
}

const admin = () =>
  sesionDePrueba({ idEmpresaActiva: idEmpresa, permisos: ['rc.ruta-ver', 'roles.administrar'] });

describe('consultarConcentrado — semáforo y agregados por orden', () => {
  it('solo órdenes con RC viva y de la empresa activa (A9)', async () => {
    const conRc = await crearOrdenConRc({ nombreCliente: 'Con RC' });
    await crearRenglon(conRc, await crearProcesoDef('p1'), { secuencia: 0, estado: 'activo' });
    // Sin RC viva → no aparece.
    await crearOrdenConRc({ nombreCliente: 'Sin RC', rcActiva: false });
    // De otra empresa → no aparece.
    const otra = await crearEmpresaPrueba(cliente, 'Otra SA');
    const ordenOtra = await crearOrdenConRc({ nombreCliente: 'De otra', idEmpresa: otra.id });
    await crearRenglon(ordenOtra, await crearProcesoDef('p2'), { secuencia: 0, estado: 'activo' });

    const pagina = await consultarConcentrado(admin(), {}, bd(), hoy);
    expect(pagina.datos.map((f) => f.idOrden)).toEqual([conRc]);
    expect(pagina.total).toBe(1);
  });

  it('el semáforo de la orden es el PEOR de sus procesos; máximo atraso y pendientes', async () => {
    const idOrden = await crearOrdenConRc({ fechaEntregaRC: '2026-06-29' });
    const a = await crearProcesoDef('a');
    const b = await crearProcesoDef('b');
    const c = await crearProcesoDef('c');
    // a: completado (no cuenta). b: a tiempo (lejos). c: atrasado 5 días.
    await crearRenglon(idOrden, a, { secuencia: 0, estado: 'completado', fechaReal: '2026-06-10' });
    await crearRenglon(idOrden, b, {
      secuencia: 1,
      estado: 'activo',
      fechaPlaneadaVigente: '2026-07-15',
    });
    await crearRenglon(idOrden, c, {
      secuencia: 2,
      estado: 'activo',
      fechaPlaneadaVigente: '2026-06-17',
    });

    const pagina = await consultarConcentrado(admin(), {}, bd(), hoy);
    const fila = pagina.datos[0];
    expect(fila?.semaforo).toBe('atrasado');
    expect(fila?.maxDiasAtraso).toBe(5);
    expect(fila?.procesosPendientes).toBe(2); // b y c (a está completado)
    // El detalle por proceso cuadra con el agregado.
    expect(fila?.procesos).toHaveLength(3);
    const cellC = fila?.procesos.find((p) => p.codigoProceso === 'c');
    expect(cellC?.semaforo).toBe('atrasado');
    expect(cellC?.diasAtraso).toBe(5);
    const cellA = fila?.procesos.find((p) => p.codigoProceso === 'a');
    expect(cellA?.semaforo).toBe('aTiempo'); // completado
  });

  it('resumen por semáforo sobre TODO el filtro (no solo la página)', async () => {
    // Orden atrasada.
    const o1 = await crearOrdenConRc();
    await crearRenglon(o1, await crearProcesoDef('x1'), {
      secuencia: 0,
      estado: 'activo',
      fechaPlaneadaVigente: '2026-06-10',
    });
    // Orden en riesgo (dentro de 3 días).
    const o2 = await crearOrdenConRc();
    await crearRenglon(o2, await crearProcesoDef('x2'), {
      secuencia: 0,
      estado: 'activo',
      fechaPlaneadaVigente: '2026-06-24',
    });
    // Orden a tiempo.
    const o3 = await crearOrdenConRc();
    await crearRenglon(o3, await crearProcesoDef('x3'), {
      secuencia: 0,
      estado: 'activo',
      fechaPlaneadaVigente: '2026-07-20',
    });

    const pagina = await consultarConcentrado(admin(), { porPagina: 1 }, bd(), hoy);
    expect(pagina.datos).toHaveLength(1); // página de 1
    expect(pagina.total).toBe(3);
    expect(pagina.resumen).toEqual({ atrasadas: 1, enRiesgo: 1, aTiempo: 1 });
  });
});

describe('consultarConcentrado — filtros y orden', () => {
  it('filtra por cliente (texto), proceso (la orden que lo tiene) y responsable (rol)', async () => {
    const oAurora = await crearOrdenConRc({ nombreCliente: 'Boutique Aurora' });
    const oZeta = await crearOrdenConRc({ nombreCliente: 'Tienda Zeta' });
    const corte = await crearProcesoDef('corte');
    const estampado = await crearProcesoDef('estampado');
    await crearRenglon(oAurora, corte, { secuencia: 0, estado: 'activo' });
    await crearRenglon(oZeta, estampado, { secuencia: 0, estado: 'activo' });

    // Cliente.
    const porCliente = await consultarConcentrado(
      admin(),
      { busquedaCliente: 'aurora' },
      bd(),
      hoy,
    );
    expect(porCliente.datos.map((f) => f.idOrden)).toEqual([oAurora]);

    // Proceso (la orden que tiene "estampado").
    const porProceso = await consultarConcentrado(admin(), { idProcesoDef: estampado }, bd(), hoy);
    expect(porProceso.datos.map((f) => f.idOrden)).toEqual([oZeta]);

    // Responsable (rol del proceso "corte").
    const rol = await cliente.rol.create({ data: { nombre: 'Cortadores', descripcion: 'x' } });
    await cliente.procesoDefRol.create({ data: { idProcesoDef: corte, idRol: rol.id } });
    const porRol = await consultarConcentrado(admin(), { idRolResponsable: rol.id }, bd(), hoy);
    expect(porRol.datos.map((f) => f.idOrden)).toEqual([oAurora]);
  });

  it('ordena por retraso (atrasadas primero), por cliente y por fecha de entrega', async () => {
    const oAtrasada = await crearOrdenConRc({
      nombreCliente: 'Zeta',
      fechaEntregaRC: '2026-07-01',
    });
    await crearRenglon(oAtrasada, await crearProcesoDef('p-atr'), {
      secuencia: 0,
      estado: 'activo',
      fechaPlaneadaVigente: '2026-06-10',
    });
    const oAtiempo = await crearOrdenConRc({
      nombreCliente: 'Alfa',
      fechaEntregaRC: '2026-06-25',
    });
    await crearRenglon(oAtiempo, await crearProcesoDef('p-ok'), {
      secuencia: 0,
      estado: 'activo',
      fechaPlaneadaVigente: '2026-07-20',
    });

    // Retraso: la atrasada primero.
    const porRetraso = await consultarConcentrado(admin(), { orden: 'retraso' }, bd(), hoy);
    expect(porRetraso.datos[0]?.idOrden).toBe(oAtrasada);

    // Cliente: Alfa antes que Zeta.
    const porCliente = await consultarConcentrado(admin(), { orden: 'cliente' }, bd(), hoy);
    expect(porCliente.datos.map((f) => f.cliente)).toEqual(['Alfa', 'Zeta']);

    // Fecha de entrega ascendente: 2026-06-25 antes que 2026-07-01.
    const porFecha = await consultarConcentrado(admin(), { orden: 'fecha' }, bd(), hoy);
    expect(porFecha.datos.map((f) => f.idOrden)).toEqual([oAtiempo, oAtrasada]);
  });
});

describe('consultarConcentrado — volumen', () => {
  it('cientos de órdenes × ~26 procesos: responde paginado y rápido', async () => {
    const N_ORDENES = 200;
    const N_PROCESOS = 26;

    // Catálogo de procesos compartido (26 procesos).
    const idsProceso: number[] = [];
    for (let p = 0; p < N_PROCESOS; p++) {
      idsProceso.push(await crearProcesoDef(`vol-${p}`));
    }

    // Crea las órdenes y sus renglones EN LOTE (createMany) para no tardar siglos sembrando 1×1.
    const clientes = await cliente.cliente.createManyAndReturn({
      data: Array.from({ length: N_ORDENES }, (_, i) => ({ nombre: `Cli Vol ${i}` })),
    });
    const modelos = await cliente.modelo.createManyAndReturn({
      data: Array.from({ length: N_ORDENES }, (_, i) => ({ codigo: `MV-${i}`, descripcion: 'v' })),
    });
    const ordenes = await cliente.orden.createManyAndReturn({
      data: Array.from({ length: N_ORDENES }, (_, i) => ({
        folio: BigInt(10_000 + i),
        idEmpresa,
        idModelo: modelos[i]!.id,
        idCliente: clientes[i]!.id,
        rcActiva: true,
        fechaEntregaRC: new Date('2026-07-05T00:00:00Z'),
      })),
    });

    const renglones: {
      idOrden: number;
      idProcesoDef: number;
      secuencia: number;
      duracionDias: number;
      estado: 'activo' | 'completado';
      fechaPlaneadaVigente: Date;
    }[] = [];
    for (let o = 0; o < N_ORDENES; o++) {
      for (let p = 0; p < N_PROCESOS; p++) {
        // Mitad vencidos (atrasados), mitad futuros; algunos completados.
        const vencido = p % 2 === 0;
        renglones.push({
          idOrden: ordenes[o]!.id,
          idProcesoDef: idsProceso[p]!,
          secuencia: p,
          duracionDias: 1,
          estado: p % 5 === 0 ? 'completado' : 'activo',
          fechaPlaneadaVigente: new Date(vencido ? '2026-06-15T00:00:00Z' : '2026-07-15T00:00:00Z'),
        });
      }
    }
    await cliente.rutaOrden.createMany({ data: renglones });

    const t0 = Date.now();
    const pagina = await consultarConcentrado(admin(), { porPagina: 50 }, bd(), hoy);
    const ms = Date.now() - t0;

    expect(pagina.total).toBe(N_ORDENES);
    expect(pagina.datos).toHaveLength(50); // solo la página, no las 200×26 celdas
    expect(pagina.datos[0]?.procesos.length).toBe(N_PROCESOS);
    // Cota generosa para CI: la consulta NO debe traer las 5,200 celdas de las 200 órdenes a memoria.
    expect(ms).toBeLessThan(4000);
  });
});

describe('consultarConcentrado — permisos', () => {
  it('exige rc.ruta-ver', async () => {
    const sinPermiso = sesionDePrueba({ idEmpresaActiva: idEmpresa, permisos: [] });
    await expect(consultarConcentrado(sinPermiso, {}, bd(), hoy)).rejects.toThrow();
  });
});
