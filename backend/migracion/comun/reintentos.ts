/**
 * Reintento ACOTADO ante caídas TRANSITORIAS de conexión del ETL (F2-E5).
 *
 * Una corrida del ETL contra la BD remota de `prueba` (Railway, proxy público) dura minutos:
 * aunque la carga sea concurrente (`comun/lotes.ts`), el proxy puede cortar una conexión a
 * media operación ("Connection terminated unexpectedly", `ECONNRESET`, `ETIMEDOUT`…). Esos
 * errores NO son data sucia: son fallos de RED y casi siempre se resuelven al reintentar (el
 * pool abre otra conexión). Como cada unidad de trabajo del ETL es IDEMPOTENTE (re-chequea por
 * mapeo / unique ANTES de crear), reintentar la unidad completa es seguro.
 *
 * `conReintentoTransitorio` envuelve UNA unidad de trabajo: si lanza un error que parece de
 * conexión, reintenta hasta `maxIntentos` con backoff corto; si NO es de conexión (validación,
 * conflicto de negocio, etc.) lo relanza de inmediato (que lo maneje `intentarCrear` del
 * loader → fila omitida y reportada). Tras agotar los intentos, relanza el último error (queda
 * como incidencia; `enLotes` es tolerante y NO tumba al resto de las filas).
 */

/** Patrones de mensaje/código que delatan un corte TRANSITORIO de conexión (no data sucia). */
const PATRONES_TRANSITORIOS = [
  'connection terminated',
  'connection closed',
  'connection ended',
  'server has closed the connection',
  'connection reset',
  'econnreset',
  'epipe',
  'etimedout',
  'econnrefused',
  'timeout expired',
  'terminating connection',
  'socket hang up',
  'read econnreset',
  'connect etimedout',
  // Saturación del servidor: el pool del ETL convive con el de la app y pg-boss contra el
  // `max_connections` de Railway. Es TRANSITORIO (se libera una conexión y el reintento pasa).
  'too many clients',
  '53300',
  // Contención entre tareas concurrentes: dos unidades tocando las mismas filas. También
  // transitorio por definición (Postgres aborta una y la otra sigue).
  'deadlock detected',
  '40p01',
  'could not serialize',
  '40001',
] as const;

/** Recolecta recursivamente los textos (message + code) de un error y sus causas anidadas. */
function textosDeError(error: unknown, profundidad = 0): string[] {
  if (profundidad > 5 || error === null || error === undefined) {
    return [];
  }
  const textos: string[] = [];
  if (typeof error === 'string') {
    textos.push(error);
  } else if (error instanceof Error) {
    textos.push(error.message);
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string') {
      textos.push(code);
    }
    const causa = (error as { cause?: unknown }).cause;
    if (causa !== undefined) {
      textos.push(...textosDeError(causa, profundidad + 1));
    }
  } else if (typeof error === 'object') {
    // Objeto que NO es Error (p. ej. un rechazo `{ code, message }` de una capa baja): serializar
    // a JSON para poder buscar patrones de conexión en su contenido (un `String(obj)` daría
    // "[object Object]", inútil). Si no es serializable, se ignora (no aporta texto).
    try {
      textos.push(JSON.stringify(error));
    } catch {
      // No serializable (referencia circular, BigInt, etc.): sin texto útil que aportar.
    }
  } else if (typeof error === 'number' || typeof error === 'boolean' || typeof error === 'bigint') {
    // Primitivo numérico/booleano: stringificación segura (un símbolo no aporta texto útil).
    textos.push(error.toString());
  }
  return textos;
}

/** `true` si el error parece un corte TRANSITORIO de conexión (vs. un error de negocio/data). */
export function esErrorTransitorioConexion(error: unknown): boolean {
  const textos = textosDeError(error).map((t) => t.toLowerCase());
  return textos.some((t) => PATRONES_TRANSITORIOS.some((p) => t.includes(p)));
}

/** Pausa `ms` milisegundos (backoff entre reintentos). */
function dormir(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Ejecuta `accion` reintentando SOLO ante errores transitorios de conexión. Cualquier otro
 * error se relanza de inmediato. El backoff es lineal corto (`baseMs` × intento).
 *
 * @param accion      la unidad de trabajo IDEMPOTENTE (p. ej. cargar una orden completa).
 * @param maxIntentos número total de intentos (default 3).
 * @param baseMs      base del backoff entre intentos (default 500ms → 0, 500, 1000…).
 */
export async function conReintentoTransitorio<T>(
  accion: () => Promise<T>,
  maxIntentos = 3,
  baseMs = 500,
): Promise<T> {
  let ultimoError: unknown;
  for (let intento = 1; intento <= maxIntentos; intento += 1) {
    try {
      return await accion();
    } catch (error) {
      ultimoError = error;
      if (!esErrorTransitorioConexion(error) || intento === maxIntentos) {
        throw error;
      }
      await dormir(baseMs * intento);
    }
  }
  // Inalcanzable (el bucle siempre retorna o relanza), pero satisface el tipo.
  throw ultimoError;
}
