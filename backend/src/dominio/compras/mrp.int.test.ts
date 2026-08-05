/**
 * Integración del dominio del MRP / EXPLOSIÓN (F4-E4) contra Postgres efímero (testcontainers). NO
 * corre en local (usa Docker; lo corre el CI). Cubre lo que la ficha exige:
 *  • Explosión R3: requerido = consumoPorPrenda × Σ piezas color×talla, para TELAS y AVÍOS.
 *  • BOM con/sin `paraProduccion`: solo entran los renglones marcados.
 *  • Genérico (decisión d): se netea contra el kardex real (D3) — cubierto por stock vs faltante
 *    parcial a compra.
 *  • Snapshot regenerable + diff: regenerar tras cambiar el BOM reporta cantidad-cambiada/nuevo.
 *  • Proveedor sugerido R1: el AvioProveedor más barato (precio ÷ factor); telas → null.
 *  • Generar OC: una OC por proveedor, líneas ligadas a la orden, folio atómico (reúsa crearOC).
 *  • Estatus R7: cruce requerido vs en-oc vs recibido; línea libre → 'no-identificado'.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type {
  Almacen,
  Avio,
  Color,
  Empresa,
  Modelo,
  PrismaClient,
  Proveedor,
  Talla,
  Tela,
} from '../../datos/index.js';
import type { ClavePermiso } from '../../contrato/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import { ajustarInventarioAvio } from '../inventarios/avios.js';
import { autorizarOC } from './ordenes-compra.js';
import { recibirCompra } from './recepciones.js';
import { estatusMaterialesOrden, explosionarOrden, generarOCDesdeExplosion } from './mrp.js';

let cliente: PrismaClient;
let empresa: Empresa;
let modelo: Modelo;
let telaFelpa: Tela;
let avioBoton: Avio; // NO genérico, con 2 proveedores (barato/caro)
let avioHilo: Avio; // GENÉRICO (de stock)
let provBarato: Proveedor;
let provCaro: Proveedor;
let colorRojo: Color;
let tallaCH: Talla;
let tallaM: Talla;
let almacen: Almacen;
let clienteNegocioId: number;
let idOrden: number;

const PERM: ClavePermiso[] = [
  'compras.ver',
  'compras.administrar',
  'compras.autorizar',
  'compras.recibir',
  'inventario-avios.ver',
  'inventario-avios.mover',
];

const sesion = (permisos: ClavePermiso[] = PERM): SesionUsuario =>
  sesionDePrueba({ idEmpresaActiva: empresa.id, permisos });
const bd = () => ({ cliente });

/**
 * Crea una orden de 30 piezas (Rojo: CH 10 + M 20). Devuelve su id. consumo por prenda:
 *  • Felpa 1.5 m → requerido 45 m.
 *  • Botón 6 pza → requerido 180 pza.
 *  • Hilo (genérico) 2 m → requerido 60 m.
 */
