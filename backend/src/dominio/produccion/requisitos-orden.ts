/**
 * REQUISITOS de una orden de producción → estado `completa` AUTOMÁTICO (Daniel, 26-jul-2026).
 *
 * Daniel: *"El estado de la orden (completa, incompleta) no sé en base a qué existe. En CONTROL
 * viejo existía, pero está en desuso. Acá podríamos definirla como completa cuando ya tenga los
 * avíos, los artes. De manera automática se pone como completa."*
 *
 * REGLA ELEGIDA por él — **"tallas + avíos, y arte si aplica"**:
 *  • `tallas` — la orden tiene su matriz capturada (≥1 renglón color×talla).
 *  • `avios`  — el MODELO de la orden tiene su receta de avíos de producción (≥1 `ModeloAvio`
 *               con `paraProduccion`). Es la MISMA fuente que usa la habilitación
 *               (`habilitacion-orden.ts`) y el MRP: sin receta no hay qué surtir.
 *  • `arte`   — se exige cuando el modelo LLEVA arte (`Modelo.llevaArte`); las prendas lisas se
 *               completan normal (el propio impreso de Daniel dice "NO LLEVA BORDADO/ESTAMPADO").
 *
 * EL ARTE, cerrado por Daniel el 26-jul-2026 (textual): *"por default sí lleva. A menos que la
 * marques como que no lleva. Y de esa manera si no meten la información del arte, o no desmarcan
 * la casilla, está como incompleto. Es decir, siempre hay que atender ese tema"*. Por eso existe la
 * bandera `Modelo.llevaArte` (default `true`, también para los modelos migrados) y el requisito
 * queda SIN ambigüedad:
 *    – `llevaArte = false`                  → `arte: 'no-aplica'` (prenda lisa: no estorba)
 *    – `llevaArte = true` con ≥1 arte en BOM→ `arte: true`        (requisito cumplido)
 *    – `llevaArte = true` sin arte en el BOM→ `arte: false`       (**FALTA**: bloquea el completa)
 * Consecuencia intencional del default: muchas órdenes vivas quedan INCOMPLETAS hasta que se
 * capture su arte o se desmarque la casilla. Eso es exactamente lo que Daniel pidió. Y por eso el
 * estado es INFORMATIVO: ninguna pantalla de captura (corte, envío, recibo, entrega, salida de
 * tela, nota de tela, auditoría) filtra ni bloquea por él — lo único que impide operar es
 * `cancelada`.
 *
 * La función `requisitosOrden` es PURA (sin BD): es la ÚNICA fuente de la regla — la usan el alta,
 * el guardado/copiado de matriz y el recálculo por cambio del BOM del modelo. No hay una segunda
 * copia de la regla en ningún lado.
 *
 * Al final del archivo viven los helpers que APLICAN la regla en la BD (`recalcularEstadoOrden` y
 * `recalcularEstadoOrdenesDeModelo`), siempre dentro de la transacción del llamador (A2).
 */
import type { EstadoOrden } from '../../datos/index.js';

import { datosModificacion, registrarBitacoraLote } from '../../comun/auditoria.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import type { Tx } from '../../comun/transaccion.js';

/** Cada requisito que se evalúa para completar una orden. */
export type ClaveRequisitoOrden = 'tallas' | 'avios' | 'arte';

/** Etiqueta en lenguaje de negocio de cada requisito (la usa la UI y los mensajes). */
export const ETIQUETA_REQUISITO_ORDEN: Record<ClaveRequisitoOrden, string> = {
  tallas: 'tallas',
  avios: 'avíos',
  arte: 'arte',
};

/** Insumos MÍNIMOS para evaluar la regla (conteos; nada de entidades de Prisma). */
export interface InsumosRequisitosOrden {
  /** Renglones de la matriz (colores) capturados en la orden. */
  renglonesMatriz: number;
  /** Avíos `paraProduccion` en el BOM del modelo de la orden. */
  aviosProduccion: number;
  /** Artes (bordados/estampados) en el BOM del modelo de la orden. */
  artesModelo: number;
  /** ¿El MODELO lleva arte? (`Modelo.llevaArte`, default `true`). `false` = prenda lisa. */
  llevaArte: boolean;
}

