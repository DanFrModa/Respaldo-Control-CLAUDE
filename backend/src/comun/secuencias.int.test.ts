import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Empresa, PrismaClient } from '../datos/index.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../pruebas/contexto.js';
import { ErrorValidacion } from './errores.js';
import { siguienteFolio } from './secuencias.js';
import { enTransaccion } from './transaccion.js';

let cliente: PrismaClient;
let empresa: Empresa;

beforeAll(() => {
  cliente = clientePruebas();
});

afterAll(async () => {
  await cliente.$disconnect();
});

beforeEach(async () => {
  await limpiarBaseDatos(cliente);
  empresa = await crearEmpresaPrueba(cliente);
});

describe('siguienteFolio (A3: folios atómicos por secuencia, doc 02 §6.1)', () => {
  it('la primera llamada crea la secuencia y devuelve 1', async () => {
    const folio = await enTransaccion((tx) => siguienteFolio(tx, empresa.id, 'orden'), {
      cliente,
    });
    expect(folio).toBe(1n);
  });

  it('incrementa de uno en uno en llamadas sucesivas', async () => {
    const folios: bigint[] = [];
    for (let i = 0; i < 3; i += 1) {
      folios.push(
        await enTransaccion((tx) => siguienteFolio(tx, empresa.id, 'orden'), { cliente }),
      );
    }
    expect(folios).toEqual([1n, 2n, 3n]);
  });

  it('CRÍTICO: 25 llamadas CONCURRENTES devuelven 25 folios únicos y consecutivos', async () => {
    const folios = await Promise.all(
      Array.from({ length: 25 }, () =>
        enTransaccion((tx) => siguienteFolio(tx, empresa.id, 'nota-salida'), { cliente }),
      ),
    );

    const unicos = new Set(folios.map((folio) => folio.toString()));
    expect(unicos.size).toBe(25); // ni un duplicado bajo concurrencia (jamás Max()+1)
    expect(folios.map(Number).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 25 }, (_, i) => i + 1),
    );
  });

  it('cada clave lleva su propia numeración', async () => {
    const folioOrden = await enTransaccion((tx) => siguienteFolio(tx, empresa.id, 'orden'), {
      cliente,
    });
    const folioNota = await enTransaccion((tx) => siguienteFolio(tx, empresa.id, 'nota-salida'), {
      cliente,
    });
    expect(folioOrden).toBe(1n);
    expect(folioNota).toBe(1n);
  });

  it('cada empresa lleva su propia numeración (multi-empresa A9)', async () => {
    const otraEmpresa = await crearEmpresaPrueba(cliente, 'Segunda Empresa');
    await enTransaccion((tx) => siguienteFolio(tx, empresa.id, 'orden'), { cliente });
    const folioOtra = await enTransaccion((tx) => siguienteFolio(tx, otraEmpresa.id, 'orden'), {
      cliente,
    });
    expect(folioOtra).toBe(1n);
  });

  it('el folio de una transacción REVERTIDA se reutiliza (sin huecos por rollback)', async () => {
    await enTransaccion((tx) => siguienteFolio(tx, empresa.id, 'orden'), { cliente });

    await expect(
      enTransaccion(
        async (tx) => {
          await siguienteFolio(tx, empresa.id, 'orden'); // tomaría el 2
          throw new Error('la captura falló después de pedir folio');
        },
        { cliente },
      ),
    ).rejects.toThrow('la captura falló');

    const siguiente = await enTransaccion((tx) => siguienteFolio(tx, empresa.id, 'orden'), {
      cliente,
    });
    expect(siguiente).toBe(2n); // el 2 revertido vuelve a entregarse: numeración sin huecos
  });

  it('rechaza claves fuera de la convención (mayúsculas, acentos, espacios)', async () => {
    await expect(
      enTransaccion((tx) => siguienteFolio(tx, empresa.id, 'Nota Salida'), { cliente }),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('rechaza idEmpresa inválido', async () => {
    await expect(
      enTransaccion((tx) => siguienteFolio(tx, 0, 'orden'), { cliente }),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });
});
