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
