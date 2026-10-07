/**
 * ⭐⭐ **fila 0.232 (§Post-F9.245(c)) — EL SOBRE-CORTE PIDE SU MATERIAL: LA SEGUNDA PASADA.**
 *
 * Integración contra Postgres (en CI con testcontainers). Daniel: *«casi siempre se compra ANTES de
 * cortar; cuando se corta ya deberían de estar los avíos con el maquilero»*. Lo que se fija aquí es
 * el ciclo entero de la segunda pasada —comprar la diferencia · recibirla · mandarla al taller—:
 *  1. OP de 100 con su OC comprada y recibida ⇒ corte de 120 ⇒ volver a explotar pide SÓLO el extra
 *     de avíos (20 × consumo) y la TELA no se mueve.
 *  2. Generar OC desde ahí: nace una OC NUEVA con el extra; la recibida queda intacta (§245(a)).
 *  3. Avío por talla y por medida (R18): el extra sólo en la talla (y la medida) sobre-cortada; el
 *     bajo-corte de otra talla no baja nada.
 *  4. Avío genérico con stock que cubre el extra ⇒ no compra.
 *  5. Corte cancelado ⇒ re-explotar ⇒ el extra desaparece del pendiente.
 *  6. Habilitación: con lo pedido ya enviado al taller, la FALTA es el extra y el estado no es
 *     «sobre-surtido».
 *  7. Costo real: el requerido escalado a lo cortado no se infla (no cuenta el extra dos veces).
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
import { sembrarRecetaDeOrden } from '../../pruebas/receta.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import { costoRealOrden } from '../costos/costo-real-compras.js';
import { ajustarInventarioAvio } from '../inventarios/avios.js';
import { fusionarColores } from '../catalogos/colores.js';
import { cancelarEtapaMovimiento, registrarCorte } from '../produccion/etapas.js';
import { habilitacionOrden } from '../produccion/habilitacion-orden.js';
import {
  corregirCapturaAvio,
  editarRenglonReceta,
  obtenerRecetaOrden,
  quitarRenglonReceta,
  restaurarRenglonReceta,
} from '../produccion/receta-orden.js';
import { autorizarOC, obtenerOC } from './ordenes-compra.js';
import { recibirCompra } from './recepciones.js';
import { explosionarOrden, generarOCDesdeExplosion, previoCompraDesdeExplosion } from './mrp.js';

let cliente: PrismaClient;
let empresa: Empresa;
let modelo: Modelo;
let telaFelpa: Tela;
let avioBoton: Avio; // 6 pza/prenda, NO genérico, proveedor $2
let avioHilo: Avio; // 2 m/prenda, GENÉRICO (de stock)
let proveedor: Proveedor;
let cortador: Proveedor;
let maquilero: Proveedor;
let colorRojo: Color;
let tallaCH: Talla;
let tallaM: Talla;
let almacen: Almacen;
let idOrden: number;
let idClienteNegocio: number;

const PERM: ClavePermiso[] = [
  'compras.ver',
  'compras.administrar',
  'compras.autorizar',
  'compras.recibir',
  'inventario-avios.ver',
  'inventario-avios.mover',
  'produccion.corte',
  'produccion.cancelar',
  'ordenes.habilitacion',
  'costos.ver',
  // 2ª vuelta: la receta de la orden (H5) y la fusión de colores (H3).
  'ordenes.ver',
  'desarrollo.ver',
  'desarrollo.administrar',
  'colores.administrar',
];

const sesion = (): SesionUsuario => sesionDePrueba({ idEmpresaActiva: empresa.id, permisos: PERM });
const bd = () => ({ cliente });

type Explosion = Awaited<ReturnType<typeof explosionarOrden>>;
const renglones = (ex: Explosion) => ex.grupos.flatMap((g) => g.renglones);
const delAvio = (ex: Explosion, idAvio: number) => renglones(ex).find((r) => r.idAvio === idAvio);
const deLaTela = (ex: Explosion, idTela: number) => renglones(ex).find((r) => r.idTela === idTela);

/** Corta en Rojo lo que se le diga por talla. Devuelve el id del corte. */
async function cortar(ch: number, m: number, idColor?: number): Promise<number> {
  const corte = await registrarCorte(
    sesion(),
    {
      idOrden,
      idCortador: cortador.id,
      fecha: '2026-09-01',
      lineas: [
        {
          idColor: idColor ?? colorRojo.id,
          tallas: [
            { idTalla: tallaCH.id, cantidad: ch },
            { idTalla: tallaM.id, cantidad: m },
          ].filter((t) => t.cantidad > 0),
        },
      ],
    },
    bd(),
  );
  return corte.id;
}

const explotar = (): Promise<Explosion> => explosionarOrden(sesion(), idOrden, bd());

/** Genera las OC de todo lo pendiente con proveedor. */
const comprar = () =>
  generarOCDesdeExplosion(
    sesion(),
    { fechaEntrega: '2026-09-30', idsOrden: [idOrden], idsRequerimiento: [] },
    bd(),
  );

/** Autoriza y RECIBE completa una OC (todas sus líneas). */
async function autorizarYRecibir(idOc: number): Promise<void> {
  await autorizarOC(sesion(), idOc, bd());
  const lineas = await cliente.ordenCompraLinea.findMany({ where: { idOrdenCompra: idOc } });
  await recibirCompra(
    sesion(),
    {
      idOrdenCompra: idOc,
      idAlmacen: almacen.id,
      fecha: '2026-08-20',
      lineas: lineas.map((l) => ({ idOrdenCompraLinea: l.id, cantidad: Number(l.cantidad) })),
    },
    bd(),
  );
}

