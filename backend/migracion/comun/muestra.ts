/**
 * BUCKET AGREGADO con muestra acotada para el `Reporte` (ventana temporal, F5/F6/F7).
 *
 * Con la ventana temporal activa (`ETL_DESDE`/`ETL_VENTANA_ANIOS`), MILES de registros pueden quedar
 * excluidos por UNA misma causa (p. ej. "orden no migrada — fuera de ventana"). Listarlos uno a uno
 * inundaría el reporte y la memoria sin aportar nada a la decisión. Este acumulador junta el CONTEO
 * TOTAL + una muestra acotada (~10 por default) y al final vuelca UNA sección al reporte: el total
 * SIEMPRE queda explícito (nada se descarta en silencio, §7), pero el detalle se acota a la muestra.
 *
 * Sin acumulaciones (`conteo === 0`) el volcado es un no-op: con la ventana inactiva y sin filas
 * afectadas, el reporte queda idéntico al de siempre.
 */
import type { Reporte } from './reporte.js';

/** Acumula un conteo total + una muestra acotada de detalles, y lo vuelca como UNA sección. */
export class MuestraAgregada {
  private total = 0;
  private readonly muestra: string[] = [];

  constructor(private readonly maxMuestra = 10) {}

  /** Cuenta un registro; conserva el detalle solo si la muestra aún no está llena. */
  agregar(detalle: string): void {
    this.total += 1;
    if (this.muestra.length < this.maxMuestra) {
      this.muestra.push(detalle);
    }
  }

  /** Total acumulado (independiente del tamaño de la muestra). */
  get conteo(): number {
    return this.total;
  }

  /** Vuelca el bucket al reporte como una sección `titulo` (no-op si no acumuló nada). */
  volcar(reporte: Reporte, titulo: string): void {
    if (this.total === 0) {
      return;
    }
    reporte.agregar(
      titulo,
      `TOTAL = ${String(this.total)} registros (bucket agregado; muestra de ${String(this.muestra.length)}):`,
    );
    for (const m of this.muestra) {
      reporte.agregar(titulo, `muestra: ${m}`);
    }
  }
}
