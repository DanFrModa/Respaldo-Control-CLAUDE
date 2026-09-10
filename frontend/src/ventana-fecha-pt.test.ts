import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DIAS_VENTANA_CAPTURA_PT,
  hoy,
  inicioVentanaCapturaPt,
} from './modulos/inventarios/fecha-captura-pt';

/**
 * ⭐ LA PANTALLA NO PUEDE ACOTAR LA FECHA POR UN NÚMERO DISTINTO DEL QUE APLICA EL SERVIDOR
 * (fila 0.171).
 *
 * {@link DIAS_VENTANA_CAPTURA_PT} es un ESPEJO: la ventana de verdad vive en el backend
 * (`comun/fecha-capturable.ts`) y no se puede importar desde aquí — son dos paquetes distintos, sin
 * workspace. Lo único que los dos lados comparten es **el contrato**, y el contrato ya publica el
 * número en la descripción de la fecha; así que ése es el sitio contra el que se cruza.
 *
 * 🔴 Y el número es PROVISIONAL: 7 es un default propuesto a la espera de que Daniel diga cuál es
 * el bueno para el almacén de PT. El día que cambie, `npm run gen:api` traerá el `openapi.json`
 * nuevo y esta prueba se pondrá roja señalando el espejo que se quedó atrás. Sin ella, la pantalla
 * seguiría ofreciendo una ventana que el servidor rechaza (o escondiendo días que sí acepta), en
 * silencio.
 *
 * La cadena queda cerrada de punta a punta:
 *   constante del backend → (`ventana-fecha-honesta.test.ts`) → descripción del contrato →
 *   (esta prueba) → espejo de la pantalla.
 *
 * Vive en la raíz de `src/` y en `tsconfig.node.json` (no en el de la app) porque lee un archivo
 * REAL con `node:fs`, igual que `abreviatura-e2e.test.ts` —que cierra este mismo modo de fallo
 * contra el `pattern` del contrato— y que `version.test.ts`.
 */

/** Sube desde el cwd hasta toparse con `PLANMAESTRO.md`, el marcador estable de la raíz. */
function raizDelRepo(): string {
  let dir = process.cwd();
  for (let i = 0; i < 10; i += 1) {
    if (existsSync(join(dir, 'PLANMAESTRO.md'))) return dir;
    const padre = dirname(dir);
    if (padre === dir) break;
    dir = padre;
  }
  throw new Error('No se encontró la raíz del repo (PLANMAESTRO.md)');
}

/** La descripción de la fecha tal como el backend la publica (la que lee cualquier cliente). */
function descripcionPublicada(campo: 'movimiento' | 'traspaso'): string {
  const crudo = readFileSync(join(raizDelRepo(), 'frontend', 'openapi.json'), 'utf8');
  const descripciones = [...crudo.matchAll(/"description":\s*"(Fecha del [^"]+)"/g)].map(
    (m) => m[1],
  );
  const encontrada = descripciones.find(
    (d) => d?.startsWith(`Fecha del ${campo}`) && d.includes('ipt.fecha-libre'),
  );
  if (encontrada === undefined) {
    throw new Error(
      `El OpenAPI ya no publica la ventana en la fecha del ${campo}. Si se quitó a propósito, ` +
        `esta prueba pierde su ancla: hay que cruzar el espejo contra otra cosa, no borrarla.`,
    );
  }
  return encontrada;
}

/** El número de días que anuncia una descripción («… los últimos N días …»). */
function diasAnunciados(descripcion: string): number {
  const m = /(\d+)\s*d(?:ías|\\u00edas)/.exec(descripcion);
  const valor = m?.[1];
  if (valor === undefined) throw new Error(`No se pudo leer la ventana de: ${descripcion}`);
  return Number(valor);
}

describe('la ventana del selector de fecha es la MISMA que anuncia el contrato (fila 0.171)', () => {
  it('⭐ el espejo de la pantalla coincide con la ventana publicada del movimiento manual', () => {
    expect(diasAnunciados(descripcionPublicada('movimiento'))).toBe(DIAS_VENTANA_CAPTURA_PT);
  });

  it('⭐ y con la del traspaso (el otro sitio donde el número viaja en letra)', () => {
    expect(diasAnunciados(descripcionPublicada('traspaso'))).toBe(DIAS_VENTANA_CAPTURA_PT);
  });

  it('`inicioVentanaCapturaPt` son exactamente esos días hacia atrás desde hoy', () => {
    // Se calcula aparte, no con la función que se está midiendo: si se afirmara con ella misma, la
    // prueba diría «el helper es igual a sí mismo» y un error de aritmética pasaría en verde.
    const base = Date.parse(`${diaDelNegocio()}T00:00:00.000Z`);
    const esperado = new Date(base - DIAS_VENTANA_CAPTURA_PT * 86_400_000)
      .toISOString()
      .slice(0, 10);
    expect(inicioVentanaCapturaPt()).toBe(esperado);
    expect(hoy()).toBe(new Date(base).toISOString().slice(0, 10));
  });

  /**
   * ⭐ FILA 0.174 — EL HUSO. El servidor mide la ventana contra el día DEL NEGOCIO (México), no
   * contra el día UTC. Si el espejo se quedara en UTC, entre las 18:00 y las 23:59 de allá el
   * selector ofrecería MAÑANA como tope y toda su ventana iría un día adelante de la que aplica la
   * guarda. Se ancla el reloj en esa franja a propósito: es la única hora en la que las dos
   * cuentas se separan, así que una prueba sin anclar sólo lo vería de casualidad.
   */
  describe('el espejo cuenta en el huso del negocio, no en UTC (fila 0.174)', () => {
    /** 19:00 del 9 de septiembre en México; en UTC ya es el día 10. */
    const ATARDECER_EN_MEXICO = '2026-09-10T01:00:00.000Z';

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(ATARDECER_EN_MEXICO));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('⭐ el tope del selector es HOY en México, no el día UTC (que ya es mañana)', () => {
      expect(hoy()).toBe('2026-09-09');
    });

    it('⭐ y el piso son los días de la ventana contados desde ese mismo día', () => {
      // 9 de septiembre menos 7 días. Escrito como literal: si se recalculara con la misma
      // aritmética del helper, la prueba diría otra vez «es igual a sí mismo».
      expect(inicioVentanaCapturaPt()).toBe('2026-09-02');
    });
  });
});

/** El día de hoy en el huso del negocio, calculado aparte del helper que se mide. */
function diaDelNegocio(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
}
