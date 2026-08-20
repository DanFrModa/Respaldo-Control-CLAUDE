import { describe, expect, it } from 'vitest';

import {
  candidatoHabitualAvio,
  candidatoMasBaratoAvio,
  elegirProveedorAvio,
  elegirProveedorTela,
  precioProveedorAvio,
  type CandidatoProveedor,
  type FilaProveedorAvio,
} from './proveedor-material.js';

/**
 * Unit de la POLÍTICA DE PROVEEDOR del MRP (V1-E3m, §Post-F9.82) — SIN Postgres, que es justo la
 * razón de que la regla viva en un módulo puro: la elección de proveedor es lo que esta etapa vino a
 * arreglar y no puede quedar cubierta solo por pruebas que necesitan un contenedor.
 *
 * Cada aserción está escrita para poder nombrar el valor que la pondría ROJA: los precios y los ids
 * de los ejemplos NO son intercambiables (el más barato tiene el precio bruto MÁS ALTO, el desempate
 * usa ids invertidos respecto al orden del arreglo, etc.). Una aserción sobre "el proveedor correcto"
 * que pasara igual con cualquier proveedor no diría nada.
 */

/** Fábrica de renglones `AvioProveedor` (todo explícito: cada campo importa en algún caso). */
function fila(over: Partial<FilaProveedorAvio> & { idProveedor: number }): FilaProveedorAvio {
  return {
    proveedor: `Proveedor ${String(over.idProveedor)}`,
    activo: true,
    precio: null,
    factorConversion: null,
    habitual: false,
    ...over,
  };
}

/** Candidato mínimo para las pruebas de precedencia. */
function candidato(id: number, nombre: string): CandidatoProveedor {
  return { idProveedor: id, proveedor: nombre, precio: 10, activo: true };
}

describe('precioProveedorAvio — normalización a unidad de consumo (R1)', () => {
  it('divide el precio de la PRESENTACIÓN entre el factor del proveedor', () => {
    // 240 el rollo ÷ 60 m por rollo = 4.00 el metro. Sin dividir daría 240 (rojo).
    expect(
      precioProveedorAvio(fila({ idProveedor: 1, precio: 240, factorConversion: 60 }), 1),
    ).toBe(4);
  });

  it('cae al factor del AVÍO cuando el proveedor no fija el suyo', () => {
    // Factor del avío = 4 → 20 ÷ 4 = 5. Si ignorara el factor del avío daría 20 (rojo).
    expect(
      precioProveedorAvio(fila({ idProveedor: 1, precio: 20, factorConversion: null }), 4),
    ).toBe(5);
  });

  it('sin precio capturado devuelve null (no un 0 mudo)', () => {
    expect(precioProveedorAvio(fila({ idProveedor: 1, precio: null }), 4)).toBeNull();
  });
});

