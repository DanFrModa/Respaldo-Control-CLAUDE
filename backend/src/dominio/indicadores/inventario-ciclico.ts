/**
 * INVENTARIO CÍCLICO (Módulo Indicadores / Almacén, F7-E5; doc `05-Indicadores.md`; ← forms
 * `Alm_IC_Alta`/`Alm_IC_Cont`/`Alm_IC_Consulta`). Toda la lógica de negocio vive AQUÍ (A1); las
 * rutas REST solo validan permiso + Zod y delegan. Cuenta el físico contra el KARDEX de v2, no
 * contra un saldo materializado (D3). Reglas del negocio (D6/D3/D4):
 *
 *  1. El ALTA CONGELA el teórico (D6): al dar de alta, enumera los artículos con existencia ≠ 0 del
 *     almacén en el alcance elegido y guarda `cantTeorica` = Σ de movimientos EN ESE INSTANTE, bajo
 *     bloqueo por artículo (`bloquearArticuloPt` + `existenciaPtBloqueada`, suma directa NUNCA la
 *     vista para el valor congelado). Si se leyera al consultar, el teórico cambiaría mientras cuentan.
 *  2. Conteo CIEGO: el capturista NO ve el teórico (ni en pantalla ni en la hoja de conteo PDF). Las
 *     respuestas del conteo ({@link obtenerConteo}/{@link capturarConteo}) NO incluyen `cantTeorica`.
 *  3. Exactitud = cantReal − cantTeorica (solo en la vista de consulta, {@link consultarExactitud}).
 *  4. El ajuste se aplica SOLO como MOVIMIENTO de kardex (D3, motor común): JAMÁS se edita un saldo.
 *
 * Granularidad (decisión del lead F7-E5): el detalle está a la granularidad REAL del artículo de
 * kardex, INCLUYENDO `idOrden` (nullable; F6-E2 "PT por orden", ADR-0014). Así el teórico se congela
 * por artículo con `existenciaPtBloqueada(...,idOrden)` y el ajuste es un movimiento de kardex 1:1 por
 * artículo sobre esa MISMA llave — no hay que repartir el delta entre órdenes y la validación
 * no-negativo funciona por artículo (Gabriel/Daniel confirman esto en la verificación).
 *
 * Innegociables aplicados: A1 (dominio), A2 (transacción), A3/A7 (folio + bitácora), A4 (permiso por
 * operación), A9 (empresa activa), D3 (existencia = Σ movimientos; ajuste = movimiento, nunca edición).
 */
import {
  esquemaInventarioCiclicoCrear,
  esquemaInventarioCiclicoConteo,
  esquemaInventarioCiclicoCancelar,
  esquemaInventariosCiclicosQuery,
  type DatosInventarioCiclicoConteo,
  type DatosInventarioCiclicoCancelar,
  type InventarioCiclicoResumen,
  type InventariosCiclicosQuery,
  type InventariosCiclicosPagina,
  type ConteoSalida,
  type ExactitudSalida,
} from '../../contrato/index.js';
import { Prisma, type EstadoInventarioCiclico } from '../../datos/index.js';
import type { z } from 'zod';

