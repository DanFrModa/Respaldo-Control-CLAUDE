/**
 * RECEPCIÓN de compras (Módulo COMPRAS, F4-E3 — doc `Documentacion_MJD/03-Produccion.md` §OC;
 * REQUISITOS-NUEVOS.md §R7). La recepción es el HECHO que conecta la orden de compra con el kardex
 * de materiales: recibe (parcial o total) el material de una OC AUTORIZADA, crea el lote de la tela
 * (D5), registra la ENTRADA al kardex (`entrada-recepcion`) con cantidad y costo YA convertidos a
 * unidad de consumo (R1, motor `comun/conversion.ts`), y recalcula el estatus de la OC
 * (parcial/total, R7). Toda la lógica vive AQUÍ (A1); las rutas REST solo validan permiso + Zod y
 * delegan. Esta capa ORQUESTA el motor de kardex (`comun/kardex.ts`) — el ÚNICO que escribe
 * `Movimiento`/`MovimientoDet*`.
 *
 * Innegociables aplicados:
 *  • A1 — la lógica vive en este módulo de dominio; las rutas son delgadas.
 *  • A2 — TODO en UNA transacción: carga OC, folio, crea recepción + renglones, crea lote(s),
 *    mueve kardex, recalcula estatus de la OC, escribe bitácora e inserta el evento outbox. O todo
 *    o nada (si falla la creación del lote/movimiento NO queda recepción ni movimiento — rollback).
 *  • A3 — folio de recepción por secuencia atómica (`siguienteFolio`, clave "recepcion-compra").
 *  • A4 — `compras.recibir` re-verificado aquí (defensa en profundidad, deny-by-default).
 *  • A7 — auditoría (`creadoPorId`/…) + `Bitacora` en la misma tx.
 *  • A9 — todo se filtra/sella por la empresa ACTIVA de la sesión.
 *  • D1 — el costo entra como costo por unidad de consumo (precio ÷ factor); la valuación cuadra
 *    (cantidadConsumo × costoUnit == cantidadPresentación × precio — invariante de
 *    `comun/conversion.ts`).
 *  • D3 — la existencia es Σ de movimientos; el reverso NO edita/borra — genera el movimiento
 *    INVERSO auditado (`cancelarMovimientoMaterial`).
 *  • D5 — un lote define el color/teñido y agrupa 1..N telas acompañantes (mismo color).
 *
 * DECISIÓN (b), DECISIONES.md: SOLO se recibe contra una OC en estatus `autorizada` o
 * `recibida_parcial`. Cualquier otro estatus → `ErrorConflicto` (server-side, A4).
 *
 * FACTOR de conversión (R1): el factor "fino" por proveedor vive en `AvioProveedor.factorConversion`
 * (fallback `Avio.factorConversion`, fallback 1). Para TELAS NO existe campo de factor presentación→
 * consumo (la tela se compra en su unidad de uso): el factor es SIEMPRE 1 (la cantidad/precio de la
 * OC ya están en la unidad de consumo). Por eso `convertirLineaCompra` se llama sin factores para
 * tela → identidad.
 */
import {
  esquemaRecepcionCrear,
  esquemaRecepcionReversarCuerpo,
  type DatosRecepcionLoteEntrada,
  type RecepcionLineaSalida,
  type RecepcionSalida,
  type RecepcionesLista,
} from '../../contrato/index.js';
import type { Prisma } from '../../datos/index.js';
import { EstatusOrdenCompra } from '../../datos/index.js';
import type { z } from 'zod';

