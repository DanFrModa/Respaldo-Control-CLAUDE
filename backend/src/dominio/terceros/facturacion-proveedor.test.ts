// Los dos tipos de proveedor de Daniel (§Post-F9.22) — y por qué son TRES estados y no dos.

import { describe, expect, it } from 'vitest';

import {
  admiteCfdi,
  emiteFactura,
  exigirProveedorQueFactura,
  modalidadFactura,
} from './facturacion-proveedor.js';
import { resolverSegmentoCxp } from './cxp/facturacion-cxp.js';

describe('emiteFactura (la única derivación, fila 0.124)', () => {
  it('deriva el booleano de la modalidad, y solo de ella', () => {
    expect(emiteFactura('solo_con')).toBe(true);
    // `ambos` SÍ timbra: qué movimiento va con y cuál sin factura lo decide `resolverConFactura`.
    expect(emiteFactura('ambos')).toBe(true);
    expect(emiteFactura('solo_sin')).toBe(false);
    // Proveedor migrado: la pregunta nunca se hizo. NO es "no factura" (REGLA 0-B).
    expect(emiteFactura(null)).toBeNull();
    expect(emiteFactura(undefined)).toBeNull();
  });
});

describe('modalidadFactura', () => {
  it('distingue al que factura, al que no, y al que nadie definió', () => {
    expect(modalidadFactura('solo_con')).toBe('factura');
    expect(modalidadFactura('ambos')).toBe('factura');
    expect(modalidadFactura('solo_sin')).toBe('sin-factura');
    expect(modalidadFactura(null)).toBe('no-definida');
    expect(modalidadFactura(undefined)).toBe('no-definida');
  });
});

describe('admiteCfdi', () => {
  it('solo deja fuera al que NUNCA factura', () => {
    expect(admiteCfdi('solo_con')).toBe(true);
    expect(admiteCfdi('ambos')).toBe(true);
    expect(admiteCfdi('solo_sin')).toBe(false);
    // Los proveedores migrados traen NULL: apagarles la lectura de facturas por un dato que nadie
    // capturó sería peor que dejarlos pasar (el CFDI que manden es prueba de que sí timbran).
    expect(admiteCfdi(null)).toBe(true);
  });
});

describe('exigirProveedorQueFactura', () => {
  it('deja pasar al que factura y al migrado sin modalidad definida', () => {
    expect(() => {
      exigirProveedorQueFactura(
        { nombre: 'Bloom', modalidadFacturacion: 'solo_con' },
        'guardar la factura',
      );
    }).not.toThrow();
    expect(() => {
      exigirProveedorQueFactura(
        { nombre: 'Mixto', modalidadFacturacion: 'ambos' },
        'guardar la factura',
      );
    }).not.toThrow();
    expect(() => {
      exigirProveedorQueFactura(
        { nombre: 'Migrado', modalidadFacturacion: null },
        'guardar la factura',
      );
    }).not.toThrow();
  });

  it('corta el paso al informal, diciendo qué se intentaba y dónde se corrige', () => {
    const informal = { nombre: 'Don Chuy', modalidadFacturacion: 'solo_sin' } as const;
    expect(() => {
      exigirProveedorQueFactura(informal, 'capturar el documento');
    }).toThrow(/Don Chuy/);
    expect(() => {
      exigirProveedorQueFactura(informal, 'capturar el documento');
    }).toThrow(/capturar el documento/);
    // El mensaje manda al campo que HOY manda, no a la casilla retirada (fila 0.124).
    expect(() => {
      exigirProveedorQueFactura(informal, 'capturar el documento');
    }).toThrow(/¿Cómo factura\?/);
    expect(() => {
      exigirProveedorQueFactura(informal, 'capturar el documento');
    }).toThrow(/catálogo de proveedores/);
  });
});

// ── LA PRUEBA QUE NACIÓ ROJA (fila 0.124) ────────────────────────────────────────────────────────
// Un proveedor contestaba la pregunta "¿facturas?" DOS veces —`factura` y `modalidadFacturacion`—
// y nada impedía que se contradijera. Aquí se mide con UN solo registro de proveedor, tal como
// vive en la base, pasado por las DOS puertas que clasifican su dinero: la del almacén de telas
// (`admiteCfdi`/`exigirProveedorQueFactura`) y la de la captura de CxP (`resolverSegmentoCxp`).
describe('una sola pregunta de facturación (fila 0.124)', () => {
  /**
   * El proveedor que midió la fila, ya con UNA sola respuesta: en la base su columna vieja dice
   * `factura=false` y su modalidad dice `solo_con`. Aquí ni siquiera se puede escribir la
   * contradicción —el objeto ya no lleva `factura`—, que es justo el punto; la contradicción real,
   * con el registro completo, la mide `entradas-tela.int.test.ts`.
   */
  const QUE_FACTURA = {
    nombre: 'Taller de la esquina',
    modalidadFacturacion: 'solo_con',
  } as const;

  it('el que factura SIEMPRE entra con factura por las dos puertas', () => {
    // Puerta 1 — el almacén de telas (entrada de tela / CFDI).
    expect(() => {
      exigirProveedorQueFactura(QUE_FACTURA, 'capturar el documento como FACTURA');
    }).not.toThrow();
    // Puerta 2 — la captura de CxP (de aquí sale por dónde se le paga).
    expect(resolverSegmentoCxp('pago', QUE_FACTURA.modalidadFacturacion, undefined)).toBe(true);
  });

  it('el que NUNCA factura queda fuera del camino del CFDI por las dos puertas', () => {
    const soloSin = { nombre: 'Don Chuy', modalidadFacturacion: 'solo_sin' } as const;
    expect(admiteCfdi(soloSin.modalidadFacturacion)).toBe(false);
    expect(() => {
      exigirProveedorQueFactura(soloSin, 'capturar el documento como FACTURA');
    }).toThrow(/Don Chuy/);
    expect(resolverSegmentoCxp('pago', soloSin.modalidadFacturacion, undefined)).toBe(false);
  });
});
