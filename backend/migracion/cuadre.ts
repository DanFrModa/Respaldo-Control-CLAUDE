/**
 * Reporte de CUADRE de la migración (F1-E6).
 *
 * Compara, EN RUNTIME, los conteos del sistema viejo (v1, CSV leídos con el parser REAL) con
 * los de v2 (Postgres). NUNCA números a mano (§7). Para cada entidad, v1 es lo "esperable"
 * de la fuente y v2 es lo que quedó en la BD; el cuadre NO siempre es 1:1 (la unificación de
 * telas, la fusión de terceros, la limpieza de vacíos y la deduplicación de colores hacen que
 * v2 difiera de v1 a propósito) — por eso cada renglón lleva una NOTA explicativa, y las
 * diferencias inesperadas se cruzan con las incidencias del reporte cualitativo.
 *
 * Se puede correr SOLO el cuadre con `npm run etl:cuadre` (no carga nada; solo cuenta).
 */
import { pathToFileURL } from 'node:url';

import { crearClientePrisma, type PrismaClient } from '../src/datos/index.js';

import { opcionesClienteEtl } from './comun/cliente-etl.js';

import { contarFilasCsv } from './comun/csv.js';

/** Un renglón del cuadre: entidad, conteo viejo (v1), conteo nuevo (v2) y una nota. */
export interface RenglonCuadre {
  entidad: string;
  v1: number;
  v2: number;
  nota: string;
}

/**
 * Calcula el cuadre completo. v1 = filas de los CSV (parser real); v2 = `count` de Postgres.
 * Las notas explican por qué v1 y v2 pueden NO coincidir (es lo esperado en varias entidades).
 */
