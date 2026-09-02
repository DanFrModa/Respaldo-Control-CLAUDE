/**
 * ⭐⭐ V1-E9p (§Post-F9.144(b)) — **«¿SE LOGRÓ LO PROMETIDO?»**, contra Postgres real.
 *
 * Lo que estas pruebas fijan, y por qué cada una:
 *
 * ⚠️⚠️ **ESTAS PRUEBAS SON EL ÚNICO GUARDIÁN DE LA SEMÁNTICA DE LA RECURSIÓN. NO SE RETIRAN.**
 * El guardián unitario de `meta-negociada.test.ts` pincha el TEXTO de la CTE (que sea `RECURSIVE`,
 * dos ramas, tope…) y eso **no basta**: está medido que neutrar la recursión con un
 * `WHERE l."nivel" < 100 AND false` —SQL perfectamente válido, con el texto intacto— **deja el suite
 * unitario entero en verde**. Lo que se pone rojo es esto: el join, la del hijo de en medio y las
 * dos del NIETO. Si alguien las borra "porque ya hay un guardián", el linaje deja de subir y nadie
 * se entera hasta que Daniel vea una brecha en blanco.
 *
 *  (a) 🔴🔴 **EL JOIN, que es lo único que no se puede probar sin base.** La versión NO tiene
 *      expediente propio —`crearVersionDeModelo` no crea ninguno— y la mesa se guardó ANTES de que
 *      existiera, colgada del expediente del **PADRE** (§Post-F9.144(a)). Si alguien vuelve a
 *      anclar el join sólo en `d.id_modelo = m.id`, la meta sale `null` y estas pruebas mueren.
 *  (b) 🔴 **El SEGUNDO FINAL viaja hasta la base**: una versión sale de la bandeja `aprobada` **y**
 *      con el desenlace `no_lograda` — dos ejes a la vez, que es justo lo que `rechazada` no podía
 *      expresar. Y los dos CHECK de la base rebotan una tupla a medias.
 *  (c) 🔴 **En NEGATIVO**: una versión SIN meta guardada se comporta **exactamente como antes** —
 *      sale en la bandeja, se firma, y nada nuevo aparece.
 *  (d) La lista del DUEÑO: la brecha, el impacto y el `impactoTotal` de la CARTERA (no el de la
 *      página) agregados por el SERVIDOR, y el orden por lo que más cuesta.
 *  (e) A9 y permisos: sin `consultas.ver-importes` no se ve, y el dinero de otra empresa no cuenta.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ErrorPermiso } from '../../comun/errores.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import type { ClavePermiso } from '../../contrato/index.js';
import { Prisma, type Empresa, type PrismaClient } from '../../datos/index.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';

import { consultarMetaPrometida, consultarPromesasIncumplidas } from './meta-negociada.js';
import { consultarRecetasPorRevisar } from './recetas-por-revisar.js';
import { aprobarRevisionModelo, rechazarRevisionModelo } from './revision-modelo.js';

// El listado/ficha construye el servicio de archivos aunque no haya fotos.
process.env.R2_ACCOUNT_ID ??= 'cuenta-fake';
process.env.R2_ACCESS_KEY_ID ??= 'llave-fake';
process.env.R2_SECRET_ACCESS_KEY ??= 'secreto-fake';
process.env.R2_BUCKET ??= 'control-v2-prueba';

let cliente: PrismaClient;
let empresa: Empresa;
let idUsuario: string;

const PERMISOS_DUENO: ClavePermiso[] = ['modelos.ver', 'consultas.ver-importes'];

function sesion(permisos: ClavePermiso[] = PERMISOS_DUENO): SesionUsuario {
  return sesionDePrueba({ id: idUsuario, idEmpresaActiva: empresa.id, permisos });
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
  const usuario = await cliente.usuario.create({
    data: {
      username: 'aurora',
      nombre: 'Aurora',
      email: 'aurora@control.local',
    },
    select: { id: true },
  });
  idUsuario = usuario.id;
});

/** El modelo RAÍZ que se llevó a la mesa (el PADRE de la versión que nace después). */
async function crearPadre(codigo: string): Promise<{ id: number }> {
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

/** La VERSIÓN que Desarrollo hace en la oficina DESPUÉS de la mesa (momento 3). */
async function crearVersion(codigo: string, idPadre: number, version = 1): Promise<{ id: number }> {
  return cliente.modelo.create({
    data: {
      codigo,
      codigoDesarrollo: codigo,
      origen: 'desarrollo',
      descripcion: 'Sudadera sin cierre (negociada)',
      idModeloPadre: idPadre,
      versionDesarrollo: version,
      revisionEstado: 'pendiente',
    },
    select: { id: true },
  });
}

/**
 * ⭐ **LA MESA COMPLETA, tal como queda en la base tras `guardarMesa`**: cliente → departamento →
 * proyecto → desarrollo DEL PADRE → lista → renglón → evento con `costoEstimado`.
 *
 * ⚠️ El expediente cuelga del **padre** a propósito: es el modelo que estaba en la mesa. La versión
 * todavía no existía. Es exactamente el caso que el join tiene que resolver.
 */
async function negociarModelo(
  idModelo: number,
  opciones: {
    nombreCliente?: string;
    costoEstimado?: number | null;
    idEmpresa?: number;
    folio?: number;
  } = {},
): Promise<{ idDesarrollo: number; idEvento: number | null }> {
  const folio = opciones.folio ?? 100 + idModelo;
  const idEmpresa = opciones.idEmpresa ?? empresa.id;
  const c = await cliente.cliente.create({
    data: { nombre: opciones.nombreCliente ?? 'C&A México' },
  });
  const depto = await cliente.clienteDepartamento.create({
    data: { idCliente: c.id, nombre: 'Caballero' },
  });
  const proyecto = await cliente.proyecto.create({
    data: {
      folio: BigInt(1000 + folio),
      idEmpresa,
      idCliente: c.id,
      idClienteDepartamento: depto.id,
      nombre: 'Otoño-Invierno 26',
    },
  });
  const desarrollo = await cliente.desarrollo.create({
    data: { idProyecto: proyecto.id, idModelo },
    select: { id: true },
  });

  const costoEstimado = opciones.costoEstimado;
  if (costoEstimado === undefined) {
    // Expediente SIN mesa: se negoció el proyecto pero nadie guardó costos estimados.
    return { idDesarrollo: desarrollo.id, idEvento: null };
  }

  const estado = await cliente.estadoLista.create({
    data: { codigo: `abierta-${String(folio)}`, nombre: 'Abierta', orden: 1 },
  });
  const lista = await cliente.listaPrecios.create({
    data: {
      folio: BigInt(folio),
      idEmpresa,
      idCliente: c.id,
      idClienteDepartamento: depto.id,
      fecha: new Date('2026-08-29T00:00:00.000Z'),
      idEstadoLista: estado.id,
      margenPct: new Prisma.Decimal(30),
      descuentosPct: new Prisma.Decimal(0),
      regaliasPct: new Prisma.Decimal(0),
      costoVentasPct: new Prisma.Decimal(0),
    },
    select: { id: true },
  });
  const precosto = await cliente.precosto.create({
    data: {
      idDesarrollo: desarrollo.id,
      version: 1,
      estado: 'congelado',
      costoTotal: new Prisma.Decimal(50),
    },
    select: { id: true },
  });
  const linea = await cliente.listaPreciosLinea.create({
    data: {
      idLista: lista.id,
      idDesarrollo: desarrollo.id,
      idPrecosto: precosto.id,
      costoUnit: new Prisma.Decimal(50),
      precioCalculado: new Prisma.Decimal(180),
    },
    select: { id: true },
  });
  const evento = await cliente.negociacionEvento.create({
    data: {
      idListaLinea: linea.id,
      acuerdo: 'Se quita el cierre; la maquila baja $5.',
      costoEstimado: costoEstimado === null ? null : new Prisma.Decimal(costoEstimado),
    },
    select: { id: true },
  });
  return { idDesarrollo: desarrollo.id, idEvento: evento.id };
}

/** Un PEDIDO vivo del cliente esperando esta versión: el dinero ya comprometido. */
async function crearPedido(
  idModelo: number,
  piezas: number,
  idEmpresa = empresa.id,
): Promise<void> {
  const c = await cliente.cliente.create({
    data: { nombre: `Cliente del pedido ${String(idModelo)}-${String(piezas)}` },
  });
  const pedido = await cliente.pedido.create({
    data: {
      folio: BigInt(9000 + idModelo),
      idEmpresa,
      idCliente: c.id,
      fechaDe: new Date('2026-11-01T00:00:00.000Z'),
    },
    select: { id: true },
  });
  await cliente.pedidoLinea.create({
    data: {
      idPedido: pedido.id,
      idModelo,
      cantidadPedida: piezas,
      precio: new Prisma.Decimal(180),
    },
  });
}

/** Cómo quedaron las cuatro columnas del desenlace en la base. */
async function desenlaceDe(idModelo: number): Promise<{
  revisionEstado: string | null;
  metaResultado: string | null;
  metaCostoPrometido: number | null;
  metaCostoConseguido: number | null;
  metaNota: string | null;
}> {
  const fila = await cliente.modelo.findUniqueOrThrow({
    where: { id: idModelo },
    select: {
      revisionEstado: true,
      metaResultado: true,
      metaCostoPrometido: true,
      metaCostoConseguido: true,
      metaNota: true,
    },
  });
  return {
    revisionEstado: fila.revisionEstado,
    metaResultado: fila.metaResultado,
    metaCostoPrometido: fila.metaCostoPrometido?.toNumber() ?? null,
    metaCostoConseguido: fila.metaCostoConseguido?.toNumber() ?? null,
    metaNota: fila.metaNota,
  };
}

const FIRMANTE: ClavePermiso[] = ['modelos.aprobar-receta'];
const FIRMANTE_CON_IMPORTES: ClavePermiso[] = ['modelos.aprobar-receta', 'consultas.ver-importes'];

// ── (a) EL JOIN ───────────────────────────────────────────────────────────────

describe('⭐⭐ (a) de la VERSIÓN a la META: el join que sostiene la etapa', () => {
  it('⭐⭐ la mesa fue del PADRE (la versión nació después) y la meta se encuentra igual', async () => {
    // 🔴 ÉSTE es el camino normal, y el que un join anclado en `d.id_modelo = m.id` no resuelve:
    // `crearVersionDeModelo` NO crea expediente, así que la versión no tiene ninguno.
    const padre = await crearPadre('CYA-26-71-001');
    await negociarModelo(padre.id, { costoEstimado: 43 });
    const v = await crearVersion('CYA-26-71-001-01', padre.id);

    const pagina = await consultarRecetasPorRevisar(sesion(PERMISOS_DUENO), {}, bd());

    expect(pagina.total).toBe(1);
    expect(pagina.datos[0]).toMatchObject({
      idModelo: v.id,
      codigo: 'CYA-26-71-001-01',
      // La meta que hay que salir a conseguir, a la vista de quien la va a cuadrar.
      costoPrometido: 43,
      // ⭐ Y el CLIENTE, que antes de esta etapa salía vacío en todas las filas por el mismo motivo.
      cliente: 'C&A México',
      proyecto: 'Otoño-Invierno 26',
    });
  });

  it('⭐ el expediente PROPIO de la versión manda sobre el del padre cuando existe y tiene mesa', async () => {
    const padre = await crearPadre('CYA-26-71-002');
    await negociarModelo(padre.id, { costoEstimado: 43, nombreCliente: 'Cliente del padre' });
    const v = await crearVersion('CYA-26-71-002-01', padre.id);
    await negociarModelo(v.id, {
      costoEstimado: 47,
      nombreCliente: 'Cliente de la versión',
      folio: 555,
    });

    const pagina = await consultarRecetasPorRevisar(sesion(PERMISOS_DUENO), {}, bd());

    // Y el cliente viene del MISMO expediente que la meta: si salieran de expedientes distintos,
    // la fila estaría contando dos negociaciones como si fueran una.
    expect(pagina.datos[0]).toMatchObject({
      idModelo: v.id,
      costoPrometido: 47,
      cliente: 'Cliente de la versión',
    });
  });

  it('⭐ prefiere el expediente que SÍ tiene mesa aunque el propio de la versión no la tenga', async () => {
    const padre = await crearPadre('CYA-26-71-003');
    await negociarModelo(padre.id, { costoEstimado: 43, nombreCliente: 'Cliente con mesa' });
    const v = await crearVersion('CYA-26-71-003-01', padre.id);
    // Expediente propio SIN mesa (se abrió el proyecto pero no se guardaron costos estimados).
    await negociarModelo(v.id, { nombreCliente: 'Cliente sin mesa', folio: 556 });

    const pagina = await consultarRecetasPorRevisar(sesion(PERMISOS_DUENO), {}, bd());

    expect(pagina.datos[0]).toMatchObject({ costoPrometido: 43, cliente: 'Cliente con mesa' });
  });

  it('toma el ÚLTIMO cierre de mesa, no el primero (se negocia varias veces)', async () => {
    const padre = await crearPadre('CYA-26-71-004');
    const { idDesarrollo } = await negociarModelo(padre.id, { costoEstimado: 50 });
    const linea = await cliente.listaPreciosLinea.findFirstOrThrow({
      where: { idDesarrollo },
      select: { id: true },
    });
    await cliente.negociacionEvento.create({
      data: {
        idListaLinea: linea.id,
        acuerdo: 'Segunda vuelta: se quita también el forro.',
        costoEstimado: new Prisma.Decimal(41),
      },
    });
    await crearVersion('CYA-26-71-004-01', padre.id);

    const pagina = await consultarRecetasPorRevisar(sesion(PERMISOS_DUENO), {}, bd());
    expect(pagina.datos[0]?.costoPrometido).toBe(41);
  });

  it('ignora los eventos SIN costo estimado (una ronda o un acuerdo a secas no son una mesa)', async () => {
    const padre = await crearPadre('CYA-26-71-005');
    const { idDesarrollo } = await negociarModelo(padre.id, { costoEstimado: 43 });
    const linea = await cliente.listaPreciosLinea.findFirstOrThrow({
      where: { idDesarrollo },
      select: { id: true },
    });
    // Evento POSTERIOR sin desglose de mesa: si el join no filtrara, este pisaría la meta con null.
    await cliente.negociacionEvento.create({
      data: { idListaLinea: linea.id, acuerdo: 'Acuerdo sin re-costeo.', costoEstimado: null },
    });
    await crearVersion('CYA-26-71-005-01', padre.id);

    const pagina = await consultarRecetasPorRevisar(sesion(PERMISOS_DUENO), {}, bd());
    expect(pagina.datos[0]?.costoPrometido).toBe(43);
  });

  /**
   * 🔴🔴 **EL NIETO — la segunda vuelta de negociación, que es el camino NORMAL, no un caso raro.**
   *
   * `mintearVersionDeModelo` escribe el padre INMEDIATO y nada impide versionar una versión (el
   * CÓDIGO es plano —`-01` → `-02`— pero el vínculo de padres es una CADENA). El expediente sigue
   * viviendo en la RAÍZ, así que un ancla de UN nivel devuelve `NULL` aquí.
   *
   * ⚠️ Y ese `NULL` sería PEOR que el defecto original: la fila SÍ aparecería en «Promesas
   * incumplidas» pero con la brecha en blanco y aportando 0 al total — *«conseguí 45»* contra un
   * guion. Silencio parcial, en la pantalla que existe para romper el silencio.
   */
  it('⭐⭐ el NIETO (`-02` nacido del `-01`) encuentra la meta en la RAÍZ, dos escalones arriba', async () => {
    const raiz = await crearPadre('CYA-26-71-007');
    await negociarModelo(raiz.id, { costoEstimado: 43 });
    const v1 = await crearVersion('CYA-26-71-007-01', raiz.id, 1);
    const v2 = await crearVersion('CYA-26-71-007-02', v1.id, 2);

    const pagina = await consultarRecetasPorRevisar(sesion(PERMISOS_DUENO), {}, bd());
    const nieto = pagina.datos.find((d) => d.idModelo === v2.id);

    expect(nieto).toMatchObject({
      codigo: 'CYA-26-71-007-02',
      codigoPadre: 'CYA-26-71-007-01',
      costoPrometido: 43,
      cliente: 'C&A México',
    });
    // Y el hijo de en medio, que tampoco tiene expediente propio, la encuentra igual.
    expect(pagina.datos.find((d) => d.idModelo === v1.id)?.costoPrometido).toBe(43);
  });

  it('⭐ y el NIETO llega ENTERO hasta la lista del dueño: con brecha e impacto, no con guiones', async () => {
    // 🔴 El defecto no era «falta un dato»: era que la promesa incumplida de una segunda vuelta
    // aparecía SIN brecha y aportando 0 al margen comprometido de la cartera.
    const raiz = await crearPadre('CYA-26-71-008');
    await negociarModelo(raiz.id, { costoEstimado: 43 });
    const v1 = await crearVersion('CYA-26-71-008-01', raiz.id, 1);
    const v2 = await crearVersion('CYA-26-71-008-02', v1.id, 2);
    await crearPedido(v2.id, 10_000);
    await aprobarRevisionModelo(
      sesion(FIRMANTE),
      v2.id,
      { meta: { lograda: false, costoConseguido: 45, nota: 'no bajó la maquila' } },
      bd(),
    );

    const lista = await consultarPromesasIncumplidas(sesion(), {}, bd());
    expect(lista.datos[0]).toMatchObject({
      idModelo: v2.id,
      costoPrometido: 43,
      costoConseguido: 45,
      brecha: 2,
      piezasPedidas: 10_000,
      impacto: 20_000,
    });
    expect(lista.impactoTotal).toBe(20_000);
  });

  it('⭐ un expediente propio del NIETO gana sobre el de la raíz (lo más cercano manda)', async () => {
    // La pareja de la de arriba: sin ella, «sube siempre hasta la raíz» pasaría igual y perdería la
    // negociación más específica.
    const raiz = await crearPadre('CYA-26-71-009');
    await negociarModelo(raiz.id, { costoEstimado: 43, nombreCliente: 'Cliente de la raíz' });
    const v1 = await crearVersion('CYA-26-71-009-01', raiz.id, 1);
    const v2 = await crearVersion('CYA-26-71-009-02', v1.id, 2);
    await negociarModelo(v2.id, {
      costoEstimado: 47,
      nombreCliente: 'Cliente del nieto',
      folio: 557,
    });

    const pagina = await consultarRecetasPorRevisar(sesion(PERMISOS_DUENO), {}, bd());
    expect(pagina.datos.find((d) => d.idModelo === v2.id)).toMatchObject({
      costoPrometido: 47,
      cliente: 'Cliente del nieto',
    });
  });

  it('⭐ A9: la mesa de OTRA empresa no es la meta de esta (el modelo es global, el dinero no)', async () => {
    const otra = await crearEmpresaPrueba(cliente, 'Otra empresa SA');
    const padre = await crearPadre('CYA-26-71-006');
    await negociarModelo(padre.id, { costoEstimado: 43, idEmpresa: otra.id });
    await crearVersion('CYA-26-71-006-01', padre.id);

    const pagina = await consultarRecetasPorRevisar(sesion(PERMISOS_DUENO), {}, bd());
    expect(pagina.datos[0]?.costoPrometido).toBeNull();
    expect(pagina.datos[0]?.cliente).toBeNull();
  });
});

// ── (c) EN NEGATIVO: sin meta, todo se comporta como antes ────────────────────

describe('🔴 (c) una versión SIN meta guardada se comporta EXACTAMENTE como antes', () => {
  it('⭐ sale en la bandeja igual, con la meta en null (REGLA 0-B)', async () => {
    // Ni expediente ni mesa: la versión se creó a mano desde la ficha del modelo.
    const padre = await crearPadre('CYA-26-71-010');
    const v = await crearVersion('CYA-26-71-010-01', padre.id);

    const pagina = await consultarRecetasPorRevisar(sesion(PERMISOS_DUENO), {}, bd());

    expect(pagina.datos.map((d) => d.idModelo)).toEqual([v.id]);
    expect(pagina.datos[0]?.costoPrometido).toBeNull();
    expect(pagina.datos[0]?.estado).toBe('pendiente');
  });

  it('⭐ se firma igual, y no aparece NADA nuevo en la fila', async () => {
    const padre = await crearPadre('CYA-26-71-011');
    const v = await crearVersion('CYA-26-71-011-01', padre.id);

    await aprobarRevisionModelo(sesion(FIRMANTE), v.id, { nota: 'la revisé' }, bd());

    expect(await desenlaceDe(v.id)).toEqual({
      revisionEstado: 'aprobada',
      metaResultado: null,
      metaCostoPrometido: null,
      metaCostoConseguido: null,
      metaNota: null,
    });
    // Y no se cuela en la lista del dueño: nadie declaró un incumplimiento.
    const lista = await consultarPromesasIncumplidas(sesion(), {}, bd());
    expect(lista.total).toBe(0);
    expect(lista.impactoTotal).toBe(0);
  });

  it('⭐ y el «no se consiguió» SE PUEDE declarar aunque no haya meta: se guarda lo que sí se sabe', async () => {
    const padre = await crearPadre('CYA-26-71-012');
    const v = await crearVersion('CYA-26-71-012-01', padre.id);

    await aprobarRevisionModelo(
      sesion(FIRMANTE),
      v.id,
      { meta: { lograda: false, costoConseguido: 45, nota: 'la tela no existe en ese gramaje' } },
      bd(),
    );

    const fila = await desenlaceDe(v.id);
    expect(fila.metaResultado).toBe('no_lograda');
    expect(fila.metaCostoPrometido).toBeNull();
    expect(fila.metaCostoConseguido).toBe(45);

    // Sale en la lista del dueño, pero SIN brecha inventada: sin los dos números no hay brecha.
    const lista = await consultarPromesasIncumplidas(sesion(), {}, bd());
    expect(lista.total).toBe(1);
    expect(lista.datos[0]?.brecha).toBeNull();
    expect(lista.datos[0]?.impacto).toBeNull();
    expect(lista.impactoTotal).toBe(0);
  });
});

// ── (b) EL SEGUNDO FINAL, hasta la base ───────────────────────────────────────

describe('🔴 (b) el SEGUNDO FINAL: sale de la cola aprobada Y con el incumplimiento a la vista', () => {
  it('⭐⭐ `aprobada` + `no_lograda` a la vez — lo que `rechazada` NO podía expresar', async () => {
    const padre = await crearPadre('CYA-26-71-020');
    await negociarModelo(padre.id, { costoEstimado: 43 });
    const v = await crearVersion('CYA-26-71-020-01', padre.id);

    await aprobarRevisionModelo(
      sesion(FIRMANTE),
      v.id,
      { meta: { lograda: false, costoConseguido: 45, nota: 'ninguna maquila bajó de $18' } },
      bd(),
    );

    expect(await desenlaceDe(v.id)).toEqual({
      revisionEstado: 'aprobada',
      metaResultado: 'no_lograda',
      metaCostoPrometido: 43,
      metaCostoConseguido: 45,
      metaNota: 'ninguna maquila bajó de $18',
    });

    // 🔴 Y SALE DE LA COLA: la receta está bien, no hay nada que corregir. Si esto se hubiera
    // modelado como `rechazada`, la versión seguiría aquí dando vueltas para siempre.
    const bandeja = await consultarRecetasPorRevisar(sesion(PERMISOS_DUENO), {}, bd());
    expect(bandeja.total).toBe(0);
  });

  it('⭐ y el RECHAZO borra el desenlace: la brecha medía una receta que se va a corregir', async () => {
    const padre = await crearPadre('CYA-26-71-021');
    await negociarModelo(padre.id, { costoEstimado: 43 });
    const v = await crearVersion('CYA-26-71-021-01', padre.id);
    await aprobarRevisionModelo(
      sesion(FIRMANTE),
      v.id,
      { meta: { lograda: false, costoConseguido: 45, nota: 'no bajó la maquila' } },
      bd(),
    );

    await rechazarRevisionModelo(sesion(FIRMANTE), v.id, { motivo: 'falta el forro' }, bd());

    expect(await desenlaceDe(v.id)).toEqual({
      revisionEstado: 'rechazada',
      metaResultado: null,
      metaCostoPrometido: null,
      metaCostoConseguido: null,
      metaNota: null,
    });
    // Y desaparece de la lista del dueño mientras la receta esté en corrección.
    expect((await consultarPromesasIncumplidas(sesion(), {}, bd())).total).toBe(0);
  });

  it('🔒 la BASE rebota una tupla a medias (brecha sin desenlace declarado)', async () => {
    // `modelos_meta_acto_completo_check`: media tupla sería una brecha que NADIE declaró.
    const padre = await crearPadre('CYA-26-71-022');
    const v = await crearVersion('CYA-26-71-022-01', padre.id);
    await expect(
      cliente.modelo.update({
        where: { id: v.id },
        data: { metaCostoConseguido: new Prisma.Decimal(45) },
      }),
    ).rejects.toThrow(/modelos_meta_acto_completo_check/);
  });

  it('🔒 la BASE rebota un «no se consiguió» SIN explicación', async () => {
    // `modelos_meta_no_lograda_con_nota_check`: es la misma regla que el motivo del rechazo.
    const padre = await crearPadre('CYA-26-71-023');
    const v = await crearVersion('CYA-26-71-023-01', padre.id);
    await expect(
      cliente.modelo.update({
        where: { id: v.id },
        data: {
          metaResultado: 'no_lograda',
          metaCostoPrometido: new Prisma.Decimal(43),
          metaCostoConseguido: new Prisma.Decimal(45),
        },
      }),
    ).rejects.toThrow(/modelos_meta_no_lograda_con_nota_check/);
  });
});

// ── (d) LA LISTA DEL DUEÑO ────────────────────────────────────────────────────

/** Deja una versión firmada con el desenlace que se le diga, y devuelve su id. */
async function versionIncumplida(
  codigo: string,
  opciones: { prometido: number; conseguido: number; piezas?: number; folio?: number },
): Promise<number> {
  const padre = await crearPadre(codigo);
  await negociarModelo(padre.id, {
    costoEstimado: opciones.prometido,
    ...(opciones.folio === undefined ? {} : { folio: opciones.folio }),
  });
  const v = await crearVersion(`${codigo}-01`, padre.id);
  if (opciones.piezas !== undefined) {
    await crearPedido(v.id, opciones.piezas);
  }
  await aprobarRevisionModelo(
    sesion(FIRMANTE),
    v.id,
    {
      meta: {
        lograda: false,
        costoConseguido: opciones.conseguido,
        nota: `no se consiguió el costo de ${codigo}`,
      },
    },
    bd(),
  );
  return v.id;
}

describe('⭐⭐ (d) «Promesas incumplidas»: la lista del DUEÑO', () => {
  it('⭐ la BRECHA y el IMPACTO los agrega el SERVIDOR: prometí 43, conseguí 45, sobre 12,000 pzas', async () => {
    const id = await versionIncumplida('CYA-26-71-030', {
      prometido: 43,
      conseguido: 45,
      piezas: 12_000,
    });

    const lista = await consultarPromesasIncumplidas(sesion(), {}, bd());

    expect(lista.total).toBe(1);
    expect(lista.datos[0]).toMatchObject({
      idModelo: id,
      codigo: 'CYA-26-71-030-01',
      codigoPadre: 'CYA-26-71-030',
      cliente: 'C&A México',
      costoPrometido: 43,
      costoConseguido: 45,
      brecha: 2,
      piezasPedidas: 12_000,
      impacto: 24_000,
      revisadoPor: 'Aurora',
    });
    expect(lista.impactoTotal).toBe(24_000);
  });

  it('⭐⭐ ordena por lo que MÁS DINERO cuesta, y el `impactoTotal` es el de la CARTERA', async () => {
    // La cara por prenda (brecha 9) pesa menos que la barata sobre mucho volumen (2 × 12,000).
    const caraPocas = await versionIncumplida('CYA-26-71-031', {
      prometido: 40,
      conseguido: 49,
      piezas: 100,
      folio: 601,
    });
    const baratMuchas = await versionIncumplida('CYA-26-71-032', {
      prometido: 43,
      conseguido: 45,
      piezas: 12_000,
      folio: 602,
    });

    const lista = await consultarPromesasIncumplidas(sesion(), {}, bd());

    expect(lista.datos.map((d) => d.idModelo)).toEqual([baratMuchas, caraPocas]);
    expect(lista.datos.map((d) => d.impacto)).toEqual([24_000, 900]);
    expect(lista.impactoTotal).toBe(24_900);
  });

  it('⭐ el `impactoTotal` NO es el de la página: con `porPagina` 1 sigue siendo el de las dos', async () => {
    // 🔴 La aserción que impide que alguien "simplifique" sumando en el cliente: ahí el total
    // cambiaría con cada página, y éste es el número que el dueño mira primero.
    await versionIncumplida('CYA-26-71-033', {
      prometido: 40,
      conseguido: 49,
      piezas: 100,
      folio: 603,
    });
    await versionIncumplida('CYA-26-71-034', {
      prometido: 43,
      conseguido: 45,
      piezas: 12_000,
      folio: 604,
    });

    const pagina1 = await consultarPromesasIncumplidas(sesion(), { porPagina: 1 }, bd());

    expect(pagina1.datos).toHaveLength(1);
    expect(pagina1.total).toBe(2);
    expect(pagina1.totalPaginas).toBe(2);
    expect(pagina1.impactoTotal).toBe(24_900);
  });

  it('una promesa CUMPLIDA no aparece: la lista es de lo que NO se consiguió', async () => {
    const padre = await crearPadre('CYA-26-71-035');
    await negociarModelo(padre.id, { costoEstimado: 43 });
    const v = await crearVersion('CYA-26-71-035-01', padre.id);
    await aprobarRevisionModelo(sesion(FIRMANTE), v.id, { meta: { lograda: true } }, bd());

    const lista = await consultarPromesasIncumplidas(sesion(), {}, bd());
    expect(lista.total).toBe(0);
    // Pero SÍ quedó constancia del «sí» en la fila (el «sí» también es una respuesta).
    expect((await desenlaceDe(v.id)).metaResultado).toBe('lograda');
  });

  it('sin pedido todavía: hay brecha, y el impacto es 0 (no le cuesta a nadie… por ahora)', async () => {
    await versionIncumplida('CYA-26-71-036', { prometido: 43, conseguido: 45, folio: 605 });

    const lista = await consultarPromesasIncumplidas(sesion(), {}, bd());
    expect(lista.datos[0]).toMatchObject({ brecha: 2, piezasPedidas: 0, impacto: 0 });
    expect(lista.impactoTotal).toBe(0);
  });

  it('busca por código de la versión, del padre y por cliente', async () => {
    await versionIncumplida('CYA-26-71-037', { prometido: 43, conseguido: 45, folio: 606 });
    await versionIncumplida('LIV-26-71-038', { prometido: 43, conseguido: 45, folio: 607 });

    const porVersion = await consultarPromesasIncumplidas(
      sesion(),
      { busqueda: 'LIV-26-71-038-01' },
      bd(),
    );
    expect(porVersion.datos.map((d) => d.codigo)).toEqual(['LIV-26-71-038-01']);

    const porPadre = await consultarPromesasIncumplidas(
      sesion(),
      { busqueda: 'CYA-26-71-037' },
      bd(),
    );
    expect(porPadre.datos.map((d) => d.codigo)).toEqual(['CYA-26-71-037-01']);

    const porCliente = await consultarPromesasIncumplidas(sesion(), { busqueda: 'C&A' }, bd());
    expect(porCliente.total).toBe(2);
  });
});

// ── (e) PERMISOS y A9 ─────────────────────────────────────────────────────────

describe('(e) permisos y empresa', () => {
  it('⭐ sin `consultas.ver-importes` NO se ve: esta pantalla ES el dinero', async () => {
    await expect(consultarPromesasIncumplidas(sesion(['modelos.ver']), {}, bd())).rejects.toThrow(
      ErrorPermiso,
    );
  });

  it('sin `modelos.ver` tampoco', async () => {
    await expect(
      consultarPromesasIncumplidas(sesion(['consultas.ver-importes']), {}, bd()),
    ).rejects.toThrow(ErrorPermiso);
  });

  it('⭐ A9: un pedido de OTRA empresa no infla el impacto', async () => {
    const otra = await crearEmpresaPrueba(cliente, 'Otra empresa SA');
    const padre = await crearPadre('CYA-26-71-040');
    await negociarModelo(padre.id, { costoEstimado: 43 });
    const v = await crearVersion('CYA-26-71-040-01', padre.id);
    await crearPedido(v.id, 12_000, otra.id);
    await aprobarRevisionModelo(
      sesion(FIRMANTE),
      v.id,
      { meta: { lograda: false, costoConseguido: 45, nota: 'no bajó la maquila' } },
      bd(),
    );

    const lista = await consultarPromesasIncumplidas(sesion(), {}, bd());
    expect(lista.datos[0]).toMatchObject({ brecha: 2, piezasPedidas: 0, impacto: 0 });
    expect(lista.impactoTotal).toBe(0);
  });
});

describe('⭐ consultarMetaPrometida: la meta que ve quien va a firmar, contra la base', () => {
  it('⭐⭐ la resuelve por el PADRE, y por eso sirve en la PRIMERA firma', async () => {
    // 🔴 El caso que obligó a que este endpoint existiera: `Modelo.metaCostoPrometido` está en NULL
    // —nadie ha declarado un desenlace todavía— y sin embargo hay que enseñar la meta, porque es
    // AHORA cuando se pregunta «¿se logró?».
    const padre = await crearPadre('CYA-26-71-050');
    await negociarModelo(padre.id, { costoEstimado: 43 });
    const v = await crearVersion('CYA-26-71-050-01', padre.id);

    expect((await desenlaceDe(v.id)).metaCostoPrometido).toBeNull();
    await expect(
      consultarMetaPrometida(sesion(FIRMANTE_CON_IMPORTES), v.id, bd()),
    ).resolves.toEqual({ costoPrometido: 43 });
  });

  it('⭐ null cuando la versión no vino de una negociación registrada (y no truena)', async () => {
    const padre = await crearPadre('CYA-26-71-051');
    const v = await crearVersion('CYA-26-71-051-01', padre.id);

    await expect(
      consultarMetaPrometida(sesion(FIRMANTE_CON_IMPORTES), v.id, bd()),
    ).resolves.toEqual({ costoPrometido: null });
  });

  it('⭐ enseña LA MISMA meta que la bandeja y que la que se congela al firmar', async () => {
    // 🔴 Los tres caminos corren la misma SQL a propósito: si la lista enseñara un número, el
    // diálogo otro y la firma congelara un tercero, el desenlace mediría contra algo que nadie vio.
    const padre = await crearPadre('CYA-26-71-052');
    await negociarModelo(padre.id, { costoEstimado: 41.5 });
    const v = await crearVersion('CYA-26-71-052-01', padre.id);

    const enLaBandeja = (await consultarRecetasPorRevisar(sesion(PERMISOS_DUENO), {}, bd()))
      .datos[0]?.costoPrometido;
    const enElDialogo = (await consultarMetaPrometida(sesion(FIRMANTE_CON_IMPORTES), v.id, bd()))
      .costoPrometido;
    await aprobarRevisionModelo(
      sesion(FIRMANTE),
      v.id,
      { meta: { lograda: false, costoConseguido: 45, nota: 'no bajó la maquila' } },
      bd(),
    );
    const congelada = (await desenlaceDe(v.id)).metaCostoPrometido;

    expect(enLaBandeja).toBe(41.5);
    expect(enElDialogo).toBe(41.5);
    expect(congelada).toBe(41.5);
  });
});

/**
 * 🔴🔴 **LA REJA DEL IMPORTE, contra la base.** `modelos.ver` abre la bandeja y **no se resta en
 * ningún escalón** de `prisma/seed.ts`: la tienen Ventas, Logística, Asistente y Secretarial —los
 * mismos a los que se les quitó `consultas.ver-importes` por decisión—. Publicar ahí el costo con el
 * que se cerró la mesa les enseñaría *«la información que vendí»* por la puerta de al lado.
 */
describe('🔴 la META es dinero: la bandeja la oculta a quien no ve importes', () => {
  it('⭐⭐ sin `consultas.ver-importes` el costo prometido llega en NULL', async () => {
    const padre = await crearPadre('CYA-26-71-060');
    await negociarModelo(padre.id, { costoEstimado: 43 });
    await crearVersion('CYA-26-71-060-01', padre.id);

    const conReja = await consultarRecetasPorRevisar(sesion(['modelos.ver']), {}, bd());
    expect(conReja.datos[0]?.costoPrometido).toBeNull();

    // Y con el permiso, el mismo renglón sí lo trae: la ocultación es del PERMISO, no del dato.
    const sinReja = await consultarRecetasPorRevisar(sesion(PERMISOS_DUENO), {}, bd());
    expect(sinReja.datos[0]?.costoPrometido).toBe(43);
  });

  it('⭐ pero la FILA se sigue viendo entera: la cola es su trabajo, el precio no', async () => {
    const padre = await crearPadre('CYA-26-71-061');
    await negociarModelo(padre.id, { costoEstimado: 43 });
    const v = await crearVersion('CYA-26-71-061-01', padre.id);
    await crearPedido(v.id, 800);

    const pagina = await consultarRecetasPorRevisar(sesion(['modelos.ver']), {}, bd());
    expect(pagina.total).toBe(1);
    expect(pagina.datos[0]).toMatchObject({
      idModelo: v.id,
      codigo: 'CYA-26-71-061-01',
      codigoPadre: 'CYA-26-71-061',
      cliente: 'C&A México',
      conPedido: true,
      piezasPedidas: 800,
    });
  });

  it('⭐ y `/meta-prometida` tampoco se la entrega a quien no ve importes', async () => {
    // La tercera puerta al mismo número. Las tres tienen que decir lo mismo.
    const padre = await crearPadre('CYA-26-71-062');
    await negociarModelo(padre.id, { costoEstimado: 43 });
    const v = await crearVersion('CYA-26-71-062-01', padre.id);

    await expect(consultarMetaPrometida(sesion(FIRMANTE), v.id, bd())).rejects.toThrow(
      ErrorPermiso,
    );
  });
});
