/**
 * BOM del modelo (F1-E4) — la RECETA: telas, avíos y bordados de un `Modelo` (doc
 * `Documentacion_MJD/01-Modelos.md` §2, `ModelosTela`/`ModelosHab`/`ModelosBor`).
 *
 * Cada sección se gestiona con un endpoint "set-completo" (como el grid de colores de la tela
 * o los proveedores del avío en E3): se manda el conjunto deseado y el dominio sincroniza
 * (agrega/quita/actualiza) en UNA transacción A2, conservando la auditoría de los renglones
 * que no cambian (diff mínimo). Sin duplicados por componente (lo valida el esquema y lo
 * re-valida el dominio; lo respalda la PK compuesta).
 *
 * 🔑 Regla de negocio (A1 — doc 01-Modelos §2): las TRES banderas
 * `paraPreCosto`/`paraProduccion`/`paraCosto` de cada tela/avío se CONSERVAN: un componente
 * puede costear sin listarse en producción y viceversa. Los bordados NO llevan banderas ni
 * cantidad, solo `precio` por renglón.
 *
 * `precio` del bordado: el contrato lo deja OPCIONAL (nullable en BD para el ETL E7, ADR-0009);
 * la UI lo exige y lo pre-llena con `Bordado.precio`. Aquí se conserva tal cual venga.
 *
 * Además, `copiarBom` clona la receta de OTRO modelo en UNA transacción (todo o nada): útil
 * para dar de alta variantes a partir de un modelo base. onDelete del BOM hacia los catálogos
 * es Restrict (una tela/avío/bordado usado por un modelo no se borra físico); hacia el modelo
 * es Cascade (permite reescribir el set en la tx).
 */
import type {
  esquemaModeloAvioEntrada,
  esquemaModeloBordadoEntrada,
  esquemaModeloTelaEntrada,
} from '../../contrato/esquemas/modelo.js';
import {
  esquemaModeloAvios,
  esquemaModeloBordados,
  esquemaModeloCopiarBomCuerpo,
  esquemaModeloTelas,
} from '../../contrato/esquemas/modelo.js';
import type { Prisma } from '../../datos/index.js';
import type { z } from 'zod';

