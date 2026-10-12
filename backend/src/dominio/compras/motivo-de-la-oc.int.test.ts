/**
 * ⭐ **Fila 0.231 (§Post-F9.245(b) + §Post-F9.277) — LA OC DICE POR QUÉ EXISTE.**
 *
 * Integración contra Postgres (en CI con testcontainers). Lo que se fija aquí:
 *  1. El catálogo: el seed siembra reposición · merma · sobre-corte, idempotente (no pisa lo
 *     editado) y con sobre-corte `fijo`.
 *  2. La OC: se crea y se edita con o sin motivo; motivo inexistente o desactivado ⇒ rechazo; el
 *     motivo se cambia aunque la OC esté RECIBIDA (es una anotación, no cae bajo la puerta de la
 *     0.225) y el cambio queda en la bitácora.
 *  3. La lectura: filtro por motivo en la lista y el IMPORTE POR MOTIVO del resumen, agregado en el
 *     servidor y cruzado contra una consulta SQL independiente y contra la suma de la lista.
 *  4. La explosión: la segunda pasada después de cortar de más nace con «sobre-corte» propuesto;
 *     la primera pasada, sin motivo; la mezcla, sin motivo y con aviso; lo elegido en la previa gana.
 *
 * ⚠️ El catálogo es GLOBAL (A9 / ADR-0007, como `ConceptoCosto`): no hay «motivo de otra empresa».
 * Lo que sí se separa por empresa son las OC, y eso se mide en el filtro y en el agregado.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { sembrar } from '../../../prisma/seed.js';
import type { ClavePermiso } from '../../contrato/index.js';
import { ErrorConflicto, ErrorNoEncontrado, ErrorValidacion } from '../../comun/errores.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import type {
  Almacen,
  Avio,
  Color,
  Empresa,
  PrismaClient,
  Proveedor,
  Talla,
  Tela,
} from '../../datos/index.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sembrarRecetaDeOrden } from '../../pruebas/receta.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import { fusionarColores } from '../catalogos/colores.js';
import { registrarCorte } from '../produccion/etapas.js';
import { explosionarOrden, generarOCDesdeExplosion, previoCompraDesdeExplosion } from './mrp.js';
import { avisoDeSobreCorteMixto } from './motivo-propuesto.js';
import {
  CODIGO_MOTIVO_SOBRE_CORTE,
  listarMotivosCompra,
  MOTIVOS_COMPRA_BASE,
} from './motivos-compra.js';
import {
  actualizarOC,
  autorizarOC,
  cancelarOC,
  crearOC,
  listarOC,
  obtenerOC,
  resumenOC,
} from './ordenes-compra.js';
import { recibirCompra } from './recepciones.js';

let cliente: PrismaClient;
let empresa: Empresa;
let otraEmpresa: Empresa;
let proveedor: Proveedor;
let cortador: Proveedor;
let maquilero: Proveedor;
let telaFelpa: Tela;
let avioBoton: Avio; // 6 pza/prenda
let avioEtiqueta: Avio; // 1 pza/prenda, mismo proveedor
let colorRojo: Color;
let tallaCH: Talla;
let tallaM: Talla;
let almacen: Almacen;
let direccion: { id: number };
let idOrden: number;
/** id de cada motivo base por código. */
type IdsMotivo = { reposicion: number; merma: number; 'sobre-corte': number };
let motivo: IdsMotivo;

const PERM: ClavePermiso[] = [
  'compras.ver',
  'compras.administrar',
  'compras.autorizar',
  'compras.recibir',
  'compras.cancelar',
  'produccion.corte',
];
/** Quien edita una OC ya firmada (decisión (a), fila 0.120). */
const PERM_FIRMADA: ClavePermiso[] = [...PERM, 'compras.editar-autorizada'];

const sesion = (permisos: ClavePermiso[] = PERM, idEmpresa = empresa.id): SesionUsuario =>
  sesionDePrueba({ idEmpresaActiva: idEmpresa, permisos });
const bd = () => ({ cliente });

/** Siembra los motivos base tal como lo hace el seed (sin correr el seed entero). */
async function sembrarMotivos(): Promise<IdsMotivo> {
  const ids: Record<string, number> = {};
  for (const m of MOTIVOS_COMPRA_BASE) {
    const fila = await cliente.motivoCompra.upsert({
      where: { codigo: m.codigo },
      update: {},
      create: { codigo: m.codigo, nombre: m.nombre, orden: m.orden, fijo: m.fijo },
    });
    ids[m.codigo] = fila.id;
  }
  return ids as IdsMotivo;
}

/** Una OC a mano de botones, con o sin motivo. */
function ocDeBotones(
  idMotivoCompra: number | null | undefined,
  cantidad = 100,
  precio = 2,
  s: SesionUsuario = sesion(),
) {
  return crearOC(
    s,
    {
      fechaEntrega: '2026-09-30',
      idDireccionEntrega: direccion.id,
      idProveedor: proveedor.id,
      ...(idMotivoCompra === undefined ? {} : { idMotivoCompra }),
      lineas: [{ idAvio: avioBoton.id, cantidad, precio, unidad: 'pza' }],
    },
    bd(),
  );
}

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

