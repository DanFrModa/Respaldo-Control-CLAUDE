import { ChevronRight, Star } from 'lucide-react';
import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useConteoAlertasRc } from '@/api/ruta-critica-programacion';
import { cn } from '@/lib/utils';
import { useSesion } from '@/sesion/useSesion';

import {
  type EntradaMenu,
  type GrupoMenu,
  ICONOS_MODULO,
  type ModuloMenu,
  type PadreMenu,
} from './catalogo';

/**
 * NAVEGACION del riel oscuro (rediseño R1, proto `.rail-scroll`): grupos con
 * rotulo en mayusculas chicas + entradas de primer nivel; un PADRE despliega a
 * sus hijos (no navega) y una HOJA navega. Se usa en el riel de escritorio
 * (expandido o COLAPSADO) y dentro del Sheet de movil (mismo look oscuro).
 *
 * Reglas de despliegue:
 *  - El padre que contiene la ruta ACTIVA se abre solo (y al navegar con la
 *    paleta ⌘K tambien); los demas conservan lo que el usuario abrio/cerro.
 *  - En modo colapsado los hijos no caben: el clic en un padre pide EXPANDIR el
 *    riel (`alExpandirColapsado`) y deja el padre abierto.
 *
 * Badge con datos REALES: SOLO Ruta Critica (conteo de alertas del backend,
 * mismo cache que el badge del encabezado). Los numeros del prototipo eran
 * maqueta y NO se copian.
 */
export function NavegacionModulos({
  grupos,
  colapsado = false,
  alNavegar,
  alExpandirColapsado,
}: {
  grupos: readonly GrupoMenu[];
  /** En escritorio, si el riel esta colapsado (solo iconos + tooltip). */
  colapsado?: boolean;
  /** En movil cierra el Sheet al elegir una pantalla. */
  alNavegar?: () => void;
  /** En colapsado, el clic a un padre expande el riel para mostrar sus hijos. */
  alExpandirColapsado?: () => void;
}): React.JSX.Element {
  const location = useLocation();
  const { tienePermiso } = useSesion();

  // Conteo de alertas RC para el badge del menu (comparte cache con el badge
  // del encabezado; se apaga sin permiso). CERO logica de negocio (A1).
  const puedeVerRc = tienePermiso('rc.ruta-ver');
  const alertas = useConteoAlertasRc({ habilitado: puedeVerRc });
  const atrasados = alertas.data?.atrasados ?? 0;
  const totalAlertas = atrasados + (alertas.data?.enRiesgo ?? 0);

  // Estado abierto/cerrado por clave de padre (solo lo que el usuario toco).
  const [abiertos, setAbiertos] = useState<Record<string, boolean>>({});

  // El padre que contiene la ruta activa se abre solo (sin cerrar los demas).
  useEffect(() => {
    const padreActivo = grupos
      .flatMap((grupo) => grupo.entradas)
      .find((entrada) => entrada.hijos !== undefined && contieneRuta(entrada, location.pathname));
    if (padreActivo !== undefined) {
      setAbiertos((previos) =>
        previos[padreActivo.clave] === true ? previos : { ...previos, [padreActivo.clave]: true },
      );
    }
  }, [grupos, location.pathname]);

  function alternarPadre(padre: PadreMenu): void {
    if (colapsado) {
      // En el riel angosto no hay lugar para hijos: expandir y dejar abierto.
      alExpandirColapsado?.();
      setAbiertos((previos) => ({ ...previos, [padre.clave]: true }));
      return;
    }
    setAbiertos((previos) => ({ ...previos, [padre.clave]: previos[padre.clave] !== true }));
  }

  return (
    <nav aria-label="Módulos" className="flex flex-col px-2 pt-1 pb-3">
      {grupos.map((grupo) => (
        <div key={grupo.clave} className="flex flex-col gap-px">
          {grupo.titulo !== null && !colapsado ? (
            <div className="px-2.5 pt-3.5 pb-1 text-[10px] font-semibold tracking-[0.13em] text-rail-fg/60 uppercase">
              {grupo.titulo}
            </div>
          ) : null}
          {grupo.titulo !== null && colapsado ? (
            // Colapsado: el rotulo no cabe; un separador fino mantiene el ritmo.
            <div aria-hidden className="mx-2 my-2 h-px bg-rail-border" />
          ) : null}
          {grupo.entradas.map((entrada) =>
            entrada.hijos === undefined ? (
              <HojaNav
                key={entrada.clave}
                hoja={entrada}
                colapsado={colapsado}
                alNavegar={alNavegar}
              />
            ) : (
              <PadreNav
                key={entrada.clave}
                padre={entrada}
                abierto={abiertos[entrada.clave] === true && !colapsado}
                activo={contieneRuta(entrada, location.pathname)}
                colapsado={colapsado}
                alAlternar={() => alternarPadre(entrada)}
                alNavegar={alNavegar}
                // Badge real SOLO en Ruta Critica (dato del backend, no maqueta).
                badge={
                  entrada.clave === 'ruta-critica' && puedeVerRc && totalAlertas > 0
                    ? { total: totalAlertas, critico: atrasados > 0 }
                    : undefined
                }
              />
            ),
          )}
        </div>
      ))}
    </nav>
  );
}

