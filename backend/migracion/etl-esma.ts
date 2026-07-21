/**
 * ETL del módulo EsMa (F6-E6, Pieza B) — orquestador.
 *
 * Deja EsMa COMPLETO: los CARGOS históricos (`EsMa_Recibos`) + los tres MOVIMIENTOS planos
 * (`EsMa_Abonos`/`EsMa_Desc`/`EsMa_Pagos`), de los CSV de `Respaldo CLAUDE/TABLAS/` (CP850) a la BD de
 * v2, VÍA el MODO MIGRACIÓN de la capa de dominio (A1), IDEMPOTENTE (por `MapeoMigracion`) y por LOTES.
 * Depende de los mapeos de F1 (proveedores) y F2 (órdenes) que dejaron los ETLs previos.
 *
 * ORDEN de carga (los cargos PRIMERO: fijan la empresa que heredan los movimientos, ver
 * `resolverEmpresaEsMa`):
 *  1. Cargos EsMa    (EsMa + EsMa_Recibos)  → EsMaCargo    (con el FIX de estampado de F6-E6)
 *  2. Abonos         (EsMa + EsMa_Abonos)   → AbonoMaquilero
 *  3. Descuentos     (EsMa + EsMa_Desc)     → DescuentoMaquilero
 *  4. Pagos LIBRES   (EsMa + EsMa_Pagos)    → PagoMaquilero (sin aplicaciones, sin recomputar Orden.pagada)
 *
 * ⭐ Los CARGOS también los carga el ETL de PRODUCCIÓN (F3-E6, `etl-produccion.ts`) — ambos usan el
 * MISMO `MapeoMigracion` (`CargoEsMa`), así que re-correr cualquiera de los dos NO duplica. Correr
 * `etl-esma` deja EsMa completo aunque F3 no se haya re-corrido.
 *
 * Cada movimiento se crea en SU PROPIA transacción (atomicidad por documento, A2), sin efectos
 * derivados (kardex/orden-pagada intactos). NO toca la API ni el frontend.
 *
 * Lo corre Gabriel desde `backend/` con:  npx tsx --env-file=.env migracion/etl-esma.ts
 * (NUNCA `npm run`: esos no llevan --env-file — ver migracion/README.md).
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { crearClientePrisma, type PrismaClient } from '../src/datos/index.js';

import { sesionEtl } from './comun/sesion-etl.js';
import { Reporte } from './comun/reporte.js';
import { prescanVentanaF2 } from './comun/ventana-f2.js';
import { describirVentana, resolverVentana } from './comun/ventana.js';
import {
  cargarCargosEsMa,
  crearAsientosSaldoInicialEsMa,
  SaldoInicialEsMa,
} from './loaders/esma-cargos.js';
import { cargarAbonosEsMa } from './loaders/esma-abonos.js';
import { cargarDescuentosEsMa } from './loaders/esma-descuentos.js';
import { cargarPagosEsMa } from './loaders/esma-pagos.js';
import type { ResultadoLoader } from './loaders/clientes.js';
import { calcularCuadreF6, formatearCuadreF6 } from './cuadre-f6.js';

/** Imprime el resumen de un loader (mismo formato que los demás ETL). */
function log(nombre: string, r: ResultadoLoader): void {
  const omVal = r.omitidosValidacion ?? 0;
  const fueraVentana = r.fueraVentana ?? 0;
  console.log(
    `  ${nombre.padEnd(22)} creados=${String(r.creados).padStart(6)} ` +
      `existentes=${String(r.existentes).padStart(6)} omitidos=${String(r.omitidos).padStart(6)}` +
      (omVal > 0 ? ` omitidosValidacion=${String(omVal)}` : '') +
      (fueraVentana > 0 ? ` fueraVentana=${String(fueraVentana)}` : ''),
  );
}

/** Corre TODO el ETL de EsMa contra el cliente dado. Devuelve el reporte de incidencias. */
export async function ejecutarEtlEsma(cliente: PrismaClient): Promise<Reporte> {
  const sesion = sesionEtl();
  const reporte = new Reporte();

  console.log('ETL EsMa F6-E6 — inicio');

  // Ventana temporal: el saldo del maquilero se DERIVA por suma (D3), así que lo excluido por la
  // ventana se condensa en UN asiento "Saldo inicial de migración" por maquilero (ver el TSDoc de
  // `loaders/esma-cargos.ts`). El prescan de F2 dice qué órdenes quedaron fuera POR LA VENTANA
  // (≠ origen inválido). Con ventana inactiva `saldoInicial` es undefined y nada cambia.
  const ventana = resolverVentana();
  console.log(`  ${describirVentana(ventana)}`);
  reporte.nota(describirVentana(ventana));
  let saldoInicial: SaldoInicialEsMa | undefined;
  if (ventana.corte !== null) {
    const prescan = prescanVentanaF2(ventana);
    saldoInicial = new SaldoInicialEsMa(ventana, prescan?.ordenesFuera ?? new Set<string>());
    reporte.nota(
      'EsMa (ventana activa): cargos de órdenes fuera de ventana + abonos/descuentos/pagos ' +
        'pre-corte se EXCLUYEN y su neto (D3: cargos validados + abonos − pagos − descuentos) se ' +
        'condensa en UN asiento "Saldo inicial de migración" (AbonoMaquilero) por maquilero con ' +
        'fecha = corte. El desglose por maquilero va en el reporte.',
    );
  }

  const cargos = await cargarCargosEsMa(sesion, cliente, reporte, saldoInicial);
  log('Cargos EsMa', cargos);

  const abonos = await cargarAbonosEsMa(sesion, cliente, reporte, ventana, saldoInicial);
  log('Abonos', abonos);

  const descuentos = await cargarDescuentosEsMa(sesion, cliente, reporte, ventana, saldoInicial);
  log('Descuentos', descuentos);

  const pagos = await cargarPagosEsMa(sesion, cliente, reporte, ventana, saldoInicial);
  log('Pagos', pagos);

  if (saldoInicial !== undefined) {
    const asientos = await crearAsientosSaldoInicialEsMa(sesion, cliente, reporte, saldoInicial);
    console.log(
      `  Saldo inicial          maquileros=${String(asientos.maquileros)} creados=${String(asientos.creados)} ` +
        `existentes=${String(asientos.existentes)} netoCero=${String(asientos.netoCero)}` +
        (asientos.discrepantes > 0 ? ` DISCREPANTES=${String(asientos.discrepantes)}` : ''),
    );
  }

  console.log('ETL EsMa F6-E6 — fin de carga');
  return reporte;
}

/** Punto de entrada del script. */
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('Falta DATABASE_URL (ver backend/.env.example)');
    process.exit(1);
  }
  // Mismos tiempos HOLGADOS y pool ESTABLE que los demás ETL (BD remota de prueba en Railway).
  const cliente = crearClientePrisma(url, {
    transactionOptions: { maxWait: 20_000, timeout: 120_000 },
    poolMax: 12,
    pool: {
      keepAlive: true,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 30_000,
    },
  });
  try {
    const reporte = await ejecutarEtlEsma(cliente);

    // Cuadre completo de F6 (Calidad + EsMa). Cálculo en runtime, nunca números a mano.
    const cuadre = formatearCuadreF6(await calcularCuadreF6(cliente));
    const textoReporte = reporte.aTexto();

    console.log('\n' + cuadre);
    console.log('\n' + textoReporte);

    const salida = join(
      process.cwd(),
      `reporte-etl-f6e6-esma-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`,
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
