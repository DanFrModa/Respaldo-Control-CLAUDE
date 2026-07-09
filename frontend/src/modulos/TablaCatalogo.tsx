import {
  ChevronLeft,
  ChevronRight,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import * as React from 'react';

import {
  TablaDensa,
  TablaDensaCelda,
  TablaDensaCuerpo,
  TablaDensaEncabezado,
  TablaDensaFila,
  TablaDensaHead,
} from '@/components/dominio/TablaDensa';
import { EstadoBadge } from '@/components/dominio/visuales';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/** Una columna de datos de la tabla del catálogo (proto `vCat.cols`). */
export interface ColumnaCatalogo<T> {
  /** Encabezado de la columna. */
  encabezado: string;
  /** Alinea a la derecha (columnas numéricas). */
  numerica?: boolean;
  /** Render de la celda para un registro. */
  render: (registro: T) => React.ReactNode;
}

/** Paginación de servidor (misma forma que `PaginacionListaDetalle`). */
export interface PaginacionCatalogo {
  total: number;
  pagina: number;
  totalPaginas: number;
  ocupado: boolean;
  alAnterior: () => void;
  alSiguiente: () => void;
}

/** Props del motor tabla-first de catálogos. */
export interface PropsTablaCatalogo<T> {
  /** Base de los `data-testid` (p. ej. "color" -> `nuevo-color`, `fila-color`). */
  testid: string;
  titulo: string;
  descripcion: string;
  icono: LucideIcon;
  /** Sustantivo plural para el conteo ("colores", "tallas"…). */
  unidad: string;
  registros: readonly T[];
  cargando: boolean;
  error: string | null;
  alReintentar?: () => void;
  obtenerId: (registro: T) => number | string;
  obtenerActivo: (registro: T) => boolean;
  columnas: readonly ColumnaCatalogo<T>[];
  /** Texto del buscador (controlado). */
  busqueda: string;
  alBuscar: (valor: string) => void;
  /** Controles extra en la barra (selects de filtro). */
  filtros?: React.ReactNode;
  incluirInactivos: boolean;
  alAlternarInactivos: () => void;
  /** Oculta el toggle de inactivos (catálogos sin borrado suave). */
  ocultarToggleInactivos?: boolean;
  textoVacio: string;
  paginacion?: PaginacionCatalogo | undefined;
  puedeAdministrar: boolean;
  alNuevo?: () => void;
  textoNuevo: string;
  /** Acciones extra del encabezado (p. ej. "Fusionar"). */
  accionesEncabezado?: React.ReactNode;
  alEditar?: (registro: T) => void;
  alDesactivar?: (registro: T) => void;
  alReactivar?: (registro: T) => void;
  /** Oculta la columna de estado/acciones (catálogos sin borrado suave, p. ej. tipos de proceso). */
  ocultarEstado?: boolean;
}

/**
 * TABLA-FIRST de CATÁLOGO (rediseño R9, proto `vCat`): la pantalla estándar de los catálogos base
 * (colores, tallas, temporadas, almacenes…). page-head (título + "Nuevo") + card con barra de
 * herramientas (búsqueda, filtros, inactivos, conteo) + TABLA DENSA con las columnas del catálogo,
 * su Estado (borrado suave) y las acciones inline (editar / desactivar / activar) para quien
 * administra + barra de totales al pie con paginación de servidor.
 *
 * Sustituye al motor LISTA + DETALLE en los catálogos SIN detalle rico (los que en el proto son una
 * tabla plana). Conserva los `data-testid` del motor anterior (`nuevo-*`, `buscar-*`, `fila-*`,
 * `editar-*`, `desactivar-*`, `activar-*`, `mostrar-desactivados`) para no romper los e2e. Presentación
 * PURA (A1): no sabe de negocio; cada pantalla le pasa sus columnas y handlers.
 */
export function TablaCatalogo<T>({
  testid,
  titulo,
  descripcion,
  icono: Icono,
  unidad,
  registros,
  cargando,
  error,
  alReintentar,
  obtenerId,
  obtenerActivo,
  columnas,
  busqueda,
  alBuscar,
  filtros,
  incluirInactivos,
  alAlternarInactivos,
  ocultarToggleInactivos = false,
  textoVacio,
  paginacion,
  puedeAdministrar,
  alNuevo,
  textoNuevo,
  accionesEncabezado,
  alEditar,
  alDesactivar,
  alReactivar,
  ocultarEstado = false,
}: PropsTablaCatalogo<T>): React.JSX.Element {
  const total = paginacion?.total ?? registros.length;
  const pagina = paginacion?.pagina ?? 1;
  const totalPaginas = paginacion?.totalPaginas ?? 1;
  const mostrarAcciones =
    puedeAdministrar && (alEditar !== undefined || alDesactivar !== undefined);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4 md:p-5">
      {/* ── Encabezado ─────────────────────────────────────────────────────── */}
      <header className="flex shrink-0 flex-wrap items-center gap-3">
        <span
          aria-hidden
          className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary-soft-foreground"
        >
          <Icono className="size-4.5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold">{titulo}</h1>
          <p className="truncate text-xs text-muted-foreground">{descripcion}</p>
        </div>
        {puedeAdministrar ? (
          <div className="flex flex-wrap items-center gap-2">
            {accionesEncabezado}
            {alNuevo ? (
              <Button size="sm" onClick={alNuevo} data-testid={`nuevo-${testid}`}>
                <Plus aria-hidden />
                {textoNuevo}
              </Button>
            ) : null}
          </div>
        ) : null}
      </header>

      {/* ── Card: filtros + tabla + totales ─────────────────────────────────── */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-card">
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2">
          <Input
            type="search"
            className="h-8 w-52 text-sm"
            placeholder="Buscar…"
            value={busqueda}
            onChange={(e) => alBuscar(e.target.value)}
            aria-label={`Buscar ${titulo.toLowerCase()}`}
            data-testid={`buscar-${testid}`}
          />
          {filtros}
          {ocultarToggleInactivos ? null : (
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={incluirInactivos}
                onChange={alAlternarInactivos}
                data-testid="mostrar-desactivados"
              />
              Incluir inactivos
            </label>
          )}
          <div className="ml-auto">
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
              {total.toLocaleString('es-MX')} {unidad}
            </span>
          </div>
        </div>

        {/* ── Cuerpo scrolleable ─────────────────────────────────────────── */}
        <div className="min-h-0 flex-1 overflow-auto">
          {error ? (
            <div className="space-y-2 p-6">
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
              {alReintentar ? (
                <Button variant="outline" size="sm" onClick={alReintentar}>
                  Reintentar
                </Button>
              ) : null}
            </div>
          ) : cargando ? (
            <p className="p-6 text-sm text-muted-foreground">Cargando {unidad}…</p>
          ) : registros.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground" data-testid={`${testid}-vacio`}>
              {textoVacio}
            </p>
          ) : (
            <TablaDensa>
              <TablaDensaEncabezado>
                <TablaDensaFila>
                  {columnas.map((col) => (
                    <TablaDensaHead key={col.encabezado} numerica={col.numerica === true}>
                      {col.encabezado}
                    </TablaDensaHead>
                  ))}
                  {ocultarEstado ? null : <TablaDensaHead>Estado</TablaDensaHead>}
                  {mostrarAcciones ? <TablaDensaHead className="w-24 text-right" /> : null}
                </TablaDensaFila>
              </TablaDensaEncabezado>
              <TablaDensaCuerpo>
                {registros.map((registro) => {
                  const id = obtenerId(registro);
                  const activo = obtenerActivo(registro);
                  return (
                    <TablaDensaFila key={id} data-testid={`fila-${testid}`}>
                      {columnas.map((col) => (
                        <TablaDensaCelda key={col.encabezado} numerica={col.numerica === true}>
                          {col.render(registro)}
                        </TablaDensaCelda>
                      ))}
                      {ocultarEstado ? null : (
                        <TablaDensaCelda>
                          <EstadoBadge activo={activo} />
                        </TablaDensaCelda>
                      )}
                      {mostrarAcciones ? (
                        <TablaDensaCelda className="text-right">
                          <div className="flex justify-end gap-1">
                            {alEditar ? (
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                onClick={() => alEditar(registro)}
                                aria-label="Editar"
                                data-testid={`editar-${testid}`}
                              >
                                <Pencil className="size-4" aria-hidden />
                              </Button>
                            ) : null}
                            {activo
                              ? alDesactivar !== undefined && (
                                  <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    onClick={() => alDesactivar(registro)}
                                    aria-label="Desactivar"
                                    data-testid={`desactivar-${testid}`}
                                  >
                                    <Trash2 className="size-4 text-destructive" aria-hidden />
                                  </Button>
                                )
                              : alReactivar !== undefined && (
                                  <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    onClick={() => alReactivar(registro)}
                                    aria-label="Activar"
                                    data-testid={`activar-${testid}`}
                                  >
                                    <RotateCcw className="size-4" aria-hidden />
                                  </Button>
                                )}
                          </div>
                        </TablaDensaCelda>
                      ) : null}
                    </TablaDensaFila>
                  );
                })}
              </TablaDensaCuerpo>
            </TablaDensa>
          )}
        </div>

        {/* ── Barra de totales al pie ────────────────────────────────────── */}
        <div className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-1 border-t bg-secondary px-3 py-1.5 text-xs">
          <span className="flex items-baseline gap-1.5">
            <span className="text-[10.5px] font-medium text-faint uppercase">
              {unidad} (filtro)
            </span>
            <b className="num">{total.toLocaleString('es-MX')}</b>
          </span>
          {paginacion ? (
            <span
              className="ml-auto flex items-center gap-1 text-muted-foreground"
              data-testid="resumen-paginacion"
            >
              Página {pagina} de {totalPaginas}
              <Button
                variant="ghost"
                size="icon"
                disabled={pagina <= 1 || paginacion.ocupado}
                onClick={paginacion.alAnterior}
                aria-label="Página anterior"
              >
                <ChevronLeft className="size-4" aria-hidden />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                disabled={pagina >= totalPaginas || paginacion.ocupado}
                onClick={paginacion.alSiguiente}
                aria-label="Página siguiente"
              >
                <ChevronRight className="size-4" aria-hidden />
              </Button>
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
