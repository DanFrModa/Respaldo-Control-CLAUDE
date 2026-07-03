import { Calculator, FileText, ListChecks, Shirt, TrendingUp, type LucideIcon } from 'lucide-react';
import { Link } from 'react-router-dom';

import type { ClavePermiso } from '@/api/tipos';
import { avatarPorTono, type Tono } from '@/lib/tono';
import { cn } from '@/lib/utils';
import { useSesion } from '@/sesion/useSesion';

/**
 * Portada del módulo COSTOS (F7-E1; patrón portada-hub). Cada tarjeta se filtra por SU permiso:
 * pre-costo y lista de precios (`precostos.consultar`, nivel ≤45); costeo de orden, lista de costos y
 * márgenes por pedido (`costos.ver`, nivel ≤30). La decisión real de acceso la toma el backend (A1).
 * El EDR llega en F7-E2 (no en esta etapa).
 */

interface SubvistaCostos {
  clave: string;
  titulo: string;
  descripcion: string;
  ruta: string;
  icono: LucideIcon;
  tono: Tono;
  permiso: ClavePermiso;
}

const SUB_VISTAS: readonly SubvistaCostos[] = [
  {
    clave: 'pre-costo',
    titulo: 'Pre-costo por modelo',
    descripcion: 'Costo estimado de un modelo a partir de su receta y los precios de catálogo.',
    ruta: '/costos/pre-costo',
    icono: Shirt,
    tono: 'telas',
    permiso: 'precostos.consultar',
  },
  {
    clave: 'lista-precios',
    titulo: 'Lista de precios',
    descripcion: 'Precio de venta sugerido por modelo (utilidad + regalías), con PDF por género.',
    ruta: '/costos/lista-precios',
    icono: FileText,
    tono: 'avios',
    permiso: 'precostos.consultar',
  },
  {
    clave: 'costeo-orden',
    titulo: 'Costeo de orden',
    descripcion: 'Costo real de una orden: teórico vs guardado, con su costo unitario por base.',
    ruta: '/costos/costeo',
    icono: Calculator,
    tono: 'pt',
    permiso: 'costos.ver',
  },
  {
    clave: 'lista-costos',
    titulo: 'Lista de costos',
    descripcion: 'Órdenes ya costeadas con su costo total y unitario.',
    ruta: '/costos/lista',
    icono: ListChecks,
    tono: 'servicios',
    permiso: 'costos.ver',
  },
  {
    clave: 'margenes',
    titulo: 'Costos y márgenes por pedido',
    descripcion: 'Importe, margen promedio, margen ponderado y margen $ por pieza (PDF/Excel).',
    ruta: '/costos/margenes',
    icono: TrendingUp,
    tono: 'neutro',
    permiso: 'costos.ver',
  },
];

export function CostosPagina(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const visibles = SUB_VISTAS.filter((sub) => tienePermiso(sub.permiso));

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl p-4 lg:p-6">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-lg bg-sidebar-accent/40 text-sidebar-accent-foreground">
            <Calculator className="size-5" aria-hidden />
          </span>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Costos</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Pre-costo por modelo, costo real por orden y márgenes por pedido. La regalía va sobre
              la venta, no en el costo.
            </p>
          </div>
        </div>

        {visibles.length === 0 ? (
          <p className="mt-6 rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            No tienes acceso a las secciones de Costos.
          </p>
        ) : (
          <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {visibles.map((sub) => (
              <Link
                key={sub.clave}
                to={sub.ruta}
                className="group flex items-start gap-3 rounded-xl bg-card p-4 text-card-foreground ring-1 ring-foreground/10 transition-all hover:ring-primary/40 hover:shadow-sm"
                data-testid={`costos-${sub.clave}`}
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
