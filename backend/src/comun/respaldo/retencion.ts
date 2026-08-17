/**
 * RETENCIÓN de los respaldos en R2 (V1-E6a): qué se conserva y qué se borra.
 *
 * Función PURA a propósito (recibe la lista de objetos y la fecha, devuelve las keys a borrar): el
 * borrado es la ÚNICA operación destructiva de toda la etapa, así que la decisión de qué muere se
 * prueba en aislamiento, sin R2 y sin base de datos.
 *
 * LA REGLA, en una frase: **se conservan los N respaldos más nuevos (por defecto 12 = un año de
 * copias mensuales), y además NINGUNO de los últimos {@link DIAS_INTOCABLES} días se borra jamás.**
 *
 * Por qué se cuentan respaldos y no días, está explicado en `config.ts` (`RETENCION_DEFECTO`): la
 * frecuencia es configurable y una retención en días cambiaría en silencio cuántas copias hay.
 *
 * Y por qué existe además el piso de días: contar a secas tiene un flanco. Si alguien corre el
 * respaldo a mano varias veces seguidas —justo lo que va a pasar la semana en que se configure R2 y
 * haya que probarlo— trece corridas en una tarde empujarían fuera del tope los doce meses de
 * historia. El piso lo impide: los respaldos recientes no cuentan como candidatos, hagan los que
 * hagan. Un mes de gracia (35 días) cubre de sobra cualquier tanda de pruebas.
 *
 * Las reglas de seguridad que las envuelven:
 *  1. **Nunca se borra el respaldo recién subido**, aunque el reloj del servidor esté desfasado.
 *  2. **Nunca se borra el MÁS NUEVO.** Si por lo que sea todos fueran candidatos, se conserva el
 *     último: un respaldo viejo es infinitamente mejor que ninguno. Esta es la regla que impide que
 *     un bug de fechas o de conteo vacíe el bucket.
 *  3. **Solo se tocan objetos que son respaldos**, bajo el prefijo y con la extensión del formato.
 *  4. **Sin fecha, no se borra.** Un objeto que R2 devuelve sin `LastModified` no se puede ordenar,
 *     así que se conserva (fallar hacia el lado de conservar, nunca hacia el de borrar).
 */
import { EXTENSION_RESPALDO } from './config.js';

/**
 * Ningún respaldo de los últimos 35 días se borra, cuente lo que cuente la retención. Es un PISO de
 * seguridad, no un parámetro: por eso no se configura por entorno. 35 días = un mes con holgura, o
 * sea "la corrida de este mes y la del anterior están a salvo pase lo que pase".
 */
export const DIAS_INTOCABLES = 35;

/** Un objeto de respaldo tal como lo lista R2. */
export interface ObjetoRespaldo {
  /** Key completa dentro del bucket. */
  key: string;
  /** Cuándo lo escribió R2 (`LastModified`). Ausente si R2 no la reportó. */
  ultimaModificacion?: Date;
  /** Tamaño en bytes que reporta R2. */
  tamanoBytes?: number;
}

/** Parámetros de la decisión de retención. */
export interface OpcionesRetencion {
  /** Cuántos respaldos se conservan (los más nuevos). */
  retencion: number;
  /** Momento contra el que se mide la antigüedad (normalmente, ahora). */
  ahora: Date;
  /** Key del respaldo recién subido: jamás se borra (regla 1). */
  keyProtegida?: string;
}

/** ¿Esta key es un archivo de respaldo de los nuestros (regla 3)? */
export function esKeyDeRespaldo(key: string, prefijo: string): boolean {
  return key.startsWith(`${prefijo}/`) && key.endsWith(EXTENSION_RESPALDO);
}

/**
 * Devuelve las keys que YA pueden borrarse. El resultado va ordenado del más viejo al más nuevo
 * (borrar en ese orden deja el bucket coherente si el borrado se interrumpe a la mitad).
 *
 * @example
 * // Conservando 12 respaldos, borra el decimotercero y siguientes —salvo los del último mes:
 * seleccionarObsoletos(objetos, 'respaldos/bd', { retencion: 12, ahora: new Date(), keyProtegida });
 */
export function seleccionarObsoletos(
  objetos: readonly ObjetoRespaldo[],
  prefijo: string,
  opciones: OpcionesRetencion,
): string[] {
  // Reglas 3 y 4: solo respaldos nuestros, y solo los que traen fecha utilizable.
  const candidatos = objetos
    .filter((objeto) => esKeyDeRespaldo(objeto.key, prefijo))
    .filter(
      (objeto): objeto is ObjetoRespaldo & { ultimaModificacion: Date } =>
        objeto.ultimaModificacion instanceof Date &&
        !Number.isNaN(objeto.ultimaModificacion.getTime()),
    )
    .sort((uno, otro) => otro.ultimaModificacion.getTime() - uno.ultimaModificacion.getTime());

  if (candidatos.length <= opciones.retencion) {
    return []; // caben todos: nada que borrar.
  }

  const piso = opciones.ahora.getTime() - DIAS_INTOCABLES * 24 * 60 * 60 * 1000;

  return candidatos
    .slice(opciones.retencion) // se conservan los N más nuevos
    .filter((objeto) => objeto.key !== opciones.keyProtegida) // regla 1
    .filter((objeto) => objeto.key !== candidatos[0]?.key) // regla 2 (cinturón: nunca el más nuevo)
    .filter((objeto) => objeto.ultimaModificacion.getTime() < piso) // piso de días intocables
    .sort((uno, otro) => uno.ultimaModificacion.getTime() - otro.ultimaModificacion.getTime())
    .map((objeto) => objeto.key);
}

/**
 * Arma la key del respaldo de un instante dado: `<prefijo>/<año>/control-<sello>.dump.enc`, con el
 * sello en UTC y sin caracteres raros (`2026-08-17T080000Z`). Partirlo por año mantiene el bucket
 * navegable a mano cuando lleve años de respaldos, y el sello ordena alfabéticamente igual que
 * cronológicamente — que es como uno los quiere ver listados.
 */
export function claveRespaldo(prefijo: string, momento: Date): string {
  const iso = momento.toISOString(); // 2026-08-17T08:00:00.000Z
  const sello = `${iso.slice(0, 10)}T${iso.slice(11, 19).replaceAll(':', '')}Z`;
  return `${prefijo}/${iso.slice(0, 4)}/control-${sello}${EXTENSION_RESPALDO}`;
}
