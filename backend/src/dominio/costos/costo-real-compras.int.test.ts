/**
 * Tests de INTEGRACIÓN del COSTO REAL DE MATERIALES desde las órdenes de compra (petición de Daniel,
 * 26-jul-2026 — `DECISIONES.md` §Post-F9.5) contra Postgres efímero (testcontainers). Ejercita el
 * DOMINIO (no HTTP) por el camino completo: orden con receta y snapshot de MRP, OC ligadas en varios
 * estatus, avío genérico sin compra propia, y el enganche con el costeo.
 *
 * Verifica:
 *  (a) la compra DIRECTA ligada a la orden manda: tela = Σ cantidad × precio de las líneas de OC;
 *  (b) las OC en `borrador` / `pendiente_autorizacion` / `cancelada` NO cuentan (regla 1: autorizada);
 *  (c) el avío GENÉRICO sin compra propia se valúa a ÚLTIMO PRECIO DE COMPRA (regla 2), y ese último
 *      precio puede venir de una OC de OTRA orden (regla 3: la compra compartida se prorratea);
 *  (d) A9: ni las OC de otra empresa ni las órdenes de otra empresa se ven;
 *  (e) el factor de conversión del avío (R1) convierte la cantidad comprada a unidad de consumo y
 *      normaliza el último precio, igual que la recepción;
 *  (f) `guardarCostoOrden` usa el REAL como DEFAULT cuando hay compras, y el teórico cuando no las
 *      hay; el usuario siempre puede teclear su propio valor; y el real queda CONGELADO en
 *      `telaReal`/`aviosReal`;
 *  (g) sin `consultas.ver-importes` los importes salen en null pero las cantidades se ven.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Empresa, PrismaClient } from '../../datos/index.js';
import { ErrorNoEncontrado } from '../../comun/errores.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import type { ClavePermiso } from '../../contrato/index.js';

import { guardarCostoOrden, obtenerCostoOrden } from './costo-orden.js';
import { costoRealOrden } from './costo-real-compras.js';

let cliente: PrismaClient;
let empresa: Empresa;
let otraEmpresa: Empresa;
let idOrden: number;
let idOrdenOtra: number;
let idTela: number;
let idAvio: number;
let idAvioGenerico: number;
let idProveedor: number;
let folioOc = 0;

const PERM_TODOS: ClavePermiso[] = ['costos.ver', 'costos.capturar', 'consultas.ver-importes'];

const sesion = (permisos: ClavePermiso[] = PERM_TODOS, idEmpresa?: number) =>
  sesionDePrueba({ idEmpresaActiva: idEmpresa ?? empresa.id, permisos });
const bd = () => ({ cliente });

/** Renglón de OC para el helper `crearOc`. */
interface LineaOc {
  idTela?: number;
  idAvio?: number;
  descripcionLibre?: string;
  cantidad: number;
  precio: number;
  unidad?: string;
  idOrden?: number | null;
}

/** Crea una OC con sus renglones (folio autoincremental de la prueba). */
async function crearOc(opciones: {
  estatus: 'borrador' | 'pendiente_autorizacion' | 'autorizada' | 'recibida_total' | 'cancelada';
  lineas: LineaOc[];
  fecha?: string;
  idEmpresa?: number;
}): Promise<number> {
  folioOc += 1;
  const oc = await cliente.ordenCompra.create({
    data: {
      numCompra: BigInt(folioOc),
      idEmpresa: opciones.idEmpresa ?? empresa.id,
      idProveedor,
      estatus: opciones.estatus,
      fecha: new Date(`${opciones.fecha ?? '2026-06-05'}T00:00:00.000Z`),
      lineas: {
        create: opciones.lineas.map((l) => ({
          idTela: l.idTela ?? null,
          idAvio: l.idAvio ?? null,
          descripcionLibre: l.descripcionLibre ?? null,
          cantidad: l.cantidad,
          precio: l.precio,
          unidad: l.unidad ?? null,
          idOrden: l.idOrden === undefined ? idOrden : l.idOrden,
        })),
      },
    },
  });
  return oc.id;
}

