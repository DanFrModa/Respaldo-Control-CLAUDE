/**
 * Integración del ETL de EsMa (F6-E6, Pieza B) — corre en CI (testcontainers), NO en local.
 *
 * Como en F1/F2/F3, `Respaldo CLAUDE/TABLAS/` NO existe en CI: apunta el ETL a fixtures committeados
 * (`migracion/__fixtures__/tablas-f6-esma/`) vía `TABLAS_DIR`. Antes de correr siembra el ESTADO que
 * consume: permisos + empresa + TipoProceso (costura/estampado) + proveedores con su mapeo de F1 + la
 * orden con su mapeo de F2 + un recibo de maquila (para la conciliación). NO usa los ETLs previos.
 *
 * Verifica:
 *  • Conteos EXACTOS (cargos/abonos/descuentos/pagos), con las OMISIONES esperadas.
 *  • ⭐ FIX de ESTAMPADO: el cargo `EsEstampado=1` cuyo maquilero es un `Maquileros` (Proceso=1) SÍ se
 *    crea (antes se buscaba solo en `mapaEstampador` y quedaba omitido).
 *  • Montos NEGATIVOS de abonos ("saldo anterior") preservados; monto nulo → 0.
 *  • `estadoRevision`: abonos/descuentos = `revisado`; pagos por `RevisionPendienteP` (1→capturado / 0→revisado).
 *  • `conFactura = null` y SIN efectos derivados (pagos sin aplicaciones; Orden.pagada intacta).
 *  • IDEMPOTENCIA: 2ª corrida no duplica.
 *  • CUADRE F6: saldos por maquilero v1 comparable == v2 (cuadran), conciliación recibido==cargado,
 *    inconsistencias listadas (cargo sin cabecera, movimientos con maquilero sin mapeo).
 */
import { fileURLToPath } from 'node:url';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import type { PrismaClient } from '../src/datos/index.js';
import { clientePruebas, limpiarBaseDatos, sembrarPermisos } from '../src/pruebas/contexto.js';

import { ejecutarEtlEsma } from './etl-esma.js';
import { calcularCuadreF6 } from './cuadre-f6.js';
import { ENTIDAD_MAPEO, guardarMapeo } from './comun/mapeo.js';

let cliente: PrismaClient;
const DIR_FIXTURES = fileURLToPath(new URL('./__fixtures__/tablas-f6-esma', import.meta.url));
let tablasDirPrevio: string | undefined;

let idEmpresaFR: number;
let idProv7: number; // maquilero costura (old 7)
let idProv8: number; // maquilero que hace estampado, Proceso=1 (old 8) → FIX
let idOrden100: number;
let idProcCostura: number;

beforeEach(async () => {
  cliente = clientePruebas();
  tablasDirPrevio = process.env.TABLAS_DIR;
  process.env.TABLAS_DIR = DIR_FIXTURES;
  await limpiarBaseDatos(cliente);
  await sembrarEstado();
});

afterAll(async () => {
  if (tablasDirPrevio === undefined) {
    delete process.env.TABLAS_DIR;
  } else {
    process.env.TABLAS_DIR = tablasDirPrevio;
  }
  await cliente.$disconnect();
});

/** Crea un proveedor con un rol dado y mapea su clave vieja (proveedorPorIdMaquileros). */
async function crearMaquilero(nombre: string, claveVieja: number): Promise<number> {
  const rol = await cliente.rolProveedor.upsert({
    where: { codigo: 'maquila-costura' },
    update: {},
    create: { codigo: 'maquila-costura', nombre: 'Maquila costura' },
  });
  const prov = await cliente.proveedor.create({
    data: { nombre, roles: { create: { idRolProveedor: rol.id } } },
  });
  await guardarMapeo(cliente, ENTIDAD_MAPEO.proveedorPorIdMaquileros, claveVieja, prov.id);
  return prov.id;
}

