// Prueba unitaria del sellado del CFDI: la entrada SIN factura no debe tocar R2 ni la BD.
//
// Por qué existe: al construir §Post-F9.21 el servicio de archivos se resolvía como VALOR POR
// DEFECTO del parámetro (`archivos: ServicioArchivos = servicioArchivos()`), que JavaScript evalúa
// en CADA llamada — aunque no hubiera XML. Como `servicioArchivos()` valida las llaves de R2 contra
// el entorno, capturar una entrada de tela normal reventaba donde R2 no está configurado (el CI).
// Este test fija el contrato: sin XML se sale antes de resolver nada.

import { describe, expect, it } from 'vitest';

import { sellarCfdiEnEntrada } from './cfdi-entrada-tela.js';

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
