/**
 * Unit del segmento con/sin factura del MOTOR de terceros (fila 0.110) — SIN Postgres.
 *
 * Lo que protege: que el motor **no vuelva a marcar "sin factura" en silencio** un movimiento de
 * proveedor que nadie clasificó (la rama gemela del `default` de `resolverConFactura`), y que al
 * cerrarlo NO se haya roto lo contrario — que un CFDI real siga naciendo fiscal aunque el catálogo
 * del proveedor diga otra cosa.
 */
import { describe, expect, it } from 'vitest';

import { ErrorValidacion } from '../../comun/errores.js';
import { MENSAJE_SIN_MODALIDAD } from '../esma/facturacion.js';
import { resolverEsFiscalMotor } from './segmento-motor.js';

describe('resolverEsFiscalMotor — proveedor SIN modalidad: no nace nada en silencio', () => {
  it('⭐ proveedor sin modalidad y sin decir nada → LANZA (antes nacía `false` callado)', () => {
    expect(() => resolverEsFiscalMotor('proveedor', null, undefined)).toThrow(ErrorValidacion);
    expect(() => resolverEsFiscalMotor('proveedor', null, undefined)).toThrow(
      MENSAJE_SIN_MODALIDAD,
    );
  });

  it('proveedor que factura de las dos formas y no se indicó → LANZA (nadie más puede decidirlo)', () => {
    expect(() => resolverEsFiscalMotor('proveedor', 'ambos', undefined)).toThrow(ErrorValidacion);
  });

  it('NUNCA devuelve un `false` derivado de un proveedor sin clasificar', () => {
    // Aserción en NEGATIVO: no existe combinación de proveedor-sin-modalidad que devuelva un
    // booleano. O lo dijo el llamador, o truena.
    expect(() => resolverEsFiscalMotor('proveedor', null, undefined)).toThrow();
  });
});

describe('resolverEsFiscalMotor — lo que el llamador SÍ dijo se respeta (evidencia > catálogo)', () => {
  it('un movimiento marcado fiscal sigue fiscal aunque el proveedor esté como `solo_sin`', () => {
    // El caso real: `cfdi-proveedor.ts` y `entradas-tela.ts` mandan `true` junto al UUID de un CFDI
    // timbrado. Degradarlo por el catálogo dejaría una factura real fuera del reporte del contador,
    // con el UUID ya consumido para siempre.
    expect(resolverEsFiscalMotor('proveedor', 'solo_sin', true)).toBe(true);
  });

  it('un movimiento marcado NO fiscal sigue no fiscal aunque el proveedor esté como `solo_con`', () => {
    // El caso real: `cxp.ts` ya resolvió que una `entrada_sin_factura` no es fiscal (el ORIGEN manda
    // sobre la modalidad). Re-resolver aquí desharía esa regla.
    expect(resolverEsFiscalMotor('proveedor', 'solo_con', false)).toBe(false);
  });

  it('con `ambos`, lo indicado manda en los dos sentidos', () => {
    expect(resolverEsFiscalMotor('proveedor', 'ambos', true)).toBe(true);
    expect(resolverEsFiscalMotor('proveedor', 'ambos', false)).toBe(false);
  });

  it('y también se respeta cuando el proveedor no tiene modalidad', () => {
    expect(resolverEsFiscalMotor('proveedor', null, true)).toBe(true);
    expect(resolverEsFiscalMotor('proveedor', null, false)).toBe(false);
  });
});

describe('resolverEsFiscalMotor — proveedor sin decir nada: lo deriva la modalidad', () => {
  it('solo_con → fiscal; solo_sin → no fiscal', () => {
    expect(resolverEsFiscalMotor('proveedor', 'solo_con', undefined)).toBe(true);
    expect(resolverEsFiscalMotor('proveedor', 'solo_sin', undefined)).toBe(false);
  });
});

describe('resolverEsFiscalMotor — el CLIENTE no tiene modalidad que consultar', () => {
  it('cliente sin decir nada → false, como siempre (CxC no cambia)', () => {
    expect(resolverEsFiscalMotor('cliente', null, undefined)).toBe(false);
  });

  it('cliente respeta lo indicado y NUNCA lanza por falta de modalidad', () => {
    expect(resolverEsFiscalMotor('cliente', null, true)).toBe(true);
    expect(resolverEsFiscalMotor('cliente', null, false)).toBe(false);
    expect(() => resolverEsFiscalMotor('cliente', null, undefined)).not.toThrow();
  });
});
