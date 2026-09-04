import { describe, expect, it } from 'vitest';

import { ErrorValidacion } from '../../comun/errores.js';

import {
  cargoDeEntradaDeProveedor,
  claseDeDeuda,
  ORIGEN_FACTURA_PROVEEDOR,
  REF_ENTRADA_TELA,
  REF_RECEPCION_COMPRA,
  type EntradaQueGeneraCargo,
} from './cargo-de-entrada.js';

/**
 * ⭐⭐ FILA 0.129 — LOS CUATRO CASOS DE "¿QUÉ DEUDA NACE AL RECIBIR?", MEDIDOS EN UN SOLO SITIO.
 *
 * Esta regla vivía dentro de `inventarios/entradas-tela.ts` y sólo se ejercitaba con la base de
 * datos de por medio (`.int.test.ts`, que corre en CI). Al extraerla a una función PURA se puede
 * medir aquí, sin Docker y en milisegundos — y, sobre todo, se mide UNA vez para las DOS puertas
 * que la usan: la entrada de tela por factura y la recepción de avíos contra la OC.
 *
 * Los RFC de estas pruebas son inventados (repo público): `AAA010101AAA` / `BBB020202BB2`.
 */

/**
 * Entrada mínima de una recepción de avíos (sin CFDI: por esa puerta nunca se sella XML). El
 * proveedor arranca en `solo_sin` — el ÚNICO que hace nacer el cargo al recibir (fila 0.124).
 */
function entradaBase(over: Partial<EntradaQueGeneraCargo> = {}): EntradaQueGeneraCargo {
  return {
    proveedor: { id: 7, nombre: 'Avíos del Centro', rfc: null, modalidadFacturacion: 'solo_sin' },
    fecha: '2026-09-04',
    refTipo: REF_RECEPCION_COMPRA,
    refId: 42,
    folio: 15,
    numeroDocumento: 'REM-900',
    etiqueta: 'Recepción de compra',
    importeCapturado: 100,
    ...over,
  };
}

describe('cargoDeEntradaDeProveedor — proveedor que NO factura (cargo no fiscal)', () => {
  it('nace el cargo por lo capturado a mano, ligado a la operación por refTipo/refId', () => {
    const cargo = cargoDeEntradaDeProveedor(entradaBase({ importeCapturado: 1234.5 }));
    expect(cargo).not.toBeNull();
    expect(cargo).toMatchObject({
      tipoTercero: 'proveedor',
      idTercero: 7,
      fecha: '2026-09-04',
      origen: ORIGEN_FACTURA_PROVEEDOR,
      refTipo: REF_RECEPCION_COMPRA,
      refId: 42,
      importe: 1234.5,
      esFiscal: false,
    });
    // Sin CFDI de por medio, el cargo NO lleva folio fiscal ni RFC (no hay comprobante que citar).
    expect(cargo?.uuidCfdi).toBeUndefined();
    expect(cargo?.rfcTercero).toBeUndefined();
  });

  it('la observación dice de qué documento salió (etiqueta + folio + número del proveedor)', () => {
    expect(cargoDeEntradaDeProveedor(entradaBase())?.observaciones).toBe(
      'Recepción de compra 15 · REM-900 · proveedor sin factura (importe capturado a mano)',
    );
    // Y la MISMA función, con la etiqueta de la otra puerta, escribe lo que la tela escribía antes
    // de extraer la regla (byte por byte: es lo que garantiza que nada cambió al compartirla).
    expect(
      cargoDeEntradaDeProveedor(
        entradaBase({
          etiqueta: 'Entrada de tela',
          refTipo: REF_ENTRADA_TELA,
          folio: 5,
          numeroDocumento: 'F-100',
        }),
      )?.observaciones,
    ).toBe('Entrada de tela 5 · F-100 · proveedor sin factura (importe capturado a mano)');
  });

  it('redondea a centavos (el importe vive en DECIMAL(14,2) y cantidad×precio trae cola)', () => {
    // 3 × 33.333 = 99.999 → 100.00 (y no un importe que la base tendría que truncar sola).
    expect(cargoDeEntradaDeProveedor(entradaBase({ importeCapturado: 99.999 }))?.importe).toBe(100);
    expect(cargoDeEntradaDeProveedor(entradaBase({ importeCapturado: 12.344 }))?.importe).toBe(
      12.34,
    );
  });

  it('un importe menor a un centavo NO genera cargo (registrar una deuda de cero es ruido)', () => {
    expect(cargoDeEntradaDeProveedor(entradaBase({ importeCapturado: 0 }))).toBeNull();
    expect(cargoDeEntradaDeProveedor(entradaBase({ importeCapturado: 0.004 }))).toBeNull();
    // El mínimo del motor de terceros es 0.01: justo ahí SÍ nace.
    expect(cargoDeEntradaDeProveedor(entradaBase({ importeCapturado: 0.005 }))?.importe).toBe(0.01);
  });
});

