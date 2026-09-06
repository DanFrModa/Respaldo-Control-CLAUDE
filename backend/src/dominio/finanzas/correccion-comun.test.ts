/**
 * Las piezas PURAS de la corrección de un movimiento sin factura (fila 0.145). Se prueban sueltas
 * —sin base de datos— porque son las que deciden si una corrección tiene sentido y qué queda al
 * final, y esa decisión no debería necesitar un Postgres para comprobarse.
 */
import { describe, expect, it } from 'vitest';

import { esquemaCorreccionSinFactura } from '../../contrato/index.js';

import { esCorregibleMotor, esSinFactura, resolverCambios } from './correccion-comun.js';

describe('esSinFactura · el segmento es del MOVIMIENTO, no del proveedor', () => {
  it('CON factura (true) NO es corregible', () => {
    expect(esSinFactura(true)).toBe(false);
  });

  it('sin factura (false) sí lo es', () => {
    expect(esSinFactura(false)).toBe(true);
  });

  it('⭐ SIN DEFINIR (null) cuenta como SIN factura, igual que en la partición de siempre', () => {
    // No es una laxitud: `whereSegmentoFactura('sin')` mete los NULL en el segmento «sin factura»
    // desde la 0.113, y los movimientos migrados de Access vienen así. Si aquí dijera `false`,
    // habría movimientos que la relación de pagos SÍ considera «sin factura» y que nadie podría
    // corregir — un hueco justo en los datos más viejos (REGLA 0-B: se toleran, no se reparan).
    expect(esSinFactura(null)).toBe(true);
  });
});

describe('resolverCambios · qué queda al final, y si de verdad cambió algo', () => {
  const actual = { monto: 100, fecha: '2026-09-01', observaciones: 'pago semana 35' };

  it('lo que no se manda se conserva', () => {
    const r = resolverCambios(actual, { importe: 250 });
    expect(r).toEqual({
      monto: 250,
      fecha: '2026-09-01',
      observaciones: 'pago semana 35',
      hayCambio: true,
    });
  });

  it('cambiar sólo la fecha basta para que haya cambio', () => {
    expect(resolverCambios(actual, { fecha: '2026-09-02' }).hayCambio).toBe(true);
  });

  it('`observaciones: null` las BORRA (y eso también es un cambio)', () => {
    const r = resolverCambios(actual, { observaciones: null });
    expect(r.observaciones).toBeNull();
    expect(r.hayCambio).toBe(true);
  });

  it('la cadena vacía se guarda como null, no como ""', () => {
    // Un texto vacío y «sin texto» son la misma cosa para quien lee el estado de cuenta; guardar
    // `''` dejaría dos formas de decir lo mismo y una comparación que a veces falla.
    expect(resolverCambios(actual, { observaciones: '' }).observaciones).toBeNull();
  });

  it('🔴 mandar EXACTAMENTE lo que ya estaba NO es un cambio', () => {
    // Si esto pasara, cada «guardar» sin tocar nada quemaría dos folios y metería dos renglones
    // vacíos de contenido en el estado de cuenta.
    const r = resolverCambios(actual, {
      importe: 100,
      fecha: '2026-09-01',
      observaciones: 'pago semana 35',
    });
    expect(r.hayCambio).toBe(false);
  });

  it('el importe se redondea a 2 decimales antes de comparar', () => {
    expect(resolverCambios({ ...actual, monto: 100.35 }, { importe: 100.349 }).hayCambio).toBe(
      false,
    );
  });
});

describe('esCorregibleMotor · las condiciones del renglón del motor', () => {
  const vivo = {
    esFiscal: false,
    uuidCfdi: null,
    idArchivoCfdi: null,
    cancelado: false,
    idMovimientoInverso: null,
  };

  it('sin la BANDERA no se corrige nada, aunque el renglón sea perfecto', () => {
    expect(esCorregibleMotor(vivo, false)).toBe(false);
    expect(esCorregibleMotor(vivo, true)).toBe(true);
  });

  it('🔴 un renglón FISCAL queda intocable', () => {
    expect(esCorregibleMotor({ ...vivo, esFiscal: true }, true)).toBe(false);
  });

  it('🔴 y también uno con UUID o archivo de CFDI colgando, aunque `esFiscal` diga false', () => {
    // Defensa en profundidad: `esFiscal` es una bandera y el CFDI es el hecho. Si por lo que sea
    // divergieran, manda el hecho.
    expect(esCorregibleMotor({ ...vivo, uuidCfdi: 'ABC-123' }, true)).toBe(false);
    expect(esCorregibleMotor({ ...vivo, idArchivoCfdi: 'arch_1' }, true)).toBe(false);
  });

  it('un movimiento ya cancelado, o que ES un inverso, no se corrige', () => {
    expect(esCorregibleMotor({ ...vivo, cancelado: true }, true)).toBe(false);
    expect(esCorregibleMotor({ ...vivo, idMovimientoInverso: 9 }, true)).toBe(false);
  });
});

describe('esquemaCorreccionSinFactura · lo que el cuerpo NO deja mandar', () => {
  it('acepta importe + motivo', () => {
    const r = esquemaCorreccionSinFactura.safeParse({ importe: 10, motivo: 'me equivoqué' });
    expect(r.success).toBe(true);
  });

  it('🔴 exige el MOTIVO (es la mitad del «con rastro»)', () => {
    expect(esquemaCorreccionSinFactura.safeParse({ importe: 10 }).success).toBe(false);
    expect(esquemaCorreccionSinFactura.safeParse({ importe: 10, motivo: '  ' }).success).toBe(
      false,
    );
  });

  it('🔴 exige al menos UN cambio: un motivo suelto no es una corrección', () => {
    expect(esquemaCorreccionSinFactura.safeParse({ motivo: 'porque sí' }).success).toBe(false);
  });

  it('🔴🔴 CAMBIAR DE PROVEEDOR se rechaza: no es un campo de este cuerpo (strict)', () => {
    // La guarda de verdad es estructural —el servidor toma el tercero del movimiento corregido, no
    // de la petición—, pero el `strict` hace que el intento se conteste con un 400 explícito en vez
    // de ignorarse en silencio, que es la forma en la que un cliente se cree que sí cambió.
    const r = esquemaCorreccionSinFactura.safeParse({
      importe: 10,
      motivo: 'x',
      idProveedor: 77,
    });
    expect(r.success).toBe(false);
  });

  it('🔴🔴 CAMBIAR DE TIPO DE MOVIMIENTO también se rechaza', () => {
    expect(
      esquemaCorreccionSinFactura.safeParse({ importe: 10, motivo: 'x', origen: 'abono' }).success,
    ).toBe(false);
    expect(
      esquemaCorreccionSinFactura.safeParse({ importe: 10, motivo: 'x', concepto: 'pago' }).success,
    ).toBe(false);
  });

  it('y tampoco deja mover el segmento con/sin factura', () => {
    expect(
      esquemaCorreccionSinFactura.safeParse({ importe: 10, motivo: 'x', esFiscal: true }).success,
    ).toBe(false);
    expect(
      esquemaCorreccionSinFactura.safeParse({ importe: 10, motivo: 'x', conFactura: true }).success,
    ).toBe(false);
  });

  it('un importe de 0 o negativo no pasa', () => {
    expect(esquemaCorreccionSinFactura.safeParse({ importe: 0, motivo: 'x' }).success).toBe(false);
    expect(esquemaCorreccionSinFactura.safeParse({ importe: -5, motivo: 'x' }).success).toBe(false);
  });
});
