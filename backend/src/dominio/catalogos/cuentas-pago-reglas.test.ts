/**
 * LAS REGLAS DE UNA CUENTA DE PAGO, medidas UNA sola vez (fila 0.125).
 *
 * Estas reglas gobiernan las DOS tablas de cuentas —la del proveedor (0.112) y la del concepto de
 * pago que no es proveedor (0.125)—, así que romperlas rompe las dos. Lo que se mide aquí es el
 * cruce de retirar / revivir / promover, que es donde de verdad se contradicen entre sí, y la
 * validación del par (tipo, número).
 */
import { describe, expect, it } from 'vitest';

import { ErrorConflicto, ErrorValidacion } from '../../comun/errores.js';

import {
  exigirCuentaValida,
  MENSAJE_PROMOVER_RETIRADA,
  mensajeCuentaDuplicada,
  promoverExigeReactivar,
  resolverJuegoDeDefault,
} from './cuentas-pago-reglas.js';

/** Una CLABE válida (18 dígitos con dígito de control correcto), inventada. */
const CLABE_BUENA = '002010077777777771';

describe('validar el par (tipo, número)', () => {
  it('normaliza el número: guarda sólo los dígitos', () => {
    expect(exigirCuentaValida('clabe', '0020 1007 7777 7777 71')).toBe(CLABE_BUENA);
  });

  it('una CLABE con el dígito de control mal se rechaza', () => {
    expect(() => exigirCuentaValida('clabe', '002010077777777772')).toThrow(ErrorValidacion);
  });

  it('una CLABE con menos de 18 dígitos se rechaza diciendo cuántos lleva', () => {
    expect(() => exigirCuentaValida('clabe', '00201007')).toThrow(/8/);
  });

  it('una tarjeta se valida sólo por longitud (15–19), sin Luhn', () => {
    // A propósito: rebotar la captura de ~150 beneficiarios por un dígito cuesta más que dejarlo
    // pasar (el banco lo rechaza igual). Ver el TSDoc de `motivoCuentaInvalida`.
    expect(exigirCuentaValida('tarjeta', '4111 1111 1111 1111')).toBe('4111111111111111');
    expect(() => exigirCuentaValida('tarjeta', '4111')).toThrow(ErrorValidacion);
    expect(() => exigirCuentaValida('tarjeta', '41111111111111111111')).toThrow(ErrorValidacion);
  });

  it('un número vacío se rechaza', () => {
    expect(() => exigirCuentaValida('clabe', '   ')).toThrow(ErrorValidacion);
  });
});

describe('el mensaje de cuenta duplicada', () => {
  it('si la que choca está ACTIVA, dice que ya está registrada', () => {
    const error = mensajeCuentaDuplicada('Este proveedor', {
      activo: true,
      beneficiario: 'Fulana de Tal',
    });
    expect(error).toBeInstanceOf(ErrorConflicto);
    expect(error.message).toContain('ya tiene esa cuenta registrada');
    expect(error.message).toContain('Fulana de Tal');
  });

  it('⭐ si está RETIRADA, dice que se puede reactivar (es historial reutilizable, D3)', () => {
    const error = mensajeCuentaDuplicada('Este concepto', {
      activo: false,
      beneficiario: 'Fulana de Tal',
    });
    expect(error.message).toContain('reactivarla');
    expect(error.message).not.toContain('ya tiene esa cuenta registrada');
  });

  it('el dueño lo pone el que llama (las dos tablas dicen lo suyo)', () => {
    expect(
      mensajeCuentaDuplicada('Este proveedor', { activo: true, beneficiario: 'X' }).message,
    ).toMatch(/^Este proveedor/);
    expect(
      mensajeCuentaDuplicada('Este concepto', { activo: true, beneficiario: 'X' }).message,
    ).toMatch(/^Este concepto/);
  });
});

describe('⭐ el cruce de las tres reglas de la default', () => {
  const activaNoDefault = { activo: true, esDefault: null };
  const activaDefault = { activo: true, esDefault: true };
  const retirada = { activo: false, esDefault: null };

  it('regla 1 — RETIRAR gana sobre promover, aunque vengan los dos en el mismo cuerpo', () => {
    const juego = resolverJuegoDeDefault(activaDefault, { activo: false, esDefault: true });
    expect(juego.retira).toBe(true);
    expect(juego.promueve).toBe(false);
    // Y le quita la default: una cuenta que ya no se usa no puede ser «la de siempre».
    expect(juego.degrada).toBe(true);
  });

  it('regla 2 — REVIVIR no promueve: la default de hoy sigue siendo la de hoy', () => {
    const juego = resolverJuegoDeDefault(retirada, { activo: true });
    expect(juego.revive).toBe(true);
    expect(juego.promueve).toBe(false);
    expect(juego.degrada).toBe(false);
  });

  it('regla 3 — quitar la marca NO promueve a nadie más (nada de magia)', () => {
    const juego = resolverJuegoDeDefault(activaDefault, { esDefault: false });
    expect(juego.degrada).toBe(true);
    expect(juego.promueve).toBe(false);
  });

  it('promover una cuenta activa que no era default la promueve', () => {
    const juego = resolverJuegoDeDefault(activaNoDefault, { esDefault: true });
    expect(juego.promueve).toBe(true);
    expect(juego.degrada).toBe(false);
  });

  it('un PATCH que no toca nada de esto no promueve ni degrada', () => {
    expect(resolverJuegoDeDefault(activaDefault, {})).toEqual({
      retira: false,
      revive: false,
      promueve: false,
      degrada: false,
    });
    expect(resolverJuegoDeDefault(activaNoDefault, {})).toEqual({
      retira: false,
      revive: false,
      promueve: false,
      degrada: false,
    });
  });

  it('retirar una cuenta que YA estaba retirada no hace nada', () => {
    const juego = resolverJuegoDeDefault(retirada, { activo: false });
    expect(juego.retira).toBe(false);
    expect(juego.revive).toBe(false);
  });

  it('promover una RETIRADA sin reactivarla es un error de uso, con su mensaje', () => {
    const juego = resolverJuegoDeDefault(retirada, { esDefault: true });
    expect(promoverExigeReactivar(retirada, juego)).toBe(true);
    expect(MENSAJE_PROMOVER_RETIRADA).toContain('reactívala');
  });

  it('promover una retirada REACTIVÁNDOLA en el mismo cuerpo sí se puede', () => {
    const juego = resolverJuegoDeDefault(retirada, { activo: true, esDefault: true });
    expect(juego.revive).toBe(true);
    expect(juego.promueve).toBe(true);
    expect(promoverExigeReactivar(retirada, juego)).toBe(false);
  });
});
