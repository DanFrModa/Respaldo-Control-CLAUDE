import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import { Toaster as Sonner, type ToasterProps } from 'sonner';

import { useTema } from '@/useTema';

/**
 * Contenedor de notificaciones (toasts) de sonner, integrado con el tema de
 * CONTROL v2: en vez de `next-themes` (que no usamos), toma el tema claro/oscuro
 * de `useTema` para que el toast combine con la app. Los iconos y los colores se
 * mapean a los tokens de shadcn (`--popover`, `--border`, `--radius`).
 */
function Toaster({ ...props }: ToasterProps) {
  const { tema } = useTema();

  return (
    <Sonner
      theme={tema === 'oscuro' ? 'dark' : 'light'}
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
          '--border-radius': 'var(--radius)',
        } as React.CSSProperties
      }
      {...props}
    />
  );
}

export { Toaster };
