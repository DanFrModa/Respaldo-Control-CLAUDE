import { useNavigate } from 'react-router-dom';

import { useSesion } from '@/sesion/useSesion';

import { PestanasSegmentadas, type PestanaSegmentada } from './PestanasSegmentadas';

/** Las tres vistas del módulo PT (proto `vInventarios` `.tabs`). */
export type VistaInventarioPt = 'existencias' | 'movimientos' | 'traspasos';

const RUTAS: Record<VistaInventarioPt, string> = {
  existencias: '/inventarios/existencias',
  movimientos: '/inventarios/movimientos',
  traspasos: '/inventarios/traspasos',
};

/**
 * Riel Existencias / Movimientos / Traspasos del inventario PT (proto `vInventarios`): el proto es
 * UNA vista con pestañas segmentadas; en la app cada pestaña es una ruta y este riel las navega,
 * el MISMO en las tres pantallas (antes solo Existencias lo tenía y las capturas quedaban sueltas).
 * Las pestañas de captura solo aparecen con `inventario-pt.mover` (misma regla que el botón
 * "Movimiento"; el backend re-decide, A1).
 */
export function PestanasInventarioPt({ activa }: { activa: VistaInventarioPt }): React.JSX.Element {
  const navigate = useNavigate();
  const { tienePermiso } = useSesion();
  const puedeMover = tienePermiso('inventario-pt.mover');

  const opciones: PestanaSegmentada<VistaInventarioPt>[] = [
    { valor: 'existencias', etiqueta: 'Existencias' },
    ...(puedeMover
      ? ([
          { valor: 'movimientos', etiqueta: 'Movimientos' },
          { valor: 'traspasos', etiqueta: 'Traspasos' },
        ] as PestanaSegmentada<VistaInventarioPt>[])
      : []),
  ];

  return (
    <PestanasSegmentadas
      opciones={opciones}
      valor={activa}
      alCambiar={(vista) => void navigate(RUTAS[vista])}
      etiqueta="Vistas de inventario PT"
    />
  );
}
