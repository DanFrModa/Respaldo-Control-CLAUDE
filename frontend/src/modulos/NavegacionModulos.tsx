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
 * NAVEGACION del riel oscuro (rediseño R1 → fidelidad R9, proto `.rail-scroll`):
 * grupos con rotulo en mayusculas chicas + entradas de primer nivel; un PADRE
 * despliega a sus hijos (no navega) y una HOJA navega. Se usa en el riel de
 * escritorio (expandido o COLAPSADO) y dentro del Sheet de movil (mismo look).
 *
 * Reglas de despliegue:
 *  - «Producción» arranca ABIERTA por default (como el prototipo, que pre-abre
 *    `g-produccion` para mostrar el anidado); el usuario puede cerrarla.
 *  - El padre que contiene la ruta ACTIVA se abre solo (y al navegar con la
 *    paleta ⌘K tambien); los demas conservan lo que el usuario abrio/cerro.
 *  - En modo colapsado los hijos no caben: el clic en un padre pide EXPANDIR el
 *    riel (`alExpandirColapsado`) y deja el padre abierto.
 *
 * Badge con datos REALES: SOLO Ruta Critica (conteo de alertas del backend,
 * mismo cache que la campana de la topbar) — hoy es HOJA directa (R4), asi que
 * el badge va en la hoja. Los numeros del prototipo en Pedidos y Órdenes (OP)
 * eran maqueta y NO se copian (no existe un endpoint de conteo). Los chips son
 * `aria-hidden` para no ensuciar el nombre accesible del link/boton.
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

  // Conteo de alertas RC para el badge del menu (comparte cache con la campana
  // de la topbar; se apaga sin permiso). CERO logica de negocio (A1).
  const puedeVerRc = tienePermiso('rc.ruta-ver');
  const alertas = useConteoAlertasRc({ habilitado: puedeVerRc });
  const atrasados = alertas.data?.atrasados ?? 0;
  const totalAlertas = atrasados + (alertas.data?.enRiesgo ?? 0);
  const badgeRc =
    puedeVerRc && totalAlertas > 0 ? { total: totalAlertas, critico: atrasados > 0 } : undefined;

  // Estado abierto/cerrado por clave de padre. «Producción» arranca abierta
  // (fidelidad al proto); despues manda lo que el usuario toque.
  const [abiertos, setAbiertos] = useState<Record<string, boolean>>({ produccion: true });

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
    <nav aria-label="Módulos" className="flex flex-col px-2 pt-2 pb-3">
      {grupos.map((grupo) => (
        <div key={grupo.clave} className="flex flex-col gap-px">
          {grupo.titulo !== null && !colapsado ? (
            <div className="px-2.5 pt-3.5 pb-[5px] text-[10px] font-semibold tracking-[0.13em] text-rail-fg/60 uppercase">
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
                // Badge real SOLO en Ruta Critica (dato del backend, no maqueta).
                badge={entrada.clave === 'ruta-critica' ? badgeRc : undefined}
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
                badge={entrada.clave === 'ruta-critica' ? badgeRc : undefined}
              />
            ),
          )}
        </div>
      ))}
    </nav>
  );
}

/** Conteo para el chip de un item del riel (rojo si hay algo critico). */
interface BadgeNav {
  total: number;
  critico: boolean;
}

/**
 * Chip de conteo del riel (proto `.nav-badge`): 10.5px/600, pastilla con fondo
 * blanco al 9 % — o ROJA (`.hot`) si hay algo critico. `aria-hidden`: el numero
 * no debe colarse en el nombre accesible del link (lo anuncia la campana).
 */
function BadgeNavChip({ badge, testid }: { badge: BadgeNav; testid: string }): React.JSX.Element {
  return (
    <span
      aria-hidden
      data-testid={testid}
      className={cn(
        'ml-auto rounded-full px-1.5 py-px text-[10.5px] font-semibold',
        badge.critico ? 'bg-crit/30 text-[#ffb4b4]' : 'bg-white/[0.09] text-rail-fg-strong',
      )}
    >
      {badge.total > 99 ? '99+' : badge.total}
    </span>
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
  badge,
}: {
  hoja: ModuloMenu;
  colapsado: boolean;
  alNavegar?: (() => void) | undefined;
  badge?: BadgeNav | undefined;
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
              'relative flex items-center rounded-[8px] text-sm transition-colors duration-150',
              colapsado ? 'justify-center px-0 py-[9px]' : 'gap-[11px] px-2.5 py-[7px]',
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
                  className="absolute top-1/2 -left-2 h-[18px] w-[3px] -translate-y-1/2 rounded-r-[3px] bg-primary-bright"
                />
              ) : null}
              <Icono
                className={cn(
                  'size-[17px] shrink-0',
                  isActive ? 'opacity-100' : 'opacity-90',
                  colapsado && 'mx-auto',
                )}
                aria-hidden
              />
              {/* Riel COLAPSADO: el badge no cabe → puntito de alerta sobre el icono. */}
              {colapsado && badge !== undefined ? (
                <span
                  aria-hidden
                  data-testid={`nav-punto-${hoja.clave}`}
                  className={cn(
                    'absolute top-1 right-1.5 size-2 rounded-full ring-2 ring-rail',
                    badge.critico ? 'bg-crit' : 'bg-warn',
                  )}
                />
              ) : null}
              <span
                className={cn(
                  'flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden whitespace-nowrap transition-[max-width,opacity] duration-200 ease-in-out',
                  colapsado ? 'max-w-0 opacity-0' : 'max-w-[12rem] opacity-100',
                )}
              >
                <span className="truncate">{hoja.titulo}</span>
                {badge === undefined ? null : (
                  <BadgeNavChip badge={badge} testid={`nav-badge-${hoja.clave}`} />
                )}
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
  badge?: BadgeNav | undefined;
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
              'relative flex w-full cursor-pointer items-center rounded-[8px] text-left text-sm transition-colors duration-150',
              colapsado ? 'justify-center px-0 py-[9px]' : 'gap-[11px] px-2.5 py-[7px]',
              activo ? 'text-rail-fg-strong' : 'text-rail-fg',
              'hover:bg-white/5 hover:text-rail-fg-strong',
            )}
          >
            <Icono
              className={cn('size-[17px] shrink-0 opacity-90', colapsado && 'mx-auto')}
              aria-hidden
            />
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
                <BadgeNavChip badge={badge} testid={`nav-badge-${padre.clave}`} />
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

      {/* Hijos (proto `.nav-children`: sangria de 18px con guia vertical a 3px). */}
      {abierto ? (
        <div className="relative mt-px mb-1 ml-[18px] flex flex-col gap-px">
          <span aria-hidden className="absolute top-1 bottom-1 left-[3px] w-px bg-rail-border" />
          {padre.hijos.map((hijo) => (
            <NavLink
              key={hijo.clave}
              to={hijo.ruta}
              onClick={alNavegar}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-[9px] rounded-[8px] py-1.5 pr-2.5 pl-3.5 text-[12.5px] transition-colors duration-150',
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
