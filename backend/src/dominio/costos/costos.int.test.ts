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

let cliente: PrismaClient;
/** Id del tipo de arte «bordado» del catálogo único (V1-E3f): el arte no existe sin él. */
let idTipoArte: number;
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