async function sembrarEstado(): Promise<void> {
  await sembrarPermisos(cliente);

  const empresa = await cliente.empresa.upsert({
    where: { nombre: 'FR Moda' },
    update: {},
    create: { nombre: 'FR Moda', favorita: true, paraIpt: true, paraEdr: true },
  });
  idEmpresaFR = empresa.id;

  const pc = await cliente.tipoProceso.upsert({
    where: { codigo: 'costura' },
    update: {},
    create: { codigo: 'costura', nombre: 'Costura', generaEntradaPt: true },
  });
  idProcCostura = pc.id;
  await cliente.tipoProceso.upsert({
    where: { codigo: 'estampado' },
    update: {},
    create: { codigo: 'estampado', nombre: 'Estampado', generaEntradaPt: false },
  });

  // Maquilero de costura (7) y maquilero que hace estampado con Proceso=1 (8). El 99 NO se mapea.
  idProv7 = await crearMaquilero('Maquilero Costura', 7);
  idProv8 = await crearMaquilero('Maquilero Estampa', 8);

  // Orden 100 migrada (la 999 NO se mapea → sus cargos se omiten).
  const modelo = await cliente.modelo.create({ data: { codigo: 'M100' } });
  const clienteNegocio = await cliente.cliente.create({ data: { nombre: 'Cliente X' } });
  const color = await cliente.color.create({ data: { nombre: 'Rojo' } });
  const talla = await cliente.talla.create({ data: { etiqueta: 'CH', orden: 1 } });
  const orden = await cliente.orden.create({
    data: {
      folio: 9100n,
      idEmpresa: empresa.id,
      idModelo: modelo.id,
      idCliente: clienteNegocio.id,
      estado: 'completa',
      fechaCompletada: new Date(),
    },
  });
  idOrden100 = orden.id;
  await guardarMapeo(cliente, ENTIDAD_MAPEO.orden, 100, orden.id);

  // Un recibo de maquila (costura, prov7, orden 100) de 100 pzas → para la conciliación del periodo.
  await cliente.etapaMovimiento.create({
    data: {
      folio: 1n,
      idEmpresa: empresa.id,
      idOrden: orden.id,
      tipo: 'recibo_maquila',
      idTipoProceso: idProcCostura,
      idTercero: idProv7,
      fecha: new Date('2020-08-20T00:00:00.000Z'),
      detalles: {
        create: [
          {
            idColor: color.id,
            idTalla: talla.id,
            cantidad: 100,
            cantidadPrimeras: 100,
            cantidadSegundas: 0,
          },
        ],
      },
    },
  });
}

/** Conteos para idempotencia y aserciones. */
async function conteos(): Promise<Record<string, number>> {
  return {
    cargos: await cliente.esMaCargo.count(),
    abonos: await cliente.abonoMaquilero.count(),
    descuentos: await cliente.descuentoMaquilero.count(),
    pagos: await cliente.pagoMaquilero.count(),
    aplicaciones: await cliente.pagoAplicacion.count(),
  };
}

