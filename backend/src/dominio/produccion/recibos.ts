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
 *     (primeras/segundas) → el WIP "recibido" SUBE (derivado por suma, sin acumuladores). ⭐ Desde
 *     V1-E8k (§Post-F9.136) el detalle lleva además `cantidadIncompletas` —prendas que llegaron sin
 *     terminar de coser—, FUERA de `cantidad`: no suben el "recibido", no entran a inventario y no
 *     se pagan. Desde V1-E8v (§Post-F9.147) SÍ cierran el pendiente: ya volvieron del taller, y desde
 *     0.061 (§Post-F9.154(a)) SALEN SOLAS del almacén de tránsito como MERMA (punto 3.d). La
 *     aritmética del concepto vive en `incompletas.ts`.
 *  2. Validación `recibido ≤ enviado` ESTRICTO (decisión (g)): por suma directa de
 *     `EtapaMovimientoDet` bajo bloqueo de la orden, excluyendo canceladas — NUNCA la vista. ⭐
 *     Desde §Post-F9.10 (el PACK como campo propio) esa validación es HÍBRIDA, porque Daniel dejó el
 *     pack OPCIONAL al recibir: un renglón SIN pack consume del saldo AGREGADO de todos los packs y
 *     uno CON pack consume además del suyo, y las dos formas conviven sin dejar recibir de más EN
 *     TOTAL. La aritmética vive pura en `packs.ts` (`excesosDelRecibo`), probada sin BD.
 *  3. El efecto sobre el kardex de PT, que desde V1-E4b (§Post-F9.61) tiene DOS formas — y cuál
 *     aplica lo decide DÓNDE VA EL PROCESO en esta orden, no el tipo de proceso (§Post-F9.59):
 *       a) el proceso CREA producto terminado (`TipoProceso.generaEntradaPt`, la costura) ⇒ ENTRADA
 *          nueva al kardex (tipo `entrada-maquila`): primeras → almacén de primeras, segundas →
 *          almacén de segundas. Reemplaza el viejo `MeterInventario`/bandera "Inventariado":
 *          recibir = ya queda en inventario en la MISMA transacción (mejora A1);
 *       b) el envío fue de PRENDAS YA TERMINADAS (`EtapaMovimiento.prendaTerminada`, un proceso
 *          DESPUÉS de la costura) ⇒ las prendas VUELVEN del almacén de TRÁNSITO a primeras y
 *          segundas (traspaso). Aquí es donde la prenda que salió PRIMERA y vuelve SEGUNDA se
 *          reclasifica de verdad, y donde lo que no vuelve se queda vivo en tránsito;
 *       c) ninguna de las dos (estampado ANTES de costura, sobre bultos cortados) ⇒ no toca kardex.
 *       d) ⭐ **y en el caso (b), las INCOMPLETAS SALEN del tránsito como MERMA** (0.061 —
 *          §Post-F9.154(a), DANIEL): una SALIDA con el tipo `merma-incompletas` que no entra a
 *          ningún otro almacén, porque esas prendas se pierden. Antes se quedaban en tránsito para
 *          siempre. Va en la MISMA transacción y sellada con el origen del recibo, así que
 *          cancelarlo la revierte sin código propio. En (a) y (c) no aplica: esas piezas nunca
 *          entraron al kardex de PT. NO es retroactiva (REGLA 0-B). Ver `transito.ts`.
 *     `costoUnit` queda NULL en los cuatro casos (D1/D2).
 *  4. `EsMaCargo(propuesto)` para TODO proceso (costura Y estampado): cantidad recibida × precio
 *     del envío (el precio puede nacer NULL — por eso la validación del admin es obligatoria, F3-E4).
 *     ⭐ SALVO si el recibo trae SOLO prendas incompletas (V1-E8k): ésas no se pagan, y un cargo de
 *     cantidad 0 solo ensuciaría la cola de validación.
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
import { TipoEtapaMovimiento, type Prisma } from '../../datos/index.js';
import type { z } from 'zod';

import { exigirAlmacenDelTipo } from '../../comun/almacenes.js';
import { datosCreacion, datosModificacion, registrarBitacora } from '../../comun/auditoria.js';
import { dispararPublicacion } from '../../comun/cola-eventos.js';
import { ErrorConflicto, ErrorNoEncontrado, ErrorValidacion } from '../../comun/errores.js';
import {
  EVENTOS_OUTBOX,
  VERSION_EVENTO_ETAPA_RC,
  registrarEventoOutbox,
  type EventoEtapaRc,
} from '../../comun/eventos-dominio.js';
import {
  registrarMovimientoPt as registrarMovimientoPtMotor,
  type LineaMovimientoPt,
} from '../../comun/kardex.js';
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

import { CLAVE_SECUENCIA_ETAPA, semanaIso } from './etapas.js';
import { saldadosPorCelda } from './faltantes-saldados.js';
import { pendientePorCelda, piezasDevueltas } from './incompletas.js';
import {
  SIN_PACK,
  claveCeldaPack,
  esSinPack,
  excesosDelRecibo,
  normalizarPack,
  ordenManejaPacks,
} from './packs.js';
import { exigirOrdenAbierta, exigirOrdenAbiertaPorId } from './cierre-orden.js';
import {
  darSalidaMermaIncompletas,
  devolverPrendasDeTransito,
  formaDelEnvioVivo,
  rechazarAlmacenDeTransito,
  revertirMovimientosDeHecho,
} from './transito.js';
import { metaPara, pendientePorMaquilero, type MetaCelda } from './wip.js';

/** Tipo de movimiento de kardex para la entrada a PT del recibo de costura (seed, dirección entrada). */
const COD_ENTRADA_MAQUILA = 'entrada-maquila';

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

