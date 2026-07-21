/**
 * Unit (sin BD, sin disco) del PRESCAN de ventana de F2: exclusión por fecha propia, cascada
 * pedido→renglón→orden y clientes "usados en ventana". Usa el núcleo puro con filas en memoria.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { calcularPrescanVentanaF2 } from './ventana-f2.js';
import { resolverVentana } from './ventana.js';

let desdePrevio: string | undefined;

beforeEach(() => {
  desdePrevio = process.env.ETL_DESDE;
  process.env.ETL_DESDE = '2025-01-01';
});

afterEach(() => {
  if (desdePrevio === undefined) delete process.env.ETL_DESDE;
  else process.env.ETL_DESDE = desdePrevio;
});

/** Fuentes de juguete: 3 pedidos (1 viejo), 3 renglones, 4 órdenes, clientes 1/2/3. */
const fuentes = {
  pedidos: [
    // Viejo (fuera): cliente 1 NO debe entrar por este pedido.
    { IdPedidos: '10', IdClientes: '1', FechaPedido: '01/06/2020 00:00:00' },
    // Dentro: cliente 2 usado.
    { IdPedidos: '11', IdClientes: '2', FechaPedido: '15/02/2025 00:00:00' },
    // Sin fecha = DENTRO (regla de los loaders): cliente 3 usado.
    { IdPedidos: '12', IdClientes: '3', FechaPedido: '' },
  ],
  pedidosDet: [
    { IdPedidosDet: '100', IdPedidos: '10' }, // renglón de pedido fuera → fuera
    { IdPedidosDet: '110', IdPedidos: '11' },
    { IdPedidosDet: '120', IdPedidos: '12' },
  ],
  ordenes: [
    // Fecha propia vieja → fuera aunque su pedido esté dentro.
    { IdOrdenes: '500', IdClientes: '2', IdPedidosDet: '110', Fecha: '01/03/2019 00:00:00' },
    // Dentro por fecha, pero cuelga del renglón 100 (pedido fuera) → CASCADA: fuera.
    { IdOrdenes: '501', IdClientes: '1', IdPedidosDet: '100', Fecha: '10/01/2025 00:00:00' },
    // Dentro y huérfana (IdPedidosDet 0) → dentro; cliente 3 usado.
    { IdOrdenes: '502', IdClientes: '3', IdPedidosDet: '0', Fecha: '20/03/2025 00:00:00' },
    // Dentro y ligada a renglón dentro → dentro; cliente 2 usado.
    { IdOrdenes: '503', IdClientes: '2', IdPedidosDet: '120', Fecha: '05/04/2025 00:00:00' },
  ],
};

describe('calcularPrescanVentanaF2 — cascada y clientes usados', () => {
  it('excluye pedidos por fecha propia y sus renglones en cascada', () => {
    const p = calcularPrescanVentanaF2(resolverVentana(), fuentes);
    expect(p.pedidosFuera).toEqual(new Set(['10']));
    expect(p.pedidosDetFuera).toEqual(new Set(['100']));
  });

  it('excluye órdenes por fecha propia Y por cascada del pedido', () => {
    const p = calcularPrescanVentanaF2(resolverVentana(), fuentes);
    expect(p.ordenesFuera).toEqual(new Set(['500', '501']));
  });

  it('clientesEnVentana = referenciados por pedidos/órdenes DENTRO (cliente 1 queda fuera)', () => {
    const p = calcularPrescanVentanaF2(resolverVentana(), fuentes);
    expect(p.clientesEnVentana).toEqual(new Set(['2', '3']));
  });

  it('pedido sin fecha cuenta como DENTRO (no se excluye lo que no tiene fecha)', () => {
    const p = calcularPrescanVentanaF2(resolverVentana(), fuentes);
    expect(p.pedidosFuera.has('12')).toBe(false);
    expect(p.clientesEnVentana.has('3')).toBe(true);
  });
});
