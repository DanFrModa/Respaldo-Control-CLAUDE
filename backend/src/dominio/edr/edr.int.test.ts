/**
 * Tests de INTEGRACIÓN del EDR (F7-E2) contra Postgres efímero (testcontainers). Ejercita el DOMINIO
 * (no HTTP). Verifica:
 *  (a) generar propone líneas desde las entregas del mes; calcularEdr suma ventas/costo/resultado;
 *  (b) empresa `paraEdr=false` NO genera líneas; orden `noCostear` excluida;
 *  (c) costo ACTUAL (D1): cambiar `CostoOrden` revalúa el costo del EDR;
 *  (d) IDEMPOTENCIA: re-generar no duplica, no pisa `ajustada`/`manual`, elimina automáticas huérfanas;
 *  (e) líneas manuales (alta/baja) y el rechazo de borrar automáticas;
 *  (f) el encabezado (gastos) entra en el resultado; sinCosto marca líneas sin costo.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Empresa, PrismaClient } from '../../datos/index.js';
import { ErrorConflicto } from '../../comun/errores.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import type { ClavePermiso } from '../../contrato/index.js';

import {
  actualizarEncabezado,
  agregarLineaManual,
  ajustarLineaEdr,
  calcularEdr,
  edrPorAnio,
  edrPorMes,
  eliminarLineaManual,
  generarEdrMes,
  listarLineasEdr,
} from './edr.js';

let cliente: PrismaClient;
let empresa: Empresa;
let idColor: number;
let idTalla: number;
let contador = 0;

const PERM: ClavePermiso[] = ['edr.ver', 'edr.capturar'];
const sesion = (permisos: ClavePermiso[] = PERM) =>
  sesionDePrueba({ idEmpresaActiva: empresa.id, permisos });
const bd = () => ({ cliente });

/** Siembra una venta completa (modelo+pedido+orden+corte+entrega[+costo]) y devuelve la orden. */
async function sembrarVenta(opciones: {
  idEmpresa: number;
  precio: number;
  cortado: number;
  vendido: number;
  costoTotal: number | null;
  noCostear?: boolean;
  fecha?: string;
}): Promise<{ idOrden: number; idModelo: number; idCliente: number }> {
  contador += 1;
  const fecha = new Date(opciones.fecha ?? '2026-06-15T00:00:00.000Z');
  const modelo = await cliente.modelo.create({ data: { codigo: `MOD-${contador}` } });
  const clienteNeg = await cliente.cliente.create({ data: { nombre: `Cliente ${contador}` } });
  const pedido = await cliente.pedido.create({
    data: { folio: BigInt(contador), idEmpresa: opciones.idEmpresa, idCliente: clienteNeg.id },
  });
  const linea = await cliente.pedidoLinea.create({
    data: {
      idPedido: pedido.id,
      idModelo: modelo.id,
      cantidadPedida: opciones.cortado,
      precio: opciones.precio,
    },
  });
  const orden = await cliente.orden.create({
    data: {
      folio: BigInt(contador),
      idEmpresa: opciones.idEmpresa,
      idPedidoLinea: linea.id,
      idModelo: modelo.id,
      idCliente: clienteNeg.id,
      estado: 'completa',
      noCostear: opciones.noCostear ?? false,
    },
  });
  // Corte (base 'cortado') y entrega a cliente en el mes.
  await cliente.etapaMovimiento.create({
    data: {
      folio: BigInt(1000 + contador),
      idEmpresa: opciones.idEmpresa,
      idOrden: orden.id,
      tipo: 'corte',
      fecha,
      detalles: { create: [{ idColor, idTalla, cantidad: opciones.cortado }] },
    },
  });
  await cliente.etapaMovimiento.create({
    data: {
      folio: BigInt(2000 + contador),
      idEmpresa: opciones.idEmpresa,
      idOrden: orden.id,
      tipo: 'entrega_cliente',
      fecha,
      detalles: { create: [{ idColor, idTalla, cantidad: opciones.vendido }] },
    },
  });
  if (opciones.costoTotal !== null) {
    await cliente.costoOrden.create({
      data: {
        idOrden: orden.id,
        idEmpresa: opciones.idEmpresa,
        costoTotal: opciones.costoTotal,
        baseProrrateo: 'cortado',
      },
    });
  }
  return { idOrden: orden.id, idModelo: modelo.id, idCliente: clienteNeg.id };
}

beforeAll(() => {
  cliente = clientePruebas();
});

afterAll(async () => {
  await cliente.$disconnect();
});

beforeEach(async () => {
  await limpiarBaseDatos(cliente);
  empresa = await crearEmpresaPrueba(cliente);
  const color = await cliente.color.create({ data: { nombre: 'Rojo' } });
  const talla = await cliente.talla.create({ data: { etiqueta: 'M', orden: 1 } });
  idColor = color.id;
  idTalla = talla.id;
  contador = 0;
});

