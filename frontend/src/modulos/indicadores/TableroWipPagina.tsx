import { Download, Printer, RefreshCw } from 'lucide-react';
import { useState } from 'react';

import {
  descargarExcelKpisWip,
  imprimirKpisWip,
  useKpisWip,
  useRefrescarKpis,
} from '@/api/indicadores';
import type { KpisWipQuery } from '@/api/tipos';
import { KpiTiles, type Kpi } from '@/components/dominio/KpiTiles';
import {
  TablaDensa,
  TablaDensaCelda,
  TablaDensaCuerpo,
  TablaDensaEncabezado,
  TablaDensaFila,
  TablaDensaHead,
} from '@/components/dominio/TablaDensa';
import { Button } from '@/components/ui/button';
import { SelectNativo } from '@/components/ui/native-select';

import { entero, selloDatosAl } from './comun';

/**
 * TABLERO WIP analítico (F7-E3, F3; re-vestido R9 al estándar TABLA-FIRST): prendas atoradas por etapa
 * (agregado) y avance por orden. Mismas cifras que el tablero WIP de F3-E5 (suma directa de
 * movimientos), pre-calculado en segundo plano. page-head (filtro + refrescar/PDF/Excel) + KPIs de
 * vistazo + TABLA DENSA con paginación al pie. Solo lectura (`indicadores.ver`).
 */
