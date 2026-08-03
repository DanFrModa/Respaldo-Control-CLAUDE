/**
 * Reporte de CUADRE COMPLETO de la fase F1 (E6 + E7).
 *
 * Extiende `cuadre.ts` (que cubre E6: catálogos/materiales) con los renglones de E7:
 * modelos, BOM (3 tipos) y fotos. Consolida en un solo informe todo lo de F1.
 *
 * Se puede correr SOLO con `npm run etl:cuadre-fase` (no carga nada; solo cuenta).
 *
 * Notas de cuadre:
 *  • Temporadas: fuente vacía → 0 modelos con temporada (decisión del dueño).
 *  • BOM: v1 = filas del CSV (parser real); v2 = filas en Postgres; la diferencia es por
 *    renglones sin mapeo de modelo/componente (ver reporte cualitativo de incidencias).
 *  • Fotos: v1 = archivos en directorio (si ETL_FOTOS_MOD_DIR/ETL_FOTOS_BOR_DIR están
 *    seteadas); v2 = registros ModeloFoto/Bordado.idArchivo no null en Postgres.
 *  • v1=0 en Fotos significa que el directorio no estaba disponible en la corrida de cuadre.
 */
import { existsSync, readdirSync } from 'node:fs';
import { extname } from 'node:path';
import { pathToFileURL } from 'node:url';

import { crearClientePrisma, type PrismaClient } from '../src/datos/index.js';

import { opcionesClienteEtl } from './comun/cliente-etl.js';

import { contarFilasCsv } from './comun/csv.js';
import { calcularCuadre, type RenglonCuadre } from './cuadre.js';

/** Extensiones de imagen reconocidas (para contar fotos en el directorio). */
const EXTENSIONES_IMAGEN = new Set(['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp']);

/** Cuenta archivos de imagen en un directorio (v1 de fotos). Devuelve 0 si no está seteado/existe. */
function contarFotosDirectorio(envVar: string): number {
  const dir = process.env[envVar]?.trim();
  if (!dir || !existsSync(dir)) {
    return 0;
  }
  try {
    return readdirSync(dir).filter((f) => EXTENSIONES_IMAGEN.has(extname(f).toLowerCase())).length;
  } catch {
    return 0;
  }
}

/** Calcula el cuadre COMPLETO de la fase F1 (E6 + E7). */
export async function calcularCuadreFase(cliente: PrismaClient): Promise<RenglonCuadre[]> {
  // Renglones de E6 (catálogos/materiales).
  const cuadreE6 = await calcularCuadre(cliente);

  // v1 — conteos de los CSV de E7 (parser real).
  const v1Modelos = contarFilasCsv('Modelos.csv');
  const v1BomTelas = contarFilasCsv('ModelosTela.csv');
  const v1BomAvios = contarFilasCsv('ModelosHab.csv');
  const v1BomBordados = contarFilasCsv('ModelosBor.csv');
  const v1FotosModelos = contarFotosDirectorio('ETL_FOTOS_MOD_DIR');
  const v1FotosBordados = contarFotosDirectorio('ETL_FOTOS_BOR_DIR');

  // v2 — conteos de Postgres.
  const [
    v2Modelos,
    v2ModelosActivos,
    v2BomTelas,
    v2BomAvios,
    v2BomBordados,
    v2FotosModelos,
    v2FotosBordadosTotal,
    v2FotosBordadosConFoto,
  ] = await Promise.all([
    cliente.modelo.count(),
    cliente.modelo.count({ where: { activo: true } }),
    cliente.modeloTela.count(),
    cliente.modeloAvio.count(),
    cliente.modeloBordado.count(),
    cliente.modeloFoto.count(),
    cliente.bordado.count(),
    cliente.bordado.count({ where: { idArchivoFoto: { not: null } } }),
  ]);

  const cuadreE7: RenglonCuadre[] = [
    {
      entidad: 'Modelos',
      v1: v1Modelos,
      v2: v2Modelos,
      nota: `v2 activos=${String(v2ModelosActivos)}; diferencia por códigos duplicados (ver reporte).`,
    },
    {
      entidad: 'BOM — telas (renglones)',
      v1: v1BomTelas,
      v2: v2BomTelas,
      nota: 'v2 < v1 por renglones sin mapeo de modelo o tela (ver reporte).',
    },
    {
      entidad: 'BOM — avíos (renglones)',
      v1: v1BomAvios,
      v2: v2BomAvios,
      nota: 'v2 < v1 por renglones sin mapeo de modelo o avío (ver reporte).',
    },
    {
      entidad: 'BOM — bordados (renglones)',
      v1: v1BomBordados,
      v2: v2BomBordados,
      nota: 'v2 < v1 por renglones IdModelos=0 o sin mapeo (ver reporte).',
    },
    {
      entidad: 'Fotos de modelos',
      v1: v1FotosModelos,
      v2: v2FotosModelos,
      nota:
        v1FotosModelos === 0
          ? 'v1=0: ETL_FOTOS_MOD_DIR no disponible en esta corrida.'
          : 'v2 ≤ v1 (solo se suben modelos migrados).',
    },
    {
      entidad: 'Fotos de bordados',
      v1: v1FotosBordados,
      v2: v2FotosBordadosConFoto,
      nota:
        v1FotosBordados === 0
          ? `v1=0: ETL_FOTOS_BOR_DIR no disponible en esta corrida. v2=${String(v2FotosBordadosConFoto)}/${String(v2FotosBordadosTotal)} bordados con foto.`
          : `v2=${String(v2FotosBordadosConFoto)}/${String(v2FotosBordadosTotal)} bordados con foto.`,
    },
  ];

  return [...cuadreE6, ...cuadreE7];
}

/** Da formato de tabla al cuadre completo de la fase F1. */
export function formatearCuadreFase(renglones: RenglonCuadre[]): string {
  const partes: string[] = [];
  partes.push('═══════════════════════════════════════════════════════════════');
  partes.push(' REPORTE DE CUADRE F1 (E6+E7) — v1 (CSV/carpeta) vs v2 (Postgres/R2)');
  partes.push('═══════════════════════════════════════════════════════════════');
  partes.push(`${'Entidad'.padEnd(34)}${'v1'.padStart(7)}${'v2'.padStart(7)}   Nota`);
  partes.push('─'.repeat(63));
  for (const r of renglones) {
    const v1 = r.v1 === 0 ? '  —' : String(r.v1);
    partes.push(`${r.entidad.padEnd(34)}${v1.padStart(7)}${String(r.v2).padStart(7)}   ${r.nota}`);
  }
  return partes.join('\n');
}

/** Punto de entrada del script `npm run etl:cuadre-fase` (solo cuenta). */
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('Falta DATABASE_URL (ver backend/.env.example)');
    process.exit(1);
  }
  const cliente = crearClientePrisma(url, opcionesClienteEtl());
  try {
    const cuadre = await calcularCuadreFase(cliente);
    console.log(formatearCuadreFase(cuadre));
  } finally {
    await cliente.$disconnect();
  }
}

const ejecutadoComoScript =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (ejecutadoComoScript) {
  await main();
}