describe('candidatoHabitualAvio — ⭐ el proveedor al que se le compra siempre (§Post-F9.82)', () => {
  it('sin nadie marcado devuelve null (y el llamador cae al más barato de F4)', () => {
    const filas = [fila({ idProveedor: 1, precio: 5 }), fila({ idProveedor: 2, precio: 3 })];
    expect(candidatoHabitualAvio(filas, null)).toBeNull();
  });

  it('elige al marcado AUNQUE sea el más caro (esa es la decisión: habitual ≠ más barato)', () => {
    const filas = [
      fila({ idProveedor: 1, proveedor: 'Barato', precio: 3 }),
      fila({ idProveedor: 2, proveedor: 'El de siempre', precio: 9, habitual: true }),
    ];
    const elegido = candidatoHabitualAvio(filas, null);
    // Si la función se quedara con el más barato, aquí saldría "Barato"/9 → rojo.
    expect(elegido?.proveedor).toBe('El de siempre');
    expect(elegido?.precio).toBe(9);
  });

  it('normaliza el precio del habitual con su factor (precio ÷ factor)', () => {
    const filas = [fila({ idProveedor: 7, precio: 500, factorConversion: 100, habitual: true })];
    // 500 la caja ÷ 100 pzas = 5.00 la pieza. Sin normalizar: 500 (rojo).
    expect(candidatoHabitualAvio(filas, null)?.precio).toBe(5);
  });

  it('un habitual SIN precio sigue siendo el proveedor propuesto (precio null)', () => {
    const filas = [
      fila({ idProveedor: 4, proveedor: 'El de siempre', precio: null, habitual: true }),
      fila({ idProveedor: 5, proveedor: 'Otro con precio', precio: 2 }),
    ];
    const elegido = candidatoHabitualAvio(filas, null);
    // El atorón que la etapa vino a quitar era quedarse SIN proveedor; que falte el precio no
    // descalifica al habitual (si eligiera "Otro con precio" esto sería rojo).
    expect(elegido?.idProveedor).toBe(4);
    expect(elegido?.precio).toBeNull();
  });

  it('un habitual INACTIVO se conserva, marcado como inactivo (el llamador avisa)', () => {
    const filas = [fila({ idProveedor: 9, precio: 1, habitual: true, activo: false })];
    expect(candidatoHabitualAvio(filas, null)).toMatchObject({ idProveedor: 9, activo: false });
  });

  it('con dos marcados (no debería pasar: hay índice único) gana el id MENOR, no el primero', () => {
    const filas = [
      fila({ idProveedor: 8, proveedor: 'Ocho', precio: 1, habitual: true }),
      fila({ idProveedor: 2, proveedor: 'Dos', precio: 7, habitual: true }),
    ];
    // Si devolviera "el primero del arreglo" saldría Ocho → rojo.
    expect(candidatoHabitualAvio(filas, null)?.proveedor).toBe('Dos');
  });
});

describe('candidatoMasBaratoAvio — la regla F4/R1, intacta como fallback', () => {
  it('compara POR UNIDAD DE CONSUMO, no por el precio de la presentación', () => {
    const filas = [
      // 300 el rollo ÷ 100 m = 3.00 el metro (el precio BRUTO más alto de los dos).
      fila({ idProveedor: 1, proveedor: 'Rollo grande', precio: 300, factorConversion: 100 }),
      // 4 el metro.
      fila({ idProveedor: 2, proveedor: 'Suelto', precio: 4, factorConversion: 1 }),
    ];
    const elegido = candidatoMasBaratoAvio(filas, null);
    // Comparando precios brutos ganaría "Suelto" (4 < 300) → rojo.
    expect(elegido?.proveedor).toBe('Rollo grande');
    expect(elegido?.precio).toBe(3);
  });

  it('ignora a los INACTIVOS aunque sean los más baratos', () => {
    const filas = [
      fila({ idProveedor: 1, proveedor: 'De baja', precio: 1, activo: false }),
      fila({ idProveedor: 2, proveedor: 'Vigente', precio: 6 }),
    ];
    expect(candidatoMasBaratoAvio(filas, null)?.proveedor).toBe('Vigente');
  });

  it('ignora a los que no tienen precio capturado', () => {
    const filas = [
      fila({ idProveedor: 1, proveedor: 'Sin precio', precio: null }),
      fila({ idProveedor: 2, proveedor: 'Con precio', precio: 6 }),
    ];
    expect(candidatoMasBaratoAvio(filas, null)?.proveedor).toBe('Con precio');
  });

  it('en EMPATE de precio gana el idProveedor menor (determinista, no el orden del arreglo)', () => {
    const filas = [
      fila({ idProveedor: 9, proveedor: 'Nueve', precio: 5 }),
      fila({ idProveedor: 3, proveedor: 'Tres', precio: 5 }),
    ];
    expect(candidatoMasBaratoAvio(filas, null)?.proveedor).toBe('Tres');
  });

  it('sin ningún precio devuelve null (nadie a quien comprarle por precio)', () => {
    expect(candidatoMasBaratoAvio([fila({ idProveedor: 1 })], null)).toBeNull();
  });
});

