/**
 * Etapas de producción — CORTE + ENVÍO a maquila unificado (F3-E2; doc 03-Produccion Pasos 3 y 4,
 * "Flujo paralelo — Estampado" y Observación 4: UN solo modelo de proceso de maquila para costura
 * Y estampado/bordado/lavado, parametrizado por `TipoProceso`, D8). Toda la lógica de negocio vive
 * AQUÍ (A1); las rutas REST solo validan permiso + Zod y delegan.
 *
 * Sobre el motor de kardex: el corte NO toca el kardex PT (no es entrada/salida de existencia).
 * Escribe `EtapaMovimiento` (encabezado del WIP) + `EtapaMovimientoDet` (color×talla, D4).
 *
 * ⭐ 0.114 — LOS DOS SERVICIOS SOBRE LA ORDEN. Aquí viven también el CORTE PAGABLE y el EMPAQUE, que
 * Daniel separó del resto: *«en corte no necesitas mandar y recibir mercancía … no va y viene. Lo
 * mismo el empaque… el empaque no toca el inventario»* y, aun así, *«el monto a pagar sale de una
 * orden, lo mismo que un maquilero»*. Los dos comparten forma: `idTipoProceso = NULL` (esa NULL es
 * la marca de "servicio sobre la orden"), cero kardex, sin envío ni recibo, precio por prenda en la
 * etapa y un `EsMaCargo` con `servicio` en vez de proceso ({@link crearCargoDeServicio}). NO son
 * `TipoProceso` a propósito: eso los metería al flujo de ida y vuelta que Daniel dice que no son.
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
  esquemaEmpaqueCrear,
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
import { ServicioOrden, TipoEtapaMovimiento, type Prisma } from '../../datos/index.js';
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
import { ORIGEN } from '../../comun/origenes.js';
import { nombreDeUsuario, nombresDeUsuarios } from '../../comun/nombres-usuario.js';
import { tienePermiso, verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import { siguienteFolio } from '../../comun/secuencias.js';
import {
  clienteLectura,
  enTransaccion,
  type ContextoBd,
  type Tx,
} from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';

import { exigirOrdenAbierta, exigirOrdenAbiertaPorId } from './cierre-orden.js';
import { claveCeldaPack, esSinPack, normalizarPack, ordenManejaPacks } from './packs.js';
import { revertirMovimientosDeHecho, traspasarPrendasATransito } from './transito.js';
// `metaPara`/`MetaCelda` viven en `wip.ts` (una sola copia, §Post-F9.10). Sin ciclo: el cierre
// transitivo de `wip.ts` (incompletas · packs · ordenes · receta-* · requisitos-orden) NO
// alcanza este módulo.
import { metaPara, type MetaCelda } from './wip.js';

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

/**
 * Rol de proveedor que debe tener el EMPACADOR de un empaque (0.114). Daniel: *«y una maquila de
 * empaque también»* — el empacador es un proveedor de servicio, igual que el cortador. El rol se
 * siembra en `prisma/seed.ts` (`ROLES_PROVEEDOR_BASE`), así que `prueba` necesita `SEED_ON_START`.
 */
const ROL_EMPACADOR = 'empaque';

/** El rol de proveedor requerido para un proceso de maquila, o el código tal cual si no hay mapeo. */
function rolDelProceso(codigoProceso: string): string {
  return MAPEO_PROCESO_A_ROL[codigoProceso] ?? codigoProceso;
}

// ── Tipos internos ──────────────────────────────────────────────────────────────────────────────

/** Una celda color×talla×PACK "aplanada" (un renglón por talla), para sumas y comparaciones. */
interface Celda {
  idColor: number;
  idTalla: number;
  /** Pack / tendido del renglón (§Post-F9.10); cadena vacía en las órdenes que no los manejan. */
  pack: string;
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
  /** Lo pedido por celda (orden − corte usa esto). Cada celda lleva su pack (§Post-F9.10). */
  pedido: Celda[];
  /** Colores válidos de la orden. */
  colores: Set<number>;
  /**
   * ⭐ ¿La orden se fabrica POR PACKS? (§Post-F9.10). De aquí cuelga que el pack sea OBLIGATORIO en
   * el corte y en la entrega a maquila —*«cada tendido es de un pack»*— y que en una orden sin packs
   * mandarlo sea un error de captura. La matriz no puede estar mezclada (lo impide `ordenes.ts`).
   */
  manejaPacks: boolean;
  /**
   * Tallas válidas por RENGLÓN de la orden = por `color:pack` ({@link claveRenglon}). Con packs, la
   * talla EG puede existir en el pack B y no en el A: validar contra la unión por color dejaría
   * cortar un tendido que la orden no pidió.
   */
  tallasPorRenglon: Map<string, Set<number>>;
  /** Packs válidos de cada color, para redactar errores que digan qué SÍ se puede capturar. */
  packsPorColor: Map<number, Set<string>>;
}

/**
 * Clave de un RENGLÓN de la matriz de la orden: color × pack (§Post-F9.10). Acepta el pack tal como
 * llega del contrato (donde es opcional) y lo normaliza: `undefined`, `null` y `'  '` son el mismo
 * «sin pack», y tienen que producir la MISMA llave que la columna, que guarda cadena vacía.
 */