describe('generarEdrMes + calcularEdr', () => {
  it('propone una línea desde la entrega y suma ventas/costo/resultado (costo actual)', async () => {
    // cortado 30, costoTotal 600 → unit 20; vendido 20 → costo 400; precio 100 → ventas 2000.
    await sembrarVenta({
      idEmpresa: empresa.id,
      precio: 100,
      cortado: 30,
      vendido: 20,
      costoTotal: 600,
    });
    const edr = await generarEdrMes(sesion(), 2026, 6, bd());
    expect(edr.totalLineas).toBe(1);
    expect(edr.ventas).toBe(2000);
    expect(edr.costo).toBe(400);
    expect(edr.resultado).toBe(1600);
    expect(edr.cortesEmpresa).toHaveLength(1);
    expect(edr.cortesEmpresa[0]?.ventas).toBe(2000);
    expect(edr.cortesCliente).toHaveLength(1);
    expect(edr.lineasSinCosto).toBe(0);
  });

  it('excluye empresas paraEdr=false y órdenes noCostear', async () => {
    const otra = await cliente.empresa.create({
      data: { nombre: 'No EDR', paraIpt: true, paraEdr: false },
    });
    await sembrarVenta({
      idEmpresa: otra.id,
      precio: 100,
      cortado: 10,
      vendido: 10,
      costoTotal: 100,
    });
    await sembrarVenta({
      idEmpresa: empresa.id,
      precio: 50,
      cortado: 10,
      vendido: 10,
      costoTotal: 100,
      noCostear: true,
    });
    const edr = await generarEdrMes(sesion(), 2026, 6, bd());
    expect(edr.totalLineas).toBe(0);
    expect(edr.ventas).toBe(0);
  });

  it('valúa a COSTO ACTUAL: cambiar CostoOrden revalúa el EDR', async () => {
    const v = await sembrarVenta({
      idEmpresa: empresa.id,
      precio: 100,
      cortado: 10,
      vendido: 10,
      costoTotal: 500, // unit 50 → costo 500
    });
    const edr1 = await generarEdrMes(sesion(), 2026, 6, bd());
    expect(edr1.costo).toBe(500);

    // Sube el costo de la orden; el EDR NO se re-genera, solo se re-lee (costo actual, D1).
    await cliente.costoOrden.update({
      where: { idOrden: v.idOrden },
      data: { costoTotal: 800 }, // unit 80 → costo 800
    });
    const edr2 = await calcularEdr(sesion(), edr1.encabezado.id, bd());
    expect(edr2.costo).toBe(800);
    expect(edr2.resultado).toBe(1000 - 800);
  });

  it('marca sinCosto la línea de una orden sin CostoOrden', async () => {
    await sembrarVenta({
      idEmpresa: empresa.id,
      precio: 100,
      cortado: 10,
      vendido: 10,
      costoTotal: null,
    });
    const edr = await generarEdrMes(sesion(), 2026, 6, bd());
    expect(edr.lineasSinCosto).toBe(1);
    expect(edr.costo).toBe(0);
    const lineas = await listarLineasEdr(sesion(), edr.encabezado.id, {}, bd());
    expect(lineas.lineas[0]?.sinCosto).toBe(true);
  });

  it('el encabezado (gastos) entra en el resultado', async () => {
    await sembrarVenta({
      idEmpresa: empresa.id,
      precio: 100,
      cortado: 10,
      vendido: 10,
      costoTotal: 200,
    });
    const edr = await generarEdrMes(sesion(), 2026, 6, bd());
    await actualizarEncabezado(
      sesion(),
      edr.encabezado.id,
      { gastos: 300, bonificaciones: 50 },
      bd(),
    );
    const con = await calcularEdr(sesion(), edr.encabezado.id, bd());
    // ventas 1000 − costo 200 − gastos 300 + bonif 50 = 550.
    expect(con.resultado).toBe(550);
  });
});

