import type { SemaforoRc } from '@/api/tipos';

/**
 * Piezas compartidas (COMPONENTES) de las vistas del MOTOR de la Ruta Crítica (F5-E5): el SEMÁFORO
 * tri-estado (`aTiempo` / `enRiesgo` / `atrasado`) que pintan la bandeja, la RC por orden y el badge
 * del header. CERO lógica de negocio (A1): el valor lo DERIVA el backend; aquí solo se PRESENTA.
 */

/** Color del punto del semáforo por estado (emerald / amber / red). */
const COLOR_SEMAFORO_RC: Record<SemaforoRc, string> = {
  aTiempo: 'bg-emerald-500',
  enRiesgo: 'bg-amber-500',
  atrasado: 'bg-red-600',
};

/** Etiqueta legible del semáforo (para el texto/aria). */
const ETIQUETA_SEMAFORO_RC: Record<SemaforoRc, string> = {
  aTiempo: 'A tiempo',
  enRiesgo: 'En riesgo',
  atrasado: 'Atrasado',
};

/**
 * Indicador de SEMÁFORO de cumplimiento de un proceso/orden de la RC: un punto de color + la
 * etiqueta. El valor lo DERIVA el backend (HOY vs fecha planeada vigente); aquí solo se pinta.
 * Con `soloPunto` se omite el texto (para listas muy densas).
 */
export function Semaforo({
  semaforo,
  soloPunto = false,
}: {
  semaforo: SemaforoRc;
  soloPunto?: boolean;
}): React.JSX.Element {
  return (
    <span
      className="inline-flex items-center gap-1.5 text-sm"
      data-testid="semaforo-rc"
      data-semaforo={semaforo}
      title={ETIQUETA_SEMAFORO_RC[semaforo]}
    >
      <span
        aria-hidden
        className={`inline-block size-2.5 shrink-0 rounded-full ${COLOR_SEMAFORO_RC[semaforo]}`}
      />
      {soloPunto ? (
        <span className="sr-only">{ETIQUETA_SEMAFORO_RC[semaforo]}</span>
      ) : (
        ETIQUETA_SEMAFORO_RC[semaforo]
      )}
    </span>
  );
}

/**
 * Formatea una fecha de la RC como "13 jun 2026" SIN desfase de zona (no usa `new Date(iso)`, que
 * interpreta el datetime como UTC y puede correr el día). Acepta tanto date-only `YYYY-MM-DD` como
 * datetime ISO completo `YYYY-MM-DDTHH:mm:ss.sssZ` (el contrato serializa las fechas con
 * `z.iso.datetime()`): toma solo los primeros 10 caracteres (la parte de fecha) antes de parsear.
 * `null` / vacío / fecha inválida -> "—".
 */
export function fechaRc(valor: string | null | undefined): string {
  if (valor === null || valor === undefined || valor === '') {
    return '—';
  }
  const soloFecha = valor.slice(0, 10);
  const [a, m, d] = soloFecha.split('-').map(Number);
  if (
    a === undefined ||
    m === undefined ||
    d === undefined ||
    Number.isNaN(a) ||
    Number.isNaN(m) ||
    Number.isNaN(d)
  ) {
    return '—';
  }
  return new Date(a, m - 1, d).toLocaleDateString('es-MX', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}
