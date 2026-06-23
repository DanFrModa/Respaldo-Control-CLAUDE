/**
 * Tests de INTEGRACIÓN del impreso "Plan de la RC por orden" (F5-E5, R9). Postgres efímero
 * (testcontainers). Cubre el camino feliz de `impresoPlanRc` (que toca BD: encabezado de la orden +
 * responsables por proceso) y los caminos de error:
 *  • genera un PDF (Buffer con cabecera %PDF) y resuelve folio/cliente/modelo + responsables (roles).
 *  • 404: una orden de OTRA empresa no se imprime (A9, lo impone el impreso al traer el encabezado).
 *  • 400: una orden SIN ruta generada → `ErrorValidacion` (no truena).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PrismaClient } from '../../../datos/index.js';
import { ErrorNoEncontrado, ErrorValidacion } from '../../../comun/errores.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../../pruebas/contexto.js';
import { sesionDePrueba } from '../../../pruebas/sesiones.js';
import { armarDatosImpresoPlanRc, impresoPlanRc } from './impreso-plan-rc.js';

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

/** Crea una orden (cliente + modelo) en `idEmpresaOrden`. Devuelve { idOrden, folio }. */
async function crearOrden(opciones?: {
  idEmpresaOrden?: number;
  rcActiva?: boolean;
  nombreCliente?: string;
  codigoModelo?: string;
  fechaEntregaRC?: string;
}): Promise<{ idOrden: number; folio: number }> {
  const clienteNeg = await cliente.cliente.create({
    data: { nombre: opciones?.nombreCliente ?? `Cli ${String(Math.random())}` },
  });
  const modelo = await cliente.modelo.create({
    data: { codigo: opciones?.codigoModelo ?? `M-${String(Math.random())}`, descripcion: 'Blusa' },
  });
  const folio = Math.floor(Math.random() * 1_000_000);
  const orden = await cliente.orden.create({
    data: {
      folio: BigInt(folio),
      idEmpresa: opciones?.idEmpresaOrden ?? idEmpresa,
      idModelo: modelo.id,
      idCliente: clienteNeg.id,
      rcActiva: opciones?.rcActiva ?? true,
      ...(opciones?.fechaEntregaRC === undefined
        ? {}
        : { fechaEntregaRC: new Date(`${opciones.fechaEntregaRC}T00:00:00Z`) }),
    },
  });
  return { idOrden: orden.id, folio };
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
    duracionDias?: number;
    fechaPlaneadaVigente?: string;
    estado?: 'pendiente' | 'activo' | 'completado';
    fechaReal?: string;
  },
): Promise<number> {
  const r = await cliente.rutaOrden.create({
    data: {
      idOrden,
      idProcesoDef,
      secuencia: opciones.secuencia,
      duracionDias: opciones.duracionDias ?? 1,
      estado: opciones.estado ?? 'pendiente',
      ...(opciones.fechaPlaneadaVigente === undefined
        ? {}
        : { fechaPlaneadaVigente: new Date(`${opciones.fechaPlaneadaVigente}T00:00:00Z`) }),
      ...(opciones.fechaReal === undefined
        ? {}
        : { fechaReal: new Date(`${opciones.fechaReal}T00:00:00Z`) }),
    },
  });
  return r.id;
}

/** Asocia uno o más roles (por nombre) como responsables de un proceso. Devuelve sus ids. */
async function asignarRoles(idProcesoDef: number, nombres: string[]): Promise<void> {
  for (const nombre of nombres) {
    const rol = await cliente.rol.create({ data: { nombre, descripcion: 'x' } });
    await cliente.procesoDefRol.create({ data: { idProcesoDef, idRol: rol.id } });
  }
}

function esPdf(buffer: Buffer): boolean {
  return buffer.length > 0 && buffer.subarray(0, 5).toString('latin1') === '%PDF-';
}

describe('impresoPlanRc — camino feliz', () => {
  it('genera un PDF y resuelve encabezado + responsables (roles) por proceso', async () => {
    const { idOrden, folio } = await crearOrden({
      nombreCliente: 'Boutique Aurora',
      codigoModelo: 'MOD-7',
      fechaEntregaRC: '2026-07-10',
    });
    const corte = await crearProcesoDef('corte');
    const costura = await crearProcesoDef('costura');
    await crearRenglon(idOrden, corte, {
      secuencia: 0,
      duracionDias: 2,
      fechaPlaneadaVigente: '2026-06-26',
      estado: 'completado',
      fechaReal: '2026-06-26',
    });
    await crearRenglon(idOrden, costura, {
      secuencia: 1,
      duracionDias: 5,
      fechaPlaneadaVigente: '2026-07-02',
      estado: 'activo',
    });
    await asignarRoles(corte, ['Cortadores', 'Supervisión']);
    await asignarRoles(costura, ['Maquila']);

    const sesion = sesionDePrueba({ idEmpresaActiva: idEmpresa, permisos: ['rc.ruta-ver'] });

    // Datos resueltos (encabezado + responsables).
    const datos = await armarDatosImpresoPlanRc(sesion, idOrden, bd());
    expect(datos.folioOrden).toBe(folio);
    expect(datos.cliente).toBe('Boutique Aurora');
    expect(datos.modelo).toBe('MOD-7 — Blusa');
    expect(datos.fechaEntregaRC).toBe('2026-07-10');
    expect(datos.procesos).toHaveLength(2);
    expect(datos.procesos[0]?.nombreProceso).toBe('CORTE');
    expect(datos.procesos[0]?.responsables).toEqual(['Cortadores', 'Supervisión']);
    expect(datos.procesos[0]?.estado).toBe('completado');
    expect(datos.procesos[0]?.fechaReal).toBe('2026-06-26');
    expect(datos.procesos[1]?.responsables).toEqual(['Maquila']);

    // PDF binario.
    const { buffer, folioOrden } = await impresoPlanRc(sesion, idOrden, bd());
    expect(esPdf(buffer)).toBe(true);
    expect(folioOrden).toBe(folio);
  });
});

describe('impresoPlanRc — errores', () => {
  it('404: una orden de OTRA empresa no se imprime (A9)', async () => {
    const otra = await crearEmpresaPrueba(cliente, 'Otra SA');
    const { idOrden } = await crearOrden({ idEmpresaOrden: otra.id });
    const corte = await crearProcesoDef('corte');
    await crearRenglon(idOrden, corte, { secuencia: 0 });

    // La sesión es de la empresa por defecto, no de `otra`.
    const sesion = sesionDePrueba({ idEmpresaActiva: idEmpresa, permisos: ['rc.ruta-ver'] });
    await expect(impresoPlanRc(sesion, idOrden, bd())).rejects.toBeInstanceOf(ErrorNoEncontrado);
  });

  it('400: una orden SIN ruta generada lanza ErrorValidacion', async () => {
    const { idOrden } = await crearOrden({ rcActiva: false }); // sin renglones de ruta.
    const sesion = sesionDePrueba({ idEmpresaActiva: idEmpresa, permisos: ['rc.ruta-ver'] });
    await expect(impresoPlanRc(sesion, idOrden, bd())).rejects.toBeInstanceOf(ErrorValidacion);
  });
});
