/**
 * Helpers de presentación del módulo Indicadores (F7-E3). Módulo de DATOS (no componentes) para no
 * romper fast-refresh. Los KPIs vienen calculados y AGREGADOS del servidor; aquí solo se formatean.
 */

/** Formatea una fracción (0.30) como porcentaje ("30.0%"), o "—" si es null. */
export function porcentaje(fraccion: number | null | undefined): string {
  if (fraccion === null || fraccion === undefined) {
    return '—';
  }
  return `${(fraccion * 100).toLocaleString('es-MX', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}%`;
}

/** Formatea un número con 1 decimal (para promedios de días), o "—" si es null. */
export function dias(valor: number | null | undefined): string {
  if (valor === null || valor === undefined) {
    return '—';
  }
  return valor.toLocaleString('es-MX', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/** Formatea un entero (miles), o "0" si es null. */
export function entero(valor: number | null | undefined): string {
  return (valor ?? 0).toLocaleString('es-MX');
}

/** Nombres de mes en español (índice 0 = Enero). */
export const MESES = [
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

/** Etiqueta legible de un mes 1-12 + año. */
export function etiquetaMes(mes: number, anio: number): string {
  return `${MESES[mes - 1] ?? mes} ${anio}`;
}

/** Sello "datos al:" legible a partir del ISO (o aviso si nunca se calcularon). */
export function selloDatosAl(datosAl: string | null | undefined): string {
  if (datosAl === null || datosAl === undefined) {
    return 'Datos aún no calculados — usa Refrescar';
  }
  return `Datos al: ${new Date(datosAl).toLocaleString('es-MX')}`;
}
