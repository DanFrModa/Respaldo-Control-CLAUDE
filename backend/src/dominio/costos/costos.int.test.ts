/**
 * Tests de INTEGRACIÓN del MOTOR DE COSTEO (F7-E1) contra Postgres efímero (testcontainers). Arma un
 * modelo con receta, una orden con matriz y avance de corte/recibo/entrega, y ejercita el DOMINIO
 * (no HTTP). Verifica:
 *  (a) pre-costo = receta paraPreCosto × precios de catálogo + maquila (+ precio sugerido);
 *  (b) costo teórico de la orden = por-prenda × cortado; unitario sin guardar;
 *  (c) guardar arma costoTotal = Σ guardados; el teórico queda congelado al lado;
 *  (d) la base de prorrateo cambia el unitario (cortado→vendido) y queda visible;
 *  (d2) ⭐ 0.061: el DEFAULT del divisor es `recibido` (no `cortado`), omitir la base CONSERVA la
 *       guardada, y sin piezas recibidas la salida DICE por qué no hay unitario;
 *  (d3) ⭐ 0.061: CERRAR la orden congela el unitario (otro recibo ya no lo mueve) y REABRIRLA lo
 *       devuelve a cálculo vivo; una orden cerrada no se puede costear;
 *  (e) una orden `noCostear` se rechaza al costear;
 *  (f) lista de costos y márgenes por pedido (fórmula D2);
 *  (g) sin `consultas.ver-importes` los importes salen en null (permiso de importes).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Empresa, PrismaClient } from '../../datos/index.js';
import { ErrorConflicto, ErrorPermiso } from '../../comun/errores.js';
import {
  clientePruebas,
  crearEmpresaPrueba,
  crearTipoArtePrueba,
  limpiarBaseDatos,
} from '../../pruebas/contexto.js';
import { sembrarRecetaDeOrden } from '../../pruebas/receta.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import type { ClavePermiso } from '../../contrato/index.js';

import { crearDesarrollo } from '../desarrollo/desarrollos.js';
import { generarPrecosto } from '../desarrollo/precostos.js';
import { crearProyecto } from '../desarrollo/proyectos.js';
import { obtenerFichaModelo } from '../modelos/bom-modelo.js';

import { calcularPreCosto, listaPrecios } from './pre-costo.js';
import { guardarCostoOrden, listarCostos, obtenerCostoOrden } from './costo-orden.js';
import { margenesPorPedido } from './margenes.js';
import { cerrarOrden, reabrirOrden } from '../produccion/cierre-orden.js';
import { realinearEstadoOrdenes } from '../produccion/requisitos-orden.js';

let cliente: PrismaClient;
/** Id del tipo de arte «bordado» del catálogo único (V1-E3f): el arte no existe sin él. */
let idTipoArte: number;
let empresa: Empresa;
let idModelo: number;
let idOrden: number;
/** Proceso de costura (`generaEntradaPt`): sin él la base `recibido` sería siempre 0 (0.061). */
let idProcesoCostura: number;

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
  idTipoArte = await crearTipoArtePrueba(cliente);
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
      // V1-E3f: su tipo sale del catálogo ÚNICO (`TipoProceso` con `esArte`).
      artes: { create: [{ descripcion: 'Logo', idTipoArte, precio: 5 }] },
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
  // V1-E3d: el costeo lee la RECETA DE LA ORDEN. La orden se crea aquí directo (sin `crearOrden`,
  // que es quien la copia), así que se siembra igual — con `precio` NULL, como el backfill de la
  // migración: el costeo cae al catálogo y estas cifras no se mueven ni un centavo.
  await sembrarRecetaDeOrden(cliente, idOrden, modelo.id);

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

  // ⭐ 0.061: RECIBO de costura de 25 (para la base de prorrateo `recibido`, que desde esta versión
  // es el DEFAULT). `recibido` sólo suma recibos de procesos con `generaEntradaPt`, así que el
  // proceso tiene que existir y traer la bandera — si no, la base sería 0 y no se podría medir la
  // división de verdad.
  const costura = await cliente.tipoProceso.create({
    data: { codigo: 'costura', nombre: 'Costura', generaEntradaPt: true },
  });
  idProcesoCostura = costura.id;
  await cliente.etapaMovimiento.create({
    data: {
      folio: 102n,
      idEmpresa: empresa.id,
      idOrden: orden.id,
      tipo: 'recibo_maquila',
      idTipoProceso: costura.id,
      fecha: new Date('2026-06-08T00:00:00.000Z'),
      detalles: { create: [{ idColor: rojo.id, idTalla: tallaM.id, cantidad: 25 }] },
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
  it('teórico total = por-prenda × CORTADO; unitario sin guardar = teórico ÷ RECIBIDO (0.061)', async () => {
    const c = await obtenerCostoOrden(sesion(), idOrden, bd());
    expect(c.cantidades.cortado).toBe(30);
    expect(c.cantidades.recibido).toBe(25);
    expect(c.cantidades.vendido).toBe(20);
    // El TEÓRICO sigue refiriéndose a las CORTADAS (es "lo que costó producir lo que se cortó"):
    // eso NO lo cambió 0.061, que sólo movió el DIVISOR del unitario.
    // por prenda: tela 30, avíos 6, procesos = maquilaOrd 10 + aplicación 2 + bordado 5 = 17.
    expect(c.teorico.telaPorPrenda).toBe(30);
    expect(c.teorico.procesosPorPrenda).toBe(17);
    expect(c.teorico.total).toBe(1590); // (30 + 6 + 17) × 30
    expect(c.guardado).toBeNull();
    // ⭐ 0.061: el default es `recibido`, no `cortado` (§Post-F9.154(b)).
    expect(c.unitario.base).toBe('recibido');
    expect(c.unitario.cantidadBase).toBe(25);
    expect(c.unitario.costoUnitario).toBe(63.6); // 1590 / 25
    expect(c.unitario.motivoSinUnitario).toBeNull();
    expect(c.ordenCerrada).toBe(false);
  });

  it('⭐ 0.061: SIN piezas recibidas no hay unitario, y la salida DICE por qué', async () => {
    // Es el caso que estrena el divisor nuevo: la orden se cortó pero todavía no vuelve nada de
    // costura. Antes daba 53 (÷ cortado); ahora dice la verdad — todavía no se sabe.
    await cliente.etapaMovimiento.deleteMany({ where: { idOrden, tipo: 'recibo_maquila' } });
    const c = await obtenerCostoOrden(sesion(), idOrden, bd());
    expect(c.cantidades.cortado).toBe(30); // el corte sigue ahí: no es que falte información
    expect(c.unitario.cantidadBase).toBe(0);
    expect(c.unitario.costoUnitario).toBeNull();
    expect(c.unitario.motivoSinUnitario).toBe('sin-base');
    expect(c.unitario.textoSinUnitario).toContain('piezas recibidas');
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

  it('⭐ 0.061: OMITIR la base CONSERVA la guardada (ya no la pisa a `cortado`)', async () => {
    // El defecto que esta fila cerró: el `.default("cortado")` del Zod hacía que un PUT que
    // omitiera el campo REESCRIBIERA la base de una orden ya costeada, cambiándole el unitario sin
    // que nadie lo pidiera. Con el default en `recibido` habría sido peor todavía.
    await guardarCostoOrden(sesion(), idOrden, { baseProrrateo: 'vendido' }, bd());
    const g = await guardarCostoOrden(sesion(), idOrden, { telaCost: 900 }, bd());
    expect(g.guardado?.baseProrrateo).toBe('vendido');
    expect(g.unitario.base).toBe('vendido');
    expect(g.unitario.cantidadBase).toBe(20);
  });

  it('⭐ 0.061: en el PRIMER costeo, omitir la base cae a `recibido` (el default nuevo)', async () => {
    const g = await guardarCostoOrden(sesion(), idOrden, { telaCost: 900 }, bd());
    expect(g.guardado?.baseProrrateo).toBe('recibido');
    expect(g.unitario.cantidadBase).toBe(25);
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

// ── V1-E3e · UN SOLO COSTO (§Post-F9.48): el criterio de cierre de la etapa ───────────────────────

describe('V1-E3e — el mismo renglón vale lo mismo en la RECETA, el PRE-COSTO y el PRECOSTEO', () => {
  const PERM_TRES: ClavePermiso[] = [
    ...PERM_TODOS,
    'modelos.ver',
    'desarrollo.ver',
    'desarrollo.administrar',
    'desarrollo.precostear',
  ];

  /** Conceptos base del precosto (los del seed de F8-E1). */
  async function sembrarConceptos(): Promise<void> {
    for (const c of [
      { codigo: 'tela', nombre: 'Tela', orden: 1, fijo: true },
      { codigo: 'avios', nombre: 'Avíos', orden: 2, fijo: true },
      { codigo: 'maquila', nombre: 'Maquila', orden: 3, fijo: true },
      { codigo: 'bordado', nombre: 'Bordado', orden: 5, fijo: false },
      { codigo: 'corte', nombre: 'Corte', orden: 8, fijo: true },
      // ⭐ V1-E8w: EMPAQUE, la tercera ancla fija — sin él `generarPrecosto` truena.
      { codigo: 'empaque', nombre: 'Empaque', orden: 9, fijo: true },
    ]) {
      await cliente.conceptoCosto.create({ data: c });
    }
  }

  it('los tres motores dan el MISMO precio, y ese precio es el de la última compra real', async () => {
    await sembrarConceptos();
    const s = sesionDePrueba({ idEmpresaActiva: empresa.id, permisos: PERM_TRES });

    const tela = await cliente.tela.create({ data: { nombre: 'Polar', precioSugerido: 20 } });
    const avio = await cliente.avio.create({
      data: { clave: 'ETQ', descripcion: 'Etiqueta', precioReferencia: 1 },
    });
    const prov = await cliente.proveedor.create({ data: { nombre: 'Insumos SA' } });
    // El avío ADEMÁS tiene proveedor de catálogo: antes de V1-E3e el pre-costo rápido usaba el
    // `precioReferencia` ($1) y el precosto el "más barato" ($2). Ahora los dos toman la compra.
    await cliente.avioProveedor.create({
      data: { idAvio: avio.id, idProveedor: prov.id, precio: 2 },
    });

    // Compras REALES (OC autorizadas), más recientes que cualquier precio de catálogo.
    for (const [n, datos] of [
      [1, { idTela: tela.id, precio: 33 }],
      [2, { idAvio: avio.id, precio: 4.5 }],
    ] as const) {
      await cliente.ordenCompra.create({
        data: {
          numCompra: BigInt(n),
          idEmpresa: empresa.id,
          idProveedor: prov.id,
          estatus: 'autorizada',
          fecha: new Date('2026-07-15T00:00:00.000Z'),
          lineas: {
            create: [
              {
                idTela: 'idTela' in datos ? datos.idTela : null,
                idAvio: 'idAvio' in datos ? datos.idAvio : null,
                cantidad: 50,
                precio: datos.precio,
              },
            ],
          },
        },
      });
    }

    const modelo = await cliente.modelo.create({
      data: {
        codigo: 'TRES-MOTORES',
        maquilaBase: 0,
        telas: { create: [{ idTela: tela.id, consumoPorPrenda: 2 }] },
        avios: { create: [{ idAvio: avio.id, consumoPorPrenda: 3 }] },
      },
    });

    // 1) La RECETA (lo que ve el usuario en la ficha del modelo).
    const ficha = await obtenerFichaModelo(s, modelo.id, bd());
    expect(ficha.telas[0]?.precioCosteo).toBe(33);
    expect(ficha.telas[0]?.origenPrecio).toBe('ultimo-precio-compra');
    expect(ficha.telas[0]?.proveedorPrecio).toBe('Insumos SA');
    expect(ficha.avios[0]?.precioCosteo).toBe(4.5);
    expect(ficha.avios[0]?.origenPrecio).toBe('ultimo-precio-compra');

    // 2) El PRE-COSTO rápido de F7.
    const pre = await calcularPreCosto(s, modelo.id, bd());
    expect(pre.telas[0]?.precioUnitario).toBe(33);
    expect(pre.avios[0]?.precioUnitario).toBe(4.5);
    expect(pre.totalTela).toBe(66); // 2 × 33
    expect(pre.totalAvios).toBe(13.5); // 3 × 4.5

    // 3) El PRECOSTEO persistido de F8.
    const clienteNeg = await cliente.cliente.create({ data: { nombre: 'C&A' } });
    const depto = await cliente.clienteDepartamento.create({
      data: { idCliente: clienteNeg.id, nombre: 'NIÑOS' },
    });
    const proyecto = await crearProyecto(
      s,
      { idCliente: clienteNeg.id, idClienteDepartamento: depto.id, nombre: 'Cierre V1' },
      bd(),
    );
    const desarrollo = await crearDesarrollo(s, proyecto.id, { idModelo: modelo.id }, bd());
    const precosto = await generarPrecosto(s, desarrollo.id, bd());

    expect(precosto.lineas.find((l) => l.conceptoCodigo === 'tela')?.precioUnit).toBe(33);
    expect(precosto.lineas.find((l) => l.conceptoCodigo === 'avios')?.precioUnit).toBe(4.5);

    // ⭐ El criterio de cierre, dicho en una aserción: los TRES coinciden, renglón por renglón.
    expect([
      ficha.telas[0]?.precioCosteo,
      pre.telas[0]?.precioUnitario,
      precosto.lineas.find((l) => l.conceptoCodigo === 'tela')?.precioUnit,
    ]).toEqual([33, 33, 33]);
    expect([
      ficha.avios[0]?.precioCosteo,
      pre.avios[0]?.precioUnitario,
      precosto.lineas.find((l) => l.conceptoCodigo === 'avios')?.precioUnit,
    ]).toEqual([4.5, 4.5, 4.5]);
  });

  it('⭐ C1: la receta AVISA cuando el amarre no firmó el precio (la compra fue a otro)', async () => {
    const s = sesionDePrueba({ idEmpresaActiva: empresa.id, permisos: PERM_TRES });
    const tela = await cliente.tela.create({ data: { nombre: 'Rib', precioSugerido: 40 } });
    const alsatex = await cliente.proveedor.create({ data: { nombre: 'Alsatex' } });
    const otro = await cliente.proveedor.create({ data: { nombre: 'Otro Textil' } });
    // Amarre SIN precio capturado (la columna es nullable: amarrar antes de negociar es lo normal).
    const amarre = await cliente.telaProveedor.create({
      data: { idTela: tela.id, idProveedor: alsatex.id, precio: null },
    });
    // A Alsatex NUNCA se le compró; la última compra fue a Otro Textil.
    await cliente.ordenCompra.create({
      data: {
        numCompra: 90n,
        idEmpresa: empresa.id,
        idProveedor: otro.id,
        estatus: 'autorizada',
        fecha: new Date('2026-07-01T00:00:00.000Z'),
        lineas: { create: [{ idTela: tela.id, cantidad: 10, precio: 15 }] },
      },
    });
    const modelo = await cliente.modelo.create({
      data: {
        codigo: 'AMARRE-IGNORADO',
        maquilaBase: 0,
        telas: { create: [{ idTela: tela.id, consumoPorPrenda: 1, idTelaProveedor: amarre.id }] },
      },
    });

    const ficha = await obtenerFichaModelo(s, modelo.id, bd());
    // La cifra es CORRECTA (el precio real más reciente) y se dice de quién es…
    expect(ficha.telas[0]?.precioCosteo).toBe(15);
    expect(ficha.telas[0]?.proveedorPrecio).toBe('Otro Textil');
    // …pero el amarre NO está mandando, y eso hay que gritarlo (si no, Desarrollo cotiza creyendo
    // que su proveedor negociado fija el costo).
    expect(ficha.telas[0]?.amarreIgnorado).toBe(true);
  });

  it('⭐ C1: costear por la última compra AL PROVEEDOR AMARRADO no es "amarre ignorado"', async () => {
    const s = sesionDePrueba({ idEmpresaActiva: empresa.id, permisos: PERM_TRES });
    const tela = await cliente.tela.create({ data: { nombre: 'Polar', precioSugerido: 40 } });
    const alsatex = await cliente.proveedor.create({ data: { nombre: 'Alsatex' } });
    const amarre = await cliente.telaProveedor.create({
      data: { idTela: tela.id, idProveedor: alsatex.id, precio: 25 },
    });
    await cliente.ordenCompra.create({
      data: {
        numCompra: 91n,
        idEmpresa: empresa.id,
        idProveedor: alsatex.id,
        estatus: 'autorizada',
        fecha: new Date('2026-07-01T00:00:00.000Z'),
        lineas: { create: [{ idTela: tela.id, cantidad: 10, precio: 28 }] },
      },
    });
    const modelo = await cliente.modelo.create({
      data: {
        codigo: 'AMARRE-OK',
        maquilaBase: 0,
        telas: { create: [{ idTela: tela.id, consumoPorPrenda: 1, idTelaProveedor: amarre.id }] },
      },
    });

    const ficha = await obtenerFichaModelo(s, modelo.id, bd());
    expect(ficha.telas[0]?.precioCosteo).toBe(28);
    expect(ficha.telas[0]?.origenPrecio).toBe('ultimo-precio-compra');
    // Es el camino NORMAL desde §Post-F9.48: no debe gritar.
    expect(ficha.telas[0]?.amarreIgnorado).toBe(false);
  });

  it('el pre-costo rápido ya conoce el PROMEDIO DE MEDIDAS y el CONSUMO POR TALLA (R5/R18)', async () => {
    const s = sesionDePrueba({ idEmpresaActiva: empresa.id, permisos: PERM_TRES });
    const avio = await cliente.avio.create({
      data: { clave: 'ELA', descripcion: 'Elástico', precioReferencia: 1 },
    });
    // Avío POR MEDIDA: su precio es el PROMEDIO de las medidas activas (no el precioReferencia).
    await cliente.avioMedida.createMany({
      data: [
        { idAvio: avio.id, medida: '2cm', precio: 5.8 },
        { idAvio: avio.id, medida: '3cm', precio: 6.2 },
        { idAvio: avio.id, medida: '4cm', precio: 9, activo: false }, // inactiva: no promedia
      ],
    });
    const tCh = await cliente.talla.create({ data: { etiqueta: 'XCH', orden: 9 } });
    const tG = await cliente.talla.create({ data: { etiqueta: 'XG', orden: 10 } });
    const modelo = await cliente.modelo.create({
      data: {
        codigo: 'MEDIDAS-Y-TALLAS',
        maquilaBase: 0,
        avios: {
          create: [{ idAvio: avio.id, consumoPorPrenda: 1, consumoPorTalla: true }],
        },
      },
    });
    const renglon = await cliente.modeloAvio.findFirstOrThrow({
      where: { idModelo: modelo.id, idAvio: avio.id },
    });
    await cliente.modeloAvioTalla.createMany({
      data: [
        { idModelo: renglon.idModelo, idAvio: renglon.idAvio, idTalla: tCh.id, consumo: 0.8 },
        { idModelo: renglon.idModelo, idAvio: renglon.idAvio, idTalla: tG.id, consumo: 1.2 },
      ],
    });

    const pre = await calcularPreCosto(s, modelo.id, bd());
    // Precio = promedio de medidas ACTIVAS (5.8 + 6.2)/2 = 6 (NO el precioReferencia de 1).
    expect(pre.avios[0]?.precioUnitario).toBe(6);
    // Consumo = promedio por talla (0.8 + 1.2)/2 = 1 — aquí coincide con `consumoPorPrenda`, así
    // que lo que fija la regla es el importe: 1 × 6 = 6.
    expect(pre.avios[0]?.consumoPorPrenda).toBe(1);
    expect(pre.totalAvios).toBe(6);
  });
});

// ── ⭐⭐ 0.061 · CERRAR LA ORDEN CONGELA EL COSTO (§Post-F9.154(c)) ──────────────────────────────

describe('cerrarOrden / reabrirOrden: el costo deja de "ir cambiando"', () => {
  /**
   * Sesión con permiso de cerrar (además de ver/capturar costos).
   *
   * ⚠️ Lleva TAMBIÉN `ordenes.ver`, y no es decorado: `cerrarOrden`/`reabrirOrden` **devuelven la
   * orden** y la leen con `obtenerOrden`, que lo exige. Sin él el acto lanza `ErrorPermiso` —y
   * ahora lo lanza ANTES de escribir nada, ver la prueba del «403-tras-commit» de más abajo—.
   */
  const sesionCierre = () => sesion([...PERM_TODOS, 'ordenes.cerrar', 'ordenes.ver']);

  /** Mete OTRO recibo de costura de `piezas` — lo que movería el divisor si no estuviera congelado. */
  async function otroReciboDeCostura(piezas: number, folio: bigint): Promise<void> {
    const linea = await cliente.ordenLinea.findFirstOrThrow({
      where: { idOrden },
      select: { idColor: true, tallas: { select: { idTalla: true } } },
    });
    await cliente.etapaMovimiento.create({
      data: {
        folio,
        idEmpresa: empresa.id,
        idOrden,
        tipo: 'recibo_maquila',
        idTipoProceso: idProcesoCostura,
        fecha: new Date('2026-06-25T00:00:00.000Z'),
        detalles: {
          create: [
            {
              idColor: linea.idColor,
              idTalla: linea.tallas[0]?.idTalla ?? 0,
              cantidad: piezas,
            },
          ],
        },
      },
    });
  }

  it('⭐ EL CORAZÓN: cerrar CONGELA cantidad y unitario, y otro recibo YA NO los mueve', async () => {
    // Antes de 0.061 el dinero se persistía pero la CANTIDAD se re-sumaba en cada lectura: con el
    // divisor en `recibido`, el unitario habría quedado vivo hasta el último recibo, para siempre.
    await guardarCostoOrden(sesionCierre(), idOrden, { baseProrrateo: 'recibido' }, bd());
    const antes = await obtenerCostoOrden(sesionCierre(), idOrden, bd());
    expect(antes.unitario.cantidadBase).toBe(25);
    expect(antes.unitario.costoUnitario).toBe(63.6); // 1590 / 25

    const cerrada = await cerrarOrden(
      sesionCierre(),
      idOrden,
      { motivo: 'temporada cerrada' },
      bd(),
    );
    expect(cerrada.estado).toBe('cerrada');
    expect(cerrada.cerradaEn).not.toBeNull();
    expect(cerrada.motivoCierre).toBe('temporada cerrada');

    // Se persistieron LAS DOS MITADES (hasta ahora sólo el dinero).
    const fila = await cliente.costoOrden.findUniqueOrThrow({ where: { idOrden } });
    expect(fila.cantidadBaseCongelada).toBe(25);
    expect(fila.costoUnitarioCongelado?.toNumber()).toBe(63.6);
    expect(fila.congeladoEn).not.toBeNull();

    // ⭐ Y AHORA LA PRUEBA DE VERDAD: llega otro recibo (por un camino que no pasa por la guarda,
    // justo el escenario contra el que el congelado es defensa en profundidad) y el costo NO se
    // mueve. Sin congelar, la base pasaría a 35 y el unitario a 45.43.
    await otroReciboDeCostura(10, 300n);
    const despues = await obtenerCostoOrden(sesionCierre(), idOrden, bd());
    expect(despues.cantidades.recibido).toBe(35); // la cantidad DERIVADA sí subió…
    expect(despues.unitario.cantidadBase).toBe(25); // …pero el DIVISOR del costo no
    expect(despues.unitario.costoUnitario).toBe(63.6);
    expect(despues.unitario.congeladoEn).not.toBeNull();
    expect(despues.ordenCerrada).toBe(true);
  });

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // ⭐⭐ EL MARGEN POR PEDIDO ES EL **QUINTO** PUBLICADOR DEL COSTO UNITARIO (0.061).
  //
  // `margenes.ts` calcula `costo_unit = costo_total / base_cant` en SQL crudo, con `base_cant`
  // derivado por un `CASE` sobre subconsultas de `etapa_movimiento_det`: no pasaba por
  // `divisorCongelado` ni miraba `cerrada_en`. Medido con sonda contra Postgres: un recibo
  // POSTERIOR al cierre casi DUPLICABA el margen de una orden cerrada (36.40 → 68.20 por pieza)
  // mientras su ficha seguía diciendo 63.60. Y es explotable por el mismo camino que el EDR: la
  // subconsulta de `recibido` filtra por `genera_entrada_pt`, bandera que se edita desde el CRUD.
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  it('⭐ 0.061: el MARGEN por pedido usa el divisor CONGELADO (el 5º publicador)', async () => {
    await guardarCostoOrden(sesionCierre(), idOrden, { baseProrrateo: 'recibido' }, bd());

    // Con la orden viva: 1590 / 25 recibidas = 63.60 por prenda → margen 100 − 63.60 = 36.40.
    const antes = await margenesPorPedido(sesionCierre(), {}, bd());
    expect(antes.filas[0]?.margenPesosPorPieza).toBeCloseTo(36.4, 4);

    await cerrarOrden(sesionCierre(), idOrden, { motivo: 'temporada cerrada' }, bd());
    // …y AHORA llega otro recibo por un camino que no pasa por la guarda (25 piezas más).
    await otroReciboDeCostura(25, 305n);

    const despues = await margenesPorPedido(sesionCierre(), {}, bd());
    // El margen NO se mueve: sigue dividiendo entre las 25 congeladas.
    // Sin el arreglo daría 68.20 (100 − 1590/50), casi el DOBLE, para una orden ya cerrada.
    expect(despues.filas[0]?.margenPesosPorPieza).toBeCloseTo(36.4, 4);
    expect(despues.filas[0]?.margenPromedio).toBeCloseTo(0.364, 4);
  });

  it('0.061 · con la orden ABIERTA el mismo recibo SÍ mueve el margen (rama gemela)', async () => {
    // Sin ésta, un congelado que se aplicara SIEMPRE también pasaría la de arriba.
    await guardarCostoOrden(sesionCierre(), idOrden, { baseProrrateo: 'recibido' }, bd());
    await otroReciboDeCostura(25, 306n);

    const m = await margenesPorPedido(sesionCierre(), {}, bd());
    expect(m.filas[0]?.margenPesosPorPieza).toBeCloseTo(68.2, 4); // 100 − 1590/50
  });

  /**
   * ⚠️ LA TERCERA RAMA, y la que menos se ve: la orden REABIERTA.
   *
   * Reabrir **no borra** el congelado (D3: se marca con `descongeladoEn`), así que una orden
   * reabierta sigue teniendo `cantidad_base_congelada` y `congelado_en` puestos: lo ÚNICO que la
   * distingue de una cerrada es `cerrada_en`. Sin esta prueba, un `CASE` que congelara «siempre que
   * haya cantidad congelada» —sin mirar `cerrada_en`— pasaba las otras dos y dejaba la orden
   * reabierta clavada en su divisor viejo. Medido con mutación: quitar `cerrada_en IS NOT NULL` de
   * la consulta NO rompía ninguna prueba hasta que existió ésta.
   */
  it('0.061 · una orden REABIERTA vuelve al margen VIVO (el congelado quedó de historia)', async () => {
    await guardarCostoOrden(sesionCierre(), idOrden, { baseProrrateo: 'recibido' }, bd());
    await cerrarOrden(sesionCierre(), idOrden, {}, bd());
    await otroReciboDeCostura(25, 307n);
    await reabrirOrden(sesionCierre(), idOrden, { motivo: 'faltaba un recibo' }, bd());

    // El sello del congelado SIGUE en la fila (no se borró) — por eso la consulta tiene que
    // mirar `cerrada_en`, no la mera presencia de `cantidad_base_congelada`.
    const fila = await cliente.costoOrden.findUniqueOrThrow({ where: { idOrden } });
    expect(fila.cantidadBaseCongelada).toBe(25);
    expect(fila.congeladoEn).not.toBeNull();
    expect(fila.descongeladoEn).not.toBeNull();

    const m = await margenesPorPedido(sesionCierre(), {}, bd());
    expect(m.filas[0]?.margenPesosPorPieza).toBeCloseTo(68.2, 4); // vivo otra vez: 100 − 1590/50
  });

  /**
   * ⭐⭐ LA TERCERA SUTILEZA DEL `CASE`: un divisor congelado de **CERO se respeta COMO CERO**.
   *
   * Por eso la condición del SQL mira `IS NOT NULL` y **no** `> 0`. Una orden que se cierra con
   * costo capturado y **sin una sola pieza recibida** congela el divisor en 0: su margen tiene que
   * quedar NULL **y seguir NULL** aunque después lleguen recibos — es el mismo defecto que esta
   * fila cierra, en su subcaso más fácil de perder.
   *
   * ⚠️ **Sin esta prueba no había red.** Cambiar `IS NOT NULL` por `> 0` dejaba los tres archivos
   * de publicadores en verde (60/60): el cero caía al divisor VIVO y el margen reaparecía. Los
   * otros cuatro de los CINCO publicadores tienen la sutileza cubierta porque **llaman** a
   * `divisorCongelado`; `margenes.ts` es SQL agregado y la **reimplementa**, así que necesita la suya.
   */
  it('0.061 · un divisor congelado en CERO se respeta como cero (el margen no reaparece)', async () => {
    // Orden costeada pero sin recibos: se cierra con el divisor en 0.
    await cliente.etapaMovimiento.deleteMany({ where: { idOrden, tipo: 'recibo_maquila' } });
    await guardarCostoOrden(sesionCierre(), idOrden, { baseProrrateo: 'recibido' }, bd());
    const antes = await obtenerCostoOrden(sesionCierre(), idOrden, bd());
    expect(antes.unitario.cantidadBase).toBe(0);
    expect(antes.unitario.motivoSinUnitario).toBe('sin-base');

    await cerrarOrden(sesionCierre(), idOrden, { motivo: 'no se llegó a producir' }, bd());

    // Se congeló el CERO, no un NULL: eso es lo que distingue «cerrada sin piezas» de «sin congelar»
    // — y hay dinero capturado, así que la orden SÍ entra en el reporte de márgenes.
    const fila = await cliente.costoOrden.findUniqueOrThrow({ where: { idOrden } });
    expect(fila.cantidadBaseCongelada).toBe(0);
    expect(fila.costoUnitarioCongelado).toBeNull();
    expect(fila.congeladoEn).not.toBeNull();
    expect(fila.costoTotal?.toNumber()).toBe(1590);

    expect(
      (await margenesPorPedido(sesionCierre(), {}, bd())).filas[0]?.margenPesosPorPieza,
    ).toBeNull();

    // ⭐ LO QUE PROTEGE: llegan recibos DESPUÉS del cierre y el margen NO puede reaparecer.
    await otroReciboDeCostura(25, 308n);
    const despues = await margenesPorPedido(sesionCierre(), {}, bd());
    expect(despues.filas[0]?.margenPesosPorPieza).toBeNull();
    expect(despues.filas[0]?.margenPromedio).toBeNull();
  });

  it('la LISTA de costos respeta el congelado igual que la ficha (una sola regla)', async () => {
    await guardarCostoOrden(sesionCierre(), idOrden, { baseProrrateo: 'recibido' }, bd());
    await cerrarOrden(sesionCierre(), idOrden, {}, bd());
    await otroReciboDeCostura(10, 301n);
    const lista = await listarCostos(sesionCierre(), {}, bd());
    expect(lista.datos[0]?.costoUnitario).toBe(63.6);
  });

  it('REABRIR devuelve el costo a cálculo vivo y MARCA lo congelado (no lo borra, D3)', async () => {
    await guardarCostoOrden(sesionCierre(), idOrden, { baseProrrateo: 'recibido' }, bd());
    await cerrarOrden(sesionCierre(), idOrden, {}, bd());
    await otroReciboDeCostura(10, 302n);

    const abierta = await reabrirOrden(
      sesionCierre(),
      idOrden,
      { motivo: 'faltó un recibo' },
      bd(),
    );
    expect(abierta.cerradaEn).toBeNull();
    expect(abierta.motivoCierre).toBeNull();
    // El estado se vuelve a DERIVAR de los requisitos (no se "restaura" el que tenía).
    expect(['capturada', 'completa']).toContain(abierta.estado);

    const vivo = await obtenerCostoOrden(sesionCierre(), idOrden, bd());
    expect(vivo.unitario.cantidadBase).toBe(35); // ahora sí cuenta el recibo nuevo
    expect(vivo.unitario.congeladoEn).toBeNull();
    expect(vivo.ordenCerrada).toBe(false);

    // D3: lo congelado NO se borró — quedó marcado como historia.
    const fila = await cliente.costoOrden.findUniqueOrThrow({ where: { idOrden } });
    expect(fila.cantidadBaseCongelada).toBe(25);
    expect(fila.congeladoEn).not.toBeNull();
    expect(fila.descongeladoEn).not.toBeNull();
  });

  it('una orden CERRADA no se puede costear', async () => {
    await guardarCostoOrden(sesionCierre(), idOrden, { baseProrrateo: 'recibido' }, bd());
    await cerrarOrden(sesionCierre(), idOrden, {}, bd());
    await expect(
      guardarCostoOrden(sesionCierre(), idOrden, { telaCost: 1 }, bd()),
    ).rejects.toBeInstanceOf(ErrorConflicto);
  });

  it('SIN `ordenes.cerrar` no se cierra ni se reabre (A4)', async () => {
    await expect(cerrarOrden(sesion(), idOrden, {}, bd())).rejects.toBeInstanceOf(ErrorPermiso);
    await expect(reabrirOrden(sesion(), idOrden, { motivo: 'x' }, bd())).rejects.toBeInstanceOf(
      ErrorPermiso,
    );
  });

  it('🔴 SIN `ordenes.ver` el 403 sale ANTES de escribir: la orden NO queda cerrada', async () => {
    // El «403-tras-commit» de F8-E3. `cerrarOrden` DEVUELVE la orden y la lee con `obtenerOrden`,
    // que exige `ordenes.ver`: si esa comprobación se dejaba para el final, una sesión con
    // `ordenes.cerrar` y sin `ordenes.ver` cerraba la orden —commit incluido, costo congelado— y
    // recibía un error, así que el usuario creía que no había pasado nada. Lo cazó la suite de
    // integración corrida en local.
    const sinVer = sesion([...PERM_TODOS, 'ordenes.cerrar']); // sin `ordenes.ver`

    await expect(cerrarOrden(sinVer, idOrden, {}, bd())).rejects.toBeInstanceOf(ErrorPermiso);

    // Y lo que importa: NADA se escribió.
    const orden = await cliente.orden.findUniqueOrThrow({ where: { id: idOrden } });
    expect(orden.cerradaEn).toBeNull();
    expect(orden.estado).not.toBe('cerrada');
  });

  it('cerrar DOS veces se rechaza (no se re-congela en silencio con números nuevos)', async () => {
    await cerrarOrden(sesionCierre(), idOrden, {}, bd());
    await expect(cerrarOrden(sesionCierre(), idOrden, {}, bd())).rejects.toBeInstanceOf(
      ErrorConflicto,
    );
  });

  it('reabrir una orden que NO está cerrada se rechaza', async () => {
    await expect(
      reabrirOrden(sesionCierre(), idOrden, { motivo: 'x' }, bd()),
    ).rejects.toBeInstanceOf(ErrorConflicto);
  });

  it('una orden CANCELADA no se cierra (son dos finales distintos y sólo cabe uno)', async () => {
    await cliente.orden.update({ where: { id: idOrden }, data: { estado: 'cancelada' } });
    await expect(cerrarOrden(sesionCierre(), idOrden, {}, bd())).rejects.toBeInstanceOf(
      ErrorConflicto,
    );
  });

  it('cerrar una orden SIN costo capturado no inventa ninguno (ni crea la fila)', async () => {
    const cerrada = await cerrarOrden(sesionCierre(), idOrden, {}, bd());
    expect(cerrada.estado).toBe('cerrada');
    expect(await cliente.costoOrden.findUnique({ where: { idOrden } })).toBeNull();
    const c = await obtenerCostoOrden(sesionCierre(), idOrden, bd());
    expect(c.guardado).toBeNull();
    expect(c.ordenCerrada).toBe(true);
  });

  it('el estado `cerrada` SOBREVIVE a un recálculo por requisitos (no se deriva)', async () => {
    // Si `cambiosEstadoPorRequisitos` no lo respetara como a `cancelada`, el primer recálculo
    // borraría el cierre y el badge mentiría con `cerradaEn` todavía puesta.
    await cerrarOrden(sesionCierre(), idOrden, {}, bd());
    await realinearEstadoOrdenes(cliente, [idOrden]);
    const fila = await cliente.orden.findUniqueOrThrow({ where: { id: idOrden } });
    expect(fila.estado).toBe('cerrada');
    expect(fila.cerradaEn).not.toBeNull();
  });

  it('deja BITÁCORA (A7) del cierre con los números congelados, y de la reapertura', async () => {
    await guardarCostoOrden(sesionCierre(), idOrden, { baseProrrateo: 'recibido' }, bd());
    await cerrarOrden(sesionCierre(), idOrden, { motivo: 'fin' }, bd());
    await reabrirOrden(sesionCierre(), idOrden, { motivo: 'otra vez' }, bd());
    const log = await cliente.bitacora.findMany({
      where: { entidad: 'Orden', idEntidad: String(idOrden) },
      orderBy: { id: 'asc' },
    });
    const actos = log.map((l) => (l.datos as { acto?: string } | null)?.acto);
    expect(actos).toContain('cerrar-orden');
    expect(actos).toContain('reabrir-orden');
    const cierre = log.find((l) => (l.datos as { acto?: string } | null)?.acto === 'cerrar-orden');
    expect(
      (cierre?.datos as { cantidadBaseCongelada?: number } | null)?.cantidadBaseCongelada,
    ).toBe(25);
  });
});