beforeAll(() => {
  cliente = clientePruebas();
});

afterAll(async () => {
  await cliente.$disconnect();
});

beforeEach(async () => {
  await limpiarBaseDatos(cliente);
  folioOc = 0;
  empresa = await crearEmpresaPrueba(cliente);
  otraEmpresa = await crearEmpresaPrueba(cliente, 'Otra Empresa');

  const proveedor = await cliente.proveedor.create({ data: { nombre: 'Textiles del Bajío' } });
  idProveedor = proveedor.id;

  const rojo = await cliente.color.create({ data: { nombre: 'Rojo' } });
  const talla = await cliente.talla.create({ data: { etiqueta: 'M', orden: 1 } });

  // Catálogo: tela y avíos con precio de CATÁLOGO deliberadamente distinto del de compra.
  const tela = await cliente.tela.create({
    data: { nombre: 'Felpa', unidadMedida: 'm', precioSugerido: 20 },
  });
  idTela = tela.id;
  const avio = await cliente.avio.create({
    data: { clave: 'BOT', descripcion: 'Botón', unidad: 'pza', precioReferencia: 3 },
  });
  idAvio = avio.id;
  const generico = await cliente.avio.create({
    data: {
      clave: 'HIL',
      descripcion: 'Hilo',
      unidad: 'cono',
      precioReferencia: 50,
      esGenerico: true,
    },
  });
  idAvioGenerico = generico.id;

  const modelo = await cliente.modelo.create({
    data: {
      codigo: 'MOD-1',
      descripcion: 'Playera',
      maquilaBase: 8,
      telas: { create: [{ idTela: tela.id, consumoPorPrenda: 2 }] },
      avios: {
        create: [
          { idAvio: avio.id, consumoPorPrenda: 4 },
          { idAvio: generico.id, consumoPorPrenda: 0.1 },
        ],
      },
    },
  });

  const clienteNeg = await cliente.cliente.create({ data: { nombre: 'Tienda X' } });
  const crearOrden = async (folio: bigint, idEmpresa: number): Promise<number> => {
    const o = await cliente.orden.create({
      data: {
        folio,
        idEmpresa,
        idModelo: modelo.id,
        idCliente: clienteNeg.id,
        fecha: new Date('2026-06-01T00:00:00.000Z'),
        lineas: {
          create: [
            { idColor: rojo.id, tallas: { create: [{ idTalla: talla.id, cantidad: 100 }] } },
          ],
        },
      },
    });
    return o.id;
  };
  idOrden = await crearOrden(1n, empresa.id);
  idOrdenOtra = await crearOrden(2n, otraEmpresa.id);

  // Corte de 100 piezas (base del teórico y del requerido cuando no hay snapshot de MRP).
  await cliente.etapaMovimiento.create({
    data: {
      folio: 100n,
      idEmpresa: empresa.id,
      idOrden,
      tipo: 'corte',
      fecha: new Date('2026-06-02T00:00:00.000Z'),
      detalles: { create: [{ idColor: rojo.id, idTalla: talla.id, cantidad: 100 }] },
    },
  });

  // Snapshot de MRP: 200 m de tela, 400 botones y 10 conos de hilo genérico.
  await cliente.requerimientoOrden.createMany({
    data: [
      { idOrden, idTela: tela.id, cantidadRequerida: 200, unidad: 'm', cantidadAComprar: 200 },
      { idOrden, idAvio: avio.id, cantidadRequerida: 400, unidad: 'pza', cantidadAComprar: 400 },
      {
        idOrden,
        idAvio: generico.id,
        cantidadRequerida: 10,
        unidad: 'cono',
        esGenerico: true,
        existenciaStock: 10,
        cantidadAComprar: 0,
      },
    ],
  });
});