/** ¿La ruta actual vive dentro de este padre? (activa el resaltado del padre). */
function contieneRuta(entrada: EntradaMenu, pathname: string): boolean {
  if (entrada.hijos === undefined) {
    return false;
  }
  return entrada.hijos.some(
    (hijo) => hijo.ruta !== '/' && (pathname === hijo.ruta || pathname.startsWith(`${hijo.ruta}/`)),
  );
}

/** Una HOJA de primer nivel: navega. Icono quieto; el texto se desvanece al colapsar. */
function HojaNav({
  hoja,
  colapsado,
  alNavegar,
}: {
  hoja: ModuloMenu;
  colapsado: boolean;
  alNavegar?: (() => void) | undefined;
}): React.JSX.Element {
  const Icono = ICONOS_MODULO[hoja.icono];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <NavLink
          to={hoja.ruta}
          end={hoja.ruta === '/'}
          onClick={alNavegar}
          aria-label={colapsado ? hoja.titulo : undefined}
          className={({ isActive }) =>
            cn(
              'relative flex items-center rounded-lg py-1.5 text-sm transition-colors duration-150',
              colapsado ? 'justify-center px-2 py-2' : 'gap-2.5 px-2.5',
              isActive
                ? 'bg-rail-active text-rail-active-fg'
                : 'text-rail-fg hover:bg-white/5 hover:text-rail-fg-strong',
            )
          }
        >
          {({ isActive }) => (
            <>
              {isActive ? (
                <span
                  aria-hidden
                  className="absolute top-1/2 -left-2 h-4.5 w-0.5 -translate-y-1/2 rounded-r-sm bg-primary-bright"
                />
              ) : null}
              <Icono className={cn('size-4 shrink-0', colapsado && 'mx-auto')} aria-hidden />
              <span
                className={cn(
                  'flex min-w-0 flex-1 items-center overflow-hidden whitespace-nowrap transition-[max-width,opacity] duration-200 ease-in-out',
                  colapsado ? 'max-w-0 opacity-0' : 'max-w-[12rem] opacity-100',
                )}
              >
                <span className="truncate">{hoja.titulo}</span>
              </span>
            </>
          )}
        </NavLink>
      </TooltipTrigger>
      {colapsado ? <TooltipContent side="right">{hoja.titulo}</TooltipContent> : null}
    </Tooltip>
  );
}

