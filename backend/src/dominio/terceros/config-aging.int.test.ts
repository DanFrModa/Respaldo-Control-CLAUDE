/**
 * Tests de integración de los LÍMITES DE AGING CONFIGURABLES por empresa (F9-E5/D15d). Postgres
 * efímero. La MECÁNICA del aging es pura (probada aparte); aquí se prueba que la FUENTE de los límites
 * es la configuración de la empresa (no ya la constante 30/60):
 *  (a) sin configuración → default 30/60, y la bandeja expone `limitesAging = {30,60}`;
 *  (b) con límites custom (15/45) → el MISMO cargo cae en OTRA cubeta, y la bandeja expone {15,45};
 *  (c) el dominio de configuración rechaza `limite1 >= limite2` (ErrorValidacion).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Cliente, Empresa, PrismaClient } from '../../datos/index.js';
import { ErrorValidacion } from '../../comun/errores.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import type { ClavePermiso } from '../../contrato/index.js';

import { actualizarConfiguracion } from '../admin/empresas.js';
import { registrarMovimientoTercero } from './cuenta-terceros.js';
import { bandejaPorCobrar } from './cxc/cxc.js';

let cliente: PrismaClient;
let empresa: Empresa;
let clienteFr: Cliente;

const PERM: ClavePermiso[] = [
  'cxc.ver',
  'terceros.ver',
  'terceros.administrar',
  'empresas.administrar',
  'consultas.ver-importes',
];

const sesion = () => sesionDePrueba({ idEmpresaActiva: empresa.id, permisos: PERM });
const bd = () => ({ cliente });

/** `YYYY-MM-DD` de hace `dias` días (UTC). */
function hace(dias: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - dias);
  return d.toISOString().slice(0, 10);
}

/** Cargo de un cliente de CONTADO (0 días de crédito) fechado hace `dias` → atraso = `dias`. */
async function cargo(dias: number, importe: number): Promise<void> {
  await registrarMovimientoTercero(
    sesion(),
    {
      tipoTercero: 'cliente',
      idTercero: clienteFr.id,
      fecha: hace(dias),
      origen: 'entrada_sin_factura',
      importe,
    },
    bd(),
  );
}

/** La cubeta de aging del cliente en la bandeja. */
async function cubetas(): Promise<{
  corriente: number | null;
  d1a30: number | null;
  d31a60: number | null;
  mas60: number | null;
  limite1: number;
  limite2: number;
}> {
  const bandeja = await bandejaPorCobrar(sesion(), {}, bd());
  const fila = bandeja.filas.find((f) => f.idCliente === clienteFr.id);
  return {
    corriente: fila?.corriente ?? null,
    d1a30: fila?.d1a30 ?? null,
    d31a60: fila?.d31a60 ?? null,
    mas60: fila?.mas60 ?? null,
    limite1: bandeja.limitesAging.limite1,
    limite2: bandeja.limitesAging.limite2,
  };
}

beforeAll(() => {
  cliente = clientePruebas();
});

afterAll(async () => {
  await cliente.$disconnect();
});

beforeEach(async () => {
  await limpiarBaseDatos(cliente);
  empresa = await crearEmpresaPrueba(cliente, 'Empresa Aging');
  clienteFr = await cliente.cliente.create({ data: { nombre: 'Cliente contado', diasCredito: 0 } });
});

describe('límites de aging configurables (D15d)', () => {
  it('(a) sin configuración: default 30/60 → atraso 20 cae en 1–30', async () => {
    await cargo(20, 500);
    const c = await cubetas();
    expect(c.limite1).toBe(30);
    expect(c.limite2).toBe(60);
    expect(c.d1a30).toBe(500);
    expect(c.d31a60).toBe(0);
  });

  it('(b) con límites custom 15/45: el MISMO atraso 20 cae en la 2ª cubeta', async () => {
    await actualizarConfiguracion(
      sesion(),
      empresa.id,
      { agingLimite1: 15, agingLimite2: 45 },
      bd(),
    );
    await cargo(20, 500);
    const c = await cubetas();
    expect(c.limite1).toBe(15);
    expect(c.limite2).toBe(45);
    // 20 > 15 y ≤ 45 → segunda cubeta vencida (d31a60), NO la primera.
    expect(c.d1a30).toBe(0);
    expect(c.d31a60).toBe(500);
  });

  it('(c) rechaza límites incoherentes (limite1 >= limite2)', async () => {
    await expect(
      actualizarConfiguracion(sesion(), empresa.id, { agingLimite1: 60, agingLimite2: 30 }, bd()),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });
});
