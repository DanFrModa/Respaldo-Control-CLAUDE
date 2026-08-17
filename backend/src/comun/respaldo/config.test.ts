/**
 * Pruebas del GUARD de configuración del respaldo (V1-E6a). Aquí se verifica lo contrario de lo
 * habitual: que el sistema se NIEGUE a programar un respaldo que no serviría, y que diga por qué.
 * Un job de respaldo que arranca a medias configurado es la fuente exacta de la confianza falsa que
 * esta etapa combate.
 */
import { describe, expect, it } from 'vitest';

import { timeoutVolcadoMinutos } from './pg-dump.js';

import {
  configRespaldoDesdeEnv,
  CRON_DEFECTO,
  MARGEN_CORRIDA_MIN,
  ventanaCorridaMinutos,
  decidirArranqueRespaldo,
  PREFIJO_DEFECTO,
  RETENCION_DEFECTO,
  respaldoActivo,
} from './config.js';

/** Un entorno con TODO en orden (R2 real y llave larga). */
const ENV_BUENO: Record<string, string> = {
  RESPALDO_LLAVE: 'Xk8sMq2vPz7RtL5nWc3bYh9jFd6gA4eU',
  R2_ACCOUNT_ID: 'cuenta-real-de-cloudflare',
  R2_ACCESS_KEY_ID: 'AKIAREALREALREAL',
  R2_SECRET_ACCESS_KEY: 'secreto-real-de-verdad-largo',
  R2_BUCKET: 'control-v2-prueba',
};

describe('configRespaldoDesdeEnv', () => {
  it('aplica los valores por defecto cuando solo viene la llave', () => {
    const config = configRespaldoDesdeEnv(ENV_BUENO);
    expect(config.retencion).toBe(RETENCION_DEFECTO);
    expect(config.retencion).toBe(12); // 12 respaldos mensuales = un año
    expect(config.prefijo).toBe(PREFIJO_DEFECTO);
    expect(config.cron).toBe(CRON_DEFECTO);
    expect(config.pgDump).toBe('pg_dump');
  });

  it('la corrida es MENSUAL por defecto (día 1, 02:00 hora del centro de México)', () => {
    // 08:00 UTC = 02:00 en UTC-6, y México no cambia de horario: la conversión no se desfasa.
    expect(CRON_DEFECTO).toBe('0 8 1 * *');
    expect(configRespaldoDesdeEnv(ENV_BUENO).cron).toBe('0 8 1 * *');
  });

  it('la frecuencia se puede cambiar por entorno sin tocar el código', () => {
    expect(configRespaldoDesdeEnv({ ...ENV_BUENO, RESPALDO_CRON: '0 8 * * 0' }).cron).toBe(
      '0 8 * * 0',
    );
  });

  it('respeta la retención configurada por entorno', () => {
    expect(configRespaldoDesdeEnv({ ...ENV_BUENO, RESPALDO_RETENCION: '24' }).retencion).toBe(24);
  });

  it('rechaza una retención absurda (0 no dejaría ningún respaldo; texto no es un número)', () => {
    expect(() => configRespaldoDesdeEnv({ ...ENV_BUENO, RESPALDO_RETENCION: '0' })).toThrow(
      /al menos 1/i,
    );
    expect(() => configRespaldoDesdeEnv({ ...ENV_BUENO, RESPALDO_RETENCION: 'mucho' })).toThrow(
      /Configuración del respaldo incompleta/i,
    );
  });

  it('exige la llave, y que sea larga (de ella sale la llave AES)', () => {
    expect(() => configRespaldoDesdeEnv({ ...ENV_BUENO, RESPALDO_LLAVE: undefined })).toThrow(
      /RESPALDO_LLAVE/,
    );
    expect(() => configRespaldoDesdeEnv({ ...ENV_BUENO, RESPALDO_LLAVE: 'corta' })).toThrow(
      /demasiado corta/i,
    );
  });

  it('el mensaje de error dice qué hacer, no solo qué falló', () => {
    expect(() => configRespaldoDesdeEnv({ ...ENV_BUENO, RESPALDO_LLAVE: 'x' })).toThrow(
      /openssl rand -base64 32/,
    );
  });
});

describe('respaldoActivo', () => {
  it('está encendido por omisión y solo se apaga con la palabra exacta', () => {
    expect(respaldoActivo({})).toBe(true);
    expect(respaldoActivo({ RESPALDO_ACTIVO: 'true' })).toBe(true);
    expect(respaldoActivo({ RESPALDO_ACTIVO: 'no' })).toBe(true); // solo 'false' apaga
    expect(respaldoActivo({ RESPALDO_ACTIVO: 'false' })).toBe(false);
  });
});

