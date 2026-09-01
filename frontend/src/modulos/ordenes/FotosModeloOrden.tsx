import { EyeIcon, EyeOffIcon, Loader2Icon, PlusIcon, StarIcon, Trash2Icon } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import {
  useAdjuntosOrden,
  useQuitarAdjuntoOrden,
  useSubirAdjuntoOrden,
} from '@/api/adjuntos-orden';
import {
  useFotosOcultasOrden,
  useMostrarFotoModeloOrden,
  useOcultarFotoModeloOrden,
} from '@/api/fotos-ocultas-orden';
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
  /** `ModeloFoto.id` (solo las del MODELO): la identidad con la que esta OP la oculta/recupera. */
  idModeloFoto?: number;
  nombreArchivo: string;
  /** ¿Es la foto PRINCIPAL del modelo (la primera de su galería)? Lleva distintivo y va al frente. */
  principal?: boolean;
  /**
   * ⭐ §Post-F9.169(b): esta OP QUITÓ esta foto heredada del modelo. **No está borrada** — sigue en la
   * galería del modelo y en las demás órdenes; sólo esta OP dejó de enseñarla. Se pinta apagada (y
   * con el botón de traerla de vuelta) para quien administra, y no se pinta para los demás.
   */
  oculta?: boolean;
}

