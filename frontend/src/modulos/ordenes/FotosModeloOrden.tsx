import { Loader2Icon, PlusIcon, Trash2Icon } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import {
  useAdjuntosOrden,
  useQuitarAdjuntoOrden,
  useSubirAdjuntoOrden,
} from '@/api/adjuntos-orden';
import { useFotosModelo } from '@/api/modelos';
import { VisorImagen } from '@/componentes/VisorImagen';
import { cn } from '@/lib/utils';

/** Tamaño máximo de la foto (50 MB), espejo del límite de captura del backend. */
const MAX_BYTES = 50 * 1024 * 1024;

/** Una foto de la tira combinada (del modelo o subida a la orden). */
interface FotoTira {
  /** Clave estable para React. */
  clave: string;
  url: string;
  /** De dónde viene: catálogo del MODELO o adjunto subido a la ORDEN. */
  origen: 'modelo' | 'orden';
  /** `idArchivo` del adjunto (solo las de la ORDEN se pueden quitar desde aquí). */
  idArchivo?: string;
  nombreArchivo: string;
}

/**
 * FOTOS de la OP (F2-E3, ajuste jul-2026 a petición de Daniel): una TIRA de MINIATURAS pequeñas que
 * COMBINA las fotos del MODELO (`useFotosModelo`) con las imágenes SUBIDAS a la orden (adjuntos de
 * `useAdjuntosOrden`, filtradas por `tipoMime` de imagen). Al hacer clic en una se abre GRANDE en un
 * visor NAVEGABLE (anterior/siguiente entre todas). Con `ordenes.administrar` aparece un tile "+"
 * para SUBIR una foto a la orden (presigned a R2, sin backend nuevo) y un botón para QUITAR las que
 * se subieron a la orden (nunca las del modelo). Compacto: solo miniaturas + visor.
 *
 * `idOrden`/`puedeAdministrar` son opcionales: sin `idOrden` (p. ej. desde el diálogo de captura) se
 * comporta como antes, solo con las fotos del modelo. Si no hay ninguna foto y no se puede
 * administrar, no pinta nada.
 */