async function crearOrden(): Promise<number> {
  const orden = await cliente.orden.create({
    data: {
      folio: 1n,
      idEmpresa: empresa.id,
      idModelo: modelo.id,
      idCliente: clienteNegocioId,
      estado: 'completa',
      fechaCompletada: new Date(),
      lineas: {
        create: [
          {
            idColor: colorRojo.id,
            tallas: {
              create: [
                { idTalla: tallaCH.id, cantidad: 10 },
                { idTalla: tallaM.id, cantidad: 20 },
              ],
            },
          },
        ],
      },
    },
  });
  return orden.id;
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
  const clienteNegocio = await cliente.cliente.create({ data: { nombre: 'Liverpool' } });
  clienteNegocioId = clienteNegocio.id;
  colorRojo = await cliente.color.create({ data: { nombre: 'Rojo' } });
  tallaCH = await cliente.talla.create({ data: { etiqueta: 'CH', orden: 1 } });
  tallaM = await cliente.talla.create({ data: { etiqueta: 'M', orden: 2 } });
  almacen = await cliente.almacen.create({ data: { nombre: 'Bodega', tipo: 'AVIO' } });
  provBarato = await cliente.proveedor.create({ data: { nombre: 'Avíos Baratos' } });
  provCaro = await cliente.proveedor.create({ data: { nombre: 'Avíos Caros' } });

  telaFelpa = await cliente.tela.create({ data: { nombre: 'Felpa', unidadMedida: 'M' } });
  avioBoton = await cliente.avio.create({
    data: { clave: 'BOT-01', descripcion: 'Botón', unidad: 'pza' },
  });
  avioHilo = await cliente.avio.create({
    data: { clave: 'HIL-01', descripcion: 'Hilo', unidad: 'm', esGenerico: true },
  });

  // Precios del botón por proveedor (R1): barato $2, caro $3. Sin factor → costo por unidad = precio.
  await cliente.avioProveedor.createMany({
    data: [
      { idAvio: avioBoton.id, idProveedor: provBarato.id, precio: 2 },
      { idAvio: avioBoton.id, idProveedor: provCaro.id, precio: 3 },
    ],
  });

  modelo = await cliente.modelo.create({ data: { codigo: 'A-100', descripcion: 'Playera' } });
  // BOM del modelo: felpa 1.5 m, botón 6 pza, hilo 2 m. Todo paraProduccion.
  await cliente.modeloTela.create({
    data: { idModelo: modelo.id, idTela: telaFelpa.id, consumoPorPrenda: 1.5 },
  });
  await cliente.modeloAvio.createMany({
    data: [
      { idModelo: modelo.id, idAvio: avioBoton.id, consumoPorPrenda: 6 },
      { idModelo: modelo.id, idAvio: avioHilo.id, consumoPorPrenda: 2 },
    ],
  });

  // Tipos de movimiento que el ajuste de avíos / recepción resuelven por código.
  await cliente.tipoMovimientoInventario.createMany({
    data: [
      { codigo: 'ajuste-entrada', nombre: 'Ajuste (Entrada)', direccion: 'entrada' },
      { codigo: 'ajuste-salida', nombre: 'Ajuste (Salida)', direccion: 'salida' },
      { codigo: 'entrada-recepcion', nombre: 'Entrada por Recepción', direccion: 'entrada' },
    ],
  });

  idOrden = await crearOrden();
});

describe('Explosión (R3) — requerido = consumo × piezas, telas + avíos', () => {
  it('explosiona el BOM contra la matriz y agrupa por proveedor sugerido', async () => {
    const ex = await explosionarOrden(sesion(), idOrden, bd());

    expect(ex.totalPiezas).toBe(30);
    expect(ex.regenerado).toBe(false);

    // Aplana todos los renglones de todos los grupos.
    const todos = ex.grupos.flatMap((g) => g.renglones);
    const felpa = todos.find((r) => r.idTela === telaFelpa.id);
    const boton = todos.find((r) => r.idAvio === avioBoton.id);
    const hilo = todos.find((r) => r.idAvio === avioHilo.id);

    expect(felpa?.cantidadRequerida).toBeCloseTo(45); // 1.5 × 30
    expect(felpa?.cantidadAComprar).toBeCloseTo(45);
    expect(felpa?.idProveedorSugerido).toBeNull(); // telas sin liga directa (D5)

    expect(boton?.cantidadRequerida).toBeCloseTo(180); // 6 × 30
    // Proveedor sugerido = el más barato (R1): Avíos Baratos a $2.
    expect(boton?.idProveedorSugerido).toBe(provBarato.id);
    expect(boton?.precioSugerido).toBeCloseTo(2);

    expect(hilo?.esGenerico).toBe(true);
    expect(hilo?.cantidadRequerida).toBeCloseTo(60); // 2 × 30
    // Sin stock todavía: el genérico va completo a compra.
    expect(hilo?.cantidadAComprar).toBeCloseTo(60);
    expect(hilo?.estadoGenerico).toBe('faltante-parcial');
  });

  it('omite los renglones del BOM con paraProduccion=false', async () => {
    await cliente.modeloAvio.update({
      where: { idModelo_idAvio: { idModelo: modelo.id, idAvio: avioBoton.id } },
      data: { paraProduccion: false },
    });
    const ex = await explosionarOrden(sesion(), idOrden, bd());
    const todos = ex.grupos.flatMap((g) => g.renglones);
    expect(todos.find((r) => r.idAvio === avioBoton.id)).toBeUndefined();
    expect(todos.find((r) => r.idTela === telaFelpa.id)).toBeDefined();
  });

  it('en EMPATE de precio sugiere el proveedor de idProveedor MENOR (determinista)', async () => {
    // Iguala el precio del botón en ambos proveedores ($2): el desempate debe ser por id menor.
    await cliente.avioProveedor.update({
      where: { idAvio_idProveedor: { idAvio: avioBoton.id, idProveedor: provCaro.id } },
      data: { precio: 2 },
    });
    const ex = await explosionarOrden(sesion(), idOrden, bd());
    const boton = ex.grupos.flatMap((g) => g.renglones).find((r) => r.idAvio === avioBoton.id);
    expect(boton?.idProveedorSugerido).toBe(Math.min(provBarato.id, provCaro.id));
  });
});

