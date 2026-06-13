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
 * Colapso SIN parpadeo (un solo DOM, solo cambian clases): el `NavLink` y su
 * icono estan SIEMPRE montados y nunca se remontan. El `Tooltip` envuelve igual
 * en ambos estados (el `NavLink` no sale del trigger); solo el `TooltipContent`
 * es condicional (no afecta al icono). El nombre del modulo SIEMPRE se renderiza
 * y al colapsar se anima a ancho/opacidad 0 (se desvanece); el icono se queda
 * quieto y, en colapsado, el item centra el icono (`justify-center`) en el riel
 * angosto. Cada enlace conserva `aria-label={modulo.titulo}` en colapsado.
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
        // El NavLink va SIEMPRE dentro del mismo Tooltip/Trigger (no se remonta al
        // colapsar). Solo el TooltipContent es condicional: aparece colapsado para
        // mostrar el nombre que el texto desvanecido ya no muestra.
        return (
          <Tooltip key={modulo.clave}>
            <TooltipTrigger asChild>
              <NavLink
                to={modulo.ruta}
                onClick={alNavegar}
                aria-label={colapsado ? modulo.titulo : undefined}
                className={({ isActive }) =>
                  cn(
                    'group/nav relative flex items-center rounded-lg py-2 text-sm font-medium transition-[background-color,color,padding] duration-200',
                    // Colapsado: icono centrado en el riel angosto; expandido: a la
                    // izquierda con hueco para el nombre. Solo cambian clases.
                    colapsado ? 'justify-center px-2' : 'gap-3 px-3',
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
                        className="absolute top-1/2 left-0 h-5 w-1 -translate-y-1/2 rounded-r-full bg-sidebar-primary"
                      />
                    ) : null}
                    <Icono className="size-4 shrink-0" aria-hidden />
                    {/* Nombre + estrella SIEMPRE montados; al colapsar se animan a
                        ancho/opacidad 0 (overflow oculto) sin remontarse. */}
                    <span
                      className={cn(
                        'flex min-w-0 flex-1 items-center overflow-hidden whitespace-nowrap transition-[max-width,opacity] duration-200 ease-in-out',
                        colapsado ? 'max-w-0 opacity-0' : 'max-w-[12rem] opacity-100',
                      )}
                    >
                      <span className="truncate">{modulo.titulo}</span>
                      {modulo.destacado ? (
                        <Star
                          className="ml-auto size-3.5 shrink-0 fill-amber-400 text-amber-400"
                          aria-hidden
                        />
                      ) : null}
                    </span>
                  </>
                )}
              </NavLink>
            </TooltipTrigger>
            {colapsado ? (
              <TooltipContent side="right">
                {modulo.titulo}
                {modulo.destacado ? ' ⭐' : ''}
              </TooltipContent>
            ) : null}
          </Tooltip>
        );
      })}
    </nav>
  );
}
