/**
 * REQUISITOS de una orden de producción → estado `completa` AUTOMÁTICO (Daniel, 26-jul-2026).
 *
 * Daniel: *"El estado de la orden (completa, incompleta) no sé en base a qué existe. En CONTROL
 * viejo existía, pero está en desuso. Acá podríamos definirla como completa cuando ya tenga los
 * avíos, los artes. De manera automática se pone como completa."*
 *
 * REGLA ELEGIDA por él — **"tallas + receta liberada, y arte si aplica"**:
 *  • `tallas` — la orden tiene su matriz capturada (≥1 renglón color×talla).
 *  • `receta` — **Desarrollo liberó la receta congelada de ESTA orden POR COMPLETO**
 *    (`Orden.recetaLiberadaEn`, que desde V1-E3h/§Post-F9.72 es un DERIVADO de los renglones:
 *    "no queda ninguno vivo sin firmar"). Una receta liberada a medias ya deja COMPRAR lo
 *    firmado, pero la orden todavía no está completa.
 *  • `arte`   — se exige cuando el modelo LLEVA arte (`Modelo.llevaArte`); las prendas lisas se
 *               completan normal (el propio impreso de Daniel dice "NO LLEVA BORDADO/ESTAMPADO").
 *               El arte se cuenta en la **receta de la ORDEN**, no en el BOM del modelo.
 *
 * ⭐ **V1-E3d (§Post-F9.43): el segundo requisito CAMBIÓ de fuente, no de espíritu.** Era *"¿el
 * MODELO tiene avíos `paraProduccion`?"*, que nunca fue una pregunta sobre ESTA orden: dos órdenes
 * del mismo modelo daban siempre la misma respuesta, aunque una llevara jareta y la otra no. Ahora
 * pregunta *"¿la receta de la OP está liberada?"* — el mismo semáforo diciendo algo verdadero, y
 * además lo que de verdad importa antes de comprar. Consecuencia buscada: **editar el BOM de un
 * modelo ya NO alcanza hacia atrás a sus órdenes**, que era el defecto que la etapa vino a matar.
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
 * el guardado/copiado de matriz, la liberación de la receta y el recálculo por la casilla
 * "lleva arte" del modelo. No hay una segunda copia de la regla en ningún lado.
 *
 * Al final del archivo viven los helpers que APLICAN la regla en la BD (`recalcularEstadoOrden` y
 * `recalcularEstadoOrdenesDeModelo`), siempre dentro de la transacción del llamador (A2).
 */
import type { EstadoOrden } from '../../datos/index.js';

import { datosModificacion, registrarBitacoraLote } from '../../comun/auditoria.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import type { Tx } from '../../comun/transaccion.js';

/** Cada requisito que se evalúa para completar una orden. */
export type ClaveRequisitoOrden = 'tallas' | 'receta' | 'arte';

/** Etiqueta en lenguaje de negocio de cada requisito (la usa la UI y los mensajes). */
export const ETIQUETA_REQUISITO_ORDEN: Record<ClaveRequisitoOrden, string> = {
  tallas: 'tallas',
  receta: 'liberar la receta',
  arte: 'arte',
};

/** Insumos MÍNIMOS para evaluar la regla (conteos; nada de entidades de Prisma). */
export interface InsumosRequisitosOrden {
  /** Renglones de la matriz (colores) capturados en la orden. */
  renglonesMatriz: number;
  /** ¿Desarrollo LIBERÓ la receta congelada de ESTA orden? (V1-E3d, §Post-F9.43). */
  recetaLiberada: boolean;
  /** Artes VIVOS (no excluidos) de la receta de ESTA orden. */
  artesOrden: number;
  /** ¿El MODELO lleva arte? (`Modelo.llevaArte`, default `true`). `false` = prenda lisa. */
  llevaArte: boolean;
}

/** Resultado de evaluar la regla. `arte: 'no-aplica'` = el modelo no lleva arte (no bloquea). */
export interface RequisitosOrden {
  tallas: boolean;
  receta: boolean;
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
  const receta = insumos.recetaLiberada;
  const arte = evaluarArte(insumos.llevaArte, insumos.artesOrden);

  const faltantes: ClaveRequisitoOrden[] = [];
  if (!tallas) faltantes.push('tallas');
  if (!receta) faltantes.push('receta');
  if (arte === false) faltantes.push('arte');