/** Un PADRE: boton que despliega a sus hijos (no navega). */
function PadreNav({
  padre,
  abierto,
  activo,
  colapsado,
  alAlternar,
  alNavegar,
  badge,
}: {
  padre: PadreMenu;
  abierto: boolean;
  activo: boolean;
  colapsado: boolean;
  alAlternar: () => void;
  alNavegar?: (() => void) | undefined;
  badge?: { total: number; critico: boolean } | undefined;
}): React.JSX.Element {
  const Icono = ICONOS_MODULO[padre.icono];
  return (
    <div>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={alAlternar}
            aria-expanded={abierto}
            aria-label={colapsado ? padre.titulo : undefined}
            data-testid={`nav-padre-${padre.clave}`}
            className={cn(
              'relative flex w-full cursor-pointer items-center rounded-lg py-1.5 text-left text-sm transition-colors duration-150',
              colapsado ? 'justify-center px-2 py-2' : 'gap-2.5 px-2.5',
              activo ? 'text-rail-fg-strong' : 'text-rail-fg',
              'hover:bg-white/5 hover:text-rail-fg-strong',
            )}
          >
            <Icono className={cn('size-4 shrink-0', colapsado && 'mx-auto')} aria-hidden />
            {/* Riel COLAPSADO: el badge no cabe → puntito de alerta sobre el icono (R2, pendiente
                (e) de R1). El color sigue la severidad del badge expandido. */}
            {colapsado && badge !== undefined ? (
              <span
                aria-hidden
                data-testid={`nav-punto-${padre.clave}`}
                className={cn(
                  'absolute top-1 right-1.5 size-2 rounded-full ring-2 ring-rail',
                  badge.critico ? 'bg-crit' : 'bg-warn',
                )}
              />
            ) : null}
            <span
              className={cn(
                'flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden whitespace-nowrap transition-[max-width,opacity] duration-200 ease-in-out',
                colapsado ? 'max-w-0 opacity-0' : 'max-w-[13rem] opacity-100',
              )}
            >
              <span className="truncate">{padre.titulo}</span>
              {padre.destacado ? (
                <Star className="size-3 shrink-0 fill-amber-400 text-amber-400" aria-hidden />
              ) : null}
              {badge === undefined ? null : (
                <span
                  data-testid={`nav-badge-${padre.clave}`}
                  className={cn(
                    'ml-auto rounded-full px-1.5 py-px text-[10.5px] font-semibold',
                    badge.critico ? 'bg-crit/30 text-red-200' : 'bg-white/10 text-rail-fg-strong',
                  )}
                >
                  {badge.total > 99 ? '99+' : badge.total}
                </span>
              )}
              <ChevronRight
                aria-hidden
                className={cn(
                  'size-3.5 shrink-0 opacity-55 transition-transform duration-150',
                  badge === undefined && 'ml-auto',
                  abierto && 'rotate-90',
                )}
              />
            </span>
          </button>
        </TooltipTrigger>
        {colapsado ? (
          <TooltipContent side="right">
            {padre.titulo}
            {padre.destacado ? ' ⭐' : ''}
          </TooltipContent>
        ) : null}
      </Tooltip>

      {/* Hijos (guia vertical a la izquierda, proto `.nav-children`). */}
      {abierto ? (
        <div className="relative mt-px mb-1 ml-[1.35rem] flex flex-col gap-px border-l border-rail-border pl-2">
          {padre.hijos.map((hijo) => (
            <NavLink
              key={hijo.clave}
              to={hijo.ruta}
              onClick={alNavegar}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2 rounded-md px-2 py-1 text-[12.5px] transition-colors duration-150',
                  isActive
                    ? 'bg-rail-active text-rail-active-fg'
                    : 'text-rail-fg hover:bg-white/5 hover:text-rail-fg-strong',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <span
                    aria-hidden
                    className={cn(
                      'size-[5px] shrink-0 rounded-full bg-current',
                      isActive ? 'opacity-100' : 'opacity-45',
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate">{hijo.titulo}</span>
                </>
              )}
            </NavLink>
          ))}
        </div>
      ) : null}
    </div>
  );
}
