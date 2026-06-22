/**
 * Integración del ETL de COMPRAS + NOTAS (F4-E6, Pieza A) — corre en CI (testcontainers), NO en local.
 *
 * Como en F1/F2/F3, `Respaldo CLAUDE/TABLAS/` NO existe en CI: apunta el ETL a fixtures committeados
 * (`migracion/__fixtures__/tablas-f4/`, CP850 reales recortados) vía `TABLAS_DIR`. Antes de correr el
 * ETL siembra el ESTADO que consume: empresa FR + proveedor/maquilero + las órdenes de F2 con sus
 * mapeos `MapeoMigracion` (empresa, proveedor, maquilero, órdenes). NO usa los ETLs de F1/F2.
 *
 * Verifica:
 *  • Conteos EXACTOS de los fixtures (OC creadas/omitidas, líneas, ligas N:N, notas, renglones).
 *  • OC con empresa/proveedor sin mapeo → OMITIDA; liga a orden sin mapeo → OMITIDA.
 *  • Nota con maquilero vacío → OMITIDA; nota sin orden mapeable → OMITIDA.
 *  • SIN efectos de kardex: cero `Movimiento` (las OC/notas legacy son documento histórico).
 *  • Texto libre legacy preservado en `descripcionLibre`/`descripcionLegacy` (con acentos CP850 y
 *    saltos de línea EMBEBIDOS).
 *  • Autorización/cancelación históricas migradas; folio = NumCompra/NumNota original.
 *  • Almacén SENTINELA inactivo para las notas (sin almacén origen en el viejo).
 *  • IDEMPOTENCIA: 2ª corrida no duplica.
 */
import { fileURLToPath } from 'node:url';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import type { PrismaClient } from '../src/datos/index.js';
import { clientePruebas, limpiarBaseDatos, sembrarPermisos } from '../src/pruebas/contexto.js';

import { ejecutarEtlComprasNotas } from './etl-compras-notas.js';
import { ALMACEN_SENTINELA_NOTAS } from './loaders/notas-salida.js';
import { ENTIDAD_MAPEO, guardarMapeo } from './comun/mapeo.js';

let cliente: PrismaClient;
const DIR_FIXTURES = fileURLToPath(new URL('./__fixtures__/tablas-f4', import.meta.url));
let tablasDirPrevio: string | undefined;
let ventanaPrevia: string | undefined;

let idEmpresaFR: number;
let idOrden839: number;
let idOrden840: number;

beforeEach(async () => {
  cliente = clientePruebas();
  tablasDirPrevio = process.env.TABLAS_DIR;
  ventanaPrevia = process.env.ETL_VENTANA_ANIOS;
  process.env.TABLAS_DIR = DIR_FIXTURES;
  // Ventana DESACTIVADA para estos fixtures (datos de 2005-2010): probamos la carga completa.
  delete process.env.ETL_VENTANA_ANIOS;
  await limpiarBaseDatos(cliente);
  await sembrarEstado();
});

afterAll(async () => {
  if (tablasDirPrevio === undefined) delete process.env.TABLAS_DIR;
  else process.env.TABLAS_DIR = tablasDirPrevio;
  if (ventanaPrevia === undefined) delete process.env.ETL_VENTANA_ANIOS;
  else process.env.ETL_VENTANA_ANIOS = ventanaPrevia;
  await cliente.$disconnect();
});

