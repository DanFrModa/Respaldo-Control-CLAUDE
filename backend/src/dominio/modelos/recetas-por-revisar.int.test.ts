/**
 * ⭐⭐ V1-E8r (§Post-F9.140) — LA BANDEJA «Recetas por revisar», contra Postgres real.
 *
 * Lo que estas pruebas fijan, y por qué cada una:
 *
 *  (a) 🔴 **LO QUE EL USUARIO PIDIÓ VER, SE VE.** Daniel pidió *"un filtro para ver lo que se
 *      negocio con el cliente"*: una versión que espera revisión aparece en la lista, con su código,
 *      el de su padre y el cliente con el que se negoció.
 *  (b) 🔴 **LAS TRES POBLACIONES QUE EL MURO FRENA salen las tres**: `pendiente`, el **NULL** de las
 *      versiones anteriores a V1-E7d y la **rechazada**. Una bandeja escrita con
 *      `revision_estado = 'pendiente'` dejaría las otras dos bloqueadas e invisibles.
 *  (c) 🔴 **LO QUE NO ESPERA NADA NO SE CUELA**: los modelos migrados del Access (NULL pero sin
 *      linaje), las versiones ya APROBADAS y las que ya están en producción.
 *  (d) El ORDEN elegido (fecha comprometida del pedido → con pedido → la más vieja) y que sea el
 *      SERVIDOR quien agrega el dinero que espera.
 *  (e) A9: un pedido de OTRA empresa no marca «ya frena dinero».
 *  (f) 🔴 **GUARDAS GEMELAS**: el predicado en TS de la compuerta y su gemelo en SQL contestan lo
 *      MISMO sobre las 16 combinaciones posibles de (padre × versión × estado).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ErrorPermiso } from '../../comun/errores.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import type { ClavePermiso } from '../../contrato/index.js';
import { Prisma, type Empresa, type PrismaClient } from '../../datos/index.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';

import { consultarRecetasPorRevisar } from './recetas-por-revisar.js';
import {
  revisionBloqueaProduccion,
  SQL_REVISION_BLOQUEA_PRODUCCION,
  type EstadoRevision,
} from './revision-modelo.js';

// El listado/ficha construye el servicio de archivos aunque no haya fotos.
process.env.R2_ACCOUNT_ID ??= 'cuenta-fake';
process.env.R2_ACCESS_KEY_ID ??= 'llave-fake';
process.env.R2_SECRET_ACCESS_KEY ??= 'secreto-fake';
process.env.R2_BUCKET ??= 'control-v2-prueba';

let cliente: PrismaClient;
let empresa: Empresa;

function sesion(permisos: ClavePermiso[] = ['modelos.ver']): SesionUsuario {
  return sesionDePrueba({ idEmpresaActiva: empresa.id, permisos });
}
const bd = () => ({ cliente });

beforeAll(() => {
  cliente = clientePruebas();
});

afterAll(async () => {
  await cliente.$disconnect();
});

beforeEach(async () => {
  await limpiarBaseDatos(cliente);
  empresa = await crearEmpresaPrueba(cliente, 'FR Moda SA de CV');
});

/**
 * Un modelo RAÍZ de desarrollo, como los que mintea V1-E3n. Los códigos son los de verdad
 * (`CYA-26-71-001`) a propósito: un fixture que no se parece al mundo esconde el defecto — cicatriz
 * de V1-E8q, donde un id con forma de nombre tapó que la pantalla pintaba un identificador crudo.
 */
async function crearRaiz(codigo: string): Promise<{ id: number }> {
  return cliente.modelo.create({
    data: {
      codigo,
      codigoDesarrollo: codigo,
      origen: 'desarrollo',
      descripcion: 'Sudadera con cierre',
    },
    select: { id: true },
  });
}