/** Una nota de salida CONFIRMADA al maquilero, directa en BD (lo que la habilitación suma). */
async function notaConfirmada(idAvio: number, cantidad: number): Promise<void> {
  const previas = await cliente.notaSalida.count();
  await cliente.notaSalida.create({
    data: {
      numNota: BigInt(previas + 1),
      idEmpresa: empresa.id,
      idMaquilero: maquilero.id,
      idAlmacen: almacen.id,
      fechaElaboracion: new Date('2026-08-25T00:00:00.000Z'),
      estatus: 'confirmada',
      creadoPorId: 'usuario-prueba',
      modificadoPorId: 'usuario-prueba',
      lineas: {
        create: [
          {
            idOrden,
            idAvio,
            cantidad,
            unidad: 'pza',
            creadoPorId: 'usuario-prueba',
            modificadoPorId: 'usuario-prueba',
          },
        ],
      },
    },
  });
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
  idClienteNegocio = clienteNegocio.id;
  colorRojo = await cliente.color.create({ data: { nombre: 'Rojo' } });
  await cliente.direccionEntrega.create({
    data: { nombre: 'Naucalpan', direccion: 'Av. Siempre Viva 123', favorita: true },
  });
  tallaCH = await cliente.talla.create({ data: { etiqueta: 'CH', orden: 1 } });
  tallaM = await cliente.talla.create({ data: { etiqueta: 'M', orden: 2 } });
  almacen = await cliente.almacen.create({ data: { nombre: 'Bodega', tipo: 'AVIO' } });
  proveedor = await cliente.proveedor.create({ data: { nombre: 'Avíos del Centro' } });
  maquilero = await cliente.proveedor.create({ data: { nombre: 'Maquila del Sur' } });
  const rolCorte = await cliente.rolProveedor.upsert({
    where: { codigo: 'corte' },
    update: {},
    create: { codigo: 'corte', nombre: 'Corte' },
  });
  cortador = await cliente.proveedor.create({
    data: { nombre: 'Corte Express', roles: { create: { idRolProveedor: rolCorte.id } } },
  });

  telaFelpa = await cliente.tela.create({ data: { nombre: 'Felpa', unidadMedida: 'M' } });
  avioBoton = await cliente.avio.create({
    data: { clave: 'BOT-01', descripcion: 'Botón', unidad: 'pza' },
  });
  avioHilo = await cliente.avio.create({
    data: { clave: 'HIL-01', descripcion: 'Hilo', unidad: 'm', esGenerico: true },
  });
  await cliente.avioProveedor.create({
    data: { idAvio: avioBoton.id, idProveedor: proveedor.id, precio: 2 },
  });

  modelo = await cliente.modelo.create({ data: { codigo: 'A-100', descripcion: 'Playera' } });
  await cliente.modeloTela.create({
    data: { idModelo: modelo.id, idTela: telaFelpa.id, consumoPorPrenda: 1.5 },
  });
  await cliente.modeloAvio.createMany({
    data: [
      { idModelo: modelo.id, idAvio: avioBoton.id, consumoPorPrenda: 6 },
      { idModelo: modelo.id, idAvio: avioHilo.id, consumoPorPrenda: 2 },
    ],
  });

  await cliente.tipoMovimientoInventario.createMany({
    data: [
      { codigo: 'ajuste-entrada', nombre: 'Ajuste (Entrada)', direccion: 'entrada' },
      { codigo: 'ajuste-salida', nombre: 'Ajuste (Salida)', direccion: 'salida' },
      { codigo: 'entrada-recepcion', nombre: 'Entrada por Recepción', direccion: 'entrada' },
    ],
  });

  // OP de 100 piezas: Rojo CH 40 + M 60.
  const orden = await cliente.orden.create({
    data: {
      folio: 1n,
      idEmpresa: empresa.id,
      idModelo: modelo.id,
      idCliente: clienteNegocio.id,
      idMaquilero: maquilero.id,
      estado: 'completa',
      fechaCompletada: new Date(),
      lineas: {
        create: [
          {
            idColor: colorRojo.id,
            tallas: {
              create: [
                { idTalla: tallaCH.id, cantidad: 40 },
                { idTalla: tallaM.id, cantidad: 60 },
              ],
            },
          },
        ],
      },
    },
  });
  idOrden = orden.id;
  await sembrarRecetaDeOrden(cliente, idOrden, modelo.id);
});

describe('antes de cortar no cambia nada (la explosión de casi siempre)', () => {
  it('base = lo pedido, sin sobre-corte, y el snapshot guarda su base', async () => {
    const ex = await explotar();
    expect(ex.ordenes[0]?.piezasSobreCorte).toBe(0);
    expect(delAvio(ex, avioBoton.id)?.cantidadRequerida).toBeCloseTo(600); // 6 × 100
    expect(deLaTela(ex, telaFelpa.id)?.cantidadRequerida).toBeCloseTo(150); // 1.5 × 100
    const snapshot = await cliente.requerimientoOrden.findMany({ where: { idOrden } });
    expect(snapshot.map((s) => s.piezasBase)).toEqual(snapshot.map(() => 100));
  });

  it('un corte EXACTO (o por debajo) tampoco cambia nada', async () => {
    await cortar(40, 50); // M por debajo
    const ex = await explotar();
    expect(ex.ordenes[0]?.piezasSobreCorte).toBe(0);
    expect(delAvio(ex, avioBoton.id)?.cantidadRequerida).toBeCloseTo(600);
  });
});

