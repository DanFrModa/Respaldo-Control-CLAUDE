/**
 * RECEPCIÓN de compras (Módulo COMPRAS, F4-E3 — doc `Documentacion_MJD/03-Produccion.md` §OC;
 * REQUISITOS-NUEVOS.md §R7). La recepción es el HECHO que conecta la orden de compra con el kardex
 * de materiales: recibe (parcial o total) el material de una OC AUTORIZADA, registra la ENTRADA al
 * kardex (`entrada-recepcion`) con cantidad y costo YA convertidos a unidad de consumo (R1, motor
 * `comun/conversion.ts`), y recalcula el estatus de la OC (parcial/total, R7). Toda la lógica vive
 * AQUÍ (A1); las rutas REST solo validan permiso + Zod y delegan. Esta capa ORQUESTA el motor de
 * kardex (`comun/kardex.ts`) — el ÚNICO que escribe `Movimiento`/`MovimientoDet*`.
 *
 * ⚠️ CAMBIO DE B1 — LAS TELAS ENTRAN POR COLOR/PARTIDA. Hasta A2 esta recepción creaba un `Lote`
 * (D5) y movía el kardex por tela×lote. Con el inventario de telas reestructurado por TELA+COLOR
 * (§Post-F9.11) y arrancando DESDE CERO, seguir por lote alimentaba un inventario muerto: ahora
 * cada línea de TELA exige su `telaColor` (color + complemento + lote del proveedor), crea SU
 * `PartidaTela` (motor compartido `dominio/inventarios/partidas-telas`) y registra la entrada por
 * color con su costo. El flujo de AVÍOS NO cambia. El `Lote` queda en cuarentena (legado).
 *
 * REGLA DEL COLOR (decidida en B1, explícita y sin adivinar): la línea de OC NO determina el color
 * (la OC se pide por TELA, sin color), así que el color se EXIGE en la pantalla de recepción; si la
 * línea de tela llega sin `telaColor`, el dominio la RECHAZA con un mensaje que lo dice.
 *
 * Innegociables aplicados:
 *  • A1 — la lógica vive en este módulo de dominio; las rutas son delgadas.
 *  • A2 — TODO en UNA transacción: carga OC, folio, crea recepción + renglones, crea partida(s),
 *    mueve kardex, recalcula estatus de la OC, escribe bitácora e inserta el evento outbox. O todo
 *    o nada (si falla la partida/movimiento NO queda recepción ni movimiento — rollback).
 *  • A3 — folio de recepción por secuencia atómica (`siguienteFolio`, clave "recepcion-compra") y
 *    folio de partida por la secuencia `partida-tela`.
 *  • A4 — `compras.recibir` re-verificado aquí (defensa en profundidad, deny-by-default).
 *  • A7 — auditoría (`creadoPorId`/…) + `Bitacora` en la misma tx.
 *  • A9 — todo se filtra/sella por la empresa ACTIVA de la sesión.
 *  • D1 — el costo entra como costo por unidad de consumo (precio ÷ factor); la valuación cuadra
 *    (cantidadConsumo × costoUnit == cantidadPresentación × precio — invariante de
 *    `comun/conversion.ts`). Ese costo valúa el CUERPO; el COMPLEMENTO tiene SU propio precio (la
 *    OC trae uno solo por línea), así que se captura en la recepción (`telaColor.precioUnitComplemento`,
 *    opcional) y viaja al kardex en su propia columna `costoUnitComplemento` (B1). Si no se
 *    captura queda NULL: el complemento entra sin valuar, pero el hueco es visible en el kardex.
 *  • D3 — la existencia es Σ de movimientos; el reverso NO edita/borra — genera el movimiento
 *    INVERSO auditado (`cancelarMovimientoMaterial`, que copia `idTelaColor`/`idPartida`/
 *    `cantidadComplemento` para que el par se neutralice en la suma por color).
 *
 * DECISIÓN (b), DECISIONES.md: SOLO se recibe contra una OC en estatus `autorizada` o
 * `recibida_parcial`. Cualquier otro estatus → `ErrorConflicto` (server-side, A4).
 *
 * FACTOR de conversión (R1): el factor "fino" por proveedor vive en `AvioProveedor.factorConversion`
 * (fallback `Avio.factorConversion`, fallback 1).
 *
 * §Post-F9.14 (decisión de Daniel, 7-ago-2026) — **la TELA ya no se recibe por aquí**: se recibe
 * capturando la FACTURA/REMISIÓN del proveedor (`dominio/inventarios/entradas-tela.ts`) con cada
 * renglón ligado a su renglón de OC; esa entrada crea la partida, mueve el kardex y llama a
 * {@link registrarRecepcionesDesdeEntradaTela} para escribir ESTA misma contabilidad. Una sola
 * puerta = la tela no se puede recibir dos veces. Los AVÍOS y las líneas libres siguen aquí.
 */
