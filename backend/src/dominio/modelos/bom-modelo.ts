/**
 * BOM del modelo (F1-E4) — la RECETA: telas y avíos de un `Modelo` (doc
 * `Documentacion_MJD/01-Modelos.md` §2, `ModelosTela`/`ModelosHab`).
 *
 * Cada sección se gestiona con un endpoint "set-completo" (como el grid de colores de la tela
 * o los proveedores del avío en E3): se manda el conjunto deseado y el dominio sincroniza
 * (agrega/quita/actualiza) en UNA transacción A2, conservando la auditoría de los renglones
 * que no cambian (diff mínimo). Sin duplicados por componente (lo valida el esquema y lo
 * re-valida el dominio; lo respalda la PK compuesta).
 *
 * 🔑 Regla de negocio (A1 — doc 01-Modelos §2): las TRES banderas
 * `paraPreCosto`/`paraProduccion`/`paraCosto` de cada tela/avío se CONSERVAN: un componente
 * puede costear sin listarse en producción y viceversa.
 *
 * El ARTE (bordados/estampados) ya NO es una sección de "set completo": desde V1-E3d
 * (§Post-F9.35) es un HIJO del modelo con sus propios datos y su foto, con CRUD renglón por
 * renglón en `arte-modelo.ts`. Aquí solo se LEE (para embeberlo en la ficha) y se COPIA (junto
 * con el resto de la receta, en `copiarBom`).
 *
 * `copiarBom` clona la receta de OTRO modelo en UNA transacción (todo o nada): útil para dar de
 * alta variantes a partir de un modelo base. onDelete del BOM hacia los catálogos es Restrict
 * (una tela/avío usado por un modelo no se borra físico); hacia el modelo es Cascade (permite
 * reescribir el set en la tx).
 */
