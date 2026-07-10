import { Search } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useListaCostos } from '@/api/costos';
import type { ListaCostosQuery } from '@/api/tipos';
import {
  TablaDensa,
  TablaDensaCelda,
  TablaDensaCuerpo,
  TablaDensaEncabezado,
  TablaDensaFila,
  TablaDensaHead,
} from '@/components/dominio/TablaDensa';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useDebounce } from '@/lib/useDebounce';

import { etiquetaBase, moneda } from './comun';

/** Renglones por página del listado. */
const POR_PAGINA = 20;

/**
 * LISTA DE COSTOS (F7-E1; ex `ListaCostos`; proto `vCostos` — re-vestida R9 a TABLA-FIRST): las órdenes
 * ya costeadas de la empresa activa con su costo total y unitario. page-head + card con barra de
 * herramientas (búsqueda folio/modelo/cliente/referencia) + TABLA DENSA + barra de totales al pie con
 * paginación. Búsqueda y paginación de SERVIDOR (A1). Al tocar una fila salta al costeo de esa orden.
 * Solo lectura (`costos.ver`); importes en "—" sin `consultas.ver-importes`.
 *
 * FIDELIDAD vs proto: el proto lidera con 4 KPIs (costo prom · margen bruto · ventas · utilidad); el
 * endpoint `/costos/lista` es un LISTADO paginado y no devuelve esos agregados (el margen por pedido
 * vive en "Costos y márgenes"). No se pivotea en cliente (A1) → los KPIs quedan como hueco de endpoint.
 */
export function ListaCostosPagina(): React.JSX.Element {
  const navigate = useNavigate();
  const [busqueda, setBusqueda] = useState('');
  const debounced = useDebounce(busqueda, 300);
  const [pagina, setPagina] = useState(1);

  const query: ListaCostosQuery = {
    pagina,
    porPagina: POR_PAGINA,
    ...(debounced === '' ? {} : { busqueda: debounced }),
  };
  const consulta = useListaCostos(query);
  const datos = consulta.data;
  const filas = datos?.datos ?? [];
  const total = datos?.total ?? 0;
  const totalPaginas = datos?.totalPaginas ?? 1;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4 md:p-5" data-testid="lista-costos">
      {/* ── Encabezado ─────────────────────────────────────────────────────── */}
      <header className="flex shrink-0 flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-[21px] leading-tight font-semibold tracking-tight">
            Lista de costos
          </h1>
          <p className="truncate text-[12.5px] text-muted-foreground">
            Órdenes con costo capturado: costo total y unitario por base de prorrateo
          </p>
        </div>
      </header>

      {/* ── Card: filtros + tabla + totales ─────────────────────────────────── */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-card">
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2">
          <div className="relative w-64">
            <Search
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              value={busqueda}
              onChange={(e) => {
                setBusqueda(e.target.value);
                setPagina(1);
              }}
              placeholder="Folio, modelo o cliente…"
              className="h-8 pl-8 text-sm"
              data-testid="lc-buscar"
              aria-label="Buscar órdenes costeadas"
            />
          </div>
          <div className="ml-auto">
            <span className="text-[12px] text-faint">{total.toLocaleString('es-MX')} órdenes</span>
          </div>
        </div>

        {/* ── Cuerpo scrolleable ─────────────────────────────────────────── */}
        <div className="min-h-0 flex-1 overflow-auto">
          {consulta.isPending ? (
            <p className="p-6 text-sm text-muted-foreground">Cargando…</p>
          ) : consulta.isError ? (
            <div className="space-y-2 p-6">
              <p className="text-sm text-destructive" role="alert">
                {consulta.error.message}
              </p>
              <Button variant="outline" size="sm" onClick={() => void consulta.refetch()}>
                Reintentar
              </Button>
            </div>
          ) : filas.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">No hay órdenes costeadas.</p>
          ) : (
            <TablaDensa>
              <TablaDensaEncabezado>
                <TablaDensaFila>
                  <TablaDensaHead>Orden</TablaDensaHead>
                  <TablaDensaHead>Modelo</TablaDensaHead>
                  <TablaDensaHead>Cliente</TablaDensaHead>
                  <TablaDensaHead numerica>Cortado</TablaDensaHead>
                  <TablaDensaHead>Base</TablaDensaHead>
                  <TablaDensaHead numerica>Costo total</TablaDensaHead>
                  <TablaDensaHead numerica>Costo unitario</TablaDensaHead>
                </TablaDensaFila>
              </TablaDensaEncabezado>
              <TablaDensaCuerpo>
                {filas.map((f) => (
                  <TablaDensaFila
                    key={f.idOrden}
                    className="cursor-pointer"
                    onClick={() => void navigate(`/costos/costeo?idOrden=${String(f.idOrden)}`)}
                    data-testid={`lc-fila-${f.idOrden}`}
                  >
                    <TablaDensaCelda className="font-medium">#{f.folio}</TablaDensaCelda>
                    <TablaDensaCelda>{f.codigoModelo}</TablaDensaCelda>
                    <TablaDensaCelda className="text-muted-foreground">{f.cliente}</TablaDensaCelda>
                    <TablaDensaCelda numerica>{f.cortado}</TablaDensaCelda>
                    <TablaDensaCelda>{etiquetaBase(f.baseProrrateo)}</TablaDensaCelda>
                    <TablaDensaCelda numerica className="font-medium">
                      {moneda(f.costoTotal)}
                    </TablaDensaCelda>
                    <TablaDensaCelda numerica>{moneda(f.costoUnitario)}</TablaDensaCelda>
                  </TablaDensaFila>
                ))}
              </TablaDensaCuerpo>
            </TablaDensa>
          )}
        </div>

        {/* ── Barra de totales al pie ────────────────────────────────────── */}
        <div className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-1 border-t bg-secondary px-3 py-1.5 text-xs">
          <span className="flex items-baseline gap-1.5">
            <span className="text-[10.5px] font-medium text-faint uppercase">
              Órdenes costeadas
            </span>
            <b className="num">{total.toLocaleString('es-MX')}</b>
          </span>
          {total > 0 && totalPaginas > 1 ? (
            <span className="ml-auto flex items-center gap-2 text-muted-foreground">
              Página {pagina} de {totalPaginas}
              <Button
                variant="ghost"
                size="sm"
                disabled={pagina <= 1 || consulta.isFetching}
                onClick={() => setPagina((p) => Math.max(1, p - 1))}
              >
                Anterior
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={pagina >= totalPaginas || consulta.isFetching}
                onClick={() => setPagina((p) => p + 1)}
              >
                Siguiente
              </Button>
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
