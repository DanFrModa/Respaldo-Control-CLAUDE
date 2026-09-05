/**
 * INVENTARIO CÍCLICO (Módulo Indicadores / Almacén, F7-E5; doc `05-Indicadores.md`; ← forms
 * `Alm_IC_Alta`/`Alm_IC_Cont`/`Alm_IC_Consulta`). Toda la lógica de negocio vive AQUÍ (A1); las
 * rutas REST solo validan permiso + Zod y delegan. Cuenta el físico contra el KARDEX de v2, no
 * contra un saldo materializado (D3). Reglas del negocio (D6/D3/D4):
 *
 *  1. El ALTA CONGELA el teórico (D6): enumera los artículos con existencia ≠ 0 del almacén en el
 *     alcance elegido y guarda `cantTeorica` = Σ de movimientos EN ESE INSTANTE, bajo bloqueo por
 *     artículo (suma directa, NUNCA la vista, para el valor congelado). Si se leyera al consultar,
 *     el teórico cambiaría mientras cuentan.
 *  2. Se captura LO CONTADO, nunca una diferencia. En PRODUCTO TERMINADO el conteo es CIEGO (el
 *     capturista no ve el teórico); en TELAS y AVÍOS va CON EL SALDO A LA VISTA (§Post-F9.193
 *     punto 4) — es la misma decisión que la fila 0.098 aplicó al ajuste de telas por color.
 *  3. Exactitud = cantReal − cantTeorica (solo en la vista de consulta, {@link consultarExactitud}).
 *  4. El ajuste se aplica SOLO como MOVIMIENTO de kardex (D3, motor común): JAMÁS se edita un saldo.
 *
 * ⭐ **FILA 0.099 — LAS TRES DIMENSIONES.** Hasta esta fila todo esto existía SÓLO para producto
 * terminado; telas y avíos se ajustaban a mano. Ahora la MISMA hoja cuenta PT, telas o avíos, y lo
 * que decide cuál es el **TIPO DEL ALMACÉN** —no un campo que teclee nadie—: un almacén guarda una
 * sola clase de mercancía (fila 0.137), así que un conteo suyo sólo puede ser de ésa. La dimensión
 * se DERIVA al dar de alta y se PERSISTE en el encabezado; de ahí en adelante manda ella, y
 * `exigirAlmacenDelTipo` es la única puerta que la verifica (al alta y otra vez al cerrar, porque
 * entre una cosa y otra el almacén pudo desactivarse o cambiar).
 *
 * Lo que depende de la LLAVE del artículo —enumerar, congelar bajo bloqueo, aplicar el ajuste al
 * kardex y describir el artículo— vive detrás de un ADAPTADOR por dimensión (`ciclico/tipos.ts`);
 * lo que no depende de ella —folio, estados, cancelación suave, auditoría, exactitud, hoja impresa
 * y el aviso de «el almacén se movió»— vive AQUÍ, una sola vez.
 *
 * ⭐ **EL AVISO DE LA DECISIÓN 6** (§Post-F9.193): si el almacén se movió entre el alta y el cierre,
 * el sistema **avisa y deja decidir, NO bloquea**. Antes nadie avisaba —en NINGUNA dimensión, PT
 * incluida—: el delta se calculaba contra el teórico congelado y se aplicaba a ciegas, así que un
 * conteo de 95 sobre un teórico de 100 con 20 piezas entradas de verdad en medio dejaba 115 en el
 * sistema mientras el anaquel decía 95, sin una palabra. Ahora el primer intento vuelve con el
 * aviso —artículo por artículo, con lo congelado, lo que hay AHORA, lo contado y en cuánto quedará—
 * y SIN escribir nada; el segundo, con `confirmarMovimiento`, aplica.
 *
 * ⭐ **RENGLONES A MANO** (§Post-F9.193): se puede anotar mercancía que el sistema cree que NO tiene
 * ({@link agregarRenglonCiclico}). Por eso el alta ya NO rechaza una hoja vacía: contar un almacén
 * que el sistema cree vacío —el día del arranque, exactamente— es el caso de uso, no un error.
 *
 * Innegociables aplicados: A1 (dominio), A2 (transacción), A3/A7 (folio + bitácora), A4 (permiso por
 * operación), A9 (empresa activa), D3 (existencia = Σ movimientos; ajuste = movimiento, nunca edición).
 */
import {
  esquemaCiclicoRenglonAgregar,
  esquemaInventarioCiclicoAjuste,
  esquemaInventarioCiclicoCancelar,
  esquemaInventarioCiclicoConteo,
  esquemaInventarioCiclicoCrear,
  esquemaInventariosCiclicosQuery,
  type AjusteCiclicoSalida,
  type CiclicoArticuloMovido,
  type ConteoSalida,
  type DatosCiclicoRenglonAgregar,
  type DatosInventarioCiclicoAjuste,
  type DatosInventarioCiclicoCancelar,
  type DatosInventarioCiclicoConteo,
  type DimensionCiclicoValor,
  type ExactitudSalida,
  type InventarioCiclicoResumen,
  type InventariosCiclicosPagina,
  type InventariosCiclicosQuery,
} from '../../contrato/index.js';
import { Prisma, type EstadoInventarioCiclico } from '../../datos/index.js';
import type { z } from 'zod';

