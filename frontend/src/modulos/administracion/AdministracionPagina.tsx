import { Building2, Users, type LucideIcon } from 'lucide-react';
import { Link } from 'react-router-dom';

import type { ClavePermiso } from '@/api/tipos';
import { Badge } from '@/components/ui/badge';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useSesion } from '@/sesion/useSesion';

/**
 * Portada del modulo Administracion: lista sus secciones. Las CONSTRUIDAS
 * (Usuarios y Empresas, F1-E1) se muestran como tarjeta-enlace SOLO si la sesion
 * tiene su permiso `.administrar` (igual que el sidebar oculta los modulos sin
 * permiso, A4); el resto (roles, configuracion, bitacora) aun por construir, como
 * "Próximamente". La decision real de acceso la toma el backend en cada ruta (A1).
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
    permiso: 'usuarios.administrar',
  },
  {
    clave: 'empresas',
    titulo: 'Empresas',
    descripcion: 'Empresas del grupo y su configuración de costeo e inventario.',
    ruta: '/administracion/empresas',
    icono: Building2,
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
    <div className="mx-auto w-full max-w-5xl">
      <h1 className="text-2xl font-semibold tracking-tight">Administración</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Configuración del sistema. Elige una sección para administrarla.
      </p>

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {visibles.map((sub) => (
          <Link
            key={sub.clave}
            to={sub.ruta}
            className="group"
            data-testid={`administracion-${sub.clave}`}
          >
            <Card className="h-full transition-colors group-hover:ring-primary/40">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <sub.icono className="size-4 text-muted-foreground" aria-hidden />
                  {sub.titulo}
                </CardTitle>
                <CardDescription>{sub.descripcion}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}

        {SECCIONES_PENDIENTES.map((sub) => (
          <Card key={sub.clave} className="h-full opacity-70">
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-2 text-base">
                {sub.titulo}
                <Badge variant="outline">Próximamente</Badge>
              </CardTitle>
              <CardDescription>{sub.descripcion}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </div>
    </div>
  );
}
