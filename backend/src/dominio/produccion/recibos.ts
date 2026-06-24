/**
 * RECIBO de maquila (F3-E4; doc 03-Produccion Paso 5 + flujo paralelo de estampado, Observación 4).
 * Es la etapa ⭐ CENTRAL de F3: de UNA captura se derivan varios efectos según el `TipoProceso`
 * (PLANMAESTRO §5 "punto de integración central"). Toda la lógica de negocio vive AQUÍ (A1); las
 * rutas REST solo validan permiso + Zod y delegan. Esta capa ORQUESTA el motor de kardex
 * (`comun/kardex.ts`) — que es el ÚNICO que escribe `Movimiento`/`MovimientoDetPt` — pero pone las
 * VALIDACIONES de negocio del recibo (no recibir más de lo enviado) y deriva sus efectos.
 *
 * De un recibo se derivan, en UNA sola transacción (A2):
 *  1. `EtapaMovimiento(recibo_maquila)` + `EtapaMovimientoDet` color×talla con CALIDAD
 *     (primeras/segundas) → el WIP "recibido" SUBE (derivado por suma, sin acumuladores).
 *  2. Validación `recibido ≤ enviado` ESTRICTO (decisión (g)): por suma directa de
 *     `EtapaMovimientoDet` bajo bloqueo de la orden, excluyendo canceladas — NUNCA la vista.
 *  3. SOLO si `TipoProceso.generaEntradaPt` (costura): la ENTRADA al kardex PT vía el motor —
 *     primeras → almacén de primeras, segundas → almacén de segundas (tipo `entrada-maquila`,
 *     origen recibo, costoUnit NULL D1/D2). Reemplaza el viejo `MeterInventario`/bandera
 *     "Inventariado": recibir = ya queda en inventario en la MISMA transacción (mejora A1).
 *  4. `EsMaCargo(propuesto)` para TODO proceso (costura Y estampado): cantidad recibida × precio
 *     del envío (el precio puede nacer NULL — por eso la validación del admin es obligatoria, F3-E4).
 *  5. Evento `recibo-registrado` post-commit (gancho RC F5, sin consumidores hoy).
 *
 * Innegociables aplicados:
 *  • A1 — la lógica vive aquí; las rutas son delgadas.
 *  • A2 — encabezado + detalle + kardex + cargo + bitácora en UNA transacción.
 *  • A3 — folio del recibo por la secuencia atómica "etapa-mov" (la misma de corte/envío); el folio
 *    del movimiento de kardex lo da el motor (secuencia "movimiento"). Nunca Max()+1.
 *  • A4 — `produccion.recibo` para capturar; `produccion.wip-ver` para consultar; `produccion.cancelar`
 *    para cancelar (+ `esma.cargo-validar` si el cargo ya estaba validado).
 *  • A7 — bitácora uniforme dentro de la transacción.
 *  • A9 — todo se filtra/sella por la empresa de la ORDEN, que debe ser la empresa activa.
 *  • D3 — la existencia es Σ de movimientos; el recibo NUNCA edita existencia: registra movimientos.
 *  • D4 — toda etapa del WIP se captura por color×talla.
 */
