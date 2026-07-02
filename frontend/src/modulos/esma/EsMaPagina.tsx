import {
  BadgeCheck,
  Banknote,
  MinusCircle,
  PlusCircle,
  Scale,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { Link } from 'react-router-dom';

import type { ClavePermiso } from '@/api/tipos';
import { avatarPorTono, type Tono } from '@/lib/tono';
import { cn } from '@/lib/utils';
import { useSesion } from '@/sesion/useSesion';

/**
 * Portada del módulo EsMa (estado de cuenta de maquileros; patrón portada-hub, calca
 * CalidadPagina.tsx). Cada tarjeta se filtra por SU permiso: validar cargos (`esma.cargo-validar`),
 * conciliación y pagos + lectura de cuenta (`esma.ver-pagos`), abonos/descuentos (`esma.modificar`).
 * La decisión real de acceso la toma el backend (A1).
 */

interface SubvistaEsMa {
  clave: string;
  titulo: string;
  descripcion: string;
  ruta: string;
  icono: LucideIcon;
  tono: Tono;
  permiso: ClavePermiso;
}

const SUB_VISTAS: readonly SubvistaEsMa[] = [
  {
    clave: 'validacion-cargos',
    titulo: 'Validación de cargos',
    descripcion: 'Revisa y valida los cargos de maquila propuestos por los recibos.',
    ruta: '/esma/validacion-cargos',
    icono: BadgeCheck,
    tono: 'pt',
    permiso: 'esma.cargo-validar',
  },
  {
    clave: 'conciliacion',
    titulo: 'Conciliación de cargos',
    descripcion: 'Cuadra lo recibido vs lo cargado a EsMa y detecta lo que falta por cargar.',
    ruta: '/esma/conciliacion',
    icono: Scale,
    tono: 'servicios',
    permiso: 'esma.ver-pagos',
  },
  {
    clave: 'abonos',
    titulo: 'Abonos',
    descripcion: 'Captura abonos a la cuenta de un maquilero (a favor del maquilero).',
    ruta: '/esma/abonos',
    icono: PlusCircle,
    tono: 'avios',
    permiso: 'esma.modificar',
  },
  {
    clave: 'descuentos',
    titulo: 'Descuentos',
    descripcion: 'Captura descuentos a la cuenta de un maquilero (a cargo del maquilero).',
    ruta: '/esma/descuentos',
    icono: MinusCircle,
    tono: 'telas',
    permiso: 'esma.modificar',
  },
  {
    clave: 'pagos',
    titulo: 'Pagos',
    descripcion: 'Paga cargos validados (prendas por pagar) e imprime el recibo de pago.',
    ruta: '/esma/pagos',
    icono: Wallet,
    tono: 'neutro',
    permiso: 'esma.ver-pagos',
  },
];

export function EsMaPagina(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const visibles = SUB_VISTAS.filter((sub) => tienePermiso(sub.permiso));

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl p-4 lg:p-6">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-lg bg-sidebar-accent/40 text-sidebar-accent-foreground">
            <Banknote className="size-5" aria-hidden />
          </span>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">EsMa</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Estados de cuenta de maquileros: cargos, conciliación, abonos, descuentos y pagos.
            </p>
          </div>
        </div>

        {visibles.length === 0 ? (
          <p className="mt-6 rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            No tienes acceso a las secciones de EsMa.
          </p>
        ) : (
          <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {visibles.map((sub) => (
              <Link
                key={sub.clave}
                to={sub.ruta}
                className="group flex items-start gap-3 rounded-xl bg-card p-4 text-card-foreground ring-1 ring-foreground/10 transition-all hover:ring-primary/40 hover:shadow-sm"
                data-testid={`esma-${sub.clave}`}
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
