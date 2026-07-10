/**
 * Tests de integración de ServicioReportesFiscales (F9-E5). Postgres efímero (testcontainers). Cubre:
 *  (a) la VISTA FISCAL = SOLO movimientos `esFiscal=true` (ni uno no-fiscal) y los totales cuadran
 *      contra el libro a mano (cargos − abonos = neto);
 *  (b) los FILTROS: tercero (tipo + id), tipo (cargos/abonos), con/sin CFDI (uuid), periodo;
 *  (c) la CONCILIACIÓN: fiscal con UUID vs. sin UUID (pendiente); con XML (idArchivoCfdi) vs. sin;
 *  (d) el TABLERO de salud fiscal (% conciliado, pendientes, saldos por tercero server-side);
 *  (e) A9: los movimientos de otra empresa no se cuelan;
 *  (f) A4: sin `terceros.fiscal` NO hay reporte ni tablero (deny-by-default);
 *  (g) los importes se ocultan (null) sin `consultas.ver-importes`, pero los conteos siguen.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Cliente, Empresa, PrismaClient, Proveedor } from '../../../datos/index.js';
import { ErrorPermiso } from '../../../comun/errores.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../../pruebas/contexto.js';
import { sesionDePrueba } from '../../../pruebas/sesiones.js';
import type { ClavePermiso } from '../../../contrato/index.js';

import { registrarMovimientoTercero } from '../cuenta-terceros.js';
import { reporteFiscal, saludFiscal } from './reportes-fiscales.js';

let cliente: PrismaClient;
let empresa: Empresa;
let otraEmpresa: Empresa;
let proveedor: Proveedor;
let clienteFr: Cliente;

const PERM_TODOS: ClavePermiso[] = [
  'terceros.ver',
  'terceros.administrar',
  'terceros.fiscal',
  'consultas.ver-importes',
];

const sesion = (permisos: ClavePermiso[] = PERM_TODOS, idEmpresaActiva = empresa.id) =>
  sesionDePrueba({ idEmpresaActiva, permisos });
const bd = () => ({ cliente });

/** `YYYY-MM-DD` de hace `dias` días (UTC). */
function hace(dias: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - dias);
  return d.toISOString().slice(0, 10);
}

/** Alta directa por el motor (permite fijar esFiscal/uuid/idArchivoCfdi/tipoTercero). */
async function alta(
  args: Parameters<typeof registrarMovimientoTercero>[1],
  s = sesion(),
): Promise<void> {
  await registrarMovimientoTercero(s, args, bd());
}

beforeAll(() => {
  cliente = clientePruebas();
});

afterAll(async () => {
  await cliente.$disconnect();
});

beforeEach(async () => {
  await limpiarBaseDatos(cliente);
  empresa = await crearEmpresaPrueba(cliente, 'Empresa Fiscal');
  otraEmpresa = await crearEmpresaPrueba(cliente, 'Otra Empresa Fiscal');
  proveedor = await cliente.proveedor.create({
    data: { nombre: 'Telas del Norte', diasCredito: 30, rfc: 'TNO900101AAA' },
  });
  clienteFr = await cliente.cliente.create({
    data: { nombre: 'Boutique Aurora', diasCredito: 15, rfc: 'BAU850505BBB' },
  });
});

// ── (a) vista fiscal = solo fiscales + totales cuadran ───────────────────────────────────────────
describe('reporte fiscal = solo movimientos fiscales', () => {
  it('trae solo los fiscales y sus totales cuadran contra el libro', async () => {
    // Fiscal: factura de proveedor 1000 (con UUID + XML).
    await alta({
      tipoTercero: 'proveedor',
      idTercero: proveedor.id,
      fecha: hace(3),
      origen: 'factura_proveedor',
      importe: 1000,
      esFiscal: true,
      uuidCfdi: 'UUID-CARGO-1',
      rfcTercero: 'TNO900101AAA',
      idArchivoCfdi: 'r2/cfdi-1.xml',
    });
    // Fiscal: nota de crédito 300 (abono, con UUID).
    await alta({
      tipoTercero: 'proveedor',
      idTercero: proveedor.id,
      fecha: hace(2),
      origen: 'nota_credito',
      importe: 300,
      esFiscal: true,
      uuidCfdi: 'UUID-NC-1',
    });
    // NO fiscal: entrada sin factura 5000 (informal) → NO debe aparecer.
    await alta({
      tipoTercero: 'proveedor',
      idTercero: proveedor.id,
      fecha: hace(1),
      origen: 'entrada_sin_factura',
      importe: 5000,
      esFiscal: false,
    });

    const rep = await reporteFiscal(sesion(), {}, bd());
    expect(rep.total).toBe(2);
    expect(rep.filas.every((f) => f.uuidCfdi !== null || f.monto !== null)).toBe(true);
    // Ni un renglón por 5000 (el no fiscal).
    expect(rep.filas.some((f) => f.monto === 5000)).toBe(false);
    expect(rep.totales.cargos).toBe(1000);
    expect(rep.totales.abonos).toBe(300);
    expect(rep.totales.neto).toBe(700);
    expect(rep.totales.movimientos).toBe(2);
  });
});

