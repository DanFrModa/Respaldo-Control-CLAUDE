/**
 * ETL del histórico de COSTOS (F7-E6) — orquestador.
 *
 * Migra `CostoOrd.csv` (2,513) → `CostoOrden`, VÍA el servicio de dominio `guardarCostoOrden` (A1),
 * IDEMPOTENTE (salta órdenes ya costeadas) y por LOTES. ⭐ DECISIÓN D2: la REGALÍA (`RegaliasCost`)
 * NO se migra como componente (va sobre la venta); `procesosCost = MaquilaCost + BordCost`,
 * `aviosCost = HabCost`, `telaCost = TelaCost`. El `costoTotal` v2 lo arma el dominio y EXCLUYE la
 * regalía → el cuadre muestra el delta v1−v2 = Σ RegaliasCost como ESPERADO por diseño (ver
 * `cuadre-f7.ts`). Depende del mapeo de ÓRDENES de F2 (`ENTIDAD_MAPEO.orden`).
 *
 * Lo corre Gabriel desde `backend/` con:  npx tsx --env-file=.env migracion/etl-costos.ts
 * (NUNCA `npm run`: esos no llevan --env-file — ver migracion/README.md).
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { crearClientePrisma, type PrismaClient } from '../src/datos/index.js';

import { Reporte } from './comun/reporte.js';
import { describirVentana, resolverVentana } from './comun/ventana.js';
import { cargarCostos } from './loaders/costos.js';
import type { ResultadoLoader } from './loaders/clientes.js';
import { calcularCuadreF7, formatearCuadreF7 } from './cuadre-f7.js';

/** Imprime el resumen de un loader (mismo formato que los demás ETL). */
function log(nombre: string, r: ResultadoLoader): void {
  const omVal = r.omitidosValidacion ?? 0;
  console.log(
    `  ${nombre.padEnd(22)} creados=${String(r.creados).padStart(6)} ` +
      `existentes=${String(r.existentes).padStart(6)} omitidos=${String(r.omitidos).padStart(6)}` +
      (omVal > 0 ? ` omitidosValidacion=${String(omVal)}` : ''),
  );
}

/** Corre el ETL de costos contra el cliente dado. Devuelve el reporte de incidencias. */
export async function ejecutarEtlCostos(cliente: PrismaClient): Promise<Reporte> {
  const reporte = new Reporte();
  console.log('ETL Costos F7-E6 — inicio');
  // Ventana temporal: el costo NO lleva fecha propia — su ventana es la CASCADA por orden (los
  // costos de órdenes fuera de ventana quedan en el bucket agregado del reporte).
  const ventana = resolverVentana();
  console.log(`  ${describirVentana(ventana)}`);
  reporte.nota(describirVentana(ventana));
  const costos = await cargarCostos(cliente, reporte);
  log('Costos', costos);
  console.log('ETL Costos F7-E6 — fin de carga');
  return reporte;
}

/** Punto de entrada del script. */
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('Falta DATABASE_URL (ver backend/.env.example)');
    process.exit(1);
  }
  const cliente = crearClientePrisma(url, {
    transactionOptions: { maxWait: 20_000, timeout: 120_000 },
    poolMax: 12,
    pool: { keepAlive: true, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 30_000 },
  });
  try {
    const reporte = await ejecutarEtlCostos(cliente);
    const cuadre = formatearCuadreF7(await calcularCuadreF7(cliente));
    const textoReporte = reporte.aTexto();
    console.log('\n' + cuadre);
    console.log('\n' + textoReporte);

    const salida = join(
      process.cwd(),
      `reporte-etl-f7e6-costos-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`,
    );
    writeFileSync(salida, `${cuadre}\n\n${textoReporte}\n`, { encoding: 'utf-8' });
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
