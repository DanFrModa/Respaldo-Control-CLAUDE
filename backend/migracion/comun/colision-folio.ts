/**
 * FOLIO YA OCUPADO — el guardia del re-volcado del go-live (auditoría del 11-ago-2026).
 *
 * ## El problema que resuelve
 *
 * Los loaders de documentos con folio propio (`Pedido`, `Orden`, `OrdenCompra`, `NotaSalida`,
 * `Auditoria`) resolvían la idempotencia en DOS pasos:
 *
 *   1. ¿hay `MapeoMigracion` para esta clave vieja? → sí ⇒ `existente` (la re-corrida normal);
 *   2. si no, ¿existe ya un documento con ese `(idEmpresa, folio)`? → sí ⇒ **se mapeaba y se salía**.
 *
 * El paso 2 nació para recuperar una corrida que se cortó ENTRE el `create` y el `guardarMapeo`
 * (el documento quedó en la BD pero sin su renglón de mapeo). Eso está bien… mientras la base esté
 * limpia. En el **re-volcado del go-live** hace algo muy distinto: v2 ya capturó su propia orden
 * con folio 8001 y el Access —que numera por su cuenta— también trae una 8001. **Son documentos
 * DISTINTOS.** El paso 2 los declaraba el mismo y escribía el mapeo `IdOrdenes(Access) → id de la
 * orden de v2`; a partir de ahí TODOS los hijos del volcado nuevo (cortes, envíos, recibos, cargos
 * EsMa, costos, auditorías, ruta crítica) resuelven la orden por ese mapeo y **se pegan a la orden
 * equivocada**: el WIP se infla y el cargo le llega al maquilero que no fue. Y el desenlace era
 * `existente`, que es justo lo que uno espera ver en una re-corrida idempotente: sin reporte, sin
 * excepción, sin conteo anómalo. **Nadie se enteraba.**
 *
 * ## DOS diagnósticos MUY distintos, no uno (separados el 11-ago-2026)
 *
 * El folio ocupado tiene dos causas que exigen reacciones opuestas, y hasta hoy se reportaban con el
 * mismo texto y el mismo contador — un diagnóstico falso para la mitad de los casos:
 *
 *  • **`duplicadoOrigen`** — el **Access trae dos o más documentos con el MISMO folio**. Es un
 *    problema del ORIGEN, no de la base de destino: se carga uno (el primero que llega; ver la
 *    decisión de Daniel abajo) y el otro se REPORTA y no entra. Medido sobre la foto de hoy: hay
 *    **4 pares de `NumCompra` repetidos** en la empresa 8 con fecha de 2026 —o sea, DENTRO de la
 *    ventana— y **dos de esos pares tienen proveedores distintos**. El volcado del go-live traerá
 *    los suyos, así que el número exacto no importa: importa que salgan listados en el reporte.
 *  • **`colisionV2`** — el folio lo ocupa **un documento capturado en v2** (por una persona, o por
 *    cualquier proceso que no sea el ETL). Ahí sí: **la base no estaba limpia** y hay que parar.
 *
 * ## DECISIÓN DE NEGOCIO ante el duplicado de origen (Daniel, 11-ago-2026)
 *
 * Daniel: _"Mete la que sea. La de mayor monto."_ … _"Es irrelevante para mí. Es algo demasiado
 * pequeño para gastar tiempo. El hecho de que sea una u otra me da igual."_ → se carga **uno
 * cualquiera** (el que gane la carrera del bucle concurrente) y el otro se reporta. **NO se
 * implementa** la selección "la de mayor monto": exigiría una pre-pasada agrupando por folio en los
 * cinco loaders para cambiar únicamente CUÁL de los dos entra, y el dueño dijo que le da igual.
 * Queda escrito en `DECISIONES.md §Post-F9.30`, no callado.
 *
 * ## Cómo se distingue la recuperación legítima de un folio ya ocupado
 *
 * Llegados al paso 2 sabemos ya que **NO hay mapeo para esta clave vieja** (si lo hubiera, el paso
 * 1 habría salido). Con eso solo, recuperación y folio ocupado son indistinguibles. Se usan dos
 * señales más, ambas exactas:
 *
 *  • **¿De quién es ese documento?** Si el id que encontramos ya es DESTINO de un mapeo de otra
 *    clave vieja (o de un `create` de esta misma corrida — ver `registrarCreado`), el documento le
 *    pertenece a OTRO documento del viejo: es **`duplicadoOrigen`**. Cubre el caso de dos filas del
 *    Access con el mismo `(empresa, folio)`, que sin esto se colapsarían en una.
 *  • **¿Quién lo creó?** El ETL escribe `creadoPorId = 'etl-sistema'` (`ID_USUARIO_ETL`, sesión de
 *    sistema del ETL) en los cinco documentos. Un documento capturado por una persona en v2 lleva
 *    su id de usuario. Un documento con folio ya existente, sin dueño en el mapeo y **creado por el
 *    ETL** es exactamente la corrida interrumpida: se mapea y se sigue. Cualquier otro creador —o
 *    `creadoPorId` nulo, que no acredita nada— se trata como **`colisionV2`**.
 *
 * ⚠️ **Por eso una corrida INTERRUMPIDA se limpia, no se retoma.** El camino de recuperación es
 * seguro solo si la corrida anterior no dejó documentos huérfanos de un folio DUPLICADO: si se cortó
 * justo después de crear el documento de la clave `B` (sin su mapeo), en la re-corrida la fila
 * hermana `A` lo ve "creado por el ETL y sin dueño" → lo toma por recuperación y mapea `A → ese
 * documento`, que se hizo con los datos de `B`; los hijos de `A` se cuelgan de un documento ajeno.
 * La mitigación es de proceso, no de código: **`README.md` Regla 1 — si una corrida se interrumpe,
 * se VACÍA la base y se empieza de nuevo.**
 *
 * ## La regla ante la duda
 *
 * Ante la duda NO se mapea: se reporta y se deja la fila fuera. Perder una fila y avisar es
 * infinitamente mejor que pegarle los recibos a la orden equivocada en silencio (plan §7: nada en
 * silencio). El costo del falso positivo es una línea en el reporte que Gabriel revisa; el del
 * falso negativo es histórico corrupto que nadie ve.
 *
 * ## Regla dura de go-live (`migracion/README.md`)
 *
 * En producción el ETL de documentos corre **UNA sola vez sobre base limpia**, así que la
 * `colisionV2` no debería disparar nunca. Si dispara, es la señal de que se está re-volcando encima
 * de una base con documentos propios — justo lo que hay que ver ANTES de que corrompa el histórico.
 * El `duplicadoOrigen`, en cambio, SÍ puede salir en una corrida perfectamente sana: lo trae el
 * Access.
 */
