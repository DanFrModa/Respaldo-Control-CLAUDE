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
  const legible = new Date(datosAl).toLocaleString('es-MX', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  return `Datos al: ${legible}`;
}

/** Formatea un número con hasta `dec` decimales (F7-E4 índices), o "—" si es null. */
export function numero(valor: number | null | undefined, dec = 2): string {
  if (valor === null || valor === undefined) {
    return '—';
  }
  return valor.toLocaleString('es-MX', { minimumFractionDigits: 0, maximumFractionDigits: dec });
}

/** Fecha ISO (AAAA-MM-DD) de un Date en zona local. */
function aIso(fecha: Date): string {
  const y = fecha.getFullYear();
  const m = String(fecha.getMonth() + 1).padStart(2, '0');
  const d = String(fecha.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Atajos de fecha de la captura móvil (F7-E4, doc 05 §A.1 "Hoy/Ayer/Sábado"). */
export const atajosFecha = {
  hoy(): string {
    return aIso(new Date());
  },
  ayer(): string {
    const f = new Date();
    f.setDate(f.getDate() - 1);
    return aIso(f);
  },
  /** El sábado más reciente (hoy si es sábado). */
  sabado(): string {
    const f = new Date();
    // getDay(): 0=domingo … 6=sábado. Retrocede al sábado anterior o de hoy.
    const dif = (f.getDay() - 6 + 7) % 7;
    f.setDate(f.getDate() - dif);
    return aIso(f);
  },
};
