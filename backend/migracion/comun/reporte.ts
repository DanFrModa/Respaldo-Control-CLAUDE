/**
 * Acumulador del REPORTE de la migración (F1-E6).
 *
 * Junta, mientras corre el ETL, dos cosas:
 *  • Las INCONSISTENCIAS para decisión de Gabriel/Daniel (§7: NO se arreglan en silencio):
 *    telas no-mapeadas en ambos sentidos, proveedores sin match de avíos, cadenas de talla
 *    raras, colores dudosos (A/B), homónimos de terceros, bordados duplicados, temporadas
 *    pendientes, empresas inactivas no migradas, etc.
 *  • Notas/decisiones informativas (provisionales, supuestos aplicados…).
 *
 * El reporte de CUADRE (conteos v1 CSV vs v2 Postgres) se calcula APARTE, en runtime, por
 * `cuadre.ts` (nunca números a mano). Este acumulador es el lado cualitativo (las listas).
 */

/** Una incidencia agrupada por tema, con sus renglones de detalle. */
export interface SeccionReporte {
  /** Título del tema (p. ej. "Telas sin TelaDis mapeable"). */
  titulo: string;
  /** Renglones de detalle (texto libre, ya formateado). */
  renglones: string[];
}

/** Acumula incidencias y notas del ETL para volcarlas al final. */
export class Reporte {
  private readonly secciones = new Map<string, SeccionReporte>();
  private readonly notas: string[] = [];

  /** Agrega un renglón de detalle a una sección (la crea si no existe). */
  agregar(titulo: string, renglon: string): void {
    const seccion = this.secciones.get(titulo) ?? { titulo, renglones: [] };
    seccion.renglones.push(renglon);
    this.secciones.set(titulo, seccion);
  }

  /** Nota/decisión informativa (no es una incidencia que requiera arreglo). */
  nota(texto: string): void {
    this.notas.push(texto);
  }

  /** ¿Hay alguna incidencia registrada? */
  get tieneIncidencias(): boolean {
    return this.secciones.size > 0;
  }

  /** Total de renglones de incidencia (todas las secciones). */
  get totalIncidencias(): number {
    let total = 0;
    for (const s of this.secciones.values()) {
      total += s.renglones.length;
    }
    return total;
  }

  /** Devuelve las secciones (para tests o para el volcado). */
  obtenerSecciones(): SeccionReporte[] {
    return [...this.secciones.values()];
  }

  /** Devuelve las notas. */
  obtenerNotas(): string[] {
    return [...this.notas];
  }

  /** Construye el texto del reporte (consola/archivo). */
  aTexto(): string {
    const partes: string[] = [];
    partes.push('═══════════════════════════════════════════════════════════════');
    partes.push(' REPORTE DE LA MIGRACIÓN F1-E6 — incidencias para decisión');
    partes.push('═══════════════════════════════════════════════════════════════');
    if (this.notas.length > 0) {
      partes.push('');
      partes.push('NOTAS / DECISIONES:');
      for (const n of this.notas) {
        partes.push(`  • ${n}`);
      }
    }
    if (this.secciones.size === 0) {
      partes.push('');
      partes.push('Sin incidencias registradas.');
      return partes.join('\n');
    }
    for (const s of this.secciones.values()) {
      partes.push('');
      partes.push(`── ${s.titulo} (${String(s.renglones.length)}) ──`);
      // Acota el volcado para no inundar la consola; el conteo total siempre sale completo.
      const MAX = 50;
      for (const r of s.renglones.slice(0, MAX)) {
        partes.push(`  - ${r}`);
      }
      if (s.renglones.length > MAX) {
        partes.push(`  … y ${String(s.renglones.length - MAX)} más.`);
      }
    }
    return partes.join('\n');
  }
}