export function TableroWipPagina(): React.JSX.Element {
  const [soloPendientes, setSoloPendientes] = useState('true');
  const [pagina, setPagina] = useState(1);

  const query: KpisWipQuery = {
    soloPendientes,
    pagina,
    porPagina: 20,
  };
  const consulta = useKpisWip(query);
  const refrescar = useRefrescarKpis();
  const datos = consulta.data;
  const totales = datos?.totales;

  // Los testids legados (`wip-por-cortar`…) viven en el VALOR del tile (el e2e los asserta).
  const kpis: Kpi[] = totales
    ? [
        {
          clave: 'por-cortar',
          etiqueta: 'Por cortar',
          valor: <span data-testid="wip-por-cortar">{entero(totales.porCortar)}</span>,
          pie: 'pzas',
        },
        {
          clave: 'por-enviar',
          etiqueta: 'Cortado por enviar',
          valor: <span data-testid="wip-por-enviar">{entero(totales.cortadoPorEnviar)}</span>,
          pie: 'pzas',
        },
        {
          clave: 'por-recibir',
          etiqueta: 'Por recibir',
          valor: <span data-testid="wip-por-recibir">{entero(totales.porRecibir)}</span>,
          pie: 'en maquila',
        },
        {
          clave: 'por-entregar',
          etiqueta: 'Por entregar',
          valor: <span data-testid="wip-por-entregar">{entero(totales.porEntregar)}</span>,
          pie: 'a cliente',
        },
      ]
    : [];

  return (
    <div className="h-full overflow-y-auto" data-testid="tablero-wip">
      <div className="flex flex-col gap-3 p-4 md:p-5">
        {/* ── Encabezado ─────────────────────────────────────────────────────── */}
        <header className="flex shrink-0 flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-[21px] leading-tight font-semibold tracking-tight">
              WIP analítico
            </h1>
            <p className="truncate text-[12.5px] text-muted-foreground" data-testid="wip-datos-al">
              {selloDatosAl(datos?.datosAl)}
            </p>
          </div>
          <SelectNativo
            className="h-8 w-auto text-sm"
            value={soloPendientes}
            onChange={(e) => {
              setSoloPendientes(e.target.value);
              setPagina(1);
            }}
            aria-label="Órdenes"
            data-testid="wip-pendientes"
          >
            <option value="true">Solo con pendientes</option>
            <option value="false">Todas</option>
          </SelectNativo>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => refrescar.mutate()}
            disabled={refrescar.isPending}
            data-testid="wip-refrescar"
          >
            <RefreshCw aria-hidden />
            Refrescar
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => imprimirKpisWip(query)}
            data-testid="wip-pdf"
          >
            <Printer aria-hidden />
            PDF
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => descargarExcelKpisWip(query)}
            data-testid="wip-excel"
          >
            <Download aria-hidden />
            Excel
          </Button>
        </header>

        {consulta.isError ? (
          <p className="p-6 text-sm text-destructive" role="alert">
            {consulta.error.message}
          </p>
        ) : consulta.isPending ? (
          <p className="p-6 text-sm text-muted-foreground">Cargando…</p>
        ) : datos === undefined || totales === undefined ? null : (
          <>
            {/* ── KPIs por etapa ────────────────────────────────────────────── */}
            <KpiTiles kpis={kpis} className="shrink-0" />

            {/* ── Card: órdenes con su avance ───────────────────────────────── */}
            <div className="overflow-hidden rounded-xl border bg-card">
              <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
                <h3 className="text-sm font-semibold">Órdenes</h3>
                <span className="text-xs text-faint tabular-nums">{entero(datos.total)}</span>
                <span className="ml-auto text-xs text-muted-foreground">
                  página {datos.pagina} de {datos.totalPaginas}
                </span>
              </div>
              {datos.datos.length === 0 ? (
                <p className="p-6 text-sm text-muted-foreground">
                  No hay órdenes para el filtro elegido.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <TablaDensa>
                    <TablaDensaEncabezado>
                      <TablaDensaFila>
                        <TablaDensaHead>Folio</TablaDensaHead>
                        <TablaDensaHead>Cliente</TablaDensaHead>
                        <TablaDensaHead>Modelo</TablaDensaHead>
                        <TablaDensaHead numerica>Pedido</TablaDensaHead>
                        <TablaDensaHead numerica>Cortado</TablaDensaHead>
                        <TablaDensaHead numerica>Enviado</TablaDensaHead>
                        <TablaDensaHead numerica>Recibido</TablaDensaHead>
                        <TablaDensaHead numerica>Entregado</TablaDensaHead>
                        <TablaDensaHead numerica>Por recibir</TablaDensaHead>
                        <TablaDensaHead numerica>Por entregar</TablaDensaHead>
                      </TablaDensaFila>
                    </TablaDensaEncabezado>
                    <TablaDensaCuerpo>
                      {datos.datos.map((o) => (
                        <TablaDensaFila key={o.idOrden} data-testid={`wip-fila-${o.idOrden}`}>
                          <TablaDensaCelda className="font-medium">#{o.folio}</TablaDensaCelda>
                          <TablaDensaCelda>{o.cliente}</TablaDensaCelda>
                          <TablaDensaCelda>{o.codigoModelo}</TablaDensaCelda>
                          <TablaDensaCelda numerica>{o.pedido}</TablaDensaCelda>
                          <TablaDensaCelda numerica>{o.cortado}</TablaDensaCelda>
                          <TablaDensaCelda numerica>{o.enviado}</TablaDensaCelda>
                          <TablaDensaCelda numerica>{o.recibido}</TablaDensaCelda>
                          <TablaDensaCelda numerica>{o.entregado}</TablaDensaCelda>
                          <TablaDensaCelda numerica>{o.porRecibir}</TablaDensaCelda>
                          <TablaDensaCelda numerica>{o.porEntregar}</TablaDensaCelda>
                        </TablaDensaFila>
                      ))}
                    </TablaDensaCuerpo>
                  </TablaDensa>
                </div>
              )}

              {datos.totalPaginas > 1 && (
                <div className="flex flex-wrap items-center justify-end gap-2 border-t bg-secondary px-3 py-1.5 text-xs">
                  <span className="text-muted-foreground">
                    Página {datos.pagina} de {datos.totalPaginas}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={datos.pagina <= 1}
                    onClick={() => setPagina((p) => Math.max(1, p - 1))}
                    data-testid="wip-anterior"
                  >
                    Anterior
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={datos.pagina >= datos.totalPaginas}
                    onClick={() => setPagina((p) => p + 1)}
                    data-testid="wip-siguiente"
                  >
                    Siguiente
                  </Button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
