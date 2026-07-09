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

import type { ClavePermiso } from '@/api/tipos';
import { avatarPorTono, type Tono } from '@/lib/tono';
import { cn } from '@/lib/utils';
import { useSesion } from '@/sesion/useSesion';

/**
 * Portada del módulo INDICADORES (F7-E3 tableros directivos + F7-E4 captura). Cada tarjeta se muestra
 * si la sesión tiene ALGUNO de sus permisos; el backend re-verifica cada pantalla (A1). Los tableros
 * directivos (`indicadores.ver`) se calculan en segundo plano; las pantallas de captura (productividad,
 * fichas y muestrarios) son operativas por área/aspecto.
 */

interface SubvistaIndicadores {
  clave: string;
  titulo: string;
  descripcion: string;
  ruta: string;
  icono: typeof Route;
  tono: Tono;
  permisos: readonly ClavePermiso[];
}

const SUB_VISTAS: readonly SubvistaIndicadores[] = [
  {
    clave: 'ruta-critica',
    titulo: 'KPIs de Ruta Crítica',
    descripcion: 'Entregas a tiempo, lead time por proceso, cuellos de botella y desempeño.',
    ruta: '/indicadores/ruta-critica',
    icono: Route,
    tono: 'servicios',
    permisos: ['indicadores.ver'],
  },
  {
    clave: 'calidad',
    titulo: 'Calidad por maquilero',
    descripcion: '% de aprobación por maquilero, defectos más frecuentes y tendencia mensual.',
    ruta: '/indicadores/calidad',
    icono: Medal,
    tono: 'pt',
    permisos: ['indicadores.ver'],
  },
  {
    clave: 'wip',
    titulo: 'WIP analítico',
    descripcion: 'Prendas atoradas por etapa y avance por orden (cortado, enviado, recibido…).',
    ruta: '/indicadores/wip',
    icono: Package,
    tono: 'telas',
    permisos: ['indicadores.ver'],
  },
  {
    clave: 'productividad-captura',
    titulo: 'Captura de productividad',
    descripcion: 'Registra la productividad de IP y almacén con atajos Hoy/Ayer/Sábado.',
    ruta: '/indicadores/productividad/captura',
    icono: ClipboardList,
    tono: 'servicios',
    permisos: ['indicadores.ip-productividad', 'indicadores.almacen-productividad'],
  },
  {
    clave: 'productividad-tablero',
    titulo: 'Productividad vs estándar',
    descripcion: 'Índices agregados por periodo, actividad y persona (día/semana/mes).',
    ruta: '/indicadores/productividad/tablero',
    icono: BarChart3,
    tono: 'pt',
    permisos: ['indicadores.ip-productividad', 'indicadores.almacen-productividad'],
  },
  {
    clave: 'productividad-catalogos',
    titulo: 'Catálogos de productividad',
    descripcion: 'Personas y actividades por área, con sus estándares.',
    ruta: '/indicadores/productividad/catalogos',
    icono: Library,
    tono: 'telas',
    permisos: ['indicadores.ip-productividad', 'indicadores.almacen-productividad'],
  },
  {
    clave: 'fichas-confiables',
    titulo: 'Fichas confiables',
    descripcion: 'Checklist de confiabilidad de la ficha técnica por orden y su % confiable.',
    ruta: '/indicadores/fichas-confiables',
    icono: ClipboardCheck,
    tono: 'servicios',
    permisos: ['indicadores.ip-confiabilidad'],
  },
  {
    clave: 'muestrarios',
    titulo: 'Muestrarios',
    descripcion: 'Boards y muestras solicitados, con su KPI de cumplimiento.',
    ruta: '/indicadores/muestrarios',
    icono: PackageCheck,
    tono: 'pt',
    permisos: ['indicadores.ip-muestrarios'],
  },
];

export function IndicadoresPagina(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const visibles = SUB_VISTAS.filter((sub) => sub.permisos.some((p) => tienePermiso(p)));

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl p-4 lg:p-6">
        <h1 className="text-2xl font-semibold tracking-tight">Indicadores</h1>
        <p className="mt-1 text-sm text-muted-foreground">
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
      </div>
    </div>
  );
}
