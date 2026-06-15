import { toast } from 'sonner';

import {
  useFotoBordado,
  useQuitarFotoBordado,
  useSubirFotoBordado,
  type Bordado,
} from '@/api/bordados';
import { SubidaImagen } from '@/componentes/SubidaImagen';

/**
 * Foto de UN bordado: conecta el componente REUTILIZABLE `SubidaImagen` con los hooks
 * de la foto del bordado (presigned PUT/GET/DELETE). Es el "pegamento" especifico del
 * bordado; `SubidaImagen` queda generico para que F1-E4 (modelos) lo reutilice igual.
 *
 * Solo se usa en EDICION (necesita el id del bordado). Lee la URL de descarga
 * prefirmada (`useFotoBordado`), sube con `useSubirFotoBordado` (POST metadatos → PUT
 * a R2) y quita con `useQuitarFotoBordado`. Toasts de exito/error (sonner).
 */
export function FotoBordado({
  bordado,
  deshabilitado = false,
}: {
  bordado: Bordado;
  deshabilitado?: boolean;
}): React.JSX.Element {
  const consulta = useFotoBordado(bordado.id);
  const subir = useSubirFotoBordado();
  const quitar = useQuitarFotoBordado();

  function alElegirArchivo(archivo: File): void {
    subir.mutate(
      { idBordado: bordado.id, archivo },
      {
        onSuccess: () => toast.success('Foto actualizada.'),
        onError: (error) => toast.error(error.message),
      },
    );
  }

  function alQuitar(): void {
    quitar.mutate(bordado.id, {
      onSuccess: () => toast.success('Foto eliminada.'),
      onError: (error) => toast.error(error.message),
    });
  }

  // Error de lectura de la foto (la subida/borrado los reporta el toast).
  const errorLectura = consulta.isError ? consulta.error.message : null;

  return (
    <SubidaImagen
      urlImagen={consulta.data?.urlDescarga ?? null}
      textoAlt={`Foto de ${bordado.nombre}`}
      alElegirArchivo={alElegirArchivo}
      alQuitar={alQuitar}
      subiendo={subir.isPending}
      quitando={quitar.isPending}
      deshabilitado={deshabilitado}
      error={errorLectura}
      textoPlaceholder="Sin foto"
      testid="foto-bordado"
    />
  );
}
