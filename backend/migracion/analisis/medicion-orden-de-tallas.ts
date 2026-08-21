/**
 * MEDICIÓN de la ESCALA CANÓNICA del orden de tallas (V1-E3r, §Post-F9.81).
 *
 * `src/dominio/catalogos/orden-de-tallas.ts` afirma que *"la escala NO se inventó: se MIDIÓ"*, y
 * cita números concretos del volcado del Access. **Este script es esa medición.** Existe para que
 * la próxima vez las cifras se **RE-CORRAN en vez de RE-CITARSE**: en la ronda de corrección de
 * V1-E3r un reviewer independiente demostró que las cifras publicadas no se reproducían (y el
 * módulo se contradecía con su propia prueba: `2-3-3X` con 303 órdenes en uno y 252 en la otra).
 * Un número copiado a mano se pudre en silencio; uno que sale de un script se vuelve a sacar.
 *
 * ── METODOLOGÍA (la del ETL, no una inventada para el análisis) ────────────────────────────────
 *
 * Se mide con las MISMAS piezas que construyeron el catálogo real, para que el análisis y la carga
 * no puedan discrepar:
 *
 *  • `Ordenes.csv` leído en **CP850** con {@link leerCsv} (regla dura del ETL, ver `comun/csv.ts`).
 *  • Cada `Ordenes.Tallas` se parte con **{@link parsearTallasAnchoFijo}** — el parser de ancho
 *    fijo de 2 que usó `loaders/tallas.ts` para sembrar `Talla` y `CurvaTalla`.
 *  • Las cadenas que ese parser marca **`rara`** (dos curvas pegadas con `--`, salto de línea,
 *    longitud impar, vacías) **quedan FUERA del universo**, exactamente como el loader: no se
 *    cargaron nunca, así que no hay curva que ordenar. Se cuentan y se listan aparte.
 *  • Una **COMBINACIÓN** es la secuencia de etiquetas de una cadena no-rara, en su orden original,
 *    normalizada a MAYÚSCULAS (el catálogo `Talla` es único sin distinguir mayúsculas). Es
 *    justamente la `CurvaTalla` que el loader nombró `"Curva CH-M-G-EX"`.
 *  • ⚠️ Un separador de curva **suelto** (`-`, que no es `--`) NO vuelve rara a la cadena: queda
 *    como una etiqueta más, y la escala **no la reconoce** — cae en el cubo "no reconocida", que es
 *    lo honesto (una cadena con dos curvas pegadas no es una curva que se pueda ordenar).
 *
 * Con eso, cada combinación distinta cae en UNO de tres cubos:
 *
 *  1. **NO RECONOCIDA** — alguna etiqueta devuelve `null` en {@link deducirOrdenTalla} (data sucia
 *     del viejo: `UT`, `MC`, `M.`, `G'`…, o el separador suelto). La escala se abstiene.
 *  2. **MONÓTONA** — todas reconocidas y sus órdenes van **estrictamente crecientes**: la escala
 *     reproduce el orden que el capturista tecleó. Es el acierto.
 *  3. **DESORDENADA** — todas reconocidas pero la secuencia NO crece. Se sub-clasifica en las que
 *     traen una **talla repetida** (`EX-CH-M-G-EX`: no hay orden posible, la cadena está mal) y las
 *     que son **falla real de diseño** de la escala.
 *
 * ── CORRER ─────────────────────────────────────────────────────────────────────────────────────
 *
 *     npx tsx migracion/analisis/medicion-orden-de-tallas.ts          # desde backend/
 *     npx tsx migracion/analisis/medicion-orden-de-tallas.ts --json   # para diffear entre corridas
 *
 * ⚠️ El volcado `Respaldo CLAUDE/` **ya no vive en el árbol** (se sacó de `main`/`prueba` en el
 * commit `1398486`). Para re-correrlo hay que rescatarlo del historial y apuntar `TABLAS_DIR`:
 *
 *     mkdir -p /tmp/tablas
 *     git show '1398486^:Respaldo CLAUDE/TABLAS/Ordenes.csv' > /tmp/tablas/Ordenes.csv
 *     TABLAS_DIR=/tmp/tablas npx tsx migracion/analisis/medicion-orden-de-tallas.ts
 *
 * NO toca la base de datos: lee un CSV e imprime. Es seguro correrlo cuando sea.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { deducirOrdenTalla } from '../../src/dominio/catalogos/orden-de-tallas.js';
import { leerCsv } from '../comun/csv.js';
import { parsearTallasAnchoFijo } from '../comun/tallas.js';

/** En qué cubo cayó una combinación al pasarla por la escala. */
export type Veredicto = 'monotona' | 'noReconocida' | 'desordenada';

