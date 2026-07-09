import {
  CalendarCog,
  CalendarRange,
  FileBarChart,
  ListChecks,
  type LucideIcon,
} from 'lucide-react';
import { Link } from 'react-router-dom';

import type { ClavePermiso } from '@/api/tipos';
import { avatarPorTono, type Tono } from '@/lib/tono';
import { cn } from '@/lib/utils';
import { useSesion } from '@/sesion/useSesion';

/**
 * Portada del módulo ESTADO DE RESULTADOS (EDR, F7-E2; patrón portada-hub). Cada tarjeta se filtra por
 * SU permiso: gestión del mes (`edr.capturar`, generar + gastos); conciliación, por mes y por año
 * (`edr.ver`). La decisión real de acceso la toma el backend (A1). El EDR es CONSOLIDADO: abarca todas
 * las empresas que participan en el estado de resultados, a costo actual (D1).
 */

interface SubvistaEdr {
  clave: string;
  titulo: string;
  descripcion: string;
  ruta: string;
  icono: LucideIcon;
  tono: Tono;
  permiso: ClavePermiso;
}

const SUB_VISTAS: readonly SubvistaEdr[] = [
  {
    clave: 'mes',
    titulo: 'Gestión del mes',
    descripcion: 'Crea o selecciona un mes, captura gastos/intereses y genera las ventas.',
    ruta: '/edr/mes',
    icono: CalendarCog,
    tono: 'pt',
    permiso: 'edr.capturar',
  },
  {
    clave: 'conciliacion',
    titulo: 'Conciliación de ventas',
    descripcion: 'Ajusta el precio facturado y las cantidades; agrega o borra líneas manuales.',
    ruta: '/edr/conciliacion',
    icono: ListChecks,
    tono: 'servicios',
    permiso: 'edr.ver',
  },
  {
    clave: 'por-mes',
    titulo: 'EDR por mes',
    descripcion: 'Resultado del mes con corte por empresa y por cliente (PDF/Excel).',
    ruta: '/edr/por-mes',
    icono: FileBarChart,
    tono: 'telas',
    permiso: 'edr.ver',
  },
  {
    clave: 'por-anio',
    titulo: 'EDR por año',
    descripcion: 'Comparativo mensual del año, con corte por empresa (PDF).',
    ruta: '/edr/por-anio',
    icono: CalendarRange,
    tono: 'avios',
    permiso: 'edr.ver',
  },
];

export function EdrPagina(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const visibles = SUB_VISTAS.filter((sub) => tienePermiso(sub.permiso));

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl p-4 lg:p-6">
        <h1 className="text-2xl font-semibold tracking-tight">Estado de Resultados</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          El P&amp;L mensual consolidado, valuado a costo actual. Las ventas se proponen desde las
          entregas a cliente y se ajustan a lo facturado.
        </p>

        {visibles.length === 0 ? (
          <p className="mt-6 rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            No tienes acceso a las secciones del Estado de Resultados.
          </p>
        ) : (
          <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {visibles.map((sub) => (
              <Link
                key={sub.clave}
                to={sub.ruta}
                className="group flex items-start gap-3 rounded-xl bg-card p-4 text-card-foreground ring-1 ring-foreground/10 transition-all hover:ring-primary/40 hover:shadow-sm"
                data-testid={`edr-${sub.clave}`}
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
        )}
      </div>
    </div>
  );
}