/** Siembra empresa FR + proveedor + maquilero + 2 órdenes, con sus mapeos de F1/F2. */
async function sembrarEstado(): Promise<void> {
  await sembrarPermisos(cliente);

  const empresa = await cliente.empresa.upsert({
    where: { nombre: 'FR Moda' },
    update: {},
    create: { nombre: 'FR Moda', favorita: true, paraIpt: true, paraEdr: true },
  });
  idEmpresaFR = empresa.id;
  // Empresa vieja 8 → FR Moda; la empresa 1 del fixture NO se mapea (queda omitida).
  await guardarMapeo(cliente, ENTIDAD_MAPEO.empresa, 8, empresa.id);

  // Proveedor (IdProveedor 1) y maquilero (IdMaquileros 1) — un mismo Proveedor sirve para ambos roles.
  const prov = await cliente.proveedor.create({ data: { nombre: 'Proveedor Telas SA' } });
  await guardarMapeo(cliente, ENTIDAD_MAPEO.proveedorPorIdProveedor, 1, prov.id);
  const maq = await cliente.proveedor.create({ data: { nombre: 'Maquilero Costura SA' } });
  await guardarMapeo(cliente, ENTIDAD_MAPEO.proveedorPorIdMaquileros, 1, maq.id);

  const clienteNegocio = await cliente.cliente.create({ data: { nombre: 'Cliente X' } });
  const modelo = await cliente.modelo.create({ data: { codigo: 'M100' } });
  idOrden839 = await crearOrden(empresa.id, clienteNegocio.id, modelo.id, 9839);
  await guardarMapeo(cliente, ENTIDAD_MAPEO.orden, 839, idOrden839);
  idOrden840 = await crearOrden(empresa.id, clienteNegocio.id, modelo.id, 9840);
  await guardarMapeo(cliente, ENTIDAD_MAPEO.orden, 840, idOrden840);
  // La orden vieja 999/9999 NO se siembra (sin mapeo) → ligas/renglones que la usen se omiten.
}

async function crearOrden(
  idEmpresa: number,
  idCliente: number,
  idModelo: number,
  folio: number,
): Promise<number> {
  const o = await cliente.orden.create({
    data: { folio: BigInt(folio), idEmpresa, idModelo, idCliente, estado: 'capturada' },
  });
  return o.id;
}

async function conteos(): Promise<Record<string, number>> {
  return {
    oc: await cliente.ordenCompra.count(),
    ocLinea: await cliente.ordenCompraLinea.count(),
    ocOrden: await cliente.ordenCompraOrden.count(),
    nota: await cliente.notaSalida.count(),
    notaLinea: await cliente.notaSalidaLinea.count(),
    movimiento: await cliente.movimiento.count(),
  };
}