/** Una VERSIÓN (lo que nace de una negociación), con el estado de revisión que se le indique. */
async function crearVersion(
  codigo: string,
  idPadre: number,
  version: number,
  extra: {
    revisionEstado?: EstadoRevision | null;
    revisionNota?: string;
    origen?: 'desarrollo' | 'produccion';
    creadoEn?: Date;
  } = {},
): Promise<{ id: number }> {
  return cliente.modelo.create({
    data: {
      codigo,
      codigoDesarrollo: codigo,
      origen: extra.origen ?? 'desarrollo',
      descripcion: 'Sudadera sin cierre (negociada)',
      idModeloPadre: idPadre,
      versionDesarrollo: version,
      revisionEstado: extra.revisionEstado ?? null,
      ...(extra.revisionNota === undefined ? {} : { revisionNota: extra.revisionNota }),
      ...(extra.creadoEn === undefined ? {} : { creadoEn: extra.creadoEn }),
    },
    select: { id: true },
  });
}

/** Un modelo MIGRADO del Access: producción, sin linaje y con la revisión en NULL (= no aplica). */
async function crearMigrado(codigo: string): Promise<{ id: number }> {
  return cliente.modelo.create({
    data: {
      codigo,
      origen: 'produccion',
      numeroProduccion: Number(codigo),
      descripcion: 'Playera cuello redondo (legado)',
    },
    select: { id: true },
  });
}

/** El expediente de Desarrollo de la versión: con qué cliente y en qué proyecto se negoció. */
async function crearExpediente(
  idModelo: number,
  nombreCliente: string,
  idEmpresa = empresa.id,
): Promise<void> {
  const c = await cliente.cliente.create({ data: { nombre: nombreCliente } });
  const depto = await cliente.clienteDepartamento.create({
    data: { idCliente: c.id, nombre: 'Caballero' },
  });
  const proyecto = await cliente.proyecto.create({
    data: {
      folio: BigInt(1000 + idModelo),
      idEmpresa,
      idCliente: c.id,
      idClienteDepartamento: depto.id,
      nombre: 'Otoño-Invierno 26',
    },
  });
  await cliente.desarrollo.create({ data: { idProyecto: proyecto.id, idModelo } });
}

/** `'2026-09-01'` → la fecha de negocio (`@db.Date`), sin arrastrar zona horaria. */
function aFecha(dia: string | null | undefined): Date | null {
  return dia === null || dia === undefined ? null : new Date(`${dia}T00:00:00.000Z`);
}

/** Un PEDIDO vivo del cliente esperando esta versión: el dinero ya comprometido. */
async function crearPedido(
  idModelo: number,
  opciones: {
    fechaDe?: string | null;
    fechaHasta?: string | null;
    piezas?: number;
    cancelado?: boolean;
    noProducir?: boolean;
    idEmpresa?: number;
    folio?: number;
  } = {},
): Promise<void> {
  const folio = opciones.folio ?? 9000 + idModelo;
  const c = await cliente.cliente.create({
    data: { nombre: `Cliente del pedido ${String(folio)}` },
  });
  const pedido = await cliente.pedido.create({
    data: {
      folio: BigInt(folio),
      idEmpresa: opciones.idEmpresa ?? empresa.id,
      idCliente: c.id,
      fechaDe: aFecha(opciones.fechaDe),
      fechaHasta: aFecha(opciones.fechaHasta),
      pedCancelado: opciones.cancelado ?? false,
      noProducir: opciones.noProducir ?? false,
    },
  });
  await cliente.pedidoLinea.create({
    data: {
      idPedido: pedido.id,
      idModelo,
      cantidadPedida: opciones.piezas ?? 500,
      precio: new Prisma.Decimal(180),
    },
  });
}

