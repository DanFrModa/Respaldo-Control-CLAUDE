import { ArrowRight, Plus, Star } from 'lucide-react';
import { Link } from 'react-router-dom';

import { useBandejaRc, useConteoAlertasRc } from '@/api/ruta-critica-programacion';
import type { TareaRc } from '@/api/tipos';
import { type Kpi, KpiTiles } from '@/components/dominio/KpiTiles';
import { filtrarGruposVisibles, ICONOS_MODULO } from '@/modulos/catalogo';
import { fechaRc, Semaforo } from '@/modulos/ruta-critica/piezas';
import { useSesion } from '@/sesion/useSesion';

/**
 * RESUMEN del sistema (rediseño R1): bienvenida compacta + indicadores con
 * datos REALES de la Ruta Critica (mismo cache que el badge del encabezado;
 * cero peticiones extra) + accesos a las pantallas, agrupados como el menu
 * aprobado. Los tableros del negocio (D11) crecen aqui en fases posteriores.
 *
 * Un padre del menu no navega; su tarjeta lleva a su PRIMER hijo visible.
 *
 * Scroll propio (`h-full overflow-y-auto`): el cascaron deja el `<main>` sin
 * scroll y cada pantalla maneja el suyo.
 */
export function Inicio(): React.JSX.Element {
  const { sesion, permisos, tienePermiso } = useSesion();
  const grupos = filtrarGruposVisibles(permisos);

  // Alertas RC (dato real ya consultado por el badge del encabezado; TanStack
  // Query lo comparte por clave de cache). Sin permiso, ni el hook consulta.
  const puedeVerRc = tienePermiso('rc.ruta-ver');
  const alertas = useConteoAlertasRc({ habilitado: puedeVerRc });
  const kpisRc: readonly Kpi[] = [
    {
      clave: 'rc-atrasadas',
      etiqueta: 'RC · Atrasadas',
      valor: alertas.data?.atrasados ?? '—',
      pie: 'procesos vencidos hoy',
      ...((alertas.data?.atrasados ?? 0) > 0 ? { tonoPie: 'crit' as const } : {}),
    },
    {
      clave: 'rc-en-riesgo',
      etiqueta: 'RC · En riesgo',
      valor: alertas.data?.enRiesgo ?? '—',
      pie: 'por vencer',
    },
  ];

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl p-4 lg:p-6">
        {/* Bienvenida compacta (verde de marca). */}
        <section className="overflow-hidden rounded-xl bg-gradient-to-br from-primary to-primary-hover p-5 text-primary-foreground sm:p-6">
          <h1 className="text-xl font-semibold tracking-tight">Hola, {sesion?.nombre} 👋</h1>
          <p className="mt-1.5 max-w-2xl text-sm text-primary-foreground/85">
            Empresa activa: {sesion?.empresaActiva.nombre}. Encuentra cualquier pantalla con el menú
            o con Ctrl+K.
          </p>
          {/* La OP no se crea suelta: nace del pedido (R3, §4.1) — abre el constructor. */}
          {tienePermiso('pedidos.administrar') ? (
            <Link
              to="/pedidos"
              state={{ abrirConstructor: true }}
              data-testid="inicio-nueva-orden"
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-white/15 px-3 py-1.5 text-sm font-medium text-primary-foreground ring-1 ring-white/25 transition-colors hover:bg-white/25"
            >
              <Plus className="size-4" aria-hidden />
              Nueva orden
            </Link>
          ) : null}
        </section>

        {/* Indicadores reales de la Ruta Critica (solo con `rc.ruta-ver`). */}
        {puedeVerRc ? (
          <section className="mt-5">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                Ruta Crítica
              </h2>
              <Link
                to="/ruta-critica/pendientes"
                className="text-xs font-medium text-primary hover:underline"
              >
                Ir a Mis pendientes
              </Link>
            </div>
            <KpiTiles kpis={kpisRc} className="mt-2" />
            <BandejaResumen />
          </section>
        ) : null}

        {/* Accesos agrupados como el menu aprobado. */}
        {grupos.map((grupo) => (
          <section key={grupo.clave} className="mt-6">
            <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              {grupo.titulo ?? 'General'}
            </h2>
            <div className="mt-2 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              {grupo.entradas.map((entrada) => {
                const Icono = ICONOS_MODULO[entrada.icono];
                // El padre no navega: su tarjeta abre su primer hijo visible.
                const ruta = entrada.hijos === undefined ? entrada.ruta : entrada.hijos[0]?.ruta;
                if (ruta === undefined) {
                  return null;
                }
                return (
                  <Link
                    key={entrada.clave}
                    to={ruta}
                    className="group flex items-start gap-3 rounded-lg bg-card p-3 text-card-foreground ring-1 ring-foreground/10 transition-all hover:shadow-sm hover:ring-primary/40"
                  >
                    <span
                      aria-hidden
                      className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary-soft-foreground"
                    >
                      <Icono className="size-4" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <h3 className="truncate text-sm font-semibold">{entrada.titulo}</h3>
                        {entrada.destacado ? (
                          <Star
                            className="size-3 shrink-0 fill-amber-400 text-amber-400"
                            aria-hidden
                          />
                        ) : null}
                        <ArrowRight
                          className="ml-auto size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                          aria-hidden
                        />
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                        {entrada.descripcion}
                      </p>
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

/** Texto de urgencia compacto de una tarea de la bandeja (mismo criterio que Mis pendientes). */
function textoUrgencia(t: TareaRc): string {
  const fecha = fechaRc(t.fechaPlaneadaVigente);
  if (t.urgencia === 'vencida') return `venció ${fecha} · -${String(t.diasAtraso)} d`;
  if (t.urgencia === 'hoy') return `para hoy · ${fecha}`;
  if (t.urgencia === 'sinFecha') return 'sin fecha (calculando)';
  return fecha;
}

/**
 * BANDEJA DE RUTA CRITICA del Resumen (proto vResumen `rcItem`): los primeros procesos a capturar
 * (atrasados/hoy primero) con su SEMAFORO derivado en el servidor, tomados de la bandeja viva
 * (`useBandejaRc`). Se monta SOLO con `rc.ruta-ver` (el padre lo condiciona), asi el hook no consulta
 * sin permiso. Cero logica/agregacion en cliente (A1): el orden y el semaforo los da el backend.
 */
function BandejaResumen(): React.JSX.Element {
  const bandeja = useBandejaRc({ pagina: 1, porPagina: 6 });
  const tareas = bandeja.data?.datos ?? [];

  return (
    <div className="mt-3 overflow-hidden rounded-xl border bg-card">
      <div className="flex items-center justify-between gap-3 border-b px-3 py-2">
        <h3 className="text-sm font-semibold">Bandeja de Ruta Crítica</h3>
        <Link
          to="/ruta-critica/pendientes"
          className="text-xs font-medium text-primary hover:underline"
        >
          a capturar
        </Link>
      </div>
      {bandeja.isPending ? (
        <p className="p-4 text-sm text-muted-foreground">Cargando…</p>
      ) : tareas.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">Nada pendiente por capturar. ✓</p>
      ) : (
        <ul className="divide-y">
          {tareas.map((t) => (
            <li key={t.idRutaOrden} className="flex items-center gap-3 px-3 py-2">
              <Semaforo semaforo={t.semaforo} soloPunto />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {t.nombreProceso}{' '}
                  <span className="font-normal text-muted-foreground">· Orden #{t.folioOrden}</span>
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {t.descripcionModelo ?? t.codigoModelo} · {t.cliente}
                </span>
              </span>
              <span
                className={`shrink-0 text-xs font-medium ${
                  t.urgencia === 'vencida'
                    ? 'text-crit'
                    : t.urgencia === 'hoy'
                      ? 'text-warn'
                      : 'text-muted-foreground'
                }`}
              >
                {textoUrgencia(t)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