import {
  esquemaReciboCrear,
  esquemaReciboCancelarCuerpo,
  esquemaRecibosSemanalesQuery,
  type DatosReciboLineaEntrada,
  type ReciboSalida,
  type PendientesRecibir,
  type RecibosSemanalesLista,
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
  cancelarMovimientoPt as cancelarMovimientoPtMotor,
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

/** Tipo de movimiento de kardex para la entrada a PT del recibo de costura (seed, dirección entrada). */
const COD_ENTRADA_MAQUILA = 'entrada-maquila';
/** Tipo inverso (salida) para revertir la entrada del recibo al cancelar (dirección salida). */
const COD_ERROR_ENTRADA = 'error-entrada';

/**
 * MAPEO `TipoProceso.codigo` → `RolProveedor.codigo` (fusión de terceros, D12/R15; espejo del de
 * `etapas.ts`). El maquilero de un recibo debe TENER el rol que mapea a su proceso.
 */
const MAPEO_PROCESO_A_ROL: Record<string, string> = {
  costura: 'maquila-costura',
  estampado: 'estampado',
  bordado: 'bordado',
  lavado: 'lavado',
  aplicacion: 'aplicacion',
};

/** El rol de proveedor requerido para un proceso, o el código tal cual si no hay mapeo. */
function rolDelProceso(codigoProceso: string): string {
  return MAPEO_PROCESO_A_ROL[codigoProceso] ?? codigoProceso;
}

// ── Tipos internos ──────────────────────────────────────────────────────────────────────────────

/** Una celda color×talla "aplanada" con su calidad (un renglón por talla). */
interface CeldaRecibo {
  idColor: number;
  idTalla: number;
  cantidad: number;
  primeras: number;
  segundas: number;
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

/** Datos de la orden necesarios para validar un recibo: empresa, estado y combinaciones válidas. */
interface ContextoOrden {
  idEmpresa: number;
  estado: string;
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
  return { idEmpresa: orden.idEmpresa, estado: orden.estado, colores, tallasPorColor };
}

/**
 * Aplana la matriz del recibo a celdas, validando SANIDAD (D4): color/talla SIN repetir, que cada
 * color×talla PERTENEZCA a la orden, y la CALIDAD: si una celda trae desglose, primeras+segundas =
 * cantidad. Si no trae desglose, todo es primera (segundas 0). Descarta celdas con cantidad 0.
 */
function aplanarYValidar(lineas: DatosReciboLineaEntrada[], orden: ContextoOrden): CeldaRecibo[] {
  const idsColor = lineas.map((l) => l.idColor);
  if (new Set(idsColor).size !== idsColor.length) {
    throw new ErrorValidacion('Un color no puede aparecer dos veces en la misma captura.');
  }

  const celdas: CeldaRecibo[] = [];
  for (const linea of lineas) {
    if (!orden.colores.has(linea.idColor)) {
      throw new ErrorValidacion(
        `El color ${linea.idColor} no pertenece a la orden; solo se reciben colores de la orden.`,
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
      if (t.cantidad === 0) continue;

      // Calidad: si no viene desglose, todo es primera. Si viene parcial, se completa con el resto.
      const tieneDesglose = t.cantidadPrimeras !== undefined || t.cantidadSegundas !== undefined;
      let primeras: number;
      let segundas: number;
      if (!tieneDesglose) {
        primeras = t.cantidad;
        segundas = 0;
      } else {
        primeras = t.cantidadPrimeras ?? 0;
        segundas = t.cantidadSegundas ?? 0;
        if (primeras + segundas !== t.cantidad) {
          throw new ErrorValidacion(
            `La calidad del color ${linea.idColor}/talla ${t.idTalla} no cuadra: primeras (${primeras}) + ` +
              `segundas (${segundas}) debe sumar el total recibido (${t.cantidad}).`,
          );
        }
      }
      celdas.push({
        idColor: linea.idColor,
        idTalla: t.idTalla,
        cantidad: t.cantidad,
        primeras,
        segundas,
      });
    }
  }
  if (celdas.length === 0) {
    throw new ErrorValidacion('La captura no tiene ninguna pieza (todas las cantidades son 0).');
  }
  return celdas;
}

/**
 * Valida y resuelve el MAQUILERO de un recibo: existe, está activo y TIENE el rol del proceso
 * (D12/R15). Lanza errores claros.
 */
async function exigirMaquileroConRol(
  tx: Tx,
  idMaquilero: number,
  codigoRol: string,
  etiquetaRol: string,
): Promise<void> {
  const prov = await tx.proveedor.findUnique({
    where: { id: idMaquilero },
    select: {
      activo: true,
      nombre: true,
      roles: { select: { rol: { select: { codigo: true, activo: true } } } },
    },
  });
  if (prov === null) {
    throw new ErrorNoEncontrado('Proveedor', idMaquilero);
  }
  if (!prov.activo) {
    throw new ErrorConflicto(`El proveedor "${prov.nombre}" está desactivado.`);
  }
  const tieneRol = prov.roles.some((r) => r.rol.codigo === codigoRol && r.rol.activo);
  if (!tieneRol) {
    throw new ErrorValidacion(
      `El proveedor "${prov.nombre}" no tiene el rol "${etiquetaRol}"; no puede entregar este recibo.`,
    );
  }
}

/**
 * Bloqueo de las etapas de una ORDEN dentro de la transacción (concurrencia, decisión (g)). MISMA
 * fórmula que `etapas.ts` para que el recibo y el envío de la MISMA orden se serialicen entre sí:
 * así "enviado disponible por recibir" es consistente y dos recibos concurrentes no exceden lo
 * enviado. El lock se libera al commit.
 */
async function bloquearEtapasDeOrden(tx: Tx, idEmpresa: number, idOrden: number): Promise<void> {
  const clave1 = ((idEmpresa * 1_000_003) ^ 0x4f000000) | 0;
  const clave2 = idOrden | 0;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${clave1}::int, ${clave2}::int)`;
}

/**
 * Suma las celdas color×talla de las etapas VIVAS (no canceladas) de una orden que cumplan el filtro
 * de tipo/proceso, leyendo `EtapaMovimientoDet` DIRECTO (sin acumuladores; ADR-0010 §3). Base de
 * "enviado" y "recibido" por proceso para el `recibido ≤ enviado` y los pendientes.
 */
async function sumarCeldas(
  tx: Tx | ReturnType<typeof clienteLectura>,
  idOrden: number,
  tipo: TipoEtapaMovimiento,
  idTipoProceso: number,
): Promise<Map<string, number>> {
  const filas = await tx.etapaMovimientoDet.findMany({
    where: { etapaMov: { idOrden, tipo, idTipoProceso, canceladoEn: null } },
    select: { idColor: true, idTalla: true, cantidad: true },
  });
  const acumulado = new Map<string, number>();
  for (const f of filas) {
    const clave = claveCelda(f.idColor, f.idTalla);
    acumulado.set(clave, (acumulado.get(clave) ?? 0) + f.cantidad);
  }
  return acumulado;
}

// ── Proyección a la salida ─────────────────────────────────────────────────────────────────────

/** `include` para proyectar un recibo con su matriz + nombres legibles. */
const incluirRecibo = {
  orden: { select: { folio: true } },
  tipoProceso: { select: { nombre: true, generaEntradaPt: true } },
  tercero: { select: { nombre: true } },
  almacenPrimeras: { select: { nombre: true } },
  almacenSegundas: { select: { nombre: true } },
  detalles: {
    orderBy: [{ idColor: 'asc' }, { idTalla: 'asc' }],
    include: {
      color: { select: { nombre: true } },
      talla: { select: { etiqueta: true, orden: true } },
    },
  },
} satisfies Prisma.EtapaMovimientoInclude;

type ReciboConDetalle = Prisma.EtapaMovimientoGetPayload<{ include: typeof incluirRecibo }>;

/** Proyecta un recibo (con detalle) a la forma JSON del contrato. Los totales se DERIVAN por suma. */
async function aReciboSalida(
  recibo: ReciboConDetalle,
  bd: ContextoBd | undefined,
): Promise<ReciboSalida> {
  // PRIMER movimiento de kardex generado por el recibo (si lo hubo), trazado por origen recibo. Un
  // recibo de costura con primeras Y segundas genera DOS movimientos de entrada (uno por almacén);
  // aquí se expone solo el primero como indicador de "sí metió a PT" (la cancelación, en cambio, los
  // revierte TODOS con `findMany`). El nombre `idMovimientoEntrada` es singular a propósito: es un
  // INDICADOR, no la lista completa.
  const movimiento = await clienteLectura(bd).movimiento.findFirst({
    where: { origenTipo: ORIGEN.reciboMaquila, origenId: String(recibo.id) },
    select: { id: true },
    orderBy: { id: 'asc' },
  });

  const porColor = new Map<number, { color: string; tallas: ReciboConDetalle['detalles'] }>();
  for (const det of recibo.detalles) {
    const grupo = porColor.get(det.idColor) ?? { color: det.color.nombre, tallas: [] };
    grupo.tallas.push(det);
    porColor.set(det.idColor, grupo);
  }

  let totalPiezas = 0;
  let totalPrimeras = 0;
  let totalSegundas = 0;
  const lineas = [...porColor.entries()].map(([idColor, grupo]) => {
    let totalLinea = 0;
    const tallas = grupo.tallas
      .slice()
      .sort((a, b) => a.talla.orden - b.talla.orden || a.idTalla - b.idTalla)
      .map((t) => {
        totalLinea += t.cantidad;
        totalPrimeras += t.cantidadPrimeras ?? 0;
        totalSegundas += t.cantidadSegundas ?? 0;
        return {
          idTalla: t.idTalla,
          etiquetaTalla: t.talla.etiqueta,
          cantidad: t.cantidad,
          cantidadPrimeras: t.cantidadPrimeras,
          cantidadSegundas: t.cantidadSegundas,
        };
      });
    totalPiezas += totalLinea;
    return { idColor, color: grupo.color, tallas, totalPiezas: totalLinea };
  });

  return {
    id: recibo.id,
    folio: Number(recibo.folio),
    idEmpresa: recibo.idEmpresa,
    idOrden: recibo.idOrden,
    folioOrden: Number(recibo.orden.folio),
    idTipoProceso: recibo.idTipoProceso,
    tipoProceso: recibo.tipoProceso?.nombre ?? null,
    generaEntradaPt: recibo.tipoProceso?.generaEntradaPt ?? false,
    idTercero: recibo.idTercero,
    tercero: recibo.tercero?.nombre ?? null,
    idEtapaEnvio: recibo.idEtapaEnvio,
    idAlmacenPrimeras: recibo.idAlmacenPrimeras,
    almacenPrimeras: recibo.almacenPrimeras?.nombre ?? null,
    idAlmacenSegundas: recibo.idAlmacenSegundas,
    almacenSegundas: recibo.almacenSegundas?.nombre ?? null,
    fecha: recibo.fecha.toISOString().slice(0, 10),
    precioPactado: recibo.precioPactado === null ? null : recibo.precioPactado.toNumber(),
    observaciones: recibo.observaciones,
    cancelado: recibo.canceladoEn !== null,
    canceladoEn: recibo.canceladoEn === null ? null : recibo.canceladoEn.toISOString(),
    canceladoPorId: recibo.canceladoPorId,
    motivoCancelacion: recibo.motivoCancelacion,
    idMovimientoEntrada: movimiento?.id ?? null,
    lineas,
    totalPiezas,
    totalPrimeras,
    totalSegundas,
    creadoEn: recibo.creadoEn.toISOString(),
    creadoPorId: recibo.creadoPorId,
  };
}

/** Emite un evento de recibo post-commit, best-effort (gancho RC F5). */
async function emitirRecibo(evento: NombreEvento, etapa: EtapaMovimiento): Promise<void> {
  await emitir(evento, {
    idEtapaMovimiento: etapa.id,
    idOrden: etapa.idOrden,
    idEmpresa: etapa.idEmpresa,
    tipo: etapa.tipo,
    idTipoProceso: etapa.idTipoProceso,
  });
}

/**
 * Escribe en el OUTBOX DURABLE el evento de etapa que consume el auto-avance de la RC (F5-E6), en la
 * MISMA transacción del recibo (atómico). Es el gancho REAL de F5 para el recibo de maquila — el
 * punto de integración central (PLANMAESTRO §5): WIP + IPT + EsMa + RC en UNA transacción. El
 * consumidor relee las cantidades; aquí solo viaja a qué orden/proceso apunta.
 */
async function registrarEventoEtapaRc(
  tx: Tx,
  evento: (typeof EVENTOS_OUTBOX)[keyof typeof EVENTOS_OUTBOX],
  datos: EventoEtapaRc,
): Promise<void> {
  await registrarEventoOutbox(tx, evento, VERSION_EVENTO_ETAPA_RC, datos.idEmpresa, datos);
}

// ── Operaciones ───────────────────────────────────────────────────────────────────────────────

/** Alta de recibo: campos del esquema compartido. */
export type EntradaRegistrarRecibo = z.input<typeof esquemaReciboCrear>;

/**
 * Registra un RECIBO de maquila (doc 03-Produccion Paso 5). UN servicio para costura Y estampado,
 * parametrizado por `idTipoProceso` (D8). En UNA transacción (A2): crea la etapa + detalle con
 * calidad, valida `recibido ≤ enviado` (estricto, suma directa bajo lock), genera la entrada a PT
 * SOLO si el proceso `generaEntradaPt` (primeras y segundas a sus almacenes), y crea el `EsMaCargo`
 * propuesto para todo proceso. Emite `recibo-registrado` post-commit.
 */
export async function registrarReciboMaquila(
  sesion: SesionUsuario,
  entrada: EntradaRegistrarRecibo,
  bd?: ContextoBd,
): Promise<ReciboSalida> {
  verificarPermiso(sesion, 'produccion.recibo');
  const datos = validarEntrada(esquemaReciboCrear, entrada);

  const idRecibo = await enTransaccion(async (tx) => {
    const orden = await resolverOrden(tx, datos.idOrden, sesion.idEmpresaActiva);
    const celdas = aplanarYValidar(datos.lineas, orden);

    // Tipo de proceso activo + su código (mapeo a rol) + bandera de entrada a PT.
    const proceso = await tx.tipoProceso.findUnique({
      where: { id: datos.idTipoProceso },
      select: { codigo: true, nombre: true, activo: true, generaEntradaPt: true },
    });
    if (proceso === null) {
      throw new ErrorNoEncontrado('TipoProceso', datos.idTipoProceso);
    }
    if (!proceso.activo) {
      throw new ErrorValidacion(`El tipo de proceso "${proceso.nombre}" está desactivado.`);
    }

    await exigirMaquileroConRol(
      tx,
      datos.idMaquilero,
      rolDelProceso(proceso.codigo),
      proceso.nombre,
    );

    // Si liga un envío, debe ser de la MISMA orden+proceso y estar vivo (defensa de la liga (d)).
    if (datos.idEtapaEnvio !== undefined) {
      const envio = await tx.etapaMovimiento.findFirst({
        where: {
          id: datos.idEtapaEnvio,
          idOrden: datos.idOrden,
          idEmpresa: orden.idEmpresa,
          tipo: TipoEtapaMovimiento.envio_maquila,
          idTipoProceso: datos.idTipoProceso,
          canceladoEn: null,
        },
        select: { id: true },
      });
      if (envio === null) {
        throw new ErrorValidacion(
          'El envío ligado no existe, está cancelado o no es de esta orden y proceso.',
        );
      }
    }

    // Concurrencia + decisión (g): serializa la orden y valida recibido ≤ enviado por suma directa.
    await bloquearEtapasDeOrden(tx, orden.idEmpresa, datos.idOrden);
    const enviado = await sumarCeldas(
      tx,
      datos.idOrden,
      TipoEtapaMovimiento.envio_maquila,
      datos.idTipoProceso,
    );
    const yaRecibido = await sumarCeldas(
      tx,
      datos.idOrden,
      TipoEtapaMovimiento.recibo_maquila,
      datos.idTipoProceso,
    );
    for (const c of celdas) {
      const clave = claveCelda(c.idColor, c.idTalla);
      const disponible = (enviado.get(clave) ?? 0) - (yaRecibido.get(clave) ?? 0);
      if (c.cantidad > disponible) {
        throw new ErrorConflicto(
          `No se puede recibir ${c.cantidad} pza(s) de ese color/talla de "${proceso.nombre}": ` +
            `solo quedan ${disponible} enviada(s) sin recibir.`,
        );
      }
    }

    // Almacenes destino: solo aplican si el proceso mete a PT (costura). Si vienen para un proceso
    // que NO mete a PT, se ignoran (no se persisten): recibir estampado no toca inventario.
    const meteAPt = proceso.generaEntradaPt;
    const totalSegundas = celdas.reduce((s, c) => s + c.segundas, 0);

    // Para costura, el almacén de primeras es OBLIGATORIO (las primeras deben tener destino). El de
    // segundas solo se exige si hubo segundas.
    if (meteAPt) {
      if (datos.idAlmacenPrimeras === undefined) {
        throw new ErrorValidacion(
          'El recibo de costura necesita un almacén destino para las primeras (mete a inventario).',
        );
      }
      if (totalSegundas > 0 && datos.idAlmacenSegundas === undefined) {
        throw new ErrorValidacion(
          'Hay piezas de segunda: indica el almacén destino de las segundas.',
        );
      }
      await exigirAlmacen(tx, datos.idAlmacenPrimeras, orden.idEmpresa);
      if (datos.idAlmacenSegundas !== undefined) {
        await exigirAlmacen(tx, datos.idAlmacenSegundas, orden.idEmpresa);
      }
    }

    const idAlmacenPrimeras = meteAPt ? (datos.idAlmacenPrimeras ?? null) : null;
    const idAlmacenSegundas = meteAPt ? (datos.idAlmacenSegundas ?? null) : null;

    const folio = await siguienteFolio(tx, orden.idEmpresa, CLAVE_SECUENCIA_ETAPA);
    const recibo = await tx.etapaMovimiento.create({
      data: {
        folio,
        idEmpresa: orden.idEmpresa,
        idOrden: datos.idOrden,
        tipo: TipoEtapaMovimiento.recibo_maquila,
        idTipoProceso: datos.idTipoProceso,
        idTercero: datos.idMaquilero,
        fecha: aDateColumna(datos.fecha),
        ...(datos.idEtapaEnvio === undefined ? {} : { idEtapaEnvio: datos.idEtapaEnvio }),
        ...(idAlmacenPrimeras === null ? {} : { idAlmacenPrimeras }),
        ...(idAlmacenSegundas === null ? {} : { idAlmacenSegundas }),
        ...(datos.precioPactado == null ? {} : { precioPactado: datos.precioPactado }),
        ...(datos.observaciones === undefined ? {} : { observaciones: datos.observaciones }),
        detalles: {
          create: celdas.map((c) => ({
            idColor: c.idColor,
            idTalla: c.idTalla,
            cantidad: c.cantidad,
            cantidadPrimeras: c.primeras,
            cantidadSegundas: c.segundas,
          })),
        },
        ...datosCreacion(sesion),
      },
    });

    // (3) ENTRADA al kardex PT — SOLO si el proceso mete a PT (costura). Primeras → almacén primeras;
    // segundas → almacén segundas. El motor abre el movimiento dentro de ESTA transacción ({ tx }).
    if (meteAPt) {
      const idModelo = await modeloDeLaOrden(tx, datos.idOrden);
      const lineasPrimeras = celdas
        .filter((c) => c.primeras > 0)
        .map<LineaMovimientoPt>((c) => ({
          idModelo,
          idColor: c.idColor,
          idTalla: c.idTalla,
          cantidad: c.primeras,
        }));
      const lineasSegundas = celdas
        .filter((c) => c.segundas > 0)
        .map<LineaMovimientoPt>((c) => ({
          idModelo,
          idColor: c.idColor,
          idTalla: c.idTalla,
          cantidad: c.segundas,
        }));
      const tipoEntrada = await tipoPorCodigo(tx, COD_ENTRADA_MAQUILA);

      if (lineasPrimeras.length > 0 && idAlmacenPrimeras !== null) {
        await registrarMovimientoPtMotor(
          sesion,
          {
            idEmpresa: orden.idEmpresa,
            idTipoMov: tipoEntrada.id,
            idAlmacen: idAlmacenPrimeras,
            fecha: aDateColumna(datos.fecha),
            origenTipo: ORIGEN.reciboMaquila,
            origenId: String(recibo.id),
            lineas: lineasPrimeras,
          },
          { tx },
        );
      }
      if (lineasSegundas.length > 0 && idAlmacenSegundas !== null) {
        await registrarMovimientoPtMotor(
          sesion,
          {
            idEmpresa: orden.idEmpresa,
            idTipoMov: tipoEntrada.id,
            idAlmacen: idAlmacenSegundas,
            fecha: aDateColumna(datos.fecha),
            origenTipo: ORIGEN.reciboMaquila,
            origenId: String(recibo.id),
            lineas: lineasSegundas,
          },
          { tx },
        );
      }
    }

    // (4) CARGO EsMa propuesto para TODO proceso (costura Y estampado). cantidad = total recibido;
    // precio = el del envío (puede ser NULL → la validación del admin es obligatoria).
    const totalRecibido = celdas.reduce((s, c) => s + c.cantidad, 0);
    await tx.esMaCargo.create({
      data: {
        idEmpresa: orden.idEmpresa,
        idEtapaRecibo: recibo.id,
        idMaquilero: datos.idMaquilero,
        idOrden: datos.idOrden,
        idTipoProceso: datos.idTipoProceso,
        // cantidadReal/precioReal NULL mientras esté propuesto; el "propuesto" se deriva del recibo
        // (cantidad recibida) y del precioPactado del recibo al proyectarlo.
        estado: 'propuesto',
        ...datosCreacion(sesion),
      },
    });

    await registrarBitacora(tx, sesion, {
      entidad: 'EtapaMovimiento',
      idEntidad: recibo.id,
      accion: 'CREAR',
      datos: {
        tipo: 'recibo_maquila',
        folio: Number(folio),
        idOrden: datos.idOrden,
        idTipoProceso: datos.idTipoProceso,
        idMaquilero: datos.idMaquilero,
        generaEntradaPt: meteAPt,
        celdas: celdas.length,
        totalRecibido,
        totalSegundas,
      },
    });

    // OUTBOX (F5-E6): el gancho durable del auto-avance — escrito en la MISMA tx que WIP + IPT + EsMa
    // (punto de integración central, PLANMAESTRO §5). La RC re-evalúa `reciboCostura`/`reciboEstampado`.
    await registrarEventoEtapaRc(tx, EVENTOS_OUTBOX.reciboMaquilaRegistrado, {
      idEmpresa: orden.idEmpresa,
      idOrden: datos.idOrden,
      idEtapaMovimiento: recibo.id,
      tipoEtapa: TipoEtapaMovimiento.recibo_maquila,
      idTipoProceso: datos.idTipoProceso,
    });

    return recibo.id;
  }, bd);

  const salida = await obtenerRecibo(sesion, idRecibo, bd);
  await emitirReciboPorId(idRecibo, EVENTOS_PRODUCCION.reciboRegistrado, bd);
  dispararPublicacion();
  return salida;
}

/** Resuelve el modelo de una orden (el recibo de costura mete ese modelo al kardex). */
async function modeloDeLaOrden(tx: Tx, idOrden: number): Promise<number> {
  const orden = await tx.orden.findUnique({ where: { id: idOrden }, select: { idModelo: true } });
  if (orden === null) {
    throw new ErrorNoEncontrado('Orden', idOrden);
  }
  return orden.idModelo;
}

/** Resuelve un tipo de movimiento por su `codigo`, exigiéndolo activo. */
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

/**
 * CANCELA (suave) un recibo de maquila: setea `canceladoEn`/`canceladoPorId`/`motivoCancelacion` +
 * bitácora (A7). El recibo NUNCA se borra ni se edita. Reglas:
 *  • solo recibos de la EMPRESA ACTIVA (A9), no re-cancelables;
 *  • si el recibo generó ENTRADA a PT (costura), se REVIERTE con movimiento(s) INVERSO(s) auditados
 *    (NUNCA edita/borra el original — D3): un inverso por cada movimiento de entrada que generó;
 *  • el CARGO EsMa se cancela si NO está validado; si YA está validado, se exige el permiso especial
 *    `esma.cargo-validar` (un cargo ya validado afecta el pago — no se revierte sin autorización).
 * Los pendientes (derivados) se recalculan solos: un recibo cancelado deja de sumar.
 */
export async function cancelarReciboMaquila(
  sesion: SesionUsuario,
  idRecibo: number,
  cuerpo: z.input<typeof esquemaReciboCancelarCuerpo>,
  bd?: ContextoBd,
): Promise<ReciboSalida> {
  verificarPermiso(sesion, 'produccion.cancelar');
  const datos = validarEntrada(esquemaReciboCancelarCuerpo, cuerpo);

  await enTransaccion(async (tx) => {
    const recibo = await tx.etapaMovimiento.findFirst({
      where: { id: idRecibo, idEmpresa: sesion.idEmpresaActiva },
      select: {
        id: true,
        tipo: true,
        idOrden: true,
        idTipoProceso: true,
        canceladoEn: true,
        folio: true,
      },
    });
    if (recibo === null) {
      throw new ErrorNoEncontrado('EtapaMovimiento', idRecibo);
    }
    if (recibo.tipo !== TipoEtapaMovimiento.recibo_maquila) {
      throw new ErrorValidacion('Esta operación solo cancela recibos de maquila.');
    }
    if (recibo.canceladoEn !== null) {
      throw new ErrorConflicto(`El recibo ${Number(recibo.folio)} ya está cancelado.`);
    }

    // Serializa la orden para que la reversión del kardex y la verificación del cargo sean coherentes.
    await bloquearEtapasDeOrden(tx, sesion.idEmpresaActiva, recibo.idOrden);

    // (a) El cargo EsMa: si ya está VALIDADO, exige el permiso especial.
    const cargo = await tx.esMaCargo.findFirst({
      where: { idEtapaRecibo: idRecibo, estado: { not: 'cancelado' } },
      select: { id: true, estado: true },
    });
    if (cargo !== null && cargo.estado === 'validado') {
      // permiso especial: cancelar un recibo cuyo cargo ya se validó (afecta el pago).
      verificarPermiso(sesion, 'esma.cargo-validar');
    }

    // (b) Revierte la(s) ENTRADA(s) a PT que generó el recibo (si las generó) con inverso(s).
    const movimientos = await tx.movimiento.findMany({
      where: {
        origenTipo: ORIGEN.reciboMaquila,
        origenId: String(idRecibo),
        idMovimientoInverso: null, // los inversos no se re-cancelan
      },
      select: { id: true, anuladoPor: { select: { id: true } } },
    });
    const tipoInverso = await tipoPorCodigo(tx, COD_ERROR_ENTRADA);
    for (const mov of movimientos) {
      if (mov.anuladoPor.length > 0) continue; // ya estaba anulado (defensivo)
      // El motor crea el inverso (salida) enlazado al original; existencia se neutraliza (D3).
      await cancelarMovimientoPtMotor(sesion, mov.id, tipoInverso.id, { tx });
    }

    // (c) Cancela el cargo EsMa (esté propuesto o validado-con-permiso).
    if (cargo !== null) {
      await tx.esMaCargo.update({
        where: { id: cargo.id },
        data: { estado: 'cancelado', ...datosModificacion(sesion) },
      });
      await registrarBitacora(tx, sesion, {
        entidad: 'EsMaCargo',
        idEntidad: cargo.id,
        accion: 'CANCELAR',
        datos: { motivo: datos.motivo, idRecibo, estadoPrevio: cargo.estado },
      });
    }

    // (d) Cancelación suave del recibo (WIP).
    await tx.etapaMovimiento.update({
      where: { id: idRecibo },
      data: {
        canceladoEn: new Date(),
        canceladoPorId: sesion.id,
        motivoCancelacion: datos.motivo,
        ...datosModificacion(sesion),
      },
    });

    await registrarBitacora(tx, sesion, {
      entidad: 'EtapaMovimiento',
      idEntidad: idRecibo,
      accion: 'CANCELAR',
      datos: {
        tipo: 'recibo_maquila',
        folio: Number(recibo.folio),
        motivo: datos.motivo,
        movimientosRevertidos: movimientos.length,
      },
    });

    // OUTBOX (F5-E6, decisión (f)): la cancelación re-evalúa el proceso de recibo de la RC; si ya no
    // está cubierto, lo des-completa y recalcula el CPM.
    await registrarEventoEtapaRc(tx, EVENTOS_OUTBOX.reciboMaquilaCancelado, {
      idEmpresa: sesion.idEmpresaActiva,
      idOrden: recibo.idOrden,
      idEtapaMovimiento: recibo.id,
      tipoEtapa: TipoEtapaMovimiento.recibo_maquila,
      idTipoProceso: recibo.idTipoProceso,
    });
  }, bd);

  dispararPublicacion();
  return obtenerRecibo(sesion, idRecibo, bd);
}

/** Obtiene un recibo (con su matriz) de la empresa activa, o lanza `ErrorNoEncontrado` (A9). */
export async function obtenerRecibo(
  sesion: SesionUsuario,
  idRecibo: number,
  bd?: ContextoBd,
): Promise<ReciboSalida> {
  verificarPermiso(sesion, 'produccion.wip-ver');
  const recibo = await clienteLectura(bd).etapaMovimiento.findFirst({
    where: {
      id: idRecibo,
      idEmpresa: sesion.idEmpresaActiva,
      tipo: TipoEtapaMovimiento.recibo_maquila,
    },
    include: incluirRecibo,
  });
  if (recibo === null) {
    throw new ErrorNoEncontrado('EtapaMovimiento', idRecibo);
  }
  return aReciboSalida(recibo, bd);
}

/** Re-lee el recibo para emitir su evento post-commit (best-effort). */
async function emitirReciboPorId(
  idRecibo: number,
  evento: NombreEvento,
  bd?: ContextoBd,
): Promise<void> {
  const etapa = await clienteLectura(bd).etapaMovimiento.findUnique({ where: { id: idRecibo } });
  if (etapa !== null) {
    await emitirRecibo(evento, etapa);
  }
}

/**
 * PENDIENTES POR RECIBIR de una orden (derivados, sin acumuladores). Por cada proceso ya enviado a
 * la orden (envíos vivos), enviado − recibido a ESE proceso, por color×talla (solo celdas ≠ 0). Las
 * etapas canceladas NO cuentan. Solo lectura (`produccion.wip-ver`).
 */
export async function pendientesPorRecibir(
  sesion: SesionUsuario,
  idOrden: number,
  bd?: ContextoBd,
): Promise<PendientesRecibir> {
  verificarPermiso(sesion, 'produccion.wip-ver');
  const cliente = clienteLectura(bd);

  const orden = await cliente.orden.findFirst({
    where: { id: idOrden, idEmpresa: sesion.idEmpresaActiva },
    select: {
      folio: true,
      lineas: {
        select: {
          idColor: true,
          color: { select: { nombre: true } },
          tallas: { select: { idTalla: true, talla: { select: { etiqueta: true, orden: true } } } },
        },
      },
    },
  });
  if (orden === null) {
    throw new ErrorNoEncontrado('Orden', idOrden);
  }

  interface MetaCelda {
    idColor: number;
    color: string;
    idTalla: number;
    etiquetaTalla: string;
    ordenTalla: number;
  }
  const meta = new Map<string, MetaCelda>();
  for (const linea of orden.lineas) {
    for (const t of linea.tallas) {
      const clave = claveCelda(linea.idColor, t.idTalla);
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

  // Procesos efectivamente enviados (envíos vivos) de la orden.
  const procesosEnviados = await cliente.etapaMovimiento.findMany({
    where: {
      idOrden,
      tipo: TipoEtapaMovimiento.envio_maquila,
      canceladoEn: null,
      idTipoProceso: { not: null },
    },
    select: {
      idTipoProceso: true,
      tipoProceso: { select: { nombre: true, codigo: true, generaEntradaPt: true } },
    },
    distinct: ['idTipoProceso'],
  });

  const porRecibir = [];
  for (const proc of procesosEnviados) {
    if (proc.idTipoProceso === null) continue;
    const enviado = await sumarCeldas(
      cliente,
      idOrden,
      TipoEtapaMovimiento.envio_maquila,
      proc.idTipoProceso,
    );
    const recibido = await sumarCeldas(
      cliente,
      idOrden,
      TipoEtapaMovimiento.recibo_maquila,
      proc.idTipoProceso,
    );
    const claves = new Set<string>([...enviado.keys(), ...recibido.keys()]);
    const celdas = [...claves]
      .map((clave) => {
        const m =
          meta.get(clave) ??
          (() => {
            const [idColor, idTalla] = clave.split(':').map(Number);
            return {
              idColor: idColor ?? 0,
              color: `Color ${idColor ?? 0}`,
              idTalla: idTalla ?? 0,
              etiquetaTalla: '',
              ordenTalla: 0,
            };
          })();
        const cantidad = (enviado.get(clave) ?? 0) - (recibido.get(clave) ?? 0);
        return { ...m, cantidad };
      })
      .filter((c) => c.cantidad !== 0)
      .sort((a, b) => a.idColor - b.idColor || a.ordenTalla - b.ordenTalla || a.idTalla - b.idTalla)
      .map(({ ordenTalla: _o, ...resto }) => resto);
    const totalPendiente =
      [...enviado.values()].reduce((s, v) => s + v, 0) -
      [...recibido.values()].reduce((s, v) => s + v, 0);
    porRecibir.push({
      idTipoProceso: proc.idTipoProceso,
      tipoProceso: proc.tipoProceso?.nombre ?? '',
      codigoProceso: proc.tipoProceso?.codigo ?? '',
      generaEntradaPt: proc.tipoProceso?.generaEntradaPt ?? false,
      celdas,
      totalPendiente,
    });
  }

  return { idOrden, folioOrden: Number(orden.folio), porRecibir };
}

/**
 * RECIBOS SEMANALES por maquilero: recibos VIVOS agrupados por maquilero y semana ISO, con el total
 * recibido (y su desglose primeras/segundas) y el número de recibos. Solo lectura
 * (`produccion.wip-ver`). Consulta (también móvil). Filtra por la empresa activa (A9) y, opcional,
 * por rango de fechas y/o un maquilero.
 */
export async function recibosSemanalesPorMaquilero(
  sesion: SesionUsuario,
  parametros: z.input<typeof esquemaRecibosSemanalesQuery> = {},
  bd?: ContextoBd,
): Promise<RecibosSemanalesLista> {
  verificarPermiso(sesion, 'produccion.wip-ver');
  const filtros = validarEntrada(esquemaRecibosSemanalesQuery, parametros);
  const cliente = clienteLectura(bd);

  const recibos = await cliente.etapaMovimiento.findMany({
    where: {
      idEmpresa: sesion.idEmpresaActiva,
      tipo: TipoEtapaMovimiento.recibo_maquila,
      canceladoEn: null,
      ...(filtros.idMaquilero === undefined ? {} : { idTercero: filtros.idMaquilero }),
      ...(filtros.desde === undefined && filtros.hasta === undefined
        ? {}
        : {
            fecha: {
              ...(filtros.desde === undefined ? {} : { gte: aDateColumna(filtros.desde) }),
              ...(filtros.hasta === undefined ? {} : { lte: aDateColumna(filtros.hasta) }),
            },
          }),
    },
    select: {
      idTercero: true,
      tercero: { select: { nombre: true } },
      fecha: true,
      detalles: { select: { cantidad: true, cantidadPrimeras: true, cantidadSegundas: true } },
    },
  });

  interface Acum {
    idMaquilero: number | null;
    maquilero: string;
    anioSemana: string;
    inicioSemana: string;
    totalRecibido: number;
    totalPrimeras: number;
    totalSegundas: number;
    numRecibos: number;
  }
  const grupos = new Map<string, Acum>();
  for (const recibo of recibos) {
    const { anioSemana, inicioSemana } = semanaIso(recibo.fecha);
    const claveGrupo = `${recibo.idTercero ?? 'sin'}|${anioSemana}`;
    let totalRecibido = 0;
    let totalPrimeras = 0;
    let totalSegundas = 0;
    for (const d of recibo.detalles) {
      totalRecibido += d.cantidad;
      totalPrimeras += d.cantidadPrimeras ?? 0;
      totalSegundas += d.cantidadSegundas ?? 0;
    }
    const acum = grupos.get(claveGrupo) ?? {
      idMaquilero: recibo.idTercero,
      maquilero: recibo.tercero?.nombre ?? 'Sin asignar',
      anioSemana,
      inicioSemana,
      totalRecibido: 0,
      totalPrimeras: 0,
      totalSegundas: 0,
      numRecibos: 0,
    };
    acum.totalRecibido += totalRecibido;
    acum.totalPrimeras += totalPrimeras;
    acum.totalSegundas += totalSegundas;
    acum.numRecibos += 1;
    grupos.set(claveGrupo, acum);
  }

  const filas = [...grupos.values()].sort(
    (a, b) =>
      b.anioSemana.localeCompare(a.anioSemana) || a.maquilero.localeCompare(b.maquilero, 'es'),
  );
  return { filas };
}

/**
 * Año-semana ISO 8601 ("2026-W25") y el LUNES de esa semana (YYYY-MM-DD). Copia del de `etapas.ts`
 * (cálculo en UTC porque la fecha de la etapa es `@db.Date` a medianoche UTC).
 */
function semanaIso(fecha: Date): { anioSemana: string; inicioSemana: string } {
  const d = new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate()));
  const diaIso = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  const lunes = new Date(d);
  lunes.setUTCDate(d.getUTCDate() - (diaIso - 1));
  const jueves = new Date(d);
  jueves.setUTCDate(d.getUTCDate() + (4 - diaIso));
  const anioIso = jueves.getUTCFullYear();
  const primerEnero = new Date(Date.UTC(anioIso, 0, 1));
  const numSemana = Math.ceil(((jueves.getTime() - primerEnero.getTime()) / 86_400_000 + 1) / 7);
  const anioSemana = `${anioIso}-W${String(numSemana).padStart(2, '0')}`;
  const inicioSemana = lunes.toISOString().slice(0, 10);
  return { anioSemana, inicioSemana };
}