import { datosModificacion, registrarBitacora } from '../../comun/auditoria.js';
import { ErrorNoEncontrado, ErrorValidacion } from '../../comun/errores.js';
import { verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import {
  clienteLectura,
  enTransaccion,
  type ContextoBd,
  type Tx,
} from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';

import { exigirModelo, incluirRelacionesModelo, type ModeloConRelaciones } from './modelos.js';

// ── Tipos de entrada (lo que recibe el dominio ANTES de validar: defaults opcionales) ──
// El dominio re-valida con `validarEntrada` (mismo patrón que `EntradaCrear*`): por eso los
// puntos de entrada aceptan `z.input` (banderas opcionales) y, ya validados, las funciones
// internas trabajan con `z.output` (banderas resueltas).

/** Renglón de tela del BOM tal como LLEGA (banderas opcionales; el dominio aplica defaults). */
export type EntradaTelaBom = z.input<typeof esquemaModeloTelaEntrada>;
/** Renglón de avío del BOM tal como llega. */
export type EntradaAvioBom = z.input<typeof esquemaModeloAvioEntrada>;
/** Renglón de bordado del BOM tal como llega (precio opcional). */
export type EntradaBordadoBom = z.input<typeof esquemaModeloBordadoEntrada>;
/** Cuerpo de copiar BOM tal como llega (`reemplazar` opcional, default true). */
export type EntradaCopiarBom = z.input<typeof esquemaModeloCopiarBomCuerpo>;

/** Renglón de tela del BOM ya validado (banderas y consumo resueltos). */
type TelaBomValidada = z.output<typeof esquemaModeloTelaEntrada>;
/** Renglón de avío del BOM ya validado. */
type AvioBomValidado = z.output<typeof esquemaModeloAvioEntrada>;
/** Renglón de bordado del BOM ya validado. */
type BordadoBomValidado = z.output<typeof esquemaModeloBordadoEntrada>;

// ── Salida de cada sección del BOM (renglones con nombre embebido para la UI) ──

/** Renglón de tela del BOM tal como sale al cliente. */
export type ModeloTelaDetalle = {
  idTela: number;
  nombre: string;
  consumoPorPrenda: number;
  paraPreCosto: boolean;
  paraProduccion: boolean;
  paraCosto: boolean;
};

/** Renglón de avío del BOM tal como sale al cliente. */
export type ModeloAvioDetalle = {
  idAvio: number;
  clave: string;
  descripcion: string;
  consumoPorPrenda: number;
  paraPreCosto: boolean;
  paraProduccion: boolean;
  paraCosto: boolean;
};

/** Renglón de bordado del BOM tal como sale al cliente. */
export type ModeloBordadoDetalle = {
  idBordado: number;
  nombre: string;
  tipo: 'BORDADO' | 'ESTAMPADO';
  precio: number | null;
};

/** BOM completo de un modelo (las tres secciones), para embeber en la ficha. */
export interface BomModelo {
  telas: ModeloTelaDetalle[];
  avios: ModeloAvioDetalle[];
  bordados: ModeloBordadoDetalle[];
}

// ── Lecturas de cada sección (ordenadas por nombre del componente) ────────────

/** Lee las telas del BOM de un modelo (con el nombre de la tela, ordenadas por nombre). */
export async function leerTelasBom(tx: Tx, idModelo: number): Promise<ModeloTelaDetalle[]> {
  const filas = await tx.modeloTela.findMany({
    where: { idModelo },
    select: {
      idTela: true,
      consumoPorPrenda: true,
      paraPreCosto: true,
      paraProduccion: true,
      paraCosto: true,
      tela: { select: { nombre: true } },
    },
    orderBy: { tela: { nombre: 'asc' } },
  });
  return filas.map((f) => ({
    idTela: f.idTela,
    nombre: f.tela.nombre,
    consumoPorPrenda: f.consumoPorPrenda.toNumber(),
    paraPreCosto: f.paraPreCosto,
    paraProduccion: f.paraProduccion,
    paraCosto: f.paraCosto,
  }));
}

/** Lee los avíos del BOM de un modelo (con clave/descripción, ordenados por clave). */
export async function leerAviosBom(tx: Tx, idModelo: number): Promise<ModeloAvioDetalle[]> {
  const filas = await tx.modeloAvio.findMany({
    where: { idModelo },
    select: {
      idAvio: true,
      consumoPorPrenda: true,
      paraPreCosto: true,
      paraProduccion: true,
      paraCosto: true,
      avio: { select: { clave: true, descripcion: true } },
    },
    orderBy: { avio: { clave: 'asc' } },
  });
  return filas.map((f) => ({
    idAvio: f.idAvio,
    clave: f.avio.clave,
    descripcion: f.avio.descripcion,
    consumoPorPrenda: f.consumoPorPrenda.toNumber(),
    paraPreCosto: f.paraPreCosto,
    paraProduccion: f.paraProduccion,
    paraCosto: f.paraCosto,
  }));
}

/** Lee los bordados del BOM de un modelo (con nombre/tipo, ordenados por nombre). */
export async function leerBordadosBom(tx: Tx, idModelo: number): Promise<ModeloBordadoDetalle[]> {
  const filas = await tx.modeloBordado.findMany({
    where: { idModelo },
    select: {
      idBordado: true,
      precio: true,
      bordado: { select: { nombre: true, tipo: true } },
    },
    orderBy: { bordado: { nombre: 'asc' } },
  });
  return filas.map((f) => ({
    idBordado: f.idBordado,
    nombre: f.bordado.nombre,
    tipo: f.bordado.tipo,
    precio: f.precio === null ? null : f.precio.toNumber(),
  }));
}

/** Lee el BOM completo (las tres secciones) de un modelo. Reusado por la ficha. */
export async function leerBom(tx: Tx, idModelo: number): Promise<BomModelo> {
  const [telas, avios, bordados] = await Promise.all([
    leerTelasBom(tx, idModelo),
    leerAviosBom(tx, idModelo),
    leerBordadosBom(tx, idModelo),
  ]);
  return { telas, avios, bordados };
}

/** Modelo con sus relaciones + el BOM completo embebido (forma de la FICHA). */
export type ModeloFicha = ModeloConRelaciones & BomModelo;

/**
 * Obtiene la FICHA de un modelo: datos generales + relaciones + conteo de fotos + el BOM
 * completo (telas/avíos/bordados). Requiere `modelos.ver`. Lanza `ErrorNoEncontrado` si no
 * existe. (Lectura compuesta: el modelo y su BOM en una sola respuesta — `GET /api/modelos/:id`.)
 */
export async function obtenerFichaModelo(
  sesion: SesionUsuario,
  idModelo: number,
  bd?: ContextoBd,
): Promise<ModeloFicha> {
  verificarPermiso(sesion, 'modelos.ver');
  const cliente = clienteLectura(bd);
  const modelo = await cliente.modelo.findUnique({
    where: { id: idModelo },
    include: incluirRelacionesModelo,
  });
  if (modelo === null) {
    throw new ErrorNoEncontrado('Modelo', idModelo);
  }
  const bom = await leerBom(cliente, idModelo);
  return { ...modelo, ...bom };
}

// ── Validación de componentes (existen y están activos) ────────────────────────

/** Valida que todas las telas existan y estén ACTIVAS (no se mete una tela desactivada al BOM). */
async function exigirTelasValidas(tx: Tx, ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  const telas = await tx.tela.findMany({
    where: { id: { in: ids } },
    select: { id: true, nombre: true, activo: true },
  });
  if (telas.length !== ids.length) {
    throw new ErrorValidacion('Una o más telas seleccionadas no existen.');
  }
  const inactiva = telas.find((t) => !t.activo);
  if (inactiva !== undefined) {
    throw new ErrorValidacion(
      `La tela "${inactiva.nombre}" está desactivada y no se puede agregar al modelo.`,
    );
  }
}

/** Valida que todos los avíos existan y estén ACTIVOS. */
async function exigirAviosValidos(tx: Tx, ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  const avios = await tx.avio.findMany({
    where: { id: { in: ids } },
    select: { id: true, clave: true, activo: true },
  });
  if (avios.length !== ids.length) {
    throw new ErrorValidacion('Uno o más avíos seleccionados no existen.');
  }
  const inactivo = avios.find((a) => !a.activo);
  if (inactivo !== undefined) {
    throw new ErrorValidacion(
      `El avío "${inactivo.clave}" está desactivado y no se puede agregar al modelo.`,
    );
  }
}

/** Valida que todos los bordados existan y estén ACTIVOS. */
async function exigirBordadosValidos(tx: Tx, ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  const bordados = await tx.bordado.findMany({
    where: { id: { in: ids } },
    select: { id: true, nombre: true, activo: true },
  });
  if (bordados.length !== ids.length) {
    throw new ErrorValidacion('Uno o más bordados seleccionados no existen.');
  }
  const inactivo = bordados.find((b) => !b.activo);
  if (inactivo !== undefined) {
    throw new ErrorValidacion(
      `El bordado "${inactivo.nombre}" está desactivado y no se puede agregar al modelo.`,
    );
  }
}

/** ¿Cambió alguna bandera o el consumo de un renglón de tela/avío? */
function cambiaRenglonComponente(
  actual: {
    consumoPorPrenda: Prisma.Decimal;
    paraPreCosto: boolean;
    paraProduccion: boolean;
    paraCosto: boolean;
  },
  deseado: {
    consumoPorPrenda: number;
    paraPreCosto: boolean;
    paraProduccion: boolean;
    paraCosto: boolean;
  },
): boolean {
  return (
    actual.consumoPorPrenda.toNumber() !== deseado.consumoPorPrenda ||
    actual.paraPreCosto !== deseado.paraPreCosto ||
    actual.paraProduccion !== deseado.paraProduccion ||
    actual.paraCosto !== deseado.paraCosto
  );
}

// ── Sincronización (set-completo) de cada sección, dentro de una transacción ──

/** Reemplaza el set de TELAS del BOM (diff agrega/quita/actualiza). Devuelve true si hubo cambio. */
async function sincronizarTelas(
  tx: Tx,
  sesion: SesionUsuario,
  idModelo: number,
  deseados: TelaBomValidada[],
): Promise<boolean> {
  await exigirTelasValidas(
    tx,
    deseados.map((d) => d.idTela),
  );

  const actuales = await tx.modeloTela.findMany({ where: { idModelo } });
  const actualPorId = new Map(actuales.map((f) => [f.idTela, f]));
  const deseadoPorId = new Map(deseados.map((d) => [d.idTela, d]));

  const aQuitar = [...actualPorId.keys()].filter((id) => !deseadoPorId.has(id));
  const aAgregar = deseados.filter((d) => !actualPorId.has(d.idTela));
  const aActualizar = deseados.filter((d) => {
    const actual = actualPorId.get(d.idTela);
    return actual !== undefined && cambiaRenglonComponente(actual, d);
  });

  if (aQuitar.length === 0 && aAgregar.length === 0 && aActualizar.length === 0) {
    return false;
  }

  if (aQuitar.length > 0) {
    await tx.modeloTela.deleteMany({ where: { idModelo, idTela: { in: aQuitar } } });
  }
  if (aAgregar.length > 0) {
    await tx.modeloTela.createMany({
      data: aAgregar.map((d) => ({
        idModelo,
        idTela: d.idTela,
        consumoPorPrenda: d.consumoPorPrenda,
        paraPreCosto: d.paraPreCosto,
        paraProduccion: d.paraProduccion,
        paraCosto: d.paraCosto,
        creadoPorId: sesion.id,
        modificadoPorId: sesion.id,
      })),
    });
  }
  for (const d of aActualizar) {
    await tx.modeloTela.update({
      where: { idModelo_idTela: { idModelo, idTela: d.idTela } },
      data: {
        consumoPorPrenda: d.consumoPorPrenda,
        paraPreCosto: d.paraPreCosto,
        paraProduccion: d.paraProduccion,
        paraCosto: d.paraCosto,
        ...datosModificacion(sesion),
      },
    });
  }
  return true;
}

/** Reemplaza el set de AVÍOS del BOM (diff). Devuelve true si hubo cambio. */
async function sincronizarAvios(
  tx: Tx,
  sesion: SesionUsuario,
  idModelo: number,
  deseados: AvioBomValidado[],
): Promise<boolean> {
  await exigirAviosValidos(
    tx,
    deseados.map((d) => d.idAvio),
  );

  const actuales = await tx.modeloAvio.findMany({ where: { idModelo } });
  const actualPorId = new Map(actuales.map((f) => [f.idAvio, f]));
  const deseadoPorId = new Map(deseados.map((d) => [d.idAvio, d]));

  const aQuitar = [...actualPorId.keys()].filter((id) => !deseadoPorId.has(id));
  const aAgregar = deseados.filter((d) => !actualPorId.has(d.idAvio));
  const aActualizar = deseados.filter((d) => {
    const actual = actualPorId.get(d.idAvio);
    return actual !== undefined && cambiaRenglonComponente(actual, d);
  });

  if (aQuitar.length === 0 && aAgregar.length === 0 && aActualizar.length === 0) {
    return false;
  }

  if (aQuitar.length > 0) {
    await tx.modeloAvio.deleteMany({ where: { idModelo, idAvio: { in: aQuitar } } });
  }
  if (aAgregar.length > 0) {
    await tx.modeloAvio.createMany({
      data: aAgregar.map((d) => ({
        idModelo,
        idAvio: d.idAvio,
        consumoPorPrenda: d.consumoPorPrenda,
        paraPreCosto: d.paraPreCosto,
        paraProduccion: d.paraProduccion,
        paraCosto: d.paraCosto,
        creadoPorId: sesion.id,
        modificadoPorId: sesion.id,
      })),
    });
  }
  for (const d of aActualizar) {
    await tx.modeloAvio.update({
      where: { idModelo_idAvio: { idModelo, idAvio: d.idAvio } },
      data: {
        consumoPorPrenda: d.consumoPorPrenda,
        paraPreCosto: d.paraPreCosto,
        paraProduccion: d.paraProduccion,
        paraCosto: d.paraCosto,
        ...datosModificacion(sesion),
      },
    });
  }
  return true;
}

/** ¿Cambió el precio de un renglón de bordado? Compara por valor numérico (Decimal | null). */
function cambiaPrecioBordado(actual: Prisma.Decimal | null, deseado: number | undefined): boolean {
  const anterior = actual === null ? null : actual.toNumber();
  const propuesto = deseado ?? null;
  return anterior !== propuesto;
}

/** Reemplaza el set de BORDADOS del BOM (diff; sin banderas, solo precio). Devuelve true si hubo cambio. */
async function sincronizarBordados(
  tx: Tx,
  sesion: SesionUsuario,
  idModelo: number,
  deseados: BordadoBomValidado[],
): Promise<boolean> {
  await exigirBordadosValidos(
    tx,
    deseados.map((d) => d.idBordado),
  );

  const actuales = await tx.modeloBordado.findMany({ where: { idModelo } });
  const actualPorId = new Map(actuales.map((f) => [f.idBordado, f]));
  const deseadoPorId = new Map(deseados.map((d) => [d.idBordado, d]));

  const aQuitar = [...actualPorId.keys()].filter((id) => !deseadoPorId.has(id));
  const aAgregar = deseados.filter((d) => !actualPorId.has(d.idBordado));
  const aActualizar = deseados.filter((d) => {
    const actual = actualPorId.get(d.idBordado);
    return actual !== undefined && cambiaPrecioBordado(actual.precio, d.precio);
  });

  if (aQuitar.length === 0 && aAgregar.length === 0 && aActualizar.length === 0) {
    return false;
  }

  if (aQuitar.length > 0) {
    await tx.modeloBordado.deleteMany({ where: { idModelo, idBordado: { in: aQuitar } } });
  }
  if (aAgregar.length > 0) {
    await tx.modeloBordado.createMany({
      data: aAgregar.map((d) => ({
        idModelo,
        idBordado: d.idBordado,
        ...(d.precio === undefined ? {} : { precio: d.precio }),
        creadoPorId: sesion.id,
        modificadoPorId: sesion.id,
      })),
    });
  }
  for (const d of aActualizar) {
    await tx.modeloBordado.update({
      where: { idModelo_idBordado: { idModelo, idBordado: d.idBordado } },
      data: { precio: d.precio ?? null, ...datosModificacion(sesion) },
    });
  }
  return true;
}

/** Marca la auditoría del modelo (modificadoPorId/En) cuando cambia su BOM. */
async function tocarModelo(tx: Tx, sesion: SesionUsuario, idModelo: number): Promise<void> {
  await tx.modelo.update({ where: { id: idModelo }, data: { ...datosModificacion(sesion) } });
}

// ── Endpoints set-completo (uno por sección) ──────────────────────────────────

/**
 * Reemplaza el set COMPLETO de TELAS del BOM de un modelo en UNA transacción (A2). Reglas:
 * permiso `modelos.administrar`; modelo existente; telas existentes/activas, sin repetir (puede
 * ir vacío). Conserva la auditoría de los renglones sin cambios (diff). Bitácora si hubo cambio.
 * Devuelve el set resultante.
 */
export async function reemplazarTelasBom(
  sesion: SesionUsuario,
  idModelo: number,
  telas: EntradaTelaBom[],
  bd?: ContextoBd,
): Promise<ModeloTelaDetalle[]> {
  verificarPermiso(sesion, 'modelos.administrar');
  const deseados = validarEntrada(esquemaModeloTelas, telas);
  return enTransaccion(async (tx) => {
    await exigirModelo(tx, idModelo);
    const cambio = await sincronizarTelas(tx, sesion, idModelo, deseados);
    if (cambio) {
      await tocarModelo(tx, sesion, idModelo);
      await registrarBitacora(tx, sesion, {
        entidad: 'Modelo',
        idEntidad: idModelo,
        accion: 'MODIFICAR',
        datos: { bom: 'telas', telas: deseados.map((d) => d.idTela) },
      });
    }
    return leerTelasBom(tx, idModelo);
  }, bd);
}

/** Reemplaza el set COMPLETO de AVÍOS del BOM (igual que telas). */
export async function reemplazarAviosBom(
  sesion: SesionUsuario,
  idModelo: number,
  avios: EntradaAvioBom[],
  bd?: ContextoBd,
): Promise<ModeloAvioDetalle[]> {
  verificarPermiso(sesion, 'modelos.administrar');
  const deseados = validarEntrada(esquemaModeloAvios, avios);
  return enTransaccion(async (tx) => {
    await exigirModelo(tx, idModelo);
    const cambio = await sincronizarAvios(tx, sesion, idModelo, deseados);
    if (cambio) {
      await tocarModelo(tx, sesion, idModelo);
      await registrarBitacora(tx, sesion, {
        entidad: 'Modelo',
        idEntidad: idModelo,
        accion: 'MODIFICAR',
        datos: { bom: 'avios', avios: deseados.map((d) => d.idAvio) },
      });
    }
    return leerAviosBom(tx, idModelo);
  }, bd);
}

/**
 * Reemplaza el set COMPLETO de BORDADOS del BOM (sin banderas, solo precio por renglón). El
 * `precio` es opcional en el contrato (relajado para el ETL E7); la UI lo exige y lo pre-llena.
 */
export async function reemplazarBordadosBom(
  sesion: SesionUsuario,
  idModelo: number,
  bordados: EntradaBordadoBom[],
  bd?: ContextoBd,
): Promise<ModeloBordadoDetalle[]> {
  verificarPermiso(sesion, 'modelos.administrar');
  const deseados = validarEntrada(esquemaModeloBordados, bordados);
  return enTransaccion(async (tx) => {
    await exigirModelo(tx, idModelo);
    const cambio = await sincronizarBordados(tx, sesion, idModelo, deseados);
    if (cambio) {
      await tocarModelo(tx, sesion, idModelo);
      await registrarBitacora(tx, sesion, {
        entidad: 'Modelo',
        idEntidad: idModelo,
        accion: 'MODIFICAR',
        datos: { bom: 'bordados', bordados: deseados.map((d) => d.idBordado) },
      });
    }
    return leerBordadosBom(tx, idModelo);
  }, bd);
}

// ── Lecturas sueltas de cada sección (para los GET) ───────────────────────────

/** Lista las telas del BOM de un modelo. Requiere `modelos.ver`. Exige que el modelo exista. */
export async function listarTelasBom(
  sesion: SesionUsuario,
  idModelo: number,
  bd?: ContextoBd,
): Promise<ModeloTelaDetalle[]> {
  verificarPermiso(sesion, 'modelos.ver');
  const cliente = clienteLectura(bd);
  const existe = await cliente.modelo.findUnique({ where: { id: idModelo }, select: { id: true } });
  if (existe === null) {
    throw new ErrorNoEncontrado('Modelo', idModelo);
  }
  return leerTelasBom(cliente, idModelo);
}

/** Lista los avíos del BOM de un modelo. */
export async function listarAviosBom(
  sesion: SesionUsuario,
  idModelo: number,
  bd?: ContextoBd,
): Promise<ModeloAvioDetalle[]> {
  verificarPermiso(sesion, 'modelos.ver');
  const cliente = clienteLectura(bd);
  const existe = await cliente.modelo.findUnique({ where: { id: idModelo }, select: { id: true } });
  if (existe === null) {
    throw new ErrorNoEncontrado('Modelo', idModelo);
  }
  return leerAviosBom(cliente, idModelo);
}

/** Lista los bordados del BOM de un modelo. */
export async function listarBordadosBom(
  sesion: SesionUsuario,
  idModelo: number,
  bd?: ContextoBd,
): Promise<ModeloBordadoDetalle[]> {
  verificarPermiso(sesion, 'modelos.ver');
  const cliente = clienteLectura(bd);
  const existe = await cliente.modelo.findUnique({ where: { id: idModelo }, select: { id: true } });
  if (existe === null) {
    throw new ErrorNoEncontrado('Modelo', idModelo);
  }
  return leerBordadosBom(cliente, idModelo);
}

// ── Copiar BOM de otro modelo (atómico) ───────────────────────────────────────

/**
 * Copia la receta (BOM) de OTRO modelo (`idOrigen`) al modelo `idDestino` en UNA transacción
 * (todo o nada, A2). Reglas: permiso `modelos.administrar`; ambos modelos existen; origen ≠
 * destino. Con `reemplazar=true` (por defecto) se reemplaza el BOM actual del destino con el
 * del origen; con `false` se FUSIONA conservando lo que el destino ya tiene (los componentes
 * del origen que el destino ya tenga NO se pisan). El BOM del origen pudo capturar componentes
 * desactivados desde entonces: se copian igual (es una copia interna, no una alta nueva).
 * Bitácora con el resumen. Devuelve el BOM resultante del destino.
 *
 * @example
 * await copiarBom(sesion, idDestino, { idOrigen: idBase, reemplazar: true });
 */
export async function copiarBom(
  sesion: SesionUsuario,
  idDestino: number,
  entrada: EntradaCopiarBom,
  bd?: ContextoBd,
): Promise<BomModelo> {
  verificarPermiso(sesion, 'modelos.administrar');
  const datos = validarEntrada(esquemaModeloCopiarBomCuerpo, entrada);

  if (datos.idOrigen === idDestino) {
    throw new ErrorValidacion('El modelo de origen y el de destino no pueden ser el mismo.');
  }

  return enTransaccion(async (tx) => {
    await exigirModelo(tx, idDestino);
    await exigirModelo(tx, datos.idOrigen);

    const [telasOrigen, aviosOrigen, bordadosOrigen] = await Promise.all([
      tx.modeloTela.findMany({ where: { idModelo: datos.idOrigen } }),
      tx.modeloAvio.findMany({ where: { idModelo: datos.idOrigen } }),
      tx.modeloBordado.findMany({ where: { idModelo: datos.idOrigen } }),
    ]);

    if (datos.reemplazar) {
      // Reemplaza: borra todo el BOM del destino y vuelca el del origen.
      await tx.modeloTela.deleteMany({ where: { idModelo: idDestino } });
      await tx.modeloAvio.deleteMany({ where: { idModelo: idDestino } });
      await tx.modeloBordado.deleteMany({ where: { idModelo: idDestino } });
    }

    // Componentes que el destino YA tiene (para no pisarlos al fusionar / evitar P2002).
    const [telasDestino, aviosDestino, bordadosDestino] = datos.reemplazar
      ? [new Set<number>(), new Set<number>(), new Set<number>()]
      : await Promise.all([
          tx.modeloTela
            .findMany({ where: { idModelo: idDestino }, select: { idTela: true } })
            .then((f) => new Set(f.map((x) => x.idTela))),
          tx.modeloAvio
            .findMany({ where: { idModelo: idDestino }, select: { idAvio: true } })
            .then((f) => new Set(f.map((x) => x.idAvio))),
          tx.modeloBordado
            .findMany({ where: { idModelo: idDestino }, select: { idBordado: true } })
            .then((f) => new Set(f.map((x) => x.idBordado))),
        ]);

    const telasACrear = telasOrigen.filter((t) => !telasDestino.has(t.idTela));
    const aviosACrear = aviosOrigen.filter((a) => !aviosDestino.has(a.idAvio));
    const bordadosACrear = bordadosOrigen.filter((b) => !bordadosDestino.has(b.idBordado));

    if (telasACrear.length > 0) {
      await tx.modeloTela.createMany({
        data: telasACrear.map((t) => ({
          idModelo: idDestino,
          idTela: t.idTela,
          consumoPorPrenda: t.consumoPorPrenda,
          paraPreCosto: t.paraPreCosto,
          paraProduccion: t.paraProduccion,
          paraCosto: t.paraCosto,
          creadoPorId: sesion.id,
          modificadoPorId: sesion.id,
        })),
      });
    }
    if (aviosACrear.length > 0) {
      await tx.modeloAvio.createMany({
        data: aviosACrear.map((a) => ({
          idModelo: idDestino,
          idAvio: a.idAvio,
          consumoPorPrenda: a.consumoPorPrenda,
          paraPreCosto: a.paraPreCosto,
          paraProduccion: a.paraProduccion,
          paraCosto: a.paraCosto,
          creadoPorId: sesion.id,
          modificadoPorId: sesion.id,
        })),
      });
    }
    if (bordadosACrear.length > 0) {
      await tx.modeloBordado.createMany({
        data: bordadosACrear.map((b) => ({
          idModelo: idDestino,
          idBordado: b.idBordado,
          precio: b.precio,
          creadoPorId: sesion.id,
          modificadoPorId: sesion.id,
        })),
      });
    }

    await tocarModelo(tx, sesion, idDestino);
    await registrarBitacora(tx, sesion, {
      entidad: 'Modelo',
      idEntidad: idDestino,
      accion: 'MODIFICAR',
      datos: {
        bom: 'copiar',
        idOrigen: datos.idOrigen,
        reemplazar: datos.reemplazar,
        telas: telasACrear.length,
        avios: aviosACrear.length,
        bordados: bordadosACrear.length,
      },
    });

    return leerBom(tx, idDestino);
  }, bd);
}
