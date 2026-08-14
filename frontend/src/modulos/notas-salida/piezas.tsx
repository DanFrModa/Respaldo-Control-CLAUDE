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

/**
 * Descripción legible del material de un renglón: avío, tela (+ lote) o —en un renglón MIGRADO del
 * sistema anterior— su TEXTO LIBRE (`descripcionLegacy`), que es lo único que ese renglón tiene.
 * Antes esos renglones caían en la rama de tela y salían como "Tela" a secas, con el material en
 * blanco: parecía que la migración había perdido el dato (V1-E3b).
 */
export function descripcionMaterialNota(linea: NotaSalidaLinea): string {
  if (linea.tipo === 'avio') {
    return linea.avio ?? 'Avío sin nombre';
  }
  if (linea.tipo === 'historico') {
    return linea.descripcionLegacy ?? 'Renglón migrado sin descripción';
  }
  const tela = linea.tela ?? 'Tela';
  return linea.loteClave !== null ? `${tela} · lote ${linea.loteClave}` : tela;
}

/** Etiqueta del badge de tipo de renglón (honesta: «Migrado» no es un material). */
export function etiquetaTipoRenglonNota(tipo: NotaSalidaLinea['tipo']): string {
  if (tipo === 'avio') return 'Avío';
  return tipo === 'tela' ? 'Tela' : 'Migrado';
}

/**
 * Cantidad legible de un renglón. Un renglón MIGRADO trae `cantidad = 0` porque el sistema viejo
 * NO desglosaba cantidad por renglón (`dominio/notas/migracion.ts`) — pintar "0" afirmaría que se
 * enviaron cero piezas, que es distinto de "no se sabe". Por eso ahí va un guion.
 */
export function cantidadRenglonNota(linea: NotaSalidaLinea): string {
  if (linea.tipo === 'historico' && linea.cantidad === 0) {
    return '—';
  }
  return linea.cantidad.toLocaleString('es-MX');
}
