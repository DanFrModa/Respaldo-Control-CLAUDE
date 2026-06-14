import { Building2, Users, type LucideIcon } from 'lucide-react';
import { Link } from 'react-router-dom';

import type { ClavePermiso } from '@/api/tipos';
import { Badge } from '@/components/ui/badge';
import { avatarPorTono, type Tono } from '@/lib/tono';
import { cn } from '@/lib/utils';
import { useSesion } from '@/sesion/useSesion';

/**
 * Portada del modulo Administracion (rediseño "Teal fresco"): lista sus secciones
 * como tarjetas con icono de color. Las CONSTRUIDAS (Usuarios y Empresas, F1-E1)
 * se muestran como tarjeta-enlace SOLO si la sesion tiene su permiso `.administrar`
 * (igual que el sidebar oculta los modulos sin permiso, A4); el resto (roles,
 * bitacora) aun por construir, como "Próximamente". La decision real de acceso la
 * toma el backend en cada ruta (A1).
 */

/** Una seccion ya construida (pantalla real), con su ruta, icono, tono y permiso. */
interface SeccionLista {
  clave: string;
  titulo: string;
  descripcion: string;
  ruta: string;
  icono: LucideIcon;
  tono: Tono;
  /** Permiso que hace visible la seccion (la administracion no tiene `.ver`). */
  permiso: ClavePermiso;
}

/** Una seccion aun por construir (placeholder "Próximamente"). */
interface SeccionPendiente {
  clave: string;
  titulo: string;
  descripcion: string;
}

/** Secciones construidas (pantallas reales). */
const SECCIONES_LISTAS: readonly SeccionLista[] = [
  {
    clave: 'usuarios',
    titulo: 'Usuarios',
    descripcion: 'Usuarios del sistema, sus roles y su estado de acceso.',
    ruta: '/administracion/usuarios',
    icono: Users,
    tono: 'pt',
    permiso: 'usuarios.administrar',
  },
  {
    clave: 'empresas',
    titulo: 'Empresas',
    descripcion: 'Empresas del grupo y su configuración de costeo e inventario.',
    ruta: '/administracion/empresas',
    icono: Building2,
    tono: 'avios',
    permiso: 'empresas.administrar',
  },
];

/** Secciones aun por construir (se muestran como "Próximamente"). */
const SECCIONES_PENDIENTES: readonly SeccionPendiente[] = [
  { clave: 'roles', titulo: 'Roles y permisos', descripcion: 'Roles del sistema y sus permisos.' },
  {
    clave: 'bitacora',
    titulo: 'Bitácora',
    descripcion: 'Auditoría de cambios y accesos del sistema.',
  },
];

export function AdministracionPagina(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  // Solo las secciones construidas que el usuario puede administrar.
  const visibles = SECCIONES_LISTAS.filter((sub) => tienePermiso(sub.permiso));

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl p-4 lg:p-6">
        <h1 className="text-2xl font-semibold tracking-tight">Administración</h1>
        <p className="mt-1 text-sm text-muted-foreground">
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

          {SECCIONES_PENDIENTES.map((sub) => (
            <div
              key={sub.clave}
              className="flex items-start gap-3 rounded-xl bg-card p-4 text-card-foreground ring-1 ring-foreground/10 opacity-70"
            >
              <span
                aria-hidden
                className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="font-heading text-base font-medium">{sub.titulo}</h2>
                  <Badge variant="outline">Próximamente</Badge>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{sub.descripcion}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
