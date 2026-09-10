import { describe, expect, it } from 'vitest';

import {
  avisoAvioPorMedidaConCantidadesPorTalla,
  avisoValorFueraDeRango,
  hayDescuadreDeRequerido,
  etiquetaMedida,
  normalizarUnidad,
} from './unidades-avio.js';

/**
 * Unit del módulo PURO de unidades del avío (V1-E3g, §Post-F9.66). Lo que se prueba aquí es lo que
 * sostiene la decisión: la etiqueta la DERIVA el sistema (nadie teclea "53 cm") y el aviso de valor
 * absurdo **avisa sin bloquear**, callándose cuando no tiene nada útil que decir.
 */
describe('normalizarUnidad', () => {
  it('recorta y baja a minúsculas; el vacío es null', () => {
    expect(normalizarUnidad('  CM ')).toBe('cm');
    expect(normalizarUnidad('')).toBeNull();
    expect(normalizarUnidad('   ')).toBeNull();
    expect(normalizarUnidad(null)).toBeNull();
    expect(normalizarUnidad(undefined)).toBeNull();
  });
});

describe('etiquetaMedida', () => {
  it('junta el número con la unidad del avío', () => {
    expect(etiquetaMedida(53, 'cm')).toBe('53 cm');
    expect(etiquetaMedida(0.75, 'm')).toBe('0.75 m');
    expect(etiquetaMedida(53, ' CM ')).toBe('53 cm');
  });

  it('sin unidad sale solo el número (no se inventa una)', () => {
    expect(etiquetaMedida(53, null)).toBe('53');
    expect(etiquetaMedida(53, '')).toBe('53');
  });
});

describe('avisoValorFueraDeRango (avisa, NO bloquea)', () => {
  it('avisa cuando el número es absurdo para la unidad', () => {
    // El caso que Daniel describió: un `1` en un cierre en cm casi seguro quiso ser 100.
    const aviso = avisoValorFueraDeRango('La medida "1 cm"', 1, 'cm');
    expect(aviso).not.toBeNull();
    expect(aviso).toContain('cm');
    expect(aviso).toContain('La medida "1 cm"');
  });

  it('calla cuando el número es normal para la unidad', () => {
    expect(avisoValorFueraDeRango('La medida', 53, 'cm')).toBeNull();
    expect(avisoValorFueraDeRango('El consumo', 0.75, 'm')).toBeNull();
    expect(avisoValorFueraDeRango('El consumo', 1, 'pza')).toBeNull();
  });

  it('calla con unidad desconocida o ausente: mejor callarse que gritar en falso', () => {
    expect(avisoValorFueraDeRango('La medida', 1, 'rollo')).toBeNull();
    expect(avisoValorFueraDeRango('La medida', 1, null)).toBeNull();
    expect(avisoValorFueraDeRango('La medida', 1, '')).toBeNull();
  });

  it('el CERO nunca avisa: es deliberado (esa talla no lleva el avío), no un dedazo', () => {
    expect(avisoValorFueraDeRango('El consumo', 0, 'cm')).toBeNull();
    expect(avisoValorFueraDeRango('El consumo', 0, 'm')).toBeNull();
  });

  it('avisa también por el techo (0.75 tecleado en cm son 75 cm de elástico por prenda)', () => {
    expect(avisoValorFueraDeRango('El consumo', 500, 'cm')).not.toBeNull();
    expect(avisoValorFueraDeRango('El consumo', 75, 'm')).not.toBeNull();
  });
});

/**
 * ⭐⭐ §Post-F9.105 — EL TEXTO ÚNICO de la contradicción «avío por medida + cantidades por talla».
 * Lo dicen tres pantallas (BOM del modelo, receta de la orden y explosión de materiales) y por eso
 * vive en un solo sitio: si cada una lo redactara, parecerían tres reglas distintas.
 */
