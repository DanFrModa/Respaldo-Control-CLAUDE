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

  telaFelpa = await cliente.tela.create({ data: { nombre: 'Felpa', unidadMedida: 'm' } });
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
