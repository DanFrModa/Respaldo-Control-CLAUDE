import {
  BadgeCheck,
  CalendarClock,
  FileText,
  MinusCircle,
  PackageCheck,
  PlusCircle,
  Scale,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { Link } from 'react-router-dom';

import type { ClavePermiso } from '@/api/tipos';
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
  permiso: ClavePermiso;
}

const SUB_VISTAS: readonly SubvistaEsMa[] = [
  {
    clave: 'estado-cuenta',
    titulo: 'Estado de cuenta',
    descripcion:
      'La cuenta corriente de un maquilero: cargos, abonos, descuentos y pagos por fecha.',
    ruta: '/esma/estado-cuenta',
    icono: Wallet,
    permiso: 'esma.ver-pagos',
  },
  {
    clave: 'saldos',
    titulo: 'Saldos de maquileros',
    descripcion:
      'Los maquileros activos con saldo distinto de cero —o con partidas por revisar—, con drill-down.',
    ruta: '/esma/saldos',
    icono: Users,
    permiso: 'esma.ver-pagos',
  },
  {
    clave: 'desglosado',
    titulo: 'Desglosado',
    descripcion: 'El detalle por orden/modelo, exportable a Excel y como PDF del estado de cuenta.',
    ruta: '/esma/desglosado',
    icono: FileText,
    permiso: 'esma.ver-pagos',
  },
  {
    clave: 'pagos-semanales',
    titulo: 'Pagos semanales',
    descripcion: 'Los pagos a maquileros de la semana, con su total.',
    ruta: '/esma/pagos-semanales',
    icono: CalendarClock,
    permiso: 'esma.ver-pagos',
  },
  {
    clave: 'recibos-semanales',
    titulo: 'Recibos semanales',
    descripcion: 'Los recibos de maquila del periodo por maquilero y modelo (con importes).',
    ruta: '/esma/recibos-semanales',
    icono: PackageCheck,
    permiso: 'esma.ver-pagos',
  },
  {
    clave: 'validacion-cargos',
    titulo: 'Validación de cargos',
    descripcion: 'Revisa y valida los cargos de maquila propuestos por los recibos.',
    ruta: '/esma/validacion-cargos',
    icono: BadgeCheck,
    permiso: 'esma.cargo-validar',
  },
  {
    clave: 'conciliacion',
    titulo: 'Conciliación de cargos',
    descripcion: 'Cuadra lo recibido vs lo cargado a EsMa y detecta lo que falta por cargar.',
    ruta: '/esma/conciliacion',
    icono: Scale,
    permiso: 'esma.ver-pagos',
  },
  {
    clave: 'abonos',
    titulo: 'Abonos',
    descripcion: 'Captura abonos a la cuenta de un maquilero (a favor del maquilero).',
    ruta: '/esma/abonos',
    icono: PlusCircle,
    permiso: 'esma.modificar',
  },
  {
    clave: 'descuentos',
    titulo: 'Descuentos',
    descripcion: 'Captura descuentos a la cuenta de un maquilero (a cargo del maquilero).',
    ruta: '/esma/descuentos',
    icono: MinusCircle,
    permiso: 'esma.modificar',
  },
  {
    clave: 'pagos',
    titulo: 'Pagos',
    descripcion: 'Paga cargos validados (prendas por pagar) e imprime el recibo de pago.',
    ruta: '/esma/pagos',
    icono: Wallet,
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
          <div>
            <h1 className="text-[21px] leading-tight font-semibold tracking-tight">EsMa</h1>
            <p className="mt-1 text-[12.5px] text-muted-foreground">
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
                    'bg-primary-soft text-primary-soft-foreground',
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