describe('decidirArranqueRespaldo', () => {
  it('con todo en orden, programa', () => {
    const decision = decidirArranqueRespaldo(ENV_BUENO);
    expect(decision.accion).toBe('programar');
    expect(decision.config?.retencion).toBe(12);
  });

  it('apagado a propósito: no programa y lo dice (sin fingir que hay respaldo)', () => {
    const decision = decidirArranqueRespaldo({ ...ENV_BUENO, RESPALDO_ACTIVO: 'false' });
    expect(decision.accion).toBe('apagado');
    expect(decision.mensaje).toMatch(/NO tiene segundo respaldo/i);
  });

  it('NO programa con credenciales R2 de relleno (dev/CI): subiría a una cuenta inexistente', () => {
    const decision = decidirArranqueRespaldo({ ...ENV_BUENO, R2_ACCESS_KEY_ID: 'dev' });
    expect(decision.accion).toBe('sin-config');
    expect(decision.mensaje).toMatch(/credenciales R2.*relleno/i);
  });

  it('NO programa sin bucket ni cuenta de Cloudflare', () => {
    expect(decidirArranqueRespaldo({ ...ENV_BUENO, R2_BUCKET: '' }).accion).toBe('sin-config');
    expect(decidirArranqueRespaldo({ ...ENV_BUENO, R2_ACCOUNT_ID: '' }).accion).toBe('sin-config');
  });

  it('NO programa con R2_SUBIDA_LOCAL=true: ese modo es un no-op y "subiría" a la nada', () => {
    const decision = decidirArranqueRespaldo({ ...ENV_BUENO, R2_SUBIDA_LOCAL: 'true' });
    expect(decision.accion).toBe('sin-config');
    expect(decision.mensaje).toMatch(/NO-OP/);
  });

  it('NO programa sin llave de cifrado, y el motivo viaja en el mensaje', () => {
    const decision = decidirArranqueRespaldo({ ...ENV_BUENO, RESPALDO_LLAVE: undefined });
    expect(decision.accion).toBe('sin-config');
    expect(decision.mensaje).toMatch(/RESPALDO_LLAVE/);
  });

  it('⚠️ una llave VACÍA no se cuela como válida (cifraría con frase vacía)', () => {
    // Cicatriz: un `.default('')` en el esquema hacía que Zod NO revalidara el valor por omisión y
    // una llave ausente pasaba como cadena vacía. Un respaldo cifrado con frase vacía es un
    // respaldo que abre cualquiera.
    for (const llave of ['', '   ', undefined]) {
      expect(decidirArranqueRespaldo({ ...ENV_BUENO, RESPALDO_LLAVE: llave }).accion).toBe(
        'sin-config',
      );
      expect(() => configRespaldoDesdeEnv({ ...ENV_BUENO, RESPALDO_LLAVE: llave })).toThrow(
        /RESPALDO_LLAVE/,
      );
    }
  });

  it('nunca devuelve `programar` sin configuración resuelta', () => {
    for (const env of [
      ENV_BUENO,
      { ...ENV_BUENO, RESPALDO_LLAVE: undefined },
      { ...ENV_BUENO, R2_ACCESS_KEY_ID: 'dev' },
      { RESPALDO_ACTIVO: 'false' },
      {},
    ]) {
      const decision = decidirArranqueRespaldo(env);
      expect(decision.accion === 'programar').toBe(decision.config !== undefined);
    }
  });
});

describe('ventanaCorridaMinutos (el número que NO puede contradecirse)', () => {
  it('es el tope del volcado más el margen del resto de la corrida', () => {
    // Un SOLO valor alimenta el `expireInSeconds` del job y el umbral del barrido de huérfanas. De
    // que no coincidieran nació el defecto de las corridas solapadas: pg-boss reintentaba a los 15
    // min encima de una corrida que el timeout permitía extender hasta 3 h.
    expect(ventanaCorridaMinutos({})).toBe(180 + MARGEN_CORRIDA_MIN);
  });

  it('sigue al tope configurado por entorno', () => {
    expect(ventanaCorridaMinutos({ RESPALDO_TIMEOUT_MIN: '30' })).toBe(30 + MARGEN_CORRIDA_MIN);
  });

  it('es SIEMPRE mayor que el tope del volcado (si no, se barrería una corrida viva)', () => {
    for (const minutos of ['1', '30', '180', '600', 'basura']) {
      const env = { RESPALDO_TIMEOUT_MIN: minutos };
      expect(ventanaCorridaMinutos(env)).toBeGreaterThan(timeoutVolcadoMinutos(env));
    }
  });

  it('supera con holgura el expire por defecto de pg-boss (15 min), que era el que mandaba', () => {
    expect(ventanaCorridaMinutos({}) * 60).toBeGreaterThan(900);
  });
});
