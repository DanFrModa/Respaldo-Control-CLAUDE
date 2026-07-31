import { CheckCircle2, Loader2Icon } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { useAutorizarOc, useOrdenesCompra } from '@/api/ordenes-compra';
import type { OrdenCompra } from '@/api/tipos';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { formatearMoneda } from '@/lib/formato';
import { useSesion } from '@/sesion/useSesion';

import { DetalleRenglonesOc } from './DetalleRenglonesOc';
import { fechaCortaOc } from './piezas';

/** Renglones por página de la bandeja. */
const POR_PAGINA = 20;

/**
 * Bandeja de AUTORIZACIÓN de órdenes de compra (F4-E2): lista las OC pendientes de autorizar y
 * permite autorizarlas con un botón. Pensada para usarse EN CELULAR (PLANMAESTRO §Acceso: las
 * autorizaciones se hacen desde el móvil), así que el layout es de TARJETAS responsivas (1 columna en
 * móvil, 2 en escritorio). Requiere `compras.autorizar`; el backend re-verifica el permiso (A1).
 */
export function BandejaAutorizacionPagina(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const puedeAutorizar = tienePermiso('compras.autorizar');

  const [pagina, setPagina] = useState(1);
  const consulta = useOrdenesCompra({
    pagina,
    porPagina: POR_PAGINA,
    estatus: 'pendiente_autorizacion',
    ordenarPor: 'fecha',
    direccion: 'asc',
  });
  const autorizar = useAutorizarOc();

  function autorizarOc(oc: OrdenCompra): void {
    autorizar.mutate(oc.id, {
      onSuccess: (guardada) => toast.success(`Orden de compra ${guardada.numCompra} autorizada.`),
      onError: (error) => toast.error(error.message),
    });
  }

  const datos = consulta.data;
  const ocs = datos?.datos ?? [];
  const totalPaginas = datos?.totalPaginas ?? 0;

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4 lg:px-6">
        <div className="min-w-0 flex-1">
          <h1 className="text-[21px] leading-tight font-semibold tracking-tight">
            Autorización de compras
          </h1>
          <p className="truncate text-[12.5px] text-muted-foreground">
            Órdenes de compra pendientes de autorizar
          </p>
        </div>
        {datos ? (
          <span className="text-sm text-muted-foreground" data-testid="resumen-bandeja-oc">
            {datos.total} pendientes
          </span>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4 lg:p-6">
        {consulta.isPending ? (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2" data-testid="bandeja-cargando">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-40 w-full rounded-lg" />
            ))}
          </div>
        ) : consulta.isError ? (
          <div className="py-10 text-center">
            <p className="text-sm font-medium text-destructive">{consulta.error.message}</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => void consulta.refetch()}
            >
              Reintentar
            </Button>
          </div>
        ) : ocs.length === 0 ? (
          <p
            className="py-10 text-center text-sm text-muted-foreground"
            data-testid="bandeja-vacia"
          >
            No hay órdenes de compra pendientes de autorizar.
          </p>
        ) : (
          <ul className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {ocs.map((oc) => (
              <li
                key={oc.id}
                className="flex flex-col rounded-lg border p-4"
                data-testid="tarjeta-oc-bandeja"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-base font-semibold">OC {oc.numCompra}</p>
                    <p className="truncate text-sm text-muted-foreground">{oc.proveedor}</p>
                  </div>
                  <p className="text-right text-base font-semibold tabular-nums">
                    {formatearMoneda(oc.total)}
                  </p>
                </div>

                <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <dt className="text-xs text-muted-foreground">Emisión</dt>
                    <dd>{fechaCortaOc(oc.fecha)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Entrega</dt>
                    <dd>{fechaCortaOc(oc.fechaEntrega)}</dd>
                  </div>
                </dl>

                {oc.correspondeA ? (
                  <p className="mt-2 text-sm">
                    <span className="text-muted-foreground">Corresponde a: </span>
                    {oc.correspondeA}
                  </p>
                ) : null}

                <details className="mt-3 text-sm">
                  <summary className="cursor-pointer text-primary" data-testid="ver-renglones-oc">
                    Ver renglones ({oc.lineas.length})
                  </summary>
                  <div className="mt-2">
                    <DetalleRenglonesOc oc={oc} />
                  </div>
                </details>

                {puedeAutorizar ? (
                  <Button
                    className="mt-4 w-full"
                    onClick={() => autorizarOc(oc)}
                    disabled={autorizar.isPending}
                    data-testid="autorizar-oc-bandeja"
                  >
                    {autorizar.isPending && autorizar.variables === oc.id ? (
                      <Loader2Icon className="animate-spin" aria-hidden />
                    ) : (
                      <CheckCircle2 aria-hidden />
                    )}
                    Autorizar
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {totalPaginas > 1 ? (
          <div className="mt-4 flex items-center justify-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPagina((p) => Math.max(1, p - 1))}
              disabled={pagina <= 1 || consulta.isFetching}
            >
              Anterior
            </Button>
            <span className="text-xs text-muted-foreground">
              pág. {pagina}/{totalPaginas}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))}
              disabled={pagina >= totalPaginas || consulta.isFetching}
            >
              Siguiente
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
