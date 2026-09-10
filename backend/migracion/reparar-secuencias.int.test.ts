import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { siguienteFolio } from '../src/comun/secuencias.js';
import { enTransaccion } from '../src/comun/transaccion.js';
import type { Empresa, PrismaClient } from '../src/datos/index.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../src/pruebas/contexto.js';
import { CLAVE_SECUENCIA_ORDEN_COMPRA } from '../src/dominio/compras/ordenes-compra.js';
import { CLAVE_SECUENCIA_NOTA_SALIDA } from '../src/dominio/notas/notas-salida.js';
import { CLAVE_SECUENCIA_PEDIDO } from '../src/dominio/pedidos/pedidos.js';
import { CLAVE_SECUENCIA_ORDEN } from '../src/dominio/produccion/ordenes.js';
import {
  aplicarPlan,
  ErrorEscalonInvalido,
  formatearReporte,
  planificar,
  repararSecuencias,
} from './reparar-secuencias.js';

/**
 * Prueba del defecto §Post-F9.17 (Daniel, 7-ago-2026: *"hice la OC pero al refrescar el listado, no
 * la veo"*): un histórico migrado con folio EXPLÍCITO deja su secuencia en cero, así que la primera
 * captura nueva arranca en 1 (se va al final del listado, que ordena descendente, y puede chocar
 * contra el unique `(idEmpresa, folio)`). `repararSecuencias` es la red permanente contra eso.
 *
 * Y desde la fila 0.187, el **salto al escalón de arranque** (§Post-F9.36 punto 5): la numeración
 * nueva empieza en un número redondo (OP 6,000 en vez de 5,848). Es IRREVERSIBLE en cuanto alguien
 * captura con ella, así que aquí se fijan sus tres cinturones —ensayo en seco, abortar si el
 * escalón va por lo bajo, y que la reparación normal no cambie ni un ápice—.
 */

let cliente: PrismaClient;
let empresa: Empresa;
let idProveedor: number;
let idModelo: number;
let idClienteNegocio: number;

beforeAll(() => {
  cliente = clientePruebas();
});

afterAll(async () => {
  await cliente.$disconnect();
});

beforeEach(async () => {
  await limpiarBaseDatos(cliente);
  empresa = await crearEmpresaPrueba(cliente);
  const prov = await cliente.proveedor.create({ data: { nombre: 'Bloom Textiles' } });
  idProveedor = prov.id;
  const modelo = await cliente.modelo.create({ data: { codigo: 'MOD-1' } });
  idModelo = modelo.id;
  const clienteNegocio = await cliente.cliente.create({ data: { nombre: 'Cliente de prueba' } });
  idClienteNegocio = clienteNegocio.id;
});

/** Inserta una OC "migrada" (folio explícito, como lo hace el ETL de F4-E6). */
async function ocMigrada(numCompra: bigint): Promise<void> {
  await cliente.ordenCompra.create({
    data: { numCompra, idEmpresa: empresa.id, idProveedor },
  });
}

/** Inserta una ORDEN DE PRODUCCIÓN "migrada" (folio explícito, como el ETL de F2-E5). */
async function opMigrada(folioOp: bigint): Promise<void> {
  await cliente.orden.create({
    data: { folio: folioOp, idEmpresa: empresa.id, idModelo, idCliente: idClienteNegocio },
  });
}

/** Pide el siguiente folio de una serie como lo haría una captura real. */
function folio(clave: string): Promise<bigint> {
  return enTransaccion((tx) => siguienteFolio(tx, empresa.id, clave), { cliente });
}

/** El valor CRUDO de la secuencia (0 = la fila ni existe). Sirve para probar que NO se escribió. */
async function valorSecuencia(clave: string): Promise<bigint> {
  const fila = await cliente.secuencia.findUnique({
    where: { idEmpresa_clave: { idEmpresa: empresa.id, clave } },
  });
  return fila?.valor ?? 0n;
}

/** Un escalón pedido, en la forma que espera `planificar`. */
function escalones(...pares: [string, bigint][]): Map<string, bigint> {
  return new Map(pares);
}

