import {
  CalendarRange,
  Palette,
  Scissors,
  Tags,
  Truck,
  Warehouse,
  type LucideIcon,
} from 'lucide-react';
import { Link } from 'react-router-dom';

import type { ClavePermiso } from '@/api/tipos';
import { Badge } from '@/components/ui/badge';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useSesion } from '@/sesion/useSesion';

/**
 * Portada del modulo Catalogos: lista sus sub-catalogos. Los CONSTRUIDOS (almacenes
 * + los 5 de F1-E1) se muestran como tarjeta-enlace SOLO si la sesion tiene su
 * permiso `.ver` (igual que el sidebar oculta los modulos sin permiso, A4); el
 * resto, aun por construir, se muestran como "Próximamente".
 *
 * Asi cada CRUD es accesible navegando (Catalogos -> sub-catalogo), no solo por
 * URL directa, y la visibilidad respeta los permisos. La decision real de acceso
 * la toma el backend en cada ruta (A1).
 */

/** Un sub-catalogo ya construido (CRUD real), con la ruta, el icono y su permiso `.ver`. */
interface SubcatalogoListo {
  clave: string;
  titulo: string;
  descripcion: string;
  ruta: string;
  icono: LucideIcon;
  /** Permiso `.ver` que hace visible el catalogo. */
  permiso: ClavePermiso;
}

/** Un sub-catalogo aun por construir (placeholder "Próximamente"). */
interface SubcatalogoPendiente {
  clave: string;
  titulo: string;
  descripcion: string;
}

/** Catalogos construidos (CRUD real). El orden es el de captura habitual. */
const CATALOGOS_LISTOS: readonly SubcatalogoListo[] = [
  {
    clave: 'almacenes',
    titulo: 'Almacenes',
    descripcion: 'Catálogo de almacenes del kardex único (PT, telas y avíos).',
    ruta: '/catalogos/almacenes',
    icono: Warehouse,
    permiso: 'almacenes.ver',
  },
  {
    clave: 'proveedores',
    titulo: 'Proveedores',
    descripcion: 'Proveedores de telas, avíos y servicios.',
    ruta: '/catalogos/proveedores',
    icono: Truck,
    permiso: 'proveedores.ver',
  },
  {
    clave: 'cortadores',
    titulo: 'Cortadores',
    descripcion: 'Talleres de corte y su precio de referencia.',
    ruta: '/catalogos/cortadores',
    icono: Scissors,
    permiso: 'cortadores.ver',
  },
  {
    clave: 'temporadas',
    titulo: 'Temporadas',
    descripcion: 'Ciclos comerciales del año.',
    ruta: '/catalogos/temporadas',
    icono: CalendarRange,
    permiso: 'temporadas.ver',
  },
  {
    clave: 'etiquetas-marca',
    titulo: 'Etiquetas de marca',
    descripcion: 'Etiquetas de marca y su porcentaje de regalías.',
    ruta: '/catalogos/etiquetas-marca',
    icono: Tags,
    permiso: 'etiquetas-marca.ver',
  },
  {
    clave: 'colores',
    titulo: 'Colores',
    descripcion: 'Catálogo de colores.',
    ruta: '/catalogos/colores',
    icono: Palette,
    permiso: 'colores.ver',
  },
];

/** Catalogos aun por construir (se muestran como "Próximamente"). */
const CATALOGOS_PENDIENTES: readonly SubcatalogoPendiente[] = [
  { clave: 'clientes', titulo: 'Clientes', descripcion: 'Catálogo de clientes y sus datos.' },
  { clave: 'maquileros', titulo: 'Maquileros', descripcion: 'Talleres de costura y estampado.' },
  { clave: 'telas', titulo: 'Telas', descripcion: 'Catálogo de telas y composiciones.' },
  { clave: 'avios', titulo: 'Avíos', descripcion: 'Habilitación: hilos, botones, etiquetas…' },
  { clave: 'tallas', titulo: 'Tallas', descripcion: 'Curvas de tallas (ilimitadas, D4).' },
];

export function CatalogosPagina(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  // Solo los catalogos construidos que el usuario puede ver.
  const visibles = CATALOGOS_LISTOS.filter((sub) => tienePermiso(sub.permiso));

  return (
    <div className="mx-auto w-full max-w-5xl">
      <h1 className="text-2xl font-semibold tracking-tight">Catálogos</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Datos maestros del sistema. Elige un catálogo para administrarlo.
      </p>

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {visibles.map((sub) => (
          <Link
            key={sub.clave}
            to={sub.ruta}
            className="group"
            data-testid={`catalogo-${sub.clave}`}
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

        {CATALOGOS_PENDIENTES.map((sub) => (
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