  return { tallas, receta, arte, completa: faltantes.length === 0, faltantes };
}

/**
 * Requisito del ARTE (decisión de Daniel, ver cabecera). La bandera del MODELO manda: si la prenda
 * no lleva arte, el requisito no aplica; si lo lleva, se cumple con el arte que trae **la receta de
 * ESTA orden** (V1-E3d) — y si falta, el arte sale `false` y la orden queda incompleta hasta que
 * alguien lo atienda (capturar el arte o desmarcar la casilla).
 */
function evaluarArte(llevaArte: boolean, artesOrden: number): 'no-aplica' | boolean {
  if (!llevaArte) return 'no-aplica';
  return artesOrden > 0;
}

/**
 * Texto corto de "qué le falta" en lenguaje de negocio (p. ej. `Falta: liberar la receta`), o
 * `null` si no falta nada. Las etiquetas salen de {@link ETIQUETA_REQUISITO_ORDEN}, así que este
 * texto sigue a la regla y no al revés. Vive aquí (con la regla) para que la UI y los mensajes del
 * backend digan lo mismo.
 */
export function textoFaltantesOrden(requisitos: RequisitosOrden): string | null {
  if (requisitos.faltantes.length === 0) return null;
  const etiquetas = requisitos.faltantes.map((f) => ETIQUETA_REQUISITO_ORDEN[f]);
  // "tallas", "tallas y liberar la receta", "tallas, liberar la receta y arte" (coma hasta el
  // penúltimo, "y" al final).
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
  const [renglonesMatriz, artesOrden, fila, modelo] = await Promise.all([
    tx.ordenLinea.count({ where: { idOrden: orden.id } }),
    tx.ordenArte.count({ where: { idOrden: orden.id, excluido: false } }),
    tx.orden.findUnique({ where: { id: orden.id }, select: { recetaLiberadaEn: true } }),
    tx.modelo.findUnique({ where: { id: orden.idModelo }, select: { llevaArte: true } }),
  ]);
  // Si el modelo no apareciera (imposible: la FK lo garantiza), se asume lo que pidió Daniel —
  // "por default sí lleva" — que es el lado que HACE ATENDER el tema, no el que lo esconde.
  return {
    renglonesMatriz,
    recetaLiberada: fila?.recetaLiberadaEn != null,
    artesOrden,
    llevaArte: modelo?.llevaArte ?? true,
  };
}

/**
 * Traduce los requisitos al par (`estado`, `fechaCompletada`) que debe quedar guardado, a partir
 * de lo que la orden tiene HOY. Puro (no toca BD) para poder probarlo sin Postgres.
 *
 *  • `cancelada` SIEMPRE gana: una orden cancelada no cambia de estado por esta regla.
 *  • El `estado` refleja la VERDAD ACTUAL: si deja de cumplir requisitos (le borran la matriz, o su
 *    receta deja de estar liberada por completo) vuelve a `capturada`. No es un sello de una sola
 *    vía. Editar el BOM del MODELO ya no la mueve (V1-E3d: la receta de la orden está congelada).
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
 * nombrar la causa REAL. Hoy hay UNA sola: `lleva-arte` (se marcó o desmarcó la casilla del
 * modelo), y su único llamador es `modelos/modelos.ts`. Editar el BOM del modelo ya NO recalcula
 * nada (V1-E3d: cada orden vive de su receta congelada), por eso el motivo `bom-modelo` desapareció
 * del tipo y de la bitácora.
 */
export type MotivoRecalculoModelo = 'lleva-arte';

