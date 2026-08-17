/**
 * Tests UNITARIOS de `aJsonBitacora` — la conversión de una fila de Prisma al JSON de la bitácora.
 *
 * POR QUÉ EXISTE ESTE ARCHIVO: la función nació SIN prueba propia, y la corrección que la escribió
 * (cambiar el `replacer` de `JSON.stringify` por un recorrido a mano) metió un defecto que la hacía
 * LANZAR con toda fila real — el operador `in` sobre el `id: number` de cualquier registro. El
 * typecheck no lo veía y las pruebas de integración que lo cazaban no se corrieron. Aquí se fija el
 * contrato para que la próxima reescritura no lo vuelva a romper en silencio.
 */
import { describe, expect, it } from 'vitest';

import { Prisma } from '../datos/index.js';

import { aJsonBitacora } from './auditoria.js';

const D = (n: string | number): Prisma.Decimal => new Prisma.Decimal(n);

describe('aJsonBitacora', () => {
  it('⭐ LA REGRESIÓN: una fila con campos primitivos NO lanza (el `in` sobre `id: number`)', () => {
    // Toda fila de Prisma trae `id: number`. Con el orden de guardas invertido esto reventaba con
    // `TypeError: Cannot use 'in' operator to search for 'toFixed' in 1`, y con ello la operación
    // completa (quitar un renglón / borrar una lista).
    expect(() => aJsonBitacora({ id: 1, nombre: 'texto', activo: true })).not.toThrow();
    expect(aJsonBitacora({ id: 1, nombre: 'texto', activo: true })).toEqual({
      id: 1,
      nombre: 'texto',
      activo: true,
    });
  });

  it('no lanza con primitivos sueltos ni con nulos', () => {
    expect(aJsonBitacora(1)).toBe(1);
    expect(aJsonBitacora('hola')).toBe('hola');
    expect(aJsonBitacora(false)).toBe(false);
    expect(aJsonBitacora(null)).toBeNull();
    expect(aJsonBitacora(undefined)).toBeNull();
  });

  it('`Prisma.Decimal` → NÚMERO (no cadena): los importes quedan comparables', () => {
    const salida = aJsonBitacora({ costoUnit: D('40'), precio: D('123.45') }) as Record<
      string,
      unknown
    >;
    expect(salida.costoUnit).toBe(40);
    expect(typeof salida.costoUnit).toBe('number');
    expect(salida.precio).toBe(123.45);
    expect(typeof salida.precio).toBe('number');
  });

  it('`Date` → ISO 8601 y `BigInt` → cadena (el folio no cabe en un number sin riesgo)', () => {
    const fecha = new Date('2026-08-15T12:00:00.000Z');
    const salida = aJsonBitacora({ creadoEn: fecha, folio: 9_007_199_254_740_993n }) as Record<
      string,
      unknown
    >;
    expect(salida.creadoEn).toBe('2026-08-15T12:00:00.000Z');
    expect(salida.folio).toBe('9007199254740993');
  });

  it('convierte EN PROFUNDIDAD: dentro de arreglos y de objetos anidados', () => {
    const salida = aJsonBitacora({
      id: 7,
      lineas: [
        { id: 1, precio: D('10.5'), creadoEn: new Date('2026-01-02T03:04:05.000Z') },
        { id: 2, precio: D('0'), creadoEn: null },
      ],
      encabezado: { folio: 12n, factor: D('1.25') },
    }) as { lineas: Record<string, unknown>[]; encabezado: Record<string, unknown> };

    expect(salida.lineas[0]!.precio).toBe(10.5);
    expect(salida.lineas[0]!.creadoEn).toBe('2026-01-02T03:04:05.000Z');
    expect(salida.lineas[1]!.precio).toBe(0);
    expect(salida.lineas[1]!.creadoEn).toBeNull();
    expect(salida.encabezado.folio).toBe('12');
    expect(salida.encabezado.factor).toBe(1.25);
  });

  it('`undefined` dentro de un objeto se OMITE (así el llamador poda campos); `null` se conserva', () => {
    const salida = aJsonBitacora({ id: 1, estadoLista: undefined, aprobadoPorId: null });
    expect(salida).toEqual({ id: 1, aprobadoPorId: null });
    expect(Object.keys(salida as object)).not.toContain('estadoLista');
  });

  it('D3: el resultado sobrevive el viaje a JSON conservando los TIPOS', () => {
    // Es lo que de verdad importa: Prisma serializa `datos` con JSON.stringify al guardarlo, y al
    // releerlo de la bitácora los importes tienen que seguir siendo números.
    const ida = aJsonBitacora({ id: 3, costoUnit: D('40'), creadoEn: new Date(0) });
    const vuelta = JSON.parse(JSON.stringify(ida)) as Record<string, unknown>;
    expect(vuelta.costoUnit).toBe(40);
    expect(typeof vuelta.costoUnit).toBe('number');
    expect(vuelta.creadoEn).toBe('1970-01-01T00:00:00.000Z');
  });

  it('un arreglo en la raíz también se normaliza (`eventos.map(aJsonBitacora)`)', () => {
    // Así se llama en `quitarLineaLista`: un `map` directo sobre la lista de eventos.
    const salida = [{ id: 1, monto: D('5') }, { id: 2 }].map(aJsonBitacora) as Record<
      string,
      unknown
    >[];
    expect(salida[0]!.monto).toBe(5);
    expect(salida[1]!.id).toBe(2);
  });
});