describe('avisoAvioPorMedidaConCantidadesPorTalla (§Post-F9.105)', () => {
  it('sin requerido (el BOM del modelo, que no sabe de piezas) dice el QUÉ y el CÓMO, sin cifras', () => {
    const aviso = avisoAvioPorMedidaConCantidadesPorTalla('Usa el botón «Guardar».');
    expect(aviso).toContain('POR MEDIDA');
    expect(aviso).toContain('se consume por talla');
    expect(aviso).toContain('Usa el botón «Guardar».');
    // Sin orden detrás no hay magnitud que inventar.
    expect(aviso).not.toContain('Esta orden pide');
  });

  /**
   * ⭐⭐ V1-E8h (§Post-F9.130) — **LA CIFRA VA PRIMERO.** Daniel no es programador y lo que necesita
   * para decidir son los dos números; antes abrían dos renglones de explicación técnica y la
   * magnitud quedaba sepultada en medio. La prueba fija el ORDEN, no sólo que las cifras estén.
   */
  it('⭐ arranca por la MAGNITUD, en lenguaje de negocio, antes de explicar nada', () => {
    const aviso = avisoAvioPorMedidaConCantidadesPorTalla('Corrígelo.', {
      hoy: 53095,
      normalizado: 3200,
      unidad: 'pza',
    });
    expect(aviso.startsWith('Esta orden pide 53,095 pza y deberían ser 3,200 pza')).toBe(true);
    // El porqué va DESPUÉS de la cifra, no antes.
    expect(aviso.indexOf('POR MEDIDA')).toBeGreaterThan(aviso.indexOf('deberían ser'));
    // Y el remedio, al final.
    expect(aviso.endsWith('Corrígelo.')).toBe(true);
  });

  it('⭐ con requerido dice CUÁNTO se está pidiendo de más, y por cuánto se multiplicó', () => {
    const aviso = avisoAvioPorMedidaConCantidadesPorTalla('Corrígelo.', {
      hoy: 1630,
      normalizado: 30,
      unidad: 'pza',
    });
    expect(aviso).toContain('Esta orden pide 1,630 pza y deberían ser 30 pza');
    expect(aviso).toContain('1,600 pza de MÁS');
    // 🔴 El multiplicador va pegado a lo que MULTIPLICA (hallazgo del reviewer): 1,630 SÍ es 54.3
    // veces 30, pero 1,600 es 53.3 — colgar el "(54.3 veces)" de la DIFERENCIA lo volvía falso.
    expect(aviso).toContain('MULTIPLICADO por 54.3');
    expect(aviso).not.toMatch(/de MÁS[ ,]*\(?\s*54\.3/);
  });

  it('🔴 el multiplicador multiplica al TOTAL, no a la diferencia (53 × 30 = 1,590)', () => {
    const aviso = avisoAvioPorMedidaConCantidadesPorTalla('Corrígelo.', {
      hoy: 1590,
      normalizado: 30,
      unidad: 'pza',
    });
    // Las tres cifras son exactas; lo que importa es de cuál cuelga el "53".
    expect(aviso).toContain(
      'Esta orden pide 1,590 pza y deberían ser 30 pza: el requerido sale MULTIPLICADO por 53',
    );
    expect(aviso).toContain('1,560 pza de MÁS');
  });

  it('si el requerido sale IGUAL no inventa un descuadre (nada de gritar en falso)', () => {
    const aviso = avisoAvioPorMedidaConCantidadesPorTalla('Corrígelo.', {
      hoy: 60,
      normalizado: 60,
      unidad: 'pza',
    });
    expect(aviso).not.toContain('Esta orden pide');
    expect(aviso).not.toContain('de MÁS');
    expect(aviso).toContain('Corrígelo.');
  });

  it('con el normalizado en CERO no se escribe una proporción imposible', () => {
    const aviso = avisoAvioPorMedidaConCantidadesPorTalla('Corrígelo.', {
      hoy: 1590,
      normalizado: 0,
      unidad: 'pza',
    });
    expect(aviso).toContain('1,590 pza de MÁS');
    expect(aviso).not.toContain('veces');
    expect(aviso).not.toContain('Infinity');
  });

  it('hayDescuadreDeRequerido: la bandera puede contradecir sin descuadrar nada', () => {
    // Avío por medida con la bandera encendida y SIN cantidades por talla: R18 cae al consumo por
    // prenda y el número sale bien. Es el criterio con el que la explosión y la previa se callan.
    expect(hayDescuadreDeRequerido({ hoy: 30, normalizado: 30, unidad: 'pza' })).toBe(false);
    expect(hayDescuadreDeRequerido({ hoy: 1590, normalizado: 30, unidad: 'pza' })).toBe(true);
    // Y no se deja engañar por el polvo de coma flotante.
    expect(hayDescuadreDeRequerido({ hoy: 0.1 + 0.2, normalizado: 0.3, unidad: null })).toBe(false);
  });

  it('cuando se pide de MENOS también se dice (la contradicción no siempre infla)', () => {
    const aviso = avisoAvioPorMedidaConCantidadesPorTalla('Guárdalo.', {
      hoy: 10,
      normalizado: 30,
      unidad: null,
    });
    expect(aviso).toContain('20 de MENOS');
    expect(aviso).not.toContain('veces');
  });
});