describe('repararSecuencias (§Post-F9.17)', () => {
  it('adelanta la serie de OC al máximo migrado: la captura nueva NO reinicia en 1', async () => {
    await ocMigrada(7920n);

    // Sin reparar, la serie está en cero y la captura nueva se iría a folio 1 (el defecto).
    await repararSecuencias(cliente, [CLAVE_SECUENCIA_ORDEN_COMPRA]);

    expect(await folio(CLAVE_SECUENCIA_ORDEN_COMPRA)).toBe(7921n);
  });

  it('es idempotente y MONÓTONO: correrlo de nuevo no retrocede lo que la captura ya avanzó', async () => {
    await ocMigrada(100n);
    await repararSecuencias(cliente, [CLAVE_SECUENCIA_ORDEN_COMPRA]);
    expect(await folio(CLAVE_SECUENCIA_ORDEN_COMPRA)).toBe(101n);

    // La OC 101 aún no existe en la tabla (se está capturando), así que el máximo real sigue en 100.
    // Una segunda corrida NO debe devolver la serie a 100 y regalar el folio 101 dos veces.
    await repararSecuencias(cliente, [CLAVE_SECUENCIA_ORDEN_COMPRA]);
    expect(await folio(CLAVE_SECUENCIA_ORDEN_COMPRA)).toBe(102n);
  });

  it('no toca las series sin histórico (tablas vacías) ni las que no se le piden', async () => {
    await ocMigrada(50n);

    // Solo se pide `nota-salida`, cuya tabla está vacía → nada se mueve, ni la de OC.
    const reporte = await repararSecuencias(cliente, [CLAVE_SECUENCIA_NOTA_SALIDA]);

    expect(reporte.join('\n')).toContain('sin datos');
    expect(await folio(CLAVE_SECUENCIA_ORDEN_COMPRA)).toBe(1n);
  });

  it('sin filtro repara TODAS las series con histórico', async () => {
    await ocMigrada(7920n);
    const clienteFinal = await cliente.cliente.create({ data: { nombre: 'C&A' } });
    await cliente.pedido.create({
      data: { folio: 30n, idEmpresa: empresa.id, idCliente: clienteFinal.id },
    });

    await repararSecuencias(cliente);

    expect(await folio(CLAVE_SECUENCIA_ORDEN_COMPRA)).toBe(7921n);
    expect(await folio(CLAVE_SECUENCIA_PEDIDO)).toBe(31n);
  });

  it('dice el folio VERDADERO cuando la secuencia va por delante de la tabla', async () => {
    // Un rollback quema folio sin dejar fila: la secuencia queda por encima del máximo de la tabla.
    await ocMigrada(100n);
    await repararSecuencias(cliente);
    await folio(CLAVE_SECUENCIA_ORDEN_COMPRA); // la captura toma la 101 y no llega a guardarse

    const reporte = (await repararSecuencias(cliente)).join('\n');

    // El reporte NO puede cantar 101 (el máximo de la tabla + 1): esa ya se repartió.
    expect(reporte).toContain('orden-compra (ÓRDENES DE COMPRA (la que faltaba)) → empresa');
    expect(reporte).toContain('siguiente = 102');
  });
});

