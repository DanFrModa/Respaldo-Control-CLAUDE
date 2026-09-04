/**
 * Tests UNITARIOS de la ETIQUETA de un cargo EsMa (0.114). Es una función pura y la ÚNICA fuente de
 * esa palabra: la consumen el estado de cuenta (y su PDF y su Excel), el desglosado, la cola de
 * validación, la conciliación, el recibo de pago y el libro unificado de terceros. Si aquí dice
 * «Corte», allá dice «Corte».
 */
import { describe, expect, it } from 'vitest';

import { etiquetaProcesoDelCargo } from './etiqueta-cargo.js';

describe('etiquetaProcesoDelCargo (0.114)', () => {
  it('un cargo de MAQUILA se etiqueta con el nombre de su proceso', () => {
    expect(etiquetaProcesoDelCargo({ tipoProceso: { nombre: 'Costura' }, servicio: null })).toBe(
      'Costura',
    );
    expect(etiquetaProcesoDelCargo({ tipoProceso: { nombre: 'Estampado' }, servicio: null })).toBe(
      'Estampado',
    );
  });

  it('⭐ un cargo de SERVICIO se etiqueta «Corte» / «Empaque», no con el código del enum', () => {
    // Lo que se lee en pantalla es español con mayúscula inicial, no `corte`/`empaque` a pelo.
    expect(etiquetaProcesoDelCargo({ tipoProceso: null, servicio: 'corte' })).toBe('Corte');
    expect(etiquetaProcesoDelCargo({ tipoProceso: null, servicio: 'empaque' })).toBe('Empaque');
  });

  it('el SERVICIO manda si por lo que sea llegaran los dos (la BD lo impide con un CHECK)', () => {
    // Caso imposible por el CHECK `esma_cargo_proceso_o_servicio`; se fija el desempate para que
    // nunca dependa del orden de los `if`.
    expect(etiquetaProcesoDelCargo({ tipoProceso: { nombre: 'Costura' }, servicio: 'corte' })).toBe(
      'Corte',
    );
  });

  it('con los DOS en null devuelve cadena vacía en vez de tumbar el reporte', () => {
    // También imposible por el CHECK. Esta función vive en la ruta de LECTURA de seis reportes: un
    // dato torcido no debe dejar sin estado de cuenta a nadie.
    expect(etiquetaProcesoDelCargo({ tipoProceso: null, servicio: null })).toBe('');
  });
});
