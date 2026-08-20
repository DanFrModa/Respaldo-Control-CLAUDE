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
import { ErrorNoEncontrado } from '../../comun/errores.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sembrarRecetaDeOrden } from '../../pruebas/receta.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import { ajustarInventarioAvio } from '../inventarios/avios.js';
import { autorizarOC, obtenerOC } from './ordenes-compra.js';
import { recibirCompra } from './recepciones.js';
import { estatusMaterialesOrden, explosionarOrden, generarOCDesdeExplosion } from './mrp.js';
import { asignarProveedorDeMaterial } from './proveedor-de-orden.js';

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
