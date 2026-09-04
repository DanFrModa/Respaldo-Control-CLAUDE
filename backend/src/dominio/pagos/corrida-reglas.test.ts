/**
 * LAS REGLAS PURAS DE LA CORRIDA SEMANAL (fila 0.113), antes de tocar la base.
 *
 * Lo que se mide aquí es lo que decide dinero sin necesitar Postgres: cómo se identifica la semana,
 * qué renglones salen en la relación, cómo se separan los totales de efectivo y transferencia, y
 * cuál es la forma de pago sugerida de un beneficiario. Lo que necesita base (la guarda fiscal al
 * cerrar, el nacimiento de los movimientos al ejecutar) vive en `corrida.int.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import { formaPagoSugerida, rubroDeProveedor, ultimos4 } from './beneficiarios.js';
import { pideDecision } from './corrida.js';
import type { FilaCorridaSalida } from '../../contrato/index.js';
import { aFechaIso, lunesDeLaSemana, rangoDeLaSemana } from './semana.js';
import { redondear2, tieneMonto, totalesDe } from './totales.js';

describe('la semana de la corrida', () => {
  it('cualquier día de la semana identifica el MISMO lunes', () => {
    // 2026-09-01 es martes. De lunes 31-ago a domingo 6-sep, todos son «la semana del 31».
    const dias = [
      '2026-08-31',
      '2026-09-01',
      '2026-09-02',
      '2026-09-03',
      '2026-09-04',
      '2026-09-05',
      '2026-09-06',
    ];
    for (const dia of dias) {
      expect(lunesDeLaSemana(dia), `${dia} debería caer en la semana del 31-ago`).toBe(
        '2026-08-31',
      );
    }
  });

  it('⭐ el DOMINGO pertenece a la semana que ya iba, no a la que empieza mañana', () => {
    // El caso que un `getDay() - 1` ingenuo rompe: domingo es 0, y restarle 1 da −1.
    expect(lunesDeLaSemana('2026-09-06')).toBe('2026-08-31');
    expect(lunesDeLaSemana('2026-09-07')).toBe('2026-09-07'); // el lunes siguiente ya es otra semana
  });

  it('el rango de la semana abarca de lunes a domingo', () => {
    expect(rangoDeLaSemana('2026-08-31')).toEqual({ desde: '2026-08-31', hasta: '2026-09-06' });
  });

  it('no se corre de día al cruzar meses ni años', () => {
    expect(lunesDeLaSemana('2027-01-01')).toBe('2026-12-28'); // viernes 1-ene-2027
    expect(rangoDeLaSemana('2026-12-28')).toEqual({ desde: '2026-12-28', hasta: '2027-01-03' });
  });

  it('la fecha de la columna y su texto ida y vuelta dan lo mismo', () => {
    expect(aFechaIso(new Date('2026-08-31T00:00:00.000Z'))).toBe('2026-08-31');
  });
});

describe('qué renglones salen en la relación', () => {
  it('⭐ un renglón en CERO no sale (así nacen los conceptos predeterminados)', () => {
    expect(tieneMonto(0)).toBe(false);
  });

  it('un renglón con monto sale', () => {
    expect(tieneMonto(0.01)).toBe(true);
    expect(tieneMonto(30_000)).toBe(true);
  });

  it('medio centavo de tolerancia: un residuo de coma flotante no cuela un renglón fantasma', () => {
    expect(tieneMonto(0.0001)).toBe(false);
    expect(tieneMonto(1e-15)).toBe(false);
  });
});

describe('los totales de la relación (efectivo y transferencia por separado)', () => {
  const renglones = [
    { monto: 30_000, formaPago: 'efectivo' as const },
    { monto: 100_000, formaPago: 'transferencia' as const },
    { monto: 8_201, formaPago: 'transferencia' as const },
    // Un renglón en cero: se ve en pantalla, pero no es un pago.
    { monto: 0, formaPago: 'transferencia' as const },
  ];

  it('separa efectivo de transferencia y suma el total', () => {
    // Los números son los de la semana real de Daniel (§Post-F9.185(d)): 30,000 + 108,201.
    expect(totalesDe(renglones, true)).toEqual({
      efectivo: 30_000,
      transferencia: 108_201,
      total: 138_201,
      renglones: 3,
    });
  });

  it('⭐ el renglón en cero NO se cuenta ni suma', () => {
    const totales = totalesDe(renglones, true);
    expect(totales.renglones).toBe(3); // son cuatro renglones, tres con monto
  });

  it('sin permiso de ver importes se ocultan los TRES importes, pero NUNCA el conteo', () => {
    // Misma regla que `pendienteParaSalida` en la fórmula del saldo: el conteo no es un importe, y
    // sin él quien no puede ver dinero tampoco sabría que hay pagos.
    expect(totalesDe(renglones, false)).toEqual({
      efectivo: null,
      transferencia: null,
      total: null,
      renglones: 3,
    });
  });

  it('una relación vacía da ceros y cero renglones', () => {
    expect(totalesDe([], true)).toEqual({
      efectivo: 0,
      transferencia: 0,
      total: 0,
      renglones: 0,
    });
  });

  it('redondea a dos decimales (nada de 0.1 + 0.2)', () => {
    const t = totalesDe(
      [
        { monto: 0.1, formaPago: 'efectivo' },
        { monto: 0.2, formaPago: 'efectivo' },
      ],
      true,
    );
    expect(t.efectivo).toBe(0.3);
    expect(redondear2(0.1 + 0.2)).toBe(0.3);
  });
});

describe('⭐ los totales CUADRAN POR CONSTRUCCIÓN', () => {
  /**
   * 🔴 Sale de LEER el archivo real que finanzas arma cada semana: su pie lleva TRES totales
   * —efectivo, «factura» y «remisión»— **que no cuadran entre sí**, porque ahí las columnas de
   * clasificación no son excluyentes y un mismo pago puede aparecer en dos.
   *
   * Aquí eso no puede pasar, y no por disciplina sino por FORMA: un renglón lleva UN monto, UNA
   * forma de pago (efectivo | transferencia) y vive en UNA corrida, que es de UN segmento (con |
   * sin factura). Así que:
   *
   *   Σ montos  ==  efectivo + transferencia          (dentro de una corrida)
   *   Σ montos de la corrida CON + Σ de la SIN  ==  Σ de la semana
   *
   * Esta prueba lo fija: si alguien hiciera que un renglón pudiera contarse en dos cubetas, se pone
   * roja. Es la garantía de que los tres totales del pie salen solos y suman.
   */
  const renglones = [
    { monto: 30_000, formaPago: 'efectivo' as const },
    { monto: 100_000, formaPago: 'transferencia' as const },
    { monto: 8_201, formaPago: 'transferencia' as const },
    { monto: 0, formaPago: 'efectivo' as const },
    { monto: 1_234.56, formaPago: 'efectivo' as const },
  ];

  it('efectivo + transferencia == el total, siempre', () => {
    const t = totalesDe(renglones, true);
    expect((t.efectivo ?? 0) + (t.transferencia ?? 0)).toBe(t.total);
  });

  it('el total es la Σ de los renglones CON monto, ni uno más ni uno menos', () => {
    const t = totalesDe(renglones, true);
    const suma = redondear2(
      renglones.filter((r) => tieneMonto(r.monto)).reduce((s, r) => s + r.monto, 0),
    );
    expect(t.total).toBe(suma);
    expect(t.renglones).toBe(4);
  });

  it('⭐ un renglón cae en UNA cubeta y sólo una (nada de contarse dos veces)', () => {
    // Se comprueba partiendo el conjunto por forma de pago: las dos mitades suman el todo y
    // ninguna comparte renglones con la otra.
    const efectivo = renglones.filter((r) => r.formaPago === 'efectivo');
    const transferencia = renglones.filter((r) => r.formaPago === 'transferencia');
    expect(efectivo.length + transferencia.length).toBe(renglones.length);
    const t = totalesDe(renglones, true);
    expect(totalesDe(efectivo, true).total).toBe(t.efectivo);
    expect(totalesDe(transferencia, true).total).toBe(t.transferencia);
  });

  it('⭐ las DOS corridas de la semana (con y sin factura) suman el total de la semana', () => {
    // Cada corrida es de UN segmento, así que la partición con/sin es la corrida misma: no hay
    // forma de que un renglón cuente en las dos.
    const sinFactura = [
      { monto: 30_000, formaPago: 'efectivo' as const },
      { monto: 8_201, formaPago: 'transferencia' as const },
    ];
    const conFactura = [{ monto: 100_000, formaPago: 'transferencia' as const }];
    const tSin = totalesDe(sinFactura, true);
    const tCon = totalesDe(conFactura, true);
    const tSemana = totalesDe([...sinFactura, ...conFactura], true);
    expect((tSin.total ?? 0) + (tCon.total ?? 0)).toBe(tSemana.total);
    expect(tSin.renglones + tCon.renglones).toBe(tSemana.renglones);
  });
});

