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
  /** Renglones NO guardados de las secciones acotadas (título → cuántos se omitieron). */
  private readonly omitidosPorSeccion = new Map<string, number>();

  /** Agrega un renglón de detalle a una sección (la crea si no existe). */
  agregar(titulo: string, renglon: string): void {
    const seccion = this.secciones.get(titulo) ?? { titulo, renglones: [] };
    seccion.renglones.push(renglon);
    this.secciones.set(titulo, seccion);
  }

  /**
   * Igual que {@link agregar} pero ACOTADO: guarda como mucho `maxMuestra` renglones y del resto
   * solo lleva el CONTEO. Para descartes MASIVOS y ESPERADOS (p. ej. con la ventana activa, las
   * decenas de miles de filas de kardex de modelos/telas que quedaron fuera del set de USO): sin
   * esto el reporte se llena de miles de renglones que no son incidencias que revisar, solo la
   * consecuencia del filtro. El total SIEMPRE se ve.
   */
  agregarMuestra(titulo: string, renglon: string, maxMuestra = 20): void {
    const seccion = this.secciones.get(titulo) ?? { titulo, renglones: [] };
    if (seccion.renglones.length < maxMuestra) {
      seccion.renglones.push(renglon);
    } else {
      this.omitidosPorSeccion.set(titulo, (this.omitidosPorSeccion.get(titulo) ?? 0) + 1);
    }
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

  /** Total de renglones de incidencia (incluye los acotados que solo se contaron). */
  get totalIncidencias(): number {
    let total = 0;
    for (const s of this.secciones.values()) {
      total += s.renglones.length + (this.omitidosPorSeccion.get(s.titulo) ?? 0);
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
      // El TOTAL de la sección incluye lo que `agregarMuestra` solo contó (sin guardar).
      const soloContados = this.omitidosPorSeccion.get(s.titulo) ?? 0;
      partes.push('');
      partes.push(`── ${s.titulo} (${String(s.renglones.length + soloContados)}) ──`);
      // Acota el volcado para no inundar la consola; el conteo total siempre sale completo.
      const MAX = 50;
      for (const r of s.renglones.slice(0, MAX)) {
        partes.push(`  - ${r}`);
      }
      const noListados = Math.max(0, s.renglones.length - MAX) + soloContados;
      if (noListados > 0) {
        partes.push(`  … y ${String(noListados)} más (no listados; muestra acotada).`);
      }
    }
    return partes.join('\n');
  }
}
