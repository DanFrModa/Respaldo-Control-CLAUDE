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
    <div className="flex h-full flex-col overflow-y-auto p-4 md:p-5">
      {/* page-head del proto vPlaceholder: título + sub genérico del sistema. */}
      <header className="shrink-0">
        <h1 className="text-[21px] leading-tight font-semibold tracking-tight">
          {modulo.titulo}
          {modulo.destacado ? ' ⭐' : ''}
        </h1>
        <p className="mt-0.5 text-[12.5px] text-muted-foreground">Módulo del sistema CONTROL v2</p>
      </header>

      {/* .placeholder del proto: bloque centrado (ícono 56px + título 17px + texto acotado). */}
      <div className="grid min-h-[60vh] flex-1 place-items-center text-center">
        <div className="flex flex-col items-center px-4">
          <span
            aria-hidden
            className="grid size-14 place-items-center rounded-[14px] bg-primary-soft text-primary"
          >
            <Icono className="size-[26px]" aria-hidden />
          </span>
          <h2 className="mt-3.5 text-[17px] font-semibold">{modulo.titulo}</h2>
          <p className="mt-1.5 max-w-[380px] text-sm text-muted-foreground">
            {modulo.descripcion}.
          </p>
          <p className="mt-4 rounded-full bg-primary-soft px-4 py-1.5 text-sm font-medium text-primary-soft-foreground">
            {nota}
          </p>
        </div>
      </div>
    </div>
  );
}