describe('la forma de pago sugerida de un beneficiario', () => {
  it('⭐ la preferencia guardada MANDA, aunque tenga cuentas', () => {
    // Daniel: *«de pronto un maquilero me pide que le pague una semana en efectivo»*.
    expect(formaPagoSugerida('efectivo', true)).toBe('efectivo');
    expect(formaPagoSugerida('transferencia', false)).toBe('transferencia');
  });

  it('sin preferencia se deduce de la realidad: con cuenta transferencia, sin cuenta efectivo', () => {
    expect(formaPagoSugerida(null, true)).toBe('transferencia');
    expect(formaPagoSugerida(null, false)).toBe('efectivo');
  });
});

describe('el rubro de un proveedor (la sección de la relación)', () => {
  it('con algún rol de maquila cae en «maquileros»', () => {
    // §Post-F9.185(b): *«corte es parte de maquilas, no de proveedores»*.
    expect(rubroDeProveedor(['maquila-costura'])).toBe('maquila');
    expect(rubroDeProveedor(['tela', 'estampado'])).toBe('maquila');
    expect(rubroDeProveedor(['bordado'])).toBe('maquila');
  });

  it('sin ningún rol de maquila cae en «proveedores»', () => {
    // *«Transportistas y demás proveedores sí salen del estado de cuenta.»*
    expect(rubroDeProveedor(['tela'])).toBe('proveedores');
    expect(rubroDeProveedor([])).toBe('proveedores');
  });
});

