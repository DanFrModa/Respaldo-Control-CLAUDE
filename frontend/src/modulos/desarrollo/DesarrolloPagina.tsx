import { useState } from 'react';

import { ProyectosPagina } from './ProyectosPagina';
import { TableroDesarrollos } from './TableroDesarrollos';

/** Las dos vistas del módulo Desarrollo (F8): la lista de proyectos y el tablero por estado. */
type Pestana = 'proyectos' | 'tablero';

const PESTANAS: readonly { clave: Pestana; etiqueta: string }[] = [
  { clave: 'proyectos', etiqueta: 'Proyectos' },
  { clave: 'tablero', etiqueta: 'Tablero por estado' },
];

/**
 * Contenedor del módulo Desarrollo (F8) con dos PESTAÑAS, para NO agregar una entrada extra al menú
 * (F8-E6): "Proyectos" (la lista+detalle de F8-E2) y "Tablero por estado" (conteos agregados en
 * servidor, F8-E6). La barra de pestañas es una franja fija; el contenido llena el resto (`h-full`).
 */
export function DesarrolloPagina(): React.JSX.Element {
  const [pestana, setPestana] = useState<Pestana>('proyectos');

  return (
    <div className="flex h-full flex-col">
      <div
        className="flex gap-1 border-b px-4 pt-2 lg:px-6"
        role="tablist"
        aria-label="Vistas de Desarrollo"
      >
        {PESTANAS.map((p) => (
          <button
            key={p.clave}
            type="button"
            role="tab"
            aria-selected={pestana === p.clave}
            onClick={() => setPestana(p.clave)}
            data-testid={`tab-desarrollo-${p.clave}`}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              pestana === p.clave
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {p.etiqueta}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1">
        {pestana === 'proyectos' ? <ProyectosPagina /> : <TableroDesarrollos />}
      </div>
    </div>
  );
}
