import { useParams } from 'react-router-dom';

import { buscarModuloPorClave, esModuloVisible, ICONOS_MODULO } from '@/modulos/catalogo';
import { useSesion } from '@/sesion/useSesion';

import { NoEncontrado } from './NoEncontrado';

/**
 * Pagina comodin de los modulos AUN no construidos (rediseño "Teal fresco"): las
 * rutas del menu (/modelos, /pedidos, /ruta-critica, …) muestran "Proximamente"
 * hasta que su fase los construya (PLANMAESTRO §6). Cuando un modulo gane pantallas
 * reales (p. ej. /catalogos/almacenes), su ruta especifica tiene prioridad y
 * reemplaza a este comodin sin tocarlo.
 *
 * Un primer segmento que no es modulo, o un modulo que los permisos del usuario no
 * hacen visible, responde "no encontrado" (sin permiso -> oculto, A4).
 */
export function Proximamente(): React.JSX.Element {
  const { modulo: claveModulo } = useParams();
  const { permisos } = useSesion();
  const modulo = buscarModuloPorClave(claveModulo ?? '');

  if (!modulo || !esModuloVisible(modulo, permisos)) {
    return <NoEncontrado />;
  }

  const Icono = ICONOS_MODULO[modulo.icono];

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-2xl flex-col items-center px-4 py-16 text-center">
        <span
          aria-hidden
          className="flex size-16 items-center justify-center rounded-2xl bg-primary-soft text-primary-soft-foreground"
        >
          <Icono className="size-8" aria-hidden />
        </span>
        <h1 className="mt-6 text-2xl font-semibold tracking-tight">
          {modulo.titulo}
          {modulo.destacado ? ' ⭐' : ''}
        </h1>
        <p className="mt-2 max-w-md text-sm text-muted-foreground">{modulo.descripcion}.</p>
        <p className="mt-6 rounded-full bg-primary-soft px-4 py-1.5 text-sm font-medium text-primary-soft-foreground">
          Próximamente — este módulo se construye en una fase posterior del plan.
        </p>
      </div>
    </div>
  );
}