/**
 * FOTOS de la OP (F2-E3, ajuste jul-2026 a petición de Daniel): una TIRA de MINIATURAS pequeñas que
 * COMBINA las fotos del MODELO (`useFotosModelo`) con las imágenes SUBIDAS a la orden (adjuntos de
 * `useAdjuntosOrden`, filtradas por `tipoMime` de imagen). Al hacer clic en una se abre GRANDE en un
 * visor NAVEGABLE (anterior/siguiente entre todas). Con `ordenes.administrar` aparece un tile "+"
 * para SUBIR una foto a la orden (presigned a R2, sin backend nuevo) y un botón para QUITAR las que
 * se subieron a la orden. Compacto: solo miniaturas + visor.
 *
 * ⭐ §Post-F9.169(b) — DANIEL: *"La foto debería de ser **de la OP no del desarrollo**. Si el
 * desarrollo tiene fotos está bien que podamos **heredarlas**, pero también la opción de **quitarlas
 * de la OP**"*. Con `ordenes.administrar` cada foto HEREDADA del modelo lleva su botón de QUITARLA
 * de esta OP:
 *
 *  • **Quitar no borra (D3).** La foto sigue en la galería del modelo, sigue siendo su principal si
 *    lo era, **otra orden del mismo modelo la sigue viendo** y **R2 no se toca**. Lo único que se
 *    guarda es una marca por *(orden, foto)* (`api/fotos-ocultas-orden`).
 *  • **Y es reversible:** para quien administra, la foto quitada se sigue viendo APAGADA con su
 *    botón de traerla de vuelta — una foto que desaparece sin retorno sería una trampa. Para quien
 *    solo mira, simplemente no está.
 *
 * La FOTO PRINCIPAL del modelo (la primera de su galería, jul-2026 a petición de Daniel) abre la
 * tira y lleva una estrella. Marcarla/cambiarla se hace en la ficha del modelo, no aquí. ⚠️ Ser
 * principal NO es un puesto que se transfiera: si la principal se quita de esta OP, la segunda foto
 * **no hereda** la estrella (mismo criterio que el impreso).
 *
 * `idOrden`/`puedeAdministrar` son opcionales: sin `idOrden` (p. ej. desde el diálogo de captura) se
 * comporta como antes, solo con las fotos del modelo y sin nada de la orden. Si no hay ninguna foto
 * y no se puede administrar, no pinta nada.
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
  const fotosOcultas = useFotosOcultasOrden(idOrden);
  const subir = useSubirAdjuntoOrden();
  const quitar = useQuitarAdjuntoOrden();
  const ocultarDeLaOrden = useOcultarFotoModeloOrden();
  const mostrarEnLaOrden = useMostrarFotoModeloOrden();
  const inputRef = useRef<HTMLInputElement>(null);

  // Índice de la foto abierta en el visor (null = cerrado).
  const [indiceVisor, setIndiceVisor] = useState<number | null>(null);

  // Todo lo que MUTA la orden pide las dos cosas: el permiso y saber de qué orden hablamos.
  const puedeSubir = puedeAdministrar && idOrden !== undefined;

  // Tira COMBINADA: primero las fotos del modelo (la PRINCIPAL al frente: el API las devuelve
  // ordenadas y la principal es la primera), luego las imágenes subidas a la orden.
  const fotos = useMemo<FotoTira[]>(() => {
    const ocultas = new Set((fotosOcultas.data ?? []).map((f) => f.idModeloFoto));
    const delModelo: FotoTira[] = (fotosModelo.data ?? [])
      .map((f, indice) => ({
        clave: `modelo-${f.idFoto}`,
        url: f.urlDescarga,
        origen: 'modelo' as const,
        idModeloFoto: f.idFoto,
        nombreArchivo: `${codigoModelo}.jpg`,
        // ⚠️ La ESTRELLA se decide sobre la galería COMPLETA (antes de descartar las quitadas): ser
        // principal es una decisión sobre una foto concreta, no un puesto que la siguiente herede.
        ...(indice === 0 ? { principal: true } : {}),
        ...(ocultas.has(f.idFoto) ? { oculta: true } : {}),
      }))
      // Quien administra SÍ ve las quitadas (apagadas, para poder traerlas de vuelta); quien solo
      // mira, no: para él esta OP simplemente no lleva esa foto.
      .filter((f) => f.oculta !== true || puedeSubir);
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
  }, [fotosModelo.data, adjuntos.data, fotosOcultas.data, codigoModelo, puedeSubir]);

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

  /**
   * Quita de ESTA orden una foto HEREDADA del modelo (§Post-F9.169(b)). NO la borra: el backend sólo
   * guarda una marca por *(orden, foto)* — la del modelo queda intacta y las demás órdenes la
   * siguen viendo. Por eso el aviso dice "quitada de esta orden", no "eliminada".
   */
  function alOcultarDelModelo(foto: FotoTira): void {
    if (idOrden === undefined || foto.idModeloFoto === undefined) {
      return;
    }
    ocultarDeLaOrden.mutate(
      { idOrden, idModeloFoto: foto.idModeloFoto },
      {
        onSuccess: () => toast.success('Foto quitada de esta orden (sigue en el modelo).'),
        onError: (error) => toast.error(error.message),
      },
    );
  }

  /** Trae de vuelta a esta orden una foto del modelo que se había quitado (la vuelta atrás). */
  function alMostrarDelModelo(foto: FotoTira): void {
    if (idOrden === undefined || foto.idModeloFoto === undefined) {
      return;
    }
    mostrarEnLaOrden.mutate(
      { idOrden, idModeloFoto: foto.idModeloFoto },
      {
        onSuccess: () => toast.success('Foto de vuelta en esta orden.'),
        onError: (error) => toast.error(error.message),
      },
    );
  }

  const fotoVisor = indiceVisor !== null ? fotos[indiceVisor] : undefined;
  const subiendo = subir.isPending;
  const moviendoFotoDelModelo = ocultarDeLaOrden.isPending || mostrarEnLaOrden.isPending;

  return (
    <>
      <div className="flex flex-wrap gap-2" data-testid="fotos-modelo-orden">
        {fotos.map((foto, indice) => (
          <div
            key={foto.clave}
            className={cn('group relative size-16 shrink-0', foto.oculta === true && 'opacity-50')}
          >
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
                alt={
                  foto.oculta === true
                    ? `Foto de ${codigoModelo} quitada de esta orden`
                    : foto.principal === true
                      ? `Foto principal de ${codigoModelo}`
                      : `Foto de ${codigoModelo}`
                }
                className={cn('size-full object-cover', foto.oculta === true && 'grayscale')}
              />
            </button>
            {/* Distintivo de la foto PRINCIPAL del modelo (la primera de su galería). En la tira
                solo cabe la estrella; el rótulo va en el `sr-only` (el `<span>` es
                `pointer-events-none`, así que un `title` sería letra muerta: no se pondría). */}
            {foto.principal === true ? (
              <span
                className="pointer-events-none absolute bottom-0 left-0 flex items-center gap-0.5 rounded-tr-md rounded-bl-lg bg-primary/90 px-1 text-[9px] font-semibold text-primary-foreground"
                data-testid="foto-modelo-orden-principal"
              >
                <StarIcon className="size-2.5 fill-current" aria-hidden />
                <span className="sr-only">Foto principal del modelo</span>
              </span>
            ) : null}
            {/* Distintivo de la foto QUITADA de esta OP (§Post-F9.169(b)): sigue en el modelo, esta
                orden no la enseña. Va a la derecha para no pelearse con la estrella de la principal
                (una principal quitada lleva las dos marcas a la vez). */}
            {foto.oculta === true ? (
              <span
                className="pointer-events-none absolute right-0 bottom-0 flex items-center gap-0.5 rounded-tl-md rounded-br-lg bg-muted-foreground/90 px-1 text-[9px] font-semibold text-background"
                data-testid="foto-modelo-orden-oculta"
              >
                <EyeOffIcon className="size-2.5" aria-hidden />
                <span className="sr-only">Foto quitada de esta orden</span>
              </span>
            ) : null}
            {/* Las fotos SUBIDAS a la orden se BORRAN de verdad (son de la orden y viven en R2). */}
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
            {/* ⭐ Las HEREDADAS del modelo no se borran: se QUITAN de esta OP, y se pueden traer de
                vuelta (§Post-F9.169(b), D3). Dos botones, uno por estado — nunca los dos. */}
            {puedeSubir && foto.origen === 'modelo' ? (
              foto.oculta === true ? (
                <button
                  type="button"
                  className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full border bg-card text-primary shadow-sm disabled:opacity-50"
                  disabled={moviendoFotoDelModelo}
                  onClick={() => alMostrarDelModelo(foto)}
                  title="Traerla de vuelta a esta orden"
                  aria-label="Traer la foto de vuelta a esta orden"
                  data-testid="mostrar-foto-modelo-orden"
                >
                  <EyeIcon className="size-3" aria-hidden />
                </button>
              ) : (
                <button
                  type="button"
                  className="absolute -top-1.5 -right-1.5 hidden size-5 items-center justify-center rounded-full border bg-card text-muted-foreground shadow-sm group-hover:flex disabled:opacity-50"
                  disabled={moviendoFotoDelModelo}
                  onClick={() => alOcultarDelModelo(foto)}
                  title="Quitarla de esta orden (sigue en el modelo)"
                  aria-label="Quitar la foto del modelo de esta orden"
                  data-testid="ocultar-foto-modelo-orden"
                >
                  <EyeOffIcon className="size-3" aria-hidden />
                </button>
              )
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
