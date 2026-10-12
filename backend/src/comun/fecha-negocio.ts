/**
 * La FECHA DE UN ACTO tal y como la va a LEER quien lo hizo, aquí en México.
 *
 * ⚠️ No es `toISOString()`. Los sellos de auditoría (`aprobadoEn`, `revisadoEn`, …) son INSTANTES,
 * el servidor corre en UTC y quien los lee vive en `-06:00`. Una firma puesta a las 18:00 de Ciudad
 * de México cae ya en el día siguiente en UTC, así que el mensaje del servidor diría un día y la
 * pantalla —que lo pinta con `toLocaleDateString('es-MX')` en el navegador— diría otro: **dos fechas
 * para el mismo acto**. Se formatea con la MISMA llamada que la pantalla, con el huso escrito a mano
 * porque el servidor no lo hereda de nadie.
 *
 * Nació en `dominio/modelos/revision-modelo.ts` (V1-E7d, arreglando exactamente ese desfase) y se
 * subió aquí en V1-E8b, cuando la invalidación de la firma del PRECIO necesitó la misma frase: una
 * segunda copia habría sido dos fechas para el mismo problema.
 */

/** Huso en el que vive el negocio (FR Moda, Ciudad de México). */
export const ZONA_DEL_NEGOCIO = 'America/Mexico_City';

/** `DD/MM/AAAA` en el huso del negocio — el mismo día que enseña la pantalla. */
export function fechaDelActo(fecha: Date): string {
  return fecha.toLocaleDateString('es-MX', { timeZone: ZONA_DEL_NEGOCIO });
}

/**
 * EL DÍA DE HOY tal como lo vive el negocio (México), en `YYYY-MM-DD`.
 *
 * El ancla de todo lo que se mide «contra hoy» en el servidor. `en-CA` da exactamente
 * `YYYY-MM-DD`, y la zona va escrita porque el servidor no la hereda de nadie: corre en UTC, así
 * que `new Date().toISOString()` a las 18:00 de México devuelve **el día siguiente**.
 *
 * Nació dentro de `dominio/inventarios/movimientos-pt.ts` (fila 0.138) para el periodo de LECTURA
 * del kardex, pasó a `periodo-kardex.ts` al generalizarse (0.173) y subió aquí en la 0.174, cuando
 * la ventana de CAPTURA de fecha —que hasta entonces se anclaba en el día UTC— tuvo que medirse
 * contra el mismo día. Tener dos anclas era tener dos «hoy»: el que decide qué se puede capturar y
 * el que decide qué se puede leer, separados seis horas cada tarde.
 *
 * `ahora` se puede inyectar para probar sin depender de la hora a la que corra la prueba.
 */
export function hoyDelNegocio(ahora: Date = new Date()): string {
  return diaDelNegocio(ahora);
}

/**
 * El DÍA del negocio en que cayó un INSTANTE (`creadoEn`, `fechaAutorizado`, `cerradaEn`…), en
 * `YYYY-MM-DD`.
 *
 * ⭐ **Fila 0.230.** Un sello de tiempo es un instante; su día no es su parte UTC. Un cargo de EsMa
 * dado de alta a las 19:00 de México tiene `creadoEn` del día siguiente en UTC, y
 * `creadoEn.toISOString().slice(0, 10)` lo fechaba MAÑANA en el estado de cuenta (y le corría un
 * día el vencimiento). Columnas `@db.Date` no pasan por aquí: ésas YA son un día.
 */
export function diaDelNegocio(instante: Date): string {
  return instante.toLocaleDateString('en-CA', { timeZone: ZONA_DEL_NEGOCIO });
}

/** {@link diaDelNegocio}, a medianoche UTC: la forma de una columna `@db.Date` (y de los días de la RC). */
export function diaDelNegocioUtc(instante: Date): Date {
  return new Date(`${diaDelNegocio(instante)}T00:00:00.000Z`);
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
 * El INSTANTE en que empieza ese día (`YYYY-MM-DD`) **en el negocio** — la frontera para filtrar una
 * columna de SELLO DE TIEMPO por día (fila 0.230). Leer el día como UTC (`T00:00:00.000Z`) corría el
 * filtro seis horas: dejaba fuera la tarde del último día y metía la del anterior.
 */
export function inicioDelDiaDelNegocio(fechaIso: string): Date {
  const dia = fechaIso.slice(0, 10);
  // DOS PASADAS. El desfase depende del instante, y el instante depende del desfase: en un día de
  // cambio de horario (México los tuvo hasta 2022) el desfase de la medianoche NO es el del resto del
  // día. Se arma un candidato con el desfase de un instante cualquiera del día y se vuelve a preguntar
  // el desfase EN el candidato; el segundo es el de la medianoche (medido en 2021-04-04, 2021-10-31,
  // 2022-04-03 y 2022-10-30 — preguntar una sola vez a mediodía erraba una hora en los cuatro).
  const candidato = new Date(
    `${dia}T00:00:00.000${desfaseDelNegocio(new Date(`${dia}T12:00:00.000Z`))}`,
  );
  return new Date(`${dia}T00:00:00.000${desfaseDelNegocio(candidato)}`);
}

/**
 * El día de HOY **del negocio**, a medianoche UTC — la base contra la que se mide la ventana de
 * captura y el «hoy» de todo lo que compara contra columnas `@db.Date`.
 *
 * ⭐ **EL HUSO, ARREGLADO EN LA FILA 0.174.** Hasta entonces el ancla era el día **UTC**
 * (`new Date()` a medianoche UTC), heredado de F7-E4. El servidor corre en UTC y la gente captura
 * en México (−06:00, sin horario de verano desde 2022), así que **entre las 18:00 y las 23:59 de
 * allá el día UTC ya había avanzado**: *«nunca una fecha futura»* dejaba pasar el día SIGUIENTE y la
 * ventana valía un día de menos. Ahora el ancla es {@link hoyDelNegocio} —la MISMA que usa el
 * periodo de LECTURA del kardex—, así que el sistema tiene **un solo «hoy»**.
 *
 * 📌 **Fila 0.230 — subió aquí desde `comun/fecha-capturable.ts`** (que lo re-exporta), y aceptó un
 * `ahora` inyectable: lo necesitaron también el semáforo y la bandeja de la RC, el Resumen, la
 * cancelación del kardex y la de CxC/CxP, la lista de precios y la cotización — que fechaban «hoy»
 * con el día UTC y, por la tarde, escribían o comparaban contra MAÑANA.
 *
 * Se devuelve a **medianoche UTC** porque así es como se guardan las columnas `@db.Date` y así
 * llegan las fechas que hay que comparar: el huso decide QUÉ día es hoy, no cómo se representa.
 */
export function hoyDelNegocioUtc(ahora: Date = new Date()): Date {
  return diaDelNegocioUtc(ahora);
}

/**
 * El instante en que empieza el día SIGUIENTE a `fechaIso` en el negocio: el tope EXCLUSIVO de un
 * filtro «hasta el día X» sobre un sello de tiempo (`creadoEn < …`).
 */
export function inicioDelDiaSiguienteDelNegocio(fechaIso: string): Date {
  const siguiente = new Date(Date.parse(`${fechaIso.slice(0, 10)}T00:00:00.000Z`) + 86_400_000);
  return inicioDelDiaDelNegocio(siguiente.toISOString().slice(0, 10));
}