describe('costoRealOrden — regla 1: manda lo COMPRADO en OC autorizada', () => {
  it('atribuye la compra ligada a la orden y deja su trazabilidad (OC + proveedor + precio)', async () => {
    await crearOc({
      estatus: 'autorizada',
      lineas: [{ idTela, cantidad: 200, precio: 25, unidad: 'm' }],
    });

    const real = await costoRealOrden(sesion(), idOrden, bd());
    expect(real.hayCompras).toBe(true);
    expect(real.origenRequerido).toBe('snapshot-mrp');
    // 200 m × $25 comprados (NO 200 × $20 de catálogo, que es lo que hacía el teórico).
    expect(real.tela).toBe(5000);
    const felpa = real.materiales.find((m) => m.idTela === idTela);
    expect(felpa?.origenPrecio).toBe('compra-directa');
    expect(felpa?.comprado).toBe(200);
    expect(felpa?.cantidadValuada).toBe(0);
    expect(felpa?.compras[0]?.proveedor).toBe('Textiles del Bajío');
    expect(felpa?.compras[0]?.precio).toBe(25);
  });

  it('NO cuenta las OC en borrador, pendiente de autorización ni canceladas', async () => {
    await crearOc({ estatus: 'borrador', lineas: [{ idTela, cantidad: 200, precio: 99 }] });
    await crearOc({
      estatus: 'pendiente_autorizacion',
      lineas: [{ idTela, cantidad: 200, precio: 98 }],
    });
    await crearOc({ estatus: 'cancelada', lineas: [{ idTela, cantidad: 200, precio: 97 }] });

    const real = await costoRealOrden(sesion(), idOrden, bd());
    expect(real.hayCompras).toBe(false);
    expect(real.importeDirecto).toBe(0);
    // Sin compras de ningún tipo, la tela cae al precio de CATÁLOGO (200 × 20) y avisa.
    expect(real.tela).toBe(4000);
    expect(real.avisos.some((a) => a.includes('Felpa'))).toBe(true);
  });

  it('una OC ya recibida SÍ cuenta (autorizada o posterior)', async () => {
    await crearOc({ estatus: 'recibida_total', lineas: [{ idTela, cantidad: 200, precio: 25 }] });
    const real = await costoRealOrden(sesion(), idOrden, bd());
    expect(real.tela).toBe(5000);
  });
});

describe('costoRealOrden — reglas 2 y 3: último precio de compra y prorrateo', () => {
  it('el avío GENÉRICO sin compra propia se valúa al ÚLTIMO precio de compra (no al catálogo)', async () => {
    // Compra grande de hilo SIN ligar a ninguna orden: es "el último precio de compra" del hilo.
    await crearOc({
      estatus: 'autorizada',
      fecha: '2026-06-20',
      lineas: [{ idAvio: idAvioGenerico, cantidad: 500, precio: 40, idOrden: null }],
    });

    const real = await costoRealOrden(sesion(), idOrden, bd());
    const hilo = real.materiales.find((m) => m.idAvio === idAvioGenerico);
    expect(hilo?.esGenerico).toBe(true);
    expect(hilo?.origenPrecio).toBe('ultimo-precio-compra');
    expect(hilo?.precioValuado).toBe(40); // el último de compra, NO el $50 de catálogo
    expect(hilo?.cantidadValuada).toBe(10);
    expect(hilo?.importeValuado).toBe(400);
    expect(hilo?.ultimaCompra?.proveedor).toBe('Textiles del Bajío');
  });

  it('toma la compra MÁS RECIENTE como último precio', async () => {
    await crearOc({
      estatus: 'autorizada',
      fecha: '2026-05-01',
      lineas: [{ idAvio: idAvioGenerico, cantidad: 100, precio: 30, idOrden: null }],
    });
    await crearOc({
      estatus: 'autorizada',
      fecha: '2026-06-25',
      lineas: [{ idAvio: idAvioGenerico, cantidad: 100, precio: 45, idOrden: null }],
    });
    const real = await costoRealOrden(sesion(), idOrden, bd());
    expect(real.materiales.find((m) => m.idAvio === idAvioGenerico)?.precioValuado).toBe(45);
  });

  it('una compra compartida se PRORRATEA: cada orden se lleva su consumo al mismo precio', async () => {
    await crearOc({
      estatus: 'autorizada',
      lineas: [{ idAvio, cantidad: 10000, precio: 2, idOrden: null }],
    });
    // Esta orden consume 400 botones del snapshot ⇒ se lleva 400 × $2 = $800 de esa compra.
    const real = await costoRealOrden(sesion(), idOrden, bd());
    const boton = real.materiales.find((m) => m.idAvio === idAvio);
    expect(boton?.cantidadValuada).toBe(400);
    expect(boton?.importeValuado).toBe(800);
  });

  it('mezcla: parte comprada para la orden y parte valuada a último precio', async () => {
    await crearOc({
      estatus: 'autorizada',
      fecha: '2026-05-01',
      lineas: [{ idTela, cantidad: 1000, precio: 18, idOrden: null }], // fija el último precio
    });
    await crearOc({
      estatus: 'autorizada',
      fecha: '2026-06-10',
      lineas: [{ idTela, cantidad: 120, precio: 30 }], // ligada a la orden
    });

    const real = await costoRealOrden(sesion(), idOrden, bd());
    const felpa = real.materiales.find((m) => m.idTela === idTela);
    expect(felpa?.comprado).toBe(120);
    expect(felpa?.importeDirecto).toBe(3600); // 120 × 30
    expect(felpa?.cantidadValuada).toBe(80);
    expect(felpa?.importeValuado).toBe(1440); // 80 × 18 (último precio de compra)
    expect(felpa?.importe).toBe(5040);
  });
});