/** Una celda color×talla×PACK "aplanada" con su calidad (un renglón por talla). */
interface CeldaRecibo {
  idColor: number;
  idTalla: number;
  /**
   * Pack / tendido del renglón (§Post-F9.10). ⭐ OPCIONAL en el recibo por decisión de Daniel —
   * *«que sea opcional al recibir»*: la cadena VACÍA significa que el maquilero devolvió los packs
   * revueltos, y ese renglón consume del saldo AGREGADO de todos ellos.
   */
  pack: string;
  /** Total recibido BUENO (= primeras + segundas). Lo que produce, inventaría y se paga. */
  cantidad: number;
  primeras: number;
  segundas: number;
  /**
   * PRENDAS INCOMPLETAS entregadas (V1-E8k, §Post-F9.136). FUERA de `cantidad` a propósito: no
   * cuentan como producidas, no entran a inventario y no se pagan. Ver `incompletas.ts`.
   */
  incompletas: number;
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
  /**
   * Tallas válidas por COLOR (unión de todos sus packs). En el recibo la pertenencia se valida por
   * color y no por renglón a propósito: un recibo SIN pack no sabe de qué tendido viene la pieza,
   * así que exigirle la talla de un pack concreto sería pedirle justo el dato que Daniel dijo que
   * puede faltar.
   */
  tallasPorColor: Map<number, Set<number>>;
  /** ¿La orden se fabrica por packs? De aquí cuelga si un pack en la captura es válido siquiera. */
  manejaPacks: boolean;
  /** Packs válidos de cada color, para validar el que venga y para redactar el error. */
  packsPorColor: Map<number, Set<string>>;
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
      folio: true,
      estado: true,
      // 0.061: la guarda de la orden CERRADA mira esta columna, no el estado.
      cerradaEn: true,
      lineas: { select: { idColor: true, pack: true, tallas: { select: { idTalla: true } } } },
    },
  });
  if (orden === null) {
    throw new ErrorNoEncontrado('Orden', idOrden);
  }
  if (orden.estado === 'cancelada') {
    throw new ErrorConflicto('La orden está cancelada; no se le pueden capturar etapas.');
  }
  // ⭐ 0.061: una orden CERRADA no admite captura nueva (su costo quedó congelado). Guarda ÚNICA.
  exigirOrdenAbierta(orden, 'le pueden capturar recibos');
  const colores = new Set<number>();
  const tallasPorColor = new Map<number, Set<number>>();
  const packsPorColor = new Map<number, Set<string>>();
  for (const linea of orden.lineas) {
    colores.add(linea.idColor);
    const tallas = tallasPorColor.get(linea.idColor) ?? new Set<number>();
    for (const t of linea.tallas) tallas.add(t.idTalla);
    tallasPorColor.set(linea.idColor, tallas);
    const packs = packsPorColor.get(linea.idColor) ?? new Set<string>();
    packs.add(normalizarPack(linea.pack));
    packsPorColor.set(linea.idColor, packs);
  }
  return {
    idEmpresa: orden.idEmpresa,
    estado: orden.estado,
    colores,
    tallasPorColor,
    manejaPacks: ordenManejaPacks(orden.lineas.map((l) => l.pack)),
    packsPorColor,
  };
}

/**
 * Aplana la matriz del recibo a celdas, validando SANIDAD (D4): color/talla SIN repetir, que cada
 * color×talla PERTENEZCA a la orden, y la CALIDAD: si una celda trae desglose, primeras+segundas =
 * cantidad. Si no trae desglose, todo es primera (segundas 0).
 *
 * ⭐ PRENDAS INCOMPLETAS (V1-E8k, §Post-F9.136): viajan en su propio campo y **no entran en la
 * invariante `primeras + segundas = cantidad`** — no son una tercera calidad, son piezas que no
 * llegaron a ser prenda. Por eso una celda cuenta si tiene cantidad **o** incompletas: un recibo
 * puede ser SOLO de incompletas (el maquilero trajo las 5 que no pudo coser y nada más), y
 * descartarlo por "cantidad 0" habría hecho incapturable justo el caso que Daniel describió.
 */
function aplanarYValidar(lineas: DatosReciboLineaEntrada[], orden: ContextoOrden): CeldaRecibo[] {
  const claves = lineas.map((l) => `${l.idColor}:${normalizarPack(l.pack)}`);
  if (new Set(claves).size !== claves.length) {
    throw new ErrorValidacion(
      orden.manejaPacks
        ? 'Un mismo color y pack no pueden aparecer dos veces en la misma captura.'
        : 'Un color no puede aparecer dos veces en la misma captura.',
    );
  }

  const celdas: CeldaRecibo[] = [];
  for (const linea of lineas) {
    if (!orden.colores.has(linea.idColor)) {
      throw new ErrorValidacion(
        `El color ${linea.idColor} no pertenece a la orden; solo se reciben colores de la orden.`,
      );
    }
    // ⭐ EL PACK ES OPCIONAL AL RECIBIR (§Post-F9.10, decisión de Daniel): vacío = «los devolvió
    // revueltos». Lo único que se valida es que, si viene, EXISTA — un pack inventado se guardaría
    // mudo, consumiría de un saldo que no existe (0) y el recibo entero se caería con un mensaje
    // que no dice la verdad.
    const pack = normalizarPack(linea.pack);
    if (!esSinPack(pack)) {
      if (!orden.manejaPacks) {
        throw new ErrorValidacion(
          `Esta orden no se fabrica por packs, así que el renglón del color ${linea.idColor} no ` +
            `puede llevar el pack "${pack}".`,
        );
      }
      if (orden.packsPorColor.get(linea.idColor)?.has(pack) !== true) {
        throw new ErrorValidacion(
          `El color ${linea.idColor} de la orden no tiene el pack "${pack}"; sus packs son: ` +
            `${packsDelColor(orden, linea.idColor)}. Si el maquilero los devolvió revueltos, ` +
            'captura el renglón SIN pack.',
        );
      }
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
      const incompletas = t.cantidadIncompletas ?? 0;
      if (!Number.isInteger(incompletas) || incompletas < 0) {
        throw new ErrorValidacion('Las prendas incompletas deben ser enteros ≥ 0.');
      }
      // Una celda VACÍA de verdad (ni buenas ni incompletas) se descarta; una que solo trae
      // incompletas SÍ se guarda (§Post-F9.136).
      if (t.cantidad === 0 && incompletas === 0) continue;

      // Calidad: si no viene desglose, todo es primera. Si viene parcial, se completa con el resto.
      // Las INCOMPLETAS quedan fuera de esta cuenta a propósito: no son una calidad de la prenda.
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
              `segundas (${segundas}) debe sumar el total recibido (${t.cantidad}). Las prendas ` +
              `incompletas NO van aquí: tienen su propio campo (no se producen ni se pagan).`,
          );
        }
      }
      celdas.push({
        idColor: linea.idColor,
        idTalla: t.idTalla,
        pack,
        cantidad: t.cantidad,
        primeras,
        segundas,
        incompletas,
      });
    }
  }
  if (celdas.length === 0) {
    throw new ErrorValidacion(
      'La captura no tiene ninguna pieza (ni recibidas ni incompletas: todo está en 0).',
    );
  }
  return celdas;
}