describe('caso 1 y 2 — comprado y recibido ⇒ sobre-corte ⇒ re-explotar pide SÓLO el extra', () => {
  it('pide 20 × 6 botones, la tela NO se mueve, y la OC nueva lleva sólo el extra', async () => {
    // La primera pasada: se explota, se compra y se recibe TODO lo pedido.
    await explotar();
    const primera = await comprar();
    expect(primera.ordenesCompra).toHaveLength(1);
    const idOcOriginal = primera.ordenesCompra[0]!.idOrdenCompra;
    await autorizarYRecibir(idOcOriginal);

    // Se cortan 120 (CH 40 + M 80): 20 de sobre-corte, todas en M.
    await cortar(40, 80);
    const ex = await explotar();

    expect(ex.ordenes[0]?.piezasSobreCorte).toBe(20);
    const boton = delAvio(ex, avioBoton.id);
    expect(boton?.cantidadRequerida).toBeCloseTo(720); // 6 × 120
    expect(boton?.cantidadEnOc).toBeCloseTo(600);
    expect(boton?.cantidadPendiente).toBeCloseTo(120); // EXACTAMENTE el extra
    expect(boton?.diff).toBe('cantidad-cambiada');
    // 🔴 La tela ya salió antes de cortar: el sobre-corte NO la vuelve a pedir.
    const felpa = deLaTela(ex, telaFelpa.id);
    expect(felpa?.cantidadRequerida).toBeCloseTo(150);
    expect(felpa?.diff).toBe('sin-cambio');
    // El snapshot dice contra qué se calculó cada renglón.
    const snap = await cliente.requerimientoOrden.findMany({ where: { idOrden } });
    expect(snap.find((s) => s.idTela !== null)?.piezasBase).toBe(100);
    expect(snap.find((s) => s.idAvio === avioBoton.id)?.piezasBase).toBe(120);

    // La revisión previa enseña de dónde salió el extra (lo que trae el snapshot).
    const previa = await previoCompraDesdeExplosion(
      sesion(),
      { fechaEntrega: '2026-09-30', idsOrden: [idOrden], idsRequerimiento: [] },
      bd(),
    );
    expect(previa.ordenes[0]?.piezasSobreCorte).toBe(20);

    // Caso 2: generar OC ⇒ nace una OC NUEVA, sólo con el extra.
    const segunda = await comprar();
    expect(segunda.ordenesCompra).toHaveLength(1);
    const idOcNueva = segunda.ordenesCompra[0]!.idOrdenCompra;
    expect(idOcNueva).not.toBe(idOcOriginal);
    const nueva = await obtenerOC(sesion(), idOcNueva, bd());
    expect(nueva.lineas.map((l) => [l.idAvio, Number(l.cantidad)])).toEqual([[avioBoton.id, 120]]);
    // …y la recibida queda INTACTA: no se edita una OC recibida (§245(a)).
    const original = await obtenerOC(sesion(), idOcOriginal, bd());
    expect(original.estatus).toBe('recibida_total');
    expect(original.lineas.map((l) => Number(l.cantidad))).toEqual([600]);

    // Y una tercera pasada ya no pide nada.
    const ex3 = await explotar();
    expect(delAvio(ex3, avioBoton.id)?.cantidadPendiente).toBe(0);
  });

  it('una orden cortada POR PARTES: el extra aparece cuando lo acumulado rebasa la celda', async () => {
    await cortar(24, 36); // 60 %: nada
    expect((await explotar()).ordenes[0]?.piezasSobreCorte).toBe(0);
    await cortar(20, 30); // +50 % ⇒ CH 44, M 66 ⇒ extra 4 + 6
    const ex = await explotar();
    expect(ex.ordenes[0]?.piezasSobreCorte).toBe(10);
    expect(delAvio(ex, avioBoton.id)?.cantidadRequerida).toBeCloseTo(660); // 6 × 110
  });
});

describe('caso 3 — avío por TALLA y por MEDIDA (R18): el extra sólo donde se sobre-cortó', () => {
  it('cierres: la medida de M crece, la de CH (bajo-cortada) no baja', async () => {
    const cierre = await cliente.avio.create({
      data: { clave: 'CIE-01', descripcion: 'Cierre', unidad: 'pza' },
    });
    await cliente.avioProveedor.create({
      data: { idAvio: cierre.id, idProveedor: proveedor.id, precio: 5 },
    });
    const m53 = await cliente.avioMedida.create({
      data: { idAvio: cierre.id, medida: '53 cm', valor: 53, precio: 5, orden: 1 },
    });
    const m60 = await cliente.avioMedida.create({
      data: { idAvio: cierre.id, medida: '60 cm', valor: 60, precio: 5, orden: 2 },
    });
    const renglon = await cliente.ordenAvio.create({
      data: {
        idOrden,
        idAvio: cierre.id,
        consumoPorPrenda: 1,
        consumoPorTalla: true,
        liberadoEn: new Date(),
        liberadoPorId: 'usr-pruebas',
        tallas: {
          create: [
            { idTalla: tallaCH.id, consumo: 1, idAvioMedida: m53.id },
            { idTalla: tallaM.id, consumo: 1, idAvioMedida: m60.id },
          ],
        },
      },
    });
    expect(renglon.id).toBeGreaterThan(0);

    await cortar(30, 75); // CH por debajo (30 < 40), M sobre-cortada (+15)
    const ex = await explotar();
    const fila = delAvio(ex, cierre.id);
    expect(fila?.cantidadRequerida).toBeCloseTo(115); // 40 (CH no baja) + 75
    expect(fila?.medidas.map((m) => [m.etiqueta, m.cantidad])).toEqual([
      ['53 cm', 40],
      ['60 cm', 75],
    ]);
    expect(fila?.avisos).toEqual([]);
  });
});

