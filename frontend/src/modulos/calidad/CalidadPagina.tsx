import {
  BarChart3,
  CheckCircle,
  ClipboardCheck,
  ClipboardList,
  FileSearch,
  Medal,
  UserCheck,
  type LucideIcon,
} from 'lucide-react';
import { Link } from 'react-router-dom';

import type { ClavePermiso } from '@/api/tipos';
import { cn } from '@/lib/utils';
import { useSesion } from '@/sesion/useSesion';

/**
 * Portada del modulo Calidad (patron portada-hub, calca CatalogosPagina.tsx):
 * tarjetas con los sub-catalogos del modulo. Cada tarjeta se filtra por SU
 * propio permiso (los catalogos por `calidad.ver`, las auditorias por
 * `calidad.generar-auditorias`), igual que el menu de catalogo.ts. La decision
 * real de acceso la toma el backend (A1).
 */

interface SubvistaCalidad {
  clave: string;
  titulo: string;
  descripcion: string;
  ruta: string;
  icono: LucideIcon;
  permiso: ClavePermiso;
}

const SUB_VISTAS: readonly SubvistaCalidad[] = [
  {
    clave: 'auditorias',
    titulo: 'Auditorías de calidad',
    descripcion:
      'Inspecciona una muestra de una orden, captura fallas y resuelve aprobar/reprobar.',
    ruta: '/calidad/auditorias/nueva',
    icono: ClipboardCheck,
    permiso: 'calidad.generar-auditorias',
  },
  {
    clave: 'consulta-auditorias',
    titulo: 'Consulta de auditorías',
    descripcion: 'Busca auditorías, imprime su PDF y modifica o cancela las existentes.',
    ruta: '/calidad/auditorias',
    icono: FileSearch,
    permiso: 'calidad.ver',
  },
  {
    clave: 'historial-maquilero',
    titulo: 'Auditorías por maquilero',
    descripcion: 'Historial y porcentaje de aprobación operativo de cada maquilero.',
    ruta: '/calidad/auditorias/maquilero',
    icono: BarChart3,
    permiso: 'calidad.ver',
  },
  {
    clave: 'defectos',
    titulo: 'Catálogo de defectos',
    descripcion: 'Defectos del sistema de calidad AQL con severidad y tipos de producto.',
    ruta: '/calidad/defectos',
    icono: ClipboardList,
    permiso: 'calidad.ver',
  },
  {
    clave: 'tipos-producto',
    titulo: 'Tipos de producto',
    descripcion: 'Categorías de producto para clasificar defectos y auditorías.',
    ruta: '/calidad/tipos-producto',
    icono: CheckCircle,
    permiso: 'calidad.ver',
  },
  {
    clave: 'auditores',
    titulo: 'Auditores',
    descripcion: 'Catálogo de auditores AQL: rol, nivel de certificación y auditorías realizadas.',
    ruta: '/auditores',
    icono: UserCheck,
    permiso: 'calidad.ver',
  },
  {
    clave: 'planes-aql',
    titulo: 'Planes AQL',
    descripcion: 'Tablas de muestreo AQL: rangos de lote, tamaño de muestra y límites Ac/Re.',
    ruta: '/calidad/planes-aql',
    icono: Medal,
    permiso: 'calidad.ver',
  },
];

export function CalidadPagina(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const visibles = SUB_VISTAS.filter((sub) => tienePermiso(sub.permiso));

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl p-4 lg:p-6">
        <h1 className="text-[21px] leading-tight font-semibold tracking-tight">Calidad</h1>
        <p className="mt-1 text-[12.5px] text-muted-foreground">
          Catálogos del sistema de calidad AQL. Elige una sección para administrarla.
        </p>

        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visibles.map((sub) => (
            <Link
              key={sub.clave}
              to={sub.ruta}
              className="group flex items-start gap-3 rounded-xl bg-card p-4 text-card-foreground ring-1 ring-foreground/10 transition-all hover:ring-primary/40 hover:shadow-sm"
              data-testid={`calidad-${sub.clave}`}
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
      </div>
    </div>
  );
}
