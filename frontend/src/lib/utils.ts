import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Une clases de Tailwind resolviendo conflictos (la ultima gana). Convencion de
 * shadcn/ui: `clsx` arma la lista condicional y `tailwind-merge` deduplica
 * utilidades en conflicto (p. ej. `px-2 px-4` -> `px-4`).
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * Botón de icono de la topbar (proto `.icon-btn`, fidelidad R9): 32px, radio
 * 8px, icono atenuado que al hover recupera texto + fondo `--hover` + borde.
 * Lo comparten el colapso del riel, la campana de alertas RC y el alternador
 * de tema para que la barra superior se vea EXACTAMENTE como el prototipo.
 */
export const claseBotonIcono =
  'grid size-8 shrink-0 cursor-pointer place-items-center rounded-[8px] border border-transparent ' +
  'text-muted-foreground transition-colors hover:border-border hover:bg-muted hover:text-foreground';