function claveRenglon(idColor: number, pack: string | null | undefined): string {
  return `${idColor}:${normalizarPack(pack)}`;
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
      folio: true,
      estado: true,
      // 0.061: la guarda de la orden CERRADA mira esta columna, no el estado.
      cerradaEn: true,
      lineas: {
        select: {
          idColor: true,
          pack: true,
          tallas: { select: { idTalla: true, cantidad: true } },
        },
      },
    },
  });
  if (orden === null) {
    throw new ErrorNoEncontrado('Orden', idOrden);
  }
  if (orden.estado === 'cancelada') {
    throw new ErrorConflicto('La orden está cancelada; no se le pueden capturar etapas.');
  }
  // ⭐ 0.061: una orden CERRADA no admite captura nueva (su costo quedó congelado). Guarda ÚNICA.
  exigirOrdenAbierta(orden, 'le pueden capturar etapas');

  const pedido: Celda[] = [];
  const colores = new Set<number>();
  const tallasPorRenglon = new Map<string, Set<number>>();
  const packsPorColor = new Map<number, Set<string>>();
  for (const linea of orden.lineas) {
    const pack = normalizarPack(linea.pack);
    colores.add(linea.idColor);
    const packs = packsPorColor.get(linea.idColor) ?? new Set<string>();
    packs.add(pack);
    packsPorColor.set(linea.idColor, packs);
    const clave = claveRenglon(linea.idColor, pack);
    const tallas = tallasPorRenglon.get(clave) ?? new Set<number>();
    for (const t of linea.tallas) {
      tallas.add(t.idTalla);
      pedido.push({ idColor: linea.idColor, idTalla: t.idTalla, pack, cantidad: t.cantidad });
    }
    tallasPorRenglon.set(clave, tallas);
  }
  return {
    idEmpresa: orden.idEmpresa,
    idModelo: orden.idModelo,
    estado: orden.estado,
    pedido,
    colores,
    manejaPacks: ordenManejaPacks(orden.lineas.map((l) => l.pack)),
    tallasPorRenglon,
    packsPorColor,
  };
}

/**
 * Aplana la matriz de la entrada a celdas, validando SANIDAD (D4): cantidades enteras ≥ 0, renglón
 * (color × PACK) SIN repetir dentro de la captura, talla sin repetir dentro del renglón, y que cada
 * renglón y cada talla PERTENEZCAN a la orden (no se puede cortar/enviar un color, un pack o una
 * talla que la orden no pidió). Esto aplica TANTO al corte (f) como al envío (g): la holgura de
 * sobre-corte es solo de CANTIDAD, no de colores/packs/tallas inventados.
 *
 * ⭐ EL PACK (§Post-F9.10) — *«que viaje el pack al menos en el corte, entrega a maquila»*: en una
 * orden que maneja packs es OBLIGATORIO (cada tendido es de un pack) y tiene que ser uno de los
 * packs de ESE color; en una orden que no los maneja, mandarlo es un error de captura y se rechaza
 * en vez de ignorarse — un pack silenciosamente descartado habría producido un corte que dice una
 * cosa en la pantalla y otra en la BD. Ambas ramas comparten esta única función a propósito: corte y
 * envío son caminos gemelos y aquí no pueden divergir.
 */
function aplanarYValidar(lineas: DatosEtapaLineaEntrada[], orden: ContextoOrden): Celda[] {
  const claves = lineas.map((l) => claveRenglon(l.idColor, l.pack));
  if (new Set(claves).size !== claves.length) {
    throw new ErrorValidacion(
      orden.manejaPacks
        ? 'Un mismo color y pack no pueden aparecer dos veces en la misma captura.'
        : 'Un color no puede aparecer dos veces en la misma captura.',
    );
  }

  const celdas: Celda[] = [];
  for (const linea of lineas) {
    if (!orden.colores.has(linea.idColor)) {
      throw new ErrorValidacion(
        `El color ${linea.idColor} no pertenece a la orden; solo se capturan colores de la orden.`,
      );
    }
    const pack = normalizarPack(linea.pack);
    if (orden.manejaPacks && esSinPack(pack)) {
      throw new ErrorValidacion(
        `Esta orden se fabrica por packs: di de qué pack es cada renglón. Los del color ` +
          `${linea.idColor} son: ${packsDelColor(orden, linea.idColor)}.`,
      );
    }
    if (!orden.manejaPacks && !esSinPack(pack)) {
      throw new ErrorValidacion(
        `Esta orden no se fabrica por packs, así que el renglón del color ${linea.idColor} no ` +
          `puede llevar el pack "${pack}".`,
      );
    }
    const tallasOrden = orden.tallasPorRenglon.get(claveRenglon(linea.idColor, pack));
    if (tallasOrden === undefined) {
      // Sólo puede pasar con packs: el color existe pero ESE pack no. Se nombra lo que sí hay, para
      // que el error diga qué corregir en vez de dejar al operador adivinando.
      throw new ErrorValidacion(
        `El color ${linea.idColor} de la orden no tiene el pack "${pack}"; sus packs son: ` +
          `${packsDelColor(orden, linea.idColor)}.`,
      );
    }
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
          esSinPack(pack)
            ? `La talla ${t.idTalla} no pertenece al color ${linea.idColor} de la orden.`
            : `La talla ${t.idTalla} no pertenece al pack "${pack}" del color ${linea.idColor} ` +
                'de la orden.',
        );
      }
      if (t.cantidad > 0) {
        celdas.push({ idColor: linea.idColor, idTalla: t.idTalla, pack, cantidad: t.cantidad });
      }
    }
  }
  if (celdas.length === 0) {
    throw new ErrorValidacion('La captura no tiene ninguna pieza (todas las cantidades son 0).');
  }
  return celdas;
}

