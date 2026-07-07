import { ChipEstado } from '@/components/dominio/ChipEstado';
import { avatarPorTono, CLASES_BADGE_TONO, iniciales, type Tono } from '@/lib/tono';
import { cn } from '@/lib/utils';

/**
 * Componentes visuales de dominio (rediseño R1 verde): avatar, chip de tipo y
 * badge/punto de estado, con colores EXPLICATIVOS que ayudan a gente no tecnica a
 * leer la pantalla de un vistazo. Los tonos y sus clases viven en `@/lib/tono`
 * (funciones puras, separadas para no romper fast-refresh); aqui solo componentes.
 *
 * Estado (sobre los tokens semanticos, via `ChipEstado`):
 *   - Activo   → verde `--ok` con punto (estado sano, vigente)
 *   - Inactivo → gris atenuado (estado valido pero apagado, NO alarma)
 */

/** Re-export del tono para que las paginas importen tipo y componentes de un lugar. */
export type { Tono };

/** Tamaños del avatar. */
type TamanoAvatar = 'sm' | 'md' | 'lg';

const AVATAR_TAMANO: Record<TamanoAvatar, string> = {
  sm: 'size-8 rounded-lg text-xs',
  md: 'size-10 rounded-xl text-sm',
  lg: 'size-14 rounded-2xl text-lg',
};

/**
 * Avatar de una entidad: cuadro con degradado por tono y, por defecto, las
 * iniciales del nombre. Si se pasan `children` (p. ej. un icono) se muestran en su
 * lugar. Decorativo (`aria-hidden`): el nombre ya esta en el texto contiguo.
 */
export function Avatar({
  nombre,
  tono,
  tamano = 'md',
  children,
  className,
}: {
  nombre: string;
  tono: Tono;
  tamano?: TamanoAvatar;
  children?: React.ReactNode;
  className?: string;
}): React.JSX.Element {
  return (
    <span
      aria-hidden
      className={cn(
        'flex shrink-0 items-center justify-center font-semibold shadow-sm',
        AVATAR_TAMANO[tamano],
        avatarPorTono(tono),
        className,
      )}
    >
      {children ?? iniciales(nombre)}
    </span>
  );
}

/**
 * Chip de tipo (material/catalogo) con color explicativo por tono. El texto lo da
 * el llamador (p. ej. la etiqueta en español del tipo de proveedor).
 */
export function TipoBadge({
  tono,
  children,
  className,
}: {
  tono: Tono;
  children: React.ReactNode;
  className?: string;
}): React.JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex h-5 w-fit shrink-0 items-center rounded-full px-2 text-xs font-medium whitespace-nowrap',
        CLASES_BADGE_TONO[tono],
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * Punto de estado (activo verde `--ok` / inactivo gris). Decorativo: acompaña a
 * un texto de estado o al nombre en la lista; no transmite informacion por si
 * solo.
 */
export function EstadoPunto({
  activo,
  className,
}: {
  activo: boolean;
  className?: string;
}): React.JSX.Element {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-block size-2 shrink-0 rounded-full',
        activo ? 'bg-ok' : 'bg-faint',
        className,
      )}
    />
  );
}

/**
 * Badge de estado de borrado suave: "Activo" (verde con punto) o "Inactivo"
 * (gris atenuado). El inactivo es un estado VALIDO, no una alarma (por eso gris y
 * no rojo). Construido sobre el `ChipEstado` del rediseño (tokens semanticos).
 */
export function EstadoBadge({
  activo,
  className,
}: {
  activo: boolean;
  className?: string;
}): React.JSX.Element {
  return (
    <ChipEstado tono={activo ? 'ok' : 'neutro'} className={className}>
      {activo ? 'Activo' : 'Inactivo'}
    </ChipEstado>
  );
}