import { exigirAlmacen } from '../../comun/almacenes.js';
import { datosCreacion, datosModificacion, registrarBitacora } from '../../comun/auditoria.js';
import { dispararPublicacion } from '../../comun/cola-eventos.js';
import { convertirLineaCompra } from '../../comun/conversion.js';
import { ErrorConflicto, ErrorNoEncontrado, ErrorValidacion } from '../../comun/errores.js';
import {
  EVENTOS_OUTBOX,
  VERSION_EVENTO_ETAPA_RC,
  VERSION_MATERIAL_RECIBIDO,
  registrarEventoOutbox,
  type EventoMaterialRecibido,
  type EventoMaterialRecibidoCancelado,
} from '../../comun/eventos-dominio.js';
import {
  cancelarMovimientoMaterial,
  registrarMovimientoAvio,
  registrarMovimientoTela,
  type LineaMovimientoAvio,
  type LineaMovimientoTela,
} from '../../comun/kardex.js';
import { ORIGEN } from '../../comun/origenes.js';
import { verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import { siguienteFolio } from '../../comun/secuencias.js';
import {
  clienteLectura,
  enTransaccion,
  type ContextoBd,
  type Tx,
} from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';

/** Clave de la secuencia de folios de recepciones de compra (A3 — por empresa). */
export const CLAVE_SECUENCIA_RECEPCION = 'recepcion-compra';

/** Código del tipo de movimiento de ENTRADA por recepción de compra (sembrado en F4-E1). */
const COD_ENTRADA_RECEPCION = 'entrada-recepcion';
/** Tipo inverso para neutralizar una entrada de recepción al reversar (dirección salida). */
const COD_AJUSTE_SALIDA = 'ajuste-salida';

/** Estatus de OC desde los que SE PUEDE recibir (decisión b). */
const ESTATUS_RECIBIBLES: readonly string[] = ['autorizada', 'recibida_parcial'];

/** Entrada de alta de recepción (forma del contrato). */
export type EntradaRecibirCompra = z.input<typeof esquemaRecepcionCrear>;

// ── Helpers ──────────────────────────────────────────────────────────────────────────────────────

/** Convierte un `YYYY-MM-DD` al `Date` UTC que Prisma guarda en `@db.Date`. */
function aDateColumna(valor: string): Date {
  return new Date(`${valor}T00:00:00.000Z`);
}

/** Convierte un Decimal de Prisma (o null) a number (o null). */
function aNumero(valor: Prisma.Decimal | null): number | null {
  return valor === null ? null : Number(valor);
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
 * Espacio de nombres del advisory lock de la OC (B2): se mezcla con `idOrdenCompra` en la clave
 * `bigint` para que el lock no colisione con NINGÚN otro lock del sistema. CLAVE: los locks del
 * kardex usan la forma de DOS argumentos `pg_advisory_xact_lock(int4, int4)` (empresa×almacén /
 * artículo); este usa la forma de UN argumento `pg_advisory_xact_lock(bigint)`, que en Postgres
 * ocupa un ESPACIO DE LOCKS DISTINTO del de dos argumentos → imposible que colisionen, sin importar
 * el valor. El namespace solo separa este lock de futuros locks `bigint` por otra entidad.
 */
const NS_LOCK_ORDEN_COMPRA = 0x4f43n; // "OC" en hex, como discriminador del namespace.

/**
 * Serializa el read-modify-write del ESTATUS de una OC (R7) tomando un advisory lock TRANSACCIONAL
 * por `idOrdenCompra` (B2). Dos recepciones/reversos concurrentes de la MISMA OC se serializan: el
 * segundo espera al commit del primero, así su `groupBy` posterior ya ve la suma real y no quedan
 * dos "parcial" cuando el total ya está completo. Se toma al ENTRAR a la operación, ANTES de leer
 * las sumas. El lock se libera solo al terminar la transacción (no hay que soltarlo a mano).
 *
 * Clave `bigint` = (namespace << 32) | idOrdenCompra: única por OC y en un espacio de locks que no
 * comparte con los del kardex (que usan la forma de dos enteros).
 */
async function bloquearOrdenCompra(tx: Tx, idOrdenCompra: number): Promise<void> {
  const clave = (NS_LOCK_ORDEN_COMPRA << 32n) | BigInt(idOrdenCompra);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${clave}::bigint)`;
}

/**
 * Genera una clave de lote legible cuando la recepción no la trae. Lleva el sello de tiempo + un
 * sufijo aleatorio corto para que dos recepciones en el MISMO milisegundo no colisionen en la clave
 * única `Lote.clave` (mismo criterio que `crearLoteAjuste` de F4-E1). No es un folio de negocio.
 */
function claveLoteAuto(idEmpresa: number, fecha: string): string {
  const sello = Date.now().toString(36);
  const sufijo = Math.random().toString(36).slice(2, 6);
  return `REC-${idEmpresa}-${fecha.replaceAll('-', '')}-${sello}-${sufijo}`;
}

// ── Tipos de la OC cargada para recibir ──────────────────────────────────────────────────────────

type OCLineaParaRecepcion = {
  id: number;
  idTela: number | null;
  idAvio: number | null;
  idAvioProveedor: number | null;
  descripcionLibre: string | null;
  cantidad: Prisma.Decimal;
  precio: Prisma.Decimal;
  idOrden: number | null;
};

type OCParaRecepcion = {
  id: number;
  numCompra: bigint;
  idEmpresa: number;
  idProveedor: number;
  estatus: string;
  lineas: OCLineaParaRecepcion[];
};

/**
 * Resuelve el FACTOR de conversión presentación→consumo de una línea de OC de AVÍO (R1):
 * `AvioProveedor.factorConversion` (por proveedor de la OC) → `Avio.factorConversion` → 1. Para
 * telas y libres NO aplica (factor 1). Una sola lectura por línea de avío (acotado: una recepción
 * tiene pocas líneas).
 */
async function factorAvioLinea(
  tx: Tx,
  idAvio: number,
  idProveedor: number,
): Promise<{ factorProveedor: number | null; factorAvio: number | null }> {
  const [avio, avioProv] = await Promise.all([
    tx.avio.findUnique({ where: { id: idAvio }, select: { factorConversion: true } }),
    tx.avioProveedor.findUnique({
      where: { idAvio_idProveedor: { idAvio, idProveedor } },
      select: { factorConversion: true },
    }),
  ]);
  return {
    factorProveedor: avioProv?.factorConversion == null ? null : Number(avioProv.factorConversion),
    factorAvio: avio?.factorConversion == null ? null : Number(avio.factorConversion),
  };
}

/**
 * Crea el LOTE de una recepción de TELA (D5) y devuelve la línea de kardex por componente (todas con
 * el mismo idLote). El lote define el color; los componentes son las telas que llegaron.
 *
 * VALUACIÓN (M2 — reviewer F4-E3): el `costoUnit` (precio÷factor de la tela COMPRADA en la línea de
 * OC, D1) se asigna SOLO al componente de esa tela; los ACOMPAÑANTES (`idTela ≠ idTelaComprada`)
 * entran con `costoUnit = NULL`. Así la valuación del lote = el total de la línea de OC (no se infla
 * cobrando el acompañante como si se hubiera pagado). Decisión PROVISIONAL registrada en
 * `DECISIONES.md` §F4, a confirmar con Daniel antes de que F7 valúe inventario. Hereda
 * proveedor/factura de la recepción si el lote no los trae.
 */
async function crearLoteRecepcion(
  tx: Tx,
  sesion: SesionUsuario,
  idEmpresa: number,
  fechaRecepcion: string,
  facturaRecepcion: string | null,
  idProveedorOC: number,
  lote: DatosRecepcionLoteEntrada,
  idTelaComprada: number,
  costoUnit: number,
): Promise<{ idLote: number; lineas: LineaMovimientoTela[] }> {
  const clave = lote.clave?.trim() || claveLoteAuto(idEmpresa, fechaRecepcion);
  const idsTela = lote.componentes.map((c) => c.idTela);
  if (new Set(idsTela).size !== idsTela.length) {
    throw new ErrorValidacion('Una tela no puede aparecer dos veces en los componentes del lote.');
  }
  const existe = await tx.lote.findUnique({ where: { clave }, select: { id: true } });
  if (existe !== null) {
    throw new ErrorConflicto(`Ya existe un lote con la clave "${clave}".`);
  }
  const creado = await tx.lote.create({
    data: {
      clave,
      idColor: lote.idColor,
      idProveedor: lote.idProveedor ?? idProveedorOC,
      ...(lote.factura !== undefined
        ? { factura: lote.factura }
        : facturaRecepcion === null
          ? {}
          : { factura: facturaRecepcion }),
      ...(lote.fecha === undefined
        ? { fecha: aDateColumna(fechaRecepcion) }
        : { fecha: aDateColumna(lote.fecha) }),
      ...(lote.observaciones === undefined ? {} : { observaciones: lote.observaciones }),
      componentes: {
        create: lote.componentes.map((c) => ({
          idTela: c.idTela,
          cantidad: c.cantidad,
          ...(c.peso === undefined ? {} : { peso: c.peso }),
        })),
      },
      ...datosCreacion(sesion),
    },
  });
  await registrarBitacora(tx, sesion, {
    entidad: 'Lote',
    idEntidad: creado.id,
    accion: 'CREAR',
    datos: {
      clave,
      idColor: lote.idColor,
      componentes: lote.componentes.length,
      origen: 'recepcion',
    },
  });
  return {
    idLote: creado.id,
    lineas: lote.componentes.map((c) => ({
      idTela: c.idTela,
      idLote: creado.id,
      cantidad: c.cantidad,
      // Solo la tela comprada lleva el costo de la línea de OC; los acompañantes entran sin costo
      // (NULL) para no inflar la valuación del lote (M2 — decisión provisional, DECISIONES.md §F4).
      costoUnit: c.idTela === idTelaComprada ? costoUnit : null,
    })),
  };
}

// ── Proyección a la salida ───────────────────────────────────────────────────────────────────────

const incluirRecepcion = {
  almacen: { select: { nombre: true } },
  ordenCompra: { select: { numCompra: true } },
  lineas: {
    orderBy: { id: 'asc' },
    include: {
      ordenCompraLinea: {
        select: {
          idTela: true,
          idAvio: true,
          descripcionLibre: true,
          tela: { select: { nombre: true } },
          avio: { select: { clave: true, descripcion: true } },
        },
      },
      lote: { select: { clave: true } },
      movimiento: { select: { folio: true } },
    },
  },
} satisfies Prisma.RecepcionCompraInclude;

type RecepcionConDetalle = Prisma.RecepcionCompraGetPayload<{ include: typeof incluirRecepcion }>;

/** Proyecta una recepción (con detalle) a la forma del contrato. */
function aRecepcionSalida(r: RecepcionConDetalle): RecepcionSalida {
  const lineas: RecepcionLineaSalida[] = r.lineas.map((l) => {
    const ocl = l.ordenCompraLinea;
    const tipo: 'tela' | 'avio' | 'libre' =
      ocl.idTela !== null ? 'tela' : ocl.idAvio !== null ? 'avio' : 'libre';
    return {
      id: l.id,
      idOrdenCompraLinea: l.idOrdenCompraLinea,
      tipo,
      idTela: ocl.idTela,
      tela: ocl.tela?.nombre ?? null,
      idAvio: ocl.idAvio,
      avio: ocl.avio === null ? null : `${ocl.avio.clave} — ${ocl.avio.descripcion}`,
      descripcionLibre: ocl.descripcionLibre,
      cantidadRecibida: Number(l.cantidadRecibida),
      costoUnit: aNumero(l.costoUnit),
      idLote: l.idLote,
      loteClave: l.lote?.clave ?? null,
      idMovimiento: l.idMovimiento,
      folioMovimiento: l.movimiento === null ? null : Number(l.movimiento.folio),
    };
  });

  return {
    id: r.id,
    folio: Number(r.folio),
    idEmpresa: r.idEmpresa,
    idOrdenCompra: r.idOrdenCompra,
    numCompra: Number(r.ordenCompra.numCompra),
    idAlmacen: r.idAlmacen,
    almacen: r.almacen.nombre,
    factura: r.factura,
    fecha: r.fecha.toISOString().slice(0, 10),
    observaciones: r.observaciones,
    reversada: r.reversadaEn !== null,
    reversadaEn: r.reversadaEn === null ? null : r.reversadaEn.toISOString(),
    reversadaPorId: r.reversadaPorId,
    motivoReverso: r.motivoReverso,
    lineas,
    creadoEn: r.creadoEn.toISOString(),
    creadoPorId: r.creadoPorId,
  };
}

/** Obtiene una recepción (con detalle) de la empresa activa, o lanza (A9). */
async function obtenerRecepcion(
  idRecepcion: number,
  idEmpresa: number,
  bd?: ContextoBd,
): Promise<RecepcionSalida> {
  const r = await clienteLectura(bd).recepcionCompra.findFirst({
    where: { id: idRecepcion, idEmpresa },
    include: incluirRecepcion,
  });
  if (r === null) {
    throw new ErrorNoEncontrado('RecepcionCompra', idRecepcion);
  }
  return aRecepcionSalida(r);
}

// ── Recálculo del estatus de la OC (R7) ──────────────────────────────────────────────────────────

/** Tolerancia por redondeo decimal (cantidadRecibida con 4 decimales). */
const TOLERANCIA_RECEPCION = 1e-6;

/**
 * Calcula el estatus de recepción de una OC a partir de las cantidades pedidas y lo recibido por
 * línea (FUNCIÓN PURA — sin BD, unit-testeable). Robusto a recepciones acumuladas (el llamador ya
 * sumó lo recibido por línea de TODAS las recepciones activas). Reglas (R7):
 *  • Una línea está completa si Σ recibido ≥ su cantidad pedida (con tolerancia de redondeo).
 *  • TODAS completas → `recibida_total`; algo recibido pero no todo → `recibida_parcial`;
 *    nada recibido → `autorizada` (caso del reverso total).
 *
 * @param lineas       cantidad PEDIDA por línea de OC (`id` + `pedido`).
 * @param recibidoPorLinea  Σ recibido (unidad de consumo) por id de línea de OC.
 */
export function calcularEstatusRecepcion(
  lineas: { id: number; pedido: number }[],
  recibidoPorLinea: Map<number, number>,
): EstatusOrdenCompra {
  let algoRecibido = false;
  let todasCompletas = true;
  for (const linea of lineas) {
    const recibido = recibidoPorLinea.get(linea.id) ?? 0;
    if (recibido > 0) algoRecibido = true;
    if (recibido + TOLERANCIA_RECEPCION < linea.pedido) todasCompletas = false;
  }
  return !algoRecibido
    ? EstatusOrdenCompra.autorizada
    : todasCompletas
      ? EstatusOrdenCompra.recibida_total
      : EstatusOrdenCompra.recibida_parcial;
}

/** Datos de la OC que necesita el recálculo de estatus (los provee el llamador, ya cargados). */
interface OCParaEstatus {
  id: number;
  estatus: string;
  lineas: { id: number; pedido: number }[];
}

/**
 * Recalcula y PERSISTE el estatus de la OC comparando Σ(recibido por línea, en unidad de consumo)
 * contra la cantidad pedida de cada línea (R7). Robusto a MÚLTIPLES recepciones acumuladas: suma
 * TODAS las recepciones ACTIVAS (no reversadas) de la OC. Solo cambia el estatus cuando es uno de
 * `autorizada`/`recibida_*` (no toca borrador/pendiente/cancelada). El cálculo lo hace la función
 * pura {@link calcularEstatusRecepcion}. Recibe la OC YA CARGADA (id/estatus/líneas) para no releer
 * la OC (el llamador ya la tiene; reviewer F4-E3). DEBE llamarse bajo el lock de la OC (B2:
 * {@link bloquearOrdenCompra}) para que el `groupBy` vea la suma real bajo concurrencia.
 */
async function recalcularEstatusOC(
  tx: Tx,
  sesion: SesionUsuario,
  oc: OCParaEstatus,
): Promise<void> {
  if (!['autorizada', 'recibida_parcial', 'recibida_total'].includes(oc.estatus)) {
    return; // no se recalcula en borrador/pendiente/cancelada.
  }

  // Σ recibido por línea de OC, sumando solo recepciones ACTIVAS (reversadaEn = null).
  const sumas = await tx.recepcionCompraLinea.groupBy({
    by: ['idOrdenCompraLinea'],
    where: { recepcionCompra: { idOrdenCompra: oc.id, reversadaEn: null } },
    _sum: { cantidadRecibida: true },
  });
  const recibidoPorLinea = new Map<number, number>();
  for (const s of sumas) {
    recibidoPorLinea.set(s.idOrdenCompraLinea, Number(s._sum.cantidadRecibida ?? 0));
  }

  const nuevo = calcularEstatusRecepcion(oc.lineas, recibidoPorLinea);
  if (nuevo !== oc.estatus) {
    await tx.ordenCompra.update({
      where: { id: oc.id },
      data: { estatus: nuevo, ...datosModificacion(sesion) },
    });
    await registrarBitacora(tx, sesion, {
      entidad: 'OrdenCompra',
      idEntidad: oc.id,
      accion: 'OTRO',
      datos: { estatusRecepcion: nuevo, anterior: oc.estatus },
    });
  }
}

// ── Operación: RECIBIR ───────────────────────────────────────────────────────────────────────────

/**
 * Recibe (parcial o total) el material de una OC AUTORIZADA en UNA transacción (A2). Pasos:
 *  1. Carga la OC + líneas de la empresa activa (A9); valida estatus `autorizada`/`recibida_parcial`
 *     (decisión b) o rechaza.
 *  2. Folio de recepción (A3) y alta de `RecepcionCompra`.
 *  3. Por cada renglón recibido: valida que el renglón sea de la OC; convierte cantidad/costo a
 *     unidad de consumo (R1); para TELA crea el lote (D5) y registra la entrada al kardex de tela;
 *     para AVÍO registra la entrada al kardex de avío; para LIBRE solo registra el renglón (no
 *     inventaría). Persiste `RecepcionCompraLinea` con la traza (lote/movimiento, costo).
 *  4. Recalcula el estatus de la OC (parcial/total, R7).
 *  5. Bitácora (A7) + inserta el evento `material-recibido` en el OUTBOX (misma tx, ADR-0011).
 *  6. Tras el commit, dispara el relay (publish best-effort).
 *
 * Permiso `compras.recibir` (A4). @see REQUISITOS-NUEVOS.md §R7, D5, D1, D3, A2, A3, A7.
 */
export async function recibirCompra(
  sesion: SesionUsuario,
  entrada: EntradaRecibirCompra,
  bd?: ContextoBd,
): Promise<RecepcionSalida> {
  verificarPermiso(sesion, 'compras.recibir');
  const datos = validarEntrada(esquemaRecepcionCrear, entrada);
  const idEmpresa = sesion.idEmpresaActiva;

  const idRecepcion = await enTransaccion(async (tx) => {
    // B2: serializa el read-modify-write del estatus de ESTA OC contra recepciones/reversos
    // concurrentes (lock por idOrdenCompra, tomado ANTES de leer la OC y sus sumas).
    await bloquearOrdenCompra(tx, datos.idOrdenCompra);

    const oc = (await tx.ordenCompra.findFirst({
      where: { id: datos.idOrdenCompra, idEmpresa },
      select: {
        id: true,
        numCompra: true,
        idEmpresa: true,
        idProveedor: true,
        estatus: true,
        lineas: {
          select: {
            id: true,
            idTela: true,
            idAvio: true,
            idAvioProveedor: true,
            descripcionLibre: true,
            cantidad: true,
            precio: true,
            idOrden: true,
          },
        },
      },
    })) as OCParaRecepcion | null;
    if (oc === null) {
      throw new ErrorNoEncontrado('OrdenCompra', datos.idOrdenCompra);
    }
    // DECISIÓN (b): no se recibe contra una OC no autorizada (server-side, A4).
    if (!ESTATUS_RECIBIBLES.includes(oc.estatus)) {
      throw new ErrorConflicto(
        `No se puede recibir contra la orden de compra ${Number(oc.numCompra)} en estatus ` +
          `"${oc.estatus}": solo se recibe en "autorizada" o "recibida_parcial".`,
      );
    }
    // B1/A9: el almacén destino debe existir, estar activo y ser global o de esta empresa (un
    // almacén privado de otra empresa, para esta sesión, no existe). ANTES de cualquier escritura.
    await exigirAlmacen(tx, datos.idAlmacen, idEmpresa);

    const lineasPorId = new Map(oc.lineas.map((l) => [l.id, l]));
    // Un renglón de OC no se puede recibir dos veces EN LA MISMA recepción (sería ambiguo).
    const vistos = new Set<number>();
    for (const linea of datos.lineas) {
      if (vistos.has(linea.idOrdenCompraLinea)) {
        throw new ErrorValidacion(
          `El renglón de OC ${linea.idOrdenCompraLinea} aparece dos veces en la recepción.`,
        );
      }
      vistos.add(linea.idOrdenCompraLinea);
      if (!lineasPorId.has(linea.idOrdenCompraLinea)) {
        throw new ErrorNoEncontrado('OrdenCompraLinea', linea.idOrdenCompraLinea);
      }
    }

    const folio = await siguienteFolio(tx, idEmpresa, CLAVE_SECUENCIA_RECEPCION);
    const recepcion = await tx.recepcionCompra.create({
      data: {
        folio,
        idEmpresa,
        idOrdenCompra: oc.id,
        idAlmacen: datos.idAlmacen,
        factura: datos.factura ?? null,
        fecha: aDateColumna(datos.fecha),
        observaciones: datos.observaciones ?? null,
        ...datosCreacion(sesion),
      },
    });

    const tipoEntrada = await tipoPorCodigo(tx, COD_ENTRADA_RECEPCION);
    const materialesEvento: EventoMaterialRecibido['materiales'] = [];

    for (const lineaEntrada of datos.lineas) {
      const ocl = lineasPorId.get(lineaEntrada.idOrdenCompraLinea) as OCLineaParaRecepcion;
      const precio = Number(ocl.precio);

      if (ocl.idTela !== null) {
        // ── TELA: factor 1 (la tela se compra en su unidad de consumo, no hay presentación).
        if (lineaEntrada.lote === undefined) {
          throw new ErrorValidacion(
            `El renglón de tela ${ocl.id} necesita el lote (color + componentes) para recibirse (D5).`,
          );
        }
        // La tela del renglón de OC DEBE estar entre los componentes del lote (coherencia).
        if (!lineaEntrada.lote.componentes.some((c) => c.idTela === ocl.idTela)) {
          throw new ErrorValidacion(
            `El lote del renglón ${ocl.id} debe incluir la tela comprada (idTela ${String(ocl.idTela)}).`,
          );
        }
        const convertida = convertirLineaCompra(lineaEntrada.cantidad, precio); // factor 1 (tela)
        const { idLote, lineas } = await crearLoteRecepcion(
          tx,
          sesion,
          idEmpresa,
          datos.fecha,
          datos.factura ?? null,
          oc.idProveedor,
          lineaEntrada.lote,
          ocl.idTela, // tela comprada: solo ella lleva el costo (M2)
          convertida.costoUnitConsumo,
        );
        const movimiento = await registrarMovimientoTela(
          sesion,
          {
            idEmpresa,
            idTipoMov: tipoEntrada.id,
            idAlmacen: datos.idAlmacen,
            fecha: aDateColumna(datos.fecha),
            origenTipo: ORIGEN.recepcionCompra,
            origenId: String(recepcion.id),
            lineas,
            observaciones: `Recepción ${Number(folio)} (OC ${Number(oc.numCompra)})`,
          },
          { tx },
        );
        await tx.recepcionCompraLinea.create({
          data: {
            idRecepcionCompra: recepcion.id,
            idOrdenCompraLinea: ocl.id,
            cantidadRecibida: convertida.cantidadConsumo,
            costoUnit: convertida.costoUnitConsumo,
            idLote,
            idMovimiento: movimiento.id,
            ...datosCreacion(sesion),
          },
        });
        materialesEvento.push({
          tipo: 'tela',
          id: ocl.idTela,
          idLote,
          idOrdenCompraLinea: ocl.id,
          idOrden: ocl.idOrden,
        });
      } else if (ocl.idAvio !== null) {
        // ── AVÍO: factor por AvioProveedor → Avio → 1 (R1).
        const { factorProveedor, factorAvio } = await factorAvioLinea(
          tx,
          ocl.idAvio,
          oc.idProveedor,
        );
        const convertida = convertirLineaCompra(
          lineaEntrada.cantidad,
          precio,
          factorProveedor,
          factorAvio,
        );
        const lineas: LineaMovimientoAvio[] = [
          {
            idAvio: ocl.idAvio,
            cantidad: convertida.cantidadConsumo,
            costoUnit: convertida.costoUnitConsumo,
          },
        ];
        const movimiento = await registrarMovimientoAvio(
          sesion,
          {
            idEmpresa,
            idTipoMov: tipoEntrada.id,
            idAlmacen: datos.idAlmacen,
            fecha: aDateColumna(datos.fecha),
            origenTipo: ORIGEN.recepcionCompra,
            origenId: String(recepcion.id),
            lineas,
            observaciones: `Recepción ${Number(folio)} (OC ${Number(oc.numCompra)})`,
          },
          { tx },
        );
        await tx.recepcionCompraLinea.create({
          data: {
            idRecepcionCompra: recepcion.id,
            idOrdenCompraLinea: ocl.id,
            cantidadRecibida: convertida.cantidadConsumo,
            costoUnit: convertida.costoUnitConsumo,
            idMovimiento: movimiento.id,
            ...datosCreacion(sesion),
          },
        });
        materialesEvento.push({
          tipo: 'avio',
          id: ocl.idAvio,
          idLote: null,
          idOrdenCompraLinea: ocl.id,
          idOrden: ocl.idOrden,
        });
      } else {
        // ── LIBRE: no es material de catálogo → NO mueve kardex. Solo se registra la cantidad.
        await tx.recepcionCompraLinea.create({
          data: {
            idRecepcionCompra: recepcion.id,
            idOrdenCompraLinea: ocl.id,
            cantidadRecibida: lineaEntrada.cantidad,
            ...datosCreacion(sesion),
          },
        });
        materialesEvento.push({
          tipo: 'libre',
          id: null,
          idLote: null,
          idOrdenCompraLinea: ocl.id,
          idOrden: ocl.idOrden,
        });
      }
    }

    // Recalcula el estatus de la OC (parcial/total, R7) — robusto a recepciones acumuladas. Usa la
    // OC YA cargada (sin releerla) y corre bajo el lock tomado al entrar (B2).
    await recalcularEstatusOC(tx, sesion, {
      id: oc.id,
      estatus: oc.estatus,
      lineas: oc.lineas.map((l) => ({ id: l.id, pedido: Number(l.cantidad) })),
    });

    await registrarBitacora(tx, sesion, {
      entidad: 'RecepcionCompra',
      idEntidad: recepcion.id,
      accion: 'CREAR',
      datos: { folio: Number(folio), idOrdenCompra: oc.id, renglones: datos.lineas.length },
    });

    // OUTBOX (ADR-0011): el evento se escribe en la MISMA tx que el hecho de negocio (atómico).
    // `materialPrincipal` siempre existe: el esquema exige `lineas.min(1)` y cada renglón empuja un
    // material (tela/avío/libre), así que `materialesEvento` nunca está vacío (M4 — sin centinela).
    const materialPrincipal = materialesEvento[0];
    if (materialPrincipal === undefined) {
      // Inalcanzable (lineas.min(1) + un push por renglón): defensa por si el invariante cambiara.
      throw new ErrorValidacion('Una recepción necesita al menos un renglón.');
    }
    const evento: EventoMaterialRecibido = {
      idEmpresa,
      idOrdenCompra: oc.id,
      idRecepcion: recepcion.id,
      folioRecepcion: Number(folio),
      // `material` = el primer renglón (representativo, para consumidores simples); `materiales` = el
      // detalle completo (no se pierde ninguno). El consumidor (F5) relee de la BD lo que necesite;
      // por eso NO se incluye una cantidad agregada (mezclaría metros de tela con piezas de avío, M3).
      material: materialPrincipal,
      materiales: materialesEvento,
      idAlmacen: datos.idAlmacen,
      fecha: datos.fecha,
    };
    await registrarEventoOutbox(
      tx,
      EVENTOS_OUTBOX.materialRecibido,
      VERSION_MATERIAL_RECIBIDO,
      idEmpresa,
      evento,
    );

    return recepcion.id;
  }, bd);

  // Tras el commit: dispara la publicación de pendientes (best-effort; el barrido recupera si falla).
  dispararPublicacion();

  return obtenerRecepcion(idRecepcion, idEmpresa, bd);
}

// ── Operación: REVERSAR ──────────────────────────────────────────────────────────────────────────

/** Cuerpo del reverso (forma del contrato). */
export type CuerpoReversarRecepcion = z.input<typeof esquemaRecepcionReversarCuerpo>;

/**
 * Reversa una recepción generando el movimiento INVERSO de cada entrada de kardex que produjo
 * (D3 — NADA se borra) en UNA transacción (A2). Marca la recepción como reversada (suave, con motivo
 * y responsable, A7) y RECALCULA el estatus de la OC hacia atrás (R7). Una recepción ya reversada no
 * se vuelve a reversar. Las líneas LIBRES no tienen movimiento → no generan inverso. Destraba la
 * regla de cancelación de la OC de E2 (una OC sin recepciones ACTIVAS sí se puede cancelar). Permiso
 * `compras.recibir`. @see D3, A2, A7, R7.
 */
export async function reversarRecepcion(
  sesion: SesionUsuario,
  idRecepcion: number,
  cuerpo: CuerpoReversarRecepcion,
  bd?: ContextoBd,
): Promise<RecepcionSalida> {
  verificarPermiso(sesion, 'compras.recibir');
  const datos = validarEntrada(esquemaRecepcionReversarCuerpo, cuerpo);
  const idEmpresa = sesion.idEmpresaActiva;

  await enTransaccion(async (tx) => {
    const recepcion = await tx.recepcionCompra.findFirst({
      where: { id: idRecepcion, idEmpresa },
      select: {
        id: true,
        idOrdenCompra: true,
        reversadaEn: true,
        lineas: { select: { id: true, idMovimiento: true } },
      },
    });
    if (recepcion === null) {
      throw new ErrorNoEncontrado('RecepcionCompra', idRecepcion);
    }
    // B2: serializa el recálculo del estatus de la OC contra recepciones/reversos concurrentes
    // (lock por idOrdenCompra, ANTES de leer la OC y sus sumas). Mismo namespace que recibir.
    await bloquearOrdenCompra(tx, recepcion.idOrdenCompra);
    // Re-lee la bandera de reverso BAJO el lock: dos reversos concurrentes de la MISMA recepción se
    // serializan aquí; el segundo ya ve `reversadaEn` y se rechaza (no doble-revierte el kardex).
    const reversadaEn = (
      await tx.recepcionCompra.findUniqueOrThrow({
        where: { id: idRecepcion },
        select: { reversadaEn: true },
      })
    ).reversadaEn;
    if (reversadaEn !== null) {
      throw new ErrorConflicto('Esa recepción ya fue reversada.');
    }

    const tipoInverso = await tipoPorCodigo(tx, COD_AJUSTE_SALIDA);
    // Por cada movimiento de entrada que generó la recepción, su INVERSO auditado (D3).
    for (const linea of recepcion.lineas) {
      if (linea.idMovimiento !== null) {
        await cancelarMovimientoMaterial(sesion, linea.idMovimiento, tipoInverso.id, { tx });
      }
    }

    // Marca la recepción como reversada (SUAVE — nada se borra, A7).
    await tx.recepcionCompra.update({
      where: { id: idRecepcion },
      data: {
        reversadaEn: new Date(),
        reversadaPorId: sesion.id,
        motivoReverso: datos.motivo,
        ...datosModificacion(sesion),
      },
    });
    await registrarBitacora(tx, sesion, {
      entidad: 'RecepcionCompra',
      idEntidad: idRecepcion,
      accion: 'CANCELAR',
      datos: {
        motivo: datos.motivo,
        movimientosInvertidos: recepcion.lineas.filter((l) => l.idMovimiento !== null).length,
      },
    });

    // Recalcula el estatus de la OC hacia atrás (R7): la suma usa solo recepciones ACTIVAS y esta
    // ya quedó marcada reversada arriba → su material deja de contar. Bajo el lock (B2).
    const oc = await tx.ordenCompra.findUniqueOrThrow({
      where: { id: recepcion.idOrdenCompra },
      select: {
        id: true,
        estatus: true,
        lineas: { select: { id: true, cantidad: true, idOrden: true } },
      },
    });
    await recalcularEstatusOC(tx, sesion, {
      id: oc.id,
      estatus: oc.estatus,
      lineas: oc.lineas.map((l) => ({ id: l.id, pedido: Number(l.cantidad) })),
    });

    // OUTBOX (F5-E6, decisión (f)): el reverso re-evalúa `recepcionTela` de las órdenes ligadas a la
    // OC; si ya no hay tela completa, ese proceso de la RC se des-completa y recalcula su CPM. Las
    // órdenes salen de los `idOrden` de las líneas de la OC (sin repetir). Si la OC no liga ninguna
    // orden de producción, no hay nada que re-evaluar (el evento igual se escribe; el consumidor lo
    // ignora con `idsOrden` vacío).
    const idsOrden = [
      ...new Set(oc.lineas.map((l) => l.idOrden).filter((x): x is number => x !== null)),
    ];
    const eventoCancel: EventoMaterialRecibidoCancelado = {
      idEmpresa,
      idOrdenCompra: oc.id,
      idRecepcion,
      idsOrden,
    };
    await registrarEventoOutbox(
      tx,
      EVENTOS_OUTBOX.materialRecibidoCancelado,
      VERSION_EVENTO_ETAPA_RC,
      idEmpresa,
      eventoCancel,
    );
  }, bd);

  // Tras el commit: dispara la publicación (best-effort; el barrido recupera si falla).
  dispararPublicacion();
  return obtenerRecepcion(idRecepcion, idEmpresa, bd);
}

// ── Consultas ────────────────────────────────────────────────────────────────────────────────────

/** Lista las recepciones de una OC de la empresa activa (orden cronológico). Permiso `compras.ver`. */
export async function listarRecepcionesDeOC(
  sesion: SesionUsuario,
  idOrdenCompra: number,
  bd?: ContextoBd,
): Promise<RecepcionesLista> {
  verificarPermiso(sesion, 'compras.ver');
  const idEmpresa = sesion.idEmpresaActiva;
  // La OC debe ser de la empresa activa (A9).
  const oc = await clienteLectura(bd).ordenCompra.findFirst({
    where: { id: idOrdenCompra, idEmpresa },
    select: { id: true },
  });
  if (oc === null) {
    throw new ErrorNoEncontrado('OrdenCompra', idOrdenCompra);
  }
  const recepciones = await clienteLectura(bd).recepcionCompra.findMany({
    where: { idOrdenCompra, idEmpresa },
    include: incluirRecepcion,
    orderBy: { folio: 'asc' },
  });
  return { recepciones: recepciones.map(aRecepcionSalida) };
}

/** Obtiene una recepción por id (de la empresa activa). Permiso `compras.ver`. */
export async function obtenerRecepcionCompra(
  sesion: SesionUsuario,
  idRecepcion: number,
  bd?: ContextoBd,
): Promise<RecepcionSalida> {
  verificarPermiso(sesion, 'compras.ver');
  return obtenerRecepcion(idRecepcion, sesion.idEmpresaActiva, bd);
}
