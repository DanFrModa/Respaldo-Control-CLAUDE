/**
 * NOTAS DE SALIDA estructuradas (Módulo 5, F4-E5 — doc `Documentacion_MJD/03-Produccion.md`
 * §"Submódulo — Notas de Salida (Menú 3.4)"; `04-Inventarios.md` §"Cómo conecta"; MEJORAS §03;
 * R4/R9). Una nota documenta el ENVÍO de materiales a un maquilero (un Proveedor/tercero — fusión
 * D12/R15) contra una orden de producción. Sustituye las notas de TEXTO LIBRE del viejo
 * (`Notas`/`NotasDet`) por renglones ESTRUCTURADOS contra catálogo. Toda la lógica vive AQUÍ (A1);
 * las rutas REST solo validan permiso + Zod y delegan. Esta capa ORQUESTA el motor de kardex
 * (`comun/kardex.ts`) — el ÚNICO que escribe `Movimiento`/`MovimientoDet*`.
 *
 * Dos tipos de renglón:
 *  • AVÍO: al CONFIRMAR la nota descuenta el kardex de avíos con un movimiento `salida-por-nota`
 *    (R4 — el consumo de avíos va ligado a las notas). Valida no-negativo bajo lock (D3).
 *  • TELA: la tela YA se descontó UNA sola vez con `registrarSalidaTelaAOrden` (E1, traza
 *    `origenTipo=salida-tela-orden`, `origenId=idOrden`). La nota solo REFERENCIA ese movimiento
 *    como documento de envío y NO genera segundo movimiento de kardex (DECISIÓN (e) de Daniel,
 *    `DECISIONES.md`). El renglón guarda `idMovimientoSalidaTela` — la base del ANTI-DOBLE-DESCUENTO.
 *
 * Innegociables aplicados:
 *  • A1 — la lógica vive en este módulo; las rutas son delgadas.
 *  • A2 — encabezado + renglones (alta/edición) y confirmar/cancelar van en UNA transacción
 *    (`enTransaccion`): o todo o nada (si falla un descuento de avío no queda nota confirmada ni
 *    movimiento — rollback).
 *  • A3/A9 — el folio `numNota` sale de la secuencia atómica `"nota-salida"` POR EMPRESA
 *    (`siguienteFolio`); NUNCA `Max()+1`. Todo se filtra/sella por la empresa ACTIVA de la sesión.
 *  • A4 — permisos verificados aquí (defensa en profundidad): `notas.ver`/`.administrar`/`.cancelar`.
 *  • A7 — auditoría uniforme (`creadoPorId`/`modificadoPorId` + `Bitacora` en la misma tx).
 *  • D3 — la existencia es Σ de movimientos; al cancelar NO se edita/borra — se genera el movimiento
 *    INVERSO auditado de cada `salida-por-nota` que la nota generó (la tela NUNCA se toca: su
 *    salida-a-orden sigue viva).
 *
 * NOTA SOBRE EL ALMACÉN (decisión (g) de Daniel, `DECISIONES.md`): el inventario de avíos es
 * MULTI-ALMACÉN (R4) y el almacén ORIGEN de la nota vive en el ENCABEZADO (`NotaSalida.idAlmacen`),
 * un solo almacén por nota, elegido al CREAR — espejo de la recepción de compra (que lleva su almacén
 * destino en el encabezado). Se valida (existe + activo + global o de la empresa, A9) al crear/editar
 * con el helper compartido `comun/almacenes.ts`. Al CONFIRMAR, los avíos se descuentan de ESE almacén
 * del encabezado; la traza queda en el propio `Movimiento.idAlmacen` y el renglón apunta a él con
 * `idMovimientoAvio`. La tela NO descuenta (decisión (e)), así que el almacén aplica a los avíos.
 */
import {
  esquemaNotaSalidaCrear,
  esquemaNotaSalidaEditarCuerpo,
  esquemaNotaSalidaCancelarCuerpo,
  type DatosNotaSalidaLineaEntrada,
  type NotaSalidaSalida,
  type NotaSalidaLineaSalida,
  type NotasSalidaPagina,
  type ResumenNotasSalida,
} from '../../contrato/index.js';
import { EstatusNotaSalida, type Prisma } from '../../datos/index.js';
import { z } from 'zod';

