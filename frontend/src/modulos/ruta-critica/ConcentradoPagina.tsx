import { FileSpreadsheet, LayoutGrid, Search } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useRoles } from '@/api/roles';
import { useProcesosRc } from '@/api/ruta-critica';
import { useConcentradoRc, urlConcentradoExcel } from '@/api/ruta-critica-programacion';
import type { ConcentradoRcFila, ConcentradoRcProceso, ConcentradoRcQuery } from '@/api/tipos';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useDebounce } from '@/lib/useDebounce';

import { Semaforo, fechaRc } from './piezas';

/** Renglones por página del concentrado. */
const POR_PAGINA = 20;

/** Etiqueta legible del criterio de orden. */
const ETIQUETA_ORDEN: Record<NonNullable<ConcentradoRcQuery['orden']>, string> = {
  retraso: 'Retraso (más urgente)',
  cliente: 'Cliente (A→Z)',
  fecha: 'Fecha de entrega',
};

/**
 * CONCENTRADO "planeado vs real" (F5-E7) — el tablero gerencial de la Ruta Crítica que reemplaza la
 * vista más pesada del sistema viejo (`RC_ConcentradoDif`). Lista TODAS las órdenes con la RC viva,
 * cada una con su SEMÁFORO global, su máximo atraso y la tira de semáforos de sus procesos
 * (planeado vs real). Filtros por cliente / proceso / responsable, orden por retraso / cliente /
 * fecha, y EXPORT a Excel (mismo resultado que el tablero). CERO lógica de negocio (A1): el semáforo,
 * el atraso, el orden y la agregación los DERIVA el backend; aquí solo se pinta y se navega.
 * Responsive: card por orden en móvil, fila densa en PC. La gobierna `rc.ruta-ver`.
 */