describe('el aviso de la contradicción (§Post-F9.105) mide contra la MISMA base', () => {
  it('la explosión y la revisión previa dicen las mismas cifras, con el sobre-corte', async () => {
    // El botón pasa a comprarse por medida y la receta de ESTA orden arrastra la longitud como
    // cantidad por talla (la contradicción de §Post-F9.105).
    await cliente.avio.update({ where: { id: avioBoton.id }, data: { unidadMedida: 'cm' } });
    await cliente.avioMedida.create({
      data: { idAvio: avioBoton.id, medida: '53 cm', valor: 53, precio: 6 },
    });
    const renglon = await cliente.ordenAvio.findFirstOrThrow({
      where: { idOrden, idAvio: avioBoton.id },
      select: { id: true },
    });
    await cliente.ordenAvio.update({ where: { id: renglon.id }, data: { consumoPorTalla: true } });
    await cliente.ordenAvioTalla.createMany({
      data: [
        { idOrdenAvio: renglon.id, idTalla: tallaCH.id, consumo: 53 },
        { idOrdenAvio: renglon.id, idTalla: tallaM.id, consumo: 53 },
      ],
    });

    await cortar(40, 80); // 120 cortadas
    const ex = await explotar();
    const cifras = 'Esta orden pide 6,360 pza y deberían ser 720 pza'; // 53 × 120 contra 6 × 120
    expect(delAvio(ex, avioBoton.id)?.avisos[0]).toContain(cifras);

    const plan = await previoCompraDesdeExplosion(
      sesion(),
      { fechaEntrega: '2026-09-30', idsOrden: [idOrden], idsRequerimiento: [] },
      bd(),
    );
    // 🔴 Si la previa midiera contra lo PEDIDO diría «5,300 … 600»: dos cifras del mismo descuadre.
    expect(plan.avisos.find((a) => a.includes('POR MEDIDA'))).toContain(cifras);
  });
});

describe('un avío que se compra SIN color (fila 0.158) también ve el sobre-corte', () => {
  it('la etiqueta de lavado se calcula sobre lo cortado de TODA la orden', async () => {
    const etiqueta = await cliente.avio.create({
      data: {
        clave: 'ETQ-01',
        descripcion: 'Etiqueta de lavado',
        unidad: 'pza',
        seCompraSinColor: true,
      },
    });
    await cliente.ordenAvio.create({
      data: {
        idOrden,
        idAvio: etiqueta.id,
        consumoPorPrenda: 1,
        liberadoEn: new Date(),
        liberadoPorId: 'usr-pruebas',
      },
    });
    await cortar(40, 80);
    const fila = delAvio(await explotar(), etiqueta.id);
    expect(fila?.idColorPrenda).toBeNull(); // un solo renglón, sin color
    expect(fila?.cantidadRequerida).toBeCloseTo(120);
  });

  it('…y si además se consume POR TALLA, el desglose por talla también es el cortado', async () => {
    const etiqueta = await cliente.avio.create({
      data: {
        clave: 'ETQ-02',
        descripcion: 'Etiqueta de talla',
        unidad: 'pza',
        seCompraSinColor: true,
      },
    });
    await cliente.ordenAvio.create({
      data: {
        idOrden,
        idAvio: etiqueta.id,
        consumoPorPrenda: 1,
        consumoPorTalla: true,
        liberadoEn: new Date(),
        liberadoPorId: 'usr-pruebas',
        tallas: {
          create: [
            { idTalla: tallaCH.id, consumo: 1 },
            { idTalla: tallaM.id, consumo: 3 },
          ],
        },
      },
    });
    await cortar(40, 80);
    const fila = delAvio(await explotar(), etiqueta.id);
    // 1 × 40 + 3 × 80 = 280; contra lo pedido serían 40 + 180 = 220.
    expect(fila?.cantidadRequerida).toBeCloseTo(280);
  });
});

describe('caso 4 — avío GENÉRICO con stock que cubre el extra', () => {
  it('no se compra: el stock lo cubre', async () => {
    await ajustarInventarioAvio(
      sesion(),
      {
        idAlmacen: almacen.id,
        fecha: '2026-08-01',
        idTipoMov: (
          await cliente.tipoMovimientoInventario.findUniqueOrThrow({
            where: { codigo: 'ajuste-entrada' },
          })
        ).id,
        lineas: [{ idAvio: avioHilo.id, cantidad: 300 }],
        motivo: 'conteo inicial',
      },
      bd(),
    );
    await cortar(40, 80);
    const ex = await explotar();
    const hilo = delAvio(ex, avioHilo.id);
    expect(hilo?.cantidadRequerida).toBeCloseTo(240); // 2 × 120
    expect(hilo?.cantidadAComprar).toBe(0);
    expect(hilo?.cantidadPendiente).toBe(0);
  });
});

describe('caso 5 — corte CANCELADO ⇒ el extra desaparece del pendiente', () => {
  it('re-explotar tras cancelar el corte vuelve a lo pedido', async () => {
    await explotar();
    await comprar();
    const idCorte = await cortar(40, 80);
    expect(delAvio(await explotar(), avioBoton.id)?.cantidadPendiente).toBeCloseTo(120);

    await cancelarEtapaMovimiento(sesion(), idCorte, { motivo: 'se capturó doble' }, bd());
    const ex = await explotar();
    expect(ex.ordenes[0]?.piezasSobreCorte).toBe(0);
    expect(delAvio(ex, avioBoton.id)?.cantidadRequerida).toBeCloseTo(600);
    expect(delAvio(ex, avioBoton.id)?.cantidadPendiente).toBe(0);
  });
});

