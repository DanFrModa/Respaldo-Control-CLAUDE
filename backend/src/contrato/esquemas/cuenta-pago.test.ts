/**
 * Reglas PURAS de las cuentas de pago del proveedor (0.112): la validación del par (tipo, número) y
 * los esquemas de alta/edición. Sin base de datos: aquí sólo vive el contrato.
 *
 * La regla que se prueba a fondo es `motivoCuentaInvalida`, porque la comparten DOS lugares —el Zod
 * del alta y el dominio al editar (donde el par puede venir mitad del cuerpo y mitad de la base)— y
 * un cambio silencioso ahí se propaga a los dos.
 */
import { describe, expect, it } from 'vitest';

import {
  esquemaProveedorCuentaPagoCrear,
  esquemaProveedorCuentaPagoEditarCuerpo,
  motivoCuentaInvalida,
  normalizarNumeroDeCuenta,
} from './proveedor.js';

/** CLABE con dígito de control válido (la misma que usan las demás pruebas del contrato). */
const CLABE_OK = '002010077777777771';
/** Misma CLABE con el dígito de control cambiado: la forma es correcta, el control no cuadra. */
const CLABE_CONTROL_MAL = '002010077777777772';
/** Tarjeta de 16 dígitos (el caso común). */
const TARJETA_OK = '4152313312345678';

describe('normalizarNumeroDeCuenta', () => {
  it('deja SÓLO los dígitos (el banco los entrega con espacios y guiones)', () => {
    expect(normalizarNumeroDeCuenta('0020 1007 7777 7777 71')).toBe(CLABE_OK);
    expect(normalizarNumeroDeCuenta('4152-3133-1234-5678')).toBe(TARJETA_OK);
  });

  it('un texto sin dígitos queda vacío (no inventa nada)', () => {
    expect(normalizarNumeroDeCuenta('la cuenta de su esposa')).toBe('');
  });
});

describe('motivoCuentaInvalida', () => {
  it('acepta una CLABE de 18 dígitos con dígito de control correcto', () => {
    expect(motivoCuentaInvalida('clabe', CLABE_OK)).toBeNull();
  });

  it('acepta la CLABE aunque venga capturada con espacios', () => {
    expect(motivoCuentaInvalida('clabe', '0020 1007 7777 7777 71')).toBeNull();
  });

  it('rechaza una CLABE que no tiene 18 dígitos, y dice cuántos lleva', () => {
    const motivo = motivoCuentaInvalida('clabe', '00201007777777777');
    expect(motivo).toContain('18 dígitos');
    expect(motivo).toContain('17');
  });

  it('rechaza una CLABE con el dígito de control mal (el error de dedo típico)', () => {
    expect(motivoCuentaInvalida('clabe', CLABE_CONTROL_MAL)).toContain('dígito de control');
  });

  it('acepta tarjetas de 15 a 19 dígitos', () => {
    expect(motivoCuentaInvalida('tarjeta', TARJETA_OK)).toBeNull();
    expect(motivoCuentaInvalida('tarjeta', '123456789012345')).toBeNull();
    expect(motivoCuentaInvalida('tarjeta', '1234567890123456789')).toBeNull();
  });

  it('rechaza tarjetas fuera del rango 15–19', () => {
    expect(motivoCuentaInvalida('tarjeta', '12345678901234')).toContain('entre 15 y 19');
    expect(motivoCuentaInvalida('tarjeta', '12345678901234567890')).toContain('entre 15 y 19');
  });

  it('NO le aplica la regla de la CLABE a una tarjeta (son cosas distintas)', () => {
    // 18 dígitos con control inválido: como CLABE se rechaza, como tarjeta es perfectamente válida.
    expect(motivoCuentaInvalida('clabe', CLABE_CONTROL_MAL)).not.toBeNull();
    expect(motivoCuentaInvalida('tarjeta', CLABE_CONTROL_MAL)).toBeNull();
  });

  it('un número vacío (o sin dígitos) siempre está mal', () => {
    expect(motivoCuentaInvalida('clabe', '   ')).toContain('Escribe el número');
    expect(motivoCuentaInvalida('tarjeta', 'no me acuerdo')).toContain('Escribe el número');
  });
});

describe('esquemaProveedorCuentaPagoCrear', () => {
  it('acepta un alta completa', () => {
    const r = esquemaProveedorCuentaPagoCrear.safeParse({
      beneficiario: 'Fulana de Tal',
      banco: 'BBVA',
      tipoCuenta: 'clabe',
      cuenta: CLABE_OK,
      alias: '1',
      esFiscal: true,
    });
    expect(r.success).toBe(true);
  });

  it('el BENEFICIARIO es obligatorio: es el nombre del depósito, no el del proveedor', () => {
    const r = esquemaProveedorCuentaPagoCrear.safeParse({
      beneficiario: '   ',
      tipoCuenta: 'clabe',
      cuenta: CLABE_OK,
    });
    expect(r.success).toBe(false);
  });

  it('rechaza el número que no cuadra con el tipo declarado', () => {
    const r = esquemaProveedorCuentaPagoCrear.safeParse({
      beneficiario: 'Fulana de Tal',
      tipoCuenta: 'clabe',
      cuenta: CLABE_CONTROL_MAL,
    });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual(['cuenta']);
  });

  it('rechaza un tipo de cuenta inventado', () => {
    const r = esquemaProveedorCuentaPagoCrear.safeParse({
      beneficiario: 'Fulana de Tal',
      tipoCuenta: 'cheque',
      cuenta: CLABE_OK,
    });
    expect(r.success).toBe(false);
  });

  it('NO acepta `esDefault` en el alta: la default la decide el dominio', () => {
    const r = esquemaProveedorCuentaPagoCrear.safeParse({
      beneficiario: 'Fulana de Tal',
      tipoCuenta: 'clabe',
      cuenta: CLABE_OK,
      esDefault: true,
    });
    // Zod ignora las llaves de más (no es `strict`), pero el dato NO debe llegar al dominio.
    expect(r.success).toBe(true);
    expect(r.data).not.toHaveProperty('esDefault');
  });
});

describe('esquemaProveedorCuentaPagoEditarCuerpo', () => {
  it('acepta un PATCH vacío (no tocar nada)', () => {
    expect(esquemaProveedorCuentaPagoEditarCuerpo.safeParse({}).success).toBe(true);
  });

  it('acepta promover (`esDefault`), retirar (`activo`) y vaciar los opcionales con null', () => {
    const r = esquemaProveedorCuentaPagoEditarCuerpo.safeParse({
      esDefault: true,
      activo: false,
      banco: null,
      alias: null,
      notas: null,
    });
    expect(r.success).toBe(true);
  });

  it('el beneficiario se puede cambiar pero NO vaciar', () => {
    expect(
      esquemaProveedorCuentaPagoEditarCuerpo.safeParse({ beneficiario: 'Otra persona' }).success,
    ).toBe(true);
    expect(esquemaProveedorCuentaPagoEditarCuerpo.safeParse({ beneficiario: '' }).success).toBe(
      false,
    );
    expect(esquemaProveedorCuentaPagoEditarCuerpo.safeParse({ beneficiario: null }).success).toBe(
      false,
    );
  });
});