describe('idempotencia de generarEdrMes', () => {
  it('re-generar NO duplica, NO pisa ajustada/manual y elimina automáticas huérfanas', async () => {
    const v1 = await sembrarVenta({
      idEmpresa: empresa.id,
      precio: 100,
      cortado: 10,
      vendido: 10,
      costoTotal: 100,
    });
    await sembrarVenta({
      idEmpresa: empresa.id,
      precio: 50,
      cortado: 8,
      vendido: 8,
      costoTotal: 80,
    });
    const edr = await generarEdrMes(sesion(), 2026, 6, bd());
    const idEdr = edr.encabezado.id;
    expect(edr.totalLineas).toBe(2);

    // Ajusta la línea de v1 (precio facturado 999). Pasa a 'ajustada'.
    const lineas = await listarLineasEdr(sesion(), idEdr, {}, bd());
    const lineaV1 = lineas.lineas.find((l) => l.idOrden === v1.idOrden);
    expect(lineaV1).toBeDefined();
    await ajustarLineaEdr(sesion(), lineaV1!.id, { cantVendida: 10, precioVenta: 999 }, bd());

    // Agrega una línea manual.
    await agregarLineaManual(
      sesion(),
      idEdr,
      { idEmpresa: empresa.id, idCliente: v1.idCliente, cantVendida: 5, precioVenta: 10 },
      bd(),
    );

    // Re-genera: no duplica; ajustada + manual intactas.
    const edr2 = await generarEdrMes(sesion(), 2026, 6, bd());
    const lineas2 = await listarLineasEdr(sesion(), idEdr, {}, bd());
    expect(lineas2.lineas).toHaveLength(3); // 2 autom (una ahora ajustada) + 1 manual
    const ajustada = lineas2.lineas.find((l) => l.idOrden === v1.idOrden);
    expect(ajustada?.origen).toBe('ajustada');
    expect(ajustada?.precioVenta).toBe(999); // NO se pisó con el precio del pedido (100)
    expect(lineas2.lineas.some((l) => l.origen === 'manual')).toBe(true);
    expect(edr2.totalLineas).toBe(3);

    // Cancela la entrega de la 2ª orden (automática) → su línea automática queda huérfana.
    const segunda = lineas2.lineas.find(
      (l) => l.idOrden !== null && l.idOrden !== v1.idOrden && l.origen === 'automatica',
    );
    expect(segunda).toBeDefined();
    await cliente.etapaMovimiento.updateMany({
      where: { idOrden: segunda!.idOrden!, tipo: 'entrega_cliente' },
      data: { canceladoEn: new Date() },
    });
    await generarEdrMes(sesion(), 2026, 6, bd());
    const lineas3 = await listarLineasEdr(sesion(), idEdr, {}, bd());
    // La automática huérfana se fue; ajustada + manual siguen.
    expect(lineas3.lineas).toHaveLength(2);
    expect(lineas3.lineas.some((l) => l.idOrden === segunda!.idOrden)).toBe(false);
    expect(lineas3.lineas.some((l) => l.origen === 'ajustada')).toBe(true);
    expect(lineas3.lineas.some((l) => l.origen === 'manual')).toBe(true);
  });
});

describe('líneas manuales', () => {
  it('agrega una manual (empresa paraEdr) y la elimina; rechaza borrar una automática', async () => {
    const v = await sembrarVenta({
      idEmpresa: empresa.id,
      precio: 100,
      cortado: 10,
      vendido: 10,
      costoTotal: 100,
    });
    const edr = await generarEdrMes(sesion(), 2026, 6, bd());
    const manual = await agregarLineaManual(
      sesion(),
      edr.encabezado.id,
      {
        idEmpresa: empresa.id,
        idCliente: v.idCliente,
        descripcion: 'Ajuste',
        cantVendida: 3,
        precioVenta: 200,
      },
      bd(),
    );
    expect(manual.origen).toBe('manual');
    expect(manual.importe).toBe(600);

    // No se puede borrar la automática.
    const lineas = await listarLineasEdr(sesion(), edr.encabezado.id, {}, bd());
    const auto = lineas.lineas.find((l) => l.origen === 'automatica');
    await expect(eliminarLineaManual(sesion(), auto!.id, bd())).rejects.toBeInstanceOf(
      ErrorConflicto,
    );

    // La manual sí.
    await eliminarLineaManual(sesion(), manual.id, bd());
    const lineas2 = await listarLineasEdr(sesion(), edr.encabezado.id, {}, bd());
    expect(lineas2.lineas.some((l) => l.id === manual.id)).toBe(false);
  });
});

describe('consultas por mes / año', () => {
  it('edrPorMes devuelve existe:false antes de generar y el EDR después', async () => {
    const antes = await edrPorMes(sesion(), 2026, 7, bd());
    expect(antes.existe).toBe(false);
    expect(antes.edr).toBeNull();

    await sembrarVenta({
      idEmpresa: empresa.id,
      precio: 100,
      cortado: 10,
      vendido: 10,
      costoTotal: 100,
      fecha: '2026-07-10T00:00:00.000Z',
    });
    await generarEdrMes(sesion(), 2026, 7, bd());
    const despues = await edrPorMes(sesion(), 2026, 7, bd());
    expect(despues.existe).toBe(true);
    expect(despues.edr?.ventas).toBe(1000);
  });

  it('edrPorAnio arma el comparativo mensual', async () => {
    await sembrarVenta({
      idEmpresa: empresa.id,
      precio: 100,
      cortado: 10,
      vendido: 10,
      costoTotal: 100,
      fecha: '2026-06-10T00:00:00.000Z',
    });
    await generarEdrMes(sesion(), 2026, 6, bd());
    const anual = await edrPorAnio(sesion(), 2026, bd());
    expect(anual.meses).toHaveLength(1);
    expect(anual.meses[0]?.mes).toBe(6);
    expect(anual.totalVentas).toBe(1000);
    expect(anual.porEmpresa).toHaveLength(1);
  });
});

describe('permisos', () => {
  it('generar exige edr.capturar', async () => {
    await expect(generarEdrMes(sesion(['edr.ver']), 2026, 6, bd())).rejects.toThrow();
  });
});
