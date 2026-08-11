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
 *  • ⭐ COLISIÓN DE FOLIO (el re-volcado del go-live): si v2 ya capturó su propio documento con el
 *    folio que trae el Access, el ETL NO lo mapea (los hijos del volcado se pegarían al documento
 *    equivocado) y lo REPORTA; y la recuperación legítima de una corrida cortada SIGUE funcionando.
 */
import { fileURLToPath } from 'node:url';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { crearPedido } from '../src/dominio/pedidos/pedidos.js';
import { crearOrden } from '../src/dominio/produccion/ordenes.js';
import type { ServicioArchivos } from '../src/comun/archivos.js';
import type { PrismaClient } from '../src/datos/index.js';
import { clientePruebas, limpiarBaseDatos, sembrarPermisos } from '../src/pruebas/contexto.js';

import { ejecutarEtlPedidosOrdenes } from './etl-pedidos-ordenes.js';
import { ID_USUARIO_ETL, sesionEtl } from './comun/sesion-etl.js';
import { tituloColisionFolio } from './comun/colision-folio.js';
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
  subirContenido() {
    throw new Error('archivosStub.subirContenido no debe llamarse en este test');
  },
  urlDescarga() {
    throw new Error('archivosStub.urlDescarga no debe llamarse en este test');
  },
  descargarContenido() {
    throw new Error('archivosStub.descargarContenido no debe llamarse en este test');
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

  // ── COLISIÓN DE FOLIO (§ el arreglo del re-volcado del go-live) ──────────────────────────────
  describe('COLISIÓN DE FOLIO en el re-volcado', () => {
    /** Deja en v2 una orden capturada POR UNA PERSONA con el folio 9001, que el Access también trae. */
    async function capturarOrdenPropiaEnV2(folio: bigint): Promise<number> {
      const modelo = await cliente.modelo.findFirstOrThrow({ where: { codigo: 'M001' } });
      const clienteFila = await cliente.cliente.findFirstOrThrow({
        where: { nombre: 'Liverpool' },
      });
      const orden = await cliente.orden.create({
        data: {
          folio,
          idEmpresa: idEmpresaFR,
          idModelo: modelo.id,
          idCliente: clienteFila.id,
          observaciones: 'ORDEN PROPIA DE v2 (capturada a mano)',
          creadoPorId: 'usr-daniel',
          modificadoPorId: 'usr-daniel',
        },
        select: { id: true },
      });
      return orden.id;
    }

    it('NO mapea la orden de v2, NO la pisa, y la LISTA en el reporte', async () => {
      const idOrdenDeV2 = await capturarOrdenPropiaEnV2(9001n);

      const reporte = await ejecutarEtlPedidosOrdenes(cliente);

      // 1) La orden de v2 sigue siendo suya: ni se pisó ni se duplicó el folio.
      const conFolio9001 = await cliente.orden.findMany({
        where: { idEmpresa: idEmpresaFR, folio: 9001n },
        select: { id: true, observaciones: true, creadoPorId: true },
      });
      expect(conFolio9001).toHaveLength(1);
      expect(conFolio9001[0]?.id).toBe(idOrdenDeV2);
      expect(conFolio9001[0]?.creadoPorId).toBe('usr-daniel');

      // 2) ⭐ LO CRÍTICO: NO hay mapeo IdOrdenes=1 → orden de v2. Sin él, los hijos del volcado
      //    (comentarios, cortes, envíos, recibos, cargos EsMa, costos, RC) no pueden pegarse a la
      //    orden equivocada — que era exactamente el daño silencioso.
      const mapeo = await cliente.mapeoMigracion.findUnique({
        where: { entidad_claveVieja: { entidad: ENTIDAD_MAPEO.orden, claveVieja: '1' } },
      });
      expect(mapeo).toBeNull();
      // Y en efecto: los 2 comentarios de IdOrdenes=1 NO se colgaron de la orden de v2.
      expect(await cliente.ordenComentario.count({ where: { idOrden: idOrdenDeV2 } })).toBe(0);

      // 3) NADA EN SILENCIO (§7): la colisión sale listada con su folio y su clave vieja.
      const seccion = reporte
        .obtenerSecciones()
        .find((sec) => sec.titulo === tituloColisionFolio('Orden'));
      expect(seccion).toBeDefined();
      expect(seccion?.renglones.join('\n')).toContain('folio=9001');
      expect(seccion?.renglones.join('\n')).toContain('claveVieja=1');

      // 4) Las demás órdenes del volcado SÍ entraron (la colisión es puntual, no aborta el ETL).
      expect(await cliente.orden.count({ where: { creadoPorId: ID_USUARIO_ETL } })).toBe(3);
    }, 180_000);

    it('el mismo guardia protege los PEDIDOS (folio ocupado por un pedido capturado en v2)', async () => {
      const clienteFila = await cliente.cliente.findFirstOrThrow({
        where: { nombre: 'Liverpool' },
      });
      const propio = await cliente.pedido.create({
        data: {
          folio: 5001n,
          idEmpresa: idEmpresaFR,
          idCliente: clienteFila.id,
          creadoPorId: 'usr-daniel',
          modificadoPorId: 'usr-daniel',
        },
        select: { id: true },
      });

      const reporte = await ejecutarEtlPedidosOrdenes(cliente);

      expect(
        await cliente.mapeoMigracion.findUnique({
          where: { entidad_claveVieja: { entidad: ENTIDAD_MAPEO.pedido, claveVieja: '10' } },
        }),
      ).toBeNull();
      // El pedido de v2 no recibió los renglones del volcado.
      expect(await cliente.pedidoLinea.count({ where: { idPedido: propio.id } })).toBe(0);
      expect(
        reporte.obtenerSecciones().some((sec) => sec.titulo === tituloColisionFolio('Pedido')),
      ).toBe(true);
    }, 180_000);

    it('RECUPERACIÓN: una corrida cortada entre el create y el mapeo SÍ se retoma (no es colisión)', async () => {
      // 1ª corrida completa: las órdenes quedan creadas por el ETL y mapeadas.
      await ejecutarEtlPedidosOrdenes(cliente);
      const orden9001 = await cliente.orden.findFirstOrThrow({
        where: { idEmpresa: idEmpresaFR, folio: 9001n },
        select: { id: true, creadoPorId: true },
      });
      expect(orden9001.creadoPorId).toBe(ID_USUARIO_ETL);

      // Se simula el corte: el documento está en la BD, pero su renglón de mapeo NO llegó a
      // escribirse. Es el escenario que el fallback existía para rescatar.
      await cliente.mapeoMigracion.delete({
        where: { entidad_claveVieja: { entidad: ENTIDAD_MAPEO.orden, claveVieja: '1' } },
      });

      const reporte = await ejecutarEtlPedidosOrdenes(cliente);

      // Se re-mapea a la MISMA orden (no se duplica, no se reporta como colisión).
      const mapeo = await cliente.mapeoMigracion.findUniqueOrThrow({
        where: { entidad_claveVieja: { entidad: ENTIDAD_MAPEO.orden, claveVieja: '1' } },
      });
      expect(mapeo.idNuevo).toBe(String(orden9001.id));
      expect(await cliente.orden.count({ where: { idEmpresa: idEmpresaFR, folio: 9001n } })).toBe(
        1,
      );
      expect(
        reporte.obtenerSecciones().some((sec) => sec.titulo === tituloColisionFolio('Orden')),
      ).toBe(false);
    }, 180_000);
  });
});