export function FotosModeloOrden({
  idModelo,
  codigoModelo,
  idOrden,
  puedeAdministrar = false,
}: {
  idModelo: number;
  codigoModelo: string;
  idOrden?: number;
  puedeAdministrar?: boolean;
}): React.JSX.Element | null {
  const fotosModelo = useFotosModelo(idModelo);
  const adjuntos = useAdjuntosOrden(idOrden);
  const subir = useSubirAdjuntoOrden();
  const quitar = useQuitarAdjuntoOrden();
  const inputRef = useRef<HTMLInputElement>(null);

  // Índice de la foto abierta en el visor (null = cerrado).
  const [indiceVisor, setIndiceVisor] = useState<number | null>(null);

  const puedeSubir = puedeAdministrar && idOrden !== undefined;

  // Tira COMBINADA: primero las fotos del modelo, luego las imágenes subidas a la orden.
  const fotos = useMemo<FotoTira[]>(() => {
    const delModelo: FotoTira[] = (fotosModelo.data ?? []).map((f) => ({
      clave: `modelo-${f.idFoto}`,
      url: f.urlDescarga,
      origen: 'modelo',
      nombreArchivo: `${codigoModelo}.jpg`,
    }));
    const deLaOrden: FotoTira[] = (adjuntos.data ?? [])
      .filter((a) => a.tipoMime.startsWith('image/'))
      .map((a) => ({
        clave: `orden-${a.idArchivo}`,
        url: a.urlDescarga,
        origen: 'orden',
        idArchivo: a.idArchivo,
        nombreArchivo: a.nombreOriginal,
      }));
    return [...delModelo, ...deLaOrden];
  }, [fotosModelo.data, adjuntos.data, codigoModelo]);

  // Si no hay ninguna foto y ni siquiera se puede subir, no se pinta nada (sin hueco).
  if (fotos.length === 0 && !puedeSubir) {
    return null;
  }

  function alElegirArchivo(evento: React.ChangeEvent<HTMLInputElement>): void {
    const archivo = evento.target.files?.[0];
    // Resetea el input para poder volver a elegir el mismo archivo tras un error.
    evento.target.value = '';
    if (!archivo || idOrden === undefined) {
      return;
    }
    if (!archivo.type.startsWith('image/')) {
      toast.error('Elige una imagen (JPG, PNG…).');
      return;
    }
    if (archivo.size > MAX_BYTES) {
      toast.error('La imagen es muy grande (máximo 50 MB).');
      return;
    }
    subir.mutate(
      { idOrden, archivo },
      {
        onSuccess: () => toast.success('Foto subida a la orden.'),
        onError: (error) => toast.error(error.message),
      },
    );
  }

  function alQuitar(foto: FotoTira): void {
    if (idOrden === undefined || foto.idArchivo === undefined) {
      return;
    }
    quitar.mutate(
      { idOrden, idArchivo: foto.idArchivo },
      {
        onSuccess: () => toast.success('Foto quitada de la orden.'),
        onError: (error) => toast.error(error.message),
      },
    );
  }

  const fotoVisor = indiceVisor !== null ? fotos[indiceVisor] : undefined;
  const subiendo = subir.isPending;

  return (
    <>
      <div className="flex flex-wrap gap-2" data-testid="fotos-modelo-orden">
        {fotos.map((foto, indice) => (
          <div key={foto.clave} className="group relative size-16 shrink-0">
            <button
              type="button"
              className="size-full overflow-hidden rounded-lg border bg-muted transition-opacity hover:opacity-80"
              onClick={() => setIndiceVisor(indice)}
              aria-label={`Ver foto ${indice + 1} de ${codigoModelo} ampliada`}
              data-testid="foto-modelo-orden"
              data-origen={foto.origen}
            >
              <img
                src={foto.url}
                alt={`Foto de ${codigoModelo}`}
                className="size-full object-cover"
              />
            </button>
            {/* Solo las fotos SUBIDAS a la orden se pueden quitar desde aquí (las del modelo no). */}
            {puedeAdministrar && foto.origen === 'orden' ? (
              <button
                type="button"
                className="absolute -top-1.5 -right-1.5 hidden size-5 items-center justify-center rounded-full border bg-card text-destructive shadow-sm group-hover:flex disabled:opacity-50"
                disabled={quitar.isPending}
                onClick={() => alQuitar(foto)}
                aria-label="Quitar foto de la orden"
                data-testid="quitar-foto-orden"
              >
                <Trash2Icon className="size-3" aria-hidden />
              </button>
            ) : null}
          </div>
        ))}

        {/* Tile "+" para subir una foto a la orden (solo con permiso; el backend re-valida A1). */}
        {puedeSubir ? (
          <>
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              className="hidden"
              disabled={subiendo}
              onChange={alElegirArchivo}
              data-testid="foto-orden-archivo"
            />
            <button
              type="button"
              className={cn(
                'flex size-16 shrink-0 flex-col items-center justify-center gap-0.5 rounded-lg border border-dashed text-muted-foreground transition-colors hover:border-primary hover:text-primary',
                subiendo && 'cursor-not-allowed opacity-60',
              )}
              disabled={subiendo}
              onClick={() => inputRef.current?.click()}
              aria-label="Subir foto a la orden"
              data-testid="subir-foto-orden"
            >
              {subiendo ? (
                <Loader2Icon className="size-4 animate-spin" aria-hidden />
              ) : (
                <PlusIcon className="size-4" aria-hidden />
              )}
              <span className="text-[9px] font-medium">Foto</span>
            </button>
          </>
        ) : null}
      </div>

      {fotoVisor !== undefined ? (
        <VisorImagen
          abierto
          alCambiarAbierto={(abierto) => {
            if (!abierto) {
              setIndiceVisor(null);
            }
          }}
          url={fotoVisor.url}
          textoAlt={`Foto de ${codigoModelo}`}
          nombreArchivo={fotoVisor.nombreArchivo}
          testid="foto-orden"
          posicion={`${(indiceVisor ?? 0) + 1} / ${fotos.length}`}
          hayAnterior={(indiceVisor ?? 0) > 0}
          haySiguiente={(indiceVisor ?? 0) < fotos.length - 1}
          alAnterior={() => setIndiceVisor((i) => Math.max(0, (i ?? 0) - 1))}
          alSiguiente={() => setIndiceVisor((i) => Math.min(fotos.length - 1, (i ?? 0) + 1))}
        />
      ) : null}
    </>
  );
}
