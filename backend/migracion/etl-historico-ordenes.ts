/**
 * ETL del ARCHIVO HISTÓRICO DE ÓRDENES del sistema viejo (§Post-F9.26).
 *
 * Daniel (10-ago-2026): *"me gustaría tenerlas también como archivo histórico de órdenes… para poder
 * buscar por cliente, número de modelo, tipo de prenda, fecha de producción, maquilero, etc."*
 *
 * Carga **TODAS** las órdenes del viejo (5,451) con su matriz color×talla (39,853 celdas) y sus
 * movimientos de producción (35,296) — 80,600 renglones —, como un archivo PLANO de solo consulta.
 * Es lo único del ETL que ignora a propósito la ventana de 2025-2026 (§Post-F9.24): existe justamente
 * para guardar lo que la ventana deja fuera.
 *
 * "TODAS" es literal desde §Post-F9.29 (antes eran 3,923): las 1,528 órdenes de las 6 empresas
 * viejas que no migran se **rescatan** colgándolas de la empresa principal y conservando en
 * `empresaV1` el nombre de la empresa a la que pertenecían. Daniel: *"sí, está bien, rescata todas y
 * solo pon en algún lugar la empresa a la que correspondía."*
 *
 * SE CORRE DESPUÉS de `etl-catalogos` (necesita los mapeos de Empresa y Modelo):
 *
 *     npx tsx --env-file=.env migracion/etl-historico-ordenes.ts
 *
 * NUNCA con `npm run etl:*` (esos no cargan `.env` a propósito, para no romper el CI).
 *
 * Carga TAMBIÉN el **directorio histórico de terceros** (§Post-F9.28): la libreta de direcciones con
 * el teléfono y la dirección de los 1,052 terceros del Access, fuera del catálogo `Proveedor`. Son
 * las dos mitades de lo mismo: guardar la historia sin ensuciar los catálogos.
 *
 * Es IDEMPOTENTE: re-correrlo no duplica.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { crearClientePrisma, type PrismaClient } from '../src/datos/index.js';

import { Reporte } from './comun/reporte.js';
import { describirVentana, resolverVentana } from './comun/ventana.js';
import { cargarDirectorioTerceros } from './loaders/directorio-terceros.js';
import { cargarHistoricoOrdenes } from './loaders/historico-ordenes.js';

export async function ejecutarEtl(cliente: PrismaClient): Promise<Reporte> {
  const reporte = new Reporte();

  console.log('ETL del archivo histórico de órdenes (§Post-F9.26) — inicio');
  console.log(
    '  (carga TODAS las órdenes del viejo —las 5,451—: es el archivo de consulta, no lo operativo)',
  );
  // La ventana se imprime también aquí, pero con su aviso: este ETL la IGNORA A PROPÓSITO (existe
  // para guardar justamente lo que ella deja fuera). Sin esta línea, ver "DESACTIVADA" —o no ver
  // nada— en el único reporte que debe ignorarla confunde a quien sigue el runbook (Regla 3).
  const ventana = resolverVentana();
  const avisoVentana =
    `${describirVentana(ventana)} ⚠️ ESTE ETL IGNORA LA VENTANA A PROPÓSITO: carga el histórico ` +
    `COMPLETO (es el archivo de consulta). La línea es informativa; no cambia lo que se carga.`;
  console.log(`  ${avisoVentana}`);
  reporte.nota(avisoVentana);

  const r = await cargarHistoricoOrdenes(cliente, reporte);

  console.log(`  Órdenes históricas insertadas: ${String(r.ordenes)}`);
  console.log(`  Ya existían (idempotencia):    ${String(r.existentes)}`);
  console.log(`  Celdas color×talla:           ${String(r.celdas)}`);
  console.log(`  Movimientos de producción:    ${String(r.procesos)}`);
  if (r.rescatadas > 0) {
    console.log(
      `  De empresas que NO migran, rescatadas en la principal: ${String(r.rescatadas)} ` +
        `(conservan su empresa en "empresaV1"; el desglose por empresa está en el reporte)`,
    );
  }
  if (r.sinModelo > 0) {
    console.log(`  Sin modelo ligado (con código en texto): ${String(r.sinModelo)}`);
  }

  // §Post-F9.28 — la libreta de direcciones de los terceros del viejo. Va en el MISMO ETL: son las
  // dos mitades de "guardar la historia sin ensuciar los catálogos".
  const dir = await cargarDirectorioTerceros(cliente, reporte);
  console.log(
    `  Directorio de terceros: ${String(dir.creados)} cargados (${String(dir.existentes)} ya estaban)`,
  );
  console.log(`    (de ellos, ${String(dir.enCatalogo)} SÍ están en el catálogo depurado)`);
  if (dir.descartados > 0) {
    console.log(
      `    Fichas VACÍAS del Access que quedaron fuera: ${String(dir.descartados)} (detalle en el reporte)`,
    );
  }

  return reporte;
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (url === undefined || url.trim() === '') {
    console.error(
      'Falta DATABASE_URL. Corre el ETL así, desde backend/:\n' +
        '  npx tsx --env-file=.env migracion/etl-historico-ordenes.ts',
    );
    process.exitCode = 1;
    return;
  }

  const cliente = crearClientePrisma(url, {
    transactionOptions: { maxWait: 20_000, timeout: 120_000 },
    poolMax: 12,
  });
  try {
    const reporte = await ejecutarEtl(cliente);
    const texto = reporte.aTexto();
    console.log('\n' + texto);

    const salida = join(
      process.cwd(),
      `reporte-etl-historico-ordenes-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`,
    );
    writeFileSync(salida, `${texto}\n`, { encoding: 'utf-8' });
    console.log(`\nReporte escrito en: ${salida}`);
  } finally {
    await cliente.$disconnect();
  }
}

const ejecutadoComoScript =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (ejecutadoComoScript) {
  await main();
}