describe('Explosión — neteo de genéricos contra el kardex (decisión d, D3)', () => {
  it('genérico cubierto por stock no va a compra; faltante parcial sí', async () => {
    // Mete 100 m de hilo al kardex (cubre los 60 requeridos).
    await ajustarInventarioAvio(
      sesion(),
      {
        idAlmacen: almacen.id,
        fecha: '2026-06-21',
        idTipoMov: (
          await cliente.tipoMovimientoInventario.findUniqueOrThrow({
            where: { codigo: 'ajuste-entrada' },
          })
        ).id,
        lineas: [{ idAvio: avioHilo.id, cantidad: 100 }],
        motivo: 'conteo inicial',
      },
      bd(),
    );

    const ex = await explosionarOrden(sesion(), idOrden, bd());
    const hilo = ex.grupos.flatMap((g) => g.renglones).find((r) => r.idAvio === avioHilo.id);
    expect(hilo?.existenciaStock).toBeCloseTo(100);
    expect(hilo?.cantidadAComprar).toBeCloseTo(0);
    expect(hilo?.estadoGenerico).toBe('cubierto-por-stock');
  });

  it('genérico con stock parcial deja solo el faltante a compra', async () => {
    await ajustarInventarioAvio(
      sesion(),
      {
        idAlmacen: almacen.id,
        fecha: '2026-06-21',
        idTipoMov: (
          await cliente.tipoMovimientoInventario.findUniqueOrThrow({
            where: { codigo: 'ajuste-entrada' },
          })
        ).id,
        lineas: [{ idAvio: avioHilo.id, cantidad: 25 }],
        motivo: 'conteo inicial',
      },
      bd(),
    );
    const ex = await explosionarOrden(sesion(), idOrden, bd());
    const hilo = ex.grupos.flatMap((g) => g.renglones).find((r) => r.idAvio === avioHilo.id);
    expect(hilo?.cantidadAComprar).toBeCloseTo(35); // 60 − 25
    expect(hilo?.estadoGenerico).toBe('faltante-parcial');
  });
});

describe('Explosión — snapshot regenerable + diff', () => {
  it('regenerar tras cambiar el BOM reporta cantidad-cambiada', async () => {
    await explosionarOrden(sesion(), idOrden, bd()); // snapshot 1
    // Cambia el consumo de felpa: 1.5 → 2 m.
    await cliente.modeloTela.update({
      where: { idModelo_idTela: { idModelo: modelo.id, idTela: telaFelpa.id } },
      data: { consumoPorPrenda: 2 },
    });
    const ex2 = await explosionarOrden(sesion(), idOrden, bd());
    expect(ex2.regenerado).toBe(true);
    expect(ex2.huboCambios).toBe(true);
    const felpa = ex2.grupos.flatMap((g) => g.renglones).find((r) => r.idTela === telaFelpa.id);
    expect(felpa?.cantidadRequerida).toBeCloseTo(60); // 2 × 30
    expect(felpa?.diff).toBe('cantidad-cambiada');
    // Solo hay un snapshot persistido (se reemplazó, no se acumuló).
    const filas = await cliente.requerimientoOrden.count({ where: { idOrden } });
    expect(filas).toBe(3);
  });

  it('material retirado del BOM aparece como eliminado en la salida', async () => {
    await explosionarOrden(sesion(), idOrden, bd());
    await cliente.modeloAvio.delete({
      where: { idModelo_idAvio: { idModelo: modelo.id, idAvio: avioBoton.id } },
    });
    const ex2 = await explosionarOrden(sesion(), idOrden, bd());
    const boton = ex2.grupos.flatMap((g) => g.renglones).find((r) => r.idAvio === avioBoton.id);
    expect(boton?.diff).toBe('eliminado');
  });
});