describe('costoRealOrden — unidades (R1) y compras libres', () => {
  it('convierte la cantidad comprada a unidad de consumo y normaliza el último precio', async () => {
    // Un "cono" del proveedor trae 5 conos de consumo (factor 5): 3 cajas = 15 conos; $200 ÷ 5 = $40.
    await cliente.avioProveedor.create({
      data: { idAvio: idAvioGenerico, idProveedor, precio: 200, factorConversion: 5 },
    });
    await crearOc({
      estatus: 'autorizada',
      lineas: [{ idAvio: idAvioGenerico, cantidad: 3, precio: 200, unidad: 'caja' }],
    });

    const real = await costoRealOrden(sesion(), idOrden, bd());
    const hilo = real.materiales.find((m) => m.idAvio === idAvioGenerico);
    expect(hilo?.comprado).toBe(15); // 3 cajas × factor 5
    expect(hilo?.cantidadValuada).toBe(0); // el requerido era 10 conos
    expect(hilo?.importeDirecto).toBe(600); // el importe NO cambia al convertir (3 × 200)
  });

  it('las compras LIBRES se reportan aparte y NO entran al costo de materiales', async () => {
    await crearOc({
      estatus: 'autorizada',
      lineas: [{ descripcionLibre: 'Flete especial', cantidad: 1, precio: 1500 }],
    });
    const real = await costoRealOrden(sesion(), idOrden, bd());
    expect(real.importeLibre).toBe(1500);
    expect(real.hayCompras).toBe(false);
    expect(real.avisos.some((a) => a.includes('LIBRE'))).toBe(true);
  });
});