describe('bandeja «Recetas por revisar» (§Post-F9.140)', () => {
  it('⭐ (a) LO QUE DANIEL PIDIÓ VER, SE VE: la versión que espera revisión sale con su padre y su cliente', async () => {
    const raiz = await crearRaiz('CYA-26-71-001');
    const v = await crearVersion('CYA-26-71-001-01', raiz.id, 1, { revisionEstado: 'pendiente' });
    await crearExpediente(v.id, 'C&A México');

    const pagina = await consultarRecetasPorRevisar(sesion(), {}, bd());

    expect(pagina.total).toBe(1);
    expect(pagina.datos[0]).toMatchObject({
      idModelo: v.id,
      codigo: 'CYA-26-71-001-01',
      codigoPadre: 'CYA-26-71-001',
      versionDesarrollo: 1,
      estado: 'pendiente',
      cliente: 'C&A México',
      proyecto: 'Otoño-Invierno 26',
      conPedido: false,
      piezasPedidas: 0,
    });
  });

  it('⭐ (b) la versión anterior a V1-E7d (revisionEstado en NULL) SÍ sale: el muro la frena igual', async () => {
    const raiz = await crearRaiz('CYA-26-71-002');
    const v = await crearVersion('CYA-26-71-002-01', raiz.id, 1, { revisionEstado: null });

    const pagina = await consultarRecetasPorRevisar(sesion(), {}, bd());

    expect(pagina.datos.map((d) => d.idModelo)).toEqual([v.id]);
    // El null se pliega a `pendiente` EN EL SERVIDOR, con la misma lectura que la compuerta.
    expect(pagina.datos[0]?.estado).toBe('pendiente');
  });

  it('(b) la RECHAZADA sale, con su motivo a la vista', async () => {
    const raiz = await crearRaiz('CYA-26-71-003');
    await crearVersion('CYA-26-71-003-01', raiz.id, 1, {
      revisionEstado: 'rechazada',
      revisionNota: 'El forro negociado no lo teje ningún proveedor con ese gramaje.',
    });

    const pagina = await consultarRecetasPorRevisar(sesion(), {}, bd());

    expect(pagina.total).toBe(1);
    expect(pagina.datos[0]?.estado).toBe('rechazada');
    expect(pagina.datos[0]?.revisionNota).toContain('gramaje');
  });

  it('🔴 (c) los ~4,987 modelos migrados del Access NO se cuelan (NULL pero sin linaje)', async () => {
    await crearMigrado('71001');
    await crearMigrado('71002');

    const pagina = await consultarRecetasPorRevisar(sesion(), {}, bd());

    expect(pagina.total).toBe(0);
    expect(pagina.datos).toEqual([]);
  });

  it('(c) la versión APROBADA no espera nada: no sale', async () => {
    const raiz = await crearRaiz('CYA-26-71-004');
    await crearVersion('CYA-26-71-004-01', raiz.id, 1, { revisionEstado: 'aprobada' });

    const pagina = await consultarRecetasPorRevisar(sesion(), {}, bd());

    expect(pagina.total).toBe(0);
  });

  it('(c) la versión YA PROMOVIDA a producción no sale: el muro ya no la frena y firmarla es imposible', async () => {
    const raiz = await crearRaiz('CYA-26-71-005');
    await crearVersion('71005', raiz.id, 1, {
      revisionEstado: 'pendiente',
      origen: 'produccion',
    });

    const pagina = await consultarRecetasPorRevisar(sesion(), {}, bd());

    expect(pagina.total).toBe(0);
  });

  it('⭐ (d) ORDEN: primero la de fecha comprometida más próxima; las sin pedido, al final por antigüedad', async () => {
    const raiz = await crearRaiz('CYA-26-71-010');
    // Nace primero la que NO tiene pedido: si el orden fuera por antigüedad a secas, iría arriba.
    const vieja = await crearVersion('CYA-26-71-010-01', raiz.id, 1, {
      revisionEstado: 'pendiente',
      creadoEn: new Date('2026-01-10T10:00:00Z'),
    });
    const tarde = await crearVersion('CYA-26-71-010-02', raiz.id, 2, {
      revisionEstado: 'pendiente',
      creadoEn: new Date('2026-02-10T10:00:00Z'),
    });
    const urgente = await crearVersion('CYA-26-71-010-03', raiz.id, 3, {
      revisionEstado: 'pendiente',
      creadoEn: new Date('2026-03-10T10:00:00Z'),
    });
    await crearPedido(tarde.id, { fechaDe: '2026-11-30', piezas: 300 });
    await crearPedido(urgente.id, { fechaDe: '2026-09-01', piezas: 1200 });

    const pagina = await consultarRecetasPorRevisar(sesion(), {}, bd());

    expect(pagina.datos.map((d) => d.idModelo)).toEqual([urgente.id, tarde.id, vieja.id]);
    expect(pagina.datos[0]).toMatchObject({
      fechaCompromiso: '2026-09-01',
      piezasPedidas: 1200,
      conPedido: true,
    });
    expect(pagina.datos[2]).toMatchObject({ fechaCompromiso: null, conPedido: false });
  });

  it('(d) entre dos SIN fecha comprometida, la que tiene pedido va antes que la que no', async () => {
    const raiz = await crearRaiz('CYA-26-71-011');
    const sinNada = await crearVersion('CYA-26-71-011-01', raiz.id, 1, {
      revisionEstado: 'pendiente',
      creadoEn: new Date('2026-01-01T10:00:00Z'),
    });
    const conDinero = await crearVersion('CYA-26-71-011-02', raiz.id, 2, {
      revisionEstado: 'pendiente',
      creadoEn: new Date('2026-05-01T10:00:00Z'),
    });
    await crearPedido(conDinero.id, { fechaDe: null, fechaHasta: null, piezas: 80 });

    const pagina = await consultarRecetasPorRevisar(sesion(), {}, bd());

    expect(pagina.datos.map((d) => d.idModelo)).toEqual([conDinero.id, sinNada.id]);
  });

  it('(d) la fecha del compromiso cae en `fecha_hasta` cuando `fecha_de` viene vacía', async () => {
    const raiz = await crearRaiz('CYA-26-71-012');
    const v = await crearVersion('CYA-26-71-012-01', raiz.id, 1, { revisionEstado: 'pendiente' });
    await crearPedido(v.id, { fechaDe: null, fechaHasta: '2026-10-15' });

    const pagina = await consultarRecetasPorRevisar(sesion(), {}, bd());

    expect(pagina.datos[0]?.fechaCompromiso).toBe('2026-10-15');
  });

  it('⭐ (d) el DINERO lo agrega el SERVIDOR: dos pedidos vivos suman piezas y toman la fecha más próxima', async () => {
    const raiz = await crearRaiz('CYA-26-71-013');
    const v = await crearVersion('CYA-26-71-013-01', raiz.id, 1, { revisionEstado: 'pendiente' });
    await crearPedido(v.id, { fechaDe: '2026-12-01', piezas: 400, folio: 7001 });
    await crearPedido(v.id, { fechaDe: '2026-10-01', piezas: 600, folio: 7002 });
    // Cancelado y «no producir» NO cuentan: ese dinero ya no espera.
    await crearPedido(v.id, { fechaDe: '2026-01-01', piezas: 999, cancelado: true, folio: 7003 });
    await crearPedido(v.id, { fechaDe: '2026-01-02', piezas: 999, noProducir: true, folio: 7004 });

    const pagina = await consultarRecetasPorRevisar(sesion(), {}, bd());

    expect(pagina.datos[0]).toMatchObject({
      fechaCompromiso: '2026-10-01',
      piezasPedidas: 1000,
      conPedido: true,
    });
  });

  it('(d) `soloConPedido` deja sólo lo que ya frena dinero, y el TOTAL lo refleja', async () => {
    const raiz = await crearRaiz('CYA-26-71-014');
    await crearVersion('CYA-26-71-014-01', raiz.id, 1, { revisionEstado: 'pendiente' });
    const conDinero = await crearVersion('CYA-26-71-014-02', raiz.id, 2, {
      revisionEstado: 'pendiente',
    });
    await crearPedido(conDinero.id, { fechaDe: '2026-09-09' });

    const todas = await consultarRecetasPorRevisar(sesion(), {}, bd());
    const soloDinero = await consultarRecetasPorRevisar(sesion(), { soloConPedido: true }, bd());

    expect(todas.total).toBe(2);
    expect(soloDinero.total).toBe(1);
    expect(soloDinero.datos.map((d) => d.idModelo)).toEqual([conDinero.id]);
  });

  it('(e) A9: un pedido de OTRA empresa no marca «ya frena dinero»', async () => {
    const otra = await crearEmpresaPrueba(cliente, 'Otra Empresa SA');
    const raiz = await crearRaiz('CYA-26-71-015');
    const v = await crearVersion('CYA-26-71-015-01', raiz.id, 1, { revisionEstado: 'pendiente' });
    await crearPedido(v.id, { fechaDe: '2026-07-07', idEmpresa: otra.id });

    const pagina = await consultarRecetasPorRevisar(sesion(), {}, bd());

    expect(pagina.datos[0]).toMatchObject({ conPedido: false, fechaCompromiso: null });
  });

  it('la búsqueda encuentra por código de la versión, por el del PADRE y por cliente', async () => {
    const raiz = await crearRaiz('CYA-26-71-020');
    const v = await crearVersion('CYA-26-71-020-01', raiz.id, 1, { revisionEstado: 'pendiente' });
    await crearExpediente(v.id, 'Suburbia');
    const otraRaiz = await crearRaiz('LIV-26-33-001');
    await crearVersion('LIV-26-33-001-01', otraRaiz.id, 1, { revisionEstado: 'pendiente' });

    const porVersion = await consultarRecetasPorRevisar(sesion(), { busqueda: '020-01' }, bd());
    const porPadre = await consultarRecetasPorRevisar(
      sesion(),
      { busqueda: 'CYA-26-71-020' },
      bd(),
    );
    const porCliente = await consultarRecetasPorRevisar(sesion(), { busqueda: 'suburbia' }, bd());

    expect(porVersion.datos.map((d) => d.idModelo)).toEqual([v.id]);
    expect(porPadre.datos.map((d) => d.idModelo)).toEqual([v.id]);
    expect(porCliente.datos.map((d) => d.idModelo)).toEqual([v.id]);
  });

  it('sin `modelos.ver` no se abre la bandeja (RBAC en el servidor, A4)', async () => {
    await expect(consultarRecetasPorRevisar(sesion([]), {}, bd())).rejects.toBeInstanceOf(
      ErrorPermiso,
    );
  });
});