describe('Generar OC desde la explosión (R3) — una OC por proveedor', () => {
  it('genera una OC por proveedor con líneas ligadas a la orden', async () => {
    await explosionarOrden(sesion(), idOrden, bd());
    const resultado = await generarOCDesdeExplosion(
      sesion(),
      idOrden,
      { idsRequerimiento: [] },
      bd(),
    );

    // Solo el botón tiene proveedor sugerido (la felpa es null, el hilo también sin proveedor).
    expect(resultado.ordenesCompra).toHaveLength(1);
    const oc = resultado.ordenesCompra[0]!;
    expect(oc.idProveedor).toBe(provBarato.id);
    expect(oc.renglones).toBe(1);
    expect(oc.total).toBeCloseTo(360); // 180 pza × $2

    // La línea de OC quedó ligada a la orden de producción (R7).
    const lineas = await cliente.ordenCompraLinea.findMany({
      where: { idOrdenCompra: oc.idOrdenCompra },
    });
    expect(lineas).toHaveLength(1);
    expect(lineas[0]!.idOrden).toBe(idOrden);
    expect(Number(lineas[0]!.cantidad)).toBeCloseTo(180);
  });

  it('respeta la selección de renglones (no compra lo no seleccionado)', async () => {
    const ex = await explosionarOrden(sesion(), idOrden, bd());
    const boton = ex.grupos.flatMap((g) => g.renglones).find((r) => r.idAvio === avioBoton.id)!;
    // Selecciona solo el botón explícitamente.
    const resultado = await generarOCDesdeExplosion(
      sesion(),
      idOrden,
      { idsRequerimiento: [boton.id] },
      bd(),
    );
    expect(resultado.ordenesCompra).toHaveLength(1);
    expect(resultado.ordenesCompra[0]!.idProveedor).toBe(provBarato.id);
  });
});

describe('Estatus de materiales (R7) — cruce requerido / en-oc / recibido', () => {
  it('refleja pendiente → en-oc → recibido conforme avanza el flujo', async () => {
    await explosionarOrden(sesion(), idOrden, bd());

    // 1) Antes de comprar: el botón está pendiente.
    const t0 = await estatusMaterialesOrden(sesion(), idOrden, bd());
    const boton0 = t0.filas.find((f) => f.idAvio === avioBoton.id);
    expect(boton0?.estatus).toBe('pendiente');
    expect(t0.tieneSnapshot).toBe(true);

    // 2) Genera la OC del botón y autorízala.
    const gen = await generarOCDesdeExplosion(sesion(), idOrden, { idsRequerimiento: [] }, bd());
    const idOc = gen.ordenesCompra[0]!.idOrdenCompra;
    await autorizarOC(sesion(), idOc, bd());

    const t1 = await estatusMaterialesOrden(sesion(), idOrden, bd());
    const boton1 = t1.filas.find((f) => f.idAvio === avioBoton.id);
    expect(boton1?.estatus).toBe('en-oc');
    expect(boton1?.enOc).toBeCloseTo(180);

    // 3) Recibe la MITAD del botón.
    const lineaOc = await cliente.ordenCompraLinea.findFirstOrThrow({
      where: { idOrdenCompra: idOc, idAvio: avioBoton.id },
    });
    await recibirCompra(
      sesion(),
      {
        idOrdenCompra: idOc,
        idAlmacen: almacen.id,
        fecha: '2026-06-21',
        lineas: [{ idOrdenCompraLinea: lineaOc.id, cantidad: 90 }],
      },
      bd(),
    );
    const t2 = await estatusMaterialesOrden(sesion(), idOrden, bd());
    const boton2 = t2.filas.find((f) => f.idAvio === avioBoton.id);
    expect(boton2?.estatus).toBe('recibido-parcial');
    expect(boton2?.recibido).toBeCloseTo(90);
  });

  it('una línea de OC libre ligada a la orden sale como no-identificado', async () => {
    await explosionarOrden(sesion(), idOrden, bd());
    // OC con una línea LIBRE ligada a la orden (no es del BOM).
    await cliente.ordenCompra.create({
      data: {
        numCompra: 999n,
        idEmpresa: empresa.id,
        idProveedor: provBarato.id,
        estatus: 'autorizada',
        lineas: { create: [{ descripcionLibre: 'Flete', cantidad: 1, precio: 100, idOrden }] },
      },
    });
    const t = await estatusMaterialesOrden(sesion(), idOrden, bd());
    const libre = t.filas.find((f) => f.tipo === 'no-identificado');
    expect(libre).toBeDefined();
    expect(libre?.material).toBe('Flete');
    expect(libre?.requerido).toBe(0);
  });
});

