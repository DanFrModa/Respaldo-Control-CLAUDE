/**
 * Etapas de producción — CORTE + ENVÍO a maquila unificado (F3-E2; doc 03-Produccion Pasos 3 y 4,
 * "Flujo paralelo — Estampado" y Observación 4: UN solo modelo de proceso de maquila para costura
 * Y estampado/bordado/lavado, parametrizado por `TipoProceso`, D8). Toda la lógica de negocio vive
 * AQUÍ (A1); las rutas REST solo validan permiso + Zod y delegan.
 *
 * Sobre el motor de kardex: el corte y el envío NO tocan el kardex PT (no son entrada/salida de
 * existencia). Escriben `EtapaMovimiento` (encabezado del WIP) + `EtapaMovimientoDet` (color×talla,
 * D4). El kardex PT entra hasta el recibo de costura (F3-E4) y la entrega (F3-E5).
 *
 * Innegociables aplicados:
 *  • A1 — la lógica vive en este módulo de dominio; las rutas son delgadas.
 *  • A2 — encabezado + detalle + bitácora en UNA transacción (`enTransaccion`).
 *  • A3 — el folio sale de la secuencia atómica `"etapa-mov"` POR EMPRESA (`siguienteFolio`),
 *    NUNCA Max()+1.
 *  • A4 — cada operación re-verifica su permiso (`produccion.corte`/`.envio`/`.cancelar`/`.wip-ver`).
 *  • A7 — `Bitacora` uniforme dentro de la misma transacción.
 *  • A9 — todo se filtra/sella por `idEmpresa` (la empresa de la ORDEN, igual que las órdenes de
 *    F2; se exige que sea la empresa activa de la sesión).
 *  • D4 — toda etapa del WIP se captura por color×talla.
 *
 * Decisiones de negocio (DECISIONES.md (f) y (g)):
 *  • (f) Sobre-corte LIBRE: {@link registrarCorte} NO bloquea por cortar más que lo pedido. Acepta
 *    cualquier cantidad entera ≥ 0; valida solo sanidad (color/talla pertenecen a la orden). El
 *    tope de sobre-corte es un parámetro configurable {@link TOLERANCIA_SOBRE_CORTE} (default
 *    ilimitado): cambiarlo es config, no migración.
 *  • (g) Sobre-envío ESTRICTO: {@link registrarEnvioMaquila} BLOQUEA server-side si lo enviado
 *    excede el cortado disponible para ese proceso (= Σ cortado(c×t) − Σ enviado a ESE proceso(c×t),
 *    por orden+proceso). Cada proceso se topa INDEPENDIENTEMENTE contra el cortado total (costura y
 *    estampado consumen las mismas piezas en flujos paralelos, NO se restan entre sí). El cálculo
 *    suma `EtapaMovimientoDet` DIRECTO dentro de la transacción, bajo bloqueo de las filas de la
 *    orden, para que dos envíos concurrentes no excedan lo cortado (igual criterio que el kardex de
 *    E1: validaciones por suma directa, nunca acumuladores). Tope configurable
 *    {@link TOLERANCIA_SOBRE_ENVIO} (default 0% = estricto).
 *
 * Eventos: tras un corte/envío committeado se emite `corte-registrado`/`envio-registrado`
 * post-commit, best-effort (gancho de la RC de F5; sin consumidores hoy).
 */
import {
  esquemaCorteCrear,
  esquemaEnvioCrear,
  esquemaEtapaCancelarCuerpo,
  esquemaCorteSemanalQuery,
  type DatosEtapaLineaEntrada,
  type EtapaSalida,
  type EtapasOrdenLista,
  type PendientesOrden,
  type CorteSemanalLista,
} from '../../contrato/index.js';
import { TipoEtapaMovimiento, type Prisma } from '../../datos/index.js';
import type { z } from 'zod';

