import { LayoutDashboard } from 'lucide-react';
import { useState } from 'react';

import { useDepartamentosCliente } from '@/api/clientes';
import { useTableroDesarrollos, type EstadoDesarrollo } from '@/api/liga-orden';
import { useTemporadas } from '@/api/temporadas';
import { FiltroCliente } from '@/components/dominio/FiltroCliente';
import { SelectNativo } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';

import { ETIQUETA_ESTADO_DESARROLLO, ORDEN_ESTADOS_DESARROLLO } from './estados';

/** Tope alto para los selectores de filtro (mismo criterio que ProyectosPagina). */
const QUERY_CATALOGO = {
  pagina: 1,
  porPagina: 100,
  ordenarPor: 'nombre',
  direccion: 'asc',
  incluirInactivos: 'false',
} as const;

/** Mapea cada estado derivado al campo de conteo del contrato. */
const CAMPO_CONTEO: Record<
  EstadoDesarrollo,
  'enDesarrollo' | 'cotizado' | 'enLista' | 'ligadoProduccion' | 'apagado'
> = {
  'en-desarrollo': 'enDesarrollo',
  cotizado: 'cotizado',
  'en-lista': 'enLista',
  'ligado-produccion': 'ligadoProduccion',
  apagado: 'apagado',
};

/**
 * TABLERO de desarrollos por ESTADO derivado (F8-E6). Consume `GET /api/desarrollos/tablero`, cuyos
 * conteos ya vienen AGREGADOS en el servidor (nunca se pivota en el cliente, lección F5-E7).
 * Filtrable por cliente/departamento/temporada; una tarjeta por estado + total.
 */
export function TableroDesarrollos(): React.JSX.Element {
  const [idClienteFiltro, setIdClienteFiltro] = useState('');
  const [idDepartamentoFiltro, setIdDepartamentoFiltro] = useState('');
  const [idTemporadaFiltro, setIdTemporadaFiltro] = useState('');

  const temporadas = useTemporadas(QUERY_CATALOGO);
  const departamentos = useDepartamentosCliente(
    idClienteFiltro === '' ? undefined : Number(idClienteFiltro),
  );

  const tablero = useTableroDesarrollos({
    ...(idClienteFiltro === '' ? {} : { idCliente: Number(idClienteFiltro) }),
    ...(idDepartamentoFiltro === '' ? {} : { idClienteDepartamento: Number(idDepartamentoFiltro) }),
    ...(idTemporadaFiltro === '' ? {} : { idTemporada: Number(idTemporadaFiltro) }),
  });

  function cambiarCliente(valor: string): void {
    setIdClienteFiltro(valor);
    setIdDepartamentoFiltro('');
  }

  const conteos = tablero.data;

  return (
    <div className="h-full overflow-y-auto p-4 lg:p-6" data-testid="tablero-desarrollos">
      <div className="mb-4 flex items-center gap-3">
        <span
          aria-hidden
          className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary-soft-foreground"
        >
          <LayoutDashboard className="size-5" aria-hidden />
        </span>
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Desarrollos por estado</h2>
          <p className="text-sm text-muted-foreground">
            Conteo de desarrollos por su estado derivado, filtrable por cliente y temporada.
          </p>
        </div>
      </div>

      {/* Filtros */}
      <div
        className="mb-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-3"
        data-testid="filtros-tablero-desarrollos"
      >
        {/* V1-E4 (punto 7): búsqueda server-side en vez del <select> topado a 100. */}
        <FiltroCliente
          idCliente={idClienteFiltro === '' ? null : Number(idClienteFiltro)}
          alCambiar={(c) => cambiarCliente(c === null ? '' : String(c.id))}
        />
        <SelectNativo
          aria-label="Filtrar por departamento"
          value={idDepartamentoFiltro}
          disabled={idClienteFiltro === ''}
          onChange={(e) => setIdDepartamentoFiltro(e.target.value)}
        >
          <option value="">Todos los departamentos</option>
          {(departamentos.data ?? [])
            .filter((d) => d.activo)
            .map((d) => (
              <option key={d.id} value={String(d.id)}>
                {d.nombre}
              </option>
            ))}
        </SelectNativo>
        <SelectNativo
          aria-label="Filtrar por temporada"
          value={idTemporadaFiltro}
          onChange={(e) => setIdTemporadaFiltro(e.target.value)}
        >
          <option value="">Todas las temporadas</option>
          {(temporadas.data?.datos ?? []).map((t) => (
            <option key={t.id} value={String(t.id)}>
              {t.nombre}
            </option>
          ))}
        </SelectNativo>
      </div>

      {/* Tarjetas por estado */}
      {tablero.isPending ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="tablero-cargando">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))}
        </div>
      ) : tablero.isError ? (
        <p className="text-sm text-destructive">{tablero.error.message}</p>
      ) : conteos ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="tablero-tarjetas">
          <article className="rounded-xl border bg-primary-soft p-4" data-testid="tarjeta-total">
            <p className="text-sm font-medium text-primary-soft-foreground">Total</p>
            <p className="mt-1 text-3xl font-semibold tabular-nums text-primary-soft-foreground">
              {conteos.total.toLocaleString('es-MX')}
            </p>
          </article>
          {ORDEN_ESTADOS_DESARROLLO.map((estado) => (
            <article
              key={estado}
              className="rounded-xl border bg-card p-4"
              data-testid={`tarjeta-estado-${estado}`}
            >
              <p className="text-sm font-medium text-muted-foreground">
                {ETIQUETA_ESTADO_DESARROLLO[estado]}
              </p>
              <p className="mt-1 text-3xl font-semibold tabular-nums">
                {conteos[CAMPO_CONTEO[estado]].toLocaleString('es-MX')}
              </p>
            </article>
          ))}
        </div>
      ) : null}
    </div>
  );
}