import { exigirAlmacen } from '../../comun/almacenes.js';
import { datosCreacion, datosModificacion, registrarBitacora } from '../../comun/auditoria.js';
import { dispararPublicacion } from '../../comun/cola-eventos.js';
import {
  EVENTOS_OUTBOX,
  VERSION_EVENTO_RC_ORDEN,
  registrarEventoOutbox,
  type EventoRcOrden,
} from '../../comun/eventos-dominio.js';
import { ErrorConflicto, ErrorNoEncontrado, ErrorValidacion } from '../../comun/errores.js';
import {
  bloquearAvio,
  cancelarMovimientoMaterial,
  existenciaAvioBloqueada,
  registrarMovimientoAvio,
  type LineaMovimientoAvio,
} from '../../comun/kardex.js';
import { ORIGEN } from '../../comun/origenes.js';
import { armarPagina, rangoPrisma, type Pagina } from '../../comun/paginacion.js';
import { verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import { siguienteFolio } from '../../comun/secuencias.js';
import {
  clienteLectura,
  enTransaccion,
  type ContextoBd,
  type Tx,
} from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';

/** Clave de la secuencia de folios de notas de salida (A3 — por empresa). */
export const CLAVE_SECUENCIA_NOTA_SALIDA = 'nota-salida';

/**
 * Parámetros del listado con tipos NATIVOS (la ruta ya coaccionó la querystring; el dominio re-valida
 * con tipos nativos — mismo patrón que `ordenes-compra.ts`). No se reusa el esquema del contrato (que
 * coacciona desde texto) para pasar el `request.query` ya parseado sin chocar con `.stringbool()`.
 */
const esquemaListarNotasDominio = z.object({
  pagina: z.number().int().min(1).default(1),
  porPagina: z.number().int().min(1).max(100).default(20),
  busqueda: z.string().trim().max(200).optional(),
  idMaquilero: z.number().int().positive().optional(),
  idOrden: z.number().int().positive().optional(),
  estatus: z.enum(['borrador', 'confirmada', 'cancelada']).optional(),
  incluirCanceladas: z.boolean().default(false),
  ordenarPor: z.enum(['numNota', 'fechaElaboracion', 'creadoEn']).default('numNota'),
  direccion: z.enum(['asc', 'desc']).default('desc'),
});

/** Código del tipo de movimiento de SALIDA de avío por nota (sembrado en F4-E1). */
const COD_SALIDA_POR_NOTA = 'salida-por-nota';
/** Tipo inverso (entrada) para reversar un `salida-por-nota` al cancelar la nota (D3). */
const COD_AJUSTE_ENTRADA = 'ajuste-entrada';

/**
 * Espacio de nombres del advisory lock de la nota de salida: se mezcla con `idNotaSalida` en la clave
 * `bigint` para que el lock no colisione con NINGÚN otro lock del sistema. Igual criterio que
 * `bloquearOrdenCompra` (recepciones): usa la forma de UN argumento `pg_advisory_xact_lock(bigint)`,
 * que en Postgres ocupa un ESPACIO DE LOCKS DISTINTO del de dos argumentos (que usa el kardex) → no
 * colisiona con los del kardex. El namespace lo SEPARA además del de la OC (`0x4f43`): así dos
 * entidades distintas con el mismo id numérico NO comparten lock.
 */
const NS_LOCK_NOTA_SALIDA = 0x4e53n; // "NS" (Nota de Salida) en hex, discriminador del namespace.

/**
 * Serializa el read-modify-write del ESTATUS de una nota tomando un advisory lock TRANSACCIONAL por
 * `idNotaSalida`. Dos confirmaciones/cancelaciones concurrentes de la MISMA nota se serializan: la
 * segunda espera al commit de la primera, así ve el estatus ya cambiado y se rechaza (sin doble
 * descuento de avíos ni movimientos huérfanos). Se toma al ENTRAR a la transacción, ANTES de leer el
 * estatus. El lock se libera solo al terminar la transacción (no hay que soltarlo a mano).
 *
 * Clave `bigint` = (namespace << 32) | idNotaSalida: única por nota y en un espacio de locks que no
 * comparte con los del kardex (forma de dos enteros) ni con el de la OC (otro namespace).
 */
async function bloquearNotaSalida(tx: Tx, idNotaSalida: number): Promise<void> {
  const clave = (NS_LOCK_NOTA_SALIDA << 32n) | BigInt(idNotaSalida);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${clave}::bigint)`;
}

// ── Tipos de entrada ───────────────────────────────────────────────────────────────────────────

/** Alta de nota: campos del esquema compartido. */
export type EntradaCrearNota = z.input<typeof esquemaNotaSalidaCrear>;
/** Edición del cuerpo de la nota (sin id: va en la URL). */
export type EntradaActualizarNota = z.input<typeof esquemaNotaSalidaEditarCuerpo>;
/** Cuerpo de cancelar (motivo obligatorio). */
export type CuerpoCancelarNota = z.input<typeof esquemaNotaSalidaCancelarCuerpo>;

// ── Helpers ──────────────────────────────────────────────────────────────────────────────────────

/** Convierte un `YYYY-MM-DD` (o null/undefined) al `Date` que Prisma guarda en `@db.Date`. */
function aDateColumna(valor: string | null | undefined): Date | null | undefined {
  if (valor === undefined) return undefined;
  if (valor === null) return null;
  return new Date(`${valor}T00:00:00.000Z`);
}

/** Convierte un `DateTime @db.Date` a `YYYY-MM-DD`, o `null`. */
function aFechaIso(fecha: Date | null): string | null {
  return fecha === null ? null : fecha.toISOString().slice(0, 10);
}

/** Normaliza un texto opcional (trim ya aplicado por Zod; vacío → null). */
function aTexto(valor: string | null | undefined): string | null | undefined {
  if (valor === undefined) return undefined;
  if (valor === null || valor === '') return null;
  return valor;
}

/** Resuelve un tipo de movimiento por su `codigo`, exigiéndolo activo. Lanza si no existe/inactivo. */
async function tipoPorCodigo(tx: Tx, codigo: string): Promise<{ id: number }> {
  const tipo = await tx.tipoMovimientoInventario.findUnique({
    where: { codigo },
    select: { id: true, nombre: true, activo: true },
  });
  if (tipo === null) {
    throw new ErrorValidacion(
      `Falta el tipo de movimiento "${codigo}" en el catálogo (re-sembrar). No se puede continuar.`,
    );
  }
  if (!tipo.activo) {
    throw new ErrorValidacion(`El tipo de movimiento "${tipo.nombre}" está desactivado.`);
  }
  return { id: tipo.id };
}

/**
 * Busca una nota de la EMPRESA ACTIVA por id, o lanza `ErrorNoEncontrado` (una nota de otra empresa,
 * para esta sesión, no existe — A9). La usan obtener/editar/confirmar/cancelar.
 */
async function exigirNota(tx: Tx, id: number, idEmpresa: number) {
  const nota = await tx.notaSalida.findFirst({ where: { id, idEmpresa } });
  if (nota === null) {
    throw new ErrorNoEncontrado('NotaSalida', id);
  }
  return nota;
}

/** Exige que el maquilero (Proveedor) exista (la FK la protege la BD; damos un error claro). */
async function exigirMaquileroExiste(tx: Tx, idMaquilero: number): Promise<void> {
  const prov = await tx.proveedor.findUnique({
    where: { id: idMaquilero },
    select: { id: true },
  });
  if (prov === null) {
    throw new ErrorNoEncontrado('Proveedor', idMaquilero);
  }
}

/** ¿El renglón es de avío? (XOR — un renglón de avío trae `idAvio` y NO trae tela.) */
function esRenglonAvio(linea: DatosNotaSalidaLineaEntrada): boolean {
  return linea.idAvio != null;
}

/**
 * Valida el SET de renglones de la nota (reglas de negocio, A1). Para cada renglón:
 *  • XOR: es de AVÍO (`idAvio`, sin tela/lote/movimiento de tela) o de TELA (`idTela` + `idLote` +
 *    `idMovimientoSalidaTela`) — EXACTAMENTE uno de los dos.
 *  • La orden de producción destino existe y es de la empresa activa (A9).
 *  • De AVÍO: el avío existe (catálogo).
 *  • De TELA: la tela y el lote existen; el movimiento referenciado existe, es de la empresa activa,
 *    es de dirección SALIDA con `origenTipo=salida-tela-orden` y `origenId = idOrden` del renglón
 *    (es DE VERDAD la salida-a-orden de E1, no cualquier movimiento) — esta liga es la base del
 *    ANTI-DOBLE-DESCUENTO: el renglón REFERENCIA ese descuento, no genera otro (decisión (e)).
 */
async function validarRenglones(
  tx: Tx,
  idEmpresa: number,
  lineas: DatosNotaSalidaLineaEntrada[],
): Promise<void> {
  const idsOrden = new Set<number>();
  const idsAvio = new Set<number>();
  const idsTela = new Set<number>();
  const idsLote = new Set<number>();
  // Movimientos de salida-a-orden ya referenciados por algún renglón de la nota: dos renglones de
  // tela NO pueden apuntar al MISMO `idMovimientoSalidaTela` (sería referenciar dos veces el mismo
  // envío). Como `validarRenglones` se usa al crear y al actualizar, esto cubre ambos casos.
  const movsTelaVistos = new Set<number>();

  for (const [indice, linea] of lineas.entries()) {
    const num = indice + 1;
    const tieneAvio = linea.idAvio != null;
    const tieneTela = linea.idTela != null;
    if (tieneAvio === tieneTela) {
      throw new ErrorValidacion(`El renglón ${num} debe ser de avío O de tela (exactamente uno).`);
    }
    idsOrden.add(linea.idOrden);

    if (tieneAvio) {
      // Un renglón de avío NO debe traer datos de tela.
      if (linea.idTela != null || linea.idLote != null || linea.idMovimientoSalidaTela != null) {
        throw new ErrorValidacion(
          `El renglón ${num} es de avío; no puede llevar tela, lote ni movimiento de tela.`,
        );
      }
      idsAvio.add(linea.idAvio as number);
    } else {
      // Renglón de TELA: exige lote + el movimiento salida-a-orden referenciado (decisión (e)).
      if (linea.idLote == null) {
        throw new ErrorValidacion(`El renglón ${num} de tela necesita el lote (D5).`);
      }
      if (linea.idMovimientoSalidaTela == null) {
        throw new ErrorValidacion(
          `El renglón ${num} de tela debe referenciar su salida-a-orden ya registrada ` +
            `(idMovimientoSalidaTela) — la nota documenta el envío, no descuenta la tela (decisión e).`,
        );
      }
      if (movsTelaVistos.has(linea.idMovimientoSalidaTela)) {
        throw new ErrorValidacion(
          `El renglón ${num}: el movimiento de salida de tela ${linea.idMovimientoSalidaTela} ya fue ` +
            `referenciado por otro renglón de la nota.`,
        );
      }
      movsTelaVistos.add(linea.idMovimientoSalidaTela);
      idsTela.add(linea.idTela as number);
      idsLote.add(linea.idLote);
    }
  }

  // Existencia de catálogos referenciados (en lote).
  await exigirTodosExisten(tx, 'Avio', idsAvio, (ids) =>
    tx.avio.findMany({ where: { id: { in: ids } }, select: { id: true } }),
  );
  await exigirTodosExisten(tx, 'Tela', idsTela, (ids) =>
    tx.tela.findMany({ where: { id: { in: ids } }, select: { id: true } }),
  );
  await exigirTodosExisten(tx, 'Lote', idsLote, (ids) =>
    tx.lote.findMany({ where: { id: { in: ids } }, select: { id: true } }),
  );

  // Órdenes de producción destino: existen y son de la empresa activa (A9).
  if (idsOrden.size > 0) {
    const ordenes = await tx.orden.findMany({
      where: { id: { in: [...idsOrden] }, idEmpresa },
      select: { id: true },
    });
    const existentes = new Set(ordenes.map((o) => o.id));
    for (const idOrden of idsOrden) {
      if (!existentes.has(idOrden)) {
        throw new ErrorNoEncontrado('Orden', idOrden);
      }
    }
  }

  // Validación FINA del movimiento de TELA referenciado por cada renglón de tela: la liga del
  // anti-doble-descuento (es la salida-a-orden de E1, de esta empresa, de ESTA orden, de tela/lote).
  for (const [indice, linea] of lineas.entries()) {
    if (linea.idMovimientoSalidaTela == null) continue;
    const num = indice + 1;
    const mov = await tx.movimiento.findFirst({
      where: { id: linea.idMovimientoSalidaTela, idEmpresa },
      select: {
        id: true,
        origenTipo: true,
        origenId: true,
        detallesTela: { select: { idTela: true, idLote: true } },
        anuladoPor: { select: { id: true } },
      },
    });
    if (mov === null) {
      throw new ErrorNoEncontrado('Movimiento de salida de tela', linea.idMovimientoSalidaTela);
    }
    // Una salida-a-orden ya reversada/anulada (tiene un movimiento inverso) NO puede documentar un
    // envío: ese material ya regresó al inventario (mismo criterio que `cancelarMovimientoMaterial`).
    if (mov.anuladoPor.length > 0) {
      throw new ErrorValidacion(
        `El renglón ${num}: la salida de tela referenciada ya fue reversada; no se puede documentar ` +
          `un envío sobre una salida anulada.`,
      );
    }
    if (mov.origenTipo !== ORIGEN.salidaTelaOrden) {
      throw new ErrorValidacion(
        `El renglón ${num}: el movimiento referenciado no es una salida de tela a orden (decisión e).`,
      );
    }
    // origenId del movimiento es el id de la orden (string): debe ser la MISMA orden del renglón.
    if (mov.origenId !== String(linea.idOrden)) {
      throw new ErrorValidacion(
        `El renglón ${num}: la salida de tela referenciada es de otra orden (no de la orden ${linea.idOrden}).`,
      );
    }
    // La tela/lote del renglón debe estar EN ese movimiento (no se referencia una salida ajena).
    const casa = mov.detallesTela.some(
      (d) => d.idTela === linea.idTela && d.idLote === linea.idLote,
    );
    if (!casa) {
      throw new ErrorValidacion(
        `El renglón ${num}: la tela/lote no corresponde a la salida-a-orden referenciada.`,
      );
    }
  }
}

/** Exige que todos los ids de un catálogo existan; lanza `ErrorNoEncontrado` con el primero que falte. */
async function exigirTodosExisten(
  _tx: Tx,
  entidad: string,
  ids: Set<number>,
  buscar: (ids: number[]) => Promise<{ id: number }[]>,
): Promise<void> {
  if (ids.size === 0) return;
  const filas = await buscar([...ids]);
  const existentes = new Set(filas.map((f) => f.id));
  for (const id of ids) {
    if (!existentes.has(id)) {
      throw new ErrorNoEncontrado(entidad, id);
    }
  }
}

/** Crea los renglones de una nota desde cero (alta o reemplazo). Asume que no tiene renglones aún. */
async function crearRenglones(
  tx: Tx,
  sesion: SesionUsuario,
  idNotaSalida: number,
  lineas: DatosNotaSalidaLineaEntrada[],
): Promise<void> {
  await tx.notaSalidaLinea.createMany({
    data: lineas.map((l) => ({
      idNotaSalida,
      idOrden: l.idOrden,
      idAvio: l.idAvio ?? null,
      idTela: l.idTela ?? null,
      idLote: l.idLote ?? null,
      idMovimientoSalidaTela: l.idMovimientoSalidaTela ?? null,
      cantidad: l.cantidad,
      unidad: aTexto(l.unidad) ?? null,
      // descripcionLegacy NO se captura (es solo del ETL de E6).
      creadoPorId: sesion.id,
      modificadoPorId: sesion.id,
    })),
  });
}

// ── Proyección a la salida ───────────────────────────────────────────────────────────────────────

/** `include` estándar para traer la nota con todo su detalle (ordenado de forma estable). */
const incluirDetalle = {
  maquilero: { select: { nombre: true } },
  almacen: { select: { nombre: true } },
  lineas: {
    orderBy: { id: 'asc' },
    include: {
      orden: { select: { folio: true } },
      avio: { select: { clave: true, descripcion: true } },
      tela: { select: { nombre: true } },
      lote: { select: { clave: true } },
      movimientoSalidaTela: { select: { folio: true } },
      movimientoAvio: { select: { folio: true } },
    },
  },
} satisfies Prisma.NotaSalidaInclude;

type NotaConDetalle = Prisma.NotaSalidaGetPayload<{ include: typeof incluirDetalle }>;

/** Proyecta una nota (con detalle) a la forma JSON del contrato. */
function aNotaSalida(n: NotaConDetalle): NotaSalidaSalida {
  const lineas: NotaSalidaLineaSalida[] = n.lineas.map((l) => {
    const tipo: 'avio' | 'tela' = l.idAvio !== null ? 'avio' : 'tela';
    return {
      id: l.id,
      idOrden: l.idOrden,
      folioOrden: l.orden === null ? null : Number(l.orden.folio),
      tipo,
      idAvio: l.idAvio,
      avio: l.avio === null ? null : `${l.avio.clave} — ${l.avio.descripcion}`,
      idTela: l.idTela,
      tela: l.tela?.nombre ?? null,
      idLote: l.idLote,
      loteClave: l.lote?.clave ?? null,
      idMovimientoSalidaTela: l.idMovimientoSalidaTela,
      folioMovimientoSalidaTela:
        l.movimientoSalidaTela === null ? null : Number(l.movimientoSalidaTela.folio),
      idMovimientoAvio: l.idMovimientoAvio,
      folioMovimientoAvio: l.movimientoAvio === null ? null : Number(l.movimientoAvio.folio),
      cantidad: Number(l.cantidad),
      unidad: l.unidad,
      descripcionLegacy: l.descripcionLegacy,
    };
  });

  return {
    id: n.id,
    numNota: Number(n.numNota),
    idEmpresa: n.idEmpresa,
    estatus: n.estatus,
    idMaquilero: n.idMaquilero,
    maquilero: n.maquilero.nombre,
    idAlmacen: n.idAlmacen,
    almacen: n.almacen.nombre,
    fechaElaboracion: aFechaIso(n.fechaElaboracion) ?? '',
    fechaEnvio: aFechaIso(n.fechaEnvio),
    observaciones: n.observaciones,
    confirmadaEn: n.confirmadaEn === null ? null : n.confirmadaEn.toISOString(),
    confirmadaPorId: n.confirmadaPorId,
    canceladaEn: n.canceladaEn === null ? null : n.canceladaEn.toISOString(),
    canceladaPorId: n.canceladaPorId,
    motivoCancelacion: n.motivoCancelacion,
    lineas,
    creadoEn: n.creadoEn.toISOString(),
    creadoPorId: n.creadoPorId,
    modificadoEn: n.modificadoEn.toISOString(),
    modificadoPorId: n.modificadoPorId,
  };
}

/**
 * Emite `surtido-avios-resuelto` (post-F9, cierre del hueco de emisores) para CADA orden de producción
 * de una línea de AVÍO de la nota — dentro de la MISMA tx del hecho (A2). El auto-avance de la RC
 * re-evalúa el proceso `surtidoAvios` de esas órdenes: relee el estado físico (¿hay una nota CONFIRMADA
 * viva con línea de avío para la orden?) y auto-completa o des-completa (idempotente). Se llama al
 * CONFIRMAR y al CANCELAR una nota; el consumidor decide el efecto según el estado actual.
 */
async function emitirSurtidoAvios(tx: Tx, idEmpresa: number, idNota: number): Promise<void> {
  const lineas = await tx.notaSalidaLinea.findMany({
    where: { idNotaSalida: idNota, idAvio: { not: null } },
    select: { idOrden: true },
  });
  const idsOrden = [...new Set(lineas.map((l) => l.idOrden))];
  for (const idOrden of idsOrden) {
    const payload: EventoRcOrden = { idEmpresa, idOrden };
    await registrarEventoOutbox(
      tx,
      EVENTOS_OUTBOX.surtidoAviosResuelto,
      VERSION_EVENTO_RC_ORDEN,
      idEmpresa,
      payload,
    );
  }
}

// ── Operaciones de ESCRITURA ───────────────────────────────────────────────────────────────────

/**
 * Crea una nota de salida en estado `borrador` en UNA transacción (A2). Valida el maquilero y el SET
 * de renglones (XOR avío/tela, existencia de catálogos, órdenes de la empresa, liga del renglón de
 * tela a su salida-a-orden de E1 — anti-doble-descuento); toma el folio de la secuencia atómica
 * `"nota-salida"` de la empresa activa (A3/A9); auditoría + bitácora CREAR. El descuento de avíos
 * NO sucede aquí (sucede al CONFIRMAR). Permiso `notas.administrar`.
 */
export async function crearNotaSalida(
  sesion: SesionUsuario,
  entrada: EntradaCrearNota,
  bd?: ContextoBd,
): Promise<NotaSalidaSalida> {
  verificarPermiso(sesion, 'notas.administrar');
  const datos = validarEntrada(esquemaNotaSalidaCrear, entrada);
  const idEmpresa = sesion.idEmpresaActiva;

  const idNota = await enTransaccion(async (tx) => {
    await exigirMaquileroExiste(tx, datos.idMaquilero);
    // Almacén origen en el encabezado (decisión g): existe + activo + global o de la empresa (A9).
    await exigirAlmacen(tx, datos.idAlmacen, idEmpresa);
    await validarRenglones(tx, idEmpresa, datos.lineas);

    const folio = await siguienteFolio(tx, idEmpresa, CLAVE_SECUENCIA_NOTA_SALIDA);

    const nota = await tx.notaSalida.create({
      data: {
        numNota: folio,
        idEmpresa,
        idMaquilero: datos.idMaquilero,
        idAlmacen: datos.idAlmacen,
        fechaElaboracion: aDateColumna(datos.fechaElaboracion) as Date,
        fechaEnvio: aDateColumna(datos.fechaEnvio) ?? null,
        observaciones: aTexto(datos.observaciones) ?? null,
        estatus: EstatusNotaSalida.borrador,
        ...datosCreacion(sesion),
      },
    });

    await crearRenglones(tx, sesion, nota.id, datos.lineas);

    await registrarBitacora(tx, sesion, {
      entidad: 'NotaSalida',
      idEntidad: nota.id,
      accion: 'CREAR',
      datos: {
        numNota: Number(folio),
        idMaquilero: datos.idMaquilero,
        renglones: datos.lineas.length,
      },
    });

    return nota.id;
  }, bd);

  return obtenerNotaSalida(sesion, idNota, bd);
}

/**
 * Actualiza una nota en BORRADOR (encabezado + reemplazo opcional del SET de renglones) en UNA
 * transacción (A2). Una nota `confirmada` o `cancelada` NO se edita (`ErrorConflicto`): editar una
 * nota confirmada cambiaría lo descontado del kardex sin traza (D3 — el camino correcto es cancelar
 * y rehacer). Si `lineas` viene, REEMPLAZA todo el set (borra y recrea). Bitácora MODIFICAR. Permiso
 * `notas.administrar`.
 */
export async function actualizarNotaSalida(
  sesion: SesionUsuario,
  id: number,
  entrada: EntradaActualizarNota,
  bd?: ContextoBd,
): Promise<NotaSalidaSalida> {
  verificarPermiso(sesion, 'notas.administrar');
  const datos = validarEntrada(esquemaNotaSalidaEditarCuerpo, entrada);
  const idEmpresa = sesion.idEmpresaActiva;

  await enTransaccion(async (tx) => {
    const actual = await exigirNota(tx, id, idEmpresa);
    if (actual.estatus !== EstatusNotaSalida.borrador) {
      throw new ErrorConflicto(
        `La nota de salida ${Number(actual.numNota)} está ${actual.estatus}; solo se edita en borrador.`,
      );
    }

    const cambios: Prisma.NotaSalidaUncheckedUpdateInput = { ...datosModificacion(sesion) };
    if (datos.idMaquilero !== undefined) {
      await exigirMaquileroExiste(tx, datos.idMaquilero);
      cambios.idMaquilero = datos.idMaquilero;
    }
    if (datos.idAlmacen !== undefined) {
      // Almacén origen del encabezado (decisión g): existe + activo + global o de la empresa (A9).
      await exigirAlmacen(tx, datos.idAlmacen, idEmpresa);
      cambios.idAlmacen = datos.idAlmacen;
    }
    if (datos.fechaElaboracion !== undefined) {
      cambios.fechaElaboracion = aDateColumna(datos.fechaElaboracion) as Date;
    }
    if (datos.fechaEnvio !== undefined) cambios.fechaEnvio = aDateColumna(datos.fechaEnvio) ?? null;
    if (datos.observaciones !== undefined)
      cambios.observaciones = aTexto(datos.observaciones) ?? null;

    await tx.notaSalida.update({ where: { id }, data: cambios });

    // Reemplazo del SET de renglones (si vino). Borra y recrea: los renglones de una nota en borrador
    // no tienen estado de kardex propio que conservar (el descuento es al confirmar), así que el
    // reemplazo total es correcto y simple.
    if (datos.lineas !== undefined) {
      await validarRenglones(tx, idEmpresa, datos.lineas);
      await tx.notaSalidaLinea.deleteMany({ where: { idNotaSalida: id } });
      await crearRenglones(tx, sesion, id, datos.lineas);
    }

    await registrarBitacora(tx, sesion, {
      entidad: 'NotaSalida',
      idEntidad: id,
      accion: 'MODIFICAR',
      datos: { encabezado: true, lineas: datos.lineas?.length },
    });
  }, bd);

  return obtenerNotaSalida(sesion, id, bd);
}

/**
 * CONFIRMA una nota de salida (de `borrador` a `confirmada`) en UNA transacción (A2). Por cada
 * renglón de AVÍO genera el movimiento de SALIDA del kardex (`salida-por-nota`, R4) desde el almacén
 * ORIGEN del ENCABEZADO de la nota (`nota.idAlmacen`, decisión (g) de Daniel — un almacén por nota,
 * elegido y validado al crear), validando no-negativo bajo lock (D3); guarda el `idMovimientoAvio` en
 * el renglón. Los renglones de TELA NO mueven kardex (decisión (e) — ya quedaron ligados a su
 * salida-a-orden); el ANTI-DOBLE-DESCUENTO se garantiza porque la nota NUNCA descuenta tela. Sella
 * `confirmadaEn`/`confirmadaPorId` + bitácora. Una nota ya confirmada o cancelada no se re-confirma.
 * El almacén ya NO se pasa aquí: sale del encabezado (validado al crear/editar). Permiso
 * `notas.administrar`.
 */
export async function confirmarNotaSalida(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<NotaSalidaSalida> {
  verificarPermiso(sesion, 'notas.administrar');
  const idEmpresa = sesion.idEmpresaActiva;

  await enTransaccion(async (tx) => {
    // Serializa el read-modify-write del estatus contra confirmaciones concurrentes de la MISMA nota
    // (la 2ª espera al commit de la 1ª y ya verá `confirmada` → se rechaza, sin doble descuento de
    // avíos ni movimientos huérfanos). Se toma ANTES de leer el estatus.
    await bloquearNotaSalida(tx, id);
    const nota = await tx.notaSalida.findFirst({
      where: { id, idEmpresa },
      select: {
        id: true,
        numNota: true,
        estatus: true,
        idAlmacen: true,
        fechaElaboracion: true,
        lineas: {
          select: { id: true, idAvio: true, idTela: true, cantidad: true },
          orderBy: { id: 'asc' },
        },
      },
    });
    if (nota === null) {
      throw new ErrorNoEncontrado('NotaSalida', id);
    }
    if (nota.estatus !== EstatusNotaSalida.borrador) {
      throw new ErrorConflicto(
        `La nota de salida ${Number(nota.numNota)} ya está ${nota.estatus}; solo se confirma desde borrador.`,
      );
    }

    // Almacén ORIGEN del encabezado (decisión g): de aquí salen los avíos. Validado al crear/editar,
    // pero un almacén puede DESACTIVARSE entre el borrador y la confirmación: se re-valida aquí (mismo
    // helper y firma que crear/editar), antes de descontar, para no sacar de un almacén inactivo.
    await exigirAlmacen(tx, nota.idAlmacen, idEmpresa);
    const idAlmacen = nota.idAlmacen;
    const renglonesAvio = nota.lineas.filter((l) => l.idAvio !== null);
    if (renglonesAvio.length > 0) {
      // esGenerico de cada avío (se copia al detalle del kardex, R4) — en lote.
      const idsAvio = renglonesAvio.map((l) => l.idAvio as number);
      const avios = await tx.avio.findMany({
        where: { id: { in: idsAvio } },
        select: { id: true, esGenerico: true },
      });
      const esGenericoPorAvio = new Map(avios.map((a) => [a.id, a.esGenerico]));

      // Agrega cantidades por avío (un mismo avío puede aparecer en >1 renglón de la nota) para
      // validar no-negativo contra el TOTAL que la nota va a sacar (no renglón por renglón).
      const cantidadPorAvio = new Map<number, number>();
      for (const l of renglonesAvio) {
        const idAvio = l.idAvio as number;
        cantidadPorAvio.set(idAvio, (cantidadPorAvio.get(idAvio) ?? 0) + Number(l.cantidad));
      }
      // No dejar negativo (D3): suma directa bajo lock, en orden determinista (por avío).
      const ordenados = [...cantidadPorAvio.entries()].sort((a, b) => a[0] - b[0]);
      for (const [idAvio, cantidad] of ordenados) {
        await bloquearAvio(tx, idEmpresa, idAlmacen, idAvio);
        const existencia = await existenciaAvioBloqueada(tx, idEmpresa, idAlmacen, idAvio);
        if (existencia - cantidad < 0) {
          throw new ErrorConflicto(
            `No hay existencia suficiente del avío ${idAvio}: se intentan sacar ${cantidad} de ` +
              `${existencia} en existencia (no se permite dejar el inventario en negativo).`,
          );
        }
      }

      // Un movimiento `salida-por-nota` POR renglón de avío (cada renglón guarda su propio
      // `idMovimientoAvio` para poder reversarlo al cancelar). El no-negativo ya se validó por total.
      const tipoSalida = await tipoPorCodigo(tx, COD_SALIDA_POR_NOTA);
      const fecha = nota.fechaElaboracion;
      for (const l of renglonesAvio) {
        const idAvio = l.idAvio as number;
        const lineas: LineaMovimientoAvio[] = [
          {
            idAvio,
            esGenerico: esGenericoPorAvio.get(idAvio) ?? false,
            cantidad: Number(l.cantidad),
          },
        ];
        const movimiento = await registrarMovimientoAvio(
          sesion,
          {
            idEmpresa,
            idTipoMov: tipoSalida.id,
            idAlmacen,
            fecha,
            origenTipo: ORIGEN.notaSalida,
            origenId: String(nota.id),
            lineas,
            observaciones: `Nota de salida ${Number(nota.numNota)}`,
          },
          { tx },
        );
        await tx.notaSalidaLinea.update({
          where: { id: l.id },
          data: { idMovimientoAvio: movimiento.id, ...datosModificacion(sesion) },
        });
      }
    }

    await tx.notaSalida.update({
      where: { id },
      data: {
        estatus: EstatusNotaSalida.confirmada,
        confirmadaEn: new Date(),
        confirmadaPorId: sesion.id,
        ...datosModificacion(sesion),
      },
    });

    await registrarBitacora(tx, sesion, {
      entidad: 'NotaSalida',
      idEntidad: id,
      accion: 'OTRO',
      datos: {
        confirmada: true,
        numNota: Number(nota.numNota),
        aviosDescontados: renglonesAvio.length,
        idAlmacen,
      },
    });

    // OUTBOX (post-F9): la confirmación de la nota completa el proceso RC `surtidoAvios` de las órdenes
    // de sus líneas de avío. El consumidor relee el estado físico; se emite por orden afectada.
    await emitirSurtidoAvios(tx, idEmpresa, id);
  }, bd);

  dispararPublicacion();
  return obtenerNotaSalida(sesion, id, bd);
}

/**
 * Cancela una nota de salida (cancelación SUAVE, D3) en UNA transacción (A2). Si la nota estaba
 * CONFIRMADA, reversa SOLO los movimientos de avío que generó (`salida-por-nota` → inverso
 * `ajuste-entrada` auditado, NADA se borra); la TELA NUNCA se toca (su salida-a-orden de E1 sigue
 * viva). Si estaba en borrador, no hay movimientos que reversar. Sella `canceladaEn`/`canceladaPorId`
 * + `motivoCancelacion` (OBLIGATORIO) + bitácora CANCELAR. Cancelar dos veces es conflicto. Permiso
 * PROPIO `notas.cancelar`.
 */
export async function cancelarNotaSalida(
  sesion: SesionUsuario,
  id: number,
  cuerpo: CuerpoCancelarNota,
  bd?: ContextoBd,
): Promise<NotaSalidaSalida> {
  verificarPermiso(sesion, 'notas.cancelar');
  const datos = validarEntrada(esquemaNotaSalidaCancelarCuerpo, cuerpo);
  const idEmpresa = sesion.idEmpresaActiva;

  await enTransaccion(async (tx) => {
    // Serializa contra confirmaciones/cancelaciones concurrentes de la MISMA nota (mismo lock que
    // confirmar): dos cancelaciones no doble-reversan los avíos, y una cancelación no corre a la par
    // de una confirmación. Se toma ANTES de leer el estatus.
    await bloquearNotaSalida(tx, id);
    const nota = await tx.notaSalida.findFirst({
      where: { id, idEmpresa },
      select: {
        id: true,
        numNota: true,
        estatus: true,
        lineas: { select: { idMovimientoAvio: true } },
      },
    });
    if (nota === null) {
      throw new ErrorNoEncontrado('NotaSalida', id);
    }
    if (nota.estatus === EstatusNotaSalida.cancelada) {
      throw new ErrorConflicto(`La nota de salida ${Number(nota.numNota)} ya está cancelada.`);
    }

    // Si estaba confirmada, reversa los movimientos de avío (inverso auditado, D3). La tela NO se
    // toca (su salida-a-orden sigue viva). En borrador no hay movimientos (idMovimientoAvio = null).
    let invertidos = 0;
    if (nota.estatus === EstatusNotaSalida.confirmada) {
      const tipoInverso = await tipoPorCodigo(tx, COD_AJUSTE_ENTRADA);
      for (const l of nota.lineas) {
        if (l.idMovimientoAvio !== null) {
          await cancelarMovimientoMaterial(sesion, l.idMovimientoAvio, tipoInverso.id, { tx });
          invertidos += 1;
        }
      }
    }

    await tx.notaSalida.update({
      where: { id },
      data: {
        estatus: EstatusNotaSalida.cancelada,
        canceladaEn: new Date(),
        canceladaPorId: sesion.id,
        motivoCancelacion: datos.motivo,
        ...datosModificacion(sesion),
      },
    });

    await registrarBitacora(tx, sesion, {
      entidad: 'NotaSalida',
      idEntidad: id,
      accion: 'CANCELAR',
      datos: { numNota: Number(nota.numNota), motivo: datos.motivo, aviosReversados: invertidos },
    });

    // OUTBOX (post-F9): al cancelar la nota, la RC re-evalúa `surtidoAvios` de las órdenes de sus
    // líneas de avío (si ya no queda una nota de avíos confirmada viva, se des-completa — decisión (f)).
    await emitirSurtidoAvios(tx, idEmpresa, id);
  }, bd);

  dispararPublicacion();
  return obtenerNotaSalida(sesion, id, bd);
}

// ── Consultas ────────────────────────────────────────────────────────────────────────────────────

/** Obtiene una nota (con todo su detalle) de la empresa activa, o lanza `ErrorNoEncontrado`. */
export async function obtenerNotaSalida(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<NotaSalidaSalida> {
  verificarPermiso(sesion, 'notas.ver');
  const nota = await clienteLectura(bd).notaSalida.findFirst({
    where: { id, idEmpresa: sesion.idEmpresaActiva },
    include: incluirDetalle,
  });
  if (nota === null) {
    throw new ErrorNoEncontrado('NotaSalida', id);
  }
  return aNotaSalida(nota);
}

/** Parámetros del listado (los reutiliza la ruta REST). */
export type ParametrosListarNotas = z.input<typeof esquemaListarNotasDominio>;

/**
 * Lista las notas de la empresa activa (A9) con búsqueda combinada y paginación EN SERVIDOR:
 *  • `busqueda`: folio (si es número) o nombre de maquilero (insensible a mayúsculas).
 *  • filtros por maquilero, estatus, y `idOrden` (notas que envían material a una orden de
 *    PRODUCCIÓN — consulta "Notas por orden", reemplaza NotasOrd). Por defecto NO incluye las
 *    canceladas. Cada nota trae su detalle embebido. Permiso `notas.ver`.
 */
export async function listarNotasSalida(
  sesion: SesionUsuario,
  parametros: ParametrosListarNotas = {},
  bd?: ContextoBd,
): Promise<NotasSalidaPagina> {
  verificarPermiso(sesion, 'notas.ver');
  const filtros = validarEntrada(esquemaListarNotasDominio, parametros);

  const where: Prisma.NotaSalidaWhereInput = {
    ...armarWhereNotas(sesion.idEmpresaActiva, filtros),
    ...(filtros.estatus === undefined ? {} : { estatus: filtros.estatus }),
    ...(filtros.estatus === undefined && !filtros.incluirCanceladas
      ? { estatus: { not: EstatusNotaSalida.cancelada } }
      : {}),
  };

  const cliente = clienteLectura(bd);
  const [total, datos] = await Promise.all([
    cliente.notaSalida.count({ where }),
    cliente.notaSalida.findMany({
      where,
      orderBy: { [filtros.ordenarPor]: filtros.direccion },
      include: incluirDetalle,
      ...rangoPrisma(filtros),
    }),
  ]);

  const salida = datos.map((n) => aNotaSalida(n));
  const pagina: Pagina<NotaSalidaSalida> = armarPagina(salida, total, filtros);
  return pagina;
}

/** Arma el `OR` de búsqueda: folio (si es entero) o nombre de maquilero. Vacío → sin OR. */
function armarBusqueda(busqueda: string | undefined): Prisma.NotaSalidaWhereInput {
  if (busqueda === undefined || busqueda === '') {
    return {};
  }
  const or: Prisma.NotaSalidaWhereInput[] = [
    { maquilero: { nombre: { contains: busqueda, mode: 'insensitive' } } },
  ];
  if (/^\d+$/.test(busqueda.trim())) {
    try {
      or.push({ numNota: BigInt(busqueda.trim()) });
    } catch {
      // No es un bigint válido; se ignora.
    }
  }
  return { OR: or };
}

/**
 * Arma el `where` del UNIVERSO de notas de la EMPRESA ACTIVA (A9) con los filtros comunes
 * (búsqueda/maquilero/orden). Compartido por el listado y el resumen de cabecera para no derivar
 * el mismo universo de dos maneras distintas (mismo patrón que `armarWhereAuditorias`). El
 * ESTATUS no entra aquí: el listado lo agrega encima y el resumen desglosa por estatus él mismo.
 */
function armarWhereNotas(
  idEmpresa: number,
  filtros: {
    busqueda?: string | undefined;
    idMaquilero?: number | undefined;
    idOrden?: number | undefined;
  },
): Prisma.NotaSalidaWhereInput {
  return {
    idEmpresa,
    ...(filtros.idMaquilero === undefined ? {} : { idMaquilero: filtros.idMaquilero }),
    // Notas ligadas a una orden de PRODUCCIÓN (consulta "Notas por orden"): vía sus renglones.
    ...(filtros.idOrden === undefined ? {} : { lineas: { some: { idOrden: filtros.idOrden } } }),
    ...armarBusqueda(filtros.busqueda),
  };
}

/**
 * Filtros del resumen con tipos NATIVOS (la ruta ya coaccionó la querystring). Sub-conjunto de los
 * del listado que ACOTA el universo (búsqueda/maquilero/orden); el estatus NO entra (el resumen
 * desglosa por estatus él mismo — mismo criterio que el resumen de OC).
 */
const esquemaResumenNotasDominio = z.object({
  busqueda: z.string().trim().max(200).optional(),
  idMaquilero: z.number().int().positive().optional(),
  idOrden: z.number().int().positive().optional(),
});

/** Parámetros del resumen (los reutiliza la ruta REST). */
export type ParametrosResumenNotas = z.input<typeof esquemaResumenNotasDominio>;

/**
 * Resumen de cabecera de notas de salida (KPIs `vNotasSalida`, R9), agregado EN SERVIDOR (A1)
 * sobre el MISMO universo del listado (`armarWhereNotas` — no una derivación distinta):
 *  • `notas` — TODAS las del filtro (borradores + confirmadas + canceladas; el desglose aclara).
 *  • `borradores` / `confirmadas` — conteo por estatus (UN groupBy).
 *  • `ordenesSurtidas` — órdenes de producción DISTINTAS en renglones de notas CONFIRMADAS del
 *    universo (las canceladas ya devolvieron el material y los borradores aún no descuentan).
 * Permiso `notas.ver` (REUSADO — el resumen no muestra nada que el listado no muestre); todo
 * acotado por la empresa activa (A9).
 */
export async function resumenNotasSalida(
  sesion: SesionUsuario,
  parametros: ParametrosResumenNotas = {},
  bd?: ContextoBd,
): Promise<ResumenNotasSalida> {
  verificarPermiso(sesion, 'notas.ver');
  const filtros = validarEntrada(esquemaResumenNotasDominio, parametros);
  const cliente = clienteLectura(bd);
  const whereNotas = armarWhereNotas(sesion.idEmpresaActiva, filtros);

  const [porEstatus, ordenesDistintas] = await Promise.all([
    cliente.notaSalida.groupBy({
      by: ['estatus'],
      where: whereNotas,
      _count: { _all: true },
    }),
    // Una fila por orden DISTINTA con renglones en notas confirmadas del universo.
    cliente.notaSalidaLinea.groupBy({
      by: ['idOrden'],
      where: { notaSalida: { ...whereNotas, estatus: EstatusNotaSalida.confirmada } },
    }),
  ]);

  let notas = 0;
  let borradores = 0;
  let confirmadas = 0;
  for (const g of porEstatus) {
    notas += g._count._all;
    if (g.estatus === EstatusNotaSalida.borrador) borradores = g._count._all;
    if (g.estatus === EstatusNotaSalida.confirmada) confirmadas = g._count._all;
  }

  return { notas, borradores, confirmadas, ordenesSurtidas: ordenesDistintas.length };
}

// Re-export para que el reviewer/tests vean el helper de tipo de renglón sin re-implementarlo.
export { esRenglonAvio };
