/**
 * Etapas de producción — CORTE + ENVÍO a maquila unificado (F3-E2; doc 03-Produccion Pasos 3 y 4,
 * "Flujo paralelo — Estampado" y Observación 4: UN solo modelo de proceso de maquila para costura
 * Y estampado/bordado/lavado, parametrizado por `TipoProceso`, D8). Toda la lógica de negocio vive
 * AQUÍ (A1); las rutas REST solo validan permiso + Zod y delegan.
 *
 * Sobre el motor de kardex: el corte NO toca el kardex PT (no es entrada/salida de existencia).
 * Escribe `EtapaMovimiento` (encabezado del WIP) + `EtapaMovimientoDet` (color×talla, D4).
 *
 * ⭐ El ENVÍO **sí** toca el kardex desde V1-E4b (§Post-F9.61) cuando lo que se manda ya es PRODUCTO
 * TERMINADO (`prendaTerminada` — un estampado/lavado DESPUÉS de la costura, que Daniel ya hace hoy):
 * traspasa las prendas del almacén de origen al almacén de TRÁNSITO, y su recibo las devuelve. Sin
 * esa bandera (envío de bultos cortados, el flujo de siempre) el envío sigue sin tocar inventario.
 * El porqué, el modelo y sus consecuencias están en `transito.ts`.
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
  esquemaSugerenciaCapturaQuery,
  type DatosEtapaLineaEntrada,
  type EtapaSalida,
  type EtapasOrdenLista,
  type PendientesOrden,
  type SugerenciaCaptura,
  type CorteSemanalLista,
} from '../../contrato/index.js';
import { TipoEtapaMovimiento, type Prisma } from '../../datos/index.js';
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
import { ORIGEN } from '../../comun/origenes.js';
import { tienePermiso, verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import { siguienteFolio } from '../../comun/secuencias.js';
import {
  clienteLectura,
  enTransaccion,
  type ContextoBd,
  type Tx,
} from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';

import { revertirMovimientosDeHecho, traspasarPrendasATransito } from './transito.js';

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
  almacenOrigen: { select: { nombre: true } },
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
  /** Modelo que fabrica la orden: el artículo que el kardex mueve al tránsito (V1-E4b). */
  idModelo: number;
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
      idModelo: true,
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
  return {
    idEmpresa: orden.idEmpresa,
    idModelo: orden.idModelo,
    estado: orden.estado,
    pedido,
    colores,
    tallasPorColor,
  };
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
    prendaTerminada: etapa.prendaTerminada,
    idAlmacenOrigen: etapa.idAlmacenOrigen,
    almacenOrigen: etapa.almacenOrigen?.nombre ?? null,
    stockSinOrden: etapa.stockSinOrden,
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
 * ⭐ V1-E4b (§Post-F9.61) — `prendaTerminada`: cuando lo que se manda YA es producto terminado (un
 * proceso DESPUÉS de la costura), el envío además SACA las prendas de `idAlmacenOrigen` y las mete
 * al almacén de TRÁNSITO (traspaso de kardex, D3), para que el inventario deje de decir que están
 * en el piso y para que el faltante y las segundas del recibo tengan dónde caer. Reglas propias:
 *  • un proceso que CREA producto terminado (`generaEntradaPt`, la costura) NO puede enviar prenda
 *    terminada: lo que sale a costura son bultos cortados, todavía no hay PT que sacar;
 *  • `idAlmacenOrigen` es obligatorio (y tiene que ser un almacén de PT usable por la empresa);
 *  • todos los envíos VIVOS de la misma orden+proceso tienen que coincidir en la bandera: si unos
 *    sacaran del almacén y otros no, el recibo no podría saber si devolver mercancía o no.
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
      select: { codigo: true, nombre: true, activo: true, generaEntradaPt: true },
    });
    if (proceso === null) {
      throw new ErrorNoEncontrado('TipoProceso', datos.idTipoProceso);
    }
    if (!proceso.activo) {
      throw new ErrorValidacion(`El tipo de proceso "${proceso.nombre}" está desactivado.`);
    }

    const codigoRol = rolDelProceso(proceso.codigo);
    await exigirTerceroConRol(tx, datos.idMaquilero, codigoRol, proceso.nombre);

    // ── V1-E4b: ¿el envío es de PRENDAS YA TERMINADAS? (§Post-F9.61) ────────────────────────────
    const esPrendaTerminada = datos.prendaTerminada;
    if (esPrendaTerminada) {
      if (proceso.generaEntradaPt) {
        throw new ErrorValidacion(
          `"${proceso.nombre}" es el proceso que CREA el producto terminado: lo que se le manda son ` +
            'bultos cortados, no prendas terminadas. Quita la marca de "prendas ya terminadas".',
        );
      }
      if (datos.idAlmacenOrigen === undefined) {
        throw new ErrorValidacion(
          'Si se mandan prendas ya terminadas hay que decir de qué almacén salen (el envío las saca ' +
            'del inventario hacia el tránsito).',
        );
      }
      await exigirAlmacen(tx, datos.idAlmacenOrigen, orden.idEmpresa);
      const almacen = await tx.almacen.findUnique({
        where: { id: datos.idAlmacenOrigen },
        select: { tipo: true, nombre: true },
      });
      if (almacen?.tipo !== 'PT') {
        throw new ErrorValidacion(
          `El almacén "${almacen?.nombre ?? String(datos.idAlmacenOrigen)}" no es de producto ` +
            'terminado; las prendas terminadas solo pueden salir de un almacén de PT.',
        );
      }
    } else if (datos.stockSinOrden) {
      // Sin sacar del almacén, el bucket de existencia no significa nada: decirlo es mejor que
      // guardarlo mudo y que alguien crea que el envío descontó de algún lado.
      throw new ErrorValidacion(
        'El bucket de existencia («sin orden asignada») solo aplica a los envíos de prendas ya ' +
          'terminadas: los bultos cortados no salen del inventario de producto terminado.',
      );
    } else if (datos.idAlmacenOrigen !== undefined) {
      // Un almacén origen sin la bandera no significa nada y no se persiste: decirlo es mejor que
      // guardarlo mudo y que el usuario crea que el envío descontó inventario.
      throw new ErrorValidacion(
        'El almacén de origen solo aplica a los envíos de prendas ya terminadas (los bultos ' +
          'cortados no salen del inventario de producto terminado).',
      );
    }

    // Concurrencia (g): serializa los envíos de ESTA orden y suma DIRECTO el cortado y lo ya
    // enviado a ESTE proceso (etapas vivas), dentro de la misma transacción.
    await bloquearEtapasDeOrden(tx, orden.idEmpresa, datos.idOrden);

    // Coherencia de la bandera dentro de orden+proceso (bajo el mismo lock que la valida): el
    // recibo deriva de aquí si tiene que devolver mercancía del tránsito, y con envíos mezclados
    // esa pregunta no tendría UNA respuesta.
    // Se comparan AMBAS banderas: el recibo deriva de aquí si devuelve mercancía del tránsito Y a
    // qué bucket la devuelve, y con envíos mezclados ninguna de las dos preguntas tendría UNA
    // respuesta. `stockSinOrden` solo se compara cuando el envío saca del almacén (si no, es
    // siempre false y no distingue nada).
    const envioContrario = await tx.etapaMovimiento.findFirst({
      where: {
        idOrden: datos.idOrden,
        idTipoProceso: datos.idTipoProceso,
        tipo: TipoEtapaMovimiento.envio_maquila,
        canceladoEn: null,
        ...(esPrendaTerminada
          ? {
              OR: [
                { prendaTerminada: false },
                { prendaTerminada: true, stockSinOrden: !datos.stockSinOrden },
              ],
            }
          : { prendaTerminada: true }),
      },
      select: { folio: true, prendaTerminada: true, stockSinOrden: true },
    });
    if (envioContrario !== null) {
      const comoQuedo = !envioContrario.prendaTerminada
        ? 'bultos cortados'
        : envioContrario.stockSinOrden
          ? 'prendas ya terminadas del stock SIN orden asignada'
          : 'prendas ya terminadas del stock de la orden';
      throw new ErrorConflicto(
        `La orden ya tiene una entrega viva de "${proceso.nombre}" (folio ` +
          `${String(Number(envioContrario.folio))}) capturada como ${comoQuedo}: no se pueden ` +
          'mezclar dos formas distintas en el mismo proceso de una orden (el recibo no sabría de ' +
          'dónde salieron las piezas ni a dónde regresarlas). Corrige la que esté mal capturada ' +
          '(cancélala y recaptúrala) antes de seguir.',
      );
    }
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
        prendaTerminada: esPrendaTerminada,
        stockSinOrden: esPrendaTerminada && datos.stockSinOrden,
        ...(esPrendaTerminada && datos.idAlmacenOrigen !== undefined
          ? { idAlmacenOrigen: datos.idAlmacenOrigen }
          : {}),
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

    // ⭐ V1-E4b: las prendas terminadas SALEN del almacén hacia el TRÁNSITO, en ESTA transacción
    // (A2). Valida existencia por suma directa bajo lock antes de sacar (D3) — si el almacén no
    // tiene lo que se está mandando, el envío no pasa.
    if (esPrendaTerminada && datos.idAlmacenOrigen !== undefined) {
      await traspasarPrendasATransito(sesion, tx, {
        idEmpresa: orden.idEmpresa,
        idAlmacenOrigen: datos.idAlmacenOrigen,
        idModelo: orden.idModelo,
        idOrdenBucket: datos.stockSinOrden ? null : datos.idOrden,
        fecha: aDateColumna(datos.fecha),
        origenTipo: ORIGEN.envioMaquila,
        origenId: String(etapa.id),
        celdas,
      });
    }

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
        prendaTerminada: esPrendaTerminada,
        stockSinOrden: esPrendaTerminada && datos.stockSinOrden,
        idAlmacenOrigen: datos.idAlmacenOrigen ?? null,
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
        prendaTerminada: true,
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

      // ⭐ V1-E4b: si el envío SACÓ prendas terminadas del almacén, la cancelación las devuelve con
      // movimientos INVERSOS auditados (D3: el traspaso original nunca se edita ni se borra). El
      // guard de arriba garantiza que no hay recibos vivos, así que las piezas siguen en tránsito;
      // aun así el inverso valida existencia (alguien pudo sacarlas a mano con un movimiento
      // manual) y truena antes que dejar el tránsito en negativo.
      if (etapa.prendaTerminada) {
        await revertirMovimientosDeHecho(sesion, tx, {
          origenTipo: ORIGEN.envioMaquila,
          origenId: String(idEtapa),
        });
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

/**
 * SUGERENCIA DE CAPTURA (V1-E8i, §Post-F9.131) — lo que los botones «Llenar con lo que falta por
 * cortar» y «Llenar con lo que se cortó» ponen en la matriz. **NO guarda nada**: solo responde
 * cuánto se puede capturar hoy, celda por celda. Lo pidió Daniel para no teclear talla por talla lo
 * que casi siempre es exactamente lo esperado.
 *
 * Vive en el DOMINIO, junto a {@link registrarCorte} y {@link registrarEnvioMaquila}, porque
 * "cuánto se puede enviar todavía" ES la regla (g) mirada del otro lado: si la pantalla la
 * recalculara por su cuenta, las dos cuentas derivarían y el botón acabaría precargando un número
 * que el servidor rechaza al guardar. Un botón que produce un error no es un atajo, es una trampa.
 *
 *  • Sin `idTipoProceso` → base **corte**: Σ orden − Σ corte, por celda, **sin negativos**. Con la
 *    orden todavía sin cortar eso es literalmente "lo que se ordenó" (lo que pidió Daniel); con un
 *    corte parcial ya capturado es lo que falta — precargar de nuevo lo ordenado duplicaría piezas.
 *    El sobre-corte (decisión (f)) deja celdas negativas: se recortan a 0, porque no se puede
 *    capturar un corte negativo (el sobre-corte se sigue permitiendo tecleándolo a mano).
 *  • Con `idTipoProceso` → base **envío**: Σ corte − Σ enviado A ESE PROCESO, por celda, sin
 *    negativos. Es exactamente el tope que valida {@link registrarEnvioMaquila} bajo lock (decisión
 *    (g), sobre-envío ESTRICTO), así que el SEGUNDO envío parcial precarga solo el resto y nunca
 *    lo ya enviado. Cada proceso se topa contra el cortado TOTAL (flujos paralelos, D8).
 *
 * `motivo` dice por qué NO hay nada que precargar (orden sin matriz, ya se cortó todo, todavía no
 * se corta nada, ya se envió todo lo cortado) — la razón la decide el servidor, no la pantalla.
 * Solo lectura (`produccion.wip-ver`), filtrada por la empresa activa (A9).
 */
export async function sugerirCaptura(
  sesion: SesionUsuario,
  idOrden: number,
  parametros: z.input<typeof esquemaSugerenciaCapturaQuery> = {},
  bd?: ContextoBd,
): Promise<SugerenciaCaptura> {
  verificarPermiso(sesion, 'produccion.wip-ver');
  const { idTipoProceso } = validarEntrada(esquemaSugerenciaCapturaQuery, parametros);
  const cliente = clienteLectura(bd);

  const orden = await cliente.orden.findFirst({
    where: { id: idOrden, idEmpresa: sesion.idEmpresaActiva },
    select: {
      id: true,
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

  const base = idTipoProceso === undefined ? 'corte' : 'envio';

  // Metadatos + pedido por celda (de la matriz de la orden, D4).
  const meta = new Map<
    string,
    { idColor: number; color: string; idTalla: number; etiquetaTalla: string; ordenTalla: number }
  >();
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

  // Las sumas SIEMPRE se leen (aunque la matriz venga vacía): el núcleo puro decide con las tres.
  const cortado = await sumarCeldasLectura(cliente, idOrden, { tipo: 'corte' });
  const enviado =
    idTipoProceso === undefined
      ? new Map<string, number>()
      : await sumarCeldasLectura(cliente, idOrden, {
          tipo: 'envio_maquila',
          idTipoProceso,
        });

  const { disponible, motivo } = resolverSugerencia({ base, pedido, cortado, enviado });
  const celdas = [...disponible]
    .map(([clave, cantidad]) => ({ ...metaPara(meta, clave), cantidad }))
    .sort((a, b) => a.idColor - b.idColor || a.ordenTalla - b.ordenTalla || a.idTalla - b.idTalla)
    .map(({ ordenTalla: _o, ...resto }) => resto);

  return {
    idOrden,
    base,
    idTipoProceso: idTipoProceso ?? null,
    celdas,
    total: celdas.reduce((s, c) => s + c.cantidad, 0),
    motivo,
  };
}

/**
 * Núcleo PURO de {@link sugerirCaptura}: con lo pedido, lo cortado y lo ya enviado a un proceso,
 * decide QUÉ se puede precargar por celda y, cuando no hay nada, POR QUÉ. Se exporta aparte de la
 * lectura de BD para poder probar la regla sin base de datos (`etapas-sugerencia.test.ts`).
 *
 * Las celdas negativas se recortan a 0 y se descartan: no se puede capturar una cantidad negativa.
 * El sobre-corte (decisión (f)) sigue siendo posible tecleándolo a mano — lo que el botón no hace
 * es proponerlo.
 */
export function resolverSugerencia(entrada: {
  base: 'corte' | 'envio';
  /** Σ orden por celda (matriz color×talla de la orden, D4). */
  pedido: ReadonlyMap<string, number>;
  /** Σ corte VIVO por celda. */
  cortado: ReadonlyMap<string, number>;
  /** Σ enviado VIVO A ESE PROCESO por celda (vacío cuando la base es el corte). */
  enviado: ReadonlyMap<string, number>;
}): { disponible: Map<string, number>; motivo: SugerenciaCaptura['motivo'] } {
  const { base, pedido, cortado, enviado } = entrada;
  const vacio = (
    motivo: SugerenciaCaptura['motivo'],
  ): {
    disponible: Map<string, number>;
    motivo: SugerenciaCaptura['motivo'];
  } => ({ disponible: new Map<string, number>(), motivo });

  // Sin matriz color×talla no hay NADA que precargar, y no es culpa del avance (p. ej. una orden
  // vieja migrada sin desglose): se dice tal cual, en vez de dejar un botón mudo.
  if (pedido.size === 0) {
    return vacio('orden-sin-matriz');
  }

  /** Recorta a positivas y descarta los ceros. */
  const positivas = (mapa: ReadonlyMap<string, number>): Map<string, number> => {
    const salida = new Map<string, number>();
    for (const [clave, cantidad] of mapa) {
      if (cantidad > 0) salida.set(clave, cantidad);
    }
    return salida;
  };

  if (base === 'corte') {
    const porCortar = new Map<string, number>();
    for (const [clave, cantidad] of pedido) {
      porCortar.set(clave, cantidad - (cortado.get(clave) ?? 0));
    }
    const disponible = positivas(porCortar);
    return disponible.size === 0 ? vacio('todo-cortado') : { disponible, motivo: 'hay' };
  }

  // ENVÍO. Sólo cuentan las celdas cortadas que SIGUEN en la matriz de la orden (H6 del reviewer):
  // `guardarMatrizOrden` **no** bloquea quitar un color/talla que ya tiene cortes, y proponer una
  // celda que la captura ya no dibuja sería invisible en pantalla, contada en el rótulo del botón y
  // **descartada** por `lineasApi()` al guardar — el botón diría 240 y se guardarían 200. Una cifra
  // afirmada y falsa. Sólo se propone lo que el usuario puede ver y capturar.
  const cortadoCapturable = new Map<string, number>();
  for (const [clave, cantidad] of cortado) {
    if (pedido.has(clave)) cortadoCapturable.set(clave, cantidad);
  }

  // Antes de restar lo enviado: si no hay NI UNA celda cortada capturable, el motivo honesto es que
  // todavía no se corta nada — no "ya se envió todo", que sobre un corte que nunca salió sería
  // mentira. Se miran las celdas positivas, no la suma: en el histórico migrado un corte puede traer
  // +5 en una talla y −5 en otra (total 0) y sí haber 5 piezas enviables.
  if (positivas(cortadoCapturable).size === 0) {
    return vacio('nada-cortado');
  }
  const porEnviar = new Map<string, number>();
  for (const [clave, cantidad] of cortadoCapturable) {
    porEnviar.set(clave, cantidad - (enviado.get(clave) ?? 0));
  }
  const disponible = positivas(porEnviar);
  return disponible.size === 0 ? vacio('todo-enviado') : { disponible, motivo: 'hay' };
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
