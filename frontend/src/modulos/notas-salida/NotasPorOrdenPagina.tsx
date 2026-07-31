import { Filter, Layers, Printer, Search, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { imprimirNota, useNotasSalida } from '@/api/notas-salida';
import { useConsultaOrdenes } from '@/api/ordenes-consulta';
import { ChipEstado } from '@/components/dominio/ChipEstado';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useDebounce } from '@/lib/useDebounce';
import { cn } from '@/lib/utils';

import { PanelHabilitacionOrden } from './PanelHabilitacionOrden';
import { TONO_ESTATUS_NOTA, descripcionMaterialNota, fechaCortaNota } from './piezas';

/** Notas por página de la orden elegida. */
const POR_PAGINA = 10;

/** Lee `state.idOrden` del deep-link (mosaico "Notas salida" del centro de comando, R2). */
function leerIdOrdenDeepLink(state: unknown): number | null {
  if (typeof state !== 'object' || state === null || !('idOrden' in state)) {
    return null;
  }
  const id = state.idOrden;
  return typeof id === 'number' && Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * NOTAS POR ORDEN DE PRODUCCIÓN (F4-E5, re-vestida R9 al estándar del módulo): se elige una orden y
 * se listan las notas de salida que le envían material (vía sus renglones, filtro `idOrden`), con el
 * banner del proto `.filtro-orden` (orden elegida + Ver habilitación + quitar). Reemplaza
 * NotasOrd / NotasOrdSub del sistema viejo. Solo lectura; el botón Imprimir abre el PDF server-side
 * de la nota. El cruce "notas que envían a una orden" lo hace el SERVIDOR (paginación de servidor);
 * el front solo presenta (A1). Se lee bien en móvil (regla 10).
 */
export function NotasPorOrdenPagina(): React.JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const [textoBusqueda, setTextoBusqueda] = useState('');
  const busqueda = useDebounce(textoBusqueda.trim(), 300);
  // Deep-link del centro de comando (R2): llega con la orden ya elegida.
  const [idOrden, setIdOrden] = useState<number | null>(leerIdOrdenDeepLink(location.state));
  const [pagina, setPagina] = useState(1);
  // Panel de habilitación / surtido de la orden (R6, §4.6) — se abre desde el banner.
  const [habAbierta, setHabAbierta] = useState(false);

  const idDeepLink = leerIdOrdenDeepLink(location.state);
  useEffect(() => {
    if (idDeepLink !== null) {
      setIdOrden(idDeepLink);
      // Consume el state para que un refresh/volver no lo re-aplique (patrón ModelosPagina).
      void navigate(location.pathname, { replace: true, state: null });
    }
  }, [idDeepLink, location.pathname, navigate]);

  // Órdenes de producción no canceladas para elegir.
  const ordenes = useConsultaOrdenes({
    pagina: 1,
    porPagina: 20,
    incluirCanceladas: 'false',
    ...(busqueda.length > 0 ? { busqueda } : {}),
  });

  // Notas ligadas a la orden elegida: filtro server-side por `idOrden` (paginación real).
  const notas = useNotasSalida(
    idOrden === null
      ? { pagina: 1, porPagina: POR_PAGINA }
      : {
          pagina,
          porPagina: POR_PAGINA,
          idOrden,
          ordenarPor: 'numNota',
          direccion: 'desc',
          incluirCanceladas: 'true',
        },
  );

  function elegirOrden(id: number): void {
    setIdOrden(id);
    setPagina(1);
  }

  const ordenSeleccionada = (ordenes.data?.datos ?? []).find((o) => o.id === idOrden);
  const notasLigadas = idOrden === null ? [] : (notas.data?.datos ?? []);
  const totalPaginas = notas.data?.totalPaginas ?? 0;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4 md:p-5">
      {/* ── Encabezado de página ─────────────────────────────────────────── */}
      <header className="flex shrink-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="min-w-0 flex-1">
          <h1 className="text-[21px] leading-tight font-semibold tracking-tight">
            Notas por orden
          </h1>
          <p className="truncate text-[12.5px] text-muted-foreground">
            Notas de salida que envían material a una orden de producción.
          </p>
        </div>
      </header>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
        {/* ── Paso 1: elegir orden de producción ─────────────────────────── */}
        <div className="max-w-xl space-y-2 rounded-xl border bg-card p-3">
          <label htmlFor="npo-buscar-orden" className="text-xs font-medium">
            Orden de producción
          </label>
          <div className="relative">
            <Search
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              id="npo-buscar-orden"
              type="search"
              placeholder="Buscar por folio, modelo o cliente…"
              value={textoBusqueda}
              onChange={(e) => setTextoBusqueda(e.target.value)}
              className="h-8 pl-8 text-sm"
              data-testid="npo-buscar-orden"
            />
          </div>
          <div className="max-h-48 overflow-y-auto rounded-lg border">
            {ordenes.isPending ? (
              <p className="p-3 text-sm text-muted-foreground">Cargando órdenes…</p>
            ) : ordenes.isError ? (
              <p className="p-3 text-sm text-destructive">{ordenes.error.message}</p>
            ) : (ordenes.data?.datos ?? []).length === 0 ? (
              <p className="p-3 text-sm text-muted-foreground">
                No hay órdenes que coincidan con la búsqueda.
              </p>
            ) : (
              <ul data-testid="npo-lista-ordenes">
                {(ordenes.data?.datos ?? []).map((o) => (
                  <li key={o.id}>
                    <button
                      type="button"
                      onClick={() => elegirOrden(o.id)}
                      aria-pressed={idOrden === o.id}
                      className={cn(
                        'flex w-full cursor-pointer items-center justify-between gap-2 border-b px-3 py-1.5 text-left text-sm transition-colors last:border-b-0 hover:bg-muted/60',
                        idOrden === o.id &&
                          'bg-primary-soft shadow-[inset_3px_0_0_var(--primary)] hover:bg-primary-soft',
                      )}
                      data-testid="npo-orden-opcion"
                    >
                      <span className="font-medium">Orden {o.folio}</span>
                      <span className="num truncate text-xs text-muted-foreground">
                        {o.codigoModelo} · {o.cliente}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* ── Paso 2: banner de la orden elegida + sus notas ─────────────── */}
        {idOrden !== null ? (
          <>
            {/* Banner del proto `.filtro-orden`. */}
            <div
              className="flex flex-wrap items-center gap-2.5 rounded-[9px] border border-primary/25 bg-primary-soft px-3 py-[7px] text-[12.5px] text-primary-soft-foreground"
              data-testid="npo-banner-orden"
            >
              <Filter className="size-3.5 shrink-0" aria-hidden />
              <span>
                Notas de salida de la orden{' '}
                <b className="num">{ordenSeleccionada?.folio ?? `#${idOrden}`}</b>
                {ordenSeleccionada !== undefined ? (
                  <> · modelo {ordenSeleccionada.codigoModelo}</>
                ) : null}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={() => setHabAbierta(true)}
                data-testid="npo-ver-habilitacion"
              >
                <Layers aria-hidden />
                Ver avíos
              </Button>
              <button
                type="button"
                onClick={() => setIdOrden(null)}
                className="flex size-5 cursor-pointer items-center justify-center rounded-[5px] bg-primary/15 transition-colors hover:bg-primary/25"
                title="Quitar filtro"
                aria-label="Quitar el filtro de orden"
                data-testid="npo-quitar-orden"
              >
                <X className="size-3" aria-hidden />
              </button>
            </div>

            {notas.isPending ? (
              <div className="space-y-2" data-testid="npo-cargando">
                <Skeleton className="h-16 w-full rounded-lg" />
                <Skeleton className="h-16 w-full rounded-lg" />
              </div>
            ) : notas.isError ? (
              <p className="text-sm text-destructive" role="alert">
                {notas.error.message}
              </p>
            ) : notasLigadas.length === 0 ? (
              <p
                className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground"
                data-testid="npo-vacio"
              >
                Esta orden de producción no tiene notas de salida.
              </p>
            ) : (
              <>
                <ul className="space-y-2" data-testid="npo-lista-notas">
                  {notasLigadas.map((nota) => {
                    const chip = TONO_ESTATUS_NOTA[nota.estatus];
                    return (
                      <li
                        key={nota.id}
                        className="overflow-hidden rounded-lg border bg-card"
                        data-testid="npo-nota"
                      >
                        {/* Cabecera de la nota (mismo lenguaje del listado: thumb NS + folio + chip). */}
                        <div className="flex flex-wrap items-center gap-2 bg-panel-2 px-3 py-1.5">
                          <span
                            aria-hidden
                            className="flex size-[24px] shrink-0 items-center justify-center rounded-[6px] bg-linear-150 from-[#7bd6a6] to-[#2f9c66] text-[10px] font-bold text-[#04140c]"
                          >
                            NS
                          </span>
                          <span className="text-xs font-medium">Nota {nota.numNota}</span>
                          <span className="truncate text-xs text-muted-foreground">
                            {nota.maquilero}
                          </span>
                          <span className="ml-auto flex items-center gap-2">
                            <ChipEstado tono={chip.tono}>{chip.texto}</ChipEstado>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-6"
                              onClick={() => imprimirNota(nota.id)}
                              aria-label={`Imprimir nota de salida ${nota.numNota}`}
                              data-testid="npo-imprimir-nota"
                            >
                              <Printer className="size-3.5" aria-hidden />
                            </Button>
                          </span>
                        </div>
                        <p className="num border-t px-3 py-1.5 text-[11px] text-faint">
                          Elaboración {fechaCortaNota(nota.fechaElaboracion)} · Envío{' '}
                          {fechaCortaNota(nota.fechaEnvio)} · Almacén {nota.almacen}
                        </p>

                        {/* Solo los renglones que envían a ESTA orden. */}
                        {nota.lineas
                          .filter((linea) => linea.idOrden === idOrden)
                          .map((linea) => (
                            <div
                              key={linea.id}
                              className="flex items-center justify-between gap-2 border-t px-3 py-1.5"
                              data-testid="npo-renglon"
                            >
                              <span className="min-w-0 truncate text-xs font-medium">
                                {descripcionMaterialNota(linea)}
                              </span>
                              <span className="num shrink-0 text-xs font-semibold">
                                {linea.cantidad.toLocaleString('es-MX')}
                                {linea.unidad ? ` ${linea.unidad}` : ''}
                              </span>
                            </div>
                          ))}
                      </li>
                    );
                  })}
                </ul>

                {totalPaginas > 1 ? (
                  <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPagina((p) => Math.max(1, p - 1))}
                      disabled={pagina <= 1 || notas.isFetching}
                    >
                      Anterior
                    </Button>
                    <span>
                      Página {pagina} de {totalPaginas}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))}
                      disabled={pagina >= totalPaginas || notas.isFetching}
                    >
                      Siguiente
                    </Button>
                  </div>
                ) : null}
              </>
            )}
          </>
        ) : null}
      </div>

      {idOrden !== null ? (
        <PanelHabilitacionOrden
          idOrden={idOrden}
          abierto={habAbierta}
          alCerrar={() => setHabAbierta(false)}
          encabezado={
            ordenSeleccionada
              ? { folio: ordenSeleccionada.folio, modelo: ordenSeleccionada.codigoModelo }
              : undefined
          }
        />
      ) : null}
    </div>
  );
}
