import { describe, expect, it } from 'vitest';

import type { HabilitacionAvio } from '@/api/tipos';

import {
  ETIQUETA_ESTADO_HAB,
  aSurtirDefault,
  claseBarraHab,
  tonoEstadoHab,
} from './habilitacion-piezas';

/** Renglón de habilitación base, sobrescribible. */
function avio(over: Partial<HabilitacionAvio> = {}): HabilitacionAvio {
  return {
    idAvio: 3,
    clave: 'BOT-01',
    descripcion: 'Botón',
    unidad: 'pza',
    esGenerico: false,
    requerido: 180,
    enviado: 100,
    falta: 80,
    porcentaje: 55.5,
    esExtra: false,
    estado: 'parcial',
    consumoPorTalla: false,
    tallasSinMedida: [],
    ...over,
  };
}

describe('habilitacion-piezas (R6, B13)', () => {
  it('tonoEstadoHab mapea cada estado a su tono semántico', () => {
    expect(tonoEstadoHab('completo')).toBe('ok');
    expect(tonoEstadoHab('parcial')).toBe('warn');
    expect(tonoEstadoHab('pendiente')).toBe('neutro');
    expect(tonoEstadoHab('sobre-surtido')).toBe('info');
    expect(tonoEstadoHab('extra')).toBe('info');
  });

  it('ETIQUETA_ESTADO_HAB tiene texto legible para cada estado', () => {
    expect(ETIQUETA_ESTADO_HAB['sobre-surtido']).toBe('Sobre-surtido');
    expect(ETIQUETA_ESTADO_HAB.extra).toBe('Extra');
  });

  it('claseBarraHab tiñe la barra por estado', () => {
    expect(claseBarraHab('completo')).toBe('bg-ok');
    expect(claseBarraHab('pendiente')).toBe('bg-border-strong');
    expect(claseBarraHab('sobre-surtido')).toBe('bg-info');
  });

  it('aSurtirDefault = la falta; 0 en completos y extras', () => {
    expect(aSurtirDefault(avio({ falta: 80 }))).toBe(80);
    expect(aSurtirDefault(avio({ estado: 'completo', falta: 0 }))).toBe(0);
    // Un extra nunca propone surtir (requerido 0).
    expect(aSurtirDefault(avio({ esExtra: true, falta: 0, requerido: 0 }))).toBe(0);
  });
});
