/**
 * EL DÍA DEL NEGOCIO, EN UN SOLO SITIO.
 *
 * Espejo de `backend/src/comun/fecha-negocio.ts`: son dos paquetes sin workspace, así que la zona no
 * se puede importar del backend — pero sí tiene que estar escrita **una vez** de este lado, y éste
 * es ese sitio. Lo estrenó la ventana de captura de PT (fila 0.174) y lo comparte cualquier pantalla
 * que necesite «hoy» para proponerlo o para acotar un selector.
 *
 * 📌 **Fila 0.230 — TODA fecha de negocio de la pantalla sale de aquí.** Había doce `hoy()` sueltos
 * (y tres `hoyISO()` en `cxp`/`cxc`/`esma`, más los «lunes de esta semana» de EsMa y Pagos) que
 * calculaban el día con `toISOString()` —el día **UTC**— y desde las 18:00 de México proponían
 * MAÑANA. Ahora todos piden el día aquí, y el guardián `src/fecha-negocio-guardian.test.ts` no deja
 * que vuelva a aparecer un cálculo de fecha fuera de este archivo.
 *
 * ⚠️ **Dos clases de cuenta, y no se mezclan:**
 *  • **QUÉ DÍA ES HOY** → depende del huso: se pregunta con {@link ZONA_DEL_NEGOCIO}, nunca al
 *    navegador ni a UTC.
 *  • **ARITMÉTICA DE CALENDARIO sobre un `YYYY-MM-DD`** (sumar días, buscar el lunes) → NO depende
 *    de ningún huso: una fecha no tiene hora. Se hace sobre el día anclado a medianoche UTC porque
 *    ahí un día dura siempre 24 h (no hay horario de verano), y se vuelve a escribir con
 *    `toISOString()`. Es el ÚNICO sitio de la pantalla donde ese `toISOString()` es legítimo, y por
 *    eso vive aquí y en ningún otro lado.
 */

/**
 * Huso en el que vive el negocio (FR Moda, Ciudad de México).
 *
 * ⚠️ Va ESCRITO, no se toma del navegador. Es el mismo día que usa el servidor para decidir, así
 * que un navegador puesto en otra zona —o un usuario de viaje— ve la misma fecha que aplica la
 * guarda, no una corrida.
 */
export const ZONA_DEL_NEGOCIO = 'America/Mexico_City';

/** Milisegundos de un día de calendario (exacto sobre fechas a medianoche UTC). */
const MS_POR_DIA = 86_400_000;

/**
 * Fecha de hoy en YYYY-MM-DD **del negocio** (México), igual que la compara el servidor.
 *
 * ⚠️ No es `toISOString()`. Hasta la fila 0.174 los dos lados miraban el día **UTC**, y entre las
 * 18:00 y las 23:59 de México eso es ya el día siguiente: el selector ofrecía MAÑANA como tope. El
 * servidor lo aceptaba (mismo defecto) hasta que la 0.174 ancló la guarda en el día del negocio.
 * ⇒ Un campo que proponga «hoy» con `toISOString()` propone **mañana** media tarde en adelante, que
 * es justo lo contrario de lo que se le pidió (fila 0.216: *«por default que dé la fecha de hoy»*).
 *
 * `ahora` se puede inyectar (igual que en el backend) para probar sin depender del reloj.
 */
export function hoy(ahora: Date = new Date()): string {
  return ahora.toLocaleDateString('en-CA', { timeZone: ZONA_DEL_NEGOCIO });
}

/** Año en curso **del negocio** (el de {@link hoy}): el default de los filtros por año. */
export function anioDelNegocio(ahora: Date = new Date()): number {
  return Number(hoy(ahora).slice(0, 4));
}

/** Mes en curso **del negocio**, 1 = enero … 12 = diciembre: el default de los filtros por mes. */
export function mesDelNegocio(ahora: Date = new Date()): number {
  return Number(hoy(ahora).slice(5, 7));
}

/**
 * Hoy, escrito para leerlo (`es-MX`), con el huso del negocio. Es para los rótulos «hoy 6 jul 2026»
 * de los tableros: sin el huso, el navegador pondría el suyo.
 */
