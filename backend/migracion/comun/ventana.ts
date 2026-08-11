/**
 * Ventana temporal del ETL (F4-E6, plan §7 — "ventana de 10 años"; ampliada en §Post-F9.24).
 *
 * El plan pide que la migración aplique una VENTANA por fecha y REPORTE lo que queda fuera (nada se
 * descarta en silencio, §7). Hay DOS formas de decir cuál es esa ventana, y ambas conviven:
 *
 *  • `ETL_DESDE` (**año**, p. ej. `2025`) — el corte es el **1 de enero de ese año**. Es el que
 *    manda hoy: Daniel y Gabriel decidieron (10-ago-2026) que **la migración lleva solo 2025 y
 *    2026**, así que `ETL_DESDE=2025` describe esa decisión tal cual, sin depender de qué día se
 *    corra el ETL.
 *  • `ETL_VENTANA_ANIOS` (entero ≥0) + `ETL_VENTANA_REF` (fecha ancla, default HOY) — la forma
 *    original: "los últimos N años". Se conserva para no romper corridas ya documentadas.
 *
 * Si vienen las dos, **gana `ETL_DESDE`** (es una fecha explícita; la otra es relativa a cuándo se
 * corra). Sin ninguna, la ventana **NO recorta** y se migra todo el histórico, como hasta F4.
 *
 * El reporte de cuadre SIEMPRE imprime la configuración de la ventana y el conteo excluido (0 por
 * defecto), así Gabriel ve explícito qué quedó fuera por edad — aunque sea cero.
 */

import type { FilaCsv } from './csv.js';
import type { Reporte } from './reporte.js';
import { parsearFecha } from './valores.js';

/** Configuración resuelta de la ventana (de las variables de entorno o sus defaults). */
export interface ConfigVentana {
  /** Años de la ventana; 0 = sin recorte por antigüedad relativa. */
  anios: number;
  /** Instante de referencia (ancla) en ms epoch. */
  refMs: number;
  /** Fecha de corte: lo anterior se excluye. `null` = sin ventana. */
  corte: Date | null;
  /** Año de `ETL_DESDE` cuando fue esa variable la que fijó el corte; `0` si no se usó. */
  desdeAnio: number;
}

/**
 * Lee `ETL_DESDE` (año ≥1900; vacío/inválido → 0 = no aplica). Es el interruptor principal desde
 * §Post-F9.24: `ETL_DESDE=2025` migra solo de 2025 en adelante.
 */
export function leerDesdeAnio(): number {
  const crudo = (process.env.ETL_DESDE ?? '').trim();
  if (crudo === '') return 0;
  const n = Number(crudo);
  return Number.isInteger(n) && n >= 1900 ? n : 0;
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
  // `ETL_DESDE` gana: es una fecha explícita, no una relativa al día de la corrida.
  const desdeAnio = leerDesdeAnio();
  if (desdeAnio > 0) {
    return { anios, refMs, desdeAnio, corte: new Date(Date.UTC(desdeAnio, 0, 1, 0, 0, 0)) };
  }
  if (anios === 0) {
    return { anios, refMs, desdeAnio, corte: null };
  }
  const ref = new Date(refMs);
  const corte = new Date(
    Date.UTC(ref.getUTCFullYear() - anios, ref.getUTCMonth(), ref.getUTCDate(), 0, 0, 0),
  );
  return { anios, refMs, desdeAnio, corte };
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
    return 'Ventana temporal: DESACTIVADA — se migra todo el histórico. Para acotarla, corre el ETL con ETL_DESDE=2025.';
  }
  if (config.desdeAnio > 0) {
    return `Ventana temporal: SOLO de ${String(config.desdeAnio)} en adelante (ETL_DESDE) — se EXCLUYE todo lo anterior al 1-ene-${String(config.desdeAnio)}.`;
  }
  const ref = new Date(config.refMs).toISOString().slice(0, 10);
  const corte = config.corte.toISOString().slice(0, 10);
  return `Ventana temporal: ${String(config.anios)} años (ref=${ref}) — se EXCLUYE lo anterior a ${corte}.`;
}

/**
 * Deja pasar solo las filas de un CSV cuya fecha cae DENTRO de la ventana, y REPORTA cuántas y
 * cuáles quedaron fuera (plan §7: nada se descarta en silencio).
 *
 * Es el atajo para los loaders que recortan por la fecha del propio documento: en vez de hilar la
 * ventana por toda su maquinaria, filtran la lista de filas ANTES de procesarla.
 *
 * ⚠️ UNA FILA SIN FECHA LEGIBLE SE QUEDA. Es deliberado y va al revés que la depuración de
 * proveedores: ahí un tercero dudoso se vuelve a dar de alta en un minuto, pero un DOCUMENTO que se
 * tira no se recupera. Ante la duda con un documento, se migra y se reporta.
 *
 * @param filas       filas crudas del CSV.
 * @param campoFecha  columna con la fecha del documento (p. ej. `"Fecha"`).
 * @param ventana     configuración resuelta (`resolverVentana()`).
 * @param reporte     dónde se anota lo excluido.
 * @param etiqueta    nombre del documento para el reporte (p. ej. `"Órdenes"`).
 * @param idDeFila    cómo identificar la fila en el reporte (su id viejo).
 */
export function filtrarPorVentana(
  filas: FilaCsv[],
  campoFecha: string,
  ventana: ConfigVentana,
  reporte: Reporte,
  etiqueta: string,
  idDeFila: (fila: FilaCsv) => string,
): { dentro: FilaCsv[]; fuera: number } {
  if (ventana.corte === null) return { dentro: filas, fuera: 0 };

  const dentro: FilaCsv[] = [];
  let fuera = 0;
  for (const fila of filas) {
    // Sin fecha legible → se queda (ver el ⚠️ del TSDoc).
    if (dentroVentana(parsearFecha(fila[campoFecha]), ventana)) {
      dentro.push(fila);
      continue;
    }
    fuera += 1;
    reporte.agregar(
      `${etiqueta}: FUERA de la ventana temporal (anterior a ${ventana.corte.toISOString().slice(0, 10)})`,
      `${idDeFila(fila)} · ${(fila[campoFecha] ?? '').trim()}`,
    );
  }
  return { dentro, fuera };
}