import { registrarBitacora } from '../../comun/auditoria.js';
import {
  ErrorConflicto,
  ErrorNoEncontrado,
  ErrorPermiso,
  ErrorValidacion,
} from '../../comun/errores.js';
import {
  bloquearArticuloPt,
  existenciaPtBloqueada,
  registrarMovimientoPt as registrarMovimientoPtMotor,
  type LineaMovimientoPt,
} from '../../comun/kardex.js';
import { ORIGEN } from '../../comun/origenes.js';
import { siguienteFolio } from '../../comun/secuencias.js';
import { tienePermiso, verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import {
  clienteLectura,
  enTransaccion,
  type ContextoBd,
  type Tx,
} from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';

/** Clave de la secuencia de folios de los cíclicos (A3, por empresa). */
const CLAVE_SECUENCIA_CICLICO = 'inventario-ciclico';
/** Tipo de movimiento del ajuste con existencia FALTANTE (real > teórico → entra). */
const COD_AJUSTE_ENTRADA = 'ajuste-ciclico-entrada';
/** Tipo de movimiento del ajuste con existencia SOBRANTE (real < teórico → sale). */
const COD_AJUSTE_SALIDA = 'ajuste-ciclico-salida';

// ── Helpers de permiso/fecha ─────────────────────────────────────────────────────────────────────

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

/** Convierte un `YYYY-MM-DD` al `Date` UTC que Prisma guarda en `@db.Date`. */
function aDateColumna(valor: string): Date {
  return new Date(`${valor}T00:00:00.000Z`);
}

/** Fecha de HOY como `YYYY-MM-DD` (UTC). */
function hoyIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Resuelve un tipo de movimiento por su `codigo`, exigiéndolo activo. Lanza si no existe/inactivo. */
async function tipoPorCodigo(tx: Tx, codigo: string): Promise<{ id: number; nombre: string }> {
  const tipo = await tx.tipoMovimientoInventario.findUnique({
    where: { codigo },
    select: { id: true, nombre: true, activo: true },
  });
  if (tipo === null) {
    throw new ErrorValidacion(
      `Falta el tipo de movimiento "${codigo}" en el catálogo (re-sembrar con SEED_ON_START).`,
    );
  }
  if (!tipo.activo) {
    throw new ErrorValidacion(`El tipo de movimiento "${tipo.nombre}" está desactivado.`);
  }
  return { id: tipo.id, nombre: tipo.nombre };
}

// ── Un artículo enumerado (llave real del kardex) ────────────────────────────────────────────────

/** Un artículo de kardex a su granularidad real (…×orden). `idOrden` NULL = bucket "sin orden". */
interface Articulo {
  idModelo: number;
  idColor: number;
  idTalla: number;
  idOrden: number | null;
}

/** Orden DETERMINISTA para tomar los locks (evita deadlocks entre operaciones que compiten). */
function ordenarArticulos<T extends Articulo>(articulos: T[]): T[] {
  return [...articulos].sort(
    (a, b) =>
      a.idModelo - b.idModelo ||
      a.idColor - b.idColor ||
      a.idTalla - b.idTalla ||
      (a.idOrden ?? -1) - (b.idOrden ?? -1),
  );
}

// ── ALTA ─────────────────────────────────────────────────────────────────────────────────────────

/** Datos del alta de un cíclico (campos del esquema compartido). */
export type EntradaCrearCiclico = z.input<typeof esquemaInventarioCiclicoCrear>;

/**
 * Da de alta un inventario cíclico y CONGELA el teórico (D6). En UNA transacción (A2): enumera los
 * artículos con existencia ≠ 0 del almacén (todo el almacén o filtrado por `idsModelo`), congela
 * `cantTeorica` por artículo bajo lock (`bloquearArticuloPt` → `existenciaPtBloqueada`, incluye
 * `idOrden`) y siembra el detalle por LOTES (`createMany`). Folio atómico (A3) + bitácora (A7).
 * Permiso `indicadores.ciclicos-alta` (A4). Rechaza si el alcance no tiene nada que contar.
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
    // Verifica que el almacén exista (FK lo cubriría, pero da un mensaje claro).
    const almacen = await tx.almacen.findUnique({
      where: { id: datos.idAlmacen },
      select: { id: true },
    });
    if (almacen === null) {
      throw new ErrorNoEncontrado('Almacen', datos.idAlmacen);
    }

    // Candidatos: artículos con existencia ≠ 0 en el almacén, en el alcance de modelos (la vista
    // `existencia_pt` agrega por …×orden×almacén; aquí SÍ se usa la vista — es una CONSULTA para
    // enumerar; el valor congelado luego se re-lee DIRECTO bajo lock, ADR-0010 §3).
    const condiciones: Prisma.Sql[] = [
      Prisma.sql`e."id_empresa" = ${idEmpresa}`,
      Prisma.sql`e."id_almacen" = ${datos.idAlmacen}`,
      Prisma.sql`e."existencia" <> 0`,
    ];
    if (datos.idsModelo !== undefined && datos.idsModelo.length > 0) {
      condiciones.push(Prisma.sql`e."id_modelo" IN (${Prisma.join(datos.idsModelo)})`);
    }
    const candidatos = await tx.$queryRaw<
      { idModelo: number; idColor: number; idTalla: number; idOrden: number | null }[]
    >(Prisma.sql`
      SELECT e."id_modelo" AS "idModelo", e."id_color" AS "idColor", e."id_talla" AS "idTalla",
             e."id_orden" AS "idOrden"
      FROM "existencia_pt" e
      WHERE ${Prisma.join(condiciones, ' AND ')}
    `);
    if (candidatos.length === 0) {
      throw new ErrorConflicto(
        'No hay existencias que contar en el alcance elegido (ni un artículo con existencia ≠ 0).',
      );
    }

    const folio = await siguienteFolio(tx, idEmpresa, CLAVE_SECUENCIA_CICLICO);
    const inventario = await tx.inventarioCiclico.create({
      data: {
        folio,
        idEmpresa,
        idAlmacen: datos.idAlmacen,
        fecha: aDateColumna(hoyIso()),
        estado: 'abierto',
        ...(datos.observaciones === undefined ? {} : { observaciones: datos.observaciones }),
        creadoPorId: sesion.id,
        modificadoPorId: sesion.id,
      },
      select: { id: true },
    });

    // Congela el teórico por artículo, en orden determinista (locks sin deadlock). Si un artículo
    // corrió a 0 entre la lectura de la vista y el lock, se OMITE (no se cuenta lo que ya no existe).
    const renglones: Prisma.InventarioCiclicoDetCreateManyInput[] = [];
    for (const art of ordenarArticulos(candidatos)) {
      await bloquearArticuloPt(
        tx,
        idEmpresa,
        datos.idAlmacen,
        art.idModelo,
        art.idColor,
        art.idTalla,
        art.idOrden,
      );
      const cantTeorica = await existenciaPtBloqueada(
        tx,
        idEmpresa,
        datos.idAlmacen,
        art.idModelo,
        art.idColor,
        art.idTalla,
        art.idOrden,
      );
      if (cantTeorica === 0) continue;
      renglones.push({
        idInventarioCiclico: inventario.id,
        idModelo: art.idModelo,
        idColor: art.idColor,
        idTalla: art.idTalla,
        idOrden: art.idOrden,
        cantTeorica,
        creadoPorId: sesion.id,
        modificadoPorId: sesion.id,
      });
    }
    if (renglones.length === 0) {
      throw new ErrorConflicto(
        'No quedó ningún artículo con existencia al congelar el teórico (todo corrió a 0).',
      );
    }
    await tx.inventarioCiclicoDet.createMany({ data: renglones });

    await registrarBitacora(tx, sesion, {
      entidad: 'InventarioCiclico',
      idEntidad: inventario.id,
      accion: 'CREAR',
      datos: {
        folio: folio.toString(),
        idAlmacen: datos.idAlmacen,
        renglones: renglones.length,
      },
    });

    return inventario.id;
  }, bd);

  return obtenerResumen(sesion, idCreado, bd);
}

// ── Lecturas: RESUMEN / LISTADO ──────────────────────────────────────────────────────────────────

/** `include` mínimo para el encabezado (con nombre de almacén). */
const incluirEncabezado = {
  almacen: { select: { nombre: true } },
} satisfies Prisma.InventarioCiclicoInclude;
type EncabezadoConAlmacen = Prisma.InventarioCiclicoGetPayload<{
  include: typeof incluirEncabezado;
}>;

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
  const inv = await cliente.inventarioCiclico.findFirst({
    where: { id, idEmpresa: sesion.idEmpresaActiva },
    include: incluirEncabezado,
  });
  if (inv === null) {
    throw new ErrorNoEncontrado('InventarioCiclico', id);
  }
  const [totalRenglones, renglonesContados] = await Promise.all([
    cliente.inventarioCiclicoDet.count({ where: { idInventarioCiclico: id } }),
    cliente.inventarioCiclicoDet.count({
      where: { idInventarioCiclico: id, cantReal: { not: null } },
    }),
  ]);
  return aResumen(inv, totalRenglones, renglonesContados);
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
  const ids = filas.map((f) => f.id);
  const [totCounts, conCounts] = await Promise.all([
    cliente.inventarioCiclicoDet.groupBy({
      by: ['idInventarioCiclico'],
      where: { idInventarioCiclico: { in: ids } },
      _count: { _all: true },
    }),
    cliente.inventarioCiclicoDet.groupBy({
      by: ['idInventarioCiclico'],
      where: { idInventarioCiclico: { in: ids }, cantReal: { not: null } },
      _count: { _all: true },
    }),
  ]);
  const totMap = new Map(totCounts.map((c) => [c.idInventarioCiclico, c._count._all]));
  const conMap = new Map(conCounts.map((c) => [c.idInventarioCiclico, c._count._all]));

  return {
    datos: filas.map((f) => aResumen(f, totMap.get(f.id) ?? 0, conMap.get(f.id) ?? 0)),
    total,
    pagina: filtros.pagina,
    porPagina: filtros.porPagina,
    totalPaginas: Math.max(1, Math.ceil(total / filtros.porPagina)),
  };
}

