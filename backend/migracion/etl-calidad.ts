/**
 * ETL del histórico de CALIDAD (F6-E6, Pieza A) — orquestador.
 *
 * Migra el catálogo de defectos y las auditorías de control de calidad del sistema viejo (CP850) a
 * la BD de v2, VÍA los servicios de dominio (A1: `crearDefecto` + el modo migración
 * `crearAuditoriaMigrada`), de forma IDEMPOTENTE, re-ejecutable y por LOTES (§7). Depende de los
 * mapeos de F1 (proveedores → 'Proveedor:IdMaquileros') y F2 (órdenes → 'Orden') que dejaron los
 * ETLs previos.
 *
 * ORDEN de carga (la cadena de FK/mapeo importa):
 *  1. CC_Catalogo                       → DefectoCatalogo      (mapea IdCC_Catalogo)
 *  2. CC_Auditorias + CC_AuditoriasDet  → Auditoria + AuditoriaDefecto (usa 'Orden', 'DefectoCatalogo',
 *                                          'Proveedor:IdMaquileros'; despivota el detalle)
 *  3. Recalibra la secuencia "auditoria" por empresa (post-máximo folio migrado, A3).
 *
 * ⭐ SIN efecto de RC: las auditorías migradas NO encolan eventos de auto-avance (ver
 * `crearAuditoriaMigrada`). Cada auditoría se crea en SU PROPIA transacción (A2). NO toca la API ni
 * el frontend.
 *
 * Lo corre Gabriel desde `backend/` con:  npx tsx --env-file=.env migracion/etl-calidad.ts
 * (NUNCA `npm run`: esos no llevan --env-file — ver migracion/README.md).
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { crearClientePrisma, type PrismaClient } from '../src/datos/index.js';
import { CLAVE_SECUENCIA_AUDITORIA } from '../src/dominio/calidad/auditorias.js';
import { sembrarSecuencia } from '../src/comun/secuencias.js';

import { contarFilasCsv } from './comun/csv.js';
import { sesionEtl } from './comun/sesion-etl.js';
import { Reporte } from './comun/reporte.js';
import { describirVentana, resolverVentana } from './comun/ventana.js';
import { cargarDefectos } from './loaders/calidad-defectos.js';
import { cargarAuditorias } from './loaders/calidad-auditorias.js';
import type { ResultadoLoader } from './loaders/clientes.js';

/** Imprime el resumen de un loader (mismo formato que los otros ETL). */
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

/**
 * Recalibra la secuencia "auditoria" por empresa, ADELANTÁNDOLA al máximo `numAuditoria` migrado de
 * cada una (idempotente y monótono: nunca retrocede). Como las auditorías migradas PRESERVAN su
 * folio (valor explícito, sin `siguienteFolio`), sin esto la primera captura nueva chocaría contra
 * el `@@unique(idEmpresa, numAuditoria)`.
 */
async function recalibrarSecuencias(cliente: PrismaClient): Promise<void> {
  const maxPorEmpresa = await cliente.auditoria.groupBy({
    by: ['idEmpresa'],
    _max: { numAuditoria: true },
  });
  for (const g of maxPorEmpresa) {
    const max = g._max.numAuditoria ?? 0n;
    await cliente.$transaction((tx) =>
      sembrarSecuencia(tx, g.idEmpresa, CLAVE_SECUENCIA_AUDITORIA, max),
    );
  }
  console.log(`  Secuencias recalibradas: auditoria(${String(maxPorEmpresa.length)} empresas)`);
}

