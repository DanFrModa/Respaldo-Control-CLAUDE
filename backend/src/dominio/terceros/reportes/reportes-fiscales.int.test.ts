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

import { cancelarMovimientoTercero, registrarMovimientoTercero } from '../cuenta-terceros.js';
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

/**
 * Crea una fila `Archivo` real (el XML del CFDI en R2) y devuelve su id. `idArchivoCfdi` del movimiento
 * es un FK a `Archivo` → hay que sembrar el archivo antes de usar su id, o Postgres rechaza el insert.
 */
async function archivoCfdi(key: string): Promise<string> {
  const archivo = await cliente.archivo.create({
    data: {
      bucket: 'control-v2-prueba',
      key,
      nombreOriginal: 'cfdi.xml',
      tipoMime: 'application/xml',
      tamanoBytes: 1024,
    },
    select: { id: true },
  });
  return archivo.id;
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
    data: {
      modalidadFacturacion: 'solo_sin',
      nombre: 'Telas del Norte',
      diasCredito: 30,
      rfc: 'TNO900101AAA',
    },
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
      idArchivoCfdi: await archivoCfdi('r2/cfdi-1.xml'),
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
      idArchivoCfdi: await archivoCfdi('r2/ok.xml'),
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

// ── (h) cancelaciones no fantasmean la conciliación ni inflan los brutos (D2) ────────────────────
describe('cancelaciones (inverso + original) fuera de conteos y agregaciones', () => {
  /** Id del movimiento del uuid dado (para cancelarlo por el motor). */
  async function idPorUuid(uuid: string): Promise<number> {
    const m = await cliente.movimientoTercero.findFirstOrThrow({
      where: { uuidCfdi: uuid },
      select: { id: true },
    });
    return m.id;
  }

  it('un CFDI importado y CANCELADO no deja pendientes fantasma ni falsea el pctConciliado', async () => {
    // Un CFDI conciliado (UUID + XML) y otro que se CANCELA (crea su inverso fiscal sin UUID/XML).
    await alta({
      tipoTercero: 'proveedor',
      idTercero: proveedor.id,
      fecha: hace(5),
      origen: 'factura_proveedor',
      importe: 1000,
      esFiscal: true,
      uuidCfdi: 'U-VIVO',
      idArchivoCfdi: await archivoCfdi('r2/vivo.xml'),
    });
    await alta({
      tipoTercero: 'proveedor',
      idTercero: proveedor.id,
      fecha: hace(4),
      origen: 'factura_proveedor',
      importe: 500,
      esFiscal: true,
      uuidCfdi: 'U-CANCELADO',
      idArchivoCfdi: await archivoCfdi('r2/cancelado.xml'),
    });
    await cancelarMovimientoTercero(
      sesion(),
      await idPorUuid('U-CANCELADO'),
      { motivo: 'error' },
      bd(),
    );

    // SALUD: solo cuenta el CFDI VIVO. Sin el fix, el inverso (sin UUID/XML) sumaba a sinCfdi/sinXml y
    // el original cancelado inflaba el total → pctConciliado 33% fantasma en vez de 100%.
    const salud = await saludFiscal(sesion(), {}, bd());
    expect(salud.totalFiscales).toBe(1);
    expect(salud.conCfdi).toBe(1);
    expect(salud.sinCfdi).toBe(0);
    expect(salud.conXml).toBe(1);
    expect(salud.sinXml).toBe(0);
    expect(salud.pctConciliado).toBe(100);
    // El saldo del proveedor refleja solo el vivo (1000); el par cancelado (500 − 500) se neutraliza.
    const saldoProv = salud.saldos.find((s) => s.idTercero === proveedor.id);
    expect(saldoProv?.saldoFiscal).toBe(1000);
    expect(saldoProv?.movimientos).toBe(1);

    // REPORTE: la LISTA conserva el rastro (vivo + original cancelado + inverso = 3), pero los brutos
    // solo cuentan el CFDI vivo (cargos 1000, abonos 0, neto 1000) — nada del par cancelado.
    const rep = await reporteFiscal(sesion(), {}, bd());
    expect(rep.total).toBe(3);
    expect(rep.totales.cargos).toBe(1000);
    expect(rep.totales.abonos).toBe(0);
    expect(rep.totales.neto).toBe(1000);
    expect(rep.filas.some((f) => f.esInverso)).toBe(true);
    expect(rep.filas.some((f) => f.cancelado)).toBe(true);
  });

  it('un ÚNICO CFDI cancelado deja la salud en cero limpio (sin pendientes fantasma)', async () => {
    await alta({
      tipoTercero: 'proveedor',
      idTercero: proveedor.id,
      fecha: hace(3),
      origen: 'factura_proveedor',
      importe: 700,
      esFiscal: true,
      uuidCfdi: 'U-SOLO',
      idArchivoCfdi: await archivoCfdi('r2/solo.xml'),
    });
    await cancelarMovimientoTercero(
      sesion(),
      await idPorUuid('U-SOLO'),
      { motivo: 'duplicado' },
      bd(),
    );

    const salud = await saludFiscal(sesion(), {}, bd());
    expect(salud.totalFiscales).toBe(0);
    expect(salud.sinCfdi).toBe(0);
    expect(salud.sinXml).toBe(0);
    expect(salud.pctConciliado).toBeNull();
    expect(salud.saldos).toHaveLength(0);

    // El neto del reporte ya era correcto (par se anula); los brutos ahora también.
    const rep = await reporteFiscal(sesion(), {}, bd());
    expect(rep.totales.cargos).toBe(0);
    expect(rep.totales.abonos).toBe(0);
    expect(rep.totales.neto).toBe(0);
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