/**
 * Pliega las celdas de una captura a color×talla, SUMANDO los tendidos. Es la frontera con lo que
 * NO maneja packs (§Post-F9.10): hoy, el kardex de producto terminado.
 */
function plegarCeldasSinPack(
  celdas: readonly Celda[],
): { idColor: number; idTalla: number; cantidad: number }[] {
  const porCelda = new Map<string, { idColor: number; idTalla: number; cantidad: number }>();
  for (const c of celdas) {
    const clave = `${c.idColor}:${c.idTalla}`;
    const acum = porCelda.get(clave);
    if (acum === undefined) {
      porCelda.set(clave, { idColor: c.idColor, idTalla: c.idTalla, cantidad: c.cantidad });
    } else {
      acum.cantidad += c.cantidad;
    }
  }
  return [...porCelda.values()];
}

/** Los packs que la orden tiene para un color, en texto, para redactar errores accionables. */
function packsDelColor(orden: ContextoOrden, idColor: number): string {
  const packs = [...(orden.packsPorColor.get(idColor) ?? new Set<string>())]
    .filter((p) => !esSinPack(p))
    .sort((a, b) => a.localeCompare(b, 'es'));
  return packs.length > 0 ? packs.map((p) => `"${p}"`).join(', ') : '(ninguno)';
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
 * Suma las celdas color×talla×PACK de las etapas VIVAS (no canceladas) de una orden que cumplan el
 * filtro de tipo/proceso, leyendo `EtapaMovimientoDet` DIRECTO (sin acumuladores; ADR-0010 §3). Es
 * la base de "cortado disponible por proceso" (g) y de los pendientes derivados.
 *
 * ⭐ La llave lleva el PACK (§Post-F9.10) porque corte y entrega a maquila lo declaran los DOS: el
 * saldo «enviado ≤ cortado» se lleva tendido por tendido, que es lo que Daniel pidió. En una orden
 * sin packs todas las celdas caen en el pack vacío y la llave es, punto por punto, la de siempre.
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
    select: { idColor: true, idTalla: true, pack: true, cantidad: true },
  });
  const acumulado = new Map<string, number>();
  for (const f of filas) {
    const clave = claveCeldaPack(f.idColor, f.idTalla, f.pack);
    acumulado.set(clave, (acumulado.get(clave) ?? 0) + f.cantidad);
  }
  return acumulado;
}

// ── Proyección a la salida ─────────────────────────────────────────────────────────────────────

/**
 * Proyecta una etapa (con detalle) a la forma JSON del contrato. El total se DERIVA por suma.
 * `ocultarPrecio` (rediseño R2, §4.4.3): `precioPactado` es, en la práctica, el precio REAL de
 * maquila de esa etapa — sin `ordenes.ver-precio-real-maquila` va null (el MISMO permiso que
 * redacta `maquilaOrd`/`aplicacionOrd` en la salida de la orden; antes bastaba
 * `produccion.wip-ver`, lo que socavaba el gateo de precios).
 */
