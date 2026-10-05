import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * ⭐⭐ 0.226b (§Post-F9.244 / §Post-F9.261) — EL GUARDIÁN DEL AVISO DE ORDEN CERRADA.
 *
 * La regla de Daniel: una orden CERRADA se consulta libre pero no admite movimientos. El servidor
 * ya la hace valer (`exigirOrdenesAbiertas`, parte a); esta parte es la cortesía de la PANTALLA:
 * apagar la captura y AVISAR antes, en vez de dejar que alguien llene un formulario y se entere al
 * pulsar Guardar. El aviso es uno solo (`AvisoOrdenCerrada`, con su texto en `lib/orden-cerrada.ts`).
 *
 * ⚠️ **Por qué hace falta un guardián.** Antes de esta fila sólo DOS vistas del sistema condicionaban
 * algo por el cierre (el costeo y la ficha de la orden); el resto abría el formulario habilitado. Una
 * pantalla de captura nueva nace sin aviso si nadie se acuerda, y «acordarse» es justo lo que no
 * sostiene una regla. Ésta sí: **todo archivo de `src/modulos` que elige la orden sobre la que se
 * captura** —importa `SelectorOrden` o `SelectorOrdenPt`— tiene que usar `AvisoOrdenCerrada`, o
 * estar en {@link EXCEPCIONES} con su razón escrita (p. ej. una pantalla de sólo consulta).
 *
 * Y una lista corta de capturas que reciben la orden YA elegida (no importan el selector) pero
 * también se apagan: {@link CAPTURAS_SIN_SELECTOR}. Es explícita a propósito: es la lista que esta
 * fila cubrió, y si alguna pierde el aviso, se ve aquí.
 *
 * ⚠️ **Su alcance, sin adornos.** Comprueba que el archivo REFIERE el aviso, no que lo pinte en el
 * sitio correcto ni que apague el botón correcto: eso lo cubren las pruebas de componente de cada
 * pantalla. Es una red, no una demostración.
 *
 * ⚠️ NO pide FILTRAR el selector: el estado es informativo, nunca una llave para operar
 * (`produccion/SelectorOrden.tsx`, el precedente del 26-jul-2026). Filtrar es la fila 0.227.
 *
 * Vive en `tsconfig.node.json` (no en el proyecto de la app) porque lee archivos REALES del disco
 * con `node:fs`, igual que `selector-proveedor-unico.test.ts`.
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

/** Todos los `.tsx` de un directorio (los `.test.tsx` no cuentan: no son pantallas). */
function pantallas(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entrada) => {
    const ruta = join(dir, entrada.name);
    if (entrada.isDirectory()) {
      return pantallas(ruta);
    }
    return entrada.name.endsWith('.tsx') && !entrada.name.endsWith('.test.tsx') ? [ruta] : [];
  });
}

/** ¿El archivo IMPORTA el selector de orden (de producción o de PT)? */
const IMPORTA_SELECTOR =
  /import\s*\{[^}]*\b(?:SelectorOrden|SelectorOrdenPt)\b[^}]*\}\s*from\s*'[^']+'/;
/** ¿El archivo USA el aviso único? (importarlo sin pintarlo no cuenta). */
const USA_AVISO = /<AvisoOrdenCerrada\b/;

/**
 * Archivos que importan el selector y NO llevan el aviso, cada uno con su RAZÓN. Hoy ninguno. Una
 * excepción nueva se agrega aquí y se ve en el diff (p. ej. una pantalla de SÓLO CONSULTA, donde no
 * hay nada que apagar).
 */
const EXCEPCIONES = new Map<string, string>([]);

/**
 * Capturas que reciben la orden YA elegida (no importan el selector) y que esta fila apagó. Ruta
 * relativa a `frontend/src/modulos`.
 */
const CAPTURAS_SIN_SELECTOR = [
  'produccion/AvanceProduccion.tsx',
  'calidad/CapturaAuditoriaPagina.tsx',
  'calidad/ConsultaAuditoriasPagina.tsx',
  'costos/CosteoOrdenPagina.tsx',
  'notas-salida/DialogoEditarNota.tsx',
  'notas-salida/NotasSalidaPagina.tsx',
  'ordenes-compra/DialogoEditarOc.tsx',
  'ordenes-compra/OrdenesCompraPagina.tsx',
  'ordenes-compra/BandejaAutorizacionPagina.tsx',
  'ordenes-compra/RecepcionComprasPagina.tsx',
  'inventarios/CapturaEntradaTelaPagina.tsx',
  'inventarios/EntradasTelaPagina.tsx',
  'inventarios/KardexPtPagina.tsx',
  'inventarios/ExistenciasTelasColorPagina.tsx',
  'notas-salida/PanelHabilitacionOrden.tsx',
  'ordenes-compra/ExplosionMaterialesPagina.tsx',
  'ordenes-compra/DialogoColoresDeTela.tsx',
  'ordenes/SeccionDesarrolloOrden.tsx',
  'ordenes/PanelRecetaOrden.tsx',
  'ordenes/PanelPreciosOrden.tsx',
];

