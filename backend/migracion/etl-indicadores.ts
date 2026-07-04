/**
 * ETL del histórico de INDICADORES (F7-E6) — orquestador.
 *
 * Migra el módulo de Indicadores del sistema viejo (CP850) a v2, VÍA los servicios de dominio de
 * F7-E4/E5 (A1), IDEMPOTENTE (por `MapeoMigracion`) y por LOTES. Cinco piezas + el cíclico histórico:
 *
 *   1. Catálogos: IP_Personal → PersonalArea (ip) · IP_Actividades → ActividadProductividad (ip) ·
 *      Alm_Prd_Act → ActividadProductividad (almacen).
 *   2. Productividad IP: IP_Productiv → RegistroProductividad (ip).
 *   3. Productividad Almacén: Alm_Prd × Alm_Prd_Det → RegistroProductividad (almacen).
 *   4. Baja suave de las personas de IP que el viejo tenía inactivas (DESPUÉS de la productividad,
 *      porque sus registros no se pueden capturar con la persona ya desactivada).
 *   5. Fichas confiables: IP_InfConf → FichaVerificacion (despivota 8 columnas → 8 reactivos).
 *   6. Muestrarios: IP_MuesPend → Muestrario (con su ciclo de vida).
 *   7. Inventario cíclico histórico (Proscai, D6): Alm_InvCic → InventarioCiclico (CERRADO, sin ajuste).
 *
 * ORDEN (importa): catálogos ANTES que su productividad (mapeo de personas/actividades); la baja de
 * inactivos DESPUÉS de la productividad IP. Empresa (A9): los catálogos son GLOBALES; la productividad,
 * fichas (por la orden), muestrarios y cíclicos van a la empresa FAVORITA (el viejo no llevaba empresa
 * en estos módulos, salvo las fichas que la heredan de su orden).
 *
 * Lo corre Gabriel desde `backend/` con:  npx tsx --env-file=.env migracion/etl-indicadores.ts
 * (NUNCA `npm run`: esos no llevan --env-file — ver migracion/README.md).
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { crearClientePrisma, type PrismaClient } from '../src/datos/index.js';

import { Reporte } from './comun/reporte.js';
import { sesionEtl } from './comun/sesion-etl.js';
import {
  cargarActividadesAlmacen,
  cargarActividadesIp,
  cargarPersonalIp,
  desactivarPersonalInactivoIp,
} from './loaders/indicadores-catalogos.js';
import {
  cargarProductividadAlmacen,
  cargarProductividadIp,
} from './loaders/indicadores-productividad.js';
import { cargarFichas } from './loaders/indicadores-fichas.js';
import { cargarMuestrarios } from './loaders/indicadores-muestrarios.js';
import { cargarCiclicoHistorico } from './loaders/indicadores-ciclico.js';
import type { ResultadoLoader } from './loaders/clientes.js';
import { calcularCuadreF7, formatearCuadreF7 } from './cuadre-f7.js';

/** Imprime el resumen de un loader (mismo formato que los demás ETL). */
function log(nombre: string, r: ResultadoLoader): void {
  const omVal = r.omitidosValidacion ?? 0;
  console.log(
    `  ${nombre.padEnd(26)} creados=${String(r.creados).padStart(6)} ` +
      `existentes=${String(r.existentes).padStart(6)} omitidos=${String(r.omitidos).padStart(6)}` +
      (omVal > 0 ? ` omitidosValidacion=${String(omVal)}` : ''),
  );
}

/** Resuelve la empresa FAVORITA (o la primera) — a ella van los datos sin empresa del viejo. */
async function resolverEmpresaFavorita(cliente: PrismaClient): Promise<number> {
  const fav = await cliente.empresa.findFirst({ where: { favorita: true }, select: { id: true } });
  if (fav !== null) return fav.id;
  const cualquiera = await cliente.empresa.findFirst({
    select: { id: true },
    orderBy: { id: 'asc' },
  });
  if (cualquiera === null) throw new Error('No hay ninguna empresa para asignar los indicadores.');
  return cualquiera.id;
}

/** Corre TODO el ETL de indicadores contra el cliente dado. Devuelve el reporte de incidencias. */
export async function ejecutarEtlIndicadores(cliente: PrismaClient): Promise<Reporte> {
  const reporte = new Reporte();
  const idEmpresa = await resolverEmpresaFavorita(cliente);
  const sesionGlobal = sesionEtl(idEmpresa); // catálogos globales + productividad/muestrarios

  console.log('ETL Indicadores F7-E6 — inicio (empresa favorita id=' + String(idEmpresa) + ')');

  // 1. Catálogos (antes que su productividad).
  log('Personal IP', await cargarPersonalIp(sesionGlobal, cliente, reporte));
  log('Actividades IP', await cargarActividadesIp(sesionGlobal, cliente, reporte));
  log('Actividades Almacén', await cargarActividadesAlmacen(sesionGlobal, cliente, reporte));

  // 2-3. Productividad (con las personas aún ACTIVAS).
  log('Productividad IP', await cargarProductividadIp(sesionGlobal, cliente, reporte));
  log('Productividad Almacén', await cargarProductividadAlmacen(sesionGlobal, cliente, reporte));

  // 4. Baja suave de los inactivos (después de su productividad).
  const desactivadas = await desactivarPersonalInactivoIp(sesionGlobal, cliente, reporte);
  console.log(`  Personas IP desactivadas (baja suave): ${String(desactivadas)}`);

  // 5. Fichas (empresa por la orden, dentro del loader).
  log('Fichas confiables', await cargarFichas(cliente, reporte));

  // 6. Muestrarios.
  log('Muestrarios', await cargarMuestrarios(sesionGlobal, cliente, reporte));

  // 7. Cíclico histórico Proscai (D6).
  log('Cíclico histórico', await cargarCiclicoHistorico(cliente, reporte, idEmpresa));

  console.log('ETL Indicadores F7-E6 — fin de carga');
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
    const reporte = await ejecutarEtlIndicadores(cliente);
    const cuadre = formatearCuadreF7(await calcularCuadreF7(cliente));
    const textoReporte = reporte.aTexto();
    console.log('\n' + cuadre);
    console.log('\n' + textoReporte);

    const salida = join(
      process.cwd(),
      `reporte-etl-f7e6-indicadores-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`,
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