describe('costoRealOrden — A9 (empresa activa) y permisos', () => {
  it('IGNORA las OC de otra empresa, aunque estén ligadas a la orden', async () => {
    await crearOc({
      estatus: 'autorizada',
      idEmpresa: otraEmpresa.id,
      lineas: [{ idTela, cantidad: 200, precio: 999 }],
    });
    const real = await costoRealOrden(sesion(), idOrden, bd());
    expect(real.hayCompras).toBe(false);
    expect(real.importeDirecto).toBe(0);
    expect(real.tela).toBe(4000); // cae a catálogo, no a la compra ajena
  });

  it('NO deja consultar una orden de otra empresa', async () => {
    await expect(costoRealOrden(sesion(), idOrdenOtra, bd())).rejects.toBeInstanceOf(
      ErrorNoEncontrado,
    );
  });

  it('sin consultas.ver-importes oculta importes (null) pero deja ver las cantidades', async () => {
    await crearOc({ estatus: 'autorizada', lineas: [{ idTela, cantidad: 200, precio: 25 }] });
    const real = await costoRealOrden(sesion(['costos.ver']), idOrden, bd());
    expect(real.tela).toBeNull();
    expect(real.total).toBeNull();
    const felpa = real.materiales.find((m) => m.idTela === idTela);
    expect(felpa?.importe).toBeNull();
    expect(felpa?.compras[0]?.precio).toBeNull();
    expect(felpa?.comprado).toBe(200); // la cantidad no es dinero: se ve
  });
});

describe('costoRealOrden — sin snapshot de MRP', () => {
  it('cae a la receta paraCosto × piezas cortadas', async () => {
    await cliente.requerimientoOrden.deleteMany({ where: { idOrden } });
    const real = await costoRealOrden(sesion(), idOrden, bd());
    expect(real.origenRequerido).toBe('receta');
    // Receta: 2 m/prenda × 100 cortadas = 200 m (igual que el snapshot que se borró).
    expect(real.materiales.find((m) => m.idTela === idTela)?.requerido).toBe(200);
  });
});

describe('enganche con el costeo (obtenerCostoOrden / guardarCostoOrden)', () => {
  it('obtenerCostoOrden trae los TRES números: teórico, real y guardado', async () => {
    await crearOc({
      estatus: 'autorizada',
      lineas: [
        { idTela, cantidad: 200, precio: 25 },
        { idAvio, cantidad: 400, precio: 5 },
      ],
    });
    const c = await obtenerCostoOrden(sesion(), idOrden, bd());
    expect(c.teorico.tela).toBe(4000); // 2 × 20 × 100 cortadas (catálogo)
    expect(c.real.tela).toBe(5000); // 200 × 25 (lo comprado)
    expect(c.real.avios).toBe(2500); // 400 × 5 (botones) + 10 conos × $50 catálogo
    expect(c.guardado).toBeNull();
  });

  it('al guardar SIN componentes, el default es el REAL cuando hay compras (Daniel)', async () => {
    await crearOc({
      estatus: 'autorizada',
      lineas: [
        { idTela, cantidad: 200, precio: 25 },
        { idAvio, cantidad: 400, precio: 5 },
      ],
    });
    const g = await guardarCostoOrden(sesion(), idOrden, { baseProrrateo: 'cortado' }, bd());
    expect(g.guardado?.telaCost).toBe(5000); // el REAL, no el teórico 4000
    expect(g.guardado?.telaCalc).toBe(4000); // el teórico queda congelado al lado
    expect(g.guardado?.telaReal).toBe(5000); // y el real también queda congelado
    expect(g.guardado?.aviosCost).toBe(2500);
    expect(g.guardado?.procesosCost).toBe(800); // procesos siguen al teórico (8 × 100)
  });

  it('sin compras ligadas, el default sigue siendo el TEÓRICO (no se rompe lo de antes)', async () => {
    const g = await guardarCostoOrden(sesion(), idOrden, { baseProrrateo: 'cortado' }, bd());
    expect(g.guardado?.telaCost).toBe(4000);
    expect(g.guardado?.telaCalc).toBe(4000);
  });

  it('el usuario SIEMPRE puede teclear su propio valor (el default no lo pisa)', async () => {
    await crearOc({ estatus: 'autorizada', lineas: [{ idTela, cantidad: 200, precio: 25 }] });
    const g = await guardarCostoOrden(
      sesion(),
      idOrden,
      { telaCost: 4321, baseProrrateo: 'cortado' },
      bd(),
    );
    expect(g.guardado?.telaCost).toBe(4321);
    expect(g.guardado?.telaReal).toBe(5000); // pero el real queda registrado para la traza
  });
});
