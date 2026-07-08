/**
 * Integración del ETL de pedidos y órdenes (F2-E5) — corre en CI (testcontainers), NO en local.
 *
 * Como en F1, la carpeta `Respaldo CLAUDE/TABLAS/` NO existe en CI: este test apunta el ETL a
 * fixtures CSV pequeños COMMITEADOS (`migracion/__fixtures__/tablas-f2/`) vía `TABLAS_DIR`. Antes
 * de correr el ETL de F2 siembra a mano el ESTADO de F1 que F2 consume (catálogos + los mapeos
 * `MapeoMigracion` de empresas/clientes/modelos/colores), para no depender del ETL de F1.
 *
 * Verifica:
 *  • Conteos EXACTOS deterministas de los fixtures (pedidos, renglones, reales, órdenes, matriz,
 *    referencias, comentarios) — cada uno ejercita un escenario (modelo sin mapeo omitido, orden
 *    huérfana sin pedido, cancelada con/sin motivo, Monarch default descartado, color al vuelo,
 *    doble curva).
 *  • IDEMPOTENCIA: 2ª corrida no duplica (conteos idénticos).
 *  • MODO MIGRACIÓN: folio EXPLÍCITO, idPedidoLinea NULL en la huérfana, estado/fechaCompletada
 *    desde FechaDet/OrdCancelada (no re-sellados), snapshots V1, auditoría original.
 *  • SIEMBRA DE SECUENCIAS: tras migrar, un pedido y una orden NUEVOS (captura por el servicio
 *    normal) salen con folio > máximo migrado, sin colisión con el unique (idEmpresa, folio).
 */
import { fileURLToPath } from 'node:url';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { crearPedido } from '../src/dominio/pedidos/pedidos.js';
import { crearOrden } from '../src/dominio/produccion/ordenes.js';
import type { ServicioArchivos } from '../src/comun/archivos.js';
import type { PrismaClient } from '../src/datos/index.js';
import { clientePruebas, limpiarBaseDatos, sembrarPermisos } from '../src/pruebas/contexto.js';

import { ejecutarEtlPedidosOrdenes } from './etl-pedidos-ordenes.js';
import { sesionEtl } from './comun/sesion-etl.js';
import { ENTIDAD_MAPEO, guardarMapeo } from './comun/mapeo.js';
import { CAMPO_D7_PEDIDO_CLIENTE } from './loaders/clientes.js';

let cliente: PrismaClient;

/**
 * Servicio de archivos NO-OP para los tests: el alta nueva por el servicio normal (`crearPedido`)
 * NO toca R2 (el modelo no tiene fotos), pero el parámetro `archivos` de `crearPedido` se evalúa
 * por defecto a `servicioArchivos()`, que valida las vars `R2_*` (ausentes en CI) y truena. Pasar
 * este stub corta esa dependencia: replica el patrón de `pedidos.int.test.ts`/`ordenes.int.test.ts`
 * (inyectar `bd` + `archivos` en vez de los defaults que construyen R2).
 */
const archivosStub: ServicioArchivos = {
  solicitarSubida() {
    throw new Error('archivosStub.solicitarSubida no debe llamarse en este test');
  },
  urlDescarga() {
    throw new Error('archivosStub.urlDescarga no debe llamarse en este test');
  },
  subirObjeto() {
    throw new Error('archivosStub.subirObjeto no debe llamarse en este test');
  },
  eliminarObjeto() {
    throw new Error('archivosStub.eliminarObjeto no debe llamarse en este test');
  },
};
/** Contexto de BD del testcontainer (mismo `cliente` que usan los loaders), para inyectar a los servicios. */
const bd = () => ({ cliente });

const DIR_FIXTURES = fileURLToPath(new URL('./__fixtures__/tablas-f2', import.meta.url));
let tablasDirPrevio: string | undefined;

beforeAll(() => {
  cliente = clientePruebas();
});
afterAll(async () => {
  await cliente.$disconnect();
});

/** Empresa FR Moda (la que usan los fixtures, IdEmpresas=8 → idEmpresa nuevo). */
let idEmpresaFR: number;

/**
 * Siembra el estado de F1 que el ETL de F2 consume: empresa, clientes (+ campo D7), modelos
 * (con código), colores, tallas, y los mapeos `MapeoMigracion` correspondientes (clave vieja del
 * fixture → id nuevo). NO usa el ETL de F1 (lo desacopla).
 */
