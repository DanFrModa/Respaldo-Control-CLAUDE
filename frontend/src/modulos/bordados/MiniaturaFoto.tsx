import { ImageIcon } from 'lucide-react';

import { useFotoBordado } from '@/api/bordados';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/** Tamaños de la miniatura. */
type TamanoMiniatura = 'sm' | 'lg' | 'grande';

const CLASES_TAMANO: Record<TamanoMiniatura, string> = {
  sm: 'size-8 rounded-lg',
  lg: 'size-14 rounded-2xl',
  grande: 'size-40 rounded-xl',
};

const CLASES_ICONO: Record<TamanoMiniatura, string> = {
  sm: 'size-4',
  lg: 'size-6',
  grande: 'size-10',
};

/**
 * Miniatura de SOLO LECTURA de la foto de un bordado: pide la URL de descarga
 * prefirmada (`useFotoBordado`) y la muestra; si el bordado no tiene foto (o aun no
 * carga) muestra el placeholder NoFoto. Se usa en la lista, el detalle y la galeria
 * (de ahi los tres tamaños). No edita: subir/quitar vive en `FotoBordado` (dialogo).
 *
 * La consulta de la foto se cachea por id (TanStack Query), asi que la miniatura de la
 * lista y la del detalle del mismo bordado comparten la misma peticion.
 */
export function MiniaturaFoto({
  idBordado,
  nombre,
  tamano = 'sm',
}: {
  idBordado: number;
  nombre: string;
  tamano?: TamanoMiniatura;
}): React.JSX.Element {
  const consulta = useFotoBordado(idBordado);
  const url = consulta.data?.urlDescarga ?? null;

  if (consulta.isPending) {
    return <Skeleton className={cn('shrink-0', CLASES_TAMANO[tamano])} />;
  }

  if (url) {
    return (
      <img
        src={url}
        alt={`Foto de ${nombre}`}
        className={cn('shrink-0 border object-cover', CLASES_TAMANO[tamano])}
        data-testid="miniatura-foto"
        loading="lazy"
      />
    );
  }

  return (
    <span
      aria-hidden
      className={cn(
        'flex shrink-0 items-center justify-center border bg-muted text-muted-foreground',
        CLASES_TAMANO[tamano],
      )}
      data-testid="miniatura-sin-foto"
    >
      <ImageIcon className={CLASES_ICONO[tamano]} aria-hidden />
    </span>
  );
}
