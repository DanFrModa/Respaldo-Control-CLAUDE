import { describe, expect, it } from 'vitest';

import { ErrorValidacion } from '../../comun/errores.js';
import { resolverConFactura } from './facturacion.js';

/**
 * Unit del resolvedor de facturación (F6-E4, decisión (h)) — SIN Postgres. La modalidad del proveedor
 * fija el `conFactura` del movimiento; "ambos" obliga a elegir con/sin.
 */
describe('resolverConFactura (F6-E4, decisión h)', () => {
  it('solo_con → siempre true (ignora lo enviado)', () => {
    expect(resolverConFactura('solo_con', undefined)).toBe(true);
    expect(resolverConFactura('solo_con', false)).toBe(true);
  });

  it('solo_sin → siempre false (ignora lo enviado)', () => {
    expect(resolverConFactura('solo_sin', undefined)).toBe(false);
    expect(resolverConFactura('solo_sin', true)).toBe(false);
  });

  it('ambos → respeta lo enviado', () => {
    expect(resolverConFactura('ambos', true)).toBe(true);
    expect(resolverConFactura('ambos', false)).toBe(false);
  });

  it('ambos SIN elección → ErrorValidacion (hay que elegir con/sin)', () => {
    expect(() => resolverConFactura('ambos', undefined)).toThrow(ErrorValidacion);
  });

  it('sin modalidad (null) → usa lo enviado o queda null', () => {
    expect(resolverConFactura(null, true)).toBe(true);
    expect(resolverConFactura(null, false)).toBe(false);
    expect(resolverConFactura(null, undefined)).toBeNull();
  });
});
