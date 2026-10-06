import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * ⭐⭐ 0.227 (§Post-F9.244, etapa 2) — EL GUARDIÁN DE LA POLÍTICA DE CERRADAS DE CADA LISTA DE ÓRDENES.
 *
 * Daniel: *«todas las pantallas donde sean de meter información, ya no deberían aparecer esas
 * órdenes»* + *«no quisiera que las órdenes sean invisibles: deberán poderse consultar todo lo que ha
 * pasado»*. Las dos mitades tiran en sentido contrario, así que el corte es **por ACCIÓN**: el
 * selector que alimenta una CAPTURA oculta las cerradas por omisión —con su interruptor «Mostrar
 * cerradas» y su aviso—; toda lista de CONSULTA (Centro de Órdenes, tableros, reportes, el MRP, el
 * costeo…) las sigue viendo.
 *
 * ⚠️ **Por qué hace falta un guardián.** Una pantalla nueva que ofrezca órdenes nace sin política si
 * nadie se acuerda — y las dos formas de equivocarse son caras: una captura que ofrece cerradas
 * invita a llenar un formulario que va a rebotar, y una consulta que las oculta esconde historia
 * (lo que Daniel prohibió). Por eso **todo archivo de `src/modulos` que pide un listado de órdenes
 * o usa un selector de orden tiene que DECLARAR aquí su política**:
 *  • `oculta`: es una captura ⇒ tiene que usar un selector que oculte (`SelectorOrden`,
 *    `SelectorOrdenPt`) o, si arma su propio desplegable, `useOrdenesDeCaptura` (o pedir
 *    `cerradas: 'ocultar'`) Y pintar `<InterruptorCerradas>`.
 *  • `no-aplica`, con su RAZÓN escrita: es consulta (o una excepción decidida) ⇒ **no puede**
 *    ocultar las cerradas.
 * Un archivo nuevo sin declarar, o uno declarado que ya no lista órdenes, rompe la prueba.
 *
 * ⚠️ **Su alcance, sin adornos.** Mira el TEXTO de los archivos, no su comportamiento: que el filtro
 * de verdad oculte, que el interruptor de verdad las traiga y que el aviso de verdad aparezca lo
 * prueban las pruebas de componente (`SelectorOrden.test.tsx`, las de Movimientos/Traspasos de PT y
 * las de los diálogos de OC y nota). Es una red, no una demostración.
 *
 * ⚠️ **Límite textual conocido (G3):** la detección busca el LITERAL `cerradas: … 'ocultar'`. Una
 * pantalla que lo escondiera tras una constante —`const MODO = 'ocultar'; … cerradas: MODO`— NO se
 * detecta, ni en una captura (que parecería no filtrar) ni en una consulta (que parecería no
 * ocultar). No se persigue con un análisis de código: se dice aquí para que nadie lo dé por cubierto.
 *
 * Vive en `tsconfig.node.json` (no en el proyecto de la app) porque lee archivos REALES del disco con
 * `node:fs`, igual que `aviso-orden-cerrada-guardian.test.ts`.
 */

/** Sube desde el cwd hasta toparse con `PLANMAESTRO.md`, el marcador estable de la raíz. */
function raizDelRepo(): string {
  let dir = process.cwd();
  for (let i = 0; i < 10; i += 1) {
    if (existsSync(join(dir, 'PLANMAESTRO.md'))) {
      return dir;
    }
    const padre = dirname(dir);
    if (padre === dir) {
      break;
    }
    dir = padre;
  }
  throw new Error('No se encontró la raíz del repo (PLANMAESTRO.md)');
}

const MODULOS = join(raizDelRepo(), 'frontend', 'src', 'modulos');

/** Todos los `.ts`/`.tsx` de un directorio que NO son pruebas. */
function fuentes(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entrada) => {
    const ruta = join(dir, entrada.name);
    if (entrada.isDirectory()) {
      return fuentes(ruta);
    }
    return /\.tsx?$/.test(entrada.name) && !/\.test\.tsx?$/.test(entrada.name) ? [ruta] : [];
  });
}

const leer = (rel: string): string => readFileSync(join(MODULOS, rel), 'utf8');