/** Los packs que la orden tiene para un color, en texto, para redactar errores accionables. */
function packsDelColor(orden: ContextoOrden, idColor: number): string {
  const packs = [...(orden.packsPorColor.get(idColor) ?? new Set<string>())]
    .filter((p) => !esSinPack(p))
    .sort((a, b) => a.localeCompare(b, 'es'));
  return packs.length > 0 ? packs.map((p) => `"${p}"`).join(', ') : '(ninguno)';
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
export async function bloquearEtapasDeOrden(
  tx: Tx,
  idEmpresa: number,
  idOrden: number,
): Promise<void> {
  const clave1 = ((idEmpresa * 1_000_003) ^ 0x4f000000) | 0;
  const clave2 = idOrden | 0;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${clave1}::int, ${clave2}::int)`;
}

/**
 * Las DOS agregaciones que el tope del recibo necesita, de UNA sola lectura (§Post-F9.10): la de
 * siempre —color×talla, plegando los packs— y la nueva —color×talla×pack—. Se devuelven juntas
 * porque salen de las MISMAS filas: pedirlas por separado serían dos consultas idénticas y, peor,
 * dos oportunidades de que una quedara filtrada distinto que la otra.
 */
export interface SumaCeldas {
  /** Por `claveCelda` (color:talla): el AGREGADO de todos los packs. */
  total: Map<string, number>;
  /** Por `claveCeldaPack` (color:talla:pack): el saldo de cada tendido. */
  porPack: Map<string, number>;
}

/**
 * Suma las celdas de las etapas VIVAS (no canceladas) de una orden que cumplan el filtro de
 * tipo/proceso, leyendo `EtapaMovimientoDet` DIRECTO (sin acumuladores; ADR-0010 §3). Base de
 * "enviado" y "devuelto" por proceso para el `recibido ≤ enviado` y los pendientes. Devuelve las dos
 * llaves que el tope híbrido necesita ({@link SumaCeldas}).
 *
 * ⭐ En los RECIBOS suma las piezas FÍSICAMENTE DEVUELTAS —buenas **más** incompletas, vía
 * {@link piezasDevueltas}—, no solo las buenas: si al maquilero se le mandaron 100 y ya trajo 95
 * buenas + 5 incompletas, no queda NADA que pueda devolver Y TAMPOCO nada pendiente (V1-E8v,
 * §Post-F9.147: la incompleta ya volvió, así que sale del tránsito; el pendiente y lo recibible son
 * el MISMO número). En envíos `cantidadIncompletas` es NULL y la suma no cambia.
 */
export async function sumarCeldas(
  tx: Tx | ReturnType<typeof clienteLectura>,
  idOrden: number,
  tipo: TipoEtapaMovimiento,
  idTipoProceso: number,
  /** Acota la suma a UN maquilero (el saldo de recibo se lleva por tercero, no por proceso). */
  idTercero?: number,
): Promise<SumaCeldas> {
  const filas = await tx.etapaMovimientoDet.findMany({
    where: {
      etapaMov: {
        idOrden,
        tipo,
        idTipoProceso,
        canceladoEn: null,
        ...(idTercero === undefined ? {} : { idTercero }),
      },
    },
    select: {
      idColor: true,
      idTalla: true,
      pack: true,
      cantidad: true,
      cantidadIncompletas: true,
    },
  });
  const total = new Map<string, number>();
  const porPack = new Map<string, number>();
  for (const f of filas) {
    const piezas = piezasDevueltas(f);
    const claveTotal = claveCelda(f.idColor, f.idTalla);
    total.set(claveTotal, (total.get(claveTotal) ?? 0) + piezas);
    const clavePack = claveCeldaPack(f.idColor, f.idTalla, f.pack);
    porPack.set(clavePack, (porPack.get(clavePack) ?? 0) + piezas);
  }
  return { total, porPack };
}

/**
 * Maquileros CON ENVÍO VIVO de un proceso en una orden — los únicos a los que se les puede recibir.
 * Solo para redactar el error: dice a quién SÍ se le puede, en vez de dejar al usuario adivinando.
 * `sinMaquilero` marca el caso del histórico migrado (entrega viva con `idTercero` NULL), que no
 * tiene a quién nombrar pero SÍ existe: callarlo hacía que el mensaje dijera lo contrario.
 */
async function maquilerosConEnvio(
  tx: Tx,
  idOrden: number,
  idTipoProceso: number,
): Promise<{ nombres: string[]; sinMaquilero: boolean }> {
  const envios = await tx.etapaMovimiento.findMany({
    where: {
      idOrden,
      idTipoProceso,
      tipo: TipoEtapaMovimiento.envio_maquila,
      canceladoEn: null,
    },
    select: { idTercero: true, tercero: { select: { nombre: true } } },
    distinct: ['idTercero'],
  });
  return {
    nombres: envios
      .map((e) => e.tercero?.nombre ?? null)
      .filter((n): n is string => n !== null)
      .sort((a, b) => a.localeCompare(b, 'es')),
    sinMaquilero: envios.some((e) => e.idTercero === null),
  };
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

/**
 * Proyecta un recibo (con detalle) a la forma JSON del contrato. Los totales se DERIVAN por suma.
 * `ocultarPrecio` (rediseño R2, §4.4.3 — triage del lead): la respuesta de la CANCELACIÓN redacta
 * `precioPactado` sin `ordenes.ver-precio-real-maquila` (el cancelador NO tecleó ese precio); la
 * de CAPTURA lo conserva (quien capturó acaba de teclearlo — mismo criterio que el PATCH de
 * precios de la orden).
 */
async function aReciboSalida(
  recibo: ReciboConDetalle,
  bd: ContextoBd | undefined,
  ocultarPrecio = false,
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

  // Agrupa por COLOR × PACK (§Post-F9.10): el renglón del recibo es el tendido cuando el maquilero
  // los devolvió separados, y el color a secas cuando los revolvió. Agrupar sólo por color habría
  // fundido en un renglón dos devoluciones que el saldo lleva por separado.
  const porRenglon = new Map<
    string,
    { idColor: number; color: string; pack: string; tallas: ReciboConDetalle['detalles'] }
  >();
  for (const det of recibo.detalles) {
    const pack = normalizarPack(det.pack);
    const clave = `${det.idColor}:${pack}`;
    const grupo = porRenglon.get(clave) ?? {
      idColor: det.idColor,
      color: det.color.nombre,
      pack,
      tallas: [],
    };
    grupo.tallas.push(det);
    porRenglon.set(clave, grupo);
  }

  let totalPiezas = 0;
  let totalPrimeras = 0;
  let totalSegundas = 0;
  // Las INCOMPLETAS llevan su propio total, aparte de `totalPiezas` (§Post-F9.136): sumarlas ahí
  // sería decir que se produjeron.
  let totalIncompletas = 0;
  const lineas = [...porRenglon.values()].map((grupo) => {
    let totalLinea = 0;
    let incompletasLinea = 0;
    const tallas = grupo.tallas
      .slice()
      .sort((a, b) => a.talla.orden - b.talla.orden || a.idTalla - b.idTalla)
      .map((t) => {
        totalLinea += t.cantidad;
        totalPrimeras += t.cantidadPrimeras ?? 0;
        totalSegundas += t.cantidadSegundas ?? 0;
        incompletasLinea += t.cantidadIncompletas ?? 0;
        return {
          idTalla: t.idTalla,
          etiquetaTalla: t.talla.etiqueta,
          cantidad: t.cantidad,
          cantidadPrimeras: t.cantidadPrimeras,
          cantidadSegundas: t.cantidadSegundas,
          cantidadIncompletas: t.cantidadIncompletas,
        };
      });
    totalPiezas += totalLinea;
    totalIncompletas += incompletasLinea;
    return {
      idColor: grupo.idColor,
      color: grupo.color,
      pack: grupo.pack,
      tallas,
      totalPiezas: totalLinea,
      totalIncompletas: incompletasLinea,
    };
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
    precioPactado:
      ocultarPrecio || recibo.precioPactado === null ? null : recibo.precioPactado.toNumber(),
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
    totalIncompletas,
    creadoEn: recibo.creadoEn.toISOString(),
    creadoPorId: recibo.creadoPorId,
  };
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

    // Si liga un envío, debe ser de la MISMA orden+proceso, del MISMO maquilero y estar vivo
    // (defensa de la liga (d)). Lo del maquilero es de la regla del 28-jul-2026: sin ese filtro se
    // podía registrar un recibo de un maquilero colgado del envío de OTRO — el saldo por tercero
    // cuadraba y la liga mentía (hallazgo del reviewer).
    if (datos.idEtapaEnvio !== undefined) {
      const envio = await tx.etapaMovimiento.findFirst({
        where: {
          id: datos.idEtapaEnvio,
          idOrden: datos.idOrden,
          idEmpresa: orden.idEmpresa,
          tipo: TipoEtapaMovimiento.envio_maquila,
          idTipoProceso: datos.idTipoProceso,
          idTercero: datos.idMaquilero,
          canceladoEn: null,
        },
        select: { id: true },
      });
      if (envio === null) {
        throw new ErrorValidacion(
          'El envío ligado no existe, está cancelado, o no es de esta orden, proceso y maquilero.',
        );
      }
    }

    // Concurrencia + decisión (g): serializa la orden y valida recibido ≤ enviado por suma directa.
    await bloquearEtapasDeOrden(tx, orden.idEmpresa, datos.idOrden);
    // El saldo se lleva POR MAQUILERO, no por proceso (regla de Daniel, 28-jul-2026: *"no puedo
    // recibir un corte de un maquilero diferente al que se lo entregué"*). Antes se validaba
    // recibido ≤ enviado del PROCESO ENTERO: con dos maquileros trabajando la misma orden se podía
    // cargarle a uno lo que devolvió el otro, y la cuenta de cada quien (EsMa, existencias en poder
    // del maquilero) quedaba falseada sin que nada lo impidiera. El filtro de la pantalla no basta:
    // una lista filtrada se brinca llamando al API.
    const enviado = await sumarCeldas(
      tx,
      datos.idOrden,
      TipoEtapaMovimiento.envio_maquila,
      datos.idTipoProceso,
      datos.idMaquilero,
    );
    // "Ya devuelto" = buenas + incompletas (§Post-F9.136): las incompletas salieron del taller.
    const yaDevuelto = await sumarCeldas(
      tx,
      datos.idOrden,
      TipoEtapaMovimiento.recibo_maquila,
      datos.idTipoProceso,
      datos.idMaquilero,
    );
    // ⭐ V1 (fila 0.109): lo que ya se SALDÓ al cerrar la orden con este maquilero consume saldo
    // igual que lo devuelto. Sin esto, cerrar y luego recibir contaría dos veces las mismas piezas
    // (el maquilero quedaría saldado Y con la mercancía adentro). Para recibir después de un
    // cierre hay que DESHACERLO primero — que es el acto inverso auditado, no una edición.
    const yaSaldado = await saldadosPorCelda(tx, {
      idOrden: datos.idOrden,
      idTipoProceso: datos.idTipoProceso,
      idMaquilero: datos.idMaquilero,
    });
    if (enviado.total.size === 0) {
      const { nombres, sinMaquilero } = await maquilerosConEnvio(
        tx,
        datos.idOrden,
        datos.idTipoProceso,
      );
      const detalle =
        nombres.length > 0
          ? `Tiene entrega viva: ${nombres.join(', ')}.`
          : sinMaquilero
            ? // Histórico migrado: el Access no siempre traía el maquilero de la entrega. Decirlo
              // tal cual — antes este caso respondía "no tiene ninguna entrega", que era falso y
              // dejaba al operador sin saber qué corregir (hallazgo del reviewer).
              'Esta orden tiene entrega viva SIN maquilero (histórico migrado): hay que corregir ' +
              'esa entrega —o cancelarla y recapturarla con su maquilero— antes de poder recibir.'
            : 'Esta orden todavía no tiene ninguna entrega de ese proceso.';
      throw new ErrorConflicto(
        `A ese maquilero no se le entregó el corte de "${proceso.nombre}" en esta orden, así que ` +
          `no se le puede recibir. ${detalle}`,
      );
    }
    // ⭐⭐ EL TOPE HÍBRIDO (§Post-F9.10) — lo que Daniel pidió *«definir (y probar)»*:
    //   *«Un recibo SIN pack consume del saldo AGREGADO de todos los packs de esa orden y proceso;
    //   uno CON pack, del suyo. Hay que definir (y probar) que las dos formas convivan sin permitir
    //   recibir de más EN TOTAL.»*
    // La aritmética entera vive en `packs.ts` (pura y probada sin BD); aquí sólo se le dan los
    // cuatro saldos leídos bajo el lock y se redacta el error.
    //
    // 🔑 Lo que topa es el total FÍSICO de cada renglón: buenas + incompletas. No se pueden devolver
    // más piezas de las que salieron del taller (decisión (g), sobre-recibo estricto).
    //
    // 🔑 Y el tope AGREGADO usa la MISMA aritmética que el pendiente que la pantalla ofrece
    // (`pendientePorMaquilero` en `wip.ts`, vía `pendientePorCelda`): una copia reducida aquí haría
    // que la pantalla ofreciera lo que el servidor rechaza.
    const excesos = excesosDelRecibo(
      celdas.map((c) => ({
        idColor: c.idColor,
        idTalla: c.idTalla,
        pack: c.pack,
        devuelveAhora: c.cantidad + c.incompletas,
      })),
      {
        enviadoTotal: enviado.total,
        devueltoTotal: yaDevuelto.total,
        enviadoPorPack: enviado.porPack,
        devueltoPorPack: yaDevuelto.porPack,
        saldadoTotal: yaSaldado.total,
        saldadoPorPack: yaSaldado.porPack,
      },
    );
    // Cuál se REPORTA cuando fallan las dos: la que DE VERDAD limita, o sea la de menor
    // `disponible`. No es cosmética — enviado A=5 y B=5 con 10 ya devueltas sin pack deja el
    // agregado en 0 y el saldo del pack A en 5: reportar el del pack diría *«te quedan 5 de ese
    // pack»* y el usuario reintentaría con 5 para que lo rechazaran otra vez. A igualdad de tope
    // gana el del PACK, que es el más específico y nombra el tendido que hay que corregir.
    const exceso = [...excesos].sort(
      (a, b) => a.disponible - b.disponible || (a.motivo === 'pack' ? -1 : 1),
    )[0];
    if (exceso !== undefined) {
      throw new ErrorConflicto(
        exceso.motivo === 'pack'
          ? `No se puede recibir ${exceso.pide} pza(s) del pack "${exceso.pack}" de ese ` +
              `color/talla de "${proceso.nombre}": a ese maquilero solo le quedan ` +
              `${exceso.disponible} enviada(s) sin devolver DE ESE PACK. Si el maquilero los ` +
              'devolvió revueltos, captura el renglón sin pack.'
          : `No se puede recibir ${exceso.pide} pza(s) de ese color/talla de "${proceso.nombre}": ` +
              `a ese maquilero solo le quedan ${exceso.disponible} enviada(s) sin devolver` +
              `${orden.manejaPacks ? ', sumando todos sus packs' : ''}.`,
      );
    }

    // ── ¿Este recibo mete mercancía a PT, y de qué forma? (V1-E4b, §Post-F9.59/§Post-F9.61) ─────
    // La pregunta ya NO se contesta solo con `TipoProceso.generaEntradaPt`: el MISMO estampado
    // devuelve producto terminado cuando va después de la costura y no lo devuelve cuando va antes.
    // La posición la lleva el ENVÍO (`prendaTerminada`), y de ahí se deriva:
    //   • `devuelveAPt` — las prendas ya existían y vuelven del TRÁNSITO (traspaso);
    //   • `creaPt`      — el proceso las CREA (costura): entrada nueva al kardex.
    // Se lee bajo el lock de la orden, que ya está tomado arriba.
    const creaPt = proceso.generaEntradaPt;
    const formaEnvio = await formaDelEnvioVivo(tx, datos.idOrden, datos.idTipoProceso);
    const devuelveAPt = formaEnvio?.prendaTerminada === true;
    // Al bucket del que SALIERON: si el envío sacó del «sin orden» (histórico migrado / inventario
    // de arranque), ahí vuelven. Reetiquetarlas a la orden al regresar sería mover saldo entre
    // buckets sin que nadie lo pidiera.
    const idOrdenBucket = formaEnvio?.stockSinOrden === true ? null : datos.idOrden;
    const totalRecibido = celdas.reduce((s, c) => s + c.cantidad, 0);
    const totalSegundas = celdas.reduce((s, c) => s + c.segundas, 0);
    const totalIncompletas = celdas.reduce((s, c) => s + c.incompletas, 0);
    // Almacenes destino: solo aplican si el recibo mete a PT (por creación o por devolución). Si
    // vienen para un recibo que no lo hace, se ignoran (no se persisten).
    //
    // ⭐ `totalRecibido > 0` es de V1-E8k (§Post-F9.136) y NO es cosmético: un recibo puede traer
    // SOLO prendas incompletas (el maquilero devolvió las 5 que no pudo coser y nada más), y ésas
    // no entran a ningún inventario. Sin esta condición, el recibo de costura exigía un almacén
    // destino para meter CERO piezas — lo detectó la prueba de integración, no el razonamiento.
    // Antes de V1-E8k el caso era imposible (un recibo sin piezas se rechazaba), así que esto no
    // afloja ninguna regla vieja: la puerta es nueva.
    const meteAPt = (creaPt || devuelveAPt) && totalRecibido > 0;

    // Con destino a PT, el almacén de primeras es OBLIGATORIO (las primeras deben tener destino).
    // El de segundas solo se exige si hubo segundas.
    if (meteAPt) {
      if (datos.idAlmacenPrimeras === undefined) {
        throw new ErrorValidacion(
          creaPt
            ? 'El recibo de costura necesita un almacén destino para las primeras (mete a inventario).'
            : 'Estas prendas salieron del almacén al mandarlas a proceso: el recibo necesita un ' +
                'almacén destino para las primeras que regresan.',
        );
      }
      if (totalSegundas > 0 && datos.idAlmacenSegundas === undefined) {
        throw new ErrorValidacion(
          'Hay piezas de segunda: indica el almacén destino de las segundas.',
        );
      }
      // El tipo del almacén (fila 0.137, segunda pasada). Lo que este recibo mete es PRODUCTO
      // TERMINADO —el kardex que escribe más abajo es el de PT, con el modelo de la orden—, así
      // que ambos destinos tienen que ser almacenes de PT: sin esto, las primeras de una orden
      // entraban sin chistar a la bodega de telas y la existencia quedaba en un bucket que nadie
      // mira. `rechazarAlmacenDeTransito` sigue aparte y NO sobra: el tránsito ES de tipo PT (lo
      // siembra así `prisma/seed.ts`), o sea que pasa esta guarda y aun así no vale para recibir.
      await exigirAlmacenDelTipo(tx, datos.idAlmacenPrimeras, 'PT', orden.idEmpresa);
      await rechazarAlmacenDeTransito(tx, datos.idAlmacenPrimeras, 'recibe');
      if (datos.idAlmacenSegundas !== undefined) {
        await exigirAlmacenDelTipo(tx, datos.idAlmacenSegundas, 'PT', orden.idEmpresa);
        await rechazarAlmacenDeTransito(tx, datos.idAlmacenSegundas, 'recibe');
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
            // El pack, si el maquilero los devolvió separados; vacío si los revolvió (§Post-F9.10).
            pack: c.pack,
            cantidad: c.cantidad,
            cantidadPrimeras: c.primeras,
            cantidadSegundas: c.segundas,
            // FUERA de `cantidad`: ni se producen, ni se inventarían, ni se pagan (§Post-F9.136).
            cantidadIncompletas: c.incompletas,
          })),
        },
        ...datosCreacion(sesion),
      },
    });

    // (3) EFECTO SOBRE EL KARDEX DE PT. Dos formas, según de dónde vengan las prendas (V1-E4b):
    //   • `devuelveAPt` — ya existían y estaban en TRÁNSITO (el envío las sacó del almacén porque el
    //     proceso va después de la costura): vuelven con un TRASPASO tránsito → primeras/segundas.
    //     Las que no vuelvan se quedan en tránsito, vivas, a cargo del maquilero (§Post-F9.61) —
    //     ése es el FALTANTE, que se le cobra al cerrar la orden con él (fila 0.109).
    //   • `creaPt` — el proceso las CREA (costura): ENTRADA nueva al kardex.
    // En ambas, primeras y segundas van a SU almacén (la reclasificación es un movimiento, no una
    // edición de saldo — D3) y el motor abre todo dentro de ESTA transacción ({ tx }).
    // ⭐ 0.061 (§Post-F9.154(a)): las INCOMPLETAS salen del TRÁNSITO como MERMA, en esta misma
    // transacción. Sólo cuando el envío sacó PRENDA TERMINADA (`devuelveAPt`): si el proceso es la
    // costura, esas piezas nunca entraron al kardex de PT y no hay de dónde sacarlas.
    // ⚠️ Es INDEPENDIENTE de `meteAPt`, que exige `totalRecibido > 0`: un recibo puede traer SÓLO
    // incompletas (el maquilero devolvió las 5 que no pudo coser y nada más) y ésas también salen.
    const mermaIncompletas = devuelveAPt && totalIncompletas > 0;

    if (meteAPt || mermaIncompletas) {
      const idModelo = await modeloDeLaOrden(tx, datos.idOrden);
      // PT por orden (F6-E2): lo que entra queda etiquetado con la orden del recibo.
      //
      // ⭐ AQUÍ SE PLIEGA EL PACK (§Post-F9.10), y no es un detalle: el INVENTARIO DE PT NO MANEJA
      // PACKS —*«ahí ya es sólo color»*—, así que un recibo con dos tendidos de la MISMA celda
      // (pack A: 5 CH, pack B: 3 CH) tiene que entrar al kardex como UN renglón de 8, no como dos
      // de la misma llave. Dos renglones sumarían bien la existencia (es Σ de movimientos, D3) pero
      // partirían en dos el movimiento, tomarían dos veces el lock del artículo y, en la salida del
      // tránsito, le pedirían al validador de no-negativo que sumara por su cuenta lo que aquí ya
      // se sabe. Se pliega en la frontera, que es donde el pack deja de significar algo.
      const plegarPorCelda = (cantidadDe: (c: CeldaRecibo) => number): LineaMovimientoPt[] => {
        const porCelda = new Map<string, LineaMovimientoPt>();
        for (const c of celdas) {
          const cantidad = cantidadDe(c);
          if (cantidad <= 0) continue;
          const clave = claveCelda(c.idColor, c.idTalla);
          const acum = porCelda.get(clave);
          if (acum === undefined) {
            porCelda.set(clave, {
              idModelo,
              idColor: c.idColor,
              idTalla: c.idTalla,
              idOrden: datos.idOrden,
              cantidad,
            });
          } else {
            acum.cantidad += cantidad;
          }
        }
        return [...porCelda.values()];
      };
      const lineasPrimeras = plegarPorCelda((c) => c.primeras);
      const lineasSegundas = plegarPorCelda((c) => c.segundas);

      // ⭐ MERMA de las incompletas (0.061): salen del TRÁNSITO y no entran a ningún lado. Se hace
      // ANTES de devolver las buenas a propósito — así, si el tránsito no tuviera las piezas, el
      // recibo se rechaza entero (A2) en vez de dejar la mitad del movimiento hecha.
      if (mermaIncompletas) {
        await darSalidaMermaIncompletas(sesion, tx, {
          idEmpresa: orden.idEmpresa,
          idModelo,
          idOrdenBucket,
          fecha: aDateColumna(datos.fecha),
          origenTipo: ORIGEN.reciboMaquila,
          origenId: String(recibo.id),
          celdas: plegarPorCelda((c) => c.incompletas).map((l) => ({
            idColor: l.idColor,
            idTalla: l.idTalla,
            cantidad: l.cantidad,
          })),
        });
      }

      // Con `meteAPt` en falso el recibo trae PURAS incompletas: la merma ya salió y no hay nada
      // bueno que inventariar.
      if (meteAPt && devuelveAPt) {
        const devolver = async (
          idAlmacenDestino: number | null,
          lineas: LineaMovimientoPt[],
        ): Promise<void> => {
          if (lineas.length === 0 || idAlmacenDestino === null) return;
          await devolverPrendasDeTransito(sesion, tx, {
            idEmpresa: orden.idEmpresa,
            idAlmacenDestino,
            idModelo,
            idOrdenBucket,
            fecha: aDateColumna(datos.fecha),
            origenTipo: ORIGEN.reciboMaquila,
            origenId: String(recibo.id),
            celdas: lineas.map((l) => ({
              idColor: l.idColor,
              idTalla: l.idTalla,
              cantidad: l.cantidad,
            })),
          });
        };
        await devolver(idAlmacenPrimeras, lineasPrimeras);
        await devolver(idAlmacenSegundas, lineasSegundas);
      } else if (meteAPt) {
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
    }

    // (4) CARGO EsMa propuesto para TODO proceso (costura Y estampado). cantidad = total recibido
    // BUENO (las incompletas NUNCA entran: se cobrarían);
    // precio = el del envío (puede ser NULL → la validación del admin es obligatoria).
    //
    // ⭐ Un recibo que SOLO trae prendas incompletas NO genera cargo (§Post-F9.136: *"tampoco se
    // pagan"*). Antes de V1-E8k eso no podía pasar (un recibo sin piezas era imposible: el dominio
    // lo rechazaba), así que la puerta es nueva: sin este `if`, la cola de validación se llenaría
    // de cargos de cantidad 0 esperando que alguien los valide en $0.
    if (totalRecibido > 0) {
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
    }

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
        // A7 — cada campo dice EXACTAMENTE lo suyo (hallazgo H6 del reviewer): `generaEntradaPt` es
        // la bandera del TipoProceso y no puede llevar otro valor; que el recibo haya movido
        // inventario es una cosa distinta desde V1-E4b (puede devolverlo del tránsito sin que el
        // proceso cree PT).
        generaEntradaPt: creaPt,
        devuelveDeTransito: devuelveAPt,
        meteAInventario: meteAPt,
        celdas: celdas.length,
        totalRecibido,
        totalSegundas,
        // A7: las incompletas son parte del acto y NO están en `totalRecibido` — si no se anotan
        // aparte, la bitácora del recibo no dice todo lo que el maquilero entregó.
        totalIncompletas,
        // A7 (0.061): si las incompletas SALIERON del tránsito como merma, el renglón lo dice —
        // es un movimiento de inventario que nació de este recibo y hay que poder rastrearlo.
        mermaIncompletas,
        cargoEsMa: totalRecibido > 0,
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
    // ⭐ 0.061: cancelar un recibo mueve el inventario Y el divisor del costo. Sobre una orden
    // CERRADA hay que reabrirla primero (acto inverso auditado, no una edición).
    await exigirOrdenAbiertaPorId(tx, recibo.idOrden, 'puede cancelar su recibo');

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

    // (b) Revierte TODO el kardex que generó el recibo con movimiento(s) INVERSO(s) auditados (D3):
    // la entrada del recibo de costura, o las DOS patas del traspaso de vuelta del tránsito
    // (V1-E4b) — en cuyo caso las prendas regresan al tránsito, que es donde estaban. El helper
    // elige el tipo inverso por la DIRECCIÓN de cada movimiento y valida existencia antes de sacar
    // (cancelar un recibo cuyas prendas ya se entregaron no puede dejar el almacén en negativo).
    const movimientosRevertidos = await revertirMovimientosDeHecho(sesion, tx, {
      origenTipo: ORIGEN.reciboMaquila,
      origenId: String(idRecibo),
    });

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
        movimientosRevertidos,
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
  // Triage del lead (R2 §4.4.3): el cancelador NO tecleó el precio pactado — sin el permiso de
  // ver precios reales, la respuesta lo redacta (la de captura sí lo devuelve a quien lo tecleó).
  return obtenerRecibo(sesion, idRecibo, bd, {
    ocultarPrecio: !tienePermiso(sesion, 'ordenes.ver-precio-real-maquila'),
  });
}

/**
 * Obtiene un recibo (con su matriz) de la empresa activa, o lanza `ErrorNoEncontrado` (A9).
 * `opciones.ocultarPrecio`: el llamador decide si redactar `precioPactado` (lo usa la cancelación
 * para quien no puede ver precios reales; la captura y el impreso lo conservan).
 */
export async function obtenerRecibo(
  sesion: SesionUsuario,
  idRecibo: number,
  bd?: ContextoBd,
  opciones: { ocultarPrecio?: boolean } = {},
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
  return aReciboSalida(recibo, bd, opciones.ocultarPrecio ?? false);
}

/**
 * PENDIENTES POR RECIBIR de una orden (derivados, sin acumuladores). Por cada proceso ya enviado a
 * la orden (envíos vivos), `enviado − buenas − incompletas − faltantes saldados` a ESE proceso, por color×talla (celdas
 * con pendiente **o** con incompletas entregadas: una celda ya cerrada del todo —95 buenas + 5
 * incompletas de 100— sigue mostrándose con pendiente 0 e incompletas 5, que es su historia). Las
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
          pack: true,
          color: { select: { nombre: true } },
          tallas: { select: { idTalla: true, talla: { select: { etiqueta: true, orden: true } } } },
        },
      },
    },
  });
  if (orden === null) {
    throw new ErrorNoEncontrado('Orden', idOrden);
  }

  // La llave del metadato lleva el PACK (§Post-F9.10) porque `pendientePorMaquilero` devuelve las
  // celdas partidas por tendido: con la llave plegada, ninguna encontraría su nombre de color.
  const meta = new Map<string, MetaCelda>();
  for (const linea of orden.lineas) {
    const pack = normalizarPack(linea.pack);
    for (const t of linea.tallas) {
      const datos = {
        idColor: linea.idColor,
        color: linea.color.nombre,
        idTalla: t.idTalla,
        etiquetaTalla: t.talla.etiqueta,
        ordenTalla: t.talla.orden,
      };
      const clave = claveCeldaPack(linea.idColor, t.idTalla, pack);
      if (!meta.has(clave)) meta.set(clave, { ...datos, pack });
      // ⭐ Y también SIN pack (§Post-F9.10): cuando el maquilero devuelve los tendidos revueltos, el
      // pendiente saca una celda de pack vacío —en negativo, lo devuelto sin atribuir—. Si no se
      // registra aquí su metadato, esa celda cae en el respaldo defensivo y sale rotulada «Color 7»
      // con la talla en blanco: un renglón real de la pantalla, con el nombre equivocado.
      const claveSinPack = claveCeldaPack(linea.idColor, t.idTalla, SIN_PACK);
      if (!meta.has(claveSinPack)) meta.set(claveSinPack, { ...datos, pack: SIN_PACK });
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

  // ¿Qué procesos de esta orden se enviaron como PRENDA YA TERMINADA? (V1-E4b) Su recibo devuelve
  // mercancía del tránsito y por lo tanto SÍ pide almacenes destino, aunque el proceso no sea el
  // que crea el PT. Se resuelve en UNA consulta para todos los procesos, no uno por uno.
  const enviosPrendaTerminada = await cliente.etapaMovimiento.findMany({
    where: {
      idOrden,
      tipo: TipoEtapaMovimiento.envio_maquila,
      canceladoEn: null,
      prendaTerminada: true,
      idTipoProceso: { not: null },
    },
    select: { idTipoProceso: true, stockSinOrden: true },
    distinct: ['idTipoProceso'],
  });
  const bucketPorProceso = new Map<number, boolean>();
  for (const e of enviosPrendaTerminada) {
    if (e.idTipoProceso !== null) bucketPorProceso.set(e.idTipoProceso, e.stockSinOrden);
  }
  const procesosQueDevuelven = new Set(bucketPorProceso.keys());

  const porRecibir = [];
  for (const proc of procesosEnviados) {
    if (proc.idTipoProceso === null) continue;
    // MISMO derivado que el drill-down del WIP (helper compartido): el pendiente por proceso y su
    // desglose POR MAQUILERO, para que esta pantalla ofrezca y tope igual que el panel de avance.
    const { porMaquilero, enviado, recibido, incompletas, saldados } = await pendientePorMaquilero(
      cliente,
      idOrden,
      proc.idTipoProceso,
      meta,
      {
        // ÉSTA es la pantalla del botón de cerrar, así que aquí sí viaja el precio propuesto —
        // redactado con el MISMO permiso que redacta el `precioPactado` de un recibo (R2 §4.4.3).
        ocultarPrecio: !tienePermiso(sesion, 'ordenes.ver-precio-real-maquila'),
      },
    );
    const claves = new Set<string>([
      ...enviado.keys(),
      ...recibido.keys(),
      ...incompletas.keys(),
      ...saldados.keys(),
    ]);
    const celdas = [...claves]
      .map((clave) => {
        // MISMO respaldo que el drill-down del WIP (`metaPara`, exportado por `wip.ts`), y no una
        // copia: la copia partía la llave con `split(':')` y, desde que la llave lleva el PACK
        // (§Post-F9.10), habría devuelto un pack truncado en silencio. Dos vistas del mismo
        // pendiente no pueden nombrar distinto a la misma celda.
        const m = metaPara(meta, clave);
        // PENDIENTE = enviado − buenas − incompletas − faltantes saldados, por la MISMA función que el tope de
        // `registrarReciboMaquila` (arriba, bajo lock). Desde V1-E8v (§Post-F9.147) «lo que falta
        // por recibirle» y «lo que todavía se le puede recibir» son EL MISMO número: la incompleta
        // ya volvió del taller. Lo que quede aquí al cerrar su entrega es el faltante que se cobra.
        const inc = incompletas.get(clave) ?? 0;
        const cantidad = pendientePorCelda(
          enviado.get(clave) ?? 0,
          (recibido.get(clave) ?? 0) + inc,
          // Lo saldado al cerrar sale del pendiente (V1, fila 0.109): la lista de pendientes deja
          // de enseñar lo que ya se resolvió, que es exactamente lo que pedía la fila.
          saldados.get(clave) ?? 0,
        );
        return {
          ...m,
          cantidad,
          // Informativas, para la trazabilidad de las cuatro cubetas (y para que la celda ya
          // cerrada —95 buenas + 5 incompletas de 100— siga apareciendo con su historia).
          incompletas: inc,
        };
      })
      .filter((c) => c.cantidad !== 0 || c.incompletas !== 0)
      .sort(
        (a, b) =>
          a.idColor - b.idColor ||
          a.pack.localeCompare(b.pack, 'es') ||
          a.ordenTalla - b.ordenTalla ||
          a.idTalla - b.idTalla,
      )
      .map(({ ordenTalla: _o, ...resto }) => resto);
    const totalIncompletas = [...incompletas.values()].reduce((s, v) => s + v, 0);
    const totalFaltantesSaldados = [...saldados.values()].reduce((s, v) => s + v, 0);
    const totalPendiente = pendientePorCelda(
      [...enviado.values()].reduce((s, v) => s + v, 0),
      [...recibido.values()].reduce((s, v) => s + v, 0) + totalIncompletas,
      totalFaltantesSaldados,
    );
    porRecibir.push({
      idTipoProceso: proc.idTipoProceso,
      tipoProceso: proc.tipoProceso?.nombre ?? '',
      codigoProceso: proc.tipoProceso?.codigo ?? '',
      generaEntradaPt: proc.tipoProceso?.generaEntradaPt ?? false,
      devuelveAPt: procesosQueDevuelven.has(proc.idTipoProceso),
      stockSinOrden: bucketPorProceso.get(proc.idTipoProceso) ?? false,
      celdas,
      totalPendiente,
      totalIncompletas,
      totalFaltantesSaldados,
      porMaquilero,
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
      detalles: {
        select: {
          cantidad: true,
          cantidadPrimeras: true,
          cantidadSegundas: true,
          cantidadIncompletas: true,
        },
      },
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
    totalIncompletas: number;
    numRecibos: number;
  }
  const grupos = new Map<string, Acum>();
  for (const recibo of recibos) {
    const { anioSemana, inicioSemana } = semanaIso(recibo.fecha);
    const claveGrupo = `${recibo.idTercero ?? 'sin'}|${anioSemana}`;
    let totalRecibido = 0;
    let totalPrimeras = 0;
    let totalSegundas = 0;
    let totalIncompletas = 0;
    for (const d of recibo.detalles) {
      totalRecibido += d.cantidad;
      totalPrimeras += d.cantidadPrimeras ?? 0;
      totalSegundas += d.cantidadSegundas ?? 0;
      // APARTE de `totalRecibido` (§Post-F9.136): las incompletas no se produjeron.
      totalIncompletas += d.cantidadIncompletas ?? 0;
    }
    const acum = grupos.get(claveGrupo) ?? {
      idMaquilero: recibo.idTercero,
      maquilero: recibo.tercero?.nombre ?? 'Sin asignar',
      anioSemana,
      inicioSemana,
      totalRecibido: 0,
      totalPrimeras: 0,
      totalSegundas: 0,
      totalIncompletas: 0,
      numRecibos: 0,
    };
    acum.totalRecibido += totalRecibido;
    acum.totalPrimeras += totalPrimeras;
    acum.totalSegundas += totalSegundas;
    acum.totalIncompletas += totalIncompletas;
    acum.numRecibos += 1;
    grupos.set(claveGrupo, acum);
  }

  const filas = [...grupos.values()].sort(
    (a, b) =>
      b.anioSemana.localeCompare(a.anioSemana) || a.maquilero.localeCompare(b.maquilero, 'es'),
  );
  return { filas };
}