import { exigirAlmacenDelTipo, tipoDeAlmacenUsable } from '../../comun/almacenes.js';
import { registrarBitacora } from '../../comun/auditoria.js';
import {
  ErrorConflicto,
  ErrorNoEncontrado,
  ErrorPermiso,
  ErrorValidacion,
} from '../../comun/errores.js';
import { tienePermiso, verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import { siguienteFolio } from '../../comun/secuencias.js';
import {
  clienteLectura,
  enTransaccion,
  type ClienteLectura,
  type ContextoBd,
  type Tx,
} from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';

import { aDateColumna, hoyIso } from './ciclico/comun.js';
import { adaptadorDe, dimensionDeAlmacen } from './ciclico/registro.js';
import {
  redondear,
  textoClave,
  type AdaptadorCiclico,
  type CapturaRenglon,
  type ClaveArticulo,
  type Componentes,
  type ContextoDimension,
  type LineaAjuste,
  type RenglonCiclico,
} from './ciclico/tipos.js';

/** Clave de la secuencia de folios de los cíclicos (A3, por empresa). */
const CLAVE_SECUENCIA_CICLICO = 'inventario-ciclico';

// ── Helpers de permiso ───────────────────────────────────────────────────────────────────────────

/**
 * Exige AL MENOS UNO de los tres permisos del módulo cíclico (alta/conteo/consulta). Lo usan las
 * lecturas COMPARTIDAS (listado, cabecera): un capturista de conteo debe poder ver la lista para
 * elegir qué contar, y un supervisor de alta debe verla también. Las mutaciones y las lecturas
 * sensibles (exactitud) exigen su permiso fino con {@link verificarPermiso}.
 */
function exigirAlgunPermisoCiclico(sesion: SesionUsuario): void {
  if (
    !tienePermiso(sesion, 'indicadores.ciclicos-alta') &&
    !tienePermiso(sesion, 'indicadores.ciclicos-conteo') &&
    !tienePermiso(sesion, 'indicadores.ciclicos-consulta')
  ) {
    throw new ErrorPermiso(undefined, 'indicadores.ciclicos-consulta');
  }
}

/** Exige alta O conteo (para la HOJA de conteo: la imprime el que da de alta o el que va a contar). */
function exigirPermisoHoja(sesion: SesionUsuario): void {
  if (
    !tienePermiso(sesion, 'indicadores.ciclicos-alta') &&
    !tienePermiso(sesion, 'indicadores.ciclicos-conteo')
  ) {
    throw new ErrorPermiso(undefined, 'indicadores.ciclicos-conteo');
  }
}

// ── Encabezado ───────────────────────────────────────────────────────────────────────────────────

/** `include` mínimo para el encabezado (con nombre de almacén). */
const incluirEncabezado = {
  almacen: { select: { nombre: true } },
} satisfies Prisma.InventarioCiclicoInclude;
type EncabezadoConAlmacen = Prisma.InventarioCiclicoGetPayload<{
  include: typeof incluirEncabezado;
}>;

/** Lee el encabezado de la empresa activa (A9) o lanza. */
async function leerEncabezado(
  cliente: ClienteLectura,
  id: number,
  idEmpresa: number,
): Promise<EncabezadoConAlmacen> {
  const inv = await cliente.inventarioCiclico.findFirst({
    where: { id, idEmpresa },
    include: incluirEncabezado,
  });
  if (inv === null) {
    throw new ErrorNoEncontrado('InventarioCiclico', id);
  }
  return inv;
}

/** Proyecta un encabezado + contadores a la forma del resumen del contrato. */
function aResumen(
  inv: EncabezadoConAlmacen,
  totalRenglones: number,
  renglonesContados: number,
): InventarioCiclicoResumen {
  return {
    id: inv.id,
    folio: Number(inv.folio),
    idEmpresa: inv.idEmpresa,
    idAlmacen: inv.idAlmacen,
    almacen: inv.almacen.nombre,
    dimension: inv.dimension,
    fecha: inv.fecha.toISOString().slice(0, 10),
    estado: inv.estado,
    observaciones: inv.observaciones,
    totalRenglones,
    renglonesContados,
    canceladoEn: inv.canceladoEn === null ? null : inv.canceladoEn.toISOString(),
    motivoCancelacion: inv.motivoCancelacion,
    creadoEn: inv.creadoEn.toISOString(),
    creadoPorId: inv.creadoPorId,
  };
}

/**
 * Estado que le toca a la hoja según su avance. Una hoja SIN renglones se queda `abierto`: está
 * vacía, no terminada — y esa distinción importa desde que se puede abrir una hoja de un almacén
 * que el sistema cree vacío y llenarla a mano.
 */
function estadoPorAvance(total: number, contados: number): EstadoInventarioCiclico {
  return total > 0 && contados >= total ? 'contado' : 'abierto';
}

/** Recalcula y persiste el estado de la hoja tras un cambio en su detalle. */
async function refrescarEstado(
  tx: Tx,
  ad: AdaptadorCiclico,
  inv: { id: number; estado: EstadoInventarioCiclico },
  sesion: SesionUsuario,
): Promise<{ total: number; contados: number }> {
  const conteo = await ad.contar(tx, inv.id);
  const nuevoEstado = estadoPorAvance(conteo.total, conteo.contados);
  if (nuevoEstado !== inv.estado) {
    await tx.inventarioCiclico.update({
      where: { id: inv.id },
      data: { estado: nuevoEstado, modificadoPorId: sesion.id },
    });
  }
  return conteo;
}

// ── ALTA ─────────────────────────────────────────────────────────────────────────────────────────

/** Datos del alta de un cíclico (campos del esquema compartido). */
export type EntradaCrearCiclico = z.input<typeof esquemaInventarioCiclicoCrear>;

/**
 * Da de alta un inventario cíclico y CONGELA el teórico (D6). En UNA transacción (A2): deriva la
 * DIMENSIÓN del tipo del almacén, enumera los artículos con existencia ≠ 0 en el alcance, congela
 * `cantTeorica` por artículo bajo bloqueo (suma directa, NUNCA la vista, para el valor congelado) y
 * siembra el detalle POR LOTES. Folio atómico (A3) + bitácora (A7). Permiso
 * `indicadores.ciclicos-alta` (A4).
 *
 * ⚠️ Una hoja puede nacer VACÍA y eso NO es un error: es el arranque (contar un almacén que el
 * sistema cree vacío y llenarlo a mano con {@link agregarRenglonCiclico}). Hasta la fila 0.099 el
 * alta rechazaba ese caso — sin renglones a mano, una hoja vacía no servía para nada.
 */
export async function crearInventarioCiclico(
  sesion: SesionUsuario,
  entrada: EntradaCrearCiclico,
  bd?: ContextoBd,
): Promise<InventarioCiclicoResumen> {
  verificarPermiso(sesion, 'indicadores.ciclicos-alta');
  const datos = validarEntrada(esquemaInventarioCiclicoCrear, entrada);
  const idEmpresa = sesion.idEmpresaActiva;

  const idCreado = await enTransaccion(async (tx) => {
    // QUÉ se cuenta lo manda el almacén: se lee su tipo (ya verificado existe + activo + A9) y de
    // ahí sale la dimensión. Acto seguido se pasa por la ÚNICA puerta (`exigirAlmacenDelTipo`), que
    // es la que de verdad autoriza — nunca un segundo criterio paralelo.
    const tipo = await tipoDeAlmacenUsable(tx, datos.idAlmacen, idEmpresa);
    const dimension = dimensionDeAlmacen(tipo);
    const ad = adaptadorDe(dimension);
    await exigirAlmacenDelTipo(tx, datos.idAlmacen, ad.tipoAlmacen, idEmpresa);

    const ctx: ContextoDimension = { idEmpresa, idAlmacen: datos.idAlmacen };
    const candidatos = await ad.enumerar(tx, ctx, ad.alcance(datos));

    const folio = await siguienteFolio(tx, idEmpresa, CLAVE_SECUENCIA_CICLICO);
    const inventario = await tx.inventarioCiclico.create({
      data: {
        folio,
        idEmpresa,
        idAlmacen: datos.idAlmacen,
        dimension,
        fecha: aDateColumna(hoyIso()),
        estado: 'abierto',
        ...(datos.observaciones === undefined ? {} : { observaciones: datos.observaciones }),
        creadoPorId: sesion.id,
        modificadoPorId: sesion.id,
      },
      select: { id: true },
    });

    // Congela el teórico bajo bloqueo. Si un artículo corrió a 0 entre la lectura de la vista y el
    // lock, se OMITE (no se cuenta lo que ya no existe); si el usuario sabe que sí hay algo ahí, lo
    // agrega a mano — que es justo para lo que sirve `agregarRenglonCiclico`.
    const existencias = await ad.leerExistenciasBloqueadas(tx, ctx, candidatos);
    const renglones = candidatos
      .map((clave) => ({ clave, teorico: existencias.get(textoClave(clave)) }))
      .filter(
        (r): r is { clave: ClaveArticulo; teorico: Componentes } =>
          r.teorico !== undefined && (r.teorico.cuerpo !== 0 || (r.teorico.complemento ?? 0) !== 0),
      );
    await ad.sembrar(tx, sesion, inventario.id, renglones);

    await registrarBitacora(tx, sesion, {
      entidad: 'InventarioCiclico',
      idEntidad: inventario.id,
      accion: 'CREAR',
      datos: {
        folio: folio.toString(),
        idAlmacen: datos.idAlmacen,
        dimension,
        renglones: renglones.length,
      },
    });

    return inventario.id;
  }, bd);

  return obtenerResumen(sesion, idCreado, bd);
}

// ── Lecturas: RESUMEN / LISTADO ──────────────────────────────────────────────────────────────────

/**
 * Resumen (encabezado + contadores) de un cíclico de la empresa activa (A9). Cabecera de las
 * pantallas de conteo/consulta. Permiso: cualquiera de los tres del módulo.
 */
export async function obtenerResumen(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<InventarioCiclicoResumen> {
  exigirAlgunPermisoCiclico(sesion);
  const cliente = clienteLectura(bd);
  const inv = await leerEncabezado(cliente, id, sesion.idEmpresaActiva);
  const { total, contados } = await adaptadorDe(inv.dimension).contar(cliente, id);
  return aResumen(inv, total, contados);
}

/** Filas de un `groupBy` por hoja (la forma común de las tres tablas de detalle). */
type ConteoAgrupado = { idInventarioCiclico: number; _count: { _all: number } }[];

/**
 * Contadores (total/contados) de VARIAS hojas de la MISMA dimensión, en dos consultas agrupadas —
 * no una por hoja. El `groupBy` se escribe literal en cada rama: Prisma tipa el argumento contra SU
 * modelo y pasarlo por una variable compartida pierde la inferencia del `_count`.
 */
async function contadoresPorDimension(
  cliente: ClienteLectura,
  dimension: DimensionCiclicoValor,
  ids: number[],
): Promise<Map<number, { total: number; contados: number }>> {
  const mapa = new Map<number, { total: number; contados: number }>();
  if (ids.length === 0) return mapa;
  const todos = { idInventarioCiclico: { in: ids } };
  const contadas = { idInventarioCiclico: { in: ids }, cantReal: { not: null } };

  let totales: ConteoAgrupado;
  let contados: ConteoAgrupado;
  if (dimension === 'TELA') {
    [totales, contados] = await Promise.all([
      cliente.inventarioCiclicoDetTela.groupBy({
        by: ['idInventarioCiclico'],
        where: todos,
        _count: { _all: true },
      }),
      cliente.inventarioCiclicoDetTela.groupBy({
        by: ['idInventarioCiclico'],
        where: contadas,
        _count: { _all: true },
      }),
    ]);
  } else if (dimension === 'AVIO') {
    [totales, contados] = await Promise.all([
      cliente.inventarioCiclicoDetAvio.groupBy({
        by: ['idInventarioCiclico'],
        where: todos,
        _count: { _all: true },
      }),
      cliente.inventarioCiclicoDetAvio.groupBy({
        by: ['idInventarioCiclico'],
        where: contadas,
        _count: { _all: true },
      }),
    ]);
  } else {
    [totales, contados] = await Promise.all([
      cliente.inventarioCiclicoDet.groupBy({
        by: ['idInventarioCiclico'],
        where: todos,
        _count: { _all: true },
      }),
      cliente.inventarioCiclicoDet.groupBy({
        by: ['idInventarioCiclico'],
        where: contadas,
        _count: { _all: true },
      }),
    ]);
  }

  const totMap = new Map(totales.map((t) => [t.idInventarioCiclico, t._count._all]));
  const conMap = new Map(contados.map((c) => [c.idInventarioCiclico, c._count._all]));
  for (const id of ids) {
    mapa.set(id, { total: totMap.get(id) ?? 0, contados: conMap.get(id) ?? 0 });
  }
  return mapa;
}

/** Lista paginada de cíclicos de la empresa activa (A9), con sus contadores. Permiso: cualquiera de los tres. */
export async function listarInventariosCiclicos(
  sesion: SesionUsuario,
  query: z.input<typeof esquemaInventariosCiclicosQuery> = {},
  bd?: ContextoBd,
): Promise<InventariosCiclicosPagina> {
  exigirAlgunPermisoCiclico(sesion);
  const filtros: InventariosCiclicosQuery = validarEntrada(esquemaInventariosCiclicosQuery, query);
  const cliente = clienteLectura(bd);
  const where: Prisma.InventarioCiclicoWhereInput = {
    idEmpresa: sesion.idEmpresaActiva,
    // La BANDEJA viva solo muestra conteos de almacenes ACTIVOS: no se opera un conteo en un almacén
    // dado de baja. Esto excluye por diseño los cíclicos HISTÓRICOS Proscai (F7-E6), que viven en el
    // almacén sentinela `(Migración Proscai)` INACTIVO — así no tapan la operación real (toman los
    // folios más nuevos). Siguen 100% consultables por id (resumen/conteo/exactitud) y en el cuadre.
    almacen: { activo: true },
    ...(filtros.estado === undefined ? {} : { estado: filtros.estado }),
    ...(filtros.idAlmacen === undefined ? {} : { idAlmacen: filtros.idAlmacen }),
    ...(filtros.dimension === undefined ? {} : { dimension: filtros.dimension }),
  };
  const [total, filas] = await Promise.all([
    cliente.inventarioCiclico.count({ where }),
    cliente.inventarioCiclico.findMany({
      where,
      include: incluirEncabezado,
      orderBy: [{ folio: 'desc' }],
      skip: (filtros.pagina - 1) * filtros.porPagina,
      take: filtros.porPagina,
    }),
  ]);

  // Los contadores viven en TRES tablas distintas (una por dimensión): se agrupan por dimensión y
  // no fila por fila.
  const porDimension = await Promise.all(
    (['PT', 'TELA', 'AVIO'] as const).map(async (d) => ({
      dimension: d,
      mapa: await contadoresPorDimension(
        cliente,
        d,
        filas.filter((f) => f.dimension === d).map((f) => f.id),
      ),
    })),
  );
  const contadores = new Map(porDimension.map((p) => [p.dimension, p.mapa]));

  return {
    datos: filas.map((f) => {
      const c = contadores.get(f.dimension)?.get(f.id);
      return aResumen(f, c?.total ?? 0, c?.contados ?? 0);
    }),
    total,
    pagina: filtros.pagina,
    porPagina: filtros.porPagina,
    totalPaginas: Math.max(1, Math.ceil(total / filtros.porPagina)),
  };
}

// ── Lectura: CONTEO ──────────────────────────────────────────────────────────────────────────────

/**
 * Lee la vista de CONTEO. En PT es CIEGA: los renglones salen SIN `cantTeorica` — la clave ni
 * siquiera existe en la respuesta (defensa en profundidad, D6). En telas y avíos el teórico SÍ va:
 * es la columna «Sistema» que Daniel pidió tener a la vista al capturar (§Post-F9.193 punto 4).
 * Interna: la usan {@link obtenerConteo} (permiso conteo) y la hoja PDF (permiso alta/conteo).
 */
async function leerConteo(id: number, idEmpresa: number, bd?: ContextoBd): Promise<ConteoSalida> {
  const cliente = clienteLectura(bd);
  const inv = await leerEncabezado(cliente, id, idEmpresa);
  const ad = adaptadorDe(inv.dimension);
  const renglones = await ad.leer(cliente, id);
  return {
    id: inv.id,
    folio: Number(inv.folio),
    idAlmacen: inv.idAlmacen,
    almacen: inv.almacen.nombre,
    dimension: inv.dimension,
    fecha: inv.fecha.toISOString().slice(0, 10),
    estado: inv.estado,
    renglones: renglones.map((r) => ({
      idDet: r.idDet,
      titulo: r.titulo,
      subtitulo: r.subtitulo,
      unidad: r.unidad,
      // El conteo ciego NO omite el valor: omite la CLAVE. Ver el comentario del contrato.
      ...(ad.conteoCiego
        ? {}
        : {
            cantTeorica: r.cantTeorica,
            ...(r.cantTeoricaComplemento === null
              ? {}
              : { cantTeoricaComplemento: r.cantTeoricaComplemento }),
          }),
      cantReal: r.cantReal,
      nombreComplemento: r.nombreComplemento,
      cantRealComplemento: r.cantRealComplemento,
      contado: r.cantReal !== null,
    })),
  };
}

/** Vista de CONTEO de un cíclico. Permiso `indicadores.ciclicos-conteo` (A4). */
export async function obtenerConteo(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<ConteoSalida> {
  verificarPermiso(sesion, 'indicadores.ciclicos-conteo');
  return leerConteo(id, sesion.idEmpresaActiva, bd);
}

/** Vista de CONTEO para la HOJA de conteo (PDF). Permiso alta O conteo. */
export async function leerConteoParaHoja(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<ConteoSalida> {
  exigirPermisoHoja(sesion);
  return leerConteo(id, sesion.idEmpresaActiva, bd);
}

// ── Escritura: CAPTURAR CONTEO ───────────────────────────────────────────────────────────────────

/** Lee el encabezado BAJO BLOQUEO de fila y exige que la hoja siga viva (ni cerrada ni cancelada). */
async function encabezadoVivoBloqueado(
  tx: Tx,
  id: number,
  idEmpresa: number,
  accion: string,
): Promise<{
  id: number;
  folio: bigint;
  idAlmacen: number;
  estado: EstadoInventarioCiclico;
  dimension: DimensionCiclicoValor;
}> {
  const filas = await tx.$queryRaw<
    {
      id: number;
      folio: bigint;
      idAlmacen: number;
      estado: EstadoInventarioCiclico;
      dimension: DimensionCiclicoValor;
    }[]
  >`
    SELECT "id", "folio", "id_almacen" AS "idAlmacen", "estado", "dimension"
    FROM "inventarios_ciclicos"
    WHERE "id" = ${id} AND "id_empresa" = ${idEmpresa}
    FOR UPDATE
  `;
  const inv = filas[0];
  if (inv === undefined) {
    throw new ErrorNoEncontrado('InventarioCiclico', id);
  }
  if (inv.estado === 'cerrado' || inv.estado === 'cancelado') {
    throw new ErrorConflicto(`El inventario cíclico está ${inv.estado} y ya no admite ${accion}.`);
  }
  return inv;
}

/**
 * Captura el conteo físico de uno o varios renglones: LO CONTADO, nunca una diferencia. Guarda
 * `cantReal` (+ el complemento en telas que lo llevan) con `contadoEn`/`contadoPorId` y recalcula el
 * estado. Rechaza si el cíclico ya está `cerrado`/`cancelado`, si algún renglón no le pertenece o si
 * se repite un renglón en la misma captura. Permiso `indicadores.ciclicos-conteo` (A4). A2 en
 * transacción; la escritura es UNA sentencia por lote, no una por renglón (esta pantalla carga
 * inventarios completos).
 */
export async function capturarConteo(
  sesion: SesionUsuario,
  id: number,
  cuerpo: DatosInventarioCiclicoConteo,
  bd?: ContextoBd,
): Promise<ConteoSalida> {
  verificarPermiso(sesion, 'indicadores.ciclicos-conteo');
  const datos = validarEntrada(esquemaInventarioCiclicoConteo, cuerpo);
  const idEmpresa = sesion.idEmpresaActiva;

  const ids = datos.renglones.map((r) => r.idDet);
  if (new Set(ids).size !== ids.length) {
    throw new ErrorValidacion('Un renglón aparece dos veces en la misma captura.');
  }

  await enTransaccion(async (tx) => {
    const inv = await encabezadoVivoBloqueado(tx, id, idEmpresa, 'captura de conteo');
    const ad = adaptadorDe(inv.dimension);

    // Todos los renglones deben pertenecer a ESTE cíclico (A9 + no capturar sobre otro). De paso,
    // el detalle leído dice qué renglones llevan complemento (D5).
    const detalle = await ad.leer(tx, id);
    const porId = new Map(detalle.map((d) => [d.idDet, d]));
    const capturas: CapturaRenglon[] = [];
    for (const r of datos.renglones) {
      const renglon = porId.get(r.idDet);
      if (renglon === undefined) {
        throw new ErrorValidacion('Algún renglón no pertenece a este inventario cíclico.');
      }
      const llevaComplemento = renglon.nombreComplemento !== null;
      if (!llevaComplemento && r.cantRealComplemento !== undefined) {
        throw new ErrorValidacion(
          `«${renglon.titulo}» no tiene un segundo componente que contar.`,
        );
      }
      if (llevaComplemento && r.cantRealComplemento === undefined) {
        // Dar por contado un renglón con la mitad sin contar dejaría un componente fuera del
        // ajuste sin que nadie lo note: se pide entero o no se captura.
        throw new ErrorValidacion(
          `«${renglon.titulo}» lleva ${renglon.nombreComplemento ?? 'complemento'}: captura también lo contado de ese componente.`,
        );
      }
      capturas.push({
        idDet: r.idDet,
        cantReal: r.cantReal,
        cantRealComplemento: r.cantRealComplemento ?? null,
      });
    }

    await ad.guardarConteo(tx, sesion, id, capturas);
    const conteo = await refrescarEstado(tx, ad, inv, sesion);

    await registrarBitacora(tx, sesion, {
      entidad: 'InventarioCiclico',
      idEntidad: inv.id,
      accion: 'OTRO',
      datos: { conteo: capturas.length, contados: conteo.contados, total: conteo.total },
    });
  }, bd);

  return leerConteo(id, idEmpresa, bd);
}

// ── Escritura: AGREGAR un renglón que la enumeración no trajo ────────────────────────────────────

/**
 * Agrega a la hoja un artículo que el alta NO enumeró — mercancía que el sistema cree que NO tiene
 * (§Post-F9.193: *«se puede anotar mercancía con existencia cero»*). El teórico del renglón nuevo se
 * CONGELA igual que el del alta: bajo bloqueo, por Σ directa de movimientos. En el caso normal eso
 * ES 0 —la enumeración sólo omite lo que no tiene existencia—, y si entre el alta y ahora ese
 * artículo se movió de verdad, el renglón nace con lo que hay y el aviso de la decisión 6 lo dirá al
 * cerrar; congelar un 0 a la fuerza sería inventar un teórico que la BD desmiente.
 *
 * El encabezado se bloquea con `FOR UPDATE` ANTES de comprobar el duplicado: dos altas simultáneas
 * del mismo artículo no pueden pasar las dos (en PT la unicidad de la BD no alcanza — Postgres
 * trata los NULL de `id_orden` como distintos). Permiso `indicadores.ciclicos-conteo` (A4).
 */
export async function agregarRenglonCiclico(
  sesion: SesionUsuario,
  id: number,
  cuerpo: DatosCiclicoRenglonAgregar,
  bd?: ContextoBd,
): Promise<ConteoSalida> {
  verificarPermiso(sesion, 'indicadores.ciclicos-conteo');
  const datos = validarEntrada(esquemaCiclicoRenglonAgregar, cuerpo);
  const idEmpresa = sesion.idEmpresaActiva;

  await enTransaccion(async (tx) => {
    const inv = await encabezadoVivoBloqueado(tx, id, idEmpresa, 'renglones nuevos');
    const ad = adaptadorDe(inv.dimension);
    // El almacén sigue teniendo que ser del tipo de la hoja: si cambió o se desactivó, no se le
    // agregan renglones (misma puerta que el alta y el cierre).
    await exigirAlmacenDelTipo(tx, inv.idAlmacen, ad.tipoAlmacen, idEmpresa);

    const clave = await ad.resolverClaveNueva(tx, { idEmpresa, idAlmacen: inv.idAlmacen }, datos);
    const yaEstan = new Set((await ad.leer(tx, id)).map((r) => textoClave(r.clave)));
    if (yaEstan.has(textoClave(clave))) {
      throw new ErrorConflicto(`Ese ${ad.nombreArticulo} ya está en la hoja de conteo.`);
    }

    const ctx: ContextoDimension = { idEmpresa, idAlmacen: inv.idAlmacen };
    const existencias = await ad.leerExistenciasBloqueadas(tx, ctx, [clave]);
    const teorico = existencias.get(textoClave(clave));
    if (teorico === undefined) {
      throw new ErrorValidacion('No se pudo leer la existencia del artículo que se agrega.');
    }
    await ad.sembrar(tx, sesion, id, [{ clave, teorico }]);
    await refrescarEstado(tx, ad, inv, sesion);

    await registrarBitacora(tx, sesion, {
      entidad: 'InventarioCiclico',
      idEntidad: inv.id,
      accion: 'OTRO',
      datos: { renglonAgregado: clave, cantTeorica: teorico.cuerpo },
    });
  }, bd);

  return leerConteo(id, idEmpresa, bd);
}

// ── Lectura: EXACTITUD (teórico vs real) ─────────────────────────────────────────────────────────

/** Proyecta el detalle a la vista de exactitud + sus totales. */
function aExactitud(
  inv: EncabezadoConAlmacen,
  ad: AdaptadorCiclico,
  renglones: readonly RenglonCiclico[],
): ExactitudSalida {
  let contados = 0;
  let exactos = 0;
  let diferencias = 0;
  let teorico = 0;
  let real = 0;
  const filas = renglones.map((r) => {
    teorico = redondear(teorico + r.cantTeorica, ad.escala);
    const exactitud = r.cantReal === null ? null : redondear(r.cantReal - r.cantTeorica, ad.escala);
    const exactitudComplemento =
      r.cantTeoricaComplemento === null || r.cantRealComplemento === null
        ? null
        : redondear(r.cantRealComplemento - r.cantTeoricaComplemento, ad.escala);
    if (r.cantReal !== null) {
      contados += 1;
      real = redondear(real + r.cantReal, ad.escala);
      // Un renglón sólo es EXACTO si cuadran sus DOS componentes: mirar sólo el cuerpo daría por
      // bueno un conteo al que le sobra medio rollo de cardigan.
      if (exactitud === 0 && (exactitudComplemento ?? 0) === 0) exactos += 1;
      else diferencias += 1;
    }
    return {
      idDet: r.idDet,
      titulo: r.titulo,
      subtitulo: r.subtitulo,
      unidad: r.unidad,
      cantTeorica: r.cantTeorica,
      cantReal: r.cantReal,
      exactitud,
      nombreComplemento: r.nombreComplemento,
      cantTeoricaComplemento: r.cantTeoricaComplemento,
      cantRealComplemento: r.cantRealComplemento,
      exactitudComplemento,
      ajustes: r.ajustes,
    };
  });

  return {
    id: inv.id,
    folio: Number(inv.folio),
    idEmpresa: inv.idEmpresa,
    idAlmacen: inv.idAlmacen,
    almacen: inv.almacen.nombre,
    dimension: inv.dimension,
    fecha: inv.fecha.toISOString().slice(0, 10),
    estado: inv.estado,
    observaciones: inv.observaciones,
    canceladoEn: inv.canceladoEn === null ? null : inv.canceladoEn.toISOString(),
    motivoCancelacion: inv.motivoCancelacion,
    renglones: filas,
    totales: { total: filas.length, contados, exactos, diferencias, teorico, real },
  };
}

/**
 * Vista de EXACTITUD de un cíclico: por renglón `cantTeorica`/`cantReal`/`exactitud` (= real−teórico)
 * + los movimientos de ajuste que lo reconciliaron + totales. Permiso `indicadores.ciclicos-consulta`
 * (A4). A9.
 */
export async function consultarExactitud(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<ExactitudSalida> {
  verificarPermiso(sesion, 'indicadores.ciclicos-consulta');
  const cliente = clienteLectura(bd);
  const inv = await leerEncabezado(cliente, id, sesion.idEmpresaActiva);
  const ad = adaptadorDe(inv.dimension);
  return aExactitud(inv, ad, await ad.leer(cliente, id));
}

// ── Escritura: GENERAR AJUSTE ────────────────────────────────────────────────────────────────────

/** Un componente de un renglón, ya con su diferencia calculada. */
interface DeltaComponente {
  cantTeorica: number;
  cantReal: number | null;
  existenciaActual: number;
  diferencia: number;
}

/** Lo que el ajuste va a escribir, ya repartido en sus dos patas + el aviso de la decisión 6. */
interface PlanAjuste {
  entradas: { linea: LineaAjuste; idDet: number }[];
  salidas: { linea: LineaAjuste; idDet: number }[];
  movidos: CiclicoArticuloMovido[];
}

/**
 * ARITMÉTICA PURA del cierre (sin BD, sin sesión): por renglón y por componente calcula la
 * diferencia CONTADO − TEÓRICO CONGELADO, la reparte en las dos patas del ajuste y arma el AVISO con
 * los artículos cuya existencia ACTUAL ya no es la que se congeló.
 *
 * ⚠️ **La diferencia se calcula contra el teórico CONGELADO, no contra la existencia de ahora**, y
 * eso es a propósito: el conteo físico es contemporáneo del congelado, así que ésa es la diferencia
 * que el conteo midió. Lo que la fila 0.099 arregla no es el número — es que ANTES nadie decía nada
 * cuando el almacén se había movido en medio. Ahora el aviso pone las tres cifras juntas (congelado,
 * actual, contado) y **dice en cuánto va a quedar la existencia si se aplica**, que es exactamente
 * lo que hace falta para decidir entre aplicar o volver a contar.
 */
export function planearAjuste(
  renglones: readonly RenglonCiclico[],
  existencias: ReadonlyMap<string, Componentes>,
  escala: 0 | 4,
): PlanAjuste {
  const entradas: PlanAjuste['entradas'] = [];
  const salidas: PlanAjuste['salidas'] = [];
  const movidos: PlanAjuste['movidos'] = [];

  for (const r of renglones) {
    const actual = existencias.get(textoClave(r.clave));
    if (actual === undefined) {
      throw new ErrorValidacion(`No se pudo leer la existencia actual de «${r.titulo}».`);
    }
    const llevaComplemento = r.cantTeoricaComplemento !== null;
    const componentes: { nombre: 'cuerpo' | 'complemento'; datos: DeltaComponente }[] = [
      {
        nombre: 'cuerpo',
        datos: {
          cantTeorica: r.cantTeorica,
          cantReal: r.cantReal,
          existenciaActual: actual.cuerpo,
          diferencia: r.cantReal === null ? 0 : redondear(r.cantReal - r.cantTeorica, escala),
        },
      },
    ];
    if (llevaComplemento) {
      const teoricoComp = r.cantTeoricaComplemento ?? 0;
      componentes.push({
        nombre: 'complemento',
        datos: {
          cantTeorica: teoricoComp,
          cantReal: r.cantRealComplemento,
          existenciaActual: actual.complemento ?? 0,
          diferencia:
            r.cantRealComplemento === null
              ? 0
              : redondear(r.cantRealComplemento - teoricoComp, escala),
        },
      });
    }

    for (const c of componentes) {
      if (redondear(c.datos.existenciaActual - c.datos.cantTeorica, escala) !== 0) {
        movidos.push({
          idDet: r.idDet,
          titulo: r.titulo,
          subtitulo: r.subtitulo,
          componente: c.nombre,
          cantTeorica: c.datos.cantTeorica,
          existenciaActual: c.datos.existenciaActual,
          cantReal: c.datos.cantReal,
          ajuste: c.datos.diferencia,
          existenciaResultante: redondear(
            c.datos.existenciaActual + c.datos.diferencia,
            escala,
          ),
        });
      }
    }

    const difCuerpo = componentes[0]?.datos.diferencia ?? 0;
    const difComplemento = llevaComplemento ? (componentes[1]?.datos.diferencia ?? 0) : 0;
    // Los CUATRO cuadrantes: cada componente decide su pata por separado, así que un renglón puede
    // caer en las dos a la vez (sobra cuerpo y falta complemento, o su espejo). Escribir sólo una
    // de las dos diagonales cruzadas es la trampa de la rama gemela que la fila 0.098 ya pisó.
    if (difCuerpo > 0 || difComplemento > 0) {
      entradas.push({
        idDet: r.idDet,
        linea: {
          clave: r.clave,
          cuerpo: Math.max(difCuerpo, 0),
          complemento: llevaComplemento ? Math.max(difComplemento, 0) : null,
        },
      });
    }
    if (difCuerpo < 0 || difComplemento < 0) {
      salidas.push({
        idDet: r.idDet,
        linea: {
          clave: r.clave,
          cuerpo: Math.max(-difCuerpo, 0),
          complemento: llevaComplemento ? Math.max(-difComplemento, 0) : null,
        },
      });
    }
  }

  return { entradas, salidas, movidos };
}

/**
 * Genera el AJUSTE del cíclico (D3): por cada renglón contado con diferencia ≠ 0 aplica el delta
 * como MOVIMIENTO de kardex — entrada (`ajuste-ciclico-entrada`) si real > teórico, salida
 * (`ajuste-ciclico-salida`) si real < teórico —, JAMÁS editando un saldo. Agrupa los deltas del
 * mismo signo en UN solo movimiento por almacén (entradas juntas / salidas juntas) para no explotar
 * el folio; cada renglón queda enlazado a su(s) movimiento(s). Exige estado `contado` y RECHAZA
 * re-generar (`cerrado`/`cancelado`). Todo en UNA transacción (A2/A3/A7).
 *
 * ⭐ **El AVISO de la decisión 6.** Antes de escribir nada compara la existencia ACTUAL (bajo el
 * mismo bloqueo con el que va a escribir) contra el teórico congelado. Si algo se movió y el
 * llamador no lo ha confirmado, **devuelve el aviso y NO aplica** — es un dato de la respuesta, no
 * un error: la decisión de Daniel es *avisar y dejar decidir, no bloquear*. Con
 * `confirmarMovimiento: true` aplica igual.
 *
 * Permisos: `indicadores.ciclicos-consulta` (A4) y, en telas y avíos, ADEMÁS el `.mover` de esa
 * dimensión — el ajuste escribe en SU kardex, y abrir el cíclico a telas no debía regalarle esa
 * llave a quien no la tenía. En PT no cambia nada (no había permiso extra y sigue sin haberlo).
 */
export async function generarAjusteCiclico(
  sesion: SesionUsuario,
  id: number,
  cuerpo: z.input<typeof esquemaInventarioCiclicoAjuste> = {},
  bd?: ContextoBd,
): Promise<AjusteCiclicoSalida> {
  verificarPermiso(sesion, 'indicadores.ciclicos-consulta');
  const datos: DatosInventarioCiclicoAjuste = validarEntrada(esquemaInventarioCiclicoAjuste, cuerpo);
  const idEmpresa = sesion.idEmpresaActiva;

  const resultado = await enTransaccion(async (tx) => {
    // SERIALIZA la generación del ajuste (anti doble-ajuste concurrente, D3): bloquea la FILA del
    // encabezado con `FOR UPDATE` ANTES de decidir por el estado. Dos POST `/ajuste` casi
    // simultáneos del MISMO cíclico ya no pueden leer ambos `contado` y aplicar el delta 2×: el 2º
    // espera al commit del 1º y, al re-leer BAJO el lock, ve `cerrado` y aborta. El delta se calcula
    // sobre la teórica CONGELADA (no es idempotente), así que este lock —no los advisory por
    // artículo— es la garantía de "se ajusta una sola vez". A9 por empresa activa.
    const filas = await tx.$queryRaw<
      {
        folio: bigint;
        idAlmacen: number;
        estado: EstadoInventarioCiclico;
        dimension: DimensionCiclicoValor;
      }[]
    >`
      SELECT "folio", "id_almacen" AS "idAlmacen", "estado", "dimension"
      FROM "inventarios_ciclicos"
      WHERE "id" = ${id} AND "id_empresa" = ${idEmpresa}
      FOR UPDATE
    `;
    const inv = filas[0];
    if (inv === undefined) {
      throw new ErrorNoEncontrado('InventarioCiclico', id);
    }
    // Decide con el estado leído BAJO el lock (nunca uno leído antes de serializar).
    if (inv.estado === 'cerrado') {
      throw new ErrorConflicto('El inventario cíclico ya generó su ajuste (está cerrado).');
    }
    if (inv.estado === 'cancelado') {
      throw new ErrorConflicto(
        'El inventario cíclico está cancelado: no se puede generar el ajuste.',
      );
    }

    const ad = adaptadorDe(inv.dimension);
    if (ad.permisoAjuste !== null) {
      verificarPermiso(sesion, ad.permisoAjuste);
    }
    // El ajuste escribe en el almacén CONGELADO al dar de alta. Se re-valida aquí (activo + de esta
    // empresa + del tipo de la hoja) por la misma razón que la nota de salida lo hace al confirmar:
    // entre el alta y el cierre alguien pudo desactivarlo o cambiarlo de tipo.
    await exigirAlmacenDelTipo(tx, inv.idAlmacen, ad.tipoAlmacen, idEmpresa);

    const renglones = await ad.leer(tx, id);
    if (renglones.length === 0) {
      throw new ErrorConflicto(
        'La hoja de conteo no tiene ningún renglón: agrega lo que contaste antes de ajustar.',
      );
    }
    if (inv.estado !== 'contado') {
      throw new ErrorConflicto(
        'Faltan renglones por contar: termina el conteo antes de generar el ajuste.',
      );
    }

    const ctx: ContextoDimension = { idEmpresa, idAlmacen: inv.idAlmacen };
    const existencias = await ad.leerExistenciasBloqueadas(
      tx,
      ctx,
      renglones.map((r) => r.clave),
    );
    const plan = planearAjuste(renglones, existencias, ad.escala);

    // DECISIÓN 6 — avisar y dejar decidir, NO bloquear. Se sale ANTES de escribir nada; los locks
    // se sueltan al commit de esta transacción sin efectos.
    if (plan.movidos.length > 0 && !datos.confirmarMovimiento) {
      return { aplicado: false, aviso: { articulos: plan.movidos } };
    }

    // Las SALIDAS no pueden dejar la existencia en negativo (D3). Se valida contra la existencia
    // ACTUAL leída bajo el MISMO bloqueo con el que se va a escribir — nunca contra la vista.
    for (const s of plan.salidas) {
      const actual = existencias.get(textoClave(s.linea.clave));
      const renglon = renglones.find((r) => r.idDet === s.idDet);
      const nombre = renglon?.titulo ?? 'un artículo';
      if (actual === undefined) {
        throw new ErrorValidacion(`No se pudo leer la existencia actual de «${nombre}».`);
      }
      if (redondear(actual.cuerpo - s.linea.cuerpo, ad.escala) < 0) {
        throw new ErrorConflicto(
          `El ajuste de salida dejaría el inventario en negativo: se intenta bajar ` +
            `${String(s.linea.cuerpo)} de «${nombre}», que tiene ${String(actual.cuerpo)}.`,
        );
      }
      const complemento = s.linea.complemento ?? 0;
      if (complemento > 0 && redondear((actual.complemento ?? 0) - complemento, ad.escala) < 0) {
        throw new ErrorConflicto(
          `El ajuste de salida dejaría en negativo el segundo componente de «${nombre}»: se ` +
            `intenta bajar ${String(complemento)} de ${String(actual.complemento ?? 0)}.`,
        );
      }
    }

    const observaciones = `Ajuste por inventario cíclico #${inv.folio.toString()}`;
    const fecha = aDateColumna(hoyIso());

    let idMovSalida: number | null = null;
    if (plan.salidas.length > 0) {
      idMovSalida = await ad.registrarAjuste(
        tx,
        sesion,
        ctx,
        'salida',
        plan.salidas.map((s) => s.linea),
        { observaciones, idCiclico: id, fecha },
      );
      await ad.enlazar(
        tx,
        sesion,
        plan.salidas.map((s) => s.idDet),
        idMovSalida,
        'salida',
      );
    }

    let idMovEntrada: number | null = null;
    if (plan.entradas.length > 0) {
      idMovEntrada = await ad.registrarAjuste(
        tx,
        sesion,
        ctx,
        'entrada',
        plan.entradas.map((e) => e.linea),
        { observaciones, idCiclico: id, fecha },
      );
      await ad.enlazar(
        tx,
        sesion,
        plan.entradas.map((e) => e.idDet),
        idMovEntrada,
        'entrada',
      );
    }

    await tx.inventarioCiclico.update({
      where: { id },
      data: { estado: 'cerrado', modificadoPorId: sesion.id },
    });

    await registrarBitacora(tx, sesion, {
      entidad: 'InventarioCiclico',
      idEntidad: id,
      accion: 'OTRO',
      datos: {
        ajuste: true,
        dimension: inv.dimension,
        entradas: plan.entradas.length,
        salidas: plan.salidas.length,
        articulosMovidos: plan.movidos.length,
        idMovEntrada,
        idMovSalida,
      },
    });

    return {
      aplicado: true,
      aviso: plan.movidos.length > 0 ? { articulos: plan.movidos } : null,
    };
  }, bd);

  return {
    aplicado: resultado.aplicado,
    aviso: resultado.aviso,
    exactitud: await consultarExactitud(sesion, id, bd),
  };
}

// ── Escritura: CANCELAR ──────────────────────────────────────────────────────────────────────────

/**
 * Cancela (suave, A7) un cíclico SIN generar ajuste: aborta el conteo. Rechaza si ya está `cerrado`
 * (el ajuste ya se aplicó — no hay marcha atrás por esta vía) o `cancelado`. Permiso
 * `indicadores.ciclicos-alta` (A4). A9 por empresa.
 */
export async function cancelarInventarioCiclico(
  sesion: SesionUsuario,
  id: number,
  cuerpo: DatosInventarioCiclicoCancelar,
  bd?: ContextoBd,
): Promise<InventarioCiclicoResumen> {
  verificarPermiso(sesion, 'indicadores.ciclicos-alta');
  const datos = validarEntrada(esquemaInventarioCiclicoCancelar, cuerpo);
  const idEmpresa = sesion.idEmpresaActiva;

  await enTransaccion(async (tx) => {
    const inv = await tx.inventarioCiclico.findFirst({
      where: { id, idEmpresa },
      select: { id: true, estado: true },
    });
    if (inv === null) {
      throw new ErrorNoEncontrado('InventarioCiclico', id);
    }
    if (inv.estado === 'cerrado') {
      throw new ErrorConflicto('El inventario cíclico ya está cerrado (con ajuste): no se cancela.');
    }
    if (inv.estado === 'cancelado') {
      throw new ErrorConflicto('El inventario cíclico ya estaba cancelado.');
    }
    await tx.inventarioCiclico.update({
      where: { id: inv.id },
      data: {
        estado: 'cancelado',
        canceladoEn: new Date(),
        canceladoPorId: sesion.id,
        motivoCancelacion: datos.motivo,
        modificadoPorId: sesion.id,
      },
    });
    await registrarBitacora(tx, sesion, {
      entidad: 'InventarioCiclico',
      idEntidad: inv.id,
      accion: 'CANCELAR',
      datos: { motivo: datos.motivo },
    });
  }, bd);

  return obtenerResumen(sesion, id, bd);
}