/** ¿El archivo pide un listado de órdenes de producción, o usa un selector de orden? */
const LISTA_ORDENES =
  /\b(?:useOrdenes|useConsultaOrdenes|useBuscarOrdenes|useOrdenesCentro|useOrdenesIncompletas|useOrdenesDeCaptura)\(|import\s*\{[^}]*\b(?:SelectorOrden|SelectorOrdenPt)\b[^}]*\}\s*from\s*'[^']+'/;
/** Usa un selector que YA oculta las cerradas (y lleva su interruptor y su aviso). */
const USA_SELECTOR_QUE_OCULTA =
  /import\s*\{[^}]*\b(?:SelectorOrden|SelectorOrdenPt)\b[^}]*\}\s*from\s*'[^']+'/;
/** Oculta las cerradas por su cuenta (pide `ocultar` al servidor o usa el hook de captura). */
const OCULTA_POR_SU_CUENTA = /cerradas:\s*[^,}\n]*'ocultar'|\buseOrdenesDeCaptura\(/;
/** Pinta el interruptor «Mostrar cerradas». */
const PINTA_INTERRUPTOR = /<InterruptorCerradas\b/;
/** Pinta el aviso de cerradas que coinciden y no se muestran. */
const PINTA_AVISO = /<AvisoCerradasOcultas\b/;

/**
 * Las PIEZAS que implementan la regla (no son pantallas): cada una se mide aparte, con lo que le
 * toca a ella. Ruta relativa a `frontend/src/modulos`.
 */
const PIEZAS = {
  /** El buscador de orden de las capturas: pide `ocultar`, con interruptor Y aviso. */
  selectorOrden: 'produccion/SelectorOrden.tsx',
  /** El desplegable de bucket de PT: oculta en cliente (lista completa), con interruptor Y aviso. */
  selectorOrdenPt: 'inventarios/SelectorOrdenPt.tsx',
  /** El hook de los `<select>` de OC y nota: pide `ocultar` salvo que el interruptor diga otra cosa. */
  ordenesDeCaptura: 'produccion/ordenes-de-captura.ts',
} as const;

type Politica = { tipo: 'oculta' } | { tipo: 'no-aplica'; razon: string };
const OCULTA: Politica = { tipo: 'oculta' };
const noAplica = (razon: string): Politica => ({ tipo: 'no-aplica', razon });

/**
 * ⭐ LA POLÍTICA DE CADA LISTA DE ÓRDENES (ruta relativa a `frontend/src/modulos`). Una lista nueva
 * se agrega aquí y se ve en el diff.
 */
const POLITICAS = new Map<string, Politica>([
  // ── (a) CAPTURAS: ocultan las cerradas por omisión, con interruptor y aviso ───────────────────
  ['produccion/EntregaClientePagina.tsx', OCULTA],
  ['inventarios/SalidaTelaColorOrdenPagina.tsx', OCULTA],
  ['calidad/AltaAuditoriaPagina.tsx', OCULTA],
  ['inventarios/MovimientosPtPagina.tsx', OCULTA],
  ['inventarios/TraspasosPtPagina.tsx', OCULTA],
  ['ordenes-compra/DialogoEditarOc.tsx', OCULTA],
  ['notas-salida/DialogoEditarNota.tsx', OCULTA],
  // ── (b) CONSULTA o excepción decidida: las cerradas se SIGUEN viendo ──────────────────────────
  [
    'ordenes/CentroOrdenesPagina.tsx',
    noAplica(
      'Centro de Órdenes: la consulta de toda orden; las capturas que abre (avance, receta, precios) ya se apagan con el aviso de la etapa 1.',
    ),
  ],
  [
    'ordenes-consulta/ConsultaOrdenesPagina.tsx',
    noAplica(
      'Consulta de órdenes: es historia; Daniel pidió que las cerradas no se vuelvan invisibles.',
    ),
  ],
  [
    'ordenes-consulta/OrdenesIncompletasPagina.tsx',
    noAplica('Tablero de incompletas: es consulta (requisitos de captura), no mueve nada.'),
  ],
  [
    'PaletaComandos.tsx',
    noAplica('Buscador global: lleva a la ficha de la orden, que es consulta.'),
  ],
  [
    'indicadores/FichasConfiablesPagina.tsx',
    noAplica('Indicadores: lectura de fichas de una orden; no captura sobre ella.'),
  ],
  [
    'costos/CosteoOrdenPagina.tsx',
    noAplica(
      'Costeo: la cerrada es justo la que se consulta (costo congelado); su edición ya se apaga por el cierre (0.061 + etapa 1).',
    ),
  ],
  [
    'ordenes-compra/ExplosionMaterialesPagina.tsx',
    noAplica(
      'MRP/explosión: FUERA de la regla por decisión de Daniel (§Post-F9.244(3)) — marca, no esconde.',
    ),
  ],
  [
    'ordenes-compra/EstatusMaterialesPagina.tsx',
    noAplica(
      'Estatus de materiales: consulta de lo comprado/recibido por orden (lado MRP, fuera de la regla).',
    ),
  ],
  [
    'ordenes-compra/ComprasPorOrdenPagina.tsx',
    noAplica('Compras por orden: consulta de las OC de una orden; no captura.'),
  ],
  [
    'notas-salida/NotasPorOrdenPagina.tsx',
    noAplica(
      'Notas por orden: consulta; la nota que nace de su habilitación ya avisa y se apaga por la etapa 1.',
    ),
  ],
  [
    'ordenes/DialogoCopiarMatriz.tsx',
    noAplica(
      'Copiar matriz: la orden elegida es el ORIGEN, sólo se lee; el destino es la orden abierta en la ficha.',
    ),
  ],
]);

/** Archivos de `src/modulos` que listan órdenes (ruta relativa), sin las piezas. */
function conListaDeOrdenes(): string[] {
  const piezas = new Set<string>(Object.values(PIEZAS));
  return fuentes(MODULOS)
    .map((ruta) => relative(MODULOS, ruta).split('\\').join('/'))
    .filter((rel) => !piezas.has(rel) && LISTA_ORDENES.test(leer(rel)))
    .sort();
}

/** Lo que está mal en una tabla de políticas (vacío = todo bien). */
function problemasDePoliticas(
  politicas: ReadonlyMap<string, Politica>,
  leerArchivo: (rel: string) => string = leer,
  detectados: readonly string[] = conListaDeOrdenes(),
): string[] {
  const problemas: string[] = [];
  for (const rel of detectados) {
    if (!politicas.has(rel)) problemas.push(`${rel}: lista órdenes y no declara su política`);
  }
  for (const [rel, politica] of politicas) {
    if (!detectados.includes(rel)) {
      problemas.push(`${rel}: ya no lista órdenes, sobra`);
      continue;
    }
    const texto = leerArchivo(rel);
    if (politica.tipo === 'oculta') {
      const porSelector = USA_SELECTOR_QUE_OCULTA.test(texto);
      const porSuCuenta = OCULTA_POR_SU_CUENTA.test(texto) && PINTA_INTERRUPTOR.test(texto);
      if (!porSelector && !porSuCuenta) {
        problemas.push(`${rel}: es captura y no oculta las cerradas con su interruptor`);
      }
    } else {
      if (politica.razon.trim().length <= 10) problemas.push(`${rel}: falta su razón`);
      if (OCULTA_POR_SU_CUENTA.test(texto) || PINTA_INTERRUPTOR.test(texto)) {
        problemas.push(
          `${rel}: es consulta y oculta las cerradas (Daniel: no se vuelven invisibles)`,
        );
      }
      // Los selectores de CAPTURA ocultan por omisión: usarlos en una consulta esconde historia.
      if (USA_SELECTOR_QUE_OCULTA.test(texto)) {
        problemas.push(`${rel}: es consulta y usa un selector de captura (oculta las cerradas)`);
      }
    }
  }
  return problemas;
}

describe('guardián de la política de cerradas de las listas de órdenes (0.227)', () => {
  it('toda lista de órdenes de `src/modulos` declara su política y la cumple', () => {
    expect(problemasDePoliticas(POLITICAS)).toEqual([]);
  });

  it('la red NO está vacía: encuentra las capturas y las consultas que hoy listan órdenes', () => {
    // Si el regex dejara de casar (un import reescrito), la prueba de arriba pasaría en verde sin
    // mirar nada.
    expect(conListaDeOrdenes()).toEqual(
      expect.arrayContaining([
        'produccion/EntregaClientePagina.tsx',
        'ordenes-compra/DialogoEditarOc.tsx',
        'notas-salida/DialogoEditarNota.tsx',
        'ordenes/CentroOrdenesPagina.tsx',
        'ordenes-compra/ExplosionMaterialesPagina.tsx',
      ]),
    );
  });

  it('las PIEZAS que implementan la regla llevan su filtro, su interruptor y su aviso', () => {
    // El CÓDIGO, no el comentario: la palabra `'ocultar'` también vive en los docblocks.
    const FILTRO_CON_INTERRUPTOR = /cerradas: mostrarCerradas \? 'incluir' : 'ocultar'/;
    const selector = leer(PIEZAS.selectorOrden);
    expect(selector).toMatch(FILTRO_CON_INTERRUPTOR);
    expect(selector).toMatch(/cerradas: 'solo'/);
    expect(selector).toMatch(PINTA_INTERRUPTOR);
    expect(selector).toMatch(PINTA_AVISO);

    const selectorPt = leer(PIEZAS.selectorOrdenPt);
    expect(selectorPt).toMatch(/: todasConOrden\.filter\(\(o\) => o\.ordenCerrada !== true\)/);
    expect(selectorPt).toMatch(PINTA_INTERRUPTOR);
    expect(selectorPt).toMatch(PINTA_AVISO);

    expect(leer(PIEZAS.ordenesDeCaptura)).toMatch(FILTRO_CON_INTERRUPTOR);
  });

  it('la revisión de políticas de verdad mide (caso sintético: cada regla, rota a propósito)', () => {
    // Archivos FICTICIOS con su texto: así se ejerce cada regla sin depender del árbol real.
    const textos = new Map<string, string>([
      ['captura-sin-interruptor.tsx', "useConsultaOrdenes({ cerradas: 'ocultar' })"],
      ['captura-sin-filtro.tsx', 'useConsultaOrdenes({}); <InterruptorCerradas activo />'],
      ['captura-bien.tsx', 'useOrdenesDeCaptura(x); <InterruptorCerradas activo />'],
      [
        'consulta-que-oculta.tsx',
        "useConsultaOrdenes({ cerradas: mostrar ? 'incluir' : 'ocultar' })",
      ],
      ['consulta-sin-razon.tsx', 'useConsultaOrdenes({})'],
      [
        'consulta-con-selector.tsx',
        "import { SelectorOrden } from '@/modulos/produccion/SelectorOrden';",
      ],
      ['nueva-sin-declarar.tsx', 'useConsultaOrdenes({})'],
    ]);
    const politicas = new Map<string, Politica>([
      ['captura-sin-interruptor.tsx', OCULTA],
      ['captura-sin-filtro.tsx', OCULTA],
      ['captura-bien.tsx', OCULTA],
      ['consulta-que-oculta.tsx', noAplica('una consulta que no debería ocultar nada')],
      ['consulta-sin-razon.tsx', noAplica('')],
      ['consulta-con-selector.tsx', noAplica('una consulta que importa el selector de captura')],
      ['ya-no-existe.tsx', OCULTA],
    ]);
    expect(
      problemasDePoliticas(politicas, (rel) => textos.get(rel) ?? '', [...textos.keys()]),
    ).toEqual([
      'nueva-sin-declarar.tsx: lista órdenes y no declara su política',
      'captura-sin-interruptor.tsx: es captura y no oculta las cerradas con su interruptor',
      'captura-sin-filtro.tsx: es captura y no oculta las cerradas con su interruptor',
      'consulta-que-oculta.tsx: es consulta y oculta las cerradas (Daniel: no se vuelven invisibles)',
      'consulta-sin-razon.tsx: falta su razón',
      'consulta-con-selector.tsx: es consulta y usa un selector de captura (oculta las cerradas)',
      'ya-no-existe.tsx: ya no lista órdenes, sobra',
    ]);
  });
});
