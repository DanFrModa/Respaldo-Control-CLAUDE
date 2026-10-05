/**
 * ⭐ 0.226b (§Post-F9.244 / §Post-F9.261) — LO QUE LA PANTALLA NECESITA PARA AVISAR ANTES.
 * Postgres efímero (testcontainers en CI; Postgres nativo en local).
 *
 * La parte a hizo que el SERVIDOR rechazara toda captura sobre una orden cerrada. Esta parte le da a
 * la pantalla el dato para apagar la captura y avisar ANTES de que alguien llene un formulario:
 *
 *  1. **El booleano aditivo `ordenCerrada`** en las respuestas que no traen la orden entera: renglón
 *     de nota de salida, renglón de OC, auditoría (detalle y listado), fila de existencias de PT y
 *     renglón de tela pendiente de recibir. Se mide que pase de `false` a `true` al CERRAR y vuelva
 *     a `false` al REABRIR (la verdad es `cerradaEn`, no un espejo congelado).
 *  2. **C8 — la previa del cierre**: cuántas piezas de PT siguen etiquetadas con la orden, por suma
 *     DIRECTA de movimientos (D3), contando sólo los saldos POSITIVOS por artículo×almacén.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type {
  Almacen,
  Color,
  Empresa,
  Modelo,
  PrismaClient,
  Proveedor,
  Talla,
} from '../../datos/index.js';
import { ErrorNoEncontrado, ErrorPermiso } from '../../comun/errores.js';
import { ORIGEN } from '../../comun/origenes.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import type { ClavePermiso } from '../../contrato/index.js';

import { cerrarOrden, previaCierreOrden, reabrirOrden } from './cierre-orden.js';
import {
  consultarExistenciasPt,
  obtenerMovimientoPorFolio,
  registrarMovimientoPt,
} from '../inventarios/movimientos-pt.js';
import { obtenerEntradaTela } from '../inventarios/entradas-tela.js';
import { kardexTelaColor } from '../inventarios/partidas-telas.js';
import { habilitacionOrden } from './habilitacion-orden.js';
import { explosionarOrden } from '../compras/mrp.js';
import { obtenerNotaSalida } from '../notas/notas-salida.js';
import { obtenerOC } from '../compras/ordenes-compra.js';
import { lineasTelaPendientesDeProveedor } from '../compras/recepciones.js';
import { listarAuditorias, obtenerAuditoria } from '../calidad/auditorias.js';

let cliente: PrismaClient;
let empresa: Empresa;
let modelo: Modelo;
let colorRojo: Color;
let colorAzul: Color;
let tallaCH: Talla;
let proveedor: Proveedor;
let almPrimeras: Almacen;
let almSegundas: Almacen;
let almAvio: Almacen;
let idOrden: number;
let clienteNegocioId: number;

const PERMISOS: ClavePermiso[] = [
  'ordenes.cerrar',
  'ordenes.ver',
  'inventario-pt.ver',
  'inventario-pt.mover',
  'ipt.fecha-libre',
  'notas.ver',
  'compras.ver',
  'calidad.ver',
  'inventario-telas.ver',
  'ordenes.habilitacion',
];

const sesion = (permisos: ClavePermiso[] = PERMISOS): ReturnType<typeof sesionDePrueba> =>
  sesionDePrueba({ idEmpresaActiva: empresa.id, permisos });
const bd = (): { cliente: PrismaClient } => ({ cliente });

let folioFixture = 100n;
const siguienteFolio = (): bigint => {
  folioFixture += 1n;
  return folioFixture;
};

async function cerrar(): Promise<void> {
  await cerrarOrden(sesion(), idOrden, { motivo: 'ya terminó' }, bd());
}
async function reabrir(): Promise<void> {
  await reabrirOrden(sesion(), idOrden, { motivo: 'prueba' }, bd());
}

async function tipo(codigo: string): Promise<number> {
  return (await cliente.tipoMovimientoInventario.findUniqueOrThrow({ where: { codigo } })).id;
}

/** Mete `cantidad` piezas de la orden al almacén/color dados (movimiento manual, con su bucket). */
async function meterAPt(idAlmacen: number, idColor: number, cantidad: number): Promise<number> {
  const mov = await registrarMovimientoPt(
    sesion(),
    {
      idTipoMov: await tipo('ajuste-entrada'),
      idAlmacen,
      idModelo: modelo.id,
      fecha: '2026-08-17',
      motivo: 'Alta para la prueba',
      lineas: [{ idColor, idOrden, tallas: [{ idTalla: tallaCH.id, cantidad }] }],
    },
    bd(),
  );
  return mov.folio;
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
  clienteNegocioId = (await cliente.cliente.create({ data: { nombre: 'C&A' } })).id;
  modelo = await cliente.modelo.create({ data: { codigo: 'A-100', descripcion: 'Playera' } });
  colorRojo = await cliente.color.create({ data: { nombre: 'Rojo' } });
  colorAzul = await cliente.color.create({ data: { nombre: 'Azul' } });
  tallaCH = await cliente.talla.create({ data: { etiqueta: 'CH', orden: 1 } });
  proveedor = await cliente.proveedor.create({
    data: { nombre: 'Avíos y Telas SA', modalidadFacturacion: 'solo_sin' },
  });
  almPrimeras = await cliente.almacen.create({ data: { nombre: 'Primeras', tipo: 'PT' } });
  almSegundas = await cliente.almacen.create({ data: { nombre: 'Segundas', tipo: 'PT' } });
  almAvio = await cliente.almacen.create({ data: { nombre: 'Avíos', tipo: 'AVIO' } });
  await cliente.tipoMovimientoInventario.createMany({
    data: [
      { codigo: 'ajuste-entrada', nombre: 'Ajuste (Entrada)', direccion: 'entrada' },
      { codigo: 'ajuste-salida', nombre: 'Ajuste (Salida)', direccion: 'salida' },
      { codigo: 'salida-a-orden', nombre: 'Salida a Orden', direccion: 'salida' },
    ],
    skipDuplicates: true,
  });
  const pedido = await cliente.pedido.create({
    data: { folio: 1n, idEmpresa: empresa.id, idCliente: clienteNegocioId },
  });
  const linea = await cliente.pedidoLinea.create({
    data: { idPedido: pedido.id, idModelo: modelo.id, cantidadPedida: 100, precio: 10 },
  });
  const orden = await cliente.orden.create({
    data: {
      folio: 1515n,
      idEmpresa: empresa.id,
      idPedidoLinea: linea.id,
      idModelo: modelo.id,
      idCliente: clienteNegocioId,
      estado: 'completa',
      fechaCompletada: new Date(),
      lineas: {
        create: [
          { idColor: colorRojo.id, tallas: { create: [{ idTalla: tallaCH.id, cantidad: 100 }] } },
        ],
      },
    },
  });
  idOrden = orden.id;
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// (1) El booleano aditivo `ordenCerrada`: sigue a `cerradaEn`, ida y vuelta
// ══════════════════════════════════════════════════════════════════════════════════════════════

describe('`ordenCerrada` en las respuestas de captura sigue al cierre (y a la reapertura)', () => {
  it('renglón de NOTA de salida', async () => {
    const avio = await cliente.avio.create({ data: { clave: 'ETQ-1', descripcion: 'Etiqueta' } });
    const nota = await cliente.notaSalida.create({
      data: {
        numNota: siguienteFolio(),
        idEmpresa: empresa.id,
        idMaquilero: proveedor.id,
        idAlmacen: almAvio.id,
        fechaElaboracion: new Date('2026-08-17T00:00:00.000Z'),
        estatus: 'borrador',
        lineas: { create: [{ idOrden, idAvio: avio.id, cantidad: 5 }] },
      },
    });
    const leer = async (): Promise<boolean | undefined> =>
      (await obtenerNotaSalida(sesion(), nota.id, bd())).lineas[0]?.ordenCerrada;

    expect(await leer()).toBe(false);
    await cerrar();
    expect(await leer()).toBe(true);
    await reabrir();
    expect(await leer()).toBe(false);
  });

  it('renglón de OC (con orden) y renglón SIN orden', async () => {
    const avio = await cliente.avio.create({ data: { clave: 'BOT-1', descripcion: 'Botón' } });
    const oc = await cliente.ordenCompra.create({
      data: {
        numCompra: siguienteFolio(),
        idEmpresa: empresa.id,
        idProveedor: proveedor.id,
        estatus: 'borrador',
      },
    });
    await cliente.ordenCompraLinea.createMany({
      data: [
        { idOrdenCompra: oc.id, idAvio: avio.id, idOrden, cantidad: 100, precio: 2 },
        { idOrdenCompra: oc.id, idAvio: avio.id, idOrden: null, cantidad: 10, precio: 2 },
      ],
    });
    const leer = async (): Promise<(boolean | undefined)[]> =>
      (await obtenerOC(sesion(), oc.id, bd())).lineas.map((l) => l.ordenCerrada);

    expect(await leer()).toEqual([false, false]);
    await cerrar();
    // La de la orden cerrada sí; la que no lleva orden, nunca.
    expect(await leer()).toEqual([true, false]);
    await reabrir();
    expect(await leer()).toEqual([false, false]);
  });

  it('AUDITORÍA: detalle y listado', async () => {
    const a = await cliente.auditoria.create({
      data: {
        numAuditoria: 1n,
        idEmpresa: empresa.id,
        idOrden,
        fechaElaboracion: new Date('2026-08-17T00:00:00.000Z'),
        fechaAuditoria: new Date('2026-08-17T00:00:00.000Z'),
        tamanoMuestra: 13,
      },
    });
    const detalle = async (): Promise<boolean> =>
      (await obtenerAuditoria(sesion(), a.id, bd())).ordenCerrada;
    const listado = async (): Promise<boolean | undefined> =>
      (await listarAuditorias(sesion(), {}, bd())).datos[0]?.ordenCerrada;

    expect([await detalle(), await listado()]).toEqual([false, false]);
    await cerrar();
    expect([await detalle(), await listado()]).toEqual([true, true]);
    await reabrir();
    expect([await detalle(), await listado()]).toEqual([false, false]);
  });

  it('fila de EXISTENCIAS de PT: el bucket de la orden sí, el «sin orden» nunca', async () => {
    await meterAPt(almPrimeras.id, colorRojo.id, 10);
    await registrarMovimientoPt(
      sesion(),
      {
        idTipoMov: await tipo('ajuste-entrada'),
        idAlmacen: almPrimeras.id,
        idModelo: modelo.id,
        fecha: '2026-08-17',
        motivo: 'Sin orden',
        lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 3 }] }],
      },
      bd(),
    );
    const leer = async (): Promise<[number | null, boolean][]> =>
      (await consultarExistenciasPt(sesion(), { idModelo: modelo.id }, bd())).filas
        .map((f): [number | null, boolean] => [f.idOrden, f.ordenCerrada])
        .sort((x, y) => (x[0] ?? 0) - (y[0] ?? 0));

    expect(await leer()).toEqual([
      [null, false],
      [idOrden, false],
    ]);
    await cerrar();
    expect(await leer()).toEqual([
      [null, false],
      [idOrden, true],
    ]);
  });

  it('renglón de un MOVIMIENTO de PT (kardex por folio, el que se ofrece cancelar)', async () => {
    const folio = await meterAPt(almPrimeras.id, colorRojo.id, 10);
    const leer = async (): Promise<boolean | undefined> =>
      (await obtenerMovimientoPorFolio(sesion(), folio, bd())).lineas[0]?.ordenCerrada;

    expect(await leer()).toBe(false);
    await cerrar();
    expect(await leer()).toBe(true);
    await reabrir();
    expect(await leer()).toBe(false);
  });

  it('renglón de una ENTRADA de tela: folio y cierre de su orden, y NADA de otra empresa (A9)', async () => {
    const tela = await cliente.tela.create({ data: { nombre: 'Felpa' } });
    const color = await cliente.telaColor.create({ data: { idTela: tela.id, nombre: 'Marino' } });
    const almTela = await cliente.almacen.create({ data: { nombre: 'Telas', tipo: 'TELA' } });
    const oc = await cliente.ordenCompra.create({
      data: {
        numCompra: siguienteFolio(),
        idEmpresa: empresa.id,
        idProveedor: proveedor.id,
        estatus: 'autorizada',
      },
    });
    const lineaPropia = await cliente.ordenCompraLinea.create({
      data: {
        idOrdenCompra: oc.id,
        idTela: tela.id,
        idTelaColor: color.id,
        idOrden,
        cantidad: 50,
        precio: 30,
      },
    });
    // ⚠️ La deuda A9 conocida (`entradas-tela.ts`): un renglón puede apuntar a un renglón de OC de
    // OTRA empresa. Su orden NO debe asomar (ni folio ni cierre): la lectura no ensancha la fuga.
    const otra = await crearEmpresaPrueba(cliente, 'Otra empresa');
    const ordenAjena = await cliente.orden.create({
      data: {
        folio: 777n,
        idEmpresa: otra.id,
        idModelo: modelo.id,
        idCliente: clienteNegocioId,
        estado: 'cerrada',
        cerradaEn: new Date(),
      },
    });
    const ocAjena = await cliente.ordenCompra.create({
      data: {
        numCompra: siguienteFolio(),
        idEmpresa: otra.id,
        idProveedor: proveedor.id,
        estatus: 'autorizada',
      },
    });
    const lineaAjena = await cliente.ordenCompraLinea.create({
      data: {
        idOrdenCompra: ocAjena.id,
        idTela: tela.id,
        idTelaColor: color.id,
        idOrden: ordenAjena.id,
        cantidad: 5,
        precio: 30,
      },
    });
    const entrada = await cliente.entradaTela.create({
      data: {
        folio: siguienteFolio(),
        idEmpresa: empresa.id,
        tipoDocumento: 'remision',
        numeroDocumento: 'R-1',
        idProveedor: proveedor.id,
        fecha: new Date('2026-08-17T00:00:00.000Z'),
        idAlmacen: almTela.id,
        estatus: 'borrador',
        lineas: {
          create: [
            { idTelaColor: color.id, cantidad: 10, idOrdenCompraLinea: lineaPropia.id },
            { idTelaColor: color.id, cantidad: 1, idOrdenCompraLinea: lineaAjena.id },
          ],
        },
      },
    });
    const leer = async (): Promise<[number | null, boolean][]> =>
      (await obtenerEntradaTela(sesion(), entrada.id, bd())).lineas
        .slice()
        .sort((a, b) => a.id - b.id)
        .map((l): [number | null, boolean] => [l.folioOrden, l.ordenCerrada]);

    expect(await leer()).toEqual([
      [1515, false],
      [null, false],
    ]);
    await cerrar();
    expect(await leer()).toEqual([
      [1515, true],
      [null, false],
    ]);
  });

  it('HABILITACIÓN de la orden (surtido de avíos → «Pasar a nota»)', async () => {
    const leer = async (): Promise<boolean> =>
      (await habilitacionOrden(sesion(), idOrden, bd())).ordenCerrada;
    expect(await leer()).toBe(false);
    await cerrar();
    expect(await leer()).toBe(true);
    await reabrir();
    expect(await leer()).toBe(false);
  });

  it('EXPLOSIÓN: cada OP dice si está cerrada (se explota igual: marca, no esconde)', async () => {
    // Un avío LIBERADO en la receta: sin nada liberado no hay explosión que pedir.
    const avio = await cliente.avio.create({ data: { clave: 'BOT-9', descripcion: 'Botón' } });
    await cliente.ordenAvio.create({
      data: { idOrden, idAvio: avio.id, consumoPorPrenda: 2, liberadoEn: new Date() },
    });
    const leer = async (): Promise<(boolean | undefined)[]> =>
      (
        await explosionarOrden(
          sesion(['compras.ver', 'ordenes.cerrar', 'ordenes.ver']),
          idOrden,
          bd(),
        )
      ).ordenes.map((o) => o.ordenCerrada);
    expect(await leer()).toEqual([false]);
    await cerrar();
    expect(await leer()).toEqual([true]);
  });

  it('KARDEX de tela por color: la SALIDA a una orden cerrada lo dice; lo demás, nunca', async () => {
    const tela = await cliente.tela.create({ data: { nombre: 'Felpa' } });
    const color = await cliente.telaColor.create({ data: { idTela: tela.id, nombre: 'Marino' } });
    const almTela = await cliente.almacen.create({ data: { nombre: 'Telas', tipo: 'TELA' } });
    const hoy = new Date();
    const crear = async (codigo: string, origenTipo: string, origenId: string | null) =>
      cliente.movimiento.create({
        data: {
          folio: siguienteFolio(),
          idEmpresa: empresa.id,
          idTipoMov: await tipo(codigo),
          idAlmacen: almTela.id,
          fecha: hoy,
          origenTipo,
          origenId,
          detallesTela: { create: [{ idTela: tela.id, idTelaColor: color.id, cantidad: 10 }] },
        },
      });
    // Un movimiento que NO es salida a orden aunque su `origenId` coincida con el id de la orden:
    // el folio y el cierre sólo se leen para las salidas a orden (origen polimórfico).
    const entrada = await crear('ajuste-entrada', ORIGEN.movimientoManual, String(idOrden));
    const salida = await crear('salida-a-orden', ORIGEN.salidaTelaOrden, String(idOrden));
    const leer = async (): Promise<Record<number, [number | null, boolean]>> =>
      Object.fromEntries(
        (
          await kardexTelaColor(
            sesion(['inventario-telas.ver', 'ordenes.cerrar', 'ordenes.ver']),
            { idTelaColor: color.id },
            bd(),
          )
        ).renglones.map((r) => [r.idMovimiento, [r.folioOrden, r.ordenCerrada]]),
      );

    expect(await leer()).toEqual({ [entrada.id]: [null, false], [salida.id]: [1515, false] });
    await cerrar();
    expect(await leer()).toEqual({ [entrada.id]: [null, false], [salida.id]: [1515, true] });
  });

  it('renglón de TELA pendiente de recibir: trae su folio de orden y si está cerrada', async () => {
    const tela = await cliente.tela.create({ data: { nombre: 'Felpa' } });
    const color = await cliente.telaColor.create({ data: { idTela: tela.id, nombre: 'Marino' } });
    const oc = await cliente.ordenCompra.create({
      data: {
        numCompra: siguienteFolio(),
        idEmpresa: empresa.id,
        idProveedor: proveedor.id,
        estatus: 'autorizada',
      },
    });
    await cliente.ordenCompraLinea.create({
      data: {
        idOrdenCompra: oc.id,
        idTela: tela.id,
        idTelaColor: color.id,
        idOrden,
        cantidad: 50,
        precio: 30,
      },
    });
    const leer = async (): Promise<[number | null, boolean][]> =>
      (await lineasTelaPendientesDeProveedor(sesion(), proveedor.id, undefined, bd())).map(
        (l): [number | null, boolean] => [l.folioOrden, l.ordenCerrada],
      );

    expect(await leer()).toEqual([[1515, false]]);
    await cerrar();
    // Se OFRECE igual (marcada): el estado es informativo, nunca una llave para esconder.
    expect(await leer()).toEqual([[1515, true]]);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// (2) C8 — la previa del cierre: el PT que todavía queda con la orden
// ══════════════════════════════════════════════════════════════════════════════════════════════

describe('C8 — previaCierreOrden: el producto terminado que queda con la orden', () => {
  it('sin movimientos de PT: 0 piezas y ningún almacén (el aviso no sale)', async () => {
    const previa = await previaCierreOrden(sesion(), idOrden, bd());
    expect(previa).toEqual({ idOrden, folio: 1515, piezasPt: 0, porAlmacen: [] });
  });

  it('suma DIRECTA por almacén, y lo que ya salió se descuenta', async () => {
    await meterAPt(almPrimeras.id, colorRojo.id, 10);
    await meterAPt(almSegundas.id, colorRojo.id, 5);
    // Salen 4 de Primeras (movimiento manual de salida del bucket de la orden).
    await registrarMovimientoPt(
      sesion(),
      {
        idTipoMov: await tipo('ajuste-salida'),
        idAlmacen: almPrimeras.id,
        idModelo: modelo.id,
        fecha: '2026-08-18',
        motivo: 'Salen cuatro',
        lineas: [
          { idColor: colorRojo.id, idOrden, tallas: [{ idTalla: tallaCH.id, cantidad: 4 }] },
        ],
      },
      bd(),
    );

    const previa = await previaCierreOrden(sesion(), idOrden, bd());
    expect(previa.piezasPt).toBe(11);
    expect(previa.porAlmacen).toEqual([
      { idAlmacen: almPrimeras.id, almacen: 'Primeras', piezas: 6 },
      { idAlmacen: almSegundas.id, almacen: 'Segundas', piezas: 5 },
    ]);
  });

  it('un artículo en NEGATIVO no esconde las piezas que sí hay en otro', async () => {
    await meterAPt(almPrimeras.id, colorRojo.id, 10);
    // Anomalía sembrada a mano (no la deja hacer la captura): −3 de Azul en la misma orden.
    await cliente.movimiento.create({
      data: {
        folio: siguienteFolio(),
        idEmpresa: empresa.id,
        idTipoMov: await tipo('ajuste-salida'),
        idAlmacen: almPrimeras.id,
        fecha: new Date('2026-08-18T00:00:00.000Z'),
        origenTipo: ORIGEN.movimientoManual,
        detallesPt: {
          create: [
            {
              idModelo: modelo.id,
              idColor: colorAzul.id,
              idTalla: tallaCH.id,
              idOrden,
              cantidad: 3,
            },
          ],
        },
      },
    });
    const previa = await previaCierreOrden(sesion(), idOrden, bd());
    expect(previa.piezasPt).toBe(10);
  });

  it('no cuenta piezas de OTRA orden ni del bucket «sin orden»', async () => {
    await registrarMovimientoPt(
      sesion(),
      {
        idTipoMov: await tipo('ajuste-entrada'),
        idAlmacen: almPrimeras.id,
        idModelo: modelo.id,
        fecha: '2026-08-17',
        motivo: 'Sin orden',
        lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 7 }] }],
      },
      bd(),
    );
    expect((await previaCierreOrden(sesion(), idOrden, bd())).piezasPt).toBe(0);
  });

  it('A9: una orden de OTRA empresa no existe para esta sesión', async () => {
    const otra = await crearEmpresaPrueba(cliente, 'Otra empresa');
    await expect(
      previaCierreOrden(
        sesionDePrueba({ idEmpresaActiva: otra.id, permisos: PERMISOS }),
        idOrden,
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);
  });

  it('A4: sin `ordenes.cerrar` no se consulta (es información para quien va a cerrar)', async () => {
    await expect(
      previaCierreOrden(sesion(['ordenes.ver', 'inventario-pt.ver']), idOrden, bd()),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });
});