/** Resultado de evaluar la regla. `arte: 'no-aplica'` = el modelo no lleva arte (no bloquea). */
export interface RequisitosOrden {
  tallas: boolean;
  avios: boolean;
  arte: 'no-aplica' | boolean;
  /** true = se cumplen TODOS los requisitos que aplican → la orden es `completa`. */
  completa: boolean;
  /** Los requisitos que HOY faltan (vacío si está completa). Para el "Falta: …" de la UI. */
  faltantes: ClaveRequisitoOrden[];
}

/**
 * Evalúa la regla de "orden completa". PURA: mismos insumos, mismo resultado.
 * NO conoce el estado `cancelada` — esa decisión es del llamador (`cancelada` siempre gana).
 */
export function requisitosOrden(insumos: InsumosRequisitosOrden): RequisitosOrden {
  const tallas = insumos.renglonesMatriz > 0;
  const avios = insumos.aviosProduccion > 0;
  const arte = evaluarArte(insumos.llevaArte, insumos.artesModelo);

  const faltantes: ClaveRequisitoOrden[] = [];
  if (!tallas) faltantes.push('tallas');
  if (!avios) faltantes.push('avios');
  if (arte === false) faltantes.push('arte');

  return { tallas, avios, arte, completa: faltantes.length === 0, faltantes };
}

/**
 * Requisito del ARTE (decisión de Daniel, ver cabecera). La bandera del MODELO manda: si la prenda
 * no lleva arte, el requisito no aplica; si lo lleva, se cumple SOLO con el arte capturado en el
 * BOM — y si falta, el arte sale `false` y la orden queda incompleta hasta que alguien lo atienda
 * (capturar el arte o desmarcar la casilla).
 */
function evaluarArte(llevaArte: boolean, artesModelo: number): 'no-aplica' | boolean {
  if (!llevaArte) return 'no-aplica';
  return artesModelo > 0;
}

/**
 * Texto corto de "qué le falta" en lenguaje de negocio (p. ej. `Falta: avíos`), o `null` si no
 * falta nada. Vive aquí (con la regla) para que la UI y los mensajes del backend digan lo mismo.
 */
export function textoFaltantesOrden(requisitos: RequisitosOrden): string | null {
  if (requisitos.faltantes.length === 0) return null;
  const etiquetas = requisitos.faltantes.map((f) => ETIQUETA_REQUISITO_ORDEN[f]);
  // "tallas", "tallas y avíos", "tallas, avíos y arte" (coma hasta el penúltimo, "y" al final).
  const ultima = etiquetas.pop() as string;
  return `Falta: ${etiquetas.length === 0 ? ultima : `${etiquetas.join(', ')} y ${ultima}`}`;
}

// ── Aplicación del estado en la BD (misma transacción del llamador, A2) ─────────────

/**
 * Lee los insumos de la regla de la BD para UNA orden ya conocida (su matriz y el BOM de su
 * modelo). Se resuelve con dos conteos (`count`), sin traer entidades.
 */
export async function insumosRequisitosDeOrden(
  tx: Tx,
  orden: { id: number; idModelo: number },
): Promise<InsumosRequisitosOrden> {
  const [renglonesMatriz, aviosProduccion, artesModelo, modelo] = await Promise.all([
    tx.ordenLinea.count({ where: { idOrden: orden.id } }),
    tx.modeloAvio.count({ where: { idModelo: orden.idModelo, paraProduccion: true } }),
    tx.modeloBordado.count({ where: { idModelo: orden.idModelo } }),
    tx.modelo.findUnique({ where: { id: orden.idModelo }, select: { llevaArte: true } }),
  ]);
  // Si el modelo no apareciera (imposible: la FK lo garantiza), se asume lo que pidió Daniel —
  // "por default sí lleva" — que es el lado que HACE ATENDER el tema, no el que lo esconde.
  return { renglonesMatriz, aviosProduccion, artesModelo, llevaArte: modelo?.llevaArte ?? true };
}

/**
 * Traduce los requisitos al par (`estado`, `fechaCompletada`) que debe quedar guardado, a partir
 * de lo que la orden tiene HOY. Puro (no toca BD) para poder probarlo sin Postgres.
 *
 *  • `cancelada` SIEMPRE gana: una orden cancelada no cambia de estado por esta regla.
 *  • El `estado` refleja la VERDAD ACTUAL: si deja de cumplir requisitos (le borran la matriz, le
 *    quitan los avíos al modelo) vuelve a `capturada`. No es un sello de una sola vía.
 *  • `fechaCompletada` sella la PRIMERA vez que se cumple y NUNCA se borra (es el `FechaDet` de
 *    v1: el dato histórico de "cuándo quedó lista por primera vez").
 *  • Devuelve `null` cuando no hay nada que escribir (evita UPDATEs vacíos).
 */
