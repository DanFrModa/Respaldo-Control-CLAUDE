/**
 * ENTREGA A CLIENTE (F3-E5; doc 03-Produccion "Entrega" + 02-Pedidos: CIERRE del ciclo de la orden).
 * Es el "gemelo de SALIDA" del recibo de costura (`recibos.ts`): donde el recibo METÍA prenda a PT,
 * la entrega la SACA. Toda la lógica de negocio vive AQUÍ (A1); las rutas REST solo validan permiso
 * + Zod y delegan. Esta capa ORQUESTA el motor de kardex (`comun/kardex.ts`) —que es el ÚNICO que
 * escribe `Movimiento`/`MovimientoDetPt`— pero pone la VALIDACIÓN de negocio de la entrega
 * (no entregar lo que no existe) y deriva su seguimiento del pedido.
 *
 * De una entrega se derivan, en UNA sola transacción (A2):
 *  1. `EtapaMovimiento(entrega_cliente, idOrden)` + `EtapaMovimientoDet` color×talla → el
 *     "entregado" del pedido SUBE (derivado por suma de entregas vivas, sin acumuladores — D3).
 *  2. Validación NO-NEGATIVO ESTRICTA (decisión b): por cada artículo, existencia − cantidad ≥ 0,
 *     por suma directa de `MovimientoDetPt` bajo bloqueo por artículo (`existenciaPtBloqueada`) —
 *     NUNCA la vista `existencia_pt`. Dos entregas concurrentes del mismo artículo no dejan negativo.
 *  3. La SALIDA del kardex PT vía el motor: tipo de movimiento `entrega-cliente` (dirección salida),
 *     `origenTipo = ORIGEN.entregaCliente`, del modelo de la orden, en el almacén elegido
 *     (costoUnit NULL — D1/D2).
 *  4. Evento `entrega-registrado` post-commit (gancho RC F5, sin consumidores hoy).
 *
 * El SEGUIMIENTO del pedido (entregado/faltante por línea) es DERIVADO de la suma de entregas vivas
 * de la orden (D3): {@link seguimientoEntregaOrden}. NUNCA se escribe a una columna `entregado`.
 *
 * Innegociables aplicados:
 *  • A1 — la lógica vive aquí; las rutas son delgadas.
 *  • A2 — encabezado + detalle + salida de kardex + bitácora en UNA transacción.
 *  • A3 — folio de la entrega por la secuencia atómica "etapa-mov" (la misma de corte/envío/recibo);
 *    el folio del movimiento de kardex lo da el motor (secuencia "movimiento"). Nunca Max()+1.
 *  • A4 — `produccion.entrega` para capturar; `produccion.wip-ver` para consultar; `produccion.cancelar`
 *    para cancelar.
 *  • A7 — bitácora uniforme dentro de la transacción.
 *  • A9 — todo se filtra/sella por la empresa de la ORDEN, que debe ser la empresa activa.
 *  • D3 — la existencia es Σ de movimientos; la entrega NUNCA edita existencia: registra una salida.
 *  • D4 — toda etapa del WIP se captura por color×talla.
 *
 * NOTA DE ESQUEMA (SIN migración, F3-E5): `EtapaMovimiento` no tiene columna `idAlmacenOrigen`. La
 * entrega REUSA `idAlmacenPrimeras` como su almacén de ORIGEN (es el campo "almacén PT" del
 * encabezado, libre en una entrega: no hay recibo de costura) — así no se agrega ninguna columna.
 * La referencia/nota de pedido va en `observaciones` (tampoco hay columna dedicada).
 */
import {
  esquemaEntregaClienteCrear,
  esquemaEntregaClienteCancelarCuerpo,
  esquemaSeguimientoEntregaQuery,
  type DatosEntregaLineaEntrada,
  type EntregaClienteSalida,
  type EntregasOrdenLista,
  type SeguimientoEntregaOrden,
} from '../../contrato/index.js';
import { TipoEtapaMovimiento, type EtapaMovimiento, type Prisma } from '../../datos/index.js';
import type { z } from 'zod';

