import {
  CalendarRange,
  Contact,
  Factory,
  Palette,
  Ruler,
  Scissors,
  Tags,
  Truck,
  Warehouse,
  type LucideIcon,
} from 'lucide-react';
import { Link } from 'react-router-dom';

import type { ClavePermiso } from '@/api/tipos';
import { Badge } from '@/components/ui/badge';
import { avatarPorTono, type Tono } from '@/lib/tono';
import { cn } from '@/lib/utils';
import { useSesion } from '@/sesion/useSesion';

/**
 * Portada del modulo Catalogos (rediseño "Teal fresco"): lista sus sub-catalogos
 * como tarjetas con icono de color. Los CONSTRUIDOS (almacenes + los 5 de F1-E1)
 * se muestran como tarjeta-enlace SOLO si la sesion tiene su permiso `.ver` (igual
 * que el sidebar oculta los modulos sin permiso, A4); el resto, aun por construir,
 * como "Próximamente".
 *
 * Asi cada CRUD es accesible navegando (Catalogos -> sub-catalogo), no solo por
 * URL directa, y la visibilidad respeta los permisos. La decision real de acceso
 * la toma el backend en cada ruta (A1).
 */

/** Un sub-catalogo ya construido (CRUD real), con la ruta, el icono, su tono y permiso. */
interface SubcatalogoListo {
  clave: string;
  titulo: string;
  descripcion: string;
  ruta: string;
  icono: LucideIcon;
  /** Tono explicativo del icono. */
  tono: Tono;
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
    tono: 'pt',
    permiso: 'almacenes.ver',
  },
  {
    clave: 'proveedores',
    titulo: 'Proveedores',
    descripcion: 'Proveedores de telas, avíos y servicios.',
    ruta: '/catalogos/proveedores',
    icono: Truck,
    tono: 'avios',
    permiso: 'proveedores.ver',
  },
  {
    clave: 'cortadores',
    titulo: 'Cortadores',
    descripcion: 'Talleres de corte y su precio de referencia.',
    ruta: '/catalogos/cortadores',
    icono: Scissors,
    tono: 'servicios',
    permiso: 'cortadores.ver',
  },
  {
    clave: 'temporadas',
    titulo: 'Temporadas',
    descripcion: 'Ciclos comerciales del año.',
    ruta: '/catalogos/temporadas',
    icono: CalendarRange,
    tono: 'neutro',
    permiso: 'temporadas.ver',
  },
  {
    clave: 'etiquetas-marca',
    titulo: 'Etiquetas de marca',
    descripcion: 'Etiquetas de marca y su porcentaje de regalías.',
    ruta: '/catalogos/etiquetas-marca',
    icono: Tags,
    tono: 'telas',
    permiso: 'etiquetas-marca.ver',
  },
  {
    clave: 'colores',
    titulo: 'Colores',
    descripcion: 'Catálogo de colores.',
    ruta: '/catalogos/colores',
    icono: Palette,
    tono: 'servicios',
    permiso: 'colores.ver',
  },
  // ── Catálogos estructurados (F1-E2) ──────────────────────────────────────────
  {
    clave: 'maquileros',
    titulo: 'Maquileros',
    descripcion: 'Talleres de costura y estampado (maquila unificada).',
    ruta: '/catalogos/maquileros',
    icono: Factory,
    tono: 'servicios',
    permiso: 'maquileros.ver',
  },
  {
    clave: 'tallas',
    titulo: 'Tallas y curvas',
    descripcion: 'Tallas y curvas de tallas (ilimitadas, D4).',
    ruta: '/catalogos/tallas',
    icono: Ruler,
    tono: 'neutro',
    permiso: 'tallas.ver',
  },
  {
    clave: 'clientes',
    titulo: 'Clientes',
    descripcion: 'Clientes y sus campos de referencia (D7).',
    ruta: '/catalogos/clientes',
    icono: Contact,
    tono: 'avios',
    permiso: 'clientes.ver',
  },
];

/** Catalogos aun por construir (se muestran como "Próximamente"). */
const CATALOGOS_PENDIENTES: readonly SubcatalogoPendiente[] = [
  { clave: 'telas', titulo: 'Telas', descripcion: 'Catálogo de telas y composiciones.' },
  { clave: 'avios', titulo: 'Avíos', descripcion: 'Habilitación: hilos, botones, etiquetas…' },
];

export function CatalogosPagina(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  // Solo los catalogos construidos que el usuario puede ver.
  const visibles = CATALOGOS_LISTOS.filter((sub) => tienePermiso(sub.permiso));

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl p-4 lg:p-6">
        <h1 className="text-2xl font-semibold tracking-tight">Catálogos</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Datos maestros del sistema. Elige un catálogo para administrarlo.
        </p>

        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visibles.map((sub) => (
            <Link
              key={sub.clave}
              to={sub.ruta}
              className="group flex items-start gap-3 rounded-xl bg-card p-4 text-card-foreground ring-1 ring-foreground/10 transition-all hover:ring-primary/40 hover:shadow-sm"
              data-testid={`catalogo-${sub.clave}`}
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

          {CATALOGOS_PENDIENTES.map((sub) => (
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