describe('caso 6 — habilitación: el extra se propone para mandar al taller', () => {
  it('con lo pedido ya enviado, la FALTA es el extra y no se rotula «sobre-surtido»', async () => {
    await notaConfirmada(avioBoton.id, 600); // la primera nota: todo lo pedido
    const antes = await habilitacionOrden(sesion(), idOrden, bd());
    const botonAntes = antes.avios.find((a) => a.idAvio === avioBoton.id);
    expect(botonAntes?.estado).toBe('completo');
    expect(antes.piezasSobreCorte).toBe(0);

    await cortar(40, 80);
    const despues = await habilitacionOrden(sesion(), idOrden, bd());
    expect(despues.totalPiezas).toBe(100); // lo PEDIDO, como siempre
    expect(despues.piezasSobreCorte).toBe(20);
    const boton = despues.avios.find((a) => a.idAvio === avioBoton.id);
    expect(boton?.requerido).toBeCloseTo(720);
    expect(boton?.falta).toBeCloseTo(120);
    expect(boton?.estado).toBe('parcial');

    // Y mandar el extra lo deja COMPLETO, no «sobre-surtido».
    await notaConfirmada(avioBoton.id, 120);
    const final = await habilitacionOrden(sesion(), idOrden, bd());
    expect(final.avios.find((a) => a.idAvio === avioBoton.id)?.estado).toBe('completo');
  });

  it('un avío por TALLA (R18) pide el extra de la talla sobre-cortada', async () => {
    const renglon = await cliente.ordenAvio.findFirstOrThrow({
      where: { idOrden, idAvio: avioBoton.id },
      select: { id: true },
    });
    await cliente.ordenAvio.update({ where: { id: renglon.id }, data: { consumoPorTalla: true } });
    await cliente.ordenAvioTalla.createMany({
      data: [
        { idOrdenAvio: renglon.id, idTalla: tallaCH.id, consumo: 1 },
        { idOrdenAvio: renglon.id, idTalla: tallaM.id, consumo: 2 },
      ],
    });
    await cortar(30, 80); // CH por debajo (no baja), M +20
    const hab = await habilitacionOrden(sesion(), idOrden, bd());
    // 1 × 40 (CH no baja de lo pedido) + 2 × 80 = 200; contra lo pedido serían 160.
    expect(hab.avios.find((a) => a.idAvio === avioBoton.id)?.requerido).toBeCloseTo(200);
  });
});

describe('caso 7 — costo real: el snapshot con sobre-corte no se infla al escalar', () => {
  it('el requerido del costeo = consumo × cortado, no × cortado²/pedido', async () => {
    await cortar(40, 80);
    await explotar(); // avíos contra 120, tela contra 100
    const real = await costoRealOrden(sesion(), idOrden, bd());
    expect(real.piezasBase).toBe(120);
    // Botón: el snapshot ya dice 720 sobre 120 ⇒ no se escala. Antes de la fila: 720 × 1.2 = 864.
    expect(real.materiales.find((m) => m.idAvio === avioBoton.id)?.requerido).toBeCloseTo(720);
    // Tela: el snapshot dice 150 sobre 100 pedidas ⇒ se escala a 180.
    expect(real.materiales.find((m) => m.idTela === telaFelpa.id)?.requerido).toBeCloseTo(180);
  });
});

// ═══════════════════════════════ 2ª vuelta (review de la 0.232) ═══════════════════════════════

/** El botón pasa a comprarse POR MEDIDA y la receta de ESTA orden arrastra la longitud (§F9.105). */
async function botonContradictorio(): Promise<number> {
  await cliente.avio.update({ where: { id: avioBoton.id }, data: { unidadMedida: 'cm' } });
  await cliente.avioMedida.create({
    data: { idAvio: avioBoton.id, medida: '53 cm', valor: 53, precio: 6 },
  });
  const renglon = await cliente.ordenAvio.findFirstOrThrow({
    where: { idOrden, idAvio: avioBoton.id },
    select: { id: true },
  });
  await cliente.ordenAvio.update({ where: { id: renglon.id }, data: { consumoPorTalla: true } });
  await cliente.ordenAvioTalla.createMany({
    data: [
      { idOrdenAvio: renglon.id, idTalla: tallaCH.id, consumo: 53 },
      { idOrdenAvio: renglon.id, idTalla: tallaM.id, consumo: 53 },
    ],
  });
  return renglon.id;
}

const previa = () =>
  previoCompraDesdeExplosion(
    sesion(),
    { fechaEntrega: '2026-09-30', idsOrden: [idOrden], idsRequerimiento: [] },
    bd(),
  );

