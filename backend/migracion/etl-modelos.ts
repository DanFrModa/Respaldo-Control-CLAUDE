/**
 * ETL de MODELOS, BOM y FOTOS (F1-E7) — orquestador.
 *
 * Carga los modelos, su receta (BOM: telas/avíos), su ARTE y las fotos masivas del sistema
 * viejo (Access, CSV + archivos de imagen en directorio) a la BD y R2 de v2. Depende de los
 * MAPEOS producidos por E6 (`etl-catalogos`) — debe correr DESPUÉS de `npm run etl:catalogos`.
 *
 * Reglas: A1 (dominio), A2 (transacción), idempotente, sin null silencioso (§7), CP850.
 *
 * ORDEN de carga (respeta dependencias de FK/mapeo):
 *  1. Modelos   (`Modelos.csv`)   → persiste mapeo `Modelo` (IdModelos viejo → id nuevo).
 *  2. BOM telas (`ModelosTela.csv`) → consume mapeos `Modelo` + `Tela:IdTelasDis`.
 *  3. BOM avíos (`ModelosHab.csv`)  → consume mapeos `Modelo` + `Avio`.
 *  4. ARTE del modelo (`ModelosBor.csv` + `Bordados.csv`) → consume el mapeo `Modelo` (V1-E3d:
 *     el arte ya no sale de un catálogo, se crea DENTRO del modelo).
 *  5. Fotos de modelos (directorio `ETL_FOTOS_MOD_DIR`) → consume mapeo `Modelo`. Opcional.
 *  6. Fotos del arte (directorio `ETL_FOTOS_BOR_DIR`) → consume el mapeo `ModeloArte`. Opcional.
 *
 * Scripts npm:
 *  • `npm run etl:modelos`       — carga modelos + BOM + fotos (completo).
 *  • `npm run etl:fotos-modelos` — solo fotos de modelos (si ya corrió etl:modelos antes).
 *  • `npm run etl:fotos-arte`   — solo fotos del arte.
 *  • `npm run etl:cuadre-fase`   — solo el cuadre completo de la fase F1 (E6 + E7).
 *
 * Variables de entorno:
 *  • `DATABASE_URL`     — obligatoria.
 *  • `ETL_FOTOS_MOD_DIR` — ruta absoluta a la carpeta de fotos de modelos (~9,000 archivos).
 *    Si no está, las fotos de modelos se saltan con aviso.
 *  • `ETL_FOTOS_BOR_DIR` — ruta absoluta a la carpeta de fotos del arte (~2,686 archivos).
 *    Si no está, las fotos del arte se saltan con aviso.
 *  • `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` — obligatorias
 *    solo si alguna de las dos carpetas de fotos está configurada.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { crearClientePrisma, type PrismaClient } from '../src/datos/index.js';

import { calcularCuadreFase, formatearCuadreFase } from './cuadre-fase.js';
import { sesionEtl } from './comun/sesion-etl.js';
import { Reporte } from './comun/reporte.js';
import { cargarModelos } from './loaders/modelos.js';
import { cargarBom } from './loaders/bom-modelos.js';
import { cargarFotosModelos, cargarFotosArte } from './loaders/fotos-modelos.js';
import type { ResultadoLoader } from './loaders/clientes.js';

/** Imprime el resumen de un loader. */
function log(nombre: string, r: ResultadoLoader): void {
  const omVal = r.omitidosValidacion ?? 0;
  console.log(
    `  ${nombre.padEnd(26)} creados=${String(r.creados).padStart(6)} ` +
      `existentes=${String(r.existentes).padStart(6)} omitidos=${String(r.omitidos).padStart(6)}` +
      (omVal > 0 ? ` omitidosValidacion=${String(omVal)}` : ''),
  );
}

/** Corre el ETL de modelos + BOM + fotos contra el cliente dado. Devuelve el reporte. */
export async function ejecutarEtlModelos(cliente: PrismaClient): Promise<Reporte> {
  const sesion = sesionEtl();
  const reporte = new Reporte();

  console.log('ETL de modelos F1-E7 — inicio');
  console.log('  (Depende de los mapeos de E6 — asegúrate de haber corrido etl:catalogos)');

  // 1. Modelos
  const modelos = await cargarModelos(sesion, cliente, reporte);
  log('Modelos', modelos);

  // 2. BOM (telas, avíos) + ARTE del modelo
  const bom = await cargarBom(sesion, cliente, reporte);
  log('BOM — telas', bom.telas);
  log('BOM — avíos', bom.avios);
  log('Arte de modelos', bom.artes);
  if (bom.sinMapeo > 0) {
    console.log(`    (renglones BOM sin mapeo: ${String(bom.sinMapeo)} — ver reporte)`);
  }

  // 3. Fotos de modelos (opcional)
  const fotosModelos = await cargarFotosModelos(sesion, cliente, reporte);
  log('Fotos modelos', fotosModelos);

  // 4. Fotos del arte (opcional)
  const fotosArte = await cargarFotosArte(sesion, cliente, reporte);
  log('Fotos de arte', fotosArte);

  console.log('ETL de modelos F1-E7 — fin de carga');
  return reporte;
}

/** Punto de entrada del script `npm run etl:modelos`. */
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('Falta DATABASE_URL (ver backend/.env.example)');
    process.exit(1);
  }
  const cliente = crearClientePrisma(url, {
    transactionOptions: { maxWait: 20_000, timeout: 120_000 },
    poolMax: 12,
  });
  try {
    const reporte = await ejecutarEtlModelos(cliente);

    const cuadre = await calcularCuadreFase(cliente);
    const textoCuadre = formatearCuadreFase(cuadre);
    const textoReporte = reporte.aTexto();

    console.log('\n' + textoCuadre);
    console.log('\n' + textoReporte);

    const salida = join(
      process.cwd(),
      `reporte-etl-f1e7-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`,
    );
    writeFileSync(salida, `${textoCuadre}\n\n${textoReporte}\n`, { encoding: 'utf-8' });
    console.log(`\nReporte escrito en: ${salida}`);
  } finally {
    await cliente.$disconnect();
  }
}

/** Script solo-fotos-modelos: `npm run etl:fotos-modelos`. */
async function mainFotosModelos(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('Falta DATABASE_URL');
    process.exit(1);
  }
  const cliente = crearClientePrisma(url, {
    transactionOptions: { maxWait: 20_000, timeout: 120_000 },
    poolMax: 8,
  });
  try {
    const sesion = sesionEtl();
    const reporte = new Reporte();
    const resultado = await cargarFotosModelos(sesion, cliente, reporte);
    log('Fotos modelos', resultado);
    console.log(reporte.aTexto());
  } finally {
    await cliente.$disconnect();
  }
}

/** Script solo-fotos-arte: `npm run etl:fotos-arte`. */
async function mainFotosArte(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('Falta DATABASE_URL');
    process.exit(1);
  }
  const cliente = crearClientePrisma(url, {
    transactionOptions: { maxWait: 20_000, timeout: 120_000 },
    poolMax: 8,
  });
  try {
    const sesion = sesionEtl();
    const reporte = new Reporte();
    const resultado = await cargarFotosArte(sesion, cliente, reporte);
    log('Fotos de arte', resultado);
    console.log(reporte.aTexto());
  } finally {
    await cliente.$disconnect();
  }
}

const ejecutadoComoScript =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (ejecutadoComoScript) {
  const subcomando = process.argv[2];
  if (subcomando === '--fotos-modelos') {
    await mainFotosModelos();
  } else if (subcomando === '--fotos-arte') {
    await mainFotosArte();
  } else {
    await main();
  }
}