export function ConcentradoPagina(): React.JSX.Element {
  const navigate = useNavigate();

  const [textoCliente, setTextoCliente] = useState('');
  const busquedaCliente = useDebounce(textoCliente.trim(), 300);
  const [idProcesoDef, setIdProcesoDef] = useState<number | undefined>(undefined);
  const [idRolResponsable, setIdRolResponsable] = useState<number | undefined>(undefined);
  const [orden, setOrden] = useState<NonNullable<ConcentradoRcQuery['orden']>>('retraso');
  const [pagina, setPagina] = useState(1);

  // Catálogos para los selectores. Topan en porPagina 100 (el backend desplegado rechaza >100).
  // Requieren permisos de catálogo/roles; si la sesión no los tiene, la consulta falla en silencio
  // y simplemente NO se ofrece ese filtro (el tablero sigue funcionando sin él).
  const procesos = useProcesosRc({ porPagina: 100 });
  const roles = useRoles();

  const query: ConcentradoRcQuery = {
    pagina,
    porPagina: POR_PAGINA,
    orden,
    ...(busquedaCliente.length > 0 ? { busquedaCliente } : {}),
    ...(idProcesoDef !== undefined ? { idProcesoDef } : {}),
    ...(idRolResponsable !== undefined ? { idRolResponsable } : {}),
  };
  const consulta = useConcentradoRc(query);

  const datos = consulta.data;
  const filas = datos?.datos ?? [];
  const totalPaginas = datos?.totalPaginas ?? 0;
  const resumen = datos?.resumen;

  function reiniciarPagina<T>(set: (v: T) => void): (v: T) => void {
    return (v: T) => {
      set(v);
      setPagina(1);
    };
  }

  const procesosOpciones = procesos.data?.datos ?? [];
  const rolesOpciones = roles.data ?? [];

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="shrink-0 border-b bg-background px-4 py-4 md:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-lg bg-sidebar-accent/40 text-sidebar-accent-foreground">
              <LayoutGrid className="size-5" aria-hidden />
            </span>
            <div>
              <h1 className="text-xl font-semibold">Concentrado planeado vs real</h1>
              <p className="text-sm text-muted-foreground">
                Todas las órdenes con Ruta Crítica viva, con semáforo y atraso por proceso.
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.open(urlConcentradoExcel(query), '_blank', 'noopener')}
            data-testid="concentrado-excel"
          >
            <FileSpreadsheet className="mr-1.5 size-4" aria-hidden />
            Exportar a Excel
          </Button>
        </div>

        {/* Filtros + orden */}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <div className="relative w-full max-w-xs">
            <Search
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              className="pl-8"
              placeholder="Buscar por cliente…"
              value={textoCliente}
              onChange={(e) => {
                setTextoCliente(e.target.value);
                setPagina(1);
              }}
              data-testid="concentrado-buscar-cliente"
            />
          </div>

          {procesosOpciones.length > 0 ? (
            <select
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              value={idProcesoDef ?? ''}
              onChange={(e) =>
                reiniciarPagina(setIdProcesoDef)(
                  e.target.value === '' ? undefined : Number(e.target.value),
                )
              }
              data-testid="concentrado-filtro-proceso"
              aria-label="Filtrar por proceso"
            >
              <option value="">Todos los procesos</option>
              {procesosOpciones.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
            </select>
          ) : null}

          {rolesOpciones.length > 0 ? (
            <select
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              value={idRolResponsable ?? ''}
              onChange={(e) =>
                reiniciarPagina(setIdRolResponsable)(
                  e.target.value === '' ? undefined : Number(e.target.value),
                )
              }
              data-testid="concentrado-filtro-responsable"
              aria-label="Filtrar por responsable"
            >
              <option value="">Todos los responsables</option>
              {rolesOpciones.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.nombre}
                </option>
              ))}
            </select>
          ) : null}

          <select
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            value={orden}
            onChange={(e) =>
              reiniciarPagina(setOrden)(e.target.value as NonNullable<ConcentradoRcQuery['orden']>)
            }
            data-testid="concentrado-orden"
            aria-label="Ordenar por"
          >
            {(Object.keys(ETIQUETA_ORDEN) as (keyof typeof ETIQUETA_ORDEN)[]).map((clave) => (
              <option key={clave} value={clave}>
                {ETIQUETA_ORDEN[clave]}
              </option>
            ))}
          </select>
        </div>

        {/* Resumen por semáforo (sobre todo el filtro) */}
        {resumen !== undefined ? (
          <div className="mt-3 flex flex-wrap gap-2 text-sm" data-testid="concentrado-resumen">
            <ChipResumen color="bg-red-600" etiqueta="Atrasadas" valor={resumen.atrasadas} />
            <ChipResumen color="bg-amber-500" etiqueta="En riesgo" valor={resumen.enRiesgo} />
            <ChipResumen color="bg-emerald-500" etiqueta="A tiempo" valor={resumen.aTiempo} />
          </div>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
        {consulta.isPending ? (
          <p className="text-sm text-muted-foreground" data-testid="concentrado-cargando">
            Cargando concentrado…
          </p>
        ) : consulta.isError ? (
          <div className="space-y-2" role="alert">
            <p className="text-sm text-destructive" data-testid="concentrado-error">
              {consulta.error.message}
            </p>
            <Button variant="outline" size="sm" onClick={() => void consulta.refetch()}>
              Reintentar
            </Button>
          </div>
        ) : filas.length === 0 ? (
          <div
            className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground"
            data-testid="concentrado-vacio"
          >
            No hay órdenes con Ruta Crítica viva que coincidan con el filtro.
          </div>
        ) : (
          <ul className="space-y-3" data-testid="concentrado-filas">
            {filas.map((f) => (
              <OrdenCard
                key={f.idOrden}
                fila={f}
                alAbrir={() => void navigate(`/ruta-critica/ordenes/${f.idOrden}`)}
              />
            ))}
          </ul>
        )}

        {datos !== undefined && totalPaginas > 1 ? (
          <div className="mt-4 flex items-center justify-between gap-2 text-sm">
            <span className="text-muted-foreground" data-testid="concentrado-total">
              {datos.total} {datos.total === 1 ? 'orden' : 'órdenes'}
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={pagina <= 1 || consulta.isFetching}
                onClick={() => setPagina((p) => Math.max(1, p - 1))}
              >
                Anterior
              </Button>
              <span className="tabular-nums text-muted-foreground">
                {pagina} / {totalPaginas}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={pagina >= totalPaginas || consulta.isFetching}
                onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))}
              >
                Siguiente
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Chip del resumen por semáforo (un punto de color + etiqueta + conteo). */
function ChipResumen({
  color,
  etiqueta,
  valor,
}: {
  color: string;
  etiqueta: string;
  valor: number;
}): React.JSX.Element {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1">
      <span aria-hidden className={`inline-block size-2.5 rounded-full ${color}`} />
      <span className="text-muted-foreground">{etiqueta}</span>
      <span className="font-medium tabular-nums">{valor}</span>
    </span>
  );
}