// ── F8-E6: enganche del MRP a los AMARRES de Desarrollo (R17/R18) ─────────────────────────────────

/** Aplana la explosión y busca el renglón de una tela / un avío. */
const renglonTela = (ex: Awaited<ReturnType<typeof explosionarOrden>>, idTela: number) =>
  ex.grupos.flatMap((g) => g.renglones).find((r) => r.idTela === idTela);
const renglonAvio = (ex: Awaited<ReturnType<typeof explosionarOrden>>, idAvio: number) =>
  ex.grupos.flatMap((g) => g.renglones).find((r) => r.idAvio === idAvio);

describe('MRP F8-E6 — NO-REGRESIÓN F4 (sin amarres ni consumo por talla)', () => {
  it('un modelo sin amarres y sin consumo por talla explota IDÉNTICO a F4', async () => {
    const ex = await explosionarOrden(sesion(), idOrden, bd());
    // Sin nada que advertir.
    expect(ex.avisos).toEqual([]);
    // Tela sin amarre → sin proveedor/precio sugerido (captura manual, como antes de F8).
    const felpa = renglonTela(ex, telaFelpa.id);
    expect(felpa?.cantidadRequerida).toBeCloseTo(45); // 1.5 × 30
    expect(felpa?.idProveedorSugerido).toBeNull();
    expect(felpa?.precioSugerido).toBeNull();
    // Avío sin amarre → "más barato" de F4 ($2, provBarato), requerido por prenda × totalPiezas.
    const boton = renglonAvio(ex, avioBoton.id);
    expect(boton?.cantidadRequerida).toBeCloseTo(180); // 6 × 30
    expect(boton?.idProveedorSugerido).toBe(provBarato.id);
    expect(boton?.precioSugerido).toBeCloseTo(2);
  });
});

describe('MRP F8-E6 — TELA amarrada a proveedor (R17)', () => {
  it('hereda proveedor+precio del amarre (sin precio por color)', async () => {
    const tp = await cliente.telaProveedor.create({
      data: { idTela: telaFelpa.id, idProveedor: provBarato.id, precio: 10 },
    });
    await cliente.modeloTela.update({
      where: { idModelo_idTela: { idModelo: modelo.id, idTela: telaFelpa.id } },
      data: { idTelaProveedor: tp.id },
    });
    const ex = await explosionarOrden(sesion(), idOrden, bd());
    const felpa = renglonTela(ex, telaFelpa.id);
    expect(felpa?.idProveedorSugerido).toBe(provBarato.id);
    expect(felpa?.precioSugerido).toBeCloseTo(10);
    expect(ex.avisos).toEqual([]);
    // Con proveedor, la tela ahora SÍ genera OC (antes se omitía por proveedor null).
    const gen = await generarOCDesdeExplosion(sesion(), idOrden, { idsRequerimiento: [] }, bd());
    const ocFelpa = gen.ordenesCompra.find((o) => o.idProveedor === provBarato.id);
    expect(ocFelpa).toBeDefined();
  });

  it('orden de UN color usa el precio por color del amarre (amarre-color)', async () => {
    const tp = await cliente.telaProveedor.create({
      data: {
        idTela: telaFelpa.id,
        idProveedor: provBarato.id,
        precio: 10,
        manejaPrecioPorColor: true,
        colores: { create: [{ idColor: colorRojo.id, precio: 12 }] },
      },
    });
    await cliente.modeloTela.update({
      where: { idModelo_idTela: { idModelo: modelo.id, idTela: telaFelpa.id } },
      data: { idTelaProveedor: tp.id },
    });
    const ex = await explosionarOrden(sesion(), idOrden, bd()); // la orden es sólo Rojo
    const felpa = renglonTela(ex, telaFelpa.id);
    expect(felpa?.precioSugerido).toBeCloseTo(12); // precio del color Rojo
    expect(ex.avisos).toEqual([]);
  });

  it('orden MULTI-color con precios de tela distintos usa el precio base + AVISO', async () => {
    const colorAzul = await cliente.color.create({ data: { nombre: 'Azul' } });
    // Segundo color en la MISMA orden (Rojo ya existe).
    await cliente.ordenLinea.create({
      data: {
        idOrden,
        idColor: colorAzul.id,
        tallas: { create: [{ idTalla: tallaCH.id, cantidad: 5 }] },
      },
    });
    const tp = await cliente.telaProveedor.create({
      data: {
        idTela: telaFelpa.id,
        idProveedor: provBarato.id,
        precio: 10,
        manejaPrecioPorColor: true,
        colores: {
          create: [
            { idColor: colorRojo.id, precio: 12 },
            { idColor: colorAzul.id, precio: 15 },
          ],
        },
      },
    });
    await cliente.modeloTela.update({
      where: { idModelo_idTela: { idModelo: modelo.id, idTela: telaFelpa.id } },
      data: { idTelaProveedor: tp.id },
    });
    const ex = await explosionarOrden(sesion(), idOrden, bd());
    const felpa = renglonTela(ex, telaFelpa.id);
    expect(felpa?.precioSugerido).toBeCloseTo(10); // precio BASE (no por color)
    expect(ex.avisos.some((a) => a.includes('varios colores'))).toBe(true);
  });

  it('proveedor amarrado INACTIVO: mantiene la sugerencia + AVISO', async () => {
    const provInactivo = await cliente.proveedor.create({
      data: { nombre: 'Baja', activo: false },
    });
    const tp = await cliente.telaProveedor.create({
      data: { idTela: telaFelpa.id, idProveedor: provInactivo.id, precio: 10 },
    });
    await cliente.modeloTela.update({
      where: { idModelo_idTela: { idModelo: modelo.id, idTela: telaFelpa.id } },
      data: { idTelaProveedor: tp.id },
    });
    const ex = await explosionarOrden(sesion(), idOrden, bd());
    const felpa = renglonTela(ex, telaFelpa.id);
    expect(felpa?.idProveedorSugerido).toBe(provInactivo.id); // se mantiene
    expect(felpa?.precioSugerido).toBeCloseTo(10);
    expect(ex.avisos.some((a) => a.includes('INACTIVO'))).toBe(true);
  });
});

