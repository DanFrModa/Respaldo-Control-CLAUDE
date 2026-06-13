import { Star } from 'lucide-react';
import { NavLink } from 'react-router-dom';

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

import { ICONOS_MODULO, type ModuloMenu } from './catalogo';

/**
 * Lista de navegacion de los modulos visibles (rediseño "Teal fresco"). Se usa en
 * el sidebar de escritorio (expandido o COLAPSADO) y dentro del Sheet de movil.
 * `NavLink` marca activo el modulo cuya ruta coincide (incluye sub-rutas, p. ej.
 * /catalogos/almacenes activa Catalogos): fondo teal (sidebar-accent) + barra de
 * acento a la izquierda.
 *
 * Colapsado: solo el icono, centrado, con un Tooltip a la derecha que muestra el
 * nombre; cada enlace conserva `aria-label={modulo.titulo}` para no perder el
 * nombre accesible. Expandido: icono + label + estrella si el modulo es destacado.
 */
export function NavegacionModulos({
  modulos,
  colapsado = false,
  alNavegar,
}: {
  modulos: readonly ModuloMenu[];
  /** En escritorio, si el sidebar esta colapsado (solo iconos + tooltip). */
  colapsado?: boolean;
  /** En movil cierra el Sheet al elegir un modulo. */
  alNavegar?: () => void;
}): React.JSX.Element {
  return (
    <nav aria-label="Módulos" className="flex flex-col gap-1 p-2">
      {modulos.map((modulo) => {
        const Icono = ICONOS_MODULO[modulo.icono];
        const enlace = (
          <NavLink
            key={modulo.clave}
            to={modulo.ruta}
            onClick={alNavegar}
            aria-label={colapsado ? modulo.titulo : undefined}
            className={({ isActive }) =>
              cn(
                'group/nav relative flex items-center rounded-lg text-sm font-medium transition-colors',
                colapsado ? 'h-10 w-10 justify-center' : 'gap-3 px-3 py-2',
                isActive
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                  : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground',
              )
            }
          >
            {({ isActive }) => (
              <>
                {/* Barra de acento a la izquierda cuando esta activo. */}
                {isActive ? (
                  <span
                    aria-hidden
                    className={cn(
                      'absolute top-1/2 left-0 h-5 w-1 -translate-y-1/2 rounded-r-full bg-sidebar-primary',
                      colapsado && '-left-1',
                    )}
                  />
                ) : null}
                <Icono className="size-4 shrink-0" aria-hidden />
                {colapsado ? null : (
                  <>
                    <span className="truncate">{modulo.titulo}</span>
                    {modulo.destacado ? (
                      <Star
                        className="ml-auto size-3.5 shrink-0 fill-amber-400 text-amber-400"
                        aria-hidden
                      />
                    ) : null}
                  </>
                )}
              </>
            )}
          </NavLink>
        );

        // Colapsado: el icono lleva tooltip a la derecha con el nombre del modulo.
        if (colapsado) {
          return (
            <Tooltip key={modulo.clave}>
              <TooltipTrigger asChild>{enlace}</TooltipTrigger>
              <TooltipContent side="right">
                {modulo.titulo}
                {modulo.destacado ? ' ⭐' : ''}
              </TooltipContent>
            </Tooltip>
          );
        }
        return enlace;
      })}
    </nav>
  );
}