export function hoyLegible(opciones: Intl.DateTimeFormatOptions): string {
  return new Date().toLocaleDateString('es-MX', { ...opciones, timeZone: ZONA_DEL_NEGOCIO });
}

/** El `YYYY-MM-DD` anclado a medianoche UTC (sólo para la aritmética de calendario de aquí). */
function anclar(fechaIso: string): Date {
  return new Date(`${fechaIso.slice(0, 10)}T00:00:00.000Z`);
}

/** `fechaIso` desplazada `dias` días de calendario (negativo = hacia atrás), en `YYYY-MM-DD`. */
export function sumarDias(fechaIso: string, dias: number): string {
  return new Date(anclar(fechaIso).getTime() + dias * MS_POR_DIA).toISOString().slice(0, 10);
}

/** Día de la semana de un `YYYY-MM-DD`: 0 = domingo … 6 = sábado. */
export function diaDeLaSemana(fechaIso: string): number {
  return anclar(fechaIso).getUTCDay();
}

/**
 * El LUNES (inicio de semana ISO) de la semana a la que pertenece `fechaIso`, en `YYYY-MM-DD`. El
 * domingo pertenece a la semana que arrancó el lunes anterior.
 */
export function lunesDeLaSemana(fechaIso: string): string {
  const dia = diaDeLaSemana(fechaIso);
  return sumarDias(fechaIso, dia === 0 ? -6 : 1 - dia);
}

/** Desfase del huso del negocio en ese instante, escrito como `-06:00` (`+00:00` si es GMT). */
function desfaseDelNegocio(instante: Date): string {
  const nombre =
    new Intl.DateTimeFormat('en-US', { timeZone: ZONA_DEL_NEGOCIO, timeZoneName: 'longOffset' })
      .formatToParts(instante)
      .find((parte) => parte.type === 'timeZoneName')?.value ?? 'GMT';
  return nombre === 'GMT' ? '+00:00' : nombre.slice(3);
}

/**
 * El INSTANTE (ISO completo) en que empieza ese día **en el negocio** — p. ej. `2026-06-01` →
 * `2026-06-01T06:00:00.000Z`. Es la frontera de un filtro «desde el día X» sobre una marca de
 * tiempo: leer el día como UTC (`T00:00:00.000Z`) lo corría seis horas, y el filtro de la bitácora
 * dejaba fuera la tarde del último día y metía la del día anterior (fila 0.230).
 */
export function inicioDelDiaDelNegocio(fechaIso: string): string {
  const dia = fechaIso.slice(0, 10);
  // DOS PASADAS. El desfase depende del instante, y el instante depende del desfase: en un día de
  // cambio de horario (México los tuvo hasta 2022) el desfase de la medianoche NO es el del resto del
  // día. Se arma un candidato con el desfase de un instante cualquiera del día y se vuelve a preguntar
  // el desfase EN el candidato; el segundo es el de la medianoche (medido en 2021-04-04, 2021-10-31,
  // 2022-04-03 y 2022-10-30 — preguntar una sola vez a mediodía erraba una hora en los cuatro).
  const candidato = new Date(
    `${dia}T00:00:00.000${desfaseDelNegocio(new Date(`${dia}T12:00:00.000Z`))}`,
  );
  return new Date(`${dia}T00:00:00.000${desfaseDelNegocio(candidato)}`).toISOString();
}

/** El último milisegundo de ese día **en el negocio** (el «hasta el día X», inclusivo). */
export function finDelDiaDelNegocio(fechaIso: string): string {
  return new Date(Date.parse(inicioDelDiaDelNegocio(sumarDias(fechaIso, 1))) - 1).toISOString();
}

/**
 * El `YYYY-MM-DD` como `Date` a medianoche **del navegador**: para las piezas que ya formatean o
 * calculan con la hora local (p. ej. `toLocaleDateString` sin huso). Así el DÍA lo decide el
 * negocio y el navegador sólo lo dibuja — sin el corrimiento que mete leer el texto como UTC.
 */
export function aDiaLocal(fechaIso: string): Date {
  const [a, m, d] = fechaIso.slice(0, 10).split('-').map(Number);
  return new Date(a ?? 1970, (m ?? 1) - 1, d ?? 1);
}