// ── (b) filtros ──────────────────────────────────────────────────────────────────────────────────
describe('filtros del reporte', () => {
  beforeEach(async () => {
    await alta({
      tipoTercero: 'proveedor',
      idTercero: proveedor.id,
      fecha: hace(10),
      origen: 'factura_proveedor',
      importe: 800,
      esFiscal: true,
      uuidCfdi: 'U-PROV-CARGO',
    });
    await alta({
      tipoTercero: 'proveedor',
      idTercero: proveedor.id,
      fecha: hace(9),
      origen: 'nota_credito',
      importe: 100,
      esFiscal: true,
      uuidCfdi: 'U-PROV-NC',
    });
    await alta({
      tipoTercero: 'cliente',
      idTercero: clienteFr.id,
      fecha: hace(8),
      origen: 'factura_cliente',
      importe: 400,
      esFiscal: true,
      uuidCfdi: 'U-CLI-CARGO',
    });
  });

  it('filtra por tipo de tercero (proveedor/cliente)', async () => {
    const soloProv = await reporteFiscal(sesion(), { tipoTercero: 'proveedor' }, bd());
    expect(soloProv.total).toBe(2);
    expect(soloProv.filas.every((f) => f.tipoTercero === 'proveedor')).toBe(true);

    const soloCli = await reporteFiscal(sesion(), { tipoTercero: 'cliente' }, bd());
    expect(soloCli.total).toBe(1);
    expect(soloCli.filas[0]?.tercero).toBe('Boutique Aurora');
  });

  it('filtra por tipo de movimiento: solo abonos', async () => {
    const abonos = await reporteFiscal(sesion(), { tipo: 'abonos' }, bd());
    expect(abonos.total).toBe(1);
    expect(abonos.filas[0]?.esCargo).toBe(false);
    // Los totales honran el filtro: cargos 0, abonos 100.
    expect(abonos.totales.cargos).toBe(0);
    expect(abonos.totales.abonos).toBe(100);
  });

  it('filtra a un tercero concreto (tipo + id)', async () => {
    const soloEseCliente = await reporteFiscal(
      sesion(),
      { tipoTercero: 'cliente', idTercero: clienteFr.id },
      bd(),
    );
    expect(soloEseCliente.total).toBe(1);
    expect(soloEseCliente.filas[0]?.idTercero).toBe(clienteFr.id);
  });

  it('filtra por periodo (desde/hasta)', async () => {
    const soloReciente = await reporteFiscal(sesion(), { desde: hace(8), hasta: hace(8) }, bd());
    expect(soloReciente.total).toBe(1);
    expect(soloReciente.filas[0]?.tipoTercero).toBe('cliente');
  });
});

