/**
 * Ventana temporal del ETL (F4-E6, plan §7 — "ventana de 10 años").
 *
 * El plan pide que la migración aplique una VENTANA por fecha y REPORTE lo que queda fuera
 * (nada se descarta en silencio, §7). Pero F2/F3 migraron el histórico COMPLETO (no recortaron
 * por edad), y el grueso del recorte real de F4 lo hace ya el mapeo de empresas (solo las 2
 * activas migran; las OC/notas de las 6 empresas viejas quedan fuera y se listan). Para no
 * tirar historia en silencio NI contradecir lo que hicieron las fases previas, la ventana es
 * CONFIGURABLE y por defecto NO recorta:
 *
 *  • `ETL_VENTANA_ANIOS` (entero ≥0, default **0**): 0 = SIN ventana (migra todo, como F2/F3).
 *    Un valor >0 activa el recorte: se excluye lo ANTERIOR a `ref − N años`.
 *  • `ETL_VENTANA_REF` (fecha `YYYY-MM-DD`, default = HOY): el ancla de la ventana. Útil para
 *    corridas reproducibles (fijar la referencia para que dos corridas excluyan lo mismo).
 *
 * El reporte de cuadre SIEMPRE imprime la configuración de la ventana y el conteo excluido
 * (0 por defecto), así Gabriel ve explícito qué quedó fuera por edad — aunque sea cero.
 */

/** Configuración resuelta de la ventana (de las variables de entorno o sus defaults). */
export interface ConfigVentana {
  /** Años de la ventana; 0 = sin recorte. */
  anios: number;
  /** Instante de referencia (ancla) en ms epoch. */
  refMs: number;
  /** Fecha de corte (refMs − anios): lo anterior se excluye. `null` si `anios === 0`. */
  corte: Date | null;
}

/** Lee `ETL_VENTANA_ANIOS` (entero ≥0; default 0 = sin ventana). Valores inválidos → 0. */
function leerAnios(): number {
  const crudo = (process.env.ETL_VENTANA_ANIOS ?? '').trim();
  if (crudo === '') return 0;
  const n = Number(crudo);
  return Number.isInteger(n) && n >= 0 ? n : 0;
}

/** Lee `ETL_VENTANA_REF` (`YYYY-MM-DD`; default HOY). Inválida → HOY. */
function leerRefMs(): number {
  const crudo = (process.env.ETL_VENTANA_REF ?? '').trim();
  if (crudo !== '' && /^\d{4}-\d{2}-\d{2}$/.test(crudo)) {
    const ms = Date.parse(`${crudo}T00:00:00.000Z`);
    if (Number.isFinite(ms)) return ms;
  }
  return Date.now();
}

/**
 * Resuelve la configuración de la ventana desde el entorno. Se llama UNA vez por corrida (el
 * loader la comparte entre todas sus filas para que el corte sea estable durante la corrida).
 */
export function resolverVentana(): ConfigVentana {
  const anios = leerAnios();
  const refMs = leerRefMs();
  if (anios === 0) {
    return { anios, refMs, corte: null };
  }
  const ref = new Date(refMs);
  const corte = new Date(
    Date.UTC(ref.getUTCFullYear() - anios, ref.getUTCMonth(), ref.getUTCDate(), 0, 0, 0),
  );
  return { anios, refMs, corte };
}

/**
 * ¿La `fecha` cae DENTRO de la ventana (no se excluye)? Con ventana desactivada (`corte === null`)
 * SIEMPRE devuelve `true`. Una `fecha` nula/indeterminada cuenta como DENTRO (no se excluye por
 * edad algo que ni siquiera tiene fecha parseable — eso lo decide el loader por otra vía).
 */
export function dentroVentana(fecha: Date | null, config: ConfigVentana): boolean {
  if (config.corte === null || fecha === null) return true;
  return fecha.getTime() >= config.corte.getTime();
}

/** Descripción legible de la ventana para el reporte de cuadre. */
export function describirVentana(config: ConfigVentana): string {
  if (config.corte === null) {
    return 'Ventana temporal: DESACTIVADA (ETL_VENTANA_ANIOS=0) — se migra todo el histórico.';
  }
  const ref = new Date(config.refMs).toISOString().slice(0, 10);
  const corte = config.corte.toISOString().slice(0, 10);
  return `Ventana temporal: ${String(config.anios)} años (ref=${ref}) — se EXCLUYE lo anterior a ${corte}.`;
}