/** Las entradas de bitácora de una OC, de la más vieja a la más nueva. */
async function bitacoraDe(idOc: number) {
  return cliente.bitacora.findMany({
    where: { entidad: 'OrdenCompra', idEntidad: String(idOc) },
    orderBy: { id: 'asc' },
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
  otraEmpresa = await crearEmpresaPrueba(cliente, 'Otra Empresa');
  motivo = await sembrarMotivos();
  const clienteNegocio = await cliente.cliente.create({ data: { nombre: 'Liverpool' } });
  colorRojo = await cliente.color.create({ data: { nombre: 'Rojo' } });
  direccion = await cliente.direccionEntrega.create({
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
  // La tela NO tiene proveedor: la explosión la omite y las OC de estas pruebas son sólo de avíos.
  telaFelpa = await cliente.tela.create({ data: { nombre: 'Felpa', unidadMedida: 'M' } });
  avioBoton = await cliente.avio.create({
    data: { clave: 'BOT-01', descripcion: 'Botón', unidad: 'pza' },
  });
  avioEtiqueta = await cliente.avio.create({
    data: { clave: 'ETI-01', descripcion: 'Etiqueta', unidad: 'pza' },
  });
  await cliente.avioProveedor.createMany({
    data: [
      { idAvio: avioBoton.id, idProveedor: proveedor.id, precio: 2 },
      { idAvio: avioEtiqueta.id, idProveedor: proveedor.id, precio: 1 },
    ],
  });
  const modelo = await cliente.modelo.create({ data: { codigo: 'A-100', descripcion: 'Playera' } });
  await cliente.modeloTela.create({
    data: { idModelo: modelo.id, idTela: telaFelpa.id, consumoPorPrenda: 1.5 },
  });
  await cliente.modeloAvio.createMany({
    data: [
      { idModelo: modelo.id, idAvio: avioBoton.id, consumoPorPrenda: 6 },
      { idModelo: modelo.id, idAvio: avioEtiqueta.id, consumoPorPrenda: 1 },
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

// ── 1. El catálogo ─────────────────────────────────────────────────────────────────────────────

describe('catálogo de motivos (seed idempotente)', () => {
  it('el seed REAL siembra los tres, sobre-corte fijo, y correrlo otra vez no duplica ni pisa', async () => {
    await limpiarBaseDatos(cliente);
    await sembrar(cliente);
    const primera = await cliente.motivoCompra.findMany({ orderBy: { orden: 'asc' } });
    expect(primera.map((m) => [m.codigo, m.nombre, m.fijo, m.activo])).toEqual([
      ['reposicion', 'Reposición', false, true],
      ['merma', 'Merma', false, true],
      [CODIGO_MOTIVO_SOBRE_CORTE, 'Sobre-corte', true, true],
    ]);
    // Lo que se edite en producción sobrevive al siguiente arranque (`update: {}`).
    await cliente.motivoCompra.update({
      where: { codigo: 'merma' },
      data: { nombre: 'Merma de proceso', activo: false },
    });
    await sembrar(cliente);
    const segunda = await cliente.motivoCompra.findMany({ orderBy: { orden: 'asc' } });
    expect(segunda).toHaveLength(3);
    expect(segunda.map((m) => m.id)).toEqual(primera.map((m) => m.id));
    expect(segunda.find((m) => m.codigo === 'merma')).toMatchObject({
      nombre: 'Merma de proceso',
      activo: false,
    });
  });

  it('la lista para los selectores trae sólo los ACTIVOS, en su orden; la pide quien ve o quien captura', async () => {
    await cliente.motivoCompra.update({ where: { codigo: 'merma' }, data: { activo: false } });
    const lista = await listarMotivosCompra(sesion(['compras.ver']), bd());
    expect(lista.map((m) => m.codigo)).toEqual(['reposicion', CODIGO_MOTIVO_SOBRE_CORTE]);
    const deQuienCaptura = await listarMotivosCompra(sesion(['compras.administrar']), bd());
    expect(deQuienCaptura).toEqual(lista);
    await expect(listarMotivosCompra(sesion(['ordenes.ver']), bd())).rejects.toThrow();
  });
});

// ── 2. La OC ───────────────────────────────────────────────────────────────────────────────────

describe('alta y edición de la OC con motivo', () => {
  it('nace con motivo (y lo dice la bitácora) o sin él (compra normal)', async () => {
    const extra = await ocDeBotones(motivo.reposicion);
    expect(extra.idMotivoCompra).toBe(motivo.reposicion);
    expect(extra.motivoCompra).toEqual({ codigo: 'reposicion', nombre: 'Reposición' });
    const [alta] = await bitacoraDe(extra.id);
    expect(alta?.datos).toMatchObject({ motivoCompra: 'reposicion' });
    // Una OC a mano no trae la marca de la explosión.
    expect(alta?.datos).not.toHaveProperty('motivoPropuestoPorExplosion');

    const normal = await ocDeBotones(undefined);
    expect(normal.idMotivoCompra).toBeNull();
    expect(normal.motivoCompra).toBeNull();
    const explicita = await ocDeBotones(null);
    expect(explicita.idMotivoCompra).toBeNull();
  });

  it('un motivo que no existe o que está desactivado se rechaza, y no nace OC', async () => {
    await expect(ocDeBotones(99_999)).rejects.toBeInstanceOf(ErrorNoEncontrado);
    await cliente.motivoCompra.update({ where: { id: motivo.merma }, data: { activo: false } });
    await expect(ocDeBotones(motivo.merma)).rejects.toBeInstanceOf(ErrorValidacion);
    expect(await cliente.ordenCompra.count()).toBe(0);
  });

  it('en borrador se cambia y se quita, y cada cambio queda con su antes → después', async () => {
    const oc = await ocDeBotones(null);
    const conMerma = await actualizarOC(sesion(), oc.id, { idMotivoCompra: motivo.merma }, bd());
    expect(conMerma.motivoCompra?.codigo).toBe('merma');
    const sinMotivo = await actualizarOC(sesion(), oc.id, { idMotivoCompra: null }, bd());
    expect(sinMotivo.idMotivoCompra).toBeNull();
    const ediciones = (await bitacoraDe(oc.id)).filter((b) => b.accion === 'MODIFICAR');
    expect(ediciones.map((b) => (b.datos as { motivoCompra?: unknown }).motivoCompra)).toEqual([
      { antes: null, despues: motivo.merma },
      { antes: motivo.merma, despues: null },
    ]);
  });

  it('⭐ con la OC RECIBIDA COMPLETA el motivo SÍ se cambia (anotación); los renglones siguen fijos', async () => {
    const oc = await ocDeBotones(null);
    await autorizarYRecibir(oc.id);
    expect((await obtenerOC(sesion(), oc.id, bd())).estatus).toBe('recibida_total');

    const editada = await actualizarOC(
      sesion(PERM_FIRMADA),
      oc.id,
      { idMotivoCompra: motivo.reposicion },
      bd(),
    );
    expect(editada.motivoCompra?.codigo).toBe('reposicion');
    expect(editada.estatus).toBe('recibida_total');
    const ultima = (await bitacoraDe(oc.id)).at(-1);
    expect(ultima?.accion).toBe('MODIFICAR');
    expect(ultima?.datos).toMatchObject({
      motivoCompra: { antes: null, despues: motivo.reposicion },
      edicionSobreOcAutorizada: true,
    });

    // Control: la puerta de la 0.225 sigue en pie para los renglones.
    await expect(
      actualizarOC(
        sesion(PERM_FIRMADA),
        oc.id,
        {
          idMotivoCompra: motivo.merma,
          lineas: [{ idAvio: avioBoton.id, cantidad: 150, precio: 2, unidad: 'pza' }],
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorConflicto);
    // …y como todo va en una transacción, el motivo de ESA llamada tampoco se escribió.
    expect((await obtenerOC(sesion(), oc.id, bd())).motivoCompra?.codigo).toBe('reposicion');
  });

  it('una OC firmada sigue la decisión (a): sin `compras.editar-autorizada` no se le cambia el motivo', async () => {
    const oc = await ocDeBotones(null);
    await autorizarOC(sesion(), oc.id, bd());
    await expect(
      actualizarOC(sesion(), oc.id, { idMotivoCompra: motivo.merma }, bd()),
    ).rejects.toBeInstanceOf(ErrorConflicto);
    expect((await obtenerOC(sesion(), oc.id, bd())).idMotivoCompra).toBeNull();
  });

  it('un motivo desactivado DESPUÉS se conserva al editar otra cosa, pero no se puede volver a elegir', async () => {
    const oc = await ocDeBotones(motivo.merma);
    const otra = await ocDeBotones(null);
    await cliente.motivoCompra.update({ where: { id: motivo.merma }, data: { activo: false } });

    // Editar otra cosa (o mandar el MISMO motivo) no lo toca ni lo rechaza.
    const editada = await actualizarOC(sesion(), oc.id, { observaciones: 'urgente' }, bd());
    expect(editada.idMotivoCompra).toBe(motivo.merma);
    const igual = await actualizarOC(sesion(), oc.id, { idMotivoCompra: motivo.merma }, bd());
    expect(igual.idMotivoCompra).toBe(motivo.merma);
    const sinCambio = (await bitacoraDe(oc.id)).at(-1)?.datos as { motivoCompra?: unknown };
    expect(sinCambio.motivoCompra).toBeUndefined();

    // Elegirlo en OTRA OC sí se rechaza.
    await expect(
      actualizarOC(sesion(), otra.id, { idMotivoCompra: motivo.merma }, bd()),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });
});

// ── 3. La lectura: filtro y agregado ───────────────────────────────────────────────────────────

describe('lista filtrada e importe por motivo (agregado en el servidor)', () => {
  /** Una OC a mano con los renglones dados. */
  function ocCon(idMotivoCompra: number | null, lineas: Parameters<typeof crearOC>[1]['lineas']) {
    return crearOC(
      sesion(),
      {
        fechaEntrega: '2026-09-30',
        idDireccionEntrega: direccion.id,
        idProveedor: proveedor.id,
        idMotivoCompra,
        lineas,
      },
      bd(),
    );
  }

  /**
   * Arma el escenario: normal, 2 reposiciones, 1 merma, 1 cancelada, 1 ajena. Lleva una tela CON
   * complemento en dos variantes (precio propio y al precio del cuerpo): el importe del motivo tiene
   * que sumar el complemento con la MISMA regla que el total de la OC.
   */
  async function escenario() {
    const jersey = await cliente.tela.create({
      data: { nombre: 'Jersey', unidadMedida: 'M', nombreComplemento: 'Cardigan' },
    });
    const normal = await ocDeBotones(null, 100, 2); // 200
    const rep1 = await ocCon(motivo.reposicion, [
      { idAvio: avioBoton.id, cantidad: 10, precio: 2.5, unidad: 'pza' }, // 25
      // complemento SIN precio propio ⇒ al precio del cuerpo: 1 × 5 + 1 × 5 = 10
      { idTela: jersey.id, cantidad: 1, precio: 5, unidad: 'm', cantidadComplemento: 1 },
    ]); // 35
    const rep2 = await ocDeBotones(motivo.reposicion, 3, 0.33); // 0.99
    const merma = await ocCon(motivo.merma, [
      { idAvio: avioBoton.id, cantidad: 7, precio: 1.15, unidad: 'pza' }, // 8.05
      { idAvio: avioEtiqueta.id, cantidad: 4, precio: 2, unidad: 'pza' }, // 8
      // complemento CON precio propio: 10 × 3 + 2 × 4 = 38
      {
        idTela: jersey.id,
        cantidad: 10,
        precio: 3,
        unidad: 'm',
        cantidadComplemento: 2,
        precioComplemento: 4,
      },
    ]); // 54.05
    // Cancelada: NO suma (el sobrecosto que no se compró no es sobrecosto).
    const cancelada = await ocDeBotones(motivo.merma, 1000, 1);
    await cancelarOC(sesion(), cancelada.id, { motivo: 'se canceló' }, bd());
    // De OTRA empresa: no existe para esta sesión (A9).
    await ocDeBotones(motivo.reposicion, 500, 1, sesion(PERM, otraEmpresa.id));
    return { normal, rep1, rep2, merma };
  }

  it('el filtro separa por motivo, por «compra extra» y por «compra normal», sólo de la empresa activa', async () => {
    const { normal, rep1, rep2, merma } = await escenario();
    const ids = async (p: Parameters<typeof listarOC>[1]) =>
      (await listarOC(sesion(), { ...p, porPagina: 100 }, bd())).datos.map((o) => o.id).sort();

    expect(await ids({ idMotivoCompra: motivo.reposicion })).toEqual([rep1.id, rep2.id].sort());
    expect(await ids({ conMotivo: true })).toEqual([rep1.id, rep2.id, merma.id].sort());
    expect(await ids({ conMotivo: false })).toEqual([normal.id]);
    // `idMotivoCompra` gana sobre `conMotivo`.
    expect(await ids({ idMotivoCompra: motivo.merma, conMotivo: false })).toEqual([merma.id]);
    // La cancelada sólo aparece si se piden las canceladas.
    expect(
      await ids({ idMotivoCompra: motivo.merma, incluirCanceladas: true }).then((l) => l.length),
    ).toBe(2);
  });

  it('el importe por motivo cuadra con una consulta SQL independiente Y con la columna «Total» de la lista', async () => {
    await escenario();
    const resumen = await resumenOC(sesion(), {}, bd());

    // (a) Contra SQL escrito aparte, sin el redondeo por renglón ni el orden del dominio.
    const crudo = await cliente.$queryRaw<{ id: number | null; ocs: bigint; importe: string }[]>`
      SELECT oc.id_motivo_compra AS id, COUNT(DISTINCT oc.id) AS ocs,
             SUM(l.cantidad * l.precio
                 + COALESCE(l.cantidad_complemento, 0)
                   * COALESCE(l.precio_complemento, l.precio))::text AS importe
      FROM ordenes_compra oc JOIN orden_compra_linea l ON l.id_orden_compra = oc.id
      WHERE oc.id_empresa = ${empresa.id} AND oc.estatus <> 'cancelada'
      GROUP BY oc.id_motivo_compra`;
    const esperadoSql = new Map(crudo.map((f) => [f.id, [Number(f.ocs), Number(f.importe)]]));
    expect(resumen.importePorMotivo).toHaveLength(esperadoSql.size);
    for (const r of resumen.importePorMotivo) {
      expect([r.ocs, r.importe]).toEqual(esperadoSql.get(r.idMotivoCompra));
    }

    // (b) Contra la suma de la columna «Total» de la lista (lo que ve el usuario), en TypeScript.
    const lista = (await listarOC(sesion(), { porPagina: 100 }, bd())).datos;
    const porMotivo = new Map<number | null, number>();
    for (const oc of lista) {
      porMotivo.set(oc.idMotivoCompra, (porMotivo.get(oc.idMotivoCompra) ?? 0) + oc.total);
    }
    for (const r of resumen.importePorMotivo) {
      expect(r.importe).toBeCloseTo(porMotivo.get(r.idMotivoCompra) ?? NaN, 2);
    }

    // (c) Las cifras, escritas a mano: compra normal primero, luego el catálogo en su orden.
    expect(resumen.importePorMotivo).toEqual([
      { idMotivoCompra: null, codigo: null, nombre: 'Compra normal', ocs: 1, importe: 200 },
      {
        idMotivoCompra: motivo.reposicion,
        codigo: 'reposicion',
        nombre: 'Reposición',
        ocs: 2,
        importe: 35.99,
      },
      { idMotivoCompra: motivo.merma, codigo: 'merma', nombre: 'Merma', ocs: 1, importe: 54.05 },
    ]);
  });

  it('el agregado respeta el filtro del resumen (motivo, empresa) y una OC sin renglones cuenta en cero', async () => {
    await escenario();
    await crearOC(
      sesion(),
      {
        fechaEntrega: '2026-09-30',
        idDireccionEntrega: direccion.id,
        idProveedor: proveedor.id,
        idMotivoCompra: motivo[CODIGO_MOTIVO_SOBRE_CORTE],
        lineas: [],
      },
      bd(),
    );
    const soloExtra = await resumenOC(sesion(), { conMotivo: true }, bd());
    expect(soloExtra.importePorMotivo.map((r) => [r.codigo, r.ocs, r.importe])).toEqual([
      ['reposicion', 2, 35.99],
      ['merma', 1, 54.05],
      [CODIGO_MOTIVO_SOBRE_CORTE, 1, 0],
    ]);
    const ajena = await resumenOC(sesion(PERM, otraEmpresa.id), {}, bd());
    expect(ajena.importePorMotivo).toEqual([
      {
        idMotivoCompra: motivo.reposicion,
        codigo: 'reposicion',
        nombre: 'Reposición',
        ocs: 1,
        importe: 500,
      },
    ]);
  });

  /**
   * ⭐ H2 del reviewer — el importe por motivo y la lista dicen LO MISMO con cualquier filtro. Se
   * cruza con la suma de la columna «Total» de la lista (lo que ve el usuario) en cada dimensión
   * del filtro: estatus (cada uno), canceladas, motivo, proveedor, búsqueda por nombre y por folio,
   * fechas y orden ligada. Es también la red de las dos pinturas del filtro (Prisma y SQL, H4).
   */
  it('⭐ el importe por motivo cuadra con la lista con CUALQUIER filtro (estatus y canceladas incluidos)', async () => {
    const { rep1, rep2, merma } = await escenario();
    // Variedad de estatus: una reposición autorizada, otra recibida completa y la merma autorizada
    // (la merma lleva tela, que ya no se recibe desde la OC).
    await autorizarOC(sesion(), rep1.id, bd());
    await autorizarYRecibir(rep2.id);
    await autorizarOC(sesion(), merma.id, bd());
    // Otro proveedor y una OC ligada a la orden de producción.
    const otro = await cliente.proveedor.create({ data: { nombre: 'Hilos Ñandú' } });
    const deOtro = await crearOC(
      sesion(),
      {
        fechaEntrega: '2026-09-30',
        idDireccionEntrega: direccion.id,
        idProveedor: otro.id,
        idMotivoCompra: motivo.reposicion,
        lineas: [{ idAvio: avioEtiqueta.id, cantidad: 9, precio: 3, unidad: 'pza' }],
      },
      bd(),
    ); // 27
    const ligada = await ocCon(null, [
      { idAvio: avioBoton.id, cantidad: 4, precio: 2, unidad: 'pza', idOrden }, // 8
    ]);
    // Una SEGUNDA orden con su propia OC: el filtro por orden tiene que distinguir de cuál es.
    const op1 = await cliente.orden.findUniqueOrThrow({ where: { id: idOrden } });
    const op2 = await cliente.orden.create({
      data: {
        folio: 2n,
        idEmpresa: empresa.id,
        idModelo: op1.idModelo,
        idCliente: op1.idCliente,
      },
    });
    await sembrarRecetaDeOrden(cliente, op2.id, op1.idModelo);
    await ocCon(motivo.merma, [
      { idAvio: avioBoton.id, cantidad: 5, precio: 2, unidad: 'pza', idOrden: op2.id }, // 10
    ]);
    const hoy = deOtro.fecha!;

    async function cuadra(filtro: Parameters<typeof listarOC>[1]) {
      const lista = (await listarOC(sesion(), { ...filtro, porPagina: 100 }, bd())).datos;
      const esperado = new Map<number | null, { ocs: number; importe: number }>();
      for (const oc of lista) {
        const previo = esperado.get(oc.idMotivoCompra) ?? { ocs: 0, importe: 0 };
        esperado.set(oc.idMotivoCompra, {
          ocs: previo.ocs + 1,
          importe: Math.round((previo.importe + oc.total) * 100) / 100,
        });
      }
      const { importePorMotivo } = await resumenOC(sesion(), { ...filtro }, bd());
      const obtenido = new Map(
        importePorMotivo.map((r) => [r.idMotivoCompra, { ocs: r.ocs, importe: r.importe }]),
      );
      expect(obtenido, JSON.stringify(filtro)).toEqual(esperado);
      return lista.length;
    }

    // Sin filtro: TODO lo no cancelado, borradores incluidos (lo que muestra la lista).
    expect(await cuadra({})).toBe(7);
    for (const estatus of [
      'borrador',
      'autorizada',
      'recibida_total',
      'cancelada',
      'recibida_parcial',
    ] as const) {
      await cuadra({ estatus });
    }
    expect(await cuadra({ incluirCanceladas: true })).toBe(8);
    await cuadra({ conMotivo: true, incluirCanceladas: true });
    await cuadra({ conMotivo: false });
    await cuadra({ idMotivoCompra: motivo.reposicion, estatus: 'borrador' });
    expect(await cuadra({ idProveedor: otro.id })).toBe(1);
    expect(await cuadra({ busqueda: 'nandu' })).toBe(1); // sin acentos ni mayúsculas (fila 0.214)
    expect(await cuadra({ busqueda: String(ligada.numCompra) })).toBe(1);
    expect(await cuadra({ busqueda: 'no existe' })).toBe(0);
    expect(await cuadra({ fechaDesde: hoy, fechaHasta: hoy })).toBe(7);
    expect(await cuadra({ fechaHasta: '2000-01-01' })).toBe(0);
    // El borde de «hasta»: ayer NO incluye las OC de hoy (`<` el día siguiente, no `<=`).
    const ayer = new Date(`${hoy}T00:00:00.000Z`);
    ayer.setUTCDate(ayer.getUTCDate() - 1);
    expect(await cuadra({ fechaHasta: ayer.toISOString().slice(0, 10) })).toBe(0);
    // Y el de «desde»: mañana tampoco.
    const manana = new Date(`${hoy}T00:00:00.000Z`);
    manana.setUTCDate(manana.getUTCDate() + 1);
    expect(await cuadra({ fechaDesde: manana.toISOString().slice(0, 10) })).toBe(0);
    expect(await cuadra({ idOrden })).toBe(1);
    expect(await cuadra({ idOrden: op2.id })).toBe(1);
  });

  it('H2: filtrar por estatus SACA del importe lo que la lista no muestra (y la inversa)', async () => {
    const { rep1 } = await escenario();
    await autorizarOC(sesion(), rep1.id, bd());
    // Sólo autorizadas: rep1 (35) — y NINGÚN borrador.
    const autorizadas = await resumenOC(sesion(), { estatus: 'autorizada' }, bd());
    expect(autorizadas.importePorMotivo.map((r) => [r.codigo, r.ocs, r.importe])).toEqual([
      ['reposicion', 1, 35],
    ]);
    // Sin filtro, los borradores SÍ cuentan (la lista los muestra).
    const todas = await resumenOC(sesion(), {}, bd());
    expect(todas.importePorMotivo.map((r) => [r.codigo, r.ocs, r.importe])).toEqual([
      [null, 1, 200],
      ['reposicion', 2, 35.99],
      ['merma', 1, 54.05],
    ]);
    // Con canceladas, la merma cancelada (1,000) entra — como en la lista.
    const conCanceladas = await resumenOC(sesion(), { incluirCanceladas: true }, bd());
    expect(conCanceladas.importePorMotivo.find((r) => r.codigo === 'merma')).toMatchObject({
      ocs: 2,
      importe: 1054.05,
    });
    // Los KPIs de abiertas NO se mueven con el estatus de la lista.
    expect((await resumenOC(sesion(), { estatus: 'borrador' }, bd())).ocAbiertas).toBe(
      autorizadas.ocAbiertas,
    );
  });

  it('sin OC que cumplan el filtro, el agregado viene vacío', async () => {
    const vacio = await resumenOC(sesion(), {}, bd());
    expect(vacio).toEqual({ ocAbiertas: 0, porRecibir: 0, importePorMotivo: [] });
  });
});

// ── 4. La explosión: el sobre-corte propuesto ──────────────────────────────────────────────────

describe('explosión: la OC del sobre-corte nace con su motivo propuesto (fila 0.232)', () => {
  const cuerpo = (extra: Record<string, unknown> = {}) => ({
    fechaEntrega: '2026-09-30',
    idsOrden: [idOrden],
    idsRequerimiento: [] as number[],
    ...extra,
  });
  const previa = (extra: Record<string, unknown> = {}) =>
    previoCompraDesdeExplosion(sesion(), cuerpo(extra), bd());
  const comprar = (extra: Record<string, unknown> = {}) =>
    generarOCDesdeExplosion(sesion(), cuerpo(extra), bd());
  const explotar = () => explosionarOrden(sesion(), idOrden, bd());

  /** Corta Rojo CH/M. */
  async function cortar(ch: number, m: number): Promise<void> {
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
            ],
          },
        ],
      },
      bd(),
    );
  }

  async function motivoDeLaOc(idOc: number) {
    return (await obtenerOC(sesion(), idOc, bd())).motivoCompra?.codigo ?? null;
  }

  it('primera pasada (antes de cortar): sin motivo, sin aviso; la bitácora dice que no propuso nada', async () => {
    await explotar();
    const plan = await previa();
    expect(plan.proveedores).toHaveLength(1);
    expect(plan.proveedores[0]).toMatchObject({
      motivoPropuesto: null,
      sobreCorteMixto: false,
      idMotivoCompra: null,
    });
    const r = await comprar();
    const idOc = r.ordenesCompra[0]!.idOrdenCompra;
    expect(await motivoDeLaOc(idOc)).toBeNull();
    expect((await bitacoraDe(idOc))[0]?.datos).toMatchObject({
      motivoCompra: null,
      motivoPropuestoPorExplosion: null,
    });
  });

  it('⭐ segunda pasada después de cortar de más: nace como SOBRE-CORTE', async () => {
    await explotar();
    const primera = await comprar();
    await autorizarYRecibir(primera.ordenesCompra[0]!.idOrdenCompra);
    await cortar(40, 80); // 120: 20 de sobre-corte

    await explotar();
    const plan = await previa();
    const p = plan.proveedores[0]!;
    expect(plan.ordenes[0]?.piezasSobreCorte).toBe(20);
    expect(p.motivoPropuesto).toEqual({
      idMotivoCompra: motivo[CODIGO_MOTIVO_SOBRE_CORTE],
      codigo: CODIGO_MOTIVO_SOBRE_CORTE,
      nombre: 'Sobre-corte',
    });
    expect(p.idMotivoCompra).toBe(motivo[CODIGO_MOTIVO_SOBRE_CORTE]);
    expect(p.sobreCorteMixto).toBe(false);
    expect(plan.avisos.some((a) => a.includes('sobre-corte'))).toBe(false);

    const segunda = await comprar();
    const idOc = segunda.ordenesCompra[0]!.idOrdenCompra;
    expect(await motivoDeLaOc(idOc)).toBe(CODIGO_MOTIVO_SOBRE_CORTE);
    expect((await bitacoraDe(idOc))[0]?.datos).toMatchObject({
      motivoCompra: CODIGO_MOTIVO_SOBRE_CORTE,
      motivoPropuestoPorExplosion: CODIGO_MOTIVO_SOBRE_CORTE,
    });
  });

  it('lo elegido en la previa GANA: «compra normal» o reposición, aunque el sistema proponga sobre-corte', async () => {
    await explotar();
    await comprar();
    await cortar(40, 80);
    await explotar();

    const elegido = { motivosPorProveedor: [{ idProveedor: proveedor.id, idMotivoCompra: null }] };
    const plan = await previa(elegido);
    expect(plan.proveedores[0]?.motivoPropuesto?.codigo).toBe(CODIGO_MOTIVO_SOBRE_CORTE);
    expect(plan.proveedores[0]?.idMotivoCompra).toBeNull();
    const r = await comprar(elegido);
    const idOc = r.ordenesCompra[0]!.idOrdenCompra;
    expect(await motivoDeLaOc(idOc)).toBeNull();
    // La bitácora conserva lo que el sistema propuso, aunque la persona eligiera otra cosa.
    expect((await bitacoraDe(idOc))[0]?.datos).toMatchObject({
      motivoCompra: null,
      motivoPropuestoPorExplosion: CODIGO_MOTIVO_SOBRE_CORTE,
    });
  });

  it('elegir en la previa un motivo que no existe o está desactivado BLOQUEA (y no nace nada)', async () => {
    await explotar();
    await cliente.motivoCompra.update({ where: { id: motivo.merma }, data: { activo: false } });
    for (const idMotivoCompra of [99_999, motivo.merma]) {
      const elegido = { motivosPorProveedor: [{ idProveedor: proveedor.id, idMotivoCompra }] };
      const plan = await previa(elegido);
      expect(plan.bloqueos.some((b) => b.includes('no existe o está desactivado'))).toBe(true);
      await expect(comprar(elegido)).rejects.toBeInstanceOf(ErrorValidacion);
    }
    expect(await cliente.ordenCompra.count()).toBe(0);
    // Y con uno válido, nace con él (la previa también puede ETIQUETAR una primera pasada).
    const r = await comprar({
      motivosPorProveedor: [{ idProveedor: proveedor.id, idMotivoCompra: motivo.reposicion }],
    });
    expect(await motivoDeLaOc(r.ordenesCompra[0]!.idOrdenCompra)).toBe('reposicion');
  });

  it('MIXTO (el extra de un avío + otro avío que se compra por primera vez): sin motivo y con aviso', async () => {
    const ex = await explotar();
    const boton = ex.grupos.flatMap((g) => g.renglones).find((r) => r.idAvio === avioBoton.id)!;
    // Primera pasada: sólo el botón.
    await comprar({ idsRequerimiento: [boton.id] });
    await cortar(40, 80);
    await explotar();

    const plan = await previa();
    const p = plan.proveedores[0]!;
    expect(p.renglones.map((r) => r.idMaterial).sort()).toEqual(
      [avioBoton.id, avioEtiqueta.id].sort(),
    );
    expect(p.sobreCorteMixto).toBe(true);
    expect(p.motivoPropuesto).toBeNull();
    expect(p.idMotivoCompra).toBeNull();
    expect(plan.avisos).toContain(avisoDeSobreCorteMixto(proveedor.nombre));
    expect(plan.bloqueos).toEqual([]);

    // Si el comprador elige, el aviso se calla (ya decidió).
    const elegido = {
      motivosPorProveedor: [
        { idProveedor: proveedor.id, idMotivoCompra: motivo[CODIGO_MOTIVO_SOBRE_CORTE] },
      ],
    };
    expect((await previa(elegido)).avisos).not.toContain(avisoDeSobreCorteMixto(proveedor.nombre));

    const r = await comprar();
    expect(await motivoDeLaOc(r.ordenesCompra[0]!.idOrdenCompra)).toBeNull();
  });

  it('PRIMERA compra después de cortar (la del caso raro): incluye el extra pero NO es sobrecosto aparte', async () => {
    await cortar(40, 80);
    await explotar();
    const plan = await previa();
    expect(plan.ordenes[0]?.piezasSobreCorte).toBe(20);
    expect(plan.proveedores[0]).toMatchObject({
      motivoPropuesto: null,
      sobreCorteMixto: false,
      idMotivoCompra: null,
    });
    expect(plan.avisos.some((a) => a.includes('sobre-corte'))).toBe(false);
  });

  /**
   * 🔴 H1 del reviewer — el extra se mide POR CANTIDAD. `piezasSobreCorte` se queda fijo para
   * siempre; con sólo «ya había OC» estas dos compras salían ENTERAS como sobre-corte.
   */
  it('🔴 A: primera compra CORTA (500 de 600) + cortar 120 ⇒ la OC sale MIXTA, no sobre-corte', async () => {
    const ex = await explotar();
    const boton = ex.grupos.flatMap((g) => g.renglones).find((r) => r.idAvio === avioBoton.id)!;
    await comprar({
      ajustes: [
        {
          tipo: 'avio',
          idMaterial: avioBoton.id,
          idColor: boton.idColorPrenda,
          idProveedor: proveedor.id,
          cantidadTotal: 500,
        },
      ],
    });
    await cortar(40, 80);
    await explotar();
    const plan = await previa();
    const p = plan.proveedores[0]!;
    expect(plan.ordenes[0]?.piezasSobreCorte).toBe(20);
    // Botón: faltan 220 (100 de lo pedido + 120 del corte) ⇒ 500 < 600: compra NORMAL.
    // Etiqueta: faltan 20 (sólo el corte) ⇒ 100 ≥ 100: del EXTRA. ⇒ la OC mezcla.
    expect(
      p.renglones.map((r) => [r.idMaterial, r.cantidadTotal]).sort((a, b) => a[0]! - b[0]!),
    ).toEqual(
      [
        [avioBoton.id, 220],
        [avioEtiqueta.id, 20],
      ].sort((a, b) => a[0]! - b[0]!),
    );
    expect(p).toMatchObject({ motivoPropuesto: null, sobreCorteMixto: true, idMotivoCompra: null });
    expect(plan.avisos).toContain(avisoDeSobreCorteMixto(proveedor.nombre));
  });

  it('«con esto queda cubierto» cuenta como comprado: 599 + 1 cubierto cubre lo pedido ⇒ sobre-corte', async () => {
    const ex = await explotar();
    const boton = ex.grupos.flatMap((g) => g.renglones).find((r) => r.idAvio === avioBoton.id)!;
    await comprar({
      ajustes: [
        {
          tipo: 'avio',
          idMaterial: avioBoton.id,
          idColor: boton.idColorPrenda,
          idProveedor: proveedor.id,
          cantidadTotal: 599,
          restoCubierto: true,
        },
      ],
    });
    await cortar(40, 80);
    await explotar();
    const p = (await previa()).proveedores[0]!;
    // Botón: 720 − 599 − 1 = 120 (sólo el corte). Etiqueta: 20. Las dos del extra.
    expect(p.renglones.map((r) => r.cantidadTotal).sort((a, b) => a - b)).toEqual([20, 120]);
    expect(p.motivoPropuesto?.codigo).toBe(CODIGO_MOTIVO_SOBRE_CORTE);
    expect(p.sobreCorteMixto).toBe(false);
  });

  it('🔴 B: receta corregida DESPUÉS de cortar (6 → 8 por prenda) ⇒ la corrección es compra normal', async () => {
    await cortar(40, 80);
    await explotar();
    await comprar(); // primera compra tras cortar: 720 botones + 120 etiquetas, compra normal
    // La corrección de la receta (el camino del dominio es el de la fila 0.257; aquí se escribe
    // directo para aislar la regla del motivo de la del bloqueo por receta cambiada).
    await cliente.ordenAvio.updateMany({
      where: { idOrden, idAvio: avioBoton.id },
      data: { consumoPorPrenda: 8 },
    });
    await explotar();
    const plan = await previa();
    const p = plan.proveedores[0]!;
    expect(plan.bloqueos).toEqual([]);
    // 960 − 720 = 240 botones. Lo pedido con la receta corregida es 800 > 720 comprados ⇒ NORMAL.
    expect(p.renglones.map((r) => [r.idMaterial, r.cantidadTotal])).toEqual([[avioBoton.id, 240]]);
    expect(p).toMatchObject({
      motivoPropuesto: null,
      sobreCorteMixto: false,
      idMotivoCompra: null,
    });
  });

  it('un FALTANTE normal (se compró de menos, sin cortar de más) NO es sobre-corte', async () => {
    const ex = await explotar();
    const boton = ex.grupos.flatMap((g) => g.renglones).find((r) => r.idAvio === avioBoton.id)!;
    // Primera pasada comprando 500 de los 600 botones.
    await comprar({
      ajustes: [
        {
          tipo: 'avio',
          idMaterial: avioBoton.id,
          idColor: boton.idColorPrenda,
          idProveedor: proveedor.id,
          cantidadTotal: 500,
        },
      ],
    });
    await explotar();
    const plan = await previa();
    expect(plan.ordenes[0]?.piezasSobreCorte).toBe(0);
    // Lo que falta es del botón, y esa orden YA tenía OC de botón: sin el sobre-corte, no es extra.
    expect(plan.proveedores[0]?.renglones.map((r) => r.idMaterial)).toEqual([avioBoton.id]);
    expect(plan.proveedores[0]).toMatchObject({
      motivoPropuesto: null,
      sobreCorteMixto: false,
      idMotivoCompra: null,
    });
  });

  it('si el motivo sobre-corte se desactivó, la segunda pasada nace como compra normal (se tolera)', async () => {
    await explotar();
    await comprar();
    await cortar(40, 80);
    await explotar();
    await cliente.motivoCompra.update({
      where: { id: motivo[CODIGO_MOTIVO_SOBRE_CORTE] },
      data: { activo: false },
    });
    const plan = await previa();
    expect(plan.proveedores[0]?.motivoPropuesto).toBeNull();
    const r = await comprar();
    expect(await motivoDeLaOc(r.ordenesCompra[0]!.idOrdenCompra)).toBeNull();
  });

  /**
   * 🔴 **H5 del reviewer — AVÍO CON CONSUMO POR TALLA.** Lo pedido se calcula EXACTO con la regla R18
   * de la explosión; con una regla de tres (`requerido × pedidas / base`) estos dos casos salían al
   * revés. Botón CH 0.75 / M 0.80, sin la etiqueta en la receta para que la OC sea sólo del botón.
   */
  async function botonPorTalla(id = idOrden): Promise<void> {
    const oa = await cliente.ordenAvio.findFirstOrThrow({
      where: { idOrden: id, idAvio: avioBoton.id },
    });
    await cliente.ordenAvio.update({ where: { id: oa.id }, data: { consumoPorTalla: true } });
    await cliente.ordenAvioTalla.createMany({
      data: [
        { idOrdenAvio: oa.id, idTalla: tallaCH.id, consumo: 0.75 },
        { idOrdenAvio: oa.id, idTalla: tallaM.id, consumo: 0.8 },
      ],
    });
    await cliente.ordenAvio.deleteMany({ where: { idOrden: id, idAvio: avioEtiqueta.id } });
  }

  it('🔴 H5: consumo por talla, el extra en la talla de MAYOR consumo (M) ⇒ SOBRE-CORTE', async () => {
    await botonPorTalla();
    await explotar();
    await comprar(); // lo pedido exacto: CH 40 × 0.75 + M 60 × 0.80 = 78
    await cortar(40, 80); // +20 en M ⇒ requerido 30 + 64 = 94; faltan 16, todo del corte
    await explotar();
    const plan = await previa();
    const p = plan.proveedores[0]!;
    expect(p.renglones.map((r) => [r.idMaterial, r.cantidadTotal])).toEqual([[avioBoton.id, 16]]);
    // Una regla de tres diría que lo pedido era 94 × 100/120 = 78.33 > 78 ⇒ «normal», sin aviso.
    expect(p.motivoPropuesto?.codigo).toBe(CODIGO_MOTIVO_SOBRE_CORTE);
    expect(p.sobreCorteMixto).toBe(false);
  });

  it('🔴 H5: consumo por talla, compra CORTA y el extra en la talla de MENOR consumo (CH) ⇒ NORMAL', async () => {
    await botonPorTalla();
    const ex = await explotar();
    const boton = ex.grupos.flatMap((g) => g.renglones).find((r) => r.idAvio === avioBoton.id)!;
    // Se compran 77.6 de los 78 pedidos (corto por 0.4).
    await comprar({
      ajustes: [
        {
          tipo: 'avio',
          idMaterial: avioBoton.id,
          idColor: boton.idColorPrenda,
          idProveedor: proveedor.id,
          cantidadTotal: 77.6,
        },
      ],
    });
    await cortar(60, 60); // +20 en CH ⇒ requerido 45 + 48 = 93
    await explotar();
    const p = (await previa()).proveedores[0]!;
    expect(p.renglones.map((r) => [r.idMaterial, r.cantidadTotal])).toEqual([[avioBoton.id, 15.4]]);
    // Una regla de tres diría que lo pedido era 93 × 100/120 = 77.5 ≤ 77.6 ⇒ «sobre-corte».
    expect(p).toMatchObject({
      motivoPropuesto: null,
      sobreCorteMixto: false,
      idMotivoCompra: null,
    });
  });

  it('H5: orden CON PACKS (el mismo color en dos tendidos) ⇒ lo pedido suma los dos packs: compra corta = NORMAL', async () => {
    const op1 = await cliente.orden.findUniqueOrThrow({ where: { id: idOrden } });
    const conPacks = await cliente.orden.create({
      data: {
        folio: 3n,
        idEmpresa: empresa.id,
        idModelo: op1.idModelo,
        idCliente: op1.idCliente,
        idMaquilero: maquilero.id,
        estado: 'completa',
        fechaCompletada: new Date(),
        lineas: {
          create: ['A', 'B'].map((pack) => ({
            idColor: colorRojo.id,
            pack,
            tallas: {
              create: [
                { idTalla: tallaCH.id, cantidad: 20 },
                { idTalla: tallaM.id, cantidad: 30 },
              ],
            },
          })),
        },
      },
    });
    idOrden = conPacks.id;
    await sembrarRecetaDeOrden(cliente, idOrden, op1.idModelo);
    await botonPorTalla();
    const ex = await explotar();
    const boton = ex.grupos.flatMap((g) => g.renglones).find((r) => r.idAvio === avioBoton.id)!;
    // Lo pedido con los DOS packs es 78; se compran 77.6. Si lo pedido contara sólo un pack (39),
    // los 77.6 «cubrirían» y la compra de lo que falta saldría como sobre-corte.
    await comprar({
      ajustes: [
        {
          tipo: 'avio',
          idMaterial: avioBoton.id,
          idColor: boton.idColorPrenda,
          idProveedor: proveedor.id,
          cantidadTotal: 77.6,
        },
      ],
    });
    await registrarCorte(
      sesion(),
      {
        idOrden,
        idCortador: cortador.id,
        fecha: '2026-09-01',
        lineas: [
          {
            idColor: colorRojo.id,
            pack: 'A',
            tallas: [
              { idTalla: tallaCH.id, cantidad: 40 },
              { idTalla: tallaM.id, cantidad: 80 },
            ],
          },
        ],
      },
      bd(),
    );
    await explotar();
    const plan = await previa();
    const p = plan.proveedores[0]!;
    expect(plan.ordenes[0]?.piezasSobreCorte).toBe(20);
    expect(p.renglones.map((r) => r.cantidadTotal)).toEqual([16.4]);
    expect(p).toMatchObject({ motivoPropuesto: null, sobreCorteMixto: false });
  });

  it('H5: colores FUSIONADOS después de comprar ⇒ lo pedido no depende del color', async () => {
    const op1 = await cliente.orden.findUniqueOrThrow({ where: { id: idOrden } });
    const duplicado = await cliente.color.create({ data: { nombre: 'Rojo Pantone 18-1663' } });
    const conDuplicado = await cliente.orden.create({
      data: {
        folio: 4n,
        idEmpresa: empresa.id,
        idModelo: op1.idModelo,
        idCliente: op1.idCliente,
        idMaquilero: maquilero.id,
        estado: 'completa',
        fechaCompletada: new Date(),
        lineas: {
          create: [duplicado.id, colorRojo.id].map((idColor) => ({
            idColor,
            tallas: {
              create: [
                { idTalla: tallaCH.id, cantidad: 20 },
                { idTalla: tallaM.id, cantidad: 30 },
              ],
            },
          })),
        },
      },
    });
    idOrden = conDuplicado.id;
    await sembrarRecetaDeOrden(cliente, idOrden, op1.idModelo);
    await botonPorTalla();
    await explotar();
    await comprar(); // dos renglones de color (39 + 39) = 78
    await cortar(40, 80); // todo bajo «Rojo»
    await fusionarColores(
      sesion([...PERM, 'colores.administrar']),
      { idDestino: colorRojo.id, origenes: [duplicado.id] },
      bd(),
    );
    await explotar();
    const plan = await previa();
    const p = plan.proveedores[0]!;
    expect(plan.ordenes[0]?.piezasSobreCorte).toBe(20);
    expect(p.renglones.map((r) => r.cantidadTotal)).toEqual([16]);
    expect(p.motivoPropuesto?.codigo).toBe(CODIGO_MOTIVO_SOBRE_CORTE);
  });
});
