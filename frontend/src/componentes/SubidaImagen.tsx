import { ImageIcon, Loader2Icon, Trash2Icon, UploadIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Tamaño máximo de imagen por defecto (5 MB). El backend re-valida y firma el tamaño
 * exacto; este es un tope de UX para no intentar subir archivos enormes.
 */
export const TAMANO_MAXIMO_IMAGEN_BYTES = 5 * 1024 * 1024;

/** MIME aceptados por defecto: formatos de imagen comunes de la web. */
const MIME_IMAGEN_PERMITIDOS = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'];

/**
 * Props del componente reutilizable {@link SubidaImagen}.
 *
 * El componente es GENÉRICO: no conoce bordados, modelos ni ninguna entidad. Solo
 * presenta una imagen (o un placeholder) y delega la subida/borrado a su padre vía
 * callbacks. La mecánica real del flujo presigned (POST de metadatos → PUT directo a
 * R2) vive en los hooks del módulo que lo usa; el componente solo entrega el `File`
 * elegido y avisa cuando se pide quitar. Así F1-E3 (bordados) y F1-E4 (modelos) lo
 * reutilizan sin acoplarse.
 *
 * Estados de carga (`subiendo`/`quitando`) y `error` los controla el padre (a partir de
 * sus mutaciones de TanStack Query): el componente solo los refleja en la UI.
 */
export interface PropsSubidaImagen {
  /**
   * URL de la imagen actual (p. ej. la URL GET prefirmada de R2), o `null`/`undefined`
   * si no hay imagen. Cuando es nula se pinta el placeholder {@link textoPlaceholder}.
   */
  urlImagen?: string | null | undefined;
  /** Texto alternativo de la imagen (accesibilidad). Ej.: el nombre del bordado. */
  textoAlt: string;
  /**
   * Se invoca con el `File` que eligió el usuario, ya validado (tipo y tamaño). El
   * padre realiza la subida (presigned PUT) y refresca `urlImagen` al terminar.
   */
  alElegirArchivo: (archivo: File) => void;
  /**
   * Se invoca al pedir quitar la imagen actual. Opcional: si no se pasa, no se muestra
   * el botón de quitar (p. ej. en un alta donde aún no hay nada que quitar).
   */
  alQuitar?: (() => void) | undefined;
  /** ¿Hay una subida en curso? Deshabilita los controles y muestra "Subiendo…". */
  subiendo?: boolean | undefined;
  /** ¿Hay un borrado en curso? Deshabilita los controles. */
  quitando?: boolean | undefined;
  /** Deshabilita todos los controles (p. ej. mientras se guarda el formulario, o sin permiso). */
  deshabilitado?: boolean | undefined;
  /** Mensaje de error a mostrar bajo el control (p. ej. el mensaje del backend). */
  error?: string | null | undefined;
  /** Texto del placeholder cuando no hay imagen. Por defecto "Sin imagen". */
  textoPlaceholder?: string | undefined;
  /**
   * MIME aceptados (atributo `accept` del input y validación de UX). Por defecto los
   * formatos de imagen comunes. El backend es la autoridad sobre lo que admite.
   */
  tiposAceptados?: readonly string[] | undefined;
  /** Tamaño máximo en bytes (validación de UX). Por defecto {@link TAMANO_MAXIMO_IMAGEN_BYTES}. */
  tamanoMaximoBytes?: number | undefined;
  /** Base de los `data-testid` (p. ej. "foto" → `subir-foto`, `quitar-foto`, `preview-foto`). */
  testid?: string | undefined;
  /** Clases extra para el contenedor raíz. */
  className?: string | undefined;
  /**
   * Cómo encaja la imagen en el recuadro. `cover` (por defecto) recorta para llenarlo —lo natural
   * en fotos de producto—; `contain` la mete entera —lo que necesita un LOGO, que no se puede
   * recortar—. No cambia el tamaño del recuadro, solo el ajuste de la imagen.
   */
  ajuste?: 'cover' | 'contain' | undefined;
  /**
   * Clases extra para el RECUADRO de vista previa (p. ej. `bg-white` para un logo oscuro, que
   * sobre el `bg-muted` del tema oscuro no se vería). Se aplican al final: ganan sobre las de base.
   */
  claseVistaPrevia?: string | undefined;
}

/**
 * Subida de imagen REUTILIZABLE (rediseño "Teal fresco"): preview cuadrado de la
 * imagen (o placeholder NoFoto), botón para elegir/cambiar archivo y, si aplica, botón
 * para quitarla. Valida tipo y tamaño en el navegador antes de avisar al padre (es solo
 * UX: el backend re-valida y firma). Muestra estados de carga y un mensaje de error.
 *
 * No realiza ninguna petición: es presentacional + manejo del `<input type="file">`. El
 * padre conecta los callbacks a sus hooks (presigned PUT) y le pasa `urlImagen`,
 * `subiendo`, `quitando` y `error`. Reutilizable por cualquier entidad con foto.
 *
 * @example
 * // Así lo conecta `modulos/arte/FotoArte.tsx` (la foto del arte de un modelo, V1-E3d).
 * <SubidaImagen
 *   urlImagen={foto?.urlDescarga ?? null}
 *   textoAlt={`Foto de ${arte.nombre}`}
 *   alElegirArchivo={(archivo) => subir.mutate({ idArte: arte.id, archivo })}
 *   alQuitar={() => quitar.mutate(arte.id)}
 *   subiendo={subir.isPending}
 *   quitando={quitar.isPending}
 *   testid="foto-arte"
 * />
 */
export function SubidaImagen({
  urlImagen,
  textoAlt,
  alElegirArchivo,
  alQuitar,
  subiendo = false,
  quitando = false,
  deshabilitado = false,
  error,
  textoPlaceholder = 'Sin imagen',
  tiposAceptados = MIME_IMAGEN_PERMITIDOS,
  tamanoMaximoBytes = TAMANO_MAXIMO_IMAGEN_BYTES,
  testid = 'imagen',
  className,
  ajuste = 'cover',
  claseVistaPrevia,
}: PropsSubidaImagen): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  // Error de validación LOCAL (tipo/tamaño) que se muestra hasta el siguiente intento.
  const [errorLocal, setErrorLocal] = useState<string | null>(null);

  // Si llega una imagen nueva, limpia el error local (la subida previa sirvió).
  useEffect(() => {
    if (urlImagen) {
      setErrorLocal(null);
    }
  }, [urlImagen]);

  const ocupado = subiendo || quitando || deshabilitado;

  function alCambiarInput(evento: React.ChangeEvent<HTMLInputElement>): void {
    const archivo = evento.target.files?.[0];
    // Resetea el input para poder volver a elegir el mismo archivo tras un error.
    evento.target.value = '';
    if (!archivo) {
      return;
    }
    if (!tiposAceptados.includes(archivo.type)) {
      setErrorLocal('El archivo debe ser una imagen (JPG, PNG, WEBP o GIF).');
      return;
    }
    if (archivo.size > tamanoMaximoBytes) {
      const mb = Math.round(tamanoMaximoBytes / (1024 * 1024));
      setErrorLocal(`La imagen es muy grande (máximo ${mb} MB).`);
      return;
    }
    setErrorLocal(null);
    alElegirArchivo(archivo);
  }

  const mensajeError = errorLocal ?? error ?? null;
  const tieneImagen = Boolean(urlImagen);

  return (
    <div
      className={cn('flex flex-col items-start gap-3', className)}
      data-testid={`subida-${testid}`}
    >
      {/* Preview cuadrado o placeholder NoFoto */}
      <div
        className={cn(
          'relative flex size-40 shrink-0 items-center justify-center overflow-hidden rounded-xl border bg-muted',
          subiendo && 'opacity-60',
          claseVistaPrevia,
        )}
        data-testid={`preview-${testid}`}
      >
        {tieneImagen ? (
          // `urlImagen` es verdadero aquí (tieneImagen); el `?? ''` solo satisface a TS.
          <img
            src={urlImagen ?? ''}
            alt={textoAlt}
            className={cn('size-full', ajuste === 'contain' ? 'object-contain' : 'object-cover')}
            data-testid={`imagen-${testid}`}
          />
        ) : (
          <div className="flex flex-col items-center gap-1.5 p-3 text-center text-muted-foreground">
            <ImageIcon className="size-8" aria-hidden />
            <span className="text-xs" data-testid={`placeholder-${testid}`}>
              {textoPlaceholder}
            </span>
          </div>
        )}
        {subiendo ? (
          <span className="absolute inset-0 flex items-center justify-center bg-background/40">
            <Loader2Icon className="size-6 animate-spin text-primary" aria-hidden />
          </span>
        ) : null}
      </div>

      {/* Input oculto disparado por el botón (mejor estilo y UX consistente). */}
      <input
        ref={inputRef}
        type="file"
        accept={tiposAceptados.join(',')}
        className="hidden"
        disabled={ocupado}
        onChange={alCambiarInput}
        data-testid={`archivo-${testid}`}
        aria-label={tieneImagen ? 'Cambiar imagen' : 'Subir imagen'}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={ocupado}
          onClick={() => inputRef.current?.click()}
          data-testid={`subir-${testid}`}
        >
          {subiendo ? (
            <Loader2Icon className="animate-spin" aria-hidden />
          ) : (
            <UploadIcon aria-hidden />
          )}
          {subiendo ? 'Subiendo…' : tieneImagen ? 'Cambiar imagen' : 'Subir imagen'}
        </Button>

        {alQuitar && tieneImagen ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={ocupado}
            onClick={alQuitar}
            data-testid={`quitar-${testid}`}
          >
            {quitando ? (
              <Loader2Icon className="animate-spin" aria-hidden />
            ) : (
              <Trash2Icon className="text-destructive" aria-hidden />
            )}
            Quitar
          </Button>
        ) : null}
      </div>

      {mensajeError ? (
        <p className="text-sm text-destructive" role="alert" data-testid={`error-${testid}`}>
          {mensajeError}
        </p>
      ) : null}
    </div>
  );
}
