import { Link } from 'react-router-dom';

import { cn } from '@/lib/utils';
import { esModuloVisible, ICONOS_MODULO, MODULOS_MENU } from '@/modulos/catalogo';
import { useSesion } from '@/sesion/useSesion';

/**
 * Portada del módulo Ruta Crítica (rediseño "Teal fresco"), modelada en
 * `InventariosPagina`/`CatalogosPagina`/`AdministracionPagina`: lista las sub-vistas
 * de la RC (bandeja de tareas, catálogo de procesos, dependencias, plantillas y
 * reglas de duración) como tarjetas-enlace con su icono de color.
 *
 * Las sub-vistas NO se duplican aquí: salen del propio menú (`MODULOS_MENU`),
 * filtrando las que son `subVista` y cuya ruta cuelga de `/ruta-critica/`. Cada
 * tarjeta se muestra SOLO si la sesión tiene el permiso de esa sub-vista, con la
 * MISMA mecánica que usa el sidebar (`esModuloVisible`, A4). La decisión real de
 * acceso la toma el backend en cada ruta (A1).
 *
 * Antes, `/ruta-critica` (item "Ruta Crítica ⭐") caía en el catch-all `:modulo` de
 * `App.tsx` ("Próximamente") aunque el módulo ya estaba construido; esta página es
 * su aterrizaje real.
 */

/** Sub-vistas del módulo Ruta Crítica tomadas del menú (subVista + ruta /ruta-critica/...). */
const SUBVISTAS_RUTA_CRITICA = MODULOS_MENU.filter(
  (modulo) => modulo.subVista === true && modulo.ruta.startsWith('/ruta-critica/'),
);

export function RutaCriticaPagina(): React.JSX.Element {
  const { permisos } = useSesion();
  // Solo las sub-vistas que el usuario puede ver (misma mecánica que el sidebar).
  const visibles = SUBVISTAS_RUTA_CRITICA.filter((modulo) => esModuloVisible(modulo, permisos));

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl p-4 lg:p-6">
        <h1 className="text-2xl font-semibold tracking-tight">Ruta Crítica</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Workflow de procesos con fechas, semáforos y bandeja de tareas. Elige una vista.
        </p>

        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visibles.map((sub) => {
            const Icono = ICONOS_MODULO[sub.icono];
            return (
              <Link
                key={sub.clave}
                to={sub.ruta}
                className="group flex items-start gap-3 rounded-xl bg-card p-4 text-card-foreground ring-1 ring-foreground/10 transition-all hover:ring-primary/40 hover:shadow-sm"
                data-testid={`ruta-critica-${sub.clave}`}
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