/** Una combinación DISTINTA de tallas del volcado, ya juzgada por la escala. */
export interface Combinacion {
  /** Etiquetas en MAYÚSCULAS, en el orden en que las tecleó el capturista. */
  etiquetas: string[];
  /** Clave legible (`"CH-M-G-EX"`), la misma que nombra la `CurvaTalla`. */
  clave: string;
  /** Cuántas ÓRDENES del volcado usan esta combinación. */
  ordenes: number;
  veredicto: Veredicto;
  /** Órdenes deducidos, posición por posición (`null` = la escala no la reconoce). */
  ordenesDeducidos: (number | null)[];
  /** Etiquetas que la escala NO reconoce (solo si `veredicto === 'noReconocida'`). */
  noReconocidas: string[];
  /** `true` si la combinación repite una etiqueta (no hay orden posible: la cadena está mal). */
  tallaRepetida: boolean;
  /** Familias que mezcla, y en qué sentido (ver {@link Mezcla}). */
  mezcla: Mezcla;
}

/**
 * Cómo convive una combinación con las DOS familias de la escala (números y letras):
 *  • `soloNumeros` / `soloLetras` — no mezcla.
 *  • `numeroLetra` — mezcla, y **todos** los números van antes que **todas** las letras.
 *  • `letraNumero` — mezcla, y las letras van antes que los números (el caso contrario).
 *  • `intercalada` — mezcla sin que una familia preceda limpiamente a la otra.
 *  • `sinDatos` — la escala no reconoce lo suficiente como para opinar.
 */
export type Mezcla =
  | 'soloNumeros'
  | 'soloLetras'
  | 'numeroLetra'
  | 'letraNumero'
  | 'intercalada'
  | 'sinDatos';

/** Una cadena `Tallas` que el parser del ETL marcó RARA (no se cargó nunca). */
export interface CadenaRara {
  original: string;
  ordenes: number;
}

/** El resultado completo de la medición. */
export interface MedicionOrdenTallas {
  /** Renglones de datos de `Ordenes.csv` (sin cabecera). */
  renglones: number;
  /** Renglones con `Tallas` no vacía. */
  conTallas: number;
  /** Cadenas RARAS: cuántas distintas y cuántas órdenes se llevan. */
  cadenasRarasDistintas: number;
  ordenesRaras: number;
  cadenasRaras: CadenaRara[];
  /** Universo de la medición = `conTallas` − `ordenesRaras`. */
  universo: number;
  /** Etiquetas distintas tal cual se tecleraron (sensible a mayúsculas). */
  etiquetasCrudas: number;
  /** Etiquetas distintas SIN distinguir mayúsculas = las filas `Talla` que sembró el ETL. */
  etiquetasCatalogo: number;
  /**
   * Combinaciones distintas contando la CAJA (`ch-m-g-eg` ≠ `CH-M-G-EG`). **No es el número
   * bueno**, pero se mide y se imprime a propósito: es la trampa que hizo publicar 164 donde el
   * catálogo real tiene {@link MedicionOrdenTallas.combinaciones}. El loader deduplica las curvas
   * con `mode: 'insensitive'`, así que las variantes de caja NO crearon curvas aparte.
   */
  combinacionesSensibleACaja: number;
  /** Todas las combinaciones distintas, ordenadas por # de órdenes desc. */
  combinaciones: Combinacion[];
  /** Resumen por cubo: combinaciones y órdenes. */
  monotonas: Recuento;
  noReconocidas: Recuento;
  desordenadas: Recuento;
  /** De las desordenadas, las que lo están por traer una talla REPETIDA. */
  desordenadasPorRepetida: Recuento;
  /** Porcentaje de órdenes del universo que la escala ordena bien. */
  porcentajeMonotono: number;
  /**
   * Mezcla número→letra y letra→número (el hallazgo 1 de la escala), sobre TODAS las
   * combinaciones: la evidencia de en qué orden tecleó el capturista las dos familias está en la
   * cadena aunque alguna etiqueta suelta esté sucia, así que no se descarta por eso.
   */
  numeroLetra: Recuento;
  letraNumero: Recuento;
  intercaladas: Recuento;
  /** Lo mismo, pero SOLO sobre las combinaciones que la escala reconoce entera (más estricto). */
  numeroLetraLimpias: Recuento;
  letraNumeroLimpias: Recuento;
}

/** Un par (combinaciones, órdenes) — la unidad en que se reportan todos los cubos. */
export interface Recuento {
  combinaciones: number;
  ordenes: number;
}