export async function calcularCuadre(cliente: PrismaClient): Promise<RenglonCuadre[]> {
  // v1 — conteos de los CSV (parser real, latin-1).
  const v1Empresas = contarFilasCsv('Empresas.csv');
  const v1Clientes = contarFilasCsv('Clientes.csv');
  const v1Etiquetas = contarFilasCsv('EtiquetasM.csv');
  const v1Generos = contarFilasCsv('IPT_Generos.csv');
  const v1Temporadas = contarFilasCsv('Temporadas.csv');
  const v1TelaCat = contarFilasCsv('TelasCategorias.csv');
  const v1Proveedores = contarFilasCsv('Proveedores.csv');
  const v1Cortadores = contarFilasCsv('Cortadores.csv');
  const v1Maquileros = contarFilasCsv('Maquileros.csv');
  const v1Estampadores = contarFilasCsv('Estampadores.csv');
  const v1IptAlm = contarFilasCsv('IPT_Almacenes.csv');
  const v1Almacenes = contarFilasCsv('Almacenes.csv');
  const v1Bordados = contarFilasCsv('Bordados.csv');
  const v1Habilitacion = contarFilasCsv('Habilitacion.csv');
  const v1Telas = contarFilasCsv('Telas.csv');
  const v1TelasDis = contarFilasCsv('TelasDis.csv');
  const v1TelasColores = contarFilasCsv('TelasColores.csv');
  const v1Ordenes = contarFilasCsv('Ordenes.csv');

  // v2 — conteos de Postgres.
  const [
    v2Empresas,
    v2Clientes,
    v2Etiquetas,
    v2Generos,
    v2Temporadas,
    v2TelaCat,
    v2Proveedores,
    v2Almacenes,
    v2Bordados,
    v2Avios,
    v2Colores,
    v2Telas,
    v2TelaColor,
    v2Tallas,
    v2Curvas,
  ] = await Promise.all([
    cliente.empresa.count(),
    cliente.cliente.count(),
    cliente.etiquetaMarca.count(),
    cliente.genero.count(),
    cliente.temporada.count(),
    cliente.telaCategoria.count(),
    cliente.proveedor.count(),
    cliente.almacen.count(),
    cliente.bordado.count(),
    cliente.avio.count(),
    cliente.color.count(),
    cliente.tela.count(),
    cliente.telaColor.count(),
    cliente.talla.count(),
    cliente.curvaTalla.count(),
  ]);

  const v1Terceros = v1Proveedores + v1Cortadores + v1Maquileros + v1Estampadores;

  return [
    {
      entidad: 'Empresas (activas)',
      v1: v1Empresas,
      v2: v2Empresas,
      nota: 'v1 incluye inactivas (no migradas); v2 = activas (FR Moda + Marilyn Fitness).',
    },
    { entidad: 'Clientes', v1: v1Clientes, v2: v2Clientes, nota: '≈ 1:1 (omite nombres vacíos).' },
    {
      entidad: 'Etiquetas de marca',
      v1: v1Etiquetas,
      v2: v2Etiquetas,
      nota: '≈ 1:1 (omite nombres vacíos).',
    },
    { entidad: 'Géneros', v1: v1Generos, v2: v2Generos, nota: 'v2 puede incluir los del seed E4.' },
    {
      entidad: 'Temporadas',
      v1: v1Temporadas,
      v2: v2Temporadas,
      nota: 'Fuente VACÍA — ver incidencia "Temporadas".',
    },
    {
      entidad: 'Tela-categorías',
      v1: v1TelaCat,
      v2: v2TelaCat,
      nota: 'v2 < v1 por la categoría de nombre vacío (limpiada).',
    },
    {
      entidad: 'Proveedores (terceros fusionados)',
      v1: v1Terceros,
      v2: v2Proveedores,
      nota:
        `v1 = Proveedores(${String(v1Proveedores)})+Cortadores(${String(v1Cortadores)})+` +
        `Maquileros(${String(v1Maquileros)})+Estampadores(${String(v1Estampadores)}); ` +
        'v2 < v1 por la FUSIÓN de homónimos (ver incidencias).',
    },
    {
      entidad: 'Almacenes (PT+Tela)',
      v1: v1IptAlm + v1Almacenes,
      v2: v2Almacenes,
      nota: `v1 = IPT(${String(v1IptAlm)}) + Almacenes(${String(v1Almacenes)}, solo activos migran).`,
    },
    {
      entidad: 'Bordados',
      v1: v1Bordados,
      v2: v2Bordados,
      nota: '≈ 1:1 (nombres duplicados desambiguados, no se pierden).',
    },
    {
      entidad: 'Avíos',
      v1: v1Habilitacion,
      v2: v2Avios,
      nota: '≈ 1:1 (omite claves vacías).',
    },
    {
      entidad: 'Colores (catálogo)',
      v1: 0,
      v2: v2Colores,
      nota: 'v1 N/A: el color es texto libre; v2 = colores únicos normalizados (ver incidencias A/B).',
    },
    {
      entidad: 'Telas (unificadas)',
      v1: v1Telas + v1TelasDis,
      v2: v2Telas,
      nota:
        `v1 = Telas(${String(v1Telas)}) + TelasDis(${String(v1TelasDis)}); v2 = unificadas ` +
        'por nombre (ver incidencias de unificación).',
    },
    {
      entidad: 'Telas-colores (renglones)',
      v1: v1TelasColores,
      v2: v2TelaColor,
      nota: 'v2 < v1 por renglones con IdTelas/color sin mapeo (ver incidencias).',
    },
    {
      entidad: 'Tallas (catálogo)',
      v1: 0,
      v2: v2Tallas,
      nota: `v1 N/A: derivadas de Ordenes.Tallas (${String(v1Ordenes)} órdenes); v2 = etiquetas únicas.`,
    },
    {
      entidad: 'Curvas de talla',
      v1: 0,
      v2: v2Curvas,
      nota: 'v1 N/A: combinaciones ORDENADAS distintas de Ordenes.Tallas (cadenas raras al reporte).',
    },
  ];
}

/** Da formato de tabla al cuadre (consola/archivo). */
export function formatearCuadre(renglones: RenglonCuadre[]): string {
  const partes: string[] = [];
  partes.push('═══════════════════════════════════════════════════════════════');
  partes.push(' REPORTE DE CUADRE F1-E6 — v1 (CSV, parser real) vs v2 (Postgres)');
  partes.push('═══════════════════════════════════════════════════════════════');
  partes.push(`${'Entidad'.padEnd(34)}${'v1'.padStart(7)}${'v2'.padStart(7)}   Nota`);
  partes.push('─'.repeat(63));
  for (const r of renglones) {
    const v1 = r.v1 === 0 ? '  —' : String(r.v1);
    partes.push(`${r.entidad.padEnd(34)}${v1.padStart(7)}${String(r.v2).padStart(7)}   ${r.nota}`);
  }
  return partes.join('\n');
}

/** Punto de entrada del script `npm run etl:cuadre` (solo cuenta; no carga nada). */
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('Falta DATABASE_URL (ver backend/.env.example)');
    process.exit(1);
  }
  const cliente = crearClientePrisma(url, opcionesClienteEtl());
  try {
    const cuadre = await calcularCuadre(cliente);
    console.log(formatearCuadre(cuadre));
  } finally {
    await cliente.$disconnect();
  }
}

const ejecutadoComoScript =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (ejecutadoComoScript) {
  await main();
}
