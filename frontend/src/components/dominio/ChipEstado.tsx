import { cn } from '@/lib/utils';

/**
 * CHIPS DE ESTATUS uniformes del rediseño (proto `.badge`): pastilla redonda de
 * 20px con punto de color, sobre los tokens SEMANTICOS separados de la marca
 * (`--ok/--warn/--crit/--info` + sus `*-soft`). Toda la app expresa estados con
 * estos 5 tonos para que se lean igual en cualquier pantalla:
 *
 *   - `ok`      → bien / vigente / aprobado
 *   - `warn`    → atencion / en riesgo / parcial
 *   - `crit`    → critico / atrasado / rechazado
 *   - `info`    → informativo / en proceso
 *   - `neutro`  → estado valido pero apagado (NO alarma)
 *
 * Texto + punto: el estado nunca depende SOLO del color (accesibilidad).
 */

/** Tono semantico de un estado. */
export type TonoEstado = 'ok' | 'warn' | 'crit' | 'info' | 'neutro';

/** Clases fondo-suave + texto por tono (los `*-soft` vienen de los tokens). */
const CLASES_CHIP: Record<TonoEstado, string> = {
  ok: 'bg-ok-soft text-ok',
  warn: 'bg-warn-soft text-warn',
  crit: 'bg-crit-soft text-crit',
  info: 'bg-info-soft text-info',
  neutro: 'bg-muted text-muted-foreground',
};

/** Color del punto por tono (el neutro usa el terciario). */
const CLASES_PUNTO: Record<TonoEstado, string> = {
  ok: 'bg-ok',
  warn: 'bg-warn',
  crit: 'bg-crit',
  info: 'bg-info',
  neutro: 'bg-faint',
};

/**
 * Punto de estado decorativo (proto `.badge .d`): acompaña a un texto; no
 * transmite informacion por si solo.
 */
export function BadgePunto({
  tono,
  className,
}: {
  tono: TonoEstado;
  className?: string;
}): React.JSX.Element {
  return (
    <span
      aria-hidden
      data-slot="badge-punto"
      className={cn('inline-block size-1.5 shrink-0 rounded-full', CLASES_PUNTO[tono], className)}
    />
  );
}

/**
 * Chip de estatus: pastilla 20px + punto + texto. El texto lo da el llamador
 * (p. ej. "Aprobada", "En riesgo", "Cancelada"). `sinPunto` lo omite para chips
 * puramente clasificatorios.
 */
export function ChipEstado({
  tono,
  sinPunto = false,
  className,
  children,
  ...props
}: React.ComponentProps<'span'> & {
  tono: TonoEstado;
  sinPunto?: boolean;
}): React.JSX.Element {
  return (
    <span
      data-slot="chip-estado"
      data-tono={tono}
      className={cn(
        'inline-flex h-5 w-fit shrink-0 items-center gap-1.5 rounded-full px-2 text-xs font-semibold whitespace-nowrap',
        CLASES_CHIP[tono],
        className,
      )}
      {...props}
    >
      {sinPunto ? null : <BadgePunto tono={tono} />}
      {children}
    </span>
  );
}

/**
 * Semaforo de 3 luces (verde/ambar/rojo) para tableros: mismo molde que el chip
 * pero solo-punto, con etiqueta accesible obligatoria.
 */
export function Semaforo({
  tono,
  etiqueta,
  className,
}: {
  /** Solo los tonos de alerta del semaforo clasico. */
  tono: Extract<TonoEstado, 'ok' | 'warn' | 'crit'>;
  /** Texto accesible que describe el estado (el color no basta). */
  etiqueta: string;
  className?: string;
}): React.JSX.Element {
  return (
    <span
      data-slot="semaforo"
      data-tono={tono}
      role="img"
      aria-label={etiqueta}
      title={etiqueta}
      className={cn('inline-flex items-center', className)}
    >
      <span aria-hidden className={cn('size-2.5 rounded-full', CLASES_PUNTO[tono])} />
    </span>
  );
}
