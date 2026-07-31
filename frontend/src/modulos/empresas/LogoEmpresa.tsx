import { toast } from 'sonner';

import { useLogoEmpresa, useQuitarLogoEmpresa, useSubirLogoEmpresa } from '@/api/empresas';
import type { Empresa } from '@/api/tipos';
import { SubidaImagen } from '@/componentes/SubidaImagen';

/** Solo PNG y JPG: son los formatos que se pueden incrustar en los impresos PDF. */
const MIME_LOGO = ['image/png', 'image/jpeg'];

/** Tope de 5 MB (el mismo que valida el servidor): el logo viaja dentro de cada PDF. */
const TAMANO_MAXIMO_LOGO = 5 * 1024 * 1024;

/**
 * LOGO de la empresa (post-F9, petición de Daniel del 25-jul-2026) — **el único lugar donde se
 * cambia la marca de todo el sistema**: al subirlo aquí se actualizan solos los 23 formatos de
 * impresión (el membrete de todos los PDF) y la app (riel, menú móvil), sin desplegar nada.
 *
 * Conecta el componente reutilizable `SubidaImagen` con los hooks del logo (presigned
 * PUT/GET/DELETE), igual que `FotoBordado` con la foto del bordado. Diferencias propias del logo:
 * `contain` (un logo NO se puede recortar) y fondo blanco en la vista previa (el logo es oscuro y
 * sobre el `bg-muted` del tema oscuro no se vería).
 *
 * Si la empresa no tiene logo propio, el sistema usa el que viene empaquetado en el repo: por eso
 * el placeholder no dice "sin imagen" a secas, sino que explica qué pasa mientras tanto.
 */
export function LogoEmpresa({
  empresa,
  deshabilitado = false,
}: {
  empresa: Empresa;
  /** Sin `empresas.administrar` la vista previa se ve, pero no se puede cambiar. */
  deshabilitado?: boolean;
}): React.JSX.Element {
  const consulta = useLogoEmpresa(empresa.id);
  const subir = useSubirLogoEmpresa();
  const quitar = useQuitarLogoEmpresa();

  function alElegirArchivo(archivo: File): void {
    subir.mutate(
      { idEmpresa: empresa.id, archivo },
      {
        onSuccess: () =>
          toast.success('Logo actualizado. Ya sale en los impresos y en el sistema.'),
        onError: (error) => toast.error(error.message),
      },
    );
  }

  function alQuitar(): void {
    quitar.mutate(empresa.id, {
      onSuccess: () => toast.success('Logo quitado. Se usará el logo que trae el sistema.'),
      onError: (error) => toast.error(error.message),
    });
  }

  // Error de LECTURA del logo (la subida/borrado los reporta el toast).
  const errorLectura = consulta.isError ? consulta.error.message : null;

  return (
    <div className="flex flex-col gap-2" data-testid="logo-empresa">
      <SubidaImagen
        urlImagen={consulta.data?.urlDescarga ?? null}
        textoAlt={`Logo de ${empresa.nombre}`}
        alElegirArchivo={alElegirArchivo}
        {...(deshabilitado ? {} : { alQuitar })}
        subiendo={subir.isPending}
        quitando={quitar.isPending}
        deshabilitado={deshabilitado}
        error={errorLectura}
        textoPlaceholder="Sin logo propio"
        tiposAceptados={MIME_LOGO}
        tamanoMaximoBytes={TAMANO_MAXIMO_LOGO}
        ajuste="contain"
        claseVistaPrevia="bg-white"
        testid="logo-empresa"
      />
      <p className="max-w-prose text-xs text-muted-foreground">
        Este logo se usa en el <b>membrete de todos los formatos de impresión</b> y en el menú del
        sistema. Cámbialo aquí y se actualiza en todos lados de inmediato. PNG o JPG, hasta 5 MB.
        {consulta.data?.urlDescarga
          ? null
          : ' Mientras no subas uno, se usa el que trae el sistema.'}
      </p>
    </div>
  );
}
