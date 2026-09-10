/**
 * ⭐ V1-E8d (§Post-F9.127) — EL CRITERIO del aviso «el costo debajo de este precio quedó viejo».
 *
 * `avisoDeCostoViejo` es una función PURA: sin base, sin dobles, sin nada que pueda mentir. Aquí
 * vive la regla entera —cuándo avisa, cuándo NO, y qué dice cuando avisa—. Que la señal la escriba
 * de verdad el embudo de la receta se prueba en `../modelos/revision-modelo.test.ts`, y que llegue
 * al renglón de la lista, en `listas-precios-costo-viejo.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import { avisoDeCostoViejo, type RenglonParaAvisoDeCosto } from './costo-viejo.js';

const CONGELADO = new Date('2026-08-20T15:00:00.000Z');

/** Un renglón cualquiera; `extra` dice qué lo distingue en cada caso. */
function renglon(extra: Partial<RenglonParaAvisoDeCosto> = {}): RenglonParaAvisoDeCosto {
  return {
    congeladoEn: CONGELADO,
    versionPrecosto: 3,
    recetaTocadaEn: null,
    recetaTocadaCambio: null,
    aprobado: false,
    ...extra,
  };
}

describe('avisoDeCostoViejo — cuándo NO avisa (que es lo que separa esta etapa de la opción barata)', () => {
  it('⭐ un modelo cuya RECETA nunca se ha tocado no avisa nada', () => {
    // LA aserción de la etapa entera. `recetaTocadaEn` sólo la escribe el embudo de la receta; si
    // esto se hubiera hecho contra `Modelo.modificadoEn` (que es `@updatedAt`), renombrar el
    // modelo o cambiarle una foto encendería el aviso. Un aviso que nace gritando en falso se
    // aprende a ignorar, y el día que sea de verdad nadie lo mira.
    expect(avisoDeCostoViejo(renglon({ recetaTocadaEn: null }))).toBeNull();
  });

  it('la receta tocada ANTES del congelado no avisa: ese cambio ya está dentro del costo', () => {
    expect(
      avisoDeCostoViejo(renglon({ recetaTocadaEn: new Date('2026-08-19T15:00:00.000Z') })),
    ).toBeNull();
  });

  it('tocada en el MISMO instante del congelado tampoco: es el congelado recogiéndola', () => {
    expect(avisoDeCostoViejo(renglon({ recetaTocadaEn: new Date(CONGELADO) }))).toBeNull();
  });

  it('sin fecha de congelado no hay contra qué comparar, así que no se inventa una alarma', () => {
    expect(
      avisoDeCostoViejo(
        renglon({ congeladoEn: null, recetaTocadaEn: new Date('2026-08-27T15:00:00.000Z') }),
      ),
    ).toBeNull();
  });
});

describe('avisoDeCostoViejo — cuándo SÍ, y qué dice', () => {
  const TOCADA = new Date('2026-08-27T15:00:00.000Z');

  it('⭐ receta tocada DESPUÉS del congelado: avisa, y dice QUÉ cambió y CUÁNDO', () => {
    const aviso = avisoDeCostoViejo(
      renglon({ recetaTocadaEn: TOCADA, recetaTocadaCambio: 'telas' }),
    );
    expect(aviso).not.toBeNull();
    // QUÉ (no un semáforo mudo), CUÁNDO, y de qué costo habla.
    expect(aviso).toContain('las TELAS');
    expect(aviso).toContain('27/8/2026');
    expect(aviso).toContain('v3');
    expect(aviso).toContain('20/8/2026');
  });

  it('nombra CADA parte de la receta por su nombre, no en clave', () => {
    const esperado: Record<string, string> = {
      telas: 'las TELAS',
      avios: 'los AVÍOS',
      'medidas-por-talla': 'MEDIDAS POR TALLA',
      arte: 'el ARTE',
      'copia-de-otro-modelo': 'se copió la de otro modelo',
    };
    for (const [cambio, trozo] of Object.entries(esperado)) {
      const aviso = avisoDeCostoViejo(
        renglon({ recetaTocadaEn: TOCADA, recetaTocadaCambio: cambio }),
      );
      expect(aviso, `cambio ${cambio}`).toContain(trozo);
    }
  });

  it('un código de cambio que este código no conoce da una frase honesta, no un "undefined"', () => {
    // Puerta futura desplegada y revertida, o un dato tocado a mano. El aviso sigue siendo legible.
    const aviso = avisoDeCostoViejo(
      renglon({ recetaTocadaEn: TOCADA, recetaTocadaCambio: 'algo-que-no-existe' }),
    );
    expect(aviso).toContain('Cambió la receta de este modelo');
    expect(aviso).not.toContain('undefined');
  });

  it('sin código de cambio (null) tampoco se rompe la frase', () => {
    const aviso = avisoDeCostoViejo(renglon({ recetaTocadaEn: TOCADA, recetaTocadaCambio: null }));
    expect(aviso).toContain('Cambió la receta de este modelo');
    expect(aviso).not.toContain('undefined');
  });

  it('⭐ si el precio está APROBADO, la frase lo dice — es el caso que Daniel mandó avisar', () => {
    const aviso = avisoDeCostoViejo(
      renglon({ recetaTocadaEn: TOCADA, recetaTocadaCambio: 'avios', aprobado: true }),
    );
    expect(aviso).toContain('APROBADO');
    expect(aviso).toContain('vuelve a aprobar');
  });

  it('sin aprobar avisa IGUAL, pero pide recostear ANTES de aprobar (no habla de firma caída)', () => {
    // Avisar sólo sobre los aprobados dejaría que se firme un precio nuevo sobre el costo viejo,
    // que es el mismo agujero un minuto antes.
    const aviso = avisoDeCostoViejo(
      renglon({ recetaTocadaEn: TOCADA, recetaTocadaCambio: 'avios', aprobado: false }),
    );
    expect(aviso).not.toBeNull();
    expect(aviso).toContain('antes de aprobar');
    expect(aviso).not.toContain('APROBADO');
  });

  it('⭐ las fechas son las de MÉXICO, no las del servidor (que corre en UTC)', () => {
    // Una receta tocada a las 20:00 de Ciudad de México cae ya en el día siguiente en UTC. Con
    // `toISOString()` el aviso diría un día y la ficha del modelo —que lo pinta con
    // `toLocaleDateString('es-MX')` en el navegador— diría otro: dos fechas para el mismo hecho.
    const aviso = avisoDeCostoViejo(
      renglon({
        recetaTocadaEn: new Date('2026-08-28T02:00:00.000Z'),
        recetaTocadaCambio: 'telas',
      }),
    );
    expect(aviso).toContain('27/8/2026');
    expect(aviso).not.toContain('28/8/2026');
  });
});