/** Corre TODO el ETL de calidad contra el cliente dado. Devuelve el reporte de incidencias. */
export async function ejecutarEtlCalidad(cliente: PrismaClient): Promise<Reporte> {
  const sesion = sesionEtl();
  const reporte = new Reporte();

  console.log('ETL de calidad F6-E6 — inicio');
  // Ventana temporal: el CATÁLOGO de defectos migra SIEMPRE completo (es catálogo, no histórico).
  // Las auditorías siguen a su orden mapeada (cascada) Y a su fecha propia (`dentroVentana`).
  const ventana = resolverVentana();
  console.log(`  ${describirVentana(ventana)}`);
  reporte.nota(describirVentana(ventana));
  if (ventana.corte !== null) {
    reporte.nota(
      'Calidad: el catálogo de defectos migra COMPLETO (la ventana no le aplica). Las auditorías ' +
        'excluidas (orden no migrada o fecha fuera de ventana) van en buckets agregados, con su ' +
        'detalle en cascada.',
    );
  }

  const defectos = await cargarDefectos(sesion, cliente, reporte);
  log('Defectos', defectos);

  const auditorias = await cargarAuditorias(sesion, cliente, reporte, ventana);
  log('Auditorías', auditorias.auditorias);
  console.log(
    `    (detalle: creados=${String(auditorias.detallesCreados)} mapeados=${String(
      auditorias.detallesMapeados,
    )} omitidos=${String(auditorias.detallesOmitidos)} · fuera de ventana=${String(
      auditorias.detallesFueraVentana,
    )} · maquilero sin mapeo=${String(auditorias.maquileroSinMapeo)})`,
  );

  console.log('ETL de calidad F6-E6 — recalibrando secuencias');
  await recalibrarSecuencias(cliente);

  console.log('ETL de calidad F6-E6 — fin de carga');
  return reporte;
}

/**
 * Cuadre de conteos de la Pieza A (Calidad): filas en v2 contra el conteo de las tablas v1 (con el
 * parser real, NUNCA a mano ni `split('\n')` — el detalle trae saltos embebidos). Solo lectura.
 */
async function formatearConteos(cliente: PrismaClient): Promise<string> {
  const [defectosV2, auditoriasV2, detalleV2, canceladasV2] = await Promise.all([
    cliente.defectoCatalogo.count(),
    cliente.auditoria.count(),
    cliente.auditoriaDefecto.count(),
    cliente.auditoria.count({ where: { cancelada: true } }),
  ]);
  const defectosV1 = contarFilasCsv('CC_Catalogo.csv');
  const auditoriasV1 = contarFilasCsv('CC_Auditorias.csv');
  const detalleV1 = contarFilasCsv('CC_AuditoriasDet.csv');
  return [
    '═══════════════════════════════════════════════════════════════',
    ' CUADRE F6-E6 (Pieza A — calidad) — v1 (CSV) vs v2 (Postgres)',
    '═══════════════════════════════════════════════════════════════',
    `  ${describirVentana(resolverVentana())}`,
    `  Defectos (DefectoCatalogo):     v1=${String(defectosV1).padStart(6)}  v2=${String(defectosV2).padStart(6)}`,
    `  Auditorías (Auditoria):         v1=${String(auditoriasV1).padStart(6)}  v2=${String(auditoriasV2).padStart(6)}  (canceladas v2=${String(canceladasV2)})`,
    `  Detalle (AuditoriaDefecto):     v1=${String(detalleV1).padStart(6)}  v2=${String(detalleV2).padStart(6)}`,
    '',
    '  Nota: v2 ≤ v1 es ESPERADO — se OMITEN auditorías con orden sin mapeo y renglones de detalle',
    '  con defecto sin mapeo o de auditorías omitidas; además los pares (auditoría, defecto)',
    '  DUPLICADOS del viejo se FUSIONAN sumando fallas. Con la ventana temporal ACTIVA también se',
    '  EXCLUYEN las auditorías fuera de ventana (por orden o por fecha propia), con su detalle en',
    '  cascada. El desglose exacto va en el REPORTE.',
  ].join('\n');
}

/** Punto de entrada del script. */
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('Falta DATABASE_URL (ver backend/.env.example)');
    process.exit(1);
  }
  // Mismos tiempos HOLGADOS y pool ESTABLE que los otros ETL (BD remota de prueba en Railway).
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
    const reporte = await ejecutarEtlCalidad(cliente);

    const cuadre = await formatearConteos(cliente);
    const textoReporte = reporte.aTexto();

    console.log('\n' + cuadre);
    console.log('\n' + textoReporte);

    const salida = join(
      process.cwd(),
      `reporte-etl-f6e6-calidad-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`,
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
