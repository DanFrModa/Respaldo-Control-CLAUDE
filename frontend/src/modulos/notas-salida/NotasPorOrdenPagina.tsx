import { Factory, Printer, Send } from 'lucide-react';
import { useState } from 'react';

import { imprimirNota, useNotasSalida } from '@/api/notas-salida';
import { useConsultaOrdenes } from '@/api/ordenes-consulta';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useDebounce } from '@/lib/useDebounce';

import { EstatusNotaBadge, descripcionMaterialNota, fechaCortaNota } from './piezas';

/** Notas por página de la orden elegida. */
const POR_PAGINA = 10;

/**
 * NOTAS POR ORDEN DE PRODUCCIÓN (F4-E5): se elige una orden de producción y se listan las notas de
 * salida que envían material a ella (vía sus renglones, filtro `idOrden`). Reemplaza
 * NotasOrd / NotasOrdSub del sistema viejo. Solo lectura; el botón Imprimir abre el PDF server-side de
 * la nota. El cruce "notas que envían a una orden" lo hace el SERVIDOR (paginación de servidor); el
 * front solo presenta (A1). Se lee bien en móvil (regla 10).
 */
export function NotasPorOrdenPagina(): React.JSX.Element {
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
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b p-4 lg:px-6">
        <span
          aria-hidden
          className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary-soft-foreground"
        >
          <Factory className="size-5" aria-hidden />
        </span>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Notas por orden</h1>
          <p className="text-sm text-muted-foreground">
            Notas de salida que envían material a una orden de producción.
          </p>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4 lg:p-6">
        {/* Paso 1: elegir orden de producción */}
        <div className="max-w-xl space-y-2">
          <label htmlFor="npo-buscar-orden" className="text-sm font-medium">
            Orden de producción
          </label>
          <Input
            id="npo-buscar-orden"
            type="search"
            placeholder="Buscar por folio, modelo o cliente…"
            value={textoBusqueda}
            onChange={(e) => setTextoBusqueda(e.target.value)}
            data-testid="npo-buscar-orden"
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
              <ul data-testid="npo-lista-ordenes">
                {(ordenes.data?.datos ?? []).map((o) => (
                  <li key={o.id}>
                    <button
                      type="button"
                      onClick={() => elegirOrden(o.id)}
                      aria-pressed={idOrden === o.id}
                      className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-muted ${
                        idOrden === o.id ? 'bg-primary-soft' : ''
                      }`}
                      data-testid="npo-orden-opcion"
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

        {/* Paso 2: notas ligadas */}
        {idOrden !== null ? (
          <div className="mt-6">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Send className="size-4" aria-hidden />
              Notas de salida
              {ordenSeleccionada ? ` de la orden ${ordenSeleccionada.folio}` : ''}
            </h2>

            {notas.isPending ? (
              <div className="space-y-2" data-testid="npo-cargando">
                <Skeleton className="h-16 w-full rounded-lg" />
                <Skeleton className="h-16 w-full rounded-lg" />
              </div>
            ) : notas.isError ? (
              <p className="text-sm text-destructive">{notas.error.message}</p>
            ) : notasLigadas.length === 0 ? (
              <p
                className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground"
                data-testid="npo-vacio"
              >
                Esta orden de producción no tiene notas de salida.
              </p>
            ) : (
              <>
                <ul className="space-y-3" data-testid="npo-lista-notas">
                  {notasLigadas.map((nota) => (
                    <li key={nota.id} className="rounded-lg border p-3" data-testid="npo-nota">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-semibold">Nota {nota.numNota}</p>
                          <p className="truncate text-sm text-muted-foreground">{nota.maquilero}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <EstatusNotaBadge estatus={nota.estatus} />
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => imprimirNota(nota.id)}
                            aria-label={`Imprimir nota de salida ${nota.numNota}`}
                            data-testid="npo-imprimir-nota"
                          >
                            <Printer aria-hidden />
                          </Button>
                        </div>
                      </div>

                      <p className="mt-1 text-xs text-muted-foreground">
                        Elaboración {fechaCortaNota(nota.fechaElaboracion)} · Envío{' '}
                        {fechaCortaNota(nota.fechaEnvio)} · Almacén {nota.almacen}
                      </p>

                      {/* Solo los renglones que envían a ESTA orden. */}
                      <ul className="mt-2 space-y-1 text-sm">
                        {nota.lineas
                          .filter((linea) => linea.idOrden === idOrden)
                          .map((linea) => (
                            <li
                              key={linea.id}
                              className="flex flex-wrap items-center justify-between gap-2 border-t pt-1"
                              data-testid="npo-renglon"
                            >
                              <span className="min-w-0 truncate">
                                {descripcionMaterialNota(linea)}
                              </span>
                              <span className="text-muted-foreground tabular-nums">
                                {linea.cantidad.toLocaleString('es-MX')}
                                {linea.unidad ? ` ${linea.unidad}` : ''}
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
                      disabled={pagina <= 1 || notas.isFetching}
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
                      disabled={pagina >= totalPaginas || notas.isFetching}
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