// ── Lectura: CONTEO CIEGO (sin teórico) ──────────────────────────────────────────────────────────

/**
 * Lee la vista de CONTEO — CIEGA: encabezado + renglones SIN `cantTeorica` (no se selecciona siquiera,
 * defensa en profundidad). Interna: la usan {@link obtenerConteo} (permiso conteo) y la hoja PDF
 * (permiso alta/conteo). Empresa activa (A9). Ordena por modelo→color→talla para un recorrido natural.
 */
async function leerConteo(id: number, idEmpresa: number, bd?: ContextoBd): Promise<ConteoSalida> {
  const inv = await clienteLectura(bd).inventarioCiclico.findFirst({
    where: { id, idEmpresa },
    select: {
      id: true,
      folio: true,
      idAlmacen: true,
      fecha: true,
      estado: true,
      almacen: { select: { nombre: true } },
      detalles: {
        // SIN cantTeorica (conteo ciego).
        select: {
          id: true,
          idModelo: true,
          idColor: true,
          idTalla: true,
          idOrden: true,
          cantReal: true,
          modelo: { select: { codigo: true } },
          color: { select: { nombre: true } },
          talla: { select: { etiqueta: true, orden: true } },
          orden: { select: { folio: true } },
        },
        orderBy: [
          { modelo: { codigo: 'asc' } },
          { color: { nombre: 'asc' } },
          { talla: { orden: 'asc' } },
          { id: 'asc' },
        ],
      },
    },
  });
  if (inv === null) {
    throw new ErrorNoEncontrado('InventarioCiclico', id);
  }
  return {
    id: inv.id,
    folio: Number(inv.folio),
    idAlmacen: inv.idAlmacen,
    almacen: inv.almacen.nombre,
    fecha: inv.fecha.toISOString().slice(0, 10),
    estado: inv.estado,
    renglones: inv.detalles.map((d) => ({
      idDet: d.id,
      idModelo: d.idModelo,
      modelo: d.modelo.codigo,
      idColor: d.idColor,
      color: d.color.nombre,
      idTalla: d.idTalla,
      etiquetaTalla: d.talla.etiqueta,
      ordenTalla: d.talla.orden,
      idOrden: d.idOrden,
      folioOrden: d.orden === null ? null : Number(d.orden.folio),
      cantReal: d.cantReal,
      contado: d.cantReal !== null,
    })),
  };
}

