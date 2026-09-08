import { describe, expect, it } from 'vitest';

import { diasVencidosDeCartera, vencimientoEsMa, type CargoPorEdad } from './dias-vencidos.js';

/**
 * Unit de LOS DÍAS VENCIDOS (fila 0.121, §Post-F9.218(a)). Pieza pura: sin BD y sin reloj — la edad
 * de cada cargo llega YA calculada por Postgres (`CURRENT_DATE − vencimiento`), así que aquí sólo se
 * mide la regla que decide CUÁL de esas edades se enseña.
 *
 * Las dos garantías que se fijan:
 *  1. se enseña la edad del cargo **más viejo que sobrevive a los pagos** (no la del más viejo a
 *     secas, ni un promedio);
 *  2. los créditos se aplican **de más viejo a más nuevo**, la MISMA convención que `netearCubetas`
 *     — si esta columna y las cubetas de la bandeja repartieran distinto, dirían cosas diferentes
 *     del mismo proveedor.
 */
describe('diasVencidosDeCartera (cuál edad se enseña)', () => {
  it('sin cargos no hay nada que envejecer', () => {
    expect(diasVencidosDeCartera([], 0)).toBeNull();
    expect(diasVencidosDeCartera([], 5000)).toBeNull();
  });

  it('un solo cargo vencido: su edad', () => {
    expect(diasVencidosDeCartera([{ diasAtraso: 8, importe: 1000 }], 0)).toBe(8);
  });

  it('enseña el MÁS VIEJO, no el más nuevo ni el más grande', () => {
    const cargos: CargoPorEdad[] = [
      { diasAtraso: 3, importe: 900_000 },
      { diasAtraso: 30, importe: 1 },
      { diasAtraso: 12, importe: 5000 },
    ];
    expect(diasVencidosDeCartera(cargos, 0)).toBe(30);
  });

  it('un cargo dentro de su plazo se enseña como 0, nunca en negativo', () => {
    // Nadie lee «−12 días vencidos»: debe, pero está a tiempo.
    expect(diasVencidosDeCartera([{ diasAtraso: -12, importe: 1000 }], 0)).toBe(0);
    expect(diasVencidosDeCartera([{ diasAtraso: 0, importe: 1000 }], 0)).toBe(0);
  });

  it('⭐ los pagos se comen lo MÁS VIEJO primero: la edad que queda es la del siguiente', () => {
    const cargos: CargoPorEdad[] = [
      { diasAtraso: 40, importe: 1000 },
      { diasAtraso: 10, importe: 1000 },
    ];
    // Sin pagos manda el de 40. Con 1000 pagados, el de 40 se fue y queda el de 10.
    expect(diasVencidosDeCartera(cargos, 0)).toBe(40);
    expect(diasVencidosDeCartera(cargos, 1000)).toBe(10);
  });

  it('el pago que sólo alcanza para PARTE del más viejo lo deja vivo (y su edad manda)', () => {
    const cargos: CargoPorEdad[] = [
      { diasAtraso: 40, importe: 1000 },
      { diasAtraso: 10, importe: 1000 },
    ];
    expect(diasVencidosDeCartera(cargos, 999)).toBe(40);
  });

  it('si los pagos cubren TODO (o hay saldo a favor) no hay días que enseñar', () => {
    const cargos: CargoPorEdad[] = [
      { diasAtraso: 40, importe: 1000 },
      { diasAtraso: 10, importe: 1000 },
    ];
    expect(diasVencidosDeCartera(cargos, 2000)).toBeNull();
    expect(diasVencidosDeCartera(cargos, 5000)).toBeNull();
  });

  it('el orden de entrada no cambia la respuesta (la función ordena, no confía)', () => {
    const alReves: CargoPorEdad[] = [
      { diasAtraso: 10, importe: 1000 },
      { diasAtraso: 40, importe: 1000 },
    ];
    expect(diasVencidosDeCartera(alReves, 1000)).toBe(10);
  });

  it('no muta la lista que recibe', () => {
    const cargos: CargoPorEdad[] = [
      { diasAtraso: 10, importe: 1000 },
      { diasAtraso: 40, importe: 1000 },
    ];
    diasVencidosDeCartera(cargos, 0);
    expect(cargos[0]?.diasAtraso).toBe(10);
  });

  it('el ruido de redondeo NO revive un cargo ya pagado; un centavo de verdad SÍ', () => {
    // Los importes llegan de un `SUM(...)::numeric` y arrastran fracciones de centavo. Una décima
    // de centavo colgando de un cargo pagado no puede seguir marcando 40 días de atraso.
    expect(
      diasVencidosDeCartera(
        [
          { diasAtraso: 40, importe: 1000.001 },
          { diasAtraso: 10, importe: 1000 },
        ],
        1000,
      ),
    ).toBe(10);
    // Un centavo real sí es deuda, y sigue siendo el más viejo.
    expect(
      diasVencidosDeCartera(
        [
          { diasAtraso: 40, importe: 1000.01 },
          { diasAtraso: 10, importe: 1000 },
        ],
        1000,
      ),
    ).toBe(40);
  });

  it('un cargo dentro de plazo tapado por los pagos deja la cartera sin edad', () => {
    expect(diasVencidosDeCartera([{ diasAtraso: -5, importe: 100 }], 100)).toBeNull();
  });
});

describe('vencimientoEsMa (quién envejece en EsMa, y desde cuándo)', () => {
  const fecha = new Date('2026-09-01T00:00:00.000Z');

  it('⭐ el CARGO vence: fecha + los días de crédito del proveedor', () => {
    expect(vencimientoEsMa('cargo', fecha, 8)?.toISOString().slice(0, 10)).toBe('2026-09-09');
  });

  it('⭐ el ABONO de EsMa TAMBIÉN vence: allí suma (es un cargo extra al maquilero)', () => {
    // Ésta es la trampa de la fila: la etiqueta `abono` es la del motor, donde RESTA. Si el
    // vencimiento se pidiera por el ORIGEN, este renglón saldría sin fecha y sin edad.
    expect(vencimientoEsMa('abono', fecha, 30)?.toISOString().slice(0, 10)).toBe('2026-10-01');
  });

  it('el PAGO y el DESCUENTO son créditos: no vencen nunca', () => {
    expect(vencimientoEsMa('pago', fecha, 30)).toBeNull();
    expect(vencimientoEsMa('descuento', fecha, 30)).toBeNull();
  });

  it('sin plazo (contado, 0 días) vence el mismo día', () => {
    expect(vencimientoEsMa('cargo', fecha, 0)?.toISOString().slice(0, 10)).toBe('2026-09-01');
  });
});