export function cambiosEstadoPorRequisitos(
  actual: { estado: EstadoOrden; fechaCompletada: Date | null },
  requisitos: RequisitosOrden,
  ahora: Date = new Date(),
): { estado?: EstadoOrden; fechaCompletada?: Date } | null {
  if (actual.estado === 'cancelada') return null;

  const estado: EstadoOrden = requisitos.completa ? 'completa' : 'capturada';
  const sellaFecha = requisitos.completa && actual.fechaCompletada === null;

  if (estado === actual.estado && !sellaFecha) return null;
  return {
    ...(estado === actual.estado ? {} : { estado }),
    ...(sellaFecha ? { fechaCompletada: ahora } : {}),
  };
}

/**
 * ¿La orden YA TIENE ACTIVIDAD DE PRODUCCIÓN? (≥1 `EtapaMovimiento` viva: corte o envío a maquila).
 * Es el cinturón de seguridad del des-completar: una orden que ya se está produciendo NO puede
 * degradarse a `capturada` por un cambio de catálogo — degradarla la sacaría de los tableros y
 * confundiría al piso. Los movimientos CANCELADOS no cuentan (esa actividad se deshizo).
 */
async function tieneActividadProduccion(tx: Tx, idOrden: number): Promise<boolean> {
  const vivos = await tx.etapaMovimiento.count({ where: { idOrden, canceladoEn: null } });
  return vivos > 0;
}

/**
 * RECALCULA y GUARDA el estado de UNA orden dentro de la transacción del llamador (A2: el estado
 * y el cambio que lo provocó viajan juntos, o no viaja ninguno). Devuelve los requisitos
 * evaluados. `cancelada` no se toca.
 *
 * DES-COMPLETAR (26-jul-2026, tras revisión): que el estado "diga la verdad" no puede costarle a la
 * operación una orden en curso. Una orden solo puede volver de `completa` a `capturada` si se
 * cumplen LAS DOS condiciones:
 *   1. el recálculo lo dispara la edición de la MATRIZ DE ESA ORDEN (`permitirDesCompletar`, que
 *      los recálculos por cambio de catálogo pasan en `false`), y
 *   2. la orden NO tiene actividad de producción viva (ver {@link tieneActividadProduccion}).
 * Si no se cumplen, el `completa` se CONSERVA (nunca se degrada en silencio a media producción).
 * Completar, en cambio, siempre se permite: es un ascenso, no le quita nada a nadie.
 *
 * `tocarAuditoria` (default `true`): sella `modificadoPor/En` aunque el estado no cambie — es lo
 * correcto cuando el recálculo acompaña a una edición de ESA orden (A7). Con `false` no se escribe
 * si no hubo cambio real (alta de la orden, o efectos colaterales).
 */
export async function recalcularEstadoOrden(
  tx: Tx,
  sesion: SesionUsuario,
  orden: { id: number; idModelo: number; estado: EstadoOrden; fechaCompletada: Date | null },
  opciones: { tocarAuditoria?: boolean; permitirDesCompletar?: boolean } = {},
): Promise<RequisitosOrden> {
  const requisitos = requisitosOrden(await insumosRequisitosDeOrden(tx, orden));
  let cambios = cambiosEstadoPorRequisitos(orden, requisitos);

  if (cambios?.estado === 'capturada') {
    const bloqueado =
      opciones.permitirDesCompletar === false || (await tieneActividadProduccion(tx, orden.id));
    // Se descarta SOLO la degradación; si venía acompañada de algo más (hoy no puede), se conserva.
    if (bloqueado) {
      const { estado: _degradacion, ...resto } = cambios;
      cambios = Object.keys(resto).length === 0 ? null : resto;
    }
  }

  if (cambios !== null || opciones.tocarAuditoria !== false) {
    await tx.orden.update({
      where: { id: orden.id },
      data: { ...(cambios ?? {}), ...datosModificacion(sesion) },
    });
  }
  return requisitos;
}