describe('ETL de EsMa F6-E6 (integración, fixtures committeados)', () => {
  it('carga con conteos EXACTOS, con las omisiones esperadas, y es IDEMPOTENTE', async () => {
    await ejecutarEtlEsma(cliente);
    const tras1 = await conteos();

    // Cargos: costura(1) + estampado(2) = 2; el 3 (orden 999) y el 4 (sin cabecera) OMITIDOS.
    expect(tras1.cargos).toBe(2);
    // Abonos: 500 + (-200) [prov7] + null→0 [prov8] = 3; el de maquilero 99 OMITIDO.
    expect(tras1.abonos).toBe(3);
    // Descuentos: 1 (prov7); el de maquilero 99 OMITIDO.
    expect(tras1.descuentos).toBe(1);
    // Pagos: 300 [prov7] + 50 [prov8] = 2; el sin cabecera OMITIDO. SIN aplicaciones (pago libre).
    expect(tras1.pagos).toBe(2);
    expect(tras1.aplicaciones).toBe(0);

    // Idempotencia.
    await ejecutarEtlEsma(cliente);
    expect(await conteos()).toEqual(tras1);
  }, 180_000);

  it('FIX ESTAMPADO: el cargo EsEstampado=1 con maquilero Maquileros (Proceso=1) SÍ se crea', async () => {
    await ejecutarEtlEsma(cliente);
    const estampado = await cliente.tipoProceso.findFirstOrThrow({
      where: { codigo: 'estampado' },
    });
    const cargoEst = await cliente.esMaCargo.findFirst({
      where: { idTipoProceso: estampado.id },
    });
    expect(cargoEst).not.toBeNull();
    expect(cargoEst?.idMaquilero).toBe(idProv8); // resuelto por mapaMaquilero, no estampador
    expect(cargoEst?.idEtapaRecibo).toBeNull();
    expect(Number(cargoEst?.cantidadReal)).toBe(50);
    expect(Number(cargoEst?.precioReal)).toBe(3);
  });

  it('ABONOS: negativo preservado, nulo→0, conFactura null, estadoRevision revisado', async () => {
    await ejecutarEtlEsma(cliente);
    const abonos = await cliente.abonoMaquilero.findMany({
      where: { idMaquilero: idProv7 },
      orderBy: { monto: 'desc' },
    });
    expect(abonos).toHaveLength(2);
    expect(Number(abonos[0]?.monto)).toBe(500);
    expect(Number(abonos[1]?.monto)).toBe(-200); // saldo anterior negativo preservado
    for (const a of abonos) {
      expect(a.conFactura).toBeNull();
      expect(a.estadoRevision).toBe('revisado');
      expect(a.idEmpresa).toBe(idEmpresaFR);
    }
    // Abono nulo → 0 (prov8).
    const abonoProv8 = await cliente.abonoMaquilero.findFirstOrThrow({
      where: { idMaquilero: idProv8 },
    });
    expect(Number(abonoProv8.monto)).toBe(0);
  });

  it('PAGOS: estadoRevision por RevisionPendienteP; sin aplicaciones; Orden.pagada intacta', async () => {
    await ejecutarEtlEsma(cliente);
    const pagoProv7 = await cliente.pagoMaquilero.findFirstOrThrow({
      where: { idMaquilero: idProv7 },
      include: { aplicaciones: true },
    });
    expect(Number(pagoProv7.monto)).toBe(300);
    expect(pagoProv7.estadoRevision).toBe('revisado'); // RevisionPendienteP=0
    expect(pagoProv7.aplicaciones).toHaveLength(0);
    expect(pagoProv7.conFactura).toBeNull();

    const pagoProv8 = await cliente.pagoMaquilero.findFirstOrThrow({
      where: { idMaquilero: idProv8 },
    });
    expect(pagoProv8.estadoRevision).toBe('capturado'); // RevisionPendienteP=1

    // La orden NO quedó marcada como pagada (el ETL de pagos libres no recalcula Orden.pagada).
    const orden = await cliente.orden.findUniqueOrThrow({ where: { id: idOrden100 } });
    expect(orden.pagada ?? false).toBe(false);
  });

  it('CUADRE F6: saldos v1 comparable == v2, conciliación recibido==cargado, inconsistencias', async () => {
    await ejecutarEtlEsma(cliente);
    const c = await calcularCuadreF6(cliente);

    // Conteos (v2) del bloque de conteos.
    const cargos = c.conteos.find((r) => r.entidad.startsWith('Cargos'));
    expect(cargos?.v2).toBe(2);

    // Saldos: prov7 = 1000 + (500−200) − 300 − 100 = 900; prov8 = 150 − 50 = 100. Ambos cuadran.
    expect(c.saldos.comparados).toBe(2);
    expect(c.saldos.cuadran).toBe(2);
    expect(c.saldos.descuadran).toBe(0);
    expect(c.saldos.totalV1).toBe(1000);
    expect(c.saldos.totalV2).toBe(1000);
    // El cargo de la orden 999 (no migrada) se excluye del comparable (causa sistemática).
    expect(c.saldos.cargosOrdenNoMigrada).toBe(1);
    expect(c.saldos.montoCargosOrdenNoMigrada).toBe(100); // 20 × 5

    // Conciliación: recibido 100 (recibo) vs cargado 100 (cargo costura) → cuadra.
    expect(c.conciliacion.recibido).toBe(100);
    expect(c.conciliacion.cargado).toBe(100);
    expect(c.conciliacion.faltantePorCargar).toBe(0);
    // Los cargos migrados no ligan recibo (idEtapaRecibo NULL) — esperado.
    expect(c.conciliacion.numCargosSinRecibo).toBe(2);

    // Inconsistencias listadas.
    expect(c.inconsistencias.cargosSinCabecera).toHaveLength(1); // el cargo 4 (IdEsMa=0)
    expect(c.inconsistencias.abonosSinMapeo).toBe(1); // abono del maquilero 99
    expect(c.inconsistencias.descuentosSinMapeo).toBe(1);
    expect(c.inconsistencias.pagosSinCabecera).toBe(1); // pago con IdEsMa=0
  });
});
