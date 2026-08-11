/**
 * COLISIÓN DE FOLIO — el guardia del re-volcado del go-live (auditoría del 11-ago-2026).
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
 * ## Cómo se distingue la recuperación legítima de la colisión
 *
 * Llegados al paso 2 sabemos ya que **NO hay mapeo para esta clave vieja** (si lo hubiera, el paso
 * 1 habría salido). Con eso solo, recuperación y colisión son indistinguibles. Se usan dos señales
 * más, ambas exactas:
 *
 *  • **¿De quién es ese documento?** Si el id que encontramos ya es DESTINO de un mapeo de otra
 *    clave vieja (o de un `create` de esta misma corrida — ver `registrarCreado`), el documento le
 *    pertenece a OTRO documento del viejo: es colisión sí o sí. Cubre el caso de dos filas del
 *    Access con el mismo `(empresa, folio)`, que sin esto se colapsarían en una.
 *  • **¿Quién lo creó?** El ETL escribe `creadoPorId = 'etl-sistema'` (`ID_USUARIO_ETL`, sesión de
 *    sistema del ETL) en los cinco documentos. Un documento capturado por una persona en v2 lleva
 *    su id de usuario. Un documento con folio ya existente, sin dueño en el mapeo y **creado por el
 *    ETL** es exactamente la corrida interrumpida: se mapea y se sigue. Cualquier otro creador —o
 *    `creadoPorId` nulo, que no acredita nada— se trata como **colisión**.
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
 * En producción el ETL de documentos corre **UNA sola vez sobre base limpia**, así que este guardia
 * no debería disparar nunca. Si dispara, es la señal de que se está re-volcando encima de una base
 * con documentos propios — justo lo que hay que ver ANTES de que corrompa el histórico.
 */
import { type ClienteMapeo, type EntidadMapeo } from './mapeo.js';
import type { Reporte } from './reporte.js';
import { ID_USUARIO_ETL } from './sesion-etl.js';

/** Qué es el documento que ya existía con ese folio. */
export type VeredictoFolio =
  /** La corrida anterior lo creó y se cortó antes de mapearlo: se mapea y se sigue. */
  | 'recuperacion'
  /** Es OTRO documento (capturado en v2, o de otra clave vieja): NO se mapea, se reporta. */
  | 'colision';

/** Título de la sección del reporte donde se listan las colisiones de un documento. */
export function tituloColisionFolio(etiqueta: string): string {
  return (
    `⚠️ COLISIÓN DE FOLIO — ya existe ${etiqueta} con ese folio en v2 y NO es el mismo documento ` +
    `(NO se migró, NO se mapeó)`
  );
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
  // El documento ya es de OTRA clave vieja: dos documentos del viejo con el mismo folio.
  if (claveViejaDueno !== null) return 'colision';
  // Sin dueño: solo el rastro de auditoría acredita que lo dejó ahí una corrida interrumpida.
  return creadoPorId === ID_USUARIO_ETL ? 'recuperacion' : 'colision';
}

/**
 * Línea de consola que GRITA las colisiones de un loader, o `null` si no hubo ninguna (el caso
 * normal). Se imprime aparte de los conteos de siempre, porque el defecto que se está tapando era
 * precisamente que estas filas se veían como un `existente` cualquiera.
 */
export function lineaColisiones(etiqueta: string, colisiones: number): string | null {
  if (colisiones <= 0) return null;
  return (
    `    ⚠️ COLISIÓN DE FOLIO: ${String(colisiones)} ${etiqueta}(s) NO se migraron — su folio ya lo ` +
    `ocupa OTRO documento en v2. Están listadas una por una en el reporte. En el go-live el ETL de ` +
    `documentos corre UNA vez sobre base LIMPIA: si esto sale, la base no estaba limpia.`
  );
}

/** Lo mínimo que el guardia necesita saber del documento existente. */
export interface DocumentoExistente {
  id: string | number;
  creadoPorId: string | null;
}

/**
 * Guardia por entidad: clasifica los documentos pre-existentes por folio y arma el renglón del
 * reporte. Se construye UNA vez por loader y se comparte entre las filas del bucle concurrente.
 *
 * COSTO: no paga una consulta por fila. El camino rápido (hay mapeo para la clave vieja) ni lo
 * toca, y la consulta puntual al mapeo solo ocurre en el camino RARO —documento existente sin
 * mapeo—, que sobre una base limpia no ocurre nunca.
 */
export class GuardiaFolios {
  /** `idNuevo` → clave vieja que lo creó EN ESTA corrida (cierra la carrera create↔guardarMapeo). */
  private readonly creadosEnEstaCorrida = new Map<string, string>();

  constructor(
    private readonly cliente: ClienteMapeo,
    private readonly entidad: EntidadMapeo,
    /** Nombre del documento para el reporte (p. ej. `'Orden'`). */
    readonly etiqueta: string,
  ) {}

  /**
   * Anota que ESTA corrida acaba de materializar `idNuevo` para `claveVieja`. Se llama JUSTO tras
   * el `create` (antes del `guardarMapeo`): entre esas dos operaciones el mapeo aún no está en la
   * BD, y sin esta marca una fila concurrente con el mismo folio vería un documento "creado por el
   * ETL y sin dueño" y lo tomaría por recuperación.
   */
  registrarCreado(claveVieja: string, idNuevo: string | number): void {
    this.creadosEnEstaCorrida.set(String(idNuevo), claveVieja);
  }

  /** ¿Qué es el documento que ya existía con ese folio: recuperación o colisión? */
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
   */
  private async duenoPersistido(idNuevo: string): Promise<string | null> {
    const fila = await this.cliente.mapeoMigracion.findFirst({
      where: { entidad: this.entidad, idNuevo },
      select: { claveVieja: true },
    });
    return fila?.claveVieja ?? null;
  }

  /**
   * Lista la colisión en el reporte con TODO lo que hace falta para investigarla en el ensayo del
   * go-live: el folio, la clave vieja que se quedó fuera, el id de v2 con el que chocó y quién lo
   * creó.
   */
  reportar(
    reporte: Reporte,
    datos: { claveVieja: string; folio: string | number; existente: DocumentoExistente },
  ): void {
    const { claveVieja, folio, existente } = datos;
    reporte.agregar(
      tituloColisionFolio(this.etiqueta),
      `folio=${String(folio)} claveVieja=${claveVieja} idV2=${String(existente.id)} ` +
        `creadoPor=${existente.creadoPorId ?? '(sin dato)'}`,
    );
  }
}
