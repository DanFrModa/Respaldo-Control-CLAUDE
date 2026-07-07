import { CalendarClock, type LucideIcon } from 'lucide-react';

import { formatearFechaHora } from '@/lib/formato';
import { cn } from '@/lib/utils';

/**
 * Piezas de presentacion del panel de DETALLE (rediseño R1: verde y denso). El motor
 * `ListaDetalle` arma el armazon (hero + acciones); cada pantalla compone el cuerpo
 * con estas piezas para que todos los detalles se vean y lean igual:
 *
 *   - `SeccionDetalle`  título (+ icono) que agrupa campos.
 *   - `RejillaCampos`   rejilla de 2 columnas para los campos.
 *   - `CampoDetalle`    etiqueta + valor, con chip de icono (bg-primary-soft).
 *   - `ValorVacio`      placeholder "—" para campos sin dato.
 *   - `Historial`       creadoEn / modificadoEn formateados (es-MX).
 */

/** Placeholder de "sin dato" (mismo guion largo en toda la UI). */
export function ValorVacio(): React.JSX.Element {
  return <span className="text-muted-foreground">—</span>;
}

/** Una seccion del detalle: título (+ icono opcional) y su contenido. */
export function SeccionDetalle({
  titulo,
  icono: Icono,
  children,
  className,
}: {
  titulo: string;
  icono?: LucideIcon;
  children: React.ReactNode;
  className?: string;
}): React.JSX.Element {
  return (
    <section className={cn('space-y-3', className)}>
      <h3 className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        {Icono ? <Icono className="size-4" aria-hidden /> : null}
        {titulo}
      </h3>
      {children}
    </section>
  );
}

/** Rejilla de 2 columnas (1 en movil) para los campos de una seccion. */
export function RejillaCampos({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}): React.JSX.Element {
  return <div className={cn('grid grid-cols-1 gap-3 sm:grid-cols-2', className)}>{children}</div>;
}

/**
 * Un campo del detalle: chip de icono (bg-primary-soft) + etiqueta + valor. El
 * valor puede ser texto o cualquier nodo (badges, etc.); si no hay valor, usa
 * `<ValorVacio />`. `anchoCompleto` ocupa las dos columnas de la rejilla.
 */
export function CampoDetalle({
  icono: Icono,
  etiqueta,
  children,
  anchoCompleto = false,
}: {
  icono: LucideIcon;
  etiqueta: string;
  children: React.ReactNode;
  anchoCompleto?: boolean;
}): React.JSX.Element {
  return (
    <div className={cn('flex items-start gap-2.5', anchoCompleto && 'sm:col-span-2')}>
      <span
        aria-hidden
        className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary-soft-foreground"
      >
        <Icono className="size-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <dt className="text-xs text-muted-foreground">{etiqueta}</dt>
        <dd className="mt-0.5 text-sm break-words">{children}</dd>
      </div>
    </div>
  );
}

/**
 * Seccion de "Historial": fechas de creacion y ultima modificacion, formateadas
 * en es-MX. Las entidades del API traen `creadoEn` / `modificadoEn` como cadenas
 * ISO; aqui se vuelven legibles (faltante/invalida -> "—").
 */
export function Historial({
  creadoEn,
  modificadoEn,
}: {
  creadoEn: string | null | undefined;
  modificadoEn: string | null | undefined;
}): React.JSX.Element {
  return (
    <SeccionDetalle titulo="Historial" icono={CalendarClock}>
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <dt className="text-xs text-muted-foreground">Creado</dt>
          <dd className="mt-0.5 text-sm">{formatearFechaHora(creadoEn)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Última modificación</dt>
          <dd className="mt-0.5 text-sm">{formatearFechaHora(modificadoEn)}</dd>
        </div>
      </dl>
    </SeccionDetalle>
  );
}