/** Tamaño de lote de las escrituras del recálculo por catálogo (nunca una lista sin cota). */
const LOTE_RECALCULO = 500;

/**
 * Qué disparó el recálculo por catálogo. Va TAL CUAL a la bitácora de cada orden, así que tiene que
 * nombrar la causa REAL: `bom-modelo` (se editó la receta de avíos/arte) o `lleva-arte` (se marcó o
 * desmarcó la casilla del modelo).
 */
export type MotivoRecalculoModelo = 'bom-modelo' | 'lleva-arte';

/**
 * RECÁLCULO por cambio del BOM del modelo (avíos o arte). **SOLO COMPLETA: nunca des-completa**
 * (26-jul-2026, tras revisión). Editar la receta de un modelo es una operación cotidiana de
 * catálogo y no puede degradar de golpe su histórico —órdenes entregadas hace años— ni sacar de los
 * tableros a las que están a medio producir. El "des-completar" vive únicamente en la edición de la
 * MATRIZ de una orden concreta, y con el cinturón de la actividad de producción (ver
 * {@link recalcularEstadoOrden}).
 *
 * Cómo decide, sin duplicar la regla: se le pregunta a la función PURA qué pasaría con una orden de
 * este modelo **que ya tuviera su matriz** (`renglonesMatriz: 1`). Si ni así se completa (p. ej. el
 * modelo se quedó sin receta de avíos), NO HAY NADA QUE HACER y se sale sin tocar la base. Si sí, el
 * único requisito que falta por verificar orden-por-orden es la matriz, y eso se resuelve en la
 * consulta (`lineas: { some: {} }`) en vez de traer ids a memoria.
 *
 * Universo acotado: SOLO las `capturada` de ESE modelo con matriz (las `completa` ya lo están y las
 * `cancelada` no se tocan). Escribe en LOTES de {@link LOTE_RECALCULO} para no armar un `IN (...)`
 * gigante dentro de la transacción, y deja **bitácora POR ORDEN** (A7: la orden es entidad crítica;
 * no basta la del modelo).
 *
 * A9: NO se filtra por empresa a propósito. Los modelos y su BOM son catálogo GLOBAL (ADR-0007), así
 * que la receta nueva vuelve completables a las órdenes de cualquier empresa; filtrar por la activa
 * dejaría a las demás mintiendo. No se devuelve ni un dato de otra empresa: solo se sincroniza un
 * estado derivado con la verdad.
 *
 * `motivo` viaja a la bitácora de cada orden para que el rastro nombre la causa REAL del cambio
 * (editar la receta vs. desmarcar "lleva arte").
 *
 * Devuelve cuántas órdenes se completaron (para diagnóstico).
 */
export async function recalcularEstadoOrdenesDeModelo(
  tx: Tx,
  sesion: SesionUsuario,
  idModelo: number,
  motivo: MotivoRecalculoModelo = 'bom-modelo',
): Promise<number> {
  // Los insumos del MODELO son los MISMOS para todas sus órdenes: se leen UNA vez (nada de N+1).
  const [aviosProduccion, artesModelo, modelo] = await Promise.all([
    tx.modeloAvio.count({ where: { idModelo, paraProduccion: true } }),
    tx.modeloBordado.count({ where: { idModelo } }),
    tx.modelo.findUnique({ where: { id: idModelo }, select: { llevaArte: true } }),
  ]);

  // ¿Podría completarse una orden de este modelo que YA tenga su matriz? La respuesta la da la
  // regla PURA (única fuente); aquí no se re-implementa nada.
  const podria = requisitosOrden({
    renglonesMatriz: 1,
    aviosProduccion,
    artesModelo,
    llevaArte: modelo?.llevaArte ?? true,
  });
  if (!podria.completa) {
    return 0;
  }

  const candidatas = await tx.orden.findMany({
    where: { idModelo, estado: 'capturada', lineas: { some: {} } },
    select: { id: true, fechaCompletada: true },
    orderBy: { id: 'asc' },
  });
  if (candidatas.length === 0) return 0;

  const ahora = new Date();
  const auditoria = datosModificacion(sesion);
  // Dos grupos: las que además SELLAN `fechaCompletada` (primera vez) y las que ya la traen.
  const sellando = candidatas.filter((o) => o.fechaCompletada === null).map((o) => o.id);
  const yaSelladas = candidatas.filter((o) => o.fechaCompletada !== null).map((o) => o.id);

  for (const lote of trocear(sellando, LOTE_RECALCULO)) {
    await tx.orden.updateMany({
      where: { id: { in: lote } },
      data: { estado: 'completa', fechaCompletada: ahora, ...auditoria },
    });
  }
  for (const lote of trocear(yaSelladas, LOTE_RECALCULO)) {
    await tx.orden.updateMany({
      where: { id: { in: lote } },
      data: { estado: 'completa', ...auditoria },
    });
  }

  // A7: la orden es entidad crítica — cada una deja su renglón, no solo el modelo que lo provocó.
  // También por LOTES: un `createMany` con miles de renglones es la misma lista sin cota que los
  // `updateMany` evitan.
  for (const lote of trocear(candidatas, LOTE_RECALCULO)) {
    await registrarBitacoraLote(
      tx,
      sesion,
      lote.map((o) => ({
        entidad: 'Orden',
        idEntidad: o.id,
        accion: 'MODIFICAR' as const,
        datos: { estado: 'completa', motivo, idModelo },
      })),
    );
  }

  return candidatas.length;
}

