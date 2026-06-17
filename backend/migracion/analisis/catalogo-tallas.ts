/**
 * ANÁLISIS read-only del catálogo de cadenas `Ordenes.Tallas` (F2-E5, PRIMER PASO).
 *
 * Extrae de `Ordenes.csv` TODAS las cadenas `Tallas` DISTINTAS con su frecuencia, las clasifica
 * con el parser POSICIONAL real (`parsearTallasOrden`) y vuelca:
 *   • el catálogo completo (cadena, frecuencia, # posiciones, # separadores, ambigua sí/no),
 *   • el resumen (cuántas distintas, cuántas ambiguas, cuántas vacías),
 *   • el set de TOKENS de talla únicos (insumo de los tests de parsing y del cruce con el catálogo).
 *
 * NO toca BD ni escribe a la BD. Lee CP850 con `leerCsv`. Es el insumo de:
 *   • los tests UNITARIOS de parsing (corren contra el catálogo COMPLETO, no una muestra),
 *   • la validación con Daniel (cadenas ambiguas/dudosas que decide él, §7).
 *
 * Correr:  npm run etl:analisis-tallas         (imprime a stdout + escribe un .txt con timestamp)
 *          npm run etl:analisis-tallas -- --json   (vuelca el catálogo como JSON, para snapshot de tests)
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { leerCsv } from '../comun/csv.js';
import { parsearTallasOrden } from '../comun/tallas-orden.js';

/** Una cadena distinta de `Tallas` con su análisis. */
export interface CadenaTalla {
  /** Cadena cruda original (tal cual del CSV, CP850 ya decodificado). */
  original: string;
  /** Cuántas órdenes traen exactamente esta cadena. */
  frecuencia: number;
  /** # de posiciones que son talla real (no separador, no vacío). */
  posiciones: number;
  /** # de posiciones marcadas como separador de doble curva ("-"/"--"/"- "). */
  separadores: number;
  /** `true` si el parser posicional la marcó ambigua (no alinea con confianza). */
  ambigua: boolean;
  /** Etiquetas de talla detectadas (en orden), para inspección. */
  etiquetas: string[];
}

/** Resultado del análisis (también consumible por tests). */
export interface AnalisisTallas {
  /** Catálogo completo de cadenas distintas, ordenado por frecuencia desc. */
  cadenas: CadenaTalla[];
  /** Total de órdenes leídas. */
  totalOrdenes: number;
  /** Órdenes con `Tallas` vacía. */
  ordenesVacias: number;
  /** # de cadenas distintas no vacías. */
  distintas: number;
  /** # de cadenas distintas marcadas ambiguas. */
  ambiguas: number;
  /** # de cadenas distintas con al menos un separador de doble curva. */
  conDobleCurva: number;
  /** Tokens de talla únicos detectados (insumo del cruce con el catálogo `Talla`). */
  tokensUnicos: string[];
}

/** Analiza `Ordenes.csv` y devuelve el catálogo completo de cadenas de talla. */
export function analizarCatalogoTallas(): AnalisisTallas {
  const filas = leerCsv('Ordenes.csv');
  const frecuencia = new Map<string, number>();
  let ordenesVacias = 0;

  for (const fila of filas) {
    const crudo = fila.Tallas ?? '';
    if (crudo.trim() === '') {
      ordenesVacias += 1;
      continue;
    }
    frecuencia.set(crudo, (frecuencia.get(crudo) ?? 0) + 1);
  }

  const tokensUnicos = new Set<string>();
  const cadenas: CadenaTalla[] = [];
  for (const [original, frec] of frecuencia) {
    const parsed = parsearTallasOrden(original);
    const tallas = parsed.posiciones.filter((p) => !p.separador && p.etiqueta !== '');
    const separadores = parsed.posiciones.filter((p) => p.separador).length;
    for (const t of tallas) {
      tokensUnicos.add(t.etiqueta);
    }
    cadenas.push({
      original,
      frecuencia: frec,
      posiciones: tallas.length,
      separadores,
      ambigua: parsed.ambigua,
      etiquetas: tallas.map((t) => t.etiqueta),
    });
  }

  cadenas.sort((a, b) => b.frecuencia - a.frecuencia || a.original.localeCompare(b.original));

  return {
    cadenas,
    totalOrdenes: filas.length,
    ordenesVacias,
    distintas: cadenas.length,
    ambiguas: cadenas.filter((c) => c.ambigua).length,
    conDobleCurva: cadenas.filter((c) => c.separadores > 0).length,
    tokensUnicos: [...tokensUnicos].sort(),
  };
}

/** Da formato legible al análisis (consola/archivo). */
export function formatearAnalisis(a: AnalisisTallas): string {
  const p: string[] = [];
  p.push('═══════════════════════════════════════════════════════════════');
  p.push(' ANÁLISIS DE Ordenes.Tallas (F2-E5) — catálogo completo de cadenas');
  p.push('═══════════════════════════════════════════════════════════════');
  p.push(`Órdenes leídas:           ${String(a.totalOrdenes)}`);
  p.push(`Órdenes con Tallas vacía: ${String(a.ordenesVacias)}`);
  p.push(`Cadenas DISTINTAS:        ${String(a.distintas)}`);
  p.push(`  · ambiguas (a Daniel):  ${String(a.ambiguas)}`);
  p.push(`  · con doble curva:      ${String(a.conDobleCurva)}`);
  p.push(`Tokens de talla únicos:   ${String(a.tokensUnicos.length)}`);
  p.push('');
  p.push(`TOKENS: ${a.tokensUnicos.join(' · ')}`);
  p.push('');
  p.push('── CADENAS AMBIGUAS / CON DOBLE CURVA (decisión de Daniel) ──');
  const dudosas = a.cadenas.filter((c) => c.ambigua || c.separadores > 0);
  for (const c of dudosas) {
    p.push(
      `  freq=${String(c.frecuencia).padStart(4)}  "${c.original}"  ` +
        `[pos=${String(c.posiciones)} sep=${String(c.separadores)} ${c.ambigua ? 'AMBIGUA' : ''}]  ` +
        `→ ${c.etiquetas.join(',')}`,
    );
  }
  p.push('');
  p.push('── CATÁLOGO COMPLETO (cadena · frecuencia · etiquetas) ──');
  for (const c of a.cadenas) {
    p.push(
      `  freq=${String(c.frecuencia).padStart(4)}  "${c.original}"  → ${c.etiquetas.join(',')}` +
        (c.separadores > 0 ? `  (sep=${String(c.separadores)})` : '') +
        (c.ambigua ? '  ⚠ AMBIGUA' : ''),
    );
  }
  return p.join('\n');
}

/** Punto de entrada del script. */
function main(): void {
  const a = analizarCatalogoTallas();
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(a, null, 2));
    return;
  }
  const texto = formatearAnalisis(a);
  console.log(texto);
  const salida = join(
    process.cwd(),
    `analisis-tallas-f2e5-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`,
  );
  writeFileSync(salida, `${texto}\n`, { encoding: 'utf-8' });
  console.log(`\nAnálisis escrito en: ${salida}`);
}

const ejecutadoComoScript =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (ejecutadoComoScript) {
  main();
}
