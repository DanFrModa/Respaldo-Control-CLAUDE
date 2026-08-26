import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Empresa, PrismaClient } from '../datos/index.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../pruebas/contexto.js';
import { ErrorValidacion } from './errores.js';
import { siguienteFolio, siguienteFolioGlobal } from './secuencias.js';
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

/**
 * ⭐ V1-E7h — el PISO de la serie GLOBAL. Aquí se demuestra contra Postgres lo que ninguna prueba
 * con dobles puede: qué hace de verdad el `INSERT … ON CONFLICT … GREATEST(valor, piso) + 1`. Es la
 * pieza que hace que el consecutivo de desarrollo de un cliente+año arranque donde va el catálogo y
 * no en 1 (el defecto que reportó Daniel), sin dejar de cumplir A3.
 */
describe('siguienteFolioGlobal — el piso adelanta la serie, pero nunca la retrocede', () => {
  const CLAVE = 'modelo-desarrollo-1-2026';

  it('sin piso se comporta como siempre: arranca en 1 y avanza de uno en uno', async () => {
    const primero = await enTransaccion((tx) => siguienteFolioGlobal(tx, CLAVE), { cliente });
    const segundo = await enTransaccion((tx) => siguienteFolioGlobal(tx, CLAVE), { cliente });
    expect([primero, segundo]).toEqual([1n, 2n]);
  });

  it('una serie que NACE con piso entrega el número siguiente al piso', async () => {
    const folio = await enTransaccion((tx) => siguienteFolioGlobal(tx, CLAVE, 7), { cliente });
    expect(folio).toBe(8n);
  });

  it('una serie que ya existe ADELANTA hasta el piso (el caso de Daniel: contador en 3, catálogo en 7)', async () => {
    await cliente.secuenciaGlobal.create({ data: { clave: CLAVE, valor: 3n } });
    const folio = await enTransaccion((tx) => siguienteFolioGlobal(tx, CLAVE, 7), { cliente });
    expect(folio).toBe(8n);
  });

  it('NUNCA retrocede: si la secuencia va por delante del piso, manda la secuencia', async () => {
    await cliente.secuenciaGlobal.create({ data: { clave: CLAVE, valor: 20n } });
    const folio = await enTransaccion((tx) => siguienteFolioGlobal(tx, CLAVE, 7), { cliente });
    // Con un `SET valor = piso + 1` saldría 8 y se re-repartirían números ya entregados.
    expect(folio).toBe(21n);
  });

  /**
   * A3 con piso: el piso entra COMO PARÁMETRO de la sentencia atómica, no se lee-decide-escribe en
   * JS. Cinco altas simultáneas con el MISMO piso tienen que sacar cinco números distintos y sin
   * huecos — es lo que separa esto de un `Max()+1` disfrazado.
   */
  it('altas SIMULTÁNEAS con el mismo piso sacan números distintos y sin huecos', async () => {
    await cliente.secuenciaGlobal.create({ data: { clave: CLAVE, valor: 2n } });
    const folios = await Promise.all(
      Array.from({ length: 5 }, () =>
        enTransaccion((tx) => siguienteFolioGlobal(tx, CLAVE, 7), { cliente }),
      ),
    );
    expect([...folios].sort((a, b) => Number(a - b))).toEqual([8n, 9n, 10n, 11n, 12n]);
  });

  it('rechaza un piso negativo en vez de corromper la serie', async () => {
    await expect(
      enTransaccion((tx) => siguienteFolioGlobal(tx, CLAVE, -1), { cliente }),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });
});