describe('H2 — la previa habla del SNAPSHOT y avisa si se cortó de más después de explotar', () => {
  it('cortar SIN re-explotar: cifras de la OC (5,300/600) + aviso de volver a explotar', async () => {
    await botonContradictorio();
    await explotar(); // snapshot sobre 100 pedidas: 53 × 100 = 5,300
    await cortar(40, 80); // 20 de más, DESPUÉS de explotar

    const plan = await previa();
    const boton = plan.proveedores
      .flatMap((p) => p.renglones)
      .find((r) => r.idMaterial === avioBoton.id);
    expect(boton?.cantidadTotal).toBeCloseTo(5300); // lo que la OC va a llevar
    // La magnitud del aviso es la de ESA compra, no la de lo cortado de hoy.
    expect(plan.avisos.find((a) => a.includes('POR MEDIDA'))).toContain(
      'Esta orden pide 5,300 pza y deberían ser 600 pza',
    );
    // El snapshot no trae sobre-corte… pero se cortó de más después: se dice.
    expect(plan.ordenes[0]?.piezasSobreCorte).toBe(0);
    expect(plan.ordenes[0]?.piezasSinExplotar).toBe(20);
    expect(plan.avisos).toContain(
      'Orden 1: la base de avíos creció 20 pieza(s) desde la última explosión (corte de más o ' +
        'más piezas pedidas): vuelve a explotar para pedir lo que falta.',
    );
  });

  it('tras re-explotar, el aviso de re-explotar desaparece y las cifras ya traen el extra', async () => {
    await botonContradictorio();
    await explotar();
    await cortar(40, 80);
    await explotar(); // la segunda pasada

    const plan = await previa();
    expect(plan.ordenes[0]?.piezasSobreCorte).toBe(20);
    expect(plan.ordenes[0]?.piezasSinExplotar).toBe(0);
    expect(plan.avisos.some((a) => a.includes('desde la última explosión'))).toBe(false);
    expect(plan.avisos.find((a) => a.includes('POR MEDIDA'))).toContain(
      'Esta orden pide 6,360 pza y deberían ser 720 pza',
    );
  });

  it('sin cortar no hay nada que avisar (y las cifras son las de siempre)', async () => {
    await botonContradictorio();
    await explotar();
    const plan = await previa();
    expect(plan.ordenes[0]?.piezasSinExplotar).toBe(0);
    expect(plan.avisos.some((a) => a.includes('desde la última explosión'))).toBe(false);
    expect(plan.avisos.find((a) => a.includes('POR MEDIDA'))).toContain(
      'Esta orden pide 5,300 pza y deberían ser 600 pza',
    );
  });

  it('cancelar el corte DESPUÉS de explotar no da un número negativo: no hay nada «de más»', async () => {
    const idCorte = await cortar(40, 80);
    await explotar(); // snapshot sobre 120
    await cancelarEtapaMovimiento(sesion(), idCorte, { motivo: 'se capturó doble' }, bd());
    const plan = await previa();
    expect(plan.ordenes[0]?.piezasSobreCorte).toBe(20); // lo que trae el snapshot
    expect(plan.ordenes[0]?.piezasSinExplotar).toBe(0); // y no −20
    expect(plan.avisos.some((a) => a.includes('desde la última explosión'))).toBe(false);
  });

  /**
   * 🔴 R1 de la 3ª vuelta: la base también crece si la MATRIZ PEDIDA crece (el cliente pidió más).
   * El aviso no puede decir «se cortaron» de una orden a la que nadie le cortó nada.
   */
  it('la orden CRECIÓ sin cortar: avisa con la cifra, sin decir que se cortó de más', async () => {
    await explotar(); // base 100
    await cliente.ordenLineaTalla.updateMany({
      where: { ordenLinea: { idOrden }, idTalla: tallaM.id },
      data: { cantidad: 90 }, // M 60 → 90: el pedido creció 30, nadie cortó nada
    });
    const plan = await previa();
    expect(plan.ordenes[0]?.piezasSinExplotar).toBe(30);
    const aviso = plan.avisos.find((a) => a.includes('desde la última explosión'));
    expect(aviso).toBe(
      'Orden 1: la base de avíos creció 30 pieza(s) desde la última explosión (corte de más o ' +
        'más piezas pedidas): vuelve a explotar para pedir lo que falta.',
    );
    expect(plan.avisos.some((a) => a.includes('se cortaron'))).toBe(false);
  });

  it('las DOS causas a la vez se suman en una sola cifra', async () => {
    await explotar(); // base 100
    await cliente.ordenLineaTalla.updateMany({
      where: { ordenLinea: { idOrden }, idTalla: tallaM.id },
      data: { cantidad: 90 }, // +30 pedido
    });
    await cortar(50, 90); // CH +10 de más sobre 40; M exacto sobre 90
    const plan = await previa();
    expect(plan.ordenes[0]?.piezasSinExplotar).toBe(40); // 30 de pedido + 10 de corte
    expect(plan.avisos).toContain(
      'Orden 1: la base de avíos creció 40 pieza(s) desde la última explosión (corte de más o ' +
        'más piezas pedidas): vuelve a explotar para pedir lo que falta.',
    );
  });

  it('un BAJO-corte después de explotar no es «de más»: no se avisa', async () => {
    await explotar();
    await cortar(30, 50);
    const plan = await previa();
    expect(plan.ordenes[0]?.piezasSinExplotar).toBe(0);
  });
});

/**
 * H3 — LA FUSIÓN DE COLORES, que es el caso real: «Rojo Pantone» y «Rojo» eran el mismo color y la
 * OP los trae a los DOS en su matriz (20+30 cada uno). La fusión no reescribe la matriz (D7) ni los
 * cortes (son rastro). Se corta todo bajo «Rojo»: CH 40, M 70. En espacio canónico la celda pedida
 * es CH 40 / M 60 ⇒ el extra es 10. Si algún lado no se canonizara, el «Rojo» crudo pediría 20/30
 * contra 40/70 cortadas y el extra saldría de 60.
 */
describe('H3 — colores fusionados: la base se compara en espacio canónico', () => {
  async function ordenConDuplicado(): Promise<void> {
    const duplicado = await cliente.color.create({ data: { nombre: 'Rojo Pantone 18-1663' } });
    const orden = await cliente.orden.create({
      data: {
        folio: 2n,
        idEmpresa: empresa.id,
        idModelo: modelo.id,
        idCliente: idClienteNegocio,
        idMaquilero: maquilero.id,
        estado: 'completa',
        fechaCompletada: new Date(),
        lineas: {
          create: [
            {
              idColor: duplicado.id,
              tallas: {
                create: [
                  { idTalla: tallaCH.id, cantidad: 20 },
                  { idTalla: tallaM.id, cantidad: 30 },
                ],
              },
            },
            {
              idColor: colorRojo.id,
              tallas: {
                create: [
                  { idTalla: tallaCH.id, cantidad: 20 },
                  { idTalla: tallaM.id, cantidad: 30 },
                ],
              },
            },
          ],
        },
      },
    });
    idOrden = orden.id;
    await sembrarRecetaDeOrden(cliente, idOrden, modelo.id);
    duplicadoId = duplicado.id;
  }
  let duplicadoId = 0;
  const fusionar = () =>
    fusionarColores(sesion(), { idDestino: colorRojo.id, origenes: [duplicadoId] }, bd());

  it('la EXPLOSIÓN pide el extra de 10, no de 60', async () => {
    await ordenConDuplicado();
    await cortar(40, 70); // todo bajo «Rojo»
    await fusionar();
    const ex = await explotar();
    expect(ex.ordenes[0]?.piezasSobreCorte).toBe(10);
    expect(delAvio(ex, avioBoton.id)?.cantidadRequerida).toBeCloseTo(660); // 6 × 110
  });

  it('la PREVIA dice que la base creció 10 desde la última explosión, no 60', async () => {
    await ordenConDuplicado();
    await explotar(); // antes de cortar: base 100
    await cortar(40, 70);
    await fusionar();
    const plan = await previa();
    expect(plan.ordenes[0]?.piezasSinExplotar).toBe(10);
  });

  it('la HABILITACIÓN propone mandar el extra de 10, no de 60', async () => {
    await ordenConDuplicado();
    await cortar(40, 70);
    await fusionar();
    const hab = await habilitacionOrden(sesion(), idOrden, bd());
    expect(hab.piezasSobreCorte).toBe(10);
    expect(hab.avios.find((a) => a.idAvio === avioBoton.id)?.requerido).toBeCloseTo(660);
  });

  it('la RECETA mide la magnitud con la misma base canónica', async () => {
    await ordenConDuplicado();
    await botonContradictorio();
    await cortar(40, 70);
    await fusionar();
    const receta = await obtenerRecetaOrden(sesion(), idOrden, bd());
    // 53 × 110 contra 6 × 110.
    expect(receta.avios.find((a) => a.idAvio === avioBoton.id)?.avisoCaptura).toContain(
      'Esta orden pide 5,830 pza y deberían ser 660 pza',
    );
  });
});

