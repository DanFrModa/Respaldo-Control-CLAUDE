import { toast } from 'sonner';

import { useFotoArte, useQuitarFotoArte, useSubirFotoArte, type Arte } from '@/api/artes';
import { SubidaImagen } from '@/componentes/SubidaImagen';

/**
 * Foto de UN arte del modelo (V1-E3d): conecta el componente REUTILIZABLE `SubidaImagen` con los
 * hooks de la foto del arte (presigned PUT/GET/DELETE). Solo se usa en EDICIÓN (necesita el arte
 * ya creado). Toasts de éxito/error (sonner).
 */
export function FotoArte({
  arte,
  deshabilitado = false,
}: {
  arte: Arte;
  deshabilitado?: boolean;
}): React.JSX.Element {
  const consulta = useFotoArte(arte.idModelo, arte.id);
  const subir = useSubirFotoArte();
  const quitar = useQuitarFotoArte();

  function alElegirArchivo(archivo: File): void {
    subir.mutate(
      { idModelo: arte.idModelo, idArte: arte.id, archivo },
      {
        onSuccess: () => toast.success('Foto actualizada.'),
        onError: (error) => toast.error(error.message),
      },
    );
  }

  function alQuitar(): void {
    quitar.mutate(
      { idModelo: arte.idModelo, idArte: arte.id },
      {
        onSuccess: () => toast.success('Foto eliminada.'),
        onError: (error) => toast.error(error.message),
      },
    );
  }

  // Error de lectura de la foto (la subida/borrado los reporta el toast).
  const errorLectura = consulta.isError ? consulta.error.message : null;

  return (
    <SubidaImagen
      urlImagen={consulta.data?.urlDescarga ?? null}
      textoAlt={`Foto de ${arte.nombre}`}
      alElegirArchivo={alElegirArchivo}
      alQuitar={alQuitar}
      subiendo={subir.isPending}
      quitando={quitar.isPending}
      deshabilitado={deshabilitado}
      error={errorLectura}
      textoPlaceholder="Sin foto"
      testid="foto-arte"
    />
  );
}
