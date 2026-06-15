import { ImageIcon, Loader2Icon, Trash2Icon } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import {
  useActualizarFotoModelo,
  useFotosModelo,
  useQuitarFotoModelo,
  useSubirFotoModelo,
  type ModeloFoto,
  type TipoFotoModelo,
} from '@/api/modelos';
import { SubidaImagen } from '@/componentes/SubidaImagen';
import { Button } from '@/components/ui/button';
import { SelectNativo } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';

import { ETIQUETAS_TIPO_FOTO_MODELO, TIPOS_FOTO_MODELO } from './esquemas';

/**
 * Fotos de UN modelo (F1-E4): la GALERÍA de las N fotos del modelo + un control para subir una
 * nueva, conectando los hooks de la foto (presigned PUT/GET/PATCH/DELETE) con el componente
 * REUTILIZABLE `SubidaImagen` (el mismo de E3/bordados). Solo se usa cuando hay id de modelo
 * (en alta no, igual que la foto del bordado). Toasts de éxito/error (sonner).
 *
 * Cada foto lleva un TIPO (frente/espalda/otra): se elige al SUBIR (selector arriba) y se puede
 * CAMBIAR en una foto existente (selector bajo la miniatura, consume el `PATCH`). Esto cubre el
 * caso del checklist "subir 2 fotos: frente y espalda".
 *
 * El backend gobierna `modelos.administrar` para mutar; si el usuario no puede administrar, la
 * pantalla NO monta este editor (la decisión real la toma el backend, A1). Aquí
 * `puedeAdministrar` solo oculta los controles de escritura cuando se muestra en modo lectura.
 */
export function FotosModelo({
  idModelo,
  nombre,
  puedeAdministrar,
}: {
  idModelo: number;
  /** Código del modelo, para el texto alternativo de las imágenes. */
  nombre: string;
  puedeAdministrar: boolean;
}): React.JSX.Element {
  const consulta = useFotosModelo(idModelo);
  const subir = useSubirFotoModelo();
  const quitar = useQuitarFotoModelo();
  const actualizar = useActualizarFotoModelo();

  // Tipo elegido para la PRÓXIMA foto a subir (por defecto FRENTE: lo más común al empezar).
  const [tipoNueva, setTipoNueva] = useState<TipoFotoModelo>('FRENTE');

  function alElegirArchivo(archivo: File): void {
    subir.mutate(
      { idModelo, archivo, tipo: tipoNueva },
      {
        onSuccess: () => toast.success('Foto agregada.'),
        onError: (error) => toast.error(error.message),
      },
    );
  }

  function alQuitar(foto: ModeloFoto): void {
    quitar.mutate(
      { idModelo, idFoto: foto.idFoto },
      {
        onSuccess: () => toast.success('Foto eliminada.'),
        onError: (error) => toast.error(error.message),
      },
    );
  }

  function alCambiarTipo(foto: ModeloFoto, tipo: TipoFotoModelo): void {
    if (tipo === foto.tipo) {
      return;
    }
    actualizar.mutate(
      { idModelo, idFoto: foto.idFoto, cuerpo: { tipo } },
      {
        onSuccess: () => toast.success('Tipo de foto actualizado.'),
        onError: (error) => toast.error(error.message),
      },
    );
  }

  if (consulta.isPending) {
    return (
      <div className="flex gap-3" data-testid="fotos-modelo-cargando">
        <Skeleton className="size-32 rounded-xl" />
        <Skeleton className="size-32 rounded-xl" />
      </div>
    );
  }

  if (consulta.isError) {
    return <p className="text-sm text-destructive">{consulta.error.message}</p>;
  }

  const fotos = consulta.data ?? [];

  return (
    <div className="space-y-4" data-testid="fotos-modelo">
      {fotos.length === 0 ? (
        <div
          className="flex flex-col items-center gap-1.5 rounded-xl border border-dashed p-6 text-center text-muted-foreground"
          data-testid="modelo-sin-fotos"
        >
          <ImageIcon className="size-8" aria-hidden />
          <span className="text-sm">Este modelo no tiene fotos.</span>
        </div>
      ) : (
        <ul className="flex flex-wrap gap-3" data-testid="galeria-fotos-modelo">
          {fotos.map((foto) => (
            <li
              key={foto.idFoto}
              className="w-32 space-y-1.5"
              data-testid={`foto-modelo-${foto.idFoto}`}
            >
              <div className="relative size-32 overflow-hidden rounded-xl border bg-muted">
                <img
                  src={foto.urlDescarga}
                  alt={`${ETIQUETAS_TIPO_FOTO_MODELO[foto.tipo]} de ${nombre}`}
                  className="size-full object-cover"
                />
                <span className="absolute top-1 left-1 rounded-full bg-background/85 px-1.5 text-[10px] font-medium text-foreground">
                  {ETIQUETAS_TIPO_FOTO_MODELO[foto.tipo]}
                </span>
                {puedeAdministrar ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="absolute top-1 right-1 size-7 bg-background/85"
                    onClick={() => alQuitar(foto)}
                    disabled={quitar.isPending}
                    aria-label={`Quitar foto ${foto.idFoto}`}
                    data-testid={`quitar-foto-modelo-${foto.idFoto}`}
                  >
                    {quitar.isPending ? (
                      <Loader2Icon className="animate-spin" aria-hidden />
                    ) : (
                      <Trash2Icon className="text-destructive" aria-hidden />
                    )}
                  </Button>
                ) : null}
              </div>
              {/* Cambiar el tipo de una foto existente (consume el PATCH). */}
              {puedeAdministrar ? (
                <SelectNativo
                  className="h-8 text-xs"
                  value={foto.tipo}
                  disabled={actualizar.isPending}
                  onChange={(e) => alCambiarTipo(foto, e.target.value as TipoFotoModelo)}
                  aria-label={`Tipo de la foto ${foto.idFoto}`}
                  data-testid={`tipo-foto-modelo-${foto.idFoto}`}
                >
                  {TIPOS_FOTO_MODELO.map((t) => (
                    <option key={t} value={t}>
                      {ETIQUETAS_TIPO_FOTO_MODELO[t]}
                    </option>
                  ))}
                </SelectNativo>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {/* Agregar una foto nueva: se elige su TIPO y luego la imagen (cada subida agrega una). */}
      {puedeAdministrar ? (
        <div className="space-y-2" data-testid="subir-foto-modelo-bloque">
          <div className="flex items-center gap-2">
            <label htmlFor="tipo-foto-nueva" className="text-xs text-muted-foreground">
              Tipo de la nueva foto
            </label>
            <SelectNativo
              id="tipo-foto-nueva"
              className="h-8 w-40 text-xs"
              value={tipoNueva}
              disabled={subir.isPending}
              onChange={(e) => setTipoNueva(e.target.value as TipoFotoModelo)}
              data-testid="tipo-foto-nueva"
            >
              {TIPOS_FOTO_MODELO.map((t) => (
                <option key={t} value={t}>
                  {ETIQUETAS_TIPO_FOTO_MODELO[t]}
                </option>
              ))}
            </SelectNativo>
          </div>
          <SubidaImagen
            textoAlt={`Nueva foto de ${nombre}`}
            alElegirArchivo={alElegirArchivo}
            subiendo={subir.isPending}
            textoPlaceholder="Agregar foto"
            testid="foto-modelo"
          />
        </div>
      ) : null}
    </div>
  );
}
