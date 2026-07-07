import { useParams } from 'react-router-dom';

import { buscarModuloPorClave, esEntradaVisible, ICONOS_MODULO } from '@/modulos/catalogo';
import { useSesion } from '@/sesion/useSesion';

import { NoEncontrado } from './NoEncontrado';

/**
 * Pagina comodin de las pantallas AUN no construidas (rediseño R1): las hojas
 * del menu sin pantalla (Ventas, CxC, CxP, Análisis RC, Auditores, Documental…)
 * caen aqui y muestran su nota de `proximamente` (en que fase llegan). Tambien
 * atiende las rutas legadas de modulos-padre sin aterrizaje propio
 * (/produccion, /compras). Cuando una pantalla real exista, su ruta especifica
 * tiene prioridad y reemplaza a este comodin sin tocarlo.
 *
 * Un primer segmento que no es entrada del menu, o una entrada que los permisos
 * del usuario no hacen visible, responde "no encontrado" (sin permiso ->
 * oculto, A4).
 */
export function Proximamente(): React.JSX.Element {
  const { modulo: claveModulo } = useParams();
  const { permisos } = useSesion();
  const modulo = buscarModuloPorClave(claveModulo ?? '');

  if (!modulo || !esEntradaVisible(modulo, permisos)) {
    return <NoEncontrado />;
  }

  const Icono = ICONOS_MODULO[modulo.icono];
  const nota =
    modulo.hijos === undefined && modulo.proximamente !== undefined
      ? `Próximamente — ${modulo.proximamente}.`
      : 'Próximamente — esta pantalla se construye en una fase posterior del plan.';

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-2xl flex-col items-center px-4 py-16 text-center">
        <span
          aria-hidden
          className="flex size-14 items-center justify-center rounded-xl bg-primary-soft text-primary-soft-foreground"
        >
          <Icono className="size-7" aria-hidden />
        </span>
        <h1 className="mt-5 text-xl font-semibold tracking-tight">
          {modulo.titulo}
          {modulo.destacado ? ' ⭐' : ''}
        </h1>
        <p className="mt-2 max-w-md text-sm text-muted-foreground">{modulo.descripcion}.</p>
        <p className="mt-5 rounded-full bg-primary-soft px-4 py-1.5 text-sm font-medium text-primary-soft-foreground">
          {nota}
        </p>
      </div>
    </div>
  );
}
