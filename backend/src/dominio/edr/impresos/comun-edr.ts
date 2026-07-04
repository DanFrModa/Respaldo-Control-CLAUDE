/**
 * Helpers COMUNES de los impresos del EDR (F7-E2). El EDR es CONSOLIDADO (todas las empresas
 * `paraEdr`), así que el "membrete" no es la empresa activa: se usa la razón social de la empresa
 * favorita (o el nombre genérico de CONTROL v2 como respaldo).
 */
import type { ContextoBd } from '../../../comun/transaccion.js';
import { clienteLectura } from '../../../comun/transaccion.js';

/** Nombres de mes en español (índice 1-12). */
export const MESES_ES = [
  '',
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
] as const;

/** Etiqueta legible de un periodo (mes año). */
export function etiquetaPeriodo(anio: number, mes: number): string {
  return `${MESES_ES[mes] ?? mes} ${anio}`;
}

/** Formatea un importe en pesos MXN. */
export function pesos(n: number): string {
  return `$${n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Membrete del impreso consolidado: razón social (o nombre) de la empresa FAVORITA que participe en el
 * EDR; si no hay ninguna, "CONTROL v2".
 */
export async function membreteConsolidado(bd?: ContextoBd): Promise<string> {
  const empresa = await clienteLectura(bd).empresa.findFirst({
    where: { paraEdr: true },
    orderBy: [{ favorita: 'desc' }, { id: 'asc' }],
    select: { razonSocial: true, nombre: true },
  });
  if (empresa === null) return 'CONTROL v2';
  return empresa.razonSocial ?? empresa.nombre;
}
