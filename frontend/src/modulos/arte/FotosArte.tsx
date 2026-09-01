import { ImageIcon, Loader2Icon, Trash2Icon } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import {
  useFotosArte,
  useQuitarFotoArte,
  useSubirFotoArte,
  type Arte,
  type ArteFoto,
} from '@/api/artes';
import { SubidaImagen } from '@/componentes/SubidaImagen';
import { VisorImagen } from '@/componentes/VisorImagen';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * FOTOS de UN arte del modelo — en PLURAL desde V1-E3f (§Post-F9.52 punto 5; Daniel: *"cada arte
 * debe de llevar sus propias fotos (aparte de las fotos del modelo)"*).
 *
 * Espejo de `FotosModelo`: la galería de las N fotos del arte + un control para agregar otra,
 * conectando los hooks presigned (POST metadatos → PUT a R2 → DELETE por `idFoto`) con el
 * componente REUTILIZABLE `SubidaImagen`. Solo se usa en EDICIÓN (necesita el arte ya creado).
 * Toasts de éxito/error (sonner).
 *
 * A diferencia de las fotos del MODELO, aquí no hay tipo (frente/espalda) ni "marcar principal":
 * el orden es el de captura y la primera es la que se usa como miniatura. El backend gobierna
 * `modelos.administrar`; esta pantalla solo refleja.
 */
export function FotosArte({
  arte,
  idModelo,
  deshabilitado = false,
}: {
  arte: Arte;
  /**
   * ⭐⭐ V1-E9b pieza B — EL MODELO DE **LA PANTALLA**, no `arte.idModelo`. Va como prop explícita
   * y esto es lo único que la hace correcta.
   *
   * 🔴 Antes se usaba `arte.idModelo`, y sobre un modelo HIJO del linaje 1:N eso es **el padre**:
   * la ficha del hijo trae su arte INJERTADO del desarrollo (`leerArtesModelo` resuelve), así que
   * cada renglón viene con el `idModelo` del padre. Subir o quitar una foto desde la pantalla del
   * hijo habría llamado a los endpoints con el id del PADRE ⇒ `exigirRecetaPropia` **no dispara**
   * (el padre sí es dueño de su receta) ⇒ se escribe la receta del desarrollo desde la pantalla de
   * un solo color, en silencio y para los cuatro. El bloqueo del servidor es correcto; lo que
   * fallaba era el id que le llegaba.
   *
   * ⚠️ Hoy es inalcanzable —no hay puerta que cree hijos, y el editor de receta ya cierra sus
   * botones sobre uno—, pero era una trampa cargada: se cierra aquí para que no espere a que
   * alguien la pise.
   */
  idModelo: number;
  deshabilitado?: boolean;
}): React.JSX.Element {
  const consulta = useFotosArte(idModelo, arte.id);
  const subir = useSubirFotoArte();
  const quitar = useQuitarFotoArte();
  /** Foto abierta en el visor ampliado (lightbox), o `null` si está cerrado. */
  const [ampliada, setAmpliada] = useState<ArteFoto | null>(null);

  function alElegirArchivo(archivo: File): void {
    subir.mutate(
      { idModelo, idArte: arte.id, archivo },
      {
        onSuccess: () => toast.success('Foto agregada.'),
        onError: (error) => toast.error(error.message),
      },
    );
  }

  function alQuitar(foto: ArteFoto): void {
    quitar.mutate(
      { idModelo, idArte: arte.id, idFoto: foto.idFoto },
      {
        onSuccess: () => toast.success('Foto eliminada.'),
        onError: (error) => toast.error(error.message),
      },
    );
  }

  if (consulta.isPending) {
    return (
      <div className="flex gap-3" data-testid="fotos-arte-cargando">
        <Skeleton className="size-24 rounded-xl" />
        <Skeleton className="size-24 rounded-xl" />
      </div>
    );
  }

  if (consulta.isError) {
    return <p className="text-sm text-destructive">{consulta.error.message}</p>;
  }

  const fotos = consulta.data?.datos ?? [];

  return (
    <div className="space-y-3" data-testid="fotos-arte">
      {fotos.length === 0 ? (
        <div
          className="flex flex-col items-center gap-1.5 rounded-xl border border-dashed p-4 text-center text-muted-foreground"
          data-testid="arte-sin-fotos"
        >
          <ImageIcon className="size-6" aria-hidden />
          <span className="text-xs">Este arte no tiene fotos.</span>
        </div>
      ) : (
        <ul className="flex flex-wrap gap-3" data-testid="galeria-fotos-arte">
          {fotos.map((foto) => (
            <li key={foto.idFoto} className="w-24" data-testid={`foto-arte-${foto.idFoto}`}>
              <div className="relative size-24 overflow-hidden rounded-xl border bg-muted">
                <button
                  type="button"
                  className="block size-full cursor-zoom-in"
                  onClick={() => setAmpliada(foto)}
                  aria-label={`Ver en grande la foto ${foto.nombreOriginal}`}
                  data-testid={`ampliar-foto-arte-${foto.idFoto}`}
                >
                  <img
                    src={foto.urlDescarga}
                    alt={`Foto de ${arte.descripcion}`}
                    className="size-full object-cover"
                  />
                </button>
                {deshabilitado ? null : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="absolute top-1 right-1 size-7 bg-background/85"
                    onClick={() => alQuitar(foto)}
                    disabled={quitar.isPending}
                    aria-label={`Quitar foto ${foto.idFoto}`}
                    data-testid={`quitar-foto-arte-${foto.idFoto}`}
                  >
                    {quitar.isPending ? (
                      <Loader2Icon className="animate-spin" aria-hidden />
                    ) : (
                      <Trash2Icon className="text-destructive" aria-hidden />
                    )}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <SubidaImagen
        textoAlt={`Nueva foto de ${arte.descripcion}`}
        alElegirArchivo={alElegirArchivo}
        subiendo={subir.isPending}
        deshabilitado={deshabilitado}
        textoPlaceholder="Agregar foto"
        testid="foto-arte"
      />

      {ampliada !== null ? (
        <VisorImagen
          abierto
          alCambiarAbierto={(abierto) => {
            if (!abierto) {
              setAmpliada(null);
            }
          }}
          url={ampliada.urlDescarga}
          textoAlt={`Foto de ${arte.descripcion}`}
          nombreArchivo={ampliada.nombreOriginal}
          alErrorDescarga={(mensaje) => toast.error(mensaje)}
          testid="foto-arte"
        />
      ) : null}
    </div>
  );
}