describe('H5 — la receta de la orden y la explosión dan las MISMAS cifras del descuadre', () => {
  it('con sobre-corte: el aviso de captura y la bitácora de «Corregir» van sobre la base de avíos', async () => {
    const idRenglon = await botonContradictorio();
    await cortar(40, 80);
    const cifras = 'Esta orden pide 6,360 pza y deberían ser 720 pza';
    expect(delAvio(await explotar(), avioBoton.id)?.avisos[0]).toContain(cifras);
    const receta = await obtenerRecetaOrden(sesion(), idOrden, bd());
    expect(receta.avios.find((a) => a.idAvio === avioBoton.id)?.avisoCaptura).toContain(cifras);

    await corregirCapturaAvio(sesion(), idOrden, idRenglon, bd());
    const bitacoras = await cliente.bitacora.findMany({
      where: { entidad: 'RecetaOrden', idEntidad: String(idOrden), accion: 'MODIFICAR' },
      orderBy: { id: 'desc' },
    });
    const datos = JSON.stringify(
      bitacoras.find((b) => JSON.stringify(b.datos).includes('captura-por-medida-corregida'))
        ?.datos,
    );
    expect(datos).toContain('"requeridoAntes":6360');
    expect(datos).toContain('"requeridoDespues":720');
  });

  it('sin corte: las cifras de siempre, sobre lo pedido', async () => {
    await botonContradictorio();
    const receta = await obtenerRecetaOrden(sesion(), idOrden, bd());
    expect(receta.avios.find((a) => a.idAvio === avioBoton.id)?.avisoCaptura).toContain(
      'Esta orden pide 5,300 pza y deberían ser 600 pza',
    );
  });

  /**
   * Los dos lados en UNA orden: una OP sin piezas pedidas (todas sus celdas en 0) a la que se le
   * cortaron 10. Para la TELA la orden no pide nada (lo pedido = 0) ⇒ quitarla de la receta no la
   * «saca de la compra» aunque esté comprada. Para el AVÍO la base es lo cortado (10) ⇒ sí pide, y
   * quitarlo con una OC autorizada se frena (§Post-F9.79).
   */
  it('la TELA se queda sobre lo pedido; el AVÍO, sobre la base con el sobre-corte', async () => {
    await cliente.ordenLineaTalla.updateMany({
      where: { ordenLinea: { idOrden } },
      data: { cantidad: 0 },
    });
    await cortar(10, 0);
    // Una OC AUTORIZADA ligada a la OP, con la tela y el botón.
    const oc = await cliente.ordenCompra.create({
      data: {
        numCompra: 500n,
        idEmpresa: empresa.id,
        idProveedor: proveedor.id,
        estatus: 'autorizada',
        lineas: {
          create: [
            { idTela: telaFelpa.id, cantidad: 15, precio: 10, idOrden },
            { idAvio: avioBoton.id, cantidad: 60, precio: 2, idOrden },
          ],
        },
      },
    });
    expect(oc.id).toBeGreaterThan(0);
    const receta = await obtenerRecetaOrden(sesion(), idOrden, bd());
    const tela = receta.telas.find((t) => t.idTela === telaFelpa.id)!;
    const boton = receta.avios.find((a) => a.idAvio === avioBoton.id)!;

    // EDITAR el avío a consumo 0 lo sacaría de la compra: se frena. La tela sí se deja (ver abajo).
    await expect(
      editarRenglonReceta(sesion(), idOrden, 'avio', boton.id, { consumoPorPrenda: 0 }, bd()),
    ).rejects.toThrow(/BOT-01/);
    // RESTAURAR al modelo, si el modelo ya no lo pide (consumo 0), también lo sacaría: se frena.
    await cliente.modeloAvio.update({
      where: { idModelo_idAvio: { idModelo: modelo.id, idAvio: avioBoton.id } },
      data: { consumoPorPrenda: 0 },
    });
    await expect(restaurarRenglonReceta(sesion(), idOrden, 'avio', boton.id, bd())).rejects.toThrow(
      /BOT-01/,
    );
    await expect(
      quitarRenglonReceta(sesion(), idOrden, 'avio', boton.id, {}, bd()),
    ).rejects.toThrow(/BOT-01/);
    // La TELA: con lo pedido en 0 no pide nada, así que editarla no la saca de ninguna compra.
    await expect(
      editarRenglonReceta(sesion(), idOrden, 'tela', tela.id, { consumoPorPrenda: 0 }, bd()),
    ).resolves.toBeDefined();
    await expect(
      quitarRenglonReceta(sesion(), idOrden, 'tela', tela.id, {}, bd()),
    ).resolves.toBeDefined();
  });

  it('RESTAURAR la tela al modelo con lo pedido en 0 no la saca de ninguna compra', async () => {
    await cliente.ordenLineaTalla.updateMany({
      where: { ordenLinea: { idOrden } },
      data: { cantidad: 0 },
    });
    await cortar(10, 0);
    await cliente.ordenCompra.create({
      data: {
        numCompra: 501n,
        idEmpresa: empresa.id,
        idProveedor: proveedor.id,
        estatus: 'autorizada',
        lineas: { create: [{ idTela: telaFelpa.id, cantidad: 15, precio: 10, idOrden }] },
      },
    });
    await cliente.modeloTela.update({
      where: { idModelo_idTela: { idModelo: modelo.id, idTela: telaFelpa.id } },
      data: { consumoPorPrenda: 0 },
    });
    const tela = (await obtenerRecetaOrden(sesion(), idOrden, bd())).telas.find(
      (t) => t.idTela === telaFelpa.id,
    )!;
    await expect(
      restaurarRenglonReceta(sesion(), idOrden, 'tela', tela.id, bd()),
    ).resolves.toBeDefined();
  });
});

