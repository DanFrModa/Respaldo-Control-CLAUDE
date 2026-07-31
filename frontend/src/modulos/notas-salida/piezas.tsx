import type { EstatusNotaSalida, NotaSalida, NotaSalidaLinea } from '@/api/tipos';
import type { TonoEstado } from '@/components/dominio/ChipEstado';

/**
 * Piezas compartidas del módulo NOTAS DE SALIDA (F4-E5, re-vestidas R9): el tono del chip de
 * estatus y los helpers de presentación que reusan el listado, la captura y las consultas. SOLO
 * presentación (A1): el estatus lo controla el backend (borrador → confirmada / cancelada); aquí
 * únicamente se pinta.
 */

/** Tono del `ChipEstado` por estatus (proto `notaBadge`; lo comparten listado y consultas R9). */
export const TONO_ESTATUS_NOTA: Record<EstatusNotaSalida, { tono: TonoEstado; texto: string }> = {
  borrador: { tono: 'warn', texto: 'Borrador' },
  confirmada: { tono: 'ok', texto: 'Confirmada' },
  cancelada: { tono: 'crit', texto: 'Cancelada' },
};

/** Folios ÚNICOS de las órdenes surtidas por una nota (derivación de la propia fila, proto `notaOrdenes`). */
export function ordenesDeNota(nota: NotaSalida): number[] {
  const folios = new Set<number>();
  for (const linea of nota.lineas) {
    if (linea.folioOrden !== null) {
      folios.add(linea.folioOrden);
    }
  }
  return [...folios];
}

/** Formatea una fecha date-only `YYYY-MM-DD` como "20 jun 2026" sin desfase de zona. */
export function fechaCortaNota(valor: string | null): string {
  if (valor === null || valor === '') {
    return '—';
  }
  const [a, m, d] = valor.split('-').map(Number);
  if (a === undefined || m === undefined || d === undefined) {
    return '—';
  }
  return new Date(a, m - 1, d).toLocaleDateString('es-MX', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** Descripción legible del material de un renglón (avío o tela + lote). */
export function descripcionMaterialNota(linea: NotaSalidaLinea): string {
  if (linea.tipo === 'avio') {
    return linea.avio ?? 'Avío sin nombre';
  }
  const tela = linea.tela ?? 'Tela';
  return linea.loteClave !== null ? `${tela} · lote ${linea.loteClave}` : tela;
}
