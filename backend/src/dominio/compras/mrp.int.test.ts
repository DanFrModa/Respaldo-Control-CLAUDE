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
import { ErrorNoEncontrado, ErrorPermiso } from '../../comun/errores.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sembrarRecetaDeOrden } from '../../pruebas/receta.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import { ajustarInventarioAvio } from '../inventarios/avios.js';
import { autorizarOC, obtenerOC } from './ordenes-compra.js';
import { recibirCompra } from './recepciones.js';
import {
  estatusMaterialesOrden,
  explosionarOrden,
  explosionarOrdenes,
  generarOCDesdeExplosion,
  ordenesDelPedidoDeOrden,
  previoCompraDesdeExplosion,
} from './mrp.js';
import {
  asignarProveedorDeMaterial,
  asignarProveedorDeMaterialEnBloque,
} from './proveedor-de-orden.js';
import {
  claveMaterialProveedor,
  leerUltimosPreciosCompra,
} from '../costos/ultimo-precio-compra.js';
import { seGuardaComoAlgo } from './reparto-ordenes.js';

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
async function crearOrden(folio = 1n): Promise<number> {
  const orden = await cliente.orden.create({
    data: {
      folio,
      idEmpresa: empresa.id,
      idModelo: modelo.id,
      idCliente: clienteNegocioId,
      estado: 'completa',
      fechaCompletada: new Date(),
      // §Post-F9.18: la OC que genera el MRP hereda ESTA fecha de entrega (toda OC la exige).
      fechaEntrega: new Date('2026-09-30T00:00:00.000Z'),
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
  // V1-E3d: la explosión lee la RECETA DE LA ORDEN, y la orden se crea aquí directo (sin pasar por
  // `crearOrden` del dominio, que es quien la copia). Se siembra igual que lo hace el alta, ya
  // LIBERADA — la puerta de compra tiene su propia batería en `receta-orden.int.test.ts`.
  await sembrarRecetaDeOrden(cliente, orden.id, modelo.id);
  return orden.id;
}

/**
 * ⭐ V1-E3d (§Post-F9.43): el MRP explota la **RECETA CONGELADA DE LA ORDEN**, no el BOM del modelo.
 *
 * Esta batería prueba la MATEMÁTICA del MRP (requerido, neteo de genéricos, amarres, precios,
 * diffs), y sus casos la preparan tocando el BOM del MODELO — que es la forma corta de describir
 * "una orden cuya receta dice esto". Para que sigan describiendo lo mismo, aquí se RE-COPIA la
 * receta de la orden antes de explotar: es el equivalente exacto de haber creado la orden DESPUÉS
 * del cambio del modelo.
 *
 * Que el cambio del modelo NO alcance a una orden ya creada —lo que la etapa vino a arreglar— tiene
 * su propia batería en `produccion/receta-orden.int.test.ts` y en `produccion/habilitacion-orden.int.test.ts`.
 */
async function explosionarConRecetaFresca(): Promise<Awaited<ReturnType<typeof explosionarOrden>>> {
  await cliente.ordenTela.deleteMany({ where: { idOrden } });
  await cliente.ordenAvio.deleteMany({ where: { idOrden } });
  await cliente.ordenArte.deleteMany({ where: { idOrden } });
  await sembrarRecetaDeOrden(cliente, idOrden, modelo.id);
  return explosionarOrden(sesion(), idOrden, bd());
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
  // §Post-F9.18: la OC generada toma la dirección FAVORITA del catálogo.
  await cliente.direccionEntrega.create({
    data: { nombre: 'Naucalpan', direccion: 'Av. Siempre Viva 123', favorita: true },
  });
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
    const ex = await explosionarConRecetaFresca();

    expect(ex.totalPiezas).toBe(30);
    expect(ex.regenerado).toBe(false);

    // Aplana todos los renglones de todos los grupos.
    const todos = ex.grupos.flatMap((g) => g.renglones);
    const felpa = todos.find((r) => r.idTela === telaFelpa.id);
    const boton = todos.find((r) => r.idAvio === avioBoton.id);
    const hilo = todos.find((r) => r.idAvio === avioHilo.id);

    expect(felpa?.cantidadRequerida).toBeCloseTo(45); // 1.5 × 30
    expect(felpa?.cantidadAComprar).toBeCloseTo(45);
    // Esta felpa no tiene proveedor DUEÑO capturado ni amarre → sigue sin proveedor. (Con dueño sí
    // lo propondría: V1-E3m/§Post-F9.82, batería aparte al final del archivo.)
    expect(felpa?.idProveedorSugerido).toBeNull();

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
    const ex = await explosionarConRecetaFresca();
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
    const ex = await explosionarConRecetaFresca();
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

    const ex = await explosionarConRecetaFresca();
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
    const ex = await explosionarConRecetaFresca();
    const hilo = ex.grupos.flatMap((g) => g.renglones).find((r) => r.idAvio === avioHilo.id);
    expect(hilo?.cantidadAComprar).toBeCloseTo(35); // 60 − 25
    expect(hilo?.estadoGenerico).toBe('faltante-parcial');
  });
});

describe('Explosión — snapshot regenerable + diff', () => {
  it('regenerar tras cambiar el BOM reporta cantidad-cambiada', async () => {
    await explosionarConRecetaFresca(); // snapshot 1
    // Cambia el consumo de felpa: 1.5 → 2 m.
    await cliente.modeloTela.update({
      where: { idModelo_idTela: { idModelo: modelo.id, idTela: telaFelpa.id } },
      data: { consumoPorPrenda: 2 },
    });
    const ex2 = await explosionarConRecetaFresca();
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
    await explosionarConRecetaFresca();
    await cliente.modeloAvio.delete({
      where: { idModelo_idAvio: { idModelo: modelo.id, idAvio: avioBoton.id } },
    });
    const ex2 = await explosionarConRecetaFresca();
    const boton = ex2.grupos.flatMap((g) => g.renglones).find((r) => r.idAvio === avioBoton.id);
    expect(boton?.diff).toBe('eliminado');
  });
});