/**
 * RECÁLCULO por cambio de la casilla **"lleva arte"** del modelo. **SOLO COMPLETA: nunca
 * des-completa** (26-jul-2026, tras revisión). Es una operación cotidiana de catálogo y no puede
 * degradar de golpe su histórico —órdenes entregadas hace años— ni sacar de los tableros a las que
 * están a medio producir. El "des-completar" vive únicamente en la edición de la MATRIZ de una orden
 * concreta, y con el cinturón de la actividad de producción (ver {@link recalcularEstadoOrden}).
 *
 * ⭐ **V1-E3d (§Post-F9.43): éste era el "alcance hacia atrás" y se le cortó el brazo largo.** Antes
 * lo llamaba también CADA edición del BOM o del arte del modelo (`motivo: 'bom-modelo'`), porque el
 * estado de la orden dependía del BOM del modelo. Ahora la orden tiene su receta congelada, así que
 * **tocar el BOM de un modelo ya no toca ninguna orden**: sus llamadas desde `bom-modelo.ts` y
 * `arte-modelo.ts` desaparecieron. Lo único que sigue viviendo en el modelo es la casilla
 * `llevaArte` —desmarcarla vuelve `no-aplica` el requisito del arte—, y por eso esta función
 * sobrevive con ese único motivo.
 *
 * Cómo decide, sin duplicar la regla: los tres insumos que faltan por orden (matriz, receta liberada
 * y arte de la receta) se leen POR ORDEN en UNA consulta con `_count`, y la respuesta la da la
 * función PURA {@link requisitosOrden}. Aquí no se re-implementa nada.
 *
 * Universo acotado: SOLO las `capturada` de ESE modelo (las `completa` ya lo están y las `cancelada`
 * no se tocan) que además tengan matriz y receta liberada — el filtro va en la consulta, no en
 * memoria. Escribe en LOTES de {@link LOTE_RECALCULO} y deja **bitácora POR ORDEN** (A7: la orden es
 * entidad crítica; no basta la del modelo).
 *
 * A9: NO se filtra por empresa a propósito. Los modelos son catálogo GLOBAL (ADR-0007), así que la
 * casilla afecta a las órdenes de cualquier empresa; filtrar por la activa dejaría a las demás
 * mintiendo. No se devuelve ni un dato de otra empresa: solo se sincroniza un estado derivado.
 *
 * Devuelve cuántas órdenes se completaron (para diagnóstico).
 */
export async function recalcularEstadoOrdenesDeModelo(
  tx: Tx,
  sesion: SesionUsuario,
  idModelo: number,
  motivo: MotivoRecalculoModelo = 'lleva-arte',
): Promise<number> {
  const modelo = await tx.modelo.findUnique({
    where: { id: idModelo },
    select: { llevaArte: true },
  });
  const llevaArte = modelo?.llevaArte ?? true;

  // Universo: `capturada` de este modelo CON matriz y CON receta liberada. Lo demás no puede
  // completarse por un cambio de la casilla, y filtrarlo aquí evita traerlo a memoria.
  const candidatas = await tx.orden.findMany({
    where: {
      idModelo,
      estado: 'capturada',
      lineas: { some: {} },
      recetaLiberadaEn: { not: null },
    },
    select: {
      id: true,
      fechaCompletada: true,
      _count: { select: { recetaArtes: { where: { excluido: false } } } },
    },
    orderBy: { id: 'asc' },
  });
  if (candidatas.length === 0) return 0;

  // La regla PURA decide orden por orden (única fuente; nada re-implementado aquí).
  const aCompletar = candidatas.filter(
    (o) =>
      requisitosOrden({
        renglonesMatriz: 1,
        recetaLiberada: true,
        artesOrden: o._count.recetaArtes,
        llevaArte,
      }).completa,
  );
  if (aCompletar.length === 0) return 0;

  const ahora = new Date();
  const auditoria = datosModificacion(sesion);
  // Dos grupos: las que además SELLAN `fechaCompletada` (primera vez) y las que ya la traen.
  const sellando = aCompletar.filter((o) => o.fechaCompletada === null).map((o) => o.id);
  const yaSelladas = aCompletar.filter((o) => o.fechaCompletada !== null).map((o) => o.id);

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
  for (const lote of trocear(aCompletar, LOTE_RECALCULO)) {
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

  return aCompletar.length;
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
      // V1-E3d: los insumos "receta liberada" y "arte" son de la ORDEN, no del modelo.
      recetaLiberadaEn: true,
      _count: { select: { lineas: true, recetaArtes: { where: { excluido: false } } } },
    },
  });
  if (ordenes.length === 0) return vacio;

  // Único insumo del MODELO que sobrevive (V1-E3d): la casilla "lleva arte". Una sola consulta
  // para todos los modelos del lote. Más la actividad viva (el cinturón del des-completar).
  const idsModelo = [...new Set(ordenes.map((o) => o.idModelo))];
  const [modelos, conActividad] = await Promise.all([
    tx.modelo.findMany({
      where: { id: { in: idsModelo } },
      select: { id: true, llevaArte: true },
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
      recetaLiberada: orden.recetaLiberadaEn !== null,
      artesOrden: orden._count.recetaArtes,
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
