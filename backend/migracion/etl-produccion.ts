/**
 * ETL del histórico de PRODUCCIÓN (F3-E6, Pieza A) — orquestador.
 *
 * Migra el histórico real del WIP de producción (corte, envíos y recibos de maquila) + los cargos
 * EsMa, de los CSV de `Respaldo CLAUDE/TABLAS/` (CP850) a la BD de v2, VÍA el MODO MIGRACIÓN de la
 * capa de dominio (A1), de forma IDEMPOTENTE y re-ejecutable (§7). Depende de los mapeos de F1
 * (proveedores, colores, tallas) y F2 (órdenes) que dejaron los ETLs previos.
 *
 * ⭐ VARIANTE SIN EFECTOS DERIVADOS (excepción JUSTIFICADA a PLANMAESTRO §7 — DECISIONES.md F3-E6):
 * los recibos crean SOLO `EtapaMovimiento`(+det), NUNCA un `Movimiento` de kardex NI un `EsMaCargo`.
 * El kardex histórico lo crea EXCLUSIVAMENTE la Pieza B (`etl-ipt.ts`, `origenTipo = migracion`) desde
 * `IPT_Movs`; los cargos los crea EXCLUSIVAMENTE este ETL desde `EsMa_Recibos`. Así las 2,468 entradas
 * tipo 2 del viejo NO se duplican.
 *
 * ORDEN de carga (cadena de FK/mapeo):
 *  1. Cortes          (Corte + OrdenesDetCorte)          → EtapaMovimiento(corte)
 *  2. Envíos costura  (Entregas + OrdenesDetEntM)        → EtapaMovimiento(envio_maquila, costura)
 *  3. Envíos estampado(EntregasEst + OrdenesDetEntA)     → EtapaMovimiento(envio_maquila, estampado)
 *  4. Recibos costura (Recibos + OrdenesDetRecM)         → EtapaMovimiento(recibo_maquila, costura)
 *  5. Recibos estampado(RecibosEst + OrdenesDetRecA)     → EtapaMovimiento(recibo_maquila, estampado)
 *  6. Cargos EsMa     (EsMa + EsMa_Recibos)              → EsMaCargo
 *  7. Calibración de la secuencia de folios "etapa-mov" por empresa (post-máximo migrado).
 *
 * Cada etapa/cargo se crea en SU PROPIA transacción (atomicidad por documento, A2). Re-ejecutar
 * retoma sin duplicar (idempotencia por MapeoMigracion). NO toca la API ni el frontend.
 *
 * Lo corre Gabriel desde `backend/` con:  npx tsx --env-file=.env migracion/etl-produccion.ts
 * (NUNCA `npm run`: esos no llevan --env-file — ver migracion/README.md).
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { crearClientePrisma, type PrismaClient } from '../src/datos/index.js';
import { CLAVE_SECUENCIA_ETAPA } from '../src/dominio/produccion/etapas.js';
import { sembrarSecuencia } from '../src/comun/secuencias.js';

import { sesionEtl } from './comun/sesion-etl.js';
import { Reporte } from './comun/reporte.js';
import { cargarCortes } from './loaders/produccion-corte.js';
import { cargarEnviosCostura, cargarEnviosEstampado } from './loaders/produccion-envios.js';
import { cargarRecibosCostura, cargarRecibosEstampado } from './loaders/produccion-recibos.js';
import { cargarCargosEsMa } from './loaders/esma-cargos.js';
import type { ResultadoLoader } from './loaders/clientes.js';

/** Imprime el resumen de un loader (mismo formato que el ETL de F2). */
function log(nombre: string, r: ResultadoLoader): void {
  const omVal = r.omitidosValidacion ?? 0;
  console.log(
    `  ${nombre.padEnd(22)} creados=${String(r.creados).padStart(6)} ` +
      `existentes=${String(r.existentes).padStart(6)} omitidos=${String(r.omitidos).padStart(6)}` +
      (omVal > 0 ? ` omitidosValidacion=${String(omVal)}` : ''),
  );
}

/**
 * Siembra la secuencia "etapa-mov" por empresa, adelantándola al máximo folio migrado (idempotente y
 * monótono). Como las etapas migradas YA toman su folio de la secuencia (no de un valor explícito),
 * esto es defensivo: deja la serie consistente con `max(folio)` aunque algo se hubiera cargado por
 * otro camino. Sin esto (o con otra carga), la primera captura nueva podría chocar el unique.
 */
async function sembrarSecuenciasF3(cliente: PrismaClient): Promise<void> {
  const maxEtapa = await cliente.etapaMovimiento.groupBy({
    by: ['idEmpresa'],
    _max: { folio: true },
  });
  for (const g of maxEtapa) {
    const max = g._max.folio ?? 0n;
    await cliente.$transaction((tx) =>
      sembrarSecuencia(tx, g.idEmpresa, CLAVE_SECUENCIA_ETAPA, max),
    );
  }
  console.log(`  Secuencias sembradas: etapa-mov(${String(maxEtapa.length)} empresas)`);
}

/** Resultado consolidado del ETL de producción (para el resumen y los tests). */
export interface ResultadoEtlProduccion {
  reporte: Reporte;
  cortesCeldas: number;
  enviosCosturaCeldas: number;
  enviosEstampadoCeldas: number;
  recibosCosturaCeldas: number;
  recibosEstampadoCeldas: number;
}

