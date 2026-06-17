import { useState } from 'react';

import { useFotosModelo } from '@/api/modelos';
import { VisorImagen } from '@/componentes/VisorImagen';

/**
 * Tira de fotos del MODELO de una orden (F2-E3): miniaturas (R2, URL prefirmada) que abren el visor
 * ampliado al hacer clic. Reusa `useFotosModelo`. Si el modelo no tiene fotos, no pinta nada.
 */
export function FotosModeloOrden({
  idModelo,
  codigoModelo,
}: {
  idModelo: number;
  codigoModelo: string;
}): React.JSX.Element | null {
  const fotos = useFotosModelo(idModelo);
  const [ampliada, setAmpliada] = useState<string | null>(null);
  const [alt, setAlt] = useState('');

  const lista = fotos.data ?? [];
  if (lista.length === 0) {
    return null;
  }

  return (
    <>
      <div className="flex flex-wrap gap-2" data-testid="fotos-modelo-orden">
        {lista.map((foto) => (
          <button
            key={foto.idFoto}
            type="button"
            className="size-16 overflow-hidden rounded-lg border bg-muted transition-opacity hover:opacity-80"
            onClick={() => {
              setAmpliada(foto.urlDescarga);
              setAlt(`Foto de ${codigoModelo}`);
            }}
            aria-label={`Ver foto de ${codigoModelo}`}
            data-testid="foto-modelo-orden"
          >
            <img
              src={foto.urlDescarga}
              alt={`Foto de ${codigoModelo}`}
              className="size-full object-cover"
            />
          </button>
        ))}
      </div>

      <VisorImagen
        abierto={ampliada !== null}
        alCambiarAbierto={(abierto) => {
          if (!abierto) {
            setAmpliada(null);
          }
        }}
        url={ampliada ?? ''}
        textoAlt={alt}
        nombreArchivo={`${codigoModelo}.jpg`}
        testid="foto-orden"
      />
    </>
  );
}
