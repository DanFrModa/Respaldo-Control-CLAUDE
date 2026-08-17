/**
 * Pruebas de la traducción de `DATABASE_URL` a variables de libpq (V1-E6a).
 *
 * Es una función chica pero con dos responsabilidades que sí importan:
 *  • **Que la contraseña NO acabe en la línea de comandos.** Los argumentos de un proceso los lee
 *    cualquiera que liste procesos (`/proc/<pid>/cmdline`); su entorno, no. Esta función existe para
 *    que la credencial de la base viaje por entorno.
 *  • **Que el nombre de la base salga aparte**, porque `pg_restore` —a diferencia de `psql` y de
 *    `pg_dump`— NO lo toma de `PGDATABASE` y aborta pidiendo `--dbname`. Esa diferencia costó una
 *    corrida fallida del ensayo de restauración; queda fijada aquí.
 */
import { describe, expect, it } from 'vitest';

import {
  ErrorVolcado,
  MARGEN_CORRIDA_MIN,
  TIMEOUT_VOLCADO_MIN_DEFECTO,
  timeoutVolcadoMinutos,
  variablesLibpq,
  ventanaCorridaMinutos,
} from './pg-dump.js';

describe('variablesLibpq', () => {
  it('traduce una URL completa a las variables de libpq', () => {
    expect(
      variablesLibpq('postgresql://control:secreto@postgres.railway.internal:5432/railway'),
    ).toStrictEqual({
      PGHOST: 'postgres.railway.internal',
      PGDATABASE: 'railway',
      PGPORT: '5432',
      PGUSER: 'control',
      PGPASSWORD: 'secreto',
    });
  });

  it('la contraseña sale SOLO como variable de entorno (nunca como argumento)', () => {
    const variables = variablesLibpq('postgresql://u:Cl4v3-Sup3r@host:5432/base');
    expect(variables.PGPASSWORD).toBe('Cl4v3-Sup3r');
    // Ningún otro campo la repite: quien arme los argumentos del proceso no puede filtrarla sin querer.
    const otros = { ...variables, PGPASSWORD: undefined };
    expect(JSON.stringify(otros)).not.toContain('Cl4v3-Sup3r');
  });

  it('desescapa los caracteres especiales de usuario y contraseña', () => {
    const variables = variablesLibpq('postgresql://usu%40rio:p%40ss%3Aword@host:5432/base');
    expect(variables.PGUSER).toBe('usu@rio');
    expect(variables.PGPASSWORD).toBe('p@ss:word');
  });

  it('acepta el esquema corto `postgres://`', () => {
    expect(variablesLibpq('postgres://host/base').PGDATABASE).toBe('base');
  });

  it('omite lo que no viene (sin puerto, sin usuario, sin contraseña)', () => {
    expect(variablesLibpq('postgresql://host/base')).toStrictEqual({
      PGHOST: 'host',
      PGDATABASE: 'base',
    });
  });

  it('traduce sslmode e ignora los parámetros que son de Prisma, no de libpq', () => {
    const variables = variablesLibpq(
      'postgresql://u:c@host:5432/base?sslmode=require&schema=public&connection_limit=5',
    );
    expect(variables.PGSSLMODE).toBe('require');
    expect(variables).not.toHaveProperty('schema');
    expect(variables).not.toHaveProperty('connection_limit');
  });

  it('rechaza una URL que no es de PostgreSQL, con mensaje entendible', () => {
    expect(() => variablesLibpq('mysql://host/base')).toThrow(ErrorVolcado);
    expect(() => variablesLibpq('mysql://host/base')).toThrow(/no apunta a PostgreSQL/i);
    expect(() => variablesLibpq('esto-no-es-una-url')).toThrow(/no es una URL de conexión válida/i);
  });

  it('rechaza una URL sin nombre de base (no habría qué volcar)', () => {
    expect(() => variablesLibpq('postgresql://u:c@host:5432/')).toThrow(
      /no incluye el nombre de la base/i,
    );
  });
});

describe('timeoutVolcadoMinutos', () => {
  it('usa 180 minutos por defecto', () => {
    expect(timeoutVolcadoMinutos({})).toBe(TIMEOUT_VOLCADO_MIN_DEFECTO);
    expect(TIMEOUT_VOLCADO_MIN_DEFECTO).toBe(180);
  });

  it('respeta el tope configurado por entorno', () => {
    expect(timeoutVolcadoMinutos({ RESPALDO_TIMEOUT_MIN: '30' })).toBe(30);
  });

  it('ignora valores absurdos y cae al default (nunca deja el volcado sin tope)', () => {
    // Un tope de 0 o negativo mataría el volcado al instante; un texto daría NaN y el setTimeout
    // dispararía de inmediato. En los tres casos vale más el default que un respaldo imposible.
    for (const crudo of ['0', '-5', 'muchos', '']) {
      expect(timeoutVolcadoMinutos({ RESPALDO_TIMEOUT_MIN: crudo })).toBe(
        TIMEOUT_VOLCADO_MIN_DEFECTO,
      );
    }
  });
});

describe('ventanaCorridaMinutos (el número que NO puede contradecirse)', () => {
  it('es el tope del volcado más el margen del resto de la corrida', () => {
    // Un SOLO valor alimenta el `expireInSeconds` del job, el de la COLA y el umbral del barrido de
    // huérfanas. De que no coincidieran nació el defecto de las corridas solapadas: pg-boss
    // reintentaba a los 15 min encima de una corrida que el tope permitía extender hasta 3 h.
    expect(ventanaCorridaMinutos({})).toBe(TIMEOUT_VOLCADO_MIN_DEFECTO + MARGEN_CORRIDA_MIN);
    expect(ventanaCorridaMinutos({})).toBe(240);
  });

  it('sigue al tope configurado por entorno (por eso no se teclea en ningún lado)', () => {
    expect(ventanaCorridaMinutos({ RESPALDO_TIMEOUT_MIN: '30' })).toBe(30 + MARGEN_CORRIDA_MIN);
    expect(ventanaCorridaMinutos({ RESPALDO_TIMEOUT_MIN: '600' })).toBe(600 + MARGEN_CORRIDA_MIN);
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