describe('lo que la pantalla enseña de una cuenta', () => {
  it('sólo los últimos 4 dígitos', () => {
    expect(ultimos4('012345678901234567')).toBe('4567');
  });

  it('una cuenta más corta que 4 no truena (devuelve lo que hay)', () => {
    expect(ultimos4('12')).toBe('12');
  });
});

describe('⭐ qué filas suben en la pantalla (B6: se enseña TODO, se ORDENA)', () => {
  /**
   * La corrida trae **toda** la cartera del segmento, sin recortar: en ella no hay «agregar
   * proveedor», así que esconder a alguien lo deja sin cobrar y eso no tiene arreglo desde la
   * pantalla. Lo que sí se hace es subir lo que pide una decisión. Esta es esa regla.
   */
  const base: FilaCorridaSalida = {
    origen: 'maquila',
    idProveedor: 1,
    idConcepto: null,
    rubro: 'maquila',
    nombre: 'TALLER NORTE',
    nombreCorto: null,
    formaPagoSugerida: 'efectivo',
    idCuentaSugerida: null,
    cuentas: [],
    puedeConFactura: false,
    saldo: 0,
    vencido: null,
    porRevisarNeto: null,
    porRevisarPartidas: 0,
    recibosSemanaImporte: null,
    recibosSemanaCantidad: 0,
    renglones: [],
    totalCapturado: 0,
  };

  it('quien no debe nada, no tiene pendientes y no se ha capturado, NO sube', () => {
    expect(pideDecision(base)).toBe(false);
  });

  it('quien tiene SALDO sube', () => {
    expect(pideDecision({ ...base, saldo: 1_200 })).toBe(true);
    expect(pideDecision({ ...base, saldo: -800 })).toBe(true); // un anticipo también es decisión
  });

  it('⭐ quien tiene PARTIDAS esperando revisión sube, aunque su saldo sea cero', () => {
    // §Post-F9.188a: el maquilero con todo sin revisar tiene saldo 0 y es justo sobre quien hay que
    // decidir. Si el orden lo mandara al fondo, volvería a quedar sepultado.
    expect(pideDecision({ ...base, saldo: 0, porRevisarPartidas: 2 })).toBe(true);
  });

  it('⭐ quien YA tiene un renglón capturado sube (aunque su saldo sea cero)', () => {
    expect(pideDecision({ ...base, renglones: [{ id: 1 } as never] })).toBe(true);
  });

  it('⭐ con los importes OCULTOS el criterio sigue funcionando por conteo, no por dinero', () => {
    // Con `consultas.ver-importes` apagado el saldo viaja en null: si la regla mirara sólo importes,
    // mandaría TODAS las filas al fondo justo para quien no puede ver dinero.
    expect(pideDecision({ ...base, saldo: null, porRevisarPartidas: 3 })).toBe(true);
    expect(pideDecision({ ...base, saldo: null, renglones: [{ id: 9 } as never] })).toBe(true);
    expect(pideDecision({ ...base, saldo: null })).toBe(false);
  });

  it('medio centavo de tolerancia: un residuo no cuela una fila al principio', () => {
    expect(pideDecision({ ...base, saldo: 0.0001 })).toBe(false);
    expect(pideDecision({ ...base, saldo: 0.01 })).toBe(true);
  });
});
