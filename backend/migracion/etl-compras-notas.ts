/**
 * ETL del histórico de COMPRAS + NOTAS de salida (F4-E6, Pieza A) — orquestador.
 *
 * Migra el histórico real de órdenes de compra (`OrdCompra`/`OrdCompraDet`/`OrdCom-Ord`) y notas de
 * salida (`Notas`/`NotasDet`) de los CSV de `Respaldo CLAUDE/TABLAS/` (CP850) a la BD de v2, VÍA el
 * MODO MIGRACIÓN de la capa de dominio (A1), de forma IDEMPOTENTE y re-ejecutable (§7). Depende de
 * los mapeos de F1 (empresas, proveedores/maquileros) y F2 (órdenes) que dejaron los ETLs previos.
 *
 * ⭐ SIN EFECTOS RETROACTIVOS (ficha F4-E6): ni las OC ni las notas legacy mueven el kardex. Las OC
 * NO crean `RecepcionCompra` (el viejo no liga entrada↔OC; las entradas legacy las migra la Pieza B
 * directo al kardex); las notas legacy son DOCUMENTO HISTÓRICO (solo las notas NUEVAS de v2 descuentan
 * avíos). Las líneas legacy quedan como TEXTO LIBRE (`descripcionLibre`/`descripcionLegacy`), sin
 * mapear a catálogo (R7 no cruza el histórico de líneas).
 *
 * ORDEN de carga (cadena de FK/mapeo):
 *  1. Órdenes de compra (OrdCompra + OrdCompraDet + OrdCom-Ord) → OrdenCompra/Linea/Orden(N:N)
 *  2. Notas de salida   (Notas + NotasDet)                      → NotaSalida/Linea
 *
 * Cada documento se crea en SU PROPIA transacción (atomicidad por documento, A2). Re-ejecutar
 * retoma sin duplicar (idempotencia por MapeoMigracion / unique por empresa+folio). NO toca la API.
 *
 * Lo corre Gabriel desde `backend/` con:  npx tsx --env-file=.env migracion/etl-compras-notas.ts
 * (NUNCA `npm run`: esos no llevan --env-file — ver migracion/README.md).
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { crearClientePrisma, type PrismaClient } from '../src/datos/index.js';

import { opcionesClienteEtl } from './comun/cliente-etl.js';

import { contarFilasCsv } from './comun/csv.js';
import { Reporte } from './comun/reporte.js';
import { sesionEtl } from './comun/sesion-etl.js';
import { describirVentana, resolverVentana, type ConfigVentana } from './comun/ventana.js';
import { cargarNotasSalida, type ResultadoNotasSalida } from './loaders/notas-salida.js';
import { cargarOrdenesCompra, type ResultadoOrdenesCompra } from './loaders/ordenes-compra.js';

/** Resultado consolidado del ETL (para el resumen y los tests). */
export interface ResultadoEtlComprasNotas {
  reporte: Reporte;
  ventana: ConfigVentana;
  ocs: ResultadoOrdenesCompra;
  notas: ResultadoNotasSalida;
}

/** Imprime el resumen de un loader. */
function log(
  nombre: string,
  r: { creados: number; existentes: number; omitidos: number; omitidosValidacion?: number },
  extra = '',
): void {
  const omVal = r.omitidosValidacion ?? 0;
  console.log(
    `  ${nombre.padEnd(22)} creados=${String(r.creados).padStart(6)} ` +
      `existentes=${String(r.existentes).padStart(6)} omitidos=${String(r.omitidos).padStart(6)}` +
      (omVal > 0 ? ` omitidosValidacion=${String(omVal)}` : '') +
      (extra !== '' ? ` ${extra}` : ''),
  );
}

/** Corre TODO el ETL de compras+notas contra el cliente dado. */
export async function ejecutarEtlComprasNotas(
  cliente: PrismaClient,
): Promise<ResultadoEtlComprasNotas> {
  const sesion = sesionEtl();
  const reporte = new Reporte();
  const ventana = resolverVentana();

  console.log('ETL de compras + notas F4-E6 (Pieza A) — inicio');
  console.log(`  ${describirVentana(ventana)}`);
  reporte.nota(describirVentana(ventana));

  const ocs = await cargarOrdenesCompra(sesion, cliente, reporte, ventana);
  log(
    'OrdenCompra',
    ocs.ocs,
    `(lineas=${String(ocs.lineas)} ligas=${String(ocs.ligas)} fueraVentana=${String(ocs.fueraVentana)})`,
  );

  const notas = await cargarNotasSalida(sesion, cliente, reporte, ventana);
  log(
    'NotaSalida',
    notas.notas,
    `(lineas=${String(notas.lineas)} fueraVentana=${String(notas.fueraVentana)})`,
  );

  console.log('ETL de compras + notas F4-E6 (Pieza A) — fin de carga');
  return { reporte, ventana, ocs, notas };
}