/** Parte un arreglo en trozos de `tamano` (el último puede ir corto). */
function trocear<T>(items: T[], tamano: number): T[][] {
  const lotes: T[][] = [];
  for (let i = 0; i < items.length; i += tamano) {
    lotes.push(items.slice(i, i + tamano));
  }
  return lotes;
}

// ── Realineado del estado tras una CARGA DE DATOS (script de mantenimiento) ─────────

/** Qué hizo el realineado con las órdenes que revisó. */
export interface ResumenRealineacion {
  /** Órdenes evaluadas (no canceladas) del lote. */
  revisadas: number;
  /** Pasaron de `completa` a `capturada` (dejaron de cumplir la regla). */
  degradadas: number;
  /** Pasaron de `capturada` a `completa` (ya cumplían y nadie las había recalculado). */
  completadas: number;
  /** Cumplían para degradarse pero se respetaron por tener producción viva (cinturón). */
  protegidasPorProduccion: number;
}

/** Suma dos resúmenes (para acumular lote a lote en el script). */
export function sumarResumenRealineacion(
  a: ResumenRealineacion,
  b: ResumenRealineacion,
): ResumenRealineacion {
  return {
    revisadas: a.revisadas + b.revisadas,
    degradadas: a.degradadas + b.degradadas,
    completadas: a.completadas + b.completadas,
    protegidasPorProduccion: a.protegidasPorProduccion + b.protegidasPorProduccion,
  };
}

/**
 * REALINEA el estado GUARDADO de un lote de órdenes con la regla (`requisitosOrden`), en la
 * transacción del llamador. Es el motor del script de mantenimiento
 * `migracion/realinear-estado-ordenes.ts`, que hay que correr **al terminar cualquier carga o
 * recarga de datos**: el ETL escribe `estado`/`fechaCompletada` EXPLÍCITOS de Access
 * (`crearOrdenMigrada`, fiel a la fuente y sin recalcular), así que sin este paso la pantalla
 * "Órdenes incompletas" —que filtra por el estado guardado— quedaría desalineada y el backlog que
 * Daniel pidió atender sería invisible.
 *
 * Aplica EXACTAMENTE la misma regla que el resto del módulo porque **reusa las mismas funciones**
 * (`requisitosOrden` + `cambiosEstadoPorRequisitos`), incluido el cinturón: **una orden con
 * `EtapaMovimiento` viva NUNCA se degrada**. A diferencia del recálculo por catálogo, aquí SÍ se
 * permite degradar (el propósito es justamente poner al día el semáforo), pero solo donde el
 * cinturón lo autoriza.
 *
 * NO toca `fechaCompletada` más que para sellarla la primera vez (nunca la borra) ni
 * `modificadoPorId` (no lo hizo una persona: el rastro es la bitácora con `idUsuario` NULL, mismo
 * criterio que el ETL y que la migración `20260726130000_recalculo_estado_ordenes`).
 *
 * IDEMPOTENTE: correrlo dos veces no cambia nada la segunda (nada que escribir → ni UPDATE ni
 * bitácora). Espera un lote ya acotado de ids (el script pagina); dentro, todo son consultas de
 * conjunto y `updateMany` por grupo — nada de un viaje por orden.
 */