/** Vista de CONTEO ciego de un cíclico. Permiso `indicadores.ciclicos-conteo` (A4). */
export async function obtenerConteo(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<ConteoSalida> {
  verificarPermiso(sesion, 'indicadores.ciclicos-conteo');
  return leerConteo(id, sesion.idEmpresaActiva, bd);
}

/** Vista de CONTEO ciego para la HOJA de conteo (PDF). Permiso alta O conteo. */
export async function leerConteoParaHoja(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<ConteoSalida> {
  exigirPermisoHoja(sesion);
  return leerConteo(id, sesion.idEmpresaActiva, bd);
}

// ── Escritura: CAPTURAR CONTEO ───────────────────────────────────────────────────────────────────

/**
 * Captura el conteo físico de uno o varios renglones (cantidad real, ciega). Guarda `cantReal` +
 * `contadoEn`/`contadoPorId`; recalcula el estado (todos contados → `contado`, si no → `abierto`).
 * Rechaza si el cíclico ya está `cerrado`/`cancelado`, si algún renglón no le pertenece o si se
 * repite un renglón en la captura. Permiso `indicadores.ciclicos-conteo` (A4). A2 en transacción.
 * NO devuelve el teórico (conteo ciego).
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
    const inv = await tx.inventarioCiclico.findFirst({
      where: { id, idEmpresa },
      select: { id: true, estado: true },
    });
    if (inv === null) {
      throw new ErrorNoEncontrado('InventarioCiclico', id);
    }
    if (inv.estado === 'cerrado' || inv.estado === 'cancelado') {
      throw new ErrorConflicto(
        `El inventario cíclico está ${inv.estado} y ya no admite captura de conteo.`,
      );
    }

    // Todos los renglones deben pertenecer a ESTE cíclico (A9 + no capturar sobre otro).
    const propios = await tx.inventarioCiclicoDet.count({
      where: { id: { in: ids }, idInventarioCiclico: inv.id },
    });
    if (propios !== ids.length) {
      throw new ErrorValidacion('Algún renglón no pertenece a este inventario cíclico.');
    }

    const ahora = new Date();
    for (const r of datos.renglones) {
      await tx.inventarioCiclicoDet.update({
        where: { id: r.idDet },
        data: {
          cantReal: r.cantReal,
          contadoEn: ahora,
          contadoPorId: sesion.id,
          modificadoPorId: sesion.id,
        },
      });
    }

    // Recalcula el estado: todos contados → `contado`; si falta alguno → `abierto`.
    const [total, contados] = await Promise.all([
      tx.inventarioCiclicoDet.count({ where: { idInventarioCiclico: inv.id } }),
      tx.inventarioCiclicoDet.count({
        where: { idInventarioCiclico: inv.id, cantReal: { not: null } },
      }),
    ]);
    const nuevoEstado: EstadoInventarioCiclico = contados >= total ? 'contado' : 'abierto';
    if (nuevoEstado !== inv.estado) {
      await tx.inventarioCiclico.update({
        where: { id: inv.id },
        data: { estado: nuevoEstado, modificadoPorId: sesion.id },
      });
    }

    await registrarBitacora(tx, sesion, {
      entidad: 'InventarioCiclico',
      idEntidad: inv.id,
      accion: 'OTRO',
      datos: { conteo: datos.renglones.length, contados, total },
    });
  }, bd);

  return leerConteo(id, idEmpresa, bd);
}

// ── Lectura: EXACTITUD (teórico vs real) ─────────────────────────────────────────────────────────

/**
 * Vista de EXACTITUD de un cíclico: por renglón `cantTeorica`/`cantReal`/`exactitud` (= real−teórico)
 * + su ajuste (si ya se generó) + totales. Permiso `indicadores.ciclicos-consulta` (A4). A9.
 */
export async function consultarExactitud(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<ExactitudSalida> {
  verificarPermiso(sesion, 'indicadores.ciclicos-consulta');
  const inv = await clienteLectura(bd).inventarioCiclico.findFirst({
    where: { id, idEmpresa: sesion.idEmpresaActiva },
    include: {
      almacen: { select: { nombre: true } },
      detalles: {
        include: {
          modelo: { select: { codigo: true } },
          color: { select: { nombre: true } },
          talla: { select: { etiqueta: true, orden: true } },
          orden: { select: { folio: true } },
          movimientoAjuste: { select: { folio: true } },
        },
        orderBy: [
          { modelo: { codigo: 'asc' } },
          { color: { nombre: 'asc' } },
          { talla: { orden: 'asc' } },
          { id: 'asc' },
        ],
      },
    },
  });
  if (inv === null) {
    throw new ErrorNoEncontrado('InventarioCiclico', id);
  }

  let contados = 0;
  let exactos = 0;
  let diferencias = 0;
  let teorico = 0;
  let real = 0;
  const renglones = inv.detalles.map((d) => {
    teorico += d.cantTeorica;
    const exactitud = d.cantReal === null ? null : d.cantReal - d.cantTeorica;
    if (d.cantReal !== null) {
      contados += 1;
      real += d.cantReal;
      if (exactitud === 0) exactos += 1;
      else diferencias += 1;
    }
    return {
      idDet: d.id,
      idModelo: d.idModelo,
      modelo: d.modelo.codigo,
      idColor: d.idColor,
      color: d.color.nombre,
      idTalla: d.idTalla,
      etiquetaTalla: d.talla.etiqueta,
      ordenTalla: d.talla.orden,
      idOrden: d.idOrden,
      folioOrden: d.orden === null ? null : Number(d.orden.folio),
      cantTeorica: d.cantTeorica,
      cantReal: d.cantReal,
      exactitud,
      idMovimientoAjuste: d.idMovimientoAjuste,
      folioMovimientoAjuste: d.movimientoAjuste === null ? null : Number(d.movimientoAjuste.folio),
    };
  });

  return {
    id: inv.id,
    folio: Number(inv.folio),
    idEmpresa: inv.idEmpresa,
    idAlmacen: inv.idAlmacen,
    almacen: inv.almacen.nombre,
    fecha: inv.fecha.toISOString().slice(0, 10),
    estado: inv.estado,
    observaciones: inv.observaciones,
    canceladoEn: inv.canceladoEn === null ? null : inv.canceladoEn.toISOString(),
    motivoCancelacion: inv.motivoCancelacion,
    renglones,
    totales: { total: renglones.length, contados, exactos, diferencias, teorico, real },
  };
}

// ── Escritura: GENERAR AJUSTE ────────────────────────────────────────────────────────────────────

/**
 * Genera el AJUSTE del cíclico (D3): por cada renglón contado con exactitud ≠ 0 aplica el delta como
 * MOVIMIENTO de kardex — entrada (`ajuste-ciclico-entrada`) si real > teórico, salida
 * (`ajuste-ciclico-salida`) si real < teórico —, JAMÁS editando un saldo. Agrupa los deltas del mismo
 * signo en UN solo movimiento por almacén (entradas juntas / salidas juntas) para no explotar el
 * folio; cada renglón queda enlazado a su movimiento por `idMovimientoAjuste`. Las SALIDAS validan
 * no-negativo bajo lock por artículo (suma directa, NUNCA la vista — D3). Exige estado `contado`
 * (todo el conteo terminado) y RECHAZA re-generar (`cerrado`/`cancelado`). Permiso
 * `indicadores.ciclicos-consulta` (A4). Todo en UNA transacción (A2/A3/A7).
 */
export async function generarAjusteCiclico(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<ExactitudSalida> {
  verificarPermiso(sesion, 'indicadores.ciclicos-consulta');
  const idEmpresa = sesion.idEmpresaActiva;

  await enTransaccion(async (tx) => {
    // B1 — SERIALIZA la generación del ajuste (anti doble-ajuste concurrente, D3): bloquea la FILA del
    // encabezado con `FOR UPDATE` ANTES de decidir por el estado. Dos POST `/ajuste` casi simultáneos
    // del MISMO cíclico ya no pueden leer ambos `contado` y aplicar el delta 2×: el 2º espera al commit
    // del 1º y, al re-leer BAJO el lock, ve `cerrado` y aborta. El delta se precalcula sobre la teórica
    // CONGELADA (no es idempotente) y el ajuste de solo-entrada no toma lock por-artículo, así que este
    // lock del encabezado —no los advisory por-artículo— es la garantía de "se ajusta una sola vez".
    // A9 por empresa activa.
    const bloqueadas = await tx.$queryRaw<
      { folio: bigint; idAlmacen: number; estado: EstadoInventarioCiclico }[]
    >`
      SELECT "folio", "id_almacen" AS "idAlmacen", "estado"
      FROM "inventarios_ciclicos"
      WHERE "id" = ${id} AND "id_empresa" = ${idEmpresa}
      FOR UPDATE
    `;
    const inv = bloqueadas[0];
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
    if (inv.estado !== 'contado') {
      throw new ErrorConflicto(
        'Faltan renglones por contar: termina el conteo antes de generar el ajuste.',
      );
    }

    // Detalle contado (ya bajo el lock del encabezado).
    const detalles = await tx.inventarioCiclicoDet.findMany({
      where: { idInventarioCiclico: id, cantReal: { not: null } },
      select: {
        id: true,
        idModelo: true,
        idColor: true,
        idTalla: true,
        idOrden: true,
        cantTeorica: true,
        cantReal: true,
      },
    });

    // Deltas por artículo: entrada (real>teórico) / salida (real<teórico). cantReal no es null (filtro).
    interface Delta extends Articulo {
      idDet: number;
      cantidad: number;
    }
    const entradas: Delta[] = [];
    const salidas: Delta[] = [];
    for (const d of detalles) {
      const delta = (d.cantReal ?? 0) - d.cantTeorica;
      if (delta === 0) continue;
      const base = {
        idDet: d.id,
        idModelo: d.idModelo,
        idColor: d.idColor,
        idTalla: d.idTalla,
        idOrden: d.idOrden,
      };
      if (delta > 0) entradas.push({ ...base, cantidad: delta });
      else salidas.push({ ...base, cantidad: -delta });
    }

    const observaciones = `Ajuste por inventario cíclico #${inv.folio.toString()}`;
    const aLineas = (ds: Delta[]): LineaMovimientoPt[] =>
      ds.map((d) => ({
        idModelo: d.idModelo,
        idColor: d.idColor,
        idTalla: d.idTalla,
        idOrden: d.idOrden,
        cantidad: d.cantidad,
      }));

    let idMovSalida: number | null = null;
    if (salidas.length > 0) {
      const tipoSalida = await tipoPorCodigo(tx, COD_AJUSTE_SALIDA);
      // Valida no-negativo bajo lock por artículo (los locks se mantienen hasta el commit → la
      // escritura de la salida no se cuela con otra operación del mismo artículo).
      for (const s of ordenarArticulos(salidas)) {
        await bloquearArticuloPt(
          tx,
          idEmpresa,
          inv.idAlmacen,
          s.idModelo,
          s.idColor,
          s.idTalla,
          s.idOrden,
        );
        const existencia = await existenciaPtBloqueada(
          tx,
          idEmpresa,
          inv.idAlmacen,
          s.idModelo,
          s.idColor,
          s.idTalla,
          s.idOrden,
        );
        if (existencia - s.cantidad < 0) {
          throw new ErrorConflicto(
            `El ajuste de salida dejaría el inventario en negativo: se intenta bajar ${s.cantidad} ` +
              `pza(s) de un artículo con ${existencia} en existencia.`,
          );
        }
      }
      const mov = await registrarMovimientoPtMotor(
        sesion,
        {
          idEmpresa,
          idTipoMov: tipoSalida.id,
          idAlmacen: inv.idAlmacen,
          fecha: aDateColumna(hoyIso()),
          origenTipo: ORIGEN.ajusteCiclico,
          origenId: String(id),
          lineas: aLineas(salidas),
          observaciones,
        },
        { tx },
      );
      idMovSalida = mov.id;
    }

    let idMovEntrada: number | null = null;
    if (entradas.length > 0) {
      const tipoEntrada = await tipoPorCodigo(tx, COD_AJUSTE_ENTRADA);
      const mov = await registrarMovimientoPtMotor(
        sesion,
        {
          idEmpresa,
          idTipoMov: tipoEntrada.id,
          idAlmacen: inv.idAlmacen,
          fecha: aDateColumna(hoyIso()),
          origenTipo: ORIGEN.ajusteCiclico,
          origenId: String(id),
          lineas: aLineas(entradas),
          observaciones,
        },
        { tx },
      );
      idMovEntrada = mov.id;
    }

    // Enlaza cada renglón con su movimiento de ajuste (traza; por lotes con updateMany).
    if (idMovEntrada !== null) {
      await tx.inventarioCiclicoDet.updateMany({
        where: { id: { in: entradas.map((e) => e.idDet) } },
        data: { idMovimientoAjuste: idMovEntrada, modificadoPorId: sesion.id },
      });
    }
    if (idMovSalida !== null) {
      await tx.inventarioCiclicoDet.updateMany({
        where: { id: { in: salidas.map((s) => s.idDet) } },
        data: { idMovimientoAjuste: idMovSalida, modificadoPorId: sesion.id },
      });
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
        entradas: entradas.length,
        salidas: salidas.length,
        idMovEntrada,
        idMovSalida,
      },
    });
  }, bd);

  return consultarExactitud(sesion, id, bd);
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
      throw new ErrorConflicto(
        'El inventario cíclico ya está cerrado (con ajuste): no se cancela.',
      );
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
