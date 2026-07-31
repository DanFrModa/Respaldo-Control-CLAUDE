/**
 * Utilidades compartidas de los IMPRESOS de indicadores (F7-E3, R9). Los impresos REUSAN los
 * servicios de dominio (`kpis.ts`) — la lógica NO se duplica (A1: A9 y el permiso ya los aplica el
 * dominio). Aquí solo el formato y la razón social del encabezado.
 */
import type { SesionUsuario } from '../../../comun/permisos.js';
import { clienteLectura, type ContextoBd } from '../../../comun/transaccion.js';

/** Razón social (o nombre) de la empresa activa para el encabezado del impreso. */
export async function razonSocialEmpresa(sesion: SesionUsuario, bd?: ContextoBd): Promise<string> {
  const empresa = await clienteLectura(bd).empresa.findUnique({
    where: { id: sesion.idEmpresaActiva },
    select: { razonSocial: true, nombre: true },
  });
  return empresa?.razonSocial ?? empresa?.nombre ?? sesion.nombreEmpresaActiva;
}

/** Formatea una fracción (0.30) como porcentaje ("30.0%") o "—" si es null. */
export function pct(fraccion: number | null): string {
  if (fraccion === null) return '—';
  return `${(fraccion * 100).toLocaleString('es-MX', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}%`;
}

/** Formatea un número (o "—" si es null); con 1 decimal para promedios de días. */
export function num1(valor: number | null): string {
  if (valor === null) return '—';
  return valor.toLocaleString('es-MX', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/** Nombres de mes en español (índice 1 = Enero). */
export function etiquetaMes(mes: number): string {
  const meses = [
    'Ene',
    'Feb',
    'Mar',
    'Abr',
    'May',
    'Jun',
    'Jul',
    'Ago',
    'Sep',
    'Oct',
    'Nov',
    'Dic',
  ];
  return meses[mes - 1] ?? String(mes);
}
