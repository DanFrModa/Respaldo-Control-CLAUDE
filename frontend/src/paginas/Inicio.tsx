import { ArrowRight, Star } from 'lucide-react';
import { Link } from 'react-router-dom';

import { cn } from '@/lib/utils';
import { filtrarModulosVisibles, ICONOS_MODULO } from '@/modulos/catalogo';
import { useSesion } from '@/sesion/useSesion';

/**
 * Inicio del sistema (rediseño "Teal fresco"): hero de bienvenida + accesos a los
 * modulos visibles, cada uno con su icono de color. Aqui viviran los tableros
 * (semaforos de la Ruta Critica y KPIs, D11) cuando se construyan los indicadores;
 * por ahora es la puerta de entrada a los modulos.
 *
 * Scroll propio (`h-full overflow-y-auto`): el cascaron deja el `<main>` sin
 * scroll y cada pantalla maneja el suyo.
 */
export function Inicio(): React.JSX.Element {
  const { sesion, permisos } = useSesion();
  const modulos = filtrarModulosVisibles(permisos);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl p-4 lg:p-6">
        {/* Hero de bienvenida (teal). */}
        <section className="overflow-hidden rounded-2xl bg-gradient-to-br from-teal-600 to-teal-800 p-6 text-white sm:p-8">
          <h1 className="text-2xl font-semibold tracking-tight">Hola, {sesion?.nombre} 👋</h1>
          <p className="mt-2 max-w-2xl text-teal-50/90">
            Empresa activa: {sesion?.empresaActiva.nombre}. Aquí aparecerán los tableros del negocio
            (avance de órdenes, semáforos de la Ruta Crítica e indicadores).
          </p>
        </section>

        <h2 className="mt-8 text-sm font-medium text-muted-foreground">Módulos</h2>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {modulos.map((modulo) => {
            const Icono = ICONOS_MODULO[modulo.icono];
            return (
              <Link
                key={modulo.clave}
                to={modulo.ruta}
                className="group flex items-start gap-3 rounded-xl bg-card p-4 text-card-foreground ring-1 ring-foreground/10 transition-all hover:ring-primary/40 hover:shadow-sm"
              >
                <span
                  aria-hidden
                  className={cn(
                    'flex size-10 shrink-0 items-center justify-center rounded-xl',
                    modulo.destacado
                      ? 'bg-gradient-to-br from-teal-500 to-teal-700 text-white'
                      : 'bg-primary-soft text-primary-soft-foreground',
                  )}
                >
                  <Icono className="size-5" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <h3 className="font-heading text-base font-medium">{modulo.titulo}</h3>
                    {modulo.destacado ? (
                      <Star
                        className="size-3.5 shrink-0 fill-amber-400 text-amber-400"
                        aria-hidden
                      />
                    ) : null}
                    <ArrowRight
                      className="ml-auto size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                      aria-hidden
                    />
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{modulo.descripcion}</p>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
