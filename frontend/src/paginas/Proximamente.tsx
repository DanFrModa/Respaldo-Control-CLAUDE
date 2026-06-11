import { Construction } from 'lucide-react';
import { useParams } from 'react-router-dom';

import { buscarModuloPorClave, esModuloVisible } from '@/modulos/catalogo';
import { useSesion } from '@/sesion/useSesion';

import { NoEncontrado } from './NoEncontrado';

/**
 * Pagina comodin de los modulos AUN no construidos: las rutas del menu
 * (/modelos, /pedidos, /ruta-critica, …) muestran "Proximamente" hasta que su
 * fase los construya (PLANMAESTRO §6). Cuando un modulo gane pantallas reales
 * (p. ej. /catalogos/almacenes), su ruta especifica tiene prioridad y reemplaza
 * a este comodin sin tocarlo.
 *
 * Un primer segmento que no es modulo, o un modulo que los permisos del usuario
 * no hacen visible, responde "no encontrado" (sin permiso -> oculto, A4).
 */
export function Proximamente(): React.JSX.Element {
  const { modulo: claveModulo } = useParams();
  const { permisos } = useSesion();
  const modulo = buscarModuloPorClave(claveModulo ?? '');

  if (!modulo || !esModuloVisible(modulo, permisos)) {
    return <NoEncontrado />;
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col items-center py-16 text-center">
      <Construction className="size-12 text-muted-foreground" aria-hidden />
      <h1 className="mt-6 text-2xl font-semibold tracking-tight">
        {modulo.titulo}
        {modulo.destacado ? ' ⭐' : ''}
      </h1>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">{modulo.descripcion}.</p>
      <p className="mt-6 rounded-md bg-muted px-4 py-2 text-sm font-medium">
        Próximamente — este módulo se construye en una fase posterior del plan.
      </p>
    </div>
  );
}