import {
  esquemaRecepcionCrear,
  esquemaRecepcionReversarCuerpo,
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
  type LineaMovimientoAvio,
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
import {
  faltantePorRecibir,
  renglonSurtido,
  type TipoRenglonCompra,
} from './tolerancia-recepcion.js';
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
export async function bloquearOrdenCompra(tx: Tx, idOrdenCompra: number): Promise<void> {
  const clave = (NS_LOCK_ORDEN_COMPRA << 32n) | BigInt(idOrdenCompra);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${clave}::bigint)`;
}

// ── Tipos de la OC cargada para recibir ──────────────────────────────────────────────────────────

type OCLineaParaRecepcion = {
  id: number;
  idTela: number | null;
  idAvio: number | null;
  idAvioProveedor: number | null;
  descripcionLibre: string | null;
  cantidad: Prisma.Decimal;
  /** Complemento que pidió la OC (§Post-F9.19): el estatus lo exige cuando existe. */
  cantidadComplemento: Prisma.Decimal | null;
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
      partida: {
        select: {
          folio: true,
          loteProveedor: true,
          idTelaColor: true,
          telaColor: { select: { nombre: true } },
        },
      },
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
      cantidadComplemento: aNumero(l.cantidadComplemento),
      costoUnit: aNumero(l.costoUnit),
      // Flujo NUEVO por color (B1): la traza de la tela es la PARTIDA (color + lote del proveedor).
      idTelaColor: l.partida?.idTelaColor ?? null,
      telaColor: l.partida?.telaColor.nombre ?? null,
      idPartida: l.idPartida,
      partidaFolio: l.partida === null ? null : Number(l.partida.folio),
      loteProveedor: l.partida?.loteProveedor ?? null,
      // LEGADO: sólo lo traen las recepciones de tela anteriores a B1.
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

/**
 * Calcula el estatus de recepción de una OC a partir de lo PEDIDO y lo RECIBIDO por línea (FUNCIÓN
 * PURA — sin BD, unit-testeable). Robusto a recepciones acumuladas (el llamador ya sumó lo recibido
 * por línea de TODAS las recepciones activas). Reglas (R7 + §Post-F9.19):
 *  • Una línea está SURTIDA según {@link renglonSurtido}: el cuerpo alcanza lo pedido —con la banda
 *    del 5% en TELA, porque *"nunca se recibe la cantidad exacta"*— y, **si la OC pidió complemento
 *    (Cardigan), el complemento también**. Sin complemento en la OC no se espera complemento.
 *  • TODAS surtidas → `recibida_total`; algo recibido pero no todo → `recibida_parcial`;
 *    nada recibido → `autorizada` (caso del reverso total).
 *
 * @param lineas            lo PEDIDO por línea de OC (cuerpo, complemento y si es tela).
 * @param recibidoPorLinea  Σ recibido de CUERPO (unidad de consumo) por id de línea de OC.
 * @param recibidoComplementoPorLinea  Σ recibido de COMPLEMENTO por id de línea de OC.
 */
export function calcularEstatusRecepcion(
  lineas: LineaParaEstatus[],
  recibidoPorLinea: Map<number, number>,
  recibidoComplementoPorLinea: Map<number, number> = new Map(),
): EstatusOrdenCompra {
  let algoRecibido = false;
  let todasCompletas = true;
  for (const linea of lineas) {
    const recibido = recibidoPorLinea.get(linea.id) ?? 0;
    const recibidoComplemento = recibidoComplementoPorLinea.get(linea.id) ?? 0;
    if (recibido > 0 || recibidoComplemento > 0) algoRecibido = true;
    if (
      !renglonSurtido({
        pedido: linea.pedido,
        recibido,
        pedidoComplemento: linea.pedidoComplemento ?? null,
        recibidoComplemento,
        tipo: linea.tipo ?? 'avio',
      })
    ) {
      todasCompletas = false;
    }
  }
  return !algoRecibido
    ? EstatusOrdenCompra.autorizada
    : todasCompletas
      ? EstatusOrdenCompra.recibida_total
      : EstatusOrdenCompra.recibida_parcial;
}

/**
 * Línea de OC como la ve el recálculo de estatus. `pedidoComplemento`/`tipo` son opcionales para no
 * romper a quien solo compara cuerpo (líneas libres y las pruebas de la función pura); cuando faltan,
 * la línea se trata como `avio` sin complemento.
 */
export interface LineaParaEstatus {
  id: number;
  pedido: number;
  pedidoComplemento?: number | null;
  /** Tipo del renglón: elige su banda de tolerancia. Los libres cuentan como `avio`. */
  tipo?: TipoRenglonCompra;
}

/**
 * Proyecta una línea de OC leída de Prisma a la forma que espera el recálculo. La usan los 4
 * llamadores para que TODOS apliquen el mismo criterio (§Post-F9.19: banda de tolerancia en tela +
 * complemento exigido cuando la OC lo pidió).
 */
function aLineaParaEstatus(l: {
  id: number;
  cantidad: Prisma.Decimal;
  cantidadComplemento: Prisma.Decimal | null;
  idTela: number | null;
}): LineaParaEstatus {
  return {
    id: l.id,
    pedido: Number(l.cantidad),
    pedidoComplemento: l.cantidadComplemento === null ? null : Number(l.cantidadComplemento),
    tipo: l.idTela !== null ? 'tela' : 'avio',
  };
}

/** Datos de la OC que necesita el recálculo de estatus (los provee el llamador, ya cargados). */
interface OCParaEstatus {
  id: number;
  estatus: string;
  lineas: LineaParaEstatus[];
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

  // Σ recibido por línea de OC (cuerpo Y complemento), solo de recepciones ACTIVAS.
  const sumas = await tx.recepcionCompraLinea.groupBy({
    by: ['idOrdenCompraLinea'],
    where: { recepcionCompra: { idOrdenCompra: oc.id, reversadaEn: null } },
    _sum: { cantidadRecibida: true, cantidadComplemento: true },
  });
  const recibidoPorLinea = new Map<number, number>();
  const recibidoComplementoPorLinea = new Map<number, number>();
  for (const s of sumas) {
    recibidoPorLinea.set(s.idOrdenCompraLinea, Number(s._sum.cantidadRecibida ?? 0));
    recibidoComplementoPorLinea.set(s.idOrdenCompraLinea, Number(s._sum.cantidadComplemento ?? 0));
  }

  const nuevo = calcularEstatusRecepcion(oc.lineas, recibidoPorLinea, recibidoComplementoPorLinea);
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
 *     unidad de consumo (R1); para TELA exige el COLOR (B1), crea su PARTIDA y registra la entrada
 *     al kardex POR COLOR (cuerpo + complemento juntos, cada uno con su costo); para AVÍO registra
 *     la entrada al kardex de avío; para LIBRE solo registra el renglón (no inventaría). Persiste
 *     `RecepcionCompraLinea` con la traza (partida/movimiento, costo).
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
            // §Post-F9.19: el estatus también mira el COMPLEMENTO que pidió la OC.
            cantidadComplemento: true,
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
        // §Post-F9.14 (decisión de Daniel, 7-ago-2026): la TELA ya NO se recibe desde aquí. Se
        // recibe capturando la FACTURA o REMISIÓN del proveedor y ligando cada renglón a su renglón
        // de OC — esa entrada es la que crea la partida, mueve el kardex y marca la orden como
        // recibida. Dejar viva esta puerta permitiría recibir la misma tela dos veces (una por cada
        // camino) e inflar el inventario sin que nada lo impidiera.
        throw new ErrorConflicto(
          `El renglón ${ocl.id} es de TELA y la tela ya no se recibe desde la orden de compra: ` +
            `captura la factura o remisión del proveedor en Inventarios › Telas › Entradas y liga ` +
            `ese renglón a esta orden. Al confirmarla, la orden queda marcada como recibida. Los ` +
            `avíos sí se siguen recibiendo desde aquí.`,
        );
      } else if (ocl.idAvio !== null) {
        // El bloque por color es EXCLUSIVO de las líneas de tela: mandarlo en un avío significa que
        // el capturador se equivocó de renglón — se RECHAZA en vez de ignorarlo en silencio.
        if (lineaEntrada.telaColor !== undefined) {
          throw new ErrorValidacion(
            `El renglón ${ocl.id} es de AVÍO: no lleva color de tela (el bloque "telaColor" sólo aplica a telas).`,
          );
        }
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
        // Igual que en avío: una línea LIBRE no inventaría, así que un color capturado ahí es un
        // error de captura, no un dato que se pueda descartar callando.
        if (lineaEntrada.telaColor !== undefined) {
          throw new ErrorValidacion(
            `El renglón ${ocl.id} es una línea LIBRE (no es material de catálogo): no lleva color de tela.`,
          );
        }
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
      lineas: oc.lineas.map(aLineaParaEstatus),
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

// ── Recepción generada por una ENTRADA DE TELA por factura (§Post-F9.14) ─────────────────────────

/**
 * Un renglón de la factura de tela que SURTE un renglón de OC, ya resuelto por el llamador
 * (`confirmarEntradaTela`): la partida y el movimiento de kardex YA existen — esta función no mueve
 * inventario, solo escribe la contabilidad de la recepción.
 */
export interface RenglonEntradaTelaRecibido {
  /** Renglón de OC que surte (validado aquí contra la tela y el proveedor). */
  idOrdenCompraLinea: number;
  /** Color que llegó (para verificar que es de la tela comprada). */
  idTelaColor: number;
  /** Tela del color (la resuelve el llamador, que ya cargó los colores). */
  idTela: number;
  /** Cantidad del CUERPO, en unidad de consumo (la tela no tiene factor de presentación: R1 = 1). */
  cantidad: number;
  /** Cantidad del COMPLEMENTO, o null si la tela no lleva. */
  cantidadComplemento: number | null;
  /** Precio unitario del cuerpo capturado en la factura (D1), o null. */
  costoUnit: number | null;
  /** Partida creada por la entrada para este renglón. */
  idPartida: number;
}

/** Cabecera del documento de entrada que genera las recepciones. */
export interface CabeceraEntradaTelaRecibida {
  idEmpresa: number;
  idEntradaTela: number;
  folioEntrada: number;
  idAlmacen: number;
  /** Proveedor de la FACTURA: debe coincidir con el de cada OC surtida. */
  idProveedor: number;
  /** Número del documento del proveedor (queda como `factura` de la recepción). */
  factura: string;
  /** Fecha del documento en YYYY-MM-DD. */
  fecha: string;
  /** Movimiento de kardex único que creó la entrada (traza en cada renglón de recepción). */
  idMovimiento: number;
}

/**
 * Toma los advisory locks de las OCs que va a tocar una entrada de tela, en orden ASCENDENTE de id.
 *
 * DEBE llamarse al PRINCIPIO de la transacción de `confirmarEntradaTela`, ANTES de crear partidas y
 * de mover el kardex: así las dos puertas que escriben recepciones (esta y `recibirCompra`) toman
 * los recursos en el MISMO orden —primero la OC, después el inventario— y no pueden interbloquearse
 * entre sí. El orden ascendente evita además el interbloqueo entre dos facturas que surten las
 * mismas dos OCs en orden distinto.
 */
export async function bloquearOrdenesDeRenglones(
  tx: Tx,
  idsOrdenCompraLinea: readonly number[],
): Promise<void> {
  if (idsOrdenCompraLinea.length === 0) {
    return;
  }
  const lineas = await tx.ordenCompraLinea.findMany({
    where: { id: { in: [...new Set(idsOrdenCompraLinea)] } },
    select: { idOrdenCompra: true },
  });
  const ids = [...new Set(lineas.map((l) => l.idOrdenCompra))].sort((a, b) => a - b);
  for (const id of ids) {
    await bloquearOrdenCompra(tx, id);
  }
}

/**
 * Escribe la RECEPCIÓN de una entrada de tela por factura contra sus órdenes de compra
 * (§Post-F9.14, petición de Daniel: *"al dar entrada de tela de una factura, la relacionemos con la
 * OC de esa tela… se marca con estatus de recibido"*).
 *
 * Es la MISMA contabilidad que `recibirCompra` —una `RecepcionCompra` por OC surtida, con sus
 * renglones, el recálculo de estatus (R7) y el evento `material-recibido` del outbox—, pero SIN
 * mover inventario: la entrada ya creó las partidas y el movimiento de kardex. Por eso la tela no
 * puede contarse dos veces: hay una sola escritura al kardex y una sola suma a `cantidadRecibida`.
 *
 * Una factura puede surtir VARIAS OCs (decisión de Daniel: la liga es por renglón) → se agrupa por
 * OC y se emite una recepción y un evento por cada una. Valida, por renglón:
 *  • que el renglón de OC exista, sea de esta empresa y sea de TELA;
 *  • que el color que llegó sea de la tela comprada;
 *  • que la OC sea del MISMO proveedor que la factura (una factura de X no surte una OC de Y);
 *  • que la OC esté en `autorizada` o `recibida_parcial` (decisión (b), igual que la otra puerta).
 *
 * DEBE correr dentro de la transacción de `confirmarEntradaTela` y bajo los locks de
 * {@link bloquearOrdenesDeRenglones}.
 */
export async function registrarRecepcionesDesdeEntradaTela(
  tx: Tx,
  sesion: SesionUsuario,
  cabecera: CabeceraEntradaTelaRecibida,
  renglones: readonly RenglonEntradaTelaRecibido[],
): Promise<void> {
  if (renglones.length === 0) {
    return;
  }

  const lineasOC = await tx.ordenCompraLinea.findMany({
    where: { id: { in: [...new Set(renglones.map((r) => r.idOrdenCompraLinea))] } },
    select: {
      id: true,
      idTela: true,
      idOrden: true,
      idOrdenCompra: true,
      ordenCompra: {
        select: {
          id: true,
          numCompra: true,
          idEmpresa: true,
          idProveedor: true,
          estatus: true,
          lineas: { select: { id: true, cantidad: true, cantidadComplemento: true, idTela: true } },
        },
      },
    },
  });
  const porId = new Map(lineasOC.map((l) => [l.id, l]));

  // Agrupa por OC conservando el orden de captura dentro de cada una.
  const porOrdenCompra = new Map<
    number,
    { linea: (typeof lineasOC)[number]; renglon: RenglonEntradaTelaRecibido }[]
  >();
  for (const renglon of renglones) {
    const linea = porId.get(renglon.idOrdenCompraLinea);
    if (linea === undefined || linea.ordenCompra.idEmpresa !== cabecera.idEmpresa) {
      throw new ErrorNoEncontrado('OrdenCompraLinea', renglon.idOrdenCompraLinea);
    }
    const oc = linea.ordenCompra;
    if (linea.idTela === null) {
      throw new ErrorValidacion(
        `El renglón elegido de la orden de compra ${Number(oc.numCompra)} no es de TELA: una ` +
          `factura de tela solo puede surtir renglones de tela (los avíos se reciben desde la OC).`,
      );
    }
    if (linea.idTela !== renglon.idTela) {
      throw new ErrorValidacion(
        `El color que llegó no es de la tela que pide la orden de compra ${Number(oc.numCompra)}: ` +
          `revisa a qué renglón de la OC lo estás ligando.`,
      );
    }
    if (oc.idProveedor !== cabecera.idProveedor) {
      throw new ErrorValidacion(
        `La orden de compra ${Number(oc.numCompra)} es de otro proveedor: una factura solo puede ` +
          `surtir órdenes del proveedor que la emitió.`,
      );
    }
    if (!ESTATUS_RECIBIBLES.includes(oc.estatus)) {
      throw new ErrorConflicto(
        `No se puede recibir contra la orden de compra ${Number(oc.numCompra)} en estatus ` +
          `"${oc.estatus}": solo se recibe en "autorizada" o "recibida_parcial".`,
      );
    }
    const grupo = porOrdenCompra.get(oc.id) ?? [];
    grupo.push({ linea, renglon });
    porOrdenCompra.set(oc.id, grupo);
  }

  // Una recepción por OC surtida, en orden ascendente (mismo orden que los locks).
  for (const idOrdenCompra of [...porOrdenCompra.keys()].sort((a, b) => a - b)) {
    const grupo = porOrdenCompra.get(idOrdenCompra) ?? [];
    const oc = grupo[0]?.linea.ordenCompra;
    if (oc === undefined) {
      continue;
    }

    const folio = await siguienteFolio(tx, cabecera.idEmpresa, CLAVE_SECUENCIA_RECEPCION);
    const recepcion = await tx.recepcionCompra.create({
      data: {
        folio,
        idEmpresa: cabecera.idEmpresa,
        idOrdenCompra,
        idEntradaTela: cabecera.idEntradaTela,
        idAlmacen: cabecera.idAlmacen,
        factura: cabecera.factura,
        fecha: new Date(`${cabecera.fecha}T00:00:00.000Z`),
        observaciones: `Entrada de tela ${String(cabecera.folioEntrada)} · ${cabecera.factura}`,
        ...datosCreacion(sesion),
      },
      select: { id: true },
    });

    const materialesEvento: EventoMaterialRecibido['materiales'] = [];
    for (const { linea, renglon } of grupo) {
      await tx.recepcionCompraLinea.create({
        data: {
          idRecepcionCompra: recepcion.id,
          idOrdenCompraLinea: linea.id,
          cantidadRecibida: renglon.cantidad,
          cantidadComplemento: renglon.cantidadComplemento,
          costoUnit: renglon.costoUnit,
          idPartida: renglon.idPartida,
          idMovimiento: cabecera.idMovimiento,
          ...datosCreacion(sesion),
        },
      });
      materialesEvento.push({
        tipo: 'tela',
        id: renglon.idTela,
        idLote: null,
        idPartida: renglon.idPartida,
        idOrdenCompraLinea: linea.id,
        idOrden: linea.idOrden,
      });
    }

    await recalcularEstatusOC(tx, sesion, {
      id: oc.id,
      estatus: oc.estatus,
      lineas: oc.lineas.map(aLineaParaEstatus),
    });

    await registrarBitacora(tx, sesion, {
      entidad: 'RecepcionCompra',
      idEntidad: recepcion.id,
      accion: 'CREAR',
      datos: {
        folio: Number(folio),
        idOrdenCompra,
        idEntradaTela: cabecera.idEntradaTela,
        renglones: grupo.length,
      },
    });

    const principal = materialesEvento[0];
    if (principal !== undefined) {
      const evento: EventoMaterialRecibido = {
        idEmpresa: cabecera.idEmpresa,
        idOrdenCompra,
        idRecepcion: recepcion.id,
        folioRecepcion: Number(folio),
        material: principal,
        materiales: materialesEvento,
        idAlmacen: cabecera.idAlmacen,
        fecha: cabecera.fecha,
      };
      await registrarEventoOutbox(
        tx,
        EVENTOS_OUTBOX.materialRecibido,
        VERSION_MATERIAL_RECIBIDO,
        cabecera.idEmpresa,
        evento,
      );
    }
  }
}

/**
 * REVERSA (suave) las recepciones que generó una entrada de tela, al cancelarla (§Post-F9.14). NO
 * toca el kardex: el inverso lo hace `cancelarEntradaTela` con su propio movimiento (D3). Aquí solo
 * se marca la recepción como reversada y se recalcula el estatus de la OC hacia atrás (R7), que es
 * lo que devuelve la orden a "autorizada"/"recibida_parcial" cuando la factura se anula.
 *
 * DEBE correr dentro de la transacción de la cancelación y bajo el lock de cada OC.
 */
export async function reversarRecepcionesDeEntradaTela(
  tx: Tx,
  sesion: SesionUsuario,
  idEntradaTela: number,
  motivo: string,
): Promise<void> {
  const recepciones = await tx.recepcionCompra.findMany({
    where: { idEntradaTela, reversadaEn: null },
    select: {
      id: true,
      ordenCompra: {
        select: {
          id: true,
          estatus: true,
          lineas: {
            select: { id: true, cantidad: true, cantidadComplemento: true, idTela: true },
          },
        },
      },
    },
    orderBy: { id: 'asc' },
  });

  for (const recepcion of recepciones) {
    await tx.recepcionCompra.update({
      where: { id: recepcion.id },
      data: {
        reversadaEn: new Date(),
        reversadaPorId: sesion.id,
        motivoReverso: motivo,
        ...datosModificacion(sesion),
      },
    });
    // Se recalcula DESPUÉS de marcar el reverso: el groupBy suma solo recepciones activas.
    await recalcularEstatusOC(tx, sesion, {
      id: recepcion.ordenCompra.id,
      estatus: recepcion.ordenCompra.estatus,
      lineas: recepcion.ordenCompra.lineas.map(aLineaParaEstatus),
    });
    await registrarBitacora(tx, sesion, {
      entidad: 'RecepcionCompra',
      idEntidad: recepcion.id,
      accion: 'OTRO',
      datos: { reversada: true, porCancelacionDeEntradaTela: idEntradaTela, motivo },
    });
  }
}

// ── Operación: REVERSAR ─────────────────────────────────────────────────────────────────────────

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
        lineas: {
          select: {
            id: true,
            cantidad: true,
            cantidadComplemento: true,
            idTela: true,
            idOrden: true,
          },
        },
      },
    });
    await recalcularEstatusOC(tx, sesion, {
      id: oc.id,
      estatus: oc.estatus,
      lineas: oc.lineas.map(aLineaParaEstatus),
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

/**
 * Renglones de TELA todavía PENDIENTES de recibir, de las OCs abiertas de un proveedor
 * (§Post-F9.14). Es lo que alimenta el selector "¿qué renglón de OC surte este renglón?" de la
 * captura de la factura: sin esta lista, ligar una factura a su orden obligaría a abrir la OC en
 * otra pantalla y copiar ids a mano.
 *
 * Pendiente = cantidad pedida − Σ recibido en recepciones ACTIVAS (mismo criterio que el estatus,
 * R7). Se devuelven SOLO las líneas con pendiente > 0, de OCs `autorizada`/`recibida_parcial` de la
 * empresa activa (A9). Lectura pura: no toma locks (es una ayuda de captura; quien manda es la
 * validación del confirmar).
 */
export async function lineasTelaPendientesDeProveedor(
  sesion: SesionUsuario,
  idProveedor: number,
  /** Acota a UNA orden de compra (§Post-F9.15: la entrada arranca desde la OC). */
  idOrdenCompra?: number,
  bd?: ContextoBd,
): Promise<
  {
    idOrdenCompraLinea: number;
    idOrdenCompra: number;
    numCompra: number;
    idTela: number;
    tela: string;
    unidad: string | null;
    cantidad: number;
    recibido: number;
    pendiente: number;
    precio: number;
    /** Cómo se llama el complemento de esa tela ("Cardigan"), o null si no lleva. */
    nombreComplemento: string | null;
    /** Complemento que pidió la OC, y cuánto falta por recibir de él (§Post-F9.19). */
    cantidadComplemento: number | null;
    recibidoComplemento: number;
    pendienteComplemento: number;
  }[]
> {
  verificarPermiso(sesion, 'compras.ver');
  const cliente = clienteLectura(bd);

  const lineas = await cliente.ordenCompraLinea.findMany({
    where: {
      idTela: { not: null },
      ...(idOrdenCompra === undefined ? {} : { idOrdenCompra }),
      ordenCompra: {
        idEmpresa: sesion.idEmpresaActiva,
        idProveedor,
        estatus: { in: [EstatusOrdenCompra.autorizada, EstatusOrdenCompra.recibida_parcial] },
      },
    },
    select: {
      id: true,
      idOrdenCompra: true,
      idTela: true,
      cantidad: true,
      cantidadComplemento: true,
      precio: true,
      unidad: true,
      tela: { select: { nombre: true, nombreComplemento: true } },
      ordenCompra: { select: { numCompra: true } },
    },
    orderBy: [{ idOrdenCompra: 'asc' }, { id: 'asc' }],
  });
  if (lineas.length === 0) {
    return [];
  }

  const sumas = await cliente.recepcionCompraLinea.groupBy({
    by: ['idOrdenCompraLinea'],
    where: {
      idOrdenCompraLinea: { in: lineas.map((l) => l.id) },
      recepcionCompra: { reversadaEn: null },
    },
    _sum: { cantidadRecibida: true, cantidadComplemento: true },
  });
  const recibidoPorLinea = new Map(
    sumas.map((s) => [s.idOrdenCompraLinea, Number(s._sum.cantidadRecibida ?? 0)]),
  );
  const recibidoComplementoPorLinea = new Map(
    sumas.map((s) => [s.idOrdenCompraLinea, Number(s._sum.cantidadComplemento ?? 0)]),
  );

  return (
    lineas
      .map((l) => {
        const cantidad = Number(l.cantidad);
        const recibido = recibidoPorLinea.get(l.id) ?? 0;
        const cantidadComplemento =
          l.cantidadComplemento === null ? null : Number(l.cantidadComplemento);
        const recibidoComplemento = recibidoComplementoPorLinea.get(l.id) ?? 0;
        // MISMO criterio que el estatus (§Post-F9.19): dentro de la banda del 5% ya no falta nada,
        // y el complemento que pidió la OC cuenta como pendiente hasta que llega.
        const falta = faltantePorRecibir({
          pedido: cantidad,
          recibido,
          pedidoComplemento: cantidadComplemento,
          recibidoComplemento,
          tipo: 'tela',
        });
        return {
          idOrdenCompraLinea: l.id,
          idOrdenCompra: l.idOrdenCompra,
          numCompra: Number(l.ordenCompra.numCompra),
          idTela: l.idTela as number,
          tela: l.tela?.nombre ?? '(tela)',
          unidad: l.unidad,
          cantidad,
          recibido,
          pendiente: falta.cuerpo,
          precio: Number(l.precio),
          nombreComplemento: l.tela?.nombreComplemento ?? null,
          cantidadComplemento,
          recibidoComplemento,
          pendienteComplemento: falta.complemento,
        };
      })
      // Se ofrece el renglón mientras falte CUERPO o COMPLEMENTO (uno puede haber llegado sin el otro).
      .filter((l) => l.pendiente > 0 || l.pendienteComplemento > 0)
  );
}

/** Lo pendiente de UN renglón de OC (lo pedido, lo ya recibido y lo que falta). */
export interface LineaPendienteOC {
  idOrdenCompraLinea: number;
  /** Tipo del renglón: `tela` (se recibe por factura, B1), `avio` o `libre`. */
  tipo: 'tela' | 'avio' | 'libre';
  /** Cantidad pedida del CUERPO en la OC. */
  cantidad: number;
  /** Σ recibido del cuerpo en recepciones ACTIVAS (no reversadas). */
  recibido: number;
  /** Lo que falta del cuerpo (0 dentro de la banda de tolerancia, §Post-F9.19). */
  pendiente: number;
  /** Complemento que pidió la OC (Cardigan), o null si el renglón no lo lleva. */
  cantidadComplemento: number | null;
  /** Σ recibido del complemento. */
  recibidoComplemento: number;
  /** Lo que falta del complemento. */
  pendienteComplemento: number;
  /** ¿El renglón ya quedó surtido (dentro de la banda de su tipo)? */
  surtido: boolean;
}

/**
 * Pendiente por recibir de TODOS los renglones de UNA orden de compra.
 *
 * POR QUÉ EXISTE: la pantalla de recepción de AVÍOS precargaba lo PEDIDO COMPLETO en cada renglón,
 * ignorando lo ya recibido — y como `recibirCompra` solo impide repetir un renglón *dentro de la
 * misma* recepción, recibir tres veces el 100 % era válido y silencioso. Ahora la captura precarga
 * lo que FALTA y muestra lo ya recibido, igual que la puerta de tela (que se apoya en
 * {@link lineasTelaPendientesDeProveedor}). El cálculo del pendiente vive AQUÍ, en el dominio (A1):
 * la pantalla NO resta cantidades: nada más pinta lo que este servicio le da.
 *
 * MISMO criterio que el estatus y que el pendiente de tela (`faltantePorRecibir`, §Post-F9.19):
 * cuerpo y complemento contra lo que la OC pidió, con la banda de tolerancia de su tipo de material.
 * Se devuelven TODOS los renglones (no solo los pendientes): la pantalla los lista completos y
 * necesita saber cuáles ya están surtidos para decirlo. Lectura pura, sin locks: es una ayuda de
 * captura — quien manda es la validación del confirmar. La OC debe ser de la empresa activa (A9).
 * Permiso `compras.ver`.
 */
export async function lineasPendientesDeOC(
  sesion: SesionUsuario,
  idOrdenCompra: number,
  bd?: ContextoBd,
): Promise<LineaPendienteOC[]> {
  verificarPermiso(sesion, 'compras.ver');
  const cliente = clienteLectura(bd);

  const oc = await cliente.ordenCompra.findFirst({
    where: { id: idOrdenCompra, idEmpresa: sesion.idEmpresaActiva },
    select: {
      lineas: {
        select: {
          id: true,
          idTela: true,
          idAvio: true,
          cantidad: true,
          cantidadComplemento: true,
        },
        orderBy: { id: 'asc' },
      },
    },
  });
  if (oc === null) {
    throw new ErrorNoEncontrado('OrdenCompra', idOrdenCompra);
  }
  if (oc.lineas.length === 0) {
    return [];
  }

  const sumas = await cliente.recepcionCompraLinea.groupBy({
    by: ['idOrdenCompraLinea'],
    where: {
      idOrdenCompraLinea: { in: oc.lineas.map((l) => l.id) },
      recepcionCompra: { reversadaEn: null },
    },
    _sum: { cantidadRecibida: true, cantidadComplemento: true },
  });
  const recibidoPorLinea = new Map(
    sumas.map((s) => [s.idOrdenCompraLinea, Number(s._sum.cantidadRecibida ?? 0)]),
  );
  const recibidoComplementoPorLinea = new Map(
    sumas.map((s) => [s.idOrdenCompraLinea, Number(s._sum.cantidadComplemento ?? 0)]),
  );

  return oc.lineas.map((l) => {
    const tipo = l.idTela !== null ? 'tela' : l.idAvio !== null ? 'avio' : 'libre';
    // Los renglones LIBRES usan la banda de los avíos (mismo criterio que el estatus).
    const tipoBanda: TipoRenglonCompra = tipo === 'tela' ? 'tela' : 'avio';
    const cantidad = Number(l.cantidad);
    const cantidadComplemento =
      l.cantidadComplemento === null ? null : Number(l.cantidadComplemento);
    const recibido = recibidoPorLinea.get(l.id) ?? 0;
    const recibidoComplemento = recibidoComplementoPorLinea.get(l.id) ?? 0;
    const renglon = {
      pedido: cantidad,
      recibido,
      pedidoComplemento: cantidadComplemento,
      recibidoComplemento,
      tipo: tipoBanda,
    };
    const falta = faltantePorRecibir(renglon);
    return {
      idOrdenCompraLinea: l.id,
      tipo,
      cantidad,
      recibido,
      pendiente: falta.cuerpo,
      cantidadComplemento,
      recibidoComplemento,
      pendienteComplemento: falta.complemento,
      surtido: renglonSurtido(renglon),
    };
  });
}
