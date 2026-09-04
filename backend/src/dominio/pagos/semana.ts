/**
 * LA SEMANA DE UNA CORRIDA (fila 0.113) — piezas PURAS, sin base de datos.
 *
 * Daniel paga por semana (*«debemos de guardar cada corrida … de manera semanal»*), así que «la
 * semana» tiene que ser un valor exacto y no «más o menos esos días»: si el lunes se guardara con
 * la fecha del lunes y el miércoles con la del miércoles, serían dos semanas distintas para el
 * sistema y el guardia de «un solo borrador por segmento» no serviría de nada.
 *
 * ⚠️ TODO en UTC a propósito: la columna es `@db.Date` y Prisma la guarda a medianoche UTC. Usar
 * `getDay()`/`setDate()` locales metería el corrimiento de zona horaria justo en el campo que
 * decide si dos corridas son la misma semana.
 */

/** Milisegundos de un día (las fechas son `@db.Date`, sin horas: la aritmética es exacta). */
const UN_DIA_MS = 86_400_000;

/** Convierte un `YYYY-MM-DD` al `Date` UTC que Prisma guarda en una columna `@db.Date`. */
export function aDateColumna(valor: string): Date {
  return new Date(`${valor}T00:00:00.000Z`);
}

/** El `YYYY-MM-DD` de un `Date` de una columna `@db.Date`. */
export function aFechaIso(valor: Date): string {
  return valor.toISOString().slice(0, 10);
}

/**
 * El LUNES de la semana a la que pertenece esa fecha. Es la clave con la que se identifican las dos
 * corridas de una semana (la de con factura y la de sin).
 *
 * Lunes y no domingo porque es como se cuenta la semana de trabajo aquí: el Excel de Daniel se
 * arma entre semana y se paga al final de ella.
 */
export function lunesDeLaSemana(fecha: string): string {
  const dia = aDateColumna(fecha);
  // getUTCDay(): 0 = domingo … 6 = sábado. El domingo pertenece a la semana que ARRANCÓ el lunes
  // anterior (retroceder 6 días), no a la que empieza al día siguiente.
  const diaSemana = dia.getUTCDay();
  const retroceso = diaSemana === 0 ? 6 : diaSemana - 1;
  return aFechaIso(new Date(dia.getTime() - retroceso * UN_DIA_MS));
}

/**
 * El rango `[desde, hasta]` (ambos inclusive, `YYYY-MM-DD`) de la semana que arranca ese lunes. Es
 * el que acota los RECIBOS de la semana que se enseñan como referencia al lado del campo de
 * captura — nunca como el número que se paga (§Post-F9.189(b)).
 */
export function rangoDeLaSemana(lunes: string): { desde: string; hasta: string } {
  const inicio = aDateColumna(lunes);
  return { desde: lunes, hasta: aFechaIso(new Date(inicio.getTime() + 6 * UN_DIA_MS)) };
}