/** Suma un cubo de combinaciones a su par (combinaciones, órdenes). */
function contar(combinaciones: Combinacion[]): Recuento {
  return {
    combinaciones: combinaciones.length,
    ordenes: combinaciones.reduce((suma, c) => suma + c.ordenes, 0),
  };
}

/** Clasifica en qué sentido una combinación mezcla números y letras. */
function clasificarMezcla(ordenesDeducidos: (number | null)[]): Mezcla {
  const posNumeros: number[] = [];
  const posLetras: number[] = [];
  ordenesDeducidos.forEach((orden, i) => {
    if (orden === null) {
      return;
    }
    // El piso de las letras es 1000 (`BASE_LETRAS`): por debajo, todo es numérico.
    (orden >= 1000 ? posLetras : posNumeros).push(i);
  });

  if (posNumeros.length === 0 && posLetras.length === 0) {
    return 'sinDatos';
  }
  if (posLetras.length === 0) {
    return 'soloNumeros';
  }
  if (posNumeros.length === 0) {
    return 'soloLetras';
  }
  const ultimoNumero = Math.max(...posNumeros);
  const primeraLetra = Math.min(...posLetras);
  if (ultimoNumero < primeraLetra) {
    return 'numeroLetra';
  }
  const ultimaLetra = Math.max(...posLetras);
  const primerNumero = Math.min(...posNumeros);
  if (ultimaLetra < primerNumero) {
    return 'letraNumero';
  }
  return 'intercalada';
}

/** `true` si la secuencia de órdenes crece ESTRICTAMENTE (sin nulos). */
function esEstrictamenteCreciente(ordenes: (number | null)[]): boolean {
  for (let i = 1; i < ordenes.length; i += 1) {
    const previo = ordenes[i - 1];
    const actual = ordenes[i];
    if (previo === null || actual === null || actual <= previo) {
      return false;
    }
  }
  return true;
}

/** Corre la medición completa sobre `Ordenes.csv`. NO toca la base de datos. */
export function medirOrdenDeTallas(): MedicionOrdenTallas {
  const filas = leerCsv('Ordenes.csv');

  let conTallas = 0;
  const raras = new Map<string, number>();
  const porCombinacion = new Map<string, { etiquetas: string[]; ordenes: number }>();
  const clavesSensiblesACaja = new Set<string>();
  const etiquetasCrudas = new Set<string>();
  const etiquetasCatalogo = new Set<string>();

  for (const fila of filas) {
    const crudo = fila.Tallas ?? '';
    if (crudo.trim() === '') {
      continue;
    }
    conTallas += 1;

    const parsed = parsearTallasAnchoFijo(crudo);
    if (parsed.rara) {
      // Igual que el loader: se reporta y NO se carga. Fuera del universo.
      raras.set(parsed.original, (raras.get(parsed.original) ?? 0) + 1);
      continue;
    }

    const etiquetas = parsed.etiquetas.map((e) => e.toUpperCase());
    for (const cruda of parsed.etiquetas) {
      etiquetasCrudas.add(cruda);
    }
    for (const normal of etiquetas) {
      etiquetasCatalogo.add(normal);
    }

    clavesSensiblesACaja.add(parsed.etiquetas.join('-'));

    const clave = etiquetas.join('-');
    const previa = porCombinacion.get(clave);
    if (previa === undefined) {
      porCombinacion.set(clave, { etiquetas, ordenes: 1 });
    } else {
      previa.ordenes += 1;
    }
  }

  const combinaciones: Combinacion[] = [];
  for (const [clave, { etiquetas, ordenes }] of porCombinacion) {
    const ordenesDeducidos = etiquetas.map((e) => deducirOrdenTalla(e));
    const noReconocidas = etiquetas.filter((_, i) => ordenesDeducidos[i] === null);
    const tallaRepetida = new Set(etiquetas).size !== etiquetas.length;
    const veredicto: Veredicto =
      noReconocidas.length > 0
        ? 'noReconocida'
        : esEstrictamenteCreciente(ordenesDeducidos)
          ? 'monotona'
          : 'desordenada';
    combinaciones.push({
      etiquetas,
      clave,
      ordenes,
      veredicto,
      ordenesDeducidos,
      noReconocidas,
      tallaRepetida,
      mezcla: clasificarMezcla(ordenesDeducidos),
    });
  }
  combinaciones.sort((a, b) => b.ordenes - a.ordenes || a.clave.localeCompare(b.clave));

  const monotonas = combinaciones.filter((c) => c.veredicto === 'monotona');
  const noReconocidas = combinaciones.filter((c) => c.veredicto === 'noReconocida');
  const desordenadas = combinaciones.filter((c) => c.veredicto === 'desordenada');
  const ordenesRaras = [...raras.values()].reduce((s, n) => s + n, 0);
  const universo = conTallas - ordenesRaras;
  const recuentoMonotonas = contar(monotonas);

  return {
    renglones: filas.length,
    conTallas,
    cadenasRarasDistintas: raras.size,
    ordenesRaras,
    cadenasRaras: [...raras.entries()]
      .map(([original, ordenes]) => ({ original, ordenes }))
      .sort((a, b) => b.ordenes - a.ordenes || a.original.localeCompare(b.original)),
    universo,
    etiquetasCrudas: etiquetasCrudas.size,
    etiquetasCatalogo: etiquetasCatalogo.size,
    combinacionesSensibleACaja: clavesSensiblesACaja.size,
    combinaciones,
    monotonas: recuentoMonotonas,
    noReconocidas: contar(noReconocidas),
    desordenadas: contar(desordenadas),
    desordenadasPorRepetida: contar(desordenadas.filter((c) => c.tallaRepetida)),
    porcentajeMonotono: universo === 0 ? 0 : (recuentoMonotonas.ordenes / universo) * 100,
    numeroLetra: contar(combinaciones.filter((c) => c.mezcla === 'numeroLetra')),
    letraNumero: contar(combinaciones.filter((c) => c.mezcla === 'letraNumero')),
    intercaladas: contar(combinaciones.filter((c) => c.mezcla === 'intercalada')),
    numeroLetraLimpias: contar(
      combinaciones.filter((c) => c.mezcla === 'numeroLetra' && c.veredicto !== 'noReconocida'),
    ),
    letraNumeroLimpias: contar(
      combinaciones.filter((c) => c.mezcla === 'letraNumero' && c.veredicto !== 'noReconocida'),
    ),
  };
}