describe('elegirProveedorTela — amarre → ⭐ DUEÑO → asignación de Compras', () => {
  const amarre = candidato(1, 'Amarrado por Desarrollo');
  const dueno = candidato(2, 'Dueño de la tela');
  const compras = candidato(3, 'El que asignó Compras');

  it('el amarre de Desarrollo gana sobre el dueño y sobre Compras', () => {
    const r = elegirProveedorTela({ amarre, dueno, compras });
    expect(r.elegido?.proveedor).toBe('Amarrado por Desarrollo');
    expect(r.origen).toBe('amarre-desarrollo');
  });

  it('⭐ sin amarre manda el DUEÑO de la tela (el escalón que faltaba y dejaba todo sin proveedor)', () => {
    const r = elegirProveedorTela({ dueno, compras });
    expect(r.elegido?.proveedor).toBe('Dueño de la tela');
    expect(r.origen).toBe('dueno-tela');
  });

  it('la asignación de Compras solo entra cuando NO hay amarre ni dueño', () => {
    const r = elegirProveedorTela({ compras });
    expect(r.elegido?.proveedor).toBe('El que asignó Compras');
    expect(r.origen).toBe('asignado-compras');
    expect(r.asignacionDormida).toBe(false);
  });

  it('sin ningún candidato: sin-proveedor y elegido null (el renglón no se puede comprar)', () => {
    const r = elegirProveedorTela({});
    expect(r.elegido).toBeNull();
    expect(r.origen).toBe('sin-proveedor');
    expect(r.asignacionDormida).toBe(false);
  });

  it('⭐ una asignación de Compras que NO se usó queda marcada como DORMIDA (D3: se dice)', () => {
    // Desarrollo/el catálogo resolvieron: Compras no pisa a nadie… pero su asignación no se calla.
    expect(elegirProveedorTela({ dueno, compras }).asignacionDormida).toBe(true);
    expect(elegirProveedorTela({ amarre, compras }).asignacionDormida).toBe(true);
  });

  it('sin asignación de Compras nunca hay nada dormido que avisar', () => {
    expect(elegirProveedorTela({ amarre, dueno }).asignacionDormida).toBe(false);
  });
});

describe('elegirProveedorAvio — amarre → ⭐ HABITUAL → más barato → asignación de Compras', () => {
  const amarre = candidato(1, 'Amarrado por Desarrollo');
  const habitual = candidato(2, 'El de siempre');
  const masBarato = candidato(3, 'El más barato');
  const compras = candidato(4, 'El que asignó Compras');

  it('el amarre de Desarrollo gana sobre todos', () => {
    const r = elegirProveedorAvio({ amarre, habitual, masBarato, compras });
    expect(r.elegido?.proveedor).toBe('Amarrado por Desarrollo');
    expect(r.origen).toBe('amarre-desarrollo');
  });

  it('⭐ sin amarre gana el HABITUAL sobre el más barato (se invierte el default de F4)', () => {
    const r = elegirProveedorAvio({ habitual, masBarato, compras });
    // Si el orden siguiera siendo el de F4, aquí saldría "El más barato" → rojo.
    expect(r.elegido?.proveedor).toBe('El de siempre');
    expect(r.origen).toBe('habitual');
  });

  it('sin habitual sigue mandando el más barato (fallback F4 intacto → no-regresión)', () => {
    const r = elegirProveedorAvio({ masBarato, compras });
    expect(r.elegido?.proveedor).toBe('El más barato');
    expect(r.origen).toBe('mas-barato');
  });

  it('la asignación de Compras es el último recurso', () => {
    const r = elegirProveedorAvio({ compras });
    expect(r.origen).toBe('asignado-compras');
    expect(r.asignacionDormida).toBe(false);
  });

  it('la asignación de Compras queda DORMIDA si el catálogo ya resolvía', () => {
    expect(elegirProveedorAvio({ masBarato, compras }).asignacionDormida).toBe(true);
    expect(elegirProveedorAvio({ habitual, compras }).asignacionDormida).toBe(true);
  });

  it('sin ningún candidato: sin-proveedor', () => {
    const r = elegirProveedorAvio({});
    expect(r.elegido).toBeNull();
    expect(r.origen).toBe('sin-proveedor');
  });
});