/** Una orden como card: encabezado + semáforo de la orden + tira de semáforos de sus procesos. */
function OrdenCard({
  fila,
  alAbrir,
}: {
  fila: ConcentradoRcFila;
  alAbrir: () => void;
}): React.JSX.Element {
  return (
    <li
      className="rounded-lg border bg-card p-4"
      data-testid="concentrado-fila"
      data-semaforo={fila.semaforo}
      data-id-orden={fila.idOrden}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <button
          type="button"
          className="min-w-0 text-left"
          onClick={alAbrir}
          data-testid="concentrado-abrir-orden"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">Orden {fila.folioOrden}</span>
            {fila.esResurtido ? (
              <Badge variant="secondary" className="shrink-0">
                Resurtido
              </Badge>
            ) : null}
          </div>
          <p className="mt-0.5 truncate text-sm text-muted-foreground">
            {fila.cliente} · {fila.codigoModelo}
            {fila.descripcionModelo ? ` · ${fila.descripcionModelo}` : ''}
          </p>
        </button>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Semaforo semaforo={fila.semaforo} />
          {fila.maxDiasAtraso > 0 ? (
            <span className="text-xs font-medium text-red-600" data-testid="concentrado-atraso">
              {fila.maxDiasAtraso} {fila.maxDiasAtraso === 1 ? 'día' : 'días'} de atraso
            </span>
          ) : null}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>Entrega: {fechaRc(fila.fechaEntregaRC)}</span>
        <span>
          {fila.procesosPendientes}{' '}
          {fila.procesosPendientes === 1 ? 'proceso pendiente' : 'procesos pendientes'}
        </span>
      </div>

      {/* Tira de procesos (planeado vs real): un chip por proceso con su semáforo. */}
      <div className="mt-3 flex flex-wrap gap-1.5" data-testid="concentrado-procesos">
        {fila.procesos.map((p) => (
          <ChipProceso key={p.idProcesoDef} proceso={p} />
        ))}
      </div>
    </li>
  );
}

/** Un proceso (celda) del concentrado: nombre + semáforo (punto). Title = plan→real para el detalle. */
function ChipProceso({ proceso }: { proceso: ConcentradoRcProceso }): React.JSX.Element {
  const detalle = `${proceso.nombreProceso}: plan ${fechaRc(proceso.fechaPlaneadaVigente)} → real ${fechaRc(
    proceso.fechaReal,
  )}${proceso.diasAtraso > 0 ? ` (+${proceso.diasAtraso}d)` : ''}`;
  return (
    <span
      className="inline-flex items-center gap-1 rounded border bg-background px-1.5 py-0.5 text-xs"
      title={detalle}
      data-testid="concentrado-proceso"
      data-semaforo={proceso.semaforo}
    >
      <Semaforo semaforo={proceso.semaforo} soloPunto />
      <span className={proceso.critico ? 'font-medium' : ''}>{proceso.nombreProceso}</span>
    </span>
  );
}
