import { Link } from 'react-router-dom';

import { cn } from '@/lib/utils';
import { esModuloVisible, ICONOS_MODULO, MODULOS_MENU } from '@/modulos/catalogo';
import { useSesion } from '@/sesion/useSesion';

/**
 * Portada del módulo Producción (patrón portada-hub, calcada de `InventariosPagina`): lista TODAS
 * las sub-vistas del módulo como tarjetas-enlace con su icono.
 *
 * Por qué existe (V1-E3a, 13-ago-2026): `/produccion` NO tenía pantalla — caía en el comodín
 * `:modulo` de `App.tsx` y anunciaba *"Próximamente"* un módulo terminado desde F3/F4. Y como el
 * riel solo muestra 5 de sus sub-vistas (las de captura diaria y los tableros), las otras se
 * alcanzaban únicamente por ⌘K o URL: esta portada es su índice completo, igual que `/inventarios`
 * lo es del kardex.
 *
 * Las sub-vistas NO se duplican aquí: salen del propio catálogo (`MODULOS_MENU`), filtrando las que
 * son `subVista` y cuya ruta cuelga de `/produccion/`. Cada tarjeta se muestra SOLO si la sesión
 * tiene el permiso de esa sub-vista, con la MISMA mecánica que el riel (`esModuloVisible`, A4). La
 * decisión real de acceso la toma el backend en cada ruta (A1).
 */

/** Sub-vistas del módulo Producción tomadas del catálogo (subVista + ruta /produccion/...). */
const SUBVISTAS_PRODUCCION = MODULOS_MENU.filter(
  (modulo) => modulo.subVista === true && modulo.ruta.startsWith('/produccion/'),
);

export function ProduccionPagina(): React.JSX.Element {
  const { permisos } = useSesion();
  // Solo las sub-vistas que el usuario puede ver (misma mecánica que el riel).
  const visibles = SUBVISTAS_PRODUCCION.filter((modulo) => esModuloVisible(modulo, permisos));

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl p-4 lg:p-6">
        <h1 className="text-[21px] leading-tight font-semibold tracking-tight">Producción</h1>
        <p className="mt-1 text-[12.5px] text-muted-foreground">
          El ciclo de la orden: corte, maquila, recibo y entrega al cliente. El corte, el envío y el
          recibo se capturan en el <b>avance de producción</b> de cada orden (Órdenes (OP) → doble
          clic o «Registrar avance»). Elige una vista.
        </p>

        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visibles.map((sub) => {
            const Icono = ICONOS_MODULO[sub.icono];
            return (
              <Link
                key={sub.clave}
                to={sub.ruta}
                className="group flex items-start gap-3 rounded-xl bg-card p-4 text-card-foreground ring-1 ring-foreground/10 transition-all hover:ring-primary/40 hover:shadow-sm"
                data-testid={`produccion-${sub.clave}`}
              >
                <span
                  aria-hidden
                  className={cn(
                    'flex size-10 shrink-0 items-center justify-center rounded-xl',
                    'bg-primary-soft text-primary-soft-foreground',
                  )}
                >
                  <Icono className="size-5" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="font-heading text-base font-medium">{sub.titulo}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">{sub.descripcion}</p>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
