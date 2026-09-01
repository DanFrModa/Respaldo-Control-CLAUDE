// Prueba unitaria del sellado del CFDI: la entrada SIN factura no debe tocar R2 ni la BD.
//
// Por qué existe: al construir §Post-F9.21 el servicio de archivos se resolvía como VALOR POR
// DEFECTO del parámetro (`archivos: ServicioArchivos = servicioArchivos()`), que JavaScript evalúa
// en CADA llamada — aunque no hubiera XML. Como `servicioArchivos()` valida las llaves de R2 contra
// el entorno, capturar una entrada de tela normal reventaba donde R2 no está configurado (el CI).
// Este test fija el contrato: sin XML se sale antes de resolver nada.

import { describe, expect, it } from 'vitest';

import { avisoSinPendientesDeTela, sellarCfdiEnEntrada } from './cfdi-entrada-tela.js';

describe('sellarCfdiEnEntrada — sin factura no hace nada (§Post-F9.21)', () => {
  const sinR2 = () => {
    const llaves = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'];
    const previas = llaves.map((k) => [k, process.env[k]] as const);
    for (const k of llaves) delete process.env[k];
    return () => {
      for (const [k, v] of previas) if (v !== undefined) process.env[k] = v;
    };
  };

  it('devuelve null cuando la captura no trae XML, sin exigir R2 ni base de datos', async () => {
    const restaurar = sinR2();
    try {
      await expect(
        sellarCfdiEnEntrada({ xml: null, idProveedor: 1, idEmpresa: 1 }),
      ).resolves.toBeNull();
    } finally {
      restaurar();
    }
  });

  it('trata un XML en blanco como "sin factura"', async () => {
    const restaurar = sinR2();
    try {
      await expect(
        sellarCfdiEnEntrada({ xml: '   \n ', idProveedor: 1, idEmpresa: 1 }),
      ).resolves.toBeNull();
    } finally {
      restaurar();
    }
  });
});

/**
 * 🔴🔴 **EL AVISO NO PUEDE AFIRMAR MÁS DE LO QUE SE PREGUNTÓ** (§Post-F9.159(a)).
 *
 * Los pendientes se consultan ACOTADOS a una orden cuando la lectura llegó desde ella, así que su
 * vacío no sostiene ninguna frase sobre el proveedor entero. Aquí se prueba el TEXTO y su
 * disparador sin base de datos; que el disparador se alimente del `idOrdenCompra` de la lectura lo
 * cubre `cfdi-entrada-tela.int.test.ts` (lo corre CI, contra Postgres).
 */
describe('avisoSinPendientesDeTela — la frase mide hasta dónde se preguntó', () => {
  it('SIN acotar: se preguntó por TODO el proveedor, así que la frase puede nombrarlo', () => {
    const aviso = avisoSinPendientesDeTela(false);
    expect(aviso).toMatch(/Ese proveedor no tiene renglones de tela pendientes/);
    // Ahí sí es cierto que lo que falta es la COMPRA.
    expect(aviso).toMatch(/Levanta \(o autoriza\)/);
  });

  it('🔴 ACOTADO a una orden: habla de ESA orden y no manda a autorizar lo ya autorizado', () => {
    const aviso = avisoSinPendientesDeTela(true);
    expect(aviso).toMatch(/Esta orden de compra ya no tiene renglones de tela pendientes/);
    // Las dos mitades falsas de la versión anterior: el proveedor (al que no se le preguntó) y el
    // imperativo imposible (a este camino se llega desde una OC que YA está autorizada).
    expect(aviso).not.toMatch(/Ese proveedor/);
    expect(aviso).not.toMatch(/Levanta \(o autoriza\)/);
    // Y deja una salida real para la tela que sí es de otra orden.
    expect(aviso).toMatch(/Nueva entrada/);
  });

  it('las dos frases son DISTINTAS (una sola redacción no puede ser cierta en los dos alcances)', () => {
    expect(avisoSinPendientesDeTela(true)).not.toBe(avisoSinPendientesDeTela(false));
  });
});