describe('cargoDeEntradaDeProveedor — proveedor que factura, o sin definir: NO nace cargo', () => {
  it('`solo_con` y todavía no llega el CFDI → null (factura pendiente)', () => {
    expect(
      cargoDeEntradaDeProveedor(
        entradaBase({
          proveedor: {
            id: 7,
            nombre: 'Telas del Norte',
            rfc: 'AAA010101AAA',
            modalidadFacturacion: 'solo_con',
          },
        }),
      ),
    ).toBeNull();
  });

  it('⭐ `ambos` TAMPOCO hace nacer el cargo: de él sí puede llegar un CFDI', () => {
    // Es la mitad que la fila 0.124 dejó explícita: "factura unas cosas sí y otras no" SÍ timbra,
    // así que su deuda nace con el comprobante. Qué renglón es con y cuál sin lo parte después
    // `resolverConFactura`, movimiento por movimiento — no esta puerta.
    expect(
      cargoDeEntradaDeProveedor(
        entradaBase({
          proveedor: {
            id: 7,
            nombre: 'Mixtos SA',
            rfc: 'AAA010101AAA',
            modalidadFacturacion: 'ambos',
          },
        }),
      ),
    ).toBeNull();
  });

  it('proveedor SIN la modalidad definida (migrado de Access) → null: nada se inventa', () => {
    expect(
      cargoDeEntradaDeProveedor(
        entradaBase({
          proveedor: { id: 7, nombre: 'Proveedor Migrado', rfc: null, modalidadFacturacion: null },
        }),
      ),
    ).toBeNull();
  });
});

describe('cargoDeEntradaDeProveedor — con CFDI sellado: cargo FISCAL por el total del comprobante', () => {
  const conCfdi = (over: Partial<EntradaQueGeneraCargo> = {}) =>
    entradaBase({
      proveedor: {
        id: 7,
        nombre: 'Telas del Norte',
        rfc: 'AAA010101AAA',
        modalidadFacturacion: 'solo_con',
      },
      etiqueta: 'Entrada de tela',
      refTipo: REF_ENTRADA_TELA,
      numeroDocumento: 'F-100',
      cfdi: { uuid: 'UUID-1', total: 5800, rfc: 'AAA010101AAA', idArchivo: 'arch-1' },
      // El importe capturado a mano se IGNORA cuando hay comprobante: el CFDI trae el total CON
      // impuestos y la suma de renglones va sin IVA.
      importeCapturado: 5000,
      ...over,
    });

  it('el importe es el TOTAL del CFDI (no la suma de renglones) y viaja el RFC del emisor', () => {
    expect(cargoDeEntradaDeProveedor(conCfdi())).toMatchObject({
      importe: 5800,
      esFiscal: true,
      uuidCfdi: 'UUID-1',
      rfcTercero: 'AAA010101AAA',
      idArchivoCfdi: 'arch-1',
      observaciones: 'Entrada de tela 15 · factura F-100',
    });
  });

  it('sin archivo del XML el cargo nace igual (el adjunto es opcional)', () => {
    const cargo = cargoDeEntradaDeProveedor(
      conCfdi({
        cfdi: {
          uuid: 'UUID-2',
          total: 10,
          rfc: 'AAA010101AAA',
          idArchivo: null,
        },
      }),
    );
    expect(cargo?.idArchivoCfdi).toBeUndefined();
  });

  it('⭐ CERROJO: si el CFDI no dice qué RFC lo emitió, NO nace el cargo (falla cerrado)', () => {
    expect(() =>
      cargoDeEntradaDeProveedor(
        conCfdi({ cfdi: { uuid: 'UUID-3', total: 10, rfc: null, idArchivo: null } }),
      ),
    ).toThrow(ErrorValidacion);
  });

  it('⭐ CERROJO: el proveedor sin RFC capturado no puede recibir un cargo fiscal', () => {
    expect(() =>
      cargoDeEntradaDeProveedor(
        conCfdi({
          proveedor: { id: 7, nombre: 'Sin RFC SA', rfc: null, modalidadFacturacion: 'solo_con' },
        }),
      ),
    ).toThrow(/no tiene RFC capturado/);
  });

  it('⭐ CERROJO: emisor distinto del proveedor del documento → se rechaza (nombre y RFC)', () => {
    expect(() =>
      cargoDeEntradaDeProveedor(
        conCfdi({ cfdi: { uuid: 'UUID-4', total: 10, rfc: 'BBB020202BB2', idArchivo: null } }),
      ),
    ).toThrow(/nacería a nombre de quien no facturó/);
  });

  it('el RFC se compara NORMALIZADO: espacios y minúsculas no cambian quién facturó', () => {
    expect(
      cargoDeEntradaDeProveedor(
        conCfdi({
          proveedor: {
            id: 7,
            nombre: 'Telas del Norte',
            rfc: ' aaa010101aaa ',
            modalidadFacturacion: 'solo_con',
          },
        }),
      ),
    ).toMatchObject({ esFiscal: true });
  });

  it('con CFDI manda el comprobante AUNQUE la modalidad diga que NUNCA factura', () => {
    // La evidencia manda sobre el catálogo (misma regla que `resolverEsFiscalMotor`): si hay un
    // comprobante timbrado, degradarlo a "sin factura" consumiría el UUID para siempre.
    expect(
      cargoDeEntradaDeProveedor(
        conCfdi({
          proveedor: {
            id: 7,
            nombre: 'Telas del Norte',
            rfc: 'AAA010101AAA',
            modalidadFacturacion: 'solo_sin',
          },
        }),
      ),
    ).toMatchObject({ esFiscal: true, importe: 5800 });
  });
});