describe('MRP F8-E6 — AVÍO amarrado a proveedor (R17)', () => {
  it('el amarre gana al "más barato" de F4', async () => {
    // provCaro ($3) es el amarre, aunque provBarato ($2) sería el más barato.
    await cliente.modeloAvio.update({
      where: { idModelo_idAvio: { idModelo: modelo.id, idAvio: avioBoton.id } },
      data: { idAvioProveedor: provCaro.id },
    });
    const ex = await explosionarOrden(sesion(), idOrden, bd());
    const boton = renglonAvio(ex, avioBoton.id);
    expect(boton?.idProveedorSugerido).toBe(provCaro.id);
    expect(boton?.precioSugerido).toBeCloseTo(3);
  });

  it('amarre sin precio usable cae al "más barato" (fallback F4)', async () => {
    // provSinPrecio amarrado pero sin AvioProveedor con precio → fallback al más barato ($2).
    const provSinPrecio = await cliente.proveedor.create({ data: { nombre: 'Sin Precio' } });
    await cliente.avioProveedor.create({
      data: { idAvio: avioBoton.id, idProveedor: provSinPrecio.id, precio: null },
    });
    await cliente.modeloAvio.update({
      where: { idModelo_idAvio: { idModelo: modelo.id, idAvio: avioBoton.id } },
      data: { idAvioProveedor: provSinPrecio.id },
    });
    const ex = await explosionarOrden(sesion(), idOrden, bd());
    const boton = renglonAvio(ex, avioBoton.id);
    expect(boton?.idProveedorSugerido).toBe(provBarato.id); // fallback
    expect(boton?.precioSugerido).toBeCloseTo(2);
  });

  it('proveedor amarrado INACTIVO: mantiene la sugerencia + AVISO (no truena en silencio)', async () => {
    const provInactivo = await cliente.proveedor.create({
      data: { nombre: 'Baja', activo: false },
    });
    await cliente.avioProveedor.create({
      data: { idAvio: avioBoton.id, idProveedor: provInactivo.id, precio: 9 },
    });
    await cliente.modeloAvio.update({
      where: { idModelo_idAvio: { idModelo: modelo.id, idAvio: avioBoton.id } },
      data: { idAvioProveedor: provInactivo.id },
    });
    const ex = await explosionarOrden(sesion(), idOrden, bd());
    const boton = renglonAvio(ex, avioBoton.id);
    expect(boton?.idProveedorSugerido).toBe(provInactivo.id); // se mantiene (Desarrollo lo eligió)
    expect(boton?.precioSugerido).toBeCloseTo(9);
    expect(ex.avisos.some((a) => a.includes('INACTIVO'))).toBe(true);
  });
});