import { exigirAlmacen } from '../../comun/almacenes.js';
import { datosCreacion, datosModificacion, registrarBitacora } from '../../comun/auditoria.js';
import { dispararPublicacion } from '../../comun/cola-eventos.js';
import { ErrorConflicto, ErrorNoEncontrado, ErrorValidacion } from '../../comun/errores.js';
import {
  EVENTOS_OUTBOX,
  VERSION_EVENTO_ETAPA_RC,
  registrarEventoOutbox,
  type EventoEtapaRc,
} from '../../comun/eventos-dominio.js';
import { EVENTOS_PRODUCCION, emitir, type NombreEvento } from '../../comun/eventos.js';
import {
  bloquearArticuloPt,
  cancelarMovimientoPt as cancelarMovimientoPtMotor,
  existenciaPtBloqueada,
  registrarMovimientoPt as registrarMovimientoPtMotor,
  type LineaMovimientoPt,
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

import { CLAVE_SECUENCIA_ETAPA } from './etapas.js';

/** Tipo de movimiento de kardex para la SALIDA de PT de la entrega (seed, dirección salida). */
const COD_ENTREGA_CLIENTE = 'entrega-cliente';
/** Tipo inverso (entrada) para revertir la salida de la entrega al cancelar (dirección entrada). */
const COD_ERROR_SALIDA = 'error-salida';

// ── Tipos internos ──────────────────────────────────────────────────────────────────────────────

/** Una celda color×talla "aplanada" (un renglón por talla), ya sin ceros. */
interface Celda {
  idColor: number;
  idTalla: number;
  cantidad: number;
}

/** Clave estable de una celda color×talla (para mapas). */
function claveCelda(idColor: number, idTalla: number): string {
  return `${idColor}:${idTalla}`;
}

/** Convierte un `YYYY-MM-DD` al `Date` UTC que Prisma guarda en `@db.Date`. */
function aDateColumna(valor: string): Date {
  return new Date(`${valor}T00:00:00.000Z`);
}

// ── Helpers de la orden y validación de pertenencia ──────────────────────────────────────────────

/** Datos de la orden necesarios para validar y proyectar una entrega. */
interface ContextoOrden {
  idEmpresa: number;
  estado: string;
  idModelo: number;
  idCliente: number;
  colores: Set<number>;
  tallasPorColor: Map<number, Set<number>>;
}

/** Resuelve la orden de la EMPRESA ACTIVA con sus combinaciones color×talla válidas (A9). */
async function resolverOrden(
  tx: Tx,
  idOrden: number,
  idEmpresaActiva: number,
): Promise<ContextoOrden> {
  const orden = await tx.orden.findFirst({
    where: { id: idOrden, idEmpresa: idEmpresaActiva },
    select: {
      idEmpresa: true,
      estado: true,
      idModelo: true,
      idCliente: true,
      lineas: { select: { idColor: true, tallas: { select: { idTalla: true } } } },
    },
  });
  if (orden === null) {
    throw new ErrorNoEncontrado('Orden', idOrden);
  }
  if (orden.estado === 'cancelada') {
    throw new ErrorConflicto('La orden está cancelada; no se le pueden capturar etapas.');
  }
  const colores = new Set<number>();
  const tallasPorColor = new Map<number, Set<number>>();
  for (const linea of orden.lineas) {
    colores.add(linea.idColor);
    const tallas = tallasPorColor.get(linea.idColor) ?? new Set<number>();
    for (const t of linea.tallas) tallas.add(t.idTalla);
    tallasPorColor.set(linea.idColor, tallas);
  }
  return {
    idEmpresa: orden.idEmpresa,
    estado: orden.estado,
    idModelo: orden.idModelo,
    idCliente: orden.idCliente,
    colores,
    tallasPorColor,
  };
}

/**
 * Aplana la matriz de la entrega a celdas, validando SANIDAD (D4): color y talla SIN repetir dentro
 * de la captura, cantidades enteras ≥ 0, y que cada color×talla PERTENEZCA a la orden (no se entrega
 * un color/talla que la orden no pidió). Descarta las celdas en 0. Exige al menos una celda > 0. NO
 * valida la existencia (eso es {@link validarNoNegativo}, bajo lock).
 */
function aplanarYValidar(lineas: DatosEntregaLineaEntrada[], orden: ContextoOrden): Celda[] {
  const idsColor = lineas.map((l) => l.idColor);
  if (new Set(idsColor).size !== idsColor.length) {
    throw new ErrorValidacion('Un color no puede aparecer dos veces en la misma captura.');
  }

  const celdas: Celda[] = [];
  for (const linea of lineas) {
    if (!orden.colores.has(linea.idColor)) {
      throw new ErrorValidacion(
        `El color ${linea.idColor} no pertenece a la orden; solo se entregan colores de la orden.`,
      );
    }
    const tallasOrden = orden.tallasPorColor.get(linea.idColor) ?? new Set<number>();
    const idsTalla = linea.tallas.map((t) => t.idTalla);
    if (new Set(idsTalla).size !== idsTalla.length) {
      throw new ErrorValidacion('Una talla no puede aparecer dos veces en el mismo color.');
    }
    for (const t of linea.tallas) {
      if (!Number.isInteger(t.cantidad) || t.cantidad < 0) {
        throw new ErrorValidacion('Las cantidades deben ser enteros ≥ 0.');
      }
      if (!tallasOrden.has(t.idTalla)) {
        throw new ErrorValidacion(
          `La talla ${t.idTalla} no pertenece al color ${linea.idColor} de la orden.`,
        );
      }
      if (t.cantidad > 0) {
        celdas.push({ idColor: linea.idColor, idTalla: t.idTalla, cantidad: t.cantidad });
      }
    }
  }
  if (celdas.length === 0) {
    throw new ErrorValidacion('La captura no tiene ninguna pieza (todas las cantidades son 0).');
  }
  return celdas;
}

/**
 * Valida, bajo bloqueo, que SACAR `celdas` del almacén `idAlmacen` (artículos del `idModelo` de la
 * orden) no deje la existencia negativa (D3, decisión b). Toma `bloquearArticuloPt` +
 * `existenciaPtBloqueada` por cada artículo DENTRO de la transacción (concurrencia: dos entregas del
 * mismo artículo no se cuelan entre la lectura y la escritura — base de "no entregar lo que no
 * existe"). Suma DIRECTA de `MovimientoDetPt`, NUNCA la vista (ADR-0010 §3). Mismo patrón que
 * `validarNoNegativo` de `inventarios/movimientos-pt.ts` (locks en orden DETERMINISTA por
 * color→talla para evitar deadlock entre entregas concurrentes).
 */
async function validarNoNegativo(
  tx: Tx,
  idEmpresa: number,
  idAlmacen: number,
  idModelo: number,
  idOrden: number,
  celdas: Celda[],
): Promise<void> {
  const ordenadas = [...celdas].sort((a, b) => a.idColor - b.idColor || a.idTalla - b.idTalla);
  for (const c of ordenadas) {
    // PT por orden (F6-E2): valida contra el saldo de ESA orden, no contra el total del modelo.
    await bloquearArticuloPt(tx, idEmpresa, idAlmacen, idModelo, c.idColor, c.idTalla, idOrden);
    const existencia = await existenciaPtBloqueada(
      tx,
      idEmpresa,
      idAlmacen,
      idModelo,
      c.idColor,
      c.idTalla,
      idOrden,
    );
    if (existencia - c.cantidad < 0) {
      throw new ErrorConflicto(
        `No hay existencia suficiente para entregar: se intenta sacar ${c.cantidad} pza(s) de un ` +
          `artículo con ${existencia} en existencia de esta orden en el almacén (no se permite dejar negativo).`,
      );
    }
  }
}

/** Resuelve un tipo de movimiento por su `codigo`, exigiéndolo activo. Lanza si no existe/inactivo. */
async function tipoPorCodigo(tx: Tx, codigo: string): Promise<{ id: number; nombre: string }> {
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
  return { id: tipo.id, nombre: tipo.nombre };
}

// ── Proyección a la salida ─────────────────────────────────────────────────────────────────────

/** `include` para proyectar una entrega con su matriz + nombres legibles. El almacén de ORIGEN se
 * persiste en `idAlmacenPrimeras` (reuso, sin migración — ver TSDoc del módulo). */
const incluirEntrega = {
  orden: { select: { folio: true, idModelo: true, idCliente: true } },
  almacenPrimeras: { select: { nombre: true } },
  detalles: {
    orderBy: [{ idColor: 'asc' }, { idTalla: 'asc' }],
    include: {
      color: { select: { nombre: true } },
      talla: { select: { etiqueta: true, orden: true } },
    },
  },
} satisfies Prisma.EtapaMovimientoInclude;

type EntregaConDetalle = Prisma.EtapaMovimientoGetPayload<{ include: typeof incluirEntrega }>;

/**
 * Proyecta una entrega (con detalle) a la forma JSON del contrato. Los totales se DERIVAN por suma.
 * El modelo/cliente de la entrega son los de la orden; el nombre del modelo/cliente se trae aparte
 * con un cliente de lectura (para no atar el `include` a relaciones poco usadas en la escritura).
 */
async function aEntregaSalida(
  entrega: EntregaConDetalle,
  bd: ContextoBd | undefined,
): Promise<EntregaClienteSalida> {
  const cliente = clienteLectura(bd);

  // Movimiento de kardex (salida de PT) generado por la entrega, trazado por origen.
  const movimiento = await cliente.movimiento.findFirst({
    where: { origenTipo: ORIGEN.entregaCliente, origenId: String(entrega.id) },
    select: { id: true },
    orderBy: { id: 'asc' },
  });

  const idModelo = entrega.orden.idModelo;
  const idCliente = entrega.orden.idCliente;
  const [modelo, clienteNeg] = await Promise.all([
    cliente.modelo.findUnique({ where: { id: idModelo }, select: { codigo: true } }),
    cliente.cliente.findUnique({ where: { id: idCliente }, select: { nombre: true } }),
  ]);

  const porColor = new Map<number, { color: string; tallas: EntregaConDetalle['detalles'] }>();
  for (const det of entrega.detalles) {
    const grupo = porColor.get(det.idColor) ?? { color: det.color.nombre, tallas: [] };
    grupo.tallas.push(det);
    porColor.set(det.idColor, grupo);
  }

  let totalPiezas = 0;
  const lineas = [...porColor.entries()].map(([idColor, grupo]) => {
    let totalLinea = 0;
    const tallas = grupo.tallas
      .slice()
      .sort((a, b) => a.talla.orden - b.talla.orden || a.idTalla - b.idTalla)
      .map((t) => {
        totalLinea += t.cantidad;
        return { idTalla: t.idTalla, etiquetaTalla: t.talla.etiqueta, cantidad: t.cantidad };
      });
    totalPiezas += totalLinea;
    return { idColor, color: grupo.color, tallas, totalPiezas: totalLinea };
  });

  return {
    id: entrega.id,
    folio: Number(entrega.folio),
    idEmpresa: entrega.idEmpresa,
    idOrden: entrega.idOrden,
    folioOrden: Number(entrega.orden.folio),
    idModelo,
    modelo: modelo?.codigo ?? '',
    idCliente,
    cliente: clienteNeg?.nombre ?? null,
    idAlmacen: entrega.idAlmacenPrimeras,
    almacen: entrega.almacenPrimeras?.nombre ?? null,
    fecha: entrega.fecha.toISOString().slice(0, 10),
    observaciones: entrega.observaciones,
    cancelado: entrega.canceladoEn !== null,
    canceladoEn: entrega.canceladoEn === null ? null : entrega.canceladoEn.toISOString(),
    canceladoPorId: entrega.canceladoPorId,
    motivoCancelacion: entrega.motivoCancelacion,
    idMovimientoSalida: movimiento?.id ?? null,
    lineas,
    totalPiezas,
    creadoEn: entrega.creadoEn.toISOString(),
    creadoPorId: entrega.creadoPorId,
  };
}

/** Emite un evento de entrega post-commit, best-effort (gancho RC F5). */
async function emitirEntrega(evento: NombreEvento, etapa: EtapaMovimiento): Promise<void> {
  await emitir(evento, {
    idEtapaMovimiento: etapa.id,
    idOrden: etapa.idOrden,
    idEmpresa: etapa.idEmpresa,
    tipo: etapa.tipo,
    idTipoProceso: etapa.idTipoProceso,
  });
}

/**
 * Escribe en el OUTBOX DURABLE el evento de entrega que consume el auto-avance de la RC (F5-E6), en
 * la MISMA transacción del hecho (atómico). Gancho REAL de F5: la RC re-evalúa `entregaCliente`
 * (parcial mientras falte por entregar; completa cuando se entrega todo lo pedido).
 */
async function registrarEventoEtapaRc(
  tx: Tx,
  evento: (typeof EVENTOS_OUTBOX)[keyof typeof EVENTOS_OUTBOX],
  datos: EventoEtapaRc,
): Promise<void> {
  await registrarEventoOutbox(tx, evento, VERSION_EVENTO_ETAPA_RC, datos.idEmpresa, datos);
}

// ── Operaciones ───────────────────────────────────────────────────────────────────────────────

/** Alta de entrega: campos del esquema compartido. */
export type EntradaRegistrarEntrega = z.input<typeof esquemaEntregaClienteCrear>;

/**
 * Registra una ENTREGA a cliente (doc 03-Produccion "Entrega"). En UNA transacción (A2): crea la
 * etapa + detalle color×talla, valida no-negativo ESTRICTO bajo lock (decisión b), genera la SALIDA
 * de kardex PT (origen entregaCliente) del modelo de la orden en el almacén elegido, bitácora.
 * Emite `entrega-registrado` post-commit. El seguimiento del pedido (entregado/faltante) NO se
 * escribe: se DERIVA en {@link seguimientoEntregaOrden}.
 */
export async function registrarEntregaCliente(
  sesion: SesionUsuario,
  entrada: EntradaRegistrarEntrega,
  bd?: ContextoBd,
): Promise<EntregaClienteSalida> {
  verificarPermiso(sesion, 'produccion.entrega');
  const datos = validarEntrada(esquemaEntregaClienteCrear, entrada);

  const idEntrega = await enTransaccion(async (tx) => {
    const orden = await resolverOrden(tx, datos.idOrden, sesion.idEmpresaActiva);
    const celdas = aplanarYValidar(datos.lineas, orden);

    await exigirAlmacen(tx, datos.idAlmacen, orden.idEmpresa);

    // Concurrencia + decisión (b): bloquea por artículo y valida no-negativo por suma directa
    // (nunca la vista) DENTRO de la transacción → dos entregas del mismo artículo no dejan negativo.
    await validarNoNegativo(
      tx,
      orden.idEmpresa,
      datos.idAlmacen,
      orden.idModelo,
      datos.idOrden,
      celdas,
    );

    const folio = await siguienteFolio(tx, orden.idEmpresa, CLAVE_SECUENCIA_ETAPA);
    const entrega = await tx.etapaMovimiento.create({
      data: {
        folio,
        idEmpresa: orden.idEmpresa,
        idOrden: datos.idOrden,
        tipo: TipoEtapaMovimiento.entrega_cliente,
        // idTipoProceso/idTercero NULL en una entrega a cliente (no es maquila). El almacén de
        // ORIGEN se guarda en `idAlmacenPrimeras` (reuso, sin migración — ver TSDoc del módulo).
        idAlmacenPrimeras: datos.idAlmacen,
        fecha: aDateColumna(datos.fecha),
        ...(datos.observaciones === undefined ? {} : { observaciones: datos.observaciones }),
        detalles: {
          create: celdas.map((c) => ({
            idColor: c.idColor,
            idTalla: c.idTalla,
            cantidad: c.cantidad,
          })),
        },
        ...datosCreacion(sesion),
      },
    });

    // SALIDA de kardex PT vía el motor (dentro de ESTA transacción, { tx }). Modelo = el de la orden.
    const tipoSalida = await tipoPorCodigo(tx, COD_ENTREGA_CLIENTE);
    const lineasMotor = celdas.map<LineaMovimientoPt>((c) => ({
      idModelo: orden.idModelo,
      idColor: c.idColor,
      idTalla: c.idTalla,
      idOrden: datos.idOrden,
      cantidad: c.cantidad,
    }));
    await registrarMovimientoPtMotor(
      sesion,
      {
        idEmpresa: orden.idEmpresa,
        idTipoMov: tipoSalida.id,
        idAlmacen: datos.idAlmacen,
        fecha: aDateColumna(datos.fecha),
        origenTipo: ORIGEN.entregaCliente,
        origenId: String(entrega.id),
        lineas: lineasMotor,
      },
      { tx },
    );

    await registrarBitacora(tx, sesion, {
      entidad: 'EtapaMovimiento',
      idEntidad: entrega.id,
      accion: 'CREAR',
      datos: {
        tipo: 'entrega_cliente',
        folio: Number(folio),
        idOrden: datos.idOrden,
        idAlmacen: datos.idAlmacen,
        celdas: celdas.length,
        totalEntregado: celdas.reduce((s, c) => s + c.cantidad, 0),
      },
    });

    // OUTBOX (F5-E6): dispara el auto-avance de la RC (`entregaCliente`).
    await registrarEventoEtapaRc(tx, EVENTOS_OUTBOX.entregaClienteRegistrada, {
      idEmpresa: orden.idEmpresa,
      idOrden: datos.idOrden,
      idEtapaMovimiento: entrega.id,
      tipoEtapa: TipoEtapaMovimiento.entrega_cliente,
      idTipoProceso: null,
    });

    return entrega.id;
  }, bd);

  const salida = await obtenerEntrega(sesion, idEntrega, bd);
  await emitirEntregaPorId(idEntrega, EVENTOS_PRODUCCION.entregaRegistrado, bd);
  dispararPublicacion();
  return salida;
}

/**
 * CANCELA (suave) una entrega a cliente: setea `canceladoEn`/`canceladoPorId`/`motivoCancelacion` +
 * bitácora (A7). La entrega NUNCA se borra ni se edita. Reglas:
 *  • solo entregas de la EMPRESA ACTIVA (A9), no re-cancelables;
 *  • REVIERTE la salida de PT con movimiento(s) INVERSO(s) auditados (NUNCA edita/borra el original
 *    — D3): un inverso (entrada) por cada movimiento de salida que generó (tipo `error-salida`).
 * Los pendientes del pedido (derivados) se recalculan solos: una entrega cancelada deja de sumar.
 */
export async function cancelarEntregaCliente(
  sesion: SesionUsuario,
  idEntrega: number,
  cuerpo: z.input<typeof esquemaEntregaClienteCancelarCuerpo>,
  bd?: ContextoBd,
): Promise<EntregaClienteSalida> {
  verificarPermiso(sesion, 'produccion.cancelar');
  const datos = validarEntrada(esquemaEntregaClienteCancelarCuerpo, cuerpo);

  await enTransaccion(async (tx) => {
    const entrega = await tx.etapaMovimiento.findFirst({
      where: { id: idEntrega, idEmpresa: sesion.idEmpresaActiva },
      select: { id: true, tipo: true, idOrden: true, canceladoEn: true, folio: true },
    });
    if (entrega === null) {
      throw new ErrorNoEncontrado('EtapaMovimiento', idEntrega);
    }
    if (entrega.tipo !== TipoEtapaMovimiento.entrega_cliente) {
      throw new ErrorValidacion('Esta operación solo cancela entregas a cliente.');
    }
    if (entrega.canceladoEn !== null) {
      throw new ErrorConflicto(`La entrega ${Number(entrega.folio)} ya está cancelada.`);
    }

    // Revierte la(s) SALIDA(s) de PT que generó la entrega con inverso(s) de entrada (re-entra lo que
    // salió). El inverso es un movimiento de corrección: SIEMPRE puede registrarse (no valida tope).
    const movimientos = await tx.movimiento.findMany({
      where: {
        origenTipo: ORIGEN.entregaCliente,
        origenId: String(idEntrega),
        idMovimientoInverso: null, // los inversos no se re-cancelan
      },
      select: { id: true, anuladoPor: { select: { id: true } } },
    });
    const tipoInverso = await tipoPorCodigo(tx, COD_ERROR_SALIDA);
    for (const mov of movimientos) {
      if (mov.anuladoPor.length > 0) continue; // ya estaba anulado (defensivo)
      await cancelarMovimientoPtMotor(sesion, mov.id, tipoInverso.id, { tx });
    }

    // Cancelación suave de la entrega (WIP).
    await tx.etapaMovimiento.update({
      where: { id: idEntrega },
      data: {
        canceladoEn: new Date(),
        canceladoPorId: sesion.id,
        motivoCancelacion: datos.motivo,
        ...datosModificacion(sesion),
      },
    });

    await registrarBitacora(tx, sesion, {
      entidad: 'EtapaMovimiento',
      idEntidad: idEntrega,
      accion: 'CANCELAR',
      datos: {
        tipo: 'entrega_cliente',
        folio: Number(entrega.folio),
        motivo: datos.motivo,
        movimientosRevertidos: movimientos.length,
      },
    });

    // OUTBOX (F5-E6, decisión (f)): la cancelación re-evalúa `entregaCliente`; si ya no está cubierto,
    // lo des-completa y recalcula el CPM.
    await registrarEventoEtapaRc(tx, EVENTOS_OUTBOX.entregaClienteCancelada, {
      idEmpresa: sesion.idEmpresaActiva,
      idOrden: entrega.idOrden,
      idEtapaMovimiento: entrega.id,
      tipoEtapa: TipoEtapaMovimiento.entrega_cliente,
      idTipoProceso: null,
    });
  }, bd);

  dispararPublicacion();
  return obtenerEntrega(sesion, idEntrega, bd);
}

/** Obtiene una entrega (con su matriz) de la empresa activa, o lanza `ErrorNoEncontrado` (A9). */
export async function obtenerEntrega(
  sesion: SesionUsuario,
  idEntrega: number,
  bd?: ContextoBd,
): Promise<EntregaClienteSalida> {
  verificarPermiso(sesion, 'produccion.wip-ver');
  const entrega = await clienteLectura(bd).etapaMovimiento.findFirst({
    where: {
      id: idEntrega,
      idEmpresa: sesion.idEmpresaActiva,
      tipo: TipoEtapaMovimiento.entrega_cliente,
    },
    include: incluirEntrega,
  });
  if (entrega === null) {
    throw new ErrorNoEncontrado('EtapaMovimiento', idEntrega);
  }
  return aEntregaSalida(entrega, bd);
}

/** Re-lee la entrega para emitir su evento post-commit (best-effort). */
async function emitirEntregaPorId(
  idEntrega: number,
  evento: NombreEvento,
  bd?: ContextoBd,
): Promise<void> {
  const etapa = await clienteLectura(bd).etapaMovimiento.findUnique({ where: { id: idEntrega } });
  if (etapa !== null) {
    await emitirEntrega(evento, etapa);
  }
}

/**
 * HISTORIAL de entregas de una orden de la empresa activa (A9): VIVAS y CANCELADAS (las canceladas
 * se conservan como historial, marcadas). Cada entrega trae su matriz color×talla. Ordenado por
 * folio descendente (lo más reciente primero). Solo lectura (`produccion.wip-ver`).
 */
export async function listarEntregasOrden(
  sesion: SesionUsuario,
  idOrden: number,
  bd?: ContextoBd,
): Promise<EntregasOrdenLista> {
  verificarPermiso(sesion, 'produccion.wip-ver');
  const cliente = clienteLectura(bd);

  const orden = await cliente.orden.findFirst({
    where: { id: idOrden, idEmpresa: sesion.idEmpresaActiva },
    select: { id: true, folio: true },
  });
  if (orden === null) {
    throw new ErrorNoEncontrado('Orden', idOrden);
  }

  const entregas = await cliente.etapaMovimiento.findMany({
    where: {
      idOrden,
      idEmpresa: sesion.idEmpresaActiva,
      tipo: TipoEtapaMovimiento.entrega_cliente,
    },
    orderBy: { folio: 'desc' },
    include: incluirEntrega,
  });

  return {
    idOrden,
    folioOrden: Number(orden.folio),
    entregas: await Promise.all(entregas.map((e) => aEntregaSalida(e, bd))),
  };
}

/** Parámetros del seguimiento de entrega (forma de dominio, ya coaccionada). */
export type ParametrosSeguimientoEntrega = z.input<typeof esquemaSeguimientoEntregaQuery>;

/**
 * SEGUIMIENTO DERIVADO de la entrega de una orden (F3-E5, cierre del ciclo; espíritu D3, sin
 * acumuladores): por color×talla, lo PEDIDO (de la matriz de la orden), lo ENTREGADO (Σ entregas
 * VIVAS de la orden) y el FALTANTE (pedido − entregado). Si la pantalla pasa un `idAlmacen`, agrega
 * el `disponible` (existencia ahí) para acotar la matriz de captura. NO escribe a ninguna columna:
 * es PURO cálculo. Solo lectura (`produccion.wip-ver`); empresa activa (A9).
 */
export async function seguimientoEntregaOrden(
  sesion: SesionUsuario,
  idOrden: number,
  parametros: ParametrosSeguimientoEntrega = {},
  bd?: ContextoBd,
): Promise<SeguimientoEntregaOrden> {
  verificarPermiso(sesion, 'produccion.wip-ver');
  const filtros = validarEntrada(esquemaSeguimientoEntregaQuery, parametros);
  const cliente = clienteLectura(bd);
  const idEmpresa = sesion.idEmpresaActiva;

  const orden = await cliente.orden.findFirst({
    where: { id: idOrden, idEmpresa },
    select: {
      folio: true,
      idModelo: true,
      idCliente: true,
      modelo: { select: { codigo: true } },
      cliente: { select: { nombre: true } },
      lineas: {
        select: {
          idColor: true,
          color: { select: { nombre: true } },
          tallas: {
            select: {
              idTalla: true,
              cantidad: true,
              talla: { select: { etiqueta: true, orden: true } },
            },
          },
        },
      },
    },
  });
  if (orden === null) {
    throw new ErrorNoEncontrado('Orden', idOrden);
  }

  // Metadatos + lo pedido por celda (de la orden).
  interface MetaCelda {
    idColor: number;
    color: string;
    idTalla: number;
    etiquetaTalla: string;
    ordenTalla: number;
  }
  const meta = new Map<string, MetaCelda>();
  const pedido = new Map<string, number>();
  for (const linea of orden.lineas) {
    for (const t of linea.tallas) {
      const clave = claveCelda(linea.idColor, t.idTalla);
      pedido.set(clave, (pedido.get(clave) ?? 0) + t.cantidad);
      if (!meta.has(clave)) {
        meta.set(clave, {
          idColor: linea.idColor,
          color: linea.color.nombre,
          idTalla: t.idTalla,
          etiquetaTalla: t.talla.etiqueta,
          ordenTalla: t.talla.orden,
        });
      }
    }
  }

  // ENTREGADO por celda = Σ detalle de las entregas VIVAS de la orden (suma directa, sin la vista).
  const detEntregas = await cliente.etapaMovimientoDet.findMany({
    where: {
      etapaMov: {
        idOrden,
        tipo: TipoEtapaMovimiento.entrega_cliente,
        canceladoEn: null,
      },
    },
    select: { idColor: true, idTalla: true, cantidad: true },
  });
  const entregado = new Map<string, number>();
  for (const d of detEntregas) {
    const clave = claveCelda(d.idColor, d.idTalla);
    entregado.set(clave, (entregado.get(clave) ?? 0) + d.cantidad);
  }

  // DISPONIBLE por celda (opcional): existencia del modelo en el almacén pedido, vía la vista (es
  // una CONSULTA, ADR-0010 §3). Solo si la pantalla pasó un almacén.
  const disponible = new Map<string, number>();
  if (filtros.idAlmacen !== undefined) {
    const filas = await cliente.$queryRaw<
      { idColor: number; idTalla: number; existencia: bigint }[]
    >`
      SELECT e."id_color" AS "idColor", e."id_talla" AS "idTalla", e."existencia" AS "existencia"
      FROM "existencia_pt" e
      WHERE e."id_empresa" = ${idEmpresa}
        AND e."id_modelo" = ${orden.idModelo}
        AND e."id_almacen" = ${filtros.idAlmacen}
        AND e."id_orden" = ${idOrden}
    `;
    for (const f of filas) {
      disponible.set(claveCelda(f.idColor, f.idTalla), Number(f.existencia));
    }
  }

  const celdas = [...pedido.keys()]
    .map((clave) => {
      const m = meta.get(clave);
      const idColor = m?.idColor ?? Number(clave.split(':')[0] ?? 0);
      const idTalla = m?.idTalla ?? Number(clave.split(':')[1] ?? 0);
      const cantPedido = pedido.get(clave) ?? 0;
      const cantEntregado = entregado.get(clave) ?? 0;
      return {
        idColor,
        color: m?.color ?? `Color ${idColor}`,
        idTalla,
        etiquetaTalla: m?.etiquetaTalla ?? '',
        ordenTalla: m?.ordenTalla ?? 0,
        pedido: cantPedido,
        entregado: cantEntregado,
        faltante: cantPedido - cantEntregado,
        disponible: disponible.get(clave) ?? 0,
      };
    })
    .sort((a, b) => a.idColor - b.idColor || a.ordenTalla - b.ordenTalla || a.idTalla - b.idTalla)
    .map(({ ordenTalla: _o, ...resto }) => resto);

  const totalPedido = [...pedido.values()].reduce((s, v) => s + v, 0);
  const totalEntregado = [...entregado.values()].reduce((s, v) => s + v, 0);

  return {
    idOrden,
    folioOrden: Number(orden.folio),
    idCliente: orden.idCliente,
    cliente: orden.cliente?.nombre ?? null,
    idModelo: orden.idModelo,
    modelo: orden.modelo?.codigo ?? '',
    celdas,
    totalPedido,
    totalEntregado,
    totalFaltante: totalPedido - totalEntregado,
  };
}