import { type ClienteMapeo, type EntidadMapeo } from './mapeo.js';
import type { Reporte } from './reporte.js';
import { ID_USUARIO_ETL } from './sesion-etl.js';

/** Qué es el documento que ya existía con ese folio. */
export type VeredictoFolio =
  /** La corrida anterior lo creó y se cortó antes de mapearlo: se mapea y se sigue. */
  | 'recuperacion'
  /** El ORIGEN (Access) trae dos documentos con el mismo folio: entra uno, el otro se reporta. */
  | 'duplicadoOrigen'
  /** Lo capturó v2 (no el ETL): la base no estaba limpia. NO se mapea, se reporta. */
  | 'colisionV2';

/** Conteos separados de un loader: los dos diagnósticos NO se suman en un solo número. */
export interface ConteosFolio {
  /** # de filas no migradas porque el Access trae otro documento con ese folio. */
  duplicadoOrigen: number;
  /** # de filas no migradas porque el folio lo ocupa un documento capturado en v2. */
  colisionV2: number;
}

/** Título de la sección del reporte para los DUPLICADOS DEL ORIGEN de un documento. */
export function tituloDuplicadoOrigen(etiqueta: string): string {
  return (
    `⚠️ FOLIO DUPLICADO EN EL ORIGEN — el Access trae dos o más ${etiqueta}(s) con el mismo folio: ` +
    `se cargó UNA y ESTA no (NO es un problema de la base de v2)`
  );
}

/** Título de la sección del reporte para las COLISIONES CONTRA V2 de un documento. */
export function tituloColisionFolio(etiqueta: string): string {
  return (
    `⚠️ COLISIÓN CON V2 — ese folio lo ocupa ${etiqueta} CAPTURADA EN V2 (no la puso el ETL): ` +
    `la base NO estaba limpia (NO se migró, NO se mapeó)`
  );
}