describe('MRP F8-E6 — normalización del factor de avío (R1, FIX 3: amarre = más barato)', () => {
  it('el fallback "más barato" usa el Avio.factorConversion cuando el proveedor no fija el suyo', async () => {
    // avío con factor 2 y un proveedor SIN factor propio: precio 10 ÷ 2 = 5 por unidad de consumo.
    const avioZip = await cliente.avio.create({
      data: { clave: 'ZIP-01', descripcion: 'Cierre', unidad: 'pza', factorConversion: 2 },
    });
    const prov = await cliente.proveedor.create({ data: { nombre: 'Cierres' } });
    await cliente.avioProveedor.create({
      data: { idAvio: avioZip.id, idProveedor: prov.id, precio: 10 },
    });
    await cliente.modeloAvio.create({
      data: { idModelo: modelo.id, idAvio: avioZip.id, consumoPorPrenda: 1 },
    });
    const ex = await explosionarOrden(sesion(), idOrden, bd());
    const zip = renglonAvio(ex, avioZip.id);
    // Antes de F8-E6 el fallback ignoraba el factor del avío (habría dado 10); ahora 10 ÷ 2 = 5.
    expect(zip?.precioSugerido).toBeCloseTo(5);
  });

  it('el amarre y el "más barato" normalizan IDÉNTICO (mismo proveedor)', async () => {
    const avioZip = await cliente.avio.create({
      data: { clave: 'ZIP-02', descripcion: 'Cierre', unidad: 'pza', factorConversion: 4 },
    });
    const prov = await cliente.proveedor.create({ data: { nombre: 'Cierres2' } });
    await cliente.avioProveedor.create({
      data: { idAvio: avioZip.id, idProveedor: prov.id, precio: 20 },
    });
    await cliente.modeloAvio.create({
      data: { idModelo: modelo.id, idAvio: avioZip.id, consumoPorPrenda: 1 },
    });
    // Sin amarre (más barato).
    const exSin = await explosionarOrden(sesion(), idOrden, bd());
    const zipSin = renglonAvio(exSin, avioZip.id);
    // Con amarre al MISMO proveedor.
    await cliente.modeloAvio.update({
      where: { idModelo_idAvio: { idModelo: modelo.id, idAvio: avioZip.id } },
      data: { idAvioProveedor: prov.id },
    });
    const exCon = await explosionarOrden(sesion(), idOrden, bd());
    const zipCon = renglonAvio(exCon, avioZip.id);
    expect(zipSin?.precioSugerido).toBeCloseTo(5); // 20 ÷ 4
    expect(zipCon?.precioSugerido).toBeCloseTo(zipSin!.precioSugerido!);
  });
});

describe('MRP F8-E6 — diff incluye proveedor/precio del amarre (FIX 6)', () => {
  it('cambiar el PRECIO del amarre (misma cantidad) marca el renglón como cambiado', async () => {
    const tp = await cliente.telaProveedor.create({
      data: { idTela: telaFelpa.id, idProveedor: provBarato.id, precio: 10 },
    });
    await cliente.modeloTela.update({
      where: { idModelo_idTela: { idModelo: modelo.id, idTela: telaFelpa.id } },
      data: { idTelaProveedor: tp.id },
    });
    await explosionarOrden(sesion(), idOrden, bd()); // snapshot 1: felpa @ $10
    await cliente.telaProveedor.update({ where: { id: tp.id }, data: { precio: 15 } });
    const ex2 = await explosionarOrden(sesion(), idOrden, bd());
    const felpa = renglonTela(ex2, telaFelpa.id);
    expect(felpa?.precioSugerido).toBeCloseTo(15);
    expect(felpa?.diff).toBe('cantidad-cambiada'); // cambió el PRECIO, misma cantidad
    expect(ex2.huboCambios).toBe(true);
  });

  it('cambiar el PROVEEDOR del amarre (mismo precio) marca el renglón como cambiado', async () => {
    const tpA = await cliente.telaProveedor.create({
      data: { idTela: telaFelpa.id, idProveedor: provBarato.id, precio: 10 },
    });
    const tpB = await cliente.telaProveedor.create({
      data: { idTela: telaFelpa.id, idProveedor: provCaro.id, precio: 10 },
    });
    await cliente.modeloTela.update({
      where: { idModelo_idTela: { idModelo: modelo.id, idTela: telaFelpa.id } },
      data: { idTelaProveedor: tpA.id },
    });
    await explosionarOrden(sesion(), idOrden, bd());
    await cliente.modeloTela.update({
      where: { idModelo_idTela: { idModelo: modelo.id, idTela: telaFelpa.id } },
      data: { idTelaProveedor: tpB.id },
    });
    const ex2 = await explosionarOrden(sesion(), idOrden, bd());
    const felpa = renglonTela(ex2, telaFelpa.id);
    expect(felpa?.idProveedorSugerido).toBe(provCaro.id);
    expect(felpa?.diff).toBe('cantidad-cambiada'); // mismo precio, distinto proveedor
  });
});

