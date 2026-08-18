import {
  Building2,
  ClipboardList,
  Coins,
  ListChecks,
  ShieldCheck,
  Stethoscope,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { Link } from 'react-router-dom';

import type { ClavePermiso } from '@/api/tipos';
import { cn } from '@/lib/utils';
import { useSesion } from '@/sesion/useSesion';

/**
 * Portada del modulo Administracion (rediseño "Teal fresco"): lista sus secciones
 * como tarjetas con icono de color. Cada sección construida se muestra como
 * tarjeta-enlace SOLO si la sesion tiene su permiso `.administrar` (igual que el
 * sidebar oculta los modulos sin permiso, A4). La decision real de acceso la toma
 * el backend en cada ruta (A1). Ya no queda ninguna sección "Próximamente".
 */

/** Una seccion ya construida (pantalla real), con su ruta, icono y permiso. */
interface SeccionLista {
  clave: string;
  titulo: string;
  descripcion: string;
  ruta: string;
  icono: LucideIcon;
  /** Permiso que hace visible la seccion (la administracion no tiene `.ver`). */
  permiso: ClavePermiso;
}

/** Secciones construidas (pantallas reales). */
const SECCIONES_LISTAS: readonly SeccionLista[] = [
  {
    clave: 'usuarios',
    titulo: 'Usuarios',
    descripcion: 'Usuarios del sistema, sus roles y su estado de acceso.',
    ruta: '/administracion/usuarios',
    icono: Users,
    permiso: 'usuarios.administrar',
  },
  {
    clave: 'roles',
    titulo: 'Roles y permisos',
    descripcion: 'Roles del sistema y los permisos que otorga cada uno.',
    ruta: '/administracion/roles',
    icono: ShieldCheck,
    permiso: 'roles.administrar',
  },
  {
    clave: 'empresas',
    titulo: 'Empresas',
    descripcion: 'Empresas del grupo y su configuración de costeo e inventario.',
    ruta: '/administracion/empresas',
    icono: Building2,
    permiso: 'empresas.administrar',
  },
  {
    clave: 'diagnostico',
    titulo: 'Diagnóstico del sistema',
    descripcion:
      'Prueba el almacenamiento de fotos y archivos, y revisa el respaldo de la base de datos.',
    ruta: '/administracion/diagnostico',
    icono: Stethoscope,
    permiso: 'admin.ver-bitacora',
  },
  {
    clave: 'bitacora',
    titulo: 'Bitácora',
    descripcion: 'Auditoría de cambios del sistema: quién, qué, cuándo y sobre qué registro.',
    ruta: '/administracion/bitacora',
    icono: ClipboardList,
    permiso: 'admin.ver-bitacora',
  },
  {
    clave: 'conceptos-costo',
    titulo: 'Conceptos de costo',
    descripcion: 'Catálogo global de conceptos del pre-costeo (además de tela, avíos y maquila).',
    ruta: '/administracion/conceptos-costo',
    icono: Coins,
    permiso: 'concepto-costo.administrar',
  },
  {
    clave: 'estados-lista',
    titulo: 'Estados de lista de precios',
    descripcion: 'Catálogo global de estados del ciclo de vida de una lista de precios.',
    ruta: '/administracion/estados-lista',
    icono: ListChecks,
    permiso: 'estado-lista.administrar',
  },
];

export function AdministracionPagina(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  // Solo las secciones construidas que el usuario puede administrar.
  const visibles = SECCIONES_LISTAS.filter((sub) => tienePermiso(sub.permiso));

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl p-4 lg:p-6">
        <h1 className="text-[21px] leading-tight font-semibold tracking-tight">Administración</h1>
        <p className="mt-1 text-[12.5px] text-muted-foreground">
          Configuración del sistema. Elige una sección para administrarla.
        </p>

        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visibles.map((sub) => (
            <Link
              key={sub.clave}
              to={sub.ruta}
              className="group flex items-start gap-3 rounded-xl bg-card p-4 text-card-foreground ring-1 ring-foreground/10 transition-all hover:ring-primary/40 hover:shadow-sm"
              data-testid={`administracion-${sub.clave}`}
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