const MODULOS = join(raizDelRepo(), 'frontend', 'src', 'modulos');

/** Archivos de `src/modulos` que IMPORTAN un selector de orden (ruta relativa a `modulos`). */
function conSelector(): string[] {
  return pantallas(MODULOS)
    .filter((ruta) => IMPORTA_SELECTOR.test(readFileSync(ruta, 'utf8')))
    .map((ruta) => relative(MODULOS, ruta).split('\\').join('/'))
    .sort();
}

/** Lo que está mal en una lista de excepciones (vacío = todo bien). */
function problemasDeExcepciones(excepciones: ReadonlyMap<string, string>): string[] {
  const lista = conSelector();
  const problemas: string[] = [];
  for (const [ruta, razon] of excepciones) {
    if (razon.trim().length <= 10) problemas.push(`${ruta}: falta su razón`);
    if (!lista.includes(ruta)) problemas.push(`${ruta}: ya no importa el selector, sobra`);
    if (USA_AVISO.test(readFileSync(join(MODULOS, ruta), 'utf8'))) {
      problemas.push(`${ruta}: ya usa el aviso, sobra`);
    }
  }
  return problemas;
}

describe('guardián del aviso de orden cerrada (0.226b)', () => {
  it('toda pantalla que elige la orden con SelectorOrden/SelectorOrdenPt usa AvisoOrdenCerrada', () => {
    const faltan = conSelector().filter(
      (r) => !EXCEPCIONES.has(r) && !USA_AVISO.test(readFileSync(join(MODULOS, r), 'utf8')),
    );
    expect(
      faltan,
      'Estas pantallas eligen la orden sobre la que se captura y NO avisan si está cerrada: usa ' +
        '<AvisoOrdenCerrada> (components/dominio) y apaga el guardar con estaCerrada() ' +
        '(lib/orden-cerrada), o decláralas en EXCEPCIONES con su razón.',
    ).toEqual([]);
  });

  it('la red NO está vacía: encuentra las pantallas que hoy eligen la orden', () => {
    // Si el regex dejara de casar (un import reescrito), la prueba de arriba pasaría en verde sin
    // mirar nada. Éstas son las cinco que existían al nacer el guardián.
    expect(conSelector()).toEqual(
      expect.arrayContaining([
        'calidad/AltaAuditoriaPagina.tsx',
        'inventarios/MovimientosPtPagina.tsx',
        'inventarios/SalidaTelaColorOrdenPagina.tsx',
        'inventarios/TraspasosPtPagina.tsx',
        'produccion/EntregaClientePagina.tsx',
      ]),
    );
  });

  it('cada EXCEPCIÓN sigue importando el selector y no usa el aviso (si no, sobra)', () => {
    expect(problemasDeExcepciones(EXCEPCIONES)).toEqual([]);
  });

  it('la revisión de EXCEPCIONES de verdad mide (caso sintético: tres excepciones mal puestas)', () => {
    // Hoy EXCEPCIONES está vacía, así que la prueba de arriba no ejercería nada por sí sola. Esta
    // le pasa tres excepciones que DEBEN rechazarse, una por cada regla.
    const problemas = problemasDeExcepciones(
      new Map([
        // Usa el aviso ⇒ sobra.
        ['calidad/AltaAuditoriaPagina.tsx', 'razón suficientemente larga para pasar'],
        // No importa el selector ⇒ sobra.
        ['produccion/ProduccionPagina.tsx', 'razón suficientemente larga para pasar'],
        // Sin razón.
        ['inventarios/TraspasosPtPagina.tsx', ''],
      ]),
    );
    expect(problemas).toEqual([
      'calidad/AltaAuditoriaPagina.tsx: ya usa el aviso, sobra',
      'produccion/ProduccionPagina.tsx: ya no importa el selector, sobra',
      'inventarios/TraspasosPtPagina.tsx: falta su razón',
      'inventarios/TraspasosPtPagina.tsx: ya usa el aviso, sobra',
    ]);
  });

  it('las capturas que reciben la orden ya elegida también usan el aviso', () => {
    const faltan = CAPTURAS_SIN_SELECTOR.filter(
      (r) => !USA_AVISO.test(readFileSync(join(MODULOS, r), 'utf8')),
    );
    expect(faltan).toEqual([]);
  });
});