/**
 * R2 de la 3ª vuelta — el corte RESPONDE cuántas piezas de sobre-corte agregó, medido como la
 * explosión: por celda color×talla PLEGANDO los packs. Un tendido de más compensado por otro de
 * menos en la misma celda no es sobre-corte (la explosión no pediría nada).
 */
describe('R2 — el corte dice el sobre-corte que agregó, con los packs plegados', () => {
  async function ordenConPacks(): Promise<void> {
    const orden = await cliente.orden.create({
      data: {
        folio: 3n,
        idEmpresa: empresa.id,
        idModelo: modelo.id,
        idCliente: idClienteNegocio,
        idMaquilero: maquilero.id,
        estado: 'completa',
        fechaCompletada: new Date(),
        lineas: {
          create: [
            {
              idColor: colorRojo.id,
              pack: 'A',
              tallas: { create: [{ idTalla: tallaCH.id, cantidad: 20 }] },
            },
            {
              idColor: colorRojo.id,
              pack: 'B',
              tallas: { create: [{ idTalla: tallaCH.id, cantidad: 20 }] },
            },
          ],
        },
      },
    });
    idOrden = orden.id;
    await sembrarRecetaDeOrden(cliente, idOrden, modelo.id);
  }
  const cortarPacks = (a: number, b: number) =>
    registrarCorte(
      sesion(),
      {
        idOrden,
        idCortador: cortador.id,
        fecha: '2026-09-01',
        lineas: [
          { idColor: colorRojo.id, pack: 'A', tallas: [{ idTalla: tallaCH.id, cantidad: a }] },
          { idColor: colorRojo.id, pack: 'B', tallas: [{ idTalla: tallaCH.id, cantidad: b }] },
        ],
      },
      bd(),
    );

  it('pack A 25/20 y pack B 15/20: 5 de más en un tendido, 0 en la celda ⇒ 0', async () => {
    await ordenConPacks();
    const corte = await cortarPacks(25, 15);
    expect(corte.piezasSobreCorteNuevas).toBe(0);
    expect((await explotar()).ordenes[0]?.piezasSobreCorte).toBe(0); // y la explosión coincide
  });

  it('pack A 25/20 y pack B 20/20: 5 de más en la celda ⇒ 5', async () => {
    await ordenConPacks();
    const corte = await cortarPacks(25, 20);
    expect(corte.piezasSobreCorteNuevas).toBe(5);
    expect((await explotar()).ordenes[0]?.piezasSobreCorte).toBe(5);
  });

  it('un corte sólo cuenta lo que ÉL agrega (no el sobre-corte que ya había)', async () => {
    const corteDe = async (ch: number, m: number): Promise<number> =>
      (
        await registrarCorte(
          sesion(),
          {
            idOrden,
            idCortador: cortador.id,
            fecha: '2026-09-01',
            lineas: [
              {
                idColor: colorRojo.id,
                tallas: [
                  { idTalla: tallaCH.id, cantidad: ch },
                  { idTalla: tallaM.id, cantidad: m },
                ].filter((t) => t.cantidad > 0),
              },
            ],
          },
          bd(),
        )
      ).piezasSobreCorteNuevas;
    expect(await corteDe(30, 70)).toBe(10); // M 70 sobre 60
    // CH llega a 35 de 40: todavía faltaba, no es de más aunque la orden ya tenga sobre-corte.
    expect(await corteDe(5, 0)).toBe(0);
    expect(await corteDe(10, 0)).toBe(5); // CH 45 sobre 40: sólo los 5 nuevos
  });

  /**
   * 🔒 4ª vuelta del review — DOS CORTES SIMULTÁNEOS de la misma orden (pedido CH 40 / M 60), cada
   * uno de CH 50 / M 70. Solo, cada corte deja 20 de más; juntos dejan CH 100 y M 140: 140 de más.
   * Con el candado de etapas se serializan ANTES de leer el «antes»: uno dice 20 y el otro 120, y
   * la suma es la verdad (140).
   *
   * ⚠️ Lo que el candado evita: sin él, las dos transacciones leen su «antes» (0) a la vez. La
   * secuencia de folios (UPDATE…RETURNING sobre una fila) ya serializa lo que viene DESPUÉS, así que
   * el «después» del segundo ve al primero: diría 140 en vez de 120, y la suma saldría 160. Es una
   * carrera —depende de que el segundo lea su «antes» antes de que el primero confirme—, así que
   * sin candado la prueba falla casi siempre pero no siempre.
   */
  it('dos cortes CONCURRENTES de la misma orden: la suma de lo que dicen es el sobre-corte real', async () => {
    const intento = () =>
      registrarCorte(
        sesion(),
        {
          idOrden,
          idCortador: cortador.id,
          fecha: '2026-09-01',
          lineas: [
            {
              idColor: colorRojo.id,
              tallas: [
                { idTalla: tallaCH.id, cantidad: 50 },
                { idTalla: tallaM.id, cantidad: 70 },
              ],
            },
          ],
        },
        bd(),
      );
    const [a, b] = await Promise.all([intento(), intento()]);
    expect([a.piezasSobreCorteNuevas, b.piezasSobreCorteNuevas].sort((x, y) => x - y)).toEqual([
      20, 120,
    ]);
    expect((await explotar()).ordenes[0]?.piezasSobreCorte).toBe(140);
  });
});