describe('salto al escalón de arranque (fila 0.187 · §Post-F9.36 punto 5)', () => {
  it('con el escalón puesto, la siguiente OP sale con el NÚMERO REDONDO', async () => {
    await opMigrada(5847n);

    const plan = await planificar(cliente, {
      escalones: escalones([CLAVE_SECUENCIA_ORDEN, 6000n]),
    });
    await aplicarPlan(cliente, plan);

    expect(await folio(CLAVE_SECUENCIA_ORDEN)).toBe(6000n);
  });

  it('y la siguiente OC también (son las DOS series que nombró Daniel, con su propio número)', async () => {
    await opMigrada(5847n);
    await ocMigrada(7920n);

    const plan = await planificar(cliente, {
      escalones: escalones([CLAVE_SECUENCIA_ORDEN, 6000n], [CLAVE_SECUENCIA_ORDEN_COMPRA, 8000n]),
    });
    await aplicarPlan(cliente, plan);

    expect(await folio(CLAVE_SECUENCIA_ORDEN)).toBe(6000n);
    expect(await folio(CLAVE_SECUENCIA_ORDEN_COMPRA)).toBe(8000n);
  });

  it('PLANIFICAR NO ESCRIBE: el ensayo en seco deja la base exactamente como estaba', async () => {
    await opMigrada(5847n);

    const plan = await planificar(cliente, {
      escalones: escalones([CLAVE_SECUENCIA_ORDEN, 6000n]),
    });

    expect(plan.hayEscalon).toBe(true);
    expect(await cliente.secuencia.count()).toBe(0); // ni la reparación normal se escribió
    // Y lo que se imprimió es lo que pasará al aplicar: mismo plan, mismo número.
    await aplicarPlan(cliente, plan);
    expect(await folio(CLAVE_SECUENCIA_ORDEN)).toBe(6000n);
  });

  it('un escalón POR DEBAJO del máximo migrado ABORTA — y no escribe NADA de nada', async () => {
    await opMigrada(6120n);
    await ocMigrada(7920n);

    await expect(
      planificar(cliente, { escalones: escalones([CLAVE_SECUENCIA_ORDEN, 6000n]) }),
    ).rejects.toThrow(ErrorEscalonInvalido);

    // Ni la serie del escalón ni las demás: la corrida entera se cae antes de tocar la base.
    expect(await cliente.secuencia.count()).toBe(0);
  });

  it('el aborto NOMBRA el caso con los dos números (para elegir otro escalón sin adivinar)', async () => {
    await opMigrada(6120n);

    const error = await planificar(cliente, {
      escalones: escalones([CLAVE_SECUENCIA_ORDEN, 6000n]),
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ErrorEscalonInvalido);
    const mensaje = error instanceof Error ? error.message : '';
    expect(mensaje).toContain('orden');
    expect(mensaje).toContain('6,000'); // lo que pediste
    expect(mensaje).toContain('6,120'); // lo que ya está comprometido
    expect(mensaje).toContain('REPETIRÍA folios');
  });

  it('junta TODOS los escalones malos en un solo aborto (no uno por corrida)', async () => {
    await opMigrada(6120n);
    await ocMigrada(8500n);

    const error = await planificar(cliente, {
      escalones: escalones([CLAVE_SECUENCIA_ORDEN, 6000n], [CLAVE_SECUENCIA_ORDEN_COMPRA, 8000n]),
    }).catch((e: unknown) => e);

    const mensaje = error instanceof Error ? error.message : '';
    expect(mensaje).toContain('6,120');
    expect(mensaje).toContain('8,500');
    // …y NADA de otra cosa: un escalón rechazado no puede además acusar de "no tiene ninguna fila"
    // (la tenía; lo que pasó es que el número iba por lo bajo). Mandaría a arreglar lo que no falla.
    expect(mensaje).not.toContain('no tiene ninguna fila');
    expect(mensaje.split('\n')).toHaveLength(2);
  });

  it('ABORTA también si la SECUENCIA ya va por encima, aunque la tabla no (el no-op silencioso)', async () => {
    // La tabla se quedó en 5,847 pero la secuencia ya repartió hasta 6,500 (capturas sin guardar).
    // `sembrarSecuencia` es monótona: pedir 6,000 aquí NO repetiría folios… se quedaría en NADA,
    // mientras el reporte cantaría "6,000". Eso es peor que un error: es una mentira.
    await opMigrada(5847n);
    await cliente.secuencia.create({
      data: { idEmpresa: empresa.id, clave: CLAVE_SECUENCIA_ORDEN, valor: 6500n },
    });

    const error = await planificar(cliente, {
      escalones: escalones([CLAVE_SECUENCIA_ORDEN, 6000n]),
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ErrorEscalonInvalido);
    expect(error instanceof Error ? error.message : '').toContain('secuencia en 6,500');
    expect(await valorSecuencia(CLAVE_SECUENCIA_ORDEN)).toBe(6500n); // intacta
  });

  it('el escalón toca SOLO su serie: las demás siguen con la reparación de siempre', async () => {
    await opMigrada(5847n);
    await ocMigrada(7920n);

    const plan = await planificar(cliente, {
      escalones: escalones([CLAVE_SECUENCIA_ORDEN, 6000n]),
    });
    await aplicarPlan(cliente, plan);

    expect(await folio(CLAVE_SECUENCIA_ORDEN)).toBe(6000n);
    expect(await folio(CLAVE_SECUENCIA_ORDEN_COMPRA)).toBe(7921n); // máximo + 1, sin salto
  });

  it('es IDEMPOTENTE: repetir el mismo comando antes de capturar no cambia nada', async () => {
    await opMigrada(5847n);
    const opciones = { escalones: escalones([CLAVE_SECUENCIA_ORDEN, 6000n]) };

    await aplicarPlan(cliente, await planificar(cliente, opciones));
    await aplicarPlan(cliente, await planificar(cliente, opciones));

    expect(await valorSecuencia(CLAVE_SECUENCIA_ORDEN)).toBe(5999n);
    expect(await folio(CLAVE_SECUENCIA_ORDEN)).toBe(6000n);
  });

  it('y en cuanto el escalón se CONSUMIÓ, repetirlo aborta en vez de callar', async () => {
    await opMigrada(5847n);
    const opciones = { escalones: escalones([CLAVE_SECUENCIA_ORDEN, 6000n]) };
    await aplicarPlan(cliente, await planificar(cliente, opciones));
    expect(await folio(CLAVE_SECUENCIA_ORDEN)).toBe(6000n); // ya arrancó: la 6,000 está repartida

    await expect(planificar(cliente, opciones)).rejects.toThrow(ErrorEscalonInvalido);
  });

  it('sin escalón NO cambia nada: mismo plan y mismo reporte que la reparación de siempre', async () => {
    await opMigrada(5847n);
    await ocMigrada(7920n);

    const plan = await planificar(cliente);

    expect(plan.hayEscalon).toBe(false);
    expect(formatearReporte(plan).join('\n')).toContain('siguiente = 5848');
    await aplicarPlan(cliente, plan);
    expect(await folio(CLAVE_SECUENCIA_ORDEN)).toBe(5848n);
    expect(await folio(CLAVE_SECUENCIA_ORDEN_COMPRA)).toBe(7921n);
  });

  it('con la tabla VACÍA aborta (no sabe de qué empresa) — salvo que se diga con --empresa', async () => {
    await expect(
      planificar(cliente, { escalones: escalones([CLAVE_SECUENCIA_ORDEN, 6000n]) }),
    ).rejects.toThrow(/no tiene ninguna fila/);

    const plan = await planificar(cliente, {
      escalones: escalones([CLAVE_SECUENCIA_ORDEN, 6000n]),
      idEmpresa: empresa.id,
    });
    await aplicarPlan(cliente, plan);
    expect(await folio(CLAVE_SECUENCIA_ORDEN)).toBe(6000n);
  });

  it('una --empresa que no existe se caza antes de escribir, con la lista de las que hay', async () => {
    await opMigrada(5847n);

    const error = await planificar(cliente, {
      escalones: escalones([CLAVE_SECUENCIA_ORDEN, 6000n]),
      idEmpresa: empresa.id + 99,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ErrorEscalonInvalido);
    expect(error instanceof Error ? error.message : '').toContain('no existe esa empresa');
    expect(error instanceof Error ? error.message : '').toContain(empresa.nombre);
    expect(await cliente.secuencia.count()).toBe(0);
  });

  it('--empresa acota el escalón a UNA empresa; la otra sigue con su máximo + 1', async () => {
    const otra = await crearEmpresaPrueba(cliente, 'Marilyn Fitness de Prueba');
    await opMigrada(5847n);
    await cliente.orden.create({
      data: { folio: 200n, idEmpresa: otra.id, idModelo, idCliente: idClienteNegocio },
    });

    const plan = await planificar(cliente, {
      escalones: escalones([CLAVE_SECUENCIA_ORDEN, 6000n]),
      idEmpresa: empresa.id,
    });
    await aplicarPlan(cliente, plan);

    expect(await folio(CLAVE_SECUENCIA_ORDEN)).toBe(6000n);
    const enLaOtra = await enTransaccion(
      (tx) => siguienteFolio(tx, otra.id, CLAVE_SECUENCIA_ORDEN),
      { cliente },
    );
    expect(enLaOtra).toBe(201n);
  });
});