// ── (c) conciliación: con/sin CFDI + con/sin XML ─────────────────────────────────────────────────
describe('conciliación (con/sin CFDI, con/sin XML)', () => {
  beforeEach(async () => {
    // Fiscal conciliado: UUID + XML.
    await alta({
      tipoTercero: 'proveedor',
      idTercero: proveedor.id,
      fecha: hace(5),
      origen: 'factura_proveedor',
      importe: 600,
      esFiscal: true,
      uuidCfdi: 'U-CONCILIADO',
      idArchivoCfdi: 'r2/ok.xml',
    });
    // Fiscal pendiente: marcado fiscal SIN UUID ni XML.
    await alta({
      tipoTercero: 'proveedor',
      idTercero: proveedor.id,
      fecha: hace(4),
      origen: 'factura_proveedor',
      importe: 200,
      esFiscal: true,
    });
  });

  it('el filtro cfdi=sin lista los pendientes de CFDI (uuid null)', async () => {
    const pendientes = await reporteFiscal(sesion(), { cfdi: 'sin' }, bd());
    expect(pendientes.total).toBe(1);
    expect(pendientes.filas[0]?.uuidCfdi).toBeNull();
    expect(pendientes.filas[0]?.tieneXml).toBe(false);

    const conCfdi = await reporteFiscal(sesion(), { cfdi: 'con' }, bd());
    expect(conCfdi.total).toBe(1);
    expect(conCfdi.filas[0]?.uuidCfdi).toBe('U-CONCILIADO');
    expect(conCfdi.filas[0]?.tieneXml).toBe(true);
  });

  it('el tablero de salud reporta % conciliado, pendientes y XML', async () => {
    const salud = await saludFiscal(sesion(), {}, bd());
    expect(salud.totalFiscales).toBe(2);
    expect(salud.conCfdi).toBe(1);
    expect(salud.sinCfdi).toBe(1);
    expect(salud.conXml).toBe(1);
    expect(salud.sinXml).toBe(1);
    expect(salud.pctConciliado).toBe(50);
    // Saldos por tercero: el proveedor con Σ 800, su RFC del catálogo.
    const fila = salud.saldos.find(
      (s) => s.idTercero === proveedor.id && s.tipoTercero === 'proveedor',
    );
    expect(fila?.saldoFiscal).toBe(800);
    expect(fila?.rfc).toBe('TNO900101AAA');
    expect(fila?.movimientos).toBe(2);
  });
});

// ── (e) A9 ───────────────────────────────────────────────────────────────────────────────────────
describe('A9: aislamiento por empresa', () => {
  it('los movimientos fiscales de otra empresa no se cuelan', async () => {
    await alta(
      {
        tipoTercero: 'proveedor',
        idTercero: proveedor.id,
        fecha: hace(1),
        origen: 'factura_proveedor',
        importe: 999,
        esFiscal: true,
        uuidCfdi: 'U-OTRA-EMPRESA',
      },
      sesion(PERM_TODOS, otraEmpresa.id),
    );
    const rep = await reporteFiscal(sesion(), {}, bd());
    expect(rep.total).toBe(0);
    const salud = await saludFiscal(sesion(), {}, bd());
    expect(salud.totalFiscales).toBe(0);
    expect(salud.pctConciliado).toBeNull();
  });
});

// ── (f) A4 ───────────────────────────────────────────────────────────────────────────────────────
describe('RBAC (deny-by-default, A4)', () => {
  it('sin `terceros.fiscal` NO hay reporte ni tablero', async () => {
    const sinFiscal = sesion(['terceros.ver', 'consultas.ver-importes']);
    await expect(reporteFiscal(sinFiscal, {}, bd())).rejects.toBeInstanceOf(ErrorPermiso);
    await expect(saludFiscal(sinFiscal, {}, bd())).rejects.toBeInstanceOf(ErrorPermiso);
  });
});

// ── (g) ocultamiento de importes ─────────────────────────────────────────────────────────────────
describe('ocultamiento de importes', () => {
  it('sin `consultas.ver-importes` los montos van en null pero los conteos siguen', async () => {
    await alta({
      tipoTercero: 'proveedor',
      idTercero: proveedor.id,
      fecha: hace(1),
      origen: 'factura_proveedor',
      importe: 700,
      esFiscal: true,
      uuidCfdi: 'U-OCULTO',
    });
    const sinImportes = sesion(['terceros.ver', 'terceros.fiscal']);
    const rep = await reporteFiscal(sinImportes, {}, bd());
    expect(rep.total).toBe(1);
    expect(rep.filas[0]?.monto).toBeNull();
    expect(rep.filas[0]?.esCargo).toBe(true); // el signo se sabe aunque el importe esté oculto
    expect(rep.totales.cargos).toBeNull();
    expect(rep.totales.movimientos).toBe(1);

    const salud = await saludFiscal(sinImportes, {}, bd());
    expect(salud.totalFiscales).toBe(1);
    expect(salud.saldos[0]?.saldoFiscal).toBeNull();
    expect(salud.saldos[0]?.movimientos).toBe(1);
  });
});