describe('claseDeDeuda — cómo se LEE la deuda de una entrada ya guardada', () => {
  it('con cargo → cargo-no-fiscal', () => {
    expect(claseDeDeuda({ hayCargo: true, importe: 500 })).toBe('cargo-no-fiscal');
  });

  it('sin cargo pero con importe → factura-pendiente (la deuda nace con el CFDI)', () => {
    expect(claseDeDeuda({ hayCargo: false, importe: 500 })).toBe('factura-pendiente');
  });

  it('sin cargo y sin importe → sin-importe (no hay nada que cobrar)', () => {
    expect(claseDeDeuda({ hayCargo: false, importe: 0 })).toBe('sin-importe');
    expect(claseDeDeuda({ hayCargo: false, importe: 0.004 })).toBe('sin-importe');
  });

  it('la generada por una ENTRADA DE TELA lo dice: su deuda vive en ese documento', () => {
    expect(claseDeDeuda({ hayCargo: false, importe: 900, deEntradaTela: true })).toBe(
      'en-entrada-de-tela',
    );
  });

  /**
   * ⭐ RONDA 2 DE LA 0.129 — LA ANULACIÓN LA DICE EL SERVIDOR, no la pantalla.
   *
   * El campo contestaba `cargo-no-fiscal` de una recepción ya reversada (el cargo existe, pero
   * está cancelado) y era el frontend el que escondía la etiqueta. Con la regla en la UI, cualquier
   * otro consumidor del API —un reporte, un export— leía una deuda que ya no existe.
   */
  describe('anulada / cargo cancelado → `cancelada` (y la traza se conserva)', () => {
    it('la recepción REVERSADA ya no debe nada, aunque su cargo siga existiendo', () => {
      expect(claseDeDeuda({ hayCargo: true, importe: 300, anulada: true })).toBe('cancelada');
    });

    it('el cargo cancelado a mano en Finanzas cuenta igual', () => {
      expect(claseDeDeuda({ hayCargo: true, importe: 300, cargoCancelado: true })).toBe(
        'cancelada',
      );
    });

    it('la anulación MANDA sobre las demás clases (incluida la de la entrada de tela)', () => {
      expect(
        claseDeDeuda({ hayCargo: false, importe: 900, deEntradaTela: true, anulada: true }),
      ).toBe('cancelada');
      expect(claseDeDeuda({ hayCargo: false, importe: 0, anulada: true })).toBe('cancelada');
    });

    it('sin anular, nada cambia: el cargo vivo se sigue anunciando', () => {
      expect(
        claseDeDeuda({ hayCargo: true, importe: 300, anulada: false, cargoCancelado: false }),
      ).toBe('cargo-no-fiscal');
    });
  });
});