describe('ETL de compras + notas F4-E6 (integración, fixtures committeados)', () => {
  it('carga con conteos EXACTOS, sin kardex, y es IDEMPOTENTE', async () => {
    await ejecutarEtlComprasNotas(cliente);
    const tras1 = await conteos();

    // OC: 2 (NumCompra 1) + 4 (cancelada) creadas; 3 (empresa sin mapeo) y 5 (proveedor sin mapeo) omitidas.
    expect(tras1.oc).toBe(2);
    // Líneas: OC 2 → 3 líneas (incl. la de cantidad negativa saneada y la de descripción vacía, que
    // se conserva con el texto sentinela "(sin descripción)" — nada se pierde en silencio); OC 4 → 1
    // línea. La línea huérfana (IdOrdCompra 777) no cuenta. Total 4.
    expect(tras1.ocLinea).toBe(4);
    // Ligas N:N: OC 2 → (839, 840) [999 sin mapeo omitida]; OC 4 → (839). Total 3.
    expect(tras1.ocOrden).toBe(3);
    // Notas: 49 creada; 50 (maquilero vacío) omitida; 51 (orden sin mapeo) omitida.
    expect(tras1.nota).toBe(1);
    // Renglones de nota 49: 2 (orden 839 + orden 840), ambos mapeados.
    expect(tras1.notaLinea).toBe(2);
    // SIN efectos de kardex.
    expect(tras1.movimiento).toBe(0);

    // Idempotencia: 2ª corrida no duplica.
    await ejecutarEtlComprasNotas(cliente);
    expect(await conteos()).toEqual(tras1);
  }, 120_000);

  it('OC: folio, empresa, proveedor, autorización y texto libre con acento (CP850)', async () => {
    await ejecutarEtlComprasNotas(cliente);
    const oc = await cliente.ordenCompra.findFirstOrThrow({
      where: { numCompra: 1n },
      include: { lineas: { orderBy: { id: 'asc' } }, ordenesLigadas: true },
    });
    expect(oc.idEmpresa).toBe(idEmpresaFR);
    expect(oc.estatus).toBe('autorizada');
    expect(oc.idUsuAutorizado).toBe('legacy:7');
    expect(oc.fechaAutorizado).not.toBeNull();
    expect(oc.observaciones).toBe('Telas para pedido 931');
    expect(oc.correspondeA).toBe('Pedido 931');
    expect(oc.facturasAmparadasLegacy).toBe('F-123 F-124');
    // Líneas: texto libre, cantidad negativa saneada a 0, acento CP850 decodificado bien, y la línea
    // de descripción vacía conservada con el sentinela "(sin descripción)".
    expect(oc.lineas).toHaveLength(3);
    const conAcento = oc.lineas.find((l) => l.descripcionLibre?.includes('Algod'));
    expect(conAcento?.descripcionLibre).toBe('Felpa de Algodón');
    expect(Number(conAcento?.cantidad)).toBe(0); // -5 → 0
    const vacia = oc.lineas.find((l) => l.descripcionLibre === '(sin descripción)');
    expect(vacia).toBeDefined();
    // Ligas: 839 y 840 (la 999 sin mapeo se omitió).
    const ordenes = new Set(oc.ordenesLigadas.map((o) => o.idOrden));
    expect(ordenes).toEqual(new Set([idOrden839, idOrden840]));
  });

  it('OC cancelada: estatus + motivo histórico preservados', async () => {
    await ejecutarEtlComprasNotas(cliente);
    const oc = await cliente.ordenCompra.findFirstOrThrow({ where: { numCompra: 3n } });
    expect(oc.estatus).toBe('cancelada');
    expect(oc.motivoCancelacion).toBe('Ya no se necesita');
    expect(oc.canceladaPorId).toBe('legacy:2');
    expect(oc.canceladaEn).not.toBeNull();
  });

  it('Nota: folio, maquilero, almacén sentinela y renglón con salto de línea EMBEBIDO', async () => {
    await ejecutarEtlComprasNotas(cliente);
    const nota = await cliente.notaSalida.findFirstOrThrow({
      where: { numNota: 48n },
      include: { lineas: { orderBy: { id: 'asc' } }, almacen: true },
    });
    expect(nota.idEmpresa).toBe(idEmpresaFR);
    expect(nota.estatus).toBe('confirmada');
    // Almacén sentinela inactivo, global.
    expect(nota.almacen.nombre).toBe(ALMACEN_SENTINELA_NOTAS);
    expect(nota.almacen.activo).toBe(false);
    expect(nota.almacen.idEmpresa).toBeNull();
    // Renglones: texto libre con salto embebido + acento; cantidad 0; ligados a su orden.
    expect(nota.lineas).toHaveLength(2);
    const conSalto = nota.lineas.find((l) => l.descripcionLegacy?.includes('Cierre Nycast'));
    expect(conSalto?.descripcionLegacy).toContain('\n'); // salto embebido preservado
    expect(conSalto?.descripcionLegacy).toContain('Trazos 64901C1');
    expect(conSalto?.idOrden).toBe(idOrden839);
    expect(Number(conSalto?.cantidad)).toBe(0);
    const conAcento = nota.lineas.find((l) => l.descripcionLegacy?.includes('Bot'));
    expect(conAcento?.descripcionLegacy).toBe('Botón de Algodón x 200');
    expect(conAcento?.idOrden).toBe(idOrden840);
  });

  it('VENTANA: ETL_VENTANA_ANIOS recorta por fecha y reporta lo excluido', async () => {
    // Con ventana de 10 años anclada a 2026, las OC/notas de 2005-2010 quedan TODAS fuera.
    process.env.ETL_VENTANA_ANIOS = '10';
    process.env.ETL_VENTANA_REF = '2026-01-01';
    try {
      const { ocs, notas } = await ejecutarEtlComprasNotas(cliente);
      // Las 2 OC migrables (1 y 3) son de 2005/2009 → fuera de ventana.
      expect(ocs.ocs.creados).toBe(0);
      expect(ocs.fueraVentana).toBeGreaterThan(0);
      // La nota 49 es de 2005 → fuera de ventana.
      expect(notas.notas.creados).toBe(0);
      expect(notas.fueraVentana).toBeGreaterThan(0);
      expect(await cliente.ordenCompra.count()).toBe(0);
      expect(await cliente.notaSalida.count()).toBe(0);
    } finally {
      delete process.env.ETL_VENTANA_REF;
      delete process.env.ETL_VENTANA_ANIOS;
    }
  }, 60_000);
});
