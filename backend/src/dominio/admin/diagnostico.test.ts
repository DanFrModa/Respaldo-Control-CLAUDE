import { describe, expect, it } from 'vitest';

import { describirCron } from './diagnostico.js';

/**
 * El cron del respaldo se le muestra a quien opera el sistema, no a quien lo programó: «0 8 1 * *»
 * no le dice nada a nadie. Se traduce SIEMPRE con la hora del centro de México al lado, porque la
 * pregunta real es «¿a qué hora corre?», no «¿en qué huso lo guardó pg-boss?».
 */
describe('describirCron', () => {
  it('traduce el cron mensual por defecto, con la hora local', () => {
    expect(describirCron('0 8 1 * *')).toBe(
      'El día 1 de cada mes a las 08:00 UTC (02:00 del centro de México)',
    );
  });

  it('traduce un cron diario', () => {
    expect(describirCron('30 7 * * *')).toBe(
      'Todos los días a las 07:30 UTC (01:30 del centro de México)',
    );
  });

  it('devuelve el cron tal cual cuando no es una forma que sepa traducir', () => {
    expect(describirCron('*/15 * * * 1-5')).toBe('*/15 * * * 1-5');
  });

  it('no inventa nada si el cron viene mal formado', () => {
    expect(describirCron('esto no es un cron')).toBe('esto no es un cron');
  });
});
