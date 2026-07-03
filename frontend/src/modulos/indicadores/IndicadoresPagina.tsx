import { ChartLine, Medal, Package, Route } from 'lucide-react';
import { Link } from 'react-router-dom';

import { avatarPorTono, type Tono } from '@/lib/tono';
import { cn } from '@/lib/utils';

/**
 * Portada del módulo INDICADORES (F7-E3; patrón portada-hub). Los 3 tableros directivos se calculan en
 * segundo plano sobre vistas materializadas (la captura no espera el recálculo). Todo el módulo se
 * gobierna con `indicadores.ver`; el backend re-verifica el permiso en cada ruta (A1).
 */

interface SubvistaIndicadores {
  clave: string;
  titulo: string;
  descripcion: string;
  ruta: string;
  icono: typeof Route;
  tono: Tono;
}

const SUB_VISTAS: readonly SubvistaIndicadores[] = [
  {
    clave: 'ruta-critica',
    titulo: 'KPIs de Ruta Crítica',
    descripcion: 'Entregas a tiempo, lead time por proceso, cuellos de botella y desempeño.',
    ruta: '/indicadores/ruta-critica',
    icono: Route,
    tono: 'servicios',
  },
  {
    clave: 'calidad',
    titulo: 'Calidad por maquilero',
    descripcion: '% de aprobación por maquilero, defectos más frecuentes y tendencia mensual.',
    ruta: '/indicadores/calidad',
    icono: Medal,
    tono: 'pt',
  },
  {
    clave: 'wip',
    titulo: 'WIP analítico',
    descripcion: 'Prendas atoradas por etapa y avance por orden (cortado, enviado, recibido…).',
    ruta: '/indicadores/wip',
    icono: Package,
    tono: 'telas',
  },
];

export function IndicadoresPagina(): React.JSX.Element {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl p-4 lg:p-6">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-lg bg-sidebar-accent/40 text-sidebar-accent-foreground">
            <ChartLine className="size-5" aria-hidden />
          </span>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Indicadores</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Tableros directivos calculados en segundo plano. Cada uno muestra la fecha de sus
              datos y un botón para refrescarlos.
            </p>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {SUB_VISTAS.map((sub) => (
            <Link
              key={sub.clave}
              to={sub.ruta}
              className="group flex items-start gap-3 rounded-xl bg-card p-4 text-card-foreground ring-1 ring-foreground/10 transition-all hover:ring-primary/40 hover:shadow-sm"
              data-testid={`indicadores-${sub.clave}`}
            >
              <span
                aria-hidden
                className={cn(
                  'flex size-10 shrink-0 items-center justify-center rounded-xl',
                  avatarPorTono(sub.tono),
                )}
              >
                <sub.icono className="size-5" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="font-heading text-base font-medium">{sub.titulo}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{sub.descripcion}</p>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