import { datosCreacion, datosModificacion, registrarBitacora } from '../../comun/auditoria.js';
import { dispararPublicacion } from '../../comun/cola-eventos.js';
import { ErrorConflicto, ErrorNoEncontrado, ErrorValidacion } from '../../comun/errores.js';
import {
  EVENTOS_OUTBOX,
  VERSION_EVENTO_ETAPA_RC,
  registrarEventoOutbox,
  type EventoEtapaRc,
} from '../../comun/eventos-dominio.js';
import { tienePermiso, verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import { siguienteFolio } from '../../comun/secuencias.js';
import {
  clienteLectura,
  enTransaccion,
  type ContextoBd,
  type Tx,
} from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';

/** Clave de la secuencia de folios de las etapas de producción (A3 — por empresa). */
export const CLAVE_SECUENCIA_ETAPA = 'etapa-mov';

/**
 * Tope de SOBRE-CORTE (decisión (f)): cuántas piezas DE MÁS sobre lo pedido se pueden cortar.
 * `null` = ilimitado (el default acordado). Es un parámetro de dominio para poder cambiarlo sin
 * migración; si algún día Daniel quiere un tope, se pone aquí (un número absoluto de piezas extra
 * por celda o un factor — hoy ilimitado, así que el corte nunca se bloquea por cantidad).
 */
export const TOLERANCIA_SOBRE_CORTE: number | null = null;

/**
 * Tope de SOBRE-ENVÍO (decisión (g)): fracción del cortado disponible que se puede exceder al
 * enviar a un proceso. `0` = estricto (default): no se puede enviar ni una pieza más de lo cortado
 * disponible para ese proceso. Un `0.05` permitiría 5% de holgura. Es un parámetro de dominio
 * (config, no migración).
 */
export const TOLERANCIA_SOBRE_ENVIO = 0;

/**
 * MAPEO `TipoProceso.codigo` → `RolProveedor.codigo` (fusión de terceros, D12/R15; doc 07-EsMa §3:
 * las viejas banderas `Maquileros.Costura/Proceso` hoy son roles del proveedor). El maquilero de un
 * envío debe TENER el rol que mapea a su proceso. La costura mapea a `maquila-costura`; el resto es
 * identidad (`estampado→estampado`, `bordado→bordado`, `lavado→lavado`, `aplicacion→aplicacion`).
 * Centralizado aquí para que el reviewer lo encuentre; verificado contra los códigos sembrados en
 * `prisma/seed.ts` (ROLES_PROVEEDOR_BASE / TIPOS_PROCESO_BASE).
 */
const MAPEO_PROCESO_A_ROL: Record<string, string> = {
  costura: 'maquila-costura',
  estampado: 'estampado',
  bordado: 'bordado',
  lavado: 'lavado',
  aplicacion: 'aplicacion',
};

/** Rol de proveedor que debe tener el CORTADOR de un corte (D12/R15). */
const ROL_CORTADOR = 'corte';

/** El rol de proveedor requerido para un proceso de maquila, o el código tal cual si no hay mapeo. */
function rolDelProceso(codigoProceso: string): string {
  return MAPEO_PROCESO_A_ROL[codigoProceso] ?? codigoProceso;
}

// ── Tipos internos ──────────────────────────────────────────────────────────────────────────────

/** Una celda color×talla "aplanada" (un renglón por talla), para sumas y comparaciones. */
interface Celda {
  idColor: number;
  idTalla: number;
  cantidad: number;
}

/** `include` para proyectar una etapa con su matriz + nombres legibles. */
const incluirEtapa = {
  orden: { select: { folio: true } },
  tipoProceso: { select: { nombre: true } },
  tercero: { select: { nombre: true } },
  detalles: {
    orderBy: [{ idColor: 'asc' }, { idTalla: 'asc' }],
    include: {
      color: { select: { nombre: true } },
      talla: { select: { etiqueta: true, orden: true } },
    },
  },
} satisfies Prisma.EtapaMovimientoInclude;

type EtapaConDetalle = Prisma.EtapaMovimientoGetPayload<{ include: typeof incluirEtapa }>;

// ── Helpers de la orden (lo pedido por color×talla, y validación de pertenencia) ────────────────

/** Datos de la orden necesarios para validar una etapa: empresa, estado y su matriz color×talla. */
interface ContextoOrden {
  idEmpresa: number;
  estado: string;
  /** Lo pedido por celda (orden − corte usa esto). */
  pedido: Celda[];
  /** Colores válidos de la orden. */
  colores: Set<number>;
  /** Tallas válidas por color (la combinación color×talla debe existir en la orden). */
  tallasPorColor: Map<number, Set<number>>;
}

/**
 * Resuelve la orden de la EMPRESA ACTIVA con su matriz (A9). Lanza `ErrorNoEncontrado` si la orden
 * no es de la empresa activa (para esta sesión, no existe) y `ErrorConflicto` si está cancelada.
 */
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
      lineas: { select: { idColor: true, tallas: { select: { idTalla: true, cantidad: true } } } },
    },
  });
  if (orden === null) {
    throw new ErrorNoEncontrado('Orden', idOrden);
  }
  if (orden.estado === 'cancelada') {
    throw new ErrorConflicto('La orden está cancelada; no se le pueden capturar etapas.');
  }

  const pedido: Celda[] = [];
  const colores = new Set<number>();
  const tallasPorColor = new Map<number, Set<number>>();
  for (const linea of orden.lineas) {
    colores.add(linea.idColor);
    const tallas = tallasPorColor.get(linea.idColor) ?? new Set<number>();
    for (const t of linea.tallas) {
      tallas.add(t.idTalla);
      pedido.push({ idColor: linea.idColor, idTalla: t.idTalla, cantidad: t.cantidad });
    }
    tallasPorColor.set(linea.idColor, tallas);
  }
  return { idEmpresa: orden.idEmpresa, estado: orden.estado, pedido, colores, tallasPorColor };
}

/**
 * Aplana la matriz de la entrada a celdas, validando SANIDAD (D4): cantidades enteras ≥ 0, color y
 * talla SIN repetir dentro de la captura, y que cada color×talla PERTENEZCA a la orden (no se puede
 * cortar/enviar un color o una talla que la orden no pidió). Esto aplica TANTO al corte (f) como al
 * envío (g): la holgura de sobre-corte es solo de CANTIDAD, no de colores/tallas inventados.
 */
