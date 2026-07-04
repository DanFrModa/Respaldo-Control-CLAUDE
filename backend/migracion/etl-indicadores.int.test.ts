/**
 * Integración del ETL de INDICADORES (F7-E6) — corre en CI (testcontainers), NO en local.
 *
 * Fixtures committeados en `migracion/__fixtures__/tablas-f7-indicadores/` (apuntados por `TABLAS_DIR`).
 * Siembra: permisos, empresa favorita, clientes (uno por nombre para muestrarios + uno mapeado para
 * productividad de almacén), temporada, modelos (por código, para el cíclico), una orden con mapeo
 * (para las fichas) y los 8 reactivos del checklist.
 *
 * Verifica todas las piezas + IDEMPOTENCIA: catálogos, productividad IP/almacén (con baja suave de
 * inactivos DESPUÉS de su productividad), fichas (revisor preservado, 8 reactivos despivotados),
 * muestrarios (cliente por nombre, ciclo de vida) y el cíclico histórico (D6: cerrado, cantTeorica =
 * CantProscai, SIN movimiento de kardex).
 */
import { fileURLToPath } from 'node:url';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import type { PrismaClient } from '../src/datos/index.js';
import {
  consultarExactitud,
  listarInventariosCiclicos,
} from '../src/dominio/indicadores/inventario-ciclico.js';
import { clientePruebas, limpiarBaseDatos, sembrarPermisos } from '../src/pruebas/contexto.js';

import { ejecutarEtlIndicadores } from './etl-indicadores.js';
import { ENTIDAD_MAPEO, guardarMapeo } from './comun/mapeo.js';
import { sesionEtl } from './comun/sesion-etl.js';

let cliente: PrismaClient;
const DIR_FIXTURES = fileURLToPath(
  new URL('./__fixtures__/tablas-f7-indicadores', import.meta.url),
);
let tablasDirPrevio: string | undefined;

let idEmpresa: number;
let idOrden700: number;

const REACTIVOS = [
  'InfGeneral',
  'InfTela',
  'InfHab',
  'Medidas',
  'Dibujo',
  'InfEtiqueta',
  'EspCostura',
  'MedidasPrendas',
];

beforeEach(async () => {
  cliente = clientePruebas();
  tablasDirPrevio = process.env.TABLAS_DIR;
  process.env.TABLAS_DIR = DIR_FIXTURES;
  await limpiarBaseDatos(cliente);
  await sembrarEstado();
});

afterAll(async () => {
  if (tablasDirPrevio === undefined) delete process.env.TABLAS_DIR;
  else process.env.TABLAS_DIR = tablasDirPrevio;
  await cliente.$disconnect();
});

async function sembrarEstado(): Promise<void> {
  await sembrarPermisos(cliente);
  const empresa = await cliente.empresa.create({
    data: { nombre: 'FR Moda', favorita: true, paraIpt: true, paraEdr: true },
  });
  idEmpresa = empresa.id;

  await cliente.cliente.create({ data: { nombre: 'Cliente Uno' } }); // muestrarios por nombre
  const cliAlm = await cliente.cliente.create({ data: { nombre: 'Cliente Almacen' } });
  await guardarMapeo(cliente, ENTIDAD_MAPEO.cliente, 16, cliAlm.id); // productividad almacén

  await cliente.temporada.create({ data: { nombre: 'Primavera Verano' } });
  await cliente.modelo.create({ data: { codigo: 'M100' } });
  await cliente.modelo.create({ data: { codigo: 'M200' } });

  const cli = await cliente.cliente.create({ data: { nombre: 'Cliente Orden' } });
  const modelo = await cliente.modelo.create({ data: { codigo: 'MORD' } });
  const orden = await cliente.orden.create({
    data: {
      folio: 700n,
      idEmpresa,
      idModelo: modelo.id,
      idCliente: cli.id,
      estado: 'completa',
      fechaCompletada: new Date(),
    },
  });
  idOrden700 = orden.id;
  await guardarMapeo(cliente, ENTIDAD_MAPEO.orden, 700, idOrden700);

  await cliente.checklistFichaDef.createMany({
    data: REACTIVOS.map((clave, i) => ({ clave, etiqueta: clave, orden: i + 1 })),
  });
}

