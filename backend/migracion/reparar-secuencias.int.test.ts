import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { siguienteFolio } from '../src/comun/secuencias.js';
import { enTransaccion } from '../src/comun/transaccion.js';
import type { Empresa, PrismaClient } from '../src/datos/index.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../src/pruebas/contexto.js';
import { CLAVE_SECUENCIA_ORDEN_COMPRA } from '../src/dominio/compras/ordenes-compra.js';
import { CLAVE_SECUENCIA_NOTA_SALIDA } from '../src/dominio/notas/notas-salida.js';
import { CLAVE_SECUENCIA_PEDIDO } from '../src/dominio/pedidos/pedidos.js';
import { repararSecuencias } from './reparar-secuencias.js';

/**
 * Prueba del defecto §Post-F9.17 (Daniel, 7-ago-2026: *"hice la OC pero al refrescar el listado, no
 * la veo"*): un histórico migrado con folio EXPLÍCITO deja su secuencia en cero, así que la primera
 * captura nueva arranca en 1 (se va al final del listado, que ordena descendente, y puede chocar
 * contra el unique `(idEmpresa, folio)`). `repararSecuencias` es la red permanente contra eso.
 */

let cliente: PrismaClient;
let empresa: Empresa;
let idProveedor: number;

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
});

/** Inserta una OC "migrada" (folio explícito, como lo hace el ETL de F4-E6). */
async function ocMigrada(numCompra: bigint): Promise<void> {
  await cliente.ordenCompra.create({
    data: { numCompra, idEmpresa: empresa.id, idProveedor },
  });
}

/** Pide el siguiente folio de una serie como lo haría una captura real. */
function folio(clave: string): Promise<bigint> {
  return enTransaccion((tx) => siguienteFolio(tx, empresa.id, clave), { cliente });
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
});
