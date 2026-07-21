/**
 * SALDOS INICIALES de la ventana temporal del ETL (recarga desde un corte, plan §7).
 *
 * Problema: en v2 la existencia es la SUMA de movimientos del kardex (D3). Si la ventana temporal
 * simplemente OMITE los movimientos anteriores al corte, las existencias quedan MAL (faltaría todo
 * el neto histórico). La solución: cada loader de kardex, con ventana ACTIVA, ACUMULA en memoria los
 * renglones pre-corte por su COMBINACIÓN de inventario (PT: empresa×almacén×modelo; telas:
 * tela×lote×almacén) con signo según la dirección, y al final crea UN movimiento SINTÉTICO por combo
 * con fecha = corte cuyo importe es el NETO (entradas − salidas) de todo lo anterior. Invariante:
 * existencia final por combo con ventana activa === existencia migrando todo el histórico.
 *
 * Este módulo es la parte PURA y COMPARTIDA (sin BD): el acumulador por combo y el predicado
 * "¿pre-corte?". Con ventana INACTIVA (default) `esPreCorte` siempre es `false` → ningún loader
 * acumula nada y el comportamiento actual no cambia en nada.
 */
import { dentroVentana, type ConfigVentana } from './ventana.js';

/** Dirección efectiva de un renglón para el neto (el traspaso se descompone en sus dos patas). */
export type DireccionSaldo = 'entrada' | 'salida';

/** El neto acumulado de UN combo de inventario (más contadores para el reporte). */
export interface SaldoCombo<K> {
  /** Clave estable del combo (también ordena el volcado, para corridas deterministas). */
  clave: string;
  /** Los ids del combo (los define cada loader: PT ≠ telas). */
  datos: K;
  /** Neto = Σ entradas − Σ salidas (puede ser negativo o cero). */
  neto: number;
  /** Σ de cantidades de entrada acumuladas. */
  entradas: number;
  /** Σ de cantidades de salida acumuladas. */
  salidas: number;
  /** # de renglones pre-corte que aportaron al combo. */
  renglones: number;
}

/**
 * Acumulador en memoria de los renglones PRE-CORTE, por combo. Solo debe recibir lo que se HABRÍA
 * migrado (los renglones que hoy se omiten por datos inválidos siguen omitiéndose y NO entran al
 * neto — esa criba la hace el loader ANTES de llamar a `agregar`).
 */
export class AcumuladorSaldos<K> {
  private readonly mapa = new Map<string, SaldoCombo<K>>();

  /** Suma un renglón pre-corte al combo `clave` (lo crea si no existía). `cantidad` POSITIVA. */
  agregar(clave: string, datos: K, direccion: DireccionSaldo, cantidad: number): void {
    const combo = this.mapa.get(clave) ?? {
      clave,
      datos,
      neto: 0,
      entradas: 0,
      salidas: 0,
      renglones: 0,
    };
    if (direccion === 'entrada') {
      combo.neto += cantidad;
      combo.entradas += cantidad;
    } else {
      combo.neto -= cantidad;
      combo.salidas += cantidad;
    }
    combo.renglones += 1;
    this.mapa.set(clave, combo);
  }

  /** # de combos tocados. */
  get combos(): number {
    return this.mapa.size;
  }

  /** # total de renglones acumulados (todas las combinaciones). */
  get renglones(): number {
    let total = 0;
    for (const c of this.mapa.values()) total += c.renglones;
    return total;
  }

  /**
   * Los saldos por combo, ORDENADOS por clave (corridas deterministas). Incluye los de neto 0 —
   * el llamador decide (un combo que cierra en cero NO genera movimiento sintético).
   */
  saldos(): SaldoCombo<K>[] {
    return [...this.mapa.values()].sort((a, b) => (a.clave < b.clave ? -1 : 1));
  }
}

/**
 * ¿El renglón es PRE-CORTE (debe condensarse en el saldo inicial en vez de migrar individual)?
 * Con ventana INACTIVA (`corte === null`) SIEMPRE `false` (nada cambia). Una fecha `null` también
 * da `false`: la fila sin fecha sigue el camino normal del loader (que ya decide qué hacer con ella).
 */
export function esPreCorte(fecha: Date | null, ventana: ConfigVentana): boolean {
  if (ventana.corte === null || fecha === null) return false;
  return !dentroVentana(fecha, ventana);
}

/** Observación estándar del movimiento sintético de saldo inicial (todos los loaders la reúsan). */
export function observacionSaldoInicial(detalle: string): string {
  return `Saldo inicial de migración (histórico previo al corte condensado): ${detalle}`;
}