describe('ETL de indicadores F7-E6 (integración, fixtures committeados)', () => {
  it('carga TODO con conteos EXACTOS y es IDEMPOTENTE', async () => {
    await ejecutarEtlIndicadores(cliente);
    const t1 = await conteos();
    expect(t1).toEqual({
      personalIp: 2,
      actIp: 2,
      actAlm: 2,
      prodIp: 2, // 100, 101 (102 actividad sin mapeo, 103 horas=0)
      prodAlm: 2, // 10, 11 (12 actividad sin mapeo)
      fichas: 8, // 8 reactivos de la orden 700 (la 999 sin mapeo se omite)
      muestrarios: 2, // 1 y 3 ("NoExiste" sin match se omite)
      ciclicos: 3, // 1, 2, 4 ("NOPE" sin match de código se omite)
      movimientos: 0, // el cíclico histórico NO genera kardex (D6)
    });

    await ejecutarEtlIndicadores(cliente);
    expect(await conteos()).toEqual(t1);
  }, 180_000);

  it('PERSONAL: la baja suave de inactivos se aplica DESPUÉS de su productividad', async () => {
    await ejecutarEtlIndicadores(cliente);
    const beto = await cliente.personalArea.findFirstOrThrow({ where: { nombre: 'Beto' } });
    expect(beto.activo).toBe(false); // el viejo lo tenía inactivo
    // Pero su registro de productividad (fila 101) SÍ se cargó (persona activa al momento).
    expect(await cliente.registroProductividad.count({ where: { idPersona: beto.id } })).toBe(1);
    const ana = await cliente.personalArea.findFirstOrThrow({ where: { nombre: 'Ana' } });
    expect(ana.activo).toBe(true);
  });

  it('FICHAS: 8 reactivos despivotados, revisor viejo PRESERVADO, hechos correctos', async () => {
    await ejecutarEtlIndicadores(cliente);
    const fichas = await cliente.fichaVerificacion.findMany({
      where: { idOrden: idOrden700 },
      include: { reactivo: true },
    });
    expect(fichas).toHaveLength(8);
    expect(fichas.every((f) => f.revisorId === '25')).toBe(true); // IdUsuarios preservado
    const hechos = fichas.filter((f) => f.hecho).length;
    expect(hechos).toBe(5); // InfGeneral,InfTela,Dibujo,InfEtiqueta,EspCostura
    const infHab = fichas.find((f) => f.reactivo.clave === 'InfHab');
    expect(infHab?.hecho).toBe(false);
  });

  it('MUESTRARIOS: cliente por nombre, entrega y solicitante preservado', async () => {
    await ejecutarEtlIndicadores(cliente);
    const ms = await cliente.muestrario.findMany({ include: { cliente: true } });
    expect(ms).toHaveLength(2);
    const entregado = ms.find((m) => m.fechaEntregado !== null);
    expect(entregado?.cliente.nombre).toBe('Cliente Uno');
    expect(entregado?.boardsOK).toBe(4);
    expect(entregado?.solicitanteId).toBe('27'); // IdUsuarioSolicitante preservado
    expect(ms.some((m) => m.fechaEntregado === null)).toBe(true); // el pendiente (fila 3)
  });

  it('CÍCLICO histórico (D6): cerrado, cantTeorica = CantProscai, SIN movimiento de kardex', async () => {
    await ejecutarEtlIndicadores(cliente);
    const invs = await cliente.inventarioCiclico.findMany({ include: { detalles: true } });
    expect(invs).toHaveLength(3);
    expect(invs.every((i) => i.estado === 'cerrado')).toBe(true);
    expect(await cliente.movimiento.count()).toBe(0); // NO reconcilia contra el kardex v2

    // El detalle preserva CantProscai como teórico y CantReal (null si vacío).
    const dets = invs.flatMap((i) => i.detalles);
    const t = dets.map((d) => d.cantTeorica).sort((a, b) => a - b);
    expect(t).toEqual([60, 84, 130]);
    const sinConteo = dets.find((d) => d.cantReal === null);
    expect(sinConteo?.cantTeorica).toBe(60); // fila 4 (CantReal vacío)
    // El almacén sentinela existe e INACTIVO.
    const alm = await cliente.almacen.findFirstOrThrow({
      where: { nombre: '(Migración Proscai)' },
    });
    expect(alm.activo).toBe(false);
    expect(alm.tipo).toBe('PT');
  });

  it('BANDEJA viva EXCLUYE los históricos (almacén inactivo) pero siguen CONSULTABLES', async () => {
    await ejecutarEtlIndicadores(cliente);
    const sesion = sesionEtl(idEmpresa);
    // La bandeja viva NO los lista (viven en el almacén sentinela INACTIVO).
    const bandeja = await listarInventariosCiclicos(sesion, {}, { cliente });
    expect(bandeja.total).toBe(0);
    expect(bandeja.datos).toHaveLength(0);
    // Pero existen y siguen consultables por id (exactitud): CantReal − CantProscai, sin ajuste.
    expect(await cliente.inventarioCiclico.count()).toBe(3);
    const uno = await cliente.inventarioCiclico.findFirstOrThrow({ select: { id: true } });
    const ex = await consultarExactitud(sesion, uno.id, { cliente });
    expect(ex.renglones).toHaveLength(1);
    expect(ex.renglones[0]?.idMovimientoAjuste).toBeNull(); // sin ajuste de kardex (D6)
  });
});

/** Conteos para las aserciones e idempotencia. */
async function conteos(): Promise<Record<string, number>> {
  return {
    personalIp: await cliente.personalArea.count({ where: { area: 'ip' } }),
    actIp: await cliente.actividadProductividad.count({ where: { area: 'ip' } }),
    actAlm: await cliente.actividadProductividad.count({ where: { area: 'almacen' } }),
    prodIp: await cliente.registroProductividad.count({ where: { area: 'ip' } }),
    prodAlm: await cliente.registroProductividad.count({ where: { area: 'almacen' } }),
    fichas: await cliente.fichaVerificacion.count(),
    muestrarios: await cliente.muestrario.count(),
    ciclicos: await cliente.inventarioCiclico.count(),
    movimientos: await cliente.movimiento.count(),
  };
}
