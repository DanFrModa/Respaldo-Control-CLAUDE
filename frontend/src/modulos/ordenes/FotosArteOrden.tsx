import { EyeIcon, EyeOffIcon, Loader2Icon, PlusIcon, StarIcon, Trash2Icon } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';

import {
  useMostrarFotoArteOrden,
  useOcultarFotoArteOrden,
  useQuitarFotoArteOrden,
  useSubirFotoArteOrden,
  type OrdenArteConFotos,
  type OrdenArteFoto,
} from '@/api/fotos-arte-orden';
import { VisorImagen } from '@/componentes/VisorImagen';
import { cn } from '@/lib/utils';

/** Tamaño máximo de la foto (50 MB), espejo del límite de captura del backend. */
const MAX_BYTES = 50 * 1024 * 1024;

/** Clave estable para React: los dos ids son excluyentes, así que nunca chocan. */
function claveFoto(foto: OrdenArteFoto): string {
  return foto.origen === 'modelo'
    ? `modelo-${String(foto.idModeloArteFoto)}`
    : `orden-${String(foto.idFoto)}`;
}

/**
 * ⭐ FOTOS DEL ARTE **DE ESTA OP** (§Post-F9.177) — una tira de miniaturas por renglón de arte de la
 * receta de la orden.
 *
 * 🔴 DANIEL, textual: *«Un modelo de desarrollo que se va a usar para **4 órdenes diferentes** no
 * puede usar la misma foto ni del modelo **ni de arte** para todas las OP. Tendría que haber la
 * posibilidad de **modificar las fotos directamente en la OP**… **la OP es de donde cuelgan las
 * fotos directamente, no del desarrollo**»*. Y: *«aplica para fotos de la prenda pero también **del
 * arte**»*.
 *
 * Hasta hoy las fotos del arte **no se veían en ninguna pantalla de la OP**: sólo salían en su
 * impreso, leídas vivas del arte del modelo. Aquí se ven, y se pueden cambiar:
 *
 *  • **Se heredan** del arte del modelo (`origen: 'modelo'`). Si Desarrollo ya las tiene, la OP no
 *    empieza vacía — no hay que volver a subir lo mismo cuatro veces.
 *  • **Quitar no borra (D3).** La heredada que esta OP no quiere se APAGA con una marca: sigue en el
 *    arte del modelo, **otra orden la sigue viendo** y **R2 no se toca**. Para quien administra
 *    sigue visible en gris con su botón de traerla de vuelta; para quien sólo mira, no está.
 *  • **Se pueden agregar propias** (`origen: 'orden'`). Ésas sí son de la orden y quitarlas las
 *    borra de verdad. ⭐ Es la única foto posible de un arte AGREGADO A MANO, que no hereda de nadie.
 *
 * La ESTRELLA marca la primera foto heredada de ESTE arte. ⚠️ No es un puesto que se transfiera: si
 * se apaga la principal, la siguiente **no** la hereda — igual que en la prenda y en el impreso.
 *
 * ⚠️ **Y la estrella NACE AQUÍ, no viene del modelo.** La galería del arte del modelo no tiene
 * concepto de foto principal: `ModeloArteFoto` sólo lleva `orden`, `marcarArtePrincipal` ordena
 * ARTES (no fotos) y `modulos/arte/FotosArte.tsx` lo dice explícitamente. Esto es la convención *"la
 * primera del arte es su principal"*, y **no hay dónde cambiarla** — se cambia reordenando las fotos
 * del arte en la ficha del modelo. (En el IMPRESO la misma palabra marca una sola imagen de todo el
 * bloque y vale como garantía anti-recorte: mismo nombre, otra cosa.)
 *
 * Los datos llegan YA RESUELTOS del servidor (A1): aquí no se decide qué se hereda ni qué se apaga,
 * sólo se pinta. `arte` es opcional para que la fila se pinte igual mientras la consulta carga.
 */