/**
 * Cuadre de conteos de la Pieza A: conteo FUENTE leído del CSV en esta corrida + conteo destino
 * migrado en v2 + lo excluido por la ventana temporal. Solo lectura; el cuadre de Gabriel es
 * reporte-vs-reporte entre corridas (no contra cifras a mano).
 */
async function formatearCuadreF4eA(
  cliente: PrismaClient,
  resultado: ResultadoEtlComprasNotas,
): Promise<string> {
  // Conteos FUENTE (CSV, parser real — NUNCA wc -l: los textos libres traen saltos embebidos).
  const v1OC = contarFilasCsv('OrdCompra.csv');
  const v1OCDet = contarFilasCsv('OrdCompraDet.csv');
  const v1OCOrd = contarFilasCsv('OrdCom-Ord.csv');
  const v1Notas = contarFilasCsv('Notas.csv');
  const v1NotasDet = contarFilasCsv('NotasDet.csv');

  // Conteos DESTINO (Postgres v2).
  const [v2OC, v2OCLinea, v2OCOrden, v2Notas, v2NotaLinea] = await Promise.all([
    cliente.ordenCompra.count(),
    cliente.ordenCompraLinea.count(),
    cliente.ordenCompraOrden.count(),
    cliente.notaSalida.count(),
    cliente.notaSalidaLinea.count(),
  ]);

  const { ocs, notas } = resultado;
  const lin = (n: number) => String(n).padStart(8);

  return [
    '═══════════════════════════════════════════════════════════════',
    ' CUADRE F4-E6 (Pieza A — compras + notas) — v1 (CSV) vs v2 (Postgres)',
    '═══════════════════════════════════════════════════════════════',
    `  ${describirVentana(resultado.ventana)}`,
    '',
    `${'Entidad'.padEnd(30)}${'v1(CSV)'.padStart(10)}${'v2(BD)'.padStart(10)}   Nota`,
    '─'.repeat(78),
    `${'OrdenCompra'.padEnd(30)}${lin(v1OC)}${lin(v2OC)}   ≈ empresas migradas; resto omitido (empresas viejas) o fuera de ventana.`,
    `${'OrdenCompraLinea'.padEnd(30)}${lin(v1OCDet)}${lin(v2OCLinea)}   texto libre (descripcionLibre); huérfanos/OC omitidas no cuentan.`,
    `${'OrdenCompraOrden (N:N)'.padEnd(30)}${lin(v1OCOrd)}${lin(v2OCOrden)}   v2 ≤ v1: ligas a órdenes sin mapeo se omiten (listadas).`,
    `${'NotaSalida'.padEnd(30)}${lin(v1Notas)}${lin(v2Notas)}   omite sin maquilero/orden mapeable o fuera de ventana.`,
    `${'NotaSalidaLinea'.padEnd(30)}${lin(v1NotasDet)}${lin(v2NotaLinea)}   texto libre (descripcionLegacy); orden sin mapeo se omite.`,
    '',
    '  Esta corrida:',
    `   OC creadas=${String(ocs.ocs.creados)} existentes=${String(ocs.ocs.existentes)} ` +
      `omitidas=${String(ocs.ocs.omitidos)} omitidasValidacion=${String(ocs.ocs.omitidosValidacion ?? 0)} ` +
      `fueraVentana=${String(ocs.fueraVentana)}`,
    `   Notas creadas=${String(notas.notas.creados)} existentes=${String(notas.notas.existentes)} ` +
      `omitidas=${String(notas.notas.omitidos)} omitidasValidacion=${String(notas.notas.omitidosValidacion ?? 0)} ` +
      `fueraVentana=${String(notas.fueraVentana)}`,
    '',
    '  Nota: las OC y notas legacy NO generan movimientos de kardex (documento histórico).',
    '  El kardex de telas (entradas/salidas/traspasos) lo migra la Pieza B (etl-telas).',
  ].join('\n');
}

/** Punto de entrada del script. */
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('Falta DATABASE_URL (ver backend/.env.example)');
    process.exit(1);
  }
  // Mismos tiempos HOLGADOS y pool ESTABLE que los ETL de F2/F3 (BD remota de prueba en Railway).
  const cliente = crearClientePrisma(url, opcionesClienteEtl());
  try {
    const resultado = await ejecutarEtlComprasNotas(cliente);

    const cuadre = await formatearCuadreF4eA(cliente, resultado);
    const textoReporte = resultado.reporte.aTexto();

    console.log('\n' + cuadre);
    console.log('\n' + textoReporte);

    const salida = join(
      process.cwd(),
      `reporte-etl-f4e6-compras-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`,
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
