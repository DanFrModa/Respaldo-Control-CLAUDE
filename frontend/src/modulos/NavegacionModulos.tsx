import {
  Banknote,
  Calculator,
  ChartLine,
  Factory,
  Files,
  Library,
  type LucideIcon,
  Medal,
  Package,
  Route,
  Settings,
  Shirt,
  ShoppingCart,
  Star,
  Warehouse,
} from 'lucide-react';
import { NavLink } from 'react-router-dom';

import { cn } from '@/lib/utils';

import type { IconoModulo, ModuloMenu } from './catalogo';

/** Resolucion nombre estable -> componente Lucide. */
const ICONOS: Record<IconoModulo, LucideIcon> = {
  libreria: Library,
  camisa: Shirt,
  carrito: ShoppingCart,
  fabrica: Factory,
  paquete: Package,
  almacen: Warehouse,
  ruta: Route,
  medalla: Medal,
  billete: Banknote,
  calculadora: Calculator,
  grafica: ChartLine,
  archivo: Files,
  engrane: Settings,
};

/**
 * Lista de navegacion de los modulos visibles. Se usa igual en el sidebar de
 * escritorio y dentro del Sheet de movil; `NavLink` marca activo el modulo cuya
 * ruta coincide (incluye sub-rutas, p. ej. /catalogos/almacenes activa
 * Catalogos).
 */
export function NavegacionModulos({
  modulos,
  alNavegar,
}: {
  modulos: readonly ModuloMenu[];
  /** En movil cierra el Sheet al elegir un modulo. */
  alNavegar?: () => void;
}): React.JSX.Element {
  return (
    <nav aria-label="Módulos" className="flex flex-col gap-1 p-2">
      {modulos.map((modulo) => {
        const Icono = ICONOS[modulo.icono];
        return (
          <NavLink
            key={modulo.clave}
            to={modulo.ruta}
            onClick={alNavegar}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                  : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
              )
            }
          >
            <Icono className="size-4 shrink-0" aria-hidden />
            <span className="truncate">{modulo.titulo}</span>
            {modulo.destacado ? (
              <Star
                className="ml-auto size-3.5 shrink-0 fill-amber-400 text-amber-400"
                aria-hidden
              />
            ) : null}
          </NavLink>
        );
      })}
    </nav>
  );
}