import type {
  esquemaModeloAvioEntrada,
  esquemaModeloTelaEntrada,
} from '../../contrato/esquemas/modelo.js';
import {
  esquemaModeloAvios,
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
import { recalcularEstadoOrdenesDeModelo } from '../produccion/requisitos-orden.js';

import {
  borrarArchivoSiQuedoHuerfano,
  datosArteParaBitacora,
  leerArtesModelo,
  type ModeloArteDetalle,
} from './arte-modelo.js';
import { exigirModelo, incluirRelacionesModelo, type ModeloConRelaciones } from './modelos.js';

// ── Tipos de entrada (lo que recibe el dominio ANTES de validar: defaults opcionales) ──
// El dominio re-valida con `validarEntrada` (mismo patrón que `EntradaCrear*`): por eso los
// puntos de entrada aceptan `z.input` (banderas opcionales) y, ya validados, las funciones
// internas trabajan con `z.output` (banderas resueltas).

/** Renglón de tela del BOM tal como LLEGA (banderas opcionales; el dominio aplica defaults). */
export type EntradaTelaBom = z.input<typeof esquemaModeloTelaEntrada>;
/** Renglón de avío del BOM tal como llega. */
export type EntradaAvioBom = z.input<typeof esquemaModeloAvioEntrada>;
/** Cuerpo de copiar BOM tal como llega (`reemplazar` opcional, default true). */
export type EntradaCopiarBom = z.input<typeof esquemaModeloCopiarBomCuerpo>;

/** Renglón de tela del BOM ya validado (banderas y consumo resueltos). */
type TelaBomValidada = z.output<typeof esquemaModeloTelaEntrada>;
/** Renglón de avío del BOM ya validado. */
type AvioBomValidado = z.output<typeof esquemaModeloAvioEntrada>;

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

/** BOM completo de un modelo (telas + avíos + su ARTE), para embeber en la ficha. */
export interface BomModelo {
  telas: ModeloTelaDetalle[];
  avios: ModeloAvioDetalle[];
  artes: ModeloArteDetalle[];
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

/** Lee el BOM completo (telas + avíos + arte) de un modelo. Reusado por la ficha. */
export async function leerBom(tx: Tx, idModelo: number): Promise<BomModelo> {
  const [telas, avios, artes] = await Promise.all([
    leerTelasBom(tx, idModelo),
    leerAviosBom(tx, idModelo),
    leerArtesModelo(tx, idModelo),
  ]);
  return { telas, avios, artes };
}

/** Modelo con sus relaciones + el BOM completo embebido (forma de la FICHA). */
export type ModeloFicha = ModeloConRelaciones & BomModelo;

/**
 * Obtiene la FICHA de un modelo: datos generales + relaciones + conteo de fotos + el BOM
 * completo (telas/avíos/arte). Requiere `modelos.ver`. Lanza `ErrorNoEncontrado` si no
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
      // El BOM de avíos es uno de los REQUISITOS de "orden completa" (Daniel 26-jul-2026): las
      // órdenes de ESTE modelo a las que solo les faltaba la receta se COMPLETAN en la MISMA
      // transacción (A2). Solo COMPLETA: un cambio de catálogo NUNCA degrada órdenes (ver
      // `recalcularEstadoOrdenesDeModelo`).
      await recalcularEstadoOrdenesDeModelo(tx, sesion, idModelo);
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
 * ⚠️ Al REEMPLAZAR, el arte del destino **se borra de verdad** (ya no es un puente a un catálogo,
 * V1-E3d): antes de barrerlo se registra ÍNTEGRO en la bitácora —precio, proveedor y foto
 * incluidos— y sus `Archivo` sin dueño se limpian con la misma regla de foto compartida que usa
 * `arte-modelo.ts` (D3: nada se borra en silencio).
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

    const [telasOrigen, aviosOrigen, artesOrigen] = await Promise.all([
      tx.modeloTela.findMany({ where: { idModelo: datos.idOrigen } }),
      tx.modeloAvio.findMany({ where: { idModelo: datos.idOrigen } }),
      // Ordenados como se despliegan: al FUSIONAR se reindexan detrás de lo que ya tiene el
      // destino, así que el orden relativo del origen (su arte principal primero) se respeta.
      tx.modeloArte.findMany({
        where: { idModelo: datos.idOrigen },
        orderBy: [{ orden: 'asc' }, { nombre: 'asc' }, { id: 'asc' }],
      }),
    ]);

    // ⚠️ EL ARTE QUE SE VA AL REEMPLAZAR NO ES UN PUENTE: **ES EL ARTE**. Desde V1-E3d ya no hay
    // catálogo del que recuperar nombre, puntadas, PRECIO (el que entra al costo de la OP,
    // `costos/costo-orden.ts`), proveedor ni foto: si esta transacción lo borra sin dejar rastro,
    // desaparece para siempre. Por eso se LEE ANTES de borrar y cada renglón que se va queda
    // ÍNTEGRO en la bitácora (D3), igual que en `eliminarArte`.
    if (datos.reemplazar) {
      const artesBorradas = await tx.modeloArte.findMany({ where: { idModelo: idDestino } });

      // Reemplaza: borra todo el BOM del destino y vuelca el del origen.
      await tx.modeloTela.deleteMany({ where: { idModelo: idDestino } });
      await tx.modeloAvio.deleteMany({ where: { idModelo: idDestino } });
      await tx.modeloArte.deleteMany({ where: { idModelo: idDestino } });

      if (artesBorradas.length > 0) {
        await registrarBitacora(tx, sesion, {
          entidad: 'Modelo',
          idEntidad: idDestino,
          accion: 'MODIFICAR',
          datos: {
            bom: 'copiar',
            operacion: 'arte-reemplazado',
            idOrigen: datos.idOrigen,
            // El renglón COMPLETO de cada arte que se fue (precio y proveedor incluidos).
            artesQueSeFueron: artesBorradas.map(datosArteParaBitacora),
          },
        });
        // Las FOTOS que quedaron sin dueño se limpian con el MISMO cuidado que en `arte-modelo.ts`:
        // varios artes pueden compartir un `Archivo` (migración + «copiar arte de otro modelo»), así
        // que solo se borra el que ya no referencia NADIE — si no, se dejarían filas `Archivo`
        // huérfanas (y borrar a ciegas dejaría a otro arte sin su imagen). Se deduplica porque dos
        // artes del destino pueden compartir la misma foto.
        for (const idArchivo of new Set(
          artesBorradas.flatMap((a) => (a.idArchivoFoto === null ? [] : [a.idArchivoFoto])),
        )) {
          await borrarArchivoSiQuedoHuerfano(tx, idArchivo);
        }
      }
    }

    // Componentes que el destino YA tiene (para no pisarlos al fusionar / evitar P2002). El arte
    // se identifica por NOMBRE (ya no tiene id de catálogo: es un hijo del modelo, V1-E3d).
    const [telasDestino, aviosDestino, artesDestino] = datos.reemplazar
      ? [new Set<number>(), new Set<number>(), new Set<string>()]
      : await Promise.all([
          tx.modeloTela
            .findMany({ where: { idModelo: idDestino }, select: { idTela: true } })
            .then((f) => new Set(f.map((x) => x.idTela))),
          tx.modeloAvio
            .findMany({ where: { idModelo: idDestino }, select: { idAvio: true } })
            .then((f) => new Set(f.map((x) => x.idAvio))),
          tx.modeloArte
            .findMany({ where: { idModelo: idDestino }, select: { nombre: true } })
            .then((f) => new Set(f.map((x) => x.nombre.toLocaleLowerCase()))),
        ]);

    const telasACrear = telasOrigen.filter((t) => !telasDestino.has(t.idTela));
    const aviosACrear = aviosOrigen.filter((a) => !aviosDestino.has(a.idAvio));
    const artesACrear = artesOrigen.filter((a) => !artesDestino.has(a.nombre.toLocaleLowerCase()));

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
    if (artesACrear.length > 0) {
      // Al REEMPLAZAR, el destino quedó vacío: se copia el `orden` del origen tal cual (el arte
      // principal del origen llega como principal del destino). Al FUSIONAR, los copiados se
      // reindexan DETRÁS del arte que el destino ya tenía, para no desbancar a SU principal.
      // La FOTO se comparte con el original (el objeto de R2 no se duplica; ver `arte-modelo.ts`).
      let ordenBase = 0;
      if (!datos.reemplazar) {
        const maximo = await tx.modeloArte.aggregate({
          where: { idModelo: idDestino },
          _max: { orden: true },
        });
        ordenBase = (maximo._max.orden ?? -1) + 1;
      }
      await tx.modeloArte.createMany({
        data: artesACrear.map((a, i) => ({
          idModelo: idDestino,
          nombre: a.nombre,
          descripcion: a.descripcion,
          puntadas: a.puntadas,
          precio: a.precio,
          tipo: a.tipo,
          idProveedor: a.idProveedor,
          idArchivoFoto: a.idArchivoFoto,
          orden: datos.reemplazar ? a.orden : ordenBase + i,
          creadoPorId: sesion.id,
          modificadoPorId: sesion.id,
        })),
      });
    }

    await tocarModelo(tx, sesion, idDestino);
    // Copiar un BOM puede DARLE su receta de avíos al modelo destino: las órdenes suyas a las que
    // solo les faltaba eso se COMPLETAN aquí mismo (A2). Al REEMPLAZAR también puede quitársela,
    // pero eso NO degrada nada: el recálculo por catálogo solo asciende.
    await recalcularEstadoOrdenesDeModelo(tx, sesion, idDestino);
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
        artes: artesACrear.length,
      },
    });

    return leerBom(tx, idDestino);
  }, bd);
}