/**
 * 🔴 GUARDAS GEMELAS. El predicado de la COMPUERTA vive en TS (`revisionBloqueaProduccion`, que es
 * literalmente lo que `exigirRevisionAprobadaParaProducir` pregunta antes de lanzar) y la BANDEJA lo
 * necesita en SQL (`SQL_REVISION_BLOQUEA_PRODUCCION`). Dos formas del mismo hecho se desincronizan
 * solas, así que aquí se corren LAS DOS sobre las 16 combinaciones posibles y se comparan fila por
 * fila. Si alguien mueve una y no la otra, esta prueba muere.
 */
describe('guardas gemelas: la compuerta (TS) y la bandeja (SQL) contestan lo mismo', () => {
  it('coinciden en las 16 combinaciones de (padre × versión × estado de revisión)', async () => {
    const raiz = await crearRaiz('CYA-26-71-900');
    const estados: (EstadoRevision | null)[] = [null, 'pendiente', 'aprobada', 'rechazada'];

    const casos: { id: number; esperado: boolean; etiqueta: string }[] = [];
    let n = 0;
    for (const conPadre of [false, true]) {
      for (const conVersion of [false, true]) {
        for (const estado of estados) {
          n += 1;
          const modelo = await cliente.modelo.create({
            data: {
              codigo: `CYA-26-71-9${String(n).padStart(2, '0')}`,
              origen: 'desarrollo',
              idModeloPadre: conPadre ? raiz.id : null,
              versionDesarrollo: conVersion ? 1 : null,
              revisionEstado: estado,
            },
            select: { id: true },
          });
          casos.push({
            id: modelo.id,
            esperado: revisionBloqueaProduccion({
              idModeloPadre: conPadre ? raiz.id : null,
              versionDesarrollo: conVersion ? 1 : null,
              revisionEstado: estado,
            }),
            etiqueta: `padre=${String(conPadre)} version=${String(conVersion)} estado=${String(estado)}`,
          });
        }
      }
    }

    const bloqueadosSql = await cliente.$queryRaw<{ id: number }[]>(Prisma.sql`
      SELECT m."id" AS "id" FROM "modelos" m WHERE ${SQL_REVISION_BLOQUEA_PRODUCCION}
    `);
    const idsSql = new Set(bloqueadosSql.map((f) => f.id));

    // Se compara caso por caso (y no sólo los conteos) para que el fallo diga CUÁL combinación.
    for (const caso of casos) {
      expect(`${caso.etiqueta} → ${String(idsSql.has(caso.id))}`).toBe(
        `${caso.etiqueta} → ${String(caso.esperado)}`,
      );
    }
    // Y que de verdad haya de las dos: si el predicado devolviera siempre lo mismo, el bucle de
    // arriba pasaría igual.
    expect(casos.filter((c) => c.esperado).length).toBe(9);
    expect(casos.filter((c) => !c.esperado).length).toBe(7);
  });
});