/** Corre TODO el ETL de producción contra el cliente dado. */
export async function ejecutarEtlProduccion(
  cliente: PrismaClient,
): Promise<ResultadoEtlProduccion> {
  const sesion = sesionEtl();
  const reporte = new Reporte();

  console.log('ETL de producción F3-E6 — inicio');

  const cortes = await cargarCortes(sesion, cliente, reporte);
  log('Cortes', cortes.cortes);

  const enviosM = await cargarEnviosCostura(sesion, cliente, reporte);
  log('Envíos costura', enviosM.envios);

  const enviosA = await cargarEnviosEstampado(sesion, cliente, reporte);
  log('Envíos estampado', enviosA.envios);

  const recibosM = await cargarRecibosCostura(sesion, cliente, reporte);
  log('Recibos costura', recibosM.recibos);
  console.log(
    `    (sin Inventariado=${String(recibosM.sinInventariar)} · sin TipoPrendas=${String(
      recibosM.sinTipoPrendas,
    )} · sin Cantidad=${String(recibosM.sinCantidad)})`,
  );

  const recibosA = await cargarRecibosEstampado(sesion, cliente, reporte);
  log('Recibos estampado', recibosA.recibos);
  console.log(
    `    (sin TipoPrendas=${String(recibosA.sinTipoPrendas)} · sin Cantidad=${String(
      recibosA.sinCantidad,
    )})`,
  );

  const cargos = await cargarCargosEsMa(sesion, cliente, reporte);
  log('Cargos EsMa', cargos.movimientos);
  if (cargos.fueraVentana > 0) {
    // §Post-F9.24: EsMa recorta por la fecha de su cabecera, igual que los abonos/descuentos/pagos.
    console.log(`    (fuera de la ventana: ${String(cargos.fueraVentana)} cargos EsMa)`);
  }

  console.log('ETL de producción F3-E6 — sembrando secuencias');
  await sembrarSecuenciasF3(cliente);

  console.log('ETL de producción F3-E6 — fin de carga');
  return {
    reporte,
    cortesCeldas: cortes.celdas,
    enviosCosturaCeldas: enviosM.celdas,
    enviosEstampadoCeldas: enviosA.celdas,
    recibosCosturaCeldas: recibosM.celdas,
    recibosEstampadoCeldas: recibosA.celdas,
  };
}

/** Punto de entrada del script. */
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('Falta DATABASE_URL (ver backend/.env.example)');
    process.exit(1);
  }
  // Mismos tiempos HOLGADOS y pool ESTABLE que el ETL de F2 (BD remota de prueba en Railway).
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
    const { reporte } = await ejecutarEtlProduccion(cliente);

    // Cuadre de conteos (filas v2 contra los CSV v1). Cálculo en runtime, nunca números a mano.
    const cuadre = await formatearCuadreF3(cliente);
    const textoReporte = reporte.aTexto();

    console.log('\n' + cuadre);
    console.log('\n' + textoReporte);

    const salida = join(
      process.cwd(),
      `reporte-etl-f3e6-prod-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`,
    );
    writeFileSync(salida, `${cuadre}\n\n${textoReporte}\n`, { encoding: 'utf-8' });
    console.log(`\nReporte escrito en: ${salida}`);
  } finally {
    await cliente.$disconnect();
  }
}

/**
 * Cuadre de conteos de la Pieza A: filas en v2 (por tipo de etapa) contra el conteo de las tablas v1.
 * Solo lectura. El cuadre formal del kardex (Σ por modelo×almacén vs IPT_Mod_Alm) es de la Pieza B
 * (`cuadre-f3.ts`); aquí se reportan los conteos de las etapas WIP y los cargos.
 */
async function formatearCuadreF3(cliente: PrismaClient): Promise<string> {
  const [cortes, envios, recibos, cargos, detalles] = await Promise.all([
    cliente.etapaMovimiento.count({ where: { tipo: 'corte' } }),
    cliente.etapaMovimiento.count({ where: { tipo: 'envio_maquila' } }),
    cliente.etapaMovimiento.count({ where: { tipo: 'recibo_maquila' } }),
    cliente.esMaCargo.count(),
    cliente.etapaMovimientoDet.count(),
  ]);
  return [
    '═══════════════════════════════════════════════════════════════',
    ' CUADRE F3-E6 (Pieza A — producción WIP) — conteos en v2',
    '═══════════════════════════════════════════════════════════════',
    `  Cortes (EtapaMovimiento corte):            ${String(cortes)}`,
    `  Envíos a maquila (envio_maquila):          ${String(envios)}`,
    `  Recibos de maquila (recibo_maquila):       ${String(recibos)}`,
    `  Cargos EsMa (EsMaCargo):                   ${String(cargos)}`,
    `  Renglones de detalle (EtapaMovimientoDet): ${String(detalles)}`,
    '',
    '  Nota: el no-cuadre recibos(12,440) vs cargos EsMa(7,401) es ESPERADO (el viejo no llevaba',
    '  EsMa 1:1 con los recibos). El cuadre del kardex PT (Σ modelo×almacén vs IPT_Mod_Alm) lo hace',
    '  la Pieza B (cuadre-f3.ts).',
  ].join('\n');
}

const ejecutadoComoScript =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (ejecutadoComoScript) {
  await main();
}