export function FotosArteOrden({
  idOrden,
  arte,
  puedeAdministrar,
  ocupado = false,
}: {
  idOrden: number;
  arte: OrdenArteConFotos | undefined;
  puedeAdministrar: boolean;
  ocupado?: boolean;
}): React.JSX.Element | null {
  const subir = useSubirFotoArteOrden();
  const quitar = useQuitarFotoArteOrden();
  const ocultar = useOcultarFotoArteOrden();
  const mostrar = useMostrarFotoArteOrden();
  const inputRef = useRef<HTMLInputElement>(null);
  const [indiceVisor, setIndiceVisor] = useState<number | null>(null);

  const idOrdenArte = arte?.idOrdenArte;
  // Quien sólo mira no ve las apagadas: para él esta OP simplemente no lleva esa foto.
  const fotos = (arte?.fotos ?? []).filter((f) => !f.oculta || puedeAdministrar);

  // Sin fotos y sin poder subir, no se pinta nada (sin hueco en la tabla).
  if (fotos.length === 0 && !puedeAdministrar) {
    return null;
  }

  const moviendo = ocultar.isPending || mostrar.isPending;
  const subiendo = subir.isPending;
  const bloqueado = ocupado || subiendo || moviendo || quitar.isPending;

  function alElegirArchivo(evento: React.ChangeEvent<HTMLInputElement>): void {
    const archivo = evento.target.files?.[0];
    // Resetea el input para poder volver a elegir el mismo archivo tras un error.
    evento.target.value = '';
    if (!archivo || idOrdenArte === undefined) {
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
      { idOrden, idOrdenArte, archivo },
      {
        onSuccess: () => toast.success('Foto agregada al arte de esta orden.'),
        onError: (error) => toast.error(error.message),
      },
    );
  }

  /** Quita una foto que subió ESTA orden: se borra de verdad, porque nació aquí. */
  function alQuitarPropia(foto: OrdenArteFoto): void {
    if (idOrdenArte === undefined || foto.idFoto === null) {
      return;
    }
    quitar.mutate(
      { idOrden, idOrdenArte, idFoto: foto.idFoto },
      {
        onSuccess: () => toast.success('Foto quitada del arte de esta orden.'),
        onError: (error) => toast.error(error.message),
      },
    );
  }

  /**
   * Apaga en ESTA orden una foto HEREDADA del arte del modelo. NO la borra: el backend sólo guarda
   * una marca — la del modelo queda intacta y las demás órdenes la siguen viendo. Por eso el aviso
   * dice "quitada de esta orden", no "eliminada".
   */
  function alOcultarHeredada(foto: OrdenArteFoto): void {
    if (idOrdenArte === undefined || foto.idModeloArteFoto === null) {
      return;
    }
    ocultar.mutate(
      { idOrden, idOrdenArte, idModeloArteFoto: foto.idModeloArteFoto },
      {
        onSuccess: () => toast.success('Foto quitada de esta orden (sigue en el modelo).'),
        onError: (error) => toast.error(error.message),
      },
    );
  }

  /** Trae de vuelta una heredada que se había apagado (la vuelta atrás). */
  function alMostrarHeredada(foto: OrdenArteFoto): void {
    if (idOrdenArte === undefined || foto.idModeloArteFoto === null) {
      return;
    }
    mostrar.mutate(
      { idOrden, idOrdenArte, idModeloArteFoto: foto.idModeloArteFoto },
      {
        onSuccess: () => toast.success('Foto de vuelta en esta orden.'),
        onError: (error) => toast.error(error.message),
      },
    );
  }

  const fotoVisor = indiceVisor !== null ? fotos[indiceVisor] : undefined;
  const rotulo = arte?.descripcion ?? 'el arte';

  return (
    <>
      <div className="mt-1 flex flex-wrap gap-1.5" data-testid="fotos-arte-orden">
        {fotos.map((foto, indice) => (
          <div
            key={claveFoto(foto)}
            className={cn('group relative size-12 shrink-0', foto.oculta && 'opacity-50')}
          >
            <button
              type="button"
              className="size-full overflow-hidden rounded-md border bg-muted transition-opacity hover:opacity-80"
              onClick={() => setIndiceVisor(indice)}
              aria-label={`Ver foto ${String(indice + 1)} de ${rotulo} ampliada`}
              data-testid="foto-arte-orden"
              data-origen={foto.origen}
            >
              <img
                src={foto.urlDescarga}
                alt={
                  foto.oculta
                    ? `Foto de ${rotulo} quitada de esta orden`
                    : foto.principal
                      ? `Primera foto de ${rotulo}`
                      : `Foto de ${rotulo}`
                }
                className={cn('size-full object-cover', foto.oculta && 'grayscale')}
              />
            </button>
            {/* Distintivo de la foto PRINCIPAL del arte del modelo (la primera de su galería). */}
            {foto.principal ? (
              <span
                className="pointer-events-none absolute bottom-0 left-0 flex items-center gap-0.5 rounded-tr-md rounded-bl-md bg-primary/90 px-0.5 text-[8px] font-semibold text-primary-foreground"
                data-testid="foto-arte-orden-principal"
              >
                <StarIcon className="size-2 fill-current" aria-hidden />
                <span className="sr-only">Primera foto del arte en el modelo</span>
              </span>
            ) : null}
            {/* Distintivo de la QUITADA de esta OP: sigue en el modelo, esta orden no la enseña. */}
            {foto.oculta ? (
              <span
                className="pointer-events-none absolute right-0 bottom-0 flex items-center gap-0.5 rounded-tl-md rounded-br-md bg-muted-foreground/90 px-0.5 text-[8px] font-semibold text-background"
                data-testid="foto-arte-orden-oculta"
              >
                <EyeOffIcon className="size-2" aria-hidden />
                <span className="sr-only">Foto quitada de esta orden</span>
              </span>
            ) : null}
            {/* Las SUBIDAS a la orden se borran de verdad (son suyas y viven en R2). */}
            {puedeAdministrar && foto.origen === 'orden' ? (
              <button
                type="button"
                className="absolute -top-1.5 -right-1.5 hidden size-4 items-center justify-center rounded-full border bg-card text-destructive shadow-sm group-hover:flex disabled:opacity-50"
                disabled={bloqueado}
                onClick={() => alQuitarPropia(foto)}
                title="Quitar esta foto de la orden"
                aria-label="Quitar la foto del arte de la orden"
                data-testid="quitar-foto-arte-orden"
              >
                <Trash2Icon className="size-2.5" aria-hidden />
              </button>
            ) : null}
            {/* ⭐ Las HEREDADAS no se borran: se apagan en esta OP, y se pueden traer de vuelta
                (D3). Dos botones, uno por estado — nunca los dos. */}
            {puedeAdministrar && foto.origen === 'modelo' ? (
              foto.oculta ? (
                <button
                  type="button"
                  className="absolute -top-1.5 -right-1.5 flex size-4 items-center justify-center rounded-full border bg-card text-primary shadow-sm disabled:opacity-50"
                  disabled={bloqueado}
                  onClick={() => alMostrarHeredada(foto)}
                  title="Traerla de vuelta a esta orden"
                  aria-label="Traer la foto del arte de vuelta a esta orden"
                  data-testid="mostrar-foto-arte-orden"
                >
                  <EyeIcon className="size-2.5" aria-hidden />
                </button>
              ) : (
                <button
                  type="button"
                  className="absolute -top-1.5 -right-1.5 hidden size-4 items-center justify-center rounded-full border bg-card text-muted-foreground shadow-sm group-hover:flex disabled:opacity-50"
                  disabled={bloqueado}
                  onClick={() => alOcultarHeredada(foto)}
                  title="Quitarla de esta orden (sigue en el modelo)"
                  aria-label="Quitar la foto del arte de esta orden"
                  data-testid="ocultar-foto-arte-orden"
                >
                  <EyeOffIcon className="size-2.5" aria-hidden />
                </button>
              )
            ) : null}
          </div>
        ))}

        {/* Tile "+" para subir una foto propia a este renglón (el backend re-valida, A1). */}
        {puedeAdministrar && idOrdenArte !== undefined ? (
          <>
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              className="hidden"
              disabled={bloqueado}
              onChange={alElegirArchivo}
              data-testid="foto-arte-orden-archivo"
            />
            <button
              type="button"
              className={cn(
                'flex size-12 shrink-0 flex-col items-center justify-center rounded-md border border-dashed text-muted-foreground transition-colors hover:border-primary hover:text-primary',
                bloqueado && 'cursor-not-allowed opacity-60',
              )}
              disabled={bloqueado}
              onClick={() => inputRef.current?.click()}
              title="Subir una foto de este arte a la orden"
              aria-label="Subir foto del arte a la orden"
              data-testid="subir-foto-arte-orden"
            >
              {subiendo ? (
                <Loader2Icon className="size-3.5 animate-spin" aria-hidden />
              ) : (
                <PlusIcon className="size-3.5" aria-hidden />
              )}
              <span className="text-[8px] font-medium">Foto</span>
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
          url={fotoVisor.urlDescarga}
          textoAlt={`Foto de ${rotulo}`}
          nombreArchivo={fotoVisor.nombreOriginal}
          testid="foto-arte-orden"
          posicion={`${String((indiceVisor ?? 0) + 1)} / ${String(fotos.length)}`}
          hayAnterior={(indiceVisor ?? 0) > 0}
          haySiguiente={(indiceVisor ?? 0) < fotos.length - 1}
          alAnterior={() => setIndiceVisor((i) => Math.max(0, (i ?? 0) - 1))}
          alSiguiente={() => setIndiceVisor((i) => Math.min(fotos.length - 1, (i ?? 0) + 1))}
        />
      ) : null}
    </>
  );
}