/**
 * Línea de consola de los DUPLICADOS DEL ORIGEN, o `null` si no hubo (no mete ruido). Dice lo que
 * de verdad pasó —el Access trae el folio dos veces— y **qué se va con la fila que no entró**, para
 * que Gabriel no lea "colisión" y salga a vaciar una base que está perfectamente bien.
 *
 * @param arrastre qué se pierde junto con la fila (p. ej. `'sus renglones y sus recepciones'`).
 */
export function lineaDuplicadosOrigen(
  etiqueta: string,
  duplicados: number,
  arrastre: string,
): string | null {
  if (duplicados <= 0) return null;
  return (
    `    ⚠️ FOLIO DUPLICADO EN EL ORIGEN: ${String(duplicados)} ${etiqueta}(s) del Access comparten ` +
    `folio con otra que SÍ se cargó, así que NO entraron (y con ellas, ${arrastre}). NO es un ` +
    `problema de la base de v2: viene así del Access. Están listadas una por una en el reporte; ` +
    `revísalas con Daniel. (Decisión: se carga una cualquiera — DECISIONES.md §Post-F9.30.) ` +
    `⚠️ Un duplicado que pierda la carrera contra el unique de la BD no sale aquí: cae en ` +
    `omitidosValidacion.`
  );
}

/**
 * Línea de consola que GRITA las colisiones CONTRA V2 de un loader, o `null` si no hubo ninguna (el
 * caso normal). Se imprime aparte de los conteos de siempre, porque el defecto que se está tapando
 * era precisamente que estas filas se veían como un `existente` cualquiera.
 */
export function lineaColisionesV2(etiqueta: string, colisiones: number): string | null {
  if (colisiones <= 0) return null;
  return (
    `    ⚠️ COLISIÓN CON V2: ${String(colisiones)} ${etiqueta}(s) NO se migraron — su folio lo ocupa ` +
    `un documento CAPTURADO EN V2. Están listadas una por una en el reporte. En el go-live el ETL de ` +
    `documentos corre UNA vez sobre base LIMPIA: si esto sale, la base no estaba limpia.`
  );
}

/** Lo mínimo que el guardia necesita saber del documento existente. */
export interface DocumentoExistente {
  id: string | number;
  creadoPorId: string | null;
}

/**
 * Decisión PURA (sin BD) sobre un documento pre-existente hallado por `(idEmpresa, folio)`.
 *
 * @param claveVieja      la clave vieja que se está migrando ahora.
 * @param claveViejaDueno clave vieja que YA apunta a ese documento (`null` si ninguna).
 * @param creadoPorId     `creado_por_id` del documento existente (`null` si no lo trae).
 */
export function clasificarExistentePorFolio(args: {
  claveVieja: string;
  claveViejaDueno: string | null;
  creadoPorId: string | null;
}): VeredictoFolio {
  const { claveVieja, claveViejaDueno, creadoPorId } = args;
  // Defensivo: el llamador ya consultó el mapeo de esta clave, pero si el documento resulta ser
  // suyo, es la re-corrida normal.
  if (claveViejaDueno === claveVieja) return 'recuperacion';
  // El documento ya es de OTRA clave vieja: dos documentos del VIEJO con el mismo folio. La base de
  // v2 está bien; el duplicado viene del Access.
  if (claveViejaDueno !== null) return 'duplicadoOrigen';
  // Sin dueño: solo el rastro de auditoría acredita que lo dejó ahí una corrida interrumpida.
  return creadoPorId === ID_USUARIO_ETL ? 'recuperacion' : 'colisionV2';
}

/**
 * Guardia por entidad: clasifica los documentos pre-existentes por folio, lleva los DOS conteos
 * separados y arma el renglón del reporte. Se construye UNA vez por loader y se comparte entre las
 * filas del bucle concurrente.
 *
 * COSTO: no paga una consulta por fila. El camino rápido (hay mapeo para la clave vieja) ni lo
 * toca, y la consulta puntual al mapeo solo ocurre en el camino RARO —documento existente sin
 * mapeo—, que sobre una base limpia no ocurre nunca.
 */
export class GuardiaFolios {
  /** `idNuevo` → clave vieja que lo creó EN ESTA corrida (cierra la carrera create↔guardarMapeo). */
  private readonly creadosEnEstaCorrida = new Map<string, string>();

  /** Conteos separados por diagnóstico (los incrementa `reportar`). */
  private readonly contadores: ConteosFolio = { duplicadoOrigen: 0, colisionV2: 0 };

