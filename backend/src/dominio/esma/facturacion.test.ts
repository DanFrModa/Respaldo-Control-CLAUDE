import { describe, expect, it } from 'vitest';

import { ErrorValidacion } from '../../comun/errores.js';
import {
  MENSAJE_AMBOS_SIN_ELEGIR,
  MENSAJE_SIN_MODALIDAD,
  resolverConFactura,
} from './facturacion.js';

/**
 * Unit del resolvedor de facturación (F6-E4 decisión (h); fila 0.110) — SIN Postgres. La modalidad
 * del proveedor fija el `conFactura` del movimiento; "ambos" obliga a elegir con/sin; y **sin
 * modalidad NO se captura** (§Post-F9.186(a)).
 */
describe('resolverConFactura — los tres caminos que ya funcionaban (no se tocan)', () => {
  it('solo_con → siempre true (ignora lo enviado)', () => {
    expect(resolverConFactura('solo_con', undefined)).toBe(true);
    expect(resolverConFactura('solo_con', false)).toBe(true);
    expect(resolverConFactura('solo_con', true)).toBe(true);
  });

  it('solo_sin → siempre false (ignora lo enviado)', () => {
    expect(resolverConFactura('solo_sin', undefined)).toBe(false);
    expect(resolverConFactura('solo_sin', true)).toBe(false);
    expect(resolverConFactura('solo_sin', false)).toBe(false);
  });

  it('ambos → respeta lo enviado', () => {
    expect(resolverConFactura('ambos', true)).toBe(true);
    expect(resolverConFactura('ambos', false)).toBe(false);
  });

  it('ambos SIN elección → ErrorValidacion (hay que elegir con/sin)', () => {
    expect(() => resolverConFactura('ambos', undefined)).toThrow(ErrorValidacion);
    expect(() => resolverConFactura('ambos', undefined)).toThrow(MENSAJE_AMBOS_SIN_ELEGIR);
  });
});

/**
 * ⭐ LA PUERTA TRASERA QUE SE CIERRA (fila 0.110). Antes el `default` hacía `return solicitado ??
 * null` y el movimiento nacía sin clasificar — y `convivencia-esma.ts` lo contaba como SIN factura
 * en silencio. Ahora LANZA, se haya mandado lo que se haya mandado.
 */
describe('resolverConFactura — proveedor SIN modalidad: NO se captura', () => {
  it('sin modalidad y sin elección → LANZA (no devuelve null)', () => {
    expect(() => resolverConFactura(null, undefined)).toThrow(ErrorValidacion);
    expect(() => resolverConFactura(null, undefined)).toThrow(MENSAJE_SIN_MODALIDAD);
  });

  it('sin modalidad LANZA aunque el usuario mande el valor: la modalidad se define primero', () => {
    // Mandar `conFactura` NO sustituye a definir la modalidad: es justo lo que dejaba pasar la
    // rama vieja (`solicitado ?? null`), y es la puerta por la que se colaba el movimiento
    // "clasificado a mano" de un proveedor que el sistema no sabe por qué camino pagar.
    expect(() => resolverConFactura(null, true)).toThrow(ErrorValidacion);
    expect(() => resolverConFactura(null, false)).toThrow(ErrorValidacion);
  });

  it('NUNCA devuelve null ni undefined en ninguna de sus salidas válidas', () => {
    // Aserción en NEGATIVO: la función ya no tiene forma de producir un "sin definir".
    const salidas = [
      resolverConFactura('solo_con', undefined),
      resolverConFactura('solo_sin', undefined),
      resolverConFactura('ambos', true),
      resolverConFactura('ambos', false),
    ];
    for (const salida of salidas) {
      expect(salida).not.toBeNull();
      expect(salida).not.toBeUndefined();
      expect(typeof salida).toBe('boolean');
    }
  });
});
