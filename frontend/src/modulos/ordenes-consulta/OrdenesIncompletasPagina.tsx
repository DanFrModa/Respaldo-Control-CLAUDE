import { Printer } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';

import { imprimirOrden, useOrdenesIncompletas } from '@/api/ordenes-consulta';
import type { OrdenesIncompletasQuery } from '@/api/tipos';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useSesion } from '@/sesion/useSesion';

import { fechaCorta } from './formato';
import { SemaforoBadge } from './piezas';

/** Renglones por página. */
const POR_PAGINA = 20;

/**
 * Órdenes INCOMPLETAS (F2-E4): las capturadas SIN matriz (paridad con `FechaDet Is Null` del viejo),
 * ordenadas por antigüedad con un SEMÁFORO (verde/amarillo/urgente). El backend deriva el semáforo
 * (> 7 días = urgente, regla `EsUrgente`); la pantalla solo lo pinta (A1). Cada fila enlaza al
 * detalle de captura para completar la matriz, y se puede imprimir.
 *
 * Para ver el estado URGENTE en una `prueba`: sembrar una orden incompleta antigua con
 * `npm run demo:ordenes` (backend) o crear una orden y dejarla sin matriz > 7 días; el script
 * `backend/scripts/datos-demo-ordenes.ts` siembra una con `creadoEn` de hace 10 días.
 */
export function OrdenesIncompletasPagina(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const puedeImprimir = tienePermiso('ordenes.ver');
  const [pagina, setPagina] = useState(1);

  const query: OrdenesIncompletasQuery = { pagina, porPagina: POR_PAGINA, direccion: 'desc' };
  const consulta = useOrdenesIncompletas(query);
  const datos = consulta.data;
  const filas = datos?.datos ?? [];
  const totalPaginas = datos?.totalPaginas ?? 0;

  return (
    <div className="h-full overflow-y-auto" data-testid="ordenes-incompletas">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-6">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-[21px] leading-tight font-semibold tracking-tight">
              Órdenes incompletas
            </h1>
            <p className="text-[12.5px] text-muted-foreground">
              Órdenes capturadas a las que aún les falta la matriz color × talla.
            </p>
          </div>
        </div>

        {consulta.isError ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-center">
            <p className="text-sm text-destructive">{consulta.error.message}</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => void consulta.refetch()}
            >
              Reintentar
            </Button>
          </div>
        ) : (
          <>
            {/* Móvil (<lg): tarjetas apiladas — la tabla se apachurra en teléfono. Mismo enlace al
                detalle e impresión que la fila. */}
            <div className="space-y-2 lg:hidden" data-testid="incompletas-tarjetas">
              {filas.length === 0 ? (
                <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                  {consulta.isPending
                    ? 'Cargando…'
                    : 'No hay órdenes incompletas. ¡Todo capturado!'}
                </p>
              ) : (
                filas.map((orden) => (
                  <div
                    key={orden.id}
                    data-testid="incompleta-tarjeta"
                    className="rounded-lg border bg-card p-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <Link
                        to="/produccion/ordenes"
                        state={{ idOrden: orden.id }}
                        className="font-semibold text-primary hover:underline"
                        data-testid="enlace-detalle-tarjeta"
                      >
                        {orden.folio}
                      </Link>
                      <SemaforoBadge semaforo={orden.semaforo} />
                    </div>
                    <p className="truncate text-sm font-medium">{orden.codigoModelo}</p>
                    {orden.descripcionModelo ? (
                      <p className="truncate text-xs text-muted-foreground">
                        {orden.descripcionModelo}
                      </p>
                    ) : null}
                    <p className="truncate text-sm">{orden.cliente}</p>
                    <div className="mt-1 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span className="tabular-nums">
                        {orden.diasAntiguedad} {orden.diasAntiguedad === 1 ? 'día' : 'días'} ·
                        Entrega {fechaCorta(orden.fechaEntrega)}
                      </span>
                      {puedeImprimir ? (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => imprimirOrden(orden.id)}
                          aria-label={`Imprimir orden ${orden.folio}`}
                          title="Imprimir esta orden"
                          data-testid="imprimir-individual-tarjeta"
                        >
                          <Printer className="size-4" aria-hidden />
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ))
              )}
            </div>
            {/* Escritorio (≥lg): tabla completa. */}
            <div
              className="hidden rounded-lg ring-1 ring-foreground/10 lg:block"
              data-testid="incompletas-tabla"
            >
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Folio</TableHead>
                    <TableHead>Modelo</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Antigüedad</TableHead>
                    <TableHead>Semáforo</TableHead>
                    <TableHead>Entrega</TableHead>
                    <TableHead className="text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filas.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                        {consulta.isPending
                          ? 'Cargando…'
                          : 'No hay órdenes incompletas. ¡Todo capturado!'}
                      </TableCell>
                    </TableRow>
                  ) : (
                    filas.map((orden) => (
                      <TableRow key={orden.id} data-testid="fila-incompleta">
                        <TableCell className="font-medium">
                          <Link
                            to="/produccion/ordenes"
                            state={{ idOrden: orden.id }}
                            className="text-primary hover:underline"
                            data-testid="enlace-detalle"
                          >
                            {orden.folio}
                          </Link>
                        </TableCell>
                        <TableCell>
                          <span className="font-medium">{orden.codigoModelo}</span>
                          {orden.descripcionModelo ? (
                            <span className="block text-xs text-muted-foreground">
                              {orden.descripcionModelo}
                            </span>
                          ) : null}
                        </TableCell>
                        <TableCell>{orden.cliente}</TableCell>
                        <TableCell className="tabular-nums">
                          {orden.diasAntiguedad} {orden.diasAntiguedad === 1 ? 'día' : 'días'}
                        </TableCell>
                        <TableCell>
                          <SemaforoBadge semaforo={orden.semaforo} />
                        </TableCell>
                        <TableCell>{fechaCorta(orden.fechaEntrega)}</TableCell>
                        <TableCell className="text-right">
                          {puedeImprimir ? (
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => imprimirOrden(orden.id)}
                              aria-label={`Imprimir orden ${orden.folio}`}
                              title="Imprimir esta orden"
                              data-testid="imprimir-individual"
                            >
                              <Printer className="size-4" aria-hidden />
                            </Button>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </>
        )}

        {datos && datos.total > 0 ? (
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>
              {datos.total.toLocaleString('es-MX')} incompletas · página {datos.pagina} de{' '}
              {totalPaginas}
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={datos.pagina <= 1 || consulta.isFetching}
                onClick={() => setPagina((p) => Math.max(1, p - 1))}
              >
                Anterior
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={datos.pagina >= totalPaginas || consulta.isFetching}
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