  constructor(
    private readonly cliente: ClienteMapeo,
    private readonly entidad: EntidadMapeo,
    /** Nombre del documento para el reporte (p. ej. `'Orden'`). */
    readonly etiqueta: string,
    /**
     * Qué se pierde junto con la fila que no entra (p. ej. `'sus renglones y sus recepciones'`).
     * Va en el reporte y en la consola: el duplicado de origen no se arregla solo, y Gabriel tiene
     * que saber qué información se quedó fuera con él.
     */
    readonly arrastre: string,
  ) {}

  /** Conteos separados: `duplicadoOrigen` (culpa del Access) vs `colisionV2` (base sucia). */
  get conteos(): ConteosFolio {
    return { ...this.contadores };
  }

  /**
   * Anota que ESTA corrida acaba de materializar `idNuevo` para `claveVieja`. Se llama JUSTO tras
   * el `create` (antes del `guardarMapeo`): entre esas dos operaciones el mapeo aún no está en la
   * BD, y sin esta marca una fila concurrente con el mismo folio vería un documento "creado por el
   * ETL y sin dueño" y lo tomaría por recuperación.
   */
  registrarCreado(claveVieja: string, idNuevo: string | number): void {
    this.creadosEnEstaCorrida.set(String(idNuevo), claveVieja);
  }

  /** ¿Qué es el documento que ya existía con ese folio: recuperación, duplicado de origen o v2? */
  async clasificar(claveVieja: string, existente: DocumentoExistente): Promise<VeredictoFolio> {
    const idNuevo = String(existente.id);
    const claveViejaDueno =
      this.creadosEnEstaCorrida.get(idNuevo) ?? (await this.duenoPersistido(idNuevo));
    return clasificarExistentePorFolio({
      claveVieja,
      claveViejaDueno,
      creadoPorId: existente.creadoPorId,
    });
  }

  /**
   * Clave vieja que ya apunta a `idNuevo` según `MapeoMigracion` (`null` si ninguna). Va por el
   * índice `(entidad, idNuevo)` que la tabla ya tiene, así que no hace falta migración ni cachear
   * el mapeo inverso completo en memoria.
   *
   * `orderBy` explícito: sin él, `findFirst` no garantiza CUÁL fila devuelve, y una base que ya
   * traiga DOS mapeos al mismo `idNuevo` (es lo que escribía el código viejo, antes de este
   * guardia) daría un resultado distinto entre corridas — un diagnóstico no determinista es peor
   * que ninguno.
   */
  private async duenoPersistido(idNuevo: string): Promise<string | null> {
    const fila = await this.cliente.mapeoMigracion.findFirst({
      where: { entidad: this.entidad, idNuevo },
      select: { claveVieja: true },
      orderBy: { id: 'asc' },
    });
    return fila?.claveVieja ?? null;
  }

  /**
   * Lista el caso en el reporte —en la sección que le toca según el veredicto— con TODO lo que hace
   * falta para investigarlo en el ensayo del go-live: el folio, la clave vieja que se quedó fuera,
   * el id de v2 con el que chocó y quién lo creó. Y de paso lleva el conteo del diagnóstico.
   */
  reportar(
    reporte: Reporte,
    datos: {
      claveVieja: string;
      folio: string | number;
      existente: DocumentoExistente;
      veredicto: 'duplicadoOrigen' | 'colisionV2';
      /** Lo que la fila arrastraba, ya contado (p. ej. `'renglones=3 ligas=1'`). */
      arrastreFila?: string;
    },
  ): void {
    const { claveVieja, folio, existente, veredicto, arrastreFila } = datos;
    const detalle =
      `folio=${String(folio)} claveVieja=${claveVieja} idV2=${String(existente.id)} ` +
      `creadoPor=${existente.creadoPorId ?? '(sin dato)'}` +
      (arrastreFila === undefined ? '' : ` ${arrastreFila}`);
    if (veredicto === 'duplicadoOrigen') {
      this.contadores.duplicadoOrigen += 1;
      reporte.agregar(
        tituloDuplicadoOrigen(this.etiqueta),
        `${detalle} — la que SÍ entró tiene ese mismo folio; con esta se quedan fuera ${this.arrastre}`,
      );
      return;
    }
    this.contadores.colisionV2 += 1;
    reporte.agregar(tituloColisionFolio(this.etiqueta), detalle);
  }
}