describe('Generar OC desde la explosión (R3) — una OC por proveedor', () => {
  it('genera una OC por proveedor con líneas ligadas a la orden', async () => {
    await explosionarConRecetaFresca();
    const resultado = await generarOCDesdeExplosion(
      sesion(),
      { idsOrden: [idOrden], idsRequerimiento: [] },
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
    const ex = await explosionarConRecetaFresca();
    const boton = ex.grupos.flatMap((g) => g.renglones).find((r) => r.idAvio === avioBoton.id)!;
    // Selecciona solo el botón explícitamente.
    const resultado = await generarOCDesdeExplosion(
      sesion(),
      { idsOrden: [idOrden], idsRequerimiento: [boton.id] },
      bd(),
    );
    expect(resultado.ordenesCompra).toHaveLength(1);
    expect(resultado.ordenesCompra[0]!.idProveedor).toBe(provBarato.id);
  });
});

describe('Estatus de materiales (R7) — cruce requerido / en-oc / recibido', () => {
  it('refleja pendiente → en-oc → recibido conforme avanza el flujo', async () => {
    await explosionarConRecetaFresca();

    // 1) Antes de comprar: el botón está pendiente.
    const t0 = await estatusMaterialesOrden(sesion(), idOrden, bd());
    const boton0 = t0.filas.find((f) => f.idAvio === avioBoton.id);
    expect(boton0?.estatus).toBe('pendiente');
    expect(t0.tieneSnapshot).toBe(true);

    // 2) Genera la OC del botón y autorízala.
    const gen = await generarOCDesdeExplosion(
      sesion(),
      { idsOrden: [idOrden], idsRequerimiento: [] },
      bd(),
    );
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
    await explosionarConRecetaFresca();
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
    const ex = await explosionarConRecetaFresca();
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
    const ex = await explosionarConRecetaFresca();
    const felpa = renglonTela(ex, telaFelpa.id);
    expect(felpa?.idProveedorSugerido).toBe(provBarato.id);
    expect(felpa?.precioSugerido).toBeCloseTo(10);
    // ⭐ V1-E3m — LA OTRA DIRECCIÓN de la bandera: con el proveedor VIVO va en `false`. Sin este
    // par, un `true` fijo pasaría las aserciones de los tests del proveedor de baja, y la pantalla
    // ofrecería reasignar en renglones que no lo necesitan.
    expect(felpa?.proveedorSugeridoInactivo).toBe(false);
    expect(ex.avisos).toEqual([]);
    // Con proveedor, la tela ahora SÍ genera OC (antes se omitía por proveedor null).
    const gen = await generarOCDesdeExplosion(
      sesion(),
      { idsOrden: [idOrden], idsRequerimiento: [] },
      bd(),
    );
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
    const ex = await explosionarConRecetaFresca(); // la orden es sólo Rojo
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
    const ex = await explosionarConRecetaFresca();
    const felpa = renglonTela(ex, telaFelpa.id);
    expect(felpa?.precioSugerido).toBeCloseTo(10); // precio BASE (no por color)
    const aviso = ex.avisos.find((a) => a.includes('varios colores'));
    expect(aviso).toBeDefined();
    // Sin compras previas, la fuente REAL es el precio base: el aviso debe decir eso.
    expect(aviso).toContain('se usó el precio base del proveedor');
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
    const ex = await explosionarConRecetaFresca();
    const felpa = renglonTela(ex, telaFelpa.id);
    expect(felpa?.idProveedorSugerido).toBe(provInactivo.id); // se mantiene
    expect(felpa?.precioSugerido).toBeCloseTo(10);
    expect(ex.avisos.some((a) => a.includes('INACTIVO'))).toBe(true);
    // ⭐ V1-E3m: y la BANDERA viaja. No es decorativa: es lo que enciende «Ese proveedor está de
    // baja — asignar otro para esta orden» en la pantalla del comprador. Si el servidor la regresara
    // en `false`, el botón desaparecería en silencio del ÚNICO renglón donde urge desatorar —
    // `crearOC` no valida `activo` y el catálogo no deja guardar con un proveedor desactivado.
    expect(felpa?.proveedorSugeridoInactivo).toBe(true);
  });
});

describe('MRP F8-E6 — AVÍO amarrado a proveedor (R17)', () => {
  it('el amarre gana al "más barato" de F4', async () => {
    // provCaro ($3) es el amarre, aunque provBarato ($2) sería el más barato.
    await cliente.modeloAvio.update({
      where: { idModelo_idAvio: { idModelo: modelo.id, idAvio: avioBoton.id } },
      data: { idAvioProveedor: provCaro.id },
    });
    const ex = await explosionarConRecetaFresca();
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
    const ex = await explosionarConRecetaFresca();
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
    const ex = await explosionarConRecetaFresca();
    const boton = renglonAvio(ex, avioBoton.id);
    expect(boton?.idProveedorSugerido).toBe(provInactivo.id); // se mantiene (Desarrollo lo eligió)
    expect(boton?.precioSugerido).toBeCloseTo(9);
    expect(ex.avisos.some((a) => a.includes('INACTIVO'))).toBe(true);
    // ⭐ V1-E3m: la bandera que enciende la reasignación en la pantalla (gemela de la tela).
    expect(boton?.proveedorSugeridoInactivo).toBe(true);
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
    const ex = await explosionarConRecetaFresca();
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
    const exSin = await explosionarConRecetaFresca();
    const zipSin = renglonAvio(exSin, avioZip.id);
    // Con amarre al MISMO proveedor.
    await cliente.modeloAvio.update({
      where: { idModelo_idAvio: { idModelo: modelo.id, idAvio: avioZip.id } },
      data: { idAvioProveedor: prov.id },
    });
    const exCon = await explosionarConRecetaFresca();
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
    await explosionarConRecetaFresca(); // snapshot 1: felpa @ $10
    await cliente.telaProveedor.update({ where: { id: tp.id }, data: { precio: 15 } });
    const ex2 = await explosionarConRecetaFresca();
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
    await explosionarConRecetaFresca();
    await cliente.modeloTela.update({
      where: { idModelo_idTela: { idModelo: modelo.id, idTela: telaFelpa.id } },
      data: { idTelaProveedor: tpB.id },
    });
    const ex2 = await explosionarConRecetaFresca();
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
    const ex = await explosionarConRecetaFresca();
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
    const ex = await explosionarConRecetaFresca();
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
    const ex = await explosionarConRecetaFresca();
    const hilo = renglonAvio(ex, avioHilo.id);
    expect(hilo?.cantidadRequerida).toBeCloseTo(110);
    expect(hilo?.existenciaStock).toBeCloseTo(50);
    expect(hilo?.cantidadAComprar).toBeCloseTo(60);
    expect(hilo?.estadoGenerico).toBe('faltante-parcial');
  });
});

describe('Generar OC desde la explosión (§Post-F9.18) — fecha y dirección sin inventar nada', () => {
  // La orden y el catálogo los siembra el `beforeEach` del archivo (`idOrden` es del módulo):
  // volver a crear la orden aquí chocaría contra el unique (idEmpresa, folio).

  it('hereda la fecha de entrega de la ORDEN y la dirección FAVORITA del catálogo', async () => {
    await explosionarConRecetaFresca();
    const resultado = await generarOCDesdeExplosion(
      sesion(),
      { idsOrden: [idOrden], idsRequerimiento: [] },
      bd(),
    );

    const primera = resultado.ordenesCompra[0];
    expect(primera).toBeDefined();
    const oc = await obtenerOC(sesion(), primera!.idOrdenCompra, bd());
    expect(oc.fechaEntrega).toBe('2026-09-30');
    expect(oc.direccionEntregaNombre).toBe('Naucalpan');
  });

  it('lo que manda la pantalla GANA sobre los respaldos', async () => {
    const otra = await cliente.direccionEntrega.create({
      data: { nombre: 'Bodega Montaño', direccion: 'Calle 5 #10' },
    });
    await explosionarConRecetaFresca();
    const resultado = await generarOCDesdeExplosion(
      sesion(),
      {
        idsOrden: [idOrden],
        idsRequerimiento: [],
        fechaEntrega: '2026-12-01',
        idDireccionEntrega: otra.id,
      },
      bd(),
    );

    const oc = await obtenerOC(sesion(), resultado.ordenesCompra[0]!.idOrdenCompra, bd());
    expect(oc.fechaEntrega).toBe('2026-12-01');
    expect(oc.direccionEntregaNombre).toBe('Bodega Montaño');
  });

  it('sin fecha en la orden Y sin fecha capturada, dice QUÉ falta (no genera a medias)', async () => {
    await cliente.orden.update({ where: { id: idOrden }, data: { fechaEntrega: null } });
    await explosionarConRecetaFresca();

    await expect(
      generarOCDesdeExplosion(sesion(), { idsOrden: [idOrden], idsRequerimiento: [] }, bd()),
    ).rejects.toThrow(/no tiene fecha de entrega/);
    expect(await cliente.ordenCompra.count()).toBe(0);
  });

  it('sin dirección favorita Y sin dirección capturada, dice QUÉ falta', async () => {
    await cliente.direccionEntrega.updateMany({ data: { favorita: false } });
    await explosionarConRecetaFresca();

    await expect(
      generarOCDesdeExplosion(sesion(), { idsOrden: [idOrden], idsRequerimiento: [] }, bd()),
    ).rejects.toThrow(/favorita/);
    expect(await cliente.ordenCompra.count()).toBe(0);
  });

  it('la OC generada de una tela CON complemento NO se puede autorizar hasta capturarlo', async () => {
    // El BOM guarda un solo consumo por tela: la explosión no sabe cuánto Cardigan comprar.
    await cliente.tela.update({
      where: { id: telaFelpa.id },
      data: { nombreComplemento: 'Cardigan' },
    });
    // La felpa necesita proveedor sugerido para que la explosión le genere OC (amarre R17).
    const amarre = await cliente.telaProveedor.create({
      data: { idTela: telaFelpa.id, idProveedor: provBarato.id, precio: 10 },
    });
    await cliente.modeloTela.update({
      where: { idModelo_idTela: { idModelo: modelo.id, idTela: telaFelpa.id } },
      data: { idTelaProveedor: amarre.id },
    });
    await explosionarConRecetaFresca();
    const resultado = await generarOCDesdeExplosion(
      sesion(),
      { idsOrden: [idOrden], idsRequerimiento: [] },
      bd(),
    );

    // La OC de la TELA existe (nació con el complemento pendiente, a propósito)…
    const idsOc = resultado.ordenesCompra.map((o) => o.idOrdenCompra);
    const conTela = await cliente.ordenCompra.findFirstOrThrow({
      where: { id: { in: idsOc }, lineas: { some: { idTela: telaFelpa.id } } },
      select: { id: true },
    });
    // …pero autorizarla exige capturar el Cardigan.
    await expect(
      autorizarOC(sesion(['compras.ver', 'compras.autorizar']), conTela.id, bd()),
    ).rejects.toThrow(/Cardigan/);
  });
});

// ── V1-E3i · §Post-F9.71 (DANIEL, 19-ago-2026): cada OC de la explosión, con SU fecha ─────────────

describe('Generar OC (§Post-F9.71) — la fecha de entrega es POR PROVEEDOR', () => {
  /**
   * Con el seed base sólo el BOTÓN tiene proveedor sugerido → una sola OC, y una sola OC no puede
   * demostrar nada sobre fechas distintas. Aquí se le pone proveedor al HILO (genérico sin stock,
   * así que va completo a compra) para que la explosión produzca DOS grupos: Baratos (botón) y
   * Caros (hilo).
   */
  async function dosProveedoresComprables(): Promise<void> {
    await cliente.avioProveedor.create({
      data: { idAvio: avioHilo.id, idProveedor: provCaro.id, precio: 1 },
    });
    await explosionarConRecetaFresca();
  }

  /** Fecha de entrega (YYYY-MM-DD) de la OC generada para ese proveedor. */
  async function fechaDeLaOcDe(
    resultado: Awaited<ReturnType<typeof generarOCDesdeExplosion>>,
    idProveedor: number,
  ): Promise<string | null> {
    const generada = resultado.ordenesCompra.find((o) => o.idProveedor === idProveedor);
    expect(generada).toBeDefined();
    const oc = await obtenerOC(sesion(), generada!.idOrdenCompra, bd());
    return oc.fechaEntrega;
  }

  it('cada proveedor recibe SU fecha (la tela semanas antes que los avíos)', async () => {
    await dosProveedoresComprables();
    const resultado = await generarOCDesdeExplosion(
      sesion(),
      {
        idsOrden: [idOrden],
        idsRequerimiento: [],
        fechaEntrega: '2026-11-30',
        fechasPorProveedor: [
          { idProveedor: provBarato.id, fechaEntrega: '2026-10-05' },
          { idProveedor: provCaro.id, fechaEntrega: '2026-12-20' },
        ],
      },
      bd(),
    );

    expect(resultado.ordenesCompra).toHaveLength(2);
    expect(await fechaDeLaOcDe(resultado, provBarato.id)).toBe('2026-10-05');
    expect(await fechaDeLaOcDe(resultado, provCaro.id)).toBe('2026-12-20');
  });

  it('el proveedor SIN fecha propia toma la de arriba (valor inicial, no imposición)', async () => {
    await dosProveedoresComprables();
    const resultado = await generarOCDesdeExplosion(
      sesion(),
      {
        idsOrden: [idOrden],
        idsRequerimiento: [],
        fechaEntrega: '2026-11-30',
        fechasPorProveedor: [{ idProveedor: provBarato.id, fechaEntrega: '2026-10-05' }],
      },
      bd(),
    );

    expect(await fechaDeLaOcDe(resultado, provBarato.id)).toBe('2026-10-05');
    expect(await fechaDeLaOcDe(resultado, provCaro.id)).toBe('2026-11-30');
  });

  it('sin fecha de arriba NI en la orden, basta con que cada proveedor traiga la suya', async () => {
    await cliente.orden.update({ where: { id: idOrden }, data: { fechaEntrega: null } });
    await dosProveedoresComprables();
    const resultado = await generarOCDesdeExplosion(
      sesion(),
      {
        idsOrden: [idOrden],
        idsRequerimiento: [],
        fechasPorProveedor: [
          { idProveedor: provBarato.id, fechaEntrega: '2026-10-05' },
          { idProveedor: provCaro.id, fechaEntrega: '2026-12-20' },
        ],
      },
      bd(),
    );

    expect(await fechaDeLaOcDe(resultado, provBarato.id)).toBe('2026-10-05');
    expect(await fechaDeLaOcDe(resultado, provCaro.id)).toBe('2026-12-20');
  });

  it('si a un proveedor no le queda fecha por ningún lado, lo dice CON SU NOMBRE y no crea nada', async () => {
    await cliente.orden.update({ where: { id: idOrden }, data: { fechaEntrega: null } });
    await dosProveedoresComprables();

    await expect(
      generarOCDesdeExplosion(
        sesion(),
        {
          idsOrden: [idOrden],
          idsRequerimiento: [],
          fechasPorProveedor: [{ idProveedor: provBarato.id, fechaEntrega: '2026-10-05' }],
        },
        bd(),
      ),
    ).rejects.toThrow(/Avíos Caros/);
    // A2: no nace ni la OC del proveedor que sí tenía fecha.
    expect(await cliente.ordenCompra.count()).toBe(0);
  });

  it('dos fechas distintas para el MISMO proveedor se rechazan (no se resuelve en silencio, D3)', async () => {
    await dosProveedoresComprables();
    await expect(
      generarOCDesdeExplosion(
        sesion(),
        {
          idsOrden: [idOrden],
          idsRequerimiento: [],
          fechasPorProveedor: [
            { idProveedor: provBarato.id, fechaEntrega: '2026-10-05' },
            { idProveedor: provBarato.id, fechaEntrega: '2026-10-06' },
          ],
        },
        bd(),
      ),
    ).rejects.toThrow(/dos fechas de entrega distintas/);
    expect(await cliente.ordenCompra.count()).toBe(0);
  });

  it('la fecha de un proveedor que NO entró en la selección no estorba', async () => {
    await dosProveedoresComprables();
    const soloBoton = await cliente.requerimientoOrden.findFirstOrThrow({
      where: { idOrden, idAvio: avioBoton.id },
      select: { id: true },
    });
    const resultado = await generarOCDesdeExplosion(
      sesion(),
      {
        idsOrden: [idOrden],
        idsRequerimiento: [soloBoton.id],
        fechaEntrega: '2026-11-30',
        fechasPorProveedor: [
          { idProveedor: provBarato.id, fechaEntrega: '2026-10-05' },
          { idProveedor: provCaro.id, fechaEntrega: '2026-12-20' },
        ],
      },
      bd(),
    );

    expect(resultado.ordenesCompra).toHaveLength(1);
    expect(await fechaDeLaOcDe(resultado, provBarato.id)).toBe('2026-10-05');
  });
});

// ── V1-E3e · D1 (DANIEL, 15-ago-2026): la OC nace con lo último que ESE proveedor cobró ───────────

describe('MRP D1/§Post-F9.48 — el precio de la línea sale de la última compra AL MISMO proveedor', () => {
  let folioOc = 0;

  /** OC de un renglón para sembrar histórico de compras (no ligada a la orden). */
  async function compra(opciones: {
    idProveedor: number;
    fecha: string;
    precio: number;
    idTela?: number;
    idAvio?: number;
    estatus?: 'borrador' | 'autorizada' | 'cancelada';
  }): Promise<void> {
    folioOc += 1;
    await cliente.ordenCompra.create({
      data: {
        numCompra: BigInt(9000 + folioOc),
        idEmpresa: empresa.id,
        idProveedor: opciones.idProveedor,
        estatus: opciones.estatus ?? 'autorizada',
        fecha: new Date(`${opciones.fecha}T00:00:00.000Z`),
        lineas: {
          create: [
            {
              idTela: opciones.idTela ?? null,
              idAvio: opciones.idAvio ?? null,
              cantidad: 100,
              precio: opciones.precio,
            },
          ],
        },
      },
    });
  }

  beforeEach(() => {
    folioOc = 0;
  });

  it('TELA amarrada: la línea nace con lo último que le cobró el proveedor AMARRADO', async () => {
    const tp = await cliente.telaProveedor.create({
      data: { idTela: telaFelpa.id, idProveedor: provBarato.id, precio: 10 },
    });
    await cliente.modeloTela.update({
      where: { idModelo_idTela: { idModelo: modelo.id, idTela: telaFelpa.id } },
      data: { idTelaProveedor: tp.id },
    });
    // Al amarrado le compramos a $14; a OTRO proveedor, más reciente y más barato ($7).
    await compra({
      idProveedor: provBarato.id,
      fecha: '2026-05-01',
      precio: 14,
      idTela: telaFelpa.id,
    });
    await compra({
      idProveedor: provCaro.id,
      fecha: '2026-07-01',
      precio: 7,
      idTela: telaFelpa.id,
    });

    const ex = await explosionarConRecetaFresca();
    const felpa = renglonTela(ex, telaFelpa.id);
    // El proveedor NO cambia (lo fija el amarre, R1/F4)…
    expect(felpa?.idProveedorSugerido).toBe(provBarato.id);
    // …y el precio es el que ÉL cobró, nunca el del tercero ($7) ni el de catálogo ($10).
    expect(felpa?.precioSugerido).toBeCloseTo(14);
  });

  it('sin compras a ese proveedor, la línea conserva su precio de catálogo (no-regresión)', async () => {
    const tp = await cliente.telaProveedor.create({
      data: { idTela: telaFelpa.id, idProveedor: provBarato.id, precio: 10 },
    });
    await cliente.modeloTela.update({
      where: { idModelo_idTela: { idModelo: modelo.id, idTela: telaFelpa.id } },
      data: { idTelaProveedor: tp.id },
    });
    // Solo hay compras a OTRO proveedor: no deben tocar la línea del amarrado.
    await compra({
      idProveedor: provCaro.id,
      fecha: '2026-07-01',
      precio: 7,
      idTela: telaFelpa.id,
    });

    const ex = await explosionarConRecetaFresca();
    expect(renglonTela(ex, telaFelpa.id)?.precioSugerido).toBeCloseTo(10);
  });

  it('una OC en borrador o cancelada no es compra: la línea sigue con el catálogo', async () => {
    const tp = await cliente.telaProveedor.create({
      data: { idTela: telaFelpa.id, idProveedor: provBarato.id, precio: 10 },
    });
    await cliente.modeloTela.update({
      where: { idModelo_idTela: { idModelo: modelo.id, idTela: telaFelpa.id } },
      data: { idTelaProveedor: tp.id },
    });
    await compra({
      idProveedor: provBarato.id,
      fecha: '2026-08-01',
      precio: 99,
      idTela: telaFelpa.id,
      estatus: 'borrador',
    });
    const ex = await explosionarConRecetaFresca();
    expect(renglonTela(ex, telaFelpa.id)?.precioSugerido).toBeCloseTo(10);
  });

  it('⭐ un precio POR COLOR NO se pisa con la última compra (la compra no sabe de colores)', async () => {
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
    // Compra REAL al mismo proveedor, pero de un color que no se sabe cuál es.
    await compra({
      idProveedor: provBarato.id,
      fecha: '2026-07-01',
      precio: 8,
      idTela: telaFelpa.id,
    });

    const ex = await explosionarConRecetaFresca(); // la orden es sólo Rojo
    // Gana el precio del COLOR (12): es más específico que una compra ciega al color.
    expect(renglonTela(ex, telaFelpa.id)?.precioSugerido).toBeCloseTo(12);
  });

  it('AVÍO sin amarre: el MÁS BARATO sigue eligiendo proveedor, y el precio es el que ÉL cobró', async () => {
    // provBarato es el más barato del catálogo ($2); provCaro ($3) no debe ganar aunque su compra
    // sea más reciente y más barata.
    await compra({
      idProveedor: provBarato.id,
      fecha: '2026-05-01',
      precio: 2.5,
      idAvio: avioBoton.id,
    });
    await compra({
      idProveedor: provCaro.id,
      fecha: '2026-07-01',
      precio: 0.5,
      idAvio: avioBoton.id,
    });

    const ex = await explosionarConRecetaFresca();
    const boton = renglonAvio(ex, avioBoton.id);
    expect(boton?.idProveedorSugerido).toBe(provBarato.id); // R1 intacto
    expect(boton?.precioSugerido).toBeCloseTo(2.5); // lo que ÉL cobró, no el $0.50 del otro
  });

  it('AVÍO amarrado: manda la última compra al amarrado, no la del más barato', async () => {
    await cliente.modeloAvio.update({
      where: { idModelo_idAvio: { idModelo: modelo.id, idAvio: avioBoton.id } },
      data: { idAvioProveedor: provCaro.id },
    });
    await compra({
      idProveedor: provCaro.id,
      fecha: '2026-05-01',
      precio: 4,
      idAvio: avioBoton.id,
    });
    await compra({
      idProveedor: provBarato.id,
      fecha: '2026-07-01',
      precio: 1,
      idAvio: avioBoton.id,
    });

    const ex = await explosionarConRecetaFresca();
    const boton = renglonAvio(ex, avioBoton.id);
    expect(boton?.idProveedorSugerido).toBe(provCaro.id);
    expect(boton?.precioSugerido).toBeCloseTo(4);
  });

  /**
   * ⭐ V1-E3m — **EL SEGUNDO CAMINO DE `respetarPrecio`**, el que faltaba probar. `conUltimoPrecioDelProveedor`
   * sale temprano en DOS casos: el precio por COLOR (ya cubierto arriba, `amarre-color`) y el precio
   * que **teclea Compras** al asignar proveedor (`precioFijado`). El segundo se agregó en esta etapa
   * y no tenía espejo: el único test que lo tocaba afirmaba el precio en un escenario **sin compras
   * previas**, donde pasa igual con el guard puesto o quitado. Es dinero, y estaba afirmado por
   * escrito.
   */
  it('el precio que TECLEA Compras manda sobre la última compra a ese mismo proveedor', async () => {
    // A ese proveedor ya le compramos ese avío CARÍSIMO ($40): si el guard no existiera, la línea
    // nacería con 40 y el número que capturó el comprador sería decorado.
    await compra({
      idProveedor: provCaro.id,
      fecha: '2026-07-15',
      precio: 40,
      idAvio: avioHilo.id,
    });
    await asignarProveedorDeMaterial(
      sesion(),
      idOrden,
      { tipo: 'avio', idMaterial: avioHilo.id, idProveedor: provCaro.id, precio: 1.25 },
      bd(),
    );

    const ex = await explosionarOrden(sesion(), idOrden, bd());
    const hilo = renglonAvio(ex, avioHilo.id);
    expect(hilo?.idProveedorSugerido).toBe(provCaro.id);
    // 1.25 (lo tecleado HOY), no 40 (lo que ese mismo proveedor cobró la última vez).
    expect(hilo?.precioSugerido).toBeCloseTo(1.25);
  });

  it('si Compras NO teclea precio, sí manda la última compra a ese proveedor (D1 intacto)', async () => {
    // El espejo del anterior: sin precio capturado el guard NO debe dispararse. Sin esta mitad,
    // "respetar siempre" pasaría el test de arriba y nadie lo notaría.
    await compra({
      idProveedor: provCaro.id,
      fecha: '2026-07-15',
      precio: 40,
      idAvio: avioHilo.id,
    });
    await asignarProveedorDeMaterial(
      sesion(),
      idOrden,
      { tipo: 'avio', idMaterial: avioHilo.id, idProveedor: provCaro.id },
      bd(),
    );

    const ex = await explosionarOrden(sesion(), idOrden, bd());
    const hilo = renglonAvio(ex, avioHilo.id);
    expect(hilo?.precioSugerido).toBeCloseTo(40);
  });
});

describe('MRP — el AVISO de multi-color nombra la fuente REAL del precio (V1-E3e)', () => {
  /**
   * El texto se armaba ANTES de que D1 pisara el precio, así que decía "se usó el precio base del
   * proveedor" incluso cuando la línea había nacido con la última compra: mandaba a revisar un dato
   * que no era el de la línea. Un aviso que describe mal su propia causa confunde a quien lo lee
   * dentro de seis meses, y es el mismo pecado —decir una cosa y hacer otra— que esta etapa vino a
   * corregir en la receta.
   */
  it('con una compra previa a ese proveedor, dice "última compra" (no "precio base")', async () => {
    const colorAzul = await cliente.color.create({ data: { nombre: 'Azul V1E3e' } });
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
    // La orden pasa a tener DOS colores con precios de tela distintos → el por-color no aplica.
    await cliente.ordenLinea.create({
      data: {
        idOrden,
        idColor: colorAzul.id,
        tallas: { create: [{ idTalla: tallaCH.id, cantidad: 5 }] },
      },
    });
    // Y existe una compra REAL a ese mismo proveedor: D1 pisa el precio con ella.
    await cliente.ordenCompra.create({
      data: {
        numCompra: 9500n,
        idEmpresa: empresa.id,
        idProveedor: provBarato.id,
        estatus: 'autorizada',
        fecha: new Date('2026-07-01T00:00:00.000Z'),
        lineas: { create: [{ idTela: telaFelpa.id, cantidad: 100, precio: 17 }] },
      },
    });

    const ex = await explosionarConRecetaFresca();
    // El precio de la línea es el de la última compra (17), no el base (10) ni los de color.
    expect(renglonTela(ex, telaFelpa.id)?.precioSugerido).toBeCloseTo(17);
    const aviso = ex.avisos.find((a) => a.includes('varios colores'));
    expect(aviso).toBeDefined();
    // ⭐ El texto nombra la fuente REAL, no la que se usaba antes de D1.
    expect(aviso).toContain('se usó el precio de la última compra a ese proveedor');
    expect(aviso).not.toContain('se usó el precio base del proveedor');
  });

  it('sin precio base ni compras, el aviso dice que se cayó al catálogo de la tela', async () => {
    const colorAzul = await cliente.color.create({ data: { nombre: 'Azul sin base' } });
    // La tela SÍ tiene precio de catálogo (la fixture no lo trae): es el escalón al que se cae.
    await cliente.tela.update({ where: { id: telaFelpa.id }, data: { precioSugerido: 9 } });
    const tp = await cliente.telaProveedor.create({
      data: {
        idTela: telaFelpa.id,
        idProveedor: provBarato.id,
        precio: null, // el proveedor NO fija precio base
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
    await cliente.ordenLinea.create({
      data: {
        idOrden,
        idColor: colorAzul.id,
        tallas: { create: [{ idTalla: tallaCH.id, cantidad: 5 }] },
      },
    });

    const ex = await explosionarConRecetaFresca();
    const aviso = ex.avisos.find((a) => a.includes('varios colores'));
    expect(aviso).toBeDefined();
    // Antes también aquí mentía diciendo "precio base": ese proveedor no tiene precio base.
    // V1-E3m le puso su nombre: es el precio de REFERENCIA de la tela, no un precio de compra.
    expect(aviso).toContain('se usó el precio de REFERENCIA de la tela');
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⭐ V1-E3m (§Post-F9.82) — EL PROVEEDOR DEL MATERIAL
//
// Daniel, con la receta liberada y la explosión enfrente: *"no me deja hacer nada… ahí veo todo,
// pero no puedo avanzar"*. Ningún renglón traía proveedor, y sin proveedor no hay OC. Estas
// baterías cubren las tres piezas del arreglo contra Postgres: el DUEÑO de la tela, el HABITUAL del
// avío y la asignación de COMPRAS por orden (que nunca toca el catálogo).
// ─────────────────────────────────────────────────────────────────────────────────────────────────

describe('V1-E3m — TELA: el motor resuelve por el proveedor DUEÑO (§Post-F9.11)', () => {
  it('sin amarre, propone al DUEÑO de la tela (antes se rendía y dejaba el renglón sin proveedor)', async () => {
    await cliente.tela.update({
      where: { id: telaFelpa.id },
      data: { idProveedor: provCaro.id, precioSugerido: 7 },
    });
    const ex = await explosionarConRecetaFresca();
    const felpa = renglonTela(ex, telaFelpa.id);
    // Sin V1-E3m esto era `null` — y con él apagado el botón de generar OC.
    expect(felpa?.idProveedorSugerido).toBe(provCaro.id);
    expect(felpa?.origenProveedor).toBe('dueno-tela');
    // Sin precio negociado con el dueño, la línea nace con el precio de REFERENCIA… y se DICE.
    expect(felpa?.precioSugerido).toBeCloseTo(7);
    expect(ex.avisos.some((a) => a.includes('precio de REFERENCIA de la tela'))).toBe(true);
  });

  it('si el dueño SÍ tiene precio negociado, ése manda sobre la referencia', async () => {
    await cliente.tela.update({
      where: { id: telaFelpa.id },
      data: { idProveedor: provCaro.id, precioSugerido: 7 },
    });
    await cliente.telaProveedor.create({
      data: { idTela: telaFelpa.id, idProveedor: provCaro.id, precio: 11 },
    });
    const ex = await explosionarConRecetaFresca();
    const felpa = renglonTela(ex, telaFelpa.id);
    expect(felpa?.idProveedorSugerido).toBe(provCaro.id);
    // 11 (negociado), NO 7 (referencia).
    expect(felpa?.precioSugerido).toBeCloseTo(11);
    expect(ex.avisos.some((a) => a.includes('precio de REFERENCIA de la tela'))).toBe(false);
  });

  it('el AMARRE de Desarrollo sigue mandando sobre el dueño (su autoridad no se toca)', async () => {
    await cliente.tela.update({ where: { id: telaFelpa.id }, data: { idProveedor: provCaro.id } });
    const tp = await cliente.telaProveedor.create({
      data: { idTela: telaFelpa.id, idProveedor: provBarato.id, precio: 10 },
    });
    await cliente.modeloTela.update({
      where: { idModelo_idTela: { idModelo: modelo.id, idTela: telaFelpa.id } },
      data: { idTelaProveedor: tp.id },
    });
    const ex = await explosionarConRecetaFresca();
    const felpa = renglonTela(ex, telaFelpa.id);
    expect(felpa?.idProveedorSugerido).toBe(provBarato.id);
    expect(felpa?.origenProveedor).toBe('amarre-desarrollo');
  });
});

describe('V1-E3m — AVÍO: manda el proveedor HABITUAL, no el más barato', () => {
  it('el habitual gana AUNQUE sea el más caro (esa es la decisión de Daniel)', async () => {
    await cliente.avioProveedor.update({
      where: { idAvio_idProveedor: { idAvio: avioBoton.id, idProveedor: provCaro.id } },
      data: { habitual: true },
    });
    const ex = await explosionarConRecetaFresca();
    const boton = renglonAvio(ex, avioBoton.id);
    // Sin la bandera aquí saldría provBarato/$2 (la regla F4).
    expect(boton?.idProveedorSugerido).toBe(provCaro.id);
    expect(boton?.precioSugerido).toBeCloseTo(3);
    expect(boton?.origenProveedor).toBe('habitual');
  });

  it('sin habitual sigue ganando el más barato (fallback F4 intacto)', async () => {
    const ex = await explosionarConRecetaFresca();
    const boton = renglonAvio(ex, avioBoton.id);
    expect(boton?.idProveedorSugerido).toBe(provBarato.id);
    expect(boton?.origenProveedor).toBe('mas-barato');
  });

  it('un habitual SIN precio sigue siendo el proveedor: cae al precio de REFERENCIA y avisa', async () => {
    await cliente.avio.update({
      where: { id: avioBoton.id },
      data: { precioReferencia: 4 },
    });
    await cliente.avioProveedor.update({
      where: { idAvio_idProveedor: { idAvio: avioBoton.id, idProveedor: provCaro.id } },
      data: { habitual: true, precio: null },
    });
    const ex = await explosionarConRecetaFresca();
    const boton = renglonAvio(ex, avioBoton.id);
    expect(boton?.idProveedorSugerido).toBe(provCaro.id);
    expect(boton?.precioSugerido).toBeCloseTo(4);
    expect(ex.avisos.some((a) => a.includes('precio de REFERENCIA del avío'))).toBe(true);
  });
});

describe('V1-E3m — el COMPRADOR desatora desde su pantalla, SOLO para esa OP', () => {
  it('asigna proveedor a una tela sin dueño y la explosión ya la puede comprar', async () => {
    // Punto de partida: exactamente el atorón de Daniel (tela sin dueño ni amarre).
    const antes = await explosionarConRecetaFresca();
    expect(renglonTela(antes, telaFelpa.id)?.idProveedorSugerido).toBeNull();

    await asignarProveedorDeMaterial(
      sesion(),
      idOrden,
      { tipo: 'tela', idMaterial: telaFelpa.id, idProveedor: provBarato.id, precio: 13.5 },
      bd(),
    );
    // ⚠️ SIN re-sembrar la receta: la asignación vive en ella.
    const ex = await explosionarOrden(sesion(), idOrden, bd());
    const felpa = renglonTela(ex, telaFelpa.id);
    expect(felpa?.idProveedorSugerido).toBe(provBarato.id);
    expect(felpa?.precioSugerido).toBeCloseTo(13.5);
    expect(felpa?.origenProveedor).toBe('asignado-compras');
  });

  it('⭐ NO toca el catálogo: la tela sigue sin dueño y el resto de las órdenes no se entera', async () => {
    await asignarProveedorDeMaterial(
      sesion(),
      idOrden,
      { tipo: 'tela', idMaterial: telaFelpa.id, idProveedor: provBarato.id, precio: 13.5 },
      bd(),
    );
    const tela = await cliente.tela.findUniqueOrThrow({ where: { id: telaFelpa.id } });
    // La restricción textual de Daniel: "no para siempre ni para todo".
    expect(tela.idProveedor).toBeNull();
    expect(await cliente.telaProveedor.count({ where: { idTela: telaFelpa.id } })).toBe(0);
  });

  it('la asignación NO pisa a Desarrollo/al catálogo: queda DORMIDA y se avisa', async () => {
    await asignarProveedorDeMaterial(
      sesion(),
      idOrden,
      { tipo: 'tela', idMaterial: telaFelpa.id, idProveedor: provBarato.id, precio: 13.5 },
      bd(),
    );
    // Después, el catálogo aprende quién es el dueño de la tela.
    await cliente.tela.update({ where: { id: telaFelpa.id }, data: { idProveedor: provCaro.id } });
    const ex = await explosionarOrden(sesion(), idOrden, bd());
    const felpa = renglonTela(ex, telaFelpa.id);
    expect(felpa?.idProveedorSugerido).toBe(provCaro.id); // manda el catálogo
    expect(felpa?.origenProveedor).toBe('dueno-tela');
    // …y lo que Compras había asignado no se calla (D3).
    expect(ex.avisos.some((a) => a.includes('Compras había asignado'))).toBe(true);
  });

  it('quitar la asignación (idProveedor null) devuelve el renglón a "sin proveedor"', async () => {
    await asignarProveedorDeMaterial(
      sesion(),
      idOrden,
      { tipo: 'tela', idMaterial: telaFelpa.id, idProveedor: provBarato.id, precio: 13.5 },
      bd(),
    );
    await asignarProveedorDeMaterial(
      sesion(),
      idOrden,
      { tipo: 'tela', idMaterial: telaFelpa.id, idProveedor: null },
      bd(),
    );
    const renglon = await cliente.ordenTela.findFirstOrThrow({
      where: { idOrden, idTela: telaFelpa.id },
    });
    expect(renglon.idProveedorCompra).toBeNull();
    // El precio se va con el proveedor: dejarlo colgando escondería un número que ya no vale.
    expect(renglon.precioCompra).toBeNull();
  });

  it('asigna proveedor a un AVÍO y la OC generada sale a ese proveedor', async () => {
    await asignarProveedorDeMaterial(
      sesion(),
      idOrden,
      { tipo: 'avio', idMaterial: avioHilo.id, idProveedor: provCaro.id, precio: 1.25 },
      bd(),
    );
    const ex = await explosionarOrden(sesion(), idOrden, bd());
    const hilo = renglonAvio(ex, avioHilo.id);
    expect(hilo?.idProveedorSugerido).toBe(provCaro.id);

    const { ordenesCompra } = await generarOCDesdeExplosion(
      sesion(),
      { idsOrden: [idOrden], idsRequerimiento: [hilo?.id ?? 0] },
      bd(),
    );
    expect(ordenesCompra).toHaveLength(1);
    expect(ordenesCompra[0]?.idProveedor).toBe(provCaro.id);
    const oc = await obtenerOC(sesion(), ordenesCompra[0]?.idOrdenCompra ?? 0, bd());
    expect(oc.lineas[0]?.precio).toBeCloseTo(1.25);
  });

  it('un material que no está en la receta de la orden se rechaza diciendo por qué', async () => {
    const otraTela = await cliente.tela.create({ data: { nombre: 'Rib', unidadMedida: 'KG' } });
    await expect(
      asignarProveedorDeMaterial(
        sesion(),
        idOrden,
        { tipo: 'tela', idMaterial: otraTela.id, idProveedor: provBarato.id },
        bd(),
      ),
    ).rejects.toThrow(/no está en la receta/i);
  });

  it('un renglón EXCLUIDO de la orden no se puede asignar (esta orden no lo lleva)', async () => {
    await cliente.ordenTela.updateMany({
      where: { idOrden, idTela: telaFelpa.id },
      data: { excluido: true },
    });
    await expect(
      asignarProveedorDeMaterial(
        sesion(),
        idOrden,
        { tipo: 'tela', idMaterial: telaFelpa.id, idProveedor: provBarato.id },
        bd(),
      ),
    ).rejects.toThrow(/EXCLUIDO/);
  });

  it('un proveedor DESACTIVADO no se puede asignar (es una elección que se toma ahora)', async () => {
    await cliente.proveedor.update({ where: { id: provBarato.id }, data: { activo: false } });
    await expect(
      asignarProveedorDeMaterial(
        sesion(),
        idOrden,
        { tipo: 'tela', idMaterial: telaFelpa.id, idProveedor: provBarato.id },
        bd(),
      ),
    ).rejects.toThrow(/desactivado/i);
  });

  it('A9 — una orden de OTRA empresa responde 404, no se asigna nada', async () => {
    const otra = await crearEmpresaPrueba(cliente, 'Otra SA');
    const sesionAjena = sesionDePrueba({ idEmpresaActiva: otra.id, permisos: PERM });
    await expect(
      asignarProveedorDeMaterial(
        sesionAjena,
        idOrden,
        { tipo: 'tela', idMaterial: telaFelpa.id, idProveedor: provBarato.id },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);
    const renglon = await cliente.ordenTela.findFirstOrThrow({
      where: { idOrden, idTela: telaFelpa.id },
    });
    expect(renglon.idProveedorCompra).toBeNull();
  });
});

/**
 * ⭐⭐ **V1-E3x (§Post-F9.88) — EL MISMO PROVEEDOR A VARIOS RENGLONES, EN UN SOLO ACTO.**
 *
 * Daniel, 21-ago-2026: *"cuando no tengan proveedor los avíos, ya en la pantalla de explosión,
 * podemos hacer una forma de poder poner el proveedor de manera más rápida a varios elementos que
 * lleven el mismo proveedor"*. Estas pruebas son las que se ponen ROJAS si alguien convierte la vía
 * rápida en una vía floja: si deja de ser TODO O NADA, si empieza a escribir en el catálogo, si la
 * bitácora vuelve a leerse como N actos sueltos, o si una orden ajena se cuela (A9).
 */
describe('V1-E3x — asignar el mismo proveedor a VARIOS renglones (§Post-F9.88)', () => {
  it('asigna a dos materiales de un golpe y la explosión ya los puede comprar', async () => {
    const antes = await explosionarConRecetaFresca();
    expect(renglonTela(antes, telaFelpa.id)?.idProveedorSugerido).toBeNull();

    const salida = await asignarProveedorDeMaterialEnBloque(
      sesion(),
      {
        asignaciones: [
          { idOrden, tipo: 'tela', idMaterial: telaFelpa.id },
          { idOrden, tipo: 'avio', idMaterial: avioHilo.id },
        ],
        idProveedor: provBarato.id,
      },
      bd(),
    );
    expect(salida.renglones).toBe(2);
    expect(salida.ordenes).toBe(1);
    expect(salida.proveedor).toBe(provBarato.nombre);
    expect(salida.asignados.map((a) => a.folioOrden)).toEqual([1, 1]);

    // ⚠️ SIN re-sembrar la receta: la asignación vive en ella.
    const ex = await explosionarOrden(sesion(), idOrden, bd());
    expect(renglonTela(ex, telaFelpa.id)?.origenProveedor).toBe('asignado-compras');
    expect(renglonAvio(ex, avioHilo.id)?.origenProveedor).toBe('asignado-compras');
  });

  it('⭐ NO toca el catálogo: la vía rápida no es una puerta trasera para editarlo', async () => {
    await asignarProveedorDeMaterialEnBloque(
      sesion(),
      {
        asignaciones: [
          { idOrden, tipo: 'tela', idMaterial: telaFelpa.id },
          { idOrden, tipo: 'avio', idMaterial: avioHilo.id },
        ],
        idProveedor: provBarato.id,
      },
      bd(),
    );
    const tela = await cliente.tela.findUniqueOrThrow({ where: { id: telaFelpa.id } });
    expect(tela.idProveedor).toBeNull();
    expect(await cliente.telaProveedor.count({ where: { idTela: telaFelpa.id } })).toBe(0);
    expect(await cliente.avioProveedor.count({ where: { idAvio: avioHilo.id } })).toBe(0);
  });

  it('⭐ TODO O NADA: con un renglón EXCLUIDO no se escribe NINGUNO, y el error dice cuál', async () => {
    await cliente.ordenTela.updateMany({
      where: { idOrden, idTela: telaFelpa.id },
      data: { excluido: true },
    });
    await expect(
      asignarProveedorDeMaterialEnBloque(
        sesion(),
        {
          asignaciones: [
            { idOrden, tipo: 'avio', idMaterial: avioHilo.id },
            { idOrden, tipo: 'tela', idMaterial: telaFelpa.id },
          ],
          idProveedor: provBarato.id,
        },
        bd(),
      ),
      // Nombra el material y avisa que no quedó nada a medias.
    ).rejects.toThrow(/EXCLUIDO[\s\S]*todo o nada/i);
    // El avío iba PRIMERO y aun así no quedó escrito: la transacción se revirtió entera (A2).
    const hilo = await cliente.ordenAvio.findFirstOrThrow({
      where: { idOrden, idAvio: avioHilo.id },
    });
    expect(hilo.idProveedorCompra).toBeNull();
  });

  it('un material que NO está en la receta tumba el acto entero y nombra la ORDEN', async () => {
    const otraTela = await cliente.tela.create({ data: { nombre: 'Rib', unidadMedida: 'KG' } });
    await expect(
      asignarProveedorDeMaterialEnBloque(
        sesion(),
        {
          asignaciones: [
            { idOrden, tipo: 'avio', idMaterial: avioHilo.id },
            { idOrden, tipo: 'tela', idMaterial: otraTela.id },
          ],
          idProveedor: provBarato.id,
        },
        bd(),
      ),
    ).rejects.toThrow(/Orden 1:[\s\S]*no está en la receta/i);
    const hilo = await cliente.ordenAvio.findFirstOrThrow({
      where: { idOrden, idAvio: avioHilo.id },
    });
    expect(hilo.idProveedorCompra).toBeNull();
  });

  it('un proveedor DESACTIVADO tumba el acto entero (es una elección que se toma AHORA)', async () => {
    await cliente.proveedor.update({ where: { id: provBarato.id }, data: { activo: false } });
    await expect(
      asignarProveedorDeMaterialEnBloque(
        sesion(),
        {
          asignaciones: [
            { idOrden, tipo: 'tela', idMaterial: telaFelpa.id },
            { idOrden, tipo: 'avio', idMaterial: avioHilo.id },
          ],
          idProveedor: provBarato.id,
        },
        bd(),
      ),
    ).rejects.toThrow(/desactivado/i);
    const felpa = await cliente.ordenTela.findFirstOrThrow({
      where: { idOrden, idTela: telaFelpa.id },
    });
    expect(felpa.idProveedorCompra).toBeNull();
  });

  it('A9 — si UNA sola orden es de otra empresa, 404 y no se escribe nada (ni de la propia)', async () => {
    const otra = await crearEmpresaPrueba(cliente, 'Otra SA');
    const ordenAjena = await cliente.orden.create({
      data: {
        folio: 1n,
        idEmpresa: otra.id,
        idModelo: modelo.id,
        idCliente: clienteNegocioId,
        estado: 'completa',
        fechaEntrega: new Date('2026-09-30T00:00:00.000Z'),
      },
    });
    await expect(
      asignarProveedorDeMaterialEnBloque(
        sesion(),
        {
          asignaciones: [
            { idOrden, tipo: 'tela', idMaterial: telaFelpa.id },
            { idOrden: ordenAjena.id, tipo: 'tela', idMaterial: telaFelpa.id },
          ],
          idProveedor: provBarato.id,
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);
    const felpa = await cliente.ordenTela.findFirstOrThrow({
      where: { idOrden, idTela: telaFelpa.id },
    });
    expect(felpa.idProveedorCompra).toBeNull();
  });

  it('el mismo par repetido cuenta UNA vez (el conteo que lee el usuario no se infla)', async () => {
    const salida = await asignarProveedorDeMaterialEnBloque(
      sesion(),
      {
        asignaciones: [
          { idOrden, tipo: 'tela', idMaterial: telaFelpa.id },
          { idOrden, tipo: 'tela', idMaterial: telaFelpa.id },
        ],
        idProveedor: provBarato.id,
      },
      bd(),
    );
    expect(salida.renglones).toBe(1);
  });

  it('⭐ A7 — la bitácora dice que fueron N renglones en UN acto, no N actos sueltos', async () => {
    const salida = await asignarProveedorDeMaterialEnBloque(
      sesion(),
      {
        asignaciones: [
          { idOrden, tipo: 'tela', idMaterial: telaFelpa.id },
          { idOrden, tipo: 'avio', idMaterial: avioHilo.id },
        ],
        idProveedor: provBarato.id,
      },
      bd(),
    );
    const filas = await cliente.bitacora.findMany({
      where: { entidad: 'Orden', idEntidad: String(idOrden) },
    });
    const detalle = filas
      .map((f) => f.datos as Record<string, unknown> | null)
      .filter((d): d is Record<string, unknown> => d !== null);

    // 1) Cada renglón conserva SU detalle… y lleva la marca del acto.
    const porRenglon = detalle.filter((d) => d['proveedorDeCompraDelMaterial'] === true);
    expect(porRenglon).toHaveLength(2);
    for (const d of porRenglon) {
      const acto = d['actoEnBloque'] as Record<string, unknown>;
      expect(acto['idLote']).toBe(salida.idLote);
      expect(acto['total']).toBe(2);
    }
    expect(
      porRenglon.map((d) => (d['actoEnBloque'] as Record<string, unknown>)['posicion']),
    ).toEqual([1, 2]);

    // 2) Y hay UN resumen del acto en la orden: el que se lee sin tener que juntar por la hora.
    const resumen = detalle.filter((d) => d['proveedorDeCompraEnBloque'] === true);
    expect(resumen).toHaveLength(1);
    expect(resumen[0]?.['idLote']).toBe(salida.idLote);
    expect(resumen[0]?.['renglonesDeEsteActo']).toBe(2);
    expect(resumen[0]?.['renglonesDeEstaOrden']).toBe(2);
  });

  it('con VARIAS órdenes escribe en la receta de cada una y deja resumen en las dos', async () => {
    const idOrden2 = await crearOrden(2n);
    const salida = await asignarProveedorDeMaterialEnBloque(
      sesion(),
      {
        asignaciones: [
          { idOrden, tipo: 'tela', idMaterial: telaFelpa.id },
          { idOrden: idOrden2, tipo: 'tela', idMaterial: telaFelpa.id },
        ],
        idProveedor: provBarato.id,
      },
      bd(),
    );
    expect(salida.renglones).toBe(2);
    expect(salida.ordenes).toBe(2);
    expect(salida.asignados.map((a) => a.folioOrden).sort()).toEqual([1, 2]);
    const escritos = await cliente.ordenTela.findMany({
      where: { idTela: telaFelpa.id, idProveedorCompra: provBarato.id },
    });
    expect(escritos).toHaveLength(2);
    const resumenes = await cliente.bitacora.findMany({
      where: { entidad: 'Orden', idEntidad: { in: [String(idOrden), String(idOrden2)] } },
    });
    expect(
      resumenes.filter(
        (f) => (f.datos as Record<string, unknown> | null)?.['proveedorDeCompraEnBloque'] === true,
      ),
    ).toHaveLength(2);
  });
});

/**
 * ⭐⭐ **V1-E3q (§Post-F9.85) — NO VOLVER A COMPRAR LO YA COMPRADO.**
 *
 * Daniel, probando en vivo el 20-ago: *"me vuelvo a meter en la pantalla y sigue apareciendo ahí los
 * elementos y me deja volver a hacerla"*. El snapshot guardaba la DEMANDA y nadie le restaba lo que
 * ya viajaba en una OC. Estas pruebas son las que se ponen ROJAS si alguien quita el neteo.
 */
describe('V1-E3q — el neteo contra lo YA COMPRADO (§Post-F9.85)', () => {
  /** Explosión fresca de la orden única del fixture. */
  async function explotar(): Promise<Awaited<ReturnType<typeof explosionarOrden>>> {
    return explosionarConRecetaFresca();
  }

  /** El renglón del BOTÓN (el único comprable del fixture: tiene proveedor con precio). */
  function boton(ex: Awaited<ReturnType<typeof explosionarOrden>>) {
    return ex.grupos
      .flatMap((g) => g.renglones)
      .find((r) => r.idAvio === avioBoton.id) as (typeof ex.grupos)[number]['renglones'][number];
  }

  it('⭐ generar dos veces NO duplica la compra: la segunda no tiene qué comprar', async () => {
    await explotar();
    const primera = await generarOCDesdeExplosion(
      sesion(),
      { idsOrden: [idOrden], idsRequerimiento: [] },
      bd(),
    );
    expect(primera.ordenesCompra).toHaveLength(1);
    expect(primera.ordenesCompra[0]?.renglones).toBe(1); // 180 pza de botón

    // Segunda vuelta: el snapshot sigue diciendo "180 a comprar", pero YA están en una OC viva.
    const segunda = await generarOCDesdeExplosion(
      sesion(),
      { idsOrden: [idOrden], idsRequerimiento: [] },
      bd(),
    );
    // 🔴 SIN el neteo aquí saldría OTRA OC con las MISMAS 180 piezas (el defecto de Daniel).
    expect(segunda.ordenesCompra).toHaveLength(0);
    expect(await cliente.ordenCompra.count()).toBe(1);
    // Y no se calla: dice POR QUÉ se quedó fuera.
    const omitido = segunda.omitidos.find((o) => o.material.includes('BOT-01'));
    expect(omitido?.motivo).toBe('ya-en-oc');
    expect(omitido?.cantidadEnOc).toBeCloseTo(180);
  });

  it('⭐ la explosión enseña el renglón YA COMPRADO con pendiente 0 (no invita a recomprar)', async () => {
    await explotar();
    await generarOCDesdeExplosion(sesion(), { idsOrden: [idOrden], idsRequerimiento: [] }, bd());

    const ex = await explotar();
    const fila = boton(ex);
    // Lo requerido NO cambia (el snapshot es la demanda); lo que cambia es lo PENDIENTE.
    expect(fila.cantidadRequerida).toBeCloseTo(180);
    expect(fila.cantidadAComprar).toBeCloseTo(180);
    expect(fila.cantidadEnOc).toBeCloseTo(180);
    // 🔴 Si esto valiera 180 en vez de 0, la pantalla volvería a ofrecer la compra duplicada.
    expect(fila.cantidadPendiente).toBe(0);
  });

  it('una compra PARCIAL deja pendiente sólo el resto (no todo ni nada)', async () => {
    await explotar();
    // El comprador pide 100 de las 180 (ajuste a la baja, §Post-F9.86).
    await generarOCDesdeExplosion(
      sesion(),
      {
        idsOrden: [idOrden],
        idsRequerimiento: [],
        ajustes: [
          {
            tipo: 'avio',
            idMaterial: avioBoton.id,
            idProveedor: provBarato.id,
            cantidadTotal: 100,
          },
        ],
      },
      bd(),
    );

    const fila = boton(await explotar());
    expect(fila.cantidadEnOc).toBeCloseTo(100);
    expect(fila.cantidadPendiente).toBeCloseTo(80);

    // Y la segunda compra pide exactamente los 80 que faltan.
    const segunda = await generarOCDesdeExplosion(
      sesion(),
      { idsOrden: [idOrden], idsRequerimiento: [] },
      bd(),
    );
    const oc = await obtenerOC(sesion(), segunda.ordenesCompra[0]?.idOrdenCompra ?? 0, bd());
    expect(Number(oc.lineas[0]?.cantidad)).toBeCloseTo(80);
  });

  it('⭐ CANCELAR la OC devuelve el material a pendiente (cancelar es la manera de deshacer, D3)', async () => {
    await explotar();
    const gen = await generarOCDesdeExplosion(
      sesion(),
      { idsOrden: [idOrden], idsRequerimiento: [] },
      bd(),
    );
    expect(boton(await explotar()).cantidadPendiente).toBe(0);

    await cliente.ordenCompra.update({
      where: { id: gen.ordenesCompra[0]?.idOrdenCompra ?? 0 },
      data: { estatus: 'cancelada' },
    });

    // 🔴 Si `cancelada` contara como "ya comprado", esto seguiría en 0 y la orden se quedaría sin
    // poder recomprar nunca.
    const fila = boton(await explotar());
    expect(fila.cantidadEnOc).toBe(0);
    expect(fila.cantidadPendiente).toBeCloseTo(180);
  });

  it('⭐ un BORRADOR SÍ cuenta como comprado (es la OC que esta misma pantalla acaba de crear)', async () => {
    await explotar();
    const gen = await generarOCDesdeExplosion(
      sesion(),
      { idsOrden: [idOrden], idsRequerimiento: [] },
      bd(),
    );
    const oc = await cliente.ordenCompra.findFirstOrThrow({
      where: { id: gen.ordenesCompra[0]?.idOrdenCompra ?? 0 },
      select: { estatus: true },
    });
    // La OC del MRP nace en borrador: si el criterio no lo incluyera, el arreglo no arreglaría nada.
    expect(oc.estatus).toBe('borrador');
    expect(boton(await explotar()).cantidadPendiente).toBe(0);
  });

  it('el tablero R7 y la explosión dicen el MISMO "en OC" (una sola verdad)', async () => {
    await explotar();
    await generarOCDesdeExplosion(sesion(), { idsOrden: [idOrden], idsRequerimiento: [] }, bd());

    const ex = await explotar();
    const tablero = await estatusMaterialesOrden(sesion(), idOrden, bd());
    const filaTablero = tablero.filas.find((f) => f.idAvio === avioBoton.id);
    // 🔴 EXACTO, no `toBeCloseTo`: el docstring promete que el tablero y la explosión *"nunca digan
    // números distintos"*, y una comparación aproximada no puede comprobar esa promesa — con
    // `toBeCloseTo` pasaba mientras uno decía 0.3 y el otro 0.30000000000000004 (2ª vuelta del
    // reviewer). Una aserción laxa sobre una promesa estricta es una prueba que miente.
    expect(filaTablero?.enOc).toBe(boton(ex).cantidadEnOc);
    expect(filaTablero?.enOc).toBe(180);
  });
});

/**
 * ⭐⭐ **V1-E3q (§Post-F9.85) — LA REVISIÓN PREVIA.** *"Me gustaría que al darle «generar OC desde la
 * explosión», te mande a una pantalla previa, antes de generar la OC. Una revisión previa es
 * indispensable"* (Daniel). Lo que se prueba aquí es que la previa **no crea nada** y que dice lo
 * mismo que luego pasa.
 */
describe('V1-E3q — la revisión previa (§Post-F9.85)', () => {
  it('⭐ el previo NO crea ninguna OC y describe la que saldría', async () => {
    await explosionarConRecetaFresca();
    const plan = await previoCompraDesdeExplosion(
      sesion(),
      { idsOrden: [idOrden], idsRequerimiento: [] },
      bd(),
    );
    // 🔴 Lo esencial: revisar no compra.
    expect(await cliente.ordenCompra.count()).toBe(0);

    expect(plan.proveedores).toHaveLength(1);
    const oc = plan.proveedores[0];
    expect(oc?.idProveedor).toBe(provBarato.id);
    expect(oc?.fechaEntrega).toBe('2026-09-30'); // la fecha de entrega de la OP
    expect(oc?.renglones[0]?.cantidadTotal).toBeCloseTo(180);
    expect(oc?.total).toBeCloseTo(360); // 180 × $2
    expect(oc?.ordenes).toEqual([1]); // el folio de la OP del fixture
    expect(plan.bloqueos).toEqual([]);
  });

  it('⭐ nombra lo que se va a OMITIR y por qué (antes se descartaba en silencio)', async () => {
    // 100 m de hilo en el kardex: el genérico queda cubierto y no genera compra (decisión d).
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
    await explosionarConRecetaFresca();
    const plan = await previoCompraDesdeExplosion(
      sesion(),
      { idsOrden: [idOrden], idsRequerimiento: [] },
      bd(),
    );
    const felpa = plan.omitidos.find((o) => o.material === 'Felpa');
    // La tela del fixture no tiene proveedor dueño: se omitía sin decirlo.
    expect(felpa?.motivo).toBe('sin-proveedor');
    expect(felpa?.detalle).toMatch(/No hay a quién comprarle/);
    const hilo = plan.omitidos.find((o) => o.material.includes('HIL-01'));
    expect(hilo?.motivo).toBe('cubierto-por-stock');
  });

  it('el previo DICE los bloqueos en vez de reventar (para eso es una revisión)', async () => {
    await cliente.direccionEntrega.updateMany({ data: { favorita: false } });
    await explosionarConRecetaFresca();
    const plan = await previoCompraDesdeExplosion(
      sesion(),
      { idsOrden: [idOrden], idsRequerimiento: [] },
      bd(),
    );
    expect(plan.bloqueos.join(' ')).toMatch(/favorita/);
    // …y generar con ese mismo bloqueo SÍ se rechaza, con la misma frase.
    await expect(
      generarOCDesdeExplosion(sesion(), { idsOrden: [idOrden], idsRequerimiento: [] }, bd()),
    ).rejects.toThrow(/favorita/);
    expect(await cliente.ordenCompra.count()).toBe(0);
  });

  it('A4 — sin `compras.administrar` la revisión previa se rechaza (§Post-F9.68)', async () => {
    await expect(
      previoCompraDesdeExplosion(
        sesion(['compras.ver']),
        { idsOrden: [idOrden], idsRequerimiento: [] },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });
});

/**
 * ⭐⭐ **V1-E3q (§Post-F9.86) — UNA OC PARA VARIAS OP.** Daniel: *"¿cómo hacemos cuando una OC cubre
 * varias OP? Es muy muy común hacerlo. Normalmente compramos varias OP con una sola OC"*, con su
 * condición innegociable: **se ve junto, se guarda repartido**.
 */
describe('V1-E3q — una compra para VARIAS OP (§Post-F9.86)', () => {
  let idOrdenB: number;
  let idPedido: number;

  /**
   * Una orden EXTRA del mismo modelo y pedido, con las piezas que se le pidan (la demanda de botón
   * es `piezas × 6`). Se parametriza para poder armar bases IGUALES o DESIGUALES a voluntad: son
   * dos casos distintos del reparto y confundirlos fue justo lo que dejó pasar el defecto.
   */
  async function ordenExtra(folio: bigint, piezas: number): Promise<number> {
    const linea = await cliente.pedidoLinea.findFirstOrThrow({ where: { idPedido } });
    const orden = await cliente.orden.create({
      data: {
        folio,
        idEmpresa: empresa.id,
        idModelo: modelo.id,
        idCliente: clienteNegocioId,
        idPedidoLinea: linea.id,
        estado: 'completa',
        fechaCompletada: new Date(),
        fechaEntrega: new Date('2026-10-31T00:00:00.000Z'),
        lineas: {
          create: [
            {
              idColor: colorRojo.id,
              tallas: { create: [{ idTalla: tallaM.id, cantidad: piezas }] },
            },
          ],
        },
      },
    });
    await sembrarRecetaDeOrden(cliente, orden.id, modelo.id);
    return orden.id;
  }

  /** Entrada de HILO (el genérico) al kardex, con la misma forma que usa el resto del archivo. */
  async function entradaDeHilo(cantidad: number) {
    return {
      idAlmacen: almacen.id,
      fecha: '2026-06-21',
      idTipoMov: (
        await cliente.tipoMovimientoInventario.findUniqueOrThrow({
          where: { codigo: 'ajuste-entrada' },
        })
      ).id,
      lineas: [{ idAvio: avioHilo.id, cantidad }],
      motivo: 'conteo inicial',
    };
  }

  /** Crea una SEGUNDA orden (20 piezas) del mismo modelo, colgada del mismo pedido interno. */
  async function segundaOrden(): Promise<number> {
    const pedido = await cliente.pedido.create({
      data: {
        folio: 1515n,
        idEmpresa: empresa.id,
        idCliente: clienteNegocioId,
        lineas: { create: [{ idModelo: modelo.id, cantidadPedida: 20, precio: 100 }] },
      },
    });
    idPedido = pedido.id;
    const lineaPedido = await cliente.pedidoLinea.findFirstOrThrow({
      where: { idPedido: pedido.id },
      select: { id: true },
    });
    const orden = await cliente.orden.create({
      data: {
        folio: 2n,
        idEmpresa: empresa.id,
        idModelo: modelo.id,
        idCliente: clienteNegocioId,
        idPedidoLinea: lineaPedido.id,
        estado: 'completa',
        fechaCompletada: new Date(),
        // Entrega ANTES que la primera: la OC debe salir con la fecha MÁS PRÓXIMA.
        fechaEntrega: new Date('2026-09-15T00:00:00.000Z'),
        lineas: {
          create: [
            { idColor: colorRojo.id, tallas: { create: [{ idTalla: tallaM.id, cantidad: 20 }] } },
          ],
        },
      },
    });
    await sembrarRecetaDeOrden(cliente, orden.id, modelo.id);
    return orden.id;
  }

  beforeEach(async () => {
    idOrdenB = await segundaOrden();
    // La primera orden del fixture también cuelga del mismo pedido (para probar la precarga).
    const linea = await cliente.pedidoLinea.findFirstOrThrow({ where: { idPedido } });
    await cliente.orden.update({
      where: { id: idOrden },
      data: { idPedidoLinea: linea.id },
    });
  });

  it('⭐ explosiona las DOS OP juntas y AGRUPA las cantidades', async () => {
    const ex = await explosionarOrdenes(sesion(), [idOrden, idOrdenB], bd());
    expect(ex.ordenes.map((o) => o.folio)).toEqual([1, 2]);
    expect(ex.totalPiezas).toBe(50); // 30 + 20

    const boton = ex.grupos.flatMap((g) => g.renglones).find((r) => r.idAvio === avioBoton.id);
    // 6 pza × 50 piezas = 300, agrupadas en UN renglón de pantalla.
    expect(boton?.cantidadRequerida).toBeCloseTo(300);
    // …y REPARTIDAS por OP: 180 de la orden 1 y 120 de la 2 (§Post-F9.86, innegociable).
    expect(boton?.porOrden.map((l) => [l.folioOrden, l.cantidadPendiente])).toEqual([
      [1, 180],
      [2, 120],
    ]);
  });

  it('⭐ la OC creada lleva UNA LÍNEA POR OP (se ve junto, se guarda repartido)', async () => {
    await explosionarOrdenes(sesion(), [idOrden, idOrdenB], bd());
    const gen = await generarOCDesdeExplosion(
      sesion(),
      { idsOrden: [idOrden, idOrdenB], idsRequerimiento: [] },
      bd(),
    );
    expect(gen.ordenesCompra).toHaveLength(1);
    const oc = await obtenerOC(sesion(), gen.ordenesCompra[0]?.idOrdenCompra ?? 0, bd());

    const lineasBoton = oc.lineas.filter((l) => l.idAvio === avioBoton.id);
    // 🔴 DOS líneas, una por OP. Con una sola línea de 300 el "qué falta" de cada OP dejaría de
    // cuadrar y el costo no caería donde debe — que es lo que Daniel puso como innegociable.
    expect(lineasBoton).toHaveLength(2);
    const porOrden = new Map(lineasBoton.map((l) => [l.idOrden, Number(l.cantidad)]));
    expect(porOrden.get(idOrden)).toBeCloseTo(180);
    expect(porOrden.get(idOrdenB)).toBeCloseTo(120);
    // Y la liga N:N del encabezado nombra a las dos OP.
    expect(oc.ordenesLigadas.map((o) => o.idOrden).sort((a, b) => a - b)).toEqual(
      [idOrden, idOrdenB].sort((a, b) => a - b),
    );
  });

  it('la OC toma la fecha de entrega MÁS PRÓXIMA de sus OP (el material llega a tiempo)', async () => {
    await explosionarOrdenes(sesion(), [idOrden, idOrdenB], bd());
    const gen = await generarOCDesdeExplosion(
      sesion(),
      { idsOrden: [idOrden, idOrdenB], idsRequerimiento: [] },
      bd(),
    );
    const oc = await cliente.ordenCompra.findFirstOrThrow({
      where: { id: gen.ordenesCompra[0]?.idOrdenCompra ?? 0 },
      select: { fechaEntrega: true },
    });
    // 🔴 La 2026-09-15 (orden B), no la 2026-09-30 (orden A): tomar la más lejana llegaría tarde.
    expect(oc.fechaEntrega?.toISOString().slice(0, 10)).toBe('2026-09-15');
  });

  it('⭐ el SOBRANTE de compra se reparte entre las OP (el rollo completo, §Post-F9.86)', async () => {
    await explosionarOrdenes(sesion(), [idOrden, idOrdenB], bd());
    const gen = await generarOCDesdeExplosion(
      sesion(),
      {
        idsOrden: [idOrden, idOrdenB],
        idsRequerimiento: [],
        // Se pide la caja completa de 400 en vez de las 300 que salen del BOM.
        ajustes: [
          {
            tipo: 'avio',
            idMaterial: avioBoton.id,
            idProveedor: provBarato.id,
            cantidadTotal: 400,
          },
        ],
      },
      bd(),
    );
    const oc = await obtenerOC(sesion(), gen.ordenesCompra[0]?.idOrdenCompra ?? 0, bd());
    const porOrden = new Map(
      oc.lineas
        .filter((l) => l.idAvio === avioBoton.id)
        .map((l) => [l.idOrden, Number(l.cantidad)]),
    );
    // 400 en proporción 180:120 → 240 y 160. La suma es EXACTAMENTE lo que se compró.
    expect(porOrden.get(idOrden)).toBeCloseTo(240);
    expect(porOrden.get(idOrdenB)).toBeCloseTo(160);
    expect((porOrden.get(idOrden) ?? 0) + (porOrden.get(idOrdenB) ?? 0)).toBeCloseTo(400);
  });

  it('el stock de un GENÉRICO se reparte entre las OP del lote, no se cuenta dos veces', async () => {
    // 100 m de hilo en existencia; entre las dos OP hacen falta 100 (60 + 40): queda cubierto.
    await ajustarInventarioAvio(sesion(), await entradaDeHilo(100), bd());
    const ex = await explosionarOrdenes(sesion(), [idOrden, idOrdenB], bd());
    const hilo = ex.grupos.flatMap((g) => g.renglones).find((r) => r.idAvio === avioHilo.id);
    // 🔴 Si cada OP neteara contra los 100 completos, las dos saldrían "cubiertas" y el sistema
    // compraría de menos. Aquí la primera se lleva 60 y a la segunda le quedan 40: justo alcanza.
    expect(hilo?.cantidadRequerida).toBeCloseTo(100);
    expect(hilo?.existenciaStock).toBeCloseTo(100);
    expect(hilo?.cantidadAComprar).toBe(0);
  });

  it('con menos stock del necesario, la SEGUNDA OP es la que se queda corta (y compra)', async () => {
    // Sólo 70 m: la orden 1 (más vieja) se lleva 60 y a la orden 2 le quedan 10 de los 40 que pide.
    await ajustarInventarioAvio(sesion(), await entradaDeHilo(70), bd());
    const ex = await explosionarOrdenes(sesion(), [idOrden, idOrdenB], bd());
    const hilo = ex.grupos.flatMap((g) => g.renglones).find((r) => r.idAvio === avioHilo.id);
    expect(hilo?.cantidadAComprar).toBeCloseTo(30); // 100 requeridos − 70 en existencia
    const reparto = new Map(hilo?.porOrden.map((l) => [l.folioOrden, l.cantidadAComprar]));
    expect(reparto.get(1)).toBe(0); // la 1 se cubrió entera
    expect(reparto.get(2)).toBeCloseTo(30); // a la 2 le faltan 30
  });

  /**
   * ⚠️ NOTA para quien mute este código: **A9 se sostiene DOS veces a propósito** — el filtro por
   * empresa de `explosionarOrdenes`/`planearCompra` y, detrás, el de `exigirRecetaLiberada`. Quitar
   * UNO solo deja el 404 intacto (mutante equivalente, verificado el 20-ago); lo que esta prueba
   * cubre es la INVARIANTE, no una línea: con las dos guardas fuera se pone roja.
   */
  it('⭐ A9 — meter una OP de OTRA empresa responde 404 y no explota nada', async () => {
    const otra = await crearEmpresaPrueba(cliente, 'Otra SA');
    const ordenAjena = await cliente.orden.create({
      data: {
        folio: 1n,
        idEmpresa: otra.id,
        idModelo: modelo.id,
        idCliente: clienteNegocioId,
        estado: 'completa',
      },
    });
    await expect(
      explosionarOrdenes(sesion(), [idOrden, ordenAjena.id], bd()),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);
    // A2: ni siquiera se escribió el snapshot de la orden PROPIA.
    expect(await cliente.requerimientoOrden.count({ where: { idOrden } })).toBe(0);

    await expect(
      generarOCDesdeExplosion(
        sesion(),
        { idsOrden: [idOrden, ordenAjena.id], idsRequerimiento: [] },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);
    expect(await cliente.ordenCompra.count()).toBe(0);
  });

  it('⭐ la PRECARGA por pedido interno trae las OP hermanas (los avíos del 1515)', async () => {
    const salida = await ordenesDelPedidoDeOrden(sesion(), idOrden, bd());
    expect(salida.folioPedido).toBe(1515);
    expect(salida.ordenes.map((o) => o.folio).sort((a, b) => a - b)).toEqual([1, 2]);
    expect(salida.ordenes.every((o) => !o.cancelada)).toBe(true);
  });

  it('una OP CANCELADA del pedido se lista pero sale MARCADA (para no precargarla)', async () => {
    await cliente.orden.update({ where: { id: idOrdenB }, data: { estado: 'cancelada' } });
    const salida = await ordenesDelPedidoDeOrden(sesion(), idOrden, bd());
    expect(salida.ordenes.find((o) => o.idOrden === idOrdenB)?.cancelada).toBe(true);
  });

  it('una orden SIN pedido interno (histórico migrado) devuelve sólo la propia, sin mentir', async () => {
    await cliente.orden.update({ where: { id: idOrdenB }, data: { idPedidoLinea: null } });
    const salida = await ordenesDelPedidoDeOrden(sesion(), idOrdenB, bd());
    expect(salida.idPedido).toBeNull();
    expect(salida.ordenes.map((o) => o.idOrden)).toEqual([idOrdenB]);
  });

  /**
   * 🔴 **Σ(LÍNEAS GUARDADAS) == LO COMPRADO, EXACTO** — el tercer síntoma del rechazo. La suma se
   * pide a Postgres (`SUM` sobre la columna `numeric`), no a JavaScript: es la única manera de
   * afirmar sobre lo que de verdad quedó escrito, y no sobre lo que el dominio creyó escribir.
   *
   * Antes, 100 entre tres OP IGUALES guardaba `[33.33, 33.33, 33.33]` = **99.99** y la OC totalizaba
   * `199.98` cuando la previa había prometido `200.00`.
   */
  it('⭐ Σ de las líneas GUARDADAS es exactamente el total comprado (bases iguales)', async () => {
    // Tres OP con la MISMA demanda (180 botones cada una): el caso que no divide exacto entre 100.
    const idC = await ordenExtra(3n, 30);
    const idD = await ordenExtra(4n, 30);
    await explosionarOrdenes(sesion(), [idOrden, idC, idD], bd());
    const gen = await generarOCDesdeExplosion(
      sesion(),
      {
        idsOrden: [idOrden, idC, idD],
        idsRequerimiento: [],
        ajustes: [
          {
            tipo: 'avio',
            idMaterial: avioBoton.id,
            idProveedor: provBarato.id,
            cantidadTotal: 100,
          },
        ],
      },
      bd(),
    );
    const idOc = gen.ordenesCompra[0]?.idOrdenCompra ?? 0;
    const filas = await cliente.$queryRaw<{ suma: number }[]>`
      SELECT COALESCE(SUM(cantidad), 0)::float8 AS suma
      FROM orden_compra_linea
      WHERE id_orden_compra = ${idOc} AND id_avio = ${avioBoton.id}
    `;
    const suma = filas[0]?.suma ?? -1;
    // 🔴 Con el reparto a 4 decimales esto daba 99.99.
    expect(suma).toBe(100);

    const oc = await obtenerOC(sesion(), idOc, bd());
    const cantidades = oc.lineas
      .filter((l) => l.idAvio === avioBoton.id)
      .map((l) => Number(l.cantidad))
      .sort((a, b) => a - b);
    expect(cantidades).toEqual([33.33, 33.33, 33.34]);
  });

  it('⭐ con bases DESIGUALES y un total feo, Σ también cierra exacto', async () => {
    // Bases 180 / 120 / 60 (Σ 360): un total de 1000 da 500 / 333.33 / 166.67.
    const idC = await ordenExtra(3n, 10);
    await explosionarOrdenes(sesion(), [idOrden, idOrdenB, idC], bd());
    const gen = await generarOCDesdeExplosion(
      sesion(),
      {
        idsOrden: [idOrden, idOrdenB, idC],
        idsRequerimiento: [],
        ajustes: [
          {
            tipo: 'avio',
            idMaterial: avioBoton.id,
            idProveedor: provBarato.id,
            cantidadTotal: 1000,
          },
        ],
      },
      bd(),
    );
    const idOc = gen.ordenesCompra[0]?.idOrdenCompra ?? 0;
    const filas = await cliente.$queryRaw<{ suma: number }[]>`
      SELECT COALESCE(SUM(cantidad), 0)::float8 AS suma
      FROM orden_compra_linea
      WHERE id_orden_compra = ${idOc} AND id_avio = ${avioBoton.id}
    `;
    const suma = filas[0]?.suma ?? -1;
    expect(suma).toBe(1000);
    const oc = await obtenerOC(sesion(), idOc, bd());
    const cantidades = oc.lineas
      .filter((l) => l.idAvio === avioBoton.id)
      .map((l) => Number(l.cantidad))
      .sort((a, b) => a - b);
    // 🔴 A 4 decimales esto era [166.6667, 333.3333, 500] y la suma no cerraba al guardarse.
    expect(cantidades).toEqual([166.67, 333.33, 500]);
  });

  /**
   * 🔴 **LA PREVIA PROMETE EXACTAMENTE LO QUE SE GUARDA.** Es el corazón de §Post-F9.85: una
   * revisión previa que no coincide con el documento es peor que no tenerla. Se compara renglón por
   * renglón y el TOTAL contra lo que quedó en la BD.
   */
  it('⭐ lo que la revisión previa promete es lo que la OC guarda (cantidades e importe)', async () => {
    const idC = await ordenExtra(3n, 30);
    const cuerpo = {
      idsOrden: [idOrden, idOrdenB, idC],
      idsRequerimiento: [],
      ajustes: [
        {
          tipo: 'avio' as const,
          idMaterial: avioBoton.id,
          idProveedor: provBarato.id,
          cantidadTotal: 100,
        },
      ],
    };
    await explosionarOrdenes(sesion(), cuerpo.idsOrden, bd());
    const plan = await previoCompraDesdeExplosion(sesion(), cuerpo, bd());
    const prometido = plan.proveedores.find((p) => p.idProveedor === provBarato.id);
    const renglonPrometido = prometido?.renglones.find((r) => r.idMaterial === avioBoton.id);
    expect(renglonPrometido?.cantidadTotal).toBe(100);

    const gen = await generarOCDesdeExplosion(sesion(), cuerpo, bd());
    const oc = await obtenerOC(sesion(), gen.ordenesCompra[0]?.idOrdenCompra ?? 0, bd());
    // Cada reparto prometido existe tal cual como línea.
    for (const l of renglonPrometido?.porOrden ?? []) {
      const linea = oc.lineas.find((x) => x.idOrden === l.idOrden && x.idAvio === avioBoton.id);
      expect(Number(linea?.cantidad)).toBe(l.cantidad);
    }
    // 🔴 Y el total: la previa decía 200.00 mientras la OC guardaba 199.98.
    expect(oc.total).toBeCloseTo(prometido?.total ?? -1, 2);
  });

  // ── ⭐⭐ V1-E3z (§Post-F9.94) — EL PRECIO SE CORRIGE EN LA PREVIA ────────────────────────────────
  //
  // Daniel, 23-ago-2026: *"al final puedo modificar precio o cantidad antes de generar la OC. **No
  // me deja modificar nada**"*. El canal de la cantidad ya existía; el del precio nació aquí.

  it('⭐⭐ el precio que fija el comprador es el que promete la previa Y el que guarda la OC', async () => {
    const cuerpo = {
      idsOrden: [idOrden],
      idsRequerimiento: [],
      ajustes: [
        {
          tipo: 'avio' as const,
          idMaterial: avioBoton.id,
          idProveedor: provBarato.id,
          precioUnitario: 7.25,
        },
      ],
    };
    await explosionarOrdenes(sesion(), cuerpo.idsOrden, bd());
    const plan = await previoCompraDesdeExplosion(sesion(), cuerpo, bd());
    const renglon = plan.proveedores
      .find((p) => p.idProveedor === provBarato.id)
      ?.renglones.find((r) => r.idMaterial === avioBoton.id);
    expect(renglon?.precioUnitario).toBe(7.25);
    expect(renglon?.precioAjustado).toBe(true);
    // Y el reparto por OP nace con ESE precio, no con el que resolvió la cascada.
    expect(renglon?.porOrden.every((l) => l.precio === 7.25)).toBe(true);

    const gen = await generarOCDesdeExplosion(sesion(), cuerpo, bd());
    // Se busca la OC POR PROVEEDOR y no `[0]`: si algún día el fixture generara más de una, tomar
    // la primera probaría otra cosa sin decirlo.
    const idOc = gen.ordenesCompra.find((o) => o.idProveedor === provBarato.id)?.idOrdenCompra ?? 0;
    const oc = await obtenerOC(sesion(), idOc, bd());
    const linea = oc.lineas.find((l) => l.idAvio === avioBoton.id);
    expect(Number(linea?.precio)).toBe(7.25);
  });

  /**
   * 🔴 **CORREGIR EL PRECIO AQUÍ NO ES EDITAR EL CATÁLOGO** (§Post-F9.88: la vía rápida no puede
   * volverse una puerta trasera para el catálogo). El precio corregido vive en la línea de OC y
   * nada más — y no hace falta que viva en otro lado: el costeo lee el último precio de la OC
   * AUTORIZADA (§Post-F9.48), así que se propaga solo cuando la OC se autoriza.
   */
  it('🔴 el precio corregido NO toca el catálogo del proveedor', async () => {
    const antes = await cliente.avioProveedor.findFirst({
      where: { idAvio: avioBoton.id, idProveedor: provBarato.id },
      select: { precio: true },
    });
    await explosionarOrdenes(sesion(), [idOrden], bd());
    await generarOCDesdeExplosion(
      sesion(),
      {
        idsOrden: [idOrden],
        idsRequerimiento: [],
        ajustes: [
          {
            tipo: 'avio',
            idMaterial: avioBoton.id,
            idProveedor: provBarato.id,
            precioUnitario: 99.99,
          },
        ],
      },
      bd(),
    );
    const despues = await cliente.avioProveedor.findFirst({
      where: { idAvio: avioBoton.id, idProveedor: provBarato.id },
      select: { precio: true },
    });
    expect(String(despues?.precio)).toBe(String(antes?.precio));
  });

  /**
   * ⭐ **Y SIN EMBARGO SE PROPAGA — por el camino bueno.** Es la respuesta a la pregunta que Daniel
   * dejó abierta (*"¿el precio cambiado se recuerda para la próxima compra?"*): no hizo falta
   * construir nada. En cuanto la OC se AUTORIZA, ese precio ES el último precio de compra de ese
   * material a ese proveedor (§Post-F9.48), que es de donde come todo el costeo.
   */
  it('⭐ al AUTORIZAR la OC, el precio corregido se vuelve el "último precio de compra"', async () => {
    await explosionarOrdenes(sesion(), [idOrden], bd());
    const gen = await generarOCDesdeExplosion(
      sesion(),
      {
        idsOrden: [idOrden],
        idsRequerimiento: [],
        ajustes: [
          {
            tipo: 'avio',
            idMaterial: avioBoton.id,
            idProveedor: provBarato.id,
            precioUnitario: 7.25,
          },
        ],
      },
      bd(),
    );
    await autorizarOC(
      sesion(),
      gen.ordenesCompra.find((o) => o.idProveedor === provBarato.id)?.idOrdenCompra ?? 0,
      bd(),
    );

    const ultimos = await leerUltimosPreciosCompra(cliente, empresa.id, {
      avios: [avioBoton.id],
    });
    const clave = claveMaterialProveedor('avio', avioBoton.id, provBarato.id);
    expect(ultimos.porMaterialProveedor.get(clave)?.precio).toBe(7.25);
  });

  it('🔴 un precio que se guardaría como 0.00 BLOQUEA: la previa lo dice y la generación se niega', async () => {
    const cuerpo = {
      idsOrden: [idOrden],
      idsRequerimiento: [],
      ajustes: [
        {
          tipo: 'avio' as const,
          idMaterial: avioBoton.id,
          idProveedor: provBarato.id,
          precioUnitario: 0.004,
        },
      ],
    };
    await explosionarOrdenes(sesion(), cuerpo.idsOrden, bd());
    // La previa DEVUELVE el bloqueo (no revienta): tiene que poder enseñar qué falta.
    const plan = await previoCompraDesdeExplosion(sesion(), cuerpo, bd());
    expect(plan.bloqueos.join(' ')).toContain('0.004');
    // Y la generación lo convierte en rechazo, con la MISMA frase.
    await expect(generarOCDesdeExplosion(sesion(), cuerpo, bd())).rejects.toThrow(/0\.004/);
  });

  /**
   * 🔴 **UN BLOQUEO NO PUEDE DESAPARECER EL RENGLÓN QUE NOMBRA.** Desde V1-E3z la cantidad se
   * teclea EN la previa, así que si el renglón se esfumara al bloquearse, el comprador se quedaría
   * con un mensaje que nombra un material que ya no ve — y sin campo donde corregirlo. Enseñarlo no
   * promete nada: con bloqueos, la generación no escribe ni una línea.
   */
  it('🔴 el renglón bloqueado por su cantidad SIGUE en la previa (para poder corregirlo ahí)', async () => {
    const cuerpo = {
      idsOrden: [idOrden],
      idsRequerimiento: [],
      ajustes: [
        {
          tipo: 'avio' as const,
          idMaterial: avioBoton.id,
          idProveedor: provBarato.id,
          cantidadTotal: 0.004,
        },
      ],
    };
    await explosionarOrdenes(sesion(), cuerpo.idsOrden, bd());
    const plan = await previoCompraDesdeExplosion(sesion(), cuerpo, bd());
    expect(plan.bloqueos.join(' ')).toContain('0.004');
    const renglon = plan.proveedores
      .find((p) => p.idProveedor === provBarato.id)
      ?.renglones.find((r) => r.idMaterial === avioBoton.id);
    expect(renglon).toBeDefined();
    // Y sus líneas salen marcadas como que NO se van a escribir.
    expect(renglon?.porOrden.every((l) => l.seEscribe)).toBe(false);
  });

  it('el neteo contra OC es POR OP: comprar para una NO tapa a la otra', async () => {
    await explosionarOrdenes(sesion(), [idOrden, idOrdenB], bd());
    // Se compra SÓLO lo de la orden A.
    await generarOCDesdeExplosion(sesion(), { idsOrden: [idOrden], idsRequerimiento: [] }, bd());

    const ex = await explosionarOrdenes(sesion(), [idOrden, idOrdenB], bd());
    const boton = ex.grupos.flatMap((g) => g.renglones).find((r) => r.idAvio === avioBoton.id);
    const reparto = new Map(boton?.porOrden.map((l) => [l.folioOrden, l.cantidadPendiente]));
    // 🔴 La A queda en 0 y la B sigue debiendo sus 120: si el neteo no fuera por OP, o taparía a
    // las dos (compra de menos) o a ninguna (compra duplicada).
    expect(reparto.get(1)).toBe(0);
    expect(reparto.get(2)).toBeCloseTo(120);
  });

  /**
   * 🔴 La MITAD que faltaba de la prueba de arriba: que el reparto de la SEGUNDA compra se calcule
   * sobre lo PENDIENTE de cada OP y no sobre su demanda bruta. Es un error fácil de cometer —los
   * dos números viven en el mismo renglón— y silencioso: repartir 120 en proporción 180:120 le
   * pondría 72 a la orden A, que ya estaba surtida, y sólo 48 a la B, que necesita 120. La OC se
   * vería "correcta" (suma 120) y la orden B se quedaría sin botones en producción.
   */
  it('⭐ la SEGUNDA compra reparte sobre lo PENDIENTE, no sobre la demanda bruta', async () => {
    await explosionarOrdenes(sesion(), [idOrden, idOrdenB], bd());
    // ⚠️ Compra PARCIAL de la orden A: 100 de sus 180. Es el caso que de verdad separa las dos
    // maneras de repartir — con la A completamente surtida, su renglón ni siquiera entra al plan y
    // usar una base u otra daría lo mismo (por ahí se coló un mutante VIVO en la primera vuelta).
    await generarOCDesdeExplosion(
      sesion(),
      {
        idsOrden: [idOrden],
        idsRequerimiento: [],
        ajustes: [
          {
            tipo: 'avio',
            idMaterial: avioBoton.id,
            idProveedor: provBarato.id,
            cantidadTotal: 100,
          },
        ],
      },
      bd(),
    );
    await explosionarOrdenes(sesion(), [idOrden, idOrdenB], bd());

    const gen = await generarOCDesdeExplosion(
      sesion(),
      { idsOrden: [idOrden, idOrdenB], idsRequerimiento: [] },
      bd(),
    );
    const oc = await obtenerOC(sesion(), gen.ordenesCompra[0]?.idOrdenCompra ?? 0, bd());
    const porOrden = new Map(
      oc.lineas
        .filter((l) => l.idAvio === avioBoton.id)
        .map((l) => [l.idOrden, Number(l.cantidad)]),
    );
    // 🔴 A le faltan 80 (180 − 100) y a B sus 120. Repartir los 200 en proporción a la DEMANDA
    // BRUTA (180:120) daría 120 y 80: le compraría de MÁS a la orden ya surtida y dejaría a la B
    // corta 40 piezas — una OC que suma bien y surte mal.
    expect(porOrden.get(idOrden)).toBeCloseTo(80);
    expect(porOrden.get(idOrdenB)).toBeCloseTo(120);
  });
});

/**
 * 🔴 **V1-E3q — LA PRECISIÓN: el snapshot guarda 4 decimales y la línea de OC sólo 2.**
 *
 * Rechazo del reviewer (21-ago-2026). La primera versión repartía y comparaba a **4** decimales
 * mientras `OrdenCompraLinea.cantidad` es `Decimal(14,2)`, y de ahí salieron tres defectos MEDIDOS:
 * el renglón reaparecía con una astilla de `0.002`, se encadenaban OC con líneas en `0.00`
 * quemando folios (A3), y `Σ(líneas guardadas) ≠ lo comprado`, con lo que **la revisión previa
 * mentía** — justo lo que §Post-F9.85 vino a impedir.
 *
 * ⚠️ **Por qué la batería anterior no lo cazaba:** todas sus cantidades (180, 100, 80, 300, 400,
 * 120) caen exactas en 2 decimales, así que el viaje de ida y vuelta por la BD no perdía nada. **El
 * fixture no podía expresar el fallo.** Estas pruebas usan cantidades que sí lo expresan.
 */
describe('V1-E3q — la escala manda desde el DESTINO (Decimal(14,2))', () => {
  /** Pone un consumo con 4 decimales (legal en el BOM) y re-copia la receta de la orden. */
  async function consumoDeBotonCon4Decimales(consumo: number): Promise<void> {
    await cliente.modeloAvio.updateMany({
      where: { idModelo: modelo.id, idAvio: avioBoton.id },
      data: { consumoPorPrenda: consumo },
    });
    await cliente.ordenTela.deleteMany({ where: { idOrden } });
    await cliente.ordenAvio.deleteMany({ where: { idOrden } });
    await cliente.ordenArte.deleteMany({ where: { idOrden } });
    await sembrarRecetaDeOrden(cliente, idOrden, modelo.id);
  }

  /** El renglón del BOTÓN dentro de una explosión. */
  function boton(ex: Awaited<ReturnType<typeof explosionarOrden>>) {
    return ex.grupos.flatMap((g) => g.renglones).find((r) => r.idAvio === avioBoton.id);
  }

  it('🔴 tras comprar, el renglón NO reaparece: lo pendiente queda en CERO exacto', async () => {
    // 0.1234 pza/prenda × 30 piezas = 3.7020 → la línea de OC guarda 3.70.
    await consumoDeBotonCon4Decimales(0.1234);
    const ex1 = await explosionarOrdenes(sesion(), [idOrden], bd());
    expect(boton(ex1)?.cantidadAComprar).toBeCloseTo(3.702, 4);
    // Lo PENDIENTE ya viene en la escala en la que se puede comprar (3.70, no 3.7020).
    expect(boton(ex1)?.cantidadPendiente).toBe(3.7);

    await generarOCDesdeExplosion(sesion(), { idsOrden: [idOrden], idsRequerimiento: [] }, bd());

    const ex2 = await explosionarOrdenes(sesion(), [idOrden], bd());
    expect(boton(ex2)?.cantidadEnOc).toBe(3.7);
    // 🔴 Con la escala en 4 esto valía 0.0019999999999997797 y el renglón volvía a salir comprable.
    expect(boton(ex2)?.cantidadPendiente).toBe(0);
  });

  it('🔴 volver a generar NO crea OC basura ni quema folios (la cadena infinita)', async () => {
    await consumoDeBotonCon4Decimales(0.1234);
    await explosionarOrdenes(sesion(), [idOrden], bd());
    await generarOCDesdeExplosion(sesion(), { idsOrden: [idOrden], idsRequerimiento: [] }, bd());
    const ocsTrasLaPrimera = await cliente.ordenCompra.count();

    for (let i = 0; i < 3; i += 1) {
      await explosionarOrdenes(sesion(), [idOrden], bd());
      const g = await generarOCDesdeExplosion(
        sesion(),
        { idsOrden: [idOrden], idsRequerimiento: [] },
        bd(),
      );
      // Nada que comprar, y se DICE por qué (no se calla, D3).
      expect(g.ordenesCompra).toHaveLength(0);
      expect(g.omitidos.find((o) => o.material.includes('BOT-01'))?.motivo).toBe('ya-en-oc');
    }

    // 🔴 Antes: 4 líneas [3.7, 0, 0, 0] y 3 folios quemados en documentos vacíos.
    const lineas = await cliente.ordenCompraLinea.findMany({
      where: { idAvio: avioBoton.id },
      select: { cantidad: true },
    });
    expect(lineas.map((l) => Number(l.cantidad))).toEqual([3.7]);
    expect(await cliente.ordenCompra.count()).toBe(ocsTrasLaPrimera);
  });

  /**
   * ⭐ **EL MISMO HUECO, EN EL PRECIO.** `OrdenCompraLinea.precio` es `Decimal(12,2)`, pero el precio
   * sugerido sale de `precio ÷ factorConversion` (R1) y eso produce colas larguísimas: 100 ÷ 3 =
   * 33.333333… Si la previa calcula el importe con el precio LARGO y la OC guarda el corto, **el
   * total prometido no es el que queda escrito** — la misma mentira de §Post-F9.85, en dinero.
   */
  it('⭐ con un precio de cola larga (100 ÷ 3), el total de la previa es el que la OC guarda', async () => {
    // 100 ÷ 3 = 33.333333… por unidad de consumo (R1). El otro proveedor se encarece para que el
    // elegido sea justo el del precio de cola larga (si no, el "más barato" se lo lleva y la prueba
    // no probaría nada — pasó en la primera escritura de este caso).
    await cliente.avioProveedor.updateMany({
      where: { idAvio: avioBoton.id, idProveedor: provBarato.id },
      data: { precio: 100, factorConversion: 3 },
    });
    await cliente.avioProveedor.updateMany({
      where: { idAvio: avioBoton.id, idProveedor: provCaro.id },
      data: { precio: 999, factorConversion: null },
    });
    await explosionarConRecetaFresca();
    const cuerpo = { idsOrden: [idOrden], idsRequerimiento: [] };
    const plan = await previoCompraDesdeExplosion(sesion(), cuerpo, bd());
    const prometido = plan.proveedores.find((p) => p.idProveedor === provBarato.id);
    expect(prometido).toBeDefined();

    const gen = await generarOCDesdeExplosion(sesion(), cuerpo, bd());
    const oc = await obtenerOC(sesion(), gen.ordenesCompra[0]?.idOrdenCompra ?? 0, bd());
    // 🔴 Lo que la revisión previa promete tiene que ser lo que el documento dice, al centavo.
    expect(oc.total).toBe(prometido?.total);
    expect(plan.totalGeneral).toBe(gen.ordenesCompra.reduce((s, o) => s + o.total, 0));
  });

  /**
   * ⭐ Y el IMPORTE se calcula con **la misma regla que la orden de compra** (`redondear2(cantidad ×
   * precio)`, la de `aCompraSalida`). Sin eso, el polvo de coma flotante separa los dos totales:
   * `0.6 × 12.35 = 7.409999999999999` en JavaScript, y la OC guarda `7.41`.
   */
  it('⭐ el importe de la previa usa la regla de la OC (0.6 × 12.35 no deja polvo)', async () => {
    await cliente.avioProveedor.updateMany({
      where: { idAvio: avioBoton.id, idProveedor: provBarato.id },
      data: { precio: 12.35, factorConversion: null },
    });
    await cliente.avioProveedor.updateMany({
      where: { idAvio: avioBoton.id, idProveedor: provCaro.id },
      data: { precio: 999, factorConversion: null },
    });
    await explosionarConRecetaFresca();
    const cuerpo = {
      idsOrden: [idOrden],
      idsRequerimiento: [],
      ajustes: [
        {
          tipo: 'avio' as const,
          idMaterial: avioBoton.id,
          idProveedor: provBarato.id,
          cantidadTotal: 0.6,
        },
      ],
    };
    const plan = await previoCompraDesdeExplosion(sesion(), cuerpo, bd());
    const prometido = plan.proveedores.find((p) => p.idProveedor === provBarato.id);
    // 🔴 Sin `redondear2`, esto es 7.409999999999999 y el total prometido no cuadra con el guardado.
    expect(prometido?.renglones[0]?.porOrden[0]?.importe).toBe(7.41);

    const gen = await generarOCDesdeExplosion(sesion(), cuerpo, bd());
    const oc = await obtenerOC(sesion(), gen.ordenesCompra[0]?.idOrdenCompra ?? 0, bd());
    expect(oc.total).toBe(prometido?.total);
  });

  it('🔴 un ajuste más chico de lo que se puede guardar se RECHAZA (no nace una línea en 0.00)', async () => {
    await explosionarOrdenes(sesion(), [idOrden], bd());
    const cuerpo = {
      idsOrden: [idOrden],
      idsRequerimiento: [],
      ajustes: [
        {
          tipo: 'avio' as const,
          idMaterial: avioBoton.id,
          idProveedor: provBarato.id,
          cantidadTotal: 0.004,
        },
      ],
    };
    // La previa lo DICE (para eso es una revisión), y generar lo rechaza con la misma frase.
    const plan = await previoCompraDesdeExplosion(sesion(), cuerpo, bd());
    expect(plan.bloqueos.join(' ')).toMatch(/mínimo es 0\.01/);
    await expect(generarOCDesdeExplosion(sesion(), cuerpo, bd())).rejects.toThrow(
      /mínimo es 0\.01/,
    );
    expect(await cliente.ordenCompra.count()).toBe(0);
  });
});

/**
 * 🔴 **V1-E3q — LAS PROMESAS QUE NO TENÍAN QUIÉN LAS SOSTUVIERA** (hallazgos 1–4 del reviewer,
 * 21-ago-2026). Cada una de estas pruebas nació de un MUTANTE QUE SOBREVIVIÓ: código cuyo comentario
 * afirmaba algo que ninguna prueba comprobaba. Un comentario sin prueba es una promesa, no un hecho.
 */
describe('V1-E3q — defensas que antes no tenían prueba', () => {
  /**
   * Hallazgo 1 — **A9 dentro de `comprometidoEnOc`**. Su docstring promete *"todo se filtra por la
   * empresa activa (la OC y la orden de producción)"*, y quitar `idEmpresa` del `where` dejaba las
   * 84 pruebas en verde. Hoy no hay fuga porque `crearOC` valida la empresa de la OP ligada, pero
   * esa es una defensa AJENA: si mañana entra otra puerta que escriba `OrdenCompraLinea` (un ETL,
   * una migración), esto es lo único que impide que la compra de OTRA empresa netee la mía.
   *
   * La liga imposible se fabrica A MANO a propósito: es exactamente el estado que la guarda existe
   * para sobrevivir.
   */
  it('⭐ A9 — una OC de OTRA empresa ligada a mi orden NO netea mi compra', async () => {
    await explosionarConRecetaFresca();
    const requerimiento = await cliente.requerimientoOrden.findFirstOrThrow({
      where: { idOrden, idAvio: avioBoton.id },
      select: { cantidadAComprar: true },
    });
    expect(Number(requerimiento.cantidadAComprar)).toBeCloseTo(180);

    // Una OC de OTRA empresa cuya línea apunta a MI orden (estado que ninguna puerta del dominio
    // permite crear; se escribe directo porque es justo contra lo que la guarda protege).
    const otra = await crearEmpresaPrueba(cliente, 'Otra SA');
    const ocAjena = await cliente.ordenCompra.create({
      data: {
        numCompra: 1n,
        idEmpresa: otra.id,
        idProveedor: provBarato.id,
        estatus: 'autorizada',
        fecha: new Date('2026-08-01T00:00:00.000Z'),
      },
    });
    await cliente.ordenCompraLinea.create({
      data: {
        idOrdenCompra: ocAjena.id,
        idAvio: avioBoton.id,
        idOrden,
        cantidad: 180,
        precio: 2,
        unidad: 'pza',
      },
    });

    const ex = await explosionarOrdenes(sesion(), [idOrden], bd());
    const boton = ex.grupos.flatMap((g) => g.renglones).find((r) => r.idAvio === avioBoton.id);
    // 🔴 Sin el filtro por empresa, `enOc` sería 180 y mi orden se quedaría SIN COMPRAR su material.
    expect(boton?.cantidadEnOc).toBe(0);
    expect(boton?.cantidadPendiente).toBe(180);
  });

  /**
   * Hallazgo 2 — **`claveAgrupada`**. Su comentario dice explícito: *"si dos OP compran la misma
   * felpa a proveedores distintos… son DOS compras y no se pueden sumar"*. Sustituir el componente
   * de proveedor por una constante fundía las dos en un renglón con UN solo proveedor, y las 84
   * pruebas seguían verdes.
   */
  it('⭐ el mismo material a proveedores DISTINTOS son dos renglones, no uno', async () => {
    const idB = await cliente.orden
      .create({
        data: {
          folio: 9n,
          idEmpresa: empresa.id,
          idModelo: modelo.id,
          idCliente: clienteNegocioId,
          estado: 'completa',
          fechaCompletada: new Date(),
          fechaEntrega: new Date('2026-09-30T00:00:00.000Z'),
          lineas: {
            create: [
              { idColor: colorRojo.id, tallas: { create: [{ idTalla: tallaM.id, cantidad: 20 }] } },
            ],
          },
        },
      })
      .then(async (o) => {
        await sembrarRecetaDeOrden(cliente, o.id, modelo.id);
        return o.id;
      });

    // La FELPA es el ejemplo textual del comentario. Es tela SIN dueño en el catálogo, así que cada
    // orden puede llevar el proveedor que Compras le asigne (§Post-F9.82): la A al barato, la B al
    // caro. (El botón no sirve para este caso: tiene `AvioProveedor`, y el "más barato" gana sobre
    // la asignación de Compras — comprobado midiendo, no suponiendo.)
    await asignarProveedorDeMaterial(
      sesion(),
      idOrden,
      { tipo: 'tela', idMaterial: telaFelpa.id, idProveedor: provBarato.id, precio: 10 },
      bd(),
    );
    await asignarProveedorDeMaterial(
      sesion(),
      idB,
      { tipo: 'tela', idMaterial: telaFelpa.id, idProveedor: provCaro.id, precio: 12 },
      bd(),
    );

    const ex = await explosionarOrdenes(sesion(), [idOrden, idB], bd());
    const renglonesBoton = ex.grupos
      .flatMap((g) => g.renglones)
      .filter((r) => r.idTela === telaFelpa.id);
    // 🔴 Fundidos en uno, la compra saldría entera a UN proveedor: dinero al proveedor equivocado.
    expect(renglonesBoton).toHaveLength(2);
    expect(
      renglonesBoton.map((r) => r.idProveedorSugerido).sort((a, b) => (a ?? 0) - (b ?? 0)),
    ).toEqual([provBarato.id, provCaro.id].sort((a, b) => a - b));
    // Y cada renglón lleva UNA sola OP en su reparto (no se mezclaron).
    for (const r of renglonesBoton) {
      expect(r.porOrden).toHaveLength(1);
    }

    // …y la felpa acaba en DOS órdenes de compra distintas, una por proveedor.
    const gen = await generarOCDesdeExplosion(
      sesion(),
      { idsOrden: [idOrden, idB], idsRequerimiento: [] },
      bd(),
    );
    const proveedoresConFelpa = new Set<number>();
    for (const o of gen.ordenesCompra) {
      const oc = await obtenerOC(sesion(), o.idOrdenCompra, bd());
      if (oc.lineas.some((l) => l.idTela === telaFelpa.id)) proveedoresConFelpa.add(o.idProveedor);
    }
    expect([...proveedoresConFelpa].sort((a, b) => a - b)).toEqual(
      [provBarato.id, provCaro.id].sort((a, b) => a - b),
    );
  });

  /**
   * Hallazgo 3 — **el filtro anti-línea-cero**. Borrarlo dejaba las 84 verdes. Es la guarda que
   * debía haber parado la cadena de OC basura: un ajuste A LA BAJA reparte casi todo a una OP y deja
   * a las demás en `0.00`, y una línea de cero no es una compra (`crearOC` la rechazaría).
   */
  it('⭐ un ajuste A LA BAJA no escribe líneas en 0.00 para las OP que se quedan sin nada', async () => {
    const idB = await ordenExtraSimple(11n, 20);
    await explosionarOrdenes(sesion(), [idOrden, idB], bd());
    const gen = await generarOCDesdeExplosion(
      sesion(),
      {
        idsOrden: [idOrden, idB],
        idsRequerimiento: [],
        // 0.01 entre dos OP: a una le toca todo y a la otra 0.00.
        ajustes: [
          {
            tipo: 'avio',
            idMaterial: avioBoton.id,
            idProveedor: provBarato.id,
            cantidadTotal: 0.01,
          },
        ],
      },
      bd(),
    );
    const oc = await obtenerOC(sesion(), gen.ordenesCompra[0]?.idOrdenCompra ?? 0, bd());
    const lineas = oc.lineas.filter((l) => l.idAvio === avioBoton.id);
    // 🔴 Sin el filtro habría DOS líneas y una diría `0.00`.
    expect(lineas).toHaveLength(1);
    expect(Number(lineas[0]?.cantidad)).toBe(0.01);
  });

  /**
   * ⭐ V1-E3z — **LA OTRA MITAD DE LA PRUEBA DE ARRIBA, que faltaba (la señaló el reviewer):** que
   * la PREVIA **lo diga antes**, y **sin ningún bloqueo de por medio**. `0.01` es una cantidad
   * perfectamente válida (no dispara ningún bloqueo), así que éste es el camino en el que el plan
   * SÍ se va a ejecutar y una OP se queda fuera igualmente. Si la previa no lo marcara, prometería
   * una línea que la generación se salta — el defecto exacto que `seEscribe` vino a cerrar, y que
   * bajar el total DESDE la previa (§Post-F9.94) volvió un caso común.
   */
  it('⭐ la previa MARCA la línea que la generación va a saltarse (sin bloqueo de por medio)', async () => {
    const idB = await ordenExtraSimple(12n, 20);
    const cuerpo = {
      idsOrden: [idOrden, idB],
      idsRequerimiento: [],
      ajustes: [
        {
          tipo: 'avio' as const,
          idMaterial: avioBoton.id,
          idProveedor: provBarato.id,
          cantidadTotal: 0.01,
        },
      ],
    };
    await explosionarOrdenes(sesion(), cuerpo.idsOrden, bd());
    const plan = await previoCompraDesdeExplosion(sesion(), cuerpo, bd());
    // 🔴 Nada bloquea: 0.01 es guardable. El plan se va a EJECUTAR tal cual.
    expect(plan.bloqueos).toEqual([]);
    const renglon = plan.proveedores
      .find((p) => p.idProveedor === provBarato.id)
      ?.renglones.find((r) => r.idMaterial === avioBoton.id);
    // Dos OP en el reparto, pero sólo UNA se escribe.
    expect(renglon?.porOrden).toHaveLength(2);
    expect(renglon?.porOrden.filter((l) => l.seEscribe)).toHaveLength(1);
    // Y el importe del renglón NO cuenta la que no se escribe.
    expect(renglon?.importe).toBe(
      renglon?.porOrden.filter((l) => l.seEscribe).reduce((a, l) => a + l.importe, 0),
    );

    // Y la generación hace EXACTAMENTE eso: una línea, la que la previa marcó.
    const gen = await generarOCDesdeExplosion(sesion(), cuerpo, bd());
    const idOc = gen.ordenesCompra.find((o) => o.idProveedor === provBarato.id)?.idOrdenCompra ?? 0;
    const oc = await obtenerOC(sesion(), idOc, bd());
    const lineas = oc.lineas.filter((l) => l.idAvio === avioBoton.id);
    expect(lineas).toHaveLength(1);
    expect(lineas[0]?.idOrden).toBe(renglon?.porOrden.find((l) => l.seEscribe)?.idOrden);
  });

  /**
   * ⭐ El redondeo de `enOc` **hace falta de verdad**: es Σ de varias líneas, y sumar decimales en
   * coma flotante deja polvo (`0.1 + 0.2 = 0.30000000000000004`). Sin redondear, ese polvo viajaba
   * al contrato y la pantalla enseñaba "Ya en OC: 0.30000000000000004".
   */
  it('⭐ `cantidadEnOc` sale limpio aunque sume varias líneas (0.1 + 0.2 = 0.3, no 0.30000000000000004)', async () => {
    await explosionarConRecetaFresca();
    for (const cantidadTotal of [0.1, 0.2]) {
      await generarOCDesdeExplosion(
        sesion(),
        {
          idsOrden: [idOrden],
          idsRequerimiento: [],
          ajustes: [
            { tipo: 'avio', idMaterial: avioBoton.id, idProveedor: provBarato.id, cantidadTotal },
          ],
        },
        bd(),
      );
      await explosionarConRecetaFresca();
    }
    const ex = await explosionarOrdenes(sesion(), [idOrden], bd());
    const boton = ex.grupos.flatMap((g) => g.renglones).find((r) => r.idAvio === avioBoton.id);
    // 🔴 Sin redondear `enOc`, esto vale 0.30000000000000004.
    expect(boton?.cantidadEnOc).toBe(0.3);
    expect(boton?.porOrden[0]?.cantidadEnOc).toBe(0.3);
  });

  /**
   * 🔴 **LA PREVIA NO PUEDE INVENTAR UNA OC QUE NO EXISTE** (2ª vuelta del reviewer, 21-ago-2026).
   *
   * Como `cantidadPendiente` llega redondeado a 2 decimales, **todo `aComprar` entre `1e-6` y
   * `0.005` daba pendiente 0** y caía en la rama `'ya-en-oc'` aunque `enOc` fuera **0**. Al comprador
   * se le decía *"ya está en una orden de compra viva (0 pza)… si esa OC se cancela, vuelve a
   * aparecer aquí"*: se le mandaba a cancelar un documento **inexistente**, y la etapa se
   * contradecía a sí misma (el renglón de la explosión seguía marcado como faltante).
   *
   * §Post-F9.85 nació porque Daniel dejó de creerle a la pantalla (*"no sé si realmente se generó o
   * solo dice eso"*). **La lista de motivos sólo vale si cada motivo es verdad.**
   */
  it('⭐ un faltante por debajo del mínimo SIN ninguna OC detrás NO se reporta como "ya-en-oc"', async () => {
    // 0.0001 pza/prenda × 30 = 0.0030 → por debajo de 0.01, pero MAYOR que cero. Legal en el BOM
    // (`consumoPorPrenda Decimal(12,4)`), y sin una sola orden de compra en la base.
    await cliente.modeloAvio.updateMany({
      where: { idModelo: modelo.id, idAvio: avioBoton.id },
      data: { consumoPorPrenda: 0.0001 },
    });
    await explosionarConRecetaFresca();
    expect(await cliente.ordenCompra.count()).toBe(0);

    const plan = await previoCompraDesdeExplosion(
      sesion(),
      { idsOrden: [idOrden], idsRequerimiento: [] },
      bd(),
    );
    const omitido = plan.omitidos.find((o) => o.material.includes('BOT-01'));
    expect(omitido?.cantidadAComprar).toBeCloseTo(0.003, 4);
    expect(omitido?.cantidadEnOc).toBe(0);
    // 🔴 Aquí estaba la mentira: valía 'ya-en-oc'.
    expect(omitido?.motivo).toBe('menor-al-minimo');
    // Y la frase NO puede hablar de una OC que no existe.
    expect(omitido?.detalle).not.toMatch(/orden de compra viva|se cancela/);
    expect(omitido?.detalle).toMatch(/no puede pedir menos de 0\.01/);
  });

  /** El caso GEMELO: con una OC de verdad detrás, el motivo sigue siendo `ya-en-oc` (no se perdió). */
  it('⭐ …pero con una OC REAL detrás, sí dice "ya-en-oc" (la verdad útil no se pierde)', async () => {
    await cliente.modeloAvio.updateMany({
      where: { idModelo: modelo.id, idAvio: avioBoton.id },
      data: { consumoPorPrenda: 0.1234 },
    });
    await explosionarConRecetaFresca();
    await generarOCDesdeExplosion(sesion(), { idsOrden: [idOrden], idsRequerimiento: [] }, bd());
    await explosionarConRecetaFresca();

    const plan = await previoCompraDesdeExplosion(
      sesion(),
      { idsOrden: [idOrden], idsRequerimiento: [] },
      bd(),
    );
    const omitido = plan.omitidos.find((o) => o.material.includes('BOT-01'));
    expect(omitido?.motivo).toBe('ya-en-oc');
    expect(omitido?.cantidadEnOc).toBe(3.7);
    expect(omitido?.detalle).toMatch(/ya está en una orden de compra viva/);
  });

  /**
   * ⭐⭐ **EL CASO QUE DE VERDAD SEPARA LAS DOS OPCIONES DE DISEÑO** (3ª vuelta del reviewer).
   *
   * La ficha justificaba haber creado `menor-al-minimo` —en vez de *"mover el corte de guardabilidad
   * antes de la rama de `enOc`"*— con el ejemplo *"requerido 3.7020 contra una línea de 3.70"*. **Ese
   * ejemplo NO discrimina**: ahí `seGuardaComoAlgo(3.7020)` es `true`, así que la variante descartada
   * habría contestado `ya-en-oc` igual. La decisión era correcta y el ejemplo, el equivocado.
   *
   * El caso que sí las separa es **un requerido POR DEBAJO del mínimo que YA está cubierto por una
   * OC**: aquí el BOM se corrige a la baja DESPUÉS de haber comprado (0.1234 → 0.0001 por prenda),
   * así que quedan `0.003` requeridos contra una OC viva de `3.70`.
   *  • Lo construido → `ya-en-oc`: *"ya está comprado"*, que es la verdad útil.
   *  • *"Cortar antes"* → `menor-al-minimo`, **escondiendo que el material ya estaba comprado**.
   *
   * 🔴 Y la lección de segundo orden, que es la de toda la etapa: *una decisión correcta justificada
   * con un ejemplo que no la demuestra es una promesa sin respaldo* — la misma familia del comentario
   * que provocó el primer rechazo, sólo que en la ficha en vez de en el código.
   */
  it('⭐ un requerido por DEBAJO del mínimo pero YA cubierto por una OC dice "ya-en-oc", no "menor-al-minimo"', async () => {
    // 1) Se compra con el consumo original (0.1234 × 30 = 3.7020 → la OC guarda 3.70).
    await cliente.modeloAvio.updateMany({
      where: { idModelo: modelo.id, idAvio: avioBoton.id },
      data: { consumoPorPrenda: 0.1234 },
    });
    await explosionarConRecetaFresca();
    await generarOCDesdeExplosion(sesion(), { idsOrden: [idOrden], idsRequerimiento: [] }, bd());

    // 2) Desarrollo CORRIGE el consumo a la baja: ahora sólo hacen falta 0.003 — por debajo del
    //    mínimo pedible— pero el material YA está comprado.
    await cliente.modeloAvio.updateMany({
      where: { idModelo: modelo.id, idAvio: avioBoton.id },
      data: { consumoPorPrenda: 0.0001 },
    });
    await explosionarConRecetaFresca();

    const plan = await previoCompraDesdeExplosion(
      sesion(),
      { idsOrden: [idOrden], idsRequerimiento: [] },
      bd(),
    );
    const omitido = plan.omitidos.find((o) => o.material.includes('BOT-01'));
    // El requerido está por debajo del mínimo…
    expect(omitido?.cantidadAComprar).toBeCloseTo(0.003, 4);
    expect(seGuardaComoAlgo(omitido?.cantidadAComprar ?? 0)).toBe(false);
    // …y aun así hay una OC viva detrás, así que se dice ESO.
    expect(omitido?.cantidadEnOc).toBe(3.7);
    // 🔴 Con "cortar antes" (la variante descartada) esto valdría 'menor-al-minimo' y el comprador
    // no se enteraría de que el material ya está comprado.
    expect(omitido?.motivo).toBe('ya-en-oc');
    expect(omitido?.detalle).toMatch(/ya está en una orden de compra viva/);
  });

  /**
   * 🔴 **"UNA SOLA VERDAD" TIENE QUE SER LITERAL.** El redondeo de `enOc` vive en
   * `comprometidoEnOc` —la función que ES la verdad— y no en cada consumidor: redondearlo en dos de
   * los tres dejaba al tablero R7 crudo, y el docstring prometía que *"nunca dicen números
   * distintos"*.
   */
  it('⭐ la explosión, el plan y el tablero R7 dicen el MISMO `enOc`, al dígito', async () => {
    await explosionarConRecetaFresca();
    for (const cantidadTotal of [0.1, 0.2]) {
      await generarOCDesdeExplosion(
        sesion(),
        {
          idsOrden: [idOrden],
          idsRequerimiento: [],
          ajustes: [
            { tipo: 'avio', idMaterial: avioBoton.id, idProveedor: provBarato.id, cantidadTotal },
          ],
        },
        bd(),
      );
      await explosionarConRecetaFresca();
    }
    const ex = await explosionarOrdenes(sesion(), [idOrden], bd());
    const enExplosion = ex.grupos
      .flatMap((g) => g.renglones)
      .find((r) => r.idAvio === avioBoton.id)?.cantidadEnOc;
    const tablero = await estatusMaterialesOrden(sesion(), idOrden, bd());
    const enR7 = tablero.filas.find((f) => f.idAvio === avioBoton.id)?.enOc;

    // 🔴 Antes: explosión 0.3 y R7 0.30000000000000004. En pantalla no se veía; en el JSON sí iba.
    expect(enExplosion).toBe(0.3);
    expect(enR7).toBe(0.3);
    expect(enR7).toBe(enExplosion);
  });

  /**
   * ⭐ **LO RECIBIDO CONSERVA SUS CUATRO DECIMALES.** `enOc` se redondea a 2 porque sale de
   * `OrdenCompraLinea.cantidad Decimal(14,2)`; `recibido` **NO**, porque sale de
   * `RecepcionCompraLinea.cantidadRecibida Decimal(14,4)`. Recortarlo tiraría precisión REAL de lo
   * que de verdad entró al almacén — y en tela, donde nunca se recibe la cantidad exacta
   * (§Post-F9.19), esas milésimas son el dato.
   *
   * Sin esta prueba la afirmación del docstring era una promesa sin respaldo: redondear `recibido`
   * a 2 dejaba toda la batería en verde (lo cazó el mutador, no la revisión).
   */
  it('⭐ lo RECIBIDO no se recorta a 2 decimales (su columna tiene 4)', async () => {
    await explosionarConRecetaFresca();
    const gen = await generarOCDesdeExplosion(
      sesion(),
      { idsOrden: [idOrden], idsRequerimiento: [] },
      bd(),
    );
    const idOc = gen.ordenesCompra[0]?.idOrdenCompra ?? 0;
    await autorizarOC(sesion(), idOc, bd());
    const lineaOc = await cliente.ordenCompraLinea.findFirstOrThrow({
      where: { idOrdenCompra: idOc, idAvio: avioBoton.id },
    });
    // El proveedor entregó 90.1234 — cuatro decimales, que su columna sí puede guardar.
    await recibirCompra(
      sesion(),
      {
        idOrdenCompra: idOc,
        idAlmacen: almacen.id,
        fecha: '2026-06-21',
        lineas: [{ idOrdenCompraLinea: lineaOc.id, cantidad: 90.1234 }],
      },
      bd(),
    );

    const tablero = await estatusMaterialesOrden(sesion(), idOrden, bd());
    const fila = tablero.filas.find((f) => f.idAvio === avioBoton.id);
    // 🔴 Redondeando `recibido` a 2, esto valdría 90.12 y se perderían las milésimas reales.
    expect(fila?.recibido).toBe(90.1234);
    // …mientras que lo que está EN OC sí viene a 2 decimales (cada número a la escala de SU columna).
    expect(fila?.enOc).toBe(180);
  });

  /** Hallazgo 4 — la REVISIÓN PREVIA también es una puerta: una OP ajena responde 404 (A9). */
  it('⭐ A9 — la revisión previa de una OP de otra empresa responde 404', async () => {
    const otra = await crearEmpresaPrueba(cliente, 'Ajena SA');
    const sesionAjena = sesionDePrueba({ idEmpresaActiva: otra.id, permisos: PERM });
    await expect(
      previoCompraDesdeExplosion(sesionAjena, { idsOrden: [idOrden], idsRequerimiento: [] }, bd()),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);
  });
});

/** Orden simple del mismo modelo (sin pedido) con las piezas que se le pidan. */
async function ordenExtraSimple(folio: bigint, piezas: number): Promise<number> {
  const orden = await cliente.orden.create({
    data: {
      folio,
      idEmpresa: empresa.id,
      idModelo: modelo.id,
      idCliente: clienteNegocioId,
      estado: 'completa',
      fechaCompletada: new Date(),
      fechaEntrega: new Date('2026-09-30T00:00:00.000Z'),
      lineas: {
        create: [
          { idColor: colorRojo.id, tallas: { create: [{ idTalla: tallaM.id, cantidad: piezas }] } },
        ],
      },
    },
  });
  await sembrarRecetaDeOrden(cliente, orden.id, modelo.id);
  return orden.id;
}