/**
 * Combinaciones y etiquetas que la DOCUMENTACIÓN cita con un número concreto (el TSDoc de
 * `orden-de-tallas.ts`, sus pruebas, la ficha de V1-E3r y el historial de versiones). El reporte
 * imprime el conteo medido de cada una para que **cotejar lo publicado sea leer una tabla**, no
 * volver a analizar. Si se cita una cifra nueva en algún documento, se agrega aquí.
 */
const CITADAS: readonly string[] = [
  'CH-M-G-EX',
  'XC-CH-M-G-XG',
  'EC-CH-M-G-EX',
  '2-3-3X',
  'CH-M-G-EX-2X-3X',
  '3M-6M-9M-12-18-2A-3A',
  'CH-M-G-EX-38-42',
  '12-14-16-CH-M-G-EX-2X',
  '4-6-8-10-12-14-16-18',
  '0X-1X-2X-3X',
  'XL-1X-2X-3X',
  'XC-CH-M-G-XG-2G',
  '2C-XC-CH-M-G-EX-2X-3X',
  '12-14-16-X',
];

/** Etiquetas sueltas cuyo total de órdenes cita la documentación. */
const ETIQUETAS_CITADAS: readonly string[] = ['EX', '3X'];

/** Da formato legible a la medición (consola/archivo). */
export function formatearMedicion(m: MedicionOrdenTallas): string {
  const p: string[] = [];
  const pct = (n: number): string => `${n.toFixed(1)} %`;
  const par = (r: Recuento): string =>
    `${String(r.combinaciones)} combinaciones / ${String(r.ordenes)} órdenes`;

  p.push('═══════════════════════════════════════════════════════════════════════');
  p.push(' MEDICIÓN DE LA ESCALA DE ORDEN DE TALLAS (V1-E3r, §Post-F9.81)');
  p.push(' Fuente: Ordenes.csv (CP850) · parser del ETL (parsearTallasAnchoFijo)');
  p.push('═══════════════════════════════════════════════════════════════════════');
  p.push('');
  p.push('── EL VOLCADO ──');
  p.push(`  Renglones de datos:              ${String(m.renglones)}`);
  p.push(`  Con columna Tallas no vacía:     ${String(m.conTallas)}`);
  p.push(
    `  Cadenas RARAS (fuera, no cargadas): ${String(m.cadenasRarasDistintas)} distintas / ` +
      `${String(m.ordenesRaras)} órdenes`,
  );
  p.push(`  UNIVERSO de la medición:         ${String(m.universo)} órdenes`);
  p.push(`  Etiquetas distintas (tal cual):  ${String(m.etiquetasCrudas)}`);
  p.push(`  Etiquetas distintas (catálogo):  ${String(m.etiquetasCatalogo)}  ← filas Talla`);
  p.push(`  COMBINACIONES distintas:         ${String(m.combinaciones.length)}`);
  p.push(
    `     (contando la caja serían ${String(m.combinacionesSensibleACaja)}, pero el loader ` +
      'deduplica insensitive: NO son curvas aparte)',
  );
  p.push('');
  p.push('── VEREDICTO DE LA ESCALA ──');
  p.push(`  MONÓTONAS:      ${par(m.monotonas)}  = ${pct(m.porcentajeMonotono)} del universo`);
  p.push(`  NO RECONOCIDAS: ${par(m.noReconocidas)}`);
  p.push(`  DESORDENADAS:   ${par(m.desordenadas)}`);
  p.push(`     · por talla repetida: ${par(m.desordenadasPorRepetida)}`);
  p.push('');
  p.push('── HALLAZGO 1: ¿números antes o después de las letras? ──');
  p.push(`  número → letra: ${par(m.numeroLetra)}`);
  p.push(`  letra → número: ${par(m.letraNumero)}`);
  p.push(`  intercaladas:   ${par(m.intercaladas)}`);
  p.push('  (solo combinaciones que la escala reconoce ENTERAS:)');
  p.push(`     número → letra: ${par(m.numeroLetraLimpias)}`);
  p.push(`     letra → número: ${par(m.letraNumeroLimpias)}`);
  p.push('');
  p.push('── LAS DESORDENADAS, UNA POR UNA ──');
  for (const c of m.combinaciones.filter((x) => x.veredicto === 'desordenada')) {
    p.push(
      `  ${String(c.ordenes).padStart(4)} órdenes  ${c.clave}` +
        `  → [${c.ordenesDeducidos.join(', ')}]` +
        (c.tallaRepetida ? '  ⚠ TALLA REPETIDA' : '  ⚠ falla de diseño'),
    );
  }
  p.push('');
  p.push('── LAS NO RECONOCIDAS, UNA POR UNA ──');
  for (const c of m.combinaciones.filter((x) => x.veredicto === 'noReconocida')) {
    p.push(
      `  ${String(c.ordenes).padStart(4)} órdenes  ${c.clave}` +
        `  → no reconoce: ${c.noReconocidas.join(', ')}`,
    );
  }
  p.push('');
  p.push('── CADENAS RARAS (el parser del ETL no las alinea; nunca se cargaron) ──');
  for (const r of m.cadenasRaras) {
    p.push(`  ${String(r.ordenes).padStart(4)} órdenes  "${r.original}"`);
  }
  p.push('');
  p.push('── CIFRAS CITADAS EN LA DOCUMENTACIÓN (cotejar aquí) ──');
  for (const clave of CITADAS) {
    const c = m.combinaciones.find((x) => x.clave === clave);
    p.push(
      `  ${clave.padEnd(24)} ${c === undefined ? 'NO EXISTE en el volcado' : `${String(c.ordenes)} órdenes  (${c.veredicto})`}`,
    );
  }
  for (const etiqueta of ETIQUETAS_CITADAS) {
    const ordenes = m.combinaciones
      .filter((c) => c.etiquetas.includes(etiqueta))
      .reduce((s, c) => s + c.ordenes, 0);
    const soloLetras = m.combinaciones
      .filter((c) => c.etiquetas.includes(etiqueta) && c.mezcla === 'soloLetras')
      .reduce((s, c) => s + c.ordenes, 0);
    p.push(
      `  etiqueta ${etiqueta.padEnd(15)} ${String(ordenes)} órdenes en total ` +
        `(${String(soloLetras)} en curvas de puras letras)`,
    );
  }
  p.push('');
  p.push('── TODAS LAS COMBINACIONES (órdenes desc) ──');
  for (const c of m.combinaciones) {
    p.push(`  ${String(c.ordenes).padStart(4)}  ${c.veredicto.padEnd(13)} ${c.clave}`);
  }
  return p.join('\n');
}

/** Punto de entrada del script. */
function main(): void {
  const m = medirOrdenDeTallas();
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(m, null, 2));
    return;
  }
  const texto = formatearMedicion(m);
  console.log(texto);
  const salida = join(
    process.cwd(),
    `medicion-orden-de-tallas-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`,
  );
  writeFileSync(salida, `${texto}\n`, { encoding: 'utf-8' });
  console.log(`\nMedición escrita en: ${salida}`);
}

const ejecutadoComoScript =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (ejecutadoComoScript) {
  main();
}