function aplanarYValidar(lineas: DatosEtapaLineaEntrada[], orden: ContextoOrden): Celda[] {
  const idsColor = lineas.map((l) => l.idColor);
  if (new Set(idsColor).size !== idsColor.length) {
    throw new ErrorValidacion('Un color no puede aparecer dos veces en la misma captura.');
  }

  const celdas: Celda[] = [];
  for (const linea of lineas) {
    if (!orden.colores.has(linea.idColor)) {
      throw new ErrorValidacion(
        `El color ${linea.idColor} no pertenece a la orden; solo se capturan colores de la orden.`,
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

/** Clave estable de una celda color×talla (para mapas). */
function claveCelda(idColor: number, idTalla: number): string {
  return `${idColor}:${idTalla}`;
}

/**
 * Valida y resuelve el TERCERO (cortador/maquilero) de una etapa: existe, está activo y TIENE el
 * rol requerido (D12/R15). Devuelve el id. Lanza `ErrorNoEncontrado`/`ErrorValidacion` claros.
 */
async function exigirTerceroConRol(
  tx: Tx,
  idTercero: number,
  codigoRol: string,
  etiquetaRol: string,
): Promise<number> {
  const prov = await tx.proveedor.findUnique({
    where: { id: idTercero },
    select: {
      activo: true,
      nombre: true,
      roles: { select: { rol: { select: { codigo: true, activo: true } } } },
    },
  });
  if (prov === null) {
    throw new ErrorNoEncontrado('Proveedor', idTercero);
  }
  if (!prov.activo) {
    throw new ErrorConflicto(`El proveedor "${prov.nombre}" está desactivado.`);
  }
  const tieneRol = prov.roles.some((r) => r.rol.codigo === codigoRol && r.rol.activo);
  if (!tieneRol) {
    throw new ErrorValidacion(
      `El proveedor "${prov.nombre}" no tiene el rol "${etiquetaRol}"; no puede recibir esta etapa.`,
    );
  }
  return idTercero;
}

/**
 * Bloqueo de las etapas de una ORDEN dentro de la transacción (concurrencia, decisión (g)). Usa un
 * advisory lock transaccional por empresa+orden: dos envíos de la MISMA orden se serializan, así su
 * cálculo de "cortado disponible" (suma directa de `EtapaMovimientoDet`) es consistente y no
 * exceden lo cortado bajo carrera. Mismo criterio que el kardex de E1 (validar por suma directa
 * bajo bloqueo, nunca acumuladores). El lock se libera al terminar la transacción.
 */
async function bloquearEtapasDeOrden(tx: Tx, idEmpresa: number, idOrden: number): Promise<void> {
  // Dos claves int4 estables; una colisión solo serializa de más (nunca afecta la correctitud: las
  // sumas se filtran por idOrden real). 0x4F = 'O' de orden, para no chocar con otras familias de
  // locks que pudieran usar la misma fórmula.
  const clave1 = ((idEmpresa * 1_000_003) ^ 0x4f000000) | 0;
  const clave2 = idOrden | 0;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${clave1}::int, ${clave2}::int)`;
}

/**
 * Suma las celdas color×talla de las etapas VIVAS (no canceladas) de una orden que cumplan el
 * filtro de tipo/proceso, leyendo `EtapaMovimientoDet` DIRECTO (sin acumuladores; ADR-0010 §3). Es
 * la base de "cortado disponible por proceso" (g) y de los pendientes derivados.
 */
async function sumarCeldas(
  tx: Tx,
  idOrden: number,
  filtro: { tipo: TipoEtapaMovimiento; idTipoProceso?: number },
): Promise<Map<string, number>> {
  const filas = await tx.etapaMovimientoDet.findMany({
    where: {
      etapaMov: {
        idOrden,
        tipo: filtro.tipo,
        canceladoEn: null,
        ...(filtro.idTipoProceso === undefined ? {} : { idTipoProceso: filtro.idTipoProceso }),
      },
    },
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

/**
 * Resuelve el nombre de cada `creadoPorId` en UN viaje (rediseño R2 §4.4.4 "capturado por · fecha";
 * mismo patrón que la RC de F5-E5: el id es texto sin FK física, los que no existan quedan null).
 */
async function nombresDeCaptura(
  cliente: ReturnType<typeof clienteLectura>,
  ids: (string | null)[],
): Promise<Map<string, string>> {
  const unicos = [...new Set(ids.filter((x): x is string => x !== null))];
  if (unicos.length === 0) return new Map();
  const usuarios = await cliente.usuario.findMany({
    where: { id: { in: unicos } },
    select: { id: true, nombre: true },
  });
  return new Map(usuarios.map((u) => [u.id, u.nombre]));
}

/**
 * Proyecta una etapa (con detalle) a la forma JSON del contrato. El total se DERIVA por suma.
 * `ocultarPrecio` (rediseño R2, §4.4.3): `precioPactado` es, en la práctica, el precio REAL de
 * maquila de esa etapa — sin `ordenes.ver-precio-real-maquila` va null (el MISMO permiso que
 * redacta `maquilaOrd`/`aplicacionOrd` en la salida de la orden; antes bastaba
 * `produccion.wip-ver`, lo que socavaba el gateo de precios).
 */
function aEtapaSalida(
  etapa: EtapaConDetalle,
  nombres?: Map<string, string>,
  ocultarPrecio = false,
): EtapaSalida {
  // Agrupa el detalle por color, ordenando las tallas por su `orden` del catálogo.
  const porColor = new Map<number, { color: string; tallas: EtapaConDetalle['detalles'] }>();
  for (const det of etapa.detalles) {
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
    id: etapa.id,
    folio: Number(etapa.folio),
    idEmpresa: etapa.idEmpresa,
    idOrden: etapa.idOrden,
    folioOrden: Number(etapa.orden.folio),
    tipo: etapa.tipo,
    idTipoProceso: etapa.idTipoProceso,
    tipoProceso: etapa.tipoProceso?.nombre ?? null,
    idTercero: etapa.idTercero,
    tercero: etapa.tercero?.nombre ?? null,
    fecha: etapa.fecha.toISOString().slice(0, 10),
    fechaCompromiso:
      etapa.fechaCompromiso === null ? null : etapa.fechaCompromiso.toISOString().slice(0, 10),
    precioPactado:
      ocultarPrecio || etapa.precioPactado === null ? null : etapa.precioPactado.toNumber(),
    observaciones: etapa.observaciones,
    cancelado: etapa.canceladoEn !== null,
    canceladoEn: etapa.canceladoEn === null ? null : etapa.canceladoEn.toISOString(),
    canceladoPorId: etapa.canceladoPorId,
    motivoCancelacion: etapa.motivoCancelacion,
    lineas,
    totalPiezas,
    creadoEn: etapa.creadoEn.toISOString(),
    creadoPorId: etapa.creadoPorId,
    creadoPorNombre: etapa.creadoPorId === null ? null : (nombres?.get(etapa.creadoPorId) ?? null),
  };
}

/** Convierte un `YYYY-MM-DD` al `Date` UTC que Prisma guarda en `@db.Date`. */
function aDateColumna(valor: string): Date {
  return new Date(`${valor}T00:00:00.000Z`);
}

/**
 * Escribe en el OUTBOX DURABLE el evento de etapa que consume el auto-avance de la RC (F5-E6), en la
 * MISMA transacción del hecho (atómico: si el corte/envío hace rollback, el evento no existe). Es el
 * gancho REAL de F5 que dispara el auto-avance. La RELEE el consumidor (no manda cantidades): la
 * completitud se re-evalúa sobre el estado físico actual.
 */
async function registrarEventoEtapaRc(
  tx: Tx,
  evento: (typeof EVENTOS_OUTBOX)[keyof typeof EVENTOS_OUTBOX],
  datos: EventoEtapaRc,
): Promise<void> {
  await registrarEventoOutbox(tx, evento, VERSION_EVENTO_ETAPA_RC, datos.idEmpresa, datos);
}

// ── Operaciones ───────────────────────────────────────────────────────────────────────────────

/** Alta de corte: campos del esquema compartido. */
export type EntradaRegistrarCorte = z.input<typeof esquemaCorteCrear>;
/** Alta de envío: campos del esquema compartido. */
export type EntradaRegistrarEnvio = z.input<typeof esquemaEnvioCrear>;

/**
 * Registra un CORTE de una orden (doc 03-Produccion Paso 3; D4). Crea
 * `EtapaMovimiento(tipo=corte, idTipoProceso=NULL, idTercero=cortador)` + `EtapaMovimientoDet`
 * color×talla en UNA transacción (A2), con folio atómico (A3) y bitácora (A7). Valida que el
 * cortador tenga el rol `corte` (D12/R15) y que cada color×talla pertenezca a la orden. Sobre-corte
 * LIBRE (decisión (f)): no bloquea por cortar más que lo pedido. Emite `corte-registrado`
 * post-commit (gancho RC F5).
 */
export async function registrarCorte(
  sesion: SesionUsuario,
  entrada: EntradaRegistrarCorte,
  bd?: ContextoBd,
): Promise<EtapaSalida> {
  verificarPermiso(sesion, 'produccion.corte');
  const datos = validarEntrada(esquemaCorteCrear, entrada);

  const idEtapa = await enTransaccion(async (tx) => {
    const orden = await resolverOrden(tx, datos.idOrden, sesion.idEmpresaActiva);
    const celdas = aplanarYValidar(datos.lineas, orden);
    await exigirTerceroConRol(tx, datos.idCortador, ROL_CORTADOR, 'Corte');

    // Decisión (f): sobre-corte LIBRE — no se compara la cantidad contra lo pedido (ver el TSDoc
    // de TOLERANCIA_SOBRE_CORTE). La pantalla AVISA cuánto excede; el servidor acepta.

    const folio = await siguienteFolio(tx, orden.idEmpresa, CLAVE_SECUENCIA_ETAPA);
    const etapa = await tx.etapaMovimiento.create({
      data: {
        folio,
        idEmpresa: orden.idEmpresa,
        idOrden: datos.idOrden,
        tipo: TipoEtapaMovimiento.corte,
        idTercero: datos.idCortador,
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

    await registrarBitacora(tx, sesion, {
      entidad: 'EtapaMovimiento',
      idEntidad: etapa.id,
      accion: 'CREAR',
      datos: {
        tipo: 'corte',
        folio: Number(folio),
        idOrden: datos.idOrden,
        idCortador: datos.idCortador,
        celdas: celdas.length,
        totalPiezas: celdas.reduce((s, c) => s + c.cantidad, 0),
      },
    });

    // OUTBOX (F5-E6): el gancho durable que dispara el auto-avance de la RC (proceso `corte`).
    await registrarEventoEtapaRc(tx, EVENTOS_OUTBOX.corteRegistrado, {
      idEmpresa: orden.idEmpresa,
      idOrden: datos.idOrden,
      idEtapaMovimiento: etapa.id,
      tipoEtapa: TipoEtapaMovimiento.corte,
      idTipoProceso: null,
    });

    return etapa.id;
  }, bd);

  // Quien capturo ve SU captura completa (el corte no lleva precio, pero el criterio es uniforme).
  const salida = await obtenerEtapa(sesion, idEtapa, bd, { ocultarPrecio: false });
  dispararPublicacion(); // publica la fila del outbox tras el commit (best-effort; el barrido recupera).
  return salida;
}

/**
 * Registra un ENVÍO a maquila (doc 03-Produccion Paso 4 + flujo paralelo de estampado). UN servicio
 * para costura Y estampado, parametrizado por `idTipoProceso` (D8). Crea
 * `EtapaMovimiento(tipo=envio_maquila, idTipoProceso, idTercero=maquilero, precioPactado,
 * fechaCompromiso)` + detalle color×talla, en UNA transacción (A2), folio A3, bitácora A7.
 *
 * Valida:
 *  • el tipo de proceso existe y está ACTIVO;
 *  • el maquilero TIENE el rol que mapea al proceso (D12/R15, {@link MAPEO_PROCESO_A_ROL});
 *  • SOBRE-ENVÍO ESTRICTO (decisión (g)): por cada color×talla, lo enviado (incluido este) no
 *    excede el cortado disponible para ESE proceso = Σ cortado(c×t) − Σ enviado a ese proceso(c×t).
 *    Se calcula por suma DIRECTA de `EtapaMovimientoDet` dentro de la transacción, bajo bloqueo de
 *    las etapas de la orden ({@link bloquearEtapasDeOrden}), para que dos envíos concurrentes no
 *    excedan lo cortado. Estampado y costura se topan INDEPENDIENTEMENTE contra el cortado total
 *    (no se restan entre sí).
 *
 * Emite `envio-registrado` post-commit (gancho RC F5).
 */
export async function registrarEnvioMaquila(
  sesion: SesionUsuario,
  entrada: EntradaRegistrarEnvio,
  bd?: ContextoBd,
): Promise<EtapaSalida> {
  verificarPermiso(sesion, 'produccion.envio');
  const datos = validarEntrada(esquemaEnvioCrear, entrada);

  const idEtapa = await enTransaccion(async (tx) => {
    const orden = await resolverOrden(tx, datos.idOrden, sesion.idEmpresaActiva);
    const celdas = aplanarYValidar(datos.lineas, orden);

    // Tipo de proceso activo + su código (para el mapeo a rol).
    const proceso = await tx.tipoProceso.findUnique({
      where: { id: datos.idTipoProceso },
      select: { codigo: true, nombre: true, activo: true },
    });
    if (proceso === null) {
      throw new ErrorNoEncontrado('TipoProceso', datos.idTipoProceso);
    }
    if (!proceso.activo) {
      throw new ErrorValidacion(`El tipo de proceso "${proceso.nombre}" está desactivado.`);
    }

    const codigoRol = rolDelProceso(proceso.codigo);
    await exigirTerceroConRol(tx, datos.idMaquilero, codigoRol, proceso.nombre);

    // Concurrencia (g): serializa los envíos de ESTA orden y suma DIRECTO el cortado y lo ya
    // enviado a ESTE proceso (etapas vivas), dentro de la misma transacción.
    await bloquearEtapasDeOrden(tx, orden.idEmpresa, datos.idOrden);
    const cortado = await sumarCeldas(tx, datos.idOrden, { tipo: TipoEtapaMovimiento.corte });
    const yaEnviado = await sumarCeldas(tx, datos.idOrden, {
      tipo: TipoEtapaMovimiento.envio_maquila,
      idTipoProceso: datos.idTipoProceso,
    });

    for (const c of celdas) {
      const clave = claveCelda(c.idColor, c.idTalla);
      const cortadoCelda = cortado.get(clave) ?? 0;
      const enviadoCelda = yaEnviado.get(clave) ?? 0;
      const disponible = cortadoCelda - enviadoCelda;
      const topeConHolgura = Math.floor(disponible * (1 + TOLERANCIA_SOBRE_ENVIO));
      if (c.cantidad > topeConHolgura) {
        throw new ErrorConflicto(
          `No se puede enviar ${c.cantidad} pza(s) de ese color/talla a "${proceso.nombre}": ` +
            `solo hay ${disponible} cortada(s) sin enviar a ese proceso.`,
        );
      }
    }

    const folio = await siguienteFolio(tx, orden.idEmpresa, CLAVE_SECUENCIA_ETAPA);
    const etapa = await tx.etapaMovimiento.create({
      data: {
        folio,
        idEmpresa: orden.idEmpresa,
        idOrden: datos.idOrden,
        tipo: TipoEtapaMovimiento.envio_maquila,
        idTipoProceso: datos.idTipoProceso,
        idTercero: datos.idMaquilero,
        fecha: aDateColumna(datos.fecha),
        ...(datos.fechaCompromiso == null
          ? {}
          : { fechaCompromiso: aDateColumna(datos.fechaCompromiso) }),
        ...(datos.precioPactado == null ? {} : { precioPactado: datos.precioPactado }),
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

    await registrarBitacora(tx, sesion, {
      entidad: 'EtapaMovimiento',
      idEntidad: etapa.id,
      accion: 'CREAR',
      datos: {
        tipo: 'envio_maquila',
        folio: Number(folio),
        idOrden: datos.idOrden,
        idTipoProceso: datos.idTipoProceso,
        idMaquilero: datos.idMaquilero,
        celdas: celdas.length,
        totalPiezas: celdas.reduce((s, c) => s + c.cantidad, 0),
      },
    });

    // OUTBOX (F5-E6): dispara el auto-avance de la RC (`envioCostura`/`envioEstampado` según el
    // proceso; el consumidor resuelve costura vs estampado por `generaEntradaPt`).
    await registrarEventoEtapaRc(tx, EVENTOS_OUTBOX.envioMaquilaRegistrado, {
      idEmpresa: orden.idEmpresa,
      idOrden: datos.idOrden,
      idEtapaMovimiento: etapa.id,
      tipoEtapa: TipoEtapaMovimiento.envio_maquila,
      idTipoProceso: datos.idTipoProceso,
    });

    return etapa.id;
  }, bd);

  // Quien capturo el envio TECLEO el precio pactado: su respuesta lo devuelve (no es fuga).
  const salida = await obtenerEtapa(sesion, idEtapa, bd, { ocultarPrecio: false });
  dispararPublicacion();
  return salida;
}

/**
 * CANCELA (suave) una etapa de corte o envío: setea `canceladoEn`/`canceladoPorId`/
 * `motivoCancelacion` + bitácora `CANCELAR` (A7). La etapa NUNCA se borra ni se edita. Reglas:
 *  • solo etapas de la EMPRESA ACTIVA (A9);
 *  • no se puede re-cancelar una etapa ya cancelada;
 *  • no se puede cancelar un CORTE que tenga ENVÍOS VIVOS (no cancelados): primero se cancelan los
 *    envíos (si no, los pendientes quedarían incoherentes — enviar sin cortado);
 *  • espejo del anterior: no se puede cancelar un ENVÍO que tenga RECIBOS VIVOS de su orden+proceso
 *    (si no, quedaría recibido sin envío que lo sostenga — `recibido ≤ enviado` se rompe).
 * Las etapas canceladas NO cuentan en ninguna suma de pendientes ({@link sumarCeldas} filtra
 * `canceladoEn: null`).
 */
export async function cancelarEtapaMovimiento(
  sesion: SesionUsuario,
  idEtapa: number,
  cuerpo: z.input<typeof esquemaEtapaCancelarCuerpo>,
  bd?: ContextoBd,
): Promise<EtapaSalida> {
  verificarPermiso(sesion, 'produccion.cancelar');
  const datos = validarEntrada(esquemaEtapaCancelarCuerpo, cuerpo);

  await enTransaccion(async (tx) => {
    const etapa = await tx.etapaMovimiento.findFirst({
      where: { id: idEtapa, idEmpresa: sesion.idEmpresaActiva },
      select: {
        id: true,
        tipo: true,
        idOrden: true,
        idTipoProceso: true,
        canceladoEn: true,
        folio: true,
      },
    });
    if (etapa === null) {
      throw new ErrorNoEncontrado('EtapaMovimiento', idEtapa);
    }
    if (etapa.canceladoEn !== null) {
      throw new ErrorConflicto(`La etapa ${Number(etapa.folio)} ya está cancelada.`);
    }
    // F3-E2 solo maneja corte y envío; recibo/entrega (con efectos de kardex) los cancela E4/E5.
    if (
      etapa.tipo !== TipoEtapaMovimiento.corte &&
      etapa.tipo !== TipoEtapaMovimiento.envio_maquila
    ) {
      throw new ErrorValidacion(
        'Esta operación solo cancela cortes y envíos; los recibos y entregas se cancelan en su módulo.',
      );
    }

    if (etapa.tipo === TipoEtapaMovimiento.corte) {
      // Bloquea cancelar un corte con envíos vivos: el cortado sostiene los envíos. Se bloquea la
      // orden para que un envío concurrente no se cuele entre la verificación y la cancelación.
      await bloquearEtapasDeOrden(tx, sesion.idEmpresaActiva, etapa.idOrden);
      const enviosVivos = await tx.etapaMovimiento.count({
        where: {
          idOrden: etapa.idOrden,
          tipo: TipoEtapaMovimiento.envio_maquila,
          canceladoEn: null,
        },
      });
      if (enviosVivos > 0) {
        throw new ErrorConflicto(
          'No se puede cancelar el corte: la orden tiene envíos a maquila vigentes. Cancélalos primero.',
        );
      }
    }

    if (etapa.tipo === TipoEtapaMovimiento.envio_maquila) {
      // Espejo del guard del corte: el ENVÍO sostiene los recibos. Desde el 28-jul-2026
      // `recibos.ts` valida `recibido ≤ enviado` POR MAQUILERO (no al agregado orden+proceso, como
      // decía antes este comentario), así que cancelar un envío bajaría el enviado de ESE tercero y
      // dejaría sus recibos "colgando". El conteo de abajo sigue siendo por orden+proceso, o sea
      // MÁS conservador de lo estrictamente necesario: bloquea cancelar el envío de B si A tiene
      // recibos vivos del mismo proceso. Se conserva a propósito —acotarlo al tercero pide su
      // propio análisis (¿qué pasa con los recibos del histórico sin envío?)— y de todos modos
      // cancelar un envío con producción devuelta viva es algo que hay que mirar a mano.
      // Se bloquea la orden para que un recibo concurrente no se cuele entre la verificación y la
      // cancelación (mismo lock que el recibo usa al validar).
      await bloquearEtapasDeOrden(tx, sesion.idEmpresaActiva, etapa.idOrden);
      const recibosVivos = await tx.etapaMovimiento.count({
        where: {
          idOrden: etapa.idOrden,
          idTipoProceso: etapa.idTipoProceso,
          tipo: TipoEtapaMovimiento.recibo_maquila,
          canceladoEn: null,
        },
      });
      if (recibosVivos > 0) {
        throw new ErrorConflicto(
          'No se puede cancelar el envío a maquila: la orden tiene recibos de este proceso vigentes. ' +
            'Cancélalos primero.',
        );
      }
    }

    await tx.etapaMovimiento.update({
      where: { id: idEtapa },
      data: {
        canceladoEn: new Date(),
        canceladoPorId: sesion.id,
        motivoCancelacion: datos.motivo,
        ...datosModificacion(sesion),
      },
    });

    await registrarBitacora(tx, sesion, {
      entidad: 'EtapaMovimiento',
      idEntidad: idEtapa,
      accion: 'CANCELAR',
      datos: { tipo: etapa.tipo, folio: Number(etapa.folio), motivo: datos.motivo },
    });

    // OUTBOX (F5-E6, decisión (f)): la cancelación re-evalúa el proceso de la RC; si ya no está
    // cubierto, se des-completa y se recalcula el CPM. El consumidor sabe qué proceso por `tipoEtapa`
    // (+ `idTipoProceso` para envío costura/estampado).
    await registrarEventoEtapaRc(tx, EVENTOS_OUTBOX.etapaCancelada, {
      idEmpresa: sesion.idEmpresaActiva,
      idOrden: etapa.idOrden,
      idEtapaMovimiento: etapa.id,
      tipoEtapa: etapa.tipo,
      idTipoProceso: etapa.idTipoProceso,
    });
  }, bd);

  dispararPublicacion();
  return obtenerEtapa(sesion, idEtapa, bd);
}

/** Obtiene una etapa (con su matriz) de la empresa activa, o lanza `ErrorNoEncontrado` (A9). */
/**
 * `opciones.ocultarPrecio` (paridad con `obtenerRecibo`): sin opciones, la redaccion de
 * `precioPactado` SE DERIVA del permiso `ordenes.ver-precio-real-maquila` (lecturas y
 * cancelacion); `registrarCorte`/`registrarEnvioMaquila` pasan `false` — quien captura acaba de
 * teclear ese precio y su respuesta lo devuelve (mismo criterio que el PATCH de precios).
 */
export async function obtenerEtapa(
  sesion: SesionUsuario,
  idEtapa: number,
  bd?: ContextoBd,
  opciones: { ocultarPrecio?: boolean } = {},
): Promise<EtapaSalida> {
  verificarPermiso(sesion, 'produccion.wip-ver');
  const cliente = clienteLectura(bd);
  const etapa = await cliente.etapaMovimiento.findFirst({
    where: { id: idEtapa, idEmpresa: sesion.idEmpresaActiva },
    include: incluirEtapa,
  });
  if (etapa === null) {
    throw new ErrorNoEncontrado('EtapaMovimiento', idEtapa);
  }
  const nombres = await nombresDeCaptura(cliente, [etapa.creadoPorId]);
  const ocultarPrecio =
    opciones.ocultarPrecio ?? !tienePermiso(sesion, 'ordenes.ver-precio-real-maquila');
  return aEtapaSalida(etapa, nombres, ocultarPrecio);
}

/**
 * HISTORIAL de etapas (cortes Y envíos) de una orden de la empresa activa (A9): vivas y CANCELADAS
 * (las canceladas se conservan como historial, marcadas). Cada etapa trae su matriz color×talla y
 * su estado de cancelación (motivo + fecha). Es lo que las pantallas de captura muestran para
 * poder CANCELAR una etapa con motivo y ver el resultado. Ordenado por folio descendente (lo más
 * reciente primero). Solo lectura (`produccion.wip-ver`). Con `incluirRecibos` (rediseño R2 —
 * Avance de producción) suma también los RECIBOS de maquila (F3-E4); las entregas a cliente
 * siguen en su módulo (E5). Cada etapa lleva `creadoPorNombre` (§4.4.4, resuelto en un viaje).
 */
export async function listarEtapasOrden(
  sesion: SesionUsuario,
  idOrden: number,
  bd?: ContextoBd,
  opciones: { incluirRecibos?: boolean } = {},
): Promise<EtapasOrdenLista> {
  verificarPermiso(sesion, 'produccion.wip-ver');
  const cliente = clienteLectura(bd);

  const orden = await cliente.orden.findFirst({
    where: { id: idOrden, idEmpresa: sesion.idEmpresaActiva },
    select: { id: true, folio: true },
  });
  if (orden === null) {
    throw new ErrorNoEncontrado('Orden', idOrden);
  }

  const tipos: TipoEtapaMovimiento[] = [
    TipoEtapaMovimiento.corte,
    TipoEtapaMovimiento.envio_maquila,
  ];
  if (opciones.incluirRecibos === true) {
    tipos.push(TipoEtapaMovimiento.recibo_maquila);
  }
  const etapas = await cliente.etapaMovimiento.findMany({
    where: {
      idOrden,
      idEmpresa: sesion.idEmpresaActiva,
      tipo: { in: tipos },
    },
    orderBy: { folio: 'desc' },
    include: incluirEtapa,
  });

  const nombres = await nombresDeCaptura(
    cliente,
    etapas.map((e) => e.creadoPorId),
  );
  const ocultarPrecio = !tienePermiso(sesion, 'ordenes.ver-precio-real-maquila');
  return {
    idOrden,
    folioOrden: Number(orden.folio),
    etapas: etapas.map((e) => aEtapaSalida(e, nombres, ocultarPrecio)),
  };
}

/**
 * Pendientes DERIVADOS de una orden (form `Proceso` del viejo; sin acumuladores). Devuelve, por
 * color×talla:
 *  • `porCortar` = Σ orden − Σ corte (NEGATIVO si hubo sobre-corte; se muestra tal cual, decisión (f));
 *  • `cortadoPorEnviar[proceso]` = Σ corte − Σ enviado a ESE proceso (por cada proceso ya usado en
 *    la orden). Cada proceso se compara contra el cortado TOTAL (flujos paralelos, decisión (g)).
 * Las etapas canceladas NO cuentan. Solo lectura (`produccion.wip-ver`).
 */
export async function pendientesPorOrden(
  sesion: SesionUsuario,
  idOrden: number,
  bd?: ContextoBd,
): Promise<PendientesOrden> {
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

  // Metadatos de presentación por celda (nombre del color, etiqueta/orden de talla).
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

  // Sumas de corte y de envíos por proceso (etapas vivas, suma directa).
  const cortado = await sumarCeldasLectura(cliente, idOrden, { tipo: 'corte' });
  // Procesos efectivamente usados en envíos vivos de la orden (para enumerar cortadoPorEnviar).
  const procesosEnviados = await cliente.etapaMovimiento.findMany({
    where: {
      idOrden,
      tipo: 'envio_maquila',
      canceladoEn: null,
      idTipoProceso: { not: null },
    },
    select: { idTipoProceso: true, tipoProceso: { select: { nombre: true, codigo: true } } },
    distinct: ['idTipoProceso'],
  });

  // Para asegurar que TODA celda con metadato salga (incluso si no se cortó nada), recorre las claves
  // de pedido ∪ corte para porCortar y cortadoTotal.
  const todasClaves = new Set<string>([...pedido.keys(), ...cortado.keys()]);

  const ordenarCeldas = <T extends { ordenTalla: number; idColor: number; idTalla: number }>(
    arr: T[],
  ): T[] =>
    arr.sort(
      (a, b) => a.idColor - b.idColor || a.ordenTalla - b.ordenTalla || a.idTalla - b.idTalla,
    );

  const porCortar = ordenarCeldas(
    [...todasClaves].map((clave) => {
      const m = metaPara(meta, clave);
      const cantidad = (pedido.get(clave) ?? 0) - (cortado.get(clave) ?? 0);
      return { ...m, cantidad };
    }),
  ).map(({ ordenTalla: _o, ...resto }) => resto);

  const totalPorCortar =
    [...pedido.values()].reduce((s, v) => s + v, 0) -
    [...cortado.values()].reduce((s, v) => s + v, 0);
  const cortadoTotal = [...cortado.values()].reduce((s, v) => s + v, 0);

  const cortadoPorEnviar = [];
  for (const proc of procesosEnviados) {
    if (proc.idTipoProceso === null) continue;
    const enviado = await sumarCeldasLectura(cliente, idOrden, {
      tipo: 'envio_maquila',
      idTipoProceso: proc.idTipoProceso,
    });
    const clavesProc = new Set<string>([...cortado.keys(), ...enviado.keys()]);
    const celdas = ordenarCeldas(
      [...clavesProc].map((clave) => {
        const m = metaPara(meta, clave);
        const cantidad = (cortado.get(clave) ?? 0) - (enviado.get(clave) ?? 0);
        return { ...m, cantidad };
      }),
    )
      .filter((c) => c.cantidad !== 0)
      .map(({ ordenTalla: _o, ...resto }) => resto);
    const totalPendiente =
      [...cortado.values()].reduce((s, v) => s + v, 0) -
      [...enviado.values()].reduce((s, v) => s + v, 0);
    cortadoPorEnviar.push({
      idTipoProceso: proc.idTipoProceso,
      tipoProceso: proc.tipoProceso?.nombre ?? '',
      codigoProceso: proc.tipoProceso?.codigo ?? '',
      celdas,
      totalPendiente,
    });
  }

  return {
    idOrden,
    folioOrden: Number(orden.folio),
    porCortar,
    totalPorCortar,
    cortadoTotal,
    cortadoPorEnviar,
  };
}

/** Devuelve el metadato de presentación de una celda (defensivo: si falta, arma uno mínimo). */
function metaPara(
  meta: Map<
    string,
    { idColor: number; color: string; idTalla: number; etiquetaTalla: string; ordenTalla: number }
  >,
  clave: string,
): { idColor: number; color: string; idTalla: number; etiquetaTalla: string; ordenTalla: number } {
  const m = meta.get(clave);
  if (m !== undefined) return m;
  const [idColor, idTalla] = clave.split(':').map(Number);
  return {
    idColor: idColor ?? 0,
    color: `Color ${idColor ?? 0}`,
    idTalla: idTalla ?? 0,
    etiquetaTalla: '',
    ordenTalla: 0,
  };
}

/** Variante de {@link sumarCeldas} para un cliente de LECTURA (sin transacción), para las consultas. */
async function sumarCeldasLectura(
  cliente: ReturnType<typeof clienteLectura>,
  idOrden: number,
  filtro: { tipo: 'corte' | 'envio_maquila'; idTipoProceso?: number },
): Promise<Map<string, number>> {
  const filas = await cliente.etapaMovimientoDet.findMany({
    where: {
      etapaMov: {
        idOrden,
        tipo: filtro.tipo,
        canceladoEn: null,
        ...(filtro.idTipoProceso === undefined ? {} : { idTipoProceso: filtro.idTipoProceso }),
      },
    },
    select: { idColor: true, idTalla: true, cantidad: true },
  });
  const acumulado = new Map<string, number>();
  for (const f of filas) {
    const clave = claveCelda(f.idColor, f.idTalla);
    acumulado.set(clave, (acumulado.get(clave) ?? 0) + f.cantidad);
  }
  return acumulado;
}

/**
 * CORTE SEMANAL por cortador (form `CorteSemanal` del viejo): cortes VIVOS agrupados por cortador y
 * por semana ISO, con el total de piezas cortadas y el número de cortes. Solo lectura
 * (`produccion.wip-ver`). Es consulta (también móvil, regla del plan). Filtra por la empresa activa
 * (A9) y, opcionalmente, por rango de fechas y/o un cortador.
 */
export async function corteSemanalPorCortador(
  sesion: SesionUsuario,
  parametros: z.input<typeof esquemaCorteSemanalQuery> = {},
  bd?: ContextoBd,
): Promise<CorteSemanalLista> {
  verificarPermiso(sesion, 'produccion.wip-ver');
  const filtros = validarEntrada(esquemaCorteSemanalQuery, parametros);
  const cliente = clienteLectura(bd);

  // Trae los cortes vivos con su fecha, cortador y la SUMA de piezas (un join+groupBy a mano es más
  // claro y portable que SQL crudo aquí; los volúmenes por consulta son acotados por fecha/cortador).
  const cortes = await cliente.etapaMovimiento.findMany({
    where: {
      idEmpresa: sesion.idEmpresaActiva,
      tipo: 'corte',
      canceladoEn: null,
      ...(filtros.idCortador === undefined ? {} : { idTercero: filtros.idCortador }),
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
      detalles: { select: { cantidad: true } },
    },
  });

  // Agrupa por (cortador, semana ISO). La clave de grupo asegura un renglón por par.
  interface Acum {
    idCortador: number | null;
    cortador: string;
    anioSemana: string;
    inicioSemana: string;
    totalCortado: number;
    numCortes: number;
  }
  const grupos = new Map<string, Acum>();
  for (const corte of cortes) {
    const { anioSemana, inicioSemana } = semanaIso(corte.fecha);
    const claveGrupo = `${corte.idTercero ?? 'sin'}|${anioSemana}`;
    const total = corte.detalles.reduce((s, d) => s + d.cantidad, 0);
    const acum = grupos.get(claveGrupo) ?? {
      idCortador: corte.idTercero,
      cortador: corte.tercero?.nombre ?? 'Sin asignar',
      anioSemana,
      inicioSemana,
      totalCortado: 0,
      numCortes: 0,
    };
    acum.totalCortado += total;
    acum.numCortes += 1;
    grupos.set(claveGrupo, acum);
  }

  const filas = [...grupos.values()].sort(
    (a, b) =>
      b.anioSemana.localeCompare(a.anioSemana) || a.cortador.localeCompare(b.cortador, 'es'),
  );
  return { filas };
}

/**
 * Año-semana ISO 8601 ("2026-W25") y el LUNES de esa semana (YYYY-MM-DD) para una fecha. ISO: la
 * semana 1 es la que contiene el primer jueves del año; la semana empieza en lunes. Cálculo en UTC
 * (la fecha de la etapa es `@db.Date` a medianoche UTC). Exportada: el Resumen operativo (R9) la
 * reusa para "cortado esta semana" y la serie "cortes por semana" (misma definición de semana).
 */
export function semanaIso(fecha: Date): { anioSemana: string; inicioSemana: string } {
  const d = new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate()));
  // getUTCDay(): 0=domingo..6=sábado → ISO 1=lunes..7=domingo.
  const diaIso = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  // El lunes de esta semana.
  const lunes = new Date(d);
  lunes.setUTCDate(d.getUTCDate() - (diaIso - 1));
  // El jueves de esta semana define el año ISO.
  const jueves = new Date(d);
  jueves.setUTCDate(d.getUTCDate() + (4 - diaIso));
  const anioIso = jueves.getUTCFullYear();
  // Número de semana: jueves de la semana 1 = el primer jueves del año.
  const primerEnero = new Date(Date.UTC(anioIso, 0, 1));
  const numSemana = Math.ceil(((jueves.getTime() - primerEnero.getTime()) / 86_400_000 + 1) / 7);
  const anioSemana = `${anioIso}-W${String(numSemana).padStart(2, '0')}`;
  const inicioSemana = lunes.toISOString().slice(0, 10);
  return { anioSemana, inicioSemana };
}
