import { Factory, Printer, ShoppingCart } from 'lucide-react';
import { useState } from 'react';

import { imprimirOc, useOrdenesCompra } from '@/api/ordenes-compra';
import { useConsultaOrdenes } from '@/api/ordenes-consulta';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { formatearMoneda } from '@/lib/formato';
import { useDebounce } from '@/lib/useDebounce';

import { EstatusOcBadge, descripcionMaterial, fechaCortaOc } from './piezas';

/** Renglones por página de las OC ligadas. */
const POR_PAGINA = 10;

/**
 * COMPRAS POR ORDEN DE PRODUCCIÓN (F4-E2): se elige una orden de producción y se listan las OC que
 * la tienen ligada (vía las líneas, R7). Reemplaza OrdCompraOrdenes/OrdCompraOrdsDet del sistema
 * viejo. Solo lectura; el botón Imprimir abre el PDF server-side de la OC. El cruce "OC ligadas a una
 * orden" lo hace el SERVIDOR con el filtro `idOrden` (paginación de servidor); el front solo presenta
 * (A1).
 */
export function ComprasPorOrdenPagina(): React.JSX.Element {
  const [textoBusqueda, setTextoBusqueda] = useState('');
  const busqueda = useDebounce(textoBusqueda.trim(), 300);
  const [idOrden, setIdOrden] = useState<number | null>(null);
  const [pagina, setPagina] = useState(1);

  // Órdenes de producción no canceladas para elegir.
  const ordenes = useConsultaOrdenes({
    pagina: 1,
    porPagina: 20,
    incluirCanceladas: 'false',
    ...(busqueda.length > 0 ? { busqueda } : {}),
  });

  // OC ligadas a la orden elegida: filtro server-side por `idOrden` (paginación real).
  const ocs = useOrdenesCompra(
    idOrden === null
      ? { pagina: 1, porPagina: POR_PAGINA }
      : {
          pagina,
          porPagina: POR_PAGINA,
          idOrden,
          ordenarPor: 'numCompra',
          direccion: 'desc',
          incluirCanceladas: 'true',
        },
  );

  function elegirOrden(id: number): void {
    setIdOrden(id);
    setPagina(1);
  }

  const ordenSeleccionada = (ordenes.data?.datos ?? []).find((o) => o.id === idOrden);
  const ocsLigadas = idOrden === null ? [] : (ocs.data?.datos ?? []);
  const totalPaginas = ocs.data?.totalPaginas ?? 0;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b p-4 lg:px-6">
        <span
          aria-hidden
          className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary-soft-foreground"
        >
          <Factory className="size-5" aria-hidden />
        </span>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Compras por orden</h1>
          <p className="text-sm text-muted-foreground">
            Órdenes de compra ligadas a una orden de producción.
          </p>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4 lg:p-6">
        {/* Paso 1: elegir orden de producción */}
        <div className="max-w-xl space-y-2">
          <label htmlFor="cpo-buscar-orden" className="text-sm font-medium">
            Orden de producción
          </label>
          <Input
            id="cpo-buscar-orden"
            type="search"
            placeholder="Buscar por folio, modelo o cliente…"
            value={textoBusqueda}
            onChange={(e) => setTextoBusqueda(e.target.value)}
            data-testid="cpo-buscar-orden"
          />
          <div className="max-h-48 overflow-y-auto rounded-md border">
            {ordenes.isPending ? (
              <p className="p-3 text-sm text-muted-foreground">Cargando órdenes…</p>
            ) : ordenes.isError ? (
              <p className="p-3 text-sm text-destructive">{ordenes.error.message}</p>
            ) : (ordenes.data?.datos ?? []).length === 0 ? (
              <p className="p-3 text-sm text-muted-foreground">
                No hay órdenes que coincidan con la búsqueda.
              </p>
            ) : (
              <ul data-testid="cpo-lista-ordenes">
                {(ordenes.data?.datos ?? []).map((o) => (
                  <li key={o.id}>
                    <button
                      type="button"
                      onClick={() => elegirOrden(o.id)}
                      aria-pressed={idOrden === o.id}
                      className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-muted ${
                        idOrden === o.id ? 'bg-primary-soft' : ''
                      }`}
                      data-testid="cpo-orden-opcion"
                    >
                      <span className="font-medium">Orden {o.folio}</span>
                      <span className="truncate text-muted-foreground">
                        {o.codigoModelo} · {o.cliente}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Paso 2: OC ligadas */}
        {idOrden !== null ? (
          <div className="mt-6">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <ShoppingCart className="size-4" aria-hidden />
              Órdenes de compra ligadas
              {ordenSeleccionada ? ` a la orden ${ordenSeleccionada.folio}` : ''}
            </h2>

            {ocs.isPending ? (
              <div className="space-y-2" data-testid="cpo-cargando">
                <Skeleton className="h-16 w-full rounded-lg" />
                <Skeleton className="h-16 w-full rounded-lg" />
              </div>
            ) : ocs.isError ? (
              <p className="text-sm text-destructive">{ocs.error.message}</p>
            ) : ocsLigadas.length === 0 ? (
              <p
                className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground"
                data-testid="cpo-vacio"
              >
                Esta orden de producción no tiene órdenes de compra ligadas.
              </p>
            ) : (
              <>
                <ul className="space-y-3" data-testid="cpo-lista-oc">
                  {ocsLigadas.map((oc) => (
                    <li key={oc.id} className="rounded-lg border p-3" data-testid="cpo-oc">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-semibold">OC {oc.numCompra}</p>
                          <p className="truncate text-sm text-muted-foreground">{oc.proveedor}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <EstatusOcBadge estatus={oc.estatus} />
                          <span className="text-sm font-medium tabular-nums">
                            {formatearMoneda(oc.total)}
                          </span>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => imprimirOc(oc.id)}
                            aria-label={`Imprimir orden de compra ${oc.numCompra}`}
                            data-testid="cpo-imprimir-oc"
                          >
                            <Printer aria-hidden />
                          </Button>
                        </div>
                      </div>

                      <p className="mt-1 text-xs text-muted-foreground">
                        Emisión {fechaCortaOc(oc.fecha)} · Entrega {fechaCortaOc(oc.fechaEntrega)}
                      </p>

                      {/* Solo los renglones de ESTA orden. */}
                      <ul className="mt-2 space-y-1 text-sm">
                        {oc.lineas
                          .filter((linea) => linea.idOrden === idOrden)
                          .map((linea) => (
                            <li
                              key={linea.id}
                              className="flex flex-wrap items-center justify-between gap-2 border-t pt-1"
                              data-testid="cpo-renglon"
                            >
                              <span className="min-w-0 truncate">{descripcionMaterial(linea)}</span>
                              <span className="text-muted-foreground tabular-nums">
                                {linea.cantidad.toLocaleString('es-MX')}
                                {linea.unidad ? ` ${linea.unidad}` : ''} ·{' '}
                                {formatearMoneda(linea.subtotal)}
                              </span>
                            </li>
                          ))}
                      </ul>
                    </li>
                  ))}
                </ul>

                {totalPaginas > 1 ? (
                  <div className="mt-4 flex items-center justify-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPagina((p) => Math.max(1, p - 1))}
                      disabled={pagina <= 1 || ocs.isFetching}
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
                      disabled={pagina >= totalPaginas || ocs.isFetching}
                    >
                      Siguiente
                    </Button>
                  </div>
                ) : null}
              </>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