describe('MRP F8-E6 — consumo de avío por TALLA (R18)', () => {
  it('requerido = Σ(medida de la talla × piezas de esa talla)', async () => {
    // Orden: CH 10 + M 20. Medidas: CH 5, M 7 → 5×10 + 7×20 = 190.
    await cliente.modeloAvio.update({
      where: { idModelo_idAvio: { idModelo: modelo.id, idAvio: avioBoton.id } },
      data: { consumoPorTalla: true },
    });
    await cliente.modeloAvioTalla.createMany({
      data: [
        { idModelo: modelo.id, idAvio: avioBoton.id, idTalla: tallaCH.id, consumo: 5 },
        { idModelo: modelo.id, idAvio: avioBoton.id, idTalla: tallaM.id, consumo: 7 },
      ],
    });
    const ex = await explosionarOrden(sesion(), idOrden, bd());
    const boton = renglonAvio(ex, avioBoton.id);
    expect(boton?.cantidadRequerida).toBeCloseTo(190);
    expect(ex.avisos).toEqual([]);
  });

  it('talla sin medida capturada cae al consumo por prenda + AVISO', async () => {
    // Solo CH tiene medida (5). M (sin medida) usa consumoPorPrenda (6). 5×10 + 6×20 = 170 + AVISO.
    await cliente.modeloAvio.update({
      where: { idModelo_idAvio: { idModelo: modelo.id, idAvio: avioBoton.id } },
      data: { consumoPorTalla: true },
    });
    await cliente.modeloAvioTalla.create({
      data: { idModelo: modelo.id, idAvio: avioBoton.id, idTalla: tallaCH.id, consumo: 5 },
    });
    const ex = await explosionarOrden(sesion(), idOrden, bd());
    const boton = renglonAvio(ex, avioBoton.id);
    expect(boton?.cantidadRequerida).toBeCloseTo(170);
    expect(ex.avisos.some((a) => a.includes('sin medida por talla'))).toBe(true);
  });

  it('avío GENÉRICO por talla: Σ(medida×piezas) y luego neteo contra el stock (D3)', async () => {
    // hilo es GENÉRICO. Por talla: CH 3, M 4 → 3×10 + 4×20 = 110 requerido. Con 50 en stock → 60 a compra.
    await cliente.modeloAvio.update({
      where: { idModelo_idAvio: { idModelo: modelo.id, idAvio: avioHilo.id } },
      data: { consumoPorTalla: true },
    });
    await cliente.modeloAvioTalla.createMany({
      data: [
        { idModelo: modelo.id, idAvio: avioHilo.id, idTalla: tallaCH.id, consumo: 3 },
        { idModelo: modelo.id, idAvio: avioHilo.id, idTalla: tallaM.id, consumo: 4 },
      ],
    });
    await ajustarInventarioAvio(
      sesion(),
      {
        idAlmacen: almacen.id,
        fecha: '2026-06-21',
        idTipoMov: (
          await cliente.tipoMovimientoInventario.findUniqueOrThrow({
            where: { codigo: 'ajuste-entrada' },
          })
        ).id,
        lineas: [{ idAvio: avioHilo.id, cantidad: 50 }],
        motivo: 'conteo inicial',
      },
      bd(),
    );
    const ex = await explosionarOrden(sesion(), idOrden, bd());
    const hilo = renglonAvio(ex, avioHilo.id);
    expect(hilo?.cantidadRequerida).toBeCloseTo(110);
    expect(hilo?.existenciaStock).toBeCloseTo(50);
    expect(hilo?.cantidadAComprar).toBeCloseTo(60);
    expect(hilo?.estadoGenerico).toBe('faltante-parcial');
  });
});
