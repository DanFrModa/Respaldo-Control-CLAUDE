/**
 * Tests de INTEGRACIÓN del MOTOR DE COSTEO (F7-E1) contra Postgres efímero (testcontainers). Arma un
 * modelo con receta, una orden con matriz y avance de corte/recibo/entrega, y ejercita el DOMINIO
 * (no HTTP). Verifica:
 *  (a) pre-costo = receta paraPreCosto × precios de catálogo + maquila (+ precio sugerido);
 *  (b) costo teórico de la orden = por-prenda × cortado; unitario sin guardar;
 *  (c) guardar arma costoTotal = Σ guardados; el teórico queda congelado al lado;
 *  (d) la base de prorrateo cambia el unitario (cortado→vendido) y queda visible;
 *  (e) una orden `noCostear` se rechaza al costear;
 *  (f) lista de costos y márgenes por pedido (fórmula D2);
 *  (g) sin `consultas.ver-importes` los importes salen en null (permiso de importes).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Empresa, PrismaClient } from '../../datos/index.js';
import { ErrorConflicto } from '../../comun/errores.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import type { ClavePermiso } from '../../contrato/index.js';

import { calcularPreCosto, listaPrecios } from './pre-costo.js';
import { guardarCostoOrden, listarCostos, obtenerCostoOrden } from './costo-orden.js';
import { margenesPorPedido } from './margenes.js';

let cliente: PrismaClient;
let empresa: Empresa;
let idModelo: number;
let idOrden: number;

const PERM_TODOS: ClavePermiso[] = [
  'costos.ver',
  'costos.capturar',
  'precostos.consultar',
  'consultas.ver-importes',
];

const sesion = (permisos: ClavePermiso[] = PERM_TODOS) =>
  sesionDePrueba({ idEmpresaActiva: empresa.id, permisos });
const bd = () => ({ cliente });

beforeAll(() => {
  cliente = clientePruebas();
});

afterAll(async () => {
  await cliente.$disconnect();
});

beforeEach(async () => {
  await limpiarBaseDatos(cliente);
  empresa = await crearEmpresaPrueba(cliente);
  await cliente.configuracionEmpresa.create({
    data: { idEmpresa: empresa.id, utilidadSugerida: 50, regaliasBase: 10 },
  });

  const rojo = await cliente.color.create({ data: { nombre: 'Rojo' } });
  const tallaCH = await cliente.talla.create({ data: { etiqueta: 'CH', orden: 1 } });
  const tallaM = await cliente.talla.create({ data: { etiqueta: 'M', orden: 2 } });

  const tela = await cliente.tela.create({ data: { nombre: 'Felpa', precioSugerido: 20 } });
  const avio = await cliente.avio.create({
    data: { clave: 'BOT', descripcion: 'Botón', precioReferencia: 3 },
  });
  const modelo = await cliente.modelo.create({
    data: {
      codigo: 'MOD-1',
      descripcion: 'Playera',
      maquilaBase: 8,
      telas: { create: [{ idTela: tela.id, consumoPorPrenda: 1.5 }] }, // banderas default true
      avios: { create: [{ idAvio: avio.id, consumoPorPrenda: 2 }] },
      // V1-E3d: el arte es HIJO del modelo, con su propio precio (ya no hay catálogo detrás).
      artes: { create: [{ nombre: 'Logo', precio: 5 }] },
    },
  });
  idModelo = modelo.id;

  const clienteNeg = await cliente.cliente.create({ data: { nombre: 'Tienda X' } });

  const pedido = await cliente.pedido.create({
    data: {
      folio: 1n,
      idEmpresa: empresa.id,
      idCliente: clienteNeg.id,
      fechaHasta: new Date('2026-06-30T00:00:00.000Z'),
    },
  });
  const linea = await cliente.pedidoLinea.create({
    data: { idPedido: pedido.id, idModelo: modelo.id, cantidadPedida: 35, precio: 100 },
  });
  const orden = await cliente.orden.create({
    data: {
      folio: 1n,
      idEmpresa: empresa.id,
      idPedidoLinea: linea.id,
      idModelo: modelo.id,
      idCliente: clienteNeg.id,
      estado: 'completa',
      fecha: new Date('2026-06-01T00:00:00.000Z'),
      maquilaOrd: 10,
      aplicacionOrd: 2,
      lineas: {
        create: [
          {
            idColor: rojo.id,
            tallas: {
              create: [
                { idTalla: tallaCH.id, cantidad: 15 },
                { idTalla: tallaM.id, cantidad: 20 },
              ],
            },
          },
        ],
      },
    },
  });
  idOrden = orden.id;

  // Corte de 30 (< pedido 35). Etapa insertada directo (el motor de corte es de F3).
  await cliente.etapaMovimiento.create({
    data: {
      folio: 100n,
      idEmpresa: empresa.id,
      idOrden: orden.id,
      tipo: 'corte',
      fecha: new Date('2026-06-02T00:00:00.000Z'),
      detalles: {
        create: [
          { idColor: rojo.id, idTalla: tallaCH.id, cantidad: 12 },
          { idColor: rojo.id, idTalla: tallaM.id, cantidad: 18 },
        ],
      },
    },
  });

  // Entrega a cliente de 20 (para la base de prorrateo `vendido`).
  await cliente.etapaMovimiento.create({
    data: {
      folio: 101n,
      idEmpresa: empresa.id,
      idOrden: orden.id,
      tipo: 'entrega_cliente',
      fecha: new Date('2026-06-10T00:00:00.000Z'),
      detalles: { create: [{ idColor: rojo.id, idTalla: tallaM.id, cantidad: 20 }] },
    },
  });
});

describe('calcularPreCosto', () => {
  it('valúa la receta paraPreCosto × catálogo + maquila y sugiere precio (50/10)', async () => {
    const pre = await calcularPreCosto(sesion(), idModelo, bd());
    expect(pre.totalTela).toBe(30); // 1.5 × 20
    expect(pre.totalAvios).toBe(6); // 2 × 3
    expect(pre.totalArte).toBe(5); // el precio del arte del modelo
    expect(pre.maquila).toBe(8);
    expect(pre.costoTotal).toBe(49); // 30 + 6 + 5 + 8 (SIN regalías)
    // precio sugerido = ceil( 49 / (1−0.5) / (1−0.1) ) = ceil(108.88) = 109.
    expect(pre.precioSugerido).toBe(109);
    expect(pre.utilidadSugerida).toBe(50);
    expect(pre.regaliasBase).toBe(10);
  });

  it('sin consultas.ver-importes oculta precios/importes (null) pero deja la estructura', async () => {
    const pre = await calcularPreCosto(sesion(['precostos.consultar']), idModelo, bd());
    expect(pre.costoTotal).toBeNull();
    expect(pre.precioSugerido).toBeNull();
    expect(pre.telas[0]?.importe).toBeNull();
    expect(pre.telas[0]?.consumoPorPrenda).toBe(1.5); // el consumo (no importe) sí se ve
  });
});

describe('listaPrecios', () => {
  it('lista el modelo con su costo y precio sugerido', async () => {
    const lista = await listaPrecios(sesion(), {}, bd());
    expect(lista.filas).toHaveLength(1);
    expect(lista.filas[0]?.costo).toBe(49);
    expect(lista.filas[0]?.precioSugerido).toBe(109);
  });
});

describe('obtenerCostoOrden (teórico + unitario)', () => {
  it('teórico total = por-prenda × cortado; unitario sin guardar = teórico ÷ cortado', async () => {
    const c = await obtenerCostoOrden(sesion(), idOrden, bd());
    expect(c.cantidades.cortado).toBe(30);
    expect(c.cantidades.vendido).toBe(20);
    // por prenda: tela 30, avíos 6, procesos = maquilaOrd 10 + aplicación 2 + bordado 5 = 17.
    expect(c.teorico.telaPorPrenda).toBe(30);
    expect(c.teorico.procesosPorPrenda).toBe(17);
    expect(c.teorico.total).toBe(1590); // (30 + 6 + 17) × 30
    expect(c.guardado).toBeNull();
    expect(c.unitario.base).toBe('cortado');
    expect(c.unitario.cantidadBase).toBe(30);
    expect(c.unitario.costoUnitario).toBe(53); // 1590 / 30
  });
});

describe('guardarCostoOrden', () => {
  it('arma costoTotal = Σ guardados y calcula el unitario; congela el teórico', async () => {
    const g = await guardarCostoOrden(
      sesion(),
      idOrden,
      { telaCost: 900, procesosCost: 510, aviosCost: 180, otros: 0, baseProrrateo: 'cortado' },
      bd(),
    );
    expect(g.guardado?.costoTotal).toBe(1590);
    expect(g.guardado?.telaCalc).toBe(900); // teórico congelado
    expect(g.unitario.costoUnitario).toBe(53);
  });

  it('sin componentes en el cuerpo, cae al teórico congelado (guardar = confirmar)', async () => {
    const g = await guardarCostoOrden(sesion(), idOrden, { baseProrrateo: 'cortado' }, bd());
    expect(g.guardado?.telaCost).toBe(900);
    expect(g.guardado?.procesosCost).toBe(510);
    expect(g.guardado?.aviosCost).toBe(180);
    expect(g.guardado?.costoTotal).toBe(1590);
  });

  it('la base de prorrateo cambia el unitario (cortado 30 → vendido 20)', async () => {
    await guardarCostoOrden(sesion(), idOrden, { baseProrrateo: 'cortado' }, bd());
    const conVendido = await guardarCostoOrden(
      sesion(),
      idOrden,
      { baseProrrateo: 'vendido' },
      bd(),
    );
    expect(conVendido.unitario.base).toBe('vendido');
    expect(conVendido.unitario.cantidadBase).toBe(20);
    expect(conVendido.unitario.costoUnitario).toBe(79.5); // 1590 / 20
  });

  it('RECHAZA costear una orden marcada noCostear', async () => {
    await cliente.orden.update({ where: { id: idOrden }, data: { noCostear: true } });
    await expect(
      guardarCostoOrden(sesion(), idOrden, { baseProrrateo: 'cortado' }, bd()),
    ).rejects.toBeInstanceOf(ErrorConflicto);
  });

  it('registra Bitácora (A7) al guardar', async () => {
    await guardarCostoOrden(sesion(), idOrden, { baseProrrateo: 'cortado' }, bd());
    const log = await cliente.bitacora.findFirst({
      where: { entidad: 'CostoOrden', idEntidad: String(idOrden) },
    });
    expect(log).not.toBeNull();
  });
});

describe('listarCostos', () => {
  it('lista solo órdenes ya costeadas, con su total y unitario', async () => {
    expect((await listarCostos(sesion(), {}, bd())).total).toBe(0); // aún sin costear
    await guardarCostoOrden(sesion(), idOrden, { baseProrrateo: 'cortado' }, bd());
    const lista = await listarCostos(sesion(), {}, bd());
    expect(lista.total).toBe(1);
    expect(lista.datos[0]?.costoTotal).toBe(1590);
    expect(lista.datos[0]?.costoUnitario).toBe(53);
  });
});

describe('margenesPorPedido (fórmula D2)', () => {
  it('margen = 1 − (costoUnit ÷ precio); agrega por pedido', async () => {
    await guardarCostoOrden(sesion(), idOrden, { baseProrrateo: 'cortado' }, bd());
    const m = await margenesPorPedido(sesion(), {}, bd());
    expect(m.filas).toHaveLength(1);
    const f = m.filas[0];
    expect(f?.cantidad).toBe(35); // cantidad pedida
    expect(f?.importe).toBe(3500); // 100 × 35
    // costoUnit 53, precio 100 → margen 1 − 0.53 = 0.47.
    expect(f?.margenPromedio).toBeCloseTo(0.47, 4);
    expect(f?.margenPonderado).toBeCloseTo(0.47, 4);
    expect(f?.margenPesosPorPieza).toBe(47); // 100 − 53
  });

  it('excluye órdenes sin costo (costoTotal = 0 / sin costear)', async () => {
    const m = await margenesPorPedido(sesion(), {}, bd());
    expect(m.filas).toHaveLength(0); // la orden aún no se costea
  });

  it('sin consultas.ver-importes oculta importes/márgenes (null)', async () => {
    await guardarCostoOrden(sesion(), idOrden, { baseProrrateo: 'cortado' }, bd());
    const m = await margenesPorPedido(sesion(['costos.ver']), {}, bd());
    expect(m.filas[0]?.importe).toBeNull();
    expect(m.filas[0]?.margenPromedio).toBeNull();
    expect(m.filas[0]?.cantidad).toBe(35); // la cantidad no es importe
    expect(m.totalImporte).toBeNull();
  });
});
