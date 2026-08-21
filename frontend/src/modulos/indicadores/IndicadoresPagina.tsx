import {
  BarChart3,
  ClipboardCheck,
  ClipboardList,
  Library,
  Medal,
  Package,
  PackageCheck,
  Route,
} from 'lucide-react';
import { Link } from 'react-router-dom';

import { cn } from '@/lib/utils';
import { cumpleExigencia, type ExigenciaPermisos } from '@/modulos/catalogo';
import { useSesion } from '@/sesion/useSesion';

/**
 * Portada del módulo INDICADORES (F7-E3 tableros directivos + F7-E4 captura). Cada tarjeta se muestra
 * si la sesión CUMPLE su exigencia de permisos (`cumpleExigencia`, la misma del menú y de la capa
 * de ruta); el backend re-verifica cada pantalla (A1). Los tableros
 * directivos (`indicadores.ver`) se calculan en segundo plano; las pantallas de captura (productividad,
 * fichas y muestrarios) son operativas por área/aspecto.
 */

interface SubvistaIndicadores {
  clave: string;
  titulo: string;
  descripcion: string;
  ruta: string;
  icono: typeof Route;
  permisos: ExigenciaPermisos;
}

const SUB_VISTAS: readonly SubvistaIndicadores[] = [
  {
    clave: 'ruta-critica',
    titulo: 'KPIs de Ruta Crítica',
    descripcion: 'Entregas a tiempo, lead time por proceso, cuellos de botella y desempeño.',
    ruta: '/indicadores/ruta-critica',
    icono: Route,
    // ⭐ V1-E3t: las DOS llaves — mismo gate que el catálogo del menú y que el backend.
    permisos: { todos: ['indicadores.ver', 'rc.ruta-ver'] },
  },
  {
    clave: 'calidad',
    titulo: 'Calidad por maquilero',
    descripcion: '% de aprobación por maquilero, defectos más frecuentes y tendencia mensual.',
    ruta: '/indicadores/calidad',
    icono: Medal,
    permisos: ['indicadores.ver'],
  },
  {
    clave: 'wip',
    titulo: 'WIP analítico',
    descripcion: 'Prendas atoradas por etapa y avance por orden (cortado, enviado, recibido…).',
    ruta: '/indicadores/wip',
    icono: Package,
    permisos: ['indicadores.ver'],
  },
  {
    clave: 'productividad-captura',
    titulo: 'Captura de productividad',
    descripcion: 'Registra la productividad de IP y almacén con atajos Hoy/Ayer/Sábado.',
    ruta: '/indicadores/productividad/captura',
    icono: ClipboardList,
    permisos: ['indicadores.ip-productividad', 'indicadores.almacen-productividad'],
  },
  {
    clave: 'productividad-tablero',
    titulo: 'Productividad vs estándar',
    descripcion: 'Índices agregados por periodo, actividad y persona (día/semana/mes).',
    ruta: '/indicadores/productividad/tablero',
    icono: BarChart3,
    permisos: ['indicadores.ip-productividad', 'indicadores.almacen-productividad'],
  },
  {
    clave: 'productividad-catalogos',
    titulo: 'Catálogos de productividad',
    descripcion: 'Personas y actividades por área, con sus estándares.',
    ruta: '/indicadores/productividad/catalogos',
    icono: Library,
    permisos: ['indicadores.ip-productividad', 'indicadores.almacen-productividad'],
  },
  {
    clave: 'fichas-confiables',
    titulo: 'Fichas confiables',
    descripcion: 'Checklist de confiabilidad de la ficha técnica por orden y su % confiable.',
    ruta: '/indicadores/fichas-confiables',
    icono: ClipboardCheck,
    permisos: ['indicadores.ip-confiabilidad'],
  },
  {
    clave: 'muestrarios',
    titulo: 'Muestrarios',
    descripcion: 'Boards y muestras solicitados, con su KPI de cumplimiento.',
    ruta: '/indicadores/muestrarios',
    icono: PackageCheck,
    permisos: ['indicadores.ip-muestrarios'],
  },
];

export function IndicadoresPagina(): React.JSX.Element {
  const { permisos } = useSesion();
  const visibles = SUB_VISTAS.filter((sub) => cumpleExigencia(sub.permisos, permisos));

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl p-4 lg:p-6">
        <h1 className="text-[21px] leading-tight font-semibold tracking-tight">Indicadores</h1>
        <p className="mt-1 text-[12.5px] text-muted-foreground">
          Tableros directivos, productividad de IP y almacén, fichas confiables y muestrarios.
        </p>

        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visibles.map((sub) => (
            <Link
              key={sub.clave}
              to={sub.ruta}
              className="group flex items-start gap-3 rounded-xl bg-card p-4 text-card-foreground ring-1 ring-foreground/10 transition-all hover:ring-primary/40 hover:shadow-sm"
              data-testid={`indicadores-${sub.clave}`}
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