function aEtapaSalida(
  etapa: EtapaConDetalle,
  nombres: ReadonlyMap<string, string>,
  ocultarPrecio = false,
): EtapaSalida {
  // Agrupa el detalle por COLOR × PACK (§Post-F9.10 — el renglón de la etapa es el tendido, no el
  // color), ordenando las tallas por su `orden` del catálogo. Agrupar sólo por color habría fundido
  // en un renglón dos tendidos con corridas distintas, que es justo lo que esta etapa vino a separar.
  const porRenglon = new Map<
    string,
    { idColor: number; color: string; pack: string; tallas: EtapaConDetalle['detalles'] }
  >();
  for (const det of etapa.detalles) {
    const pack = normalizarPack(det.pack);
    const clave = claveRenglon(det.idColor, pack);
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
  const lineas = [...porRenglon.values()].map((grupo) => {
    let totalLinea = 0;
    const tallas = grupo.tallas
      .slice()
      .sort((a, b) => a.talla.orden - b.talla.orden || a.idTalla - b.idTalla)
      .map((t) => {
        totalLinea += t.cantidad;
        return { idTalla: t.idTalla, etiquetaTalla: t.talla.etiqueta, cantidad: t.cantidad };
      });
    totalPiezas += totalLinea;
    return {
      idColor: grupo.idColor,
      color: grupo.color,
      pack: grupo.pack,
      tallas,
      totalPiezas: totalLinea,
    };
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
    creadoPorNombre: nombreDeUsuario(nombres, etapa.creadoPorId),
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

/**
 * ⭐ EL CARGO DE UN SERVICIO SOBRE LA ORDEN (0.114) — corte y empaque, en un solo lugar.
 *
 * Daniel puso los dos del lado de la maquila: *«corte es parte de maquilas, no de proveedores.
 * Tengo proveedores de corte que el monto a pagar sale de una orden, lo mismo que un maquilero. Y
 * una maquila de empaque también»*. Pero NO son maquila de ida y vuelta: no hay envío ni recibo, no
 * se mueve inventario, *«simplemente sucede y ya»*. Así que el cargo nace de la etapa MISMA (corte /
 * empaque), no de un recibo, y en vez de `idTipoProceso` lleva `servicio`.
 *
 * Es un calco deliberado de lo que hace `recibos.ts` al cerrar un recibo (mismo estado `propuesto`,
 * misma liga por `idEtapaRecibo`, misma cantidad DERIVADA de los detalles al proyectar el cargo, y
 * el mismo punto de control humano después): quien valida cargos ve una sola cola con las mismas
 * columnas, sin aprender un concepto nuevo.
 *
 * La CANTIDAD no se guarda aquí (se deriva de `EtapaMovimientoDet` en `esma/cargos.ts`, D3) y el
 * PRECIO propuesto sale del `precioPactado` de la etapa: la orden trae precios de MAQUILA
 * (`maquilaOrd`/`aplicacionOrd`) que no son los de estos servicios y no se les presta.
 *
 * Corre DENTRO de la transacción de la etapa (A2): si la etapa hace rollback, el cargo no existe.
 */
async function crearCargoDeServicio(
  tx: Tx,
  sesion: SesionUsuario,
  datos: {
    idEmpresa: number;
    idEtapa: number;
    idOrden: number;
    idTercero: number;
    servicio: ServicioOrden;
    totalPiezas: number;
  },
): Promise<void> {
  // Puerta de cantidad 0, igual que el recibo: un cargo de 0 piezas sólo llenaría la cola de
  // validación de renglones en $0. Hoy es inalcanzable —`aplanarYValidar` rechaza la captura sin
  // ninguna pieza— y se conserva como defensa en profundidad, no como caso vivo.
  if (datos.totalPiezas <= 0) {
    return;
  }
  await tx.esMaCargo.create({
    data: {
      idEmpresa: datos.idEmpresa,
      idEtapaRecibo: datos.idEtapa,
      idMaquilero: datos.idTercero,
      idOrden: datos.idOrden,
      // Excluyentes por CHECK (`esma_cargo_proceso_o_servicio`): servicio SÍ, proceso NO.
      idTipoProceso: null,
      servicio: datos.servicio,
      // cantidadReal/precioReal NULL mientras esté propuesto; lo propuesto se DERIVA de la etapa.
      estado: 'propuesto',
      ...datosCreacion(sesion),
    },
  });
}

/**
 * CANCELA el cargo EsMa de una etapa de SERVICIO (corte/empaque, 0.114) junto con la etapa, dentro
 * de su misma transacción (A2). Calco de `recibos.ts::cancelarReciboMaquila` (a):
 *  • busca el cargo VIVO (no cancelado) ligado a la etapa;
 *  • si ya está `validado`, exige `esma.cargo-validar` (A4) antes de tocarlo — es dinero
 *    comprometido, y sin el permiso se rechaza la cancelación ENTERA (una sola transacción);
 *  • lo pasa a `cancelado` (nunca lo borra, D3) y lo deja en la bitácora con su estado previo (A7).
 *
 * No-op si la etapa no tiene cargo: el corte de una orden capturada antes de 0.114 no lo tiene, y
 * cancelarlo tiene que seguir funcionando igual.
 */
async function cancelarCargoDeServicio(
  tx: Tx,
  sesion: SesionUsuario,
  idEtapa: number,
  motivo: string,
): Promise<void> {
  const cargo = await tx.esMaCargo.findFirst({
    where: { idEtapaRecibo: idEtapa, estado: { not: 'cancelado' } },
    select: { id: true, estado: true },
  });
  if (cargo === null) {
    return;
  }
  if (cargo.estado === 'validado') {
    // Permiso especial: cancelar una etapa cuyo cargo ya se validó (afecta el pago).
    verificarPermiso(sesion, 'esma.cargo-validar');
  }
  await tx.esMaCargo.update({
    where: { id: cargo.id },
    data: { estado: 'cancelado', ...datosModificacion(sesion) },
  });
  await registrarBitacora(tx, sesion, {
    entidad: 'EsMaCargo',
    idEntidad: cargo.id,
    accion: 'CANCELAR',
    datos: { motivo, idEtapa, estadoPrevio: cargo.estado },
  });
}

// ── Operaciones ───────────────────────────────────────────────────────────────────────────────

/** Alta de corte: campos del esquema compartido. */
export type EntradaRegistrarCorte = z.input<typeof esquemaCorteCrear>;
/** Alta de empaque: campos del esquema compartido (0.114). */
export type EntradaRegistrarEmpaque = z.input<typeof esquemaEmpaqueCrear>;
/** Alta de envío: campos del esquema compartido. */
export type EntradaRegistrarEnvio = z.input<typeof esquemaEnvioCrear>;

/**
 * Registra un CORTE de una orden (doc 03-Produccion Paso 3; D4). Crea
 * `EtapaMovimiento(tipo=corte, idTipoProceso=NULL, idTercero=cortador)` + `EtapaMovimientoDet`
 * color×talla en UNA transacción (A2), con folio atómico (A3) y bitácora (A7). Valida que el
 * cortador tenga el rol `corte` (D12/R15) y que cada color×talla pertenezca a la orden. Sobre-corte
 * LIBRE (decisión (f)): no bloquea por cortar más que lo pedido. Emite `corte-registrado`
 * post-commit (gancho RC F5).
 *
 * ⭐ 0.114 — EL CORTE SE PAGA. Daniel: *«en corte no necesitas mandar y recibir mercancía. Mando
 * tela y corta una cierta cantidad. Sólo hay que poner su cantidad y precio para meterlo en la OP,
 * pero no va y viene»*. Con eso el corte gana `precioPactado` y, en la MISMA transacción, su CARGO
 * EsMa `propuesto` con `servicio: 'corte'` ({@link crearCargoDeServicio}) — para que el cortador se
 * pueda pagar desde la orden como un maquilero, sin envío ni recibo de por medio. El corte SIGUE sin
 * tocar el kardex: nace la cantidad, no entra ni sale mercancía.
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
    const totalPiezas = celdas.reduce((s, c) => s + c.cantidad, 0);
    const etapa = await tx.etapaMovimiento.create({
      data: {
        folio,
        idEmpresa: orden.idEmpresa,
        idOrden: datos.idOrden,
        tipo: TipoEtapaMovimiento.corte,
        idTercero: datos.idCortador,
        fecha: aDateColumna(datos.fecha),
        // 0.114: el precio por prenda pactado con el cortador. Es la base del cargo EsMa del corte
        // (`esma/cargos.ts` lo lee como precio propuesto). `null` explícito si no se capturó.
        precioPactado: datos.precioPactado ?? null,
        ...(datos.observaciones === undefined ? {} : { observaciones: datos.observaciones }),
        detalles: {
          create: celdas.map((c) => ({
            idColor: c.idColor,
            idTalla: c.idTalla,
            // El pack VIAJA con la pieza (§Post-F9.10): cadena vacía en las órdenes sin packs.
            pack: c.pack,
            cantidad: c.cantidad,
          })),
        },
        ...datosCreacion(sesion),
      },
    });

    // 0.114: el CARGO del cortador, en la misma tx que el corte (A2).
    await crearCargoDeServicio(tx, sesion, {
      idEmpresa: orden.idEmpresa,
      idEtapa: etapa.id,
      idOrden: datos.idOrden,
      idTercero: datos.idCortador,
      servicio: ServicioOrden.corte,
      totalPiezas,
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
        totalPiezas,
        // A7: el precio pactado es DINERO (nace un cargo con él) y por eso queda en la bitácora,
        // igual que en el envío a maquila.
        precioPactado: datos.precioPactado ?? null,
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

  // Quien captura ve SU captura completa, precio incluido (desde 0.114 el corte SÍ lleva precio):
  // acaba de teclearlo, y redactárselo en la respuesta sería esconderle lo que él mismo escribió.
  const salida = await obtenerEtapa(sesion, idEtapa, bd, { ocultarPrecio: false });
  dispararPublicacion(); // publica la fila del outbox tras el commit (best-effort; el barrido recupera).
  return salida;
}

/**
 * ⭐ Registra un EMPAQUE de una orden (0.114) — el hermano del corte, y por las mismas razones.
 *
 * Daniel: *«lo mismo el empaque… el empaque no toca el inventario»* y *«una maquila de empaque
 * también»* (o sea: se paga contra la orden, como un maquilero). De ahí sale todo el diseño:
 *
 *  • `EtapaMovimiento(tipo=empaque, idTipoProceso=NULL, idTercero=empacador)` + su matriz
 *    color×talla (D4), en UNA transacción (A2), con folio atómico (A3) y bitácora (A7);
 *  • **NO toca el kardex**: no hay entrada ni salida de existencia. Empacar no mueve mercancía de
 *    almacén, sólo la prepara;
 *  • **NO hay envío ni recibo**: por eso NO es un `TipoProceso` (convertirlo en uno lo metería al
 *    flujo de ida y vuelta que Daniel dice que no es);
 *  • **la cantidad es PROPIA y NO SE TOPA** contra lo recibido ni contra lo cortado. Es la regla de
 *    C&A que dictó Daniel: se fabrican 1,000 y se empacan 990 — se paga lo empacado y las 10
 *    restantes se quedan quietas en inventario. Mismo criterio que el sobre-corte LIBRE (decisión
 *    (f)): la pantalla puede AVISAR que excede lo recibido, el servidor acepta;
 *  • genera su CARGO EsMa `propuesto` con `servicio: 'empaque'` ({@link crearCargoDeServicio}).
 *
 * Valida que el empacador tenga el rol `empaque` (D12/R15) y que cada color×talla pertenezca a la
 * orden. Permiso propio `produccion.empaque` (A4).
 *
 * 🔴 POR QUÉ NO EMITE EVENTO A LA RUTA CRÍTICA (medido, no olvidado). La RC **sí** tiene un proceso
 * `empaque` (`TipoEventoProceso.empaque`), pero **ya tiene dueño**: lo completa el HITO de orden de
 * tipo `empaque` (`ruta-critica/hitosOrden.ts` → `hito-orden-resuelto` → `reevaluarHito`). Los dos
 * caminos miden cosas distintas: el hito pregunta *«¿hay un hito vivo?»* y esta etapa mediría
 * *«¿se cubrió toda la matriz color×talla?»*. Engancharla al MISMO renglón pondría dos escritores
 * con reglas distintas sobre el mismo `RutaOrdenRenglon`, y un empaque PARCIAL —990 de 1,000, que
 * es justo el caso que Daniel describió— **des-completaría** un hito que alguien ya registró. Se
 * deja fuera a propósito: un evento que rompe algo que hoy funciona es peor que ninguno. Si Daniel
 * quiere que el empaque capturado cierre solo su proceso de RC, la decisión que falta es cuál de los
 * dos manda (y con qué regla de completitud), y eso es una etapa aparte.
 */
export async function registrarEmpaque(
  sesion: SesionUsuario,
  entrada: EntradaRegistrarEmpaque,
  bd?: ContextoBd,
): Promise<EtapaSalida> {
  verificarPermiso(sesion, 'produccion.empaque');
  const datos = validarEntrada(esquemaEmpaqueCrear, entrada);

  const idEtapa = await enTransaccion(async (tx) => {
    const orden = await resolverOrden(tx, datos.idOrden, sesion.idEmpresaActiva);
    const celdas = aplanarYValidar(datos.lineas, orden);
    await exigirTerceroConRol(tx, datos.idEmpacador, ROL_EMPACADOR, 'Empaque');

    // Sin tope: la cantidad del empaque es propia (ver el TSDoc). No se compara contra lo recibido
    // ni contra lo cortado, y por eso tampoco hace falta bloquear las etapas de la orden.

    const folio = await siguienteFolio(tx, orden.idEmpresa, CLAVE_SECUENCIA_ETAPA);
    const totalPiezas = celdas.reduce((s, c) => s + c.cantidad, 0);
    const etapa = await tx.etapaMovimiento.create({
      data: {
        folio,
        idEmpresa: orden.idEmpresa,
        idOrden: datos.idOrden,
        tipo: TipoEtapaMovimiento.empaque,
        idTercero: datos.idEmpacador,
        fecha: aDateColumna(datos.fecha),
        precioPactado: datos.precioPactado ?? null,
        ...(datos.observaciones === undefined ? {} : { observaciones: datos.observaciones }),
        detalles: {
          create: celdas.map((c) => ({
            idColor: c.idColor,
            idTalla: c.idTalla,
            pack: c.pack,
            cantidad: c.cantidad,
          })),
        },
        ...datosCreacion(sesion),
      },
    });

    await crearCargoDeServicio(tx, sesion, {
      idEmpresa: orden.idEmpresa,
      idEtapa: etapa.id,
      idOrden: datos.idOrden,
      idTercero: datos.idEmpacador,
      servicio: ServicioOrden.empaque,
      totalPiezas,
    });

    await registrarBitacora(tx, sesion, {
      entidad: 'EtapaMovimiento',
      idEntidad: etapa.id,
      accion: 'CREAR',
      datos: {
        tipo: 'empaque',
        folio: Number(folio),
        idOrden: datos.idOrden,
        idEmpacador: datos.idEmpacador,
        celdas: celdas.length,
        totalPiezas,
        precioPactado: datos.precioPactado ?? null,
      },
    });

    return etapa.id;
  }, bd);

  // Sin `dispararPublicacion()`: esta etapa NO escribe en el outbox (ver el TSDoc de arriba).
  return obtenerEtapa(sesion, idEtapa, bd, { ocultarPrecio: false });
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
      // Fila 0.137, segunda pasada: este sitio YA exigía el tipo PT, pero a mano y con una SEGUNDA
      // lectura del mismo renglón que la validación de almacén acababa de leer. Se colapsa en la
      // guarda única del dominio, que hace las cuatro comprobaciones (existe → activo → de la
      // empresa → del tipo) en UNA consulta. Sigue siendo PT porque esta rama solo corre cuando lo
      // que se manda son PRENDAS YA TERMINADAS: el envío las saca del kardex de PT al tránsito.
      await exigirAlmacenDelTipo(tx, datos.idAlmacenOrigen, 'PT', orden.idEmpresa);
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
      // La llave lleva el PACK: cada tendido tiene su propio saldo de cortado (§Post-F9.10). Sin
      // packs es la celda de siempre.
      const clave = claveCeldaPack(c.idColor, c.idTalla, c.pack);
      const cortadoCelda = cortado.get(clave) ?? 0;
      const enviadoCelda = yaEnviado.get(clave) ?? 0;
      const disponible = cortadoCelda - enviadoCelda;
      const topeConHolgura = Math.floor(disponible * (1 + TOLERANCIA_SOBRE_ENVIO));
      if (c.cantidad > topeConHolgura) {
        throw new ErrorConflicto(
          `No se puede enviar ${c.cantidad} pza(s) de ese color/talla` +
            `${esSinPack(c.pack) ? '' : ` del pack "${c.pack}"`} a "${proceso.nombre}": ` +
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
            // El pack VIAJA con la pieza (§Post-F9.10): cadena vacía en las órdenes sin packs.
            pack: c.pack,
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
        // ⭐ EL PACK SE PLIEGA AQUÍ (§Post-F9.10): el inventario de PT no maneja packs —*«ahí ya es
        // sólo color»*—, así que dos tendidos de la MISMA celda (pack A: 5 CH, pack B: 3 CH) salen
        // al tránsito como UN renglón de 8. Sin plegar, el traspaso llevaría dos renglones de la
        // misma llave: el mismo saldo, pero el movimiento partido en dos y el lock del artículo
        // tomado dos veces. El tendido sigue vivo donde importa: en la celda del WIP.
        celdas: plegarCeldasSinPack(celdas),
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
 * CANCELA (suave) una etapa de corte, envío o empaque: setea `canceladoEn`/`canceladoPorId`/
 * `motivoCancelacion` + bitácora `CANCELAR` (A7). La etapa NUNCA se borra ni se edita. Reglas:
 *  • solo etapas de la EMPRESA ACTIVA (A9);
 *  • no se puede re-cancelar una etapa ya cancelada;
 *  • no se puede cancelar un CORTE que tenga ENVÍOS VIVOS (no cancelados): primero se cancelan los
 *    envíos (si no, los pendientes quedarían incoherentes — enviar sin cortado);
 *  • espejo del anterior: no se puede cancelar un ENVÍO que tenga RECIBOS VIVOS de su orden+proceso
 *    (si no, quedaría recibido sin envío que lo sostenga — `recibido ≤ enviado` se rompe);
 *  • el EMPAQUE no tiene guard de dependencias: nada cuelga de él (no hay recibo de empaque, no
 *    mueve inventario y su cantidad es propia). Se cancela solo.
 *
 * ⭐ 0.114 — Y ARRASTRA SU CARGO. Desde que el corte y el empaque generan un `EsMaCargo`
 * ({@link crearCargoDeServicio}), cancelarlos sin tocar el cargo dejaría al cortador cobrando un
 * corte que ya no existe. Se aplica EXACTAMENTE la misma regla que el recibo de maquila
 * (`recibos.ts::cancelarReciboMaquila`, deliberadamente calcada para que quien opera no tenga que
 * aprender dos comportamientos):
 *  • cargo `propuesto` → se cancela junto con la etapa, en la misma transacción, con bitácora (A7);
 *  • cargo `validado` → exige el permiso especial `esma.cargo-validar` (A4) antes de cancelarlo:
 *    ese cargo ya es un compromiso de pago, así que deshacerlo es una decisión de quien valida
 *    cargos, no de quien captura producción. Sin el permiso, la cancelación se rechaza entera (el
 *    corte tampoco se cancela: es una sola transacción).
 *
 * ⚠️ El cargo se busca por `idEtapaRecibo` —que en corte/empaque apunta a ESTA etapa— y sólo entre
 * los NO cancelados, para que re-cancelar no tropiece con el cargo que ya se canceló antes.
 *
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
        // El TERCERO del envío: desde V1 (fila 0.109) hace falta para ver si ese maquilero ya tiene
        // un CIERRE vivo de esta orden+proceso (ver el guard de abajo).
        idTercero: true,
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
    // ⭐ 0.061: cancelar una etapa MUEVE las cantidades de la orden (y con ellas su costo). Sobre
    // una orden CERRADA hay que reabrirla primero — el acto inverso auditado, no una edición.
    await exigirOrdenAbiertaPorId(tx, etapa.idOrden, 'pueden cancelar sus etapas');
    // Esta operación cancela corte, envío y EMPAQUE (0.114); recibo/entrega (con efectos de kardex)
    // los cancela su propio módulo (E4/E5), que además revierte el inventario.
    if (
      etapa.tipo !== TipoEtapaMovimiento.corte &&
      etapa.tipo !== TipoEtapaMovimiento.envio_maquila &&
      etapa.tipo !== TipoEtapaMovimiento.empaque
    ) {
      throw new ErrorValidacion(
        'Esta operación solo cancela cortes, envíos y empaques; los recibos y entregas se cancelan ' +
          'en su módulo.',
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

      // ⭐⭐ V1 (fila 0.109) — EL ENVÍO TAMBIÉN SOSTIENE LOS CIERRES, y el guard de arriba no los ve
      // porque un cierre NO es un recibo: es el acto que da por perdidas las piezas que el maquilero
      // nunca devolvió. El camino que esto cierra existe y no es raro: se le envían 100, no devuelve
      // nada (⇒ CERO recibos vivos, el guard de arriba pasa), se cierra la orden cobrándole las 100…
      // y entonces se cancela el envío. Quedaría `enviado = 0` con `saldado = 100`, o sea pendiente
      // −100 en las CINCO puertas que derivan el pendiente, la orden de vuelta en ABIERTA, `kpi_wip`
      // en negativo — y un `DescuentoMaquilero` cobrándole prendas de un envío que ya no existe.
      // Es la «lección de la décima puerta» (§Post-F9.147) aplicada al lado que ESCRIBE: quien borra
      // el minuendo tiene que mirar TODOS los sustraendos, no sólo el que conocía.
      const cierresVivos = await tx.cierreMaquilaOrden.count({
        where: {
          idOrden: etapa.idOrden,
          // El envío SIEMPRE trae proceso y tercero (lo exige `registrarEnvioMaquila`), pero el
          // esquema los deja nullable porque el corte y la entrega no los llevan: si faltaran, se
          // acota sólo por orden — MÁS conservador, nunca menos.
          ...(etapa.idTipoProceso === null ? {} : { idTipoProceso: etapa.idTipoProceso }),
          ...(etapa.idTercero === null ? {} : { idMaquilero: etapa.idTercero }),
          deshechoEn: null,
        },
      });
      if (cierresVivos > 0) {
        throw new ErrorConflicto(
          'No se puede cancelar el envío a maquila: la orden ya se CERRÓ con ese maquilero en este ' +
            'proceso (sus faltantes están saldados, y puede haber un descuento propuesto). Deshaz ' +
            'el cierre primero.',
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

    // ⭐ 0.114 — EL CARGO DEL SERVICIO se va con la etapa (ver el TSDoc). Sólo aplica al corte y al
    // empaque: el envío a maquila nunca generó cargo (el suyo nace en el RECIBO).
    if (etapa.tipo === TipoEtapaMovimiento.corte || etapa.tipo === TipoEtapaMovimiento.empaque) {
      await cancelarCargoDeServicio(tx, sesion, idEtapa, datos.motivo);
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
    //
    // El EMPAQUE se queda fuera a propósito (0.114): su alta tampoco emite, porque el proceso RC
    // `empaque` ya lo gobierna el HITO de orden y meterle un segundo escritor lo rompería (el porqué
    // completo está en el TSDoc de {@link registrarEmpaque}). Publicar aquí un evento que el
    // consumidor ignora sería ruido con apariencia de contrato.
    if (etapa.tipo !== TipoEtapaMovimiento.empaque) {
      await registrarEventoEtapaRc(tx, EVENTOS_OUTBOX.etapaCancelada, {
        idEmpresa: sesion.idEmpresaActiva,
        idOrden: etapa.idOrden,
        idEtapaMovimiento: etapa.id,
        tipoEtapa: etapa.tipo,
        idTipoProceso: etapa.idTipoProceso,
      });
    }
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
  const nombres = await nombresDeUsuarios(cliente, [etapa.creadoPorId]);
  const ocultarPrecio =
    opciones.ocultarPrecio ?? !tienePermiso(sesion, 'ordenes.ver-precio-real-maquila');
  return aEtapaSalida(etapa, nombres, ocultarPrecio);
}

/**
 * HISTORIAL de etapas (cortes, envíos y empaques) de una orden de la empresa activa (A9): vivas y CANCELADAS
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
    // 0.114: el EMPAQUE viaja SIEMPRE en el historial (no cuelga de `incluirRecibos`, que existe
    // para no cambiarle la respuesta a las pantallas viejas de recibos). Es una etapa nueva: nadie
    // la esperaba ausente, y el panel de avance la necesita para pintar su lista y poder cancelarla.
    TipoEtapaMovimiento.empaque,
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

  const nombres = await nombresDeUsuarios(
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
          pack: true,
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
    /** Pack / tendido de la celda (§Post-F9.10); cadena vacía en las órdenes sin packs. */
    pack: string;
    idTalla: number;
    etiquetaTalla: string;
    ordenTalla: number;
  }
  const meta = new Map<string, MetaCelda>();
  const pedido = new Map<string, number>();
  for (const linea of orden.lineas) {
    // La llave lleva el PACK (§Post-F9.10): dos tendidos del mismo color son DOS celdas distintas,
    // con su propio pendiente. Plegarlos aquí haría que la pantalla ofreciera un tope agregado que
    // el servidor rechaza tendido por tendido al enviar (sobre-envío ESTRICTO, decisión (g)).
    const pack = normalizarPack(linea.pack);
    for (const t of linea.tallas) {
      const clave = claveCeldaPack(linea.idColor, t.idTalla, pack);
      pedido.set(clave, (pedido.get(clave) ?? 0) + t.cantidad);
      if (!meta.has(clave)) {
        meta.set(clave, {
          idColor: linea.idColor,
          color: linea.color.nombre,
          pack,
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

  // El PACK entra en el orden justo detrás del color: los tendidos de un mismo color salen juntos y
  // en orden estable (§Post-F9.10). Sin packs, todos comparten la cadena vacía y el orden no cambia.
  const ordenarCeldas = <
    T extends { ordenTalla: number; idColor: number; idTalla: number; pack: string },
  >(
    arr: T[],
  ): T[] =>
    arr.sort(
      (a, b) =>
        a.idColor - b.idColor ||
        a.pack.localeCompare(b.pack, 'es') ||
        a.ordenTalla - b.ordenTalla ||
        a.idTalla - b.idTalla,
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
          pack: true,
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
  const meta = new Map<string, MetaCeldaPendiente>();
  const pedido = new Map<string, number>();
  for (const linea of orden.lineas) {
    // La llave lleva el PACK (§Post-F9.10): dos tendidos del mismo color son DOS celdas distintas,
    // con su propio pendiente. Plegarlos aquí haría que la pantalla ofreciera un tope agregado que
    // el servidor rechaza tendido por tendido al enviar (sobre-envío ESTRICTO, decisión (g)).
    const pack = normalizarPack(linea.pack);
    for (const t of linea.tallas) {
      const clave = claveCeldaPack(linea.idColor, t.idTalla, pack);
      pedido.set(clave, (pedido.get(clave) ?? 0) + t.cantidad);
      if (!meta.has(clave)) {
        meta.set(clave, {
          idColor: linea.idColor,
          color: linea.color.nombre,
          pack,
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
    .sort(
      (a, b) =>
        a.idColor - b.idColor ||
        a.pack.localeCompare(b.pack, 'es') ||
        a.ordenTalla - b.ordenTalla ||
        a.idTalla - b.idTalla,
    )
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

/**
 * Metadato de presentación de una celda color×talla×PACK de los pendientes/sugerencias.
 *
 * 🔗 Es el MISMO tipo (y el mismo respaldo defensivo, {@link metaPara}) que usa el drill-down del
 * WIP: vive UNA sola vez, en `produccion/wip.ts`. Aquí había una copia privada palabra por palabra
 * —salvo una rama— y se retiró: dos versiones del respaldo de la misma llave `color:talla:pack` son
 * exactamente la clase de gemela que se desincroniza sin que nadie lo note.
 */
type MetaCeldaPendiente = MetaCelda;

/**
 * Variante de {@link sumarCeldas} para un cliente de LECTURA (sin transacción), para las consultas.
 * Misma llave color×talla×PACK que la transaccional, a propósito: si la lectura plegara el pack y la
 * escritura no, la pantalla ofrecería un tope que el servidor rechaza.
 */
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
    select: { idColor: true, idTalla: true, pack: true, cantidad: true },
  });
  const acumulado = new Map<string, number>();
  for (const f of filas) {
    const clave = claveCeldaPack(f.idColor, f.idTalla, f.pack);
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