export async function realinearEstadoOrdenes(
  tx: Tx,
  idsOrden: number[],
): Promise<ResumenRealineacion> {
  const vacio: ResumenRealineacion = {
    revisadas: 0,
    degradadas: 0,
    completadas: 0,
    protegidasPorProduccion: 0,
  };
  if (idsOrden.length === 0) return vacio;

  const ordenes = await tx.orden.findMany({
    where: { id: { in: idsOrden }, estado: { not: 'cancelada' } },
    select: {
      id: true,
      idModelo: true,
      estado: true,
      fechaCompletada: true,
      _count: { select: { lineas: true } },
    },
  });
  if (ordenes.length === 0) return vacio;

  // Insumos del MODELO (una sola consulta para todos los modelos del lote) y actividad viva.
  const idsModelo = [...new Set(ordenes.map((o) => o.idModelo))];
  const [modelos, conActividad] = await Promise.all([
    tx.modelo.findMany({
      where: { id: { in: idsModelo } },
      select: {
        id: true,
        llevaArte: true,
        _count: { select: { avios: { where: { paraProduccion: true } }, bordados: true } },
      },
    }),
    tx.etapaMovimiento
      .groupBy({ by: ['idOrden'], where: { idOrden: { in: idsOrden }, canceladoEn: null } })
      .then((filas) => new Set(filas.map((f) => f.idOrden))),
  ]);
  const porModelo = new Map(modelos.map((m) => [m.id, m]));

  const ahora = new Date();
  const resumen: ResumenRealineacion = { ...vacio, revisadas: ordenes.length };
  const aCapturada: number[] = [];
  const aCompletar: number[] = [];
  const aCompletarSellando: number[] = [];

  for (const orden of ordenes) {
    const modelo = porModelo.get(orden.idModelo);
    const requisitos = requisitosOrden({
      renglonesMatriz: orden._count.lineas,
      aviosProduccion: modelo?._count.avios ?? 0,
      artesModelo: modelo?._count.bordados ?? 0,
      // Sin modelo (imposible: la FK lo garantiza) se asume lo que pidió Daniel: "por default sí
      // lleva" — el lado que HACE ATENDER el tema.
      llevaArte: modelo?.llevaArte ?? true,
    });
    const cambios = cambiosEstadoPorRequisitos(orden, requisitos, ahora);
    if (cambios === null) continue;

    if (cambios.estado === 'capturada') {
      if (conActividad.has(orden.id)) {
        resumen.protegidasPorProduccion += 1;
        continue;
      }
      aCapturada.push(orden.id);
      resumen.degradadas += 1;
    } else {
      if (cambios.fechaCompletada !== undefined) aCompletarSellando.push(orden.id);
      else aCompletar.push(orden.id);
      resumen.completadas += 1;
    }
  }

  const bitacoras: { entidad: string; idEntidad: number; accion: 'MODIFICAR'; datos: object }[] =
    [];
  if (aCapturada.length > 0) {
    await tx.orden.updateMany({ where: { id: { in: aCapturada } }, data: { estado: 'capturada' } });
    for (const id of aCapturada) {
      bitacoras.push({
        entidad: 'Orden',
        idEntidad: id,
        accion: 'MODIFICAR',
        datos: { estado: 'capturada', motivo: 'realineado-post-carga' },
      });
    }
  }
  if (aCompletarSellando.length > 0) {
    await tx.orden.updateMany({
      where: { id: { in: aCompletarSellando } },
      data: { estado: 'completa', fechaCompletada: ahora },
    });
  }
  if (aCompletar.length > 0) {
    await tx.orden.updateMany({
      where: { id: { in: aCompletar } },
      data: { estado: 'completa' },
    });
  }
  for (const id of [...aCompletarSellando, ...aCompletar]) {
    bitacoras.push({
      entidad: 'Orden',
      idEntidad: id,
      accion: 'MODIFICAR',
      datos: { estado: 'completa', motivo: 'realineado-post-carga' },
    });
  }

  // A7: la orden es entidad crítica — una bitácora por orden, en lotes (nunca lista sin cota).
  // `null` de sesión = proceso de sistema (mismo criterio que el ETL).
  for (const lote of trocear(bitacoras, LOTE_RECALCULO)) {
    await registrarBitacoraLote(tx, null, lote);
  }

  return resumen;
}
