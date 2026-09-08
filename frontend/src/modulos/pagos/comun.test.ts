/**
 * LAS REGLAS PURAS DE LA PANTALLA DE LA CORRIDA (fila 0.113).
 *
 * ⭐ La primera de ellas —que la REFERENCIA nunca llene el campo de captura— vive aquí y no en la
 * prueba del DOM por una razón medida: mientras era una expresión dentro del componente, la
 * mutación que la hacía leer `fila.saldo` **sobrevivía**, porque el `useEffect` de
 * resincronización corregía el valor en el mismo tick y la prueba sólo veía el resultado ya
 * corregido. Extraída, se puede romper de verdad.
 */
import { describe, expect, it } from 'vitest';

import type { FilaCorrida, RenglonCorrida } from '@/api/tipos';

import {
  montoEditable,
  moneda,
  textoDiasVencidos,
  textoReferencia,
  textoTotales,
  tieneCaptura,
} from './comun';

/** Un renglón capturado mínimo (los campos que estas reglas miran). */
function renglon(monto: number | null): RenglonCorrida {
  return {
    id: 1,
    origen: 'maquila',
    idProveedor: 5,
    idConcepto: null,
    rubro: 'maquila',
    nombre: 'TALLER NORTE',
    monto,
    formaPago: 'efectivo',
    idCuenta: null,
    beneficiario: 'TALLER NORTE',
    banco: null,
    tipoCuenta: null,
    ultimos4: null,
    aliasCuenta: null,
    cuentaEsFiscal: null,
    concepto: null,
    referencia: null,
    idPagoMaquilero: null,
    idMovimientoTercero: null,
  };
}

/** Una fila de maquilero con referencia gorda (saldo, por revisar y recibos de la semana). */
const filaConReferencia: FilaCorrida = {
  origen: 'maquila',
  idProveedor: 5,
  idConcepto: null,
  rubro: 'maquila',
  nombre: 'TALLER NORTE',
  nombreCorto: 'TN',
  formaPagoSugerida: 'efectivo',
  idCuentaSugerida: null,
  cuentas: [],
  puedeConFactura: false,
  saldo: 12_345,
  vencido: null,
  diasVencidos: 12,
  porRevisarNeto: 500,
  porRevisarPartidas: 2,
  recibosSemanaImporte: 9_000,
  recibosSemanaCantidad: 300,
  renglones: [],
  totalCapturado: 0,
};

describe('⭐ el campo «a pagar esta semana» sale SÓLO del renglón capturado', () => {
  it('sin renglón, el campo va VACÍO — nunca con el saldo ni con lo recibido', () => {
    expect(montoEditable(null)).toBe('');
  });

  it('con renglón, el campo trae SU monto', () => {
    expect(montoEditable(renglon(7_500))).toBe('7500');
  });

  it('un renglón en CERO se ve como cero (no como vacío): ahí ya se decidió no pagar', () => {
    expect(montoEditable(renglon(0))).toBe('0');
  });

  it('con los importes ocultos el campo va vacío, no en cero inventado', () => {
    expect(montoEditable(renglon(null))).toBe('');
  });
});

describe('la referencia que se enseña al lado', () => {
  it('un maquilero enseña lo que espera revisión y lo recibido en la semana', () => {
    const texto = textoReferencia(filaConReferencia);
    expect(texto).toContain('por revisar');
    expect(texto).toContain('2 partidas');
    expect(texto).toContain('recibió 300 pzas');
  });

  it('un maquilero sin nada pendiente ni recibido no enseña ruido', () => {
    expect(
      textoReferencia({
        ...filaConReferencia,
        porRevisarPartidas: 0,
        porRevisarNeto: 0,
        recibosSemanaCantidad: 0,
        recibosSemanaImporte: 0,
      }),
    ).toBe('');
  });

  it('un proveedor de estado de cuenta enseña lo VENCIDO, no lo recibido', () => {
    const texto = textoReferencia({
      ...filaConReferencia,
      origen: 'proveedor',
      rubro: 'proveedores',
      vencido: 4_000,
    });
    expect(texto).toContain('vencido');
    expect(texto).not.toContain('recibió');
  });

  it('⭐ un CONCEPTO del catálogo no tiene referencia: nace en cero', () => {
    // ⚠️ La fila lleva A PROPÓSITO saldo, pendiente, recibos Y vencido, aunque el servidor mande
    // todo eso en null para un concepto: lo que se mide es que el corte por `origen` sea una REGLA
    // y no una casualidad de nulos. Sin esta carga, quitar el corte pasaba en verde (mutación
    // medida: sobrevivía) porque los nulos hacían el resto del camino inofensivo.
    expect(
      textoReferencia({
        ...filaConReferencia,
        origen: 'concepto',
        rubro: 'caja_chica',
        idProveedor: null,
        idConcepto: 3,
        vencido: 4_000,
      }),
    ).toBe('');
  });
});

describe('los totales, como Daniel cierra su relación', () => {
  it('efectivo y transferencia por separado, y el total', () => {
    expect(
      textoTotales({ efectivo: 30_000, transferencia: 108_201, total: 138_201, renglones: 3 }),
    ).toBe('$30,000.00 efectivo · $108,201.00 transferencia · total $138,201.00');
  });

  it('con los importes ocultos, los tres van en «—»', () => {
    expect(textoTotales({ efectivo: null, transferencia: null, total: null, renglones: 3 })).toBe(
      '— efectivo · — transferencia · total —',
    );
  });
});

describe('si una fila ya tiene algo capturado', () => {
  it('se mide por el CONTEO de renglones, no por el importe', () => {
    // Con los importes ocultos el monto viaja en `null` y aun así hay que ver que ya se decidió.
    expect(tieneCaptura({ ...filaConReferencia, renglones: [renglon(null)] })).toBe(true);
    expect(tieneCaptura(filaConReferencia)).toBe(false);
  });
});

describe('el formato de dinero', () => {
  it('«—» es el ocultamiento de importes, no un cero', () => {
    expect(moneda(null)).toBe('—');
    expect(moneda(0)).toBe('$0.00');
  });
});

describe('⭐ LOS DÍAS VENCIDOS de la fila (0.121, §Post-F9.218(a))', () => {
  /**
   * DANIEL: *«Es irrelevante [los tramos]. Ni siquiera veo eso. **Solo con que pongas los días
   * vencidos es suficiente**.»* Aquí se fija que los tres estados digan cosas DISTINTAS: un «0» a
   * secas donde debería ir «—» se leería como «no debe nada», que es lo contrario de lo que pasa.
   */
  const con = (diasVencidos: number | null): FilaCorrida => ({
    ...filaConReferencia,
    diasVencidos,
  });

  it('un número de días se enseña como número', () => {
    expect(textoDiasVencidos(con(12))).toBe('12 d');
    expect(textoDiasVencidos(con(365))).toBe('365 d');
  });

  it('CERO no es «—»: debe, pero está dentro de su plazo', () => {
    expect(textoDiasVencidos(con(0))).toBe('al día');
  });

  it('«—» es «no hay nada que envejecer», y NO se confunde con el cero', () => {
    expect(textoDiasVencidos(con(null))).toBe('—');
    expect(textoDiasVencidos(con(null))).not.toBe(textoDiasVencidos(con(0)));
  });

  it('un concepto del catálogo no tiene cuenta corriente: celda vacía', () => {
    expect(textoDiasVencidos({ ...con(30), origen: 'concepto' })).toBe('');
  });

  it('los días NO se cuelan en el texto de referencia (tienen columna propia)', () => {
    expect(textoReferencia(con(12))).not.toContain('12 d');
  });
});
