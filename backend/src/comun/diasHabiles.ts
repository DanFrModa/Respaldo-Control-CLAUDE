/**
 * Lógica PURA de DÍAS HÁBILES de la Ruta Crítica (F5-E2; doc `08-Ruta-Critica.md` §4, "capacidad
 * 5"; D10). Se aísla aquí, sin Prisma ni sesión, para probarla directamente (tests sin BD) — es
 * la pieza crítica que usará el CPM de E4 para fechar los procesos (forward) y desfechar
 * (backward) saltando fines de semana y festivos.
 *
 * Modelo: un CALENDARIO ya cargado (qué días de la semana son hábiles + el set de festivos). Las
 * funciones reciben el calendario por parámetro (puras): quien las llama carga los datos de la BD
 * (`dominio/ruta-critica/calendarioLaboral`) y los pasa aquí.
 *
 * Convenciones de fecha: se trabaja SIEMPRE en UTC para evitar corrimientos por zona horaria. Los
 * festivos se identifican por su día calendario (YYYY-MM-DD en UTC). El día de la semana usa
 * `getUTCDay()` (0 = domingo … 6 = sábado).
 */

/** Días hábiles de la semana (qué días se trabaja). Espejo de `CalendarioEmpresa`. */
export interface DiasSemanaHabiles {
  domingo: boolean;
  lunes: boolean;
  martes: boolean;
  miercoles: boolean;
  jueves: boolean;
  viernes: boolean;
  sabado: boolean;
}

/**
 * Calendario laboral ya cargado: qué días de la semana son hábiles y el conjunto de festivos
 * (claves `YYYY-MM-DD` en UTC). `festivos` es un `Set` para consulta O(1).
 */
export interface CalendarioLaboral {
  diasSemana: DiasSemanaHabiles;
  festivos: ReadonlySet<string>;
}

/** Días de la semana de domingo (0) a sábado (6), en el orden de `getUTCDay()`. */
const DIA_POR_INDICE: readonly (keyof DiasSemanaHabiles)[] = [
  'domingo',
  'lunes',
  'martes',
  'miercoles',
  'jueves',
  'viernes',
  'sabado',
];

/** Clave `YYYY-MM-DD` (UTC) de una fecha, para comparar contra el set de festivos. */
export function claveDiaUtc(fecha: Date): string {
  const año = fecha.getUTCFullYear().toString().padStart(4, '0');
  const mes = (fecha.getUTCMonth() + 1).toString().padStart(2, '0');
  const dia = fecha.getUTCDate().toString().padStart(2, '0');
  return `${año}-${mes}-${dia}`;
}

/** Copia la fecha truncada a medianoche UTC (solo el día calendario importa). */
function aMedianocheUtc(fecha: Date): Date {
  return new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate()));
}

/** Devuelve una nueva fecha desplazada `n` días naturales (UTC). */
function sumarDiasNaturales(fecha: Date, n: number): Date {
  const copia = aMedianocheUtc(fecha);
  copia.setUTCDate(copia.getUTCDate() + n);
  return copia;
}

/**
 * ¿Es `fecha` un día hábil según el calendario? (NO es fin de semana no laborable ni festivo).
 * Solo mira el día calendario (la hora se ignora).
 */
export function esDiaHabil(fecha: Date, calendario: CalendarioLaboral): boolean {
  const indice = fecha.getUTCDay();
  const nombreDia = DIA_POR_INDICE[indice];
  if (nombreDia === undefined || !calendario.diasSemana[nombreDia]) {
    return false;
  }
  return !calendario.festivos.has(claveDiaUtc(fecha));
}

/**
 * Suma (o resta, si `n` es negativo) `n` DÍAS HÁBILES a `desde`, saltando fines de semana no
 * laborables y festivos. El día de partida NO cuenta: se avanza/retrocede hasta encontrar `|n|`
 * días hábiles. Con `n = 0` devuelve la misma fecha (truncada a medianoche UTC) SIN moverla,
 * aunque caiga en inhábil (no se "ajusta": cero pasos es cero pasos).
 *
 * Lo usa el CPM de E4: forward (n>0) para fechar a partir de un inicio, backward (n<0) para
 * calcular el inicio más tardío dado un fin.
 *
 * @param desde      fecha de partida.
 * @param n          número de días hábiles a avanzar (positivo) o retroceder (negativo).
 * @param calendario calendario laboral ya cargado.
 */
export function sumarDiasHabiles(desde: Date, n: number, calendario: CalendarioLaboral): Date {
  let cursor = aMedianocheUtc(desde);
  if (n === 0) {
    return cursor;
  }
  const paso = n > 0 ? 1 : -1;
  let restantes = Math.abs(n);
  while (restantes > 0) {
    cursor = sumarDiasNaturales(cursor, paso);
    if (esDiaHabil(cursor, calendario)) {
      restantes -= 1;
    }
  }
  return cursor;
}

/**
 * Cuenta cuántos DÍAS HÁBILES hay en el intervalo `[desde, hasta]` (ambos límites incluidos si son
 * hábiles). Si `hasta` es anterior a `desde` devuelve 0. Solo se consideran los días calendario.
 *
 * @param desde      inicio del intervalo (incluido).
 * @param hasta      fin del intervalo (incluido).
 * @param calendario calendario laboral ya cargado.
 */
export function contarDiasHabiles(desde: Date, hasta: Date, calendario: CalendarioLaboral): number {
  let cursor = aMedianocheUtc(desde);
  const fin = aMedianocheUtc(hasta);
  if (cursor.getTime() > fin.getTime()) {
    return 0;
  }
  let total = 0;
  while (cursor.getTime() <= fin.getTime()) {
    if (esDiaHabil(cursor, calendario)) {
      total += 1;
    }
    cursor = sumarDiasNaturales(cursor, 1);
  }
  return total;
}