async function sembrarEstadoF1(): Promise<void> {
  await sembrarPermisos(cliente);

  const empresa = await cliente.empresa.upsert({
    where: { nombre: 'FR Moda' },
    update: {},
    create: { nombre: 'FR Moda', favorita: true, paraIpt: true, paraEdr: true },
  });
  idEmpresaFR = empresa.id;
  await guardarMapeo(cliente, ENTIDAD_MAPEO.empresa, 8, empresa.id);

  // Clientes (IdClientes 1=Liverpool, 2=Bodega) + su campo D7.
  for (const [idViejo, nombre] of [
    [1, 'Liverpool'],
    [2, 'Bodega Caballero'],
  ] as const) {
    const c = await cliente.cliente.create({ data: { nombre } });
    await cliente.clienteCampo.create({
      data: { idCliente: c.id, etiqueta: CAMPO_D7_PEDIDO_CLIENTE },
    });
    await guardarMapeo(cliente, ENTIDAD_MAPEO.cliente, idViejo, c.id);
  }

  // Modelos (IdModelos 1=M001, 2=M002, 3=M003) — el código importa para el Monarch default.
  for (const [idViejo, codigo, activo] of [
    [1, 'M001', true],
    [2, 'M002', true],
    [3, 'M003', false],
  ] as const) {
    const m = await cliente.modelo.create({ data: { codigo, activo } });
    await guardarMapeo(cliente, ENTIDAD_MAPEO.modelo, idViejo, m.id, { codigo });
  }

  // Colores del catálogo (Rojo/Negro/Azul); "ColorNuevoX" NO se siembra (lo crea el ETL al vuelo).
  for (const nombre of ['Rojo', 'Negro', 'Azul']) {
    const col = await cliente.color.create({ data: { nombre } });
    // Mapeo texto→idColor (como deja F1).
    await guardarMapeo(cliente, ENTIDAD_MAPEO.color, nombre, col.id, { canonico: nombre });
  }

  // Tallas del catálogo (las que aparecen en las cadenas Tallas de los fixtures).
  let orden = 0;
  for (const etiqueta of ['XC', 'CH', 'M', 'G', 'XG', 'EX', '6', '12', '18', '2', '3', '3X']) {
    orden += 1;
    await cliente.talla.create({ data: { etiqueta, orden } });
  }
}

beforeEach(async () => {
  tablasDirPrevio = process.env.TABLAS_DIR;
  process.env.TABLAS_DIR = DIR_FIXTURES;
  await limpiarBaseDatos(cliente);
  await sembrarEstadoF1();
});

afterEach(() => {
  if (tablasDirPrevio === undefined) {
    delete process.env.TABLAS_DIR;
  } else {
    process.env.TABLAS_DIR = tablasDirPrevio;
  }
});

/** Snapshot de conteos de F2 (para idempotencia y aserciones exactas). */
async function conteos(): Promise<Record<string, number>> {
  return {
    pedidos: await cliente.pedido.count(),
    pedidoLinea: await cliente.pedidoLinea.count(),
    reales: await cliente.pedidoReal.count(),
    realLinea: await cliente.pedidoRealLinea.count(),
    ordenes: await cliente.orden.count(),
    ordenLinea: await cliente.ordenLinea.count(),
    ordenLineaTalla: await cliente.ordenLineaTalla.count(),
    referencias: await cliente.ordenReferencia.count(),
    comentarios: await cliente.ordenComentario.count(),
    colores: await cliente.color.count(),
  };
}

