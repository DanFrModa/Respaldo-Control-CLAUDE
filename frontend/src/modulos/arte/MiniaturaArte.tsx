import { ImageIcon } from 'lucide-react';

import { useFotoArte } from '@/api/artes';
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
 * Miniatura de SOLO LECTURA de la foto de un ARTE del modelo (V1-E3d): pide la URL de descarga
 * prefirmada (`useFotoArte`) y la muestra; si el arte no tiene foto (o aún no carga) muestra el
 * placeholder NoFoto. La usan la galería y el editor de arte del modelo (de ahí los tres tamaños).
 * No edita: subir/quitar vive en `FotoArte`.
 *
 * Cuando el arte NO tiene foto (`tieneFoto=false`) ni siquiera se pide la URL: el listado ya trae
 * `idArchivoFoto`, así que la galería no dispara una petición por celda vacía.
 */
export function MiniaturaArte({
  idModelo,
  idArte,
  nombre,
  tieneFoto,
  tamano = 'sm',
}: {
  idModelo: number;
  idArte: number;
  nombre: string;
  tieneFoto: boolean;
  tamano?: TamanoMiniatura;
}): React.JSX.Element {
  const consulta = useFotoArte(tieneFoto ? idModelo : undefined, tieneFoto ? idArte : undefined);
  const url = consulta.data?.urlDescarga ?? null;

  if (tieneFoto && consulta.isPending) {
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