describe('ETL de pedidos y órdenes F2-E5 (integración, fixtures committeados)', () => {
  it('carga end-to-end con conteos EXACTOS y es IDEMPOTENTE (2ª corrida no duplica)', async () => {
    await ejecutarEtlPedidosOrdenes(cliente);
    const tras1 = await conteos();

    expect(tras1.pedidos).toBe(3); // 3 pedidos
    expect(tras1.pedidoLinea).toBe(4); // 5 det, 1 con modelo 999 sin mapeo → omitido
    expect(tras1.reales).toBe(2);
    expect(tras1.realLinea).toBe(3); // 4 det, 1 liga al IdPedidosDet omitido → omitido
    expect(tras1.ordenes).toBe(4);
    expect(tras1.ordenLinea).toBe(6); // orden1: Rojo+Negro+ColorNuevoX(3); orden2:Rojo; orden3:Azul; orden4:Negro
    // Matriz despivotada: orden1 Rojo(4 tallas)+Negro(1)+ColorNuevoX(1)=6; orden2 Rojo(4)=4;
    // orden3 Azul(5)=5; orden4 Negro(4)=4 → 19.
    expect(tras1.ordenLineaTalla).toBe(19);
    expect(tras1.referencias).toBe(1); // orden1 Monarch real; orden2 Monarch=M002(default)→descartado
    expect(tras1.comentarios).toBe(3); // 2 de orden1 + 1 de orden3 (2 omitidos)
    expect(tras1.colores).toBe(4); // Rojo/Negro/Azul seed + ColorNuevoX creado al vuelo

    await ejecutarEtlPedidosOrdenes(cliente);
    expect(await conteos()).toEqual(tras1);
  }, 180_000);

  it('MODO MIGRACIÓN: folio explícito, snapshots V1, cancelación suave del pedido', async () => {
    await ejecutarEtlPedidosOrdenes(cliente);
    const ped = await cliente.pedido.findFirstOrThrow({
      where: { idEmpresa: idEmpresaFR, folio: 5001n },
      include: { lineas: { orderBy: { id: 'asc' } } },
    });
    expect(Number(ped.folio)).toBe(5001);
    expect(ped.idOrdCompraV1).toBe(777);
    expect(ped.lineas[0]?.entregadoParcialV1).toBe(200);
    expect(ped.lineas[0]?.cantFaltanteV1).toBe(300);
    // Pedido 5002 (PedCancelado=1) quedó cancelado suave.
    const cancelado = await cliente.pedido.findFirstOrThrow({
      where: { idEmpresa: idEmpresaFR, folio: 5002n },
    });
    expect(cancelado.pedCancelado).toBe(true);
  });

  it('ORDEN sin pedido → idPedidoLinea NULL; estado/fechaCompletada desde FechaDet (no now())', async () => {
    await ejecutarEtlPedidosOrdenes(cliente);
    // Orden 9003 es huérfana (IdPedidosDet=0).
    const huerfana = await cliente.orden.findFirstOrThrow({
      where: { idEmpresa: idEmpresaFR, folio: 9003n },
    });
    expect(huerfana.idPedidoLinea).toBeNull();
    expect(huerfana.estado).toBe('completa'); // tiene FechaDet
    expect(huerfana.fechaCompletada?.toISOString()).toBe('2007-07-01T00:00:00.000Z'); // NO now()

    // Orden 9001: completa con FechaDet original + snapshots.
    const completa = await cliente.orden.findFirstOrThrow({
      where: { idEmpresa: idEmpresaFR, folio: 9001n },
    });
    expect(completa.estado).toBe('completa');
    expect(completa.fechaCompletada?.toISOString()).toBe('2005-01-10T00:00:00.000Z');
    expect(completa.tallasV1).toBe('CHM G EX');
    expect(completa.pagada).toBe(true);
    expect(Number(completa.maquilaOrd)).toBe(12.5);
  });

  it('ORDEN cancelada: con motivo lo preserva; sin motivo usa el texto por defecto', async () => {
    await ejecutarEtlPedidosOrdenes(cliente);
    const conMotivo = await cliente.orden.findFirstOrThrow({
      where: { idEmpresa: idEmpresaFR, folio: 9002n },
    });
    expect(conMotivo.estado).toBe('cancelada');
    expect(conMotivo.motivoCancelada).toBe('Cliente desistio');
    const sinMotivo = await cliente.orden.findFirstOrThrow({
      where: { idEmpresa: idEmpresaFR, folio: 9004n },
    });
    expect(sinMotivo.estado).toBe('cancelada');
    expect(sinMotivo.motivoCancelada).toBe('Cancelada en sistema anterior (sin motivo registrado)');
  });

  it('MATRIZ doble curva: el separador NO crea talla; las cantidades cuadran', async () => {
    await ejecutarEtlPedidosOrdenes(cliente);
    const orden3 = await cliente.orden.findFirstOrThrow({
      where: { idEmpresa: idEmpresaFR, folio: 9003n },
      include: { lineas: { include: { tallas: { include: { talla: true } } } } },
    });
    const azul = orden3.lineas[0];
    const porEtiqueta = new Map(azul?.tallas.map((t) => [t.talla.etiqueta, t.cantidad]));
    // Tallas="6 1218--2 3 3X": col4 (separador) tiene 0; OrdenesDet T=6,12,0,0,3,3,1,0.
    expect(porEtiqueta.get('6')).toBe(6);
    expect(porEtiqueta.get('12')).toBe(12);
    expect(porEtiqueta.get('2')).toBe(3);
    expect(porEtiqueta.get('3')).toBe(3);
    expect(porEtiqueta.get('3X')).toBe(1);
    expect(porEtiqueta.has('18')).toBe(false); // col 3 tenía 0
  });

  it('Monarch real → OrdenReferencia con el campo D7 del cliente; default (==modelo) descartado', async () => {
    await ejecutarEtlPedidosOrdenes(cliente);
    const orden1 = await cliente.orden.findFirstOrThrow({
      where: { idEmpresa: idEmpresaFR, folio: 9001n },
      include: { referencias: { include: { clienteCampo: true } } },
    });
    expect(orden1.referencias).toHaveLength(1);
    expect(orden1.referencias[0]?.valor).toBe('PED-CLIENTE-111');
    expect(orden1.referencias[0]?.clienteCampo.etiqueta).toBe(CAMPO_D7_PEDIDO_CLIENTE);
    // Orden 9002 trae Monarch="M002" == código del modelo → NO debe tener referencia.
    const orden2 = await cliente.orden.findFirstOrThrow({
      where: { idEmpresa: idEmpresaFR, folio: 9002n },
      include: { referencias: true },
    });
    expect(orden2.referencias).toHaveLength(0);
  });

  it('COMENTARIOS preservan autor y fecha ORIGINALES', async () => {
    await ejecutarEtlPedidosOrdenes(cliente);
    const orden1 = await cliente.orden.findFirstOrThrow({
      where: { idEmpresa: idEmpresaFR, folio: 9001n },
      include: { comentarios: true },
    });
    expect(orden1.comentarios).toHaveLength(2);
    // El loader carga los comentarios EN CONCURRENCIA (`enLotes`), así que el `id` autoincremental NO
    // refleja el orden de origen: ordenar/posicionar por `id` flaquea (a veces el id menor es el de
    // gabriel). Se valida POR AUTOR — cada comentario conservó su `idUsuario` y su `fecha` ORIGINAL —
    // sin depender de ningún orden, que es justo lo que la prueba quiere demostrar.
    const porUsuario = new Map(orden1.comentarios.map((c) => [c.idUsuario, c]));
    expect(porUsuario.get('usr-daniel')?.fecha.toISOString()).toBe('2005-01-11T09:30:00.000Z');
    expect(porUsuario.get('usr-gabriel')?.fecha.toISOString()).toBe('2005-01-12T10:00:00.000Z');
  });

  it('SIEMBRA DE SECUENCIAS: un pedido y una orden NUEVOS salen con folio > máximo migrado', async () => {
    await ejecutarEtlPedidosOrdenes(cliente);
    const sesion = { ...sesionEtl(idEmpresaFR), idEmpresaActiva: idEmpresaFR };

    // Nuevo pedido por el servicio normal: folio > 5003 (máximo migrado).
    const idLiverpool = await cliente.cliente.findFirstOrThrow({ where: { nombre: 'Liverpool' } });
    const idModeloM001 = await cliente.modelo.findFirstOrThrow({ where: { codigo: 'M001' } });
    const nuevoPedido = await crearPedido(
      sesion,
      {
        idCliente: idLiverpool.id,
        lineas: [{ idModelo: idModeloM001.id, cantidadPedida: 10, precio: 1 }],
      },
      bd(),
      archivosStub,
    );
    expect(nuevoPedido.folio).toBeGreaterThan(5003);

    // Nueva orden por el servicio normal desde un renglón de pedido NUEVO: folio > 9004.
    const renglon = await cliente.pedidoLinea.findFirstOrThrow({
      where: { idPedido: nuevoPedido.id },
    });
    const nuevaOrden = await crearOrden(sesion, { idPedidoLinea: renglon.id }, bd());
    expect(nuevaOrden.folio).toBeGreaterThan(9004);
  });
});
